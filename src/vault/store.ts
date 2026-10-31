// Almacén cifrado en IndexedDB (PD-4; plan 6.7.1, 6.7.4, 3.4, V-17, V-18). Guarda solo AsuntoRecord: los campos en claro de
// INV-V01 y el `ct`. Nunca un CryptoKey, nunca localStorage ni sessionStorage (INV-V07). Transacciones con durabilidad
// estricta; QuotaExceededError → CUOTA_EXCEDIDA; índice único de `codigo` o clave repetida → ASUNTO_EXISTENTE.
// `onversionchange` (otra pestaña borra todo o actualiza la base) cierra la conexión y avisa a quien se suscribió.
import { SiglowError } from '../core/types.ts';
import type { AsuntoId, AsuntoRecord, ErrorCode, IsoDateTime } from '../core/types.ts';

export const DB_NOMBRE = 'siglow-boveda';
export const DB_VERSION = 1;
export const ALMACEN = 'asuntos';
const CAMPOS = ['asuntoId', 'codigo', 'creado', 'actualizado', 'encabezado', 'iv', 'ct'] as const;

export interface RegistroListado { asuntoId: AsuntoId; codigo: string; creado: IsoDateTime; actualizado: IsoDateTime }

let conexion: Promise<IDBDatabase> | null = null;
let borrando = false;
const alCerrar = new Set<() => void>();

/** Avisa cuando otra pestaña obliga a cerrar la conexión (borrar todo o versión nueva). Devuelve la baja. */
export function alCerrarPorOtraPestana(fn: () => void): () => void {
  alCerrar.add(fn);
  return () => { alCerrar.delete(fn); };
}

export function idbDisponible(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function codigoDe(e: unknown, porDefecto: ErrorCode): ErrorCode {
  const n = typeof e === 'object' && e !== null ? (e as { name?: unknown }).name : undefined;
  if (n === 'QuotaExceededError') return 'CUOTA_EXCEDIDA';
  if (n === 'ConstraintError') return 'ASUNTO_EXISTENTE';
  return porDefecto;
}

function abrirBase(): Promise<IDBDatabase> {
  if (!idbDisponible()) return Promise.reject(new SiglowError('IDB_NO_DISPONIBLE'));
  if (conexion) return conexion;
  const p = new Promise<IDBDatabase>((ok, mal) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NOMBRE, DB_VERSION);
    } catch {
      mal(new SiglowError('IDB_NO_DISPONIBLE'));
      return;
    }
    req.onupgradeneeded = () => {
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
        conexion = null;
        if (!borrando) for (const f of [...alCerrar]) { try { f(); } catch { /* sin contenido */ } }
      };
      db.onclose = () => { conexion = null; };
      ok(db);
    };
    req.onerror = () => { conexion = null; mal(new SiglowError('IDB_NO_DISPONIBLE')); };
  });
  conexion = p;
  p.catch(() => { if (conexion === p) conexion = null; });
  return p;
}

/** Una transacción: resuelve al completarse (no al terminar la petición), con durabilidad estricta. */
async function transaccion<T>(modo: IDBTransactionMode, paso: (s: IDBObjectStore) => IDBRequest<T> | void, error: ErrorCode): Promise<T | undefined> {
  const db = await abrirBase();
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
    try {
      const req = paso(tx.objectStore(ALMACEN));
      if (req) {
        req.onsuccess = () => { resultado = req.result; };
        req.onerror = (ev) => { fallo = req.error; ev.preventDefault(); tx.abort(); };
      }
    } catch (e) {
      fallo = e;
      try { tx.abort(); } catch { /* ya terminada */ }
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

export async function listarRegistros(): Promise<RegistroListado[]> {
  if (!(await baseExiste())) return [];
  const todos = (await transaccion<unknown[]>('readonly', (s) => s.getAll(), 'IDB_NO_DISPONIBLE')) ?? [];
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
  if (!(await baseExiste())) return null;
  return registroLeido(await transaccion<unknown>('readonly', (s) => s.get(asuntoId), 'IDB_NO_DISPONIBLE'));
}

export async function buscarPorCodigo(codigo: string): Promise<AsuntoRecord | null> {
  if (!(await baseExiste())) return null;
  return registroLeido(await transaccion<unknown>('readonly', (s) => s.index('por_codigo').get(codigo), 'IDB_NO_DISPONIBLE'));
}

/** Registro nuevo (`add`): si el asuntoId o el código ya existen → ASUNTO_EXISTENTE. */
export async function agregarRegistro(r: AsuntoRecord): Promise<void> {
  const limpio = registroLimpio(r);
  await transaccion('readwrite', (s) => s.add(limpio), 'ERROR_INTERNO');
}

/** Guardar sobre el registro existente (`put`); el código no puede chocar con el de otro asunto (índice único). */
export async function ponerRegistro(r: AsuntoRecord): Promise<void> {
  const limpio = registroLimpio(r);
  await transaccion('readwrite', (s) => s.put(limpio), 'ERROR_INTERNO');
}

/** «Reemplazar» al importar: borra los registros en conflicto y agrega el nuevo en una sola transacción. */
export async function reemplazarRegistros(borrar: readonly AsuntoId[], r: AsuntoRecord): Promise<void> {
  const limpio = registroLimpio(r);
  await transaccion('readwrite', (s) => {
    for (const id of borrar) s.delete(id);
    return s.add(limpio);
  }, 'ERROR_INTERNO');
}

/** «Borrar» un asunto (M-109). */
export async function borrarRegistro(asuntoId: AsuntoId): Promise<void> {
  await transaccion('readwrite', (s) => s.delete(asuntoId), 'ERROR_INTERNO');
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
    if (actual) { try { (await actual).close(); } catch { /* no había conexión */ } }
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
