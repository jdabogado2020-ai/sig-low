import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createSocket, type Socket } from 'node:dgram';
import { createServer, type Server as ServidorTcp } from 'node:net';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Prueba de CSP (10.5.4; PD-2): T-CS-01 a T-CS-07. La app se sirve con tests/e2e/server.mjs (aplica dist/_headers) y su
// registro de peticiones; el señuelo es un servidor TCP crudo en otro puerto (otro origen) que anota TODA conexión (HTTP,
// subida a WebSocket, formulario…), y el STUN falso es un socket UDP. Criterio general: 0 conexiones en el señuelo; el
// valor de retorno de sendBeacon no prueba nada (10.5.4). Cada intento corre solo y se le asignan sus violaciones.
// La guardia de arranque (src/arranque.ts) neutraliza en la ventana XMLHttpRequest, WebSocket, EventSource, sendBeacon,
// window.open y WebRTC: para probar la CSP sin ella, esos intentos se repiten desde un iframe `about:blank`, que hereda
// la CSP del documento y trae constructores propios. Solo datos ficticios: los cuerpos son «x».

const DIST = resolve('dist');
const CSP_CANONICA = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; font-src 'self'; manifest-src 'self'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types default";
const CSP_RUTAS = "script-src 'wasm-unsafe-eval' *:*/assets/ *:*/ort/ *:*/tt-policy.js; worker-src *:*/assets/ *:*/ort/ *:*/sw.js; connect-src https: http:";

interface Peticion { t: number; m: string; u: string }
interface Servidor { origen: string; peticiones: () => Peticion[]; parar: () => Promise<void> }
interface Senuelo { origen: string; puerto: number; conexiones: string[]; parar: () => Promise<void> }
interface Intento { nombre: string; res: string; directivas: string[] }

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

/** Escucha de violaciones en la ventana, antes de cualquier script de la página. */
async function abrir(browser: Browser, origen: string, sw: 'allow' | 'block', extra: { bypassCSP?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: origen, serviceWorkers: sw, ...extra });
  await ctx.addInitScript(() => {
    const v: { d: string; u: string }[] = [];
    (globalThis as unknown as { __violaciones: typeof v }).__violaciones = v;
    addEventListener('securitypolicyviolation', (e) => { v.push({ d: e.effectiveDirective, u: e.blockedURI }); });
  });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.locator('[data-prueba="promesa"]')).toBeVisible();
  if (sw === 'allow') await esperarControl(page);
  return { ctx, page };
}

