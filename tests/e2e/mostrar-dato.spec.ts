// F8 (v1.1.1) · «Mostrar el dato original aquí» deja el dato a la vista, en cada tipo de dato y en cada origen. Con la v1.1.0, cuando
// el dato tenía otra mención oculta (una persona de la lista nombrada dos veces, un lugar repetido, una palabra de la lista), la
// búsqueda automática de datos que se escaparon lo volvía a encontrar en la salida y la propuesta lo ocultaba otra vez: el abogado
// pulsaba «Mostrar» y nada cambiaba. Cada caso abre la vista previa con el flujo real (pegar → Anonimizar, reglas y lista; el
// detector de nombres adicional, con la ventana simulada del gancho de medición), muestra una etiqueta y comprueba que el dato
// sigue a la vista después de la búsqueda de la vista previa y de la de Descargar. Datos ficticios evidentes (10.1.5); los lugares
// son municipios reales de la DIVIPOLA (no son datos personales).
import { expect, type Page } from '@playwright/test';

import { anonimizar, aDescargar, editarLista, esperarBusqueda, h1, irACargar, pegarLista, pegarTexto, TITULO, vistaPrevia } from './lib/flujo';
import { testMedicion } from './lib/medicion';

const LISTA = ['Ana Ficticia Rojas; demandante', 'Pedro Ejemplo Prueba; demandado', 'Carlos Ficticio Rojas; testigo'].join('\n');
const TEXTO = [
  'El Juzgado Tercero Civil del Circuito de Cartago ordenó el trámite. El Juzgado Promiscuo Municipal de Granada recibió el oficio.',
  'Bogotá, 15 de marzo de 2024',
  'Demandante: Ana Ficticia Rojas, de 34 años de edad, identificada con C.C. 1.000.000.001, correo ana.ficticia@ejemplo.test, domiciliada en la Calle 100 # 00-00 de Bogotá.',
  'Demandada: Ferretería Ejemplo S.A.S., NIT 900.000.001-7, representada por Pedro Ejemplo Prueba. La gerente general de Ferretería Ejemplo firmó.',
  'La señora Rojas reclama la suma de $ 5.000.000. El testigo Carlos Ficticio Rojas declaró. Diagnóstico CIE-10 G35.',
  'Ana Ficticia Rojas insistió el 1 de abril de 2024. Pedro Ejemplo Prueba respondió. La niña con T.I. 1.000.000.002 asistió.',
].join('\n');

type Gancho = {
  cargar(t: string, m?: string, p?: string): Promise<number>;
  incorporarVentana(t: string[], v: number, total: number): Promise<number>;
};

const menu = (page: Page) => page.locator('[data-prueba="menu-etiqueta"]');

async function abrirConReglasYLista(page: Page, texto = TEXTO): Promise<void> {
  await irACargar(page);
  await editarLista(page);
  await pegarLista(page, LISTA);
  await pegarTexto(page, texto);
  await anonimizar(page);
  await esperarBusqueda(page);
}

/**
 * Muestra el dato de la etiqueta `n` (desde 0) con el texto `etiqueta` y comprueba que `original` queda a la vista: al momento, tras
 * la búsqueda de la vista previa, tras la de Descargar y al volver. `contexto` es el texto que lo rodea en la salida.
 */
async function mostrarYComprobar(page: Page, etiqueta: string, n: number, original: string, contexto: string): Promise<void> {
  const boton = vistaPrevia(page).locator('button.etiqueta', { hasText: etiqueta }).nth(n);
  await boton.click();
  await menu(page).getByRole('button', { name: 'Mostrar el dato original aquí' }).click();
  await expect(menu(page)).toHaveCount(0);
  const visto = vistaPrevia(page).locator('button.revelado', { hasText: original });
  await expect(visto.first()).toBeVisible();
  // La búsqueda automática corre después de cada cambio: se espera a que termine y el dato sigue a la vista.
  await expect.poll(async () => page.evaluate(() => document.querySelector('[data-prueba="residuos-estado"]')?.textContent ?? ''), { timeout: 30_000 })
    .toContain('ninguno de los');
  await expect(vistaPrevia(page)).toContainText(contexto);
  await aDescargar(page);
  await page.getByRole('button', { name: 'Volver a la vista previa' }).click();
  await expect(h1(page, TITULO.vista)).toBeVisible();
  await esperarBusqueda(page);
  await expect(visto.first()).toBeVisible();
  await expect(vistaPrevia(page)).toContainText(contexto);
}

