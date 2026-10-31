// T-AB-02 y T-AB-03 (parte PF-3 de tests/medicion/evaluacion-modelo.test.ts; T-AB-01, T-AB-04 y T-AB-06 los agregan PF-4a, PF-4b y P0-4).
// No ejecutan el modelo: leen la caché de salidas (metricas/modelo-x-large-natural.json) y los resultados de scripts/calibrar-modelo.ts,
// y vuelven a calcular de ellos el umbral, el piso de proposición y las latencias. Se corren con `npm run medir`
// (vitest excluye tests/medicion/** de `verify`). Corpus ficticio (10.1.5).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  barridoAlto, cargarCorpus, deteccionesDe, elegirAlto, elegirUmbral, evaluarUmbral, huellaMotor, mediana, percentil, UMBRALES,
} from '../../scripts/calibrar-modelo.ts';
import type { CacheModelo, FilaAlto, FilaUmbral } from '../../scripts/calibrar-modelo.ts';
import type { GoldAnnotation, GoldDocument } from '../../scripts/metrics.ts';
import type { DataType } from '../../src/core/types.ts';

const RAIZ = process.cwd();
const ruta = (r: string): string => join(RAIZ, r);
const leer = <T>(r: string): T => JSON.parse(readFileSync(ruta(r), 'utf8')) as T;

// ---------------------------------------------------------------------------------------------------------------- gold de juguete
function ann(id: string, tipo: DataType, start: number, end: number, entidad: string, enLista = false): GoldAnnotation {
  return {
    id: `T01-${id}`, docId: 'T01', parte: { kind: 'cuerpo', index: 1 }, start, end, texto: 'x'.repeat(end - start), tipo, entidad: `T01-${entidad}`,
    debe_generalizarse: false, es_negativo_esperado: false, estructura: 'no_aplica', enLista, rotulado: false, caracteristicas: [],
  };
}
const GOLD: GoldDocument = {
  docId: 'T01', conjunto: 'desarrollo',
  entidades: [
    { id: 'T01-E1', tipo: 'PERSONA', canonico: 'p', mismoTitular: [], enLista: false },
    { id: 'T01-E2', tipo: 'EPS', canonico: 'e', mismoTitular: [], enLista: false },
    { id: 'T01-E3', tipo: 'LUGAR', canonico: 'l', mismoTitular: [], enLista: false },
  ],
  anotaciones: [ann('A1', 'PERSONA', 0, 10, 'E1'), ann('A2', 'EPS', 20, 30, 'E2'), ann('A3', 'LUGAR', 60, 70, 'E3')],
};
// Tramos del modelo: 0,95 PER verdadero; 0,45 ORG verdadero; 0,35 PER falso; 0,70 LOC verdadero; 0,60 PER falso.
const CACHE: CacheModelo = {
  formato: 'sig-low/cache-modelo', v: 1, modelo: 'x-large', vista: 'natural', etiquetas: 'estandar', piso: 0.1,
  opciones: { windowTokens: 512, overlapWords: 37, maxSpanWords: 12 },
  huella: { texto: 'a', vista: 'b', onnx: 'c', codigo: 'd' },
  corrida: { hilos: 8, navegador: 'prueba', nucleosLogicos: 16, fecha: '2026-10-30 00:00', equipo: 'prueba', conjunto: 'prueba' },
  documentos: {
    T01: {
      partes: {
        'cuerpo:1': {
          sha256: 'x',
          ventanas: [{
            windowIndex: 0, windowTotal: 1,
            spans: [
              { start: 0, end: 10, label: 'PER', score: 0.95 }, { start: 20, end: 30, label: 'ORG', score: 0.45 }, { start: 40, end: 50, label: 'PER', score: 0.35 },
              { start: 60, end: 70, label: 'LOC', score: 0.7 }, { start: 80, end: 90, label: 'PER', score: 0.6 }, { start: 95, end: 99, label: 'PER', score: 0.15 },
            ],
          }],
        },
      },
    },
  },
};

