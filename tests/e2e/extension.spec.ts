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

// ===== F9 (v1.1.2) · M-160: lo propio se reconoce por identidad; B-170: lo que pdf.js cuelga al dibujar es propio =====

/**
 * Ejecuta `expresion` en un mundo aislado de la página (CDP `Page.createIsolatedWorld`), como el content script de una extensión:
 * comparte el DOM, pero no los globales ni la guarda de la app (src/guard.ts), así que puede crear un iframe.
 */
async function comoExtension(page: Page, expresion: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'extension-de-prueba' });
  const r = await cdp.send('Runtime.evaluate', { expression: expresion, contextId: executionContextId });
  expect(r.exceptionDetails, 'la extensión simulada no pudo colgar su nodo').toBeUndefined();
  await cdp.detach();
}

/** PDF ficticio de una página con texto y una función de transferencia (/TR en el ExtGState) que se usa al dibujar. */
function pdfConTR(): Buffer {
  const lineas = [
    'Ana Ficticia Rojas, identificada con C.C. 1.000.000.017, presenta este escrito de prueba.',
    'Vive en la Calle 00 n.o 00-00 de Ciudad Ejemplo y su correo es ana.ficticia@ejemplo.test.',
    'El demandado Pedro Ejemplo Prueba respondio dentro del termino. Documento ficticio.',
  ];
  const texto = lineas.map((l, i) => `BT /F1 11 Tf 40 ${740 - i * 18} Td (${l}) Tj ET`).join('\n');
  const contenido = `q /GS1 gs 0.9 g 30 600 540 160 re f Q\nq /GS1 gs 0 g\n${texto}\nQ`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> /ExtGState << /GS1 << /TR 5 0 R >> >> >> /Contents 4 0 R >>',
    `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`,
    '<< /FunctionType 2 /Domain [0 1] /C0 [1] /C1 [0] /N 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let s = '%PDF-1.4\n';
  const off: number[] = [];
  objs.forEach((o, i) => { off.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(s, 'latin1');
}

test.describe('F9 aviso de extensión: identidad, no atributos (M-160) y pdf.js (B-170)', () => {
  const DISFRACES: ReadonlyArray<readonly [nombre: string, expresion: string]> = [
    ['<div data-siglow> con shadow DOM en <body>', "{ const d = document.createElement('div'); d.setAttribute('data-siglow', ''); d.attachShadow({ mode: 'open' }); document.body.append(d); }"],
    ['un segundo <div id="app"> en <body>', "{ const d = document.createElement('div'); d.id = 'app'; document.body.append(d); }"],
    ['un <iframe id="app"> en <body>', "{ const f = document.createElement('iframe'); f.id = 'app'; document.body.append(f); }"],
  ];
  for (const [nombre, expresion] of DISFRACES) {
    test(`F9 @humo M-160 una extensión que cuelga ${nombre} con un atributo de la app también enciende el aviso`, async ({ page }) => {
      await irACargar(page);
      await expect(aviso(page)).toHaveCount(0);
      await comoExtension(page, expresion);
      await expect(aviso(page)).toBeVisible();
      await expect(aviso(page)).toContainText(TEXTO_AVISO);
    });
  }

  test('F9 B-170 un PDF con función de transferencia (/TR) se dibuja en la vista previa sin encender el aviso; un nodo ajeno sí lo enciende después', async ({ page }) => {
    await irACargar(page);
    await page.getByRole('tab', { name: 'Cargar archivo' }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: 'Escrito de Prueba.pdf', mimeType: 'application/pdf', buffer: pdfConTR() });
    await expect(page.locator('[data-prueba="archivo-cargado"]')).toContainText('Archivo cargado: PDF, ', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Anonimizar', exact: true }).click();
    await expect(h1(page, TITULO.vista)).toBeVisible({ timeout: 30_000 });
    // La página se dibujó (con pdf.js en el hilo principal, que con /TR cuelga su div de filtros de <body>).
    await expect(page.locator('[data-prueba="paginas-pdf"] figure.pagina-pdf')).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator('[data-prueba="preparando-paginas"]')).toHaveCount(0, { timeout: 30_000 });
    const hijos = await page.evaluate(() => document.body.children.length);
    expect(hijos, 'pdf.js colgó su nodo de <body> (si no, la prueba no prueba nada)').toBeGreaterThan(2);
    await expect(aviso(page)).toHaveCount(0);
    // Lo de pdf.js no tapa a una extensión: un panel ajeno después sí enciende el aviso.
    await comoExtension(page, "{ const d = document.createElement('div'); document.body.append(d); }");
    await expect(aviso(page)).toBeVisible();
  });
});
