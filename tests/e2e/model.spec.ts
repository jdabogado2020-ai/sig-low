// T-AB-05 (parte PF-1b): el worker `ner` real con ORT-web y GLiNER-X-base, desde /models/ del mismo origen, bajo la CSP y COEP
// de public/_headers. Se compila un arnés (tests/e2e/harness) con las mismas opciones de Vite que la app y se sirve con
// tests/e2e/server.mjs, que aplica _headers. Los modelos se leen de SIGLOW_MODELOS (por defecto ../h0/modelos) y se copian al
// directorio de pruebas (test-results/, fuera de git): nunca se agregan a un commit. Sin los modelos, las pruebas se saltan.
// x-large (≈ 2,1 GB de memoria, candado del modelo) solo corre con SIGLOW_E2E_XLARGE=1.
import { createHash } from 'node:crypto';
import { cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium, expect, test, type Page } from '@playwright/test';
import { build, defaultClientConditions } from 'vite';

import type { ModelManifest } from '../../src/core/types';
import { delModelo, distConModelos, modeloSintetico, rutasDelManifiesto } from './harness/dist-modelo';
import { levantarServidor, type Servidor } from './lib/servidores';

const RAIZ = process.cwd();
const MODELOS = resolve(RAIZ, process.env['SIGLOW_MODELOS'] ?? '../h0/modelos');
const BASE = join(MODELOS, 'gliner-x-base');
const LARGE = join(MODELOS, 'gliner-x-large');
const hayBase = existsSync(join(BASE, 'onnx', 'model_quantized.onnx')) && existsSync(join(BASE, 'tokenizer.json'));
const hayLarge = existsSync(join(LARGE, 'onnx', 'model_quantized.onnx'));
const CARPETA = join(RAIZ, 'test-results', 'ner-harness');
const CANDADO = resolve(RAIZ, process.env['SIGLOW_CANDADO_MODELO'] ?? '../h0/candado-modelo');
let ORIGEN = ''; // lo declara el servidor del arnés (puerto libre) en el beforeAll de la fase que lo usa
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

let servidor: Servidor | null = null;
let manifiestoBase: ModelManifest;
let manifiestoRoto: ModelManifest;

// El arnés compila el worker `ner` real y lo sirve aparte: solo corre con los modelos de h0 (PF-1b). Las pruebas de la entrega
// (PF-2, más abajo) usan un modelo sintético y el build real; no dependen de este bloque.
test.describe('PF-1b · worker ner real con ORT-web (arnés)', () => {
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
      resolve: { conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions] },
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
    servidor = await levantarServidor({ dir: CARPETA, registro: REGISTRO });
    ORIGEN = servidor.origen;
  });

  test.afterAll(async () => {
    await servidor?.parar();
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
    // D-20: todos los hilos lógicos del equipo, entre 4 y 16.
    const hilos = await page.evaluate(() => Math.min(Math.max(Math.floor(navigator.hardwareConcurrency || 4), 4), 16));
    expect(load).toMatchObject({ engineId: 'gliner-x-base', decoder: 'gliner-spans', crossOriginIsolated: true, threads: hilos, modelId: 'gliner-x-base' });
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
    const registro = readFileSync(REGISTRO, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { m: string; u: string }).filter((r) => r.u !== '/'); // (ya no hay sondeo de disponibilidad: el servidor del arnés declara su puerto al estar listo; el filtro de «/» es inocuo)
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
});

// ---------------------------------------------------------------------------
// PF-2 · entrega del modelo en el build real (dist/) con un modelo SINTÉTICO (bytes ficticios, trozos pequeños).
// Cada prueba levanta su propio tests/e2e/server.mjs con el registro de peticiones, que es la referencia (10.5.1).
// T-PV-08 (modelo alterado → integridad y plan B), T-AB-05 (cuota, respaldo, sin conexión) y T-ED-02 (sin WebAssembly).
// ---------------------------------------------------------------------------

