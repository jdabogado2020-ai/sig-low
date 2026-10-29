// Archivo de partida de P0-1 (9.1, regla 10): firma exportada sin lógica. Lo implementa PD-3 (A1).
import type { ValidatePassphraseFn } from '../core/types.ts';

export const validatePassphrase: ValidatePassphraseFn = () => {
  throw new Error('NO_IMPLEMENTADO');
};
