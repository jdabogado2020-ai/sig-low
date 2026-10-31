// PC-7 · accesibilidad mínima y barrido de textos prohibidos sobre la interfaz integrada (8.4, 8.5, 8.6, 8.7), en la app real (dist/):
// T-AX-01 (flujo completo solo con teclado), T-AX-02 y T-AX-04 (nombres, roles y regiones vivas sin originales), T-AX-06 (320 × 640),
// T-AX-07 (colores forzados y movimiento reducido), T-IU-02 (textos prohibidos en el texto visible, aria-label y aria-valuetext de cada
// pantalla) e INV-G13 (dist/). T-AX-03 y T-AX-04 de Revisión están en a11y.spec.ts (PC-3). T-AX-05 es de unidad (contraste.test.ts) y
// T-AX-08 es manual (NVDA y Narrador). Los casos T-PV-01, T-PV-02, T-PV-11, T-PV-24 y T-IU-03 de PC-7 están en privacy-surface.spec.ts.
// Datos ficticios evidentes (10.1.5). Ningún caso levanta un servidor propio: usan el de playwright.config.ts (puerto del entorno).
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { GRUPOS_LICENCIAS } from '../../src/ui/licencias';
import { copiarEnListo, crearYAnalizar, DOCUMENTO_REI, h1, LISTA_REI, REALES_REI, SALIDA_REI } from './ayudas-reinsercion';
import { hallazgos, hallazgosEnDist } from './lib/prohibidos';

test.describe.configure({ timeout: 150_000 });
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

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

/** Tab hasta que el elemento con foco cumple la condición; en cada parada el foco es visible (2.4.7). */
async function tabHasta(page: Page, coincide: (f: Foco) => boolean, descripcion: string, max = 60): Promise<Foco> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const f = await foco(page);
    if (f === null) continue;
    expect(f.visible, `«${f.nombre}» es visible`).toBe(true);
    expect(f.anillo, `foco visible en «${f.nombre}»`).toBe(true);
    if (coincide(f)) return f;
  }
  throw new Error(`Tab no llegó a ${descripcion}`);
}
const llegarABoton = (page: Page, nombre: RegExp) => tabHasta(page, (f) => (f.tag === 'button' || f.rol === 'button') && nombre.test(f.nombre), `el botón ${String(nombre)}`);

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

