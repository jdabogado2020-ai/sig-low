// Catálogo de fechas (PA-6; plan 7.5): R-FEC-01 a R-FEC-09 con su contexto (7.5.5) y la consolidación de fechas sin año.
// TypeScript puro: sin DOM, sin red, sin registro. `assess` es una función pura sobre la vista `reglas` (nunca conserva el texto).
// La edad explícita (R-EDAD-01) no es un tipo de dato: la implementa `generalize.ts` (PG-4).
import type { Confidence, DetectionCandidate, RuleContext, RuleSpec, RuleVerdict } from '../types.ts';
import { MES_ABR, MESES, NUMERAL_WORDS, expandYY, isoDate, monthNum, romanMonth, validDate, wordsToNumber } from '../numerals.ts';

// ---------------------------------------------------------------------------------------------------------------------
// Fragmentos comunes de 7.4.1 a 7.8 (los reutilizan valores.ts, direccion.ts y exclusiones.ts)
// ---------------------------------------------------------------------------------------------------------------------
/** `{H}`: blanco horizontal (ninguna expresión cruza un salto de línea). */
export const H = '[ \\t]';
/**
 * `{HN}` (PA-6-r1): separador entre dos componentes de una fecha o de un valor: blancos, o blancos con **un** salto de línea
 * (el que mete el PDF al partir una línea, F43). Dos saltos son un párrafo y no se cruzan. Es el lenguaje de `H+` más `H*⏎H*`,
 * escrito sin ambigüedad (cada alternativa empieza distinto y el salto es único): lineal en la racha de blancos.
 */
export const HN = `(?:${H}+(?:\\n${H}*)?|\\n${H}*)`;
/** `{HN0}`: como `{HN}`, pero admite vacío (`H*` con un salto opcional). */
export const HN0 = `${H}*(?:\\n${H}*)?`;
/** `{LB}` y `{RB}`: fronteras Unicode de palabra/número (sin `\b`, que solo entiende ASCII). */
export const LB = '(?<![\\p{L}\\p{N}])';
export const RB = '(?![\\p{L}\\p{N}])';

const escapar = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
/** `alt(lista)`: alternancia no capturante de formas literales, sin duplicados, de la más larga a la más corta; cada espacio admite `{H}+`. */
export const alt = (lista: readonly string[]): string => {
  const u = [...new Set(lista)].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  return '(?:' + u.map((w) => escapar(w).replace(/ /gu, H + '+')).join('|') + ')';
};
const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);
/** `v3(lista)`: cada palabra en minúscula, Capitalizada y MAYÚSCULA. */
export const v3 = (ws: readonly string[]): string[] => ws.flatMap((w) => [w, cap(w), w.toUpperCase()]);
/** Vista `lista` de un fragmento: minúsculas, sin diacríticos, blancos simples (para las claves `FECHA:~…`). */
export const vistaLista = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/gu, '').normalize('NFC').replace(/\s+/gu, ' ').trim();

export const F = {
  NW: alt(NUMERAL_WORDS) + '(?!\\p{L})',
  NUMPH: '',
  MES: alt(MESES) + '(?!\\p{L})',
  MES_ABR: alt(MES_ABR) + '(?!\\p{L})\\.?',
};
// Hasta 16 numerales seguidos (la cifra más larga del corpus tiene 9): sin tope, una racha de «mil mil mil…» se recorría entera desde
// cada «mil» y la búsqueda era cuadrática (40.000 caracteres: 2,3 s; con un salto entre palabras, PA-6-r1, habría pasado a las dos
// formas). El tope no cambia el resultado de ningún monto ni fecha reales.
F.NUMPH = `${F.NW}(?:${HN}(?:y${HN})?${F.NW}){0,15}`;

