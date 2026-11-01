// T-MO-06 · Claves, agrupación, numeración, tabla por asunto y reductor (plan 6.4.4, 6.6, 7.12). Solo datos ficticios.
import { describe, expect, it } from 'vitest';
import { newCaseEntity, personasDeLaVariante, refreshVariants } from '../../src/core/caselist.ts';
import {
  applyReviewAction, buildReviewState, canonicalKeyFor, consolidate, cryptoIds, emptyTable, esAmbigua, esSiglaSilabica, marcaOtroTitular, nitCheckDigit,
  nitKey, orgKey, palabrasDeNombre, personKey, phoneKey, precedenceOf, tableIndexOf, type ReviewContext,
} from '../../src/core/entities.ts';
import { createDetectHandler } from '../../src/core/pipeline.ts';
import { incorporarModelo, modeloInicial } from '../../src/core/review/modelo.ts';
import { contarAmbiguas, decisionesAmbiguas } from '../../src/core/review/ambiguas.ts';
import { exportGate } from '../../src/core/review/puerta.ts';
import { render } from '../../src/core/render.ts';
import type {
  AsuntoId, CaseEntity, CaseEntityId, DataType, Detection, DetectionCandidate, DetectionSet, DocId, DocumentModel, Entity, Flag, FlagId, IdSource,
  MappingTable, MergedCandidate, NerSpan, PartId, PartKind, ResidueResult, ReviewAction, ReviewState, Role, SpanEdit, SpanEditId, Suggestion,
  SuggestionId, TableIndex,
} from '../../src/core/types.ts';

const MARKER_RE = /^\[(DEMANDANTE|DEMANDADO|TESTIGO|PACIENTE|CLIENTE|CONTACTO|PERSONA|EMPRESA|EPS|IPS|ENTIDAD|PROVEEDOR|CC|TI|CE|PPT|PEP|PASAPORTE|NIT|TP|DOCUMENTO|DIRECCIÓN|TELÉFONO|CORREO|RADICADO|HC|AFILIACIÓN|PLACA|MATRÍCULA|CUENTA|FECHA|VALOR|DEPARTAMENTO)_([1-9][0-9]{0,3})\]$/u;
const NOW = '2026-10-30T13:00:00.000Z';
const ASUNTO = 'asu_00000000000000000000000000000001' as AsuntoId;
const CAS_A = 'cas_0000000000000000000000000000000a' as CaseEntityId;
const CAS_F = 'cas_0000000000000000000000000000000f' as CaseEntityId;

/** IdSource determinista para las pruebas (6.1.4). */
function seqIds(start = 1): IdSource {
  let n = start;
  return { next: (p) => `${p}_${(n++).toString(16).padStart(32, '0')}` };
}
let docSeq = 0;
function mkDoc(parts: Array<[PartKind, string]>): DocumentModel {
  const d = ++docSeq;
  const id = `doc_${d.toString(16).padStart(32, '0')}` as DocId;
  return {
    id, label: `Documento ${d}`, source: 'pegado', metadata: {} as DocumentModel['metadata'], warnings: [],
    parts: parts.map(([kind, text], i) => ({ id: `prt_${(d * 100 + i).toString(16).padStart(32, '0')}` as PartId, docId: id, kind,
      label: kind, order: i, index: 1, text, included: true })),
  };
}
type Spec = Partial<MergedCandidate> & { type: DataType; canonicalKey: string };
/** Candidato fusionado sobre la aparición `occ` de `sub` en la parte `p`. */
function mc(doc: DocumentModel, p: number, sub: string, spec: Spec, occ = 0): MergedCandidate {
  const part = doc.parts[p];
  if (part === undefined) throw new Error('parte');
  let i = -1;
  for (let k = 0; k <= occ; k++) i = part.text.indexOf(sub, i + 1);
  if (i < 0) throw new Error(`falta «${sub}»`);
  const c = { partId: part.id, start: i, end: i + sub.length, source: 'regla' as const, confidence: 'media' as const, score: 0.6, ...spec };
  return { ...c, precedence: precedenceOf(c) };
}
const EMPTY: TableIndex = { byKey: {}, counters: {}, documentCount: 0 };
const CASES: CaseEntity[] = [
  { id: CAS_A, name: 'Ana Ficticia Rojas', variants: [], kind: 'persona', role: 'DEMANDANTE' },
  { id: CAS_F, name: 'Ferretería Ejemplo S.A.S.', variants: [], kind: 'organizacion', role: 'EMPRESA' },
];
function build(doc: DocumentModel, cands: MergedCandidate[], table: TableIndex = EMPTY, extra: { flags?: Flag[]; suggestions?: Suggestion[] } = {}) {
  return buildReviewState(doc, cands, { table, caseList: CASES, ids: seqIds(1000), ...extra });
}
const ctxOf = (doc: DocumentModel, table: TableIndex = EMPTY): ReviewContext => ({ table, caseList: CASES, doc, ids: seqIds(5000) });
const dets = (s: ReviewState): Detection[] => s.order.map((id) => s.detections[id] as Detection);
const entOf = (s: ReviewState, text: string): Entity => {
  const d = dets(s).find((x) => x.text === text);
  if (d === undefined) throw new Error(`sin detección «${text}»`);
  return s.entities[d.entityId] as Entity;
};
const markers = (s: ReviewState): Array<[string, string | undefined]> => dets(s).map((d) => [d.text, s.entities[d.entityId]?.marker]);
function act(s: ReviewState, a: ReviewAction, ctx: ReviewContext): ReviewState {
  const r = applyReviewAction(s, a, ctx);
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
/** INV-R05 sobre todo el estado. */
function assertR05(s: ReviewState): void {
  for (const d of Object.values(s.detections)) {
    expect(d.status === 'rechazada', d.text).toBe(d.rejectReason !== undefined);
    expect(d.status === 'editada', d.text).toBe(d.replacement.edited !== undefined);
  }
}

describe('T-MO-06 · claves canónicas (6.6.1, 7.12.1)', () => {
  it('NIT con y sin DV da la misma clave; NIT natural y jurídico (C-13)', () => {
    expect(nitKey('900.000.001-2')).toBe('NIT:900000001');
    expect(nitKey('9000000012')).toBe('NIT:900000001');
    expect(nitKey('900000001 2')).toBe('NIT:900000001');
    expect(canonicalKeyFor('NIT', '41.000.001-7')).toBe('NIT:41000001');
    expect(nitCheckDigit('81000001')).toBe(2);
    expect(nitKey('810000012', new Set(['81000001']))).toBe('NIT:81000001');
    expect(nitKey('810000012')).toBe('NIT:810000012');
  });

  it('C-12 organizaciones: sufijo societario fuera; EPS e IPS con igual núcleo son claves distintas', () => {
    for (const t of ['Ferretería Ejemplo S.A.S.', 'FERRETERIA EJEMPLO', 'Ferretería Ejemplo, Ltda.']) expect(orgKey(t), t).toBe('ORG:ferreteria ejemplo');
    for (const t of ['EPS Ejemplo S.A.', 'Ejemplo E.P.S.']) expect(orgKey(t), t).toBe('ORG:EPS:ejemplo');
    for (const t of ['Ejemplo IPS', 'I.P.S. Ejemplo Ltda.']) expect(orgKey(t), t).toBe('ORG:IPS:ejemplo');
  });

  it('teléfono (R-ENT-01), persona y demás tipos', () => {
    expect(phoneKey('+57 300 000 0001')).toBe('TEL:3000000001');
    expect(phoneKey('0057 3000000001')).toBe('TEL:3000000001');
    expect(phoneKey('57 601 000 0001')).toBe('TEL:6010000001');
    expect(phoneKey('5730000001')).toBe('TEL:5730000001');
    expect(phoneKey('000 0001')).toBe('TEL:0000001');
    expect(personKey('PEDRO  Ejemplo-Prueba')).toBe('PER:pedro ejemplo-prueba');
    expect(canonicalKeyFor('CC', '1.000.000.001')).toBe('CC:1000000001');
    expect(canonicalKeyFor('PLACA', 'xxx-000')).toBe('PLACA:XXX000');
    expect(canonicalKeyFor('CORREO', 'Ana.Ficticia@Ejemplo.test')).toBe('CORREO:ana.ficticia@ejemplo.test');
    expect(canonicalKeyFor('MATRICULA', '50C - 00000001')).toBe('MAT:50C-00000001');
    expect(canonicalKeyFor('VALOR', 'cuarenta millones')).toBe('VALOR:~cuarenta millones');
  });
});

describe('T-MO-06 · agrupación, mismo titular y numeración (7.12.7)', () => {
  it('C-1 cuatro menciones de la lista: una entidad [DEMANDANTE_1]', () => {
    const doc = mkDoc([['cuerpo', 'Ana Ficticia Rojas presentó tutela. ANA FICTICIA ROJAS, la señora Rojas, firmó como A. F. R.']]);
    const k = { type: 'PERSONA' as const, source: 'lista' as const, caseEntityId: CAS_A, canonicalKey: `LISTA:${CAS_A}` };
    const s = build(doc, [mc(doc, 0, 'Ana Ficticia Rojas', { ...k, variantClass: 'exacta' }), mc(doc, 0, 'ANA FICTICIA ROJAS', { ...k, variantClass: 'mayusculas' }),
      mc(doc, 0, 'Rojas', { ...k, variantClass: 'apellido_suelto' }, 1), mc(doc, 0, 'A. F. R.', { ...k, variantClass: 'iniciales' })]);
    expect(Object.keys(s.entities)).toHaveLength(1);
    const e = Object.values(s.entities)[0] as Entity;
    expect(e).toMatchObject({ marker: '[DEMANDANTE_1]', role: 'DEMANDANTE', family: 'DEMANDANTE', display: 'Ana Ficticia Rojas', caseEntityId: CAS_A });
    expect(e.mentions).toHaveLength(4);
  });

  it('C-2 y C-3 «$48.000.000» y «cuarenta y ocho millones de pesos» → un marcador; igual con las fechas', () => {
    const doc = mkDoc([['cuerpo', 'pagó $48.000.000, es decir cuarenta y ocho millones de pesos, el 14/03/2026 y el catorce (14) de marzo de dos mil veintiséis (2026)']]);
    const s = build(doc, [mc(doc, 0, '$48.000.000', { type: 'VALOR', canonicalKey: 'VALOR:48000000' }),
      mc(doc, 0, 'cuarenta y ocho millones de pesos', { type: 'VALOR', canonicalKey: 'VALOR:48000000' }),
      mc(doc, 0, '14/03/2026', { type: 'FECHA', canonicalKey: 'FECHA:2026-03-14' }),
      mc(doc, 0, 'catorce (14) de marzo de dos mil veintiséis (2026)', { type: 'FECHA', canonicalKey: 'FECHA:2026-03-14' })]);
    expect(markers(s).map((x) => x[1])).toEqual(['[VALOR_1]', '[VALOR_1]', '[FECHA_1]', '[FECHA_1]']);
    expect(Object.keys(s.entities)).toHaveLength(2);
  });

  it('C-4 CC, NIT natural y HC unidos por sameHolderAs; el NIT jurídico sin vínculo', () => {
    const doc = mkDoc([['cuerpo', 'CC 41.000.001, NIT 41.000.001-7 y la sociedad NIT 900.000.001-2'], ['nota_pie', 'HC 41000001']]);
    const s = build(doc, [mc(doc, 0, '41.000.001', { type: 'CC', canonicalKey: 'CC:41000001' }),
      mc(doc, 0, '41.000.001-7', { type: 'NIT', canonicalKey: 'NIT:41000001', holderDigits: '41000001' }),
      mc(doc, 0, '900.000.001-2', { type: 'NIT', canonicalKey: 'NIT:900000001' }), mc(doc, 1, '41000001', { type: 'HC', canonicalKey: 'HC:41000001' })]);
    expect(markers(s)).toEqual([['41.000.001', '[CC_1]'], ['41.000.001-7', '[NIT_1]'], ['900.000.001-2', '[NIT_2]'], ['41000001', '[HC_1]']]);
    const cc = entOf(s, '41.000.001'); const nit = entOf(s, '41.000.001-7'); const hc = entOf(s, '41000001');
    expect(cc.sameHolderAs).toEqual([nit.id, hc.id].sort());
    expect(nit.sameHolderAs).toEqual([cc.id, hc.id].sort());
    expect(entOf(s, '900.000.001-2').sameHolderAs).toEqual([]);
  });

  it('C-5, C-6 y C-7 teléfonos: orden de lectura, rechazo y herencia de la tabla del asunto', () => {
    const doc = mkDoc([['encabezado', 'Tel. 601 000 0001'], ['cuerpo', 'celulares 300 000 0001 y 310 000 0002']]);
    const cands = [mc(doc, 0, '601 000 0001', { type: 'TELEFONO', canonicalKey: 'TEL:6010000001' }),
      mc(doc, 1, '300 000 0001', { type: 'TELEFONO', canonicalKey: 'TEL:3000000001' }), mc(doc, 1, '310 000 0002', { type: 'TELEFONO', canonicalKey: 'TEL:3100000002' })];
    const s5 = build(doc, cands);
    expect(markers(s5).map((x) => x[1])).toEqual(['[TELÉFONO_1]', '[TELÉFONO_2]', '[TELÉFONO_3]']);
    const header = dets(s5)[0] as Detection;
    const s6 = act(s5, { kind: 'rechazar', detectionId: header.id }, ctxOf(doc));
    expect(markers(s6).map((x) => x[1])).toEqual([undefined, '[TELÉFONO_1]', '[TELÉFONO_2]']);
    const table: TableIndex = { byKey: { 'TEL:3100000002': '[TELÉFONO_1]' }, counters: { TELEFONO: 1 }, documentCount: 1 };
    const s7 = act(build(doc, cands, table), { kind: 'rechazar', detectionId: (dets(build(doc, cands, table))[0] as Detection).id }, ctxOf(doc, table));
    expect(markers(s7).map((x) => x[1])).toEqual([undefined, '[TELÉFONO_2]', '[TELÉFONO_1]']);
    expect(entOf(s7, '310 000 0002').markerState).toBe('heredado');
  });

  it('C-8 y C-9 persona de la lista, empresa de la lista y empresa del modelo; la persona editada pierde su número', () => {
    const doc = mkDoc([['cuerpo', 'Ana Ficticia Rojas demandó a Ferretería Ejemplo S.A.S. y a Comercial Prueba']]);
    const s8 = build(doc, [mc(doc, 0, 'Ana Ficticia Rojas', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, canonicalKey: `LISTA:${CAS_A}` }),
      mc(doc, 0, 'Ferretería Ejemplo S.A.S.', { type: 'EMPRESA', source: 'lista', caseEntityId: CAS_F, canonicalKey: `LISTA:${CAS_F}` }),
      mc(doc, 0, 'Comercial Prueba', { type: 'EMPRESA', source: 'modelo', nerLabel: 'ORG', canonicalKey: 'ORG:comercial prueba' })]);
    expect(markers(s8).map((x) => x[1])).toEqual(['[DEMANDANTE_1]', '[EMPRESA_1]', '[EMPRESA_2]']);
    const s9 = act(s8, { kind: 'editar', detectionId: (dets(s8)[0] as Detection).id, text: 'la demandante' }, ctxOf(doc));
    expect(markers(s9).map((x) => x[1])).toEqual([undefined, '[EMPRESA_1]', '[EMPRESA_2]']);
  });

  it('C-10 y C-11 correferencia de personas del modelo', () => {
    const per = (doc: DocumentModel, t: string) => mc(doc, 0, t, { type: 'PERSONA', source: 'modelo', nerLabel: 'PER', canonicalKey: personKey(t) });
    let doc = mkDoc([['cuerpo', 'Pedro Ejemplo Prueba declaró. Después Ejemplo firmó.']]);
    let s = build(doc, [per(doc, 'Pedro Ejemplo Prueba'), mc(doc, 0, 'Ejemplo', { type: 'PERSONA', source: 'modelo', nerLabel: 'PER', canonicalKey: 'PER:ejemplo' }, 1)]);
    expect(Object.keys(s.entities)).toHaveLength(1);
    expect((Object.values(s.entities)[0] as Entity).mentions).toHaveLength(2);
    expect((dets(s)[1] as Detection).confidence).toBe('baja');
    doc = mkDoc([['cuerpo', 'Pedro Ejemplo Prueba declaró. Después Ejemplo firmó con Luisa Ejemplo.']]);
    s = build(doc, [per(doc, 'Pedro Ejemplo Prueba'), mc(doc, 0, 'Ejemplo', { type: 'PERSONA', source: 'modelo', canonicalKey: 'PER:ejemplo' }, 1), per(doc, 'Luisa Ejemplo')]);
    expect(Object.keys(s.entities)).toHaveLength(3);
  });

  it('C-12 una EPS y una IPS con el mismo núcleo: [EPS_1] e [IPS_1]', () => {
    const doc = mkDoc([['cuerpo', 'Ejemplo EPS remitió a Ejemplo IPS']]);
    const s = build(doc, [mc(doc, 0, 'Ejemplo EPS', { type: 'EPS', source: 'modelo', canonicalKey: orgKey('Ejemplo EPS') }),
      mc(doc, 0, 'Ejemplo IPS', { type: 'IPS', source: 'modelo', canonicalKey: orgKey('Ejemplo IPS') })]);
    expect(markers(s).map((x) => x[1])).toEqual(['[EPS_1]', '[IPS_1]']);
  });

  it('C-14 DOCUMENTO y CC con los mismos dígitos: entidades distintas unidas por titular; radicado corto al completo', () => {
    const doc = mkDoc([['cuerpo', 'registro civil 41000001, CC 41000001; proceso 90001310399920260012300, Rad. 2026-00123-00']]);
    const s = build(doc, [mc(doc, 0, '41000001', { type: 'DOCUMENTO', canonicalKey: 'DOCUMENTO:41000001' }),
      mc(doc, 0, '41000001', { type: 'CC', canonicalKey: 'CC:41000001' }, 1),
      mc(doc, 0, '90001310399920260012300', { type: 'RADICADO', canonicalKey: 'RAD:90001310399920260012300' }),
      mc(doc, 0, '2026-00123-00', { type: 'RADICADO', canonicalKey: 'RAD:20260012300' })]);
    expect(markers(s).map((x) => x[1])).toEqual(['[DOCUMENTO_1]', '[CC_1]', '[RADICADO_1]', '[RADICADO_1]']);
    expect(entOf(s, '90001310399920260012300').mentions).toHaveLength(2);
    expect(dets(s)[0]?.entityId).not.toBe(dets(s)[1]?.entityId);
    expect((s.entities[(dets(s)[0] as Detection).entityId] as Entity).sameHolderAs).toEqual([(dets(s)[1] as Detection).entityId]);
  });

  it('los MUNICIPIO no son detecciones: los convierte en sugerencia generalize.ts', () => {
    const doc = mkDoc([['cuerpo', 'vive en Villa Ejemplo']]);
    expect(dets(build(doc, [mc(doc, 0, 'Villa Ejemplo', { type: 'MUNICIPIO', canonicalKey: 'DEP:90' })]))).toEqual([]);
  });
});

