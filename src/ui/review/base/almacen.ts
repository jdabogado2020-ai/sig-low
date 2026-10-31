// Almacén en memoria [M] de la revisión en curso (documento + ReviewState) y estado de la pantalla Revisión I (PC-3).
// Es el punto de entrada para PC-2 (crea la revisión al terminar Procesando), PC-4 (pestañas, contador, ventanas del modelo) y
// PC-5 (Listo): todos despachan acciones por `despachar()`, que llama al reductor puro `applyReviewAction` (PB-3) con la tabla
// del asunto y la lista del caso de la sesión. Nada se serializa; `registrarLimpieza()` lo vacía con el estado [M] (INV-G09).
import { useEffect, useState } from 'preact/hooks';
import { applyReviewAction, cryptoIds, type ReviewContext } from '../../../core/entities.ts';
import type {
  DetectionId, DetectionSet, DocumentModel, EntityId, ModelProgress, ReviewAction, ReviewError, ReviewOutcome, ReviewState, Span, TableIndex,
} from '../../../core/types.ts';
import { obtenerListaDelCaso, obtenerTabla, registrarLimpieza } from '../../sesion.ts';
import { t } from '../../mensajes.ts';
import { pendienteAdyacente, pendientesTotales } from './presentacion.ts';

export type VistaRevision = 'original' | 'salida';

export interface InstantaneaRevision {
  doc: DocumentModel | null;
  state: ReviewState | null;
  vista: VistaRevision;
  /** Mención seleccionada (su ficha está abierta); null si ninguna. */
  seleccion: DetectionId | null;
  /** Entidad seleccionada desde la cuadrícula cuando no hay mención seleccionada. */
  entidadSeleccion: EntityId | null;
  expandidas: ReadonlySet<EntityId>;
  /** Detecciones del modelo recién llegadas (insignia NUEVA) hasta que se enfocan o llega la ventana siguiente. */
  nuevas: ReadonlySet<DetectionId>;
  /** Tramo pedido para «Agregar reemplazo» (selección con el ratón o búsqueda propia de PC-4). */
  reemplazo: Span | null;
  /** Mención cuyo reemplazo se pidió editar (tecla E o botón «Editar»); la ficha abre el campo. */
  edicion: DetectionId | null;
  /** Una edición de reemplazo está abierta: los anuncios del modelo esperan (8.6.3). */
  editando: boolean;
  /** Último anuncio de la región viva (sin texto del documento) y su error, si lo hubo. */
  anuncio: string;
  error: ReviewError | null;
  /** Petición de mover el foco a un resaltado o a una fila; la pantalla la consume. */
  enfoque: { tipo: 'resaltado' | 'fila'; id: string; n: number } | null;
}

const VACIA: InstantaneaRevision = {
  doc: null, state: null, vista: 'original', seleccion: null, entidadSeleccion: null, expandidas: new Set(), nuevas: new Set(),
  reemplazo: null, edicion: null, editando: false, anuncio: '', error: null, enfoque: null,
};

let actual: InstantaneaRevision = VACIA;
let peticiones = 0;
const oyentes = new Set<() => void>();
const avisar = (): void => { for (const o of [...oyentes]) o(); };
const poner = (parche: Partial<InstantaneaRevision>): void => { actual = { ...actual, ...parche }; avisar(); };

export function obtenerInstantanea(): InstantaneaRevision {
  return actual;
}
export function obtenerRevision(): { doc: DocumentModel; state: ReviewState } | null {
  return actual.doc !== null && actual.state !== null ? { doc: actual.doc, state: actual.state } : null;
}
export function suscribirRevision(fn: () => void): () => void {
  oyentes.add(fn);
  return () => { oyentes.delete(fn); };
}
export function useRevision(): InstantaneaRevision {
  const [, forzar] = useState(0);
  useEffect(() => suscribirRevision(() => { forzar((n) => n + 1); }), []);
  return actual;
}

