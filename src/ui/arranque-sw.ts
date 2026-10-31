// Arranque y comprobación del service worker (8.1, 8.2.10 «Sin service worker», 3.2 «Sin controlador»).
// Falla cerrado: sin contexto seguro o sin controlador no se aceptan documentos (SIN_SERVICE_WORKER / CONTEXTO_NO_SEGURO).
// Protocolo asumido con PD-1 (mensajes sin contenido): { tipo: 'avance', done, total } durante la instalación y
// { tipo: 'offlineReady' } cuando el precache quedó completo.
import { actualizar, fijarArranque, obtener } from './estado.ts';
import { resultadoRegistro } from './sw-registro.ts';

const ESPERA_INSTALACION_MS = 10_000;

function aSinSw(code: 'SIN_SERVICE_WORKER' | 'CONTEXTO_NO_SEGURO'): void {
  fijarArranque('listo');
  actualizar({ screen: 'sin_sw', swReady: false, swInstall: null, error: { code, context: 'arranque' } });
}

async function hayPrecache(): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    return (await caches.keys()).some((k) => k.startsWith('siglow-app-'));
  } catch {
    return false;
  }
}

async function revisarEspera(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  // Un SW en espera con controlador activo es una versión nueva (3.2); sin controlador es la instalación inicial.
  actualizar({ updateWaiting: reg?.waiting != null && navigator.serviceWorker.controller !== null });
}

function controlado(): void {
  fijarArranque('listo');
  const previa = obtener();
  // Si la pantalla era «sin_sw» por un fallo previo y ahora hay controlador, se vuelve a Inicio (8.1: controllerchange).
  actualizar({ swReady: true, swInstall: null, screen: previa.screen === 'sin_sw' ? 'inicio' : previa.screen, error: null });
  void hayPrecache().then((ok) => { if (ok) actualizar({ offlineReady: true }); });
  void navigator.serviceWorker.getRegistration().then((reg) => {
    if (!reg) return;
    void revisarEspera();
    reg.addEventListener('updatefound', () => {
      reg.installing?.addEventListener('statechange', () => { void revisarEspera(); });
    });
  });
}

/** Devuelve la función que detiene los observadores (pruebas y recarga en caliente). */
export function iniciarArranque(): () => void {
  if (!isSecureContext) {
    aSinSw('CONTEXTO_NO_SEGURO');
    return () => undefined;
  }
  if (!('serviceWorker' in navigator)) {
    aSinSw('SIN_SERVICE_WORKER');
    return () => undefined;
  }
  const sw = navigator.serviceWorker;
  const bajas: Array<() => void> = [];
  let temporizador: ReturnType<typeof setTimeout> | undefined;

  const alMensaje = (e: MessageEvent): void => {
    const d: unknown = e.data;
    if (typeof d !== 'object' || d === null) return;
    const m = d as { tipo?: unknown; done?: unknown; total?: unknown };
    if (m.tipo === 'avance' && typeof m.done === 'number' && typeof m.total === 'number') {
      actualizar({ swInstall: { done: m.done, total: m.total } });
    } else if (m.tipo === 'offlineReady') {
      actualizar({ offlineReady: true });
    }
  };
  sw.addEventListener('message', alMensaje);
  bajas.push(() => { sw.removeEventListener('message', alMensaje); });

  const alCambiarControlador = (): void => {
    if (sw.controller) controlado();
  };
  sw.addEventListener('controllerchange', alCambiarControlador);
  bajas.push(() => { sw.removeEventListener('controllerchange', alCambiarControlador); });

  if (sw.controller) {
    controlado();
  } else {
    fijarArranque('instalando');
    // Registro rechazado: sin service worker de inmediato (no se espera a los 10 s).
    void resultadoRegistro().then((ok) => { if (!ok && !sw.controller) aSinSw('SIN_SERVICE_WORKER'); });
    // Sin SW instalándose en 10 s: sin service worker. Con uno instalándose se espera sin tiempo límite (8.1).
    const vigilar = (): void => {
      void sw.getRegistration().then((reg) => {
        if (sw.controller) return;
        if (reg?.installing || reg?.waiting) { temporizador = setTimeout(vigilar, 500); return; }
        aSinSw('SIN_SERVICE_WORKER');
      });
    };
    temporizador = setTimeout(vigilar, ESPERA_INSTALACION_MS);
  }
  return () => {
    if (temporizador !== undefined) clearTimeout(temporizador);
    for (const b of bajas) b();
  };
}

// «Actualizar ahora» (8.2.10) vive en useActualizacion.ts (`puertos.sw.aplicarActualizacion`): la recarga solo queda
// pendiente si el SW acepta SKIP_WAITING, y un cambio de controlador que esta pestaña no pidió no la recarga (B-11).
