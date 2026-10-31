/// <reference lib="webworker" />
// Service worker de Sig-Low (3.2, 5.2.3; PD-1).
// 1. Interruptor de red: el primer listener `fetch` responde a TODA petición. Solo un GET del mismo origen, sin query y
//    en la lista blanca recibe un archivo, desde la caché de esta versión y con las cabeceras de 3.6; lo demás recibe
//    Response.error() y no llega a ningún servidor. Una petición sin respondWith iría a la red: no hay ese camino.
// 2. Precache verificado: cada entrada se pide con cache: 'reload' y se compara su SHA-256; si uno no coincide, la
//    instalación falla y sigue la versión anterior. Caché `siglow-app-<SHA-256 de precache.json>`.
// 3. Actualización: sin skipWaiting automático. La versión nueva espera y el navegador la activa cuando se cierran
//    todas las pestañas de Sig-Low; SKIP_WAITING solo llega del aviso de la interfaz (8.2.10), tras guardar o exportar,
//    y solo vale con una única ventana de Sig-Low abierta, la que lo pide (B-11): el aviso revisa la tabla de esa
//    pestaña, pero la activación quitaría a las demás los archivos de su versión.
// Los mensajes a la página no llevan contenido: { tipo: 'avance', done, total } y { tipo: 'offlineReady' }; la respuesta
// a SKIP_WAITING, por el puerto que trae, es { tipo: 'SKIP_WAITING', aplicada, motivo? } (`otras_pestanas`, `sin_espera`).
// vite-plugins/precache.ts escribe la lista, las cabeceras de public/_headers y los tipos en lugar de __SIGLOW_SW__.
declare const self: ServiceWorkerGlobalScope;

interface ConfigSw {
  lista: string;
  cabeceras: [string, [string, string][]][];
  tipos: Record<string, string>;
}
declare const __SIGLOW_SW__: ConfigSw;

interface Version {
  cache: string;
  hashes: ReadonlyMap<string, string>; // ruta → SHA-256 esperado (lista blanca de archivos de la app)
  lista: Uint8Array; // bytes de /precache.json
  reglas: readonly (readonly [RegExp, readonly (readonly [string, string])[]])[]; // cabeceras de 3.6 por patrón
}
type Aviso = { tipo: 'avance'; done: number; total: number } | { tipo: 'offlineReady' };

const PREFIJO_APP = 'siglow-app-';
const RUTA_LISTA = '/precache.json';
const PARALELO = 4;
/** Rutas que sirven otra entrada de la lista. Cloudflare Pages redirige /index.html a /: se pide y se guarda «/». */
const ALIAS: ReadonlyMap<string, string> = new Map([['/index.html', '/']]);
const HEX64 = /^[0-9a-f]{64}$/;
const RUTA = /^\/[A-Za-z0-9._/-]*$/;

// 1. Interruptor de red (primer listener).
self.addEventListener('fetch', (e) => {
  e.respondWith(responder(e.request).catch(() => Response.error()));
});

self.addEventListener('install', (e) => {
  e.waitUntil(instalar());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(activar());
});

self.addEventListener('message', (e) => {
  const d: unknown = e.data;
  if (!(e.source instanceof WindowClient) || typeof d !== 'object' || d === null) return;
  if ((d as { tipo?: unknown }).tipo === 'SKIP_WAITING') e.waitUntil(saltarEspera(e.source, e.ports[0]));
});

const CONFIG: ConfigSw = __SIGLOW_SW__;
let version: Promise<Version> | undefined;

/** La versión se arma una vez por arranque del SW. Si la configuración es inválida, todo responde Response.error(). */
function laVersion(): Promise<Version> {
  version ??= prepararVersion();
  return version;
}

async function prepararVersion(): Promise<Version> {
  const lista = new TextEncoder().encode(CONFIG.lista);
  const hashLista = await sha256Hex(lista);
  const datos = JSON.parse(CONFIG.lista) as { formato?: unknown; archivos?: unknown };
  if (datos.formato !== 1 || !Array.isArray(datos.archivos)) throw new TypeError('LISTA');
  const hashes = new Map<string, string>();
  for (const a of datos.archivos as { ruta?: unknown; sha256?: unknown }[]) {
    if (typeof a.ruta !== 'string' || !RUTA.test(a.ruta) || typeof a.sha256 !== 'string' || !HEX64.test(a.sha256)) {
      throw new TypeError('LISTA');
    }
    hashes.set(a.ruta, a.sha256);
  }
  if (!hashes.has('/')) throw new TypeError('LISTA');
  hashes.set(RUTA_LISTA, hashLista);
  const reglas = CONFIG.cabeceras.map(([patron, cabeceras]) => [comodin(patron), cabeceras] as const);
  return { cache: PREFIJO_APP + hashLista, hashes, lista, reglas };
}

/** Ruta de la lista blanca que corresponde a la petición, o null si la petición no puede salir de aquí. */
function rutaPermitida(req: Request, hashes: ReadonlyMap<string, string>): string | null {
  if (req.method !== 'GET' || req.url.includes('?')) return null;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.search !== '') return null;
  const ruta = ALIAS.get(url.pathname) ?? url.pathname;
  // Las navegaciones reciben index.html, y solo en «/» (o su alias).
  if (req.mode === 'navigate') return ruta === '/' ? '/' : null;
  return hashes.has(ruta) ? ruta : null;
}

