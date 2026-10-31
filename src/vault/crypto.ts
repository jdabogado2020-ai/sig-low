// Cifrado de la tabla de correspondencia (PD-3; plan 3.4, 6.7.2 a 6.7.6, V-17, V-23).
// PBKDF2-HMAC-SHA-256 → clave AES-GCM-256 no extraíble (deriveKey, nunca deriveBits); AAD = bytes exactos del encabezado;
// IV de 12 B nuevo en cada cifrado; texto plano en ceros tras cifrar. Las iteraciones fuera de [600 000, 5 000 000] se
// rechazan antes de llamar a importKey o deriveKey (INV-V04). Errores solo con ErrorCode: ningún mensaje de Web Crypto sale.
// La persistencia (IndexedDB, persist(), descarga, conflicto al importar) es de PD-4 (store.ts, export.ts).
import { SiglowError } from '../core/types.ts';
import type { AsuntoId, AsuntoRecord, ErrorCode, IsoDateTime, PassphraseIssue, SiglowFile, ValidatePassphraseFn, VaultPayload } from '../core/types.ts';

// ===== Parámetros (6.7.3) =====
export const IT_MIN = 600_000;
export const IT_MAX = 5_000_000;
/** Paso de redondeo de la calibración. */
export const IT_PASO = 50_000;
/** Duración objetivo de la derivación, en ms. */
export const OBJETIVO_MS = 500;
export const SAL_BYTES = 16;
export const IV_BYTES = 12;
export const TAG_BITS = 128;
/** El texto plano mide un múltiplo de BLOQUE; el ct, un múltiplo de BLOQUE más la etiqueta (INV-V09). */
export const BLOQUE = 4096;
export const ETIQUETA_BYTES = TAG_BITS / 8;
/** Tamaño máximo de un .siglow (6.7.6, paso 1). */
export const SIGLOW_MAX_BYTES = 5_242_880;
export const ENCABEZADO_MAX = 256;

/** Cadena de encabezado canónica, PBKDF2 (6.7.2). Grupos: uso, id, it, sal, iv. */
export const ENCABEZADO_RE =
  /^sig-low\/tabla;v=1;uso=(almacen|exportacion);id=(asu_[0-9a-f]{32});kdf=PBKDF2;hash=SHA-256;it=([1-9][0-9]{5,6});sal=([A-Za-z0-9+/]{22}==);cif=AES-GCM;iv=([A-Za-z0-9+/]{16});tag=128$/;
/** Reserva de Argon2id (6.7.2): la versión 1 la reconoce y la rechaza con KDF_NO_ADMITIDO. */
const ARGON2_RE =
  /^sig-low\/tabla;v=1;uso=(almacen|exportacion);id=(asu_[0-9a-f]{32});kdf=argon2id;m=([1-9][0-9]{3,6});t=([1-9][0-9]?);p=([1-9]);sal=([A-Za-z0-9+/]{22}==);cif=AES-GCM;iv=([A-Za-z0-9+/]{16});tag=128$/;
const ASUNTO_ID_RE = /^asu_[0-9a-f]{32}$/;

export type UsoEncabezado = 'almacen' | 'exportacion';

export interface Encabezado {
  /** La cadena tal cual: es la AAD y nunca se reconstruye desde los campos. */
  texto: string;
  uso: UsoEncabezado;
  asuntoId: AsuntoId;
  it: number;
  sal: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  salB64: string;
  ivB64: string;
}

function falla(code: ErrorCode): never {
  throw new SiglowError(code);
}

/** Web Crypto solo existe en contexto seguro (INV-V08); se lee en cada llamada (las pruebas la espían). */
function subtle(): SubtleCrypto {
  const s = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  return s ?? falla('CONTEXTO_NO_SEGURO');
}

const nombreDe = (e: unknown): string => (typeof e === 'object' && e !== null && typeof (e as { name?: unknown }).name === 'string' ? (e as { name: string }).name : '');

export const itEnRango = (it: unknown): it is number => typeof it === 'number' && Number.isInteger(it) && it >= IT_MIN && it <= IT_MAX;

