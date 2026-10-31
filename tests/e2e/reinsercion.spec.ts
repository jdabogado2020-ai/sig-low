// Pantalla Reinserción (PC-6; 8.2.8, 6.10, 8.7): en la app real (dist/), con el flujo de la demo hasta una tabla consolidada.
// T-RI-10 (tabla bloqueada, marcador de otro asunto, aviso de datos reales al copiar y descargar, volcado del almacenamiento),
// INV-N02, INV-N04 e INV-N05, T-IU-05 (estados), T-IU-06 (búsqueda propia en Reinserción, V-29) y T-PV-13 (URL blob: revocadas).
// Datos ficticios evidentes (10.1.5). El resultado con datos reales vive solo en memoria: aquí se comprueba que no sale a ningún lado.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  campoRespuesta, FRASE, h1, leerPortapapeles, llegarAReinsercion, origen, pegarYBuscar, REALES_REI, textoDelResultado,
  textoDelVolcado, volcarAlmacenamiento,
} from './ayudas-reinsercion';

test.describe.configure({ timeout: 120_000 });
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const RESPUESTA =
  '[DEMANDANTE_1] presentó la tutela. Demandante 1 firmó. [TESTIGO_3] declaró. La cédula es [CC_1].';
const ESPERADO =
  'Ana Ficticia Rojas presentó la tutela. Ana Ficticia Rojas firmó. [TESTIGO_3] declaró. La cédula es 1.000.000.001.';

const alterados = (page: Page) => page.locator('[data-prueba="alerta-alterado"]');
const desconocidos = (page: Page) => page.locator('[data-prueba="alerta-desconocido"]');
const resultado = (page: Page) => page.locator('[data-prueba="resultado"]');

