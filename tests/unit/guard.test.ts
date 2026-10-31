// Guardia src/guard.ts (5.2.1; PD-2-r1: B-17, M-4 y B-18; PD-2-r2: B-25, B-26, B-27 y Protected Audience). Pruebas sobre un
// global simulado (ventana o worker): la lógica del fetch acotado, los reemplazos y el cierre de realms; y, sobre el código
// fuente, que la guardia sea la primera sentencia de la entrada y de cada worker propio (B-27). La prueba en el navegador,
// contra el build real, la página y los tres workers, es tests/e2e/csp.spec.ts (T-CS-01, T-CS-02 y T-CS-04) y T-PV-12 en
// tests/e2e/zero-network.spec.ts. En Vitest `import.meta.env.PROD` es falso: importar el módulo no instala nada en el global
// de Node. Solo datos ficticios.
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { instalarGuardia } from '../../src/guard.ts';

const ORIGEN = 'https://sig-low.ejemplo.test';

/** Request que resuelve rutas relativas contra la página, como en el navegador (el de Node exige una URL absoluta). Lee la
 * entrada una vez, como el del navegador. */
class PeticionDePagina extends Request {
  constructor(entrada: RequestInfo | URL, opciones?: RequestInit) {
    super(entrada instanceof Request ? entrada : new URL(String(entrada), `${ORIGEN}/`), opciones);
  }
}

interface Simulado {
  g: Record<string, unknown>;
  original: Mock<(p: Request) => Promise<Response>>;
  creados: unknown[];
}

/** Un global con lo que expone la ventana (o, con `worker`, un worker: sin DOM, sin `open`, `sendBeacon` ni `share`). */
function simulado(opciones: { worker?: boolean } = {}): Simulado {
  const original = vi.fn((_p: Request) => Promise.resolve(new Response('ok')));
  const creados: unknown[] = [];
  const g: Record<string, unknown> = {
    fetch: original, Request: PeticionDePagina, URL, location: { origin: ORIGEN },
    XMLHttpRequest: class {}, WebSocket: class {}, WebSocketStream: class {}, WebTransport: class {}, EventSource: class {},
    RTCPeerConnection: class {}, webkitRTCPeerConnection: class {}, RTCDataChannel: class {},
  };
  if (opciones.worker) {
    g['navigator'] = Object.create({ hardwareConcurrency: 4 }) as object;
    return { g, original, creados };
  }
  g['fetchLater'] = (): void => undefined;
  g['open'] = (): null => null;
  g['SpeechSynthesisUtterance'] = class {};
  g['webkitSpeechRecognition'] = class {};
  g['XSLTProcessor'] = class {};
  g['documentPictureInPicture'] = { requestWindow: () => Promise.resolve({}) };
  // Protected Audience vive en Navigator.prototype y Topics en Document.prototype, como en Chromium.
  g['navigator'] = Object.create({
    sendBeacon: () => true, share: () => Promise.resolve(),
    joinAdInterestGroup: () => Promise.resolve(), runAdAuction: () => Promise.resolve(null),
  }) as object;
  const Documento = class {
    createElement(nombre: unknown): unknown { creados.push(nombre); return { nombre }; }
    createElementNS(ns: unknown, nombre: unknown): unknown { creados.push(nombre); return { ns, nombre }; }
    open(): string { return 'abierto'; }
    browsingTopics(): Promise<unknown[]> { return Promise.resolve([]); }
  };
  g['Document'] = Documento;
  g['document'] = new Documento();
  g['DOMImplementation'] = class {
    createDocument(ns: unknown, nombre: unknown, tipo?: unknown): unknown { creados.push(nombre); return { ns, nombre, tipo }; }
  };
  for (const clase of ['HTMLIFrameElement', 'HTMLFrameElement', 'HTMLObjectElement']) {
    const C = class {};
    for (const p of ['contentWindow', 'contentDocument']) Object.defineProperty(C.prototype, p, { get: () => 'realm', configurable: true, enumerable: true });
    g[clase] = C;
  }
  g['CustomElementRegistry'] = class { define(...a: unknown[]): unknown[] { creados.push(a); return a; } };
  // B-50: `ServiceWorkerContainer.prototype.register`; lo que recibe se anota en `creados` (como los demás sumideros).
  g['ServiceWorkerContainer'] = class { register(...a: unknown[]): Promise<unknown> { creados.push(['register', ...a]); return Promise.resolve('registro'); } };
  return { g, original, creados };
}