/** Estado inicial de revisión a partir del `DetectionSet` que entrega `detect` (6.11.2, «reglas y lista listas»). */
export function estadoDesdeConjunto(doc: DocumentModel, set: DetectionSet, modelo: ModelProgress): ReviewState {
  const orden = new Map(doc.parts.map((p) => [p.id, p.order]));
  const detecciones = [...set.detections].sort((a, b) =>
    (orden.get(a.partId) ?? 0) - (orden.get(b.partId) ?? 0) || a.start - b.start || a.end - b.end);
  return {
    docId: doc.id,
    revision: 0,
    detections: Object.fromEntries(detecciones.map((d) => [d.id, d])),
    order: detecciones.map((d) => d.id),
    entities: Object.fromEntries(set.entities.map((e) => [e.id, e])),
    suggestions: Object.fromEntries(set.suggestions.map((s) => [s.id, s])),
    flags: Object.fromEntries(set.flags.map((f) => [f.id, f])),
    spanEdits: Object.fromEntries((set.spanEdits ?? []).map((s) => [s.id, s])),
    committed: false,
    modelo,
  };
}

/** PC-2 la llama al pasar de Procesando a Revisión. Reinicia la selección y la vista. */
export function fijarRevision(doc: DocumentModel, state: ReviewState): void {
  actual = { ...VACIA, doc, state };
  avisar();
}
/** «Descartar documento», bloqueo, cierre del asunto y `pagehide` (INV-G09). */
export function limpiarRevision(): void {
  actual = VACIA;
  if (temporizadorModelo !== undefined) { clearTimeout(temporizadorModelo); temporizadorModelo = undefined; }
  avisar();
}
registrarLimpieza(limpiarRevision);

function contexto(): ReviewContext | null {
  if (actual.doc === null) return null;
  const tabla = obtenerTabla();
  const byKey: Record<string, string> = {};
  if (tabla !== null) for (const e of Object.values(tabla.entries)) byKey[e.canonicalKey] = e.marker;
  const table: TableIndex = { byKey, counters: tabla === null ? {} : { ...tabla.counters }, documentCount: tabla === null ? 0 : tabla.documents.length };
  return { table, caseList: obtenerListaDelCaso(), doc: actual.doc, ids: cryptoIds };
}

// Anuncios de las ventanas del modelo: como máximo cada 5 s y nunca durante una edición (8.6.3).
let ultimoAnuncioModelo = 0;
let acumuladas = 0;
let temporizadorModelo: ReturnType<typeof setTimeout> | undefined;
let anunciarModelo: ((n: number) => string) | null = (n) => t('M-166', { n });
/** PC-4 registra el texto del anuncio (M-166); mientras no, la pantalla usa el suyo. */
export function registrarAnuncioDelModelo(f: (n: number) => string): void {
  anunciarModelo = f;
}
function programarAnuncioDelModelo(nuevas: number): void {
  acumuladas += nuevas;
  const ahora = Date.now();
  const emitir = (): void => {
    temporizadorModelo = undefined;
    if (actual.editando) { temporizadorModelo = setTimeout(emitir, 1000); return; }
    if (acumuladas > 0 && anunciarModelo !== null) poner({ anuncio: anunciarModelo(acumuladas) });
    acumuladas = 0;
    ultimoAnuncioModelo = Date.now();
  };
  if (temporizadorModelo !== undefined) return;
  const espera = Math.max(0, 5000 - (ahora - ultimoAnuncioModelo));
  temporizadorModelo = setTimeout(emitir, espera);
}

/**
 * Despacha una acción al reductor (6.4.4). Con éxito guarda el estado nuevo (`revision` sube en 1, INV-R08); con error deja el
 * estado como estaba y deja el código en `error` (la pantalla lo muestra con 8.5.5). No mueve el foco ni la selección.
 */
