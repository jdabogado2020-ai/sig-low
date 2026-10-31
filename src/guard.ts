// Guardia `src/guard.ts` (3.6; 5.2.1 «Guardia», V-01 a V-03; PD-2 y sus reaperturas PD-2-r1 y PD-2-r2, decisiones D-02 y
// D-04). Es el módulo de neutralización de 10.5.5 y un archivo crítico (V-22). Primer import de la entrada (src/main.tsx) y
// de cada worker propio (`detect`, `ner`, `io`; tests/unit/guard.test.ts lo exige, B-27): se instala al evaluarse, antes que
// el resto de los módulos, y solo en producción (Vite usa
// WebSocket en desarrollo). Defiende del uso no intencional por dependencias; las barreras son la CSP en cabecera y el
// interruptor del service worker (si la guardia rompe una dependencia, se ajustan las rutas y la CSP sigue como barrera).
// Cada reemplazo se aplica donde la API existe (un worker no tiene DOM, `window.open`, `sendBeacon` ni `share`) y queda
// fijo: no se puede reescribir ni redefinir.
// - `fetch`: solo `GET` al mismo origen, sin query ni cuerpo, a `/`, `/index.html` o bajo `/assets/`, `/ort/` y `/models/`
//   (en `ner`: ORT-web y el modelo). Lo demás se rechaza con `TypeError`, como un fallo de red. La petición se arma una
//   sola vez (`new Request`) y es esa la que sale: lo que se comprueba es lo que se pide.
// - `XMLHttpRequest`, `WebSocket`, `WebSocketStream`, `WebTransport` (B-26: al propio origen la CSP lo admite y sale por UDP,
//   donde el SW no lo ve), `EventSource`, `fetchLater`, `window.open`, `document.open` (con tres argumentos abre una ventana
//   como `window.open`), `navigator.sendBeacon` y `navigator.share` lanzan `SiglowError('ERROR_INTERNO')`, como constructor
//   o como función.
// - WebRTC (V-02: la CSP no lo rige) y voz (B-18: las voces en línea de `speechSynthesis` sintetizan el texto en servidores
//   del fabricante, y el reconocimiento de voz envía el audio): quedan en `undefined` (9.3: `typeof RTCPeerConnection`).
// - Realms nuevos (M-4): un iframe `about:blank` trae constructores sin guardia. `createElement`, `createElementNS` y
//   `DOMImplementation.createDocument` (su elemento raíz puede ser un iframe) rechazan `iframe`, `frame`, `object` y
//   `embed`; `customElements.define` rechaza extenderlos, y `contentWindow` y `contentDocument` devuelven `null`.
//   `XSLTProcessor` (B-25: una transformación crea el iframe sin pasar por createElement) y `documentPictureInPicture` (abre
//   una ventana del mismo origen con su propio realm) quedan en `undefined`. No es completo frente a código inyectado
//   (riesgo residual de V-02 y V-03).
// - `navigator.serviceWorker.register` (B-50): solo `/sw.js` exacto. La petición del script de un SW no pasa por el SW, y una
//   ruta como `/assets/<dato>.js` pasaría la CSP (compara prefijos) y llevaría el dato al registro del alojamiento. Es el
//   respaldo de la política de Trusted Types (`tt-policy.js`), que hace lo mismo por el sumidero; check-dist exige que el
//   build tenga un solo registro, con `/sw.js`.
// - Protected Audience y Topics: `navigator.joinAdInterestGroup`, `navigator.runAdAuction` y `document.browsingTopics`
//   quedan en `undefined` (la app no los usa; la Permissions-Policy solo apaga los rasgos que el navegador reconoce).
// - Primitivas propias (B-80): al instalarse, la guardia toma `Reflect.apply`, `String`, `Promise.reject`, `TypeError`, los
//   métodos de cadena que usa, los lectores de `Request` y `URL`, y el `Request`, el `URL` y el `fetch` del global, y los
//   envoltorios usan solo esas referencias (ni `Reflect.apply`, ni `String(…)`, ni expresiones regulares: `RegExp.prototype.test`
//   llama a `exec`, que está vivo). Así, código que sustituya esas primitivas después no cambia lo que la guardia comprueba ni
//   lo que entrega al original. Es robustez frente a dependencias que parchean primitivas; NO es una barrera contra código
//   inyectado, que ya corre en la página y tiene otras salidas (V-03). La política de Trusted Types (`tt-policy.js`) se puede
//   invocar fuera de un sumidero y esta guardia no es independiente de ella frente a ese código (nota para 5.2.1 y V-43).
// Los nombres van en estos arreglos literales, y solo aquí: check-dist los admite únicamente en el chunk de entrada y en
// los tres workers propios, y exige que estén en cada uno de ellos.
import { SiglowError } from './core/types.ts';

