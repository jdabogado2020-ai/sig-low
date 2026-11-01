// D-16 (PB-3-r3) · Menciones ambiguas de la lista: lo ambiguo lo decide el abogado. Código puro de core/: sin DOM ni red.
//
// Una variante que comparten dos o más personas de la lista («Prueba», apellido de la madre y del hijo) nace pendiente, en una
// entidad propia y sin persona asignada (entities.ts). Es una decisión obligatoria del revisor: cuenta como pendiente para
// `exportGate` (puerta.ts) aunque la acepte, hasta que elija a la persona con «Unir con otra entidad» (`unir_entidades` hacia
// una de las `opciones`), la separe como otra persona (`separar_mencion`) o la rechace. El panel la presenta con M-2001.
// M-72 (PB-3-r4): también el apellido suelto de una persona de la lista que lleva otra persona del documento («Rojas», con «Luis
// Rojas» en el texto); esa otra persona es una opción más (`fuera`). Y D-16 en el modelo (PB-3-r4): la forma corta del modelo con
// dos o más anfitrionas posibles («Prueba», con «Rafael Prueba Cuervo» y otra persona «Prueba» en el texto); sus opciones son esas
// anfitrionas, las de la lista en `opciones` y las demás en `fuera`.
// No devuelve texto del documento: solo estados, claves e ids. Las candidatas salen de la lista del caso; para las opciones fuera
// de la lista se compara el texto de las detecciones (entities.ts, `otrasPersonasDelApellido` y `anfitrionasPosibles`).
import { anfitrionasPosibles, esAmbigua, esClaveAmbigua, otrasPersonasDelApellido } from '../entities.ts';
import { entidadesAmbiguasDeLaVariante, personasDeLaVariante } from '../caselist.ts';
import type { CaseEntity, CaseEntityId, Detection, DetectionId, DocumentModel, EntityId, Part, PartId, ReviewState } from '../types.ts';

/** Mensaje del catálogo para una mención ambigua (8.5, rango M-20xx de PB-3-r3): «elija a quién corresponde». */
export const MENSAJE_AMBIGUA = 'M-2001' as const;

export interface DecisionAmbigua {
  detectionId: DetectionId;
  /** Entidad propia de la mención mientras el revisor no elige: es la que se une con «Unir con otra entidad». */
  entityId: EntityId;
  /** Personas de la lista que comparten la variante, en el orden de la lista (de una forma corta del modelo: las personas de la
   *  lista entre sus anfitrionas posibles). */
  candidatas: CaseEntityId[];
  /** Entidades de esas personas en el documento, en el mismo orden: las sugerencias del revisor (`unir_entidades`). Una persona
   *  sin ninguna otra mención en el documento no tiene entidad: el revisor puede separar la mención o rechazarla. */
  opciones: EntityId[];
  /** M-72 · Entidades de otras personas del documento, fuera de la lista, que llevan ese apellido («Luis Rojas») o, de una forma
   *  corta del modelo, que la contienen: también se pueden elegir con `unir_entidades`. Vacío si no hay ninguna. */
  fuera: EntityId[];
  mensaje: typeof MENSAJE_AMBIGUA;
}

/** Menciones ambiguas sin decidir (no rechazadas y todavía en su entidad propia). */
export function contarAmbiguas(state: ReviewState): number {
  let n = 0;
  for (const d of Object.values(state.detections)) if (esAmbigua(state, d)) n++;
  return n;
}

/**
 * Las decisiones pendientes, en orden de lectura, con sus candidatas y sus opciones. Con `doc`, las anfitrionas de una forma corta del
 * modelo suman el nombre de pila del correo y el apodo que el texto introduce (como la correferencia).
 */
export function decisionesAmbiguas(state: ReviewState, caseList: readonly CaseEntity[], doc?: DocumentModel): DecisionAmbigua[] {
  const porCaso = new Map<CaseEntityId, EntityId>();
  for (const e of Object.values(state.entities)) {
    if (e.caseEntityId !== undefined && e.mentions.length > 0 && !esClaveAmbigua(e.canonicalKey) && !porCaso.has(e.caseEntityId)) {
      porCaso.set(e.caseEntityId, e.id);
    }
  }
  const parts = new Map<PartId, Part>((doc?.parts ?? []).map((p) => [p.id, p]));
  const orden = new Map(caseList.map((c, i) => [c.id, i]));
  const out: DecisionAmbigua[] = [];
  for (const id of state.order) {
    const d = state.detections[id] as Detection | undefined;
    if (d === undefined || !esAmbigua(state, d)) continue;
    let candidatas: CaseEntityId[];
    let fuera: EntityId[];
    if (d.source === 'lista') {
      // A-6 (CIERRE-1): entre una persona y una organización de la lista, o entre dos organizaciones, son esas entidades.
      const personas = personasDeLaVariante(d.text, caseList);
      const mixtas = entidadesAmbiguasDeLaVariante(d.text, caseList);
      candidatas = personas.length >= 2 || mixtas.length < 2 ? personas : mixtas;
      fuera = otrasPersonasDelApellido(state, d, caseList, parts.get(d.partId)?.kind);
    } else {
      const hosts = anfitrionasPosibles(state, d, caseList, parts);
      candidatas = [...new Set(hosts.flatMap((e) => e.caseEntityId ?? []))].sort((a, b) => (orden.get(a) ?? 0) - (orden.get(b) ?? 0));
      fuera = hosts.filter((e) => e.caseEntityId === undefined).map((e) => e.id);
    }
    const opciones = candidatas.flatMap((c) => porCaso.get(c) ?? []);
    out.push({ detectionId: d.id, entityId: d.entityId, candidatas, opciones, fuera, mensaje: MENSAJE_AMBIGUA });
  }
  return out;
}
