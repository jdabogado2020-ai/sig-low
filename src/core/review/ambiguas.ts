// D-16 (PB-3-r3) · Menciones ambiguas de la lista: lo ambiguo lo decide el abogado. Código puro de core/: sin DOM ni red.
//
// Una variante que comparten dos o más personas de la lista («Prueba», apellido de la madre y del hijo) nace pendiente, en una
// entidad propia y sin persona asignada (entities.ts). Es una decisión obligatoria del revisor: cuenta como pendiente para
// `exportGate` (puerta.ts) aunque la acepte, hasta que elija a la persona con «Unir con otra entidad» (`unir_entidades` hacia
// una de las `opciones`), la separe como otra persona (`separar_mencion`) o la rechace. El panel la presenta con M-2001.
// No lee texto del documento: solo estados, claves e ids; las candidatas salen de la lista del caso.
import { esAmbigua, esClaveAmbigua } from '../entities.ts';
import { personasDeLaVariante } from '../caselist.ts';
import type { CaseEntity, CaseEntityId, Detection, DetectionId, EntityId, ReviewState } from '../types.ts';

/** Mensaje del catálogo para una mención ambigua (8.5, rango M-20xx de PB-3-r3): «elija a quién corresponde». */
export const MENSAJE_AMBIGUA = 'M-2001' as const;

export interface DecisionAmbigua {
  detectionId: DetectionId;
  /** Entidad propia de la mención mientras el revisor no elige: es la que se une con «Unir con otra entidad». */
  entityId: EntityId;
  /** Personas de la lista que comparten la variante, en el orden de la lista. */
  candidatas: CaseEntityId[];
  /** Entidades de esas personas en el documento, en el mismo orden: las sugerencias del revisor (`unir_entidades`). Una persona
   *  sin ninguna otra mención en el documento no tiene entidad: el revisor puede separar la mención o rechazarla. */
  opciones: EntityId[];
  mensaje: typeof MENSAJE_AMBIGUA;
}

/** Menciones ambiguas sin decidir (no rechazadas y todavía en su entidad propia). */
export function contarAmbiguas(state: ReviewState): number {
  let n = 0;
  for (const d of Object.values(state.detections)) if (esAmbigua(state, d)) n++;
  return n;
}

/** Las decisiones pendientes, en orden de lectura, con sus candidatas y sus opciones. */
export function decisionesAmbiguas(state: ReviewState, caseList: readonly CaseEntity[]): DecisionAmbigua[] {
  const porCaso = new Map<CaseEntityId, EntityId>();
  for (const e of Object.values(state.entities)) {
    if (e.caseEntityId !== undefined && e.mentions.length > 0 && !esClaveAmbigua(e.canonicalKey) && !porCaso.has(e.caseEntityId)) {
      porCaso.set(e.caseEntityId, e.id);
    }
  }
  const out: DecisionAmbigua[] = [];
  for (const id of state.order) {
    const d = state.detections[id] as Detection | undefined;
    if (d === undefined || !esAmbigua(state, d)) continue;
    const candidatas = personasDeLaVariante(d.text, caseList);
    const opciones = candidatas.flatMap((c) => porCaso.get(c) ?? []);
    out.push({ detectionId: d.id, entityId: d.entityId, candidatas, opciones, mensaje: MENSAJE_AMBIGUA });
  }
  return out;
}
