// Orquestación del análisis (8.1, 6.11.2): «Analizar» envía `detectar` al worker `detect`; en cuanto responde con reglas y lista
// se crea el ReviewState con el modelo en curso (o en plan B) y se pasa a Revisión sin esperar al modelo. El modelo sigue por
// ventanas (puerto `ner`): cada una pasa por `fusionar` y entra a la revisión como `incorporar_modelo`.
// El worker `detect` vive hasta que se descarta el documento o se vacía el estado [M] (INV-G09). Nada de esto lleva texto
// del documento a un mensaje: los errores son solo `ErrorCode`.
import { useEffect, useState } from 'preact/hooks';
import { cryptoIds, emptyTable, tableIndexOf } from '../core/entities.ts';
import type { ReviewContext } from '../core/entities.ts';
import { declararPlanB, incorporarModelo, modeloInicial } from '../core/review/modelo.ts';
import type {
  AsuntoId, CaseEntity, DetectOptions, DetectResult, DetectionSet, DocumentModel, ErrorCode, IdSource, MappingTable, NerSpan, PartId,
  PlanBCause, ProgressUnit, RequestId, ReviewState, Stage,
} from '../core/types.ts';
import type { WorkerIo } from '../io/io-client.ts';
import { renovarActividad } from './bloqueo.ts';
import { actualizarBorrador, fijarDocumento, fijarRevision, obtenerDocumento, obtenerRevision, vaciarDocumento } from './documento.ts';
import { actualizar, ir } from './estado.ts';
import { obtenerListaDelCaso, obtenerTabla, registrarLimpieza } from './sesion.ts';
import { puertos, type NerPuerto } from './servicios.ts';

export const ORDEN_ETAPAS: readonly Stage[] = ['lectura', 'reglas', 'lista', 'generalizacion', 'modelo_carga', 'modelo', 'fusion'];
export type EstadoEtapa = 'pendiente' | 'en_curso' | 'terminada' | 'omitida';
export interface Etapa { etapa: Stage; estado: EstadoEtapa; hecho: number; total: number; unidad: ProgressUnit }
export interface VistaAnalisis {
  activo: boolean;
  etapas: Etapa[];
  cancelando: boolean;
  /** La pestaña estuvo oculta durante el análisis (M-62). */
  estuvoOculta: boolean;
  /** Bloques del modelo y duración de la ventana de calentamiento, cuando `ner` los informó (M-164). */
  modelo: { ventanasTotales: number; calentamientoMs: number } | null;
  /** El modelo correrá en segundo plano. */
  conModelo: boolean;
}

/** Tiempo para que el worker confirme una cancelación antes de terminarlo (6.11.6). */
export const ESPERA_CANCELACION_MS = 2000;

const etapasIniciales = (conModelo: boolean): Etapa[] => ORDEN_ETAPAS.map((etapa): Etapa => ({
  etapa,
  estado: etapa === 'lectura' ? 'terminada' : etapa === 'reglas' ? 'en_curso' : (etapa === 'modelo_carga' || etapa === 'modelo') ? (conModelo ? 'en_curso' : 'omitida') : 'pendiente',
  hecho: etapa === 'lectura' ? 1 : 0,
  total: etapa === 'lectura' ? 1 : 0,
  unidad: 'partes',
}));
const vistaInicial = (): VistaAnalisis => ({ activo: false, etapas: etapasIniciales(false), cancelando: false, estuvoOculta: false, modelo: null, conModelo: false });