// ---------------------------------------------------------------------------------------------------------------------
// Contexto de las fechas (7.5.5). Se evalúa sobre el texto anterior a la fecha.
// ---------------------------------------------------------------------------------------------------------------------
// Contextos y reglas de fechas sin dos cuantificadores de blancos separados por un opcional (PB-2-r5): `B*(?:S B*)?` es el
// lenguaje de `B* S? B*`, y `(?:B* S)?B+` el de `B* S? B+`, sin su retroceso cuadrático (con «Ley 100», tabuladores y otra cosa,
// EXC-FECHA-A tenía tres seguidos y era cúbica).
/** EXC-FECHA-A: norma numerada, sentencia con número, Diario Oficial o Gaceta antes de la fecha → se suprime. */
export const EXC_FECHA_A = new RegExp(
  `(?:(?:ley(?:${H}+(?:estatutaria|org[aá]nica|marco))?|decreto(?:${H}+(?:ley|legislativo|reglamentario|[uú]nico${H}+reglamentario))?|acto${H}+legislativo|constituci[oó]n(?:${H}+pol[ií]tica)?)(?:${H}+(?:No\\.?|N[º°]\\.?|n\\.º|n[uú]mero))?${H}+\\d{1,5}(?:${H}+de${H}+\\d{4})?`
  + `|diario${H}+oficial(?:${H}+(?:No\\.?|N[º°]\\.?|n\\.º))?${H}+\\d{1,3}(?:\\.\\d{3})*`
  + `|gaceta(?:${H}+\\p{L}+){0,3}(?:${H}+(?:No\\.?|N[º°]\\.?))?${H}+\\d[\\d.]*`
  + `|(?:sentencia|auto|providencia|fallo)(?:${H}+de${H}+tutela)?${H}+(?:T|C|SU|A|STC|STP|STL|SC|SL|SP|AC|AP|AL)${H}*(?:-${H}*)?\\d{1,5}(?:${H}*[-/]${H}*\\d{2,4})?(?:${H}+de${H}+\\d{4})?`
  + `|(?<![\\p{L}])(?:T|C|SU|STC|STP|STL|SC|SL|SP)-?\\d{1,5}(?:[-/]\\d{2,4})?(?:${H}+de${H}+\\d{4})?)`
  + `${H}*(?:[,(]${H}*)?(?:(?:del?|expedid[oa]${H}+el|publicad[oa]${H}+el|de${H}+fecha|fechad[oa]${H}+el)${H}*)?$`, 'iu');
/** EXC-FECHA-B: acto administrativo con número (`adm`) o sentencia/providencia sin número (`prov`) → baja. */
export const EXC_FECHA_B = new RegExp(
  `(?:(?<adm>(?:resoluci[oó]n|acuerdo|circular|ordenanza|concepto|directiva)(?:${H}+(?:No\\.?|N[º°]\\.?|n\\.º|n[uú]mero))?${H}+[\\p{L}\\d.-]{1,20}(?:${H}+de${H}+\\d{4})?)`
  + `|(?<prov>sentencia|providencia|fallo))${H}*(?:,${H}*)?(?:del?|de${H}+fecha|expedid[oa]${H}+el)${H}*$`, 'iu');
/** Nacimiento. */
export const C_NAC = new RegExp(`(?:naci[oó]|nacid[oa]|nacimiento|f\\.${H}*(?:de${H}*)?nac\\.?|fecha${H}+de${H}+nac\\.?|natalicio)(?:${H}+(?:el|en))?(?:${H}+d[ií]a)?${H}*(?::${H}*)?$`, 'iu');
/** Léxico procesal o contractual. */
export const C_PROC = new RegExp('radic|present[oóa]|interpu|notific|admiti|admisi|audiencia|t[eé]rmino|plazo|venc|ejecutori|traslado|fall[oó]|sentencia|auto(?!\\p{L})|providencia|recurso|apelaci|impugn|contestaci|vigencia|suscri|firm|celebr|otorg|expedi|corte(?!\\p{L})|emisi|emiti', 'iu');
const ROTULO_ARTICULO = new RegExp(`(?:art[ií]culos?|arts?\\.|numeral(?:es)?|num\\.|literal(?:es)?|lit\\.|incisos?|folios?|fls?\\.|decreto|ley|cap[ií]tulo|t[ií]tulo|p[aá]ginas?|p[aá]gs?\\.|tomo|cuaderno)${H}*(?:(?:No\\.?|N[º°]\\.?)${H}*)?$`, 'iu');
const LUGAR_PROPIO = new RegExp(`(?:barrio|avenida|av\\.|calle|colegio|plaza|batall[oó]n|hospital|instituci[oó]n|escuela|parque|urbanizaci[oó]n|sede)[^.\\n]{0,20}$`, 'iu');

type ContextoFecha = NonNullable<RuleVerdict['context']>;
interface ResultadoContexto { suppress?: boolean; context?: ContextoFecha; low?: boolean }

