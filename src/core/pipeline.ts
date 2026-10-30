// Tubería de detección (6.11.2, 7.10.7 a 7.10.10, 7.11): reglas, lista del caso, lugares, fusión, entidades, sugerencias y banderas,
// con resultados progresivos del modelo (`fusionar` por ventana, delta) y sesiones que `liberar` borra. PB-6.
// Código puro de core/: sin DOM ni red. `createDetectHandler` es la lógica del worker `detect` (src/workers/detect.worker.ts solo la conecta,
// como io-handler.ts con el worker `io`). Los errores salen solo con ErrorCode (INV-W01, INV-W02); ningún texto del documento viaja en un
// mensaje de progreso (INV-W07).
import { SiglowError } from './types.ts';
import type {
  CaseEntity, Confidence, DetectOptions, DetectResult, Detection, DetectionCandidate, DetectionSet, DocumentModel,
  EntityId, ErrorCode, Flag, FlagId, IdSource, IsoDate, MergedCandidate, NerLabel, NerSpan, Part, PartId, PartKind, RuleRegistry, RuleSpec,
  SearchView, SpanEdit, Stage, ProgressUnit, Suggestion, TableIndex,
} from './types.ts';
import { buildSearchView, toCanonicalSpan } from './normalize.ts';
import { runRules } from './rules/catalog.ts';
import { rules as rContacto } from './rules/contacto.ts';
import { rules as rDireccion } from './rules/direccion.ts';
import { rules as rExclusiones } from './rules/exclusiones.ts';
import { rules as rFechas, consolidarFechasSinAnio } from './rules/fechas.ts';
import { rules as rIds } from './rules/ids.ts';
import { rules as rRadicado } from './rules/radicado.ts';
import { rules as rRotulados } from './rules/rotulados.ts';
import { rules as rValores } from './rules/valores.ts';
import { configurarDivipola, divipolaCodes } from './validators/radicado.ts';
import { findCaseMentions } from './caselist.ts';
import { mergeCandidates } from './merge.ts';
import { buildDetectionSet, cryptoIds, orgKey, personKey } from './entities.ts';
import {
  DIVIPOLA, candidateFromLoc, departamentosDeRadicados, detectPlaces, generalize, vistaLista,
} from './generalize.ts';
import type { GenDetection, GeneralizeResult } from './generalize.ts';

// ---------------------------------------------------------------------------------------------
// Catálogo de reglas y registro para los remanentes (7.11.2)
// ---------------------------------------------------------------------------------------------

/** Todas las reglas del Catálogo A que ejecuta `detectar`, en el orden de los archivos de PA-2 a PA-7. */
export const ALL_RULES: readonly RuleSpec[] = [
  ...rIds, ...rContacto, ...rRadicado, ...rFechas, ...rValores, ...rDireccion, ...rRotulados, ...rExclusiones,
];
const RULE_BY_ID: ReadonlyMap<string, RuleSpec> = new Map(ALL_RULES.map((r) => [r.id, r]));

