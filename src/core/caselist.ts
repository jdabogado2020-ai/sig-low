// Lista del caso y variantes (7.9, 6.5): generación de variantes, «pegar lista» y buscador.
// TypeScript puro: sin DOM ni red. Todas las búsquedas corren sobre la vista 'lista' (6.1.2).
// Hasta que PA-1 se fusione, la vista sale de normalize.local.ts; al rebasar se importa normalize.ts
// y types.ts (cambiar solo las dos líneas de importación).
import { buildSearchView, toCanonicalSpan } from './normalize';
import type {
  CaseEntity, CaseEntityId, CaseVariant, Confidence, DetectionCandidate, IdSource, OrgClass, Part,
  PersonRole, Role, SearchView, VariantClass,
} from './types';

// ---------------------------------------------------------------------------
// Patrones R-LST-01 a R-LST-07 (cadenas del plan, 7.9.7)
// ---------------------------------------------------------------------------

export const LST = {
  /** R-LST-01: frontera inicial / final Unicode y separador de palabras. */
  INICIO: String.raw`(?<![\p{L}\p{N}])`,
  FIN: String.raw`(?![\p{L}\p{N}])`,
  SEP: String.raw`(?: ?- ?| )`,
  /** R-LST-02 y R-LST-07: partes del constructor de iniciales. */
  INI_ANTES: String.raw`(?<![\p{L}\p{N}])(?<!(?<![\p{L}\p{N}])\p{L}\. ?)`,
  INI_ENTRE: String.raw`(?:\. ?| )?`,
  INI_FIN: String.raw`\.?(?![\p{L}\p{N}])(?!\.? ?\p{L}\.)`,
  /** R-LST-03: tratamiento de persona (sobre los 40 caracteres previos, vista lista). */
  TRATAMIENTO: String.raw`(?:^|[^\p{L}\p{N}])(?:(?:la|el|los|las|al|del|a la) )?(?:senorita|senora|senor|srta\.?|sra\.?|sr\.?|dona|don|doctora|doctor|dra\.?|dr\.?|ingeniera|ingeniero|ing\.|abogada|abogado|abg\.|licenciada|licenciado|lic\.|magistrada|magistrado|jueza|juez|profesora|profesor|prof\.|mrs\.?|mr\.?|ms\.?) ?$`,
  /** R-LST-04: posesivo (sobre los 3 caracteres siguientes, vista lista). */
  POSESIVO: String.raw`^'s?(?![\p{L}\p{N}])`,
  /** R-LST-05: sufijo societario. */
  SUFIJO: String.raw`(?:s\. ?a\. ?s\.?|s ?a ?s|s\. ?a\.?|s ?a|ltda\.?|limitada|e\. ?s\. ?p\.?|esp|e\. ?s\. ?e\.?|e\. ?u\.?|(?:&|y) ?cia\.?(?: ?s\. ?en ?c\.?)?|s\. ?en ?c\.?(?: ?s\.?)?|s\. ?c\. ?a\.?|sociedad por acciones simplificada|sociedad anonima|empresa unipersonal)`,
  /** R-LST-06: token de entidad de salud. */
  SALUD: String.raw`(?<![\p{L}\p{N}])(?:e\. ?p\. ?s\.?|eps|i\. ?p\. ?s\.?|ips)(?![\p{L}\p{N}])`,
  /** R-MOD-05 y R-MOD-06: léxico EPS e IPS (clase inferida en «pegar lista»). */
  LEX_EPS: String.raw`(?<![\p{L}\p{N}])(?:e\. ?p\. ?s\.?|eps|entidad promotora de salud)(?![\p{L}\p{N}])`,
  LEX_IPS: String.raw`(?<![\p{L}\p{N}])(?:i\. ?p\. ?s\.?|ips|e\. ?s\. ?e\.?|institucion prestadora de (?:servicios de )?salud|clinica|hospital|centro medico|centro de salud|laboratorio clinico)(?![\p{L}\p{N}])`,
} as const;

const SALUD_TOKEN = { eps: String.raw`(?:e\. ?p\. ?s\.?|eps)`, ips: String.raw`(?:i\. ?p\. ?s\.?|ips)` } as const;

const FUNCION_SET: ReadonlySet<string> = new Set(
  ('de|del|la|las|los|el|lo|y|e|o|u|a|al|en|por|para|con|sin|su|sus|que|se|un|una|unos|unas|senorita|senora|senor|' +
    'srta|sra|sr|dona|don|doctora|doctor|dra|dr|mrs|mr|ms').split('|'),
);
const STOP_SIGLA: ReadonlySet<string> = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'para', 'por', 'a', 'al', 'con']);
const PARTICULAS: ReadonlySet<string> = new Set(['de', 'del', 'la', 'las', 'los']);

const SCORE: Readonly<Record<Confidence, number>> = { alta: 0.9, media: 0.6, baja: 0.3 };
const RANGO: Readonly<Record<Confidence, number>> = { alta: 3, media: 2, baja: 1 };

