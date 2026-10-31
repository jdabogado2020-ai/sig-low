// PG-4 · Generalización asistida y banderas de revisión manual (plan 6.4.5, 6.4.6, 7.7 y 7.8).
// TypeScript puro: sin DOM, sin red, sin consola. Los datos salen de data/*.json.
//
// Dos fases, según 6.11.2:
//  1. `detectPlaces` (en `detectar`, después del Catálogo A): candidatos MUNICIPIO / DEPARTAMENTO (R-MUN-01 a R-MUN-05, R-DEP-01).
//  2. `generalize` (en `fusionar`, después de merge.ts): sugerencias (6.4.5) y banderas (6.4.6) sobre las detecciones ya fusionadas.
// Los patrones buscan sobre la vista `reglas` (6.1.2) y se devuelven en posiciones canónicas.

import { esContextoDeCita } from './rules/exclusiones.ts';
import divipolaRaw from '../../data/divipola.json';
import cargosRaw from '../../data/cargos.json';
import diagnosticosRaw from '../../data/diagnosticos.json';
import cie10Raw from '../../data/cie10-patron.json';
import llamativosRaw from '../../data/llamativos.json';
import menoresRaw from '../../data/menores.json';
import type {
  Confidence, DataType, DetectionCandidate, DetectionId, DivipolaFile, DivipolaIndex, DivipolaRow, Flag, FlagId, FlagReason,
  FlagType, GeneralizationKind, IdSource, IsoDate, LabelHit, PartId, Span, Suggestion, SuggestionId, SuggestionKind, SuggestionOption,
} from './types.ts';

// ===================================================================== utilidades de patrones

const H = '[ \\t]';
/** Blancos dentro de un lookbehind: con tope, para que su costo en cada posición no crezca con la racha (M-14). */
const H8 = `${H}{1,8}`;
/** Separador del nombre de un despacho (R-DESP-01): blancos horizontales, o un salto de línea con blancos alrededor. */
const HD = `(?:${H}*\\r?\\n${H}*|${H}+)`;
const SALTO = /\r?\n/g;
const LB = '(?<![\\p{L}\\p{N}])';
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** Alternancia de formas literales, de la más larga a la más corta; el espacio interno admite uno o más blancos horizontales. */
const alt = (arr: readonly string[]): string => {
  const u = [...new Set(arr)].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  return '(?:' + u.map((w) => esc(w).replace(/ /g, H + '+')).join('|') + ')';
};
const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);
/** Tres formas: minúscula, Capitalizada, MAYÚSCULA. */
const v3 = (ws: readonly string[]): string[] => ws.flatMap((w) => [w, cap(w), w.toUpperCase()]);
const deacc = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
/** Vista `lista` de un nombre (6.1.2): minúsculas, sin tildes, espacios colapsados. */
export const vistaLista = (s: string): string => deacc(s.toLowerCase()).replace(/\s+/g, ' ').trim();
const sub = (s: string): string => s.replaceAll('{H}', H);

// ===================================================================== vista de búsqueda con mapa

/** Subconjunto estructural de `SearchView` (6.1.2): sin mapas, la vista es el texto canónico. */
export interface ViewLike {
  readonly text: string;
  readonly startMap?: ArrayLike<number>;
  readonly endMap?: ArrayLike<number>;
}
const canonStart = (v: ViewLike, i: number): number => (v.startMap ? (v.startMap[i] ?? i) : i);
/** `i` es exclusivo en la vista; devuelve la posición canónica exclusiva. */
const canonEnd = (v: ViewLike, i: number): number => (v.endMap ? (v.endMap[i - 1] ?? i) : i);
/** Primer índice de la vista cuyo inicio canónico es ≥ c. */
function viewIndexAtOrAfter(v: ViewLike, c: number): number {
  const map = v.startMap;
  if (!map) return Math.min(c, v.text.length);
  let lo = 0, hi = v.text.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if ((map[mid] ?? 0) < c) lo = mid + 1; else hi = mid; }
  return lo;
}
/** Índice exclusivo de la vista tal que el último carácter incluido termina en ≤ c canónico. */
function viewIndexEndFor(v: ViewLike, c: number): number {
  const map = v.endMap;
  if (!map) return Math.min(c, v.text.length);
  let lo = 0, hi = v.text.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if ((map[mid] ?? 0) < c) lo = mid + 1; else hi = mid; }
  return Math.min(lo + 1, v.text.length);
}

// ===================================================================== DIVIPOLA (7.7.1, 7.7.2)

export const DIVIPOLA: DivipolaFile = divipolaRaw as DivipolaFile;

/** data/divipola_alias.json (semilla de PG-4): nombre usual → código de municipio. */
export const ALIAS_MUNICIPIOS: Readonly<Record<string, string>> = {
  'Bogotá': '11001', 'Bogotá D.C.': '11001', 'Bogotá, D. C.': '11001', 'Cali': '76001', 'Cúcuta': '54001', 'Cartagena': '13001',
  'Ubaté': '25843', 'Mompox': '13468', 'Mompós': '13468', 'Tumaco': '52835', 'Buga': '76111', 'Mariquita': '73443', 'Tolú': '70820',
  'Santa Fe de Antioquia': '05042',
};
/** Alias de departamentos → código de departamento. */
export const ALIAS_DEPARTAMENTOS: Readonly<Record<string, string>> = {
  'Valle': '76', 'Guajira': '44', 'San Andrés y Providencia': '88', 'San Andrés': '88', 'Bogotá': '11', 'Bogotá D.C.': '11',
};
/** data/municipios_ambiguos.json, parte curada (7.7.1): nombres que son también palabras comunes, nombres de pila o apellidos. */
export const MUNICIPIOS_COMUNES: readonly string[] = [
  'cartago', 'florencia', 'granada', 'victoria', 'la victoria', 'la union', 'santa rosa', 'bolivar', 'gutierrez', 'medina', 'vergara',
  'beltran', 'ortega', 'salazar', 'miranda', 'ospina', 'trujillo', 'toro', 'velez', 'galan', 'giron', 'prado', 'silvia', 'dolores',
  'lourdes', 'socorro', 'candelaria', 'elias',
];

/** Capital: código terminado en 001, salvo 25001 (la capital de Cundinamarca es Bogotá, D.C., 11001). Se usa al empaquetar. */
export const esCapital = (mun: string): boolean => mun.endsWith('001') && mun !== '25001';

export function buildDivipolaIndex(
  rows: readonly DivipolaRow[],
  aliasMun: Readonly<Record<string, string>> = ALIAS_MUNICIPIOS,
  aliasDep: Readonly<Record<string, string>> = ALIAS_DEPARTAMENTOS,
  comunes: readonly string[] = MUNICIPIOS_COMUNES,
): DivipolaIndex {
  const porNombre: Record<string, DivipolaRow[]> = {};
  const add = (k: string, row: DivipolaRow | undefined): void => {
    if (!row) return;
    const list = (porNombre[k] ??= []);
    if (!list.includes(row)) list.push(row);
  };
  for (const r of rows) add(vistaLista(r.munNombre), r);
  for (const [a, code] of Object.entries(aliasMun)) add(vistaLista(a), rows.find((r) => r.mun === code));
  const departamentos: Record<string, string> = {};
  for (const r of rows) departamentos[vistaLista(r.depNombre)] = r.dep;
  for (const [a, code] of Object.entries(aliasDep)) departamentos[vistaLista(a)] = code;
  const homonimos = Object.entries(porNombre).filter(([, rs]) => new Set(rs.map((r) => r.dep)).size > 1).map(([k]) => k);
  const ambiguos = [...new Set([...homonimos, ...comunes])].sort();
  return { porNombre, departamentos, ambiguos };
}

interface IndexCache { index: DivipolaIndex; ambiguosSet: Set<string>; depNombres: Record<string, string>; munNames: string[]; depNames: string[] }
let indexCache: IndexCache | null = null;
function getIndex(): IndexCache {
  if (indexCache) return indexCache;
  const index = buildDivipolaIndex(DIVIPOLA);
  const depNombres: Record<string, string> = {};
  for (const r of DIVIPOLA) depNombres[r.dep] = r.depNombre;
  indexCache = {
    index,
    ambiguosSet: new Set(index.ambiguos),
    depNombres,
    munNames: [...new Set([...DIVIPOLA.map((r) => r.munNombre), ...Object.keys(ALIAS_MUNICIPIOS)])],
    depNames: [...new Set([...DIVIPOLA.map((r) => r.depNombre), ...Object.keys(ALIAS_DEPARTAMENTOS)])],
  };
  return indexCache;
}
export const getDivipolaIndex = (): DivipolaIndex => getIndex().index;
/** Nombre oficial de un departamento por su código DANE de 2 dígitos. */
export const nombreDepartamento = (dep: string): string | undefined => getIndex().depNombres[dep];

export type PlaceStatus = 'unico' | 'resuelto_por_depto' | 'resuelto_por_documento' | 'ambiguo' | 'no_encontrado';
export interface PlaceResolution {
  status: PlaceStatus;
  /** Códigos de departamento: uno si está resuelto, los candidatos si es ambiguo, vacío si no se encontró. */
  deps: string[];
  /** Código de municipio de 5 dígitos, solo si está resuelto. */
  mun?: string;
  /** El departamento escrito no corresponde a ningún candidato. */
  mismatch?: boolean;
}

