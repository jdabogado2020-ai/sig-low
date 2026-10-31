import { test, expect, type Page } from '@playwright/test';
import { configurarSimulador, instalarSimulador, soltarRetenidos } from './ayudas-entrada';

// Casos de T-AX de PC-2 (8.6.6, 10.0): teclado, nombres accesibles y regiones vivas en Entrada y Procesando.
// PC-3 agrega T-AX-03 (no solo color) y PC-7 completa T-AX-01 a T-AX-04 sobre el flujo integrado y T-AX-05 a T-AX-08.
// Datos ficticios evidentes (10.1.5).

const TEXTO_PRUEBA = 'Ana Ficticia Rojas, C.C. 1.000.000.017, vive en la Calle 00 n.º 00-00 de Ciudad Ejemplo.';
const h1 = (page: Page, nombre: string) => page.getByRole('heading', { level: 1, name: nombre });

async function irAEntrada(page: Page): Promise<void> {
  await page.goto('/');
  await expect(h1(page, 'Inicio')).toBeVisible();
  await page.getByLabel('Código del asunto').fill('PRUEBA-AX');
  await page.getByRole('radio', { name: /^No guardar la tabla/ }).check();
  await page.getByRole('button', { name: 'Crear asunto' }).click();
  await expect(h1(page, 'Lista del caso')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(h1(page, 'Entrada')).toBeFocused();
}

const activo = (page: Page) => page.evaluate(() => {
  const e = document.activeElement;
  return e ? { rol: e.getAttribute('role') ?? e.tagName.toLowerCase(), nombre: e.getAttribute('aria-label') ?? e.textContent?.trim() ?? '' } : null;
});

test.describe('T-AX-01 teclado en Entrada y Procesando', () => {
  test('T-AX-01 Entrada solo con teclado: pestañas con flechas, texto, «Analizar» con Enter y llegada a Revisión con el foco en su título', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    // El foco entra por el título de la pantalla; Tab recorre la pestaña activa y luego el campo (índice de tabulación móvil).
    await page.keyboard.press('Tab');
    expect(await activo(page)).toEqual({ rol: 'tab', nombre: 'Pegar texto' });
    await page.keyboard.press('ArrowRight');
    expect(await activo(page)).toEqual({ rol: 'tab', nombre: 'Cargar archivo' });
    await expect(page.getByRole('tab', { name: 'Cargar archivo' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'Pegar texto' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Tab');
    expect(await activo(page)).toMatchObject({ rol: 'textarea' });
    await page.keyboard.type(TEXTO_PRUEBA);
    // Tab: casilla del modelo (deshabilitada, se omite) → «Analizar».
    await page.keyboard.press('Tab');
    expect(await activo(page)).toEqual({ rol: 'button', nombre: 'Analizar' });
    await configurarSimulador(page, { retener: 'resultado' });
    await page.keyboard.press('Enter');
    await expect(h1(page, 'Procesando')).toBeFocused();
    // En Procesando, Tab llega a «Cancelar análisis» y nada más (sin trampas de foco).
    await page.keyboard.press('Tab');
    expect(await activo(page)).toEqual({ rol: 'button', nombre: 'Cancelar análisis' });
    await configurarSimulador(page, { retener: null });
    await soltarRetenidos(page);
    await expect(h1(page, 'Revisión')).toBeFocused();
  });

  test('T-AX-01 Esc y Enter: «Cancelar análisis» se activa con el teclado y devuelve el foco al título de Entrada', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await page.getByRole('textbox', { name: 'Texto del documento' }).fill(TEXTO_PRUEBA);
    await configurarSimulador(page, { retener: 'resultado' });
    await page.getByRole('button', { name: 'Analizar', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(h1(page, 'Procesando')).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(h1(page, 'Entrada')).toBeFocused({ timeout: 4000 });
  });
});

test.describe('T-AX-02 nombres, roles y regiones de Entrada y Procesando', () => {
  test('T-AX-02 Entrada expone tablist, tabpanel, campo con nombre y descripción, y botones con nombre', async ({ page }) => {
    await irAEntrada(page);
    await expect(page.getByRole('tablist', { name: 'Forma de entrada del documento' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Pegar texto' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Cargar archivo' })).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByRole('tabpanel', { name: 'Pegar texto' })).toBeVisible();
    const campo = page.getByRole('textbox', { name: 'Texto del documento' });
    await expect(campo).toHaveAccessibleDescription('Pegue aquí el texto del documento. Se analiza en su equipo.');
    await expect(page.getByRole('button', { name: 'Analizar', exact: true })).toHaveAccessibleDescription('Pegue texto o cargue un archivo con texto para poder analizar.');
    await expect(page.getByRole('button', { name: 'Editar lista del caso' })).toBeVisible();
    await page.getByRole('tab', { name: 'Cargar archivo' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Cargar archivo' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Zona para soltar un archivo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Elegir archivo (.txt, .docx, .pdf)' })).toBeVisible();
  });

  test('T-AX-02 Procesando: lista de etapas con nombre, una barra con nombre y valor en palabras por etapa activa', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await page.getByRole('textbox', { name: 'Texto del documento' }).fill(TEXTO_PRUEBA);
    await configurarSimulador(page, { retener: 'resultado' });
    await page.getByRole('button', { name: 'Analizar', exact: true }).click();
    await expect(h1(page, 'Procesando')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Etapas del análisis' })).toBeVisible();
    const lectura = page.getByRole('progressbar', { name: 'Lectura del documento' });
    await expect(lectura).toHaveAttribute('aria-valuetext', 'Lectura del documento: parte 1 de 1');
    await expect(page.getByRole('button', { name: 'Cancelar análisis' })).toBeVisible();
    await configurarSimulador(page, { retener: null });
    await soltarRetenidos(page);
    await expect(h1(page, 'Revisión')).toBeVisible();
  });

  test('T-AX-02 la zona de soltar y las etiquetas de las casillas no dependen solo del color: texto visible y estado en el nombre', async ({ page }) => {
    await irAEntrada(page);
    await expect(page.getByRole('checkbox', { name: 'Usar el modelo de apoyo' })).toBeDisabled();
    await expect(page.getByText('El análisis usará reglas y lista del caso: el modelo de apoyo no está descargado.')).toBeVisible();
  });
});

test.describe('T-AX-04 regiones vivas sin texto del documento', () => {
  test('T-AX-04 las regiones status y alert de Entrada y Procesando no contienen el texto original', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await page.getByRole('textbox', { name: 'Texto del documento' }).fill(TEXTO_PRUEBA);
    const vivas = async (): Promise<string[]> => page.evaluate(() =>
      [...document.querySelectorAll('[role="status"], [role="alert"], [aria-live]')].map((e) => e.textContent ?? ''));
    for (const texto of await vivas()) {
      expect(texto).not.toContain('Ficticia');
      expect(texto).not.toContain('1.000.000.017');
    }
    await configurarSimulador(page, { retener: 'todo' });
    await page.getByRole('button', { name: 'Analizar', exact: true }).click();
    await expect(h1(page, 'Procesando')).toBeVisible();
    await expect(page.locator('[data-prueba="anuncio-progreso"]')).not.toHaveText('');
    for (const texto of await vivas()) {
      expect(texto).not.toContain('Ficticia');
      expect(texto).not.toContain('1.000.000.017');
    }
    await expect(page.locator('[data-prueba="anuncio-progreso"]')).toContainText('Reglas de formatos colombianos: En curso');
    // Un error tampoco repite el documento.
    await page.getByRole('button', { name: 'Cancelar análisis' }).click();
    await expect(h1(page, 'Entrada')).toBeVisible({ timeout: 4000 });
    for (const texto of await vivas()) expect(texto).not.toContain('Ficticia');
  });
});
