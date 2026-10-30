/// <reference lib="webworker" />
// Worker `io` (6.11.4, PE-1 a PE-3): lee un archivo y responde con un DocumentModel. Un worker nuevo por archivo.
// Worker de módulo del mismo origen (F-09). Toda la lógica está en src/io/io-handler.ts.
import { handleIoMessage, mensajeError } from '../io/io-handler';

let ultimoReqId = 'req_' + '0'.repeat(32);

self.addEventListener('message', (ev: MessageEvent<unknown>) => {
  const d = ev.data as { reqId?: unknown } | null;
  if (typeof d === 'object' && d !== null && typeof d.reqId === 'string') ultimoReqId = d.reqId;
  handleIoMessage(ev.data, (m) => { self.postMessage(m); });
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
