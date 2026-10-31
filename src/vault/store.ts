// Almacén cifrado en IndexedDB (PD-4; plan 6.7.1, 6.7.4, 3.4, V-17, V-18). Guarda solo AsuntoRecord: los campos en claro de
// INV-V01 y el `ct`. Nunca un CryptoKey, nunca localStorage ni sessionStorage (INV-V07). Transacciones con durabilidad
// estricta; QuotaExceededError → CUOTA_EXCEDIDA; índice único de `codigo` o clave repetida → ASUNTO_EXISTENTE.
// `onversionchange` (otra pestaña borra todo o actualiza la base) y `onclose` (cierre forzado: datos del sitio borrados) cierran
// la conexión y avisan a quien se suscribió. Solo crear e importar crean la base; un guardado actualiza un registro que ya existe
// y nunca recrea uno borrado (M-5).
import { SiglowError } from '../core/types.ts';
import type { AsuntoId, AsuntoRecord, ErrorCode, IsoDateTime } from '../core/types.ts';
import { analizarEncabezado } from './crypto.ts';

export const DB_NOMBRE = 'siglow-boveda';
export const DB_VERSION = 1;
export const ALMACEN = 'asuntos';
const CAMPOS = ['asuntoId', 'codigo', 'creado', 'actualizado', 'encabezado', 'iv', 'ct'] as const;

export interface RegistroListado { asuntoId: AsuntoId; codigo: string; creado: IsoDateTime; actualizado: IsoDateTime }

/** La conexión compartida; null dentro de la promesa: la base no existe y no se pidió crearla. */
let conexion: Promise<IDBDatabase | null> | null = null;
let borrando = false;
const alCerrar = new Set<() => void>();

/**
 * Avisa cuando la conexión se cierra sin que esta pestaña lo pida: otra pestaña borra todo o actualiza la base (`versionchange`),
 * o el navegador la cierra a la fuerza (datos del sitio borrados: `close`). Devuelve la baja.
 */
export function alCerrarPorOtraPestana(fn: () => void): () => void {
  alCerrar.add(fn);
  return () => { alCerrar.delete(fn); };
}

function avisarCierre(): void {
  if (!borrando) for (const f of [...alCerrar]) { try { f(); } catch { /* sin contenido */ } }
}

export function idbDisponible(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function codigoDe(e: unknown, porDefecto: ErrorCode): ErrorCode {
  if (e instanceof SiglowError) return e.code;
  const n = typeof e === 'object' && e !== null ? (e as { name?: unknown }).name : undefined;
  if (n === 'QuotaExceededError') return 'CUOTA_EXCEDIDA';
  if (n === 'ConstraintError') return 'ASUNTO_EXISTENTE';
  return porDefecto;
}

/** El rechazo de una operación sin base (ver `abrirBase`): el registro no existe. */
const sinBase = (e: unknown): boolean => e instanceof SiglowError && e.code === 'SESION_DESCONOCIDA';

/**
 * Abre (o reutiliza) la conexión. Con `crear` false, una base que no existe no se crea: se aborta la transacción de versión,
 * que la descarta, y devuelve null. Así «Borrar todo» (aunque haya un guardado en curso) y borrar los datos del sitio no se
 * deshacen con la escritura siguiente (M-5). Solo `agregarRegistro` y `reemplazarRegistros` (crear, pasar a «Guardar cifrada»
 * e importar) piden crearla.
 */
async function abrirBase(crear: boolean): Promise<IDBDatabase | null> {
  if (!idbDisponible()) throw new SiglowError('IDB_NO_DISPONIBLE');
  for (let previa = conexion; previa !== null; previa = conexion) {
    const db = await previa;
    if (db !== null || !crear) return db;
    if (conexion === previa) conexion = null;   // sin base, y esta escritura sí la crea
  }
  const p = new Promise<IDBDatabase | null>((ok, mal) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NOMBRE, DB_VERSION);
    } catch {
      mal(new SiglowError('IDB_NO_DISPONIBLE'));
      return;
    }
    let descartada = false;
    req.onupgradeneeded = (ev) => {
      if (ev.oldVersion === 0 && !crear) {
        descartada = true;
        req.transaction?.abort();
        return;
      }
      const db = req.result;
      if (!db.objectStoreNames.contains(ALMACEN)) {
        const s = db.createObjectStore(ALMACEN, { keyPath: 'asuntoId', autoIncrement: false });
        s.createIndex('por_codigo', 'codigo', { unique: true });
        s.createIndex('por_actualizado', 'actualizado', { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        if (conexion === p) conexion = null;
        avisarCierre();
      };
      db.onclose = () => {
        if (conexion === p) conexion = null;
        avisarCierre();
      };
      ok(db);
    };
    req.onerror = (ev) => {
      ev.preventDefault();
      if (descartada) ok(null);
      else mal(new SiglowError('IDB_NO_DISPONIBLE'));
    };
  });
  conexion = p;
  p.then((db) => { if (db === null && conexion === p) conexion = null; }, () => { if (conexion === p) conexion = null; });
  return p;
}

