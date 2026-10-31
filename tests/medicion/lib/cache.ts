// Caché de salidas del modelo por vista (plan 10.3.3 y 9.5). Solo Node.
//
// Formato que lee `npm run medir` (lo escriben PF-3 para la vista natural y PF-4a / PF-4b para las demás):
//
//   metricas/modelo-<id>-<vista>.json      <id> = x-large | x-base; <vista> = natural | mayusculas | minusculas
//   {
//     "formato": "sig-low/cache-modelo", "v": 1,
//     "modelo": "x-large", "vista": "natural",
//     "piso": 0.1,                                   // puntaje mínimo guardado
//     "huella": { "texto": "<sha256>", "vista": "<sha256>", "onnx": "<sha256>", "codigo": "<sha256>" },
//     "carga": { ...NerLoadResult },                 // opcional: lo que informó el motor al cargar
//     "documentos": {
//       "C10": { "partes": { "cuerpo:1": { "sha256": "<sha256 del texto canónico de la parte>",   // opcional: se verifica
//                                         "ventanas": [ { "windowIndex": 0, "windowTotal": 3, "ms": 5040,
//                                                         "spans": [ { "start": 12, "end": 30, "label": "PER", "score": 0.97 } ] } ] } } }
//     }
//   }
//
// Las posiciones son del texto canónico de la parte (la vista MAYÚSCULAS o minúsculas conserva la longitud, INV-W04). La clave de
// parte es `claveParte` (`<kind>:<index>` y `:p<n>` si hay página). Sin texto del documento: solo posiciones y puntajes.
//
// Caché única (P0-4): el archivo combinado `metricas/modelo-<id>-vistas.json` (`"vistas": { "<vista>": <cuerpo> }`, lo dejan PF-4a y
// PF-4b con las tres vistas de los 29 documentos medibles y la verificación T-AB-06) se lee primero; el archivo por vista solo cuenta si
// el combinado no existe o no trae esa vista. Así una pasada suelta de una vista (p. ej. `calibrar-modelo.ts pasada`, que escribe
// `modelo-<id>-natural.json`) no tapa la caché verificada. La caché natural de PF-3 (19 documentos, texto anterior a PG-1a-r1 y PG-2-r1)
// queda como histórico en `metricas/historico/pf3-x-large-natural.json`, fuera del patrón que lee este módulo.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NerLoadResult, NerSpan } from '../../../src/core/types.ts';
import type { RunConfig, RunVista } from '../../../scripts/metrics.ts';
import { RAIZ } from './corpus.ts';
import type { DocCorpus } from './corpus.ts';

export interface VentanaCache { windowIndex: number; windowTotal: number; ms?: number; spans: NerSpan[] }
export interface ParteCache { sha256?: string; ventanas: VentanaCache[] }
export interface DocumentoCache { partes: Record<string, ParteCache> }
export interface CacheModelo {
  formato: 'sig-low/cache-modelo'; v: 1;
  modelo: 'x-large' | 'x-base'; vista: RunVista; piso: number;
  huella: { texto: string; vista: string; onnx: string; codigo: string };
  carga?: NerLoadResult;
  documentos: Record<string, DocumentoCache>;
}

export const sha256 = (t: string): string => createHash('sha256').update(t).digest('hex');
const ES_ETIQUETA: ReadonlySet<string> = new Set(['PER', 'ORG', 'LOC', 'OTH', 'DATE']);
const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export class CacheInvalida extends Error {
  readonly problemas: string[];
  constructor(problemas: string[]) {
    super('CACHE_INVALIDA');
    this.name = 'CacheInvalida';
    this.problemas = problemas;
  }
}

/** Id del modelo de la caché para una configuración de la corrida (`sin-modelo` no usa caché). */
export const modeloDeConfig = (c: RunConfig): 'x-large' | 'x-base' | null => (c === 'sin-modelo' ? null : c);

