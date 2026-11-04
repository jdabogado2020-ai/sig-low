// F3 (D-24) · Modelo de la vista previa editable (src/ui/vista/modelo-vista.ts), estructura del .docx (estructura-docx.ts) y puntos
// para revisar (puntos.ts). Lo que se muestra es la salida de `render`: ningún dato oculto aparece en un trozo, y las marcas de
// «a la vista» y «para revisar» solo van sobre texto que ya está a la vista. Datos ficticios evidentes.
import { describe, expect, it } from 'vitest';
import { render } from '../../src/core/render';
import type { Detection, DocumentModel, Entity, Flag, PartId, ResidueResult, ReviewState } from '../../src/core/types';
import { exportGate } from '../../src/core/review/puerta';
import { confirmacionVigente, marcarConfirmacion, obtenerListo } from '../../src/ui/listo/almacen';
import { agrupar, construirVista, type EstructuraParte } from '../../src/ui/vista/modelo-vista';
import { estructuraDocx } from '../../src/ui/vista/estructura-docx';
import { indirectosATalCual, puntosParaRevisar } from '../../src/ui/vista/puntos';
import { leerDocxMapeado } from '../../src/io/docx-read';
import { IO_LIMITS_POR_DEFECTO } from '../../src/io/io-client';
import { construirDocx } from '../fixtures/docx/docx-builder';

const P = 'prt_00000000000000000000000000000001' as PartId;
const TEXTO = 'Demandante: Ana Ficticia Rojas\nCédula 1.000.000.017 de Prueba.\nCargo: gerente.';

function doc(texto = TEXTO): DocumentModel {
  return {
    id: 'doc_00000000000000000000000000000001', label: 'Documento 1', source: 'pegado', metadata: { categories: {} }, warnings: [],
    parts: [{ id: P, docId: 'doc_00000000000000000000000000000001', kind: 'cuerpo', label: 'Cuerpo', order: 0, index: 1, text: texto, included: true }],
  } as unknown as DocumentModel;
}
const det = (id: string, sub: string, type: Detection['type'], status: Detection['status'], extra: Partial<Detection> = {}): Detection => {
  const i = TEXTO.indexOf(sub);
  return { id, docId: 'doc_00000000000000000000000000000001', partId: P, start: i, end: i + sub.length, text: sub, type, source: 'regla',
    precedence: 3, confidence: 'alta', score: 0.9, canonicalKey: `K:${id}`, status, entityId: `ent_${id}`, replacement: { proposedTemplate: '{m}' }, ...extra } as Detection;
};
function estado(ds: Detection[], flags: Flag[] = []): ReviewState {
  const entities: Record<string, Entity> = {};
  ds.forEach((d, i) => {
    entities[d.entityId] = { id: d.entityId, canonicalKey: d.canonicalKey, type: d.type, family: d.type === 'CC' ? 'CC' : 'PERSONA', marcadorEspecifico: false,
      mentions: [d.id], sameHolderAs: [], display: '', marker: d.type === 'CC' ? `[CC_${i + 1}]` : `[DEMANDANTE_${i + 1}]` } as unknown as Entity;
  });
  return { docId: 'doc_00000000000000000000000000000001', revision: 3, detections: Object.fromEntries(ds.map((d) => [d.id, d])), order: ds.map((d) => d.id),
    entities, suggestions: {}, flags: Object.fromEntries(flags.map((f) => [f.id, f])), spanEdits: {}, committed: false,
    modelo: { kind: 'plan_b', causa: 'desactivado' } } as unknown as ReviewState;
}
const textos = (v: ReturnType<typeof construirVista>): string[] => v.secciones.flatMap((s) => s.bloques.flatMap((b) => b.trozos.map((z) => z.texto)));

