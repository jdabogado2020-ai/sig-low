// Reinserción (plan 6.10 y 7.14, PB-5): reconoce los marcadores de la respuesta de la IA, los clasifica (exacto, alterado,
// desconocido), calcula los faltantes y construye el texto con los datos reales. Código puro de core/: sin DOM ni red.
// Privacidad: `MappingTable` y `ReinsertionResult.text` viven solo en memoria [M]; este módulo no registra ni guarda nada
// y nunca lanza con el contenido: las entradas inválidas producen un resultado vacío o conservador, no un mensaje.
import { cryptoIds } from './entities.ts';
import { buildSearchView } from './normalize.ts';
import { MARKER_FAMILIES, MARKER_LABEL } from './types.ts';
import type {
  AlterationKind, BuildReinsertionFn, FindMarkersFn, IdSource, MappingTable, MarkerFamily, MarkerMatch, MarkerMatchKind,
  ReinsertMatchId, ReinsertionDecision, ReinsertionInput, ReinsertionResult, SearchView,
} from './types.ts';

// ---------------------------------------------------------------------------------------------
// 7.14.1 · Expresiones (R-REI-01 a R-REI-03)
// ---------------------------------------------------------------------------------------------

/** Las 33 etiquetas de `MARKER_LABEL` (tildes del protocolo, NFC). */
const LABELS: readonly string[] = MARKER_FAMILIES.map((f) => MARKER_LABEL[f]);
const CORTAS: ReadonlySet<string> = new Set(['CC', 'TI', 'CE', 'PPT', 'PEP', 'NIT', 'TP', 'HC', 'EPS', 'IPS']);
const PROSA_EXCLUIDAS: ReadonlySet<string> = new Set([...CORTAS, 'DOCUMENTO']);
const ROLES_MINUSCULA: ReadonlySet<string> = new Set(['DEMANDANTE', 'DEMANDADO', 'TESTIGO', 'PACIENTE', 'CLIENTE', 'CONTACTO']);
const ORDEN_ALT: readonly AlterationKind[] = ['delimitador', 'sin_delimitador', 'separador', 'mayusculas_minusculas', 'sin_tilde', 'espacios', 'sufijo_pegado'];
const MASK = '\uE000';   // U+E000: no es letra, dígito ni espacio (7.14.1, paso 2)

const tol = (l: string): string => l.replace('Ó', '[OÓ]').replace('É', '[EÉ]').replace('Í', '[IÍ]');
const ETIQUETAS_TOL = [...LABELS].sort((a, b) => b.length - a.length).map(tol).join('|');
const NUM = String.raw`n\.? ?º|n[oº]\.?|nro\.?|n[uú]m(?:ero|\.)?|#`;

/** R-REI-01 · marcador exacto (+ sufijo pegado). Sensible a mayúsculas. */
const RE_EXACTA = String.raw`\[(` + LABELS.join('|') + String.raw`)_([1-9][0-9]{0,3})\]((?:'s|s|es)(?![\p{L}\p{N}]))?`;
/** R-REI-02 · corchetes con etiqueta desconocida o número no válido. */
const RE_GENERICA = String.raw`\[[ \t]{0,2}(\p{L}{2,20}(?:_\p{L}{2,20}){0,2})[ \t]{0,2}[_ \-][ \t]{0,2}([0-9]{1,5})[ \t]{0,2}\]`;
/** R-REI-03 · marcador alterado con etiqueta conocida. */
const RE_TOLERANTE = String.raw`(?:([\[\(\{«<])[ \t]{0,2})?(?<![\p{L}\p{N}_])(` + ETIQUETAS_TOL
  + String.raw`)(E?S)?([ \t]{0,2}(?:_|-|\.|` + NUM + String.raw`)[ \t]{0,2}|[ \t]{1,2}|)([1-9][0-9]{0,3})(?:([ \t]{0,2})([\]\)\}»>]))?('s|s)?(?![\p{L}\p{N}]|[.,]\d)`;