test.describe('T-AX-01 flujo completo solo con teclado', () => {
  test('T-AX-01 @humo Inicio → Lista → Entrada → Revisión (A, R, U, N) → Listo (casillas, copiar) → Reinserción, sin ratón y con el foco siempre visible', async ({ page }) => {
    await page.goto('/');
    await expect(h1(page, 'Inicio')).toBeVisible({ timeout: 30_000 });
    // Inicio: código, modo de la tabla («No guardar») y «Crear asunto».
    await tabHasta(page, (f) => f.tag === 'input' && /Código del asunto/.test(f.nombre), 'el campo «Código del asunto»');
    await page.keyboard.type('PRUEBA-AX-01');
    let radio = await tabHasta(page, (f) => f.tipo === 'radio', 'el grupo de modo de la tabla');
    for (let i = 0; i < 3 && !/^No guardar la tabla/.test(radio.nombre); i++) {
      await page.keyboard.press('ArrowDown');
      radio = (await foco(page))!;
    }
    expect(radio.nombre).toMatch(/^No guardar la tabla/);
    await page.keyboard.press('Space');
    await expect(page.getByRole('radio', { name: /^No guardar la tabla/ })).toBeChecked();
    await llegarABoton(page, /^Crear asunto$/);
    await page.keyboard.press('Enter');
    await expect(h1(page, 'Lista del caso')).toBeFocused();

    // Lista del caso: pegar la lista, vista previa, agregar y continuar.
    await tabHasta(page, (f) => f.tag === 'textarea' && /Texto de la lista/.test(f.nombre), 'el campo «Texto de la lista»');
    await page.keyboard.type(LISTA_REI);
    await llegarABoton(page, /^Vista previa$/);
    await page.keyboard.press('Enter');
    await llegarABoton(page, /^Agregar las líneas válidas$/);
    await page.keyboard.press('Enter');
    await llegarABoton(page, /^Continuar$/);
    await page.keyboard.press('Enter');
    await expect(h1(page, 'Entrada')).toBeFocused();

    // Entrada: pestañas, texto y «Analizar».
    await tabHasta(page, (f) => f.rol === 'tab', 'la pestaña activa');
    await tabHasta(page, (f) => f.tag === 'textarea', 'el campo del documento');
    await page.keyboard.type(DOCUMENTO_REI);
    await llegarABoton(page, /^Analizar$/);
    await page.keyboard.press('Enter');
    await expect(h1(page, 'Revisión')).toBeFocused({ timeout: 60_000 });

    // Revisión: del primer resaltado, A, R, U y N hasta no dejar ningún pendiente.
    await tabHasta(page, (f) => f.det, 'el primer resaltado');
    const pendientes = () => page.locator('[data-det][aria-label*=", pendiente,"]').count();
    expect(await pendientes()).toBeGreaterThan(0);
    await page.keyboard.press('r');
    await expect(page.locator('[data-det]:focus')).toHaveAccessibleName(/rechazada/);
    await page.keyboard.press('u');
    await expect(page.locator('[data-det]:focus')).toHaveAccessibleName(/pendiente/);
    await page.keyboard.press('a');
    for (let i = 0; i < 40 && (await pendientes()) > 0; i++) {
      await page.keyboard.press('n');
      await page.keyboard.press('a');
    }
    expect(await pendientes()).toBe(0);
    await page.locator('[data-prueba="continuar"]').focus();
    await page.keyboard.press('Enter');
    await expect(h1(page, 'Listo')).toBeFocused({ timeout: 30_000 });

    // Listo: la búsqueda de residuos termina, las tres casillas del recordatorio con la barra espaciadora y «Copiar texto anonimizado».
    await expect(page.locator('[data-prueba="residuos-estado"]')).toContainText('Búsqueda de residuos: ninguno de los', { timeout: 30_000 });
    for (const nombre of [/^Datos biométricos/, /^Documentos con reserva legal/, /^La estrategia reservada/]) {
      await tabHasta(page, (f) => f.tipo === 'checkbox' && nombre.test(f.nombre), `la casilla ${String(nombre)}`);
      await page.keyboard.press('Space');
    }
    await llegarABoton(page, /^Copiar texto anonimizado$/);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-aviso="M-84"]')).toBeVisible();
    await llegarABoton(page, /^Reinsertar una respuesta$/);
    await page.keyboard.press('Enter');
    await expect(h1(page, 'Reinserción')).toBeFocused();

    // Reinserción: pegar la respuesta con marcadores y buscar.
    await tabHasta(page, (f) => f.tag === 'textarea' && /Respuesta de la herramienta de IA/.test(f.nombre), 'el campo de la respuesta');
    await page.keyboard.type(SALIDA_REI);
    await llegarABoton(page, /^Buscar marcadores$/);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-prueba="resultado-real"], [data-prueba="faltan-decisiones"], [data-prueba="resultado"]').first()).toBeVisible();
    // El anuncio de pantalla del último cambio y el foco no se perdieron en el cuerpo de la página.
    expect(await foco(page)).not.toBeNull();
  });
});