describe('F3 · vista previa: el documento ya anonimizado, partido en bloques y trozos', () => {
  it('D-24 cada etiqueta lleva su detección y ningún dato oculto aparece en un trozo; sin estructura, una línea por párrafo', () => {
    const d = doc();
    const s = estado([det('det_1', 'Ana Ficticia Rojas', 'PERSONA', 'aceptada'), det('det_2', '1.000.000.017', 'CC', 'aceptada')]);
    const v = construirVista(render(d, s), s, d.parts);
    expect(v.secciones[0]?.bloques).toHaveLength(3);
    const etiquetas = v.secciones[0]?.bloques.flatMap((b) => b.trozos.filter((z) => z.tipo === 'etiqueta')) ?? [];
    expect(etiquetas.map((z) => [z.texto, z.det])).toEqual([['[DEMANDANTE_1]', 'det_1'], ['[CC_2]', 'det_2']]);
    const todo = textos(v).join('');
    expect(todo).not.toContain('Ana Ficticia');
    expect(todo).not.toContain('1.000.000.017');
    expect(todo).toBe(render(d, s).sections[0]?.text.replace(/\n/gu, ''));
  });

  it('D-24 un dato que el revisor dejó a la vista se marca «revelado» con su detección; una bandera sin confirmar, «revisar»', () => {
    const d = doc();
    const i = TEXTO.indexOf('gerente');
    const cargo = { id: 'flg_1', type: 'CARGO', span: { partId: P, start: i, end: i + 7 }, text: 'gerente', reason: 'LISTA_CARGOS', options: [], acknowledged: false } as unknown as Flag;
    const s = estado([det('det_1', 'Ana Ficticia Rojas', 'PERSONA', 'rechazada'), det('det_2', '1.000.000.017', 'CC', 'aceptada')], [cargo]);
    const v = construirVista(render(d, s), s, d.parts);
    const trozos = v.secciones[0]?.bloques.flatMap((b) => b.trozos) ?? [];
    expect(trozos.find((z) => z.tipo === 'revelado')).toMatchObject({ texto: 'Ana Ficticia Rojas', det: 'det_1' });
    expect(trozos.find((z) => z.tipo === 'revisar')).toMatchObject({ texto: 'gerente', flag: 'flg_1' });
    expect(puntosParaRevisar(s, new Set()).map((p) => p.motivo)).toEqual(['bandera']);
  });

  it('D-24 con la estructura de un .docx: títulos, negrita y celdas de tabla agrupadas en una tabla', () => {
    const d = doc('TÍTULO\nuno\tdos\ntres');
    const est: EstructuraParte = {
      parrafos: [{ ini: 0, fin: 6, tipo: 'titulo1' }, { ini: 7, fin: 10, tipo: 'p', celda: { tabla: 0, fila: 0, col: 0 } },
        { ini: 11, fin: 14, tipo: 'p', celda: { tabla: 0, fila: 0, col: 1 } }, { ini: 15, fin: 19, tipo: 'p', celda: { tabla: 0, fila: 1, col: 0 } }],
      estilos: [{ ini: 0, fin: 6, estilo: { negrita: true } }],
    };
    const s = estado([]);
    const v = construirVista(render(d, s), s, d.parts, new Map([[P, est]]));
    const grupos = agrupar(v.secciones[0]?.bloques ?? []);
    expect(grupos.map((g) => g.tipo)).toEqual(['bloque', 'tabla']);
    expect(grupos[0]?.tipo === 'bloque' && grupos[0].bloque.trozos[0]).toMatchObject({ texto: 'TÍTULO', estilo: { negrita: true } });
    expect(grupos[1]?.tipo === 'tabla' && grupos[1].filas.map((f) => f.length)).toEqual([2, 1]);
  });

  it('D-24 estructura del .docx original: título y negrita salen del XML (mapa de F4), sin texto del documento', () => {
    const bytes = construirDocx({ cuerpo: [
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Contrato de prueba</w:t></w:r></w:p>',
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Ana Ficticia Rojas</w:t></w:r><w:r><w:t> firma.</w:t></w:r></w:p>',
    ].join('') });
    const m = leerDocxMapeado(bytes, { docId: 'doc_00000000000000000000000000000002' as DocumentModel['id'], label: 'Documento 1' }, IO_LIMITS_POR_DEFECTO);
    const e = estructuraDocx(bytes, m.modelo);
    const parte = m.modelo.parts.find((p) => p.kind === 'cuerpo');
    const est = parte === undefined ? undefined : e.get(parte.id);
    expect(est?.parrafos.map((p) => p.tipo)).toEqual(['titulo1', 'p']);
    expect(est?.estilos).toEqual([{ ini: 19, fin: 37, estilo: { negrita: true } }]);
    expect(JSON.stringify(est)).not.toContain('Ficticia');
  });

  it('D-24 puntos para revisar: poca certeza, ambigua separada por la propuesta y dato que se escapó, en orden de lectura', () => {
    const baja = det('det_1', 'Ana Ficticia Rojas', 'PERSONA', 'aceptada', { confidence: 'baja', decidedBy: 'propuesta' });
    const amb = det('det_2', 'Prueba', 'PERSONA', 'aceptada', { decidedBy: 'propuesta' });
    const esc = det('det_3', '1.000.000.017', 'CC', 'aceptada', { decidedBy: 'propuesta' });
    const s = estado([baja, esc, amb]);
    (s.entities as Record<string, Entity>)['ent_det_2']!.canonicalKey = 'PER:prueba~sep:det_2';
    s.order = ['det_1', 'det_3', 'det_2'] as unknown as ReviewState['order'];
    expect(puntosParaRevisar(s, new Set(['det_3'])).map((p) => [p.motivo, p.det])).toEqual([['certeza', 'det_1'], ['escapado', 'det_3'], ['ambigua', 'det_2']]);
    // Lo que el revisor mostró no es un punto.
    (s.detections as Record<string, Detection>)['det_1'] = { ...baja, status: 'rechazada' };
    expect(puntosParaRevisar(s, new Set()).map((p) => p.det)).toEqual(['det_2']);
  });
});