// ---------------------------------------------------------------------------
// Utilidades de vista 'lista'
// ---------------------------------------------------------------------------

function fold(s: string): string {
  return buildSearchView(s, 'lista', 'cuerpo').text;
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
function lettersOf(s: string): string {
  return fold(s).replace(/[^\p{L}]/gu, '');
}
/**
 * AJ-2 (extensión de 7.9.3 pendiente de aprobación): iniciales de un nombre de la lista incompleto. Un nombre de dos unidades («Pedro
 * Ejemplo») no genera iniciales (7.9.3: «solo si suman 3 letras o más»), pero el escrito suele usar las de su nombre completo («P. E. R.»,
 * F44). La variante «P. E. _.» casa las dos iniciales de la lista más UNA inicial cualquiera, con separador obligatorio (nunca «PER»: sería
 * cualquier sigla de tres letras que empiece igual) y sin una cuarta inicial (R-LST-02). Confianza baja.
 */
const COMODIN_INICIAL = /_\.?$/u;
const esComodinIniciales = (texto: string): boolean => COMODIN_INICIAL.test(texto.trim());
function firstLetter(s: string): string | undefined {
  return fold(s).match(/\p{L}/u)?.[0];
}
function at<T>(a: readonly T[], i: number): T {
  return a[i] as T;
}

const reTratamiento = new RegExp(LST.TRATAMIENTO, 'u');
const rePosesivo = new RegExp(LST.POSESIVO, 'u');
const reSufijoFinal = new RegExp(String.raw`(?:,? )(` + LST.SUFIJO + String.raw`)$`, 'u');
const reSaludSuelto = new RegExp(LST.SALUD, 'u');
const reLexEps = new RegExp(LST.LEX_EPS, 'u');
const reLexIps = new RegExp(LST.LEX_IPS, 'u');

/** R-LST-03 sobre texto ya plegado (vista lista); mira los 40 últimos caracteres. */
export function hasTreatment(foldedPrefix: string): boolean {
  return reTratamiento.test(foldedPrefix.slice(-40));
}
/** R-LST-04 sobre los caracteres plegados que siguen al tramo. */
export function isPossessive(foldedSuffix: string): boolean {
  return rePosesivo.test(foldedSuffix);
}

// ---------------------------------------------------------------------------
// Unidades del nombre (7.9.2)
// ---------------------------------------------------------------------------

export function nameUnits(name: string): string[] {
  const toks = name.trim().split(/\s+/u).filter((t) => t.length > 0);
  const units: string[] = [];
  let pending: string[] = [];
  for (let k = 0; k < toks.length; k++) {
    const t = at(toks, k);
    const f = fold(t);
    const prev = pending.length > 0 ? fold(at(pending, pending.length - 1)) : null;
    if (f === 'de' || f === 'del' || (prev === 'de' && (f === 'la' || f === 'las' || f === 'los'))) {
      pending.push(t);
      continue;
    }
    if (f === 'y' && units.length > 0 && pending.length === 0 && k < toks.length - 1) {
      units[units.length - 1] = `${at(units, units.length - 1)} ${t} ${at(toks, k + 1)}`;
      k++;
      continue;
    }
    units.push([...pending, t].join(' '));
    pending = [];
  }
  if (pending.length > 0) units.push(pending.join(' '));
  return units;
}

/** Unidad sin partículas iniciales (paso 6). */
export function unitCore(u: string): string {
  const parts = u.split(' ');
  let i = 0;
  while (i < parts.length - 1 && PARTICULAS.has(fold(at(parts, i)))) i++;
  return parts.slice(i).join(' ');
}

function splitName(units: readonly string[]): { given: string[]; surnames: string[] } {
  const n = units.length;
  if (n <= 1) return { given: [...units], surnames: [] };
  if (n === 2) return { given: [at(units, 0)], surnames: [at(units, 1)] };
  if (n === 3) return { given: [at(units, 0)], surnames: [at(units, 1), at(units, 2)] };
  return { given: units.slice(0, n - 2), surnames: units.slice(n - 2) };
}

// ---------------------------------------------------------------------------
// Llaves de comparación (vista lista) y variantes crudas
// ---------------------------------------------------------------------------

function healthLetters(s: string): string {
  return s.replace(/[^a-z]/g, '');
}
/** Sustituye E.P.S. / I.P.S. por eps / ips en texto ya plegado. */
function normalizeHealth(folded: string): string {
  return folded.replace(new RegExp(LST.SALUD, 'gu'), (m) => healthLetters(m));
}
function tokensKey(text: string): string {
  return normalizeHealth(fold(text)).split(/[ -]+/u).filter((t) => t.length > 0).join(' ');
}

interface RawVariant {
  text: string;
  class: VariantClass;
  confidence: Confidence;
  /** Llave de comparación: 't:<palabras>' o 'i:<letras>'. */
  key: string;
}

function formatInitials(letters: readonly string[]): string {
  return letters.map((l) => `${l.toUpperCase()}.`).join(' ');
}

function personRaw(name: string): RawVariant[] {
  const units = nameUnits(name);
  const { given, surnames } = splitName(units);
  const V: RawVariant[] = [];
  const tok = (text: string, cls: VariantClass, confidence: Confidence): void => {
    V.push({ text, class: cls, confidence, key: 't:' + tokensKey(text) });
  };
  const ini = (letters: readonly string[]): void => {
    V.push({ text: formatInitials(letters), class: 'iniciales', confidence: 'baja', key: 'i:' + letters.join('') });
  };
  tok(name, 'exacta', 'alta');
  if (surnames.length > 0) {
    const g0 = at(given, 0);
    const s0 = at(surnames, 0);
    if (units.length > 2) tok(`${g0} ${s0}`, 'apellidos', 'media');
    if (given.length >= 2) {
      tok(`${given.join(' ')} ${s0}`, 'apellidos', 'media');
      tok(`${at(given, 1)} ${s0}`, 'apellidos', 'media');
    }
    if (surnames.length === 2) tok(surnames.join(' '), 'apellidos', 'media');
    if (units.length === 2 && s0.includes('-')) tok(`${g0} ${at(s0.split('-'), 0)}`, 'apellidos', 'media');
    for (const s of surnames) {
      tok(s, 'apellido_suelto', 'media');
      const core = unitCore(s);
      if (core !== s) tok(core, 'apellido_suelto', 'media');
      if (core.includes('-')) for (const part of core.split('-')) tok(part, 'apellido_suelto', 'media');
    }
    tok(g0, 'nombre_suelto', 'baja');
    if (given.length >= 2) {
      tok(at(given, 1), 'nombre_suelto', 'baja');
      tok(given.join(' '), 'nombre_suelto', 'baja');
    }
    const initial = (u: string): string | undefined => firstLetter(unitCore(u));
    const l1 = [...given, ...surnames].map(initial).filter((l): l is string => l !== undefined);
    if (l1.length >= 3) ini(l1);
    if (given.length >= 2) {
      const l2 = [g0, ...surnames].map(initial).filter((l): l is string => l !== undefined);
      if (l2.length >= 3) ini(l2);
    }
    if (l1.length === 2) V.push({ text: formatInitials(l1) + ' _.', class: 'iniciales', confidence: 'baja', key: 'i:' + l1.join('') + '_' });
  }
  return dedupe(V);
}

export interface OrgParts {
  /** Nombre sin el sufijo societario final, con el token de salud en su sitio. */
  baseText: string;
  /** Núcleo: sin sufijo y sin token de salud. */
  core: string;
  /** Sufijo final, plegado (p. ej. 's.a.s.'), o null. */
  suffix: string | null;
  /** 'eps' | 'ips' | null. */
  health: 'eps' | 'ips' | null;
  healthPos: 'inicio' | 'fin' | null;
}

/** Paso 1 a 3 de 7.9.4. */
export function parseOrg(name: string): OrgParts {
  const full = name.trim();
  const v = buildSearchView(full, 'lista', 'cuerpo');
  let baseText = full;
  let suffix: string | null = null;
  const m = reSufijoFinal.exec(v.text);
  if (m !== null && m.index > 0) {
    const cut = full.slice(0, v.startMap[m.index]).replace(/[\s,]+$/u, '');
    if (cut.length > 0) {
      suffix = m[1] as string;
      baseText = cut;
    }
  }
  const bv = buildSearchView(baseText, 'lista', 'cuerpo');
  const hm = [...bv.text.matchAll(new RegExp(LST.SALUD, 'gu'))][0];
  let core = baseText;
  let health: 'eps' | 'ips' | null = null;
  let healthPos: 'inicio' | 'fin' | null = null;
  if (hm !== undefined) {
    const c = toCanonicalSpan(bv, hm.index, hm.index + hm[0].length);
    core = (baseText.slice(0, c.start) + ' ' + baseText.slice(c.end)).replace(/\s+/gu, ' ').trim();
    health = healthLetters(hm[0]) === 'eps' ? 'eps' : 'ips';
    healthPos = hm.index === 0 ? 'inicio' : 'fin';
  }
  return { baseText, core, suffix, health, healthPos };
}

type SuffixFamily = 'SAS' | 'SA' | 'LTDA' | 'ESP' | 'ESE' | 'EU' | 'CIA' | 'SENC' | 'SCA' | 'OTRO';
function suffixFamily(s: string | null | undefined): SuffixFamily | null {
  if (s === null || s === undefined || s === '') return null;
  const t = fold(s).replace(/[^a-z&]/g, '');
  if (t === 'sas' || t === 'sociedadporaccionessimplificada') return 'SAS';
  if (t === 'sa' || t === 'sociedadanonima') return 'SA';
  if (t === 'ltda' || t === 'limitada') return 'LTDA';
  if (t === 'esp') return 'ESP';
  if (t === 'ese') return 'ESE';
  if (t === 'eu' || t === 'empresaunipersonal') return 'EU';
  if (t.startsWith('&cia') || t.startsWith('ycia')) return 'CIA';
  if (t.startsWith('senc')) return 'SENC';
  if (t === 'sca') return 'SCA';
  return 'OTRO';
}

function orgRaw(name: string): RawVariant[] {
  const p = parseOrg(name);
  const V: RawVariant[] = [];
  V.push({ text: name, class: 'exacta', confidence: 'alta', key: 't:' + tokensKey(p.baseText) });
  if (p.health !== null && p.core.length > 0) {
    const H = p.health.toUpperCase();
    for (const text of [`${p.core} ${H}`, `${H} ${p.core}`, p.core]) {
      V.push({ text, class: 'razon_social_sin_sufijo', confidence: 'media', key: 't:' + tokensKey(text) });
    }
  }
  const sig = fold(p.core)
    .split(' ')
    .filter((w) => w.length > 0 && !STOP_SIGLA.has(w))
    .map((w) => firstLetter(w))
    .filter((l): l is string => l !== undefined)
    .join('');
  if (sig.length >= 3) V.push({ text: sig.toUpperCase(), class: 'sigla', confidence: 'baja', key: 'i:' + sig });
  // AJ-2 (extensión de 7.9.4 pendiente de aprobación): la sigla del nombre de una entidad de salud incluye el token («EPS Salud Ficticia» →
  // «ESF»), porque así se escribe. Solo si suma 3 letras o más y no repite la del núcleo.
  if (p.health !== null && sig.length > 0) {
    const t = p.health === 'eps' ? 'e' : 'i';
    const conToken = p.healthPos === 'inicio' ? t + sig : sig + t;
    if (conToken.length >= 3 && conToken !== sig) V.push({ text: conToken.toUpperCase(), class: 'sigla', confidence: 'baja', key: 'i:' + conToken });
  }
  return dedupe(V);
}

/** Descarta formas inútiles y duplicados en vista lista; conserva la de mayor confianza (INV-L03). La exacta nunca se descarta. */
function dedupe(V: readonly RawVariant[]): RawVariant[] {
  const seen = new Map<string, RawVariant>();
  for (const v of V) {
    if (v.class !== 'exacta') {
      const body = v.key.slice(2);
      const letters = body.replace(/[^\p{L}]/gu, '').length;
      if (v.key.startsWith('i:')) {
        if (letters + (body.endsWith('_') ? 1 : 0) < 3) continue;
      } else {
        if (letters < 2) continue;
        if (!/[ -]/u.test(body) && (FUNCION_SET.has(body) || body.length < 3)) continue;
      }
    }
    const prev = seen.get(v.key);
    if (prev === undefined || (prev.class !== 'exacta' && RANGO[v.confidence] > RANGO[prev.confidence])) seen.set(v.key, v);
  }
  return [...seen.values()];
}

function rawFor(e: Pick<CaseEntity, 'kind' | 'name'>): RawVariant[] {
  return e.kind === 'persona' ? personRaw(e.name) : orgRaw(e.name);
}

function variantKey(e: Pick<CaseEntity, 'kind'>, v: CaseVariant): string {
  if (v.class === 'iniciales' || v.class === 'sigla') return 'i:' + lettersOf(v.text) + (esComodinIniciales(v.text) ? '_' : '');
  if (e.kind === 'organizacion' && v.origin === 'generada' && v.class === 'exacta') return 't:' + tokensKey(parseOrg(v.text).baseText);
  return 't:' + tokensKey(v.text);
}

/** Llaves de las variantes activas de `o` que cuentan para decidir si una variante es compartida. */
function sharingKeys(o: CaseEntity): Set<string> {
  const keys = new Set<string>();
  if (o.variants.length > 0) {
    for (const v of o.variants) {
      if (!v.enabled || (v.origin === 'generada' && v.class === 'exacta')) continue;
      keys.add(variantKey(o, v));
    }
  } else {
    for (const r of rawFor(o)) if (r.class !== 'exacta') keys.add(r.key);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// API pública: generación (7.9.1)
// ---------------------------------------------------------------------------

/**
 * Variantes automáticas de una entidad (origin 'generada'). Cumple INV-L02 e INV-L03.
 * `all` sirve para marcar con confianza `baja` las variantes compartidas con otras entidades.
 */
export function generateVariants(entity: CaseEntity, all: readonly CaseEntity[]): CaseVariant[] {
  const others = new Set<string>();
  for (const o of all) {
    if (o.id === entity.id) continue;
    for (const k of sharingKeys(o)) others.add(k);
  }
  return rawFor(entity).map((r) => ({
    text: r.text,
    class: r.class,
    confidence: r.class !== 'exacta' && others.has(r.key) ? 'baja' : r.confidence,
    enabled: true,
    origin: 'generada',
  }));
}

/**
 * Regenera las variantes generadas de cada entidad conservando las manuales y el interruptor
 * `enabled` de las generadas que siguen existiendo. No modifica la lista recibida.
 */
export function refreshVariants(caseList: readonly CaseEntity[]): CaseEntity[] {
  return caseList.map((e) => {
    const off = new Set(
      e.variants.filter((v) => v.origin === 'generada' && !v.enabled).map((v) => `${v.class}|${variantKey(e, v)}`),
    );
    const generated = generateVariants(e, caseList).map((v) => (off.has(`${v.class}|${variantKey(e, v)}`) ? { ...v, enabled: false } : v));
    const manual = e.variants.filter((v) => v.origin === 'manual');
    return { ...e, variants: [...generated, ...manual] } as CaseEntity;
  });
}

/** Avisos M-44: variantes activas de una entidad que coinciden con otra entidad de la lista. */
export function sharedVariantWarnings(caseList: readonly CaseEntity[]): Array<{ code: 'M-44'; entityId: CaseEntityId; text: string; owners: CaseEntityId[] }> {
  const out: Array<{ code: 'M-44'; entityId: CaseEntityId; text: string; owners: CaseEntityId[] }> = [];
  for (const e of caseList) {
    for (const v of e.variants) {
      if (!v.enabled || (v.origin === 'generada' && v.class === 'exacta')) continue;
      const owners = variantOwners(v.text, caseList).filter((id) => id !== e.id);
      if (owners.length > 0) out.push({ code: 'M-44', entityId: e.id, text: v.text, owners });
    }
  }
  return out;
}

/** Entidades con una variante activa igual (en vista 'lista') a `text`. Lo usa el panel de ambigüedad (PC-3). */
export function variantOwners(text: string, caseList: readonly CaseEntity[]): CaseEntityId[] {
  const lv = fold(text).trim();
  const keys = new Set<string>();
  const addTokens = (s: string): void => { keys.add('t:' + tokensKey(s)); };
  addTokens(lv);
  const sinPosesivo = lv.replace(/'s?$/u, '');
  if (sinPosesivo !== lv) addTokens(sinPosesivo);
  const sinSufijo = reSufijoFinal.exec(lv);
  if (sinSufijo !== null && sinSufijo.index > 0) addTokens(lv.slice(0, sinSufijo.index));
  const letters = lv.replace(/[^\p{L}]/gu, '');
  const letterOnlyGroups = /^(?:\p{L}\.? ?)+$/u.test(lv);
  const allUpper = text.replace(/[^\p{L}]/gu, '') === text.replace(/[^\p{L}]/gu, '').toUpperCase();
  if (letters.length > 0 && (letterOnlyGroups || (allUpper && !lv.includes(' ')))) keys.add('i:' + letters);
  const out: CaseEntityId[] = [];
  for (const e of caseList) {
    if (e.variants.some((v) => v.enabled && keys.has(variantKey(e, v)))) out.push(e.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// «Pegar lista» (6.5.2) y alta de entidades
// ---------------------------------------------------------------------------

const PERSON_ROLE_WORDS: ReadonlyMap<string, PersonRole> = new Map<string, PersonRole>([
  ['demandante', 'DEMANDANTE'], ['accionante', 'DEMANDANTE'], ['tutelante', 'DEMANDANTE'], ['convocante', 'DEMANDANTE'],
  ['demandado', 'DEMANDADO'], ['demandada', 'DEMANDADO'], ['accionado', 'DEMANDADO'], ['accionada', 'DEMANDADO'],
  ['convocado', 'DEMANDADO'], ['convocada', 'DEMANDADO'],
  ['testigo', 'TESTIGO'], ['paciente', 'PACIENTE'], ['cliente', 'CLIENTE'], ['contacto', 'CONTACTO'],
  ['otra persona', 'OTRA_PERSONA'], ['familiar', 'OTRA_PERSONA'], ['funcionario', 'OTRA_PERSONA'], ['funcionaria', 'OTRA_PERSONA'],
]);
const ORG_CLASS_WORDS: ReadonlyMap<string, OrgClass> = new Map<string, OrgClass>([
  ['empresa', 'EMPRESA'], ['eps', 'EPS'], ['ips', 'IPS'], ['entidad', 'ENTIDAD'], ['proveedor', 'PROVEEDOR'],
]);

export interface PasteLineError {
  /** Número de línea (desde 1) en el texto pegado. */
  line: number;
  /** M-42 rol o clase no reconocidos; M-43 línea sin nombre. */
  code: 'M-42' | 'M-43';
}
export interface PasteInferred {
  line: number;
  entityId: CaseEntityId;
  /** Clase inferida (M-45): la vista previa pide confirmación. */
  class: OrgClass;
}
export interface PasteResult {
  /** Entidades nuevas, con sus variantes generadas frente a `existing` y entre sí. */
  entities: CaseEntity[];
  errors: PasteLineError[];
  inferred: PasteInferred[];
}

function cleanName(s: string): string {
  return s.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/** Clase de organización inferida de un nombre de persona con sufijo societario o token EPS/IPS; null si no hay señal. */
export function inferOrgClass(name: string): OrgClass | null {
  const f = fold(name).trim();
  const sufijo = reSufijoFinal.test(f);
  const token = reSaludSuelto.test(f);
  if (!sufijo && !token) return null;
  if (reLexEps.test(f)) return 'EPS';
  if (reLexIps.test(f)) return 'IPS';
  return 'EMPRESA';
}

/** Crea una entidad sin variantes (llamar luego a refreshVariants). Devuelve null si el rol no corresponde al tipo (INV-L01). */
export function newCaseEntity(name: string, kind: 'persona' | 'organizacion', role: Role, ids: IdSource): CaseEntity | null {
  const id = ids.next('cas') as CaseEntityId;
  const n = cleanName(name);
  if (kind === 'persona') {
    if (!isPersonRole(role)) return null;
    return { id, name: n, variants: [], kind: 'persona', role };
  }
  if (!isOrgClass(role)) return null;
  return { id, name: n, variants: [], kind: 'organizacion', role };
}
function isOrgClass(r: string): r is OrgClass {
  return r === 'EMPRESA' || r === 'EPS' || r === 'IPS' || r === 'ENTIDAD' || r === 'PROVEEDOR';
}
function isPersonRole(r: string): r is PersonRole {
  return !isOrgClass(r);
}

/**
 * Una entidad por línea: `Nombre; rol` (6.5.2). El rol no distingue mayúsculas ni tildes.
 * Línea sin rol o con rol no reconocido: error M-42 y no se agrega. Sin nombre: M-43.
 * Rol de persona con sufijo societario o token EPS/IPS en el nombre: organización inferida (M-45).
 */
export function parsePastedList(text: string, ids: IdSource, existing: readonly CaseEntity[] = []): PasteResult {
  const errors: PasteLineError[] = [];
  const inferred: PasteInferred[] = [];
  const created: Array<{ line: number; entity: CaseEntity }> = [];
  const lines = text.split(/\r\n|\r|\n/u);
  for (let i = 0; i < lines.length; i++) {
    const raw = at(lines, i);
    if (raw.trim() === '') continue;
    const line = i + 1;
    const cut = raw.lastIndexOf(';');
    const name = cleanName(cut >= 0 ? raw.slice(0, cut) : raw);
    const roleWord = cut >= 0 ? fold(raw.slice(cut + 1)).trim().replace(/\.$/u, '').trim() : '';
    if (cut >= 0 && name === '') { errors.push({ line, code: 'M-43' }); continue; }
    const personRole = PERSON_ROLE_WORDS.get(roleWord);
    const orgClass = ORG_CLASS_WORDS.get(roleWord);
    let entity: CaseEntity | null = null;
    if (orgClass !== undefined) {
      entity = newCaseEntity(name, 'organizacion', orgClass, ids);
    } else if (personRole !== undefined) {
      const inf = inferOrgClass(name);
      if (inf !== null) {
        entity = newCaseEntity(name, 'organizacion', inf, ids);
        if (entity !== null) inferred.push({ line, entityId: entity.id, class: inf });
      } else {
        entity = newCaseEntity(name, 'persona', personRole, ids);
      }
    }
    if (entity === null) { errors.push({ line, code: 'M-42' }); continue; }
    created.push({ line, entity });
  }
  const all: CaseEntity[] = [...existing, ...created.map((c) => c.entity)];
  const withVariants = refreshVariants(all).slice(existing.length);
  return { entities: withVariants, errors, inferred };
}

// ---------------------------------------------------------------------------
// Buscador (7.9.6)
// ---------------------------------------------------------------------------

interface Matcher {
  re: RegExp;
  initials: boolean;
  needsCase: boolean;
  /** Variante exacta de organización: la clase depende del sufijo que casa. */
  fullOrg: boolean;
  family: SuffixFamily | null;
  /** Texto contra el que se refina exacta / sin_tildes / mayusculas. */
  refText: string;
  org: boolean;
}

function makeMatcher(e: CaseEntity, v: CaseVariant): Matcher | null {
  const org = e.kind === 'organizacion';
  if (v.class === 'iniciales' || v.class === 'sigla') {
    const letters = [...lettersOf(v.text)];
    if (letters.length < 2) return null;
    const comodin = v.class === 'iniciales' && esComodinIniciales(v.text);
    // Con comodín: separador obligatorio entre las letras («A. E. O.», «A E O»), nunca «AEO».
    const re = comodin
      ? new RegExp(LST.INI_ANTES + letters.map(escapeRe).join(String.raw`(?:\. ?| )`) + String.raw`(?:\. ?| )\p{L}` + LST.INI_FIN, 'gu')
      : new RegExp(LST.INI_ANTES + letters.map(escapeRe).join(LST.INI_ENTRE) + LST.INI_FIN, 'gu');
    return { re, initials: true, needsCase: true, fullOrg: false, family: null, refText: v.text, org };
  }
  const generatedOrg = org && v.origin === 'generada';
  let baseText = v.text;
  let family: SuffixFamily | null = null;
  const fullOrg = generatedOrg && v.class === 'exacta';
  if (fullOrg) {
    const p = parseOrg(v.text);
    baseText = p.baseText;
    family = suffixFamily(p.suffix);
  }
  const toks = normalizeHealth(fold(baseText)).split(/[ -]+/u).filter((t) => t.length > 0);
  if (toks.length === 0) return null;
  const parts = toks.map((t) => (generatedOrg && (t === 'eps' || t === 'ips') ? SALUD_TOKEN[t] : escapeRe(t)));
  const tail = generatedOrg ? String.raw`(?:,? ?(` + LST.SUFIJO + `))?` : '';
  const re = new RegExp(LST.INICIO + parts.join(LST.SEP) + tail + LST.FIN, 'gu');
  const needsCase = v.origin === 'generada' && (v.class === 'apellido_suelto' || v.class === 'nombre_suelto' ||
    (v.class === 'razon_social_sin_sufijo' && toks.length === 1));
  const refText = fullOrg ? e.name : v.text;
  return { re, initials: false, needsCase, fullOrg, family, refText, org };
}

function caseOk(initials: boolean, slice: string): boolean {
  const letters = slice.replace(/[^\p{L}]/gu, '');
  if (initials) return letters.length > 0 && letters === letters.toUpperCase();
  const words = slice
    .split(/[\s-]+/u)
    .filter((w) => /\p{L}/u.test(w))
    .filter((w) => !['de', 'del', 'la', 'las', 'los', 'y'].includes(fold(w)));
  return words.length > 0 && words.every((w) => /^\p{Lu}/u.test(w.replace(/^[^\p{L}]+/u, '')));
}

function refineFullClass(slice: string, reference: string): 'exacta' | 'sin_tildes' | 'mayusculas' {
  const a = slice.replace(/\s+/gu, ' ');
  const b = reference.replace(/\s+/gu, ' ');
  if (a === b) return 'exacta';
  const alnum = (s: string): string => s.replace(/[^\p{L}\p{N}]/gu, '');
  const sa = alnum(a);
  const sb = alnum(b);
  if (sa === sb) return 'exacta';
  if (sa.toLowerCase() === sb.toLowerCase()) return 'mayusculas';
  const strip = (s: string): string => alnum(s.normalize('NFD').replace(/[̀-ͯ]/gu, ''));
  if (strip(a) === strip(b)) return 'sin_tildes';
  return 'mayusculas';
}

interface Hit {
  start: number;
  end: number;
  ns: number;
  ne: number;
  entity: CaseEntityId;
  cls: VariantClass;
  conf: Confidence;
  key: string;
  alternatives: CaseEntityId[];
  classBy: Map<CaseEntityId, VariantClass>;
}

/** Menciones de la lista en una parte. `view` es la vista 'lista' de part.text. */
export function findCaseMentions(part: Part, view: SearchView, caseList: readonly CaseEntity[]): DetectionCandidate[] {
  const text = part.text;
  const byId = new Map<CaseEntityId, CaseEntity>(caseList.map((e) => [e.id, e]));

  // Índices de ambigüedad: dueños por llave y palabras del nombre de cada entidad.
  const owners = new Map<string, Set<CaseEntityId>>();
  const nameTokens = new Map<CaseEntityId, Set<string>>();
  for (const e of caseList) {
    for (const v of e.variants) {
      if (!v.enabled || (v.origin === 'generada' && v.class === 'exacta')) continue;
      const k = variantKey(e, v);
      let s = owners.get(k);
      if (s === undefined) { s = new Set(); owners.set(k, s); }
      s.add(e.id);
    }
    const nucleo = e.kind === 'organizacion' ? parseOrg(e.name).core : e.name;
    nameTokens.set(e.id, new Set(fold(nucleo).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3 && !FUNCION_SET.has(t))));
  }

  // 1-3. Un patrón por variante activa; posiciones canónicas; filtro de forma.
  const raw: Hit[] = [];
  for (const e of caseList) {
    for (const vr of e.variants) {
      if (!vr.enabled) continue;
      const mt = makeMatcher(e, vr);
      if (mt === null) continue;
      const key = variantKey(e, vr);
      for (const m of view.text.matchAll(mt.re)) {
        const ns = m.index;
        const ne = ns + m[0].length;
        if (ne <= ns) continue;
        const c = toCanonicalSpan(view, ns, ne);
        const slice = text.slice(c.start, c.end);
        const suf = mt.org ? m[1] : undefined;
        // Tramo sin la cola de sufijo (para el filtro de forma y para refinar la clase).
        let coreSlice = slice;
        if (suf !== undefined && suf !== '') {
          let ce = ne - suf.length;
          while (ce > ns && /[ ,]/u.test(view.text.charAt(ce - 1))) ce--;
          if (ce > ns) { const cc = toCanonicalSpan(view, ns, ce); coreSlice = text.slice(cc.start, cc.end); }
        }
        let cls: VariantClass = vr.class;
        let conf: Confidence = vr.confidence;
        if (mt.fullOrg) {
          if (suf !== undefined && suf !== '' && mt.family !== null && suffixFamily(suf) !== mt.family) { cls = 'razon_social_sin_sufijo'; conf = 'media'; }
          else if ((suf === undefined || suf === '') && mt.family !== null) { cls = 'razon_social_sin_sufijo'; conf = 'media'; }
          else cls = refineFullClass(mt.family === null ? coreSlice : slice, mt.refText);
        } else if (cls === 'exacta' || cls === 'sin_tildes' || cls === 'mayusculas') {
          cls = refineFullClass(slice, mt.refText);
        }
        if (mt.needsCase && !caseOk(mt.initials, mt.initials ? slice : coreSlice)) continue;
        raw.push({ start: c.start, end: c.end, ns, ne, entity: e.id, cls, conf, key, alternatives: [], classBy: new Map() });
      }
    }
  }

  // 4. Resolución interna: longitud descendente, confianza, posición; idéntico de otra entidad = alternativa.
  raw.sort((a, b) => (b.end - b.start) - (a.end - a.start) || RANGO[b.conf] - RANGO[a.conf] || a.start - b.start);
  const acc: Hit[] = [];
  for (const r of raw) {
    const same = acc.find((a) => a.start === r.start && a.end === r.end);
    if (same !== undefined) {
      if (same.entity !== r.entity && !same.alternatives.includes(r.entity)) {
        same.alternatives.push(r.entity);
        if (!same.classBy.has(r.entity)) same.classBy.set(r.entity, r.cls);
      }
      continue;
    }
    if (acc.some((a) => r.start < a.end && a.start < r.end)) continue;
    r.classBy.set(r.entity, r.cls);
    acc.push(r);
  }
  acc.sort((a, b) => a.start - b.start);

  // 5-6. Ambigüedad y ajustes de confianza (7.9.5).
  for (const a of acc) {
    const prefix = view.text.slice(Math.max(0, a.ns - 40), a.ns);
    const trat = hasTreatment(prefix);
    const sharers = owners.get(a.key);
    if (a.alternatives.length > 0 || (sharers !== undefined && sharers.size > 1)) {
      const all = [a.entity, ...a.alternatives];
      let owner: CaseEntityId | null = null;
      const persons = all.filter((id) => byId.get(id)?.kind === 'persona');
      if (trat && persons.length === 1) owner = at(persons, 0);
      if (owner === null) {
        let best = -1;
        for (const id of all) {
          const prev = acc.filter((x) => x.entity === id && x.alternatives.length === 0 && x.end <= a.start &&
            (x.cls === 'exacta' || x.cls === 'mayusculas' || x.cls === 'sin_tildes' || x.cls === 'apellidos'));
          const pos = prev.length > 0 ? at(prev, prev.length - 1).end : -1;
          if (pos > best) { best = pos; owner = id; }
        }
        if (best === -1) owner = caseList.find((e) => all.includes(e.id))?.id ?? a.entity;
      }
      const chosen: CaseEntityId = owner ?? a.entity;
      a.alternatives = all.filter((id) => id !== chosen);
      a.cls = a.classBy.get(chosen) ?? a.cls;
      a.entity = chosen;
      a.conf = 'baja';
    } else if (a.cls === 'apellido_suelto' || a.cls === 'nombre_suelto') {
      const tok = fold(text.slice(a.start, a.end)).split(/[ -]+/u);
      const coinc = caseList.filter((e) => e.id !== a.entity && tok.some((t) => nameTokens.get(e.id)?.has(t) === true));
      if (coinc.length > 0) {
        if (trat && coinc.every((e) => e.kind === 'organizacion') && a.cls === 'apellido_suelto') a.conf = 'media';
        else a.conf = 'baja';
      } else if (trat && a.cls === 'nombre_suelto') {
        a.conf = 'media';
      }
    }
    if (isPossessive(view.text.slice(a.ne, a.ne + 3))) a.cls = 'posesivo';
  }

  const out: DetectionCandidate[] = [];
  for (const a of acc) {
    const e = byId.get(a.entity);
    if (e === undefined) continue;
    out.push({
      partId: part.id,
      start: a.start,
      end: a.end,
      type: e.kind === 'persona' ? 'PERSONA' : e.role,
      role: e.role,
      source: 'lista',
      caseEntityId: e.id,
      variantClass: a.cls,
      confidence: a.conf,
      score: SCORE[a.conf],
      canonicalKey: 'LISTA:' + e.id,
    });
  }
  return out;
}

/** Comodidad: construye la vista 'lista' de la parte y busca. */
export function searchCaseList(part: Part, caseList: readonly CaseEntity[]): DetectionCandidate[] {
  return findCaseMentions(part, buildSearchView(part.text, 'lista', part.kind), caseList);
}
