/**
 * Recorrido por ventanas de un texto (7.10.1, pasos 2 a 6). Código propio de Sig-Low.
 *
 * Pura: la inferencia (ORT-web) se inyecta como `scoreWindow`, de modo que `GlinerEngine`
 * (PF-1b) solo aporta las entradas del grafo y los logits, y las pruebas usan un motor simulado.
 * Una ventana a la vez; se revisa `signal` entre ventanas.
 */

import type { NerOptions, NerSpan, NerWindowResult } from '../../types';
import { decodeSpans } from './decoder';
import { NerAbortError } from './errors';
import { toNerSpans } from './offsets';
import { splitWords, type GlinerWord } from './splitter';
import type { SpanCandidate, WordRange } from './types';
import { ownZones, planWindows } from './windows';

/** Lo que recibe el puntuador de cada ventana. */
export interface WindowScoringInput {
  windowIndex: number;
  windowTotal: number;
  /** `[inicio, fin)` de la ventana en palabras del documento. */
  range: WordRange;
  /** Textos de las palabras de la ventana (sin invisibles), para tokenizarlas. */
  wordTexts: string[];
  /** Presupuesto de subtokens para una sola palabra (trunca las más largas). */
  maxSubtokensPerWord: number;
}

/**
 * Devuelve los candidatos de la ventana con `s` relativo a ella (0-based), en la numeración de palabras
 * de la ventana. Si el puntuador usa `encodeWindow` y alguna palabra queda sin subtokens, debe traducir
 * con `modelWordToWindowWord` antes de devolver.
 */
export type ScoreWindow = (input: WindowScoringInput) => SpanCandidate[] | Promise<SpanCandidate[]>;

export interface WindowPlan {
  words: GlinerWord[];
  counts: number[];
  windows: WordRange[];
  zones: WordRange[];
  budget: number;
}

/** Palabras, ventanas y zonas propias del texto, sin ejecutar el modelo. */
export function planText(
  text: string,
  options: Pick<NerOptions, 'windowTokens' | 'overlapWords'>,
  countSubtokens: (wordTexts: readonly string[]) => number[],
  reserved: number,
): WindowPlan {
  const words = splitWords(text);
  const counts = countSubtokens(words.map((w) => w.text));
  const windows = planWindows(counts, options.windowTokens, options.overlapWords, reserved);
  return {
    words,
    counts,
    windows,
    zones: ownZones(windows, words.length),
    budget: Math.max(1, options.windowTokens - reserved),
  };
}

export interface DetectByWindowsParams {
  text: string;
  options: NerOptions;
  reserved: number;
  countSubtokens: (wordTexts: readonly string[]) => number[];
  scoreWindow: ScoreWindow;
  signal: AbortSignal;
  /** Se llama al terminar cada ventana. `windowIndex` es 0-based. */
  onWindow?: (w: Omit<NerWindowResult, 'partId'>) => void;
  /** Reloj en ms (por defecto `Date.now`); se inyecta en pruebas. */
  now?: () => number;
}

/** Procesa el texto por ventanas y devuelve todos los `NerSpan` (la unión de los `onWindow`). */
export async function detectByWindows(p: DetectByWindowsParams): Promise<NerSpan[]> {
  const now = p.now ?? Date.now;
  const plan = planText(p.text, p.options, p.countSubtokens, p.reserved);
  const all: NerSpan[] = [];
  for (let i = 0; i < plan.windows.length; i++) {
    if (p.signal.aborted) throw new NerAbortError();
    const range = plan.windows[i] as WordRange;
    const zone = plan.zones[i] as WordRange;
    const t0 = now();
    const candidates = await p.scoreWindow({
      windowIndex: i,
      windowTotal: plan.windows.length,
      range,
      wordTexts: plan.words.slice(range[0], range[1]).map((w) => w.text),
      maxSubtokensPerWord: plan.budget,
    });
    const decoded = decodeSpans(candidates, p.options.threshold, p.options.maxSpanWords);
    const spans = toNerSpans(decoded, plan.words, range, zone);
    all.push(...spans);
    p.onWindow?.({ windowIndex: i, windowTotal: plan.windows.length, spans, ms: now() - t0 });
  }
  return all;
}
