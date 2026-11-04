import { test, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { serializarLista, sha256Hex, type ArchivoPrecache } from '../../vite-plugins/precache.ts';
import { anonimizar, crearCaso, pegarTexto } from './lib/flujo';
import { guardarOriginales, type ConNativo } from './lib/originales';

// Ciclo de vida del service worker (10.5.6, 3.2; PD-1): T-SW-01 a T-SW-03 y T-PV-10.
// Cada prueba levanta su propio tests/e2e/server.mjs (la configuración real: aplica dist/_headers) con el registro de
// peticiones (SIGLOW_REGISTRO_PETICIONES), que es la verdad de referencia (10.5.1), en un puerto libre que elige el
// sistema (otros carriles dejan servidores abiertos en puertos fijos). dist-v1 y dist-v2 salen de dist/ como saldría un despliegue
// nuevo: otro index.html, su lista de precache recalculada y sw.js con esa lista (el byte cambiado dispara la
// actualización). Solo datos ficticios: los cuerpos enviados son «x».

const DIST = resolve('dist');
const CAMPOS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const NOMBRE_INSEGURO = 'sig-low.prueba';
const M35 = 'Sig-Low todavía no puede recibir documentos';
const M38 = 'Esta dirección no usa conexión protegida (https)'; // resuelve a 127.0.0.1 solo en el navegador de T-SW-03: http y no localhost

interface Peticion { t: number; m: string; u: string }
interface Servidor { origen: string; peticiones: () => Peticion[]; parar: () => Promise<void> }

let tmp = '';
let V1 = '';
let V2 = '';
let V3 = ''; // v2 con un archivo alterado después de calcular la lista (despliegue roto o manipulado)

/** Puerto libre elegido por el sistema (se libera justo antes de que server.mjs lo tome). */
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
    hijo.once('exit', (c) => { mal(new Error(`server.mjs terminó (código ${String(c)}); ¿puerto ${puerto} ocupado?`)); });
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

/** Copia `origen` en `destino` con otro index.html y recalcula precache.json y la lista incrustada en sw.js. */
function crearVersion(origen: string, destino: string, marca: string): string[] {
  cpSync(origen, destino, { recursive: true });
  const index = readFileSync(join(destino, 'index.html'), 'utf8').replace('</body>', `<!-- ${marca} -->\n  </body>`);
  expect(index).toContain(marca);
  writeFileSync(join(destino, 'index.html'), index);
  const vieja = readFileSync(join(destino, 'precache.json'), 'utf8');
  const { archivos } = JSON.parse(vieja) as { archivos: ArchivoPrecache[] };
  const nueva = serializarLista(archivos.map((a) => (a.ruta === '/' ? { ruta: '/', sha256: sha256Hex(index), bytes: Buffer.byteLength(index) } : a)));
  writeFileSync(join(destino, 'precache.json'), nueva);
  const sw = readFileSync(join(destino, 'sw.js'), 'utf8');
  expect(sw.split(JSON.stringify(vieja)).length - 1, 'sw.js incrusta la lista exacta una vez').toBe(1);
  writeFileSync(join(destino, 'sw.js'), sw.replace(JSON.stringify(vieja), () => JSON.stringify(nueva)));
  return [...archivos.map((a) => a.ruta)];
}

function reemplazarContenido(dir: string, origen: string): void {
  for (const e of readdirSync(dir)) rmSync(join(dir, e), { recursive: true, force: true });
  cpSync(origen, dir, { recursive: true });
}

const cacheDe = (dir: string): string => `siglow-app-${sha256Hex(readFileSync(join(dir, 'precache.json')))}`;

async function esperarControl(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, { timeout: 30_000 });
}

/** Versión que sirve el SW que controla la página: cada versión lee «/» de su propia caché. */
/** Estado SIN_SERVICE_WORKER de la interfaz (PC-1, 8.2.10): M-35 y M-36 (o M-38 sin https) y ningún campo. */
async function esperarSinSw(page: Page, mensaje: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: M35 })).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('[data-prueba="sin-sw"]')).toContainText(mensaje);
  await expect(page.locator(CAMPOS)).toHaveCount(0);
}

