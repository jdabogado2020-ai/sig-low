// «Siguiente pendiente» y «Anterior pendiente» (8.2.6): recorren las detecciones `pendiente` y las banderas sin confirmar en orden
// de lectura (part.order, start). Una detección se selecciona y se enfoca en el texto (irA); una bandera abre su pestaña, enfoca
// su tarjeta y deja su ubicación a la vista. Las teclas N y Mayús+N de PC-3 llegan aquí por `registrarRecorrido`.
import type { DetectionId, DocumentModel, FlagId, ReviewState } from '../../../core/types.ts';
import { obtenerDocumento, obtenerRevision } from '../../documento.ts';
import { irA, obtenerInstantanea, registrarRecorrido, seleccionar } from '../base/almacen.ts';
import { irAUbicacion, pedirFocoDeTarjeta } from './herramientas.ts';

export type Pendiente =
  | { tipo: 'det'; id: DetectionId; orden: number; start: number }
  | { tipo: 'ban'; id: FlagId; orden: number; start: number };

/** Pendientes en orden de lectura: detecciones `pendiente` (sin cubrir) y banderas sin `acknowledged`. */
export function pendientesEnOrden(doc: DocumentModel, st: ReviewState): Pendiente[] {
  const orden = new Map(doc.parts.map((p) => [p.id as string, p.order]));
  const lista: Pendiente[] = [];
  for (const d of Object.values(st.detections)) {
    if (d.status === 'pendiente' && d.coveredBy === undefined) lista.push({ tipo: 'det', id: d.id, orden: orden.get(d.partId) ?? 0, start: d.start });
  }
  for (const f of Object.values(st.flags)) {
    if (!f.acknowledged) lista.push({ tipo: 'ban', id: f.id, orden: orden.get(f.span.partId) ?? 0, start: f.span.start });
  }
  return lista.sort((a, b) => a.orden - b.orden || a.start - b.start || (a.tipo === b.tipo ? 0 : a.tipo === 'det' ? -1 : 1) || a.id.localeCompare(b.id));
}

/** Siguiente (1) o anterior (-1) pendiente respecto de `desde`, dando la vuelta; `null` si no queda ninguno. */
export function adyacente(lista: readonly Pendiente[], desde: { orden: number; start: number } | null, direccion: 1 | -1): Pendiente | null {
  if (lista.length === 0) return null;
  const antes = (p: Pendiente): boolean => desde !== null && (p.orden < desde.orden || (p.orden === desde.orden && p.start < desde.start));
  if (direccion === 1) {
    const sig = lista.find((p) => desde === null || !(antes(p) || (p.orden === desde.orden && p.start === desde.start)));
    return sig ?? (lista[0] as Pendiente);
  }
  const previos = lista.filter((p) => desde === null ? false : antes(p));
  return previos.length > 0 ? (previos[previos.length - 1] as Pendiente) : (lista[lista.length - 1] as Pendiente);
}

/** Última bandera a la que se fue con este recorrido: referencia cuando no hay mención seleccionada. */
let ultimaBandera: { orden: number; start: number } | null = null;

export function irAlPendiente(direccion: 1 | -1): DetectionId | null {
  const doc = obtenerDocumento();
  const st = obtenerRevision();
  if (doc === null || st === null) return null;
  const lista = pendientesEnOrden(doc, st);
  const sel = obtenerInstantanea().seleccion;
  const d = sel === null ? undefined : st.detections[sel];
  let desde: { orden: number; start: number } | null = ultimaBandera;
  if (d !== undefined) desde = { orden: doc.parts.find((p) => p.id === d.partId)?.order ?? 0, start: d.start };
  const destino = adyacente(lista, desde, direccion);
  if (destino === null) return null;
  if (destino.tipo === 'det') {
    ultimaBandera = null;
    irA(destino.id);
    return destino.id;
  }
  const f = st.flags[destino.id];
  if (f === undefined) return null;
  ultimaBandera = { orden: destino.orden, start: destino.start };
  seleccionar(null);
  pedirFocoDeTarjeta('ban', destino.id);
  irAUbicacion(f.span);
  return null;
}

registrarRecorrido(irAlPendiente);
