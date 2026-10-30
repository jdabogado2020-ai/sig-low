// T-AB-05 (parte PF-1b): el worker `ner` real con ORT-web y GLiNER-X-base, desde /models/ del mismo origen, bajo la CSP y COEP
// de public/_headers. Se compila un arnés (tests/e2e/harness) con las mismas opciones de Vite que la app y se sirve con
// tests/e2e/server.mjs, que aplica _headers. Los modelos se leen de SIGLOW_MODELOS (por defecto ../h0/modelos) y se copian al
// directorio de pruebas (test-results/, fuera de git): nunca se agregan a un commit. Sin los modelos, las pruebas se saltan.
// x-large (≈ 2,1 GB de memoria, candado del modelo) solo corre con SIGLOW_E2E_XLARGE=1.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';

import type { ModelManifest } from '../../src/core/types';

const RAIZ = process.cwd();
const MODELOS = resolve(RAIZ, process.env['SIGLOW_MODELOS'] ?? '../h0/modelos');
const BASE = join(MODELOS, 'gliner-x-base');
const LARGE = join(MODELOS, 'gliner-x-large');
const hayBase = existsSync(join(BASE, 'onnx', 'model_quantized.onnx')) && existsSync(join(BASE, 'tokenizer.json'));
const hayLarge = existsSync(join(LARGE, 'onnx', 'model_quantized.onnx'));
const CARPETA = join(RAIZ, 'test-results', 'ner-harness');
const CANDADO = resolve(RAIZ, process.env['SIGLOW_CANDADO_MODELO'] ?? '../h0/candado-modelo');
const PUERTO = Number(process.env['PORT'] ?? 4173) + 5;
const ORIGEN = `http://127.0.0.1:${PUERTO}`;
const REGISTRO = join(CARPETA, 'peticiones.jsonl');

const sha256Archivo = (ruta: string): Promise<string> =>
  new Promise((ok, mal) => {
    const h = createHash('sha256');
    createReadStream(ruta).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', mal);
  });

async function manifiestoDe(carpeta: string, id: ModelManifest['id'], base: ModelManifest['base']): Promise<ModelManifest> {
  const info = async (ruta: string): Promise<{ ruta: string; tamano: number; sha256: string }> => ({
    ruta, tamano: statSync(join(carpeta, ruta)).size, sha256: await sha256Archivo(join(carpeta, ruta)),
  });
  const onnx = await info('onnx/model_quantized.onnx');
  return {
    formato: 'sig-low/modelo', v: 1, id, origen: 'prueba', familia: 'gliner', base, cuantizacion: 'q8',
    etiquetas: ['person', 'organization', 'location'], umbral: 0.3, ventanaTokens: 512, solapePalabras: 37, maxTramoPalabras: 12,
    tokenizador: { prefijo: 0, sufijo: 1, cls: false },
    archivo: 'onnx/model_quantized.onnx', tamano: onnx.tamano, sha256: onnx.sha256, trozos: [],
    auxiliares: [await info('tokenizer.json') as never, await info('tokenizer_config.json') as never, await info('gliner_config.json') as never],
    licencia: 'Apache-2.0', memoria: { wasmMb: 0, jsMb: 0, minimoDispositivoGb: 8 },
  };
}

function copiarModelo(origen: string, destino: string, truncarOnnx?: number): void {
  mkdirSync(join(destino, 'onnx'), { recursive: true });
  for (const a of ['tokenizer.json', 'tokenizer_config.json', 'gliner_config.json']) cpSync(join(origen, a), join(destino, a));
  const onnx = join(origen, 'onnx', 'model_quantized.onnx');
  if (truncarOnnx === undefined) cpSync(onnx, join(destino, 'onnx', 'model_quantized.onnx'));
  else {
    const fd = openSync(onnx, 'r');
    const buf = Buffer.alloc(truncarOnnx);
    readSync(fd, buf, 0, truncarOnnx, 0);
    closeSync(fd);
    writeFileSync(join(destino, 'onnx', 'model_quantized.onnx'), buf);
  }
}

let servidor: ChildProcess | null = null;
let manifiestoBase: ModelManifest;
let manifiestoRoto: ModelManifest;

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

