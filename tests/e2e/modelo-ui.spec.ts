import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

// T-IU-15 (resultados progresivos y banda del modelo) y T-IU-16 (marcador específico de TI, CE, PPT y PEP), de PC-4 (10.0).
// Usan el build de medición (`vite build --mode medicion`) y su gancho de la Revisión: el modelo real no se descarga en estas pruebas;
// cada ventana del modelo se simula con la misma tubería de producción (`fusionar` + `incorporar_modelo`). Datos ficticios (10.1.5).

const PUERTO_MEDICION = Number(process.env.PORT ?? 4173) + 110;
const URL_MEDICION = `http://127.0.0.1:${PUERTO_MEDICION}`;
let servidorMedicion: ChildProcess | undefined;

function masNuevo(dir: string): number {
  let m = 0;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const s = statSync(p);
    m = Math.max(m, s.isDirectory() ? masNuevo(p) : s.mtimeMs);
  }
  return m;
}
async function levantarMedicion(): Promise<void> {
  const indice = join('dist-medicion', 'index.html');
  if (!existsSync(indice) || statSync(indice).mtimeMs < masNuevo('src')) {
    const r = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'medicion'], { stdio: 'ignore' });
    if (r.status !== 0) throw new Error('No se pudo construir el build de medición');
  }
  servidorMedicion = spawn(process.execPath, ['tests/e2e/server.mjs', '--dir', 'dist-medicion', '--port', String(PUERTO_MEDICION)], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(URL_MEDICION + '/')).ok) return; } catch { /* aún no escucha */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('El servidor de medición no respondió');
}

type Gancho = {
  cargar(texto: string, modelo?: string): Promise<number>;
  incorporarVentana(textos: string[], ventana: number, total: number): Promise<number>;
  revision(): number;
  estado(): { revision: number; estados: Record<string, number> };
};
const gancho = (page: Page) => ({
  cargar: (t: string, m: string) => page.evaluate(([x, y]) => (globalThis as unknown as { __siglowRevisionPrueba: Gancho }).__siglowRevisionPrueba.cargar(x as string, y as string), [t, m]),
  ventana: (textos: string[], v: number, total: number) =>
    page.evaluate(([a, b, c]) => (globalThis as unknown as { __siglowRevisionPrueba: Gancho }).__siglowRevisionPrueba.incorporarVentana(a as string[], b as number, c as number), [textos, v, total] as const),
  revision: () => page.evaluate(() => (globalThis as unknown as { __siglowRevisionPrueba: Gancho }).__siglowRevisionPrueba.revision()),
  estado: () => page.evaluate(() => (globalThis as unknown as { __siglowRevisionPrueba: Gancho }).__siglowRevisionPrueba.estado()),
});

const h1 = (page: Page, nombre: string) => page.getByRole('heading', { level: 1, name: nombre });
const panelTexto = (page: Page) => page.getByRole('region', { name: 'Documento con detecciones' });
const banda = (page: Page) => page.locator('[data-prueba="banda-modelo"]');
const continuar = (page: Page) => page.locator('[data-prueba="continuar"]');

/** Crea un asunto «No guardar» y abre la Revisión con `texto` y el modelo en el estado pedido. */
async function abrirRevision(page: Page, texto: string, modelo: 'en_curso' | 'plan_b' = 'en_curso'): Promise<number> {
  await page.goto('/');
  await expect(h1(page, 'Inicio')).toBeVisible();
  await page.getByLabel('Código del asunto').fill('PRUEBA-015');
  await page.getByRole('radio', { name: /^No guardar la tabla/ }).check();
  await page.getByRole('button', { name: 'Crear asunto' }).click();
  await expect(h1(page, 'Lista del caso')).toBeVisible();
  await page.waitForFunction(() => '__siglowRevisionPrueba' in globalThis);
  const n = await gancho(page).cargar(texto, modelo);
  await expect(h1(page, 'Revisión')).toBeVisible();
  return n;
}

