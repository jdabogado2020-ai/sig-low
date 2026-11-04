// Pantalla Bóveda (PC-6; 8.2.9, 6.7, V-18, V-35): en la app real (dist/). T-BO-01 (parte de interfaz: lista, persistencia, exportar, importar,
// borrar, borrar todo, bloquear), INV-V01 (la pantalla muestra solo código y fechas, nunca la tabla), T-PV-24 y T-IU-05 (estados).
// Datos ficticios evidentes (10.1.5). Las frases son de prueba y no secretas.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { copiarEnListo, crearYAnalizar, FRASE, h1, REALES_REI } from './ayudas-reinsercion';

test.describe.configure({ timeout: 120_000 });
test.use({ permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });

/** Carpetas temporales con los `.siglow` descargados (copiados fuera de la ruta larga de Playwright); se borran al terminar. */
const carpetasTemporales: string[] = [];
test.afterAll(() => { for (const c of carpetasTemporales.splice(0)) rmSync(c, { recursive: true, force: true }); });

const FRASE_NUEVA = 'otra frase ficticia distinta ñandú 2';
const lista = (page: Page) => page.locator('[data-prueba="asunto-guardado"]');
const dialogo = (page: Page) => page.locator('dialog[open]');
const aviso = (page: Page, id: string) => page.locator(`[data-prueba="avisos-boveda"] [data-aviso="${id}"]`);

/** Crea el asunto guardado cifrado con su tabla consolidada, bloquea y entra a la Bóveda desde Inicio. */
async function prepararBoveda(page: Page, codigo = 'PRUEBA-BOV-01'): Promise<void> {
  await crearYAnalizar(page, { codigo, guardar: true });
  await copiarEnListo(page);
  await expect(page.locator('[data-aviso="M-90"]')).toBeVisible({ timeout: 30_000 });   // la tabla quedó guardada cifrada
  await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
  await expect(h1(page, 'Cargar documento')).toBeVisible();
  await abrirBoveda(page);
}
async function abrirBoveda(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Casos guardados', exact: true }).click();
  await expect(h1(page, 'Casos guardados')).toBeVisible();
}
const sinOriginales = async (page: Page): Promise<void> => {
  const cuerpo = (await page.locator('body').innerText()) + (await page.content());
  for (const real of REALES_REI) expect(cuerpo).not.toContain(real);
  expect(cuerpo).not.toContain('[DEMANDANTE_1]');
};