interface Control {
  /** Un error de esta petición aborta la transacción con su código (cuota, índice único). */
  vigilar<R>(req: IDBRequest<R>): IDBRequest<R>;
  /** Aborta la transacción con este código. */
  abortar(codigo: ErrorCode): void;
}

/**
 * Una transacción: resuelve al completarse (no al terminar la petición), con durabilidad estricta. Sin base y sin `crear`
 * → SESION_DESCONOCIDA, sin crear nada.
 */
async function transaccion<T>(
  modo: IDBTransactionMode, paso: (s: IDBObjectStore, ctl: Control) => IDBRequest<T> | void, error: ErrorCode, crear: boolean,
): Promise<T | undefined> {
  const db = await abrirBase(crear);
  if (db === null) throw new SiglowError('SESION_DESCONOCIDA');
  return new Promise<T | undefined>((ok, mal) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(ALMACEN, modo, { durability: 'strict' });
    } catch (e) {
      mal(new SiglowError(codigoDe(e, error)));
      return;
    }
    let resultado: T | undefined;
    let fallo: unknown = null;
    const abortar = (e: unknown): void => {
      fallo ??= e;
      try { tx.abort(); } catch { /* ya terminada */ }
    };
    const ctl: Control = {
      vigilar: (req) => {
        req.onerror = (ev) => { ev.preventDefault(); abortar(req.error); };
        return req;
      },
      abortar: (codigo) => { abortar(new SiglowError(codigo)); },
    };
    try {
      const req = paso(tx.objectStore(ALMACEN), ctl);
      if (req) {
        ctl.vigilar(req);
        req.onsuccess = () => { resultado = req.result; };
      }
    } catch (e) {
      abortar(e);
    }
    tx.oncomplete = () => { ok(resultado); };
    tx.onabort = () => { mal(new SiglowError(codigoDe(fallo ?? tx.error, error))); };
    tx.onerror = (ev) => { ev.preventDefault(); };
  });
}

/** Solo los campos de 6.7.1, en su orden; `iv` y `ct` como ArrayBuffer propios. */
function registroLimpio(r: AsuntoRecord): AsuntoRecord {
  if (!(r.iv instanceof ArrayBuffer) || !(r.ct instanceof ArrayBuffer)) throw new SiglowError('ENTRADA_INVALIDA');
  return { asuntoId: r.asuntoId, codigo: r.codigo, creado: r.creado, actualizado: r.actualizado, encabezado: r.encabezado, iv: r.iv, ct: r.ct };
}

