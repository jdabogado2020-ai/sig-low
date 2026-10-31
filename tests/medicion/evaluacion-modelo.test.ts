// T-AB-02 y T-AB-03 (parte PF-3 de tests/medicion/evaluacion-modelo.test.ts); T-AB-01 y T-AB-06 los agrega PF-4a; T-AB-04 los agrega PF-4b (al final del archivo); P0-4 agrega los suyos.
// No ejecutan el modelo: leen la caché de salidas y los resultados de scripts/calibrar-modelo.ts, y vuelven a calcular de ellos el
// umbral, el piso de proposición y las latencias. Se corren con `npm run medir` (vitest excluye tests/medicion/** de `verify`).
// Corpus ficticio (10.1.5).
//
// P0-4 (caché única): la caché que se mide es la vista natural de metricas/modelo-x-large-vistas.json (PF-4a: los 29 documentos
// medibles con el texto final). La natural de PF-3 (19 documentos de desarrollo, con otro texto en C02, C06, C17, C27 y C28 desde
// PG-1a-r1 y PG-2-r1) quedó como histórico en metricas/historico/pf3-x-large-natural.json: de ella solo se comprueba la procedencia.
// T-AB-03 se recalcula con el texto final sobre los 19 de desarrollo (la calibración nunca mira la reserva) y se confirma en la
// reserva aparte (metricas/calibracion-reserva.json, `node scripts/calibrar-modelo.ts confirmar`).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  barridoAlto, cargarCorpus, confirmarCalibracion, confirmarConjunto, deteccionesDe, elegirAlto, elegirUmbral, evaluarUmbral, huellaMotor, mediana,
  percentil, UMBRALES,
} from '../../scripts/calibrar-modelo.ts';
import type { CacheModelo, ConfirmacionCalibracion, DocumentoCache, FilaAlto, FilaUmbral, ParteTexto } from '../../scripts/calibrar-modelo.ts';
import {
  archivoVistasDe, armarEvaluacion, ARCHIVO_VISTAS, ARCHIVO_VISTAS_X_BASE, compararRespaldo, compararVentanas, DOCUMENTOS_T_AB_06, evaluarVista,
  filasDe, filasDeCierre, FILAS_T_AB_04, GRUPOS_T_AB_01, huellaTextoDeCache, matrizConfusion, posibleSobreajuste, reutilizarNatural, tablaRespaldo,
  TOLERANCIA_PUNTAJE, verificarCache, vistaDeTexto,
  cajaDe, completarSufijo, entradaModelo, indiceDeEntradas, restaurarMayusculas, resumirExperimento, segmentosFrase, segmentosLinea, segmentosParrafo, tablaExperimento, VERSION_RESTAURAR,
  huellaMayusculas, PREPROCESO_PRODUCTO,
} from '../../scripts/evaluar-modelo.ts';
import type { ArchivoVistas, CacheVista, ComparacionRespaldo, EvaluacionModelo, FilasPorConjunto } from '../../scripts/evaluar-modelo.ts';
import type { EntradaDocumento, GoldAnnotation, GoldDocument, MetricsRow } from '../../scripts/metrics.ts';
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
  cache: { modelo: string; huella: CacheModelo['huella']; documentos: number };
}
const { ids: IDS, textos, golds: GOLDS } = cargarCorpus(RAIZ);
/** Caché natural de PF-3 (19 documentos de desarrollo), histórica desde P0-4: solo se comprueba de ella la procedencia. */
const CACHE_PF3_HISTORICA = 'metricas/historico/pf3-x-large-natural.json';
const CALIBRACION = 'metricas/calibracion-umbral.json';
/** Confirmación de P0-4 (`node scripts/calibrar-modelo.ts confirmar`): desarrollo con el texto final y reserva, aparte. */
const CONFIRMACION = 'metricas/calibracion-reserva.json';
const DESARROLLO = IDS.filter((id) => GOLDS[id]?.conjunto === 'desarrollo');
const RESERVA = IDS.filter((id) => GOLDS[id]?.conjunto === 'reserva');
const shaTexto = (t: string): string => createHash('sha256').update(t).digest('hex');
/** La caché que se mide: la vista natural del archivo combinado de PF-4a (la caché única de P0-4). */
const naturalDeVistas = (): CacheModelo => (leer<ArchivoVistas>(ARCHIVO_VISTAS).vistas.natural as CacheModelo);

