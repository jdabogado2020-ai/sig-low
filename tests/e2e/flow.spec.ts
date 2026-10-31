import { test, expect, type Page } from '@playwright/test';
import {
  configurarSimulador, DOCUMENTO_DE_TRES_PARTES, instalarSimulador, leerSimulador, soltarRetenidos,
} from './ayudas-entrada';

// Casos de PC-1 (10.0): T-IU-05 a T-IU-09 (estados, avisos, sin aprobación masiva, créditos) y T-IU-11 a T-IU-14
// (soltar fuera, impresión y guardado, bloqueo tras suspender el equipo y bloqueo entre pestañas).
// Datos ficticios evidentes (10.1.5). Los casos de otras pantallas los agregan PC-2 a PC-7 en este mismo archivo.

const h1 = (page: Page, nombre: string) => page.getByRole('heading', { level: 1, name: nombre });

async function abrirInicio(page: Page): Promise<void> {
  await page.goto('/');
  await expect(h1(page, 'Inicio')).toBeVisible();
}

async function crearAsunto(page: Page, codigo = 'PRUEBA-001'): Promise<void> {
  await page.getByLabel('Código del asunto').fill(codigo);
  await page.getByRole('radio', { name: /^No guardar la tabla/ }).check();
  await page.getByRole('button', { name: 'Crear asunto' }).click();
  await expect(h1(page, 'Lista del caso')).toBeVisible();
}

async function pegarLista(page: Page, texto: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Texto de la lista' }).fill(texto);
  await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
}

const PROMESA =
  'Sus documentos no salen de su equipo. La herramienta propone los reemplazos, le muestra lo que puede quedar y usted aprueba antes de copiar.';