test.describe('Bóveda (PC-6)', () => {
  test('T-BO-01 INV-V01 T-PV-24 @humo la lista muestra solo código y fechas, el estado de persist() y nunca la tabla; Volver y Bloquear ahora', async ({ page }) => {
    await prepararBoveda(page);
    await expect(page.locator('[data-prueba="solo-codigo"]')).toContainText('el contenido de las tablas no se muestra en ningún momento');
    await expect(lista(page)).toHaveCount(1);
    await expect(lista(page).locator('[data-prueba="codigo"]')).toHaveText('PRUEBA-BOV-01');
    await expect(lista(page).locator('[data-prueba="creado"]')).toHaveText(/^Creado: .+\d{4}/);
    await expect(lista(page).locator('[data-prueba="actualizado"]')).toHaveText(/^Actualizado: .+\d{4}/);
    // Estado de persist(): visible en una de sus dos formas (M-107).
    const persistencia = page.locator('[data-prueba="persistencia"]');
    await expect(persistencia).toHaveText(/^(Persistente: El navegador marcó los datos de Sig-Low como persistentes\.|No persistente: El navegador puede borrar los datos de Sig-Low si le falta espacio\.)/);
    // La tabla, aunque consolidada y guardada, no se muestra ni se copia desde esta pantalla (INV-V01, T-PV-24).
    await sinOriginales(page);
    // Acciones por asunto, con el código en el nombre accesible.
    for (const a of ['Abrir', 'Guardar la llave en un archivo', 'Cambiar la contraseña de la llave', 'Borrar']) {
      await expect(page.getByRole('button', { name: `${a} PRUEBA-BOV-01`, exact: true })).toBeVisible();
    }
    // Borrar todo está habilitado porque hay asuntos; «Quitar el modelo de apoyo» solo existe con el modelo listo.
    await expect(page.getByRole('button', { name: 'Borrar todo', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Quitar el detector de nombres adicional' })).toHaveCount(0);
    // Volver no cambia nada; Bloquear ahora vuelve a Inicio con M-102.
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(h1(page, 'Cargar documento')).toBeVisible();
    await abrirBoveda(page);
    await page.getByRole('button', { name: 'Bloquear ahora' }).click();
    await expect(h1(page, 'Cargar documento')).toBeVisible();
    await expect(page.locator('[data-prueba="aviso-bloqueo"]')).toContainText('Sig-Low se bloqueó');
  });

  test('T-BO-01 T-IU-05 sin asuntos guardados: M-106 y «Borrar todo» deshabilitado', async ({ page }) => {
    await page.goto('/');
    await expect(h1(page, 'Cargar documento')).toBeVisible({ timeout: 30_000 });
    await abrirBoveda(page);
    await expect(page.locator('[data-prueba="sin-asuntos"]')).toHaveText('No hay casos guardados en este navegador.');
    await expect(page.getByRole('button', { name: 'Borrar todo', exact: true })).toBeDisabled();
    await expect(lista(page)).toHaveCount(0);
  });

  test('T-BO-01 INV-V01 exportar cifrado pide la frase; importar con conflicto: «Importar con otro código» y «Reemplazar»; borrar con M-108', async ({ page }) => {
    await prepararBoveda(page);
    // Exportar: una frase equivocada da M-201 y no descarga nada; la correcta descarga el .siglow con nombre neutro (M-114).
    await page.getByRole('button', { name: 'Exportar cifrado PRUEBA-BOV-01', exact: true }).click();
    const d = dialogo(page);
    await expect(d).toContainText('Exportar PRUEBA-BOV-01');
    await d.getByLabel('Contraseña de la llave del caso', { exact: true }).fill('una frase equivocada ficticia');
    await d.getByRole('button', { name: 'Guardar la llave para devolver los datos reales' }).click();
    await expect(d.getByText('Contraseña de la llave incorrecta o archivo dañado.')).toBeVisible({ timeout: 30_000 });
    // M-20 (6.6.5): la frase no queda en el campo tras el intento fallido; hay que escribirla otra vez.
    await expect(d.getByLabel('Contraseña de la llave del caso', { exact: true })).toHaveValue('');
    await d.getByLabel('Contraseña de la llave del caso', { exact: true }).fill(FRASE);
    const [descarga] = await Promise.all([page.waitForEvent('download'), d.getByRole('button', { name: 'Guardar la llave para devolver los datos reales' }).click()]);
    expect(descarga.suggestedFilename()).toMatch(/^sig-low-tabla-\d{8}-\d{4}\.siglow$/);
    // MAX_PATH (Windows): la ruta de la descarga de Playwright puede pasar de 260 caracteres y Chromium no podría leerla en setInputFiles;
    // se copia al temporal del sistema, con ruta corta, y se borra al terminar el archivo de pruebas.
    const carpetaCorta = mkdtempSync(join(tmpdir(), 'siglow-bov-'));
    carpetasTemporales.push(carpetaCorta);
    const ruta = join(carpetaCorta, 'tabla.siglow');
    await descarga.saveAs(ruta);
    const texto = readFileSync(ruta, 'utf8');
    expect(JSON.parse(texto)).toMatchObject({ formato: 'sig-low/tabla', v: 1 });
    for (const real of REALES_REI) expect(texto).not.toContain(real);
    await expect(aviso(page, 'M-114')).toContainText('Se descargó sig-low-tabla-');
    await expect(d).toBeHidden();

    // Importar el mismo archivo: conflicto por código (M-113). Primero con una frase equivocada: M-201.
    const entrada = page.locator('[data-prueba="archivo-siglow"]');
    await entrada.setInputFiles(ruta);
    await expect(page.locator('[data-prueba="archivo-elegido"]')).toHaveText('Archivo elegido.');
    const importar = page.getByRole('button', { name: 'Importar', exact: true });
    await expect(importar).toBeDisabled();
    const fraseArchivo = page.getByLabel('Contraseña de la llave del archivo', { exact: true });
    await fraseArchivo.fill('una frase equivocada ficticia');
    await importar.click();
    await expect(page.getByText('Contraseña de la llave incorrecta o archivo dañado.')).toBeVisible({ timeout: 30_000 });
    await expect(fraseArchivo).toHaveValue('');   // M-20: tampoco queda la frase de «Importar»
    await fraseArchivo.fill(FRASE);
    await importar.click();
    const conflicto = page.locator('[data-prueba="conflicto-importar"]');
    await expect(conflicto).toContainText('Ya existe un caso con ese código en este equipo.', { timeout: 30_000 });
    await conflicto.getByRole('button', { name: 'Cargar con otro código' }).click();
    await conflicto.getByLabel('Nuevo código del caso').fill('PRUEBA-BOV-02');
    await conflicto.getByRole('button', { name: 'Cargar con otro código' }).click();
    await expect(aviso(page, 'M-1561')).toHaveText('Se importó el asunto PRUEBA-BOV-02.', { timeout: 30_000 });
    await expect(lista(page)).toHaveCount(2);
    expect([...await lista(page).locator('[data-prueba="codigo"]').allTextContents()].sort()).toEqual(['PRUEBA-BOV-01', 'PRUEBA-BOV-02']);
    await expect(conflicto).toHaveCount(0);
    await sinOriginales(page);

    // «Reemplazar»: el mismo archivo otra vez; el conflicto es ahora por código y por id, y se reemplaza el existente.
    await entrada.setInputFiles(ruta);
    await page.getByLabel('Contraseña de la llave del archivo', { exact: true }).fill(FRASE);
    await importar.click();
    await expect(conflicto).toBeVisible({ timeout: 30_000 });
    await conflicto.getByRole('button', { name: 'Reemplazar', exact: true }).click();
    await expect(aviso(page, 'M-1561')).toHaveText('Se importó el asunto PRUEBA-BOV-01.', { timeout: 30_000 });
    await expect(lista(page)).toHaveCount(2);

    // Borrar un asunto: M-108 con el código en el botón; «Cancelar» no borra; M-109 al borrar.
    await page.getByRole('button', { name: 'Borrar PRUEBA-BOV-02', exact: true }).click();
    const borrar = page.getByRole('alertdialog', { name: 'Borrar PRUEBA-BOV-02' });
    await expect(borrar).toContainText('Se borrará de este navegador la tabla del asunto PRUEBA-BOV-02. No se puede deshacer.');
    await borrar.getByRole('button', { name: 'Cancelar' }).click();
    await expect(lista(page)).toHaveCount(2);
    await page.getByRole('button', { name: 'Borrar PRUEBA-BOV-02', exact: true }).click();
    await borrar.getByRole('button', { name: 'Borrar PRUEBA-BOV-02' }).click();
    await expect(aviso(page, 'M-109')).toContainText('La tabla se eliminó del navegador.');
    await expect(lista(page)).toHaveCount(1);
    await expect(lista(page).locator('[data-prueba="codigo"]')).toHaveText('PRUEBA-BOV-01');
  });

  test('T-BO-01 cambiar la frase de paso: la anterior deja de abrir el asunto y la nueva lo abre; «Abrir» lo deja elegido en Inicio', async ({ page }) => {
    await prepararBoveda(page);
    await page.getByRole('button', { name: 'Cambiar frase de paso PRUEBA-BOV-01', exact: true }).click();
    const d = dialogo(page);
    await expect(d).toContainText('Cambiar la frase de paso de PRUEBA-BOV-01');
    const cambiar = d.getByRole('button', { name: 'Cambiar la contraseña de la llave', exact: true });
    await expect(cambiar).toBeDisabled();
    await d.getByLabel('Contraseña actual de la llave', { exact: true }).fill('una frase equivocada ficticia');
    await d.getByLabel('Contraseña de la llave. Mínimo 15 caracteres; puede usar varias palabras separadas por espacios.', { exact: true }).fill(FRASE_NUEVA);
    await d.getByLabel('Repita la contraseña de la llave', { exact: true }).fill(FRASE_NUEVA);
    await d.getByRole('checkbox', { name: /^Entiendo que Sig-Low no guarda mi frase/ }).check();
    await cambiar.click();
    await expect(d.getByText('Contraseña de la llave incorrecta o archivo dañado.')).toBeVisible({ timeout: 30_000 });
    // M-20 (6.6.5): las tres frases se vacían al terminar el intento, también si falla; se escriben otra vez.
    for (const etiqueta of ['Contraseña actual de la llave', 'Contraseña de la llave. Mínimo 15 caracteres; puede usar varias palabras separadas por espacios.', 'Repita la contraseña de la llave']) {
      await expect(d.getByLabel(etiqueta, { exact: true })).toHaveValue('');
    }
    await d.getByLabel('Contraseña actual de la llave', { exact: true }).fill(FRASE);
    await d.getByLabel('Contraseña de la llave. Mínimo 15 caracteres; puede usar varias palabras separadas por espacios.', { exact: true }).fill(FRASE_NUEVA);
    await d.getByLabel('Repita la contraseña de la llave', { exact: true }).fill(FRASE_NUEVA);
    await cambiar.click();
    await expect(aviso(page, 'M-1560')).toContainText('La frase de paso cambió.', { timeout: 30_000 });
    await expect(d).toBeHidden();

    // «Abrir» lleva a Inicio con el asunto elegido; la frase anterior ya no abre y la nueva sí.
    await page.getByRole('button', { name: 'Abrir PRUEBA-BOV-01', exact: true }).click();
    await expect(h1(page, 'Cargar documento')).toBeVisible();
    const sel = page.getByLabel('Caso guardado', { exact: true });
    await expect(sel.locator('option:checked')).toContainText('PRUEBA-BOV-01');
    await page.getByLabel('Contraseña de la llave del caso', { exact: true }).fill(FRASE);
    await page.getByRole('button', { name: 'Abrir el caso' }).click();
    await expect(page.getByText('Contraseña de la llave incorrecta o archivo dañado.')).toBeVisible({ timeout: 30_000 });
    await page.getByLabel('Contraseña de la llave del caso', { exact: true }).fill(FRASE_NUEVA);
    await page.getByRole('button', { name: 'Abrir el caso' }).click();
    await expect(h1(page, 'Nombres que siempre deben ocultarse')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Ana Ficticia Rojas').first()).toBeVisible();     // la tabla y la lista siguen ahí
  });

  test('T-BO-01 B-21 M-7 el bloqueo de otra pestaña aborta un «Abrir» en curso aunque no haya asunto abierto: Inicio vacía la frase, muestra M-102 y no M-202', async ({ page }) => {
    await prepararBoveda(page);
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(h1(page, 'Cargar documento')).toBeVisible();
    // La otra pestaña ya está cargada (no se pierde tiempo después del clic): solo envía el mensaje del canal de bloqueo (8.2.10).
    const otra = await page.context().newPage();
    await otra.goto('/');
    await expect(h1(otra, 'Cargar documento')).toBeVisible();
    await page.getByLabel('Caso guardado', { exact: true }).selectOption({ index: 1 });
    await page.getByLabel('Contraseña de la llave del caso', { exact: true }).fill(FRASE);
    const abrir = page.getByRole('button', { name: 'Abrir el caso' });
    await abrir.click();
    await otra.evaluate(() => { const c = new BroadcastChannel('siglow-bloqueo'); c.postMessage({ tipo: 'bloquear' }); c.close(); });
    // Mientras deriva la clave el botón está deshabilitado. PC-6-r2 (M-7): el bloqueo vuelve a montar el formulario, así que al
    // abortarse la frase ya no está, el botón sigue deshabilitado (no hay segundo clic que abra el asunto) y se ve M-102.
    await expect(abrir).toBeDisabled();
    await expect(page.locator('[data-prueba="aviso-bloqueo"]')).toContainText('Sig-Low se bloqueó', { timeout: 30_000 });
    await expect(page.getByText('Protegiendo y abriendo el caso en su equipo…')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByLabel('Contraseña de la llave del caso', { exact: true })).toHaveValue('');
    await expect(abrir).toBeDisabled();
    await expect(h1(page, 'Cargar documento')).toBeVisible();
    await expect(page.getByText('Ana Ficticia Rojas')).toHaveCount(0);
    await expect(page.getByText('No se pudo completar la operación.')).toHaveCount(0);
    await expect(page.getByText('Contraseña de la llave incorrecta o archivo dañado.')).toHaveCount(0);
    await otra.close();
  });

  test('T-BO-01 V-18 «Borrar todo» pide escribir BORRAR, elimina la base y vacía la lista (M-111)', async ({ page }) => {
    await prepararBoveda(page);
    await page.getByRole('button', { name: 'Borrar todo', exact: true }).click();
    const d = page.getByRole('alertdialog', { name: 'Borrar todos los casos' });
    await expect(d).toContainText('Se borrarán de este navegador todos los asuntos guardados y sus tablas. No se puede deshacer.');
    const confirmar = d.getByRole('button', { name: 'Borrar todo', exact: true });
    await expect(confirmar).toBeDisabled();
    await d.getByLabel('Escriba BORRAR para confirmar').fill('borrar');
    await expect(confirmar).toBeDisabled();
    await d.getByLabel('Escriba BORRAR para confirmar').fill('BORRAR');
    await expect(confirmar).toBeEnabled();
    await confirmar.click();
    await expect(aviso(page, 'M-111')).toContainText('Los asuntos se eliminaron del navegador.', { timeout: 30_000 });
    await expect(page.locator('[data-prueba="sin-asuntos"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Borrar todo', exact: true })).toBeDisabled();
    expect(await page.evaluate(async () => (await indexedDB.databases()).map((b) => b.name))).not.toContain('siglow-boveda');
    // Inicio ya no lista el asunto.
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page.locator('[data-prueba="sin-asuntos"]')).toBeVisible();
  });
});
