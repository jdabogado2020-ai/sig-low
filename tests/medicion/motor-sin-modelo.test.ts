// T-ME-02 (corrida sin modelo), T-ME-05 (revisión simulada y escáner independiente) y T-RS-19 (condición del corpus).
// Corren sin modelo sobre el texto canónico de los documentos medibles (`npm run medir`). Datos ficticios.
//
// Sin modelo, las menciones que solo el modelo puede reconocer (formas cortas de una organización, nombres completos de una
// persona de la lista) quedan copiadas aunque el motor conozca la entidad: son residuos por definición (10.3.4) y el escáner
// independiente los ve aunque `residue.ts` no pueda buscarlos. Por eso aquí se prueba la mecánica y se informa la línea base; la
// condición de «0 residuos y concordancia» se exige con la caché del modelo (motor-con-cache.test.ts y la corrida de P0-4).
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { codigoDeSalida, tablaTexto } from '../../scripts/metrics.ts';
import { cargarCorpus } from './lib/corpus.ts';
import type { Conjunto } from './lib/corpus.ts';
import { correr, escribirInforme } from './lib/corrida.ts';
import type { Corrida } from './lib/corrida.ts';
import { MAX_VUELTAS } from './lib/oraculo.ts';

const conjunto = (process.env['SIGLOW_MEDIR_CONJUNTO'] ?? 'todo') as Conjunto;
const salida = process.env['SIGLOW_MEDIR_SALIDA'] ?? join(tmpdir(), 'siglow-medir');
const corpus = cargarCorpus(conjunto);
let c: Corrida;

beforeAll(async () => {
  c = await correr({ config: 'sin-modelo', vista: 'natural', hilos: 8, conjunto, corpus });
}, 1_800_000);

describe('T-ME-02 · corrida sin modelo (reglas y lista, NullNerEngine)', () => {
  it('T-ME-02 hay documentos medibles y el informe los cubre todos (línea base)', () => {
    expect(corpus.length).toBeGreaterThan(0);
    expect(c.informe.formato).toBe('sig-low/metricas');
    expect(c.informe.corrida).toMatchObject({ config: 'sin-modelo', vista: 'natural', conjunto });
    expect(c.informe.tiempos.map((t) => t.docId)).toEqual(corpus.map((d) => d.docId));
    expect(c.informe.global.paginas).toBeGreaterThan(0);
  });

  it('T-ME-02 las filas de 10.4.1 salen con sus n y ningún valor del gold aparece en el informe ni en la tabla', () => {
    const grupos = c.informe.filas.map((f) => f.grupo);
    for (const g of ['CC', 'NIT', 'LISTA', 'PERSONA_FUERA', 'PERSONA_FUERA@natural', 'ORG_FUERA@natural', 'TODOS']) expect(grupos).toContain(g);
    const texto = JSON.stringify(c.informe) + tablaTexto(c.informe);
    const valores = new Set(c.entradas.flatMap((e) => e.gold.anotaciones.filter((g) => g.texto.length >= 8 && /\p{L}/u.test(g.texto)).map((g) => g.texto)));
    for (const v of valores) expect(texto.includes(v), 'un valor del gold salió en el informe').toBe(false);
  });

  it('T-ME-02 sin modelo, las personas fuera de la lista quedan sin cubrir (la línea base es lo que hacen reglas y lista)', () => {
    const f = c.informe.filas.find((x) => x.grupo === 'PERSONA_FUERA');
    expect(f?.n ?? 0).toBeGreaterThan(0);
    expect(f?.exhaustividadMencion ?? 1).toBeLessThan(0.85);
    expect(c.informe.tiempos.every((t) => t.modeloMs === null && t.ventanas === null)).toBe(true);
  });

  it('T-ME-02 escribe el informe con el nombre de 10.3.3', () => {
    const ruta = escribirInforme(c.informe, salida);
    expect(ruta).toMatch(/\d{8}-\d{4}-sin-modelo-natural-8h\.json$/u);
  });
});

describe('T-ME-05 · revisión simulada y escáner independiente', () => {
  it('T-ME-05 el bucle converge en ≤ 5 vueltas en cada documento INV-G08 INV-R07', () => {
    const noConvergen = [...c.oraculo.entries()].filter(([, o]) => !o.convergio || o.vueltas > MAX_VUELTAS).map(([id]) => id);
    expect(noConvergen).toEqual([]);
  });

  it('T-ME-05 la primera vuelta cuenta los hallazgos de residue.ts y la última da 0', () => {
    expect(c.informe.residuos.antesDelBucle).toBeGreaterThanOrEqual(c.informe.residuos.despuesDelBucle);
    expect(c.informe.residuos.despuesDelBucle).toBe(0);
  });

  it('T-ME-05 el reductor no rechaza ninguna decisión del oráculo (salvo las alternativas de bandera y sugerencia, que se toleran)', () => {
    const rechazadas = [...c.oraculo.entries()].flatMap(([id, o]) => o.rechazadas.map((r) => `${id}:${r}`));
    expect(rechazadas).toEqual([]);
  });

});

describe('T-RS-19 · condición del corpus (0 residuos tras el bucle)', () => {
  it('T-RS-19 sin modelo se informa la línea base: cada residuo se lista con su id de anotación y el código de salida es coherente INV-G08 INV-R07', () => {
    const porDoc = c.informe.residuos.porDocumento;
    expect(porDoc.map((d) => d.docId)).toEqual(corpus.map((d) => d.docId));
    for (const d of porDoc) expect(d.idsAnotacion.length).toBe(d.residuos + d.omisiones);
    const residuos = porDoc.reduce((s, d) => s + d.residuos, 0);
    const esperado = residuos > 0 || !c.informe.residuos.concordanciaResidueTs ? 1 : 0;
    expect(codigoDeSalida(c.informe)).toBe(esperado);
  });
});
