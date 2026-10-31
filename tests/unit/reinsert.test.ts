// T-RI-01 a T-RI-09 · Reinserción (plan 6.10, 7.14, 10.7). Solo datos ficticios.
// T-RI-10 (tabla bloqueada, aviso de datos reales, volcado del almacenamiento) es de la pantalla de PC-6 y de las E2E.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyReviewAction, buildReviewState, consolidate, emptyTable, precedenceOf, tableIndexOf, type ReviewContext } from '../../src/core/entities.ts';
import { buildReinsertion, findMarkers, findMarkersWith } from '../../src/core/reinsert.ts';
import { joinOutput, render } from '../../src/core/render.ts';
import { MARKER_FAMILIES, MARKER_LABEL, type AlterationKind } from '../../src/core/types.ts';
import type {
  AsuntoId, DataType, DetectableType, DocId, DocumentModel, IdSource, MappingEntry, MappingTable, MarkerMatch, MergedCandidate, Part,
  PartId, PartKind, ReinsertionDecision, ReinsertionInput, ReinsertionResult, RenderedOutput, Role,
} from '../../src/core/types.ts';
import { VARIANTES, transformar } from '../fixtures/reinsercion/transformar.ts';

// ---- Tabla de prueba (7.14.4) ----------------------------------------------------------------------------------------

const D1 = 'doc_00000000000000000000000000000001' as DocId;
const D2 = 'doc_00000000000000000000000000000002' as DocId;
const TIPO: Record<string, DetectableType> = {
  DEMANDANTE: 'PERSONA', CC: 'CC', 'DIRECCIÓN': 'DIRECCION', 'TELÉFONO': 'TELEFONO', EPS: 'EPS', VALOR: 'VALOR', DOCUMENTO: 'DOCUMENTO',
};

function entrada(marker: string, display: string, doc: DocId): MappingEntry {
  const etiqueta = /^\[(.+)_\d+\]$/u.exec(marker)?.[1] as string;
  const family = MARKER_FAMILIES.find((f) => MARKER_LABEL[f] === etiqueta) as MappingEntry['family'];
  return { marker, family, type: TIPO[etiqueta] as DetectableType, canonicalKey: `K:${marker}`, display, originals: [display],
    firstSeen: { docId: doc, partKind: 'cuerpo', partOrder: 0, start: 0 }, documents: [doc], sameHolderAs: [] };
}
function tabla(filas: Array<[string, string, DocId]>): MappingTable {
  return { asuntoId: 'asu_00000000000000000000000000000001' as AsuntoId, counters: {},
    entries: Object.fromEntries(filas.map(([m, d, doc]) => [m, entrada(m, d, doc)])), documents: [] };
}
const TABLA = tabla([
  ['[DEMANDANTE_1]', 'Ana Ficticia Rojas', D1], ['[CC_1]', '1.000.000.017', D1], ['[DIRECCIÓN_1]', 'Calle 00 n.º 00-00', D1],
  ['[TELÉFONO_1]', '300 000 0001', D1], ['[EPS_1]', 'EPS Ejemplo S.A.', D1], ['[VALOR_1]', '$48.000.000', D1], ['[DOCUMENTO_1]', '1.000.000.025', D2],
]);

function seqIds(): IdSource {
  let n = 1;
  return { next: (p) => `${p}_${(n++).toString(16).padStart(32, '0')}` };
}
const entrar = (response: string, expectedFrom: DocId | null = D1, table: MappingTable = TABLA): ReinsertionInput => ({ response, table, expectedFrom });
const buscar = (response: string, expectedFrom: DocId | null = D1, table: MappingTable = TABLA): MarkerMatch[] =>
  findMarkersWith(entrar(response, expectedFrom, table), seqIds());
/** «tramo|clase|alteraciones» de cada coincidencia, en orden. */
const resumen = (ms: readonly MarkerMatch[]): string[] => ms.map((m) => `${m.found}|${m.kind}|${m.alterations.join(',')}`);
const dec = (m: MarkerMatch, action: ReinsertionDecision['action'], text?: string): ReinsertionDecision =>
  text === undefined ? { matchId: m.id, action } : { matchId: m.id, action, text };
const decisiones = (...ds: ReinsertionDecision[]): Record<string, ReinsertionDecision> => Object.fromEntries(ds.map((d) => [d.matchId, d]));
function reinsertar(response: string, ds: (ms: MarkerMatch[]) => Record<string, ReinsertionDecision> = () => ({}), ack = false,
  expectedFrom: DocId | null = D1): { ms: MarkerMatch[]; r: ReinsertionResult } {
  const input = entrar(response, expectedFrom);
  const ms = findMarkersWith(input, seqIds());
  return { ms, r: buildReinsertion(input, ms, ds(ms), ack) };
}
const ALT: AlterationKind[] = ['delimitador', 'sin_delimitador', 'separador', 'mayusculas_minusculas', 'sin_tilde', 'espacios', 'sufijo_pegado'];

// ---- T-RI-01 · exactos ---------------------------------------------------------------------------------------------------

