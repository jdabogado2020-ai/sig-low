// Puerto `modelo` (PF-2, 3.3 y 8.2.2): descarga a pedido con respaldo automático, estado de la tarjeta del modelo y manifiestos.
// La interfaz habla con `ModeloPuerto` (servicios.ts); aquí está su implementación real, que conecta la decisión pura de
// src/core/ner/entrega.ts con el service worker. Esta página no llama a `fetch`: el service worker trae cada archivo del
// manifiesto (uno por mensaje), lo comprueba y lo guarda; la página solo manda mensajes MODELO_* con un puerto de respuesta,
// que llevan ids y rutas del manifiesto, nunca contenido.
import {
  decidirFallo, entregarModelo, type PuertosEntrega, type ResultadoEntrega,
} from '../core/ner/entrega.ts';
import { esManifiesto, IDS_MODELO, mbDelManifiesto, validarEntrega, type IdModelo } from '../core/ner/manifest.ts';
import { SiglowError, type ErrorCode, type ModelManifest } from '../core/types.ts';
import { actualizar } from './estado.ts';
import type { ModelUiState, ModelVariant } from './estado.ts';
import type { ModeloPuerto } from './servicios.ts';

/** Si el service worker no responde en este tiempo (se detuvo a mitad de un archivo), la descarga falla y se puede reintentar. */
const SILENCIO_MAXIMO_MS = 120_000;

type Respuesta = { ok: true; [k: string]: unknown } | { ok: false; code?: unknown; cancelado?: unknown };

/** Un mensaje al service worker que controla la página y su respuesta. `alAvance` recibe los bytes ya recibidos del archivo. */
function pedirSw(msg: Record<string, unknown>, alAvance?: (bytes: number) => void): Promise<Respuesta> {
  return new Promise((ok, mal) => {
    const sw = typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker.controller : null;
    if (!sw) {
      mal(new SiglowError('SIN_SERVICE_WORKER'));
      return;
    }
    const canal = new MessageChannel();
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const armar = (): void => {
      clearTimeout(reloj);
      reloj = setTimeout(() => { canal.port1.close(); mal(new SiglowError('MODELO_NO_DESCARGADO')); }, SILENCIO_MAXIMO_MS);
    };
    canal.port1.onmessage = (ev: MessageEvent<unknown>): void => {
      const d = ev.data as { tipo?: unknown; bytes?: unknown; ok?: unknown } | null;
      armar();
      if (d && d.tipo === 'avance' && typeof d.bytes === 'number') {
        alAvance?.(d.bytes);
        return;
      }
      clearTimeout(reloj);
      canal.port1.close();
      if (d && typeof d === 'object' && typeof d.ok === 'boolean') ok(d as Respuesta);
      else mal(new SiglowError('ERROR_INTERNO'));
    };
    armar();
    try {
      sw.postMessage(msg, [canal.port2]);
    } catch {
      clearTimeout(reloj);
      mal(new SiglowError('ERROR_INTERNO'));
    }
  });
}

const CODIGOS: ReadonlySet<string> = new Set(['MODELO_INTEGRIDAD', 'CUOTA_EXCEDIDA', 'MODELO_NO_DESCARGADO', 'MEMORIA', 'ENTRADA_INVALIDA', 'SIN_SERVICE_WORKER']);
const falla = (r: Respuesta): SiglowError => new SiglowError(!r.ok && typeof r.code === 'string' && CODIGOS.has(r.code) ? (r.code as ErrorCode) : 'ERROR_INTERNO');

// --- Estado -------------------------------------------------------------------------------------------------------------------

interface Local { state: ModelUiState; variant?: ModelVariant; mb: number | null }
let local: Local = { state: 'no_descargado', mb: null };
const manifiestos = new Map<IdModelo, ModelManifest>();
let instalado: IdModelo | null = null;
let persistido: boolean | null = null;
let preparado = false;
let iniciado = false;
let descarga: AbortController | null = null;

const variantePorId = (id: IdModelo): ModelVariant => (id === 'gliner-x-base' ? 'respaldo' : 'principal');

function fijar(estado: ModelUiState, extra: { variant?: ModelVariant; doneBytes?: number; totalBytes?: number } = {}): void {
  local = { state: estado, ...(extra.variant ? { variant: extra.variant } : {}), mb: local.mb };
  actualizar({ model: { state: estado, ...extra } });
}

/** Memoria del equipo en GB (`navigator.deviceMemory`, solo Chromium y redondeado); null si no se sabe. */
function memoriaDelEquipo(): number | null {
  const m = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof m === 'number' ? m : null;
}

function mbInicial(): number | null {
  const m = manifiestos.get((memoriaDelEquipo() ?? 8) < 8 ? 'gliner-x-base' : 'gliner-x-large');
  return m ? mbDelManifiesto(m) : null;
}

/** Manifiesto del modelo `id` (del precache, verificado por el service worker). */
export async function manifiestoDe(id: IdModelo): Promise<ModelManifest> {
  const antes = manifiestos.get(id);
  if (antes) return antes;
  const r = await pedirSw({ tipo: 'MODELO_MANIFIESTO', id });
  if (!r.ok || !esManifiesto(r['manifest']) || r['manifest'].id !== id || !validarEntrega(r['manifest'])) throw !r.ok ? falla(r) : new SiglowError('ENTRADA_INVALIDA');
  manifiestos.set(id, r['manifest']);
  return r['manifest'];
}

/** Modelo que hay en el equipo (el principal si están los dos), o null. */
export const modeloInstalado = (): IdModelo | null => instalado;
/** Resultado de `navigator.storage.persist()` tras la última descarga (null si no se pidió o no existe). */
export const persistenciaDelModelo = (): boolean | null => persistido;

