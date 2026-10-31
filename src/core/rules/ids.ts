// Catálogo A, identificaciones (7.2.3): R-CC-01..03, R-TI-01, R-DOC-01, R-CE-01, R-PPT-01, R-PEP-01,
// R-PASAPORTE-01, R-NIT-01, R-NIT-02 y R-TP-01. Expresiones de 7.2.0 a 7.2.3 (banco regexlab/07a, 891 casos, 0 fallos).
// TypeScript puro (sin DOM ni red); `assess` es una función pura. Un validador que falla solo baja la confianza (INV-R03, INV-G12).
import type { Confidence, DataType, RuleContext, RuleSpec, RuleVerdict } from '../types.ts';
import { dvNit, esNitJuridico } from '../validators/nit.ts';

const R = String.raw;

// ---------------------------------------------------------------------------------------------------------------------
// Fragmentos comunes (7.2.0), fuente exacta
// ---------------------------------------------------------------------------------------------------------------------
const BL = R`(?<![\p{L}\p{N}_])`;
const NL = R`(?<![\p{L}\p{N}_]|\p{N}[.,'\-\/])`;
const NR = R`(?![\p{L}\p{N}_]|[.,'\-\/]\p{N})`;
const NUMSIGN = R`(?:n\.?[ ]?º|no\.?|nro\.?|n[úu]m\.?|n[úu]mero|n\.|#)`;
const GAP = R`[ \t]*[:.]?[ \t]*(?:\n[ \t]*)?(?:${NUMSIGN}[ \t]*[:.]?[ \t]*)?`;
/**
 * NOHC: el tipo de documento escrito dentro de una historia clínica («HC: CC 1000000001») es de R-HC-01. Los blancos del
 * lookbehind llevan tope (M-14, PB-2-r5): con `[ \t]*` sin tope, el retroceso en una racha de tabuladores antes del rótulo era
 * cuadrático en cada posición (20.000 tabuladores y «cc 1000000001», 1,8 s en R-CC-01 y 2,7 s en R-CE-01).
 */
const NOHC = R`(?<!(?:(?<![\p{L}])h\.?[ ]?c\.?l?|cl[íi]nica)[ \t]{0,8}[:.]?[ \t]{0,8}(?:(?:n[úu]mero|no\.?)[ \t]{0,8})?)`;
export const FR = { BL, NL, NR, NUMSIGN, GAP, NOHC } as const;