export function bytesAleatorios(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

const ctValido = (n: number): boolean => n >= BLOQUE + ETIQUETA_BYTES && n % BLOQUE === ETIQUETA_BYTES;

function igualesBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let d = 0;
  for (let i = 0; i < a.byteLength; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

// ===== Base64 estándar con relleno (6.7.3) =====
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VALOR = new Map([...ALFABETO].map((c, i) => [c, i]));
const B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
type NativoA = { toBase64?: (this: Uint8Array) => string };
type NativoDe = { fromBase64?: (s: string, o: { lastChunkHandling: 'strict' }) => Uint8Array };

function aBase64Propio(b: Uint8Array): string {
  const partes: string[] = [];
  for (let i = 0; i < b.byteLength; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    partes.push(ALFABETO[(n >> 18) & 63]! + ALFABETO[(n >> 12) & 63]!
      + (i + 1 < b.byteLength ? ALFABETO[(n >> 6) & 63]! : '=') + (i + 2 < b.byteLength ? ALFABETO[n & 63]! : '='));
  }
  return partes.join('');
}

function deBase64Propio(s: string): Uint8Array<ArrayBuffer> {
  const relleno = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - relleno);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n = ((VALOR.get(s[i]!) ?? 0) << 18) | ((VALOR.get(s[i + 1]!) ?? 0) << 12) | ((VALOR.get(s[i + 2]!) ?? 0) << 6) | (VALOR.get(s[i + 3]!) ?? 0);
    for (const x of [(n >> 16) & 255, (n >> 8) & 255, n & 255]) if (o < out.length) out[o++] = x;
  }
  return out;
}

export function aBase64(b: Uint8Array): string {
  const nativo = (Uint8Array.prototype as NativoA).toBase64;
  return typeof nativo === 'function' ? nativo.call(b) : aBase64Propio(b);
}

/** Base64 estándar, con relleno y canónico (bits sobrantes en cero, sin espacios); null si no lo es. */
export function deBase64(s: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof s !== 'string' || !B64_RE.test(s)) return null;
  const nativo = (Uint8Array as unknown as NativoDe).fromBase64;
  let b: Uint8Array<ArrayBuffer>;
  try {
    b = typeof nativo === 'function' ? new Uint8Array(nativo(s, { lastChunkHandling: 'strict' })) : deBase64Propio(s);
  } catch {
    return null;
  }
  return aBase64(b) === s ? b : null;
}

// ===== Encabezado canónico (6.7.2) =====
export function armarEncabezado(p: { uso: UsoEncabezado; asuntoId: AsuntoId; it: number; sal: Uint8Array; iv: Uint8Array }): string {
  if (p.uso !== 'almacen' && p.uso !== 'exportacion') falla('ENTRADA_INVALIDA');
  if (!ASUNTO_ID_RE.test(p.asuntoId)) falla('ENTRADA_INVALIDA');
  if (!itEnRango(p.it) || p.sal.byteLength !== SAL_BYTES || p.iv.byteLength !== IV_BYTES) falla('PARAMETROS_FUERA_DE_RANGO');
  const texto = `sig-low/tabla;v=1;uso=${p.uso};id=${p.asuntoId};kdf=PBKDF2;hash=SHA-256;it=${p.it};sal=${aBase64(p.sal)};cif=AES-GCM;iv=${aBase64(p.iv)};tag=128`;
  if (texto.length > ENCABEZADO_MAX || !ENCABEZADO_RE.test(texto)) falla('ERROR_INTERNO');
  return texto;
}

/** Encabezados de nuevoEncabezado todavía sin usar: cifrar acepta solo estos, y cada uno una sola vez (B-15, INV-V02). */
const encabezadosNuevos = new Set<string>();

/** Encabezado con IV nuevo de crypto.getRandomValues (6.7.3: nuevo en cada cifrado). Sirve para un solo cifrado. */
export function nuevoEncabezado(p: { uso: UsoEncabezado; asuntoId: AsuntoId; it: number; sal: Uint8Array }): string {
  const texto = armarEncabezado({ ...p, iv: bytesAleatorios(IV_BYTES) });
  encabezadosNuevos.add(texto);
  return texto;
}

/**
 * Analiza el encabezado solo para validar los parámetros antes de derivar (6.7.2). Argon2id reservado → KDF_NO_ADMITIDO;
 * cadena que no casa → ARCHIVO_ALTERADO; `it` fuera de [600 000, 5 000 000] → PARAMETROS_FUERA_DE_RANGO.
 */
