// Numerales y validadores de fechas (PA-6; plan 7.5.2 y 7.5.3). TypeScript puro: sin DOM, sin red, sin registro.
// `wordsToNumber` y `numberToWords` son el contrato de 7.5.2; `validDate` y `expandYY`, el de 7.5.3.
// Nada aquí conserva ni registra texto del documento.

export type NumeralMode = 'general' | 'dia' | 'anio';
export interface NumeralResult { value: number; tolerated: boolean }

/** Mayor valor admitido: 999 999 999 999 («billón» no existe en el vocabulario). */
export const NUMERAL_MAX = 999_999_999_999;

const UNITS: Readonly<Record<string, number>> = { cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
const ORD: Readonly<Record<string, number>> = { primero: 1, primer: 1 };
const TEENS: Readonly<Record<string, number>> = {
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintiun: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const TENS: Readonly<Record<string, number>> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const HUNDREDS: Readonly<Record<string, number>> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400,
  quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800,
  ochocientas: 800, novecientos: 900, novecientas: 900,
};

/** Vocabulario, con y sin tilde, para construir `{NW}` (7.5.4, R-FEC-06). */
export const NUMERAL_WORDS: readonly string[] = [
  'cero', 'uno', 'una', 'un', 'primero', 'primer', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'dieciseis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintiuna', 'veintiún', 'veintiun', 'veintidós', 'veintidos', 'veintitrés', 'veintitres',
  'veinticuatro', 'veinticinco', 'veintiséis', 'veintiseis', 'veintisiete', 'veintiocho', 'veintinueve',
  'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa',
  'cien', 'ciento', 'doscientos', 'doscientas', 'trescientos', 'trescientas', 'cuatrocientos', 'cuatrocientas',
  'quinientos', 'quinientas', 'seiscientos', 'seiscientas', 'setecientos', 'setecientas', 'ochocientos', 'ochocientas',
  'novecientos', 'novecientas', 'mil', 'millón', 'millon', 'millones',
];

/** Vista `lista` de una palabra o frase: minúsculas, sin diacríticos, espacios simples. */
function vistaLista(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/gu, '').normalize('NFC').replace(/\s+/gu, ' ').trim();
}

interface Parcial { v: number; tol: boolean }

/** Grupo < 1000. Devuelve su valor solo si consume TODOS los tokens. */
function below1000(tk: readonly string[], mode: NumeralMode): Parcial | null {
  let i = 0, v = 0, tol = false, any = false;
  const t = (): string | undefined => tk[i];
  const lookup = (tabla: Readonly<Record<string, number>>, w: string | undefined): number | undefined => (w !== undefined && Object.hasOwn(tabla, w) ? tabla[w] : undefined);
  const hundred = lookup(HUNDREDS, t());
  if (hundred !== undefined) {
    const w = t();
    v += hundred; i++; any = true;
    if (w === 'cien' && i < tk.length) tol = true;          // «cien uno» → 101 tolerado (lo correcto es «ciento uno»)
    if (w === 'ciento' && i >= tk.length) tol = true;       // «ciento» solo → 100 tolerado
  }
  const ten = lookup(TENS, t());
  const teen = lookup(TEENS, t());
  const unit = lookup(UNITS, t());
  if (ten !== undefined) {
    v += ten; i++; any = true;
    const siguiente = lookup(UNITS, tk[i + 1]);
    const actual = lookup(UNITS, t());
    if (t() === 'y' && siguiente !== undefined && tk[i + 1] !== 'cero') { v += siguiente; i += 2; }
    else if (actual !== undefined && t() !== 'cero') { v += actual; i++; tol = true; }   // «treinta uno»
  } else if (teen !== undefined) {
    const w = t();
    v += teen; i++; any = true;
    const siguiente = lookup(UNITS, tk[i + 1]);
    if ((w === 'diez' || w === 'veinte') && t() === 'y' && siguiente !== undefined && tk[i + 1] !== 'cero') {
      v += siguiente; i += 2; tol = true;                   // «diez y seis», «veinte y tres»
    }
  } else if (unit !== undefined) {
    if (t() === 'cero' && (any || tk.length > 1)) return null;
    v += unit; i++; any = true;
  } else {
    const ord = lookup(ORD, t());
    if (ord !== undefined && mode === 'dia' && !any) { v += ord; i++; any = true; }
  }
  if (!any || i !== tk.length) return null;
  return { v, tol };
}