// Rótulos (7.2.1)
export const L = {
  CC_F: R`c[ ]?\.?[ ]?c\.?|c[ée]dula(?:[ ]+de[ ]+ciudadan[íi]a)?|c[ée]d\.(?:[ ]?(?:de[ ]+)?ciud\.)?`,
  // El lookbehind de «nuip» lleva sus espacios con tope (M-14, PB-2-r5): sin él, «registro civil» y una racha de espacios fuera
  // de la vista `reglas` era cuadrático (20.000 espacios, 3,8 s en R-CC-01).
  CC_D: R`documento(?:[ ]+de[ ]+identi(?:dad|ficaci[óo]n))?|identificaci[óo]n|identificad[oa]s?[ ]+con(?:[ ]+(?:la|el))?|(?<!registro[ ]{1,8}civil(?:[ ]{1,8}de[ ]{1,8}nacimiento)?[ ]{1,8}(?:con[ ]{1,8})?(?:(?:el[ ]{1,8})?n[úu]mero[ ]{1,8})?)n\.?[ ]?u\.?[ ]?i\.?[ ]?p\.?`,
  TI: R`t\.?[ ]?i\.?|tarjeta[ ]+de[ ]+identidad|n\.?[ ]?i\.?[ ]?p\.?`,
  RC: R`registro[ ]+civil(?:[ ]+de[ ]+nacimiento)?(?:[ ]+(?:con[ ]+)?(?:(?:el[ ]+)?n[úu]mero[ ]+)?(?:nuip|n\.[ ]?u\.[ ]?i\.[ ]?p\.|indicativo[ ]+serial))?|indicativo[ ]+serial`,
  DOCX: R`carn[ée]t?[ ]+diplom[áa]tico|salvoconducto(?:[ ]+de[ ]+permanencia)?`,
  CE: R`c\.?[ ]?e\.?|c[ée]dula[ ]+de[ ]+extranjer[íi]a`,
  PPT: R`p\.?[ ]?p\.?[ ]?t\.?|permiso[ ]+por[ ]+protecci[óo]n[ ]+temporal`,
  PEP: R`p\.?[ ]?e\.?[ ]?p\.?|permiso[ ]+especial[ ]+de[ ]+permanencia`,
  PAS: R`pasaporte(?:[ ]+(?:colombian[oa]|venezolan[oa]|extranjer[oa]|vigente|ordinario|diplom[áa]tico))?|pasaporte(?:[ ]+expedido[ ]+por)?[ ]+de[ ]+(?:la[ ]+|los[ ]+)?(?:\p{L}+[ ]+){1,4}?(?=n\.?[ ]?º|no\.|nro\.?|n[úu]mero|#)|pas\.|p\.[ ]?a\.|pa(?=[ \t]*(?:[:#]|n\.?[ ]?º|no\.|nro\.?))`,
  NIT: R`nit|n\.[ ]?i\.[ ]?t\.?|n[úu]mero[ ]+de[ ]+identificaci[óo]n[ ]+tributaria`,
  TP: R`t\.?[ ]?p\.?|tarjeta[ ]+profesional(?:[ ]+de[ ]+abogad[oa])?|registro[ ]+(?:m[ée]dico|profesional)|r\.?[ ]?m\.?|matr[íi]cula[ ]+profesional`,
} as const;

// Valores (7.2.0)
const V_DOC = R`\d{1,3}(?:(?:\.\d{3}){1,5}|(?: \d{3}){1,5})|\d{4,16}`;
export const V = {
  CC: R`\d{1,3}(?:'\d{3}(?:\.\d{3}){1,2}|(?:\.\d{3}){1,3}|(?: \d{3}){1,3})|\d{3,10}`,
  TI: R`\d{1,3}(?:(?:\.\d{3}){1,3}|(?: \d{3}){1,3})|\d{6,11}`,
  DOC: V_DOC,
  DOCU: R`${V_DOC}|(?=[A-Za-z0-9\-]*\d)[A-Za-z0-9]+(?:-[A-Za-z0-9]+){0,3}`,
  PAS: R`(?=[A-Za-z]*\d)[A-Za-z0-9]{5,9}`,
  NIT_L: R`(?<b>\d{1,3}(?:\.\d{3}){1,4}|\d{1,3}(?: \d{3}){1,4}|\d{5,15})(?:[ ]?(?:-|dv[ ]?:?)[ ]?(?<dv>\d))?`,
  TP: R`\d{1,3}(?:\.\d{3}){1,2}|\d{3,7}`,
} as const;

// ---------------------------------------------------------------------------------------------------------------------
// Verosimilitud y utilidades (7.2.2). Fallar nunca descarta: solo baja una muesca.
// ---------------------------------------------------------------------------------------------------------------------
/** Sin ceros a la izquierda ni todo ceros; 1 a 8 dígitos, o 10 que empiezan por 1 (NUIP desde 2003) o 2 (Res. RNEC 8937 de 2019). */
export function verosimilCC(d: string): boolean {
  if (d.length === 0 || d[0] === '0') return false;
  if (d.length <= 8) return true;
  if (d.length === 10) return d[0] === '1' || d[0] === '2';
  return false;
}
/** 10 dígitos que empiezan por 1 o 2, u 11 con AAMMDD válido en los 6 primeros (NIP). */
export function verosimilTI(d: string): boolean {
  if (d.length === 10) return d[0] === '1' || d[0] === '2';
  if (d.length === 11) {
    const mm = Number(d.slice(2, 4)), dd = Number(d.slice(4, 6));
    return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
  }
  return false;
}
/** Valor de 4 caracteres con forma de año (con rótulo de CE, PPT, PEP, afiliación o radicado administrativo). */
export function pareceAnio(s: string): boolean {
  return /^(?:19|20)\d{2}$/.test(s);
}