const llamarFetch = (g: Record<string, unknown>, entrada: unknown, opciones?: RequestInit): Promise<unknown> =>
  (g['fetch'] as (e: unknown, o?: RequestInit) => Promise<unknown>)(entrada, opciones);

/** El resultado de un fetch de la guardia: la URL que recibió el fetch original o el error de rechazo. */
async function resultado(s: Simulado, entrada: unknown, opciones?: RequestInit): Promise<string> {
  const antes = s.original.mock.calls.length;
  try {
    await llamarFetch(s.g, entrada, opciones);
  } catch (e) {
    expect(s.original.mock.calls.length).toBe(antes);
    return `rechazo ${(e as Error).name} ${(e as Error).message}`;
  }
  const p = s.original.mock.calls.at(-1)![0] as Request;
  expect(s.original.mock.contexts.at(-1)).toBe(s.g); // el fetch original corre sobre el global, como fetch(…)
  return `${p.method} ${p.url}`;
}

const lanza = (fn: () => unknown): string => {
  try { fn(); return 'no lanza'; } catch (e) { return `lanza ${(e as Error).name} ${(e as { code?: string }).code ?? ''}`.trim(); }
};

describe('T-CS-01 y T-CS-02 fetch acotado (5.2.1): solo GET al mismo origen, sin query ni cuerpo, a /, /index.html, /assets/, /ort/ y /models/', () => {
  it('admite las rutas de la app, de ORT-web y del modelo, con cadena, URL o Request, y sale esa misma petición', async () => {
    const s = simulado();
    instalarGuardia(s.g);
    const casos: [unknown, RequestInit | undefined, string][] = [
      ['/', undefined, `GET ${ORIGEN}/`],
      ['/index.html', undefined, `GET ${ORIGEN}/index.html`],
      ['/assets/index-Cx0Prueba.js', undefined, `GET ${ORIGEN}/assets/index-Cx0Prueba.js`],
      [`${ORIGEN}/ort/ort-wasm-simd-threaded.wasm`, { credentials: 'same-origin' }, `GET ${ORIGEN}/ort/ort-wasm-simd-threaded.wasm`],
      // El fetcher de ner.worker.ts (PF-2): URL, GET explícito, sin seguir redirecciones, sin credenciales ni referente.
      [new URL(`${ORIGEN}/models/gliner-x-base/onnx/model_quantized.onnx`), { method: 'GET', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' },
        `GET ${ORIGEN}/models/gliner-x-base/onnx/model_quantized.onnx`],
      [new Request(`${ORIGEN}/models/gliner-x-base/tokenizer.json`), undefined, `GET ${ORIGEN}/models/gliner-x-base/tokenizer.json`],
      ['/assets/x.js', { method: 'get' }, `GET ${ORIGEN}/assets/x.js`],
      ['/assets/x.js#parte', undefined, `GET ${ORIGEN}/assets/x.js#parte`],
    ];
    for (const [entrada, opciones, esperado] of casos) expect(await resultado(s, entrada, opciones), String(entrada)).toBe(esperado);
    // Las opciones viajan en la petición que sale.
    const ner = s.original.mock.calls[4]![0] as Request;
    expect([ner.redirect, ner.credentials, ner.referrerPolicy]).toEqual(['error', 'omit', 'no-referrer']);
  });

  it('rechaza con TypeError, como un fallo de red y sin llamar al fetch original, todo lo demás', async () => {
    const s = simulado();
    instalarGuardia(s.g);
    const casos: [unknown, RequestInit | undefined][] = [
      ['https://ejemplo.test/fuga', undefined],
      ['http://sig-low.ejemplo.test/assets/x.js', undefined], // otro esquema: otro origen
      ['https://sig-low.ejemplo.test:8443/assets/x.js', undefined], // otro puerto
      ['//ejemplo.test/assets/x.js', undefined],
      ['/assets/x.js', { method: 'POST', body: 'x' }],
      ['/assets/x.js', { method: 'PUT', body: 'x' }],
      ['/assets/x.js', { method: 'HEAD' }],
      ['/assets/x.js', { method: 'GET', body: 'x' }], // Request lo rechaza: también aquí
      [new Request(`${ORIGEN}/assets/x.js`, { method: 'POST', body: 'x' }), undefined],
      [new Request(`${ORIGEN}/assets/x.js`), { method: 'DELETE' }],
      ['/assets/x.js?d=x', undefined],
      ['/?d=x', undefined],
      ['/assets/x.js?', undefined], // query vacía
      ['/assets/x.js?#f', undefined],
      ['/sw.js', undefined],
      ['/tt-policy.js', undefined],
      ['/precache.json', undefined],
      ['/fuga', undefined],
      ['/assets', undefined],
      ['/assetsx/x.js', undefined],
      ['/models', undefined],
      ['/index.htm', undefined],
      ['/assets/../sw.js', undefined], // la URL normalizada es /sw.js
      ['/assets/%2e%2e/sw.js', undefined],
      ['/%61ssets/x.js', undefined],
      ['data:text/plain,x', undefined],
      ['blob:https://sig-low.ejemplo.test/00000000-0000-0000-0000-000000000000', undefined],
      ['http://[::1', undefined], // URL inválida
    ];
    for (const [entrada, opciones] of casos) {
      expect(await resultado(s, entrada, opciones), `${String(entrada)} ${JSON.stringify(opciones ?? {})}`).toBe('rechazo TypeError URL_NO_PERMITIDA');
    }
    expect(s.original).not.toHaveBeenCalled();
  });

  it('la entrada se lee una sola vez: lo que se comprueba es lo que se pide', async () => {
    const s = simulado();
    instalarGuardia(s.g);
    let n = 0;
    const cambiante = { toString: (): string => (n++ === 0 ? '/assets/x.js' : 'https://ejemplo.test/fuga') };
    expect(await resultado(s, cambiante)).toBe(`GET ${ORIGEN}/assets/x.js`);
    expect(n).toBe(1);
  });

  it('queda fijo: no se puede reescribir ni redefinir, y una segunda instalación no lo cambia', async () => {
    const s = simulado();
    instalarGuardia(s.g);
    const acotado = s.g['fetch'];
    expect(() => { s.g['fetch'] = s.original; }).toThrow(TypeError);
    expect(() => Object.defineProperty(s.g, 'fetch', { value: s.original })).toThrow(TypeError);
    instalarGuardia(s.g);
    expect(s.g['fetch']).toBe(acotado);
    expect(await resultado(s, '/assets/x.js')).toBe(`GET ${ORIGEN}/assets/x.js`);
    expect(s.original).toHaveBeenCalledTimes(1);
  });

  it('falla cerrada: sin Request, URL u origen conocido, rechaza todo', async () => {
    for (const falta of ['Request', 'URL', 'location']) {
      const s = simulado();
      delete s.g[falta];
      instalarGuardia(s.g);
      expect(await resultado(s, `${ORIGEN}/assets/x.js`), falta).toBe('rechazo TypeError URL_NO_PERMITIDA');
    }
  });
});

describe('T-CS-01 red y navegación que la app no usa: lanzan SiglowError ERROR_INTERNO, como función y como constructor', () => {
  it('XMLHttpRequest, WebSocket, WebSocketStream, WebTransport (B-26), EventSource, fetchLater, window.open, document.open, sendBeacon y share', () => {
    const s = simulado();
    instalarGuardia(s.g);
    const g = s.g as Record<string, new (...a: unknown[]) => unknown>;
    for (const nombre of ['XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'WebTransport', 'EventSource', 'fetchLater', 'open']) {
      expect(lanza(() => new g[nombre]!('https://ejemplo.test/')), nombre).toBe('lanza SiglowError ERROR_INTERNO');
      expect(lanza(() => (g[nombre] as unknown as (u: string) => unknown)('https://ejemplo.test/')), nombre).toBe('lanza SiglowError ERROR_INTERNO');
    }
    const nav = s.g['navigator'] as Record<string, (...a: unknown[]) => unknown>;
    const protoNav = Object.getPrototypeOf(nav) as Record<string, (...a: unknown[]) => unknown>;
    for (const nombre of ['sendBeacon', 'share']) {
      expect(lanza(() => nav[nombre]!('https://ejemplo.test/', 'x')), nombre).toBe('lanza SiglowError ERROR_INTERNO');
      expect(lanza(() => protoNav[nombre]!.call(nav, 'https://ejemplo.test/', 'x')), nombre).toBe('lanza SiglowError ERROR_INTERNO');
    }
    const doc = new (s.g['Document'] as new () => { open(...a: unknown[]): unknown })();
    expect(lanza(() => doc.open('https://ejemplo.test/?d=x', '_blank', ''))).toBe('lanza SiglowError ERROR_INTERNO');
    // Fijos: ni asignar ni redefinir.
    expect(() => { s.g['WebSocket'] = class {}; }).toThrow(TypeError);
    expect(() => { s.g['WebTransport'] = class {}; }).toThrow(TypeError);
    expect(() => Object.defineProperty(s.g, 'WebSocketStream', { value: class {} })).toThrow(TypeError);
    expect(() => Object.defineProperty(protoNav, 'sendBeacon', { value: () => true })).toThrow(TypeError);
  });
});

describe('T-CS-01 Protected Audience y Topics (PD-2-r2): undefined y fijos en navigator, document y sus prototipos', () => {
  it('joinAdInterestGroup y runAdAuction (Navigator.prototype) y browsingTopics (Document.prototype, también en documentos nuevos)', () => {
    const s = simulado();
    const nav = s.g['navigator'] as Record<string, unknown>;
    const protoNav = Object.getPrototypeOf(nav) as Record<string, unknown>;
    const Documento = s.g['Document'] as new () => Record<string, unknown>;
    instalarGuardia(s.g);
    const fijoEnUndefined = { value: undefined, writable: false, enumerable: false, configurable: false };
    for (const nombre of ['joinAdInterestGroup', 'runAdAuction']) {
      expect(typeof nav[nombre], nombre).toBe('undefined');
      expect(Object.getOwnPropertyDescriptor(protoNav, nombre), nombre).toEqual(fijoEnUndefined);
      expect(() => { nav[nombre] = (): null => null; }, nombre).toThrow(TypeError);
      expect(() => Object.defineProperty(protoNav, nombre, { value: (): null => null }), nombre).toThrow(TypeError);
    }
    expect(typeof (s.g['document'] as Record<string, unknown>)['browsingTopics']).toBe('undefined');
    expect(Object.getOwnPropertyDescriptor(Documento.prototype, 'browsingTopics')).toEqual(fijoEnUndefined);
    expect(typeof new Documento()['browsingTopics']).toBe('undefined');
    // No toca lo demás de navigator ni de document.
    expect(lanza(() => (nav['sendBeacon'] as () => unknown)())).toBe('lanza SiglowError ERROR_INTERNO');
    expect(typeof new Documento()['createElement']).toBe('function');
  });

  it('en un worker no inventa lo que no existe', () => {
    const s = simulado({ worker: true });
    instalarGuardia(s.g);
    for (const nombre of ['joinAdInterestGroup', 'runAdAuction', 'browsingTopics']) expect(nombre in (s.g['navigator'] as object), nombre).toBe(false);
    expect('document' in s.g).toBe(false);
  });
});

describe('T-CS-01 B-50 el registro del service worker: solo /sw.js exacto, convertido una vez, y fijo', () => {
  const registrar = (s: Simulado, ...args: unknown[]): Promise<unknown> =>
    (new (s.g['ServiceWorkerContainer'] as new () => { register(...a: unknown[]): Promise<unknown> })()).register(...args);
  const veredicto = async (s: Simulado, ...args: unknown[]): Promise<string> => {
    const antes = s.creados.length;
    try { await registrar(s, ...args); } catch (e) { expect(s.creados.length).toBe(antes); return `rechazo ${(e as Error).name} ${(e as Error).message}`; }
    return `registró ${JSON.stringify((s.creados.at(-1) as unknown[]).slice(1))}`;
  };

  it("admite register('/sw.js', opciones) tal como lo llama la app, con las opciones intactas", async () => {
    const s = simulado();
    instalarGuardia(s.g);
    const opciones = { type: 'module', scope: '/', updateViaCache: 'none' };
    expect(await veredicto(s, '/sw.js', opciones)).toBe(`registró ${JSON.stringify(['/sw.js', opciones])}`);
    expect(await registrar(s, '/sw.js')).toBe('registro');
  });

  it("rechaza con TypeError URL_NO_PERMITIDA, sin llamar al original, todo lo que no sea '/sw.js' exacto (el dato en la ruta, la query, el origen)", async () => {
    const s = simulado();
    instalarGuardia(s.g);
    const casos: unknown[][] = [
      ['/assets/Ficticia-Rojas.js', { scope: '/assets/' }], ['/assets/x.js%3Fd=Ficticia'], ['/ort/Ficticia.mjs'], ['/assets/1.000.000.017/a.js'],
      ['/sw.js?d=x'], ['/sw.js#d'], ['/sw.js/'], ['/SW.js'], ['sw.js'], ['./sw.js'], ['//ejemplo.test/sw.js'], [`${ORIGEN}/sw.js`], ['https://ejemplo.test/sw.js'],
      [], [undefined], [null], [new URL(`${ORIGEN}/sw.js`)],
    ];
    for (const args of casos) expect(await veredicto(s, ...args), JSON.stringify(args)).toBe('rechazo TypeError URL_NO_PERMITIDA');
    expect(s.creados).toEqual([]);
  });

  it('el argumento se lee una sola vez: lo que se comprueba es lo que se registra', async () => {
    const s = simulado();
    instalarGuardia(s.g);
    let n = 0;
    const cambiante = { toString: (): string => (n++ === 0 ? '/sw.js' : '/assets/Ficticia-Rojas.js') };
    expect(await veredicto(s, cambiante, { scope: '/' })).toBe(`registró ${JSON.stringify(['/sw.js', { scope: '/' }])}`);
    expect(n).toBe(1);
    // Un toString que lanza no deja pasar nada.
    const lanzador = { toString: (): string => { throw new Error('x'); } };
    expect(await veredicto(s, lanzador)).toBe('rechazo TypeError URL_NO_PERMITIDA');
  });

  it('queda fijo (no se puede reescribir ni redefinir), una segunda instalación no lo cambia y en un worker no inventa lo que no existe', async () => {
    const s = simulado();
    instalarGuardia(s.g);
    const Contenedor = s.g['ServiceWorkerContainer'] as { prototype: Record<string, unknown> };
    const acotado = Contenedor.prototype['register'];
    expect(() => { Contenedor.prototype['register'] = (): null => null; }).toThrow(TypeError);
    expect(() => Object.defineProperty(Contenedor.prototype, 'register', { value: (): null => null })).toThrow(TypeError);
    instalarGuardia(s.g);
    expect(Contenedor.prototype['register']).toBe(acotado);
    const w = simulado({ worker: true });
    instalarGuardia(w.g);
    expect('ServiceWorkerContainer' in w.g).toBe(false);
  });
});

describe('T-CS-04 WebRTC y voz (V-02, B-18): undefined y fijos', () => {
  it('los tres constructores de WebRTC, speechSynthesis, SpeechSynthesisUtterance y el reconocimiento de voz', () => {
    const s = simulado();
    // speechSynthesis como atributo en el prototipo del global (como un getter de Window.prototype).
    const protoGlobal = { };
    Object.defineProperty(protoGlobal, 'speechSynthesis', { get: () => ({ speak: () => undefined }), configurable: true, enumerable: true });
    Object.setPrototypeOf(s.g, protoGlobal);
    instalarGuardia(s.g);
    for (const nombre of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'speechSynthesis', 'SpeechSynthesisUtterance', 'SpeechRecognition', 'webkitSpeechRecognition']) {
      expect(typeof s.g[nombre], nombre).toBe('undefined');
      expect(() => { s.g[nombre] = class {}; }, nombre).toThrow(TypeError);
      expect(typeof s.g[nombre], nombre).toBe('undefined');
    }
    expect(Object.getOwnPropertyDescriptor(protoGlobal, 'speechSynthesis')).toEqual({ value: undefined, writable: false, enumerable: false, configurable: false });
  });
});

describe('T-CS-04 realms nuevos (M-4): sin iframe, frame, object ni embed, y sin acceso al realm de uno que exista', () => {
  it('createElement y createElementNS los rechazan (con mayúsculas y prefijo) y crean lo demás con el nombre ya convertido', () => {
    const s = simulado();
    instalarGuardia(s.g);
    const doc = new (s.g['Document'] as new () => { createElement(n: unknown, o?: unknown): unknown; createElementNS(ns: unknown, n: unknown): unknown })();
    const HTML = 'http://www.w3.org/1999/xhtml';
    for (const n of ['iframe', 'IFRAME', 'frame', 'object', 'embed', 'Embed']) {
      expect(lanza(() => doc.createElement(n)), n).toBe('lanza SiglowError ERROR_INTERNO');
      expect(lanza(() => doc.createElementNS(HTML, n)), n).toBe('lanza SiglowError ERROR_INTERNO');
    }
    expect(lanza(() => doc.createElementNS(HTML, 'x:iframe'))).toBe('lanza SiglowError ERROR_INTERNO');
    expect(lanza(() => doc.createElement('iframe', { is: 'x-marco' }))).toBe('lanza SiglowError ERROR_INTERNO');
    expect(s.creados).toEqual([]);
    expect(doc.createElement('div')).toEqual({ nombre: 'div' });
    expect(doc.createElementNS('http://www.w3.org/2000/svg', 'svg')).toEqual({ ns: 'http://www.w3.org/2000/svg', nombre: 'svg' });
    // El nombre se lee una vez: el que se comprueba es el que se crea.
    let n = 0;
    const cambiante = { toString: (): string => (n++ === 0 ? 'p' : 'iframe') };
    expect(doc.createElement(cambiante)).toEqual({ nombre: 'p' });
    expect(s.creados).toEqual(['div', 'svg', 'p']);
  });

  it('customElements.define rechaza extender iframe, frame, object o embed; contentWindow y contentDocument devuelven null', () => {
    const s = simulado();
    instalarGuardia(s.g);
    const registro = new (s.g['CustomElementRegistry'] as new () => { define(...a: unknown[]): unknown })();
    class X {}
    for (const ext of ['iframe', 'OBJECT', 'embed', 'frame']) expect(lanza(() => registro.define('x-marco', X, { extends: ext })), ext).toBe('lanza SiglowError ERROR_INTERNO');
    expect(registro.define('x-parrafo', X, { extends: 'p' })).toEqual(['x-parrafo', X, { extends: 'p' }]);
    expect(registro.define('x-propio', X)).toEqual(['x-propio', X]);
    for (const clase of ['HTMLIFrameElement', 'HTMLFrameElement', 'HTMLObjectElement']) {
      const el = new (s.g[clase] as new () => Record<string, unknown>)();
      expect([el['contentWindow'], el['contentDocument']], clase).toEqual([null, null]);
      const proto = (s.g[clase] as { prototype: object }).prototype;
      expect(() => Object.defineProperty(proto, 'contentWindow', { get: () => 'realm' }), clase).toThrow(TypeError);
    }
  });

  it('B-25: XSLTProcessor (una transformación crea un iframe) y documentPictureInPicture (una ventana con su realm) en undefined y fijos', () => {
    const s = simulado();
    instalarGuardia(s.g);
    for (const nombre of ['XSLTProcessor', 'documentPictureInPicture']) {
      expect(typeof s.g[nombre], nombre).toBe('undefined');
      expect(Object.getOwnPropertyDescriptor(s.g, nombre), nombre).toEqual({ value: undefined, writable: false, enumerable: false, configurable: false });
      expect(() => { s.g[nombre] = class {}; }, nombre).toThrow(TypeError);
      expect(() => Object.defineProperty(s.g, nombre, { value: class {} }), nombre).toThrow(TypeError);
    }
  });

  it('PD-2-r2: createDocument rechaza un elemento raíz iframe, frame, object o embed; crea lo demás con el nombre ya convertido y null como «sin raíz»', () => {
    const s = simulado();
    instalarGuardia(s.g);
    const impl = new (s.g['DOMImplementation'] as new () => { createDocument(ns: unknown, n: unknown, t?: unknown): unknown })();
    const HTML = 'http://www.w3.org/1999/xhtml';
    for (const n of ['iframe', 'IFRAME', 'x:iframe', 'frame', 'object', 'embed']) {
      expect(lanza(() => impl.createDocument(HTML, n, null)), n).toBe('lanza SiglowError ERROR_INTERNO');
    }
    expect(s.creados).toEqual([]);
    expect(impl.createDocument('http://www.w3.org/2000/svg', 'svg', null)).toEqual({ ns: 'http://www.w3.org/2000/svg', nombre: 'svg', tipo: null });
    // [LegacyNullToEmptyString]: null no es el elemento «null».
    expect(impl.createDocument(null, null, null)).toEqual({ ns: null, nombre: '', tipo: null });
    let n = 0;
    const cambiante = { toString: (): string => (n++ === 0 ? 'x' : 'iframe') };
    expect(impl.createDocument(HTML, cambiante)).toEqual({ ns: HTML, nombre: 'x', tipo: undefined });
    expect(s.creados).toEqual(['svg', '', 'x']);
    const proto = (s.g['DOMImplementation'] as { prototype: object }).prototype;
    expect(() => Object.defineProperty(proto, 'createDocument', { value: () => null })).toThrow(TypeError);
  });
});

describe('T-CS-02 en un worker propio: instala lo que existe y no inventa lo que no', () => {
  it('fetch acotado, XMLHttpRequest, WebSocket, WebSocketStream, WebTransport y EventSource bloqueados, WebRTC en undefined; sin open, sendBeacon ni DOM', async () => {
    const s = simulado({ worker: true });
    instalarGuardia(s.g);
    expect(await resultado(s, '/models/gliner-x-base/tokenizer.json')).toBe(`GET ${ORIGEN}/models/gliner-x-base/tokenizer.json`);
    expect(await resultado(s, 'https://ejemplo.test/fuga')).toBe('rechazo TypeError URL_NO_PERMITIDA');
    for (const nombre of ['XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'WebTransport', 'EventSource']) {
      expect(lanza(() => new (s.g[nombre] as new () => unknown)()), nombre).toBe('lanza SiglowError ERROR_INTERNO');
    }
    expect(typeof s.g['RTCPeerConnection']).toBe('undefined');
    for (const nombre of ['open', 'fetchLater', 'Document']) expect(nombre in s.g, nombre).toBe(false);
    expect('sendBeacon' in (s.g['navigator'] as object)).toBe(false);
  });
});

// ===== B-27: la guardia corre antes que cualquier otro módulo solo si es la primera sentencia. Los imports se evalúan en el
// orden del texto (también un `export … from`), y el build lo respeta: con la guardia en segundo lugar, Preact se evalúa antes
// y check-dist no lo nota (solo exige que esté). Esta prueba lee el código fuente. =====
const GUARDIA = resolve('src/guard.ts');
const CON_GUARDIA = ['src/main.tsx', 'src/workers/detect.worker.ts', 'src/workers/io.worker.ts', 'src/workers/ner.worker.ts'];

/** El texto sin los espacios ni los comentarios del principio (`//`, `/* … *\/` y las directivas `/// <reference …>`). */
function sinComentariosIniciales(texto: string): string {
  let t = texto.replace(/^﻿/, '');
  for (;;) {
    t = t.replace(/^\s+/, '');
    if (t.startsWith('//')) { const i = t.indexOf('\n'); t = i < 0 ? '' : t.slice(i + 1); continue; }
    if (t.startsWith('/*')) { const i = t.indexOf('*/'); t = i < 0 ? '' : t.slice(i + 2); continue; }
    return t;
  }
}

/** El módulo de la primera sentencia si es un import sin enlaces (`import '…';`), resuelto a una ruta absoluta; si no, null. */
function primerImport(archivo: string): string | null {
  const m = /^import\s*(['"])([^'"\n]+)\1\s*;/.exec(sinComentariosIniciales(readFileSync(resolve(archivo), 'utf8')));
  if (!m) return null;
  const ruta = resolve(dirname(resolve(archivo)), m[2]!);
  return extname(ruta) === '' ? `${ruta}.ts` : ruta;
}

/** Sentencias que cargan un módulo en tiempo de ejecución (los `import type` se borran al compilar). */
const importsDe = (archivo: string): string[] =>
  [...readFileSync(resolve(archivo), 'utf8').matchAll(/^\s*(?:import(?!\s+type\b)[\s{*'"][^;]*;|export\s[^;]*?\sfrom\s*['"][^'"]+['"]\s*;)/gm)].map((m) => m[0].trim());

describe('T-CS-01 y T-CS-02 (B-27) la guardia es la primera sentencia de la entrada y de cada worker propio', () => {
  for (const archivo of CON_GUARDIA) {
    it(`${archivo}: su primera sentencia es import de src/guard.ts`, () => {
      const inicio = sinComentariosIniciales(readFileSync(resolve(archivo), 'utf8')).slice(0, 80);
      expect(primerImport(archivo), `primera sentencia: ${inicio}`).toBe(GUARDIA);
    });
  }

  it('src/guard.ts solo importa src/core/types.ts, y types.ts no importa nada: nada más se evalúa antes de instalarla', () => {
    expect(importsDe('src/guard.ts')).toEqual(["import { SiglowError } from './core/types.ts';"]);
    expect(importsDe('src/core/types.ts')).toEqual([]);
  });

  it('el detector ve una sentencia antes de la guardia, la guardia en segundo lugar y un import con enlaces', () => {
    const primera = (t: string): string | null => /^import\s*(['"])([^'"\n]+)\1\s*;/.exec(sinComentariosIniciales(t))?.[2] ?? null;
    expect(primera("/// <reference lib=\"webworker\" />\n// x\n/* y */\nimport '../guard'; // z\nimport { a } from 'b';")).toBe('../guard');
    expect(primera("import { render } from 'preact';\nimport './guard.ts';")).toBeNull();
    expect(primera("export * from './x.ts';\nimport './guard.ts';")).toBeNull();
    expect(primera("const x = 1;\nimport './guard.ts';")).toBeNull();
    expect(primera("import './otro.ts';\nimport './guard.ts';")).toBe('./otro.ts');
  });
});
