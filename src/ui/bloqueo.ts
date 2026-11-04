// Bloqueo por inactividad, botón «Bloquear», varias pestañas y `pagehide` (8.2.10, 6.6.5, INV-G09).
// Reloj de pared (Date.now): un equipo suspendido y reanudado bloquea de inmediato, sin esperar a un temporizador.
import { useEffect, useState } from 'preact/hooks';
import { actualizar, fijarAvisoInicio, obtener, suscribir } from './estado.ts';
import { hayDocumentoEnMemoria } from './documento.ts';
import { hayFraseEscrita, vaciarEstadoM } from './sesion.ts';
import { puertos } from './servicios.ts';

export const LIMITE_INACTIVIDAD_MS = 15 * 60_000;
export const AVISO_INACTIVIDAD_MS = 14 * 60_000;
const INTERVALO_EVALUACION_MS = 15_000;
const INTERVALO_DIFUSION_MS = 15_000;
const CANAL = 'siglow-bloqueo';

type Mensaje = { tipo: 'actividad'; t: number } | { tipo: 'bloquear' };

let ultimaActividad = Date.now();
let ultimaDifusion = 0;
let canal: BroadcastChannel | null = null;
let restantes: number | null = null; // segundos de la cuenta regresiva; null = sin aviso
let ticTimer: ReturnType<typeof setInterval> | undefined;
const oyentes = new Set<() => void>();
const avisar = (): void => { for (const o of [...oyentes]) o(); };

function difundir(m: Mensaje): void {
  try { canal?.postMessage(m); } catch { /* canal cerrado: la pestaña sigue sola */ }
}

/** Renueva la actividad (también lo llama Procesando al terminar). Difunde como máximo cada 15 s. */
export function renovarActividad(forzar = false): void {
  const ahora = Date.now();
  ultimaActividad = Math.max(ultimaActividad, ahora);
  if (forzar || ahora - ultimaDifusion >= INTERVALO_DIFUSION_MS) {
    ultimaDifusion = ahora;
    difundir({ tipo: 'actividad', t: ahora });
  }
}

function cerrarAviso(): void {
  if (ticTimer !== undefined) { clearInterval(ticTimer); ticTimer = undefined; }
  if (restantes !== null) { restantes = null; avisar(); }
}

function abrirAviso(): void {
  if (ticTimer === undefined) ticTimer = setInterval(evaluar, 1000); // el tic de 1 s existe solo con el diálogo abierto
  const r = Math.max(0, Math.ceil((LIMITE_INACTIVIDAD_MS - (Date.now() - ultimaActividad)) / 1000));
  if (r !== restantes) { restantes = r; avisar(); }
}

/**
 * Vacía el estado `[M]` y vuelve a Inicio con M-102 (y M-103 si la tabla no estaba guardada). También sin asunto abierto (el
 * canal, la inactividad con una frase escrita, «Bloquear ahora»): `vaciarEstadoM` vuelve a montar los formularios de Inicio con
 * las frases vacías y `cerrar()` aborta un «Abrir» o un «Crear asunto» en curso (M-7, B-21).
 */
export function bloquear(difundirAOtras: boolean): void {
  const previo = obtener().asunto;
  cerrarAviso();
  vaciarEstadoM();
  puertos.boveda.cerrar();
  actualizar({ asunto: null, phase: 'vacio', screen: obtener().screen === 'sin_sw' ? 'sin_sw' : 'inicio', dialog: null, modelRun: null, error: null });
  // B-153: el caso efímero (D-23) no tiene contraseña que pedir: su aviso dice que el documento se borró y hay que cargarlo de nuevo.
  fijarAvisoInicio(previo?.efimero === true ? 'bloqueado_efimero' : previo?.mode === 'no_guardar' ? 'bloqueado_sin_guardar' : 'bloqueado');
  if (difundirAOtras) difundir({ tipo: 'bloquear' });
}

/** «Cerrar asunto»: vacía el estado `[M]` y vuelve a Inicio sin aviso de bloqueo. */
export function cerrarAsunto(): void {
  cerrarAviso();
  vaciarEstadoM();
  puertos.boveda.cerrar();
  actualizar({ asunto: null, phase: 'vacio', screen: 'inicio', dialog: null, modelRun: null, error: null });
  fijarAvisoInicio(null);
}

