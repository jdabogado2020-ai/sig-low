// Reglas de contacto (PA-3; plan 7.2.5): R-TEL-01 a R-TEL-04, R-CORREO-01, R-CORREO-02 y R-BREB-01.
// Las expresiones leen la vista `reglas` (6.1.2) y están compuestas con las fuentes exactas de 7.2.0 y 7.2.1.
// `assess` es puro; un validador que falla baja la confianza una muesca, nunca descarta (INV-R03). Tabla 7.3.5.
import type { Confidence, RuleContext, RuleSpec, RuleVerdict } from '../types.ts';
import { correoValido, ndcMovil } from '../validators/telefono.ts';

const R = String.raw;

// ---- fragmentos comunes (7.2.0) ----
const BL = R`(?<![\p{L}\p{N}_])`;
const BR = R`(?![\p{L}\p{N}_])`;
const NL = R`(?<![\p{L}\p{N}_]|\p{N}[.,'\-\/])`;
const NR = R`(?![\p{L}\p{N}_]|[.,'\-\/]\p{N})`;
const NUMSIGN = R`(?:n\.?[ ]?º|no\.?|nro\.?|n[úu]m\.?|n[úu]mero|n\.|#)`;
// GAP y EXT sin cuantificadores de blancos separados por un opcional (PB-2-r5): `B*(?:S B*)?` es el lenguaje de `B* S? B*` sin
// su retroceso cuadrático.
const GAP = R`[ \t]*(?:[:.][ \t]*)?(?:\n[ \t]*)?(?:${NUMSIGN}[ \t]*(?:[:.][ \t]*)?)?`;
const PFX = R`(?:\(\+57\)|\+[ ]?57|0057|\(57\)|57)`;
const SUB7 = R`\d{3}(?:[ \-.]?\d{4}|[ \-.]\d{2}[ \-.]\d{2})`;
const EXT = R`(?:[ ]*(?:,[ ]*)?(?:ext\.?|extensi[óo]n)[ ]*(?::[ ]*)?\d{1,5})?`;

// ---- rótulos (7.2.1) ----
const L_TEL = R`tel[ée]fonos?(?:[ ]+(?:fijo|celular|m[óo]vil|de[ ]+contacto))?|tels?\.|tel|fijo|pbx|cel(?:ular)?\.?|m[óo]vil|whats[ ]?app|contacto|l[íi]nea(?:[ ]+gratuita)?|fax`;
const L_BREB_F = R`llaves?(?:[ ]+de[ ]+pagos?)?[ ]+bre-?[ ]?b|bre-?[ ]?b`;
const L_BREB_D = R`llaves?(?:[ ]+de[ ]+pagos?)?`;
const ES_BREB_D = new RegExp(R`^(?:${L_BREB_D})$`, 'iu');

// ---- valores (7.2.0) ----
const V_CEL = R`(?:(?<p>${PFX})[ \-.]?)?(?:\(3\d{2}\)|3\d{2})[ \-.]?${SUB7}`;
const V_FIJO = R`(?:(?<q>${PFX})[ \-.]?)?(?:\(60[124-8]\)|60[124-8])[ \-.]?${SUB7}`;
const V_OLD1 = R`(?:(?<r>${PFX})[ \-.]?)?\(?[124-8]\)?[ \-.]?\d{3}[ \-.]?\d{4}`;
const V_L018 = R`01[ \-.]?8000[ \-.]?\d{2}[ \-.]?\d{4}|01[ \-.]?8000[ \-.]?\d{6}`;
const V_OLD7 = R`\d{3}[ \-.]?\d{4}`;
const V_MAIL = R`[\p{L}\p{N}](?:[\p{L}\p{N}._%+\-]{0,62}[\p{L}\p{N}_%+\-])?@(?:[\p{L}\p{N}](?:[\p{L}\p{N}\-]{0,61}[\p{L}\p{N}])?\.)+\p{L}{2,24}`;
const V_MAIL2 = R`[\p{L}\p{N}](?:[\p{L}\p{N}._%+\-]{0,62}[\p{L}\p{N}_%+\-])?[ ]*(?:\(arroba\)|\[arroba\]|\(at\)|\[at\]|[ ]arroba[ ])[ ]*(?:[\p{L}\p{N}](?:[\p{L}\p{N}\-]{0,61}[\p{L}\p{N}])?(?:\.|[ ]*(?:\(punto\)|\[punto\]|\(dot\)|\[dot\])[ ]*|[ ]punto[ ]))+\p{L}{2,24}`;
const V_ALIAS = R`@[\p{L}\p{N}](?:[\p{L}\p{N}._\-]{1,28}[\p{L}\p{N}])?`;

// ---- utilidades ----
const digitos = (s: string): string => s.replace(/[^0-9]/gu, '');
/** Una muesca menos: alta → media → baja → baja. */
const muesca = (c: Confidence): Confidence => (c === 'alta' ? 'media' : 'baja');
const sinExtension = (s: string): string => s.replace(/(?:ext\.?|extensi[óo]n)[ ]*(?::[ ]*)?\d+$/iu, '');

function valorV(m: RegExpExecArray, ctx: RuleContext): string | null {
  const span = m.indices?.groups?.['v'];
  return span === undefined ? null : ctx.view.text.slice(span[0], span[1]);
}

/** Un prefijo internacional (+57, (+57), 0057) equivale a un rótulo; «57» o «(57)» a secas no. */
const esInternacional = (prefijo: string | undefined): boolean =>
  prefijo !== undefined && prefijo !== '57' && prefijo !== '(57)';

