// F8 (v1.1.1) · Después del pie («Operado por GRUPO EMPRESARIAL NEW WAY S.A.S.») no hay nada visible: ni un recuadro, ni un
// párrafo de impresión, ni un diálogo cerrado, ni un lienzo. Prueba de cajas en Inicio (Cargar documento) en varios estados,
// anchos y esquemas de color, y en Vista previa y Descargar. Datos ficticios evidentes (10.1.5).
import { expect, test, type Page } from '@playwright/test';

import { abrirAvanzadas, anonimizarTexto, h1, irACargar, TITULO } from './lib/flujo';

interface Medida { pieAbajo: number; documento: number; alto: number; despues: string[]; hijos: string[]; fondoDebajo: boolean }

/** Cajas visibles que terminan por debajo del pie, alto del documento y fondo del área bajo el pie. */
function medir(page: Page): Promise<Medida> {
  return page.evaluate(() => {
    const pie = document.querySelector('footer.pie');
    if (pie === null) throw new Error('SIN_PIE');
    scrollTo(0, document.documentElement.scrollHeight);
    const abajo = pie.getBoundingClientRect().bottom + scrollY;
    const despues = [...document.body.querySelectorAll('*')]
      .filter((el) => !pie.contains(el) && !el.contains(pie))
      .filter((el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
      .map((el): [Element, DOMRect] => [el, el.getBoundingClientRect()])
      .filter(([, r]) => r.width > 0 && r.height > 0 && r.bottom + scrollY > abajo + 1)
      .map(([el, r]) => `${el.tagName}.${String(el.className)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    // Lo que se pinta debajo del pie (si la ventana es más alta que el documento) es el fondo de la página, no un recuadro claro.
    const fondo = getComputedStyle(document.body).backgroundColor;
    const fondoDebajo = fondo === getComputedStyle(pie).backgroundColor && fondo !== 'rgba(0, 0, 0, 0)';
    const hijos = [...document.body.children].filter((e) => e.checkVisibility()).map((e) => `${e.tagName}.${String(e.className)}`);
    return { pieAbajo: Math.round(abajo), documento: document.documentElement.scrollHeight, alto: innerHeight, despues, hijos, fondoDebajo };
  });
}

async function sinNadaDespuesDelPie(page: Page, estado: string): Promise<void> {
  const m = await medir(page);
  expect(m.despues, `${estado}: cajas visibles debajo del pie`).toEqual([]);
  expect(m.documento - m.pieAbajo, `${estado}: el documento sigue debajo del pie`).toBeLessThanOrEqual(1);
  // El pie llega al borde inferior de la ventana cuando el contenido es corto (no queda una franja vacía debajo).
  expect(m.pieAbajo, `${estado}: el pie no llega al borde de la ventana`).toBeGreaterThanOrEqual(m.alto - 1);
  expect(m.fondoDebajo, `${estado}: el fondo de la página no es el del pie`).toBe(true);
  // Solo la app es visible como hija de <body>: el párrafo de impresión (M-126) y los diálogos cerrados no se ven.
  expect(m.hijos, `${estado}: hijos visibles de <body>`).toHaveLength(1);
}

test.describe('F8 nada visible después del pie', () => {
  for (const [ancho, alto] of [[1366, 768], [1440, 1600], [768, 1024], [375, 812]] as const) {
    for (const esquema of ['light', 'dark'] as const) {
      test(`F8 @humo Inicio ${ancho}×${alto} ${esquema}: después del pie no hay ninguna caja visible`, async ({ page }) => {
        await page.setViewportSize({ width: ancho, height: alto });
        await page.emulateMedia({ colorScheme: esquema });
        await irACargar(page);
        await sinNadaDespuesDelPie(page, 'al cargar');
        await abrirAvanzadas(page);
        await sinNadaDespuesDelPie(page, 'con «Opciones avanzadas» abierta');
        await page.locator('details[data-prueba="opciones-avanzadas"] summary').click();
        await page.getByRole('tab', { name: 'Pegar texto' }).click();
        await sinNadaDespuesDelPie(page, 'en «Pegar texto»');
      });
    }
  }

  test('F8 Vista previa, Descargar y de vuelta en Inicio (Anonimizar otro documento y Bloquear): nada visible después del pie', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1600 });
    await irACargar(page);
    await anonimizarTexto(page, 'Ana Ficticia Rojas, C.C. 1.000.000.017, vive en la Calle 00 n.º 00-00. Correo: ana.ficticia@ejemplo.test.');
    await sinNadaDespuesDelPie(page, 'en Vista previa');
    await page.getByRole('button', { name: 'Continuar a descargar' }).click();
    await expect(h1(page, TITULO.descargar)).toBeVisible();
    await sinNadaDespuesDelPie(page, 'en Descargar');
    await page.getByRole('button', { name: 'Anonimizar otro documento' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Descartar este documento' }).click();
    await expect(h1(page, TITULO.cargar)).toBeVisible();
    await sinNadaDespuesDelPie(page, 'en Inicio tras «Anonimizar otro documento»');
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(h1(page, TITULO.cargar)).toBeVisible();
    await sinNadaDespuesDelPie(page, 'en Inicio tras «Bloquear»');
  });
});
