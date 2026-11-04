// Documento en memoria [M] (6.6.5): el borrador de Entrada, el DocumentModel analizado y el ReviewState de la revisión.
// Nada de esto se serializa ni sale de la pestaña. Se vacía en bloqueo, «Cerrar asunto», `pagehide` y «Borrar todo»
// (INV-G09) por `registrarLimpieza()` de sesion.ts; con ellos, el original en memoria del archivo cargado (D-22, `io/original.ts`). Revisión (PC-3/PC-4), Listo (PC-5) y Reinserción leen de aquí.
import { useEffect, useState } from 'preact/hooks';
import type { DocumentModel, ErrorCode, ReviewState } from '../core/types.ts';
import { docIdDelOriginal, soltarOriginal } from '../io/original.ts';
import { registrarLimpieza } from './sesion.ts';

export type PestanaEntrada = 'pegar' | 'cargar';
/** Lo que el abogado dejó en la pantalla de Entrada. El archivo se guarda ya leído; su nombre nunca (V-37). */
export interface BorradorEntrada {
  pestana: PestanaEntrada;
  texto: string;                         // [M] texto pegado
  archivo: DocumentModel | null;         // [M] lectura del archivo cargado, con las casillas de sus partes
  formato: 'txt' | 'docx' | 'pdf' | null;
  bytes: number | null;                  // tamaño leído, para M-47 ([P])
  usarModelo: boolean;
  errorLectura: ErrorCode | null;
  lecturaCancelada: boolean;
  /** M-61: el análisis se canceló y el texto sigue aquí. */
  analisisCancelado: boolean;
}

const inicial = (): BorradorEntrada => ({
  pestana: 'cargar', texto: '', archivo: null, formato: null, bytes: null, usarModelo: true,
  errorLectura: null, lecturaCancelada: false, analisisCancelado: false,
});

let borrador: BorradorEntrada = inicial();
let documento: DocumentModel | null = null;     // el documento que se analizó (partes incluidas ya fijadas)
let revision: ReviewState | null = null;
const oyentes = new Set<() => void>();
const avisar = (): void => { for (const o of [...oyentes]) o(); };

export function obtenerBorrador(): BorradorEntrada {
  return borrador;
}
export function actualizarBorrador(parche: Partial<BorradorEntrada>): void {
  borrador = { ...borrador, ...parche };
  soltarOriginalHuerfano();
  avisar();
}
/** D-22 · El original en memoria (`io/original.ts`) vive solo mientras el borrador tiene ese mismo documento; si no, queda en cero. */
function soltarOriginalHuerfano(): void {
  const id = docIdDelOriginal();
  if (id !== null && borrador.archivo?.id !== id) soltarOriginal();
}
/** El documento en análisis o en revisión; `null` antes de «Analizar» y tras descartarlo. */
export function obtenerDocumento(): DocumentModel | null {
  return documento;
}
export function fijarDocumento(d: DocumentModel | null): void {
  documento = d;
  avisar();
}
/** El estado de revisión vigente. Lo reemplaza quien aplica el reductor (6.4.4). */
export function obtenerRevision(): ReviewState | null {
  return revision;
}
export function fijarRevision(r: ReviewState | null): void {
  revision = r;
  avisar();
}
export function suscribirDocumento(fn: () => void): () => void {
  oyentes.add(fn);
  return () => { oyentes.delete(fn); };
}
/** Vacía el documento y la revisión; el borrador de Entrada se conserva (descartar documento, 8.1). */
export function vaciarDocumento(): void {
  documento = null;
  revision = null;
  avisar();
}
/** Vacía todo, incluido el texto pegado, y pone en cero el original en memoria (D-22). */
export function vaciarTodoElDocumento(): void {
  borrador = inicial();
  documento = null;
  revision = null;
  soltarOriginal();
  avisar();
}
registrarLimpieza(vaciarTodoElDocumento);

/**
 * M-123 (P0-6a de F4) · Hay contenido del abogado en memoria: texto pegado, un archivo leído (con su original, D-22), o un documento
 * en análisis o en revisión. El bloqueo por inactividad lo vigila aunque no haya un caso abierto (antes de «Anonimizar» no hay caso).
 */
export function hayDocumentoEnMemoria(): boolean {
  return borrador.texto !== '' || borrador.archivo !== null || documento !== null || revision !== null || docIdDelOriginal() !== null;
}

export function useBorrador(): BorradorEntrada {
  const [, forzar] = useState(0);
  useEffect(() => suscribirDocumento(() => { forzar((n) => n + 1); }), []);
  return borrador;
}
export function useRevision(): ReviewState | null {
  const [, forzar] = useState(0);
  useEffect(() => suscribirDocumento(() => { forzar((n) => n + 1); }), []);
  return revision;
}
