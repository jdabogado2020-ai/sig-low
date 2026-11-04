// F4 · PDF propio (como `docx-write.ts`): un escritor mínimo de PDF 1.4 sin dependencias nuevas (fflate para comprimir).
//   · `construirPdf`: PDF de texto desde la salida (texto pegado, .txt, o un .docx que no admite el .docx fiel): Helvetica con
//     WinAnsiEncoding (las 14 fuentes estándar: nada incrustado), tamaño carta, párrafos con ajuste de línea y filas de tabla (las
//     líneas con tabuladores) en columnas iguales, sin los rótulos «=== … ===» (F7). Un carácter fuera de WinAnsi se sustituye
//     por «?» y se cuenta. El PDF de un .docx con su formato lo arma `pdf-maqueta.ts` (F7) con los ayudantes de aquí.
//   · `pdfDeImagenes`: PDF con una imagen RGB por página, del tamaño de la página original (lo usa `pdf-tachar.ts`).
// Sin /Info, sin /ID, sin XMP, sin fechas: el archivo no lleva metadatos. Errores solo con ErrorCode.
import { zlibSync } from 'fflate';
import { SiglowError } from '../core/types';
import type { ParseWarning } from '../core/types';
import { descargarBytes, nombreDescarga } from './txt-write';
import type { ContenidoExportable, OpcionesExportacion, ResultadoExportacion } from './txt-write';

export const MIME_PDF = 'application/pdf';

// ---------------------------------------------------------------------------------------------------------------------
// Objetos y estructura del archivo
// ---------------------------------------------------------------------------------------------------------------------

export const ascii = (s: string): Uint8Array => {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
};
const unir = (partes: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of partes) { out.set(p, o); o += p.length; }
  return out;
};
/** Número PDF con hasta 3 decimales y sin ceros sobrantes. */
export const num = (n: number): string => (Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '0');

/** Cuerpo de un objeto con flujo comprimido (FlateDecode = zlib). */
export function objetoConFlujo(dict: string, datos: Uint8Array): Uint8Array {
  const z = zlibSync(datos, { level: 6 });
  return unir([ascii(`<< ${dict} /Filter /FlateDecode /Length ${z.length} >>\nstream\n`), z, ascii('\nendstream')]);
}