describe('T-RI-01 · marcadores exactos (R-REI-01, 7.14.1)', () => {
  it('T-RI-01 dos exactos con reemplazo automático', () => {
    const { ms, r } = reinsertar('[DEMANDANTE_1] presentó la tutela contra [EPS_1].');
    expect(resumen(ms)).toEqual(['[DEMANDANTE_1]|exacto|', '[EPS_1]|exacto|']);
    expect(ms.every((m) => m.inTable)).toBe(true);
    // PB-4-r1: el punto de la abreviatura y el de la oración son uno («S.A.», no «S.A..»).
    expect(r.text).toBe('Ana Ficticia Rojas presentó la tutela contra EPS Ejemplo S.A.');
  });

  it('T-RI-01 cada fila exacta de R-REI-01 y los marcadores con tilde', () => {
    const filas: Array<[string, string]> = [
      ['según [DEMANDANTE_1] y', '[DEMANDANTE_1]'], ['[TELÉFONO_1]', '[TELÉFONO_1]'], ['registro civil [DOCUMENTO_1]', '[DOCUMENTO_1]'],
      ["el nombre '[DEMANDANTE_1]' aparece", '[DEMANDANTE_1]'], ['la ‘[EPS_1]’ negó', '[EPS_1]'], ['**[DEMANDANTE_1]** firmó', '[DEMANDANTE_1]'],
      ['vive en [DIRECCIÓN_1]', '[DIRECCIÓN_1]'], ['el [VALOR_1] total', '[VALOR_1]'],
    ];
    for (const [texto, marcador] of filas) expect(resumen(buscar(texto)), texto).toEqual([`${marcador}|exacto|`]);
  });

  it('T-RI-01 fuera de la tabla es desconocido y la propuesta es el display de la tabla', () => {
    expect(resumen(buscar('el [TESTIGO_3] dijo y [CC_12]'))).toEqual(['[TESTIGO_3]|desconocido|', '[CC_12]|desconocido|']);
    const [m] = buscar('[CC_1]');
    expect(m).toMatchObject({ canonical: '[CC_1]', family: 'CC', n: 1, inTable: true, proposal: '1.000.000.017', start: 0, end: 6 });
    expect(buscar('[DIRECCIÓN_1]')[0]).toMatchObject({ family: 'DIRECCION', canonical: '[DIRECCIÓN_1]' });
  });

  it('T-RI-01 los ids son únicos, con prefijo rei_ y no derivan del contenido', () => {
    const ms = findMarkers(entrar('[CC_1] [CC_1] [EPS_1]'));
    expect(new Set(ms.map((m) => m.id)).size).toBe(3);
    for (const m of ms) expect(m.id).toMatch(/^rei_[0-9a-f]{32}$/u);
    expect(findMarkers(entrar('[CC_1] [CC_1] [EPS_1]')).map((m) => m.id)).not.toEqual(ms.map((m) => m.id));
  });
});

// ---- T-RI-02 · alterados -------------------------------------------------------------------------------------------------

