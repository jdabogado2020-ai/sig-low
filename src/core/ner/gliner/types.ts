/** Tipos del módulo `src/core/ner/gliner/` (firmas de 7.10.1). Código propio de Sig-Low. */

/** Posición canónica de una palabra, `[start, end)`. */
export interface WordSpan { start: number; end: number; }

/** Etiquetas que se piden al modelo, en este orden (6.11.3). */
export type GlinerLabel = 'person' | 'organization' | 'location';

/** Candidato del grafo: `s` = palabra de inicio, `w` = anchura en palabras (1 a 12), `p` = sigmoide del logit. */
export interface SpanCandidate { s: number; w: number; label: GlinerLabel; p: number; }

/** Tramo elegido: `s` y `e` son índices de palabra, ambos inclusivos. */
export interface DecodedSpan { label: SpanCandidate['label']; s: number; e: number; p: number; }

/** Lo mínimo que se usa del tokenizador (lo cumple `Tokenizer` de `@huggingface/tokenizers`). */
export interface TokenizerLike {
  encode(text: string): { ids: number[] };
}

/** Intervalo `[inicio, fin)` en índices de palabra. */
export type WordRange = [number, number];