let vista: VistaAnalisis = vistaInicial();
const oyentes = new Set<() => void>();
let pendientePintar = false;
function avisar(): void {
  // Se pinta como mucho una vez por cuadro (8.8, «Progreso»).
  if (pendientePintar) return;
  pendientePintar = true;
  const pintar = (): void => { pendientePintar = false; for (const o of [...oyentes]) o(); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(pintar);
  else setTimeout(pintar, 0);
}
function avisarYa(): void {
  for (const o of [...oyentes]) o();
}
export function obtenerVistaAnalisis(): VistaAnalisis {
  return vista;
}
export function useAnalisis(): VistaAnalisis {
  const [, forzar] = useState(0);
  useEffect(() => {
    const f = (): void => { forzar((n) => n + 1); };
    oyentes.add(f);
    return () => { oyentes.delete(f); };
  }, []);
  return vista;
}

// --- Worker `detect` -------------------------------------------------------------------------------------------------------

export function crearWorkerDetect(): WorkerIo {
  return new Worker(new URL('../workers/detect.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerIo;
}

interface Sesion {
  worker: WorkerIo;
  sessionId: string;
  ids: IdSource;
  /** Respuestas pendientes por reqId. */
  esperas: Map<string, (m: Record<string, unknown>) => void>;
  reqDetectar: string | null;
  ner: { cancelar(): void } | null;
  /** Temporizador de la cancelación (terminar si no responde en 2 s). */
  temporizador: ReturnType<typeof setTimeout> | undefined;
  /** Las ventanas se entregan en orden. */
  cola: Promise<void>;
}
let sesion: Sesion | null = null;

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const CODIGO = /^[A-Z][A-Z_]{2,40}$/u;

function liberarSesion(): void {
  const s = sesion;
  sesion = null;
  if (s === null) return;
  if (s.temporizador !== undefined) clearTimeout(s.temporizador);
  s.ner?.cancelar();
  s.worker.onmessage = null;
  s.worker.onerror = null;
  s.worker.onmessageerror = null;
  s.worker.terminate();
}

/** Fecha del día en America/Bogota (UTC-5 sin horario de verano), `AAAA-MM-DD` (6.11.2). */
export function fechaDeReferencia(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

export const OPCIONES_DETECCION = { rulesVersion: '1.0.0', nerHighThreshold: 0.9, nerMinScore: 0.3 } as const;

const tablaDelAsunto = (): MappingTable => obtenerTabla() ?? emptyTable('asu_' as AsuntoId);

function contextoDelReductor(doc: DocumentModel, ids: IdSource): ReviewContext {
  return { table: tableIndexOf(tablaDelAsunto()), caseList: obtenerListaDelCaso() as readonly CaseEntity[], doc, ids };
}

/** ReviewState inicial a partir del conjunto de reglas y lista (6.4.4); el orden es (part.order, start). */
export function estadoDeConjunto(doc: DocumentModel, set: DetectionSet, modelo: ReviewState['modelo']): ReviewState {
  const orden = new Map(doc.parts.map((p) => [p.id as string, p.order]));
  const ordenadas = [...set.detections].sort((a, b) =>
    ((orden.get(a.partId) ?? 0) - (orden.get(b.partId) ?? 0)) || (a.start - b.start) || (a.end - b.end));
  return {
    docId: doc.id,
    revision: 0,
    detections: Object.fromEntries(set.detections.map((d) => [d.id, d])),
    order: ordenadas.map((d) => d.id),
    entities: Object.fromEntries(set.entities.map((e) => [e.id, e])),
    suggestions: Object.fromEntries(set.suggestions.map((x) => [x.id, x])),
    flags: Object.fromEntries(set.flags.map((f) => [f.id, f])),
    spanEdits: Object.fromEntries((set.spanEdits ?? []).map((x) => [x.id, x])),
    committed: false,
    modelo,
  };
}

function esperar(s: Sesion, kind: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const reqId = s.ids.next('req') as RequestId;
    s.esperas.set(reqId, (m) => {
      s.esperas.delete(reqId);
      if (m.kind === 'error') reject(new Error(typeof m.code === 'string' && CODIGO.test(m.code) ? m.code : 'ERROR_INTERNO'));
      else resolve(m);
    });
    try {
      s.worker.postMessage({ v: 1, reqId, kind, payload }, []);
    } catch {
      s.esperas.delete(reqId);
      reject(new Error('ERROR_INTERNO'));
    }
  });
}

// --- Progreso --------------------------------------------------------------------------------------------------------------

function alProgreso(stage: Stage, done: number, total: number, unit: ProgressUnit): void {
  const i = ORDEN_ETAPAS.indexOf(stage);
  if (i < 0) return;
  const etapas = vista.etapas.map((e, j): Etapa => {
    if (j < i && e.estado !== 'omitida' && e.etapa !== 'modelo_carga' && e.etapa !== 'modelo') return { ...e, estado: 'terminada' };
    if (j === i) return { etapa: stage, hecho: done, total, unidad: unit, estado: total > 0 && done >= total ? 'terminada' : 'en_curso' };
    return e;
  });
  vista = { ...vista, etapas };
  renovarActividad();
  avisar();
}

// --- Inicio y fin ----------------------------------------------------------------------------------------------------------

export interface IniciarOpciones {
  doc: DocumentModel;
  /** El abogado marcó «Usar el modelo de apoyo». */
  usarModelo: boolean;
  crearWorker?: () => WorkerIo;
  ids?: IdSource;
  ahora?: () => Date;
  /** Puerto del modelo; por defecto el instalado (PF-2). */
  ner?: NerPuerto | null;
}

function cambiarVista(parche: Partial<VistaAnalisis>): void {
  vista = { ...vista, ...parche };
  avisarYa();
}

/** Vuelve a Entrada con un error (solo el código) o con la cancelación (M-61). El texto se conserva. */
function volverAEntrada(motivo: { error: ErrorCode } | { cancelado: true }): void {
  liberarSesion();
  vaciarDocumento();
  vista = vistaInicial();
  avisarYa();
  actualizarBorrador({ analisisCancelado: 'cancelado' in motivo, errorLectura: null });
  ir('entrada');
  actualizar('error' in motivo
    ? { phase: 'error', modelRun: null, error: { code: motivo.error, context: 'procesando' } }
    : { phase: 'vacio', modelRun: null, error: null });
}

/** Arranca el análisis del documento ya leído y pasa a Procesando. */
export function iniciarAnalisis(o: IniciarOpciones): void {
  liberarSesion();
  const ids = o.ids ?? cryptoIds;
  const ner = o.ner === undefined ? puertos.ner : o.ner;
  const modeloListo = puertos.modelo.disponible() && puertos.modelo.estado().state === 'listo';
  const conModelo = o.usarModelo && modeloListo && ner !== null;
  fijarDocumento(o.doc);
  fijarRevision(null);
  actualizarBorrador({ analisisCancelado: false, errorLectura: null });
  vista = { activo: true, etapas: etapasIniciales(conModelo), cancelando: false, estuvoOculta: false, modelo: null, conModelo };
  actualizar({ phase: 'procesando', error: null, modelRun: null });
  ir('procesando');
  avisarYa();

  let worker: WorkerIo;
  try {
    worker = (o.crearWorker ?? crearWorkerDetect)();
  } catch {
    volverAEntrada({ error: 'ERROR_INTERNO' });
    return;
  }
  const s: Sesion = {
    worker, sessionId: ids.next('req'), ids, esperas: new Map(), reqDetectar: null, ner: null, temporizador: undefined, cola: Promise.resolve(),
  };
  sesion = s;
  worker.onmessage = (ev): void => { alMensaje(s, ev.data); };
  worker.onerror = (ev): void => { ev.preventDefault(); if (sesion === s) volverAEntrada({ error: 'ERROR_INTERNO' }); };
  worker.onmessageerror = (ev): void => { ev.preventDefault(); if (sesion === s) volverAEntrada({ error: 'ERROR_INTERNO' }); };

  const reqId = ids.next('req');
  s.reqDetectar = reqId;
  const options: DetectOptions = { referenceDate: fechaDeReferencia((o.ahora ?? ((): Date => new Date()))()), ...OPCIONES_DETECCION };
  s.esperas.set(reqId, (m) => {
    s.esperas.delete(reqId);
    if (sesion !== s) return;
    if (m.kind === 'error') {
      volverAEntrada({ error: typeof m.code === 'string' && CODIGO.test(m.code) ? (m.code as ErrorCode) : 'ERROR_INTERNO' });
      return;
    }
    // El abogado pidió cancelar y el resultado llegó antes que la confirmación: se respeta la cancelación.
    if (m.kind === 'cancelado' || vista.cancelando) { volverAEntrada({ cancelado: true }); return; }
    const p = m.payload;
    if (m.kind !== 'resultado' || !esObjeto(p) || p.kind !== 'detectar' || !esObjeto(p.set)) { volverAEntrada({ error: 'ERROR_INTERNO' }); return; }
    alTerminarReglas(s, o.doc, (p as unknown as Extract<DetectResult, { kind: 'detectar' }>).set, { conModelo, ner, usarModelo: o.usarModelo });
  });
  try {
    worker.postMessage({
      v: 1, reqId, kind: 'detectar',
      payload: {
        sessionId: s.sessionId, doc: o.doc, caseList: [...obtenerListaDelCaso()], table: tableIndexOf(tablaDelAsunto()), options,
      },
    }, []);
  } catch {
    volverAEntrada({ error: 'ERROR_INTERNO' });
  }
}

function alMensaje(s: Sesion, data: unknown): void {
  if (sesion !== s || !esObjeto(data) || data.v !== 1 || typeof data.reqId !== 'string') return;
  if (data.kind === 'progreso' && data.reqId === s.reqDetectar) {
    if (typeof data.stage === 'string' && typeof data.done === 'number' && typeof data.total === 'number') {
      alProgreso(data.stage as Stage, data.done, data.total, (typeof data.unit === 'string' ? data.unit : 'partes') as ProgressUnit);
    }
    return;
  }
  const espera = s.esperas.get(data.reqId);
  if (espera !== undefined && (data.kind === 'resultado' || data.kind === 'error' || data.kind === 'cancelado')) espera(data);
}

interface DecisionModelo { conModelo: boolean; ner: NerPuerto | null; usarModelo: boolean }

/** `detect` respondió: se crea la revisión con el modelo en curso (o plan B) y se pasa a Revisión (8.3). */
function alTerminarReglas(s: Sesion, doc: DocumentModel, set: DetectionSet, d: DecisionModelo): void {
  const causa: PlanBCause = d.usarModelo ? 'no_descargado' : 'desactivado';
  const modelo = d.conModelo ? modeloInicial(false) : { kind: 'plan_b' as const, causa };
  const estado = estadoDeConjunto(doc, set, modelo);
  fijarRevision(estado);
  renovarActividad(true);
  if (s.temporizador !== undefined) { clearTimeout(s.temporizador); s.temporizador = undefined; }
  vista = {
    ...vista,
    activo: false,
    etapas: vista.etapas.map((e): Etapa => (e.etapa === 'modelo_carga' || e.etapa === 'modelo' || e.estado === 'omitida' ? e : { ...e, estado: 'terminada' })),
  };
  avisarYa();
  actualizar({ phase: 'revision', error: null, modelRun: estado.modelo });
  ir('revision');
  if (d.conModelo && d.ner !== null) {
    iniciarModelo(s, doc, d.ner);
  } else {
    // Sin modelo no hay más ventanas: se cierra la fusión y se libera la sesión de `detect`.
    s.cola = s.cola
      .then(() => esperar(s, 'fusionar', { sessionId: s.sessionId, ner: null, nerEngineId: 'nulo' }))
      .then(() => esperar(s, 'liberar', { sessionId: s.sessionId }))
      .then(() => undefined, () => undefined);
  }
}

// --- Modelo en segundo plano -----------------------------------------------------------------------------------------------

function ponerRevision(r: ReviewState): void {
  fijarRevision(r);
  actualizar({ modelRun: r.modelo });
}

/** Cierra la fusión (`ner: null`), declara el plan B si el modelo seguía en curso y libera la sesión. */
async function cerrarEnPlanB(s: Sesion, doc: DocumentModel, causa: PlanBCause): Promise<void> {
  if (sesion !== s) return;
  try {
    await esperar(s, 'fusionar', { sessionId: s.sessionId, ner: null, nerEngineId: 'nulo' });
  } catch { /* la sesión ya no existe: no hay más que cerrar */ }
  const vigente = obtenerRevision();
  if (vigente !== null && vigente.modelo.kind === 'en_curso') {
    const r = declararPlanB(vigente, causa, contextoDelReductor(doc, s.ids));
    if (r.ok) ponerRevision(r.state);
  }
  await esperar(s, 'liberar', { sessionId: s.sessionId }).then(() => undefined, () => undefined);
}

function iniciarModelo(s: Sesion, doc: DocumentModel, ner: NerPuerto): void {
  let ultimoTotal = 0;
  const encadenar = (tarea: () => Promise<void>): void => {
    s.cola = s.cola.then(tarea).then(() => undefined, () => undefined);
  };
  s.ner = ner.iniciar(doc, {
    alTotal: (total, calentamientoMs) => {
      ultimoTotal = total;
      cambiarVista({ modelo: { ventanasTotales: total, calentamientoMs } });
    },
    alVentana: (v) => {
      encadenar(async () => {
        if (sesion !== s) return;
        const total = v.ventanasTotales > 0 ? v.ventanasTotales : ultimoTotal;
        const m = await esperar(s, 'fusionar', {
          sessionId: s.sessionId, ner: v.ner as Record<PartId, NerSpan[]>, nerEngineId: v.engineId, ventana: v.ventana, ventanasTotales: total,
        });
        const p = m.payload;
        if (sesion !== s || !esObjeto(p) || p.kind !== 'fusionar' || !esObjeto(p.set)) return;
        const actual = obtenerRevision();
        if (actual === null) return;
        const r = incorporarModelo(actual, v.ventana, total, p.set as unknown as DetectionSet, contextoDelReductor(doc, s.ids));
        if (r.ok) ponerRevision(r.state);
      });
    },
    alTerminar: () => {
      encadenar(async () => {
        if (sesion !== s) return;
        await esperar(s, 'liberar', { sessionId: s.sessionId }).then(() => undefined, () => undefined);
      });
    },
    alFallar: (causa) => { encadenar(() => cerrarEnPlanB(s, doc, causa)); },
  });
}

/**
 * «Seguir sin el modelo» (8.1, PC-4): cancela `ner`, cierra la fusión con `null` y declara el plan B (`cancelado`).
 * Las ventanas ya incorporadas se conservan.
 */
export function seguirSinModelo(): void {
  const s = sesion;
  const doc = obtenerDocumento();
  if (s === null || doc === null) return;
  s.ner?.cancelar();
  s.ner = null;
  s.cola = s.cola.then(() => cerrarEnPlanB(s, doc, 'cancelado')).then(() => undefined, () => undefined);
}

// --- Cancelación -----------------------------------------------------------------------------------------------------------

/** «Cancelar análisis»: cancelación cooperativa; si el worker no confirma en 2 s se termina (6.11.6). */
export function cancelarAnalisis(): void {
  const s = sesion;
  if (s === null || !vista.activo || vista.cancelando) return;
  cambiarVista({ cancelando: true });
  s.ner?.cancelar();
  const objetivo = s.reqDetectar;
  if (objetivo !== null) {
    try {
      s.worker.postMessage({ v: 1, reqId: s.ids.next('req'), kind: 'cancelar', payload: { targetReqId: objetivo } }, []);
    } catch { /* se termina abajo */ }
  }
  s.temporizador = setTimeout(() => { if (sesion === s) volverAEntrada({ cancelado: true }); }, ESPERA_CANCELACION_MS);
}

/** Descartar el documento (Revisión → Entrada, 8.1): borra el DocumentModel y el ReviewState y libera el worker. */
export function descartarAnalisis(): void {
  liberarSesion();
  vaciarDocumento();
  vista = vistaInicial();
  avisarYa();
  actualizar({ phase: 'vacio', modelRun: null });
}

registrarLimpieza(() => {
  liberarSesion();
  vista = vistaInicial();
  avisarYa();
});

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && vista.activo && !vista.estuvoOculta) cambiarVista({ estuvoOculta: true });
  });
}

