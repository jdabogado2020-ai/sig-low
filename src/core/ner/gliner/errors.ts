/**
 * Errores del motor. Código propio de Sig-Low.
 *
 * F-07: el mensaje es siempre el código; nunca lleva texto del documento ni del tokenizador.
 */

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
