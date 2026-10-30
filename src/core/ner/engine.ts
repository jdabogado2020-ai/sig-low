/**
 * Interfaz del motor de entidades y plan B (6.11.3). Código propio de Sig-Low.
 *
 * La interfaz `NerEngine` y los tipos viven en `src/core/types.ts` (6.11.3). `GlinerEngine` (la implementación con ORT-web) es de PF-1b y vive en otro archivo.
 */

import { NerAbortError } from './gliner/errors';
import type {
  NerEngine,
  NerLoadProgress,
  NerLoadResult,
  NerOptions,
  NerSpan,
  NerWindowResult,
  NullNerEngineShape,
} from '../types';

/** Plan B (respaldo en ejecución, no vía de cierre): reglas + lista del caso. `load()` resuelve sin descargar; `planWindows()` devuelve 0; `detect()` devuelve [] (AbortError si `signal.aborted`). */
export class NullNerEngine implements NullNerEngineShape {
  readonly engineId = 'nulo' as const;

  load(_onProgress: (p: NerLoadProgress) => void): Promise<NerLoadResult> {
    return Promise.resolve({
      engineId: 'nulo',
      modelId: null,
      sha256: null,
      threads: 0,
      crossOriginIsolated:
        (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true,
      labels: [],
      decoder: 'ninguno',
      loadMs: 0,
      warmupWindowMs: 0,
    });
  }

  planWindows(_text: string, _options: NerOptions): number {
    return 0;
  }

  detect(
    _text: string,
    _options: NerOptions,
    signal: AbortSignal,
    _onWindow?: (w: NerWindowResult) => void,
  ): Promise<NerSpan[]> {
    if (signal.aborted) return Promise.reject(new NerAbortError());
    return Promise.resolve([]);
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
