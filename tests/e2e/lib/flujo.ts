// Ayudas E2E del flujo «Cargar y listo» de la v1.1 (F2, D-23; F3, D-24). No es una prueba: lo importan los specs que recorren la
// app. Cargar documento (Inicio) → Analizando → Vista previa (todo aplicado) → Descargar (una sola confirmación). La lista de
// nombres, el detector de nombres adicional y la llave para devolver los datos reales están en «Opciones avanzadas». La revisión de
// la v1.0 sigue en «Revisar dato por dato». Datos ficticios evidentes (10.1.5).
import { expect, type Page } from '@playwright/test';

export const TITULO = {
  cargar: 'Cargar documento', analizando: 'Analizando', vista: 'Vista previa', descargar: 'Descargar', detalle: 'Revisar dato por dato',
  lista: 'Nombres que siempre deben ocultarse', reinsercion: 'Devolver los datos reales', boveda: 'Casos guardados',
} as const;

export const h1 = (page: Page, nombre: string) => page.getByRole('heading', { level: 1, name: nombre });

/** Abre la app y espera «Cargar documento». */
export async function irACargar(page: Page, url = '/'): Promise<void> {
  await page.goto(url);
  await expect(h1(page, TITULO.cargar)).toBeVisible({ timeout: 30_000 });
}

/** Despliega «Opciones avanzadas» de la pantalla actual (Cargar o Descargar), si está plegado. */
export async function abrirAvanzadas(page: Page): Promise<void> {
  const d = page.locator('details[data-prueba="opciones-avanzadas"]');
  if (!(await d.evaluate((e) => (e as HTMLDetailsElement).open))) await d.locator('summary').click();
}

export interface OpcionesCaso { codigo?: string; guardar?: boolean; frase?: string }
export const FRASE_CASO = 'frase de prueba ficticia ñandú';

/** «Opciones avanzadas» → «Guardar la llave…»: crea un caso con código (y con contraseña si `guardar`). Se queda en Cargar. */
export async function crearCaso(page: Page, o: OpcionesCaso = {}): Promise<void> {
  await abrirAvanzadas(page);
  await page.getByLabel('Código del caso').fill(o.codigo ?? 'PRUEBA-001');
  if (o.guardar === true) {
    const frase = o.frase ?? FRASE_CASO;
    await page.getByRole('radio', { name: /^Guardar la llave en este equipo/ }).check();
    await page.getByLabel('Contraseña de la llave. Mínimo 15 caracteres; puede usar varias palabras separadas por espacios.', { exact: true }).fill(frase);
    await page.getByLabel('Repita la contraseña de la llave', { exact: true }).fill(frase);
    await page.getByRole('checkbox', { name: /^Entiendo que Sig-Low no guarda mi contraseña/ }).check();
  } else {
    await page.getByRole('radio', { name: /^No guardar la llave/ }).check();
  }
  await page.getByRole('button', { name: 'Crear caso' }).click();
  await expect(page.locator('[data-prueba="caso-abierto"]')).toBeVisible({ timeout: 30_000 });
}

/** «Opciones avanzadas» → «Editar los nombres…»: abre la lista (con el caso efímero si no hay uno). */
export async function editarLista(page: Page): Promise<void> {
  await abrirAvanzadas(page);
  await page.getByRole('button', { name: /^Editar los nombres/ }).click();
  await expect(h1(page, TITULO.lista)).toBeVisible();
}

/** En la lista: pega las líneas, las agrega y vuelve a Cargar. */
export async function pegarLista(page: Page, lineas: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Texto de la lista' }).fill(lineas);
  await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
  await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(h1(page, TITULO.cargar)).toBeVisible();
}

/** Pestaña «Pegar texto» y el texto del documento. */
export async function pegarTexto(page: Page, texto: string): Promise<void> {
  await page.getByRole('tab', { name: 'Pegar texto' }).click();
  await page.getByRole('textbox', { name: 'Texto del documento' }).fill(texto);
}

/** «Anonimizar» y espera la vista previa. */
export async function anonimizar(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Anonimizar', exact: true }).click();
  await expect(h1(page, TITULO.vista)).toBeVisible({ timeout: 30_000 });
}

/** La búsqueda de datos que se escaparon terminó sin hallazgos (vista previa o descarga). */
export async function esperarBusqueda(page: Page): Promise<void> {
  await expect(page.locator('[data-prueba="residuos-estado"]')).toContainText('ninguno de los', { timeout: 30_000 });
}

/** Región del documento anonimizado de la vista previa y sus etiquetas (cada una con `data-det`). */
export const vistaPrevia = (page: Page) => page.getByRole('region', { name: 'Vista previa del documento anonimizado' });
export const etiquetas = (page: Page) => vistaPrevia(page).locator('button.etiqueta');

/** Vista previa → «Revisar dato por dato». */
export async function aDetalle(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Revisar dato por dato' }).click();
  await expect(h1(page, TITULO.detalle)).toBeVisible();
}

/** Vista previa → «Continuar a descargar»; espera la búsqueda. */
export async function aDescargar(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Continuar a descargar' }).click();
  await expect(h1(page, TITULO.descargar)).toBeVisible();
  await esperarBusqueda(page);
}

/** La confirmación única de D-24. */
export async function confirmar(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: /^Revisé la vista previa/ }).check();
}

/** Descargar → «Más formatos» desplegado (copiar, .txt e informe). */
export async function abrirMasFormatos(page: Page): Promise<void> {
  const d = page.locator('details[data-prueba="mas-formatos"]');
  if (!(await d.evaluate((e) => (e as HTMLDetailsElement).open))) await d.locator('summary').click();
}

/** Cargar → pegar → anonimizar y esperar la búsqueda de datos que se escaparon en la vista previa. */
export async function anonimizarTexto(page: Page, texto: string): Promise<void> {
  await pegarTexto(page, texto);
  await anonimizar(page);
  await esperarBusqueda(page);
}