/**
 * Evalúa la inactividad (también la exportan las pruebas). Sin caso abierto cuentan una frase escrita en Inicio (M-7) y, desde F2
 * (M-123), un documento en memoria: un archivo cargado antes de «Anonimizar» (con su original retenido, D-22) o texto pegado.
 */
export function evaluar(): void {
  if (obtener().asunto === null && !hayFraseEscrita() && !hayDocumentoEnMemoria()) { cerrarAviso(); return; }
  const inactivo = Date.now() - ultimaActividad;
  if (inactivo >= LIMITE_INACTIVIDAD_MS) bloquear(true);
  else if (inactivo >= AVISO_INACTIVIDAD_MS) abrirAviso();
  else cerrarAviso();
}

/** «Seguir trabajando» o Esc en el aviso. */
export function seguirTrabajando(): void {
  renovarActividad(true);
  cerrarAviso();
}

export function useCuentaRegresiva(): number | null {
  const [, forzar] = useState(0);
  useEffect(() => {
    const f = (): void => { forzar((n) => n + 1); };
    oyentes.add(f);
    return () => { oyentes.delete(f); };
  }, []);
  return restantes;
}

let instalado = false;
let beforeunloadActivo = false;
const alAbandonar = (e: BeforeUnloadEvent): void => { e.preventDefault(); e.returnValue = ''; };

/** `beforeunload` solo mientras hay estado `[M]` (documento, revisión o tabla sin respaldo) (8.2.1). */
function sincronizarBeforeUnload(): void {
  const s = obtener();
  const hay = s.asunto !== null && (s.phase !== 'vacio' || s.asunto.backedUpRevision !== s.asunto.tableRevision);
  if (hay && !beforeunloadActivo) { addEventListener('beforeunload', alAbandonar); beforeunloadActivo = true; }
  else if (!hay && beforeunloadActivo) { removeEventListener('beforeunload', alAbandonar); beforeunloadActivo = false; }
}

/** Registra los manejadores de bloqueo. Idempotente. Devuelve la baja (pruebas). */
export function instalarBloqueo(): () => void {
  if (instalado) return () => undefined;
  instalado = true;
  ultimaActividad = Date.now();
  if (typeof BroadcastChannel !== 'undefined') {
    canal = new BroadcastChannel(CANAL);
    canal.onmessage = (e: MessageEvent) => {
      const m = e.data as Partial<Mensaje> | null;
      if (m?.tipo === 'bloquear') {
        // Con o sin asunto abierto: sin él, aborta además un «Abrir» o un «Crear asunto» en curso (B-21), vacía las frases de
        // Inicio y muestra M-102, para que se sepa por qué no se abrió (M-7).
        bloquear(false);
      } else if (m?.tipo === 'actividad' && typeof m.t === 'number') {
        ultimaActividad = Math.max(ultimaActividad, m.t);
        evaluar();
      }
    };
  }
  const actividad = (): void => { if (restantes === null) renovarActividad(); };
  const eventos = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const;
  for (const ev of eventos) addEventListener(ev, actividad, { capture: true, passive: true });
  const alVolver = (): void => { evaluar(); };
  addEventListener('focus', alVolver);
  addEventListener('pageshow', (e: PageTransitionEvent) => {
    // Restaurada desde la caché de páginas: el estado ya está vacío; se pide la frase de nuevo (M-102). vaciarEstadoM vuelve a
    // montar los formularios de Inicio: la frase escrita antes de salir no vuelve con la página (M-7, V-19).
    if (e.persisted) { vaciarEstadoM(); puertos.boveda.cerrar(); actualizar({ asunto: null, phase: 'vacio', screen: 'inicio', dialog: null }); fijarAvisoInicio('bloqueado'); }
    else evaluar();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') evaluar(); });
  document.addEventListener('resume', alVolver);
  // `pagehide` bloquea: el estado en claro, y las frases de Inicio, no sobreviven a salir de la página (V-19, M-7).
  addEventListener('pagehide', () => {
    vaciarEstadoM();
    puertos.boveda.cerrar();
  });
  const reloj = setInterval(evaluar, INTERVALO_EVALUACION_MS);
  const baja = suscribir(sincronizarBeforeUnload);
  return () => {
    clearInterval(reloj);
    baja();
    cerrarAviso();
    canal?.close();
    canal = null;
    instalado = false;
  };
}