/** Orden de 7.5.5: 1 suprime, 2 y 3 bajan con contexto, 4 nacimiento, 5 procesal (sin contexto), 6 hecho. */
function contextoDeFecha(t: string, s: number): ResultadoContexto {
  const before = t.slice(Math.max(0, s - 80), s);
  if (EXC_FECHA_A.test(before)) return { suppress: true };
  const x2 = EXC_FECHA_B.exec(before);
  if (x2) return { context: x2.groups?.['adm'] ? 'norma' : 'cita', low: true };
  if (C_NAC.test(t.slice(Math.max(0, s - 40), s))) return { context: 'nacimiento' };
  if (C_PROC.test(t.slice(Math.max(0, s - 60), s))) return {};
  return { context: 'hecho' };
}

/** Cierra una fecha: validador `FECHA` (solo califica), clave ISO o `FECHA:~…`, y contexto. `null` si el contexto la suprime. */
function cerrarFecha(
  m: RegExpExecArray, t: string, y: number, mo: number | null, d: number, conf: Confidence, extra?: { start?: number; end?: number },
): RuleVerdict | null {
  const start = extra?.start ?? m.index;
  const end = extra?.end ?? m.index + m[0].length;
  const c = contextoDeFecha(t, start);
  if (c.suppress) return null;
  const ok = mo !== null && validDate(y, mo, d);
  const canonicalKey = ok ? 'FECHA:' + isoDate(y, mo, d) : 'FECHA:~' + vistaLista(t.slice(start, end));
  const confidence: Confidence = !ok || c.low ? 'baja' : conf;
  const v: RuleVerdict = { nStart: start, nEnd: end, confidence, canonicalKey };
  if (c.context !== undefined) v.context = c.context;
  return v;
}

const g = (m: RegExpExecArray, k: string): string => m.groups?.[k] ?? '';

// ---------------------------------------------------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------------------------------------------------
const rFEC01: RuleSpec = {
  id: 'R-FEC-01', type: 'FECHA', flags: 'dgu',
  source: `${LB}(?<!\\d[.,/-])(?<a>\\d{1,2})(?<s>[/.-])(?<b>\\d{1,2})\\k<s>(?<y>\\d{4})(?![\\p{L}\\p{N}]|[.,/-]\\d)`,
  assess(m, ctx: RuleContext) {
    const t = ctx.view.text;
    const a = Number(g(m, 'a')), b = Number(g(m, 'b')), y = Number(g(m, 'y'));
    if (y < 1900 || y > 2099) return null;                                                  // no es año plausible: no es fecha
    if (b <= 12 && validDate(y, b, a)) return cerrarFecha(m, t, y, b, a, a > 12 || a === b ? 'alta' : 'media');
    if (a <= 12 && validDate(y, a, b)) return cerrarFecha(m, t, y, a, b, 'baja');            // mes/día (formato extranjero)
    return cerrarFecha(m, t, y, b, a, 'baja');                                              // el validador falla: baja, no se descarta
  },
};

const rFEC02: RuleSpec = {
  id: 'R-FEC-02', type: 'FECHA', flags: 'dgu',
  source: `${LB}(?<!\\d[.,/-])(?<a>\\d{1,2})(?<s>[/-])(?<b>\\d{1,2})\\k<s>(?<y>\\d{2})(?![\\p{L}\\p{N}]|[.,/-]\\d)`,
  assess(m, ctx) {
    const t = ctx.view.text;
    if (ROTULO_ARTICULO.test(t.slice(Math.max(0, m.index - 25), m.index))) return null;
    const a = Number(g(m, 'a')), b = Number(g(m, 'b')), y = expandYY(Number(g(m, 'y')), ctx.refYear);
    if (!(b <= 12 && validDate(y, b, a))) return null;                                      // aquí la validez es condición del patrón
    const r = cerrarFecha(m, t, y, b, a, 'baja');
    if (r) r.confidence = 'baja';
    return r;
  },
};

const rFEC03: RuleSpec = {
  id: 'R-FEC-03', type: 'FECHA', flags: 'dgu',
  source: `${LB}(?<!\\d[-./])(?<y>(?:19|20)\\d{2})(?<s>[-/.])(?<m>0[1-9]|1[0-2])\\k<s>(?<d>0[1-9]|[12]\\d|3[01])(?![\\p{L}\\p{N}]|[.,/-]\\d)`,
  assess: (m, ctx) => cerrarFecha(m, ctx.view.text, Number(g(m, 'y')), Number(g(m, 'm')), Number(g(m, 'd')), 'alta'),
};

