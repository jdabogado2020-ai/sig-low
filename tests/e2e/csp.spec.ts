import { test, expect, type Browser, type BrowserContext, type Page, type Worker as TrabajadorPw } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createSocket, type Socket } from 'node:dgram';
import { createServer, type Server as ServidorTcp } from 'node:net';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { guardarOriginales, type Nativo } from './lib/originales';

// Prueba de CSP (10.5.4; PD-2 y PD-2-r1): T-CS-01 a T-CS-07. La app se sirve con tests/e2e/server.mjs (aplica dist/_headers) y
// su registro de peticiones; el señuelo es un servidor TCP crudo en otro puerto (otro origen) que anota TODA conexión (HTTP,
// subida a WebSocket, formulario…), y el STUN falso es un socket UDP. Criterio general: 0 conexiones en el señuelo; el
// valor de retorno de sendBeacon no prueba nada (10.5.4). Cada intento corre solo y se le asignan sus violaciones.
// La guardia (src/guard.ts, 5.2.1) es el primer import de la página y de los workers propios (`detect`, `io`, `ner`): acota
// fetch, neutraliza XMLHttpRequest, WebSocket, EventSource, sendBeacon, fetchLater, share, window.open, document.open,
// WebRTC y la voz, y cierra los realms de iframe (M-4). Para probar la CSP y el interruptor del SW por debajo de ella, un
// script de inicio guarda las API originales antes de que corra la app (`__nativo`, tests/e2e/lib/originales.ts), y en los
// workers se usa uno sin guardia (el de pdf.js, de terceros). Solo datos ficticios: los cuerpos son «x».

const DIST = resolve('dist');
const CSP_CANONICA = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; font-src 'self'; manifest-src 'self'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types default";
const CSP_RUTAS = "script-src 'wasm-unsafe-eval' *:*/assets/ *:*/ort/ *:*/tt-policy.js; worker-src *:*/assets/ *:*/ort/ *:*/sw.js; connect-src https: http:";
// Permissions-Policy de 3.6 más `browsing-topics=()` y `private-state-token-issuance=()` (PD-2-r2; T-CS-07).
const PERMISOS = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), display-capture=(), clipboard-read=(), clipboard-write=(self), browsing-topics=(), private-state-token-issuance=()';
const GUARDIA = 'lanza SiglowError ERROR_INTERNO';

interface Peticion { t: number; m: string; u: string }
interface Servidor { origen: string; peticiones: () => Peticion[]; parar: () => Promise<void> }
interface Senuelo { origen: string; puerto: number; conexiones: string[]; parar: () => Promise<void> }
interface Intento { nombre: string; res: string; directivas: string[] }
type Esperado = Record<string, { res: string | RegExp; directiva: string | null }>;

let tmp = '';

function puertoLibre(): Promise<number> {
  return new Promise((ok, mal) => {
    const s = createServer();
    s.once('error', mal);
    s.listen(0, '127.0.0.1', () => {
      const dir = s.address();
      s.close(() => { if (dir && typeof dir === 'object') ok(dir.port); else mal(new Error('sin puerto')); });
    });
  });
}

async function levantar(dir: string): Promise<Servidor> {
  const puerto = await puertoLibre();
  const registro = join(tmp, `peticiones-${puerto}-${Date.now()}.jsonl`);
  writeFileSync(registro, '');
  const hijo = spawn(process.execPath, ['tests/e2e/server.mjs', '--dir', dir, '--port', String(puerto)], {
    env: { ...process.env, SIGLOW_REGISTRO_PETICIONES: registro },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  await new Promise<void>((ok, mal) => {
    hijo.stdout.on('data', (b: Buffer) => { if (b.toString().includes('listo')) ok(); });
    hijo.once('exit', (c) => { mal(new Error(`server.mjs terminó (código ${String(c)})`)); });
  });
  return {
    origen: `http://127.0.0.1:${puerto}`,
    peticiones: () => readFileSync(registro, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Peticion),
    parar: () => new Promise<void>((ok) => {
      if (hijo.exitCode !== null) { ok(); return; }
      hijo.once('exit', () => { ok(); });
      hijo.kill();
    }),
  };
}

/** Señuelo TCP: anota la primera línea de cada conexión (o «(sin datos)») y responde 404. */
async function levantarSenuelo(): Promise<Senuelo> {
  const conexiones: string[] = [];
  const s: ServidorTcp = createServer((c) => {
    let anotada = false;
    const anotar = (l: string): void => { if (!anotada) { anotada = true; conexiones.push(l); } };
    c.once('data', (b) => { anotar(b.toString('latin1').split('\r\n')[0] ?? ''); c.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); });
    c.once('close', () => { anotar('(sin datos)'); });
    c.on('error', () => undefined);
  });
  await new Promise<void>((ok) => { s.listen(0, '127.0.0.1', () => { ok(); }); });
  const puerto = (s.address() as { port: number }).port;
  return { origen: `http://127.0.0.1:${puerto}`, puerto, conexiones, parar: () => new Promise<void>((ok) => { s.close(() => { ok(); }); }) };
}

const esperarControl = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, { timeout: 30_000 });

/** Escucha de violaciones en la ventana y copia de las API originales, antes de cualquier script de la página. */
async function abrir(browser: Browser, origen: string, sw: 'allow' | 'block', extra: { bypassCSP?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: origen, serviceWorkers: sw, ...extra });
  await ctx.addInitScript(() => {
    const v: { d: string; u: string }[] = [];
    (globalThis as unknown as { __violaciones: typeof v }).__violaciones = v;
    addEventListener('securitypolicyviolation', (e) => { v.push({ d: e.effectiveDirective, u: e.blockedURI }); });
    // PD-2-r2: los caminos que dan un realm sin createElement, antes de la guardia (los controles de T-CS-04). Solo en esta
    // prueba; tests/e2e/lib/originales.ts no es de la tarjeta.
    const g = globalThis as unknown as Record<string, unknown>;
    g['__realms'] = { XSLTProcessor: g['XSLTProcessor'], createDocument: DOMImplementation.prototype.createDocument, pip: g['documentPictureInPicture'] };
  });
  await guardarOriginales(ctx);
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.locator('[data-prueba="promesa"]')).toBeVisible();
  if (sw === 'allow') await esperarControl(page);
  return { ctx, page };
}

const precache = (): string[] =>
  (JSON.parse(readFileSync(join(DIST, 'precache.json'), 'utf8')) as { archivos: { ruta: string }[] }).archivos.map((a) => a.ruta);

const rutaDe = (patron: RegExp): string => {
  const r = precache().find((x) => patron.test(x));
  if (!r) throw new Error(`sin ${String(patron)} en precache.json`);
  return r;
};

/** Los workers propios del build (la guardia es su primer import). `ner` está cuando la app lo conecta (PF-2). */
function workersPropios(): string[] {
  const rutas = precache().filter((x) => /^\/assets\/(?:detect|io|ner)\.worker-[\w-]+\.js$/.test(x));
  expect(rutas.filter((r) => /\/(?:detect|io)\.worker-/.test(r)), 'los workers detect e io').toHaveLength(2);
  if (!rutas.some((r) => r.includes('/ner.worker-'))) {
    test.info().annotations.push({ type: 'sin worker ner', description: 'el build no trae el worker ner (la app aún no lo conecta): su guardia la cubren check-dist y tests/unit/guard.test.ts' });
  }
  return rutas;
}

