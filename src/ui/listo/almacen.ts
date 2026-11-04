// Estado de la pantalla Listo (PC-5) [M]: resultado de la búsqueda de residuos, la confirmación única (D-24), avisos de la última
// acción y el respaldo manual de copia. Se vacía con `registrarLimpieza()` en el bloqueo, «Cerrar asunto» y `pagehide` (INV-G09).
// La puerta (`exportGate`) NO se guarda aquí: se calcula de nuevo en cada render y en cada manejador (6.4.8, 8.2.7).
import { useEffect, useState } from 'preact/hooks';
import { exportGate } from '../../core/review/puerta.ts';
import type { ExportGate, ReminderConfirmation, ResidueResult, ReviewState } from '../../core/types.ts';
import type { MessageId, MsgParam } from '../mensajes.ts';
import { registrarLimpieza } from '../sesion.ts';

/** `alterno`: índice de la segunda variante de un mensaje con « / » en 8.5.1 (M-90 en «No guardar»). */
export interface AvisoListo { id: MessageId; params?: Readonly<Record<string, MsgParam>>; alterno?: number; rol: 'status' | 'alert' }

/** Un valor original que quedó en la salida, descrito solo con datos [P] (7.13.8). Los números de línea son de la salida. */
export interface Hallazgo {
  seccion: string; linea: number; tipo: string; marcador: string; modo: 'literal' | 'normalizado' | 'digitos' | 'variante';
  partId: string; partStart: number;
  /** Detección pendiente creada por `incorporar_residuos` en esa ubicación, para «Ir a la ubicación» (null si cayó dentro de un reemplazo). */
  detectionId: string | null;
}

export interface EstadoListo {
  residuo: ResidueResult | null;
  /** Hay una búsqueda en curso (M-76). */
  buscando: boolean;
  recordatorio: ReminderConfirmation;
  /** Cuándo se marcó la confirmación (6.8, `recordatorio.confirmado`). */
  recordatorioConfirmado: Date | null;
  /** Hallazgos de la última búsqueda con resultados, para mostrarlos con «Ir a la revisión». */
  hallazgos: readonly Hallazgo[];
  /** Documento al que pertenecen los hallazgos: la banda de Revisión no los muestra para otro documento. */
  docIdHallazgos: string | null;
  /** Hubo al menos una copia: habilita «Vaciar portapapeles» (8.2.7). */
  copiado: boolean;
  /** Avisos de las acciones (M-84, M-85, M-86, M-88, M-89, M-90, M-91, M-313…). */
  avisos: readonly AvisoListo[];
  /** `writeText` falló o no existe: se muestra el área de respaldo con este texto ya anonimizado (M-87). */
  respaldo: string | null;
  /** Error de la búsqueda de residuos (solo un ErrorCode, nunca texto) y la revisión sobre la que ocurrió. */
  errorBusqueda: { codigo: string; revision: number } | null;
  incluirCodigoAsunto: boolean;
  /** SHA-256 completo de index.html (`app.compilacion` del informe) o null si la caché está vacía (M-154). */
  compilacion: string | null;
}

const SIN_CASILLAS: ReminderConfirmation = { revisado: false };
const inicial = (): EstadoListo => ({
  residuo: null, buscando: false, recordatorio: SIN_CASILLAS, recordatorioConfirmado: null, hallazgos: [], docIdHallazgos: null,
  copiado: false, avisos: [], respaldo: null, errorBusqueda: null, incluirCodigoAsunto: false, compilacion: null,
});

let estado: EstadoListo = inicial();
const oyentes = new Set<() => void>();
const avisar = (): void => { for (const o of [...oyentes]) o(); };

export function obtenerListo(): EstadoListo {
  return estado;
}
export function actualizarListo(parche: Partial<EstadoListo>): void {
  estado = { ...estado, ...parche };
  avisar();
}
export function suscribirListo(fn: () => void): () => void {
  oyentes.add(fn);
  return () => { oyentes.delete(fn); };
}
export function useListo(): EstadoListo {
  const [, forzar] = useState(0);
  useEffect(() => suscribirListo(() => { forzar((n) => n + 1); }), []);
  return estado;
}

/** Entrar a la descarga: la confirmación se desmarca y el resultado anterior no se reutiliza (8.2.7). */
export function reiniciarEntrada(compilacion: string | null): void {
  estado = { ...inicial(), compilacion };
  avisar();
}

/** D-24 · Marca o desmarca la confirmación única «Revisé la vista previa…»; la fecha se fija al marcarla. */
export function marcarConfirmacion(valor: boolean, ahora: Date = new Date()): void {
  actualizarListo({
    recordatorio: { revisado: valor },
    recordatorioConfirmado: valor ? (estado.recordatorioConfirmado ?? ahora) : null,
  });
}

export function ponerAviso(avisos: readonly AvisoListo[]): void {
  actualizarListo({ avisos });
}

/** La puerta con lo vigente: estado de revisión, último resultado de residuos y confirmación. */
export function puertaDe(state: ReviewState): ExportGate {
  return exportGate(state, estado.residuo, estado.recordatorio);
}

registrarLimpieza(() => {
  estado = inicial();
  avisar();
});