test.beforeAll(async () => {
  if (!hayBase) return;
  rmSync(CARPETA, { recursive: true, force: true });
  mkdirSync(CARPETA, { recursive: true });
  await build({
    configFile: false,
    root: join(RAIZ, 'tests/e2e/harness'),
    publicDir: join(RAIZ, 'public'),
    logLevel: 'silent',
    cacheDir: join(RAIZ, '.vite-cache'),
    define: { __SIGLOW_VERSION__: '"prueba"', __SIGLOW_MEDICION__: 'false' },
    build: {
      outDir: CARPETA, emptyOutDir: false, target: 'es2024', assetsInlineLimit: 0, sourcemap: false,
      modulePreload: { polyfill: false }, reportCompressedSize: false,
      rolldownOptions: { input: { ner: join(RAIZ, 'tests/e2e/harness/ner.html') }, output: { minify: { compress: { dropConsole: true, dropDebugger: true } } } },
    },
    worker: { format: 'es', rolldownOptions: { output: { minify: { compress: { dropConsole: true, dropDebugger: true } } } } },
  });
  // «Roto»: el mismo tokenizador y un ONNX truncado, con el sha256 de lo que se sirve (el manifiesto no lo delata).
  copiarModelo(BASE, join(CARPETA, 'models', 'gliner-x-base'));
  copiarModelo(BASE, join(CARPETA, 'models', 'gliner-x-large'), 4 * 1024 * 1024);
  manifiestoBase = await manifiestoDe(join(CARPETA, 'models', 'gliner-x-base'), 'gliner-x-base', 'google/mt5-base');
  manifiestoRoto = await manifiestoDe(join(CARPETA, 'models', 'gliner-x-large'), 'gliner-x-large', 'google/mt5-large');
  servidor = spawn(process.execPath, ['tests/e2e/server.mjs', '--dir', CARPETA, '--port', String(PUERTO)], {
    env: { ...process.env, SIGLOW_REGISTRO_PETICIONES: REGISTRO }, stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${ORIGEN}/`)).status) break; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
});

test.afterAll(() => {
  servidor?.kill();
});

type Msg = { reqId: string; kind: string; [k: string]: any };

async function abrir(page: Page): Promise<{ ajenas: string[]; consola: string[] }> {
  const ajenas: string[] = [];
  const consola: string[] = [];
  page.on('request', (r) => { if (new URL(r.url()).origin !== ORIGEN) ajenas.push(r.url()); });
  page.on('console', (m) => consola.push(m.text()));
  page.on('pageerror', (e) => consola.push(String(e.message)));
  page.on('worker', (w) => w.on('console', (m) => consola.push(m.text())));
  await page.addInitScript(() => {
    (globalThis as any).__violaciones = [];
    addEventListener('securitypolicyviolation', (e) => (globalThis as any).__violaciones.push(e.violatedDirective));
  });
  await page.goto(`${ORIGEN}/ner.html`);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  return { ajenas, consola };
}

const pedir = (page: Page, peticion: Msg, alVer?: string): Promise<Msg[]> =>
  page.evaluate(([p, v]) => (globalThis as any).__ner.pedir(p, v), [peticion, alVer] as const);

const TEXTO = 'El señor PEDRO EJEMPLO GÓMEZ, mayor de edad y vecino de Bucaramanga, interpuso acción de tutela contra la EPS Salud Ficticia S.A.S. por la negativa de un procedimiento ordenado por su médico tratante.';
const OPCIONES = { windowTokens: 512, overlapWords: 37, maxSpanWords: 12, threshold: 0.3, labels: ['person', 'organization', 'location'], threads: 4 };

test('x-base carga desde /models/ con 0 peticiones a otros orígenes y 0 violaciones de CSP, y detecta por ventanas', async ({ page }) => {
  test.skip(!hayBase, 'faltan los modelos de h0/modelos');
  const { ajenas, consola } = await abrir(page);
  const carga = await pedir(page, { v: 1, reqId: 'carga-1', kind: 'cargar', payload: { manifest: manifiestoBase } });
  const final = carga.at(-1)!;
  expect(final.kind, JSON.stringify(final)).toBe('resultado');
  expect(final['payload'].kind).toBe('cargar');
  const load = final['payload'].load;
  expect(load).toMatchObject({ engineId: 'gliner-x-base', decoder: 'gliner-spans', crossOriginIsolated: true, threads: 4, modelId: 'gliner-x-base' });
  expect(load.warmupWindowMs).toBeGreaterThan(0);
  expect(carga.some((m) => m.kind === 'progreso' && m['stage'] === 'modelo_carga' && m['unit'] === 'bytes')).toBe(true);

  const partId = 'parte_00000000000000000000000000000001';
  const det = await pedir(page, { v: 1, reqId: 'det-1', kind: 'detectar', payload: { parts: [{ partId, text: TEXTO }, { partId: 'parte_00000000000000000000000000000002', text: '' }], options: OPCIONES } });
  expect(det.at(-1)).toMatchObject({ kind: 'resultado', payload: { kind: 'detectar', windows: 1 } });
  const parciales = det.filter((m) => m.kind === 'parcial');
  expect(parciales).toHaveLength(1);
  const w = parciales[0]!['payload'].window;
  expect(w.partId).toBe(partId);
  const hallados = w.spans.map((s: any) => [s.label, TEXTO.slice(s.start, s.end)]);
  expect(hallados).toContainEqual(['PER', 'PEDRO EJEMPLO GÓMEZ']);
  expect(hallados).toContainEqual(['LOC', 'Bucaramanga']);
  // INV-W07: ni parcial ni progreso llevan texto; el parcial solo trae partId, posiciones, etiquetas y puntajes
  expect(JSON.stringify(det)).not.toContain('PEDRO');
  expect(Object.keys(parciales[0]!['payload']).sort()).toEqual(['window', 'windowsDone', 'windowsTotal']);
  expect(Object.keys(w).sort()).toEqual(['ms', 'partId', 'spans', 'windowIndex', 'windowTotal']);
  for (const s of w.spans) expect(Object.keys(s).sort()).toEqual(['end', 'label', 'score', 'start']);

  // cero red: todo al mismo origen, solo rutas del build y del modelo, sin query
  const registro = readFileSync(REGISTRO, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { m: string; u: string }).filter((r) => r.u !== '/'); // «/» es el sondeo de disponibilidad del propio servidor
  for (const r of registro) {
    expect(r.m).toBe('GET');
    expect(r.u, r.u).toMatch(/^\/(ner\.html|tt-policy\.js|assets\/[\w.-]+|ort\/ort-wasm-simd-threaded\.(mjs|wasm)|models\/gliner-x-base\/(tokenizer\.json|tokenizer_config\.json|gliner_config\.json|onnx\/model_quantized\.onnx))$/);
  }
  expect(registro.some((r) => r.u.startsWith('/ort/ort-wasm-simd-threaded.wasm'))).toBe(true);
  expect(ajenas).toEqual([]);
  expect(consola.filter((t) => /Content Security Policy|Refused|violat/i.test(t))).toEqual([]);
  expect(await page.evaluate(() => (globalThis as any).__violaciones)).toEqual([]);
  // INV-W02: nada del documento llega a la consola
  expect(consola.join('\n')).not.toContain('PEDRO');
});

test('cancelar entre ventanas responde cancelado, sin más parcial, y el motor sigue vivo (INV-W08)', async ({ page }) => {
  test.skip(!hayBase, 'faltan los modelos de h0/modelos');
  await abrir(page);
  const carga = await pedir(page, { v: 1, reqId: 'carga-2', kind: 'cargar', payload: { manifest: manifiestoBase } });
  expect(carga.at(-1)!.kind).toBe('resultado');
  const largo = Array.from({ length: 24 }, () => TEXTO).join(' ');
  const partId = 'parte_00000000000000000000000000000003';
  const det = await pedir(page, { v: 1, reqId: 'det-2', kind: 'detectar', payload: { parts: [{ partId, text: largo }], options: OPCIONES } }, 'parcial');
  expect(det.at(-1)!.kind).toBe('cancelado');
  const total = det.find((m) => m.kind === 'progreso')!['total'];
  expect(total).toBeGreaterThanOrEqual(3);
  expect(det.filter((m) => m.kind === 'parcial').length).toBeLessThan(total);
  expect(det.some((m) => m.kind === 'resultado')).toBe(false);
  // Sigue disponible tras cancelar
  const otra = await pedir(page, { v: 1, reqId: 'det-3', kind: 'detectar', payload: { parts: [{ partId, text: TEXTO }], options: OPCIONES } });
  expect(otra.at(-1)).toMatchObject({ kind: 'resultado', payload: { kind: 'detectar', windows: 1 } });
  const liberar = await pedir(page, { v: 1, reqId: 'lib-1', kind: 'liberar', payload: {} });
  expect(liberar.at(-1)).toMatchObject({ kind: 'resultado', payload: { kind: 'liberar' } });
  const sin = await pedir(page, { v: 1, reqId: 'det-4', kind: 'detectar', payload: { parts: [{ partId, text: TEXTO }], options: OPCIONES } });
  expect(sin.at(-1)).toEqual({ v: 1, reqId: 'det-4', kind: 'error', code: 'MODELO_NO_DESCARGADO', retryable: true });
});

test('un modelo alterado o roto falla con un código de error y sin texto (INV-W01, V-44)', async ({ page }) => {
  test.skip(!hayBase, 'faltan los modelos de h0/modelos');
  await abrir(page);
  const forma = { v: 1, kind: 'error', retryable: false };
  // sha256 distinto del archivo servido
  const alterado = { ...manifiestoBase, sha256: '0'.repeat(64) };
  const a = await pedir(page, { v: 1, reqId: 'rota-1', kind: 'cargar', payload: { manifest: alterado } });
  expect(a.at(-1)).toEqual({ ...forma, reqId: 'rota-1', code: 'MODELO_INTEGRIDAD' });
  // tokenizador alterado
  const aux = manifiestoBase.auxiliares.map((x) => (x.ruta === 'tokenizer.json' ? { ...x, sha256: 'f'.repeat(64) } : x));
  const b = await pedir(page, { v: 1, reqId: 'rota-2', kind: 'cargar', payload: { manifest: { ...manifiestoBase, auxiliares: aux } } });
  expect(b.at(-1)).toEqual({ ...forma, reqId: 'rota-2', code: 'MODELO_INTEGRIDAD' });
  // ONNX truncado con el sha256 correcto de lo servido: no crea sesión
  const c = await pedir(page, { v: 1, reqId: 'rota-3', kind: 'cargar', payload: { manifest: manifiestoRoto } });
  expect(c.at(-1)).toEqual({ ...forma, reqId: 'rota-3', code: 'MODELO_INTEGRIDAD' });
  // mensaje malformado
  const d = await pedir(page, { v: 1, reqId: 'rota-4', kind: 'cargar', payload: { manifest: { formato: 'otro' } } });
  expect(d.at(-1)).toEqual({ ...forma, reqId: 'rota-4', code: 'ENTRADA_INVALIDA' });
});

test('x-large carga y su humo devuelve al menos 8 entidades', async ({ page }) => {
  test.skip(!hayLarge || process.env['SIGLOW_E2E_XLARGE'] !== '1', 'x-large solo con SIGLOW_E2E_XLARGE=1 y bajo el candado del modelo');
  // Candado del modelo: mkdir atómico; si existe, espera.
  for (;;) {
    try { mkdirSync(CANDADO); break; } catch { await new Promise((r) => setTimeout(r, 5000)); }
  }
  try {
    const dir = join(CARPETA, 'models', 'gliner-x-large');
    rmSync(dir, { recursive: true, force: true });
    copiarModelo(LARGE, dir);
    const manifiesto = await manifiestoDe(dir, 'gliner-x-large', 'google/mt5-large');
    await abrir(page);
    const carga = await pedir(page, { v: 1, reqId: 'xl-1', kind: 'cargar', payload: { manifest: manifiesto } });
    const final = carga.at(-1)!;
    expect(final.kind, JSON.stringify(final)).toBe('resultado');
    expect(final['payload'].load).toMatchObject({ engineId: 'gliner-x-large', decoder: 'gliner-spans', threads: 4 });
    const det = await pedir(page, { v: 1, reqId: 'xl-2', kind: 'detectar', payload: { parts: [{ partId: 'parte_00000000000000000000000000000009', text: TEXTO }], options: OPCIONES } });
    const spans = det.filter((m) => m.kind === 'parcial').flatMap((m) => m['payload'].window.spans);
    expect(spans.length).toBeGreaterThanOrEqual(3);
  } finally {
    rmSync(CANDADO, { recursive: true, force: true });
  }
});

