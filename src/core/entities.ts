// Entidades, claves canónicas, marcadores, tabla del asunto y reductor de la revisión (plan 6.2.1, 6.4.4, 6.6, 7.12). PB-3.
// Código puro de core/: sin DOM ni red. Los ids salen de un IdSource (6.1.4); nunca del contenido (INV-G05).
import type {
  CaseEntity, DataType, DetectableType, Detection, DetectionCandidate, DetectionId, DetectionSet, DocumentModel, Entity,
  EntityId, Flag, IdSource, MappingEntry, MappingTable, MarkerFamily, MergedCandidate, ModelProgress, Part, PartId,
  PartKind, ReviewAction, ReviewError, ReviewOutcome, ReviewState, Role, Span, SpanEdit, SpanEditId, Suggestion,
  SearchView, SuggestionId, SuggestionOption, TableIndex, IsoDateTime,
} from './types.ts';
import { FLAG_TYPES, MARKER_LABEL, ORG_CLASSES } from './types.ts';
import { buildAlnumSearchView, buildSearchView, toCanonicalSpan } from './normalize.ts';

// ---------------------------------------------------------------------------------------------
// 6.2.1 · Familia del marcador
// ---------------------------------------------------------------------------------------------

const ORG_SET: ReadonlySet<string> = new Set(ORG_CLASSES);
const FLAG_SET: ReadonlySet<string> = new Set(FLAG_TYPES);
const PERSON_ROLES: ReadonlySet<string> = new Set(['DEMANDANTE', 'DEMANDADO', 'TESTIGO', 'PACIENTE', 'CLIENTE', 'CONTACTO', 'OTRA_PERSONA']);
const NEUTRAL_DOC: ReadonlySet<string> = new Set(['TI', 'CE', 'PPT', 'PEP']);
const OWN_FAMILY: ReadonlySet<string> = new Set(['CC', 'PASAPORTE', 'NIT', 'TP', 'DOCUMENTO', 'TELEFONO', 'CORREO', 'PLACA',
  'MATRICULA', 'HC', 'AFILIACION', 'FECHA', 'VALOR', 'DEPARTAMENTO']);
const isOrg = (t: string): boolean => ORG_SET.has(t);

/** Total sobre DetectableType (6.2.1); undefined para un FlagType (INV-E03). */
export function familyFor(type: DetectableType, role?: Role, opts?: { marcadorEspecifico?: boolean }): MarkerFamily {
  if (type === 'PERSONA') return (role !== undefined && PERSON_ROLES.has(role) && role !== 'OTRA_PERSONA' ? role : 'PERSONA') as MarkerFamily;
  if (isOrg(type)) return (role !== undefined && isOrg(role) ? role : type) as MarkerFamily;
  if (NEUTRAL_DOC.has(type)) return (opts?.marcadorEspecifico === true ? type : 'DOCUMENTO') as MarkerFamily;
  if (OWN_FAMILY.has(type)) return type as MarkerFamily;
  switch (type) {
    case 'RADICADO': case 'RADICADO_ADMIN': return 'RADICADO';
    case 'DIRECCION': case 'BARRIO': case 'LUGAR': return 'DIRECCION';
    case 'CUENTA': case 'TARJETA': return 'CUENTA';
    case 'MUNICIPIO': return 'DEPARTAMENTO';
    default: return undefined as unknown as MarkerFamily;
  }
}