test.describe('Reinserción (PC-6)', () => {
  test('T-RI-10 INV-N02 INV-N04 INV-N05 @humo alertas una a una y aviso de datos reales al copiar y al descargar; el resultado no sale del texto en memoria', async ({ page, context }) => {
    const consola: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consola.push(m.type()); });
    page.on('pageerror', () => { consola.push('pageerror'); });
    await page.addInitScript(() => {
      const vivas = new Set<string>();
      const crear = URL.createObjectURL.bind(URL);
      const revocar = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (o: Blob | MediaSource): string => { const u = crear(o); vivas.add(u); return u; };
      URL.revokeObjectURL = (u: string): void => { vivas.delete(u); revocar(u); };
      (globalThis as unknown as { __blobsVivos: () => number }).__blobsVivos = () => vivas.size;
    });
    await llegarAReinsercion(page, { guardar: true });
    await expect(page.locator('[data-prueba="asunto-reinsercion"]')).toHaveText('Asunto: PRUEBA-REI-01. Para trabajar con otro asunto, use «Cambiar de asunto».');
    // Sin documento de origen elegido: M-93 y nada de faltantes (T-RI-04).
    await expect(page.locator('[data-prueba="aviso-origen"]')).toContainText('No eligió el documento de origen');
    await expect(origen(page).locator('option')).toHaveText([/^No sé o son varios$/, /^Documento 1 · Texto pegado · /]);
    await pegarYBuscar(page, RESPUESTA, true);

    // Resumen por clase: 1 alterado, 1 desconocido, 5 faltantes del documento de origen.
    await expect(page.locator('[data-prueba="resumen-alterados"]')).toContainText('1 marcadores llegaron modificados');
    await expect(page.locator('[data-prueba="resumen-desconocidos"]')).toContainText('1 marcadores no están en la tabla de este asunto');
    await expect(page.locator('[data-prueba="resumen-faltantes"]')).toContainText('5 marcadores del documento no aparecen en la respuesta');
    // INV-N02: mientras haya alertas sin decidir no hay texto con datos reales, ni botón de copiar ni de descargar.
    await expect(page.locator('[data-prueba="faltan-decisiones"]')).toContainText('Decisiones pendientes: 2.');
    await expect(resultado(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Copiar texto con datos reales' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Descargar .txt' })).toHaveCount(0);

    // Alterado: token, propuesta y tres decisiones. Desconocido: nunca «Reemplazar por el dato real».
    await expect(alterados(page).locator('[data-prueba="token"]')).toHaveText('Encontrado: Demandante 1');
    await expect(alterados(page).locator('[data-prueba="propuesta"]')).toContainText('Propuesta: Ana Ficticia Rojas');
    for (const n of ['Reemplazar por el dato real', 'Dejar como está', 'Editar']) await expect(alterados(page).getByRole('button', { name: n })).toBeVisible();
    await expect(desconocidos(page).getByRole('button', { name: 'Reemplazar por el dato real' })).toHaveCount(0);
    await expect(desconocidos(page).getByRole('button', { name: 'Dejar como está' })).toBeVisible();
    await expect(desconocidos(page).getByRole('button', { name: 'Editar' })).toBeVisible();
    // No existe un control que decida todas las alertas a la vez.
    await expect(page.getByRole('button', { name: /todos los alterados|todas las alertas|aceptar todo/i })).toHaveCount(0);

    await alterados(page).getByRole('button', { name: 'Reemplazar por el dato real' }).click();
    await expect(alterados(page).locator('[data-prueba="estado-alerta"]')).toHaveText('Se reemplazará por el dato real.');
    await expect(page.locator('[data-prueba="faltan-decisiones"]')).toContainText('Decisiones pendientes: 1.');
    await desconocidos(page).getByRole('button', { name: 'Dejar como está' }).click();
    // Con las decisiones tomadas faltan los marcadores faltantes: INV-N02 pide reconocerlos.
    await expect(page.locator('[data-prueba="faltan-decisiones"]')).toContainText('Falta reconocer los marcadores faltantes');
    await expect(resultado(page)).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Revisé los marcadores faltantes.' }).check();
    await expect(resultado(page)).toBeVisible();
    await expect(page.locator('[data-prueba="faltan-decisiones"]')).toHaveCount(0);

    // Resultado: texto exacto, datos reales resaltados y con insignia, M-98 permanente y M-123.
    expect(await textoDelResultado(page)).toBe(ESPERADO);
    await expect(page.locator('[data-prueba="resultado-real"] mark[data-dato-real]')).toHaveText(['Ana Ficticia Rojas', 'Ana Ficticia Rojas', '1.000.000.001']);
    await expect(page.locator('[data-prueba="resultado-real"] .insignia-real')).toHaveCount(3);
    await expect(page.locator('[data-prueba="aviso-datos-reales"]')).toContainText('Este texto contiene los datos reales. No lo pegue en herramientas de IA.');
    await expect(page.locator('[data-prueba="aviso-genero"]')).toContainText('Revise el género y el número');
    const region = page.getByRole('region', { name: 'Texto con los datos reales resaltados' });
    await expect(region).toHaveAttribute('translate', 'no');
    await expect(region).toHaveAttribute('spellcheck', 'false');
    // El nombre accesible de la región y de los controles no lleva datos reales (INV-G03).
    for (const n of await page.locator('[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))) {
      for (const real of REALES_REI) expect(n).not.toContain(real);
    }

    // INV-N05 · copiar: M-99 en cada uso; «Cancelar» no copia nada.
    const copiar = page.getByRole('button', { name: 'Copiar texto con datos reales' });
    await copiar.click();
    const dialogo = page.getByRole('alertdialog', { name: 'Texto con datos reales' });
    await expect(dialogo).toContainText('Va a copiar o descargar texto con datos reales. Úselo solo dentro de su organización.');
    await dialogo.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialogo).toBeHidden();
    await expect(page.locator('[data-aviso="M-124"]')).toHaveCount(0);
    expect((await leerPortapapeles(context)).texto).not.toContain('Ana Ficticia');
    await page.bringToFront();
    await copiar.click();
    await dialogo.getByRole('button', { name: 'Continuar con datos reales' }).click();
    await expect(page.locator('[data-aviso="M-124"]')).toContainText('Copió texto con datos reales.');
    const copiado = await leerPortapapeles(context);
    expect(copiado.tipos).toEqual(['text/plain']);
    expect(copiado.texto).toBe(ESPERADO);
    await page.bringToFront();
    // Cada uso vuelve a pedir la confirmación.
    await copiar.click();
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole('button', { name: 'Cancelar' }).click();

    // «Vaciar portapapeles» deja el portapapeles vacío (M-86).
    await page.getByRole('button', { name: 'Vaciar portapapeles' }).click();
    await expect(page.locator('[data-aviso="M-86"]')).toBeVisible();
    expect((await leerPortapapeles(context)).texto).toBe('');
    await page.bringToFront();

    // INV-N05 · descargar: M-99 y nombre neutro; el archivo es UTF-8 con BOM y CRLF; la URL blob: se revoca (T-PV-13, V-48).
    await page.getByRole('button', { name: 'Descargar .txt' }).click();
    await expect(dialogo).toBeVisible();
    const [descarga] = await Promise.all([
      page.waitForEvent('download'),
      dialogo.getByRole('button', { name: 'Continuar con datos reales' }).click(),
    ]);
    expect(descarga.suggestedFilename()).toMatch(/^sig-low-reinsertado-\d{8}-\d{4}\.txt$/);
    const bytes = readFileSync((await descarga.path()) as string);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString('utf8').slice(1)).toBe(ESPERADO.replace(/\n/g, '\r\n') + '\r\n');
    await expect(page.locator('[data-aviso="M-88"]')).toContainText('Se descargó sig-low-reinsertado-');
    expect(await page.evaluate(() => (globalThis as unknown as { __blobsVivos: () => number }).__blobsVivos())).toBe(0);

    // INV-N04 · el texto reinsertado no queda en ningún almacenamiento, ni en la URL, el título o la consola.
    const volcado = textoDelVolcado(await volcarAlmacenamiento(page));
    for (const real of REALES_REI) expect(volcado).not.toContain(real);
    expect(volcado).not.toContain('tutela');
    expect(await page.title()).toBe('Sig-Low');
    expect(consola).toEqual([]);
  });

  test('T-RI-10 INV-G09 bloquear borra el texto reinsertado; con la tabla bloqueada no hay reinserción y la frase la vuelve a abrir', async ({ page }) => {
    await llegarAReinsercion(page, { guardar: true });
    await pegarYBuscar(page, '[DEMANDANTE_1] presentó la tutela.');
    await expect(resultado(page)).toBeVisible();
    expect(await textoDelResultado(page)).toBe('Ana Ficticia Rojas presentó la tutela.');
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(h1(page, 'Inicio')).toBeVisible();
    await expect(page.locator('[data-prueba="aviso-bloqueo"]')).toContainText('Sig-Low se bloqueó');
    await expect(page.locator('[data-prueba="resultado-real"]')).toHaveCount(0);
    const cuerpo = (await page.locator('body').innerText()) + (await page.content());
    for (const real of REALES_REI) expect(cuerpo).not.toContain(real);
    expect(cuerpo).not.toContain('tutela');
    // Sin la frase no hay Reinserción: el botón sigue deshabilitado.
    const reinsertar = page.getByRole('button', { name: 'Reinsertar una respuesta' });
    await expect(reinsertar).toBeDisabled();
    const sel = page.getByLabel('Asunto guardado', { exact: true });
    await sel.selectOption({ index: 1 });
    await expect(reinsertar).toBeDisabled();
    await page.getByLabel('Frase de paso del asunto', { exact: true }).fill(FRASE);
    await reinsertar.click();
    await expect(h1(page, 'Reinserción')).toBeVisible({ timeout: 30_000 });
    // La tabla cifrada volvió: el marcador se reemplaza como antes.
    await origen(page).selectOption({ index: 1 });
    await pegarYBuscar(page, '[CC_1] y [CC_2].', true);
    await page.getByRole('checkbox', { name: 'Revisé los marcadores faltantes.' }).check();
    expect(await textoDelResultado(page)).toBe('1.000.000.001 y 1.000.000.002.');
  });

  test('T-RI-10 un marcador de otro asunto es desconocido: solo «Dejar como está» o «Editar», y lo escrito no es dato real', async ({ page }) => {
    await llegarAReinsercion(page);
    await pegarYBuscar(page, 'Declaró [DEMANDANTE_9] y [CC_12].');
    await expect(page.locator('[data-prueba="resumen-desconocidos"]')).toContainText('2 marcadores no están en la tabla de este asunto');
    await expect(desconocidos(page)).toHaveCount(2);
    await expect(desconocidos(page).getByRole('button', { name: 'Reemplazar por el dato real' })).toHaveCount(0);
    await expect(resultado(page)).toHaveCount(0);
    await desconocidos(page).nth(1).getByRole('button', { name: 'Dejar como está' }).click();
    await desconocidos(page).nth(0).getByRole('button', { name: 'Editar' }).click();
    await page.getByRole('textbox', { name: 'Texto que quedará en lugar del marcador' }).fill('la parte actora');
    await page.getByRole('button', { name: 'Aplicar' }).click();
    await expect(desconocidos(page).nth(0).locator('[data-prueba="estado-alerta"]')).toHaveText('Se reemplazará por el texto que escribió.');
    await expect(resultado(page)).toBeVisible();
    expect(await textoDelResultado(page)).toBe('Declaró la parte actora y [CC_12].');
    await expect(page.locator('[data-prueba="resultado-real"] mark')).toHaveCount(0);
    // «Editar» y volver a decidir cambia el resultado; «Cancelar edición» no decide nada.
    await desconocidos(page).nth(1).getByRole('button', { name: 'Editar' }).click();
    await page.getByRole('button', { name: 'Cancelar edición' }).click();
    expect(await textoDelResultado(page)).toBe('Declaró la parte actora y [CC_12].');
  });

  test('T-RI-10 T-IU-08 INV-N01 los alterados se deciden en grupo por marcador, nunca todos a la vez; los exactos se pueden dejar como están', async ({ page }) => {
    await llegarAReinsercion(page);
    await pegarYBuscar(page, '[DEMANDANTE 1] y Demandante 1 firmaron; [CC 1] y [CORREO_1].');
    await expect(alterados(page)).toHaveCount(3);
    // Un grupo por marcador con más de una aparición; el [CC_1] solo aparece una vez y no lleva grupo.
    const grupos = page.locator('[data-prueba="grupo-marcador"]');
    await expect(grupos).toHaveCount(1);
    await expect(grupos).toContainText('Todas las apariciones de [DEMANDANTE_1] (2)');
    await grupos.getByRole('button', { name: 'Reemplazar las 2 por el dato real' }).click();
    await expect(alterados(page).locator('[data-prueba="estado-alerta"]')).toHaveText([
      'Se reemplazará por el dato real.', 'Se reemplazará por el dato real.', 'Sin decidir.',
    ]);
    await expect(resultado(page)).toHaveCount(0);
    await alterados(page).nth(2).getByRole('button', { name: 'Dejar como está' }).click();
    await expect(resultado(page)).toBeVisible();
    expect(await textoDelResultado(page)).toBe('Ana Ficticia Rojas y Ana Ficticia Rojas firmaron; [CC 1] y ana.ficticia@ejemplo.test.');
    // Exactos: lista plegable con «Dejar como está»; al dejarlo el marcador queda en el texto y no se resalta.
    await page.locator('[data-prueba="exactos"] summary').click();
    await page.locator('[data-prueba="alerta-exacto"]').getByRole('button', { name: 'Dejar como está' }).click();
    expect(await textoDelResultado(page)).toBe('Ana Ficticia Rojas y Ana Ficticia Rojas firmaron; [CC 1] y [CORREO_1].');
    await expect(page.locator('[data-prueba="resultado-real"] mark')).toHaveCount(2);
    await page.locator('[data-prueba="alerta-exacto"]').getByRole('button', { name: 'Reemplazar por el dato real' }).click();
    expect(await textoDelResultado(page)).toBe('Ana Ficticia Rojas y Ana Ficticia Rojas firmaron; [CC 1] y ana.ficticia@ejemplo.test.');
  });

  test('T-IU-05 sin marcadores: M-94; editar la respuesta invalida lo encontrado; el campo lleva los atributos de 8.7 y un id neutro', async ({ page }) => {
    await llegarAReinsercion(page);
    const campo = campoRespuesta(page);
    for (const [a, v] of [['spellcheck', 'false'], ['autocomplete', 'off'], ['autocorrect', 'off'], ['autocapitalize', 'off'], ['translate', 'no'], ['data-gramm', 'false']] as const) {
      await expect(campo).toHaveAttribute(a, v);
    }
    expect(await campo.getAttribute('id')).toMatch(/^c\d+$/);
    expect(await campo.getAttribute('name')).toMatch(/^c\d+$/);
    await expect(page.getByRole('button', { name: 'Buscar marcadores' })).toBeDisabled();
    await pegarYBuscar(page, 'Respuesta sin ningún marcador.');
    await expect(page.locator('[data-prueba="sin-marcadores"]')).toContainText('No se encontraron marcadores en el texto pegado.');
    await expect(page.locator('[data-prueba="alertas"]')).toHaveCount(0);
    await campo.fill('[DEMANDANTE_1]');
    await expect(page.locator('[data-prueba="sin-marcadores"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Buscar marcadores' }).click();
    await expect(resultado(page)).toBeVisible();
    // Cambiar el texto de la respuesta esconde el resultado: hay que volver a buscar.
    await campo.fill('[DEMANDANTE_1] otra vez');
    await expect(resultado(page)).toHaveCount(0);
    // Sin tabla de otro asunto: la pantalla pide Inicio cuando no hay asunto abierto.
    await expect(page.locator('[data-prueba="reinsercion-no-disponible"]')).toHaveCount(0);
  });

  test('T-IU-06 V-29 Ctrl+F y F3 abren la búsqueda propia de Reinserción; recorre las coincidencias del resultado sin tildes ni mayúsculas', async ({ page }) => {
    await llegarAReinsercion(page);
    await pegarYBuscar(page, '[DEMANDANTE_1] firmó. La señora Ana Ficticia Rojas confirmó. Dirección: [DIRECCIÓN_1].');
    await expect(resultado(page)).toBeVisible();
    const buscador = page.getByLabel('Buscar en el documento', { exact: true });
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('Control+F');
    await expect(buscador).toBeFocused();
    await page.locator('h1').click();
    await page.keyboard.press('F3');
    await expect(buscador).toBeFocused();
    await buscador.fill('ana ficticia');
    await expect(page.locator('[data-prueba="busqueda-estado"]')).toHaveText('1 de 2');
    await expect(page.locator('[data-prueba="resultado-real"] .coincidencia')).toHaveCount(2);
    await expect(page.locator('[data-prueba="resultado-real"] .coincidencia-actual')).toHaveCount(1);
    await buscador.press('Enter');
    await expect(page.locator('[data-prueba="busqueda-estado"]')).toHaveText('2 de 2');
    await buscador.press('Shift+Enter');
    await expect(page.locator('[data-prueba="busqueda-estado"]')).toHaveText('1 de 2');
    await buscador.fill('direccion');
    await expect(page.locator('[data-prueba="busqueda-estado"]')).toHaveText('1 de 1');
    await buscador.fill('zzzz');
    await expect(page.locator('[data-prueba="busqueda-estado"]')).toHaveText('Sin coincidencias');
    await expect(page.getByText('La búsqueda del navegador puede enviar el texto de la página a servicios en línea.')).toBeVisible();
  });

  test('INV-N05 Ctrl + C sobre el resultado escribe solo text/plain tomado del modelo, sin confirmación, y muestra M-124', async ({ page, context }) => {
    await llegarAReinsercion(page);
    await pegarYBuscar(page, '[DEMANDANTE_1] y [CC_1].');
    await expect(resultado(page)).toBeVisible();
    await page.locator('[data-prueba="resultado-real"]').focus();
    await page.evaluate(() => {
      const p = document.querySelector('[data-prueba="resultado-real"]') as HTMLElement;
      const r = document.createRange();
      r.selectNodeContents(p);
      const s = getSelection() as Selection;
      s.removeAllRanges();
      s.addRange(r);
    });
    await page.keyboard.press('Control+C');
    const leido = await leerPortapapeles(context);
    await page.bringToFront();
    expect(leido.tipos).toEqual(['text/plain']);
    expect(leido.texto).toBe('Ana Ficticia Rojas y 1.000.000.001.');
    await expect(page.locator('[data-aviso="M-124"]')).toBeVisible();
    // Una selección parcial se copia desde el modelo: un tramo de un dato real.
    await page.evaluate(() => {
      const m = document.querySelector('[data-prueba="resultado-real"] mark') as HTMLElement;
      const r = document.createRange();
      r.setStart(m.firstChild as Text, 4);
      r.setEnd(m.firstChild as Text, 12);
      const s = getSelection() as Selection;
      s.removeAllRanges();
      s.addRange(r);
    });
    await page.keyboard.press('Control+C');
    expect((await leerPortapapeles(context)).texto).toBe('Ficticia');
  });

  test('T-RI-10 salir: M-100 pide confirmar cuando hay resultado y «Salir y borrar» vacía la pantalla; «Nuevo documento del asunto» va a Entrada', async ({ page }) => {
    await llegarAReinsercion(page);
    await pegarYBuscar(page, '[DEMANDANTE_1] firmó.');
    await expect(resultado(page)).toBeVisible();
    await page.getByRole('button', { name: 'Salir', exact: true }).click();
    const aviso = page.getByRole('alertdialog', { name: 'Salir de Reinserción' });
    await expect(aviso).toContainText('Al salir de esta pantalla se borra el texto con datos reales.');
    await aviso.getByRole('button', { name: 'Quedarme' }).click();
    await expect(h1(page, 'Reinserción')).toBeVisible();
    await expect(resultado(page)).toBeVisible();
    await page.getByRole('button', { name: 'Nuevo documento del asunto' }).click();
    await page.getByRole('alertdialog', { name: 'Salir de Reinserción' }).getByRole('button', { name: 'Salir y borrar' }).click();
    await expect(h1(page, 'Entrada')).toBeVisible();
    const cuerpo = (await page.locator('body').innerText()) + (await page.content());
    for (const real of REALES_REI) expect(cuerpo).not.toContain(real);
    // Sin resultado, salir no pide confirmación y la pantalla vuelve vacía.
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(h1(page, 'Inicio')).toBeVisible();
  });

  test('T-PV-24 INV-V01 la pantalla no muestra ni copia la tabla completa en claro; «Cambiar de asunto» sin resultado vuelve a Inicio sin pedir confirmación', async ({ page }) => {
    await llegarAReinsercion(page);
    // Antes de pegar nada, la pantalla (incluidos sus atributos) no contiene ningún valor real de la tabla ni sus marcadores.
    const cuerpo = (await page.locator('body').innerText()) + (await page.content());
    for (const real of REALES_REI) expect(cuerpo).not.toContain(real);
    // Una respuesta con un solo marcador solo propone ese valor, nunca el resto de la tabla.
    await pegarYBuscar(page, 'Declaró Demandante 1.');
    const tras = (await page.locator('body').innerText()) + (await page.content());
    expect(tras).toContain('Ana Ficticia Rojas');
    for (const real of REALES_REI.filter((r) => r !== 'Ana Ficticia Rojas')) expect(tras).not.toContain(real);
    await page.getByRole('button', { name: 'Cambiar de asunto' }).click();
    await expect(h1(page, 'Inicio')).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.locator('[data-prueba="resultado-real"]')).toHaveCount(0);
  });
});
