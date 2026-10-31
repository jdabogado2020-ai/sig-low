// T-ME-01 · funciones puras del script de métricas (PG-3a; plan 10.3). Todo se calcula contra un gold de juguete cuyos
// valores están hechos a mano (los cálculos van en los comentarios). Posiciones en una sola parte, `cuerpo:1`; los textos del
// gold no intervienen salvo en el escáner de residuos. Datos ficticios.
import { describe, expect, it } from 'vitest';
import {
  caracteresCopiados, claveParte, clasificarMenciones, codigoDeSalida, concordancia, construirInforme, coberturaAceptable, calcularFila,
  escanearResiduos, esExacta, esPositiva, esSolape, esVerdadera, evaluarDocumento, exceso, f2, gruposDeCierre, iou, nombreInforme, omisionesPermitidas,
  razon, tablaTexto,
} from '../../scripts/metrics.ts';
import type {
  BanderaMedida, CorridaInfo, DeteccionMedida, EntradaDocumento, GoldAnnotation, GoldEntity, SalidaParte, SegmentoSalida, SugerenciaMedida,
} from '../../scripts/metrics.ts';
import type { DataType, DetectableType } from '../../src/core/types.ts';

const PARTE = claveParte({ kind: 'cuerpo', index: 1 });

// ---------------------------------------------------------------------------------------------------------------- fábricas
function ann(id: string, tipo: DataType, start: number, end: number, entidad: string, extra: Partial<GoldAnnotation> = {}): GoldAnnotation {
  return {
    id: `T01-${id}`, docId: 'T01', parte: { kind: 'cuerpo', index: 1 }, start, end, texto: 'x'.repeat(end - start), tipo, entidad: `T01-${entidad}`,
    debe_generalizarse: false, es_negativo_esperado: false, estructura: 'no_aplica', enLista: false, rotulado: false, caracteristicas: [], ...extra,
  };
}
const ent = (id: string, tipo: DataType, extra: Partial<GoldEntity> = {}): GoldEntity =>
  ({ id: `T01-${id}`, tipo, canonico: `${tipo}:${id}`, mismoTitular: [], enLista: false, ...extra });
const det = (id: string, tipo: DetectableType, start: number, end: number, entidad: string): DeteccionMedida =>
  ({ id, parte: PARTE, start, end, tipo, entidad });

const CORRIDA: CorridaInfo = {
  config: 'sin-modelo', vista: 'natural', hilos: 1, conjunto: 'desarrollo', compilacion: 'abcdef012345', modelo: null, navegador: 'prueba',
  equipo: { nucleosLogicos: 8, descripcion: 'equipo de prueba' }, fecha: '2026-10-30T14:05',
};

