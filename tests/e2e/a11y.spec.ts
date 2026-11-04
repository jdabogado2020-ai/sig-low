import { test, expect, type Page } from '@playwright/test';
import { configurarSimulador, instalarSimulador, soltarRetenidos } from './ayudas-entrada';
import { abrirAvanzadas, aDetalle, editarLista, etiquetas, h1, irACargar, pegarLista, TITULO, vistaPrevia } from './lib/flujo';
import { testMedicion } from './lib/medicion';

// Casos de T-AX de PC-2 (8.6.6, 10.0): teclado, nombres accesibles y regiones vivas en Entrada y Procesando.
// PC-3 agrega T-AX-03 (no solo color) y PC-7 completa T-AX-01 a T-AX-04 sobre el flujo integrado y T-AX-05 a T-AX-08.
// F23 (v1.1, D-23 y D-24): «Entrada» es «Cargar documento» (sin caso obligatorio; guía, aviso y opciones avanzadas plegadas), la
// «Revisión» de la v1.0 es «Revisar dato por dato» y la nueva «Vista previa» (etiquetas, menú, puntos) tiene sus propios casos aquí.
// Datos ficticios evidentes (10.1.5).

const TEXTO_PRUEBA = 'Ana Ficticia Rojas, C.C. 1.000.000.017, vive en la Calle 00 n.º 00-00 de Ciudad Ejemplo.';

/** F2 (D-23): ya no hay caso que crear; «Cargar documento» es la primera pantalla. */
async function irAEntrada(page: Page): Promise<void> {
  await irACargar(page);
}

const activo = (page: Page) => page.evaluate(() => {
  const e = document.activeElement;
  return e ? { rol: e.getAttribute('role') ?? e.tagName.toLowerCase(), nombre: e.getAttribute('aria-label') ?? e.textContent?.trim() ?? '' } : null;
});

const sinFoco = (page: Page) => page.evaluate(() => document.activeElement === null || document.activeElement === document.body);

