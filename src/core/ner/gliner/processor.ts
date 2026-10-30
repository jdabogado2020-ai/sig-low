/*
 * Derivado de @piighost/ner-web 0.3.0, archivo `src/gliner/processor.js (funciones encode y buildSpans)`
 * (paquete npm @piighost/ner-web; repositorio https://github.com/Athroniaeth/piighost-browser).
 *
 * MIT License
 *
 * Copyright (c) 2025 Athroniaeth
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Modificado para Sig-Low: convertido a TypeScript con comentarios en español; el tokenizador se recibe ya medido (GlinerTokenizer, con el parche de mT5 en tokenizer.ts); se codifica por ventana de palabras y no por documento, con truncamiento de las palabras más largas que el presupuesto; una palabra sin subtokens no recibe índice y se conserva la correspondencia modelo-palabra; se añaden el prompt de las tres etiquetas, reservedTokens y countSubtokens para planWindows; sin token inicial en mT5.
 */

/**
 * Construcción de las entradas del grafo ONNX (7.10.1, pasos 3 y 4).
 *
 * GLiNER ve una sola secuencia por ventana: un prompt que enumera las etiquetas
 * pedidas y luego las palabras. Cada palabra se codifica por separado para que
 * `words_mask` apunte al primer subtoken de cada palabra, que es lo que el modelo
 * usa para volver de subtokens a palabras.
 */

import type { GlinerTokenizer } from './tokenizer';
import type { GlinerLabel } from './types';

const ENT_TOKEN = '<<ENT>>';
const SEP_TOKEN = '<<SEP>>';

/** Las tres etiquetas de v1.0, siempre en este orden (6.11.3). */
export const GLINER_LABELS: readonly ['person', 'organization', 'location'] = [
  'person',
  'organization',
  'location',
];

/** Piezas del prompt: `<<ENT>> person <<ENT>> organization <<ENT>> location <<SEP>>`. */
export function promptPieces(labels: readonly GlinerLabel[] = GLINER_LABELS): string[] {
  const pieces: string[] = [];
  for (const label of labels) pieces.push(ENT_TOKEN, label);
  pieces.push(SEP_TOKEN);
  return pieces;
}

/** Subtokens del prompt (cada pieza por separado, sin especiales ni cierre de secuencia). */
export function encodePrompt(
  tokenizer: GlinerTokenizer,
  labels: readonly GlinerLabel[] = GLINER_LABELS,
): number[] {
  const ids: number[] = [];
  for (const piece of promptPieces(labels)) ids.push(...tokenizer.encodeWord(piece));
  return ids;
}

/** Tokens reservados de cada ventana: token inicial (si hay), prompt y token final (`reserved` de 7.10.3). */
export function reservedTokens(
  tokenizer: GlinerTokenizer,
  labels: readonly GlinerLabel[] = GLINER_LABELS,
): number {
  return (tokenizer.clsId === null ? 0 : 1) + encodePrompt(tokenizer, labels).length + 1;
}

/** Subtokens de cada palabra (`counts[i]` de `planWindows`). */
export function countSubtokens(
  tokenizer: GlinerTokenizer,
  wordTexts: readonly string[],
): number[] {
  return wordTexts.map((w) => tokenizer.encodeWord(w).length);
}

/** Secuencia de una ventana, lista para convertir a tensores `int64` de forma `[1, L]`. */
export interface WindowEncoding {
  inputIds: number[];
  attentionMask: number[];
  /** 0 en el prompt y en subtokens de continuación; en el primer subtoken de cada palabra, su índice desde 1. */
  wordsMask: number[];
  /** `text_lengths`: número de palabras que el modelo ve en la ventana. */
  textLength: number;
  /** Índice (0-based, dentro de la ventana) de la palabra que el modelo numera `i + 1`. Identidad salvo palabras sin subtokens. */
  modelWordToWindowWord: number[];
}

/**
 * Codifica las palabras de una ventana.
 *
 * `maxSubtokensPerWord` trunca una palabra más larga que el presupuesto de la
 * ventana (7.10.3: se truncan sus subtokens). Una palabra sin subtokens no
 * recibe índice del modelo, de modo que `words_mask` no deja huecos.
 */
export function encodeWindow(
  tokenizer: GlinerTokenizer,
  wordTexts: readonly string[],
  labels: readonly GlinerLabel[] = GLINER_LABELS,
  maxSubtokensPerWord: number = Number.POSITIVE_INFINITY,
): WindowEncoding {
  const inputIds: number[] = [];
  const attentionMask: number[] = [];
  const wordsMask: number[] = [];
  const modelWordToWindowWord: number[] = [];

  if (tokenizer.clsId !== null) {
    inputIds.push(tokenizer.clsId);
    attentionMask.push(1);
    wordsMask.push(0);
  }
  for (const id of encodePrompt(tokenizer, labels)) {
    inputIds.push(id);
    attentionMask.push(1);
    wordsMask.push(0);
  }

  let counter = 1;
  wordTexts.forEach((word, windowWord) => {
    const ids = tokenizer.encodeWord(word).slice(0, maxSubtokensPerWord);
    ids.forEach((id, position) => {
      inputIds.push(id);
      attentionMask.push(1);
      wordsMask.push(position === 0 ? counter : 0);
    });
    if (ids.length > 0) {
      modelWordToWindowWord.push(windowWord);
      counter += 1;
    }
  });

  inputIds.push(tokenizer.sepId);
  attentionMask.push(1);
  wordsMask.push(0);

  return {
    inputIds,
    attentionMask,
    wordsMask,
    textLength: modelWordToWindowWord.length,
    modelWordToWindowWord,
  };
}

/**
 * Enumera los tramos candidatos `(inicio, inicio + anchura - 1)` con anchura de 1 a `maxWidth` palabras.
 *
 * `spanIdx` son pares `[inicio, fin]` (el fin se recorta a la última palabra) y `spanMask`
 * marca los que caben dentro de `wordCount`: `[1, L·12, 2]` y `[1, L·12]` en el grafo.
 */
export function buildSpans(
  wordCount: number,
  maxWidth: number,
): { spanIdx: Array<[number, number]>; spanMask: boolean[] } {
  const spanIdx: Array<[number, number]> = [];
  const spanMask: boolean[] = [];
  for (let start = 0; start < wordCount; start++) {
    for (let width = 0; width < maxWidth; width++) {
      const end = start + width;
      spanIdx.push([start, Math.min(end, wordCount - 1)]);
      spanMask.push(end < wordCount);
    }
  }
  return { spanIdx, spanMask };
}
