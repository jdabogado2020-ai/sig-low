// PC-7 · accesibilidad mínima y barrido de textos prohibidos sobre la interfaz integrada (8.4, 8.5, 8.6, 8.7), en la app real (dist/):
// T-AX-01 (flujo completo solo con teclado), T-AX-02 y T-AX-04 (nombres, roles y regiones vivas sin originales), T-AX-06 (320 × 640),
// T-AX-07 (colores forzados y movimiento reducido), T-IU-02 (textos prohibidos en el texto visible, aria-label y aria-valuetext de cada
// pantalla) e INV-G13 (dist/). T-AX-03 y T-AX-04 de Revisión están en a11y.spec.ts (PC-3). T-AX-05 es de unidad (contraste.test.ts) y
// T-AX-08 es manual (NVDA y Narrador). Los casos T-PV-01, T-PV-02, T-PV-11, T-PV-24 y T-IU-03 de PC-7 están en privacy-surface.spec.ts.
// F23 (v1.1, D-23 y D-24): el flujo es Cargar documento (guía, «Antes de empezar» y «Opciones avanzadas» plegadas, sin caso obligatorio)
// → Analizando → Vista previa (etiquetas, menú de la etiqueta, «Cómo leer la vista previa», «Puntos para revisar»; «Revisar dato por
// dato» es la revisión de la v1.0) → Descargar (una sola confirmación). Cada caso recorre ese flujo con las ayudas de lib/flujo.ts.
// Datos ficticios evidentes (10.1.5). Ningún caso levanta un servidor propio: usan el de playwright.config.ts (puerto del entorno).
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { GRUPOS_LICENCIAS } from '../../src/ui/licencias';
import {
  abrirAvanzadas, abrirMasFormatos, aDescargar, aDetalle, anonimizar, confirmar, editarLista, esperarBusqueda, etiquetas, h1, irACargar,
  pegarLista, pegarTexto, TITULO, vistaPrevia,
} from './lib/flujo';
import { hallazgos, hallazgosEnDist } from './lib/prohibidos';

test.describe.configure({ timeout: 150_000 });
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

/** Lista de nombres y documento de la demo (personas, un menor y un diagnóstico, y un apellido que puede ser de dos personas, para que haya «Puntos para revisar»). */
const LISTA_REI = 'Ana Ficticia Rojas; demandante\nPedro Ejemplo Prueba; demandado\nCarlos Rojas Ejemplo; testigo';
const DOCUMENTO_REI = [
  'Señora Ana Ficticia Rojas, cédula de ciudadanía número 1.000.000.001, correo ana.ficticia@ejemplo.test, teléfono 3000000000.',
  'El demandado Pedro Ejemplo Prueba, con cédula 1.000.000.002, vive en la Calle 100 # 00-00 de Bogotá.',
  'La niña con T.I. 1.000.000.003 tiene diagnóstico de diabetes tipo 2.',
  'El testigo Carlos Rojas Ejemplo declaró. Después el señor Rojas ratificó lo dicho.',
].join('\n');
/** Lo que Descargar muestra para ese documento: las etiquetas que la llave recuerda. */
const SALIDA_REI =
  'Señora [DEMANDANTE_1], cédula de ciudadanía número [CC_1], correo [CORREO_1], teléfono [TELÉFONO_1].\n'
  + 'El demandado [DEMANDADO_1], con cédula [CC_2], vive en la [DIRECCIÓN_1] de Bogotá.';
/** Valores reales ficticios (los que ninguna región viva, nombre accesible ni etiqueta puede llevar). */
const REALES_REI = ['Ana Ficticia Rojas', 'Pedro Ejemplo Prueba', '1.000.000.001', '1.000.000.002', '1.000.000.003', 'ana.ficticia@ejemplo.test', '3000000000', 'Calle 100', 'Carlos Rojas Ejemplo'];

interface Foco { nombre: string; rol: string; tag: string; tipo: string; anillo: boolean; visible: boolean; det: boolean }

/** El elemento con foco: nombre aproximado, rol, y si tiene un anillo de foco visible (outline ≥ 2 px o sombra). */
async function foco(page: Page): Promise<Foco | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el === null || el === document.body) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const etiquetas = [...((el as HTMLInputElement).labels ?? [])].map((l) => l.textContent ?? '').join(' ');
    const nombre = (el.getAttribute('aria-label') ?? (etiquetas !== '' ? etiquetas : el.textContent ?? '')).trim().replace(/\s+/g, ' ').slice(0, 90);
    return {
      nombre, rol: el.getAttribute('role') ?? el.tagName.toLowerCase(), tag: el.tagName.toLowerCase(), tipo: (el as HTMLInputElement).type ?? '',
      anillo: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || cs.boxShadow !== 'none',
      visible: r.width > 0 && r.height > 0, det: el.dataset['det'] !== undefined,
    };
  });
}

/** Tab (o Shift+Tab) hasta que el elemento con foco cumple la condición; en cada parada el foco es visible (2.4.7). */
async function tabHasta(page: Page, coincide: (f: Foco) => boolean, descripcion: string, max = 80, tecla = 'Tab'): Promise<Foco> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(tecla);
    const f = await foco(page);
    if (f === null) continue;
    expect(f.visible, `«${f.nombre}» es visible`).toBe(true);
    expect(f.anillo, `foco visible en «${f.nombre}»`).toBe(true);
    if (coincide(f)) return f;
  }
  throw new Error(`${tecla} no llegó a ${descripcion}`);
}
const llegarABoton = (page: Page, nombre: RegExp) => tabHasta(page, (f) => (f.tag === 'button' || f.rol === 'button') && nombre.test(f.nombre), `el botón ${String(nombre)}`);
const llegarAResumen = (page: Page, nombre: RegExp) => tabHasta(page, (f) => f.tag === 'summary' && nombre.test(f.nombre), `el resumen ${String(nombre)}`);