const DIST = resolve('dist');
const M_LISTO = 'Modelo de apoyo listo en este equipo.';
const M_31 = 'El modelo descargado no superó la comprobación de integridad y se descartó.';
const M_30 = 'No se pudo preparar el modelo de apoyo.';
const M_169 = 'Este equipo no tiene memoria o espacio suficiente para el modelo de apoyo.';
const M_170 = 'Se está usando la versión reducida del modelo de apoyo.';

test.describe('PF-2 · entrega del modelo en el build real', () => {
  test.describe.configure({ mode: 'default', timeout: 120_000 });
  const GRANDE = modeloSintetico('gliner-x-large', { trozos: 4, tamTrozo: 60_000, semilla: 7 });
  const BASE = modeloSintetico('gliner-x-base', { trozos: 2, tamTrozo: 50_000, semilla: 9 });
  let tmp = '';
  let D_OK = '';
  let D_ALTERADO = '';
  // Respaldo diminuto (≈ 16 kB): tras un QuotaExceededError el navegador libera el espacio de los parciales con retraso, así que el
  // respaldo debe caber en lo que sobra mientras el principal sigue contando (lo que importa es el camino, no los tamaños).
  const BASE_PEQ = modeloSintetico('gliner-x-base', { trozos: 2, tamTrozo: 12_000, semilla: 11 });
  let D_TOK = '';
  let D_PEQ = '';
  let n = 0;
  // Con el tokenizador REAL de x-base (si h0 está disponible) el motor lo lee bien y llega a comprobar el SHA-256 del ONNX reensamblado;
  // sin él, la lectura del tokenizador de mentira falla antes. En los dos casos el resultado es MODELO_INTEGRIDAD (V-44).
  const TOK_REAL = join(MODELOS, 'gliner-x-base', 'tokenizer.json');
  const CFG_REAL = join(MODELOS, 'gliner-x-base', 'tokenizer_config.json');
  const GRANDE_TOK = modeloSintetico('gliner-x-large', {
    trozos: 4, tamTrozo: 60_000, semilla: 7,
    ...(existsSync(TOK_REAL) && existsSync(CFG_REAL) ? { tokenizador: readFileSync(TOK_REAL), config: readFileSync(CFG_REAL) } : {}),
  });

  test.beforeAll(() => {
    if (!existsSync(join(DIST, 'index.html'))) throw new Error('falta dist/: corra `npm run build` (o `npm run verify`)');
    tmp = mkdtempSync(join(tmpdir(), 'siglow-modelo-'));
    D_OK = join(tmp, 'ok');
    D_ALTERADO = join(tmp, 'alterado');
    D_TOK = join(tmp, 'tokenizador');
    D_PEQ = join(tmp, 'pequeno');
    distConModelos(DIST, D_PEQ, [GRANDE, BASE_PEQ]);
    distConModelos(DIST, D_OK, [GRANDE, BASE]);
    distConModelos(DIST, D_TOK, [GRANDE_TOK, BASE]);
    // Despliegue roto o manipulado: el segundo trozo del principal ya no es el que declara el manifiesto (mismo tamaño, un byte distinto).
    distConModelos(DIST, D_ALTERADO, [GRANDE, BASE], (id, ruta, bytes) => {
      if (id !== 'gliner-x-large' || !ruta.endsWith('part001')) return bytes;
      const b = Buffer.from(bytes);
      b[10] = b[10]! ^ 0xff;
      return b;
    });
  });
  test.afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

  async function servir(dir: string): Promise<Servidor> {
    n += 1;
    return levantarServidor({ dir, registro: join(tmp, `peticiones-${n}.jsonl`) });
  }

  /** Observadores de cada prueba: orígenes ajenos, violaciones de CSP (página y workers) y consola. */
  async function observar(page: Page, origen: string): Promise<{ ajenas: string[]; consola: string[]; violaciones: () => Promise<string[]> }> {
    const ajenas: string[] = [];
    const consola: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.origin !== origen && u.protocol !== 'blob:' && u.protocol !== 'data:') ajenas.push(u.origin);
    });
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consola.push(m.type()); });
    page.on('pageerror', () => { consola.push('pageerror'); });
    await page.addInitScript(() => {
      (globalThis as unknown as { __violaciones: string[] }).__violaciones = [];
      addEventListener('securitypolicyviolation', (e) => {
        (globalThis as unknown as { __violaciones: string[] }).__violaciones.push(e.violatedDirective);
      });
      // Un equipo con memoria de sobra: la elección del respaldo por deviceMemory se prueba aparte.
      Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 16, configurable: true });
    });
    return { ajenas, consola, violaciones: () => page.evaluate(() => (globalThis as unknown as { __violaciones: string[] }).__violaciones) };
  }

  const tarjeta = (page: Page) => page.locator('[data-prueba="tarjeta-modelo"]');
  const botonDescargar = (page: Page) => page.getByRole('button', { name: /^Descargar modelo de apoyo/ });

  async function abrirInicio(page: Page, origen: string): Promise<void> {
    await page.goto(`${origen}/`);
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Inicio' })).toBeVisible();
    await expect(botonDescargar(page)).toBeEnabled({ timeout: 20_000 });
  }

  const cachesDelModelo = (page: Page): Promise<Array<{ nombre: string; rutas: string[] }>> =>
    page.evaluate(async () => {
      const salida: Array<{ nombre: string; rutas: string[] }> = [];
      for (const nombre of (await caches.keys()).filter((k) => k.startsWith('siglow-modelo-'))) {
        salida.push({ nombre, rutas: (await (await caches.open(nombre)).keys()).map((r) => new URL(r.url).pathname).sort() });
      }
      return salida;
    });

  /** Crea un asunto sin guardar y llega a Entrada. */
  async function irAEntrada(page: Page): Promise<void> {
    await page.getByLabel('Código del asunto').fill('PRUEBA-MODELO');
    await page.getByRole('radio', { name: /^No guardar la tabla/ }).check();
    await page.getByRole('button', { name: 'Crear asunto' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
  }

  test('T-AB-05 T-PV-08 @cero-red descarga: solo las rutas del manifiesto, caché por modelo, el ONNX reensamblado idéntico y todo sin conexión', async ({ page, context }) => {
    const srv = await servir(D_OK);
    try {
      const obs = await observar(page, srv.origen);
      await abrirInicio(page, srv.origen);
      const corte = srv.peticiones().length;
      await botonDescargar(page).click();
      await expect(tarjeta(page)).toContainText(M_LISTO, { timeout: 60_000 });

      // Peticiones del modelo desde el corte: exactamente los 2 auxiliares y los 4 trozos del manifiesto, GET, sin query, una vez cada una.
      const pedidas = delModelo(srv.peticiones().slice(corte));
      expect(pedidas.every((p) => p.m === 'GET' && !p.u.includes('?'))).toBe(true);
      expect(pedidas.map((p) => p.u).sort()).toEqual(rutasDelManifiesto(GRANDE.manifest));

      // Una caché por modelo, con sus 6 archivos; el respaldo no se descargó; la caché de la app sigue.
      const guardadas = await cachesDelModelo(page);
      expect(guardadas.map((c) => c.nombre)).toEqual([`siglow-modelo-${GRANDE.manifest.sha256}`]);
      expect(guardadas[0]!.rutas).toEqual(rutasDelManifiesto(GRANDE.manifest));
      expect(await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('siglow-app-')).length)).toBe(1);

      // Sin conexión: recarga, el modelo sigue «listo» (se lee de la caché) y el ONNX reensamblado es idéntico bit a bit.
      const antes = srv.peticiones().length;
      await context.setOffline(true);
      await page.reload();
      await page.waitForFunction(() => navigator.serviceWorker?.controller != null);
      await expect(tarjeta(page)).toContainText(M_LISTO, { timeout: 20_000 });
      expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
      const erroresAntes = obs.consola.length;
      const lectura = await page.evaluate(async (id) => {
        const r = await fetch(`/models/${id}/onnx/model_quantized.onnx`);
        const bytes = new Uint8Array(await r.arrayBuffer());
        const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        const tok = await (await fetch(`/models/${id}/tokenizer.json`)).text();
        const rechazadas: string[] = [];
        for (const u of [`/models/${id}/onnx/model_quantized.onnx.part000`, `/models/${id}/onnx/model_quantized.onnx?x=1`, `/models/${id}/gliner_config.json`, `/models/${id}/../../sw.js`]) {
          try { await fetch(u); } catch { rechazadas.push(u); }
        }
        return { estado: r.status, longitud: bytes.length, sha: Array.from(h, (b) => b.toString(16).padStart(2, '0')).join(''), tok, rechazadas, tipo: r.headers.get('content-type'), corp: r.headers.get('cross-origin-resource-policy') };
      }, GRANDE.manifest.id);
      expect(lectura.estado).toBe(200);
      expect(lectura.longitud).toBe(GRANDE.manifest.tamano);
      expect(lectura.sha).toBe(GRANDE.manifest.sha256);
      expect(lectura.tok).toBe(GRANDE.archivos.get('tokenizer.json')!.toString());
      expect(lectura.corp).toBe('same-origin');
      // Los trozos no se sirven a la página, ni con query, ni lo que no está en el manifiesto, ni una ruta con ../ (que el navegador normaliza a /sw.js).
      expect(lectura.rechazadas).toHaveLength(4);
      // Sin conexión nada llega al servidor, salvo GET /sw.js exacto (la búsqueda de versión del navegador: metadato sin contenido, 3.2).
      expect(srv.peticiones().slice(antes).filter((p) => !(p.m === 'GET' && p.u === '/sw.js'))).toEqual([]);
      expect(obs.ajenas).toEqual([]);
      expect(await obs.violaciones()).toEqual([]);
      expect(obs.consola.slice(0, erroresAntes)).toEqual([]); // los 4 errores de carga que siguen son las lecturas rechazadas a propósito
    } finally {
      await context.setOffline(false);
      await srv.parar();
    }
  });

  test('T-PV-08 @cero-red un trozo alterado en el alojamiento → MODELO_INTEGRIDAD (M-31), parciales borrados, sin probar el respaldo y plan B con aviso', async ({ page }) => {
    const srv = await servir(D_ALTERADO);
    try {
      const obs = await observar(page, srv.origen);
      await abrirInicio(page, srv.origen);
      const corte = srv.peticiones().length;
      await botonDescargar(page).click();
      await expect(tarjeta(page).getByRole('alert').filter({ hasText: M_31 })).toBeVisible({ timeout: 60_000 });
      await expect(tarjeta(page)).toContainText(M_30);
      await expect(tarjeta(page)).not.toContainText(M_LISTO);
      expect(await cachesDelModelo(page)).toEqual([]); // los parciales (los 2 auxiliares y el trozo 0, bien) se borraron
      // Pidió hasta el trozo alterado y paró: ni los trozos siguientes ni el respaldo.
      const pedidas = delModelo(srv.peticiones().slice(corte)).map((p) => p.u);
      expect(pedidas.at(-1)).toBe('/models/gliner-x-large/onnx/model_quantized.onnx.part001');
      expect(pedidas.some((u) => u.includes('gliner-x-base') || u.endsWith('part002') || u.endsWith('part003'))).toBe(false);
      // Plan B con aviso: la casilla del modelo está deshabilitada y el análisis sigue con reglas y lista del caso.
      await irAEntrada(page);
      await expect(page.getByRole('checkbox', { name: 'Usar el modelo de apoyo' })).toBeDisabled();
      expect(obs.ajenas).toEqual([]);
      expect(await obs.violaciones()).toEqual([]);
    } finally {
      await srv.parar();
    }
  });

  test('T-PV-08 @cero-red un trozo alterado en la caché después de descargar → el análisis con modelo cae al plan B (fallo_carga) y el modelo alterado se descarta (V-44)', async ({ page }) => {
    const srv = await servir(D_TOK);
    try {
      const obs = await observar(page, srv.origen);
      await abrirInicio(page, srv.origen);
      await botonDescargar(page).click();
      await expect(tarjeta(page)).toContainText(M_LISTO, { timeout: 60_000 });
      // Alteración en el disco del navegador: mismo tamaño, un byte distinto.
      await page.evaluate(async ([nombre, ruta]) => {
        const c = await caches.open(nombre!);
        const r = await c.match(ruta!);
        const b = new Uint8Array(await r!.arrayBuffer());
        b[5] = b[5]! ^ 0xff;
        await c.put(ruta!, new Response(b));
      }, [`siglow-modelo-${GRANDE_TOK.manifest.sha256}`, '/models/gliner-x-large/onnx/model_quantized.onnx.part002']);
      await irAEntrada(page);
      await page.getByRole('textbox', { name: 'Texto del documento' }).fill('El señor Pedro Ejemplo Prueba firmó el contrato con la empresa Ejemplo Ficticia S.A.S.');
      await page.getByRole('checkbox', { name: 'Usar el modelo de apoyo' }).check();
      await page.getByRole('button', { name: 'Analizar', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Revisión' })).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-prueba="banda-plan-b"]')).toContainText('no se pudo preparar', { timeout: 30_000 });
      await expect(page.locator('[data-prueba="banda-plan-b"]')).toContainText('el informe lo dirá');
      // El modelo alterado se descartó (V-44): la caché del modelo ya no existe.
      expect(await cachesDelModelo(page)).toEqual([]);
      expect(obs.ajenas).toEqual([]);
      expect(await obs.violaciones()).toEqual([]);
    } finally {
      await srv.parar();
    }
  });

  test('T-AB-05 @cero-red deviceMemory < 8 → respaldo desde el principio; cuota simulada insuficiente → respaldo; si tampoco cabe → plan B (M-169)', async ({ browser }) => {
    const srv = await servir(D_OK);
    try {
      const escenario = async (memoria: number, cuota: number | null): Promise<{ texto: string; pedidas: string[]; caches: string[] }> => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await observar(page, srv.origen);
        await page.addInitScript(([m, q]) => {
          Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => m, configurable: true });
          if (q !== null) {
            Object.defineProperty(StorageManager.prototype, 'estimate', { value: () => Promise.resolve({ quota: q, usage: 0 }), configurable: true });
          }
        }, [memoria, cuota] as const);
        await abrirInicio(page, srv.origen);
        const corte = srv.peticiones().length;
        await botonDescargar(page).click();
        await expect(tarjeta(page).locator('[role="status"], [role="alert"]').filter({ hasText: /listo en este equipo|no tiene memoria o espacio/ })).toBeVisible({ timeout: 60_000 });
        const texto = (await tarjeta(page).innerText()).replace(/\s+/g, ' ');
        const pedidas = delModelo(srv.peticiones().slice(corte)).map((p) => p.u);
        const guardadas = (await cachesDelModelo(page)).map((c) => c.nombre);
        await ctx.close();
        return { texto, pedidas, caches: guardadas };
      };
      // 4 GB de memoria: el principal no se intenta.
      const a = await escenario(4, null);
      expect(a.texto).toContain(M_LISTO);
      expect(a.texto).toContain(M_170);
      expect(a.pedidas.sort()).toEqual(rutasDelManifiesto(BASE.manifest));
      expect(a.caches).toEqual([`siglow-modelo-${BASE.manifest.sha256}`]);
      // 16 GB pero una cuota que no alcanza para el principal (≈ 280 kB) y sí para el respaldo (≈ 120 kB).
      const b = await escenario(16, 200_000);
      expect(b.texto).toContain(M_LISTO);
      expect(b.texto).toContain(M_170);
      expect(b.pedidas.sort()).toEqual(rutasDelManifiesto(BASE.manifest));
      expect(b.caches).toEqual([`siglow-modelo-${BASE.manifest.sha256}`]);
      // Una cuota que no alcanza ni para el respaldo: nada se descarga y la tarjeta declara el plan B (M-169).
      const c = await escenario(16, 1_000);
      expect(c.texto).toContain(M_169);
      expect(c.texto).not.toContain(M_LISTO);
      expect(c.pedidas).toEqual([]);
      expect(c.caches).toEqual([]);
    } finally {
      await srv.parar();
    }
  });

  test('T-AB-05 @cero-red QuotaExceededError real al guardar (cuota del origen reducida con CDP) → parciales borrados y respaldo; sin espacio ni para él → plan B', async ({ page, context }) => {
    const srv = await servir(D_PEQ);
    try {
      const obs = await observar(page, srv.origen);
      // El navegador dice tener cuota de sobra (estimate), pero la cuota real del origen es la que fija CDP: el fallo es el de cache.put.
      await page.addInitScript(() => {
        const real = StorageManager.prototype.estimate;
        (globalThis as unknown as { __estimateReal: () => Promise<StorageEstimate> }).__estimateReal = () => real.call(navigator.storage);
        Object.defineProperty(StorageManager.prototype, 'estimate', {
          value: () => real.call(navigator.storage).then((e) => ({ quota: 1e12, usage: e.usage ?? 0 })), configurable: true,
        });
      });
      await abrirInicio(page, srv.origen);
      const cdp = await context.newCDPSession(page);
      const uso = await page.evaluate(async () => (await (globalThis as unknown as { __estimateReal: () => Promise<StorageEstimate> }).__estimateReal()).usage ?? 0);
      // Caben el respaldo (≈ 16 kB) y dos trozos del principal (≈ 120 kB de 200 kB), pero no el principal entero.
      await cdp.send('Storage.overrideQuotaForOrigin', { origin: srv.origen, quotaSize: uso + 150_000 });
      const corte = srv.peticiones().length;
      await botonDescargar(page).click();
      await expect(tarjeta(page)).toContainText(/listo en este equipo|no tiene memoria o espacio/, { timeout: 60_000 });
      const pedidas = delModelo(srv.peticiones().slice(corte)).map((p) => p.u);
      expect(pedidas.some((u) => u.startsWith('/models/gliner-x-large/'))).toBe(true); // lo intentó…
      await expect(tarjeta(page)).toContainText(M_LISTO); // …no cupo y siguió con el respaldo
      await expect(tarjeta(page)).toContainText(M_170);
      const guardadas = await cachesDelModelo(page);
      expect(guardadas.map((c) => c.nombre)).toEqual([`siglow-modelo-${BASE_PEQ.manifest.sha256}`]);
      expect(guardadas[0]!.rutas).toEqual(rutasDelManifiesto(BASE_PEQ.manifest));
      expect(obs.ajenas).toEqual([]);
    } finally {
      await srv.parar();
    }
  });

  test('T-ED-02 @cero-red sin WebAssembly (Chromium --jitless): el modelo descargado no se puede ejecutar → BACKEND_NO_DISPONIBLE, plan B con aviso y el modelo guardado se conserva', async () => {
    const srv = await servir(D_OK);
    const navegador = await chromium.launch({ args: ['--js-flags=--jitless'] });
    try {
      const page = await (await navegador.newContext()).newPage();
      const obs = await observar(page, srv.origen);
      await abrirInicio(page, srv.origen);
      expect(await page.evaluate(() => typeof WebAssembly)).toBe('undefined'); // la condición de T-ED-02
      await botonDescargar(page).click();
      await expect(tarjeta(page)).toContainText(M_LISTO, { timeout: 60_000 });
      const corte = srv.peticiones().length;
      await irAEntrada(page);
      await page.getByRole('textbox', { name: 'Texto del documento' }).fill('El señor Pedro Ejemplo Prueba firmó el contrato con la empresa Ejemplo Ficticia S.A.S.');
      await page.getByRole('checkbox', { name: 'Usar el modelo de apoyo' }).check();
      await page.getByRole('button', { name: 'Analizar', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Revisión' })).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-prueba="banda-plan-b"]')).toContainText('no se pudo preparar', { timeout: 30_000 });
      await expect(page.locator('[data-prueba="banda-plan-b"]')).toContainText('el informe lo dirá');
      // No es una falla de integridad: el modelo sigue guardado (con integridad rota se habría descartado) y no hubo más red.
      expect((await cachesDelModelo(page)).map((c) => c.nombre)).toEqual([`siglow-modelo-${GRANDE.manifest.sha256}`]);
      expect(srv.peticiones().slice(corte).filter((p) => p.u.startsWith('/models/'))).toEqual([]);
      expect(obs.ajenas).toEqual([]);
    } finally {
      await navegador.close();
      await srv.parar();
    }
  });
});

