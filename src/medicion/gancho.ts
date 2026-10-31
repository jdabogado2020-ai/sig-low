// Gancho de medición (PG-3b; plan 10.3.3). Solo existe en el build `vite build --mode medicion` (`__SIGLOW_MEDICION__`): `main.tsx` lo
// importa dentro de esa condición y `check-dist` prohíbe su marca en `dist/`. Expone `window.__siglowMedicion.procesar(bytes, formato,
// listaDelCaso, opciones)`, que corre la misma cadena de producción (lector `io`, worker `detect` y, si se pide, worker `ner`) y devuelve
// las partes, el `DetectionSet`, el `NerLoadResult` y los tiempos por etapa. Playwright pasa los bytes con `page.evaluate`, sin ninguna
// petición. Nada de esto toca el estado de la interfaz ni persiste: el resultado vive solo en la respuesta de la llamada.
import { leerArchivo } from '../io/io-client';
import { incorporarModelo, modeloInicial } from '../core/review/modelo';
import { randomIds } from '../io/txt-read';
import { SiglowError } from '../core/types';
import type {
  CaseEntity, DetectResult, DetectionSet, DocId, DocumentModel, ErrorCode, ModelManifest, NerLoadResult, NerOptions, NerSpan, PartId,
  ReviewState, TableIndex,
} from '../core/types';

export type FormatoMedicion = 'txt' | 'docx';

export interface OpcionesMedicion {
  referenceDate: string;
  rulesVersion: string;
  nerHighThreshold: number;
  nerMinScore: number;
  /** Con manifiesto, se carga el modelo y se corre por ventanas; sin él, solo reglas y lista (plan B). */
  manifiesto?: ModelManifest;
  nerOptions?: NerOptions;
}

export interface TiemposMedicion {
  lecturaMs: number; reglasMs: number; modeloMs: number | null; ventanas: number | null; fusionMs: number; totalMs: number;
}

export interface ResultadoMedicion {
  doc: DocumentModel;
  /** Propuestas del motor antes de cualquier decisión: lo detectado con reglas y lista más las ventanas del modelo. */
  set: DetectionSet;
  estado: ReviewState;
  modelo: NerLoadResult | null;
  /** Salidas del modelo por ventana, para la caché de PF-3 (sin texto del documento: solo posiciones y puntajes). */
  ventanas: Array<{ partId: PartId; windowIndex: number; windowTotal: number; spans: NerSpan[]; ms: number }>;
  tiempos: TiemposMedicion;
}

type Mensaje = { v: number; reqId: string; kind: string; [k: string]: unknown };

const ahora = (): number => performance.now();

/** Una petición a un worker: devuelve el `resultado`, pasa los `parcial` a `alParcial` y rechaza con el código del `error` (nunca contenido). */
function pedir<T>(w: Worker, kind: string, payload: unknown, alParcial?: (m: Mensaje) => void): Promise<T> {
  const reqId = randomIds().next('req');
  return new Promise<T>((resolve, reject) => {
    const alMensaje = (ev: MessageEvent<unknown>): void => {
      const m = ev.data as Mensaje;
      if (m === null || typeof m !== 'object' || m.reqId !== reqId) return;
      if (m.kind === 'resultado') { w.removeEventListener('message', alMensaje); resolve(m['payload'] as T); }
      else if (m.kind === 'parcial') alParcial?.(m);
      else if (m.kind === 'error') { w.removeEventListener('message', alMensaje); reject(new SiglowError((typeof m['code'] === 'string' ? m['code'] : 'ERROR_INTERNO') as ErrorCode)); }
      else if (m.kind === 'cancelado') { w.removeEventListener('message', alMensaje); reject(new SiglowError('ERROR_INTERNO')); }
    };
    w.addEventListener('message', alMensaje);
    w.postMessage({ v: 1, reqId, kind, payload });
  });
}

const por = <T extends { id: string }>(xs: readonly T[]): Record<string, T> => Object.fromEntries(xs.map((x) => [x.id, x]));

