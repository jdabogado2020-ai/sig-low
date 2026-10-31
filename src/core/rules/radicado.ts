// Reglas de radicados (PA-3; plan 7.2.4): R-RAD-01, R-RAD-02, R-RAD_ADMIN-01, R-RAD_ADMIN-02 y R-RAD_ADMIN-03.
// Las expresiones leen la vista `reglas` (6.1.2) y están compuestas con las fuentes exactas de 7.2.0 y 7.2.1.
// `assess` es puro: filtros estructurales, validadores y la tabla 7.3.5. Un validador que falla baja la confianza,
// nunca descarta. La DIVIPOLA la configura el worker con `configurarDivipola` (validators/radicado.ts).
import type { Confidence, RuleContext, RuleSpec, RuleVerdict } from '../types.ts';
import { ANIO_RADICADO_MINIMO, radicado } from '../validators/radicado.ts';
import { contextoDelExpediente } from './exclusiones.ts';

const R = String.raw;

// ---- fragmentos comunes (7.2.0) ----
const BL = R`(?<![\p{L}\p{N}_])`;
const NL = R`(?<![\p{L}\p{N}_]|\p{N}[.,'\-\/])`;
const NR = R`(?![\p{L}\p{N}_]|[.,'\-\/]\p{N})`;
const NUMSIGN = R`(?:n\.?[ ]?º|no\.?|nro\.?|n[úu]m\.?|n[úu]mero|n\.|#)`;
// GAP y GAP_CS sin cuantificadores de blancos separados por un opcional (PB-2-r5): `B*(?:S B*)?` es el lenguaje de `B* S? B*`
// sin su retroceso cuadrático. El salto de línea de 7.1.5 cabe también después del signo de número («radicado No.⏎2026…»,
// PA-ids-r1): cada tramo opcional empieza por un carácter distinto. GAP_CS (R-RAD_ADMIN-02 y -03) no cambia.
const GAP = R`[ \t]*(?:[:.][ \t]*)?(?:\n[ \t]*)?(?:${NUMSIGN}[ \t]*(?:[:.][ \t]*)?(?:\n[ \t]*)?)?`;
/** PROPUESTA PA-ids-r1: rótulo diferido («el radicado quedó escrito como …»); ver ids.ts. */
const DIF = R`(?:[ ]+de[ ]+(?:\p{L}+[ ]+){1,4}?|[ ]+)(?:(?:figura|qued[óo]|se[ ]+anot[óo]|fue[ ]+anotad[oa])(?:[ ]+escrit[oa])?[ ]+)?como`;
const NUMSIGN_CS =R`(?:[Nn]\.?[ ]?º|N[Oo]\.?|no\.?|[Nn]ro\.?|NRO\.?|[Nn][úu]m\.?|N[ÚU]M\.?|[Nn][úu]mero|N[ÚU]MERO|[Nn]\.|#)`;
const GAP_CS = R`[ \t]*(?:[:.][ \t]*)?(?:\n[ \t]*)?(?:${NUMSIGN_CS}[ \t]*(?:[:.][ \t]*)?)?`;

// ---- rótulos (7.2.1) ----
const L_RAD = R`radicad[oa]|rad\.|rdo\.|radicaci[óo]n|expediente|exp\.|proceso(?:[ ]+(?:ejecutivo|ordinario|verbal(?:[ ]+sumario)?|declarativo|penal|laboral|civil|monitorio|abreviado))?|ref(?:erencia)?\.?|c\.?[ ]?u\.?[ ]?i\.?|n\.?[ ]?u\.?[ ]?n\.?[ ]?c\.?|spoa|n[úu]mero[ ]+[úu]nico(?:[ ]+de[ ]+noticia[ ]+criminal)?|c[óo]digo[ ]+[úu]nico(?:[ ]+de[ ]+investigaci[óo]n)?|noticia[ ]+criminal`;
const L_RADC = R`rad(?:icad[oa])?\.?|radicaci[óo]n|expediente|exp\.|proceso|ref\.?`;
// «consecutivo de salida / entrada» (PA-ids-r1): 7.2.4 describe R-RAD_ADMIN-01 como la regla de «consecutivos de salida y entrada».
const L_RADA_F = R`radicad[oa](?:[ ]+(?:de[ ]+)?(?:salida|entrada|interno))?|consecutivo[ ]+de[ ]+(?:salida|entrada)|n[úu]mero[ ]+de[ ]+radicad[oa]|radicaci[óo]n|rad\.|pqrs?d?f?`;
// AJ-2: el número de un título valor («pagaré en blanco No. PG-2026-00075», «letra de cambio», «cheque») identifica el documento en el
// sistema de quien lo emite, como un radicado administrativo: rótulo genérico (débil, confianza media). Sin dígitos tras el rótulo no hay detección.
const L_RADA_D = R`solicitud|caso|ticket|consecutivo|petici[óo]n|queja|reclamo|referencia|ref\.|pagar[ée](?:[ ]+en[ ]+blanco)?|letra[ ]+de[ ]+cambio|cheque`;
const L_NI = R`NI|N\.[ ]?I\.|[Rr]adicado[ ]+[Ii]nterno|RADICADO[ ]+INTERNO|[Nn][úu]mero[ ]+[Ii]nterno|N[ÚU]MERO[ ]+INTERNO`;
const L_EXP = R`[Ee]xpediente|EXPEDIENTE|[Ee]xp\.|EXP\.`;