export function despachar(accion: ReviewAction): ReviewOutcome {
  const ctx = contexto();
  if (ctx === null || actual.state === null) return { ok: false, code: 'NO_ENCONTRADO' };
  const antes = actual.state;
  const r = applyReviewAction(antes, accion, ctx);
  if (!r.ok) { poner({ error: r.code }); return r; }
  if (r.state === antes) return r;
  let nuevas = actual.nuevas;
  let llegadas = 0;
  if (accion.kind === 'incorporar_modelo') {
    const conjunto = new Set<DetectionId>();
    for (const id of Object.keys(r.state.detections) as DetectionId[]) {
      if (antes.detections[id] === undefined && r.state.detections[id]?.source === 'modelo') conjunto.add(id);
    }
    llegadas = conjunto.size;
    nuevas = conjunto;
  }
  const seleccion = actual.seleccion !== null && r.state.detections[actual.seleccion] === undefined ? null : actual.seleccion;
  poner({ state: r.state, error: null, nuevas, seleccion });
  if (llegadas > 0) programarAnuncioDelModelo(llegadas);
  return r;
}

export function anunciar(texto: string): void {
  poner({ anuncio: texto });
}
export function limpiarError(): void {
  if (actual.error !== null) poner({ error: null });
}
export function cambiarVista(vista: VistaRevision): void {
  if (actual.vista !== vista) poner({ vista });
}
export function marcarEdicion(activa: boolean): void {
  if (actual.editando !== activa) poner({ editando: activa });
}
/** Abre el campo de edición del reemplazo de una mención (selecciona la mención). */
export function solicitarEdicion(id: DetectionId): void {
  const nuevas = new Set(actual.nuevas);
  nuevas.delete(id);
  poner({ seleccion: id, entidadSeleccion: null, edicion: id, nuevas });
}
export function terminarEdicion(): void {
  if (actual.edicion !== null || actual.editando) poner({ edicion: null, editando: false });
}
export function solicitarReemplazo(span: Span | null): void {
  poner({ reemplazo: span });
}

/** Selecciona una mención (abre su ficha), despliega su entidad en la cuadrícula y la quita de las recién llegadas. */
export function seleccionar(id: DetectionId | null): void {
  const nuevas = new Set(actual.nuevas);
  const expandidas = new Set(actual.expandidas);
  if (id !== null) {
    nuevas.delete(id);
    const d = actual.state?.detections[id];
    if (d !== undefined) expandidas.add(d.entityId);
  }
  poner({ seleccion: id, nuevas, expandidas, entidadSeleccion: id === null ? actual.entidadSeleccion : null, edicion: id === actual.edicion ? actual.edicion : null });
}
export function seleccionarEntidad(id: EntityId | null): void {
  poner({ entidadSeleccion: id, seleccion: null });
}
export function alternarExpandida(id: EntityId, abierta?: boolean): void {
  const nuevas = new Set(actual.expandidas);
  const quiere = abierta ?? !nuevas.has(id);
  if (quiere) nuevas.add(id); else nuevas.delete(id);
  poner({ expandidas: nuevas });
}
export function pedirEnfoque(tipo: 'resaltado' | 'fila', id: string): void {
  poner({ enfoque: { tipo, id, n: ++peticiones } });
}
export function consumirEnfoque(n: number): void {
  if (actual.enfoque !== null && actual.enfoque.n === n) { actual = { ...actual, enfoque: null }; }
}

/** Ir a la siguiente (1) o anterior (-1) detección pendiente: selecciona, expande su entidad y pide el foco. */
export function irAPendiente(direccion: 1 | -1): DetectionId | null {
  if (actual.state === null) return null;
  const id = pendienteAdyacente(actual.state, actual.seleccion, direccion);
  if (id === null) return null;
  irA(id);
  return id;
}
/** Selecciona una mención, despliega su entidad y pide el foco en el resaltado (monta el bloque si hace falta, 8.8). */
export function irA(id: DetectionId, destino: 'resaltado' | 'fila' = 'resaltado'): void {
  const d = actual.state?.detections[id];
  if (d === undefined) return;
  const expandidas = new Set(actual.expandidas);
  expandidas.add(d.entityId);
  const nuevas = new Set(actual.nuevas);
  nuevas.delete(id);
  actual = { ...actual, seleccion: id, entidadSeleccion: null, expandidas, nuevas, vista: 'original', enfoque: { tipo: destino, id, n: ++peticiones } };
  avisar();
}

export function pendientesDelDocumento(): number {
  return actual.state === null ? 0 : pendientesTotales(actual.state);
}
