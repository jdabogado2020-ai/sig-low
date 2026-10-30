// Exclusiones y calibración de confianza (PA-7; plan 7.3): E-NORMA-01 y 02, E-ART-01, E-SENT-01, E-EXPCC-01, E-PROV-01,
// E-FOLIO-01, E-PUB-01, E-CANT-01, E-UNIDAD-01, E-DINERO-01, E-DANE-01, E-POSTAL-01, E-CIIU-01, E-CIE10-01, E-DESP-01,
// E-DESP-02 y E-SIGLA-01. El contexto de cita jurisprudencial (E-CITA-01, 7.3.3) lo decide `esContextoDeCita`, que también usa `generalize.ts` (`isCitation`, G-13 / R-CIT-01, 7.7.6: una sola fuente de verdad).
//
// TypeScript puro: sin DOM, sin red, sin registro. Una exclusión NO es una regla de detección: no crea candidatos ni cambia
// tipos (7.3.1). Se ejecuta DESPUÉS de las reglas, sobre la misma vista `reglas`, y protege tramos con nombre (`n`, `n2`, `fy`,
// `y`, `m`): un candidato de regla cuyo tramo queda contenido por completo en un tramo protegido de su alcance se suprime
// (`suprime`) o baja una muesca (`baja`). Un solape parcial no afecta. Nunca se aplica a la lista del caso, al modelo ni a lo manual.
//
// Decisión sobre 7.5.5 y 7.6.4 (nota 2 de la tarjeta PA-7): `fechas.ts` y `valores.ts` (PA-6) ya aplican dentro de su `assess`
// los contextos EXC-FECHA-A/B y UVT/umbral de cuantía, porque necesitan el contexto para fijar `context` ('norma', 'cita')
// que una exclusión no puede dar (7.3.1: no cambia nada salvo la confianza). Se dejan allí: aplicarlos otra vez desde este
// módulo es idempotente (suprimir dos veces suprime; `baja` es el piso de la escala). Este módulo es la fuente de verdad
// de los tramos protegidos que consultan la fusión y los demás módulos (`tramosProtegidos`).
import { toCanonicalSpan } from '../normalize.ts';
import { RULE_TIME_LIMIT_MS } from './catalog.ts';
import { CORPORACIONES, radicado } from '../validators/radicado.ts';
import type { Confidence, DetectableType, DetectionCandidate, RuleSpec, SearchView } from '../types.ts';

/**
 * Las exclusiones no son reglas de detección: este módulo exporta `rules` vacío para conservar la firma común de los archivos
 * de `rules/` (9.1, regla 10). Las exclusiones están en `EXCLUSIONES`; se aplican con `aplicarExclusiones`.
 */
export const rules: RuleSpec[] = [];

const R = String.raw;
// ---- fragmentos comunes (7.2.0) ----
const BL = R`(?<![\p{L}\p{N}_])`;
const BR = R`(?![\p{L}\p{N}_])`;
const NL = R`(?<![\p{L}\p{N}_]|\p{N}[.,'\-\/])`;
const NR = R`(?![\p{L}\p{N}_]|[.,'\-\/]\p{N})`;
const L_EXP = R`[Ee]xpediente|EXPEDIENTE|[Ee]xp\.|EXP\.`;

/** Identificaciones = tipos del catálogo A salvo `CORREO` (7.3.1). */
export const ID_TIPOS: ReadonlySet<DetectableType> = new Set<DetectableType>([
  'CC', 'TI', 'CE', 'PPT', 'PEP', 'PASAPORTE', 'NIT', 'TP', 'DOCUMENTO', 'RADICADO', 'RADICADO_ADMIN', 'TELEFONO',
  'PLACA', 'MATRICULA', 'CUENTA', 'TARJETA', 'HC', 'AFILIACION',
]);
/** Identificaciones personales (sin radicados, 7.3.1). */
export const ID_PERSONAL: ReadonlySet<DetectableType> = new Set<DetectableType>([
  'CC', 'TI', 'DOCUMENTO', 'CE', 'PPT', 'PEP', 'PASAPORTE', 'NIT', 'TP', 'HC', 'AFILIACION', 'TELEFONO', 'TARJETA', 'CUENTA', 'PLACA',
]);

