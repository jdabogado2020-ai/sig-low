// Catálogo de valores en pesos (PA-6; plan 7.6): R-VAL-01 a R-VAL-06, lectura de cifras y multiplicadores (7.6.2) y
// contexto normativo (7.6.4). TypeScript puro: sin DOM, sin red, sin registro.
// Un valor nunca se suprime: en contexto normativo baja a confianza baja con `context: 'norma'`; las letras prevalecen sobre
// la cifra si difieren (Decreto 960 de 1970, art. 19).
import type { Confidence, RuleContext, RuleSpec, RuleVerdict } from '../types.ts';
import { wordsToNumber } from '../numerals.ts';
import { F, H, LB, vistaLista } from './fechas.ts';

// ---------------------------------------------------------------------------------------------------------------------
// Lectura de cifras y multiplicadores (7.6.2)
// ---------------------------------------------------------------------------------------------------------------------
/**
 * Cifra en formato colombiano (punto o apóstrofo de miles, coma decimal de 1 o 2 cifras) o, si es inequívoco, de EE. UU.
 * («1,000.00»). «,00», «.00», «.oo» y «,oo» finales son centavos y se descartan. `NaN` si no se puede leer.
 */
export function parseCifra(s: string): number {
  let x = s.trim();
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/u.test(x)) return Number(x.replace(/,/gu, ''));
  let dec = 0;
  let m = /[.,](oo|00)$/iu.exec(x);
  if (m && /[.']\d{3}[.,](oo|00)$/iu.test(x)) x = x.slice(0, -3);
  else if ((m = /,(\d{1,2})$/u.exec(x))) { dec = Number('0.' + m[1]); x = x.slice(0, -m[0].length); }
  else if ((m = /^(\d+)\.(\d{1,2})$/u.exec(x))) { dec = Number('0.' + m[2]); x = m[1] ?? ''; }
  const entero = Number(x.replace(/[.']/gu, ''));
  return Number.isFinite(entero) ? entero + dec : NaN;
}

/** Multiplicador: «millones», «millón», «mill.», «MM», «M» → 10⁶; «mil millones» → 10⁹; «mil» → 10³; sin palabra → 1; otra → `NaN`. */
export function multiplier(w: string | undefined): number {
  if (!w) return 1;
  const k = vistaLista(w).replace(/\./gu, '');
  if (k === 'mil millones') return 1e9;
  if (k === 'millones' || k === 'millon' || k === 'mill' || k === 'mm' || k === 'm') return 1e6;
  if (k === 'mil') return 1e3;
  return NaN;
}

// ---------------------------------------------------------------------------------------------------------------------
// Contexto normativo (7.6.4)
// ---------------------------------------------------------------------------------------------------------------------
/** Valores normativos de partida (`data/valores_normativos.json`, A2): SMMLV 2025, SMMLV 2026 y UVT 2026. Configurable. */
export const VALORES_NORMATIVOS: ReadonlySet<number> = new Set([1423500, 1750905, 52374]);
export const UVT_CTX_AFTER = new RegExp(`^${H}*(?:por|cada)${H}+UVT`, 'iu');
export const UVT_CTX_BEFORE = new RegExp(`UVT(?:${H}+(?:de|equivale${H}+a|es${H}+de|=))?${H}*$`, 'iu');
export const UMBRAL_BEFORE = new RegExp(`(?:cuant[ií]a|superiores?${H}+a|inferiores?${H}+a|exced\\p{L}*|hasta|m[aá]s${H}+de|menos${H}+de|igual${H}+o${H}+(?:superior|inferior)${H}+a|tope|umbral|l[ií]mite)[^.\\n]{0,30}$`, 'iu');

function esNormativo(t: string, s: number, e: number, valor: number): boolean {
  return UVT_CTX_AFTER.test(t.slice(e, e + 20)) || UVT_CTX_BEFORE.test(t.slice(Math.max(0, s - 25), s)) || VALORES_NORMATIVOS.has(valor);
}

function cerrarValor(s: number, e: number, t: string, valor: number, conf: Confidence, labelId?: string): RuleVerdict {
  const norma = esNormativo(t, s, e, valor);
  const v: RuleVerdict = { nStart: s, nEnd: e, canonicalKey: `VALOR:${valor}`, confidence: norma ? 'baja' : conf };
  if (norma) v.context = 'norma';
  if (labelId !== undefined) v.labelId = labelId;
  return v;
}

// ---------------------------------------------------------------------------------------------------------------------
// Fragmentos (7.6.3)
// ---------------------------------------------------------------------------------------------------------------------
const NUMCOP = '\\d{1,3}(?:[.\']\\d{3})+(?:,\\d{1,2}|[.,](?:00|oo|OO))?|\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:,\\d{1,2})?';
const NUMANY = `\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|${NUMCOP}`;
const MULT_MILL = '(?:mil' + H + '+millones|Mil' + H + '+Millones|MIL' + H + '+MILLONES|millones|Millones|MILLONES|millón|Millón|MILLÓN|millon|Millon|MILLON)';
const SUF_PESOS = `(?:(?:(?:de|DE|De)${H}+)?(?:pesos|PESOS|Pesos)(?:${H}+(?:colombianos|COLOMBIANOS|Colombianos))?(?:${H}+(?:m/cte|M/CTE|M/cte|mcte|MCTE|Mcte))?|(?:m/cte|M/CTE|M/cte|mcte|MCTE|Mcte)|m/c|M/C|COP|(?:moneda|MONEDA|Moneda)${H}+(?:corriente|CORRIENTE|Corriente)|(?:moneda|MONEDA|Moneda)${H}+(?:legal|LEGAL|Legal)${H}+(?:colombiana|COLOMBIANA|Colombiana))`;
export const FR_VALORES = { NUMCOP, NUMANY, MULT_MILL, SUF_PESOS } as const;

const g = (m: RegExpExecArray, k: string): string => m.groups?.[k] ?? '';
const fin = (m: RegExpExecArray): number => m.index + m[0].length;
const NOTA_ROT = { simbolo: 'ROT_VAL_1', moneda: 'ROT_VAL_2', salarios: 'ROT_VAL_3', dolares: 'ROT_VAL_4' } as const;

// R-VAL-01 · símbolo de pesos o COP + cifra. El grupo `l` es el símbolo (rótulo).
const rVAL01: RuleSpec = {
  id: 'R-VAL-01', type: 'VALOR', flags: 'dgu',
  source: `(?<![\\p{L}\\p{N}$])(?<l>COP\\$|COL\\$|\\$${H}*COP|COP|\\$)${H}*(?<num>\\d{1,3}\\.\\d{1,2}(?=${H}*${MULT_MILL})|${NUMCOP})(?:${H}*(?<mult>${MULT_MILL}|mill\\.|MM|M(?!/))(?!\\p{L}))?(?:${H}*(?<suf>${SUF_PESOS}))?(?![\\p{L}\\p{N}]|[.,]\\d)`,
  assess(m, ctx: RuleContext) {
    const v = Math.round(parseCifra(g(m, 'num')) * multiplier(g(m, 'mult')));
    if (!Number.isFinite(v)) return null;
    return cerrarValor(m.index, fin(m), ctx.view.text, v, 'alta', NOTA_ROT.simbolo);
  },
};

// R-VAL-02 · cifra + pesos, COP o m/cte (sin «$»). El grupo `l` es la palabra de moneda.
const rVAL02: RuleSpec = {
  id: 'R-VAL-02', type: 'VALOR', flags: 'dgu',
  source: `(?<![\\p{L}\\p{N}$.,'])(?<!\\$${H}*)(?<num>${NUMCOP})${H}*(?<l>${SUF_PESOS})(?![\\p{L}\\p{N}])`,
  assess(m, ctx) {
    const v = Math.round(parseCifra(g(m, 'num')));
    return Number.isFinite(v) ? cerrarValor(m.index, fin(m), ctx.view.text, v, 'alta', NOTA_ROT.moneda) : null;
  },
};

// R-VAL-03 · N millones sin símbolo (alta con «de pesos»; media sin él)
const rVAL03: RuleSpec = {
  id: 'R-VAL-03', type: 'VALOR', flags: 'dgu',
  source: `(?<![\\p{L}\\p{N}$.,'])(?<!\\$${H}*)(?<num>\\d{1,3}(?:[.,]\\d{1,3})?)${H}+(?<mult>${MULT_MILL})(?!\\p{L})(?<dp>${H}+(?:de|DE|De)${H}+(?:pesos|PESOS|Pesos)(?:${H}+(?:m/cte|M/CTE|mcte))?)?(?!${H}+(?:de|DE|De)${H}+(?!pesos|PESOS|Pesos)\\p{L})(?![\\p{L}\\p{N}])`,
  assess(m, ctx) {
    const v = Math.round(parseCifra(g(m, 'num')) * multiplier(g(m, 'mult')));
    return Number.isFinite(v) ? cerrarValor(m.index, fin(m), ctx.view.text, v, g(m, 'dp') !== '' ? 'alta' : 'media') : null;
  },
};

// R-VAL-04 · cantidad en letras y cifra entre paréntesis: UNA detección (NUMPH viene de fechas.ts)
const rVAL04: RuleSpec = {
  id: 'R-VAL-04', type: 'VALOR', flags: 'dgiu',
  source: `${LB}(?<w>${F.NUMPH})(?:${H}+(?<cur1>de${H}+pesos|pesos)(?:${H}+(?:colombianos|m/cte|mcte|moneda${H}+(?:corriente|legal)(?:${H}+colombiana)?))*)?`
    + `(?:${H}*\\(${H}*(?<cif>(?:\\$|COP\\$?)?${H}*(?:${NUMCOP}))${H}*\\))?(?:${H}+(?<cur2>de${H}+pesos|pesos)(?:${H}+(?:colombianos|m/cte|mcte))*)?`,
  assess(m, ctx) {
    const t = ctx.view.text;
    const w = g(m, 'w'), cif = g(m, 'cif');
    const sinMoneda = g(m, 'cur1') === '' && g(m, 'cur2') === '' && !(cif !== '' && /\$|cop/iu.test(cif));
    if (sinMoneda && !/mill[oó]n/iu.test(w)) return null;                                   // sin moneda solo con millón/millones
    if (sinMoneda && /^[ \t]+de[ \t]+(?!pesos)\p{L}/iu.test(t.slice(fin(m)))) return null;  // «un millón de habitantes»
    const r = wordsToNumber(w);
    const c = cif !== '' ? Math.round(parseCifra(cif.replace(/^(?:\$|COP\$?)\s*/iu, ''))) : null;
    let valor: number;
    let conf: Confidence = 'alta';
    const millones = r ? Math.floor(r.value / 1e6) : 0;
    const resto = r ? r.value % 1e6 : 0;
    if (r && c !== null && r.value !== c && millones >= 1 && resto > 0 && resto < 1000 && c === millones * 1e6 + resto * 1000) { valor = c; conf = 'media'; } // se omitió «mil»
    else if (r && c !== null && r.value !== c) { valor = r.value; conf = 'baja'; }          // difieren: prevalecen las letras
    else if (r) { valor = r.value; if (r.tolerated || sinMoneda) conf = 'media'; }
    else if (c !== null) { valor = c; conf = 'media'; }
    else return null;
    if (!(valor >= 1)) return null;
    let end = fin(m);
    while (end > m.index && /[ \t]/u.test(t.charAt(end - 1))) end--;
    return cerrarValor(m.index, end, t, valor, conf);
  },
};

// R-VAL-05 · salarios mínimos. El grupo `l` es la unidad.
const rVAL05: RuleSpec = {
  id: 'R-VAL-05', type: 'VALOR', flags: 'dgiu',
  source: `${LB}(?<n>${F.NUMPH}|\\d{1,4}(?:[.,]\\d{1,2})?)(?:${H}*\\(${H}*(?<nd>\\d{1,4}(?:[.,]\\d{1,2})?)${H}*\\))?${H}+`
    + `(?<l>salarios?${H}+m[ií]nimos?(?:${H}+(?:legales|mensuales|diarios|vigentes|legal|mensual|diario|vigente)){0,3}|s\\.m\\.m\\.l\\.m\\.v\\.?|s\\.m\\.m\\.l\\.v\\.?|s\\.m\\.l\\.m\\.v\\.?|s\\.m\\.l\\.d\\.v\\.?|s\\.m\\.l\\.v\\.?|smmlmv|smmlv|smlmv|smldv|smlv)(?![\\p{L}\\p{N}])`,
  assess(m, ctx) {
    const t = ctx.view.text;
    const nTxt = g(m, 'n'), nd = g(m, 'nd');
    let n: number;
    if (/^\d/u.test(nTxt)) n = parseCifra(nTxt);
    else { const r = wordsToNumber(nTxt); n = r ? r.value : nd !== '' ? parseCifra(nd) : NaN; }
    if (!Number.isFinite(n) || n <= 0) return null;
    const umbral = UMBRAL_BEFORE.test(t.slice(Math.max(0, m.index - 45), m.index));
    const diario = /diario|smldv|s\.m\.l\.d\.v/iu.test(g(m, 'l'));
    const v: RuleVerdict = {
      nStart: m.index, nEnd: fin(m), confidence: umbral ? 'baja' : 'media',
      canonicalKey: (diario ? 'VALOR:SMLDV:' : 'VALOR:SMMLV:') + String(n), labelId: NOTA_ROT.salarios,
    };
    if (umbral) v.context = 'norma';
    return v;
  },
};

// R-VAL-06 · dólares. El grupo `l` es el prefijo (US$, USD…); la forma con sufijo no lleva rótulo.
const rVAL06: RuleSpec = {
  id: 'R-VAL-06', type: 'VALOR', flags: 'dgu',
  source: `(?<![\\p{L}\\p{N}])(?:(?<l>USD\\$|US\\$|U\\$S|USD|U\\$)${H}*(?<num>${NUMANY})(?:${H}*(?<mult>${MULT_MILL}|MM)(?!\\p{L}))?`
    + `|(?<num2>${NUMANY})(?:${H}*(?<mult2>${MULT_MILL})(?!\\p{L}))?${H}*(?:de${H}+)?(?<suf>USD|d[óo]lares(?:${H}+(?:estadounidenses|americanos))?|D[ÓO]LARES))(?![\\p{L}\\p{N}])`,
  assess(m) {
    const num = g(m, 'num') || g(m, 'num2');
    const mult = g(m, 'mult') || g(m, 'mult2');
    const v = Math.round(parseCifra(num) * multiplier(mult));
    if (!Number.isFinite(v)) return null;
    const r: RuleVerdict = { nStart: m.index, nEnd: fin(m), confidence: 'alta', canonicalKey: 'VALOR:USD:' + v };
    if (g(m, 'l') !== '') r.labelId = NOTA_ROT.dolares;
    return r;
  },
};

export const rules: RuleSpec[] = [rVAL01, rVAL02, rVAL03, rVAL04, rVAL05, rVAL06];
