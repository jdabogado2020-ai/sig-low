// Lector de .txt (PE-1): BOM → UTF-8 estricto → UTF-16 sin BOM → windows-1252 con aviso (6.1.1, 3.5).
// TypeScript puro: corre igual en el worker `io` y en las pruebas. No lee el nombre del archivo (V-37).
import { SiglowError } from '../core/types';
import type { DocId, DocumentModel, IdSource, ParseWarning, Part, PartId } from '../core/types';

export type TxtEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';
export type TxtWarningCode = 'CODIFICACION_ALTERNATIVA' | 'UTF16_SIN_BOM';
export interface TxtDecoded { text: string; encoding: TxtEncoding; warnings: TxtWarningCode[]; }

/** Fracción de unidades de 16 bits con byte alto en cero a partir de la cual se toma el archivo por UTF-16 sin BOM (6.1.1). */
export const UMBRAL_NUL_UTF16 = 0.1;

/** Identificadores aleatorios (6.1.4): 16 bytes de crypto.getRandomValues; nunca derivados del contenido. */
export function randomIds(): IdSource {
  return {
    next(prefix) {
      const b = new Uint8Array(16);
      crypto.getRandomValues(b);
      return prefix + '_' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    },
  };
}

/** Texto canónico (6.1.1): saltos CRLF y CR a LF, y NFC. Nada más. */
export function canonico(text: string): string {
  return text.replace(/\r\n?/g, '\n').normalize('NFC');
}

function empieza(b: Uint8Array, ...firma: number[]): boolean {
  return b.length >= firma.length && firma.every((x, i) => b[i] === x);
}

/** 'le' o 'be' si más de 10 % de las unidades de 16 bits tienen su byte alto (LE) o bajo (BE) en cero. */
function utf16SinBom(b: Uint8Array): 'le' | 'be' | null {
  const pares = Math.floor(b.length / 2);
  if (pares === 0) return null;
  let enPares = 0;
  let enImpares = 0;
  for (let i = 0; i + 1 < b.length; i += 2) {
    if (b[i] === 0) enPares++;
    if (b[i + 1] === 0) enImpares++;
  }
  if (enImpares / pares > UMBRAL_NUL_UTF16 && enImpares >= enPares) return 'le';
  if (enPares / pares > UMBRAL_NUL_UTF16) return 'be';
  return null;
}

function utf8Estricto(b: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b);
  } catch {
    return null;
  }
}

function w1252(b: Uint8Array): string {
  return new TextDecoder('windows-1252', { ignoreBOM: true }).decode(b);
}

/** Decodifica los bytes de un .txt. No transforma el texto (eso lo hace `canonico`). */
export function decodeTxt(bytes: Uint8Array): TxtDecoded {
  // 1. BOM declarado.
  if (empieza(bytes, 0xef, 0xbb, 0xbf)) {
    const t = utf8Estricto(bytes.subarray(3));
    if (t !== null) return { text: t, encoding: 'utf-8', warnings: [] };
    return { text: w1252(bytes.subarray(3)), encoding: 'windows-1252', warnings: ['CODIFICACION_ALTERNATIVA'] };
  }
  if (empieza(bytes, 0xff, 0xfe)) {
    return { text: new TextDecoder('utf-16le', { ignoreBOM: true }).decode(bytes.subarray(2)), encoding: 'utf-16le', warnings: [] };
  }
  if (empieza(bytes, 0xfe, 0xff)) {
    return { text: new TextDecoder('utf-16be', { ignoreBOM: true }).decode(bytes.subarray(2)), encoding: 'utf-16be', warnings: [] };
  }
  // 2. UTF-16 sin BOM: el texto ASCII en UTF-16 también es UTF-8 válido (con NUL), así que se prueba antes.
  const sinBom = utf16SinBom(bytes);
  if (sinBom !== null) {
    const enc = sinBom === 'le' ? 'utf-16le' : 'utf-16be';
    return { text: new TextDecoder(enc, { ignoreBOM: true }).decode(bytes), encoding: enc, warnings: ['UTF16_SIN_BOM'] };
  }
  // 3. UTF-8 estricto.
  const t = utf8Estricto(bytes);
  if (t !== null) return { text: t, encoding: 'utf-8', warnings: [] };
  // 4. windows-1252 con aviso.
  return { text: w1252(bytes), encoding: 'windows-1252', warnings: ['CODIFICACION_ALTERNATIVA'] };
}

export interface ReadCtx { docId: DocId; label: string; ids?: IdSource; }

/** Lee un .txt completo a un DocumentModel de una sola parte `cuerpo`. Lanza SiglowError(code). */
export function readTxt(input: ArrayBuffer | Uint8Array, ctx: ReadCtx): DocumentModel {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length === 0) throw new SiglowError('ARCHIVO_VACIO');
  if (empieza(bytes, 0xd0, 0xcf, 0x11, 0xe0)) throw new SiglowError('CONTENEDOR_CFB');
  if (empieza(bytes, 0x50, 0x4b, 0x03, 0x04) || empieza(bytes, 0x25, 0x50, 0x44, 0x46, 0x2d)) throw new SiglowError('FORMATO_NO_ADMITIDO');
  const dec = decodeTxt(bytes);
  const text = canonico(dec.text);
  // 6.3.1: no se crean partes vacías o solo con espacios.
  if (text.trim() === '') throw new SiglowError('ARCHIVO_VACIO');
  const ids = ctx.ids ?? randomIds();
  const part: Part = {
    id: ids.next('prt') as PartId, docId: ctx.docId, kind: 'cuerpo', label: 'Cuerpo del documento',
    order: 0, index: 1, text, included: true,
  };
  const warnings: ParseWarning[] = dec.warnings.map((code) => ({ code, count: 1 }));
  return { id: ctx.docId, label: ctx.label, source: 'txt', encoding: dec.encoding, parts: [part], metadata: { categories: {} }, warnings };
}
