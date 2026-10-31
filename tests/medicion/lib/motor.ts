// El motor de producción sobre el texto canónico, en Node y sin navegador (PG-3b, plan 10.3.3): el mismo `createDetectHandler` que
// usa el worker `detect`, el mismo reductor y el mismo `incorporar_modelo` por ventana. Las salidas del modelo salen de la caché.
import { applyReviewAction } from '../../../src/core/entities.ts';
import type { ReviewContext } from '../../../src/core/entities.ts';
import { createDetectHandler } from '../../../src/core/pipeline.ts';
import { incorporarModelo, modeloInicial } from '../../../src/core/review/modelo.ts';
import type {
  DetectionSet, DocumentModel, IdSource, NerSpan, PartId, RenderedOutput, ReviewState, TableIndex,
} from '../../../src/core/types.ts';
import type {
  BanderaMedida, DeteccionMedida, EntradaDocumento, SalidaParte, SugerenciaMedida, TiempoDoc,
} from '../../../scripts/metrics.ts';
import type { DocumentoCache } from './cache.ts';
import type { DocCorpus } from './corpus.ts';
import { idsSecuenciales } from './corpus.ts';

export const TABLA_VACIA: TableIndex = { byKey: {}, counters: {}, documentCount: 0 };
export const OPCIONES_DETECCION = { referenceDate: '2026-10-30', rulesVersion: '1.0.0', nerHighThreshold: 0.9, nerMinScore: 0.3 };
export type OpcionesDeteccion = typeof OPCIONES_DETECCION;

type Mensaje = { v: number; reqId: string; kind: string; [k: string]: unknown };

export interface Motor {
  ids: IdSource;
  enviar(kind: string, payload: unknown): Promise<Mensaje[]>;
  /** Resultado de una petición; un `error` del worker se vuelve una excepción con el código (nunca contenido). */
  pedir<T>(kind: string, payload: unknown): Promise<T>;
}

export function crearMotor(ids: IdSource = idsSecuenciales(1000)): Motor {
  const h = createDetectHandler({ ids, yieldFn: () => Promise.resolve() });
  let n = 0;
  const enviar = async (kind: string, payload: unknown): Promise<Mensaje[]> => {
    const out: Mensaje[] = [];
    await h({ v: 1, reqId: `req_${(++n).toString(16).padStart(32, '0')}`, kind, payload }, (m) => out.push(m as Mensaje));
    return out;
  };
  return {
    ids,
    enviar,
    async pedir<T>(kind: string, payload: unknown): Promise<T> {
      const out = await enviar(kind, payload);
      const r = out.find((m) => m.kind === 'resultado');
      if (r === undefined) throw new Error(`motor:${String(out.find((m) => m.kind === 'error')?.['code'] ?? 'sin_resultado')}`);
      return r.payload as T;
    },
  };
}

export function estadoDe(doc: DocumentModel, set: DetectionSet, modelo: ReviewState['modelo']): ReviewState {
  const por = <T extends { id: string }>(xs: readonly T[]): Record<string, T> => Object.fromEntries(xs.map((x) => [x.id, x]));
  return {
    docId: doc.id, revision: 0, detections: por(set.detections), order: set.detections.map((d) => d.id), entities: por(set.entities),
    suggestions: por(set.suggestions), flags: por(set.flags), spanEdits: por(set.spanEdits ?? []), committed: false, modelo,
  } as unknown as ReviewState;
}

export interface DocProcesado {
  dc: DocCorpus;
  /** Propuestas del motor antes de cualquier decisión (10.3.1). */
  state: ReviewState;
  ctx: ReviewContext;
  tiempos: TiempoDoc;
}

