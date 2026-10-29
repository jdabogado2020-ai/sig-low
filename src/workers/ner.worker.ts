/// <reference lib="webworker" />
// Archivo de partida de P0-1 (9.1, regla 10): firma exportada sin lógica. Lo implementa PF-1b.
// Worker de módulo del mismo origen (F-09). Responde ERROR_INTERNO hasta que se implemente.
self.addEventListener('message', () => {
  self.postMessage({ v: 1, kind: 'error', code: 'ERROR_INTERNO' });
});
export {};