const rutaDe = (patron: RegExp): string => {
  const lista = JSON.parse(readFileSync(join(DIST, 'precache.json'), 'utf8')) as { archivos: { ruta: string }[] };
  const r = lista.archivos.map((a) => a.ruta).find((x) => patron.test(x));
  if (!r) throw new Error(`sin ${String(patron)} en precache.json`);
  return r;
};

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
    // Ventana: la CSP (y la guardia, donde existe).
    await intento('fetch', () => fetch(`${s}/cs01-fetch?d=x`).then(() => 'respuesta', () => 'error'));
    await intento('XMLHttpRequest', () => { const x = new (g['XMLHttpRequest'] as typeof XMLHttpRequest)(); x.open('GET', `${s}/cs01-xhr`); x.send(); return 'enviado'; });
    await intento('WebSocket', () => { new (g['WebSocket'] as typeof WebSocket)(`ws://${new URL(s).host}/cs01-ws`); return 'creado'; });
    await intento('EventSource', () => { new (g['EventSource'] as typeof EventSource)(`${s}/cs01-es`); return 'creado'; });
    await intento('sendBeacon', () => String((navigator as unknown as Record<string, (u: string, d: string) => boolean>)['sendBeacon']!(`${s}/cs01-beacon`, 'x')));
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
    // iframe `about:blank`: hereda la CSP, no la guardia. Así se prueba la CSP para lo que la guardia neutraliza.
    const marco = document.createElement('iframe');
    document.body.append(marco);
    const w = marco.contentWindow as unknown as Record<string, unknown> & Window;
    const violMarco: { d: string }[] = [];
    w.addEventListener('securitypolicyviolation', (e) => { violMarco.push({ d: (e as SecurityPolicyViolationEvent).effectiveDirective }); });
    await intento('marco XMLHttpRequest', () => { const x = new (w['XMLHttpRequest'] as typeof XMLHttpRequest)(); const r = evento(x); x.open('GET', `${s}/cs01-m-xhr`); x.send(); return r; }, violMarco);
    await intento('marco WebSocket', () => evento(new (w['WebSocket'] as typeof WebSocket)(`ws://${new URL(s).host}/cs01-m-ws`)), violMarco);
    await intento('marco EventSource', () => evento(new (w['EventSource'] as typeof EventSource)(`${s}/cs01-m-es`)), violMarco);
    await intento('marco sendBeacon', () => String((w['navigator'] as Navigator).sendBeacon(`${s}/cs01-m-beacon`, 'x')), violMarco);
    await intento('marco WebSocket al propio origen', () => evento(new (w['WebSocket'] as typeof WebSocket)(`ws://${location.host}/cs01-m-ws-propio?d=x`)), violMarco);
    // worker-src por rutas: el iframe crea su propia política «default» permisiva (la CSP la admite una vez por realm), así
    // Trusted Types deja pasar la URL y la que decide es la segunda política (`worker-src` solo /assets/, /ort/ y /sw.js).
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
const ESPERADO_DOCUMENTO: Record<string, { res: string | RegExp; directiva: string | null }> = {
  fetch: { res: 'error', directiva: 'connect-src' },
  XMLHttpRequest: { res: 'lanza SiglowError ERROR_INTERNO', directiva: null },
  WebSocket: { res: 'lanza SiglowError ERROR_INTERNO', directiva: null },
  EventSource: { res: 'lanza SiglowError ERROR_INTERNO', directiva: null },
  sendBeacon: { res: 'lanza SiglowError ERROR_INTERNO', directiva: null },
  imagen: { res: 'error', directiva: 'img-src' },
  prefetch: { res: /error|sin evento/, directiva: 'default-src' },
  import: { res: 'rechazo', directiva: 'script-src-elem' },
  'import propio fuera de las rutas': { res: 'rechazo', directiva: 'script-src-elem' },
  // Lo frena la política «default» de public/tt-policy.js: lanza antes de que la CSP llegue a evaluar (sin violación).
  Worker: { res: 'lanza TypeError', directiva: null },
  innerHTML: { res: 'lanza TypeError', directiva: 'require-trusted-types-for' },
  formulario: { res: 'enviado', directiva: 'form-action' },
  'marco XMLHttpRequest': { res: 'error', directiva: 'connect-src' },
  'marco WebSocket': { res: 'error', directiva: 'connect-src' },
  'marco EventSource': { res: 'error', directiva: 'connect-src' },
  'marco sendBeacon': { res: /true|false/, directiva: 'connect-src' },
  'marco WebSocket al propio origen': { res: 'error', directiva: 'connect-src' },
  'marco Worker propio fuera de las rutas': { res: 'error', directiva: 'worker-src' },
};