/** Siglas y palabras en mayúsculas que parecen placas (E-SIGLA-01). Se amplía con el corpus. */
export const SIGLAS: readonly string[] = [
  'LEY', 'ART', 'DEC', 'RES', 'NUM', 'CAP', 'PAG', 'FOL', 'EXP', 'RAD', 'REF', 'SEC', 'TIT', 'LIT',
  'INC', 'PAR', 'ACU', 'CIR', 'ORD', 'NIT', 'RUT', 'SAS', 'LTD', 'CIA', 'COP', 'USD', 'EUR', 'UVT',
  'IVA', 'ICA', 'ISO', 'NTC', 'CIE', 'CUM', 'POS', 'PBS', 'EPS', 'IPS', 'ARL', 'AFP', 'CCF', 'TEL',
  'CEL', 'EXT', 'FAX', 'KRA', 'CRA', 'CLL', 'CAL', 'TRV', 'TRA', 'AVE', 'AUT', 'MZA', 'APT', 'INT',
  'LOC', 'OFI', 'OFC', 'BLQ', 'TOR', 'LOT', 'DEL', 'LAS', 'LOS', 'POR', 'QUE', 'CON', 'SIN', 'UNA',
  'UNO', 'MAS', 'SUS', 'LES', 'NOS', 'MES', 'DIA', 'HAY', 'SON', 'FUE', 'ERA', 'VEZ', 'MIL', 'TAL',
  'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'SET', 'OCT', 'NOV', 'DIC', 'COD',
  'CGP', 'CPP', 'CST', 'CCA', 'STC', 'STP', 'STL', 'ATC', 'ATL', 'ATP', 'AHP', 'VOL', 'LIB', 'ANX',
  'ACT', 'OBS', 'REG', 'DTO',
];

export type ModoExclusion = 'suprime' | 'baja';
type Alcance = '*' | ReadonlySet<DetectableType>;

/** Una exclusión: patrón con grupos con nombre, modo (o función que lo decide, `null` = no aplica) y alcance (7.3.1). */
export interface Exclusion {
  id: string;
  flags: 'dgu' | 'dgiu';
  modo: ModoExclusion | ((m: RegExpExecArray, texto: string) => ModoExclusion | null);
  /** Modo propio de algunos grupos (E-NORMA-02: el año o la fecha solo bajan). */
  modoGrupo?: Readonly<Record<string, ModoExclusion>>;
  alcance: Alcance;
  /** Grupos con nombre que protege (además de `n2`, si existe). */
  protege: readonly string[];
  source: string;
}

/** Umbral normativo en los 60 caracteres previos (E-CANT-01). */
const CUANTIA = /(?:cuant[íi]a|superior(?:es)?[ ]+a|inferior(?:es)?[ ]+a|que[ ]+no[ ]+exceda|hasta|m[áa]s[ ]+de|menos[ ]+de|tope|l[íi]mite)[^\n]{0,30}$/iu;
const UNIDAD_SIEMPRE = /^(?:uvt|%|por[ ]+ciento|puntos[ ]+porcentuales)$/u;

/** UVT, «%», «por ciento» y «puntos porcentuales» suprimen; SMMLV y variantes, solo con umbral de cuantía antes (7.3.2). */
function modoCant(m: RegExpExecArray, texto: string): ModoExclusion {
  const u = (m.groups?.['u'] ?? '').toLowerCase();
  if (UNIDAD_SIEMPRE.test(u)) return 'suprime';
  return CUANTIA.test(texto.slice(Math.max(0, m.index - 60), m.index)) ? 'suprime' : 'baja';
}

