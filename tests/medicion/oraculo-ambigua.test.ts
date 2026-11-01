// T-ME-05 · el oráculo de la revisión simulada y la mención ambigua de la lista (PB-3-r3, D-16; 7.9.6 y 10.3.4). «Prueba» es el
// apellido de la madre y del hijo: el motor no la asigna y el oráculo la decide como un revisor que lee el contexto. Si una de las
// personas sugeridas es la del gold, la elige («Unir con otra entidad»); si el gold la da a otra persona, la separa. La consistencia
// y las colisiones se miden con esa elección (`conOraculo`). Corpus sintético y ficticio (10.1.5); no lee el corpus real.
import { describe, expect, it } from 'vitest';
import { evaluarDocumento } from '../../scripts/metrics.ts';
import type { GoldAnnotation, GoldDocument, GoldEntity } from '../../scripts/metrics.ts';
import { esAmbigua } from '../../src/core/entities.ts';
import { armarDocumento, idsSecuenciales } from './lib/corpus.ts';
import { crearMotor, entradaDeEstado, procesarDocumento } from './lib/motor.ts';
import { conOraculo, revisarConOraculo } from './lib/oraculo.ts';

const TEXTO = 'Adriana Prueba Torres actúa en nombre de su hijo Nicolás Prueba Mora. Debe tenerse en cuenta que Prueba ha actuado siempre '
  + 'de buena fe. Prueba tiene doce años. El dictamen lo firmó la perito Prueba.';

/** La aparición `occ` de `texto` en TEXTO, con su entidad gold. */
function ann(id: string, texto: string, occ: number, entidad: string, extra: Partial<GoldAnnotation> = {}): GoldAnnotation {
  let start = -1;
  for (let k = 0; k <= occ; k++) start = TEXTO.indexOf(texto, start + 1);
  return {
    id: `P02-${id}`, docId: 'C02', parte: { kind: 'cuerpo', index: 1 }, start, end: start + texto.length, texto, tipo: 'PERSONA', entidad: `P02-${entidad}`,
    debe_generalizarse: false, es_negativo_esperado: false, estructura: 'no_aplica', enLista: entidad !== 'E3', rotulado: false, caracteristicas: [], ...extra,
  };
}
const ent = (id: string, canonico: string, enLista: boolean): GoldEntity => ({ id: `P02-${id}`, tipo: 'PERSONA', canonico, mismoTitular: [], enLista });

function documento() {
  const anotaciones: GoldAnnotation[] = [
    ann('A1', 'Adriana Prueba Torres', 0, 'E1', { claseVariante: 'exacta' }),
    ann('A2', 'Nicolás Prueba Mora', 0, 'E2', { claseVariante: 'exacta' }),
    // Las tres «Prueba» sueltas: la buena fe es de la madre, la edad es del hijo y la perito es otra persona.
    ann('A3', 'Prueba', 2, 'E1', { claseVariante: 'apellido_suelto' }),
    ann('A4', 'Prueba', 3, 'E2', { claseVariante: 'apellido_suelto' }),
    ann('A5', 'Prueba', 4, 'E3'),
  ];
  const gold = {
    docId: 'C02', conjunto: 'desarrollo', anotaciones,
    entidades: [ent('E1', 'LISTA:Adriana Prueba Torres', true), ent('E2', 'LISTA:Nicolás Prueba Mora', true), ent('E3', 'PER:perito prueba', false)],
    listaDelCaso: [{ name: 'Adriana Prueba Torres', role: 'DEMANDANTE' }, { name: 'Nicolás Prueba Mora', role: 'PACIENTE' }], esperado: { partes: [] },
  } as unknown as GoldDocument & { listaDelCaso: Array<{ name: string; role: string }>; esperado: { partes: [] } };
  return armarDocumento(gold, { docId: 'C02', partes: [{ kind: 'cuerpo', index: 1, texto: TEXTO }] }, idsSecuenciales(1));
}

async function revisar() {
  const motor = crearMotor();
  const dc = documento();
  const p = await procesarDocumento(motor, dc, undefined);
  const o = await revisarConOraculo({ p, motor });
  return { dc, p, o };
}
const enPos = (texto: string, occ: number): number => { let i = -1; for (let k = 0; k <= occ; k++) i = TEXTO.indexOf(texto, i + 1); return i; };

describe('T-ME-05 · el oráculo y la mención ambigua de la lista (D-16)', () => {
  it('T-ME-05 el motor deja las tres «Prueba» sin persona; el oráculo elige a la madre y al hijo según el gold y separa a la perito', async () => {
    const { p, o, dc } = await revisar();
    const sueltas = [2, 3, 4].map((k) => Object.values(p.state.detections).find((d) => d.start === enPos('Prueba', k)));
    expect(sueltas.every((d) => d !== undefined && esAmbigua(p.state, d) && d.caseEntityId === undefined)).toBe(true);
    const [madre, hijo] = dc.caseList.map((c) => Object.values(o.state.entities).find((e) => e.caseEntityId === c.id)?.id);
    const fin = sueltas.map((d) => (d === undefined ? undefined : o.state.detections[d.id]));
    expect(fin.map((d) => d?.entityId)).toEqual([madre, hijo, expect.any(String)]);
    expect(fin[2]?.entityId).not.toBe(madre);
    expect(fin[2]?.entityId).not.toBe(hijo);
    // Separada como otra persona (`separar_mencion`): la clave de la detección lleva `~sep` (B-82).
    expect(fin[2]?.canonicalKey).toBe('PER:prueba~sep');
    expect(Object.values(o.state.detections).some((d) => esAmbigua(o.state, d))).toBe(false);
    expect(o.ambiguas.map((a) => a.entityId)).toEqual(fin.map((d) => d?.entityId));
    expect(o.rechazadas).toEqual([]);
  });

  it('T-ME-05 la consistencia y las colisiones se miden con la elección del revisor: sin ella, cada «Prueba» es una entidad aparte', async () => {
    const { p, o } = await revisar();
    const antes = evaluarDocumento(entradaDeEstado(p));
    expect(antes.consistenciaPorGrupo.lista).toEqual({ evaluadas: 2, consistentes: 0 });
    const despues = evaluarDocumento(conOraculo(entradaDeEstado(p), o));
    expect(despues.consistenciaPorGrupo.lista).toEqual({ evaluadas: 2, consistentes: 2 });
    expect(despues.consistencia.colisiones).toBe(0);
    // Solo cambian las menciones ambiguas: las demás conservan la entidad del motor.
    const e0 = entradaDeEstado(p).detecciones;
    const e1 = conOraculo(entradaDeEstado(p), o).detecciones;
    const cambiadas = e1.filter((d, i) => d.entidad !== e0[i]?.entidad).map((d) => d.id).sort();
    expect(cambiadas).toEqual(o.ambiguas.map((a) => a.detectionId).sort());
  });
});
