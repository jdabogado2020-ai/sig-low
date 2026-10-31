// Estado en memoria [M] de la sesión (6.6.5): lista del caso y tabla de correspondencia en claro.
// Se vacía en bloqueo, «Cerrar asunto», `pagehide` y «Borrar todo» (INV-G09). Nunca se serializa: solo la bóveda
// (módulo `vault`, cifrado) puede persistirla. Las demás pantallas registran aquí lo que deben vaciar con registrarLimpieza().
import { useEffect, useState } from 'preact/hooks';
import type { AsuntoId, CaseEntity, MappingTable } from '../core/types.ts';
import type { MessageId, MsgParam } from './mensajes.ts';

let listaDelCaso: CaseEntity[] = [];
let tabla: MappingTable | null = null;
/** Avisos persistentes del asunto abierto (M-14, M-21, M-22, M-91…); se vacían con el estado [M]. */
export interface AvisoAsunto { id: MessageId; params?: Readonly<Record<string, MsgParam>> }
let avisosAsunto: AvisoAsunto[] = [];
const oyentes = new Set<() => void>();
const limpiezas = new Set<() => void>();
const avisar = (): void => { for (const o of [...oyentes]) o(); };

export function obtenerListaDelCaso(): readonly CaseEntity[] {
  return listaDelCaso;
}
export function fijarListaDelCaso(lista: readonly CaseEntity[]): void {
  listaDelCaso = [...lista];
  avisar();
}
export function obtenerTabla(): MappingTable | null {
  return tabla;
}
export function fijarTabla(t: MappingTable | null): void {
  tabla = t;
  avisar();
}
/** Tabla vacía de un asunto nuevo (6.6.3). */
export function tablaVacia(asuntoId: AsuntoId): MappingTable {
  return { asuntoId, counters: {}, entries: {}, documents: [] };
}
export function obtenerAvisosAsunto(): readonly AvisoAsunto[] {
  return avisosAsunto;
}
export function agregarAvisoAsunto(a: AvisoAsunto): void {
  avisosAsunto = [...avisosAsunto.filter((x) => x.id !== a.id), a];
  avisar();
}
export function quitarAvisoAsunto(id: MessageId): void {
  avisosAsunto = avisosAsunto.filter((x) => x.id !== id);
  avisar();
}
export function suscribirSesion(fn: () => void): () => void {
  oyentes.add(fn);
  return () => { oyentes.delete(fn); };
}
/** Lo que una pantalla guarda en memoria [M] (documento, revisión, salida) se vacía aquí. Devuelve la baja. */
export function registrarLimpieza(fn: () => void): () => void {
  limpiezas.add(fn);
  return () => { limpiezas.delete(fn); };
}
/**
 * Formularios con una frase de paso escrita fuera de un asunto abierto (Inicio, M-7). Con alguno, el bloqueo por inactividad
 * corre aunque no haya asunto: una frase escrita y olvidada no queda en pantalla para quien llegue después (6.6.5). Solo se
 * guarda quién tiene frase, nunca la frase.
 */
const frasesEscritas = new Set<object>();
export function marcarFraseEscrita(formulario: object, escrita: boolean): void {
  if (escrita) frasesEscritas.add(formulario);
  else frasesEscritas.delete(formulario);
}
export function hayFraseEscrita(): boolean {
  return frasesEscritas.size > 0;
}
/**
 * Vacía todo el estado [M] (INV-G09). Cada limpieza registrada corre aunque otra falle. Inicio registra la suya: vuelve a montar
 * sus formularios, con los campos de frase vacíos (M-7).
 */
export function vaciarEstadoM(): void {
  for (const l of [...limpiezas]) {
    try { l(); } catch { /* una limpieza que falla no detiene a las demás; el error no lleva contenido */ }
  }
  listaDelCaso = [];
  tabla = null;
  avisosAsunto = [];
  frasesEscritas.clear();
  avisar();
}
export function useAvisosAsunto(): readonly AvisoAsunto[] {
  const [, forzar] = useState(0);
  useEffect(() => suscribirSesion(() => { forzar((n) => n + 1); }), []);
  return avisosAsunto;
}
export function useListaDelCaso(): readonly CaseEntity[] {
  const [, forzar] = useState(0);
  useEffect(() => suscribirSesion(() => { forzar((n) => n + 1); }), []);
  return listaDelCaso;
}