describe('T-RI-02 · marcadores alterados (R-REI-03, 7.14.1)', () => {
  const FILAS: Array<[string, string, string, AlterationKind[]]> = [
    ['[DEMANDANTE 1]', '[DEMANDANTE 1]', '[DEMANDANTE_1]', ['separador']],
    ['[DOCUMENTO 1]', '[DOCUMENTO 1]', '[DOCUMENTO_1]', ['separador']],
    ['[EPS 1]', '[EPS 1]', '[EPS_1]', ['separador']],
    ['Demandante 1 presentó', 'Demandante 1', '[DEMANDANTE_1]', ['sin_delimitador', 'separador', 'mayusculas_minusculas']],
    ['DEMANDANTE-1', 'DEMANDANTE-1', '[DEMANDANTE_1]', ['sin_delimitador', 'separador']],
    ['la demandante n.º 1', 'demandante n.º 1', '[DEMANDANTE_1]', ['sin_delimitador', 'separador', 'mayusculas_minusculas']],
    ['demandante No. 1', 'demandante No. 1', '[DEMANDANTE_1]', ['sin_delimitador', 'separador', 'mayusculas_minusculas']],
    ['Demandante N° 1', 'Demandante N° 1', '[DEMANDANTE_1]', ['sin_delimitador', 'separador', 'mayusculas_minusculas']],
    ['demandante número 1', 'demandante número 1', '[DEMANDANTE_1]', ['sin_delimitador', 'separador', 'mayusculas_minusculas']],
    ['[demandante_1]', '[demandante_1]', '[DEMANDANTE_1]', ['mayusculas_minusculas']],
    ['[DIRECCION_1]', '[DIRECCION_1]', '[DIRECCIÓN_1]', ['sin_tilde']],
    ['[ direccion_1 ]', '[ direccion_1 ]', '[DIRECCIÓN_1]', ['mayusculas_minusculas', 'sin_tilde', 'espacios']],
    ['[ DEMANDANTE_1 ]', '[ DEMANDANTE_1 ]', '[DEMANDANTE_1]', ['espacios']],
    ['(CC_1)', '(CC_1)', '[CC_1]', ['delimitador']],
    ['CC_1', 'CC_1', '[CC_1]', ['sin_delimitador']],
    ['DEMANDANTE_1 firmó', 'DEMANDANTE_1', '[DEMANDANTE_1]', ['sin_delimitador']],
    ['[DEMANDANTE_1 y', '[DEMANDANTE_1', '[DEMANDANTE_1]', ['delimitador']],
    ['DEMANDANTE_1] y', 'DEMANDANTE_1]', '[DEMANDANTE_1]', ['delimitador']],
    ['[Telefono_1]', '[Telefono_1]', '[TELÉFONO_1]', ['mayusculas_minusculas', 'sin_tilde']],
    ["Demandante 1's lawyer", "Demandante 1's", '[DEMANDANTE_1]', ['sin_delimitador', 'separador', 'mayusculas_minusculas', 'sufijo_pegado']],
    ['[DEMANDANTES_1]', '[DEMANDANTES_1]', '[DEMANDANTE_1]', ['sufijo_pegado']],
    ['[Demandante No. 1]', '[Demandante No. 1]', '[DEMANDANTE_1]', ['separador', 'mayusculas_minusculas']],
    ['Valor 1', 'Valor 1', '[VALOR_1]', ['sin_delimitador', 'separador', 'mayusculas_minusculas']],
    ['Demandante1', 'Demandante1', '[DEMANDANTE_1]', ['sin_delimitador', 'separador', 'mayusculas_minusculas']],
    ['Ver Demandante 1.', 'Demandante 1', '[DEMANDANTE_1]', ['sin_delimitador', 'separador', 'mayusculas_minusculas']],
    ['según [DEMANDANTE\\_1] (markdown)', '[DEMANDANTE\\_1]', '[DEMANDANTE_1]', ['separador']],
    ['según \\[DEMANDANTE\\_1\\] y', '\\[DEMANDANTE\\_1\\]', '[DEMANDANTE_1]', ['delimitador', 'separador']],
    ['\\[demandante\\_1\\]', '\\[demandante\\_1\\]', '[DEMANDANTE_1]', ['delimitador', 'separador', 'mayusculas_minusculas']],
    ["[DEMANDANTE_1]'s claim", "[DEMANDANTE_1]'s", '[DEMANDANTE_1]', ['sufijo_pegado']],
    ['los [DEMANDANTE_1]s', '[DEMANDANTE_1]s', '[DEMANDANTE_1]', ['sufijo_pegado']],
  ];

  it('T-RI-02 cada fila de R-REI-03 y R-REI-01 (sufijo) es alterada, con las alteraciones y el orden de AlterationKind', () => {
    for (const [texto, tramo, canonico, alts] of FILAS) {
      const ms = buscar(texto);
      expect(resumen(ms), texto).toEqual([`${tramo}|alterado|${alts.join(',')}`]);
      expect(ms[0]?.canonical, texto).toBe(canonico);
      expect(ms[0]?.inTable, texto).toBe(true);
      expect(ms[0]?.proposal, texto).toBe(TABLA.entries[canonico]?.display);
      expect(texto.slice(ms[0]?.start, ms[0]?.end), texto).toBe(tramo);
    }
  });

  it('T-RI-02 las diez formas de la prueba se reconocen juntas y sin decisión no se reemplaza ninguna', () => {
    const texto = '[DEMANDANTE 1], Demandante 1, DEMANDANTE-1, demandante n.º 1, [demandante_1], [DIRECCION_1], [ direccion_1 ], (CC_1), CC_1, [DOCUMENTO 1]';
    const { ms, r } = reinsertar(texto);
    expect(ms).toHaveLength(10);
    expect(ms.every((m) => m.kind === 'alterado')).toBe(true);
    expect(r.text).toBe(texto);
    expect(r.alerts.altered).toHaveLength(10);
    expect(r.ready).toBe(false);
  });

  it('T-RI-02 confirmar una forma la reemplaza con entry.display y deja las demás', () => {
    const { r } = reinsertar('La [DEMANDANTE_1] vive en [DIRECCION_1]. Ver Demandante 1.', (ms) => decisiones(dec(ms[1] as MarkerMatch, 'reemplazar')));
    expect(r.text).toBe('La Ana Ficticia Rojas vive en Calle 00 n.º 00-00. Ver Demandante 1.');
    expect(r.ready).toBe(false);   // «Demandante 1» sigue sin decisión
  });

  it('T-RI-02 el sufijo pegado se conserva y el plural pegado a la etiqueta no', () => {
    const confirmar = (texto: string): string => reinsertar(texto, (ms) => decisiones(...ms.map((m) => dec(m, 'reemplazar')))).r.text;
    expect(confirmar("[DEMANDANTE_1]'s claim")).toBe("Ana Ficticia Rojas's claim");
    expect(confirmar('[DEMANDANTE_1]’s claim')).toBe('Ana Ficticia Rojas’s claim');
    expect(confirmar('los [DEMANDANTE_1]s')).toBe('los Ana Ficticia Rojass');
    expect(confirmar('[DEMANDANTES_1] firmó')).toBe('Ana Ficticia Rojas firmó');
    expect(confirmar("Demandante 1's lawyer")).toBe("Ana Ficticia Rojas's lawyer");
  });

  it('T-RI-02 se cubren las siete clases de alteración', () => {
    const vistas = new Set(FILAS.flatMap((f) => f[3]));
    expect([...vistas].sort()).toEqual([...ALT].sort());
  });
});

// ---- T-RI-03 · desconocidos ----------------------------------------------------------------------------------------------

describe('T-RI-03 · marcadores desconocidos (R-REI-02, 7.14.1)', () => {
  it('T-RI-03 etiqueta inexistente, número fuera de rango o marcador de otro asunto', () => {
    const texto = '[DEMANDANTE_9] [CC_12] [TESTIGO_3] [ABOGADO_1] [PLAINTIFF_1] [OTRA_PERSONA_2] [CC_01] [DEMANDANTE_0] [DOCUMENTO_0] [CC_10000]';
    const ms = buscar(texto);
    expect(ms.map((m) => m.found)).toEqual(texto.split(' '));
    expect(ms.every((m) => m.kind === 'desconocido' && !m.inTable && m.proposal === undefined)).toBe(true);
    expect(ms[0]).toMatchObject({ canonical: '[DEMANDANTE_9]', family: 'DEMANDANTE', n: 9 });
    expect(ms[3]?.canonical).toBeUndefined();
    expect(ms[6]?.canonical).toBeUndefined();
  });

  it('T-RI-03 los escapes de Markdown de un desconocido suman delimitador y separador', () => {
    expect(resumen(buscar('\\[ABOGADO\\_1\\]'))).toEqual(['\\[ABOGADO\\_1\\]|desconocido|delimitador,separador']);
  });

  it('T-RI-03 forma alterada cuya canónica no está en la tabla es desconocida; «Testigo 3 declaró»', () => {
    expect(resumen(buscar('Testigo 3 declaró'))).toEqual(['Testigo 3|desconocido|sin_delimitador,separador,mayusculas_minusculas']);
    expect(resumen(buscar('[Direccion_2]'))).toEqual(['[Direccion_2]|desconocido|mayusculas_minusculas,sin_tilde']);
  });

  it('T-RI-03 solo dejar o editar: un desconocido no se reemplaza ni aun con la decisión «reemplazar»', () => {
    const base = reinsertar('Firmó [ABOGADO_1] y [DEMANDANTE_9].');
    expect(base.r.text).toBe('Firmó [ABOGADO_1] y [DEMANDANTE_9].');
    expect(base.r.ready).toBe(false);
    const forzado = reinsertar('Firmó [ABOGADO_1] y [DEMANDANTE_9].', (ms) => decisiones(...ms.map((m) => dec(m, 'reemplazar'))));
    expect(forzado.r.text).toBe('Firmó [ABOGADO_1] y [DEMANDANTE_9].');
    expect(forzado.r.ready).toBe(false);
    const dejado = reinsertar('Firmó [ABOGADO_1] y [DEMANDANTE_9].', (ms) => decisiones(dec(ms[0] as MarkerMatch, 'dejar'), dec(ms[1] as MarkerMatch, 'editar', 'Luis Prueba')), false, null);
    expect(dejado.r.text).toBe('Firmó [ABOGADO_1] y Luis Prueba.');
    expect(dejado.r.ready).toBe(true);
    expect(dejado.r.alerts.unknown).toEqual(dejado.ms.map((m) => m.id));
  });
});

