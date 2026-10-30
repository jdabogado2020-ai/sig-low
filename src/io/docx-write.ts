// PE-5 · Exportación a .docx mínimo propio de 3 partes (3.8, 6.9.2; V-36, V-40). Sin `docProps`, sin comentario de ZIP y con la
// fecha de cada entrada fija (1980-01-02). No conserva el formato del original (S-08). Solo contiene el texto de `RenderedOutput`.
//
// Una línea de la salida es un `w:p`; con `withHeadings`, la línea `=== rótulo ===` va en negrita (así `INV-X04` se cumple al pie
// de la letra: el texto del documento unido por párrafos es `joinOutput(out, '\n')`). Un `\t` cierra el `w:t`, inserta `<w:tab/>`
// y abre otro en el mismo `w:r`. Los caracteres no válidos en XML 1.0 se quitan solo aquí, al escribir, y se avisa con
// `CARACTERES_CONTROL`.
import { strToU8, zipSync } from 'fflate';
import { SiglowError } from '../core/types';
import type { ParseWarning } from '../core/types';
import { descargarBytes, nombreDescarga } from './txt-write';
import type { ContenidoExportable, OpcionesExportacion, ResultadoExportacion } from './txt-write';

export const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** `new Date(1980, 0, 2)`: la fecha UTC 1980-01-01 falla en UTC−5 (6.9.2). Con ella, la fecha DOS de cada entrada es 1980-01-02. */
export const FECHA_ENTRADAS = new Date(1980, 0, 2);

const DECLARACION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const CONTENT_TYPES = DECLARACION
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '</Types>';

const RELS = DECLARACION
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>';

/** U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, U+FFFE, U+FFFF y sustitutos sueltos (con `u`, un par válido es un solo punto de código). */
const NO_VALIDOS_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF\uD800-\uDFFF]/gu;

const escapar = (s: string): string => s.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

interface Parrafo { texto: string; negrita: boolean }

/** Las líneas del documento, con la misma estructura que `joinOutput` (6.9): rótulo, texto, línea vacía entre secciones. */
function parrafosDe(contenido: ContenidoExportable): Parrafo[] {
  const lineas = (s: string): string[] => s.split(/\r\n|\r|\n/u);
  if (typeof contenido === 'string') return lineas(contenido).map((texto) => ({ texto, negrita: false }));
  const out: Parrafo[] = [];
  contenido.sections.forEach((sec, i) => {
    if (i > 0) out.push({ texto: '', negrita: false });
    if (contenido.withHeadings) out.push({ texto: '=== ' + sec.label + ' ===', negrita: true });
    for (const l of lineas(sec.text)) out.push({ texto: l, negrita: false });
  });
  return out;
}

/** `w:p` de una línea: `<w:p/>` si está vacía; un `w:r` con un `w:t` por tramo entre tabulaciones. */
function xmlParrafo(p: Parrafo): string {
  if (p.texto === '') return '<w:p/>';
  const tramos = p.texto.split('\t').map((t) => (t === '' ? '' : `<w:t xml:space="preserve">${escapar(t)}</w:t>`));
  return '<w:p><w:r>' + (p.negrita ? '<w:rPr><w:b/></w:rPr>' : '') + tramos.join('<w:tab/>') + '</w:r></w:p>';
}

export interface DocxConstruido { bytes: Uint8Array; avisos: ParseWarning[] }

/** Construye el `.docx` (sin descargarlo). Entradas, en orden: `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`. */
export function construirDocx(contenido: ContenidoExportable): DocxConstruido {
  let quitados = 0;
  const parrafos = parrafosDe(contenido).map((p) => ({
    negrita: p.negrita,
    texto: p.texto.replace(NO_VALIDOS_XML, () => { quitados++; return ''; }),
  }));
  const documento = DECLARACION
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + parrafos.map(xmlParrafo).join('')
    + '</w:body></w:document>';
  const opciones = { mtime: FECHA_ENTRADAS, level: 6 } as const;
  let bytes: Uint8Array;
  try {
    bytes = zipSync({
      '[Content_Types].xml': [strToU8(CONTENT_TYPES), opciones],
      '_rels/.rels': [strToU8(RELS), opciones],
      'word/document.xml': [strToU8(documento), opciones],
    }, { mtime: FECHA_ENTRADAS });
  } catch {
    throw new SiglowError('ERROR_INTERNO');
  }
  return { bytes, avisos: quitados > 0 ? [{ code: 'CARACTERES_CONTROL', count: quitados }] : [] };
}

/**
 * Exporta y descarga el contenido como `.docx` mínimo con nombre neutro (6.9.2). Síncrona; PC-5 la llama en el manejador del clic
 * de «Descargar .docx», detrás de `exportGate.ok`, y muestra M-313 si `avisos` trae `CARACTERES_CONTROL`.
 */
export function exportarDocx(contenido: ContenidoExportable, opciones: OpcionesExportacion = {}): ResultadoExportacion {
  const { bytes, avisos } = construirDocx(contenido);
  const nombre = nombreDescarga(opciones.clase ?? 'anonimizado', 'docx', opciones.ahora);
  descargarBytes(bytes, MIME_DOCX, nombre);
  return { nombre, bytes: bytes.length, avisos };
}
