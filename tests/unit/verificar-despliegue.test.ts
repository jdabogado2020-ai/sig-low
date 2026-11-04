// T-PV-15 (V-11; 3.6, DoD-19): scripts/verificar-despliegue.mjs. Cada caso arma un «build» sintético en un directorio temporal (los
// archivos de un dist/ con su precache.json y su sw.js), lo sirve con tests/e2e/server.mjs en un puerto libre (el mismo servidor que
// aplica `_headers`, sin red externa) y corre el script como lo corre TI: por la línea de comandos. El caso limpio sale de los archivos
// reales (`public/_headers`), así que un cambio de cabeceras sin su cambio en el script se nota aquí. Solo datos ficticios.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as crearServidorTcp } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { cabecerasPara, parseHeaders } from '../e2e/lib/cabeceras.mjs';

const REPO = resolve('.');
const SCRIPT = join(REPO, 'scripts/verificar-despliegue.mjs');
const SERVIDOR = join(REPO, 'tests/e2e/server.mjs');
const RAIZ = mkdtempSync(join(tmpdir(), 'siglow-verdesp-'));
const hijos: ChildProcess[] = [];
afterAll(() => {
  for (const h of hijos) h.kill();
  rmSync(RAIZ, { recursive: true, force: true });
});

const sha = (d: string | Buffer): string => createHash('sha256').update(d).digest('hex');
let n = 0;

/** Archivos de un build mínimo (ruta de dist → contenido). `precache.json`, `sw.js` y `_headers` los agrega `armar`. */
const ARCHIVOS: Record<string, string | Buffer> = {
  'index.html': '<!doctype html><html lang="es-CO"><head><meta charset="utf-8" /><title>Sig-Low</title><script src="/tt-policy.js"></script></head><body><p>Prueba ficticia</p></body></html>\n',
  'tt-policy.js': 'export {};\n',
  'assets/index-Prueba1.js': 'globalThis.__prueba = 1;\n',
  'assets/detect.worker-Prueba1.js': 'self.onmessage = () => undefined;\n',
  'assets/index-Prueba1.css': 'body { margin: 0 }\n',
  'ort/ort-wasm-simd-threaded.mjs': 'export default 1;\n',
  'ort/ort-wasm-simd-threaded.wasm': Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]),
  'models/gliner-x-large/tokenizer.json': '{"prueba":"ficticio"}\n',
  'models/gliner-x-large/onnx/model_quantized.onnx.part000': Buffer.from('bytes ficticios del modelo'),
  'models/gliner-x-large/onnx/model_quantized.onnx.part001': Buffer.from('otro trozo ficticio'),
};
/** Manifiesto del modelo ficticio (la forma de src/core/ner/manifest.ts, lo que mira --todo), con `cambios` sobre sus archivos. */
function manifiesto(cambios: Record<string, { tamano?: number; sha256?: string }> = {}): string {
  const archivo = (ruta: string): { ruta: string; tamano: number; sha256: string } => {
    const b = ARCHIVOS[`models/gliner-x-large/${ruta}`]!;
    return { ruta, tamano: Buffer.byteLength(b), sha256: sha(b), ...cambios[ruta] };
  };
  const trozos = ['onnx/model_quantized.onnx.part000', 'onnx/model_quantized.onnx.part001'].map(archivo);
  return JSON.stringify({
    formato: 'sig-low/modelo', v: 1, id: 'gliner-x-large', archivo: 'onnx/model_quantized.onnx', tamano: trozos.reduce((s, t) => s + t.tamano, 0),
    sha256: 'c'.repeat(64), trozos, auxiliares: [archivo('tokenizer.json')],
  }, null, 2) + '\n';
}
ARCHIVOS['models/gliner-x-large/manifest.json'] = manifiesto();
/** Lo que no entra al precache pero sí a la lista de la versión (`find`). */
const SW = "self.addEventListener('fetch', () => undefined);\n";

