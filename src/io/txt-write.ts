// PE-5 · Exportación a .txt y descargas (3.8, 6.9, 6.9.1; V-36, V-40, V-48). Hilo principal: usa DOM mínimo (Blob, <a download>).
// Este archivo también aloja lo que comparten las dos exportaciones: el nombre neutro de descarga, el registro de URL `blob:` vivas
// y la descarga misma (`docx-write.ts`, y desde F4 `docx-write-fiel.ts`, `pdf-write.ts` y `pdf-tachar.ts`, los importan). PC-5 llama a `exportarTxt` y `exportarDocx` desde la pantalla Listo, detrás de
// `exportGate`; el bloqueo y `pagehide` (PC-6) llaman a `revocarUrlsVivas`.
//
// Sin red, sin consola, sin almacenamiento. Los errores salen solo como `SiglowError` con `ErrorCode`.
import { joinOutput } from '../core/render';
import { SiglowError } from '../core/types';
import type { ParseWarning, RenderedOutput } from '../core/types';

/** Qué se exporta: la salida renderizada (6.9) o, para el texto reinsertado, una cadena ya armada. */
export type ContenidoExportable = RenderedOutput | string;

export type ClaseDescarga = 'anonimizado' | 'reinsertado' | 'informe' | 'tabla';
export type ExtensionDescarga = 'txt' | 'docx' | 'pdf' | 'json' | 'siglow';

export interface OpcionesExportacion {
  /** `anonimizado` (por defecto) o `reinsertado`: solo cambia el nombre del archivo. */
  clase?: 'anonimizado' | 'reinsertado';
  /** Reloj inyectable para las pruebas; el nombre usa la hora local del equipo. */
  ahora?: Date;
}

export interface ResultadoExportacion {
  /** Nombre neutro con el que se descargó (6.9). */
  nombre: string;
  /** Tamaño del archivo en bytes. */
  bytes: number;
  /** `CARACTERES_CONTROL` con su conteo si se quitaron caracteres no válidos en XML al escribir el .docx; vacío en el .txt. */
  avisos: ParseWarning[];
}

/** 6.9: nombres neutros; nunca el original, el código del asunto ni nombres de partes. F4 (D-22) suma el PDF anonimizado. */
export const NOMBRE_DESCARGA =
  /^sig-low-(?:(?:anonimizado|reinsertado)-\d{8}-\d{4}\.(?:txt|docx|pdf)|informe-\d{8}-\d{4}\.(?:json|txt)|tabla-\d{8}-\d{4}\.siglow)$/;

const dos = (n: number): string => String(n).padStart(2, '0');

/** `sig-low-<clase>-AAAAMMDD-HHMM.<ext>` con la fecha y la hora locales de `ahora`. Una combinación fuera de 6.9 lanza `ERROR_INTERNO`. */
export function nombreDescarga(clase: ClaseDescarga, extension: ExtensionDescarga, ahora: Date = new Date()): string {
  const fecha = `${String(ahora.getFullYear()).padStart(4, '0')}${dos(ahora.getMonth() + 1)}${dos(ahora.getDate())}`;
  const hora = `${dos(ahora.getHours())}${dos(ahora.getMinutes())}`;
  const nombre = `sig-low-${clase}-${fecha}-${hora}.${extension}`;
  if (!NOMBRE_DESCARGA.test(nombre)) throw new SiglowError('ERROR_INTERNO');
  return nombre;
}

/** Texto plano del contenido con el salto de línea pedido (todo salto de la cadena pasa a `eol`). */
export function textoDeContenido(contenido: ContenidoExportable, eol: '\n' | '\r\n'): string {
  if (typeof contenido === 'string') return contenido.replace(/\r\n|\r|\n/gu, eol);
  return joinOutput(contenido, eol);
}

/** 6.9.1: `U+FEFF + joinOutput(out, '\r\n') + '\r\n'`, en UTF-8. Empieza por `EF BB BF` y no tiene `\n` sin `\r` delante (INV-X02). */
export function construirTxt(contenido: ContenidoExportable): Uint8Array {
  return new TextEncoder().encode('\uFEFF' + textoDeContenido(contenido, '\r\n') + '\r\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// Descarga y registro de URL `blob:` vivas (3.8, V-36, V-48)
// ---------------------------------------------------------------------------------------------------------------------
const urlsVivas = new Set<string>();

/** Cantidad de URL `blob:` creadas por una descarga y aún sin revocar (debe ser 0 entre descargas, INV-X06). */
export function urlsBlobVivas(): number {
  return urlsVivas.size;
}

/** Revoca todas las URL `blob:` que queden. Las llaman el bloqueo y `pagehide` (6.6.5). */
export function revocarUrlsVivas(): void {
  for (const url of urlsVivas) URL.revokeObjectURL(url);
  urlsVivas.clear();
}

/**
 * Descarga `bytes` con un `<a download>`. Todo ocurre en el mismo manejador, de forma síncrona: Blob, URL, `click()` y, justo
 * después de `click()`, `URL.revokeObjectURL(url)` y el retiro del `<a>`. La revocación está en `finally`: no queda URL viva ni
 * si el clic falla.
 */
export function descargarBytes(bytes: Uint8Array, mime: string, nombre: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  urlsVivas.add(url);
  let ancla: HTMLAnchorElement | undefined;
  try {
    ancla = document.createElement('a');
    ancla.href = url;
    ancla.download = nombre;
    ancla.rel = 'noopener';
    ancla.hidden = true;
    document.body.append(ancla);
    ancla.click();
  } finally {
    URL.revokeObjectURL(url);
    urlsVivas.delete(url);
    ancla?.remove();
  }
}

export const MIME_TXT = 'text/plain;charset=utf-8';

/**
 * Exporta y descarga el contenido como `.txt` UTF-8 con BOM y CRLF (6.9.1), con nombre neutro. Síncrona; PC-5 la llama en el
 * manejador del clic de «Descargar .txt», detrás de `exportGate.ok`.
 */
export function exportarTxt(contenido: ContenidoExportable, opciones: OpcionesExportacion = {}): ResultadoExportacion {
  const bytes = construirTxt(contenido);
  const nombre = nombreDescarga(opciones.clase ?? 'anonimizado', 'txt', opciones.ahora);
  descargarBytes(bytes, MIME_TXT, nombre);
  return { nombre, bytes: bytes.length, avisos: [] };
}
