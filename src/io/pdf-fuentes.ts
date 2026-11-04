// F7 · Métricas de las fuentes estándar de PDF que usa el PDF con estilo: Helvetica, Times y Courier con negrita y cursiva
// (12 de las 14; Symbol y ZapfDingbats no se usan). Anchos en milésimas de em de las métricas AFM de Adobe para U+0020–U+007E;
// el resto de WinAnsi toma el ancho de su letra base (á → a) o uno típico. Cada fuente se declara en el PDF con `/Widths`, así el
// visor y este maquetador miden igual aunque una cifra de la tabla difiera un poco de la de la fuente que el visor tenga.
import type { Estilo } from './docx-estructura';

export type IdFuente = 'H' | 'HB' | 'HI' | 'HBI' | 'T' | 'TB' | 'TI' | 'TBI' | 'C' | 'CB' | 'CI' | 'CBI';
export const NOMBRE_BASE: Readonly<Record<IdFuente, string>> = {
  H: 'Helvetica', HB: 'Helvetica-Bold', HI: 'Helvetica-Oblique', HBI: 'Helvetica-BoldOblique',
  T: 'Times-Roman', TB: 'Times-Bold', TI: 'Times-Italic', TBI: 'Times-BoldItalic',
  C: 'Courier', CB: 'Courier-Bold', CI: 'Courier-Oblique', CBI: 'Courier-BoldOblique',
};

const D = (n: number): number[] => Array.from({ length: n }, () => 500);
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667,
  611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833,
  556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELVETICA_NEGRITA = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667,
  611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889,
  611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
const TIMES = [
  250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278, ...D(10), 278, 278, 564, 564, 564, 444, 921,
  722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611,
  333, 278, 333, 469, 500, 333,
  444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444,
  480, 200, 480, 541,
];
const TIMES_NEGRITA = [
  250, 333, 555, 500, 500, 1000, 833, 278, 333, 333, 500, 570, 250, 333, 250, 278, ...D(10), 333, 333, 570, 570, 570, 500, 930,
  722, 667, 722, 722, 667, 611, 778, 778, 389, 500, 778, 667, 944, 722, 778, 611, 778, 722, 556, 667, 722, 722, 1000, 722, 722, 667,
  333, 278, 333, 581, 500, 333,
  500, 556, 444, 556, 444, 333, 500, 556, 278, 333, 556, 278, 833, 556, 500, 556, 556, 444, 389, 333, 556, 500, 722, 500, 500, 444,
  394, 220, 394, 520,
];
const TIMES_CURSIVA = [
  250, 333, 420, 500, 500, 833, 778, 214, 333, 333, 500, 675, 250, 333, 250, 278, ...D(10), 333, 333, 675, 675, 675, 500, 920,
  611, 611, 667, 722, 611, 611, 722, 722, 333, 444, 667, 556, 833, 667, 722, 611, 722, 611, 500, 556, 722, 611, 833, 611, 556, 556,
  389, 278, 389, 422, 500, 333,
  500, 500, 444, 500, 444, 278, 500, 500, 278, 278, 444, 278, 722, 500, 500, 500, 500, 389, 389, 278, 500, 444, 667, 444, 444, 389,
  400, 275, 400, 541,
];
const TIMES_NEGRITA_CURSIVA = [
  250, 389, 555, 500, 500, 833, 778, 278, 333, 333, 500, 570, 250, 333, 250, 278, ...D(10), 333, 333, 570, 570, 570, 500, 832,
  667, 667, 667, 722, 667, 667, 722, 778, 389, 500, 667, 611, 889, 722, 722, 611, 722, 667, 556, 611, 722, 667, 889, 667, 611, 611,
  333, 278, 333, 570, 500, 333,
  500, 500, 444, 500, 444, 333, 500, 556, 278, 278, 500, 278, 778, 556, 500, 500, 500, 389, 389, 278, 556, 444, 667, 500, 444, 389,
  348, 220, 348, 570,
];
const TABLA: Readonly<Record<IdFuente, number[] | null>> = {
  H: HELVETICA, HB: HELVETICA_NEGRITA, HI: HELVETICA, HBI: HELVETICA_NEGRITA,
  T: TIMES, TB: TIMES_NEGRITA, TI: TIMES_CURSIVA, TBI: TIMES_NEGRITA_CURSIVA,
  C: null, CB: null, CI: null, CBI: null,
};
/** Signos fuera de ASCII: [Helvetica, Times]. */
const ESPECIAL: Readonly<Record<string, readonly [number, number]>> = {
  '¿': [611, 444], '¡': [333, 333], '°': [400, 400], 'º': [365, 310], 'ª': [370, 276], '«': [556, 500], '»': [556, 500],
  '€': [556, 500], '–': [556, 500], '—': [1000, 1000], '“': [333, 444], '”': [333, 444], '‘': [222, 333], '’': [222, 333],
  '•': [350, 350], '…': [1000, 1000], '§': [556, 500], '©': [737, 760], '®': [737, 760], '·': [278, 250], '×': [584, 564],
  'Æ': [1000, 889], 'æ': [889, 667], 'ß': [611, 500], 'µ': [556, 500], ' ': [278, 250], '­': [333, 333],
};

