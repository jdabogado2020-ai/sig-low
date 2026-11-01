// Entidades, claves canónicas, marcadores, tabla del asunto y reductor de la revisión (plan 6.2.1, 6.4.4, 6.6, 7.12). PB-3.
// Código puro de core/: sin DOM ni red. Los ids salen de un IdSource (6.1.4); nunca del contenido (INV-G05).
import type {
  CaseEntity, CaseEntityId, DataType, DetectableType, Detection, DetectionCandidate, DetectionId, DetectionSet, DocumentModel, Entity,
  EntityId, Flag, IdSource, MappingEntry, MappingTable, MarkerFamily, MergedCandidate, ModelProgress, Part, PartId,
  PartKind, ReviewAction, ReviewError, ReviewOutcome, ReviewState, Role, Span, SpanEdit, SpanEditId, Suggestion,
  SearchView, SuggestionId, SuggestionOption, TableIndex, IsoDateTime,
} from './types.ts';
import { FLAG_TYPES, MARKER_LABEL, ORG_CLASSES } from './types.ts';
import { buildAlnumSearchView, buildSearchView, toCanonicalSpan } from './normalize.ts';
import { esApellidoDeOtraPersona, personasDeLaVariante } from './caselist.ts';

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

// ---------------------------------------------------------------------------------------------
// D-16 (PB-3-r3) · Mención ambigua de la lista: la decide el revisor
// ---------------------------------------------------------------------------------------------
//
// Una variante que comparten dos o más personas de la lista («Prueba», apellido de la madre y del hijo) no se asigna a ninguna:
// la mención queda `pendiente`, en una entidad propia (una por mención, con la clave de su tramo y sin texto), sin
// `caseEntityId`, con rol `OTRA_PERSONA` y confianza baja. Es una decisión obligatoria: cuenta como pendiente para `exportGate`
// (review/puerta.ts) aunque se acepte, hasta que el revisor elige a la persona con «Unir con otra entidad» (`unir_entidades`
// hacia la entidad de esa persona), la separa como otra persona (`separar_mencion`) o la rechaza. Reemplaza la asignación «a la
// de más menciones» de PB-3-r1 (7.9.6 b): esa dueña queda solo como provisional dentro de la fusión (caselist.ts). Las
// opciones y el mensaje (M-2001) los arma review/ambiguas.ts.
// PB-3-r4 extiende el mecanismo a dos casos más, con la misma clave, la misma puerta y el mismo mensaje: el apellido suelto de la
// lista que también lleva otra persona del documento (M-72, abajo) y la forma corta del modelo con dos o más anfitrionas posibles
// (D-16 en el modelo, C4 de la correferencia).

/** Prefijo de la clave de una mención ambigua de la lista (D-16): `AMBIGUA:<parte>:<inicio>-<fin>`, sin texto del documento. */
export const CLAVE_AMBIGUA = 'AMBIGUA:';
export const esClaveAmbigua = (k: string): boolean => k.startsWith(CLAVE_AMBIGUA);
const claveAmbigua = (s: Span): string => `${CLAVE_AMBIGUA}${s.partId}:${s.start}-${s.end}`;

/**
 * D-16 · Personas de la lista entre las que el revisor tiene que elegir para un candidato de la lista: las dos o más que comparten
 * la variante del tramo (`personasDeLaVariante` de caselist.ts), o [] si no es ambiguo. Solo una persona como dueña provisional:
 * con una organización entre las candidatas decide 7.9.6, paso 5. Un tramo que el modelo extendió (D-03 E) ya no es la variante
 * compartida: la fusión solo lo extiende si el nombre largo es variante de esa persona.
 */
export function candidatasAmbiguas(c: Pick<DetectionCandidate, 'source' | 'caseEntityId' | 'type'> & { extended?: boolean },
  texto: string, caseList: readonly CaseEntity[]): CaseEntityId[] {
  if (c.source !== 'lista' || c.caseEntityId === undefined || c.type !== 'PERSONA' || c.extended === true) return [];
  const ps = personasDeLaVariante(texto, caseList);
  return ps.length >= 2 && ps.includes(c.caseEntityId) ? ps : [];
}

/** D-16 · ¿La detección es una mención ambigua de la lista sin decidir? Sigue en su entidad propia y no está rechazada. */
export function esAmbigua(state: ReviewState, d: Detection): boolean {
  return d.status !== 'rechazada' && esClaveAmbigua(state.entities[d.entityId]?.canonicalKey ?? '');
}

// M-72 (PB-3-r4, decidido) · El apellido suelto de la lista que también es el apellido de otra persona del documento («Rojas» de
// «Ana Ficticia Rojas», con «Luis Rojas» en el texto) tampoco se asigna: la mención («El señor Rojas») queda ambigua, con la
// decisión del revisor de D-16. La otra persona no es de la lista (la trae el modelo o la agrega el revisor), así que la búsqueda
// de la lista no la ve: se decide aquí, al construir y en cada ventana del modelo o de residuos.

/** Palabras de nombre (vista `lista`, sin palabras de función ni tratamientos) de un texto, en orden. */
const palabrasPlegadas = (s: string, kind: PartKind): string[] =>
  fold(s, kind).split(/[^\p{L}\p{N}]+/u).filter((t) => t !== '' && !FW_SET.has(t) && !TRATAMIENTOS.has(t));

/** M-72 · Las menciones de otras personas del documento por apellido: cada palabra después de la primera (el nombre de pila no es
 *  un apellido) de una mención no rechazada de persona que no es de la lista. Lineal en el número de menciones. */
function indiceDeApellidos(state: ReviewState, kindOf: (d: Detection) => PartKind): Map<string, Detection[]> {
  const out = new Map<string, Detection[]>();
  for (const e of Object.values(state.entities)) {
    if (e.type !== 'PERSONA' || e.caseEntityId !== undefined || !e.canonicalKey.startsWith('PER:')) continue;
    for (const m of e.mentions) {
      const o = state.detections[m];
      if (o === undefined || o.status === 'rechazada' || o.source === 'lista' || o.type !== 'PERSONA') continue;
      for (const w of new Set(palabrasPlegadas(o.text, kindOf(o)).slice(1))) {
        const l = out.get(w);
        if (l === undefined) out.set(w, [o]); else l.push(o);
      }
    }
  }
  return out;
}

/** M-72 · Entidades de otra persona con el apellido de `d` (`esApellidoDeOtraPersona` de caselist.ts con alguna de `personas`). */
function conElApellido(indice: ReadonlyMap<string, readonly Detection[]>, d: Detection, personas: readonly CaseEntity[], kind: PartKind): EntityId[] {
  const w = palabrasPlegadas(d.text, kind)[0];
  const out = new Set<EntityId>();
  for (const o of w === undefined ? [] : indice.get(w) ?? []) {
    if (o.entityId !== d.entityId && !overlaps(spanOf(o), spanOf(d)) && personas.some((p) => esApellidoDeOtraPersona(d.text, p, o.text))) out.add(o.entityId);
  }
  return [...out];
}

/**
 * M-72 · Entidades de otras personas del documento que llevan como apellido la variante suelta `apellido_suelto` de la mención
 * de la lista `d`, para las personas de la lista que tienen esa variante: las opciones del revisor fuera de la lista
 * (review/ambiguas.ts). Lee el texto de las detecciones; no lo devuelve.
 */
export function otrasPersonasDelApellido(state: ReviewState, d: Detection, caseList: readonly CaseEntity[], kind: PartKind = 'cuerpo'): EntityId[] {
  if (d.source !== 'lista' || d.type !== 'PERSONA' || d.variantClass !== 'apellido_suelto') return [];
  const personas = caseList.filter((c) => personasDeLaVariante(d.text, caseList).includes(c.id));
  return personas.length === 0 ? [] : conElApellido(indiceDeApellidos(state, () => kind), d, personas, kind);
}

/**
 * M-72 · Vuelve ambigua cada mención `apellido_suelto` de la lista, intacta (`listaIntacta`: sin ninguna acción del revisor), cuyo
 * apellido lleva otra persona del documento: sin persona de la lista, en una entidad propia con la clave de su tramo, rol
 * `OTRA_PERSONA` y confianza baja, como las de D-16. Lo que el revisor ya decidió no se toca.
 */