// ---- teléfonos ----
function assessTel01(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const v = valorV(m, ctx);
  if (v === null) return null;
  const nucleo = digitos(sinExtension(v)).slice(-10);
  const ok = ndcMovil(nucleo);
  let confidence: Confidence = esInternacional(m.groups?.['p']) ? 'alta' : 'media';
  if (!ok) confidence = muesca(confidence);
  return { confidence, validator: { name: 'NDC', passed: ok }, canonicalKey: `TEL:${nucleo}` };
}

function assessTel02(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const v = valorV(m, ctx);
  if (v === null) return null;
  return {
    confidence: esInternacional(m.groups?.['q']) ? 'alta' : 'media',
    validator: { name: 'NDC', passed: true },
    canonicalKey: `TEL:${digitos(sinExtension(v)).slice(-10)}`,
  };
}

function assessTel03(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const crudo = valorV(m, ctx);
  if (crudo === null) return null;
  const v = sinExtension(crudo);
  const d = digitos(v);
  if (/^01[ \-.]?8000/u.test(v)) {
    return { confidence: 'baja', canonicalKey: `TEL:${d.slice(-10)}`, labelId: 'ROT-TEL' };
  }
  // Celular o fijo actual: últimos 10 dígitos. Fijo antiguo con indicativo de una cifra: se antepone «60» (plan
  // vigente). Fijo de 7 dígitos sin indicativo: los 7 dígitos.
  let nucleo = d.slice(-10);
  if (!/^(?:3|60)/u.test(nucleo)) {
    const sinPrefijo = d.replace(/^(?:0057|57)/u, '');
    nucleo = sinPrefijo.length === 8 ? `60${sinPrefijo}` : sinPrefijo.slice(-7);
  }
  return { confidence: 'alta', canonicalKey: `TEL:${nucleo}`, labelId: 'ROT-TEL' };
}

function assessTel04(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const v = valorV(m, ctx);
  if (v === null) return null;
  const s7 = digitos(v).replace(/^(?:0057|57)/u, '');
  return { confidence: 'baja', canonicalKey: `TEL:60${s7.slice(-8)}` };
}

// ---- correos ----
function assessCorreo01(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const v = valorV(m, ctx);
  if (v === null) return null;
  const ok = correoValido(v);
  return { confidence: ok ? 'alta' : 'media', validator: { name: 'CORREO', passed: ok }, canonicalKey: `CORREO:${v.toLowerCase()}` };
}

/** Reconstruye la forma normal: «(arroba)», «[at]», « arroba » → «@»; « punto », «(punto)», «[dot]» → «.». */
function reconstruirCorreo(v: string): string {
  return v.toLowerCase()
    .replace(/\s*(?:\(arroba\)|\[arroba\]|\(at\)|\[at\]| arroba )\s*/u, '@')
    .replace(/\s*(?:\(punto\)|\[punto\]|\(dot\)|\[dot\])\s*| punto /gu, '.');
}

function assessCorreo02(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const v = valorV(m, ctx);
  if (v === null) return null;
  return { confidence: 'media', canonicalKey: `CORREO:${reconstruirCorreo(v)}` };
}

// ---- llave Bre-B ----
function assessBreb01(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const v = valorV(m, ctx);
  if (v === null) return null;
  const esFuerte = !ES_BREB_D.test(m.groups?.['l'] ?? '');
  return {
    confidence: esFuerte ? 'alta' : 'media',
    canonicalKey: `CUENTA:BREB:${v.toLowerCase()}`,
    labelId: esFuerte ? 'ROT-BREB' : 'ROT-LLAVE',
  };
}

export const rules: RuleSpec[] = [
  {
    id: 'R-TEL-01',
    type: 'TELEFONO',
    flags: 'dgiu',
    source: R`${NL}(?<v>${V_CEL}${EXT})${NR}`,
    assess: assessTel01,
  },
  {
    id: 'R-TEL-02',
    type: 'TELEFONO',
    flags: 'dgiu',
    source: R`${NL}(?<v>${V_FIJO}${EXT})${NR}`,
    assess: assessTel02,
  },
  {
    id: 'R-TEL-03',
    type: 'TELEFONO',
    flags: 'dgiu',
    source: R`${BL}(?<l>${L_TEL})${GAP}(?<v>(?:${V_CEL}|${V_FIJO}|${V_L018}|${V_OLD1}|${V_OLD7})${EXT})${NR}`,
    assess: assessTel03,
  },
  {
    id: 'R-TEL-04',
    type: 'TELEFONO',
    flags: 'dgu',
    source: R`${NL}(?<v>(?:${PFX}[ \-.]?)?\([124-8]\)[ \-.]?\d{3}[ \-.]?\d{4}|(?:\(\+57\)|\+[ ]?57|0057)[ \-.]?[124-8][ \-.]\d{3}[ \-.]?\d{4})${NR}`,
    assess: assessTel04,
  },
  {
    id: 'R-CORREO-01',
    type: 'CORREO',
    flags: 'dgu',
    source: R`(?<![\p{L}\p{N}._%+\-@])(?<v>${V_MAIL})(?![\p{L}\p{N}\-@])`,
    assess: assessCorreo01,
  },
  {
    id: 'R-CORREO-02',
    type: 'CORREO',
    flags: 'dgiu',
    source: R`(?<![\p{L}\p{N}._%+\-@])(?<v>${V_MAIL2})(?![\p{L}\p{N}\-@])`,
    assess: assessCorreo02,
  },
  {
    id: 'R-BREB-01',
    type: 'CUENTA',
    flags: 'dgiu',
    source: R`${BL}(?<l>${L_BREB_F}|${L_BREB_D})${GAP}(?<v>${V_ALIAS})${BR}`,
    assess: assessBreb01,
  },
];