const rFEC04: RuleSpec = {
  id: 'R-FEC-04', type: 'FECHA', flags: 'dgiu',
  source: `${LB}(?:(?<wd>lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)(?:${H}*,)?${HN})?(?<d>[12]\\d|3[01]|0?[1-9])(?!\\d)(?:\\.?º\\.?|o\\.?(?!\\p{L}))?${HN}(?:de${HN})?(?<m>${F.MES}|${F.MES_ABR})(?:${H}*,)?${HN}(?:(?:de|del)${HN})?(?:a[ñn]o${HN})?(?<y>(?:1[89]|20)\\d{2})${RB}`,
  assess: (m, ctx) => cerrarFecha(m, ctx.view.text, Number(g(m, 'y')), monthNum(g(m, 'm')), Number(g(m, 'd')), 'alta'),
};

const rFEC05: RuleSpec = {
  id: 'R-FEC-05', type: 'FECHA', flags: 'dgiu',
  source: `${LB}(?<m>${F.MES}|${F.MES_ABR})${HN}(?<d>[12]\\d|3[01]|0?[1-9])(?!\\d)(?:${H}*,${HN0}|${HN}(?:de|del)${HN})(?<y>(?:1[89]|20)\\d{2})${RB}`,
  assess: (m, ctx) => cerrarFecha(m, ctx.view.text, Number(g(m, 'y')), monthNum(g(m, 'm')), Number(g(m, 'd')), 'alta'),
};

const rFEC06: RuleSpec = {
  id: 'R-FEC-06', type: 'FECHA', flags: 'dgiu',
  source: `${LB}(?:a${H}+los${H}+)?(?:(?<dw>${F.NUMPH})(?:${HN0}\\(${H}*(?<dd>\\d{1,2})(?:\\.?º|o)?${H}*\\))?|(?<dn>\\d{1,2})(?:\\.?º)?)`
    + `${HN}(?:d[ií]as?${HN}del${HN}mes${HN}de|del${HN}mes${HN}de|de)${HN}(?<m>${F.MES})${HN}(?:de|del)(?:${HN}a[ñn]o)?${HN}`
    + `(?:(?<yw>${F.NUMPH})(?:${HN0}\\(${H}*(?<yd>\\d{4})${H}*\\))?|(?<yn>\\d{4}))${RB}`,
  assess(m, ctx) {
    const dw = g(m, 'dw'), dd = g(m, 'dd'), yw = g(m, 'yw'), yd = g(m, 'yd');
    if (dw === '' && yw === '') return null;                                                // sin letras: lo cubre R-FEC-04
    let conf: Confidence = 'alta';
    let d: number;
    if (dw !== '') {
      const r = wordsToNumber(dw, 'dia');
      if (r && dd !== '' && r.value !== Number(dd)) { d = r.value; conf = 'baja'; }          // difieren: prevalecen las letras (art. 19 Dto. 960/1970)
      else if (r) { d = r.value; if (r.tolerated) conf = 'media'; }
      else if (dd !== '') { d = Number(dd); conf = 'media'; }
      else return null;
    } else d = Number(g(m, 'dn'));
    let y: number;
    if (yw !== '') {
      const r = wordsToNumber(yw, 'anio');
      if (r && yd !== '' && r.value !== Number(yd)) { y = r.value; conf = 'baja'; }
      else if (r) { y = r.value; if (r.tolerated && conf === 'alta') conf = 'media'; }
      else if (yd !== '') { y = Number(yd); if (conf === 'alta') conf = 'media'; }
      else return null;
    } else y = Number(g(m, 'yn'));
    return cerrarFecha(m, ctx.view.text, y, monthNum(g(m, 'm')), d, conf);
  },
};

const rFEC07: RuleSpec = {
  id: 'R-FEC-07', type: 'FECHA', flags: 'dgu',
  source: `${LB}(?<d>[12]\\d|3[01]|0?[1-9])(?<s>[-./])(?<m>XII|XI|IX|X|VIII|VII|VI|IV|V|III|II|I)\\k<s>(?<y>(?:1[89]|20)\\d{2})${RB}`,
  assess: (m, ctx) => cerrarFecha(m, ctx.view.text, Number(g(m, 'y')), romanMonth(g(m, 'm')), Number(g(m, 'd')), 'alta'),
};