/** Recopila lo que una persona o un lector de pantalla recibe de la pantalla: texto visible, aria-label, aria-valuetext, title y placeholder. */
async function textosDePantalla(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const salida: string[] = [];
    for (const l of document.body.innerText.split('\n')) if (l.trim() !== '') salida.push(l.trim());
    for (const a of ['aria-label', 'aria-valuetext', 'aria-description', 'title', 'placeholder']) {
      for (const el of document.querySelectorAll(`[${a}]`)) { const v = el.getAttribute(a); if (v !== null && v.trim() !== '') salida.push(v.trim()); }
    }
    return salida;
  });
}
const barrer = async (page: Page, donde: string): Promise<void> => {
  expect(hallazgos(await textosDePantalla(page)), `textos prohibidos en ${donde}`).toEqual([]);
};

/** Textos de las regiones vivas y de los nombres accesibles que no pueden llevar originales (8.6.3, 8.6.4). */
async function regionesVivas(page: Page): Promise<string> {
  return page.evaluate(() => [...document.querySelectorAll('[role="status"], [role="alert"], [role="alertdialog"], [aria-live]')]
    .map((el) => `${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`).join('\n'));
}

/** Controles sin nombre accesible ni etiqueta: lista vacía = cumple (4.1.2, 3.3.2). */
async function controlesSinNombre(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const malos: string[] = [];
    const selector = 'button, input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="checkbox"], [role="radio"], [role="textbox"], [role="progressbar"], summary';
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (el.getClientRects().length === 0) continue; // fuera del árbol de accesibilidad (display: none, p. ej. el campo de archivo oculto)
      const etiquetas = [...((el as HTMLInputElement).labels ?? [])].map((l) => l.textContent ?? '').join('').trim();
      const ref = (el.getAttribute('aria-labelledby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join('').trim();
      const nombre = (el.getAttribute('aria-label') ?? '').trim() || ref || etiquetas || (el.textContent ?? '').trim();
      if (nombre === '') malos.push(`${el.tagName.toLowerCase()}.${el.className}`);
    }
    return malos;
  });
}