/** Grupo < 1 000 000: `[G] mil [G]`. */
function thousands(tk: readonly string[], mode: NumeralMode): Parcial | null {
  const idxs: number[] = [];
  tk.forEach((w, k) => { if (w === 'mil') idxs.push(k); });
  if (idxs.length > 1) return null;
  const k = idxs[0];
  if (k === undefined) return below1000(tk, mode);
  const left = tk.slice(0, k), right = tk.slice(k + 1);
  let a = 1, tol = false;
  if (left.length > 0) {
    if (left.length === 1 && (left[0] === 'un' || left[0] === 'uno')) { a = 1; tol = true; }   // «un mil»
    else {
      const r = below1000(left, 'general');
      if (r === null || r.v < 2) return null;
      a = r.v; tol = tol || r.tol;
    }
  }
  let b = 0;
  if (right.length > 0) {
    const r = below1000(right, 'general');
    if (r === null) return null;
    b = r.v; tol = tol || r.tol;
  }
  return { v: a * 1000 + b, tol };
}

const PALABRAS_VALIDAS = new Set<string>(['y', 'millon', 'millones', 'mil']);
const conocida = (w: string): boolean => PALABRAS_VALIDAS.has(w) || [UNITS, TEENS, TENS, HUNDREDS, ORD].some((t) => Object.hasOwn(t, w));

/**
 * Frase numeral del español de Colombia → entero en [0, 999 999 999 999]; `null` si no es una frase válida.
 * Ignora mayúsculas y tildes; `dia` acepta «primero/primer» = 1; `anio` tolera «dos <1..99>» = 2000 + n.
 */