/**
 * E-DESP-02: baja solo si los 5 primeros dígitos están en la DIVIPOLA (o son `DD000`) y los dígitos 6 y 7 son una corporación
 * de la lista. Se reutiliza `radicado()` con un relleno: el año 2000 es válido para `refYear` 2000 y el resto no se mira.
 */
function modoDesp02(m: RegExpExecArray): ModoExclusion | null {
  const d = (m.groups?.['n'] ?? '').replace(/\D/gu, '');
  if (d.length !== 12) return null;
  const r = radicado(d.slice(0, 7) + '00000' + '2000' + '0000000', 2000);
  return r.ok && CORPORACIONES.has(d.slice(5, 7)) ? 'baja' : null;
}

export const EXCLUSIONES: readonly Exclusion[] = [
  {
    id: 'E-NORMA-01', flags: 'dgiu', modo: 'suprime', alcance: '*', protege: ['n','fy'],
    source: R`${BL}(?:ley(?:[ ]+estatutaria|[ ]+org[áa]nica)?|decreto(?:[ ]*-?[ ]*ley|[ ]+legislativo|[ ]+reglamentario|[ ]+[úu]nico[ ]+reglamentario)?|dec\.|acuerdo|circular(?:[ ]+(?:externa|interna|conjunta|[úu]nica))?|ordenanza|directiva|instrucci[óo]n|acto[ ]+legislativo)[ ]+(?:(?:n[úu]mero|no\.?|n\.?[ ]?º|nro\.?)[ ]*)?(?:[A-Z]{1,8}\d{0,2}[ ]?-[ ]?)?(?<n>\d{1,3}(?:\.\d{3})?|\d{1,6})${NR}(?:[ ]+(?:de|del)[ ]+(?<fy>(?:\d{1,2}[ ]+de[ ]+\p{L}+[ ]+de[ ]+)?(?:19|20)\d{2}))?`,
  },
  {
    id: 'E-NORMA-02', flags: 'dgiu', modo: 'suprime', modoGrupo: {'fy':'baja'}, alcance: '*', protege: ['n','fy'],
    source: R`${BL}(?:resoluci[óo]n|res\.|concepto|oficio)[ ]+(?:(?:n[úu]mero|no\.?|n\.?[ ]?º|nro\.?)[ ]*)?(?:[A-Z]{1,8}\d{0,2}[ ]?-[ ]?)?(?<n>\d{1,3}(?:\.\d{3})?|\d{1,6})${NR}(?:[ ]+(?:de|del)[ ]+(?<fy>(?:\d{1,2}[ ]+de[ ]+\p{L}+[ ]+de[ ]+)?(?:19|20)\d{2}))?`,
  },
  {
    id: 'E-ART-01', flags: 'dgiu', modo: 'suprime', alcance: '*', protege: ['n'],
    source: R`${BL}(?:art[íi]culos?|arts?\.|numeral(?:es)?|literal(?:es)?|lit\.|par[áa]grafos?|par\.|incisos?|inc\.|ordinal(?:es)?|cap[íi]tulos?|cap\.|t[íi]tulos?|t[íi]t\.|secci[óo]n(?:es)?|libros?|apartados?)[ ]*(?:(?:no\.?|n\.?[ ]?º)[ ]*)?(?<n>\d{1,4}(?:\.\d{1,4}){0,6}[A-Za-z]?(?:[ ]*(?:,|y|al|a|-|o)[ ]*\d{1,4}(?:\.\d{1,4}){0,6}[A-Za-z]?)*)${NR}`,
  },
  {
    id: 'E-SENT-01', flags: 'dgu', modo: 'suprime', alcance: '*', protege: ['n','y'],
    source: R`${BL}(?:(?:[Ss]entencia|SENTENCIA)[ ]+)?(?<n>(?:T|C|SU|A)[ ]?-[ ]?\d{1,4}[A-Z]?)(?![\p{L}\p{N}_]|[.,]\p{N})(?:[ ]*(?:de|del|\/)[ ]*(?<y>(?:19|20)?\d{2}(?!\d)))?`,
  },
  {
    id: 'E-EXPCC-01', flags: 'dgu', modo: 'suprime', alcance: ID_PERSONAL, protege: ['n'],
    source: R`${BL}(?:(?:${L_EXP})[ ]*)?(?:T|D|OG|ICC|LAT|CJU|RE|RDL|PE|AC)[ ]?-[ ]?(?<n>\d{1,3}(?:\.\d{3}){1,2}|\d{5,8})${NR}`,
  },
  {
    id: 'E-PROV-01', flags: 'dgu', modo: 'suprime', alcance: '*', protege: ['n'],
    source: R`${BL}(?<n>(?:SC|SL|SP|STC|STL|STP|AC|AL|AP|ATC|ATL|ATP|AHP|SU)\d{1,5}-(?:19|20)\d{2})${NR}`,
  },
  {
    id: 'E-FOLIO-01', flags: 'dgiu', modo: 'suprime', alcance: '*', protege: ['n','m'],
    source: R`${BL}(?:folios?|fls?\.|fol\.|cuadernos?|cdno\.|cuad\.|hojas?|p[áa]ginas?|p[áa]gs?\.|(?<!(?<![\p{L}])\p{L}\.[ ]?)p\.|pp\.|anexos?|tomos?|consecutivos?[ ]+de[ ]+folios?)[ ]*(?:(?:no\.?|n\.?[ ]?º|nro\.?)[ ]*)?(?<n>\d{1,5}(?:[ ]*(?:-|a|al|y|,|o)[ ]*\d{1,5})*)${NR}(?:[ ]+de[ ]+(?<m>\d{1,5})${NR})?`,
  },
  {
    id: 'E-PUB-01', flags: 'dgiu', modo: 'suprime', alcance: '*', protege: ['n','y'],
    source: R`${BL}(?:diario[ ]+oficial|d\.[ ]?o\.|gaceta(?:[ ]+(?:del[ ]+congreso|judicial|constitucional|oficial|distrital|departamental))?|registro[ ]+distrital|bolet[íi]n(?:[ ]+oficial)?)[ ]*(?:(?:no\.?|n\.?[ ]?º|nro\.?|n[úu]mero)[ ]*)?(?<n>\d{1,3}(?:\.\d{3})+|\d{1,6})${NR}(?:[ ]+(?:de|del)[ ]+(?<y>(?:19|20)\d{2}))?`,
  },
  {
    id: 'E-CANT-01', flags: 'dgiu', modo: modoCant, alcance: '*', protege: ['n'],
    source: R`${NL}(?<n>\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?)[ ]*(?<u>uvt|smmlv|smlmv|s\.?m\.?m\.?l\.?v\.?|s\.?m\.?l\.?m\.?v\.?|salarios?[ ]+m[íi]nimos?(?:[ ]+legales)?(?:[ ]+mensuales)?(?:[ ]+vigentes)?|%|por[ ]+ciento|puntos[ ]+porcentuales)(?![\p{L}\p{N}])`,
  },
  {
    id: 'E-UNIDAD-01', flags: 'dgiu', modo: 'suprime', alcance: ID_TIPOS, protege: ['n'],
    source: R`${NL}(?<n>\d{1,3}(?:[.' ]\d{3})+|\d+)[ ]*(?:de[ ]+)?(?:habitantes|personas|hect[áa]reas|metros(?:[ ]+cuadrados)?|m2|m²|km|kil[óo]metros|kg|kilos|toneladas|unidades|votos|afiliados|usuarios|empleados|trabajadores|d[íi]as|meses|años|horas|minutos|kwh|litros|galones)(?![\p{L}\p{N}])`,
  },
  {
    id: 'E-DINERO-01', flags: 'dgiu', modo: 'suprime', alcance: ID_TIPOS, protege: ['n'],
    source: R`(?:(?:\$|cop|col\$|us\$|usd|eur|€)[ ]*(?<n>\d{1,3}(?:[.,' ]\d{3})*(?:[.,]\d{1,2})?|\d+)${NR}|${NL}(?<n2>\d{1,3}(?:[.,' ]\d{3})*(?:[.,]\d{1,2})?|\d+)[ ]*(?:pesos|de[ ]+pesos|m\/?[ ]?cte\.?|cop|millones|mil(?:[ ]+pesos)?|d[óo]lares|euros)(?![\p{L}\p{N}]))`,
  },
  {
    id: 'E-DANE-01', flags: 'dgiu', modo: 'suprime', alcance: '*', protege: ['n'],
    source: R`${BL}(?:c[óo]digo[ ]+(?:dane|divipola)|c[óo]d\.[ ]*dane|divipola|dane)[ ]*(?:(?:no\.?|n\.?[ ]?º)[ ]*)?:?[ ]*(?<n>\d{4,8})${NR}`,
  },
  {
    id: 'E-POSTAL-01', flags: 'dgiu', modo: 'suprime', alcance: '*', protege: ['n'],
    source: R`${BL}(?:c[óo]digo[ ]+postal|c[óo]d\.[ ]*postal|c\.[ ]?p\.|zip(?:[ ]+code)?)[ ]*(?:no\.?[ ]*)?:?[ ]*(?<n>\d{6})${NR}`,
  },
  {
    id: 'E-CIIU-01', flags: 'dgiu', modo: 'suprime', alcance: '*', protege: ['n'],
    source: R`${BL}(?:ciiu|c[óo]digo[ ]+(?:de[ ]+)?actividad(?:[ ]+econ[óo]mica)?|actividad[ ]+econ[óo]mica)[ ]*(?:no\.?[ ]*)?:?[ ]*(?<n>\d{4})${NR}`,
  },
  {
    id: 'E-CIE10-01', flags: 'dgiu', modo: 'suprime', alcance: ID_TIPOS, protege: ['n'],
    source: R`${BL}(?:cie[ ]?-?[ ]?10|diagn[óo]stico|dx|c[óo]digo)[ ]*:?[ ]*(?<n>[A-Z]\d{2}(?:\.\d{1,2})?)${BR}`,
  },
  {
    id: 'E-DESP-01', flags: 'dgiu', modo: 'suprime', alcance: '*', protege: ['n'],
    source: R`${BL}(?:c[óo]digo[ ]+(?:del[ ]+)?despacho|despacho[ ]+(?:judicial[ ]+)?(?:c[óo]digo|no\.?))[ ]*:?[ ]*(?<n>\d{2}[ \-]?\d{3}[ \-]?\d{2}[ \-]?\d{2}[ \-]?\d{3})${NR}`,
  },
  {
    id: 'E-DESP-02', flags: 'dgu', modo: modoDesp02, alcance: '*', protege: ['n'],
    source: R`${NL}(?<n>\d{12})${NR}`,
  },
  {
    id: 'E-SIGLA-01', flags: 'dgu', modo: 'suprime', alcance: new Set<DetectableType>(['PLACA']), protege: ['n'],
    source: R`${BL}(?<n>(?:${SIGLAS.join('|')})(?:[ \-·]?\d{3}|\d{2}[A-Z]))${NR}`,
  },
];