/** Código de departamento de un nombre o alias de departamento (vista lista), o null. */
export function departamentoPorNombre(nombre: string): string | null {
  return getIndex().index.departamentos[vistaLista(nombre)] ?? null;
}
/** Filas candidatas de un nombre o alias de municipio. */
export function municipiosPorNombre(nombre: string): DivipolaRow[] {
  return getIndex().index.porNombre[vistaLista(nombre)] ?? [];
}
/** ¿El nombre exige contexto fuerte? (homónimo o palabra común, 7.7.1). */
export const esAmbiguo = (nombre: string): boolean => getIndex().ambiguosSet.has(vistaLista(nombre));
export const prioridadDe = (munCode: string | undefined): 'recomendada' | 'opcional_ciudad_grande' => {
  if (!munCode) return 'recomendada';
  const row = DIVIPOLA.find((r) => r.mun === munCode);
  return row?.capital ? 'opcional_ciudad_grande' : 'recomendada';
};

/** 7.7.2: municipio → departamento. */
export function resolvePlace(nombre: string, departamentoEscrito?: string | null, departamentosDelDocumento: readonly string[] = []): PlaceResolution {
  const cand = municipiosPorNombre(nombre);
  if (!cand.length) return { status: 'no_encontrado', deps: [] };
  const deps = [...new Set(cand.map((c) => c.dep))].sort();
  const munOf = (d: string): string | undefined => cand.find((c) => c.dep === d)?.mun;
  if (departamentoEscrito) {
    const d = departamentoPorNombre(departamentoEscrito);
    if (d && deps.includes(d)) return { status: 'resuelto_por_depto', deps: [d], mun: munOf(d) };
    return { status: 'ambiguo', deps, mismatch: true };
  }
  const unico = deps.length === 1 ? deps[0] : undefined;
  if (unico) return { status: 'unico', deps: [unico], mun: munOf(unico) };
  const enDoc = deps.filter((d) => departamentosDelDocumento.includes(d));
  const unicoDoc = enDoc.length === 1 ? enDoc[0] : undefined;
  if (unicoDoc) return { status: 'resuelto_por_documento', deps: [unicoDoc], mun: munOf(unicoDoc) };
  return { status: 'ambiguo', deps };
}

// ===================================================================== formas de nombres de lugares (7.7.1)