testMedicion.describe('F8 «Mostrar el dato original aquí» deja el dato a la vista', () => {
  testMedicion.describe.configure({ timeout: 120_000 });

  // Los casos que fallaban con la v1.1.0 (6408759): el dato tiene otra mención que sigue oculta.
  testMedicion('F8 persona de la lista nombrada dos veces: mostrar una mención no la vuelve a ocultar', async ({ page }) => {
    await abrirConReglasYLista(page);
    await mostrarYComprobar(page, '[DEMANDANTE_1]', 0, 'Ana Ficticia Rojas', 'Demandante: Ana Ficticia Rojas, de entre 30 y 40 años');
    await expect(vistaPrevia(page).locator('button.etiqueta', { hasText: '[DEMANDANTE_1]' })).toHaveCount(1);
  });

  testMedicion('F8 lugar repetido llevado a departamento (sugerencia aplicada): mostrar uno no lo vuelve a ocultar', async ({ page }) => {
    await abrirConReglasYLista(page);
    await mostrarYComprobar(page, '[DEPARTAMENTO_3]', 0, 'Bogotá', 'Bogotá, [FECHA_1]');
  });

  testMedicion('F8 la otra persona de la lista: mostrar una mención del demandado no la vuelve a ocultar', async ({ page }) => {
    await abrirConReglasYLista(page);
    await mostrarYComprobar(page, '[DEMANDADO_1]', 1, 'Pedro Ejemplo Prueba', 'Pedro Ejemplo Prueba respondió');
  });

  testMedicion('F8 palabra de la lista dentro de un nombre de empresa: mostrarla no la vuelve a ocultar', async ({ page }) => {
    await abrirConReglasYLista(page);
    await mostrarYComprobar(page, '[PERSONA_2]', 0, 'Ejemplo', 'Ejemplo S.A.S.');
  });

  testMedicion('F8 mención ambigua separada por la propuesta: se muestra entera, no solo el tratamiento', async ({ page }) => {
    await abrirConReglasYLista(page);
    await mostrarYComprobar(page, '[PERSONA_3]', 0, 'señora Rojas', 'La señora Rojas reclama');
  });

  testMedicion('F8 persona del detector de nombres adicional nombrada dos veces: mostrar una mención no la vuelve a ocultar', async ({ page }) => {
    const texto = 'La señora Luisa Inventada Pérez presentó la solicitud. Después, Luisa Inventada Pérez firmó el acta.';
    await irACargar(page);
    await page.waitForFunction(() => '__siglowRevisionPrueba' in globalThis);
    await page.evaluate((t) => (globalThis as unknown as { __siglowRevisionPrueba: Gancho }).__siglowRevisionPrueba.cargar(t, 'en_curso', 'revision'), texto);
    await expect(h1(page, TITULO.vista)).toBeVisible();
    await page.evaluate(() => (globalThis as unknown as { __siglowRevisionPrueba: Gancho }).__siglowRevisionPrueba.incorporarVentana(['Luisa Inventada Pérez'], 1, 1));
    await esperarBusqueda(page);
    await expect(vistaPrevia(page)).not.toContainText('Luisa');
    const marcador = (await vistaPrevia(page).locator('button.etiqueta').first().textContent()) ?? '';
    await mostrarYComprobar(page, marcador, 0, 'Luisa Inventada Pérez', 'La señora Luisa Inventada Pérez presentó');
    await expect(vistaPrevia(page).locator('button.etiqueta', { hasText: marcador })).toHaveCount(1);
  });

  testMedicion('F8 persona de la lista con una sola mención que comparte apellido con otra (la mención ambigua): mostrarla no la vuelve a ocultar', async ({ page }) => {
    await abrirConReglasYLista(page);
    await mostrarYComprobar(page, '[TESTIGO_1]', 0, 'Carlos Ficticio Rojas', 'El testigo Carlos Ficticio Rojas declaró');
  });

  // Los demás tipos, banderas y sugerencias ya quedaban a la vista con la v1.1.0; se cubren para que no vuelvan a fallar.
  const OTROS: ReadonlyArray<readonly [etiqueta: string, n: number, original: string, contexto: string]> = [
    ['[FECHA_1]', 0, '15 de marzo de 2024', '[DEPARTAMENTO_3], 15 de marzo de 2024'],
    ['[CC_1]', 0, '1.000.000.001', 'C.C. 1.000.000.001'],
    ['[CORREO_1]', 0, 'ana.ficticia@ejemplo.test', 'correo ana.ficticia@ejemplo.test'],
    ['[DIRECCIÓN_1]', 0, 'Calle 100 # 00-00', 'en la Calle 100 # 00-00 de'],
    ['[NIT_1]', 0, '900.000.001-7', 'NIT 900.000.001-7'],
    ['[VALOR_1]', 0, '$ 5.000.000', 'la suma de $ 5.000.000'],
  ];
  testMedicion('F8 fecha, cédula, correo, dirección, NIT y valor', async ({ page }) => {
    testMedicion.setTimeout(360_000);
    for (const [etiqueta, n, original, contexto] of OTROS) {
      await abrirConReglasYLista(page);
      await mostrarYComprobar(page, etiqueta, n, original, contexto);
    }
  });

  testMedicion('F8 sugerencias y banderas aplicadas (edad a rango, despacho genérico, cargo, diagnóstico): «Mostrar» devuelve el texto original', async ({ page }) => {
    testMedicion.setTimeout(360_000);
    const CASOS: ReadonlyArray<readonly [etiqueta: string, original: string]> = [
      ['de entre 30 y 40 años', 'de 34 años de edad'],
      ['Juzgado Tercero Civil del Circuito de un municipio de', 'Juzgado Tercero Civil del Circuito de Cartago'],
      ['una directiva', 'gerente general'],
      ['un diagnóstico médico', 'G35'],
    ];
    for (const [etiqueta, original] of CASOS) {
      await abrirConReglasYLista(page);
      await vistaPrevia(page).locator('button.etiqueta', { hasText: etiqueta }).first().click();
      await menu(page).getByRole('button', { name: 'Mostrar el dato original aquí' }).click();
      await expect(vistaPrevia(page)).toContainText(original);
      await expect.poll(async () => page.evaluate(() => document.querySelector('[data-prueba="residuos-estado"]')?.textContent ?? ''), { timeout: 30_000 })
        .toContain('ninguno de los');
      await expect(vistaPrevia(page)).toContainText(original);
      await expect(vistaPrevia(page).locator('button.etiqueta', { hasText: etiqueta })).toHaveCount(0);
    }
  });
});
