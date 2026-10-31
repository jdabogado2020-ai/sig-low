// Reglas de datos rotulados (PA-5; plan 7.2.6): R-PLACA-01 y -02, R-MAT-01 y -02, R-HC-01, R-AFIL-01 y -02,
// R-CUENTA-01 y R-TARJETA-01 a -03. Las expresiones leen la vista `reglas` (6.1.2) y están compuestas con las fuentes
// exactas de 7.2.0 y 7.2.1. `assess` es puro: filtros estructurales, validador Luhn y la tabla 7.3.5. Un validador que
// falla baja la confianza una muesca; nunca descarta (INV-R03). Los filtros estructurales sí descartan (7.2.0).
import type { Confidence, RuleContext, RuleSpec, RuleVerdict } from '../types.ts';
import { luhn } from '../validators/luhn.ts';

const R = String.raw;

// ---- fragmentos comunes (7.2.0) ----
const BL = R`(?<![\p{L}\p{N}_])`;
const NL = R`(?<![\p{L}\p{N}_]|\p{N}[.,'\-\/])`;
const NR = R`(?![\p{L}\p{N}_]|[.,'\-\/]\p{N})`;
const NUMSIGN = R`(?:n\.?[ ]?º|no\.?|nro\.?|n[úu]m\.?|n[úu]mero|n\.|#)`;
// GAP, V_DOCPFX y R-TARJETA-02 sin cuantificadores de blancos separados por un opcional (PB-2-r5): `B*(?:S B*)?` es el lenguaje
// de `B* S? B*`, y `(?:B* S)?B+` el de `B* S? B+`, sin su retroceso cuadrático.
const GAP = R`[ \t]*(?:[:.][ \t]*)?(?:\n[ \t]*)?(?:${NUMSIGN}[ \t]*(?:[:.][ \t]*)?(?:\n[ \t]*)?)?`;   // 7.1.5: el salto también tras «No.» (PA-ids-r1)
const SEPP = R`[ \-·.]?`;

// ---- rótulos (7.2.1) ----
const L_PLACA = R`placas?`;
const L_MAT_F = R`matr[íi]cula[ ]+inmobiliaria|folio[ ]+de[ ]+matr[íi]cula(?:[ ]+inmobiliaria)?|f\.?[ ]?m\.?[ ]?i\.?|m\.[ ]?i\.`;
const L_MAT_D = R`matr[íi]cula(?![ ]+(?:mercantil|profesional|inmobiliaria|de[ ]+(?:la[ ]+)?c[áa]mara|de[ ]+comercio))|folio`;
const L_HC = R`historia[ ]+cl[íi]nica|h\.[ ]?c\.(?:[ ]?l\.)?|hcl?|n[úu]mero[ ]+de[ ]+historia(?:[ ]+cl[íi]nica)?`;
const L_AFIL_F = R`n[úu]mero[ ]+de[ ]+afiliaci[óo]n|(?:no\.|n\.?[ ]?º)[ ]*de[ ]+afiliaci[óo]n|afiliaci[óo]n|afiliad[oa][ ]+(?=n[úu]mero|no\.|n\.?[ ]?º|#)|c[óo]digo[ ]+de[ ]+afiliad[oa]|n[úu]mero[ ]+de[ ]+afiliad[oa]`;
const L_AFIL_D = R`carn[ée]t?`;
const L_SALUD = R`n[úu]mero[ ]+de[ ]+autorizaci[óo]n|autorizaci[óo]n(?:[ ]+de[ ]+servicios?)?|orden[ ]+de[ ]+servicios?|n[úu]mero[ ]+de[ ]+prescripci[óo]n|prescripci[óo]n(?:[ ]+mipres)?|mipres|n[úu]mero[ ]+de[ ]+p[óo]liza|p[óo]liza(?:[ ]+(?:soat|de[ ]+seguros?|de[ ]+salud|de[ ]+responsabilidad[ ]+civil))?|n[úu]mero[ ]+de[ ]+siniestro|siniestro|reclamaci[óo]n`;
const L_CTA_F = R`cuentas?(?![ ]+de[ ]+cobro)(?:[ ]+(?:de[ ]+ahorros?|corriente|de[ ]+n[óo]mina|bancaria|de[ ]+dep[óo]sito))?(?:[ ]+(?:(?:del|de|en(?:[ ]+el)?)[ ]+)?(?:banco(?:[ ]+[\p{L}&.]+){1,4}?|bancolombia|davivienda|bbva|ita[úu]|colpatria|scotiabank(?:[ ]+colpatria)?|av[ ]+villas|caja[ ]+social|bancoomeva|bancam[íi]a|mibanco|nequi|daviplata|lulo[ ]+bank|nu))?|cta\.?(?:[ ]+(?:de[ ]+)?(?:ahorros?|cte\.?|corriente))?|n[úu]mero[ ]+de[ ]+(?:la[ ]+)?cuenta`;
const L_CTA_D = R`producto|dep[óo]sito[ ]+electr[óo]nico`;
const L_TAR = R`tarjeta(?:[ ]+de)?[ ]+(?:cr[ée]dito|d[ée]bito)|tarjeta|n[úu]mero[ ]+de[ ]+(?:la[ ]+)?tarjeta|t\.?[ ]?c\.?`;
const L_MASK = R`terminad[oa]s?|finalizad[oa]s?|que[ ]+termina|terminaci[óo]n|[úu]ltimos[ ]+(?:4|cuatro)[ ]+(?:n[úu]meros|d[íi]gitos|cifras)`;