// ---------------------------------------------------------------------------------------------------------------- el gold de juguete
//  id    tipo        tramo       len  entidad  nota
//  A01   CC          [10,20)     10   E01      exacta (D01)
//  A02   CC          [100,110)   10   E01      exacta (D02, que cae en otra Entity: inconsistencia)
//  A03   PERSONA     [30,50)     20   E02      en la lista; exacta
//  A04   PERSONA     [60,70)     10   E03      omitida
//  A04b  PERSONA     [80,90)     10   E03      exacta (la entidad E03 queda con 1 de 2 menciones)
//  A05   TELEFONO    [120,130)   10   E04      detectada con otro grupo de tipo (CC): cubierta, no tipificada
//  A06   CORREO      [140,160)   20   E05      exacta
//  A07   NIT         [200,210)   10   E06      D07 cubre A07 y A08 juntas: fusión, colisión
//  A08   CC          [211,220)    9   E07      exceso(D07, A07) = 20 − 10 − 9 = 1
//  A10   ENTIDAD     [300,340)   40   E08      despacho: no entra en G⁺ (DESPACHO_A_GENERICO)
//  A11   MUNICIPIO   [320,330)   10   E09      contenidaEn A10; cubierta porque A10 lo está
//  A12   CC          [500,510)   10   E10      D11 [490,530): exceso 40 − 10 = 30 > 12 → no cubierta
//  A13   PERSONA     [600,640)   40   E11      D12 [600,620) no llega al final → no cubierta (IoU 20/40 = 0,5: solape)
//  A14   FECHA       [700,730)   30   E12      D13 [695,735): exceso 10 ≤ max(12, 30) → cubierta, no exacta
//  A15   CC          [800,805)    5   E13      D14 [800,817): exceso 12 ≤ max(12, 5) → cubierta
//  A16   PERSONA     [1000,1010) 10   E14      exacta (D17)
//  A17   PERSONA     [1020,1030) 10   E14      exacta (D18; misma Entity que D17: consistente)
//  A18   CARGO       [1100,1110) 10   E15      bandera esperada CARGO (presente); no es G⁺
//  A19   DIAGNOSTICO [1120,1140) 20   E16      bandera esperada (ausente); no es G⁺
//  N1    RADICADO    [400,430)   30   E17      negativo con bandera_esperada CITA_JURISPRUDENCIAL
//  N2    VALOR       [450,460)   10   E18      negativo
//  N3    VALOR       [470,480)   10   E19      negativo
const GOLD_ANN: GoldAnnotation[] = [
  ann('A01', 'CC', 10, 20, 'E01'),
  ann('A02', 'CC', 100, 110, 'E01'),
  ann('A03', 'PERSONA', 30, 50, 'E02', { enLista: true }),
  ann('A04', 'PERSONA', 60, 70, 'E03'),
  ann('A04b', 'PERSONA', 80, 90, 'E03'),
  ann('A05', 'TELEFONO', 120, 130, 'E04'),
  ann('A06', 'CORREO', 140, 160, 'E05'),
  ann('A07', 'NIT', 200, 210, 'E06'),
  ann('A08', 'CC', 211, 220, 'E07'),
  ann('A10', 'ENTIDAD', 300, 340, 'E08', { debe_generalizarse: true, generalizacion: 'DESPACHO_A_GENERICO' }),
  ann('A11', 'MUNICIPIO', 320, 330, 'E09', { debe_generalizarse: true, generalizacion: 'MUNICIPIO_A_DEPARTAMENTO', contenidaEn: 'T01-A10' }),
  ann('A12', 'CC', 500, 510, 'E10'),
  ann('A13', 'PERSONA', 600, 640, 'E11'),
  ann('A14', 'FECHA', 700, 730, 'E12'),
  ann('A15', 'CC', 800, 805, 'E13'),
  ann('A16', 'PERSONA', 1000, 1010, 'E14'),
  ann('A17', 'PERSONA', 1020, 1030, 'E14'),
  ann('A18', 'CARGO', 1100, 1110, 'E15', { debe_generalizarse: true }),
  ann('A19', 'DIAGNOSTICO', 1120, 1140, 'E16', { debe_generalizarse: true }),
  ann('N1', 'RADICADO', 400, 430, 'E17', { es_negativo_esperado: true, bandera_esperada: 'CITA_JURISPRUDENCIAL' }),
  ann('N2', 'VALOR', 450, 460, 'E18', { es_negativo_esperado: true }),
  ann('N3', 'VALOR', 470, 480, 'E19', { es_negativo_esperado: true }),
];
const GOLD_ENT: GoldEntity[] = [
  ent('E01', 'CC'), ent('E02', 'PERSONA', { enLista: true }), ent('E03', 'PERSONA'), ent('E04', 'TELEFONO'), ent('E05', 'CORREO'),
  ent('E06', 'NIT'), ent('E07', 'CC'), ent('E08', 'ENTIDAD'), ent('E09', 'MUNICIPIO'), ent('E10', 'CC'), ent('E11', 'PERSONA'),
  ent('E12', 'FECHA'), ent('E13', 'CC'), ent('E14', 'PERSONA'), ent('E15', 'CARGO'), ent('E16', 'DIAGNOSTICO'),
  ent('E17', 'RADICADO'), ent('E18', 'VALOR'), ent('E19', 'VALOR'),
];
const DETS: DeteccionMedida[] = [
  det('D01', 'CC', 10, 20, 'En1'),            // exacta, verdadera
  det('D02', 'CC', 100, 110, 'En1b'),         // exacta, verdadera, otra Entity que D01
  det('D03', 'PERSONA', 30, 50, 'En2'),       // exacta, verdadera
  det('D05', 'CC', 120, 130, 'En3'),          // cubre el teléfono con tipo de otro grupo
  det('D06', 'CORREO', 140, 160, 'En4'),
  det('D07', 'NIT', 200, 220, 'En5'),         // fusión de A07 y A08
  det('D08', 'ENTIDAD', 300, 340, 'En6'),     // 10 de 40 caracteres en G⁺: falsa
  det('D09', 'RADICADO', 400, 430, 'En7'),    // bandera correcta
  det('D10', 'VALOR', 450, 460, 'En8'),       // falsa de negativo
  det('D11', 'CC', 490, 530, 'En9'),          // falsa
  det('D12', 'PERSONA', 600, 620, 'En10'),    // verdadera, no cubre
  det('D13', 'FECHA', 695, 735, 'En11'),      // verdadera (30 de 40), cubre sin ser exacta
  det('D14', 'CC', 800, 817, 'En12'),         // cubre A15 pero 5 de 17 caracteres: falsa
  det('D15', 'FECHA', 900, 910, 'En13'),      // falsa (sin gold)
  det('D16', 'PERSONA', 80, 90, 'En14'),
  det('D17', 'PERSONA', 1000, 1010, 'En15'),
  det('D18', 'PERSONA', 1020, 1030, 'En15'),
];
const BANDERAS: BanderaMedida[] = [
  { tipo: 'CITA_JURISPRUDENCIAL', parte: PARTE, start: 400, end: 430, deteccion: 'D09' },
  { tipo: 'CARGO', parte: PARTE, start: 1100, end: 1110 },
];
const SUGERENCIAS: SugerenciaMedida[] = [{ kind: 'DESPACHO_A_GENERICO', parte: PARTE, start: 300, end: 340 }];