/** Arranca un worker de módulo del mismo origen desde la página y devuelve su contexto en Playwright. */
async function arrancarWorker(page: Page, ruta: string): Promise<TrabajadorPw> {
  const [w] = await Promise.all([
    page.waitForEvent('worker', (x) => new URL(x.url()).pathname === ruta),
    page.evaluate((r) => { const g = globalThis as unknown as { __w?: Worker[] }; (g.__w ??= []).push(new Worker(r, { type: 'module' })); }, ruta),
  ]);
  return w;
}

test.beforeAll(() => {
  expect(existsSync(join(DIST, 'precache.json')), 'falta dist/: corra `npm run build` (o `npm run verify`)').toBe(true);
  tmp = mkdtempSync(join(tmpdir(), 'siglow-csp-'));
});

test.afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

// Intentos desde el documento (10.5.4). Corren dentro de la página; `s` es el origen del señuelo.
async function intentosDelDocumento(page: Page, s: string): Promise<Intento[]> {
  return page.evaluate(async (s) => {
    const esperar = (ms: number): Promise<void> => new Promise((ok) => { setTimeout(ok, ms); });
    const viol = (globalThis as unknown as { __violaciones: { d: string }[] }).__violaciones;
    const N = (globalThis as unknown as { __nativo: Nativo }).__nativo;
    const salida: Intento[] = [];
    const intento = async (nombre: string, fn: () => Promise<string> | string, lista: { d: string }[] = viol): Promise<void> => {
      const n0 = lista.length;
      let res: string;
      try { res = await fn(); } catch (e) { res = `lanza ${(e as Error).name}${(e as { code?: string }).code ? ` ${(e as { code: string }).code}` : ''}`; }
      await esperar(250);
      salida.push({ nombre, res, directivas: [...new Set(lista.slice(n0).map((v) => v.d))].sort() });
    };
    const g = globalThis as unknown as Record<string, unknown>;
    const evento = (o: { onerror: unknown; onload?: unknown; onopen?: unknown }, ms = 3000): Promise<string> => new Promise((ok) => {
      o.onerror = () => { ok('error'); };
      if ('onload' in o) o.onload = () => { ok('carga'); };
      if ('onopen' in o) o.onopen = () => { ok('abierto'); };
      setTimeout(() => { ok('sin evento'); }, ms);
    });
    // Rechazo de la guardia (TypeError URL_NO_PERMITIDA) o de la red: la CSP, el interruptor del SW o el servidor.
    const pedir = (f: typeof fetch, u: string, o?: RequestInit): Promise<string> =>
      f(u, o).then((r) => `respuesta ${r.status}`, (e: Error) => `rechazo ${e.name} ${e.message === 'URL_NO_PERMITIDA' ? 'guardia' : 'red'}`);
    const existe = (nombre: string, fn: () => unknown): string => { if (!(nombre in g)) return 'no existe'; fn(); return 'llamado'; };
    // La guardia, primero: fetch acotado y las API que la app no usa.
    await intento('fetch', () => pedir(fetch, `${s}/cs01-fetch?d=x`));
    await intento('fetch POST al propio origen', () => pedir(fetch, '/assets/cs01-post', { method: 'POST', body: 'x' }));
    await intento('fetch con query al propio origen', () => pedir(fetch, '/assets/cs01-query?d=x'));
    await intento('fetch propio fuera de las rutas', () => pedir(fetch, '/cs01-fuera'));
    await intento('fetch propio permitido', () => pedir(fetch, '/'));
    await intento('XMLHttpRequest', () => { const x = new (g['XMLHttpRequest'] as typeof XMLHttpRequest)(); x.open('GET', `${s}/cs01-xhr`); x.send(); return 'enviado'; });
    await intento('WebSocket', () => { new (g['WebSocket'] as typeof WebSocket)(`ws://${new URL(s).host}/cs01-ws`); return 'creado'; });
    // B-26: los dos transportes que la guardia no nombraba (T-PV-12 mide el propio origen y los paquetes UDP).
    await intento('WebSocketStream', () => { new (g['WebSocketStream'] as new (u: string) => unknown)(`ws://${new URL(s).host}/cs01-wss`); return 'creado'; });
    await intento('WebTransport', () => { new (g['WebTransport'] as new (u: string) => unknown)(`https://${new URL(s).host}/cs01-wt`); return 'creado'; });
    await intento('EventSource', () => { new (g['EventSource'] as typeof EventSource)(`${s}/cs01-es`); return 'creado'; });
    await intento('sendBeacon', () => String((navigator as unknown as Record<string, (u: string, d: string) => boolean>)['sendBeacon']!(`${s}/cs01-beacon`, 'x')));
    await intento('fetchLater', () => existe('fetchLater', () => (g['fetchLater'] as (u: string) => unknown)(`${s}/cs01-fetchlater`)));
    await intento('navigator.share', () => (typeof (navigator as unknown as Record<string, unknown>)['share'] === 'function'
      ? ((navigator as unknown as Record<string, (d: object) => unknown>)['share']!({ text: 'x', url: `${s}/cs01-share` }), 'llamado') : 'no existe'));
    await intento('document.open', () => { document.open(`${s}/cs01-document-open`, '_blank', ''); return 'abierta'; });
    // B-18: la voz, como WebRTC (en undefined). `voz antes de la guardia` muestra que las API existían.
    await intento('voz antes de la guardia', () => N.voz);
    await intento('voz', () => ['speechSynthesis', 'SpeechSynthesisUtterance', 'SpeechRecognition', 'webkitSpeechRecognition'].map((n) => typeof g[n]).join(' '));
    await intento('voz hablar', () => { (g['speechSynthesis'] as SpeechSynthesis).speak(new (g['SpeechSynthesisUtterance'] as typeof SpeechSynthesisUtterance)('x')); return 'hablado'; });
    // M-4: ningún elemento abre un realm nuevo, y el de un iframe que ya exista no se alcanza por contentWindow.
    const HTML = 'http://www.w3.org/1999/xhtml';
    await intento('iframe', () => { document.createElement('iframe'); return 'creado'; });
    await intento('iframe por createElementNS', () => { document.createElementNS(HTML, 'iframe'); return 'creado'; });
    for (const n of ['frame', 'object', 'embed']) await intento(n, () => { document.createElement(n); return 'creado'; });
    await intento('elemento personalizado que extiende iframe', () => { customElements.define('x-cs01', class extends HTMLIFrameElement {}, { extends: 'iframe' }); return 'definido'; });
    await intento('realm de un iframe ya creado', () => {
      const f = N.createElement('iframe') as HTMLIFrameElement;
      document.body.append(f);
      return `${String(f.contentWindow)} ${String(f.contentDocument)}`;
    });
    // PD-2-r2: Protected Audience y Topics, en undefined. `antes de la guardia`: las mismas API en un realm sin guardia (un
    // iframe creado con el createElement original) muestran que existen en este navegador.
    const publicidad = (w: Window): string => {
      const n = w.navigator as unknown as Record<string, unknown>;
      const d = w.document as unknown as Record<string, unknown>;
      return [typeof n['joinAdInterestGroup'], typeof n['runAdAuction'], typeof d['browsingTopics']].join(' ');
    };
    await intento('publicidad antes de la guardia', () => {
      const f = N.createElement('iframe') as HTMLIFrameElement;
      document.body.append(f);
      return publicidad(N.contentWindow(f)!);
    });
    await intento('publicidad', () => publicidad(window));
    // La CSP por debajo de la guardia: las API originales (como las vería un código que corriera antes que la guardia).
    await intento('nativo fetch', () => pedir(N.fetch, `${s}/cs01-n-fetch?d=x`));
    await intento('nativo XMLHttpRequest', () => { const x = new N.XMLHttpRequest(); const r = evento(x); x.open('GET', `${s}/cs01-n-xhr`); x.send(); return r; });
    await intento('nativo WebSocket', () => evento(new N.WebSocket(`ws://${new URL(s).host}/cs01-n-ws`)));
    await intento('nativo WebSocket al propio origen', () => evento(new N.WebSocket(`ws://${location.host}/cs01-n-ws-propio?d=x`)));
    await intento('nativo EventSource', () => evento(new N.EventSource(`${s}/cs01-n-es`)));
    await intento('nativo sendBeacon', () => String(N.sendBeacon(`${s}/cs01-n-beacon`, 'x')));
    // Lo que la guardia no toca: la CSP sola.
    await intento('imagen', () => { const i = new Image(); document.body.append(i); const r = evento(i); i.src = `${s}/cs01-p.png`; return r; });
    await intento('prefetch', () => { const l = document.createElement('link'); l.rel = 'prefetch'; const r = evento(l, 1500); l.href = `${s}/cs01-prefetch`; document.head.append(l); return r; });
    await intento('import', () => import(/* @vite-ignore */ `${s}/cs01-m.js`).then(() => 'carga', () => 'rechazo'));
    // Del propio origen pero fuera de /assets/, /ort/ y /tt-policy.js (p. ej. /cdn-cgi/): lo frena la segunda política.
    await intento('import propio fuera de las rutas', () => import(/* @vite-ignore */ `${location.origin}/cdn-cgi/cs01.js`).then(() => 'carga', () => 'rechazo'));
    await intento('Worker', () => { new Worker(`${s}/cs01-w.js`); return 'creado'; });
    await intento('innerHTML', () => { const d = document.createElement('div'); (d as unknown as { innerHTML: string }).innerHTML = '<b>x</b>'; return 'asignado'; });
    await intento('formulario', () => {
      const f = document.createElement('form');
      f.method = 'post';
      f.action = `${s}/cs01-form`;
      document.body.append(f);
      f.submit();
      return 'enviado';
    });
    // worker-src por rutas: un realm `about:blank` (creado con las API originales) puede crear su propia política «default»
    // permisiva (la CSP la admite una vez por realm), así Trusted Types deja pasar la URL y la que decide es la segunda
    // política (`worker-src` solo /assets/, /ort/ y /sw.js).
    const marco = N.createElement('iframe') as HTMLIFrameElement;
    document.body.append(marco);
    const w = N.contentWindow(marco) as unknown as Record<string, unknown> & Window;
    const violMarco: { d: string }[] = [];
    w.addEventListener('securitypolicyviolation', (e) => { violMarco.push({ d: (e as SecurityPolicyViolationEvent).effectiveDirective }); });
    await intento('marco Worker propio fuera de las rutas', () => {
      const tt = (w as unknown as { trustedTypes: { createPolicy(n: string, o: { createScriptURL(s: string): string }): { createScriptURL(s: string): unknown } } }).trustedTypes;
      const pol = tt.createPolicy('default', { createScriptURL: (u: string) => u });
      const x = new (w['Worker'] as new (u: unknown) => Worker)(pol.createScriptURL(`${location.origin}/cdn-cgi/cs01-w.js`));
      return evento(x);
    }, violMarco);
    await esperar(500);
    return salida;
  }, s);
}