/** Mayúsculas sin tildes, para comparar etiquetas («Dirección» ≡ «DIRECCION»). */
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
const LABEL_BY_FOLD: ReadonlyMap<string, string> = new Map(LABELS.map((l) => [fold(l), l]));
const FAMILY_BY_LABEL: ReadonlyMap<string, MarkerFamily> = new Map(MARKER_FAMILIES.map((f) => [MARKER_LABEL[f], f]));
/** Etiqueta del protocolo (con tilde) de un texto cualquiera, o undefined si no es una de las 33. */
const labelOf = (found: string): string | undefined => LABEL_BY_FOLD.get(fold(found));
const hasEntry = (table: MappingTable, key: string): boolean => Object.hasOwn(table.entries, key);

// ---------------------------------------------------------------------------------------------
// Vista de búsqueda de la reinserción
// ---------------------------------------------------------------------------------------------

/**
 * Vista `reglas` (6.1.2) con los escapes de Markdown `\[`, `\]` y `\_` omitidos: la barra desaparece de la vista y la posición
 * de inicio del carácter siguiente pasa a la barra, así que el tramo canónico la incluye y el reemplazo no deja una barra suelta.
 */
function viewRei(text: string): SearchView {
  const v = buildSearchView(text, 'reglas', 'cuerpo');
  const n = v.text.length;
  const out: string[] = [];
  const sm: number[] = [];
  const em: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = v.text[i] as string;
    const next = v.text[i + 1];
    if (c === '\\' && next !== undefined && (next === '[' || next === ']' || next === '_')) {
      out.push(next);
      sm.push(v.startMap[i] as number);
      em.push(v.endMap[i + 1] as number);
      i++;
      continue;
    }
    out.push(c);
    sm.push(v.startMap[i] as number);
    em.push(v.endMap[i] as number);
  }
  sm.push(v.startMap[n] as number);
  return { profile: 'reglas', text: out.join(''), startMap: Uint32Array.from(sm), endMap: Uint32Array.from(em) };
}

const sortAlt = (alts: readonly AlterationKind[]): AlterationKind[] =>
  [...new Set(alts)].sort((x, y) => ORDEN_ALT.indexOf(x) - ORDEN_ALT.indexOf(y));

/** Un escape de Markdown suma `delimitador` (por `\[` o `\]`) y `separador` (por `\_`). */
function escapeAlts(found: string): AlterationKind[] {
  const a: AlterationKind[] = [];
  if (/\\[[\]]/u.test(found)) a.push('delimitador');
  if (/\\_/u.test(found)) a.push('separador');
  return a;
}

interface Info {
  kind: MarkerMatchKind;
  alterations: AlterationKind[];
  inTable: boolean;
  canonical?: string;
  label?: string;
  n?: number;
}

// ---------------------------------------------------------------------------------------------
// findMarkers
// ---------------------------------------------------------------------------------------------

/**
 * Como `findMarkers`, con la fuente de ids explícita (las pruebas pasan una determinista; los ids no derivan del contenido).
 * Las posiciones son las del texto canónico de `input.response`, ordenadas por inicio y sin solapes.
 */
