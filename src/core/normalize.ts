// Normalización y mapa de offsets (PA-1; plan 6.1.2 y 7.1).
// TypeScript puro: sin DOM, sin red, sin registro. No guarda estado entre llamadas y no conserva el texto.
//
// Una vista de búsqueda es una función pura del texto canónico, del perfil y del tipo de parte.
// Se construye en dos pasos:
//   1. Flujo de unidades UTF-16 (perfil `reglas`, 7.1.2): eliminar, convertir y colapsar espacios; cada unidad
//      conserva el tramo canónico [s, e) de su carácter de origen.
//   2. Uniones de saltos de línea (7.1.5) y transformación propia del perfil (7.1.3).
// Todas las comprobaciones de la sección 7.1.5 se hacen sobre el flujo ya normalizado (después de eliminar
// invisibles y convertir guiones), de modo que la vista `reglas` es idempotente (INV-S03).
//
// ADVERTENCIA PARA LAS REGLAS (PA-2 a PA-7): las uniones de saltos de 7.1.5 («1.000.⏎000», «03-⏎999») dependen de los
// dígitos de ambos lados del salto. Un tramo de la vista que parta una racha de dígitos, o que arranque en el «-» o el
// «.» pegado a ella, vuelve a un recorte canónico cuya vista ya no lo contiene (INV-S02 vale para tramos que no hacen
// eso). Las expresiones del catálogo ya lo respetan con las fronteras NL/NR de 7.2.0; no capturen un tramo que
// empiece en ese separador ni lo corten por dentro de una racha de dígitos.
import type { NormalizationProfile, PartKind, SearchView } from './types.ts';

// ---------------------------------------------------------------- tabla 7.1.2

const SP = 0x20;
const LF = 0x0a;
const HYPHEN = 0x2d;
const DOT = 0x2e;

/** Reemplazo de un punto de código en el perfil `reglas`: -1 = se elimina; si no, el punto de código resultante. */
function replacement(cp: number): number {
  if (cp < 0xa0) return cp;
  switch (cp) {
    case 0x00a0: case 0x1680: case 0x202f: case 0x205f: case 0x3000:
      return SP;                                           // Zs distintos de U+0020 → espacio
    case 0x00ad: case 0x2060: case 0xfeff:
      return -1;                                           // guion blando, unión de palabras, BOM
    case 0x00b0:
      return 0x00ba;                                       // ° → º
    case 0x00b4: case 0x02bc: case 0x2018: case 0x2019: case 0x2032:
      return 0x27;                                         // apóstrofos tipográficos, acento agudo suelto y prima → '
    case 0x2116: case 0xff03:
      return 0x23;                                         // № y ＃ → #
    case 0x2212: case 0xfe58: case 0xfe63: case 0xff0d:
      return HYPHEN;                                       // signo menos y guiones de ancho completo y pequeños → -
    default:
      break;
  }
  if (cp >= 0x2000 && cp <= 0x200a) return SP;             // espacios de anchura fija
  if (cp >= 0x200b && cp <= 0x200f) return -1;             // ceros de ancho y marcas direccionales
  if (cp >= 0x2010 && cp <= 0x2015) return HYPHEN;         // guiones tipográficos
  if (cp >= 0x202a && cp <= 0x202e) return -1;             // controles bidireccionales
  if (cp >= 0x2066 && cp <= 0x2069) return -1;             // aislamientos bidireccionales
  return cp;
}

// ---------------------------------------------------------------- flujo de entradas

/** Entradas {ch, s, e}: unidad UTF-16 de la vista y tramo canónico [s, e) de su carácter de origen. */
interface Entries {
  ch: Uint16Array;
  s: Uint32Array;
  e: Uint32Array;
  n: number;
}

function newEntries(capacity: number): Entries {
  return { ch: new Uint16Array(capacity), s: new Uint32Array(capacity), e: new Uint32Array(capacity), n: 0 };
}

function grow(en: Entries, extra: number): void {
  if (en.n + extra <= en.ch.length) return;
  const cap = Math.max(en.ch.length * 2, en.n + extra, 16);
  const ch = new Uint16Array(cap);
  const s = new Uint32Array(cap);
  const e = new Uint32Array(cap);
  ch.set(en.ch.subarray(0, en.n));
  s.set(en.s.subarray(0, en.n));
  e.set(en.e.subarray(0, en.n));
  en.ch = ch;
  en.s = s;
  en.e = e;
}

function push(en: Entries, unit: number, s: number, e: number): void {
  grow(en, 1);
  en.ch[en.n] = unit;
  en.s[en.n] = s;
  en.e[en.n] = e;
  en.n += 1;
}

