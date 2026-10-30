// Manejador de mensajes del worker `io` (6.11.1, 6.11.4). Lógica pura, sin `self`: el worker solo lo conecta.
// Reglas: errores solo con ErrorCode (INV-W01, INV-W02); el buffer recibido se pone en cero al terminar (V-23, T-PV-04).
import { SiglowError } from '../core/types';
import type { DocId, DocumentModel, ErrorCode, IdSource, IoLimits } from '../core/types';
import { readTxt } from './txt-read';
import type { ReadCtx } from './txt-read';

export type Post = (msg: unknown) => void;
export type Reader = (bytes: ArrayBuffer, ctx: ReadCtx, limits: IoLimits, progress: (done: number, total: number) => void) => DocumentModel;
export interface HandlerDeps { ids?: IdSource; readers?: Partial<Record<'txt' | 'docx', Reader>>; }

/** Lectores por formato. PE-2 y PE-3 registran aquí el de .docx. */
export const LECTORES: Partial<Record<'txt' | 'docx', Reader>> = {
  txt: (bytes, ctx) => readTxt(bytes, ctx),
};

const REQ_ID = /^req_[0-9a-f]{32}$/;
const DOC_ID = /^doc_[0-9a-f]{32}$/;
const ETIQUETA_DOCUMENTO = /^Documento \d+$/;
const REQ_NULO = 'req_' + '0'.repeat(32);
const REINTENTABLES: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['TIEMPO_AGOTADO', 'MEMORIA']);

function esObjeto(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
function esNumero(x: unknown, minExclusivo: number, max = Infinity): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x > minExclusivo && x <= max;
}

/** `message` de un worker `error`: solo v, reqId, kind, code y retryable (INV-W01). */
export function mensajeError(reqId: string, code: ErrorCode): { v: 1; reqId: string; kind: 'error'; code: ErrorCode; retryable: boolean } {
  return { v: 1, reqId, kind: 'error', code, retryable: REINTENTABLES.has(code) };
}

/** Traduce cualquier cosa lanzada a un ErrorCode. Nunca usa `message` ni `stack`. */
export function codigoDe(e: unknown): ErrorCode {
  if (e instanceof SiglowError) return e.code;
  if (e instanceof RangeError) return 'MEMORIA';
  return 'ERROR_INTERNO';
}

export function ponerEnCero(b: unknown): void {
  if (b instanceof ArrayBuffer && !b.detached) new Uint8Array(b).fill(0);
}

function limitesValidos(l: unknown): l is IoLimits {
  return esObjeto(l) &&
    esNumero(l.maxFileBytes, 0) && esNumero(l.maxZipEntries, 0) && esNumero(l.maxUncompressedTotal, 0) &&
    esNumero(l.maxXmlPartBytes, 0) && esNumero(l.timeoutMs, 0) && esNumero(l.pdfMinCharsPerPage, -1) &&
    esNumero(l.pdfMaxScannedRatio, 0, 1);
}

export function handleIoMessage(data: unknown, post: Post, deps: HandlerDeps = {}): void {
  let reqId = REQ_NULO;
  let buffer: unknown;
  try {
    if (!esObjeto(data)) { post(mensajeError(reqId, 'ENTRADA_INVALIDA')); return; }
    if (typeof data.reqId === 'string' && REQ_ID.test(data.reqId)) reqId = data.reqId;
    const payload = data.payload;
    if (esObjeto(payload)) buffer = payload.bytes;
    if (data.v !== 1 || reqId === REQ_NULO) { post(mensajeError(reqId, 'ENTRADA_INVALIDA')); return; }

    if (data.kind === 'cancelar') {
      // Cancelación cooperativa: la lectura es síncrona y no admite mensajes a mitad; el hilo principal termina el worker.
      const objetivo = esObjeto(payload) && typeof payload.targetReqId === 'string' && REQ_ID.test(payload.targetReqId) ? payload.targetReqId : null;
      if (objetivo === null) { post(mensajeError(reqId, 'ENTRADA_INVALIDA')); return; }
      post({ v: 1, reqId: objetivo, kind: 'cancelado' });
      return;
    }
    if (data.kind !== 'leer' || !esObjeto(payload)) { post(mensajeError(reqId, 'ENTRADA_INVALIDA')); return; }

    const { format, bytes, docId, label, limits } = payload;
    if ((format !== 'txt' && format !== 'docx') || !(bytes instanceof ArrayBuffer) || typeof docId !== 'string' ||
      !DOC_ID.test(docId) || typeof label !== 'string' || !ETIQUETA_DOCUMENTO.test(label) || !limitesValidos(limits)) {
      post(mensajeError(reqId, 'ENTRADA_INVALIDA'));
      return;
    }
    const total = bytes.byteLength;
    if (total === 0) { post(mensajeError(reqId, 'ARCHIVO_VACIO')); return; }
    if (total > limits.maxFileBytes) { post(mensajeError(reqId, 'ARCHIVO_DEMASIADO_GRANDE')); return; }
    const lector = (deps.readers ?? LECTORES)[format];
    if (lector === undefined) { post(mensajeError(reqId, 'FORMATO_NO_ADMITIDO')); return; }

    const progreso = (done: number, tot: number): void => {
      post({ v: 1, reqId, kind: 'progreso', stage: 'lectura', done, total: tot, unit: 'bytes' });
    };
    progreso(0, total);
    const ctx: ReadCtx = deps.ids === undefined ? { docId: docId as DocId, label } : { docId: docId as DocId, label, ids: deps.ids };
    const doc = lector(bytes, ctx, limits, progreso);
    progreso(total, total);
    post({ v: 1, reqId, kind: 'resultado', payload: { kind: 'leer', doc } });
  } catch (e) {
    post(mensajeError(reqId, codigoDe(e)));
  } finally {
    ponerEnCero(buffer);
  }
}
