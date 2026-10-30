// T-MO-11 (parte PB-3) · Marcador neutro [DOCUMENTO_n] para TI, CE, PPT y PEP: INV-E05, INV-R09, INV-R10 y C-15 a C-18. Solo datos ficticios.
import { describe, expect, it } from 'vitest';
import { applyReviewAction, buildReviewState, familyFor, precedenceOf, type ReviewContext } from '../../src/core/entities.ts';
import type {
  DataType, Detection, DocId, DocumentModel, Entity, Flag, FlagId, IdSource, MergedCandidate, PartId, ReviewState, Suggestion, TableIndex,
} from '../../src/core/types.ts';

const DOC = 'doc_00000000000000000000000000000077' as DocId;
const PART = 'prt_00000000000000000000000000000077' as PartId;
const EMPTY: TableIndex = { byKey: {}, counters: {}, documentCount: 0 };
const seqIds = (start: number): IdSource => { let n = start; return { next: (p) => `${p}_${(n++).toString(16).padStart(32, '0')}` }; };
const mkDoc = (text: string): DocumentModel => ({ id: DOC, label: 'Documento 1', source: 'pegado', metadata: {} as DocumentModel['metadata'],
  warnings: [], parts: [{ id: PART, docId: DOC, kind: 'cuerpo', label: 'Cuerpo', order: 0, index: 1, text, included: true }] });
/** Candidato de regla sobre `sub`, con rótulo `label` justo antes si se da. */
function cand(text: string, sub: string, type: DataType, key: string, label?: string, occ = 0): MergedCandidate {
  let i = -1;
  for (let k = 0; k <= occ; k++) i = text.indexOf(sub, i + 1);
  const l = label === undefined ? undefined : text.lastIndexOf(label, i);
  const c: Omit<MergedCandidate, 'precedence'> = { partId: PART, start: i, end: i + sub.length, type, source: 'regla', confidence: 'alta', score: 0.9, canonicalKey: key,
    ...(l === undefined ? {} : { label: { labelId: 'L.DOC', start: l, end: l + (label as string).length } }) };
  return { ...c, precedence: precedenceOf(c) };
}
const ctxOf = (doc: DocumentModel, table: TableIndex = EMPTY): ReviewContext => ({ table, caseList: [], doc, ids: seqIds(9000) });
const build = (doc: DocumentModel, cands: MergedCandidate[], table: TableIndex = EMPTY, flags: Flag[] = []) =>
  buildReviewState(doc, cands, { table, caseList: [], ids: seqIds(100), flags });
