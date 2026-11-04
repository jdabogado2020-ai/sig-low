import { expect, type Page } from '@playwright/test';

import { etiquetas, irACargar, TITULO, vistaPrevia } from './lib/flujo';
import { testMedicion } from './lib/medicion';

// T-IU-15 (resultados progresivos y banda del modelo) y T-IU-16 (etiqueta específica de TI, CE, PPT y PEP), de PC-4 (10.0).
// Usan el build de medición (`vite build --mode medicion`) y su gancho de la Revisión: el modelo real no se descarga en estas pruebas;
// cada ventana del modelo se simula con la misma tubería de producción (`fusionar` + `incorporar_modelo`). Datos ficticios (10.1.5).

type Gancho = {
  cargar(texto: string, modelo?: string, pantalla?: string): Promise<number>;
  incorporarVentana(textos: string[], ventana: number, total: number): Promise<number>;
  revision(): number;
  estado(): { revision: number; estados: Record<string, number> };
};
const gancho = (page: Page) => ({
  cargar: (t: string, m: string, p: string) => page.evaluate(([x, y, z]) => (globalThis as unknown as { __siglowRevisionPrueba: Gancho }).__siglowRevisionPrueba.cargar(x as string, y as string, z as string), [t, m, p]),
  ventana: (textos: string[], v: number, total: number) =>
    page.evaluate(([a, b, c]) => (globalThis as unknown as { __siglowRevisionPrueba: Gancho }).__siglowRevisionPrueba.incorporarVentana(a as string[], b as number, c as number), [textos, v, total] as const),
  revision: () => page.evaluate(() => (globalThis as unknown as { __siglowRevisionPrueba: Gancho }).__siglowRevisionPrueba.revision()),
  estado: () => page.evaluate(() => (globalThis as unknown as { __siglowRevisionPrueba: Gancho }).__siglowRevisionPrueba.estado()),
});

const h1 = (page: Page, nombre: string) => page.getByRole('heading', { level: 1, name: nombre });
const panelTexto = (page: Page) => page.getByRole('region', { name: 'Documento con datos encontrados' });
const banda = (page: Page) => page.locator('[data-prueba="banda-modelo"]');
const continuar = (page: Page) => page.locator('[data-prueba="continuar"]');

/**
 * Abre «Revisar dato por dato» (la revisión de la v1.0, sin la propuesta aplicada) o, con `pantalla = 'revision'`, la «Vista previa»
 * con `texto` y el modelo en el estado pedido. F2 (D-23): ya no hay caso que crear; el gancho del build de medición abre la pantalla.
 */
async function abrirRevision(page: Page, texto: string, modelo: 'en_curso' | 'plan_b' = 'en_curso', pantalla: 'detalle' | 'revision' = 'detalle'): Promise<number> {
  await irACargar(page);
  await page.waitForFunction(() => '__siglowRevisionPrueba' in globalThis);
  const n = await gancho(page).cargar(texto, modelo, pantalla);
  await expect(h1(page, pantalla === 'detalle' ? TITULO.detalle : TITULO.vista)).toBeVisible();
  return n;
}

const TEXTO_MODELO = 'La señora Marta Ficticia Gómez, con cédula 1.000.000.005, firma.';

