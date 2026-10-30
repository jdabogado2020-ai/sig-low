/*
 * Derivado de @piighost/ner-web 0.3.0, archivo `src/gliner/decoder.js (funciones decodeSpanLevel y greedySelect)`
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
 * Modificado para Sig-Low: convertido a TypeScript con comentarios en español; separado en spanCandidatesFromLogits (disposición [1, L, 12, etiquetas]) y decodeSpans (7.10.4: umbral inclusivo, desempate por puntaje, anchura e inicio, sin solapes aunque las etiquetas difieran, anchura máxima 12); se retiran decodeTokenLevel y el modo anidado (GLiNER-X es solo de tramos) y las entidades con texto (las posiciones se calculan en offsets.ts).
 */

/**
 * Decodificación de los logits en tramos (7.10.4).
 *
 * El grafo de GLiNER-X es de tramos (span-level) con disposición de salida
 * `[lote, palabras, anchura_máx, etiquetas]`. Equivocarse de disposición no da
 * error: el modelo devuelve puntajes incoherentes. Por eso la disposición está
 * escrita aquí de forma explícita (y no se usa la librería `gliner` de npm, que
 * lee mal el orden de los ejes).
 */

import type { DecodedSpan, GlinerLabel, SpanCandidate } from './types';

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/**
 * Candidatos de una ventana a partir de los logits `[1, L, maxWidth, labels.length]`.
 *
 * `s` es el índice de palabra de inicio de la ventana y `w` la anchura (1 a `maxWidth`).
 * Los tramos que no caben en las `wordCount` palabras se omiten (`span_mask`).
 */
export function spanCandidatesFromLogits(
  logits: ArrayLike<number>,
  wordCount: number,
  maxWidth: number,
  labels: readonly GlinerLabel[],
): SpanCandidate[] {
  const out: SpanCandidate[] = [];
  const classCount = labels.length;
  for (let s = 0; s < wordCount; s++) {
    for (let width = 0; width < maxWidth; width++) {
      if (s + width >= wordCount) break;
      for (let c = 0; c < classCount; c++) {
        const label = labels[c];
        const logit = logits[(s * maxWidth + width) * classCount + c];
        if (label === undefined || logit === undefined) continue;
        out.push({ s, w: width + 1, label, p: sigmoid(logit) });
      }
    }
  }
  return out;
}

/**
 * Selección voraz sin solapes.
 *
 * Pasan los candidatos con `p >= umbral` (inclusivo) y anchura <= `maxWidth`. Se ordenan por `p` descendente;
 * a igual `p`, mayor anchura; a igual anchura, menor inicio. Un candidato entra si no se solapa en palabras
 * con ninguno ya elegido (aunque tenga otra etiqueta). Resultado ordenado por inicio; `e` es inclusivo.
 */
export function decodeSpans(
  candidates: readonly SpanCandidate[],
  threshold: number,
  maxWidth = 12,
): DecodedSpan[] {
  const pool = candidates
    .filter((c) => c.p >= threshold && c.w >= 1 && c.w <= maxWidth)
    .map((c, order) => ({ c, order }));
  pool.sort(
    (a, b) => b.c.p - a.c.p || b.c.w - a.c.w || a.c.s - b.c.s || a.order - b.order,
  );

  const kept: DecodedSpan[] = [];
  for (const { c } of pool) {
    const s = c.s;
    const e = c.s + c.w - 1;
    if (kept.some((k) => s <= k.e && k.s <= e)) continue;
    kept.push({ label: c.label, s, e, p: c.p });
  }
  return kept.sort((a, b) => a.s - b.s);
}
