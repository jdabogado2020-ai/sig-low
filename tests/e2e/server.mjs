// Servidor de pruebas (10.5.1): sirve dist/ aplicando dist/_headers como Cloudflare Pages.
// Ninguna prueba usa `vite preview`, que no aplica las cabeceras. Uso: node tests/e2e/server.mjs [--dir dist] [--port 4173]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join, extname, resolve, normalize, sep } from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const DIR = resolve(arg('--dir', process.env.SIGLOW_DIST ?? 'dist'));
const PORT = Number(arg('--port', process.env.PORT ?? 4173));
const REGISTRO = process.env.SIGLOW_REGISTRO_PETICIONES; // archivo donde se anota cada petición (PD-5a)

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

/** Lee el formato _headers de Cloudflare Pages: una ruta (con * como comodín) y cabeceras indentadas. */
export function parseHeaders(texto) {
  const reglas = [];
  let actual = null;
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.trim() || linea.trim().startsWith('#')) continue;
    if (!/^\s/.test(linea)) { actual = { patron: linea.trim(), cabeceras: [] }; reglas.push(actual); continue; }
    const i = linea.indexOf(':');
    if (actual && i > 0) actual.cabeceras.push([linea.slice(0, i).trim(), linea.slice(i + 1).trim()]);
  }
  return reglas;
}
const coincide = (patron, ruta) =>
  new RegExp('^' + patron.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(ruta);

export function cabecerasPara(reglas, ruta) {
  const h = new Map();
  for (const r of reglas) if (coincide(r.patron, ruta)) for (const [k, v] of r.cabeceras) h.set(k, v);
  return h;
}

const reglas = () => { const f = join(DIR, '_headers'); return existsSync(f) ? parseHeaders(readFileSync(f, 'utf8')) : []; };

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (REGISTRO) appendFileSync(REGISTRO, JSON.stringify({ t: Date.now(), m: req.method, u: url.pathname + url.search }) + '\n');
  let ruta = decodeURIComponent(url.pathname);
  if (ruta.endsWith('/')) ruta += 'index.html';
  const archivo = normalize(join(DIR, ruta));
  const h = cabecerasPara(reglas(), url.pathname);
  for (const [k, v] of h) res.setHeader(k, v);
  if (!archivo.startsWith(DIR + sep) || req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 404; return res.end(); }
  try {
    const s = await stat(archivo);
    if (!s.isFile()) throw new Error('no');
    res.setHeader('Content-Type', MIME[extname(archivo)] ?? 'application/octet-stream');
    res.setHeader('Content-Length', s.size);
    res.end(req.method === 'HEAD' ? undefined : await readFile(archivo));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});

if (import.meta.main) {
  server.listen(PORT, '127.0.0.1', () => process.stdout.write(`server.mjs listo en http://127.0.0.1:${PORT} (${DIR})\n`));
}