const rFEC08: RuleSpec = {
  id: 'R-FEC-08', type: 'FECHA', flags: 'dgiu',
  source: `${LB}(?<d>[12]\\d|3[01]|0?[1-9])(?<s>[-/])(?<m>${alt(MES_ABR)}(?!\\p{L})\\.?|${F.MES})\\k<s>(?<y>(?:1[89]|20)\\d{2}|\\d{2})${RB}`,
  assess(m, ctx) {
    const yy = g(m, 'y');
    const y = yy.length === 2 ? expandYY(Number(yy), ctx.refYear) : Number(yy);
    return cerrarFecha(m, ctx.view.text, y, monthNum(g(m, 'm')), Number(g(m, 'd')), yy.length === 2 ? 'media' : 'alta');
  },
};

const rFEC09: RuleSpec = {
  id: 'R-FEC-09', type: 'FECHA', flags: 'dgiu',
  source: `${LB}(?<d>[12]\\d|3[01]|0?[1-9]|primero)(?!\\d)(?:\\.?º\\.?|o\\.(?!\\p{L}))?${HN}de${HN}(?<m>${F.MES})(?!(?:${H}*,)?${HN}(?:de|del)${HN}(?:a[ñn]o${HN})?(?:\\d{4}|${F.NW}))(?!${H}*(?:,${HN0})?\\d{4})`,
  assess(m, ctx) {
    const t = ctx.view.text;
    const ixMes = m.indices?.groups?.['m'];
    const ms = ixMes ? ixMes[0] : m.index;
    const mtxt = t.slice(ms, ms + 1);
    const prev = t.slice(Math.max(0, m.index - 2), m.index);
    const inicioDeOracion = m.index === 0 || /[.\n:]\s*$/u.test(prev) || /^\s*$/u.test(t.slice(0, m.index));
    if (mtxt !== mtxt.toLowerCase() && !inicioDeOracion) return null;                       // «20 de Julio»: nombre propio
    if (LUGAR_PROPIO.test(t.slice(Math.max(0, m.index - 30), m.index))) return null;        // «Barrio 20 de julio», «Avenida Primero de Mayo»
    const c = contextoDeFecha(t, m.index);
    if (c.suppress) return null;
    const v: RuleVerdict = { nStart: m.index, nEnd: m.index + m[0].length, confidence: 'baja', canonicalKey: 'FECHA:~' + vistaLista(m[0]) };
    if (c.context !== undefined) v.context = c.context;
    return v;
  },
};

export const rules: RuleSpec[] = [rFEC01, rFEC02, rFEC03, rFEC04, rFEC05, rFEC06, rFEC07, rFEC08, rFEC09];

// ---------------------------------------------------------------------------------------------------------------------
// Consolidación de R-FEC-09 (7.5.4): si el documento tiene UNA sola fecha completa con el mismo día y mes, la fecha sin año
// toma su clave ISO (mismo marcador). Pura: devuelve copias; no modifica la lista de entrada.
// ---------------------------------------------------------------------------------------------------------------------
const CLAVE_COMPLETA = /^FECHA:(\d{4})-(\d{2})-(\d{2})$/u;
const CLAVE_SIN_ANIO = /^FECHA:~(primero|\d{1,2})(?:\.?º\.?|o\.)? de ([a-z]+)$/u;

export function consolidarFechasSinAnio(candidatos: readonly DetectionCandidate[]): DetectionCandidate[] {
  const completasPorDiaMes = new Map<string, Set<string>>();
  for (const c of candidatos) {
    const k = CLAVE_COMPLETA.exec(c.canonicalKey);
    if (c.type !== 'FECHA' || !k) continue;
    const diaMes = `${Number(k[3])}-${Number(k[2])}`;
    const iso = c.canonicalKey.slice('FECHA:'.length);
    const set = completasPorDiaMes.get(diaMes) ?? new Set<string>();
    set.add(iso);
    completasPorDiaMes.set(diaMes, set);
  }
  return candidatos.map((c) => {
    if (c.type !== 'FECHA' || c.ruleId !== 'R-FEC-09') return c;
    const k = CLAVE_SIN_ANIO.exec(c.canonicalKey);
    const mes = k?.[2] === undefined ? null : monthNum(k[2]);
    if (!k || mes === null) return c;
    const dia = k[1] === 'primero' ? 1 : Number(k[1]);
    const unicas = completasPorDiaMes.get(`${dia}-${mes}`);
    const iso = unicas && unicas.size === 1 ? [...unicas][0] : undefined;
    return iso === undefined ? c : { ...c, canonicalKey: 'FECHA:' + iso };
  });
}
