// Exclusiones y calibración de confianza (PA-7; plan 7.3): E-NORMA-01 y 02, E-ART-01, E-SENT-01, E-EXPCC-01, E-PROV-01,
// E-FOLIO-01, E-PUB-01, E-CANT-01, E-UNIDAD-01, E-DINERO-01, E-DANE-01, E-POSTAL-01, E-CIIU-01, E-CIE10-01, E-DESP-01,
// E-DESP-02 y E-SIGLA-01. El contexto de cita jurisprudencial (E-CITA-01, 7.3.3) lo decide `esContextoDeCita`, que también usa `generalize.ts` (`isCitation`, G-13 / R-CIT-01, 7.7.6: una sola fuente de verdad).
//
// TypeScript puro: sin DOM, sin red, sin registro. Una exclusión NO es una regla de detección: no crea candidatos ni cambia
// tipos (7.3.1). Se ejecuta DESPUÉS de las reglas, sobre la misma vista `reglas`, y protege tramos con nombre (`n`, `n2`, `fy`,
// `y`, `m`): un candidato de regla cuyo tramo queda contenido por completo en un tramo protegido de su alcance se suprime
// (`suprime`) o baja una muesca (`baja`). Un solape parcial no afecta. `aplicarExclusiones` nunca se aplica a la lista del caso, al
// modelo ni a lo manual; los tramos PER y ORG del modelo consultan aparte los contextos enteros (`contextosDelModelo`, PB-2-r6, D-06).
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

// E-NORMA-01, E-CIE10-01, E-DESP-01 y OWN_CASE no ponen dos cuantificadores de blancos separados por un opcional (PB-2-r5):
// `B*(?:S B*)?` es el lenguaje de `B* S? B*` sin su retroceso cuadrático.
export const EXCLUSIONES: readonly Exclusion[] = [
  {
    id: 'E-NORMA-01', flags: 'dgiu', modo: 'suprime', alcance: '*', protege: ['n','fy'],
    source: R`${BL}(?:ley(?:[ ]+estatutaria|[ ]+org[áa]nica)?|decreto(?:[ ]*(?:-[ ]*)?ley|[ ]+legislativo|[ ]+reglamentario|[ ]+[úu]nico[ ]+reglamentario)?|dec\.|acuerdo|circular(?:[ ]+(?:externa|interna|conjunta|[úu]nica))?|ordenanza|directiva|instrucci[óo]n|acto[ ]+legislativo)[ ]+(?:(?:n[úu]mero|no\.?|n\.?[ ]?º|nro\.?)[ ]*)?(?:[A-Z]{1,8}\d{0,2}[ ]?-[ ]?)?(?<n>\d{1,3}(?:\.\d{3})?|\d{1,6})${NR}(?:[ ]+(?:de|del)[ ]+(?<fy>(?:\d{1,2}[ ]+de[ ]+\p{L}+[ ]+de[ ]+)?(?:19|20)\d{2}))?`,
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
    source: R`${BL}(?:cie[ ]?-?[ ]?10|diagn[óo]stico|dx|c[óo]digo)[ ]*(?::[ ]*)?(?<n>[A-Z]\d{2}(?:\.\d{1,2})?)${BR}`,
  },
  {
    id: 'E-DESP-01', flags: 'dgiu', modo: 'suprime', alcance: '*', protege: ['n'],
    source: R`${BL}(?:c[óo]digo[ ]+(?:del[ ]+)?despacho|despacho[ ]+(?:judicial[ ]+)?(?:c[óo]digo|no\.?))[ ]*(?::[ ]*)?(?<n>\d{2}[ \-]?\d{3}[ \-]?\d{2}[ \-]?\d{2}[ \-]?\d{3})${NR}`,
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
// PB-2-r6 · Los contextos de exclusión aplicados a los tramos del modelo (D-06, tarjeta PB-2-r6, punto 2)
// ---------------------------------------------------------------------------------------------------------------------
/**
 * Un contexto de exclusión en posiciones canónicas, para los tramos PER y ORG del modelo. A diferencia de los tramos protegidos
 * (`tramosProtegidos`, que son los grupos con nombre y valen para los candidatos de regla), aquí cuenta el tramo entero de la
 * coincidencia: «Ley 1122 de 2007», «Sentencia T-074 de 2020», «CIIU 8610». `inicio`: el tramo del modelo debe empezar justo en
 * `start` (el objeto de una cita de artículo, más abajo).
 */
export interface ContextoDelModelo {
  exclusionId: string; modo: ModoExclusion; start: number; end: number; inicio?: true;
  /** B-71 (PB-2-r8): con `inicio`, el fin del nombre de la norma sin los complementos ambiguos del final. */
  finSeguro?: number;
}

/**
 * Objeto de una cita de artículo (E-ART-01): «artículo 49 de la Constitución Política», «artículo 1546 del Código Civil». Tras la
 * coincidencia de E-ART-01 y el conector, el nombre de la norma empieza por una cabeza de esta lista cerrada. Solo para el modelo:
 * el tramo debe empezar ahí.
 */
const RE_OBJETO_ART = /^[ ]*,?[ ]+(?:de[ ]+la|del|de)[ ]+(?=(?:constituci[óo]n|c[óo]digo|estatuto|convenci[óo]n|pacto|carta[ ]+pol[íi]tica)(?![\p{L}\p{N}]))/iu;
const OBJETO_MAX = 24;
/**
 * M-40 (PB-2-r7) · El objeto acaba donde acaba el nombre de la norma: la cabeza más su complemento normativo, palabras de esta lista
 * cerrada (en minúscula y sin tildes) unidas por conectores, y un año. Corta en la primera palabra de fuera («Código de Ética de
 * Clínica Ejemplo S.A.S.» → «Código de Ética»), en un signo o en el tope de palabras. Ninguna es un nombre propio de persona ni de
 * organización: «comercial», «social» de una razón social o un apellido no están, así que el nombre que sigue queda fuera.
 */
const COMPLEMENTO_NORMA: ReadonlySet<string> = new Set([
  'politica', 'colombia', 'colombiano', 'colombiana', 'republica', 'civil', 'civiles', 'penal', 'penales', 'general', 'proceso',
  'procedimiento', 'procesal', 'comercio', 'sustantivo', 'trabajo', 'laboral', 'tributario', 'aduanero', 'minas', 'minero', 'electoral',
  'disciplinario', 'unico', 'sanitario', 'nacional', 'policia', 'convivencia', 'ciudadana', 'infancia', 'adolescencia', 'familia',
  'recursos', 'naturales', 'renovables', 'proteccion', 'medio', 'ambiente', 'administrativo', 'contencioso', 'administrativa', 'etica',
  'medica', 'odontologica', 'deontologico', 'abogado', 'abogados', 'americana', 'derechos', 'humanos', 'internacional', 'economicos',
  'sociales', 'culturales', 'politicos', 'nino', 'ninos', 'transito', 'terrestre', 'organico', 'organica', 'sistema', 'financiero',
  'presupuesto', 'contratacion', 'administracion', 'publica', 'anticorrupcion', 'consumidor', 'notariado', 'registro', 'seguridad',
  'social', 'colectiva', 'arbitral', 'territorial', 'regimen', 'municipal', 'departamental', 'distrital', 'vigente',
]);
const CONECTOR_NORMA: ReadonlySet<string> = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'lo', 'y', 'e', 'sobre', 'al', 'a', 'para']);
const CABEZA_NORMA: ReadonlySet<string> = new Set(['constitucion', 'codigo', 'estatuto', 'convencion', 'pacto', 'carta']);
/**
 * B-71 (PB-2-r8) · Complementos de la lista que también forman parte de nombres de personas u organizaciones («Protección S.A.»,
 * «Colombiana de …», «Tránsito Ejemplo», «Nacional de …», «Seguridad Ejemplo Ltda.», «Familia …»). Son de la norma solo dentro de un
 * nombre de `NOMBRES_CON_AMBIGUO` («Código Nacional de Tránsito Terrestre», «Código General del Proceso»; B-81, PB-2-r9); si no, y el
 * tramo del modelo sigue más allá, van con el resto (`finSeguro`), que pasa por 7.11.2: así no quedan a la vista.
 */
