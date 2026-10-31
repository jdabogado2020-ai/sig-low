// Una corrida de medición completa (plan 10.3.3): documentos -> motor (con o sin caché) -> oráculo de revisión -> informe.
// Solo Node. Escribe `corpus/resultados/AAAAMMDD-HHMM-<config>-<vista>-<hilos>h.json` si se le pide una carpeta.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { cpus, totalmem, release, type } from 'node:os';
import { join } from 'node:path';
import { construirInforme, nombreInforme } from '../../../scripts/metrics.ts';
import type { EntradaDocumento, MetricsReport, RunConfig, RunVista } from '../../../scripts/metrics.ts';
import type { NerLoadResult } from '../../../src/core/types.ts';
import { modeloDeConfig } from './cache.ts';
import type { CacheModelo } from './cache.ts';
import { RAIZ, cargarCorpus } from './corpus.ts';
import type { Conjunto, DocCorpus } from './corpus.ts';
import { crearMotor, entradaDeEstado, procesarDocumento } from './motor.ts';
import type { DocProcesado } from './motor.ts';
import { conOraculo, revisarConOraculo } from './oraculo.ts';
import type { ResultadoOraculo } from './oraculo.ts';

export interface ArgsCorrida {
  config: RunConfig;
  vista: RunVista;
  hilos?: 1 | 4 | 8;
  conjunto?: Conjunto;
  corpus?: readonly DocCorpus[];
  /** Obligatoria con `config` distinta de `sin-modelo`. */
  cache?: CacheModelo | null;
  /** Corre el oráculo de revisión y la búsqueda de residuos (por defecto sí). */
  oraculo?: boolean;
}

export interface Corrida {
  informe: MetricsReport;
  entradas: EntradaDocumento[];
  procesados: DocProcesado[];
  oraculo: Map<string, ResultadoOraculo>;
}

const hex12 = (t: string): string => createHash('sha256').update(t).digest('hex').slice(0, 12);

/** 12 hex del sha256 de `index.html` del build medido; sin build, de las fuentes de `src/core/` (la huella del motor medido). */
export function huellaCompilacion(raiz: string = RAIZ): string {
  const index = join(raiz, 'dist-medicion', 'index.html');
  if (existsSync(index)) return hex12(readFileSync(index, 'utf8'));
  const h = createHash('sha256');
  const recorrer = (d: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) recorrer(p);
      else if (/\.tsx?$/u.test(n)) h.update(n).update(readFileSync(p));
    }
  };
  recorrer(join(raiz, 'src', 'core'));
  return h.digest('hex').slice(0, 12);
}

export function fechaLocal(d: Date = new Date()): string {
  const z = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}

function cargaDe(cache: CacheModelo | null | undefined, hilos: number): NerLoadResult | null {
  if (cache === null || cache === undefined) return null;
  if (cache.carga !== undefined) return cache.carga;
  return {
    engineId: cache.modelo === 'x-large' ? 'gliner-x-large' : 'gliner-x-base', modelId: null, sha256: null, threads: hilos,
    crossOriginIsolated: false, labels: ['PER', 'ORG', 'LOC'], decoder: 'gliner-spans', loadMs: 0, warmupWindowMs: 0,
  };
}

export async function correr(a: ArgsCorrida): Promise<Corrida> {
  const hilos = a.hilos ?? 8;
  const conjunto = a.conjunto ?? 'todo';
  const corpus = a.corpus ?? cargarCorpus(conjunto);
  if (modeloDeConfig(a.config) !== null && (a.cache === null || a.cache === undefined)) throw new Error('medicion:cache_ausente');
  const motor = crearMotor();
  const procesados: DocProcesado[] = [];
  const entradas: EntradaDocumento[] = [];
  const oraculo = new Map<string, ResultadoOraculo>();
  for (const dc of corpus) {
    const p = await procesarDocumento(motor, dc, a.cache?.documentos[dc.docId]);
    procesados.push(p);
    let e = entradaDeEstado(p);
    if (a.oraculo !== false) {
      const o = await revisarConOraculo({ p, motor });
      oraculo.set(dc.docId, o);
      e = conOraculo(e, o);
    }
    entradas.push(e);
  }
  const informe = construirInforme(entradas, {
    config: a.config, vista: a.vista, hilos, conjunto, compilacion: huellaCompilacion(), modelo: cargaDe(a.cache, hilos),
    navegador: `node ${process.version}`,
    equipo: { nucleosLogicos: cpus().length, memoriaGB: Math.round(totalmem() / 2 ** 30), descripcion: `${type()} ${release()} · ${cpus()[0]?.model ?? 'cpu'}` },
    fecha: fechaLocal(),
  }, { escanerEstricto: true });
  return { informe, entradas, procesados, oraculo };
}

/** Guarda el informe con el nombre de 10.3.3 y devuelve la ruta. */
export function escribirInforme(informe: MetricsReport, carpeta: string): string {
  if (!existsSync(carpeta)) mkdirSync(carpeta, { recursive: true });
  const ruta = join(carpeta, nombreInforme(informe.corrida, informe.corrida.fecha));
  writeFileSync(ruta, `${JSON.stringify(informe, null, 2)}\n`);
  return ruta;
}