test.describe('T-AX-02 y T-AX-04 nombres, roles y regiones vivas del flujo integrado', () => {
  test('T-AX-02 T-AX-04 cada pantalla: un h1, armazón con main, header y footer, lang es-CO, todo control con nombre y ninguna región viva con originales', async ({ page }) => {
    await crearYAnalizar(page, { codigo: 'PRUEBA-AX-02' });
    // crearYAnalizar termina en Listo: se revisa Listo, luego Reinserción; la Revisión la cubre a11y.spec.ts (PC-3) y el caso de T-AX-07.
    const revisar = async (nombre: string): Promise<void> => {
      await expect(h1(page, nombre)).toBeVisible();
      const e = await estructura(page);
      expect(e, nombre).toMatchObject({ h1: 1, main: 1, header: 1, footer: 1, lang: 'es-CO', saltar: true });
      // Reinserción no es uno de los cinco pasos del asunto (8.1): solo las pantallas del flujo llevan la navegación de pasos.
      if (nombre !== 'Reinserción') expect(e.nav, `${nombre}: nav de pasos`).toBeGreaterThanOrEqual(1);
      expect(await controlesSinNombre(page), `${nombre}: controles sin nombre`).toEqual([]);
      const vivas = await regionesVivas(page);
      for (const real of REALES_REI) expect(vivas, `${nombre}: región viva con «${real}»`).not.toContain(real);
    };
    await revisar('Listo');
    // La vista de salida de Listo: el árbol de accesibilidad no trae originales.
    const salida = page.getByRole('region', { name: 'Documento anonimizado con los marcadores como fichas' });
    await expect(salida).toBeVisible();
    const arbol = await salida.ariaSnapshot();
    for (const real of REALES_REI) expect(arbol).not.toContain(real);
    await copiarEnListo(page);
    for (const real of REALES_REI) expect(await regionesVivas(page), 'regiones vivas tras copiar').not.toContain(real);
    await page.getByRole('button', { name: 'Reinsertar una respuesta' }).click();
    await revisar('Reinserción');
    await page.getByRole('textbox', { name: 'Respuesta de la herramienta de IA' }).fill(SALIDA_REI);
    await page.getByRole('button', { name: 'Buscar marcadores' }).click();
    for (const real of REALES_REI) expect(await regionesVivas(page), 'regiones vivas con el resultado').not.toContain(real);
  });
});

test.describe('T-AX-06 zoom y reajuste a 320 × 640', () => {
  test('T-AX-06 @humo Inicio, Acerca de, Lista, Entrada, Revisión, Listo y Reinserción sin desplazamiento horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const sinDesborde = async (donde: string): Promise<void> => {
      const m = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, cuerpo: document.body.scrollWidth - document.body.clientWidth,
      }));
      expect(m.doc, `${donde}: scrollWidth − clientWidth del documento`).toBeLessThanOrEqual(0);
      expect(m.cuerpo, `${donde}: scrollWidth − clientWidth del cuerpo`).toBeLessThanOrEqual(0);
    };
    await page.goto('/');
    await expect(h1(page, 'Inicio')).toBeVisible({ timeout: 30_000 });
    await sinDesborde('Inicio');
    await page.getByRole('button', { name: 'Acerca de' }).click();
    await expect(page.getByRole('dialog', { name: 'Acerca de Sig-Low' })).toBeVisible();
    await sinDesborde('Acerca de');
    await page.getByRole('dialog', { name: 'Acerca de Sig-Low' }).getByRole('button', { name: 'Créditos y licencias' }).click();
    await expect(page.getByRole('dialog', { name: 'Créditos y licencias' })).toBeVisible();
    await sinDesborde('Créditos y licencias');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    // Del flujo de la demo, mirando cada pantalla en el camino.
    await page.getByLabel('Código del asunto').fill('PRUEBA-AX-06');
    await page.getByRole('radio', { name: /^No guardar la tabla/ }).check();
    await page.getByRole('button', { name: 'Crear asunto' }).click();
    await expect(h1(page, 'Lista del caso')).toBeVisible();
    await page.getByRole('textbox', { name: 'Texto de la lista' }).fill(LISTA_REI);
    await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
    await sinDesborde('Lista del caso con vista previa');
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await sinDesborde('Lista del caso');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(h1(page, 'Entrada')).toBeVisible();
    await sinDesborde('Entrada');
    await page.getByRole('tab', { name: 'Cargar archivo' }).click();
    await sinDesborde('Entrada (cargar archivo)');
    await page.getByRole('tab', { name: 'Pegar texto' }).click();
    await page.getByRole('textbox', { name: 'Texto del documento' }).fill(DOCUMENTO_REI);
    await page.getByRole('button', { name: 'Analizar', exact: true }).click();
    await expect(h1(page, 'Revisión')).toBeVisible({ timeout: 60_000 });
    await sinDesborde('Revisión');
    const leyenda = page.getByRole('button', { name: 'Leyenda' });
    if (await leyenda.isVisible()) { await leyenda.click(); await sinDesborde('Revisión con leyenda'); await leyenda.click(); }
    const marcas = page.getByRole('region', { name: 'Documento con detecciones' }).locator('[data-det]');
    for (let i = 0, n = await marcas.count(); i < n; i++) {
      if (/, pendiente, /.test((await marcas.nth(i).getAttribute('aria-label')) ?? '')) { await marcas.nth(i).focus(); await page.keyboard.press('a'); }
    }
    await sinDesborde('Revisión con detecciones decididas');
    await page.locator('[data-prueba="continuar"]').click();
    await expect(h1(page, 'Listo')).toBeVisible();
    await sinDesborde('Listo');
    await copiarEnListo(page);
    await sinDesborde('Listo tras copiar');
    await page.getByRole('button', { name: 'Reinsertar una respuesta' }).click();
    await expect(h1(page, 'Reinserción')).toBeVisible();
    await sinDesborde('Reinserción');
    await page.getByRole('textbox', { name: 'Respuesta de la herramienta de IA' }).fill(SALIDA_REI);
    await page.getByRole('button', { name: 'Buscar marcadores' }).click();
    await sinDesborde('Reinserción con respuesta');
  });
});

