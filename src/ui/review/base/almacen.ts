// Estado de la pantalla Revisión I (PC-3) sobre el almacén único del documento (src/ui/documento.ts, PC-2): allí viven el
// DocumentModel y el ReviewState [M], con su vaciado en el bloqueo (INV-G09). Aquí solo está lo propio de la pantalla (selección,
// vista, entidades desplegadas, marca NUEVA, foco, edición y anuncios) y `despachar()`, que llama al reductor puro
// `applyReviewAction` (PB-3) con la tabla del asunto y la lista del caso y guarda el resultado con `fijarRevision()` de documento.ts.
// PC-4 y PC-5 despachan por el mismo punto; PC-2 aplica `incorporar_modelo` por su cuenta y esta pantalla lo detecta al suscribirse.
import { useEffect, useState } from 'preact/hooks';
import { applyReviewAction, cryptoIds, type ReviewContext } from '../../../core/entities.ts';
import type {
  DetectionId, DocumentModel, EntityId, ReviewAction, ReviewError, ReviewOutcome, ReviewState, Span, TableIndex,
} from '../../../core/types.ts';
import { fijarRevision, obtenerDocumento, obtenerRevision, suscribirDocumento } from '../../documento.ts';
import { t } from '../../mensajes.ts';
import { obtenerListaDelCaso, obtenerTabla, registrarLimpieza } from '../../sesion.ts';
import { pendienteAdyacente, pendientesTotales } from './presentacion.ts';

export type VistaRevision = 'original' | 'salida';