export function analizarEncabezado(texto: unknown): Encabezado {
  if (typeof texto !== 'string' || texto.length > ENCABEZADO_MAX) return falla('ARCHIVO_ALTERADO');
  const m = ENCABEZADO_RE.exec(texto);
  if (!m) return falla(ARGON2_RE.test(texto) ? 'KDF_NO_ADMITIDO' : 'ARCHIVO_ALTERADO');
  const it = Number(m[3]);
  if (!itEnRango(it)) falla('PARAMETROS_FUERA_DE_RANGO');
  const sal = deBase64(m[4]);
  const iv = deBase64(m[5]);
  if (!sal || sal.byteLength !== SAL_BYTES || !iv || iv.byteLength !== IV_BYTES) return falla('ARCHIVO_ALTERADO');
  return { texto, uso: m[1] as UsoEncabezado, asuntoId: m[2] as AsuntoId, it, sal, iv, salB64: m[4]!, ivB64: m[5]! };
}

// ===== Derivación y calibración (6.7.3) =====
/**
 * PBKDF2-HMAC-SHA-256 → AES-GCM-256 no extraíble, solo encrypt/decrypt (INV-V05). La frase se pasa a NFC (INV-V06).
 * `it` y la sal se validan antes de importKey y deriveKey (INV-V04). Los bytes de la frase quedan en ceros (V-23).
 */
export async function derivarClave(pass: string, sal: Uint8Array, it: number): Promise<CryptoKey> {
  if (typeof pass !== 'string') falla('ENTRADA_INVALIDA');
  if (!itEnRango(it) || !(sal instanceof Uint8Array) || sal.byteLength !== SAL_BYTES) falla('PARAMETROS_FUERA_DE_RANGO');
  const s = subtle();
  const bytes = new TextEncoder().encode(pass.normalize('NFC'));
  try {
    const base = await s.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
    return await s.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(sal), iterations: it }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } catch {
    return falla('ERROR_INTERNO');
  } finally {
    bytes.fill(0);
  }
}

/** it = clamp(redondear_arriba(600 000 × 0,5 s / t₆₀₀ₖ, 50 000), 600 000, 5 000 000). Medida no válida → máximo. */
export function iteracionesPara(t600kMs: number): number {
  if (!(t600kMs > 0)) return IT_MAX;
  const it = Math.ceil((IT_MIN * OBJETIVO_MS) / (t600kMs * IT_PASO)) * IT_PASO;
  return Math.min(IT_MAX, Math.max(IT_MIN, it));
}

/** Tiempo de una derivación de 600 000 iteraciones con frase y sal aleatorias (nunca la frase del usuario), en ms. */
export async function medirT600k(): Promise<number> {
  const s = subtle();
  const frase = bytesAleatorios(32);
  try {
    const base = await s.importKey('raw', frase, 'PBKDF2', false, ['deriveKey']);
    const t0 = performance.now();
    await s.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: bytesAleatorios(SAL_BYTES), iterations: IT_MIN }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return performance.now() - t0;
  } catch {
    return falla('ERROR_INTERNO');
  } finally {
    frase.fill(0);
  }
}

export async function calibrarIteraciones(): Promise<number> {
  return iteracionesPara(await medirT600k());
}

/**
 * Fijar una frase (crear, pasar a «Guardar cifrada», cambiar frase): validatePassphrase debe devolver [] antes de calibrar
 * o derivar nada (INV-V10); si no, ENTRADA_INVALIDA. Sal nueva; `it` calibrado si no se da.
 */
export async function claveParaFraseNueva(pass: string, codigo: string, it?: number): Promise<{ clave: CryptoKey; sal: Uint8Array<ArrayBuffer>; it: number }> {
  if (typeof pass !== 'string' || validatePassphrase(pass, codigo).length > 0) falla('ENTRADA_INVALIDA');
  if (it !== undefined && !itEnRango(it)) falla('PARAMETROS_FUERA_DE_RANGO');
  const iteraciones = it ?? (await calibrarIteraciones());
  const sal = bytesAleatorios(SAL_BYTES);
  return { clave: await derivarClave(pass, sal, iteraciones), sal, it: iteraciones };
}