// --- Cliente mínimo de la pasada 3 de residuos (7.13.5; acuerdo F-13 aprobado por el integrador, PC-5) ----------------------------
// La pantalla Listo necesita `ctx.detect` de `runResidueCheck`: ida y vuelta al worker `detect` con las secciones de la salida como
// partes de un documento temporal. Reutiliza el worker de la sesión de análisis si sigue vivo (INV-G09: se libera con el documento)
// y, si ya no existe, abre uno propio que termina al acabar. Cada llamada usa su propio `sessionId`: `detectar` → `fusionar` con
// `ner: null` → `liberar`. Solo viajan las secciones de la salida (marcadores y texto no reemplazado) y la lista del caso; los
// errores salen únicamente como `ErrorCode`.
const ESPERA_RESIDUOS_MS = 60_000;

export function detectarEnSalida(tmp: DocumentModel): Promise<DetectionSet> {
  const existente = sesion;
  let propio: WorkerIo | null = null;
  let s: Sesion;
  if (existente !== null) {
    s = existente;
  } else {
    const worker = crearWorkerDetect();
    propio = worker;
    const temporal: Sesion = {
      worker, sessionId: cryptoIds.next('req'), ids: cryptoIds, esperas: new Map(), reqDetectar: null, ner: null, temporizador: undefined, cola: Promise.resolve(),
    };
    const fallar = (): void => {
      for (const [id, espera] of [...temporal.esperas]) { temporal.esperas.delete(id); espera({ kind: 'error', code: 'ERROR_INTERNO' }); }
    };
    worker.onmessage = (ev): void => {
      const d = ev.data as unknown;
      if (!esObjeto(d) || d.v !== 1 || typeof d.reqId !== 'string') return;
      const espera = temporal.esperas.get(d.reqId);
      if (espera !== undefined && (d.kind === 'resultado' || d.kind === 'error' || d.kind === 'cancelado')) espera(d);
    };
    worker.onerror = (ev): void => { ev.preventDefault(); fallar(); };
    worker.onmessageerror = (ev): void => { ev.preventDefault(); fallar(); };
    s = temporal;
  }
  const sessionId = s.ids.next('req');
  const terminar = (): void => {
    if (propio !== null) { propio.onmessage = null; propio.onerror = null; propio.onmessageerror = null; propio.terminate(); propio = null; }
  };
  const trabajo = (async (): Promise<DetectionSet> => {
    const options: DetectOptions = { referenceDate: fechaDeReferencia(), ...OPCIONES_DETECCION };
    try {
      await esperar(s, 'detectar', { sessionId, doc: tmp, caseList: [...obtenerListaDelCaso()], table: tableIndexOf(tablaDelAsunto()), options });
      const m = await esperar(s, 'fusionar', { sessionId, ner: null, nerEngineId: 'nulo' });
      const p = m.payload;
      if (!esObjeto(p) || p.kind !== 'fusionar' || !esObjeto(p.set)) throw new Error('ERROR_INTERNO');
      return p.set as unknown as DetectionSet;
    } finally {
      await esperar(s, 'liberar', { sessionId }).then(() => undefined, () => undefined);
    }
  })();
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rechazar) => { reloj = setTimeout(() => { rechazar(new Error('TIEMPO_AGOTADO')); }, ESPERA_RESIDUOS_MS); });
  return Promise.race([trabajo, limite]).finally(() => { if (reloj !== undefined) clearTimeout(reloj); terminar(); });
}
