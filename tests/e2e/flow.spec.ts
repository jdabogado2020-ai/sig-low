import { test, expect, type Page } from '@playwright/test';

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
