// Cliente del worker `io` en el hilo principal (6.11.4, 6.11.6): un worker nuevo por archivo, tiempo límite con
// terminate(), cancelación y errores solo con ErrorCode. No recibe ni guarda el nombre del archivo (V-37).
import { SiglowError } from '../core/types';
import type { DocId, DocumentModel, ErrorCode, IdSource, IoLimits, RequestId } from '../core/types';
import { randomIds } from './txt-read';

/** Límites de 6.3.4. `timeoutMs` se calibró en PE-1 (ver tests/unit/io-limits.test.ts). */
export const IO_LIMITS_POR_DEFECTO: IoLimits = {
  maxFileBytes: 26_214_400,
  maxZipEntries: 1024,
  maxUncompressedTotal: 104_857_600,
  maxXmlPartBytes: 15_728_640,
  timeoutMs: 15_000,
  pdfMinCharsPerPage: 10,
  pdfMaxScannedRatio: 0.5,
};

/** Lo mínimo que se usa de un Worker; permite inyectar uno falso en las pruebas. */
export interface WorkerIo {
  postMessage(msg: unknown, transfer: ArrayBuffer[]): void;
  terminate(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: { preventDefault(): void }) => void) | null;
  onmessageerror: ((ev: { preventDefault(): void }) => void) | null;
}

/** Worker de módulo del mismo origen (F-09): sin blob:, data: ni ?worker&inline. */
export function crearWorkerIo(): WorkerIo {
  return new Worker(new URL('../workers/io.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerIo;
}

/** La lectura se canceló desde la interfaz; el mensaje es fijo y nunca lleva contenido. */
export class LecturaCancelada extends Error {
  constructor() { super('CANCELADO'); this.name = 'LecturaCancelada'; }
}

export interface LeerOpciones {
  format: 'txt' | 'docx';
  /** Se transfiere al worker: el emisor queda sin acceso (byteLength 0). */
  bytes: ArrayBuffer;
  docId: DocId;
  /** «Documento N»; nunca el nombre del archivo. */
  label: string;
  limits?: IoLimits;
  signal?: AbortSignal;
  /** Bytes leídos del total. */
  onProgress?: (done: number, total: number) => void;
  crearWorker?: () => WorkerIo;
  ids?: IdSource;
}

const CODIGO = /^[A-Z][A-Z_]{2,40}$/;

function esObjeto(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
function docValido(x: unknown): x is DocumentModel {
  return esObjeto(x) && typeof x.id === 'string' && typeof x.label === 'string' && Array.isArray(x.parts) &&
    Array.isArray(x.warnings) && esObjeto(x.metadata);
}

/**
 * Lee un archivo en un worker nuevo. Vence a los `limits.timeoutMs` (TIEMPO_AGOTADO) y en todos los casos
 * termina el worker: al responder, al fallar, al vencer y al cancelar.
 */
export function leerArchivo(opts: LeerOpciones): Promise<DocumentModel> {
  const limits = opts.limits ?? IO_LIMITS_POR_DEFECTO;
  const reqId = (opts.ids ?? randomIds()).next('req') as RequestId;
  return new Promise<DocumentModel>((resolve, reject) => {
    if (opts.signal?.aborted === true) { reject(new LecturaCancelada()); return; }
    let worker: WorkerIo;
    try {
      worker = (opts.crearWorker ?? crearWorkerIo)();
    } catch {
      reject(new SiglowError('ERROR_INTERNO'));
      return;
    }
    let cerrado = false;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const alAbortar = (): void => { cerrar(() => { reject(new LecturaCancelada()); }); };
    function cerrar(fin: () => void): void {
      if (cerrado) return;
      cerrado = true;
      if (temporizador !== undefined) clearTimeout(temporizador);
      opts.signal?.removeEventListener('abort', alAbortar);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      fin();
    }
    const fallar = (code: ErrorCode): void => { cerrar(() => { reject(new SiglowError(code)); }); };

    worker.onmessage = (ev): void => {
      const d = ev.data;
      if (!esObjeto(d) || d.v !== 1 || d.reqId !== reqId) return;
      if (d.kind === 'progreso') {
        if (typeof d.done === 'number' && typeof d.total === 'number') opts.onProgress?.(d.done, d.total);
      } else if (d.kind === 'resultado') {
        const p = d.payload;
        if (esObjeto(p) && p.kind === 'leer' && docValido(p.doc)) {
          const doc = p.doc;
          cerrar(() => { resolve(doc); });
        } else fallar('ERROR_INTERNO');
      } else if (d.kind === 'error') {
        fallar(typeof d.code === 'string' && CODIGO.test(d.code) ? (d.code as ErrorCode) : 'ERROR_INTERNO');
      } else if (d.kind === 'cancelado') {
        cerrar(() => { reject(new LecturaCancelada()); });
      }
    };
    worker.onerror = (ev): void => { ev.preventDefault(); fallar('ERROR_INTERNO'); };
    worker.onmessageerror = (ev): void => { ev.preventDefault(); fallar('ERROR_INTERNO'); };
    opts.signal?.addEventListener('abort', alAbortar, { once: true });
    temporizador = setTimeout(() => { fallar('TIEMPO_AGOTADO'); }, limits.timeoutMs);

    try {
      worker.postMessage(
        { v: 1, reqId, kind: 'leer', payload: { format: opts.format, bytes: opts.bytes, docId: opts.docId, label: opts.label, limits } },
        [opts.bytes],
      );
    } catch {
      fallar('ERROR_INTERNO');
    }
  });
}