const COMPLEMENTO_AMBIGUO: ReadonlySet<string> = new Set([
  'proteccion', 'colombiana', 'colombiano', 'nacional', 'transito', 'seguridad', 'familia', 'internacional', 'americana', 'general',
]);
/**
 * B-81 (PB-2-r9) · Los nombres de norma que llevan un complemento ambiguo, de una lista cerrada (en minúscula y sin tildes, con sus
 * conectores). Solo dentro de uno de ellos el ambiguo es de la norma con seguridad. En -r8 bastaba con que lo siguiera otro
 * complemento, pero «social» también es un nombre: «Código de Ética de Protección Social Ejemplo S.A.S.» y «Estatuto de Seguridad
 * Social Ejemplo Ltda.» dejaban «Protección Social» y «Seguridad Social» dentro de la norma y a la vista. Un ambiguo fuera de esta
 * lista hace dudoso todo lo que sigue: si el tramo del modelo va más allá, el resto empieza en él (ante la duda, con el nombre).
 */
const NOMBRES_CON_AMBIGUO: ReadonlyArray<readonly string[]> = [
  ['general', 'del', 'proceso'], ['general', 'disciplinario'], ['general', 'de', 'contratacion'],
  ['nacional', 'de', 'transito'], ['nacional', 'de', 'policia'], ['nacional', 'de', 'seguridad', 'y', 'convivencia'],
  ['nacional', 'de', 'recursos', 'naturales'],
  ['internacional', 'de', 'derechos'], ['internacional', 'sobre', 'los', 'derechos'],
  ['americana', 'sobre', 'derechos'], ['americana', 'de', 'derechos'],
];
const OBJETO_VENTANA = 160;
const OBJETO_MAX_PALABRAS = 10;
const RE_PALABRA_NORMA = /\p{L}+|\p{N}+|[^\p{L}\p{N}\s]/gu;
const plegar = (w: string): string => w.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Cuántas palabras de `ws` desde `i` forman un nombre de `NOMBRES_CON_AMBIGUO` (0 si ninguno). */
function nombreConAmbiguo(ws: ReadonlyArray<{ w: string }>, i: number): number {
  for (const n of NOMBRES_CON_AMBIGUO) if (n.every((x, k) => ws[i + k]?.w === x)) return n.length;
  return 0;
}

/**
 * Fin (relativo a `t`) del nombre de la norma que empieza en `t[0]` con una cabeza de la lista: cabeza + complemento + año. `seguro`
 * es el fin sin los complementos ambiguos (B-71): el de la cabeza, de un complemento que no es ambiguo o de un año, hasta el primer
 * ambiguo que no está dentro de un nombre de `NOMBRES_CON_AMBIGUO` (B-81). `fin` no cambia: la norma sola se sigue descartando entera.
 * B-90 (PB-2-r10): si el nombre conocido acaba en un ambiguo («Nacional de Tránsito») y lo sigue enseguida una palabra que no es de la
 * norma («… Tránsito Ejemplo Gómez»), ese ambiguo puede ser el nombre de pila: el fin seguro queda antes de él y el ambiguo va con el
 * resto (ante la duda, con el nombre). Si lo sigue un complemento («Terrestre»), un conector, un signo o nada, sigue siendo de la norma.
 */
function finDelNombreDeNorma(t: string): { fin: number; seguro: number } {
  const ws: Array<{ w: string; fin: number }> = [];
  for (const m of t.matchAll(RE_PALABRA_NORMA)) {
    ws.push({ w: plegar(m[0]), fin: m.index + m[0].length });
    if (ws.length >= OBJETO_MAX_PALABRAS) break;
  }
  const cabeza = ws[0];
  if (cabeza === undefined || !CABEZA_NORMA.has(cabeza.w)) return { fin: 0, seguro: 0 };
  let fin = cabeza.fin;
  let seguro = cabeza.fin;
  let previa = cabeza.w;
  let nombre = 0;        // fin (en palabras, exclusivo) del nombre conocido en curso
  let dudoso = false;    // B-81: hubo un ambiguo fuera de un nombre conocido
  let ambiguoFinal = -1; // B-90: índice del ambiguo con que acaba un nombre conocido, si es la última palabra de la norma
  for (let i = 1; i < ws.length; i++) {
    const { w, fin: finW } = ws[i] as { w: string; fin: number };
    const ambiguo = COMPLEMENTO_AMBIGUO.has(w);
    if (COMPLEMENTO_NORMA.has(w) || ambiguo || (/^(?:19|20)\d{2}$/u.test(w) && previa === 'de')) {
      fin = finW;
      if (ambiguo && i >= nombre) {
        const n = nombreConAmbiguo(ws, i);
        if (n > 0) nombre = i + n;
        else dudoso = true;
      }
      ambiguoFinal = ambiguo && i === nombre - 1 ? i : -1;
      if (!dudoso && (!ambiguo || i < nombre)) seguro = finW;
    } else if (!CONECTOR_NORMA.has(w)) {
      // B-90: la palabra de fuera va justo detrás del ambiguo final, y es una palabra (no un signo).
      if (ambiguoFinal === i - 1 && /^\p{L}/u.test(w) && !dudoso) seguro = Math.min(seguro, (ws[i - 2] as { fin: number }).fin);
      break;
    } else ambiguoFinal = -1;
    previa = w;
  }
  return { fin, seguro };
}

/**
 * Contextos de exclusión de una parte para los tramos del modelo (7.3.1 «Otros usuarios»: la fusión con el modelo consulta las
 * exclusiones). Son las coincidencias enteras de las exclusiones de alcance «todos» (las de alcance acotado son de tipos de
 * identificación, que el modelo no produce), con su modo, más el objeto de las citas de artículo. Mismo motor y mismos topes de
 * tiempo que `tramosProtegidos`.
 */