/** La fuerza del rótulo se decide probando el grupo `l` contra el fragmento débil anclado, banderas `iu` (7.2.1). */
const fuerte = (src: string): RegExp => new RegExp(R`^(?:${src})$`, 'iu');
const ES_RADC = fuerte(R`${L_RADC}|rdo\.`);
const ES_RADA_D = fuerte(L_RADA_D);

// ---- valores (7.2.0) ----
// PROPUESTA PA-ids-r1: un salto de línea (con espacios) también separa los grupos de dígitos («15759⏎41 10 959 2026 00023 00»).
const V_RAD = R`\d+(?:(?:[ ]?[\-\/][ ]?(?:\n[ ]?)?|[ .]|[ ]?\n[ ]?)\d+){0,39}`;
const V_RADC = R`(?:19|20)\d{2}[ ]?-[ ]?\d{3,5}(?:[ ]?-[ ]?\d{2})?`;
const V_RADA = R`(?!${V_RADC}${NR})(?!(?:19|20)\d{2}-[01]\d-[0-3]\d${NR})(?=[A-Za-z0-9\-]*\d)[A-Za-z0-9]+(?:-[A-Za-z0-9]+){0,4}`;
const V_NI = R`\d{1,3}(?:\.\d{3}){1,2}|\d{3,8}`;

// ---- utilidades ----
const digitos = (s: string): string => s.replace(/[^0-9]/gu, '');
const alfanum = (s: string): string => s.replace(/[^A-Za-z0-9]/gu, '').toUpperCase();
/** Una muesca menos: alta → media → baja → baja. */
const muesca = (c: Confidence): Confidence => (c === 'alta' ? 'media' : 'baja');
/** Valor de 4 caracteres con forma de año (`pareceAnio`, 7.2.2): baja la confianza de R-RAD_ADMIN-01. */
const parecenAnio = (s: string): boolean => /^(?:19|20)\d{2}$/u.test(s);

interface Capturas { v: string; ns: number; ne: number; l: string | undefined }

function capturas(m: RegExpExecArray, ctx: RuleContext): Capturas | null {
  const span = m.indices?.groups?.['v'];
  if (span === undefined) return null;
  return { v: ctx.view.text.slice(span[0], span[1]), ns: span[0], ne: span[1], l: m.groups?.['l'] };
}

// ---- R-RAD-01 ----
interface Grupo { s: number; e: number; n: number }

/** Año plausible según la posición del año en la cadena de dígitos (7.2.4, «Selección»). */
function anioEnSuPosicion(d: string, refYear: number): boolean {
  const entre = (from: number, lo: number, hi: number): boolean => {
    const y = Number(d.slice(from, from + 4));
    return y >= lo && y <= hi;
  };
  if (d.length === 22) return entre(12, 1998, 2002) || entre(11, ANIO_RADICADO_MINIMO, refYear);
  return entre(12, ANIO_RADICADO_MINIMO, refYear);
}