describe('T-AB-03 · calibración con las salidas guardadas de x-large (vista natural)', () => {
  const cache = naturalDeVistas();
  const cal = leer<Calibracion>(CALIBRACION);

  it('T-AB-03 la caché de salidas es de x-large en vista natural, guarda desde 0,1 y trae los 29 documentos medibles: 19 de desarrollo y 10 de reserva', () => {
    expect(cache).toMatchObject({ formato: 'sig-low/cache-modelo', v: 1, modelo: 'x-large', vista: 'natural', etiquetas: 'estandar', piso: 0.1 });
    expect(Object.keys(cache.documentos).sort()).toEqual(IDS);
    expect(IDS.length).toBe(29); // los 30 del corpus menos C04 (PDF escaneado, sin texto que medir)
    expect(IDS).not.toContain('C04');
    expect(GOLDS['C04']?.conjunto).toBe('desarrollo');
    expect(DESARROLLO.length).toBe(19); // los 20 de desarrollo menos C04
    expect(RESERVA.length).toBe(10);
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

  it('T-AB-03 la huella de la caché coincide con el texto canónico de los 29 documentos y con el código del motor actuales (si no, la caché es inválida: R-26)', () => {
    for (const id of IDS) {
      const ps = textos[id] ?? [];
      expect(Object.keys(cache.documentos[id]?.partes ?? {}), id).toEqual(ps.map((p) => p.clave));
      for (const p of ps) expect(cache.documentos[id]?.partes[p.clave]?.sha256, `${id} ${p.clave}`).toBe(shaTexto(p.texto));
    }
    expect(cache.huella.codigo).toBe(huellaMotor(RAIZ));
  });

  it('T-AB-03 la calibración de PF-3 salió de su caché natural (histórica, solo desarrollo), que no se mide porque cinco documentos cambiaron de texto', () => {
    const pf3 = leer<CacheModelo>(CACHE_PF3_HISTORICA);
    expect(pf3).toMatchObject({ formato: 'sig-low/cache-modelo', modelo: 'x-large', vista: 'natural', etiquetas: 'estandar', piso: 0.1 });
    expect(cal.cache).toMatchObject({ modelo: 'x-large', documentos: 19 });
    expect(cal.cache.huella).toEqual(pf3.huella);
    expect(Object.keys(pf3.documentos).sort()).toEqual(DESARROLLO); // PF-3 calibró sin mirar la reserva (D-01)
    // Los documentos cuyo texto cambió después de PF-3 (PG-1a-r1, PG-2-r1) ya no reproducen su huella; la vista natural de PF-4a los pasó de nuevo.
    const cambiados = DESARROLLO.filter((id) => (textos[id] ?? []).some((p) => pf3.documentos[id]?.partes[p.clave]?.sha256 !== shaTexto(p.texto)));
    expect(cambiados).toEqual(['C02', 'C06', 'C17', 'C27', 'C28']);
    const procedencia = (cache as CacheVista).procedencia ?? {};
    // PF-3-r1b: la vista natural también se pasó de nuevo donde la restauración por párrafos cambia el texto que llega al modelo.
    const restaurados = DESARROLLO.filter((id) => (textos[id] ?? []).some((p) => entradaModelo(p.texto, 'natural', PREPROCESO_PRODUCTO) !== p.texto));
    expect(restaurados.length).toBeGreaterThan(0);
    expect(DESARROLLO.filter((id) => !(id in procedencia))).toEqual(DESARROLLO.filter((id) => cambiados.includes(id) || restaurados.includes(id)));
  });

  it('T-AB-03 (a) con el texto final, el piso registrado sigue saliendo de la caché en los 19 de desarrollo: mayor F2 de PER y ORG con precisión global >= 0,70', () => {
    const filas = UMBRALES.map((u) => evaluarUmbral(cache, GOLDS, u, DESARROLLO));
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
    // La confirmación de P0-4 guarda las mismas cifras que se recalculan. Las de calibracion-umbral.json son del texto de PF-3, que
    // ya no se puede reproducir con el gold final (ver la prueba de procedencia); su elección sí, y es la misma.
    const conf = leer<ConfirmacionCalibracion>(CONFIRMACION);
    expect(conf.desarrollo.docs).toEqual(DESARROLLO);
    expect(conf.desarrollo.barridoUmbral.filter((f) => (UMBRALES as readonly number[]).includes(f.umbral)).map((f) => [f.umbral, f.detecciones, f.verdaderas]))
      .toEqual(filas.map((f) => [f.umbral, f.detecciones, f.verdaderas]));
    expect(conf.desarrollo.seleccion.umbral).toBe(cal.seleccion.umbral);
  });

  it('T-AB-03 (b) con el gold final (RG-r1), el menor valor con precisión >= 0,90 en el desarrollo es 0,38; la banda del producto se queda en 0,37 por D-06 y queda 0,002 por debajo', () => {
    expect(cal.altoAlcanzable).toBe(true);
    const alto = cal.nerHighThreshold as number;
    expect(alto).toBe(0.37); // D-06, decisión 2: la banda no se mueve (cambiarla sería ajustarla con lo medido después de elegirla)
    expect(alto).toBeGreaterThanOrEqual(cal.nerMinScore);
    const candidatos = Array.from({ length: Math.round((0.99 - cal.nerMinScore) * 100) + 1 }, (_, i) => Math.round((cal.nerMinScore + i * 0.01) * 100) / 100);
    const filas = barridoAlto(cache, GOLDS, cal.nerMinScore, candidatos, DESARROLLO);
    // Con el gold anterior a RG-r1 el menor valor era 0,37 (precisión 0,907). Con el final es 0,38, y 0,37 da 952 de 1.060 = 0,898.
    const elegido = elegirAlto(filas, 0.9);
    expect(elegido?.umbral).toBe(0.38);
    for (const f of filas.filter((x) => x.umbral < 0.38)) expect(f.precision).toBeLessThan(0.9);
    const enLaBanda = filas.find((f) => f.umbral === alto) as FilaAlto;
    expect([enLaBanda.verdaderas, enLaBanda.tramos]).toEqual([952, 1060]);
    expect(enLaBanda.precision).toBeGreaterThanOrEqual(0.89);
    expect(enLaBanda.precision).toBeLessThan(0.9);
    expect(0.9 - enLaBanda.precision).toBeLessThan(0.0025);
  });
});

// ---------------------------------------------------------------------------------------------------------------- P0-4 · T-AB-03 en la reserva
describe('T-AB-03 · confirmación del umbral y de la banda en la reserva (P0-4, funciones puras)', () => {
  it('T-AB-03 confirmarConjunto aplica la regla de (a) y mide la banda calibrada, con cifras calculadas a mano en el gold de juguete', () => {
    // Piso 0,4: 4 tramos (0,95 v, 0,45 v, 0,70 v, 0,60 f), precisión 0,75; la regla elige 0,4 (la única con precisión >= 0,70).
    const a = confirmarConjunto(CACHE, { T01: GOLD }, ['T01'], 0.4, 0.7);
    expect(a.seleccion).toMatchObject({ umbral: 0.4, cumplePrecision: true });
    expect(a.confirmaUmbral).toBe(true);
    expect(a.enElUmbral).toMatchObject({ umbral: 0.4, detecciones: 4, verdaderas: 3 });
    expect(a.enLaBanda).toMatchObject({ umbral: 0.7, tramos: 2, verdaderas: 2, precision: 1 }); // 0,95 y 0,70
    expect(a.confirmaBanda).toBe(true);
    expect(a.alto?.umbral).toBe(0.61); // desde 0,61 solo quedan 0,95 y 0,70
    // Con el piso 0,3 la regla elige 0,4 (a 0,3 la precisión es 0,6): el piso no se confirma; la banda 0,5 da 2 de 3 y tampoco.
    const b = confirmarConjunto(CACHE, { T01: GOLD }, ['T01'], 0.3, 0.5);
    expect(b.confirmaUmbral).toBe(false);
    expect(b.enLaBanda).toMatchObject({ tramos: 3, verdaderas: 2 });
    expect(b.confirmaBanda).toBe(false);
    // Un documento que no está en la caché no se mide.
    expect(confirmarConjunto(CACHE, { T01: GOLD }, ['T01', 'T09'], 0.4, 0.7).docs).toEqual(['T01']);
  });

  it('T-AB-03 confirmarCalibracion separa el desarrollo de la reserva por el conjunto del gold y confirma solo si la reserva confirma piso y banda', () => {
    const reserva: GoldDocument = { ...GOLD, docId: 'T02', conjunto: 'reserva' };
    const cache: CacheModelo = { ...CACHE, documentos: { T01: CACHE.documentos['T01'] as DocumentoCache, T02: CACHE.documentos['T01'] as DocumentoCache } };
    const c = confirmarCalibracion(cache, 'prueba', { T01: GOLD, T02: reserva }, { nerMinScore: 0.4, nerHighThreshold: 0.7 }, '2026-10-31 00:00:00');
    expect([c.desarrollo.docs, c.reserva.docs]).toEqual([['T01'], ['T02']]);
    expect(c.confirmada).toBe(true);
    expect(c.etiquetas.nota).toContain('no se repite en la reserva');
    expect(confirmarCalibracion(cache, 'prueba', { T01: GOLD, T02: reserva }, { nerMinScore: 0.4, nerHighThreshold: 0.5 }, 'f').confirmada).toBe(false);
    expect(() => confirmarCalibracion({ ...cache, vista: 'mayusculas' }, 'prueba', { T01: GOLD }, { nerMinScore: 0.4, nerHighThreshold: 0.7 }, 'f')).toThrow('VISTA_NO_NATURAL');
  });
});

describe('T-AB-03 · confirmación de la calibración en la reserva con las salidas guardadas (P0-4)', () => {
  const cache = naturalDeVistas();
  const cal = leer<Calibracion>(CALIBRACION);
  const conf = leer<ConfirmacionCalibracion>(CONFIRMACION);

  it('T-AB-03 la confirmación guardada usa el umbral y la banda de PF-3 y la vista natural de la caché única, con el desarrollo y la reserva aparte', () => {
    expect(conf).toMatchObject({ formato: 'sig-low/confirmacion-calibracion', v: 1, minPrecisionGlobal: 0.7, minPrecisionBanda: 0.9 });
    expect(conf.calibrado).toMatchObject({ nerMinScore: cal.nerMinScore, nerHighThreshold: cal.nerHighThreshold });
    expect(conf.cache).toMatchObject({ modelo: 'x-large', vista: 'natural', etiquetas: 'estandar', documentos: 29 });
    expect(conf.cache.huella).toEqual(cache.huella);
    expect(conf.desarrollo.docs).toEqual(DESARROLLO);
    expect(conf.reserva.docs).toEqual(RESERVA);
  });

  it('T-AB-03 la confirmación guardada se recalcula igual desde la caché y el gold', () => {
    expect(confirmarCalibracion(cache, conf.cache.archivo, GOLDS, conf.calibrado, conf.fecha)).toEqual(conf);
  });

  it('T-AB-03 en la reserva, la regla de (a) elige el mismo nerMinScore con precisión global >= 0,70: el piso se confirma', () => {
    expect(conf.reserva.seleccion).toMatchObject({ umbral: cal.nerMinScore, cumplePrecision: true });
    expect(conf.reserva.enElUmbral.precisionGlobal).toBeGreaterThanOrEqual(0.7);
    expect(conf.reserva.confirmaUmbral).toBe(true);
  });

  it('T-AB-03 la banda queda registrada con su precisión en cada conjunto y solo se da por confirmada con precisión >= 0,90 en la reserva', () => {
    for (const x of [conf.desarrollo, conf.reserva]) {
      expect(x.enLaBanda.umbral).toBe(cal.nerHighThreshold);
      expect(x.confirmaBanda).toBe(x.enLaBanda.tramos > 0 && x.enLaBanda.precision >= 0.9);
    }
    // Con el gold final (RG-r1) el desarrollo ya no confirma la banda de 0,37 (0,898); la reserva tampoco (0,859). El piso se confirma en los dos.
    // D-06 mantiene la banda: la confirmación queda declarada como «no confirmada» y no cambia el producto (prueba siguiente).
    expect(conf.desarrollo.confirmaUmbral && conf.reserva.confirmaUmbral).toBe(true);
    expect(conf.desarrollo.confirmaBanda).toBe(false);
    expect(conf.desarrollo.enLaBanda).toMatchObject({ tramos: 1060, verdaderas: 952 });
    expect(conf.desarrollo.alto?.umbral).toBe(0.38);
    expect(conf.reserva.confirmaBanda).toBe(false);
    expect(conf.reserva.enLaBanda).toMatchObject({ tramos: 548, verdaderas: 471 });
    expect(conf.reserva.alto?.umbral).toBe(0.44);
    expect(conf.confirmada).toBe(conf.reserva.confirmaUmbral && conf.reserva.confirmaBanda);
    expect(conf.confirmada).toBe(false);
  });

  it('T-AB-03 la reserva no cambia el umbral ni la banda del producto: siguen siendo los de PF-3', async () => {
    const { UMBRALES_MODELO } = await import('../../src/core/umbrales.ts');
    expect(UMBRALES_MODELO).toEqual({ nerHighThreshold: cal.nerHighThreshold, nerMinScore: cal.nerMinScore });
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

// =================================================================================================================================
// PF-4a · T-AB-01 (exhaustividad de PER, ORG y LOC por vista) y T-AB-06 (la caché reproduce una pasada nueva)
// =================================================================================================================================

// ---------------------------------------------------------------------------------------------------------------- vista
describe('T-AB-01 · la vista de medición (MAYÚSCULAS y minúsculas) conserva la longitud del texto canónico', () => {
  const MUESTRA = 'Señora Ana Ficticia Muñoz, identificada con C.C. 0000000000 de Villa Ejemplo, ñandú ÁÉÍÓÚ Ü straße İstanbul 𝔘\nLínea  dos';

  it('T-AB-01 INV-W04 la vista natural devuelve el texto tal cual', () => {
    expect(vistaDeTexto(MUESTRA, 'natural')).toBe(MUESTRA);
  });

  it('T-AB-01 INV-W04 MAYÚSCULAS y minúsculas dan la misma longitud, así que las posiciones del canónico valen en la vista', () => {
    for (const vista of ['mayusculas', 'minusculas'] as const) {
      const v = vistaDeTexto(MUESTRA, vista);
      expect(v.length, vista).toBe(MUESTRA.length);
      // Cada posición que no cambia de forma (dígitos, espacios, saltos) sigue en el mismo sitio.
      for (let i = 0; i < MUESTRA.length; i++) if (/[\d\s,.]/u.test(MUESTRA[i] as string)) expect(v[i]).toBe(MUESTRA[i]);
    }
  });

  it('T-AB-01 INV-W04 pasa a mayúsculas y a minúsculas solo los caracteres que conservan la longitud (la «ß» y la «İ» se quedan)', () => {
    expect(vistaDeTexto('Ana Muñoz ÁÉ', 'mayusculas')).toBe('ANA MUÑOZ ÁÉ');
    expect(vistaDeTexto('Ana Muñoz ÁÉ', 'minusculas')).toBe('ana muñoz áé');
    expect(vistaDeTexto('straße', 'mayusculas')).toBe('STRAßE'); // «ß».toUpperCase() es «SS»: cambiaría la longitud
    expect(vistaDeTexto('İ', 'minusculas')).toBe('İ'); // «İ».toLowerCase() es «i̇» (dos unidades)
    expect(vistaDeTexto('𝔘x', 'minusculas')).toBe('𝔘x'); // pares sustitutos: se conserva la longitud en unidades UTF-16
  });
});

// PF-3-r1 · experimento de mayúsculas (D-06, decisión 6): restauración de mayúsculas (b), índice de entradas y decisión
// =================================================================================================================================
describe('T-AB-01 · PF-3-r1 restauración de mayúsculas antes del modelo (experimento (b), funciones puras)', () => {
  const ENCABEZADO = 'ACCIONANTE: ANA FICTICIA ROJAS, C.C. 0000000001\nACCIONADA: COMERCIALIZADORA EJEMPLO S.A.S. Y LA EPS PRUEBA';

  it('T-AB-01 INV-W04 MAYÚSCULAS: Title Case con las palabras de función en minúscula, siglas con punto e iniciales en mayúscula, misma longitud', () => {
    const r = restaurarMayusculas(ENCABEZADO);
    expect(r).toBe('Accionante: Ana Ficticia Rojas, C.C. 0000000001\nAccionada: Comercializadora Ejemplo S.A.S. Y la Eps Prueba');
    expect(r.length).toBe(ENCABEZADO.length);
  });

  it('T-AB-01 INV-W04 minúsculas: la frase entera pasa a Title Case; la primera palabra de la frase va con mayúscula aunque sea de función', () => {
    const t = 'el señor pedro ejemplo de la cruz demandó a ferretería ejemplo ltda. ante el juzgado primero civil.';
    const r = restaurarMayusculas(t);
    expect(r).toBe('El señor Pedro Ejemplo de la Cruz Demandó a Ferretería Ejemplo Ltda. Ante el Juzgado Primero Civil.');
    expect(r.length).toBe(t.length);
  });

  it('T-AB-01 INV-W04 el mismo texto en MAYÚSCULAS y en minúsculas queda igual (no depende de la caja de origen), con códigos en mayúsculas', () => {
    const t = 'Señora Ana Ficticia Muñoz, placa ABC123, documento C04.\nCalle Ejemplo de Prueba';
    const may = restaurarMayusculas(vistaDeTexto(t, 'mayusculas'));
    expect(restaurarMayusculas(vistaDeTexto(t, 'minusculas'))).toBe(may);
    expect(may).toBe('Señora Ana Ficticia Muñoz, Placa ABC123, Documento C04.\nCalle Ejemplo de Prueba');
  });

  it('T-AB-01 INV-W04 el texto natural queda igual salvo las líneas enteras en MAYÚSCULAS; una línea en minúsculas dentro de un párrafo no se toca', () => {
    const t = 'Texto natural con una línea\npartida en minúsculas por el PDF\ny ANA FICTICIA ROJAS en mayúsculas.\nANA FICTICIA ROJAS\nC.C. 0000000001';
    const r = restaurarMayusculas(t);
    expect(r).toBe('Texto natural con una línea\npartida en minúsculas por el PDF\ny ANA FICTICIA ROJAS en mayúsculas.\nAna Ficticia Rojas\nC.C. 0000000001');
    expect(restaurarMayusculas('Ana Ficticia Rojas presentó la tutela contra Comercial Ejemplo S.A.')).toBe('Ana Ficticia Rojas presentó la tutela contra Comercial Ejemplo S.A.');
  });

  it('T-AB-01 INV-W04 los caracteres que cambian de longitud al cambiar de caja (ß, İ, ligaduras) se quedan; guiones, apóstrofos y marcas combinantes conservan su sitio', () => {
    const t = 'STRAßE EJEMPLO İSTANBUL ROJAS-EJEMPLO D’EJEMPLO ﬁCTICIA MUN\u{303}OZ';
    const r = restaurarMayusculas(t);
    expect(r).toBe('Straße Ejemplo İstanbul Rojas-Ejemplo D’Ejemplo ﬁcticia Mun\u{303}oz');
    expect(r.length).toBe(t.length);
    for (let i = 0; i < t.length; i++) {
      const a = t[i] as string;
      const b = r[i] as string;
      expect(b === a || b === a.toUpperCase() || b === a.toLowerCase(), `posición ${i}`).toBe(true);
    }
  });

  it('T-AB-01 INV-W04 los tramos sobre el texto restaurado valen en el canónico: mismas posiciones de palabras (R-MOD-01) y mismo texto plegado', () => {
    const t = vistaDeTexto('Señor Juez: la accionante Ana Ficticia Rojas, de Villa Ejemplo,  con  dos espacios\n\ny un salto doble.', 'mayusculas');
    const r = restaurarMayusculas(t);
    const palabras = (x: string): Array<[number, number]> => [...x.matchAll(/[\p{L}\p{M}\p{N}_]+|[^\s]/gu)].map((m) => [m.index, m.index + m[0].length]);
    expect(palabras(r)).toEqual(palabras(t));
    expect(r.toLowerCase()).toBe(t.toLowerCase());
    expect(cajaDe(r)).toBe('mixta');
  });

  it('T-AB-01 INV-W04 (b′) solo restaura párrafos enteros en MAYÚSCULAS o en minúsculas, y en un texto uniforme da lo mismo que (b)', () => {
    const t = 'HECHOS\n\nEl señor ANA FICTICIA ROJAS presentó.\nANA ROJAS\n\nojo que blanca ejemplo vino';
    const r = restaurarMayusculas(t, 'parrafos');
    expect(r).toBe('Hechos\n\nEl señor ANA FICTICIA ROJAS presentó.\nANA ROJAS\n\nOjo que Blanca Ejemplo Vino');
    expect(r.length).toBe(t.length);
    expect(segmentosParrafo(t)).toEqual([[0, 6], [8, 55], [57, 84]]);
    for (const vista of ['mayusculas', 'minusculas'] as const) {
      expect(entradaModelo(ENCABEZADO, vista, 'restaurar-parrafos'), vista).toBe(entradaModelo(ENCABEZADO, vista, 'restaurar'));
    }
  });

  it('T-AB-01 la caja de un segmento ignora los caracteres sin caja convertible, y la entrada al modelo es la vista con el preproceso encima', () => {
    expect(cajaDe('ROJAS 2026')).toBe('may');
    expect(cajaDe('STRAßE')).toBe('may');
    expect(cajaDe('rojas, 2026')).toBe('min');
    expect(cajaDe('2026 - 01')).toBe('sin');
    expect(cajaDe('Rojas')).toBe('mixta');
    expect(entradaModelo('Ana Ficticia', 'minusculas', 'ninguno')).toBe('ana ficticia');
    expect(entradaModelo('Ana Ficticia', 'minusculas', 'restaurar')).toBe('Ana Ficticia');
    expect(entradaModelo('Ana FICTICIA', 'natural', 'restaurar')).toBe('Ana FICTICIA');
    expect(segmentosLinea('A: B\nC. D')).toEqual([[0, 2], [2, 4], [5, 7], [7, 9]]);
    expect(segmentosFrase('a b\nc. d\n\ne')).toEqual([[0, 6], [6, 10], [10, 11]]);
  });
});

describe('T-AB-01 · PF-3-r1 índice de entradas ya pasadas y decisión del experimento (funciones puras)', () => {
  const textos: Record<string, ParteTexto[]> = { T01: [{ clave: 'cuerpo:1', texto: 'ANA FICTICIA', kind: 'cuerpo', index: 1 }] };
  const sha = (t: string): string => createHash('sha256').update(t).digest('hex');
  const ventanas = [{ windowIndex: 0, windowTotal: 1, spans: [{ start: 0, end: 12, label: 'PER' as const, score: 0.9 }] }];
  const cacheDe = (vista: 'natural' | 'mayusculas' | 'minusculas', extra: Partial<CacheVista> = {}): CacheVista => ({
    ...CACHE, vista, huella: { texto: 'a', vista: 'b', onnx: 'o', codigo: 'c' },
    documentos: { T01: { partes: { 'cuerpo:1': { sha256: sha('ANA FICTICIA'), ventanas } } } }, ...extra,
  });

  it('T-AB-01 el índice guarda cada parte por etiquetas y texto de entrada al modelo; con la restauración, MAYÚSCULAS y minúsculas dan la misma clave', () => {
    const i = indiceDeEntradas([cacheDe('mayusculas', { preproceso: { id: 'restaurar', version: VERSION_RESTAURAR } })], textos, 'o', 'c');
    expect([...i.keys()]).toEqual([`estandar|${sha('Ana Ficticia')}`]);
    expect(entradaModelo('ANA FICTICIA', 'minusculas', 'restaurar')).toBe('Ana Ficticia');
    const j = indiceDeEntradas([cacheDe('natural', { etiquetas: 'traducidas' })], textos, 'o', 'c');
    expect([...j.keys()]).toEqual([`traducidas|${sha('ANA FICTICIA')}`]);
  });

  it('T-AB-01 el índice no toma una caché de otro ONNX, de otro código del motor, de otra versión de la restauración ni una parte con otro texto', () => {
    expect(indiceDeEntradas([cacheDe('natural')], textos, 'otro', 'c').size).toBe(0);
    expect(indiceDeEntradas([cacheDe('natural')], textos, 'o', 'otro').size).toBe(0);
    expect(indiceDeEntradas([cacheDe('natural', { preproceso: { id: 'restaurar', version: 'restaurar-mayusculas@0' } })], textos, 'o', 'c').size).toBe(0);
    expect(indiceDeEntradas([cacheDe('natural')], { T01: [{ clave: 'cuerpo:1', texto: 'OTRO', kind: 'cuerpo', index: 1 }] }, 'o', 'c').size).toBe(0);
  });

  const filaE = (fila: 'PERSONA_FUERA' | 'ORG_FUERA', mencion: number, cumple: boolean) => ({ fila, n: 10, mencion, entidad: mencion, cumple });
  const celdaE = (variante: string, vista: 'natural' | 'mayusculas' | 'minusculas', per: number, org: number, precision = 0.9) => ({
    variante, vista, documentos: 1,
    soloModelo: { filas: [filaE('PERSONA_FUERA', per, per >= 0.85), filaE('ORG_FUERA', org, org >= 0.8)], precisionGlobal: precision, tramos: 10, verdaderos: 9 },
    producto: { filas: [filaE('PERSONA_FUERA', per, per >= 0.85), filaE('ORG_FUERA', org, org >= 0.8)], precisionGlobal: precision, detecciones: 10 },
  });
  const U = { nerMinScore: 0.3, nerHighThreshold: 0.37, fuente: 'prueba' };

  it('T-AB-01 una variante gana solo si las seis filas cumplen, la precisión global no baja de 0,70 y la vista natural no empeora frente a la base', () => {
    const base = [celdaE('base', 'natural', 0.97, 0.92), celdaE('base', 'mayusculas', 0.9, 0.63), celdaE('base', 'minusculas', 0.9, 0.6)];
    const gana = [celdaE('b', 'natural', 0.97, 0.92), celdaE('b', 'mayusculas', 0.9, 0.81), celdaE('b', 'minusculas', 0.9, 0.82)];
    const x = resumirExperimento([...base, ...gana], 'f', U);
    expect(x.decision.ganadora).toBe('b');
    expect(x.resumen.find((r) => r.variante === 'base')?.gana).toBe(false);
    // La vista natural baja 0,01 en ORG: empeora y no gana, aunque las filas cumplan.
    const empeora = [celdaE('b', 'natural', 0.97, 0.91), celdaE('b', 'mayusculas', 0.9, 0.81), celdaE('b', 'minusculas', 0.9, 0.82)];
    const y = resumirExperimento([...base, ...empeora], 'f', U);
    expect(y.resumen.find((r) => r.variante === 'b')?.natural.empeora).toBe(true);
    expect(y.decision.ganadora).toBeNull();
    // Precisión global 0,69: no gana.
    const imprecisa = [celdaE('b', 'natural', 0.97, 0.92), celdaE('b', 'mayusculas', 0.9, 0.81, 0.69), celdaE('b', 'minusculas', 0.9, 0.82)];
    expect(resumirExperimento([...base, ...imprecisa], 'f', U).decision.ganadora).toBeNull();
    // ORG en minúsculas 0,79: no gana.
    const corta = [celdaE('b', 'natural', 0.97, 0.92), celdaE('b', 'mayusculas', 0.9, 0.81), celdaE('b', 'minusculas', 0.9, 0.79)];
    expect(resumirExperimento([...base, ...corta], 'f', U).decision.ganadora).toBeNull();
  });

  it('T-AB-01 la simulación informativa extiende un tramo ORG sobre el punto que completa un sufijo societario, y nada más', () => {
    const texto = 'Banco Ejemplo S.A. y Comercial Prueba Ltda. con Ana Ficticia. Y Fundación Ejemplo.';
    const tramos = [
      { start: 0, end: 17, label: 'ORG' as const, score: 0.7 }, // «Banco Ejemplo S.A» → «Banco Ejemplo S.A.»
      { start: 21, end: 42, label: 'ORG' as const, score: 0.6 }, // «Comercial Prueba Ltda» → «… Ltda.»
      { start: 48, end: 60, label: 'PER' as const, score: 0.9 }, // persona: no se toca
      { start: 64, end: 81, label: 'ORG' as const, score: 0.8 }, // «Fundación Ejemplo»: el punto no es de un sufijo
    ];
    const c: CacheVista = {
      ...CACHE, documentos: { T01: { partes: { 'cuerpo:1': { sha256: 'x', ventanas: [{ windowIndex: 0, windowTotal: 1, spans: tramos }] } } } },
    };
    const re = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:s\. ?a\.?|ltda\.?)$`, 'u');
    const { cache, extendidos } = completarSufijo(c, { T01: [{ clave: 'cuerpo:1', texto, kind: 'cuerpo', index: 1 }] }, re);
    expect(extendidos).toBe(2);
    const fin = cache.documentos['T01']?.partes['cuerpo:1']?.ventanas[0]?.spans.map((s) => texto.slice(s.start, s.end));
    expect(fin).toEqual(['Banco Ejemplo S.A.', 'Comercial Prueba Ltda.', 'Ana Ficticia', 'Fundación Ejemplo']);
    expect(c.documentos['T01']?.partes['cuerpo:1']?.ventanas[0]?.spans[0]?.end).toBe(17); // la caché original no cambia
  });

  it('T-AB-01 la tabla del experimento trae cada variante y vista con su n, sin texto del documento', () => {
    const x = resumirExperimento([celdaE('base', 'natural', 0.97, 0.92), celdaE('base', 'mayusculas', 0.9, 0.63), celdaE('base', 'minusculas', 0.9, 0.6)], 'f', U);
    const t = tablaExperimento(x);
    expect(t).toContain('base      mayusculas');
    expect(t).toContain('(n 10)');
    expect(t).toContain('no se implementa nada');
  });
});

// ---------------------------------------------------------------------------------------------------------------- filas por vista
// Gold de juguete de dos documentos, con cada cifra calculada a mano. T01 (desarrollo): 3 menciones de persona fuera de la lista (E1 con 1,
// E2 con 2), 1 de persona de la lista (E3), 2 de organización fuera (EPS y empresa), 1 de ubicación. T02 (reserva): 1 negativo esperado.
function annT(id: string, doc: string, tipo: DataType, start: number, end: number, entidad: string, enLista = false, negativo = false): GoldAnnotation {
  return {
    id: `${doc}-${id}`, docId: doc, parte: { kind: 'cuerpo', index: 1 }, start, end, texto: 'x'.repeat(end - start), tipo, entidad: `${doc}-${entidad}`,
    debe_generalizarse: false, es_negativo_esperado: negativo, estructura: 'no_aplica', enLista, rotulado: false, caracteristicas: [],
  };
}
const ENTIDAD_T = (doc: string, id: string, tipo: DataType, enLista = false): GoldDocument['entidades'][number] =>
  ({ id: `${doc}-${id}`, tipo, canonico: 'c', mismoTitular: [], enLista });
const GOLD_T01: GoldDocument = {
  docId: 'T01', conjunto: 'desarrollo',
  entidades: [
    ENTIDAD_T('T01', 'E1', 'PERSONA'), ENTIDAD_T('T01', 'E2', 'PERSONA'), ENTIDAD_T('T01', 'E3', 'PERSONA', true),
    ENTIDAD_T('T01', 'E4', 'EPS'), ENTIDAD_T('T01', 'E5', 'EMPRESA'), ENTIDAD_T('T01', 'E6', 'LUGAR'),
  ],
  anotaciones: [
    annT('P1', 'T01', 'PERSONA', 0, 10, 'E1'), annT('P2', 'T01', 'PERSONA', 20, 30, 'E2'), annT('P3', 'T01', 'PERSONA', 40, 50, 'E2'),
    annT('P4', 'T01', 'PERSONA', 60, 70, 'E3', true), annT('O1', 'T01', 'EPS', 80, 90, 'E4'), annT('O2', 'T01', 'EMPRESA', 100, 110, 'E5'),
    annT('L1', 'T01', 'LUGAR', 120, 130, 'E6'),
  ],
};
const GOLD_T02: GoldDocument = {
  docId: 'T02', conjunto: 'reserva',
  entidades: [ENTIDAD_T('T02', 'E1', 'PERSONA')],
  anotaciones: [annT('P1', 'T02', 'PERSONA', 0, 10, 'E1'), annT('N1', 'T02', 'LUGAR', 300, 310, 'N1', false, true)],
};
const det = (id: string, tipo: 'PERSONA' | 'ENTIDAD' | 'LUGAR', start: number, end: number) => ({ id, parte: 'cuerpo:1', start, end, tipo, entidad: '' });
const ENTRADA_T01: EntradaDocumento = {
  gold: GOLD_T01, banderas: [], sugerencias: [], paginas: 1,
  detecciones: [
    det('d1', 'PERSONA', 0, 10), det('d2', 'PERSONA', 20, 30), det('d3', 'PERSONA', 60, 70), det('d4', 'ENTIDAD', 80, 90),
    det('d5', 'LUGAR', 120, 130), det('d6', 'PERSONA', 200, 210),
  ],
};
// T02: el modelo cubre la persona y marca como organización el negativo esperado.
const ENTRADA_T02: EntradaDocumento = {
  gold: GOLD_T02, banderas: [], sugerencias: [], paginas: 1, detecciones: [det('e1', 'PERSONA', 0, 10), det('e2', 'ENTIDAD', 300, 310)],
};
const fila = (filas: readonly MetricsRow[], g: string): MetricsRow => filas.find((f) => f.grupo === g) as MetricsRow;

describe('T-AB-01 · exhaustividad por mención y por entidad de personas, organizaciones y ubicaciones (gold de juguete)', () => {
  const filas = filasDe([ENTRADA_T01], 'todo');

  it('T-AB-01 las siete filas son las de la tarjeta: personas y organizaciones dentro y fuera de la lista, todas, y ubicaciones', () => {
    expect(GRUPOS_T_AB_01.map((g) => g.grupo)).toEqual(['PERSONA_FUERA', 'ORG_FUERA', 'PERSONA_LISTA', 'ORG_LISTA', 'PERSONA_TODAS', 'ORG_TODAS', 'LOC_TODAS']);
    expect(filas.map((f) => f.grupo)).toEqual(GRUPOS_T_AB_01.map((g) => g.grupo));
  });

  it('T-AB-01 personas fuera de la lista: R = 2/3 (P1 y P2 cubiertas, P3 no), entidad estricta 1/2 (E2 queda a medias), P = 2/3 y F2 = 2/3', () => {
    const f = fila(filas, 'PERSONA_FUERA');
    expect([f.n, f.cubiertas]).toEqual([3, 2]);
    expect(f.exhaustividadMencion).toBeCloseTo(2 / 3, 9);
    expect([f.entidades, f.exhaustividadEntidadEstricta, f.exhaustividadEntidadLaxa]).toEqual([2, 0.5, 1]);
    // Detecciones del grupo: d1 y d2 verdaderas, d6 falsa; d3 es verdadera pero de una mención de la lista: no cuenta en esta fila.
    expect([f.detecciones, f.verdaderas, f.falsas]).toEqual([3, 2, 1]);
    expect(f.precision).toBeCloseTo(2 / 3, 9);
    expect(f.f2).toBeCloseTo(2 / 3, 9);
    expect(f.idsNoCubiertas).toEqual(['T01-P3']); // ids de anotación, nunca el texto
  });

  it('T-AB-01 personas de la lista: R = 1 (P4), P = 1/2 (d3 verdadera, d6 falsa) y F2 = 5/6', () => {
    const f = fila(filas, 'PERSONA_LISTA');
    expect([f.n, f.cubiertas, f.exhaustividadMencion]).toEqual([1, 1, 1]);
    expect(f.precision).toBeCloseTo(0.5, 9);
    expect(f.f2).toBeCloseTo(5 / 6, 9);
  });

  it('T-AB-01 personas, todas: R = P = 3/4 y F2 = 3/4', () => {
    const f = fila(filas, 'PERSONA_TODAS');
    expect([f.n, f.cubiertas]).toEqual([4, 3]);
    expect(f.exhaustividadMencion).toBeCloseTo(0.75, 9);
    expect(f.precision).toBeCloseTo(0.75, 9);
    expect(f.f2).toBeCloseTo(0.75, 9);
  });

  it('T-AB-01 organizaciones fuera de la lista: R = 1/2 (EPS cubierta, empresa no), P = 1 y F2 = 5/9; la lista no tiene menciones', () => {
    const f = fila(filas, 'ORG_FUERA');
    expect([f.n, f.cubiertas, f.entidades, f.exhaustividadEntidadEstricta]).toEqual([2, 1, 2, 0.5]);
    expect([f.precision, f.exhaustividadMencion]).toEqual([1, 0.5]);
    expect(f.f2).toBeCloseTo(5 / 9, 9);
    expect(fila(filas, 'ORG_LISTA').n).toBe(0);
  });

  it('T-AB-01 ubicaciones (LOC): R = 1, P = 1 y F2 = 1', () => {
    const f = fila(filas, 'LOC_TODAS');
    expect([f.n, f.cubiertas, f.precision, f.f2]).toEqual([1, 1, 1, 1]);
  });

  it('T-AB-01 el conjunto de desarrollo y el de reserva se calculan aparte (la reserva se informa aparte, 10.4.1)', () => {
    const entradas = [ENTRADA_T01, ENTRADA_T02];
    expect(fila(filasDe(entradas, 'desarrollo'), 'PERSONA_TODAS').n).toBe(4);
    const r = fila(filasDe(entradas, 'reserva'), 'PERSONA_TODAS');
    expect([r.n, r.cubiertas, r.exhaustividadMencion]).toEqual([1, 1, 1]);
    expect(fila(filasDe(entradas, 'todo'), 'PERSONA_TODAS').n).toBe(5);
  });
});

describe('T-AB-01 · matriz de confusión del modelo solo (gold de juguete)', () => {
  const m = matrizConfusion([ENTRADA_T01, ENTRADA_T02]);

  it('T-AB-01 cada mención positiva cae en la etiqueta del tramo del modelo que más la cubre, o en «ninguna»', () => {
    expect(m.menciones['personas']).toEqual({ PER: 4, ORG: 0, LOC: 0, ninguna: 1 }); // T01: P1, P2, P4; T02: P1; sin cubrir: P3
    expect(m.menciones['organizaciones']).toEqual({ PER: 0, ORG: 1, LOC: 0, ninguna: 1 }); // O1 sí, O2 no
    expect(m.menciones['ubicacion']).toEqual({ PER: 0, ORG: 0, LOC: 1, ninguna: 0 });
  });

  it('T-AB-01 los tramos del modelo sin mención positiva se cuentan aparte, y los que tocan un negativo esperado también', () => {
    expect(m.sinMencion).toEqual({ PER: 1, ORG: 0, LOC: 0 }); // d6
    expect(m.enNegativos).toEqual({ PER: 0, ORG: 1, LOC: 0 }); // e2 sobre N1
  });

  it('T-AB-01 una persona detectada como organización es una confusión PER -> ORG', () => {
    const e: EntradaDocumento = { ...ENTRADA_T01, detecciones: [det('x', 'ENTIDAD', 0, 10)] };
    expect(matrizConfusion([e]).menciones['personas']).toEqual({ PER: 0, ORG: 1, LOC: 0, ninguna: 3 });
  });
});

describe('T-AB-01 · filas por vista de 10.4.1 (personas 0,85 y 0,75; organizaciones 0,80 y 0,70) con el umbral de PF-3', () => {
  const base = (grupo: string, n: number, cubiertas: number, entidades: number, estrictas: number): MetricsRow => ({
    grupo, n, cubiertas, exhaustividadMencion: n === 0 ? 0 : cubiertas / n, exhaustividadTipificada: 0, entidades,
    exhaustividadEntidadEstricta: entidades === 0 ? 0 : estrictas / entidades, exhaustividadEntidadLaxa: 0, detecciones: 0, verdaderas: 0, falsas: 0,
    precision: 0, f2: 0, coincidenciaExacta: 0, idsNoCubiertas: Array.from({ length: n - cubiertas }, (_, i) => `D-${i}`),
  });

  it('T-AB-01 personas: 17 de 20 (0,85) con 6 de 8 entidades (0,75) cumple, con 3 omisiones permitidas y 3 usadas', () => {
    const [p] = filasDeCierre('mayusculas', [base('PERSONA_FUERA', 20, 17, 8, 6), base('ORG_FUERA', 10, 8, 5, 4)]);
    expect(p).toMatchObject({ fila: 'PERSONA_FUERA', vista: 'mayusculas', cumple: true });
    expect(p?.mencion).toMatchObject({ umbral: 0.85, n: 20, cubiertas: 17, omisionesPermitidas: 3, omisiones: 3, cumple: true });
    expect(p?.entidad).toMatchObject({ umbral: 0.75, n: 8, cumple: true });
    expect(p?.idsNoCubiertas).toHaveLength(3);
  });

  it('T-AB-01 personas: 16 de 20 (0,80) no cumple; con 5 de 8 entidades (0,625) tampoco', () => {
    expect(filasDeCierre('natural', [base('PERSONA_FUERA', 20, 16, 8, 6)])[0]?.cumple).toBe(false);
    const e = filasDeCierre('natural', [base('PERSONA_FUERA', 20, 18, 8, 5)])[0];
    expect(e?.mencion.cumple).toBe(true);
    expect(e?.entidad.cumple).toBe(false);
    expect(e?.cumple).toBe(false);
  });

  it('T-AB-01 organizaciones: 8 de 10 (0,80) con 7 de 10 entidades (0,70) cumple justo en el umbral; 7 de 10 no', () => {
    expect(filasDeCierre('minusculas', [base('ORG_FUERA', 10, 8, 10, 7)])[0]).toMatchObject({ cumple: true });
    expect(filasDeCierre('minusculas', [base('ORG_FUERA', 10, 7, 10, 7)])[0]?.cumple).toBe(false);
  });

  it('T-AB-01 la evaluación cierra solo si las seis filas (dos por cada una de las tres vistas) cumplen', () => {
    const vacia: FilasPorConjunto = { todo: [], desarrollo: [], reserva: [] };
    const vista = (n: number): ReturnType<typeof evaluarVista> => {
      const e = evaluarVista('natural', [], []);
      const p: FilasPorConjunto = { ...vacia, todo: [base('PERSONA_FUERA', 20, n, 8, 6), base('ORG_FUERA', 10, 8, 10, 7)] };
      return { ...e, producto: p, cierre: filasDeCierre('natural', p.todo), cierreSoloModelo: [] };
    };
    const corpus = { documentos: 2, desarrollo: 1, reserva: 1, origen: 'prueba' };
    const umbrales = { nerMinScore: 0.3, nerHighThreshold: 0.37, fuente: 'prueba' };
    const bien = armarEvaluacion({ natural: vista(17), mayusculas: vista(17), minusculas: vista(17) }, corpus, umbrales, '2026-10-30 00:00:00');
    expect(bien.cierra).toBe(true);
    const mal = armarEvaluacion({ natural: vista(17), mayusculas: vista(15), minusculas: vista(17) }, corpus, umbrales, '2026-10-30 00:00:00');
    expect(mal.cierra).toBe(false);
    expect(armarEvaluacion({ natural: vista(17) }, corpus, umbrales, '2026-10-30 00:00:00').cierra).toBe(false); // faltan vistas
    expect(mal.contraste.find((c) => c.fila === 'PERSONA_FUERA')).toMatchObject({ natural: 0.85, mayusculas: 0.75 });
    expect(mal.contraste.find((c) => c.fila === 'PERSONA_FUERA')?.dMayusculas).toBeCloseTo(-0.1, 9);
  });

  it('T-AB-01 «posible sobreajuste» si la reserva queda más de 0,03 bajo el desarrollo y no si la diferencia es de 0,03 o menos', () => {
    const f = (r: number): MetricsRow => ({ ...base('PERSONA_TODAS', 100, Math.round(r * 100), 0, 0), exhaustividadMencion: r });
    const p = (d: number, r: number): FilasPorConjunto => ({ todo: [], desarrollo: [f(d)], reserva: [f(r)] });
    expect(posibleSobreajuste('natural', p(0.95, 0.9))).toHaveLength(1);
    expect(posibleSobreajuste('natural', p(0.95, 0.9))[0]).toMatchObject({ fila: 'PERSONA_TODAS', nDesarrollo: 100, nReserva: 100 });
    expect(posibleSobreajuste('natural', p(0.95, 0.92))).toEqual([]);
    expect(posibleSobreajuste('natural', p(0.9, 0.95))).toEqual([]);
  });
});

// PF-3-r1b · (b′) en el producto: la caché única se pasa con el mismo código que usa el worker `ner`
// =================================================================================================================================
describe('T-AB-01 · PF-3-r1b la restauración (b′) del producto, el preproceso de la caché y su huella (funciones puras)', () => {
  const textos: Record<string, ParteTexto[]> = {
    T01: [{ clave: 'cuerpo:1', texto: 'ANA FICTICIA', kind: 'cuerpo', index: 1 }, { clave: 'cuerpo:2', texto: 'Ana Ficticia Rojas', kind: 'cuerpo', index: 2 }],
  };
  const sha = (t: string): string => createHash('sha256').update(t).digest('hex');
  const ventanas = [{ windowIndex: 0, windowTotal: 1, spans: [{ start: 0, end: 12, label: 'PER' as const, score: 0.9 }] }];
  const cacheDe = (preproceso?: CacheVista['preproceso']): CacheVista => ({
    ...CACHE, vista: 'natural', huella: { texto: 'a', vista: 'b', onnx: 'o', codigo: 'c' },
    documentos: { T01: { partes: { 'cuerpo:1': { sha256: sha('ANA FICTICIA'), ventanas }, 'cuerpo:2': { sha256: sha('Ana Ficticia Rojas'), ventanas } } } },
    ...(preproceso === undefined ? {} : { preproceso }),
  });

  it('T-AB-01 INV-W04 la restauración por párrafos del script es la del producto, y el preproceso por defecto de la caché única es el del producto', async () => {
    const producto = (await import('../../src/core/ner/mayusculas.ts')).restaurarMayusculas;
    for (const t of ['HECHOS\n\nEl señor ANA FICTICIA ROJAS presentó.\n\nojo que blanca ejemplo vino', 'ANA FICTICIA', 'ana ficticia', 'Ana FICTICIA', 'STRAßE İSTANBUL']) {
      expect(restaurarMayusculas(t, 'parrafos'), t).toBe(producto(t));
      expect(entradaModelo(t, 'natural', PREPROCESO_PRODUCTO), t).toBe(producto(t));
      expect(entradaModelo(t, 'mayusculas', PREPROCESO_PRODUCTO), t).toBe(producto(vistaDeTexto(t, 'mayusculas')));
    }
    expect(PREPROCESO_PRODUCTO).toBe('restaurar-parrafos');
  });

  it('T-AB-01 la huella de mayusculas.ts es el sha256 del archivo con los saltos normalizados y cambia con cualquier cambio del código', () => {
    const h = huellaMayusculas(RAIZ);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(createHash('sha256').update(readFileSync(ruta('src/core/ner/mayusculas.ts'), 'utf8').replace(/\r\n/g, '\n')).digest('hex'));
  });

  it('T-AB-01 el índice acepta la caché del experimento (sin huella) y la del producto con la huella vigente, y rechaza una huella de otro mayusculas.ts', () => {
    const exp = cacheDe({ id: 'restaurar-parrafos', version: VERSION_RESTAURAR });
    const vigente = cacheDe({ id: 'restaurar-parrafos', version: VERSION_RESTAURAR, huella: 'h1' });
    const otra = cacheDe({ id: 'restaurar-parrafos', version: VERSION_RESTAURAR, huella: 'h0' });
    expect(indiceDeEntradas([exp], textos, 'o', 'c', 'h1').size).toBe(2);
    expect(indiceDeEntradas([vigente], textos, 'o', 'c', 'h1').size).toBe(2);
    expect(indiceDeEntradas([otra], textos, 'o', 'c', 'h1').size).toBe(0);
    expect(indiceDeEntradas([otra], textos, 'o', 'c').size).toBe(2); // sin huella pedida (el experimento) no se compara
    const claves = [...indiceDeEntradas([vigente], textos, 'o', 'c', 'h1').keys()].sort();
    expect(claves).toEqual([`estandar|${sha('Ana Ficticia')}`, `estandar|${sha('Ana Ficticia Rojas')}`].sort());
  });

  it('T-AB-01 reutilizarNatural con un preproceso copia de PF-3 solo los documentos cuyas partes llegan al modelo sin cambio', () => {
    const base: CacheModelo = { ...CACHE, etiquetas: 'estandar', piso: 0.1, huella: { texto: 't', vista: 'v', onnx: 'ox', codigo: 'cd' }, documentos: {
      D1: { partes: { 'cuerpo:1': { sha256: sha('Ana Ficticia Rojas'), ventanas: [] } } },
      D2: { partes: { 'cuerpo:1': { sha256: sha('ANA FICTICIA'), ventanas: [] } } },
    } };
    const t = (x: string): ParteTexto[] => [{ clave: 'cuerpo:1', texto: x, kind: 'cuerpo', index: 1 }];
    const tx = { D1: t('Ana Ficticia Rojas'), D2: t('ANA FICTICIA') };
    expect(reutilizarNatural(base, tx, ['D1', 'D2'], 'ox', 'cd', 'x-large').reutilizados).toEqual(['D1', 'D2']);
    const sinCambio = (texto: string): boolean => entradaModelo(texto, 'natural', PREPROCESO_PRODUCTO) === texto;
    expect(reutilizarNatural(base, tx, ['D1', 'D2'], 'ox', 'cd', 'x-large', sinCambio).reutilizados).toEqual(['D1']);
  });
});

// ---------------------------------------------------------------------------------------------------------------- archivo real
// El archivo `metricas/modelo-x-large-vistas.json` lo deja `node scripts/evaluar-modelo.ts pasada | verificar | evaluar` (PF-4a). Estas
// pruebas leen el archivo guardado. Contra el gold final de los 29 documentos las cifras se recalculan completas cuando ese corpus está
// en `corpus/gold/` (en main desde PG-2-r1; D-01). P0-4 volvió a correr `evaluar` con el motor vigente (PB-2-r3 y PB-2-r4 cambiaron la
// fusión después de PF-4a), así que la evaluación guardada es la del código que se mide.
const HAY_VISTAS = existsSync(ruta(ARCHIVO_VISTAS));
const CORPUS_FINAL_EN_REPO = existsSync(ruta('corpus/gold/C07.json'));

describe.skipIf(!HAY_VISTAS)('T-AB-01 · la caché de salidas de x-large en las tres vistas (metricas/modelo-x-large-vistas.json)', () => {
  const archivo = HAY_VISTAS ? leer<ArchivoVistas>(ARCHIVO_VISTAS) : ({ vistas: {} } as ArchivoVistas);
  const VISTAS_ESPERADAS = ['mayusculas', 'minusculas', 'natural'];

  it('T-AB-01 trae las tres vistas, de x-large, con la misma configuración, el mismo ONNX y el código del motor vigente (si no, la caché es inválida: R-26)', () => {
    expect(archivo).toMatchObject({ formato: 'sig-low/cache-modelo-vistas', v: 1, modelo: 'x-large' });
    expect(Object.keys(archivo.vistas).sort()).toEqual(VISTAS_ESPERADAS);
    const codigo = huellaMotor(RAIZ);
    for (const v of VISTAS_ESPERADAS) {
      const c = archivo.vistas[v as 'natural'];
      expect(c, v).toMatchObject({ formato: 'sig-low/cache-modelo', v: 1, modelo: 'x-large', vista: v, etiquetas: 'estandar', piso: 0.1, opciones: { windowTokens: 512, overlapWords: 37, maxSpanWords: 12 } });
      for (const h of Object.values(c?.huella ?? {})) expect(h).toMatch(/^[0-9a-f]{64}$/);
      expect(c?.huella.codigo, `${v}: huella del código del motor`).toBe(codigo);
      expect(c?.huella.onnx, `${v}: ONNX`).toBe(archivo.vistas.natural?.huella.onnx);
      expect(c?.huella.vista).toBe(createHash('sha256').update(v).digest('hex'));
    }
  });

  it('T-AB-01 INV-W04 PF-3-r1b las tres vistas se pasaron con la restauración por párrafos del producto, en su versión y con la huella del mayusculas.ts vigente (si no, la caché es inválida)', () => {
    const huella = huellaMayusculas(RAIZ);
    for (const v of VISTAS_ESPERADAS) {
      expect(archivo.vistas[v as 'natural']?.preproceso, v).toEqual({ id: PREPROCESO_PRODUCTO, version: VERSION_RESTAURAR, huella });
    }
  });

  it('T-AB-01 las tres vistas traen los mismos documentos y, parte por parte, la misma huella del texto canónico (INV-W04: la vista no cambia el canónico)', () => {
    const ids = Object.keys(archivo.vistas.natural?.documentos ?? {}).sort();
    expect(ids.length).toBe(29); // los 30 del corpus menos C04 (PDF escaneado)
    for (const v of VISTAS_ESPERADAS) {
      const c = archivo.vistas[v as 'natural'];
      expect(Object.keys(c?.documentos ?? {}).sort(), v).toEqual(ids);
      expect(c?.huella.texto, v).toBe(huellaTextoDeCache(c?.documentos ?? {}, ids));
      for (const id of ids) {
        const nat = archivo.vistas.natural?.documentos[id]?.partes ?? {};
        const dc = c?.documentos[id]?.partes ?? {};
        expect(Object.keys(dc), `${v} ${id}`).toEqual(Object.keys(nat));
        for (const [k, p] of Object.entries(dc)) {
          expect(p.sha256, `${v} ${id} ${k}`).toBe(nat[k]?.sha256);
          expect(p.ventanas.length, `${v} ${id} ${k}`).toBeGreaterThan(0);
          expect(p.ventanas.map((x) => x.windowIndex)).toEqual(p.ventanas.map((_, i) => i));
          for (const w of p.ventanas) for (const s of w.spans) { expect(s.score).toBeGreaterThanOrEqual(0.1); expect(s.end).toBeGreaterThan(s.start); }
        }
      }
    }
  });

  it('T-AB-01 la vista natural reutiliza de PF-3 solo documentos con el mismo texto, ONNX y código, y los demás vienen de una pasada nueva', () => {
    const nat = archivo.vistas.natural;
    const pf3 = leer<CacheModelo>(CACHE_PF3_HISTORICA);
    const reutilizados = Object.keys(nat?.procedencia ?? {});
    expect(reutilizados.length).toBeGreaterThan(0);
    expect(nat?.huella.onnx).toBe(pf3.huella.onnx);
    expect(nat?.huella.codigo).toBe(pf3.huella.codigo);
    for (const id of reutilizados) expect(nat?.documentos[id], id).toEqual(pf3.documentos[id]);
    expect(reutilizados.every((id) => id in pf3.documentos)).toBe(true);
  });

  const ev = HAY_VISTAS ? (archivo.evaluacion as EvaluacionModelo | undefined) : undefined;
  it.skipIf(ev === undefined)('T-AB-01 la evaluación guardada trae las tres vistas, 29 documentos, el umbral de PF-3 y la advertencia de muestra pequeña', () => {
    const cal = leer<{ nerMinScore: number; nerHighThreshold: number }>(CALIBRACION);
    expect(ev).toMatchObject({ formato: 'sig-low/evaluacion-modelo', v: 1, corpus: { documentos: 29, desarrollo: 19, reserva: 10 } });
    expect(ev?.umbrales).toMatchObject({ nerMinScore: cal.nerMinScore, nerHighThreshold: cal.nerHighThreshold });
    expect(Object.keys(ev?.vistas ?? {}).sort()).toEqual(VISTAS_ESPERADAS);
    expect(ev?.advertencia).toContain('25 fragmentos, 96 entidades');
  });

  it.skipIf(ev === undefined)('T-AB-01 las filas por vista guardadas son consistentes: mismo n en las tres vistas, cumple recalculado del umbral y omisiones permitidas ⌊(1 − umbral)·n⌋', () => {
    for (const grupo of GRUPOS_T_AB_01.map((g) => g.grupo)) {
      const ns = VISTAS_ESPERADAS.map((v) => fila(ev?.vistas[v as 'natural']?.producto.todo ?? [], grupo).n);
      expect(new Set(ns).size, `${grupo}: n distinto entre vistas`).toBe(1);
      expect(ns[0]).toBeGreaterThan(0);
    }
    for (const v of VISTAS_ESPERADAS) {
      const e = ev?.vistas[v as 'natural'];
      expect(e?.cierre.map((c) => c.fila)).toEqual(['PERSONA_FUERA', 'ORG_FUERA']);
      expect(e?.cierre).toEqual(filasDeCierre(v as 'natural', e?.producto.todo ?? []));
      expect(e?.cierreSoloModelo).toEqual(filasDeCierre(v as 'natural', e?.soloModelo.todo ?? []));
      for (const c of e?.cierre ?? []) {
        expect(c.mencion.omisionesPermitidas).toBe(Math.floor((1 - c.mencion.umbral) * c.mencion.n + 1e-9));
        expect(c.mencion.cumple).toBe(c.mencion.omisiones <= c.mencion.omisionesPermitidas);
        expect(c.idsNoCubiertas).toHaveLength(c.mencion.omisiones);
        for (const id of c.idsNoCubiertas) expect(id).toMatch(/^C\d\d-/u); // ids de anotación, nunca texto
      }
    }
    expect(ev?.cierra).toBe(VISTAS_ESPERADAS.every((v) => ev?.vistas[v as 'natural']?.cierre.every((c) => c.cumple) === true));
  });

  it.skipIf(!CORPUS_FINAL_EN_REPO || ev === undefined)('T-AB-01 con el corpus final en el repositorio, las filas se recalculan desde la caché y el gold y coinciden con las guardadas', async () => {
    const { evaluarVistaDesdeCache } = await import('../../scripts/evaluar-modelo.ts');
    for (const v of VISTAS_ESPERADAS) {
      const r = await evaluarVistaDesdeCache(v as 'natural', archivo.vistas[v as 'natural'] as never, ruta('corpus'), ev?.umbrales as never);
      expect(r.evaluacion.producto.todo, v).toEqual(ev?.vistas[v as 'natural']?.producto.todo);
      expect(r.evaluacion.soloModelo.todo, v).toEqual(ev?.vistas[v as 'natural']?.soloModelo.todo);
    }
  }, 600_000);

  it.skipIf(!CORPUS_FINAL_EN_REPO)('T-AB-01 el lector de `npm run medir` (PG-3b) acepta las tres vistas contra el corpus final', async () => {
    const { leerCache } = await import('./lib/cache.ts');
    const { cargarCorpus: corpusMedicion } = await import('./lib/corpus.ts');
    const corpus = corpusMedicion('todo');
    for (const v of VISTAS_ESPERADAS) expect(leerCache('x-large', v as 'natural', corpus, ruta('metricas'))?.vista, v).toBe(v);
  });
});

// Lo lanza `node scripts/evaluar-modelo.ts evaluar` (SIGLOW_EVALUAR=1): calcula T-AB-01 y lo guarda en el archivo de vistas.
describe.skipIf(process.env['SIGLOW_EVALUAR'] !== '1')('T-AB-01 evaluar · cálculo y guardado de las filas por vista', () => {
  it('T-AB-01 evaluar calcula las filas por vista desde la caché y el gold y las guarda en metricas/modelo-x-large-vistas.json', async () => {
    const { ejecutarEvaluacion } = await import('../../scripts/evaluar-modelo.ts');
    const args = new Map<string, string>(JSON.parse(process.env['SIGLOW_EVALUAR_ARGS'] ?? '[]') as Array<[string, string]>);
    await ejecutarEvaluacion(RAIZ, args);
  }, 900_000);
});

// Lo lanza `node scripts/evaluar-modelo.ts experimento` (SIGLOW_EVALUAR=experimento): PF-3-r1, solo con el desarrollo.
describe.skipIf(process.env['SIGLOW_EVALUAR'] !== 'experimento')('T-AB-01 experimento PF-3-r1 · mayúsculas y minúsculas', () => {
  it('T-AB-01 experimento calcula las filas por vista de las cuatro variantes en el desarrollo y las guarda en metricas/pf3r1-experimento.json', async () => {
    const { ejecutarExperimento } = await import('../../scripts/evaluar-modelo.ts');
    const args = new Map<string, string>(JSON.parse(process.env['SIGLOW_EVALUAR_ARGS'] ?? '[]') as Array<[string, string]>);
    await ejecutarExperimento(RAIZ, args);
  }, 900_000);
});

// ---------------------------------------------------------------------------------------------------------------- T-AB-06
describe('T-AB-06 · la caché de salidas reproduce una pasada nueva (funciones puras)', () => {
  const ventana = (i: number, spans: Array<[number, number, 'PER' | 'ORG' | 'LOC', number]>): { windowIndex: number; windowTotal: number; spans: Array<{ start: number; end: number; label: 'PER' | 'ORG' | 'LOC'; score: number }> } =>
    ({ windowIndex: i, windowTotal: 2, spans: spans.map(([start, end, label, score]) => ({ start, end, label, score })) });
  const A = [ventana(0, [[0, 10, 'PER', 0.95], [20, 30, 'ORG', 0.4]]), ventana(1, [[50, 60, 'LOC', 0.7]])];

  it('T-AB-06 las mismas ventanas, aunque los tramos lleguen en otro orden, reproducen: 3 tramos y diferencia 0', () => {
    const B = [ventana(0, [[20, 30, 'ORG', 0.4], [0, 10, 'PER', 0.95]]), ventana(1, [[50, 60, 'LOC', 0.7]])];
    expect(compararVentanas('T01', 'cuerpo:1', A, B)).toEqual({ tramos: 3, maxDiferencia: 0, discrepancias: [] });
  });

  it('T-AB-06 los puntajes se admiten a ±1e-4 (inclusive) y no más', () => {
    expect(TOLERANCIA_PUNTAJE).toBe(1e-4);
    const dentro = [ventana(0, [[0, 10, 'PER', 0.95008], [20, 30, 'ORG', 0.4]]), A[1] as (typeof A)[number]];
    const r = compararVentanas('T01', 'cuerpo:1', A, dentro);
    expect(r.discrepancias).toEqual([]);
    expect(r.maxDiferencia).toBeCloseTo(8e-5, 9);
    const fuera = [ventana(0, [[0, 10, 'PER', 0.9502], [20, 30, 'ORG', 0.4]]), A[1] as (typeof A)[number]];
    expect(compararVentanas('T01', 'cuerpo:1', A, fuera).discrepancias).toHaveLength(1);
  });

  it('T-AB-06 un tramo movido, una etiqueta distinta, un tramo de más o una ventana de menos son discrepancias (sin el texto del documento)', () => {
    expect(compararVentanas('T01', 'cuerpo:1', A, [ventana(0, [[0, 11, 'PER', 0.95], [20, 30, 'ORG', 0.4]]), A[1] as (typeof A)[number]]).discrepancias).toHaveLength(1);
    expect(compararVentanas('T01', 'cuerpo:1', A, [ventana(0, [[0, 10, 'ORG', 0.95], [20, 30, 'ORG', 0.4]]), A[1] as (typeof A)[number]]).discrepancias).toHaveLength(1);
    expect(compararVentanas('T01', 'cuerpo:1', A, [ventana(0, [[0, 10, 'PER', 0.95]]), A[1] as (typeof A)[number]]).discrepancias[0]).toContain('2 tramos en la caché y 1');
    expect(compararVentanas('T01', 'cuerpo:1', A, [A[0] as (typeof A)[number]]).discrepancias[0]).toContain('2 ventanas en la caché y 1');
  });

  it('T-AB-06 verificarCache cuenta ventanas y tramos de los tres documentos, exige la huella del texto y no pasa con una caché vacía', () => {
    const mk = (docs: string[], w = A): CacheVista => ({
      formato: 'sig-low/cache-modelo', v: 1, modelo: 'x-large', vista: 'natural', piso: 0.1, huella: { texto: 'a', vista: 'b', onnx: 'c', codigo: 'd' },
      documentos: Object.fromEntries(docs.map((d) => [d, { partes: { 'cuerpo:1': { sha256: `h-${d}`, ventanas: w } } }])),
    });
    const nueva = (docs: string[], w = A): Record<string, DocumentoCache> =>
      Object.fromEntries(docs.map((d) => [d, { partes: { 'cuerpo:1': { sha256: `h-${d}`, ventanas: w } } }]));
    const ok = verificarCache('natural', mk([...DOCUMENTOS_T_AB_06]), nueva([...DOCUMENTOS_T_AB_06]), DOCUMENTOS_T_AB_06);
    expect(ok).toMatchObject({ ok: true, ventanas: 6, tramos: 9, maxDiferenciaPuntaje: 0, discrepancias: [] });
    expect(DOCUMENTOS_T_AB_06).toEqual(['C22', 'C10', 'C13']);
    const otroTexto = nueva([...DOCUMENTOS_T_AB_06]);
    (otroTexto['C10'] as DocumentoCache).partes['cuerpo:1'] = { sha256: 'otro', ventanas: A };
    expect(verificarCache('natural', mk([...DOCUMENTOS_T_AB_06]), otroTexto, DOCUMENTOS_T_AB_06).ok).toBe(false);
    expect(verificarCache('natural', mk([...DOCUMENTOS_T_AB_06]), nueva(['C22', 'C10']), DOCUMENTOS_T_AB_06).discrepancias[0]).toContain('C13');
    expect(verificarCache('natural', mk([]), nueva([]), []).ok).toBe(false);
  });

  it('T-AB-06 reutilizarNatural copia de PF-3 solo los documentos con el mismo texto y rechaza todo si el ONNX o el código del motor cambiaron', () => {
    const texto = (t: string): ParteTexto => ({ clave: 'cuerpo:1', texto: t, kind: 'cuerpo', index: 1 });
    const sha = (t: string): string => createHash('sha256').update(t).digest('hex');
    const base: CacheModelo = {
      ...(CACHE as CacheModelo), etiquetas: 'estandar', piso: 0.1, huella: { texto: 't', vista: 'v', onnx: 'ox', codigo: 'cd' },
      documentos: {
        D1: { partes: { 'cuerpo:1': { sha256: sha('uno'), ventanas: [] } } },
        D2: { partes: { 'cuerpo:1': { sha256: sha('dos'), ventanas: [] } } },
      },
    };
    const textos = { D1: [texto('uno')], D2: [texto('dos CAMBIADO')], D3: [texto('tres')] };
    const r = reutilizarNatural(base, textos, ['D1', 'D2', 'D3'], 'ox', 'cd');
    expect(r.reutilizados).toEqual(['D1']);
    expect(Object.keys(r.documentos)).toEqual(['D1']);
    expect(reutilizarNatural(base, textos, ['D1'], 'otro-onnx', 'cd').reutilizados).toEqual([]);
    expect(reutilizarNatural(base, textos, ['D1'], 'ox', 'otro-codigo').reutilizados).toEqual([]);
    expect(reutilizarNatural({ ...base, piso: 0.3 }, textos, ['D1'], 'ox', 'cd').reutilizados).toEqual([]);
  });
});

describe.skipIf(!HAY_VISTAS)('T-AB-06 · la caché guardada reproduce una pasada nueva de C22, C10 y C13 (≥ 12 ventanas)', () => {
  const archivo = HAY_VISTAS ? leer<ArchivoVistas>(ARCHIVO_VISTAS) : ({ vistas: {} } as ArchivoVistas);
  const ver = archivo.verificacion;

  it('T-AB-06 hay una verificación guardada, con la tolerancia de ±1e-4, que da por buenas la huella del motor y la del ONNX', () => {
    expect(ver).toBeDefined();
    expect(ver?.tolerancia).toBe(1e-4);
    expect(ver?.huellaMotorCoincide).toBe(true);
    expect(ver?.huellaOnnxCoincide).toBe(true);
    expect(ver?.huellaPreprocesoCoincide).toBe(true); // PF-3-r1b: el mayusculas.ts vigente es el de la pasada
    expect(ver?.ok).toBe(true);
  });

  it('T-AB-06 PF-3-r1b las tres vistas se verificaron con el preproceso del producto: una pasada nueva de C22, C10 y C13 reproduce la caché', () => {
    expect((ver?.resultados ?? []).map((r) => r.vista).sort()).toEqual(['mayusculas', 'minusculas', 'natural']);
    for (const r of ver?.resultados ?? []) {
      expect(r.documentos, r.vista).toEqual(['C22', 'C10', 'C13']);
      expect(r.ok, r.vista).toBe(true);
      expect(r.maxDiferenciaPuntaje, r.vista).toBeLessThanOrEqual(1e-4);
    }
  });

  it('T-AB-06 la vista natural, con los mismos tres documentos y todas sus ventanas (9.5 estima 12; con el texto final son 13), reproduce tramos y puntajes a ±1e-4', () => {
    const r = ver?.resultados.find((x) => x.vista === 'natural');
    expect(r?.documentos).toEqual(['C22', 'C10', 'C13']);
    expect(r?.ventanas).toBeGreaterThanOrEqual(12);
    expect(r?.discrepancias).toEqual([]);
    expect(r?.ok).toBe(true);
    expect(r?.maxDiferenciaPuntaje ?? 1).toBeLessThanOrEqual(1e-4);
  });

  it('T-AB-06 la caché natural guardada tiene las ventanas de C22, C10 y C13 que se volvieron a pasar, y las otras vistas también se verificaron', () => {
    const ventanas = DOCUMENTOS_T_AB_06.reduce((n, id) => n + Object.values(archivo.vistas.natural?.documentos[id]?.partes ?? {}).reduce((m, p) => m + p.ventanas.length, 0), 0);
    expect(ventanas).toBeGreaterThanOrEqual(12);
    expect(ver?.resultados.find((x) => x.vista === 'natural')?.ventanas).toBe(ventanas);
    for (const r of ver?.resultados ?? []) { expect(r.ok, r.vista).toBe(true); expect(r.ventanas, r.vista).toBeGreaterThan(0); }
    expect((ver?.resultados ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('T-AB-06 si el código del motor cambia después de la pasada, la caché se declara inválida: la huella guardada es la del motor vigente', () => {
    for (const c of Object.values(archivo.vistas)) expect(c?.huella.codigo).toBe(huellaMotor(RAIZ));
  });
});

// ---------------------------------------------------------------------------------------------------------------- T-AB-04
// PF-4b: el respaldo (x-base) frente al principal (x-large). Informativa: el respaldo es un camino en ejecución, no un criterio de cierre.
describe('T-AB-04 · respaldo frente al principal: exhaustividad de PER, ORG y LOC por vista y su diferencia (gold de juguete)', () => {
  // Principal: ve todo lo del gold de juguete salvo P3. Respaldo: pierde la persona P2 y la organización O1 en todas las vistas, y la ubicación L1 en MAYÚSCULAS.
  const dets = (...ids: string[]) => (ENTRADA_T01.detecciones.filter((d) => ids.includes(d.id)));
  const t01 = (r: readonly string[]): EntradaDocumento => ({ ...ENTRADA_T01, detecciones: dets(...r) });
  const PRINCIPAL = [ENTRADA_T01, ENTRADA_T02];
  const evalDe = (modelo: 'x-large' | 'x-base', porVista: Record<'natural' | 'mayusculas' | 'minusculas', readonly EntradaDocumento[]>): EvaluacionModelo =>
    armarEvaluacion({
      natural: evaluarVista('natural', porVista.natural, porVista.natural),
      mayusculas: evaluarVista('mayusculas', porVista.mayusculas, porVista.mayusculas),
      minusculas: evaluarVista('minusculas', porVista.minusculas, porVista.minusculas),
    }, { documentos: 2, desarrollo: 1, reserva: 1, origen: 'prueba' }, { nerMinScore: 0.3, nerHighThreshold: 0.37, fuente: 'prueba' }, '2026-10-31 00:00:00', modelo);
  const principal = evalDe('x-large', { natural: PRINCIPAL, mayusculas: PRINCIPAL, minusculas: PRINCIPAL });
  const respaldoPerdidas = [t01(['d1', 'd3', 'd5', 'd6']), ENTRADA_T02];
  const respaldo = evalDe('x-base', { natural: respaldoPerdidas, mayusculas: [t01(['d1', 'd3', 'd6']), ENTRADA_T02], minusculas: respaldoPerdidas });
  const cmp = compararRespaldo(principal, respaldo, '2026-10-31 00:00:00');
  const celda = (vista: string, f: string, medida: 'modelo' | 'producto'): ComparacionRespaldo['filas'][number] =>
    cmp.filas.find((x) => x.vista === vista && x.fila === f && x.medida === medida) as ComparacionRespaldo['filas'][number];

  it('T-AB-04 las filas son PER, ORG y LOC (todas las menciones) y PER y ORG fuera de la lista, en las tres vistas y con el modelo solo y con el producto', () => {
    expect(FILAS_T_AB_04.map((f) => `${f.etiqueta}:${f.fila}:${f.ambito}`)).toEqual([
      'PER:PERSONA_TODAS:todas', 'ORG:ORG_TODAS:todas', 'LOC:LOC_TODAS:todas', 'PER:PERSONA_FUERA:fuera', 'ORG:ORG_FUERA:fuera',
    ]);
    expect(cmp.filas).toHaveLength(3 * 5 * 2);
    expect(cmp).toMatchObject({ formato: 'sig-low/comparacion-respaldo', v: 1, principal: 'x-large', respaldo: 'x-base', informativa: true });
    expect(cmp.advertencia).toContain('no un criterio de cierre');
  });

  it('T-AB-04 PER: el principal cubre 4 de 5 menciones (0,80), el respaldo 3 de 5 (0,60) y la diferencia es respaldo - principal = -0,20', () => {
    const c = celda('natural', 'PERSONA_TODAS', 'modelo');
    expect([c.n, c.etiqueta, c.ambito]).toEqual([5, 'PER', 'todas']);
    expect(c.principal).toBeCloseTo(0.8, 9);
    expect(c.respaldo).toBeCloseTo(0.6, 9);
    expect(c.diferencia).toBeCloseTo(-0.2, 9);
    const f = celda('natural', 'PERSONA_FUERA', 'modelo'); // fuera de la lista: 4 menciones, 3 frente a 2
    expect([f.n, f.ambito]).toEqual([4, 'fuera']);
    expect(f.principal).toBeCloseTo(0.75, 9);
    expect(f.respaldo).toBeCloseTo(0.5, 9);
    expect(f.diferencia).toBeCloseTo(-0.25, 9);
  });

  it('T-AB-04 ORG: 1 de 2 (0,50) frente a 0 de 2 (0,00), diferencia -0,50; LOC: sin diferencia en natural y en minúsculas, -1,00 en MAYÚSCULAS', () => {
    const o = celda('minusculas', 'ORG_TODAS', 'modelo');
    expect([o.n, o.principal, o.respaldo]).toEqual([2, 0.5, 0]);
    expect(o.diferencia).toBeCloseTo(-0.5, 9);
    expect(celda('natural', 'LOC_TODAS', 'modelo')).toMatchObject({ n: 1, principal: 1, respaldo: 1, diferencia: 0 });
    expect(celda('minusculas', 'LOC_TODAS', 'modelo').diferencia).toBe(0);
    expect(celda('mayusculas', 'LOC_TODAS', 'modelo')).toMatchObject({ principal: 1, respaldo: 0, diferencia: -1 });
  });

  it('T-AB-04 cada fila trae el mismo n para los dos modelos y el mismo n en las tres vistas (la vista no cambia el gold)', () => {
    for (const f of FILAS_T_AB_04) {
      const ns = ['natural', 'mayusculas', 'minusculas'].map((v) => celda(v, f.fila, 'producto').n);
      expect(new Set(ns).size, f.fila).toBe(1);
    }
    for (const c of cmp.filas) expect(c.diferencia).toBeCloseTo(c.respaldo - c.principal, 12);
  });

  it('T-AB-04 la caída frente a la vista natural se calcula por modelo, solo con el modelo, y el respaldo la sufre en MAYÚSCULAS donde el principal no', () => {
    expect(cmp.caidaPorVista).toHaveLength(6); // 2 modelos x PER, ORG y LOC
    const loc = (m: string) => cmp.caidaPorVista.find((k) => k.modelo === m && k.etiqueta === 'LOC');
    expect(loc('x-large')).toMatchObject({ natural: 1, mayusculas: 1, minusculas: 1, dMayusculas: 0, dMinusculas: 0 });
    expect(loc('x-base')).toMatchObject({ natural: 1, mayusculas: 0, minusculas: 1, dMayusculas: -1, dMinusculas: 0 });
  });

  it('T-AB-04 si los dos modelos no miden las mismas menciones se rechaza (N_DISTINTO) y una vista que falta en uno de los dos se omite', () => {
    const otroCorpus = evalDe('x-base', { natural: [ENTRADA_T01], mayusculas: [ENTRADA_T01], minusculas: [ENTRADA_T01] });
    expect(() => compararRespaldo(principal, otroCorpus, 'f')).toThrow('N_DISTINTO');
    const soloNatural: EvaluacionModelo = { ...respaldo, vistas: { natural: respaldo.vistas.natural } };
    const parcial = compararRespaldo(principal, soloNatural, 'f');
    expect(parcial.filas).toHaveLength(5 * 2);
    expect(parcial.filas.every((f) => f.vista === 'natural')).toBe(true);
    expect(parcial.caidaPorVista.filter((k) => k.modelo === 'x-base')).toEqual([]); // sin las tres vistas no hay caída que calcular
  });

  it('T-AB-04 la tabla impresa trae las tres etiquetas en las tres vistas con su n y la diferencia con signo, y ningún texto ni id del documento', () => {
    const t = tablaRespaldo(cmp);
    for (const v of ['natural', 'mayusculas', 'minusculas']) {
      expect(t).toContain(`T-AB-04 · ${v} · solo el modelo`);
      expect(t).toContain(`T-AB-04 · ${v} · producto`);
    }
    expect(t).toMatch(/PER\s+PERSONA_TODAS\s+5\s+0\.800\s+0\.600\s+-0\.200/u);
    expect(t).toMatch(/LOC\s+LOC_TODAS\s+1\s+1\.000\s+0\.000\s+-1\.000/u);
    expect(t).toContain('+0.000');
    expect(t).not.toMatch(/T0\d|xxxx/u);
  });

  it('T-AB-04 el archivo del respaldo es metricas/modelo-x-base-vistas.json y el del principal sigue siendo el de PF-4a', () => {
    expect(archivoVistasDe('x-base')).toBe('metricas/modelo-x-base-vistas.json');
    expect(ARCHIVO_VISTAS_X_BASE).toBe('metricas/modelo-x-base-vistas.json');
    expect(archivoVistasDe('x-large')).toBe(ARCHIVO_VISTAS);
  });

  it('T-AB-04 la vista natural del respaldo solo reutiliza una caché de x-base en la vista natural (no la de x-large ni otra vista)', () => {
    const texto = (t: string): ParteTexto => ({ clave: 'cuerpo:1', texto: t, kind: 'cuerpo', index: 1 });
    const sha = (t: string): string => createHash('sha256').update(t).digest('hex');
    const base: CacheModelo = {
      ...(CACHE as CacheModelo), modelo: 'x-base', etiquetas: 'estandar', piso: 0.1, huella: { texto: 't', vista: 'v', onnx: 'ox', codigo: 'cd' },
      documentos: { D1: { partes: { 'cuerpo:1': { sha256: sha('uno'), ventanas: [] } } } },
    };
    const textos = { D1: [texto('uno')] };
    expect(reutilizarNatural(base, textos, ['D1'], 'ox', 'cd', 'x-base').reutilizados).toEqual(['D1']);
    expect(reutilizarNatural(base, textos, ['D1'], 'ox', 'cd', 'x-large').reutilizados).toEqual([]);
    expect(reutilizarNatural({ ...base, vista: 'mayusculas' }, textos, ['D1'], 'ox', 'cd', 'x-base').reutilizados).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------- T-AB-04 archivo real
// `metricas/modelo-x-base-vistas.json` lo deja `node scripts/evaluar-modelo.ts pasada | verificar | evaluar --modelo=x-base` (PF-4b).
const HAY_X_BASE = existsSync(ruta(ARCHIVO_VISTAS_X_BASE)) && HAY_VISTAS;
const NATURAL_X_BASE_PF3 = 'metricas/etiquetas-x-base-estandar.json';

describe.skipIf(!HAY_X_BASE)('T-AB-04 · la caché de salidas de x-base en las tres vistas (metricas/modelo-x-base-vistas.json)', () => {
  const base = HAY_X_BASE ? leer<ArchivoVistas>(ARCHIVO_VISTAS_X_BASE) : ({ vistas: {} } as ArchivoVistas);
  const grande = HAY_X_BASE ? leer<ArchivoVistas>(ARCHIVO_VISTAS) : ({ vistas: {} } as ArchivoVistas);
  const VISTAS_ESPERADAS = ['mayusculas', 'minusculas', 'natural'] as const;

  it('T-AB-04 trae las tres vistas, de x-base, con la configuración del principal, otro ONNX que x-large y el código del motor vigente (si no, la caché es inválida: R-26)', () => {
    expect(base).toMatchObject({ formato: 'sig-low/cache-modelo-vistas', v: 1, modelo: 'x-base' });
    expect(Object.keys(base.vistas).sort()).toEqual([...VISTAS_ESPERADAS]);
    const codigo = huellaMotor(RAIZ);
    for (const v of VISTAS_ESPERADAS) {
      const c = base.vistas[v];
      expect(c, v).toMatchObject({ formato: 'sig-low/cache-modelo', v: 1, modelo: 'x-base', vista: v, etiquetas: 'estandar', piso: 0.1, opciones: { windowTokens: 512, overlapWords: 37, maxSpanWords: 12 } });
      for (const h of Object.values(c?.huella ?? {})) expect(h).toMatch(/^[0-9a-f]{64}$/);
      expect(c?.huella.codigo, `${v}: huella del código del motor`).toBe(codigo);
      expect(c?.huella.onnx, `${v}: ONNX`).toBe(base.vistas.natural?.huella.onnx);
      expect(c?.huella.onnx, `${v}: el ONNX de x-base no es el de x-large`).not.toBe(grande.vistas.natural?.huella.onnx);
      expect(c?.huella.vista).toBe(createHash('sha256').update(v).digest('hex'));
    }
  });

  it('T-AB-04 INV-W04 los mismos 29 documentos y, parte por parte, la misma huella del texto canónico en las tres vistas y que la caché de x-large', () => {
    const ids = Object.keys(grande.vistas.natural?.documentos ?? {}).sort();
    expect(ids.length).toBe(29);
    for (const v of VISTAS_ESPERADAS) {
      const c = base.vistas[v];
      expect(Object.keys(c?.documentos ?? {}).sort(), v).toEqual(ids);
      expect(c?.huella.texto, v).toBe(huellaTextoDeCache(c?.documentos ?? {}, ids));
      expect(c?.huella.texto, `${v}: el mismo texto que x-large`).toBe(grande.vistas[v]?.huella.texto);
      for (const id of ids) {
        const gr = grande.vistas.natural?.documentos[id]?.partes ?? {};
        const grVista = grande.vistas[v]?.documentos[id]?.partes ?? {};
        const dc = c?.documentos[id]?.partes ?? {};
        expect(Object.keys(dc), `${v} ${id}`).toEqual(Object.keys(gr));
        for (const [k, p] of Object.entries(dc)) {
          expect(p.sha256, `${v} ${id} ${k}`).toBe(gr[k]?.sha256);
          expect(p.ventanas.length, `${v} ${id} ${k}`).toBe(grVista[k]?.ventanas.length); // las ventanas dependen del tokenizador, que es el mismo, y del texto de la vista
          expect(p.ventanas.map((x) => x.windowIndex)).toEqual(p.ventanas.map((_, i) => i));
          for (const w of p.ventanas) for (const s of w.spans) { expect(s.score).toBeGreaterThanOrEqual(0.1); expect(s.end).toBeGreaterThan(s.start); }
        }
      }
    }
  });

  it('T-AB-04 la vista natural reutiliza de PF-3 solo documentos de x-base con el mismo texto, ONNX y código; los demás vienen de una pasada nueva', () => {
    const nat = base.vistas.natural;
    const pf3 = leer<CacheModelo>(NATURAL_X_BASE_PF3);
    const reutilizados = Object.keys(nat?.procedencia ?? {});
    expect(pf3.modelo).toBe('x-base');
    expect(reutilizados.length).toBeGreaterThan(0);
    expect(reutilizados.length).toBeLessThan(29); // el corpus final cambió el texto de algunos documentos y trajo los 10 de reserva
    expect(nat?.huella.onnx).toBe(pf3.huella.onnx);
    expect(nat?.huella.codigo).toBe(pf3.huella.codigo);
    for (const id of reutilizados) expect(nat?.documentos[id], id).toEqual(pf3.documentos[id]);
  });

  const ev = HAY_X_BASE ? (base.evaluacion as EvaluacionModelo | undefined) : undefined;
  const cmp = HAY_X_BASE ? (base.comparacion as ComparacionRespaldo | undefined) : undefined;
  const evGrande = HAY_X_BASE ? (grande.evaluacion as EvaluacionModelo | undefined) : undefined;

  it.skipIf(ev === undefined)('T-AB-04 la evaluación guardada es de x-base con el mismo corpus y el mismo umbral de PF-3 que la de x-large, y trae la advertencia de muestra pequeña', () => {
    expect(ev).toMatchObject({ formato: 'sig-low/evaluacion-modelo', v: 1, modelo: 'x-base', corpus: { documentos: 29, desarrollo: 19, reserva: 10 } });
    expect(ev?.umbrales).toEqual(evGrande?.umbrales);
    expect(ev?.corpus).toEqual(evGrande?.corpus);
    expect(Object.keys(ev?.vistas ?? {}).sort()).toEqual([...VISTAS_ESPERADAS]);
    expect(ev?.advertencia).toContain('25 fragmentos, 96 entidades');
  });

  it.skipIf(cmp === undefined)('T-AB-04 la tabla guardada tiene PER, ORG y LOC por vista de x-base, su n y su diferencia frente a x-large, y es informativa (no cierra nada)', () => {
    expect(cmp).toMatchObject({ formato: 'sig-low/comparacion-respaldo', v: 1, principal: 'x-large', respaldo: 'x-base', informativa: true });
    expect(cmp?.filas).toHaveLength(30);
    for (const v of ['natural', 'mayusculas', 'minusculas']) {
      for (const e of ['PER', 'ORG', 'LOC']) {
        for (const medida of ['modelo', 'producto']) {
          const fs = cmp?.filas.filter((f) => f.vista === v && f.etiqueta === e && f.medida === medida && f.ambito === 'todas') ?? [];
          expect(fs, `${v} ${e} ${medida}`).toHaveLength(1);
          expect(fs[0]?.n).toBeGreaterThan(0);
        }
      }
    }
    for (const f of cmp?.filas ?? []) {
      expect(f.principal).toBeGreaterThanOrEqual(0); expect(f.principal).toBeLessThanOrEqual(1);
      expect(f.respaldo).toBeGreaterThanOrEqual(0); expect(f.respaldo).toBeLessThanOrEqual(1);
      expect(f.diferencia).toBeCloseTo(f.respaldo - f.principal, 9);
    }
  });

  it.skipIf(cmp === undefined || ev === undefined || evGrande === undefined)('T-AB-04 la tabla guardada se recalcula de las dos evaluaciones guardadas (x-large de PF-4a y x-base), con el mismo n en los dos modelos', () => {
    const otra = compararRespaldo(evGrande as EvaluacionModelo, ev as EvaluacionModelo, (cmp as ComparacionRespaldo).fecha);
    expect(cmp).toEqual(otra);
    for (const f of cmp?.filas ?? []) {
      const fg = evGrande?.vistas[f.vista]?.[f.medida === 'modelo' ? 'soloModelo' : 'producto'].todo.find((x) => x.grupo === f.fila);
      expect(f.n, `${f.vista} ${f.fila} ${f.medida}`).toBe(fg?.n);
      expect(f.principal).toBe(fg?.exhaustividadMencion);
    }
  });

  it.skipIf(!CORPUS_FINAL_EN_REPO || ev === undefined)('T-AB-04 con el corpus final en el repositorio, las filas de x-base se recalculan desde la caché y el gold y coinciden con las guardadas', async () => {
    const { evaluarVistaDesdeCache } = await import('../../scripts/evaluar-modelo.ts');
    for (const v of VISTAS_ESPERADAS) {
      const r = await evaluarVistaDesdeCache(v, base.vistas[v] as never, ruta('corpus'), ev?.umbrales as never);
      expect(r.evaluacion.producto.todo, v).toEqual(ev?.vistas[v]?.producto.todo);
      expect(r.evaluacion.soloModelo.todo, v).toEqual(ev?.vistas[v]?.soloModelo.todo);
    }
  }, 600_000);

  it.skipIf(!CORPUS_FINAL_EN_REPO)('T-AB-04 el lector de `npm run medir` (PG-3b) acepta las tres vistas de x-base contra el corpus final', async () => {
    const { leerCache } = await import('./lib/cache.ts');
    const { cargarCorpus: corpusMedicion } = await import('./lib/corpus.ts');
    const corpus = corpusMedicion('todo');
    for (const v of VISTAS_ESPERADAS) expect(leerCache('x-base', v, corpus, ruta('metricas'))?.vista, v).toBe(v);
  });

  it('T-AB-06 la caché de x-base reproduce una pasada nueva de C22, C10 y C13 a ±1e-4 (verificación guardada)', () => {
    const ver = base.verificacion;
    expect(ver).toBeDefined();
    expect(ver?.tolerancia).toBe(1e-4);
    expect(ver?.huellaMotorCoincide).toBe(true);
    expect(ver?.huellaOnnxCoincide).toBe(true);
    expect(ver?.ok).toBe(true);
    for (const r of ver?.resultados ?? []) {
      expect(r.documentos).toEqual(['C22', 'C10', 'C13']);
      expect(r.ventanas, r.vista).toBeGreaterThanOrEqual(12);
      expect(r.discrepancias, r.vista).toEqual([]);
      expect(r.maxDiferenciaPuntaje, r.vista).toBeLessThanOrEqual(1e-4);
    }
  });
});