/** `rules.rerun(ruleId, texto)` (6.4.2): vuelve a ejecutar una regla sobre un remanente; las reglas de lugares no están aquí. */
export function createRuleRegistry(refYear: number): RuleRegistry {
  return {
    rerun(ruleId, text) {
      const rule = RULE_BY_ID.get(ruleId);
      if (rule === undefined) return null;
      const view = buildSearchView(text, 'reglas', 'cuerpo');
      const found = runRules(view, 'prt_' + '0'.repeat(32) as PartId, [rule], refYear);
      let best: DetectionCandidate | null = null;
      for (const c of found) if (best === null || c.end - c.start > best.end - best.start) best = c;
      return best === null ? null : { start: best.start, end: best.end, canonicalKey: best.canonicalKey };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Resultado del modelo → candidatos (7.10.7 a 7.10.9)
// ---------------------------------------------------------------------------------------------

/** 6.2.3 (R-MOD-04), sin anclas. */
const MARCADOR = /\[(?:DEMANDANTE|DEMANDADO|TESTIGO|PACIENTE|CLIENTE|CONTACTO|PERSONA|EMPRESA|EPS|IPS|ENTIDAD|PROVEEDOR|CC|TI|CE|PPT|PEP|PASAPORTE|NIT|TP|DOCUMENTO|DIRECCIÓN|TELÉFONO|CORREO|RADICADO|HC|AFILIACIÓN|PLACA|MATRÍCULA|CUENTA|FECHA|VALOR|DEPARTAMENTO)_[1-9][0-9]{0,3}\]/gu;
/** R-MOD-03 (misma lista que merge.ts, sobre la vista `lista` del tramo). */
const FW = 'de|del|la|las|los|el|lo|y|e|o|u|a|al|en|por|para|con|sin|su|sus|que|se|un|una|unos|unas|senorita|senora|senor|srta|sra|sr|dona|don|doctora|doctor|dra|dr|mrs|mr|ms';
const RE_TRIM_LEFT = new RegExp(String.raw`^(?:[\s\p{P}\p{S}]+|(?:` + FW + String.raw`)(?=[\s\p{P}\p{S}]|$))+`, 'u');
const RE_TRIM_RIGHT = new RegExp(String.raw`(?:[\s\p{P}\p{S}]+|(?<=^|[\s\p{P}\p{S}])(?:` + FW + String.raw`))+$`, 'u');
/** R-MOD-05, R-MOD-06 y R-MOD-07, sobre la vista `lista` del tramo. */
const RE_EPS = /(?<![\p{L}\p{N}])(?:e\. ?p\. ?s\.?|eps|entidad promotora de salud)(?![\p{L}\p{N}])/u;
const RE_IPS = /(?<![\p{L}\p{N}])(?:i\. ?p\. ?s\.?|ips|e\. ?s\. ?e\.?|institucion prestadora de (?:servicios de )?salud|clinica|hospital|centro medico|centro de salud|laboratorio clinico)(?![\p{L}\p{N}])/u;
const RE_AUTORIDAD = /(?<![\p{L}\p{N}])(?:juzgado|tribunal|corte|consejo de estado|consejo superior|fiscalia|procuraduria|defensoria|personeria|contraloria|registraduria|superintendencia|ministerio|alcaldia|gobernacion|secretaria de|concejo|asamblea departamental|departamento administrativo|unidad administrativa|agencia nacional|instituto (?:colombiano|nacional|departamental|municipal)|policia|ejercito|armada|notaria|curaduria|inspeccion de policia|comisaria de familia)(?![\p{L}\p{N}])/u;
const CONF_RANK: Readonly<Record<Confidence, number>> = { baja: 0, media: 1, alta: 2 };
const NER_LABELS: ReadonlySet<string> = new Set<NerLabel>(['PER', 'ORG', 'LOC', 'OTH', 'DATE']);
/** Piso de una bandera OTH del modelo (7.10.8). */
const OTH_MIN = 0.9;

/** Trozos de [start, end) que quedan fuera de los marcadores (R-MOD-04): contenido → ninguno; cruce → lo de afuera. */
function fueraDeMarcadores(text: string, start: number, end: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let cur = start;
  for (const m of text.slice(start, end).matchAll(MARCADOR)) {
    const ms = start + (m.index ?? 0);
    if (ms > cur) out.push([cur, ms]);
    cur = ms + m[0].length;
  }
  if (cur < end) out.push([cur, end]);
  return out;
}

/** R-MOD-03: recorta signos, palabras de función y tratamientos en los bordes, con el mapa de la vista `lista`. */
function recortarBordes(text: string, start: number, end: number, kind: PartKind): { start: number; end: number } | null {
  const v = buildSearchView(text.slice(start, end), 'lista', kind);
  const l = RE_TRIM_LEFT.exec(v.text);
  const ns = l === null ? 0 : l[0].length;
  const r = RE_TRIM_RIGHT.exec(v.text.slice(ns));
  const ne = v.text.length - (r === null ? 0 : r[0].length);
  if (ne <= ns) return null;
  const c = toCanonicalSpan(v, ns, ne);
  return { start: start + c.start, end: start + c.end };
}

export interface NerContext {
  part: Part;
  options: Pick<DetectOptions, 'nerHighThreshold' | 'nerMinScore'>;
  /** Departamentos con evidencia en la parte (7.7.2), para los LOC. */
  docDepCodes: readonly string[];
  /** Candidatos de reglas y lista de la parte: una regla de fecha que cubre un DATE lo descarta. */
  base: readonly DetectionCandidate[];
  ids: IdSource;
}
export interface NerConversion { candidates: DetectionCandidate[]; flags: Flag[] }

/**
 * 7.10.7 a 7.10.9: filtros, mapeo de etiquetas y bandas de confianza. PER → PERSONA; ORG → EPS, IPS o EMPRESA (un despacho o una
 * autoridad no es detección: lo cubre la sugerencia de generalize.ts); LOC → municipio, departamento o LUGAR; OTH ≥ 0,90 → bandera.
 * `media` es lo más alto que puede dar el modelo. No lanza con tramos fuera de rango: los descarta.
 */
export function candidatesFromNer(spans: readonly NerSpan[], c: NerContext): NerConversion {
  const { part } = c;
  const text = part.text;
  const out: NerConversion = { candidates: [], flags: [] };
  for (const sp of spans) {
    if (!(sp.score >= c.options.nerMinScore) || !Number.isInteger(sp.start) || !Number.isInteger(sp.end)) continue;
    if (sp.start < 0 || sp.end > text.length || sp.end <= sp.start || !NER_LABELS.has(sp.label)) continue;
    if (sp.label === 'OTH') {
      if (sp.score < OTH_MIN) continue;
      out.flags.push({ id: c.ids.next('flg') as FlagId, type: 'HECHO_LLAMATIVO', span: { partId: part.id, start: sp.start, end: sp.end },
        text: text.slice(sp.start, sp.end), reason: 'MODELO_OTH', options: [], acknowledged: false });
      continue;
    }
    // (1) marcadores y (2) bordes; (3) vacío, un solo carácter o sin letras.
    const trozos = fueraDeMarcadores(text, sp.start, sp.end);
    let mejor: [number, number] | null = null;
    for (const t of trozos) if (mejor === null || t[1] - t[0] > mejor[1] - mejor[0]) mejor = t;
    if (mejor === null) continue;
    const rec = recortarBordes(text, mejor[0], mejor[1], part.kind);
    if (rec === null) continue;
    const s = rec.start; const e = rec.end;
    const piece = text.slice(s, e);
    if ([...piece.replace(/\s+/gu, '')].length < 2 || !/\p{L}/u.test(piece)) continue;
    const banda: Confidence = sp.score >= c.options.nerHighThreshold ? 'media' : 'baja';
    const nuevo = (type: DetectionCandidate['type'], key: string, confidence: Confidence, extra: Partial<DetectionCandidate> = {}): void => {
      out.candidates.push({ partId: part.id, start: s, end: e, type, source: 'modelo', nerLabel: sp.label, confidence, score: sp.score, canonicalKey: key, ...extra });
    };
    const lista = vistaLista(piece);
    switch (sp.label) {
      case 'PER':
        nuevo('PERSONA', personKey(piece, part.kind), banda, { role: 'OTRA_PERSONA' });
        break;
      case 'ORG': {
        if (RE_EPS.test(lista)) nuevo('EPS', orgKey(piece, part.kind), banda);
        else if (RE_IPS.test(lista)) nuevo('IPS', orgKey(piece, part.kind), banda);
        else if (RE_AUTORIDAD.test(lista)) break;   // despacho o autoridad: lo cubre DESPACHO_A_GENERICO (generalize.ts)
        else nuevo('EMPRESA', orgKey(piece, part.kind), banda);
        break;
      }
      case 'LOC': {
        const loc = candidateFromLoc(part.id, text, s, e, c.docDepCodes);
        if (loc === null) nuevo('LUGAR', 'LUGAR:' + lista.trim(), 'baja');
        else {
          loc.nerLabel = 'LOC'; loc.score = sp.score;
          if (CONF_RANK[banda] < CONF_RANK[loc.confidence]) loc.confidence = banda;
          out.candidates.push(loc);
        }
        break;
      }
      case 'DATE':
        if (!c.base.some((b) => b.type === 'FECHA' && b.start < e && s < b.end)) nuevo('FECHA', 'FECHA:~' + lista.trim(), 'baja');
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Errores y mensajes (INV-W01, INV-W02)
// ---------------------------------------------------------------------------------------------

export type Post = (msg: unknown) => void;
const REQ_ID = /^req_[0-9a-f]{32}$/u;
const REQ_NULO = 'req_' + '0'.repeat(32);
const REINTENTABLES: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['TIEMPO_AGOTADO', 'MEMORIA']);

/** `message` de un worker `error`: solo v, reqId, kind, code y retryable (INV-W01). */
export function mensajeError(reqId: string, code: ErrorCode): { v: 1; reqId: string; kind: 'error'; code: ErrorCode; retryable: boolean } {
  return { v: 1, reqId, kind: 'error', code, retryable: REINTENTABLES.has(code) };
}
/** Traduce cualquier cosa lanzada a un ErrorCode. Nunca usa `message` ni `stack`. */
export function codigoDe(e: unknown): ErrorCode {
  if (e instanceof SiglowError) return e.code;
  if (e instanceof RangeError) return 'MEMORIA';
  return 'ERROR_INTERNO';
}

/** Regla de progreso (6.11.1): máximo 10 mensajes por segundo; los demás se descartan. */
export class ProgressLimiter {
  private last = -Infinity;
  constructor(private readonly now: () => number, private readonly minGapMs = 100) {}
  /** `true` si ya toca emitir (y lo registra). */
  take(): boolean {
    const t = this.now();
    if (t - this.last < this.minGapMs) return false;
    this.last = t;
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// Validación de la entrada
// ---------------------------------------------------------------------------------------------

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const esEntero = (x: unknown, min = 0): x is number => typeof x === 'number' && Number.isInteger(x) && x >= min;
const PART_KINDS: ReadonlySet<string> = new Set<PartKind>(['encabezado', 'cuerpo', 'pie', 'nota_pie', 'nota_final', 'comentario', 'anotacion_pdf', 'pagina_pdf']);
const entrada = (): never => { throw new SiglowError('ENTRADA_INVALIDA'); };

function validarDoc(x: unknown): DocumentModel {
  if (!esObjeto(x) || typeof x.id !== 'string' || !Array.isArray(x.parts)) return entrada();
  const ids = new Set<string>();
  for (const p of x.parts as unknown[]) {
    if (!esObjeto(p) || typeof p.id !== 'string' || typeof p.text !== 'string' || typeof p.kind !== 'string' || !PART_KINDS.has(p.kind)
      || typeof p.included !== 'boolean' || !esEntero(p.order) || ids.has(p.id)) return entrada();
    ids.add(p.id);
  }
  return x as unknown as DocumentModel;
}
function validarOpciones(x: unknown): DetectOptions {
  if (!esObjeto(x) || typeof x.referenceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(x.referenceDate) || typeof x.rulesVersion !== 'string'
    || typeof x.nerHighThreshold !== 'number' || !Number.isFinite(x.nerHighThreshold)
    || typeof x.nerMinScore !== 'number' || !Number.isFinite(x.nerMinScore)) return entrada();
  return x as unknown as DetectOptions;
}
function validarTabla(x: unknown): TableIndex {
  if (!esObjeto(x) || !esObjeto(x.byKey) || !esObjeto(x.counters) || !esEntero(x.documentCount)) return entrada();
  return x as unknown as TableIndex;
}
function validarNer(x: unknown, partes: ReadonlyMap<string, Part>): Map<PartId, NerSpan[]> {
  if (!esObjeto(x)) return entrada();
  const out = new Map<PartId, NerSpan[]>();
  for (const [pid, arr] of Object.entries(x)) {
    const part = partes.get(pid);
    if (part === undefined || !Array.isArray(arr)) return entrada();
    const spans: NerSpan[] = [];
    for (const s of arr as unknown[]) {
      if (!esObjeto(s) || !esEntero(s.start) || !esEntero(s.end) || s.end <= s.start || s.end > part.text.length
        || typeof s.label !== 'string' || !NER_LABELS.has(s.label) || typeof s.score !== 'number' || !(s.score >= 0 && s.score <= 1)) return entrada();
      spans.push({ start: s.start, end: s.end, label: s.label as NerLabel, score: s.score });
    }
    out.set(part.id, spans);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Ids estables entre pasadas
// ---------------------------------------------------------------------------------------------

/** Registra los ids que entrega, por prefijo, para repetirlos en una segunda construcción idéntica. */
function recordingIds(base: IdSource): { src: IdSource; log: Map<string, string[]> } {
  const log = new Map<string, string[]>();
  return { log, src: { next(prefix) { const v = base.next(prefix); const q = log.get(prefix) ?? []; q.push(v); log.set(prefix, q); return v; } } };
}
function replayIds(log: ReadonlyMap<string, string[]>, base: IdSource): IdSource {
  const pos = new Map<string, number>();
  return { next(prefix) { const i = pos.get(prefix) ?? 0; pos.set(prefix, i + 1); return log.get(prefix)?.[i] ?? base.next(prefix); } };
}
/** Sustituye cada cadena que sea una clave del mapa (los ids son cadenas aleatorias de 36 caracteres: no hay colisiones). */
function remap<T>(value: T, map: ReadonlyMap<string, string>): T {
  if (map.size === 0) return value;
  const go = (x: unknown): unknown => {
    if (typeof x === 'string') return map.get(x) ?? x;
    if (Array.isArray(x)) return x.map(go);
    if (typeof x === 'object' && x !== null) return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, go(v)]));
    return x;
  };
  return go(value) as T;
}

const spanKey = (d: { partId: PartId; start: number; end: number; type?: string }): string => `${d.partId}:${d.start}:${d.end}:${d.type ?? ''}`;

// ---------------------------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------------------------

interface Session {
  doc: DocumentModel;
  parts: Part[];
  caseList: CaseEntity[];
  table: TableIndex;
  options: DetectOptions;
  registry: RuleRegistry;
  ids: IdSource;
  base: Map<PartId, DetectionCandidate[]>;      // reglas + lugares + lista
  docDeps: Map<PartId, string[]>;
  model: Map<PartId, DetectionCandidate[]>;
  modelFlags: Flag[];
  merged: Map<PartId, MergedCandidate[]>;
  emitted: { det: Map<string, string>; ent: Map<string, string>; sug: Map<string, string>; flg: Map<string, string> };
  ventana: number;                              // la mayor ya incorporada
  cerrada: boolean;                             // tras `fusionar` con ner null no entran más ventanas
}

type FullSet = DetectionSet & { spanEdits: SpanEdit[] };

/** Conjunto completo con los candidatos de reglas, lista y modelo acumulados, con los ids ya emitidos por la sesión. */
function construir(s: Session, cambiadas: ReadonlySet<PartId>): FullSet {
  for (const p of s.parts) {
    if (!cambiadas.has(p.id) && s.merged.has(p.id)) continue;
    s.merged.set(p.id, mergeCandidates(p, [...(s.base.get(p.id) ?? []), ...(s.model.get(p.id) ?? [])], s.registry));
  }
  const todos: MergedCandidate[] = s.parts.flatMap((p) => s.merged.get(p.id) ?? []);
  const doc: DocumentModel = { ...s.doc, parts: s.parts };
  const rec = recordingIds(s.ids);
  const ctx = { table: s.table, caseList: s.caseList, ids: rec.src };
  const pasada1 = buildDetectionSet(doc, todos, ctx);

  // generalize.ts necesita los ids de las detecciones (6.4.5): por eso la construcción va en dos pasadas con los mismos ids.
  const porTramo = new Map(pasada1.detections.map((d) => [spanKey(d), d]));
  const sugerencias: Suggestion[] = [];
  const banderas: Flag[] = [...s.modelFlags];
  for (const p of s.parts) {
    const view = buildSearchView(p.text, 'reglas', p.kind);
    const gens: GenDetection[] = [];
    for (const m of s.merged.get(p.id) ?? []) {
      const d = porTramo.get(spanKey(m));
      const g: GenDetection = { start: m.start, end: m.end, type: m.type, canonicalKey: m.canonicalKey };
      if (d !== undefined) g.id = d.id;
      if (m.context !== undefined) g.context = m.context;
      const label = d?.label ?? m.label;
      if (label !== undefined) g.label = label;
      if (m.placeOptions !== undefined) g.placeOptions = m.placeOptions;
      gens.push(g);
    }
    const r: GeneralizeResult = generalize({ part: p, view, detections: gens, options: { referenceDate: s.options.referenceDate as IsoDate },
      docDepCodes: s.docDeps.get(p.id) ?? [], ids: s.ids });
    sugerencias.push(...r.suggestions);
    banderas.push(...r.flags);
  }
  const pasada2 = buildDetectionSet(doc, todos, { ...ctx, ids: replayIds(rec.log, s.ids), suggestions: sugerencias, flags: banderas });
  return pasada2;
}

const claveSug = (x: Suggestion, det: ReadonlyMap<string, Detection>): string =>
  x.target.kind === 'tramo' ? `${x.kind}|t:${x.target.span.partId}:${x.target.span.start}:${x.target.span.end}`
    : `${x.kind}|d:${(() => { const d = det.get(x.target.detectionId); return d === undefined ? x.target.detectionId : spanKey(d); })()}`;
const claveFlag = (f: Flag): string => `${f.type}|${f.reason}|${f.span.partId}:${f.span.start}:${f.span.end}`;

/**
 * Devuelve el conjunto con los ids ya emitidos (los que el hilo principal conoce) y, aparte, el delta: lo que no se había emitido.
 * Actualiza lo emitido por la sesión.
 */
function emitir(s: Session, full: FullSet): { todo: FullSet; delta: DetectionSet } {
  const mapa = new Map<string, string>();
  const detNuevo = new Map<string, Detection>(full.detections.map((d) => [d.id, d]));
  for (const d of full.detections) { const e = s.emitted.det.get(spanKey(d)); if (e !== undefined && e !== d.id) mapa.set(d.id, e); }
  for (const e of full.entities) { const x = s.emitted.ent.get(e.canonicalKey); if (x !== undefined && x !== e.id) mapa.set(e.id, x); }
  for (const x of full.suggestions) { const e = s.emitted.sug.get(claveSug(x, detNuevo)); if (e !== undefined && e !== x.id) mapa.set(x.id, e); }
  for (const f of full.flags) { const e = s.emitted.flg.get(claveFlag(f)); if (e !== undefined && e !== f.id) mapa.set(f.id, e); }
  const todo = remap(full, mapa);
  const nuevas = todo.detections.filter((d) => !s.emitted.det.has(spanKey(d)));
  const entIds = new Set<EntityId>(nuevas.map((d) => d.entityId));
  const detPorId = new Map<string, Detection>(todo.detections.map((d) => [d.id, d]));
  const sugNuevas = todo.suggestions.filter((x) => !s.emitted.sug.has(claveSug(x, detPorId)));
  const flgNuevas = todo.flags.filter((f) => !s.emitted.flg.has(claveFlag(f)));
  const delta: DetectionSet = {
    detections: nuevas, entities: todo.entities.filter((e) => entIds.has(e.id)),
    suggestions: sugNuevas, flags: flgNuevas,
  };
  for (const d of todo.detections) s.emitted.det.set(spanKey(d), d.id);
  for (const e of todo.entities) s.emitted.ent.set(e.canonicalKey, e.id);
  for (const x of todo.suggestions) s.emitted.sug.set(claveSug(x, detPorId), x.id);
  for (const f of todo.flags) s.emitted.flg.set(claveFlag(f), f.id);
  return { todo, delta };
}

// ---------------------------------------------------------------------------------------------
// Worker `detect`
// ---------------------------------------------------------------------------------------------

export interface DetectDeps {
  ids?: IdSource;
  now?: () => number;
  /** Cede el control al ciclo de eventos para atender `cancelar` entre bloques (6.11.6); por defecto, `setTimeout(0)`. */
  yieldFn?: () => Promise<void>;
  /** Tope de tiempo por regla (pruebas). */
  maxMsPerRule?: number;
}
export type DetectHandler = (data: unknown, post: Post) => Promise<void>;

let divipolaLista = false;
/** Nota de integración 1: la DIVIPOLA se configura una vez al arrancar; si no, todo radicado baja de confianza. */
function prepararDivipola(): void {
  if (divipolaLista) return;
  configurarDivipola(divipolaCodes(DIVIPOLA));
  divipolaLista = true;
}

const CEDE_CADA_MS = 40;

/**
 * Lógica del worker `detect` (6.11.2). Cada mensaje responde con progreso (≤ 10 por segundo), un `resultado`, un `error` (solo código)
 * o `cancelado`. Las sesiones viven en el cierre: `liberar` las borra y un `fusionar` posterior recibe `SESION_DESCONOCIDA` (INV-W05).
 */
export function createDetectHandler(deps: DetectDeps = {}): DetectHandler {
  prepararDivipola();
  const sesiones = new Map<string, Session>();
  const enVuelo = new Map<string, { cancelada: boolean }>();
  const now = deps.now ?? ((): number => Date.now());
  const ids = deps.ids ?? cryptoIds;
  const ceder = deps.yieldFn ?? ((): Promise<void> => new Promise<void>((r) => { setTimeout(r, 0); }));

  async function detectar(reqId: string, p: Record<string, unknown>, post: Post): Promise<void> {
    if (typeof p.sessionId !== 'string' || p.sessionId === '' || p.sessionId.length > 128 || !Array.isArray(p.caseList)) return entrada();
    const doc = validarDoc(p.doc);
    const options = validarOpciones(p.options);
    const table = validarTabla(p.table);
    const caseList = p.caseList as CaseEntity[];
    const flag = { cancelada: false };
    enVuelo.set(reqId, flag);
    const lim = new ProgressLimiter(now);
    const progreso = (stage: Stage, done: number, total: number, unit: ProgressUnit = 'partes'): void => {
      if (lim.take()) post({ v: 1, reqId, kind: 'progreso', stage, done, total, unit });
    };
    let ultimaCesion = now();
    // Devuelve true si se canceló: el llamador sale sin más mensajes.
    const cooperar = async (): Promise<boolean> => {
      if (now() - ultimaCesion >= CEDE_CADA_MS) { await ceder(); ultimaCesion = now(); }
      return flag.cancelada;
    };
    try {
      const parts = doc.parts.filter((x) => x.included).sort((a, b) => a.order - b.order);
      const refYear = Number(options.referenceDate.slice(0, 4));
      const registry = createRuleRegistry(refYear);
      const base = new Map<PartId, DetectionCandidate[]>();
      const docDeps = new Map<PartId, string[]>();
      const maxMs = deps.maxMsPerRule;

      // Catálogo A y lugares (notas 2 y 3)
      const reglas: DetectionCandidate[][] = [];
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i] as Part;
        const view: SearchView = buildSearchView(part.text, 'reglas', part.kind);
        reglas.push(runRules(view, part.id, ALL_RULES, refYear, maxMs === undefined ? {} : { maxMsPerRule: maxMs }));
        progreso('reglas', i + 1, parts.length);
        if (await cooperar()) { post({ v: 1, reqId, kind: 'cancelado' }); return; }
      }
      // PA-6: una fecha sin año toma la clave de la única fecha completa del mismo día y mes en todo el documento.
      const planas = consolidarFechasSinAnio(reglas.flat());
      let corte = 0;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i] as Part;
        const cands = planas.slice(corte, corte + (reglas[i] as DetectionCandidate[]).length);
        corte += cands.length;
        const view = buildSearchView(part.text, 'reglas', part.kind);
        const deps2 = departamentosDeRadicados(part.text, cands);
        const anchorEnds = cands.filter((c) => c.type === 'CC' || c.type === 'TI' || c.type === 'CE' || c.type === 'DIRECCION').map((c) => c.end);
        const lugares = detectPlaces(part.id, view, { docDepCodes: deps2, anchorEnds });
        docDeps.set(part.id, deps2);
        base.set(part.id, [...cands, ...lugares]);
      }
      // Lista del caso
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i] as Part;
        const lista = findCaseMentions(part, buildSearchView(part.text, 'lista', part.kind), caseList);
        base.set(part.id, [...(base.get(part.id) ?? []), ...lista]);
        progreso('lista', i + 1, parts.length);
        if (await cooperar()) { post({ v: 1, reqId, kind: 'cancelado' }); return; }
      }
      const s: Session = {
        doc, parts, caseList, table, options, registry, ids, base, docDeps, model: new Map(), modelFlags: [], merged: new Map(),
        emitted: { det: new Map(), ent: new Map(), sug: new Map(), flg: new Map() }, ventana: 0, cerrada: false,
      };
      progreso('fusion', 0, 1);
      const full = construir(s, new Set(parts.map((x) => x.id)));
      progreso('generalizacion', parts.length, parts.length);
      if (flag.cancelada) { post({ v: 1, reqId, kind: 'cancelado' }); return; }
      const { todo } = emitir(s, full);
      sesiones.set(p.sessionId, s);
      const counts = {
        reglas: todo.detections.filter((d) => d.source === 'regla').length,
        lista: todo.detections.filter((d) => d.source === 'lista').length,
        banderas: todo.flags.length, sugerencias: todo.suggestions.length,
      };
      const res: DetectResult = { kind: 'detectar', set: todo, counts };
      post({ v: 1, reqId, kind: 'resultado', payload: res });
    } finally {
      enVuelo.delete(reqId);
    }
  }

  function fusionar(reqId: string, p: Record<string, unknown>, post: Post): void {
    if (typeof p.sessionId !== 'string') return entrada();
    const s = sesiones.get(p.sessionId);
    if (s === undefined) throw new SiglowError('SESION_DESCONOCIDA');
    if (typeof p.nerEngineId !== 'string') return entrada();
    const ventana = p.ventana;
    if (ventana !== undefined && !esEntero(ventana, 1)) return entrada();
    if (p.ventanasTotales !== undefined && (!esEntero(p.ventanasTotales, 1) || (ventana !== undefined && (p.ventanasTotales as number) < (ventana as number)))) return entrada();
    const partes = new Map(s.parts.map((x) => [x.id as string, x]));

    if (p.ner === null) {
      // Plan B (y pasada 3 de residuos): sin más ventanas. Devuelve lo fusionado hasta ahora y cierra la sesión a nuevas ventanas.
      s.cerrada = true;
      const { todo } = emitir(s, construir(s, new Set()));
      post({ v: 1, reqId, kind: 'resultado', payload: { kind: 'fusionar', set: todo } satisfies DetectResult });
      return;
    }
    const ner = validarNer(p.ner, partes);
    if (ventana === undefined) {
      // Todo el resultado de una vez: sustituye lo acumulado del modelo.
      if (s.cerrada) return entrada();
      s.model.clear(); s.modelFlags = [];
      const cambiadas = new Set<PartId>(s.parts.map((x) => x.id));
      aplicarNer(s, ner);
      const { todo } = emitir(s, construir(s, cambiadas));
      post({ v: 1, reqId, kind: 'resultado', payload: { kind: 'fusionar', set: todo } satisfies DetectResult });
      return;
    }
    if (s.cerrada) return entrada();
    if (ventana <= s.ventana) {
      // Ventana repetida o anterior: no hay nada nuevo (el reductor también la ignora).
      post({ v: 1, reqId, kind: 'resultado', payload: { kind: 'fusionar', set: { detections: [], entities: [], flags: [], suggestions: [] }, ventana } satisfies DetectResult });
      return;
    }
    s.ventana = ventana;
    aplicarNer(s, ner);
    const { delta } = emitir(s, construir(s, new Set(ner.keys())));
    post({ v: 1, reqId, kind: 'resultado', payload: { kind: 'fusionar', set: delta, ventana } satisfies DetectResult });
  }

  function aplicarNer(s: Session, ner: ReadonlyMap<PartId, NerSpan[]>): void {
    for (const [pid, spans] of ner) {
      const part = s.parts.find((x) => x.id === pid);
      if (part === undefined) continue;   // parte excluida: el modelo no debería haberla procesado
      const r = candidatesFromNer(spans, { part, options: s.options, docDepCodes: s.docDeps.get(pid) ?? [], base: s.base.get(pid) ?? [], ids: s.ids });
      s.model.set(pid, [...(s.model.get(pid) ?? []), ...r.candidates]);
      s.modelFlags.push(...r.flags);
    }
  }

  return async function handle(data: unknown, post: Post): Promise<void> {
    let reqId = REQ_NULO;
    try {
      if (!esObjeto(data)) { post(mensajeError(reqId, 'ENTRADA_INVALIDA')); return; }
      if (typeof data.reqId === 'string' && REQ_ID.test(data.reqId)) reqId = data.reqId;
      if (data.v !== 1 || reqId === REQ_NULO) { post(mensajeError(reqId, 'ENTRADA_INVALIDA')); return; }
      const payload = data.payload;
      if (!esObjeto(payload)) { post(mensajeError(reqId, 'ENTRADA_INVALIDA')); return; }
      switch (data.kind) {
        case 'cancelar': {
          const objetivo = typeof payload.targetReqId === 'string' && REQ_ID.test(payload.targetReqId) ? payload.targetReqId : null;
          if (objetivo === null) { post(mensajeError(reqId, 'ENTRADA_INVALIDA')); return; }
          const vuelo = enVuelo.get(objetivo);
          if (vuelo !== undefined) vuelo.cancelada = true;   // el bloque en curso termina y responde `cancelado` (cooperativa)
          else post({ v: 1, reqId: objetivo, kind: 'cancelado' });
          return;
        }
        case 'detectar': await detectar(reqId, payload, post); return;
        case 'fusionar': fusionar(reqId, payload, post); return;
        case 'liberar': {
          if (typeof payload.sessionId !== 'string') { post(mensajeError(reqId, 'ENTRADA_INVALIDA')); return; }
          sesiones.delete(payload.sessionId);
          post({ v: 1, reqId, kind: 'resultado', payload: { kind: 'liberar' } satisfies DetectResult });
          return;
        }
        default: post(mensajeError(reqId, 'ENTRADA_INVALIDA'));
      }
    } catch (e) {
      post(mensajeError(reqId, codigoDe(e)));
    }
  };
}