describe('B-150 (P0-6a de F2+F3) · la confirmación vale para la revisión en la que se marcó', () => {
  it('INV-G06 confirmar y después cambiar algo deja la puerta cerrada con RECORDATORIO hasta confirmar de nuevo', () => {
    const s = estado([det('det_1', '1.000.000.017', 'CC', 'aceptada')]);
    marcarConfirmacion(true, s.revision);
    expect(confirmacionVigente(s, obtenerListo())).toEqual({ revisado: true });
    const cambiado = { ...s, revision: s.revision + 1 } as ReviewState;
    expect(confirmacionVigente(cambiado, obtenerListo())).toEqual({ revisado: false });
    const residuo = { revision: cambiado.revision, ranAt: '2026-11-03T21:00:00-05:00', valuesSearched: 1, modes: ['literal'], hits: [], newDetections: 0 } as ResidueResult;
    expect(exportGate(cambiado, residuo, confirmacionVigente(cambiado, obtenerListo())).reasons).toEqual(['RECORDATORIO']);
    marcarConfirmacion(true, cambiado.revision);
    expect(exportGate(cambiado, residuo, confirmacionVigente(cambiado, obtenerListo())).ok).toBe(true);
    marcarConfirmacion(false);
  });
});

describe('M-141 (P0-6a de F2+F3) · un hecho llamativo sin decidir no cierra la puerta, pero se cuenta', () => {
  it('INV-G06 D-24 el hecho llamativo sin opción sale tal cual: es punto para revisar y Descargar lo cuenta; oculto encima, ya no', () => {
    const i = TEXTO.indexOf('gerente');
    const hecho = { id: 'flg_2', type: 'HECHO_LLAMATIVO', span: { partId: P, start: i, end: i + 7 }, text: 'gerente', reason: 'LISTA_LLAMATIVOS', options: [], acknowledged: false } as unknown as Flag;
    const s = estado([det('det_2', '1.000.000.017', 'CC', 'aceptada')], [hecho]);
    expect(indirectosATalCual(s)).toBe(1);
    expect(puntosParaRevisar(s, new Set()).map((p) => p.motivo)).toEqual(['bandera']);
    const residuo = { revision: s.revision, ranAt: '2026-11-03T21:00:00-05:00', valuesSearched: 1, modes: ['literal'], hits: [], newDetections: 0 } as ResidueResult;
    expect(exportGate(s, residuo, { revisado: true }).ok).toBe(true);
    const oculto = estado([det('det_2', '1.000.000.017', 'CC', 'aceptada'), det('det_3', 'gerente', 'PERSONA', 'aceptada', { source: 'manual' })], [hecho]);
    expect(indirectosATalCual(oculto)).toBe(0);
    expect(puntosParaRevisar(oculto, new Set())).toEqual([]);
  });
});