describe('T-AB-03 · calibración del piso de proposición y de la banda media (funciones puras)', () => {
  it('T-AB-03 deteccionesDe recorta por puntaje de forma inclusiva y deja el piso de la caché fuera de las medidas', () => {
    const doc = CACHE.documentos['T01'] as CacheModelo['documentos'][string];
    expect(deteccionesDe(doc, 'T01', 0.1)).toHaveLength(6);
    expect(deteccionesDe(doc, 'T01', 0.3)).toHaveLength(5);
    expect(deteccionesDe(doc, 'T01', 0.45)).toHaveLength(4); // el 0,45 entra: umbral inclusivo (7.10.4)
    expect(deteccionesDe(doc, 'T01', 0.5).map((d) => d.tipo)).toEqual(['PERSONA', 'LUGAR', 'PERSONA']);
  });

  it('T-AB-03 evaluarUmbral da precisión global y F2 de PER y ORG calculados a mano en cada umbral', () => {
    const f = Object.fromEntries(UMBRALES.map((u) => [u, evaluarUmbral(CACHE, { T01: GOLD }, u)]));
    // 0,3: 5 tramos (0,95 PER v, 0,45 ORG v, 0,35 PER f, 0,70 LOC v, 0,60 PER f) → 3 verdaderos de 5 = 0,6
    expect(f[0.3]?.detecciones).toBe(5);
    expect(f[0.3]?.precisionGlobal).toBeCloseTo(0.6, 9);
    // PER+ORG a 0,3: gold 2, cubiertas 2; detecciones 4 (0,95; 0,45; 0,35; 0,60) con 2 verdaderas → P 0,5; F2 = 5·0,5·1 / (4·0,5 + 1) = 2,5/3
    expect(f[0.3]?.grupos['PER_ORG']).toMatchObject({ n: 2, cubiertas: 2, detecciones: 4, verdaderas: 2 });
    expect(f[0.3]?.grupos['PER_ORG']?.f2).toBeCloseTo(2.5 / 3, 9);
    // 0,4: se va el 0,35 → 4 tramos, 3 verdaderos = 0,75; PER+ORG: 3 detecciones, 2 verdaderas → P 2/3; F2 = 5·(2/3) / (8/3 + 1) = (10/3)/(11/3)
    expect(f[0.4]?.precisionGlobal).toBeCloseTo(0.75, 9);
    expect(f[0.4]?.grupos['PER_ORG']?.f2).toBeCloseTo(10 / 11, 9);
    // 0,5: quedan 0,95 PER v, 0,70 LOC v, 0,60 PER f → 2 de 3; PER+ORG: R 1/2, P 1/2 → F2 = 5·0,25 / (2 + 0,5) = 0,5
    expect(f[0.5]?.precisionGlobal).toBeCloseTo(2 / 3, 9);
    expect(f[0.5]?.grupos['PER_ORG']?.exhaustividadMencion).toBeCloseTo(0.5, 9);
    expect(f[0.5]?.grupos['PER_ORG']?.f2).toBeCloseTo(0.5, 9);
    // 0,6 es igual que 0,5 (el 0,60 entra, inclusivo); LOC: gold 1, cubierta 1
    expect(f[0.6]?.detecciones).toBe(3);
    expect(f[0.6]?.grupos['LOC']).toMatchObject({ n: 1, cubiertas: 1, verdaderas: 1 });
  });

  const fila = (umbral: number, precisionGlobal: number, f2: number): FilaUmbral => ({
    umbral, detecciones: 100, verdaderas: Math.round(precisionGlobal * 100), precisionGlobal,
    grupos: { PER_ORG: { n: 10, cubiertas: 9, exhaustividadMencion: 0.9, detecciones: 10, verdaderas: 9, precision: 0.9, f2 } },
  });

  it('T-AB-03 elegirUmbral toma el mayor F2 entre los umbrales con precisión global >= 0,70', () => {
    const filas = [fila(0.3, 0.65, 0.95), fila(0.4, 0.72, 0.9), fila(0.5, 0.8, 0.85), fila(0.6, 0.9, 0.7)];
    const s = elegirUmbral(filas, 0.7);
    expect(s).toMatchObject({ umbral: 0.4, cumplePrecision: true, f2: 0.9 });
  });

  it('T-AB-03 elegirUmbral desempata por el umbral más bajo (la exhaustividad pesa más) y avisa si ninguno cumple', () => {
    expect(elegirUmbral([fila(0.4, 0.8, 0.9), fila(0.5, 0.8, 0.9)], 0.7).umbral).toBe(0.4);
    const ninguno = elegirUmbral([fila(0.3, 0.5, 0.95), fila(0.4, 0.6, 0.9), fila(0.5, 0.55, 0.85)], 0.7);
    expect(ninguno).toMatchObject({ umbral: 0.4, cumplePrecision: false });
  });

  it('T-AB-03 (b) nerHighThreshold: el menor valor con precisión >= 0,90 entre los tramos que quedarían media', () => {
    const filas = barridoAlto(CACHE, { T01: GOLD }, 0.3, [0.5, 0.7, 0.9]);
    // piso 0,3: 0,95 v; 0,45 v; 0,35 f; 0,70 v; 0,60 f. ≥0,5: 0,95 v, 0,70 v, 0,60 f → 2/3; ≥0,7: 2/2; ≥0,9: 1/1
    expect(filas.map((x) => [x.tramos, x.verdaderas])).toEqual([[3, 2], [2, 2], [1, 1]]);
    expect(elegirAlto(filas, 0.9)?.umbral).toBe(0.7);
    const sinAlcance: FilaAlto[] = [{ umbral: 0.8, tramos: 10, verdaderas: 8, precision: 0.8 }, { umbral: 0.9, tramos: 0, verdaderas: 0, precision: 0 }];
    expect(elegirAlto(sinAlcance, 0.9)).toBeNull();
  });

  it('T-AB-02 mediana y percentil 90 por interpolación lineal', () => {
    expect(mediana([5, 1, 3])).toBe(3);
    expect(mediana([1, 2, 3, 4])).toBe(2.5);
    expect(percentil([1, 2, 3, 4, 5], 0.9)).toBeCloseTo(4.6, 9);
    expect(percentil([7], 0.9)).toBe(7);
    expect(percentil([], 0.5)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------- datos reales
interface Calibracion {
  formato: string; nerMinScore: number; nerHighThreshold: number | null; altoAlcanzable: boolean; minPrecisionGlobal: number;
  seleccion: { umbral: number; cumplePrecision: boolean };
  barridoUmbral: FilaUmbral[]; barridoAlto: FilaAlto[];
}
const { ids: IDS, textos, golds: GOLDS } = cargarCorpus(RAIZ);
const CACHE_X_LARGE = 'metricas/modelo-x-large-natural.json';
const CALIBRACION = 'metricas/calibracion-umbral.json';

describe('T-AB-03 · calibración con las salidas guardadas de x-large (vista natural)', () => {
  const cache = leer<CacheModelo>(CACHE_X_LARGE);
  const cal = leer<Calibracion>(CALIBRACION);

  it('T-AB-03 la caché de salidas es de x-large en vista natural, guarda desde 0,1 y trae los documentos medibles del corpus de desarrollo', () => {
    expect(cache).toMatchObject({ formato: 'sig-low/cache-modelo', v: 1, modelo: 'x-large', vista: 'natural', etiquetas: 'estandar', piso: 0.1 });
    expect(Object.keys(cache.documentos).sort()).toEqual(IDS);
    expect(IDS.length).toBe(19); // los 20 de desarrollo menos C04 (PDF escaneado, sin texto que medir)
    for (const h of Object.values(cache.huella)) expect(h).toMatch(/^[0-9a-f]{64}$/);
    for (const d of Object.values(cache.documentos)) {
      for (const pc of Object.values(d.partes)) {
        expect(pc.ventanas.map((v) => v.windowIndex)).toEqual(pc.ventanas.map((_, k) => k)); // windowIndex desde 0, sin huecos
        for (const v of pc.ventanas) {
          expect(v.windowTotal).toBe(pc.ventanas.length);
          for (const { start, end, score } of v.spans) { expect(score).toBeGreaterThanOrEqual(0.1); expect(end).toBeGreaterThan(start); }
        }
      }
    }
  });

  it('T-AB-03 la huella de la caché coincide con el texto canónico y con el código del motor actuales (si no, la caché es inválida: R-26)', () => {
    for (const id of IDS) {
      const ps = textos[id] ?? [];
      expect(Object.keys(cache.documentos[id]?.partes ?? {}), id).toEqual(ps.map((p) => p.clave));
      for (const p of ps) expect(cache.documentos[id]?.partes[p.clave]?.sha256, `${id} ${p.clave}`).toBe(createHash('sha256').update(p.texto).digest('hex'));
    }
    expect(cache.huella.codigo).toBe(huellaMotor(RAIZ));
  });

  it('T-AB-03 (a) el piso registrado sale de la caché: mayor F2 de PER y ORG con precisión global >= 0,70, dentro de la rejilla', () => {
    const filas = UMBRALES.map((u) => evaluarUmbral(cache, GOLDS, u));
    const sel = elegirUmbral(filas, 0.7);
    expect(sel.cumplePrecision).toBe(true);
    expect(UMBRALES as readonly number[]).toContain(sel.umbral);
    expect(cal.nerMinScore).toBe(sel.umbral);
    expect(cal.seleccion.umbral).toBe(sel.umbral);
    const elegida = filas.find((f) => f.umbral === sel.umbral) as FilaUmbral;
    expect(elegida.precisionGlobal).toBeGreaterThanOrEqual(0.7);
    for (const f of filas.filter((x) => x.precisionGlobal >= 0.7)) {
      expect(f.grupos['PER_ORG']?.f2 ?? 0).toBeLessThanOrEqual(elegida.grupos['PER_ORG']?.f2 ?? 0);
    }
    // El archivo de calibración guarda las mismas cifras que se recalculan.
    expect(cal.barridoUmbral.map((f) => [f.umbral, f.detecciones, f.verdaderas])).toEqual(filas.map((f) => [f.umbral, f.detecciones, f.verdaderas]));
  });

  it('T-AB-03 (b) nerHighThreshold es el menor valor con precisión >= 0,90 entre los tramos media y el anterior (0,01 menos) no la alcanza', () => {
    expect(cal.altoAlcanzable).toBe(true);
    const alto = cal.nerHighThreshold as number;
    expect(alto).toBeGreaterThanOrEqual(cal.nerMinScore);
    const candidatos = Array.from({ length: Math.round((0.99 - cal.nerMinScore) * 100) + 1 }, (_, i) => Math.round((cal.nerMinScore + i * 0.01) * 100) / 100);
    const filas = barridoAlto(cache, GOLDS, cal.nerMinScore, candidatos);
    const fila = filas.find((f) => f.umbral === alto) as FilaAlto;
    expect(fila.precision).toBeGreaterThanOrEqual(0.9);
    expect(elegirAlto(filas, 0.9)?.umbral).toBe(alto);
    for (const f of filas.filter((x) => x.umbral < alto)) expect(f.precision).toBeLessThan(0.9);
  });
});

// ---------------------------------------------------------------------------------------------------------------- T-AB-02
interface FilaLat {
  modelo: string; hilos: number; ventanas: number; medianaMs: number; p90Ms: number; wasmMb: number; procesosMbPico: number | null;
  ventanasMs: number[]; nucleosAjenos?: number | null;
}
const filasLatencia = (modelo: string): FilaLat[] =>
  readdirSync(ruta('metricas')).filter((f) => f.startsWith(`latencia-${modelo}-chromium`) && f.endsWith('.json'))
    .flatMap((f) => leer<{ filas: FilaLat[] }>(`metricas/${f}`).filas);

describe('T-AB-02 · latencia por ventana y memoria pico con 1, 4 y 8 hilos (x-large y x-base)', () => {
  for (const modelo of ['x-large', 'x-base']) {
    it(`T-AB-02 ${modelo}: mediana y p90 por ventana con 1, 4 y 8 hilos, recalculados de las ventanas medidas`, () => {
      const filas = filasLatencia(modelo);
      for (const h of [1, 4, 8]) {
        const f = filas.filter((x) => x.hilos === h);
        expect(f.length, `${modelo} ${h} hilos`).toBeGreaterThanOrEqual(1);
        for (const x of f) {
          expect(x.ventanasMs.length).toBe(x.ventanas);
          expect(Math.abs(x.medianaMs - mediana(x.ventanasMs))).toBeLessThanOrEqual(1);
          expect(Math.abs(x.p90Ms - percentil(x.ventanasMs, 0.9))).toBeLessThanOrEqual(1);
          expect(x.medianaMs).toBeLessThanOrEqual(x.p90Ms);
        }
      }
    });
    it(`T-AB-02 ${modelo}: memoria pico de WebAssembly y del navegador completo dentro de lo previsto`, () => {
      const techoWasmMb = modelo === 'x-large' ? 1600 : 900;
      const techoProcesosMb = modelo === 'x-large' ? 3200 : 2200;
      for (const x of filasLatencia(modelo)) {
        expect(x.wasmMb).toBeGreaterThan(modelo === 'x-large' ? 1300 : 700);
        expect(x.wasmMb).toBeLessThanOrEqual(techoWasmMb);
        if (x.procesosMbPico !== null) expect(x.procesosMbPico).toBeLessThanOrEqual(techoProcesosMb);
      }
    });
  }

  it('T-AB-02 con más hilos baja la mediana por ventana (1 hilo frente a 4 y a 8), en x-large y en x-base', () => {
    for (const modelo of ['x-large', 'x-base']) {
      const mejor = (h: number): number => Math.min(...filasLatencia(modelo).filter((x) => x.hilos === h).map((x) => x.medianaMs));
      expect(mejor(4)).toBeLessThan(mejor(1));
      expect(mejor(8)).toBeLessThan(mejor(1));
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------- etiquetas
interface FilaEtiq { umbral: number; grupos: Record<string, { exhaustividadMencion: number; f2: number }> }
interface VarEtiq { filas: FilaEtiq[]; curva: FilaEtiq[] }
describe('T-AB-03 (a) · prueba de etiquetas: las tres en inglés frente a las traducidas y a las nueve', () => {
  const cal = leer<{ etiquetas: Record<string, { docs: string[]; variantes: Record<string, VarEtiq> } | null> }>(CALIBRACION);
  const mejorF2 = (v: VarEtiq): number =>
    Math.max(...[...v.filas, ...v.curva].filter((f) => f.umbral >= 0.2 && f.umbral <= 0.4).map((f) => f.grupos['PER_ORG']?.f2 ?? 0));

  it('T-AB-03 x-base (19 documentos) y x-large (6 documentos) tienen las tres variantes', () => {
    expect(cal.etiquetas['x-base']?.docs).toHaveLength(19);
    expect(cal.etiquetas['x-large']?.docs).toHaveLength(6);
    for (const m of ['x-base', 'x-large']) expect(Object.keys(cal.etiquetas[m]?.variantes ?? {}).sort()).toEqual(['estandar', 'nueve', 'traducidas']);
  });

  it('T-AB-03 se mantienen person, organization y location: ninguna otra variante mejora el mejor F2 de PER y ORG en 0,02 o más (umbrales de 0,2 a 0,4)', () => {
    for (const m of ['x-base', 'x-large']) {
      const v = cal.etiquetas[m]?.variantes ?? {};
      const base = mejorF2(v['estandar'] as VarEtiq);
      for (const otra of ['traducidas', 'nueve']) expect(mejorF2(v[otra] as VarEtiq) - base, `${m} ${otra}`).toBeLessThan(0.02);
    }
  });
});

describe('T-AB-03 · solape de 25 palabras frente al de 37 (9.5: ventanas que se ganan y exhaustividad que se pierde)', () => {
  const cal = leer<{ solape: { solapes: number[]; ventanas: number[]; cubiertasPerOrg: number[] } | null }>(CALIBRACION);
  it('T-AB-03 el solape de 25 da menos ventanas, y se mantiene el de 37 mientras cubra más menciones de PER y ORG', () => {
    const s = cal.solape;
    expect(s?.solapes).toEqual([37, 25]);
    expect(s?.ventanas[1] ?? 0).toBeLessThan(s?.ventanas[0] ?? 0);
    expect(s?.cubiertasPerOrg[0] ?? 0).toBeGreaterThanOrEqual(s?.cubiertasPerOrg[1] ?? 0);
  });
});