test.describe('T-AX-01 teclado en Cargar documento y Analizando', () => {
  test('T-AX-01 Cargar solo con teclado: pestañas con flechas, texto, «Anonimizar» con Enter y llegada a la Vista previa con el foco en su título', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    // Tab recorre, en orden, la guía, «Antes de empezar» y la pestaña activa (índice de tabulación móvil; «Cargar archivo» es la de entrada).
    await page.getByRole('heading', { level: 1, name: TITULO.cargar }).focus();
    const recorrido: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const a = await activo(page);
      recorrido.push(a?.nombre ?? '');
      if (a?.rol === 'tab') break;
    }
    expect(recorrido).toEqual(['Cerrar la guía', 'Más información', 'Entendido', 'Cargar archivo']);
    await page.keyboard.press('ArrowRight');
    expect(await activo(page)).toEqual({ rol: 'tab', nombre: 'Pegar texto' });
    await expect(page.getByRole('tab', { name: 'Pegar texto' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    expect(await activo(page)).toEqual({ rol: 'tab', nombre: 'Cargar archivo' });
    await expect(page.getByRole('tab', { name: 'Cargar archivo' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Tab');
    expect(await activo(page)).toMatchObject({ rol: 'textarea' });
    await page.keyboard.type(TEXTO_PRUEBA);
    // F8 (v1.1.1): antes de «Anonimizar» está la tarjeta del detector de nombres. El Tab recorre sus controles activos (la descarga,
    // si el detector se puede descargar, y «Ver créditos y licencias»; la casilla, deshabilitada sin el detector, se salta) y llega.
    const enTarjeta: string[] = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      if ((await activo(page))?.nombre === 'Anonimizar') break;
      expect(await page.evaluate(() => document.activeElement?.closest('[data-prueba="tarjeta-modelo"]') != null), 'entre el texto y «Anonimizar» solo la tarjeta del detector').toBe(true);
      enTarjeta.push((await activo(page))?.nombre ?? '');
    }
    expect(enTarjeta).toContain('Ver créditos y licencias');
    expect(await activo(page)).toEqual({ rol: 'button', nombre: 'Anonimizar' });
    await configurarSimulador(page, { retener: 'resultado' });
    await page.keyboard.press('Enter');
    await expect(h1(page, TITULO.analizando)).toBeFocused();
    // En Analizando, Tab llega a «Cancelar análisis» y nada más (sin trampas de foco).
    await page.keyboard.press('Tab');
    expect(await activo(page)).toEqual({ rol: 'button', nombre: 'Cancelar análisis' });
    await configurarSimulador(page, { retener: null });
    await soltarRetenidos(page);
    await expect(h1(page, TITULO.vista)).toBeFocused();
  });

  test('T-AX-01 Cargar: la guía, «Antes de empezar», las ayudas «?» y «Opciones avanzadas» se manejan con el teclado y el foco no se pierde', async ({ page }) => {
    await irAEntrada(page);
    await page.getByRole('heading', { level: 1, name: TITULO.cargar }).focus();
    // «Más información» despliega y pliega los avisos completos sin mover el foco.
    await page.keyboard.press('Tab'); // Cerrar la guía
    await page.keyboard.press('Tab');
    expect(await activo(page)).toEqual({ rol: 'button', nombre: 'Más información' });
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-prueba="aviso-completo"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Menos información' })).toHaveAttribute('aria-expanded', 'true');
    expect(await activo(page)).toEqual({ rol: 'button', nombre: 'Menos información' });
    await page.keyboard.press('Space');
    await expect(page.locator('[data-prueba="aviso-completo"]')).toHaveCount(0);
    // «Opciones avanzadas» se abre con Enter; la ayuda «?» con Enter; «Editar los nombres» lleva a la lista y «Continuar» vuelve.
    await page.locator('details[data-prueba="opciones-avanzadas"] > summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('details[data-prueba="opciones-avanzadas"]')).toHaveJSProperty('open', true);
    await page.keyboard.press('Tab');
    expect(await activo(page)).toEqual({ rol: 'button', nombre: 'Ayuda: Nombres que siempre deben ocultarse' });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Ayuda: Nombres que siempre deben ocultarse' })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('details[data-prueba="opciones-avanzadas"] [data-prueba="opcion-lista"] [role="note"]')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Ayuda: Nombres que siempre deben ocultarse' })).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Tab');
    expect(await activo(page)).toEqual({ rol: 'button', nombre: 'Editar los nombres (0 en la lista)' });
    await page.keyboard.press('Enter');
    await expect(h1(page, TITULO.lista)).toBeFocused();
    await page.getByRole('button', { name: 'Continuar' }).focus();
    await page.keyboard.press('Enter');
    await expect(h1(page, TITULO.cargar)).toBeFocused();
  });

  // Defecto de producto si falla (Inicio.tsx, GuiaInicial y AvisoInicial): al activar el botón la tarjeta se quita del árbol y el foco
  // cae al cuerpo de la página (2.4.3). Debería pasar a un elemento visible cercano (p. ej. el h1 o la pestaña «Cargar archivo»).
  test('T-AX-01 Cargar: «Cerrar la guía» quita la guía y el foco pasa a un elemento de la página, no al cuerpo', async ({ page }) => {
    await irAEntrada(page);
    await page.getByRole('button', { name: 'Cerrar la guía' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-prueba="guia"]')).toHaveCount(0);
    expect(await sinFoco(page), 'tras «Cerrar la guía» el foco quedó en el cuerpo de la página').toBe(false);
  });

  test('T-AX-01 Cargar: «Entendido» pliega «Antes de empezar» y el foco pasa a un elemento de la página, no al cuerpo', async ({ page }) => {
    await irAEntrada(page);
    await page.getByRole('button', { name: 'Entendido' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-prueba="aviso-inicial"] ul')).toHaveCount(0);
    expect(await sinFoco(page), 'tras «Entendido» el foco quedó en el cuerpo de la página').toBe(false);
  });

  test('T-AX-01 Esc y Enter: «Cancelar análisis» se activa con el teclado y devuelve el foco al título de Cargar documento', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await page.getByRole('tab', { name: 'Pegar texto' }).click();
    await page.getByRole('textbox', { name: 'Texto del documento' }).fill(TEXTO_PRUEBA);
    await configurarSimulador(page, { retener: 'resultado' });
    await page.getByRole('button', { name: 'Anonimizar', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(h1(page, TITULO.analizando)).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(h1(page, TITULO.cargar)).toBeFocused({ timeout: 4000 });
  });
});

test.describe('T-AX-02 nombres, roles y regiones de Cargar documento y Analizando', () => {
  test('T-AX-02 Cargar expone tablist, tabpanel, campo con nombre y descripción, guía y opciones avanzadas con nombre, y botones con nombre', async ({ page }) => {
    await irAEntrada(page);
    await expect(page.getByRole('tablist', { name: 'Forma de cargar el documento' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Cargar archivo' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Pegar texto' })).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByRole('tabpanel', { name: 'Cargar archivo' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Zona para soltar un archivo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Elegir archivo (.docx, .pdf o .txt)' })).toBeVisible();
    await page.getByRole('tab', { name: 'Pegar texto' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Pegar texto' })).toBeVisible();
    const campo = page.getByRole('textbox', { name: 'Texto del documento' });
    await expect(campo).toHaveAccessibleDescription('Pegue aquí el texto del documento. Se analiza en su equipo.');
    await expect(page.getByRole('button', { name: 'Anonimizar', exact: true })).toHaveAccessibleDescription('Pegue texto o cargue un archivo con texto para poder anonimizar.');
    // F2: la guía y «Antes de empezar» son regiones con nombre; la barra de pasos, una navegación con tres botones.
    await expect(page.getByRole('region', { name: 'Cómo funciona' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Antes de empezar' })).toBeVisible();
    const pasos = page.getByRole('navigation', { name: 'Pasos' });
    await expect(pasos.getByRole('button')).toHaveCount(3);
    await expect(pasos.getByRole('button', { name: 'Paso 1: Cargar' })).toBeDisabled();
    await expect(pasos.locator('li[aria-current="step"]')).toHaveCount(1);
    // «Opciones avanzadas» (plegado): al abrirlo, cada opción es una sección con nombre y la ayuda «?» dice a qué se refiere.
    const avanzadas = page.locator('details[data-prueba="opciones-avanzadas"]');
    await expect(avanzadas.locator('summary')).toHaveText('Opciones avanzadas');
    await abrirAvanzadas(page);
    // F8 (v1.1.1): el detector de nombres ya no está aquí: es una región con nombre a la vista, junto a la zona de carga.
    await expect(page.getByRole('region', { name: 'Detector de nombres' })).toBeVisible();
    expect(await page.locator('[data-prueba="tarjeta-modelo"]').evaluate((el) => el.closest('details') === null)).toBe(true);
    for (const n of ['Nombres que siempre deben ocultarse', 'Guardar la llave para devolver los datos reales después']) {
      await expect(avanzadas.getByRole('heading', { level: 3, name: new RegExp(`^${n}`) })).toBeVisible();
      await expect(avanzadas.getByRole('button', { name: `Ayuda: ${n}` })).toHaveAttribute('aria-expanded', 'false');
    }
    await expect(avanzadas.getByRole('button', { name: 'Editar los nombres (0 en la lista)' })).toBeVisible();
    await expect(avanzadas.getByRole('textbox', { name: 'Código del caso' })).toBeVisible();
    await expect(avanzadas.getByRole('radio', { name: /^Guardar la llave en este equipo/ })).toBeVisible();
    await expect(avanzadas.getByRole('radio', { name: /^No guardar la llave/ })).toBeVisible();
    // Ningún control de la pantalla queda sin nombre accesible.
    const sinNombre = await page.evaluate(() => {
      const malos: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('main button, main input:not([type="hidden"]), main select, main textarea, main summary, main [role="tab"]')) {
        const etiquetas = [...((el as HTMLInputElement).labels ?? [])].map((l) => l.textContent ?? '').join('').trim();
        const nombre = (el.getAttribute('aria-label') ?? '').trim() || etiquetas || (el.textContent ?? '').trim();
        if (nombre === '') malos.push(`${el.tagName.toLowerCase()}.${el.className}`);
      }
      return malos;
    });
    expect(sinNombre).toEqual([]);
  });

  test('T-AX-02 Analizando: lista de etapas con nombre, una barra con nombre y valor en palabras por etapa activa', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await page.getByRole('tab', { name: 'Pegar texto' }).click();
    await page.getByRole('textbox', { name: 'Texto del documento' }).fill(TEXTO_PRUEBA);
    await configurarSimulador(page, { retener: 'resultado' });
    await page.getByRole('button', { name: 'Anonimizar', exact: true }).click();
    await expect(h1(page, TITULO.analizando)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Etapas del análisis' })).toBeVisible();
    const lectura = page.getByRole('progressbar', { name: 'Lectura del documento' });
    await expect(lectura).toHaveAttribute('aria-valuetext', 'Lectura del documento: parte 1 de 1');
    await expect(page.getByRole('button', { name: 'Cancelar análisis' })).toBeVisible();
    await configurarSimulador(page, { retener: null });
    await soltarRetenidos(page);
    await expect(h1(page, TITULO.vista)).toBeVisible();
  });

  test('T-AX-02 la zona de soltar y las etiquetas de las casillas no dependen solo del color: texto visible y estado en el nombre', async ({ page }) => {
    await irAEntrada(page);
    await abrirAvanzadas(page);
    // F10 (v1.1.3): con el detector disponible, la casilla se puede usar sin descargarlo: «Anonimizar» lo descarga (o no, si se desmarca).
    await expect(page.getByRole('checkbox', { name: 'Usar el detector de nombres en este documento' })).toBeEnabled();
    await expect(page.getByText('Al pulsar «Anonimizar», el detector se descarga y revisa este documento.')).toBeVisible();
  });
});

test.describe('T-AX-04 regiones vivas sin texto del documento', () => {
  test('T-AX-04 las regiones status y alert de Cargar y Analizando no contienen el texto original', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await page.getByRole('tab', { name: 'Pegar texto' }).click();
    await page.getByRole('textbox', { name: 'Texto del documento' }).fill(TEXTO_PRUEBA);
    const vivas = async (): Promise<string[]> => page.evaluate(() =>
      [...document.querySelectorAll('[role="status"], [role="alert"], [aria-live]')].map((e) => e.textContent ?? ''));
    for (const texto of await vivas()) {
      expect(texto).not.toContain('Ficticia');
      expect(texto).not.toContain('1.000.000.017');
    }
    await configurarSimulador(page, { retener: 'todo' });
    await page.getByRole('button', { name: 'Anonimizar', exact: true }).click();
    await expect(h1(page, TITULO.analizando)).toBeVisible();
    await expect(page.locator('[data-prueba="anuncio-progreso"]')).not.toHaveText('');
    for (const texto of await vivas()) {
      expect(texto).not.toContain('Ficticia');
      expect(texto).not.toContain('1.000.000.017');
    }
    await expect(page.locator('[data-prueba="anuncio-progreso"]')).toContainText('Reglas de formatos colombianos: En curso');
    // Un error tampoco repite el documento.
    await page.getByRole('button', { name: 'Cancelar análisis' }).click();
    await expect(h1(page, TITULO.cargar)).toBeVisible({ timeout: 4000 });
    for (const texto of await vivas()) expect(texto).not.toContain('Ficticia');
  });
});

// ===== PC-3 · Revisión I: T-AX-01 a T-AX-04 con un DetectionSet fijo del build de medición (nunca de dist/) =====
const TEXTO_REVISION = [
  'Señora Ana Ficticia Rojas, identificada con cédula de ciudadanía número 1.000.000.001, correo ana.ficticia@ejemplo.test, teléfono 3000000000.',
  'El demandado Pedro Ejemplo Prueba, con cédula 1.000.000.002, vive en la Calle 100 # 00-00 de Bogotá.',
  'La señora Ana Ficticia Rojas solicitó el reemplazo. Contacto: 3000000000.',
].join('\n');

type Gancho = { cargar(texto: string, modelo?: string, pantalla?: string): Promise<number> };

/**
 * Abre «Revisar dato por dato» (la revisión de la v1.0: sin la propuesta aplicada) o, con `pantalla = 'revision'`, la «Vista previa»,
 * con un conjunto fijo de detecciones. F2 (D-23): la lista de nombres se pega en «Opciones avanzadas» y no hay caso que crear.
 */
async function abrirRevision(page: Page, pantalla: 'detalle' | 'revision' = 'detalle', texto: string = TEXTO_REVISION): Promise<void> {
  // Cuenta las violaciones de la CSP (por ejemplo, un atributo `style`): debe haber 0 (8, «Estilos»).
  await page.addInitScript(() => {
    (globalThis as unknown as { __csp: string[] }).__csp = [];
    addEventListener('securitypolicyviolation', (e) => { (globalThis as unknown as { __csp: string[] }).__csp.push(e.violatedDirective); });
  });
  await irACargar(page);
  await editarLista(page);
  await pegarLista(page, ['Ana Ficticia Rojas; demandante', 'Pedro Ejemplo Prueba; demandado'].join('\n'));
  await page.waitForFunction(() => '__siglowRevisionPrueba' in globalThis);
  await page.evaluate(([t, p]) => (globalThis as unknown as { __siglowRevisionPrueba: Gancho }).__siglowRevisionPrueba.cargar(t as string, 'plan_b', p as string), [texto, pantalla]);
  await expect(h1(page, pantalla === 'detalle' ? TITULO.detalle : TITULO.vista)).toBeVisible();
}
const panelTexto = (page: Page) => page.getByRole('region', { name: 'Documento con datos encontrados' });
const enfocadoRev = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null;
  if (el === null) return null;
  const cs = getComputedStyle(el);
  return { etiqueta: el.getAttribute('aria-label') ?? el.textContent ?? '', det: el.dataset['det'] !== undefined, contorno: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 };
});

testMedicion.describe('Revisión I · accesibilidad (PC-3)', () => {
  testMedicion.describe.configure({ timeout: 90_000 });

  testMedicion('T-AX-01 la Revisión se maneja solo con teclado: Tab, A, R, E, U, flechas y N, con el foco siempre visible', async ({ page }) => {
    await abrirRevision(page);
    await expect(h1(page, TITULO.detalle)).toBeFocused();
    // Tab recorre la barra y llega al panel de texto y a su único resaltado con índice de tabulación 0.
    let llegado = false;
    for (let i = 0; i < 14 && !llegado; i++) {
      await page.keyboard.press('Tab');
      const a = await enfocadoRev(page);
      expect(a?.contorno, `foco visible tras ${i + 1} Tab`).toBe(true);
      llegado = a?.det === true;
    }
    expect(llegado).toBe(true);
    const marcas = panelTexto(page).locator('[data-det]');
    await expect(marcas.nth(0)).toBeFocused();
    await page.keyboard.press('a');
    await expect(marcas.nth(0)).toHaveAccessibleName(/^Persona, ocultada con \[DEMANDANTE_1\]/);
    await page.keyboard.press('ArrowRight');
    await expect(marcas.nth(1)).toBeFocused();
    await page.keyboard.press('r');
    await expect(marcas.nth(1)).toHaveAccessibleName(/sin ocultar/i);
    await page.keyboard.press('u');
    await expect(marcas.nth(1)).toHaveAccessibleName(/por revisar/i);
    await page.keyboard.press('n');
    await expect(marcas.nth(1)).toBeFocused();
    await page.keyboard.press('n');
    await expect(marcas.nth(2)).toBeFocused();
    await page.keyboard.press('Shift+N');
    await expect(marcas.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(marcas.nth(0)).toBeFocused();
    // F2: «?» abre «Cómo leer la vista previa», que trae los atajos dentro (ya no hay diálogo «Atajos de teclado»); Esc lo cierra y
    // devuelve el foco al botón que lo abre.
    await page.keyboard.press('?');
    const boton = page.getByRole('button', { name: 'Cómo leer la vista previa' });
    const ayuda = page.getByRole('region', { name: 'Categorías de datos' });
    await expect(ayuda).toBeVisible();
    await expect(boton).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(ayuda).toHaveCount(0);
    await expect(boton).toBeFocused();
    // Sin atajos de una tecla, las letras no actúan (2.1.4).
    await marcas.nth(0).focus();
    await page.keyboard.press('?');
    await ayuda.getByRole('checkbox', { name: /atajos de una tecla/ }).uncheck();
    await page.keyboard.press('Escape');
    await marcas.nth(2).focus();
    await page.keyboard.press('a');
    await expect(marcas.nth(2)).toHaveAccessibleName(/por revisar/i);
    // La cuadrícula: Tab entra a la fila activa; flechas, Inicio, Fin, derecha e izquierda.
    const cuadricula = page.getByRole('treegrid', { name: 'Datos encontrados' });
    const primera = cuadricula.getByRole('row').nth(1);
    await primera.focus();
    await page.keyboard.press('ArrowRight');
    await expect(primera).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowRight');
    const mencion = cuadricula.getByRole('row', { name: /^Mención 1 de 2, / });
    await expect(mencion).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('button', { name: 'Ocultar: mención 1 de Persona' })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(mencion).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(primera).toBeFocused();
    await page.keyboard.press('End');
    await expect(cuadricula.getByRole('row').last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(primera).toBeFocused();
    expect(await page.evaluate(() => (globalThis as unknown as { __csp: string[] }).__csp)).toEqual([]);
  });

  testMedicion('T-AX-02 nombres, roles y lengua: lang es-CO, regiones y botones con nombre accesible; la vista de salida no trae originales', async ({ page }) => {
    await abrirRevision(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-CO');
    await expect(page.getByRole('region', { name: 'Documento con datos encontrados' })).toBeVisible();
    await expect(page.getByRole('toolbar', { name: 'Herramientas de la revisión' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Datos encontrados' })).toBeVisible();
    await expect(page.getByRole('treegrid', { name: 'Datos encontrados' })).toHaveAttribute('aria-rowcount', '8');
    await expect(page.getByRole('row', { name: 'Persona, [DEMANDANTE_1], 2 menciones, 2 por revisar' })).toHaveAttribute('aria-level', '1');
    await expect(page.getByRole('row', { name: 'Cédula de ciudadanía, [CC_1], 1 mención, 1 por revisar' })).toBeVisible();
    for (const n of ['Ver original', 'Ver documento anonimizado', 'Cómo leer la vista previa', 'Vista previa', 'Descartar este documento']) {
      await expect(page.getByRole('toolbar', { name: 'Herramientas de la revisión' }).getByRole('button', { name: n, exact: true })).toBeVisible();
    }
    // El botón «Atajos de teclado» ya no existe: los atajos están dentro de «Cómo leer la vista previa».
    await expect(page.getByRole('button', { name: 'Atajos de teclado' })).toHaveCount(0);
    // Todo control tiene nombre accesible; los campos, etiqueta; los nombres e ids de campos son neutros.
    const sinNombre = await page.evaluate(() => {
      const malos: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('main button, main input, main select, main [role="row"], main [role="region"]')) {
        const nombre = (el.getAttribute('aria-label') ?? '').trim() || (el.textContent ?? '').trim()
          || [...(el as HTMLInputElement).labels ?? []].map((l) => l.textContent ?? '').join('').trim();
        if (nombre === '') malos.push(el.tagName + '.' + el.className);
        if ((el instanceof HTMLInputElement || el instanceof HTMLSelectElement) && !/^c\d+$/.test(el.id)) malos.push('id no neutro: ' + el.id);
      }
      return malos;
    });
    expect(sinNombre).toEqual([]);
    // Selección de una mención: la ficha es una región con nombre y sus botones, accesibles.
    await panelTexto(page).locator('[data-det]').nth(0).click();
    const ficha = page.getByRole('region', { name: 'Ficha del dato encontrado' });
    await expect(ficha.getByRole('button', { name: 'Ocultar: esta mención' })).toBeVisible();
    await expect(ficha.getByRole('button', { name: 'Ocultar todas las menciones (2): todas las menciones de esta persona u organización' })).toBeVisible();
    await expect(ficha.getByLabel('Motivo para no ocultarlo (opcional)')).toBeVisible();
    await expect(ficha.getByLabel('Cambiar rol')).toBeVisible();
    // La vista de salida expone solo «Marcador {marcador}»: el árbol de accesibilidad no contiene originales.
    await page.getByRole('button', { name: 'Ver documento anonimizado' }).click();
    const salida = page.getByRole('region', { name: 'Documento con las etiquetas como fichas' });
    await expect(salida.getByRole('img', { name: 'Etiqueta [CC_1]' })).toBeVisible();
    const arbol = await salida.ariaSnapshot();
    for (const original of ['Ana', 'Ficticia', 'Pedro', 'Ejemplo', '1.000.000', 'ana.ficticia', '3000000000']) expect(arbol).not.toContain(original);
    const atributos = await salida.evaluate((el) => [...el.querySelectorAll('*')].flatMap((n) => [...n.attributes].filter((a) => a.name !== 'class').map((a) => a.name + '=' + a.value)).join('\n'));
    for (const original of ['Ana', 'Ficticia', 'Pedro', 'Ejemplo', '1.000.000', 'ana.ficticia']) expect(atributos).not.toContain(original);
    await expect(salida.locator('[title]')).toHaveCount(0);
  });

  testMedicion('T-AX-03 no solo color: cada resaltado lleva ícono y abreviatura del tipo y un borde cuyo estilo depende de la confianza', async ({ page }) => {
    await abrirRevision(page);
    const filas = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-det]')].map((el) => {
      const ins = el.querySelector('.ins');
      const cs = getComputedStyle(el);
      return {
        confianza: [...el.classList].find((c) => c.startsWith('conf-')) ?? '',
        abreviatura: ins?.querySelector('.abr')?.textContent ?? '',
        icono: ins?.querySelector('svg') !== null && ins !== null,
        ocultoALectores: ins?.getAttribute('aria-hidden') === 'true',
        borde: cs.borderTopStyle,
        grosor: parseFloat(cs.borderTopWidth),
        colorDeBorde: cs.borderTopColor,
      };
    }));
    expect(filas.length).toBe(9);
    const estilo: Record<string, string> = { 'conf-alta': 'solid', 'conf-media': 'dashed', 'conf-baja': 'dotted' };
    for (const f of filas) {
      expect(f.abreviatura).toMatch(/^[A-Z]{2,4}$/);
      expect(f.icono).toBe(true);
      expect(f.ocultoALectores).toBe(true);
      expect(f.borde).toBe(estilo[f.confianza]);
      expect(f.grosor).toBe(2);
    }
    expect(new Set(filas.map((f) => f.abreviatura))).toEqual(new Set(['PER', 'CC', 'COR', 'TEL', 'DIR']));
    // El estado cambia el ícono (no solo el color): visto al aceptar, equis al rechazar, círculo vacío al restablecer.
    const marcas = panelTexto(page).locator('[data-det]');
    await marcas.nth(0).focus();
    await page.keyboard.press('a');
    await expect(marcas.nth(0).locator('svg.ico-aceptada')).toHaveCount(1);
    await page.keyboard.press('r');
    await expect(marcas.nth(0).locator('svg.ico-rechazada')).toHaveCount(1);
    expect(await marcas.nth(0).evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('underline');
    await page.keyboard.press('e');
    await page.getByLabel('Texto del reemplazo').fill('REEMPLAZO FICTICIO');
    await page.keyboard.press('Enter');
    await expect(marcas.nth(0).locator('svg.ico-editada')).toHaveCount(1);
    await page.keyboard.press('u');
    await expect(marcas.nth(0).locator('svg.ico-pendiente')).toHaveCount(1);
    // La leyenda (divulgación) explica las tres codificaciones y se cierra con Esc devolviendo el foco al botón.
    const boton = page.getByRole('button', { name: 'Cómo leer la vista previa' });
    await boton.click();
    const leyenda = page.getByRole('region', { name: 'Categorías de datos' });
    await expect(boton).toHaveAttribute('aria-expanded', 'true');
    for (const t of ['Personas', 'Organizaciones', 'Identificaciones', 'Expedientes', 'Contacto y lugar', 'Bienes y dinero', 'Fechas', 'Datos indirectos para revisar', 'Borde sólido', 'Borde discontinuo', 'Borde punteado']) {
      await expect(leyenda).toContainText(t);
    }
    const bordes = await leyenda.evaluate((el) => ['conf-alta', 'conf-media', 'conf-baja'].map((c) => getComputedStyle(el.querySelector('.leyenda-bordes .' + c) as Element).borderTopStyle));
    expect(bordes).toEqual(['solid', 'dashed', 'dotted']);
    await page.keyboard.press('Escape');
    await expect(leyenda).toHaveCount(0);
    await expect(boton).toBeFocused();
    // Colores forzados: sin rellenos, bordes en CanvasText y la información se conserva.
    await page.emulateMedia({ forcedColors: 'active' });
    const f = await marcas.nth(1).evaluate((el) => ({ borde: getComputedStyle(el).borderTopStyle, abr: el.querySelector('.abr')?.textContent }));
    expect(f).toEqual({ borde: 'solid', abr: 'CC' });
  });

  testMedicion('T-AX-04 anuncios: la región de estado de la Revisión anuncia conteos sin texto del documento; ninguna región viva trae originales', async ({ page }) => {
    await abrirRevision(page);
    const region = page.locator('[data-prueba="anuncio-revision"]');
    await expect(region).toHaveAttribute('role', 'status');
    await panelTexto(page).locator('[data-det]').nth(0).focus();
    await page.keyboard.press('Shift+A');
    await expect(region).toHaveText('Se ocultaron 2 menciones de [DEMANDANTE_1]. Quedan 7 por revisar.');
    await page.getByRole('button', { name: 'Mostrar el dato original en todas las menciones: Teléfono' }).click();
    await expect(region).toHaveText('Se mostró el dato original en 2 menciones de Teléfono. Quedan 5 por revisar.');
    await page.keyboard.press('Tab');
    const vivas = await page.evaluate(() => [...document.querySelectorAll('[role="status"], [role="alert"], [aria-live]')].map((el) => el.textContent ?? ''));
    expect(vivas.join('\n')).not.toMatch(/Ana|Ficticia|Pedro|Ejemplo|1\.000\.000|ejemplo\.test/);
    // El cambio de pantalla se anuncia y el foco va al h1 (2.4.3): «Descartar documento» vuelve a Cargar documento.
    await page.getByRole('button', { name: 'Descartar este documento' }).click();
    await page.getByRole('dialog', { name: 'Descartar este documento' }).getByRole('button', { name: 'Descartar este documento' }).click();
    await expect(h1(page, TITULO.cargar)).toBeFocused();
    await expect(page.locator('[data-prueba="anuncio-pantalla"]')).toHaveText('Pantalla: Cargar documento');
  });
});

// ===== F3 (D-24) · Vista previa: T-AX-01 a T-AX-04 con el mismo conjunto fijo del build de medición =====
// El texto suma una línea con dos datos indirectos para revisar (un menor de edad y un diagnóstico), para que haya «Puntos para revisar».
const TEXTO_VISTA = `${TEXTO_REVISION}\nLa niña con T.I. 1.000.000.003 tiene diagnóstico de diabetes tipo 2.`;
/** Valores del documento que ninguna etiqueta, ningún nombre accesible ni ninguna región viva de la vista previa puede llevar. */
const ORIGINALES_VISTA = ['Ana', 'Ficticia', 'Pedro', 'Ejemplo Prueba', '1.000.000', 'ana.ficticia', '3000000000', 'Calle 100'];
const NOMBRE_ETIQUETA = /^(Etiqueta \[[^\]]+\], [^.]+\. Pulse para ver las opciones\.|Texto reemplazado\. Pulse para ver las opciones\.)$/;
/** Cierra con Escape el menú de la etiqueta: espera a que el foco haya entrado al menú (un Escape antes de eso no llega a su manejador). */
async function cerrarMenuConEscape(page: Page): Promise<void> {
  await expect(page.locator('[data-prueba="menu-etiqueta"] :focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-prueba="menu-etiqueta"]')).toHaveCount(0);
}
const menuEtiqueta = (page: Page) => page.locator('[data-prueba="menu-etiqueta"]');
const focoEn = (page: Page, selector: string) => page.evaluate((s) => document.activeElement?.closest(s) != null, selector);

testMedicion.describe('Vista previa · accesibilidad (F3, D-24)', () => {
  testMedicion.describe.configure({ timeout: 90_000 });

  testMedicion('T-AX-01 la Vista previa se maneja solo con teclado: Tab llega a las etiquetas, Enter abre su menú, Escape lo cierra y devuelve el foco, «Siguiente» recorre los puntos y «Cómo leer la vista previa» se abre', async ({ page }) => {
    await abrirRevision(page, 'revision', TEXTO_VISTA);
    await expect(h1(page, TITULO.vista)).toBeFocused();
    let llegado = false;
    for (let i = 0; i < 25 && !llegado; i++) {
      await page.keyboard.press('Tab');
      const a = await enfocadoRev(page);
      expect(a?.contorno, `foco visible tras ${i + 1} Tab`).toBe(true);
      llegado = await page.evaluate(() => document.activeElement?.matches('button.etiqueta') === true);
    }
    expect(llegado).toBe(true);
    const primera = etiquetas(page).first();
    await expect(primera).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menuEtiqueta(page)).toBeVisible();
    await expect(menuEtiqueta(page)).toHaveAccessibleName(/^Opciones de la etiqueta \[[^\]]+\]$/);
    // El menú mueve el foco en un efecto, después de pintar: se espera a que llegue.
    await expect.poll(() => focoEn(page, '[data-prueba="menu-etiqueta"]'), { message: 'el foco entra al menú' }).toBe(true);
    await page.keyboard.press('Escape');
    await expect(menuEtiqueta(page)).toHaveCount(0);
    await expect(primera).toBeFocused();
    // «Siguiente»: lleva el foco al punto y lo anuncia; da la vuelta al terminar.
    const siguiente = page.locator('[data-prueba="siguiente-punto"]');
    const anuncio = page.locator('[data-prueba="anuncio-punto"]');
    await expect(page.locator('[data-prueba="puntos"]')).toContainText('Puntos para revisar: 3');
    for (const i of [1, 2, 3, 1]) {
      await siguiente.focus();
      await page.keyboard.press('Enter');
      await expect(anuncio).toHaveText(new RegExp(`^Punto ${i} de 3: .+`));
      await expect.poll(() => focoEn(page, '[data-prueba="vista-previa"]'), { message: `el foco va al punto ${i}` }).toBe(true);
    }
    // «Cómo leer la vista previa» se abre y se cierra con Enter, sin mover el foco.
    const comoLeer = page.getByRole('button', { name: 'Cómo leer la vista previa' });
    await comoLeer.focus();
    await page.keyboard.press('Enter');
    await expect(comoLeer).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-prueba="como-leer"]')).toBeVisible();
    await expect(comoLeer).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-prueba="como-leer"]')).toBeHidden();
    // «Continuar a descargar» con Enter lleva a Descargar con el foco en su título.
    await page.locator('[data-prueba="continuar"]').focus();
    await page.keyboard.press('Enter');
    await expect(h1(page, TITULO.descargar)).toBeFocused();
  });

  // Defecto de producto si falla (MenuEtiqueta/VistaPrevia, `cerrarMenu`): al decidir desde el menú la etiqueta se vuelve a pintar como
  // «dato a la vista» y el elemento que abrió el menú ya no está en el documento; el foco cae al cuerpo (2.4.3). Debería ir al
  // elemento que ocupa su lugar (el dato a la vista con el mismo `data-det`) o a un punto cercano de la vista previa.
  testMedicion('T-AX-01 al decidir desde el menú de una etiqueta con el teclado el foco no se pierde en el cuerpo de la página', async ({ page }) => {
    await abrirRevision(page, 'revision', TEXTO_VISTA);
    const primera = etiquetas(page).first();
    await primera.focus();
    await page.keyboard.press('Enter');
    await expect(menuEtiqueta(page)).toBeVisible();
    await menuEtiqueta(page).getByRole('button', { name: 'Mostrar el dato original aquí' }).focus();
    await page.keyboard.press('Enter');
    await expect(menuEtiqueta(page)).toHaveCount(0);
    await expect(vistaPrevia(page).locator('button.revelado').first()).toBeVisible();
    expect(await page.evaluate(() => document.activeElement === null || document.activeElement === document.body),
      'tras «Mostrar el dato original aquí» el foco quedó en el cuerpo de la página').toBe(false);
  });

  testMedicion('T-AX-02 Vista previa: región, barra, puntos y menú con nombre y rol; ninguna etiqueta lleva un dato del documento en su nombre accesible ni en el árbol de accesibilidad', async ({ page }) => {
    await abrirRevision(page, 'revision', TEXTO_VISTA);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-CO');
    const region = vistaPrevia(page);
    await expect(region).toBeVisible();
    await expect(page.getByRole('toolbar', { name: 'Vista previa del documento anonimizado' }).getByRole('button', { name: 'Cómo leer la vista previa' })).toHaveAttribute('aria-controls', 'como-leer');
    await expect(page.getByRole('navigation', { name: 'Pasos' }).locator('li[aria-current="step"]')).toHaveCount(1);
    await expect(page.locator('[data-prueba="puntos"]')).toContainText('Puntos para revisar: 3');
    await expect(page.locator('[data-prueba="anuncio-punto"]')).toHaveAttribute('role', 'status');
    // Etiquetas: solo etiqueta y tipo. Datos indirectos: solo el motivo. Nada del documento en `aria-label`, `title` ni el árbol.
    const nombres = await region.locator('button').evaluateAll((els) => els.map((e) => ({ clase: e.className, nombre: e.getAttribute('aria-label') ?? '', titulo: e.getAttribute('title') })));
    expect(nombres.length).toBeGreaterThan(5);
    for (const n of nombres) {
      if (n.clase.includes('etiqueta')) expect(n.nombre).toMatch(NOMBRE_ETIQUETA);
      else expect(n.nombre).toMatch(/^Dato indirecto para revisar \(.+\)\. Pulse para decidir\.$/);
      expect(n.titulo).toBeNull();
      for (const real of ORIGINALES_VISTA) expect(n.nombre, `nombre accesible con «${real}»`).not.toContain(real);
    }
    const arbol = await region.ariaSnapshot();
    for (const real of ORIGINALES_VISTA) expect(arbol, `árbol de accesibilidad con «${real}»`).not.toContain(real);
    // Todo control de la pantalla tiene nombre.
    const sinNombre = await page.evaluate(() => {
      const malos: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('main button, main input, main select, main textarea, main summary')) {
        const nombre = (el.getAttribute('aria-label') ?? '').trim() || (el.textContent ?? '').trim()
          || [...(el as HTMLInputElement).labels ?? []].map((l) => l.textContent ?? '').join('').trim();
        if (nombre === '') malos.push(el.tagName + '.' + el.className);
      }
      return malos;
    });
    expect(sinNombre).toEqual([]);
    // El menú de una persona: diálogo con nombre, opciones con nombre y los pasos «Es la misma que…», «Cambiar a…» y «Editar» con campos etiquetados.
    const persona = region.getByRole('button', { name: /^Etiqueta \[DEMANDANTE_1\]/ }).first();
    await persona.click();
    const menu = menuEtiqueta(page);
    await expect(menu).toHaveAttribute('role', 'dialog');
    await expect(menu).toHaveAccessibleName('Opciones de la etiqueta [DEMANDANTE_1]');
    for (const n of ['Mostrar el dato original aquí', 'Mostrar en todo el documento', 'Es otra persona', 'Es la misma que…', 'Cambiar a…', 'Editar el texto de la etiqueta', 'Cancelar']) {
      await expect(menu.getByRole('button', { name: n, exact: true })).toBeVisible();
    }
    await menu.getByRole('button', { name: 'Es la misma que…' }).click();
    await expect(menu.getByRole('combobox', { name: 'Elija la persona u organización' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Aplicar' })).toBeDisabled();
    await cerrarMenuConEscape(page);
    await persona.click();
    await menu.getByRole('button', { name: 'Cambiar a…' }).click();
    await expect(menu.getByRole('combobox', { name: 'Elija el tipo de dato' })).toBeVisible();
    await cerrarMenuConEscape(page);
    await persona.click();
    await menu.getByRole('button', { name: 'Editar el texto de la etiqueta' }).click();
    await expect(menu.getByRole('textbox', { name: 'Texto que reemplaza el dato' })).toBeVisible();
    // Ni el menú ni sus campos traen un dato del documento.
    const textoMenu = await menu.evaluate((el) => `${el.textContent ?? ''} ${[...el.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')).join(' ')} ${(el.querySelector('input') as HTMLInputElement | null)?.value ?? ''}`);
    for (const real of ORIGINALES_VISTA) expect(textoMenu, `menú con «${real}»`).not.toContain(real);
  });

  testMedicion('T-AX-03 Vista previa no solo color: cada etiqueta lleva su texto y borde, el dato a la vista, subrayado punteado, y el dato indirecto, borde; también con colores forzados', async ({ page }) => {
    await abrirRevision(page, 'revision', TEXTO_VISTA);
    const medir = (selector: string) => page.evaluate((s) => [...document.querySelectorAll<HTMLElement>(s)].map((el) => {
      const cs = getComputedStyle(el);
      return { texto: el.textContent ?? '', borde: cs.borderTopStyle, ancho: parseFloat(cs.borderTopWidth), subrayado: cs.textDecorationLine, estilo: cs.textDecorationStyle, baja: el.classList.contains('baja') };
    }), selector);
    const comprobar = async (): Promise<void> => {
      const fichas = await medir('[data-prueba="vista-previa"] button.etiqueta');
      expect(fichas.length).toBeGreaterThan(5);
      for (const f of fichas) {
        expect(f.texto.trim(), 'la etiqueta dice su nombre en texto').not.toBe('');
        expect(f.borde).not.toBe('none');
        expect(f.ancho).toBeGreaterThanOrEqual(1);
        if (f.baja) expect(f.borde).toBe('dashed');
      }
      const avisos = await medir('[data-prueba="vista-previa"] button.revisar');
      expect(avisos.length).toBe(2);
      for (const f of avisos) { expect(f.borde).not.toBe('none'); expect(f.ancho).toBeGreaterThanOrEqual(1); }
      const vistos = await medir('[data-prueba="vista-previa"] button.revelado');
      for (const f of vistos) { expect(f.subrayado).toContain('underline'); expect(f.estilo).toBe('dotted'); }
    };
    await comprobar();
    // Se muestra el dato original de una etiqueta: queda «a la vista», subrayada con puntos, y su nombre no trae el dato.
    await etiquetas(page).first().click();
    await menuEtiqueta(page).getByRole('button', { name: 'Mostrar el dato original aquí' }).click();
    const revelado = vistaPrevia(page).locator('button.revelado').first();
    await expect(revelado).toBeVisible();
    await expect(revelado).toHaveAccessibleName(/^Dato a la vista \(.+\)\. Pulse para volver a ocultarlo\.$/);
    expect(await revelado.getAttribute('aria-label')).not.toMatch(/Ana|Ficticia|Rojas|1\.000/);
    await comprobar();
    await page.emulateMedia({ forcedColors: 'active' });
    await comprobar();
    // «Cómo leer la vista previa» explica el color con palabras, el dato a la vista y el dato indirecto.
    await page.getByRole('button', { name: 'Cómo leer la vista previa' }).click();
    const guia = page.locator('[data-prueba="como-leer"]');
    await expect(guia).toContainText('El color de cada etiqueta indica el tipo de dato, y su nombre lo dice en palabras.');
    await expect(guia).toContainText('Un texto subrayado con puntos es un dato que usted decidió dejar a la vista.');
    await expect(guia).toContainText('Un texto con fondo de aviso es un dato indirecto que sale tal cual');
  });

  testMedicion('T-AX-04 Vista previa: «Punto i de n» y el cambio de pantalla se anuncian sin texto del documento; ninguna región viva trae originales', async ({ page }) => {
    await abrirRevision(page, 'revision', TEXTO_VISTA);
    const vivas = (): Promise<string> => page.evaluate(() => [...document.querySelectorAll('[role="status"], [role="alert"], [aria-live]')].map((el) => el.textContent ?? '').join('\n'));
    for (const real of ORIGINALES_VISTA) expect(await vivas(), `región viva con «${real}»`).not.toContain(real);
    await page.locator('[data-prueba="siguiente-punto"]').click();
    await expect(page.locator('[data-prueba="anuncio-punto"]')).toHaveText(/^Punto 1 de 3: .+/);
    // Al mostrar el dato original de una etiqueta, el anuncio no repite el dato.
    await etiquetas(page).first().click();
    await menuEtiqueta(page).getByRole('button', { name: 'Mostrar el dato original aquí' }).click();
    await expect(vistaPrevia(page).locator('button.revelado').first()).toBeVisible();
    for (const real of ORIGINALES_VISTA) expect(await vivas(), `región viva con «${real}» tras mostrar un dato`).not.toContain(real);
    await page.locator('[data-prueba="continuar"]').click();
    await expect(h1(page, TITULO.descargar)).toBeFocused();
    await expect(page.locator('[data-prueba="anuncio-pantalla"]')).toHaveText('Pantalla: Descargar');
    for (const real of ORIGINALES_VISTA) expect(await vivas(), `región viva con «${real}» en Descargar`).not.toContain(real);
  });
});
