// Servidor de pruebas (10.5.1): sirve dist/ aplicando dist/_headers como Cloudflare Pages.
// Ninguna prueba usa `vite preview`, que no aplica las cabeceras.
// Uso: node tests/e2e/server.mjs [--dir dist] [--port 4173] [--senuelo] [--sin-csp] [--reporte-csp] [--padre <pid>]
//   --port 0      el sistema elige un puerto libre; la línea «listo» dice cuál.
//   --senuelo     modo señuelo (PD-5a): responde 200 a todo con `Access-Control-Allow-Origin: *`, para que una fuga que pase la CSP sea visible.
//   --sin-csp     omite solo la Content-Security-Policy (T-CS-03).
//   --reporte-csp añade `report-uri /csp-report` a cada política (también en las del CSP de un worker, que la ventana no ve) y
//                 recibe los informes en POST /csp-report. Solo en pruebas: producción no lleva report-uri (V-21).
//   --padre pid   se apaga si ese proceso desaparece (una corrida cancelada no deja servidores abiertos).
//   --lento ms, --atascar-una-vez sufijo   red lenta simulada para los trozos del modelo (F0, ver abajo).
// Con SIGLOW_REGISTRO_PETICIONES=<archivo> anota cada petición, una línea JSON: { t, m, u, p, q, b, c?, h }.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync, appendFileSync, statSync } from 'node:fs';
import { join, extname, resolve, normalize, sep } from 'node:path';

import { cabecerasPara, conReporteCsp, parseHeaders } from './lib/cabeceras.mjs';

export { cabecerasPara, parseHeaders };

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const marca = (n) => process.argv.includes(n);
const DIR = resolve(arg('--dir', process.env.SIGLOW_DIST ?? 'dist'));
const PORT = Number(arg('--port', process.env.PORT ?? 4173));
const REGISTRO = process.env.SIGLOW_REGISTRO_PETICIONES; // archivo donde se anota cada petición (PD-5a)
const SENUELO = marca('--senuelo');
const SIN_CSP = marca('--sin-csp');
const REPORTE_CSP = marca('--reporte-csp');
const PADRE = Number(arg('--padre', '0'));
const MAX_CUERPO = 64 * 1024; // del cuerpo se anota hasta aquí (los bytes se cuentan completos)
// Red lenta simulada para la descarga del modelo (F0; solo pruebas): `--lento <ms>` envía cada archivo de /models/*/onnx/ en
// bloques de 4 KiB con esa pausa entre bloques (avance continuo); `--atascar-una-vez <sufijo>` hace que el PRIMER GET de la ruta
// que termina así envíe un bloque y se quede callado con la conexión abierta (los siguientes, normales).
const LENTO_MS = Number(arg('--lento', '0'));
const ATASCAR = arg('--atascar-una-vez', '');
const BLOQUE_LENTO = 4096;
const atascadas = new Set();
const TROZO_DEL_MODELO = /^\/models\/[^/]+\/onnx\//;