/** Rutas candidatas en orden de lectura: primero el archivo combinado de las tres vistas (la caché única), después el de la vista. */
export function rutaCache(config: RunConfig, vista: RunVista, carpeta: string = join(RAIZ, 'metricas')): string[] {
  const m = modeloDeConfig(config);
  if (m === null) return [];
  return [join(carpeta, `modelo-${m}-vistas.json`), join(carpeta, `modelo-${m}-${vista}.json`)];
}

/** Valida la forma de la caché y, contra el corpus, que las posiciones caben en el texto y que la huella de cada parte coincide. */
export function validarCache(c: unknown, corpus: readonly DocCorpus[], vista: RunVista): CacheModelo {
  const problemas: string[] = [];
  if (!esObjeto(c) || c['formato'] !== 'sig-low/cache-modelo' || c['v'] !== 1) throw new CacheInvalida(['formato']);
  if (c['vista'] !== vista) problemas.push(`vista:${String(c['vista'])}`);
  if (c['modelo'] !== 'x-large' && c['modelo'] !== 'x-base') problemas.push('modelo');
  if (typeof c['piso'] !== 'number' || !(c['piso'] >= 0 && c['piso'] <= 1)) problemas.push('piso');
  const h = c['huella'];
  if (!esObjeto(h) || ['texto', 'vista', 'onnx', 'codigo'].some((k) => typeof h[k] !== 'string')) problemas.push('huella');
  const docs = c['documentos'];
  if (!esObjeto(docs)) throw new CacheInvalida([...problemas, 'documentos']);
  for (const dc of corpus) {
    const d = docs[dc.docId];
    if (!esObjeto(d) || !esObjeto(d['partes'])) { problemas.push(`${dc.docId}:sin_documento`); continue; }
    const partes = d['partes'];
    for (const p of dc.doc.parts) {
      const clave = dc.claveDe.get(p.id) as string;
      const pc = partes[clave];
      if (!esObjeto(pc) || !Array.isArray(pc['ventanas'])) { problemas.push(`${dc.docId}:${clave}:sin_parte`); continue; }
      if (typeof pc['sha256'] === 'string' && pc['sha256'] !== sha256(p.text)) problemas.push(`${dc.docId}:${clave}:huella_texto`);
      for (const v of pc['ventanas'] as unknown[]) {
        if (!esObjeto(v) || !Number.isInteger(v['windowIndex']) || !Number.isInteger(v['windowTotal']) || !Array.isArray(v['spans'])) {
          problemas.push(`${dc.docId}:${clave}:ventana`);
          continue;
        }
        for (const s of v['spans'] as unknown[]) {
          const ok = esObjeto(s) && Number.isInteger(s['start']) && Number.isInteger(s['end']) && (s['start'] as number) >= 0
            && (s['end'] as number) > (s['start'] as number) && (s['end'] as number) <= p.text.length
            && typeof s['label'] === 'string' && ES_ETIQUETA.has(s['label']) && typeof s['score'] === 'number' && s['score'] >= 0 && s['score'] <= 1;
          if (!ok) problemas.push(`${dc.docId}:${clave}:tramo`);
        }
      }
    }
  }
  if (problemas.length > 0) throw new CacheInvalida(problemas);
  return c as unknown as CacheModelo;
}

/** Lee la caché de (config, vista). Devuelve null si el archivo no existe; lanza `CacheInvalida` si existe pero no sirve. */
export function leerCache(config: RunConfig, vista: RunVista, corpus: readonly DocCorpus[], carpeta?: string): CacheModelo | null {
  for (const ruta of rutaCache(config, vista, carpeta)) {
    if (!existsSync(ruta)) continue;
    let datos: unknown;
    try {
      datos = JSON.parse(readFileSync(ruta, 'utf8'));
    } catch {
      throw new CacheInvalida(['json']);
    }
    if (esObjeto(datos) && esObjeto(datos['vistas'])) datos = datos['vistas'][vista];
    if (datos === undefined) continue;
    return validarCache(datos, corpus, vista);
  }
  return null;
}
