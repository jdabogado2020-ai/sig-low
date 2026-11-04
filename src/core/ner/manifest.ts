/**
 * Validación estricta del manifiesto del modelo (6.11.3; hallazgo B-8 de P0-6a) y reglas de su entrega (3.3). Código propio.
 *
 * Es la única definición de «manifiesto válido»: la usan el manejador del worker `ner`, el service worker (que arma con ella
 * la lista blanca de rutas del modelo) y la interfaz. TypeScript puro: sin DOM ni red.
 */

import type { ModelManifest } from '../types';

export const IDS_MODELO = ['gliner-x-large', 'gliner-x-base'] as const;
export type IdModelo = (typeof IDS_MODELO)[number];

/** Límite por trozo: 8 MiB (F11: un corte cuesta como mucho 8 MiB; antes, 24 MiB). El alojamiento admite 25 MiB por archivo (3.3). */
export const MAX_TROZO = 8_388_608;
/** Ningún archivo de `dist/` ni de `public/models/` pasa de 25 MiB (9.3, PF-2). */
export const MAX_ARCHIVO_DIST = 26_214_400;
export const RUTA_ONNX = 'onnx/model_quantized.onnx';

const HEX64 = /^[0-9a-f]{64}$/;
export const RUTA_AUXILIAR = /^(tokenizer|tokenizer_config|gliner_config)\.json$/;
export const RUTA_TROZO = /^onnx\/model_quantized\.onnx\.part\d{3}$/;

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const esEntero = (x: unknown, min = 0): x is number => typeof x === 'number' && Number.isInteger(x) && x >= min;

/** `ruta`, `tamano` entero ≥ 1 y `sha256` de 64 hexadecimales en minúsculas; la ruta con el patrón dado. */
function esArchivo(x: unknown, patron: RegExp, maximo = Number.MAX_SAFE_INTEGER): boolean {
  return (
    esObjeto(x) &&
    typeof x['ruta'] === 'string' &&
    patron.test(x['ruta']) &&
    esEntero(x['tamano'], 1) &&
    x['tamano'] <= maximo &&
    typeof x['sha256'] === 'string' &&
    HEX64.test(x['sha256'])
  );
}

/**
 * Forma del manifiesto que necesita el worker. B-8: cada `auxiliares[].ruta` es una de las tres permitidas (sin `/` ni `..`),
 * `tamano` entero ≥ 1 y `sha256` de 64 hexadecimales; lo mismo para los trozos si vienen (el motor no los usa y puede
 * recibir un manifiesto sin ellos; la entrega los exige con `validarEntrega`).
 */
export const esManifiesto = (x: unknown): x is ModelManifest =>
  esObjeto(x) &&
  x['formato'] === 'sig-low/modelo' &&
  x['v'] === 1 &&
  (x['id'] === 'gliner-x-large' || x['id'] === 'gliner-x-base') &&
  x['archivo'] === RUTA_ONNX &&
  esEntero(x['tamano'], 1) &&
  typeof x['sha256'] === 'string' &&
  HEX64.test(x['sha256']) &&
  Array.isArray(x['auxiliares']) &&
  x['auxiliares'].every((a) => esArchivo(a, RUTA_AUXILIAR)) &&
  (x['trozos'] === undefined || (Array.isArray(x['trozos']) && x['trozos'].every((t) => esArchivo(t, RUTA_TROZO, MAX_TROZO)))) &&
  esObjeto(x['tokenizador']) &&
  esEntero(x['tokenizador']['prefijo']) &&
  esEntero(x['tokenizador']['sufijo']) &&
  typeof x['tokenizador']['cls'] === 'boolean' &&
  esEntero(x['ventanaTokens'], 1) &&
  esEntero(x['solapePalabras']) &&
  typeof x['umbral'] === 'number' &&
  Array.isArray(x['etiquetas']);

/**
 * Manifiesto apto para descargar y servir: además de `esManifiesto`, trozos numerados 000, 001, … sin huecos, cada uno de
 * ≤ 8 MiB, cuya suma es `tamano`; los dos auxiliares que el motor necesita
 * (`tokenizer.json` y `tokenizer_config.json`); y la base de mT5 que corresponde al id.
 */
export function validarEntrega(m: ModelManifest): boolean {
  if (!esManifiesto(m) || !Array.isArray(m.trozos) || m.trozos.length === 0) return false;
  if (m.base !== (m.id === 'gliner-x-large' ? 'google/mt5-large' : 'google/mt5-base')) return false;
  let suma = 0;
  for (let i = 0; i < m.trozos.length; i += 1) {
    const t = m.trozos[i]!;
    if (t.ruta !== `${RUTA_ONNX}.part${String(i).padStart(3, '0')}`) return false;
    suma += t.tamano;
  }
  if (suma !== m.tamano) return false;
  const rutas = m.auxiliares.map((a) => a.ruta);
  return new Set(rutas).size === rutas.length && rutas.includes('tokenizer.json') && rutas.includes('tokenizer_config.json');
}

/** Rutas relativas a `/models/<id>/` que la descarga pide a la red: primero los auxiliares y luego los trozos. */
export const rutasDeDescarga = (m: ModelManifest): string[] => [...m.auxiliares.map((a) => a.ruta), ...m.trozos.map((t) => t.ruta)];

/** Ruta del sitio de un archivo del modelo. `ruta` ya viene validada contra el manifiesto. */
export const urlDeModelo = (id: IdModelo, ruta: string): string => `/models/${id}/${ruta}`;

/** Bytes que ocupa el modelo guardado: los trozos (= `tamano`) más los auxiliares. */
export const bytesGuardados = (m: ModelManifest): number => m.tamano + m.auxiliares.reduce((s, a) => s + a.tamano, 0);

/** Tamaño que muestra la tarjeta (8.2.2): `Math.round((tamano + Σ auxiliares.tamano) / 1 000 000)` MB. */
export const mbDelManifiesto = (m: ModelManifest): number => Math.round(bytesGuardados(m) / 1_000_000);

/** Nombre de la caché del modelo (3.2): `siglow-modelo-<sha256 del ONNX reensamblado>`. */
export const cacheDelModelo = (m: ModelManifest): string => `siglow-modelo-${m.sha256}`;