/** Empuja un espacio; si la última entrada ya es un espacio, un solo espacio cubre a todos (colapso). */
function pushSpace(en: Entries, s: number, e: number): void {
  if (en.n > 0 && en.ch[en.n - 1] === SP) {
    en.e[en.n - 1] = e;
    return;
  }
  push(en, SP, s, e);
}

/** Paso 1 (7.1.2): eliminar, convertir y colapsar espacios. */
function reglasEntries(text: string): Entries {
  const en = newEntries(text.length);
  const len = text.length;
  let i = 0;
  while (i < len) {
    const cp = text.codePointAt(i) ?? 0;
    const w = cp > 0xffff ? 2 : 1;
    const r = replacement(cp);
    if (r === SP) {
      pushSpace(en, i, i + w);
    } else if (r >= 0) {
      if (w === 1) {
        push(en, r, i, i + 1);
      } else {
        // Par sustituto (sin cambios): dos unidades con el mismo tramo canónico; ningún tramo lo corta.
        push(en, text.charCodeAt(i), i, i + 2);
        push(en, text.charCodeAt(i + 1), i, i + 2);
      }
    }
    i += w;
  }
  return en;
}

// ---------------------------------------------------------------- uniones de saltos (7.1.5)

const LOWER_LETTER = /^\p{Ll}$/u;

function isDigit(unit: number | undefined): boolean {
  return unit !== undefined && unit >= 0x30 && unit <= 0x39;
}

function isLowerLetter(unit: number | undefined): boolean {
  return unit !== undefined && LOWER_LETTER.test(String.fromCharCode(unit));
}

/**
 * Marca las entradas que 7.1.5 manda eliminar. Devuelve null si no hay ninguna.
 *  a) «…-⏎…» entre dígitos: se elimina el salto (cualquier parte).
 *  b) «1.000.⏎000»: grupo de 1 a 3 dígitos antes del punto y exactamente 3 después del salto (cualquier parte).
 *  c) «Fic-⏎ticia»: minúscula, guion, salto, minúscula; se eliminan guion y salto (solo PDF).
 */
function markJoins(en: Entries, pdf: boolean): Uint8Array | null {
  const { ch, n } = en;
  let removed: Uint8Array | null = null;
  for (let k = 1; k < n; k += 1) {
    if (ch[k] !== LF) continue;
    const prev = ch[k - 1];
    if (prev === HYPHEN) {
      if (isDigit(ch[k - 2]) && isDigit(ch[k + 1])) {
        removed ??= new Uint8Array(n);
        removed[k] = 1;
      } else if (pdf && isLowerLetter(ch[k - 2]) && isLowerLetter(ch[k + 1])) {
        removed ??= new Uint8Array(n);
        removed[k - 1] = 1;
        removed[k] = 1;
      }
    } else if (prev === DOT) {
      let before = 0;
      while (before < 4 && isDigit(ch[k - 2 - before])) before += 1;
      if (before < 1 || before > 3) continue;
      if (isDigit(ch[k + 1]) && isDigit(ch[k + 2]) && isDigit(ch[k + 3]) && !isDigit(ch[k + 4])) {
        removed ??= new Uint8Array(n);
        removed[k] = 1;
      }
    }
  }
  return removed;
}

// ---------------------------------------------------------------- perfiles (7.1.3)

const COMBINING_FIRST = 0x0300;
const COMBINING_LAST = 0x036f;
const BLANK = /\s/u;

function isBlankUnit(unit: number): boolean {
  if (unit < 0x80) return unit === SP || (unit >= 0x09 && unit <= 0x0d);
  return BLANK.test(String.fromCharCode(unit));
}

/** Perfil `lista`: minúsculas, NFD sin marcas U+0300–U+036F (ñ → n), todo blanco → un espacio con colapso. */
function listaFrom(src: Entries, removed: Uint8Array | null): Entries {
  const out = newEntries(src.n);
  const { ch, s, e, n } = src;
  for (let k = 0; k < n; k += 1) {
    if (removed?.[k] === 1) continue;
    const unit = ch[k] ?? 0;
    const sk = s[k] ?? 0;
    const ek = e[k] ?? 0;
    if (unit < 0x80) {
      if (isBlankUnit(unit)) pushSpace(out, sk, ek);
      else push(out, unit >= 0x41 && unit <= 0x5a ? unit + 0x20 : unit, sk, ek);
      continue;
    }
    // Se transforma por punto de código, nunca por contexto (la sigma final no depende de los vecinos).
    let cpStr: string;
    if (unit >= 0xd800 && unit <= 0xdbff && k + 1 < n && s[k + 1] === sk && removed?.[k + 1] !== 1
      && (ch[k + 1] ?? 0) >= 0xdc00 && (ch[k + 1] ?? 0) <= 0xdfff) {
      cpStr = String.fromCharCode(unit, ch[k + 1] ?? 0);
      k += 1;
    } else {
      cpStr = String.fromCharCode(unit);
    }
    const t = cpStr.toLowerCase().normalize('NFD');
    for (let j = 0; j < t.length; j += 1) {
      const u = t.charCodeAt(j);
      if (u >= COMBINING_FIRST && u <= COMBINING_LAST) continue;
      if (isBlankUnit(u)) pushSpace(out, sk, ek);
      else push(out, u, sk, ek);
    }
  }
  return out;
}

