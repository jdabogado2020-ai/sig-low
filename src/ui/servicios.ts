// Puertos hacia los módulos que construyen otros carriles: la bóveda cifrada (PD-3/PD-4), el service worker (PD-1)
// y el modelo (PF-2). La interfaz habla con estos contratos; el integrador conecta cada módulo real con
// instalarPuertos() al fusionar su tarea. Mientras un puerto no esté conectado falla cerrado: "No guardar" funciona,
// «Guardar» queda deshabilitado con M-208 (IDB_NO_DISPONIBLE) y el SW se observa con la API nativa.
import { SiglowError } from '../core/types.ts';
import type {
  AsuntoId, CaseEntity, DocumentModel, ErrorCode, IsoDateTime, MappingTable, NerSpan, PartId, PlanBCause, ReadPdfFn,
} from '../core/types.ts';
import type { ModelUiState, ModelVariant } from './estado.ts';
import { aplicarVersionNueva, type ResultadoActualizacion } from './useActualizacion.ts';

/** Un asunto guardado: solo código y fechas, nunca contenido (V-35). `creado` es el del texto cifrado si el asunto está abierto; si no, el del registro. */
export interface AsuntoListado { asuntoId: AsuntoId; codigo: string; creado: IsoDateTime; actualizado: IsoDateTime }
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
  /** Pantalla Bóveda (PC-6). Pasos 1 a 12 de 6.7.6. Sin opción y con conflicto → ASUNTO_EXISTENTE (M-113): «Reemplazar» o «Importar con otro código». */
  importar(archivo: ArrayBuffer | Uint8Array, frase: string, opcion?: { reemplazar: true } | { codigoNuevo: string }): Promise<{ asuntoId: AsuntoId; codigo: string; persisted: boolean | null }>;
  /** «Exportar cifrado» desde la Bóveda sin abrir el asunto (B-24): la clave no queda en memoria; la frase errónea → CONTRASENA_O_ARCHIVO. */
  exportarAsunto(asuntoId: AsuntoId, frase: string): Promise<{ archivo: string }>;
  /** «Cambiar frase de paso» (6.7.4; M-6, B-23): el adaptador la hace en la cola del asunto y avisa a las otras pestañas. */
  cambiarFrase(asuntoId: AsuntoId, actual: string, nueva: string): Promise<void>;
  /** «Borrar» un asunto (M-109). */
  borrarAsunto(asuntoId: AsuntoId): Promise<void>;
  /** «Borrar todo» (M-111); 'bloqueado' → M-112. Quien llama vacía el estado en claro. */
  borrarTodo(): Promise<'borrado' | 'bloqueado'>;
  /** Resultado vigente de persist() (M-107); null si el navegador no lo ofrece. */
  persistencia(): Promise<boolean | null>;
}

export interface EstadoModeloPuerto { state: ModelUiState; variant?: ModelVariant; mb: number | null }
export interface ModeloPuerto {
  /** F10: todavía se está comprobando al arrancar si el detector ya está guardado (sin esto, se da por comprobado). */
  comprobando?(): boolean;
  /** F10: espera esa comprobación (manifiestos y caché del modelo). */
  esperarComprobacion?(): Promise<void>;
  /** F11: había un detector anterior guardado (otro troceo): se descarga una vez más. */
  viejo?(): boolean;
  disponible(): boolean;
  estado(): EstadoModeloPuerto;
  descargar(): Promise<void>;
  cancelar(): void;
  quitar(): Promise<void>;
}

export interface SwPuerto {
  /** Hay un controlador activo para esta página. */
  controlado(): boolean;
  /**
   * Pide aplicar la versión en espera (SKIP_WAITING) y recarga cuando cambia el controlador (PD-1). 'otras_pestanas':
   * el SW la rechazó porque hay otra ventana de Sig-Low abierta (B-11); no queda ninguna recarga pendiente.
   */
  aplicarActualizacion(): Promise<ResultadoActualizacion>;
}

/** Lo que el análisis le pide al modelo de apoyo (6.11.2 y 6.11.3). Lo conecta PF-2 al fusionarse; sin él, plan B (`no_descargado`). */
export interface NerHooks {
  /** `ner` informó el total de bloques y la duración de la ventana de calentamiento (M-164). */
  alTotal(ventanasTotales: number, calentamientoMs: number): void;
  /** Una ventana lista: tramos por parte en posiciones canónicas (INV-R01). `ventana` cuenta de 1 a `ventanasTotales`. */
  alVentana(v: { ventana: number; ventanasTotales: number; ner: Record<PartId, NerSpan[]>; engineId: string }): void;
  /** Todas las ventanas fueron entregadas; `respaldo` si las hizo la versión reducida. */
  alTerminar(r: { respaldo: boolean }): void;
  /** El modelo no terminó (carga, memoria, tiempo): se sigue con reglas y lista del caso. */
  alFallar(causa: PlanBCause): void;
}
export interface NerPuerto {
  /** Carga el modelo y lo ejecuta por ventanas sobre las partes incluidas. Devuelve la cancelación cooperativa. */
  iniciar(doc: DocumentModel, hooks: NerHooks): { cancelar(): void };
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
  importar: () => Promise.reject(new SiglowError('IDB_NO_DISPONIBLE')),
  exportarAsunto: () => Promise.reject(new SiglowError('IDB_NO_DISPONIBLE')),
  cambiarFrase: () => Promise.reject(new SiglowError('IDB_NO_DISPONIBLE')),
  borrarAsunto: () => Promise.reject(new SiglowError('IDB_NO_DISPONIBLE')),
  borrarTodo: () => Promise.reject(new SiglowError('IDB_NO_DISPONIBLE')),
  persistencia: () => Promise.resolve(null),
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
  aplicarActualizacion: aplicarVersionNueva,
};

/** Lector de PDF (PE-4). Mientras el integrador no lo conecte (`instalarPuertos({ pdf: readPdf })`) responde formato no disponible. */
const sinPdf: ReadPdfFn = () => Promise.reject(new SiglowError('FORMATO_NO_ADMITIDO'));

export const puertos: { boveda: BovedaPuerto; modelo: ModeloPuerto; sw: SwPuerto; pdf: ReadPdfFn; ner: NerPuerto | null } = {
  boveda: sinBoveda,
  modelo: sinModelo,
  sw: swNativo,
  pdf: sinPdf,
  ner: null,
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