describe('T-MO-06 · tabla del asunto y consolidación (6.6.3, 6.6.4)', () => {
  function twoDocuments() {
    const d1 = mkDoc([['cuerpo', 'Ana Ficticia Rojas, CC 41.000.001, celular 300 000 0001, NIT 41.000.001-7']]);
    const c1 = [mc(d1, 0, 'Ana Ficticia Rojas', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, canonicalKey: `LISTA:${CAS_A}` }),
      mc(d1, 0, '41.000.001', { type: 'CC', canonicalKey: 'CC:41000001' }), mc(d1, 0, '300 000 0001', { type: 'TELEFONO', canonicalKey: 'TEL:3000000001' }),
      mc(d1, 0, '41.000.001-7', { type: 'NIT', canonicalKey: 'NIT:41000001', holderDigits: '41000001' })];
    let table: MappingTable = emptyTable(ASUNTO);
    const s1 = build(d1, c1, tableIndexOf(table));
    ({ table } = consolidate(table, s1, d1, NOW));
    const d2 = mkDoc([['cuerpo', 'ANA FICTICIA ROJAS con celular 300-000-0001 y 310 000 0002']]);
    const c2 = [mc(d2, 0, 'ANA FICTICIA ROJAS', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, canonicalKey: `LISTA:${CAS_A}` }),
      mc(d2, 0, '300-000-0001', { type: 'TELEFONO', canonicalKey: 'TEL:3000000001' }), mc(d2, 0, '310 000 0002', { type: 'TELEFONO', canonicalKey: 'TEL:3100000002' })];
    const s2 = build(d2, c2, tableIndexOf(table));
    const r2 = consolidate(table, s2, d2, NOW);
    return { s1, s2, table1: table, table2: r2.table, s2c: r2.state, d2 };
  }

  it('INV-T01 INV-T04 INV-G07 dos documentos del mismo asunto reutilizan marcadores y una entidad nueva continúa la numeración', () => {
    const { s2, table1, table2 } = twoDocuments();
    expect(markers(s2)).toEqual([['ANA FICTICIA ROJAS', '[DEMANDANTE_1]'], ['300-000-0001', '[TELÉFONO_1]'], ['310 000 0002', '[TELÉFONO_2]']]);
    expect(entOf(s2, '300-000-0001').markerState).toBe('heredado');
    for (const [m, e] of Object.entries(table1.entries)) expect(table2.entries[m]?.canonicalKey).toBe(e.canonicalKey);
    const keys = Object.values(table2.entries).map((e) => e.canonicalKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('INV-T02 INV-T03 counters ≥ mayor n y cada clave de entries es su marcador válido', () => {
    const { table2 } = twoDocuments();
    for (const [k, e] of Object.entries(table2.entries)) {
      expect(k).toBe(e.marker);
      expect(MARKER_RE.test(k), k).toBe(true);
      expect(table2.counters[e.family] ?? 0).toBeGreaterThanOrEqual(Number(MARKER_RE.exec(k)?.[2]));
    }
    expect(table2.counters).toMatchObject({ DEMANDANTE: 1, CC: 1, TELEFONO: 2, NIT: 1 });
    expect(table2.documents).toHaveLength(2);
  });

  it('INV-T05 sameHolderAs simétrico y solo entre familias de identificación', () => {
    const { table2 } = twoDocuments();
    const ID = new Set(['CC', 'TI', 'CE', 'PPT', 'PEP', 'DOCUMENTO', 'HC', 'AFILIACION', 'NIT']);
    for (const e of Object.values(table2.entries)) for (const o of e.sameHolderAs) {
      expect(table2.entries[o]?.sameHolderAs).toContain(e.marker);
      expect(ID.has(e.type) && ID.has(table2.entries[o]?.type ?? '')).toBe(true);
    }
    expect(table2.entries['[CC_1]']?.sameHolderAs).toEqual(['[NIT_1]']);
  });

  it('INV-T06 originals sin duplicados y en orden de aparición; documents sin repetir', () => {
    const { table2, s2c, d2 } = twoDocuments();
    expect(table2.entries['[TELÉFONO_1]']?.originals).toEqual(['300 000 0001', '300-000-0001']);
    expect(table2.entries['[DEMANDANTE_1]']?.originals).toEqual(['Ana Ficticia Rojas', 'ANA FICTICIA ROJAS']);
    const again = consolidate(table2, s2c, d2, NOW).table;
    expect(again.entries['[TELÉFONO_1]']?.originals).toEqual(['300 000 0001', '300-000-0001']);
    expect(again.documents).toHaveLength(2);
    expect(s2c.committed).toBe(true);
    expect(Object.values(s2c.entities).every((e) => e.markerState === 'definitivo' || e.markerState === 'heredado')).toBe(true);
  });

  it('INV-T04 INV-G07 una clave de la tabla no cambia de marcador: cambiar_rol da ROL_FIJADO_EN_ASUNTO', () => {
    const { s2, table1, d2 } = twoDocuments();
    const r = applyReviewAction(s2, { kind: 'cambiar_rol', entityId: entOf(s2, 'ANA FICTICIA ROJAS').id, role: 'TESTIGO' }, ctxOf(d2, tableIndexOf(table1)));
    expect(r).toEqual({ ok: false, code: 'ROL_FIJADO_EN_ASUNTO' });
  });
});

describe('T-MO-06 · reductor applyReviewAction (6.4.4, 7.12.6)', () => {
  const base = () => {
    const doc = mkDoc([['cuerpo', 'Ana Ficticia Rojas, CC 1000000017, vive en Villa Ejemplo; Pedro Ejemplo la visitó el 14/03/2026. Pedro Ejemplo volvió.']]);
    const s = build(doc, [mc(doc, 0, 'Ana Ficticia Rojas', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, canonicalKey: `LISTA:${CAS_A}` }),
      mc(doc, 0, '1000000017', { type: 'CC', canonicalKey: 'CC:1000000017' }),
      mc(doc, 0, 'Pedro Ejemplo', { type: 'PERSONA', source: 'modelo', nerLabel: 'PER', canonicalKey: 'PER:pedro ejemplo' }),
      mc(doc, 0, '14/03/2026', { type: 'FECHA', canonicalKey: 'FECHA:2026-03-14' })]);
    return { doc, s, ctx: ctxOf(doc) };
  };

  it('INV-R05 INV-R08 cada acción exitosa suma 1 a revision; una rechazada no lo cambia ni toca el estado', () => {
    const { s, ctx } = base();
    const [ana, cc] = dets(s) as [Detection, Detection];
    const steps: ReviewAction[] = [
      { kind: 'rechazar', detectionId: cc.id, reason: 'DATO_PUBLICO' }, { kind: 'editar', detectionId: cc.id, text: 'cédula reservada' },
      { kind: 'aceptar', detectionId: cc.id }, { kind: 'restablecer', detectionId: cc.id }, { kind: 'rechazar', detectionId: ana.id },
      { kind: 'aceptar_entidad', entityId: ana.entityId },
    ];
    let cur = s;
    for (const a of steps) {
      const before = JSON.stringify(cur);
      const r = applyReviewAction(cur, a, ctx);
      expect(JSON.stringify(cur)).toBe(before);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.state.revision).toBe(cur.revision + 1);
      assertR05(r.state);
      cur = r.state;
    }
    const bad = applyReviewAction(cur, { kind: 'aceptar', detectionId: 'det_ffffffffffffffffffffffffffffffff' as Detection['id'] }, ctx);
    expect(bad).toEqual({ ok: false, code: 'NO_ENCONTRADO' });
    expect(cur.detections[ana.id]?.status).toBe('rechazada');   // aceptar_entidad solo toca las pendientes
    expect(cur.detections[cc.id]).toMatchObject({ status: 'pendiente' });
  });

  it('INV-R05 una edición idéntica al texto final propuesto deja la detección aceptada', () => {
    const { s, ctx } = base();
    const cc = dets(s)[1] as Detection;
    const out = act(s, { kind: 'editar', detectionId: cc.id, text: '[CC_1]' }, ctx);
    expect(out.detections[cc.id]).toMatchObject({ status: 'aceptada' });
    expect(out.detections[cc.id]?.replacement.edited).toBeUndefined();
  });

  it('INV-G05 dos documentos idénticos reciben ids distintos', () => {
    const mk = () => { const doc = mkDoc([['cuerpo', 'CC 1000000017']]); return { doc, c: [mc(doc, 0, '1000000017', { type: 'CC', canonicalKey: 'CC:1000000017' })] }; };
    const a = mk(); const b = mk();
    const sa = buildReviewState(a.doc, a.c, { table: EMPTY, caseList: [], ids: cryptoIds });
    const sb = buildReviewState(b.doc, b.c, { table: EMPTY, caseList: [], ids: cryptoIds });
    expect(sa.order[0]).not.toBe(sb.order[0]);
    expect(Object.keys(sa.entities)[0]).not.toBe(Object.keys(sb.entities)[0]);
    expect(sa.order[0]).toMatch(/^det_[0-9a-f]{32}$/u);
  });

  it('cambiar_rol y cambiar_tipo: familia nueva, ROL_INCOMPATIBLE y TIPO_NO_PERMITIDO', () => {
    const { s, ctx } = base();
    const [ana, cc, pedro] = dets(s) as [Detection, Detection, Detection];
    expect(applyReviewAction(s, { kind: 'cambiar_rol', entityId: ana.entityId, role: 'EPS' }, ctx)).toEqual({ ok: false, code: 'ROL_INCOMPATIBLE' });
    expect(applyReviewAction(s, { kind: 'cambiar_rol', entityId: cc.entityId, role: 'TESTIGO' }, ctx)).toEqual({ ok: false, code: 'ROL_INCOMPATIBLE' });
    const r = act(s, { kind: 'cambiar_rol', entityId: pedro.entityId, role: 'TESTIGO' }, ctx);
    expect(r.entities[pedro.entityId]).toMatchObject({ family: 'TESTIGO', marker: '[TESTIGO_1]' });
    expect(applyReviewAction(s, { kind: 'cambiar_tipo', detectionId: cc.id, type: 'MENOR' as never }, ctx)).toEqual({ ok: false, code: 'TIPO_NO_PERMITIDO' });
    const t = act(s, { kind: 'cambiar_tipo', detectionId: cc.id, type: 'TELEFONO' }, ctx);
    expect(t.detections[cc.id]).toMatchObject({ type: 'TELEFONO', canonicalKey: 'TEL:1000000017' });
    expect(t.entities[cc.entityId]).toBeUndefined();
    expect(t.entities[t.detections[cc.id]?.entityId as Entity['id']]?.marker).toBe('[TELÉFONO_1]');
  });

  it('unir_entidades y separar_mencion', () => {
    const { s, ctx } = base();
    const [ana, cc, pedro] = dets(s) as [Detection, Detection, Detection];
    expect(applyReviewAction(s, { kind: 'unir_entidades', fromId: cc.entityId, intoId: ana.entityId }, ctx)).toEqual({ ok: false, code: 'TIPO_NO_PERMITIDO' });
    const u = act(s, { kind: 'unir_entidades', fromId: pedro.entityId, intoId: ana.entityId }, ctx);
    expect(u.entities[ana.entityId]?.mentions).toHaveLength(2);
    expect(u.entities[pedro.entityId]).toBeUndefined();
    const sep = act(u, { kind: 'separar_mencion', detectionId: pedro.id }, ctx);
    expect(sep.entities[sep.detections[pedro.id]?.entityId as Entity['id']]).toMatchObject({ canonicalKey: 'PER:pedro ejemplo', role: 'OTRA_PERSONA' });
    expect(applyReviewAction(s, { kind: 'separar_mencion', detectionId: cc.id }, ctx)).toEqual({ ok: false, code: 'TIPO_NO_PERMITIDO' });
    const fixed: TableIndex = { byKey: { 'PER:pedro ejemplo': '[PERSONA_1]' }, counters: { PERSONA: 1 }, documentCount: 1 };
    const inv = act(s, { kind: 'unir_entidades', fromId: pedro.entityId, intoId: ana.entityId }, { ...ctx, table: fixed });
    expect(inv.entities[pedro.entityId]?.mentions).toHaveLength(2);   // se invierte para conservar el marcador fijado
    const both: TableIndex = { ...fixed, byKey: { ...fixed.byKey, [`LISTA:${CAS_A}`]: '[DEMANDANTE_1]' } };
    expect(applyReviewAction(s, { kind: 'unir_entidades', fromId: pedro.entityId, intoId: ana.entityId }, { ...ctx, table: both }))
      .toEqual({ ok: false, code: 'ROL_FIJADO_EN_ASUNTO' });
  });

  it('agregar_manual: tramo inválido, solapamiento parcial, sustitución y propagación', () => {
    const { s, doc, ctx } = base();
    const text = (doc.parts[0] as DocumentModel['parts'][number]).text;
    const partId = (doc.parts[0] as DocumentModel['parts'][number]).id;
    const at = (sub: string, occ = 0) => { let i = -1; for (let k = 0; k <= occ; k++) i = text.indexOf(sub, i + 1); return { partId, start: i, end: i + sub.length }; };
    expect(applyReviewAction(s, { kind: 'agregar_manual', span: { partId, start: 0, end: 9999 }, type: 'PERSONA', propagate: false }, ctx))
      .toEqual({ ok: false, code: 'TRAMO_INVALIDO' });
    expect(applyReviewAction(s, { kind: 'agregar_manual', span: at('Rojas, CC'), type: 'PERSONA', propagate: false }, ctx))
      .toEqual({ ok: false, code: 'SOLAPAMIENTO_PARCIAL' });
    const m = act(s, { kind: 'agregar_manual', span: at('Villa Ejemplo'), type: 'BARRIO', propagate: false }, ctx);
    const man = dets(m).find((d) => d.text === 'Villa Ejemplo');
    expect(man).toMatchObject({ source: 'manual', precedence: 1, confidence: 'alta', score: 1, status: 'aceptada', canonicalKey: 'BARRIO:villa ejemplo' });
    const p = act(s, { kind: 'agregar_manual', span: at('Pedro Ejemplo'), type: 'PERSONA', role: 'TESTIGO', propagate: true }, ctx);
    const pedros = dets(p).filter((d) => d.text === 'Pedro Ejemplo');
    expect(pedros.map((d) => [d.source, d.status])).toEqual([['manual', 'aceptada'], ['manual', 'pendiente']]);
    expect(new Set(pedros.map((d) => d.entityId)).size).toBe(1);
  });

  it('aplicar_sugerencia: municipio homónimo, elegir departamento, aplicar, restablecer y descartar', () => {
    const { s, doc, ctx } = base();
    const partId = (doc.parts[0] as DocumentModel['parts'][number]).id;
    const t = (doc.parts[0] as DocumentModel['parts'][number]).text;
    const i = t.indexOf('Villa Ejemplo');
    const mun: Suggestion = { id: 'sug_000000000000000000000000000000a1' as SuggestionId, kind: 'MUNICIPIO_A_DEPARTAMENTO',
      target: { kind: 'tramo', span: { partId, start: i, end: i + 13 } }, originalText: 'Villa Ejemplo',
      options: [{ id: 'o1', kind: 'MUNICIPIO_A_DEPARTAMENTO', template: 'un municipio de {m}' }], placeOptions: ['90', '91'], status: 'pendiente' };
    const fecha = dets(s)[3] as Detection;
    const hecho: Suggestion = { id: 'sug_000000000000000000000000000000a2' as SuggestionId, kind: 'FECHA_A_MES_ANIO',
      target: { kind: 'deteccion', detectionId: fecha.id }, originalText: '14/03/2026', options: [{ id: 'o1', kind: 'FECHA_A_MES_ANIO', template: 'marzo de 2026' }], status: 'pendiente' };
    const s0: ReviewState = { ...s, suggestions: { [mun.id]: mun, [hecho.id]: hecho } };
    expect(applyReviewAction(s0, { kind: 'aplicar_sugerencia', suggestionId: mun.id, optionId: 'o1' }, ctx)).toEqual({ ok: false, code: 'DEPARTAMENTO_SIN_ELEGIR' });
    expect(applyReviewAction(s0, { kind: 'elegir_departamento', suggestionId: mun.id, depCode: '25' }, ctx)).toEqual({ ok: false, code: 'NO_ENCONTRADO' });
    const s1 = act(s0, { kind: 'elegir_departamento', suggestionId: mun.id, depCode: '91' }, ctx);
    const s2 = act(s1, { kind: 'aplicar_sugerencia', suggestionId: mun.id, optionId: 'o1' }, ctx);
    const dep = dets(s2).find((d) => d.text === 'Villa Ejemplo') as Detection;
    expect(dep).toMatchObject({ type: 'MUNICIPIO', canonicalKey: 'DEP:91', status: 'aceptada', suggestionId: mun.id });
    expect(s2.entities[dep.entityId]).toMatchObject({ type: 'DEPARTAMENTO', marker: '[DEPARTAMENTO_1]' });
    const s3 = act(s2, { kind: 'restablecer', detectionId: dep.id }, ctx);
    expect(s3.detections[dep.id]).toBeUndefined();
    expect(s3.suggestions[mun.id]?.status).toBe('pendiente');
    const g = act(s0, { kind: 'aplicar_sugerencia', suggestionId: hecho.id, optionId: 'o1' }, ctx);
    expect(g.detections[fecha.id]?.replacement.generalized).toEqual({ suggestionId: hecho.id, optionId: 'o1', template: 'marzo de 2026' });
    const d = act(g, { kind: 'descartar_sugerencia', suggestionId: hecho.id }, ctx);
    expect(d.detections[fecha.id]?.replacement.generalized).toBeUndefined();
    expect(d.suggestions[hecho.id]?.status).toBe('descartada');
  });

  it('resolver_bandera de cita jurisprudencial y de cargo', () => {
    const { s, doc, ctx } = base();
    const cc = dets(s)[1] as Detection;
    const partId = (doc.parts[0] as DocumentModel['parts'][number]).id;
    const cita: Flag = { id: 'flg_000000000000000000000000000000c1' as FlagId, type: 'CITA_JURISPRUDENCIAL', span: { partId, start: cc.start, end: cc.end },
      text: cc.text, reason: 'RADICADO_EN_CITA', detectionId: cc.id, options: [], acknowledged: false };
    const cargo: Flag = { id: 'flg_000000000000000000000000000000c2' as FlagId, type: 'CARGO', span: { partId, start: 0, end: 0 }, text: '',
      reason: 'LISTA_CARGOS', options: [{ id: 'o1', kind: 'CARGO_A_GENERICO', template: 'una directiva' }], acknowledged: false };
    const t = (doc.parts[0] as DocumentModel['parts'][number]).text; const k = t.indexOf('vive');
    cargo.span = { partId, start: k, end: k + 4 }; cargo.text = 'vive';
    const s0: ReviewState = { ...s, flags: { [cita.id]: cita, [cargo.id]: cargo } };
    const m = act(s0, { kind: 'resolver_bandera', flagId: cita.id, resolution: 'mantener' }, ctx);
    expect(m.detections[cc.id]).toMatchObject({ status: 'rechazada', rejectReason: 'CITA_JURISPRUDENCIAL' });
    expect(act(s0, { kind: 'resolver_bandera', flagId: cita.id, resolution: 'reemplazar' }, ctx).detections[cc.id]?.status).toBe('aceptada');
    const r = act(s0, { kind: 'resolver_bandera', flagId: cargo.id, resolution: 'reemplazar', optionId: 'o1' }, ctx);
    expect(r.flags[cargo.id]).toMatchObject({ acknowledged: true, resolution: 'reemplazar' });
    expect(Object.values(r.spanEdits)).toMatchObject([{ text: 'una directiva', originalText: 'vive', origin: { kind: 'bandera', flagId: cargo.id } }]);
  });

  it('incorporar_residuos: revisión desactualizada y candidatos nuevos sin tocar los existentes', () => {
    const { s, doc, ctx } = base();
    const partId = (doc.parts[0] as DocumentModel['parts'][number]).id;
    const t = (doc.parts[0] as DocumentModel['parts'][number]).text;
    const k = t.indexOf('Villa Ejemplo');
    const cand = { partId, start: k, end: k + 13, type: 'BARRIO' as const, source: 'regla' as const, confidence: 'baja' as const, score: 0.3, canonicalKey: 'BARRIO:villa ejemplo' };
    const over = { ...cand, start: 0, end: 5, type: 'PERSONA' as const, canonicalKey: 'PER:ana' };
    expect(applyReviewAction(s, { kind: 'incorporar_residuos', residueRevision: s.revision + 1, candidates: [cand] }, ctx)).toEqual({ ok: false, code: 'TRAMO_INVALIDO' });
    const r = act(s, { kind: 'incorporar_residuos', residueRevision: s.revision, candidates: [cand, over] }, ctx);
    expect(dets(r).map((d) => [d.text, d.status])).toEqual([...dets(s).map((d) => [d.text, d.status]).slice(0, 2), ['Villa Ejemplo', 'pendiente'], ...dets(s).map((d) => [d.text, d.status]).slice(2)]);
    for (const d of dets(s)) expect(r.detections[d.id]).toEqual(d);
  });

  it('incorporar_modelo y declarar_plan_b: rechazadas y solapes fuera, ventana repetida ignorada, terminado y plan B', () => {
    const { s, doc, ctx } = base();
    const [ana, , pedro] = dets(s) as [Detection, Detection, Detection];
    const s0 = act(s, { kind: 'rechazar', detectionId: pedro.id }, ctx);
    const t = (doc.parts[0] as DocumentModel['parts'][number]).text;
    const mk = (sub: string, id: string, occ = 0): Detection => {
      let i = -1; for (let k = 0; k <= occ; k++) i = t.indexOf(sub, i + 1);
      return { ...pedro, id: `det_${id.padStart(32, '0')}` as Detection['id'], start: i, end: i + sub.length, text: sub, status: 'aceptada',
        entityId: `ent_${id.padStart(32, '0')}` as Entity['id'], canonicalKey: personKey(sub) };
    };
    const repeat = mk('Pedro Ejemplo', 'b1'); const overlap = mk('Ficticia', 'b2'); const fresh = mk('Pedro Ejemplo', 'b3', 1);
    const ent = (d: Detection): Entity => ({ id: d.entityId, canonicalKey: d.canonicalKey, type: 'PERSONA', role: 'OTRA_PERSONA', family: 'PERSONA',
      marcadorEspecifico: false, mentions: [d.id], sameHolderAs: [], display: d.text });
    const delta = { detections: [repeat, overlap, fresh], entities: [ent(repeat), ent(overlap), ent(fresh)], flags: [], suggestions: [] };
    const w1 = act(s0, { kind: 'incorporar_modelo', ventana: 1, ventanasTotales: 2, delta }, ctx);
    expect(w1.detections[repeat.id]).toBeUndefined();
    expect(w1.detections[overlap.id]).toBeUndefined();
    expect(w1.detections[fresh.id]).toMatchObject({ status: 'pendiente', entityId: pedro.entityId });
    expect(w1.detections[ana.id]).toEqual(s0.detections[ana.id]);
    expect(w1.modelo).toEqual({ kind: 'en_curso', ventanas: 1, ventanasTotales: 2 });
    const again = applyReviewAction(w1, { kind: 'incorporar_modelo', ventana: 1, ventanasTotales: 2, delta }, ctx);
    expect(again).toEqual({ ok: true, state: w1 });
    const w2 = act(w1, { kind: 'incorporar_modelo', ventana: 2, ventanasTotales: 2, delta: { detections: [], entities: [], flags: [], suggestions: [] } }, ctx);
    expect(w2.modelo).toEqual({ kind: 'terminado', ventanas: 2, respaldo: false });
    expect(applyReviewAction(w2, { kind: 'declarar_plan_b', causa: 'cancelado' }, ctx)).toEqual({ ok: false, code: 'TIPO_NO_PERMITIDO' });
    const b = act(w1, { kind: 'declarar_plan_b', causa: 'cancelado' }, ctx);
    expect(b.modelo).toEqual({ kind: 'plan_b', causa: 'cancelado' });
    expect(applyReviewAction(b, { kind: 'incorporar_modelo', ventana: 2, ventanasTotales: 2, delta }, ctx)).toEqual({ ok: true, state: b });
  });
});

