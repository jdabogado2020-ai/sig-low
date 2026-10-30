/// <reference lib="webworker" />
// Worker `detect` (6.11.2, PB-6): reglas, lista del caso, lugares, fusión, entidades, sugerencias y banderas, con resultados progresivos del
// modelo. Worker de módulo del mismo origen (F-09). Toda la lógica está en src/core/pipeline.ts.
import { createDetectHandler, mensajeError } from '../core/pipeline';

const manejar = createDetectHandler();
let ultimoReqId = 'req_' + '0'.repeat(32);

self.addEventListener('message', (ev: MessageEvent<unknown>) => {
  const d = ev.data as { reqId?: unknown } | null;
  if (typeof d === 'object' && d !== null && typeof d.reqId === 'string') ultimoReqId = d.reqId;
  void manejar(ev.data, (m) => { self.postMessage(m); });
});
// Un fallo no capturado nunca reenvía message ni stack: se traduce a ERROR_INTERNO (6.11.1).
self.addEventListener('error', (ev) => {
  ev.preventDefault();
  self.postMessage(mensajeError(ultimoReqId, 'ERROR_INTERNO'));
});
self.addEventListener('unhandledrejection', (ev) => {
  ev.preventDefault();
  self.postMessage(mensajeError(ultimoReqId, 'ERROR_INTERNO'));
});
