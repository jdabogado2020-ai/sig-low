// Constructor de .docx de prueba (PE-2; sin archivos binarios en el repositorio): arma el ZIP con fflate.zipSync.
// Solo datos ficticios evidentes («Ficticia», «Ejemplo», «Prueba»).
import { strToU8, zipSync } from 'fflate';

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS = `xmlns:w="${W}" xmlns:r="${R}" xmlns:mc="${MC}" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"`;

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Un párrafo con corridas de texto. */
export const p = (...corridas: string[]): string => `<w:p>${corridas.join('')}</w:p>`;
/** Una corrida con texto. */
export const r = (t: string): string => `<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
/** Un párrafo con un solo texto. */
export const pt = (t: string): string => p(r(t));

export const decl = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
export const raiz = (nombre: string, interior: string): string => `${decl}<w:${nombre} ${NS}>${interior}</w:${nombre}>`;
export const documento = (cuerpo: string): string => raiz('document', `<w:body>${cuerpo}<w:sectPr/></w:body>`);

export interface ParteExtra { nombre: string; tipo: string; xml: string | Uint8Array; }
export interface OpcionesDocx {
  cuerpo: string;
  /** Partes relacionadas (encabezados, pies, notas, comentarios); el nombre es libre. */
  extras?: ParteExtra[];
  /** Entradas adicionales del ZIP (p. ej. docProps/core.xml). */
  entradas?: Record<string, string | Uint8Array>;
  /** Reemplaza el XML de la parte principal (p. ej. para probar codificaciones). */
  documentoXml?: string | Uint8Array;
}

export const tipoRel = (ultimo: string): string => `${REL}/${ultimo}`;

/** Arma un .docx mínimo y válido: `[Content_Types].xml`, `_rels/.rels`, `word/document.xml` y sus relaciones. */
export function construirDocx(o: OpcionesDocx): Uint8Array {
  const extras = o.extras ?? [];
  const rels = extras
    .map((e, i) => `<Relationship Id="rId${i + 10}" Type="${tipoRel(e.tipo)}" Target="${e.nombre}"/>`)
    .join('');
  const archivos: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`${decl}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
    '_rels/.rels': strToU8(`${decl}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${tipoRel('officeDocument')}" Target="word/document.xml"/></Relationships>`),
    'word/document.xml': typeof o.documentoXml === 'string' ? strToU8(o.documentoXml) : (o.documentoXml ?? strToU8(documento(o.cuerpo))),
    'word/_rels/document.xml.rels': strToU8(`${decl}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`),
  };
  for (const e of extras) archivos[`word/${e.nombre}`] = typeof e.xml === 'string' ? strToU8(e.xml) : e.xml;
  for (const [k, v] of Object.entries(o.entradas ?? {})) archivos[k] = typeof v === 'string' ? strToU8(v) : v;
  return zipSync(archivos, { level: 6, mtime: new Date(2020, 0, 1) });
}

/** Codifica texto en UTF-16 (con o sin BOM). */
export function utf16(s: string, endian: 'le' | 'be', bom: boolean): Uint8Array {
  const out: number[] = bom ? (endian === 'le' ? [0xff, 0xfe] : [0xfe, 0xff]) : [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (endian === 'le') out.push(c & 0xff, c >> 8); else out.push(c >> 8, c & 0xff);
  }
  return Uint8Array.from(out);
}

/** Cambia en el directorio central el campo indicado de la entrada `nombre` (offset 20 = comprimido, 24 = real). */
export function parchearCentral(zip: Uint8Array, nombre: string, campo: 20 | 24, valor: number): Uint8Array {
  const d = zip.slice();
  const dv = new DataView(d.buffer);
  const n = strToU8(nombre);
  for (let i = 0; i + 46 <= d.length; i++) {
    if (dv.getUint32(i, true) !== 0x02014b50) continue;
    const nl = dv.getUint16(i + 28, true);
    if (nl === n.length && n.every((b, k) => d[i + 46 + k] === b)) { dv.setUint32(i + campo, valor, true); return d; }
  }
  throw new Error('entrada no encontrada');
}
