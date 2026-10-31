import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { build, defaultClientConditions } from 'vite';

import { construirDocx, decl, p, pt, r, raiz, tipoRel } from '../fixtures/docx/docx-builder';

const sha256 = (t: string): string => createHash('sha256').update(t).digest('hex');

// Fase mínima de P0-1 (10.5.1). PD-5a y PD-5b agregan el servidor que registra, el señuelo, STUN y las fases.
test('@cero-red carga: 0 peticiones a otros orígenes y 0 violaciones de CSP', async ({ page, baseURL }) => {
  const origen = new URL(baseURL!).origin;
  const ajenas: string[] = [];
  page.on('request', (r) => { if (new URL(r.url()).origin !== origen) ajenas.push(new URL(r.url()).origin); });
  await page.addInitScript(() => {
    (globalThis as unknown as { __violaciones: string[] }).__violaciones = [];
    addEventListener('securitypolicyviolation', (e) => {
      (globalThis as unknown as { __violaciones: string[] }).__violaciones.push(e.violatedDirective);
    });
  });
  await page.goto('/');
  await expect(page.locator('[data-prueba="promesa"]')).toBeVisible();
  const violaciones = await page.evaluate(() => (globalThis as unknown as { __violaciones: string[] }).__violaciones);
  expect(ajenas).toEqual([]);
  expect(violaciones).toEqual([]);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  expect(await page.evaluate(() => typeof (globalThis as unknown as Record<string, unknown>)['RTCPeerConnection'])).toBe('undefined');
});

test('@humo Inicio muestra la promesa literal y el título neutro', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-prueba="promesa"]')).toHaveText(
    'Sus documentos no salen de su equipo. La herramienta propone los reemplazos, le muestra lo que puede quedar y usted aprueba antes de copiar.',
  );
  expect(await page.title()).toBe('Sig-Low');
});

