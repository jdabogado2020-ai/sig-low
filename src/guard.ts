// Guardia `src/guard.ts` (3.6; 5.2.1 «Guardia», V-01 a V-03; PD-2 y su reapertura PD-2-r1, decisión D-02). Es el módulo de
// neutralización de 10.5.5 y un archivo crítico (V-22). Primer import de la entrada (src/main.tsx) y de cada worker propio
// (`detect`, `ner`, `io`): se instala al evaluarse, antes que el resto de los módulos, y solo en producción (Vite usa
// WebSocket en desarrollo). Defiende del uso no intencional por dependencias; las barreras son la CSP en cabecera y el
// interruptor del service worker (si la guardia rompe una dependencia, se ajustan las rutas y la CSP sigue como barrera).
// Cada reemplazo se aplica donde la API existe (un worker no tiene DOM, `window.open`, `sendBeacon` ni `share`) y queda
// fijo: no se puede reescribir ni redefinir.
// - `fetch`: solo `GET` al mismo origen, sin query ni cuerpo, a `/`, `/index.html` o bajo `/assets/`, `/ort/` y `/models/`
//   (en `ner`: ORT-web y el modelo). Lo demás se rechaza con `TypeError`, como un fallo de red. La petición se arma una
//   sola vez (`new Request`) y es esa la que sale: lo que se comprueba es lo que se pide.
// - `XMLHttpRequest`, `WebSocket`, `EventSource`, `fetchLater`, `window.open`, `document.open` (con tres argumentos abre una
//   ventana como `window.open`), `navigator.sendBeacon` y `navigator.share` lanzan `SiglowError('ERROR_INTERNO')`, como
//   constructor o como función.
// - WebRTC (V-02: la CSP no lo rige) y voz (B-18: las voces en línea de `speechSynthesis` sintetizan el texto en servidores
//   del fabricante, y el reconocimiento de voz envía el audio): quedan en `undefined` (9.3: `typeof RTCPeerConnection`).
// - Realms nuevos (M-4): un iframe `about:blank` trae constructores sin guardia. `createElement` y `createElementNS`
//   rechazan `iframe`, `frame`, `object` y `embed`; `customElements.define` rechaza extenderlos, y `contentWindow` y
//   `contentDocument` devuelven `null`. No es completo frente a código inyectado (riesgo residual de V-02 y V-03).
// Los nombres van en estos arreglos literales, y solo aquí: check-dist los admite únicamente en el chunk de entrada y en
// los tres workers propios, y exige que estén en cada uno de ellos.
import { SiglowError } from './core/types.ts';

type Global = Record<string, unknown>;
type Funcion = (...args: unknown[]) => unknown;

const WEBRTC = ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel'];
const VOZ = ['speechSynthesis', 'SpeechSynthesisUtterance', 'SpeechRecognition', 'webkitSpeechRecognition'];
const RED_GLOBAL = ['XMLHttpRequest', 'WebSocket', 'EventSource', 'fetchLater', 'open'];
const RED_NAVIGATOR = ['sendBeacon', 'share'];
const MARCOS = ['iframe', 'frame', 'object', 'embed'];
const CON_REALM = ['HTMLIFrameElement', 'HTMLFrameElement', 'HTMLObjectElement'];
const REALM = ['contentWindow', 'contentDocument'];
/** Rutas que admite `fetch` (5.2.1): la app, su build, ORT-web y el modelo. */
const RUTAS = /^\/(?:index\.html)?$|^\/(?:assets|ort|models)\//;

/** Define la propiedad para siempre (no se puede volver a escribir ni a redefinir). Si el navegador no lo permite, sigue. */
function definir(o: object, nombre: string, d: PropertyDescriptor): void {
  try {
    Object.defineProperty(o, nombre, { ...d, configurable: false, enumerable: false });
  } catch {
    // Propiedad no configurable en este navegador (o ya fijada): la cubren la CSP y las pruebas de cero red.
  }
}
const fijar = (o: object, nombre: string, valor: unknown): void => { definir(o, nombre, { value: valor, writable: false }); };

/** En el global y en su cadena de prototipos, donde la propiedad sea propia (un atributo puede vivir en el prototipo). */
function fijarEnCadena(g: Global, nombre: string, valor: unknown): void {
  for (let o = Object.getPrototypeOf(g) as object | null; o !== null && o !== Object.prototype; o = Object.getPrototypeOf(o) as object | null) {
    if (Object.prototype.hasOwnProperty.call(o, nombre)) fijar(o, nombre, valor);
  }
  fijar(g, nombre, valor);
}

/** Reemplazo de una API de red: también como constructor (`new`), siempre con un código, nunca con texto. */
function bloqueada(): never {
  throw new SiglowError('ERROR_INTERNO');
}

