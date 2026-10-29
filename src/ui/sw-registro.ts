// Registro del service worker mínimo de P0-1. PD-1 lo reemplaza y entrega useActualizacion().
export function registrarServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js', { type: 'module', scope: '/' }).catch(() => {
    // Sin controlador la app muestra SIN_SERVICE_WORKER (PC-1); el error no se registra en ningún lado.
  });
}
