// T-ME-03 · corrida con el modelo grande desde la caché de salidas, en las tres vistas. Aquí la caché es SIMULADA (tramos del gold con una
// pérdida determinista por vista, lib/cache-simulada.ts): comprueba el camino completo (caché -> ventanas -> `fusionar` ->
// `incorporar_modelo` -> oráculo -> filas por vista). Con la caché real de PF-3 y PF-4a, `npm run medir` corre el mismo camino
// (motor-medicion.test.ts). Datos ficticios.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codigoDeSalida } from '../../scripts/metrics.ts';
import type { MetricsReport, RunVista } from '../../scripts/metrics.ts';
import { CacheInvalida, leerCache, validarCache } from './lib/cache.ts';
import { cacheSimulada } from './lib/cache-simulada.ts';
import { cargarCorpus } from './lib/corpus.ts';
import { correr } from './lib/corrida.ts';
import type { Corrida } from './lib/corrida.ts';

const corpus = cargarCorpus('todo');
const VISTAS: RunVista[] = ['natural', 'mayusculas', 'minusculas'];
const corridas = new Map<RunVista, Corrida>();
let base: Corrida;
let tmp: string;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'siglow-cache-'));
  base = await correr({ config: 'sin-modelo', vista: 'natural', corpus, oraculo: false });
  for (const v of VISTAS) {
    corridas.set(v, await correr({ config: 'x-large', vista: v, corpus, cache: cacheSimulada(corpus, v), oraculo: v === 'natural' }));
  }
}, 1_800_000);
afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

const fila = (r: MetricsReport, g: string): MetricsReport['filas'][number] => {
  const f = r.filas.find((x) => x.grupo === g);
  if (f === undefined) throw new Error(`sin fila ${g}`);
  return f;
};
const informe = (v: RunVista): MetricsReport => (corridas.get(v) as Corrida).informe;

describe('T-ME-03 · corrida con el modelo grande desde la caché de salidas (tres vistas)', () => {
  it('T-ME-03 cada vista da su informe con el modelo, las ventanas incorporadas y las filas por vista', () => {
    for (const v of VISTAS) {
      const r = informe(v);
      expect(r.corrida).toMatchObject({ config: 'x-large', vista: v });
      expect(r.corrida.modelo?.engineId).toBe('gliner-x-large');
      expect(r.filas.map((f) => f.grupo)).toEqual(expect.arrayContaining([`PERSONA_FUERA@${v}`, `ORG_FUERA@${v}`]));
      expect(r.tiempos.every((t) => (t.ventanas ?? 0) > 0 && t.modeloMs !== null)).toBe(true);
    }
  });

  // La cifra absoluta depende del motor (p. ej. una variante de la lista que parte un nombre completo); aquí solo importa el sentido.
  it('T-ME-03 el modelo sube la exhaustividad de personas fuera de la lista frente a la corrida sin modelo', () => {
    const sin = fila(base.informe, 'PERSONA_FUERA').exhaustividadMencion;
    const con = fila(informe('natural'), 'PERSONA_FUERA').exhaustividadMencion;
    expect(con).toBeGreaterThan(sin);
  });

  it('T-ME-03 las filas por vista distinguen las vistas: natural > MAYÚSCULAS > minúsculas (pérdida simulada)', () => {
    const e = (v: RunVista): number => fila(informe(v), `PERSONA_FUERA@${v}`).exhaustividadMencion;
    expect(e('natural')).toBeGreaterThan(e('mayusculas'));
    expect(e('mayusculas')).toBeGreaterThan(e('minusculas'));
    // La fila por vista es la misma medición que la fila de personas fuera de la lista de esa corrida.
    for (const v of VISTAS) expect(fila(informe(v), `PERSONA_FUERA@${v}`)).toMatchObject({ ...fila(informe(v), 'PERSONA_FUERA'), grupo: `PERSONA_FUERA@${v}` });
    // Las organizaciones no se pierden en la simulación: su fila no cambia entre vistas.
    expect(fila(informe('mayusculas'), 'ORG_FUERA@mayusculas').exhaustividadMencion).toBe(fila(informe('natural'), 'ORG_FUERA@natural').exhaustividadMencion);
  });

  it('T-ME-03 ninguna fila guarda valores del gold: solo ids de anotación', () => {
    const r = informe('mayusculas');
    const texto = JSON.stringify(r);
    for (const f of r.filas) for (const id of f.idsNoCubiertas ?? []) expect(id).toMatch(/^C\d\d-A\d+$/u);
    const valores = new Set(corpus.flatMap((d) => d.gold.anotaciones.filter((g) => g.texto.length >= 8 && /\p{L}/u.test(g.texto)).map((g) => g.texto)));
    for (const v of valores) expect(texto.includes(v)).toBe(false);
  });
});