test.describe('T-IU-05 estados globales y de Inicio', () => {
  test('T-IU-05 @humo Inicio vacío: M-106, formulario sin valores por defecto y «Crear asunto» deshabilitado', async ({ page }) => {
    await abrirInicio(page);
    await expect(page.locator('[data-prueba="promesa"]')).toHaveText(PROMESA);
    await expect(page.getByText('No hay asuntos guardados en este navegador.')).toBeVisible();
    await expect(page.getByRole('radio', { name: /^Guardar tabla cifrada/ })).not.toBeChecked();
    await expect(page.getByRole('radio', { name: /^No guardar la tabla/ })).not.toBeChecked();
    const crear = page.getByRole('button', { name: 'Crear asunto' });
    await expect(crear).toBeDisabled();
    // Sin conexión de bóveda conectada, «Guardar» queda deshabilitado con M-208 (8.2.2, 8.3).
    await expect(page.getByRole('radio', { name: /^Guardar tabla cifrada/ })).toBeDisabled();
    await expect(page.locator('[data-prueba="guardar-no-disponible"]')).toContainText('Este navegador no permite guardar datos de Sig-Low');
    await page.getByLabel('Código del asunto').fill('---');
    await expect(page.getByText('El código admite de 1 a 40 caracteres: letras sin tilde, números, espacio, punto, guion, guion bajo y barra.')).toBeVisible();
    await page.getByRole('radio', { name: /^No guardar la tabla/ }).check();
    await expect(crear).toBeDisabled();
    await page.getByLabel('Código del asunto').fill('PRUEBA-001');
    await expect(page.getByLabel('Código del asunto')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(crear).toBeEnabled();
  });

  test('T-IU-05 @humo «No guardar» crea el asunto en memoria y pasa a la Lista del caso con M-14, el chip y los pasos', async ({ page }) => {
    await abrirInicio(page);
    await crearAsunto(page, 'PRUEBA-001');
    await expect(page.locator('[data-prueba="chip-asunto"]')).toContainText('Asunto PRUEBA-001');
    await expect(page.locator('[data-prueba="chip-asunto"]')).toContainText('Tabla solo en memoria');
    await expect(page.getByText('La tabla se perderá al cerrar o bloquear.')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Pasos del asunto' }).locator('[aria-current="step"]')).toHaveText('Lista del caso');
    await expect(page.getByText('Todavía no hay personas ni organizaciones en la lista del caso.')).toBeVisible();
    // Cambio de pantalla: foco al h1 nuevo y anuncio «Pantalla: {nombre}» (8.2.1, 8.6.3).
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(h1(page, 'Entrada')).toBeFocused();
    await expect(page.locator('[data-prueba="anuncio-pantalla"]')).toHaveText('Pantalla: Entrada');
    await expect(page.getByRole('navigation', { name: 'Pasos del asunto' }).locator('[aria-current="step"]')).toHaveText('Entrada');
    // «Cerrar asunto» vuelve a Inicio sin aviso de bloqueo.
    await page.getByRole('button', { name: 'Menú del asunto' }).click();
    await page.getByRole('button', { name: 'Cerrar asunto' }).click();
    await expect(h1(page, 'Inicio')).toBeVisible();
    await expect(page.locator('[data-prueba="aviso-bloqueo"]')).toHaveCount(0);
  });

  test('T-IU-05 «Bloquear» vacía el estado y muestra M-102 y M-103 (INV-G09)', async ({ page }) => {
    await abrirInicio(page);
    await crearAsunto(page);
    await pegarLista(page, 'Ana Ficticia Rojas; demandante');
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await expect(page.getByRole('rowheader', { name: 'Ana Ficticia Rojas' })).toBeVisible();
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(h1(page, 'Inicio')).toBeVisible();
    await expect(page.locator('[data-prueba="aviso-bloqueo"]')).toContainText('Sig-Low se bloqueó y borró de la memoria el documento y la revisión en curso.');
    await expect(page.locator('[data-prueba="aviso-bloqueo"]')).toContainText('La tabla de ese asunto no estaba guardada y se perdió.');
    await expect(page.locator('body')).not.toContainText('Ana Ficticia Rojas');
    await expect(page.locator('[data-prueba="chip-asunto"]')).toHaveCount(0);
  });

  test('T-IU-05 M-39: el indicador «Lista para funcionar sin conexión» aparece cuando el service worker dejó la caché de la app', async ({ page }) => {
    await abrirInicio(page);
    await expect(page.locator('[data-prueba="sin-conexion"]')).toHaveText('');
    await page.evaluate(async () => { await caches.open('siglow-app-prueba'); });
    await page.reload();
    await expect(h1(page, 'Inicio')).toBeVisible();
    await expect(page.locator('[data-prueba="sin-conexion"]')).toHaveText('Lista para funcionar sin conexión');
  });

  test('T-IU-05 sin controlador: SIN_SERVICE_WORKER muestra M-35 y M-36 y no monta ningún campo de contenido', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL: baseURL ?? '', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(h1(page, 'Sig-Low todavía no puede recibir documentos')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-prueba="sin-sw"]')).toContainText('Pulse «Recargar»');
    await expect(page.getByRole('button', { name: 'Recargar' })).toBeVisible();
    await expect(page.locator('input, textarea, select')).toHaveCount(0);
    await expect(page.locator('[data-prueba="promesa"]')).toHaveText(PROMESA);
    expect(await page.title()).toBe('Sig-Low');
    await ctx.close();
  });
});

test.describe('T-IU-07 avisos de buenas prácticas', () => {
  test('T-IU-07 el aviso inicial se expande en cada carga y «Entendido» lo pliega hasta recargar', async ({ page }) => {
    await abrirInicio(page);
    const aviso = page.locator('[data-prueba="aviso-inicial"]');
    await expect(aviso.getByRole('heading', { name: 'Antes de empezar' })).toBeVisible();
    await expect(aviso).toContainText('Trabaje en una ventana normal del navegador');
    await expect(aviso).toContainText('No use los asistentes de IA integrados en el navegador mientras tenga un documento abierto en Sig-Low');
    await expect(aviso).toContainText('No comparta ni grabe la pantalla mientras haya un documento abierto.');
    await expect(aviso).toContainText('Use un perfil del navegador solo para Sig-Low: sin extensiones, sin sesión iniciada y sin sincronización.');
    await expect(aviso).toContainText('No traduzca esta página con el navegador ni use su corrector en línea.');
    await aviso.getByRole('button', { name: 'Entendido' }).click();
    await expect(aviso).not.toContainText('Trabaje en una ventana normal');
    await page.reload();
    await expect(h1(page, 'Inicio')).toBeVisible();
    await expect(page.locator('[data-prueba="aviso-inicial"]')).toContainText('Trabaje en una ventana normal del navegador');
  });
});

test.describe('T-IU-08 sin aprobación masiva', () => {
  test('T-IU-08 INV-R06: Inicio y Lista del caso no ofrecen aceptar todo el documento', async ({ page }) => {
    await abrirInicio(page);
    await expect(page.getByRole('button', { name: /aceptar todo|aceptar todas/i })).toHaveCount(0);
    await crearAsunto(page);
    await expect(page.getByRole('button', { name: /aceptar todo|aceptar todas/i })).toHaveCount(0);
  });
});

test.describe('T-IU-09 créditos y licencias', () => {
  test('T-IU-09 «Acerca de» → «Créditos y licencias» trae los avisos de licencia y no tiene casilla de aceptación', async ({ page }) => {
    await abrirInicio(page);
    await page.getByRole('button', { name: 'Acerca de' }).click();
    const acerca = page.getByRole('dialog', { name: 'Acerca de Sig-Low' });
    await expect(acerca).toBeVisible();
    await expect(acerca).toContainText(PROMESA);
    await expect(acerca).toContainText('Reemplazar nombres por marcadores es seudonimizar');
    await acerca.getByRole('button', { name: 'Créditos y licencias' }).click();
    const creditos = page.getByRole('dialog', { name: 'Créditos y licencias' });
    await expect(creditos).toBeVisible();
    for (const texto of ['Preact', 'MIT', 'Apache-2.0', 'CC BY-SA 4.0', 'DANE', 'GLiNER-X', 'mT5', '@piighost/ner-web', 'pdf.js', 'fflate', 'onnxruntime-web']) {
      await expect(creditos).toContainText(texto);
    }
    await expect(creditos.locator('input[type="checkbox"], input[type="radio"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(creditos).toBeHidden();
    // Desde Inicio, el enlace «Ver créditos y licencias» abre el mismo diálogo.
    await page.getByRole('button', { name: 'Ver créditos y licencias' }).click();
    await expect(page.getByRole('dialog', { name: 'Créditos y licencias' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Ver créditos y licencias' })).toBeFocused();
  });
});

test.describe('Lista del caso (8.2.3)', () => {
  test('T-IU-05 agregar, editar y quitar entidades; la organización lleva clase y nunca rol (INV-L01)', async ({ page }) => {
    await abrirInicio(page);
    await crearAsunto(page);
    await page.getByLabel('Nombre', { exact: true }).fill('Ana Ficticia Rojas');
    await page.getByRole('button', { name: 'Agregar', exact: true }).click();
    await page.getByLabel('Nombre', { exact: true }).fill('Ferretería Ejemplo S.A.S.');
    await page.getByRole('radio', { name: 'Organización' }).check();
    await expect(page.getByLabel('Clase', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Rol', { exact: true })).toHaveCount(0);
    await page.getByLabel('Clase', { exact: true }).selectOption('EPS');
    await page.getByRole('button', { name: 'Agregar', exact: true }).click();
    const tabla = page.locator('[data-prueba="tabla-entidades"]');
    await expect(tabla.getByRole('row')).toHaveCount(3);
    await expect(tabla.getByRole('row', { name: /Ferretería Ejemplo S\.A\.S\./ }).getByRole('cell').nth(0)).toHaveText('Organización');
    await expect(page.getByLabel('Clase: Ferretería Ejemplo S.A.S.')).toHaveValue('EPS');
    await expect(page.getByLabel('Rol: Ana Ficticia Rojas')).toHaveValue('DEMANDANTE');
    // Cambiar el rol de la persona desde la tabla.
    await page.getByLabel('Rol: Ana Ficticia Rojas').selectOption('TESTIGO');
    await expect(page.getByLabel('Rol: Ana Ficticia Rojas')).toHaveValue('TESTIGO');
    // Editar el nombre.
    await page.getByRole('button', { name: 'Editar Ana Ficticia Rojas' }).click();
    await page.getByLabel('Nombre', { exact: true }).fill('Ana Ficticia Rojas de Prueba');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('rowheader', { name: 'Ana Ficticia Rojas de Prueba' })).toBeVisible();
    await page.getByRole('button', { name: 'Quitar Ferretería Ejemplo S.A.S.' }).click();
    await expect(tabla.getByRole('row')).toHaveCount(2);
    await page.getByLabel('Nombre', { exact: true }).fill('   ');
    await page.getByRole('button', { name: 'Agregar', exact: true }).click();
    await expect(page.getByText('Escriba el nombre.')).toBeVisible();
  });

  test('T-IU-05 «Pegar lista»: vista previa con M-42, M-43 y M-45; agrega solo las líneas válidas', async ({ page }) => {
    await abrirInicio(page);
    await crearAsunto(page);
    await pegarLista(page, 'Ana Ficticia Rojas; demandante\nFerretería Ejemplo S.A.S.; demandada\nPersona Sin Rol; xyz\n; testigo');
    const vista = page.locator('[data-prueba="vista-previa-lista"]');
    await expect(vista).toContainText('Línea 3: no se reconoce el rol o la clase.');
    await expect(vista).toContainText('Línea 4: falta el nombre antes del punto y coma.');
    await expect(vista).toContainText('Línea 2: se tomó como organización (Empresa) por el sufijo o la sigla del nombre.');
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await expect(page.locator('[data-prueba="lineas-agregadas"]')).toHaveText('Se agregaron 2 entidades.');
    const tabla = page.locator('[data-prueba="tabla-entidades"]');
    await expect(tabla.getByRole('row')).toHaveCount(3);
    await expect(page.getByLabel('Clase: Ferretería Ejemplo S.A.S.')).toHaveValue('EMPRESA');
  });

  test('T-IU-05 vista previa de variantes: interruptor «Buscar esta variante», variante manual y M-44 compartida', async ({ page }) => {
    await abrirInicio(page);
    await crearAsunto(page);
    await pegarLista(page, 'Ana Ficticia Rojas; demandante\nBeatriz Prueba Rojas; demandado');
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await page.getByRole('button', { name: 'Vista previa: Ana Ficticia Rojas' }).click();
    const panel = page.locator('[data-prueba="panel-variantes"]');
    await expect(panel).toContainText('Ana Ficticia Rojas');
    await expect(panel.locator('[data-prueba="variante-compartida"]').first()).toHaveText(
      'Esta variante coincide con otra persona u organización de la lista. Se buscará con confianza baja; revise cada aparición.',
    );
    const casilla = panel.getByRole('checkbox', { name: 'Buscar esta variante (Ficticia Rojas)' });
    await expect(casilla).toBeChecked();
    await casilla.uncheck();
    await expect(casilla).not.toBeChecked();
    await panel.getByLabel('Texto de la variante').fill('A. Ficticia');
    await panel.getByRole('button', { name: 'Agregar variante' }).click();
    await expect(panel).toContainText('A. Ficticia');
    await expect(panel).toContainText('Escrita por usted');
  });
});

test.describe('T-IU-11 soltar-fuera', () => {
  const soltar = async (page: Page) =>
    page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['x'], 'Archivo Testigo Ficticio.pdf', { type: 'application/pdf' }));
      const mk = (tipo: string) => new DragEvent(tipo, { bubbles: true, cancelable: true, dataTransfer: dt });
      const over = mk('dragover');
      document.body.dispatchEvent(over);
      const drop = mk('drop');
      document.body.dispatchEvent(drop);
      return { over: over.defaultPrevented, drop: drop.defaultPrevented, efecto: dt.dropEffect, href: location.href, historial: history.length };
    });

  test('T-IU-11 en Inicio y en Lista del caso, dragover y drop quedan prevenidos sin cambiar la URL ni el historial', async ({ page }) => {
    await abrirInicio(page);
    const href = page.url();
    const hist = await page.evaluate(() => history.length);
    let r = await soltar(page);
    expect(r).toMatchObject({ over: true, drop: true, efecto: 'none', href });
    expect(r.historial).toBe(hist);
    await crearAsunto(page);
    r = await soltar(page);
    expect(r).toMatchObject({ over: true, drop: true, href });
    expect(r.historial).toBe(hist);
    expect(await page.title()).toBe('Sig-Low');
  });

  test('T-IU-11 también en el estado sin service worker', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL: baseURL ?? '', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(h1(page, 'Sig-Low todavía no puede recibir documentos')).toBeVisible({ timeout: 20_000 });
    const r = await soltar(page);
    expect(r).toMatchObject({ over: true, drop: true, efecto: 'none' });
    await ctx.close();
  });
});

test.describe('T-IU-12 impresion-y-guardado', () => {
  test('T-IU-12 en impresión el texto visible no contiene originales y Ctrl+S muestra M-125 sin guardar la página', async ({ page }) => {
    await abrirInicio(page);
    await crearAsunto(page);
    await pegarLista(page, 'Ana Ficticia Rojas; demandante');
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await expect(page.getByRole('rowheader', { name: 'Ana Ficticia Rojas' })).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    const visible = await page.evaluate(() => document.body.innerText);
    expect(visible).not.toContain('Ana Ficticia');
    expect(visible).toContain('Sig-Low no imprime documentos.');
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => {
      (globalThis as unknown as { __cs: boolean[] }).__cs = [];
      addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 's' && (e.ctrlKey || e.metaKey)) (globalThis as unknown as { __cs: boolean[] }).__cs.push(e.defaultPrevented); });
    });
    await page.keyboard.press('Control+s');
    await expect(page.locator('[data-prueba="aviso-global"]')).toContainText('Sig-Low no guarda la página. Use «Exportar tabla cifrada» o los botones de descarga.');
    // Los manejadores de la página corren antes que el de la prueba (captura vs. burbuja): el evento ya llegó prevenido.
    const prevenidos = await page.evaluate(() => (globalThis as unknown as { __cs: boolean[] }).__cs);
    expect(prevenidos).toEqual([true]);
  });
});