// ---------------------------------------------------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------------------------------------------------
/** Un tramo canónico protegido por una exclusión. */
export interface TramoProtegido {
  exclusionId: string;
  grupo: string;
  modo: ModoExclusion;
  /** Posiciones del texto canónico de la parte. */
  start: number;
  end: number;
  alcance: Alcance;
}

export interface OpcionesExclusion {
  /** Tope por exclusión en milisegundos; por defecto `RULE_TIME_LIMIT_MS`. */
  maxMsPorExclusion?: number;
  now?: () => number;
  /** Se llama con el id de la exclusión cuando se corta por tiempo. Nunca recibe texto del documento. */
  onTimeout?: (id: string) => void;
}

const compiladas = new WeakMap<Exclusion, RegExp>();
function regexDe(e: Exclusion): RegExp {
  let re = compiladas.get(e);
  if (re === undefined) {
    re = new RegExp(e.source, e.flags);
    compiladas.set(e, re);
  }
  return re;
}

/** Tramos protegidos de una parte, en posiciones canónicas, exclusión por exclusión y por posición. */
export function tramosProtegidos(view: SearchView, options: OpcionesExclusion = {}): TramoProtegido[] {
  const out: TramoProtegido[] = [];
  const now = options.now ?? Date.now;
  const limite = options.maxMsPorExclusion ?? RULE_TIME_LIMIT_MS;
  const texto = view.text;
  for (const e of EXCLUSIONES) {
    const re = regexDe(e);
    re.lastIndex = 0;
    const inicio = now();
    for (;;) {
      const m = re.exec(texto);
      if (m === null) break;
      if (m[0].length === 0) re.lastIndex += 1;
      const modo = typeof e.modo === 'function' ? e.modo(m, texto) : e.modo;
      if (modo !== null) {
        for (const grupo of [...e.protege, 'n2']) {
          const ix = m.indices?.groups?.[grupo];
          if (ix === undefined || ix[1] <= ix[0]) continue;
          const c = toCanonicalSpan(view, ix[0], ix[1]);
          if (c.end <= c.start) continue;
          out.push({ exclusionId: e.id, grupo, modo: e.modoGrupo?.[grupo] ?? modo, start: c.start, end: c.end, alcance: e.alcance });
        }
      }
      if (now() - inicio > limite) {
        options.onTimeout?.(e.id);
        break;
      }
    }
    re.lastIndex = 0;
  }
  return out;
}