/** Arma el archivo: el objeto `i` del arreglo es el número `i + 1`; el 1 es el catálogo. */
export function armarPdf(objetos: Array<string | Uint8Array>): Uint8Array {
  const partes: Uint8Array[] = [ascii('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
  let pos = partes[0]?.length ?? 0;
  const offsets: number[] = [];
  objetos.forEach((o, i) => {
    offsets.push(pos);
    const cuerpo = typeof o === 'string' ? ascii(o) : o;
    const b = unir([ascii(`${i + 1} 0 obj\n`), cuerpo, ascii('\nendobj\n')]);
    partes.push(b);
    pos += b.length;
  });
  const xref = [`xref\n0 ${objetos.length + 1}\n`, '0000000000 65535 f \n', ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  partes.push(ascii(`${xref}trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
  return unir(partes);
}

// ---------------------------------------------------------------------------------------------------------------------
// PDF de imágenes (tachado)
// ---------------------------------------------------------------------------------------------------------------------

export interface PaginaImagen {
  /** Tamaño de la página en puntos (el de la página original, ya girada). */
  ancho: number; alto: number;
  /** Tamaño de la imagen en píxeles y sus bytes RGB (3 por píxel, fila a fila desde arriba). */
  pixAncho: number; pixAlto: number; rgb: Uint8Array;
}

/** Una imagen por página, a página completa. Sin texto, sin fuentes, sin anotaciones. */
export function pdfDeImagenes(paginas: PaginaImagen[]): Uint8Array {
  if (paginas.length === 0) throw new SiglowError('ERROR_INTERNO');
  const objetos: Array<string | Uint8Array> = ['', ''];
  const kids: number[] = [];
  for (const p of paginas) {
    if (p.rgb.length !== p.pixAncho * p.pixAlto * 3) throw new SiglowError('ERROR_INTERNO');
    const nPagina = objetos.length + 1;
    const nImagen = nPagina + 1;
    const nContenido = nPagina + 2;
    objetos.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.ancho)} ${num(p.alto)}] /Resources << /XObject << /Im0 ${nImagen} 0 R >> >> /Contents ${nContenido} 0 R >>`);
    objetos.push(objetoConFlujo(`/Type /XObject /Subtype /Image /Width ${p.pixAncho} /Height ${p.pixAlto} /ColorSpace /DeviceRGB /BitsPerComponent 8`, p.rgb));
    objetos.push(objetoConFlujo('', ascii(`q ${num(p.ancho)} 0 0 ${num(p.alto)} 0 0 cm /Im0 Do Q`)));
    kids.push(nPagina);
  }
  objetos[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objetos[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  return armarPdf(objetos);
}

// ---------------------------------------------------------------------------------------------------------------------
// PDF de texto: Helvetica WinAnsi
// ---------------------------------------------------------------------------------------------------------------------

/** Anchos (milésimas de em) de U+0020 a U+007E, de las métricas AFM de Helvetica y Helvetica-Bold. */
const ANCHO_REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667,
  611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833,
  556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const ANCHO_NEGRITA = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667,
  611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889,
  611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
const ANCHO_ESPECIAL: Readonly<Record<string, [number, number]>> = {
  '¿': [611, 611], '¡': [333, 333], '°': [400, 400], 'º': [365, 365], 'ª': [370, 370], '«': [556, 556], '»': [556, 556],
  '€': [556, 556], '–': [556, 556], '—': [1000, 1000], '“': [333, 500], '”': [333, 500], '‘': [222, 278], '’': [222, 278],
  '•': [350, 350], '…': [1000, 1000], '§': [556, 556], '©': [737, 737], '®': [737, 737], '·': [278, 278], '×': [584, 584],
  'Æ': [1000, 1000], 'æ': [889, 889], 'ß': [611, 611], 'µ': [556, 611], ' ': [278, 278],
};
/** U+0080–U+009F de WinAnsiEncoding (cp1252). */
const WINANSI_ALTO: ReadonlyMap<string, number> = new Map([
  ['€', 0x80], ['‚', 0x82], ['ƒ', 0x83], ['„', 0x84], ['…', 0x85], ['†', 0x86], ['‡', 0x87], ['ˆ', 0x88], ['‰', 0x89], ['Š', 0x8a],
  ['‹', 0x8b], ['Œ', 0x8c], ['Ž', 0x8e], ['‘', 0x91], ['’', 0x92], ['“', 0x93], ['”', 0x94], ['•', 0x95], ['–', 0x96], ['—', 0x97],
  ['˜', 0x98], ['™', 0x99], ['š', 0x9a], ['›', 0x9b], ['œ', 0x9c], ['ž', 0x9e], ['Ÿ', 0x9f],
]);

function anchoDe(c: string, negrita: boolean): number {
  const cp = c.codePointAt(0) ?? 0x3f;
  const tabla = negrita ? ANCHO_NEGRITA : ANCHO_REGULAR;
  if (cp >= 0x20 && cp <= 0x7e) return tabla[cp - 0x20] ?? 556;
  const esp = ANCHO_ESPECIAL[c];
  if (esp !== undefined) return negrita ? esp[1] : esp[0];
  const base = c.normalize('NFD').charCodeAt(0); // á → a, Ñ → N
  return base >= 0x20 && base <= 0x7e ? (tabla[base - 0x20] ?? 556) : 556;
}

/** Equivalencias antes de codificar (guiones y espacios tipográficos); lo demás fuera de WinAnsi pasa a «?». */
function equivalente(c: string): string {
  if (/[‐‑‒−]/u.test(c)) return '-';
  if (/[ -   　]/u.test(c)) return ' ';
  if (/[​‌‍⁠﻿]/u.test(c)) return '';
  return c;
}

/** Texto ya en WinAnsi (un carácter = un byte) y cuántos se sustituyeron. */
export function aWinAnsi(s: string): { texto: string; sustituidos: number } {
  let out = '';
  let sustituidos = 0;
  for (const c0 of s.normalize('NFC')) {
    const c = equivalente(c0);
    if (c === '') continue;
    const cp = c.codePointAt(0) ?? 0;
    // El tabulador pasa: separa las celdas de una fila de tabla y nunca llega al flujo de la página.
    if (cp === 0x09 || (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WINANSI_ALTO.has(c)) out += c;
    else { out += '?'; sustituidos++; }
  }
  return { texto: out, sustituidos };
}

/** Cadena literal PDF con los bytes WinAnsi: `\`, `(`, `)` escapados y lo no ASCII en octal. */
export function literal(s: string): string {
  let out = '(';
  for (const c of s) {
    const b = WINANSI_ALTO.get(c) ?? (c.codePointAt(0) ?? 0x3f);
    if (c === '\\' || c === '(' || c === ')') out += `\\${c}`;
    else if (b < 0x20 || b > 0x7e) out += `\\${b.toString(8).padStart(3, '0')}`;
    else out += c;
  }
  return `${out})`;
}

const ANCHO_CARTA = 612;
const ALTO_CARTA = 792;
const MARGEN = 72;
const TAMANO = 11;
const INTERLINEA = 14.5;
const SEPARACION_COLUMNAS = 12;

const medir = (s: string, negrita: boolean): number => [...s].reduce((n, c) => n + anchoDe(c, negrita), 0) * TAMANO / 1000;

/** Ajusta una línea al ancho dado: corta en espacios y, si una palabra no cabe sola, la parte. */
function ajustar(s: string, ancho: number, negrita: boolean): string[] {
  if (s === '') return [''];
  const out: string[] = [];
  let actual = '';
  for (const palabra of s.split(' ')) {
    const prueba = actual === '' ? palabra : `${actual} ${palabra}`;
    if (medir(prueba, negrita) <= ancho) { actual = prueba; continue; }
    if (actual !== '') out.push(actual);
    actual = '';
    let resto = palabra;
    while (medir(resto, negrita) > ancho) {
      let k = resto.length;
      while (k > 1 && medir(resto.slice(0, k), negrita) > ancho) k--;
      out.push(resto.slice(0, k));
      resto = resto.slice(k);
    }
    actual = resto;
  }
  out.push(actual);
  return out;
}

interface Linea { texto: string; negrita: boolean }

/**
 * Las líneas lógicas de la salida: las secciones separadas por una línea vacía. F7 (v1.1.1): el PDF nunca imprime los rótulos
 * «=== … ===» de las secciones (son para pegar el texto en otra herramienta, no parte del documento).
 */
function lineasDe(contenido: ContenidoExportable): Linea[] {
  const partir = (s: string): string[] => s.split(/\r\n|\r|\n/u);
  if (typeof contenido === 'string') return partir(contenido).map((texto) => ({ texto, negrita: false }));
  const out: Linea[] = [];
  contenido.sections.forEach((sec, i) => {
    if (i > 0) out.push({ texto: '', negrita: false });
    for (const l of partir(sec.text)) out.push({ texto: l, negrita: false });
  });
  return out;
}

export interface PdfConstruido {
  bytes: Uint8Array;
  /** Vacío: los caracteres de control se quitan sin aviso aparte (un PDF no tiene la restricción del XML). */
  avisos: ParseWarning[];
  /** Caracteres fuera de WinAnsi sustituidos por «?» (la interfaz lo advierte). */
  sustituidos: number;
}

/** Construye el PDF de texto (sin descargarlo). */
export function construirPdf(contenido: ContenidoExportable): PdfConstruido {
  const ancho = ANCHO_CARTA - 2 * MARGEN;
  let sustituidos = 0;
  const paginas: string[] = [];
  let flujo = '';
  let y = ALTO_CARTA - MARGEN - TAMANO;
  const nuevaPagina = (): void => { paginas.push(flujo); flujo = ''; y = ALTO_CARTA - MARGEN - TAMANO; };
  const escribir = (x: number, s: string, negrita: boolean): void => {
    if (s !== '') flujo += `BT /${negrita ? 'F2' : 'F1'} ${TAMANO} Tf ${num(x)} ${num(y)} Td ${literal(s)} Tj ET\n`;
  };
  for (const l of lineasDe(contenido)) {
    const w = aWinAnsi(l.texto.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, ''));
    sustituidos += w.sustituidos;
    if (w.texto.includes('\t')) {
      // Fila de tabla: columnas iguales; la fila ocupa lo que su celda más larga.
      const celdas = w.texto.split('\t');
      const anchoCelda = (ancho - SEPARACION_COLUMNAS * (celdas.length - 1)) / celdas.length;
      const ajustadas = celdas.map((c) => (anchoCelda > TAMANO ? ajustar(c.trim(), anchoCelda, l.negrita) : [c.trim()]));
      const alto = Math.max(...ajustadas.map((a) => a.length));
      for (let k = 0; k < alto; k++) {
        if (y < MARGEN) nuevaPagina();
        ajustadas.forEach((a, j) => { escribir(MARGEN + j * (anchoCelda + SEPARACION_COLUMNAS), a[k] ?? '', l.negrita); });
        y -= INTERLINEA;
      }
      continue;
    }
    for (const trozo of ajustar(w.texto, ancho, l.negrita)) {
      if (y < MARGEN) nuevaPagina();
      escribir(MARGEN, trozo, l.negrita);
      y -= INTERLINEA;
    }
  }
  nuevaPagina();
  const objetos: Array<string | Uint8Array> = [
    '<< /Type /Catalog /Pages 2 0 R >>', '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  const kids: number[] = [];
  for (const f of paginas) {
    const nPagina = objetos.length + 1;
    objetos.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO_CARTA} ${ALTO_CARTA}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${nPagina + 1} 0 R >>`);
    objetos.push(objetoConFlujo('', ascii(f)));
    kids.push(nPagina);
  }
  objetos[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  return { bytes: armarPdf(objetos), avisos: [], sustituidos };
}

/** Exporta y descarga la salida como PDF de texto con nombre neutro (6.9). Síncrona, como `exportarDocx`. */
export function exportarPdf(contenido: ContenidoExportable, opciones: OpcionesExportacion = {}): ResultadoExportacion & { sustituidos: number } {
  const { bytes, avisos, sustituidos } = construirPdf(contenido);
  const nombre = nombreDescarga(opciones.clase ?? 'anonimizado', 'pdf', opciones.ahora);
  descargarPdf(bytes, nombre);
  return { nombre, bytes: bytes.length, avisos, sustituidos };
}

/** Descarga bytes PDF ya construidos (p. ej. el PDF tachado, que se arma de forma asíncrona antes del clic). */
export function descargarPdf(bytes: Uint8Array, nombre: string): void {
  descargarBytes(bytes, MIME_PDF, nombre);
}