/** Lo esperado de cada intento del documento: resultado y directiva violada (null: no es la CSP la que lo frena). */
const ESPERADO_DOCUMENTO: Esperado = {
  fetch: { res: 'rechazo TypeError guardia', directiva: null },
  'fetch POST al propio origen': { res: 'rechazo TypeError guardia', directiva: null },
  'fetch con query al propio origen': { res: 'rechazo TypeError guardia', directiva: null },
  'fetch propio fuera de las rutas': { res: 'rechazo TypeError guardia', directiva: null },
  'fetch propio permitido': { res: 'respuesta 200', directiva: null },
  XMLHttpRequest: { res: GUARDIA, directiva: null },
  WebSocket: { res: GUARDIA, directiva: null },
  WebSocketStream: { res: GUARDIA, directiva: null },
  WebTransport: { res: GUARDIA, directiva: null },
  EventSource: { res: GUARDIA, directiva: null },
  sendBeacon: { res: GUARDIA, directiva: null },
  fetchLater: { res: /^(lanza SiglowError ERROR_INTERNO|no existe)$/, directiva: null },
  'navigator.share': { res: /^(lanza SiglowError ERROR_INTERNO|no existe)$/, directiva: null },
  'document.open': { res: GUARDIA, directiva: null },
  'voz antes de la guardia': { res: 'object function', directiva: null },
  voz: { res: 'undefined undefined undefined undefined', directiva: null },
  'voz hablar': { res: 'lanza TypeError', directiva: null },
  iframe: { res: GUARDIA, directiva: null },
  'iframe por createElementNS': { res: GUARDIA, directiva: null },
  frame: { res: GUARDIA, directiva: null },
  object: { res: GUARDIA, directiva: null },
  embed: { res: GUARDIA, directiva: null },
  'elemento personalizado que extiende iframe': { res: GUARDIA, directiva: null },
  'realm de un iframe ya creado': { res: 'null null', directiva: null },
  'publicidad antes de la guardia': { res: 'function function function', directiva: null },
  publicidad: { res: 'undefined undefined undefined', directiva: null },
  'nativo fetch': { res: 'rechazo TypeError red', directiva: 'connect-src' },
  'nativo XMLHttpRequest': { res: 'error', directiva: 'connect-src' },
  'nativo WebSocket': { res: 'error', directiva: 'connect-src' },
  'nativo WebSocket al propio origen': { res: 'error', directiva: 'connect-src' },
  'nativo EventSource': { res: 'error', directiva: 'connect-src' },
  'nativo sendBeacon': { res: /true|false/, directiva: 'connect-src' },
  imagen: { res: 'error', directiva: 'img-src' },
  prefetch: { res: /error|sin evento/, directiva: 'default-src' },
  import: { res: 'rechazo', directiva: 'script-src-elem' },
  'import propio fuera de las rutas': { res: 'rechazo', directiva: 'script-src-elem' },
  // Lo frena la política «default» de public/tt-policy.js: lanza antes de que la CSP llegue a evaluar (sin violación).
  Worker: { res: 'lanza TypeError', directiva: null },
  innerHTML: { res: 'lanza TypeError', directiva: 'require-trusted-types-for' },
  formulario: { res: 'enviado', directiva: 'form-action' },
  'marco Worker propio fuera de las rutas': { res: 'error', directiva: 'worker-src' },
};

