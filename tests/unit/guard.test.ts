// Guardia src/guard.ts (5.2.1; PD-2-r1: B-17, M-4 y B-18). Pruebas sobre un global simulado (ventana o worker): la lógica
// del fetch acotado, los reemplazos y el cierre de realms. La prueba en el navegador, contra el build real, la página y los
// tres workers, es tests/e2e/csp.spec.ts (T-CS-01, T-CS-02 y T-CS-04). En Vitest `import.meta.env.PROD` es falso: importar
// el módulo no instala nada en el global de Node. Solo datos ficticios.
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
    XMLHttpRequest: class {}, WebSocket: class {}, EventSource: class {},
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
  g['navigator'] = Object.create({ sendBeacon: () => true, share: () => Promise.resolve() }) as object;
  g['Document'] = class {
    createElement(nombre: unknown): unknown { creados.push(nombre); return { nombre }; }
    createElementNS(ns: unknown, nombre: unknown): unknown { creados.push(nombre); return { ns, nombre }; }
    open(): string { return 'abierto'; }
  };
  for (const clase of ['HTMLIFrameElement', 'HTMLFrameElement', 'HTMLObjectElement']) {
    const C = class {};
    for (const p of ['contentWindow', 'contentDocument']) Object.defineProperty(C.prototype, p, { get: () => 'realm', configurable: true, enumerable: true });
    g[clase] = C;
  }
  g['CustomElementRegistry'] = class { define(...a: unknown[]): unknown[] { creados.push(a); return a; } };
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
  it('XMLHttpRequest, WebSocket, EventSource, fetchLater, window.open, document.open, sendBeacon y share', () => {
    const s = simulado();
    instalarGuardia(s.g);
    const g = s.g as Record<string, new (...a: unknown[]) => unknown>;
    for (const nombre of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'fetchLater', 'open']) {
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
    expect(() => Object.defineProperty(protoNav, 'sendBeacon', { value: () => true })).toThrow(TypeError);
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
});

describe('T-CS-02 en un worker propio: instala lo que existe y no inventa lo que no', () => {
  it('fetch acotado, XMLHttpRequest, WebSocket y EventSource bloqueados, WebRTC en undefined; sin open, sendBeacon ni DOM', async () => {
    const s = simulado({ worker: true });
    instalarGuardia(s.g);
    expect(await resultado(s, '/models/gliner-x-base/tokenizer.json')).toBe(`GET ${ORIGEN}/models/gliner-x-base/tokenizer.json`);
    expect(await resultado(s, 'https://ejemplo.test/fuga')).toBe('rechazo TypeError URL_NO_PERMITIDA');
    for (const nombre of ['XMLHttpRequest', 'WebSocket', 'EventSource']) {
      expect(lanza(() => new (s.g[nombre] as new () => unknown)()), nombre).toBe('lanza SiglowError ERROR_INTERNO');
    }
    expect(typeof s.g['RTCPeerConnection']).toBe('undefined');
    for (const nombre of ['open', 'fetchLater', 'Document']) expect(nombre in s.g, nombre).toBe(false);
    expect('sendBeacon' in (s.g['navigator'] as object)).toBe(false);
  });
});