/** Lectura cruda validada en forma (sin descifrar): un registro con otra forma se trata como alterado. */
function registroLeido(x: unknown): AsuntoRecord | null {
  if (x === undefined || x === null) return null;
  const o = x as Record<string, unknown>;
  const forma = typeof o === 'object' && Object.keys(o).length === CAMPOS.length && CAMPOS.every((c) => c in o)
    && typeof o['asuntoId'] === 'string' && typeof o['codigo'] === 'string' && typeof o['creado'] === 'string'
    && typeof o['actualizado'] === 'string' && typeof o['encabezado'] === 'string' && o['iv'] instanceof ArrayBuffer && o['ct'] instanceof ArrayBuffer;
  if (!forma) throw new SiglowError('ARCHIVO_ALTERADO');
  return o as unknown as AsuntoRecord;
}

/**
 * La base existe ya en este navegador. Las lecturas no la crean: con «No guardar» (M-14) nada se escribe en IndexedDB, ni
 * siquiera una base vacía. Sin indexedDB.databases() se abre la base como antes.
 */
async function baseExiste(): Promise<boolean> {
  if (conexion) return true;
  if (!idbDisponible()) throw new SiglowError('IDB_NO_DISPONIBLE');
  if (typeof indexedDB.databases !== 'function') return true;
  try {
    return (await indexedDB.databases()).some((d) => d.name === DB_NOMBRE);
  } catch {
    return true;
  }
}

/** Una lectura: sin la base no hay nada que leer, y no se crea (ni con indexedDB.databases() ausente). */
async function leer<T>(paso: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  if (!(await baseExiste())) return undefined;
  try {
    return await transaccion<T>('readonly', paso, 'IDB_NO_DISPONIBLE', false);
  } catch (e) {
    if (sinBase(e)) return undefined;
    throw e;
  }
}

export async function listarRegistros(): Promise<RegistroListado[]> {
  const todos = (await leer<unknown[]>((s) => s.getAll())) ?? [];
  const lista: RegistroListado[] = [];
  for (const x of todos) {
    try {
      const r = registroLeido(x);
      if (r) lista.push({ asuntoId: r.asuntoId, codigo: r.codigo, creado: r.creado, actualizado: r.actualizado });
    } catch { /* un registro con otra forma no se lista: abrirlo daría ARCHIVO_ALTERADO */ }
  }
  return lista.sort((a, b) => (a.actualizado < b.actualizado ? 1 : a.actualizado > b.actualizado ? -1 : 0));
}

export async function leerRegistro(asuntoId: AsuntoId): Promise<AsuntoRecord | null> {
  return registroLeido(await leer<unknown>((s) => s.get(asuntoId)));
}

export async function buscarPorCodigo(codigo: string): Promise<AsuntoRecord | null> {
  return registroLeido(await leer<unknown>((s) => s.index('por_codigo').get(codigo)));
}

/** Registro nuevo (`add`; crea la base si no existe): si el asuntoId o el código ya existen → ASUNTO_EXISTENTE. */
export async function agregarRegistro(r: AsuntoRecord): Promise<void> {
  const limpio = registroLimpio(r);
  await transaccion('readwrite', (s) => s.add(limpio), 'ERROR_INTERNO', true);
}

/**
 * Parámetros de la clave con que se cifró un registro (sal en base64 e `it` de su encabezado). Con `encabezado`, además, el
 * registro exacto que se leyó: su IV cambia en cada guardado, así que «cambiar frase» no pisa un guardado concurrente hecho con
 * la misma clave (B-28).
 */
export interface ClaveDelRegistro { salB64: string; it: number; encabezado?: string }

/** Los parámetros del encabezado de un registro guardado, o null si no es un registro del almacén bien formado. */
function claveDe(x: unknown): ClaveDelRegistro | null {
  try {
    const r = registroLeido(x);
    if (!r) return null;
    const e = analizarEncabezado(r.encabezado);
    return e.uso === 'almacen' && e.asuntoId === r.asuntoId ? { salB64: e.salB64, it: e.it } : null;
  } catch {
    return null;
  }
}