export function findMarkersWith(input: ReinsertionInput, ids: IdSource): MarkerMatch[] {
  const response = input.response;
  const table = input.table;
  const v = viewRei(response);
  let text = v.text;
  const found: Array<{ start: number; end: number; info: Info }> = [];

  const take = (ns: number, ne: number, info: Info): void => {
    const start = v.startMap[ns] as number;
    const end = v.endMap[ne - 1] as number;
    const esc = escapeAlts(response.slice(start, end));
    let { kind, alterations } = info;
    if (esc.length > 0) {
      alterations = sortAlt([...alterations, ...esc]);
      if (kind === 'exacto') kind = 'alterado';
    }
    found.push({ start, end, info: { ...info, kind, alterations } });
    text = text.slice(0, ns) + MASK.repeat(ne - ns) + text.slice(ne);
  };

  // R-REI-01 · exacto (sensible a mayúsculas) + sufijo pegado
  for (const m of [...text.matchAll(new RegExp(RE_EXACTA, 'gu'))]) {
    const canonical = `[${m[1] as string}_${m[2] as string}]`;
    const inTable = hasEntry(table, canonical);
    const suf = m[3] !== undefined;
    take(m.index, m.index + m[0].length, {
      kind: inTable ? (suf ? 'alterado' : 'exacto') : 'desconocido',
      alterations: suf ? ['sufijo_pegado'] : [], inTable, canonical, label: m[1] as string, n: Number(m[2]),
    });
  }

  // R-REI-02 · corchetes con etiqueta desconocida o número no válido
  for (const m of [...text.matchAll(new RegExp(RE_GENERICA, 'gu'))]) {
    const raw = m[1] as string;
    const lab = labelOf(raw) ?? labelOf(raw.replace(/ES$/iu, '')) ?? labelOf(raw.replace(/S$/iu, ''));
    const nOk = /^[1-9][0-9]{0,3}$/u.test(m[2] as string);
    if (lab !== undefined && nOk) continue;   // se deja para R-REI-03
    const info: Info = { kind: 'desconocido', alterations: [], inTable: false };
    if (lab !== undefined) info.label = lab;
    take(m.index, m.index + m[0].length, info);
  }

  // R-REI-03 · tolerante con etiquetas conocidas
  for (const m of [...text.matchAll(new RegExp(RE_TOLERANTE, 'giu'))]) {
    const all = m[0];
    const open = m[1];
    const labTxt = m[2] as string;
    const plural = m[3];
    const sepRaw = m[4] ?? '';
    const num = m[5] as string;
    const spBefore = m[6];
    const close = m[7];
    const suf = m[8];
    const lab = labelOf(labTxt);
    if (lab === undefined) continue;
    const hasDelim = (open !== undefined && close !== undefined) || open === '[' || close === ']';   // un delimitador suelto solo cuenta si es corchete
    const sepTrim = sepRaw.trim();
    const prose = !hasDelim && sepTrim !== '_';
    if (prose && PROSA_EXCLUIDAS.has(lab)) continue;                                // «CC 1», «Documento 1»
    if (prose && plural !== undefined && plural !== '') continue;                   // «los demandantes 1 y 2»
    if (prose && sepTrim === '.') continue;                                         // «demandante. 1)»
    if (prose && !ROLES_MINUSCULA.has(lab) && !/^\p{Lu}/u.test(labTxt)) continue;  // «el valor 1»
    if (!hasDelim && suf?.toLowerCase() === 's') continue;                                        // «demandante 1s»
    const alt: AlterationKind[] = [];
    if ((open !== undefined || close !== undefined) && !(open === '[' && close === ']')) alt.push('delimitador');
    if (open === undefined && close === undefined) alt.push('sin_delimitador');
    if (sepTrim !== '_') alt.push('separador');
    if (labTxt !== labTxt.toUpperCase()) alt.push('mayusculas_minusculas');
    if (labTxt.toUpperCase() !== lab) alt.push('sin_tilde');
    const innerSpaces = (open !== undefined && /^[[({«<][ \t]/u.test(all)) || (close !== undefined && spBefore !== undefined && spBefore !== '')
      || (sepTrim === '_' && sepRaw !== '_');
    if (innerSpaces) alt.push('espacios');
    if ((plural !== undefined && plural !== '') || suf !== undefined) alt.push('sufijo_pegado');
    const canonical = `[${lab}_${num}]`;
    const inTable = hasEntry(table, canonical);
    take(m.index, m.index + all.length, { kind: inTable ? 'alterado' : 'desconocido', alterations: sortAlt(alt), inTable, canonical, label: lab, n: Number(num) });
  }

  found.sort((a, b) => a.start - b.start);
  return found.map(({ start, end, info }): MarkerMatch => {
    const match: MarkerMatch = {
      id: ids.next('rei') as ReinsertMatchId, start, end, found: response.slice(start, end),
      kind: info.kind, alterations: info.alterations, inTable: info.inTable,
    };
    if (info.canonical !== undefined) match.canonical = info.canonical;
    if (info.label !== undefined) {
      const family = FAMILY_BY_LABEL.get(info.label);
      if (family !== undefined) match.family = family;
    }
    if (info.n !== undefined) match.n = info.n;
    if (info.inTable && info.canonical !== undefined) {
      const entry = table.entries[info.canonical];
      if (entry !== undefined) match.proposal = entry.display;
    }
    return match;
  });
}

export const findMarkers: FindMarkersFn = (input) => findMarkersWith(input, cryptoIds);

// ---------------------------------------------------------------------------------------------
// buildReinsertion
// ---------------------------------------------------------------------------------------------

/** Sufijo pegado que se conserva («[DEMANDANTE_1]'s» → «Ana Ficticia Rojas's»): grupo 3 de R-REI-01 o grupo 8 de R-REI-03.
 *  El plural pegado a la etiqueta (grupo 3 de R-REI-03) no se conserva. Se lee del token tal como lo escribió la IA. */
function suffixOf(m: MarkerMatch): string {
  if (!m.alterations.includes('sufijo_pegado')) return '';
  return /(?:[\]})»>]|[0-9])((?:'|’)?(?:s|es))$/iu.exec(m.found)?.[1] ?? '';
}

/** Faltantes: marcadores de la tabla del documento `expectedFrom` que no aparecen como exactos ni alterados. */
function missingOf(input: ReinsertionInput, matches: readonly MarkerMatch[]): string[] {
  const from = input.expectedFrom;
  if (from === null) return [];
  const seen = new Set<string>();
  for (const m of matches) if (m.kind !== 'desconocido' && m.canonical !== undefined) seen.add(m.canonical);
  return Object.keys(input.table.entries).filter((k) => (input.table.entries[k]?.documents ?? []).includes(from) && !seen.has(k));
}

/** ¿La decisión es válida para la clase? Un `desconocido` nunca se reemplaza (INV-N01); `editar` exige texto. */
function validDecision(kind: MarkerMatchKind, d: ReinsertionDecision | undefined): d is ReinsertionDecision {
  if (d === undefined) return false;
  if (d.action === 'dejar') return true;
  if (d.action === 'editar') return typeof d.text === 'string';
  return kind !== 'desconocido';   // 'reemplazar'
}

export const buildReinsertion: BuildReinsertionFn = (input, matches, decisions, missingAcknowledged): ReinsertionResult => {
  const response = input.response;
  const byId = new Map<string, MarkerMatch>(matches.map((m) => [m.id, m]));
  const kept: Record<string, ReinsertionDecision> = {};
  for (const key of Object.keys(decisions)) {
    const d = decisions[key];
    if (d !== undefined && byId.has(key)) kept[key] = d;
  }

  // Reemplazos de derecha a izquierda (INV-N03): ninguna posición pendiente se corre.
  const ordered = [...matches].sort((a, b) => b.start - a.start);
  let text = response;
  let limit = response.length;
  for (const m of ordered) {
    if (m.start < 0 || m.end <= m.start || m.end > limit || response.slice(m.start, m.end) !== m.found) continue;
    const d = kept[m.id];
    let replacement: string | undefined;
    if (d !== undefined && d.action === 'editar') {
      if (typeof d.text === 'string') replacement = d.text;
    } else if (m.kind === 'desconocido') {
      replacement = undefined;                                   // nunca se reemplaza
    } else if (m.kind === 'exacto') {
      if (d === undefined || d.action === 'reemplazar') replacement = displayOf(input.table, m);   // automático salvo «dejar»
    } else if (d !== undefined && d.action === 'reemplazar') {
      const display = displayOf(input.table, m);
      replacement = display === undefined ? undefined : display + suffixOf(m);
    }
    if (replacement === undefined) continue;
    text = text.slice(0, m.start) + replacement + text.slice(m.end);
    limit = m.start;
  }

  const unknown = matches.filter((m) => m.kind === 'desconocido').map((m) => m.id);
  const altered = matches.filter((m) => m.kind === 'alterado').map((m) => m.id);
  const missing = missingOf(input, matches);
  const decided = matches.every((m) => m.kind === 'exacto' || validDecision(m.kind, kept[m.id]));
  const ack = missingAcknowledged === true;
  return { text, matches: [...matches], alerts: { unknown, altered, missing }, decisions: kept, missingAcknowledged: ack, ready: decided && (missing.length === 0 || ack) };
};

/** `MappingEntry.display` del marcador canónico (con el sufijo del exacto, que no tiene). Undefined si no está en la tabla. */
function displayOf(table: MappingTable, m: MarkerMatch): string | undefined {
  if (!m.inTable || m.canonical === undefined || !hasEntry(table, m.canonical)) return undefined;
  const display = table.entries[m.canonical]?.display;
  return display;
}