// ===== AES-GCM con AAD (6.7.2, 6.7.3) =====
/**
 * IV ya vistos por objeto CryptoKey en esta sesión: los que cifró y el del registro con que se abrió (abrirRegistro). Es una
 * defensa adicional, no la garantía: dos CryptoKey derivados de la misma frase y sal son la misma clave pero objetos
 * distintos. La garantía de INV-V02 es que cifrar solo acepta un encabezado recién creado por nuevoEncabezado (IV aleatorio
 * de 96 bits) y una sola vez.
 */
const ivsUsados = new WeakMap<CryptoKey, Set<string>>();
function registrarIv(clave: CryptoKey, ivB64: string): void {
  let usados = ivsUsados.get(clave);
  if (!usados) ivsUsados.set(clave, (usados = new Set()));
  if (usados.has(ivB64)) falla('ERROR_INTERNO');
  usados.add(ivB64);
}

const aad = (encabezado: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(encabezado);

/**
 * Cifra `plano` (múltiplo positivo de 4096 bytes, 6.7.4) con el IV del encabezado y AAD = bytes del encabezado. Solo admite
 * un encabezado recién creado por nuevoEncabezado y lo consume: el encabezado de un registro o de un archivo, ya usado, da
 * ERROR_INTERNO (B-15). Para guardar se usa sellarRegistro; para exportar, exportarSiglow.
 * `plano` queda en ceros al terminar, también si falla (T-PV-04).
 */
export async function cifrar(clave: CryptoKey, encabezado: string, plano: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const e = analizarEncabezado(encabezado);
    if (plano.byteLength === 0 || plano.byteLength % BLOQUE !== 0) falla('ENTRADA_INVALIDA');
    if (!encabezadosNuevos.delete(encabezado)) falla('ERROR_INTERNO');
    registrarIv(clave, e.ivB64);
    try {
      return new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: e.iv, additionalData: aad(encabezado), tagLength: TAG_BITS }, clave, plano));
    } catch {
      return falla('ERROR_INTERNO');
    }
  } finally {
    plano.fill(0);
  }
}

/** Descifra con el IV del encabezado y AAD = sus bytes. OperationError (frase, etiqueta o AAD) → CONTRASENA_O_ARCHIVO. */
export async function descifrar(clave: CryptoKey, encabezado: string, ct: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const e = analizarEncabezado(encabezado);
  if (!ctValido(ct.byteLength)) falla('ARCHIVO_ALTERADO');
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: e.iv, additionalData: aad(encabezado), tagLength: TAG_BITS }, clave, ct));
  } catch (err) {
    return falla(nombreDe(err) === 'OperationError' ? 'CONTRASENA_O_ARCHIVO' : 'ERROR_INTERNO');
  }
}