interface Armado { dir: string; archivos: Record<string, string | Buffer> }

/** Escribe un build en un directorio nuevo: los archivos, `sw.js`, `_headers` real y el precache con la huella de cada uno. */
function armar(extra: Record<string, string | Buffer | null> = {}): Armado {
  const dir = join(RAIZ, `dist-${n++}`);
  const archivos: Record<string, string | Buffer> = { ...ARCHIVOS, 'sw.js': SW, '_headers': readFileSync(join(REPO, 'public/_headers'), 'utf8') };
  for (const [r, c] of Object.entries(extra)) { if (c === null) delete archivos[r]; else archivos[r] = c; }
  const enPrecache = Object.keys(archivos).filter((r) => r === 'index.html' || r === 'tt-policy.js' || /^(assets|ort)\//.test(r) || /^models\/[^/]+\/manifest\.json$/.test(r));
  const lista = enPrecache.map((r) => ({ ruta: r === 'index.html' ? '/' : `/${r}`, sha256: sha(archivos[r]!), bytes: Buffer.byteLength(archivos[r]!) }))
    .sort((a, b) => (a.ruta < b.ruta ? -1 : 1));
  archivos['precache.json'] = JSON.stringify({ formato: 1, archivos: lista }, null, 2) + '\n';
  escribir(dir, archivos);
  return { dir, archivos };
}
function escribir(dir: string, archivos: Record<string, string | Buffer>): void {
  for (const [r, c] of Object.entries(archivos)) {
    mkdirSync(dirname(join(dir, r)), { recursive: true });
    writeFileSync(join(dir, r), c);
  }
}
/** Copia un build para servirlo alterado: la referencia sigue siendo el original. */
function copiar(a: Armado): string {
  const dir = join(RAIZ, `servido-${n++}`);
  cpSync(a.dir, dir, { recursive: true });
  return dir;
}
/** SHA256SUMS como las notas de la versión: `find . -type f | sort | xargs sha256sum` sobre el dist (con `_headers`, el modelo y todo). */
function sumas(a: Armado, cambios: Record<string, string | null> = {}): string {
  return Object.keys(a.archivos).sort().filter((r) => cambios[r] !== null).map((r) => `${cambios[r] ?? sha(a.archivos[r]!)}  ./${r}`).join('\n') + '\n';
}

/** tests/e2e/server.mjs sobre `dir`, en un puerto libre. */
function servir(dir: string): Promise<string> {
  const hijo = spawn(process.execPath, [SERVIDOR, '--dir', dir, '--port', '0', '--padre', String(process.pid)], { stdio: ['ignore', 'pipe', 'ignore'] });
  hijos.push(hijo);
  return new Promise((ok, mal) => {
    let visto = '';
    hijo.stdout.on('data', (b: Buffer) => {
      visto += b.toString();
      const m = /listo en (http:\/\/127\.0\.0\.1:\d+)/.exec(visto);
      if (m) ok(m[1]!);
    });
    hijo.once('exit', () => mal(new Error('server.mjs terminó')));
  });
}

interface Salida { codigo: number; texto: string }
function correr(...args: string[]): Promise<Salida> {
  return new Promise((ok) => {
    const hijo = spawn(process.execPath, [SCRIPT, ...args], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    let texto = '';
    hijo.stdout.on('data', (b: Buffer) => { texto += b.toString(); });
    hijo.stderr.on('data', (b: Buffer) => { texto += b.toString(); });
    hijo.on('close', (c) => { ok({ codigo: c ?? -1, texto }); });
  });
}

/** Sirve `servido` y verifica contra la referencia `ref` (el build, o su lista con `lista`). */
async function verificar(ref: Armado, servido: string, opciones: { lista?: string; extra?: string[]; headers?: string } = {}): Promise<Salida> {
  const url = await servir(servido);
  const args = [url];
  if (opciones.lista !== undefined) {
    const f = join(RAIZ, `SHA256SUMS-${n++}`);
    writeFileSync(f, opciones.lista);
    args.push(f);
  } else args.push('--dist', ref.dir);
  if (opciones.headers) args.push('--headers', opciones.headers);
  return correr(...args, ...(opciones.extra ?? []));
}
const sale = (s: Salida, codigo: number, ...textos: (string | RegExp)[]): void => {
  expect(s.codigo, s.texto).toBe(codigo);
  for (const t of textos) { if (typeof t === 'string') expect(s.texto).toContain(t); else expect(s.texto).toMatch(t); }
};
/** Cambia un archivo del build servido. */
const alterar = (dir: string, ruta: string, contenido: string): void => { writeFileSync(join(dir, ruta), contenido); };
/** Cambia `_headers` del servidor (la referencia sigue siendo public/_headers). */
const cabecerasDe = (dir: string, f: (t: string) => string): void => { writeFileSync(join(dir, '_headers'), f(readFileSync(join(dir, '_headers'), 'utf8'))); };

describe.concurrent('T-PV-15 el despliegue limpio pasa, contra el build y contra la lista de la versión', () => {
  it('contra dist/precache.json: sale con 0 y dice cuántos archivos comprobó', async () => {
    const a = armar();
    sale(await verificar(a, copiar(a)), 0, /verificar-despliegue: OK \(\d+ archivos/);
  });

  it('contra SHA256SUMS en el formato de sha256sum (con `_headers` y los trozos del modelo, que no se piden): sale con 0', async () => {
    const a = armar();
    sale(await verificar(a, copiar(a), { lista: sumas(a) }), 0, 'OK');
  });

  it('--todo pide también lo que la lista trae fuera del precache (el trozo del modelo) y sale con 0; no pide `_headers`', async () => {
    const a = armar();
    sale(await verificar(a, copiar(a), { lista: sumas(a), extra: ['--todo'] }), 0, 'OK');
  });

  it('--todo detecta un trozo del modelo alterado que sin --todo no se pide', async () => {
    const a = armar();
    const s = copiar(a);
    alterar(s, 'models/gliner-x-large/onnx/model_quantized.onnx.part000', 'otros bytes');
    sale(await verificar(a, s, { lista: sumas(a) }), 0);
    sale(await verificar(a, s, { lista: sumas(a), extra: ['--todo'] }), 1, 'model_quantized.onnx.part000: SHA-256');
  });
});

describe.concurrent('T-PV-15 cualquier diferencia sale con 1 y dice cuál', () => {
  it('un archivo del precache alterado en el servidor', async () => {
    const a = armar();
    const s = copiar(a);
    alterar(s, 'assets/index-Prueba1.js', 'fetch("https://ejemplo.test/fuga");\n');
    sale(await verificar(a, s), 1, '/assets/index-Prueba1.js: SHA-256', 'FALLA');
  });

  it('el HTML servido distinto del construido', async () => {
    const a = armar();
    const s = copiar(a);
    alterar(s, 'index.html', ARCHIVOS['index.html'] + '<!-- cambiado -->\n');
    const r = await verificar(a, s);
    sale(r, 1, '/: SHA-256', '/index.html: SHA-256');
  });

  it('sw.js distinto: la huella de sw.js se compara aunque no esté en el precache', async () => {
    const a = armar();
    const s = copiar(a);
    alterar(s, 'sw.js', SW + '// otro\n');
    sale(await verificar(a, s), 1, '/sw.js: SHA-256');
  });

  it('un archivo del precache que el servidor no tiene: HTTP 404', async () => {
    const a = armar();
    const s = copiar(a);
    rmSync(join(s, 'assets/detect.worker-Prueba1.js'));
    sale(await verificar(a, s), 1, '/assets/detect.worker-Prueba1.js: HTTP 404');
  });

  it('un archivo de más en el precache publicado (no está en la referencia)', async () => {
    const a = armar();
    const s = copiar(a);
    const extra = 'self.x = 1;\n';
    writeFileSync(join(s, 'assets/extra-Prueba1.js'), extra);
    const lista = JSON.parse(readFileSync(join(s, 'precache.json'), 'utf8')) as { archivos: { ruta: string; sha256: string; bytes: number }[] };
    lista.archivos.push({ ruta: '/assets/extra-Prueba1.js', sha256: sha(extra), bytes: extra.length });
    writeFileSync(join(s, 'precache.json'), JSON.stringify(lista, null, 2) + '\n');
    sale(await verificar(a, s), 1, '/assets/extra-Prueba1.js: está en el precache publicado y no en el build de referencia', '/precache.json: SHA-256');
  });

  it('un archivo de menos en el precache publicado (uno que dejaría de verificarse)', async () => {
    const a = armar();
    const s = copiar(a);
    const lista = JSON.parse(readFileSync(join(s, 'precache.json'), 'utf8')) as { archivos: { ruta: string }[] };
    lista.archivos = lista.archivos.filter((x) => x.ruta !== '/assets/index-Prueba1.js');
    writeFileSync(join(s, 'precache.json'), JSON.stringify(lista, null, 2) + '\n');
    sale(await verificar(a, s), 1, '/assets/index-Prueba1.js: está en la referencia y falta en el precache publicado');
  });

  it('un archivo que declara un tamaño o una huella distintos en el precache publicado', async () => {
    const a = armar();
    const s = copiar(a);
    const lista = JSON.parse(readFileSync(join(s, 'precache.json'), 'utf8')) as { archivos: { ruta: string; bytes: number }[] };
    lista.archivos.find((x) => x.ruta === '/tt-policy.js')!.bytes += 1;
    writeFileSync(join(s, 'precache.json'), JSON.stringify(lista, null, 2) + '\n');
    sale(await verificar(a, s), 1, '/tt-policy.js: ', 'bytes (el precache publicado declara');
  });

  it('la lista de la versión con una huella distinta, o sin un archivo del precache', async () => {
    const a = armar();
    sale(await verificar(a, copiar(a), { lista: sumas(a, { 'assets/index-Prueba1.js': 'a'.repeat(64) }) }), 1, '/assets/index-Prueba1.js: SHA-256');
    sale(await verificar(a, copiar(a), { lista: sumas(a, { 'assets/index-Prueba1.js': null }) }), 1, '/assets/index-Prueba1.js: está en el precache publicado y no en la lista');
    sale(await verificar(a, copiar(a), { lista: sumas(a, { 'sw.js': null }) }), 1, '/sw.js: no figura en la lista');
    sale(await verificar(a, copiar(a), { lista: sumas(a, { 'tt-policy.js': 'b'.repeat(64) }) }), 1, '/tt-policy.js: SHA-256');
  });

  it('una lista con un archivo del precache que el servidor dejó fuera de su precache', async () => {
    const a = armar();
    const s = copiar(a);
    const lista = JSON.parse(readFileSync(join(s, 'precache.json'), 'utf8')) as { archivos: { ruta: string }[] };
    lista.archivos = lista.archivos.filter((x) => x.ruta !== '/ort/ort-wasm-simd-threaded.wasm');
    writeFileSync(join(s, 'precache.json'), JSON.stringify(lista, null, 2) + '\n');
    sale(await verificar(a, s, { lista: sumas(a) }), 1, '/ort/ort-wasm-simd-threaded.wasm: está en la referencia y falta en el precache publicado');
  });

  it('una cabecera de 3.6 distinta (COOP) y otra ausente (CSP)', async () => {
    const a = armar();
    const s = copiar(a);
    cabecerasDe(s, (t) => t.replace('Cross-Origin-Opener-Policy: same-origin', 'Cross-Origin-Opener-Policy: unsafe-none').replace(/ {2}Content-Security-Policy: .*\n/, ''));
    const r = await verificar(a, s);
    sale(r, 1, 'cabecera cross-origin-opener-policy = "unsafe-none" (esperado "same-origin")', 'cabecera content-security-policy = ausente');
  });

  it('Access-Control-Allow-Origin y Set-Cookie que deben faltar', async () => {
    const a = armar();
    const s = copiar(a);
    cabecerasDe(s, (t) => t.replace('  ! Access-Control-Allow-Origin', '  Access-Control-Allow-Origin: *\n  Set-Cookie: a=b'));
    sale(await verificar(a, s), 1, '/: la cabecera access-control-allow-origin debe faltar', '/: la cabecera set-cookie debe faltar');
  });

  it('Cache-Control de /assets/* y tipo MIME del .wasm distintos', async () => {
    const a = armar();
    const s = copiar(a);
    cabecerasDe(s, (t) => t.replace('public, max-age=31536000, immutable', 'public, max-age=60'));
    sale(await verificar(a, s), 1, '/assets/index-Prueba1.js: cabecera cache-control = "public, max-age=60"');
    // el tipo MIME sale de la extensión: un servidor que sirve el .wasm como octet-stream se nota con un servidor de mentira (abajo)
  });

  it('el HTML con /cdn-cgi/ (inyección del alojamiento) aunque su huella coincida con la de la referencia', async () => {
    const a = armar({ 'index.html': ARCHIVOS['index.html'] + '<script src="/cdn-cgi/scripts/x.js"></script>\n' });
    sale(await verificar(a, copiar(a)), 1, '/: el HTML contiene /cdn-cgi/');
  });

  it('un servidor que no responde: sale con 1 y dice que no pudo descargar', async () => {
    const puerto = await new Promise<number>((ok) => {
      const t = crearServidorTcp();
      t.listen(0, '127.0.0.1', () => { const p = (t.address() as { port: number }).port; t.close(() => { ok(p); }); });
    });
    const a = armar();
    sale(await correr(`http://127.0.0.1:${puerto}`, '--dist', a.dir), 1, '/precache.json: no se pudo descargar');
  });

  it('una redirección no se sigue: sale con 1 y dice hacia dónde', async () => {
    const srv = createServer((_q, r) => { r.statusCode = 301; r.setHeader('Location', 'https://ejemplo.test/'); r.end(); });
    await new Promise<void>((ok) => { srv.listen(0, '127.0.0.1', ok); });
    try {
      const a = armar();
      sale(await correr(`http://127.0.0.1:${(srv.address() as { port: number }).port}`, '--dist', a.dir), 1, 'HTTP 301 hacia https://ejemplo.test/');
    } finally { srv.close(); }
  });

  it('un servidor que sirve el .wasm con otro tipo MIME', async () => {
    const a = armar();
    const raiz = join(a.dir);
    const srv = createServer((q, r) => {
      const ruta = new URL(q.url ?? '/', 'http://x').pathname;
      const f = join(raiz, ruta === '/' ? 'index.html' : ruta);
      if (!existsSync(f) || ruta.includes('..')) { r.statusCode = 404; r.end(); return; }
      r.setHeader('Content-Type', ruta.endsWith('.wasm') ? 'application/octet-stream' : ruta.endsWith('.json') ? 'application/json' : ruta.endsWith('.html') || ruta === '/' ? 'text/html' : 'text/javascript');
      for (const l of readFileSync(join(raiz, '_headers'), 'utf8').split('\n')) {
        const m = /^ {2}([A-Za-z-]+): (.*)$/.exec(l);
        if (m && !(m[1] === 'Cache-Control')) r.setHeader(m[1]!, m[2]!);
      }
      r.setHeader('Cache-Control', ruta.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache, no-transform');
      r.end(readFileSync(f));
    });
    await new Promise<void>((ok) => { srv.listen(0, '127.0.0.1', ok); });
    try {
      sale(await correr(`http://127.0.0.1:${(srv.address() as { port: number }).port}`, '--dist', a.dir), 1, 'content-type = "application/octet-stream" (esperado application/wasm)');
    } finally { srv.close(); }
  });
});

/**
 * Servidor como Cloudflare Pages (F0): aplica `_headers` del directorio, pone tipo solo a las extensiones que conoce, responde
 * `/index.html` con `redireccion` (por defecto 308 hacia «/») y, con `sinTipoEnTrozos`, ignora el Content-Type de `_headers` en los
 * trozos (lo que pasaba en producción). Devuelve la dirección y la función que lo apaga.
 */
async function servirComoPages(dir: string, o: { redireccion?: { estado: number; destino: string }; sinTipoEnTrozos?: boolean } = {}): Promise<{ url: string; parar: () => void }> {
  const reglas = parseHeaders(readFileSync(join(dir, '_headers'), 'utf8'));
  const TIPOS: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
  const { estado, destino } = o.redireccion ?? { estado: 308, destino: '/' };
  const srv = createServer((q, r) => {
    const ruta = new URL(q.url ?? '/', 'http://x').pathname;
    for (const [k, v] of cabecerasPara(reglas, ruta)) if (!(o.sinTipoEnTrozos && k === 'Content-Type')) r.setHeader(k, v);
    if (ruta === '/index.html') { r.statusCode = estado; r.setHeader('Location', destino); r.end(); return; }
    const f = join(dir, ruta === '/' ? 'index.html' : ruta);
    if (ruta.includes('..') || !existsSync(f)) { r.statusCode = 404; r.end(); return; }
    const tipo = TIPOS[/\.[a-z0-9]+$/.exec(f)?.[0] ?? ''] ?? (ruta === '/' ? TIPOS['.html'] : undefined);
    if (tipo) r.setHeader('Content-Type', tipo);
    r.end(readFileSync(f));
  });
  await new Promise<void>((ok) => { srv.listen(0, '127.0.0.1', ok); });
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, parar: () => { srv.close(); } };
}

describe.concurrent('F0 · el 308 de /index.html a / (Cloudflare Pages) y --todo contra los manifiestos del modelo', () => {
  it('/index.html con 308 hacia «/» y «/» con los bytes del build: sale con 0 (contra el build y contra la lista)', async () => {
    const a = armar();
    const s = await servirComoPages(a.dir);
    try {
      sale(await correr(s.url, '--dist', a.dir), 0, 'OK');
      const f = join(RAIZ, `SHA256SUMS-${n++}`);
      writeFileSync(f, sumas(a));
      sale(await correr(s.url, f), 0, 'OK');
    } finally { s.parar(); }
  });

  it('el 308 no basta si «/» no sirve los bytes del build, y otra redirección sigue siendo una diferencia', async () => {
    const a = armar();
    const otro = copiar(a);
    alterar(otro, 'index.html', ARCHIVOS['index.html'] + '<!-- cambiado -->\n');
    for (const [dir, o, texto] of [
      [otro, {}, '/: SHA-256'],
      [a.dir, { redireccion: { estado: 301, destino: '/' } }, '/index.html: HTTP 301 hacia /'],
      [a.dir, { redireccion: { estado: 308, destino: 'https://ejemplo.test/' } }, '/index.html: HTTP 308 hacia https://ejemplo.test/'],
      [a.dir, { redireccion: { estado: 308, destino: '/otra' } }, '/index.html: HTTP 308 hacia /otra'],
    ] as const) {
      const s = await servirComoPages(dir, o);
      try { sale(await correr(s.url, '--dist', a.dir), 1, texto); } finally { s.parar(); }
    }
  });

  it('--todo sin lista: los trozos y auxiliares se piden y se comparan con el manifiesto publicado; limpio sale con 0', async () => {
    const a = armar();
    sale(await verificar(a, copiar(a), { extra: ['--todo'] }), 0, /OK \(\d+ archivos/);
  });

  it('--todo: un trozo alterado, otro de distinto tamaño y un auxiliar que falta se ven contra el manifiesto', async () => {
    const a = armar();
    const s = copiar(a);
    alterar(s, 'models/gliner-x-large/onnx/model_quantized.onnx.part000', 'bytes ficticios del modelX');
    alterar(s, 'models/gliner-x-large/onnx/model_quantized.onnx.part001', 'otro trozo ficticio, más largo');
    rmSync(join(s, 'models/gliner-x-large/tokenizer.json'));
    const r = await verificar(a, s, { extra: ['--todo'] });
    sale(r, 1, 'model_quantized.onnx.part000: SHA-256', 'model_quantized.onnx.part001: ', 'bytes (el manifiesto declara', '/models/gliner-x-large/tokenizer.json: HTTP 404');
    sale(await verificar(a, s), 0); // sin --todo no se piden
  });

  it('--todo: un trozo servido sin Content-Type (lo que pasaba en producción) es una diferencia', async () => {
    const a = armar();
    const s = await servirComoPages(a.dir, { sinTipoEnTrozos: true });
    try {
      sale(await correr(s.url, '--dist', a.dir, '--todo'), 1, 'model_quantized.onnx.part000: cabecera content-type = ausente (esperado "application/octet-stream")');
    } finally { s.parar(); }
  });

  it('--todo con lista: un archivo del modelo con otra huella en la lista que en el manifiesto, y un manifiesto no válido', async () => {
    const a = armar();
    sale(await verificar(a, copiar(a), { lista: sumas(a, { 'models/gliner-x-large/onnx/model_quantized.onnx.part001': 'd'.repeat(64) }), extra: ['--todo'] }), 1,
      'part001: la lista de la versión y el manifiesto declaran huellas distintas');
    const roto = armar({ 'models/gliner-x-large/manifest.json': manifiesto({ 'onnx/model_quantized.onnx.part000': { tamano: 0 } }) });
    sale(await verificar(roto, copiar(roto), { extra: ['--todo'] }), 1, 'manifest.json: el manifiesto trae un archivo no válido');
  });
});

describe.concurrent('T-PV-15 los argumentos y la referencia incorrectos salen con 2, sin tocar la red', () => {
  const a = armar();
  it('sin argumentos o con demasiados', async () => {
    sale(await correr(), 2, 'uso:');
    sale(await correr('https://ejemplo.test', 'a', 'b'), 2, 'uso:');
  });
  it('una dirección http que no es local, con usuario, con query o que no es URL', async () => {
    for (const u of ['http://ejemplo.test', 'https://u:p@ejemplo.test', 'https://ejemplo.test/?a=1', 'no es url', 'ftp://ejemplo.test']) sale(await correr(u, '--dist', a.dir), 2);
  });
  it('una opción desconocida o sin valor', async () => {
    sale(await correr('https://ejemplo.test', '--cualquiera'), 2, 'opción desconocida');
    sale(await correr('https://ejemplo.test', '--dist'), 2, 'necesita un valor');
  });
  it('una lista que no existe, vacía o mal formada; --todo sin lista; un dist sin build', async () => {
    sale(await correr('https://ejemplo.test', join(RAIZ, 'no-existe')), 2, 'falta la lista');
    const vacia = join(RAIZ, 'vacia.txt');
    writeFileSync(vacia, '\n');
    sale(await correr('https://ejemplo.test', vacia), 2, 'vacía');
    const mala = join(RAIZ, 'mala.txt');
    writeFileSync(mala, 'esto no es sha256sum\n');
    sale(await correr('https://ejemplo.test', mala), 2, 'formato de sha256sum');
    const insegura = join(RAIZ, 'insegura.txt');
    writeFileSync(insegura, `${'a'.repeat(64)}  ./../fuera.js\n`);
    sale(await correr('https://ejemplo.test', insegura), 2, 'ruta no válida');
    sale(await correr('https://ejemplo.test', '--dist', join(RAIZ, 'sin-build')), 2, 'falta');
  });
});
