// Búsqueda de residuos sobre la salida (plan 7.13, 6.9): tres pasadas (literal y plegada, dígitos tolerantes a separadores,
// reglas y lista sobre la salida). PB-4. Código puro de core/: sin DOM ni red. Los valores buscados son [M]: nada de aquí
// va a la consola, al informe (solo se cuenta `valuesSearched`), al título ni a la URL (F-02, F-03).
import { LST, newCaseEntity, parseOrg, refreshVariants, searchCaseList } from './caselist.ts';
import { nitCheckDigit } from './entities.ts';
import { PALABRAS_DE_FUNCION, resolveRemainder, trimFunctionWords } from './merge.ts';
import { buildSearchView, toCanonicalSpan } from './normalize.ts';
import { sameHolderAs, type TitularEntrada } from './rules/ids.ts';
import { ORG_CLASSES } from './types.ts';
import type {
  CaseEntity, CaseEntityId, Confidence, DataType, Detection, DetectionCandidate, DetectionSet, DocumentModel, Entity, EntityId,
  IdSource, OutputSection, OutputSegment, Part, PartId, PartKind, RenderedOutput, ResidueHit, ResidueMode, ResidueRun,
  ReviewState, Role, RunResidueCheckFn, VariantClass,
} from './types.ts';

/** Extensión opcional del contexto: `MappingEntry.originals` por clave canónica, para las entidades heredadas del asunto (7.13.2). */
export interface ResidueCtxExtra {
  originals?: Readonly<Record<string, readonly string[]>>;
  /**
   * PB-4-r1 · false apaga las formas derivadas, la forma conocida partida y R-RES-03 (por defecto, encendidas). Solo para las
   * tablas de R-RES-01 y R-RES-02, que miden las pasadas 1 y 2 a solas, como el `detect` vacío apaga la pasada 3.
   */
  formasDerivadas?: boolean;
}

type Ctx = Parameters<RunResidueCheckFn>[3];

// ---------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------

const RANK: Readonly<Record<ResidueMode, number>> = { literal: 0, normalizado: 1, digitos: 2, variante: 3 };
const SCORE: Readonly<Record<Confidence, number>> = { alta: 0.9, media: 0.6, baja: 0.3 };
const ACCEPTED: ReadonlySet<string> = new Set(['aceptada', 'editada', 'pendiente']);
const RE_ALNUM = /[\p{L}\p{N}]/u;
const NUMERIC_TYPES: ReadonlySet<string> = new Set(['CC', 'TI', 'CE', 'PPT', 'PEP', 'DOCUMENTO', 'NIT', 'TP', 'HC', 'AFILIACION',
  'RADICADO', 'RADICADO_ADMIN', 'TELEFONO', 'CUENTA', 'TARJETA', 'MATRICULA', 'VALOR']);