test.describe('T-AX-07 colores forzados y movimiento reducido', () => {
  test('T-AX-07 @humo con forcedColors y reducedMotion la información de insignias, íconos y bordes se conserva y no hay transiciones ni animaciones', async ({ page }) => {
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
    await expect(h1(page, 'Inicio')).toBeVisible({ timeout: 30_000 });
    await movimiento('Inicio');
    await page.getByLabel('Código del asunto').fill('PRUEBA-AX-07');
    await page.getByRole('radio', { name: /^No guardar la tabla/ }).check();
    await page.getByRole('button', { name: 'Crear asunto' }).click();
    await expect(h1(page, 'Lista del caso')).toBeVisible();
    await page.getByRole('textbox', { name: 'Texto de la lista' }).fill(LISTA_REI);
    await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByRole('textbox', { name: 'Texto del documento' }).fill(DOCUMENTO_REI);
    await page.getByRole('button', { name: 'Analizar', exact: true }).click();
    await expect(h1(page, 'Revisión')).toBeVisible({ timeout: 60_000 });
    // Revisión: abreviatura, ícono y estilo de borde siguen en cada resaltado con colores forzados.
    const filas = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-det]')].map((el) => {
      const cs = getComputedStyle(el);
      return { abr: el.querySelector('.abr')?.textContent ?? '', icono: el.querySelector('.ins svg') !== null, borde: cs.borderTopStyle, ancho: parseFloat(cs.borderTopWidth) };
    }));
    expect(filas.length).toBeGreaterThan(0);
    for (const f of filas) {
      expect(f.abr).toMatch(/^[A-Z]{2,4}$/);
      expect(f.icono).toBe(true);
      expect(['solid', 'dashed', 'dotted']).toContain(f.borde);
      expect(f.ancho).toBeGreaterThanOrEqual(2);
    }
    await movimiento('Revisión');
    await page.getByRole('button', { name: 'Leyenda' }).click();
    await movimiento('Revisión con la leyenda');
    const forzado = await page.evaluate(() => matchMedia('(forced-colors: active)').matches && matchMedia('(prefers-reduced-motion: reduce)').matches);
    expect(forzado).toBe(true);
  });

  test('T-AX-07 el foco sigue visible con colores forzados en Inicio', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(h1(page, 'Inicio')).toBeVisible({ timeout: 30_000 });
    const f = await tabHasta(page, (x) => x.tag === 'input', 'el primer campo');
    expect(f.anillo).toBe(true);
  });
});

