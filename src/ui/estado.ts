// Estado del armazón (8, «Contratos de la capa de interfaz»). Sin enrutador, sin `#`, sin history.pushState:
// la pantalla vive aquí (INV-G02). Nada de este estado lleva la tabla ni la lista del caso (eso vive en sesion.ts).
import { useEffect, useState } from 'preact/hooks';
import type { AsuntoId, ErrorCode, ModelProgress, ReviewError } from '../core/types.ts';

export type { MessageId, MsgParam } from './mensajes.ts';
export { t } from './mensajes.ts';

export type Screen =
  | 'inicio' | 'lista' | 'entrada' | 'procesando' | 'revision'
  | 'listo' | 'reinsercion' | 'boveda' | 'sin_sw'
  | 'detalle';   // F3: la revisión dato por dato de la v1.0, en opciones avanzadas de la vista previa
export type Phase = 'vacio' | 'procesando' | 'revision' | 'listo' | 'error';
export type SaveMode = 'guardar' | 'no_guardar';
/** Estado visible del modelo (distinto de ModelState del informe, 6.8). */
export type ModelUiState = 'no_descargado' | 'descargando' | 'verificando' | 'listo' | 'fallo' | 'sin_espacio' | 'sin_memoria';
/** Qué modelo hay en el equipo: el principal o la versión reducida de respaldo (3.3). */
export type ModelVariant = 'principal' | 'respaldo';
/** Por qué falló la última descarga (F0): la tarjeta muestra un solo mensaje con ese motivo y «Reintentar». */
export type MotivoFalloModelo = 'red' | 'integridad';
/** Diálogos sin ruta (8.2.11). */
export type Dialog = 'acerca' | 'creditos' | null;

export interface OpenAsunto {            // [P]: nunca lleva la tabla ni la lista del caso
  asuntoId: AsuntoId;
  codigo: string;
  mode: SaveMode;
  persisted: boolean | null;             // navigator.storage.persist(); null si no se pidió
  tableRevision: number;                 // +1 en cada consolidación (6.6.4)
  backedUpRevision: number | null;       // última tableRevision guardada en IndexedDB o exportada
  /** D-23 · Caso que Sig-Low abrió solo al cargar un documento («No guardar», código automático): el abogado no lo ve. */
  efimero?: boolean;
}
export interface UiError {
  code: ErrorCode | ReviewError;         // 6.11.7 y 6.4.4
  context: 'arranque' | 'inicio' | 'entrada' | 'procesando' | 'modelo' | 'tabla' | 'importacion' | 'revision' | 'reinsercion';
}
export interface ShellState {
  screen: Screen;
  phase: Phase;
  dialog: Dialog;
  secureContext: boolean;                // window.isSecureContext
  swReady: boolean;                      // navigator.serviceWorker.controller !== null
  swInstall: { done: number; total: number } | null; // avance del precache en la primera visita
  offlineReady: boolean;                 // el SW confirmó el precache (mensaje sin contenido)
  updateWaiting: boolean;                // hay un SW nuevo en espera
  asunto: OpenAsunto | null;
  model: { state: ModelUiState; variant?: ModelVariant; doneBytes?: number; totalBytes?: number; motivo?: MotivoFalloModelo };
  modelRun: ModelProgress | null;        // avance del análisis con el modelo (6.4.8); null fuera de una revisión. Lo refleja el ReviewState
  singleKeyShortcuts: boolean;           // 8.6.2; solo en memoria; true al cargar
  error: UiError | null;
}

/** Arranque: todavía no se sabe si hay service worker. `screen: 'inicio'` solo se alcanza con controlador (8.1). */
export function estadoInicial(): ShellState {
  return {
    screen: 'inicio',
    phase: 'vacio',
    dialog: null,
    secureContext: typeof isSecureContext === 'boolean' ? isSecureContext : false,
    swReady: false,
    swInstall: null,
    offlineReady: false,
    updateWaiting: false,
    asunto: null,
    model: { state: 'no_descargado' },
    modelRun: null,
    singleKeyShortcuts: true,
    error: null,
  };
}

/** Fase del arranque (8.1): anterior a `swReady`; la interfaz no monta ningún campo de contenido hasta salir de `comprobando`. */
export type Arranque = 'comprobando' | 'instalando' | 'listo' | 'sin_sw';

let actual: ShellState = estadoInicial();
let arranque: Arranque = 'comprobando';
const oyentes = new Set<() => void>();
const avisar = (): void => { for (const o of [...oyentes]) o(); };

export function obtener(): ShellState {
  return actual;
}
export function obtenerArranque(): Arranque {
  return arranque;
}
export function actualizar(parche: Partial<ShellState>): void {
  actual = { ...actual, ...parche };
  avisar();
}
export function fijarArranque(a: Arranque): void {
  if (arranque === a) return;
  arranque = a;
  avisar();
}
/** Aviso persistente de Inicio tras un bloqueo (M-102, M-103) o una restauración desde la caché de páginas. */
export type AvisoInicio = 'bloqueado' | 'bloqueado_sin_guardar' | 'bloqueado_efimero' | null;
let avisoInicio: AvisoInicio = null;
export function obtenerAvisoInicio(): AvisoInicio {
  return avisoInicio;
}
export function fijarAvisoInicio(a: AvisoInicio): void {
  avisoInicio = a;
  avisar();
}
/** Cuántos oyentes tiene el armazón. Para las pruebas de B-180: una espera soltada no deja el suyo. */
export const oyentesDelArmazon = (): number => oyentes.size;
export function suscribir(fn: () => void): () => void {
  oyentes.add(fn);
  return () => { oyentes.delete(fn); };
}
/** Cambia de pantalla (8.1). Las pantallas de A1/A2 la llaman; el armazón mueve el foco y anuncia el cambio. */
export function ir(screen: Screen): void {
  if (actual.screen === screen) return;
  actualizar({ screen, error: null });
}
/** Para las pruebas de unidad de otros módulos. */
export function reiniciarEstado(): void {
  actual = estadoInicial();
  arranque = 'comprobando';
  avisoInicio = null;
  avisar();
}

export function useShell(): ShellState {
  const [, forzar] = useState(0);
  useEffect(() => suscribir(() => { forzar((n) => n + 1); }), []);
  return actual;
}
export function useArranque(): Arranque {
  const [, forzar] = useState(0);
  useEffect(() => suscribir(() => { forzar((n) => n + 1); }), []);
  return arranque;
}