const digits = (s: string): string => s.replace(/[^0-9]/g, '');
const alnum = (s: string): string => s.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const down = (c: Confidence): Confidence => (c === 'alta' ? 'media' : 'baja');
const esFuerte = (fragmento: string, rotulo: string | undefined): boolean =>
  rotulo !== undefined && new RegExp(R`^(?:${fragmento})$`, 'iu').test(rotulo);
const grupo = (m: RegExpExecArray, nombre: string): string | undefined => m.groups?.[nombre];
const valor = (m: RegExpExecArray): string => m.groups?.['v'] ?? m[0];

// ---------------------------------------------------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------------------------------------------------
const rCC01: RuleSpec = {
  id: 'R-CC-01', type: 'CC', flags: 'dgiu',
  // Desvío D-A6-1: se agrupa `(?:${V.CC})` porque V.CC tiene alternación de primer nivel y, sin el grupo, el DV pegado solo se asociaba a la forma de dígitos seguidos (la forma con puntos, «41.000.001-7», no lo tomaba).
  source: R`${BL}${NOHC}(?<l>${L.CC_F}|${L.CC_D})${GAP}(?<v>(?:${V.CC})(?:[ ]?-[ ]?(?<dv>\d)(?![\p{N}]))?)${NR}`,
  assess(m: RegExpExecArray, _ctx: RuleContext): RuleVerdict {
    // El DV pegado entra en el tramo (para no dejar un dígito suelto) pero no en la clave.
    const v = valor(m);
    const d = digits(grupo(m, 'dv') !== undefined ? v.replace(/[ ]?-[ ]?\d$/, '') : v);
    const fuerte = !esFuerte(L.CC_D, grupo(m, 'l'));
    let confidence: Confidence = fuerte ? 'alta' : 'media';
    if (!verosimilCC(d)) confidence = down(confidence);
    return { confidence, canonicalKey: 'CC:' + d, labelId: fuerte ? 'ROT-CC' : 'ROT-DOC' };
  },
};

const rCC02: RuleSpec = {
  id: 'R-CC-02', type: 'CC', flags: 'dgu',
  source: R`${NL}(?<v>[12]\.\d{3}\.\d{3}\.\d{3}|\d{1,2}(?:\.|')\d{3}\.\d{3})${NR}`,
  assess(m: RegExpExecArray): RuleVerdict {
    const d = digits(valor(m));
    return { confidence: verosimilCC(d) ? 'media' : 'baja', canonicalKey: 'CC:' + d };
  },
};

const rCC03: RuleSpec = {
  id: 'R-CC-03', type: 'CC', flags: 'dgu',
  source: R`${NL}(?<!(?<![\p{N}])\p{N}{1,3}[ ])(?<v>[12]\d{9}|[1-9]\d{6,7})${NR}`,
  assess(m: RegExpExecArray): RuleVerdict {
    return { confidence: 'baja', canonicalKey: 'CC:' + valor(m) };
  },
};

/** TI y NIP: la bandera MENOR y la sugerencia ROTULO_DOCUMENTO_A_GENERICO las crea `generalize.ts` (PG-4); la familia DOCUMENTO, `familyFor`. */
const rTI01: RuleSpec = {
  id: 'R-TI-01', type: 'TI', flags: 'dgiu',
  source: R`${BL}${NOHC}(?<l>${L.TI})${GAP}(?<v>${V.TI})${NR}`,
  assess(m: RegExpExecArray): RuleVerdict {
    const d = digits(valor(m));
    return { confidence: verosimilTI(d) ? 'alta' : 'media', canonicalKey: 'TI:' + d, labelId: 'ROT-TI' };
  },
};

