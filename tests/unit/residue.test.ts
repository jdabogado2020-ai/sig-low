// T-RS-01 a T-RS-17 · Render y búsqueda de residuos (plan 7.13, 10.6). Solo datos ficticios.
// T-RS-18 y T-RS-19 (corpus) los corre PG-3b con `npm run medir`.
// Cada caso arma un `ReviewState` con candidatos fijos, aplica las acciones con `applyReviewAction`, renderiza y ejecuta
// `residue.ts`. La pasada 3 usa el motor real de reglas y lista (el mismo `mergeCandidates` y `buildDetectionSet`).
import { describe, expect, it } from 'vitest';
import { refreshVariants, searchCaseList } from '../../src/core/caselist.ts';
import {
  applyReviewAction, buildDetectionSet, buildReviewState, nitCheckDigit, precedenceOf, type ReviewContext,
} from '../../src/core/entities.ts';
import { mergeCandidates } from '../../src/core/merge.ts';
import { buildSearchView } from '../../src/core/normalize.ts';
import { joinOutput, render } from '../../src/core/render.ts';
import { runResidueCheck, type ResidueCtxExtra } from '../../src/core/residue.ts';
import { runRules } from '../../src/core/rules/catalog.ts';
import { rules as rContacto } from '../../src/core/rules/contacto.ts';
import { rules as rDireccion } from '../../src/core/rules/direccion.ts';
import { rules as rFechas } from '../../src/core/rules/fechas.ts';
import { rules as rIds } from '../../src/core/rules/ids.ts';
import { rules as rRadicado } from '../../src/core/rules/radicado.ts';
import { rules as rRotulados } from '../../src/core/rules/rotulados.ts';
import { rules as rValores } from '../../src/core/rules/valores.ts';
import type {
  CaseEntity, CaseEntityId, DataType, Detection, DetectionSet, DocId, DocumentModel, IdSource, MergedCandidate, Part, PartId,
  PartKind, RejectReason, RenderedOutput, ResidueRun, ReviewAction, ReviewState, Role, RuleRegistry, Suggestion, SuggestionId,
  TableIndex,
} from '../../src/core/types.ts';

const EMPTY: TableIndex = { byKey: {}, counters: {}, documentCount: 0 };
const CAS = 'cas_0000000000000000000000000000000a' as CaseEntityId;
const REF_YEAR = 2026;

function seqIds(start = 1): IdSource {
  let n = start;
  return { next: (p) => `${p}_${(n++).toString(16).padStart(32, '0')}` };
}

// ---- Documento y candidatos --------------------------------------------------------------------------------------

type PartSpec = [kind: PartKind, text: string, label?: string, included?: boolean];
let docSeq = 0;
function mkDoc(parts: PartSpec[]): DocumentModel {
  const d = ++docSeq;
  const id = `doc_${d.toString(16).padStart(32, '0')}` as DocId;
  return {
    id, label: `Documento ${d}`, source: 'pegado', metadata: {} as DocumentModel['metadata'], warnings: [],
    parts: parts.map(([kind, text, label, included], i): Part => ({ id: `prt_${(d * 100 + i).toString(16).padStart(32, '0')}` as PartId,
      docId: id, kind, label: label ?? `${kind} ${i + 1}`, order: i, index: 1, text, included: included ?? true })),
  };
}

/** Marca de una mención: tramo `sub` (aparición `occ`) de la parte `p`, con su tipo y clave, y la decisión del revisor. */
interface Mark {
  p: number; sub: string; occ?: number; type: DataType; key: string; role?: Role;
  src?: MergedCandidate['source']; cas?: CaseEntityId;
  decide?: 'aceptar' | 'pendiente' | { rechazar: RejectReason | undefined };
}
function mcOf(doc: DocumentModel, m: Mark): MergedCandidate {
  const part = doc.parts[m.p] as Part;
  let i = -1;
  for (let k = 0; k <= (m.occ ?? 0); k++) i = part.text.indexOf(m.sub, i + 1);
  if (i < 0) throw new Error(`falta «${m.sub}»`);
  const c = { partId: part.id, start: i, end: i + m.sub.length, type: m.type, source: m.src ?? 'regla', confidence: 'media' as const,
    score: 0.6, canonicalKey: m.key, ...(m.role !== undefined ? { role: m.role } : {}), ...(m.cas !== undefined ? { caseEntityId: m.cas } : {}) };
  return { ...c, precedence: precedenceOf(c) };
}

// ---- Motor de la pasada 3 (reglas y lista reales) --------------------------------------------------------------------

const RULES = [...rIds, ...rContacto, ...rRadicado, ...rFechas, ...rValores, ...rDireccion, ...rRotulados];
const registry: RuleRegistry = {
  rerun(ruleId, text) {
    const rule = RULES.find((r) => r.id === ruleId);
    if (rule === undefined) return null;
    const c = runRules(buildSearchView(text, 'reglas', 'cuerpo'), 'prt_x' as PartId, [rule], REF_YEAR)[0];
    return c === undefined ? null : { start: c.start, end: c.end, canonicalKey: c.canonicalKey };
  },
};
function makeDetect(caseList: readonly CaseEntity[]): (tmp: DocumentModel) => Promise<DetectionSet> {
  return (tmp) => {
    const merged: MergedCandidate[] = [];
    for (const part of tmp.parts) {
      const cands = [...runRules(buildSearchView(part.text, 'reglas', part.kind), part.id, RULES, REF_YEAR), ...searchCaseList(part, caseList)];
      merged.push(...mergeCandidates(part, cands, registry));
    }
    return Promise.resolve(buildDetectionSet(tmp, merged, { table: EMPTY, caseList, ids: seqIds(9000) }));
  };
}

const ANA: CaseEntity[] = refreshVariants([{ id: CAS, name: 'Ana Ficticia Rojas', variants: [], kind: 'persona', role: 'DEMANDANTE' }]);
const PILAR: CaseEntity[] = refreshVariants([{ id: CAS, name: 'María del Pilar Ficticia Restrepo', variants: [], kind: 'persona', role: 'DEMANDANTE' }]);

// ---- Escenario -----------------------------------------------------------------------------------------------------