test.describe('T-IU-02 textos prohibidos en la interfaz integrada', () => {
  test('T-IU-02 INV-G13 @humo texto visible, aria-label y aria-valuetext de Inicio, Acerca de, Lista, Entrada, Revisión, Listo y Reinserción: 0 coincidencias', async ({ page }) => {
    await page.goto('/');
    await expect(h1(page, 'Inicio')).toBeVisible({ timeout: 30_000 });
    await barrer(page, 'Inicio');
    await page.getByRole('button', { name: 'Acerca de' }).click();
    await expect(page.getByRole('dialog', { name: 'Acerca de Sig-Low' })).toBeVisible();
    await barrer(page, 'Acerca de');
    await page.keyboard.press('Escape');
    await crearYAnalizar(page, { codigo: 'PRUEBA-AX-IU02' });
    await expect(h1(page, 'Listo')).toBeVisible();
    await barrer(page, 'Listo');
    await copiarEnListo(page);
    await barrer(page, 'Listo tras copiar');
    await page.getByRole('button', { name: 'Reinsertar una respuesta' }).click();
    await expect(h1(page, 'Reinserción')).toBeVisible();
    await barrer(page, 'Reinserción');
    await page.getByRole('textbox', { name: 'Respuesta de la herramienta de IA' }).fill(SALIDA_REI);
    await page.getByRole('button', { name: 'Buscar marcadores' }).click();
    await barrer(page, 'Reinserción con respuesta');
  });

  test('T-IU-02 Revisión (original, salida, leyenda y atajos), Lista y Entrada: 0 coincidencias', async ({ page }) => {
    await page.goto('/');
    await expect(h1(page, 'Inicio')).toBeVisible({ timeout: 30_000 });
    await page.getByLabel('Código del asunto').fill('PRUEBA-AX-IU02B');
    await page.getByRole('radio', { name: /^No guardar la tabla/ }).check();
    await page.getByRole('button', { name: 'Crear asunto' }).click();
    await expect(h1(page, 'Lista del caso')).toBeVisible();
    await page.getByRole('textbox', { name: 'Texto de la lista' }).fill(LISTA_REI);
    await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
    await barrer(page, 'Lista del caso con vista previa');
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await barrer(page, 'Lista del caso');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(h1(page, 'Entrada')).toBeVisible();
    await barrer(page, 'Entrada (pegar texto)');
    await page.getByRole('tab', { name: 'Cargar archivo' }).click();
    await barrer(page, 'Entrada (cargar archivo)');
    await page.getByRole('tab', { name: 'Pegar texto' }).click();
    await page.getByRole('textbox', { name: 'Texto del documento' }).fill(DOCUMENTO_REI);
    await page.getByRole('button', { name: 'Analizar', exact: true }).click();
    await expect(h1(page, 'Revisión')).toBeVisible({ timeout: 60_000 });
    await barrer(page, 'Revisión (original)');
    await page.getByRole('region', { name: 'Documento con detecciones' }).locator('[data-det]').first().click();
    await barrer(page, 'Revisión con la ficha de una detección');
    await page.getByRole('button', { name: 'Leyenda' }).click();
    await barrer(page, 'Revisión con la leyenda');
    await page.getByRole('button', { name: 'Leyenda' }).click();
    await page.getByRole('button', { name: 'Ver salida' }).click();
    await barrer(page, 'Revisión (ver salida)');
    await page.getByRole('button', { name: 'Atajos de teclado' }).click();
    await barrer(page, 'Revisión con los atajos de teclado');
  });

  test('INV-G13 @humo dist/ (build recién hecho): los archivos propios no nombran proveedores de IA ni prometen garantías, salvo «Créditos y licencias»', () => {
    const licencias = GRUPOS_LICENCIAS.flatMap((g) => [g.titulo, g.intro ?? '', ...g.avisos.flatMap((a) => [a.componente, a.version ?? '', a.licencia, ...a.aviso])]);
    expect(hallazgosEnDist(resolve('dist'), licencias)).toEqual([]);
  });
});