// Fase «pegar» (PC-2, 10.5.1): crear asunto, pegar un texto con datos ficticios, analizar y llegar a Revisión.
// 0 peticiones fuera del origen, 0 violaciones de CSP, 0 mensajes de consola y el texto pegado no viaja en ninguna URL ni cuerpo.
test('@cero-red fase pegar: pegar → Procesando → Revisión sin peticiones ajenas, sin violaciones de CSP ni texto en la red', async ({ page, baseURL }) => {
  const origen = new URL(baseURL!).origin;
  const ajenas: string[] = [];
  const peticiones: Array<{ url: string; cuerpo: string }> = [];
  const consola: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin !== origen && u.protocol !== 'blob:' && u.protocol !== 'data:') ajenas.push(u.origin);
    peticiones.push({ url: r.url(), cuerpo: r.postData() ?? '' });
  });
  page.on('console', (m) => { consola.push(m.type()); });
  page.on('pageerror', () => { consola.push('pageerror'); });
  await page.addInitScript(() => {
    (globalThis as unknown as { __violaciones: string[] }).__violaciones = [];
    addEventListener('securitypolicyviolation', (e) => {
      (globalThis as unknown as { __violaciones: string[] }).__violaciones.push(e.violatedDirective);
    });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Inicio' })).toBeVisible();
  await page.getByLabel('Código del asunto').fill('PRUEBA-CERO');
  await page.getByRole('radio', { name: /^No guardar la tabla/ }).check();
  await page.getByRole('button', { name: 'Crear asunto' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  const texto = 'Ana Ficticia Rojas, C.C. 1.000.000.017, vive en la Calle 00 n.º 00-00. Correo: ana.ficticia@ejemplo.test.';
  await page.getByRole('textbox', { name: 'Texto del documento' }).fill(texto);
  await page.getByRole('button', { name: 'Analizar', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Revisión' })).toBeVisible({ timeout: 15_000 });
  const violaciones = await page.evaluate(() => (globalThis as unknown as { __violaciones: string[] }).__violaciones);
  expect(ajenas).toEqual([]);
  expect(violaciones).toEqual([]);
  expect(consola.filter((c) => c === 'error' || c === 'warning' || c === 'pageerror')).toEqual([]);
  for (const p of peticiones) {
    expect(decodeURIComponent(p.url)).not.toContain('Ficticia');
    expect(p.cuerpo).not.toContain('Ficticia');
    expect(p.cuerpo).not.toContain('1.000.000.017');
  }
});

// Fase «docx» (PE-3-r1, B-14; 10.5.1): crear asunto, cargar un .docx ficticio armado con el docx-builder (cuerpo, encabezado,
// comentario con autor, texto eliminado, propiedades y un vínculo externo), analizar y llegar a Revisión. 0 peticiones fuera del
// origen, 0 violaciones de CSP (página y workers, el `io` incluido), 0 mensajes de consola y nada del documento en URL ni cuerpos.
test('@cero-red fase docx: cargar .docx → Procesando → Revisión sin peticiones ajenas, sin violaciones de CSP (página y workers) ni texto en la red', async ({ page, baseURL }) => {
  const origen = new URL(baseURL!).origin;
  const ajenas: string[] = [];
  const fallidas: string[] = [];
  const peticiones: Array<{ url: string; cuerpo: string }> = [];
  const consola: string[] = [];
  const workers: string[] = [];
  page.on('request', (rq) => {
    const u = new URL(rq.url());
    if (u.origin !== origen && u.protocol !== 'blob:' && u.protocol !== 'data:') ajenas.push(u.origin);
    peticiones.push({ url: rq.url(), cuerpo: rq.postData() ?? '' });
  });
  page.on('requestfailed', (rq) => { fallidas.push(new URL(rq.url()).origin); });
  page.on('console', (m) => { consola.push(m.type()); });
  page.on('pageerror', () => { consola.push('pageerror'); });
  page.on('worker', (w) => {
    workers.push(w.url());
    w.on('console', (m) => { consola.push(`worker:${m.type()}`); });
    // Un worker vive poco: su `securitypolicyviolation` se convierte en un mensaje de consola que sí llega aquí.
    w.evaluate(() => {
      addEventListener('securitypolicyviolation', (e) => { console.error(`CSP ${e.violatedDirective}`); });
    }).catch(() => undefined);
  });
  await page.addInitScript(() => {
    (globalThis as unknown as { __violaciones: string[] }).__violaciones = [];
    addEventListener('securitypolicyviolation', (e) => {
      (globalThis as unknown as { __violaciones: string[] }).__violaciones.push(e.violatedDirective);
    });
  });

  const tipoMeta = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';
  const docx = construirDocx({
    cuerpo:
      p(r('Ana Ficticia Rojas, C.C. 1.000.000.017, vive en la Calle 00 n.º 00-00. Correo: ana.ficticia@ejemplo.test.')) +
      pt('Contrato de Prueba entre Ana Ficticia Rojas y Empresa Ejemplo S.A.S., NIT 000.000.000-0.') +
      p('<w:del w:id="1" w:author="Revisor Ficticio" w:date="2020-01-01T00:00:00Z"><w:r><w:delText>Clausula eliminada de Ana Ficticia</w:delText></w:r></w:del>') +
      p('<w:hyperlink r:id="rId99"><w:r><w:t>enlace de prueba</w:t></w:r></w:hyperlink>'),
    extras: [
      { nombre: 'cabecera.xml', tipo: 'header', xml: raiz('hdr', pt('Encabezado de Prueba de Ana Ficticia Rojas')) },
      { nombre: 'comentarios.xml', tipo: 'comments', xml: raiz('comments', `<w:comment w:id="0" w:author="Autora Ejemplo" w:initials="AE" w:date="2020-01-01T00:00:00Z">${pt('Comentario de prueba sobre Ana Ficticia')}</w:comment>`) },
    ],
    relacionesDocumento: `<Relationship Id="rId99" Type="${tipoRel('hyperlink')}" Target="https://ejemplo.test/ficticia" TargetMode="External"/>`,
    relacionesPaquete: `<Relationship Id="rId7" Type="${tipoMeta}" Target="docProps/core.xml"/>`,
    entradas: {
      'docProps/core.xml': `${decl}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Autora Ejemplo</dc:creator></cp:coreProperties>`,
    },
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Inicio' })).toBeVisible();
  await page.getByLabel('Código del asunto').fill('PRUEBA-DOCX');
  await page.getByRole('radio', { name: /^No guardar la tabla/ }).check();
  await page.getByRole('button', { name: 'Crear asunto' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('tab', { name: 'Cargar archivo' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Contrato de Prueba.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(docx),
  });
  await expect(page.locator('[data-prueba="archivo-cargado"]')).toContainText('Archivo cargado: .docx, ', { timeout: 15_000 });
  await expect(page.getByRole('checkbox', { name: /^Encabezado 1 · \d+ caracteres$/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /^Comentario 1 · \d+ caracteres$/ })).toBeChecked();
  await page.getByRole('button', { name: 'Analizar', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Revisión' })).toBeVisible({ timeout: 15_000 });

  const violaciones = await page.evaluate(() => (globalThis as unknown as { __violaciones: string[] }).__violaciones);
  expect(workers.some((u) => /io/.test(new URL(u).pathname))).toBe(true); // la lectura corrió en el worker `io` del mismo origen
  expect(workers.every((u) => new URL(u).origin === origen)).toBe(true);
  expect(ajenas).toEqual([]);
  expect(fallidas).toEqual([]);
  expect(violaciones).toEqual([]);
  expect(consola.filter((c) => c.endsWith('error') || c.endsWith('warning') || c === 'pageerror')).toEqual([]);
  for (const q of peticiones) {
    const url = decodeURIComponent(q.url);
    for (const secreto of ['Ficticia', 'Rojas', '1.000.000.017', 'ejemplo.test', 'Autora Ejemplo', 'Revisor', 'Contrato de Prueba']) {
      expect(url).not.toContain(secreto);
      expect(q.cuerpo).not.toContain(secreto);
    }
  }
});

// Fase del service worker (PD-1, 3.2 y V-15): con conexión el SW instala el precache verificado; sin conexión la app
// sale de la caché con las cabeceras de 3.6 (las de dist/_headers, inyectadas en sw.js al construir).
const TRANSPORTE = new Set(['date', 'connection', 'keep-alive', 'content-length', 'transfer-encoding']);
const OBLIGATORIAS = [
  'content-security-policy', 'cross-origin-opener-policy', 'cross-origin-embedder-policy', 'cross-origin-resource-policy',
  'x-content-type-options', 'referrer-policy', 'content-type',
];
const sinTransporte = (h: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(h).filter(([k]) => !TRANSPORTE.has(k.toLowerCase())).map(([k, v]) => [k.toLowerCase(), v]).sort());

test('T-PV-06 @cero-red INV-G10 sin conexión: crossOriginIsolated y las cabeceras de 3.6 en cada respuesta de la caché', async ({ page, context, request }) => {
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, { timeout: 30_000 });
  const texto = readFileSync('dist/precache.json', 'utf8');
  const lista = (JSON.parse(texto) as { archivos: { ruta: string; sha256: string }[] }).archivos;
  const esperado = new Map([...lista.map((a) => [a.ruta, a.sha256] as const), ['/precache.json', sha256(texto)]]);
  const rutas = [...esperado.keys()].sort();
  // INV-G10: Cache Storage solo guarda la app: una caché `siglow-app-<SHA-256 de precache.json>` con la lista exacta.
  const cachesVistas = await page.evaluate(async () => Promise.all((await caches.keys()).map(async (k) => ({
    k, urls: (await (await caches.open(k)).keys()).map((r) => { const u = new URL(r.url); return u.pathname + u.search; }).sort(),
  }))));
  expect(cachesVistas).toEqual([{ k: `siglow-app-${sha256(texto)}`, urls: rutas }]);
  // Cabeceras del alojamiento con conexión, pedidas por fuera del SW (server.mjs aplica dist/_headers).
  const delServidor = new Map<string, Record<string, string>>();
  for (const r of rutas) {
    const resp = await request.get(r);
    expect(resp.status(), r).toBe(200);
    delServidor.set(r, sinTransporte(resp.headers()));
  }
  await context.setOffline(true);
  try {
    const nav = await page.reload();
    expect(nav?.fromServiceWorker()).toBe(true);
    await expect(page.locator('[data-prueba="promesa"]')).toBeVisible();
    expect(await page.evaluate(() => ({ aislado: crossOriginIsolated, controlador: navigator.serviceWorker.controller !== null })))
      .toEqual({ aislado: true, controlador: true });
    expect(sinTransporte(await nav!.allHeaders())).toEqual(delServidor.get('/'));
    const desdeCache = await page.evaluate(async (rs) => Promise.all(rs.map(async (r) => {
      const resp = await fetch(r);
      const h: Record<string, string> = {};
      resp.headers.forEach((v, k) => { h[k] = v; });
      const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await resp.arrayBuffer()));
      return { r, status: resp.status, h, sha: Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('') };
    })), rutas);
    for (const { r, status, h, sha } of desdeCache) {
      expect({ r, status, sha }).toEqual({ r, status: 200, sha: esperado.get(r) });
      expect(sinTransporte(h), r).toEqual(delServidor.get(r));
      for (const k of OBLIGATORIAS) expect(h[k], `${r}: ${k}`).toBeTruthy();
      if (r.endsWith('.wasm')) expect(h['content-type']).toBe('application/wasm');
      if (r.endsWith('.mjs')) expect(h['content-type']).toBe('text/javascript');
    }
  } finally {
    await context.setOffline(false);
  }
});

// Fase «pdf» (PE-4-r1, M-3; 10.5.1): se compila un arnés (tests/e2e/harness/pdf.ts) que usa readPdf con la configuración de la
// app y las mismas opciones de Vite, se sirve con server.mjs (que aplica public/_headers: CSP, Trusted Types, COEP) y se leen
// los PDF de tests/fixtures/. Exige 0 peticiones a otros orígenes, 0 violaciones de CSP y 0 consola (página y workers).
// PE-4-r2 (M-3): lleva @cero-red (≈ 4 s la prueba y ≈ 13 s con la compilación del arnés). Una violación de CSP dentro del worker
// de pdf.js no llega a la ventana ni a la consola que ve Playwright. Por eso la copia de `_headers` del arnés (solo de la prueba;
// producción no lleva report-uri, V-21) añade `report-uri /csp-report` a la CSP: cada violación, también la del worker, es una
// petición que el servidor registra, y la prueba exige que no haya ninguna. Un canario demuestra que el mecanismo funciona.
test.describe('fase pdf', () => {
  test.describe.configure({ mode: 'serial' });
  const RAIZ = process.cwd();
  const CARPETA = join(RAIZ, 'test-results', 'pdf-harness');
  const PUERTO = Number(process.env['PORT'] ?? 4173) + 6;
  const ORIGEN = `http://127.0.0.1:${PUERTO}`;
  const REGISTRO = join(CARPETA, 'peticiones.jsonl');
  let servidor: ChildProcess | null = null;

  test.beforeAll(async () => {
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
        rolldownOptions: { input: { pdf: join(RAIZ, 'tests/e2e/harness/pdf.html') }, output: { minify: { compress: { dropConsole: true, dropDebugger: true } } } },
      },
      worker: { format: 'es', rolldownOptions: { output: { minify: { compress: { dropConsole: true, dropDebugger: true } } } } },
      resolve: { conditions: [...defaultClientConditions] },
    });
    mkdirSync(join(CARPETA, 'fixtures'), { recursive: true });
    // Solo en la copia del arnés: las violaciones de CSP, también las de workers, se reportan a /csp-report y el servidor las registra.
    const cabeceras = join(CARPETA, '_headers');
    writeFileSync(cabeceras, readFileSync(cabeceras, 'utf8').replace(/^(\s*Content-Security-Policy:.*)$/m, '$1; report-uri /csp-report'));
    // Canario: un worker del mismo origen que intenta salir a la red; la CSP (connect-src 'self') lo bloquea y lo reporta.
    writeFileSync(join(CARPETA, 'assets', 'canario-worker.js'), "fetch('https://ejemplo.test/canario').catch(() => undefined);");
    for (const f of readdirSync(join(RAIZ, 'tests/fixtures')).filter((n) => n.endsWith('.pdf'))) cpSync(join(RAIZ, 'tests/fixtures', f), join(CARPETA, 'fixtures', f));
    servidor = spawn(process.execPath, ['tests/e2e/server.mjs', '--dir', CARPETA, '--port', String(PUERTO)], {
      env: { ...process.env, SIGLOW_REGISTRO_PETICIONES: REGISTRO }, stdio: 'ignore',
    });
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(`${ORIGEN}/`)).status) break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
  });
  test.afterAll(() => { servidor?.kill(); });

  type Resumen = { error?: string; partes?: Array<{ kind: string; label: string; largo: number }>; avisos?: string[]; categorias?: string[] };
  // Resultado esperado de cada fixture (T-LE-06 a T-LE-08, M-2).
  const ESPERADO: Record<string, { error?: string; partes?: number; avisos?: string[] }> = {
    'pdf-dos-columnas.pdf': { partes: 2, avisos: ['ORDEN_LECTURA_PDF'] },
    'pdf-anotaciones.pdf': { partes: 5, avisos: [] },
    'pdf-escaneado.pdf': { error: 'PDF_SIN_CAPA_TEXTO' },
    'pdf-con-contrasena.pdf': { error: 'PDF_CON_CONTRASENA' },
    'pdf-pagina-sin-texto.pdf': { partes: 2, avisos: ['PAGINA_SIN_TEXTO'] },
    'pdf-js-recuadro.pdf': { partes: 1, avisos: [] },
    'pdf-texto-ilegible.pdf': { partes: 1, avisos: ['TEXTO_ILEGIBLE'] },
    'pdf-formularios.pdf': { partes: 4, avisos: ['CONTENIDO_PDF_NO_LEIDO'] },
  };

  test('@cero-red fase pdf: lee los PDF con el worker del mismo origen, 0 peticiones ajenas, 0 violaciones de CSP y 0 consola', async ({ page }) => {
    const ajenas: string[] = [];
    const consola: string[] = [];
    page.on('request', (r) => { if (new URL(r.url()).origin !== ORIGEN) ajenas.push(r.url()); });
    page.on('console', (m) => consola.push(m.text()));
    page.on('pageerror', (e) => consola.push(String(e.message)));
    page.on('worker', (w) => w.on('console', (m) => consola.push(m.text())));
    await page.addInitScript(() => {
      (globalThis as unknown as { __violaciones: string[] }).__violaciones = [];
      addEventListener('securitypolicyviolation', (e) => (globalThis as unknown as { __violaciones: string[] }).__violaciones.push(e.violatedDirective));
    });
    await page.goto(`${ORIGEN}/pdf.html`);
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

    for (const [nombre, esperado] of Object.entries(ESPERADO)) {
      const r = await page.evaluate((ruta) => (globalThis as unknown as { __pdf: { leer(r: string): Promise<Resumen> } }).__pdf.leer(ruta), `/fixtures/${nombre}`);
      if (esperado.error !== undefined) expect(r.error, nombre).toBe(esperado.error);
      else {
        expect(r.error, nombre).toBeUndefined();
        expect(r.partes, nombre).toHaveLength(esperado.partes ?? 0);
        expect(r.avisos, nombre).toEqual(esperado.avisos);
      }
    }

    expect(ajenas).toEqual([]);
    expect(await page.evaluate(() => (globalThis as unknown as { __violaciones: string[] }).__violaciones)).toEqual([]);
    expect(consola).toEqual([]);
    // Todo al mismo origen: solo rutas del build, el worker de pdf.js como archivo propio (nunca blob:) y los PDF, sin query.
    const registro = readFileSync(REGISTRO, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { m: string; u: string }).filter((x) => x.u !== '/'); // «/» es el sondeo del servidor
    for (const x of registro) {
      expect(x.m).toBe('GET');
      expect(x.u, x.u).toMatch(/^\/(pdf\.html|tt-policy\.js|assets\/[A-Za-z0-9._-]+\.js|fixtures\/pdf-[a-z-]+\.pdf)$/);
    }
    expect(registro.some((x) => /^\/assets\/pdf\.worker-[A-Za-z0-9_-]+\.js$/.test(x.u))).toBe(true);
  });

  test('@cero-red fase pdf canario: una violación de CSP dentro de un worker llega al registro del servidor', async ({ page }) => {
    await page.goto(`${ORIGEN}/pdf.html`);
    await page.evaluate(() => { new Worker('/assets/canario-worker.js'); });
    const vistas = (): string[] => readFileSync(REGISTRO, 'utf8').trim().split('\n').map((l) => (JSON.parse(l) as { u: string }).u);
    await expect.poll(() => vistas().includes('/csp-report'), { timeout: 10_000 }).toBe(true);
  });
});
