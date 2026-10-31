// T-UA-01 (evaluación automática de 10.4.1 sobre los informes) y T-UA-02 (registro de brechas). Funciones puras de scripts/veredicto.ts
// sobre informes armados a mano, más una pasada con el motor real para comprobar que las filas que exige el veredicto existen.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codigoDeSalida, construirInforme, gruposDeCierre } from '../../scripts/metrics.ts';
import type { MetricsReport, RunConfig, RunVista } from '../../scripts/metrics.ts';
import {
  actualizarBrechas, brechaCompleta, brechasDe, conVeredicto, evaluarVeredicto, leerBrechas, main, BRECHAS_VACIAS,
} from '../../scripts/veredicto.ts';
import { cacheSimulada } from './lib/cache-simulada.ts';
import { cargarCorpus, RAIZ } from './lib/corpus.ts';
import { correr } from './lib/corrida.ts';

/** Informe de x-large en el que todas las filas de cierre se cumplen con n > 0. */
function informe(vista: RunVista, config: RunConfig = 'x-large', fecha = '2026-10-30T14:00'): MetricsReport {
  const r = construirInforme([], {
    config, vista, hilos: 8, conjunto: 'todo', compilacion: 'abcdef012345', modelo: null, navegador: 'prueba',
    equipo: { nucleosLogicos: 8, descripcion: 'prueba' }, fecha,
  });
  r.filas = gruposDeCierre(vista).map((def) => ({
    grupo: def.grupo, n: 100, cubiertas: 100, exhaustividadMencion: 1, exhaustividadTipificada: 1, entidades: 40, exhaustividadEntidadEstricta: 1,
    exhaustividadEntidadLaxa: 1, detecciones: 100, verdaderas: 100, falsas: 0, precision: 1, f2: 1, coincidenciaExacta: 1, idsNoCubiertas: [],
  }));
  r.global = { precision: 0.9, f2: 0.95, paginas: 30, fpPorPagina: 2, maxFpPorPaginaDoc: 4 };
  r.consistencia = { evaluadas: 40, consistentes: 40, colisiones: 0, fusiones: 0 };
  r.consistenciaPorGrupo = {
    ids: { evaluadas: 10, consistentes: 10 }, lista: { evaluadas: 10, consistentes: 10 }, fechas_valores: { evaluadas: 10, consistentes: 10 },
    modelo: { evaluadas: 10, consistentes: 10 }, colisionesDelModelo: 0,
  };
  r.negativos = { total: 50, conDeteccion: 2, citasConRadicado: 5, banderasPresentes: 5 };
  r.generalizacion = [
    { tipo: 'MUNICIPIO_A_DEPARTAMENTO', esperadas: 40, presentes: 40 }, { tipo: 'DESPACHO_A_GENERICO', esperadas: 20, presentes: 20 },
    { tipo: 'CARGO', esperadas: 10, presentes: 10 }, { tipo: 'DIAGNOSTICO', esperadas: 10, presentes: 10 }, { tipo: 'MENOR', esperadas: 5, presentes: 5 },
    { tipo: 'EDAD_A_RANGO', esperadas: 5, presentes: 5 }, { tipo: 'HECHO_LLAMATIVO', esperadas: 10, presentes: 8 },
  ];
  r.residuos = { antesDelBucle: 4, despuesDelBucle: 0, omisiones: 3, porDocumento: [{ docId: 'C01', residuos: 0, omisiones: 3, idsAnotacion: ['C01-A001'] }], concordanciaResidueTs: true };
  return r;
}
const tres = (): MetricsReport[] => [informe('natural'), informe('mayusculas'), informe('minusculas')];
const fila = (r: MetricsReport, g: string): MetricsReport['filas'][number] => r.filas.find((f) => f.grupo === g) as MetricsReport['filas'][number];