export function wordsToNumber(phrase: string, mode: NumeralMode = 'general'): NumeralResult | null {
  const norm = vistaLista(phrase).replace(/-/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (norm === '') return null;
  const tk = norm.split(' ');
  if (!tk.every(conocida)) return null;
  if (tk[0] === 'y' || tk[tk.length - 1] === 'y') return null;
  // Año tolerante: «dos veintitrés» → 2023 (falta «mil»).
  if (mode === 'anio' && tk[0] === 'dos' && tk[1] !== 'mil' && tk.length > 1) {
    const r = below1000(tk.slice(1), 'general');
    if (r !== null && r.v >= 1 && r.v <= 99) return { value: 2000 + r.v, tolerated: true };
  }
  const mi: number[] = [];
  tk.forEach((w, k) => { if (w === 'millon' || w === 'millones') mi.push(k); });
  if (mi.length > 1) return null;
  let value: number, tolerated: boolean;
  const k = mi[0];
  if (k !== undefined) {
    const left = tk.slice(0, k), right = tk.slice(k + 1);
    let m: number, tol = false;
    if (left.length === 0) {
      if (tk[k] === 'millon') { m = 1; tol = true; } else return null;
    } else {
      const r = thousands(left, 'general');
      if (r === null || r.v < 1) return null;
      m = r.v; tol = r.tol;
    }
    if (m === 1 && tk[k] === 'millones') tol = true;
    if (m > 1 && tk[k] === 'millon') tol = true;
    let rest = 0;
    if (right.length > 0) {
      const r = thousands(right, 'general');
      if (r === null) return null;
      rest = r.v; tol = tol || r.tol;
    }
    value = m * 1e6 + rest; tolerated = tol;
  } else {
    const r = thousands(tk, mode);
    if (r === null) return null;
    value = r.v; tolerated = r.tol;
  }
  if (value > NUMERAL_MAX) return null;
  return { value, tolerated };
}

const W1 = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
  'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco',
  'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const WT: Readonly<Record<number, string>> = { 3: 'treinta', 4: 'cuarenta', 5: 'cincuenta', 6: 'sesenta', 7: 'setenta', 8: 'ochenta', 9: 'noventa' };
const WH: Readonly<Record<number, string>> = { 1: 'ciento', 2: 'doscientos', 3: 'trescientos', 4: 'cuatrocientos', 5: 'quinientos', 6: 'seiscientos', 7: 'setecientos', 8: 'ochocientos', 9: 'novecientos' };

function w999(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cien';
  const h = Math.floor(n / 100), r = n % 100, out: string[] = [];
  if (h > 0) out.push(WH[h] ?? '');
  if (r > 0) {
    if (r < 30) out.push(W1[r] ?? '');
    else {
      const t = Math.floor(r / 10), u = r % 10;
      out.push(u > 0 ? `${WT[t] ?? ''} y ${W1[u] ?? ''}` : WT[t] ?? '');
    }
  }
  return out.join(' ');
}
const apocope = (s: string): string => s.replace(/veintiuno$/u, 'veintiún').replace(/(^| )uno$/u, '$1un');
function w999999(n: number): string {
  const a = Math.floor(n / 1000), b = n % 1000;
  const parts: string[] = [];
  if (a === 1) parts.push('mil'); else if (a > 1) parts.push(apocope(w999(a)) + ' mil');
  if (b > 0) parts.push(w999(b));
  return parts.join(' ');
}

/** Entero → forma canónica en letras («cuarenta y ocho millones»); `null` fuera de [0, 999 999 999 999]. */
export function numberToWords(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > NUMERAL_MAX) return null;
  if (n === 0) return 'cero';
  const m = Math.floor(n / 1e6), r = n % 1e6, parts: string[] = [];
  if (m === 1) parts.push('un millón'); else if (m > 1) parts.push(apocope(w999999(m)) + ' millones');
  if (r > 0) parts.push(w999999(r));
  return parts.join(' ');
}

// ---------------------------------------------------------------------------------------------------------------------
// Meses y validador FECHA (7.5.1 y 7.5.3)
// ---------------------------------------------------------------------------------------------------------------------
export const MESES: readonly string[] = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
export const MES_ABR: readonly string[] = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'sep', 'set', 'oct', 'nov', 'dic'];
const MES_NUM: Readonly<Record<string, number>> = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12 };

/** Mes (1 a 12) de un nombre o abreviatura, con punto opcional; `null` si no lo reconoce. */
export function monthNum(s: string): number | null {
  const k = vistaLista(s).replace(/\./gu, '');
  if (k.startsWith('sept') || k === 'setiembre' || k === 'septiembre') return 9;
  const abreviado = k.slice(0, 3);
  return Object.hasOwn(MES_NUM, abreviado) ? MES_NUM[abreviado] ?? null : null;
}

const ROMANOS: Readonly<Record<string, number>> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
/** Mes (1 a 12) de un numeral romano en mayúscula; `null` si no lo es. */
export const romanMonth = (s: string): number | null => (Object.hasOwn(ROMANOS, s) ? ROMANOS[s] ?? null : null);

export const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const DIAS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
export const daysIn = (y: number, m: number): number => (m === 2 && isLeap(y) ? 29 : DIAS[m - 1] ?? 0);

/** Validador `FECHA`: año 1900–2099, mes 1–12 y día dentro del mes, con bisiestos. Solo califica: nunca descarta (INV-G12). */
export function validDate(y: number, m: number, d: number): boolean {
  return Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) && y >= 1900 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);
}

/** `AAAA-MM-DD`. */
export const isoDate = (y: number, m: number, d: number): string => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Año de dos cifras → cuatro: de 00 a (AA de referencia + 1) → 20AA; el resto → 19AA. */
export function expandYY(aa: number, refYear: number): number {
  const limite = (refYear % 100) + 1;
  return aa <= limite ? 2000 + aa : 1900 + aa;
}