/** Lo propio de la pantalla (no incluye el documento ni el ReviewState, que son de documento.ts). */
interface EstadoPantalla {
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
  /** F3 · «Ocultar todas las apariciones»: el diálogo abre con «Aplicar a todas las apariciones idénticas» marcada. */
  propagarReemplazo: boolean;
  /** M-142: el texto de la salida que cubre la selección de la vista previa (con las etiquetas); null fuera de ella. */
  reemplazoTexto: string | null;
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
export interface InstantaneaRevision extends EstadoPantalla {
  doc: DocumentModel | null;
  state: ReviewState | null;
}

const VACIA: EstadoPantalla = {
  vista: 'original', seleccion: null, entidadSeleccion: null, expandidas: new Set(), nuevas: new Set(),
  reemplazo: null, propagarReemplazo: false, reemplazoTexto: null, edicion: null, editando: false, anuncio: '', error: null, enfoque: null,
};

let ui: EstadoPantalla = VACIA;
let peticiones = 0;
const oyentes = new Set<() => void>();
const avisar = (): void => { for (const o of [...oyentes]) o(); };
const poner = (parche: Partial<EstadoPantalla>): void => { ui = { ...ui, ...parche }; avisar(); };

let memo: InstantaneaRevision | null = null;
const mismoEstado = (m: InstantaneaRevision, u: EstadoPantalla): boolean =>
  (Object.keys(u) as Array<keyof EstadoPantalla>).every((k) => m[k] === u[k]);
export function obtenerInstantanea(): InstantaneaRevision {
  const doc = obtenerDocumento();
  const state = obtenerRevision();
  if (memo === null || memo.doc !== doc || memo.state !== state || !mismoEstado(memo, ui)) memo = { ...ui, doc, state };
  return memo;
}
export function suscribirRevision(fn: () => void): () => void {
  oyentes.add(fn);
  return () => { oyentes.delete(fn); };
}
/** Documento, estado de revisión y estado de la pantalla en una sola vista, para los componentes de la Revisión I. */
export function useRevisionUi(): InstantaneaRevision {
  const [, forzar] = useState(0);
  useEffect(() => suscribirRevision(() => { forzar((n) => n + 1); }), []);
  return obtenerInstantanea();
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
  const emitir = (): void => {
    temporizadorModelo = undefined;
    if (ui.editando) { temporizadorModelo = setTimeout(emitir, 1000); return; }
    if (acumuladas > 0 && anunciarModelo !== null) poner({ anuncio: anunciarModelo(acumuladas) });
    acumuladas = 0;
    ultimoAnuncioModelo = Date.now();
  };
  if (temporizadorModelo !== undefined) return;
  temporizadorModelo = setTimeout(emitir, Math.max(0, 5000 - (Date.now() - ultimoAnuncioModelo)));
}

// Cambios del almacén único: quien aplica una acción (esta pantalla, PC-2 con `incorporar_modelo`, PC-4, PC-5) deja el estado
// nuevo en documento.ts. Aquí se detecta lo que llegó del modelo (marca NUEVA y anuncio M-166) y se limpia lo que ya no existe.
let ultimo: ReviewState | null = null;
function alCambiarDocumento(): void {
  const actual = obtenerRevision();
  const previo = ultimo;
  ultimo = actual;
  if (actual === null || previo === null || previo.docId !== actual.docId) {
    if (temporizadorModelo !== undefined) { clearTimeout(temporizadorModelo); temporizadorModelo = undefined; }
    acumuladas = 0;
    ui = VACIA;
    avisar();
    return;
  }
  if (actual === previo) { avisar(); return; }
  let nuevas = ui.nuevas;
  let llegadas = 0;
  if (Object.keys(actual.detections).length > Object.keys(previo.detections).length) {
    const conjunto = new Set<DetectionId>();
    for (const id of Object.keys(actual.detections) as DetectionId[]) {
      if (previo.detections[id] === undefined && actual.detections[id]?.source === 'modelo') conjunto.add(id);
    }
    if (conjunto.size > 0) { nuevas = conjunto; llegadas = conjunto.size; }
  }
  const seleccion = ui.seleccion !== null && actual.detections[ui.seleccion] === undefined ? null : ui.seleccion;
  ui = { ...ui, nuevas, seleccion };
  if (llegadas > 0) programarAnuncioDelModelo(llegadas);
  avisar();
}
suscribirDocumento(alCambiarDocumento);
registrarLimpieza(() => {
  if (temporizadorModelo !== undefined) { clearTimeout(temporizadorModelo); temporizadorModelo = undefined; }
  ui = VACIA;
  ultimo = null;
  avisar();
});

function contexto(): ReviewContext | null {
  const doc = obtenerDocumento();
  if (doc === null) return null;
  const tabla = obtenerTabla();
  const byKey: Record<string, string> = {};
  if (tabla !== null) for (const e of Object.values(tabla.entries)) byKey[e.canonicalKey] = e.marker;
  const table: TableIndex = { byKey, counters: tabla === null ? {} : { ...tabla.counters }, documentCount: tabla === null ? 0 : tabla.documents.length };
  return { table, caseList: obtenerListaDelCaso(), doc, ids: cryptoIds };
}

/**
 * Despacha una acción al reductor (6.4.4). Con éxito guarda el estado nuevo en documento.ts (`revision` sube en 1, INV-R08); con
 * error deja el estado como estaba y deja el código en `error` (la pantalla lo muestra con 8.5.5). No mueve el foco ni la selección.
 */
export function despachar(accion: ReviewAction): ReviewOutcome {
  const ctx = contexto();
  const antes = obtenerRevision();
  if (ctx === null || antes === null) return { ok: false, code: 'NO_ENCONTRADO' };
  const r = applyReviewAction(antes, accion, ctx);
  if (!r.ok) { poner({ error: r.code }); return r; }
  if (r.state === antes) return r;
  if (ui.error !== null) ui = { ...ui, error: null };
  fijarRevision(r.state);
  return r;
}

export function anunciar(texto: string): void {
  poner({ anuncio: texto });
}
export function limpiarError(): void {
  if (ui.error !== null) poner({ error: null });
}
export function cambiarVista(vista: VistaRevision): void {
  if (ui.vista !== vista) poner({ vista });
}
export function marcarEdicion(activa: boolean): void {
  if (ui.editando !== activa) poner({ editando: activa });
}
/** Abre el campo de edición del reemplazo de una mención (selecciona la mención). */
export function solicitarEdicion(id: DetectionId): void {
  const nuevas = new Set(ui.nuevas);
  nuevas.delete(id);
  poner({ seleccion: id, entidadSeleccion: null, edicion: id, nuevas });
}
export function terminarEdicion(): void {
  if (ui.edicion !== null || ui.editando) poner({ edicion: null, editando: false });
}
/** `textoVisible` (F3, M-142): lo que el diálogo muestra en lugar del original, cuando la selección viene de la vista previa. */
export function solicitarReemplazo(span: Span | null, propagar = false, textoVisible: string | null = null): void {
  poner({ reemplazo: span, propagarReemplazo: propagar, reemplazoTexto: textoVisible });
}

/** Selecciona una mención (abre su ficha), despliega su entidad en la cuadrícula y la quita de las recién llegadas. */
export function seleccionar(id: DetectionId | null): void {
  const nuevas = new Set(ui.nuevas);
  const expandidas = new Set(ui.expandidas);
  if (id !== null) {
    nuevas.delete(id);
    const d = obtenerRevision()?.detections[id];
    if (d !== undefined) expandidas.add(d.entityId);
  }
  poner({ seleccion: id, nuevas, expandidas, entidadSeleccion: id === null ? ui.entidadSeleccion : null, edicion: id === ui.edicion ? ui.edicion : null });
}
export function seleccionarEntidad(id: EntityId | null): void {
  poner({ entidadSeleccion: id, seleccion: null });
}
export function alternarExpandida(id: EntityId, abierta?: boolean): void {
  const nuevas = new Set(ui.expandidas);
  const quiere = abierta ?? !nuevas.has(id);
  if (quiere) nuevas.add(id); else nuevas.delete(id);
  poner({ expandidas: nuevas });
}
export function pedirEnfoque(tipo: 'resaltado' | 'fila', id: string): void {
  poner({ enfoque: { tipo, id, n: ++peticiones } });
}
export function consumirEnfoque(n: number): void {
  if (ui.enfoque !== null && ui.enfoque.n === n) ui = { ...ui, enfoque: null };
}

let recorrido: ((direccion: 1 | -1) => DetectionId | null) | null = null;
/** PC-4 registra el recorrido que incluye las banderas sin confirmar; mientras no, `irAPendiente` recorre solo detecciones. */
export function registrarRecorrido(f: (direccion: 1 | -1) => DetectionId | null): void {
  recorrido = f;
}

/** Ir a la siguiente (1) o anterior (-1) detección pendiente: selecciona, expande su entidad y pide el foco. */
export function irAPendiente(direccion: 1 | -1): DetectionId | null {
  if (recorrido !== null) return recorrido(direccion);
  const st = obtenerRevision();
  if (st === null) return null;
  const id = pendienteAdyacente(st, ui.seleccion, direccion);
  if (id === null) return null;
  irA(id);
  return id;
}
/** Selecciona una mención, despliega su entidad y pide el foco en el resaltado (monta el bloque si hace falta, 8.8). */
export function irA(id: DetectionId, destino: 'resaltado' | 'fila' = 'resaltado'): void {
  const d = obtenerRevision()?.detections[id];
  if (d === undefined) return;
  const expandidas = new Set(ui.expandidas);
  expandidas.add(d.entityId);
  const nuevas = new Set(ui.nuevas);
  nuevas.delete(id);
  ui = { ...ui, seleccion: id, entidadSeleccion: null, expandidas, nuevas, vista: 'original', enfoque: { tipo: destino, id, n: ++peticiones } };
  avisar();
}

export function pendientesDelDocumento(): number {
  const st = obtenerRevision();
  return st === null ? 0 : pendientesTotales(st);
}
