/**
 * Ventanas y zona propia (7.10.3 y 7.10.5). Código propio de Sig-Low.
 *
 * Una ventana es una secuencia de `windowTokens` subtokens; las ventanas se solapan
 * `overlapWords` palabras. Para que cada tramo lo emita una sola ventana, cada una
 * tiene una zona propia en palabras y conserva solo los tramos cuya primera palabra
 * cae en ella.
 */

import type { WordRange } from './types';

/**
 * Planifica las ventanas de un documento.
 *
 * `counts[i]` son los subtokens de la palabra `i`. `windowTokens` incluye el prompt y el
 * token final (`reserved`). Devuelve `[palabraInicio, palabraFin)`; la primera empieza en 0,
 * la última termina en `n` y cada inicio es mayor que el anterior.
 */
export function planWindows(
  counts: readonly number[],
  windowTokens: number,
  overlapWords: number,
  reserved: number,
): WordRange[] {
  const n = counts.length;
  const budget = Math.max(1, windowTokens - reserved);
  const windows: WordRange[] = [];
  let s = 0;
  while (s < n) {
    let e = s;
    let used = 0;
    while (e < n) {
      const c = Math.min(counts[e] ?? 0, budget);
      if (used + c > budget) break;
      used += c;
      e++;
    }
    if (e === s) e = s + 1; // palabra más larga que la ventana: se truncan sus subtokens
    windows.push([s, e]);
    if (e >= n) break;
    s = Math.max(e - overlapWords, s + 1); // la siguiente empieza O palabras atrás; siempre avanza
  }
  return windows;
}

/**
 * Zona propia `[inicio, fin)` de cada ventana, en palabras.
 *
 * La primera empieza en 0; las demás, en el punto medio de su solape con la anterior
 * (`floor((inicio_ventana + fin_ventana_anterior) / 2)`, nunca menor que el inicio de la zona anterior).
 * El fin de cada zona es el inicio de la siguiente; el de la última, `wordCount`.
 */
export function ownZones(
  windows: ReadonlyArray<readonly [number, number]>,
  wordCount: number,
): WordRange[] {
  const starts: number[] = [];
  windows.forEach((w, i) => {
    if (i === 0) {
      starts.push(0);
      return;
    }
    const prev = windows[i - 1] as readonly [number, number];
    const prevStart = starts[i - 1] as number;
    starts.push(Math.max(Math.floor((w[0] + prev[1]) / 2), prevStart));
  });
  return starts.map((start, i): WordRange => [
    start,
    i + 1 < starts.length ? (starts[i + 1] as number) : wordCount,
  ]);
}

/** ¿La primera palabra de un tramo (índice global) pertenece a la zona propia? */
export function inOwnZone(zone: Readonly<WordRange>, firstWord: number): boolean {
  return firstWord >= zone[0] && firstWord < zone[1];
}