function nulo(): null {
  return null;
}

/** Nombre local sin prefijo y en minúsculas: `iframe`, `IFRAME` y `x:iframe` son el mismo elemento. */
function esMarco(nombre: string): boolean {
  const t = nombre.toLowerCase();
  return MARCOS.includes(t.slice(t.lastIndexOf(':') + 1));
}

/** El prototipo de una interfaz del global, si existe. */
function prototipo(g: Global, nombre: string): Global | null {
  const c = g[nombre];
  const p: unknown = typeof c === 'function' ? (c as { prototype?: unknown }).prototype : undefined;
  return typeof p === 'object' && p !== null ? (p as Global) : null;
}

/** `fetch` acotado (5.2.1). Sin `Request`, `URL` u origen conocido, rechaza todo (falla cerrada). */
function acotarFetch(g: Global): void {
  const nativo = g['fetch'];
  if (typeof nativo !== 'function') return;
  const Peticion = g['Request'] as typeof Request | undefined;
  const Direccion = g['URL'] as typeof URL | undefined;
  const origen = (g['location'] as { origin?: unknown } | undefined)?.origin;
  const rechazo = (): Promise<never> => Promise.reject(new TypeError('URL_NO_PERMITIDA'));
  if (typeof Peticion !== 'function' || typeof Direccion !== 'function' || typeof origen !== 'string') {
    fijar(g, 'fetch', rechazo);
    return;
  }
  fijar(g, 'fetch', function (entrada: unknown, opciones?: unknown): Promise<unknown> {
    try {
      // La petición se arma una vez: la entrada y las opciones se leen aquí, y el fetch original recibe esta misma petición.
      const p = new Peticion(entrada as RequestInfo, opciones as RequestInit | undefined);
      // Query: un «?» antes del fragmento, aunque la query quede vacía (como el interruptor del SW).
      if (p.method !== 'GET' || p.body !== null || /^[^#]*\?/.test(p.url)) return rechazo();
      const u = new Direccion(p.url);
      if (u.origin !== origen || !RUTAS.test(u.pathname)) return rechazo();
      return Reflect.apply(nativo as Funcion, g, [p]) as Promise<unknown>;
    } catch {
      return rechazo();
    }
  });
}

/** `createElement(nombre, …)` y `createElementNS(ns, nombre, …)`: el nombre se convierte una vez y es ese el que se crea. */
function envolverCreacion(proto: Global, metodo: string, i: number): void {
  const original = proto[metodo];
  if (typeof original !== 'function') return;
  fijar(proto, metodo, function (this: unknown, ...args: unknown[]): unknown {
    if (args.length > i) {
      const nombre = String(args[i]);
      if (esMarco(nombre)) bloqueada();
      args[i] = nombre;
    }
    return Reflect.apply(original as Funcion, this, args);
  });
}

/** M-4: sin elementos que abran un realm nuevo y sin acceso al realm de uno que ya exista. */
function cerrarRealms(g: Global): void {
  const documento = prototipo(g, 'Document');
  if (documento) {
    envolverCreacion(documento, 'createElement', 0);
    envolverCreacion(documento, 'createElementNS', 1);
    if ('open' in documento) fijar(documento, 'open', bloqueada);
  }
  const registro = prototipo(g, 'CustomElementRegistry');
  const definirOriginal = registro?.['define'];
  if (registro && typeof definirOriginal === 'function') {
    // Un elemento personalizado que extiende `iframe` se crearía con `new`, sin pasar por createElement.
    fijar(registro, 'define', function (this: unknown, nombre: unknown, clase: unknown, opciones?: unknown): unknown {
      const ext: unknown = typeof opciones === 'object' && opciones !== null ? (opciones as { extends?: unknown }).extends : undefined;
      if (ext === undefined) return Reflect.apply(definirOriginal as Funcion, this, [nombre, clase]);
      const texto = String(ext);
      if (esMarco(texto)) bloqueada();
      return Reflect.apply(definirOriginal as Funcion, this, [nombre, clase, { extends: texto }]);
    });
  }
  for (const clase of CON_REALM) {
    const p = prototipo(g, clase);
    if (p) for (const propiedad of REALM) if (propiedad in p) definir(p, propiedad, { get: nulo });
  }
}

/** Toda la guardia sobre un global (la ventana o un worker propio). Idempotente. */
export function instalarGuardia(g: Global = globalThis as unknown as Global): void {
  acotarFetch(g);
  for (const nombre of WEBRTC) fijarEnCadena(g, nombre, undefined);
  for (const nombre of VOZ) fijarEnCadena(g, nombre, undefined);
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
  cerrarRealms(g);
}

if (import.meta.env.PROD) instalarGuardia();