// Intentos desde un worker (10.5.4). Corre dentro del worker; `s` es el señuelo y `propio` el host de la app.
const intentosEnWorker = async ({ s, propio }: { s: string; propio: string }): Promise<Intento[]> => {
  const esperar = (ms: number): Promise<void> => new Promise((ok) => { setTimeout(ok, ms); });
  const viol: string[] = [];
  self.addEventListener('securitypolicyviolation', (e) => { viol.push((e as SecurityPolicyViolationEvent).effectiveDirective); });
  const salida: Intento[] = [];
  const evento = (o: { onerror: unknown; onopen?: unknown; onload?: unknown }): Promise<string> => new Promise((ok) => {
    o.onerror = () => { ok('error'); };
    if ('onopen' in o) o.onopen = () => { ok('abierto'); };
    if ('onload' in o) o.onload = () => { ok('carga'); };
    setTimeout(() => { ok('sin evento'); }, 3000);
  });
  const intento = async (nombre: string, fn: () => Promise<string> | string): Promise<void> => {
    const n0 = viol.length;
    let res: string;
    try { res = await fn(); } catch (e) { res = `lanza ${(e as Error).name}${(e as { code?: string }).code ? ` ${(e as { code: string }).code}` : ''}`; }
    await esperar(250);
    salida.push({ nombre, res, directivas: [...new Set(viol.slice(n0))].sort() });
  };
  const pedir = (u: string, o?: RequestInit): Promise<string> =>
    fetch(u, o).then((r) => `respuesta ${r.status}`, (e: Error) => `rechazo ${e.name} ${e.message === 'URL_NO_PERMITIDA' ? 'guardia' : 'red'}`);
  const g = self as unknown as Record<string, unknown>;
  await intento('fetch', () => pedir(`${s}/cs02-fetch?d=x`));
  await intento('fetch propio permitido', () => pedir(self.location.pathname));
  await intento('fetch POST al propio origen', () => pedir('/assets/cs02-post', { method: 'POST', body: 'x' }));
  await intento('fetch con query al propio origen', () => pedir('/assets/cs02-query?d=x'));
  await intento('fetch fijo', () => {
    try { g['fetch'] = () => undefined; } catch { /* modo estricto: la propiedad es de solo lectura */ }
    return Object.getOwnPropertyDescriptor(self, 'fetch')?.configurable === false ? 'fijo' : 'reescribible';
  });
  await intento('XMLHttpRequest', () => { const x = new XMLHttpRequest(); const r = evento(x); x.open('GET', `${s}/cs02-xhr`); x.send(); return r; });
  await intento('WebSocket', () => evento(new WebSocket(`ws://${new URL(s).host}/cs02-ws`)));
  await intento('WebSocket al propio origen', () => evento(new WebSocket(`ws://${propio}/cs02-ws-propio?d=x`)));
  await intento('EventSource', () => evento(new EventSource(`${s}/cs02-es`)));
  await intento('import', () => import(/* @vite-ignore */ `${s}/cs02-m.js`).then(() => 'carga', () => 'rechazo'));
  await esperar(500);
  return salida;
};

/** Worker propio: la guardia frena antes que la CSP (sin violación), salvo `import`, que no es de la guardia. */
const ESPERADO_WORKER_PROPIO: Esperado = {
  fetch: { res: 'rechazo TypeError guardia', directiva: null },
  'fetch propio permitido': { res: 'respuesta 200', directiva: null },
  'fetch POST al propio origen': { res: 'rechazo TypeError guardia', directiva: null },
  'fetch con query al propio origen': { res: 'rechazo TypeError guardia', directiva: null },
  'fetch fijo': { res: 'fijo', directiva: null },
  XMLHttpRequest: { res: GUARDIA, directiva: null },
  WebSocket: { res: GUARDIA, directiva: null },
  'WebSocket al propio origen': { res: GUARDIA, directiva: null },
  EventSource: { res: GUARDIA, directiva: null },
  import: { res: 'rechazo', directiva: 'script-src-elem' },
};
/** Worker sin guardia (pdf.js): la CSP del worker y, para el propio origen, el interruptor del SW (Response.error()). */
const ESPERADO_WORKER_SIN_GUARDIA: Esperado = {
  fetch: { res: 'rechazo TypeError red', directiva: 'connect-src' },
  'fetch propio permitido': { res: 'respuesta 200', directiva: null },
  'fetch POST al propio origen': { res: 'rechazo TypeError red', directiva: null },
  'fetch con query al propio origen': { res: 'rechazo TypeError red', directiva: null },
  'fetch fijo': { res: 'reescribible', directiva: null },
  XMLHttpRequest: { res: 'error', directiva: 'connect-src' },
  WebSocket: { res: 'error', directiva: 'connect-src' },
  'WebSocket al propio origen': { res: 'error', directiva: 'connect-src' },
  EventSource: { res: 'error', directiva: 'connect-src' },
  import: { res: 'rechazo', directiva: 'script-src-elem' },
};

function comprobarIntentos(intentos: Intento[], esperado: Esperado, donde = ''): void {
  expect(intentos.map((i) => i.nombre).sort(), donde).toEqual(Object.keys(esperado).sort());
  for (const i of intentos) {
    const e = esperado[i.nombre]!;
    if (typeof e.res === 'string') expect(i.res, `${donde} ${i.nombre}`).toBe(e.res);
    else expect(i.res, `${donde} ${i.nombre}`).toMatch(e.res);
    // ≥ 1 violación por intento que frena la CSP, de la directiva esperada (10.5.4, T-CS-01).
    if (e.directiva) expect(i.directivas, `${donde} ${i.nombre}`).toContain(e.directiva);
  }
}