/** La fuerza del rótulo se decide probando el grupo `l` contra el fragmento débil anclado, banderas `iu` (7.2.1). */
const debil = (src: string): RegExp => new RegExp(R`^(?:${src})$`, 'iu');
const ES_AFIL_D = debil(L_AFIL_D);
const ES_CTA_D = debil(L_CTA_D);

// ---- valores (7.2.0) ----
const V_PLACA_L = R`[A-Z]{3}${SEPP}\d{3}|[A-Z]{3}${SEPP}\d{2}[A-Z]?|\d{3}${SEPP}[A-Z]{3}|[SR]${SEPP}\d{4,6}`;
const V_PLACA_U = R`[A-Z]{3}[ \-·]?\d{3}|[A-Z]{3}\d{2}[A-Z]`;
const V_MAT_F = R`\d{2}[0-9A-Z][ ]?-?[ ]?\d{1,8}`;
const V_MAT_D = R`\d{2}[0-9A-Z][ ]?-[ ]?\d{1,8}`;
const V_DOCPFX = R`(?:(?<tp>c\.?[ ]?c|t\.?[ ]?i|r\.?[ ]?c|c\.?[ ]?e|p\.?[ ]?a)\.?[ ]*(?:[:.][ ]*)?)?`;
const V_HC = R`(?:[A-Z]{1,3}-?)?\d{1,3}(?:\.\d{3}){1,4}|(?:[A-Z]{1,3}-?)?\d{3,15}(?:-\d{1,6})?`;
const V_ALNUM = R`(?=[A-Za-z0-9\-]*\d)[A-Za-z0-9]+(?:-[A-Za-z0-9]+){0,3}`;
const V_CTA = R`\d(?:[ \-]?\d){5,19}`;
const V_TAR = R`[1-9]\d{12,18}|[1-9]\d{3}(?:[ \-]\d{4}){2}[ \-]\d{1,4}(?:[ \-]\d{3})?|3\d{3}[ \-]\d{6}[ \-]\d{4,5}`;

// ---- pista de R-TARJETA-02 (7.2.6) ----
const PISTA_TARJETA = /(?<![\p{L}])(?:tarjeta|cuenta|t\.?[ ]?c\.?|cr[ée]dito|d[ée]bito)(?![\p{L}])/iu;

// ---- utilidades ----
const digitos = (s: string): string => s.replace(/[^0-9]/gu, '');
const alfanum = (s: string): string => s.replace(/[^A-Za-z0-9]/gu, '').toUpperCase();
/** Valor de 4 caracteres con forma de año (`pareceAnio`, 7.2.2): baja la confianza de afiliación y autorizaciones. */
const parecenAnio = (s: string): boolean => /^(?:19|20)\d{2}$/u.test(s);

