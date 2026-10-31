// Gancho del aviso «Hay una versión nueva» (3.2, 8.2.10; PD-1 y PD-1-r1). El componente del aviso (M-104, M-105) es de PC-1.
// No hay skipWaiting automático: sin `aplicar`, la versión en espera se aplica sola la próxima vez que se abra Sig-Low
// con todas sus pestañas cerradas, y la página no puede impedirlo. `aplicar` solo la adelanta: SKIP_WAITING y recarga.
// El componente habilita «Actualizar ahora» solo sin asunto abierto o con `backedUpRevision === tableRevision`, y con
// revisión en curso exige además la casilla M-105: recargar borra lo que está solo en memoria.
// Varias pestañas (B-11): el aviso solo ve la tabla de su pestaña, así que el SW rechaza SKIP_WAITING si hay otra ventana
// de Sig-Low abierta, y `aplicar` devuelve 'otras_pestanas' para que el aviso pida cerrarlas. Esta pestaña solo recarga
// por un cambio de controlador que ella pidió y el SW aceptó; un cambio que no pidió (otra pestaña, una carrera al abrir
// una pestaña nueva, una versión sin la guardia) no recarga: `useVersionCambiada()` lo avisa.
import { useEffect, useState } from 'preact/hooks';

/** 'aplicando': el SW aceptó y la página se recargará al cambiar el controlador. */
export type ResultadoActualizacion = 'aplicando' | 'otras_pestanas' | 'sin_version';

export interface Actualizacion {
  /** Hay un service worker nuevo instalado y en espera detrás del que controla esta página. */
  hayVersionNueva: boolean;
  /** Aplica la versión en espera ahora: SKIP_WAITING y recarga cuando cambia el controlador. */
  aplicar: () => Promise<ResultadoActualizacion>;
}

/** Tiempo para la respuesta del SW y para el cambio de controlador; después se suelta la recarga pendiente. */
const ESPERA_MS = 10_000;

const disponible = (): boolean =>
  typeof navigator !== 'undefined' && globalThis.isSecureContext === true && 'serviceWorker' in navigator;

/** Versión nueva en espera: hay `waiting` y la página está controlada (sin controlador es la instalación inicial). */
export function hayEnEspera(reg: ServiceWorkerRegistration | undefined, controlador: ServiceWorker | null): boolean {
  return reg?.waiting != null && controlador !== null;
}

// Cambio de controlador que esta pestaña no pidió. Se vigila desde que se evalúa el módulo (antes del primer render):
// el primer controlador visto es el de la carga. De ninguno a uno (primera instalación, `clients.claim()`) no cuenta.
let pedida = false;
let cambiada = false;
const oyentes = new Set<() => void>();

function vigilarControlador(): void {
  if (!disponible()) return;
  const sw = navigator.serviceWorker;
  let visto = sw.controller;
  sw.addEventListener('controllerchange', () => {
    const previo = visto;
    visto = sw.controller;
    if (previo === null || visto === previo || pedida || cambiada) return;
    cambiada = true;
    for (const o of [...oyentes]) o();
  });
}
vigilarControlador();

/**
 * SKIP_WAITING al SW en espera, con un puerto para su respuesta, y recarga cuando toma el control. Si el SW lo rechaza
 * (otra ventana de Sig-Low abierta) o no responde en ESPERA_MS, no queda ninguna recarga pendiente.
 */
export function aplicarVersionNueva(): Promise<ResultadoActualizacion> {
  if (!disponible()) return Promise.resolve('sin_version');
  const sw = navigator.serviceWorker;
  return sw.getRegistration().then(
    (reg) => {
      const espera = reg?.waiting;
      if (!espera || sw.controller === null) return 'sin_version';
      return new Promise<ResultadoActualizacion>((resolver) => {
        const canal = new MessageChannel();
        const recargar = (): void => {
          clearTimeout(reloj);
          location.reload();
        };
        const soltar = (r: ResultadoActualizacion): void => {
          clearTimeout(reloj);
          sw.removeEventListener('controllerchange', recargar);
          canal.port1.close();
          pedida = false;
          resolver(r);
        };
        const reloj = setTimeout(() => { soltar('sin_version'); }, ESPERA_MS);
        canal.port1.onmessage = (e: MessageEvent) => {
          const d: unknown = e.data;
          if (typeof d !== 'object' || d === null) return;
          const m = d as { tipo?: unknown; aplicada?: unknown; motivo?: unknown };
          if (m.tipo !== 'SKIP_WAITING') return;
          if (m.aplicada === true) resolver('aplicando');
          else soltar(m.motivo === 'otras_pestanas' ? 'otras_pestanas' : 'sin_version');
        };
        pedida = true;
        sw.addEventListener('controllerchange', recargar, { once: true });
        espera.postMessage({ tipo: 'SKIP_WAITING' }, [canal.port2]);
      });
    },
    () => 'sin_version' as const,
  );
}

/** true cuando el controlador de esta pestaña cambió sin que ella lo pidiera: sigue con los archivos de la versión anterior. */
export function useVersionCambiada(): boolean {
  const [, forzar] = useState(0);
  useEffect(() => {
    const f = (): void => { forzar((n) => n + 1); };
    oyentes.add(f);
    return () => { oyentes.delete(f); };
  }, []);
  return cambiada;
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
