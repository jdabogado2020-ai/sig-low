// T-MO-06 · Claves, agrupación, numeración, tabla por asunto y reductor (plan 6.4.4, 6.6, 7.12). Solo datos ficticios.
import { describe, expect, it } from 'vitest';
import {
  applyReviewAction, buildReviewState, canonicalKeyFor, consolidate, cryptoIds, emptyTable, esSiglaSilabica, nitCheckDigit, nitKey, orgKey,
  palabrasDeNombre, personKey, phoneKey, precedenceOf, tableIndexOf, type ReviewContext,
} from '../../src/core/entities.ts';
import type {
  AsuntoId, CaseEntity, CaseEntityId, DataType, Detection, DetectionSet, DocId, DocumentModel, Entity, Flag, FlagId, IdSource, MappingTable,
  MergedCandidate, PartId, PartKind, ReviewAction, ReviewState, SpanEdit, SpanEditId, Suggestion, SuggestionId, TableIndex,
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

  it('C2 sigla silábica de una organización de la lista: «FESA» es Ferretería Ejemplo S.A.S.; las iniciales solas no, y con dos candidatas tampoco', () => {
    expect(esSiglaSilabica('fesa', ['ferreteria', 'ejemplo'], 'sas')).toBe(true);
    expect(esSiglaSilabica('copsa', ['constructora', 'prueba'], 'sa')).toBe(true);
    expect(esSiglaSilabica('dipru', ['distribuidora', 'prueba'], 'yciasenc')).toBe(true);
    expect(esSiglaSilabica('tefi', ['textiles', 'ficticios'], 'sas')).toBe(true);
    expect(esSiglaSilabica('agex', ['agroindustrias', 'ejemplo'], 'sa')).toBe(false);   // «EX» no sale del nombre
    expect(esSiglaSilabica('eps', ['ejemplo', 'prueba', 'salud'], '')).toBe(false);     // iniciales: la sigla de 7.9.4
    expect(esSiglaSilabica('fesa', ['ferreteria'], '')).toBe(false);
    const doc = mkDoc([['cuerpo', 'Ferretería Ejemplo S.A.S. contrató. FESA pagó y FESA firmó.']]);
    const cands = [mc(doc, 0, 'Ferretería Ejemplo S.A.S.', { type: 'EMPRESA', source: 'lista', caseEntityId: CAS_F, variantClass: 'exacta', canonicalKey: `LISTA:${CAS_F}` }),
      org(doc, 'FESA'), org(doc, 'FESA', 1)];
    let s = con(doc, cands, [empresa(CAS_F, 'Ferretería Ejemplo S.A.S.')]);
    expect(grupos(s)).toEqual([['Ferretería Ejemplo S.A.S.', 'FESA', 'FESA']]);
    expect(entOf(s, 'FESA').marker).toBe('[EMPRESA_1]');
    s = con(doc, cands, [empresa(CAS_F, 'Ferretería Ejemplo S.A.S.'), empresa(CAS_X, 'Fábrica Ejemplo S.A.')]);
    expect(grupos(s)).toEqual([['Ferretería Ejemplo S.A.S.'], ['FESA', 'FESA']]);
  });

  it('C3 mismo núcleo con otra etiqueta o con una palabra común delante: una sola entidad; EPS e IPS siguen aparte (C-12)', () => {
    let doc = mkDoc([['cuerpo', 'la ambulancia de Papelería Ficticia no llegó; Papelería Ficticia Ltda. cotizó y la Papelería Ficticia respondió.']]);
    let s = con(doc, [org(doc, 'Papelería Ficticia'), org(doc, 'Papelería Ficticia Ltda.'), per(doc, 'Papelería Ficticia', 2)]);
    expect(grupos(s)).toEqual([['Papelería Ficticia', 'Papelería Ficticia Ltda.', 'Papelería Ficticia']]);
    expect(dets(s).map((d) => d.type)).toEqual(['EMPRESA', 'EMPRESA', 'EMPRESA']);
    doc = mkDoc([['cuerpo', 'cuando Ficticio negó la atención y luego Ficticio volvió a negarla']]);
    s = con(doc, [loc(doc, 'Ficticio'), org(doc, 'Ficticio', 1)]);
    expect(grupos(s)).toEqual([['Ficticio', 'Ficticio']]);
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
    expect(grupos(s)).toEqual([['Santiago Prueba Rojas', 'Prueba Rojas', 'Prueba Rojas']]);
    expect(dets(s).map((d) => `${d.type}:${d.confidence}`)).toEqual(['PERSONA:media', 'PERSONA:baja', 'PERSONA:baja']);
    // Una forma hecha solo de palabras del nombre de la lista es una variante: la busca la lista, no la correferencia.
    const d2 = mkDoc([['cuerpo', 'Ana Ficticia Rojas declaró. Rojas (otra persona) no vino.']]);
    const s2 = con(d2, [mc(d2, 0, 'Ana Ficticia Rojas', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, variantClass: 'exacta', canonicalKey: `LISTA:${CAS_A}` }),
      per(d2, 'Rojas', 1)], CASES);
    expect(grupos(s2)).toEqual([['Ana Ficticia Rojas'], ['Rojas']]);
  });

  it('C4 S-7.11 entre etiquetas: una ORG de nombre contenida en una sola persona es esa persona; con sufijo, con palabra común o dentro de otra organización, no', () => {
    let doc = mkDoc([['cuerpo', 'Elizabeth Ficticia Valencia firmó. Revisar la T.P. de Ficticia Valencia.']]);
    let s = con(doc, [per(doc, 'Elizabeth Ficticia Valencia'), org(doc, 'Ficticia Valencia')]);
    expect(grupos(s)).toEqual([['Elizabeth Ficticia Valencia', 'Ficticia Valencia']]);
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
    // El modelo etiquetó ORG el nombre del correo: el usuario del correo dice que es una persona.
    s = con(doc, [org(doc, 'Prueba Giraldo'), per(doc, 'Sergio')]);
    expect(grupos(s)).toEqual([['Prueba Giraldo', 'Sergio']]);
    expect(entOf(s, 'Sergio')).toMatchObject({ type: 'PERSONA', canonicalKey: 'PER:prueba giraldo' });
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
    // C0: con una segunda candidata («Diana Carolina…») la forma corta nueva ya no tiene una sola anfitriona por S-7.11, pero su clave
    // ya está en la entidad de Iván Darío: una unión hecha no se deshace y el mismo texto lleva el mismo marcador.
    const s3 = w(s2, 3, [['Diana Carolina Ejemplo Salazar', 0], ['Ejemplo Salazar', 4]]);
    expect(grupos(s3)).toEqual([['Ejemplo Salazar', 'Iván Darío Ejemplo Salazar', 'Ejemplo Salazar', 'Ejemplo Salazar'], ['Diana Carolina Ejemplo Salazar']]);
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
