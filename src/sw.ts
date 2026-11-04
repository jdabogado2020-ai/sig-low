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
// 4. Modelo (PF-2, 3.3): los trozos NO están en el precache. A pedido de la página (mensajes MODELO_*, con un puerto de respuesta)
//    el SW trae UN archivo del manifiesto por mensaje (cada mensaje es un evento corto, lejos del límite de 5 min del navegador),
//    comprueba su tamaño y SHA-256 y lo guarda en `siglow-modelo-<sha256 del ONNX>`; si no cabe (QuotaExceededError) o no
//    coincide, responde con el código y no guarda nada. Servir el modelo es de solo lectura: tokenizador y
//    `onnx/model_quantized.onnx` salen de esa caché (el ONNX reensamblado trozo a trozo, un trozo en memoria por vez); lo que
//    falta recibe Response.error(), nunca se pide a la red. La lista blanca del modelo sale de los manifiestos del precache.
//    F0: la lectura avisa el avance en bytes y se corta si pasa `SILENCIO_LECTURA_MS` sin un bloque; los reintentos y la
//    reanudación (los archivos ya verificados no se vuelven a pedir) los decide la página (src/core/ner/entrega.ts).
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
  const tipo = (d as { tipo?: unknown }).tipo;
  if (tipo === 'SKIP_WAITING') e.waitUntil(saltarEspera(e.source, e.ports[0]));
  else if (typeof tipo === 'string' && tipo.startsWith('MODELO_') && e.ports[0]) e.waitUntil(atenderModelo(d as Record<string, unknown>, e.ports[0]));
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
  if (ruta === null) {
    const modelo = rutaDelModelo(req);
    return modelo === null ? Response.error() : servirModelo(modelo.id, modelo.rel, v);
  }
  // Caché incompleta (borrada a mano o por el navegador): se vuelve a pedir el archivo de ESTA versión y se sirve solo
  // si su SHA-256 coincide; sin conexión o con otro contenido, Response.error(). No se guarda ni se crea la caché
  // (`caches.match` con cacheName, no `caches.open`): su existencia sigue significando «precache completo» (M-39).
  const r = (await caches.match(ruta, { cacheName: v.cache })) ?? (await traerVerificado(ruta, v));
  if (!r) return Response.error();
  return conCabeceras(r, ruta, v);
}

/** Cabeceras de 3.6 de una ruta, armadas desde cero (V-15): las reglas de `_headers` incrustadas y el tipo por extensión. */
function cabecerasDe(ruta: string, v: Version): Headers {
  const h = new Headers();
  for (const [patron, cabeceras] of v.reglas) if (patron.test(ruta)) for (const [k, valor] of cabeceras) h.set(k, valor);
  h.set('Content-Type', Object.hasOwn(CONFIG.tipos, extension(ruta)) ? (CONFIG.tipos[extension(ruta)] as string) : 'application/octet-stream');
  return h;
}

/** Respuesta servida: el cuerpo guardado con las cabeceras de 3.6 inyectadas al construir (V-15), nunca las guardadas. */
function conCabeceras(r: Response, ruta: string, v: Version): Response {
  return new Response(r.body, { status: 200, statusText: 'OK', headers: cabecerasDe(ruta, v) });
}

/**
 * ÚNICA salida a la red del service worker (B-19; check-dist admite un solo `fetch(` en sw.js). La usan la instalación y el
 * archivo faltante del precache (`cache: 'reload'`) y la descarga del modelo (`cache: 'no-store'`, con `signal`). Nunca se relaja:
 * GET, ruta del propio sitio sin query (la misma forma que la lista), sin credenciales, sin referente y una redirección es un error.
 */
function pedirAlOrigen(ruta: string, cache: 'reload' | 'no-store', signal?: AbortSignal): Promise<Response> {
  if (!RUTA.test(ruta)) throw new TypeError('RUTA');
  return fetch(new URL(ruta, self.location.origin).href, {
    method: 'GET', cache, credentials: 'omit', mode: 'same-origin', redirect: 'error', referrerPolicy: 'no-referrer', ...(signal ? { signal } : {}),
  });
}