describe('T-ME-05 · con la caché del modelo', () => {
  const natural = (): Corrida => corridas.get('natural') as Corrida;

  it('T-ME-05 el bucle converge en ≤ 5 vueltas en cada documento INV-G08 INV-R07', () => {
    for (const [id, o] of natural().oraculo) {
      expect(o.convergio, `${id} no convergió`).toBe(true);
      expect(o.vueltas, `${id} vueltas`).toBeLessThanOrEqual(5);
    }
    expect(natural().informe.residuos.despuesDelBucle).toBe(0);
  });

  it('T-ME-05 el código de salida es 1 mientras haya residuos o discordancia, y 0 cuando no', () => {
    const r = natural().informe;
    const residuos = r.residuos.porDocumento.reduce((s, d) => s + d.residuos, 0);
    expect(codigoDeSalida(r)).toBe(residuos > 0 || !r.residuos.concordanciaResidueTs ? 1 : 0);
  });
});

describe('T-ME-03 · lectura y validación de la caché', () => {
  it('T-ME-03 una caché por vista se lee de metricas/modelo-<id>-<vista>.json y se valida contra el texto canónico', () => {
    const carpeta = join(tmp, 'metricas');
    mkdirSync(carpeta, { recursive: true });
    writeFileSync(join(carpeta, 'modelo-x-large-natural.json'), JSON.stringify(cacheSimulada(corpus, 'natural')));
    const c = leerCache('x-large', 'natural', corpus, carpeta);
    expect(c?.vista).toBe('natural');
    expect(leerCache('x-large', 'mayusculas', corpus, carpeta)).toBeNull();
    expect(leerCache('sin-modelo', 'natural', corpus, carpeta)).toBeNull();
  });

  it('T-ME-03 un archivo combinado con vistas también se acepta', () => {
    const carpeta = join(tmp, 'combinada');
    mkdirSync(carpeta, { recursive: true });
    writeFileSync(join(carpeta, 'modelo-x-large-vistas.json'), JSON.stringify({ vistas: { mayusculas: cacheSimulada(corpus, 'mayusculas') } }));
    expect(leerCache('x-large', 'mayusculas', corpus, carpeta)?.vista).toBe('mayusculas');
  });

  // P0-4: la caché única. Una caché por vista vieja (otro texto, como la natural de PF-3 tras PG-1a-r1 y PG-2-r1) no tapa el archivo combinado.
  it('T-ME-03 con el archivo combinado y uno por vista, se lee el combinado; el de la vista solo cubre la vista que al combinado le falte', () => {
    const carpeta = join(tmp, 'ambas');
    mkdirSync(carpeta, { recursive: true });
    const vieja = structuredClone(cacheSimulada(corpus, 'natural'));
    const doc = corpus[0]!;
    const clave = [...doc.claveDe.values()][0]!;
    (vieja.documentos[doc.docId]!.partes[clave] as { sha256?: string }).sha256 = 'x'.repeat(64);   // texto anterior: la sola lectura la rechazaría
    writeFileSync(join(carpeta, 'modelo-x-large-natural.json'), JSON.stringify(vieja));
    writeFileSync(join(carpeta, 'modelo-x-large-vistas.json'), JSON.stringify({ vistas: { natural: cacheSimulada(corpus, 'natural') } }));
    expect(leerCache('x-large', 'natural', corpus, carpeta)?.vista).toBe('natural');   // no lanza CACHE_INVALIDA: se tomó el combinado
    writeFileSync(join(carpeta, 'modelo-x-large-minusculas.json'), JSON.stringify(cacheSimulada(corpus, 'minusculas')));
    expect(leerCache('x-large', 'minusculas', corpus, carpeta)?.vista).toBe('minusculas');   // el combinado no trae minúsculas
    rmSync(join(carpeta, 'modelo-x-large-vistas.json'));
    expect(() => leerCache('x-large', 'natural', corpus, carpeta)).toThrow(CacheInvalida);   // sin combinado, la vieja se lee y se rechaza
  });

  it('T-ME-03 una caché con la huella del texto cambiada, un tramo fuera de rango o otra vista se declara inválida', () => {
    const buena = cacheSimulada(corpus, 'natural');
    expect(() => validarCache(buena, corpus, 'natural')).not.toThrow();
    expect(() => validarCache(buena, corpus, 'mayusculas')).toThrow(CacheInvalida);
    const mala = structuredClone(buena);
    const doc = corpus[0]!;
    const clave = [...doc.claveDe.values()][0]!;
    (mala.documentos[doc.docId]!.partes[clave] as { sha256?: string }).sha256 = 'x'.repeat(64);
    expect(() => validarCache(mala, corpus, 'natural')).toThrow(CacheInvalida);
    const fuera = structuredClone(buena);
    fuera.documentos[doc.docId]!.partes[clave]!.ventanas[0]!.spans.push({ start: 0, end: 10_000_000, label: 'PER', score: 0.9 });
    expect(() => validarCache(fuera, corpus, 'natural')).toThrow(CacheInvalida);
  });

  it('T-ME-03 sin caché, una corrida con modelo no arranca (no se cuenta como cumplida)', async () => {
    await expect(correr({ config: 'x-large', vista: 'natural', corpus: corpus.slice(0, 1), cache: null })).rejects.toThrow('medicion:cache_ausente');
  });
});
