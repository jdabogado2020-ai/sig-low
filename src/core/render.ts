// Render de la salida y texto único para copiar o exportar (plan 6.9, 7.13.1). PB-4.
// Código puro de core/: sin DOM ni red. El texto original solo vive en `Part.text` y en `OutputSection.text` [M].
import type {
  Detection, DetectionId, DocumentModel, Entity, JoinOutputFn, OutputSection, OutputSegment, Part, PartId, RenderFn,
  RenderedOutput, ReviewState, SpanEdit, SpanEditId,
} from './types.ts';

const TEMPLATE_M = '{m}';

/** Un reemplazo ya resuelto sobre `Part.text`: [start, end) se sustituye por `text`. */
interface Replacement1 {
  start: number;
  end: number;
  text: string;
  detectionId?: DetectionId;
  spanEditId?: SpanEditId;
}

/**
 * PB-4-r1 · El tramo termina en el punto de una abreviatura («Ficticia S.A.», «A. E. O.») y ese punto también cierra la oración:
 * después vienen el fin de la parte, un salto de línea o un blanco y una mayúscula (con comillas o paréntesis de cierre en medio).
 */
const RE_FIN_DE_ORACION = /^(?:$|[ \t]*\r?\n|[ \t]+["»”’)\]]*[ \t]*\p{Lu})/u;
export function cierraOracion(text: string, start: number, end: number): boolean {
  return end > start && text.charAt(end - 1) === '.' && RE_FIN_DE_ORACION.test(text.slice(end, end + 8));
}

/**
 * 7.13.1.2 · Texto de un reemplazo: editada → edited; si no → plantilla con `{m}` = marcador vigente. Si el tramo se llevó el punto
 * que cierra la oración (el de «S.A.», PB-2-r6), la salida lo repone tras el marcador: «contra [EMPRESA_1]. El juez».
 */
function detectionText(d: Detection, entity: Entity | undefined, text: string): string {
  if (d.status === 'editada' && d.replacement.edited !== undefined) return d.replacement.edited;
  const template = d.replacement.generalized?.template ?? d.replacement.proposedTemplate;
  const out = template.split(TEMPLATE_M).join(entity?.marker ?? '');
  return cierraOracion(text, d.start, d.end) && !out.endsWith('.') ? `${out}.` : out;
}

/** 7.13.1.1 · Detecciones aceptadas o editadas sin `coveredBy` (y las pendientes, como vista previa) y todas las ediciones de tramo. */
function collectReplacements(state: ReviewState, partId: PartId, text: string): Replacement1[] {
  const out: Replacement1[] = [];
  const textLength = text.length;
  for (const d of Object.values(state.detections)) {
    if (d.partId !== partId) continue;
    if (d.status === 'rechazada') continue;
    // Una detección solo queda cubierta si su edición de tramo existe: si no, se reemplaza (nunca se deja pasar el original).
    if (d.coveredBy !== undefined && state.spanEdits[d.coveredBy] !== undefined) continue;
    if (!(d.start >= 0 && d.end > d.start && d.end <= textLength)) continue;
    out.push({ start: d.start, end: d.end, text: detectionText(d, state.entities[d.entityId], text), detectionId: d.id });
  }
  for (const e of Object.values(state.spanEdits) as SpanEdit[]) {
    if (e.span.partId !== partId) continue;
    if (!(e.span.start >= 0 && e.span.end > e.span.start && e.span.end <= textLength)) continue;
    out.push({ start: e.span.start, end: e.span.end, text: e.text, spanEditId: e.id });
  }
  // Por INV-R02 no hay solapes; ante un estado inconsistente gana el tramo que empieza antes (y el más ancho).
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Replacement1[] = [];
  let last = 0;
  for (const r of out) {
    if (r.start < last) continue;
    kept.push(r);
    last = r.end;
  }
  return kept;
}

/**
 * 7.13.1 · Aplica los reemplazos de cada parte incluida, en orden canónico. El plan los aplica de derecha a izquierda
 * sobre una copia para no correr posiciones pendientes; aquí se recorre el texto de izquierda a derecha con las
 * mismas posiciones de `Part.text`, que da el mismo texto y arma los `OutputSegment` sin huecos (INV-X01).
 */
export const render: RenderFn = (doc: DocumentModel, state: ReviewState): RenderedOutput => {
  const parts: Part[] = doc.parts.filter((p) => p.included).sort((a, b) => a.order - b.order);
  const sections: OutputSection[] = parts.map((part) => {
    const text = part.text;
    const reps = collectReplacements(state, part.id, text);
    const segments: OutputSegment[] = [];
    let out = '';
    let cursor = 0;
    const copy = (to: number): void => {
      if (to <= cursor) return;
      segments.push({ outStart: out.length, outEnd: out.length + (to - cursor), partStart: cursor, partEnd: to });
      out += text.slice(cursor, to);
      cursor = to;
    };
    for (const r of reps) {
      copy(r.start);
      const seg: OutputSegment = { outStart: out.length, outEnd: out.length + r.text.length, partStart: r.start, partEnd: r.end };
      if (r.detectionId !== undefined) seg.detectionId = r.detectionId;
      if (r.spanEditId !== undefined) seg.spanEditId = r.spanEditId;
      segments.push(seg);
      out += r.text;
      cursor = r.end;
    }
    copy(text.length);
    return { partId: part.id, kind: part.kind, label: part.label, text: out, segments };
  });
  return { docId: doc.id, revision: state.revision, sections, withHeadings: sections.length > 1 };
};

/**
 * 6.9 · Texto único: con `withHeadings`, por sección la línea `=== rótulo ===` y su texto, separadas por una línea vacía.
 * Todo salto de línea del resultado es `eol` (portapapeles '\n'; archivos '\r\n', INV-X02).
 */
export const joinOutput: JoinOutputFn = (out: RenderedOutput, eol: '\n' | '\r\n'): string => {
  const lines = (s: string): string => s.replace(/\r\n|\r|\n/gu, eol);
  if (!out.withHeadings) return out.sections.map((s) => lines(s.text)).join(eol + eol);
  return out.sections.map((s) => lines('=== ' + s.label + ' ===') + eol + lines(s.text)).join(eol + eol);
};
