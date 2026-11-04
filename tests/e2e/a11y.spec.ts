import { test, expect, type Page } from '@playwright/test';
import { configurarSimulador, instalarSimulador, soltarRetenidos } from './ayudas-entrada';
import { testMedicion } from './lib/medicion';

// Casos de T-AX de PC-2 (8.6.6, 10.0): teclado, nombres accesibles y regiones vivas en Entrada y Procesando.
// PC-3 agrega T-AX-03 (no solo color) y PC-7 completa T-AX-01 a T-AX-04 sobre el flujo integrado y T-AX-05 a T-AX-08.
// Datos ficticios evidentes (10.1.5).

const TEXTO_PRUEBA = 'Ana Ficticia Rojas, C.C. 1.000.000.017, vive en la Calle 00 n.º 00-00 de Ciudad Ejemplo.';
const h1 = (page: Page, nombre: string) => page.getByRole('heading', { level: 1, name: nombre });

async function irAEntrada(page: Page): Promise<void> {
  await page.goto('/');
  await expect(h1(page, 'Cargar documento')).toBeVisible();
  await page.getByLabel('Código del caso').fill('PRUEBA-AX');
  await page.getByRole('radio', { name: /^No guardar la tabla/ }).check();
  await page.getByRole('button', { name: 'Crear caso' }).click();
  await expect(h1(page, 'Nombres que siempre deben ocultarse')).toBeVisible();
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
    expect(await activo(page)).toEqual({ rol: 'button', nombre: 'Anonimizar' });
    await configurarSimulador(page, { retener: 'resultado' });
    await page.keyboard.press('Enter');
    await expect(h1(page, 'Analizando')).toBeFocused();
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
    await page.getByRole('button', { name: 'Anonimizar', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(h1(page, 'Analizando')).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(h1(page, 'Entrada')).toBeFocused({ timeout: 4000 });
  });
});