describe('T-MO-06 · correferencia de PB-3-r1: mismo dato, mismo marcador (6.6.1, 7.12.2.4, S-7.11)', () => {
  const CAS_M = 'cas_000000000000000000000000000000b1' as CaseEntityId;
  const CAS_S = 'cas_000000000000000000000000000000b2' as CaseEntityId;
  const CAS_X = 'cas_000000000000000000000000000000b3' as CaseEntityId;
  const persona = (id: CaseEntityId, name: string): CaseEntity => ({ id, name, variants: [], kind: 'persona', role: 'DEMANDANTE' });
  const empresa = (id: CaseEntityId, name: string): CaseEntity => ({ id, name, variants: [], kind: 'organizacion', role: 'EMPRESA' });
  const per = (doc: DocumentModel, t: string, occ = 0) => mc(doc, 0, t, { type: 'PERSONA', source: 'modelo', nerLabel: 'PER', canonicalKey: personKey(t) }, occ);
  const org = (doc: DocumentModel, t: string, occ = 0) => mc(doc, 0, t, { type: 'EMPRESA', source: 'modelo', nerLabel: 'ORG', canonicalKey: orgKey(t) }, occ);
  const loc = (doc: DocumentModel, t: string, occ = 0) => mc(doc, 0, t, { type: 'LUGAR', source: 'modelo', nerLabel: 'LOC', canonicalKey: `LUGAR:${t.toLowerCase()}` }, occ);
  const lst = (doc: DocumentModel, t: string, id: CaseEntityId, variantClass: Detection['variantClass'], occ = 0, extra: Partial<MergedCandidate> = {}) =>
    mc(doc, 0, t, { type: 'PERSONA', source: 'lista', caseEntityId: id, variantClass, canonicalKey: `LISTA:${id}`, ...extra }, occ);
  const con = (doc: DocumentModel, cands: MergedCandidate[], caseList: readonly CaseEntity[] = []) =>
    buildReviewState(doc, cands, { table: EMPTY, caseList, ids: seqIds(1000) });
  /** Textos de cada entidad, en orden de lectura. */
  const grupos = (s: ReviewState): string[][] => {
    const out = new Map<string, string[]>();
    for (const d of dets(s)) out.set(d.entityId, [...(out.get(d.entityId) ?? []), d.text]);
    return [...out.values()];
  };

  it('palabrasDeNombre: vista lista, sin función ni tratamiento; en texto mixto solo las que empiezan con mayúscula', () => {
    expect(palabrasDeNombre('Camilo primero')).toEqual(['camilo']);
    expect(palabrasDeNombre('nicolás ficticio gómez')).toEqual(['nicolas', 'ficticio', 'gomez']);
    expect(palabrasDeNombre('Dra. Ana de la Prueba')).toEqual(['ana', 'prueba']);
    expect(palabrasDeNombre('Ejemplo-Acosta Ortiz')).toEqual(['ejemplo', 'acosta', 'ortiz']);
    expect(palabrasDeNombre('CATALINA PRUEBA DEL VALLE')).toEqual(['catalina', 'prueba', 'valle']);
    const t0 = performance.now();
    expect(palabrasDeNombre(`Ana${' '.repeat(40_000)}Prueba`)).toEqual(['ana', 'prueba']);
    expect(performance.now() - t0).toBeLessThan(300);
  });

  it('C1 nombre de la lista incompleto (F44): la PER del modelo que contiene, en orden, el nombre de una sola persona de la lista es esa persona', () => {
    let doc = mkDoc([['cuerpo', 'Martha Cecilia Ejemplo-Acosta Ortiz presentó tutela. Ejemplo-Acosta Ortiz insiste. Ejemplo-Acosta firmó.']]);
    let s = con(doc, [per(doc, 'Martha Cecilia Ejemplo-Acosta Ortiz'), per(doc, 'Ejemplo-Acosta Ortiz'),
      lst(doc, 'Ejemplo-Acosta', CAS_M, 'apellido_suelto', 2)], [persona(CAS_M, 'Martha Ejemplo-Acosta')]);
    expect(grupos(s)).toEqual([['Martha Cecilia Ejemplo-Acosta Ortiz', 'Ejemplo-Acosta Ortiz', 'Ejemplo-Acosta']]);
    expect(entOf(s, 'Ejemplo-Acosta Ortiz')).toMatchObject({ canonicalKey: `LISTA:${CAS_M}`, marker: '[DEMANDANTE_1]' });
    expect(dets(s).map((d) => d.confidence)).toEqual(['media', 'baja', 'media']);
    // Sin ninguna mención de la lista, la entidad del modelo pasa a ser la de la lista (nombre y rol del abogado).
    doc = mkDoc([['cuerpo', 'Firmó Ana Lucía Prueba Navarro.']]);
    s = con(doc, [per(doc, 'Ana Lucía Prueba Navarro')], [persona(CAS_M, 'Ana Prueba')]);
    expect(entOf(s, 'Ana Lucía Prueba Navarro')).toMatchObject({ canonicalKey: `LISTA:${CAS_M}`, caseEntityId: CAS_M, display: 'Ana Prueba', role: 'DEMANDANTE' });
    // Otro nombre de pila, o el nombre de dos personas de la lista dentro del mismo tramo: no se une.
    s = con(doc, [per(doc, 'Ana Lucía Prueba Navarro')], [persona(CAS_M, 'Lucía Prueba')]);
    expect(entOf(s, 'Ana Lucía Prueba Navarro').canonicalKey).toBe('PER:ana lucia prueba navarro');
    s = con(doc, [per(doc, 'Ana Lucía Prueba Navarro')], [persona(CAS_M, 'Ana Prueba'), persona(CAS_S, 'Ana Navarro')]);
    expect(entOf(s, 'Ana Lucía Prueba Navarro').canonicalKey).toBe('PER:ana lucia prueba navarro');
  });

  it('C2 sigla silábica de una organización de la lista, solo si el texto la define (D-14): «FESA» es Ferretería Ejemplo S.A.S.; las iniciales solas no, y con dos candidatas tampoco', () => {
    expect(esSiglaSilabica('fesa', ['ferreteria', 'ejemplo'], 'sas')).toBe(true);
    expect(esSiglaSilabica('copsa', ['constructora', 'prueba'], 'sa')).toBe(true);
    expect(esSiglaSilabica('dipru', ['distribuidora', 'prueba'], 'yciasenc')).toBe(true);
    expect(esSiglaSilabica('tefi', ['textiles', 'ficticios'], 'sas')).toBe(true);
    expect(esSiglaSilabica('agex', ['agroindustrias', 'ejemplo'], 'sa')).toBe(false);   // «EX» no sale del nombre
    expect(esSiglaSilabica('eps', ['ejemplo', 'prueba', 'salud'], '')).toBe(false);     // iniciales: la sigla de 7.9.4
    expect(esSiglaSilabica('fesa', ['ferreteria'], '')).toBe(false);
    const ferreteria = (doc: DocumentModel) => mc(doc, 0, 'Ferretería Ejemplo S.A.S.', { type: 'EMPRESA', source: 'lista', caseEntityId: CAS_F,
      variantClass: 'exacta', canonicalKey: `LISTA:${CAS_F}` });
    // El texto define la sigla junto al nombre: entre paréntesis, con «en adelante» o al revés.
    for (const texto of ['Ferretería Ejemplo S.A.S. (en adelante, «FESA») contrató. FESA pagó y FESA firmó.',
      'Ferretería Ejemplo S.A.S. (FESA) contrató. FESA pagó y FESA firmó.',
      'La sociedad Ferretería Ejemplo S.A.S., en adelante FESA, contrató. FESA pagó y FESA firmó.',
      'Contrato con FESA (Ferretería Ejemplo S.A.S.). FESA pagó y FESA firmó.']) {
      const doc = mkDoc([['cuerpo', texto]]);
      const s = con(doc, [ferreteria(doc), org(doc, 'FESA'), org(doc, 'FESA', 1), org(doc, 'FESA', 2)], [empresa(CAS_F, 'Ferretería Ejemplo S.A.S.')]);
      expect(grupos(s), texto).toEqual([texto.startsWith('Contrato') ? ['FESA', 'Ferretería Ejemplo S.A.S.', 'FESA', 'FESA'] : ['Ferretería Ejemplo S.A.S.', 'FESA', 'FESA', 'FESA']]);
      expect(entOf(s, 'FESA').marker).toBe('[EMPRESA_1]');
    }
    // Sin definirla, o solo junto al nombre, o con dos organizaciones de la lista que la explican: se queda aparte.
    for (const texto of ['Ferretería Ejemplo S.A.S. contrató. FESA pagó y FESA firmó. FESA calló.',
      'Firmó Ferretería Ejemplo S.A.S. FESA pagó y FESA firmó. FESA calló.']) {
      const doc = mkDoc([['cuerpo', texto]]);
      const s = con(doc, [ferreteria(doc), org(doc, 'FESA'), org(doc, 'FESA', 1), org(doc, 'FESA', 2)], [empresa(CAS_F, 'Ferretería Ejemplo S.A.S.')]);
      expect(grupos(s), texto).toEqual([['Ferretería Ejemplo S.A.S.'], ['FESA', 'FESA', 'FESA']]);
    }
    const doc = mkDoc([['cuerpo', 'Ferretería Ejemplo S.A.S. (FESA) contrató. FESA pagó y FESA firmó.']]);
    const s = con(doc, [ferreteria(doc), org(doc, 'FESA'), org(doc, 'FESA', 1), org(doc, 'FESA', 2)],
      [empresa(CAS_F, 'Ferretería Ejemplo S.A.S.'), empresa(CAS_X, 'Fábrica Ejemplo S.A.')]);
    expect(grupos(s)).toEqual([['Ferretería Ejemplo S.A.S.'], ['FESA', 'FESA', 'FESA']]);
  });

  it('C3 mismo núcleo con una palabra común delante, dentro del mismo tipo; entre persona, organización y lugar solo la forma exacta de C5 (D-14, D-15); EPS e IPS siguen aparte (C-12)', () => {
    // D-15 (PB-3-r3, C5): el mismo texto exacto con otra etiqueta sí se une; por el núcleo (C3) entre tipos, nunca.
    let doc = mkDoc([['cuerpo', 'la ambulancia de Papelería Ficticia no llegó; Papelería Ficticia Ltda. cotizó y la Papelería Ficticia respondió.']]);
    let s = con(doc, [org(doc, 'Papelería Ficticia'), org(doc, 'Papelería Ficticia Ltda.'), per(doc, 'Papelería Ficticia', 2)]);
    expect(grupos(s)).toEqual([['Papelería Ficticia', 'Papelería Ficticia Ltda.', 'Papelería Ficticia']]);
    expect(dets(s).map((d) => d.type)).toEqual(['EMPRESA', 'EMPRESA', 'EMPRESA']);
    doc = mkDoc([['cuerpo', 'cuando Ficticio negó la atención y luego Ficticio volvió a negarla']]);
    s = con(doc, [loc(doc, 'Ficticio'), org(doc, 'Ficticio', 1)]);
    expect(grupos(s)).toEqual([['Ficticio', 'Ficticio']]);
    expect(entOf(s, 'Ficticio').type).toBe('EMPRESA');
    // Por el núcleo con una palabra común delante, entre tipos no (C3 sigue dentro del tipo).
    doc = mkDoc([['cuerpo', 'el taller Papelería Ficticia cotizó y Papelería Ficticia respondió.']]);
    s = con(doc, [org(doc, 'taller Papelería Ficticia'), per(doc, 'Papelería Ficticia', 1)]);
    expect(grupos(s)).toHaveLength(2);
    doc = mkDoc([['cuerpo', 'El taller Laboratorio Clínico Prueba Ltda. certificó. La póliza de Laboratorio Clínico Prueba Ltda. ampara.']]);
    s = con(doc, [org(doc, 'taller Laboratorio Clínico Prueba Ltda.'), org(doc, 'Laboratorio Clínico Prueba Ltda.')]);
    expect(grupos(s)).toEqual([['taller Laboratorio Clínico Prueba Ltda.', 'Laboratorio Clínico Prueba Ltda.']]);
    expect(entOf(s, 'Laboratorio Clínico Prueba Ltda.').display).toBe('Laboratorio Clínico Prueba Ltda.');
    doc = mkDoc([['cuerpo', 'Ejemplo EPS remitió a Ejemplo IPS']]);
    s = con(doc, [mc(doc, 0, 'Ejemplo EPS', { type: 'EPS', source: 'modelo', canonicalKey: orgKey('Ejemplo EPS') }),
      mc(doc, 0, 'Ejemplo IPS', { type: 'IPS', source: 'modelo', canonicalKey: orgKey('Ejemplo IPS') })]);
    expect(grupos(s)).toHaveLength(2);
  });

  it('C4 S-7.11 con la lista: la forma corta del nombre completo que la lista tomó del modelo (D-03 E) se une a la persona de la lista', () => {
    const doc = mkDoc([['cuerpo', 'Santiago Prueba Rojas firmó. Prueba Rojas insiste. Luego Prueba Rojas calló.']]);
    const s = con(doc, [lst(doc, 'Santiago Prueba Rojas', CAS_S, 'exacta', 0, { extended: true, confidence: 'media' }), per(doc, 'Prueba Rojas'),
      mc(doc, 0, 'Prueba Rojas', { type: 'EMPRESA', source: 'modelo', nerLabel: 'ORG', canonicalKey: orgKey('Prueba Rojas') }, 1)],
    [persona(CAS_S, 'Santiago Prueba')]);
    // La misma forma de dos palabras que el modelo etiquetó ORG es la forma corta que ya es de la persona (D-15, C5; antes D-14 la
    // dejaba aparte): pasa a persona, con confianza baja.
    expect(grupos(s)).toEqual([['Santiago Prueba Rojas', 'Prueba Rojas', 'Prueba Rojas']]);
    expect(dets(s).map((d) => `${d.type}:${d.confidence}`)).toEqual(['PERSONA:media', 'PERSONA:baja', 'PERSONA:baja']);
    // Una forma hecha solo de palabras del nombre de la lista es una variante: la busca la lista, no la correferencia.
    const d2 = mkDoc([['cuerpo', 'Ana Ficticia Rojas declaró. Rojas (otra persona) no vino.']]);
    const s2 = con(d2, [mc(d2, 0, 'Ana Ficticia Rojas', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, variantClass: 'exacta', canonicalKey: `LISTA:${CAS_A}` }),
      per(d2, 'Rojas', 1)], CASES);
    expect(grupos(s2)).toEqual([['Ana Ficticia Rojas'], ['Rojas']]);
  });

  it('C4 S-7.11 entre etiquetas (D-14): una ORG del modelo nunca se une a una persona, ni sin sufijo, ni con sufijo, ni con palabra común ni dentro de otra organización', () => {
    let doc = mkDoc([['cuerpo', 'Elizabeth Ficticia Valencia firmó. Revisar la T.P. de Ficticia Valencia.']]);
    let s = con(doc, [per(doc, 'Elizabeth Ficticia Valencia'), org(doc, 'Ficticia Valencia')]);
    expect(grupos(s)).toEqual([['Elizabeth Ficticia Valencia'], ['Ficticia Valencia']]);
    expect(entOf(s, 'Ficticia Valencia').type).toBe('EMPRESA');
    doc = mkDoc([['cuerpo', 'Elizabeth Ficticia Valencia firmó. Pagó Ficticia Valencia S.A.S. ayer.']]);
    s = con(doc, [per(doc, 'Elizabeth Ficticia Valencia'), org(doc, 'Ficticia Valencia S.A.S.')]);
    expect(grupos(s)).toHaveLength(2);
    doc = mkDoc([['cuerpo', 'Elizabeth Ficticia Valencia firmó. Ficticia Valencia Comercial vendió a Ficticia Valencia.']]);
    s = con(doc, [per(doc, 'Elizabeth Ficticia Valencia'), org(doc, 'Ficticia Valencia Comercial'), org(doc, 'Ficticia Valencia', 2)]);
    expect(grupos(s)).toHaveLength(3);
    doc = mkDoc([['cuerpo', 'Elizabeth Ficticia Valencia firmó. La papelería Valencia cerró.']]);
    s = con(doc, [per(doc, 'Elizabeth Ficticia Valencia'), org(doc, 'papelería Valencia')]);
    expect(grupos(s)).toHaveLength(2);
  });

  it('C4 S-7.11: la palabra común que el modelo se llevó no cuenta; el nombre de pila del correo y el apodo introducido unen a la persona', () => {
    let doc = mkDoc([['cuerpo', 'De: Camilo Ejemplo Acosta. Consulte con Camilo primero.']]);
    let s = con(doc, [per(doc, 'Camilo Ejemplo Acosta'), per(doc, 'Camilo primero')]);
    expect(grupos(s)).toEqual([['Camilo Ejemplo Acosta', 'Camilo primero']]);
    doc = mkDoc([['cuerpo', 'Para: Prueba Giraldo <sergio.prueba@correo.ejemplo.test>\n\nbuenas Sergio,\nconsulte con Sergio primero.']]);
    s = con(doc, [per(doc, 'Prueba Giraldo'), per(doc, 'Sergio'), per(doc, 'Sergio', 1)]);
    expect(grupos(s)).toEqual([['Prueba Giraldo', 'Sergio', 'Sergio']]);
    // El modelo etiquetó ORG el nombre del correo: el buzón puede ser de una sociedad «Prueba Giraldo» y «Sergio», su empleado.
    // D-14: entre tipos distintos no se une.
    s = con(doc, [org(doc, 'Prueba Giraldo'), per(doc, 'Sergio')]);
    expect(grupos(s)).toEqual([['Prueba Giraldo'], ['Sergio']]);
    expect(entOf(s, 'Prueba Giraldo')).toMatchObject({ type: 'EMPRESA', canonicalKey: 'ORG:prueba giraldo' });
    // Un buzón genérico no da nombre de pila.
    doc = mkDoc([['cuerpo', 'Para: Prueba Giraldo <contacto@correo.ejemplo.test>\n\nbuenas Sergio,']]);
    expect(grupos(con(doc, [per(doc, 'Prueba Giraldo'), per(doc, 'Sergio')]))).toHaveLength(2);
    doc = mkDoc([['cuerpo', 'el lote es de mi suegra Constanza Ficticia Ruiz, a quien le decimos Cata, desde 1998. Cata no firmó.']]);
    s = con(doc, [per(doc, 'Constanza Ficticia Ruiz'), per(doc, 'Cata', 1)]);
    expect(grupos(s)).toEqual([['Constanza Ficticia Ruiz', 'Cata']]);
    doc = mkDoc([['cuerpo', 'Pedro Ficticio Gómez, alias Toto, llegó. Toto pagó.']]);
    s = con(doc, [per(doc, 'Pedro Ficticio Gómez'), per(doc, 'Toto', 1)]);
    expect(grupos(s)).toEqual([['Pedro Ficticio Gómez', 'Toto']]);
    // Con dos candidatas no se une (S-7.11), aunque una sea de la lista.
    doc = mkDoc([['cuerpo', 'Pedro Ejemplo Prueba declaró. Luisa Ejemplo Prueba también. Después Ejemplo Prueba firmó.']]);
    s = con(doc, [per(doc, 'Pedro Ejemplo Prueba'), lst(doc, 'Luisa Ejemplo Prueba', CAS_S, 'exacta', 0, { extended: true, confidence: 'media' }),
      per(doc, 'Ejemplo Prueba', 2)], [persona(CAS_S, 'Luisa Ejemplo')]);
    expect(grupos(s)).toHaveLength(3);
  });

  it('INV-R12 7.12.2.4 por ventana: la forma corta de una ventana anterior se une al nombre completo que llega después; lo decidido y lo separado no se mueven', () => {
    const doc = mkDoc([['cuerpo', 'reportó a Ejemplo Salazar como retirado. Iván Darío Ejemplo Salazar declaró. Ejemplo Salazar firmó. Diana Carolina Ejemplo Salazar vino. Ejemplo Salazar volvió.']]);
    const t = (doc.parts[0] as DocumentModel['parts'][number]).text;
    const partId = (doc.parts[0] as DocumentModel['parts'][number]).id;
    let n = 0;
    const delta = (items: Array<[string, number]>): DetectionSet => {
      const detections: Detection[] = [];
      const entities = new Map<string, Entity>();
      for (const [sub, occ] of items) {
        let i = -1; for (let k = 0; k <= occ; k++) i = t.indexOf(sub, i + 1);
        const key = personKey(sub);
        const e = entities.get(key) ?? { id: `ent_${(0xe00 + ++n).toString(16).padStart(32, '0')}` as Entity['id'], canonicalKey: key, type: 'PERSONA',
          role: 'OTRA_PERSONA', family: 'PERSONA', marcadorEspecifico: false, mentions: [], sameHolderAs: [], display: sub } as Entity;
        const d: Detection = { id: `det_${(0xd00 + ++n).toString(16).padStart(32, '0')}` as Detection['id'], docId: doc.id, partId, start: i, end: i + sub.length,
          text: sub, type: 'PERSONA', role: 'OTRA_PERSONA', source: 'modelo', nerLabel: 'PER', precedence: 6, confidence: 'media', score: 0.6,
          canonicalKey: key, status: 'pendiente', entityId: e.id, replacement: { proposedTemplate: '{m}' } };
        e.mentions.push(d.id); entities.set(key, e); detections.push(d);
      }
      return { detections, entities: [...entities.values()], flags: [], suggestions: [] };
    };
    const ctx: ReviewContext = { table: EMPTY, caseList: [], doc, ids: seqIds(9000) };
    const s0 = con(doc, []);
    const w = (s: ReviewState, v: number, items: Array<[string, number]>) =>
      act(s, { kind: 'incorporar_modelo', ventana: v, ventanasTotales: 3, delta: delta(items) }, ctx);
    const s1 = w(s0, 1, [['Ejemplo Salazar', 0]]);
    const corta = dets(s1)[0] as Detection;
    // Apariciones de «Ejemplo Salazar» en el texto: 0 suelta, 1 dentro de Iván Darío, 2 suelta, 3 dentro de Diana Carolina, 4 suelta.
    const s2 = w(s1, 2, [['Iván Darío Ejemplo Salazar', 0], ['Ejemplo Salazar', 2]]);
    expect(grupos(s2)).toEqual([['Ejemplo Salazar', 'Iván Darío Ejemplo Salazar', 'Ejemplo Salazar']]);
    expect(s2.detections[corta.id]?.confidence).toBe('baja');
    // C0 (D-14, A-2): con una segunda candidata («Diana Carolina…») la forma corta nueva ya no tiene una sola anfitriona (S-7.11) y
    // no se une a ninguna, aunque su clave ya esté en la entidad de Iván Darío. Las ya unidas se quedan: una unión no se deshace.
    const s3 = w(s2, 3, [['Diana Carolina Ejemplo Salazar', 0], ['Ejemplo Salazar', 4]]);
    expect(grupos(s3)).toEqual([['Ejemplo Salazar', 'Iván Darío Ejemplo Salazar', 'Ejemplo Salazar'], ['Diana Carolina Ejemplo Salazar'], ['Ejemplo Salazar']]);
    expect(markers(s3).map(([, m]) => m)).toEqual(['[PERSONA_1]', '[PERSONA_1]', '[PERSONA_1]', '[PERSONA_2]', '[PERSONA_3]']);
    // Aceptada o separada por el usuario antes de la ventana 2, la forma corta se queda donde está (INV-R12).
    const aceptada = act(s1, { kind: 'aceptar', detectionId: corta.id }, ctx);
    const a2 = w(aceptada, 2, [['Iván Darío Ejemplo Salazar', 0]]);
    expect(a2.detections[corta.id]).toEqual(aceptada.detections[corta.id]);
    expect(grupos(a2)).toEqual([['Ejemplo Salazar'], ['Iván Darío Ejemplo Salazar']]);
    const separada = act(s2, { kind: 'separar_mencion', detectionId: corta.id }, ctx);
    const p3 = w(separada, 3, [['Ejemplo Salazar', 4]]);
    expect(p3.detections[corta.id]?.entityId).toBe(separada.detections[corta.id]?.entityId);
    expect(p3.detections[corta.id]?.entityId).not.toBe(p3.detections[(dets(s2)[1] as Detection).id]?.entityId);
  });

  it('INV-R12 M-12 la correferencia no une a la persona de la lista un nombre que se solapa con una mención suya rechazada', () => {
    const doc = mkDoc([['cuerpo', 'La demandante Ana Lucía Prueba Navarro presentó la tutela.']]);
    const t = (doc.parts[0] as DocumentModel['parts'][number]).text;
    const partId = (doc.parts[0] as DocumentModel['parts'][number]).id;
    const ctx: ReviewContext = { table: EMPTY, caseList: [persona(CAS_M, 'Ana Prueba')], doc, ids: seqIds(9000) };
    const s0 = con(doc, [lst(doc, 'Ana', CAS_M, 'nombre_suelto')], ctx.caseList);
    const ana = dets(s0)[0] as Detection;
    const r = act(s0, { kind: 'rechazar', detectionId: ana.id, reason: 'FALSO_POSITIVO' }, ctx);
    const i = t.indexOf('Ana Lucía Prueba Navarro');
    const d: Detection = { ...ana, id: `det_${'f1'.padStart(32, '0')}` as Detection['id'], start: i, end: i + 24, text: 'Ana Lucía Prueba Navarro',
      source: 'modelo', nerLabel: 'PER', precedence: 6, confidence: 'media', canonicalKey: personKey('Ana Lucía Prueba Navarro'),
      status: 'pendiente', entityId: `ent_${'f1'.padStart(32, '0')}` as Entity['id'], role: 'OTRA_PERSONA' };
    delete d.caseEntityId; delete d.variantClass; delete d.rejectReason; delete d.decidedBy;
    void partId;
    const e: Entity = { id: d.entityId, canonicalKey: d.canonicalKey, type: 'PERSONA', role: 'OTRA_PERSONA', family: 'PERSONA',
      marcadorEspecifico: false, mentions: [d.id], sameHolderAs: [], display: d.text };
    const w1 = act(r, { kind: 'incorporar_modelo', ventana: 1, ventanasTotales: 1, delta: { detections: [d], entities: [e], flags: [], suggestions: [] } }, ctx);
    expect(w1.entities[w1.detections[d.id]?.entityId as Entity['id']]?.canonicalKey).toBe('PER:ana lucia prueba navarro');
    expect(w1.detections[ana.id]).toEqual(r.detections[ana.id]);
  });

  it('rendimiento: la correferencia de 3.000 entidades del modelo es lineal (índice por palabra)', () => {
    const letras = (k: number): string => { let s = ''; let x = k; do { s += String.fromCharCode(97 + (x % 26)); x = Math.floor(x / 26); } while (x > 0); return s; };
    const pares = Array.from({ length: 1500 }, (_, k) => [`Pedro${letras(k)} Ficticio${letras(k)} Prueba${letras(k)}`, `Ficticio${letras(k)} Prueba${letras(k)}`]);
    const doc = mkDoc([['cuerpo', pares.map(([largo, corto]) => `${largo} firmó y ${corto} calló.`).join('\n')]]);
    const cands = pares.flatMap(([largo, corto]) => [per(doc, largo as string), per(doc, corto as string, 1)]);
    const t0 = performance.now();
    const s = con(doc, cands);
    expect(performance.now() - t0).toBeLessThan(8000);
    expect(Object.keys(s.entities)).toHaveLength(1500);
  });
});