// ---- T-RI-04 · faltantes -------------------------------------------------------------------------------------------------

describe('T-RI-04 · marcadores faltantes (7.14.2)', () => {
  const RESP = 'La [DEMANDANTE_1] (C.C. [CC_1]) vive en [DIRECCION_1]. [ABOGADO_1] firmó. Ver Demandante 1.';

  it('T-RI-04 con expectedFrom del documento: faltan los marcadores de la tabla que no aparecen', () => {
    const { ms, r } = reinsertar(RESP, () => ({}), false, D1);
    expect(resumen(ms)).toEqual([
      '[DEMANDANTE_1]|exacto|', '[CC_1]|exacto|', '[DIRECCION_1]|alterado|sin_tilde', '[ABOGADO_1]|desconocido|', 'Demandante 1|alterado|sin_delimitador,separador,mayusculas_minusculas',
    ]);
    expect(r.alerts.missing).toEqual(['[TELÉFONO_1]', '[EPS_1]', '[VALOR_1]']);
    expect(r.ready).toBe(false);
  });

  it('T-RI-04 un alterado cuenta como presente; un desconocido no; un marcador de otro documento no falta', () => {
    expect(reinsertar('[DIRECCION_1]', () => ({}), false, D1).r.alerts.missing).toEqual(['[DEMANDANTE_1]', '[CC_1]', '[TELÉFONO_1]', '[EPS_1]', '[VALOR_1]']);
    expect(reinsertar('[DOCUMENTO_1]', () => ({}), false, D2).r.alerts.missing).toEqual([]);
    expect(reinsertar('', () => ({}), false, D2).r.alerts.missing).toEqual(['[DOCUMENTO_1]']);
  });

  it('T-RI-04 ready exige reconocer los faltantes; la casilla los reconoce', () => {
    const resp = '[DEMANDANTE_1] [CC_1] [DIRECCIÓN_1] [TELÉFONO_1] [EPS_1]';
    const sin = reinsertar(resp);
    expect(sin.r.alerts.missing).toEqual(['[VALOR_1]']);
    expect(sin.r.ready).toBe(false);
    expect(sin.r.missingAcknowledged).toBe(false);
    const con = reinsertar(resp, () => ({}), true);
    expect(con.r.ready).toBe(true);
    expect(con.r.missingAcknowledged).toBe(true);
    expect(con.r.text).toBe('Ana Ficticia Rojas 1.000.000.017 Calle 00 n.º 00-00 300 000 0001 EPS Ejemplo S.A.');
  });

  it('T-RI-04 sin expectedFrom no se calculan faltantes', () => {
    const { r } = reinsertar(RESP, () => ({}), false, null);
    expect(r.alerts.missing).toEqual([]);
    expect(reinsertar('[DEMANDANTE_1] y [CC_1]', () => ({}), false, null).r.ready).toBe(true);
  });
});

// ---- T-RI-07 · Markdown --------------------------------------------------------------------------------------------------

describe('T-RI-07 · Markdown (7.14.1, paso 1)', () => {
  it('T-RI-07 el marcador con escapes es alterado y el negrita es exacto', () => {
    expect(resumen(buscar('\\[DEMANDANTE\\_1\\]'))).toEqual(['\\[DEMANDANTE\\_1\\]|alterado|delimitador,separador']);
    expect(resumen(buscar('**[DEMANDANTE_1]**'))).toEqual(['[DEMANDANTE_1]|exacto|']);
  });

  it('T-RI-07 el reemplazo del tramo con barras no deja barras sueltas', () => {
    const { r } = reinsertar('según \\[DEMANDANTE\\_1\\] y', (ms) => decisiones(dec(ms[0] as MarkerMatch, 'reemplazar')));
    expect(r.text).toBe('según Ana Ficticia Rojas y');
    const mixto = reinsertar('**\\[CC\\_1\\]** y **[CC_1]** y [CC\\_1]', (ms) => decisiones(...ms.map((m) => dec(m, 'reemplazar'))));
    expect(mixto.r.text).toBe('**1.000.000.017** y **1.000.000.017** y 1.000.000.017');
  });

  it('T-RI-07 un escape de [ sin cierre también es alterado y se reemplaza sin dejar la barra', () => {
    const { ms, r } = reinsertar('a \\[CC_1] b', (m) => decisiones(...m.map((x) => dec(x, 'reemplazar'))));
    expect(resumen(ms)).toEqual(['\\[CC_1]|alterado|delimitador']);
    expect(r.text).toBe('a 1.000.000.017 b');
  });
});

// ---- T-RI-08 · contigüidad y puntuación ------------------------------------------------------------------------------------

