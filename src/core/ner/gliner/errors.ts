/**
 * Errores del motor. Código propio de Sig-Low.
 *
 * F-07: el mensaje es siempre el código; nunca lleva texto del documento ni del tokenizador.
 */

import { SiglowError, type ErrorCode } from '../../types';

export class GlinerError extends Error {
  readonly code: 'ERROR_INTERNO' | 'ENTRADA_INVALIDA';
  constructor(code: 'ERROR_INTERNO' | 'ENTRADA_INVALIDA') {
    super(code);
    this.name = 'GlinerError';
    this.code = code;
  }
}

/** Cancelación cooperativa (`signal.aborted`). Sin texto. */
export class NerAbortError extends Error {
  constructor() {
    super('AbortError');
    this.name = 'AbortError';
  }
}

/** Código de error de una excepción. Clasifica por clase y `name`; el texto de la excepción no se lee ni se reenvía (F-07). */
export function codigoDeError(e: unknown): ErrorCode {
  if (e instanceof SiglowError || e instanceof GlinerError) return e.code;
  if (e instanceof Error) {
    if (e.name === 'QuotaExceededError') return 'CUOTA_EXCEDIDA';
    if (e instanceof RangeError) return 'MEMORIA'; // reserva de un búfer o de memoria WASM que no cabe
  }
  return 'ERROR_INTERNO';
}