/** Abre un asunto «No guardar» con reloj simulado. */
async function conReloj(page: Page, inicio: string, codigo: string): Promise<void> {
  await page.clock.install({ time: new Date(inicio) });
  await abrirInicio(page);
  await crearAsunto(page, codigo);
}

test.describe('T-IU-13 bloqueo-suspension', () => {
  test('T-IU-13 INV-G09: al reanudar tras 16 min el bloqueo es inmediato, sin aviso y con el estado vacío', async ({ page }) => {
    await conReloj(page, '2026-10-30T10:00:00', 'PRUEBA-013');
    await pegarLista(page, 'Ana Ficticia Rojas; demandante');
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await expect(page.getByRole('rowheader', { name: 'Ana Ficticia Rojas' })).toBeVisible();
    await page.clock.setSystemTime(new Date('2026-10-30T10:16:00'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(h1(page, 'Inicio')).toBeVisible();
    await expect(page.locator('[data-prueba="aviso-bloqueo"]')).toContainText('Sig-Low se bloqueó');
    await expect(page.locator('[data-prueba="aviso-bloqueo"]')).toContainText('La tabla de ese asunto no estaba guardada y se perdió.');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('Ana Ficticia Rojas');
  });

  test('T-IU-13 entre 14 y 15 min aparece M-101 con cuenta regresiva; «Seguir trabajando» y Esc reinician', async ({ page }) => {
    await conReloj(page, '2026-10-30T10:00:00', 'PRUEBA-013');
    await page.clock.setSystemTime(new Date('2026-10-30T10:14:30'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const aviso = page.getByRole('alertdialog');
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText('Sig-Low se bloqueará en 30 segundos por inactividad.');
    await aviso.getByRole('button', { name: 'Seguir trabajando' }).click();
    await expect(aviso).toBeHidden();
    // Esc equivale a «Seguir trabajando» (2.1.2 del plan 8.6.1).
    await page.clock.setSystemTime(new Date('2026-10-30T10:29:30'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(aviso).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(aviso).toBeHidden();
    await expect(h1(page, 'Lista del caso')).toBeVisible();
  });

  test('T-IU-13 con 15 min exactos o más bloquea en el mismo manejador, antes de pintar el aviso', async ({ page }) => {
    await conReloj(page, '2026-10-30T10:00:00', 'PRUEBA-013');
    await page.clock.setSystemTime(new Date('2026-10-30T10:15:00'));
    await page.evaluate(() => dispatchEvent(new Event('focus')));
    await expect(h1(page, 'Inicio')).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });
});

test.describe('T-IU-14 bloqueo-pestanas', () => {
  test('T-IU-14 INV-G09: «Bloquear» en una pestaña bloquea la otra en ≤ 1 s', async ({ context, baseURL }) => {
    const a = await context.newPage();
    const b = await context.newPage();
    for (const [p, codigo] of [[a, 'PRUEBA-14A'], [b, 'PRUEBA-14B']] as const) {
      await p.goto(baseURL ?? '/');
      await expect(h1(p, 'Inicio')).toBeVisible();
      await crearAsunto(p, codigo);
    }
    await a.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(h1(a, 'Inicio')).toBeVisible();
    await expect(h1(b, 'Inicio')).toBeVisible({ timeout: 1000 });
    await expect(b.locator('[data-prueba="aviso-bloqueo"]')).toContainText('Sig-Low se bloqueó');
    await expect(b.locator('[data-prueba="chip-asunto"]')).toHaveCount(0);
  });

  test('T-IU-14 INV-G09: la actividad en una pestaña impide el bloqueo por inactividad de la otra', async ({ context, baseURL }) => {
    const a = await context.newPage();
    const b = await context.newPage();
    for (const [p, codigo] of [[a, 'PRUEBA-14A'], [b, 'PRUEBA-14B']] as const) {
      await p.clock.install({ time: new Date('2026-10-30T10:00:00') });
      await p.goto(baseURL ?? '/');
      await expect(h1(p, 'Inicio')).toBeVisible();
      await crearAsunto(p, codigo);
    }
    // La pestaña A trabaja a los 10 min y lo difunde.
    await a.clock.setSystemTime(new Date('2026-10-30T10:10:00'));
    await a.keyboard.press('a');
    await b.waitForTimeout(300);
    // A los 16 min de su reloj, B sigue sin bloquearse: la última actividad fue a los 10 min.
    await b.clock.setSystemTime(new Date('2026-10-30T10:16:00'));
    await b.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(h1(b, 'Lista del caso')).toBeVisible();
    await expect(b.getByRole('alertdialog')).toHaveCount(0);
    // Pasados 15 min desde la actividad de A (10:25), B sí se bloquea.
    await b.clock.setSystemTime(new Date('2026-10-30T10:25:30'));
    await b.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(h1(b, 'Inicio')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// PC-2 · Entrada y Procesando
// ---------------------------------------------------------------------------------------------------------------------------

const TEXTO_PRUEBA = 'Ana Ficticia Rojas, C.C. 1.000.000.017, vive en la Calle 00 n.º 00-00 de Ciudad Ejemplo. Correo: ana.ficticia@ejemplo.test.';

async function irAEntrada(page: Page, codigo = 'PRUEBA-002'): Promise<void> {
  await abrirInicio(page);
  await crearAsunto(page, codigo);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(h1(page, 'Entrada')).toBeVisible();
}
const areaTexto = (page: Page) => page.getByRole('textbox', { name: 'Texto del documento' });
const analizar = (page: Page) => page.getByRole('button', { name: 'Analizar', exact: true });
const alertaEntrada = (page: Page) => page.locator('[data-prueba="error-entrada"]');

async function cargarArchivo(page: Page, nombre: string, contenido: Buffer | string, mimeType = 'application/octet-stream'): Promise<void> {
  await page.getByRole('tab', { name: 'Cargar archivo' }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: nombre, mimeType, buffer: typeof contenido === 'string' ? Buffer.from(contenido, 'utf8') : contenido });
}
const ZIP_MINIMO = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0]);

test.describe('T-IU-05 Entrada: pegar, cargar y estados', () => {
  test('T-IU-05 @humo pegar → Procesando → Revisión: reglas y lista, con el modelo en plan B (no descargado)', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await expect(page.getByRole('navigation', { name: 'Pasos del asunto' }).locator('[aria-current="step"]')).toHaveText('Entrada');
    await areaTexto(page).fill(TEXTO_PRUEBA);
    await configurarSimulador(page, { retener: 'resultado' });
    await analizar(page).click();
    await expect(h1(page, 'Procesando')).toBeFocused();
    await expect(page.getByRole('heading', { level: 2, name: 'Analizando el documento en su equipo' })).toBeVisible();
    await configurarSimulador(page, { retener: null });
    await soltarRetenidos(page);
    await expect(h1(page, 'Revisión')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Pasos del asunto' }).locator('[aria-current="step"]')).toHaveText('Revisión');
    const sim = await leerSimulador(page);
    expect(sim.creados).toContain('detect');
    expect(sim.enviados.find((e) => e.kind === 'detectar')?.incluidas).toEqual([true]);
    expect(await page.title()).toBe('Sig-Low');
  });

  test('T-IU-05 Entrada vacía: «Analizar» deshabilitado con su ayuda, modelo sin descargar con M-51 y «Editar lista del caso» conserva el texto', async ({ page }) => {
    await irAEntrada(page);
    await expect(analizar(page)).toBeDisabled();
    await expect(page.getByText('Pegue texto o cargue un archivo con texto para poder analizar.')).toBeVisible();
    await expect(page.getByText('Pegue aquí el texto del documento. Se analiza en su equipo.')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Usar el modelo de apoyo' })).toBeDisabled();
    await expect(page.getByText('El análisis usará reglas y lista del caso: el modelo de apoyo no está descargado.')).toBeVisible();
    await areaTexto(page).fill('   \n  ');
    await expect(analizar(page)).toBeDisabled();
    await areaTexto(page).fill(TEXTO_PRUEBA);
    await expect(analizar(page)).toBeEnabled();
    await page.getByRole('button', { name: 'Editar lista del caso' }).click();
    await expect(h1(page, 'Lista del caso')).toBeVisible();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(h1(page, 'Entrada')).toBeVisible();
    await expect(areaTexto(page)).toHaveValue(TEXTO_PRUEBA);
  });

  test('T-IU-05 el contador de caracteres se actualiza con una demora de 300 ms', async ({ page }) => {
    await irAEntrada(page);
    const contador = page.locator('[data-prueba="contador-caracteres"]');
    await expect(contador).toHaveText('0 caracteres');
    await areaTexto(page).fill('Texto de Prueba');
    await expect(contador).toHaveText('0 caracteres');
    await expect(contador).toHaveText('15 caracteres');
  });

  test('T-IU-05 F-08 los campos de Entrada llevan los atributos de 8.7 y ids neutros; el input de archivo está oculto', async ({ page }) => {
    await irAEntrada(page);
    const area = areaTexto(page);
    for (const [atributo, valor] of [
      ['spellcheck', 'false'], ['autocomplete', 'off'], ['autocorrect', 'off'], ['autocapitalize', 'off'], ['translate', 'no'],
      ['data-gramm', 'false'], ['data-gramm_editor', 'false'], ['data-enable-grammarly', 'false'], ['data-lt-active', 'false'],
    ] as const) {
      await expect(area).toHaveAttribute(atributo, valor);
    }
    expect(await area.getAttribute('id')).toMatch(/^c\d+$/);
    expect(await area.getAttribute('name')).toMatch(/^c\d+$/);
    await page.getByRole('tab', { name: 'Cargar archivo' }).click();
    const archivo = page.locator('input[type="file"]');
    await expect(archivo).toBeHidden();
    await expect(archivo).toHaveAttribute('accept', '.txt,.docx,.pdf');
    expect(await archivo.getAttribute('id')).toMatch(/^c\d+$/);
    // Ningún campo de Entrada usa contenteditable (8.7).
    await expect(page.locator('[contenteditable]')).toHaveCount(0);
  });

  test('T-IU-05 un .txt se lee en el worker `io` y no deja el nombre en ninguna parte (V-37, INV-D05, F-08)', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await cargarArchivo(page, 'Ana Ficticia Rojas.txt', TEXTO_PRUEBA, 'text/plain');
    const cargado = page.locator('[data-prueba="archivo-cargado"]');
    await expect(cargado).toContainText('Archivo cargado: .txt, ');
    await expect(cargado).toContainText('Sig-Low no muestra ni guarda el nombre del archivo.');
    await expect(page.locator('body')).not.toContainText('Ficticia Rojas.txt');
    expect(await page.title()).toBe('Sig-Low');
    expect(page.url()).not.toContain('Ficticia');
    expect(await page.locator('input[type="file"]').inputValue()).toBe('');
    const sim = await leerSimulador(page);
    expect(sim.creados).toContain('io');
    expect(sim.terminados).toContain('io');          // un worker por archivo, terminado al responder (6.11.4)
    await expect(analizar(page)).toBeEnabled();
    await analizar(page).click();
    await expect(h1(page, 'Revisión')).toBeVisible();
    expect((await leerSimulador(page)).creados).toContain('detect');
  });

  test('T-IU-05 un archivo soltado dentro de la zona se lee igual que uno elegido', async ({ page }) => {
    await irAEntrada(page);
    await page.getByRole('tab', { name: 'Cargar archivo' }).click();
    await page.evaluate((texto) => {
      const dt = new DataTransfer();
      dt.items.add(new File([texto], 'Oficio de Prueba.txt', { type: 'text/plain' }));
      document.querySelector('[data-zona-soltar]')!.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, TEXTO_PRUEBA);
    await expect(page.locator('[data-prueba="archivo-cargado"]')).toContainText('Archivo cargado: .txt, ');
    await expect(page.locator('body')).not.toContainText('Oficio de Prueba');
  });

  test('T-IU-05 cada formato que no se puede leer muestra su mensaje de 8.5.2 con role="alert" y sin nombres de archivo', async ({ page }) => {
    await irAEntrada(page);
    const CFB = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    await cargarArchivo(page, 'Oficio de Prueba.doc', CFB);
    await expect(alertaEntrada(page)).toHaveText(/^Este archivo es un \.doc antiguo o un \.docx protegido con contraseña\./);
    await cargarArchivo(page, 'Hoja de Prueba.xlsx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));
    await expect(alertaEntrada(page)).toHaveText('Sig-Low lee archivos .txt, .docx y PDF con texto. Para otros formatos, pegue el texto.');
    await cargarArchivo(page, 'Vacio de Prueba.txt', Buffer.alloc(0));
    await expect(alertaEntrada(page)).toHaveText('El archivo está vacío o no tiene texto.');
    await cargarArchivo(page, 'Imagen de Prueba.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
    await expect(alertaEntrada(page)).toHaveText(/^Sig-Low lee archivos \.txt, \.docx y PDF/);
    await cargarArchivo(page, 'Grande de Prueba.txt', Buffer.alloc(26_214_401, 0x61));
    await expect(alertaEntrada(page)).toHaveText('El archivo supera el límite de 25 MB. Divídalo o pegue el texto.');
    await expect(alertaEntrada(page)).toHaveAttribute('role', 'alert');
    await expect(page.locator('body')).not.toContainText('de Prueba.');
    await expect(analizar(page)).toBeDisabled();
  });

  test('T-IU-05 .docx y .pdf están cableados: sin lector conectado responden formato no disponible o el error propio del lector', async ({ page }) => {
    await irAEntrada(page);
    await cargarArchivo(page, 'Contrato de Prueba.docx', ZIP_MINIMO);
    await expect(alertaEntrada(page)).toHaveText(/^(Sig-Low lee archivos \.txt, \.docx y PDF con texto|El archivo \.docx está dañado)/);
    await cargarArchivo(page, 'Sentencia de Prueba.pdf', Buffer.from('%PDF-1.7\n%âãÏÓ\n', 'latin1'));
    await expect(alertaEntrada(page)).toHaveText(/^(Sig-Low lee archivos \.txt, \.docx y PDF con texto|El PDF está dañado)/);
    await expect(page.locator('body')).not.toContainText('de Prueba.');
  });

  test('T-IU-05 un archivo que excede el tiempo límite termina en TIEMPO_AGOTADO y el worker `io` se termina (6.11.6)', async ({ page }) => {
    test.setTimeout(45_000);
    await instalarSimulador(page);
    await irAEntrada(page);
    await configurarSimulador(page, { io: 'mudo' });
    await cargarArchivo(page, 'Lento de Prueba.txt', TEXTO_PRUEBA, 'text/plain');
    await expect(page.locator('[data-prueba="lectura-en-curso"]')).toContainText('Leyendo el archivo en su equipo');
    await expect(alertaEntrada(page)).toHaveText('La operación tardó demasiado y se detuvo. Intente con un documento más corto o divídalo.', { timeout: 25_000 });
    const sim = await leerSimulador(page);
    expect(sim.terminados).toContain('io');
    await expect(analizar(page)).toBeDisabled();
    await expect(page.locator('[data-prueba="lectura-en-curso"]')).toHaveCount(0);
  });

  test('T-IU-05 «Cancelar lectura» termina el worker `io` de inmediato y no deja error', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await configurarSimulador(page, { io: 'mudo' });
    await cargarArchivo(page, 'Lento de Prueba.txt', TEXTO_PRUEBA, 'text/plain');
    await page.getByRole('button', { name: 'Cancelar lectura' }).click();
    await expect(page.locator('[data-prueba="lectura-cancelada"]')).toHaveText('Lectura cancelada.');
    await expect(alertaEntrada(page)).toHaveCount(0);
    expect((await leerSimulador(page)).terminados).toContain('io');
    await expect(analizar(page)).toBeDisabled();
  });

  test('T-IU-05 INV-D04 partes con casillas, aviso de metadatos solo por categorías y un renglón por advertencia', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await configurarSimulador(page, { io: 'documento', docIo: DOCUMENTO_DE_TRES_PARTES });
    await cargarArchivo(page, 'Contrato de Prueba.docx', ZIP_MINIMO);
    const cargado = page.locator('[data-prueba="archivo-cargado"]');
    await expect(cargado).toContainText('Archivo cargado: .docx, ');
    // Partes: etiqueta neutra y número de caracteres; todas marcadas.
    await expect(page.getByRole('group', { name: 'Partes encontradas' })).toBeVisible();
    for (const [etiqueta, n] of [['Cuerpo del documento', 69], ['Encabezado 1', 20], ['Comentario 1', 27]] as const) {
      await expect(page.getByRole('checkbox', { name: `${etiqueta} · ${n} caracteres` })).toBeChecked();
    }
    await expect(page.getByText('Estas son las partes del documento. Desmarque solo lo que no quiera en la salida: lo desmarcado no se analiza ni se copia.')).toBeVisible();
    // Metadatos: solo categorías (M-401 y M-406), sin ningún valor.
    await expect(page.locator('[data-prueba="aviso-metadatos"]')).toHaveText(
      'El archivo original contiene información adicional que Sig-Low no copia a la salida: Propiedades del documento (autor, título, fechas); Autores y fechas de revisiones y comentarios. Si envía o comparte el archivo original, esa información va con él.',
    );
    // Advertencias: una por código (M-50 y M-307).
    const avisos = page.locator('[data-prueba="avisos-lectura"] li');
    await expect(avisos).toHaveCount(2);
    await expect(avisos.nth(0)).toContainText('El archivo conserva texto eliminado con control de cambios (2 fragmentos).');
    await expect(avisos.nth(1)).toContainText('El documento tiene una marca de agua o texto artístico (1).');
    // Lo desmarcado no se analiza (S-09): el worker `detect` recibe `included: false` en esa parte.
    await page.getByRole('checkbox', { name: 'Comentario 1 · 27 caracteres' }).uncheck();
    await analizar(page).click();
    await expect(h1(page, 'Revisión')).toBeVisible();
    const enviado = (await leerSimulador(page)).enviados.find((e) => e.kind === 'detectar');
    expect(enviado?.incluidas).toEqual([true, true, false]);
  });

  test('T-IU-05 si todas las partes están desmarcadas no se puede analizar', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await configurarSimulador(page, { io: 'documento', docIo: DOCUMENTO_DE_TRES_PARTES });
    await cargarArchivo(page, 'Contrato de Prueba.docx', ZIP_MINIMO);
    await expect(analizar(page)).toBeEnabled();
    for (const n of ['Cuerpo del documento · 69', 'Encabezado 1 · 20', 'Comentario 1 · 27']) {
      await page.getByRole('checkbox', { name: `${n} caracteres` }).uncheck();
    }
    await expect(analizar(page)).toBeDisabled();
  });

  test('T-IU-05 INV-G09 «Bloquear» borra el texto pegado de la pantalla y de la memoria', async ({ page }) => {
    await irAEntrada(page);
    await areaTexto(page).fill(TEXTO_PRUEBA);
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(h1(page, 'Inicio')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Ana Ficticia Rojas');
    await crearAsunto(page, 'PRUEBA-003');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(areaTexto(page)).toHaveValue('');
  });
});

test.describe('T-IU-05 Procesando: progreso por etapa, cancelar y errores', () => {
  test('T-IU-05 Procesando muestra las etapas con su estado, una barra por etapa y «Cancelar análisis»', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await areaTexto(page).fill(TEXTO_PRUEBA);
    await configurarSimulador(page, { retener: 'resultado' });
    await analizar(page).click();
    await expect(h1(page, 'Procesando')).toBeVisible();
    const etapas = page.locator('[data-prueba="etapas"]');
    await expect(etapas.locator('li')).toHaveCount(7);
    await expect(etapas.locator('[data-prueba="etapa-lectura"]')).toContainText('Lectura del documento · Terminada');
    await expect(etapas.locator('[data-prueba="etapa-reglas"]')).toContainText('Reglas de formatos colombianos');
    await expect(etapas.locator('[data-prueba="etapa-lista"]')).toContainText('Lista del caso');
    await expect(etapas.locator('[data-prueba="etapa-modelo"]')).toContainText('Modelo de apoyo · Omitida');
    // Sin el modelo, sus dos etapas no cuentan; las demás tienen su <progress> con nombre.
    await expect(etapas.getByRole('progressbar', { name: 'Reglas de formatos colombianos' })).toBeVisible();
    await expect(etapas.getByRole('progressbar', { name: 'Modelo de apoyo' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancelar análisis' })).toBeVisible();
    await expect(page.locator('[data-prueba="anuncio-progreso"]')).toHaveAttribute('role', 'status');
    await configurarSimulador(page, { retener: null });
    await soltarRetenidos(page);
    await expect(h1(page, 'Revisión')).toBeVisible();
  });

  test('T-IU-05 «Cancelar análisis» vuelve a Entrada con M-61, conserva el texto y termina el worker `detect` sin respuesta en 2 s', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await areaTexto(page).fill(TEXTO_PRUEBA);
    await configurarSimulador(page, { retener: 'todo' });
    await analizar(page).click();
    await expect(h1(page, 'Procesando')).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar análisis' }).click();
    await expect(page.getByRole('button', { name: 'Cancelando…' })).toBeDisabled();
    await expect(h1(page, 'Entrada')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('[data-prueba="analisis-cancelado"]')).toHaveText('Análisis cancelado. El texto sigue en la pantalla de entrada.');
    await expect(areaTexto(page)).toHaveValue(TEXTO_PRUEBA);
    expect((await leerSimulador(page)).terminados).toContain('detect');
    // Se puede analizar de nuevo con un worker nuevo.
    await configurarSimulador(page, { retener: null });
    await analizar(page).click();
    await expect(h1(page, 'Revisión')).toBeVisible();
    expect((await leerSimulador(page)).creados.filter((n) => n === 'detect')).toHaveLength(2);
  });

  test('T-IU-05 si `detect` confirma la cancelación, vuelve a Entrada sin esperar los 2 s', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await areaTexto(page).fill(TEXTO_PRUEBA);
    await configurarSimulador(page, { retener: 'resultado' });
    await analizar(page).click();
    await expect(h1(page, 'Procesando')).toBeVisible();
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Cancelar análisis' }).click();
    await expect(h1(page, 'Entrada')).toBeVisible({ timeout: 1500 });
    expect(Date.now() - t0).toBeLessThan(1800);
    await expect(page.locator('[data-prueba="analisis-cancelado"]')).toBeVisible();
    await expect(areaTexto(page)).toHaveValue(TEXTO_PRUEBA);
  });

  for (const [codigo, mensaje] of [
    ['TIEMPO_AGOTADO', 'La operación tardó demasiado y se detuvo. Intente con un documento más corto o divídalo.'],
    ['MEMORIA', 'El navegador se quedó sin memoria para esta operación. Cierre otras pestañas o divida el documento.'],
    ['ERROR_INTERNO', 'Ocurrió un error interno. Intente de nuevo; si se repite, recargue la página.'],
  ] as const) {
    test(`T-IU-05 un error ${codigo} de \`detect\` vuelve a Entrada con su mensaje de 8.5.2 y conserva el texto`, async ({ page }) => {
      await instalarSimulador(page);
      await irAEntrada(page);
      await areaTexto(page).fill(TEXTO_PRUEBA);
      await configurarSimulador(page, { errorDetect: codigo });
      await analizar(page).click();
      await expect(h1(page, 'Entrada')).toBeVisible();
      await expect(alertaEntrada(page)).toHaveText(mensaje);
      await expect(alertaEntrada(page)).toHaveAttribute('role', 'alert');
      await expect(areaTexto(page)).toHaveValue(TEXTO_PRUEBA);
      expect((await leerSimulador(page)).terminados).toContain('detect');
    });
  }

  test('T-IU-05 INV-G09 «Bloquear» durante Procesando termina el worker `detect` y vuelve a Inicio', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await areaTexto(page).fill(TEXTO_PRUEBA);
    await configurarSimulador(page, { retener: 'todo' });
    await analizar(page).click();
    await expect(h1(page, 'Procesando')).toBeVisible();
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(h1(page, 'Inicio')).toBeVisible();
    expect((await leerSimulador(page)).terminados).toContain('detect');
    await expect(page.locator('body')).not.toContainText('Ana Ficticia Rojas');
  });

  test('T-IU-05 el análisis real (sin simulador) termina en segundos y pasa a Revisión', async ({ page }) => {
    await irAEntrada(page);
    await areaTexto(page).fill(TEXTO_PRUEBA);
    await analizar(page).click();
    await expect(h1(page, 'Revisión')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Procesando' })).toHaveCount(0);
  });
});
