// F3 (D-24) · «Puntos para revisar» de la vista previa: lo que conviene mirar aunque ya esté aplicado. No obliga a nada ni cierra la
// puerta: es un recorrido con «Siguiente». Código puro: solo estados, tipos e ids, nunca texto del documento.
//   - datos encontrados con poca certeza (confianza baja), aún ocultos;
//   - menciones que pueden ser de más de una persona y que la propuesta separó como persona aparte (D-15, D-16);
//   - datos indirectos sin decidir (banderas sin confirmar): sobre todo el hecho llamativo, que no trae con qué reemplazarlo y sale
//     tal cual (M-141), y la cita, con su número oculto;
//   - datos que se escaparon y la búsqueda volvió a ocultar.
import type { DetectionId, Flag, FlagId, ReviewState } from '../../core/types.ts';

export type MotivoPunto = 'certeza' | 'ambigua' | 'bandera' | 'escapado';
export interface Punto { motivo: MotivoPunto; det?: DetectionId; flag?: FlagId; orden: number }

/** Marca de la entidad propia que `aplicar_propuesta` da a una mención ambigua (entities.ts). */
const SEPARADA_POR_PROPUESTA = '~sep:';

/**
 * M-141 (P0-6a de F2+F3, decisión del integrador dentro de D-24) · Datos indirectos sin decidir cuyo texto sale tal cual (el hecho
 * llamativo, o una bandera cuyo reemplazo no se pudo aplicar). No cierran la puerta: Descargar los cuenta junto a la confirmación.
 */
export function indirectosATalCual(state: ReviewState): number {
  return Object.values(state.flags).filter((f) => !f.acknowledged && !textoOculto(state, f)).length;
}

/** El texto de la bandera ya no sale: lo oculta su detección vinculada, una edición de tramo o un dato que el abogado ocultó encima. */
function textoOculto(state: ReviewState, f: Flag): boolean {
  if (f.spanEditId !== undefined && state.spanEdits[f.spanEditId] !== undefined) return true;
  return Object.values(state.detections).some((d) => d.status !== 'rechazada' && d.partId === f.span.partId
    && d.start <= f.span.start && d.end >= f.span.end);
}

export function puntosParaRevisar(state: ReviewState, escapadas: ReadonlySet<string>): Punto[] {
  const pos = new Map(state.order.map((id, i) => [id, i]));
  const out: Punto[] = [];
  const vistos = new Set<string>();
  for (const id of state.order) {
    const d = state.detections[id];
    if (d === undefined || d.status === 'rechazada') continue;
    const e = state.entities[d.entityId];
    let motivo: MotivoPunto | null = null;
    if (escapadas.has(d.id)) motivo = 'escapado';
    else if (d.decidedBy === 'propuesta' && (e?.canonicalKey.includes(SEPARADA_POR_PROPUESTA) ?? false)) motivo = 'ambigua';
    else if (d.confidence === 'baja' && d.status !== 'editada') motivo = 'certeza';
    if (motivo === null) continue;
    vistos.add(d.id);
    out.push({ motivo, det: d.id, orden: pos.get(d.id) ?? 0 });
  }
  for (const f of Object.values(state.flags)) {
    if (f.acknowledged) continue;
    // La bandera de una detección oculta (la cita con su número) se recorre sobre esa etiqueta.
    const det = f.detectionId !== undefined && state.detections[f.detectionId]?.status !== 'rechazada' ? f.detectionId : undefined;
    if (det === undefined && textoOculto(state, f)) continue;   // el abogado ya lo ocultó con «Ocultar este texto»
    const orden = det !== undefined ? (pos.get(det) ?? 0)
      : (state.order.findIndex((x) => { const d = state.detections[x]; return d !== undefined && d.partId === f.span.partId && d.start >= f.span.start; }) + 0.5);
    if (det !== undefined && vistos.has(det)) continue;
    out.push(det !== undefined ? { motivo: 'bandera', flag: f.id, det, orden } : { motivo: 'bandera', flag: f.id, orden: orden < 0 ? state.order.length : orden });
  }
  return out.sort((a, b) => a.orden - b.orden);
}
