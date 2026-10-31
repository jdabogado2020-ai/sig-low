// T-ME-05 · el oráculo de la revisión simulada y las banderas de cita jurisprudencial (AJ-3, punto 1; 7.3.3 y 10.3.4).
// El plan dice «CITA_JURISPRUDENCIAL → mantener (rechaza la detección vinculada)». Desde PB-2-r7 (A-1) el expediente del propio caso
// que aparece junto a la Corte también lleva la bandera, vinculada a su detección: si el gold lo marca como positivo, quien sigue la
// guía lo conserva anonimizado, y el oráculo lo acepta; si el gold lo marca como cita ajena (negativo con la bandera esperada), lo
// mantiene visible. Corpus sintético y ficticio (10.1.5); no lee el corpus real.
import { describe, expect, it } from 'vitest';
import { render } from '../../src/core/render.ts';
import type { GoldAnnotation, GoldDocument } from '../../scripts/metrics.ts';
import { armarDocumento, idsSecuenciales } from './lib/corpus.ts';
import { crearMotor, procesarDocumento } from './lib/motor.ts';
import { revisarConOraculo } from './lib/oraculo.ts';

const PROPIO = 'T-9.000.001';
const AJENO = '73001-31-03-943-2019-00022-00';
const TEXTO = [
  `Por desconocimiento del precedente, solicito a la Corte seleccionar el expediente ${PROPIO} de este asunto.`,
  `Sobre la prestación de tratamientos, la Corte Suprema de Justicia, en el proceso con radicado ${AJENO}, recordó el principio de integralidad.`,
].join('\n');

function ann(id: string, texto: string, tipo: 'RADICADO_ADMIN' | 'RADICADO', extra: Partial<GoldAnnotation>): GoldAnnotation {
  const start = TEXTO.indexOf(texto);
  return {
    id: `P01-${id}`, docId: 'C01', parte: { kind: 'cuerpo', index: 1 }, start, end: start + texto.length, texto, tipo, entidad: `P01-${id}`,
    debe_generalizarse: false, es_negativo_esperado: false, estructura: 'no_aplica', enLista: false, rotulado: true, caracteristicas: [], ...extra,
  };
}

/** Un documento de una sola parte con el expediente propio y una cita ajena; `propioPositivo` decide cómo lo anota el gold. */
function documento(propioPositivo: boolean) {
  const anotaciones: GoldAnnotation[] = [
    ann('A1', PROPIO, 'RADICADO_ADMIN', propioPositivo ? {} : { es_negativo_esperado: true, bandera_esperada: 'CITA_JURISPRUDENCIAL' }),
    ann('A2', AJENO, 'RADICADO', { es_negativo_esperado: true, bandera_esperada: 'CITA_JURISPRUDENCIAL' }),
  ];
  const gold = {
    docId: 'C01', conjunto: 'desarrollo', entidades: [], anotaciones, listaDelCaso: [], esperado: { partes: [] },
  } as unknown as GoldDocument & { listaDelCaso: []; esperado: { partes: [] } };
  return armarDocumento(gold, { docId: 'C01', partes: [{ kind: 'cuerpo', index: 1, texto: TEXTO }] }, idsSecuenciales(1));
}

async function revisar(propioPositivo: boolean) {
  const motor = crearMotor();
  const dc = documento(propioPositivo);
  const p = await procesarDocumento(motor, dc, undefined);
  const o = await revisarConOraculo({ p, motor });
  const salida = render(dc.doc, o.state).sections.map((s) => s.text).join('\n');
  return { p, o, salida };
}

describe('T-ME-05 · el oráculo y la bandera de cita sobre el expediente del propio caso', () => {
  it('T-ME-05 el motor propone la bandera de cita sobre el expediente propio y sobre la cita ajena, cada una vinculada a su detección', async () => {
    const { p } = await revisar(true);
    const banderas = Object.values(p.state.flags).filter((f) => f.type === 'CITA_JURISPRUDENCIAL');
    const vinculadas = banderas.map((f) => (f.detectionId === undefined ? undefined : p.state.detections[f.detectionId]?.type));
    expect(vinculadas.sort()).toEqual(['RADICADO', 'RADICADO_ADMIN']);
  });

  it('T-ME-05 con el expediente propio positivo en el gold, el oráculo lo acepta y la cita ajena se mantiene a la vista', async () => {
    const { o, salida } = await revisar(true);
    const detecciones = Object.values(o.state.detections);
    const propio = detecciones.find((d) => d.type === 'RADICADO_ADMIN');
    const ajeno = detecciones.find((d) => d.type === 'RADICADO');
    expect(propio?.status).toBe('aceptada');
    expect(ajeno?.status).toBe('rechazada');
    expect(salida).not.toContain(PROPIO);
    expect(salida).toContain(AJENO);
    expect(o.rechazadas).toEqual([]);
  });

  it('T-ME-05 con el expediente anotado como cita ajena, el oráculo lo mantiene visible, como dice 10.3.4', async () => {
    const { o, salida } = await revisar(false);
    const propio = Object.values(o.state.detections).find((d) => d.type === 'RADICADO_ADMIN');
    expect(propio?.status).toBe('rechazada');
    expect(salida).toContain(PROPIO);
    expect(salida).toContain(AJENO);
  });
});