function enviarPorBloques(res, datos, atascar) {
  let i = 0;
  const paso = () => {
    if (res.destroyed) return;
    if (i >= datos.length) { res.end(); return; }
    res.write(datos.subarray(i, i + BLOQUE_LENTO));
    i += BLOQUE_LENTO;
    if (atascar) return; // callado: el cliente decide cuándo cortar
    setTimeout(paso, LENTO_MS);
  };
  paso();
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

// `_headers` se vuelve a leer solo si cambió (varias pruebas lo reescriben antes de servir); leerlo en cada petición lo hacía lento bajo carga.
let cache = { mtime: -1, reglas: [] };
const reglas = () => {
  const f = join(DIR, '_headers');
  if (!existsSync(f)) return [];
  const m = statSync(f).mtimeMs;
  if (m !== cache.mtime) cache = { mtime: m, reglas: parseHeaders(readFileSync(f, 'utf8')) };
  return cache.reglas;
};

const CABECERAS_DE_ORIGEN = ['host', 'origin', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'content-type'];

/** Anota la petición: ruta, query, bytes y texto del cuerpo y las cabeceras que dicen de dónde viene. */
function anotar(req, url, cuerpo) {
  if (!REGISTRO) return;
  const h = {};
  for (const k of CABECERAS_DE_ORIGEN) if (typeof req.headers[k] === 'string') h[k] = req.headers[k];
  const linea = { t: Date.now(), m: req.method, u: url.pathname + url.search, p: url.pathname, q: url.search.slice(1), b: cuerpo.bytes, h };
  if (cuerpo.bytes > 0) linea.c = cuerpo.texto;
  appendFileSync(REGISTRO, JSON.stringify(linea) + '\n');
}

/** Lee el cuerpo entero (cuenta los bytes y guarda el principio). Sin cuerpo (GET típico) responde de inmediato. */
function leerCuerpo(req) {
  const conCuerpo = req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] ?? 0) > 0;
  if (!conCuerpo) return Promise.resolve({ bytes: 0, texto: '' });
  return new Promise((ok) => {
    let bytes = 0;
    const trozos = [];
    req.on('data', (b) => { bytes += b.length; if (bytes - b.length < MAX_CUERPO) trozos.push(b.subarray(0, MAX_CUERPO - (bytes - b.length))); });
    req.on('end', () => ok({ bytes, texto: Buffer.concat(trozos).toString('utf8') }));
    req.on('error', () => ok({ bytes, texto: Buffer.concat(trozos).toString('utf8') }));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const cuerpo = await leerCuerpo(req);
  anotar(req, url, cuerpo);

  if (SENUELO) {
    res.statusCode = 200;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end(req.method === 'HEAD' ? undefined : 'ok');
  }

  if (REPORTE_CSP && req.method === 'POST' && url.pathname === '/csp-report') { res.statusCode = 204; return res.end(); }

  let ruta = decodeURIComponent(url.pathname);
  if (ruta.endsWith('/')) ruta += 'index.html';
  const archivo = normalize(join(DIR, ruta));
  const h = cabecerasPara(reglas(), url.pathname);
  for (const [k, v] of h) {
    if (SIN_CSP && k.toLowerCase() === 'content-security-policy') continue;
    res.setHeader(k, REPORTE_CSP && k.toLowerCase() === 'content-security-policy' ? conReporteCsp(v) : v);
  }
  if (!archivo.startsWith(DIR + sep) || req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 404; return res.end(); }
  try {
    const s = await stat(archivo);
    if (!s.isFile()) throw new Error('no');
    // Como Cloudflare Pages: una extensión que no conoce sale sin tipo, salvo que `_headers` lo ponga (los trozos del modelo, F0).
    const tipo = MIME[extname(archivo)];
    if (tipo !== undefined) res.setHeader('Content-Type', tipo);
    res.setHeader('Content-Length', s.size);
    if (req.method === 'GET' && TROZO_DEL_MODELO.test(url.pathname) && (LENTO_MS > 0 || ATASCAR !== '')) {
      const atascar = ATASCAR !== '' && url.pathname.endsWith(ATASCAR) && !atascadas.has(url.pathname);
      if (atascar) atascadas.add(url.pathname);
      return enviarPorBloques(res, await readFile(archivo), atascar);
    }
    res.end(req.method === 'HEAD' ? undefined : await readFile(archivo));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});

// Conexiones persistentes: con el valor por defecto de Node (5 s) el servidor cierra una conexión ociosa justo cuando el cliente
// (el APIRequestContext de Playwright) la reutiliza, y bajo carga eso es `ECONNRESET`.
server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;

if (import.meta.main) {
  server.listen(PORT, '127.0.0.1', () => {
    const { port } = server.address();
    process.stdout.write(`server.mjs listo en http://127.0.0.1:${port} (${DIR})\n`);
  });
  if (PADRE > 0) {
    setInterval(() => { try { process.kill(PADRE, 0); } catch { process.exit(0); } }, 2000).unref();
  }
}