async function responder(req: Request): Promise<Response> {
  const v = await laVersion();
  const ruta = rutaPermitida(req, v.hashes);
  if (ruta === null) return Response.error();
  // Caché incompleta (borrada a mano o por el navegador): se vuelve a pedir el archivo de ESTA versión y se sirve solo
  // si su SHA-256 coincide; sin conexión o con otro contenido, Response.error(). No se guarda ni se crea la caché
  // (`caches.match` con cacheName, no `caches.open`): su existencia sigue significando «precache completo» (M-39).
  const r = (await caches.match(ruta, { cacheName: v.cache })) ?? (await traerVerificado(ruta, v));
  if (!r) return Response.error();
  return conCabeceras(r, ruta, v);
}

/** Respuesta servida: el cuerpo guardado con las cabeceras de 3.6 inyectadas al construir (V-15), nunca las guardadas. */
function conCabeceras(r: Response, ruta: string, v: Version): Response {
  const h = new Headers();
  for (const [patron, cabeceras] of v.reglas) if (patron.test(ruta)) for (const [k, valor] of cabeceras) h.set(k, valor);
  h.set('Content-Type', Object.hasOwn(CONFIG.tipos, extension(ruta)) ? (CONFIG.tipos[extension(ruta)] as string) : 'application/octet-stream');
  return new Response(r.body, { status: 200, statusText: 'OK', headers: h });
}

/** Pide al propio origen un archivo de la lista y lo devuelve solo si su SHA-256 es el esperado. */
async function traerVerificado(ruta: string, v: Version): Promise<Response | null> {
  if (ruta === RUTA_LISTA) return new Response(v.lista.slice(), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    const r = await fetch(new URL(ruta, self.location.origin).href, {
      cache: 'reload', credentials: 'omit', mode: 'same-origin', redirect: 'error', referrerPolicy: 'no-referrer',
    });
    if (r.status !== 200 || r.type !== 'basic') return null;
    const cuerpo = await r.arrayBuffer();
    if ((await sha256Hex(cuerpo)) !== v.hashes.get(ruta)) return null;
    return new Response(cuerpo, { status: 200, statusText: 'OK', headers: r.headers });
  } catch {
    return null;
  }
}

async function yaGuardado(cache: Cache, ruta: string, esperado: string): Promise<boolean> {
  const r = await cache.match(ruta);
  return r !== undefined && (await sha256Hex(await r.arrayBuffer())) === esperado;
}

// 2. Instalación: todo o nada. Una entrada ya guardada con el hash correcto (reintento, misma lista) no se vuelve a pedir.
// Si falla, se borra la caché que esta instalación creó; una que ya existía (la de la versión activa, si la lista es la
// misma) se deja: solo contiene archivos verificados de esa lista.
async function instalar(): Promise<void> {
  const v = await laVersion();
  const primera = self.registration.active === null; // el avance solo se muestra en la primera visita (8.1)
  const existia = await caches.has(v.cache);
  const cache = await caches.open(v.cache);
  const pendientes = [...v.hashes.entries()];
  const total = pendientes.length;
  let hechos = 0;
  let fallo = false;
  if (primera) await avisar({ tipo: 'avance', done: 0, total });
  const trabajar = async (): Promise<void> => {
    for (let e = pendientes.shift(); e && !fallo; e = pendientes.shift()) {
      const [ruta, esperado] = e;
      if (!(await yaGuardado(cache, ruta, esperado))) {
        const r = await traerVerificado(ruta, v);
        if (!r) {
          fallo = true;
          throw new TypeError('PRECACHE');
        }
        await cache.put(ruta, r);
      }
      hechos += 1;
      if (primera) await avisar({ tipo: 'avance', done: hechos, total });
    }
  };
  try {
    await Promise.all(Array.from({ length: PARALELO }, trabajar));
  } catch (e) {
    fallo = true;
    if (!existia) await caches.delete(v.cache);
    throw e;
  }
}

// 3. SKIP_WAITING solo en la versión en espera y si la única ventana de Sig-Low abierta es la que lo pide (B-11).
// `includeUncontrolled` es obligatorio: sin él, matchAll solo devuelve las ventanas que controla ESTE worker, y el que
// está en espera no controla ninguna (daría siempre 0 y la guardia no frenaría nada). Cuenta también las pestañas sin
// controlador (Mayús + recargar), porque `clients.claim()` las tomaría. Sin la ventana que lo pide en la lista: no.
async function saltarEspera(origen: WindowClient, puerto: MessagePort | undefined): Promise<void> {
  const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const sola = ventanas.length === 1 && ventanas[0]?.id === origen.id;
  const enEspera = self.serviceWorker.state === 'installed';
  const aplicada = sola && enEspera;
  puerto?.postMessage(aplicada
    ? { tipo: 'SKIP_WAITING', aplicada }
    : { tipo: 'SKIP_WAITING', aplicada, motivo: enEspera ? 'otras_pestanas' : 'sin_espera' });
  if (aplicada) await self.skipWaiting();
}

async function activar(): Promise<void> {
  const v = await laVersion();
  // Las cachés de versiones anteriores se borran; las del modelo (`siglow-modelo-<sha>`) no se tocan.
  for (const k of await caches.keys()) if (k.startsWith(PREFIJO_APP) && k !== v.cache) await caches.delete(k);
  await self.clients.claim();
  await avisar({ tipo: 'offlineReady' });
}

async function avisar(m: Aviso): Promise<void> {
  for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage(m);
}

function comodin(patron: string): RegExp {
  return new RegExp('^' + patron.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
}

function extension(ruta: string): string {
  if (ruta === '/') return '.html';
  const nombre = ruta.slice(ruta.lastIndexOf('/') + 1);
  const i = nombre.lastIndexOf('.');
  return i > 0 ? nombre.slice(i) : '';
}

async function sha256Hex(datos: BufferSource): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', datos));
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
}

export {};