const servidaPor = (page: Page): Promise<string | null> =>
  page.evaluate(async () => /siglow-(v\d)/.exec(await (await fetch('/')).text())?.[1] ?? null);

// Cachés de la app (precache por versión). La del modelo (`siglow-modelo-…`, F10: «Anonimizar» empieza su descarga) sobrevive a las
// actualizaciones a propósito y no cuenta aquí.
const cachesDe = (page: Page): Promise<string[]> =>
  page.evaluate(async () => (await caches.keys()).filter((n) => !n.startsWith('siglow-modelo-')).sort());

/** `registration.update()` (GET /sw.js) y espera a que la versión nueva quede instalada y en espera. */
async function buscarYEsperarVersionNueva(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) throw new Error('sin registro');
    await reg.update();
    for (let i = 0; i < 300 && !reg.waiting; i += 1) await new Promise((r) => setTimeout(r, 100));
    if (!reg.waiting) throw new Error('la versión nueva no quedó en espera');
  });
}

// El fetch original (tests/e2e/lib/originales.ts): la guardia de la app (src/guard.ts, 5.2.1) ya rechaza POST, query y rutas
// fuera de su lista; con el original se prueba el interruptor del SW (o su ausencia) por sí solo.

async function abrirControlada(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto('/');
  await esperarControl(page);
  return page;
}

/** Marca en la memoria de la página: desaparece si la página se recarga. */
const marcar = (page: Page): Promise<void> => page.evaluate(() => { (window as { siglowSinRecarga?: boolean }).siglowSinRecarga = true; });

/** Estado de la pestaña: si no se recargó, y el SW activo y el que espera en su registro. */
const estadoPestana = (page: Page): Promise<{ sinRecarga: boolean; activo: string | null; espera: string | null }> =>
  page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return {
      sinRecarga: (window as { siglowSinRecarga?: boolean }).siglowSinRecarga === true,
      activo: reg?.active?.state ?? null,
      espera: reg?.waiting?.state ?? null,
    };
  });

/** SKIP_WAITING directo al SW en espera, con un puerto: la respuesta del SW (sin pasar por la interfaz). */
const pedirSkipWaiting = (page: Page): Promise<unknown> =>
  page.evaluate(async () => {
    const espera = (await navigator.serviceWorker.getRegistration())?.waiting;
    if (!espera) return 'sin versión en espera';
    const canal = new MessageChannel();
    const respuesta = new Promise<unknown>((ok) => { canal.port1.onmessage = (e) => { ok(e.data); }; });
    espera.postMessage({ tipo: 'SKIP_WAITING' }, [canal.port2]);
    return respuesta;
  });

/** Ventanas de Sig-Low que ve el SW en espera (con y sin controlador). Se lee en el propio worker, no en la página. */
async function ventanasQueVeLaEspera(ctx: BrowserContext): Promise<number> {
  for (const w of ctx.serviceWorkers()) {
    const n = await w.evaluate(async () => {
      const g = self as unknown as { serviceWorker: { state: string }; clients: { matchAll(o: object): Promise<unknown[]> } };
      return g.serviceWorker.state === 'installed' ? (await g.clients.matchAll({ type: 'window', includeUncontrolled: true })).length : -1;
    }).catch(() => -1);
    if (n >= 0) return n;
  }
  return -1;
}

test.beforeAll(() => {
  expect(existsSync(join(DIST, 'precache.json')), 'falta dist/: corra `npm run build` (o `npm run verify`)').toBe(true);
  tmp = mkdtempSync(join(tmpdir(), 'siglow-sw-'));
  V1 = join(tmp, 'dist-v1');
  V2 = join(tmp, 'dist-v2');
  crearVersion(DIST, V1, 'siglow-v1');
  crearVersion(DIST, V2, 'siglow-v2');
  V3 = join(tmp, 'dist-v3');
  cpSync(V2, V3, { recursive: true });
  writeFileSync(join(V3, 'tt-policy.js'), readFileSync(join(V3, 'tt-policy.js'), 'utf8') + '// alterado\n');
});

