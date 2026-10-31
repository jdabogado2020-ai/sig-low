// Estado de la pantalla Reinserción (PC-6) [M]: la respuesta de la IA, los marcadores encontrados, las decisiones del abogado y el
// texto reinsertado con datos reales (`ReinsertionResult`). Nada de esto se serializa (INV-N04): se vacía al salir de la pantalla, en
// el bloqueo, «Cerrar asunto», «Borrar todo» y `pagehide` por `registrarLimpieza()` (INV-G09, 6.6.5).
import { useEffect, useState } from 'preact/hooks';
import { buildReinsertion, findMarkers } from '../../core/reinsert.ts';
import type { MappingTable, MarkerMatch, ReinsertionDecision, ReinsertionResult } from '../../core/types.ts';
import { canonico } from '../../io/txt-read.ts';
import type { MessageId, MsgParam } from '../mensajes.ts';
import { registrarLimpieza } from '../sesion.ts';
import { entradaDe, origenDe } from './modelo.ts';

export interface AvisoReinsercion { id: MessageId; params?: Readonly<Record<string, MsgParam>>; rol: 'status' | 'alert' }

export interface EstadoReinsercion {
  /** Lo que el abogado pegó, tal cual. */
  respuesta: string;
  /** Valor del `select` de origen: un `docId` o '' («No sé o son varios», M-93). */
  origen: string;
  /** Marcadores encontrados en el texto canónico de la respuesta; null mientras no se haya pulsado «Buscar marcadores». */
  matches: MarkerMatch[] | null;
  /** Texto canónico sobre el que se midieron las posiciones de `matches`. */
  canonica: string;
  decisiones: Record<string, ReinsertionDecision>;
  faltantesReconocidos: boolean;
  /** Resultado vigente (null antes de buscar). `text` es [M] con datos reales. */
  resultado: ReinsertionResult | null;
  /** Hubo una copia con el botón o con Ctrl + C: habilita «Vaciar portapapeles». */
  copiado: boolean;
  avisos: readonly AvisoReinsercion[];
  /** `writeText` falló o no existe: se muestra el área de respaldo con este texto (M-87). [M] */
  respaldo: string | null;
}

const inicial = (): EstadoReinsercion => ({
  respuesta: '', origen: '', matches: null, canonica: '', decisiones: {}, faltantesReconocidos: false, resultado: null,
  copiado: false, avisos: [], respaldo: null,
});

let estado: EstadoReinsercion = inicial();
let tablaVigente: MappingTable | null = null;
const oyentes = new Set<() => void>();
const avisar = (): void => { for (const o of [...oyentes]) o(); };

export function obtenerReinsercion(): EstadoReinsercion {
  return estado;
}
export function actualizarReinsercion(parche: Partial<EstadoReinsercion>): void {
  estado = { ...estado, ...parche };
  avisar();
}
export function useReinsercion(): EstadoReinsercion {
  const [, forzar] = useState(0);
  useEffect(() => {
    const f = (): void => { forzar((n) => n + 1); };
    oyentes.add(f);
    return () => { oyentes.delete(f); };
  }, []);
  return estado;
}

/** Vacía el estado [M] (salir de la pantalla, bloqueo, `pagehide`, «Borrar todo»). */
export function vaciarReinsercion(): void {
  estado = inicial();
  tablaVigente = null;
  avisar();
}
registrarLimpieza(vaciarReinsercion);

function recalcular(tabla: MappingTable, parche: Partial<EstadoReinsercion> = {}): void {
  const e = { ...estado, ...parche };
  if (e.matches === null) { estado = { ...e, resultado: null }; avisar(); return; }
  const entrada = entradaDe(e.canonica, tabla, origenDe(e.origen, tabla));
  estado = { ...e, resultado: buildReinsertion(entrada, e.matches, e.decisiones, e.faltantesReconocidos) };
  avisar();
}

/** Editar la respuesta invalida lo encontrado: las posiciones y las decisiones ya no corresponden al texto. */
export function escribirRespuesta(texto: string): void {
  estado = { ...estado, respuesta: texto, matches: null, canonica: '', decisiones: {}, faltantesReconocidos: false, resultado: null, copiado: estado.copiado, respaldo: null, avisos: [] };
  avisar();
}

/** Cambiar el documento de origen recalcula los faltantes; las decisiones sobre los marcadores se conservan, el reconocimiento no. */
export function elegirOrigen(valor: string, tabla: MappingTable): void {
  recalcular(tabla, { origen: valor, faltantesReconocidos: false });
}

/** «Buscar marcadores»: lleva la respuesta a texto canónico (CRLF → LF, NFC) y clasifica cada marcador (6.10). */
export function buscarMarcadores(tabla: MappingTable): void {
  tablaVigente = tabla;
  const canonica = canonico(estado.respuesta);
  const matches = findMarkers(entradaDe(canonica, tabla, origenDe(estado.origen, tabla)));
  recalcular(tabla, { canonica, matches, decisiones: {}, faltantesReconocidos: false, avisos: [], respaldo: null });
}

/** Decide un marcador. Un exacto en «reemplazar» vuelve al automático (sin decisión registrada). */
export function decidir(matchId: string, accion: ReinsertionDecision['action'], texto?: string): void {
  const tabla = tablaVigente;
  const m = estado.matches?.find((x) => x.id === matchId);
  if (tabla === null || m === undefined) return;
  const decisiones = { ...estado.decisiones };
  if (m.kind === 'exacto' && accion === 'reemplazar') delete decisiones[matchId];
  else decisiones[matchId] = { matchId: m.id, action: accion, ...(texto !== undefined ? { text: texto } : {}) };
  recalcular(tabla, { decisiones });
}

/** Decide todas las apariciones de un mismo marcador (grupo por marcador); nunca «todos los alterados». */
export function decidirGrupo(ids: readonly string[], accion: 'reemplazar' | 'dejar'): void {
  const tabla = tablaVigente;
  if (tabla === null || estado.matches === null) return;
  const decisiones = { ...estado.decisiones };
  for (const id of ids) {
    const m = estado.matches.find((x) => x.id === id);
    if (m === undefined || (m.kind === 'desconocido' && accion === 'reemplazar')) continue;
    if (m.kind === 'exacto' && accion === 'reemplazar') delete decisiones[id];
    else decisiones[id] = { matchId: m.id, action: accion };
  }
  recalcular(tabla, { decisiones });
}

export function reconocerFaltantes(valor: boolean): void {
  const tabla = tablaVigente;
  if (tabla === null) return;
  recalcular(tabla, { faltantesReconocidos: valor });
}

export function ponerAvisosReinsercion(avisos: readonly AvisoReinsercion[]): void {
  actualizarReinsercion({ avisos });
}
