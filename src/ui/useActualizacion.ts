// Gancho del aviso «Hay una versión nueva» (3.2, 8.2.10; PD-1). El componente del aviso (M-104, M-105) es de PC-1.
// No hay skipWaiting automático: sin `aplicar`, la versión en espera se aplica sola la próxima vez que se abra Sig-Low
// con todas sus pestañas cerradas, y la página no puede impedirlo. `aplicar` solo la adelanta: SKIP_WAITING y recarga.
// El componente habilita «Actualizar ahora» solo sin asunto abierto o con `backedUpRevision === tableRevision`, y con
// revisión en curso exige además la casilla M-105: recargar borra lo que está solo en memoria.
import { useEffect, useState } from 'preact/hooks';

export interface Actualizacion {
  /** Hay un service worker nuevo instalado y en espera detrás del que controla esta página. */
  hayVersionNueva: boolean;
  /** Aplica la versión en espera ahora: SKIP_WAITING y recarga cuando cambia el controlador. */
  aplicar: () => void;
}

const disponible = (): boolean => typeof navigator !== 'undefined' && isSecureContext && 'serviceWorker' in navigator;

/** Versión nueva en espera: hay `waiting` y la página está controlada (sin controlador es la instalación inicial). */
export function hayEnEspera(reg: ServiceWorkerRegistration | undefined, controlador: ServiceWorker | null): boolean {
  return reg?.waiting != null && controlador !== null;
}

/** SKIP_WAITING al SW en espera y recarga cuando toma el control. No hace nada si no hay versión en espera. */
export function aplicarVersionNueva(): void {
  if (!disponible()) return;
  const sw = navigator.serviceWorker;
  void sw.getRegistration().then(
    (reg) => {
      const espera = reg?.waiting;
      if (!espera || sw.controller === null) return;
      sw.addEventListener('controllerchange', () => { location.reload(); }, { once: true });
      espera.postMessage({ tipo: 'SKIP_WAITING' });
    },
    () => undefined,
  );
}

export function useActualizacion(): Actualizacion {
  const [hayVersionNueva, fijar] = useState(false);
  useEffect(() => {
    if (!disponible()) return undefined;
    const sw = navigator.serviceWorker;
    let reg: ServiceWorkerRegistration | undefined;
    let vivo = true;
    const revisar = (): void => {
      if (vivo) fijar(hayEnEspera(reg, sw.controller));
    };
    const seguir = (w: ServiceWorker | null | undefined): void => {
      w?.addEventListener('statechange', revisar);
    };
    const alEncontrar = (): void => {
      seguir(reg?.installing);
      revisar();
    };
    void sw.getRegistration().then(
      (r) => {
        if (!vivo || !r) return;
        reg = r;
        r.addEventListener('updatefound', alEncontrar);
        seguir(r.installing);
        revisar();
      },
      () => undefined,
    );
    sw.addEventListener('controllerchange', revisar);
    return () => {
      vivo = false;
      reg?.removeEventListener('updatefound', alEncontrar);
      sw.removeEventListener('controllerchange', revisar);
    };
  }, []);
  return { hayVersionNueva, aplicar: aplicarVersionNueva };
}
