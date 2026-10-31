// La corrida real de `npm run medir` (T-ME-02, T-ME-03, T-ME-05 y T-RS-19): lee SIGLOW_MEDIR_* del entorno que fija scripts/medir.ts,
// corre el motor sobre el texto canónico (con la caché de salidas del modelo si la configuración la pide), escribe
// `corpus/resultados/AAAAMMDD-HHMM-<config>-<vista>-<hilos>h.json` e imprime la tabla. Se omite si no la lanzó `medir`.
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { codigoDeSalida, tablaTexto } from '../../scripts/metrics.ts';
import type { RunConfig, RunVista } from '../../scripts/metrics.ts';
import { CacheInvalida, leerCache, modeloDeConfig } from './lib/cache.ts';
import type { CacheModelo } from './lib/cache.ts';
import { RAIZ, cargarCorpus } from './lib/corpus.ts';
import type { Conjunto } from './lib/corpus.ts';
import { correr, escribirInforme } from './lib/corrida.ts';
import type { Corrida } from './lib/corrida.ts';

const activo = process.env['SIGLOW_MEDIR'] === '1';
const config = (process.env['SIGLOW_MEDIR_CONFIG'] ?? 'sin-modelo') as RunConfig;
const vista = (process.env['SIGLOW_MEDIR_VISTA'] ?? 'natural') as RunVista;
const hilos = Number(process.env['SIGLOW_MEDIR_HILOS'] ?? '8') as 1 | 4 | 8;
const conjunto = (process.env['SIGLOW_MEDIR_CONJUNTO'] ?? 'todo') as Conjunto;
const rapido = process.env['SIGLOW_MEDIR_RAPIDO'] === '1';
const carpeta = process.env['SIGLOW_MEDIR_SALIDA'] ?? join(RAIZ, 'corpus', 'resultados');
const T = modeloDeConfig(config) === null ? 'T-ME-02' : 'T-ME-03';

describe.skipIf(!activo)(`medición · ${config} · vista ${vista} · ${hilos} hilos · conjunto ${conjunto}${rapido ? ' · rápida' : ''}`, () => {
  let c: Corrida;
  let cache: CacheModelo | null = null;

  beforeAll(async () => {
    // La medición rápida (`medir:rapido`) corre reglas y lista sobre los .txt, sin oráculo (10.3.3).
    const corpus = cargarCorpus(conjunto).filter((d) => !rapido || (d.gold as { fuente?: string } & typeof d.gold).fuente === 'txt');
    if (modeloDeConfig(config) !== null) {
      try {
        cache = leerCache(config, vista, corpus);
      } catch (e) {
        throw new Error(`caché inválida (${e instanceof CacheInvalida ? e.problemas.slice(0, 5).join(' ') : 'ilegible'})`);
      }
      if (cache === null) throw new Error(`falta metricas/modelo-${modeloDeConfig(config)}-${vista}.json (lo dejan PF-3 y PF-4a): la corrida con modelo no se cuenta como cumplida`);
    }
    c = await correr({ config, vista, hilos, conjunto, corpus, cache, oraculo: !rapido });
    const ruta = escribirInforme(c.informe, carpeta);
    process.stdout.write(`${tablaTexto(c.informe)}\ninforme: ${ruta}\n`);
  }, 3_600_000);

  it(`${T} escribe el informe de los documentos medibles con el nombre de 10.3.3`, () => {
    expect(c.informe.formato).toBe('sig-low/metricas');
    expect(c.informe.corrida).toMatchObject({ config, vista, hilos, conjunto });
    expect(c.informe.tiempos.length).toBeGreaterThan(0);
    if (modeloDeConfig(config) !== null) expect(c.informe.tiempos.every((t) => (t.ventanas ?? 0) > 0)).toBe(true);
  });

  it.skipIf(rapido)('T-ME-05 el bucle de residuos converge en ≤ 5 vueltas y la última da 0 hallazgos INV-G08 INV-R07', () => {
    for (const [id, o] of c.oraculo) expect(o.convergio && o.vueltas <= 5, `${id} no convergió en 5 vueltas`).toBe(true);
    expect(c.informe.residuos.despuesDelBucle).toBe(0);
  });

  // Con modelo se exige la condición dura del corpus. Sin modelo es la línea base: las formas que solo el modelo reconoce quedan copiadas.
  it.skipIf(rapido || modeloDeConfig(config) === null)('T-RS-19 0 residuos en los documentos medibles tras el bucle y concordanciaResidueTs = true INV-G08 INV-R07', () => {
    const con = c.informe.residuos.porDocumento.filter((d) => d.residuos > 0).map((d) => `${d.docId}:${d.idsAnotacion.join(',')}`);
    expect(con).toEqual([]);
    expect(c.informe.residuos.concordanciaResidueTs).toBe(true);
    expect(codigoDeSalida(c.informe)).toBe(0);
  });
});
