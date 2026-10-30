/*
 * Derivado de @piighost/ner-web 0.3.0, archivo `src/gliner/processor.js (función measureSpecialTokens)`
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
 * Modificado para Sig-Low: convertido a TypeScript con comentarios en español; separado de processor.js; el cálculo es la función pura tokenizerAffixes(idsEmpty, idsA) de 7.10.1; se añade el PARCHE OBLIGATORIO para tokenizadores mT5 (solo </s> final, sin token inicial: prefijo 0, sufijo 1, cls false); el error pasa a un código sin texto (F-07); se añade readTokenizer (lector de tokenizer.json con @huggingface/tokenizers).
 */

/**
 * Envoltura del tokenizador de `tokenizer.json` (7.10.2).
 *
 * El post-procesador del tokenizador añade tokens especiales alrededor del texto
 * y no se puede suponer uno a cada lado: se mide una vez con `encode("")` y
 * `encode("a")`.
 *
 * PARCHE OBLIGATORIO PARA mT5 (7.10.2). El tokenizador T5/mT5 añade solo `</s>`
 * al final y ningún token inicial. El original suponía un especial a cada lado
 * y, aplicado a GLiNER-X, descartaba el primer subtoken de cada palabra y
 * anteponía un `</s>` (5 % de exhaustividad en el sondeo; con el parche, 97 %).
 */

import { Tokenizer } from '@huggingface/tokenizers';

import { GlinerError } from './errors';
import type { TokenizerLike } from './types';

/** Tokens especiales que el tokenizador añade a cada texto. `cls: false` = no hay token inicial. */
export interface TokenizerAffixes { prefix: number; suffix: number; cls: boolean }

/**
 * Deduce el envoltorio del tokenizador desde `encode("")` (`idsEmpty`) y `encode("a")` (`idsA`).
 *
 * - mT5 (solo `</s>` final): `{ prefix: 0, suffix: 1, cls: false }`.
 * - Estilo BERT (`[CLS] … [SEP]`): `{ prefix: 1, suffix: 1, cls: true }`.
 */
export function tokenizerAffixes(
  idsEmpty: readonly number[],
  idsA: readonly number[],
): TokenizerAffixes {
  const first = idsEmpty[0];
  const lastA = idsA[idsA.length - 1];
  // Parche mT5: la cadena vacía solo trae `</s>` y «a» termina en él sin empezar por él.
  if (
    idsEmpty.length === 1 &&
    idsA.length >= 2 &&
    lastA === first &&
    idsA[0] !== first
  ) {
    return { prefix: 0, suffix: 1, cls: false };
  }
  // Lo que contiene la codificación de la cadena vacía es exactamente el envoltorio.
  const prefix = idsEmpty.length === 0 ? 0 : 1;
  const suffix = idsEmpty.length >= 2 ? idsEmpty.length - prefix : 0;
  if (idsA.length <= prefix + suffix) throw new GlinerError('ERROR_INTERNO');
  return { prefix, suffix, cls: prefix > 0 };
}

/** Tokenizador listo para GLiNER: envoltorio medido, ids de los especiales y codificación por palabra. */
export interface GlinerTokenizer {
  readonly affixes: TokenizerAffixes;
  /** Id del token inicial, o `null` si no hay (mT5). */
  readonly clsId: number | null;
  /** Id del token final (`</s>` en mT5), que cierra cada secuencia. */
  readonly sepId: number;
  /** Subtokens de un texto (una palabra o una pieza del prompt) sin los especiales. */
  encodeWord(text: string): number[];
}

export function createGlinerTokenizer(tokenizer: TokenizerLike): GlinerTokenizer {
  const idsEmpty = tokenizer.encode('').ids;
  const idsA = tokenizer.encode('a').ids;
  const affixes = tokenizerAffixes(idsEmpty, idsA);
  const sepId = idsEmpty[idsEmpty.length - 1];
  if (sepId === undefined) throw new GlinerError('ERROR_INTERNO');
  const clsId = affixes.cls ? (idsEmpty[0] ?? null) : null;
  return {
    affixes,
    clsId,
    sepId,
    encodeWord(text: string): number[] {
      const ids = tokenizer.encode(text).ids;
      return ids.slice(affixes.prefix, ids.length - affixes.suffix);
    },
  };
}

/** Lee `tokenizer.json` y `tokenizer_config.json` con `@huggingface/tokenizers` (0.2.0). */
export function readTokenizer(tokenizerJson: object, tokenizerConfig: object): GlinerTokenizer {
  return createGlinerTokenizer(new Tokenizer(tokenizerJson, tokenizerConfig));
}