/**
 * Guardar sobre el registro existente (M-5, M-6): en una sola transacción, `put` solo si el registro sigue ahí y está cifrado con
 * la clave que se esperaba (`previo`: misma sal y mismo `it`). Si otra pestaña lo borró, si ya no está la base («Borrar todo»,
 * datos del sitio borrados) o si su frase cambió (otra sal) → SESION_DESCONOCIDA, sin escribir ni crear nada: un registro borrado
 * no vuelve y un guardado con la clave vieja no deshace un cambio de frase. Con `previo.encabezado`, también si el registro ya no
 * es el que se leyó (B-28): quien llama vuelve a leer para distinguirlo de una sesión perdida. El código no puede chocar con el
 * de otro asunto (índice único).
 */
export async function ponerRegistro(r: AsuntoRecord, previo: ClaveDelRegistro): Promise<void> {
  const limpio = registroLimpio(r);
  await transaccion('readwrite', (s, ctl) => {
    const actual = ctl.vigilar(s.get(limpio.asuntoId));
    actual.onsuccess = () => {
      const k = claveDe(actual.result);
      const otro = previo.encabezado !== undefined && (actual.result as { encabezado?: unknown } | undefined)?.encabezado !== previo.encabezado;
      if (k === null || k.salB64 !== previo.salB64 || k.it !== previo.it || otro) ctl.abortar('SESION_DESCONOCIDA');
      else ctl.vigilar(s.put(limpio));
    };
  }, 'ERROR_INTERNO', false);
}

/** «Reemplazar» al importar: borra los registros en conflicto y agrega el nuevo en una sola transacción. */
export async function reemplazarRegistros(borrar: readonly AsuntoId[], r: AsuntoRecord): Promise<void> {
  const limpio = registroLimpio(r);
  await transaccion('readwrite', (s, ctl) => {
    for (const id of borrar) ctl.vigilar(s.delete(id));
    return s.add(limpio);
  }, 'ERROR_INTERNO', true);
}

/** «Borrar» un asunto (M-109). Sin la base no hay nada que borrar, y no se crea. */
export async function borrarRegistro(asuntoId: AsuntoId): Promise<void> {
  try {
    await transaccion('readwrite', (s) => s.delete(asuntoId), 'ERROR_INTERNO', false);
  } catch (e) {
    if (!sinBase(e)) throw e;
  }
}

/**
 * «Borrar todo» (M-111): cierra la conexión propia y borra la base. 'bloqueado' si otra pestaña no soltó su conexión (M-112);
 * la petición queda en curso y el navegador la completa cuando esa pestaña se cierra.
 */
export async function borrarBase(): Promise<'borrado' | 'bloqueado'> {
  if (!idbDisponible()) throw new SiglowError('IDB_NO_DISPONIBLE');
  borrando = true;
  try {
    const actual = conexion;
    conexion = null;
    if (actual) { try { (await actual)?.close(); } catch { /* no había conexión */ } }
    return await new Promise<'borrado' | 'bloqueado'>((ok, mal) => {
      const req = indexedDB.deleteDatabase(DB_NOMBRE);
      req.onsuccess = () => { ok('borrado'); };
      req.onerror = () => { mal(new SiglowError('IDB_NO_DISPONIBLE')); };
      req.onblocked = () => { ok('bloqueado'); };
    });
  } finally {
    borrando = false;
  }
}

/** `navigator.storage.persist()` al elegir «Guardar cifrada» (V-18). null si el navegador no lo ofrece. */
export async function pedirPersistencia(): Promise<boolean | null> {
  const s = (globalThis as { navigator?: Navigator }).navigator?.storage;
  if (!s || typeof s.persist !== 'function') return null;
  try { return await s.persist(); } catch { return false; }
}

/** Resultado vigente de persist() para la Bóveda (PC-6). */
export async function persistenciaConcedida(): Promise<boolean | null> {
  const s = (globalThis as { navigator?: Navigator }).navigator?.storage;
  if (!s || typeof s.persisted !== 'function') return null;
  try { return await s.persisted(); } catch { return null; }
}