describe('T-MO-06 · correferencia de PB-3-r2: nunca dos titulares bajo un marcador (D-14, A-2, M-62, B-82)', () => {
  let n = 0;
  const ids: IdSource = { next: (p) => `${p}_${(0x70000 + ++n).toString(16).padStart(32, '0')}` };
  const OPC = { referenceDate: '2026-10-30', rulesVersion: '1.0.0', nerHighThreshold: 0.9, nerMinScore: 0.3 };
  const estadoDeSet = (doc: DocumentModel, set: DetectionSet & { spanEdits?: SpanEdit[] }): ReviewState => ({
    docId: doc.id, revision: 0, detections: Object.fromEntries(set.detections.map((d) => [d.id, d])), order: set.detections.map((d) => d.id),
    entities: Object.fromEntries(set.entities.map((e) => [e.id, e])), suggestions: Object.fromEntries(set.suggestions.map((x) => [x.id, x])),
    flags: Object.fromEntries(set.flags.map((f) => [f.id, f])), spanEdits: Object.fromEntries((set.spanEdits ?? []).map((x) => [x.id, x])),
    committed: false, modelo: modeloInicial(false) });
  /** La tubería real de la sonda de la revisión: `detectar` con la lista del caso, `fusionar` con tramos del modelo e `incorporar_modelo`. */
  async function tuberia(texto: string, lista: Array<[string, 'persona' | 'organizacion', Role]>, ner: Array<[string, NerSpan['label'], number?]>): Promise<ReviewState> {
    const caseList = refreshVariants(lista.map(([nombre, k, r]) => newCaseEntity(nombre, k, r, ids) as CaseEntity));
    const doc = mkDoc([['cuerpo', texto]]);
    const part = doc.parts[0] as DocumentModel['parts'][number];
    const h = createDetectHandler({ ids });
    const pedir = async (kind: string, payload: unknown): Promise<DetectionSet & { spanEdits?: SpanEdit[] }> => {
      const out: Array<{ kind: string; payload?: { set: DetectionSet & { spanEdits?: SpanEdit[] } } }> = [];
      await h({ v: 1, reqId: `req_${(++n).toString(16).padStart(32, '0')}`, kind, payload }, (m) => out.push(m as (typeof out)[number]));
      const r = out.find((m) => m.kind === 'resultado');
      if (r?.payload === undefined) throw new Error('sin resultado');
      return r.payload.set;
    };
    const s0 = estadoDeSet(doc, await pedir('detectar', { sessionId: 'ses_1', doc, caseList, table: EMPTY, options: OPC }));
    const spans: NerSpan[] = ner.map(([sub, label, occ = 0]) => {
      let i = -1; for (let k = 0; k <= occ; k++) i = texto.indexOf(sub, i + 1);
      if (i < 0) throw new Error(`falta «${sub}»`);
      return { start: i, end: i + sub.length, label, score: 0.95 };
    });
    const f = await pedir('fusionar', { sessionId: 'ses_1', ner: { [part.id]: spans }, nerEngineId: 'gliner-x-large', ventana: 1, ventanasTotales: 1 });
    const o = incorporarModelo(s0, 1, 1, f, { table: EMPTY, caseList, doc, ids });
    if (!o.ok) throw new Error(o.code);
    return o.state;
  }
  const marcadorDe = (s: ReviewState, texto: string, occ = 0): string | undefined =>
    s.entities[(dets(s).filter((d) => d.text === texto)[occ] ?? ({} as Detection)).entityId]?.marker;
  const grupos = (s: ReviewState): string[][] => {
    const out = new Map<string, string[]>();
    for (const d of dets(s)) out.set(d.entityId, [...(out.get(d.entityId) ?? []), d.text]);
    return [...out.values()];
  };

  it('marcaOtroTitular: el parentesco antes, en aposición después o dentro del tramo; desde A-4 (PB-3-r4), también el predicado', () => {
    // A-4 (D-15): el predicado («es hijo de un…») y el nombre del que sale el parentesco («los hijos de…») ya marcan a otra persona.
    const si = ['Su hijo Pedro Luis Ejemplo Prueba declaró.', 'la tía, Pedro Luis Ejemplo Prueba, vino', 'Hijo: Pedro Luis Ejemplo Prueba',
      'del hermano menor, el señor Pedro Luis Ejemplo Prueba', 'Pedro Luis Ejemplo Prueba, hijo de Pedro Ejemplo, declaró',
      'Pedro Luis Ejemplo Prueba (su hijo) declaró', 'Pedro Luis Ejemplo Prueba hija de la demandante', 'PEDRO LUIS EJEMPLO PRUEBA JR. FIRMÓ',
      'Pedro Luis Ejemplo Prueba Junior firmó', 'SU ESPOSA PEDRO LUIS EJEMPLO PRUEBA FIRMÓ',
      'ojo que Pedro Luis Ejemplo Prueba es hijo de un congresista', 'los hijos de Pedro Luis Ejemplo Prueba no vinieron'];
    const no = ['El señor Pedro Luis Ejemplo Prueba declaró.', 'Pedro Luis Ejemplo Prueba, identificado con C.C. 1000000001',
      'Prima de servicios. Pedro Luis Ejemplo Prueba cobró'];
    const at = (t: string): [number, number] => {
      const i = t.toLowerCase().indexOf('pedro luis ejemplo prueba');
      const largo = t.slice(i).match(/^(?:Pedro Luis Ejemplo Prueba(?: Junior)?|PEDRO LUIS EJEMPLO PRUEBA)/u)?.[0] ?? '';
      return [i, i + largo.length];
    };
    for (const t of si) expect(marcaOtroTitular(t, ...at(t)), t).toBe(true);
    for (const t of no) expect(marcaOtroTitular(t, ...at(t)), t).toBe(false);
    // Ventanas fijas: 40.000 blancos no la hacen lenta.
    const largo = `Pedro Luis Ejemplo Prueba${' '.repeat(40_000)}`;
    const t0 = performance.now();
    expect(marcaOtroTitular(`${' '.repeat(40_000)}${largo}`, 40_000, 40_025)).toBe(false);
    expect(performance.now() - t0).toBeLessThan(300);
  });

  it('INV-R12 A-2 C1 con la tubería real: el hijo, la tía o el «hijo de» con el nombre de la persona de la lista no reciben su marcador', async () => {
    const lista: Array<[string, 'persona', Role]> = [['Pedro Ejemplo', 'persona', 'DEMANDANTE']];
    // Sonda C1 de la revisión: antes, [DEMANDANTE_1] (confianza media) para el hijo y para la tía.
    let s = await tuberia('Pedro Ejemplo demandó. Su hijo Pedro Luis Ejemplo Prueba declaró.', lista, [['Pedro Luis Ejemplo Prueba', 'PER']]);
    expect([marcadorDe(s, 'Pedro Ejemplo'), marcadorDe(s, 'Pedro Luis Ejemplo Prueba')]).toEqual(['[DEMANDANTE_1]', '[PERSONA_1]']);
    s = await tuberia('Ana Ficticia demandó. Su tía Ana Lucía Ficticia Prueba declaró.', [['Ana Ficticia', 'persona', 'DEMANDANTE']],
      [['Ana Lucía Ficticia Prueba', 'PER']]);
    expect([marcadorDe(s, 'Ana Ficticia'), marcadorDe(s, 'Ana Lucía Ficticia Prueba')]).toEqual(['[DEMANDANTE_1]', '[PERSONA_1]']);
    s = await tuberia('Pedro Ejemplo demandó. Pedro Luis Ejemplo Prueba, hijo de Pedro Ejemplo, declaró.', lista, [['Pedro Luis Ejemplo Prueba', 'PER']]);
    expect(marcadorDe(s, 'Pedro Luis Ejemplo Prueba')).toBe('[PERSONA_1]');
    // La regla E de merge.ts tampoco: la mención de la lista dentro del nombre del hijo cede y el nombre entra entero, con su entidad.
    s = await tuberia('Pedro Ejemplo demandó. Su hijo Pedro Ejemplo Prueba declaró.', lista, [['Pedro Ejemplo Prueba', 'PER']]);
    expect(markers(s)).toEqual([['Pedro Ejemplo', '[DEMANDANTE_1]'], ['Pedro Ejemplo Prueba', '[PERSONA_1]']]);
    s = await tuberia('Pedro Ejemplo demandó. Pedro Ejemplo Junior declaró.', lista, [['Pedro Ejemplo Junior', 'PER']]);
    expect(markers(s)).toEqual([['Pedro Ejemplo', '[DEMANDANTE_1]'], ['Pedro Ejemplo Junior', '[PERSONA_1]']]);
    // C29 · Otro nombre de pila con los apellidos de la persona de la lista (su variante `apellidos`): el hermano tiene su marcador.
    s = await tuberia('Carmen Rosa Ejemplo Muñoz demandó. Wilson Ejemplo Muñoz declaró.', [['Carmen Rosa Ejemplo Muñoz', 'persona', 'DEMANDANTE']],
      [['Wilson Ejemplo Muñoz', 'PER']]);
    expect(markers(s)).toEqual([['Carmen Rosa Ejemplo Muñoz', '[DEMANDANTE_1]'], ['Wilson Ejemplo Muñoz', '[PERSONA_1]']]);
    // Sin parentesco, C1 sigue uniendo (D-13), con confianza media.
    s = await tuberia('Pedro Ejemplo demandó. El señor Pedro Luis Ejemplo Prueba declaró.', lista, [['Pedro Luis Ejemplo Prueba', 'PER']]);
    // AJ-6 (D-16): el tratamiento pegado va dentro del tramo; la unión y la confianza son las de siempre.
    expect(marcadorDe(s, 'señor Pedro Luis Ejemplo Prueba')).toBe('[DEMANDANTE_1]');
    expect(dets(s).find((d) => d.text === 'señor Pedro Luis Ejemplo Prueba')?.confidence).toBe('media');
  });

  it('INV-R12 A-2 C2 con la tubería real: la sigla de otra institución que encaja en los prefijos no recibe el marcador de la IPS de la lista; la definida sí', async () => {
    const lista: Array<[string, 'organizacion', Role]> = [['Clínica Ejemplo S.A.', 'organizacion', 'IPS']];
    // Sonda C2 de la revisión: antes, [IPS_1] con el tipo cambiado a IPS.
    let s = await tuberia('La Clínica Ejemplo S.A. atendió al paciente, que estudió en el CESA.', lista, [['CESA', 'ORG']]);
    expect([marcadorDe(s, 'Clínica Ejemplo S.A.'), marcadorDe(s, 'CESA')]).toEqual(['[IPS_1]', '[EMPRESA_1]']);
    expect(dets(s).find((d) => d.text === 'CESA')?.type).toBe('EMPRESA');
    s = await tuberia('La Clínica Ejemplo S.A. (CESA) atendió al paciente. CESA facturó.', lista, [['CESA', 'ORG'], ['CESA', 'ORG', 1]]);
    expect([marcadorDe(s, 'CESA'), marcadorDe(s, 'CESA', 1)]).toEqual(['[IPS_1]', '[IPS_1]']);
  });

  it('INV-R12 A-2 C3 con la tubería real: una persona y su sociedad epónima, o una persona y un lugar con su nombre, son dos titulares', async () => {
    // Sonda C1 de la revisión: antes, un solo marcador para la persona y la sociedad; la persona y el lugar, [DIRECCIÓN_1].
    let s = await tuberia('Pedro Ejemplo Gómez firmó con Pedro Ejemplo Gómez S.A.S. y Pedro Ejemplo Gómez S.A.S. pagó.', [],
      [['Pedro Ejemplo Gómez', 'PER'], ['Pedro Ejemplo Gómez S.A.S.', 'ORG'], ['Pedro Ejemplo Gómez S.A.S.', 'ORG', 1]]);
    expect(markers(s)).toEqual([['Pedro Ejemplo Gómez', '[PERSONA_1]'], ['Pedro Ejemplo Gómez S.A.S.', '[EMPRESA_1]'], ['Pedro Ejemplo Gómez S.A.S.', '[EMPRESA_1]']]);
    expect(dets(s).map((d) => d.type)).toEqual(['PERSONA', 'EMPRESA', 'EMPRESA']);
    s = await tuberia('El señor Ejemplo Nariño declaró que vive en Ejemplo Nariño, y que Ejemplo Nariño es frío.', [],
      [['Ejemplo Nariño', 'PER'], ['Ejemplo Nariño', 'LOC', 1], ['Ejemplo Nariño', 'LOC', 2]]);
    expect(markers(s)).toEqual([['señor Ejemplo Nariño', '[PERSONA_1]'], ['Ejemplo Nariño', '[DIRECCIÓN_1]'], ['Ejemplo Nariño', '[DIRECCIÓN_1]']]);   // AJ-6 (D-16)
  });

  it('A-2 al construir (sonda C2 de la revisión): padre e hijo, tía, persona y sociedad, persona y lugar quedan aparte', () => {
    const CAS_P = 'cas_000000000000000000000000000000c1' as CaseEntityId;
    const persona = (name: string): CaseEntity => ({ id: CAS_P, name, variants: [], kind: 'persona', role: 'DEMANDANTE' });
    const per = (doc: DocumentModel, t: string, occ = 0) => mc(doc, 0, t, { type: 'PERSONA', source: 'modelo', nerLabel: 'PER', canonicalKey: personKey(t) }, occ);
    const org = (doc: DocumentModel, t: string, occ = 0) => mc(doc, 0, t, { type: 'EMPRESA', source: 'modelo', nerLabel: 'ORG', canonicalKey: orgKey(t) }, occ);
    const loc = (doc: DocumentModel, t: string, occ = 0) => mc(doc, 0, t, { type: 'LUGAR', source: 'modelo', nerLabel: 'LOC', canonicalKey: `LUGAR:${t.toLowerCase()}` }, occ);
    const lst = (doc: DocumentModel, t: string) => mc(doc, 0, t, { type: 'PERSONA', source: 'lista', caseEntityId: CAS_P, variantClass: 'exacta', canonicalKey: `LISTA:${CAS_P}` });
    const con = (doc: DocumentModel, c: MergedCandidate[], cl: CaseEntity[] = []) => buildReviewState(doc, c, { table: EMPTY, caseList: cl, ids: seqIds(1000) });
    let doc = mkDoc([['cuerpo', 'Pedro Ejemplo demandó. Su hijo Pedro Luis Ejemplo Prueba declaró.']]);
    expect(grupos(con(doc, [lst(doc, 'Pedro Ejemplo'), per(doc, 'Pedro Luis Ejemplo Prueba')], [persona('Pedro Ejemplo')])))
      .toEqual([['Pedro Ejemplo'], ['Pedro Luis Ejemplo Prueba']]);
    doc = mkDoc([['cuerpo', 'Ana Ficticia demandó. Su tía Ana Lucía Ficticia Prueba declaró.']]);
    expect(grupos(con(doc, [lst(doc, 'Ana Ficticia'), per(doc, 'Ana Lucía Ficticia Prueba')], [persona('Ana Ficticia')])))
      .toEqual([['Ana Ficticia'], ['Ana Lucía Ficticia Prueba']]);
    doc = mkDoc([['cuerpo', 'Pedro Ejemplo Gómez firmó con Pedro Ejemplo Gómez S.A.S. y Pedro Ejemplo Gómez S.A.S. pagó.']]);
    let s = con(doc, [per(doc, 'Pedro Ejemplo Gómez'), org(doc, 'Pedro Ejemplo Gómez S.A.S.'), org(doc, 'Pedro Ejemplo Gómez S.A.S.', 1)]);
    expect(grupos(s)).toEqual([['Pedro Ejemplo Gómez'], ['Pedro Ejemplo Gómez S.A.S.', 'Pedro Ejemplo Gómez S.A.S.']]);
    expect(entOf(s, 'Pedro Ejemplo Gómez').type).toBe('PERSONA');
    doc = mkDoc([['cuerpo', 'El señor Ejemplo Nariño declaró que vive en Ejemplo Nariño, y que Ejemplo Nariño es frío.']]);
    s = con(doc, [per(doc, 'Ejemplo Nariño'), loc(doc, 'Ejemplo Nariño', 1), loc(doc, 'Ejemplo Nariño', 2)]);
    expect(grupos(s)).toEqual([['Ejemplo Nariño'], ['Ejemplo Nariño', 'Ejemplo Nariño']]);
  });

  // Ventanas del modelo sobre un texto fijo, como en la prueba de 7.12.2.4 por ventana.
  const TEXTO = 'reportó a Ejemplo Salazar como retirado. Salazar firmó. Iván Darío Ejemplo Salazar declaró. Ejemplo Salazar firmó. Ejemplo Salazar volvió.';
  function ventanas(table: TableIndex = EMPTY, texto = TEXTO) {
    const doc = mkDoc([['cuerpo', texto]]);
    const partId = (doc.parts[0] as DocumentModel['parts'][number]).id;
    const delta = (items: Array<[string, number] | [string, number, 'ORG']>): DetectionSet => {
      const detections: Detection[] = [];
      const entities = new Map<string, Entity>();
      for (const [sub, occ, etiqueta] of items) {
        let i = -1; for (let k = 0; k <= occ; k++) i = texto.indexOf(sub, i + 1);
        const org = etiqueta === 'ORG';
        const key = org ? orgKey(sub) : personKey(sub);
        const e = entities.get(key) ?? { id: `ent_${(0xe0000 + ++n).toString(16).padStart(32, '0')}` as Entity['id'], canonicalKey: key,
          type: org ? 'EMPRESA' : 'PERSONA', role: org ? 'EMPRESA' : 'OTRA_PERSONA', family: org ? 'EMPRESA' : 'PERSONA', marcadorEspecifico: false,
          mentions: [], sameHolderAs: [], display: sub } as Entity;
        const d: Detection = { id: `det_${(0xd0000 + ++n).toString(16).padStart(32, '0')}` as Detection['id'], docId: doc.id, partId, start: i, end: i + sub.length,
          text: sub, type: org ? 'EMPRESA' : 'PERSONA', source: 'modelo', nerLabel: org ? 'ORG' : 'PER', precedence: 6, confidence: 'media', score: 0.6,
          canonicalKey: key, status: 'pendiente', entityId: e.id, replacement: { proposedTemplate: '{m}' } };
        if (!org) d.role = 'OTRA_PERSONA';
        e.mentions.push(d.id); entities.set(key, e); detections.push(d);
      }
      return { detections, entities: [...entities.values()], flags: [], suggestions: [] };
    };
    const ctx: ReviewContext = { table, caseList: [], doc, ids: seqIds(9000) };
    const s0 = buildReviewState(doc, [], { table, caseList: [], ids: seqIds(1000) });
    const w = (s: ReviewState, v: number, items: Array<[string, number] | [string, number, 'ORG']>) =>
      act(s, { kind: 'incorporar_modelo', ventana: v, ventanasTotales: 3, delta: delta(items) }, ctx);
    return { ctx, s0, w };
  }
  // Apariciones de «Ejemplo Salazar» en TEXTO: 0 suelta, 1 dentro de Iván Darío, 2 y 3 sueltas.

  it('INV-R12 M-62 cambiar_rol antes de la ventana 2: la forma corta se queda en su entidad, con su marcador, su rol y su confianza', () => {
    const { ctx, s0, w } = ventanas();
    const s1 = w(s0, 1, [['Ejemplo Salazar', 0]]);
    const corta = dets(s1)[0] as Detection;
    const r = act(s1, { kind: 'cambiar_rol', entityId: corta.entityId, role: 'TESTIGO' }, ctx);
    expect(r.entities[corta.entityId]?.marker).toBe('[TESTIGO_1]');
    // Sonda C3 de la revisión: antes pasaba a la entidad nueva con [PERSONA_1], confianza baja y el rol TESTIGO en la detección.
    for (const antes of [r, act(act(r, { kind: 'aceptar', detectionId: corta.id }, ctx), { kind: 'restablecer', detectionId: corta.id }, ctx)]) {
      const s2 = w(antes, 2, [['Iván Darío Ejemplo Salazar', 0]]);
      const d = s2.detections[corta.id] as Detection;
      expect(s2.entities[d.entityId]).toMatchObject({ marker: '[TESTIGO_1]', role: 'TESTIGO' });
      expect(d).toMatchObject({ confidence: 'media', role: 'TESTIGO', entityId: corta.entityId });
      expect(grupos(s2)).toEqual([['Ejemplo Salazar'], ['Iván Darío Ejemplo Salazar']]);
    }
  });

  it('INV-R12 M-62 unir_entidades del usuario antes de la ventana 2: el grupo no se mueve a la anfitriona nueva', () => {
    const texto = 'Pagó Papelería Ficticia. Cotizó Ferretería Prueba. El taller Papelería Ficticia respondió, el taller Papelería Ficticia facturó y el taller Papelería Ficticia cobró.';
    const { ctx, s0, w } = ventanas(EMPTY, texto);
    const s1 = w(s0, 1, [['Papelería Ficticia', 0, 'ORG'], ['Ferretería Prueba', 0, 'ORG']]);
    const [pap, fer] = dets(s1) as [Detection, Detection];
    const u = act(s1, { kind: 'unir_entidades', fromId: fer.entityId, intoId: pap.entityId }, ctx);
    const ventana2: Array<[string, number, 'ORG']> = [0, 1, 2].map((k) => ['taller Papelería Ficticia', k, 'ORG']);
    // Sin la acción del usuario, C3 lleva «Papelería Ficticia» a la entidad de más menciones (la del taller).
    expect(grupos(w(s1, 2, ventana2))).toEqual([['Papelería Ficticia', 'taller Papelería Ficticia', 'taller Papelería Ficticia', 'taller Papelería Ficticia'],
      ['Ferretería Prueba']]);
    // Con la unión del usuario, su grupo se queda junto, con su marcador y su confianza.
    const s2 = w(u, 2, ventana2);
    expect(grupos(s2)).toEqual([['Papelería Ficticia', 'Ferretería Prueba'], ['taller Papelería Ficticia', 'taller Papelería Ficticia', 'taller Papelería Ficticia']]);
    expect(s2.entities[pap.entityId]?.marker).toBe(u.entities[pap.entityId]?.marker);
    expect([s2.detections[pap.id]?.confidence, s2.detections[fer.id]?.confidence]).toEqual(['media', 'media']);
  });

  it('INV-R12 INV-T04 M-62 una entidad con el marcador fijado en el asunto no se mueve con la correferencia', () => {
    const table: TableIndex = { byKey: { 'PER:ejemplo salazar': '[PERSONA_7]' }, counters: { PERSONA: 7 }, documentCount: 1 };
    const { s0, w } = ventanas(table);
    const s1 = w(s0, 1, [['Ejemplo Salazar', 0]]);
    const corta = dets(s1)[0] as Detection;
    expect(s1.entities[corta.entityId]).toMatchObject({ marker: '[PERSONA_7]', markerState: 'heredado' });
    const s2 = w(s1, 2, [['Iván Darío Ejemplo Salazar', 0]]);
    expect(markers(s2)).toEqual([['Ejemplo Salazar', '[PERSONA_7]'], ['Iván Darío Ejemplo Salazar', '[PERSONA_8]']]);
  });

  it('INV-R12 B-82 separar, aceptar, restablecer y otra ventana: la mención separada no se vuelve a unir', () => {
    const { ctx, s0, w } = ventanas();
    const s1 = w(s0, 1, [['Ejemplo Salazar', 0]]);
    const corta = dets(s1)[0] as Detection;
    const s2 = w(s1, 2, [['Iván Darío Ejemplo Salazar', 0], ['Ejemplo Salazar', 2]]);
    const ivan = s2.detections[corta.id]?.entityId as Entity['id'];
    expect(grupos(s2)).toEqual([['Ejemplo Salazar', 'Iván Darío Ejemplo Salazar', 'Ejemplo Salazar']]);
    const sep = act(s2, { kind: 'separar_mencion', detectionId: corta.id }, ctx);
    const rest = act(act(sep, { kind: 'aceptar', detectionId: corta.id }, ctx), { kind: 'restablecer', detectionId: corta.id }, ctx);
    // restablecer conserva el `decidedBy` de separar_mencion; la clave de la detección lleva `~sep`.
    expect(rest.detections[corta.id]).toMatchObject({ status: 'pendiente', decidedBy: 'individual', canonicalKey: 'PER:ejemplo salazar~sep' });
    assertR05(rest);
    const s3 = w(rest, 3, [['Ejemplo Salazar', 3]]);
    expect(s3.detections[corta.id]?.entityId).toBe(sep.detections[corta.id]?.entityId);
    expect(s3.detections[corta.id]?.entityId).not.toBe(ivan);
    expect(s3.detections[corta.id]).toEqual(rest.detections[corta.id]);
  });
});

