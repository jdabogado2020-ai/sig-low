// F8 (v1.1.1) · Aviso de extensión del navegador. Una extensión de asistente que cuelga su panel de la página (como el recuadro
// blanco que el dueño vio bajo el pie en la v1.1.0) puede leer el documento. Sig-Low vigila solo la presencia de nodos ajenos en
// <html> y <body> (src/ui/extensiones.ts) y muestra arriba un aviso que no bloquea. Sin nodos ajenos, ni los diálogos, ni el párrafo
// de impresión, ni el enlace de una descarga lo encienden. Datos ficticios evidentes (10.1.5).
import { expect, test, type Page } from '@playwright/test';

import { abrirAvanzadas, aDescargar, abrirMasFormatos, anonimizarTexto, confirmar, h1, irACargar, TITULO } from './lib/flujo';
import { hallazgos } from './lib/prohibidos';

const aviso = (page: Page) => page.locator('[data-prueba="aviso-extension"]');
const TEXTO_AVISO = 'Hay una extensión del navegador en esta página: puede leer sus documentos. Use un perfil del navegador sin extensiones.';
const TEXTO = 'Ana Ficticia Rojas, C.C. 1.000.000.017, vive en la Calle 00 n.º 00-00. Correo: ana.ficticia@ejemplo.test.';

test.describe('F8 aviso de extensión del navegador', () => {
  test('F8 @humo sin nodos ajenos no hay aviso: ni al cargar, ni con diálogos, menús, la vista previa, la descarga de un .txt o el bloqueo', async ({ page }) => {
    await irACargar(page);
    await abrirAvanzadas(page);
    await page.getByRole('button', { name: 'Acerca de' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await anonimizarTexto(page, TEXTO);
    await page.locator('[data-prueba="vista-previa"] button.etiqueta').first().click();
    await expect(page.locator('[data-prueba="menu-etiqueta"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await aDescargar(page);
    await confirmar(page);
    await abrirMasFormatos(page);
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /\.txt/ }).first().click()]);
    expect(descarga.suggestedFilename()).toMatch(/\.txt$/);
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(h1(page, TITULO.cargar)).toBeVisible();
    await expect(aviso(page)).toHaveCount(0);
  });

  test('F8 @humo un panel ajeno colgado de <body> después de cargar enciende el aviso arriba, sin bloquear, con los pasos para un perfil sin extensiones', async ({ page }) => {
    await irACargar(page);
    await expect(aviso(page)).toHaveCount(0);
    // Lo que haría una extensión: un div con su propio shadow DOM al final de <body>. (Su iframe no se puede crear desde la página:
    // la guarda de la app lo impide en este mundo; la extensión lo crea desde el suyo. Para el aviso basta el nodo anfitrión.)
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.attachShadow({ mode: 'closed' }).append(document.createElement('section'));
      document.body.append(host);
    });
    await expect(aviso(page)).toBeVisible();
    await expect(aviso(page)).toHaveAttribute('role', 'alert');
    await expect(aviso(page)).toContainText(TEXTO_AVISO);
    // Arriba: antes del contenido de la pantalla.
    const arriba = await page.evaluate(() => {
      const a = document.querySelector('[data-prueba="aviso-extension"]');
      const m = document.querySelector('main');
      return a !== null && m !== null && (a.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    expect(arriba).toBe(true);
    await aviso(page).getByRole('button', { name: 'Cómo crear un perfil sin extensiones' }).click();
    await expect(page.locator('[data-prueba="pasos-perfil"] li')).toHaveCount(3);
    await expect(aviso(page).getByRole('button', { name: 'Ocultar los pasos' })).toHaveAttribute('aria-expanded', 'true');
    expect(hallazgos([(await aviso(page).textContent()) ?? ''])).toEqual([]);
    // No bloquea: se sigue anonimizando, y el aviso sigue arriba en la vista previa.
    await anonimizarTexto(page, TEXTO);
    await expect(aviso(page)).toBeVisible();
  });

  test('F8 un nodo ajeno en <html> o que ya estaba al arrancar (la extensión se inyecta antes que la app) también enciende el aviso', async ({ page }) => {
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => { document.documentElement.append(document.createElement('panel-ajeno')); });
    });
    await irACargar(page);
    await expect(aviso(page)).toBeVisible();
    await expect(aviso(page)).toContainText(TEXTO_AVISO);
  });
});