test.afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test.describe('T-SW-01 sin controlador', () => {
  test('T-SW-01 @cero-red con el service worker bloqueado: SIN_SERVICE_WORKER, sin controlador y sin campos de contenido', async ({ browser }) => {
    const srv = await levantar(V1);
    try {
      const ctx = await browser.newContext({ baseURL: srv.origen, serviceWorkers: 'block' });
      const page = await ctx.newPage();
      await page.goto('/');
      await expect(page.locator('[data-prueba="promesa"]')).toBeVisible();
      expect(await page.evaluate(async () => ({
        controlador: navigator.serviceWorker.controller !== null,
        registros: (await navigator.serviceWorker.getRegistrations()).length,
      }))).toEqual({ controlador: false, registros: 0 });
      await esperarSinSw(page, 'Pulse «Recargar»');
      await ctx.close();
    } finally {
      await srv.parar();
    }
  });

  test('T-SW-01 @cero-red Mayús + recargar: SIN_SERVICE_WORKER aunque el SW esté activo, y sin campos de contenido', async ({ browser }) => {
    const srv = await levantar(V1);
    try {
      const ctx = await browser.newContext({ baseURL: srv.origen });
      await guardarOriginales(ctx);
      const page = await abrirControlada(ctx);
      const cdp = await ctx.newCDPSession(page);
      // Page.reload con ignoreCache es la recarga forzada (Mayús + F5): el navegador no pasa la navegación por el SW.
      await Promise.all([page.waitForEvent('load'), cdp.send('Page.reload', { ignoreCache: true })]);
      await expect(page.locator('[data-prueba="promesa"]')).toBeVisible();
      expect(await page.evaluate(async () => ({
        controlador: navigator.serviceWorker.controller !== null,
        activo: (await navigator.serviceWorker.getRegistration())?.active?.state ?? null,
      }))).toEqual({ controlador: false, activo: 'activated' });
      await esperarSinSw(page, 'una recarga normal, no forzada');
      // Control negativo (V-13): sin controlador no hay interruptor y un POST al propio origen sí llega al servidor
      // (solo lo frena la CSP si es a otro origen). Por eso la app no acepta documentos en este estado.
      const corte = srv.peticiones().length;
      expect(await page.evaluate(() => (globalThis as unknown as ConNativo).__nativo.fetch('/control-sin-sw', { method: 'POST', body: 'x' })
        .then((r) => r.status, () => -1))).toBe(404);
      expect(srv.peticiones().slice(corte).map((p) => `${p.m} ${p.u}`)).toEqual(['POST /control-sin-sw']);
      await ctx.close();
    } finally {
      await srv.parar();
    }
  });

  test('T-SW-01 @cero-red con controlador, POST, query, otro origen y ruta fuera de la lista reciben Response.error() sin llegar a ningún servidor', async ({ browser }) => {
    const srv = await levantar(V1);
    const senuelo = await levantar(V1);
    try {
      // bypassCSP aísla el interruptor: sin la CSP, el SW es la única barrera (la CSP la prueba T-CS-01, PD-2).
      const ctx = await browser.newContext({ baseURL: srv.origen, bypassCSP: true });
      await guardarOriginales(ctx);
      const page = await abrirControlada(ctx);
      const ruta = JSON.parse(readFileSync(join(V1, 'precache.json'), 'utf8')).archivos.find((a: ArchivoPrecache) => a.ruta.startsWith('/assets/')).ruta as string;
      const corte = srv.peticiones().length;
      const resultados = await page.evaluate(async ({ s, ruta }) => {
        const f = (globalThis as unknown as ConNativo).__nativo.fetch;
        const intento = (u: string, o?: RequestInit): Promise<string> => f(u, o).then((r) => `respuesta ${r.status}`, () => 'error');
        const imagen = (u: string): Promise<string> => new Promise((ok) => {
          const i = new Image();
          i.onload = () => { ok('carga'); };
          i.onerror = () => { ok('error'); };
          i.src = u;
        });
        return {
          postMismoOrigen: await intento('/fuga', { method: 'POST', body: 'x' }),
          postRutaListada: await intento('/tt-policy.js', { method: 'POST', body: 'x' }),
          putRutaListada: await intento(ruta, { method: 'PUT', body: 'x' }),
          headRutaListada: await intento('/tt-policy.js', { method: 'HEAD' }),
          queryRaiz: await intento('/?d=x'),
          queryRutaListada: await intento(`${ruta}?d=x`),
          queryVacia: await intento('/tt-policy.js?'),
          fugaConQuery: await intento('/fuga?d=x'),
          rutaNoListada: await intento('/ruta-no-listada'),
          swPorFetch: await intento('/sw.js'),
          otroOrigen: await intento(`${s}/fuga?d=x`),
          otroOrigenNoCors: await intento(`${s}/fuga`, { mode: 'no-cors' }),
          otroOrigenPost: await intento(`${s}/fuga`, { method: 'POST', body: 'x', mode: 'no-cors' }),
          imagenOtroOrigen: await imagen(`${s}/p.png?d=x`),
          imagenNoListada: await imagen('/p.png'),
          listadaDesdeCache: await intento('/tt-policy.js'),
        };
      }, { s: senuelo.origen, ruta });
      expect(resultados).toEqual({
        postMismoOrigen: 'error', postRutaListada: 'error', putRutaListada: 'error', headRutaListada: 'error',
        queryRaiz: 'error', queryRutaListada: 'error', queryVacia: 'error', fugaConQuery: 'error', rutaNoListada: 'error',
        swPorFetch: 'error', otroOrigen: 'error', otroOrigenNoCors: 'error', otroOrigenPost: 'error',
        imagenOtroOrigen: 'error', imagenNoListada: 'error', listadaDesdeCache: 'respuesta 200',
      });
      // Navegaciones de la página controlada: solo «/» (o /index.html) recibe index.html, desde la caché.
      const navegar = (u: string): Promise<string> => page.goto(u).then((r) => `respuesta ${r?.status() ?? 0}`, () => 'error');
      expect(await navegar('/index.html')).toBe('respuesta 200');
      expect(await navegar('/')).toBe('respuesta 200');
      expect({
        conQuery: await navegar('/?d=x'),
        rutaListadaConQuery: await navegar('/index.html?d=x'),
        noListada: await navegar('/ruta-no-listada'),
        archivoListado: await navegar('/tt-policy.js'),
      }).toEqual({ conQuery: 'error', rutaListadaConQuery: 'error', noListada: 'error', archivoListado: 'error' });
      // Nada llegó al servidor de la app (el archivo listado salió de la caché) ni al señuelo. Solo se admite la
      // búsqueda de versión `GET /sw.js` exacta, que el navegador hace por su cuenta (10.5.1).
      expect(srv.peticiones().slice(corte).filter((p) => !(p.m === 'GET' && p.u === '/sw.js'))).toEqual([]);
      expect(senuelo.peticiones()).toEqual([]);
      await ctx.close();
    } finally {
      await srv.parar();
      await senuelo.parar();
    }
  });
});

