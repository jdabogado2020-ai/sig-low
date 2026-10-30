import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

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