function valorV(m: RegExpExecArray, ctx: RuleContext): string | null {
  const span = m.indices?.groups?.['v'];
  return span === undefined ? null : ctx.view.text.slice(span[0], span[1]);
}

// ---- placas ----
function assessPlaca01(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const v = valorV(m, ctx);
  if (v === null) return null;
  return { confidence: 'alta', canonicalKey: `PLACA:${alfanum(v)}`, labelId: 'ROT-PLACA' };
}

function assessPlaca02(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const v = valorV(m, ctx);
  if (v === null) return null;
  return { confidence: 'media', canonicalKey: `PLACA:${alfanum(v)}` };
}

// ---- matrícula inmobiliaria ----
function assessMat01(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const v = valorV(m, ctx);
  if (v === null) return null;
  const compacto = v.toUpperCase().replace(/\s/gu, '');
  const partes = /^([0-9A-Z]{3})-?(\d+)$/u.exec(compacto);
  const clave = partes === null ? compacto : `${partes[1] ?? ''}-${partes[2] ?? ''}`;
  return { confidence: 'alta', canonicalKey: `MAT:${clave}`, labelId: 'ROT-MAT' };
}

function assessMat02(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const v = valorV(m, ctx);
  if (v === null) return null;
  return { confidence: 'media', canonicalKey: `MAT:${v.toUpperCase().replace(/\s/gu, '')}`, labelId: 'ROT-MAT-GEN' };
}

// ---- historia clínica ----
function assessHc01(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const v = valorV(m, ctx);
  if (v === null) return null;
  // Si el tipo escrito es «TI» o «RC», `generalize.ts` crea también la bandera MENOR (7.2.6); el veredicto no la lleva.
  return { confidence: 'alta', canonicalKey: `HC:${digitos(v)}`, labelId: 'ROT-HC' };
}

// ---- afiliación, autorizaciones, MIPRES, pólizas y siniestros ----
function assessAfil01(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const v = valorV(m, ctx);
  if (v === null) return null;
  const a = alfanum(v);
  if (a.length < 4 || a.length > 25 || digitos(a).length < 3) return null;      // filtro estructural (7.2.6)
  const fuerte = !ES_AFIL_D.test(m.groups?.['l'] ?? '');
  const confidence: Confidence = parecenAnio(a) ? 'baja' : fuerte ? 'alta' : 'media';
  return { confidence, canonicalKey: `AFIL:${a}`, labelId: fuerte ? 'ROT-AFIL' : 'ROT-CARNE' };
}

function assessAfil02(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const v = valorV(m, ctx);
  if (v === null) return null;
  const a = alfanum(v);
  if (a.length < 4 || a.length > 30 || digitos(a).length < 3) return null;      // filtro estructural (7.2.6)
  return { confidence: parecenAnio(a) ? 'baja' : 'alta', canonicalKey: `AFIL:${a}`, labelId: 'ROT-SALUD' };
}

// ---- cuenta bancaria ----
function assessCuenta01(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const v = valorV(m, ctx);
  if (v === null) return null;
  const fuerte = !ES_CTA_D.test(m.groups?.['l'] ?? '');
  return { confidence: fuerte ? 'alta' : 'media', canonicalKey: `CUENTA:${digitos(v)}`, labelId: fuerte ? 'ROT-CTA' : 'ROT-PRODUCTO' };
}

// ---- tarjetas ----
/**
 * Con rótulo: Luhn pasa → alta, falla → media. Sin rótulo: pasa → media, falla → baja (7.3.5, 7.2.2). El validador
 * nunca descarta (INV-R03): una cadena larga que no pasa Luhn se propone igual, porque puede ser otro identificador.
 */
function assessTarjeta01(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const v = valorV(m, ctx);
  if (v === null) return null;
  const d = digitos(v);
  const ok = luhn(d);
  const rotulo = (m.groups?.['l'] ?? '') !== '';
  const confidence: Confidence = rotulo ? (ok ? 'alta' : 'media') : (ok ? 'media' : 'baja');
  const veredicto: RuleVerdict = { confidence, validator: { name: 'LUHN', passed: ok }, canonicalKey: `CUENTA:${d}` };
  if (rotulo) veredicto.labelId = 'ROT-TAR';
  return veredicto;
}