describe('T-RI-08 · contigüidad y puntuación', () => {
  it('T-RI-08 exactos pegados y con puntuación; el sufijo \'s es alterado', () => {
    expect(resumen(buscar('[CC_1][CC_1]'))).toEqual(['[CC_1]|exacto|', '[CC_1]|exacto|']);
    expect(resumen(buscar('[CC_1].'))).toEqual(['[CC_1]|exacto|']);
    expect(resumen(buscar('([DEMANDANTE_1])'))).toEqual(['[DEMANDANTE_1]|exacto|']);
    expect(resumen(buscar("[DEMANDANTE_1]'s"))).toEqual(["[DEMANDANTE_1]'s|alterado|sufijo_pegado"]);
  });

  it('T-RI-08 INV-N03 [CC_1][CC_1] se reemplaza de derecha a izquierda sin desplazar posiciones', () => {
    const { ms, r } = reinsertar('[CC_1][CC_1]');
    expect(r.text).toBe('1.000.000.0171.000.000.017');
    expect(ms.map((m) => [m.start, m.end])).toEqual([[0, 6], [6, 12]]);
    expect(r.matches.map((m) => [m.start, m.end])).toEqual([[0, 6], [6, 12]]);   // las posiciones de la respuesta no cambian
    expect(reinsertar('[CC_1].').r.text).toBe('1.000.000.017.');
    expect(reinsertar('([DEMANDANTE_1])').r.text).toBe('(Ana Ficticia Rojas)');
  });
});

// ---- T-RI-09 · no marcadores ---------------------------------------------------------------------------------------------

describe('T-RI-09 · textos que no son marcadores (7.14.1)', () => {
  it('T-RI-09 el demandante, CC 1, XDEMANDANTE 1, la calle 1 y Documento 1. Copia del contrato', () => {
    for (const t of ['el demandante', 'CC 1', 'XDEMANDANTE 1', 'la calle 1', 'Documento 1. Copia del contrato']) expect(buscar(t), t).toEqual([]);
  });

  it('T-RI-09 el resto de las filas «No» de R-REI-01, R-REI-02 y R-REI-03', () => {
    const textos = [
      '[1]', '[nota al pie]', '[A_1]', '[DEMANDANTE]', 'ABOGADO_1',
      'el demandante presentó', 'la demandante en el numeral 1', 'Calle 1 # 2-3', 'artículo 1', 'EPS 1',
      'los demandantes 1 y 2', 'el valor 1 corresponde', 'la empresa 1', 'Demandante 12345', 'demandante 1s', 'testigo1x',
      'Pretensiones del demandante. 1) Que se condene', 'pagar al demandante 1.000.000 de pesos',
    ];
    for (const t of textos) expect(buscar(t), t).toEqual([]);
  });

  it('T-RI-09 [DEMANDANTE_0], [DOCUMENTO_0] y [CC_10000] no son exactos; [CC_01], [DIRECCION_1], [demandante_1] tampoco', () => {
    for (const t of ['[DEMANDANTE_0]', '[DOCUMENTO_0]', '[CC_10000]', '[CC_01]', '[DIRECCION_1]', '[demandante_1]']) {
      expect(buscar(t).every((m) => m.kind !== 'exacto'), t).toBe(true);
    }
  });

  it('T-RI-09 un [DOCUMENTO_1] es exacto (decisión Q1) y se reemplaza', () => {
    expect(resumen(buscar('registro civil [DOCUMENTO_1]'))).toEqual(['[DOCUMENTO_1]|exacto|']);
    expect(reinsertar('registro civil [DOCUMENTO_1]', () => ({}), false, D2).r.text).toBe('registro civil 1.000.000.025');
  });
});

// ---- Invariantes de la reinserción ----------------------------------------------------------------------------------------

describe('INV-N01 · solo los exactos se reemplazan sin decisión', () => {
  const RESP = 'La [DEMANDANTE_1] (C.C. [CC_1]) vive en [DIRECCION_1]. [ABOGADO_1] firmó. Ver Demandante 1.';

  it('INV-N01 sin decisiones: exactos reemplazados; alterados y desconocidos intactos', () => {
    const { r } = reinsertar(RESP);
    expect(r.text).toBe('La Ana Ficticia Rojas (C.C. 1.000.000.017) vive en [DIRECCION_1]. [ABOGADO_1] firmó. Ver Demandante 1.');
    expect(r.alerts.altered).toHaveLength(2);
    expect(r.alerts.unknown).toHaveLength(1);
  });

  it('INV-N01 alterado «[DIRECCION_1]» confirmado; «[ABOGADO_1]» con «reemplazar» no cambia', () => {
    const { ms, r } = reinsertar(RESP, (m) => decisiones(dec(m[2] as MarkerMatch, 'reemplazar'), dec(m[3] as MarkerMatch, 'reemplazar')));
    expect(r.text).toBe('La Ana Ficticia Rojas (C.C. 1.000.000.017) vive en Calle 00 n.º 00-00. [ABOGADO_1] firmó. Ver Demandante 1.');
    expect(ms[3]?.kind).toBe('desconocido');
  });

  it('INV-N01 el abogado puede pasar un exacto a «dejar» o editarlo; un alterado en «dejar» queda tal cual', () => {
    expect(reinsertar('[CC_1] y [EPS_1]', (m) => decisiones(dec(m[0] as MarkerMatch, 'dejar'))).r.text).toBe('[CC_1] y EPS Ejemplo S.A.');
    expect(reinsertar('[CC_1] y [EPS_1]', (m) => decisiones(dec(m[1] as MarkerMatch, 'editar', 'otra'))).r.text).toBe('1.000.000.017 y otra');
    expect(reinsertar('[DIRECCION_1]', (m) => decisiones(dec(m[0] as MarkerMatch, 'dejar'))).r.text).toBe('[DIRECCION_1]');
  });

  it('INV-N01 una decisión de un id que no es de la búsqueda se ignora y no se devuelve', () => {
    const input = entrar('[CC_1] [ABOGADO_1]');
    const ms = findMarkersWith(input, seqIds());
    const ajena: ReinsertionDecision = { matchId: 'rei_ajeno' as MarkerMatch['id'], action: 'reemplazar' };
    const r = buildReinsertion(input, ms, { rei_ajeno: ajena, [(ms[1] as MarkerMatch).id]: dec(ms[1] as MarkerMatch, 'dejar') }, false);
    expect(Object.keys(r.decisions)).toEqual([(ms[1] as MarkerMatch).id]);
    expect(r.text).toBe('1.000.000.017 [ABOGADO_1]');
  });

  it('INV-N01 una búsqueda vieja (el texto cambió) no se aplica a otro texto', () => {
    const ms = buscar('[CC_1] x');
    const r = buildReinsertion(entrar('[EPS_1] x'), ms, {}, false);
    expect(r.text).toBe('[EPS_1] x');
  });
});