test.describe('T-CS-01 a T-CS-05 la CSP, la guardia y el interruptor bloquean cada salida', () => {
  let app: Servidor;
  let senuelo: Senuelo;

  test.beforeEach(async () => {
    app = await levantar(DIST);
    senuelo = await levantarSenuelo();
  });

  test.afterEach(async () => {
    await app.parar();
    await senuelo.parar();
  });

  for (const sw of ['block', 'allow'] as const) {
    test(`T-CS-01 @cero-red intentos desde el documento (service worker ${sw === 'block' ? 'bloqueado: solo la CSP' : 'activo'}): 0 en el señuelo, la guardia primero y una violación por intento que frena la CSP`, async ({ browser }) => {
      const { ctx, page } = await abrir(browser, app.origen, sw);
      const intentos = await intentosDelDocumento(page, senuelo.origen);
      comprobarIntentos(intentos, ESPERADO_DOCUMENTO);
      // El formulario bloqueado no navegó: la página sigue en la app.
      expect(new URL(page.url()).origin).toBe(app.origen);
      expect(senuelo.conexiones).toEqual([]);
      expect(app.peticiones().filter((p) => p.u.includes('cs01'))).toEqual([]);
      await ctx.close();
    });
  }

  test('T-CS-02 @cero-red intentos desde los workers propios (detect, io, ner): la guardia los frena; desde uno sin guardia (pdf.js), la CSP del worker y el interruptor; 0 en el señuelo', async ({ browser }) => {
    const { ctx, page } = await abrir(browser, app.origen, 'allow');
    const datos = { s: senuelo.origen, propio: new URL(app.origen).host };
    for (const ruta of workersPropios()) {
      const w = await arrancarWorker(page, ruta);
      comprobarIntentos(await w.evaluate(intentosEnWorker, datos), ESPERADO_WORKER_PROPIO, ruta);
    }
    const pdf = rutaDe(/^\/assets\/pdf\.worker-[\w-]+\.js$/);
    comprobarIntentos(await (await arrancarWorker(page, pdf)).evaluate(intentosEnWorker, datos), ESPERADO_WORKER_SIN_GUARDIA, pdf);
    expect(senuelo.conexiones).toEqual([]);
    expect(app.peticiones().filter((p) => p.u.includes('cs02'))).toEqual([]);
    await ctx.close();
  });

  test('T-CS-03 @cero-red interruptor del SW: 0 de /fuga en el registro de la app; sin CSP, 0 en el señuelo salvo el WebSocket, que el SW no intercepta', async ({ browser }) => {
    // Con CSP: el interruptor responde Response.error() a lo que la CSP deja pasar (el propio origen). Con el fetch original
    // (por debajo de la guardia, que ya lo rechazaría: T-CS-01), para probar el interruptor solo.
    const conCsp = await abrir(browser, app.origen, 'allow');
    const corte = app.peticiones().length;
    expect(await conCsp.page.evaluate(async () => {
      const f = (globalThis as unknown as { __nativo: Nativo }).__nativo.fetch;
      return {
        query: await f('/fuga?d=x').then(() => 'respuesta', () => 'error'),
        post: await f('/fuga', { method: 'POST', body: 'x' }).then(() => 'respuesta', () => 'error'),
        noListada: await f('/ruta-no-listada').then(() => 'respuesta', () => 'error'),
      };
    })).toEqual({ query: 'error', post: 'error', noListada: 'error' });
    expect(app.peticiones().slice(corte).filter((p) => !(p.m === 'GET' && p.u === '/sw.js'))).toEqual([]);
    await conCsp.ctx.close();
    // Sin CSP (--sin-csp): el interruptor sigue frenando fetch, imagen y beacon a otro origen; el WebSocket original (sin
    // guardia) llega al señuelo, y por eso la CSP es obligatoria (10.5.4).
    const sinCsp = await abrir(browser, app.origen, 'allow', { bypassCSP: true });
    const r = await sinCsp.page.evaluate(async (s) => {
      const N = (globalThis as unknown as { __nativo: Nativo }).__nativo;
      const imagen = await new Promise<string>((ok) => { const i = new Image(); i.onerror = () => { ok('error'); }; i.onload = () => { ok('carga'); }; i.src = `${s}/cs03-p.png`; });
      const f = await N.fetch(`${s}/cs03-fetch?d=x`, { mode: 'no-cors' }).then(() => 'respuesta', () => 'error');
      let beacon: string;
      try { beacon = String((navigator as unknown as Record<string, (u: string) => boolean>)['sendBeacon']!(`${s}/cs03-beacon`)); } catch (e) { beacon = `lanza ${(e as Error).name}`; }
      const ws = await new Promise<string>((ok) => { const x = new N.WebSocket(`ws://${new URL(s).host}/cs03-ws`); x.onerror = () => { ok('error'); }; x.onopen = () => { ok('abierto'); }; setTimeout(() => { ok('sin evento'); }, 3000); });
      return { imagen, fetch: f, beacon, ws };
    }, senuelo.origen);
    expect(r).toEqual({ imagen: 'error', fetch: 'error', beacon: 'lanza SiglowError', ws: 'error' });
    await expect.poll(() => senuelo.conexiones).toEqual(['GET /cs03-ws HTTP/1.1']);
    await sinCsp.ctx.close();
  });

  test('T-CS-04 @cero-red WebRTC neutralizado al arrancar en la página y en los workers propios: 0 paquetes UDP al STUN falso, también por el camino del iframe about:blank (M-4), la transformación XSLT (B-25), createDocument y la ventana Picture-in-Picture', async ({ browser }) => {
    const stun: Socket = createSocket('udp4');
    const paquetes: number[] = [];
    stun.on('message', (m) => { paquetes.push(m.length); });
    await new Promise<void>((ok) => { stun.bind(0, '127.0.0.1', () => { ok(); }); });
    const p3 = stun.address().port;
    try {
      const { ctx, page } = await abrir(browser, app.origen, 'allow');
      const r = await page.evaluate(async (p3) => {
        const g = globalThis as unknown as Record<string, unknown>;
        const tipos = ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel'].map((n) => typeof g[n]);
        let crear: string;
        try { new (g['RTCPeerConnection'] as typeof RTCPeerConnection)({ iceServers: [{ urls: `stun:127.0.0.1:${p3}` }] }); crear = 'creado'; } catch (e) { crear = `lanza ${(e as Error).name}`; }
        // No se puede volver a poner: la propiedad quedó fija.
        try { g['RTCPeerConnection'] = function x() { return undefined; }; } catch { /* modo estricto */ }
        await new Promise((ok) => { setTimeout(ok, 3000); });
        return { tipos, crear, sigue: typeof g['RTCPeerConnection'] };
      }, p3);
      expect(r).toEqual({ tipos: ['undefined', 'undefined', 'undefined'], crear: 'lanza TypeError', sigue: 'undefined' });
      // Caso iframe (10.5.4, SUPUESTO S-10.5; M-4): el camino directo de la prueba anterior (un iframe `about:blank` con
      // constructores propios) lo cierra la guardia: createElement lo rechaza, y un iframe que ya exista (aquí, creado con el
      // createElement original) no entrega su realm por contentWindow ni contentDocument.
      const marco = await page.evaluate(async (p3) => {
        const N = (globalThis as unknown as { __nativo: Nativo }).__nativo;
        const salida: string[] = [];
        try { document.createElement('iframe'); salida.push('creado'); } catch (e) { salida.push(`lanza ${(e as Error).name}`); }
        const f = N.createElement('iframe') as HTMLIFrameElement;
        document.body.append(f);
        const P = (f.contentWindow as unknown as Record<string, typeof RTCPeerConnection | undefined> | null)?.['RTCPeerConnection'];
        salida.push(P ? 'con constructor' : `${String(f.contentWindow)} ${String(f.contentDocument)}`);
        if (P) {
          const pc = new P({ iceServers: [{ urls: `stun:127.0.0.1:${p3}` }] });
          pc.createDataChannel('x');
          await pc.setLocalDescription(await pc.createOffer());
        }
        await new Promise((ok) => { setTimeout(ok, 3000); });
        return salida;
      }, p3);
      expect(marco).toEqual(['lanza SiglowError', 'null null']);
      // B-25 y PD-2-r2: caminos que dan un realm sin createElement (medidos en la revisión y en la sonda de PD-2-r2: 4 paquetes
      // STUN cada uno). La transformación XSLT de la revisión, un documento cuya raíz es un iframe y una ventana Picture-in-Picture
      // de documento. Con la guardia, XSLTProcessor y documentPictureInPicture están en undefined y createDocument rechaza el
      // iframe; si alguno diera un realm, su RTCPeerConnection dejaría paquetes en el STUN falso (la cuenta de abajo).
      const sinCreateElement = await page.evaluate(async (p3) => {
        const g = globalThis as unknown as Record<string, unknown>;
        const n0 = window.length;
        const webrtc = async (w: Window | null | undefined): Promise<string> => {
          const P = (w as unknown as Record<string, typeof RTCPeerConnection | undefined> | null | undefined)?.['RTCPeerConnection'];
          if (!P) return 'sin realm';
          const pc = new P({ iceServers: [{ urls: `stun:127.0.0.1:${p3}` }] });
          pc.createDataChannel('x');
          await pc.setLocalDescription(await pc.createOffer());
          await new Promise((ok) => { setTimeout(ok, 3000); });
          pc.close();
          return 'realm con WebRTC';
        };
        const nuevoMarco = (): Promise<string> => webrtc(window.length > n0 ? window[window.length - 1] : null);
        const intento = async (fn: () => unknown, despues: () => Promise<string> = nuevoMarco): Promise<string> => {
          try { await fn(); } catch (e) { return `lanza ${(e as Error).name}${(e as { code?: string }).code ? ` ${(e as { code: string }).code}` : ''}`; }
          return despues();
        };
        // Solo lee el descriptor: escribir la propiedad aquí taparía la API que los intentos de abajo deben encontrar si la
        // guardia faltara (lo vio la mutación sin XSLTProcessor). Que no se pueda reescribir lo prueba tests/unit/guard.test.ts.
        const fijo = (n: string): string => {
          const d = Object.getOwnPropertyDescriptor(window, n);
          return `${typeof g[n]} ${d?.configurable === false && d.writable === false ? 'fijo' : 'libre'}`;
        };
        // La hoja de la revisión: <xsl:element name="iframe"> en el espacio de nombres XHTML, armada con elementos XSL.
        const XSL = 'http://www.w3.org/1999/XSL/Transform';
        const transformar = (X: unknown): void => {
          const hoja = document.implementation.createDocument(XSL, 'xsl:stylesheet', null);
          hoja.documentElement!.setAttribute('version', '1.0');
          const plantilla = hoja.createElementNS(XSL, 'xsl:template');
          plantilla.setAttribute('match', '/');
          const el = hoja.createElementNS(XSL, 'xsl:element');
          el.setAttribute('name', 'iframe');
          el.setAttribute('namespace', 'http://www.w3.org/1999/xhtml');
          plantilla.append(el);
          hoja.documentElement!.append(plantilla);
          const p = new (X as new () => XSLTProcessor)();
          p.importStylesheet(hoja);
          document.body.append(p.transformToFragment(document.implementation.createDocument(null, 'x', null), document));
        };
        return {
          xslt: fijo('XSLTProcessor'),
          transformacion: await intento(() => { transformar(g['XSLTProcessor']); }),
          createDocument: await intento(() => { document.body.append(document.implementation.createDocument('http://www.w3.org/1999/xhtml', 'iframe', null).documentElement!); }),
          pip: fijo('documentPictureInPicture'),
          marcos: window.length - n0,
        };
      }, p3);
      expect(sinCreateElement).toEqual({ xslt: 'undefined fijo', transformacion: 'lanza TypeError', createDocument: GUARDIA, pip: 'undefined fijo', marcos: 0 });
      // La ventana Picture-in-Picture pide un gesto del usuario: un clic real sobre la página.
      const pip = async (nativo: boolean): Promise<string> => {
        await page.evaluate(({ p3, nativo }) => {
          const g = globalThis as unknown as Record<string, unknown> & { __pip?: string; __realms: { pip: unknown } };
          g.__pip = 'sin clic';
          addEventListener('click', () => {
            void (async () => {
              try {
                const d = (nativo ? g.__realms.pip : g['documentPictureInPicture']) as { requestWindow(o: object): Promise<Window> };
                const w = await d.requestWindow({ width: 100, height: 100 });
                const P = (w as unknown as Record<string, unknown>)['RTCPeerConnection'];
                // Control (la API original): solo se mira el constructor, sin crear la conexión.
                if (nativo) { g.__pip = `ventana: RTCPeerConnection ${typeof P}`; w.close(); return; }
                const pc = new (P as typeof RTCPeerConnection)({ iceServers: [{ urls: `stun:127.0.0.1:${p3}` }] });
                pc.createDataChannel('x');
                await pc.setLocalDescription(await pc.createOffer());
                g.__pip = 'ventana con WebRTC';
              } catch (e) { g.__pip = `lanza ${(e as Error).name}`; }
            })();
          }, { once: true });
        }, { p3, nativo });
        await page.mouse.click(1, 1);
        await expect.poll(() => page.evaluate(() => (globalThis as unknown as { __pip: string }).__pip)).not.toBe('sin clic');
        return page.evaluate(() => (globalThis as unknown as { __pip: string }).__pip);
      };
      expect(await pip(false)).toBe('lanza TypeError');
      // Workers propios: los tres constructores (y la voz) en undefined y fijos.
      for (const ruta of workersPropios()) {
        const w = await arrancarWorker(page, ruta);
        expect(await w.evaluate(() => {
          const g = self as unknown as Record<string, unknown>;
          return ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'speechSynthesis', 'SpeechSynthesisUtterance'].map((n) => {
            try { g[n] = class {}; } catch { /* modo estricto */ }
            const d = Object.getOwnPropertyDescriptor(self, n);
            return `${typeof g[n]} ${d?.configurable === false && d.writable === false ? 'fijo' : 'libre'}`;
          });
        }), ruta).toEqual(Array<string>(5).fill('undefined fijo'));
      }
      expect(paquetes).toEqual([]);
      // Controles (B-25, PD-2-r2): con las API originales, guardadas antes de la guardia, los tres caminos sí dan un realm con
      // WebRTC en este navegador; así los casos de arriba prueban algo. Solo se mira el constructor, sin crear la conexión.
      const controles = await page.evaluate(() => {
        const R = (globalThis as unknown as { __realms: { XSLTProcessor: unknown; createDocument: DOMImplementation['createDocument'] } }).__realms;
        const conWebrtc = (): string => {
          const w = window[window.length - 1] as unknown as Record<string, unknown> | undefined;
          return `realm: RTCPeerConnection ${typeof w?.['RTCPeerConnection']}`;
        };
        const XSL = 'http://www.w3.org/1999/XSL/Transform';
        const hoja = document.implementation.createDocument(XSL, 'xsl:stylesheet', null);
        hoja.documentElement!.setAttribute('version', '1.0');
        const plantilla = hoja.createElementNS(XSL, 'xsl:template');
        plantilla.setAttribute('match', '/');
        const el = hoja.createElementNS(XSL, 'xsl:element');
        el.setAttribute('name', 'iframe');
        el.setAttribute('namespace', 'http://www.w3.org/1999/xhtml');
        plantilla.append(el);
        hoja.documentElement!.append(plantilla);
        const p = new (R.XSLTProcessor as new () => XSLTProcessor)();
        p.importStylesheet(hoja);
        document.body.append(p.transformToFragment(document.implementation.createDocument(null, 'x', null), document));
        const xslt = conWebrtc();
        document.body.append(R.createDocument.call(document.implementation, 'http://www.w3.org/1999/xhtml', 'iframe', null).documentElement!);
        return { xslt, createDocument: conWebrtc() };
      });
      expect(controles).toEqual({ xslt: 'realm: RTCPeerConnection function', createDocument: 'realm: RTCPeerConnection function' });
      expect(await pip(true)).toBe('ventana: RTCPeerConnection function');
      // Riesgo residual (5.2.1, V-02; S-10.5): el realm de un iframe que ya existe sigue alcanzable por `window[i]`, que no se
      // puede envolver. Se mide y se anota; no bloquea (código inyectado que ya consiguió un iframe).
      const residual = await page.evaluate(async (p3) => {
        const w = (window as unknown as Record<number, Record<string, typeof RTCPeerConnection | undefined> | undefined>)[window.length - 1];
        const P = w?.['RTCPeerConnection'];
        if (!P) return 'sin constructor';
        const pc = new P({ iceServers: [{ urls: `stun:127.0.0.1:${p3}` }] });
        pc.createDataChannel('x');
        await pc.setLocalDescription(await pc.createOffer());
        await new Promise((ok) => { setTimeout(ok, 3000); });
        pc.close();
        return 'creado';
      }, p3);
      test.info().annotations.push({ type: 'riesgo residual (S-10.5, M-4)', description: `window[i] de un iframe ya creado: ${residual}; ${paquetes.length} paquetes UDP al STUN falso` });
      await ctx.close();
    } finally {
      stun.close();
    }
  });

  test('T-CS-05 @cero-red límites documentados: window.open, document.open y el iframe los frena la guardia; el window.open original y location sí llegan al señuelo (la CSP no rige la navegación)', async ({ browser }) => {
    const { ctx, page } = await abrir(browser, app.origen, 'allow');
    expect(await page.evaluate((s) => {
      const salida: string[] = [];
      const prueba = (fn: () => unknown): void => {
        try { fn(); salida.push('abierta'); } catch (e) { salida.push(`lanza ${(e as Error).name} ${(e as { code?: string }).code ?? ''}`.trim()); }
      };
      prueba(() => (globalThis as unknown as Record<string, (u: string) => unknown>)['open']!(`${s}/cs05-open`));
      prueba(() => document.open(`${s}/cs05-document-open`, '_blank', ''));
      // El realm sin guardia que usaba la versión anterior de esta prueba ya no se obtiene (M-4).
      prueba(() => document.createElement('iframe'));
      return salida;
    }, senuelo.origen)).toEqual([GUARDIA, GUARDIA, GUARDIA]);
    // El límite de 5.4: con el window.open original (guardado antes de la guardia: código que la esquiva), la navegación sale.
    const [emergente] = await Promise.all([
      ctx.waitForEvent('page'),
      page.evaluate((s) => { (globalThis as unknown as { __nativo: Nativo }).__nativo.open(`${s}/cs05-open-nativo`); }, senuelo.origen),
    ]);
    await expect.poll(() => senuelo.conexiones.some((c) => c.startsWith('GET /cs05-open-nativo'))).toBe(true);
    await emergente.close();
    // location: la navegación de nivel superior llega al señuelo.
    await page.evaluate((s) => { (globalThis as unknown as { location: { href: string } }).location.href = `${s}/cs05-location?d=x`; }, senuelo.origen).catch(() => undefined);
    await expect.poll(() => senuelo.conexiones.some((c) => c.startsWith('GET /cs05-location?d=x'))).toBe(true);
    expect(senuelo.conexiones.filter((c) => /^GET \/cs05-(?:open|document-open) /.test(c))).toEqual([]);
    // El build no usa ninguno de los dos (T-CD-01, check-dist: reglas `window.open`, `document.open` y `location=`).
    await ctx.close();
  });
});

