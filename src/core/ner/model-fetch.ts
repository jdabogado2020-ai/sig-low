/**
 * Descarga verificada de los artefactos del modelo (V-44, 3.3). Código propio de Sig-Low.
 *
 * `fetchVerificado` solo admite rutas del manifiesto, obtiene los bytes con un `Fetcher` inyectado (la única
 * llamada de red vive en `ner.worker.ts`, F-01), comprueba tamaño y SHA-256 de los mismos bytes que luego
 * recibirá ORT (un solo `Uint8Array`, sin copia intermedia) y rechaza con `MODELO_INTEGRIDAD` si algo no coincide.
 */

import { SiglowError, type ModelManifest } from '../types';

/** Obtiene una ruta relativa al modelo (p. ej. `tokenizer.json`) en un `Uint8Array` de `tamano` bytes. */
export type Fetcher = (
  ruta: string,
  tamano: number,
  onBytes: (acumulado: number) => void,
) => Promise<Uint8Array>;

export interface ArchivoDelManifiesto { ruta: string; tamano: number; sha256: string }

/** Archivos que el motor puede pedir: el modelo reensamblado y los auxiliares. Los trozos los sirve el service worker. */
export function archivosPermitidos(manifest: ModelManifest): Map<string, ArchivoDelManifiesto> {
  const m = new Map<string, ArchivoDelManifiesto>();
  m.set(manifest.archivo, { ruta: manifest.archivo, tamano: manifest.tamano, sha256: manifest.sha256 });
  for (const a of manifest.auxiliares) m.set(a.ruta, a);
  return m;
}

const HEX = '0123456789abcdef';

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  let out = '';
  for (const b of digest) out += HEX[b >> 4]! + HEX[b & 15]!;
  return out;
}

export async function fetchVerificado(
  manifest: ModelManifest,
  ruta: string,
  fetcher: Fetcher,
  onBytes: (acumulado: number) => void = () => undefined,
): Promise<Uint8Array> {
  const esperado = archivosPermitidos(manifest).get(ruta);
  if (!esperado) throw new SiglowError('ENTRADA_INVALIDA');
  let bytes: Uint8Array;
  try {
    bytes = await fetcher(ruta, esperado.tamano, onBytes);
  } catch (e) {
    if (e instanceof SiglowError) throw e;
    throw new SiglowError('MODELO_NO_DESCARGADO');
  }
  if (bytes.byteLength !== esperado.tamano) throw new SiglowError('MODELO_INTEGRIDAD');
  if ((await sha256Hex(bytes)) !== esperado.sha256.toLowerCase()) throw new SiglowError('MODELO_INTEGRIDAD');
  return bytes;
}
