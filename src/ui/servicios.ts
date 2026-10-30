// Puertos hacia los módulos que construyen otros carriles: la bóveda cifrada (PD-3/PD-4), el service worker (PD-1)
// y el modelo (PF-2). La interfaz habla con estos contratos; el integrador conecta cada módulo real con
// instalarPuertos() al fusionar su tarea. Mientras un puerto no esté conectado falla cerrado: "No guardar" funciona,
// «Guardar» queda deshabilitado con M-208 (IDB_NO_DISPONIBLE) y el SW se observa con la API nativa.
import { SiglowError } from '../core/types.ts';
import type { AsuntoId, CaseEntity, ErrorCode, IsoDateTime, MappingTable } from '../core/types.ts';
import type { ModelUiState, ModelVariant } from './estado.ts';

export interface AsuntoListado { asuntoId: AsuntoId; codigo: string; actualizado: IsoDateTime }
export interface AsuntoAbierto { asuntoId: AsuntoId; codigo: string; caseList: CaseEntity[]; table: MappingTable }
export interface InstantaneaAsunto { caseList: readonly CaseEntity[]; table: MappingTable }

/** Contrato de la bóveda (6.7.4). Los rechazos son `SiglowError` con un `ErrorCode`; nunca texto del usuario. */
export interface BovedaPuerto {
  /** IndexedDB utilizable (no es una ventana privada que lo bloquee). */
  disponible(): boolean;
  listar(): Promise<AsuntoListado[]>;
  /** «Guardar»: valida, deriva la clave, cifra, guarda y pide persist(). */
  crear(entrada: { codigo: string; frase: string }): Promise<{ asuntoId: AsuntoId; persisted: boolean | null }>;
  /** Descifra en memoria; `CONTRASENA_O_ARCHIVO` si la frase no abre el registro. */
  abrir(asuntoId: AsuntoId, frase: string): Promise<AsuntoAbierto>;
  /** Guarda la tabla y la lista del caso del asunto abierto (IV nuevo). `CUOTA_EXCEDIDA` si no cabe. */
  guardar(asuntoId: AsuntoId, datos: InstantaneaAsunto): Promise<void>;
  /** «Exportar tabla cifrada»: descarga el .siglow con sal nueva (6.7.5). */
  exportar(datos: InstantaneaAsunto, codigo: string, frase: string): Promise<{ archivo: string }>;
  /** «Pasar a Guardar cifrada» desde «No guardar». */
  pasarAGuardar(codigo: string, frase: string, datos: InstantaneaAsunto): Promise<{ asuntoId: AsuntoId; persisted: boolean | null }>;
  /** Vacía la clave en memoria (bloqueo, cerrar asunto, pagehide). */
  cerrar(): void;
}

export interface EstadoModeloPuerto { state: ModelUiState; variant?: ModelVariant; mb: number | null }
export interface ModeloPuerto {
  disponible(): boolean;
  estado(): EstadoModeloPuerto;
  descargar(): Promise<void>;
  cancelar(): void;
  quitar(): Promise<void>;
}

export interface SwPuerto {
  /** Hay un controlador activo para esta página. */
  controlado(): boolean;
  /** Pide aplicar la versión en espera (SKIP_WAITING); la interfaz recarga. */
  aplicarActualizacion(): void;
}

const sinBoveda: BovedaPuerto = {
  disponible: () => false,
  listar: () => Promise.resolve([]),
  crear: () => Promise.reject(new SiglowError('IDB_NO_DISPONIBLE')),
  abrir: () => Promise.reject(new SiglowError('IDB_NO_DISPONIBLE')),
  guardar: () => Promise.reject(new SiglowError('IDB_NO_DISPONIBLE')),
  exportar: () => Promise.reject(new SiglowError('IDB_NO_DISPONIBLE')),
  pasarAGuardar: () => Promise.reject(new SiglowError('IDB_NO_DISPONIBLE')),
  cerrar: () => undefined,
};

const sinModelo: ModeloPuerto = {
  disponible: () => false,
  estado: () => ({ state: 'no_descargado', mb: null }),
  descargar: () => Promise.resolve(),
  cancelar: () => undefined,
  quitar: () => Promise.resolve(),
};

const swNativo: SwPuerto = {
  controlado: () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker.controller !== null,
  aplicarActualizacion: () => {
    void navigator.serviceWorker.getRegistration().then((r) => { r?.waiting?.postMessage({ tipo: 'SKIP_WAITING' }); });
  },
};

export const puertos: { boveda: BovedaPuerto; modelo: ModeloPuerto; sw: SwPuerto } = {
  boveda: sinBoveda,
  modelo: sinModelo,
  sw: swNativo,
};

export function instalarPuertos(parcial: Partial<typeof puertos>): void {
  Object.assign(puertos, parcial);
}

/** Código de un rechazo: solo `SiglowError.code` o un código conocido; cualquier otro error es ERROR_INTERNO. Nunca `message`. */
export function codigoDeError(e: unknown): ErrorCode {
  const c = typeof e === 'object' && e !== null && 'code' in e ? (e as { code: unknown }).code : undefined;
  if (typeof c === 'string') return c as ErrorCode;
  return 'ERROR_INTERNO';
}