const CONECTORES_TITULO = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y']);
/** Tipo título: mayúscula inicial; conectores en minúscula salvo al inicio; abreviaturas con punto en mayúscula. */
const titleCase = (s: string): string => s.toLowerCase().split(' ')
  .map((w, i) => (w.includes('.') ? w.toUpperCase() : (i > 0 && CONECTORES_TITULO.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
/** Seis formas por nombre: original, sin tildes, MAYÚSCULAS, MAYÚSCULAS sin tildes, tipo título, tipo título sin tildes. */
export function formasDeNombre(names: readonly string[]): string[] {
  const out: string[] = [];
  for (const n of names) { const t = titleCase(n); out.push(n, deacc(n), n.toUpperCase(), deacc(n).toUpperCase(), t, deacc(t)); }
  return out;
}

// ===================================================================== reglas de lugares (7.7.3)

interface PlaceFragments { GAZ: string; MUN: string; DEP: string; DEPX: string }
interface PlaceRegexes {
  frag: PlaceFragments;
  mun01: RegExp; mun02: RegExp; mun03Sep: RegExp; mun04: RegExp; mun05: RegExp; desp: RegExp; dep01: RegExp;
}
let placeRx: PlaceRegexes | null = null;

const DESP_HEAD = v3(['juzgado', 'tribunal', 'alcaldía', 'alcaldia', 'personería', 'personeria', 'notaría', 'notaria', 'comisaría', 'comisaria',
  'inspección', 'inspeccion', 'fiscalía', 'fiscalia', 'registraduría', 'registraduria', 'concejo', 'curaduría', 'curaduria', 'juez', 'jueza']);
const DESP_ORD = ['primero', 'primera', 'primer', 'segundo', 'segunda', 'tercero', 'tercera', 'cuarto', 'cuarta', 'quinto', 'quinta', 'sexto', 'sexta',
  'séptimo', 'séptima', 'octavo', 'octava', 'noveno', 'novena', 'décimo', 'décima', 'único', 'única'];
const DESP_W = v3([...DESP_ORD, 'civil', 'penal', 'laboral', 'administrativo', 'administrativa', 'familia', 'promiscuo', 'promiscua', 'municipal',
  'circuito', 'superior', 'distrito', 'judicial', 'especializado', 'especializada', 'ejecución', 'penas', 'medidas', 'seguridad', 'pequeñas', 'causas',
  'competencia', 'múltiple', 'control', 'garantías', 'conocimiento', 'adolescentes', 'menores', 'restitución', 'tierras', 'oral', 'seccional', 'local',
  'delegada', 'sala', 'policía', 'círculo', 'registro', 'urbana', 'mayor', 'de', 'del', 'y', 'para', 'la', 'las', 'los', 'el']);
const ORD_SET = new Set(DESP_ORD.map(vistaLista));
/**
 * R-DESP-01 · Cabezas de despacho y palabras del nombre de un despacho, en vista `lista`. Las usa el mapeo 7.10.8 de los tramos
 * de autoridad del modelo (pipeline.ts, D-03 C) para no duplicar el vocabulario.
 */
export const VOCABULARIO_DESPACHO: { readonly cabezas: ReadonlySet<string>; readonly palabras: ReadonlySet<string> } = {
  cabezas: new Set(DESP_HEAD.map(vistaLista)), palabras: new Set(DESP_W.map(vistaLista)),
};
const FEM_HEAD = /^(alcald|personer|notar|comisar|inspecci|fiscal|registradur|curadur|jueza)/;
const CTX_PERS = v3(['residente', 'residentes', 'residenciado', 'residenciada', 'domiciliado', 'domiciliada', 'domiciliados', 'vecino', 'vecina', 'vecinos',
  'natural', 'naturales', 'nacido', 'nacida', 'oriundo', 'oriunda', 'radicado', 'radicada', 'reside', 'vive', 'vivía', 'habita', 'ubicado', 'ubicada',
  'expedida', 'expedido', 'con domicilio']);

function getPlaceRegexes(): PlaceRegexes {
  if (placeRx) return placeRx;
  const { munNames, depNames } = getIndex();
  const GAZ = alt(formasDeNombre(munNames).concat(formasDeNombre(depNames)));
  const MUN = alt(formasDeNombre(munNames));
  const DEP = alt(formasDeNombre(depNames));
  const DEPX = `(?<depx>${H}*\\(${H}*(?<dep1>${DEP})${H}*\\)|${H}*,${H}*(?<dep2>${DEP})(?!\\p{L})|${H}+-${H}+(?<dep3>${DEP})(?!\\p{L}))`;
  placeRx = {
    frag: { GAZ, MUN, DEP, DEPX },
    mun01: new RegExp(`(?<![\\p{L}\\p{N}])(?:(?<art>${alt(v3(['el', 'del', 'al', 'la', 'de la', 'a la']))})${H}+)?(?<noun>${alt(v3(['municipio', 'ciudad', 'población', 'poblacion']))})${H}+(?:de|DE)${H}+(?<mun>${GAZ})(?!\\p{L})${DEPX}?`, 'gdu'),
    mun02: new RegExp(`(?<![\\p{L}\\p{N}])(?<ctx>${alt(CTX_PERS)})${H}+(?:en|de|EN|DE)${H}+(?:(?:la${H}+ciudad|el${H}+municipio)${H}+de${H}+)?(?<mun>${GAZ})(?!\\p{L})(?!${H}+(?!${DEP}(?!\\p{L}))\\p{Lu}\\p{Ll})${DEPX}?`, 'gdu'),
    mun03Sep: new RegExp(`(?:${H}*,${H}*|${H}+(?:de|expedida${H}+en|expedido${H}+en)${H}+|${H}*-${H}*)(?<mun>${GAZ})(?!\\p{L})${DEPX}?`, 'dyu'),
    mun04: new RegExp(`(?<![\\p{L}\\p{N}])(?<mun>${MUN})(?!\\p{L})${DEPX}`, 'gdu'),
    mun05: new RegExp(`(?:(?<en>(?<![\\p{L}\\p{N}])(?:en|EN|En)${H}+)|(?<ini>(?:^|(?<=\\n))${H}*(?=${MUN}(?!\\p{L})${H}*,${H}*\\d{1,2}${H}+de${H}+\\p{L}+)))`
      + `(?<mun>${MUN})(?!\\p{L})(?!${H}+(?!${DEP}(?!\\p{L}))\\p{Lu}\\p{Ll})`, 'gdu'),
    // R-DESP-01 con el número del despacho de 1 a 3 cifras, con ceros a la izquierda («Juzgado 003 Civil Municipal»; D-03 D, 31-oct).
    // Cada separador del nombre es de blancos horizontales o de un salto de línea (\n o \r\n) con blancos alrededor, nunca dos
    // seguidos; `scanDespachos` descarta el nombre con más de un salto (integrador, 31-oct, PB-2-r4).
    desp: new RegExp(`(?<![\\p{L}\\p{N}])(?<head>${alt(DESP_HEAD)})(?!\\p{L})(?:${HD}(?:${alt(DESP_W)}|\\d{1,3}(?:\\.?[ºª]|o)?)(?!\\p{L})){0,12}?${HD}(?:de|del|De|Del|DE|DEL)${HD}(?<mun>${MUN})(?!\\p{L})`, 'gdu'),
    dep01: new RegExp(`(?<![\\p{L}\\p{N}])(?<lab>${alt(['departamento', 'Departamento', 'DEPARTAMENTO', 'depto.', 'Depto.', 'DEPTO.', 'dpto.', 'Dpto.', 'DPTO.'])})${H}+(?:(?:de|del|DE|DEL)${H}+)?(?<dep>${DEP})(?!\\p{L})`, 'gdu'),
  };
  return placeRx;
}

let despNombrePropioRx: RegExp | null = null;
/**
 * B-34 (PB-2-r5) · R-DESP-01 con cualquier palabra en el nombre del despacho («Notaría Ejemplo de Ubaté»). Solo se usa dentro de un
 * tramo ORG del modelo, que ya dice que es una organización, nunca en el barrido. Cada vuelta consume un separador y una palabra
 * de una sola manera, y la vuelta tiene tope (12), como en R-DESP-01. Se arma aparte y la primera vez que se pide.
 */
function getDespNombrePropio(): RegExp {
  despNombrePropioRx ??= new RegExp(`(?<![\\p{L}\\p{N}])(?<head>${alt(DESP_HEAD)})(?!\\p{L})(?:${HD}[\\p{L}\\p{N}]+(?:[.'’-][\\p{L}\\p{N}]+)*(?:\\.?[ºª])?(?![\\p{L}\\p{N}])){1,12}?${HD}(?:de|del|De|Del|DE|DEL)${HD}(?<mun>${getPlaceRegexes().frag.MUN})(?!\\p{L})`, 'gdu');
  return despNombrePropioRx;
}

const grp = (m: RegExpExecArray, name: string): [number, number] => {
  const g = (m.indices?.groups as Record<string, [number, number] | undefined> | undefined)?.[name];
  return g ?? [m.index, m.index + m[0].length];
};
const hasGrp = (m: RegExpExecArray, name: string): boolean => !!(m.indices?.groups as Record<string, unknown> | undefined)?.[name];
const endOf = (m: RegExpExecArray): number => m.index + m[0].length;
const depOf = (g: Record<string, string | undefined>): string | null => g['dep1'] ?? g['dep2'] ?? g['dep3'] ?? null;

/** Recorre todas las coincidencias de `re` (que debe tener la bandera `g`) y deja las que `accept` acepta. */
function scan<T>(re: RegExp, text: string, accept: (m: RegExpExecArray) => T | null): T[] {
  const out: T[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const r = accept(m);
    if (r) { out.push(r); re.lastIndex = Math.max(m.index + 1, m[0].length > 0 ? m.index + m[0].length : m.index + 1); }
    else re.lastIndex = m.index + 1;
    if (m[0].length === 0) re.lastIndex = m.index + 1;
  }
  return out;
}

export type Prioridad = 'recomendada' | 'opcional_ciudad_grande';
/** Resultado interno de un patrón de lugar, en posiciones de la vista. */
interface PlaceMatch {
  ruleId: string; start: number; end: number;
  type: 'MUNICIPIO' | 'DEPARTAMENTO';
  key: string; conf: Confidence;
  status: PlaceStatus | 'departamento';
  depCode: string; munCode?: string;
  placeOptions?: string[];
  prioridad: Prioridad;
  nombre: string;
}

function placeResult(ruleId: string, name: string, start: number, end: number, baseConf: Confidence,
  opts: { depHint?: string | null; allowAmbiguous?: boolean; docDeps: readonly string[] }): PlaceMatch | null {
  const r = resolvePlace(name, opts.depHint ?? null, opts.docDeps);
  if (r.status === 'no_encontrado') {
    const d = departamentoPorNombre(name);
    if (!d) return null;
    return { ruleId, start, end, type: 'DEPARTAMENTO', key: 'DEP:' + d, conf: baseConf, status: 'departamento', depCode: d, prioridad: 'recomendada', nombre: name };
  }
  if (r.status === 'ambiguo') {
    if (opts.allowAmbiguous === false) return null;
    return { ruleId, start, end, type: 'MUNICIPIO', key: 'LUGAR:' + vistaLista(name), conf: 'baja', status: 'ambiguo', depCode: '', placeOptions: r.deps, prioridad: 'recomendada', nombre: name };
  }
  const dep = r.deps[0] ?? '';
  const conf: Confidence = r.status === 'resuelto_por_documento' && baseConf === 'alta' ? 'media' : baseConf;
  return { ruleId, start, end, type: 'MUNICIPIO', key: 'DEP:' + dep, conf, status: r.status, depCode: dep, munCode: r.mun, prioridad: prioridadDe(r.mun), nombre: name };
}

export interface PlaceScanContext {
  /** Departamentos con evidencia en el documento (7.7.2): DEPARTAMENTO detectados y códigos DANE de radicados. */
  docDepCodes?: readonly string[];
  /** Finales canónicos de las detecciones `CC`, `TI`, `CE` y `DIRECCION`: anclas de R-MUN-03. */
  anchorEnds?: readonly number[];
}

function scanPlacesOnce(view: ViewLike, docDeps: readonly string[], anchorEnds: readonly number[]): PlaceMatch[] {
  const rx = getPlaceRegexes();
  const t = view.text;
  const out: PlaceMatch[] = [];
  // R-MUN-01
  out.push(...scan(rx.mun01, t, (m) => {
    const g = m.groups ?? {};
    return placeResult('R-MUN-01', g['mun'] ?? '', m.index, endOf(m), 'alta', { depHint: depOf(g), docDeps });
  }).filter((x): x is PlaceMatch => !!x));
  // R-MUN-02
  out.push(...scan(rx.mun02, t, (m) => {
    const [s] = grp(m, 'mun');
    return placeResult('R-MUN-02', m.groups?.['mun'] ?? '', s, endOf(m), 'alta', { depHint: depOf(m.groups ?? {}), docDeps });
  }));
  // R-MUN-03: ancla = final de una detección CC, TI, CE o DIRECCION
  for (const a of anchorEnds) {
    const rxs = rx.mun03Sep;
    rxs.lastIndex = viewIndexEndFor(view, a);
    const m = rxs.exec(t);
    if (!m || m.index !== rxs.lastIndex - m[0].length) continue;
    const [s] = grp(m, 'mun');
    const r = placeResult('R-MUN-03', m.groups?.['mun'] ?? '', s, endOf(m), 'alta', { depHint: depOf(m.groups ?? {}), docDeps });
    if (r) out.push(r);
  }
  // R-MUN-04
  out.push(...scan(rx.mun04, t, (m) => {
    const dep = depOf(m.groups ?? {});
    const r = resolvePlace(m.groups?.['mun'] ?? '', dep);
    if (r.status !== 'resuelto_por_depto') return null;
    return placeResult('R-MUN-04', m.groups?.['mun'] ?? '', m.index, endOf(m), 'alta', { depHint: dep, docDeps });
  }));
  // R-MUN-05
  out.push(...scan(rx.mun05, t, (m) => {
    const name = m.groups?.['mun'] ?? '';
    if (esAmbiguo(name)) return null;
    const [s, e] = grp(m, 'mun');
    return placeResult('R-MUN-05', name, s, e, 'media', { allowAmbiguous: false, docDeps });
  }));
  // R-DEP-01
  out.push(...scan(rx.dep01, t, (m) => {
    const [s, e] = grp(m, 'dep');
    const d = departamentoPorNombre(m.groups?.['dep'] ?? '');
    return d ? { ruleId: 'R-DEP-01', start: s, end: e, type: 'DEPARTAMENTO' as const, key: 'DEP:' + d, conf: 'alta' as Confidence, status: 'departamento' as const, depCode: d, prioridad: 'recomendada' as Prioridad, nombre: m.groups?.['dep'] ?? '' } : null;
  }));
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Dos pasadas: la segunda usa como evidencia los municipios únicos y los departamentos hallados en la primera (7.7.2). */
function scanPlaces(view: ViewLike, ctx: PlaceScanContext): PlaceMatch[] {
  const anchors = ctx.anchorEnds ?? [];
  const base = [...(ctx.docDepCodes ?? [])];
  const first = scanPlacesOnce(view, base, anchors);
  const evidencia = new Set(base);
  for (const h of first) if (h.status === 'unico' || h.status === 'departamento') evidencia.add(h.depCode);
  if (evidencia.size === base.length || !first.some((h) => h.status === 'ambiguo')) return first;
  return scanPlacesOnce(view, [...evidencia], anchors);
}

const SCORE: Record<Confidence, number> = { alta: 0.9, media: 0.6, baja: 0.3 };

/** Candidatos `MUNICIPIO` (resueltos o ambiguos con `placeOptions`) y `DEPARTAMENTO` de R-MUN-01 a R-MUN-05 y R-DEP-01, en posiciones canónicas. */
export function detectPlaces(partId: PartId, view: ViewLike, ctx: PlaceScanContext = {}): DetectionCandidate[] {
  return scanPlaces(view, ctx).map((h): DetectionCandidate => {
    const cand: DetectionCandidate = {
      partId, start: canonStart(view, h.start), end: canonEnd(view, h.end),
      type: h.type, source: 'regla', ruleId: h.ruleId, confidence: h.conf, score: SCORE[h.conf], canonicalKey: h.key,
    };
    if (h.placeOptions) cand.placeOptions = h.placeOptions;
    return cand;
  });
}

/** 7.7.5: un tramo `LOC` del modelo que coincide con la DIVIPOLA pasa por `resolvePlace`; si no, es `LUGAR` (devuelve null). */
export function candidateFromLoc(partId: PartId, text: string, start: number, end: number, docDepCodes: readonly string[] = []): DetectionCandidate | null {
  const name = text.slice(start, end);
  const h = placeResult('R-LOC-00', name, start, end, 'media', { docDeps: docDepCodes });
  if (!h) return null;
  const cand: DetectionCandidate = {
    partId, start, end, type: h.type, source: 'modelo', nerLabel: 'LOC', confidence: h.conf, score: SCORE[h.conf], canonicalKey: h.key,
  };
  if (h.placeOptions) cand.placeOptions = h.placeOptions;
  return cand;
}

/** Departamentos con evidencia por radicados: los dos primeros dígitos del código DANE de cinco dígitos de un `RADICADO` (7.7.2). */
export function departamentosDeRadicados(text: string, detections: readonly Pick<GenDetection, 'type' | 'start' | 'end'>[]): string[] {
  const out = new Set<string>();
  for (const d of detections) {
    if (d.type !== 'RADICADO') continue;
    const digits = text.slice(d.start, d.end).replace(/\D/g, '');
    if (digits.length < 5) continue;
    const row = DIVIPOLA.find((r) => r.mun === digits.slice(0, 5));
    if (row) out.add(row.dep);
  }
  return [...out];
}

// ===================================================================== despachos (R-DESP-01, E-DESP-01)

interface DespachoMatch {
  start: number; end: number;           // posiciones de la vista
  munStart: number;                     // inicio del nombre del municipio
  deps: string[]; munCode?: string; ambiguo: boolean;
  prioridad: Prioridad; generico: string;
}

/**
 * R-DESP-01 sobre la vista. Con `nombrePropio` (B-34) usa la forma que admite cualquier palabra en el nombre y exige que alguna
 * la cumpla. El genérico (o2) se arma solo con la cabeza y las palabras del vocabulario del despacho: el nombre propio no entra
 * («Notaría Ejemplo de Ubaté» → «una notaría»). En R-DESP-01 todas las palabras ya son del vocabulario, así que no cambia nada.
 */
function scanDespachos(view: ViewLike, docDeps: readonly string[], nombrePropio?: (palabra: string) => boolean): DespachoMatch[] {
  const re = nombrePropio === undefined ? getPlaceRegexes().desp : getDespNombrePropio();
  return scan(re, view.text, (m): DespachoMatch | null => {
    const [ms] = grp(m, 'mun');
    if ((m[0].match(SALTO) ?? []).length > 1) return null;   // un solo salto de línea en el nombre del despacho
    const r = resolvePlace(m.groups?.['mun'] ?? '', null, docDeps);
    if (r.status === 'no_encontrado') return null;
    const pre = view.text.slice(m.index, ms);
    const words = pre.trim().split(/\s+/).slice(0, -1).map((w) => w.toLowerCase());
    if (nombrePropio !== undefined && !words.slice(1).some((w) => nombrePropio(vistaLista(w)))) return null;
    const body = words.slice(1).filter((w) => !ORD_SET.has(vistaLista(w)) && !/^\d/.test(w) && VOCABULARIO_DESPACHO.palabras.has(vistaLista(w)));
    while (body.length && /^(de|del|y|para|la|las|los|el)$/.test(body[body.length - 1] ?? '')) body.pop();
    const head = words[0] ?? '';
    const generico = (FEM_HEAD.test(vistaLista(head)) ? 'una ' : 'un ') + [head, ...body].join(' ');
    return {
      start: m.index, end: endOf(m), munStart: ms, deps: r.deps, munCode: r.mun, ambiguo: r.status === 'ambiguo',
      prioridad: r.status === 'ambiguo' ? 'recomendada' : prioridadDe(r.mun), generico,
    };
  });
}

/** Sugerencia `DESPACHO_A_GENERICO` de un despacho hallado (G-04): una opción por departamento candidato y, al final, el genérico sin lugar. */
function sugerenciaDeDespacho(d: DespachoMatch, part: { id: PartId; text: string }, view: ViewLike): Omit<Suggestion, 'id'> {
  const cs = canonStart(view, d.start), ce = canonEnd(view, d.end);
  const pre = part.text.slice(cs, canonStart(view, d.munStart));
  const items: { kind: GeneralizationKind; template: string; depCode?: string }[] = d.deps.map((dep) => (
    { kind: 'DESPACHO_A_GENERICO', template: pre + (dep === '11' ? '{m}' : 'un municipio de {m}'), depCode: dep }));
  items.push({ kind: 'DESPACHO_A_GENERICO', template: d.generico });
  const options: SuggestionOption[] = items.map((o, i) => (o.depCode !== undefined
    ? { id: 'o' + (i + 1), kind: o.kind, template: o.template, depCode: o.depCode }
    : { id: 'o' + (i + 1), kind: o.kind, template: o.template }));
  return {
    kind: 'DESPACHO_A_GENERICO', target: { kind: 'tramo', span: { partId: part.id, start: cs, end: ce } },
    originalText: part.text.slice(cs, ce), options, prioridad: d.prioridad, status: 'pendiente',
  };
}

/**
 * R-DESP-01 sobre un tramo ORG del modelo (R-MOD-07): si el tramo [start, end) (posiciones canónicas de `part.text`) contiene
 * un despacho o autoridad con municipio de la DIVIPOLA («Juzgado Tercero Civil del Circuito de Bogotá», «Alcaldía Municipal de
 * Ubaté»), devuelve la sugerencia `DESPACHO_A_GENERICO` (con una opción por departamento candidato si el municipio es homónimo);
 * si no hay municipio, devuelve `null` y no se propone nada. El ORG deja de ser detección: quien llama lo descarta de las
 * detecciones antes de `generalize` y pasa aquí el resto en `ocupadas` (una sugerencia no se solapa con una detección).
 *
 * El tramo de la sugerencia es el despacho hallado (de la autoridad al municipio), que puede ser menor que el ORG. Si el ORG trae
 * más de un despacho, se toma el primero. `docDepCodes` desambigua homónimos como en `generalize`. Usa `ids.next('sug')`.
 *
 * Con `nombrePropio` (B-34, PB-2-r5) busca la autoridad nombrada con una palabra propia y con municipio («Notaría Ejemplo de
 * Ubaté»), que R-DESP-01 no alcanza: alguna palabra del nombre debe cumplir el predicado (sobre la vista `lista` de la palabra).
 * Las opciones son las de R-DESP-01: o1, el nombre con `un municipio de {m}`; o2, el genérico sin el nombre propio.
 */
export function despachoDesdeTramo(
  part: { id: PartId; text: string }, view: ViewLike | undefined, start: number, end: number, ids: IdSource,
  opciones: { docDepCodes?: readonly string[]; ocupadas?: readonly { start: number; end: number }[]; nombrePropio?: (palabra: string) => boolean } = {},
): Suggestion | null {
  const v: ViewLike = view ?? { text: part.text };
  const vs = viewIndexAtOrAfter(v, start), ve = viewIndexEndFor(v, end);
  if (ve <= vs) return null;
  const d = scanDespachos({ text: v.text.slice(vs, ve) }, opciones.docDepCodes ?? [], opciones.nombrePropio)[0];
  if (!d) return null;
  const rel: DespachoMatch = { ...d, start: d.start + vs, end: d.end + vs, munStart: d.munStart + vs };
  const sug = sugerenciaDeDespacho(rel, part, v);
  if (sug.target.kind !== 'tramo') return null;
  const { start: cs, end: ce } = sug.target.span;
  const libre = recortar(cs, ce, opciones.ocupadas ?? []);
  if (!libre || libre.start !== cs || libre.end !== ce) return null;
  return { ...sug, id: ids.next('sug') as SuggestionId };
}

/** E-DESP-01 (7.3.2): código de despacho de 12 dígitos rotulado; contiene el DANE del municipio. */
const E_DESP_01 = new RegExp(`${LB}(?:c[óo]digo[ ]+(?:del[ ]+)?despacho|despacho[ ]+(?:judicial[ ]+)?(?:c[óo]digo|no\\.?))[ ]*:?[ ]*(?<n>\\d{2}[ \\-]?\\d{3}[ \\-]?\\d{2}[ \\-]?\\d{2}[ \\-]?\\d{3})(?![\\p{L}\\p{N}])`, 'gdiu');

// ===================================================================== edad (R-EDAD-01) y fechas (7.5.5, 7.8.3)

export const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** Edad cumplida entre dos fechas ISO (7.8.3). El 29 de febrero se cumple el 1 de marzo en años no bisiestos. */
export function edadCumplida(nacimiento: IsoDate, referencia: IsoDate): number {
  const [by = 0, bm = 0, bd = 0] = nacimiento.split('-').map(Number);
  const [ry = 0, rm = 0, rd = 0] = referencia.split('-').map(Number);
  let a = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) a--;
  return a;
}
/** Rango por décadas (7.8.3). Edad no entera o negativa → null. */
export function rangoDeEdad(edad: number): string | null {
  if (!Number.isInteger(edad) || edad < 0) return null;
  if (edad < 10) return 'menos de 10 años';
  if (edad >= 90) return '90 años o más';
  const lo = Math.floor(edad / 10) * 10;
  return `entre ${lo} y ${lo + 10} años`;
}
const MESES_NOMBRE = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** «marzo de 2026» a partir de una clave `FECHA:2026-03-14`; null si la clave no es una fecha completa. */
export function mesYAnioDeClave(clave: string): string | null {
  const m = /^FECHA:(\d{4})-(\d{2})-(\d{2})$/.exec(clave);
  if (!m) return null;
  const mes = Number(m[2]);
  return mes >= 1 && mes <= 12 ? `${MESES_NOMBRE[mes]} de ${m[1]}` : null;
}

// Numerales para edades (0 a 120). Mientras no exista core/numerals.ts (PA-6) se usa este analizador mínimo.
const AGE_UNITS: Record<string, number> = { cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
const AGE_TEENS: Record<string, number> = {
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintiun: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const AGE_TENS: Record<string, number> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const AGE_WORDS_SRC = ['cero', 'un', 'uno', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece',
  'catorce', 'quince', 'dieciséis', 'dieciseis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintiuna', 'veintiún', 'veintiun',
  'veintidós', 'veintidos', 'veintitrés', 'veintitres', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintiseis', 'veintisiete', 'veintiocho',
  'veintinueve', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa', 'cien', 'ciento'];
/** Frase numeral en letras (0 a 120) → entero, o null. */
export function edadEnLetras(frase: string): number | null {
  const tk = vistaLista(frase).replace(/-/g, ' ').split(' ').filter((w) => w.length > 0);
  let i = 0, total = 0;
  const w = (): string | undefined => tk[i];
  if (w() === 'cien' || w() === 'ciento') { total = 100; i++; }
  const cur = w();
  if (cur !== undefined) {
    if (cur in AGE_TENS) {
      total += AGE_TENS[cur] ?? 0; i++;
      if (w() === 'y') { i++; const u = w(); if (u === undefined || !(u in AGE_UNITS) || u === 'cero') return null; total += AGE_UNITS[u] ?? 0; i++; }
    } else if (cur in AGE_TEENS) { total += AGE_TEENS[cur] ?? 0; i++; }
    else if (cur in AGE_UNITS) { if (cur === 'cero' && (total > 0 || tk.length > 1)) return null; total += AGE_UNITS[cur] ?? 0; i++; }
  } else if (total === 0) return null;
  if (i !== tk.length) return null;
  if (total === 100 && tk[0] === 'cien' && tk.length > 1) return null;
  return total <= 120 ? total : null;
}

interface EdadRx { re: RegExp }
let edadRx: EdadRx | null = null;
function getEdadRegex(): RegExp {
  if (edadRx) return edadRx.re;
  const NW = alt(AGE_WORDS_SRC) + '(?!\\p{L})';
  const NUMPH = `${NW}(?:${H}+(?:y${H}+)?${NW})*`;
  // M-14 (PB-2-r5): el contexto anterior es un lookbehind que se evalúa en cada posición; con `${H}+` sin tope era cuadrático en
  // una racha de blancos (la vista `reglas` colapsa los espacios, no los tabuladores: 20.000 tabuladores, 6,5 s). Con a lo sumo
  // 8 blancos por separador (H8) es lineal y el banco no cambia.
  edadRx = {
    re: new RegExp(
      `${LB}(?<!(?:m[aá]s|menos|mayor(?:es)?|menor(?:es)?|pena|condena|prisi[oó]n|t[eé]rmino|plazo|per[ií]odo|lapso|vigencia|duraci[oó]n|antig[uü]edad|experiencia|cerca|alrededor|hace|despu[eé]s|antes|dentro|unos|unas)${H8}(?:de${H8})?)`
      + `(?:(?<pre>de|con|tiene|ten[ií]a|cumpli[oó]|edad${H}*:|edad${H}+de)${H}+)?(?<n>\\d{1,3}|${NUMPH})(?:${H}*\\(${H}*(?<nd>\\d{1,3})${H}*\\))?${H}+`
      + `(?<u>a[ñn]os(?:${H}+de${H}+edad)?|a[ñn]o${H}+de${H}+edad|meses${H}+de${H}+edad)`
      + `(?!${H}+de${H}+(?:servicio|experiencia|prisi[oó]n|c[aá]rcel|pena|cotizaci[oó]n|antig[uü]edad|labor|trabajo|matrimonio|convivencia|vigencia|duraci[oó]n|casad[oa]s))(?!${H}+(?:atr[aá]s|despu[eé]s|antes))`,
      'gdiu'),
  };
  return edadRx.re;
}
interface EdadMatch { start: number; end: number; edad: number }
function scanEdades(t: string): EdadMatch[] {
  return scan(getEdadRegex(), t, (m): EdadMatch | null => {
    const g = m.groups ?? {};
    if (!g['pre'] && !/edad/i.test(g['u'] ?? '')) return null;
    let n = /^\d/.test(g['n'] ?? '') ? Number(g['n']) : (edadEnLetras(g['n'] ?? '') ?? NaN);
    if (g['nd'] && Number.isFinite(Number(g['nd']))) n = Number.isFinite(n) ? n : Number(g['nd']);
    if (!Number.isFinite(n) || n > 120) return null;
    const edad = /meses/i.test(g['u'] ?? '') ? 0 : n;
    let start = m.index;
    if (g['pre'] && !/^de$/i.test(g['pre'])) start = grp(m, 'n')[0];
    return { start, end: endOf(m), edad };
  });
}

/** Contexto de nacimiento (7.5.5): verbo («nació», «nacida») o rótulo («fecha de nacimiento», «F. nac.»). */
const C_NAC = new RegExp(`(?:naci[oó]|nacid[oa]|nacimiento|f\\.${H}*(?:de${H}*)?nac\\.?|fecha${H}+de${H}+nac\\.?|natalicio)(?:${H}+(?:el|en))?(?:${H}+d[ií]a)?${H}*:?${H}*$`, 'iu');
const PREFIJO_ROTULO_NAC = new RegExp(`(?:fecha${H}+de${H}+|f\\.${H}*(?:de${H}*)?)$`, 'iu');
const NAC_VERBO = /^naci[oó]|^nacid[oa]/iu;
const ARTICULO_ANTES = new RegExp(`(?<![\\p{L}\\p{N}])(?<art>desde${H}+el|hasta${H}+el|el${H}+d[ií]a|del|al|el)${H}+$`, 'iu');
const PREPOSICION_DE: Record<string, string> = { 'el': 'en ', 'el dia': 'en ', 'del': 'de ', 'al': 'a ', 'desde el': 'desde ', 'hasta el': 'hasta ' };

// ===================================================================== banderas (R-CAR-01, R-CIE-01, R-DIAG-01, R-LLA-01, R-MEN-01, R-CIT-01)

interface FlagRegexes { car: RegExp; cie: RegExp; diag: RegExp; lla: RegExp; men: RegExp; cargoClase: Map<string, 'privado' | 'publico'>; clin: RegExp; cieExcl: RegExp }
let flagRx: FlagRegexes | null = null;
const LOWERW = `(?!(?:que|el|la|los|las|y|o|en|por|con|a|al|del|de|se|su|sus|lo|le|desde|hasta|para|sin|como|cuando|un|una)(?!\\p{L}))\\p{Ll}[\\p{Ll}-]+`;

function getFlagRegexes(): FlagRegexes {
  if (flagRx) return flagRx;
  const cargoClase = new Map<string, 'privado' | 'publico'>();
  for (const c of cargosRaw.privados) cargoClase.set(vistaLista(c), 'privado');
  for (const c of cargosRaw.publicos) cargoClase.set(vistaLista(c), 'publico');
  const CARGOS = alt(v3([...cargosRaw.privados, ...cargosRaw.publicos]));
  const DIAGLIST = alt(diagnosticosRaw.terminos.flatMap((d) => [d, cap(d), d.toUpperCase()]));
  const llam = llamativosRaw.patrones.map(sub).join('|');
  const menExpr = menoresRaw.expresiones.map(sub).join('|');
  const menArt = menoresRaw.articulos.join('|');
  const menArt2 = menoresRaw.articulosMenor.join('|');
  const menNot = menoresRaw.menorNoEsPersona.map(sub).join('|');
  flagRx = {
    cargoClase,
    car: new RegExp(`(?<![\\p{L}\\p{N}])(?<art>${alt(v3(['el', 'la', 'del', 'al', 'su', 'como']))})${H}+(?<cargo>${CARGOS})(?!\\p{L})(?=${H}+(?:de${H}+la|del|de|DE${H}+LA|DEL|DE)${H}+(?:\\[|\\p{Lu}))`, 'gdu'),
    cie: new RegExp(`(?<![\\p{L}\\p{N}.-])(?<code>${cie10Raw.patron})(?![\\p{L}\\p{N}]|[.-]\\d)`, 'gdu'),
    diag: new RegExp(`(?<![\\p{L}\\p{N}])(?:(?<eh>${alt(v3(['enfermedad']))}${H}+(?:hu[ée]rfana|rara|ultra-?rara|de${H}+baja${H}+prevalencia|HU[ÉE]RFANA|RARA))`
      + `|(?<sd>${alt(v3(['síndrome', 'sindrome']))}${H}+(?:de|DE)${H}+(?:\\p{Lu}[\\p{L}'-]+(?:${H}*-${H}*\\p{Lu}[\\p{L}'-]+)?|${LOWERW}(?:${H}+${LOWERW}){0,2}))`
      + `|(?<dl>${DIAGLIST}))(?![\\p{L}\\p{N}])`, 'gdu'),
    lla: new RegExp(`(?<![\\p{L}\\p{N}])(?<w>${llam})(?![\\p{L}\\p{N}])`, 'gdiu'),
    men: new RegExp(`(?<![\\p{L}\\p{N}])(?:(?:(?<art>${menArt})${H}+)?(?<t>${menExpr})(?![\\p{L}\\p{N}])`
      + `|(?<art2>${menArt2})${H}+(?<t2>menor(?:es)?)(?!${H}+(?:${menNot})(?!\\p{L}))(?![\\p{L}\\p{N}]))`, 'gdiu'),
    clin: new RegExp(diagnosticosRaw.contextoClinico.map(sub).join('|'), 'iu'),
    cieExcl: new RegExp(`(?:${diagnosticosRaw.excluyenAntes.join('|')})[ \\t]*(?:No\\.?|N[º°]\\.?|#)?[ \\t]*$`, 'iu'),
  };
  return flagRx;
}

interface FlagHit {
  type: FlagType; reason: FlagReason; start: number; end: number;
  options: { kind: GeneralizationKind; template: string }[];
  /** Solo para el límite de una por oración (S-7.8). */
  limite?: 'MENOR' | 'HECHO_LLAMATIVO';
}

const CARGO_PREFIJO: Record<string, string> = { el: '', la: '', del: 'de ', al: 'a ', su: 'su ', como: 'como ' };
function scanBanderasDeTexto(view: ViewLike): FlagHit[] {
  const rx = getFlagRegexes();
  const t = view.text;
  const out: FlagHit[] = [];
  // R-CAR-01
  out.push(...scan(rx.car, t, (m): FlagHit | null => {
    const after = t.slice(endOf(m), endOf(m) + 30);
    if (new RegExp(`^[ \\t]+de[ \\t]+(?:${cargosRaw.excluidosTrasDe.map((x) => esc(x).replace(/ /g, '[ \\t]+')).join('|')})`, 'iu').test(after)) return null;
    const art = vistaLista(m.groups?.['art'] ?? '');
    const cargo = vistaLista(m.groups?.['cargo'] ?? '');
    const cls = rx.cargoClase.get(cargo) ?? 'privado';
    const primera = cargo.split(' ')[0] ?? '';
    const fem = art === 'la' || (/a$/.test(primera) && !/^(gerente|presidente|jefe|comandante|superintendente|representante)/.test(cargo));
    const masc = ['el', 'del', 'al'].includes(art) && !fem;
    const g = fem ? 'f' : masc ? 'm' : 'x';
    const pre = CARGO_PREFIJO[art] ?? '';
    const sinArticulo = art === 'su' || art === 'como';
    const N = cls === 'privado'
      ? { f: ['una directiva', 'una representante'], m: ['un directivo', 'un representante'], x: ['un directivo', 'una directiva'] }
      : { f: ['una funcionaria', 'una autoridad'], m: ['un funcionario', 'una autoridad'], x: ['un funcionario', 'una funcionaria'] };
    const options = N[g].map((o) => ({ kind: 'CARGO_A_GENERICO' as const, template: pre + (sinArticulo ? o.replace(/^una? /, '') : o) }));
    return { type: 'CARGO', reason: 'LISTA_CARGOS', start: m.index, end: endOf(m), options };
  }));
  // R-CIE-01
  out.push(...scan(rx.cie, t, (m): FlagHit | null => {
    const s = m.index, e = endOf(m);
    if (rx.cieExcl.test(t.slice(Math.max(0, s - 20), s))) return null;
    const win = t.slice(Math.max(0, s - cie10Raw.ventanaAntes), Math.min(t.length, e + cie10Raw.ventanaDespues));
    if (!rx.clin.test(win)) return null;
    return { type: 'DIAGNOSTICO', reason: 'PATRON_CIE10', start: s, end: e, options: [{ kind: 'DIAGNOSTICO_A_GENERICO', template: 'un diagnóstico médico' }] };
  }));
  // R-DIAG-01
  out.push(...scan(rx.diag, t, (m): FlagHit => ({
    type: 'DIAGNOSTICO', reason: 'LISTA_DIAGNOSTICOS', start: m.index, end: endOf(m),
    options: [{ kind: 'DIAGNOSTICO_A_GENERICO', template: 'una enfermedad de baja prevalencia' }],
  })));
  // R-LLA-01
  out.push(...scan(rx.lla, t, (m): FlagHit | null => {
    const w = vistaLista(m.groups?.['w'] ?? ''), s = m.index, e = endOf(m);
    const before = t.slice(Math.max(0, s - 30), s), after = t.slice(e, e + 120);
    if (/^noticia/.test(w) && /^[ \t]+criminal/i.test(after)) return null;
    if (/^incendio/.test(w) && /(?:contra|seguro[ \t]+de|p[oó]liza[ \t]+de|amparo[ \t]+de|riesgo[ \t]+de|cobertura[ \t]+de)[ \t]*$/iu.test(before)) return null;
    if (/^secuestr/.test(w) && (/(?:embargo[ \t]+y|diligencia[ \t]+de|orden[ \t]+de|medida[ \t]+de)[ \t]*$/iu.test(before)
      || /^[ \t]+del?[ \t]+(?:los[ \t]+|las[ \t]+)?(?:bien|bienes|inmueble|veh[ií]culo|muebles|establecimiento|cuotas)/iu.test(after))) return null;
    if (/^accidente/.test(w)) {
      const sent = after.split(/[.\n]/)[0] ?? '';
      if (!/fallec|muert|muri|v[ií]ctimas[ \t]+fatales|homicidio|deceso|sin[ \t]+vida/iu.test(sent)) return null;
    }
    if (w === 'prensa' && /^[ \t]+hidr[aá]ulica/iu.test(after)) return null;
    return { type: 'HECHO_LLAMATIVO', reason: 'LISTA_LLAMATIVOS', start: s, end: e, options: [], limite: 'HECHO_LLAMATIVO' };
  }));
  // R-MEN-01
  out.push(...scan(rx.men, t, (m): FlagHit | null => {
    const s = m.index, e = endOf(m);
    const sent = oracionEn(t, s, e);
    const tg = grp(m, hasGrp(m, 't') ? 't' : 't2');
    if (/ni[ñn]os,?[ \t]+ni[ñn]as,?[ \t]+y[ \t]+adolescentes|ni[ñn]as,?[ \t]+ni[ñn]os,?[ \t]+y[ \t]+adolescentes/iu.test(sent) && /ni[ñn]|adolesc/i.test(m[0])) return null;
    if (/responsabilidad[ \t]+penal[ \t]+(?:para|de)[ \t]+$/iu.test(t.slice(Math.max(0, s - 40), s))) return null;
    const tok = t.slice(tg[0], tg[1]);
    const ch = t.charAt(tg[0]);
    const sinArt = !m.groups?.['art'] && !m.groups?.['art2'];
    const inicio = /(^|[.\n:]\s*)$/.test(t.slice(Math.max(0, s - 3), s)) && sinArt;
    if (/^ni[ñn]/i.test(tok) && ch === ch.toUpperCase() && !inicio && tok !== tok.toUpperCase()) return null; // «Clínica del Niño»
    return { type: 'MENOR', reason: 'EXPRESION_MENOR', start: s, end: e, options: [{ kind: 'MENOR_A_GENERICO', template: 'una persona menor de edad' }], limite: 'MENOR' };
  }));
  return out;
}

function oracionEn(t: string, s: number, e: number): string {
  let a = s; while (a > 0 && !/[.\n;]/.test(t.charAt(a - 1))) a--;
  let b = e; while (b < t.length && !/[.\n;]/.test(t.charAt(b))) b++;
  return t.slice(a, b);
}
const inicioDeOracion = (t: string, pos: number): number => { let a = pos; while (a > 0 && !/[.\n;]/.test(t.charAt(a - 1))) a--; return a; };

// R-CIT-01 (función de contexto, 7.7.6): el criterio es el mismo de E-CITA-01 (`esContextoDeCita`, PA-7, 7.3.3): una sola fuente de verdad.
/** R-CIT-01: ¿el radicado en [s, e) del texto es una cita jurisprudencial y no el radicado del propio caso? */
export const isCitation: (t: string, s: number, e: number) => boolean = esContextoDeCita;

// ===================================================================== generalize (fase 2)

/** Detección ya fusionada, tal como la necesita `generalize` (un subconjunto de `Detection`/`MergedCandidate`, en posiciones canónicas). */
export interface GenDetection {
  /** Obligatorio para los tipos que se enlazan (TI, CE, PPT, PEP, DOCUMENTO, RADICADO, FECHA); los candidatos MUNICIPIO aún no lo tienen. */
  id?: DetectionId;
  start: number; end: number;
  type: DataType;
  canonicalKey: string;
  context?: DetectionCandidate['context'];
  label?: LabelHit;
  /** MUNICIPIO homónimo sin resolver: códigos de departamento candidatos. */
  placeOptions?: string[];
}

export interface GeneralizeInput {
  part: { id: PartId; text: string };
  /** Vista `reglas` de la parte con su mapa; sin ella se usa el texto canónico. */
  view?: ViewLike;
  /** Detecciones fusionadas de la parte (los MUNICIPIO ya resueltos incluidos: se convierten en sugerencias). */
  detections: readonly GenDetection[];
  options: { referenceDate: IsoDate; documentDate?: IsoDate };
  docDepCodes?: readonly string[];
  ids: IdSource;
}
export interface GeneralizeResult {
  suggestions: Suggestion[];
  flags: Flag[];
  /** Sugerencias o banderas que quedaron sin tramo libre tras recortar contra las detecciones. */
  descartadasPorSolape: number;
}

interface FlagPendiente extends FlagHit { relatedDetectionId?: DetectionId; suggestionIdRef?: Suggestion }
interface Libre { start: number; end: number }
/** Recorta [s, e) para que no se solape con las detecciones. Un tramo contenido en una detección se descarta; si una detección cae dentro, se queda el mayor lado. */
function recortar(s: number, e: number, dets: readonly Libre[], conservarContenidas: ReadonlySet<Libre> = new Set()): Libre | null {
  let a = s, b = e;
  for (let guard = 0; guard < 64; guard++) {
    let tocado = false;
    for (const d of dets) {
      if (conservarContenidas.has(d)) continue;
      if (d.end <= a || d.start >= b) continue;
      tocado = true;
      if (d.start <= a && d.end >= b) return null;
      if (d.start <= a) a = d.end;
      else if (d.end >= b) b = d.start;
      else if (d.start - a >= b - d.end) b = d.start;
      else a = d.end;
    }
    if (!tocado) break;
  }
  return b > a ? { start: a, end: b } : null;
}

export function generalize(input: GeneralizeInput): GeneralizeResult {
  const { part, ids } = input;
  const view: ViewLike = input.view ?? { text: part.text };
  const vt = view.text;
  const dets = input.detections;
  const suggestions: Suggestion[] = [];
  const flags: Flag[] = [];
  let descartadas = 0;

  const ocupadas: Libre[] = dets.filter((d) => d.type !== 'MUNICIPIO').map((d) => ({ start: d.start, end: d.end }));
  const spanOf = (start: number, end: number): Span => ({ partId: part.id, start, end });
  const nuevoSug = (s: Omit<Suggestion, 'id'>): Suggestion => { const x = { ...s, id: ids.next('sug') as SuggestionId }; suggestions.push(x); return x; };
  const opciones = (items: { kind: GeneralizationKind; template: string; depCode?: string }[]): SuggestionOption[] =>
    items.map((o, i) => (o.depCode !== undefined ? { id: 'o' + (i + 1), kind: o.kind, template: o.template, depCode: o.depCode } : { id: 'o' + (i + 1), kind: o.kind, template: o.template }));
  const referenciaEdad = input.options.documentDate ?? input.options.referenceDate;
  const docDeps = [...new Set([...(input.docDepCodes ?? []), ...departamentosDeRadicados(part.text, dets)])];

  // ---- G-04 despachos y autoridades (R-DESP-01) y código de despacho (E-DESP-01)
  const despachos = scanDespachos(view, docDeps);
  const tramosDespacho: Libre[] = [];
  for (const d of despachos) {
    const cs = canonStart(view, d.start), ce = canonEnd(view, d.end);
    const libre = recortar(cs, ce, ocupadas);
    if (!libre || libre.start !== cs || libre.end !== ce) { descartadas++; continue; }
    tramosDespacho.push({ start: cs, end: ce });
    nuevoSug(sugerenciaDeDespacho(d, part, view));
  }
  for (const m of scan(E_DESP_01, vt, (x) => x)) {
    const digits = (m.groups?.['n'] ?? '').replace(/\D/g, '');
    const row = DIVIPOLA.find((r) => r.mun === digits.slice(0, 5));
    if (!row) continue;
    const cs = canonStart(view, m.index), ce = canonEnd(view, endOf(m));
    const libre = recortar(cs, ce, ocupadas);
    if (!libre || libre.start !== cs || libre.end !== ce) { descartadas++; continue; }
    tramosDespacho.push({ start: cs, end: ce });
    nuevoSug({
      kind: 'DESPACHO_A_GENERICO', target: { kind: 'tramo', span: spanOf(cs, ce) }, originalText: part.text.slice(cs, ce),
      options: opciones([
        { kind: 'DESPACHO_A_GENERICO', template: 'un despacho judicial de ' + (row.dep === '11' ? '{m}' : 'un municipio de {m}'), depCode: row.dep },
        { kind: 'DESPACHO_A_GENERICO', template: 'un despacho judicial' },
      ]),
      prioridad: row.capital ? 'opcional_ciudad_grande' : 'recomendada', status: 'pendiente',
    });
  }

  // ---- G-01 y G-03: municipios fusionados → MUNICIPIO_A_DEPARTAMENTO
  const hitsPorSpan = new Map<string, PlaceMatch>();
  const munDets = dets.filter((d) => d.type === 'MUNICIPIO');
  if (munDets.length) {
    for (const h of scanPlaces(view, { docDepCodes: docDeps })) {
      if (h.type !== 'MUNICIPIO') continue;
      hitsPorSpan.set(`${canonStart(view, h.start)}:${canonEnd(view, h.end)}`, h);
    }
  }
  const mantener = new Set<Libre>();
  const aceptadosMun: Libre[] = [];
  for (const md of [...munDets].sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (aceptadosMun.some((x) => md.start < x.end && md.end > x.start)) continue; // dos candidatos sobre el mismo texto: queda el primero y más largo
    if (tramosDespacho.some((t) => md.start < t.end && md.end > t.start)) continue; // ya lo cubre la sugerencia del despacho (7.7.5)
    const libre = recortar(md.start, md.end, ocupadas, mantener);
    if (!libre) { descartadas++; continue; }
    let h = hitsPorSpan.get(`${md.start}:${md.end}`);
    if (!h) {
      const nombre = part.text.slice(md.start, md.end);
      const r = placeResult('R-LOC-00', nombre, md.start, md.end, 'media', { docDeps });
      if (!r || r.type !== 'MUNICIPIO') continue;
      h = r;
    }
    aceptadosMun.push({ start: libre.start, end: libre.end });
    const tramoTexto = part.text.slice(libre.start, libre.end);
    const prefijo = /^(?:del|de la)(?![\p{L}\p{N}])/iu.test(tramoTexto) ? 'de ' : /^(?:al|a la)(?![\p{L}\p{N}])/iu.test(tramoTexto) ? 'a ' : '';
    const deps = h.status === 'ambiguo' ? (md.placeOptions ?? h.placeOptions ?? []) : [h.depCode];
    const plantilla = (dep: string | undefined): string => (dep === '11' ? prefijo + '{m}' : prefijo + 'un municipio de {m}');
    const base = { kind: 'MUNICIPIO_A_DEPARTAMENTO' as const, target: { kind: 'tramo' as const, span: spanOf(libre.start, libre.end) }, originalText: tramoTexto, prioridad: h.prioridad, status: 'pendiente' as const };
    if (h.status === 'ambiguo') {
      nuevoSug({ ...base, options: opciones([{ kind: 'MUNICIPIO_A_DEPARTAMENTO', template: prefijo + 'un municipio de {m}' }]), placeOptions: [...deps], prioridad: 'recomendada' });
    } else {
      nuevoSug({ ...base, options: opciones([{ kind: 'MUNICIPIO_A_DEPARTAMENTO', template: plantilla(h.depCode), depCode: h.depCode }]) });
    }
  }

  // ---- G-05 y G-07: fechas
  const flagsPendientes: FlagPendiente[] = [];
  for (const d of dets) {
    if (d.type !== 'FECHA') continue;
    if (d.context === 'nacimiento') {
      const iso = /^FECHA:(\d{4}-\d{2}-\d{2})$/.exec(d.canonicalKey)?.[1];
      if (!iso) continue;
      const vs = viewIndexAtOrAfter(view, d.start);
      const ventana = vt.slice(Math.max(0, vs - 40), vs);
      const nm = C_NAC.exec(ventana);
      if (!nm) continue;
      let etiquetaVista = Math.max(0, vs - 40) + nm.index;
      // «Fecha de nacimiento»: el patrón puede arrancar en «nacimiento»; el rótulo completo incluye «Fecha de» o «F. de».
      const prefijo = PREFIJO_ROTULO_NAC.exec(vt.slice(Math.max(0, etiquetaVista - 12), etiquetaVista));
      if (prefijo) etiquetaVista -= prefijo[0].length;
      const edad = edadCumplida(iso, referenciaEdad);
      if (edad < 0 || edad > 120) continue;
      const rango = rangoDeEdad(edad);
      if (!rango) continue;
      const verbo = NAC_VERBO.test(nm[0]);
      const cs = canonStart(view, etiquetaVista);
      const contenidas = new Set<Libre>();
      const propia = ocupadas.find((o) => o.start === d.start && o.end === d.end);
      if (propia) contenidas.add(propia);
      const libre = recortar(cs, d.end, ocupadas, contenidas);
      if (!libre || libre.start !== cs) { descartadas++; continue; }
      const adulto = edad >= 18;
      const opts = verbo
        ? [{ kind: 'FECHA_NACIMIENTO_A_RANGO_EDAD' as const, template: 'de ' + rango }, { kind: 'FECHA_NACIMIENTO_A_RANGO_EDAD' as const, template: adulto ? 'mayor de edad' : 'menor de edad' }]
        : [{ kind: 'FECHA_NACIMIENTO_A_RANGO_EDAD' as const, template: 'edad aproximada: ' + rango }, { kind: 'FECHA_NACIMIENTO_A_RANGO_EDAD' as const, template: adulto ? 'mayor de edad' : 'menor de edad' }];
      const sug = nuevoSug({
        kind: 'FECHA_NACIMIENTO_A_RANGO_EDAD',
        target: d.id ? { kind: 'tramo', span: spanOf(libre.start, libre.end), relatedDetectionId: d.id } : { kind: 'tramo', span: spanOf(libre.start, libre.end) },
        originalText: part.text.slice(libre.start, libre.end), options: opciones(opts), status: 'pendiente',
      });
      void sug;
      if (!adulto) {
        // La bandera MENOR cubre el verbo o el rótulo de nacimiento (la fecha ya es una detección y no se solapa).
        const fin = canonStart(view, vs);
        const etiqueta = recortar(cs, fin, ocupadas);
        if (etiqueta) {
          const txt = part.text.slice(etiqueta.start, etiqueta.end);
          const recorte = txt.length - txt.replace(/[\s:]+$/u, '').length;
          if (etiqueta.end - recorte > etiqueta.start) {
            flagsPendientes.push({ type: 'MENOR', reason: 'EXPRESION_MENOR', start: etiqueta.start, end: etiqueta.end - recorte, options: [{ kind: 'MENOR_A_GENERICO', template: 'una persona menor de edad' }], limite: 'MENOR' });
          }
        }
      }
    } else if (d.context === 'hecho') {
      const mes = mesYAnioDeClave(d.canonicalKey);
      if (!mes || !d.id) continue;
      const vs = viewIndexAtOrAfter(view, d.start);
      const am = ARTICULO_ANTES.exec(vt.slice(Math.max(0, vs - 20), vs));
      if (!am) {
        suggestions.push({
          id: ids.next('sug') as SuggestionId, kind: 'FECHA_A_MES_ANIO', target: { kind: 'deteccion', detectionId: d.id },
          originalText: part.text.slice(d.start, d.end), options: opciones([{ kind: 'FECHA_A_MES_ANIO', template: mes }]), status: 'pendiente',
        });
        continue;
      }
      const artVista = Math.max(0, vs - 20) + am.index;
      const cs = canonStart(view, artVista);
      const artKey = vistaLista(am.groups?.['art'] ?? '');
      let prefijo = PREPOSICION_DE[artKey] ?? '';
      if (/^\p{Lu}/u.test(am[0])) prefijo = cap(prefijo);
      const contenidas = new Set<Libre>();
      const propia = ocupadas.find((o) => o.start === d.start && o.end === d.end);
      if (propia) contenidas.add(propia);
      const libre = recortar(cs, d.end, ocupadas, contenidas);
      if (!libre || libre.start !== cs) { descartadas++; continue; }
      nuevoSug({
        kind: 'FECHA_A_MES_ANIO', target: { kind: 'tramo', span: spanOf(libre.start, libre.end), relatedDetectionId: d.id },
        originalText: part.text.slice(libre.start, libre.end), options: opciones([{ kind: 'FECHA_A_MES_ANIO', template: prefijo + mes }]), status: 'pendiente',
      });
    }
  }

  // ---- G-06: edad explícita → rango (y bandera MENOR si es menor de 18)
  for (const e of scanEdades(vt)) {
    const cs = canonStart(view, e.start), ce = canonEnd(view, e.end);
    const libre = recortar(cs, ce, ocupadas);
    if (!libre) { descartadas++; continue; }
    const rango = rangoDeEdad(e.edad);
    if (!rango) continue;
    const tramo = part.text.slice(libre.start, libre.end);
    const conDe = /^de(?![\p{L}\p{N}])/iu.test(tramo);
    nuevoSug({
      kind: 'EDAD_A_RANGO', target: { kind: 'tramo', span: spanOf(libre.start, libre.end) }, originalText: tramo,
      options: opciones([{ kind: 'EDAD_A_RANGO', template: conDe ? 'de ' + rango : rango }]), status: 'pendiente',
    });
    if (e.edad < 18) {
      flagsPendientes.push({ type: 'MENOR', reason: 'EXPRESION_MENOR', start: libre.start, end: libre.end, options: [{ kind: 'MENOR_A_GENERICO', template: 'una persona menor de edad' }], limite: 'MENOR' });
    }
  }

  // ---- G-09: rótulo que revela condición (preaplicada) y bandera MENOR del rótulo (ROTULO_TI)
  const ROTULOS_GENERICOS = new Set<DataType>(['TI', 'CE', 'PPT', 'PEP']);
  const rotulosMenor = new Set(menoresRaw.rotulosQueRevelanMenor);
  for (const d of dets) {
    if (!d.label) continue;
    const esDocumentoNeutro = ROTULOS_GENERICOS.has(d.type);
    const esRegistroCivil = d.type === 'DOCUMENTO' && d.label.labelId === 'ROT-RC';
    if (!esDocumentoNeutro && !esRegistroCivil) continue;
    const libre = recortar(d.label.start, d.label.end, ocupadas);
    if (!libre || libre.start !== d.label.start || libre.end !== d.label.end) { descartadas++; continue; }
    let sugRef: Suggestion | undefined;
    const opcRotulo = opciones([{ kind: 'ROTULO_DOCUMENTO_A_GENERICO', template: 'documento de identidad' }]);
    if (esDocumentoNeutro) {
      sugRef = nuevoSug({
        kind: 'ROTULO_DOCUMENTO_A_GENERICO',
        target: d.id ? { kind: 'tramo', span: spanOf(libre.start, libre.end), relatedDetectionId: d.id } : { kind: 'tramo', span: spanOf(libre.start, libre.end) },
        originalText: part.text.slice(libre.start, libre.end), options: opcRotulo, status: 'aplicada', chosenOptionId: 'o1',
      });
    }
    if (rotulosMenor.has(d.label.labelId)) {
      const fh: FlagPendiente = {
        type: 'MENOR', reason: 'ROTULO_TI', start: libre.start, end: libre.end,
        options: [{ kind: 'ROTULO_DOCUMENTO_A_GENERICO', template: 'documento de identidad' }],
      };
      if (d.id) fh.relatedDetectionId = d.id;
      if (sugRef) fh.suggestionIdRef = sugRef;
      flagsPendientes.push(fh);
    }
  }

  // ---- G-08, G-10, G-11, G-12: banderas de texto (R-CAR-01, R-CIE-01, R-DIAG-01, R-LLA-01, R-MEN-01)
  const deTexto: FlagPendiente[] = scanBanderasDeTexto(view).map((h) => ({ ...h, start: canonStart(view, h.start), end: canonEnd(view, h.end) }));
  const todas: FlagPendiente[] = [...flagsPendientes, ...deTexto];

  // ---- G-13: cita jurisprudencial
  for (const d of dets) {
    if (d.type !== 'RADICADO') continue;
    const vs = viewIndexAtOrAfter(view, d.start), ve = viewIndexEndFor(view, d.end);
    if (!isCitation(vt, vs, ve)) continue;
    const fh: FlagPendiente = { type: 'CITA_JURISPRUDENCIAL', reason: 'RADICADO_EN_CITA', start: d.start, end: d.end, options: [] };
    if (d.id) fh.relatedDetectionId = d.id;
    todas.push(fh);
  }

  todas.sort((a, b) => a.start - b.start || a.end - b.end);
  const oracionesUsadas = new Set<string>();
  const vistos = new Set<string>();
  for (const f of todas) {
    let s = f.start, e = f.end;
    const vinculada = f.reason === 'RADICADO_EN_CITA';
    if (!vinculada && f.reason !== 'ROTULO_TI') {
      const libre = recortar(s, e, ocupadas);
      if (!libre) { descartadas++; continue; }
      s = libre.start; e = libre.end;
      const sinEspacios = part.text.slice(s, e);
      const lead = sinEspacios.length - sinEspacios.trimStart().length;
      const trail = sinEspacios.length - sinEspacios.trimEnd().length;
      s += lead; e -= trail;
      if (e <= s) { descartadas++; continue; }
    }
    if (f.limite) {
      const clave = f.limite + ':' + inicioDeOracion(part.text, s);
      if (oracionesUsadas.has(clave)) continue;
      oracionesUsadas.add(clave);
    }
    const dup = `${f.type}:${f.reason}:${s}:${e}`;
    if (vistos.has(dup)) continue;
    vistos.add(dup);
    const flag: Flag = {
      id: ids.next('flg') as FlagId, type: f.type, span: spanOf(s, e), text: part.text.slice(s, e), reason: f.reason,
      options: opciones(f.options), acknowledged: false,
    };
    if (f.relatedDetectionId) flag.detectionId = f.relatedDetectionId;
    if (f.suggestionIdRef) flag.suggestionId = f.suggestionIdRef.id;
    flags.push(flag);
  }

  const posSug = (s: Suggestion): number => (s.target.kind === 'tramo' ? s.target.span.start : (dets.find((d) => d.id === (s.target as { detectionId: DetectionId }).detectionId)?.start ?? 0));
  suggestions.sort((a, b) => posSug(a) - posSug(b));
  return { suggestions, flags, descartadasPorSolape: descartadas };
}

export type { Suggestion, Flag, SuggestionKind };
