// Evaluación de la frase de paso en la interfaz (6.7.3, 8.2.2). La regla es de `vault/crypto.ts` (PD-3);
// mientras esa función no exista (lanza NO_IMPLEMENTADO) se aplica solo el mínimo de 15 puntos de código.
import type { PassphraseIssue } from '../core/types.ts';
import { validatePassphrase } from '../vault/crypto.ts';
import { t, X, type MessageId } from './mensajes.ts';

export const MINIMO_FRASE = 15;

export interface EvaluacionFrase {
  /** Puntos de código de la frase en NFC. */
  longitud: number;
  contador: string;
  /** Error del primer campo (M-17 u otro motivo de 6.7.3); undefined si todavía no hay nada que decir. */
  errorFrase: string | undefined;
  /** Error del segundo campo (M-18). */
  errorRepetir: string | undefined;
  valida: boolean;
}

const MENSAJE_DE_MOTIVO: Record<Exclude<PassphraseIssue, 'CORTA'>, MessageId> = {
  POCA_VARIEDAD: X.fraseVariedad,
  SOLO_DIGITOS: X.fraseDigitos,
  SECUENCIA: X.fraseSecuencia,
  CONTIENE_CODIGO: X.fraseCodigo,
  FRASE_COMUN: X.fraseComun,
};

function motivos(frase: string, codigo: string, longitud: number): PassphraseIssue[] {
  try {
    return validatePassphrase(frase, codigo);
  } catch {
    return longitud < MINIMO_FRASE ? ['CORTA'] : [];
  }
}

/** `repetir === null` cuando el campo de repetición no se muestra (abrir, exportar con asunto guardado). */
export function evaluarFrase(fraseCruda: string, repetirCrudo: string | null, codigo: string): EvaluacionFrase {
  const frase = fraseCruda.normalize('NFC');
  const longitud = [...frase].length;
  const issues = longitud === 0 ? [] : motivos(frase, codigo, longitud);
  let errorFrase: string | undefined;
  const corta = issues.includes('CORTA') || (longitud > 0 && longitud < MINIMO_FRASE);
  if (corta) errorFrase = t('M-17', { n: MINIMO_FRASE - longitud });
  else {
    const otro = issues.find((i): i is Exclude<PassphraseIssue, 'CORTA'> => i !== 'CORTA');
    if (otro) errorFrase = t(MENSAJE_DE_MOTIVO[otro]);
  }
  const repetir = repetirCrudo === null ? null : repetirCrudo.normalize('NFC');
  const errorRepetir = repetir !== null && repetir !== '' && repetir !== frase ? t('M-18') : undefined;
  const igual = repetir === null || repetir === frase;
  return {
    longitud,
    contador: t(X.contadorFrase, { n: longitud }),
    errorFrase,
    errorRepetir,
    valida: longitud > 0 && issues.length === 0 && !corta && igual && (repetir === null || repetir !== ''),
  };
}
