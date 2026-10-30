// Registro del service worker mínimo de P0-1. PD-1 lo reemplaza y entrega useActualizacion().
// PC-1 solo añade el resultado del registro (para pasar a «sin service worker» sin esperar 10 s).
let resultado: Promise<boolean> = Promise.resolve(false);

export function registrarServiceWorker(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(false);
  resultado = navigator.serviceWorker
    .register('/sw.js', { type: 'module', scope: '/' })
    .then(() => true)
    .catch(() => false); // Sin controlador la app muestra SIN_SERVICE_WORKER (PC-1); el error no se registra en ningún lado.
  return resultado;
}

/** Resultado del último registro: false si el navegador lo rechazó o no hay service workers. */
export function resultadoRegistro(): Promise<boolean> {
  return resultado;
}