/** Un h1 por pantalla y los puntos de referencia del armazón (1.3.1, 2.4.1). */
async function estructura(page: Page): Promise<{ h1: number; main: number; header: number; footer: number; nav: number; lang: string | null; saltar: boolean }> {
  return page.evaluate(() => ({
    h1: document.querySelectorAll('h1').length, main: document.querySelectorAll('main').length, header: document.querySelectorAll('header').length,
    footer: document.querySelectorAll('footer').length, nav: document.querySelectorAll('nav').length, lang: document.documentElement.getAttribute('lang'),
    saltar: [...document.querySelectorAll('button, a')].some((e) => (e.textContent ?? '').trim() === 'Ir al contenido'),
  }));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Ayudas del flujo nuevo (propias de este spec: las de lib/flujo.ts no se tocan)
// ---------------------------------------------------------------------------------------------------------------------------------

/** Cargar → lista de nombres (Opciones avanzadas) → pegar texto → Anonimizar → Vista previa con la búsqueda de datos que se escaparon hecha. */
async function aVistaPrevia(page: Page): Promise<void> {
  await irACargar(page);
  await editarLista(page);
  await pegarLista(page, LISTA_REI);
  await pegarTexto(page, DOCUMENTO_REI);
  await anonimizar(page);
  await esperarBusqueda(page);
}

/** Vista previa → Descargar con la confirmación marcada (la puerta abierta). */
async function aDescargarConfirmado(page: Page): Promise<void> {
  await aDescargar(page);
  await confirmar(page);
}

/** Descargar → «Más formatos» → «Copiar texto anonimizado» (la copia consolida la llave del caso, 6.6.4). */
async function copiarEnDescargar(page: Page): Promise<void> {
  await abrirMasFormatos(page);
  await page.getByRole('button', { name: 'Copiar texto anonimizado' }).click();
  await expect(page.locator('[data-aviso="M-84"]')).toBeVisible();
}

/** Descargar → «Opciones avanzadas» → «Devolver los datos reales a un texto». */
async function aReinsercion(page: Page): Promise<void> {
  await abrirAvanzadas(page);
  await page.getByRole('button', { name: 'Devolver los datos reales a un texto' }).click();
  await expect(h1(page, TITULO.reinsercion)).toBeVisible();
}

/** Cierra con Escape el menú de la etiqueta: espera a que el foco haya entrado al menú (un Escape antes de eso no llega a su manejador). */
async function cerrarMenuConEscape(page: Page): Promise<void> {
  await expect(page.locator('[data-prueba="menu-etiqueta"] :focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-prueba="menu-etiqueta"]')).toHaveCount(0);
}

/** Abre todas las ayudas «?» de la pantalla (su texto está plegado hasta entonces). */
async function abrirAyudas(page: Page): Promise<void> {
  const botones = page.locator('button.ayuda-boton');
  for (let i = 0, n = await botones.count(); i < n; i++) {
    if ((await botones.nth(i).getAttribute('aria-expanded')) === 'false') await botones.nth(i).click();
  }
}

/** Cargar con todo desplegado: «Más información», las ayudas y «Opciones avanzadas». */
async function desplegarCargar(page: Page): Promise<void> {
  const mas = page.getByRole('button', { name: 'Más información' });
  if (await mas.isVisible()) await mas.click();
  await abrirAvanzadas(page);
  await abrirAyudas(page);
}

test.describe('T-AX-01 flujo completo solo con teclado', () => {
  test('T-AX-01 @humo Cargar (opciones avanzadas y lista) → Vista previa (etiqueta, menú, puntos, «Cómo leer») → Descargar (confirmación, .docx, copiar) → Devolver los datos reales, sin ratón y con el foco siempre visible', async ({ page }) => {
    await page.goto('/');
    await expect(h1(page, TITULO.cargar)).toBeVisible({ timeout: 30_000 });
    // Cargar: «Opciones avanzadas» se abre con Enter y «Editar los nombres» lleva a la lista (sin crear ningún caso).
    await llegarAResumen(page, /^Opciones avanzadas$/);
    await page.keyboard.press('Enter');
    await expect(page.locator('details[data-prueba="opciones-avanzadas"]')).toHaveJSProperty('open', true);
    await llegarABoton(page, /^Editar los nombres/);
    await page.keyboard.press('Enter');
    await expect(h1(page, TITULO.lista)).toBeFocused();

    // Lista: pegar los nombres, vista previa, agregar y continuar.
    await tabHasta(page, (f) => f.tag === 'textarea' && /Texto de la lista/.test(f.nombre), 'el campo «Texto de la lista»');
    await page.keyboard.type(LISTA_REI);
    await llegarABoton(page, /^Vista previa$/);
    await page.keyboard.press('Enter');
    await llegarABoton(page, /^Agregar las líneas válidas$/);
    await page.keyboard.press('Enter');
    await llegarABoton(page, /^Continuar$/);
    await page.keyboard.press('Enter');
    await expect(h1(page, TITULO.cargar)).toBeFocused();

    // Cargar: la pestaña «Pegar texto» con las flechas, el texto y «Anonimizar».
    await tabHasta(page, (f) => f.rol === 'tab', 'la pestaña activa');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Pegar texto' })).toHaveAttribute('aria-selected', 'true');
    await tabHasta(page, (f) => f.tag === 'textarea', 'el campo del documento');
    await page.keyboard.type(DOCUMENTO_REI);
    await llegarABoton(page, /^Anonimizar$/);
    await page.keyboard.press('Enter');
    await expect(h1(page, TITULO.vista)).toBeFocused({ timeout: 60_000 });

    // Vista previa: «Siguiente» lleva al primer punto; «Cómo leer la vista previa» se abre y se cierra; una etiqueta abre su menú.
    await llegarABoton(page, /^Siguiente$/);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-prueba="anuncio-punto"]')).toHaveText(/^Punto 1 de \d+: .+/);
    await tabHasta(page, (f) => f.nombre === 'Cómo leer la vista previa', 'el botón «Cómo leer la vista previa»', 80, 'Shift+Tab');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-prueba="como-leer"]')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-prueba="como-leer"]')).toBeHidden();
    const et = await tabHasta(page, (f) => f.tag === 'button' && /^Etiqueta \[/.test(f.nombre), 'la primera etiqueta');
    expect(et.nombre).toMatch(/^Etiqueta \[[^\]]+\], .+\. Pulse para ver las opciones\.$/);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-prueba="menu-etiqueta"]')).toBeVisible();
    await expect(page.locator('[data-prueba="menu-etiqueta"] :focus')).toHaveCount(1); // el foco entra al menú
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-prueba="menu-etiqueta"]')).toHaveCount(0);
    expect((await foco(page))?.nombre, 'Escape devuelve el foco a la etiqueta').toBe(et.nombre);
    await llegarABoton(page, /^Continuar a descargar$/);
    await page.keyboard.press('Enter');
    await expect(h1(page, TITULO.descargar)).toBeFocused({ timeout: 30_000 });

    // Descargar: la confirmación única con la barra espaciadora, el .docx con Enter, «Más formatos» → «Copiar texto anonimizado».
    await esperarBusqueda(page);
    await tabHasta(page, (f) => f.tipo === 'checkbox' && /^Revisé la vista previa/.test(f.nombre), 'la casilla «Revisé la vista previa»');
    await page.keyboard.press('Space');
    await expect(page.getByRole('checkbox', { name: /^Revisé la vista previa/ })).toBeChecked();
    await expect(page.locator('[data-prueba="motivos"]')).toHaveCount(0);
    await llegarABoton(page, /^Descargar documento \(\.docx\)$/);
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
    expect(descarga.suggestedFilename()).toMatch(/\.docx$/);
    await llegarAResumen(page, /^Más formatos$/);
    await page.keyboard.press('Enter');
    await llegarABoton(page, /^Copiar texto anonimizado$/);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-aviso="M-84"]')).toBeVisible();
    await llegarAResumen(page, /^Opciones avanzadas$/);
    await page.keyboard.press('Enter');
    await llegarABoton(page, /^Devolver los datos reales a un texto$/);
    await page.keyboard.press('Enter');
    await expect(h1(page, TITULO.reinsercion)).toBeFocused();

    // Reinserción: pegar la respuesta con etiquetas y buscar.
    await tabHasta(page, (f) => f.tag === 'textarea' && /Respuesta de la herramienta de IA/.test(f.nombre), 'el campo de la respuesta');
    await page.keyboard.type(SALIDA_REI);
    await llegarABoton(page, /^Buscar etiquetas$/);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-prueba="resultado-real"], [data-prueba="faltan-decisiones"], [data-prueba="resultado"]').first()).toBeVisible();
    // El anuncio de pantalla del último cambio y el foco no se perdieron en el cuerpo de la página.
    expect(await foco(page)).not.toBeNull();
  });
});

