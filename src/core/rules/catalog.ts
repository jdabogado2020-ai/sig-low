// Ejecutor del catálogo de reglas (PA-1, desvío D-03; plan 6.4.2 y 7.2.0).
// TypeScript puro: sin DOM, sin red, sin registro. Los archivos de reglas (PA-2 a PA-7) exportan `rules: RuleSpec[]`
// y este módulo los ejecuta sobre una vista `reglas` (6.1.2).
import { toCanonicalSpan } from '../normalize';
import type {
  Confidence, DetectionCandidate, LabelHit, PartId, RuleContext, RuleSpec, RuleVerdict, SearchView,
} from '../types.local';

export type { RuleContext, RuleSpec, RuleVerdict } from '../types.local';

/**
 * Tope de tiempo por regla y por parte: 250 ms acumulados entre el primer `exec` y el último.
 * Un motor de expresiones regulares no se puede interrumpir a mitad de una búsqueda, así que el tope se comprueba
 * entre coincidencias: corta una regla que produce coincidencias sin fin o muy lentas, no una sola búsqueda con
 * retroceso catastrófico (eso se evita en el diseño de las expresiones, 7.2.0). Al cortarse, la regla conserva
 * lo hallado hasta ese punto y se avisa por `onTimeout` solo con el id de la regla.
 */
export const RULE_TIME_LIMIT_MS = 250;

/** Ventana, en caracteres previos de la misma línea, donde `needsCue` debe encontrar su pista (6.4.2). */
export const CUE_WINDOW = 60;

/** Puntaje nominal ordinal de las reglas (6.2.4). */
const NOMINAL_SCORE: Readonly<Record<Confidence, number>> = { alta: 0.9, media: 0.6, baja: 0.3 };

export interface RunRulesOptions {
  /** Tope por regla en milisegundos; por defecto `RULE_TIME_LIMIT_MS`. */
  maxMsPerRule?: number;
  /** Reloj en milisegundos (inyectable en pruebas); por defecto `Date.now`. */
  now?: () => number;
  /** Se llama con el id de la regla cuando se corta por tiempo. Nunca recibe texto del documento. */
  onTimeout?: (ruleId: string) => void;
}

// Se compila una vez por regla (7.2.0). Las coincidencias no se conservan fuera de la llamada.
const compiled = new WeakMap<RuleSpec, RegExp>();

function regexFor(rule: RuleSpec): RegExp {
  let re = compiled.get(rule);
  if (re === undefined) {
    re = new RegExp(rule.source, rule.flags);
    compiled.set(rule, re);
  }
  return re;
}

/** `needsCue` debe aparecer en los 60 caracteres que preceden a `index`, sin salir de su línea. */
function hasCue(text: string, index: number, cue: RegExp): boolean {
  if (index <= 0) return false;
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  const from = Math.max(lineStart, index - CUE_WINDOW);
  if (from >= index) return false;
  cue.lastIndex = 0;
  const found = cue.test(text.slice(from, index));
  cue.lastIndex = 0;
  return found;
}

function groupSpan(m: RegExpExecArray, name: string): [number, number] | undefined {
  return m.indices?.groups?.[name];
}

function advanceIndex(text: string, index: number): number {
  const cp = text.codePointAt(index);
  return index + (cp !== undefined && cp > 0xffff ? 2 : 1);
}

function toCandidate(
  rule: RuleSpec, verdict: RuleVerdict, m: RegExpExecArray, view: SearchView, partId: PartId,
): DetectionCandidate | null {
  const v = groupSpan(m, 'v') ?? [m.index, m.index + m[0].length];
  const nStart = verdict.nStart ?? v[0];
  const nEnd = verdict.nEnd ?? v[1];
  if (!(nStart >= 0 && nEnd > nStart && nEnd <= view.text.length)) return null;
  const { start, end } = toCanonicalSpan(view, nStart, nEnd);
  if (end <= start) return null;
  const candidate: DetectionCandidate = {
    partId,
    start,
    end,
    type: verdict.type ?? rule.type,
    source: 'regla',
    ruleId: rule.id,
    confidence: verdict.confidence,
    score: NOMINAL_SCORE[verdict.confidence],
    canonicalKey: verdict.canonicalKey,
  };
  const l = groupSpan(m, 'l');
  if (verdict.labelId !== undefined && l !== undefined && l[1] > l[0]) {
    const span = toCanonicalSpan(view, l[0], l[1]);
    const label: LabelHit = { labelId: verdict.labelId, start: span.start, end: span.end };
    candidate.label = label;
  }
  if (verdict.validator !== undefined) candidate.validator = verdict.validator;
  return candidate;
}

/**
 * Ejecuta cada regla sobre la vista `reglas` de una parte y devuelve candidatos en posiciones canónicas.
 *
 * Por regla: busca con `source` y `flags` (siempre `d` y `g`); si hay `needsCue`, descarta la coincidencia sin pista
 * en los 60 caracteres previos de su línea (se mide desde el inicio de la coincidencia); llama a `assess`, que puede
 * devolver `null` (descarta), un veredicto o varios. El tramo es el grupo con nombre `v` (la coincidencia entera si
 * no existe) o el subtramo `nStart`/`nEnd` del veredicto, y vuelve al texto canónico con `toCanonicalSpan`. El
 * rótulo es el grupo `l` y solo se emite si el veredicto trae `labelId`. Orden de salida: regla por regla, y dentro
 * de cada una por posición. Si `assess` lanza, la excepción sube sin tocarse: quien la capture debe convertirla en un
 * `ErrorCode` (F-07).
 */
export function runRules(
  view: SearchView,
  partId: PartId,
  rules: readonly RuleSpec[],
  refYear: number,
  options: RunRulesOptions = {},
): DetectionCandidate[] {
  const out: DetectionCandidate[] = [];
  const now = options.now ?? Date.now;
  const limit = options.maxMsPerRule ?? RULE_TIME_LIMIT_MS;
  const ctx: RuleContext = { view, partId, refYear };
  const text = view.text;
  for (const rule of rules) {
    const re = regexFor(rule);
    re.lastIndex = 0;
    const started = now();
    for (;;) {
      const m = re.exec(text);
      if (m === null) break;
      if (m[0].length === 0) re.lastIndex = advanceIndex(text, re.lastIndex);
      if (rule.needsCue === undefined || hasCue(text, m.index, rule.needsCue)) {
        const verdicts = rule.assess(m, ctx);
        if (verdicts !== null) {
          for (const verdict of Array.isArray(verdicts) ? verdicts : [verdicts]) {
            const candidate = toCandidate(rule, verdict, m, view, partId);
            if (candidate !== null) out.push(candidate);
          }
        }
      }
      if (now() - started > limit) {
        options.onTimeout?.(rule.id);
        break;
      }
    }
    re.lastIndex = 0;
  }
  return out;
}
