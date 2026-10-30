/** Punto de entrada del código GLiNER incorporado (PF-1a). Código propio de Sig-Low. */
export { GlinerError, NerAbortError } from './errors';
export { segmentWords, splitWords, stripInvisibles, type GlinerWord } from './splitter';
export {
  createGlinerTokenizer,
  readTokenizer,
  tokenizerAffixes,
  type GlinerTokenizer,
  type TokenizerAffixes,
} from './tokenizer';
export {
  GLINER_LABELS,
  buildSpans,
  countSubtokens,
  encodePrompt,
  encodeWindow,
  promptPieces,
  reservedTokens,
  type WindowEncoding,
} from './processor';
export { decodeSpans, spanCandidatesFromLogits } from './decoder';
export { inOwnZone, ownZones, planWindows } from './windows';
export { NER_LABEL_OF, toNerSpans } from './offsets';
export {
  detectByWindows,
  planText,
  type DetectByWindowsParams,
  type ScoreWindow,
  type WindowPlan,
  type WindowScoringInput,
} from './run';
export type {
  DecodedSpan,
  GlinerLabel,
  SpanCandidate,
  TokenizerLike,
  WordRange,
  WordSpan,
} from './types';