test.describe('T-AX-02 y T-AX-04 nombres, roles y regiones vivas del flujo integrado', () => {
  test('T-AX-02 T-AX-04 cada pantalla (Cargar con todo desplegado, Vista previa, Revisar dato por dato, Descargar y Devolver los datos reales): un h1, armazón con main, header y footer, lang es-CO, todo control con nombre y ninguna región viva ni etiqueta con originales', async ({ page }) => {
    await irACargar(page);
    const revisar = async (nombre: string, conPasos: boolean): Promise<void> => {
      await expect(h1(page, nombre)).toBeVisible();
      const e = await estructura(page);
      expect(e, nombre).toMatchObject({ h1: 1, main: 1, header: 1, footer: 1, lang: 'es-CO', saltar: true });
      // La barra de 3 pasos (Cargar, Vista previa, Descargar) está en Cargar, Vista previa, Revisar dato por dato y Descargar; no en la lista de
      // nombres ni en Devolver los datos reales (8.1).
      if (conPasos) expect(e.nav, `${nombre}: nav de pasos`).toBeGreaterThanOrEqual(1);
      expect(await controlesSinNombre(page), `${nombre}: controles sin nombre`).toEqual([]);
      const vivas = await regionesVivas(page);
      for (const real of REALES_REI) expect(vivas, `${nombre}: región viva con «${real}»`).not.toContain(real);
    };
    // Cargar con la guía, «Más información», las ayudas y «Opciones avanzadas» abiertas (formularios de la llave incluidos).
    await revisar(TITULO.cargar, true);
    await desplegarCargar(page);
    await revisar(TITULO.cargar, true);
    await expect(page.getByRole('region', { name: 'Cómo funciona' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Antes de empezar' })).toBeVisible();
    await editarLista(page);
    await revisar(TITULO.lista, false);
    await pegarLista(page, LISTA_REI);
    await pegarTexto(page, DOCUMENTO_REI);
    await anonimizar(page);
    await esperarBusqueda(page);

    // Vista previa: etiquetas con nombre de etiqueta y tipo (ningún valor del documento), árbol de accesibilidad y menú sin originales.
    await revisar(TITULO.vista, true);
    const region = vistaPrevia(page);
    const nombres = await region.locator('button').evaluateAll((els) => els.map((e) => ({ clase: e.className, nombre: e.getAttribute('aria-label') ?? '' })));
    expect(nombres.length).toBeGreaterThan(5);
    for (const n of nombres) {
      for (const real of REALES_REI) expect(n.nombre, `nombre accesible de «${n.clase}» con «${real}»`).not.toContain(real);
      if (n.clase.includes('etiqueta')) expect(n.nombre).toMatch(/^(Etiqueta \[[^\]]+\], [^.]+\.|Texto reemplazado\.) Pulse para ver las opciones\.$/);
    }
    const arbol = await region.ariaSnapshot();
    for (const real of REALES_REI) expect(arbol, `árbol de accesibilidad de la vista previa con «${real}»`).not.toContain(real);
    await etiquetas(page).first().click();
    const menu = page.locator('[data-prueba="menu-etiqueta"]');
    await expect(menu).toHaveAttribute('role', 'dialog');
    await expect(menu).toHaveAccessibleName(/^Opciones de la etiqueta \[[^\]]+\]$/);
    expect(await controlesSinNombre(page), 'menú de la etiqueta: controles sin nombre').toEqual([]);
    const textoMenu = await menu.evaluate((el) => `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`);
    for (const real of REALES_REI) expect(textoMenu, `menú de la etiqueta con «${real}»`).not.toContain(real);
    // Se muestra el dato de una etiqueta: queda «a la vista» y su nombre sigue sin traer el dato; las regiones vivas tampoco.
    await menu.getByRole('button', { name: 'Mostrar el dato original aquí' }).click();
    const visto = region.locator('button.revelado').first();
    await expect(visto).toBeVisible();
    for (const real of REALES_REI) expect(await visto.getAttribute('aria-label'), `dato a la vista con «${real}»`).not.toContain(real);
    for (const real of REALES_REI) expect(await regionesVivas(page), `regiones vivas tras mostrar un dato con «${real}»`).not.toContain(real);
    await page.getByRole('button', { name: 'Cómo leer la vista previa' }).click();
    await revisar(TITULO.vista, true);

    // Revisar dato por dato: la revisión de la v1.0 muestra los originales en sus resaltados, pero las regiones vivas no.
    await aDetalle(page);
    await revisar(TITULO.detalle, true);
    await page.getByRole('toolbar', { name: 'Herramientas de la revisión' }).getByRole('button', { name: 'Vista previa', exact: true }).click();
    await expect(h1(page, TITULO.vista)).toBeVisible();

    // Descargar: con la puerta cerrada (lista de motivos) y con todo desplegado y la confirmación marcada.
    await aDescargar(page);
    await expect(page.locator('[data-prueba="motivos"]')).toBeVisible();
    await revisar(TITULO.descargar, true);
    await confirmar(page);
    await abrirMasFormatos(page);
    await abrirAvanzadas(page);
    await revisar(TITULO.descargar, true);
    // La vista de la salida de la v1.0 ya no está en Descargar: lo que se revisa es la vista previa.
    await expect(page.locator('[data-prueba="vista-salida"]')).toHaveCount(0);
    await copiarEnDescargar(page);
    for (const real of REALES_REI) expect(await regionesVivas(page), 'regiones vivas tras copiar').not.toContain(real);
    await page.getByRole('button', { name: 'Devolver los datos reales a un texto' }).click();
    await revisar(TITULO.reinsercion, false);
    await page.getByRole('textbox', { name: 'Respuesta de la herramienta de IA' }).fill(SALIDA_REI);
    await page.getByRole('button', { name: 'Buscar etiquetas' }).click();
    for (const real of REALES_REI) expect(await regionesVivas(page), 'regiones vivas con el resultado').not.toContain(real);
  });
});

test.describe('T-AX-06 zoom y reajuste a 320 × 640', () => {
  test('T-AX-06 @humo Cargar (guía, aviso, ayudas y opciones avanzadas abiertas), Acerca de, Lista, Vista previa (menú, selección y «Cómo leer»), Revisar dato por dato, Descargar y Devolver los datos reales sin desplazamiento horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const sinDesborde = async (donde: string): Promise<void> => {
      const m = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, cuerpo: document.body.scrollWidth - document.body.clientWidth,
      }));
      expect(m.doc, `${donde}: scrollWidth − clientWidth del documento`).toBeLessThanOrEqual(0);
      expect(m.cuerpo, `${donde}: scrollWidth − clientWidth del cuerpo`).toBeLessThanOrEqual(0);
    };
    await page.goto('/');
    await expect(h1(page, TITULO.cargar)).toBeVisible({ timeout: 30_000 });
    await sinDesborde('Cargar documento');
    await page.getByRole('button', { name: 'Más información' }).click();
    await sinDesborde('Cargar documento con «Más información»');
    await abrirAvanzadas(page);
    await sinDesborde('Cargar documento con opciones avanzadas');
    await abrirAyudas(page);
    await sinDesborde('Cargar documento con las ayudas abiertas');
    await page.getByRole('radio', { name: /^Guardar la llave en este equipo/ }).check();
    await sinDesborde('Cargar documento con el formulario de la llave guardada');
    await page.getByRole('tab', { name: 'Pegar texto' }).click();
    await sinDesborde('Cargar documento (pegar texto)');
    await page.getByRole('tab', { name: 'Cargar archivo' }).click();
    await sinDesborde('Cargar documento (cargar archivo)');
    await page.getByRole('button', { name: 'Acerca de' }).click();
    await expect(page.getByRole('dialog', { name: 'Acerca de Sig-Low' })).toBeVisible();
    await sinDesborde('Acerca de');
    await page.getByRole('dialog', { name: 'Acerca de Sig-Low' }).getByRole('button', { name: 'Créditos y licencias' }).click();
    await expect(page.getByRole('dialog', { name: 'Créditos y licencias' })).toBeVisible();
    await sinDesborde('Créditos y licencias');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    // Del flujo de la demo, mirando cada pantalla en el camino.
    await page.getByRole('button', { name: /^Editar los nombres/ }).click();
    await expect(h1(page, TITULO.lista)).toBeVisible();
    await page.getByRole('textbox', { name: 'Texto de la lista' }).fill(LISTA_REI);
    await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
    await sinDesborde('Lista de nombres con vista previa');
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await sinDesborde('Nombres que siempre deben ocultarse');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(h1(page, TITULO.cargar)).toBeVisible();
    await pegarTexto(page, DOCUMENTO_REI);
    await sinDesborde('Cargar documento con el texto pegado');
    await anonimizar(page);
    await esperarBusqueda(page);
    await sinDesborde('Vista previa');
    const comoLeer = page.getByRole('button', { name: 'Cómo leer la vista previa' });
    await comoLeer.click();
    await sinDesborde('Vista previa con «Cómo leer la vista previa»');
    await comoLeer.click();
    // El menú de una etiqueta (con sus pasos) y el menú del texto seleccionado.
    await etiquetas(page).first().click();
    await sinDesborde('Vista previa con el menú de la etiqueta');
    await page.locator('[data-prueba="menu-etiqueta"]').getByRole('button', { name: 'Es la misma que…' }).click();
    await sinDesborde('Vista previa con «Es la misma que…»');
    await cerrarMenuConEscape(page);
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-prueba="vista-previa"] span.txt');
      const t = el?.firstChild;
      if (el === null || el === undefined || t === null || t === undefined) throw new Error('SIN_TEXTO');
      const r = document.createRange();
      r.setStart(t, 0);
      r.setEnd(t, Math.min(6, t.textContent?.length ?? 0));
      const s = getSelection();
      s?.removeAllRanges();
      s?.addRange(r);
      document.querySelector('[data-prueba="vista-previa"]')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await expect(page.locator('[data-prueba="menu-seleccion"]')).toBeVisible();
    await sinDesborde('Vista previa con el menú del texto seleccionado');
    await page.locator('[data-prueba="menu-seleccion"]').getByRole('button', { name: 'Ocultar este texto' }).click();
    const dialogoOcultar = page.getByRole('dialog', { name: 'Ocultar un texto' });
    await expect(dialogoOcultar).toBeVisible();
    await sinDesborde('Ocultar un texto');
    await dialogoOcultar.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialogoOcultar).toBeHidden();
    await aDetalle(page);
    await sinDesborde('Revisar dato por dato');
    await page.getByRole('toolbar', { name: 'Herramientas de la revisión' }).getByRole('button', { name: 'Cómo leer la vista previa' }).click();
    await sinDesborde('Revisar dato por dato con «Cómo leer la vista previa»');
    await page.getByRole('toolbar', { name: 'Herramientas de la revisión' }).getByRole('button', { name: 'Vista previa', exact: true }).click();
    await expect(h1(page, TITULO.vista)).toBeVisible();
    await aDescargar(page);
    await expect(page.locator('[data-prueba="motivos"]')).toBeVisible();
    await sinDesborde('Descargar con la lista de motivos');
    await confirmar(page);
    await abrirMasFormatos(page);
    await abrirAvanzadas(page);
    await sinDesborde('Descargar con «Más formatos» y opciones avanzadas');
    await copiarEnDescargar(page);
    await sinDesborde('Descargar tras copiar');
    await page.getByRole('button', { name: 'Devolver los datos reales a un texto' }).click();
    await expect(h1(page, TITULO.reinsercion)).toBeVisible();
    await sinDesborde('Devolver los datos reales');
    await page.getByRole('textbox', { name: 'Respuesta de la herramienta de IA' }).fill(SALIDA_REI);
    await page.getByRole('button', { name: 'Buscar etiquetas' }).click();
    await sinDesborde('Reinserción con respuesta');
  });
});