test.describe('T-CS-06 y T-CS-07 Trusted Types y CSP de respaldo', () => {
  let app: Servidor;

  test.beforeEach(async () => {
    app = await levantar(DIST);
  });

  test.afterEach(async () => {
    await app.parar();
  });

  test('T-CS-06 @cero-red Trusted Types: innerHTML con cadena, un Worker de otro origen o blob: y otra política lanzan; el Worker propio, el de ORT, el SW y WebAssembly funcionan', async ({ browser }) => {
    const { ctx, page } = await abrir(browser, app.origen, 'allow');
    const detect = rutaDe(/^\/assets\/detect\.worker-[\w-]+\.js$/);
    const r = await page.evaluate(async ({ detect }) => {
      const lanza = (fn: () => unknown): string => { try { fn(); return 'no lanza'; } catch (e) { return `lanza ${(e as Error).name}`; } };
      const vive = (w: Worker): Promise<string> => new Promise((ok) => {
        w.onerror = () => { ok('error'); };
        setTimeout(() => { ok('vive'); w.terminate(); }, 1500);
      });
      const blob = URL.createObjectURL(new Blob(['1'], { type: 'text/javascript' }));
      const salida = {
        innerHTML: lanza(() => { (document.createElement('div') as unknown as { innerHTML: string }).innerHTML = '<b>x</b>'; }),
        workerOtroOrigen: lanza(() => new Worker('http://ejemplo.test/w.js')),
        workerBlob: lanza(() => new Worker(blob)),
        otraPolitica: lanza(() => (globalThis as unknown as { trustedTypes: { createPolicy(n: string, o: object): unknown } }).trustedTypes.createPolicy('otra', {})),
        workerPropio: await vive(new Worker(detect, { type: 'module' })),
        workerOrt: await vive(new Worker('/ort/ort-wasm-simd-threaded.mjs', { type: 'module', name: 'em-pthread' })),
        sw: (await navigator.serviceWorker.getRegistration())?.active?.state ?? null,
        // Con el fetch de la guardia: /ort/ es una de sus rutas.
        wasm: await WebAssembly.compile(await (await fetch('/ort/ort-wasm-simd-threaded.wasm')).arrayBuffer()).then(() => 'compila', (e: Error) => `falla ${e.name}`),
      };
      URL.revokeObjectURL(blob);
      return salida;
    }, { detect });
    expect(r).toEqual({
      innerHTML: 'lanza TypeError', workerOtroOrigen: 'lanza TypeError', workerBlob: 'lanza TypeError', otraPolitica: 'lanza TypeError',
      workerPropio: 'vive', workerOrt: 'vive', sw: 'activated', wasm: 'compila',
    });
    // eval y new Function: sin 'unsafe-eval'. Playwright evalúa por CDP con `allowUnsafeEvalBlockedByCSP: true`, que se
    // saltaría la CSP; aquí se evalúa por CDP con esa opción en false, como lo haría un script de la página.
    const cdp = await ctx.newCDPSession(page);
    for (const expresion of ['(0, eval)("1")', 'new Function("return 1")()', 'setTimeout("1")']) {
      const res = (await cdp.send('Runtime.evaluate', { expression: expresion, allowUnsafeEvalBlockedByCSP: false })) as { exceptionDetails?: { exception?: { className?: string } } };
      expect(res.exceptionDetails?.exception?.className, expresion).toMatch(/^(EvalError|TypeError)$/);
    }
    const violaciones = await page.evaluate(() => (globalThis as unknown as { __violaciones: { d: string; u: string }[] }).__violaciones);
    // Ninguna violación del Worker propio, del de ORT ni del .wasm.
    expect(violaciones.filter((v) => /detect\.worker|\/ort\//.test(v.u))).toEqual([]);
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
    await ctx.close();
  });

  test('T-CS-07 @cero-red CSP de respaldo: el <meta> es la cabecera menos frame-ancestors, sin report-uri ni report-to, y cabeceras de 3.6 en /, /sw.js, un worker y el .wasm; cada rasgo de la Permissions-Policy reconocido sin aviso', async ({ browser, request }) => {
    const detect = rutaDe(/^\/assets\/detect\.worker-[\w-]+\.js$/);
    const raiz = await request.get(`${app.origen}/`);
    const csp = raiz.headers()['content-security-policy'] ?? '';
    expect(csp).toBe(`${CSP_CANONICA}, ${CSP_RUTAS}`);
    const metas = [...(await raiz.text()).matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/g)].map((m) => m[1]);
    const politicas = csp.split(/\s*,\s*/);
    expect(metas).toEqual(politicas.map((p) => p.replace(/;\s*frame-ancestors 'none'/, '')));
    expect(politicas[0]).toContain("frame-ancestors 'none'");
    for (const p of [...politicas, ...metas]) expect(p).not.toMatch(/report-(uri|to)/);
    // Cabeceras de 3.6 (criterio de la fila PD-2 de 9.3; el equivalente local de `curl -sI`).
    const canonicas = {
      'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-resource-policy': 'same-origin',
      'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-dns-prefetch-control': 'off', 'x-frame-options': 'DENY',
      'permissions-policy': PERMISOS,
    };
    const casos: [string, string, string | undefined][] = [
      ['/', 'text/html; charset=utf-8', 'no-cache, no-transform'],
      ['/sw.js', 'text/javascript', 'no-cache, no-transform'],
      [detect, 'text/javascript', 'public, max-age=31536000, immutable'],
      ['/ort/ort-wasm-simd-threaded.wasm', 'application/wasm', undefined],
      ['/ort/ort-wasm-simd-threaded.mjs', 'text/javascript', undefined],
    ];
    for (const [ruta, tipo, cache] of casos) {
      const h = (await request.head(`${app.origen}${ruta}`)).headers();
      expect({ ruta, csp: h['content-security-policy'], tipo: h['content-type'], cache: h['cache-control'], acao: h['access-control-allow-origin'] })
        .toEqual({ ruta, csp: `${CSP_CANONICA}, ${CSP_RUTAS}`, tipo, cache, acao: undefined });
      for (const [k, v] of Object.entries(canonicas)) expect(h[k], `${ruta}: ${k}`).toBe(v);
    }
    // Permissions-Policy (3.6 y PD-2-r2): el navegador reconoce cada rasgo de la cabecera, sin aviso en la consola («Unrecognized
    // feature»), y los que van con `()` quedan apagados en la página y en un iframe que la herede.
    const rasgos = PERMISOS.split(/\s*,\s*/).map((r) => /^([a-z-]+)=\((self)?\)$/.exec(r)).map((m) => ({ nombre: m![1]!, propio: m![2] === 'self' }));
    expect(rasgos.map((r) => r.nombre)).toEqual(expect.arrayContaining(['browsing-topics', 'private-state-token-issuance']));
    {
      const { ctx, page } = await abrir(browser, app.origen, 'block');
      const consola: string[] = [];
      page.on('console', (m) => { consola.push(m.text()); });
      await page.reload();
      await expect(page.locator('[data-prueba="promesa"]')).toBeVisible();
      const vistos = await page.evaluate((nombres) => {
        type Fp = { features(): string[]; allowsFeature(f: string): boolean };
        const N = (globalThis as unknown as { __nativo: Nativo }).__nativo;
        const f = N.createElement('iframe') as HTMLIFrameElement;
        document.body.append(f);
        const fp = (document as unknown as { featurePolicy: Fp }).featurePolicy;
        const fpMarco = (N.contentWindow(f)!.document as unknown as { featurePolicy: Fp }).featurePolicy;
        return nombres.map((n) => `${n}: ${fp.features().includes(n) ? 'reconocido' : 'NO reconocido'} ${fp.allowsFeature(n) ? 'permitido' : 'apagado'} ${fpMarco.allowsFeature(n) ? 'permitido' : 'apagado'}`);
      }, rasgos.map((r) => r.nombre));
      expect(vistos).toEqual(rasgos.map((r) => `${r.nombre}: reconocido ${r.propio ? 'permitido permitido' : 'apagado apagado'}`));
      expect(consola.filter((t) => /Permissions-Policy|Unrecognized feature/i.test(t))).toEqual([]);
      await ctx.close();
    }
    // El <meta> solo también protege el documento: sin la CSP de la cabecera, las dos políticas del <meta> siguen frenando.
    const copia = join(tmp, `sin-cabecera-${Date.now()}`);
    cpSync(DIST, copia, { recursive: true });
    writeFileSync(join(copia, '_headers'), readFileSync(join(copia, '_headers'), 'utf8').replace(/^\s*Content-Security-Policy:.*\r?\n/m, ''));
    const sinCabecera = await levantar(copia);
    try {
      const { ctx, page } = await abrir(browser, sinCabecera.origen, 'block');
      expect((await page.request.get('/')).headers()['content-security-policy']).toBeUndefined();
      const r = await page.evaluate(async () => ({
        importCdn: await import(/* @vite-ignore */ `${location.origin}/cdn-cgi/x.js`).then(() => 'carga', () => 'rechazo'),
        // Con el fetch original: el de la guardia lo rechazaría antes de la CSP, sin violación.
        fetchOtro: await (globalThis as unknown as { __nativo: Nativo }).__nativo.fetch('http://ejemplo.test/x').then(() => 'respuesta', () => 'error'),
        innerHTML: (() => { try { (document.createElement('div') as unknown as { innerHTML: string }).innerHTML = '<b>x</b>'; return 'asignado'; } catch (e) { return `lanza ${(e as Error).name}`; } })(),
      }));
      expect(r).toEqual({ importCdn: 'rechazo', fetchOtro: 'error', innerHTML: 'lanza TypeError' });
      const directivas = await page.evaluate(() => (globalThis as unknown as { __violaciones: { d: string }[] }).__violaciones.map((v) => v.d));
      expect(directivas).toEqual(expect.arrayContaining(['script-src-elem', 'connect-src', 'require-trusted-types-for']));
      await ctx.close();
    } finally {
      await sinCabecera.parar();
    }
  });
});