export async function procesar(
  bytes: ArrayBuffer, formato: FormatoMedicion, listaDelCaso: CaseEntity[], opciones: OpcionesMedicion,
): Promise<ResultadoMedicion> {
  const ids = randomIds();
  const t0 = ahora();
  const doc = await leerArchivo({ format: formato, bytes, docId: ids.next('doc') as DocId, label: 'Documento 1' });
  const lecturaMs = ahora() - t0;

  const detect = new Worker(new URL('../workers/detect.worker.ts', import.meta.url), { type: 'module' });
  const ner = opciones.manifiesto === undefined ? null : new Worker(new URL('../workers/ner.worker.ts', import.meta.url), { type: 'module' });
  const tabla: TableIndex = { byKey: {}, counters: {}, documentCount: 0 };
  const sessionId = `ses_${ids.next('req')}`;
  try {
    const t1 = ahora();
    const det = await pedir<DetectResult & { kind: 'detectar' }>(detect, 'detectar', {
      sessionId, doc, caseList: listaDelCaso, table: tabla,
      options: { referenceDate: opciones.referenceDate, rulesVersion: opciones.rulesVersion, nerHighThreshold: opciones.nerHighThreshold, nerMinScore: opciones.nerMinScore },
    });
    const reglasMs = ahora() - t1;
    let estado: ReviewState = {
      docId: doc.id, revision: 0, detections: por(det.set.detections), order: det.set.detections.map((d) => d.id), entities: por(det.set.entities),
      suggestions: por(det.set.suggestions), flags: por(det.set.flags), spanEdits: por(det.set.spanEdits ?? []), committed: false,
      modelo: modeloInicial(ner === null),
    } as unknown as ReviewState;

    let carga: NerLoadResult | null = null;
    const ventanas: ResultadoMedicion['ventanas'] = [];
    let modeloMs: number | null = null;
    let fusionMs = 0;
    if (ner !== null && opciones.manifiesto !== undefined && opciones.nerOptions !== undefined) {
      const t2 = ahora();
      carga = (await pedir<{ kind: 'cargar'; load: NerLoadResult }>(ner, 'cargar', { manifest: opciones.manifiesto })).load;
      const pendientes: Array<Promise<void>> = [];
      let total = 0;
      let hechas = 0;
      const incorporar = (m: Mensaje): void => {
        const p = m['payload'] as { windowsTotal: number; window: { partId: PartId; windowIndex: number; windowTotal: number; spans: NerSpan[]; ms: number } };
        total = p.windowsTotal;
        ventanas.push(p.window);
        const n = ++hechas;
        const tf = ahora();
        pendientes.push(pedir<DetectResult & { kind: 'fusionar' }>(detect, 'fusionar', {
          sessionId, ner: { [p.window.partId]: p.window.spans }, nerEngineId: carga?.engineId ?? 'nulo', ventana: n, ventanasTotales: total,
        }).then((r) => {
          const o = incorporarModelo(estado, n, total, r.set, { table: tabla, caseList: listaDelCaso, doc, ids });
          if (o.ok) estado = o.state;
          fusionMs += ahora() - tf;
        }));
      };
      const partes = doc.parts.filter((x) => x.included).map((x) => ({ partId: x.id, text: x.text }));
      await pedir(ner, 'detectar', { parts: partes, options: opciones.nerOptions }, incorporar);
      await Promise.all(pendientes);
      modeloMs = ahora() - t2;
      await pedir(ner, 'liberar', {});
    }
    await pedir(detect, 'liberar', { sessionId });
    return {
      doc, set: { detections: Object.values(estado.detections), entities: Object.values(estado.entities), suggestions: Object.values(estado.suggestions),
        flags: Object.values(estado.flags), spanEdits: Object.values(estado.spanEdits) },
      estado, modelo: carga, ventanas,
      tiempos: { lecturaMs, reglasMs, modeloMs, ventanas: ner === null ? null : ventanas.length, fusionMs, totalMs: lecturaMs + reglasMs + fusionMs },
    };
  } finally {
    detect.terminate();
    ner?.terminate();
  }
}

/** Forma pública del gancho: `window.__siglowMedicion`. */
export interface GanchoMedicion { version: 1; procesar: typeof procesar }

export function instalarGancho(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  // La marca fija que `check-dist` busca en `dist/` (T-CD-01); el objeto de uso es `__siglowMedicion`.
  g['__SIGLOW_GANCHO_MEDICION__'] = { version: 1 };
  g['__siglowMedicion'] = { version: 1, procesar } satisfies GanchoMedicion;
}