function ambiguasPorOtraPersona(state: ReviewState, caseList: readonly CaseEntity[], parts: ReadonlyMap<PartId, Part>, ids: IdSource): void {
  const kindOf = (d: Detection): PartKind => parts.get(d.partId)?.kind ?? 'cuerpo';
  const sueltas = Object.values(state.detections).filter((d) => d.source === 'lista' && d.type === 'PERSONA'
    && d.variantClass === 'apellido_suelto' && d.caseEntityId !== undefined && listaIntacta(state, d, caseList));
  if (sueltas.length === 0) return;
  const indice = indiceDeApellidos(state, kindOf);
  if (indice.size === 0) return;
  for (const d of sueltas) {
    const ce = caseList.find((c) => c.id === d.caseEntityId);
    if (ce === undefined || conElApellido(indice, d, [ce], kindOf(d)).length === 0) continue;
    const key = claveAmbigua(d);
    delete d.caseEntityId; d.role = 'OTRA_PERSONA'; d.confidence = 'baja'; d.score = Math.min(d.score, 0.3); d.canonicalKey = key;
    attach(state, d, entityByKey(state, key) ?? newEntity(state, ids, key, d, 'OTRA_PERSONA'));
  }
}

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
    // D-16: la variante que comparten dos o más personas de la lista no es de ninguna; cada mención, su entidad.
    const ambigua = candidatasAmbiguas(c, part.text.slice(c.start, c.end), ctx.caseList).length > 0;
    const key = ambigua ? claveAmbigua(c) : c.type === 'RADICADO' ? fullRadicadoKey(c.canonicalKey, fullRad) : c.canonicalKey;
    let e = byKey.get(key);
    if (e === undefined) {
      const ce = ambigua || c.caseEntityId === undefined ? undefined : ctx.caseList.find((x) => x.id === c.caseEntityId);
      e = { id: ctx.ids.next('ent') as EntityId, canonicalKey: key, type: c.type as DetectableType, family: 'PERSONA',
        marcadorEspecifico: false, mentions: [], sameHolderAs: [], display: ce?.name ?? part.text.slice(c.start, c.end) };
      if (ce !== undefined) { e.caseEntityId = ce.id; e.role = ce.role; }
      if (ambigua) e.role = 'OTRA_PERSONA';
      byKey.set(key, e); state.entities[e.id] = e;
    }
    const det: Detection = {
      id: ctx.ids.next('det') as DetectionId, docId: doc.id, partId: c.partId, start: c.start, end: c.end,
      text: part.text.slice(c.start, c.end), type: c.type as DetectableType, source: c.source, precedence: c.precedence,
      confidence: c.confidence, score: c.score, canonicalKey: ambigua ? key : c.canonicalKey, status: 'pendiente', entityId: e.id,
      replacement: { proposedTemplate: TEMPLATE_M },
    };
    for (const f of ['role', 'ruleId', 'caseEntityId', 'variantClass', 'nerLabel', 'label', 'validator'] as const) {
      if (c[f] !== undefined) (det as unknown as Record<string, unknown>)[f] = c[f];
    }
    if (ambigua) { delete det.caseEntityId; det.role = 'OTRA_PERSONA'; det.confidence = 'baja'; det.score = Math.min(det.score, 0.3); }
    if (c.type === 'NIT' && c.holderDigits !== undefined) naturalNit.add(e.id);
    state.detections[det.id] = det; e.mentions.push(det.id); state.order.push(det.id);
  }
  for (const e of Object.values(state.entities)) settleEntity(e, state, ctx.table);
  correferir(state, { caseList: ctx.caseList, parts, table: ctx.table, ids: ctx.ids });
  // M-72: después de la correferencia, que dice qué personas del modelo son de la lista y cuáles son otras.
  ambiguasPorOtraPersona(state, ctx.caseList, parts, ctx.ids);
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

// ---------------------------------------------------------------------------------------------
// 7.12.2.4 · Correferencia (SUPUESTO S-7.11), su extensión de PB-3-r1 y sus límites de PB-3-r2 (D-14)
// ---------------------------------------------------------------------------------------------
//
// «Mismo dato, mismo marcador» (6.6.1) entre las entidades que propone el modelo. Solo agrupa: no crea, no borra ni mueve tramos.
// Cada unión lleva las menciones del modelo a la entidad anfitriona con confianza baja (media si es el nombre completo de una
// persona de la lista, como D-03 E). D-14, decisión 3 (A-2): la correferencia nunca une a dos titulares distintos; es mejor perder
// consistencia que crear una colisión (un marcador para dos titulares reinserta el dato de otro). Reglas, en este orden:
//   C0 · Un grupo por clave (7.12.2 paso 2), solo por ventana: la mención nueva cuya clave ya está en una entidad a la que se unió
//        antes va a esa entidad («una unión ya hecha y mostrada no se deshace»), salvo que otra persona también la contenga: con
//        dos anfitrionas no se une a ninguna (S-7.11).
//   C1 · Nombre de la lista incompleto (F44): una PER: del modelo que contiene, en orden y desde el nombre de pila, todas las palabras
//        del nombre de **una sola** persona de la lista es esa persona («Martha Cecilia Ejemplo-Acosta Ortiz» de «Martha Ejemplo-Acosta»),
//        salvo que el texto la marque como otra persona (`marcaOtroTitular`: «su hijo…», «…, hijo de…», «Junior» y, A-4, cualquier
//        parentesco o relación en la misma oración: «El padre del demandante, Pedro Luis…», «su ahijado», «su apoderado»).
//   C2 · Sigla silábica: una ORG: del modelo de una sola palabra en mayúsculas formada con prefijos, en orden, de cada palabra del
//        núcleo de **una sola** organización de la lista («FESA» de «Ferretería Ejemplo S.A.S.»), solo si el texto la define junto
//        a una mención de esa organización («(FESA)», «en adelante FESA», «FESA (Ferretería…)»).
//   C3 · Mismo núcleo dentro del mismo tipo: dos personas, dos organizaciones o dos lugares del modelo con las mismas palabras de
//        nombre (sin sufijo societario) son una («taller Laboratorio Clínico Prueba Ltda.» y «Laboratorio Clínico Prueba Ltda.»).
//        Gana la de más menciones; a igualdad, la de texto limpio y el orden de 7.11.3. Nunca una persona con una organización o
//        un lugar, ni una organización con un lugar: «Pedro Ejemplo Gómez» y «Pedro Ejemplo Gómez S.A.S.» son dos titulares.
//   C4 · S-7.11: una PER: de 1 o 2 palabras de nombre cuyas palabras están todas en **una sola** persona más larga se une a ella. La
//        anfitriona puede ser también una persona de la lista (sus menciones extendidas por D-03 E o unidas por C1 dan sus palabras)
//        y suma el nombre de pila de su correo («Prueba Giraldo <sergio.prueba@…>») y el apodo que el texto introduce
//        («Constanza Ficticia Ruiz, a quien le decimos Cata»). Una ORG o un LUGAR del modelo nunca se une a una persona.
// Con 2 o más candidatas no se une (S-7.11); en C4, la forma corta queda además ambigua y la decide el revisor (PB-3-r4, D-16 en el
// modelo: cada mención en una entidad propia con la clave `AMBIGUA:` de su tramo). Con los resultados por ventana (reductor, `incorporar_modelo`) la correferencia se
// recalcula sobre lo acumulado: solo mueve detecciones del modelo pendientes sin ninguna acción del usuario, nunca deshace una
// unión, no une lo que el usuario separó o rechazó (M-12), y una unión exige que una de las dos entidades sea nueva o haya
// recibido menciones en esa ventana. M-62: una entidad con una decisión del usuario (`cambiar_rol`, `unir_entidades`, un
// marcador fijado en el asunto) nunca se mueve. B-82: una mención separada lleva `~sep` en su clave y `restablecer` conserva su
// `decidedBy`. B-92: tras `cambiar_rol` o `unir_entidades`, las menciones del modelo de la entidad llevan `~ent` en su clave, que
// `restablecer` no borra. La regla E de merge.ts (D-03 E) tiene los mismos límites (`otroTitularEnLaExtension`).

const TRATAMIENTOS: ReadonlySet<string> = new Set('senorita|senora|senor|srta|sra|sr|dona|don|doctora|doctor|dra|dr'.split('|'));
/** D-14 (A-2) · Palabras de parentesco (vista `lista`): marcan a otra persona de la familia, que puede llevar el mismo nombre. */
const PARENTESCO = String.raw`(?:hij[oa]s?|hijastr[oa]s?|padres?|madres?|padrastros?|madrastras?|papa|mama|herman[oa]s?|ti[oa]s?`
  + String.raw`|sobrin[oa]s?|prim[oa]s?|abuel[oa]s?|bisabuel[oa]s?|niet[oa]s?|bisniet[oa]s?|espos[oa]s?|conyuges?`
  + String.raw`|companer[oa]s? permanentes?|suegr[oa]s?|yernos?|nueras?|cunad[oa]s?|homonim[oa]s?)`;
/**
 * A-4 (PB-3-r4) · Las palabras de relación que la lista de D-14 no traía: más parentesco («primogénito», «progenitora», «ahijado»,
 * «padrino», «pareja», «compañero» sin «permanente», «novia», «viudo», «hermanastra»…) y las relaciones con que el texto presenta a
 * otra persona junto a la de la lista («su tutora», «su curador», «su acudiente», «su apoderado»). Vista `lista`.
 */
const RELACION = String.raw`(?:primogenit[oa]s?|ahijad[oa]s?|padrinos?|madrinas?|parejas?|companer[oa]s?|progenitor(?:a|as|es)?`
  + String.raw`|novi[oa]s?|prometid[oa]s?|marido|maridos|viud[oa]s?|parientes?|herederos?|herederas?|hermanastr[oa]s?`
  + String.raw`|medi[oa]s? herman[oa]s?|tatarabuel[oa]s?|concunad[oa]s?|consuegr[oa]s?|ex ?espos[oa]s?|ex ?companer[oa]s?`
  + String.raw`|tutor(?:a|as|es)?|curador(?:a|as|es)?|acudientes?|apoderad[oa]s?)`;
/** El parentesco y las demás relaciones de A-4: lo que marca a otra persona antes, después o en la misma oración. */
const RELACIONADO = String.raw`(?:${PARENTESCO}|${RELACION})`;
/** Lo que se mira antes y después del nombre (vista `lista`, blancos colapsados). */
const VENTANA_PARENTESCO = 48;
/** «su hijo Pedro…», «la tía Ana…», «Hijo: Pedro…», «del hermano menor, el señor Pedro…»: el parentesco pegado antes del nombre. */
const RE_PARENTESCO_ANTES = new RegExp(String.raw`(?<![\p{L}\p{N}])` + RELACIONADO
  + String.raw`(?: (?:menor|mayor|menores|mayores|unic[oa]|legitim[oa]|natural|adoptiv[oa]|biologic[oa]|politic[oa]))? ?[,:]? ?`
  + String.raw`(?:(?:el|la) )?(?:(?:senor|senora|senorita|don|dona|sr|sra|srta|dr|dra|doctor|doctora)\.? ?)?$`, 'u');
/** «Pedro…, hijo de…», «Pedro… (su hijo)», «Pedro…, la tía», «Pedro… hijo de…», «Pedro… Jr.», «Pedro Ejemplo Hijo»: el parentesco
 *  en aposición. */