test.describe('T-AX-07 colores forzados y movimiento reducido', () => {
  test('T-AX-07 @humo con forcedColors y reducedMotion la información de etiquetas, insignias, íconos y bordes se conserva y no hay transiciones ni animaciones en Cargar, Vista previa, Revisar dato por dato y Descargar', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    const movimiento = async (donde: string): Promise<void> => {
      const m = await page.evaluate(() => {
        const malos: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>('body, body *')) {
          const cs = getComputedStyle(el);
          const dur = (s: string): number => Math.max(0, ...s.split(',').map((x) => parseFloat(x) * (x.trim().endsWith('ms') ? 0.001 : 1)).filter((n) => !Number.isNaN(n)));
          if (dur(cs.transitionDuration) > 0 || (cs.animationName !== 'none' && dur(cs.animationDuration) > 0)) malos.push(`${el.tagName.toLowerCase()}.${el.className}`);
        }
        return { malos: malos.slice(0, 5), scroll: getComputedStyle(document.documentElement).scrollBehavior };
      });
      expect(m.malos, `${donde}: transiciones o animaciones`).toEqual([]);
      expect(['auto', 'normal'], `${donde}: scroll-behavior`).toContain(m.scroll);
    };
    await page.goto('/');
    await expect(h1(page, TITULO.cargar)).toBeVisible({ timeout: 30_000 });
    await movimiento('Cargar documento');
    await desplegarCargar(page);
    await movimiento('Cargar documento con la guía, el aviso, las ayudas y las opciones avanzadas');
    // Con colores forzados, la guía, la tarjeta del detector y los formularios siguen distinguiéndose por borde (no solo por relleno).
    const bordes = await page.evaluate(() => ['[data-prueba="guia"]', '[data-prueba="aviso-inicial"]', '[data-prueba="tarjeta-modelo"]']
      .map((s) => document.querySelector(s)).filter((e) => e !== null).map((e) => getComputedStyle(e as Element).borderTopStyle));
    for (const b of bordes) expect(b).not.toBe('none');
    await editarLista(page);
    await pegarLista(page, LISTA_REI);
    await pegarTexto(page, DOCUMENTO_REI);
    await anonimizar(page);
    await esperarBusqueda(page);

    // Vista previa: cada etiqueta dice su nombre en texto y conserva el borde; el dato indirecto, su borde; el dato a la vista, su subrayado.
    const medir = (selector: string) => page.evaluate((s) => [...document.querySelectorAll<HTMLElement>(s)].map((el) => {
      const cs = getComputedStyle(el);
      return { texto: (el.textContent ?? '').trim(), borde: cs.borderTopStyle, ancho: parseFloat(cs.borderTopWidth), subrayado: cs.textDecorationLine, estilo: cs.textDecorationStyle };
    }), selector);
    const fichas = await medir('[data-prueba="vista-previa"] button.etiqueta');
    expect(fichas.length).toBeGreaterThan(5);
    for (const f of fichas) {
      expect(f.texto).not.toBe('');
      expect(['solid', 'dashed', 'dotted']).toContain(f.borde);
      expect(f.ancho).toBeGreaterThanOrEqual(1);
    }
    const avisos = await medir('[data-prueba="vista-previa"] button.revisar');
    // (En este documento la propuesta reemplaza los datos indirectos con su texto genérico, D-24: puede no haber ninguno sin confirmar.)
    for (const f of avisos) { expect(['solid', 'dashed', 'dotted']).toContain(f.borde); expect(f.ancho).toBeGreaterThanOrEqual(1); }
    await movimiento('Vista previa');
    await etiquetas(page).first().click();
    await expect(page.locator('[data-prueba="menu-etiqueta"]')).toBeVisible();
    await movimiento('Vista previa con el menú de la etiqueta');
    const bordeMenu = await page.locator('[data-prueba="menu-etiqueta"]').evaluate((el) => getComputedStyle(el).borderTopStyle);
    expect(bordeMenu).not.toBe('none');
    await page.locator('[data-prueba="menu-etiqueta"]').getByRole('button', { name: 'Mostrar el dato original aquí' }).click();
    const vistos = await medir('[data-prueba="vista-previa"] button.revelado');
    expect(vistos.length).toBeGreaterThan(0);
    for (const f of vistos) { expect(f.subrayado).toContain('underline'); expect(f.estilo).toBe('dotted'); }
    await page.getByRole('button', { name: 'Cómo leer la vista previa' }).click();
    await movimiento('Vista previa con «Cómo leer la vista previa»');

    // Revisar dato por dato: abreviatura, ícono y estilo de borde siguen en cada resaltado con colores forzados.
    await aDetalle(page);
    const filas = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-det]')].map((el) => {
      const cs = getComputedStyle(el);
      // Un dato que se mostró (sin ocultar) se marca con subrayado punteado y borde inferior de 2 px, sin borde superior.
      const rechazada = el.classList.contains('est-rechazada');
      return { abr: el.querySelector('.abr')?.textContent ?? '', icono: el.querySelector('.ins svg') !== null, borde: rechazada ? cs.borderBottomStyle : cs.borderTopStyle, ancho: parseFloat(rechazada ? cs.borderBottomWidth : cs.borderTopWidth) };
    }));
    expect(filas.length).toBeGreaterThan(0);
    for (const f of filas) {
      expect(f.abr).toMatch(/^[A-Z]{2,4}$/);
      expect(f.icono).toBe(true);
      expect(['solid', 'dashed', 'dotted']).toContain(f.borde);
      expect(f.ancho).toBeGreaterThanOrEqual(2);
    }
    await movimiento('Revisar dato por dato');
    await page.getByRole('toolbar', { name: 'Herramientas de la revisión' }).getByRole('button', { name: 'Cómo leer la vista previa' }).click();
    await movimiento('Revisar dato por dato con «Cómo leer la vista previa»');
    await page.getByRole('toolbar', { name: 'Herramientas de la revisión' }).getByRole('button', { name: 'Vista previa', exact: true }).click();

    // Descargar: la confirmación única y los botones conservan su borde.
    await aDescargar(page);
    await movimiento('Descargar');
    await confirmar(page);
    await abrirMasFormatos(page);
    await abrirAvanzadas(page);
    await movimiento('Descargar con «Más formatos» y opciones avanzadas');
    const botones = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-prueba="descargar-docx"], [data-prueba="descargar-pdf"]')].map((el) => getComputedStyle(el).borderTopStyle));
    for (const b of botones) expect(b).not.toBe('none');
    const forzado = await page.evaluate(() => matchMedia('(forced-colors: active)').matches && matchMedia('(prefers-reduced-motion: reduce)').matches);
    expect(forzado).toBe(true);
  });

  test('T-AX-07 el foco sigue visible con colores forzados en Cargar (guía, aviso, pestañas y opciones avanzadas) y en la Vista previa (etiquetas y menú)', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(h1(page, TITULO.cargar)).toBeVisible({ timeout: 30_000 });
    const guia = await tabHasta(page, (x) => x.tag === 'button', 'el primer botón');
    expect(guia.anillo).toBe(true);
    await llegarABoton(page, /^Entendido$/);
    await tabHasta(page, (x) => x.rol === 'tab', 'la pestaña activa');
    await llegarAResumen(page, /^Opciones avanzadas$/);
    // Vista previa: tabulando hasta una etiqueta y su menú (tabHasta exige un anillo en cada parada).
    await page.getByRole('tab', { name: 'Pegar texto' }).click();
    await page.getByRole('textbox', { name: 'Texto del documento' }).fill(DOCUMENTO_REI);
    await anonimizar(page);
    const et = await tabHasta(page, (x) => x.tag === 'button' && /^Etiqueta \[/.test(x.nombre), 'la primera etiqueta');
    expect(et.anillo).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-prueba="menu-etiqueta"]')).toBeVisible();
    const enMenu = await foco(page);
    expect(enMenu?.anillo, 'foco visible dentro del menú de la etiqueta').toBe(true);
  });
});

