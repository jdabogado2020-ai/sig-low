// F4 · Salida renderizada de prueba a partir de reemplazos por parte (como la arma `render`: segmentos contiguos que cubren todo
// el texto de la parte y de la sección). Solo datos ficticios.
import type { DocumentModel, OutputSection, Part, RenderedOutput } from '../../src/core/types';

export interface Reemplazo { ini: number; fin: number; nuevo: string }

export function salida(doc: DocumentModel, porParte: Map<Part, Reemplazo[]>): RenderedOutput {
  const sections: OutputSection[] = doc.parts.filter((x) => x.included).map((parte) => {
    const rs = [...(porParte.get(parte) ?? [])].sort((a, b) => a.ini - b.ini);
    let text = '';
    let pos = 0;
    const segments: OutputSection['segments'] = [];
    const copiar = (hasta: number): void => {
      if (hasta > pos) { segments.push({ outStart: text.length, outEnd: text.length + hasta - pos, partStart: pos, partEnd: hasta }); text += parte.text.slice(pos, hasta); }
    };
    for (const x of rs) {
      if (x.ini < pos) continue; // solapado: lo cubre el anterior
      copiar(x.ini);
      segments.push({ outStart: text.length, outEnd: text.length + x.nuevo.length, partStart: x.ini, partEnd: x.fin, detectionId: `det_${'0'.repeat(32)}` as never });
      text += x.nuevo;
      pos = x.fin;
    }
    copiar(parte.text.length);
    return { partId: parte.id, kind: parte.kind, label: parte.label, text, segments };
  });
  return { docId: doc.id, revision: 1, sections, withHeadings: sections.length > 1 };
}

/** Reemplaza todas las apariciones de cada valor en cada parte. */
export function reemplazarTodo(doc: DocumentModel, valores: Record<string, string>): RenderedOutput {
  const m = new Map<Part, Reemplazo[]>();
  for (const parte of doc.parts) {
    const rs: Reemplazo[] = [];
    for (const [v, nuevo] of Object.entries(valores)) {
      for (let i = parte.text.indexOf(v); i >= 0; i = parte.text.indexOf(v, i + v.length)) rs.push({ ini: i, fin: i + v.length, nuevo });
    }
    m.set(parte, rs);
  }
  return salida(doc, m);
}

/** Anotación del gold del corpus (10.2.1), lo que usan las pruebas de salida. */
export interface AnotacionGold { parte: { kind: string; index: number }; start: number; end: number; texto: string; tipo: string; es_negativo_esperado: boolean }

/** Salida con cada anotación positiva del gold reemplazada por `[TIPO_1]`. Las de partes que el lector no lee se omiten. */
export function salidaDeGold(doc: DocumentModel, anotaciones: AnotacionGold[]): RenderedOutput {
  const m = new Map<Part, Reemplazo[]>();
  for (const a of anotaciones) {
    if (a.es_negativo_esperado) continue;
    const parte = doc.parts.find((x) => x.kind === a.parte.kind && x.index === a.parte.index);
    if (parte === undefined || parte.text.slice(a.start, a.end) !== a.texto) continue;
    const l = m.get(parte) ?? [];
    l.push({ ini: a.start, fin: a.end, nuevo: `[${a.tipo}_1]` });
    m.set(parte, l);
  }
  return salida(doc, m);
}
