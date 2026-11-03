// F4 · El original en memoria (D-22). Para que el .docx salga idéntico y el PDF tachado conserve su diseño, los bytes del archivo
// cargado se guardan mientras dura la sesión del documento. Solo aquí, solo en memoria del hilo principal: nunca en IndexedDB, en el
// SW, en `localStorage` ni en un `blob:`. Hay un solo original a la vez; guardar otro pone el anterior en cero.
//
// Ciclo de vida (lo garantiza `src/ui/documento.ts`): se guarda al terminar una lectura correcta (`lectura.ts`) y se pone en cero
// cuando el borrador deja de tener ese documento (otro archivo, error de lectura), al bloquear, en «Cerrar asunto», en «Borrar todo»
// y en `pagehide` (`registrarLimpieza`, INV-G09). El worker `io` sigue poniendo en cero su copia al leer (V-23, T-PV-04).
import type { DocId } from '../core/types';

export type FormatoOriginal = 'txt' | 'docx' | 'pdf';
export interface Original { readonly docId: DocId; readonly formato: FormatoOriginal; readonly bytes: Uint8Array }

let guardado: Original | null = null;

/** Guarda los bytes del original (ya copiados por quien llama: este módulo toma su propiedad). El anterior queda en cero. */
export function guardarOriginal(docId: DocId, formato: FormatoOriginal, bytes: Uint8Array): void {
  if (guardado !== null && guardado.bytes !== bytes) guardado.bytes.fill(0);
  guardado = { docId, formato, bytes };
}

/**
 * El original del documento `docId`, o null si no está (otro documento, ya soltado o texto pegado). Quien lo recibe solo lo lee y
 * no guarda la referencia: los bytes pueden ponerse en cero en cualquier momento (bloqueo, `pagehide`).
 */
export function originalDe(docId: DocId): Original | null {
  return guardado !== null && guardado.docId === docId && guardado.bytes.byteLength > 0 ? guardado : null;
}

/** El documento cuyo original está en memoria, o null. */
export function docIdDelOriginal(): DocId | null {
  return guardado?.docId ?? null;
}

/** Pone en cero y suelta el original. Idempotente. */
export function soltarOriginal(): void {
  if (guardado !== null) guardado.bytes.fill(0);
  guardado = null;
}