const ENTRADA: EntradaDocumento = {
  gold: { docId: 'T01', conjunto: 'desarrollo', entidades: GOLD_ENT, anotaciones: GOLD_ANN },
  detecciones: DETS, banderas: BANDERAS, sugerencias: SUGERENCIAS, paginas: 2,
};
const EV = evaluarDocumento(ENTRADA);
const fila = (grupo: string): ReturnType<typeof calcularFila> => {
  const def = gruposDeCierre('natural').find((g) => g.grupo === grupo);
  if (def === undefined) throw new Error(grupo);
  return calcularFila(def, [EV]);
};

// ---------------------------------------------------------------------------------------------------------------- unidades
describe('T-ME-01 · aritmética básica', () => {
  it('F2 = 5·P·R / (4·P + R): P = 0,70 y R = 0,95 dan ≈ 0,887; los extremos dan 0 sin dividir por cero', () => {
    expect(f2(0.7, 0.95)).toBeCloseTo((5 * 0.7 * 0.95) / (4 * 0.7 + 0.95), 12);
    expect(f2(0.7, 0.95)).toBeCloseTo(3.325 / 3.75, 12);
    expect(f2(1, 1)).toBe(1);
    expect(f2(0, 0)).toBe(0);
    expect(f2(0, 1)).toBe(0);
    expect(f2(1, 0)).toBe(0);
    expect(f2(0.5, 0.5)).toBeCloseTo(0.5, 12);                  // P = R → F2 = P
  });

  it('razón con denominador 0 da 0; omisiones permitidas = ⌊(1 − umbral)·n⌋', () => {
    expect(razon(3, 4)).toBe(0.75);
    expect(razon(0, 0)).toBe(0);
    expect(omisionesPermitidas(0.98, 100)).toBe(2);             // 0,02·100 = 2 con redondeo binario
    expect(omisionesPermitidas(0.98, 49)).toBe(0);
    expect(omisionesPermitidas(0.85, 20)).toBe(3);
    expect(omisionesPermitidas(1, 500)).toBe(0);
    expect(omisionesPermitidas(0.95, 7)).toBe(0);
  });

  it('D-06: una edad con EDAD_A_RANGO y un municipio con DESPACHO_A_GENERICO no entran en la exhaustividad de protección', () => {
    expect(esPositiva(ann('X1', 'FECHA', 0, 20, 'EX1'))).toBe(true);
    expect(esPositiva(ann('X2', 'FECHA', 0, 20, 'EX2', { generalizacion: 'EDAD_A_RANGO', debe_generalizarse: true }))).toBe(false);
    expect(esPositiva(ann('X3', 'MUNICIPIO', 0, 6, 'EX3', { generalizacion: 'DESPACHO_A_GENERICO' }))).toBe(false);
    expect(esPositiva(ann('X4', 'MUNICIPIO', 0, 6, 'EX4', { generalizacion: 'MUNICIPIO_A_DEPARTAMENTO' }))).toBe(true);
  });
});

