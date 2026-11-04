// Gancho de prueba de la Revisión I (PC-3). Solo se importa en el build `vite build --mode medicion` (RevisionBase.tsx, bajo
// `__SIGLOW_MEDICION__`); nunca existe en `dist/` (check-dist, T-CD-01). Genera un `DetectionSet` fijo con el mismo código de
// producción (`createDetectHandler`, el de la tubería PB-6) sobre un texto de prueba y abre la Revisión con él. Los ids son
// deterministas (contador): ningún valor sale del contenido. Cuando PG-3b entregue `window.__siglowMedicion.procesar`, las E2E
// podrán obtener el mismo conjunto por ahí; esta ranura no lo necesita.
import { cryptoIds, emptyTable, tableIndexOf } from '../../../core/entities.ts';
import { createDetectHandler } from '../../../core/pipeline.ts';
import { incorporarModelo } from '../../../core/review/modelo.ts';
import { UMBRALES_MODELO } from '../../../core/umbrales.ts';
import type {
  AsuntoId, CaseEntity, DetectionSet, DetectResult, DocumentModel, DocId, IdSource, ModelProgress, PartId,
} from '../../../core/types.ts';
import { ir } from '../../estado.ts';
import { obtenerListaDelCaso, obtenerTabla } from '../../sesion.ts';
import { conPropuesta, estadoDeConjunto } from '../../analisis.ts';
import { fijarDocumento, fijarRevision, obtenerRevision } from '../../documento.ts';
import { obtenerInstantanea } from './almacen.ts';

type Modelo = 'en_curso' | 'terminado' | 'plan_b';
const hex = (n: number): string => n.toString(16).padStart(32, '0');

function idsFijos(): IdSource {
  const cuenta: Record<string, number> = {};
  return { next(prefijo) { cuenta[prefijo] = (cuenta[prefijo] ?? 0) + 1; return `${prefijo}_${hex(cuenta[prefijo] as number)}`; } };
}
const modeloDe = (m: Modelo): ModelProgress =>
  m === 'en_curso' ? { kind: 'en_curso', ventanas: 0, ventanasTotales: 0 }
    : m === 'terminado' ? { kind: 'terminado', ventanas: 1, respaldo: false } : { kind: 'plan_b', causa: 'desactivado' };

type Manejador = ReturnType<typeof createDetectHandler>;
let sesionActual: { manejar: Manejador; doc: DocumentModel } | null = null;

async function detectar(doc: DocumentModel, caseList: readonly CaseEntity[], ids: IdSource, manejar: Manejador): Promise<DetectionSet> {
  let resultado: DetectionSet | null = null;
  await manejar({
    v: 1, reqId: `req_${hex(1)}`, kind: 'detectar',
    payload: {
      sessionId: 'sesion-de-prueba', doc, caseList: [...caseList],
      table: { byKey: {}, counters: {}, documentCount: 0 },
      options: { referenceDate: '2026-10-30', rulesVersion: '1.0.0', ...UMBRALES_MODELO },
    },
  }, (m) => {
    const r = m as { kind?: string; payload?: DetectResult };
    if (r.kind === 'resultado' && r.payload?.kind === 'detectar') resultado = r.payload.set;
  });
  if (resultado === null) throw new Error('SIN_RESULTADO');
  return resultado;
}

/**
 * Abre la revisión con `texto` (partes opcionales) y el estado del modelo pedido. Devuelve el número de detecciones. F3: por defecto
 * la revisión dato por dato (`detalle`), sin la propuesta aplicada, como la v1.0; con `pantalla = 'revision'`, la vista previa.
 */