describe('INV-N02 · ready ⇔ todo alterado y desconocido decidido y faltantes reconocidos', () => {
  it('INV-N02 recorre todas las combinaciones de decisión y reconocimiento', () => {
    const base = '[DEMANDANTE_1] [DIRECCION_1] [ABOGADO_1] [CC_1] [TELÉFONO_1] [EPS_1]';
    for (const alt of [false, true]) for (const unk of [false, true]) for (const faltan of [false, true]) for (const ack of [false, true]) {
      const input = entrar(faltan ? base : `${base} [VALOR_1]`);
      const ms = findMarkersWith(input, seqIds());
      const ds: ReinsertionDecision[] = [];
      if (alt) ds.push(dec(ms.find((m) => m.kind === 'alterado') as MarkerMatch, 'reemplazar'));
      if (unk) ds.push(dec(ms.find((m) => m.kind === 'desconocido') as MarkerMatch, 'dejar'));
      const r = buildReinsertion(input, ms, decisiones(...ds), ack);
      expect(r.alerts.missing.length > 0, 'faltantes').toBe(faltan);
      expect(r.ready, `alt=${alt} unk=${unk} faltan=${faltan} ack=${ack}`).toBe(alt && unk && (!faltan || ack));
    }
  });

  it('INV-N02 «editar» sin texto no es una decisión; «reemplazar» sobre un desconocido tampoco', () => {
    const input = entrar('[ABOGADO_1] [CC_1] [DEMANDANTE_1] [DIRECCIÓN_1] [TELÉFONO_1] [EPS_1] [VALOR_1]');
    const ms = findMarkersWith(input, seqIds());
    const abogado = ms[0] as MarkerMatch;
    expect(buildReinsertion(input, ms, decisiones({ matchId: abogado.id, action: 'editar' }), false).ready).toBe(false);
    expect(buildReinsertion(input, ms, decisiones(dec(abogado, 'reemplazar')), false).ready).toBe(false);
    expect(buildReinsertion(input, ms, decisiones(dec(abogado, 'editar', '')), false).ready).toBe(true);
  });

  it('INV-N02 sin alertas ni faltantes, ready es verdadero; con la tabla vacía todo es desconocido', () => {
    expect(reinsertar('sin marcadores', () => ({}), false, null).r.ready).toBe(true);
    const vacia = tabla([]);
    const r = buildReinsertion(entrar('[CC_1]', D1, vacia), findMarkersWith(entrar('[CC_1]', D1, vacia), seqIds()), {}, false);
    expect(r.alerts.unknown).toHaveLength(1);
    expect(r.ready).toBe(false);
  });
});

describe('INV-N03 · reemplazos de derecha a izquierda sin correr posiciones', () => {
  it('INV-N03 coincide con la construcción de izquierda a derecha sobre una respuesta con marcadores pegados', () => {
    const resp = '[CC_1][CC_1]([EPS_1])[VALOR_1]. [DEMANDANTE_1]\'s [CC_1]x';
    const { ms, r } = reinsertar(resp, (m) => decisiones(...m.filter((x) => x.kind === 'alterado').map((x) => dec(x, 'reemplazar'))));
    let esperado = '';
    let cursor = 0;
    for (const m of ms) {
      esperado += resp.slice(cursor, m.start);
      const d = TABLA.entries[m.canonical as string]?.display as string;
      esperado += m.kind === 'alterado' ? d + "'s" : d;
      cursor = m.end;
    }
    esperado += resp.slice(cursor);
    expect(r.text).toBe(esperado);
    expect(r.text).toBe("1.000.000.0171.000.000.017(EPS Ejemplo S.A.)$48.000.000. Ana Ficticia Rojas's 1.000.000.017x");
  });

  it('INV-N03 la reinserción no modifica la entrada ni la búsqueda, y es repetible', () => {
    const input = entrar('[CC_1][CC_1] [DIRECCION_1]');
    const ms = findMarkersWith(input, seqIds());
    const antes = structuredClone({ input, ms });
    const ds = decisiones(dec(ms[2] as MarkerMatch, 'reemplazar'));
    const a = buildReinsertion(input, ms, ds, false);
    const b = buildReinsertion(input, ms, ds, false);
    expect({ input, ms }).toEqual(antes);
    expect(b).toEqual(a);
    expect(a.matches).toEqual(ms);
  });

  it('INV-N03 las posiciones son las del texto canónico aunque la vista las normalice (espacio duro, apóstrofo tipográfico)', () => {
    const resp = 'ho la [CC_1] y [DEMANDANTE_1]’s fin';
    const ms = buscar(resp);
    expect(ms.map((m) => resp.slice(m.start, m.end))).toEqual(['[CC_1]', '[DEMANDANTE_1]’s']);
    expect(ms.map((m) => m.found)).toEqual(['[CC_1]', '[DEMANDANTE_1]’s']);
  });
});

// ---- Rendimiento y entradas extremas ---------------------------------------------------------------------------------------