/** Perfil `digitos` (solo `[0-9]`) o su variante `digitos+letras` (`[A-Z0-9]`, letras ASCII en mayúscula). */
function digitosFrom(src: Entries, removed: Uint8Array | null, letters: boolean): Entries {
  const out = newEntries(src.n);
  const { ch, s, e, n } = src;
  for (let k = 0; k < n; k += 1) {
    if (removed?.[k] === 1) continue;
    const unit = ch[k] ?? 0;
    if (unit >= 0x30 && unit <= 0x39) push(out, unit, s[k] ?? 0, e[k] ?? 0);
    else if (letters && unit >= 0x41 && unit <= 0x5a) push(out, unit, s[k] ?? 0, e[k] ?? 0);
    else if (letters && unit >= 0x61 && unit <= 0x7a) push(out, unit - 0x20, s[k] ?? 0, e[k] ?? 0);
  }
  return out;
}

function reglasFrom(src: Entries, removed: Uint8Array | null): Entries {
  if (removed === null) return src;
  const out = newEntries(src.n);
  for (let k = 0; k < src.n; k += 1) {
    if (removed[k] === 1) continue;
    push(out, src.ch[k] ?? 0, src.s[k] ?? 0, src.e[k] ?? 0);
  }
  return out;
}

// ---------------------------------------------------------------- salida

const CHUNK = 8192;

function unitsToString(units: Uint16Array, n: number): string {
  if (n === 0) return '';
  let out = '';
  for (let i = 0; i < n; i += CHUNK) {
    out += String.fromCharCode(...units.subarray(i, Math.min(n, i + CHUNK)));
  }
  return out;
}

function finish(profile: NormalizationProfile, en: Entries, canonicalLength: number): SearchView {
  const startMap = new Uint32Array(en.n + 1);
  startMap.set(en.s.subarray(0, en.n));
  startMap[en.n] = canonicalLength;
  const endMap = en.e.slice(0, en.n);
  return { profile, text: unitsToString(en.ch, en.n), startMap, endMap };
}

function build(text: string, profile: NormalizationProfile, partKind: PartKind, letters: boolean): SearchView {
  const base = reglasEntries(text);
  const pdf = partKind === 'pagina_pdf' || partKind === 'anotacion_pdf';
  const removed = markJoins(base, pdf);
  let en: Entries;
  if (profile === 'lista') en = listaFrom(base, removed);
  else if (profile === 'digitos') en = digitosFrom(base, removed, letters);
  else en = reglasFrom(base, removed);
  return finish(profile, en, text.length);
}

/**
 * Vista de búsqueda de `text` (texto canónico: NFC y LF) en el perfil pedido, con mapa de vuelta al canónico (6.1.2, 7.1.4).
 * No lanza con texto vacío, no registra nada y no retiene el texto.
 */
export function buildSearchView(text: string, profile: NormalizationProfile, partKind: PartKind): SearchView {
  return build(text, profile, partKind, false);
}

/**
 * Variante `digitos+letras` de 7.1.3 (`[A-Z0-9]`, letras en mayúscula) para placas, pasaportes y radicados
 * administrativos. Su `profile` es `'digitos'`; el contrato 6.1.2 no la nombra, por eso es una función aparte.
 */
export function buildAlnumSearchView(text: string, partKind: PartKind): SearchView {
  return build(text, 'digitos', partKind, true);
}

/**
 * Tramo normalizado [nStart, nEnd), nEnd > nStart → { start: v.startMap[nStart], end: v.endMap[nEnd - 1] }.
 * Un tramo vacío (nEnd <= nStart) devuelve un tramo vacío en la posición de nStart.
 */
export function toCanonicalSpan(v: SearchView, nStart: number, nEnd: number): { start: number; end: number } {
  const start = v.startMap[nStart] ?? 0;
  if (nEnd <= nStart) return { start, end: start };
  return { start, end: v.endMap[nEnd - 1] ?? start };
}