function assessRad01(m: RegExpExecArray, ctx: RuleContext): RuleVerdict[] | null {
  const cap = capturas(m, ctx);
  if (cap === null) return null;
  const { refYear } = ctx;
  const grupos: Grupo[] = [];
  for (const g of cap.v.matchAll(/\d+/gu)) grupos.push({ s: g.index, e: g.index + g[0].length, n: g[0].length });
  const cadena = (a: number, j: number): string => cap.v.slice(grupos[a]?.s ?? 0, grupos[j]?.e ?? 0);
  /** Finales j (del más lejano al más cercano) tales que los grupos a..j suman 21, 22 o 23 dígitos. */
  const ventanas = (a: number): number[] => {
    const out: number[] = [];
    for (let j = grupos.length - 1; j >= a; j -= 1) {
      let total = 0;
      for (let k = a; k <= j; k += 1) total += grupos[k]?.n ?? 0;
      if (total >= 21 && total <= 23) out.push(j);
    }
    return out;
  };
  const verdicts: RuleVerdict[] = [];
  let i = 0;
  while (i < grupos.length) {
    let found = -1;
    let inicio = i;
    // 1) la primera ventana que valida, empezando en i, i+1 o i+2 (inicio más a la izquierda, final más lejano)
    for (let a = i; a <= Math.min(i + 2, grupos.length - 1) && found < 0; a += 1) {
      for (const j of ventanas(a)) {
        if (radicado(digitos(cadena(a, j)), refYear).ok) {
          found = j;
          inicio = a;
          break;
        }
      }
    }
    // 2) si ninguna valida: la más lejana desde i, solo con el año en su posición o con rótulo
    if (found < 0) {
      const mas = ventanas(i)[0];
      if (mas !== undefined && (anioEnSuPosicion(digitos(cadena(i, mas)), refYear) || (cap.l !== undefined && i === 0))) found = mas;
    }
    if (found < 0) {
      i += 1;
      continue;
    }
    i = inicio;
    const d = digitos(cadena(i, found));
    const chk = radicado(d, refYear);
    // El rótulo cuenta solo si la subcadena empieza en el primer grupo de la cadena.
    const rotulado = cap.l !== undefined && i === 0;
    let confidence: Confidence;
    if (chk.ok) {
      confidence = d.length === 22 && !rotulado ? 'media' : 'alta';
      if (!chk.corpOk) confidence = muesca(confidence);
    } else {
      confidence = rotulado ? 'media' : 'baja';
    }
    const verdict: RuleVerdict = {
      nStart: cap.ns + (grupos[i]?.s ?? 0),
      nEnd: cap.ns + (grupos[found]?.e ?? 0),
      confidence,
      validator: { name: 'RADICADO', passed: chk.ok },
      canonicalKey: `RAD:${d}`,
    };
    if (rotulado) verdict.labelId = 'ROT-RAD';
    verdicts.push(verdict);
    i = found + 1;
  }
  return verdicts.length > 0 ? verdicts : null;
}

// ---- R-RAD-02 ----
function assessRad02(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const cap = capturas(m, ctx);
  if (cap === null) return null;
  const d = digitos(cap.v);
  const y = Number(d.slice(0, 4));
  const label = cap.l ?? '';
  const judicial = ES_RADC.test(label);
  const debil = ES_RADA_D.test(label);
  let confidence: Confidence = debil ? 'media' : 'alta';
  if (!(y >= ANIO_RADICADO_MINIMO && y <= ctx.refYear)) confidence = muesca(confidence);
  return {
    confidence,
    canonicalKey: `RAD:${d}`,
    type: judicial ? 'RADICADO' : 'RADICADO_ADMIN',
    labelId: judicial ? 'ROT-RAD' : (debil ? 'ROT-RADADM-GEN' : 'ROT-RADADM'),
  };
}

// ---- R-RAD_ADMIN-01 ----
function assessRadAdmin01(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const cap = capturas(m, ctx);
  if (cap === null) return null;
  const a = alfanum(cap.v);
  if (a.length < 6 || a.length > 20 || digitos(cap.v).length < 4) return null;
  const esFuerte = !ES_RADA_D.test(cap.l ?? '');
  let confidence: Confidence = esFuerte ? 'alta' : 'media';
  if (parecenAnio(a)) confidence = 'baja';
  return { confidence, canonicalKey: `RAD:${a}`, labelId: esFuerte ? 'ROT-RADADM' : 'ROT-RADADM-GEN' };
}

// ---- R-RAD_ADMIN-02 y -03 ----
function assessRadAdmin02(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const cap = capturas(m, ctx);
  if (cap === null) return null;
  return { confidence: 'alta', canonicalKey: `RAD:${digitos(cap.v)}`, labelId: 'ROT-NI' };
}

/**
 * R-RAD_ADMIN-03 · El expediente de la Corte («T-9.000.001»). D-11 (PB-2-r8): solo no se toma el expediente que, en la misma
 * oración, va con otra providencia identificada con su número y su año («Como precedente invoco la Sentencia T-074 de 2020 y, en
 * particular, el expediente T-9.000.004») y sin ninguna señal del propio caso (`contextoDelExpediente`). La tercera condición (la
 * misma clave en otra mención del documento sin cita) la aplica la tubería con `expedienteCitadoConClave`. Todo otro expediente se
 * toma; si además está en contexto de cita (E-CITA-01 y R-CIT-01) y sin señal del propio caso, con `context: 'cita'`, que lleva la
 * bandera `CITA_JURISPRUDENCIAL` (7.3.3).
 */
