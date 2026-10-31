// Ayudas de las pruebas E2E de Reinserción y Bóveda (PC-6). No es una prueba: lo importan reinsercion.spec.ts, boveda-ui.spec.ts y la
// fase «reinserción» de zero-network.spec.ts. Llevan la app real (dist/) hasta una tabla consolidada con el flujo de la demo: crear el
// asunto, pegar la lista, analizar, decidir cada mención con el teclado, pasar por Listo y copiar (la copia consolida la numeración, 6.6.4).
// Datos ficticios evidentes (10.1.5).
import { expect, type BrowserContext, type Page } from '@playwright/test';

export const FRASE = 'frase de prueba ficticia ñandú';

/** Tabla de la demo: lista del caso y documento (tres personas de datos ficticios). */
export const LISTA_REI = 'Ana Ficticia Rojas; demandante\nPedro Ejemplo Prueba; demandado';
export const DOCUMENTO_REI = [
  'Señora Ana Ficticia Rojas, cédula de ciudadanía número 1.000.000.001, correo ana.ficticia@ejemplo.test, teléfono 3000000000.',
  'El demandado Pedro Ejemplo Prueba, con cédula 1.000.000.002, vive en la Calle 100 # 00-00 de Bogotá.',
].join('\n');
/** Lo que Listo muestra para ese documento: los marcadores que la tabla recuerda. */
export const SALIDA_REI =
  'Señora [DEMANDANTE_1], cédula de ciudadanía número [CC_1], correo [CORREO_1], teléfono [TELÉFONO_1].\n'
  + 'El demandado [DEMANDADO_1], con cédula [CC_2], vive en la [DIRECCIÓN_1] de Bogotá.';
/** Valores reales ficticios de esa tabla (los que la Bóveda y la red no deben ver nunca). */
export const REALES_REI = ['Ana Ficticia Rojas', 'Pedro Ejemplo Prueba', '1.000.000.001', '1.000.000.002', 'ana.ficticia@ejemplo.test', '3000000000'];

export const h1 = (page: Page, nombre: string) => page.getByRole('heading', { level: 1, name: nombre });

export interface OpcionesAsunto { codigo?: string; guardar?: boolean }

/** Crea el asunto (en memoria o guardado cifrado), pega la lista, analiza el documento y decide cada mención una por una. */
export async function crearYAnalizar(page: Page, o: OpcionesAsunto = {}): Promise<void> {
  await page.goto('/');
  await expect(h1(page, 'Inicio')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Código del asunto').fill(o.codigo ?? 'PRUEBA-REI-01');
  if (o.guardar === true) {
    await page.getByRole('radio', { name: /^Guardar tabla cifrada/ }).check();
    await page.getByLabel('Frase de paso. Mínimo 15 caracteres; puede usar varias palabras separadas por espacios.', { exact: true }).fill(FRASE);
    await page.getByLabel('Repita la frase de paso', { exact: true }).fill(FRASE);
    await page.getByRole('checkbox', { name: /^Entiendo que Sig-Low no guarda mi frase/ }).check();
  } else {
    await page.getByRole('radio', { name: /^No guardar la tabla/ }).check();
  }
  await page.getByRole('button', { name: 'Crear asunto' }).click();
  await expect(h1(page, 'Lista del caso')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('textbox', { name: 'Texto de la lista' }).fill(LISTA_REI);
  await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
  await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('textbox', { name: 'Texto del documento' }).fill(DOCUMENTO_REI);
  await page.getByRole('button', { name: 'Analizar', exact: true }).click();
  await expect(h1(page, 'Revisión')).toBeVisible({ timeout: 30_000 });
  const marcas = page.getByRole('region', { name: 'Documento con detecciones' }).locator('[data-det]');
  const total = await marcas.count();
  expect(total).toBeGreaterThan(0);
  for (let i = 0; i < total; i++) {
    if (/, pendiente, /.test((await marcas.nth(i).getAttribute('aria-label')) ?? '')) {
      await marcas.nth(i).focus();
      await page.keyboard.press('a');
    }
  }
  await page.locator('[data-prueba="continuar"]').click();
  await expect(h1(page, 'Listo')).toBeVisible();
}

/** En Listo: espera la búsqueda de residuos, marca el recordatorio y copia (la copia consolida la tabla del asunto). */
export async function copiarEnListo(page: Page): Promise<void> {
  await expect(page.locator('[data-prueba="residuos-estado"]')).toContainText('Búsqueda de residuos: ninguno de los', { timeout: 30_000 });
  for (const n of ['^Datos biométricos', '^Documentos con reserva legal', '^La estrategia reservada']) {
    await page.getByRole('checkbox', { name: new RegExp(n) }).check();
  }
  await page.getByRole('button', { name: 'Copiar texto anonimizado' }).click();
  await expect(page.locator('[data-aviso="M-84"]')).toBeVisible();
}

/** Del flujo de la demo hasta la pantalla Reinserción con la tabla consolidada del asunto. */
export async function llegarAReinsercion(page: Page, o: OpcionesAsunto = {}): Promise<void> {
  await crearYAnalizar(page, o);
  await copiarEnListo(page);
  await page.getByRole('button', { name: 'Reinsertar una respuesta' }).click();
  await expect(h1(page, 'Reinserción')).toBeVisible();
}

export const campoRespuesta = (page: Page) => page.getByRole('textbox', { name: 'Respuesta de la herramienta de IA' });
export const origen = (page: Page) => page.getByRole('combobox', { name: 'Documento de origen' });

/** Pega la respuesta y pulsa «Buscar marcadores». */
export async function pegarYBuscar(page: Page, respuesta: string, conOrigen = false): Promise<void> {
  if (conOrigen) await origen(page).selectOption({ index: 1 });
  await campoRespuesta(page).fill(respuesta);
  await page.getByRole('button', { name: 'Buscar marcadores' }).click();
}

/** El texto del resultado de Reinserción tal como lo copiaría el modelo: solo los trozos de datos, sin insignias. */
export async function textoDelResultado(page: Page): Promise<string> {
  return page.locator('[data-prueba="resultado-real"]').evaluate((p) =>
    [...p.querySelectorAll('.linea-real')].map((l) => [...l.querySelectorAll('[data-g]')].map((e) => e.textContent ?? '').join('')).join('\n'));
}

/**
 * Lee el portapapeles del sistema desde una página auxiliar de otro origen (la política de permisos de la app bloquea `clipboard-read`,
 * V-33): devuelve los tipos de cada elemento y el texto plano.
 */
export async function leerPortapapeles(context: BrowserContext): Promise<{ tipos: string[]; texto: string }> {
  const origenAux = 'https://auxiliar.ejemplo.test';
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: origenAux });
  await context.route(`${origenAux}/**`, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>auxiliar</title><p>auxiliar</p>' }));
  const aux = await context.newPage();
  try {
    await aux.goto(`${origenAux}/`);
    await aux.bringToFront();
    return await aux.evaluate(async () => {
      const items = await navigator.clipboard.read();
      const tipos = items.flatMap((i) => [...i.types]);
      const plano = items.find((i) => i.types.includes('text/plain'));
      return { tipos, texto: plano === undefined ? '' : await (await plano.getType('text/plain')).text() };
    });
  } finally {
    await aux.close();
  }
}

// El volcado del almacenamiento (T-RD-06) es el del arnés de PD-5a.
export { textoDelVolcado, volcarAlmacenamiento } from './lib/almacenamiento';