async function cargar(partes: string | readonly string[], modelo: Modelo = 'plan_b', pantalla: 'detalle' | 'revision' = 'detalle'): Promise<number> {
  const ids = idsFijos();
  const textos = typeof partes === 'string' ? [partes] : partes;
  const docId = ids.next('doc') as DocId;
  const doc: DocumentModel = {
    id: docId, label: 'Documento 1', source: 'pegado',
    parts: textos.map((text, i) => ({
      id: ids.next('prt') as PartId, docId, kind: i === 0 ? 'cuerpo' : 'pie', label: i === 0 ? 'Cuerpo del documento' : `Pie de página ${i}`,
      order: i, index: i === 0 ? 1 : i, text, included: true,
    })),
    metadata: { categories: {} }, warnings: [],
  };
  const manejar = createDetectHandler({ ids });
  const set = await detectar(doc, obtenerListaDelCaso(), ids, manejar);
  sesionActual = { manejar, doc };
  fijarDocumento(doc);
  fijarRevision(estadoDeConjunto(doc, set, modeloDe(modelo)));
  ir(pantalla);
  return set.detections.length;
}

/** Una ventana del modelo simulada con la tubería de producción: `fusionar` con tramos `PER` (por texto) y `incorporar_modelo`. */
async function incorporarVentana(textos: readonly string[], ventana: number, ventanasTotales: number): Promise<number> {
  if (sesionActual === null) throw new Error('SIN_SESION');
  const { manejar, doc } = sesionActual;
  const ner: Record<string, Array<{ start: number; end: number; label: 'PER'; score: number }>> = {};
  for (const p of doc.parts) {
    for (const t of textos) {
      const i = p.text.indexOf(t);
      if (i >= 0) (ner[p.id] ??= []).push({ start: i, end: i + t.length, label: 'PER', score: 0.97 });
    }
  }
  let delta: DetectionSet | null = null;
  await manejar({ v: 1, reqId: `req_${hex(100 + ventana)}`, kind: 'fusionar', payload: { sessionId: 'sesion-de-prueba', ner, nerEngineId: 'prueba', ventana, ventanasTotales } }, (m) => {
    const r = m as { kind?: string; payload?: DetectResult };
    if (r.kind === 'resultado' && r.payload?.kind === 'fusionar') delta = r.payload.set;
  });
  if (delta === null) throw new Error('SIN_RESULTADO');
  const d: DetectionSet = delta;
  // Como la interfaz (analisis.ts) y la medición (gancho.ts): `incorporarModelo` y no el reductor directo, para que una acción
  // del usuario antes de la ventana no descarte el tramo entero (restos de 7.11.2; P0-6a de PB-2-r4, PB-2-r5).
  const actual = obtenerRevision();
  if (actual === null) return -1;
  const r = incorporarModelo(actual, ventana, ventanasTotales, d, { table: tableIndexOf(obtenerTabla() ?? emptyTable('asu_' as AsuntoId)),
    caseList: obtenerListaDelCaso(), doc, ids: cryptoIds });
  if (!r.ok) return -1;
  // F8: como ponerRevision (analisis.ts), con el modelo terminado la vista previa recibe la propuesta (D-24).
  const final = r.state.modelo.kind === 'en_curso' ? r.state : conPropuesta(r.state, doc, cryptoIds);
  if (final !== actual) fijarRevision(final);
  return d.detections.length;
}

export function instalarPruebaRevision(): void {
  (globalThis as unknown as Record<string, unknown>)['__siglowRevisionPrueba'] = {
    cargar,
    incorporarVentana,
    revision: (): number => obtenerInstantanea().state?.revision ?? -1,
    detalle: (): Array<{ texto: string; source: string; precedence: number; confidence: string; status: string; type: string }> => {
      const s = obtenerInstantanea().state;
      return s === null ? [] : s.order.map((id) => s.detections[id]).filter((d) => d !== undefined)
        .map((d) => ({ texto: d.text, source: d.source, precedence: d.precedence, confidence: d.confidence, status: d.status, type: d.type }));
    },
    estado: (): { revision: number; estados: Record<string, number> } => {
      const s = obtenerInstantanea().state;
      const estados: Record<string, number> = {};
      if (s !== null) for (const d of Object.values(s.detections)) estados[d.status] = (estados[d.status] ?? 0) + 1;
      return { revision: s?.revision ?? -1, estados };
    },
  };
}