/** 6.2.4 · Precedencia según la fuente, el validador y el rótulo (INV-R04). La usan merge.ts y el reductor. */
export function precedenceOf(c: Pick<DetectionCandidate, 'source' | 'validator' | 'label'>): Detection['precedence'] {
  switch (c.source) {
    case 'manual': return 1;
    case 'lista': return 2;
    case 'modelo': return 6;
    case 'regla': {
      const v = c.validator;
      if (v !== undefined && v.passed) {
        if (v.name === 'DV_NIT' || v.name === 'RADICADO' || v.name === 'CORREO') return 3;
        if (v.name === 'LUHN' && c.label !== undefined) return 3;
      }
      return c.label !== undefined ? 4 : 5;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 6.6.1 y 7.12.1 · Claves canónicas
// ---------------------------------------------------------------------------------------------

const FW_SET: ReadonlySet<string> = new Set('de|del|la|las|los|el|lo|y|e|o|u|a|al|en|por|para|con|sin|su|sus|que|se|un|una|unos|unas'.split('|'));
const SUFIJO = String.raw`(?:s\. ?a\. ?s\.?|s ?a ?s|s\. ?a\.?|s ?a|ltda\.?|limitada|e\. ?s\. ?p\.?|esp|e\. ?s\. ?e\.?|e\. ?u\.?|(?:&|y) ?cia\.?(?: ?s\. ?en ?c\.?)?|s\. ?en ?c\.?(?: ?s\.?)?|s\. ?c\. ?a\.?|sociedad por acciones simplificada|sociedad anonima|empresa unipersonal)`;
const RE_SUFIJO_FINAL = new RegExp(String.raw`(?:,? )(?:` + SUFIJO + String.raw`)$`, 'u');   // R-LST-05
const SALUD = String.raw`(?<![\p{L}\p{N}])(?:e\. ?p\. ?s\.?|eps|i\. ?p\. ?s\.?|ips)(?![\p{L}\p{N}])`;   // R-LST-06
const RE_SALUD_FIRST = new RegExp(SALUD, 'u');
const RE_SALUD_ALL = new RegExp(SALUD, 'gu');   // solo con replace
const RE_TEL_PAIS = /^(?:00)?57(?=(?:3[0-9]{9}|60[1245678][0-9]{7})$)/u;   // R-ENT-01
const NIT_PESOS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

const fold = (s: string, kind: PartKind): string => buildSearchView(s, 'lista', kind).text;
const digitsOf = (s: string): string => s.replace(/[^0-9]/gu, '');
const alnumOf = (s: string, kind: PartKind): string => buildAlnumSearchView(s, kind).text;

/** DV del NIT (7.2.2): pesos 3, 7, 13… de derecha a izquierda, módulo 11. */
export function nitCheckDigit(base: string): number {
  let s = 0;
  for (let k = 0; k < base.length; k++) s += Number(base[base.length - 1 - k]) * (NIT_PESOS[k] ?? 0);
  const r = s % 11;
  return r <= 1 ? r : 11 - r;
}
export function personKey(text: string, kind: PartKind = 'cuerpo'): string {
  return 'PER:' + fold(text, kind).replace(/[^\p{L}\p{N} -]+/gu, ' ').replace(/ +/gu, ' ').trim();
}
export function orgKey(text: string, kind: PartKind = 'cuerpo'): string {
  let f = fold(text, kind).trim().replace(RE_SUFIJO_FINAL, '');
  const h = RE_SALUD_FIRST.exec(f);
  const clase = h === null ? '' : h[0].replace(/[^a-z]/gu, '') === 'eps' ? 'EPS:' : 'IPS:';
  f = f.replace(RE_SALUD_ALL, ' ').replace(/[^\p{L}\p{N}& ]+/gu, ' ').replace(/ +/gu, ' ').trim();
  return `ORG:${clase}${f}`;
}
export function phoneKey(text: string): string {
  const nat = digitsOf(text).replace(RE_TEL_PAIS, '');
  return nat.length === 7 ? `TEL:${nat}` : `TEL:${nat.slice(-10)}`;
}
/** 7.12.1 · NIT; `ccDigits`: CC del documento o de la tabla del asunto (NIT de 9 dígitos sin separador). */
export function nitKey(text: string, ccDigits: ReadonlySet<string> = new Set()): string {
  const m = /^([0-9][0-9.\s]*[0-9])\s*[-\s]\s*([0-9])$/u.exec(text.trim());
  if (m !== null) return `NIT:${digitsOf(m[1] as string)}`;
  const d = digitsOf(text);
  if (d.length === 10 && /^[89]/u.test(d)) return `NIT:${d.slice(0, 9)}`;
  if (d.length === 9 && /^[89]/u.test(d)) {
    const cc = d.slice(0, 8);
    return nitCheckDigit(cc) === Number(d[8]) && ccDigits.has(cc) ? `NIT:${cc}` : `NIT:${d}`;
  }
  if (d.length === 9 || d.length === 11) return `NIT:${d.slice(0, -1)}`;
  return `NIT:${d}`;
}
const PREFIX: Partial<Record<DetectableType, string>> = {
  RADICADO: 'RAD', RADICADO_ADMIN: 'RAD', TELEFONO: 'TEL', DIRECCION: 'DIR', MATRICULA: 'MAT', AFILIACION: 'AFIL',
  TARJETA: 'CUENTA', MUNICIPIO: 'DEP', DEPARTAMENTO: 'DEP',
};
/** Normalizador del tipo (7.12.6, `cambiar_tipo` y `agregar_manual`); si no se puede, `<PREFIJO>:~<vista lista>`. */
export function canonicalKeyFor(type: DetectableType, text: string, kind: PartKind = 'cuerpo', ccDigits?: ReadonlySet<string>): string {
  const loose = `${PREFIX[type] ?? type}:~${fold(text, kind).trim()}`;
  const d = digitsOf(text); const a = alnumOf(text, kind);
  if (type === 'PERSONA') return personKey(text, kind);
  if (isOrg(type)) return orgKey(text, kind);
  switch (type) {
    case 'CC': case 'TI': case 'CE': case 'PPT': case 'PEP': case 'HC': case 'TP': return d === '' ? loose : `${type}:${d}`;
    case 'DOCUMENTO': case 'PASAPORTE': case 'PLACA': return a === '' ? loose : `${type}:${a}`;
    case 'AFILIACION': return a === '' ? loose : `AFIL:${a}`;
    case 'NIT': return d === '' ? loose : nitKey(text, ccDigits);
    case 'TELEFONO': return d === '' ? loose : phoneKey(text);
    case 'CORREO': return `CORREO:${text.trim().toLowerCase()}`;
    case 'RADICADO': return d === '' ? loose : `RAD:${d}`;
    case 'RADICADO_ADMIN': return a === '' ? loose : `RAD:${a}`;
    case 'CUENTA': case 'TARJETA': return d === '' ? loose : `CUENTA:${d}`;
    case 'MATRICULA': {
      const m = /([0-9]{2,3}[A-Z]?) ?- ?([0-9]+)/u.exec(text.toUpperCase());
      return m === null ? loose : `MAT:${m[1] as string}-${m[2] as string}`;
    }
    case 'BARRIO': case 'LUGAR': return `${type}:${fold(text, kind).trim()}`;
    default: return loose;   // DIRECCION, FECHA, VALOR, MUNICIPIO, DEPARTAMENTO: los normalizan sus reglas
  }
}

/** Forma corta judicial («Rad. 2026-00123») → clave del radicado completo con igual año, consecutivo y recurso (7.2). */
function fullRadicadoKey(shortKey: string, fullKeys: readonly string[]): string {
  const s = shortKey.slice(4);
  if (!/^[0-9]{7,11}$/u.test(s)) return shortKey;
  const hits = new Set<string>();
  for (const k of fullKeys) {
    const f = k.slice(4);
    if (!/^[0-9]{21}$|^[0-9]{23}$/u.test(f)) continue;
    const year = f.slice(12, 16); const cons = f.slice(16, 21); const rec = f.slice(21);
    if (!s.startsWith(year)) continue;
    const r = s.slice(4);
    for (const recLen of rec === '' ? [0] : [0, 2]) {
      const c = r.slice(0, r.length - recLen); const rr = r.slice(r.length - recLen);
      if (c.length >= 3 && c.length <= 5 && Number(c) === Number(cons) && (recLen === 0 || rr === rec)) hits.add(k);
    }
  }
  return hits.size === 1 ? [...hits][0] as string : shortKey;
}

// ---------------------------------------------------------------------------------------------
// Utilidades del estado
// ---------------------------------------------------------------------------------------------

const ROTULO_TEMPLATE = 'documento de identidad';
const TEMPLATE_M = '{m}';
/** B-7 · `edt` de una sugerencia o bandera: sale de IdSource una sola vez y queda en `Suggestion.spanEditId` o
 *  `Flag.spanEditId` (6.1.4); la sugerencia lo conserva aunque se deshaga, así la ida y vuelta de `especificar_documento`
 *  (INV-R10) deja el estado igual. Se descarta uno que ya use otra edición o que tenga reservado una sugerencia o bandera;
 *  un IdSource que repite ids da null y no un bucle infinito. */
function freshEditId(state: ReviewState, ids: IdSource): SpanEditId | null {
  const taken = new Set<string>([...Object.keys(state.spanEdits),
    ...Object.values(state.suggestions).flatMap((x) => x.spanEditId ?? []), ...Object.values(state.flags).flatMap((x) => x.spanEditId ?? [])]);
  for (let i = 0; i < 8; i++) {
    const id = ids.next('edt');
    if (!taken.has(id)) return id as SpanEditId;
  }
  return null;
}
const sameOrigin = (a: SpanEdit, b: SpanEdit): boolean => (a.origin.kind === 'sugerencia'
  ? b.origin.kind === 'sugerencia' && a.origin.suggestionId === b.origin.suggestionId
  : b.origin.kind === 'bandera' && a.origin.flagId === b.origin.flagId);

/** IdSource por defecto: 16 bytes de crypto.getRandomValues (6.1.4). */
export const cryptoIds: IdSource = {
  next(prefix) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return `${prefix}_${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
  },
};

const overlaps = (a: Span, b: Span): boolean => a.partId === b.partId && a.start < b.end && b.start < a.end;
const contains = (outer: Span, inner: Span): boolean => outer.partId === inner.partId && outer.start <= inner.start && inner.end <= outer.end;
const spanOf = (d: Detection): Span => ({ partId: d.partId, start: d.start, end: d.end });
const isFixed = (e: Entity, table: TableIndex): boolean =>
  table.byKey[e.canonicalKey] !== undefined || e.markerState === 'heredado' || e.markerState === 'definitivo';

/** 6.6.2: una mención usa marcador si está pendiente, o aceptada, no cubierta y su plantilla final lleva {m}. */
function usesMarker(d: Detection): boolean {
  if (d.status === 'pendiente') return true;
  return d.status === 'aceptada' && d.coveredBy === undefined
    && (d.replacement.generalized?.template ?? d.replacement.proposedTemplate).includes(TEMPLATE_M);
}

/** Orden de lectura: (part.order, start). Sin el documento, el orden de una parte es el de su primera aparición. */
function sortOrder(state: ReviewState, partOrder: ReadonlyMap<PartId, number>): void {
  const seen = new Map<PartId, number>();
  for (const id of state.order) { const d = state.detections[id]; if (d !== undefined && !seen.has(d.partId)) seen.set(d.partId, seen.size); }
  const po = (p: PartId): number => partOrder.get(p) ?? (seen.has(p) ? 1e6 + (seen.get(p) as number) : 2e6);
  state.order = Object.values(state.detections)
    .sort((a, b) => po(a.partId) - po(b.partId) || a.start - b.start || a.end - b.end || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((d) => d.id);
}

/** 6.6.2 · assignMarkers: numeración de la vista previa sobre la tabla base del asunto (7.12.4). */
export function assignMarkers(table: TableIndex, state: ReviewState): void {
  const pos = new Map(state.order.map((id, i) => [id, i]));
  const first = new Map<EntityId, number>();
  for (const e of Object.values(state.entities)) {
    e.mentions = e.mentions.filter((m) => state.detections[m] !== undefined).sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0));
    const u = e.mentions.find((m) => usesMarker(state.detections[m] as Detection));
    if (u !== undefined) first.set(e.id, pos.get(u) ?? 0);
  }
  const next: Partial<Record<MarkerFamily, number>> = { ...table.counters };
  const used = [...first.entries()].sort((a, b) => a[1] - b[1]);
  for (const [id] of used) {
    const e = state.entities[id] as Entity;
    const inherited = table.byKey[e.canonicalKey];
    if (inherited !== undefined) {
      e.marker = inherited;
      e.markerState = e.markerState === 'definitivo' ? 'definitivo' : 'heredado';
    } else {
      const n = (next[e.family] ?? 0) + 1;
      next[e.family] = n;
      e.marker = `[${MARKER_LABEL[e.family]}_${n}]`;
      e.markerState = 'vista_previa';
    }
  }
  for (const e of Object.values(state.entities)) if (!first.has(e.id)) { delete e.marker; delete e.markerState; }
}

/** Quita entidades sin menciones y deja `sameHolderAs` simétrico entre las que quedan (INV-T05). */
function tidyEntities(state: ReviewState): void {
  for (const e of Object.values(state.entities)) {
    e.mentions = e.mentions.filter((m) => state.detections[m]?.entityId === e.id);
    if (e.mentions.length === 0) delete state.entities[e.id];
  }
  for (const e of Object.values(state.entities)) e.sameHolderAs = e.sameHolderAs.filter((x) => x !== e.id && state.entities[x] !== undefined);
  for (const e of Object.values(state.entities)) for (const x of e.sameHolderAs) {
    const o = state.entities[x] as Entity;
    if (!o.sameHolderAs.includes(e.id)) o.sameHolderAs.push(e.id);
  }
  for (const e of Object.values(state.entities)) e.sameHolderAs.sort();
}

// ---------------------------------------------------------------------------------------------
// 7.12.3 · Mismo titular
// ---------------------------------------------------------------------------------------------

function holderDigitsOf(e: Entity, naturalNit: ReadonlySet<EntityId>): string | null {
  const v = e.canonicalKey.slice(e.canonicalKey.indexOf(':') + 1);
  switch (e.type) {
    case 'CC': case 'TI': case 'CE': case 'PPT': case 'PEP': case 'HC': return /^[0-9]+$/u.test(v) ? v : null;
    case 'DOCUMENTO': case 'AFILIACION': return /^[0-9]+$/u.test(v) ? v : null;
    case 'NIT': return /^[0-9]+$/u.test(v) && (naturalNit.has(e.id) || !(v.length === 9 && /^[89]/u.test(v))) ? v : null;
    default: return null;
  }
}
function linkHolders(state: ReviewState, naturalNit: ReadonlySet<EntityId>): void {
  const by = new Map<string, EntityId[]>();
  for (const e of Object.values(state.entities)) {
    const d = holderDigitsOf(e, naturalNit);
    if (d !== null) by.set(d, [...(by.get(d) ?? []), e.id]);
  }
  for (const group of by.values()) for (const id of group) {
    const e = state.entities[id] as Entity;
    for (const o of group) if (o !== id && !e.sameHolderAs.includes(o)) e.sameHolderAs.push(o);
  }
}

// ---------------------------------------------------------------------------------------------
// Construcción del conjunto de detecciones (7.12.2) y del estado de revisión
// ---------------------------------------------------------------------------------------------

export interface BuildContext {
  table: TableIndex; caseList: readonly CaseEntity[]; ids: IdSource;
  /** Sugerencias y banderas de generalize.ts (PG-4); las banderas ROTULO_TI se vinculan a la sugerencia preaplicada. */
  suggestions?: readonly Suggestion[]; flags?: readonly Flag[];
}
const ORG_SPECIFICITY: readonly string[] = ['EPS', 'IPS', 'ENTIDAD', 'PROVEEDOR', 'EMPRESA'];

/** MergedCandidate[] de todas las partes → DetectionSet (Detection y Entity nuevas, sugerencias del rótulo preaplicadas).
 *  Los MUNICIPIO no son detecciones: generalize.ts los convierte en sugerencias (6.2.1). */
export function buildDetectionSet(doc: DocumentModel, merged: readonly MergedCandidate[], ctx: BuildContext): DetectionSet & { spanEdits: SpanEdit[] } {
  const parts = new Map(doc.parts.map((p) => [p.id, p]));
  const cands = merged.filter((c) => parts.has(c.partId) && c.type !== 'MUNICIPIO' && !FLAG_SET.has(c.type))
    .sort((a, b) => (parts.get(a.partId) as Part).order - (parts.get(b.partId) as Part).order || a.start - b.start || a.end - b.end);
  const fullRad = [...new Set([...cands.map((c) => c.canonicalKey), ...Object.keys(ctx.table.byKey)])].filter((k) => k.startsWith('RAD:'));
  const state: ReviewState = { docId: doc.id, revision: 0, detections: {}, order: [], entities: {}, suggestions: {}, flags: {},
    spanEdits: {}, committed: false, modelo: { kind: 'en_curso', ventanas: 0, ventanasTotales: 0 } };
  const byKey = new Map<string, Entity>();
  const naturalNit = new Set<EntityId>();
  for (const c of cands) {
    const part = parts.get(c.partId) as Part;
    const key = c.type === 'RADICADO' ? fullRadicadoKey(c.canonicalKey, fullRad) : c.canonicalKey;
    let e = byKey.get(key);
    if (e === undefined) {
      const ce = c.caseEntityId === undefined ? undefined : ctx.caseList.find((x) => x.id === c.caseEntityId);
      e = { id: ctx.ids.next('ent') as EntityId, canonicalKey: key, type: c.type as DetectableType, family: 'PERSONA',
        marcadorEspecifico: false, mentions: [], sameHolderAs: [], display: ce?.name ?? part.text.slice(c.start, c.end) };
      if (ce !== undefined) { e.caseEntityId = ce.id; e.role = ce.role; }
      byKey.set(key, e); state.entities[e.id] = e;
    }
    const det: Detection = {
      id: ctx.ids.next('det') as DetectionId, docId: doc.id, partId: c.partId, start: c.start, end: c.end,
      text: part.text.slice(c.start, c.end), type: c.type as DetectableType, source: c.source, precedence: c.precedence,
      confidence: c.confidence, score: c.score, canonicalKey: c.canonicalKey, status: 'pendiente', entityId: e.id,
      replacement: { proposedTemplate: TEMPLATE_M },
    };
    for (const f of ['role', 'ruleId', 'caseEntityId', 'variantClass', 'nerLabel', 'label', 'validator'] as const) {
      if (c[f] !== undefined) (det as unknown as Record<string, unknown>)[f] = c[f];
    }
    if (c.type === 'NIT' && c.holderDigits !== undefined) naturalNit.add(e.id);
    state.detections[det.id] = det; e.mentions.push(det.id); state.order.push(det.id);
  }
  for (const e of Object.values(state.entities)) settleEntity(e, state, ctx.table);
  corefPersons(state);
  linkHolders(state, naturalNit);
  tidyEntities(state);
  preapplyRotulo(state, parts, ctx);
  adoptSuggestions(state, ctx.suggestions ?? [], ctx.ids);
  for (const f of ctx.flags ?? []) state.flags[f.id] = linkRotuloFlag({ ...f }, state);
  assignMarkers(ctx.table, state);
  return { detections: state.order.map((id) => state.detections[id] as Detection), entities: Object.values(state.entities),
    flags: Object.values(state.flags), suggestions: Object.values(state.suggestions), spanEdits: Object.values(state.spanEdits) };
}

/** Tipo, rol, familia y especificidad de una entidad recién agrupada (6.6.1, 6.6.2, 6.4.5). */
function settleEntity(e: Entity, state: ReviewState, table: TableIndex): void {
  const ds = e.mentions.map((m) => state.detections[m] as Detection);
  if (e.canonicalKey.startsWith('DEP:')) e.type = 'DEPARTAMENTO';
  else if (isOrg(e.type)) {
    const best = ORG_SPECIFICITY.find((t) => ds.some((d) => d.type === t)) ?? e.type;
    e.type = (e.role !== undefined && isOrg(e.role) ? e.role : best) as DetectableType;
    e.role = e.type as Role;
  } else if (e.type === 'PERSONA' && e.role === undefined) e.role = ds.find((d) => d.role !== undefined)?.role ?? 'OTRA_PERSONA';
  const inherited = table.byKey[e.canonicalKey];
  e.marcadorEspecifico = NEUTRAL_DOC.has(e.type) && inherited !== undefined && inherited.startsWith(`[${e.type}_`);
  e.family = familyFor(e.type, e.role, { marcadorEspecifico: e.marcadorEspecifico });
}

/** 7.12.2.4 · Correferencia: PER: de 1 o 2 palabras cuyas palabras están todas en una sola PER: más larga. */
function corefPersons(state: ReviewState): void {
  const words = (k: string): string[] => k.slice(4).split(/[ -]+/u).filter((w) => w !== '' && !FW_SET.has(w));
  const per = Object.values(state.entities).filter((e) => e.type === 'PERSONA' && e.canonicalKey.startsWith('PER:'));
  for (const short of per) {
    const w = words(short.canonicalKey);
    if (w.length < 1 || w.length > 2) continue;
    const hosts = per.filter((o) => o !== short && words(o.canonicalKey).length > w.length
      && w.every((x) => words(o.canonicalKey).includes(x)));
    if (hosts.length !== 1) continue;
    const host = hosts[0] as Entity;
    for (const m of short.mentions) {
      const d = state.detections[m] as Detection;
      d.entityId = host.id; d.confidence = 'baja';
      host.mentions.push(m);
    }
    short.mentions = [];
  }
}

/** 6.4.5 · Preaplicación: cada mención TI, CE, PPT o PEP con rótulo de una entidad neutra nace con la sugerencia aplicada. */
function preapplyRotulo(state: ReviewState, parts: ReadonlyMap<PartId, Part>, ctx: BuildContext): void {
  for (const id of state.order) {
    const d = state.detections[id] as Detection;
    const e = state.entities[d.entityId] as Entity;
    if (!NEUTRAL_DOC.has(d.type) || d.label === undefined || e.marcadorEspecifico) continue;
    const span: Span = { partId: d.partId, start: d.label.start, end: d.label.end };
    if (span.end <= span.start || Object.values(state.detections).some((o) => overlaps(spanOf(o), span) && !contains(span, spanOf(o)))) continue;
    const part = parts.get(d.partId) as Part;
    const sug: Suggestion = { id: ctx.ids.next('sug') as SuggestionId, kind: 'ROTULO_DOCUMENTO_A_GENERICO',
      target: { kind: 'tramo', span, relatedDetectionId: d.id }, originalText: part.text.slice(span.start, span.end),
      options: [{ id: 'o1', kind: 'ROTULO_DOCUMENTO_A_GENERICO', template: ROTULO_TEMPLATE }], status: 'pendiente' };
    state.suggestions[sug.id] = sug;
    applySpanSuggestion(state, sug, sug.options[0] as SuggestionOption, ctx.ids);
  }
}
/** Sugerencias de generalize.ts (PG-4). La ROTULO_DOCUMENTO_A_GENERICO que PG-4 también emite preaplicada reemplaza a la
 *  propia del mismo rótulo (se conserva su id, que citan sus banderas) y recibe su edición de tramo; si la entidad ya es
 *  específica por la tabla del asunto, queda descartada (6.4.5). */
function adoptSuggestions(state: ReviewState, incoming: readonly Suggestion[], ids: IdSource): void {
  for (const s0 of incoming) {
    if (state.suggestions[s0.id] !== undefined) continue;
    const s: Suggestion = structuredClone(s0);
    if (s.kind !== 'ROTULO_DOCUMENTO_A_GENERICO' || s.target.kind !== 'tramo') { state.suggestions[s.id] = s; continue; }
    const span = s.target.span;
    const own = Object.values(state.suggestions).find((x) => x.kind === 'ROTULO_DOCUMENTO_A_GENERICO' && x.target.kind === 'tramo' && overlaps(x.target.span, span));
    const rel = s.target.relatedDetectionId ?? (own?.target.kind === 'tramo' ? own.target.relatedDetectionId : undefined)
      ?? Object.values(state.detections).find((d) => d.label !== undefined && overlaps({ partId: d.partId, start: d.label.start, end: d.label.end }, span))?.id;
    if (rel !== undefined) s.target.relatedDetectionId = rel;
    if (own !== undefined) { unapplySuggestion(state, own); delete state.suggestions[own.id]; }
    const wanted = s.status === 'aplicada';
    s.status = 'pendiente'; delete s.chosenOptionId;
    state.suggestions[s.id] = s;
    const ent = rel === undefined ? undefined : state.entities[state.detections[rel]?.entityId ?? ('' as EntityId)];
    if (ent?.marcadorEspecifico === true) { s.status = 'descartada'; continue; }
    const o = s.options.find((x) => x.id === s0.chosenOptionId) ?? s.options[0];
    if (wanted && o !== undefined && applySpanSuggestion(state, s, o, ids) !== null) { s.status = 'pendiente'; delete s.chosenOptionId; }
  }
}
function linkRotuloFlag(f: Flag, state: ReviewState): Flag {
  if (f.reason !== 'ROTULO_TI' || f.suggestionId !== undefined) return f;
  const s = Object.values(state.suggestions).find((x) => x.kind === 'ROTULO_DOCUMENTO_A_GENERICO' && x.target.kind === 'tramo'
    && overlaps(x.target.span, f.span));
  if (s !== undefined && s.target.kind === 'tramo') {
    f.suggestionId = s.id;
    if (f.detectionId === undefined && s.target.relatedDetectionId !== undefined) f.detectionId = s.target.relatedDetectionId;
  }
  return f;
}

/** Estado de revisión inicial de un documento (6.4.4). */
export function buildReviewState(doc: DocumentModel, merged: readonly MergedCandidate[], ctx: BuildContext & { modelo?: ModelProgress }): ReviewState {
  const set = buildDetectionSet(doc, merged, ctx);
  return {
    docId: doc.id, revision: 0, detections: Object.fromEntries(set.detections.map((d) => [d.id, d])),
    order: set.detections.map((d) => d.id), entities: Object.fromEntries(set.entities.map((e) => [e.id, e])),
    suggestions: Object.fromEntries(set.suggestions.map((s) => [s.id, s])), flags: Object.fromEntries(set.flags.map((f) => [f.id, f])),
    spanEdits: Object.fromEntries(set.spanEdits.map((s) => [s.id, s])), committed: false,
    modelo: ctx.modelo ?? { kind: 'en_curso', ventanas: 0, ventanasTotales: 0 },
  };
}

// ---------------------------------------------------------------------------------------------
// Ediciones de tramo y sugerencias (6.4.5, 6.4.7)
// ---------------------------------------------------------------------------------------------

/** Edición de tramo: no corta a medias una detección no rechazada ni otra edición; cubre las contenidas. Una edición de
 *  otro origen con el mismo id nunca se omite en la comprobación ni se sobrescribe (B-7). */
function placeSpanEdit(state: ReviewState, edit: SpanEdit): ReviewError | null {
  const prev = state.spanEdits[edit.id];
  if (prev !== undefined && !sameOrigin(prev, edit)) return 'SOLAPAMIENTO_PARCIAL';
  const bad = Object.values(state.detections).some((d) => d.status !== 'rechazada' && overlaps(spanOf(d), edit.span) && !contains(edit.span, spanOf(d)))
    || Object.values(state.spanEdits).some((s) => s.id !== edit.id && overlaps(s.span, edit.span));
  if (bad) return 'SOLAPAMIENTO_PARCIAL';
  state.spanEdits[edit.id] = edit;
  for (const d of Object.values(state.detections)) if (contains(edit.span, spanOf(d))) d.coveredBy = edit.id;
  return null;
}
function removeSpanEdit(state: ReviewState, id: SpanEditId): void {
  delete state.spanEdits[id];
  for (const d of Object.values(state.detections)) if (d.coveredBy === id) delete d.coveredBy;
}
function applySpanSuggestion(state: ReviewState, s: Suggestion, o: SuggestionOption, ids: IdSource): ReviewError | null {
  if (s.target.kind !== 'tramo') return 'NO_ENCONTRADO';
  const id = s.spanEditId ?? freshEditId(state, ids);   // B-7: de IdSource una sola vez; se reutiliza al reaplicar
  if (id === null) return 'SOLAPAMIENTO_PARCIAL';
  const err = placeSpanEdit(state, { id, span: s.target.span, originalText: s.originalText, text: o.template,
    origin: { kind: 'sugerencia', suggestionId: s.id } });
  if (err !== null) return err;
  s.spanEditId = id; s.status = 'aplicada'; s.chosenOptionId = o.id;
  return null;
}
/** Deshace la aplicación de una sugerencia (edición de tramo, generalización o detección creada). Conserva su
 *  `spanEditId` (INV-R10). */
function unapplySuggestion(state: ReviewState, s: Suggestion): void {
  const id = s.spanEditId;
  const o = id === undefined ? undefined : state.spanEdits[id]?.origin;
  if (id !== undefined && o?.kind === 'sugerencia' && o.suggestionId === s.id) removeSpanEdit(state, id);   // nunca la de otro origen (B-7)
  for (const d of Object.values(state.detections)) {
    if (d.replacement.generalized?.suggestionId === s.id) delete d.replacement.generalized;
    if (d.suggestionId === s.id) delete state.detections[d.id];
  }
}

// ---------------------------------------------------------------------------------------------
// 6.6.3 y 6.6.4 · Tabla del asunto y consolidación
// ---------------------------------------------------------------------------------------------

export function tableIndexOf(table: MappingTable): TableIndex {
  const byKey: Record<string, string> = {};
  for (const e of Object.values(table.entries)) byKey[e.canonicalKey] = e.marker;
  return { byKey, counters: { ...table.counters }, documentCount: table.documents.length };
}
export function emptyTable(asuntoId: MappingTable['asuntoId']): MappingTable {
  return { asuntoId, counters: {}, entries: {}, documents: [] };
}

/** Primer copiar o exportar con exportGate.ok (6.6.4): vista_previa → definitivo y tabla actualizada. Pura. */
export function consolidate(table: MappingTable, state: ReviewState, doc: DocumentModel, processedAt: IsoDateTime): { table: MappingTable; state: ReviewState } {
  const t: MappingTable = structuredClone(table);
  const s: ReviewState = structuredClone(state);
  const parts = new Map(doc.parts.map((p) => [p.id, p]));
  for (const id of s.order) {
    const d = s.detections[id] as Detection;
    const e = s.entities[d.entityId];
    if (e?.marker === undefined || !usesMarker(d)) continue;
    let entry: MappingEntry | undefined = t.entries[e.marker];
    if (entry === undefined) {
      const part = parts.get(d.partId);
      entry = { marker: e.marker, family: e.family, type: e.type, canonicalKey: e.canonicalKey, display: e.display, originals: [],
        firstSeen: { docId: doc.id, partKind: part?.kind ?? 'cuerpo', partOrder: part?.order ?? 0, start: d.start }, documents: [], sameHolderAs: [] };
      if (e.role !== undefined) entry.role = e.role;
      if (e.caseEntityId !== undefined) entry.caseEntityId = e.caseEntityId;
      t.entries[e.marker] = entry;
      const n = Number(/_([0-9]+)\]$/u.exec(e.marker)?.[1] ?? 0);
      t.counters[e.family] = Math.max(t.counters[e.family] ?? 0, n);
    }
    if (!entry.originals.includes(d.text)) entry.originals.push(d.text);
    if (!entry.documents.includes(doc.id)) entry.documents.push(doc.id);
    if (e.markerState === 'vista_previa') e.markerState = 'definitivo';
  }
  for (const e of Object.values(s.entities)) {
    const entry = e.marker === undefined ? undefined : t.entries[e.marker];
    if (entry === undefined) continue;
    for (const o of e.sameHolderAs) {
      const om = s.entities[o]?.marker;
      const other = om === undefined ? undefined : t.entries[om];
      if (other === undefined) continue;
      if (!entry.sameHolderAs.includes(other.marker)) entry.sameHolderAs.push(other.marker);
      if (!other.sameHolderAs.includes(entry.marker)) other.sameHolderAs.push(entry.marker);
    }
  }
  if (!t.documents.some((r) => r.docId === doc.id)) t.documents.push({ docId: doc.id, label: doc.label, source: doc.source, processedAt });
  s.committed = true;
  return { table: t, state: s };
}

// ---------------------------------------------------------------------------------------------
// 6.4.4 y 7.12.6 · Reductor
// ---------------------------------------------------------------------------------------------

/** ctx de ApplyReviewActionFn más dos campos opcionales: `doc` (texto de las partes, para `agregar_manual` e
 *  `incorporar_residuos`, y su orden de lectura) e `ids` (por defecto, crypto.getRandomValues). */
export interface ReviewContext { table: TableIndex; caseList: readonly CaseEntity[]; doc?: DocumentModel; ids?: IdSource }

const fail = (code: ReviewError): ReviewOutcome => ({ ok: false, code });
const roleAllowed = (type: DetectableType, role: Role): boolean =>
  type === 'PERSONA' ? PERSON_ROLES.has(role) : isOrg(type) ? isOrg(role) : false;

function finalText(d: Detection, e: Entity | undefined): string {
  return (d.replacement.generalized?.template ?? d.replacement.proposedTemplate).split(TEMPLATE_M).join(e?.marker ?? '');
}
function setStatus(d: Detection, status: Detection['status'], by: 'individual' | 'grupo', reason?: Detection['rejectReason']): void {
  d.status = status; d.decidedBy = by;
  if (status === 'rechazada') d.rejectReason = reason ?? 'SIN_MOTIVO'; else delete d.rejectReason;
  if (status !== 'editada') delete d.replacement.edited;
}
function newEntity(state: ReviewState, ids: IdSource, key: string, d: Detection, role?: Role): Entity {
  const e: Entity = { id: ids.next('ent') as EntityId, canonicalKey: key, type: key.startsWith('DEP:') ? 'DEPARTAMENTO' : d.type,
    family: 'PERSONA', marcadorEspecifico: false, mentions: [], sameHolderAs: [], display: d.text };
  if (d.type === 'PERSONA') e.role = role !== undefined && PERSON_ROLES.has(role) ? role : 'OTRA_PERSONA';
  else if (isOrg(d.type)) e.role = (role !== undefined && isOrg(role) ? role : d.type) as Role;
  e.family = familyFor(e.type, e.role);
  state.entities[e.id] = e;
  return e;
}
function attach(state: ReviewState, d: Detection, e: Entity): void {
  const prev = state.entities[d.entityId];
  if (prev !== undefined && prev.id !== e.id) prev.mentions = prev.mentions.filter((m) => m !== d.id);
  d.entityId = e.id;
  if (!e.mentions.includes(d.id)) e.mentions.push(d.id);
}
const entityByKey = (state: ReviewState, key: string): Entity | undefined => Object.values(state.entities).find((e) => e.canonicalKey === key);

/** D-03 B · Variante débil de una sola palabra de la lista (`apellido_suelto` o `nombre_suelto`, sin blancos). La usa merge.ts. */
export function esVarianteDebil(c: { source: DetectionCandidate['source']; variantClass?: DetectionCandidate['variantClass'] }, texto: string): boolean {
  return c.source === 'lista' && (c.variantClass === 'apellido_suelto' || c.variantClass === 'nombre_suelto') && !/\s/u.test(texto.trim());
}

/**
 * INV-R12, excepción D-03 · Una detección de la lista está **intacta** si el usuario no hizo ninguna acción sobre ella, según
 * lo que el estado de la revisión deja ver:
 * - `pendiente`, sin `decidedBy`, `rejectReason`, texto editado, generalización, `coveredBy` ni `suggestionId`
 *   (aceptar, rechazar, editar, aceptar_entidad, rechazar_entidad, aplicar una sugerencia);
 * - sigue en la entidad de su `caseEntityId`, con la clave `LISTA:<id>` en ella y en la entidad (separar_mencion, unir_entidades
 *   hacia otra, cambiar_tipo);
 * - el tipo y el rol de la detección y de la entidad son los de la lista del caso (cambiar_tipo, cambiar_rol);
 * - ninguna sugerencia, bandera ni edición de tramo la nombra o la toca.
 * Límite: `restablecer` devuelve la detección al estado de nacimiento sin dejar rastro (6.4.4), así que después de
 * aceptar y restablecer vuelve a contar como intacta; igual si se cambia el rol y se devuelve al de la lista.
 */
export function listaIntacta(state: ReviewState, d: Detection, caseList: readonly CaseEntity[]): boolean {
  if (d.source !== 'lista' || d.status !== 'pendiente' || d.caseEntityId === undefined) return false;
  if (d.decidedBy !== undefined || d.rejectReason !== undefined || d.replacement.edited !== undefined
    || d.replacement.generalized !== undefined || d.coveredBy !== undefined || d.suggestionId !== undefined) return false;
  const ce = caseList.find((c) => c.id === d.caseEntityId);
  const e = state.entities[d.entityId];
  if (ce === undefined || e === undefined) return false;
  const key = `LISTA:${ce.id}`;
  if (d.canonicalKey !== key || e.canonicalKey !== key || !e.mentions.includes(d.id)) return false;
  if (d.type !== (ce.kind === 'persona' ? 'PERSONA' : ce.role) || d.role !== ce.role || e.role !== ce.role) return false;
  for (const x of Object.values(state.suggestions)) {
    if ((x.target.kind === 'deteccion' ? x.target.detectionId : x.target.relatedDetectionId) === d.id) return false;
  }
  if (Object.values(state.flags).some((f) => f.detectionId === d.id)) return false;
  return !Object.values(state.spanEdits).some((x) => overlaps(x.span, spanOf(d)));
}

/**
 * D-03 B y E · ¿La detección `o` del estado cede ante la detección nueva `d0` de una ventana del modelo? Solo si es de la lista,
 * está intacta, `d0` la contiene y es más larga, y: (E) `d0` es la misma entidad de la lista con el nombre completo, o
 * (B) `o` es una variante débil de una palabra de otra entidad. La comprobación semántica (si el tramo es variante de la
 * entidad) la hizo la fusión (merge.ts); el reductor solo acota a quién se le puede quitar el tramo.
 */
export function cedeAnteModelo(state: ReviewState, o: Detection, d0: Detection, caseList: readonly CaseEntity[]): boolean {
  if (!contains(spanOf(d0), spanOf(o)) || o.end - o.start >= d0.end - d0.start || !listaIntacta(state, o, caseList)) return false;
  if (d0.source === 'lista' && d0.caseEntityId === o.caseEntityId) return true;
  return (d0.source === 'modelo' || d0.source === 'lista') && esVarianteDebil(o, o.text);
}

/** D-03 · Una detección de una ventana que contiene una de la lista: la propuesta de la fusión de extenderla o de que ceda. */
export function esPropuestaSobreLista(state: ReviewState, d0: Detection): boolean {
  return d0.source === 'lista' || Object.values(state.detections).some((o) => o.source === 'lista' && o.id !== d0.id
    && contains(spanOf(d0), spanOf(o)) && o.end - o.start < d0.end - d0.start);
}

/**
 * M-12 (PB-2-r5) · La extensión de la lista (D-03 E) pasa sobre una mención de la misma entidad que el usuario rechazó. El
 * rechazo dice que ese texto no es esa entidad, así que el nombre completo no se le vuelve a atribuir: el reductor descarta la
 * extensión e `incorporarModelo` la entrega como el tramo del modelo que es, con su propia entidad.
 */
export function extensionSobreRechazada(state: ReviewState, d0: Detection): boolean {
  return d0.source === 'lista' && d0.caseEntityId !== undefined && Object.values(state.detections).some((o) => o.status === 'rechazada'
    && o.source === 'lista' && o.caseEntityId === d0.caseEntityId && overlaps(spanOf(o), spanOf(d0)));
}
const blocks = (state: ReviewState, span: Span): boolean =>
  Object.values(state.detections).some((d) => d.status !== 'rechazada' && overlaps(spanOf(d), span))
  || Object.values(state.spanEdits).some((s) => overlaps(s.span, span));

/** Reductor puro de la revisión: devuelve un estado nuevo o un ReviewError; nunca modifica `state`. */
export function applyReviewAction(state: ReviewState, action: ReviewAction, ctx: ReviewContext): ReviewOutcome {
  const s: ReviewState = structuredClone(state);
  const ids = ctx.ids ?? cryptoIds;
  const parts = new Map((ctx.doc?.parts ?? []).map((p) => [p.id, p]));
  const partOrder = new Map([...parts.values()].map((p) => [p.id, p.order]));
  const r = reduce(s, action, ctx, ids, parts);
  if (r === 'IGNORADA') return { ok: true, state };
  if (r !== null) return fail(r);
  sortOrder(s, partOrder);
  tidyEntities(s);
  assignMarkers(ctx.table, s);
  s.revision = state.revision + 1;
  return { ok: true, state: s };
}

function reduce(s: ReviewState, a: ReviewAction, ctx: ReviewContext, ids: IdSource, parts: ReadonlyMap<PartId, Part>): ReviewError | 'IGNORADA' | null {
  switch (a.kind) {
    case 'aceptar': case 'rechazar': case 'editar': case 'restablecer': case 'separar_mencion': case 'cambiar_tipo': {
      const d = s.detections[a.detectionId];
      if (d === undefined) return 'NO_ENCONTRADO';
      const e = s.entities[d.entityId];
      if (a.kind === 'aceptar') setStatus(d, 'aceptada', 'individual');
      else if (a.kind === 'rechazar') setStatus(d, 'rechazada', 'individual', a.reason);
      else if (a.kind === 'editar') {
        if (a.text === finalText(d, e)) setStatus(d, 'aceptada', 'individual');
        else { setStatus(d, 'editada', 'individual'); d.replacement.edited = a.text; }
      } else if (a.kind === 'restablecer') {
        d.status = 'pendiente'; delete d.rejectReason; delete d.replacement.edited; delete d.decidedBy;
        if (d.suggestionId !== undefined) {
          const sug = s.suggestions[d.suggestionId];
          delete s.detections[d.id];
          if (sug !== undefined) { sug.status = 'pendiente'; delete sug.chosenOptionId; }
        }
      } else if (a.kind === 'separar_mencion') {
        if (e === undefined || !(e.type === 'PERSONA' || isOrg(e.type))) return 'TIPO_NO_PERMITIDO';
        const kind = parts.get(d.partId)?.kind ?? 'cuerpo';
        let key = e.type === 'PERSONA' ? personKey(d.text, kind) : orgKey(d.text, kind);
        if (key === e.canonicalKey) key += '~sep';
        const target = entityByKey(s, key) ?? newEntity(s, ids, key, { ...d, type: e.type }, e.type === 'PERSONA' ? 'OTRA_PERSONA' : undefined);
        delete d.caseEntityId; d.canonicalKey = key;
        attach(s, d, target);
      } else if (a.kind === 'cambiar_tipo') {
        if (FLAG_SET.has(a.type)) return 'TIPO_NO_PERMITIDO';
        const key = canonicalKeyFor(a.type, d.text, parts.get(d.partId)?.kind ?? 'cuerpo');
        d.type = a.type; d.canonicalKey = key;
        if (d.type !== 'PERSONA' && !isOrg(d.type)) delete d.role;
        attach(s, d, entityByKey(s, key) ?? newEntity(s, ids, key, d, d.role));
      }
      return null;
    }
    case 'aceptar_entidad': case 'rechazar_entidad': {
      const e = s.entities[a.entityId];
      if (e === undefined) return 'NO_ENCONTRADO';
      for (const m of e.mentions) {
        const d = s.detections[m] as Detection;
        if (a.kind === 'aceptar_entidad' && d.status === 'pendiente') setStatus(d, 'aceptada', 'grupo');
        if (a.kind === 'rechazar_entidad' && d.status !== 'rechazada') setStatus(d, 'rechazada', 'grupo', a.reason);
      }
      return null;
    }
    case 'cambiar_rol': {
      const e = s.entities[a.entityId];
      if (e === undefined) return 'NO_ENCONTRADO';
      if (!roleAllowed(e.type, a.role)) return 'ROL_INCOMPATIBLE';
      if (isFixed(e, ctx.table)) return 'ROL_FIJADO_EN_ASUNTO';
      e.role = a.role;
      if (isOrg(e.type)) e.type = a.role as DetectableType;
      e.family = familyFor(e.type, e.role, { marcadorEspecifico: e.marcadorEspecifico });
      for (const m of e.mentions) (s.detections[m] as Detection).role = a.role;
      return null;
    }
    case 'especificar_documento': {
      const e = s.entities[a.entityId];
      if (e === undefined) return 'NO_ENCONTRADO';
      if (!NEUTRAL_DOC.has(e.type)) return 'TIPO_NO_PERMITIDO';
      if (a.especifico === e.marcadorEspecifico) return null;   // idempotente
      if (isFixed(e, ctx.table)) return 'ROL_FIJADO_EN_ASUNTO';
      e.marcadorEspecifico = a.especifico;
      e.family = familyFor(e.type, e.role, { marcadorEspecifico: a.especifico });
      for (const sug of Object.values(s.suggestions)) {
        if (sug.kind !== 'ROTULO_DOCUMENTO_A_GENERICO' || sug.target.kind !== 'tramo') continue;
        const rel = sug.target.relatedDetectionId;
        if (rel === undefined || !e.mentions.includes(rel)) continue;
        if (a.especifico) { unapplySuggestion(s, sug); sug.status = 'descartada'; delete sug.chosenOptionId; }
        else if (sug.status !== 'aplicada') {
          const err = applySpanSuggestion(s, sug, sug.options[0] as SuggestionOption, ids);
          if (err !== null) return err;
        }
      }
      return null;
    }
    case 'unir_entidades': {
      let from = s.entities[a.fromId]; let into = s.entities[a.intoId];
      if (from === undefined || into === undefined || from.id === into.id) return 'NO_ENCONTRADO';
      const compatible = (from.type === 'PERSONA' && into.type === 'PERSONA') || (isOrg(from.type) && isOrg(into.type)) || from.type === into.type;
      if (!compatible) return 'TIPO_NO_PERMITIDO';
      const ff = isFixed(from, ctx.table); const fi = isFixed(into, ctx.table);
      if (ff && fi) return 'ROL_FIJADO_EN_ASUNTO';
      if (ff) [from, into] = [into, from];
      for (const m of [...from.mentions]) attach(s, s.detections[m] as Detection, into);
      into.sameHolderAs = [...new Set([...into.sameHolderAs, ...from.sameHolderAs])];
      for (const o of Object.values(s.entities)) o.sameHolderAs = o.sameHolderAs.map((x) => (x === from.id ? into.id : x));
      return null;
    }
    case 'agregar_manual': {
      const part = parts.get(a.span.partId);
      if (part === undefined || !Number.isInteger(a.span.start) || !Number.isInteger(a.span.end)
        || a.span.start < 0 || a.span.end > part.text.length || a.span.start >= a.span.end) return 'TRAMO_INVALIDO';
      if (FLAG_SET.has(a.type)) return 'TIPO_NO_PERMITIDO';
      if (a.role !== undefined && !roleAllowed(a.type, a.role)) return 'ROL_INCOMPATIBLE';
      const live = Object.values(s.detections).filter((d) => d.status !== 'rechazada');
      if (live.some((d) => overlaps(spanOf(d), a.span) && !contains(a.span, spanOf(d)))
        || Object.values(s.spanEdits).some((x) => overlaps(x.span, a.span))) return 'SOLAPAMIENTO_PARCIAL';
      for (const d of Object.values(s.detections)) if (contains(a.span, spanOf(d))) delete s.detections[d.id];
      const text = part.text.slice(a.span.start, a.span.end);
      const mk = (span: Span, status: Detection['status']): Detection => {
        const d: Detection = { id: ids.next('det') as DetectionId, docId: s.docId, partId: span.partId, start: span.start, end: span.end,
          text: (parts.get(span.partId) as Part).text.slice(span.start, span.end), type: a.type, source: 'manual', precedence: 1,
          confidence: 'alta', score: 1, canonicalKey: '', status, entityId: '' as EntityId, replacement: { proposedTemplate: TEMPLATE_M } };
        if (a.role !== undefined) d.role = a.role;
        if (status === 'aceptada') d.decidedBy = 'individual';
        return d;
      };
      const d = mk(a.span, 'aceptada');
      d.canonicalKey = canonicalKeyFor(a.type, text, part.kind);
      s.detections[d.id] = d;
      const e = entityByKey(s, d.canonicalKey) ?? newEntity(s, ids, d.canonicalKey, d, a.role);
      attach(s, d, e);
      if (a.propagate) for (const span of findOccurrences([...parts.values()], a.type, text)) {
        if (blocks(s, span)) continue;
        const p = mk(span, 'pendiente');
        p.canonicalKey = d.canonicalKey;
        s.detections[p.id] = p;
        attach(s, p, e);
      }
      return null;
    }
    case 'aplicar_sugerencia': case 'elegir_departamento': case 'descartar_sugerencia': {
      const sug = s.suggestions[a.suggestionId];
      if (sug === undefined) return 'NO_ENCONTRADO';
      if (a.kind === 'elegir_departamento') {
        if (!(sug.placeOptions ?? []).includes(a.depCode)) return 'NO_ENCONTRADO';
        for (const o of sug.options) if (o.template.includes(TEMPLATE_M)) o.depCode = a.depCode;
        sug.placeOptions = [a.depCode];
        return null;
      }
      if (sug.status === 'aplicada') unapplySuggestion(s, sug);
      if (a.kind === 'descartar_sugerencia') { sug.status = 'descartada'; delete sug.chosenOptionId; return null; }
      const o = sug.options.find((x) => x.id === a.optionId);
      if (o === undefined) return 'NO_ENCONTRADO';
      const err = applySuggestion(s, sug, o, ids);
      if (err !== null) return err;
      for (const f of Object.values(s.flags)) if (f.suggestionId === sug.id) { f.acknowledged = true; f.resolution = 'reemplazar'; }
      return null;
    }
    case 'resolver_bandera': {
      const f = s.flags[a.flagId];
      if (f === undefined) return 'NO_ENCONTRADO';
      const prevEdit = f.spanEditId;
      if (prevEdit !== undefined) { removeSpanEdit(s, prevEdit); delete f.spanEditId; }
      const linked = f.detectionId === undefined ? undefined : s.detections[f.detectionId];
      if (f.type === 'CITA_JURISPRUDENCIAL' && linked !== undefined) {
        if (a.resolution === 'mantener') setStatus(linked, 'rechazada', 'individual', 'CITA_JURISPRUDENCIAL');
        else setStatus(linked, 'aceptada', 'individual');
      } else if (f.suggestionId !== undefined) {
        const sug = s.suggestions[f.suggestionId];
        if (sug !== undefined && a.resolution === 'reemplazar' && sug.status !== 'aplicada') {
          const err = applySuggestion(s, sug, sug.options[0] as SuggestionOption, ids);
          if (err !== null) return err;
        }
        if (sug !== undefined && a.resolution === 'mantener') { unapplySuggestion(s, sug); sug.status = 'descartada'; delete sug.chosenOptionId; }
      } else if (a.resolution === 'reemplazar' && linked === undefined) {
        const text = a.text ?? f.options.find((o) => o.id === (a.optionId ?? f.options[0]?.id))?.template;
        if (text === undefined || text.includes(TEMPLATE_M)) return 'NO_ENCONTRADO';
        const id = prevEdit ?? freshEditId(s, ids);   // B-7: de IdSource una sola vez; se reutiliza al volver a reemplazar
        if (id === null) return 'SOLAPAMIENTO_PARCIAL';
        const err = placeSpanEdit(s, { id, span: f.span, originalText: f.text, text, origin: { kind: 'bandera', flagId: f.id } });
        if (err !== null) return err;
        f.spanEditId = id;
      }
      f.acknowledged = true; f.resolution = a.resolution;
      return null;
    }
    case 'incorporar_residuos': {
      if (a.residueRevision !== s.revision || parts.size === 0) return 'TRAMO_INVALIDO';
      for (const c of a.candidates) {
        const part = parts.get(c.partId);
        const span: Span = { partId: c.partId, start: c.start, end: c.end };
        if (part === undefined || c.start < 0 || c.end > part.text.length || c.start >= c.end || FLAG_SET.has(c.type) || blocks(s, span)) continue;
        fromCandidate(s, c, part, ids);
      }
      return null;
    }
    case 'incorporar_modelo': {
      const m = s.modelo;
      if (m.kind !== 'en_curso' || a.ventana <= m.ventanas) return 'IGNORADA';
      const rejected = Object.values(s.detections).filter((d) => d.status === 'rechazada');
      const deltaEntities = new Map(a.delta.entities.map((e) => [e.id, e]));
      for (const d0 of a.delta.detections) {
        const span = spanOf(d0);
        if (s.detections[d0.id] !== undefined || rejected.some((r) => r.partId === d0.partId && r.start === d0.start && r.end === d0.end)) continue;
        if (esPropuestaSobreLista(s, d0)) {
          // INV-R12, única excepción (D-03 B y E): todo lo que la propuesta toca es de la lista, está intacto y cede (o se
          // extiende). Si no, la propuesta no entra (incorporarModelo la vuelve a partir antes, como 7.11.2).
          // M-12 (PB-2-r5): una detección rechazada no bloquea un tramo distinto (6.4.4), así que no cuenta entre las tocadas y
          // no se borra; si no queda ninguna, la propuesta sigue el camino de `blocks`.
          if (extensionSobreRechazada(s, d0)) continue;
          const tocadas = Object.values(s.detections).filter((o) => o.status !== 'rechazada' && overlaps(spanOf(o), span));
          if (Object.values(s.spanEdits).some((x) => overlaps(x.span, span))
            || !tocadas.every((o) => cedeAnteModelo(s, o, d0, ctx.caseList))) continue;
          for (const o of tocadas) delete s.detections[o.id];
        } else if (blocks(s, span)) continue;
        const d: Detection = structuredClone(d0);
        d.status = 'pendiente'; delete d.rejectReason; delete d.replacement.edited; delete d.decidedBy; delete d.coveredBy;
        s.detections[d.id] = d;
        const de = deltaEntities.get(d0.entityId);
        const key = de?.canonicalKey ?? d.canonicalKey;
        let e = entityByKey(s, key);
        if (e === undefined) {
          e = structuredClone(de) ?? newEntity(s, ids, key, d);
          e.mentions = []; e.sameHolderAs = e.sameHolderAs.filter((x) => s.entities[x] !== undefined);
          delete e.marker; delete e.markerState;
          s.entities[e.id] = e;
        }
        attach(s, d, e);
      }
      for (const x of a.delta.suggestions) {
        const rel = x.target.kind === 'deteccion' ? x.target.detectionId : x.target.relatedDetectionId;
        if (s.suggestions[x.id] === undefined && (rel === undefined || s.detections[rel] !== undefined)) s.suggestions[x.id] = structuredClone(x);
      }
      for (const x of a.delta.flags) {
        if (s.flags[x.id] === undefined && (x.detectionId === undefined || s.detections[x.detectionId] !== undefined)) s.flags[x.id] = structuredClone(x);
      }
      s.modelo = a.ventana >= a.ventanasTotales && a.ventanasTotales > 0
        ? { kind: 'terminado', ventanas: a.ventana, respaldo: false }
        : { kind: 'en_curso', ventanas: a.ventana, ventanasTotales: a.ventanasTotales };
      return null;
    }
    case 'declarar_plan_b': {
      if (s.modelo.kind !== 'en_curso') return 'TIPO_NO_PERMITIDO';
      s.modelo = { kind: 'plan_b', causa: a.causa };
      return null;
    }
  }
}

function applySuggestion(s: ReviewState, sug: Suggestion, o: SuggestionOption, ids: IdSource): ReviewError | null {
  const withM = o.template.includes(TEMPLATE_M);
  if (withM && (sug.placeOptions?.length ?? 0) > 1) return 'DEPARTAMENTO_SIN_ELEGIR';
  if (sug.target.kind === 'deteccion') {
    const d = s.detections[sug.target.detectionId];
    if (d === undefined) return 'NO_ENCONTRADO';
    d.replacement.generalized = { suggestionId: sug.id, optionId: o.id, template: o.template };
    sug.status = 'aplicada'; sug.chosenOptionId = o.id;
    return null;
  }
  if (!withM) return applySpanSuggestion(s, sug, o, ids);
  const dep = o.depCode ?? (sug.placeOptions?.length === 1 ? sug.placeOptions[0] : undefined);
  if (dep === undefined) return 'DEPARTAMENTO_SIN_ELEGIR';
  const span = sug.target.span;
  if (Object.values(s.detections).some((d) => d.status !== 'rechazada' && overlaps(spanOf(d), span) && !contains(span, spanOf(d)))) return 'SOLAPAMIENTO_PARCIAL';
  const rel = sug.target.relatedDetectionId === undefined ? undefined : s.detections[sug.target.relatedDetectionId];
  const d: Detection = { id: ids.next('det') as DetectionId, docId: s.docId, partId: span.partId, start: span.start, end: span.end,
    text: sug.originalText, type: 'MUNICIPIO', source: rel?.source ?? 'regla', precedence: rel?.precedence ?? 5, confidence: 'alta',
    score: 0.9, canonicalKey: `DEP:${dep}`, status: 'aceptada', decidedBy: 'individual', entityId: '' as EntityId,
    replacement: { proposedTemplate: o.template }, suggestionId: sug.id };
  s.detections[d.id] = d;
  const e = entityByKey(s, d.canonicalKey) ?? newEntity(s, ids, d.canonicalKey, d);
  if (e.mentions.length === 0) e.display = dep;
  attach(s, d, e);
  sug.status = 'aplicada'; sug.chosenOptionId = o.id;
  return null;
}

function fromCandidate(s: ReviewState, c: DetectionCandidate, part: Part, ids: IdSource): Detection {
  const d: Detection = { id: ids.next('det') as DetectionId, docId: s.docId, partId: c.partId, start: c.start, end: c.end,
    text: part.text.slice(c.start, c.end), type: c.type as DetectableType, source: c.source, precedence: precedenceOf(c),
    confidence: c.confidence, score: c.score, canonicalKey: c.canonicalKey, status: 'pendiente', entityId: '' as EntityId,
    replacement: { proposedTemplate: TEMPLATE_M } };
  for (const f of ['role', 'ruleId', 'caseEntityId', 'variantClass', 'nerLabel', 'label', 'validator'] as const) {
    if (c[f] !== undefined) (d as unknown as Record<string, unknown>)[f] = c[f];
  }
  s.detections[d.id] = d;
  const ce = c.caseEntityId === undefined ? undefined : entityByKey(s, `LISTA:${c.caseEntityId}`);
  attach(s, d, ce ?? entityByKey(s, c.canonicalKey) ?? newEntity(s, ids, c.canonicalKey, d, c.role));
  return d;
}

/** `agregar_manual` con `propagate`: apariciones iguales (vista `lista` para nombres, dígitos para números). */
function findOccurrences(parts: readonly Part[], type: DataType, text: string): Span[] {
  const out: Span[] = [];
  const name = type === 'PERSONA' || isOrg(type) || (/\p{L}/u.test(text) && !/[0-9]/u.test(text));
  for (const part of parts) {
    if (!part.included) continue;
    let re: RegExp; let v: SearchView;
    if (name) {
      const needle = fold(text, part.kind).trim();
      if (needle === '') continue;
      v = buildSearchView(part.text, 'lista', part.kind);
      re = new RegExp(String.raw`(?<![\p{L}\p{N}])` + needle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') + String.raw`(?![\p{L}\p{N}])`, 'gu');
    } else {
      const d = digitsOf(text);
      if (d.length < 3) continue;
      v = buildSearchView(part.text, 'reglas', part.kind);
      re = new RegExp('(?<![0-9])' + d.split('').join('[ .\\-]?') + '(?![0-9])', 'gu');
    }
    for (const m of v.text.matchAll(re)) {
      const c = toCanonicalSpan(v, m.index, m.index + m[0].length);
      out.push({ partId: part.id, start: c.start, end: c.end });
    }
  }
  return out;
}
