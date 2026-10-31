// Guardia de arranque de la ventana (3.6, 5.2.1 «Guardia»; PD-2). Defensa adicional contra el uso no intencional por
// dependencias, no la barrera principal (la CSP en cabecera y el interruptor del service worker):
// - WebRTC: la CSP no lo bloquea (salen paquetes STUN con `default-src 'none'`). Los tres constructores quedan en
//   `undefined` (T-CS-04: `typeof RTCPeerConnection === 'undefined'`).
// - Red que la app no usa: XMLHttpRequest, WebSocket, EventSource, `navigator.sendBeacon`, `fetchLater` y
//   `navigator.share` lanzan SiglowError('ERROR_INTERNO'). WebSocket no pasa por el SW; la segunda política de la CSP lo
//   corta, y esto lo corta antes.
// - Navegación: `window.open` lanza (la CSP no rige la navegación de nivel superior, V-03).
// - `fetch` no se toca: la app no lo usa en la ventana y cada petición de una página controlada pasa por el interruptor
//   del SW (las pruebas de PD-1 lo miden con fetch desde la página).
// Se instala al evaluar este módulo (main.tsx lo importa antes que la interfaz), solo en producción: Vite usa WebSocket en
// desarrollo. No cubre los workers ni un iframe `about:blank` creado por código ajeno (otro global; riesgo de V-02 y V-03).
// Los nombres van en estos arreglos literales, y solo aquí: check-dist los admite únicamente en el chunk de entrada.
import { SiglowError } from './core/types.ts';

type Global = Record<string, unknown>;

const WEBRTC = ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel'];
const RED_GLOBAL = ['XMLHttpRequest', 'WebSocket', 'EventSource', 'fetchLater', 'open'];
const RED_NAVIGATOR = ['sendBeacon', 'share'];

/** Fija la propiedad para siempre (no se puede volver a escribir ni a redefinir). Si el navegador no lo permite, sigue. */
function fijar(o: object, nombre: string, valor: unknown): void {
  try {
    Object.defineProperty(o, nombre, { value: valor, writable: false, configurable: false, enumerable: false });
  } catch {
    // Propiedad no configurable en este navegador: la cubren la CSP y la prueba de cero red (STUN).
  }
}

/** Reemplazo de una API de red: también como constructor (`new`), siempre con un código, nunca con texto. */
function bloqueada(): never {
  throw new SiglowError('ERROR_INTERNO');
}

export function neutralizarWebRTC(g: Global = globalThis as unknown as Global): void {
  for (const nombre of WEBRTC) fijar(g, nombre, undefined);
}

/** Toda la guardia sobre un global (la ventana). Idempotente. */
export function instalarGuardia(g: Global = globalThis as unknown as Global): void {
  neutralizarWebRTC(g);
  for (const nombre of RED_GLOBAL) if (nombre in g) fijar(g, nombre, bloqueada);
  const nav = g['navigator'];
  if (typeof nav === 'object' && nav !== null) {
    // En el prototipo (Navigator.prototype) y no solo en la instancia: así `Navigator.prototype.x.call(navigator)` tampoco sirve.
    const proto: unknown = Object.getPrototypeOf(nav);
    for (const nombre of RED_NAVIGATOR) {
      if (typeof proto === 'object' && proto !== null && nombre in proto) fijar(proto, nombre, bloqueada);
      if (Object.prototype.hasOwnProperty.call(nav, nombre)) fijar(nav, nombre, bloqueada);
    }
  }
}

if (import.meta.env.PROD) instalarGuardia();