interface Scenario { doc: DocumentModel; state: ReviewState; caseList: readonly CaseEntity[]; ctx: ReviewContext }
function scenario(parts: PartSpec[], marks: Mark[], caseList: readonly CaseEntity[] = [], suggestions: Suggestion[] = []): Scenario {
  const doc = mkDoc(parts);
  const cands = marks.map((m) => mcOf(doc, m));
  let state = buildReviewState(doc, cands, { table: EMPTY, caseList, ids: seqIds(1000), suggestions });
  const ctx: ReviewContext = { table: EMPTY, caseList, doc, ids: seqIds(5000) };
  marks.forEach((m, i) => {
    const c = cands[i] as MergedCandidate;
    const d = Object.values(state.detections).find((x) => x.partId === c.partId && x.start === c.start && x.end === c.end) as Detection;
    const dec = m.decide ?? 'aceptar';
    if (dec === 'pendiente') return;
    const a: ReviewAction = dec === 'aceptar' ? { kind: 'aceptar', detectionId: d.id }
      : { kind: 'rechazar', detectionId: d.id, ...(dec.rechazar !== undefined ? { reason: dec.rechazar } : {}) };
    state = act(state, a, ctx);
  });
  return { doc, state, caseList, ctx };
}
function act(s: ReviewState, a: ReviewAction, ctx: ReviewContext): ReviewState {
  const r = applyReviewAction(s, a, ctx);
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
function detOf(s: Scenario, p: number, sub: string, occ = 0): Detection {
  const part = s.doc.parts[p] as Part;
  let i = -1;
  for (let k = 0; k <= occ; k++) i = part.text.indexOf(sub, i + 1);
  const d = Object.values(s.state.detections).find((x) => x.partId === part.id && x.start === i && x.end === i + sub.length);
  if (d === undefined) throw new Error(`sin detección «${sub}»`);
  return d;
}
async function check(s: Scenario): Promise<{ out: RenderedOutput; run: ResidueRun }> {
  const out = render(s.doc, s.state);
  const run = await runResidueCheck(s.doc, s.state, out, { table: EMPTY, caseList: s.caseList, rules: registry, detect: makeDetect(s.caseList) });
  return { out, run };
}
/** «rótulo|modo|texto en la salida» de cada impacto, en orden. */
const hitsOf = ({ out, run }: { out: RenderedOutput; run: ResidueRun }): string[] =>
  run.result.hits.map((h) => {
    const sec = out.sections[h.sectionIndex];
    return `${sec?.label}|${h.mode}|${sec?.text.slice(h.start, h.end)}`;
  });

// =============================================================================================================
describe('render.ts · reemplazos y texto único (plan 7.13.1, 6.9)', () => {
  const PARTS: PartSpec[] = [
    ['encabezado', 'Rad. 11001-40-03-999-2026-00001-00', 'Encabezado 1'],
    ['cuerpo', 'Ana Ficticia Rojas, C.C. 41.000.001, vive en Cartago.\nOtra línea.', 'Cuerpo del documento'],
    ['comentario', 'No va', 'Comentario 1', false],
  ];
  const MARKS: Mark[] = [
    { p: 0, sub: '11001-40-03-999-2026-00001-00', type: 'RADICADO', key: 'RAD:11001400399920260000100' },
    { p: 1, sub: 'Ana Ficticia Rojas', type: 'PERSONA', key: `LISTA:${CAS}`, role: 'DEMANDANTE', src: 'lista', cas: CAS },
    { p: 1, sub: '41.000.001', type: 'CC', key: 'CC:41000001' },
  ];

  it('INV-X01 · los segmentos cubren el texto de salida sin huecos ni solapes y las copias son exactas', () => {
    const s = scenario(PARTS, MARKS, ANA);
    const out = render(s.doc, s.state);
    expect(out.sections.map((x) => x.label)).toEqual(['Encabezado 1', 'Cuerpo del documento']);
    expect(out.withHeadings).toBe(true);
    expect(out.revision).toBe(s.state.revision);
    for (const sec of out.sections) {
      const part = s.doc.parts.find((p) => p.id === sec.partId) as Part;
      let cursor = 0;
      for (const g of sec.segments) {
        expect(g.outStart).toBe(cursor);
        expect(g.outEnd).toBeGreaterThanOrEqual(g.outStart);
        cursor = g.outEnd;
        if (g.detectionId === undefined && g.spanEditId === undefined) {
          expect(sec.text.slice(g.outStart, g.outEnd)).toBe(part.text.slice(g.partStart, g.partEnd));
        }
      }
      expect(cursor).toBe(sec.text.length);
    }
    expect(out.sections[1]?.text).toBe('[DEMANDANTE_1], C.C. [CC_1], vive en Cartago.\nOtra línea.');
    expect(out.sections[0]?.text).toBe('Rad. [RADICADO_1]');
  });

  it('INV-X01 · una parte sin reemplazos es una sola copia y una parte vacía no tiene segmentos', () => {
    const s = scenario([['cuerpo', 'Texto sin datos.'], ['pie', '']], []);
    const out = render(s.doc, s.state);
    expect(out.sections[0]?.segments).toEqual([{ outStart: 0, outEnd: 16, partStart: 0, partEnd: 16 }]);
    expect(out.sections[1]?.segments).toEqual([]);
    expect(out.sections[1]?.text).toBe('');
  });

  it('una detección rechazada no se reemplaza; la pendiente se ve como aceptada; la editada usa su texto', () => {
    const s = scenario([['cuerpo', 'Ana Ficticia Rojas y 41.000.001 y 300 000 0001.']],
      [{ p: 0, sub: 'Ana Ficticia Rojas', type: 'PERSONA', key: 'PER:ana ficticia rojas', decide: { rechazar: undefined } },
        { p: 0, sub: '41.000.001', type: 'CC', key: 'CC:41000001', decide: 'pendiente' },
        { p: 0, sub: '300 000 0001', type: 'TELEFONO', key: 'TEL:3000000001' }]);
    expect(render(s.doc, s.state).sections[0]?.text).toBe('Ana Ficticia Rojas y [CC_1] y [TELÉFONO_1].');
    const edited = act(s.state, { kind: 'editar', detectionId: detOf(s, 0, '300 000 0001').id, text: 'el teléfono' }, s.ctx);
    expect(render(s.doc, edited).sections[0]?.text).toBe('Ana Ficticia Rojas y [CC_1] y el teléfono.');
  });

  it('una edición de tramo (sugerencia aplicada) entra con su texto y cubre la detección contenida', () => {
    const doc = mkDoc([['cuerpo', 'T.I. 1000000001 consta.']]);
    const part = doc.parts[0] as Part;
    const cand: MergedCandidate = { ...mcOf(doc, { p: 0, sub: '1000000001', type: 'TI', key: 'TI:1000000001' }), label: { labelId: 'ROT-TI', start: 0, end: 4 } };
    const sug: Suggestion = { id: 'sug_00000000000000000000000000000001' as SuggestionId, kind: 'ROTULO_DOCUMENTO_A_GENERICO',
      target: { kind: 'tramo', span: { partId: part.id, start: 0, end: 4 } }, originalText: 'T.I.',
      options: [{ id: 'o1', kind: 'ROTULO_DOCUMENTO_A_GENERICO', template: 'documento de identidad' }], status: 'aplicada', chosenOptionId: 'o1' };
    const state = buildReviewState(doc, [cand], { table: EMPTY, caseList: [], ids: seqIds(1), suggestions: [sug] });
    const ctx: ReviewContext = { table: EMPTY, caseList: [], doc, ids: seqIds(50) };
    const accepted = act(state, { kind: 'aceptar', detectionId: Object.values(state.detections)[0]?.id as Detection['id'] }, ctx);
    const out = render(doc, accepted);
    expect(out.sections[0]?.text).toBe('documento de identidad [DOCUMENTO_1] consta.');
    expect(out.sections[0]?.segments.map((g) => g.spanEditId !== undefined)).toEqual([true, false, false, false]);
    expect(out.sections[0]?.segments.map((g) => g.detectionId !== undefined)).toEqual([false, false, true, false]);
  });

  it('joinOutput · rótulos «=== … ===», línea vacía entre secciones y CRLF solo para archivos (INV-X02)', () => {
    const s = scenario(PARTS, MARKS, ANA);
    const out = render(s.doc, s.state);
    const lf = joinOutput(out, '\n');
    expect(lf).toBe('=== Encabezado 1 ===\nRad. [RADICADO_1]\n\n=== Cuerpo del documento ===\n[DEMANDANTE_1], C.C. [CC_1], vive en Cartago.\nOtra línea.');
    const crlf = joinOutput(out, '\r\n');
    expect(crlf.startsWith('=== Encabezado 1 ===\r\n')).toBe(true);
    expect(/(?<!\r)\n/u.test(crlf)).toBe(false);
    expect(crlf.replace(/\r\n/gu, '\n')).toBe(lf);
    const one = render(mkDoc([['cuerpo', 'Solo una.']]), { ...s.state, detections: {}, spanEdits: {} });
    expect(joinOutput(one, '\n')).toBe('Solo una.');
  });
});

// =============================================================================================================
describe('T-RS · búsqueda de residuos (plan 7.13, 10.6)', () => {
  it('T-RS-01 · forma de nombre no listada: «Ficticia» suelta es una detección nueva de la pasada 3', async () => {
    const s = scenario([['cuerpo', 'Mapi Ficticia llamó ayer.']], [], PILAR);
    const r = await check(s);
    expect(r.run.result.hits).toEqual([]);
    expect(r.run.result.newDetections).toBe(1);
    expect(r.run.nuevas).toHaveLength(1);
    const c = r.run.nuevas[0];
    expect(s.doc.parts[0]?.text.slice(c?.start, c?.end)).toBe('Ficticia');
    expect(c?.variantClass).toBe('apellido_suelto');
    expect(c?.caseEntityId).toBe(CAS);
  });

  it('T-RS-02 · variante en mayúsculas rechazada por error: 1 impacto normalizado en el encabezado', async () => {
    const s = scenario([['encabezado', 'MARIA DEL PILAR FICTICIA RESTREPO', 'Encabezado 1'], ['cuerpo', 'La demandante María del Pilar Ficticia Restrepo presentó la acción.', 'Cuerpo del documento']],
      [{ p: 0, sub: 'MARIA DEL PILAR FICTICIA RESTREPO', type: 'PERSONA', key: `LISTA:${CAS}`, role: 'DEMANDANTE', src: 'lista', cas: CAS, decide: { rechazar: undefined } },
        { p: 1, sub: 'María del Pilar Ficticia Restrepo', type: 'PERSONA', key: `LISTA:${CAS}`, role: 'DEMANDANTE', src: 'lista', cas: CAS }], PILAR);
    const r = await check(s);
    expect(hitsOf(r)).toEqual(['Encabezado 1|normalizado|MARIA DEL PILAR FICTICIA RESTREPO']);
    expect(r.run.result.hits[0]?.entityId).toBe(detOf(s, 1, 'María del Pilar Ficticia Restrepo').entityId);
  });

  it('T-RS-03 · persona del modelo con una mención sin detectar en la nota al pie: 1 impacto normalizado', async () => {
    const s = scenario([['cuerpo', 'Declaró Carlos Ejemplo Gómez.', 'Cuerpo del documento'], ['nota_pie', 'CARLOS EJEMPLO GÓMEZ firmó.', 'Nota al pie 1']],
      [{ p: 0, sub: 'Carlos Ejemplo Gómez', type: 'PERSONA', key: 'PER:carlos ejemplo gomez', src: 'modelo' }]);
    const r = await check(s);
    expect(hitsOf(r)).toEqual(['Nota al pie 1|normalizado|CARLOS EJEMPLO GÓMEZ']);
    expect(r.run.result.newDetections).toBe(0);
  });

  it('T-RS-04 · número partido por espacio o salto de línea: 2 impactos de dígitos', async () => {
    const s = scenario([['cuerpo', 'C.C. 41.000.001, tel. +57 300 000 0001.', 'Cuerpo del documento'], ['pagina_pdf', 'Ver 41.000.\n001 y llamar al 300 000\n0001 hoy.', 'Página 2']],
      [{ p: 0, sub: '41.000.001', type: 'CC', key: 'CC:41000001' }, { p: 0, sub: '+57 300 000 0001', type: 'TELEFONO', key: 'TEL:3000000001' }]);
    const r = await check(s);
    expect(hitsOf(r)).toEqual(['Página 2|digitos|41.000.\n001', 'Página 2|digitos|300 000\n0001']);
  });

  it('T-RS-05 · número partido por guion de corte: 1 impacto de dígitos (hasta 3 separadores)', async () => {
    const s = scenario([['cuerpo', 'Cédula 1.000.000.017 consta.'], ['cuerpo', 'Ref. 1.000.000.-\n017 fin.']],
      [{ p: 0, sub: '1.000.000.017', type: 'CC', key: 'CC:1000000017' }]);
    expect(hitsOf(await check(s))).toEqual(['cuerpo 2|digitos|1.000.000.-\n017']);
  });

  it('T-RS-06 · nombre partido por guion de corte en una página PDF: 1 impacto normalizado', async () => {
    const s = scenario([['cuerpo', 'La demandante María del Pilar Ficticia Restrepo.', 'Cuerpo del documento'], ['pagina_pdf', 'Firma: María del Pilar Ficti-\ncia Restrepo.', 'Página 3']],
      [{ p: 0, sub: 'María del Pilar Ficticia Restrepo', type: 'PERSONA', key: `LISTA:${CAS}`, role: 'DEMANDANTE', src: 'lista', cas: CAS }], PILAR);
    const hits = hitsOf(await check(s));
    expect(hits).toEqual(['Página 3|normalizado|María del Pilar Ficti-\ncia Restrepo']);
  });

  it('T-RS-07 · negativo: «folio 41 y 000001» no es la cédula 41.000.001', async () => {
    const s = scenario([['cuerpo', 'C.C. 41.000.001 consta.'], ['cuerpo', 'Véase folio 41 y 000001 del cuaderno, Ley 41 de 2001.']],
      [{ p: 0, sub: '41.000.001', type: 'CC', key: 'CC:41000001' }]);
    const r = await check(s);
    expect(r.run.result.hits).toEqual([]);
  });

  it('T-RS-08 · sameHolderAs CC ↔ HC: el número de la HC rechazada es un impacto de la CC', async () => {
    const s = scenario([['cuerpo', 'C.C. 1.000.000.017 consta. Historia clínica HC 1000000017 del paciente.']],
      [{ p: 0, sub: '1.000.000.017', type: 'CC', key: 'CC:1000000017' },
        { p: 0, sub: '1000000017', type: 'HC', key: 'HC:1000000017', decide: { rechazar: undefined } }]);
    const cc = detOf(s, 0, '1.000.000.017');
    expect(s.state.entities[cc.entityId]?.sameHolderAs).toHaveLength(1);
    const r = await check(s);
    expect(hitsOf(r)).toEqual(['cuerpo 1|digitos|1000000017']);
    expect(r.run.result.hits[0]?.entityId).toBe(cc.entityId);
  });

  it('T-RS-09 · sameHolderAs CC ↔ NIT de persona natural: la CC con su DV pegado es un impacto', async () => {
    expect(nitCheckDigit('1000000017')).toBe(6);
    const s = scenario([['cuerpo', 'C.C. 1.000.000.017 consta.'], ['cuerpo', 'NIT 1.000.000.017-6 del comerciante.']],
      [{ p: 0, sub: '1.000.000.017', type: 'CC', key: 'CC:1000000017' }]);
    const r = await check(s);
    expect(hitsOf(r)).toEqual(['cuerpo 2|digitos|1.000.000.017-6']);
    expect(r.run.result.hits[0]?.entityId).toBe(detOf(s, 0, '1.000.000.017').entityId);
  });

  it('T-RS-10 · NIT sin DV: la segunda mención rechazada es un impacto de dígitos', async () => {
    const s = scenario([['cuerpo', 'NIT 900.000.001-2 de la empresa.'], ['cuerpo', 'Consulte NIT 900000001 allí.']],
      [{ p: 0, sub: '900.000.001-2', type: 'NIT', key: 'NIT:900000001' },
        { p: 1, sub: '900000001', type: 'NIT', key: 'NIT:900000001', decide: { rechazar: undefined } }]);
    expect(hitsOf(await check(s))).toEqual(['cuerpo 2|digitos|900000001']);
  });

  it('T-RS-11 · texto en un comentario incluido: la persona y el teléfono son 2 impactos en «Comentario 1»', async () => {
    const parts: PartSpec[] = [['cuerpo', 'Ana Ficticia compareció. Teléfono 300 000 0001.', 'Cuerpo del documento'],
      ['comentario', 'Llamar a Ana Ficticia al 300 000 0001', 'Comentario 1']];
    const s = scenario(parts,
      [{ p: 0, sub: 'Ana Ficticia', type: 'PERSONA', key: `LISTA:${CAS}`, role: 'DEMANDANTE', src: 'lista', cas: CAS },
        { p: 0, sub: '300 000 0001', type: 'TELEFONO', key: 'TEL:3000000001' },
        { p: 1, sub: 'Ana Ficticia', type: 'PERSONA', key: `LISTA:${CAS}`, role: 'DEMANDANTE', src: 'lista', cas: CAS, decide: { rechazar: undefined } },
        { p: 1, sub: '300 000 0001', type: 'TELEFONO', key: 'TEL:3000000001', decide: { rechazar: undefined } }], ANA);
    const r = await check(s);
    expect(hitsOf(r)).toEqual(['Comentario 1|literal|Ana Ficticia', 'Comentario 1|literal|300 000 0001']);
  });

  it('T-RS-12 · parte excluida: 0 impactos y la salida no tiene la sección', async () => {
    const parts: PartSpec[] = [['cuerpo', 'Ana Ficticia compareció. Teléfono 300 000 0001.', 'Cuerpo del documento'],
      ['comentario', 'Llamar a Ana Ficticia al 300 000 0001', 'Comentario 1', false]];
    const s = scenario(parts,
      [{ p: 0, sub: 'Ana Ficticia', type: 'PERSONA', key: `LISTA:${CAS}`, role: 'DEMANDANTE', src: 'lista', cas: CAS },
        { p: 0, sub: '300 000 0001', type: 'TELEFONO', key: 'TEL:3000000001' }], ANA);
    const r = await check(s);
    expect(r.out.sections.map((x) => x.label)).toEqual(['Cuerpo del documento']);
    expect(r.run.result.hits).toEqual([]);
    expect(joinOutput(r.out, '\n')).not.toContain('Llamar');
  });

  it('T-RS-13 · radicado en el encabezado rechazado: 1 impacto de dígitos en «Encabezado 1»', async () => {
    const s = scenario([['encabezado', 'Rad. 11001-40-03-999-2026-00001-00', 'Encabezado 1'], ['cuerpo', 'Proceso 11001400399920260000100 en trámite.', 'Cuerpo del documento']],
      [{ p: 0, sub: '11001-40-03-999-2026-00001-00', type: 'RADICADO', key: 'RAD:11001400399920260000100', decide: { rechazar: undefined } },
        { p: 1, sub: '11001400399920260000100', type: 'RADICADO', key: 'RAD:11001400399920260000100' }]);
    expect(hitsOf(await check(s))).toEqual(['Encabezado 1|digitos|11001-40-03-999-2026-00001-00']);
  });

  it('T-RS-14 · una edición que reintroduce el original es 1 impacto sobre el texto editado', async () => {
    const s = scenario([['cuerpo', 'La demandante María del Pilar Ficticia Restrepo presentó la acción.', 'Cuerpo del documento']],
      [{ p: 0, sub: 'María del Pilar Ficticia Restrepo', type: 'PERSONA', key: `LISTA:${CAS}`, role: 'DEMANDANTE', src: 'lista', cas: CAS }], PILAR);
    const d = detOf(s, 0, 'María del Pilar Ficticia Restrepo');
    s.state = act(s.state, { kind: 'editar', detectionId: d.id, text: 'la señora Ficticia' }, s.ctx);
    const r = await check(s);
    expect(r.out.sections[0]?.text).toBe('La demandante la señora Ficticia presentó la acción.');
    expect(r.run.result.hits).toHaveLength(1);
    const h = r.run.result.hits[0];
    expect(['variante', 'normalizado']).toContain(h?.mode);
    expect(r.out.sections[0]?.text.slice(h?.start, h?.end)).toBe('Ficticia');
    expect(h?.partStart).toBe(d.start);
    expect(r.run.nuevas).toEqual([]);
  });

  it('T-RS-15 · Unicode: espacio duro, guion blando, espacio de ancho cero y correo en mayúsculas, 1 impacto por forma', async () => {
    const body = 'Declaró Ana Ficticia y su correo ana.ficticia@ejemplo.test constan.';
    const tail = 'Ana Ficticia. Ana Fic­ticia. Ana​ Ficticia. ANA.FICTICIA@EJEMPLO.TEST.';
    const s = scenario([['cuerpo', body, 'Cuerpo del documento'], ['pie', tail, 'Pie 1']],
      [{ p: 0, sub: 'Ana Ficticia', type: 'PERSONA', key: 'PER:ana ficticia', src: 'modelo' },
        { p: 0, sub: 'ana.ficticia@ejemplo.test', type: 'CORREO', key: 'CORREO:ana.ficticia@ejemplo.test' }]);
    const r = await check(s);
    expect(r.run.result.hits.map((h) => h.mode)).toEqual(['normalizado', 'normalizado', 'normalizado', 'normalizado']);
    expect(hitsOf(r).map((x) => x.split('|')[2])).toEqual(['Ana Ficticia', 'Ana Fic­ticia', 'Ana​ Ficticia', 'ANA.FICTICIA@EJEMPLO.TEST']);
  });

  it('T-RS-16 · municipio generalizado: «Cartago» sin el artículo es 1 impacto normalizado', async () => {
    const doc0 = mkDoc([['cuerpo', 'Ocurrió dentro del municipio de Cartago el lunes. Luego Cartago respondió.', 'Cuerpo del documento']]);
    const part = doc0.parts[0] as Part;
    const i = part.text.indexOf('del municipio de Cartago');
    const sug: Suggestion = { id: 'sug_00000000000000000000000000000002' as SuggestionId, kind: 'MUNICIPIO_A_DEPARTAMENTO',
      target: { kind: 'tramo', span: { partId: part.id, start: i, end: i + 'del municipio de Cartago'.length } }, originalText: 'del municipio de Cartago',
      options: [{ id: 'o1', kind: 'MUNICIPIO_A_DEPARTAMENTO', template: 'de un municipio de {m}', depCode: '76' }], status: 'pendiente' };
    const state0 = buildReviewState(doc0, [], { table: EMPTY, caseList: [], ids: seqIds(1), suggestions: [sug] });
    const ctx: ReviewContext = { table: EMPTY, caseList: [], doc: doc0, ids: seqIds(70) };
    const s: Scenario = { doc: doc0, state: act(state0, { kind: 'aplicar_sugerencia', suggestionId: sug.id, optionId: 'o1' }, ctx), caseList: [], ctx };
    const r = await check(s);
    expect(r.out.sections[0]?.text).toBe('Ocurrió dentro de un municipio de [DEPARTAMENTO_1] el lunes. Luego Cartago respondió.');
    expect(hitsOf(r)).toEqual(['Cuerpo del documento|normalizado|Cartago']);
  });

  it('T-RS-17 · fecha escrita de otra forma: 1 detección nueva en la pasada 3 que coincide con la entidad objetivo', async () => {
    const s = scenario([['cuerpo', 'Los hechos ocurrieron el 14 de marzo de 2026 en la ciudad. Se radicó el 14/03/2026.']],
      [{ p: 0, sub: '14 de marzo de 2026', type: 'FECHA', key: 'FECHA:2026-03-14' }]);
    const r = await check(s);
    expect(r.run.result.newDetections).toBe(1);
    expect(hitsOf(r)).toEqual(['cuerpo 1|variante|14/03/2026']);
    expect(r.run.nuevas).toHaveLength(1);
    expect(r.run.nuevas[0]?.canonicalKey).toBe('FECHA:2026-03-14');
    expect(s.doc.parts[0]?.text.slice(r.run.nuevas[0]?.start, r.run.nuevas[0]?.end)).toBe('14/03/2026');
  });
});

// =============================================================================================================
describe('R-RES-01 y R-RES-02 · tablas de 7.13.3 y 7.13.4', () => {
  /** Un objetivo aceptado en la parte 0 y el texto de prueba en la parte 1; devuelve los textos de los impactos de las
   *  pasadas 1 y 2 (la pasada 3 va aparte: sus tramos pueden ser más anchos que los de la tabla). */
  async function probe(target: Mark, row: string, caseList: readonly CaseEntity[] = []): Promise<string[]> {
    const s = scenario([['cuerpo', `Dato ${target.sub} consta.`, 'Cuerpo del documento'], ['pie', row, 'Pie 1']], [{ ...target, p: 0 }], caseList);
    const out = render(s.doc, s.state);
    const run = await runResidueCheck(s.doc, s.state, out, { table: EMPTY, caseList, rules: registry, detect: () => Promise.resolve({ detections: [], entities: [], flags: [], suggestions: [] }) });
    return run.result.hits.filter((h) => h.sectionIndex === 1).map((h) => out.sections[1]?.text.slice(h.start, h.end) ?? '');
  }
  const CC: Mark = { p: 0, sub: '41.000.001', type: 'CC', key: 'CC:41000001' };
  const TEL: Mark = { p: 0, sub: '300 000 0001', type: 'TELEFONO', key: 'TEL:3000000001' };
  const VAL: Mark = { p: 0, sub: '48.000.000', type: 'VALOR', key: 'VALOR:48000000' };

  const SI: Array<[Mark, string, string]> = [
    [CC, 'C.C. 41.000.001 de', '41.000.001'], [CC, 'cédula 41 000 001.', '41 000 001'], [CC, '41000001', '41000001'],
    [CC, '41.000.\n001', '41.000.\n001'], [CC, '41-000-001', '41-000-001'], [CC, 'NIT 410000017', '410000017'],
    [CC, '41.000.001-7', '41.000.001-7'], [CC, 'ID 41,000,001 (formato extranjero)', '41,000,001'],
    [TEL, '+57 300 000 0001', '+57 300 000 0001'], [TEL, '573000000001', '573000000001'], [TEL, '(300) 000-0001', '300) 000-0001'],
    [TEL, '300.000.0001', '300.000.0001'], [TEL, 'cel. 300,000,0001', '300,000,0001'],
    [VAL, '$48.000.000,00', '48.000.000'], [VAL, '$ 48 000 000.', '48 000 000'], [VAL, "48'000.000 pesos", "48'000.000"],
    [VAL, '48,000,000 dollars', '48,000,000'],
  ];
  it.each(SI)('R-RES-02 · sí (%#): %j', async (target, row, expected) => {
    const got = await probe(target, row);
    expect(got).toEqual([expected]);
  });

  const NO: Array<[Mark, string]> = [
    [CC, '141000001'], [CC, '410000019'], [CC, '41.000'], [CC, '4100000'], [CC, 'Ley 41 de 2001'], [CC, '[CC_4] 1000001'], [CC, '41,000,001,000'],
    [TEL, '3000000001890'], [TEL, '13000000001'], [TEL, '300 000 000'], [TEL, '[TELÉFONO_1]'],
    [VAL, '48.000.000.000'], [VAL, '148.000.000'], [VAL, '1.48.000.000'], [VAL, '$4.800.000'], [VAL, '48,000,000,000'],
  ];
  it.each(NO)('R-RES-02 · no (%#): %j', async (target, row) => {
    expect(await probe(target, row)).toEqual([]);
  });

  it('R-RES-02 · una clave de menos de 5 dígitos no se busca en la pasada de dígitos', async () => {
    const s = scenario([['cuerpo', 'Clave 1234 asignada.'], ['pie', 'Clave 1.2.3.4 y 12 34.']], [{ p: 0, sub: '1234', type: 'CC', key: 'CC:1234' }]);
    const r = await check(s);
    expect(r.run.result.hits.filter((h) => h.mode === 'digitos')).toEqual([]);
  });

  const A: Mark = { p: 0, sub: 'Ana Ficticia Rojas', type: 'PERSONA', key: `LISTA:${CAS}`, role: 'DEMANDANTE', src: 'lista', cas: CAS };
  it.each([
    ['firmó Ana Ficticia Rojas.', 'Ana Ficticia Rojas'], ['ANA FICTICIA ROJAS', 'ANA FICTICIA ROJAS'], ['Ana Ficticia\nRojas', 'Ana Ficticia\nRojas'],
  ])('R-RES-01 · sí: %j', async (row, expected) => {
    expect(await probe(A, row, ANA)).toContain(expected);
  });
  it.each(['Barojas y Anabel', '[DEMANDANTE_1] firmó', 'Ana Prueba firmó'])('R-RES-01 · no: %j', async (row) => {
    expect(await probe(A, row, ANA)).toEqual([]);
  });

  const ROJAS: Mark = { p: 0, sub: 'Rojas', type: 'PERSONA', key: 'PER:rojas', src: 'modelo' };
  it('R-RES-01 · un original de una sola palabra exige mayúscula inicial', async () => {
    expect(await probe(ROJAS, 'dijo Rojas que')).toEqual(['Rojas']);
    expect(await probe(ROJAS, 'dijo ROJAS que')).toEqual(['ROJAS']);
    expect(await probe(ROJAS, 'las flores rojas')).toEqual([]);
    expect(await probe(ROJAS, 'Barojas y Anabel')).toEqual([]);
  });
});

// =============================================================================================================
describe('INV-G08 · ningún original de una detección aceptada queda en la salida', () => {
  const PARTS: PartSpec[] = [
    ['encabezado', 'MARIA DEL PILAR FICTICIA RESTREPO, C.C. 41.000.001', 'Encabezado 1'],
    ['cuerpo', 'La demandante María del Pilar Ficticia Restrepo, C.C. 41.000.001, presentó la acción.', 'Cuerpo del documento'],
  ];
  const ACEPTADAS: Mark[] = [
    { p: 1, sub: 'María del Pilar Ficticia Restrepo', type: 'PERSONA', key: `LISTA:${CAS}`, role: 'DEMANDANTE', src: 'lista', cas: CAS },
    { p: 1, sub: '41.000.001', type: 'CC', key: 'CC:41000001' },
  ];

  it('INV-G08 · un original que quedó en la salida produce un ResidueHit con su ubicación', async () => {
    const s = scenario(PARTS, ACEPTADAS, PILAR);
    const r = await check(s);
    const header = s.doc.parts[0] as Part;
    expect(r.run.result.hits.map((h) => [h.sectionIndex, h.mode])).toEqual([[0, 'normalizado'], [0, 'literal']]);
    for (const h of r.run.result.hits) {
      expect(h.partId).toBe(header.id);
      // La ubicación en la salida y en la parte coinciden (el tramo es una copia 1:1).
      expect(header.text.slice(h.partStart, h.partStart + (h.end - h.start))).toBe(r.out.sections[0]?.text.slice(h.start, h.end));
      expect(h.entityId).toBe(detOf(s, 1, h.mode === 'literal' ? '41.000.001' : 'María del Pilar Ficticia Restrepo').entityId);
    }
    expect(header.text.slice(r.run.result.hits[0]?.partStart, r.run.result.hits[0]?.end)).toBe('MARIA DEL PILAR FICTICIA RESTREPO');
    expect(r.run.nuevas).toHaveLength(2);
  });

  it('INV-G08 · con la salida limpia la búsqueda pasa (0 impactos, 0 detecciones nuevas)', async () => {
    const s = scenario([PARTS[1] as PartSpec], ACEPTADAS.map((m) => ({ ...m, p: 0 })), PILAR);
    const r = await check(s);
    expect(r.out.sections[0]?.text).toBe('La demandante [DEMANDANTE_1], C.C. [CC_1], presentó la acción.');
    expect(r.run.result.hits).toEqual([]);
    expect(r.run.result.newDetections).toBe(0);
    expect(r.run.nuevas).toEqual([]);
    expect(r.run.result.valuesSearched).toBeGreaterThan(0);
    expect(r.run.result.modes).toEqual(['literal', 'normalizado', 'digitos', 'variante']);
    expect(r.run.result.revision).toBe(s.state.revision);
    expect(new Date(r.run.result.ranAt).toISOString()).toBe(r.run.result.ranAt);
  });

  it('INV-G08 · tras incorporar los residuos y decidirlos, la búsqueda llega a 0 impactos', async () => {
    const s = scenario(PARTS, ACEPTADAS, PILAR);
    const first = await check(s);
    expect(first.run.result.hits.length).toBeGreaterThan(0);
    let st = act(s.state, { kind: 'incorporar_residuos', residueRevision: first.run.result.revision, candidates: first.run.nuevas }, s.ctx);
    const pend = Object.values(st.detections).filter((d) => d.status === 'pendiente');
    expect(pend.length).toBe(first.run.nuevas.length);
    for (const d of pend) st = act(st, { kind: 'aceptar', detectionId: d.id }, s.ctx);
    s.state = st;
    const second = await check(s);
    expect(second.out.sections[0]?.text).toBe('[DEMANDANTE_1], C.C. [CC_1]');
    expect(second.run.result.hits).toEqual([]);
    expect(second.run.result.newDetections).toBe(0);
    // El residuo reutiliza el marcador de la entidad (mismo marcador, 7.13.6).
    expect(new Set(Object.values(st.entities).map((e) => e.marker))).toEqual(new Set(['[DEMANDANTE_1]', '[CC_1]']));
  });

  it('INV-G08 · el original de una entidad heredada del asunto (MappingEntry.originals) también se busca', async () => {
    const s = scenario([['cuerpo', 'Declaró Carlos Ejemplo.', 'Cuerpo del documento'], ['pie', 'Dijo Carlitos Ejemplo ayer.', 'Pie 1']],
      [{ p: 0, sub: 'Carlos Ejemplo', type: 'PERSONA', key: 'PER:carlos ejemplo', src: 'modelo' }]);
    const out = render(s.doc, s.state);
    const base = { table: EMPTY, caseList: [], rules: registry, detect: makeDetect([]) };
    expect((await runResidueCheck(s.doc, s.state, out, base)).result.hits).toEqual([]);
    const conOriginales: typeof base & ResidueCtxExtra = { ...base, originals: { 'PER:carlos ejemplo': ['Carlitos Ejemplo'] } };
    const withOriginals = await runResidueCheck(s.doc, s.state, out, conOriginales);
    expect(withOriginals.result.hits.map((h) => [h.mode, out.sections[h.sectionIndex]?.text.slice(h.start, h.end)])).toEqual([['literal', 'Carlitos Ejemplo']]);
  });
});

// =============================================================================================================
describe('7.13.6 · decisiones del revisor y entidades distintas', () => {
  const HEADER: PartSpec = ['encabezado', 'MARIA DEL PILAR FICTICIA RESTREPO', 'Encabezado 1'];
  const BODY: PartSpec = ['cuerpo', 'La demandante María del Pilar Ficticia Restrepo presentó la acción.', 'Cuerpo del documento'];
  const marks = (reason: RejectReason | undefined): Mark[] => [
    { p: 0, sub: 'MARIA DEL PILAR FICTICIA RESTREPO', type: 'PERSONA', key: `LISTA:${CAS}`, role: 'DEMANDANTE', src: 'lista', cas: CAS, decide: { rechazar: reason } },
    { p: 1, sub: 'María del Pilar Ficticia Restrepo', type: 'PERSONA', key: `LISTA:${CAS}`, role: 'DEMANDANTE', src: 'lista', cas: CAS },
  ];

  it('un rechazo con motivo (FALSO_POSITIVO) de la misma entidad y el mismo tramo excluye el impacto', async () => {
    const r = await check(scenario([HEADER, BODY], marks('FALSO_POSITIVO'), PILAR));
    expect(r.run.result.hits).toEqual([]);
    expect(r.run.result.newDetections).toBe(0);
  });

  it('un rechazo sin motivo (por defecto) no excluye: es el caso de «rechazada por error»', async () => {
    const r = await check(scenario([HEADER, BODY], marks(undefined), PILAR));
    expect(r.run.result.hits).toHaveLength(1);
  });

  it('7.13.9 · caso integral: cinco impactos, nada de «folio 3», «flores rojas», los marcadores ni el «Rojas» rechazado', async () => {
    const text = 'Ana Ficticia Rojas, C.C. 41.000.001, tel. 300 000 0001. ANA FICTICIA declaró. Su cédula 41 000 001 consta en folio 3. '
      + 'La señora Rojas firmó. NIT 410000017. Llamar al +57 3000000001. Las flores rojas. Rojas (otra persona).';
    const base: Mark[] = [
      { p: 0, sub: 'Ana Ficticia Rojas', type: 'PERSONA', key: `LISTA:${CAS}`, role: 'DEMANDANTE', src: 'lista', cas: CAS },
      { p: 0, sub: '41.000.001', type: 'CC', key: 'CC:41000001' },
      { p: 0, sub: '300 000 0001', type: 'TELEFONO', key: 'TEL:3000000001' },
    ];
    const rechazada: Mark = { p: 0, sub: 'Rojas', occ: 2, type: 'PERSONA', key: `LISTA:${CAS}`, src: 'lista', cas: CAS, role: 'DEMANDANTE', decide: { rechazar: 'FALSO_POSITIVO' } };
    const s = scenario([['cuerpo', text, 'Cuerpo del documento']], [...base, rechazada], ANA);
    const r = await check(s);
    expect(r.out.sections[0]?.text.startsWith('[DEMANDANTE_1], C.C. [CC_1], tel. [TELÉFONO_1]. ANA FICTICIA declaró.')).toBe(true);
    const got = hitsOf(r).map((x) => x.split('|').slice(1).join('|'));
    expect(got).toEqual(['variante|ANA FICTICIA', 'digitos|41 000 001', 'variante|Rojas', 'digitos|410000017', 'digitos|+57 3000000001']);
    const nuevas = r.run.nuevas.map((c) => s.doc.parts[0]?.text.slice(c.start, c.end));
    expect(nuevas).toEqual(expect.arrayContaining(['ANA FICTICIA', 'Rojas']));
    expect(nuevas).not.toContain('3');
    expect(r.run.result.newDetections).toBeGreaterThanOrEqual(2);
    // «Rojas» de «Rojas (otra persona)» (rechazado) y «rojas» de «flores rojas» no están entre los impactos.
    const rojasHits = r.run.result.hits.filter((h) => r.out.sections[0]?.text.slice(h.start, h.end) === 'Rojas');
    expect(rojasHits).toHaveLength(1);
    expect(r.out.sections[0]?.text.indexOf('Rojas (otra persona)')).toBeGreaterThan(rojasHits[0]?.end ?? 0);
  });

  it('7.13.9 · con la salida limpia pasa; si el rechazo de «Rojas» era de otra entidad, no pasa: 1 residuo', async () => {
    const text = 'Ana Ficticia Rojas, C.C. 41.000.001, tel. 300 000 0001. ANA FICTICIA declaró. Consta en folio 3. Las flores rojas. Rojas (otra persona).';
    const base: Mark[] = [
      { p: 0, sub: 'Ana Ficticia Rojas', type: 'PERSONA', key: `LISTA:${CAS}`, role: 'DEMANDANTE', src: 'lista', cas: CAS },
      { p: 0, sub: 'ANA FICTICIA', type: 'PERSONA', key: `LISTA:${CAS}`, role: 'DEMANDANTE', src: 'lista', cas: CAS },
      { p: 0, sub: '41.000.001', type: 'CC', key: 'CC:41000001' },
      { p: 0, sub: '300 000 0001', type: 'TELEFONO', key: 'TEL:3000000001' },
    ];
    const misma: Mark = { p: 0, sub: 'Rojas', occ: 1, type: 'PERSONA', key: `LISTA:${CAS}`, src: 'lista', cas: CAS, role: 'DEMANDANTE', decide: { rechazar: 'FALSO_POSITIVO' } };
    const limpia = await check(scenario([['cuerpo', text, 'Cuerpo del documento']], [...base, misma], ANA));
    expect(limpia.out.sections[0]?.text).toBe('[DEMANDANTE_1], C.C. [CC_1], tel. [TELÉFONO_1]. [DEMANDANTE_1] declaró. Consta en folio 3. Las flores rojas. Rojas (otra persona).');
    expect(limpia.run.result.hits).toEqual([]);
    expect(limpia.run.result.newDetections).toBe(0);
    expect(limpia.run.nuevas).toEqual([]);
    const { cas: _cas, ...sinCaso } = misma;
    const otra = await check(scenario([['cuerpo', text, 'Cuerpo del documento']], [...base, { ...sinCaso, key: 'PER:rojas', src: 'modelo' }], ANA));
    expect(hitsOf(otra).map((x) => x.split('|').slice(1).join('|'))).toEqual(['variante|Rojas']);
  });
});

// =============================================================================================================
describe('INV-R07 · el resultado de la búsqueda alimenta la puerta de salida (exportGate, 6.4.8)', () => {
  it('INV-R07 · el resultado lleva la revisión del estado y queda desactualizado cuando una acción la sube', async () => {
    const s = scenario([['cuerpo', 'Declaró Ana Ficticia Rojas.']],
      [{ p: 0, sub: 'Ana Ficticia Rojas', type: 'PERSONA', key: `LISTA:${CAS}`, role: 'DEMANDANTE', src: 'lista', cas: CAS }], ANA);
    const r = await check(s);
    expect(r.run.result.revision).toBe(s.state.revision);
    expect(r.out.revision).toBe(s.state.revision);
    const after = act(s.state, { kind: 'editar', detectionId: detOf(s, 0, 'Ana Ficticia Rojas').id, text: 'la actora' }, s.ctx);
    expect(after.revision).toBe(s.state.revision + 1);
    expect(r.run.result.revision).not.toBe(after.revision);
  });

  it('INV-R07 · una salida con un nombre no detectado da detecciones nuevas aunque no haya impactos', async () => {
    const solo = scenario([['cuerpo', 'Mapi Ficticia llamó ayer.']], [], ANA);
    const r2 = await check(solo);
    expect(r2.run.result.hits).toEqual([]);
    expect(r2.run.result.newDetections).toBeGreaterThan(0);
    // `nuevas` no vacío ⇒ la interfaz despacha incorporar_residuos: la revisión sube y el resultado queda desactualizado.
    const st = act(solo.state, { kind: 'incorporar_residuos', residueRevision: r2.run.result.revision, candidates: r2.run.nuevas }, solo.ctx);
    expect(st.revision).toBe(r2.run.result.revision + 1);
    expect(Object.values(st.detections).filter((d) => d.status === 'pendiente')).toHaveLength(r2.run.nuevas.length);
  });
});

// =============================================================================================================
describe('7.13.5 · pasada 3: recorte a la parte copiada y texto reemplazado', () => {
  it('una detección que toca un marcador se recorta a la parte copiada y lleva posiciones de la parte', async () => {
    const s = scenario([['cuerpo', 'Cédula 41.000.001 99999999 consta.']], [{ p: 0, sub: '41.000.001', type: 'CC', key: 'CC:41000001' }]);
    const out = render(s.doc, s.state);
    expect(out.sections[0]?.text).toBe('Cédula [CC_1] 99999999 consta.');
    const detect = (tmp: DocumentModel): Promise<DetectionSet> => {
      const part = tmp.parts[0] as Part;
      const i = part.text.indexOf('[CC_1] 99999999');
      const c = { partId: part.id, start: i, end: i + '[CC_1] 99999999'.length, type: 'CC' as const, source: 'regla' as const, ruleId: 'R-CC-01',
        confidence: 'media' as const, score: 0.6, canonicalKey: 'CC:99999999' };
      const m: MergedCandidate = { ...c, precedence: 5 };
      return Promise.resolve(buildDetectionSet(tmp, [m], { table: EMPTY, caseList: [], ids: seqIds(7000) }));
    };
    const run = await runResidueCheck(s.doc, s.state, out, { table: EMPTY, caseList: [], rules: { rerun: () => null }, detect });
    const part = s.doc.parts[0] as Part;
    expect(run.nuevas).toHaveLength(1);
    expect(part.text.slice(run.nuevas[0]?.start, run.nuevas[0]?.end)).toBe('99999999');
    expect(run.nuevas[0]?.partId).toBe(part.id);
    expect(run.result.newDetections).toBe(1);
  });

  it('el modelo no se vuelve a ejecutar: detect recibe las secciones de salida y se llama una vez', async () => {
    const s = scenario([['cuerpo', 'Cédula 41.000.001 consta.']], [{ p: 0, sub: '41.000.001', type: 'CC', key: 'CC:41000001' }]);
    let calls = 0;
    const out = render(s.doc, s.state);
    const run = await runResidueCheck(s.doc, s.state, out, { table: EMPTY, caseList: [], rules: registry,
      detect: (tmp) => { calls++; expect(tmp.parts.map((p) => p.text)).toEqual(out.sections.map((x) => x.text)); return makeDetect([])(tmp); } });
    expect(calls).toBe(1);
    expect(run.result.hits).toEqual([]);
  });

  it('sin secciones incluidas no hay impactos', async () => {
    const s = scenario([['cuerpo', 'Ana Ficticia Rojas.', 'Cuerpo', false]], []);
    const r = await check(s);
    expect(r.out.sections).toEqual([]);
    expect(r.run.result.hits).toEqual([]);
  });
});