describe('T-MO-06 · id de la edición de tramo de una sugerencia o bandera (P0-6a B-7)', () => {
  /** IdSource con un contador por prefijo: `sug_…1`, `flg_…1` y `edt_…1` comparten sufijo, el caso que antes colisionaba.
   *  `edts` anota cada `edt` que entrega. */
  function perPrefixIds(edts: string[]): IdSource {
    const n: Record<string, number> = {};
    return { next: (p) => {
      const k = (n[p] ?? 0) + 1; n[p] = k;
      const id = `${p}_${k.toString(16).padStart(32, '0')}`;
      if (p === 'edt') edts.push(id);
      return id;
    } };
  }
  const hex = (n: number) => n.toString(16).padStart(32, '0');
  const setup = () => {
    const edts: string[] = [];
    const ids = perPrefixIds(edts);
    const doc = mkDoc([['cuerpo', 'El menor con T.I. 1000000001 vive con la directora del colegio del Juzgado Ejemplo.']]);
    const part = doc.parts[0] as DocumentModel['parts'][number];
    const l = part.text.indexOf('T.I.');
    const s = buildReviewState(doc, [mc(doc, 0, '1000000001', { type: 'TI', canonicalKey: 'TI:1000000001', label: { labelId: 'L.DOC', start: l, end: l + 4 } })],
      { table: EMPTY, caseList: CASES, ids });
    const at = (sub: string) => ({ partId: part.id, start: part.text.indexOf(sub), end: part.text.indexOf(sub) + sub.length });
    const flag = (sub: string): Flag => ({ id: ids.next('flg') as FlagId, type: 'CARGO', span: at(sub), text: sub, reason: 'LISTA_CARGOS',
      options: [{ id: 'o1', kind: 'CARGO_A_GENERICO', template: 'una directiva' }], acknowledged: false });
    return { edts, ids, doc, s, at, flag, ctx: { table: EMPTY, caseList: CASES, doc, ids } as ReviewContext };
  };
  const docEntity = (st: ReviewState) => Object.values(st.entities).find((x) => x.type === 'DOCUMENTO' || x.type === 'TI') as Entity;

  it('INV-G05 INV-R10 sugerencia y bandera con el mismo sufijo: cada edt sale una vez de IdSource y no colisionan', () => {
    const { edts, s, flag, ctx } = setup();
    const [sug] = Object.values(s.suggestions) as [Suggestion];
    const [sugEdit] = Object.values(s.spanEdits) as [SpanEdit];
    expect(sug).toMatchObject({ id: `sug_${hex(1)}`, kind: 'ROTULO_DOCUMENTO_A_GENERICO', status: 'aplicada', spanEditId: sugEdit.id });
    expect(edts).toEqual([sugEdit.id]);   // la edición preaplicada del rótulo sale de IdSource, no del sufijo de su sug_
    const f = flag('directora');
    expect(f.id).toBe(`flg_${hex(1)}`);
    const r = act({ ...s, flags: { [f.id]: f } }, { kind: 'resolver_bandera', flagId: f.id, resolution: 'reemplazar', optionId: 'o1' }, ctx);
    const flagEdit = r.flags[f.id]?.spanEditId as SpanEditId;
    expect(edts).toEqual([sugEdit.id, flagEdit]);
    expect(flagEdit).not.toBe(sugEdit.id);
    expect(Object.keys(r.spanEdits).sort()).toEqual([sugEdit.id, flagEdit].sort());
    expect(r.spanEdits[sugEdit.id]).toEqual(sugEdit);
    expect(r.spanEdits[flagEdit]).toMatchObject({ text: 'una directiva', originalText: 'directora', origin: { kind: 'bandera', flagId: f.id } });
    // INV-R10 con la bandera resuelta: la sugerencia deshecha conserva su spanEditId y la vuelta lo reutiliza.
    const e = docEntity(r);
    const r1 = act(r, { kind: 'especificar_documento', entityId: e.id, especifico: true }, ctx);
    expect(Object.keys(r1.spanEdits)).toEqual([flagEdit]);
    expect(r1.suggestions[sug.id]).toMatchObject({ status: 'descartada', spanEditId: sugEdit.id });
    expect(act(r1, { kind: 'especificar_documento', entityId: e.id, especifico: false }, ctx)).toEqual({ ...r, revision: r.revision + 2 });
    expect(edts).toHaveLength(2);   // la ida y vuelta no saca ids nuevos
  });

  it('INV-G05 INV-R10 el edt reservado por una sugerencia deshecha no se reparte a otra edición', () => {
    const { s, flag, ctx } = setup();
    const [sug] = Object.values(s.suggestions) as [Suggestion];
    const reserved = sug.spanEditId as SpanEditId;
    const e = docEntity(s);
    const off = act(s, { kind: 'especificar_documento', entityId: e.id, especifico: true }, ctx);
    expect(off.spanEdits).toEqual({});
    const f = flag('directora');
    // Un IdSource que primero repite el id reservado: la bandera lo descarta y toma el siguiente.
    const queue = [reserved, `edt_${hex(9)}`];
    const replay: IdSource = { next: (p) => (p === 'edt' ? queue.shift() as string : ctx.ids?.next(p) as string) };
    const r = act({ ...off, flags: { [f.id]: f } }, { kind: 'resolver_bandera', flagId: f.id, resolution: 'reemplazar', optionId: 'o1' }, { ...ctx, ids: replay });
    expect(r.flags[f.id]?.spanEditId).toBe(`edt_${hex(9)}`);
    const back = act(r, { kind: 'especificar_documento', entityId: e.id, especifico: false }, ctx);
    expect(back.suggestions[sug.id]).toMatchObject({ status: 'aplicada', spanEditId: reserved });
    expect(Object.keys(back.spanEdits).sort()).toEqual([reserved, `edt_${hex(9)}`].sort());
  });

  it('INV-G05 la bandera que pisa el rótulo de la sugerencia da SOLAPAMIENTO_PARCIAL y no la sobrescribe', () => {
    const { s, flag, ctx } = setup();
    const f = flag('T.I.');
    const s0: ReviewState = { ...s, flags: { [f.id]: f } };
    expect(applyReviewAction(s0, { kind: 'resolver_bandera', flagId: f.id, resolution: 'reemplazar', optionId: 'o1' }, ctx))
      .toEqual({ ok: false, code: 'SOLAPAMIENTO_PARCIAL' });
  });

  it('INV-G05 una sugerencia que llega después recibe su propio edt; si trae uno ajeno, no pisa ni borra la edición de la bandera', () => {
    const { s, at, flag, ctx } = setup();
    const f = flag('directora');
    const r = act({ ...s, suggestions: {}, spanEdits: {}, flags: { [f.id]: f } },
      { kind: 'resolver_bandera', flagId: f.id, resolution: 'reemplazar', optionId: 'o1' }, ctx);
    const flagEdit = r.flags[f.id]?.spanEditId as SpanEditId;
    const late: Suggestion = { id: `sug_${hex(1)}` as SuggestionId, kind: 'DESPACHO_A_GENERICO', target: { kind: 'tramo', span: at('Juzgado Ejemplo') },
      originalText: 'Juzgado Ejemplo', options: [{ id: 'o1', kind: 'DESPACHO_A_GENERICO', template: 'un juzgado' }], status: 'pendiente' };
    const ok1 = act({ ...r, suggestions: { [late.id]: late } }, { kind: 'aplicar_sugerencia', suggestionId: late.id, optionId: 'o1' }, ctx);
    const lateEdit = ok1.suggestions[late.id]?.spanEditId as SpanEditId;
    expect(lateEdit).toMatch(/^edt_[0-9a-f]{32}$/u);
    expect(lateEdit).not.toBe(flagEdit);
    expect(ok1.spanEdits[flagEdit]).toEqual(r.spanEdits[flagEdit]);
    expect(ok1.spanEdits[lateEdit]).toMatchObject({ text: 'un juzgado', origin: { kind: 'sugerencia', suggestionId: late.id } });
    // Una sugerencia que trae el spanEditId de la bandera: se rechaza sin pisarla y, al deshacerla, no la borra.
    const foreign: Suggestion = { ...late, spanEditId: flagEdit };
    const r0: ReviewState = { ...r, suggestions: { [late.id]: foreign } };
    expect(applyReviewAction(r0, { kind: 'aplicar_sugerencia', suggestionId: late.id, optionId: 'o1' }, ctx)).toEqual({ ok: false, code: 'SOLAPAMIENTO_PARCIAL' });
    const d = act({ ...r, suggestions: { [late.id]: { ...foreign, status: 'aplicada', chosenOptionId: 'o1' } } },
      { kind: 'descartar_sugerencia', suggestionId: late.id }, ctx);
    expect(d.spanEdits[flagEdit]).toEqual(r.spanEdits[flagEdit]);
    expect(d.suggestions[late.id]?.status).toBe('descartada');
  });

  it('INV-G05 la bandera saca su edt una sola vez: al volver a reemplazar lo reutiliza; con mantener lo suelta', () => {
    const { s, flag, ctx } = setup();
    const f = flag('directora');
    const r1 = act({ ...s, flags: { [f.id]: f } }, { kind: 'resolver_bandera', flagId: f.id, resolution: 'reemplazar', optionId: 'o1' }, ctx);
    const id = r1.flags[f.id]?.spanEditId as SpanEditId;
    const r2 = act(r1, { kind: 'resolver_bandera', flagId: f.id, resolution: 'reemplazar', text: 'una funcionaria' }, ctx);
    expect(r2.flags[f.id]?.spanEditId).toBe(id);
    expect(r2.spanEdits[id]).toMatchObject({ text: 'una funcionaria' });
    const r3 = act(r2, { kind: 'resolver_bandera', flagId: f.id, resolution: 'mantener' }, ctx);
    expect(r3.flags[f.id]?.spanEditId).toBeUndefined();
    expect(r3.spanEdits[id]).toBeUndefined();
  });

  it('INV-G05 un IdSource que repite ids no cuelga el reductor: la bandera y la sugerencia dan SOLAPAMIENTO_PARCIAL', () => {
    const { s, at, flag, ctx } = setup();
    const f = flag('directora');
    const stuck: IdSource = { next: (p) => `${p}_${hex(1)}` };
    expect(applyReviewAction({ ...s, flags: { [f.id]: f } }, { kind: 'resolver_bandera', flagId: f.id, resolution: 'reemplazar', optionId: 'o1' },
      { ...ctx, ids: stuck })).toEqual({ ok: false, code: 'SOLAPAMIENTO_PARCIAL' });
    const late: Suggestion = { id: `sug_${hex(2)}` as SuggestionId, kind: 'DESPACHO_A_GENERICO', target: { kind: 'tramo', span: at('Juzgado Ejemplo') },
      originalText: 'Juzgado Ejemplo', options: [{ id: 'o1', kind: 'DESPACHO_A_GENERICO', template: 'un juzgado' }], status: 'pendiente' };
    expect(applyReviewAction({ ...s, suggestions: { ...s.suggestions, [late.id]: late } }, { kind: 'aplicar_sugerencia', suggestionId: late.id, optionId: 'o1' },
      { ...ctx, ids: stuck })).toEqual({ ok: false, code: 'SOLAPAMIENTO_PARCIAL' });
  });
});

