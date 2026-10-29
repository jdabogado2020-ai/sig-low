/// <reference lib="webworker" />
// Service worker mínimo de P0-1 (9.1): registro, clients.claim() y solo GET del mismo origen.
// PD-1 lo reemplaza con el precache, el interruptor de red completo y el flujo de actualización.
declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', () => {
  void self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.search !== '') {
    e.respondWith(Response.error());
    return;
  }
  e.respondWith(fetch(req));
});
export {};