const rDOC01: RuleSpec = {
  id: 'R-DOC-01', type: 'DOCUMENTO', flags: 'dgiu',
  source: R`${BL}${NOHC}(?<l>${L.RC}|${L.DOCX})${GAP}(?<v>${V.DOCU})${NR}`,
  assess(m: RegExpExecArray): RuleVerdict | null {
    const a = alnum(valor(m));
    if (a.length < 4 || a.length > 16 || digits(a).length < 4) return null;   // filtro estructural (parte del patrón)
    const registroCivil = esFuerte(L.RC, grupo(m, 'l'));
    return { confidence: registroCivil ? 'media' : 'alta', canonicalKey: 'DOCUMENTO:' + a, labelId: registroCivil ? 'ROT-RC' : 'ROT-DOCX' };
  },
};

function extranjeria(id: string, type: 'CE' | 'PPT' | 'PEP', rotulo: string, labelId: string, conNoHc: boolean): RuleSpec {
  return {
    id, type, flags: 'dgiu',
    source: R`${BL}${conNoHc ? NOHC : ''}(?<l>${rotulo})${GAP}(?<v>${V.DOC})${NR}`,
    assess(m: RegExpExecArray): RuleVerdict {
      const d = digits(valor(m));
      return { confidence: d.length === 4 && pareceAnio(d) ? 'baja' : 'alta', canonicalKey: type + ':' + d, labelId };
    },
  };
}
const rCE01 = extranjeria('R-CE-01', 'CE', L.CE, 'ROT-CE', true);
const rPPT01 = extranjeria('R-PPT-01', 'PPT', L.PPT, 'ROT-PPT', false);
const rPEP01 = extranjeria('R-PEP-01', 'PEP', L.PEP, 'ROT-PEP', false);

const rPASAPORTE01: RuleSpec = {
  id: 'R-PASAPORTE-01', type: 'PASAPORTE', flags: 'dgiu',
  source: R`${BL}(?<l>${L.PAS})${GAP}(?<v>${V.PAS})${NR}`,
  assess(m: RegExpExecArray): RuleVerdict {
    return { confidence: 'alta', canonicalKey: 'PASAPORTE:' + alnum(valor(m)), labelId: 'ROT-PAS' };
  },
};

const rNIT01: RuleSpec = {
  id: 'R-NIT-01', type: 'NIT', flags: 'dgiu',
  source: R`${BL}(?<l>${L.NIT})${GAP}(?<v>${V.NIT_L})${NR}`,
  assess(m: RegExpExecArray): RuleVerdict {
    let base = digits(grupo(m, 'b') ?? '');
    let dv = grupo(m, 'dv');
    // Diez dígitos seguidos que empiezan por 8 o 9 se leen como 9 + DV pegado.
    if (dv === undefined && base.length === 10 && (base[0] === '8' || base[0] === '9')) { dv = base[9]; base = base.slice(0, 9); }
    const juridica = esNitJuridico(base);
    let confidence: Confidence = 'alta';
    let validator: RuleVerdict['validator'];
    if (dv !== undefined) {
      const passed = dvNit(base) === Number(dv);
      validator = { name: 'DV_NIT', passed };
      if (!passed) confidence = 'media';               // INV-R03: un DV erróneo baja la confianza, nunca descarta
    }
    if (!juridica && !verosimilCC(base)) confidence = down(confidence);
    return { confidence, canonicalKey: 'NIT:' + base, labelId: 'ROT-NIT', ...(validator ? { validator } : {}) };
  },
};