const dets = (s: ReviewState): Detection[] => s.order.map((id) => s.detections[id] as Detection);
const entOf = (s: ReviewState, i: number): Entity => s.entities[(dets(s)[i] as Detection).entityId] as Entity;
function act(s: ReviewState, a: Parameters<typeof applyReviewAction>[1], ctx: ReviewContext): ReviewState {
  const r = applyReviewAction(s, a, ctx);
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
/** Texto de salida mínimo (6.4.3, 6.4.7): ediciones de tramo y detecciones no rechazadas ni cubiertas, de derecha a izquierda. */
function output(doc: DocumentModel, s: ReviewState): string {
  const text = (doc.parts[0] as DocumentModel['parts'][number]).text;
  const repl: Array<{ start: number; end: number; text: string }> = Object.values(s.spanEdits).map((e) => ({ start: e.span.start, end: e.span.end, text: e.text }));
  for (const d of dets(s)) {
    if (d.status === 'rechazada' || d.coveredBy !== undefined) continue;
    const marker = s.entities[d.entityId]?.marker ?? '';
    repl.push({ start: d.start, end: d.end, text: d.status === 'editada' ? d.replacement.edited as string
      : (d.replacement.generalized?.template ?? d.replacement.proposedTemplate).split('{m}').join(marker) });
  }
  let out = text;
  for (const r of repl.sort((a, b) => b.start - a.start)) out = out.slice(0, r.start) + r.text + out.slice(r.end);
  return out;
}

describe('T-MO-11 · marcador neutro (6.2.1, 6.4.4, 6.4.5)', () => {
  it('INV-E05 familyFor da DOCUMENTO para TI, CE, PPT y PEP salvo con marcadorEspecifico; los demás tipos ignoran la opción', () => {
    for (const t of ['TI', 'CE', 'PPT', 'PEP'] as const) {
      expect(familyFor(t)).toBe('DOCUMENTO');
      expect(familyFor(t, undefined, { marcadorEspecifico: false })).toBe('DOCUMENTO');
      expect(familyFor(t, undefined, { marcadorEspecifico: true })).toBe(t);
    }
    expect(familyFor('CC', undefined, { marcadorEspecifico: true })).toBe('CC');
    expect(familyFor('DOCUMENTO', undefined, { marcadorEspecifico: true })).toBe('DOCUMENTO');
  });

  it.each([['TI', 'T.I.'], ['CE', 'C.E.'], ['PPT', 'PPT'], ['PEP', 'PEP']] as const)(
    'INV-R09 %s con rótulo nace en DOCUMENTO con ROTULO_DOCUMENTO_A_GENERICO aplicada', (type, label) => {
      const doc = mkDoc(`${label} 1000000001 del menor`);
      const s = build(doc, [cand(doc.parts[0]?.text as string, '1000000001', type, `${type}:1000000001`, label)]);
      expect(entOf(s, 0)).toMatchObject({ type, family: 'DOCUMENTO', marcadorEspecifico: false, marker: '[DOCUMENTO_1]' });
      const sug = Object.values(s.suggestions);
      expect(sug).toMatchObject([{ kind: 'ROTULO_DOCUMENTO_A_GENERICO', status: 'aplicada', chosenOptionId: 'o1', originalText: label }]);
      expect(Object.values(s.spanEdits)).toMatchObject([{ originalText: label, text: 'documento de identidad', origin: { kind: 'sugerencia', suggestionId: sug[0]?.id } }]);
      expect(output(doc, s)).toBe('documento de identidad [DOCUMENTO_1] del menor');
    });

  it('INV-R09 sin rótulo: [DOCUMENTO_1] sin sugerencia; la salida de «T.I. 1000000001» es «documento de identidad [DOCUMENTO_1]»', () => {
    let doc = mkDoc('número 1000000001');
    let s = build(doc, [cand('número 1000000001', '1000000001', 'TI', 'TI:1000000001')]);
    expect(Object.values(s.suggestions)).toEqual([]);
    expect(output(doc, s)).toBe('número [DOCUMENTO_1]');
    doc = mkDoc('T.I. 1000000001');
    s = build(doc, [cand('T.I. 1000000001', '1000000001', 'TI', 'TI:1000000001', 'T.I.')]);
    expect(output(doc, s)).toBe('documento de identidad [DOCUMENTO_1]');
  });

  it('INV-R10 especificar_documento ida y vuelta: «T.I. [TI_1]» y regreso a un estado igual salvo revision', () => {
    const doc = mkDoc('T.I. 1000000001 del menor');
    const s0 = build(doc, [cand('T.I. 1000000001 del menor', '1000000001', 'TI', 'TI:1000000001', 'T.I.')]);
    const e = entOf(s0, 0);
    const d0 = dets(s0)[0] as Detection;
    const s1 = act(s0, { kind: 'especificar_documento', entityId: e.id, especifico: true }, ctxOf(doc));
    expect(s1.entities[e.id]).toMatchObject({ family: 'TI', marcadorEspecifico: true, marker: '[TI_1]' });
    expect(Object.values(s1.suggestions)[0]?.status).toBe('descartada');
    expect(s1.spanEdits).toEqual({});
    expect(output(doc, s1)).toBe('T.I. [TI_1] del menor');
    expect(s1.detections[d0.id]).toMatchObject({ type: 'TI', canonicalKey: 'TI:1000000001', status: 'pendiente' });
    const s2 = act(s1, { kind: 'especificar_documento', entityId: e.id, especifico: false }, ctxOf(doc));
    expect(output(doc, s2)).toBe('documento de identidad [DOCUMENTO_1] del menor');
    expect({ ...s2, revision: 0 }).toEqual({ ...s0, revision: 0 });
    expect(s2.revision).toBe(s0.revision + 2);
    expect(act(s0, { kind: 'especificar_documento', entityId: e.id, especifico: false }, ctxOf(doc))).toEqual({ ...s0, revision: 1 });
  });

  it('INV-R10 errores: sobre una CC → TIPO_NO_PERMITIDO; con el marcador ya en la tabla del asunto → ROL_FIJADO_EN_ASUNTO', () => {
    const doc = mkDoc('CC 1000000017 y T.I. 1000000001');
    const t = 'CC 1000000017 y T.I. 1000000001';
    const s = build(doc, [cand(t, '1000000017', 'CC', 'CC:1000000017'), cand(t, '1000000001', 'TI', 'TI:1000000001', 'T.I.')]);
    expect(applyReviewAction(s, { kind: 'especificar_documento', entityId: entOf(s, 0).id, especifico: true }, ctxOf(doc)))
      .toEqual({ ok: false, code: 'TIPO_NO_PERMITIDO' });
    const table: TableIndex = { byKey: { 'TI:1000000001': '[DOCUMENTO_2]' }, counters: { DOCUMENTO: 2 }, documentCount: 1 };
    const st = build(doc, [cand(t, '1000000017', 'CC', 'CC:1000000017'), cand(t, '1000000001', 'TI', 'TI:1000000001', 'T.I.')], table);
    expect(applyReviewAction(st, { kind: 'especificar_documento', entityId: entOf(st, 1).id, especifico: true }, ctxOf(doc, table)))
      .toEqual({ ok: false, code: 'ROL_FIJADO_EN_ASUNTO' });
  });

  it('C-15 y C-16 TI y CE sin acción: [DOCUMENTO_1] y [DOCUMENTO_2]; especificar la TI → [TI_1] y la CE pasa a [DOCUMENTO_1]', () => {
    const t = 'T.I. 1000000002 y C.E. 123456';
    const doc = mkDoc(t);
    const s = build(doc, [cand(t, '1000000002', 'TI', 'TI:1000000002', 'T.I.'), cand(t, '123456', 'CE', 'CE:123456', 'C.E.')]);
    expect([entOf(s, 0).marker, entOf(s, 1).marker]).toEqual(['[DOCUMENTO_1]', '[DOCUMENTO_2]']);
    expect(dets(s).map((d) => d.type)).toEqual(['TI', 'CE']);
    const s16 = act(s, { kind: 'especificar_documento', entityId: entOf(s, 0).id, especifico: true }, ctxOf(doc));
    expect([entOf(s16, 0).marker, entOf(s16, 1).marker]).toEqual(['[TI_1]', '[DOCUMENTO_1]']);
    expect(output(doc, s16)).toBe('T.I. [TI_1] y documento de identidad [DOCUMENTO_1]');
  });

  it('C-17 la tabla del asunto fija la especificidad: [TI_1] hereda específico; [DOCUMENTO_2] queda neutro y fijo', () => {
    const t = 'T.I. 1000000002';
    const doc = mkDoc(t);
    const spec: TableIndex = { byKey: { 'TI:1000000002': '[TI_1]' }, counters: { TI: 1 }, documentCount: 1 };
    const a = build(doc, [cand(t, '1000000002', 'TI', 'TI:1000000002', 'T.I.')], spec);
    expect(entOf(a, 0)).toMatchObject({ marker: '[TI_1]', markerState: 'heredado', marcadorEspecifico: true, family: 'TI' });
    expect(Object.values(a.suggestions)).toEqual([]);
    expect(output(doc, a)).toBe('T.I. [TI_1]');
    const neutral: TableIndex = { byKey: { 'TI:1000000002': '[DOCUMENTO_2]' }, counters: { DOCUMENTO: 2 }, documentCount: 1 };
    const b = build(doc, [cand(t, '1000000002', 'TI', 'TI:1000000002', 'T.I.')], neutral);
    expect(entOf(b, 0)).toMatchObject({ marker: '[DOCUMENTO_2]', marcadorEspecifico: false });
    expect(output(doc, b)).toBe('documento de identidad [DOCUMENTO_2]');
    expect(applyReviewAction(b, { kind: 'especificar_documento', entityId: entOf(b, 0).id, especifico: true }, ctxOf(doc, neutral)))
      .toEqual({ ok: false, code: 'ROL_FIJADO_EN_ASUNTO' });
  });

  it('C-18 TI y DOCUMENTO con el mismo número: dos entidades [DOCUMENTO_1] y [DOCUMENTO_2] unidas por sameHolderAs', () => {
    const t = 'T.I. 1000000002 y registro civil 1000000002';
    const doc = mkDoc(t);
    const s = build(doc, [cand(t, '1000000002', 'TI', 'TI:1000000002', 'T.I.'), cand(t, '1000000002', 'DOCUMENTO', 'DOCUMENTO:1000000002', undefined, 1)]);
    const [ti, rc] = [entOf(s, 0), entOf(s, 1)];
    expect([ti.marker, rc.marker]).toEqual(['[DOCUMENTO_1]', '[DOCUMENTO_2]']);
    expect(ti.sameHolderAs).toEqual([rc.id]);
    expect(rc.sameHolderAs).toEqual([ti.id]);
  });

  it('INV-R09 la sugerencia preaplicada que trae generalize.ts reemplaza a la propia: una sola, con su id y su edición de tramo', () => {
    const t = 'T.I. 1000000001 del menor';
    const doc = mkDoc(t);
    const sugId = 'sug_000000000000000000000000000000e1' as Suggestion['id'];
    const pg4: Suggestion = { id: sugId, kind: 'ROTULO_DOCUMENTO_A_GENERICO', target: { kind: 'tramo', span: { partId: PART, start: 0, end: 4 } },
      originalText: 'T.I.', options: [{ id: 'o1', kind: 'ROTULO_DOCUMENTO_A_GENERICO', template: 'documento de identidad' }], status: 'aplicada', chosenOptionId: 'o1' };
    const flag: Flag = { id: 'flg_000000000000000000000000000000e2' as FlagId, type: 'MENOR', span: { partId: PART, start: 0, end: 4 }, text: 'T.I.',
      reason: 'ROTULO_TI', suggestionId: sugId, options: [], acknowledged: false };
    const c = [cand(t, '1000000001', 'TI', 'TI:1000000001', 'T.I.')];
    const s = buildReviewState(doc, c, { table: EMPTY, caseList: [], ids: seqIds(100), suggestions: [pg4], flags: [flag] });
    expect(Object.keys(s.suggestions)).toEqual([sugId]);
    expect(s.suggestions[sugId]).toMatchObject({ status: 'aplicada', chosenOptionId: 'o1', target: { relatedDetectionId: s.order[0] } });
    expect(Object.values(s.spanEdits)).toHaveLength(1);
    expect(s.flags[flag.id]?.suggestionId).toBe(sugId);
    expect(output(doc, s)).toBe('documento de identidad [DOCUMENTO_1] del menor');
    const spec: TableIndex = { byKey: { 'TI:1000000001': '[TI_1]' }, counters: { TI: 1 }, documentCount: 1 };
    const h = buildReviewState(doc, c, { table: spec, caseList: [], ids: seqIds(100), suggestions: [pg4], flags: [flag] });
    expect(h.suggestions[sugId]?.status).toBe('descartada');
    expect(output(doc, h)).toBe('T.I. [TI_1] del menor');
  });

  it('INV-R09 la bandera MENOR con ROTULO_TI nace sin confirmar y se vincula a la sugerencia; mantener restituye el rótulo', () => {
    const t = 'T.I. 1000000001 del menor';
    const doc = mkDoc(t);
    const flag: Flag = { id: 'flg_00000000000000000000000000000071' as FlagId, type: 'MENOR', span: { partId: PART, start: 0, end: 4 }, text: 'T.I.',
      reason: 'ROTULO_TI', options: [], acknowledged: false };
    const s = build(doc, [cand(t, '1000000001', 'TI', 'TI:1000000001', 'T.I.')], EMPTY, [flag]);
    const sug = Object.values(s.suggestions)[0];
    expect(s.flags[flag.id]).toMatchObject({ acknowledged: false, suggestionId: sug?.id, detectionId: s.order[0] });
    const spec = act(s, { kind: 'especificar_documento', entityId: entOf(s, 0).id, especifico: true }, ctxOf(doc));
    expect(spec.flags[flag.id]?.acknowledged).toBe(false);
    const keep = act(s, { kind: 'resolver_bandera', flagId: flag.id, resolution: 'mantener' }, ctxOf(doc));
    expect(keep.flags[flag.id]).toMatchObject({ acknowledged: true, resolution: 'mantener' });
    expect(output(doc, keep)).toBe('T.I. [DOCUMENTO_1] del menor');
    const back = act(keep, { kind: 'resolver_bandera', flagId: flag.id, resolution: 'reemplazar' }, ctxOf(doc));
    expect(output(doc, back)).toBe('documento de identidad [DOCUMENTO_1] del menor');
  });
});