describe('T-ME-01 · emparejamiento (10.3.2)', () => {
  it('exacto, IoU y solape', () => {
    expect(esExacta({ start: 5, end: 9 }, { start: 5, end: 9 })).toBe(true);
    expect(esExacta({ start: 5, end: 9 }, { start: 5, end: 10 })).toBe(false);
    expect(iou({ start: 0, end: 10 }, { start: 5, end: 15 })).toBeCloseTo(5 / 15, 12);
    expect(iou({ start: 600, end: 620 }, { start: 600, end: 640 })).toBe(0.5);
    expect(esSolape({ start: 600, end: 620 }, { start: 600, end: 640 })).toBe(true);        // IoU = 0,5 exacto cuenta
    expect(esSolape({ start: 0, end: 10 }, { start: 5, end: 15 })).toBe(false);             // IoU = 1/3
    expect(iou({ start: 0, end: 5 }, { start: 5, end: 9 })).toBe(0);
  });

  it('cobertura aceptable con y sin exceso: tope max(12, |g|)', () => {
    const g = { start: 800, end: 805 };
    expect(coberturaAceptable({ start: 800, end: 817 }, g, [])).toBe(true);                  // exceso 12 = max(12, 5)
    expect(coberturaAceptable({ start: 800, end: 818 }, g, [])).toBe(false);                 // exceso 13
    expect(coberturaAceptable({ start: 799, end: 817 }, g, [])).toBe(false);                 // exceso 13 por el lado izquierdo
    expect(coberturaAceptable({ start: 801, end: 810 }, g, [])).toBe(false);                 // no cubre el inicio
    expect(coberturaAceptable({ start: 800, end: 804 }, g, [])).toBe(false);                 // no cubre el final
    const larga = { start: 700, end: 730 };
    expect(coberturaAceptable({ start: 695, end: 735 }, larga, [])).toBe(true);              // exceso 10 ≤ 30
    expect(coberturaAceptable({ start: 670, end: 760 }, larga, [])).toBe(false);             // exceso 60 > 30
    expect(coberturaAceptable({ start: 670, end: 730 }, larga, [])).toBe(true);              // exceso 30 = |g|
  });

  it('exceso no cuenta como tal los datos contiguos contenidos por completo (fusión) ni resta lo anidado en g', () => {
    const a = { start: 200, end: 210 };
    const b = { start: 211, end: 220 };
    const d = { start: 200, end: 220 };
    expect(exceso(d, a, [a, b])).toBe(1);                       // 20 − 10 − 9
    expect(exceso(d, b, [a, b])).toBe(1);                       // 20 − 9 − 10
    expect(exceso(d, a, [a])).toBe(10);                         // sin el vecino en G⁺, el resto sí es exceso
    const g = { start: 300, end: 340 };
    const anidada = { start: 320, end: 330 };
    expect(exceso({ start: 300, end: 340 }, g, [g, anidada])).toBe(0);   // la anidada ya está en |g|
    expect(exceso({ start: 290, end: 340 }, g, [g, anidada])).toBe(10);
  });

  it('verdadera: al menos el 50 % de los caracteres de d dentro de tramos de G⁺', () => {
    const pos = [{ start: 10, end: 20 }, { start: 211, end: 220 }, { start: 200, end: 210 }];
    expect(esVerdadera({ start: 10, end: 20 }, pos)).toBe(true);
    expect(esVerdadera({ start: 5, end: 25 }, pos)).toBe(true);                // 10 de 20
    expect(esVerdadera({ start: 5, end: 26 }, pos)).toBe(false);               // 10 de 21
    expect(esVerdadera({ start: 200, end: 220 }, pos)).toBe(true);             // 19 de 20: dos tramos contiguos
    expect(esVerdadera({ start: 300, end: 310 }, pos)).toBe(false);
    expect(esVerdadera({ start: 5, end: 5 }, pos)).toBe(false);
    expect(esVerdadera({ start: 10, end: 20 }, [{ start: 10, end: 20 }, { start: 12, end: 18 }])).toBe(true);   // anidadas: no se cuentan dos veces
  });
});

