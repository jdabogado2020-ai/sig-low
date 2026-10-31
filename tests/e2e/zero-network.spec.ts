import { test, expect } from '@playwright/test';

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