export function contextosDelModelo(view: SearchView, options: OpcionesExclusion = {}): ContextoDelModelo[] {
  const out: ContextoDelModelo[] = [];
  const now = options.now ?? Date.now;
  const limite = options.maxMsPorExclusion ?? RULE_TIME_LIMIT_MS;
  const texto = view.text;
  for (const e of EXCLUSIONES) {
    if (e.alcance !== '*') continue;
    const re = regexDe(e);
    re.lastIndex = 0;
    const inicio = now();
    for (;;) {
      const m = re.exec(texto);
      if (m === null) break;
      if (m[0].length === 0) { re.lastIndex += 1; continue; }
      const modo = typeof e.modo === 'function' ? e.modo(m, texto) : e.modo;
      const fin = m.index + m[0].length;
      if (modo !== null) {
        const c = toCanonicalSpan(view, m.index, fin);
        if (c.end > c.start) out.push({ exclusionId: e.id, modo, start: c.start, end: c.end });
        if (e.id === 'E-ART-01') {
          const o = RE_OBJETO_ART.exec(texto.slice(fin, fin + OBJETO_MAX));
          if (o !== null) {
            // M-40 y B-62 (PB-2-r7): el objeto es el nombre de la norma, en una ventana fija; ya no va hasta el final del renglón.
            const ini = fin + o[0].length;
            const largo = finDelNombreDeNorma(texto.slice(ini, ini + OBJETO_VENTANA));
            const d = toCanonicalSpan(view, ini, ini + largo.fin);
            const finSeguro = toCanonicalSpan(view, ini, ini + largo.seguro).end;
            if (largo.fin > 0 && d.end > d.start) out.push({ exclusionId: e.id, modo, start: d.start, end: d.end, inicio: true, finSeguro });
          }
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

/** El modo del contexto que contiene el tramo [start, end) del modelo, o null: `suprime` gana a `baja`. */
export function exclusionDelModelo(contextos: readonly ContextoDelModelo[], start: number, end: number): ModoExclusion | null {
  let modo: ModoExclusion | null = null;
  for (const c of contextos) {
    if (c.start > start || end > c.end || (c.inicio === true && c.start !== start)) continue;
    if (c.modo === 'suprime') return 'suprime';
    modo = 'baja';
  }
  return modo;
}

/**
 * M-40 (PB-2-r7) · Si el tramo [start, end) del modelo empieza en el nombre de una norma citada (el objeto de una cita de artículo)
 * y sigue más allá, devuelve el fin de ese nombre: lo que sigue («… de Clínica Ejemplo S.A.S.») no se descarta con la norma, sino
 * que pasa por 7.11.2. Si no, null. B-71 (PB-2-r8): ese fin no incluye los complementos ambiguos del final (`finSeguro`), que
 * pueden ser parte del nombre («Código Civil Tránsito Ejemplo Gómez» → «Tránsito Ejemplo Gómez»).
 */
export function finDeNormaAlInicio(contextos: readonly ContextoDelModelo[], start: number, end: number): number | null {
  let fin: number | null = null;
  for (const c of contextos) {
    if (c.inicio !== true || c.start !== start || c.end >= end) continue;
    const f = c.finSeguro ?? c.end;
    if (fin === null || f > fin) fin = f;
  }
  return fin;
}

// ---------------------------------------------------------------------------------------------------------------------
// E-CITA-01 · Contexto de cita jurisprudencial (7.3.3)
// ---------------------------------------------------------------------------------------------------------------------
const SENAL_CORE = String.raw`(?:sentencia|providencia|fallo|auto[ ]+(?:interlocutorio[ ]+)?(?:de|del)|consejer[oa][ ]+ponente|magistrad[oa][ ]+ponente|c\.[ ]?p\.|m\.[ ]?p\.|corte[ ]+suprema|consejo[ ]+de[ ]+estado|corte[ ]+constitucional|sala[ ]+de[ ]+casaci[óo]n|secci[óo]n[ ]+(?:primera|segunda|tercera|cuarta|quinta)|subsecci[óo]n|precedente|jurisprudencia|cfr\.|v[ée]ase|citad[oa])`;
const PROPIO_CORE = String.raw`(?:de[ ]+la[ ]+referencia|del[ ]+asunto|(?:el|la)[ ]+presente[ ]+(?:proceso|acci[óo]n|tr[áa]mite|demanda|tutela)|este[ ]+(?:proceso|despacho|expediente)|nuestro[ ]+(?:proceso|caso))`;
/** Una alternancia entre fronteras de letra, con `iu`. */
const entreLetras = (core: string): RegExp => new RegExp(String.raw`(?<![\p{L}])${core}(?![\p{L}])`, 'iu');
const CITA_SENAL = entreLetras(SENAL_CORE);
const CITA_PROPIO = entreLetras(PROPIO_CORE);

// R-CIT-01 (7.7.6) complementa E-CITA-01 con un léxico más amplio de cita (`CITE_LEX`) y con los rótulos del propio caso (`OWN_CASE`).
const HZ = '[ \\t]';
const OWN_CASE = new RegExp(`(?:(?:^|\\n)${HZ}*(?:Ref(?:erencia)?\\.?|Radicado|Radicaci[oó]n|Rad\\.|Proceso|Expediente|Exp\\.|Asunto|Acci[oó]n${HZ}+de${HZ}+tutela)(?:${HZ}+(?:No\\.?|N[º°]\\.?|n\\.º|n[uú]mero))?${HZ}*(?::${HZ}*)?$)|(?:(?:este|presente|nuestro|el${HZ}+presente)${HZ}+(?:proceso|expediente|asunto|tr[aá]mite)[^.\\n]{0,40}$)`, 'iu');
const LEX = (corte: string): string => `sentencia|providencia|${corte}|Consejo${HZ}+de${HZ}+Estado|Tribunal|Sala${HZ}+de|Secci[oó]n|M\\.${HZ}*P\\.|C\\.${HZ}*P\\.|[Mm]agistrad[oa]${HZ}+[Pp]onente|[Cc]onsejer[oa]${HZ}+[Pp]onente|precedente|jurisprudencia|reiterad|citad|cfr\\.|v[eé]ase|(?:SU|T|C)-\\d{3,4}|S[CLPT][CLP]?\\d{3,5}-\\d{4}`;
const CITE_LEX = new RegExp(LEX('Corte(?!\\p{L})'), 'iu');

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
  const antes = texto.slice(Math.max(0, start - CITE_ANTES), start);
  return citaConLexico(texto, start, end, antes, CITE_LEX.test(antes) || CITE_LEX.test(texto.slice(end, end + CITE_TRAS)), undefined);
}
/** Ventanas de `CITE_LEX` y `OWN_CASE` (R-CIT-01): 150 caracteres antes y 60 después; la de 7.3.3, 250 antes y 120 después. */
const CITE_ANTES = 150;
const CITE_TRAS = 60;
const VENTANA_ANTES = 250;
const VENTANA_TRAS = 120;
/**
 * `esContextoDeCita` con `CITE_LEX` ya probado en sus dos ventanas (`lexico`). Mismo valor que «sin señal propia y con señal de
 * cita», con las pruebas de cita primero: casi siempre falta alguna (B-62). Con índice, una expresión solo se prueba si alguna de
 * sus coincidencias posibles empieza en su ventana.
 */
function citaConLexico(texto: string, start: number, end: number, antes: string, lexico: boolean, ix: IndiceDeCita | undefined): boolean {
  if (!lexico && (!posible(ix?.cita, start - VENTANA_ANTES, start, end, end + VENTANA_TRAS) || !CITA_SENAL.test(ventanaDeCita(texto, start, end)))) return false;
  if (posible(ix?.propio, start - VENTANA_ANTES, start, end, end + VENTANA_TRAS) && CITA_PROPIO.test(ventanaDeCita(texto, start, end))) return false;
  return !rotuloJustoAntes(antes, start, ix);
}
/**
 * `OWN_CASE` en los 150 caracteres antes del expediente. PB-2-r10: con índice, solo se prueba si en esa ventana empieza alguna de
 * las palabras sin las que no casa (`RAPIDA_OWN_CASE`); era la expresión más cara de cada consulta en un renglón largo con
 * providencias. Sin índice, siempre (lo mismo).
 */
const rotuloJustoAntes = (antes: string, start: number, ix: IndiceDeCita | undefined): boolean =>
  posible(ix?.rotulo, start - CITE_ANTES, start, 0, 0) && OWN_CASE.test(antes);

/**
 * B-62 (PB-2-r7) · Índice de una vista para R-RAD_ADMIN-03, que pregunta por el contexto en cada expediente: dónde empieza, en todo
 * el texto, cada coincidencia posible de las señales, con las mismas alternancias sin fronteras ni retrovisores. Es un filtro
 * previo exacto: si la expresión completa casa en una ventana, la alternancia sin fronteras casa en el texto entero en esa misma
 * posición; si ningún inicio cae en la ventana, la completa no casa y no se prueba. Se arma una vez por vista, en tiempo lineal.
 */
interface IndiceDeCita {
  /** `CITE_LEX` y `CITA_SENAL`. */
  cita: readonly number[];
  /** `CITA_PROPIO`. */
  propio: readonly number[];
  /** `OWN_CASE` (PB-2-r10): las palabras que toda coincidencia contiene («Ref», «Rad», «Proceso», «Exp», «Asunto», «Acción», «este»…). */
  rotulo: readonly number[];
  /** `PROVIDENCIA` (D-11, PB-2-r8). */
  providencia: readonly number[];
  /** `PROPIO_ORACION` (D-11, PB-2-r8). */
  propioOracion: readonly number[];
  /** B-72 (PB-2-r8): las posiciones de «.», «;», «!», «?» y «\n» (candidatos a fin de oración) y las de «\n». */
  fines: readonly number[];
  saltos: readonly number[];
  /**
   * Las celdas y los separadores de encabezado (`esCelda`; M-61 y M-70). PB-2-r10: en -r9 eran una alternativa de `PROPIO_ORACION`
   * con un retrovisor, que se probaba con la expresión entera en cada tabulador de la oración; ahora salen en la misma pasada que los
   * fines y los saltos, y cada consulta es una búsqueda binaria.
   */
  celdas: readonly number[];
}
/**
 * Posiciones de los candidatos a fin de oración, de los saltos de línea y de las celdas, en una pasada. El punto pegado a lo que sigue
 * («9.000.001», «S.A») nunca corta (`cortaEn`), así que no se guarda.
 */
function finesSaltosYCeldas(texto: string, view: SearchView): { fines: number[]; saltos: number[]; celdas: number[] } {
  const fines: number[] = [];
  const saltos: number[] = [];
  const celdas: number[] = [];
  const { startMap, endMap } = view;
  for (let p = 0; p < texto.length; p++) {
    const c = texto.charCodeAt(p);
    // Un blanco solo puede ser celda si es ancho: se descarta aquí, sin llamar a `esCelda` en cada espacio del texto.
    if (c === 32 ? ((endMap[p] ?? 0) - (startMap[p] ?? 0) >= 2 || texto.charCodeAt(p + 1) === 32) && esCelda(texto, p, view)
      : (c === 9 || c === 124 || esSeparadorEntreBlancos(c)) && esCelda(texto, p, view)) celdas.push(p);
    if (!esCandidatoDeFin(c)) continue;
    if (c === 46 && p + 1 < texto.length) {
      const sig = texto.charAt(p + 1);
      if (!esBlanco(sig) && sig !== '\n' && !CIERRE.test(sig)) continue;
    }
    fines.push(p);
    if (c === 10) saltos.push(p);
  }
  return { fines, saltos, celdas };
}
const RAPIDA_CITA = new RegExp(`${LEX('Corte')}|${SENAL_CORE}`, 'giu');
const RAPIDA_PROPIO = new RegExp(PROPIO_CORE, 'giu');
/** Toda coincidencia de `OWN_CASE` lleva un rótulo («Ref», «Rad», «Proceso», «Exp», «Asunto», «Acción») o «este», «presente» o «nuestro». */
const RAPIDA_OWN_CASE = /ref|rad|proceso|exp|asunto|acci[oó]n|este|presente|nuestro/giu;
const indices = new WeakMap<SearchView, IndiceDeCita>();

/** Inicios de todas las coincidencias, también las que se solapan (se reanuda en el carácter siguiente al inicio). */
function inicios(re: RegExp, texto: string): number[] {
  const out: number[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(texto); m !== null; m = re.exec(texto)) {
    out.push(m.index);
    re.lastIndex = m.index + 1;
  }
  re.lastIndex = 0;
  return out;
}
/**
 * El índice de la vista. PB-2-r10: cada lista se arma la primera vez que se consulta, una sola vez por vista: un expediente que no
 * va con una providencia ni en contexto de cita solo necesita esas dos, y la celda que ya decide no necesita `PROPIO_ORACION`. Lo
 * mismo que armarlas todas al principio, en el mismo tiempo lineal o menos.
 */
function indiceDeCita(view: SearchView): IndiceDeCita {
  let ix = indices.get(view);
  if (ix === undefined) {
    const t = view.text;
    let cita: number[] | undefined;
    let propio: number[] | undefined;
    let rotulo: number[] | undefined;
    let providencia: number[] | undefined;
    let propioOracion: number[] | undefined;
    let fsc: ReturnType<typeof finesSaltosYCeldas> | undefined;
    const pasada = (): ReturnType<typeof finesSaltosYCeldas> => (fsc ??= finesSaltosYCeldas(t, view));
    ix = {
      get cita() { return (cita ??= inicios(RAPIDA_CITA, t)); },
      get propio() { return (propio ??= inicios(RAPIDA_PROPIO, t)); },
      get rotulo() { return (rotulo ??= inicios(RAPIDA_OWN_CASE, t)); },
      get providencia() { return (providencia ??= inicios(RAPIDA_PROVIDENCIA, t)); },
      get propioOracion() { return (propioOracion ??= inicios(RAPIDA_PROPIO_ORACION, t)); },
      get fines() { return pasada().fines; },
      get saltos() { return pasada().saltos; },
      get celdas() { return pasada().celdas; },
    };
    indices.set(view, ix);
  }
  return ix;
}
/** El primer índice de `xs` (ordenado) con un inicio ≥ a. Búsqueda binaria. */
function primero(xs: readonly number[], a: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((xs[mid] as number) < a) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
/** ¿Algún inicio en [a, b)? */
function hay(xs: readonly number[], a: number, b: number): boolean {
  const lo = primero(xs, a);
  return lo < xs.length && (xs[lo] as number) < b;
}
/** Sin índice, siempre es posible; con índice, solo si algún inicio cae en [a, b) o en [c, d). */
const posible = (xs: readonly number[] | undefined, a: number, b: number, c: number, d: number): boolean =>
  xs === undefined || hay(xs, a, b) || hay(xs, c, d);

/**
 * La ventana de 7.3.3: hasta 250 caracteres antes y 120 después, sin salir de la línea. B-62 (PB-2-r7): el salto de línea se busca
 * solo dentro de la ventana. Antes se recorría el renglón entero en cada llamada, y R-RAD_ADMIN-03, que la consulta en cada
 * expediente, era cuadrática en un renglón largo y cortaba en el tope de tiempo.
 */
function ventanaDeCita(texto: string, start: number, end: number): string {
  const a0 = Math.max(0, start - 250);
  const antes = texto.slice(a0, start);
  const tras = texto.slice(end, end + 120);
  const k = tras.indexOf('\n');
  return antes.slice(antes.lastIndexOf('\n') + 1) + ' ' + (k < 0 ? tras : tras.slice(0, k));
}

// ---------------------------------------------------------------------------------------------------------------------
// A-1 y M-50 (PB-2-r7 y PB-2-r8; D-11) · El expediente de la Corte citado (R-RAD_ADMIN-03, 7.2.4)
// ---------------------------------------------------------------------------------------------------------------------
/**
 * Ventana de la oración (PB-2-r8): la de 7.3.3, 250 caracteres antes del expediente y 120 después, y dentro de ella la oración. En
 * -r7 eran las de `CITE_LEX` (150 y 60): una providencia al final de la misma oración («…, como lo dijo la Sentencia T-074 de 2020.»)
 * quedaba fuera.
 */
const PREC_ANTES = VENTANA_ANTES;
const PREC_TRAS = VENTANA_TRAS;
/**
 * D-11, condición 1 · Otra providencia identificada con su número y su año: «T-074 de 2020», «SU-123 de 2020», «C-313/14»,
 * «SC1234-2019», «Sentencia 123 de 2019», «Auto No. 95 de 2021». Sin `i`: el prefijo va en mayúscula y las palabras en minúscula,
 * con inicial o en MAYÚSCULAS (la vista de MAYÚSCULAS). «Precedente», «cfr.», «véase», «citado» o «caso análogo» solos ya no bastan
 * para descartar (PB-2-r7): son señales de cita, que dan la bandera. El expediente mismo no casa: lleva puntos o más de 4 cifras.
 */
const DE_ANIO = R`[ ]+[Dd][Ee][Ll]?[ ]+(?:19|20)\d{2}`;
const PROVIDENCIA_CORE = R`(?:(?:SU|T|C|A)[ ]?-[ ]?\d{1,4}[A-Z]?(?:${DE_ANIO}|[ ]*\/[ ]*(?:(?:19|20)\d{2}|\d{2}))|(?:SC|SL|SP|STC|STL|STP|AC|AL|AP|ATC|ATL|ATP|AHP|SU)\d{1,5}-(?:19|20)\d{2}|(?:[Ss]entencia|SENTENCIA|[Aa]uto|AUTO|[Pp]rovidencia|PROVIDENCIA|[Ff]allo|FALLO)[ ]+(?:(?:[Nn][ÚúUu](?:mero|MERO)|[Nn][Oo]\.?|[Nn][Rr][Oo]\.?)[ ]*)?\d{1,5}${DE_ANIO})`;
/** Con `y`: se prueba en una posición, sobre todo el texto (las fronteras ven el carácter de al lado). */
const PROVIDENCIA_Y = new RegExp(R`(?<![\p{L}\p{N}])${PROVIDENCIA_CORE}(?!\d)`, 'uy');
const RAPIDA_PROVIDENCIA = new RegExp(PROVIDENCIA_CORE, 'gu');
/**
 * D-11, condición 2 · Señales del propio caso en la oración del expediente: los trámites del expediente propio (selección,
 * insistencia, nulidad, desacato, temeridad, cumplimiento, poder, remisión, pruebas, «folio … del expediente», «al decidir el
 * expediente», la providencia «proferida en» él) y el escrito propio («su propia tutela», «mi tutela», «a mi favor», «la Corte me
 * amparó», «esta tutela», «se ordenó»). Anulan la de precedente y la de cita (B-70). Ante la duda se toma: detectar de más cuesta
 * una decisión del revisor; de menos, un dato a la vista (D-11). La cola de letras va acotada (`L20`): cada intento mira un largo
 * fijo, también en el índice, que reanuda en cada inicio.
 * - A-1 (PB-2-r9, D-14): la parte nombrada por su abogado o por quien escribe («mi poderdante», «mi representada», «mi prohijado»,
 *   «nuestro cliente», «mi mandante», «mi agenciada», «mi menor hijo»…; desde -r10, cualquier posesivo de `PRIMERA_PERSONA`) y el
 *   escrito en primera persona («la suscrita», «el suscrito», «el infrascrito», «el abajo firmante», «quien suscribe»:
 *   `ESCRITO_PROPIO`). Sin `i` no casarían en la vista de MAYÚSCULAS: la expresión va con `i`, como las demás.
 * - M-61 (PB-2-r9, D-14): todas las formas de los verbos con que se dice que la providencia es del expediente, no solo una: «proferida»
 *   y también «profirió», «profiere»; «dictó», «dictada»; «emitió», «emitida»; «dispuso», «dispuesto»; «lo resuelto». («resolvió»
 *   solo no: «Así lo resolvió la Corte en la sentencia T-123 de 2019, expediente …» es una de las negativas de D-11.)
 * - M-70 (PB-2-r10, D-11 y D-14): también «expidió», «expedida», «adoptó», «notificó», y «decidió» o «falló» en cualquier lugar de la
 *   oración («La Corte decidió en la Sentencia … el expediente …»). Los sustantivos «fallo» y «decisión» no: son de toda cita.
 * - A-3 (PB-2-r10, D-14): la primera persona en cualquier forma (`PRIMERA_PERSONA`): los posesivos «mi», «mis», «nuestro/a/os/as»
 *   delante de cualquier palabra y los pospuestos («a favor mío»); «yo», «nosotros», «conmigo», «a mí»; «me» o «nos» delante de
 *   cualquier palabra y pegados al verbo («ampararme», «concediéndonos»); y los verbos del escrito en primera persona («represento»,
 *   «solicito», «pido», «presenté», «acudo», «padezco», «soy», «he»…: `VERBO_1P`, una lista cerrada). La única excepción son los giros
 *   de opinión («a mi juicio», «en mi concepto», «a nuestro parecer»: `GIRO_DE_OPINION`). Los verbos con que se cita («invoco»,
 *   «cito», «considero», «recuerdo») no están: «Como precedente invoco la Sentencia …» es la negativa de D-11. Tampoco las formas que
 *   también son sustantivos («trabajo», «fundamento», «sustento», «anexo», «reclamo»), ni «de manifiesto». Además, el propio escrito y
 *   la parte del trámite (`ESCRITO_PROPIO`): «la firmante», «quien firma», «la abogada que suscribe», «la aquí accionante», «el hoy
 *   accionante», «la presente solicitud» (no «el presente año»), «este escrito», «esta tutela» y «en nombre propio».
 * - Entre las palabras de una señal, blancos o un salto de línea (`ESP`): el PDF que parte la oración («de mi⏎poderdante») no la corta
 *   (C03, `cortaEn`), así que tampoco puede partir la señal.
 */
const L20 = R`\p{L}{0,20}`;
const ESP = R`(?:[ ]+|[ ]*\n[ ]*)`;
/** A-3 · Giros de opinión: el posesivo que los lleva no es señal («a mi juicio», «en nuestra opinión», «a mi modo de ver»). */
const GIRO_DE_OPINION = R`(?:humilde${ESP})?(?:juicio|opini[óo]n|entender|parecer|criterio|concepto|sentir|ver|(?:modo|manera)${ESP}de${ESP}ver|punto${ESP}de${ESP}vista)(?![\p{L}])`;
/**
 * A-3 · Los verbos del escrito en primera persona (presente, pretérito y futuro, del singular y del plural): una lista cerrada, porque
 * una terminación en «-o» también es la de un sustantivo. Las formas con tilde («presenté») no casan sin ella («presente»).
 */
const VERBO_1P = R`(?:represent|solicit|instaur|formul|impetr|afirm|declar|aport|apel|impugn|demand|denunci|necesit|acredit|acompañ|present|labor|otorg|suplic|radic|alleg)(?:o|amos|é|ar[ée]|aremos)|(?:supliqu|radiqu|allegu|otorgu)é|(?<!de${ESP})manifiesto|manifest(?:amos|é|ar[ée])|(?:acud|recurr|sufr|viv|resid|suscrib)(?:o|imos|í|ir[ée]|iremos)|ped(?:imos|í|ir[ée]|iremos)|pido|interpongo|interpon(?:emos|dr[ée])|interpus(?:e|imos)|promuevo|promov(?:emos|í)|expongo|expus(?:e|imos)|requiero|requer(?:imos|í)|padezco|padec(?:emos|í)|act[úu]o|actu(?:amos|é)|soy|somos|estoy|estamos|tengo|tenemos|tuve|tuvimos|estuve|fui|fuimos|he|hemos`;
/** A-3 · La primera persona: posesivos (salvo un giro de opinión), pronombres, «me/nos» delante de una palabra, y `VERBO_1P`. */
const PRIMERA_PERSONA = R`(?:mis?|nuestr[oa]s?)(?![\p{L}])(?!${ESP}${GIRO_DE_OPINION})|mí(?:[oa]s?)?|mi[oa]s?|yo|nosotr[oa]s|conmigo|(?:me|nos)(?=${ESP}\p{L})|${VERBO_1P}`;
/**
 * A-3 · «me» y «nos» pegados al verbo: el infinitivo («ampararme», «otorgarnos», «concedérseme») y el gerundio («amparándome»,
 * «concediéndonos»), tras al menos dos letras. Casa en la terminación (el retrovisor mira las dos letras de antes), así que va fuera
 * de la frontera izquierda de las demás señales, y el índice solo la prueba donde empieza una terminación. Sin «-ernos»: «internos»,
 * «paternos», «cuadernos». Sin «-orme»: «informe», «conforme»; «firme» no tiene dos letras antes de «irme».
 */
const ENCLITICO_1P = R`(?<=\p{L}{2})(?:(?:[aeiáéí]r(?:se)?|[áé]ndo(?:se)?)me|(?:[aiáí]r(?:se)?|[eé]rse|[áé]ndo(?:se)?)nos)`;
const ESCRITO_PROPIO = R`(?:el|la|los|las|lo|del|al)${ESP}(?:suscrit[oa]s?|infrascrit[oa]s?|(?:abajo${ESP})?firmantes?|presentes?(?!${ESP}(?:año|mes|semana|siglo|d[íi]a)(?![\p{L}]))|(?:aqu[íi]|hoy)(?=${ESP}\p{L}))|(?:que|quien(?:es)?)${ESP}(?:suscrib${L20}|firm(?:a|an|o|amos))|est[ea]s?${ESP}(?:escrito|memorial|tr[áa]mite|incidente|asunto|caso|diligencias|petici[óo]n|impugnaci[óo]n|recurso|queja|tutela|acci[óo]n|demanda|solicitud)|(?:nombre|causa)${ESP}propi[oa]`;
const VERBO_PROPIO = R`prof(?:er|ir|ier)${L20}|dict(?:[óo]|ad[oa]s?|aron)|emit(?:i[óo]|ieron|id[oa]s?)|dispus${L20}|dispuest[oa]s?|resuelt[oa]s?|expid(?:e|en|i[óo]|ieron)|expedid[oa]s?|adopt${L20}|notific${L20}|decidi(?:[óo]|eron)|fall(?:ó|aron)`;
const PROPIO_ORACION_CORE = R`(?:selecci[óo]n${L20}|insist${L20}|nulidad(?:es)?|desacatos?|temer${L20}|(?:in)?cumpl${L20}|apoderad[oa]s?|(?:otorg|confier|confer)${L20}${ESP}(?:el${ESP})?poder|poder${ESP}(?:especial|amplio|general)|remit${L20}|remite|remisi[óo]n|escog${L20}|decret${L20}|pruebas|${VERBO_PROPIO}|dentro${ESP}del${ESP}(?:presente${ESP})?expediente|folios?|fls?\.|cuadernos?|cdno\.|(?:fall|decid|resolv)${L20}${ESP}(?:(?:el|este|dicho|del|al|su)${ESP})?(?:expedientes?|exp\.)|propi[oa]s?${ESP}(?:tutela|acci[óo]n|demanda|solicitud|expediente|caso|proceso)|${PRIMERA_PERSONA}|${ESCRITO_PROPIO}|orden(?:[óo]|ad[oa]s?|aron)|las?${ESP}[óo]rden(?:es)?)`;
const PROPIO_ORACION_Y = new RegExp(R`(?<![\p{L}])${PROPIO_ORACION_CORE}(?![\p{L}])|${ENCLITICO_1P}(?![\p{L}])`, 'iuy');
/**
 * La versión del índice: la frontera izquierda va también aquí (PB-2-r10), así que solo se prueban las alternativas en el inicio de
 * una palabra (o de una terminación enclítica). Sigue siendo exacta: la expresión completa exige la misma frontera.
 */
const RAPIDA_PROPIO_ORACION = new RegExp(R`(?<![\p{L}])${PROPIO_ORACION_CORE}|${ENCLITICO_1P}`, 'giu');

/**
 * M-61 (PB-2-r9) y M-70 (PB-2-r10, D-14) · Una celda o un encabezado no es una oración, y ante la duda se toma. En la oración del
 * expediente son señales del propio caso:
 * - un tabulador o una barra entre celdas («11001-…-00⇥T-9.000.001⇥T-123 de 2026», «| T-9.000.001 | T-123 de 2026 |»), con algo antes
 *   en el renglón tras hasta 8 espacios que no sea un blanco, «.», «)», «]», «•», «·», «*», «º», «°» ni un guion: así no cuentan la
 *   sangría ni el que sigue a una viñeta o a un número de lista («1.⇥», «a)⇥», «-⇥», «•⇥»);
 * - un guion, «/», «·» o «•» entre blancos, con algo antes en el renglón («Sentencia T-123 de 2026 – Expediente T-…», «… / Expediente
 *   …», «… · Expediente …»; la vista `reglas` ya convierte «–» y «—» en «-»). No el pegado («T-123», «SU-508/20», «y/o»);
 * - M-70 (c): el hueco ancho de una fila de tabla del PDF («11001-…-00␣␣␣␣␣T-9.000.001␣␣␣␣␣T-123 de 2026»): dos o más blancos entre
 *   dos textos del mismo renglón, con lo mismo antes que el tabulador. La vista `reglas` los colapsa en uno, así que el ancho se mira
 *   en el texto canónico, con el mapa de la vista (`endMap − startMap`). Sin vista solo se ven los blancos repetidos del texto.
 * Antes, una alternativa de `PROPIO_ORACION` con un retrovisor; ahora una pasada por carácter (`esCelda`), cuyas posiciones guarda el
 * índice de la vista junto a los fines y los saltos (B-72): con índice, cada consulta es una búsqueda binaria.
 */
/** `\s` de JavaScript, por código: sin una expresión por carácter en la pasada del índice. */
const esEspacioJs = (c: number): boolean => (c >= 9 && c <= 13) || c === 32 || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
/** `[\s.)\]•·*º°\-‐-―]`: lo que no puede ir justo antes de una celda (la sangría, la viñeta, el número de lista). */
const antesDeCeldaExcluido = (c: number): boolean => esEspacioJs(c) || c === 46 || c === 41 || c === 93 || c === 0x2022 || c === 0xb7 || c === 42 || c === 0xba || c === 0xb0 || c === 45 || (c >= 0x2010 && c <= 0x2015);
const esBlancoH = (c: number): boolean => c === 32 || c === 9;
/** «-», «‐» a «―», «/», «·» y «•»: separadores de un encabezado cuando van entre blancos. */
const esSeparadorEntreBlancos = (c: number): boolean => c === 45 || (c >= 0x2010 && c <= 0x2015) || c === 47 || c === 0xb7 || c === 0x2022;
const esCandidatoDeCelda = (c: number): boolean => c === 9 || c === 124 || c === 32 || esSeparadorEntreBlancos(c);
/** ¿El carácter de `texto` en `p` separa dos celdas o las dos partes de un encabezado? `view`: la vista de `texto`, para el ancho. */
function esCelda(texto: string, p: number, view: SearchView | undefined): boolean {
  const c = texto.charCodeAt(p);
  if (c === 32) {
    let q = p + 1;
    while (q < texto.length && q < p + 16 && texto.charCodeAt(q) === 32) q++;
    const propio = view === undefined ? 1 : (view.endMap[p] ?? p + 1) - (view.startMap[p] ?? p);
    if (propio + (q - p - 1) < 2 || q >= texto.length || esEspacioJs(texto.charCodeAt(q))) return false;
    return p > 0 && texto.charCodeAt(p - 1) !== 32 && !antesDeCeldaExcluido(texto.charCodeAt(p - 1));
  }
  if (c === 9 || c === 124) {
    let q = p - 1;
    while (q >= 0 && q >= p - 8 && texto.charCodeAt(q) === 32) q--;
    return q >= 0 && !antesDeCeldaExcluido(texto.charCodeAt(q));
  }
  if (!esSeparadorEntreBlancos(c) || !esBlancoH(texto.charCodeAt(p + 1))) return false;
  let q = p - 1;
  while (q >= 0 && q >= p - 8 && esBlancoH(texto.charCodeAt(q))) q--;
  return q >= 0 && q < p - 1 && !esEspacioJs(texto.charCodeAt(q));
}
/** ¿Hay una celda en [desde, hasta)? Con índice, búsqueda binaria; sin él, carácter por carácter (lo mismo). */
function celdaEn(texto: string, desde: number, hasta: number, view: SearchView | undefined, ix: IndiceDeCita | undefined): boolean {
  if (ix !== undefined) return hay(ix.celdas, desde, hasta);
  for (let p = desde; p < hasta; p++) if (esCandidatoDeCelda(texto.charCodeAt(p)) && esCelda(texto, p, view)) return true;
  return false;
}
/**
 * M-70 (PB-2-r10, D-14) · Un encabezado con dos puntos pegado al expediente: «Sentencia T-123 de 2026: Expediente T-…», «…: T-…» o
 * «Expediente T-…: Sentencia …». Solo pegado (con blancos, el rótulo y el signo de número de por medio): los dos puntos de una
 * oración («invoco las siguientes: …») no cuentan. Ventanas fijas: hasta 8 blancos después y los últimos dos puntos de los 40
 * caracteres de antes (lo que sigue a los dos puntos no puede llevar otros).
 */
const DOS_PUNTOS_ANTES = /^:[ \t]{0,8}(?:(?:expediente|exp\.|radicad[oa]|rad\.)[ \t]{0,8}(?:(?:no\.?|n\.?[ ]?º|nro\.?)[ \t]{0,8})?)?$/iu;
function dosPuntosJunto(texto: string, start: number, end: number): boolean {
  let q = end;
  while (q < texto.length && q < end + 8 && esBlancoH(texto.charCodeAt(q))) q++;
  if (texto.charCodeAt(q) === 58) return true;
  for (let p = start - 1; p >= 0 && p >= start - 40; p--) if (texto.charCodeAt(p) === 58) return DOS_PUNTOS_ANTES.test(texto.slice(p, start));
  return false;
}

/**
 * ¿Casa `re` (con `y`, sobre todo el texto) en alguna posición de [desde, hasta) y acaba antes de `hasta`? Con el índice de la vista
 * (`xs`, los inicios de la versión sin fronteras), solo se prueba en esos inicios: si la completa casa en p, la rápida casa en p. Sin
 * índice, en cada posición (las pruebas). Lo mismo en los dos casos, y cada intento mira un largo acotado.
 */
function casaEn(re: RegExp, texto: string, desde: number, hasta: number, xs: readonly number[] | undefined): boolean {
  if (xs === undefined) {
    for (let p = desde; p < hasta; p++) if (casaAqui(re, texto, p, hasta)) return true;
    return false;
  }
  for (let i = primero(xs, desde); i < xs.length && (xs[i] as number) < hasta; i++) if (casaAqui(re, texto, xs[i] as number, hasta)) return true;
  return false;
}
/** `re` (con `y`) casa en `p` y acaba antes de `hasta`. Sin cierre ni arreglo por intento (PB-2-r10: menos basura en un renglón largo). */
function casaAqui(re: RegExp, texto: string, p: number, hasta: number): boolean {
  re.lastIndex = p;
  return re.test(texto) && re.lastIndex <= hasta;
}
/**
 * D-11, condición 2 · Rótulo del propio caso al inicio del renglón del expediente (antes de él) o del renglón anterior que no está
 * en blanco: «Referencia: Acción de tutela. Expediente …», «Ref.:⏎T-9.000.001», «Expediente⏎T-…», «REF.: EXPEDIENTE⏎T-…». El
 * rótulo con dos puntos, con punto («Ref.», «Exp.») o solo en su renglón.
 */
const ROTULO_LINEA = /^[ \t]*(?:(?:Referencia|Asunto|Radicad[oa]|Radicaci[oó]n|Proceso|Expediente)[ \t]*(?::|$)|Ref\.|Ref[ \t]*:|Exp\.)/iu;
/** Hasta dónde se busca el inicio de un renglón (la ventana de 7.3.3): más allá, el rótulo no se ve y no cuenta. */
const RENGLON_MAX = VENTANA_ANTES;

/**
 * A-1 (PB-2-r8) · Fin de oración. Ante la duda se corta, porque cortar de más solo hace que se tome de más.
 * - «;», «!» y «?» cortan siempre.
 * - «.» seguido de blancos (o de una comilla o un paréntesis que cierra) corta, salvo tras una abreviatura: ante una minúscula no
 *   corta ninguna («Cfr. folio», «S.A. y la»), y ante una mayúscula, una cifra o un signo solo las que siempre llevan algo detrás
 *   (`ABREV_FUERTE`: «Dr. Ejemplo», «No. 12», «M.P. Ana»). Una inicial, «S.A.» o «Ltda.» seguidos de mayúscula cortan.
 * - Un salto de línea corta salvo que el renglón anterior acabe en una palabra o en coma y el siguiente empiece en minúscula o en
 *   el expediente mismo (el PDF que parte la oración, C03). Un renglón sin minúsculas en un texto que sí las tiene es un título
 *   («IV. PRECEDENTE APLICABLE») y corta. En un texto sin minúsculas (la vista de MAYÚSCULAS) la mayúscula cuenta como minúscula.
 * - Una línea en blanco corta.
 */
const ABREV_FUERTE = /(?<![\p{L}])(?:cfr|vid|vr|sr|sra|srta|dr|dra|no|nro|n[úu]m|art|arts|inc|lit|num|par|p[áa]g|pp|fl|fls|cap|ss|exp|rad|ref|op|ib|ib[íi]d|m\.[ ]?p|c\.[ ]?p)$/iu;
const ABREV_DEBIL = /(?<![\p{L}])(?:\p{L}|ltda|c[íi]a|corp|cit|etc)$/iu;
/** «.», «;», «!», «?» o «\n». */
const esCandidatoDeFin = (c: number): boolean => c === 46 || c === 59 || c === 33 || c === 63 || c === 10;
const CIERRE = /[»"”’')\]]/u;
const LETRA = /\p{L}/u;
const MINUSCULA = /\p{Ll}/u;
const esBlanco = (c: string): boolean => c === ' ' || c === '\t';

/** ¿Corta la oración el carácter de `texto` en `p` («.», «;», «!», «?» o «\n»)? `ini`: inicio de la ventana; `start`: el expediente. */
function cortaEn(texto: string, p: number, ini: number, start: number, sinMinusculas: boolean): boolean {
  const ch = texto.charAt(p);
  if (ch === ';' || ch === '!' || ch === '?') return true;
  if (ch === '.') {
    let q = p + 1;
    while (q < texto.length && q < p + 4 && CIERRE.test(texto.charAt(q))) q++;
    let k = q;
    while (k < texto.length && k < q + 8 && esBlanco(texto.charAt(k))) k++;
    // «S.A», «1.000», «www.x»: el punto pegado a lo que sigue no cierra nada.
    if (k < texto.length && k === p + 1 && texto.charAt(k) !== '\n') return false;
    if (k >= texto.length) return true;
    const previo = texto.slice(Math.max(0, p - 6), p);
    const fuerte = ABREV_FUERTE.test(previo);
    const abreviatura = fuerte || ABREV_DEBIL.test(previo);
    const sig = texto.charAt(k);
    if (sig === '\n') return !abreviatura;   // tras una abreviatura decide el salto de línea
    if (MINUSCULA.test(sig) && !sinMinusculas) return !abreviatura;
    return !fuerte;
  }
  // Salto de línea.
  let q = p + 1;
  while (q < texto.length && q < p + 16 && esBlanco(texto.charAt(q))) q++;
  if (q >= texto.length || texto.charAt(q) === '\n') return true;
  const sig = texto.charAt(q);
  const siguienteSigue = q === start || (LETRA.test(sig) && (MINUSCULA.test(sig) || sinMinusculas));
  if (!siguienteSigue) return true;
  let r = p - 1;
  while (r >= ini && r > p - 16 && esBlanco(texto.charAt(r))) r--;
  if (r < ini) return true;
  const fin = texto.charAt(r);
  if (fin === ',') return false;
  if (!LETRA.test(fin)) return true;
  if (sinMinusculas) return false;
  // El renglón anterior, dentro de la ventana (B-62: nunca se recorre el texto fuera de ella).
  const enVentana = texto.slice(ini, r + 1);
  const renglon = enVentana.slice(enVentana.lastIndexOf('\n') + 1);
  return !MINUSCULA.test(renglon);   // un renglón sin minúsculas es un título
}

/** Los bordes de la oración del expediente en [start, end), dentro de la ventana [a, b): [ini, start) y [end, fin). */
function oracionDelExpediente(texto: string, start: number, end: number, a: number, b: number, ix: IndiceDeCita | undefined): { ini: number; fin: number } {
  const sinMinusculas = !MINUSCULA.test(texto.slice(a, b));
  // Desde el expediente hacia afuera, hasta el primer corte de cada lado, sin salir de la ventana (B-62). Con índice (B-72), solo se
  // miran los candidatos; sin él, cada carácter. Lo mismo en los dos casos.
  let ini = a;
  let fin = b;
  if (ix !== undefined) {
    for (let i = primero(ix.fines, start) - 1; i >= 0 && (ix.fines[i] as number) >= a; i--) {
      const p = ix.fines[i] as number;
      if (cortaEn(texto, p, a, start, sinMinusculas)) { ini = p + 1; break; }
    }
    for (let i = primero(ix.fines, end); i < ix.fines.length && (ix.fines[i] as number) < b; i++) {
      const p = ix.fines[i] as number;
      if (cortaEn(texto, p, a, start, sinMinusculas)) { fin = p; break; }
    }
    return { ini, fin };
  }
  for (let p = start - 1; p >= a; p--) {
    if (esCandidatoDeFin(texto.charCodeAt(p)) && cortaEn(texto, p, a, start, sinMinusculas)) { ini = p + 1; break; }
  }
  for (let p = end; p < b; p++) {
    if (esCandidatoDeFin(texto.charCodeAt(p)) && cortaEn(texto, p, a, start, sinMinusculas)) { fin = p; break; }
  }
  return { ini, fin };
}

/**
 * Inicio del renglón que contiene la posición `p` (el carácter tras el salto anterior), o -1 si está a más de `RENGLON_MAX`. El salto
 * se busca solo en la ventana (B-62): un `lastIndexOf` sobre todo el texto sería cuadrático en un renglón largo. Con índice, por
 * búsqueda binaria en los saltos de la vista.
 */
function inicioDeRenglon(texto: string, p: number, ix: IndiceDeCita | undefined): number {
  const desde = Math.max(0, p - RENGLON_MAX);
  let nl = -1;
  if (ix !== undefined) {
    const i = primero(ix.saltos, p) - 1;
    if (i >= 0 && (ix.saltos[i] as number) >= desde) nl = ix.saltos[i] as number;
  } else {
    const k = texto.slice(desde, p).lastIndexOf('\n');
    if (k >= 0) nl = desde + k;
  }
  if (nl >= 0) return nl + 1;
  return desde === 0 ? 0 : -1;
}

/** ¿Un rótulo del propio caso al inicio del renglón del expediente, antes de él, o al inicio del renglón anterior que no está en blanco? */
function rotuloPropio(texto: string, start: number, ix: IndiceDeCita | undefined): boolean {
  const linea = inicioDeRenglon(texto, start, ix);
  if (linea < 0) return false;
  if (ROTULO_LINEA.test(texto.slice(linea, start))) return true;
  let finPrevio = linea - 1;
  while (finPrevio >= 0 && start - finPrevio <= 2 * RENGLON_MAX) {
    const ini = inicioDeRenglon(texto, finPrevio, ix);
    if (ini < 0) return false;
    const renglon = texto.slice(ini, finPrevio);
    if (renglon.trim() !== '') return ROTULO_LINEA.test(renglon);
    finPrevio = ini - 1;
  }
  return false;
}
/**
 * A-1 (PB-2-r7 y PB-2-r8) · ¿El expediente en [start, end) de la vista `reglas` se cita como otra providencia? Es la regla de D-11
 * sin su tercera condición (la misma clave en otra mención sin cita, que necesita todo el documento: la aplica la tubería).
 */
export function esPrecedenteCitado(texto: string, start: number, end: number): boolean {
  return contextoDelExpediente(texto, start, end) === 'precedente';
}

/**
 * R-RAD_ADMIN-03 (D-11; PB-2-r8: A-1, M-50 y B-70) · El contexto del expediente en [start, end) de la vista `reglas`:
 * - `precedente` (no se toma) solo si, en la misma oración, va con **otra providencia identificada con su número y su año**
 *   (`PROVIDENCIA`) y no hay **ninguna señal del propio caso**: la de 7.3.3 (`CITA_PROPIO`), el rótulo justo antes (`OWN_CASE`),
 *   un rótulo al inicio de su renglón o del anterior (`rotuloPropio`), o en la oración un trámite, el escrito propio, la parte
 *   nombrada por quien escribe, un verbo de la providencia del expediente, una celda o un encabezado con guion (`PROPIO_ORACION`;
 *   PB-2-r9: A-1 y M-61). La tercera condición de D-11 (la misma clave sin cita en otra mención del documento) la aplica la tubería.
 * - `cita` (se toma, con la bandera) si está en contexto de cita (`esContextoDeCita`) y no hay ninguna señal del propio caso (B-70).
 * - `null` (se toma) en otro caso.
 * PB-2-r10: la primera persona en cualquier forma (A-3), los verbos y encabezados de M-70 y las celdas (`esCelda`, `dosPuntosJunto`)
 * son también señales del propio caso.
 * Ventanas fijas e índice de la vista (B-62 y B-72): solo se arma la oración si en la ventana empieza una providencia o una señal
 * del propio caso. Tiempo lineal en el número de expedientes, también en un renglón largo. `view` es la vista de `texto`: da el
 * índice y el ancho de los blancos en el canónico (M-70). Sin `view` da lo mismo, salvo ese ancho; con `indice: false` (las pruebas)
 * se usa la vista sin el índice, y da lo mismo.
 */
export function contextoDelExpediente(texto: string, start: number, end: number, view?: SearchView, indice = true): 'precedente' | 'cita' | null {
  const vista = view === undefined || view.text !== texto ? undefined : view;
  const ix = vista === undefined || !indice ? undefined : indiceDeCita(vista);
  // R-CIT-01: `CITE_LEX` y `OWN_CASE` en 150 caracteres antes y 60 después.
  const antes = texto.slice(Math.max(0, start - CITE_ANTES), start);
  const lexico = (posible(ix?.cita, start - CITE_ANTES, start, 0, 0) && CITE_LEX.test(antes))
    || (posible(ix?.cita, end, end + CITE_TRAS, 0, 0) && CITE_LEX.test(texto.slice(end, end + CITE_TRAS)));
  // D-11: la oración, dentro de la ventana de 7.3.3 (250 caracteres antes y 120 después).
  const a = Math.max(0, start - PREC_ANTES);
  const b = Math.min(texto.length, end + PREC_TRAS);
  const providencia = casaEn(PROVIDENCIA_Y, texto, a, start, ix?.providencia) || casaEn(PROVIDENCIA_Y, texto, end, b, ix?.providencia);
  const cita = citaConLexico(texto, start, end, antes, lexico, ix);
  if (!providencia && !cita) return null;
  // Las señales del propio caso anulan las dos (D-11 y B-70). Con `cita`, `citaConLexico` ya vio que no hay `CITA_PROPIO` ni `OWN_CASE`.
  if (!cita && (rotuloJustoAntes(antes, start, ix)
    || (posible(ix?.propio, start - VENTANA_ANTES, start, end, end + VENTANA_TRAS) && CITA_PROPIO.test(ventanaDeCita(texto, start, end))))) return null;
  if (rotuloPropio(texto, start, ix) || dosPuntosJunto(texto, start, end)) return null;
  const o = providencia || posible(ix?.propioOracion, a, start, end, b) || posible(ix?.celdas, a, start, end, b)
    ? oracionDelExpediente(texto, start, end, a, b, ix) : null;
  if (o === null) return cita ? 'cita' : null;
  if (celdaEn(texto, o.ini, start, vista, ix) || celdaEn(texto, end, o.fin, vista, ix)
    || casaEn(PROPIO_ORACION_Y, texto, o.ini, start, ix?.propioOracion) || casaEn(PROPIO_ORACION_Y, texto, end, o.fin, ix?.propioOracion)) return null;
  if (providencia && (casaEn(PROVIDENCIA_Y, texto, o.ini, start, ix?.providencia) || casaEn(PROVIDENCIA_Y, texto, end, o.fin, ix?.providencia))) return 'precedente';
  return cita ? 'cita' : null;
}