const RE_PARENTESCO_DESPUES = new RegExp(String.raw`^ ?(?:[,(] ?(?:(?:su|sus|mi|mis|nuestr[oa]s?|el|la|los|las) )?` + RELACIONADO
  + String.raw`|(?:[,(] ?)?(?:junior|jr|senior|hij[oa])|` + RELACIONADO + String.raw` (?:de|del))(?![\p{L}\p{N}])`, 'u');
/** «Pedro Ejemplo Junior», «PEDRO EJEMPLO HIJO»: el parentesco dentro del tramo (solo el de D-14: «Pareja» o «Tutor» dentro de un
 *  nombre son apellidos). */
const RE_PARENTESCO_DENTRO = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:` + PARENTESCO + String.raw`|junior|jr|senior)(?![\p{L}\p{N}])`, 'u');
/** A-4 · Cualquier palabra de relación en la oración (vista `lista`), con su posición para mirar el texto original. */
const RE_RELACION_EN_ORACION = new RegExp(String.raw`(?<![\p{L}\p{N}])` + RELACIONADO + String.raw`(?![\p{L}\p{N}])`, 'gu');
/** A-4 · Homógrafos que no son parentesco (vista `lista`): la prima del salario o del seguro, la materia prima y «prima facie». Se
 *  borran de la oración antes de buscar. */
const RE_NO_ES_PARENTESCO = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:materias? primas?|primas? (?:de (?:servicios?|navidad|vacaciones`
  + String.raw`|antiguedad|seguros?|riesgos?|produccion|alimentacion|localizacion|clima|transporte|retiro|grado|instalacion|ascenso|gestion`
  + String.raw`|desempeno|movilidad|emision|cumplimiento|vida)|tecnicas?|extralegal(?:es)?|legal(?:es)?|semestral(?:es)?|anual(?:es)?`
  + String.raw`|especial(?:es)?|mensual(?:es)?|unicas?|facie))(?![\p{L}\p{N}])`, 'gu');
/** A-4 · Lo que se mira antes y después del nombre para encontrar su oración (texto original, ventanas fijas: tiempo constante). */
const VENTANA_ORACION = 320;
/** Fin de oración (texto original): «.», «!», «?» o «…» seguidos de blancos y de una mayúscula, una cifra o un signo de apertura;
 *  un «;» (separa las personas de una enumeración); o una línea en blanco. Un salto de línea solo no cierra la oración (PDF). */