// ===== Texto plano del registro (6.7.4) =====
function bytesUtf8(s: string): number {
  let n = 0;
  for (const c of s) {
    const cp = c.codePointAt(0)!;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * JSON UTF-8 de VaultPayload con las claves en el orden de 6.7.4 y `relleno` (último campo) de espacios hasta un múltiplo
 * de 4096 bytes. El largo se cuenta sin codificar, para no dejar una copia del texto plano sin poner en ceros.
 */
export function serializarPayload(p: VaultPayload): Uint8Array<ArrayBuffer> {
  const base = {
    formato: 'sig-low/tabla-plana', v: 1,
    asunto: { asuntoId: p.asunto.asuntoId, codigo: p.asunto.codigo, creado: p.asunto.creado, actualizado: p.asunto.actualizado },
    appVersion: p.appVersion,
    table: { asuntoId: p.table.asuntoId, counters: p.table.counters, entries: p.table.entries, documents: p.table.documents },
    caseList: p.caseList,
    relleno: '',
  };
  const n = bytesUtf8(JSON.stringify(base));
  base.relleno = ' '.repeat((BLOQUE - (n % BLOQUE)) % BLOQUE);
  const bytes = new TextEncoder().encode(JSON.stringify(base));
  if (bytes.byteLength % BLOQUE !== 0) {
    bytes.fill(0);
    falla('ERROR_INTERNO');
  }
  return bytes;
}

// ===== Registro del almacén (6.7.1, 6.7.4: guardar y desbloquear) =====
export interface DatosAsunto { asuntoId: AsuntoId; codigo: string; creado: IsoDateTime; actualizado: IsoDateTime }

/** Guardar: IV nuevo, encabezado nuevo con uso=almacen (misma sal e `it`), cifrar. `plano` queda en ceros. */
export async function sellarRegistro(clave: CryptoKey, datos: DatosAsunto, params: { sal: Uint8Array; it: number }, plano: Uint8Array<ArrayBuffer>): Promise<AsuntoRecord> {
  try {
    const encabezado = nuevoEncabezado({ uso: 'almacen', asuntoId: datos.asuntoId, it: params.it, sal: params.sal });
    const ct = await cifrar(clave, encabezado, plano);
    const iv = analizarEncabezado(encabezado).iv;
    return { asuntoId: datos.asuntoId, codigo: datos.codigo, creado: datos.creado, actualizado: datos.actualizado, encabezado, iv: iv.buffer, ct: ct.buffer };
  } finally {
    plano.fill(0);
  }
}

/**
 * Desbloquear: valida el encabezado (uso=almacen, mismo asuntoId, `iv` del registro = `iv` del encabezado, largo del ct) antes
 * de derivar con su sal e `it`; descifra con AAD. Devuelve la clave para los guardados siguientes y el texto plano (el que
 * llama lo pone en ceros tras leerlo).
 */
export async function abrirRegistro(r: AsuntoRecord, pass: string): Promise<{ clave: CryptoKey; sal: Uint8Array<ArrayBuffer>; it: number; plano: Uint8Array<ArrayBuffer> }> {
  const e = analizarEncabezado(r.encabezado);
  if (e.uso !== 'almacen' || e.asuntoId !== r.asuntoId || !(r.iv instanceof ArrayBuffer) || !(r.ct instanceof ArrayBuffer)
    || !igualesBytes(new Uint8Array(r.iv), e.iv) || !ctValido(r.ct.byteLength)) falla('ARCHIVO_ALTERADO');
  const clave = await derivarClave(pass, e.sal, e.it);
  const plano = await descifrar(clave, r.encabezado, new Uint8Array(r.ct));
  registrarIv(clave, e.ivB64);   // B-15: el IV del registro ya se usó con esta clave
  return { clave, sal: e.sal, it: e.it, plano };
}

// ===== Archivo .siglow (6.7.5, 6.7.6) =====
/** JSON del .siglow con las claves en el orden de 6.7.5; los parámetros salen del propio encabezado. */
export function armarSiglow(encabezado: string, ct: Uint8Array): string {
  const e = analizarEncabezado(encabezado);
  if (e.uso !== 'exportacion' || !ctValido(ct.byteLength)) falla('ENTRADA_INVALIDA');
  const archivo: SiglowFile = {
    formato: 'sig-low/tabla', v: 1,
    kdf: { alg: 'PBKDF2', hash: 'SHA-256', iteraciones: e.it, sal: e.salB64 },
    cifrado: { alg: 'AES-GCM', iv: e.ivB64, tagBits: 128 },
    encabezado: e.texto,
    ct: aBase64(ct),
  };
  return JSON.stringify(archivo);
}

/**
 * Exportar (6.7.4): con el asunto guardado (`registro`), la frase debe abrir ese registro antes de exportar (B-16): una frase
 * mal escrita da CONTRASENA_O_ARCHIVO y no produce un .siglow que nadie abre. `registro` null solo con «No guardar» (la frase
 * es nueva y la interfaz la pide dos veces). Después: sal nueva, uso=exportacion, IV nuevo, cifrar y armar el JSON.
 * `plano` queda en ceros, también si falla.
 */
export async function exportarSiglow(pass: string, asuntoId: AsuntoId, it: number, plano: Uint8Array<ArrayBuffer>, registro: AsuntoRecord | null): Promise<string> {
  try {
    if (!itEnRango(it)) falla('PARAMETROS_FUERA_DE_RANGO');
    if (registro !== null) {
      if (registro.asuntoId !== asuntoId) falla('ENTRADA_INVALIDA');
      (await abrirRegistro(registro, pass)).plano.fill(0);
    }
    const sal = bytesAleatorios(SAL_BYTES);
    const clave = await derivarClave(pass, sal, it);
    const encabezado = nuevoEncabezado({ uso: 'exportacion', asuntoId, it, sal });
    return armarSiglow(encabezado, await cifrar(clave, encabezado, plano));
  } finally {
    plano.fill(0);
  }
}

export interface SiglowValidado { encabezado: string; asuntoId: AsuntoId; it: number; sal: Uint8Array<ArrayBuffer>; iv: Uint8Array<ArrayBuffer>; ct: Uint8Array<ArrayBuffer> }

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const clavesExactas = (o: Record<string, unknown>, claves: readonly string[]): boolean => {
  const k = Object.keys(o);
  return k.length === claves.length && claves.every((c) => Object.hasOwn(o, c));
};
const CLAVES_SIGLOW = ['formato', 'v', 'kdf', 'cifrado', 'encabezado', 'ct'] as const;

/** Pasos 1 a 9 de 6.7.6, en orden; ninguno deriva ni descifra. */
export function validarSiglow(entrada: ArrayBuffer | Uint8Array): SiglowValidado {
  const bytes = entrada instanceof Uint8Array ? entrada : new Uint8Array(entrada);
  // 1
  if (bytes.byteLength > SIGLOW_MAX_BYTES) falla('ARCHIVO_DEMASIADO_GRANDE');
  // 2
  let o: unknown;
  try {
    o = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return falla('FORMATO_DESCONOCIDO');
  }
  if (!esObjeto(o) || !clavesExactas(o, CLAVES_SIGLOW)) return falla('FORMATO_DESCONOCIDO');
  // 3
  if (o['formato'] !== 'sig-low/tabla') falla('FORMATO_DESCONOCIDO');
  // 4
  const v = o['v'];
  if (v !== 1) falla(typeof v === 'number' && Number.isInteger(v) && v > 1 ? 'VERSION_MAS_RECIENTE' : 'FORMATO_DESCONOCIDO');
  // 5
  const kdf = o['kdf'];
  if (!esObjeto(kdf) || kdf['alg'] !== 'PBKDF2' || kdf['hash'] !== 'SHA-256' || !clavesExactas(kdf, ['alg', 'hash', 'iteraciones', 'sal'])) return falla('KDF_NO_ADMITIDO');
  // 6
  const it = kdf['iteraciones'];
  const sal = deBase64(kdf['sal']);
  if (!itEnRango(it) || !sal || sal.byteLength !== SAL_BYTES) return falla('PARAMETROS_FUERA_DE_RANGO');
  // 7
  const cif = o['cifrado'];
  if (!esObjeto(cif) || !clavesExactas(cif, ['alg', 'iv', 'tagBits']) || cif['alg'] !== 'AES-GCM' || cif['tagBits'] !== TAG_BITS) return falla('PARAMETROS_FUERA_DE_RANGO');
  const iv = deBase64(cif['iv']);
  if (!iv || iv.byteLength !== IV_BYTES) return falla('PARAMETROS_FUERA_DE_RANGO');
  // 8
  const encabezado = o['encabezado'];
  const m = typeof encabezado === 'string' && encabezado.length <= ENCABEZADO_MAX ? ENCABEZADO_RE.exec(encabezado) : null;
  if (!m || m[1] !== 'exportacion' || Number(m[3]) !== it || m[4] !== kdf['sal'] || m[5] !== cif['iv']) return falla('ARCHIVO_ALTERADO');
  // 9
  const ct = deBase64(o['ct']);
  if (!ct || !ctValido(ct.byteLength)) return falla('ARCHIVO_ALTERADO');
  return { encabezado: encabezado as string, asuntoId: m[2] as AsuntoId, it, sal, iv, ct };
}

/**
 * Pasos 1 a 10 de 6.7.6: valida sin derivar y, solo si todo pasa, deriva con la frase (NFC) y descifra con AAD = bytes del
 * encabezado. Los pasos 11 (VaultPayload) y 12 (conflicto) son de PD-4; el que llama pone `plano` en ceros tras leerlo.
 */
export async function abrirSiglow(entrada: ArrayBuffer | Uint8Array, pass: string): Promise<{ asuntoId: AsuntoId; encabezado: string; plano: Uint8Array<ArrayBuffer> }> {
  const a = validarSiglow(entrada);
  const clave = await derivarClave(pass, a.sal, a.it);
  return { asuntoId: a.asuntoId, encabezado: a.encabezado, plano: await descifrar(clave, a.encabezado, a.ct) };
}

// ===== Frase de paso (6.7.3) =====
const SECUENCIAS = ['1234567890', 'abcdefghijklmnñopqrstuvwxyz', 'qwertyuiopasdfghjklñzxcvbnm'].map((s) => [...s]);
const ESPACIO = /\s/u;

/** Minúsculas y sin marcas diacríticas; la ñ se conserva como letra (las secuencias de 6.7.3 la incluyen). */
function sinDiacriticos(x: string, conservarEnie: boolean): string {
  return [...x.normalize('NFC').toLowerCase()]
    .map((c) => (conservarEnie && c === 'ñ' ? c : c.normalize('NFD').replace(/\p{M}/gu, '')))
    .join('');
}
/** plano(x) de 6.7.3: minúsculas, sin diacríticos y sin espacios. */
const plano = (x: string): string => sinDiacriticos(x, true).replace(/\s/gu, '');
/** Forma de data/frases-comunes.json: minúsculas, sin diacríticos, espacios colapsados. */
const formaComun = (x: string): string => sinDiacriticos(x, false).replace(/\s+/gu, ' ').trim();

function esSecuencia(c: string[]): boolean {
  if (c.length < 2) return false;
  return SECUENCIAS.some((s) => c.every((x, i) => {
    if (i === 0) return true;
    const a = s.indexOf(c[i - 1]!);
    const b = s.indexOf(x);
    return a >= 0 && b >= 0 && ((a + 1) % s.length === b || (b + 1) % s.length === a);
  }));
}

export const validatePassphrase: ValidatePassphraseFn = (pass, codigo) => {
  const p = String(pass).normalize('NFC');
  const issues: PassphraseIssue[] = [];
  if ([...p].length < 15) issues.push('CORTA');
  if (new Set([...p].filter((c) => !ESPACIO.test(c))).size < 6) issues.push('POCA_VARIEDAD');
  if (/^[0-9\s]+$/.test(p)) issues.push('SOLO_DIGITOS');
  const pp = plano(p);
  if (esSecuencia([...pp])) issues.push('SECUENCIA');
  const pc = plano(String(codigo ?? ''));
  if ([...pc].length >= 4 && pp.includes(pc)) issues.push('CONTIENE_CODIGO');
  if (FRASES_COMUNES.has(formaComun(p))) issues.push('FRASE_COMUN');
  return issues;
};

/**
 * Lista de bloqueo (6.7.3, FRASE_COMUN; NIST SP 800-63B-4 pide comparar con frases comunes, esperables y del contexto del
 * servicio). Redacción propia del proyecto, sin datos de terceros. 6.13 la ubica en data/frases-comunes.json (FrasesComunesFile),
 * que es de A2: va aquí mientras el integrador decide moverla (informe de PD-3). Se normaliza al cargar.
 */
const FRASES_COMUNES: ReadonlySet<string> = new Set([
  // Contraseñas y claves
  'contrasena segura', 'contrasena muy segura', 'mi contrasena segura', 'mi contrasena es secreta', 'esta es mi contrasena',
  'esta es mi contrasena segura', 'esta es mi clave', 'esta es mi clave secreta', 'mi clave es secreta', 'clave super secreta',
  'clave muy segura', 'mi clave secreta', 'mi clave segura', 'frase de paso segura', 'mi frase de paso', 'mi frase secreta',
  'frase secreta segura', 'frase de paso larga', 'esta es mi frase de paso', 'esta es mi frase secreta', 'contrasena de la oficina',
  'clave de la oficina', 'clave del despacho', 'contrasena del despacho', 'contrasena del trabajo', 'clave del trabajo',
  'no se me olvida nunca', 'nunca la voy a olvidar', 'no olvidar esta clave', 'no la olvides nunca', 'olvide mi contrasena',
  'cambiar contrasena', 'nueva contrasena segura', 'contrasena nueva', 'contrasena temporal', 'clave temporal segura',
  'contrasena123456', 'contrasena1234567', 'contrasena12345678', 'clave1234567890', 'colombia1234567', 'abogado1234567',
  'administrador del sistema', 'usuario y contrasena',
  // Fe y dichos
  'dios es mi pastor', 'el senor es mi pastor', 'dios te bendiga siempre', 'dios me bendice siempre', 'jesus es mi senor',
  'todo lo puedo en cristo', 'todo lo puedo en cristo que me fortalece', 'dios es fiel siempre', 'gracias a dios siempre',
  'con dios todo es posible', 'la fe mueve montanas', 'nada es imposible para dios', 'dios primero siempre',
  'bendecido y prosperado', 'sagrado corazon de jesus', 'padre nuestro que estas en los cielos', 'dios te salve maria',
  'nunca te rindas', 'nunca te rindas jamas', 'nada es imposible', 'la vida es bella', 'la vida es hermosa', 'vive la vida',
  'vive y deja vivir', 'carpe diem siempre', 'hakuna matata hakuna', 'todo pasa por algo', 'el que persevera alcanza',
  'querer es poder siempre', 'si se puede siempre', 'paso a paso se llega lejos', 'poco a poco se llega lejos',
  'mas vale tarde que nunca', 'el tiempo es oro', 'hoy es un buen dia', 'manana sera otro dia', 'en un lugar de la mancha',
  'el veloz murcielago hindu comia feliz cardillo y kiwi',
  // Afecto y familia
  'te amo mi amor', 'te quiero mucho', 'te quiero muchisimo', 'te amo para siempre', 'te quiero para siempre', 'mi amor eterno',
  'amor para siempre', 'por siempre juntos', 'juntos para siempre', 'eres el amor de mi vida', 'el amor de mi vida',
  'mi vida eres tu', 'te amo con todo mi corazon', 'mi familia es lo primero', 'mi familia es mi todo', 'mis hijos son mi vida',
  'mi hijo es mi vida', 'mi hija es mi vida', 'te amo mama', 'te amo papa', 'mi princesa hermosa',
  // País, ciudades y fútbol
  'viva colombia', 'colombia tierra querida', 'colombia es pasion', 'seleccion colombia', 'vamos colombia', 'bogota colombia',
  'medellin colombia', 'cali colombia', 'barranquilla colombia', 'colombia mi pais', 'millonarios campeon', 'nacional campeon',
  'atletico nacional campeon', 'america de cali campeon', 'deportivo cali campeon', 'junior de barranquilla', 'santa fe campeon',
  'real madrid campeon', 'hala madrid y nada mas', 'fc barcelona campeon', 'visca el barca',
  // Contexto del servicio (abogados y Sig-Low)
  'derecho de peticion', 'accion de tutela', 'accion de tutela urgente', 'constitucion politica de colombia',
  'corte constitucional', 'corte suprema de justicia', 'consejo de estado', 'rama judicial', 'codigo general del proceso',
  'codigo civil colombiano', 'codigo penal colombiano', 'abogado abogado', 'soy abogado', 'soy abogada', 'firma de abogados',
  'despacho de abogados', 'oficina de abogados', 'bufete de abogados', 'derecho laboral', 'derecho de familia',
  'justicia y derecho', 'dura lex sed lex', 'la ley es dura pero es la ley', 'in dubio pro reo', 'sig-low sig-low',
  'siglow siglow siglow', 'contrasena de siglow', 'clave de siglow', 'frase de siglow', 'anonimizador de documentos',
  'tabla de correspondencia', 'boveda cifrada', 'guardar cifrada',
  // Inglés
  'passwordpassword', 'password password', 'mypasswordissecure', 'my password is secure', 'this is my password',
  'correct horse battery staple', 'the quick brown fox jumps over the lazy dog', 'iloveyouforever', 'i love you forever',
  'i love you so much', 'letmeinletmein', 'let me in please', 'trustno1trustno1', 'qwertyqwerty', 'changeme changeme',
  'welcome to the jungle', 'never give up', 'just do it', 'may the force be with you', 'to be or not to be', 'abc123abc123abc',
  'password1234567', 'password12345678', '1q2w3e4r5t6y7u8i', '1qaz2wsx3edc4rfv', 'zaq12wsxcde34rfv', '123456789abcdef',
  '123456789qwerty', 'qwerty123456789', 'asdfghjkl123456',
].map(formaComun));