/** Ancho de un carácter (ya en WinAnsi) en milésimas de em. */
export function anchoFuente(c: string, id: IdFuente): number {
  const tabla = TABLA[id];
  if (tabla === null) return 600; // Courier: monoespaciada
  const cp = c.codePointAt(0) ?? 0x3f;
  if (cp >= 0x20 && cp <= 0x7e) return tabla[cp - 0x20] ?? 500;
  const esp = ESPECIAL[c];
  if (esp !== undefined) return id.startsWith('H') ? esp[0] : esp[1];
  const base = c.normalize('NFD').charCodeAt(0);
  return base >= 0x20 && base <= 0x7e ? (tabla[base - 0x20] ?? 500) : 500;
}

/** La fuente de un estilo. */
export function idFuente(e: Estilo): IdFuente {
  const pre = e.fuente === 'Times' ? 'T' : e.fuente === 'Courier' ? 'C' : 'H';
  return `${pre}${e.negrita ? 'B' : ''}${e.cursiva ? 'I' : ''}` as IdFuente;
}

/** U+0080–U+009F de WinAnsiEncoding (cp1252), por código. */
const ALTO: ReadonlyMap<number, string> = new Map([
  [0x80, '€'], [0x82, '‚'], [0x83, 'ƒ'], [0x84, '„'], [0x85, '…'], [0x86, '†'], [0x87, '‡'], [0x88, 'ˆ'], [0x89, '‰'], [0x8a, 'Š'],
  [0x8b, '‹'], [0x8c, 'Œ'], [0x8e, 'Ž'], [0x91, '‘'], [0x92, '’'], [0x93, '“'], [0x94, '”'], [0x95, '•'], [0x96, '–'], [0x97, '—'],
  [0x98, '˜'], [0x99, '™'], [0x9a, 'š'], [0x9b, '›'], [0x9c, 'œ'], [0x9e, 'ž'], [0x9f, 'Ÿ'],
]);

/** Diccionario de la fuente con `/Widths` de 32 a 255 (WinAnsi). */
export function diccionarioFuente(id: IdFuente): string {
  const anchos: number[] = [];
  for (let b = 32; b <= 255; b++) {
    const c = b < 0x80 ? String.fromCharCode(b) : b <= 0x9f ? ALTO.get(b) : String.fromCharCode(b);
    anchos.push(c === undefined ? 0 : anchoFuente(c, id));
  }
  return `<< /Type /Font /Subtype /Type1 /BaseFont /${NOMBRE_BASE[id]} /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 255 /Widths [${anchos.join(' ')}] >>`;
}