test.describe('T-SW-02 y T-PV-10 actualización', () => {
  let srv: Servidor;
  let actual = '';

  test.beforeEach(async () => {
    actual = join(tmp, `actual-${Date.now()}`);
    cpSync(V1, actual, { recursive: true });
    srv = await levantar(actual);
  });

  test.afterEach(async () => {
    await srv.parar();
    rmSync(actual, { recursive: true, force: true });
  });

  /** v1 controla; se publica v2; la búsqueda de versión es GET /sw.js sin query; v2 queda en espera sin tomar el control. */
  async function publicarV2(page: Page): Promise<void> {
    expect(await servidaPor(page)).toBe('v1');
    expect(await cachesDe(page)).toEqual([cacheDe(V1)]);
    reemplazarContenido(actual, V2);
    const corte = srv.peticiones().length;
    await buscarYEsperarVersionNueva(page);
    const v2 = new Set(['/sw.js', ...(JSON.parse(readFileSync(join(V2, 'precache.json'), 'utf8')) as { archivos: ArchivoPrecache[] }).archivos.map((a) => a.ruta)]);
    // F10 (v1.1.3): «Anonimizar» empieza la descarga del detector, que puede coincidir con la búsqueda de versión. Se admiten solo
    // las rutas de los manifiestos del modelo (lo demás sigue prohibido); que solo se pidan esas lo prueba model.spec.ts.
    for (const id of ['gliner-x-large', 'gliner-x-base']) {
      const m = JSON.parse(readFileSync(join(V2, 'models', id, 'manifest.json'), 'utf8')) as { trozos: { ruta: string }[]; auxiliares: { ruta: string }[] };
      for (const a of [...m.trozos, ...m.auxiliares]) v2.add(`/models/${id}/${a.ruta}`);
    }
    const despues = srv.peticiones().slice(corte);
    expect(despues.filter((p) => p.m === 'GET' && p.u === '/sw.js').length).toBeGreaterThanOrEqual(1);
    expect(despues.filter((p) => p.m !== 'GET' || p.u.includes('?') || !v2.has(p.u))).toEqual([]);
    // Sin skipWaiting automático: v1 sigue controlando (y sirviendo su caché) con v2 instalada en espera.
    await page.waitForTimeout(1_000);
    expect(await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return { activo: reg?.active?.state ?? null, espera: reg?.waiting?.state ?? null };
    })).toEqual({ activo: 'activated', espera: 'installed' });
    expect(await servidaPor(page)).toBe('v1');
    expect(await cachesDe(page)).toEqual([cacheDe(V1), cacheDe(V2)].sort());
  }

  test('T-SW-02 @cero-red aviso de versión nueva: v1 sigue controlando, con la tabla sin guardar no se aplica, y «Actualizar ahora» aplica v2', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: srv.origen });
    const page = await abrirControlada(ctx);
    const h1 = (nombre: string) => page.getByRole('heading', { level: 1, name: nombre });
    await expect(h1('Cargar documento')).toBeVisible({ timeout: 25_000 });
    // Caso «No guardar» (ficticio, creado en «Opciones avanzadas»): su llave existe solo en memoria y la recarga la borraría.
    await crearCaso(page, { codigo: 'PRUEBA-SW-02', guardar: false });
    await publicarV2(page);
    const banda = page.locator('[data-prueba="banda-actualizacion"]');
    const ahora = banda.getByRole('button', { name: 'Actualizar ahora' });
    await expect(banda).toContainText('Hay una versión nueva de Sig-Low. Se aplicará sola la próxima vez que abra Sig-Low con todas sus pestañas cerradas.');
    // Con la tabla sin guardar ni exportar, el aviso exige hacerlo antes (8.2.10): «Actualizar ahora» no se puede usar.
    await expect(banda.getByRole('button', { name: 'Guardar la llave para devolver los datos reales' })).toBeVisible();
    await expect(ahora).toBeDisabled();
    expect(await servidaPor(page)).toBe('v1');
    // Sin asunto en memoria (tras «Bloquear») se puede aplicar: SKIP_WAITING y recarga a la v2.
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(h1('Cargar documento')).toBeVisible();
    await expect(ahora).toBeEnabled();
    await Promise.all([page.waitForEvent('load'), ahora.click()]);
    await esperarControl(page);
    expect(await page.content()).toContain('siglow-v2');
    expect(await servidaPor(page)).toBe('v2');
    expect(await cachesDe(page)).toEqual([cacheDe(V2)]);
    await ctx.close();
  });

  // D-23: en el flujo por defecto Sig-Low abre un caso efímero que el abogado no ve. Con una vista previa en curso, el aviso de versión
  // nueva aparece, v1 sigue controlando y «Actualizar ahora» exige aceptar que la revisión en curso se perderá (M-105).
  test('T-SW-02 @cero-red D-23 flujo por defecto (caso efímero): la versión nueva queda en espera con la vista previa en curso y «Actualizar ahora» no se puede usar sin aceptar que se perderá', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: srv.origen });
    const page = await abrirControlada(ctx);
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible({ timeout: 25_000 });
    await pegarTexto(page, 'Cédula 1.000.000.017.');
    await anonimizar(page);
    await publicarV2(page);
    expect(await servidaPor(page)).toBe('v1');
    const banda = page.locator('[data-prueba="banda-actualizacion"]');
    await expect(banda).toContainText('Hay una versión nueva de Sig-Low.');
    await expect(banda.getByRole('button', { name: 'Actualizar ahora' })).toBeDisabled();
    await expect(banda.getByRole('checkbox', { name: 'Entiendo que la revisión en curso se perderá al actualizar.' })).toBeVisible();
    // El caso efímero no se ve, pero «Bloquear» sí: tras bloquear ya no hay nada en memoria y se puede aplicar.
    await expect(page.locator('[data-prueba="chip-asunto"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    await expect(banda.getByRole('button', { name: 'Actualizar ahora' })).toBeEnabled();
    await ctx.close();
  });

  // DEFECTO DE PRODUCTO (src/ui/Armazon.tsx, `respaldada` de BandaActualizacion): con el caso efímero y una llave aún vacía
  // (backedUpRevision null frente a tableRevision 0) el aviso pide «guarde la llave» y «Actualizar ahora» sigue deshabilitado aunque se
  // acepte M-105. Con D-23 el abogado no creó ningún caso ni conoce la llave: aceptar que la revisión en curso se perderá debería bastar.
  test('T-SW-02 @cero-red D-23 flujo por defecto (caso efímero, llave vacía): aceptar que la revisión en curso se perderá basta para «Actualizar ahora» y no se pide guardar una llave', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: srv.origen });
    const page = await abrirControlada(ctx);
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible({ timeout: 25_000 });
    await pegarTexto(page, 'Cédula 1.000.000.017.');
    await anonimizar(page);
    await publicarV2(page);
    const banda = page.locator('[data-prueba="banda-actualizacion"]');
    const ahora = banda.getByRole('button', { name: 'Actualizar ahora' });
    await banda.getByRole('checkbox', { name: 'Entiendo que la revisión en curso se perderá al actualizar.' }).check();
    await expect(banda).not.toContainText('Antes de actualizar, guarde la llave');
    await expect(ahora).toBeEnabled();
    await ctx.close();
  });

  // B-11 (P0-6a de PD-1): el aviso solo ve la tabla de su pestaña, pero SKIP_WAITING vale para todas. Con otra pestaña
  // de Sig-Low abierta, el SW no lo aplica (ni desde la interfaz ni con el mensaje directo) y el aviso pide cerrarla.
  test('T-SW-02 @cero-red con dos pestañas abiertas, SKIP_WAITING no cambia el controlador y el aviso pide cerrar la otra; con una sola, «Actualizar ahora» aplica v2', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: srv.origen });
    const page = await abrirControlada(ctx);
    const otra = await abrirControlada(ctx);
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible({ timeout: 25_000 });
    // La otra pestaña tiene un asunto «No guardar» (ficticio): su tabla existe solo en su memoria.
    await expect(otra.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible({ timeout: 25_000 });
    await crearCaso(otra, { codigo: 'PRUEBA-SW-02', guardar: false });
    await publicarV2(page);
    expect(await ventanasQueVeLaEspera(ctx)).toBe(2);
    await marcar(page);
    await marcar(otra);
    const banda = page.locator('[data-prueba="banda-actualizacion"]');
    const ahora = banda.getByRole('button', { name: 'Actualizar ahora' });
    const otrasPestanas = banda.locator('[data-prueba="actualizacion-otras-pestanas"]');
    // Esta pestaña no tiene asunto: su propio aviso permite actualizar, pero el SW lo rechaza por la otra.
    await expect(ahora).toBeEnabled();
    await expect(otrasPestanas).toHaveText('');
    await ahora.click();
    await expect(otrasPestanas).toHaveText('Cierre las otras pestañas de Sig-Low para actualizar ahora.');
    await expect(ahora).toBeEnabled();
    // La guardia está en el SW, no solo en la interfaz: el mensaje directo también se rechaza, desde las dos pestañas.
    expect(await pedirSkipWaiting(otra)).toEqual({ tipo: 'SKIP_WAITING', aplicada: false, motivo: 'otras_pestanas' });
    await otra.evaluate(async () => { (await navigator.serviceWorker.getRegistration())?.waiting?.postMessage({ tipo: 'SKIP_WAITING' }); });
    await page.waitForTimeout(1_500);
    for (const p of [page, otra]) {
      expect(await estadoPestana(p)).toEqual({ sinRecarga: true, activo: 'activated', espera: 'installed' });
      expect(await servidaPor(p)).toBe('v1');
      await expect(p.locator('[data-prueba="aviso-version-cambiada"]')).toHaveCount(0);
    }
    await expect(otra.locator('[data-prueba="chip-asunto"]')).toContainText('PRUEBA-SW-02');
    expect(await cachesDe(page)).toEqual([cacheDe(V1), cacheDe(V2)].sort());
    // Una pestaña sin controlador (Mayús + recargar) también cuenta: `clients.claim()` la tomaría al activar.
    await otra.close();
    const forzada = await abrirControlada(ctx);
    const cdp = await ctx.newCDPSession(forzada);
    await Promise.all([forzada.waitForEvent('load'), cdp.send('Page.reload', { ignoreCache: true })]);
    expect(await forzada.evaluate(() => navigator.serviceWorker.controller === null)).toBe(true);
    await expect.poll(() => ventanasQueVeLaEspera(ctx)).toBe(2);
    await ahora.click();
    await expect(otrasPestanas).toHaveText('Cierre las otras pestañas de Sig-Low para actualizar ahora.');
    expect(await estadoPestana(page)).toEqual({ sinRecarga: true, activo: 'activated', espera: 'installed' });
    // Con una sola pestaña funciona como antes: SKIP_WAITING y recarga a la v2.
    await forzada.close();
    await expect.poll(() => ventanasQueVeLaEspera(ctx)).toBe(1);
    await Promise.all([page.waitForEvent('load'), ahora.click()]);
    await esperarControl(page);
    expect(await page.content()).toContain('siglow-v2');
    expect(await servidaPor(page)).toBe('v2');
    expect(await estadoPestana(page)).toEqual({ sinRecarga: false, activo: 'activated', espera: null });
    expect(await cachesDe(page)).toEqual([cacheDe(V2)]);
    await ctx.close();
  });

  // B-11: si el controlador cambia sin que la pestaña lo pida (una pestaña que se abre justo al aplicar, o una versión
  // sin la guardia), la pestaña no se recarga sola: conserva la tabla en memoria y avisa. La activación se fuerza desde
  // fuera de la interfaz con ServiceWorker.skipWaiting del protocolo de depuración.
  test('T-SW-02 @cero-red un cambio de controlador que la pestaña no pidió no la recarga: conserva el asunto en memoria y el aviso pide guardar y recargar', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: srv.origen });
    const page = await abrirControlada(ctx);
    const otra = await abrirControlada(ctx);
    await expect(otra.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible({ timeout: 25_000 });
    await crearCaso(otra, { codigo: 'PRUEBA-SW-02', guardar: false });
    await publicarV2(page);
    await marcar(page);
    await marcar(otra);
    // Primero un «Actualizar ahora» rechazado: no debe dejar una recarga pendiente en esta pestaña.
    const banda = page.locator('[data-prueba="banda-actualizacion"]');
    await banda.getByRole('button', { name: 'Actualizar ahora' }).click();
    await expect(banda.locator('[data-prueba="actualizacion-otras-pestanas"]')).toHaveText('Cierre las otras pestañas de Sig-Low para actualizar ahora.');
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.skipWaiting', { scopeURL: `${srv.origen}/` });
    for (const p of [page, otra]) {
      await expect(p.locator('[data-prueba="aviso-version-cambiada"]')).toContainText('Sig-Low se actualizó desde otra pestaña.');
      await expect(p.locator('[data-prueba="banda-actualizacion"]')).toHaveCount(0);
      // `clients.claim()` corre en `activate`: el aviso puede llegar con v2 todavía en «activating».
      await expect.poll(() => estadoPestana(p)).toEqual({ sinRecarga: true, activo: 'activated', espera: null });
      expect(await servidaPor(p)).toBe('v2');
    }
    // La llave «No guardar» de la otra pestaña sigue en memoria, y el aviso ofrece guardarla antes de recargar.
    await expect(otra.locator('[data-prueba="caso-abierto"]')).toBeVisible();
    await expect(otra.locator('[data-prueba="chip-asunto"]')).toContainText('PRUEBA-SW-02');
    await expect(otra.locator('[data-prueba="aviso-version-cambiada"]').getByRole('button', { name: 'Guardar la llave para devolver los datos reales' })).toBeVisible();
    await page.waitForTimeout(1_000);
    for (const p of [page, otra]) expect((await estadoPestana(p)).sinRecarga).toBe(true);
    await ctx.close();
  });

  test('T-SW-02 @cero-red una versión con un archivo que no coincide con su SHA-256 no se instala y sigue la anterior', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: srv.origen });
    const page = await abrirControlada(ctx);
    expect(await servidaPor(page)).toBe('v1');
    reemplazarContenido(actual, V3);
    const corte = srv.peticiones().length;
    const r = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) throw new Error('sin registro');
      let nueva: ServiceWorker | null = null;
      reg.addEventListener('updatefound', () => { nueva = reg.installing; });
      await reg.update().catch(() => undefined);
      nueva ??= reg.installing;
      for (let i = 0; i < 300 && (nueva as ServiceWorker | null)?.state !== 'redundant'; i += 1) await new Promise((ok) => setTimeout(ok, 100));
      return { nueva: (nueva as ServiceWorker | null)?.state ?? null, espera: reg.waiting?.state ?? null, activo: reg.active?.state ?? null };
    });
    expect(r).toEqual({ nueva: 'redundant', espera: null, activo: 'activated' });
    // La instalación pidió /tt-policy.js (y lo rechazó por el hash); todo fue GET sin query.
    const despues = srv.peticiones().slice(corte);
    expect(despues.some((p) => p.u === '/tt-policy.js')).toBe(true);
    expect(despues.filter((p) => p.m !== 'GET' || p.u.includes('?'))).toEqual([]);
    expect(await servidaPor(page)).toBe('v1');
    // La caché que creó la instalación fallida se borró: solo queda la de v1.
    expect(await cachesDe(page)).toEqual([cacheDe(V1)]);
    await ctx.close();
  });

  test('T-PV-10 la versión nueva se aplica sola al abrir Sig-Low con todas sus pestañas cerradas', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: srv.origen });
    const page = await abrirControlada(ctx);
    const otra = await abrirControlada(ctx);
    await publicarV2(page);
    expect(await servidaPor(otra)).toBe('v1');
    await page.close();
    // Con una pestaña abierta la versión nueva sigue en espera.
    expect(await otra.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state ?? null)).toBe('installed');
    await otra.close();
    const nueva = await ctx.newPage();
    await nueva.goto('/');
    await esperarControl(nueva);
    expect(await nueva.content()).toContain('siglow-v2');
    expect(await servidaPor(nueva)).toBe('v2');
    expect(await cachesDe(nueva)).toEqual([cacheDe(V2)]);
    await ctx.close();
  });
});