const rNIT02: RuleSpec = {
  id: 'R-NIT-02', type: 'NIT', flags: 'dgu',
  source: R`${NL}(?<v>(?<b>[89]\d{2}\.\d{3}\.\d{3}|[89]\d{2} \d{3} \d{3}(?=[ ]?-[ ]?\d)|[89]\d{8})(?:[ ]?-[ ]?(?<dv>\d))?|(?<b2>[12]\.\d{3}\.\d{3}\.\d{3}|\d{1,2}\.\d{3}\.\d{3})[ ]?-[ ]?(?<dv2>\d))${NR}`,
  assess(m: RegExpExecArray): RuleVerdict {
    const bruto = grupo(m, 'b') ?? grupo(m, 'b2') ?? '';
    const base = digits(bruto);
    const dv = grupo(m, 'dv') ?? grupo(m, 'dv2');
    const inicial: Confidence = bruto.includes('.') || dv !== undefined ? 'media' : 'baja';
    let confidence: Confidence = inicial;
    let validator: RuleVerdict['validator'];
    if (dv !== undefined) {
      const passed = dvNit(base) === Number(dv);
      validator = { name: 'DV_NIT', passed };
      confidence = passed ? 'alta' : down(inicial);
    }
    return { confidence, canonicalKey: 'NIT:' + base, ...(validator ? { validator } : {}) };
  },
};

const rTP01: RuleSpec = {
  id: 'R-TP-01', type: 'TP', flags: 'dgiu',
  source: R`${BL}(?<l>${L.TP})${GAP}(?<v>${V.TP})${NR}`,
  assess(m: RegExpExecArray): RuleVerdict {
    return { confidence: 'alta', canonicalKey: 'TP:' + digits(valor(m)), labelId: 'ROT-TP' };
  },
};

export const rules: RuleSpec[] = [
  rCC01, rCC02, rCC03, rTI01, rDOC01, rCE01, rPPT01, rPEP01, rPASAPORTE01, rNIT01, rNIT02, rTP01,
];

// ---------------------------------------------------------------------------------------------------------------------
// Mismo titular (6.6.1 y 7.12.3): CC, TI, CE, PPT, PEP, DOCUMENTO, HC, AFILIACION (clave numérica) y NIT natural con los mismos
// dígitos son entidades distintas, unidas por `sameHolderAs`. TP y PASAPORTE no entran. `entities.ts` (PB-3) puede reutilizarlo.
// ---------------------------------------------------------------------------------------------------------------------
const TIPOS_TITULAR: ReadonlySet<DataType> = new Set<DataType>(['CC', 'TI', 'CE', 'PPT', 'PEP', 'DOCUMENTO', 'HC', 'AFILIACION', 'NIT']);

/** Dígitos de titular de una entidad según su tipo y su clave canónica, o `null` si no entra en la unión. */
export function holderDigits(type: DataType, canonicalKey: string): string | null {
  if (!TIPOS_TITULAR.has(type)) return null;
  const i = canonicalKey.indexOf(':');
  const valorClave = i < 0 ? canonicalKey : canonicalKey.slice(i + 1);
  if (type === 'AFILIACION') return /^\d+$/.test(valorClave) ? valorClave : null;   // solo con clave numérica
  const d = digits(valorClave);
  if (d.length === 0) return null;
  if (type === 'NIT') return esNitJuridico(valorClave) ? null : d;                  // solo el NIT de persona natural (la CC)
  return d;
}

export interface TitularEntrada { readonly id: string; readonly type: DataType; readonly canonicalKey: string }

/** Pares `sameHolderAs` simétricos: para cada id, el conjunto de los demás ids con los mismos dígitos de titular (INV-T05). */
export function sameHolderAs(entidades: readonly TitularEntrada[]): Map<string, Set<string>> {
  const porDigitos = new Map<string, string[]>();
  for (const e of entidades) {
    const d = holderDigits(e.type, e.canonicalKey);
    if (d === null) continue;
    const lista = porDigitos.get(d);
    if (lista) lista.push(e.id); else porDigitos.set(d, [e.id]);
  }
  const salida = new Map<string, Set<string>>();
  for (const ids of porDigitos.values()) {
    if (ids.length < 2) continue;
    for (const a of ids) {
      const otros = salida.get(a) ?? new Set<string>();
      for (const b of ids) if (b !== a) otros.add(b);
      salida.set(a, otros);
    }
  }
  return salida;
}
