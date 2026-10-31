// Acciones de la Revisión I: cada una llama al reductor por `despachar()` (6.4.4) y anuncia el resultado sin texto del documento
// (8.6.3: solo conteos, tipos, marcadores y etiquetas de partes). Un error del reductor queda en `error` (8.5.5, M-601 a M-606).
import type { DetectableType, DetectionId, EntityId, RejectReason, Role, Span } from '../../../core/types.ts';
import { t } from '../../mensajes.ts';
import { etiqueta } from '../../mensajes.ts';
import { anunciar, despachar, obtenerInstantanea } from './almacen.ts';
import { estadoEnMinusculas, nombreDeTipo, pendientesDe, pendientesTotales } from './presentacion.ts';
import { tx } from './textos.ts';

function anunciarMencion(id: DetectionId): void {
  const s = obtenerInstantanea().state;
  const d = s?.detections[id];
  if (d === undefined) return;
  anunciar(tx('M-1760', { tipo: nombreDeTipo(d.type), estado: estadoEnMinusculas(d) }));
}

export function aceptar(id: DetectionId): boolean {
  const r = despachar({ kind: 'aceptar', detectionId: id });
  if (r.ok) anunciarMencion(id);
  return r.ok;
}
export function rechazar(id: DetectionId, reason?: RejectReason): boolean {
  const r = despachar(reason === undefined ? { kind: 'rechazar', detectionId: id } : { kind: 'rechazar', detectionId: id, reason });
  if (r.ok) anunciarMencion(id);
  return r.ok;
}
export function restablecer(id: DetectionId): boolean {
  const r = despachar({ kind: 'restablecer', detectionId: id });
  if (r.ok) anunciarMencion(id);
  return r.ok;
}
export function editar(id: DetectionId, texto: string): boolean {
  const r = despachar({ kind: 'editar', detectionId: id, text: texto });
  if (r.ok) anunciarMencion(id);
  return r.ok;
}

/** «Aceptar todas las menciones ({n})» (M-74). Solo las pendientes de esa entidad (INV-R06). */
export function aceptarEntidad(id: EntityId): boolean {
  const antes = obtenerInstantanea().state;
  const e = antes?.entities[id];
  if (antes === null || e === undefined) return despachar({ kind: 'aceptar_entidad', entityId: id }).ok;
  const n = pendientesDe(antes, e);
  const r = despachar({ kind: 'aceptar_entidad', entityId: id });
  if (r.ok) {
    const despues = r.state.entities[id];
    anunciar(t('M-74', { n, marcador: despues?.marker ?? t('M-958'), p: pendientesTotales(r.state) }));
  }
  return r.ok;
}
export function rechazarEntidad(id: EntityId, reason?: RejectReason): boolean {
  const antes = obtenerInstantanea().state;
  const e = antes?.entities[id];
  const n = antes !== null && e !== undefined ? pendientesDe(antes, e) : 0;
  const tipo = e === undefined ? '' : nombreDeTipo(e.type);
  const r = despachar(reason === undefined ? { kind: 'rechazar_entidad', entityId: id } : { kind: 'rechazar_entidad', entityId: id, reason });
  if (r.ok) anunciar(tx('M-1761', { n, tipo, p: pendientesTotales(r.state) }));
  return r.ok;
}
export function cambiarRol(id: EntityId, role: Role): boolean {
  const e = obtenerInstantanea().state?.entities[id];
  const r = despachar({ kind: 'cambiar_rol', entityId: id, role });
  if (r.ok && e !== undefined) anunciar(tx('M-1765', { tipo: nombreDeTipo(e.type) }));
  return r.ok;
}
export function cambiarTipo(id: DetectionId, tipo: DetectableType): boolean {
  const r = despachar({ kind: 'cambiar_tipo', detectionId: id, type: tipo });
  if (r.ok) anunciar(tx('M-1764', { tipo: nombreDeTipo(tipo) }));
  return r.ok;
}
export function separar(id: DetectionId): boolean {
  const r = despachar({ kind: 'separar_mencion', detectionId: id });
  if (r.ok) anunciar(tx('M-1763'));
  return r.ok;
}
export function unir(desde: EntityId, hacia: EntityId): boolean {
  const e = obtenerInstantanea().state?.entities[hacia];
  const r = despachar({ kind: 'unir_entidades', fromId: desde, intoId: hacia });
  if (r.ok && e !== undefined) anunciar(tx('M-1762', { tipo: nombreDeTipo(e.type) }));
  return r.ok;
}
/** Marcador específico de TI, CE, PPT y PEP (M-177 y M-178). */
export function especificarDocumento(id: EntityId, especifico: boolean): boolean {
  const r = despachar({ kind: 'especificar_documento', entityId: id, especifico });
  if (r.ok) anunciar(t(especifico ? 'M-177' : 'M-178', { marcador: r.state.entities[id]?.marker ?? t('M-958') }));
  return r.ok;
}
/** Reemplazo manual por selección (6.4.4): detección `manual`, `precedence` 1, confianza alta, aceptada. */
export function agregarManual(span: Span, tipo: DetectableType, role: Role | undefined, propagate: boolean): boolean {
  const antes = obtenerInstantanea().state;
  const r = despachar(role === undefined ? { kind: 'agregar_manual', span, type: tipo, propagate } : { kind: 'agregar_manual', span, type: tipo, role, propagate });
  if (r.ok && antes !== null) {
    const n = Object.values(r.state.detections).filter((d) => d.source === 'manual').length
      - Object.values(antes.detections).filter((d) => d.source === 'manual').length;
    anunciar(tx('M-1766', { tipo: nombreDeTipo(tipo), n: Math.max(1, n) }));
  }
  return r.ok;
}

export function etiquetaDeRechazo(motivo: RejectReason): string {
  return etiqueta('rechazo', motivo);
}