const ALNUM_TYPES: ReadonlySet<string> = new Set(['PASAPORTE', 'PLACA']);
/** Tipos cuyos dígitos son los de un titular: aceptan el DV pegado (7.13.4). */
const HOLDER_TYPES: ReadonlySet<string> = new Set(['CC', 'TI', 'CE', 'PPT', 'PEP', 'DOCUMENTO', 'HC', 'AFILIACION', 'NIT']);
const VARIANT_CLASSES: ReadonlySet<VariantClass> = new Set<VariantClass>(['exacta', 'apellidos', 'razon_social_sin_sufijo']);
const MIN_DIGITS = 5;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
const foldList = (s: string): string => buildSearchView(s, 'lista', 'cuerpo').text;
const digitsOf = (s: string): string => s.replace(/[^0-9]/gu, '');
/** Letra o dígito Unicode justo antes (before) o desde la posición i. */
const isAlnumAt = (s: string, i: number, before: boolean): boolean => {
  const ch = before ? [...s.slice(Math.max(0, i - 2), i)].pop() : [...s.slice(i, i + 2)][0];
  return ch !== undefined && RE_ALNUM.test(ch);
};
/** Un original que empieza o termina en dígito no cuenta dentro de un número más largo («48.000.000» en «48.000.000.000»), como en R-RES-02. */
function insideLongerNumber(text: string, i: number, j: number): boolean {
  const first = text.charAt(i); const last = text.charAt(j - 1);
  if (/[0-9]/u.test(first) && i >= 2 && /[0-9][.']/u.test(text.slice(i - 2, i))) return true;
  return /[0-9]/u.test(last) && /^(?:[.'][0-9]|,[0-9]{3})/u.test(text.slice(j, j + 4));
}
/** 7.13.3 · Un objetivo de una sola palabra exige mayúscula inicial en el tramo canónico. */
function capitalized(slice: string): boolean {
  const words = slice.split(/[\s-]+/u).filter((w) => /\p{L}/u.test(w));
  return words.length > 0 && words.every((w) => /^\p{Lu}/u.test(w.replace(/^[^\p{L}]+/u, '')));
}

// ---------------------------------------------------------------------------------------------
// PB-4-r1 · Formas que el motor ya conoce y que la búsqueda de 7.13.2 no cubría
// ---------------------------------------------------------------------------------------------

const ORG_SET: ReadonlySet<string> = new Set(ORG_CLASSES);
/** Tipos de nombre: de sus originales se derivan formas (tramos de nombre y variantes de 7.9) y su reemplazo admite continuación. */
const isNameType = (t: string): boolean => t === 'PERSONA' || ORG_SET.has(t);
const foldWord = (w: string): string => foldList(w).trim();
/** Palabra de nombre: empieza con mayúscula, 2 letras o más, sin dígitos («Prueba», «Ejemplo-Acosta», «D'Ficticia»). */
const RE_NAME_WORD = /^\p{Lu}[\p{L}\p{M}'’-]*\p{L}$/u;
const isFunctionWord = (w: string): boolean => PALABRAS_DE_FUNCION.has(foldWord(w.replace(/[^\p{L}\p{M}]/gu, '')));
const isUpperWord = (w: string): boolean => { const l = w.replace(/[^\p{L}]/gu, ''); return l.length > 0 && l === l.toUpperCase(); };

/**
 * Tramos de nombre de un original observado: palabras con mayúscula inicial seguidas, con a lo sumo dos palabras de función entre
 * ellas («la ambulancia de Suministros Ficticios» → «Suministros Ficticios»; «Catalina Prueba Del Valle» entero). Un original
 * escrito todo en minúsculas («sergio prueba giraldo», en un chat) no tiene mayúsculas que separen: cuenta cada palabra que no es de
 * función. Recorrido lineal.
 */
export function nameRuns(original: string): string[] {
  const toks = original.split(/\s+/u).filter((t) => t !== '');
  const sinMayusculas = !/\p{Lu}/u.test(original);
  const nombre = (t: string): boolean => (sinMayusculas ? /\p{L}/u.test(t) : /^[^\p{L}]*\p{Lu}/u.test(t)) && !isFunctionWord(t);
  const runs: string[] = [];
  let i = 0;
  while (i < toks.length) {
    const t = toks[i] as string;
    if (!nombre(t)) { i++; continue; }
    const run: string[] = [t];
    let j = i + 1;
    for (;;) {
      let k = j;
      while (k < toks.length && k - j < 2 && isFunctionWord(toks[k] as string)) k++;
      const n = toks[k];
      if (n === undefined || !nombre(n)) break;
      for (let x = j; x <= k; x++) run.push(toks[x] as string);
      j = k + 1;
    }
    runs.push(run.join(' ').replace(/[,;:]+$/u, ''));
    i = j;
  }
  return runs;
}

/** IdSource local para las entidades temporales de la lista derivada: sus ids nunca salen de este módulo. */
function localIds(): IdSource {
  let n = 0;
  return { next: (p) => `${p}_${'f'.repeat(16)}${(++n).toString(16).padStart(16, '0')}` };
}

const RE_WORD_CHAR = /[\p{L}\p{M}'’]/u;
/** Antes de una palabra que empieza oración o línea, la mayúscula no dice nada: inicio, salto o signo de cierre o de apertura. */
const RE_SENTENCE_START = /[\n.!?:;(«"“\-–—•]/u;

/** Partículas de apellido y de razón social que unen palabras de nombre («Del Río», «de la Hoz», «Aseo y Mantenimiento»). */
const PARTICULAS: ReadonlySet<string> = new Set(['de', 'del', 'la', 'las', 'los', 'y']);

/**
 * R-RES-03 · Hasta dos palabras de nombre pegadas a la posición `pos` (borde de un marcador) por un solo blanco o guion, en la misma
 * línea: con mayúscula inicial y 2 letras o más, que no son palabras de función ni tratamientos (R-MOD-03), en MAYÚSCULAS solo si el
 * original lo está (y al revés). Entre ellas, o entre el marcador y la primera, caben hasta dos partículas («[PERSONA_1] Del Río»).
 * A la izquierda, la primera no puede empezar oración. Recorrido acotado: a lo sumo dos palabras y dos partículas.
 */
export function continuation(text: string, pos: number, side: 'izquierda' | 'derecha', upper: boolean): { start: number; end: number } | null {
  const ok = (w: string): boolean => RE_NAME_WORD.test(w) && !isFunctionWord(w) && isUpperWord(w) === upper;
  let start = pos;
  let end = pos;
  let cur = pos;
  let nombres = 0;
  let particulas = 0;
  while (nombres < 2 && particulas <= 2) {
    let w0: number; let w1: number;
    if (side === 'izquierda') {
      const gap = cur - 1;
      if (gap < 1 || (text[gap] !== ' ' && text[gap] !== '-')) break;
      w1 = gap; w0 = gap;
      while (w0 > 0 && RE_WORD_CHAR.test(text.charAt(w0 - 1))) w0--;
    } else {
      if (cur >= text.length || (text[cur] !== ' ' && text[cur] !== '-')) break;
      w0 = cur + 1; w1 = w0;
      while (w1 < text.length && RE_WORD_CHAR.test(text.charAt(w1))) w1++;
    }
    const w = text.slice(w0, w1);
    if (ok(w)) { nombres++; if (side === 'izquierda') start = w0; else end = w1; }
    // «y» solo une dos palabras de nombre: pegada al marcador separa a dos personas («Pedro y [PERSONA_1]»).
    else if (PARTICULAS.has(foldWord(w)) && !(nombres === 0 && foldWord(w) === 'y')) particulas++;
    else break;
    cur = side === 'izquierda' ? w0 : w1;
  }
  if (side === 'izquierda') {
    if (start === pos) return null;
    let k = start - 1;
    while (k >= 0 && text[k] === ' ') k--;
    if (k < 0 || RE_SENTENCE_START.test(text.charAt(k))) return null;
    return { start, end: pos - 1 };
  }
  return end === pos ? null : { start: pos + 1, end };
}

/** ¿La continuación empieza con una partícula de apellido escrita con mayúscula inicial («De la Hoz», «Del Río»)? */
function startsWithCapitalParticle(run: string): boolean {
  const w = /^[\p{L}\p{M}'’]+/u.exec(run)?.[0];
  return w !== undefined && /^\p{Lu}/u.test(w) && PARTICULAS.has(foldWord(w));
}

/** Lo que queda de un trozo copiado tras quitar blancos, signos y palabras de función en los bordes (R-MOD-03): null si no lleva dato. */
function dataSpan(text: string, start: number, end: number, kind: PartKind): { start: number; end: number } | null {
  const t = trimFunctionWords(text.slice(start, end), kind);
  if (t === null) return null;
  const sub = text.slice(start + t.start, start + t.end);
  const hasWord = sub.split(/[^\p{L}\p{M}]+/u).some((w) => w.length >= 2 && !isFunctionWord(w));
  if (!hasWord && sub.replace(/[^0-9]/gu, '').length < 3) return null;
  return { start: start + t.start, end: start + t.end };
}

// ---------------------------------------------------------------------------------------------
// Secciones de la salida con el tipo de cada segmento
// ---------------------------------------------------------------------------------------------

type SegType = 'copy' | 'marker' | 'edited';
interface Seg extends OutputSegment { type: SegType }
interface Sec { index: number; section: OutputSection; kind: PartKind; segs: Seg[] }

type Loc =
  | { kind: 'copy'; partStart: number; partEnd: number }
  | { kind: 'edited'; partStart: number }
  | { kind: 'marker' };

function buildSecs(state: ReviewState, out: RenderedOutput): Sec[] {
  return out.sections.map((section, index) => ({
    index, section, kind: section.kind,
    segs: section.segments.map((g): Seg => {
      let type: SegType = 'copy';
      if (g.spanEditId !== undefined) type = 'edited';
      else if (g.detectionId !== undefined) type = state.detections[g.detectionId]?.status === 'editada' ? 'edited' : 'marker';
      return { ...g, type };
    }),
  }));
}

/** Dónde cae el tramo [s, e) de la salida: copia 1:1 de `Part.text`, texto editado por el revisor o marcador/plantilla. */
function locate(sec: Sec, s: number, e: number): Loc {
  let edited: Seg | undefined;
  let marker = false;
  for (const g of sec.segs) {
    if (g.type === 'copy' || g.outEnd <= s || g.outStart >= e) continue;
    if (g.type === 'edited') edited ??= g; else marker = true;
  }
  if (edited !== undefined) return { kind: 'edited', partStart: edited.partStart };
  if (marker) return { kind: 'marker' };
  const c = sec.segs.find((g) => g.type === 'copy' && g.outStart <= s && e <= g.outEnd);
  if (c === undefined) return { kind: 'marker' };
  return { kind: 'copy', partStart: c.partStart + (s - c.outStart), partEnd: c.partStart + (e - c.outStart) };
}

// ---------------------------------------------------------------------------------------------
// Objetivos (7.13.2)
// ---------------------------------------------------------------------------------------------

interface Target { entity: Entity; primary: boolean }
interface LiteralTarget { text: string; target: Target }
interface FoldedTarget {
  folded: string; re: RegExp; single: boolean; target: Target; mode: 'normalizado' | 'variante'; conf?: Confidence; cls?: VariantClass; derived?: true;
  /** PB-4-r2 · La forma escrita (NFC, minúsculas) de una palabra corta con tilde («sá»): el acierto de la vista plegada solo vale si la conserva. */
  exact?: string;
}
interface NumTarget { digits: string; alnum: boolean; tel: boolean; dv: string | null; target: Target; re: RegExp }

/** «del municipio de Cartago» → «Cartago» (7.13.2). */
const RE_MUNICIPIO = /^(?:(?:el|del|al|la|de la|a la)\s+)?(?:municipio|ciudad|poblaci[oó]n)\s+(?:de\s+)?(.+)$/iu;

/** Dígitos (o caracteres alfanuméricos) que se buscan para una entidad numérica, o null si no entra (7.13.2). */
function numericValue(e: Entity): { digits: string; alnum: boolean } | null {
  const key = e.canonicalKey;
  const val = key.slice(key.indexOf(':') + 1);
  if (ALNUM_TYPES.has(e.type)) {
    const a = val.replace(/^~/u, '').replace(/[^A-Za-z0-9]/gu, '');
    return a.length >= MIN_DIGITS ? { digits: a, alnum: true } : null;
  }
  if (!NUMERIC_TYPES.has(e.type)) return null;
  let d: string;
  if (e.type === 'MATRICULA') {
    const m = /-([0-9]+)$/u.exec(val);
    d = m === null ? (val.match(/[0-9]+/gu) ?? []).sort((a, b) => b.length - a.length)[0] ?? '' : (m[1] as string);
  } else d = digitsOf(val);
  return d.length >= MIN_DIGITS ? { digits: d, alnum: false } : null;
}

function digitsRegex(t: Omit<NumTarget, 're'>): RegExp {
  const cls = t.alnum ? '[A-Za-z0-9]' : '[0-9]';
  const sep = String.raw`[ .,\-'/()\n]{0,3}`;
  const inicio = `(?<!${cls})(?<!${cls}[.'])`;
  const fin = `(?!${cls})(?![.']${cls})(?!,[0-9]{3})`;
  const pfx = t.tel ? String.raw`(?:(?:\+|00)?57[ .\-()]{0,3})?` : '';
  const dv = t.dv === null ? '' : String.raw`(?:[ \-]?${t.dv})?`;
  return new RegExp(inicio + pfx + [...t.digits].join(sep) + dv + fin, t.alnum ? 'giu' : 'gu');
}

/** R-RES-01: mismo constructor que R-LST-01 (7.9.7) sobre la vista `lista`. */
function foldedRegex(folded: string): RegExp {
  const toks = folded.split(/[ -]+/u).filter((t) => t !== '');
  return new RegExp(LST.INICIO + toks.map(escapeRe).join(LST.SEP) + LST.FIN, 'gu');
}

// ---------------------------------------------------------------------------------------------
// Aciertos
// ---------------------------------------------------------------------------------------------

interface RawHit {
  si: number; start: number; end: number;       // en la salida
  target: Target; mode: ResidueMode; loc: Loc;
  conf?: Confidence; cls?: VariantClass;
  p3?: true;                                    // acierto de la pasada 3 (ya filtrado por las decisiones del revisor)
  derived?: true;                               // PB-4-r1: de una forma derivada o de R-RES-03
  order: number;
}
interface Survivor { si: number; start: number; end: number; cand: DetectionCandidate; loc: Loc }

/** 7.13.5.2 · Pedazos de [s, e) que no cubre ningún segmento reemplazado. */
function copiedPieces(sec: Sec, s: number, e: number): Array<[number, number]> {
  const pieces: Array<[number, number]> = [];
  let cur = s;
  for (const g of sec.segs.filter((x) => x.type !== 'copy' && x.outEnd > s && x.outStart < e).sort((a, b) => a.outStart - b.outStart)) {
    if (g.outStart > cur) pieces.push([cur, g.outStart]);
    cur = Math.max(cur, g.outEnd);
  }
  if (cur < e) pieces.push([cur, e]);
  return pieces;
}

function cleanCandidate(d: DetectionCandidate, start: number, end: number): DetectionCandidate {
  const c: DetectionCandidate = { partId: d.partId, start, end, type: d.type, source: d.source, confidence: d.confidence,
    score: d.score, canonicalKey: d.canonicalKey };
  if (d.role !== undefined) c.role = d.role;
  if (d.ruleId !== undefined) c.ruleId = d.ruleId;
  if (d.caseEntityId !== undefined) c.caseEntityId = d.caseEntityId;
  if (d.variantClass !== undefined) c.variantClass = d.variantClass;
  if (d.nerLabel !== undefined) c.nerLabel = d.nerLabel;
  if (d.validator !== undefined) c.validator = d.validator;
  if (d.context !== undefined) c.context = d.context;
  return c;
}

/**
 * B-60 (PB-2-r7) · Menciones de la lista del caso de una sola palabra (sin blancos) estrictamente dentro de las reglas de la pasada 3
 * que el revisor rechazó (`excluidas`), en la parte copiada de la salida y sin superviviente propio en el mismo tramo. Son las que
 * la fusión absorbe en la regla (D-06, 7.11.1): sin esto, rechazar la regla dejaba la palabra a la vista y la búsqueda pasaba.
 */
function listaDentroDeExcluidas(excluidas: readonly Survivor[], survivors: readonly Survivor[], secs: readonly Sec[],
  tmpById: ReadonlyMap<PartId, Part>, caseList: readonly CaseEntity[]): Survivor[] {
  const out: Survivor[] = [];
  if (excluidas.length === 0 || caseList.length === 0) return out;
  const menciones = new Map<PartId, DetectionCandidate[]>();
  for (const rv of excluidas) {
    const part = tmpById.get(rv.cand.partId);
    const sec = secs[rv.si];
    if (part === undefined || sec === undefined) continue;
    let ms = menciones.get(part.id);
    if (ms === undefined) { ms = searchCaseList(part, caseList); menciones.set(part.id, ms); }
    for (const L of ms) {
      if (!(rv.start <= L.start && L.end <= rv.end && L.end - L.start < rv.end - rv.start) || /\s/u.test(part.text.slice(L.start, L.end).trim())) continue;
      if ([...survivors, ...out].some((o) => o.si === rv.si && o.start === L.start && o.end === L.end)) continue;
      const loc = locate(sec, L.start, L.end);
      if (loc.kind === 'copy') out.push({ si: rv.si, start: L.start, end: L.end, cand: cleanCandidate(L, L.start, L.end), loc });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// runResidueCheck
// ---------------------------------------------------------------------------------------------

async function run(doc: DocumentModel, state: ReviewState, out: RenderedOutput, ctx: Ctx & ResidueCtxExtra): Promise<ResidueRun> {
  const secs = buildSecs(state, out);
  const detections = Object.values(state.detections);

  // ---- 7.13.2 · entidades objetivo: con una mención aceptada o editada, más sus `sameHolderAs`.
  const targets = new Map<EntityId, Target>();
  const mentionsOf = new Map<EntityId, Detection[]>();
  for (const d of detections) {
    if (!ACCEPTED.has(d.status)) continue;
    const e = state.entities[d.entityId];
    if (e === undefined) continue;
    if (!targets.has(e.id)) targets.set(e.id, { entity: e, primary: true });
    const list = mentionsOf.get(e.id);
    if (list === undefined) mentionsOf.set(e.id, [d]); else list.push(d);
  }
  for (const t of [...targets.values()]) {
    for (const id of t.entity.sameHolderAs) {
      const o = state.entities[id];
      if (o !== undefined && !targets.has(o.id)) targets.set(o.id, { entity: o, primary: false });
    }
  }
  const targetList = [...targets.values()];
  const caseById = new Map<string, CaseEntity>(ctx.caseList.map((c) => [c.id, c]));

  // ---- originales observados, municipios sin artículo, variantes y claves numéricas.
  const literals: LiteralTarget[] = [];
  const folded: FoldedTarget[] = [];
  const nums: NumTarget[] = [];
  const seenLiteral = new Set<string>();
  const seenFolded = new Set<string>();
  const seenNum = new Set<string>();
  let valuesSearched = 0;
  const addLiteral = (text: string, target: Target): void => {
    if ([...text].filter((ch) => RE_ALNUM.test(ch)).length < 2 || seenLiteral.has(text)) return;
    seenLiteral.add(text);
    literals.push({ text, target });
    valuesSearched++;
    if (/\p{L}/u.test(text)) addFolded(text, target, 'normalizado', false);
  };
  const addFolded = (text: string, target: Target, mode: 'normalizado' | 'variante', count: boolean, conf?: Confidence, cls?: VariantClass, derived?: true, exact?: string): void => {
    const f = foldList(text).trim();
    const k = `${mode}\u0000${f}\u0000${exact ?? ''}`;
    if (f === '' || seenFolded.has(k)) return;
    seenFolded.add(k);
    const ft: FoldedTarget = { folded: f, re: foldedRegex(f), single: f.split(/[ -]+/u).filter((x) => x !== '').length === 1, target, mode };
    if (conf !== undefined) ft.conf = conf;
    if (cls !== undefined) ft.cls = cls;
    if (derived === true) ft.derived = true;
    if (exact !== undefined) ft.exact = exact;
    folded.push(ft);
    if (count) valuesSearched++;
  };
  // Las primarias antes que las que solo vienen por `sameHolderAs`: a igual tramo y modo gana la primaria.
  for (const t of [...targetList].sort((a, b) => Number(b.primary) - Number(a.primary))) {
    const e = t.entity;
    if (t.primary) {
      for (const d of mentionsOf.get(e.id) ?? []) {
        addLiteral(d.text, t);
        if (d.type === 'MUNICIPIO') {
          const m = RE_MUNICIPIO.exec(d.text.trim());
          if (m !== null) addFolded(m[1] as string, t, 'normalizado', true);
        }
      }
      for (const o of ctx.originals?.[e.canonicalKey] ?? []) addLiteral(o, t);
      const ce = e.caseEntityId === undefined ? undefined : caseById.get(e.caseEntityId);
      if (ce !== undefined) {
        for (const v of ce.variants) {
          if (!v.enabled || !VARIANT_CLASSES.has(v.class)) continue;
          if (foldList(v.text).split(/[ -]+/u).filter((x) => x !== '').length < 2) continue;
          addFolded(v.text, t, 'variante', true, v.confidence, v.class);
        }
      }
    }
    const nv = numericValue(e);
    if (nv !== null) {
      const tel = e.type === 'TELEFONO';
      const dv = HOLDER_TYPES.has(e.type) && !nv.alnum ? String(nitCheckDigit(nv.digits)) : null;
      const k = `${nv.alnum ? 'A' : 'D'}${tel ? 'T' : ''}${dv ?? ''}:${nv.digits}`;
      if (!seenNum.has(k)) {
        seenNum.add(k);
        const nt: Omit<NumTarget, 're'> = { digits: nv.digits, alnum: nv.alnum, tel, dv, target: t };
        nums.push({ ...nt, re: digitsRegex(nt) });
        valuesSearched++;
      }
    }
  }

  // ---- PB-4-r1 · Formas derivadas (7.13.2 ampliado). De cada original observado de una entidad objetivo de nombre (persona u
  // organización, venga de la lista, del modelo o de una regla) se toman sus tramos de nombre y, con el generador de la lista (7.9),
  // sus variantes: apellidos, razón social sin sufijo, apellido y nombre sueltos, iniciales y sigla. El motor ya conoce esas formas:
  // «Ficticio Londoño» de «Óscar Javier Ficticio Londoño», «Ortiz» de «Martha Cecilia Ejemplo-Acosta Ortiz». Se buscan como
  // `variante` (las de una palabra, con mayúscula inicial como en 7.13.3; iniciales y sigla, con el filtro de forma de la lista).
  const derivadas = ctx.formasDerivadas !== false;
  const ids = localIds();
  const initialsOwner = new Map<CaseEntityId, Target>();
  const initialsList: CaseEntity[] = [];
  for (const t of derivadas ? targetList : []) {
    if (!t.primary || !isNameType(t.entity.type)) continue;
    const e = t.entity;
    const originals = [...(mentionsOf.get(e.id) ?? []).map((d) => d.text), ...(ctx.originals?.[e.canonicalKey] ?? [])];
    const seenRun = new Set<string>();
    for (const o of originals) {
      const fo = foldList(o).trim();
      for (const r of nameRuns(o)) {
        // PB-4-r2 (M-60, G4) · La lista no genera como forma suelta una palabra de dos letras («Sá» da «sa»: la descarta 7.9.5 por corta),
        // pero el motor la conoce: es una palabra del nombre. Se busca con su mayúscula inicial y su tilde, para no tomar el sufijo «SA».
        // Solo en el nombre de una persona de la lista: lo que el usuario escribió es nombre; una palabra de dos letras en lo que dijo el
        // modelo («No.» de «Cuenta No.») no lo es.
        if (e.type === 'PERSONA' && e.caseEntityId !== undefined) {
          for (const w of r.split(/\s+/u)) {
            if (RE_NAME_WORD.test(w) && foldWord(w).length === 2 && !isFunctionWord(w)) addFolded(w, t, 'variante', true, 'baja', undefined, true, w.normalize('NFC').toLowerCase());
          }
        }
        const fr = foldList(r).trim();
        if (fr === '' || seenRun.has(fr)) continue;
        seenRun.add(fr);
        const words = r.split(/\s+/u).length;
        if (words < 2) { if (fr !== fo) addFolded(r, t, 'variante', true, 'baja', undefined, true); continue; }
        const role: Role = e.type === 'PERSONA' ? (e.role !== undefined && !ORG_SET.has(e.role) ? e.role : 'OTRA_PERSONA') : (e.type as Role);
        const ce = newCaseEntity(r, e.type === 'PERSONA' ? 'persona' : 'organizacion', role, ids);
        if (ce === null) continue;
        // La razón social sin el sufijo («Suministros Ficticios» de «Suministros Ficticios S.A.S.»): la variante exacta de la lista
        // la toma con su sufijo opcional (7.9.4); aquí, como forma plegada propia.
        if (ce.kind === 'organizacion') {
          const base = parseOrg(r).baseText;
          if (foldList(base).trim() !== fo && foldList(base).trim() !== fr) addFolded(base, t, 'variante', true, 'media', 'razon_social_sin_sufijo', true);
        }
        const [gen] = refreshVariants([ce]);
        const ini = (gen?.variants ?? []).filter((v) => v.enabled && (v.class === 'iniciales' || v.class === 'sigla'));
        for (const v of gen?.variants ?? []) {
          if (!v.enabled || v.class === 'iniciales' || v.class === 'sigla') continue;
          if (foldList(v.text).trim() !== fo) addFolded(v.text, t, 'variante', true, v.confidence, v.class, true);
        }
        if (ini.length > 0 && gen !== undefined) { initialsList.push({ ...gen, variants: ini } as CaseEntity); initialsOwner.set(gen.id, t); }
      }
    }
  }

  const raw: RawHit[] = [];
  let order = 0;
  const push = (h: Omit<RawHit, 'order'>): void => { raw.push({ ...h, order: order++ }); };

  // ---- Pasada 1 · literal y plegada (7.13.3).
  for (const sec of secs) {
    const text = sec.section.text;
    for (const lt of literals) {
      let from = 0;
      for (;;) {
        const i = text.indexOf(lt.text, from);
        if (i < 0) break;
        const j = i + lt.text.length;
        from = i + 1;
        if (isAlnumAt(text, i, true) || isAlnumAt(text, j, false) || insideLongerNumber(text, i, j)) continue;
        push({ si: sec.index, start: i, end: j, target: lt.target, mode: 'literal', loc: locate(sec, i, j) });
      }
    }
    if (folded.length === 0) continue;
    const view = buildSearchView(text, 'lista', sec.kind);
    for (const ft of folded) {
      const single = ft.single;
      for (const m of view.text.matchAll(ft.re)) {
        const c = toCanonicalSpan(view, m.index, m.index + m[0].length);
        if (c.end <= c.start || (single && !capitalized(text.slice(c.start, c.end)))) continue;
        if (ft.exact !== undefined && text.slice(c.start, c.end).normalize('NFC').toLowerCase() !== ft.exact) continue;
        const h: Omit<RawHit, 'order'> = { si: sec.index, start: c.start, end: c.end, target: ft.target, mode: ft.mode, loc: locate(sec, c.start, c.end) };
        if (ft.conf !== undefined) h.conf = ft.conf;
        if (ft.cls !== undefined) h.cls = ft.cls;
        if (ft.derived === true) h.derived = true;
        push(h);
      }
    }
  }

  // ---- Pasada 2 · dígitos sin separadores (7.13.4).
  for (const sec of secs) {
    if (nums.length === 0) break;
    const view = buildSearchView(sec.section.text, 'reglas', sec.kind);
    for (const nt of nums) {
      for (const m of view.text.matchAll(nt.re)) {
        const c = toCanonicalSpan(view, m.index, m.index + m[0].length);
        if (c.end > c.start) push({ si: sec.index, start: c.start, end: c.end, target: nt.target, mode: 'digitos', loc: locate(sec, c.start, c.end) });
      }
    }
  }

  // ---- Pasada 3 · reglas y lista sobre la salida (7.13.5). El modelo no se vuelve a ejecutar (S-7.9).
  const partById = new Map<PartId, Part>(doc.parts.map((p) => [p.id, p]));
  const tmpParts: Part[] = secs.map((sec, i) => {
    const p = partById.get(sec.section.partId);
    return p !== undefined ? { ...p, text: sec.section.text, included: true }
      : { id: sec.section.partId, docId: doc.id, kind: sec.kind, label: sec.section.label, order: i, index: 1, text: sec.section.text, included: true };
  });
  const tmp: DocumentModel = { id: doc.id, label: doc.label, source: doc.source, parts: tmpParts, metadata: doc.metadata, warnings: [] };
  const set: DetectionSet = await ctx.detect(tmp);
  const secByPart = new Map<PartId, Sec>(secs.map((s) => [s.section.partId, s]));
  const tmpById = new Map<PartId, Part>(tmpParts.map((p) => [p.id, p]));

  const targetFor = (c: DetectionCandidate): Target | undefined => {
    const byKey = targetList.filter((t) => t.entity.canonicalKey === c.canonicalKey
      || (c.caseEntityId !== undefined && t.entity.caseEntityId === c.caseEntityId));
    const pick = (l: Target[]): Target | undefined => l.find((t) => t.primary) ?? l[0];
    const k = pick(byKey);
    if (k !== undefined) return k;
    const items: TitularEntrada[] = targetList.map((t) => ({ id: t.entity.id, type: t.entity.type as DataType, canonicalKey: t.entity.canonicalKey }));
    items.push({ id: '__candidato__', type: c.type, canonicalKey: c.canonicalKey });
    const same = sameHolderAs(items).get('__candidato__');
    return same === undefined ? undefined : pick(targetList.filter((t) => same.has(t.entity.id)));
  };

  const survivors: Survivor[] = [];
  for (const d of set.detections) {
    const sec = secByPart.get(d.partId);
    const tmpPart = tmpById.get(d.partId);
    if (sec === undefined || tmpPart === undefined || !(d.end > d.start && d.start >= 0 && d.end <= sec.section.text.length)) continue;
    const base = cleanCandidate(d, d.start, d.end);
    const whole = locate(sec, d.start, d.end);
    // Dentro (o tocando) un texto editado por el revisor: solo cuenta si es un residuo de una entidad objetivo (7.13.6).
    if (whole.kind === 'edited') {
      const t = targetFor(base);
      if (t !== undefined) push({ si: sec.index, start: d.start, end: d.end, target: t, mode: 'variante', loc: whole, conf: d.confidence, p3: true,
        ...(d.variantClass !== undefined ? { cls: d.variantClass } : {}) });
    }
    for (const [a, b] of copiedPieces(sec, d.start, d.end)) {
      let cand: DetectionCandidate | null;
      if (a === d.start && b === d.end) cand = base;
      else {
        const r = resolveRemainder(tmpPart, base, a, b, ctx.rules);
        cand = r === null ? null : cleanCandidate(r, r.start, r.end);
      }
      if (cand === null) continue;
      const loc = locate(sec, cand.start, cand.end);
      if (loc.kind !== 'copy') continue;
      survivors.push({ si: sec.index, start: cand.start, end: cand.end, cand, loc });
    }
  }

  // ---- 7.13.6 · decisiones del revisor. Un rechazo solo excluye si es de la misma entidad (S-7.12): el tramo igual o contenido.
  const rejected = detections.filter((d) => d.status === 'rechazada');
  /** El tramo del acierto es el de la detección rechazada o está dentro de él (las variantes de un nombre rechazado caen dentro). */
  const insideRejected = (r: Detection, partId: PartId, ps: number, pe: number): boolean => r.partId === partId && r.start <= ps && pe <= r.end;
  const keyOfEntity = (r: Detection): string => state.entities[r.entityId]?.canonicalKey ?? r.canonicalKey;
  // PB-4-r1 · Un rechazo que contiene el acierto solo lo excluye si todo lo que rechazó es nombre de esa entidad: rechazar
  // «Ana Ficticia Rojas» decide también sobre «Ana Ficticia»; rechazar «Sergio primero» (límites de más) no dice nada de «Sergio».
  // El tramo igual siempre excluye (S-7.12).
  const nameWords = new Map<EntityId, Set<string>>();
  const wordsOf = (s: string): string[] => foldList(s).split(/[^\p{L}\p{M}]+/u).filter((w) => w.length >= 2 && !PALABRAS_DE_FUNCION.has(w));
  const namesOf = (e: Entity): Set<string> => {
    let w = nameWords.get(e.id);
    if (w !== undefined) return w;
    w = new Set<string>();
    for (const d of mentionsOf.get(e.id) ?? []) for (const x of wordsOf(d.text)) w.add(x);
    for (const o of ctx.originals?.[e.canonicalKey] ?? []) for (const x of wordsOf(o)) w.add(x);
    const ce = e.caseEntityId === undefined ? undefined : caseById.get(e.caseEntityId);
    if (ce !== undefined) for (const x of wordsOf(ce.name)) w.add(x);
    nameWords.set(e.id, w);
    return w;
  };
  const rejectionCovers = (r: Detection, e: Entity, partId: PartId, ps: number, pe: number): boolean => {
    if (r.entityId !== e.id || !insideRejected(r, partId, ps, pe)) return false;
    if (r.start === ps && r.end === pe) return true;
    const names = namesOf(e);
    return wordsOf(r.text).every((x) => names.has(x));
  };

  const kept: Survivor[] = [];
  /** Aplica la decisión del revisor a un superviviente; devuelve false si queda excluido. */
  const decidir = (sv: Survivor): boolean => {
    const loc = sv.loc as Extract<Loc, { kind: 'copy' }>;
    const t = targetFor(sv.cand);
    const excluded = rejected.some((r) => (t !== undefined ? rejectionCovers(r, t.entity, sv.cand.partId, loc.partStart, loc.partEnd)
      : insideRejected(r, sv.cand.partId, loc.partStart, loc.partEnd) && (keyOfEntity(r) === sv.cand.canonicalKey || r.canonicalKey === sv.cand.canonicalKey)));
    if (excluded) return false;
    kept.push(sv);
    if (t !== undefined) {
      push({ si: sv.si, start: sv.start, end: sv.end, target: t, mode: 'variante', loc, conf: sv.cand.confidence, p3: true,
        ...(sv.cand.variantClass !== undefined ? { cls: sv.cand.variantClass } : {}) });
    }
    return true;
  };
  const reglasExcluidas: Survivor[] = [];
  for (const sv of survivors) if (!decidir(sv) && sv.cand.source === 'regla') reglasExcluidas.push(sv);
  // B-60 (PB-2-r7) · La fusión de la pasada 3 vuelve a absorber la palabra de la lista en la regla estructural (D-06), y esa regla,
  // igual a la que el revisor rechazó, se excluye arriba: la palabra quedaría a la vista sin que nada la encuentre. No se absorbe
  // en una regla excluida: cada detección de la lista de una sola palabra estrictamente dentro de ella vuelve como superviviente
  // propio (y pasa por la misma decisión del revisor), así que sale como residuo o como detección nueva de la lista, pendiente.
  for (const sv of listaDentroDeExcluidas(reglasExcluidas, survivors, secs, tmpById, ctx.caseList)) decidir(sv);

  // ---- PB-4-r1 · Lo que el motor conoce y la salida deja a la vista sin que las pasadas 1 a 3 lo vean (10.3.4: «el motor conocía
  // el dato y aun así quedó»). Tres búsquedas más; sus aciertos pasan por la misma decisión del revisor de la pasada 3 (un rechazo
  // de la misma entidad sobre el mismo tramo, o uno que lo contiene, excluye) y salen como `variante` de la entidad (mismo marcador).
  const pushDecided = (si: number, s: number, e: number, t: Target, loc: Loc, conf: Confidence, cls?: VariantClass): void => {
    if (loc.kind === 'marker') return;
    const partId = (secs[si] as Sec).section.partId;
    if (loc.kind === 'copy' && rejected.some((r) => rejectionCovers(r, t.entity, partId, loc.partStart, loc.partEnd))) return;
    push({ si, start: s, end: e, target: t, mode: 'variante', loc, conf, p3: true, derived: true, ...(cls !== undefined ? { cls } : {}) });
  };
  for (const sec of derivadas ? secs : []) {
    const part = partById.get(sec.section.partId);
    // (a) Iniciales y sigla derivadas («A. E. O.» de «Alejandro Ejemplo Orozco»), con el filtro de forma de la lista (7.9.5).
    if (initialsList.length > 0) {
      const p: Part = { id: sec.section.partId, docId: doc.id, kind: sec.kind, label: sec.section.label, order: sec.index, index: 1,
        text: sec.section.text, included: true };
      for (const c of searchCaseList(p, initialsList)) {
        const t = c.caseEntityId === undefined ? undefined : initialsOwner.get(c.caseEntityId);
        if (t !== undefined) pushDecided(sec.index, c.start, c.end, t, locate(sec, c.start, c.end), 'baja', c.variantClass);
      }
    }
    if (part === undefined) continue;
    // (b) Una forma conocida de varias palabras partida en `Part.text` por el reemplazo de otro dato («Banco Ejemplo» con «Ejemplo»
    // reemplazado como apellido de otra persona): en la salida no aparece entera, pero lo copiado con dato sigue siendo suyo.
    const multi = folded.filter((f) => !f.single);
    const copies = sec.segs.filter((g) => g.type === 'copy');
    if (multi.length > 0 && copies.length < sec.segs.length) {
      const view = buildSearchView(part.text, 'lista', part.kind);
      for (const ft of multi) {
        for (const m of view.text.matchAll(ft.re)) {
          const c = toCanonicalSpan(view, m.index, m.index + m[0].length);
          if (c.end <= c.start) continue;
          const pieces = copies.filter((g) => g.partEnd > c.start && g.partStart < c.end);
          const p0 = pieces[0];
          if (p0 === undefined || (pieces.length === 1 && p0.partStart <= c.start && c.end <= p0.partEnd)) continue;   // entera: pasada 1
          for (const g of pieces) {
            const ds = dataSpan(part.text, Math.max(g.partStart, c.start), Math.min(g.partEnd, c.end), part.kind);
            if (ds === null) continue;
            const os = g.outStart + (ds.start - g.partStart);
            pushDecided(sec.index, os, os + (ds.end - ds.start), ft.target, { kind: 'copy', partStart: ds.start, partEnd: ds.end }, ft.conf ?? 'media', ft.cls);
          }
        }
      }
    }
    // (c) R-RES-03 · Continuación de un nombre reemplazado con límites cortos: hasta dos palabras de nombre pegadas al marcador de una
    // persona u organización por un blanco o un guion, en la misma línea, con la caja del original («de Ejemplo [PERSONA_5]»,
    // «[DEMANDANTE_1] Gómez»). Es la regla de remanentes del modelo (7.11.2) aplicada a lo que el tramo dejó fuera.
    for (const g of sec.segs) {
      if (g.type !== 'marker' || g.detectionId === undefined) continue;
      const d = state.detections[g.detectionId];
      // PB-4-r2 · Tras el marcador de un lugar o una dirección, solo a la derecha y solo un apellido que empieza con partícula escrita
      // con mayúscula («[DIRECCIÓN_4] De la Hoz»): el modelo tomó la primera palabra del nombre de una persona por un lugar.
      const lugar = d !== undefined && (d.type === 'LUGAR' || d.type === 'DIRECCION');
      const t = d === undefined || !(isNameType(d.type) || lugar) ? undefined : targets.get(d.entityId);
      if (t === undefined) continue;
      const upper = isUpperWord(part.text.slice(g.partStart, g.partEnd));
      for (const side of ['izquierda', 'derecha'] as const) {
        if (lugar && side === 'izquierda') continue;
        const run = continuation(sec.section.text, side === 'izquierda' ? g.outStart : g.outEnd, side, upper);
        if (run === null || (lugar && !startsWithCapitalParticle(sec.section.text.slice(run.start, run.end)))) continue;
        pushDecided(sec.index, run.start, run.end, t, locate(sec, run.start, run.end), 'baja');
      }
    }
  }

  // ---- Pasadas 1 y 2: un rechazo explícito (motivo distinto de SIN_MOTIVO) de la misma entidad y el mismo tramo también excluye.
  // El rechazo por defecto no: es el caso de «rechazada por error» (T-RS-02, T-RS-10, T-RS-13). La pasada 3 ya se filtró arriba.
  const live: RawHit[] = [];
  for (const h of raw) {
    if (h.loc.kind === 'marker') continue;
    if (h.loc.kind === 'copy' && h.p3 !== true) {
      const loc = h.loc;
      const partId = (secs[h.si] as Sec).section.partId;
      if (rejected.some((r) => rejectionCovers(r, h.target.entity, partId, loc.partStart, loc.partEnd)
        && r.rejectReason !== undefined && r.rejectReason !== 'SIN_MOTIVO')) continue;
    }
    live.push(h);
  }

  // ---- 7.13.6 · deduplicación por tramo (gana el modo de menor rango) y fuera los contenidos en otro de la misma entidad.
  const best = new Map<string, RawHit>();
  for (const h of live) {
    const k = `${h.si}:${h.start}:${h.end}`;
    const cur = best.get(k);
    if (cur === undefined || RANK[h.mode] < RANK[cur.mode]
      || (RANK[h.mode] === RANK[cur.mode] && h.target.primary && !cur.target.primary)) best.set(k, h);
  }
  const uniq = [...best.values()];
  // PB-4-r1: el acierto de una forma derivada o de R-RES-03 dentro del de otra entidad no agrega nada («ANA» dentro del correo).
  const hitsRaw = uniq.filter((h) => !uniq.some((o) => o !== h && o.si === h.si && (o.target.entity.id === h.target.entity.id || h.derived === true)
    && o.start <= h.start && h.end <= o.end && (o.start < h.start || h.end < o.end)))
    .sort((a, b) => a.si - b.si || a.start - b.start || a.end - b.end);

  const hits: ResidueHit[] = hitsRaw.map((h) => {
    const sec = secs[h.si] as Sec;
    return { sectionIndex: h.si, start: h.start, end: h.end, partId: sec.section.partId, partStart: h.loc.kind === 'marker' ? 0 : h.loc.partStart,
      entityId: h.target.entity.id, mode: h.mode };
  });

  // ---- 7.13.6 · incorporación: todo residuo fuera de un reemplazo y toda detección nueva de la pasada 3.
  const candidates: DetectionCandidate[] = [];
  const taken = (c: DetectionCandidate): boolean => candidates.some((o) => o.partId === c.partId && c.start < o.end && o.start < c.end);
  for (const h of hitsRaw) {
    if (h.loc.kind !== 'copy') continue;
    const e = h.target.entity;
    const conf: Confidence = h.mode === 'literal' ? 'alta' : h.mode === 'variante' ? (h.conf ?? 'media') : 'media';
    const c: DetectionCandidate = { partId: (secs[h.si] as Sec).section.partId, start: h.loc.partStart, end: h.loc.partEnd,
      type: e.type, source: e.caseEntityId !== undefined ? 'lista' : 'regla', confidence: conf, score: SCORE[conf], canonicalKey: e.canonicalKey };
    if (e.role !== undefined) c.role = e.role;
    if (e.caseEntityId !== undefined) { c.caseEntityId = e.caseEntityId; c.variantClass = h.cls ?? 'exacta'; }
    else c.ruleId = h.mode === 'digitos' ? 'R-RES-02' : 'R-RES-01';
    if (!taken(c)) candidates.push(c);
  }
  for (const sv of kept) {
    const loc = sv.loc as Extract<Loc, { kind: 'copy' }>;
    const c = cleanCandidate(sv.cand, loc.partStart, loc.partEnd);
    if (!taken(c)) candidates.push(c);
  }
  candidates.sort((a, b) => (partById.get(a.partId)?.order ?? 0) - (partById.get(b.partId)?.order ?? 0) || a.start - b.start);

  const modes: ResidueMode[] = ['literal', 'normalizado', 'digitos', 'variante'];
  return {
    result: { revision: state.revision, ranAt: new Date().toISOString(), valuesSearched, modes, hits, newDetections: kept.length },
    nuevas: candidates,
  };
}

export const runResidueCheck: RunResidueCheckFn = run;