function assessRadAdmin03(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const cap = capturas(m, ctx);
  if (cap === null) return null;
  // Las dos preguntas en una, con ventanas fijas y el índice de la vista (B-62).
  const contexto = contextoDelExpediente(ctx.view.text, cap.ns, cap.ne, ctx.view);
  if (contexto === 'precedente') return null;
  return veredictoDeExpediente(cap, contexto === 'cita');
}

function veredictoDeExpediente(cap: Capturas, cita: boolean): RuleVerdict {
  const verdict: RuleVerdict = { confidence: cap.l !== undefined ? 'media' : 'baja', canonicalKey: claveDeExpediente(cap.v) };
  if (cap.l !== undefined) verdict.labelId = 'ROT-EXP';
  if (cita) verdict.context = 'cita';
  return verdict;
}
const claveDeExpediente = (v: string): string => `RAD:${alfanum(v)}`;

const R_RAD_ADMIN_03: RuleSpec = {
  id: 'R-RAD_ADMIN-03',
  type: 'RADICADO_ADMIN',
  flags: 'dgu',
  source: R`${BL}(?:(?<l>${L_EXP})${GAP_CS})?(?<v>(?:T|D|OG|ICC|LAT|CJU|RE|RDL|PE|AC)[ ]?-[ ]?(?:\d{1,3}(?:\.\d{3}){1,2}|\d{5,8}))${NR}`,
  assess: assessRadAdmin03,
};

/**
 * D-11, condición 3 (PB-2-r8; 7.3.3, la regla de la misma clave) · R-RAD_ADMIN-03 solo para los expedientes que la regla no tomó por
 * ir citados con otra providencia y cuya clave está en `claves`: las de las otras menciones del documento que sí se tomaron, que la
 * tubería reúne de todas las partes. Ese expediente se toma, con `context: 'cita'`; la bandera no cae si alguna otra mención va sin
 * contexto de cita (es el expediente del caso, 7.3.3). Los demás expedientes no salen: ya los dio la regla.
 */
export function expedienteCitadoConClave(claves: ReadonlySet<string>): RuleSpec {
  return {
    ...R_RAD_ADMIN_03,
    assess: (m, ctx) => {
      const cap = capturas(m, ctx);
      if (cap === null || !claves.has(claveDeExpediente(cap.v))) return null;
      return contextoDelExpediente(ctx.view.text, cap.ns, cap.ne, ctx.view) === 'precedente' ? veredictoDeExpediente(cap, true) : null;
    },
  };
}

export const rules: RuleSpec[] = [
  {
    id: 'R-RAD-01',
    type: 'RADICADO',
    flags: 'dgiu',
    source: R`(?:${BL}(?<l>${L_RAD})(?:${DIF})?${GAP})?${NL}(?<v>${V_RAD})${NR}`,
    assess: assessRad01,
  },
  {
    id: 'R-RAD-02',
    type: 'RADICADO',
    flags: 'dgiu',
    source: R`${BL}(?<l>${L_RADC}|${L_RADA_F}|${L_RADA_D}|rdo\.)${GAP}(?<v>${V_RADC})${NR}`,
    assess: assessRad02,
  },
  {
    id: 'R-RAD_ADMIN-01',
    type: 'RADICADO_ADMIN',
    flags: 'dgiu',
    // La sigla de entidad termina en una frontera de palabra (PA-ids-r1): sin ella, «consecutivo PQRSD-2026-000355» tomaba
    // «PQRS» como sigla y el tramo empezaba en «D-2026…», cuatro caracteres tarde.
    source: R`${BL}(?<l>${L_RADA_F}|${L_RADA_D})(?:[ ]+[A-Z]{2,6}\.?(?![\p{L}\p{N}_]))?${GAP}(?<v>${V_RADA})${NR}`,
    assess: assessRadAdmin01,
  },
  {
    id: 'R-RAD_ADMIN-02',
    type: 'RADICADO_ADMIN',
    flags: 'dgu',
    source: R`${BL}(?<l>${L_NI})${GAP_CS}(?<v>${V_NI})${NR}`,
    assess: assessRadAdmin02,
  },
  R_RAD_ADMIN_03,
];
