// Registro del service worker (3.2; PD-1). Solo en contexto seguro (V-16). `updateViaCache: 'none'`: la búsqueda de
// versión es siempre `GET /sw.js` sin query y sin caché HTTP (T-SW-02). Un rechazo no se registra en ningún lado:
// sin controlador la interfaz muestra SIN_SERVICE_WORKER (PC-1). El aviso de actualización está en useActualizacion.ts.
let resultado: Promise<boolean> = Promise.resolve(false);

export function registrarServiceWorker(): Promise<boolean> {
  if (!isSecureContext || !('serviceWorker' in navigator)) {
    resultado = Promise.resolve(false);
    return resultado;
  }
  try {
    resultado = navigator.serviceWorker
      .register('/sw.js', { type: 'module', scope: '/', updateViaCache: 'none' })
      // Solo un registro real cuenta: un `register` sustituido (bloqueo del navegador o de la prueba) no lo es.
      .then((r) => r instanceof ServiceWorkerRegistration, () => false);
  } catch {
    resultado = Promise.resolve(false);
  }
  return resultado;
}

/** Resultado del último registro: false si el navegador lo rechazó, si no hay service workers o sin contexto seguro. */
export function resultadoRegistro(): Promise<boolean> {
  return resultado;
}