const TEXTO_MODELO = 'La señora Marta Ficticia Gómez, con cédula 1.000.000.005, firma.';

test.describe('Modelo en la Revisión (PC-4)', () => {
  test.describe.configure({ timeout: 90_000 });
  test.use({ baseURL: URL_MEDICION });
  test.beforeAll(async () => { await levantarMedicion(); });
  test.afterAll(() => { servidorMedicion?.kill(); });

  test('T-IU-15 INV-R12: las reglas y la lista aparecen antes que el modelo; la banda muestra el progreso; la marca NUEVA no mueve el foco ni lo decidido', async ({ page }) => {
    const n = await abrirRevision(page, TEXTO_MODELO);
    expect(n).toBe(1); // solo la cédula: la persona la traerá el modelo
    await expect(panelTexto(page).locator('[data-det]')).toHaveCount(1);
    await expect(banda(page)).toHaveAttribute('data-estado', 'en_curso');
    await expect(banda(page).getByRole('heading', { name: 'Modelo de apoyo en curso' })).toBeVisible();
    await expect(banda(page).locator('[data-prueba="banda-avance"]')).toHaveText('Modelo de apoyo: preparando el primer bloque');
    await expect(page.locator('[data-prueba="contador-modelo"]')).toContainText('El modelo de apoyo aún puede agregar detecciones.');
    // Aun sin pendientes por decidir, «Continuar» sigue cerrado mientras el modelo corre.
    const cc = panelTexto(page).locator('[data-det]', { hasText: '1.000.000.005' });
    await cc.click();
    await cc.focus();
    await page.keyboard.press('a');
    await expect(page.locator('[data-prueba="contador-texto"]')).toHaveText('No quedan detecciones pendientes ni banderas sin confirmar.');
    await expect(continuar(page)).toHaveAttribute('aria-disabled', 'true');

    expect(await gancho(page).ventana([], 1, 3)).toBe(0);
    await expect(banda(page).locator('[data-prueba="banda-avance"]')).toHaveText('Modelo de apoyo: bloque 2 de 3.');
    const barra = banda(page).locator('progress');
    await expect(barra).toHaveAttribute('value', '1');
    await expect(barra).toHaveAttribute('max', '3');
    await expect(barra).toHaveAttribute('aria-valuetext', 'Modelo de apoyo: bloque 2 de 3.');
    await expect(page.locator('[data-prueba="ayuda-continuar"]')).toContainText('El modelo de apoyo todavía está revisando el documento: faltan 2 de 3 bloques.');

    // Llega una detección del modelo: NUEVA, sin mover el foco, la selección ni lo ya decidido (INV-R12).
    await cc.focus();
    const antes = await gancho(page).estado();
    expect(await gancho(page).ventana(['Marta Ficticia Gómez'], 2, 3)).toBe(1);
    await expect(panelTexto(page).locator('[data-det]')).toHaveCount(2);
    await expect(panelTexto(page).locator('.nueva')).toHaveCount(1);
    await expect(cc).toBeFocused();
    await expect(cc).toHaveAttribute('aria-current', 'true');
    expect((await gancho(page).estado()).estados['aceptada']).toBe(antes.estados['aceptada']);
    await expect(page.locator('[data-prueba="contador-texto"]')).toHaveText('1 detecciones pendientes · 0 banderas sin confirmar');
    await expect(banda(page).locator('[data-prueba="banda-restante"]')).toContainText('Quedan aproximadamente');

    // «Seguir sin el modelo» pide confirmación (M-173); «Esperar» no cambia nada.
    const r0 = await gancho(page).revision();
    await banda(page).getByRole('button', { name: 'Seguir sin el modelo' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Seguir sin el modelo' });
    await expect(dialogo).toContainText('Si sigue sin el modelo, los nombres que no estén en la lista del caso solo se encontrarán con las reglas. ¿Seguir sin el modelo?');
    await dialogo.getByRole('button', { name: 'Esperar' }).click();
    await expect(dialogo).not.toBeVisible();
    expect(await gancho(page).revision()).toBe(r0);
    await expect(banda(page)).toHaveAttribute('data-estado', 'en_curso');
    await banda(page).getByRole('button', { name: 'Seguir sin el modelo' }).click();
    await dialogo.getByRole('button', { name: 'Seguir sin el modelo' }).click();
    // Plan B declarado: M-172 persistente, las detecciones ya incorporadas se conservan y la revisión sube en 1 (INV-R08).
    await expect(banda(page)).toHaveAttribute('data-estado', 'plan_b');
    await expect(banda(page).locator('[data-prueba="banda-plan-b"]')).toHaveText(
      'El modelo de apoyo no revisó todo el documento (usted decidió seguir sin él). La revisión se apoya solo en reglas y lista del caso, y el informe lo dirá. Lea el documento completo antes de copiar.',
    );
    expect(await gancho(page).revision()).toBe(r0 + 1);
    await expect(panelTexto(page).locator('[data-det]')).toHaveCount(2);
    // Con el modelo en plan B, «Continuar» solo espera las decisiones pendientes (M-68, sin M-508).
    await expect(continuar(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('[data-prueba="ayuda-continuar"]')).not.toContainText('todavía está revisando');
    await panelTexto(page).locator('[data-det]', { hasText: 'Marta' }).focus();
    await page.keyboard.press('a');
    await expect(continuar(page)).toHaveAttribute('aria-disabled', 'false');
    await continuar(page).click();
    await expect(h1(page, 'Listo')).toBeVisible();
  });

  test('T-IU-15 el modelo terminado se pliega a una línea (M-167)', async ({ page }) => {
    await abrirRevision(page, TEXTO_MODELO);
    expect(await gancho(page).ventana([], 1, 2)).toBe(0);
    expect(await gancho(page).ventana(['Marta Ficticia Gómez'], 2, 2)).toBe(1);
    await expect(banda(page)).toHaveAttribute('data-estado', 'terminado');
    await expect(banda(page)).toHaveText('El modelo de apoyo terminó de revisar el documento.');
    await expect(banda(page).getByRole('button')).toHaveCount(0);
  });

  test('T-IU-15 el presupuesto de tiempo avisa a la mitad (M-63), anota la pestaña oculta (M-62) y al agotarse pasa solo a plan B con M-64', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-30T10:00:00-05:00') });
    await abrirRevision(page, TEXTO_MODELO);
    await expect(banda(page)).toHaveAttribute('data-estado', 'en_curso');
    await expect(page.locator('[data-prueba="banda-lenta"]')).toHaveCount(0);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.locator('[data-prueba="banda-oculta"]')).toHaveText('Mientras la pestaña está en segundo plano, el análisis avanza más despacio.');
    await page.clock.runFor(31_000);
    await expect(page.locator('[data-prueba="banda-lenta"]')).toHaveText('El modelo de apoyo está tardando más de lo previsto. Puede seguir revisando mientras espera, o seguir sin él.');
    await expect(banda(page)).toHaveAttribute('data-estado', 'en_curso');
    const r0 = await gancho(page).revision();
    await page.clock.runFor(30_000);
    await expect(banda(page)).toHaveAttribute('data-estado', 'plan_b');
    await expect(page.locator('[data-prueba="banda-agotado"]')).toHaveText(
      'El modelo de apoyo superó el tiempo previsto y se detuvo. Lo que encontró hasta ahí se conserva. La revisión continúa con reglas y lista del caso.',
    );
    await expect(page.locator('[data-prueba="banda-plan-b"]')).toContainText('(superó el tiempo previsto)');
    expect(await gancho(page).revision()).toBe(r0 + 1);
  });

  test('T-IU-15 tras la primera ventana el presupuesto pasa a max(60 s, 2 × t1 × ventanas) (6.11.3)', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-30T10:00:00-05:00') });
    await abrirRevision(page, TEXTO_MODELO);
    await page.clock.runFor(10_000);
    expect(await gancho(page).ventana([], 1, 10)).toBe(0); // t1 = 10 s → presupuesto = max(60, 2 × 10 × 10) = 200 s
    await page.clock.runFor(51_000); // 61 s: el presupuesto mínimo de 60 s ya no rige
    await expect(banda(page)).toHaveAttribute('data-estado', 'en_curso');
    await expect(page.locator('[data-prueba="banda-lenta"]')).toHaveCount(0);
    await page.clock.runFor(40_000); // 101 s: pasada la mitad de 200 s
    await expect(page.locator('[data-prueba="banda-lenta"]')).toBeVisible();
    await expect(banda(page)).toHaveAttribute('data-estado', 'en_curso');
    await page.clock.runFor(100_000); // 201 s
    await expect(banda(page)).toHaveAttribute('data-estado', 'plan_b');
  });

  test('T-IU-16 INV-R09 INV-R10: «Usar marcador específico» de TI, CE, PPT y PEP cambia a [TI_n], restituye el rótulo y se deshace con «Volver al marcador general»', async ({ page }) => {
    await abrirRevision(page, 'La niña con T.I. 1.000.000.002 y el C.E. 123456; ppt: 0001234567 y PEP No. 123456789012345.', 'plan_b');
    const panel = panelTexto(page);
    const ficha = page.getByRole('region', { name: 'Ficha de la detección' });
    // INV-R09: nacen como [DOCUMENTO_n] y con el rótulo ya generalizado (una edición de tramo por cada rótulo con sugerencia aplicada).
    await expect(panel.locator('.res.edicion')).not.toHaveCount(0);
    const neutros = await panel.locator('.res.edicion').count();
    for (const [tipo, nombre, esperado] of [
      ['TI', /^Tarjeta de identidad, pendiente/, '[TI_1]'],
      ['CE', /^Cédula de extranjería, pendiente/, '[CE_1]'],
      ['PPT', /^Permiso por protección temporal, pendiente/, '[PPT_1]'],
      ['PEP', /^Permiso especial de permanencia, pendiente/, '[PEP_1]'],
    ] as const) {
      await panel.getByRole('button', { name: nombre }).first().click();
      await expect(ficha.locator('[data-prueba="ficha-marcador"]')).toHaveText(/^\[DOCUMENTO_\d+\]$/);
      await expect(ficha).toContainText('Por defecto, los documentos de identidad se reemplazan por [DOCUMENTO_n]');
      // El control existe una sola vez en la pantalla (lo implementó PC-3; PC-4 no lo duplica).
      const control = page.getByRole('button', { name: `Usar marcador específico (${tipo})` });
      await expect(control).toHaveCount(1);
      const r0 = await gancho(page).revision();
      await control.click();
      expect(await gancho(page).revision()).toBe(r0 + 1);
      await expect(ficha.locator('[data-prueba="ficha-marcador"]')).toHaveText(esperado);
      await expect(page.locator('[data-prueba="anuncio-revision"]')).toHaveText(`Marcador específico aplicado: ${esperado}.`);
      // Vuelve a una sola copia del control: ahora es «Volver al marcador general».
      await expect(page.getByRole('button', { name: 'Volver al marcador general' })).toHaveCount(1);
      await expect(page.getByRole('button', { name: `Usar marcador específico (${tipo})` })).toHaveCount(0);
      await page.getByRole('button', { name: 'Volver al marcador general' }).click();
      expect(await gancho(page).revision()).toBe(r0 + 2);
      await expect(ficha.locator('[data-prueba="ficha-marcador"]')).toHaveText(/^\[DOCUMENTO_\d+\]$/);
      await expect(panel.locator('.res.edicion')).toHaveCount(neutros); // INV-R10: se restablece el estado neutro
    }
  });
});
