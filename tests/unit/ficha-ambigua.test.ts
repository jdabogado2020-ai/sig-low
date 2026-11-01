// CIERRE-1 (D-18, D-19.6) · La ficha de una mención ambigua (PC-3): M-2001 con un texto general y las opciones de fuera de la lista
// (`fuera`) a la vista junto a las de la lista. Funciones puras de presentación, sin DOM. Datos ficticios.
import { describe, expect, it } from 'vitest';
import { buildReviewState, personKey, precedenceOf } from '../../src/core/entities.ts';
import type { CaseEntity, CaseEntityId, DocId, DocumentModel, IdSource, MergedCandidate, PartId, TableIndex } from '../../src/core/types.ts';
import { t } from '../../src/ui/mensajes.ts';
import { fichaDeAmbigua } from '../../src/ui/review/base/presentacion.ts';
import { coincidencias } from '../e2e/lib/prohibidos.ts';

const EMPTY: TableIndex = { byKey: {}, counters: {}, documentCount: 0 };
const seqIds = (start: number): IdSource => { let n = start; return { next: (p) => `${p}_${(n++).toString(16).padStart(32, '0')}` }; };
function mkDoc(text: string): DocumentModel {
  const id = `doc_${'f'.repeat(32)}` as DocId;
  return { id, label: 'Documento 1', source: 'pegado', metadata: {} as DocumentModel['metadata'], warnings: [],
    parts: [{ id: `prt_${'e'.repeat(32)}` as PartId, docId: id, kind: 'cuerpo', label: 'cuerpo', order: 0, index: 1, text, included: true }] };
}
function per(doc: DocumentModel, sub: string, occ = 0, extra: Partial<MergedCandidate> = {}): MergedCandidate {
  const text = doc.parts[0]?.text ?? '';
  let i = -1;
  for (let k = 0; k <= occ; k++) i = text.indexOf(sub, i + 1);
  const c = { partId: doc.parts[0]?.id as PartId, start: i, end: i + sub.length, type: 'PERSONA' as const, source: 'modelo' as const, nerLabel: 'PER' as const,
    confidence: 'media' as const, score: 0.6, canonicalKey: personKey(sub), role: 'OTRA_PERSONA' as const, ...extra };
  return { ...c, precedence: precedenceOf(c) };
}

describe('CIERRE-1 · ficha de la mención ambigua (M-2001 general y `fuera` visible)', () => {
  it('M-2001 ya no dice «más de una persona de la lista del caso»: vale para M-72 y para la forma corta del modelo; sin textos prohibidos', () => {
    const texto = t('M-2001', { opciones: '[PERSONA_1], [PERSONA_2]' });
    expect(texto).not.toMatch(/de la lista del caso/u);
    expect(texto).toContain('[PERSONA_1], [PERSONA_2]');
    for (const id of ['M-2001', 'M-2002', 'M-2003', 'M-2004', 'M-2005'] as const) expect(coincidencias(t(id, { opciones: 'x', opcion: 'x' }))).toEqual([]);
  });

  it('D-16 en el modelo: la ficha muestra las dos anfitrionas, fuera de la lista, con sus marcadores en el aviso', () => {
    const doc = mkDoc('Rafael Prueba Cuervo firmó. Marta Prueba Ruiz revisó. Luego Prueba aprobó el plan.');
    const s = buildReviewState(doc, [per(doc, 'Rafael Prueba Cuervo'), per(doc, 'Marta Prueba Ruiz'), per(doc, 'Prueba', 2)], { table: EMPTY, caseList: [], ids: seqIds(1000) });
    const d = Object.values(s.detections).find((x) => x.text === 'Prueba') as (typeof s.detections)[keyof typeof s.detections];
    const f = fichaDeAmbigua(s, [], doc, d.id);
    expect(f?.opciones.map((o) => o.grupo)).toEqual(['fuera', 'fuera']);
    const marcas = f?.opciones.map((o) => o.marcador) ?? [];
    expect(marcas.every((m) => /^\[PERSONA_[0-9]+\]$/u.test(m))).toBe(true);
    expect(f?.aviso).toContain(marcas.join(', '));
    // Una mención que no es ambigua no tiene ficha de decisión.
    const r = Object.values(s.detections).find((x) => x.text === 'Rafael Prueba Cuervo');
    expect(r === undefined ? 'sin' : fichaDeAmbigua(s, [], doc, r.id)).toBeNull();
  });

  it('M-72: la persona de la lista va en el grupo de la lista y la otra persona del documento en el de fuera', () => {
    const CAS = 'cas_000000000000000000000000000000c7' as CaseEntityId;
    const lista: CaseEntity[] = [{ id: CAS, name: 'Martha Ejemplo', variants: [], kind: 'persona', role: 'DEMANDANTE' }];
    const doc = mkDoc('Martha Cecilia Ejemplo Ortiz demandó. Luis Ejemplo Ortiz contestó. Ejemplo Ortiz firmó.');
    const s = buildReviewState(doc, [per(doc, 'Martha Cecilia Ejemplo Ortiz'), per(doc, 'Luis Ejemplo Ortiz'), per(doc, 'Ejemplo Ortiz', 2)],
      { table: EMPTY, caseList: lista, ids: seqIds(2000) });
    const d = Object.values(s.detections).find((x) => x.text === 'Ejemplo Ortiz') as (typeof s.detections)[keyof typeof s.detections];
    const f = fichaDeAmbigua(s, lista, doc, d.id);
    expect(f?.opciones.map((o) => [o.grupo, s.entities[o.entityId]?.display])).toEqual([['lista', 'Martha Ejemplo'], ['fuera', 'Luis Ejemplo Ortiz']]);
  });
});