const RE_FIN_ORACION = /(?:([.!?…])[.!?…]*["»”’')\]]*(?=\s)(?=[ \t]*\r?\n?[ \t]*["«“‘'(¿¡\[]?[\p{Lu}\p{N}])|;|\n[ \t\r]*\n)/gu;
/** Abreviaturas (vista `lista`) tras las que el punto no cierra la oración: tratamientos, «No.», «Art.», sufijos societarios,
 *  partes de una dirección y rótulos. Una sola letra (una inicial, «C.C.», «S.A.S.») tampoco. Ante la duda la oración sigue. */
const ABREVIATURAS: ReadonlySet<string> = new Set(('sr|sra|srta|sres|sras|dr|dra|dres|dras|lic|ing|abg|arq|prof|mr|mrs|ms|no|nro|nros|num'
  + '|art|arts|inc|lit|par|cap|pag|pags|vol|ed|ltda|cia|sas|esp|av|avda|cra|kra|cr|kr|cl|cll|dg|tv|transv|mz|apto|apt|of|int|tel|cel|ext'
  + '|exp|rad|ref|cod|ced|dto|depto|dpto|mpio|gral|cnel|tte|sgto|ss|vda|hda|corr|km|fl|fls').split('|'));
/** Las letras pegadas antes de un punto (texto original). */
const RE_LETRAS_FINALES = /(\p{L}+)$/u;
/** La palabra anterior a un parentesco con mayúscula (texto original, misma línea): si es un nombre, el parentesco es un apellido. */
const RE_NOMBRE_ANTES = /(\p{Lu}[\p{L}'’]+)[ \t\-‐‑]+$/u;
/** Palabras con mayúscula que no son un nombre (vista `lista`): las de función, los posesivos, los demostrativos y los tratamientos. */
const NO_ES_NOMBRE: ReadonlySet<string> = new Set([...FW_SET, ...TRATAMIENTOS, ...('mi|mis|tu|tus|nuestro|nuestra|nuestros|nuestras|este'
  + '|esta|estos|estas|ese|esa|esos|esas|aquel|aquella|dicho|dicha|dichos|dichas|cuyo|cuya|cuyos|cuyas').split('|')]);

/**
 * A-4 · La oración de [start, end): el texto antes y después de la mención hasta el fin de oración más cercano, dentro de ventanas
 * fijas de `VENTANA_ORACION` caracteres (sin la palabra que la ventana corta por la mitad). Texto original.
 */
function oracionDe(text: string, start: number, end: number): { antes: string; despues: string } {
  let a = Math.max(0, start - VENTANA_ORACION);
  let b = Math.min(text.length, end + VENTANA_ORACION);
  while (a > 0 && a < start && /[\p{L}\p{N}]/u.test(text.charAt(a - 1)) && /[\p{L}\p{N}]/u.test(text.charAt(a))) a++;
  while (b < text.length && b > end && /[\p{L}\p{N}]/u.test(text.charAt(b)) && /[\p{L}\p{N}]/u.test(text.charAt(b - 1))) b--;
  const trozo = text.slice(a, b);
  const ms = start - a; const me = end - a;
  let desde = 0; let hasta = trozo.length;
  const re = new RegExp(RE_FIN_ORACION.source, RE_FIN_ORACION.flags);
  for (let m = re.exec(trozo); m !== null; m = re.exec(trozo)) {
    const i = m.index; const j = i + m[0].length;
    if (m[0].length === 0) { re.lastIndex = i + 1; continue; }
    if (m[1] === '.') {
      // Una cifra o un signo antes del punto sí cierra; una inicial o una abreviatura, no.
      const w = RE_LETRAS_FINALES.exec(trozo.slice(Math.max(0, i - 24), i))?.[1];
      if (w !== undefined && ([...w].length <= 1 || ABREVIATURAS.has(fold(w, 'cuerpo')))) continue;
    }
    if (j <= ms) desde = j;
    else if (i >= me) { hasta = i; break; }
  }
  return { antes: trozo.slice(desde, ms), despues: trozo.slice(me, hasta) };
}

/** A-4 · ¿Hay una palabra de relación en `s` (un trozo de la oración, texto original)? Con mayúsculas y minúsculas, una palabra con
 *  mayúscula pegada a otra palabra con mayúscula es parte de un nombre («Carlos Nieto», «Distribuidora Hermanos Prueba»). */
function relacionEn(s: string, kind: PartKind): boolean {
  if (s === '') return false;
  const v = buildSearchView(s, 'lista', kind);
  const t = v.text.replace(RE_NO_ES_PARENTESCO, (x) => ' '.repeat(x.length));
  const mixto = /\p{Lu}/u.test(s) && /\p{Ll}/u.test(s);
  const re = new RegExp(RE_RELACION_EN_ORACION.source, RE_RELACION_EN_ORACION.flags);
  for (let m = re.exec(t); m !== null; m = re.exec(t)) {
    if (!mixto) return true;
    const c = toCanonicalSpan(v, m.index, m.index + m[0].length);
    if (!/^\p{Lu}/u.test(s.slice(c.start, c.end))) return true;
    const previa = RE_NOMBRE_ANTES.exec(s.slice(Math.max(0, c.start - 32), c.start))?.[1];
    if (previa === undefined || NO_ES_NOMBRE.has(fold(previa, kind))) return true;
  }
  return false;
}

/**
 * D-14 (A-2) y A-4 (PB-3-r4) · ¿El texto marca el nombre de [start, end) como el de otra persona? Un nombre así nunca se une a la
 * persona de la lista que contiene (C1, C5, regla E de merge.ts): el padre y el hijo comparten nombre de pila y apellido, y la
 * reinserción pondría el nombre del uno donde la IA habló del otro.
 * - D-14: el parentesco pegado antes («su hijo Pedro Luis Ejemplo Prueba»), en aposición después («…, hijo de Pedro Ejemplo»,
 *   «… (tía)», «… Jr.») o dentro del tramo («Pedro Ejemplo Junior»).
 * - A-4: cualquier palabra de parentesco o de relación en **cualquier lugar de la misma oración**, antes o después del nombre, con
 *   lo que haya en medio: «El padre del demandante, Pedro Luis…», «Su hijo menor de edad Pedro Luis…», «…, quien es hijo de…»,
 *   «…, de 10 años, hijo del demandante, …», «su ahijado», «su pareja», «su apoderado». También el predicado («… es hijo de un
 *   congresista») y el nombre del que sale el parentesco («los hijos de Pedro Luis…»): la persona de la lista puede ser el pariente.
 * Ante la duda, marcador propio (D-15): se pierde consistencia, nunca se crea una colisión. No cuentan el parentesco de otra
 * oración (D-13), los homógrafos («prima de servicios», «materia prima») ni una palabra que es parte de un nombre propio («Carlos
 * Nieto»). Vista `lista` y ventanas fijas: tiempo constante por mención.
 */
export function marcaOtroTitular(text: string, start: number, end: number, kind: PartKind = 'cuerpo'): boolean {
  if (RE_PARENTESCO_ANTES.test(fold(text.slice(Math.max(0, start - VENTANA_PARENTESCO), start), kind))
    || RE_PARENTESCO_DENTRO.test(fold(text.slice(start, end), kind))
    || RE_PARENTESCO_DESPUES.test(fold(text.slice(end, end + VENTANA_PARENTESCO), kind))) return true;
  const o = oracionDe(text, start, end);
  return relacionEn(o.antes, kind) || relacionEn(o.despues, kind);
}
const RE_PIEZAS_NOMBRE = /[\s\-‐‑]+/u;
const RE_EMPIEZA_MAYUSCULA = /^[^\p{L}]*\p{Lu}/u;
/** «Nombre <usuario@dominio>»: el usuario del correo que sigue a la mención (cabecera De:/Para: de un correo, F52). */
const RE_CORREO_TRAS_NOMBRE = /^[ \t]*<[ \t]*([\p{L}\p{N}._%+-]{1,64})@/u;
/** Apodo que el texto introduce tras el nombre: «…, a quien le decimos Cata», «…, alias Ejemplo», «… (conocida como Tata)». */
const RE_APODO_TRAS_NOMBRE = new RegExp(String.raw`^[ \t]{0,3},?[ \t]{0,3}\(?[ \t]{0,3}(?:(?:a quien|al que|a la que)[ \t]{1,3}(?:(?:le|les|lo|la)[ \t]{1,3})?`
  + String.raw`(?:dicen|decimos|llaman|llamamos|apodan|apodamos)|[Aa]lias|conocid[oa] como|apodad[oa])[ \t]{1,3}["«“']?(\p{Lu}\p{L}{1,30})(?![\p{L}\p{N}])`, 'u');
const RE_SIGLA = /^\p{Lu}{3,8}$/u;
/** 7.11.3 · Orden fijo de tipos para el desempate de C3. */
const ORDEN_C3: readonly DetectableType[] = ['PERSONA', 'EMPRESA', 'EPS', 'IPS', 'ENTIDAD', 'PROVEEDOR', 'LUGAR'];

/**
 * Palabras de nombre de un texto para la correferencia: vista `lista`, sin palabras de función ni tratamientos. En un texto con
 * mayúsculas y minúsculas solo cuentan las que empiezan con mayúscula («Camilo primero» → camilo: el modelo se llevó una palabra
 * común). Un texto todo en minúsculas (correo informal, F52) o todo en mayúsculas cuenta entero.
 */
export function palabrasDeNombre(text: string, kind: PartKind = 'cuerpo'): string[] {
  return unidadesDeNombre(text, kind).flat();
}
/** Las mismas palabras agrupadas por unidad (7.9.2): un apellido con guion es una unidad con dos palabras. */
function unidadesDeNombre(text: string, kind: PartKind): string[][] {
  const mixto = /\p{Lu}/u.test(text) && /\p{Ll}/u.test(text);
  const out: string[][] = [];
  for (const u of text.split(/\s+/u)) {
    const ws: string[] = [];
    for (const w of u.split(RE_PIEZAS_NOMBRE)) {
      if (!/\p{L}/u.test(w) || (mixto && !RE_EMPIEZA_MAYUSCULA.test(w))) continue;
      const f = fold(w, kind).replace(/[^\p{L}\p{N}]+/gu, '');
      if (f !== '' && !FW_SET.has(f) && !TRATAMIENTOS.has(f)) ws.push(f);
    }
    if (ws.length > 0) out.push(ws);
  }
  return out;
}

/** C2 · ¿`sigla` (plegada) son prefijos no vacíos, en orden, de todas las `palabras`, más quizá un prefijo de `sufijo`? */
export function esSiglaSilabica(sigla: string, palabras: readonly string[], sufijo = ''): boolean {
  if (palabras.length === 0 || sigla.length <= palabras.length) return false;   // las iniciales solas son la `sigla` de 7.9.4
  const go = (i: number, k: number): boolean => {
    if (k === palabras.length) return i === sigla.length || (sufijo !== '' && sufijo.startsWith(sigla.slice(i)));
    const w = palabras[k] as string;
    for (let n = 1; n <= w.length && i + n <= sigla.length && sigla.charAt(i + n - 1) === w.charAt(n - 1); n++) {
      if (go(i + n, k + 1)) return true;
    }
    return false;
  };
  return go(0, 0);
}

/**
 * B-92 (PB-3-r4) · Marca en la clave de una detección del modelo sobre cuya entidad actuó el usuario (`cambiar_rol`,
 * `unir_entidades`). Como `~sep` (B-82), ni `restablecer` ni una decisión la borran: el rastro de la acción sobre la entidad ya
 * no depende de `decidedBy`. La clave de la entidad no cambia (la tabla del asunto y la herencia entre documentos la usan).
 */
const MARCA_ENTIDAD = '~ent';
/** La clave de la detección sin la marca de B-92: la que se compara con la de su entidad y con la de otra mención (C0, C5). */
const claveBase = (k: string): string => (k.endsWith(MARCA_ENTIDAD) ? k.slice(0, -MARCA_ENTIDAD.length) : k);

/**
 * La correferencia solo mueve detecciones del modelo pendientes sobre las que el usuario no hizo nada. Rastros de una acción:
 * `decidedBy` (aceptar, rechazar…; también `separar_mencion`, y `cambiar_rol` y `unir_entidades` sobre las pendientes, M-62),
 * `~sep` en la clave (`separar_mencion`, que `restablecer` no borra: B-82), `~ent` en la clave (`cambiar_rol` y `unir_entidades`
 * sobre la entidad, que `restablecer` tampoco borra: B-92) y un rol distinto del de nacimiento (`cambiar_rol`, M-62: el modelo
 * propone `OTRA_PERSONA` para una persona y ningún rol, o el del tipo, para una organización o un lugar).
 */
function movible(d: Detection): boolean {
  return d.source === 'modelo' && d.status === 'pendiente' && d.decidedBy === undefined && d.rejectReason === undefined
    && d.replacement.edited === undefined && d.replacement.generalized === undefined && d.coveredBy === undefined
    && d.suggestionId === undefined && !d.canonicalKey.includes('~sep') && !d.canonicalKey.endsWith(MARCA_ENTIDAD)
    && (d.role === undefined || d.role === (d.type === 'PERSONA' ? 'OTRA_PERSONA' : d.type));
}

interface Correferencia {
  caseList: readonly CaseEntity[];
  parts: ReadonlyMap<PartId, Part>;
  /** M-62: una entidad con el marcador fijado en el asunto (heredado o definitivo) no se mueve. */
  table: TableIndex;
  /** Solo en el reductor: entidades nuevas o con menciones nuevas de esta ventana. */
  cambiadas?: ReadonlySet<EntityId>;
  /** PB-3-r4 (D-16 en el modelo): ids de las entidades propias de las formas cortas ambiguas. Sin ids, C4 solo no las une. */
  ids?: IdSource;
}

/**
 * C4 · Índice por palabra de las personas anfitrionas (lineal en el número de entidades: el reductor lo arma en cada ventana).
 * Suma el nombre de pila del correo y el apodo que el texto introduce tras el nombre (con el texto de las partes) y, en una
 * persona de la lista, su nombre en la lista. `candidatas(s, w)` son las anfitrionas posibles de una forma corta con las palabras
 * `w` (`s`, su entidad, nunca lo es). Lo usan la correferencia y, para las opciones del revisor, review/ambiguas.ts.
 */
function indicePersonas(state: ReviewState, caseList: readonly CaseEntity[], parts: ReadonlyMap<PartId, Part>):
  { candidatas: (s: Entity | null, w: readonly string[]) => Entity[] } {
  const det = (m: DetectionId): Detection => state.detections[m] as Detection;
  const kindOf = (d: Detection): PartKind => parts.get(d.partId)?.kind ?? 'cuerpo';
  const extra = new Map<EntityId, Set<string>>();
  for (const d of Object.values(state.detections)) {
    const part = parts.get(d.partId);
    if (part === undefined || d.type !== 'PERSONA' || d.status === 'rechazada') continue;
    const tras = part.text.slice(d.end, d.end + 96);
    const add = (w: string): void => { const s = extra.get(d.entityId) ?? new Set<string>(); s.add(w); extra.set(d.entityId, s); };
    const c = RE_CORREO_TRAS_NOMBRE.exec(tras);
    if (c !== null) {
      const nombre = palabrasDeNombre(d.text, part.kind);
      const toks = fold(c[1] as string, part.kind).split(/[^\p{L}]+/u).filter((t) => t.length >= 3);
      const fuera = [...new Set(toks.filter((t) => !nombre.includes(t)))];
      if (toks.some((t) => nombre.includes(t)) && fuera.length === 1 && unidadesDeNombre(d.text, part.kind).length <= 3) add(fuera[0] as string);
    }
    const a = RE_APODO_TRAS_NOMBRE.exec(tras);
    if (a !== null) add(fold(a[1] as string, part.kind));
  }
  const anfitrionas = new Map<EntityId, Set<string>>();
  const delNombreDeLista = new Map<EntityId, Set<string>>();
  const porPalabra = new Map<string, Entity[]>();
  for (const e of Object.values(state.entities)) {
    if (e.mentions.length === 0 || e.type !== 'PERSONA' || !(e.canonicalKey.startsWith('PER:') || e.canonicalKey.startsWith('LISTA:'))) continue;
    const w = new Set<string>(extra.get(e.id) ?? []);
    for (const m of e.mentions) for (const x of palabrasDeNombre(det(m).text, kindOf(det(m)))) w.add(x);
    const ce = e.caseEntityId === undefined ? undefined : caseList.find((c) => c.id === e.caseEntityId);
    if (ce !== undefined) {
      const n = new Set(palabrasDeNombre(ce.name));
      delNombreDeLista.set(e.id, n);
      for (const x of n) w.add(x);
    }
    anfitrionas.set(e.id, w);
    for (const x of w) { const l = porPalabra.get(x); if (l === undefined) porPalabra.set(x, [e]); else l.push(e); }
  }
  // Una persona de la lista solo es anfitriona de una forma con alguna palabra que su nombre en la lista no trae: las formas hechas
  // solo de palabras del nombre son variantes y las busca la lista («Las personas de la lista no lo necesitan», 7.12.2.4).
  const candidatas = (s: Entity | null, w: readonly string[]): Entity[] => (w.length === 0 ? [] : (porPalabra.get(w[0] as string) ?? []))
    .filter((o) => o !== s && o.mentions.length > 0
      && (anfitrionas.get(o.id)?.size ?? 0) > w.length && w.every((x) => anfitrionas.get(o.id)?.has(x) === true)
      && (!delNombreDeLista.has(o.id) || w.some((x) => delNombreDeLista.get(o.id)?.has(x) !== true)));
  return { candidatas };
}

/**
 * PB-3-r4 (D-16 en el modelo) · Anfitrionas posibles de una mención ambigua del modelo: las personas del documento (del modelo o de
 * la lista) que contienen todas sus palabras de nombre (C4, S-7.11). Sin `parts`, sin el nombre del correo ni el apodo.
 */
export function anfitrionasPosibles(state: ReviewState, d: Detection, caseList: readonly CaseEntity[],
  parts: ReadonlyMap<PartId, Part> = new Map()): Entity[] {
  const own = state.entities[d.entityId] ?? null;
  return indicePersonas(state, caseList, parts).candidatas(own, palabrasDeNombre(d.text, parts.get(d.partId)?.kind ?? 'cuerpo'));
}

/** C3 · Tipo de la agrupación: persona, organización o lugar (D-14: nunca se une entre tipos distintos). */
const tipoC3 = (t: DetectableType): string => (t === 'PERSONA' ? 'PER' : isOrg(t) ? 'ORG' : t);

/** C2 (D-14) · Signos que rodean una sigla definida: comillas y raya. */
const COMILLAS = `"«“'‘»”’`;
/** Palabras con que el texto define una sigla (vista `lista`). */
const DEFINE_SIGLA = String.raw`(?:en adelante|en lo sucesivo|en lo que sigue|que en adelante se (?:denominara|llamara)|por sus siglas`
  + String.raw`|con (?:la )?sigla|sigla|identificad[oa] con la sigla)(?: (?:como|simplemente))? ?[,:]? ?`;
/** Lo que va entre el nombre de la organización y su sigla al definirla (vista `lista`): un paréntesis, una raya o las palabras
 *  que la definen («(», « – », «, en adelante», «(en lo sucesivo, «»). La sola yuxtaposición («… S.A.S. FESA pagó») no la define. */
const RE_ANTES_DE_SIGLA = new RegExp(String.raw`^\.? ?[,;]? ?(?:[(\[—–-] ?(?:` + DEFINE_SIGLA + String.raw`)?|` + DEFINE_SIGLA + String.raw`)`
  + String.raw`(?:(?:el|la|los|las) )?[${COMILLAS}]? ?$`, 'u');
/** Tras la sigla, para «FESA (Ferretería Ejemplo S.A.S.)»: solo un paréntesis o una raya antes del nombre. */
const RE_ENTRE_SIGLA_Y_NOMBRE = /^[ \t]*[(\[—–-][ \t]*$/u;

/** 7.12.2.4 · Correferencia sobre todo el estado (C1 a C4, arriba). */
function correferir(state: ReviewState, cx: Correferencia): void {
  // En el reductor puede quedar una mención ya borrada (la lista que cedió, D-03): tidyEntities la limpia después.
  for (const e of Object.values(state.entities)) e.mentions = e.mentions.filter((m) => state.detections[m]?.entityId === e.id);
  const det = (m: DetectionId): Detection => state.detections[m] as Detection;
  const kindOf = (d: Detection): PartKind => cx.parts.get(d.partId)?.kind ?? 'cuerpo';
  // M-62: una entidad con el marcador fijado en el asunto, o con alguna mención decidida, no se mueve.
  // PB-3-r4: una mención ambigua (D-16, de la lista o del modelo) tampoco: la decide el revisor.
  const delModelo = (e: Entity): boolean => e.mentions.length > 0 && e.caseEntityId === undefined
    && !e.canonicalKey.startsWith('LISTA:') && !esClaveAmbigua(e.canonicalKey) && !isFixed(e, cx.table) && e.mentions.every((m) => movible(det(m)));
  /** D-14 (A-2): sin el texto de la parte no se puede mirar el contexto, y ante la duda no se une. */
  const otroTitular = (d: Detection): boolean => {
    const p = cx.parts.get(d.partId);
    return p === undefined || marcaOtroTitular(p.text, d.start, d.end, p.kind);
  };
  // M-12: si el usuario rechazó una mención de la entidad que se solapa con una de las que se unirían, ese texto no es esa entidad.
  const rechazos = Object.values(state.detections).filter((o) => o.status === 'rechazada');
  const rechazoCruza = (a: Entity, b: Entity): boolean => a.mentions.some((m) => rechazos.some((o) => overlaps(spanOf(o), spanOf(det(m)))
    && (o.entityId === b.id || (b.caseEntityId !== undefined && o.caseEntityId === b.caseEntityId))));
  const puede = (a: Entity, b: Entity): boolean => (cx.cambiadas === undefined || cx.cambiadas.has(a.id) || cx.cambiadas.has(b.id))
    && !rechazoCruza(a, b);
  /** Entidades que recibieron menciones en esta pasada (C0 a C4): para C5 también cuentan como cambiadas en la ventana. */
  const recibieron = new Set<EntityId>();
  /** La mención que da nombre a la entidad: la primera con la clave de la entidad. Las formas cortas que se le unieron antes van
   *  primero en el orden de lectura y no la definen (D-14, A-2: si no, la anfitriona «Iván Darío Ejemplo Salazar» parecía otra
   *  «Ejemplo Salazar» para C3 y absorbía las formas cortas nuevas aunque hubiera una segunda anfitriona). */
  const cabeza = (e: Entity): Detection => det(e.mentions.find((m) => claveBase(det(m).canonicalKey) === e.canonicalKey) ?? e.mentions[0] as DetectionId);
  const palabrasDe = (e: Entity): string[] => {
    const out = new Set<string>();
    for (const m of e.mentions) for (const w of palabrasDeNombre(det(m).text, kindOf(det(m)))) out.add(w);
    return [...out];
  };
  const unir = (from: Entity, into: Entity, confianza: Detection['confidence'], entreTipos = false): void => {
    // D-14 (A-2): nunca entre tipos distintos (persona, organización, lugar). Entre clases de organización sí («FESA» → la EMPRESA).
    // La única excepción es C5 (D-15, `entreTipos`), con la misma forma exacta y sus salvaguardas.
    if (from !== into && !entreTipos && tipoC3(from.type) !== tipoC3(into.type)) return;
    if (from.mentions.length > 0) recibieron.add(into.id);
    for (const m of from.mentions) {
      const d = det(m);
      d.entityId = into.id; d.confidence = confianza;
      if (d.type !== into.type && (into.type === 'PERSONA' || isOrg(into.type) || (entreTipos && into.type === 'LUGAR'))) {
        d.type = into.type;
        if (into.role !== undefined) d.role = into.role; else delete d.role;
      }
      if (!into.mentions.includes(m)) into.mentions.push(m);
    }
    if (from !== into) from.mentions = [];
  };
  /** `from` pasa a la entidad de la lista de `ce`; si esa entidad todavía no tiene menciones, `from` pasa a serlo. */
  const haciaLista = (ce: CaseEntity, from: Entity, confianza: Detection['confidence']): void => {
    const key = `LISTA:${ce.id}`;
    const e = Object.values(state.entities).find((x) => x.canonicalKey === key && x.mentions.length > 0);
    if (e !== undefined) { if (puede(from, e)) unir(from, e, confianza); return; }
    if (from.mentions.some((m) => rechazos.some((o) => o.caseEntityId === ce.id && overlaps(spanOf(o), spanOf(det(m)))))) return;
    from.canonicalKey = key; from.caseEntityId = ce.id; from.role = ce.role; from.display = ce.name;
    from.type = ce.kind === 'persona' ? 'PERSONA' : ce.role;
    from.family = familyFor(from.type, from.role);
    unir(from, from, confianza);
  };
  const vivas = (): Entity[] => Object.values(state.entities).filter((e) => e.mentions.length > 0);

  /** C4 · El índice de las personas anfitrionas (`indicePersonas`), sobre el estado de ahora. */
  const indice0 = (): ReturnType<typeof indicePersonas> => indicePersonas(state, cx.caseList, cx.parts);
  /**
   * PB-3-r4 (D-16 en el modelo) · Una forma corta del modelo con dos o más anfitrionas posibles (del modelo, de la lista o de las
   * dos) no se une sola (S-7.11) ni se queda como una persona más: cada mención queda ambigua, pendiente, en una entidad propia con
   * la clave de su tramo (sin texto), rol `OTRA_PERSONA` y confianza baja, y la decide el revisor (como D-16 con la lista: cierra
   * la puerta con `PENDIENTES` aunque se acepte y lleva M-2001; las opciones, `anfitrionasPosibles`). La entidad `s` queda para
   * la primera mención. Sin `ids` (no hay de dónde sacar entidades nuevas) no hace nada.
   */
  const volverAmbigua = (s: Entity): void => {
    const ids = cx.ids;
    if (ids === undefined) return;
    s.mentions.forEach((m, i) => {
      const d = det(m);
      const key = claveAmbigua(d);
      d.canonicalKey = key; d.confidence = 'baja'; d.score = Math.min(d.score, 0.3); d.role = 'OTRA_PERSONA';
      const e: Entity = i === 0 ? s : { id: ids.next('ent') as EntityId, canonicalKey: key, type: 'PERSONA', family: 'PERSONA',
        marcadorEspecifico: false, mentions: [], sameHolderAs: [], display: d.text };
      e.canonicalKey = key; e.role = 'OTRA_PERSONA'; e.family = familyFor('PERSONA', 'OTRA_PERSONA'); e.display = d.text;
      e.mentions = [m]; d.entityId = e.id;
      state.entities[e.id] = e;
    });
  };

  // C0 · 7.12.2 paso 2, un grupo por clave: con los resultados por ventana, una mención nueva con la misma clave que una que ya se
  // unió a otra entidad (una unión ya hecha no se deshace) va a esa entidad. Al construir desde cero no ocurre.
  // S-7.11 (D-14, A-2): si otra persona también contiene la forma corta, ya hay dos anfitrionas y la mención nueva no se une a
  // ninguna (las formas cortas ya unidas a la primera se quedan: una unión no se deshace).
  if (cx.cambiadas !== undefined) {
    let indice: ReturnType<typeof indice0> | null = null;
    for (const s of vivas()) {
      if (!cx.cambiadas.has(s.id) || !delModelo(s)) continue;
      const k = s.canonicalKey;
      const hosts = vivas().filter((o) => o !== s && o.mentions.some((m) => claveBase(det(m).canonicalKey) === k && det(m).status !== 'rechazada'));
      if (hosts.length !== 1) continue;
      const host = hosts[0] as Entity;
      if (s.type === 'PERSONA') {
        indice ??= indice0();
        if (indice.candidatas(s, palabrasDe(s)).some((o) => o !== host)) continue;
      }
      if (puede(s, host)) unir(s, host, 'baja');
    }
  }

  // C1 · Nombre de la lista incompleto. D-14 (A-2): no si el texto lo marca como otra persona de la familia («su hijo…»).
  const personasLista = cx.caseList.filter((c) => c.kind === 'persona').map((c) => ({ c, w: palabrasDeNombre(c.name) }))
    .filter((x) => x.w.length >= 2);
  for (const e of vivas()) {
    if (e.type !== 'PERSONA' || !e.canonicalKey.startsWith('PER:') || !delModelo(e)) continue;
    if (cx.cambiadas !== undefined && !cx.cambiadas.has(e.id)) continue;
    const d0 = cabeza(e);
    const w = palabrasDeNombre(d0.text, kindOf(d0));
    const hits = personasLista.filter((x) => w.length > x.w.length && w[0] === x.w[0] && esSubsecuencia(x.w, w));
    if (hits.length !== 1 || e.mentions.some((m) => otroTitular(det(m)))) continue;
    haciaLista((hits[0] as { c: CaseEntity }).c, e, 'media');
  }

  // C2 · Sigla silábica de una organización de la lista. D-14 (A-2): solo si el texto la deriva de esa organización, es decir, la
  // define junto a una mención suya («Ferretería Ejemplo S.A.S. (FESA)», «…, en adelante «FESA»», «FESA (Ferretería…)»). Una
  // sigla que solo encaja en los prefijos puede ser de otra institución («estudió en el CESA»): se queda aparte.
  const orgsLista = cx.caseList.filter((c) => c.kind === 'organizacion').map((c) => {
    const lv = fold(c.name, 'cuerpo').trim();
    const m = RE_SUFIJO_FINAL.exec(lv);
    const nucleo = (m === null ? lv : lv.slice(0, m.index)).replace(RE_SALUD_ALL, ' ');
    return { c, w: nucleo.split(/[^\p{L}\p{N}]+/u).filter((t) => t !== '' && !FW_SET.has(t)), suf: m === null ? '' : m[0].replace(/[^a-z]/gu, '') };
  });
  const definida = (ce: CaseEntity, sigla: string): boolean => {
    const lista = Object.values(state.entities).find((x) => x.canonicalKey === `LISTA:${ce.id}`);
    for (const m of lista?.mentions ?? []) {
      const n = det(m);
      const p = cx.parts.get(n.partId);
      if (p === undefined || n.status === 'rechazada') continue;
      const tras = fold(p.text.slice(n.end, n.end + 96), p.kind);
      for (let i = tras.indexOf(sigla); i >= 0 && i <= 80; i = tras.indexOf(sigla, i + 1)) {
        if (RE_ANTES_DE_SIGLA.test(tras.slice(0, i)) && !/[\p{L}\p{N}]/u.test(tras.charAt(i + sigla.length))) return true;
      }
      const antes = fold(p.text.slice(Math.max(0, n.start - 16), n.start), p.kind);
      const j = antes.lastIndexOf(sigla);
      if (j >= 0 && (j === 0 || !/[\p{L}\p{N}]/u.test(antes.charAt(j - 1))) && RE_ENTRE_SIGLA_Y_NOMBRE.test(antes.slice(j + sigla.length))) return true;
    }
    return false;
  };
  for (const e of vivas()) {
    if (!isOrg(e.type) || !e.canonicalKey.startsWith('ORG:') || !delModelo(e)) continue;
    if (cx.cambiadas !== undefined && !cx.cambiadas.has(e.id)) continue;
    const t = det(e.mentions[0] as DetectionId).text.trim();
    if (!RE_SIGLA.test(t) || e.mentions.some((m) => det(m).text.trim() !== t)) continue;
    const s = fold(t, 'cuerpo');
    const hits = orgsLista.filter((x) => esSiglaSilabica(s, x.w, x.suf));
    if (hits.length === 1 && definida((hits[0] as { c: CaseEntity }).c, s)) haciaLista((hits[0] as { c: CaseEntity }).c, e, 'baja');
  }

  // C3 · Mismo texto con una palabra común que el modelo se llevó («taller Laboratorio Clínico Prueba Ltda.»): el núcleo son las
  // palabras de nombre del texto, sin el sufijo societario final. D-14 (A-2): solo dentro del mismo tipo. Una persona y su sociedad
  // epónima («Pedro Ejemplo Gómez» y «Pedro Ejemplo Gómez S.A.S.») o una persona y un lugar con el mismo nombre son dos titulares.
  const nucleoC3 = (e: Entity): string | null => {
    if (!/^(?:PER|ORG|LUGAR):/u.test(e.canonicalKey) || /^ORG:(?:EPS|IPS):/u.test(e.canonicalKey) || e.canonicalKey.includes(':~')) return null;
    const d0 = cabeza(e);
    const n = palabrasDeNombre(d0.text, kindOf(d0)).join(' ').replace(RE_SUFIJO_FINAL, '').trim();
    return /\p{L}{3}/u.test(n) ? `${tipoC3(e.type)}|${n}` : null;
  };
  const grupos = new Map<string, Entity[]>();
  for (const e of vivas()) {
    const n = e.caseEntityId === undefined && (e.type === 'PERSONA' || isOrg(e.type) || e.type === 'LUGAR') ? nucleoC3(e) : null;
    if (n === null) continue;
    const l = grupos.get(n);
    if (l === undefined) grupos.set(n, [e]); else l.push(e);
  }
  for (const g of grupos.values()) {
    if (g.length < 2) continue;
    const orden = (t: DetectableType): number => { const i = ORDEN_C3.indexOf(t); return i < 0 ? ORDEN_C3.length : i; };
    // Anfitriona: la de más menciones; a igualdad, la de texto limpio (sin palabras comunes ni tratamientos), y luego el orden de tipos.
    const sucio = (e: Entity): number => {
      const t = cabeza(e).text;
      return unidadesDeNombre(t, 'cuerpo').length === t.trim().split(/\s+/u).length ? 0 : 1;
    };
    const into = [...g].sort((a, b) => b.mentions.length - a.mentions.length || sucio(a) - sucio(b) || orden(a.type) - orden(b.type))[0] as Entity;
    for (const e of g) if (e !== into && delModelo(e) && puede(e, into)) unir(e, into, 'baja');
  }

  // C4 · S-7.11 entre personas, con la lista, el nombre de pila del correo y el apodo. D-14 (A-2): una ORG o un LUGAR del modelo
  // ya no se une a una persona, tampoco por el correo que sigue al nombre (el buzón de «Prueba Giraldo» puede ser de la sociedad).
  // PB-3-r4 (D-16 en el modelo): con dos o más anfitrionas, cada mención de la forma corta queda ambigua y la decide el revisor.
  const indice = indice0();
  for (const s of vivas()) {
    if (s.type !== 'PERSONA' || !s.canonicalKey.startsWith('PER:') || !delModelo(s)) continue;
    const w = palabrasDe(s);
    // 1 o 2 palabras del nombre: un apellido con guion es una unidad (7.9.2, «Ejemplo-Acosta Ortiz» son dos).
    const d0 = cabeza(s);
    if (w.length < 1 || unidadesDeNombre(d0.text, kindOf(d0)).length > 2) continue;
    const hosts = indice.candidatas(s, w);
    if (hosts.length >= 2) { volverAmbigua(s); continue; }
    if (hosts.length !== 1) continue;
    const host = hosts[0] as Entity;
    if (puede(s, host)) unir(s, host, 'baja');
  }

  // C5 · D-15, punto 3 (PB-3-r3) · La misma forma con otra etiqueta. Una entidad del modelo cuyas menciones dicen todas
  // exactamente lo mismo (vista `lista`, blancos colapsados) se une a la única anfitriona de otro tipo (persona, organización o
  // lugar) cuyo nombre completo es esa forma: el texto de sus menciones con su propia clave (o el nombre en la lista y sus formas
  // completas): «Papelería Ficticia» que el modelo etiquetó PER es la «Papelería Ficticia» ORG de la frase siguiente.
  // Con dos palabras de nombre o más, también es anfitriona la entidad que ya tiene una mención con ese texto exacto: «Ficticio
  // Barrera» ORG es la forma corta que S-7.11 ya unió a Héctor Fabio Ficticio Barrera. Con una sola palabra no: un apellido suelto
  // unido a una persona («el especialista Ficticio», de Ricardo Ficticio Ortiz) no arrastra otro «Ficticio» con otra etiqueta.
  // Nunca por contención («Ficticia Valencia» ORG no se une a «Elizabeth Ficticia Valencia» si el texto no la escribe así) y solo
  // sin salvaguardas activas (`seguraEntreTipos`): sin sufijo societario, token de salud ni sigla; sin marcador pegado (R-MOD-04)
  // ni palabra de lugar; sin parentesco; con una sola anfitriona, también entre las personas que contienen la forma (S-7.11); M-12
  // y M-62 (`delModelo`, `puede`). El mismo tipo es de C0 y C3.
  const formaDe = (d: Detection): string => fold(d.text, kindOf(d)).replace(/\s+/gu, ' ').trim();
  const conTipo = (e: Entity): boolean => e.type === 'PERSONA' || isOrg(e.type) || e.type === 'LUGAR';
  const ordenTipo = (t: DetectableType): number => { const i = ORDEN_C3.indexOf(t); return i < 0 ? ORDEN_C3.length : i; };
  const COMPLETAS: ReadonlySet<string> = new Set(['exacta', 'sin_tildes', 'mayusculas']);
  const porNombre = new Map<string, Set<Entity>>();   // nombre completo → entidades
  const porForma = new Map<string, Set<Entity>>();    // texto de cualquier mención → entidades
  const anotar = (mapa: Map<string, Set<Entity>>, f: string, e: Entity): void => {
    const s = mapa.get(f);
    if (s === undefined) mapa.set(f, new Set([e])); else s.add(e);
  };
  for (const e of vivas()) {
    if (!conTipo(e) || esClaveAmbigua(e.canonicalKey)) continue;
    const ce = e.caseEntityId === undefined ? undefined : cx.caseList.find((c) => c.id === e.caseEntityId);
    if (ce !== undefined) anotar(porNombre, fold(ce.name, 'cuerpo').replace(/\s+/gu, ' ').trim(), e);
    for (const m of e.mentions) {
      const d = det(m);
      if (d.status === 'rechazada') continue;
      const f = formaDe(d);
      anotar(porForma, f, e);
      const propia = ce !== undefined ? d.source === 'lista' && COMPLETAS.has(d.variantClass ?? '') : claveBase(d.canonicalKey) === e.canonicalKey;
      if (propia) anotar(porNombre, f, e);
    }
  }
  const anfitrionas = (g: Entity, f: string): Entity[] => {
    const out = new Set<Entity>(porNombre.get(f) ?? []);
    if (palabrasDeNombre(f).length >= 2) for (const e of porForma.get(f) ?? []) out.add(e);
    return [...out].filter((o) => o !== g && o.mentions.length > 0);
  };
  /** La forma única de un huésped posible (entidad del modelo movible con todas sus menciones iguales), o null. */
  const huesped = (e: Entity): string | null => {
    if (!conTipo(e) || !delModelo(e)) return null;
    const fs = new Set(e.mentions.map((m) => formaDe(det(m))));
    return fs.size === 1 ? [...fs][0] as string : null;
  };
  /** Salvaguardas de D-15 sobre las menciones del huésped y las de la anfitriona con la forma `f`. */
  const seguraEntreTipos = (g: Entity, h: Entity, f: string): boolean => {
    if (!formaUnibleEntreTipos(f)) return false;
    const ds = [...g.mentions.map(det), ...h.mentions.map(det).filter((d) => d.status !== 'rechazada' && formaDe(d) === f)];
    if (g.mentions.every((m) => RE_SIGLA.test(det(m).text.trim()))) return false;
    const lugar = g.type === 'LUGAR' || h.type === 'LUGAR';
    return ds.every((d) => {
      const p = cx.parts.get(d.partId);
      return p !== undefined && !marcaOtroTitular(p.text, d.start, d.end, p.kind) && !tocaMarcador(p.text, d.start, d.end)
        && (!lugar || !lugarIntroducido(p.text, d.start, p.kind));
    });
  };
  let indice5: ReturnType<typeof indice0> | null = null;
  for (const e0 of vivas()) {
    const f = huesped(e0);
    if (f === null) continue;
    const otras = anfitrionas(e0, f);
    if (otras.length !== 1) continue;   // ninguna o dos anfitrionas: no se une
    let g = e0; let h = otras[0] as Entity;
    if (tipoC3(g.type) === tipoC3(h.type)) continue;
    // Las dos pueden ser huéspedes: la anfitriona es la de más menciones; a igualdad, la primera en el orden de 7.11.3.
    if (huesped(h) === f && (h.mentions.length < g.mentions.length
      || (h.mentions.length === g.mentions.length && ordenTipo(h.type) > ordenTipo(g.type)))) [g, h] = [h, g];
    if (!seguraEntreTipos(g, h, f)) continue;
    if (h.type === 'PERSONA') {
      indice5 ??= indice0();
      if (indice5.candidatas(g, palabrasDeNombre(f)).some((o) => o !== h)) continue;
    }
    // Por ventana: la forma ORG de una ventana anterior se une cuando la anfitriona recibe en esta la forma PER que C4 le unió.
    const enVentana = cx.cambiadas === undefined || [g, h].some((e) => cx.cambiadas?.has(e.id) === true || recibieron.has(e.id));
    if (enVentana && !rechazoCruza(g, h)) unir(g, h, 'baja', true);
  }
}

/** D-15 · Palabras de lugar (vista `lista`): tipos de lugar y de vía, y los nombres de los departamentos de la DIVIPOLA. */
const PALABRAS_DE_LUGAR: ReadonlySet<string> = new Set(('calle|carrera|cra|avenida|av|diagonal|transversal|autopista|via|kilometro|km|barrio|'
  + 'vereda|corregimiento|municipio|departamento|ciudad|localidad|comuna|sector|urbanizacion|conjunto|edificio|torre|manzana|finca|hacienda|'
  + 'parque|plaza|rio|puerto|isla|cerro|valle|region|provincia|amazonas|antioquia|arauca|atlantico|bolivar|boyaca|caldas|caqueta|casanare|'
  + 'cauca|cesar|choco|cordoba|cundinamarca|guainia|guaviare|huila|guajira|magdalena|meta|narino|putumayo|quindio|risaralda|santander|'
  + 'sucre|tolima|vaupes|vichada|bogota').split('|'));
/** Cualquier sufijo societario de R-LST-05 como palabra suelta (no solo al final). */
const RE_SUFIJO_SUELTO = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:` + SUFIJO + String.raw`)(?![\p{L}\p{N}])`, 'u');
/** D-15 · La forma (ya en vista `lista`) puede unir dos tipos: sin sufijo, sin token de salud, sin palabra de lugar, y con alguna
 *  palabra de nombre de tres letras o más. */
function formaUnibleEntreTipos(f: string): boolean {
  if (RE_SUFIJO_SUELTO.test(f) || RE_SALUD_FIRST.test(f)) return false;
  const w = palabrasDeNombre(f);
  return w.some((x) => x.length >= 3) && !f.split(/[^\p{L}\p{N}]+/u).some((x) => PALABRAS_DE_LUGAR.has(x));
}
/** 6.2.3 (R-MOD-04): un marcador de Sig-Low. */
const MARCADOR = String.raw`\[(?:${Object.values(MARKER_LABEL).join('|')})_[1-9][0-9]{0,3}\]`;
const RE_MARCADOR_ANTES = new RegExp(MARCADOR + String.raw`[ \t\-‐‑]*$`, 'u');
const RE_MARCADOR_DESPUES = new RegExp(String.raw`^[ \t\-‐‑]*` + MARCADOR, 'u');
/** D-15 · La mención contiene un marcador o va pegada a uno en la misma línea (texto reprocesado, R-RES-03). Ventanas fijas. */
function tocaMarcador(text: string, start: number, end: number): boolean {
  return /[[\]]/u.test(text.slice(start, end)) || RE_MARCADOR_ANTES.test(text.slice(Math.max(0, start - 24), start))
    || RE_MARCADOR_DESPUES.test(text.slice(end, end + 24));
}
/** D-15 · Un lugar introducido justo antes de la mención («vive en…», «hacia la…», «del barrio…»). Vista `lista`, ventana fija. */
const RE_LUGAR_ANTES = new RegExp(String.raw`(?:^|[^\p{L}\p{N}])(?:en|hacia|desde|hasta|barrio|vereda|municipio|ciudad|corregimiento|departamento|localidad|sector)`
  + String.raw`(?: (?:de|del))?(?: (?:el|la|los|las))? ?$`, 'u');
function lugarIntroducido(text: string, start: number, kind: PartKind): boolean {
  return RE_LUGAR_ANTES.test(fold(text.slice(Math.max(0, start - 32), start), kind).replace(/\s+/gu, ' '));
}

function esSubsecuencia(sub: readonly string[], seq: readonly string[]): boolean {
  let i = 0;
  for (const w of seq) if (i < sub.length && w === sub[i]) i++;
  return i === sub.length;
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
/**
 * M-62 · Una acción del usuario sobre la entidad (`cambiar_rol`, `unir_entidades`) deja `decidedBy = 'grupo'` en sus menciones
 * del modelo que siguen pendientes y sin decisión: la correferencia de una ventana posterior ya no las mueve (`movible`). No
 * cambia el estado, lo ya decidido ni el informe (report.ts solo cuenta las aceptadas por grupo).
 * B-92 · Además, cada mención del modelo de la entidad, decidida o no, lleva `~ent` en su clave: una decisión y un `restablecer`
 * en cada mención ya no borran el rastro de la acción sobre la entidad.
 */
function decididaPorEntidad(s: ReviewState, e: Entity): void {
  for (const m of e.mentions) {
    const d = s.detections[m];
    if (d === undefined || d.source !== 'modelo') continue;
    if (!d.canonicalKey.endsWith(MARCA_ENTIDAD)) d.canonicalKey += MARCA_ENTIDAD;
    if (d.status === 'pendiente' && d.decidedBy === undefined) d.decidedBy = 'grupo';
  }
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
 * D-16: una mención ambigua (sin `caseEntityId`) está intacta mientras siga sola en su entidad propia, con la clave de su tramo,
 * persona y `OTRA_PERSONA`: el nombre completo del modelo que la contiene puede tomarla como a cualquier variante débil (D-03 B).
 */
export function listaIntacta(state: ReviewState, d: Detection, caseList: readonly CaseEntity[]): boolean {
  if (d.source !== 'lista' || d.status !== 'pendiente') return false;
  if (d.decidedBy !== undefined || d.rejectReason !== undefined || d.replacement.edited !== undefined
    || d.replacement.generalized !== undefined || d.coveredBy !== undefined || d.suggestionId !== undefined) return false;
  const e = state.entities[d.entityId];
  if (e === undefined || !e.mentions.includes(d.id)) return false;
  if (d.caseEntityId === undefined) {
    if (!esClaveAmbigua(d.canonicalKey) || e.canonicalKey !== d.canonicalKey || e.mentions.length !== 1 || e.caseEntityId !== undefined
      || d.type !== 'PERSONA' || e.type !== 'PERSONA' || d.role !== 'OTRA_PERSONA' || e.role !== 'OTRA_PERSONA') return false;
  } else {
    const ce = caseList.find((c) => c.id === d.caseEntityId);
    if (ce === undefined) return false;
    const key = `LISTA:${ce.id}`;
    if (d.canonicalKey !== key || e.canonicalKey !== key) return false;
    if (d.type !== (ce.kind === 'persona' ? 'PERSONA' : ce.role) || d.role !== ce.role || e.role !== ce.role) return false;
  }
  for (const x of Object.values(state.suggestions)) {
    if ((x.target.kind === 'deteccion' ? x.target.detectionId : x.target.relatedDetectionId) === d.id) return false;
  }
  if (Object.values(state.flags).some((f) => f.detectionId === d.id)) return false;
  return !Object.values(state.spanEdits).some((x) => overlaps(x.span, spanOf(d)));
}

/**
 * D-03 B y E · ¿La detección `o` del estado cede ante la detección nueva `d0` de una ventana del modelo? Solo si es de la lista,
 * está intacta, `d0` la contiene y es más larga, y: (E) `d0` es la misma entidad de la lista con el nombre completo, o
 * (B) `o` es una variante débil de una palabra de otra entidad, o (D-14, A-2) `d0` es el nombre completo de otra persona
 * (`nombreDeOtraPersona`, con `parts`). La comprobación semántica (si el tramo es variante de la
 * entidad) la hizo la fusión (merge.ts); el reductor solo acota a quién se le puede quitar el tramo.
 */
export function cedeAnteModelo(state: ReviewState, o: Detection, d0: Detection, caseList: readonly CaseEntity[],
  parts?: ReadonlyMap<PartId, Part>): boolean {
  if (!contains(spanOf(d0), spanOf(o)) || o.end - o.start >= d0.end - d0.start || !listaIntacta(state, o, caseList)) return false;
  if (d0.source === 'lista' && d0.caseEntityId === o.caseEntityId) return true;
  if (d0.source === 'modelo' && nombreDeOtraPersona(o, d0, caseList, parts)) return true;
  return (d0.source === 'modelo' || d0.source === 'lista') && esVarianteDebil(o, o.text);
}

/**
 * D-14 (A-2) · El nombre completo `d0` del modelo que contiene la mención `o` de una persona de la lista es el de otra persona: el
 * texto la marca como otra de la familia (`marcaOtroTitular`) o `d0` agrega delante de `o` un nombre de pila que no es del nombre
 * de esa persona («Wilson» + «Ejemplo Muñoz» de «Carmen Rosa Ejemplo Muñoz»). La fusión (`planDelModelo` de merge.ts) propone
 * entonces que la lista ceda; el reductor lo acepta con la detección de la lista intacta. Sin el texto de las partes, no.
 */
function nombreDeOtraPersona(o: Detection, d0: Detection, caseList: readonly CaseEntity[], parts?: ReadonlyMap<PartId, Part>): boolean {
  const p = parts?.get(d0.partId);
  if (p === undefined || o.type !== 'PERSONA' || d0.type !== 'PERSONA' || o.caseEntityId === undefined) return false;
  if (marcaOtroTitular(p.text, d0.start, d0.end, p.kind)) return true;
  const ce = caseList.find((c) => c.id === o.caseEntityId);
  if (ce === undefined) return false;
  const nombre = new Set(palabrasDeNombre(ce.name));
  const antes = palabrasDeNombre(p.text.slice(d0.start, Math.max(d0.start, o.start)), p.kind);
  return antes.some((w) => !nombre.has(w)) && palabrasDeNombre(d0.text, p.kind).some((w) => !nombre.has(w));
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
  // D-16: también una mención ambigua rechazada; el revisor dijo que ese texto no es de la lista, y la extensión se lo daría a una.
  return d0.source === 'lista' && d0.caseEntityId !== undefined && Object.values(state.detections).some((o) => o.status === 'rechazada'
    && o.source === 'lista' && (o.caseEntityId === d0.caseEntityId || (o.caseEntityId === undefined && esClaveAmbigua(o.canonicalKey)))
    && overlaps(spanOf(o), spanOf(d0)));
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
        // B-82 (D-14): restablecer deshace la decisión de estado, no la separación ni lo que el usuario hizo sobre la entidad. Una
        // mención separada (`~sep` en su clave) conserva el `decidedBy` de `separar_mencion`; una pendiente no tiene decisión que
        // deshacer y conserva el suyo (`cambiar_rol`, `unir_entidades`, M-62). B-92: una mención con `~ent` (la acción sobre su
        // entidad) vuelve al `decidedBy = 'grupo'` de esa acción, aunque el usuario la hubiera decidido después.
        const pendiente = d.status === 'pendiente';
        d.status = 'pendiente'; delete d.rejectReason; delete d.replacement.edited;
        if (d.canonicalKey.includes('~sep')) d.decidedBy = 'individual';
        else if (d.canonicalKey.endsWith(MARCA_ENTIDAD)) d.decidedBy = 'grupo';
        else if (!pendiente) delete d.decidedBy;
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
        // 7.12.2.4: una mención que el revisor separó no se vuelve a unir con la correferencia de una ventana posterior. B-82: la clave
        // de la detección lleva siempre `~sep` (la entidad, la de 7.12.6: `~sep` solo si repite la de origen), que ni `restablecer`
        // ni una decisión borran; `decidedBy` lo conserva `restablecer`.
        delete d.caseEntityId; d.canonicalKey = key.endsWith('~sep') ? key : `${key}~sep`;
        d.decidedBy = 'individual';
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
      decididaPorEntidad(s, e);
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
      // D-16: unir una mención ambigua con una entidad es elegir a esa persona; la que se mueve es siempre la ambigua.
      else if (esClaveAmbigua(into.canonicalKey) && !esClaveAmbigua(from.canonicalKey)) [from, into] = [into, from];
      for (const m of [...from.mentions]) attach(s, s.detections[m] as Detection, into);
      into.sameHolderAs = [...new Set([...into.sameHolderAs, ...from.sameHolderAs])];
      for (const o of Object.values(s.entities)) o.sameHolderAs = o.sameHolderAs.map((x) => (x === from.id ? into.id : x));
      decididaPorEntidad(s, into);
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
        fromCandidate(s, c, part, ids, ctx.caseList);
      }
      // M-72: el apellido suelto de la lista que llega con los residuos tampoco se asigna si lo lleva otra persona del documento.
      ambiguasPorOtraPersona(s, ctx.caseList, parts, ids);
      return null;
    }
    case 'incorporar_modelo': {
      const m = s.modelo;
      if (m.kind !== 'en_curso' || a.ventana <= m.ventanas) return 'IGNORADA';
      const rejected = Object.values(s.detections).filter((d) => d.status === 'rechazada');
      const deltaEntities = new Map(a.delta.entities.map((e) => [e.id, e]));
      const cambiadas = new Set<EntityId>();
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
            || !tocadas.every((o) => cedeAnteModelo(s, o, d0, ctx.caseList, parts))) continue;
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
        cambiadas.add(e.id);
      }
      // 7.12.2.4: la correferencia se recalcula sobre lo acumulado (una forma corta de una ventana anterior y el nombre completo
      // que llega ahora); solo mueve detecciones del modelo pendientes e intactas y nunca deshace una unión.
      if (cambiadas.size > 0) {
        correferir(s, { caseList: ctx.caseList, parts, table: ctx.table, cambiadas, ids });
        // M-72: la otra persona con el apellido de la lista suele llegar con el modelo, después de la mención de la lista.
        ambiguasPorOtraPersona(s, ctx.caseList, parts, ids);
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

function fromCandidate(s: ReviewState, c: DetectionCandidate, part: Part, ids: IdSource, caseList: readonly CaseEntity[]): Detection {
  const d: Detection = { id: ids.next('det') as DetectionId, docId: s.docId, partId: c.partId, start: c.start, end: c.end,
    text: part.text.slice(c.start, c.end), type: c.type as DetectableType, source: c.source, precedence: precedenceOf(c),
    confidence: c.confidence, score: c.score, canonicalKey: c.canonicalKey, status: 'pendiente', entityId: '' as EntityId,
    replacement: { proposedTemplate: TEMPLATE_M } };
  for (const f of ['role', 'ruleId', 'caseEntityId', 'variantClass', 'nerLabel', 'label', 'validator'] as const) {
    if (c[f] !== undefined) (d as unknown as Record<string, unknown>)[f] = c[f];
  }
  s.detections[d.id] = d;
  // D-16: la búsqueda de residuos tampoco asigna una variante que comparten dos o más personas de la lista.
  if (candidatasAmbiguas(c, d.text, caseList).length > 0) {
    delete d.caseEntityId; d.role = 'OTRA_PERSONA'; d.confidence = 'baja'; d.score = Math.min(d.score, 0.3);
    d.canonicalKey = claveAmbigua(d);
    attach(s, d, entityByKey(s, d.canonicalKey) ?? newEntity(s, ids, d.canonicalKey, d, 'OTRA_PERSONA'));
    return d;
  }
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
