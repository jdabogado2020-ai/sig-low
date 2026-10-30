/**
 * Mapeo de tramos por palabra a posiciones del texto canónico (7.10.4, 7.10.5 y 7.10.8).
 * Código propio de Sig-Low.
 *
 * Los desplazamientos salen de las palabras: inicio de la primera y fin de la última. Se
 * calculan siempre sobre el texto canónico sin transformarlo (INV-W04).
 */

import type { NerLabel, NerSpan } from '../../types';
import type { DecodedSpan, WordRange, WordSpan } from './types';
import { inOwnZone } from './windows';

export const NER_LABEL_OF: Readonly<Record<DecodedSpan['label'], NerLabel>> = {
  person: 'PER',
  organization: 'ORG',
  location: 'LOC',
};

/**
 * Convierte los tramos decodificados de una ventana en `NerSpan` canónicos.
 *
 * - `decoded` usa índices de palabra de la numeración del modelo en la ventana (`s`, `e` inclusivos).
 * - `modelWordToWindowWord[i]` da la palabra de la ventana (0-based) de la palabra `i` del modelo
 *   (identidad si se omite).
 * - `window` es `[inicio, fin)` en índices globales y `zone` su zona propia: solo se conservan los tramos
 *   cuya primera palabra global cae en ella.
 * Resultado ordenado por posición.
 */
export function toNerSpans(
  decoded: readonly DecodedSpan[],
  words: readonly WordSpan[],
  window: Readonly<WordRange>,
  zone: Readonly<WordRange>,
  modelWordToWindowWord?: readonly number[],
): NerSpan[] {
  const out: NerSpan[] = [];
  for (const d of decoded) {
    const first = window[0] + (modelWordToWindowWord ? (modelWordToWindowWord[d.s] ?? -1) : d.s);
    const last = window[0] + (modelWordToWindowWord ? (modelWordToWindowWord[d.e] ?? -1) : d.e);
    if (first < window[0] || last >= window[1] || last < first) continue;
    if (!inOwnZone(zone, first)) continue;
    const a = words[first];
    const b = words[last];
    if (a === undefined || b === undefined) continue;
    out.push({ start: a.start, end: b.end, label: NER_LABEL_OF[d.label], score: d.p });
  }
  return out.sort((x, y) => x.start - y.start || x.end - y.end);
}