testMedicion.describe('Modelo en la Revisión (PC-4)', () => {
  testMedicion.describe.configure({ timeout: 90_000 });

  testMedicion('T-IU-15 INV-R12: las reglas y la lista aparecen antes que el modelo; la banda muestra el progreso; la marca NUEVA no mueve el foco ni lo decidido', async ({ page }) => {
    const n = await abrirRevision(page, TEXTO_MODELO);
    expect(n).toBe(1); // solo la cédula: la persona la traerá el modelo
    await expect(panelTexto(page).locator('[data-det]')).toHaveCount(1);
    await expect(banda(page)).toHaveAttribute('data-estado', 'en_curso');
    await expect(banda(page).getByRole('heading', { name: 'Detector de nombres adicional en curso' })).toBeVisible();
    await expect(banda(page).locator('[data-prueba="banda-avance"]')).toHaveText('Detector de nombres adicional: preparando el primer bloque');
    await expect(page.locator('[data-prueba="contador-modelo"]')).toContainText('El detector de nombres adicional aún puede agregar datos encontrados.');
    // Aun sin pendientes por decidir, «Continuar» sigue cerrado mientras el modelo corre.
    const cc = panelTexto(page).locator('[data-det]', { hasText: '1.000.000.005' });
    await cc.click();
    await cc.focus();
    await page.keyboard.press('a');
    await expect(page.locator('[data-prueba="contador-texto"]')).toHaveText('No quedan datos encontrados por revisar ni datos indirectos por revisar.');
    await expect(continuar(page)).toHaveAttribute('aria-disabled', 'true');

    expect(await gancho(page).ventana([], 1, 3)).toBe(0);
    await expect(banda(page).locator('[data-prueba="banda-avance"]')).toHaveText('Detector de nombres adicional: bloque 2 de 3.');
    const barra = banda(page).locator('progress');
    await expect(barra).toHaveAttribute('value', '1');
    await expect(barra).toHaveAttribute('max', '3');
    await expect(barra).toHaveAttribute('aria-valuetext', 'Detector de nombres adicional: bloque 2 de 3.');
    await expect(page.locator('[data-prueba="ayuda-continuar"]')).toContainText('El detector de nombres adicional todavía está revisando el documento: faltan 2 de 3 bloques.');

    // Llega una detección del modelo: NUEVA, sin mover el foco, la selección ni lo ya decidido (INV-R12).
    await cc.focus();
    const antes = await gancho(page).estado();
    expect(await gancho(page).ventana(['Marta Ficticia Gómez'], 2, 3)).toBe(1);
    await expect(panelTexto(page).locator('[data-det]')).toHaveCount(2);
    await expect(panelTexto(page).locator('.nueva')).toHaveCount(1);
    await expect(cc).toBeFocused();
    await expect(cc).toHaveAttribute('aria-current', 'true');
    expect((await gancho(page).estado()).estados['aceptada']).toBe(antes.estados['aceptada']);
    await expect(page.locator('[data-prueba="contador-texto"]')).toHaveText('1 datos encontrados por revisar · 0 datos indirectos por revisar');
    await expect(banda(page).locator('[data-prueba="banda-restante"]')).toContainText('Quedan aproximadamente');

    // «Seguir sin el modelo» pide confirmación (M-173); «Esperar» no cambia nada.
    const r0 = await gancho(page).revision();
    await banda(page).getByRole('button', { name: 'Seguir sin el detector' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Seguir sin el detector' });
    await expect(dialogo).toContainText('Si sigue sin el detector, los nombres que no estén en la lista de nombres que siempre deben ocultarse solo se encontrarán con las reglas. ¿Seguir sin el detector?');
    await dialogo.getByRole('button', { name: 'Esperar' }).click();
    await expect(dialogo).not.toBeVisible();
    expect(await gancho(page).revision()).toBe(r0);
    await expect(banda(page)).toHaveAttribute('data-estado', 'en_curso');
    await banda(page).getByRole('button', { name: 'Seguir sin el detector' }).click();
    await dialogo.getByRole('button', { name: 'Seguir sin el detector' }).click();
    // Plan B declarado: M-172 persistente, las detecciones ya incorporadas se conservan y la revisión sube en 2 (INV-R08): una por
    // declarar el plan B y otra por `aplicar_propuesta`, que D-24 ejecuta al terminar o pasar a plan B para que todo llegue aplicado.
    await expect(banda(page)).toHaveAttribute('data-estado', 'plan_b');
    await expect(banda(page).locator('[data-prueba="banda-plan-b"]')).toHaveText(
      'El detector de nombres adicional no revisó todo el documento (usted decidió seguir sin él). La revisión se apoya solo en reglas y en la lista de nombres que siempre deben ocultarse, y el informe lo dirá. Lea el documento completo antes de copiar.',
    );
    expect(await gancho(page).revision()).toBe(r0 + 2);
    await expect(panelTexto(page).locator('[data-det]')).toHaveCount(2);
    // D-24 (reescrita): al pasar a plan B la propuesta se aplica sola, así que no queda nada por decidir y «Continuar» abre sin
    // esperar decisiones (antes, v1.0: seguía cerrado hasta decidir la detección del modelo; M-68, sin M-508).
    await expect(panelTexto(page).locator('[data-det]', { hasText: 'Marta' })).toHaveAccessibleName(/ocultada con/);
    await expect(continuar(page)).toHaveAttribute('aria-disabled', 'false');
    await expect(page.locator('[data-prueba="ayuda-continuar"]')).toHaveCount(0); // ya no hay nada que esperar
    await continuar(page).click();
    await expect(h1(page, TITULO.descargar)).toBeVisible();
  });

  testMedicion('T-IU-15 el modelo terminado se pliega a una línea (M-167)', async ({ page }) => {
    await abrirRevision(page, TEXTO_MODELO);
    expect(await gancho(page).ventana([], 1, 2)).toBe(0);
    expect(await gancho(page).ventana(['Marta Ficticia Gómez'], 2, 2)).toBe(1);
    await expect(banda(page)).toHaveAttribute('data-estado', 'terminado');
    await expect(banda(page)).toHaveText('El detector de nombres adicional terminó de revisar el documento.');
    await expect(banda(page).getByRole('button')).toHaveCount(0);
  });

  testMedicion('T-IU-15 el presupuesto de tiempo avisa a la mitad (M-63), anota la pestaña oculta (M-62) y al agotarse pasa solo a plan B con M-64', async ({ page }) => {
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
    await expect(page.locator('[data-prueba="banda-lenta"]')).toHaveText('El detector de nombres adicional está tardando más de lo previsto. Puede seguir revisando mientras espera, o seguir sin él.');
    await expect(banda(page)).toHaveAttribute('data-estado', 'en_curso');
    const r0 = await gancho(page).revision();
    await page.clock.runFor(30_000);
    await expect(banda(page)).toHaveAttribute('data-estado', 'plan_b');
    await expect(page.locator('[data-prueba="banda-agotado"]')).toHaveText(
      'El detector de nombres adicional superó el tiempo previsto y se detuvo. Lo que encontró hasta ahí se conserva. La revisión continúa con reglas y con la lista de nombres que siempre deben ocultarse.',
    );
    await expect(page.locator('[data-prueba="banda-plan-b"]')).toContainText('(superó el tiempo previsto)');
    // D-24: declarar el plan B (+1) y aplicar la propuesta (+1), como al seguir sin el detector.
    expect(await gancho(page).revision()).toBe(r0 + 2);
  });

  testMedicion('T-IU-15 tras la primera ventana el presupuesto pasa a max(60 s, 2 × t1 × ventanas) (6.11.3)', async ({ page }) => {
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

  testMedicion('T-IU-15 D-24 Vista previa: con el detector en curso no se aplica la propuesta; al terminar llega todo oculto, con etiquetas sin el dato en su nombre', async ({ page }) => {
    await abrirRevision(page, TEXTO_MODELO, 'en_curso', 'revision');
    const vista = vistaPrevia(page);
    await expect(banda(page)).toHaveAttribute('data-estado', 'en_curso');
    // Todavía no hay propuesta aplicada: solo la cédula de las reglas tiene etiqueta y el nombre que traerá el detector sigue en el texto.
    await expect(etiquetas(page)).toHaveCount(1);
    await expect(vista).toContainText('Marta Ficticia Gómez');
    expect(await gancho(page).ventana([], 1, 2)).toBe(0);
    expect(await gancho(page).ventana(['Marta Ficticia Gómez'], 2, 2)).toBe(1);
    await expect(banda(page)).toHaveAttribute('data-estado', 'terminado');
    // Al terminar, la propuesta se aplica sola: las dos etiquetas aparecen y el texto original ya no está en la vista.
    await expect(etiquetas(page)).toHaveCount(2);
    await expect(vista).not.toContainText('1.000.000.005');
    await expect(vista).not.toContainText('Marta');
    for (const e of await etiquetas(page).all()) {
      await expect(e).toHaveAccessibleName(/^Etiqueta \[[A-ZÁÉÍÓÚÑ_0-9]+\], .+\. Pulse para ver las opciones\.$/);
      expect(await e.getAttribute('aria-label')).not.toMatch(/Marta|Ficticia|1\.000\.000/);
    }
    await expect(page.locator('[data-prueba="continuar"]')).toBeEnabled();
  });

  testMedicion('T-IU-16 INV-R09 INV-R10: «Usar etiqueta específica» de TI, CE, PPT y PEP cambia a [TI_n], restituye el rótulo y se deshace con «Volver a la etiqueta general»', async ({ page }) => {
    await abrirRevision(page, 'La niña con T.I. 1.000.000.002 y el C.E. 123456; ppt: 0001234567 y PEP No. 123456789012345.', 'plan_b');
    const panel = panelTexto(page);
    const ficha = page.getByRole('region', { name: 'Ficha del dato encontrado' });
    // INV-R09: nacen como [DOCUMENTO_n] y con el rótulo ya generalizado (una edición de tramo por cada rótulo con sugerencia aplicada).
    await expect(panel.locator('.res.edicion')).not.toHaveCount(0);
    const neutros = await panel.locator('.res.edicion').count();
    for (const [tipo, nombre, esperado] of [
      ['TI', /^Tarjeta de identidad, por revisar/, '[TI_1]'],
      ['CE', /^Cédula de extranjería, por revisar/, '[CE_1]'],
      ['PPT', /^Permiso por protección temporal, por revisar/, '[PPT_1]'],
      ['PEP', /^Permiso especial de permanencia, por revisar/, '[PEP_1]'],
    ] as const) {
      await panel.getByRole('button', { name: nombre }).first().click();
      await expect(ficha.locator('[data-prueba="ficha-marcador"]')).toHaveText(/^\[DOCUMENTO_\d+\]$/);
      await expect(ficha).toContainText('Por defecto, los documentos de identidad se ocultan con la etiqueta [DOCUMENTO_n]');
      // El control existe una sola vez en la pantalla (lo implementó PC-3; PC-4 no lo duplica).
      const control = page.getByRole('button', { name: `Usar etiqueta específica (${tipo})` });
      await expect(control).toHaveCount(1);
      const r0 = await gancho(page).revision();
      await control.click();
      expect(await gancho(page).revision()).toBe(r0 + 1);
      await expect(ficha.locator('[data-prueba="ficha-marcador"]')).toHaveText(esperado);
      await expect(page.locator('[data-prueba="anuncio-revision"]')).toHaveText(`Etiqueta específica aplicada: ${esperado}.`);
      // Vuelve a una sola copia del control: ahora es «Volver a la etiqueta general».
      await expect(page.getByRole('button', { name: 'Volver a la etiqueta general' })).toHaveCount(1);
      await expect(page.getByRole('button', { name: `Usar etiqueta específica (${tipo})` })).toHaveCount(0);
      await page.getByRole('button', { name: 'Volver a la etiqueta general' }).click();
      expect(await gancho(page).revision()).toBe(r0 + 2);
      await expect(ficha.locator('[data-prueba="ficha-marcador"]')).toHaveText(/^\[DOCUMENTO_\d+\]$/);
      await expect(panel.locator('.res.edicion')).toHaveCount(neutros); // INV-R10: se restablece el estado neutro
    }
  });
});
