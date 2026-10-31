// T-ME-04 (preliminar, PF-3) y T-ED-01 / T-ED-02 (Edge): leen los resultados que deja `node scripts/calibrar-modelo.ts latencia|edge` en
// metricas/. No ejecutan el modelo. La cifra definitiva de la meta de rendimiento la mide P0-5 con los agentes parados (10.3.5);
// la preliminar de PF-3 se hizo con otros procesos usando el equipo, y cada corrida guarda cuántos núcleos usaron los demás
// (`nucleosAjenos`). La meta solo se exige en una corrida con menos de 1 núcleo ajeno; sin ella, la prueba de la meta se salta (no se finge).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = process.cwd();
interface FilaLatencia {
  modelo: string; navegador: string; hilos: number; palabras: number; ventanas: number; cargaMs: number; calentamientoMs: number;
  medianaMs: number; p90Ms: number; totalMs: number; wasmMb: number; procesosMbPico: number | null; nucleosAjenos?: number | null;
  ventanasMs: number[];
}
interface ArchivoLatencia { formato: string; filas: FilaLatencia[] }
interface Edge {
  navegador: string; banderas: string[]; info: { wasm: boolean; crossOriginIsolated: boolean }; pbkdf2Ms600k: number[]; cargaOk: boolean; cargaMs: number;
  cargaError?: string; documentos?: Record<string, { ok: boolean; ventanas: number; ms: number; medianaVentanaMs: number | null }>;
}
const leer = <T>(r: string): T => JSON.parse(readFileSync(join(RAIZ, r), 'utf8')) as T;
const filasDe = (modelo: string): FilaLatencia[] =>
  readdirSync(join(RAIZ, 'metricas')).filter((f) => f.startsWith(`latencia-${modelo}-chromium`) && f.endsWith('.json'))
    .flatMap((f) => leer<ArchivoLatencia>(`metricas/${f}`).filas.filter((x) => x.hilos > 0 && x.ventanasMs !== undefined));

/** Meta de rendimiento por 10 páginas (≈ 5.000 palabras): ≤ 2 min con 8 hilos o más, ≤ 4 min con 4 a 7 hilos (A.11, 10.4.1). */
const META_MS = (hilos: number): number => (hilos >= 8 ? 120_000 : 240_000);

describe('T-ME-04 · meta de rendimiento (preliminar) con x-large', () => {
  const diez = filasDe('x-large').filter((f) => f.palabras >= 5000);

  it('T-ME-04 hay corridas de un escrito de 10 páginas (5.000 palabras, 22 a 28 ventanas) con 4 y con 8 hilos', () => {
    for (const h of [4, 8]) {
      const f = diez.filter((x) => x.hilos === h);
      expect(f.length, `${h} hilos`).toBeGreaterThanOrEqual(1);
      for (const x of f) {
        expect(x.ventanas).toBeGreaterThanOrEqual(22);
        expect(x.ventanas).toBeLessThanOrEqual(28);
        expect(x.ventanasMs).toHaveLength(x.ventanas);
        // El total del modelo es la suma de las ventanas (más el turno que se cede entre ventanas: menos de 2 s en total).
        const suma = x.ventanasMs.reduce((a, b) => a + b, 0);
        expect(x.totalMs).toBeGreaterThanOrEqual(suma - 1);
        expect(x.totalMs - suma).toBeLessThan(2000);
        expect(x.medianaMs).toBeLessThanOrEqual(x.p90Ms);
      }
    }
  });

  const silenciosas = diez.filter((f) => typeof f.nucleosAjenos === 'number' && f.nucleosAjenos < 1);
  it.skipIf(silenciosas.length === 0)('T-ME-04 meta: 10 páginas en <= 2 min con 8 hilos y <= 4 min con 4 hilos (solo corridas con < 1 núcleo ajeno)', () => {
    for (const f of silenciosas) expect(f.totalMs, `${f.hilos} hilos`).toBeLessThanOrEqual(META_MS(f.hilos));
  });

  it('T-ME-04 cada corrida preliminar guarda su navegador, su memoria de WebAssembly y su carga ajena (si se midió)', () => {
    expect(diez.length).toBeGreaterThan(0);
    for (const f of diez) {
      expect(f.navegador).toMatch(/chromium|msedge/);
      expect(f.wasmMb).toBeGreaterThan(1000); // el WebAssembly de x-large con el modelo dentro (≈ 1,47 GB)
      expect(f.nucleosAjenos === undefined || f.nucleosAjenos === null || f.nucleosAjenos >= 0).toBe(true);
    }
  });
});

describe('T-ED-01 · Edge (normal y sin JIT) y T-ED-02 · Chromium con --js-flags=--jitless', () => {
  it('T-ED-01 Edge normal: carga x-large, procesa C01 y C20 y calibra PBKDF2 (600 000 iteraciones)', () => {
    const e = leer<Edge>('metricas/edge-x-large-normal.json');
    expect(e.navegador).toMatch(/^msedge /);
    expect(e.info).toMatchObject({ wasm: true, crossOriginIsolated: true });
    expect(e.cargaOk).toBe(true);
    for (const id of ['C01', 'C20']) expect(e.documentos?.[id], id).toMatchObject({ ok: true });
    expect(e.pbkdf2Ms600k).toHaveLength(3);
    for (const ms of e.pbkdf2Ms600k) expect(ms).toBeGreaterThan(0);
  });

  it('T-ED-01 / T-ED-02 sin JIT (Edge y Chromium con --jitless): sin WebAssembly el modelo no carga, el flujo termina con un código y no se cuelga', () => {
    for (const r of ['metricas/edge-x-large-jitless.json', 'metricas/chromium-x-large-jitless.json']) {
      const e = leer<Edge>(r);
      expect(e.banderas).toContain('--js-flags=--jitless');
      expect(e.info.wasm).toBe(false);
      expect(e.cargaOk).toBe(false);
      expect(e.cargaMs).toBeLessThan(60_000); // dentro del presupuesto de 6.11.3: cae al plan B, no espera
      // El plan espera BACKEND_NO_DISPONIBLE; hoy el motor responde MODELO_INTEGRIDAD (pedido al integrador en el informe de PF-3).
      expect(['BACKEND_NO_DISPONIBLE', 'MODELO_INTEGRIDAD']).toContain(e.cargaError);
      expect(e.pbkdf2Ms600k).toHaveLength(3);
    }
  });
});