describe('T-ME-01 · evaluación del documento de juguete', () => {
  const m = (id: string): (typeof EV.menciones)[number] => {
    const r = EV.menciones.find((x) => x.g.id === `T01-${id}`);
    if (r === undefined) throw new Error(id);
    return r;
  };
  const d = (id: string): (typeof EV.detecciones)[number] => {
    const r = EV.detecciones.find((x) => x.d.id === id);
    if (r === undefined) throw new Error(id);
    return r;
  };

  it('el conjunto G⁺ excluye negativos, banderas y despachos: 16 menciones positivas', () => {
    expect(EV.menciones).toHaveLength(16);
    expect(EV.menciones.map((x) => x.g.id)).not.toContain('T01-A10');
    expect(EV.menciones.map((x) => x.g.id)).not.toContain('T01-A18');
    expect(EV.menciones.map((x) => x.g.id)).not.toContain('T01-N1');
  });

  it('cubierta: exacta, con exceso permitido, por anidación en el despacho, y las no cubiertas', () => {
    const cubiertas = EV.menciones.filter((x) => x.cubierta).map((x) => x.g.id.slice(4));
    expect(cubiertas).toEqual(['A01', 'A02', 'A03', 'A04b', 'A05', 'A06', 'A07', 'A08', 'A11', 'A14', 'A15', 'A16', 'A17']);   // 13 de 16
    expect(m('A04').cubierta).toBe(false);                     // omitida
    expect(m('A12').cubierta).toBe(false);                     // exceso 30 > 12
    expect(m('A13').cubierta).toBe(false);                     // la detección no llega al final
    expect(m('A11').cubridoras.map((x) => x.id)).toEqual(['D08']);        // contenidaEn A10, que sí está cubierta
    expect(m('A07').cubridoras.map((x) => x.id)).toEqual(['D07']);
    expect(m('A08').cubridoras.map((x) => x.id)).toEqual(['D07']);
  });

  it('exacta y tipificada se cuentan sobre las cubiertas y sobre todas las menciones respectivamente', () => {
    expect(EV.menciones.filter((x) => x.exacta).map((x) => x.g.id.slice(4))).toEqual(['A01', 'A02', 'A03', 'A04b', 'A05', 'A06', 'A16', 'A17']);   // 8
    expect(m('A14').exacta).toBe(false);                       // [695,735) contra [700,730)
    expect(m('A05').tipificada).toBe(false);                   // teléfono detectado como CC: se protege, pero con otro grupo
    expect(m('A05').cubierta).toBe(true);
    expect(m('A08').tipificada).toBe(true);                    // CC detectada como NIT: mismo grupo (identificaciones)
    expect(m('A11').tipificada).toBe(false);                   // municipio cubierto por una ENTIDAD
    expect(EV.menciones.filter((x) => x.tipificada)).toHaveLength(11);
  });

  it('verdadera, falsa, bandera correcta y falsa de negativo', () => {
    expect(EV.detecciones.filter((x) => x.verdadera).map((x) => x.d.id)).toEqual(['D01', 'D02', 'D03', 'D05', 'D06', 'D07', 'D12', 'D13', 'D16', 'D17', 'D18']);
    expect(d('D08').falsa).toBe(true);                         // 10 de 40 caracteres (el despacho no es G⁺)
    expect(d('D14').falsa).toBe(true);                         // cubre A15 pero 5 de 17: no cuenta como verdadera
    expect(d('D14').verdadera).toBe(false);
    expect(d('D09')).toMatchObject({ verdadera: false, banderaCorrecta: true, falsa: false });
    expect(d('D10')).toMatchObject({ falsa: true, falsaDeNegativo: true });
    expect(d('D11')).toMatchObject({ falsa: true, falsaDeNegativo: false });
    expect(d('D15').falsa).toBe(true);
    expect(EV.falsas).toBe(5);                                 // D08, D10, D11, D14, D15
  });

  it('la bandera correcta exige la bandera vinculada a esa detección', () => {
    const sinVinculo = evaluarDocumento({ ...ENTRADA, banderas: [{ tipo: 'CITA_JURISPRUDENCIAL', parte: PARTE, start: 400, end: 430 }] });
    expect(sinVinculo.detecciones.find((x) => x.d.id === 'D09')).toMatchObject({ banderaCorrecta: false, falsa: true });
    const otroTipo = evaluarDocumento({ ...ENTRADA, banderas: [{ tipo: 'CARGO', parte: PARTE, start: 400, end: 430, deteccion: 'D09' }] });
    expect(otroTipo.detecciones.find((x) => x.d.id === 'D09')?.falsa).toBe(true);
  });

  it('fusión (dos datos contiguos en una detección), consistencia y colisión', () => {
    expect(d('D07').fusion).toBe(true);
    expect(EV.detecciones.filter((x) => x.fusion)).toHaveLength(1);
    // Entidades con ≥ 2 menciones cubiertas: E01 (D01 y D02 en Entity distintas) y E14 (D17 y D18 en la misma). E03 solo tiene 1.
    expect(EV.consistencia).toEqual({ evaluadas: 2, consistentes: 1, colisiones: 1, fusiones: 1 });   // colisión: En5 cubre E06 y E07
  });

  it('entidades gold: estricta y laxa', () => {
    const e = (id: string): (typeof EV.entidades)[number] => {
      const r = EV.entidades.find((x) => x.entidad.id === `T01-${id}`);
      if (r === undefined) throw new Error(id);
      return r;
    };
    expect(EV.entidades).toHaveLength(13);                      // E15 a E19 no tienen menciones positivas
    expect(e('E03')).toMatchObject({ menciones: 2, cubiertas: 1 });   // laxa sí, estricta no
    expect(e('E01')).toMatchObject({ menciones: 2, cubiertas: 2 });
    expect(e('E10')).toMatchObject({ menciones: 1, cubiertas: 0 });
  });

  it('negativos y citas con radicado; banderas y sugerencias esperadas', () => {
    expect(EV.negativos).toEqual({ total: 2, conDeteccion: 1, citasConRadicado: 1, banderasPresentes: 1 });   // N2 con detección; N3 sin; N1 es cita
    expect(EV.generalizacion).toEqual([
      { tipo: 'CARGO', esperadas: 1, presentes: 1 },
      { tipo: 'DESPACHO_A_GENERICO', esperadas: 1, presentes: 1 },
      { tipo: 'DIAGNOSTICO', esperadas: 1, presentes: 0 },
      { tipo: 'MUNICIPIO_A_DEPARTAMENTO', esperadas: 1, presentes: 0 },
    ]);
  });

  // P0-4: cada brecha lleva los ids de anotación afectados (10.4.3), también en las cifras que no son filas de exhaustividad.
  it('ids de anotación afectados: sugerencias y banderas que faltan, negativos con detección, entidades inconsistentes y colisiones', () => {
    expect(EV.idsAfectados).toEqual({
      generalizacion: { DIAGNOSTICO: ['T01-A19'], MUNICIPIO_A_DEPARTAMENTO: ['T01-A11'] },
      negativos: ['T01-N2'],
      consistencia: { ids: ['T01-A01', 'T01-A02'], lista: [], fechas_valores: [], modelo: [] },   // E01: D01 y D02 en Entity distintas
      colisiones: ['T01-A07', 'T01-A08'],                                                         // En5 cubre E06 y E07
      colisionesDelModelo: [],
    });
    const informe = construirInforme([ENTRADA, ENTRADA], CORRIDA);
    expect(informe.idsAfectados?.negativos).toEqual(['T01-N2', 'T01-N2']);
    expect(informe.idsAfectados?.generalizacion['DIAGNOSTICO']).toEqual(['T01-A19', 'T01-A19']);
  });
});

