// Lectura de lo que se carga o se pega en Entrada (8.2.4, 6.11.4 a 6.11.6). El formato sale de los bytes mágicos y de la
// extensión; el nombre del archivo no se guarda ni se pasa a nadie (V-37). Los .txt y .docx se leen en el worker `io`;
// el PDF, por el puerto `pdf` (PE-4), que mientras no se conecte responde FORMATO_NO_ADMITIDO.
// D-22 (F4): los lectores ponen en cero lo que reciben; antes se copia el original, que tras una lectura correcta queda en memoria
// (`io/original.ts`) para la salida fiel (.docx idéntico y PDF tachado). Si la lectura falla o se cancela, la copia queda en cero.
import { SiglowError } from '../core/types.ts';
import type { DocId, DocumentModel, ErrorCode, IdSource, IoLimits, Part, PartId } from '../core/types.ts';
import { cryptoIds } from '../core/entities.ts';
import { IO_LIMITS_POR_DEFECTO, LecturaCancelada, leerArchivo, type WorkerIo } from '../io/io-client.ts';
import { guardarOriginal } from '../io/original.ts';
import { canonico } from '../io/txt-read.ts';
import { puertos } from './servicios.ts';

export type FormatoArchivo = 'txt' | 'docx' | 'pdf';
export { LecturaCancelada };

const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
const ZIP = [0x50, 0x4b, 0x03, 0x04] as const;
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;
const empieza = (b: Uint8Array, firma: readonly number[]): boolean => b.length >= firma.length && firma.every((x, i) => b[i] === x);

/** Extensión en minúsculas, sin el punto, o '' si no hay una razonable. Es lo único que se toma del nombre. */
export function extensionDe(nombre: string): string {
  const i = nombre.lastIndexOf('.');
  if (i < 0) return '';
  const ext = nombre.slice(i + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/u.test(ext) ? ext : '';
}

/**
 * Formato por bytes mágicos y extensión. Un contenedor CFB es un .doc antiguo o un .docx con contraseña (M-53);
 * un ZIP que no sea .docx (hoja de cálculo, comprimido) no se admite. Lo que no tiene firma se lee como texto solo si es .txt.
 */
export function detectarFormato(inicio: Uint8Array, extension: string): { formato: FormatoArchivo } | { error: ErrorCode } {
  if (inicio.length === 0) return { error: 'ARCHIVO_VACIO' };
  if (empieza(inicio, CFB)) return { error: 'CONTENEDOR_CFB' };
  if (empieza(inicio, PDF)) return { formato: 'pdf' };
  if (empieza(inicio, ZIP)) return extension === 'docx' ? { formato: 'docx' } : { error: 'FORMATO_NO_ADMITIDO' };
  if (extension === 'txt') return { formato: 'txt' };
  if (extension === 'docx') return { error: 'ZIP_INVALIDO' };
  if (extension === 'pdf') return { error: 'PDF_DANADO' };
  return { error: 'FORMATO_NO_ADMITIDO' };
}

export interface ResultadoLectura { doc: DocumentModel; formato: FormatoArchivo; bytes: number }
export interface LecturaOpciones {
  /** Nunca se guarda ni se muestra: solo se mira su extensión y su tamaño. */
  archivo: Blob & { name?: string };
  /** «Documento N»; nunca el nombre del archivo. */
  label: string;
  signal: AbortSignal;
  /** `hecho` y `total` en la `unidad` indicada (KB o páginas). */
  alAvanzar: (hecho: number, total: number, unidad: 'KB' | 'paginas') => void;
  limites?: IoLimits;
  ids?: IdSource;
  crearWorker?: () => WorkerIo;
}

/** Lee un archivo cargado. Rechaza con `SiglowError(code)` o `LecturaCancelada`; nunca con texto del documento. */
export async function leerContenido(o: LecturaOpciones): Promise<ResultadoLectura> {
  const limites = o.limites ?? IO_LIMITS_POR_DEFECTO;
  const ids = o.ids ?? cryptoIds;
  const extension = extensionDe(typeof o.archivo.name === 'string' ? o.archivo.name : '');
  if (o.archivo.size === 0) throw new SiglowError('ARCHIVO_VACIO');
  if (o.archivo.size > limites.maxFileBytes) throw new SiglowError('ARCHIVO_DEMASIADO_GRANDE');
  let buffer: ArrayBuffer;
  try {
    buffer = await o.archivo.arrayBuffer();
  } catch {
    throw new SiglowError('ERROR_INTERNO');
  }
  if (o.signal.aborted) throw new LecturaCancelada();
  const bytes = buffer.byteLength;
  const f = detectarFormato(new Uint8Array(buffer, 0, Math.min(8, bytes)), extension);
  if ('error' in f) throw new SiglowError(f.error);
  const docId = ids.next('doc') as DocId;
  let doc: DocumentModel;
  let copia: Uint8Array;
  try {
    copia = new Uint8Array(buffer.slice(0));
  } catch {
    new Uint8Array(buffer).fill(0);
    throw new SiglowError('MEMORIA');
  }
  try {
    if (f.formato === 'pdf') {
      doc = await puertos.pdf(buffer, { docId, label: o.label, limits: limites }, (h, t) => { o.alAvanzar(h, t, 'paginas'); }, o.signal);
    } else {
      const opciones = {
        format: f.formato, bytes: buffer, docId, label: o.label, limits: limites, signal: o.signal, ids,
        onProgress: (h: number, t: number): void => { o.alAvanzar(Math.ceil(h / 1024), Math.max(1, Math.ceil(t / 1024)), 'KB'); },
      };
      doc = await leerArchivo(o.crearWorker === undefined ? opciones : { ...opciones, crearWorker: o.crearWorker });
    }
  } catch (e) {
    copia.fill(0);
    // Una cancelación puede llegar como cualquier rechazo del lector: manda la señal.
    if (o.signal.aborted || e instanceof LecturaCancelada) throw new LecturaCancelada();
    if (e instanceof SiglowError) throw e;
    const c = typeof e === 'object' && e !== null && 'code' in e ? (e as { code: unknown }).code : undefined;
    throw new SiglowError(typeof c === 'string' && /^[A-Z][A-Z_]{2,40}$/u.test(c) ? (c as ErrorCode) : 'ERROR_INTERNO');
  }
  if (o.signal.aborted) { copia.fill(0); throw new LecturaCancelada(); }
  guardarOriginal(doc.id, f.formato, copia);
  return { doc, formato: f.formato, bytes };
}

/** Documento de una sola parte `cuerpo` («Texto pegado») con el texto canónico (6.1.1, 6.3.2). */
export function documentoDeTextoPegado(texto: string, label: string, ids: IdSource = cryptoIds): DocumentModel {
  const docId = ids.next('doc') as DocId;
  const parte: Part = {
    id: ids.next('prt') as PartId, docId, kind: 'cuerpo', label: 'Texto pegado', order: 0, index: 1, text: canonico(texto), included: true,
  };
  return { id: docId, label, source: 'pegado', parts: [parte], metadata: { categories: {} }, warnings: [] };
}

/** Partes que se analizarán: incluidas y con algún carácter que no sea espacio. */
export function partesAnalizables(doc: DocumentModel | null): Part[] {
  return doc === null ? [] : doc.parts.filter((p) => p.included && p.text.trim() !== '');
}