test.describe('T-SW-03 contexto no seguro', () => {
  let navegador: Browser;

  test.beforeAll(async () => {
    navegador = await chromium.launch({ args: [`--host-resolver-rules=MAP ${NOMBRE_INSEGURO} 127.0.0.1`] });
  });

  test.afterAll(async () => {
    await navegador.close();
  });

  test('T-SW-03 @cero-red INV-V08 servida por http:// fuera de localhost: CONTEXTO_NO_SEGURO, sin bóveda, sin service worker ni crypto.subtle', async () => {
    const srv = await levantar(V1);
    const puerto = new URL(srv.origen).port;
    try {
      const ctx = await navegador.newContext();
      const page = await ctx.newPage();
      await page.goto(`http://${NOMBRE_INSEGURO}:${puerto}/`);
      await expect(page.locator('[data-prueba="promesa"]')).toBeVisible();
      expect(await page.evaluate(() => ({
        seguro: isSecureContext,
        sw: 'serviceWorker' in navigator,
        subtle: typeof (globalThis.crypto as Crypto | undefined)?.subtle,
      }))).toEqual({ seguro: false, sw: false, subtle: 'undefined' });
      await esperarSinSw(page, M38);
      // INV-V08: no se ofrece la bóveda ni «Recargar» (recargar no arregla la falta de https).
      await expect(page.getByRole('button', { name: /Bóveda|Guardar|Recargar/ })).toHaveCount(0);
      // Sin contexto seguro la app no intenta registrar el SW (sw-registro.ts): /sw.js nunca se pide.
      expect(srv.peticiones().filter((p) => p.u === '/sw.js')).toEqual([]);
      await ctx.close();
    } finally {
      await srv.parar();
    }
  });
});