describe('reinsert.ts · entradas extremas', () => {
  it('T-RI-09 respuesta vacía, solo corchetes y texto largo sin marcadores', () => {
    expect(buscar('')).toEqual([]);
    expect(buscar('[[[[]]]] \\ \\\\ [ ] [_] [-1]')).toEqual([]);
    const t0 = Date.now();
    expect(buscar('[ab'.repeat(40_000))).toEqual([]);
    expect(buscar('Demandante '.repeat(20_000))).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(5_000);
  });
});

// ---- T-RI-05 y T-RI-06 · ida y vuelta con el corpus --------------------------------------------------------------------------

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
interface GoldAnn {
  parte: { kind: string; index: number; page?: number }; start: number; end: number; texto: string; tipo: string; rol?: string; entidad: string;
  debe_generalizarse: boolean; es_negativo_esperado: boolean;
}
interface GoldDoc { anotaciones: GoldAnn[]; entidades: Array<{ id: string; canonico: string }> }
interface TextoDoc { partes: Array<{ kind: string; index: number; page?: number; texto: string }> }

const IDS_CORPUS = existsSync(join(RAIZ, 'corpus', 'gold'))
  ? readdirSync(join(RAIZ, 'corpus', 'gold')).filter((f) => /^C\d\d\.texto\.json$/u.test(f)).map((f) => f.slice(0, 3)).sort()
  : [];
const leer = <T>(ruta: string): T => JSON.parse(readFileSync(ruta, 'utf8')) as T;
const SIN_MARCADOR_AUTOMATICO = new Set(['MUNICIPIO', 'CARGO', 'DIAGNOSTICO', 'HECHO_LLAMATIVO', 'MENOR', 'CITA_JURISPRUDENCIAL']);

interface Salida { doc: DocumentModel; out: RenderedOutput; tabla: MappingTable; salida: string; expected: string; segmentos: number; marcadores: number }

const CACHE = new Map<string, Salida>();
/** Documento del corpus → detecciones del gold (solo las que llevan marcador) → todo aceptado → tabla → salida → salida unida con LF. */
function salidaDeCorpus(id: string): Salida {
  const hecha = CACHE.get(id);
  if (hecha !== undefined) return hecha;
  const s = construirSalida(id);
  CACHE.set(id, s);
  return s;
}
function construirSalida(id: string): Salida {
  const gold = leer<GoldDoc>(join(RAIZ, 'corpus', 'gold', `${id}.json`));
  const texto = leer<TextoDoc>(join(RAIZ, 'corpus', 'gold', `${id}.texto.json`));
  const n = Number(id.slice(1));
  const docId = `doc_${n.toString(16).padStart(32, '0')}` as DocId;
  const parts: Part[] = texto.partes.map((p, i) => ({ id: `prt_${(n * 100 + i).toString(16).padStart(32, '0')}` as PartId, docId, kind: p.kind as PartKind,
    label: `${p.kind} ${p.index}`, order: i, index: p.index, ...(p.page !== undefined ? { page: p.page } : {}), text: p.texto, included: true }));
  const doc: DocumentModel = { id: docId, label: 'Documento 1', source: 'pegado', metadata: {} as DocumentModel['metadata'], warnings: [], parts };
  const clave = new Map(gold.entidades.map((e) => [e.id, e.canonico]));
  const cands: MergedCandidate[] = [];
  const ultimo = new Map<string, number>();
  const anns = gold.anotaciones.filter((a) => !a.es_negativo_esperado && !a.debe_generalizarse && !SIN_MARCADOR_AUTOMATICO.has(a.tipo))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  for (const a of anns) {
    const part = parts.find((p) => p.kind === a.parte.kind && p.index === a.parte.index && p.page === a.parte.page) as Part;
    expect(part.text.slice(a.start, a.end)).toBe(a.texto);
    if (a.start < (ultimo.get(part.id) ?? 0)) continue;
    ultimo.set(part.id, a.end);
    const c = { partId: part.id, start: a.start, end: a.end, type: a.tipo as DataType, ...(a.rol !== undefined ? { role: a.rol as Role } : {}),
      source: 'regla' as const, confidence: 'alta' as const, score: 1, canonicalKey: clave.get(a.entidad) as string };
    cands.push({ ...c, precedence: precedenceOf(c) });
  }
  const vacia = emptyTable('asu_00000000000000000000000000000001' as AsuntoId);
  const ids = seqIds();
  const ctx: ReviewContext = { table: tableIndexOf(vacia), caseList: [], doc, ids };
  let state = buildReviewState(doc, cands, { table: ctx.table, caseList: [], ids });
  for (const detId of state.order) {
    const r = applyReviewAction(state, { kind: 'aceptar', detectionId: detId }, ctx);
    if (!r.ok) throw new Error(r.code);
    state = r.state;
  }
  const cons = consolidate(vacia, state, doc, '2026-10-30T13:00:00.000Z');
  const out = render(doc, cons.state);
  const salida = joinOutput(out, '\n');

  // Texto esperado, segmento a segmento y sin pasar por findMarkers: lo que no se reemplazó queda idéntico; un reemplazo con
  // plantilla {m} queda con el display de su entrada; una edición queda igual.
  let segmentos = 0;
  const secciones = out.sections.map((s) => {
    let t = '';
    for (const seg of s.segments) {
      const tramo = s.text.slice(seg.outStart, seg.outEnd);
      const d = seg.detectionId === undefined ? undefined : cons.state.detections[seg.detectionId];
      const plantilla = d === undefined || d.status === 'editada' ? undefined : (d.replacement.generalized?.template ?? d.replacement.proposedTemplate);
      if (d !== undefined && plantilla?.includes('{m}') === true) {
        const marcador = cons.state.entities[d.entityId]?.marker as string;
        const display = cons.table.entries[marcador]?.display as string;
        // El tramo renderizado es la plantilla con el marcador y, si el tramo se llevó el punto que cierra la oración, ese punto
        // (render.ts, PB-4-r1). Un display que ya termina en el punto de su abreviatura no lo duplica ante un punto («S.A.», no «S.A..»).
        const trozos = tramo.split(marcador);
        t += trozos.map((x, i) => {
          if (i === trozos.length - 1) return x;
          const sigue = (trozos[i + 1] ?? '').charAt(0) || (i + 1 === trozos.length - 1 ? s.text.charAt(seg.outEnd) : '');
          return x + (display.endsWith('.') && sigue === '.' ? display.slice(0, -1) : display);
        }).join('');
      } else t += tramo;
      segmentos++;
    }
    return { ...s, text: t };
  });
  const expected = joinOutput({ ...out, sections: secciones }, '\n');
  return { doc, out, tabla: cons.table, salida, expected, segmentos, marcadores: Object.keys(cons.table.entries).length };
}