const NOMINAL: Readonly<Record<Confidence, number>> = { alta: 0.9, media: 0.6, baja: 0.3 };
/** Una muesca menos: alta → media → baja → baja (7.3.5). */
const muesca = (c: Confidence): Confidence => (c === 'alta' ? 'media' : 'baja');

/**
 * Aplica las exclusiones a los candidatos de una parte. Solo toca los de `source: 'regla'`; los demás pasan intactos.
 * Un candidato se afecta si su tramo queda contenido por completo en un tramo protegido de su alcance: si alguno suprime,
 * no se emite; si no, y alguno baja, pierde una muesca de confianza (y su puntaje nominal). Conserva el orden de entrada.
 */
export function aplicarExclusiones(view: SearchView, candidatos: readonly DetectionCandidate[], options: OpcionesExclusion = {}): DetectionCandidate[] {
  const tramos = tramosProtegidos(view, options);
  const out: DetectionCandidate[] = [];
  for (const c of candidatos) {
    if (c.source !== 'regla') { out.push(c); continue; }
    const golpes = tramos.filter((t) => t.start <= c.start && c.end <= t.end && (t.alcance === '*' || t.alcance.has(c.type as DetectableType)));
    if (golpes.some((t) => t.modo === 'suprime')) continue;
    if (golpes.length > 0) {
      const confidence = muesca(c.confidence);
      out.push({ ...c, confidence, score: NOMINAL[confidence] });
    } else out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// E-CITA-01 · Contexto de cita jurisprudencial (7.3.3)
// ---------------------------------------------------------------------------------------------------------------------
const CITA_SENAL = /(?<![\p{L}])(?:sentencia|providencia|fallo|auto[ ]+(?:interlocutorio[ ]+)?(?:de|del)|consejer[oa][ ]+ponente|magistrad[oa][ ]+ponente|c\.[ ]?p\.|m\.[ ]?p\.|corte[ ]+suprema|consejo[ ]+de[ ]+estado|corte[ ]+constitucional|sala[ ]+de[ ]+casaci[óo]n|secci[óo]n[ ]+(?:primera|segunda|tercera|cuarta|quinta)|subsecci[óo]n|precedente|jurisprudencia|cfr\.|v[ée]ase|citad[oa])(?![\p{L}])/iu;
const CITA_PROPIO = /(?<![\p{L}])(?:de[ ]+la[ ]+referencia|del[ ]+asunto|(?:el|la)[ ]+presente[ ]+(?:proceso|acci[óo]n|tr[áa]mite|demanda|tutela)|este[ ]+(?:proceso|despacho|expediente)|nuestro[ ]+(?:proceso|caso))(?![\p{L}])/iu;

// R-CIT-01 (7.7.6) complementa E-CITA-01 con un léxico más amplio de cita (`CITE_LEX`) y con los rótulos del propio caso (`OWN_CASE`).
const HZ = '[ \\t]';
const OWN_CASE = new RegExp(`(?:(?:^|\\n)${HZ}*(?:Ref(?:erencia)?\\.?|Radicado|Radicaci[oó]n|Rad\\.|Proceso|Expediente|Exp\\.|Asunto|Acci[oó]n${HZ}+de${HZ}+tutela)(?:${HZ}+(?:No\\.?|N[º°]\\.?|n\\.º|n[uú]mero))?${HZ}*:?${HZ}*$)|(?:(?:este|presente|nuestro|el${HZ}+presente)${HZ}+(?:proceso|expediente|asunto|tr[aá]mite)[^.\\n]{0,40}$)`, 'iu');
const CITE_LEX = new RegExp(`sentencia|providencia|Corte(?!\\p{L})|Consejo${HZ}+de${HZ}+Estado|Tribunal|Sala${HZ}+de|Secci[oó]n|M\\.${HZ}*P\\.|C\\.${HZ}*P\\.|[Mm]agistrad[oa]${HZ}+[Pp]onente|[Cc]onsejer[oa]${HZ}+[Pp]onente|precedente|jurisprudencia|reiterad|citad|cfr\\.|v[eé]ase|(?:SU|T|C)-\\d{3,4}|S[CLPT][CLP]?\\d{3,5}-\\d{4}`, 'iu');

/**
 * E-CITA-01 + R-CIT-01 (criterio único, PG-4-r1): ¿el radicado en [start, end) de la vista `reglas` es una cita jurisprudencial
 * y no el radicado del caso?
 * - Es del propio caso (→ `false`) si la ventana de 7.3.3 (250 caracteres antes y 120 después, sin salir de la línea) trae una
 *   señal del propio caso (`CITA_PROPIO`: «de la referencia», «del asunto», «el presente proceso»…) o si justo antes hay un rótulo
 *   del propio caso o «este/presente/nuestro proceso» (`OWN_CASE`, R-CIT-01: 150 caracteres antes).
 * - Es cita (→ `true`) si la ventana de 7.3.3 trae una señal de cita (`CITA_SENAL`) o si `CITE_LEX` aparece 150 caracteres
 *   antes o 60 después (R-CIT-01).
 * No suprime nada: el consumidor marca `context: 'cita'` y `generalize.ts` crea la bandera `CITA_JURISPRUDENCIAL` (6.4.6).
 * Aplica a `RADICADO` y `RADICADO_ADMIN`. (La regla de «misma clave sin cita en otra mención» la resuelve quien tiene
 * todas las detecciones de la parte.)
 */
export function esContextoDeCita(texto: string, start: number, end: number): boolean {
  const ls = texto.lastIndexOf('\n', start - 1) + 1;
  const k = texto.indexOf('\n', end);
  const le = k < 0 ? texto.length : k;
  const ventana = texto.slice(Math.max(ls, start - 250), start) + ' ' + texto.slice(end, Math.min(le, end + 120));
  if (CITA_PROPIO.test(ventana)) return false;
  const antes = texto.slice(Math.max(0, start - 150), start);
  if (OWN_CASE.test(antes)) return false;
  return CITA_SENAL.test(ventana) || CITE_LEX.test(antes) || CITE_LEX.test(texto.slice(end, end + 60));
}
