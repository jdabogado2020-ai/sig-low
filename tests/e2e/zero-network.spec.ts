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