test.describe('T-AX-02 nombres, roles y regiones de Entrada y Procesando', () => {
  test('T-AX-02 Entrada expone tablist, tabpanel, campo con nombre y descripción, y botones con nombre', async ({ page }) => {
    await irAEntrada(page);
    await expect(page.getByRole('tablist', { name: 'Forma de cargar el documento' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Pegar texto' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Cargar archivo' })).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByRole('tabpanel', { name: 'Pegar texto' })).toBeVisible();
    const campo = page.getByRole('textbox', { name: 'Texto del documento' });
    await expect(campo).toHaveAccessibleDescription('Pegue aquí el texto del documento. Se analiza en su equipo.');
    await expect(page.getByRole('button', { name: 'Anonimizar', exact: true })).toHaveAccessibleDescription('Pegue texto o cargue un archivo con texto para poder anonimizar.');
    await expect(page.getByRole('button', { name: 'Editar los nombres que siempre deben ocultarse' })).toBeVisible();
    await page.getByRole('tab', { name: 'Cargar archivo' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Cargar archivo' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Zona para soltar un archivo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Elegir archivo (.docx, .pdf o .txt)' })).toBeVisible();
  });

  test('T-AX-02 Procesando: lista de etapas con nombre, una barra con nombre y valor en palabras por etapa activa', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await page.getByRole('textbox', { name: 'Texto del documento' }).fill(TEXTO_PRUEBA);
    await configurarSimulador(page, { retener: 'resultado' });
    await page.getByRole('button', { name: 'Anonimizar', exact: true }).click();
    await expect(h1(page, 'Analizando')).toBeVisible();
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
    await expect(page.getByRole('checkbox', { name: 'Usar el detector de nombres adicional en este documento' })).toBeDisabled();
    await expect(page.getByText('El análisis usará reglas y la lista de nombres que siempre deben ocultarse: el detector de nombres adicional no está descargado.')).toBeVisible();
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
    await page.getByRole('button', { name: 'Anonimizar', exact: true }).click();
    await expect(h1(page, 'Analizando')).toBeVisible();
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

// ===== PC-3 · Revisión I: T-AX-01 a T-AX-04 con un DetectionSet fijo del build de medición (nunca de dist/) =====
const TEXTO_REVISION = [
  'Señora Ana Ficticia Rojas, identificada con cédula de ciudadanía número 1.000.000.001, correo ana.ficticia@ejemplo.test, teléfono 3000000000.',
  'El demandado Pedro Ejemplo Prueba, con cédula 1.000.000.002, vive en la Calle 100 # 00-00 de Bogotá.',
  'La señora Ana Ficticia Rojas solicitó el reemplazo. Contacto: 3000000000.',
].join('\n');

type Gancho = { cargar(texto: string, modelo?: string): Promise<number> };

async function abrirRevision(page: Page): Promise<void> {
  // Cuenta las violaciones de la CSP (por ejemplo, un atributo `style`): debe haber 0 (8, «Estilos»).
  await page.addInitScript(() => {
    (globalThis as unknown as { __csp: string[] }).__csp = [];
    addEventListener('securitypolicyviolation', (e) => { (globalThis as unknown as { __csp: string[] }).__csp.push(e.violatedDirective); });
  });
  await page.goto('/');
  await expect(h1(page, 'Cargar documento')).toBeVisible();
  await page.getByLabel('Código del caso').fill('PRUEBA-AX');
  await page.getByRole('radio', { name: /^No guardar la tabla/ }).check();
  await page.getByRole('button', { name: 'Crear caso' }).click();
  await expect(h1(page, 'Nombres que siempre deben ocultarse')).toBeVisible();
  await page.getByRole('textbox', { name: 'Texto de la lista' }).fill('Ana Ficticia Rojas; demandante\nPedro Ejemplo Prueba; demandado');
  await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
  await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
  await page.waitForFunction(() => '__siglowRevisionPrueba' in globalThis);
  await page.evaluate((t) => (globalThis as unknown as { __siglowRevisionPrueba: Gancho }).__siglowRevisionPrueba.cargar(t, 'plan_b'), TEXTO_REVISION);
  await expect(h1(page, 'Revisión')).toBeVisible();
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
    await expect(h1(page, 'Revisión')).toBeFocused();
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
    await expect(marcas.nth(0)).toHaveAccessibleName(/^Persona, aceptada como \[DEMANDANTE_1\]/);
    await page.keyboard.press('ArrowRight');
    await expect(marcas.nth(1)).toBeFocused();
    await page.keyboard.press('r');
    await expect(marcas.nth(1)).toHaveAccessibleName(/rechazada/);
    await page.keyboard.press('u');
    await expect(marcas.nth(1)).toHaveAccessibleName(/pendiente/);
    await page.keyboard.press('n');
    await expect(marcas.nth(1)).toBeFocused();
    await page.keyboard.press('n');
    await expect(marcas.nth(2)).toBeFocused();
    await page.keyboard.press('Shift+N');
    await expect(marcas.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(marcas.nth(0)).toBeFocused();
    // Ayuda de teclado con «?»: el diálogo atrapa el foco y Esc devuelve el foco al resaltado.
    await page.keyboard.press('?');
    const ayuda = page.getByRole('dialog', { name: 'Atajos de teclado' });
    await expect(ayuda).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(ayuda).toBeHidden();
    await expect(marcas.nth(0)).toBeFocused();
    // Sin atajos de una tecla, las letras no actúan (2.1.4).
    await page.keyboard.press('?');
    await ayuda.getByRole('checkbox', { name: /atajos de una tecla/ }).uncheck();
    await page.keyboard.press('Escape');
    await marcas.nth(2).focus();
    await page.keyboard.press('a');
    await expect(marcas.nth(2)).toHaveAccessibleName(/pendiente/);
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
    await expect(page.getByRole('button', { name: 'Aceptar mención 1 de Persona' })).toBeFocused();
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
    await expect(page.getByRole('row', { name: 'Persona, [DEMANDANTE_1], 2 menciones, 2 pendientes' })).toHaveAttribute('aria-level', '1');
    await expect(page.getByRole('row', { name: 'Cédula de ciudadanía, [CC_1], 1 mención, 1 pendiente' })).toBeVisible();
    for (const n of ['Ver original', 'Ver documento anonimizado', 'Cómo leer la vista previa', 'Atajos de teclado', 'Descartar este documento']) {
      await expect(page.getByRole('button', { name: n })).toBeVisible();
    }
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
    await expect(ficha.getByRole('button', { name: 'Aceptar esta mención' })).toBeVisible();
    await expect(ficha.getByRole('button', { name: 'Aceptar todas las menciones (2) de esta entidad' })).toBeVisible();
    await expect(ficha.getByLabel('Motivo para no ocultarlo (opcional)')).toBeVisible();
    await expect(ficha.getByLabel('Cambiar rol')).toBeVisible();
    // La vista de salida expone solo «Marcador {marcador}»: el árbol de accesibilidad no contiene originales.
    await page.getByRole('button', { name: 'Ver documento anonimizado' }).click();
    const salida = page.getByRole('region', { name: 'Documento con las etiquetas como fichas' });
    await expect(salida.getByRole('img', { name: 'Marcador [CC_1]' })).toBeVisible();
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
    await expect(region).toHaveText('Se aceptaron 2 menciones de [DEMANDANTE_1]. Quedan 7 pendientes.');
    await page.getByRole('button', { name: 'Rechazar todas las menciones de Teléfono' }).click();
    await expect(region).toHaveText('Se rechazaron 2 menciones de Teléfono. Quedan 5 pendientes.');
    await page.keyboard.press('Tab');
    const vivas = await page.evaluate(() => [...document.querySelectorAll('[role="status"], [role="alert"], [aria-live]')].map((el) => el.textContent ?? ''));
    expect(vivas.join('\n')).not.toMatch(/Ana|Ficticia|Pedro|Ejemplo|1\.000\.000|ejemplo\.test/);
    // El cambio de pantalla se anuncia y el foco va al h1 (2.4.3): «Descartar documento» vuelve a Entrada.
    await page.getByRole('button', { name: 'Descartar este documento' }).click();
    await page.getByRole('dialog', { name: 'Descartar este documento' }).getByRole('button', { name: 'Descartar este documento' }).click();
    await expect(h1(page, 'Entrada')).toBeFocused();
    await expect(page.locator('[data-prueba="anuncio-pantalla"]')).toHaveText('Pantalla: Entrada');
  });
});