function comprobarIntentos(intentos: Intento[], esperado: Record<string, { res: string | RegExp; directiva: string | null }>): void {
  expect(intentos.map((i) => i.nombre).sort()).toEqual(Object.keys(esperado).sort());
  for (const i of intentos) {
    const e = esperado[i.nombre]!;
    if (typeof e.res === 'string') expect(i.res, i.nombre).toBe(e.res);
    else expect(i.res, i.nombre).toMatch(e.res);
    // ≥ 1 violación por intento que frena la CSP, de la directiva esperada (10.5.4, T-CS-01).
    if (e.directiva) expect(i.directivas, i.nombre).toContain(e.directiva);
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
    test(`T-CS-01 @cero-red intentos desde el documento (service worker ${sw === 'block' ? 'bloqueado: solo la CSP' : 'activo'}): 0 en el señuelo y una violación por intento`, async ({ browser }) => {
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

  test('T-CS-02 @cero-red intentos desde un worker del mismo origen: la CSP del worker los frena y 0 en el señuelo', async ({ browser }) => {
    const { ctx, page } = await abrir(browser, app.origen, 'allow');
    const ruta = rutaDe(/^\/assets\/detect\.worker-[\w-]+\.js$/);
    const [worker] = await Promise.all([
      page.waitForEvent('worker'),
      page.evaluate((r) => { (globalThis as unknown as { w: Worker }).w = new Worker(r, { type: 'module' }); }, ruta),
    ]);
    const intentos = await worker.evaluate(async ({ s, propio }) => {
      const esperar = (ms: number): Promise<void> => new Promise((ok) => { setTimeout(ok, ms); });
      const viol: string[] = [];
      self.addEventListener('securitypolicyviolation', (e) => { viol.push((e as SecurityPolicyViolationEvent).effectiveDirective); });
      const salida: { nombre: string; res: string; directivas: string[] }[] = [];
      const evento = (o: { onerror: unknown; onopen?: unknown; onload?: unknown }): Promise<string> => new Promise((ok) => {
        o.onerror = () => { ok('error'); };
        if ('onopen' in o) o.onopen = () => { ok('abierto'); };
        if ('onload' in o) o.onload = () => { ok('carga'); };
        setTimeout(() => { ok('sin evento'); }, 3000);
      });
      const intento = async (nombre: string, fn: () => Promise<string>): Promise<void> => {
        const n0 = viol.length;
        let res: string;
        try { res = await fn(); } catch (e) { res = `lanza ${(e as Error).name}`; }
        await esperar(250);
        salida.push({ nombre, res, directivas: [...new Set(viol.slice(n0))].sort() });
      };
      await intento('fetch', () => fetch(`${s}/cs02-fetch?d=x`).then(() => 'respuesta', () => 'error'));
      await intento('XMLHttpRequest', () => { const x = new XMLHttpRequest(); const r = evento(x); x.open('GET', `${s}/cs02-xhr`); x.send(); return r; });
      await intento('WebSocket', () => evento(new WebSocket(`ws://${new URL(s).host}/cs02-ws`)));
      await intento('WebSocket al propio origen', () => evento(new WebSocket(`ws://${propio}/cs02-ws-propio?d=x`)));
      await intento('EventSource', () => evento(new EventSource(`${s}/cs02-es`)));
      await intento('import', () => import(/* @vite-ignore */ `${s}/cs02-m.js`).then(() => 'carga', () => 'rechazo'));
      await esperar(500);
      return salida;
    }, { s: senuelo.origen, propio: new URL(app.origen).host });
    comprobarIntentos(intentos, {
      fetch: { res: 'error', directiva: 'connect-src' },
      XMLHttpRequest: { res: 'error', directiva: 'connect-src' },
      WebSocket: { res: 'error', directiva: 'connect-src' },
      'WebSocket al propio origen': { res: 'error', directiva: 'connect-src' },
      EventSource: { res: 'error', directiva: 'connect-src' },
      import: { res: 'rechazo', directiva: 'script-src-elem' },
    });
    expect(senuelo.conexiones).toEqual([]);
    expect(app.peticiones().filter((p) => p.u.includes('cs02'))).toEqual([]);
    await ctx.close();
  });

  test('T-CS-03 @cero-red interruptor del SW: 0 de /fuga en el registro de la app; sin CSP, 0 en el señuelo salvo el WebSocket, que el SW no intercepta', async ({ browser }) => {
    // Con CSP: el interruptor responde Response.error() a lo que la CSP deja pasar (el propio origen).
    const conCsp = await abrir(browser, app.origen, 'allow');
    const corte = app.peticiones().length;
    expect(await conCsp.page.evaluate(async () => ({
      query: await fetch('/fuga?d=x').then(() => 'respuesta', () => 'error'),
      post: await fetch('/fuga', { method: 'POST', body: 'x' }).then(() => 'respuesta', () => 'error'),
      noListada: await fetch('/ruta-no-listada').then(() => 'respuesta', () => 'error'),
    }))).toEqual({ query: 'error', post: 'error', noListada: 'error' });
    expect(app.peticiones().slice(corte).filter((p) => !(p.m === 'GET' && p.u === '/sw.js'))).toEqual([]);
    await conCsp.ctx.close();
    // Sin CSP (--sin-csp): el interruptor sigue frenando fetch, imagen y beacon a otro origen; el WebSocket llega al
    // señuelo (en un realm sin guardia), y por eso la CSP es obligatoria (10.5.4).
    const sinCsp = await abrir(browser, app.origen, 'allow', { bypassCSP: true });
    const r = await sinCsp.page.evaluate(async (s) => {
      const imagen = await new Promise<string>((ok) => { const i = new Image(); i.onerror = () => { ok('error'); }; i.onload = () => { ok('carga'); }; i.src = `${s}/cs03-p.png`; });
      const f = await fetch(`${s}/cs03-fetch?d=x`, { mode: 'no-cors' }).then(() => 'respuesta', () => 'error');
      let beacon: string;
      try { beacon = String((navigator as unknown as Record<string, (u: string) => boolean>)['sendBeacon']!(`${s}/cs03-beacon`)); } catch (e) { beacon = `lanza ${(e as Error).name}`; }
      const marco = document.createElement('iframe');
      document.body.append(marco);
      const W = (marco.contentWindow as unknown as Record<string, typeof WebSocket>)['WebSocket']!;
      const ws = await new Promise<string>((ok) => { const x = new W(`ws://${new URL(s).host}/cs03-ws`); x.onerror = () => { ok('error'); }; x.onopen = () => { ok('abierto'); }; setTimeout(() => { ok('sin evento'); }, 3000); });
      return { imagen, fetch: f, beacon, ws };
    }, senuelo.origen);
    expect(r).toEqual({ imagen: 'error', fetch: 'error', beacon: 'lanza SiglowError', ws: 'error' });
    await expect.poll(() => senuelo.conexiones).toEqual(['GET /cs03-ws HTTP/1.1']);
    await sinCsp.ctx.close();
  });

  test('T-CS-04 @cero-red WebRTC neutralizado al arrancar: 0 paquetes UDP al STUN falso; el caso del iframe queda anotado', async ({ browser }) => {
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
      expect(paquetes).toEqual([]);
      // Caso iframe (10.5.4, SUPUESTO S-10.5): `frame-src 'none'` no impide un iframe `about:blank` con constructores
      // propios. Lo que llegue es riesgo residual de la sección 5 (código inyectado, V-02/V-03) y no bloquea; se anota.
      const marco = await page.evaluate(async (p3) => {
        const f = document.createElement('iframe');
        document.body.append(f);
        const P = (f.contentWindow as unknown as Record<string, typeof RTCPeerConnection | undefined>)['RTCPeerConnection'];
        if (!P) return 'sin constructor';
        const pc = new P({ iceServers: [{ urls: `stun:127.0.0.1:${p3}` }] });
        pc.createDataChannel('x');
        await pc.setLocalDescription(await pc.createOffer());
        await new Promise((ok) => { setTimeout(ok, 3000); });
        pc.close();
        return 'creado';
      }, p3);
      test.info().annotations.push({ type: 'riesgo residual (S-10.5)', description: `iframe about:blank: ${marco}; ${paquetes.length} paquetes UDP al STUN falso` });
      await ctx.close();
    } finally {
      stun.close();
    }
  });

  test('T-CS-05 @cero-red límites documentados: window.open lo frena la guardia; location y un window.open de otro realm sí llegan al señuelo (la CSP no rige la navegación)', async ({ browser }) => {
    const { ctx, page } = await abrir(browser, app.origen, 'allow');
    expect(await page.evaluate((s) => {
      try { (globalThis as unknown as Record<string, (u: string) => unknown>)['open']!(`${s}/cs05-open`); return 'abierta'; } catch (e) { return `lanza ${(e as Error).name} ${(e as { code?: string }).code ?? ''}`; }
    }, senuelo.origen)).toBe('lanza SiglowError ERROR_INTERNO');
    // Desde un realm sin guardia, window.open sí sale (el límite de 5.4: quien ejecuta código en la página ya la controla).
    const [emergente] = await Promise.all([
      ctx.waitForEvent('page'),
      page.evaluate((s) => {
        const f = document.createElement('iframe');
        document.body.append(f);
        (f.contentWindow as Window).open(`${s}/cs05-open-marco`);
      }, senuelo.origen),
    ]);
    await expect.poll(() => senuelo.conexiones.some((c) => c.startsWith('GET /cs05-open-marco'))).toBe(true);
    await emergente.close();
    // location: la navegación de nivel superior llega al señuelo.
    await page.evaluate((s) => { (globalThis as unknown as { location: { href: string } }).location.href = `${s}/cs05-location?d=x`; }, senuelo.origen).catch(() => undefined);
    await expect.poll(() => senuelo.conexiones.some((c) => c.startsWith('GET /cs05-location?d=x'))).toBe(true);
    // El build no usa ninguno de los dos (T-CD-01, check-dist: reglas `window.open` y `location=`).
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

  test('T-CS-07 @cero-red CSP de respaldo: el <meta> es la cabecera menos frame-ancestors, sin report-uri ni report-to, y cabeceras de 3.6 en /, /sw.js, un worker y el .wasm', async ({ browser, request }) => {
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
      'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), display-capture=(), clipboard-read=(), clipboard-write=(self)',
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
        fetchOtro: await fetch('http://ejemplo.test/x').then(() => 'respuesta', () => 'error'),
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