describe('T-ME-01 · filas por grupo', () => {
  it('fila global (todos los tipos): R = 13/16, P = 11/16 y F2 = 715/912', () => {
    const t = fila('TODOS');
    expect(t).toMatchObject({ n: 16, cubiertas: 13, detecciones: 17, verdaderas: 11, falsas: 5 });
    expect(t.exhaustividadMencion).toBeCloseTo(13 / 16, 12);
    expect(t.precision).toBeCloseTo(11 / 16, 12);                // verdaderas / (verdaderas + falsas); la bandera correcta no cuenta
    expect(t.f2).toBeCloseTo(715 / 912, 12);                     // 5·(11/16)(13/16) / (4·11/16 + 13/16)
    expect(t.exhaustividadTipificada).toBeCloseTo(11 / 16, 12);
    expect(t.coincidenciaExacta).toBeCloseTo(8 / 13, 12);
    expect(t.entidades).toBe(13);
    expect(t.exhaustividadEntidadEstricta).toBeCloseTo(10 / 13, 12);   // fallan E03 (1 de 2 menciones), E10 y E11
    expect(t.exhaustividadEntidadLaxa).toBeCloseTo(11 / 13, 12);       // E03 se rescata con su mención cubierta; fallan E10 y E11
  });

  it('fila CC: R = 4/5, P = 3/5, F2 = 0,75; entidades 3/4 estricta y laxa', () => {
    const f = fila('CC');
    expect(f).toMatchObject({ n: 5, cubiertas: 4, detecciones: 5, verdaderas: 3, falsas: 2 });
    expect(f.exhaustividadMencion).toBeCloseTo(0.8, 12);
    expect(f.precision).toBeCloseTo(0.6, 12);
    expect(f.f2).toBeCloseTo(0.75, 12);                          // 5·0,6·0,8 / (4·0,6 + 0,8) = 2,4 / 3,2
    expect(f.exhaustividadTipificada).toBeCloseTo(0.8, 12);
    expect(f.coincidenciaExacta).toBeCloseTo(0.5, 12);           // A01 y A02 exactas; A08 y A15 no
    expect(f.entidades).toBe(4);
    expect(f.exhaustividadEntidadEstricta).toBeCloseTo(0.75, 12);
    expect(f.exhaustividadEntidadLaxa).toBeCloseTo(0.75, 12);
  });

  it('personas fuera de la lista: estricta 1/3 y laxa 2/3; la persona de la lista queda fuera', () => {
    const f = fila('PERSONA_FUERA');
    expect(f).toMatchObject({ n: 5, cubiertas: 3, detecciones: 4, verdaderas: 4, falsas: 0 });
    expect(f.exhaustividadMencion).toBeCloseTo(3 / 5, 12);
    expect(f.entidades).toBe(3);                                 // E03, E11 y E14
    expect(f.exhaustividadEntidadEstricta).toBeCloseTo(1 / 3, 12);
    expect(f.exhaustividadEntidadLaxa).toBeCloseTo(2 / 3, 12);
    expect(fila('PERSONA_FUERA@natural')).toEqual({ ...f, grupo: 'PERSONA_FUERA@natural' });
    const lista = fila('LISTA');
    expect(lista).toMatchObject({ n: 1, cubiertas: 1, entidades: 1, exhaustividadEntidadEstricta: 1 });
  });

  it('un grupo sin menciones positivas da 0 en todas las razones y no divide por cero (el despacho no es G⁺)', () => {
    const f = fila('ORG_FUERA');
    expect(f).toMatchObject({
      n: 0, cubiertas: 0, exhaustividadMencion: 0, exhaustividadTipificada: 0, entidades: 0, exhaustividadEntidadEstricta: 0,
      exhaustividadEntidadLaxa: 0, detecciones: 1, verdaderas: 0, falsas: 1, precision: 0, f2: 0, coincidenciaExacta: 0,
    });                                                          // la única detección de organización, D08, es falsa
    const vacia = fila('TELEFONO');
    expect(vacia).toMatchObject({ n: 1, cubiertas: 1, detecciones: 0, precision: 0, f2: 0 });   // cubierta con otro tipo: sin detecciones TELEFONO
  });
});