describe('T-UA-01 · evaluación automática de 10.4.1', () => {
  it('T-UA-01 con las tres vistas del modelo principal y todas las filas cumplidas, cierra', () => {
    const v = evaluarVeredicto(tres());
    expect(v.incumplidos).toEqual([]);
    expect(v.cierra).toBe(true);
    const nombres = new Set(v.filas.map((f) => `${f.fila}|${f.medida}`));
    for (const n of ['CC|mencion', 'LISTA|mencion', 'PERSONA_FUERA|entidad', 'PERSONA_FUERA@mayusculas|mencion', 'ORG_FUERA@minusculas|entidad', 'BANDERAS_INDIRECTAS|banderas',
      'NEGATIVOS|negativos', 'CITAS_CON_RADICADO|citas', 'PRECISION_GLOBAL|precision', 'CONSISTENCIA_MODELO|consistencia', 'COLISIONES_DURAS|colisiones', 'RESIDUOS|residuos']) {
      expect(nombres.has(n), n).toBe(true);
    }
  });

  it('T-UA-01 sin la corrida del modelo principal no cierra: las filas sin modelo y x-base no cuentan como cumplidas (10.4.2)', () => {
    const solo = [informe('natural', 'sin-modelo'), informe('mayusculas', 'x-base'), informe('minusculas', 'x-base')];
    const v = evaluarVeredicto(solo);
    expect(v.cierra).toBe(false);
    expect(v.incumplidos).toContain('MODELO_PRINCIPAL_AUSENTE');
    expect(evaluarVeredicto([informe('natural')]).incumplidos).toEqual(['FALTA_CORRIDA_X_LARGE_MAYUSCULAS', 'FALTA_CORRIDA_X_LARGE_MINUSCULAS']);
  });

  it('T-UA-01 una fila por vista bajo el umbral lista la fila incumplida; en el umbral exacto cumple', () => {
    const informes = tres();
    fila(informes[1] as MetricsReport, 'PERSONA_FUERA@mayusculas').exhaustividadMencion = 0.84;
    let v = evaluarVeredicto(informes);
    expect(v.cierra).toBe(false);
    expect(v.incumplidos).toEqual(['PERSONA_FUERA@mayusculas: 0.840 < 0.85']);
    fila(informes[1] as MetricsReport, 'PERSONA_FUERA@mayusculas').exhaustividadMencion = 0.85;
    v = evaluarVeredicto(informes);
    expect(v.cierra).toBe(true);
    // Una organización fuera de la lista exige 0,80 en cada vista; la entidad estricta de la vista minúsculas, 0,70.
    fila(informes[2] as MetricsReport, 'ORG_FUERA@minusculas').exhaustividadEntidadEstricta = 0.69;
    expect(evaluarVeredicto(informes).incumplidos).toEqual(['ORG_FUERA@minusculas (entidad): 0.690 < 0.7']);
  });

  it('T-UA-01 los umbrales de 10.4.1 por fila: identificadores 0,98 / 0,96; lista 0,98 / 0,95; direcciones, fechas y valores 0,95 / 0,93', () => {
    const casos: Array<[string, number, number]> = [['CC', 0.979, 0.96], ['NIT', 0.98, 0.959], ['LISTA', 0.98, 0.949], ['DIRECCIONES', 0.949, 0.93], ['FECHA', 0.95, 0.929], ['VALOR', 0.94, 0.93]];
    for (const [g, m, e] of casos) {
      const informes = tres();
      const f = fila(informes[0] as MetricsReport, g);
      f.exhaustividadMencion = m;
      f.exhaustividadEntidadEstricta = e;
      const v = evaluarVeredicto(informes);
      expect(v.cierra, g).toBe(false);
      expect(v.incumplidos.length, g).toBe(1);
      expect(v.incumplidos[0], g).toContain(g);
    }
  });

  it('T-UA-01 identificadores rotulados y clases fuertes de la lista exigen 0 omisiones (exhaustividad 1)', () => {
    for (const g of ['IDS_ROTULADOS_CON_ROTULO', 'LISTA_CLASES_FUERTES']) {
      const informes = tres();
      fila(informes[0] as MetricsReport, g).exhaustividadMencion = 0.99;
      expect(evaluarVeredicto(informes).incumplidos[0]).toContain(g);
    }
  });

  it('T-UA-01 residuos, discordancia con residue.ts, negativos, citas y precisión global bloquean el cierre', () => {
    const mut = (f: (r: MetricsReport) => void): string[] => { const i = tres(); f(i[0] as MetricsReport); return evaluarVeredicto(i).incumplidos; };
    expect(mut((r) => { r.residuos.porDocumento = [{ docId: 'C01', residuos: 1, omisiones: 0, idsAnotacion: ['C01-A009'] }]; })).toEqual(['RESIDUOS: 1.000 ≠ 0']);
    expect(mut((r) => { r.residuos.despuesDelBucle = 2; })).toEqual(['RESIDUOS: 2.000 ≠ 0']);
    expect(mut((r) => { r.residuos.concordanciaResidueTs = false; })).toEqual(['CONCORDANCIA_RESIDUE_TS: 0.000 ≠ 1']);
    expect(mut((r) => { r.negativos.conDeteccion = 6; })).toEqual(['NEGATIVOS: 0.120 > 0.1']);
    expect(mut((r) => { r.negativos.banderasPresentes = 4; })).toEqual(['CITAS_CON_RADICADO: 0.800 ≠ 1']);
    expect(mut((r) => { r.global.precision = 0.69; })).toEqual(['PRECISION_GLOBAL: 0.690 < 0.7']);
    expect(mut((r) => { r.consistenciaPorGrupo = { ...(r.consistenciaPorGrupo as NonNullable<typeof r.consistenciaPorGrupo>), lista: { evaluadas: 10, consistentes: 9 } }; }))
      .toEqual(['CONSISTENCIA_LISTA: 0.900 < 1']);
    expect(mut((r) => { r.consistencia.colisiones = 1; })).toEqual(['COLISIONES_DURAS: 1.000 ≠ 0']);
  });

  it('T-UA-01 las filas informativas (hechos llamativos, fatiga, colisiones del modelo) se registran sin bloquear', () => {
    const informes = tres();
    const r = informes[0] as MetricsReport;
    r.generalizacion = r.generalizacion.map((g) => (g.tipo === 'HECHO_LLAMATIVO' ? { ...g, presentes: 3 } : g));
    r.global = { ...r.global, fpPorPagina: 7, maxFpPorPaginaDoc: 14 };
    r.consistencia.colisiones = 2;
    (r.consistenciaPorGrupo as NonNullable<typeof r.consistenciaPorGrupo>).colisionesDelModelo = 2;
    const v = evaluarVeredicto(informes);
    expect(v.cierra).toBe(true);
    expect(v.filas.filter((f) => !f.cierre && !f.cumple).map((f) => f.fila).sort()).toEqual(['COLISIONES_DEL_MODELO', 'FATIGA_MAXIMA_POR_DOCUMENTO', 'FATIGA_MEDIA', 'HECHO_LLAMATIVO']);
  });

  it('T-UA-01 un grupo sin menciones no se cuenta como incumplido y lo dice', () => {
    const informes = tres();
    const f = fila(informes[0] as MetricsReport, 'MUNICIPIO');
    f.n = 0; f.cubiertas = 0; f.exhaustividadMencion = 0;
    const v = evaluarVeredicto(informes);
    expect(v.cierra).toBe(true);
    expect(v.filas.filter((x) => x.nota?.startsWith('sin ')).length).toBe(0);   // MUNICIPIO no es fila de cierre por exhaustividad (lo es la sugerencia)
    const g = fila(informes[0] as MetricsReport, 'DIRECCIONES');
    g.n = 0; g.entidades = 0; g.exhaustividadMencion = 0;
    const w = evaluarVeredicto(informes);
    expect(w.cierra).toBe(true);
    expect(w.filas.find((x) => x.fila === 'DIRECCIONES')?.nota).toBe('sin menciones en el conjunto');
  });

  it('T-UA-01 escribe el veredicto en los informes con umbral, omisiones permitidas y cumple; el código de salida es 1 si no cierra', () => {
    const informes = tres();
    fila(informes[0] as MetricsReport, 'CC').exhaustividadMencion = 0.9;
    const v = evaluarVeredicto(informes);
    const con = conVeredicto(informes, v);
    expect(con[0]?.veredicto).toEqual({ cierra: false, incumplidos: v.incumplidos });
    expect(fila(con[0] as MetricsReport, 'CC')).toMatchObject({ umbral: 0.98, omisionesPermitidas: 2, cumple: false });   // ⌊0,02 · 100⌋ = 2
    expect(fila(con[1] as MetricsReport, 'PERSONA_FUERA@mayusculas')).toMatchObject({ umbral: 0.85, omisionesPermitidas: 15, cumple: true });
    expect(codigoDeSalida(con[0] as MetricsReport)).toBe(1);
    expect(informes[0]?.veredicto).toBeUndefined();   // no muta los informes de entrada
  });

  it('T-UA-01 con el motor real y la caché simulada existen todas las filas que el veredicto exige', async () => {
    const corpus = cargarCorpus('todo').slice(0, 3);
    const informes: MetricsReport[] = [];
    for (const v of ['natural', 'mayusculas', 'minusculas'] as const) {
      informes.push((await correr({ config: 'x-large', vista: v, corpus, cache: cacheSimulada(corpus, v), oraculo: false })).informe);
    }
    const v = evaluarVeredicto(informes);
    expect(v.incumplidos.filter((i) => i.startsWith('FALTA_'))).toEqual([]);
    expect(v.filas.length).toBeGreaterThan(30);
    for (const f of v.filas) expect(Number.isFinite(f.valor), f.fila).toBe(true);
  }, 300_000);
});