/** Pide al propio origen un archivo de la lista y lo devuelve solo si su SHA-256 es el esperado. */
async function traerVerificado(ruta: string, v: Version): Promise<Response | null> {
  if (ruta === RUTA_LISTA) return new Response(v.lista.slice(), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    const r = await pedirAlOrigen(ruta, 'reload');
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

// 4. Modelo ------------------------------------------------------------------------------------------------------------------
// Las formas y regexes repiten las de src/core/ner/manifest.ts (sw.js no puede importar otros chunks); tests/unit/model-manifest.test.ts
// comprueba que son las mismas.
const PREFIJO_MODELO = 'siglow-modelo-';
const ID_MODELO = /^(gliner-x-large|gliner-x-base)$/;
const RUTA_MODELO = /^\/models\/(gliner-x-large|gliner-x-base)\/(tokenizer\.json|tokenizer_config\.json|onnx\/model_quantized\.onnx)$/;
const RUTA_AUXILIAR = /^(tokenizer|tokenizer_config|gliner_config)\.json$/;
const RUTA_TROZO = /^onnx\/model_quantized\.onnx\.part\d{3}$/;
const MAX_TROZO = 8_388_608;   // 8 MiB (F11), igual que src/core/ner/manifest.ts
const ONNX = 'onnx/model_quantized.onnx';

interface ArchivoModelo { ruta: string; tamano: number; sha256: string }
interface ManifiestoSw { id: string; tamano: number; sha256: string; trozos: ArchivoModelo[]; auxiliares: ArchivoModelo[]; crudo: unknown }

const urlDeModelo = (id: string, ruta: string): string => `/models/${id}/${ruta}`;

function archivoValido(x: unknown, patron: RegExp, maximo: number): x is ArchivoModelo {
  const a = x as Partial<ArchivoModelo> | null;
  return typeof a === 'object' && a !== null && typeof a.ruta === 'string' && patron.test(a.ruta) &&
    Number.isInteger(a.tamano) && (a.tamano as number) >= 1 && (a.tamano as number) <= maximo &&
    typeof a.sha256 === 'string' && HEX64.test(a.sha256);
}

/** Manifiesto del modelo desde el precache de ESTA versión (verificado al instalar). Lanza si falta o no es válido. */
async function manifiestoDe(id: string, v: Version): Promise<ManifiestoSw> {
  if (!ID_MODELO.test(id)) throw new TypeError('MODELO');
  const ruta = urlDeModelo(id, 'manifest.json');
  const r = (await caches.match(ruta, { cacheName: v.cache })) ?? (await traerVerificado(ruta, v));
  if (!r) throw new TypeError('MODELO');
  const m = JSON.parse(await r.text()) as { formato?: unknown; v?: unknown; id?: unknown; archivo?: unknown; tamano?: unknown; sha256?: unknown; trozos?: unknown; auxiliares?: unknown };
  const { trozos, auxiliares, tamano, sha256 } = m;
  if (m.formato !== 'sig-low/modelo' || m.v !== 1 || m.id !== id || m.archivo !== ONNX || typeof tamano !== 'number' || !Number.isInteger(tamano) || tamano < 1 ||
      typeof sha256 !== 'string' || !HEX64.test(sha256) || !Array.isArray(trozos) || !Array.isArray(auxiliares) || trozos.length === 0 ||
      !trozos.every((t) => archivoValido(t, RUTA_TROZO, MAX_TROZO)) || !auxiliares.every((a) => archivoValido(a, RUTA_AUXILIAR, Number.MAX_SAFE_INTEGER)) ||
      (trozos as ArchivoModelo[]).reduce((s, t) => s + t.tamano, 0) !== tamano) throw new TypeError('MODELO');
  return { id, tamano, sha256, trozos: trozos as ArchivoModelo[], auxiliares: auxiliares as ArchivoModelo[], crudo: m };
}

const cacheDelModelo = (m: ManifiestoSw): string => PREFIJO_MODELO + m.sha256;

/** Petición de un archivo servible del modelo: GET sin query, del mismo origen y no de navegación. */
function rutaDelModelo(req: Request): { id: string; rel: string } | null {
  if (req.method !== 'GET' || req.mode === 'navigate' || req.url.includes('?')) return null;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.search !== '') return null;
  const p = RUTA_MODELO.exec(url.pathname);
  return p ? { id: p[1] as string, rel: p[2] as string } : null;
}

/** Sirve un archivo del modelo desde su caché. Lo que falta (no descargado, borrado por el navegador) es Response.error(). */
async function servirModelo(id: string, rel: string, v: Version): Promise<Response> {
  const m = await manifiestoDe(id, v);
  const nombre = cacheDelModelo(m);
  if (!(await caches.has(nombre))) return Response.error();
  const cabeceras = cabecerasDe(urlDeModelo(id, rel), v);
  if (rel !== ONNX) {
    const r = await caches.match(urlDeModelo(id, rel), { cacheName: nombre });
    return r ? new Response(r.body, { status: 200, statusText: 'OK', headers: cabeceras }) : Response.error();
  }
  // Reensamblado (3.3): se emite un trozo por vez. Quien recibe escribe en su búfer preasignado de `tamano` bytes; aquí solo
  // hay un trozo en memoria (≤ 8 MiB), sin Blob encadenados ni concatenaciones. El SHA-256 del conjunto lo comprueba
  // quien lo recibe (fetchVerificado) antes de entregarlo a ORT.
  let i = 0;
  const flujo = new ReadableStream<Uint8Array>({
    async pull(c) {
      const t = m.trozos[i];
      if (t === undefined) { c.close(); return; }
      i += 1;
      const r = await caches.match(urlDeModelo(id, t.ruta), { cacheName: nombre });
      if (!r) { c.error(new TypeError('TROZO')); return; }
      c.enqueue(new Uint8Array(await r.arrayBuffer()));
    },
  }, { highWaterMark: 0 });
  return new Response(flujo, { status: 200, statusText: 'OK', headers: cabeceras });
}

let descargaModelo: AbortController | null = null;
let descargaEnCurso: Promise<unknown> | null = null;
/**
 * F0: sin un bloque de bytes en este tiempo (ni la respuesta, ni el siguiente bloque), la descarga del archivo se corta y responde
 * MODELO_NO_DESCARGADO; la página la reintenta. El reloj se reinicia con cada bloque, así que una conexión lenta pero con avance
 * no se corta. El build de medición lo acorta para las E2E de red lenta (`__SIGLOW_MEDICION__`, nunca en dist/).
 */
const SILENCIO_LECTURA_MS = __SIGLOW_MEDICION__ ? 3_000 : 120_000;

type RespuestaModelo = { ok: true; [k: string]: unknown } | { ok: false; code: string; cancelado?: boolean };

/** Código (6.11.7) de una excepción: solo por clase y `name`; el texto de la excepción no sale (F-07). */
function codigoModelo(e: unknown): string {
  if (e instanceof Error && e.name === 'QuotaExceededError') return 'CUOTA_EXCEDIDA';
  if (e instanceof RangeError) return 'MEMORIA';
  return 'MODELO_NO_DESCARGADO';
}

async function atenderModelo(d: Record<string, unknown>, puerto: MessagePort): Promise<void> {
  let r: RespuestaModelo;
  try {
    const v = await laVersion();
    const id = typeof d['id'] === 'string' ? d['id'] : '';
    switch (d['tipo']) {
      case 'MODELO_MANIFIESTO':
        r = { ok: true, manifest: (await manifiestoDe(id, v)).crudo };
        break;
      case 'MODELO_ESTADO': {
        const m = await manifiestoDe(id, v);
        const nombre = cacheDelModelo(m);
        let completo = false;
        if (await caches.has(nombre)) {
          const guardadas = new Set((await (await caches.open(nombre)).keys()).map((q) => new URL(q.url).pathname));
          completo = [...m.auxiliares, ...m.trozos].every((a) => guardadas.has(urlDeModelo(id, a.ruta)));
        }
        r = { ok: true, completo };
        break;
      }
      case 'MODELO_ARCHIVO': {
        const m = await manifiestoDe(id, v);
        const ruta = typeof d['ruta'] === 'string' ? d['ruta'] : '';
        const a = [...m.auxiliares, ...m.trozos].find((x) => x.ruta === ruta);
        if (!a) throw new TypeError('MODELO');
        if (descargaModelo !== null) { r = { ok: false, code: 'ERROR_INTERNO' }; break; }
        const enCurso = descargarArchivo(m, a, puerto);
        descargaEnCurso = enCurso;
        try {
          r = await enCurso;
        } finally {
          if (descargaEnCurso === enCurso) descargaEnCurso = null;
        }
        break;
      }
      case 'MODELO_CANCELAR':
        // Responde cuando la descarga en curso ya soltó su candado: la página puede pedir el siguiente intento enseguida (F0).
        descargaModelo?.abort();
        await descargaEnCurso?.catch(() => undefined);
        r = { ok: true };
        break;
      case 'MODELO_BORRAR': // una caché por modelo (parciales o completa); nunca toca `siglow-app-*`
        await caches.delete(cacheDelModelo(await manifiestoDe(id, v)));
        r = { ok: true };
        break;
      default:
        r = { ok: false, code: 'ENTRADA_INVALIDA' };
    }
  } catch (e) {
    r = { ok: false, code: e instanceof TypeError && e.message === 'MODELO' ? 'ENTRADA_INVALIDA' : codigoModelo(e) };
  }
  puerto.postMessage(r);
}

/** Trae un archivo del manifiesto (GET, sin query, mismo origen), lo comprueba y lo guarda. Uno ya guardado y correcto no se pide. */
async function descargarArchivo(m: ManifiestoSw, a: ArchivoModelo, puerto: MessagePort): Promise<RespuestaModelo> {
  if (descargaModelo !== null) return { ok: false, code: 'ERROR_INTERNO' };
  const control = new AbortController();
  descargaModelo = control;
  try {
    const url = urlDeModelo(m.id, a.ruta);
    const nombre = cacheDelModelo(m);
    const previo = (await caches.has(nombre)) ? await (await caches.open(nombre)).match(url) : undefined;
    if (previo && (await sha256Hex(await previo.arrayBuffer())) === a.sha256) {
      puerto.postMessage({ tipo: 'avance', bytes: a.tamano });
      return { ok: true };
    }
    const bytes = new Uint8Array(a.tamano); // búfer del tamaño declarado: lo que sobre o falte es una alteración
    let escrito = 0;
    // Vigía de silencio (F0): se arma antes de pedir y se rearma con cada bloque recibido.
    let porSilencio = false;
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const vigilar = (): void => {
      clearTimeout(reloj);
      reloj = setTimeout(() => { porSilencio = true; control.abort(); }, SILENCIO_LECTURA_MS);
    };
    try {
      vigilar();
      const res = await pedirAlOrigen(url, 'no-store', control.signal);
      if (res.status !== 200 || res.type !== 'basic' || !res.body) {
        await res.body?.cancel().catch(() => undefined);
        return { ok: false, code: 'MODELO_NO_DESCARGADO' };
      }
      const lector = res.body.getReader();
      let ultimo = 0;
      for (;;) {
        vigilar();
        const { done, value } = await lector.read();
        if (done) break;
        if (escrito + value.byteLength > a.tamano) {
          await lector.cancel().catch(() => undefined);
          return { ok: false, code: 'MODELO_INTEGRIDAD' };
        }
        bytes.set(value, escrito);
        escrito += value.byteLength;
        const t = Date.now();
        if (t - ultimo >= 100) { ultimo = t; puerto.postMessage({ tipo: 'avance', bytes: escrito }); }
      }
    } catch (e) {
      if (control.signal.aborted && !porSilencio) return { ok: false, code: 'ENTRADA_INVALIDA', cancelado: true };
      return { ok: false, code: e instanceof RangeError ? 'MEMORIA' : 'MODELO_NO_DESCARGADO' };
    } finally {
      clearTimeout(reloj);
    }
    if (escrito !== a.tamano || (await sha256Hex(bytes)) !== a.sha256) return { ok: false, code: 'MODELO_INTEGRIDAD' };
    try {
      await (await caches.open(nombre)).put(url, new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } }));
    } catch (e) {
      return { ok: false, code: codigoModelo(e) };
    }
    puerto.postMessage({ tipo: 'avance', bytes: a.tamano });
    return { ok: true };
  } finally {
    descargaModelo = null;
  }
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