// ---------------------------------------------------------------------------------------------------------------- residuos
describe('T-ME-01 · residuos y omisiones (10.3.4)', () => {
  const seg = (a: number, b: number, detectionId?: string): SegmentoSalida =>
    ({ outStart: a, outEnd: b, partStart: a, partEnd: b, ...(detectionId === undefined ? {} : { detectionId }) });
  // Parte de 150 caracteres. Reemplazado: a1 [0,10), la mitad de b1 [40,50), f1 [130,140). El resto está copiado.
  const SEGMENTOS: SegmentoSalida[] = [
    seg(0, 10, 'det-a1'), seg(10, 40), seg(40, 50, 'det-b1'), seg(50, 130), seg(130, 140, 'det-f1'), seg(140, 150),
  ];
  const SALIDA: SalidaParte[] = [{ parte: PARTE, texto: 'x'.repeat(150), segmentos: SEGMENTOS }];
  const a = (id: string, tipo: DataType, start: number, end: number, entidad: string): GoldAnnotation => ann(id, tipo, start, end, entidad);
  const GOLD = {
    docId: 'T01', conjunto: 'desarrollo' as const,
    entidades: [
      ent('EA', 'CC', { mismoTitular: ['T01-ED'] }), ent('EB', 'PERSONA', { enLista: true }), ent('EC', 'PERSONA'),
      ent('ED', 'HC', { mismoTitular: ['T01-EA'] }), ent('EE', 'NIT'), ent('EF', 'CORREO'),
    ],
    anotaciones: [
      a('a1', 'CC', 0, 10, 'EA'),             // reemplazada del todo → protegida
      a('a2', 'CC', 20, 30, 'EA'),            // copiada, pero EA tiene a1 reemplazada → residuo
      a('b1', 'PERSONA', 40, 60, 'EB'),       // reemplazada la mitad: residuo parcial (límites cortos)
      a('c1', 'PERSONA', 70, 80, 'EC'),       // copiada y la entidad nunca se tocó, ni está en la lista → omisión
      a('d1', 'HC', 90, 100, 'ED'),           // copiada; su mismoTitular (EA) sí se tocó → residuo
      a('e1', 'NIT', 110, 120, 'EE'),         // copiada, sin relación → omisión
      a('f1', 'CORREO', 130, 140, 'EF'),      // reemplazada → protegida
    ],
  };

  it('caracteresCopiados cuenta solo los segmentos sin detectionId ni spanEditId', () => {
    expect(caracteresCopiados(SEGMENTOS, 0, 10)).toBe(0);
    expect(caracteresCopiados(SEGMENTOS, 20, 30)).toBe(10);
    expect(caracteresCopiados(SEGMENTOS, 40, 60)).toBe(10);
    expect(caracteresCopiados(SEGMENTOS, 35, 45)).toBe(5);
    const conEdicion: SegmentoSalida[] = [{ outStart: 0, outEnd: 5, partStart: 0, partEnd: 5, spanEditId: 'edt-1' }, seg(5, 10)];
    expect(caracteresCopiados(conEdicion, 0, 10)).toBe(5);
  });

  it('protegida, residuo (también parcial y por mismo titular) y omisión', () => {
    const r = clasificarMenciones(GOLD, SALIDA);
    expect(r.map((x) => [x.g.id.slice(4), x.clase, x.copiados])).toEqual([
      ['a1', 'protegida', 0], ['a2', 'residuo', 10], ['b1', 'residuo', 10], ['c1', 'omision', 10],
      ['d1', 'residuo', 10], ['e1', 'omision', 10], ['f1', 'protegida', 0],
    ]);
  });

  it('una persona de la lista con todo copiado es residuo, no omisión (el motor la conocía)', () => {
    const g = { ...GOLD, anotaciones: [a('l1', 'PERSONA', 150, 160, 'EB')] };
    const s: SalidaParte[] = [{ parte: PARTE, texto: 'x'.repeat(170), segmentos: [seg(0, 170)] }];
    expect(clasificarMenciones(g, s).map((x) => x.clase)).toEqual(['residuo']);
  });

  it('el informe suma residuos y omisiones por documento con ids de anotación, sin valores', () => {
    const informe = construirInforme([{
      gold: GOLD, detecciones: [], banderas: [], sugerencias: [], paginas: 1, salida: SALIDA, hitsPrimeraVuelta: 3, hitsUltimaVuelta: 0,
    }], CORRIDA);
    expect(informe.residuos).toMatchObject({ antesDelBucle: 3, despuesDelBucle: 0, omisiones: 2 });
    expect(informe.residuos.porDocumento).toEqual([
      { docId: 'T01', residuos: 3, omisiones: 2, idsAnotacion: ['T01-a2', 'T01-b1', 'T01-d1', 'T01-c1', 'T01-e1'] },
    ]);
    expect(JSON.stringify(informe)).not.toContain('xxxxx');       // el texto del gold no sale en el informe
    // Sin los hallazgos de residue.ts el escáner ve más de lo que residue.ts informó: no hay concordancia y el código de salida es 1.
    expect(informe.residuos.concordanciaResidueTs).toBe(false);
    expect(codigoDeSalida(informe)).toBe(1);
  });

  it('escáner independiente: literal, vista lista y solo dígitos; y concordancia con residue.ts', () => {
    const texto = 'Ana Ficticia, tel 3000000001; ANA FICTICIA, cédula 300.000.0001.';
    const hallazgos = escanearResiduos(PARTE, texto, ['Ana Ficticia', '3000000001']);
    const tramos = new Set(hallazgos.map((h) => `${h.start}-${h.end}`));
    expect(tramos).toEqual(new Set(['0-12', '30-42', '18-28', '51-63']));
    expect(hallazgos.filter((h) => h.forma === 'literal').map((h) => `${h.start}-${h.end}`).sort()).toEqual(['0-12', '18-28']);
    expect(hallazgos.filter((h) => h.forma === 'digitos').map((h) => `${h.start}-${h.end}`).sort()).toEqual(['18-28', '51-63']);
    expect(hallazgos.filter((h) => h.forma === 'lista').map((h) => `${h.start}-${h.end}`)).toContain('30-42');
    expect(escanearResiduos(PARTE, texto, ['12'])).toEqual([]);                  // menos de 5 dígitos no se busca como dígitos
    expect(escanearResiduos(PARTE, texto, [''])).toEqual([]);
    const todos = [...tramos].map((t) => ({ parte: PARTE, start: Number(t.split('-')[0]), end: Number(t.split('-')[1]) }));
    expect(concordancia(hallazgos, todos)).toBe(true);
    expect(concordancia(hallazgos, todos.slice(1))).toBe(false);                 // residue.ts se dejó un hallazgo
    expect(concordancia([], [])).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------- informe
describe('T-ME-01 · informe, tabla y código de salida', () => {
  const informe = construirInforme([ENTRADA], CORRIDA);

  it('el informe tiene la forma de MetricsReport (10.3.3) y los totales del juguete', () => {
    expect(informe.formato).toBe('sig-low/metricas');
    expect(informe.v).toBe(1);
    expect(informe.global.precision).toBeCloseTo(11 / 16, 12);
    expect(informe.global.f2).toBeCloseTo(715 / 912, 12);
    expect(informe.global.paginas).toBe(2);
    expect(informe.global.fpPorPagina).toBe(2.5);                // 5 falsas / 2 páginas
    expect(informe.global.maxFpPorPaginaDoc).toBe(2.5);
    expect(informe.consistencia).toEqual({ evaluadas: 2, consistentes: 1, colisiones: 1, fusiones: 1 });
    expect(informe.negativos).toEqual({ total: 2, conDeteccion: 1, citasConRadicado: 1, banderasPresentes: 1 });
    expect(informe.filas.map((f) => f.grupo)).toContain('PERSONA_FUERA@natural');
    expect(informe.filas.map((f) => f.grupo)).toContain('ORG_FUERA');
    expect(informe.residuos).toMatchObject({ antesDelBucle: 0, despuesDelBucle: 0, omisiones: 0, concordanciaResidueTs: true });
  });

  it('suma varios documentos: precisión global y páginas', () => {
    const dos = construirInforme([ENTRADA, { ...ENTRADA, gold: { ...ENTRADA.gold, docId: 'T02' } }], CORRIDA);
    expect(dos.global.paginas).toBe(4);
    expect(dos.global.precision).toBeCloseTo(11 / 16, 12);       // dos copias idénticas
    expect(dos.global.fpPorPagina).toBe(2.5);
    expect(dos.consistencia.evaluadas).toBe(4);
  });

  it('código de salida: 0 con el bucle en 0, 1 con residuos finales, discordancia o veredicto que no cierra', () => {
    expect(codigoDeSalida(informe)).toBe(0);
    expect(codigoDeSalida({ ...informe, residuos: { ...informe.residuos, despuesDelBucle: 1 } })).toBe(1);
    expect(codigoDeSalida({ ...informe, residuos: { ...informe.residuos, concordanciaResidueTs: false } })).toBe(1);
    expect(codigoDeSalida({ ...informe, veredicto: { cierra: false, incumplidos: ['CC'] } })).toBe(1);
    expect(codigoDeSalida({ ...informe, veredicto: { cierra: true, incumplidos: [] } })).toBe(0);
  });

  it('la tabla de la terminal no contiene valores del gold ni textos de detección', () => {
    const t = tablaTexto(informe);
    expect(t).toContain('CC');
    expect(t).toContain('global: precisión 0.688');
    expect(t).not.toContain('xxxx');
  });

  it('nombre del informe: AAAAMMDD-HHMM-<config>-<vista>-<hilos>h.json; una corrida de un solo conjunto lleva -<conjunto>', () => {
    expect(nombreInforme({ ...CORRIDA, conjunto: 'todo' }, CORRIDA.fecha)).toBe('20261030-1405-sin-modelo-natural-1h.json');
    expect(nombreInforme({ config: 'x-large', vista: 'mayusculas', hilos: 8 }, '2026-11-02T09:07:33')).toBe('20261102-0907-x-large-mayusculas-8h.json');
    expect(nombreInforme({ ...CORRIDA, conjunto: 'todo' }, 'ayer')).toBe('sin-fecha-sin-modelo-natural-1h.json');
    // P0-4: la reserva aparte (10.4.1) corre en el mismo minuto que la de los 29 y no debe pisar su informe.
    expect(nombreInforme(CORRIDA, CORRIDA.fecha)).toBe('20261030-1405-sin-modelo-natural-1h-desarrollo.json');
    expect(nombreInforme({ ...CORRIDA, config: 'x-large', hilos: 8, conjunto: 'reserva' }, CORRIDA.fecha)).toBe('20261030-1405-x-large-natural-8h-reserva.json');
  });
});