/** Reglas + lista, y luego, si hay caché, una ventana a la vez como lo hace el producto (`fusionar` con `ventana` e `incorporar_modelo`). */
export async function procesarDocumento(
  m: Motor, dc: DocCorpus, cache: DocumentoCache | undefined, opciones: OpcionesDeteccion = OPCIONES_DETECCION,
): Promise<DocProcesado> {
  const sessionId = `ses_${dc.docId}`;
  const t0 = performance.now();
  const det = await m.pedir<{ kind: 'detectar'; set: DetectionSet }>('detectar',
    { sessionId, doc: dc.doc, caseList: dc.caseList, table: TABLA_VACIA, options: opciones });
  const reglasMs = performance.now() - t0;
  let state = estadoDe(dc.doc, det.set, modeloInicial(cache === undefined));
  const ctx: ReviewContext = { table: TABLA_VACIA, caseList: dc.caseList, doc: dc.doc, ids: m.ids };

  const ventanas: Array<{ partId: PartId; spans: NerSpan[] }> = [];
  if (cache !== undefined) {
    for (const p of dc.doc.parts) {
      const clave = dc.claveDe.get(p.id) as string;
      const v = [...(cache.partes[clave]?.ventanas ?? [])].sort((a, b) => a.windowIndex - b.windowIndex);
      for (const w of v) ventanas.push({ partId: p.id, spans: w.spans });
    }
  }
  const t1 = performance.now();
  let fusionMs = 0;
  for (let i = 0; i < ventanas.length; i++) {
    const w = ventanas[i] as { partId: PartId; spans: NerSpan[] };
    const t = performance.now();
    const r = await m.pedir<{ kind: 'fusionar'; set: DetectionSet }>('fusionar',
      { sessionId, ner: { [w.partId]: w.spans }, nerEngineId: 'gliner-x-large', ventana: i + 1, ventanasTotales: ventanas.length });
    const o = incorporarModelo(state, i + 1, ventanas.length, r.set, ctx);
    if (!o.ok) throw new Error(`motor:incorporar_modelo:${o.code}`);
    state = o.state;
    fusionMs += performance.now() - t;
  }
  const modeloMs = cache === undefined ? null : performance.now() - t1;
  await m.pedir('liberar', { sessionId });
  // Un `incorporar_modelo` aceptado cuenta como revisión: la revisión de partida es 0 para el oráculo.
  state = { ...state, revision: 0 };
  return {
    dc, state, ctx,
    tiempos: {
      docId: dc.docId, paginas: dc.paginas, lecturaMs: 0, reglasMs, modeloMs, ventanas: cache === undefined ? null : ventanas.length,
      fusionMs, totalMs: reglasMs + fusionMs,
    },
  };
}

/** Lo que las métricas necesitan del estado (todas las propuestas, sea cual sea su estado). */
export function entradaDeEstado(p: DocProcesado): EntradaDocumento {
  const { dc, state } = p;
  const clave = (id: PartId): string => dc.claveDe.get(id) as string;
  const detecciones: DeteccionMedida[] = Object.values(state.detections).map((d) => ({
    id: d.id, parte: clave(d.partId), start: d.start, end: d.end, tipo: d.type, entidad: d.entityId,
  }));
  const banderas: BanderaMedida[] = Object.values(state.flags).map((f) => ({
    tipo: f.type, parte: clave(f.span.partId), start: f.span.start, end: f.span.end, ...(f.detectionId === undefined ? {} : { deteccion: f.detectionId }),
  }));
  const sugerencias: SugerenciaMedida[] = [];
  for (const s of Object.values(state.suggestions)) {
    const span = s.target.kind === 'tramo' ? s.target.span : (() => {
      const d = state.detections[s.target.detectionId];
      return d === undefined ? undefined : { partId: d.partId, start: d.start, end: d.end };
    })();
    if (span !== undefined) sugerencias.push({ kind: s.kind, parte: clave(span.partId), start: span.start, end: span.end });
  }
  return { gold: dc.gold, detecciones, banderas, sugerencias, paginas: dc.paginas, tiempos: p.tiempos };
}

/** La salida renderizada en la forma que usa el script de métricas (`SalidaParte`). */
export function salidaDe(dc: DocCorpus, out: RenderedOutput): SalidaParte[] {
  return out.sections.map((s) => ({
    parte: dc.claveDe.get(s.partId) as string,
    texto: s.text,
    segmentos: s.segments.map((g) => ({
      outStart: g.outStart, outEnd: g.outEnd, partStart: g.partStart, partEnd: g.partEnd,
      ...(g.detectionId === undefined ? {} : { detectionId: g.detectionId }),
      ...(g.spanEditId === undefined ? {} : { spanEditId: g.spanEditId }),
    })),
  }));
}

export { applyReviewAction };