describe('T-MO-06 · PB-3-r3: la variante ambigua la decide el revisor (D-16) y la misma forma con otra etiqueta (D-15)', () => {
  let n = 0;
  const ids: IdSource = { next: (p) => `${p}_${(0x90000 + ++n).toString(16).padStart(32, '0')}` };
  const OPC = { referenceDate: '2026-10-30', rulesVersion: '1.0.0', nerHighThreshold: 0.9, nerMinScore: 0.3 };
  const LISTA_PRUEBA: Array<[string, 'persona' | 'organizacion', Role]> = [['Adriana Prueba Torres', 'persona', 'DEMANDANTE'], ['Nicolás Prueba Mora', 'persona', 'PACIENTE']];
  /** La tubería real: `detectar` con la lista del caso y, si hay, una `fusionar` + `incorporar_modelo` por ventana. */
  async function tuberia(texto: string, lista: Array<[string, 'persona' | 'organizacion', Role]>, ventanas: Array<Array<[string, NerSpan['label'], number?]>> = []) {
    const caseList = refreshVariants(lista.map(([nombre, k, r]) => newCaseEntity(nombre, k, r, ids) as CaseEntity));
    const doc = mkDoc([['cuerpo', texto]]);
    const part = doc.parts[0] as DocumentModel['parts'][number];
    const h = createDetectHandler({ ids });
    const pedir = async (kind: string, payload: unknown): Promise<DetectionSet & { spanEdits?: SpanEdit[] }> => {
      const out: Array<{ kind: string; payload?: { set: DetectionSet & { spanEdits?: SpanEdit[] } } }> = [];
      await h({ v: 1, reqId: `req_${(++n).toString(16).padStart(32, '0')}`, kind, payload }, (m) => out.push(m as (typeof out)[number]));
      const r = out.find((m) => m.kind === 'resultado');
      if (r?.payload === undefined) throw new Error('sin resultado');
      return r.payload.set;
    };
    const set = await pedir('detectar', { sessionId: 'ses_r3', doc, caseList, table: EMPTY, options: OPC });
    let s: ReviewState = { docId: doc.id, revision: 0, detections: Object.fromEntries(set.detections.map((d) => [d.id, d])), order: set.detections.map((d) => d.id),
      entities: Object.fromEntries(set.entities.map((e) => [e.id, e])), suggestions: {}, flags: {}, spanEdits: {}, committed: false, modelo: modeloInicial(false) };
    const ctx: ReviewContext = { table: EMPTY, caseList, doc, ids };
    for (let v = 0; v < ventanas.length; v++) {
      const spans: NerSpan[] = (ventanas[v] ?? []).map(([sub, label, occ = 0]) => {
        let i = -1; for (let k = 0; k <= occ; k++) i = texto.indexOf(sub, i + 1);
        if (i < 0) throw new Error(`falta «${sub}»`);
        return { start: i, end: i + sub.length, label, score: 0.95 };
      });
      const f = await pedir('fusionar', { sessionId: 'ses_r3', ner: { [part.id]: spans }, nerEngineId: 'gliner-x-large', ventana: v + 1, ventanasTotales: ventanas.length });
      const o = incorporarModelo(s, v + 1, ventanas.length, f, ctx);
      if (!o.ok) throw new Error(o.code);
      s = o.state;
    }
    return { s, ctx, caseList, doc };
  }
  const enPos = (s: ReviewState, texto: string, sub: string, occ = 0): Detection => {
    let i = -1; for (let k = 0; k <= occ; k++) i = texto.indexOf(sub, i + 1);
    const d = dets(s).find((x) => x.start <= i && x.end >= i + sub.length);
    if (d === undefined) throw new Error(`sin detección en «${sub}» (${occ})`);
    return d;
  };
  const listo = (s: ReviewState): ReviewState => ({ ...s, modelo: { kind: 'terminado', ventanas: 1, respaldo: false } });
  const sinResiduos = (s: ReviewState): ResidueResult => ({ revision: s.revision, ranAt: '2026-10-31T10:00:00.000Z', valuesSearched: 1,
    modes: ['literal'], hits: [], newDetections: 0 });
  const TODAS = { biometricos: true, reservaLegal: true, estrategia: true };
  const grupos = (s: ReviewState): string[][] => {
    const out = new Map<string, string[]>();
    for (const d of dets(s)) out.set(d.entityId, [...(out.get(d.entityId) ?? []), d.text]);
    return [...out.values()];
  };

  // C02-A103: «Prueba» es el apellido de la madre y del hijo; el texto no dice de cuál.
  const TEXTO_C02 = 'ADRIANA PRUEBA TORRES, en nombre de su hijo Nicolás Prueba Mora, presentó la tutela. Debe tenerse en cuenta que Prueba ha actuado siempre de buena fe. Así lo ha manifestado Prueba.';

  it('INV-L03 D-16 la variante que comparten dos personas de la lista queda pendiente y ambigua: sin persona, una entidad por mención, rol OTRA_PERSONA y confianza baja', async () => {
    const { s, caseList } = await tuberia(TEXTO_C02, LISTA_PRUEBA);
    const [adriana, nicolas] = caseList as [CaseEntity, CaseEntity];
    expect(markers(s)).toEqual([['ADRIANA PRUEBA TORRES', '[DEMANDANTE_1]'], ['Nicolás Prueba Mora', '[PACIENTE_1]'], ['Prueba', '[PERSONA_1]'], ['Prueba', '[PERSONA_2]']]);
    const amb = [enPos(s, TEXTO_C02, 'Prueba', 1), enPos(s, TEXTO_C02, 'Prueba', 2)];
    for (const d of amb) {
      expect(d).toMatchObject({ status: 'pendiente', source: 'lista', variantClass: 'apellido_suelto', role: 'OTRA_PERSONA', confidence: 'baja' });
      expect(d.caseEntityId).toBeUndefined();
      expect(d.canonicalKey.startsWith('AMBIGUA:')).toBe(true);
      expect(s.entities[d.entityId]).toMatchObject({ canonicalKey: d.canonicalKey, type: 'PERSONA', role: 'OTRA_PERSONA', mentions: [d.id] });
      expect(s.entities[d.entityId]?.caseEntityId).toBeUndefined();
    }
    expect(amb[0]?.entityId).not.toBe(amb[1]?.entityId);
    // La clave es la del tramo: no lleva texto del documento.
    expect(amb[0]?.canonicalKey.includes('rueba')).toBe(false);
    // La decisión: las dos personas de la lista como candidatas y sus entidades como opciones, con el mensaje M-2001.
    const ent = (id: CaseEntityId): Entity['id'] => (Object.values(s.entities).find((e) => e.caseEntityId === id) as Entity).id;
    expect(decisionesAmbiguas(s, caseList)).toEqual(amb.map((d) => ({ detectionId: d.id, entityId: d.entityId, candidatas: [adriana.id, nicolas.id],
      opciones: [ent(adriana.id), ent(nicolas.id)], fuera: [], mensaje: 'M-2001' })));
    expect(contarAmbiguas(s)).toBe(2);
  });

  it('INV-G06 D-16 la mención ambigua cierra la puerta aunque se acepte; elegir a la persona (unir_entidades, en cualquier sentido), separarla o rechazarla la abre', async () => {
    const { s: s0, ctx, caseList } = await tuberia(TEXTO_C02, LISTA_PRUEBA);
    const [adriana, nicolas] = caseList as [CaseEntity, CaseEntity];
    const entDe = (s: ReviewState, id: CaseEntityId): Entity => Object.values(s.entities).find((e) => e.caseEntityId === id) as Entity;
    const a1 = enPos(s0, TEXTO_C02, 'Prueba', 1);
    const a2 = enPos(s0, TEXTO_C02, 'Prueba', 2);
    let s = listo(s0);
    for (const e of Object.values(s.entities)) s = act(s, { kind: 'aceptar_entidad', entityId: e.id }, ctx);
    // Aceptada pero sin elegir a la persona: sigue contando como pendiente.
    expect(dets(s).every((d) => d.status === 'aceptada')).toBe(true);
    expect(exportGate(s, sinResiduos(s), TODAS)).toEqual({ ok: false, reasons: ['PENDIENTES'] });
    // El revisor elige a Nicolás para la primera: pasa a su entidad y a su marcador.
    s = act(s, { kind: 'unir_entidades', fromId: a1.entityId, intoId: entDe(s, nicolas.id).id }, ctx);
    expect(s.detections[a1.id]?.entityId).toBe(entDe(s, nicolas.id).id);
    expect(s.entities[entDe(s, nicolas.id).id]?.marker).toBe('[PACIENTE_1]');
    expect(exportGate(s, sinResiduos(s), TODAS).ok).toBe(false);
    // Para la segunda, «Unir con otra entidad» desde la ficha de Adriana: la que se mueve es la mención ambigua, no Adriana.
    const antes = entDe(s, adriana.id);
    s = act(s, { kind: 'unir_entidades', fromId: antes.id, intoId: a2.entityId }, ctx);
    expect(entDe(s, adriana.id).id).toBe(antes.id);
    expect(s.entities[antes.id]?.mentions).toEqual([...antes.mentions, a2.id]);
    expect(markers(s).map(([, m]) => m)).toEqual(['[DEMANDANTE_1]', '[PACIENTE_1]', '[PACIENTE_1]', '[DEMANDANTE_1]']);
    expect(contarAmbiguas(s)).toBe(0);
    expect(exportGate(s, sinResiduos(s), TODAS)).toEqual({ ok: true, reasons: [] });
    // Separarla como otra persona o rechazarla también decide.
    let r = act(listo(s0), { kind: 'separar_mencion', detectionId: a1.id }, ctx);
    r = act(r, { kind: 'rechazar', detectionId: a2.id, reason: 'FALSO_POSITIVO' }, ctx);
    expect(r.detections[a1.id]?.canonicalKey).toBe('PER:prueba~sep');
    expect(contarAmbiguas(r)).toBe(0);
    for (const e of Object.values(r.entities)) r = act(r, { kind: 'aceptar_entidad', entityId: e.id }, ctx);
    expect(exportGate(r, sinResiduos(r), TODAS)).toEqual({ ok: true, reasons: [] });
  });

  it('INV-R12 D-16 la mención ambigua cede ante el nombre completo del modelo que la contiene (D-03 B), y la búsqueda de residuos tampoco la asigna', async () => {
    const texto = 'Adriana Prueba Torres y Nicolás Prueba Mora firmaron. Prueba Giraldo, el vecino, declaró. Prueba no vino.';
    const { s: s0 } = await tuberia(texto, LISTA_PRUEBA);
    expect(enPos(s0, texto, 'Prueba', 2).canonicalKey.startsWith('AMBIGUA:')).toBe(true);
    const { s, ctx, caseList } = await tuberia(texto, LISTA_PRUEBA, [[['Prueba Giraldo', 'PER']]]);
    expect(enPos(s, texto, 'Prueba Giraldo')).toMatchObject({ text: 'Prueba Giraldo', source: 'modelo', canonicalKey: 'PER:prueba giraldo' });
    expect(contarAmbiguas(s)).toBe(1);
    // Un candidato de la lista que llega de la búsqueda de residuos con una dueña provisional queda también sin persona.
    const ultima = enPos(s, texto, 'Prueba', 3);
    const r = act(s, { kind: 'rechazar', detectionId: ultima.id }, ctx);
    const c: DetectionCandidate = { partId: ultima.partId, start: ultima.start, end: ultima.end, type: 'PERSONA', role: 'PACIENTE', source: 'lista',
      caseEntityId: (caseList[1] as CaseEntity).id, variantClass: 'apellido_suelto', confidence: 'media', score: 0.6, canonicalKey: `LISTA:${(caseList[1] as CaseEntity).id}` };
    const t = act(r, { kind: 'incorporar_residuos', residueRevision: r.revision, candidates: [c] }, ctx);
    const nueva = dets(t).find((d) => d.start === ultima.start && d.status === 'pendiente') as Detection;
    expect(nueva).toMatchObject({ role: 'OTRA_PERSONA', confidence: 'baja' });
    expect(nueva.caseEntityId).toBeUndefined();
    expect(t.entities[nueva.entityId]?.canonicalKey.startsWith('AMBIGUA:')).toBe(true);
  });

  it('INV-L03 D-16 solo entre personas: entre una persona y una organización de la lista sigue decidiendo 7.9.6 (tratamiento); con una variante apagada no hay ambigüedad', async () => {
    const texto = 'Comercial Prueba S.A.S. y Comercial Prueba firmaron. Luego la señora Prueba llamó.';
    const { s, caseList } = await tuberia(texto, [['Adriana Prueba Torres', 'persona', 'DEMANDANTE'], ['Comercial Prueba S.A.S.', 'organizacion', 'EMPRESA']]);
    const d = enPos(s, texto, 'Prueba', 2);
    expect(d.caseEntityId).toBe((caseList[0] as CaseEntity).id);
    expect(d.canonicalKey).toBe(`LISTA:${(caseList[0] as CaseEntity).id}`);
    expect(contarAmbiguas(s)).toBe(0);
    // El abogado apagó «Prueba» en Nicolás: la variante es solo de Adriana.
    const lista = refreshVariants(LISTA_PRUEBA.map(([nombre, k, r]) => newCaseEntity(nombre, k, r, ids) as CaseEntity));
    const apagada = lista.map((e, i) => (i === 1 ? { ...e, variants: e.variants.map((v) => (v.text === 'Prueba' ? { ...v, enabled: false } : v)) } : e)) as CaseEntity[];
    const doc = mkDoc([['cuerpo', 'Adriana Prueba Torres firmó. Prueba no vino.']]);
    const p = doc.parts[0] as DocumentModel['parts'][number];
    const i = p.text.lastIndexOf('Prueba');
    const cand = (cl: readonly CaseEntity[]): MergedCandidate[] => [
      { partId: p.id, start: 0, end: 21, type: 'PERSONA', role: 'DEMANDANTE', source: 'lista', caseEntityId: (cl[0] as CaseEntity).id, variantClass: 'exacta',
        confidence: 'alta', score: 0.9, canonicalKey: `LISTA:${(cl[0] as CaseEntity).id}`, precedence: 2 },
      { partId: p.id, start: i, end: i + 6, type: 'PERSONA', role: 'DEMANDANTE', source: 'lista', caseEntityId: (cl[0] as CaseEntity).id,
        variantClass: 'apellido_suelto', confidence: 'baja', score: 0.3, canonicalKey: `LISTA:${(cl[0] as CaseEntity).id}`, precedence: 2 }];
    expect(contarAmbiguas(buildReviewState(doc, cand(lista), { table: EMPTY, caseList: lista, ids }))).toBe(1);
    const sa = buildReviewState(doc, cand(apagada), { table: EMPTY, caseList: apagada, ids });
    expect(contarAmbiguas(sa)).toBe(0);
    expect(markers(sa)).toEqual([['Adriana Prueba Torres', '[DEMANDANTE_1]'], ['Prueba', '[DEMANDANTE_1]']]);
  });

  // D-15 · Los casos del modelo que PB-3-r2 dejó aparte, con textos ficticios del mismo patrón.
  const per = (doc: DocumentModel, t: string, occ = 0) => mc(doc, 0, t, { type: 'PERSONA', source: 'modelo', nerLabel: 'PER', canonicalKey: personKey(t), role: 'OTRA_PERSONA' }, occ);
  const org = (doc: DocumentModel, t: string, occ = 0) => mc(doc, 0, t, { type: 'EMPRESA', source: 'modelo', nerLabel: 'ORG', canonicalKey: orgKey(t), role: 'EMPRESA' }, occ);
  const loc = (doc: DocumentModel, t: string, occ = 0) => mc(doc, 0, t, { type: 'LUGAR', source: 'modelo', nerLabel: 'LOC', canonicalKey: canonicalKeyFor('LUGAR', t) }, occ);
  const con = (doc: DocumentModel, cands: MergedCandidate[], caseList: readonly CaseEntity[] = []) =>
    buildReviewState(doc, cands, { table: EMPTY, caseList, ids: seqIds(1000) });
  /** Las mismas candidatas, una ventana del reductor por candidata, en el orden dado (el del texto en el producto). */
  function porVentanas(doc: DocumentModel, cands: MergedCandidate[], caseList: readonly CaseEntity[] = []): ReviewState {
    const ctx: ReviewContext = { table: EMPTY, caseList, doc, ids: seqIds(7000) };
    let s = buildReviewState(doc, cands.filter((c) => c.source !== 'modelo'), { table: EMPTY, caseList, ids: seqIds(1000) });
    const modelo = cands.filter((c) => c.source === 'modelo');
    modelo.forEach((c, v) => {
      const set = buildReviewState(doc, [c], { table: EMPTY, caseList, ids: seqIds(0x5000 + v * 16) });
      s = act(s, { kind: 'incorporar_modelo', ventana: v + 1, ventanasTotales: modelo.length,
        delta: { detections: Object.values(set.detections), entities: Object.values(set.entities), flags: [], suggestions: [] } }, ctx);
    });
    return s;
  }

  it('INV-R12 D-15 C5 la misma forma con otra etiqueta se une: C07-E58, C09-E22, C18-E06, C03-E49 y la lista (C11-E08), al construir y por ventana', () => {
    // C07-E58 · «Papelería Ficticia» etiquetada PER es la ORG del mismo texto.
    let doc = mkDoc([['cuerpo', 'la ambulancia de Papelería Ficticia no llegó. La cotización de Papelería Ficticia Ltda. asciende a dos millones. la ambulancia de Papelería Ficticia no llegó.']]);
    let c = [org(doc, 'Papelería Ficticia'), org(doc, 'Papelería Ficticia Ltda.'), per(doc, 'Papelería Ficticia', 2)];
    for (const s of [con(doc, c), porVentanas(doc, c)]) {
      expect(grupos(s)).toEqual([['Papelería Ficticia', 'Papelería Ficticia Ltda.', 'Papelería Ficticia']]);
      expect(dets(s).map((d) => `${d.type}:${d.role}`)).toEqual(['EMPRESA:EMPRESA', 'EMPRESA:EMPRESA', 'EMPRESA:EMPRESA']);
    }
    // C09-E22 · la forma corta etiquetada ORG («Ficticio⏎Barrera») llega antes de la forma corta PER que S-7.11 une a Héctor Fabio.
    doc = mkDoc([['cuerpo', 'Héctor Fabio Ficticio Barrera declaró. El vehículo es de propiedad de Ficticio\nBarrera, dijo. Luego reportó a Ficticio Barrera como retirado.']]);
    c = [per(doc, 'Héctor Fabio Ficticio Barrera'), org(doc, 'Ficticio\nBarrera'), per(doc, 'Ficticio Barrera', 1)];
    for (const s of [con(doc, c), porVentanas(doc, c)]) {
      expect(grupos(s)).toEqual([['Héctor Fabio Ficticio Barrera', 'Ficticio\nBarrera', 'Ficticio Barrera']]);
      expect(dets(s).map((d) => `${d.type}:${d.confidence}`)).toEqual(['PERSONA:media', 'PERSONA:baja', 'PERSONA:baja']);
    }
    // C18-E06 · la forma corta ORG llega después de la PER, que ya es de Elizabeth.
    doc = mkDoc([['cuerpo', 'Elizabeth Ficticia Valencia firmó. Para constancia Ficticia Valencia lo suscribe. Revisar la T.P. 104 de Ficticia Valencia y el NIT.']]);
    c = [per(doc, 'Elizabeth Ficticia Valencia'), per(doc, 'Ficticia Valencia', 1), org(doc, 'Ficticia Valencia', 2)];
    for (const s of [con(doc, c), porVentanas(doc, c)]) expect(grupos(s)).toEqual([['Elizabeth Ficticia Valencia', 'Ficticia Valencia', 'Ficticia Valencia']]);
    // C03-E49 · «Ficticio» LOC y ORG son uno; no se van con Ricardo Ficticio Ortiz, aunque S-7.11 le unió «el especialista Ficticio».
    doc = mkDoc([['cuerpo', 'el doctor Ricardo Ficticio Ortiz, médico tratante. Un vecino presenció cuando Ficticio negó la atención. El especialista Ficticio prescribió reposo. Otro vecino presenció cuando Ficticio negó la atención.']]);
    c = [per(doc, 'Ricardo Ficticio Ortiz'), loc(doc, 'Ficticio', 1), per(doc, 'Ficticio', 2), org(doc, 'Ficticio', 3)];
    for (const s of [con(doc, c), porVentanas(doc, c)]) {
      expect(grupos(s)).toEqual([['Ricardo Ficticio Ortiz', 'Ficticio'], ['Ficticio', 'Ficticio']]);
      expect(entOf(s, 'Ricardo Ficticio Ortiz').mentions).toHaveLength(2);
    }
    // C11-E08 · la anfitriona es la persona de la lista: la ORG «Ejemplo Orozco» es su forma corta.
    const CAS = 'cas_000000000000000000000000000000d1' as CaseEntityId;
    const lista: CaseEntity[] = [{ id: CAS, name: 'Alejandro Ejemplo', variants: [], kind: 'persona', role: 'DEMANDANTE' }];
    doc = mkDoc([['cuerpo', 'Alejandro Ejemplo Orozco demandó. Ejemplo Orozco nació en 1965. El cobro a nombre de Ejemplo Orozco sigue.']]);
    c = [mc(doc, 0, 'Alejandro Ejemplo Orozco', { type: 'PERSONA', source: 'lista', caseEntityId: CAS, variantClass: 'exacta', canonicalKey: `LISTA:${CAS}`,
      role: 'DEMANDANTE', extended: true }), per(doc, 'Ejemplo Orozco', 1), org(doc, 'Ejemplo Orozco', 2)];
    for (const s of [con(doc, c, lista), porVentanas(doc, c, lista)]) {
      expect(grupos(s)).toEqual([['Alejandro Ejemplo Orozco', 'Ejemplo Orozco', 'Ejemplo Orozco']]);
      expect(markers(s).map(([, m]) => m)).toEqual(['[DEMANDANTE_1]', '[DEMANDANTE_1]', '[DEMANDANTE_1]']);
    }
  });

  it('INV-R12 D-15 C5 no se une con una salvaguarda activa: dos anfitrionas (C06-E38), lugar introducido, marcador pegado, parentesco, sigla, contención ni apellido suelto ajeno', () => {
    // C06-E38 · «Ejemplo Muñoz» lo contienen dos personas (S-7.11): ni la forma PER ni la ORG se unen.
    let doc = mkDoc([['cuerpo', 'Jairo Ejemplo Muñoz firmó. Ejemplo Muñoz pagó. Diana Carolina Ejemplo Muñoz vino. Ejemplo Muñoz cobró.']]);
    let s = con(doc, [per(doc, 'Jairo Ejemplo Muñoz'), per(doc, 'Ejemplo Muñoz', 1), per(doc, 'Diana Carolina Ejemplo Muñoz'), org(doc, 'Ejemplo Muñoz', 3)]);
    expect(grupos(s)).toEqual([['Jairo Ejemplo Muñoz'], ['Ejemplo Muñoz'], ['Diana Carolina Ejemplo Muñoz'], ['Ejemplo Muñoz']]);
    // Un lugar introducido («vive en…»), un marcador pegado, el parentesco y una sigla dejan cada etiqueta aparte.
    doc = mkDoc([['cuerpo', 'Ficticio Barrera firmó. Vive en Ficticio Barrera desde 2001.']]);
    expect(grupos(con(doc, [per(doc, 'Ficticio Barrera'), loc(doc, 'Ficticio Barrera', 1)]))).toHaveLength(2);
    doc = mkDoc([['cuerpo', 'El contrato de Papelería Ficticia llegó. [DEMANDANTE_1] Papelería Ficticia firmó.']]);
    expect(grupos(con(doc, [org(doc, 'Papelería Ficticia'), per(doc, 'Papelería Ficticia', 1)]))).toHaveLength(2);
    doc = mkDoc([['cuerpo', 'Rosa Ficticia Prueba firmó. La tienda de su hija, Rosa Ficticia Prueba, cerró.']]);
    expect(grupos(con(doc, [per(doc, 'Rosa Ficticia Prueba'), org(doc, 'Rosa Ficticia Prueba', 1)]))).toHaveLength(2);
    doc = mkDoc([['cuerpo', 'El CESA certificó la nota. Luego CESA firmó.']]);
    expect(grupos(con(doc, [org(doc, 'CESA'), per(doc, 'CESA', 1)]))).toHaveLength(2);
    // Por contención no: la ORG no es una forma que el texto use para la persona.
    doc = mkDoc([['cuerpo', 'Elizabeth Ficticia Valencia firmó. Revisar la T.P. de Ficticia Valencia.']]);
    expect(grupos(con(doc, [per(doc, 'Elizabeth Ficticia Valencia'), org(doc, 'Ficticia Valencia', 1)]))).toHaveLength(2);
    // Un apellido suelto que S-7.11 ya unió a otra persona no arrastra el mismo apellido con otra etiqueta.
    doc = mkDoc([['cuerpo', 'el doctor Ricardo Ficticio Ortiz firmó. El especialista Ficticio prescribió. Luego Ficticio negó la atención.']]);
    s = con(doc, [per(doc, 'Ricardo Ficticio Ortiz'), per(doc, 'Ficticio', 1), org(doc, 'Ficticio', 2)]);
    expect(grupos(s)).toEqual([['Ricardo Ficticio Ortiz', 'Ficticio'], ['Ficticio']]);
    expect(entOf(s, 'Ricardo Ficticio Ortiz').type).toBe('PERSONA');
  });

  it('D-15 C5 y D-16 son lineales: 40.000 blancos dentro de la forma o antes de la variante no los hacen lentos', () => {
    const blancos = ' '.repeat(40_000);
    const doc = mkDoc([['cuerpo', `Papelería${blancos}Ficticia cotizó. Papelería Ficticia respondió.`]]);
    const t0 = performance.now();
    const s = con(doc, [per(doc, `Papelería${blancos}Ficticia`), org(doc, 'Papelería Ficticia')]);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(grupos(s)).toHaveLength(1);
    const lista = refreshVariants(LISTA_PRUEBA.map(([nombre, k, r]) => newCaseEntity(nombre, k, r, ids) as CaseEntity));
    const t1 = performance.now();
    expect(personasDeLaVariante(`${blancos}Prueba`, lista)).toHaveLength(2);
    expect(performance.now() - t1).toBeLessThan(300);
  });
});