type Global = Record<string, unknown>;
type Funcion = (...args: unknown[]) => unknown;
type Lector = (this: unknown) => unknown;

/** Las primitivas que usan los envoltorios, tomadas una vez al instalar la guardia (B-80). */
interface Primitivas {
  readonly aplicar: (f: Funcion, esto: unknown, args: unknown[]) => unknown;
  readonly texto: (valor: unknown) => string;
  readonly rechazar: (motivo: unknown) => Promise<never>;
  readonly ErrorTipo: new (mensaje: string) => Error;
  readonly minusculas: (s: string) => string;
  readonly desde: (s: string, i: number) => string;
  readonly indice: (s: string, buscada: string) => number;
  readonly ultimoIndice: (s: string, buscada: string) => number;
  readonly empieza: (s: string, prefijo: string) => boolean;
}

const WEBRTC = ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel'];
const VOZ = ['speechSynthesis', 'SpeechSynthesisUtterance', 'SpeechRecognition', 'webkitSpeechRecognition'];
/** Crean un realm sin pasar por createElement (B-25 y PD-2-r2). */
const REALM_GLOBAL = ['XSLTProcessor', 'documentPictureInPicture'];
const RED_GLOBAL = ['XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'WebTransport', 'EventSource', 'fetchLater', 'open'];
const RED_NAVIGATOR = ['sendBeacon', 'share'];
/** Protected Audience (en `navigator`) y Topics (en `document`). */
const PUBLICIDAD = ['joinAdInterestGroup', 'runAdAuction', 'browsingTopics'];
const MARCOS = ['iframe', 'frame', 'object', 'embed'];
const CON_REALM = ['HTMLIFrameElement', 'HTMLFrameElement', 'HTMLObjectElement'];
const REALM = ['contentWindow', 'contentDocument'];
/** Rutas que admite `fetch` (5.2.1): la app, su build, ORT-web y el modelo. */
const RUTAS_EXACTAS = ['/', '/index.html'];
const RUTAS_PREFIJO = ['/assets/', '/ort/', '/models/'];
/** La única ruta que se registra como service worker (B-50). */
const RUTA_SW = '/sw.js';

/** B-80: la función sin su `this` (primer argumento), tomada de `Function.prototype.call` tal como está al instalar. */
function sinEsto(f: unknown): Funcion {
  return Function.prototype.call.bind(f as Funcion) as Funcion;
}

/** B-80: las primitivas que usan los envoltorios, en el estado en que están al instalar la guardia. */
function capturarPrimitivas(): Primitivas {
  const sp = String.prototype;
  return Object.freeze({
    aplicar: Reflect.apply,
    texto: String,
    rechazar: Promise.reject.bind(Promise) as (motivo: unknown) => Promise<never>,
    ErrorTipo: TypeError,
    minusculas: sinEsto(sp.toLowerCase) as Primitivas['minusculas'],
    desde: sinEsto(sp.slice) as Primitivas['desde'],
    indice: sinEsto(sp.indexOf) as Primitivas['indice'],
    ultimoIndice: sinEsto(sp.lastIndexOf) as Primitivas['ultimoIndice'],
    empieza: sinEsto(sp.startsWith) as Primitivas['empieza'],
  });
}

/** B-80: el lector (`get`) de una propiedad de la interfaz, buscado en la cadena de prototipos al instalar. Null si no es un
 * atributo con lector: quien lo necesita falla cerrado. */
function lectorDe(clase: unknown, nombre: string): Lector | null {
  const p: unknown = typeof clase === 'function' ? (clase as { prototype?: unknown }).prototype : undefined;
  for (let o = typeof p === 'object' ? p : null; o !== null; o = Object.getPrototypeOf(o) as object | null) {
    const d = Object.getOwnPropertyDescriptor(o, nombre);
    if (d) return typeof d.get === 'function' ? d.get : null;
  }
  return null;
}

/** Define la propiedad para siempre (no se puede volver a escribir ni a redefinir). Si el navegador no lo permite, sigue. */
function definir(o: object, nombre: string, d: PropertyDescriptor): void {
  try {
    Object.defineProperty(o, nombre, { ...d, configurable: false, enumerable: false });
  } catch {
    // Propiedad no configurable en este navegador (o ya fijada): la cubren la CSP y las pruebas de cero red.
  }
}
const fijar = (o: object, nombre: string, valor: unknown): void => { definir(o, nombre, { value: valor, writable: false }); };

/** En el objeto (el global, `navigator` o `document`) y en su cadena de prototipos, donde la propiedad sea propia (un
 * atributo o un método puede vivir en el prototipo). */
function fijarEnCadena(g: object, nombre: string, valor: unknown): void {
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
function esMarco(P: Primitivas, nombre: string): boolean {
  const t = P.minusculas(nombre);
  const local = P.desde(t, P.ultimoIndice(t, ':') + 1);
  for (let i = 0; i < MARCOS.length; i++) if (MARCOS[i] === local) return true;
  return false;
}

/** La ruta (ya normalizada por `URL`) es una de las que admite `fetch`. */
function rutaAdmitida(P: Primitivas, ruta: string): boolean {
  for (let i = 0; i < RUTAS_EXACTAS.length; i++) if (RUTAS_EXACTAS[i] === ruta) return true;
  for (let i = 0; i < RUTAS_PREFIJO.length; i++) if (P.empieza(ruta, RUTAS_PREFIJO[i]!)) return true;
  return false;
}

/** Hay un «?» antes del fragmento, aunque la query quede vacía (como el interruptor del SW). */
function tieneQuery(P: Primitivas, url: string): boolean {
  const q = P.indice(url, '?');
  if (q < 0) return false;
  const h = P.indice(url, '#');
  return h < 0 || q < h;
}

/** El prototipo de una interfaz del global, si existe. */
function prototipo(g: Global, nombre: string): Global | null {
  const c = g[nombre];
  const p: unknown = typeof c === 'function' ? (c as { prototype?: unknown }).prototype : undefined;
  return typeof p === 'object' && p !== null ? (p as Global) : null;
}

/** `fetch` acotado (5.2.1). Sin `Request`, `URL` u origen conocido, rechaza todo (falla cerrada). */
function acotarFetch(g: Global, P: Primitivas): void {
  const nativo = g['fetch'];
  if (typeof nativo !== 'function') return;
  const Peticion = g['Request'] as typeof Request | undefined;
  const Direccion = g['URL'] as typeof URL | undefined;
  const origen = (g['location'] as { origin?: unknown } | undefined)?.origin;
  const rechazo = (): Promise<never> => P.rechazar(new P.ErrorTipo('URL_NO_PERMITIDA'));
  // Los lectores de la petición y de la URL se toman ahora (B-80): un lector sustituido después no cambia lo que se comprueba.
  const metodo = lectorDe(Peticion, 'method');
  const cuerpo = lectorDe(Peticion, 'body');
  const direccion = lectorDe(Peticion, 'url');
  const origenDe = lectorDe(Direccion, 'origin');
  const rutaDe = lectorDe(Direccion, 'pathname');
  if (typeof Peticion !== 'function' || typeof Direccion !== 'function' || typeof origen !== 'string'
    || !metodo || !cuerpo || !direccion || !origenDe || !rutaDe) {
    fijar(g, 'fetch', rechazo);
    return;
  }
  fijar(g, 'fetch', function (entrada: unknown, opciones?: unknown): Promise<unknown> {
    try {
      // La petición se arma una vez: la entrada y las opciones se leen aquí, y el fetch original recibe esta misma petición.
      const p = new Peticion(entrada as RequestInfo, opciones as RequestInit | undefined);
      const url = P.aplicar(direccion as Funcion, p, []) as string;
      if (P.aplicar(metodo as Funcion, p, []) !== 'GET' || P.aplicar(cuerpo as Funcion, p, []) !== null || tieneQuery(P, url)) return rechazo();
      const u = new Direccion(url);
      if (P.aplicar(origenDe as Funcion, u, []) !== origen || !rutaAdmitida(P, P.aplicar(rutaDe as Funcion, u, []) as string)) return rechazo();
      return P.aplicar(nativo as Funcion, g, [p]) as Promise<unknown>;
    } catch {
      return rechazo();
    }
  });
}

/** B-50: `ServiceWorkerContainer.prototype.register` acepta solo `/sw.js` exacto. El argumento se convierte una vez y es ese el
 * que se registra; lo demás se rechaza como un fallo de red (promesa rechazada con `TypeError`), sin llamar al original. */
function acotarRegistroSW(g: Global, P: Primitivas): void {
  const contenedor = prototipo(g, 'ServiceWorkerContainer');
  const original = contenedor?.['register'];
  if (contenedor === null || typeof original !== 'function') return;
  fijar(contenedor, 'register', function (this: unknown, ...args: unknown[]): Promise<unknown> {
    try {
      const ruta = P.texto(args[0]);
      if (ruta !== RUTA_SW) return P.rechazar(new P.ErrorTipo('URL_NO_PERMITIDA'));
      args[0] = ruta;
    } catch {
      return P.rechazar(new P.ErrorTipo('URL_NO_PERMITIDA'));
    }
    return P.aplicar(original as Funcion, this, args) as Promise<unknown>;
  });
}

/** `createElement(nombre, …)`, `createElementNS(ns, nombre, …)` y `createDocument(ns, nombre, …)`: el nombre se convierte una
 * vez y es ese el que se crea. `nuloVacio`: el argumento es `[LegacyNullToEmptyString]` (en createDocument, `null` es «sin
 * elemento raíz», no el elemento «null»). */
function envolverCreacion(P: Primitivas, proto: Global, metodo: string, i: number, nuloVacio = false): void {
  const original = proto[metodo];
  if (typeof original !== 'function') return;
  fijar(proto, metodo, function (this: unknown, ...args: unknown[]): unknown {
    if (args.length > i) {
      const nombre = nuloVacio && args[i] === null ? '' : P.texto(args[i]);
      if (esMarco(P, nombre)) bloqueada();
      args[i] = nombre;
    }
    return P.aplicar(original as Funcion, this, args);
  });
}

/** M-4: sin elementos que abran un realm nuevo y sin acceso al realm de uno que ya exista. */
function cerrarRealms(g: Global, P: Primitivas): void {
  const documento = prototipo(g, 'Document');
  if (documento) {
    envolverCreacion(P, documento, 'createElement', 0);
    envolverCreacion(P, documento, 'createElementNS', 1);
    if ('open' in documento) fijar(documento, 'open', bloqueada);
  }
  // `createDocument(XHTML, 'iframe')` da un documento cuyo elemento raíz es un HTMLIFrameElement, sin pasar por createElement:
  // al agregarlo a la página, `window[i]` entrega su realm (PD-2-r2, la misma clase que B-25).
  const implementacion = prototipo(g, 'DOMImplementation');
  if (implementacion) envolverCreacion(P, implementacion, 'createDocument', 1, true);
  const registro = prototipo(g, 'CustomElementRegistry');
  const definirOriginal = registro?.['define'];
  if (registro && typeof definirOriginal === 'function') {
    // Un elemento personalizado que extiende `iframe` se crearía con `new`, sin pasar por createElement.
    fijar(registro, 'define', function (this: unknown, nombre: unknown, clase: unknown, opciones?: unknown): unknown {
      const ext: unknown = typeof opciones === 'object' && opciones !== null ? (opciones as { extends?: unknown }).extends : undefined;
      if (ext === undefined) return P.aplicar(definirOriginal as Funcion, this, [nombre, clase]);
      const texto = P.texto(ext);
      if (esMarco(P, texto)) bloqueada();
      return P.aplicar(definirOriginal as Funcion, this, [nombre, clase, { extends: texto }]);
    });
  }
  for (const clase of CON_REALM) {
    const p = prototipo(g, clase);
    if (p) for (const propiedad of REALM) if (propiedad in p) definir(p, propiedad, { get: nulo });
  }
}

/** Toda la guardia sobre un global (la ventana o un worker propio). Idempotente. */
export function instalarGuardia(g: Global = globalThis as unknown as Global): void {
  const P = capturarPrimitivas();
  acotarFetch(g, P);
  acotarRegistroSW(g, P);
  for (const nombre of WEBRTC) fijarEnCadena(g, nombre, undefined);
  for (const nombre of VOZ) fijarEnCadena(g, nombre, undefined);
  for (const nombre of REALM_GLOBAL) fijarEnCadena(g, nombre, undefined);
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
  // Donde existan: `joinAdInterestGroup` y `runAdAuction` en Navigator.prototype, `browsingTopics` en Document.prototype
  // (así vale también para los documentos que se creen después).
  for (const objeto of [nav, g['document']]) {
    if (typeof objeto !== 'object' || objeto === null) continue;
    for (const nombre of PUBLICIDAD) if (nombre in objeto) fijarEnCadena(objeto, nombre, undefined);
  }
  cerrarRealms(g, P);
}

if (import.meta.env.PROD) instalarGuardia();