describe('T-RI-05 · ida y vuelta con identidad (corpus)', () => {
  it('T-RI-05 el corpus del repositorio tiene documentos con marcadores', () => {
    expect(IDS_CORPUS.length).toBeGreaterThanOrEqual(6);
    expect(IDS_CORPUS.reduce((n, id) => n + salidaDeCorpus(id).marcadores, 0)).toBeGreaterThan(100);
  });

  for (const id of IDS_CORPUS) {
    it(`T-RI-05 ${id}: joinOutput(salida) reinsertado devuelve el 100 % de los segmentos correctos`, () => {
      const s = salidaDeCorpus(id);
      const input: ReinsertionInput = { response: s.salida, table: s.tabla, expectedFrom: s.doc.id };
      const ms = findMarkersWith(input, seqIds());
      expect(s.segmentos > 0 || s.doc.parts.length === 0, 'un documento sin capa de texto (PDF escaneado) no tiene segmentos').toBe(true);
      expect(ms.filter((m) => m.kind !== 'exacto').map((m) => m.found), 'ninguna alerta en una respuesta idéntica').toEqual([]);
      const r = buildReinsertion(input, ms, {}, false);
      expect(r.text).toBe(s.expected);
      expect(r.alerts).toEqual({ unknown: [], altered: [], missing: [] });
      expect(r.ready).toBe(true);
      for (const m of ms) expect(s.salida.slice(m.start, m.end)).toBe(m.found);
    });
  }
});

describe('T-RI-06 · ida y vuelta con respuestas simuladas (transformar.ts)', () => {
  // Seis documentos repartidos por el corpus, solo con marcadores suficientes para que las siete variantes tengan material.
  const CON_MARCADORES = IDS_CORPUS.filter((id) => salidaDeCorpus(id).marcadores >= 6);
  const ELEGIDOS = CON_MARCADORES.filter((_, i) => i % Math.max(1, Math.floor(CON_MARCADORES.length / 6)) === 0).slice(0, 6);
  const de = salidaDeCorpus;

  it('T-RI-06 seis documentos del corpus', () => {
    expect(ELEGIDOS).toHaveLength(6);
  });

  for (const v of VARIANTES) {
    it(`T-RI-06 ${v}: la clasificación coincide con la que declara el transformador, marcador por marcador`, () => {
      for (const id of ELEGIDOS) {
        const s = de(id);
        const resp = transformar(s.salida, s.tabla, v);
        const input: ReinsertionInput = { response: resp.text, table: s.tabla, expectedFrom: s.doc.id };
        const ms = findMarkersWith(input, seqIds());
        expect(ms.map((m) => ({ found: m.found, kind: m.kind, alterations: m.alterations, canonical: m.canonical })), `${id} ${v}`)
          .toEqual(resp.esperado.map((e) => ({ found: e.found, kind: e.kind, alterations: e.alterations, canonical: e.canonical })));
        for (const m of ms) expect(resp.text.slice(m.start, m.end)).toBe(m.found);
        const r = buildReinsertion(input, ms, {}, false);
        expect(r.alerts.missing, `${id} ${v} faltantes`).toEqual(resp.omitidos);
        expect(r.alerts.unknown).toHaveLength(ms.filter((m) => m.kind === 'desconocido').length);
        expect(r.alerts.altered).toHaveLength(ms.filter((m) => m.kind === 'alterado').length);
      }
    });
  }

  it('T-RI-06 las variantes cubren las siete clases de alteración, los desconocidos y los faltantes', () => {
    const alts = new Set<string>();
    let desconocidos = 0;
    let omitidos = 0;
    for (const id of ELEGIDOS) {
      const s = de(id);
      for (const v of VARIANTES) {
        const resp = transformar(s.salida, s.tabla, v);
        for (const e of resp.esperado) { for (const a of e.alterations) alts.add(a); if (e.kind === 'desconocido') desconocidos++; }
        omitidos += resp.omitidos.length;
      }
    }
    expect([...alts].sort()).toEqual([...ALT].sort());
    expect(desconocidos).toBeGreaterThanOrEqual(18);
    expect(omitidos).toBeGreaterThan(0);
  });

  it('T-RI-06 V0 reinsertada deja el texto del corpus y V3 deja los omitidos sin reconocer hasta la casilla', () => {
    const s = de(ELEGIDOS[0] as string);
    const v0 = transformar(s.salida, s.tabla, 'V0');
    const i0: ReinsertionInput = { response: v0.text, table: s.tabla, expectedFrom: s.doc.id };
    expect(buildReinsertion(i0, findMarkersWith(i0, seqIds()), {}, false).text).toBe(s.expected);
    const v3 = transformar(s.salida, s.tabla, 'V3');
    const i3: ReinsertionInput = { response: v3.text, table: s.tabla, expectedFrom: s.doc.id };
    const m3 = findMarkersWith(i3, seqIds());
    expect(buildReinsertion(i3, m3, {}, false).ready).toBe(false);
    expect(buildReinsertion(i3, m3, {}, true).ready).toBe(true);
  });
});