function assessTarjetaVisible(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const v = valorV(m, ctx);
  if (v === null) return null;
  return { confidence: 'baja', canonicalKey: `CUENTA:${v}` };
}

export const rules: RuleSpec[] = [
  {
    id: 'R-PLACA-01',
    type: 'PLACA',
    flags: 'dgiu',
    source: R`${BL}(?<l>${L_PLACA})${GAP}(?<v>${V_PLACA_L})${NR}`,
    assess: assessPlaca01,
  },
  {
    id: 'R-PLACA-02',
    type: 'PLACA',
    flags: 'dgu',
    source: R`${BL}(?<v>${V_PLACA_U})${NR}`,
    assess: assessPlaca02,
  },
  {
    id: 'R-MAT-01',
    type: 'MATRICULA',
    flags: 'dgiu',
    source: R`${BL}(?<l>${L_MAT_F})${GAP}(?<v>${V_MAT_F})${NR}`,
    assess: assessMat01,
  },
  {
    id: 'R-MAT-02',
    type: 'MATRICULA',
    flags: 'dgiu',
    source: R`${BL}(?<l>${L_MAT_D})${GAP}(?<v>${V_MAT_D})${NR}`,
    assess: assessMat02,
  },
  {
    id: 'R-HC-01',
    type: 'HC',
    flags: 'dgiu',
    source: R`${BL}(?<l>${L_HC})${GAP}${V_DOCPFX}(?<v>${V_HC})${NR}`,
    assess: assessHc01,
  },
  {
    id: 'R-AFIL-01',
    type: 'AFILIACION',
    flags: 'dgiu',
    source: R`${BL}(?<l>${L_AFIL_F}|${L_AFIL_D})${GAP}(?<v>${V_ALNUM})${NR}`,
    assess: assessAfil01,
  },
  {
    id: 'R-AFIL-02',
    type: 'AFILIACION',
    flags: 'dgiu',
    source: R`${BL}(?<l>${L_SALUD})${GAP}(?<v>${V_ALNUM})${NR}`,
    assess: assessAfil02,
  },
  {
    id: 'R-CUENTA-01',
    type: 'CUENTA',
    flags: 'dgiu',
    source: R`${BL}(?<l>${L_CTA_F}|${L_CTA_D})${GAP}(?<v>${V_CTA})${NR}`,
    assess: assessCuenta01,
  },
  {
    id: 'R-TARJETA-01',
    type: 'TARJETA',
    flags: 'dgiu',
    source: R`(?:${BL}(?<l>${L_TAR})${GAP})?${NL}(?<!\d[ \-])(?<v>${V_TAR})${NR}(?![ \-]\d+(?![\/\d]))`,
    assess: assessTarjeta01,
  },
  {
    id: 'R-TARJETA-02',
    type: 'TARJETA',
    flags: 'dgiu',
    source: R`${BL}(?<l>${L_MASK})(?:[ ]+(?:en|son|es))?(?:[ ]*:)?[ ]+(?:(?:el|los|las)[ ]+(?:[úu]ltimos[ ]+)?(?:n[úu]meros?|d[íi]gitos?|cifras?)[ ]+)?(?<v>\d{4})${NR}`,
    needsCue: PISTA_TARJETA,
    assess: assessTarjetaVisible,
  },
  {
    id: 'R-TARJETA-03',
    type: 'TARJETA',
    flags: 'dgu',
    // Desvío de forma, no de lenguaje: la racha de máscara se toma completa con una anticipación + referencia
    // (`(?=([*•]{2,}))\1`, atómica). Con la fuente literal de 7.2.6, una racha de 100.000 asteriscos sin dígitos final
    // reparte la racha entre los tres grupos de todas las maneras posibles (retroceso polinómico) y cuelga el worker.
    // Reconoce exactamente los mismos tramos: lo que sigue a la racha nunca puede empezar con parte de ella.
    source: R`(?<![\p{L}\p{N}*•])(?:(?:(?=([*•]{2,}))\1|[xX]{4})[ \-]?){1,3}(?<v>\d{4})${NR}`,
    assess: assessTarjetaVisible,
  },
];