describe('T-UA-02 · registro de brechas', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'siglow-brechas-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  const incumplido = (): MetricsReport[] => {
    const i = tres();
    const f = fila(i[0] as MetricsReport, 'CC');
    f.exhaustividadMencion = 0.9; f.cubiertas = 90; f.idsNoCubiertas = ['C01-A010', 'C02-A020'];
    fila(i[1] as MetricsReport, 'PERSONA_FUERA@mayusculas').exhaustividadMencion = 0.7;
    fila(i[1] as MetricsReport, 'PERSONA_FUERA@mayusculas').idsNoCubiertas = ['C03-A030'];
    (i[0] as MetricsReport).generalizacion = (i[0] as MetricsReport).generalizacion.map((g) => (g.tipo === 'HECHO_LLAMATIVO' ? { ...g, presentes: 1 } : g));
    return i;
  };

  it('T-UA-02 toda fila de cierre incumplida tiene su entrada completa (fila, valor, umbral, n, ids, hipótesis, tarea y acción) y las informativas no', () => {
    const v = evaluarVeredicto(incumplido());
    const brechas = brechasDe(v, '20261030-1400-x-large-natural-8h');
    expect(brechas.map((b) => b.fila).sort()).toEqual(['CC', 'PERSONA_FUERA@mayusculas']);
    for (const b of brechas) { expect(brechaCompleta(b), b.fila).toBe(true); expect(b.cierre).toBe(true); expect(b.estado).toBe('abierta'); }
    const cc = brechas.find((b) => b.fila === 'CC');
    expect(cc).toMatchObject({ valor: 0.9, umbral: 0.98, operador: '>=', n: 100, idsAnotacion: ['C01-A010', 'C02-A020'] });
    expect(cc?.tarea).toContain('PA-2');
    // Las filas de cierre incumplidas y las brechas coinciden una a una.
    expect(v.filas.filter((f) => f.cierre && !f.cumple).length).toBe(brechas.length);
  });

  it('T-UA-02 las brechas guardan solo ids de anotación: ningún valor del gold', () => {
    const v = evaluarVeredicto(incumplido());
    for (const b of brechasDe(v, 'x')) for (const id of b.idsAnotacion) expect(id).toMatch(/^C\d\d-A\d{3}$/u);
  });

  it('T-UA-02 actualizar es idempotente, conserva el historial y cierra la brecha cuando la fila ya se cumple', () => {
    const v1 = evaluarVeredicto(incumplido());
    const a1 = actualizarBrechas(BRECHAS_VACIAS, v1, 'c1');
    expect(actualizarBrechas(a1, v1, 'c1')).toEqual(a1);
    expect(a1.brechas.filter((b) => b.estado === 'abierta').length).toBe(2);
    const arreglado = incumplido();
    fila(arreglado[0] as MetricsReport, 'CC').exhaustividadMencion = 0.99;
    const a2 = actualizarBrechas(a1, evaluarVeredicto(arreglado), 'c2');
    expect(a2.brechas.find((b) => b.fila === 'CC')?.estado).toBe('cerrada');
    expect(a2.brechas.find((b) => b.fila === 'PERSONA_FUERA')?.estado ?? a2.brechas.find((b) => b.vista === 'mayusculas')?.estado).toBe('abierta');
    expect(a2.brechas.length).toBe(2);
  });

  it('T-UA-02 la línea de órdenes escribe el veredicto en los informes y las brechas en corpus/brechas.json, y sale con 1 si no cierra', () => {
    const carpeta = join(tmp, 'resultados');
    mkdirSync(carpeta);
    const informes = incumplido();
    for (const r of informes) writeFileSync(join(carpeta, `20261030-1400-x-large-${r.corrida.vista}-8h.json`), JSON.stringify(r));
    const rutaBrechas = join(tmp, 'brechas.json');
    expect(main([`--informes=${carpeta}`, `--brechas=${rutaBrechas}`])).toBe(1);
    const b = leerBrechas(rutaBrechas);
    expect(b.brechas.length).toBe(2);
    expect(b.brechas.every(brechaCompleta)).toBe(true);
    const natural = JSON.parse(readFileSync(join(carpeta, '20261030-1400-x-large-natural-8h.json'), 'utf8')) as MetricsReport;
    expect(natural.veredicto?.cierra).toBe(false);
    // Una carpeta sin informes es un uso inválido (2).
    expect(main([`--informes=${join(tmp, 'vacia')}`, `--brechas=${rutaBrechas}`])).toBe(2);
    // Con los informes arreglados cierra, sale con 0 y las brechas quedan cerradas.
    for (const r of tres()) writeFileSync(join(carpeta, `20261030-1500-x-large-${r.corrida.vista}-8h.json`), JSON.stringify({ ...r, corrida: { ...r.corrida, fecha: '2026-10-30T15:00' } }));
    expect(main([`--informes=${carpeta}`, `--brechas=${rutaBrechas}`])).toBe(0);
    expect(leerBrechas(rutaBrechas).brechas.every((x) => x.estado === 'cerrada')).toBe(true);
  });

  it('T-UA-02 corpus/brechas.json existe, es del formato y está vacío hasta P0-4 (sin filas de cierre abiertas)', () => {
    const b = leerBrechas(join(RAIZ, 'corpus', 'brechas.json'));
    expect(b.formato).toBe('sig-low/brechas');
    expect(b.brechas.filter((x) => x.cierre && x.estado === 'abierta')).toEqual([]);
  });
});