// ---------------------------------------------------------------------------
// PF-2 · el modelo REAL de punta a punta en el build de la app (gliner-x-base, 303 MB): descarga por la tarjeta, sin conexión y análisis.
// Solo con SIGLOW_E2E_APP_MODELO=1 (no entra en `verify`). Los trozos salen de `node scripts/trocear-modelo.mjs --id gliner-x-base
// --salida ../h0/trozos` (fuera del repositorio; Playwright vacía test-results/ en cada corrida, por eso no va ahí; SIGLOW_TROZOS cambia la carpeta); los manifiestos son los versionados de public/models, que ya están en dist/.
// x-large (≈ 2,1 GB de memoria) solo con SIGLOW_E2E_XLARGE=1 y bajo el candado del modelo.
// ---------------------------------------------------------------------------
test.describe('PF-2 · modelo real en la app', () => {
  test.describe.configure({ timeout: 900_000 });
  for (const v of [
    { id: 'gliner-x-base' as const, ultimo: 'part012', archivos: 15, mb: '319 MB', memoria: 4, grande: false },
    { id: 'gliner-x-large' as const, ultimo: 'part024', archivos: 27, mb: '626 MB', memoria: 16, grande: true },
  ]) {
  const TROZOS = resolve(process.env['SIGLOW_TROZOS'] ?? '../h0/trozos', v.id);
  const hay = existsSync(join(TROZOS, 'onnx', `model_quantized.onnx.${v.ultimo}`)) && existsSync(join(TROZOS, 'tokenizer.json'));

  test(`T-AB-05 ${v.id}: descarga por la tarjeta, queda disponible SIN CONEXIÓN y el análisis con modelo detecta a una persona escrita en MAYÚSCULAS`, async ({ page, context }) => {
    test.skip(process.env['SIGLOW_E2E_APP_MODELO'] !== '1' || !hay, 'solo con SIGLOW_E2E_APP_MODELO=1 y los trozos de scripts/trocear-modelo.mjs');
    test.skip(v.grande && process.env['SIGLOW_E2E_XLARGE'] !== '1', 'x-large (≈ 2,1 GB de memoria) solo con SIGLOW_E2E_XLARGE=1 y bajo el candado del modelo');
    // El modelo grande se carga una sola vez a la vez en el equipo: candado del modelo (mkdir atómico; si existe, espera).
    if (v.grande) for (;;) { try { mkdirSync(CANDADO); writeFileSync(join(CANDADO, 'quien.txt'), `PF-2 (A7), pid ${process.pid}
`); break; } catch { await new Promise((r) => setTimeout(r, 10_000)); } }
    const tmp = mkdtempSync(join(tmpdir(), 'siglow-real-'));
    const dist = join(tmp, 'dist');
    cpSync(resolve('dist'), dist, { recursive: true });
    mkdirSync(join(dist, 'models', v.id), { recursive: true });
    cpSync(TROZOS, join(dist, 'models', v.id), { recursive: true });
    const srv = await levantarServidor({ dir: dist, registro: join(tmp, 'peticiones.jsonl') });
    try {
      const ajenas: string[] = [];
      const consola: string[] = [];
      page.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== srv.origen && u.protocol !== 'blob:' && u.protocol !== 'data:') ajenas.push(u.origin); });
      page.on('console', (m) => { consola.push(m.text()); });
      page.on('worker', (w) => w.on('console', (m) => consola.push(m.text())));
      await page.addInitScript((m) => {
        (globalThis as unknown as { __violaciones: string[] }).__violaciones = [];
        addEventListener('securitypolicyviolation', (e) => { (globalThis as unknown as { __violaciones: string[] }).__violaciones.push(e.violatedDirective); });
        Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => m, configurable: true }); // 4 GB: el equipo pide el respaldo; 16 GB: el principal
      }, v.memoria);
      await page.goto(`${srv.origen}/`);
      await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, { timeout: 30_000 });
      const tarjeta = page.locator('[data-prueba="tarjeta-modelo"]');
      const boton = page.getByRole('button', { name: /^Descargar modelo de apoyo/ });
      await expect(boton).toBeEnabled({ timeout: 20_000 });
      await expect(boton).toContainText(v.mb);
      const corte = srv.peticiones().length;
      await boton.click();
      await expect(tarjeta).toContainText('Modelo de apoyo listo en este equipo.', { timeout: 300_000 });
      if (!v.grande) await expect(tarjeta).toContainText('versión reducida');
      const pedidas = delModelo(srv.peticiones().slice(corte)).map((p) => p.u).sort();
      const man = JSON.parse(readFileSync(join(dist, 'models', v.id, 'manifest.json'), 'utf8')) as ModelManifest;
      expect(pedidas).toEqual(rutasDelManifiesto(man));
      expect(pedidas).toHaveLength(v.archivos); // trozos y 2 auxiliares

      // Sin conexión: recarga, el modelo sigue listo y el análisis con modelo corre sin una sola petición al servidor.
      await context.setOffline(true);
      const antes = srv.peticiones().length;
      await page.reload();
      await page.waitForFunction(() => navigator.serviceWorker?.controller != null);
      await expect(tarjeta).toContainText('Modelo de apoyo listo en este equipo.', { timeout: 20_000 });
      await page.getByLabel('Código del asunto').fill('PRUEBA-REAL');
      await page.getByRole('radio', { name: /^No guardar la tabla/ }).check();
      await page.getByRole('button', { name: 'Crear asunto' }).click();
      await page.getByRole('button', { name: 'Continuar' }).click();
      await page.getByRole('textbox', { name: 'Texto del documento' }).fill('El señor PEDRO EJEMPLO GÓMEZ, mayor de edad y vecino de Bucaramanga, interpuso acción de tutela contra la EPS Salud Ficticia S.A.S. por la negativa de un procedimiento ordenado por su médico tratante.');
      await page.getByRole('checkbox', { name: 'Usar el modelo de apoyo' }).check();
      await page.getByRole('button', { name: 'Analizar', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Revisión' })).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-prueba="banda-modelo"]')).toHaveAttribute('data-estado', 'terminado', { timeout: 420_000 });
      await expect(page.locator('[data-prueba="banda-modelo"]')).toContainText('terminó de revisar el documento');
      await expect(page.getByRole('region', { name: 'Documento con detecciones' })).toContainText('PEDRO EJEMPLO GÓMEZ');
      // La persona en MAYÚSCULAS no la encuentra ninguna regla: la trae el modelo, como detección pendiente (M-166).
      await expect(page.getByRole('region', { name: 'Documento con detecciones' }).getByRole('button', { name: /^Persona, pendiente.*PEDRO EJEMPLO GÓMEZ/ })).toBeVisible();
      await expect(page.getByRole('status', { name: 'Anuncios de la revisión' })).toContainText('El modelo de apoyo agregó');
      // Salvo GET /sw.js exacto (la búsqueda de versión del navegador, metadato sin contenido: 3.2), nada llegó al servidor.
      expect(srv.peticiones().slice(antes).filter((p) => !(p.m === 'GET' && p.u === '/sw.js'))).toEqual([]);
      expect(ajenas).toEqual([]);
      expect(await page.evaluate(() => (globalThis as unknown as { __violaciones: string[] }).__violaciones)).toEqual([]);
      expect(consola.filter((c) => /PEDRO|EJEMPLO/i.test(c))).toEqual([]);
    } finally {
      await context.setOffline(false);
      await srv.parar();
      rmSync(tmp, { recursive: true, force: true });
      if (v.grande) rmSync(CANDADO, { recursive: true, force: true });
    }
  });
  }
});