describe('T-MO-06 · PB-3-r4: el parentesco en la oración (A-4), el apellido de otra persona (M-72), D-16 en el modelo y el rastro de unir_entidades (B-92)', () => {
  let n = 0;
  const ids: IdSource = { next: (p) => `${p}_${(0xb0000 + ++n).toString(16).padStart(32, '0')}` };
  const OPC = { referenceDate: '2026-10-30', rulesVersion: '1.0.0', nerHighThreshold: 0.9, nerMinScore: 0.3 };
  type Lista = Array<[string, 'persona' | 'organizacion', Role]>;
  /** La tubería real: `detectar` con la lista del caso y, si hay, una `fusionar` + `incorporar_modelo` por ventana. */
  async function tuberia(texto: string, lista: Lista, ventanas: Array<Array<[string, NerSpan['label'], number?]>> = [],
    antes?: (s: ReviewState, ctx: ReviewContext) => ReviewState) {
    const caseList = refreshVariants(lista.map(([nombre, k, r]) => newCaseEntity(nombre, k, r, ids) as CaseEntity));
    const doc = mkDoc([['cuerpo', texto]]);
    const part = doc.parts[0] as DocumentModel['parts'][number];
    const h = createDetectHandler({ ids });
    const pedir = async (kind: string, payload: unknown): Promise<DetectionSet & { spanEdits?: SpanEdit[] }> => {
      const out: Array<{ kind: string; payload?: { set: DetectionSet & { spanEdits?: SpanEdit[] } } }> = [];
      await h({ v: 1, reqId: `req_${(++n).toString(16).padStart(32, '0')}`, kind, payload }, (m) => out.push(m as (typeof out)[number]));
      const r = out.find((m) => m.kind === 'resultado');
      if (r?.payload === undefined) throw new Error('sin resultado');
      return r.payload.set;
    };
    const set = await pedir('detectar', { sessionId: 'ses_r4', doc, caseList, table: EMPTY, options: OPC });
    let s: ReviewState = { docId: doc.id, revision: 0, detections: Object.fromEntries(set.detections.map((d) => [d.id, d])), order: set.detections.map((d) => d.id),
      entities: Object.fromEntries(set.entities.map((e) => [e.id, e])), suggestions: {}, flags: {}, spanEdits: {}, committed: false, modelo: modeloInicial(false) };
    const ctx: ReviewContext = { table: EMPTY, caseList, doc, ids };
    if (antes !== undefined) s = antes(s, ctx);
    for (let v = 0; v < ventanas.length; v++) {
      const spans: NerSpan[] = (ventanas[v] ?? []).map(([sub, label, occ = 0]) => {
        let i = -1; for (let k = 0; k <= occ; k++) i = texto.indexOf(sub, i + 1);
        if (i < 0) throw new Error(`falta «${sub}»`);
        return { start: i, end: i + sub.length, label, score: 0.95 };
      });
      const f = await pedir('fusionar', { sessionId: 'ses_r4', ner: { [part.id]: spans }, nerEngineId: 'gliner-x-large', ventana: v + 1, ventanasTotales: ventanas.length });
      const o = incorporarModelo(s, v + 1, ventanas.length, f, ctx);
      if (!o.ok) throw new Error(o.code);
      s = o.state;
    }
    return { s, ctx, caseList, doc };
  }
  /** La detección que cubre la aparición `occ` de `sub`. */
  const enPos = (s: ReviewState, texto: string, sub: string, occ = 0): Detection => {
    let i = -1; for (let k = 0; k <= occ; k++) i = texto.indexOf(sub, i + 1);
    const d = dets(s).find((x) => x.start <= i && x.end >= i + sub.length && x.status !== 'rechazada');
    if (d === undefined) throw new Error(`sin detección en «${sub}» (${occ})`);
    return d;
  };
  const marcadorEn = (s: ReviewState, texto: string, sub: string, occ = 0): string | undefined => s.entities[enPos(s, texto, sub, occ).entityId]?.marker;
  const listo = (s: ReviewState): ReviewState => ({ ...s, modelo: { kind: 'terminado', ventanas: 1, respaldo: false } });
  const sinResiduos = (s: ReviewState): ResidueResult => ({ revision: s.revision, ranAt: '2026-10-31T10:00:00.000Z', valuesSearched: 1,
    modes: ['literal'], hits: [], newDetections: 0 });
  const TODAS = { biometricos: true, reservaLegal: true, estrategia: true };
  const aceptarTodo = (s0: ReviewState, ctx: ReviewContext): ReviewState => {
    let s = listo(s0);
    for (const e of Object.values(s.entities)) s = act(s, { kind: 'aceptar_entidad', entityId: e.id }, ctx);
    return s;
  };
  const grupos = (s: ReviewState): string[][] => {
    const out = new Map<string, string[]>();
    for (const d of dets(s)) out.set(d.entityId, [...(out.get(d.entityId) ?? []), d.text]);
    return [...out.values()];
  };

  // ---------------------------------------------------------------- A-4
  /** [inicio, fin) de «Pedro Luis Ejemplo Prueba» (en cualquier caja) en `t`. */
  const pedroLuis = (t: string): [number, number] => {
    const i = t.toLowerCase().indexOf('pedro luis ejemplo prueba');
    return [i, i + 'pedro luis ejemplo prueba'.length];
  };

  it('A-4 marcaOtroTitular: el parentesco o la relación en cualquier lugar de la misma oración, con lo que haya en medio', () => {
    const si = [
      // Las 11 de C1 de la revisión.
      'El padre del demandante, Pedro Luis Ejemplo Prueba, declaró.', 'Su hijo menor de edad Pedro Luis Ejemplo Prueba declaró.',
      'Pedro Luis Ejemplo Prueba, quien es hijo de Pedro Ejemplo, declaró.', 'Su hijo, el menor Pedro Luis Ejemplo Prueba, declaró.',
      'Pedro Luis Ejemplo Prueba, de 10 años, hijo del demandante, declaró.',
      ...['primogénito', 'ahijado', 'pareja', 'compañero', 'progenitor'].map((w) => `Su ${w} Pedro Luis Ejemplo Prueba declaró.`),
      'El hijo del señor Pedro Ejemplo, Pedro Luis Ejemplo Prueba, declaró.',
      // Las demás palabras de la tarjeta y de la revisión, lejos del nombre.
      ...['cónyuge', 'apoderado', 'novia', 'padrino', 'madrina', 'tutora', 'curador', 'acudiente', 'viuda', 'hermanastro', 'progenitora']
        .map((w) => `Su ${w} en este proceso es Pedro Luis Ejemplo Prueba.`),
      // Después del nombre, como objeto: la persona de la lista puede ser el padre.
      'Comparece Pedro Luis Ejemplo Prueba en representación de su padre.',
      // Un salto de línea del PDF, MAYÚSCULAS, abreviaturas e iniciales no cortan la oración.
      'El padre del demandante,\nPedro Luis Ejemplo Prueba, declaró.', 'EL PADRE DEL DEMANDANTE, PEDRO LUIS EJEMPLO PRUEBA, DECLARÓ.',
      'Su hijo, identificado con C.C. 1000000001 ante la Sra. Ana, Pedro Luis Ejemplo Prueba, declaró.',
      'Pedro Luis Ejemplo Prueba firmó en la Cra. 7 No. 10-20 junto a su esposa.',
      // El parentesco pegado detrás, como un sufijo del nombre.
      'Pedro Luis Ejemplo Prueba Hijo firmó.',
    ];
    const no = [
      // D-13: sin parentesco, o con el parentesco en otra oración.
      'El señor Pedro Luis Ejemplo Prueba declaró.', 'El hijo del accionante vino. Pedro Luis Ejemplo Prueba dijo que sí.',
      'Pedro Luis Ejemplo Prueba firmó. Su hijo vino después.', '¿Vino su hijo? Pedro Luis Ejemplo Prueba no lo sabe.',
      'PEDRO LUIS EJEMPLO PRUEBA FIRMÓ\n\nEL HIJO DEL DEMANDANTE VINO', 'Pedro Luis Ejemplo Prueba firmó en la Cra. 7 No. 10. El hijo vino.',
      // Un «;» separa a las personas de una enumeración.
      'Comparecen Ana Ficticia Rojas, en nombre de su hija; Pedro Luis Ejemplo Prueba, en nombre propio.',
      // Homógrafos y palabras que son parte de un nombre propio.
      'Pedro Luis Ejemplo Prueba cobró la prima de servicios, la prima de navidad y la prima técnica.',
      'Pedro Luis Ejemplo Prueba compró la materia prima.', 'Pedro Luis Ejemplo Prueba firmó con Carlos Prueba Nieto y con Distribuidora Hermanos Prueba S.A.S.',
    ];
    for (const t of si) expect(marcaOtroTitular(t, ...pedroLuis(t)), t).toBe(true);
    for (const t of no) expect(marcaOtroTitular(t, ...pedroLuis(t)), t).toBe(false);
  });

  it('A-4 marcaOtroTitular mira ventanas fijas: 40.000 caracteres antes y después no la hacen lenta', () => {
    const textos = [`${'x '.repeat(20_000)}Pedro Luis Ejemplo Prueba${' y'.repeat(20_000)}`, `${'a'.repeat(40_000)} Pedro Luis Ejemplo Prueba ${'.'.repeat(40_000)}`,
      `${'Sr. '.repeat(10_000)}Pedro Luis Ejemplo Prueba${' hijo'.repeat(10_000)}`];
    const t0 = performance.now();
    for (const t of textos) marcaOtroTitular(t, ...pedroLuis(t));
    expect(performance.now() - t0).toBeLessThan(300);
    expect(marcaOtroTitular(textos[2] as string, ...pedroLuis(textos[2] as string))).toBe(true);
  });

  // Las 16 sondas de la revisión (P0-6a · PB-3-r2, A-4), con la lista «Pedro Ejemplo» (DEMANDANTE) y el texto «Pedro Ejemplo demandó.»
  // delante: 11 por C1 y 3 por la regla E (antes, las 14 recibían [DEMANDANTE_1]) y las 2 que ya quedaban aparte. Y la de otro nombre de pila.
  const LISTA_PEDRO: Lista = [['Pedro Ejemplo', 'persona', 'DEMANDANTE']];
  const SONDAS: Array<[string, string, string]> = [
    ['C1 · padre del demandante', 'El padre del demandante, Pedro Luis Ejemplo Prueba, declaró.', 'Pedro Luis Ejemplo Prueba'],
    ['C1 · hijo menor de edad', 'Su hijo menor de edad Pedro Luis Ejemplo Prueba declaró.', 'Pedro Luis Ejemplo Prueba'],
    ['C1 · quien es hijo de', 'Pedro Luis Ejemplo Prueba, quien es hijo de Pedro Ejemplo, declaró.', 'Pedro Luis Ejemplo Prueba'],
    ['C1 · su hijo, el menor', 'Su hijo, el menor Pedro Luis Ejemplo Prueba, declaró.', 'Pedro Luis Ejemplo Prueba'],
    ['C1 · de 10 años, hijo del demandante', 'Pedro Luis Ejemplo Prueba, de 10 años, hijo del demandante, declaró.', 'Pedro Luis Ejemplo Prueba'],
    ['C1 · primogénito', 'Su primogénito Pedro Luis Ejemplo Prueba declaró.', 'Pedro Luis Ejemplo Prueba'],
    ['C1 · ahijado', 'Su ahijado Pedro Luis Ejemplo Prueba declaró.', 'Pedro Luis Ejemplo Prueba'],
    ['C1 · pareja', 'Su pareja Pedro Luis Ejemplo Prueba declaró.', 'Pedro Luis Ejemplo Prueba'],
    ['C1 · compañero', 'Su compañero Pedro Luis Ejemplo Prueba declaró.', 'Pedro Luis Ejemplo Prueba'],
    ['C1 · progenitor', 'Su progenitor Pedro Luis Ejemplo Prueba declaró.', 'Pedro Luis Ejemplo Prueba'],
    ['C1 · el hijo del señor', 'El hijo del señor Pedro Ejemplo, Pedro Luis Ejemplo Prueba, declaró.', 'Pedro Luis Ejemplo Prueba'],
    ['regla E · padre del demandante', 'El padre del demandante, Pedro Ejemplo Prueba, declaró.', 'Pedro Ejemplo Prueba'],
    ['regla E · hijo menor de edad', 'Su hijo menor de edad Pedro Ejemplo Prueba declaró.', 'Pedro Ejemplo Prueba'],
    ['regla E · quien es hijo de', 'Pedro Ejemplo Prueba, quien es hijo de Pedro Ejemplo, declaró.', 'Pedro Ejemplo Prueba'],
    ['C1 · padre del accionante (ya aparte)', 'Pedro Luis Ejemplo Prueba, padre del accionante, declaró.', 'Pedro Luis Ejemplo Prueba'],
    ['C1 · SU HIJO MENOR (ya aparte)', 'SU HIJO MENOR PEDRO LUIS EJEMPLO PRUEBA DECLARÓ.', 'PEDRO LUIS EJEMPLO PRUEBA'],
    ['otro nombre de pila', 'Su hija de crianza Pedra Luisa Ejemplo Prueba declaró.', 'Pedra Luisa Ejemplo Prueba'],
  ];
  it.each(SONDAS)('INV-R12 A-4 sonda «%s» con la tubería real: el pariente tiene su propio marcador, nunca el de la persona de la lista', async (_id, sonda, tramo) => {
    const texto = `Pedro Ejemplo demandó. ${sonda}`;
    const { s, caseList } = await tuberia(texto, LISTA_PEDRO, [[[tramo, 'PER', 0]]]);
    const pedro = (caseList[0] as CaseEntity).id;
    expect(marcadorEn(s, texto, 'Pedro Ejemplo')).toBe('[DEMANDANTE_1]');
    // El nombre del pariente entra entero en una sola detección, con una entidad que no es la de la lista.
    const i = texto.indexOf(tramo);
    const d = enPos(s, texto, tramo);
    expect([d.start <= i, d.end >= i + tramo.length]).toEqual([true, true]);
    expect(s.entities[d.entityId]?.caseEntityId).toBeUndefined();
    expect(s.entities[d.entityId]?.marker).toMatch(/^\[PERSONA_[0-9]+\]$/u);
    // Ninguna detección dentro del nombre del pariente lleva a la persona de la lista.
    const dentro = dets(s).filter((x) => x.start < i + tramo.length && i < x.end && x.status !== 'rechazada');
    expect(dentro.map((x) => s.entities[x.entityId]?.caseEntityId === pedro)).toEqual(dentro.map(() => false));
  });

  it('INV-R12 A-4 controles de D-13 con la tubería real: sin parentesco, o con el parentesco en otra oración, el nombre completo es de la persona de la lista', async () => {
    for (const [sonda, tramo] of [['El señor Pedro Luis Ejemplo Prueba declaró.', 'Pedro Luis Ejemplo Prueba'],
      ['El hijo del accionante vino. Pedro Luis Ejemplo Prueba dijo que sí.', 'Pedro Luis Ejemplo Prueba'],
      ['Pedro Ejemplo Prueba declaró.', 'Pedro Ejemplo Prueba']] as const) {
      const texto = `Pedro Ejemplo demandó. ${sonda}`;
      const { s } = await tuberia(texto, LISTA_PEDRO, [[[tramo, 'PER', 0]]]);
      expect(marcadorEn(s, texto, tramo), sonda).toBe('[DEMANDANTE_1]');
    }
  });

  it('A-4 al construir (sin ventanas): C1 tampoco une al pariente que la oración presenta como tal', () => {
    const CAS_P = 'cas_000000000000000000000000000000c4' as CaseEntityId;
    const lista: CaseEntity[] = [{ id: CAS_P, name: 'Pedro Ejemplo', variants: [], kind: 'persona', role: 'DEMANDANTE' }];
    for (const [sonda, tramo] of SONDAS.slice(0, 11).map(([, t, x]) => [t, x] as const)) {
      const doc = mkDoc([['cuerpo', `Pedro Ejemplo demandó. ${sonda}`]]);
      const s = buildReviewState(doc, [mc(doc, 0, 'Pedro Ejemplo', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_P, variantClass: 'exacta',
        canonicalKey: `LISTA:${CAS_P}`, role: 'DEMANDANTE' }), mc(doc, 0, tramo, { type: 'PERSONA', source: 'modelo', nerLabel: 'PER', canonicalKey: personKey(tramo),
        role: 'OTRA_PERSONA' })], { table: EMPTY, caseList: lista, ids: seqIds(1000) });
      expect(entOf(s, tramo).caseEntityId, sonda).toBeUndefined();
    }
  });

  // ---------------------------------------------------------------- M-72
  const LISTA_ANA: Lista = [['Ana Ficticia Rojas', 'persona', 'DEMANDANTE']];
  // Apariciones de «Rojas»: 0 en Ana Ficticia Rojas, 1 en Luis Ficticio Rojas, 2 en «El señor Rojas».
  const TEXTO_M72 = 'Ana Ficticia Rojas demandó a Luis Ficticio Rojas. El señor Rojas declaró.';

  it('INV-L03 INV-R12 M-72 el apellido suelto de la lista que también lleva otra persona del texto queda ambiguo, con o sin tramo del modelo en él', async () => {
    type Ventanas = Array<Array<[string, NerSpan['label'], number?]>>;
    const casos: Ventanas[] = [[[['Luis Ficticio Rojas', 'PER', 0]]], [[['Luis Ficticio Rojas', 'PER', 0], ['Rojas', 'PER', 2]]], [[['Luis Ficticio Rojas', 'PER', 0]], [['Rojas', 'PER', 2]]]];
    for (const ventanas of casos) {
      const { s, caseList } = await tuberia(TEXTO_M72, LISTA_ANA, ventanas);
      const ana = (caseList[0] as CaseEntity).id;
      expect(marcadorEn(s, TEXTO_M72, 'Ana Ficticia Rojas')).toBe('[DEMANDANTE_1]');
      // Antes, «Rojas» recibía [DEMANDANTE_1], el marcador de Ana, con confianza media.
      const d = enPos(s, TEXTO_M72, 'Rojas', 2);
      expect(esAmbigua(s, d)).toBe(true);
      expect(d).toMatchObject({ status: 'pendiente', source: 'lista', variantClass: 'apellido_suelto', role: 'OTRA_PERSONA', confidence: 'baja' });
      expect(d.caseEntityId).toBeUndefined();
      expect(s.entities[d.entityId]?.marker).not.toBe('[DEMANDANTE_1]');
      // Las opciones del revisor: Ana (de la lista) y Luis Ficticio Rojas (fuera de ella).
      const luis = enPos(s, TEXTO_M72, 'Luis Ficticio Rojas').entityId;
      const anaEnt = (Object.values(s.entities).find((e) => e.caseEntityId === ana) as Entity).id;
      expect(decisionesAmbiguas(s, caseList).find((x) => x.detectionId === d.id)).toMatchObject({ candidatas: [ana], opciones: [anaEnt], fuera: [luis] });
    }
  });

  it('INV-G06 M-72 la mención ambigua cierra la puerta; el revisor la da a la otra persona con unir_entidades y la puerta se abre', async () => {
    const { s: s0, ctx } = await tuberia(TEXTO_M72, LISTA_ANA, [[['Luis Ficticio Rojas', 'PER', 0]]]);
    const d = enPos(s0, TEXTO_M72, 'Rojas', 2);
    let s = aceptarTodo(s0, ctx);
    expect(exportGate(s, sinResiduos(s), TODAS)).toEqual({ ok: false, reasons: ['PENDIENTES'] });
    const luis = enPos(s, TEXTO_M72, 'Luis Ficticio Rojas').entityId;
    s = act(s, { kind: 'unir_entidades', fromId: d.entityId, intoId: luis }, ctx);
    expect(s.detections[d.id]?.entityId).toBe(luis);
    expect(marcadorEn(s, TEXTO_M72, 'Rojas', 2)).toBe(marcadorEn(s, TEXTO_M72, 'Luis Ficticio Rojas'));
    expect(exportGate(s, sinResiduos(s), TODAS)).toEqual({ ok: true, reasons: [] });
  });

  it('INV-R12 M-72 no hay ambigüedad sin otra persona, con una forma corta de la misma persona ni con una mención que el revisor ya decidió', async () => {
    let texto = 'Ana Ficticia Rojas demandó. El señor Rojas declaró.';
    let r = await tuberia(texto, LISTA_ANA, [[['Ana Ficticia Rojas', 'PER', 0]]]);
    expect(marcadorEn(r.s, texto, 'Rojas', 1)).toBe('[DEMANDANTE_1]');
    // «Ana Rojas» es una forma corta de la persona de la lista, no otra persona.
    texto = 'Ana Ficticia Rojas demandó. Ana Rojas firmó. El señor Rojas declaró.';
    r = await tuberia(texto, LISTA_ANA, [[['Ana Rojas', 'PER', 0]]]);
    expect(marcadorEn(r.s, texto, 'Rojas', 2)).toBe('[DEMANDANTE_1]');
    // Si el revisor ya decidió la mención antes de que llegue «Luis Ficticio Rojas», la ventana no la toca. M-82 b (CIERRE-1): sin
    // el modelo ya es ambigua («Ficticio Rojas» en el texto es otra persona); el revisor la da a Ana con unir_entidades y la acepta.
    r = await tuberia(TEXTO_M72, LISTA_ANA, [[['Luis Ficticio Rojas', 'PER', 0]]], (s, ctx) => {
      const x = enPos(s, TEXTO_M72, 'Rojas', 2);
      const ana = Object.values(s.entities).find((e) => e.caseEntityId !== undefined) as Entity;
      return act(act(s, { kind: 'unir_entidades', fromId: x.entityId, intoId: ana.id }, ctx), { kind: 'aceptar', detectionId: x.id }, ctx);
    });
    const d = enPos(r.s, TEXTO_M72, 'Rojas', 2);
    expect([esAmbigua(r.s, d), d.status, marcadorEn(r.s, TEXTO_M72, 'Rojas', 2)]).toEqual([false, 'aceptada', '[DEMANDANTE_1]']);
  });

  it('INV-L03 M-72 al construir y en la búsqueda de residuos: la mención no se asigna a la persona de la lista', async () => {
    const CAS = 'cas_000000000000000000000000000000c5' as CaseEntityId;
    const lista = refreshVariants([{ id: CAS, name: 'Ana Ficticia Rojas', variants: [], kind: 'persona', role: 'DEMANDANTE' }]);
    const doc = mkDoc([['cuerpo', TEXTO_M72]]);
    const lst = (t: string, cls: 'exacta' | 'apellido_suelto', occ = 0) => mc(doc, 0, t, { type: 'PERSONA', source: 'lista', caseEntityId: CAS,
      variantClass: cls, canonicalKey: `LISTA:${CAS}`, role: 'DEMANDANTE' }, occ);
    const s = buildReviewState(doc, [lst('Ana Ficticia Rojas', 'exacta'), mc(doc, 0, 'Luis Ficticio Rojas', { type: 'PERSONA', source: 'modelo', nerLabel: 'PER',
      canonicalKey: personKey('Luis Ficticio Rojas'), role: 'OTRA_PERSONA' }), lst('Rojas', 'apellido_suelto', 2)], { table: EMPTY, caseList: lista, ids: seqIds(1000) });
    expect(esAmbigua(s, enPos(s, TEXTO_M72, 'Rojas', 2))).toBe(true);
    // Rechazada y vuelta a encontrar por la búsqueda de residuos con la persona de la lista: otra vez ambigua.
    const { s: s1, ctx, caseList } = await tuberia(TEXTO_M72, LISTA_ANA, [[['Luis Ficticio Rojas', 'PER', 0]]]);
    const d = enPos(s1, TEXTO_M72, 'Rojas', 2);
    const rr = act(s1, { kind: 'rechazar', detectionId: d.id }, ctx);
    const ana = caseList[0] as CaseEntity;
    const c: DetectionCandidate = { partId: d.partId, start: d.start, end: d.end, type: 'PERSONA', role: 'DEMANDANTE', source: 'lista', caseEntityId: ana.id,
      variantClass: 'apellido_suelto', confidence: 'media', score: 0.6, canonicalKey: `LISTA:${ana.id}` };
    const t = act(rr, { kind: 'incorporar_residuos', residueRevision: rr.revision, candidates: [c] }, ctx);
    const nueva = dets(t).find((x) => x.start === d.start && x.status === 'pendiente') as Detection;
    expect(nueva.caseEntityId).toBeUndefined();
    expect(esAmbigua(t, nueva)).toBe(true);
  });

  // ---------------------------------------------------------------- D-16 en el modelo
  const per = (doc: DocumentModel, t: string, occ = 0) => mc(doc, 0, t, { type: 'PERSONA', source: 'modelo', nerLabel: 'PER', canonicalKey: personKey(t), role: 'OTRA_PERSONA' }, occ);
  const con = (doc: DocumentModel, cands: MergedCandidate[], caseList: readonly CaseEntity[] = []) =>
    buildReviewState(doc, cands, { table: EMPTY, caseList, ids: seqIds(1000) });
  /** Las mismas candidatas, una ventana del reductor por candidata, en el orden dado. */
  function porVentanas(doc: DocumentModel, cands: MergedCandidate[], caseList: readonly CaseEntity[] = []): { s: ReviewState; ctx: ReviewContext } {
    const ctx: ReviewContext = { table: EMPTY, caseList, doc, ids: seqIds(7000) };
    let s = buildReviewState(doc, cands.filter((c) => c.source !== 'modelo'), { table: EMPTY, caseList, ids: seqIds(1000) });
    const modelo = cands.filter((c) => c.source === 'modelo');
    modelo.forEach((c, v) => {
      const set = buildReviewState(doc, [c], { table: EMPTY, caseList, ids: seqIds(0x5000 + v * 16) });
      s = act(s, { kind: 'incorporar_modelo', ventana: v + 1, ventanasTotales: modelo.length,
        delta: { detections: Object.values(set.detections), entities: Object.values(set.entities), flags: [], suggestions: [] } }, ctx);
    });
    return { s, ctx };
  }
  const TEXTO_C07 = 'Rafael Prueba Cuervo firmó. Marta Prueba Ruiz revisó. Luego Prueba aprobó el plan.';

  it('INV-R12 D-16 en el modelo (C07-E47, C08-E20): la forma corta con dos anfitrionas queda ambigua, al construir y por ventana; con una sola, se une', () => {
    const doc = mkDoc([['cuerpo', TEXTO_C07]]);
    const cands = [per(doc, 'Rafael Prueba Cuervo'), per(doc, 'Marta Prueba Ruiz'), per(doc, 'Prueba', 2)];
    for (const s of [con(doc, cands), porVentanas(doc, cands).s]) {
      const d = enPos(s, TEXTO_C07, 'Prueba', 2);
      // Antes: «Prueba» quedaba como una persona más, con su propio marcador y sin decisión del revisor.
      expect(esAmbigua(s, d)).toBe(true);
      expect(d).toMatchObject({ status: 'pendiente', source: 'modelo', role: 'OTRA_PERSONA', confidence: 'baja' });
      expect(d.canonicalKey.startsWith('AMBIGUA:') && !d.canonicalKey.includes('rueba')).toBe(true);
      const [rafael, marta] = [enPos(s, TEXTO_C07, 'Rafael Prueba Cuervo').entityId, enPos(s, TEXTO_C07, 'Marta Prueba Ruiz').entityId];
      const x = decisionesAmbiguas(s, []).find((y) => y.detectionId === d.id);
      expect(x).toMatchObject({ candidatas: [], opciones: [], mensaje: 'M-2001' });
      expect([...(x?.fuera ?? [])].sort()).toEqual([rafael, marta].sort());
    }
    // Con una sola anfitriona, S-7.11 la une como siempre.
    const t1 = 'Rafael Prueba Cuervo firmó. Luego Prueba aprobó el plan.';
    const d1 = mkDoc([['cuerpo', t1]]);
    const s1 = con(d1, [per(d1, 'Rafael Prueba Cuervo'), per(d1, 'Prueba', 1)]);
    expect(grupos(s1)).toEqual([['Rafael Prueba Cuervo', 'Prueba']]);
    expect(esAmbigua(s1, enPos(s1, t1, 'Prueba', 1))).toBe(false);
  });

  it('INV-G06 D-16 en el modelo: la forma corta ambigua cierra la puerta aunque se acepte; el revisor elige la anfitriona y la puerta se abre', () => {
    const doc = mkDoc([['cuerpo', TEXTO_C07]]);
    const { s: s0, ctx } = porVentanas(doc, [per(doc, 'Rafael Prueba Cuervo'), per(doc, 'Marta Prueba Ruiz'), per(doc, 'Prueba', 2)]);
    const d = enPos(s0, TEXTO_C07, 'Prueba', 2);
    let s = aceptarTodo(s0, ctx);
    expect(exportGate(s, sinResiduos(s), TODAS)).toEqual({ ok: false, reasons: ['PENDIENTES'] });
    const rafael = enPos(s, TEXTO_C07, 'Rafael Prueba Cuervo').entityId;
    s = act(s, { kind: 'unir_entidades', fromId: rafael, intoId: d.entityId }, ctx);   // desde cualquiera de las dos fichas
    expect(s.detections[d.id]?.entityId).toBe(rafael);
    expect(exportGate(s, sinResiduos(s), TODAS)).toEqual({ ok: true, reasons: [] });
    // Separarla como otra persona también decide.
    const r = act(aceptarTodo(s0, ctx), { kind: 'separar_mencion', detectionId: d.id }, ctx);
    expect(exportGate(act(r, { kind: 'aceptar', detectionId: d.id }, ctx), sinResiduos(r), TODAS).reasons).not.toContain('PENDIENTES');
  });

  it('INV-R12 D-16 en el modelo (C06-E38): por ventana, la forma corta que llega con dos anfitrionas queda ambigua; la que ya se unió a la primera se queda', () => {
    const texto = 'Jairo Ejemplo Muñoz firmó. Ejemplo Muñoz pagó. Diana Carolina Ejemplo Muñoz vino. Ejemplo Muñoz cobró.';
    const doc = mkDoc([['cuerpo', texto]]);
    // Apariciones de «Ejemplo Muñoz»: 0 en Jairo, 1 suelta, 2 en Diana Carolina, 3 suelta.
    const { s } = porVentanas(doc, [per(doc, 'Jairo Ejemplo Muñoz'), per(doc, 'Ejemplo Muñoz', 1), per(doc, 'Diana Carolina Ejemplo Muñoz'), per(doc, 'Ejemplo Muñoz', 3)]);
    const jairo = enPos(s, texto, 'Jairo Ejemplo Muñoz').entityId;
    expect(enPos(s, texto, 'Ejemplo Muñoz', 1).entityId).toBe(jairo);
    const d = enPos(s, texto, 'Ejemplo Muñoz', 3);
    expect(esAmbigua(s, d)).toBe(true);
    expect([...(decisionesAmbiguas(s, []).find((x) => x.detectionId === d.id)?.fuera ?? [])].sort())
      .toEqual([jairo, enPos(s, texto, 'Diana Carolina Ejemplo Muñoz').entityId].sort());
  });

  it('INV-L03 D-16 en el modelo: entre una persona de la lista y una del modelo, las dos son opciones (la de la lista en `opciones`, la otra en `fuera`)', () => {
    const CAS = 'cas_000000000000000000000000000000c6' as CaseEntityId;
    const lista: CaseEntity[] = [{ id: CAS, name: 'Martha Ejemplo', variants: [], kind: 'persona', role: 'DEMANDANTE' }];
    const texto = 'Martha Cecilia Ejemplo Ortiz demandó. Luis Ejemplo Ortiz contestó. Ejemplo Ortiz firmó.';
    const doc = mkDoc([['cuerpo', texto]]);
    const s = con(doc, [per(doc, 'Martha Cecilia Ejemplo Ortiz'), per(doc, 'Luis Ejemplo Ortiz'), per(doc, 'Ejemplo Ortiz', 2)], lista);
    const martha = enPos(s, texto, 'Martha Cecilia Ejemplo Ortiz');
    expect(s.entities[martha.entityId]?.caseEntityId).toBe(CAS);   // C1, como siempre
    const d = enPos(s, texto, 'Ejemplo Ortiz', 2);
    expect(esAmbigua(s, d)).toBe(true);
    expect(decisionesAmbiguas(s, lista).find((x) => x.detectionId === d.id)).toMatchObject({ candidatas: [CAS], opciones: [martha.entityId],
      fuera: [enPos(s, texto, 'Luis Ejemplo Ortiz').entityId] });
  });

  // ---------------------------------------------------------------- B-92
  it('INV-R12 B-92 unir_entidades, aceptar y restablecer cada mención, y otra ventana: el grupo que hizo el usuario no se mueve', () => {
    const texto = 'Pagó Papelería Ficticia. Cotizó Ferretería Prueba. El taller Papelería Ficticia respondió, el taller Papelería Ficticia facturó y el taller Papelería Ficticia cobró.';
    const doc = mkDoc([['cuerpo', texto]]);
    const org = (t: string, occ = 0) => mc(doc, 0, t, { type: 'EMPRESA', source: 'modelo', nerLabel: 'ORG', canonicalKey: orgKey(t), role: 'EMPRESA' }, occ);
    const ctx: ReviewContext = { table: EMPTY, caseList: [], doc, ids: seqIds(9000) };
    const ventana = (s: ReviewState, v: number, cs: MergedCandidate[]): ReviewState => {
      const set = buildReviewState(doc, cs, { table: EMPTY, caseList: [], ids: seqIds(0x6000 + v * 64) });
      return act(s, { kind: 'incorporar_modelo', ventana: v, ventanasTotales: 3,
        delta: { detections: Object.values(set.detections), entities: Object.values(set.entities), flags: [], suggestions: [] } }, ctx);
    };
    const s1 = ventana(buildReviewState(doc, [], { table: EMPTY, caseList: [], ids: seqIds(1000) }), 1, [org('Papelería Ficticia'), org('Ferretería Prueba')]);
    const [pap, fer] = [enPos(s1, texto, 'Papelería Ficticia'), enPos(s1, texto, 'Ferretería Prueba')];
    let u = act(s1, { kind: 'unir_entidades', fromId: fer.entityId, intoId: pap.entityId }, ctx);
    // Antes: restablecer borraba el `decidedBy` de la unión y la mención volvía a ser movible.
    for (const d of [pap, fer]) u = act(act(u, { kind: 'aceptar', detectionId: d.id }, ctx), { kind: 'restablecer', detectionId: d.id }, ctx);
    for (const d of [pap, fer]) expect(u.detections[d.id]).toMatchObject({ status: 'pendiente', decidedBy: 'grupo' });
    expect(u.detections[pap.id]?.canonicalKey).toBe(`${orgKey('Papelería Ficticia')}~ent`);
    assertR05(u);
    const s2 = ventana(u, 2, [0, 1, 2].map((k) => org('taller Papelería Ficticia', k)));
    expect(grupos(s2)).toEqual([['Papelería Ficticia', 'Ferretería Prueba'], ['taller Papelería Ficticia', 'taller Papelería Ficticia', 'taller Papelería Ficticia']]);
    expect(s2.entities[pap.entityId]?.marker).toBe(u.entities[pap.entityId]?.marker);
    // La clave de la entidad no cambia: la tabla del asunto la sigue reconociendo.
    expect(s2.entities[pap.entityId]?.canonicalKey).toBe(orgKey('Papelería Ficticia'));
  });

  // ================================================================ CIERRE-1 (D-19): M-80, M-81, M-82, M-72 con `nombre_suelto` y B-100
  /** Una aposición larga, sin punto ni relación: más de 370 caracteres entre el parentesco y el nombre (X10 a X12 de la revisión). */
  const APOSICION = Array.from({ length: 6 }, (_, i) => `quien para la fecha ${i + 1} de los hechos residía en la vereda Ficticia de Villa Ejemplo`).join(', ');
  /** El texto de la salida (render con los marcadores de la vista previa). */
  const salida = (s: ReviewState, doc: DocumentModel): string => render(doc, s).sections.map((x) => x.text).join('\n');

  it('M-80 marcaOtroTitular: el parentesco cuenta en toda la oración, también a más de 320 caracteres del nombre (X10, X11 y X12)', () => {
    expect(APOSICION.length).toBeGreaterThan(370);
    const si = [
      `El padre del demandante, ${APOSICION}, Pedro Luis Ejemplo Prueba, declaró.`,
      `Pedro Luis Ejemplo Prueba, ${APOSICION}, es el padre del demandante.`,
      `Su hijo, ${APOSICION}, Pedro Luis Ejemplo Prueba, declaró.`,
    ];
    // D-13: el parentesco de otra oración sigue sin contar, aunque la oración sea larga.
    const no = [`El padre del demandante vino. Q${APOSICION.slice(1)}, Pedro Luis Ejemplo Prueba, declaró.`,
      `Pedro Luis Ejemplo Prueba, ${APOSICION}, declaró. El padre del demandante vino.`];
    for (const t of si) expect(marcaOtroTitular(t, ...pedroLuis(t)), t.slice(0, 40)).toBe(true);
    for (const t of no) expect(marcaOtroTitular(t, ...pedroLuis(t)), t.slice(0, 40)).toBe(false);
  });

  it.each([
    ['X10 · antes', `El padre del demandante, ${APOSICION}, Pedro Luis Ejemplo Prueba, declaró.`, 'Pedro Luis Ejemplo Prueba'],
    ['X11 · después', `Pedro Luis Ejemplo Prueba, ${APOSICION}, es el padre del demandante.`, 'Pedro Luis Ejemplo Prueba'],
    ['X12 · regla E', `El padre del demandante, ${APOSICION}, Pedro Ejemplo Prueba, declaró.`, 'Pedro Ejemplo Prueba'],
  ])('INV-R12 M-80 sonda %s con la tubería real: el pariente lejos del parentesco tiene su propio marcador', async (_id, sonda, tramo) => {
    const texto = `Pedro Ejemplo demandó. ${sonda}`;
    const { s, caseList } = await tuberia(texto, LISTA_PEDRO, [[[tramo, 'PER', 0]]]);
    const i = texto.indexOf(tramo);
    const dentro = dets(s).filter((x) => x.start < i + tramo.length && i < x.end && x.status !== 'rechazada');
    expect(dentro.length).toBeGreaterThan(0);
    expect(dentro.map((x) => s.entities[x.entityId]?.caseEntityId === (caseList[0] as CaseEntity).id)).toEqual(dentro.map(() => false));
    expect(marcadorEn(s, texto, tramo)).toMatch(/^\[PERSONA_[0-9]+\]$/u);
  });

  it('M-80 tiempo: la oración sin fin dentro del tope alto (4.000) y 40.000 caracteres alrededor no hacen lenta a marcaOtroTitular', () => {
    const sinFin = `${'palabra '.repeat(5_000)}Pedro Luis Ejemplo Prueba${' palabra'.repeat(5_000)}`;
    const textos = [sinFin, `${'x '.repeat(20_000)}Pedro Luis Ejemplo Prueba${' y'.repeat(20_000)}`, `${'Sr. '.repeat(10_000)}Pedro Luis Ejemplo Prueba${' su amigo'.repeat(5_000)}`];
    const t0 = performance.now();
    for (let k = 0; k < 20; k++) for (const t of textos) marcaOtroTitular(t, ...pedroLuis(t));
    expect(performance.now() - t0).toBeLessThan(1_500);
    // El tope es constante: la relación a más de 4.000 caracteres de la misma «oración» ya no se mira.
    const lejos = `Su hijo ${'palabra '.repeat(600)}Pedro Luis Ejemplo Prueba declaró.`;
    expect(marcaOtroTitular(lejos, ...pedroLuis(lejos))).toBe(false);
  });

  it('M-81 marcaOtroTitular: las relaciones de representación y de trato ligadas a otra persona («su», «de», «del») la marcan como otro titular', () => {
    const si = [
      // Sonda R de la revisión.
      'Pedro Luis Ejemplo Prueba, actuando como agente oficioso de Pedro Ejemplo, presentó la acción.',
      'Pedro Luis Ejemplo Prueba, en representación de Pedro Ejemplo, presentó la acción.',
      'Pedro Luis Ejemplo Prueba, a nombre del señor Pedro Ejemplo, presentó la acción.',
      'Pedro Luis Ejemplo Prueba, en nombre y representación de Pedro Ejemplo, presentó la acción.',
      'Pedro Luis Ejemplo Prueba, en nombre de su padre, presentó la acción.',
      // X13 a X20.
      ...['agente oficioso', 'representante', 'abogado', 'amigo', 'vecino', 'compadre', 'socio', 'cuidadora', 'empleado', 'jefe', 'mandatario']
        .map((w) => `Su ${w} Pedro Luis Ejemplo Prueba declaró.`),
      'El abogado del demandante, Pedro Luis Ejemplo Prueba, declaró.', 'La amiga de la accionante, Pedro Luis Ejemplo Prueba, declaró.',
      'SU AMIGO PEDRO LUIS EJEMPLO PRUEBA DECLARÓ.',
    ];
    const no = [
      // La misma persona presentada por su oficio o su domicilio, no ligada a otra.
      'El abogado Pedro Luis Ejemplo Prueba declaró.', 'Pedro Luis Ejemplo Prueba, vecino de esta ciudad, declaró.',
      'Pedro Luis Ejemplo Prueba, jefa de talento humano, firmó.', 'Pedro Luis Ejemplo Prueba, representante legal de Ejemplo S.A.S., firmó.',
      'Pedro Luis Ejemplo Prueba, en nombre propio, presentó la acción.', 'El cobro a nombre de Pedro Luis Ejemplo Prueba sigue.',
      'Pedro Luis Ejemplo Prueba acudió a la Defensoría del Pueblo y al Defensor del Pueblo.',
      'Pedro Luis Ejemplo Prueba firmó con Carlos Amigo Prueba.',
    ];
    for (const t of si) expect(marcaOtroTitular(t, ...pedroLuis(t)), t).toBe(true);
    for (const t of no) expect(marcaOtroTitular(t, ...pedroLuis(t)), t).toBe(false);
  });

  it.each([
    ['R · agente oficioso de', 'Pedro Luis Ejemplo Prueba, actuando como agente oficioso de Pedro Ejemplo, presentó la acción.', 'Pedro Luis Ejemplo Prueba'],
    ['R · en representación de', 'Pedro Luis Ejemplo Prueba, en representación de Pedro Ejemplo, presentó la acción.', 'Pedro Luis Ejemplo Prueba'],
    ['R · a nombre del señor', 'Pedro Luis Ejemplo Prueba, a nombre del señor Pedro Ejemplo, presentó la acción.', 'Pedro Luis Ejemplo Prueba'],
    ['X13 · su amigo', 'Su amigo Pedro Luis Ejemplo Prueba declaró.', 'Pedro Luis Ejemplo Prueba'],
    ['X15 · su compadre', 'Su compadre Pedro Luis Ejemplo Prueba declaró.', 'Pedro Luis Ejemplo Prueba'],
    ['X16 · su abogado', 'Su abogado Pedro Luis Ejemplo Prueba declaró.', 'Pedro Luis Ejemplo Prueba'],
    ['X19 · su socio', 'Su socio Pedro Luis Ejemplo Prueba declaró.', 'Pedro Luis Ejemplo Prueba'],
    ['X20 · su amigo, regla E', 'Su amigo Pedro Ejemplo Prueba declaró.', 'Pedro Ejemplo Prueba'],
  ])('INV-R12 M-81 sonda %s con la tubería real: el representante o el amigo no recibe el marcador de la persona de la lista', async (_id, sonda, tramo) => {
    const texto = `Pedro Ejemplo demandó. ${sonda}`;
    const { s, caseList } = await tuberia(texto, LISTA_PEDRO, [[[tramo, 'PER', 0]]]);
    expect(marcadorEn(s, texto, 'Pedro Ejemplo')).toBe('[DEMANDANTE_1]');
    const i = texto.indexOf(tramo);
    const dentro = dets(s).filter((x) => x.start < i + tramo.length && i < x.end && x.status !== 'rechazada');
    expect(dentro.map((x) => s.entities[x.entityId]?.caseEntityId === (caseList[0] as CaseEntity).id)).toEqual(dentro.map(() => false));
    expect(marcadorEn(s, texto, tramo)).toMatch(/^\[PERSONA_[0-9]+\]$/u);
  });

  it('INV-L03 M-82 a: la variante de los dos apellidos de la lista que también lleva otra persona del modelo queda ambigua (M10 y M11)', async () => {
    for (const texto of ['Ana Ficticia Rojas demandó a su hermano Luis Ficticia Rojas. El señor Ficticia Rojas declaró.',
      'Ana Ficticia Rojas demandó a Luis Ficticia Rojas. El señor Ficticia Rojas declaró.']) {
      const { s, caseList } = await tuberia(texto, LISTA_ANA, [[['Luis Ficticia Rojas', 'PER', 0]]]);
      // Apariciones de «Ficticia Rojas»: 0 en Ana, 1 en Luis, 2 en «El señor Ficticia Rojas». Antes: [DEMANDANTE_1].
      const d = enPos(s, texto, 'Ficticia Rojas', 2);
      expect(esAmbigua(s, d), texto).toBe(true);
      expect(d.variantClass).toBe('apellidos');
      expect(s.entities[d.entityId]?.marker).not.toBe('[DEMANDANTE_1]');
      const luis = enPos(s, texto, 'Luis Ficticia Rojas').entityId;
      expect(decisionesAmbiguas(s, caseList).find((x) => x.detectionId === d.id)?.fuera).toEqual([luis]);
      expect(marcadorEn(s, texto, 'Ana Ficticia Rojas')).toBe('[DEMANDANTE_1]');
    }
  });

  it('INV-L03 M-82 b: sin el modelo, el nombre de pila pegado delante del apellido de la lista es otra persona: la mención y las demás de ese apellido quedan ambiguas (M06 y M07)', async () => {
    for (const texto of ['Ana Ficticia Rojas demandó a Luis Rojas. El señor Rojas declaró.',
      'Ana Ficticia Rojas demandó a su hermano Luis Rojas. El señor Rojas declaró.']) {
      const { s, doc } = await tuberia(texto, LISTA_ANA);
      // Antes: «Luis [DEMANDANTE_1]» y «El señor [DEMANDANTE_1]».
      for (const occ of [1, 2]) {
        const d = enPos(s, texto, 'Rojas', occ);
        expect(esAmbigua(s, d), `${texto} ${occ}`).toBe(true);
        expect(s.entities[d.entityId]?.marker).not.toBe('[DEMANDANTE_1]');
      }
      const out = salida(s, doc);
      expect(out.startsWith('[DEMANDANTE_1] demandó')).toBe(true);
      expect(out).not.toMatch(/Luis \[DEMANDANTE_1\]|señor \[DEMANDANTE_1\]/u);
      expect(contarAmbiguas(s)).toBe(2);
    }
  });

  it('INV-L03 M-82 b controles: un tratamiento, un rol, la propia persona o un segundo nombre que la lista no trae no hacen ambiguo el apellido', async () => {
    for (const texto of ['Ana Ficticia Rojas demandó. La señora Rojas declaró. La Demandante Rojas firmó.',
      'Ana Ficticia Rojas demandó. Ana Rojas firmó. El señor Rojas declaró.',
      'Ana Lucía Ficticia Rojas demandó. El señor Rojas declaró.']) {
      const { s } = await tuberia(texto, LISTA_ANA);
      expect(contarAmbiguas(s), texto).toBe(0);
      expect(marcadorEn(s, texto, 'Rojas', 1), texto).toBe('[DEMANDANTE_1]');
    }
    // «Blanca Nubia Prueba-Ejemplo» con «Blanca Prueba-Ejemplo» en la lista: Nubia es un segundo nombre de la misma persona.
    const texto = 'Blanca Nubia Prueba-Ejemplo demandó. Prueba-Ejemplo declaró.';
    const { s } = await tuberia(texto, [['Blanca Prueba-Ejemplo', 'persona', 'DEMANDANTE']]);
    expect(contarAmbiguas(s)).toBe(0);
  });

  it('INV-L03 M-72 con `nombre_suelto` (D-18): el nombre de pila de la lista que también lleva otra persona del texto queda ambiguo, con o sin el modelo', async () => {
    const texto = 'Ana Ficticia Rojas demandó. Ana Lucía Prueba declaró. Ana firmó el acta.';
    // Con el modelo en «Ana Lucía Prueba»: la otra persona es una opción de fuera. Sin él: «Lucía» pegada detrás.
    for (const ventanas of [[[['Ana Lucía Prueba', 'PER', 0]]], []] as Array<Array<Array<[string, NerSpan['label'], number?]>>>) {
      const { s, caseList } = await tuberia(texto, LISTA_ANA, ventanas);
      const d = enPos(s, texto, 'Ana', 2);
      expect(d.variantClass).toBe('nombre_suelto');
      expect(esAmbigua(s, d)).toBe(true);
      expect(s.entities[d.entityId]?.marker).not.toBe('[DEMANDANTE_1]');
      if (ventanas.length > 0) {
        expect(decisionesAmbiguas(s, caseList).find((x) => x.detectionId === d.id)?.fuera).toEqual([enPos(s, texto, 'Ana Lucía Prueba').entityId]);
      }
    }
    // Control: la misma persona («Ana Rojas») no es otra.
    const t2 = 'Ana Ficticia Rojas demandó. Ana Rojas declaró. Ana firmó el acta.';
    const r = await tuberia(t2, LISTA_ANA, [[['Ana Rojas', 'PER', 0]]]);
    expect(esAmbigua(r.s, enPos(r.s, t2, 'Ana', 2))).toBe(false);
  });

  it('INV-G06 M-82 la ambigua sin opciones se decide separándola; la de fuera, uniéndola a la otra persona', async () => {
    const texto = 'Ana Ficticia Rojas demandó a Luis Rojas. El señor Rojas declaró.';
    const { s: s0, ctx } = await tuberia(texto, LISTA_ANA);
    let s = aceptarTodo(s0, ctx);
    expect(exportGate(s, sinResiduos(s), TODAS)).toEqual({ ok: false, reasons: ['PENDIENTES'] });
    const ana = (Object.values(s.entities).find((e) => e.caseEntityId !== undefined) as Entity).id;
    s = act(s, { kind: 'separar_mencion', detectionId: enPos(s, texto, 'Rojas', 1).id }, ctx);
    s = act(s, { kind: 'unir_entidades', fromId: enPos(s, texto, 'Rojas', 2).entityId, intoId: ana }, ctx);
    s = aceptarTodo(s, ctx);
    expect(exportGate(s, sinResiduos(s), TODAS)).toEqual({ ok: true, reasons: [] });
    expect(marcadorEn(s, texto, 'Rojas', 2)).toBe('[DEMANDANTE_1]');
  });

  it('B-100 (T6 y T7) con la tubería real: el tratamiento delante de una variante débil de la lista entra en el tramo', async () => {
    const lista: Lista = [['Gloria Ficticia Mora', 'persona', 'DEMANDANTE']];
    for (const [texto, tramo] of [['Gloria Ficticia Mora demandó. Vino la señora Ficticia y firmó.', 'señora Ficticia'],
      ['Gloria Ficticia Mora demandó. Vino doña Gloria y firmó.', 'doña Gloria'], ['Gloria Ficticia Mora demandó. Vino Doña Gloria y firmó.', 'Doña Gloria']] as const) {
      const { s, doc } = await tuberia(texto, lista);
      // Antes: «Vino la señora [DEMANDANTE_1]», «Vino doña [DEMANDANTE_1]».
      expect(enPos(s, texto, tramo).text).toBe(tramo);
      expect(salida(s, doc)).toContain(`Vino ${tramo.startsWith('señora') ? 'la ' : ''}[DEMANDANTE_1] y firmó.`);
    }
  });

  it('INV-R12 B-100 la variante débil con su tratamiento sigue cediendo ante el nombre completo de otra persona del modelo', async () => {
    const texto = 'Gloria Ficticia Mora demandó. Vino la señora Ficticia Prueba y firmó.';
    const { s, caseList } = await tuberia(texto, [['Gloria Ficticia Mora', 'persona', 'DEMANDANTE']], [[['Ficticia Prueba', 'PER', 0]]]);
    const d = enPos(s, texto, 'Ficticia Prueba');
    expect(d.text).toBe('señora Ficticia Prueba');
    expect(s.entities[d.entityId]?.caseEntityId).not.toBe((caseList[0] as CaseEntity).id);
    const i = texto.indexOf('señora Ficticia Prueba');
    expect(dets(s).filter((x) => x.start < i + 22 && i < x.end && x.status !== 'rechazada')).toHaveLength(1);
  });
});