/** Un modelo guardado resultó inservible al cargarse: se borra de la caché (V-44) y la tarjeta vuelve a ofrecer la descarga. */
export async function descartarModelo(id: IdModelo, estado: 'fallo' | 'no_descargado'): Promise<void> {
  await pedirSw({ tipo: 'MODELO_BORRAR', id }).catch(() => undefined);
  if (instalado === id) instalado = null;
  fijar(estado);
}

/** Primer arranque: manifiestos para el tamaño y qué hay ya guardado (sobrevive a recargar y a cerrar el navegador). */
async function preparar(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return;
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((ok) => {
        const t = setTimeout(ok, 10_000);
        navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); ok(); }, { once: true });
      });
    }
    for (const id of IDS_MODELO) await manifiestoDe(id).catch(() => undefined);
    local = { ...local, mb: mbInicial() };
    for (const id of IDS_MODELO) {
      if (!manifiestos.has(id)) continue;
      const e = await pedirSw({ tipo: 'MODELO_ESTADO', id }).catch(() => null);
      if (e && e.ok && e['completo'] === true) {
        instalado = id;
        break;
      }
    }
    preparado = manifiestos.size > 0;
    if (instalado) fijar('listo', { variant: variantePorId(instalado) });
    else actualizar({ model: { state: local.state } }); // vuelve a pintar la tarjeta con el tamaño real
  } catch {
    // Sin service worker o sin manifiestos: la tarjeta queda con «Descargar» deshabilitado (disponible() = false).
  }
}

function iniciar(): void {
  if (iniciado) return;
  iniciado = true;
  void preparar();
}

// --- Puertos de la decisión pura ----------------------------------------------------------------------------------------------

const puertosEntrega: PuertosEntrega = {
  manifiesto: manifiestoDe,
  async descargarArchivo(id, ruta, onBytes, senal) {
    const alAbortar = (): void => { void pedirSw({ tipo: 'MODELO_CANCELAR' }).catch(() => undefined); };
    senal.addEventListener('abort', alAbortar, { once: true });
    try {
      const r = await pedirSw({ tipo: 'MODELO_ARCHIVO', id, ruta }, onBytes);
      if (!r.ok) throw falla(r);
    } finally {
      senal.removeEventListener('abort', alAbortar);
    }
  },
  async borrar(id) {
    await pedirSw({ tipo: 'MODELO_BORRAR', id });
  },
  async cuota() {
    if (typeof navigator === 'undefined' || typeof navigator.storage?.estimate !== 'function') return null;
    const e = await navigator.storage.estimate();
    return typeof e.quota === 'number' && typeof e.usage === 'number' ? { cuota: e.quota, uso: e.usage } : null;
  },
  async persistir() {
    if (typeof navigator === 'undefined' || typeof navigator.storage?.persist !== 'function') return null;
    return navigator.storage.persist();
  },
};

function desenlace(r: ResultadoEntrega): void {
  switch (r.tipo) {
    case 'listo':
      instalado = r.id;
      persistido = r.persistido;
      fijar('listo', { variant: variantePorId(r.id) });
      return;
    case 'plan_b':
      // Cancelado por el abogado, sin espacio ni para el respaldo (M-169), modelo alterado (M-31) o red caída (M-30).
      if (r.causa === 'cancelado') fijar('no_descargado');
      else if (r.causa === 'espacio') fijar('sin_memoria');
      else fijar('fallo');
      if (r.causa === 'integridad' || r.causa === 'red') throw new SiglowError(r.codigo);
  }
}

export const modeloPuerto: ModeloPuerto = {
  disponible() {
    iniciar();
    return preparado && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker.controller !== null;
  },
  estado() {
    iniciar();
    return { state: local.state, ...(local.variant ? { variant: local.variant } : {}), mb: local.mb };
  },
  async descargar() {
    if (descarga !== null || local.state === 'descargando' || local.state === 'verificando') return;
    const ac = new AbortController();
    descarga = ac;
    fijar('descargando', { doneBytes: 0 });
    try {
      const r = await entregarModelo(puertosEntrega, {
        memoriaGb: memoriaDelEquipo(),
        senal: ac.signal,
        alAvance: (a) => {
          const m = manifiestos.get(a.id);
          if (m) local = { ...local, mb: mbDelManifiesto(m) };
          actualizar({ model: { state: 'descargando', variant: variantePorId(a.id), doneBytes: a.hechoBytes, totalBytes: a.totalBytes } });
        },
      });
      desenlace(r);
    } finally {
      descarga = null;
    }
  },
  cancelar() {
    descarga?.abort();
  },
  async quitar() {
    for (const id of IDS_MODELO) await pedirSw({ tipo: 'MODELO_BORRAR', id }).catch(() => undefined);
    instalado = null;
    persistido = null;
    fijar('no_descargado');
  },
};

/** Para el puerto `ner`: qué hacer ante un fallo de carga (ver `decidirFallo`). Descarta lo alterado y devuelve la decisión. */
export async function alFallarElMotor(id: IdModelo, codigo: ErrorCode): Promise<ReturnType<typeof decidirFallo>> {
  const d = decidirFallo(codigo, id === 'gliner-x-base');
  if (d.descartar) await descartarModelo(id, 'fallo');
  else if (d.causa === 'no_descargado') await descartarModelo(id, 'no_descargado');
  return d;
}

/** ¿Está el respaldo guardado? Lo usa `ner` para reintentar con él si el principal no cabe en memoria al cargar. */
export async function respaldoGuardado(): Promise<boolean> {
  const e = await pedirSw({ tipo: 'MODELO_ESTADO', id: 'gliner-x-base' }).catch(() => null);
  return e !== null && e.ok && e['completo'] === true;
}
