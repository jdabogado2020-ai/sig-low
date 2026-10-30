/*
 * Derivado de @piighost/ner-web 0.3.0, archivo `src/splitter.js`
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
 * Modificado para Sig-Low: convertido a TypeScript con comentarios en español; el patrón pasa a R-MOD-01 (7.10.2: admite marcas combinantes \p{M} y deja los invisibles U+00AD y U+200B a U+200D dentro de la palabra); se añaden segmentWords (solo posiciones) y stripInvisibles; splitWords devuelve el texto sin invisibles.
 */

/**
 * Divisor de palabras (R-MOD-01, 7.10.2).
 *
 * El modelo razona sobre palabras y este divisor sabe dónde empieza y termina
 * cada una en el texto canónico. El patrón es el del GLiNER de Python
 * (`\w+(?:[-_]\w+)*|\S`) con clases Unicode explícitas: en JavaScript `\w`
 * vale `[A-Za-z0-9_]` y partiría «Muñoz» en tres palabras. La bandera `u` es
 * obligatoria.
 *
 * Dos precisiones frente al original (R-MOD-01): admite marcas combinantes
 * (`\p{M}`) y deja los invisibles (U+00AD, U+200B a U+200D) dentro de la
 * palabra sin que formen una por sí solos. Cambiar este patrón exige repetir
 * el sondeo de PF-4.
 *
 * Nota: `gliner_config.json` del modelo declara `words_splitter_type = "stanza"`; en Sig-Low no se usa ese
 * divisor sino esta regex Unicode (la del puerto verificado, con las dos precisiones de R-MOD-01).
 */

import type { WordSpan } from './types';

/** Una palabra con su texto para el tokenizador (sin invisibles) y su posición canónica. */
export interface GlinerWord extends WordSpan {
  text: string;
}

const INNER = '[\\p{L}\\p{M}\\p{N}_\\u{AD}\\u{200B}-\\u{200D}]';
const HEAD = '[\\p{L}\\p{M}\\p{N}_]';
const WORD_SOURCE =
  `${HEAD}${INNER}*(?:[-_]${HEAD}${INNER}*)*` + '|[^\\s\\u{AD}\\u{200B}-\\u{200D}\\u{FEFF}]';
const INVISIBLES = /[­​-‍]/gu;

/** Quita los invisibles que solo se eliminan del texto de la palabra, nunca de las posiciones. */
export function stripInvisibles(word: string): string {
  return word.replace(INVISIBLES, '');
}

/** Palabras del texto, en orden, con posiciones canónicas `[start, end)`. */
export function segmentWords(text: string): WordSpan[] {
  const out: WordSpan[] = [];
  for (const m of text.matchAll(new RegExp(WORD_SOURCE, 'gu'))) {
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** Igual que `segmentWords`, con el texto que se entrega al tokenizador. */
export function splitWords(text: string): GlinerWord[] {
  const out: GlinerWord[] = [];
  for (const m of text.matchAll(new RegExp(WORD_SOURCE, 'gu'))) {
    out.push({ start: m.index, end: m.index + m[0].length, text: stripInvisibles(m[0]) });
  }
  return out;
}