test.describe('T-IU-02 textos prohibidos en la interfaz integrada', () => {
  test('T-IU-02 INV-G13 @humo texto visible, aria-label y aria-valuetext de Cargar (guía, aviso, ayudas, opciones avanzadas), Acerca de, Vista previa (etiquetas, menú, «Cómo leer»), Descargar y Devolver los datos reales: 0 coincidencias', async ({ page }) => {
    await page.goto('/');
    await expect(h1(page, TITULO.cargar)).toBeVisible({ timeout: 30_000 });
    await barrer(page, 'Cargar documento');
    await desplegarCargar(page);
    await barrer(page, 'Cargar documento con la guía, «Más información», las ayudas y las opciones avanzadas');
    await page.getByRole('radio', { name: /^Guardar la llave en este equipo/ }).check();
    await barrer(page, 'Cargar documento con el formulario de la llave guardada');
    await page.getByRole('button', { name: 'Acerca de' }).click();
    await expect(page.getByRole('dialog', { name: 'Acerca de Sig-Low' })).toBeVisible();
    await barrer(page, 'Acerca de');
    await page.keyboard.press('Escape');
    await editarLista(page);
    await pegarLista(page, LISTA_REI);
    await pegarTexto(page, DOCUMENTO_REI);
    await anonimizar(page);
    await esperarBusqueda(page);
    await barrer(page, 'Vista previa');
    await page.getByRole('button', { name: 'Cómo leer la vista previa' }).click();
    await barrer(page, 'Vista previa con «Cómo leer la vista previa»');
    await page.getByRole('button', { name: 'Cómo leer la vista previa' }).click();
    await etiquetas(page).first().click();
    await barrer(page, 'Vista previa con el menú de la etiqueta');
    for (const paso of ['Es la misma que…', 'Cambiar a…', 'Editar el texto de la etiqueta']) {
      await page.locator('[data-prueba="menu-etiqueta"]').getByRole('button', { name: paso }).click();
      await barrer(page, `menú de la etiqueta: ${paso}`);
      await cerrarMenuConEscape(page);
      await etiquetas(page).first().click();
    }
    await cerrarMenuConEscape(page);
    await page.locator('[data-prueba="siguiente-punto"]').click();
    await barrer(page, 'Vista previa con un punto para revisar');
    // (D-24: la propuesta reemplaza los datos indirectos con su texto genérico; solo hay «dato indirecto» sin confirmar si algo quedó pendiente.)
    if ((await page.locator('button.revisar').count()) > 0) {
      await page.locator('button.revisar').first().click();
      await barrer(page, 'Vista previa con el menú de un dato indirecto');
      await cerrarMenuConEscape(page);
    }
    await aDescargar(page);
    await barrer(page, 'Descargar (puerta cerrada, con los motivos)');
    await confirmar(page);
    await abrirMasFormatos(page);
    await abrirAvanzadas(page);
    await barrer(page, 'Descargar con «Más formatos» y opciones avanzadas');
    await copiarEnDescargar(page);
    await barrer(page, 'Descargar tras copiar');
    await page.getByRole('button', { name: 'Devolver los datos reales a un texto' }).click();
    await expect(h1(page, TITULO.reinsercion)).toBeVisible();
    await barrer(page, 'Devolver los datos reales');
    await page.getByRole('textbox', { name: 'Respuesta de la herramienta de IA' }).fill(SALIDA_REI);
    await page.getByRole('button', { name: 'Buscar etiquetas' }).click();
    await barrer(page, 'Reinserción con respuesta');
  });

  test('T-IU-02 Cargar archivo (partes y avisos), Lista, Vista previa (PDF aparte), Revisar dato por dato (original, ficha, «Cómo leer la vista previa» y salida) y Casos guardados: 0 coincidencias', async ({ page }) => {
    await irACargar(page);
    await abrirAvanzadas(page);
    await page.getByRole('button', { name: 'Casos guardados en este equipo' }).click();
    await expect(h1(page, TITULO.boveda)).toBeVisible();
    await barrer(page, 'Casos guardados');
    await irACargar(page);
    await page.getByRole('tab', { name: 'Cargar archivo' }).click();
    await barrer(page, 'Cargar documento (cargar archivo)');
    await page.locator('input[type="file"]').setInputFiles({ name: 'documento.txt', mimeType: 'text/plain', buffer: Buffer.from(DOCUMENTO_REI, 'utf8') });
    await expect(page.locator('[data-prueba="archivo-cargado"]')).toBeVisible();
    await barrer(page, 'Cargar documento con un archivo leído');
    await editarLista(page);
    await page.getByRole('textbox', { name: 'Texto de la lista' }).fill(LISTA_REI);
    await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
    await barrer(page, 'Lista de nombres con vista previa');
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await barrer(page, 'Nombres que siempre deben ocultarse');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(h1(page, TITULO.cargar)).toBeVisible();
    await page.getByRole('button', { name: 'Anonimizar', exact: true }).click();
    await expect(h1(page, TITULO.vista)).toBeVisible({ timeout: 60_000 });
    await aDetalle(page);
    await barrer(page, 'Revisar dato por dato (original)');
    await page.getByRole('region', { name: 'Documento con datos encontrados' }).locator('[data-det]').first().click();
    await barrer(page, 'Revisar dato por dato con la ficha de una detección');
    await page.getByRole('button', { name: 'Cómo leer la vista previa' }).click();
    await barrer(page, 'Revisar dato por dato con «Cómo leer la vista previa» (atajos dentro)');
    await page.getByRole('button', { name: 'Cómo leer la vista previa' }).click();
    await page.getByRole('button', { name: 'Ver documento anonimizado' }).click();
    await barrer(page, 'Revisar dato por dato (ver salida)');
  });

  test('INV-G13 @humo dist/ (build recién hecho): los archivos propios no nombran proveedores de IA ni prometen garantías, salvo «Créditos y licencias»', () => {
    const licencias = GRUPOS_LICENCIAS.flatMap((g) => [g.titulo, g.intro ?? '', ...g.avisos.flatMap((a) => [a.componente, a.version ?? '', a.licencia, ...a.aviso])]);
    expect(hallazgosEnDist(resolve('dist'), licencias)).toEqual([]);
  });
});
