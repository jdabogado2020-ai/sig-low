// Ayudas de las pruebas E2E de «Devolver los datos reales» y «Casos guardados» (PC-6; flujo v1.1). No es una prueba: lo importan
// reinsercion.spec.ts, boveda-ui.spec.ts, privacy-surface.spec.ts y la fase «reinserción» de zero-network.spec.ts. Llevan la app real
// (dist/) hasta una llave consolidada con el flujo nuevo: crear el caso en «Opciones avanzadas», pegar la lista, pegar el texto,
// anonimizar (la vista previa ya trae todo aceptado, D-24), pasar a Descargar y copiar (la copia consolida la numeración, 6.6.4).
// Datos ficticios evidentes (10.1.5).
import { expect, type BrowserContext, type Page } from '@playwright/test';
import {
  abrirAvanzadas, abrirMasFormatos, aDescargar, anonimizar, confirmar, crearCaso, editarLista, esperarBusqueda, etiquetas, h1, irACargar,
  pegarLista, pegarTexto,
} from './lib/flujo';

export const FRASE = 'frase de prueba ficticia ñandú';

/** Tabla de la demo: lista del caso y documento (tres personas de datos ficticios). */
export const LISTA_REI = 'Ana Ficticia Rojas; demandante\nPedro Ejemplo Prueba; demandado';
export const DOCUMENTO_REI = [
  'Señora Ana Ficticia Rojas, cédula de ciudadanía número 1.000.000.001, correo ana.ficticia@ejemplo.test, teléfono 3000000000.',
  'El demandado Pedro Ejemplo Prueba, con cédula 1.000.000.002, vive en la Calle 100 # 00-00 de Bogotá.',
].join('\n');
/**
 * Lo que Descargar copia para ese documento: las etiquetas que la llave recuerda. Cambió con D-24 (la vista previa llega con la
 * propuesta aplicada): el tratamiento «Señora» pasa a la etiqueta de la persona (sugerencia de tramo) y «Bogotá» (bandera con
 * opción) queda reemplazada por [DEPARTAMENTO_1]. Son 8 etiquetas distintas.
 */
export const SALIDA_REI =
  '[DEMANDANTE_1], cédula de ciudadanía número [CC_1], correo [CORREO_1], teléfono [TELÉFONO_1].\n'
  + 'El demandado [DEMANDADO_1], con cédula [CC_2], vive en la [DIRECCIÓN_1] de [DEPARTAMENTO_1].';
/** Valores reales ficticios de esa llave (los que los casos guardados y la red no deben ver nunca). */
export const REALES_REI = ['Ana Ficticia Rojas', 'Pedro Ejemplo Prueba', '1.000.000.001', '1.000.000.002', 'ana.ficticia@ejemplo.test', '3000000000'];

export { h1 };

export interface OpcionesAsunto { codigo?: string; guardar?: boolean }

/**
 * Flujo v1.1 (D-23, D-24): crea el caso con contraseña en «Opciones avanzadas» (en memoria o guardado cifrado), pega la lista de
 * nombres, pega el documento, anonimiza (la vista previa llega con todo aceptado) y sigue a Descargar con la búsqueda terminada.
 */
export async function crearYAnalizar(page: Page, o: OpcionesAsunto = {}): Promise<void> {
  await irACargar(page);
  await crearCaso(page, { codigo: o.codigo ?? 'PRUEBA-REI-01', guardar: o.guardar === true, frase: FRASE });
  await editarLista(page);
  await pegarLista(page, LISTA_REI);
  await pegarTexto(page, DOCUMENTO_REI);
  await anonimizar(page);
  await expect(etiquetas(page).first()).toBeVisible();
  await aDescargar(page);
}

/** En Descargar: marca la confirmación única y copia (la copia consolida la tabla del caso, 6.6.4). «Copiar» está en «Más formatos». */
export async function copiarEnListo(page: Page): Promise<void> {
  await esperarBusqueda(page);
  await confirmar(page);
  await abrirMasFormatos(page);
  await page.getByRole('button', { name: 'Copiar texto anonimizado' }).click();
  await expect(page.locator('[data-aviso="M-84"]')).toBeVisible();
}

/** Del flujo de la demo hasta la pantalla «Devolver los datos reales» con la tabla consolidada del caso (Descargar → Opciones avanzadas). */
export async function llegarAReinsercion(page: Page, o: OpcionesAsunto = {}): Promise<void> {
  await crearYAnalizar(page, o);
  await copiarEnListo(page);
  await abrirAvanzadas(page);
  await page.getByRole('button', { name: 'Devolver los datos reales a un texto' }).click();
  await expect(h1(page, 'Devolver los datos reales')).toBeVisible();
}

export const campoRespuesta = (page: Page) => page.getByRole('textbox', { name: 'Respuesta de la herramienta de IA' });
export const origen = (page: Page) => page.getByRole('combobox', { name: 'Documento de origen' });

/** Pega la respuesta y pulsa «Buscar marcadores». */
export async function pegarYBuscar(page: Page, respuesta: string, conOrigen = false): Promise<void> {
  if (conOrigen) await origen(page).selectOption({ index: 1 });
  await campoRespuesta(page).fill(respuesta);
  await page.getByRole('button', { name: 'Buscar etiquetas' }).click();
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
