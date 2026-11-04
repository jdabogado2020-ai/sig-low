import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  configurarSimulador, DOCUMENTO_DE_TRES_PARTES, instalarSimulador, leerSimulador, soltarRetenidos,
} from './ayudas-entrada';
import {
  aDescargar, abrirAvanzadas, abrirMasFormatos, aDetalle, anonimizar, confirmar, crearCaso, editarLista, esperarBusqueda, etiquetas, h1,
  irACargar, pegarLista, pegarTexto, TITULO, vistaPrevia,
} from './lib/flujo';
import { testMedicion } from './lib/medicion';

// Casos de PC-1 (10.0): T-IU-05 a T-IU-09 (estados, avisos, sin aprobación masiva, créditos) y T-IU-11 a T-IU-14
// (soltar fuera, impresión y guardado, bloqueo tras suspender el equipo y bloqueo entre pestañas).
// Datos ficticios evidentes (10.1.5). Los casos de otras pantallas los agregan PC-2 a PC-7 en este mismo archivo.
// F23 (v1.1, D-23 y D-24): el flujo es Cargar documento → Analizando → Vista previa → Descargar. Ya no se crea un caso para empezar
// (al anonimizar se abre uno efímero que no se ve); la lista de nombres, el detector adicional y la llave están en «Opciones
// avanzadas»; la revisión de la v1.0 es «Revisar dato por dato» y la descarga pide una sola confirmación. Ayudas en lib/flujo.ts.

/** Lista de nombres: escribe las líneas y pide la vista previa de la lista (sin agregarlas). */
async function vistaPreviaDeLista(page: Page, texto: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Texto de la lista' }).fill(texto);
  await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
}

const PROMESA =
  'Sus documentos no salen de su equipo. Sig-Low propone qué ocultar, le muestra el documento ya anonimizado y usted decide antes de descargarlo.';

test.describe('T-IU-05 estados globales y de Inicio', () => {
  test('T-IU-05 @humo Cargar documento vacío: M-106, opciones avanzadas plegadas, formulario sin valores por defecto y «Crear caso» deshabilitado', async ({ page }) => {
    await irACargar(page);
    await expect(page.locator('[data-prueba="promesa"]')).toHaveText(PROMESA);
    // D-23: la pantalla de entrada es Cargar; «Cargar archivo» es la pestaña por defecto y las opciones avanzadas están plegadas.
    await expect(page.getByRole('tab', { name: 'Cargar archivo' })).toHaveAttribute('aria-selected', 'true');
    expect(await page.locator('details[data-prueba="opciones-avanzadas"]').evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
    await expect(page.locator('[data-prueba="caso-abierto"]')).toHaveCount(0);
    await abrirAvanzadas(page);
    await expect(page.getByText('No hay casos guardados en este navegador.')).toBeVisible();
    await expect(page.getByRole('radio', { name: /^Guardar la llave en este equipo/ })).not.toBeChecked();
    await expect(page.getByRole('radio', { name: /^No guardar la llave/ })).not.toBeChecked();
    const crear = page.getByRole('button', { name: 'Crear caso' });
    await expect(crear).toBeDisabled();
    // Con la bóveda conectada (PD-4), «Guardar» está disponible y sin M-208; el caso sin IndexedDB (M-208) está en boveda.spec.ts.
    await expect(page.getByRole('radio', { name: /^Guardar la llave en este equipo/ })).toBeEnabled();
    await expect(page.locator('[data-prueba="guardar-no-disponible"]')).toHaveCount(0);
    await page.getByLabel('Código del caso').fill('---');
    await expect(page.getByText('El código admite de 1 a 40 caracteres: letras sin tilde, números, espacio, punto, guion, guion bajo y barra.')).toBeVisible();
    await page.getByRole('radio', { name: /^No guardar la llave/ }).check();
    await expect(crear).toBeDisabled();
    await page.getByLabel('Código del caso').fill('PRUEBA-001');
    await expect(page.getByLabel('Código del caso')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(crear).toBeEnabled();
  });

  test('T-IU-05 @humo «No guardar la llave» abre el caso en memoria y se queda en Cargar con M-14, el chip y los pasos; la lista de nombres es una pantalla aparte', async ({ page }) => {
    await irACargar(page);
    await crearCaso(page, { codigo: 'PRUEBA-001' });
    await expect(page.locator('[data-prueba="caso-abierto"]')).toContainText('PRUEBA-001');
    await expect(page.locator('[data-prueba="chip-asunto"]')).toContainText('Caso PRUEBA-001');
    await expect(page.locator('[data-prueba="chip-asunto"]')).toContainText('Llave solo en memoria');
    await expect(page.getByText('La llave se perderá al cerrar o bloquear.')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Pasos' }).locator('[aria-current="step"]')).toContainText('Cargar');
    await expect(page.getByRole('navigation', { name: 'Pasos' }).getByRole('button')).toHaveCount(3);
    // Cambio de pantalla: foco al h1 nuevo y anuncio «Pantalla: {nombre}» (8.2.1, 8.6.3).
    await editarLista(page);
    await expect(h1(page, TITULO.lista)).toBeFocused();
    await expect(page.locator('[data-prueba="anuncio-pantalla"]')).toHaveText('Pantalla: Nombres que siempre deben ocultarse');
    await expect(page.getByText('Todavía no hay nombres en la lista de nombres que siempre deben ocultarse.')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Pasos' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(h1(page, TITULO.cargar)).toBeFocused();
    await expect(page.locator('[data-prueba="anuncio-pantalla"]')).toHaveText('Pantalla: Cargar documento');
    await expect(page.getByRole('navigation', { name: 'Pasos' }).locator('[aria-current="step"]')).toContainText('Cargar');
    // «Cerrar el caso» vuelve a Cargar sin aviso de bloqueo.
    await page.getByRole('button', { name: 'Opciones del caso' }).click();
    await page.getByRole('button', { name: 'Cerrar el caso' }).click();
    await expect(h1(page, TITULO.cargar)).toBeVisible();
    await expect(page.locator('[data-prueba="caso-abierto"]')).toHaveCount(0);
    await expect(page.locator('[data-prueba="aviso-bloqueo"]')).toHaveCount(0);
  });

  test('T-IU-05 «Bloquear» vacía el estado y muestra M-102 y M-103 (INV-G09)', async ({ page }) => {
    await irACargar(page);
    await crearCaso(page);
    await editarLista(page);
    await vistaPreviaDeLista(page, 'Ana Ficticia Rojas; demandante');
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await expect(page.getByRole('rowheader', { name: 'Ana Ficticia Rojas' })).toBeVisible();
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(h1(page, TITULO.cargar)).toBeVisible();
    await expect(page.locator('[data-prueba="aviso-bloqueo"]')).toContainText('Sig-Low se bloqueó y borró de la memoria el documento y la revisión en curso.');
    await expect(page.locator('[data-prueba="aviso-bloqueo"]')).toContainText('La llave de ese caso no estaba guardada y se perdió.');
    await expect(page.locator('body')).not.toContainText('Ana Ficticia Rojas');
    await expect(page.locator('[data-prueba="chip-asunto"]')).toHaveCount(0);
  });

  test('T-IU-05 M-39: el indicador «Lista para funcionar sin conexión» aparece cuando el service worker dejó la caché de la app', async ({ page }) => {
    await irACargar(page);
    // El service worker de PD-1 deja la caché `siglow-app-<sha>` al instalar el precache (3.2).
    await expect(page.locator('[data-prueba="sin-conexion"]')).toHaveText('Lista para funcionar sin conexión');
    // Sin esa caché ya no se promete el uso sin conexión (el SW sirve lo que falta verificado, sin recrearla).
    await page.evaluate(async () => { for (const k of await caches.keys()) await caches.delete(k); });
    await page.reload();
    await expect(h1(page, TITULO.cargar)).toBeVisible();
    await expect(page.locator('[data-prueba="sin-conexion"]')).toHaveText('');
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
  test('T-IU-07 el aviso inicial se expande en cada carga, «Más información» despliega M-03 a M-07 y «Entendido» lo pliega hasta recargar', async ({ page }) => {
    await irACargar(page);
    const aviso = page.locator('[data-prueba="aviso-inicial"]');
    await expect(aviso.getByRole('heading', { name: 'Antes de empezar' })).toBeVisible();
    // D-23: tres recomendaciones breves; los avisos completos (M-03 a M-07) están en «Más información».
    await expect(aviso.getByRole('listitem')).toHaveCount(3);
    await expect(aviso).toContainText('Use una ventana normal del navegador, sin extensiones ni sesión iniciada.');
    await expect(aviso).toContainText('No comparta ni grabe la pantalla mientras tenga un documento abierto.');
    await expect(aviso).toContainText('No traduzca la página ni use los asistentes de IA del navegador.');
    await expect(page.locator('[data-prueba="aviso-completo"]')).toHaveCount(0);
    await aviso.getByRole('button', { name: 'Más información' }).click();
    const completo = page.locator('[data-prueba="aviso-completo"]');
    await expect(completo).toContainText('Trabaje en una ventana normal del navegador');
    await expect(completo).toContainText('No use los asistentes de IA integrados en el navegador mientras tenga un documento abierto en Sig-Low');
    await expect(completo).toContainText('No comparta ni grabe la pantalla mientras haya un documento abierto.');
    await expect(completo).toContainText('Use un perfil del navegador solo para Sig-Low: sin extensiones, sin sesión iniciada y sin sincronización.');
    await expect(completo).toContainText('No traduzca esta página con el navegador ni use su corrector en línea.');
    await aviso.getByRole('button', { name: 'Menos información' }).click();
    await expect(completo).toHaveCount(0);
    await aviso.getByRole('button', { name: 'Entendido' }).click();
    await expect(aviso).not.toContainText('Use una ventana normal');
    await page.reload();
    await expect(h1(page, TITULO.cargar)).toBeVisible();
    await expect(page.locator('[data-prueba="aviso-inicial"]')).toContainText('Use una ventana normal del navegador');
  });

  test('T-IU-07 la guía de 3 pasos se muestra la primera vez, «Cerrar la guía» la quita y vuelve al recargar (solo en memoria)', async ({ page }) => {
    await irACargar(page);
    const guia = page.locator('[data-prueba="guia"]');
    await expect(guia.getByRole('heading', { name: 'Cómo funciona' })).toBeVisible();
    await expect(guia.getByRole('listitem')).toHaveCount(3);
    await guia.getByRole('button', { name: 'Cerrar la guía' }).click();
    await expect(guia).toHaveCount(0);
    await page.reload();
    await expect(h1(page, TITULO.cargar)).toBeVisible();
    await expect(page.locator('[data-prueba="guia"]')).toBeVisible();
  });
});

test.describe('T-IU-08 sin aprobación masiva', () => {
  const TODO = /aceptar todo|aceptar todas|ocultar todo|ocultar todas las (detecciones|menciones|etiquetas)|aplicar (toda )?la propuesta/i;

  // D-24 (F3) cambió esta prueba: la vista previa llega con todo aplicado (`aplicar_propuesta`, la única excepción de INV-R06). Lo que
  // sigue valiendo: ninguna pantalla ofrece un botón para aceptar todo el documento; la propuesta la aplica Sig-Low sola, una vez, y
  // no pisa lo que el abogado decidió. La revisión dato por dato (aceptar por entidad) está en «Revisión I».
  test('T-IU-08 INV-R06 (D-24): Cargar, la lista y la vista previa no ofrecen aceptar todo; la propuesta se aplica sola y una sola vez, y no pisa lo que el abogado decidió', async ({ page }) => {
    await irACargar(page);
    await expect(page.getByRole('button', { name: TODO })).toHaveCount(0);
    await editarLista(page);
    await expect(page.getByRole('button', { name: TODO })).toHaveCount(0);
    await pegarLista(page, 'Ana Ficticia Rojas; demandante');

    await pegarTexto(page, 'Ana Ficticia Rojas, C.C. 1.000.000.017, vive en la Calle 00 n.º 00-00 de Ciudad Ejemplo. Correo: ana.ficticia@ejemplo.test.');
    await anonimizar(page);
    await esperarBusqueda(page);
    // La propuesta se aplicó sola: hay etiquetas, ningún dato a la vista y ningún botón para aceptar todo.
    await expect(page.getByRole('button', { name: TODO })).toHaveCount(0);
    expect(await etiquetas(page).count()).toBeGreaterThan(1);
    await expect(vistaPrevia(page).locator('button.revelado')).toHaveCount(0);
    await expect(vistaPrevia(page)).not.toContainText('Ana Ficticia');

    // El abogado decide: muestra el dato de una etiqueta. Ni al ir a Descargar y volver ni al pasar por «Revisar dato por dato» y
    // volver la propuesta vuelve a ocultarlo (se aplica una sola vez).
    const antes = await etiquetas(page).count();
    const det = await etiquetas(page).first().getAttribute('data-det');
    await etiquetas(page).first().click();
    await page.getByRole('button', { name: 'Mostrar el dato original aquí' }).click();
    await expect(vistaPrevia(page).locator(`button.revelado[data-det="${det}"]`)).toHaveCount(1);
    expect(await etiquetas(page).count()).toBe(antes - 1);
    await aDescargar(page);
    await page.getByRole('button', { name: 'Volver a la vista previa' }).click();
    await expect(h1(page, TITULO.vista)).toBeVisible();
    await expect(vistaPrevia(page).locator(`button.revelado[data-det="${det}"]`)).toHaveCount(1);
    expect(await etiquetas(page).count()).toBe(antes - 1);
    await aDetalle(page);
    // La revisión dato por dato sí ofrece «ocultar todas las menciones» de UNA persona u organización, pero nada sobre todo el documento.
    await expect(page.getByRole('button', { name: /aceptar todo|aceptar todas|ocultar todo|ocultar todas las (detecciones|menciones) del documento|aplicar (toda )?la propuesta/i })).toHaveCount(0);
    await page.getByRole('button', { name: 'Vista previa', exact: true }).click();
    await expect(h1(page, TITULO.vista)).toBeVisible();
    await expect(vistaPrevia(page).locator(`button.revelado[data-det="${det}"]`)).toHaveCount(1);
    expect(await etiquetas(page).count()).toBe(antes - 1);
  });
});

test.describe('T-IU-09 créditos y licencias', () => {
  test('T-IU-09 «Acerca de» → «Créditos y licencias» trae los avisos de licencia y no tiene casilla de aceptación', async ({ page }) => {
    await irACargar(page);
    await page.getByRole('button', { name: 'Acerca de' }).click();
    const acerca = page.getByRole('dialog', { name: 'Acerca de Sig-Low' });
    await expect(acerca).toBeVisible();
    await expect(acerca).toContainText(PROMESA);
    await expect(acerca).toContainText('Reemplazar nombres por etiquetas es seudonimizar');
    await acerca.getByRole('button', { name: 'Créditos y licencias' }).click();
    const creditos = page.getByRole('dialog', { name: 'Créditos y licencias' });
    await expect(creditos).toBeVisible();
    for (const texto of ['Preact', 'MIT', 'Apache-2.0', 'CC BY-SA 4.0', 'DANE', 'GLiNER-X', 'mT5', '@piighost/ner-web', 'pdf.js', 'fflate', 'onnxruntime-web']) {
      await expect(creditos).toContainText(texto);
    }
    await expect(creditos.locator('input[type="checkbox"], input[type="radio"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(creditos).toBeHidden();
    // Desde Cargar documento (Opciones avanzadas, tarjeta del detector), el enlace «Ver créditos y licencias» abre el mismo diálogo.
    await abrirAvanzadas(page);
    await page.getByRole('button', { name: 'Ver créditos y licencias' }).click();
    await expect(page.getByRole('dialog', { name: 'Créditos y licencias' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Ver créditos y licencias' })).toBeFocused();
  });
});

test.describe('Lista del caso (8.2.3)', () => {
  test('T-IU-05 agregar, editar y quitar entidades; la organización lleva clase y nunca rol (INV-L01)', async ({ page }) => {
    await irACargar(page);
    await editarLista(page);
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
    await irACargar(page);
    await editarLista(page);
    await vistaPreviaDeLista(page, 'Ana Ficticia Rojas; demandante\nFerretería Ejemplo S.A.S.; demandada\nPersona Sin Rol; xyz\n; testigo');
    const vista = page.locator('[data-prueba="vista-previa-lista"]');
    await expect(vista).toContainText('Línea 3: no se reconoce el rol o la clase.');
    await expect(vista).toContainText('Línea 4: falta el nombre antes del punto y coma.');
    await expect(vista).toContainText('Línea 2: se tomó como organización (Empresa) por el sufijo o la sigla del nombre.');
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await expect(page.locator('[data-prueba="lineas-agregadas"]')).toHaveText('Se agregaron 2 nombres.');
    const tabla = page.locator('[data-prueba="tabla-entidades"]');
    await expect(tabla.getByRole('row')).toHaveCount(3);
    await expect(page.getByLabel('Clase: Ferretería Ejemplo S.A.S.')).toHaveValue('EMPRESA');
  });

  test('T-IU-05 vista previa de variantes: interruptor «Buscar esta variante», variante manual y M-44 compartida', async ({ page }) => {
    await irACargar(page);
    await editarLista(page);
    await vistaPreviaDeLista(page, 'Ana Ficticia Rojas; demandante\nBeatriz Prueba Rojas; demandado');
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await page.getByRole('button', { name: 'Vista previa: Ana Ficticia Rojas' }).click();
    const panel = page.locator('[data-prueba="panel-variantes"]');
    await expect(panel).toContainText('Ana Ficticia Rojas');
    await expect(panel.locator('[data-prueba="variante-compartida"]').first()).toHaveText(
      'Esta variante coincide con otra persona u organización de la lista. Se buscará con confianza baja; revise cada vez que aparezca.',
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

  test('T-IU-11 en Cargar documento y en la lista de nombres, dragover y drop quedan prevenidos sin cambiar la URL ni el historial', async ({ page }) => {
    await irACargar(page);
    const href = page.url();
    const hist = await page.evaluate(() => history.length);
    let r = await soltar(page);
    expect(r).toMatchObject({ over: true, drop: true, efecto: 'none', href });
    expect(r.historial).toBe(hist);
    await editarLista(page);
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
    await irACargar(page);
    await editarLista(page);
    await vistaPreviaDeLista(page, 'Ana Ficticia Rojas; demandante');
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
    await expect(page.locator('[data-prueba="aviso-global"]')).toContainText('Sig-Low no guarda la página. Use «Guardar la llave para devolver los datos reales» o los botones de descarga.');
    // Los manejadores de la página corren antes que el de la prueba (captura vs. burbuja): el evento ya llegó prevenido.
    const prevenidos = await page.evaluate(() => (globalThis as unknown as { __cs: boolean[] }).__cs);
    expect(prevenidos).toEqual([true]);
  });
});

/** Abre un caso «No guardar» con reloj simulado y lo deja en la pantalla de la lista de nombres. */
async function conReloj(page: Page, inicio: string, codigo: string): Promise<void> {
  await page.clock.install({ time: new Date(inicio) });
  await irACargar(page);
  await crearCaso(page, { codigo });
  await editarLista(page);
}

test.describe('T-IU-13 bloqueo-suspension', () => {
  test('T-IU-13 INV-G09: al reanudar tras 16 min el bloqueo es inmediato, sin aviso y con el estado vacío', async ({ page }) => {
    await conReloj(page, '2026-10-30T10:00:00', 'PRUEBA-013');
    await vistaPreviaDeLista(page, 'Ana Ficticia Rojas; demandante');
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await expect(page.getByRole('rowheader', { name: 'Ana Ficticia Rojas' })).toBeVisible();
    await page.clock.setSystemTime(new Date('2026-10-30T10:16:00'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(h1(page, TITULO.cargar)).toBeVisible();
    await expect(page.locator('[data-prueba="aviso-bloqueo"]')).toContainText('Sig-Low se bloqueó');
    await expect(page.locator('[data-prueba="aviso-bloqueo"]')).toContainText('La llave de ese caso no estaba guardada y se perdió.');
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
    await expect(h1(page, TITULO.lista)).toBeVisible();
  });

  test('T-IU-13 con 15 min exactos o más bloquea en el mismo manejador, antes de pintar el aviso', async ({ page }) => {
    await conReloj(page, '2026-10-30T10:00:00', 'PRUEBA-013');
    await page.clock.setSystemTime(new Date('2026-10-30T10:15:00'));
    await page.evaluate(() => dispatchEvent(new Event('focus')));
    await expect(h1(page, TITULO.cargar)).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });
});

test.describe('T-IU-14 bloqueo-pestanas', () => {
  test('T-IU-14 INV-G09: «Bloquear» en una pestaña bloquea la otra en ≤ 1 s', async ({ context, baseURL }) => {
    const a = await context.newPage();
    const b = await context.newPage();
    for (const [p, codigo] of [[a, 'PRUEBA-14A'], [b, 'PRUEBA-14B']] as const) {
      await irACargar(p, baseURL ?? '/');
      await crearCaso(p, { codigo });
    }
    await a.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(h1(a, 'Cargar documento')).toBeVisible();
    await expect(h1(b, 'Cargar documento')).toBeVisible({ timeout: 1000 });
    await expect(b.locator('[data-prueba="aviso-bloqueo"]')).toContainText('Sig-Low se bloqueó');
    await expect(b.locator('[data-prueba="chip-asunto"]')).toHaveCount(0);
  });

  test('T-IU-14 INV-G09: la actividad en una pestaña impide el bloqueo por inactividad de la otra', async ({ context, baseURL }) => {
    const a = await context.newPage();
    const b = await context.newPage();
    for (const [p, codigo] of [[a, 'PRUEBA-14A'], [b, 'PRUEBA-14B']] as const) {
      await p.clock.install({ time: new Date('2026-10-30T10:00:00') });
      await irACargar(p, baseURL ?? '/');
      await crearCaso(p, { codigo });
    }
    // La pestaña A trabaja a los 10 min y lo difunde.
    await a.clock.setSystemTime(new Date('2026-10-30T10:10:00'));
    await a.keyboard.press('a');
    await b.waitForTimeout(300);
    // A los 16 min de su reloj, B sigue sin bloquearse: la última actividad fue a los 10 min.
    await b.clock.setSystemTime(new Date('2026-10-30T10:16:00'));
    await b.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(b.locator('[data-prueba="caso-abierto"]')).toBeVisible();
    await expect(b.getByRole('alertdialog')).toHaveCount(0);
    // Pasados 15 min desde la actividad de A (10:25), B sí se bloquea.
    await b.clock.setSystemTime(new Date('2026-10-30T10:25:30'));
    await b.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(b.locator('[data-prueba="aviso-bloqueo"]')).toBeVisible();
    await expect(b.locator('[data-prueba="caso-abierto"]')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// PC-2 · Entrada y Procesando
// ---------------------------------------------------------------------------------------------------------------------------

const TEXTO_PRUEBA = 'Ana Ficticia Rojas, C.C. 1.000.000.017, vive en la Calle 00 n.º 00-00 de Ciudad Ejemplo. Correo: ana.ficticia@ejemplo.test.';

/** D-23: la «Entrada» de la v1.0 es ahora la propia pantalla Cargar documento (sin crear un caso antes). */
async function irAEntrada(page: Page): Promise<void> {
  await irACargar(page);
}
const areaTexto = (page: Page) => page.getByRole('textbox', { name: 'Texto del documento' });
const analizar = (page: Page) => page.getByRole('button', { name: 'Anonimizar', exact: true });
const alertaEntrada = (page: Page) => page.locator('[data-prueba="error-entrada"]');

async function cargarArchivo(page: Page, nombre: string, contenido: Buffer | string, mimeType = 'application/octet-stream'): Promise<void> {
  await page.getByRole('tab', { name: 'Cargar archivo' }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: nombre, mimeType, buffer: typeof contenido === 'string' ? Buffer.from(contenido, 'utf8') : contenido });
}
const ZIP_MINIMO = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0]);

test.describe('T-IU-05 Entrada: pegar, cargar y estados', () => {
  test('T-IU-05 @humo pegar → Analizando → Vista previa: reglas y lista, con el detector adicional en plan B (no descargado)', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await expect(page.getByRole('navigation', { name: 'Pasos' }).locator('[aria-current="step"]')).toContainText('Cargar');
    await pegarTexto(page, TEXTO_PRUEBA);
    await configurarSimulador(page, { retener: 'resultado' });
    await analizar(page).click();
    await expect(h1(page, 'Analizando')).toBeFocused();
    await expect(page.getByRole('heading', { level: 2, name: 'Analizando el documento en su equipo' })).toBeVisible();
    await configurarSimulador(page, { retener: null });
    await soltarRetenidos(page);
    await expect(h1(page, TITULO.vista)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Pasos' }).locator('[aria-current="step"]')).toContainText('Vista previa');
    const sim = await leerSimulador(page);
    expect(sim.creados).toContain('detect');
    expect(sim.enviados.find((e) => e.kind === 'detectar')?.incluidas).toEqual([true]);
    expect(await page.title()).toBe('Sig-Low');
  });

  test('T-IU-05 Cargar vacío: «Anonimizar» deshabilitado con su ayuda, detector sin descargar con M-51 y «Editar los nombres» conserva el texto', async ({ page }) => {
    await irAEntrada(page);
    await expect(analizar(page)).toBeDisabled();
    await expect(page.getByText('Pegue texto o cargue un archivo con texto para poder anonimizar.')).toBeVisible();
    await page.getByRole('tab', { name: 'Pegar texto' }).click();
    await expect(page.getByText('Pegue aquí el texto del documento. Se analiza en su equipo.')).toBeVisible();
    await abrirAvanzadas(page);
    await expect(page.getByRole('checkbox', { name: 'Usar el detector de nombres adicional en este documento' })).toBeDisabled();
    await expect(page.getByText('El análisis usará reglas y la lista de nombres que siempre deben ocultarse: el detector de nombres adicional no está descargado.')).toBeVisible();
    await areaTexto(page).fill('   \n  ');
    await expect(analizar(page)).toBeDisabled();
    await areaTexto(page).fill(TEXTO_PRUEBA);
    await expect(analizar(page)).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Editar los nombres (0 en la lista)' })).toBeVisible();
    await editarLista(page);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(h1(page, TITULO.cargar)).toBeVisible();
    await expect(areaTexto(page)).toHaveValue(TEXTO_PRUEBA);
  });

  test('T-IU-05 el contador de caracteres se actualiza con una demora de 300 ms', async ({ page }) => {
    await irAEntrada(page);
    await page.getByRole('tab', { name: 'Pegar texto' }).click();
    const contador = page.locator('[data-prueba="contador-caracteres"]');
    await expect(contador).toHaveText('0 caracteres');
    await areaTexto(page).fill('Texto de Prueba');
    await expect(contador).toHaveText('0 caracteres');
    await expect(contador).toHaveText('15 caracteres');
  });

  test('T-IU-05 F-08 los campos de Entrada llevan los atributos de 8.7 y ids neutros; el input de archivo está oculto', async ({ page }) => {
    await irAEntrada(page);
    await page.getByRole('tab', { name: 'Pegar texto' }).click();
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

  test('T-IU-05 INV-D05 INV-G11 un .txt se lee en el worker `io` y no deja el nombre en ninguna parte (V-37, F-08)', async ({ page }) => {
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
    await expect(h1(page, TITULO.vista)).toBeVisible();
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
    // Partes: plegadas bajo «Elegir qué partes del documento se anonimizan»; etiqueta neutra y número de caracteres; todas marcadas.
    await expect(page.locator('details[data-prueba="partes"] summary')).toHaveText('Elegir qué partes del documento se anonimizan');
    await page.locator('details[data-prueba="partes"] summary').click();
    await expect(page.getByRole('group', { name: 'Partes del documento' })).toBeVisible();
    for (const [etiqueta, n] of [['Cuerpo del documento', 69], ['Encabezado 1', 20], ['Comentario 1', 27]] as const) {
      await expect(page.getByRole('checkbox', { name: `${etiqueta} · ${n} caracteres` })).toBeChecked();
    }
    await expect(page.getByText('Estas son las partes del documento. Desmarque lo que no quiera incluir: lo desmarcado no se analiza ni aparece en el documento anonimizado.')).toBeVisible();
    // Metadatos: solo categorías (M-401 y M-406), sin ningún valor.
    await expect(page.locator('[data-prueba="aviso-metadatos"]')).toHaveText(
      'El archivo original contiene información adicional que Sig-Low no copia al documento anonimizado: Propiedades del documento (autor, título, fechas); Autores y fechas de revisiones y comentarios. Si envía o comparte el archivo original, esa información va con él.',
    );
    // Advertencias: una por código (M-50 y M-307).
    const avisos = page.locator('[data-prueba="avisos-lectura"] li');
    await expect(avisos).toHaveCount(2);
    await expect(avisos.nth(0)).toContainText('El archivo conserva texto eliminado con control de cambios (2 fragmentos).');
    await expect(avisos.nth(1)).toContainText('El documento tiene una marca de agua o texto artístico (1).');
    // Lo desmarcado no se analiza (S-09): el worker `detect` recibe `included: false` en esa parte.
    await page.getByRole('checkbox', { name: 'Comentario 1 · 27 caracteres' }).uncheck();
    await analizar(page).click();
    await expect(h1(page, TITULO.vista)).toBeVisible();
    const enviado = (await leerSimulador(page)).enviados.find((e) => e.kind === 'detectar');
    expect(enviado?.incluidas).toEqual([true, true, false]);
  });

  test('T-IU-05 si todas las partes están desmarcadas no se puede analizar', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await configurarSimulador(page, { io: 'documento', docIo: DOCUMENTO_DE_TRES_PARTES });
    await cargarArchivo(page, 'Contrato de Prueba.docx', ZIP_MINIMO);
    await expect(analizar(page)).toBeEnabled();
    await page.locator('details[data-prueba="partes"] summary').click();
    for (const n of ['Cuerpo del documento · 69', 'Encabezado 1 · 20', 'Comentario 1 · 27']) {
      await page.getByRole('checkbox', { name: `${n} caracteres` }).uncheck();
    }
    await expect(analizar(page)).toBeDisabled();
  });

  test('T-IU-05 INV-G09 «Bloquear» borra el texto pegado de la pantalla y de la memoria', async ({ page }) => {
    await irAEntrada(page);
    // «Bloquear» solo aparece con un caso abierto (el efímero se abre al anonimizar).
    await crearCaso(page, { codigo: 'PRUEBA-002' });
    await pegarTexto(page, TEXTO_PRUEBA);
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(h1(page, TITULO.cargar)).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Ana Ficticia Rojas');
    await crearCaso(page, { codigo: 'PRUEBA-003' });
    await page.getByRole('tab', { name: 'Pegar texto' }).click();
    await expect(areaTexto(page)).toHaveValue('');
  });
});

test.describe('T-IU-05 Procesando: progreso por etapa, cancelar y errores', () => {
  test('T-IU-05 Analizando muestra las etapas con su estado, una barra por etapa y «Cancelar análisis»', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await pegarTexto(page, TEXTO_PRUEBA);
    await configurarSimulador(page, { retener: 'resultado' });
    await analizar(page).click();
    await expect(h1(page, 'Analizando')).toBeVisible();
    const etapas = page.locator('[data-prueba="etapas"]');
    await expect(etapas.locator('li')).toHaveCount(7);
    await expect(etapas.locator('[data-prueba="etapa-lectura"]')).toContainText('Lectura del documento · Terminada');
    await expect(etapas.locator('[data-prueba="etapa-reglas"]')).toContainText('Reglas de formatos colombianos');
    await expect(etapas.locator('[data-prueba="etapa-lista"]')).toContainText('Nombres que siempre deben ocultarse');
    await expect(etapas.locator('[data-prueba="etapa-modelo"]')).toContainText('Detector de nombres adicional · Omitida');
    // Sin el modelo, sus dos etapas no cuentan; las demás tienen su <progress> con nombre.
    await expect(etapas.getByRole('progressbar', { name: 'Reglas de formatos colombianos' })).toBeVisible();
    await expect(etapas.getByRole('progressbar', { name: 'Detector de nombres adicional' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancelar análisis' })).toBeVisible();
    await expect(page.locator('[data-prueba="anuncio-progreso"]')).toHaveAttribute('role', 'status');
    await configurarSimulador(page, { retener: null });
    await soltarRetenidos(page);
    await expect(h1(page, TITULO.vista)).toBeVisible();
  });

  test('T-IU-05 «Cancelar análisis» vuelve a Cargar con M-61, conserva el texto y termina el worker `detect` sin respuesta en 2 s', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await pegarTexto(page, TEXTO_PRUEBA);
    await configurarSimulador(page, { retener: 'todo' });
    await analizar(page).click();
    await expect(h1(page, 'Analizando')).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar análisis' }).click();
    await expect(page.getByRole('button', { name: 'Cancelando…' })).toBeDisabled();
    await expect(h1(page, TITULO.cargar)).toBeVisible({ timeout: 4000 });
    await expect(page.locator('[data-prueba="analisis-cancelado"]')).toHaveText('Análisis cancelado. El texto sigue en la pantalla «Cargar documento».');
    await expect(areaTexto(page)).toHaveValue(TEXTO_PRUEBA);
    expect((await leerSimulador(page)).terminados).toContain('detect');
    // Se puede analizar de nuevo con un worker nuevo.
    await configurarSimulador(page, { retener: null });
    await analizar(page).click();
    await expect(h1(page, TITULO.vista)).toBeVisible();
    expect((await leerSimulador(page)).creados.filter((n) => n === 'detect')).toHaveLength(2);
  });

  test('T-IU-05 si `detect` confirma la cancelación, vuelve a Cargar sin esperar los 2 s', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await pegarTexto(page, TEXTO_PRUEBA);
    await configurarSimulador(page, { retener: 'resultado' });
    await analizar(page).click();
    await expect(h1(page, 'Analizando')).toBeVisible();
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Cancelar análisis' }).click();
    await expect(h1(page, TITULO.cargar)).toBeVisible({ timeout: 1500 });
    expect(Date.now() - t0).toBeLessThan(1800);
    await expect(page.locator('[data-prueba="analisis-cancelado"]')).toBeVisible();
    await expect(areaTexto(page)).toHaveValue(TEXTO_PRUEBA);
  });

  for (const [codigo, mensaje] of [
    ['TIEMPO_AGOTADO', 'La operación tardó demasiado y se detuvo. Intente con un documento más corto o divídalo.'],
    ['MEMORIA', 'El navegador se quedó sin memoria para esta operación. Cierre otras pestañas o divida el documento.'],
    ['ERROR_INTERNO', 'Ocurrió un error interno. Intente de nuevo; si se repite, recargue la página.'],
  ] as const) {
    test(`T-IU-05 un error ${codigo} de \`detect\` vuelve a Cargar con su mensaje de 8.5.2 y conserva el texto`, async ({ page }) => {
      await instalarSimulador(page);
      await irAEntrada(page);
      await pegarTexto(page, TEXTO_PRUEBA);
      await configurarSimulador(page, { errorDetect: codigo });
      await analizar(page).click();
      await expect(h1(page, TITULO.cargar)).toBeVisible();
      await expect(alertaEntrada(page)).toHaveText(mensaje);
      await expect(alertaEntrada(page)).toHaveAttribute('role', 'alert');
      await expect(areaTexto(page)).toHaveValue(TEXTO_PRUEBA);
      expect((await leerSimulador(page)).terminados).toContain('detect');
    });
  }

  test('T-IU-05 INV-G09 «Bloquear» durante Analizando termina el worker `detect` y vuelve a Cargar', async ({ page }) => {
    await instalarSimulador(page);
    await irAEntrada(page);
    await pegarTexto(page, TEXTO_PRUEBA);
    await configurarSimulador(page, { retener: 'todo' });
    await analizar(page).click();
    await expect(h1(page, 'Analizando')).toBeVisible();
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(h1(page, TITULO.cargar)).toBeVisible();
    expect((await leerSimulador(page)).terminados).toContain('detect');
    await expect(page.locator('body')).not.toContainText('Ana Ficticia Rojas');
  });

  test('T-IU-05 el análisis real (sin simulador) termina en segundos y pasa a la Vista previa', async ({ page }) => {
    await irAEntrada(page);
    await pegarTexto(page, TEXTO_PRUEBA);
    await analizar(page).click();
    await expect(h1(page, TITULO.vista)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Analizando' })).toHaveCount(0);
  });
});

// ===== PC-3 · Revisión I (8.2.6, 8.4, 8.6) =====
// Estas pruebas usan un `DetectionSet` fijo que sale del build de medición (`vite build --mode medicion`, ranura del gancho), nunca de
// `dist/`: lib/medicion.ts lo construye si está desactualizado y lo sirve con el mismo servidor de cabeceras en un puerto libre. Datos ficticios.

const TEXTO_REVISION = [
  'Señora Ana Ficticia Rojas, identificada con cédula de ciudadanía número 1.000.000.001, correo ana.ficticia@ejemplo.test, teléfono 3000000000.',
  'El demandado Pedro Ejemplo Prueba, con cédula 1.000.000.002, vive en la Calle 100 # 00-00 de Bogotá.',
  'La señora Ana Ficticia Rojas solicitó el reemplazo. Contacto: 3000000000.',
].join('\n');

type Gancho = {
  cargar(texto: string, modelo?: string): Promise<number>;
  revision(): number;
  estado(): { revision: number; estados: Record<string, number> };
  detalle(): Array<{ texto: string; source: string; precedence: number; confidence: string; status: string; type: string }>;
};
const gancho = (page: Page) => ({
  revision: () => page.evaluate(() => (globalThis as unknown as { __siglowRevisionPrueba: Gancho }).__siglowRevisionPrueba.revision()),
  estado: () => page.evaluate(() => (globalThis as unknown as { __siglowRevisionPrueba: Gancho }).__siglowRevisionPrueba.estado()),
  detalle: () => page.evaluate(() => (globalThis as unknown as { __siglowRevisionPrueba: Gancho }).__siglowRevisionPrueba.detalle()),
});

/**
 * Abre «Revisar dato por dato» con el gancho de medición (la revisión de la v1.0, SIN la propuesta aplicada: `cargar(texto, modelo)`
 * abre `detalle`; con `'revision'` abre la vista previa). La lista de nombres se escribe en su pantalla de «Opciones avanzadas».
 */
async function abrirRevision(page: Page, texto = TEXTO_REVISION, lista = 'Ana Ficticia Rojas; demandante\nPedro Ejemplo Prueba; demandado'): Promise<number> {
  await irACargar(page);
  if (lista !== '') {
    await editarLista(page);
    await pegarLista(page, lista);
  }
  await page.waitForFunction(() => '__siglowRevisionPrueba' in globalThis);
  const n = await page.evaluate((t) => (globalThis as unknown as { __siglowRevisionPrueba: Gancho }).__siglowRevisionPrueba.cargar(t, 'plan_b'), texto);
  await expect(h1(page, TITULO.detalle)).toBeVisible();
  return n;
}
const panelTexto = (page: Page) => page.getByRole('region', { name: 'Documento con datos encontrados' });

/** Selecciona texto del panel entre dos tramos (por fragmento y desplazamiento) y simula el fin del arrastre con el ratón. */
async function seleccionarEnPanel(page: Page, inicio: [string, number], fin: [string, number]): Promise<void> {
  await page.evaluate(([a, b]) => {
    const panel = document.querySelector('[data-prueba="panel-texto"]') as HTMLElement;
    const nodo = (frag: string): Text => {
      const run = [...panel.querySelectorAll('[data-o]')].find((r) => (r.textContent ?? '').includes(frag)) as HTMLElement;
      return run.firstChild as Text;
    };
    const na = nodo(a[0] as string);
    const nb = nodo(b[0] as string);
    const rango = document.createRange();
    rango.setStart(na, (na.textContent ?? '').indexOf(a[0] as string) + (a[1] as number));
    rango.setEnd(nb, (nb.textContent ?? '').indexOf(b[0] as string) + (b[1] as number));
    const sel = getSelection() as Selection;
    sel.removeAllRanges();
    sel.addRange(rango);
    panel.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, [inicio, fin] as const);
}

testMedicion.describe('Revisión I (PC-3)', () => {
  testMedicion.describe.configure({ timeout: 90_000 });

  testMedicion('T-IU-05 la Revisión muestra el texto con resaltados por tipo y M-70; sin detecciones muestra M-69 (INV-G03)', async ({ page }) => {
    const n = await abrirRevision(page);
    expect(n).toBe(9);
    const panel = panelTexto(page);
    await expect(panel.locator('[data-det]')).toHaveCount(9);
    await expect(page.locator('[data-prueba="numeracion-provisional"]')).toHaveText('Los números de las etiquetas pueden cambiar hasta que copie o descargue por primera vez.');
    // AJ-6: el tratamiento pegado delante («Señora») entra en el tramo de la persona.
    await expect(panel.getByRole('button', { name: 'Persona, por revisar, confianza alta: Señora Ana Ficticia Rojas' }).first()).toBeVisible();
    await expect(page.getByRole('treegrid', { name: 'Datos encontrados' })).toBeVisible();
    await expect(page.getByRole('row', { name: 'Persona, [DEMANDANTE_1], 2 menciones, 2 por revisar' })).toBeVisible();
    // Sin detecciones: M-69 y ningún resaltado.
    const sin = await page.evaluate(() => (globalThis as unknown as { __siglowRevisionPrueba: Gancho }).__siglowRevisionPrueba.cargar('Texto de prueba sin datos personales.', 'plan_b'));
    expect(sin).toBe(0);
    await expect(page.locator('[data-prueba="sin-detecciones"]')).toHaveText('No se encontraron datos para ocultar. Lea el texto completo: puede ocultar datos a mano.');
    await expect(panel.locator('[data-det]')).toHaveCount(0);
  });

  testMedicion('T-IU-05 INV-R08: ocultar, mostrar el dato, editar y restablecer con el teclado suben revision en 1 por acción y cambian el estado', async ({ page }) => {
    await abrirRevision(page);
    const panel = panelTexto(page);
    const marcas = panel.locator('[data-det]');
    expect(await gancho(page).revision()).toBe(0);
    await marcas.nth(0).focus();
    await page.keyboard.press('a');
    await expect(marcas.nth(0)).toHaveAccessibleName('Persona, ocultada con [DEMANDANTE_1], confianza alta: Señora Ana Ficticia Rojas');
    expect(await gancho(page).revision()).toBe(1);
    await marcas.nth(1).focus();
    await page.keyboard.press('r');
    await expect(marcas.nth(1)).toHaveAccessibleName(/^Cédula de ciudadanía, sin ocultar, confianza \w+: 1\.000\.000\.001$/);
    expect(await gancho(page).revision()).toBe(2);
    await page.keyboard.press('u');
    await expect(marcas.nth(1)).toHaveAccessibleName(/^Cédula de ciudadanía, por revisar, /);
    expect(await gancho(page).revision()).toBe(3);
    await page.keyboard.press('e');
    const editor = page.getByLabel('Texto del reemplazo');
    await expect(editor).toBeFocused();
    await editor.fill('REEMPLAZO FICTICIO');
    await page.keyboard.press('Enter');
    await expect(marcas.nth(1)).toHaveAccessibleName(/^Cédula de ciudadanía, editada como REEMPLAZO FICTICIO, /);
    await expect(marcas.nth(1)).toBeFocused();
    expect(await gancho(page).revision()).toBe(4);
    // Esc cancela una edición sin tocar el estado.
    await page.keyboard.press('e');
    await page.getByLabel('Texto del reemplazo').fill('OTRO');
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Texto del reemplazo')).toHaveCount(0);
    expect(await gancho(page).revision()).toBe(4);
    // Los botones de la fila de la cuadrícula.
    const entidad = page.getByRole('row', { name: /^Persona, \[DEMANDANTE_1\], 2 menciones, / });
    await entidad.focus();
    await page.keyboard.press('ArrowRight');
    await expect(entidad).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: 'Mostrar el dato original: mención 2 de Persona' }).click();
    expect(await gancho(page).revision()).toBe(5);
    await expect(marcas.nth(7)).toHaveAccessibleName(/^Persona, sin ocultar, /);
  });

  testMedicion('T-IU-05 INV-R06 INV-R08: «Ocultar todas las menciones» solo oculta las pendientes de esa entidad y anuncia M-74', async ({ page }) => {
    await abrirRevision(page);
    const antes = await gancho(page).estado();
    expect(antes.estados).toEqual({ pendiente: 9 });
    await page.getByRole('button', { name: 'Ocultar todas las menciones (2): Persona' }).first().click();
    const despues = await gancho(page).estado();
    expect(despues.revision).toBe(1);
    expect(despues.estados).toEqual({ aceptada: 2, pendiente: 7 });
    await expect(page.locator('[data-prueba="anuncio-revision"]')).toHaveText('Se ocultaron 2 menciones de [DEMANDANTE_1]. Quedan 7 por revisar.');
    await expect(page.getByRole('row', { name: 'Persona, [DEMANDANTE_1], 2 menciones, 0 por revisar' })).toBeVisible();
    // Rechazar todas las de otra entidad.
    await page.getByRole('button', { name: 'Mostrar el dato original en todas las menciones: Teléfono' }).click();
    expect((await gancho(page).estado()).estados).toEqual({ aceptada: 2, rechazada: 2, pendiente: 5 });
    expect(await gancho(page).revision()).toBe(2);
  });

  // D-24: la vista previa aplica la propuesta (única excepción de INV-R06, ver «sin aprobación masiva» arriba); la revisión dato por dato
  // sigue sin ofrecer una acción sobre todo el documento: «ocultar todas las menciones» es por persona u organización.
  testMedicion('T-IU-08 INV-R06: la revisión dato por dato no ofrece ocultar todo el documento; «ocultar todas las menciones de la entidad» sí, una por entidad', async ({ page }) => {
    await abrirRevision(page);
    await expect(page.getByRole('button', { name: /aceptar todo|aceptar todas|ocultar todo|ocultar todas las (detecciones|menciones) del documento|aceptar el documento|aplicar (toda )?la propuesta/i })).toHaveCount(0);
    const porEntidad = page.getByRole('button', { name: /^Ocultar todas las menciones \(\d+\): / });
    const filas = page.locator('[role="row"][aria-level="1"]');
    await expect(porEntidad).toHaveCount(await filas.count());
    // Ninguna acción cambia a la vez el estado de todas las detecciones: tres entidades aceptadas dejan el resto pendiente.
    for (let i = 0; i < 3; i++) await porEntidad.nth(i).click();
    const e = (await gancho(page).estado()).estados;
    expect(e['pendiente'] ?? 0).toBeGreaterThan(0);
  });

  testMedicion('T-IU-05 reemplazo manual: la selección abre «Agregar reemplazo» y crea una detección manual con precedence 1 (+1 revision)', async ({ page }) => {
    await abrirRevision(page);
    const r0 = await gancho(page).revision();
    await seleccionarEnPanel(page, ['solicitó el reemplazo', 12], ['solicitó el reemplazo', 21]);
    await page.getByRole('button', { name: 'Ocultar un texto' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Ocultar un texto' });
    await expect(dialogo.locator('[data-prueba="reemplazo-texto"]')).toHaveText('reemplazo');
    await dialogo.getByLabel('Tipo de dato del reemplazo').selectOption('LUGAR');
    await dialogo.getByRole('button', { name: 'Ocultar un texto' }).click();
    await expect(dialogo).toBeHidden();
    const d = (await gancho(page).detalle()).find((x) => x.source === 'manual');
    expect(d).toMatchObject({ texto: 'reemplazo', source: 'manual', precedence: 1, confidence: 'alta', status: 'aceptada', type: 'LUGAR' });
    expect(await gancho(page).revision()).toBe(r0 + 1);
    await expect(panelTexto(page).locator('[data-det]', { hasText: 'reemplazo' })).toHaveAccessibleName(/^Lugar, ocultada con \[[A-ZÁÉÍÓÚ_]+_\d+\], confianza alta: reemplazo$/);
  });

  testMedicion('T-IU-05 INV-R08: una selección que corta a medias otra detección da M-603 y no cambia revision', async ({ page }) => {
    await abrirRevision(page);
    const r0 = await gancho(page).revision();
    await seleccionarEnPanel(page, ['Ana Ficticia Rojas', 4], [', identificada con', 8]);
    await page.getByRole('button', { name: 'Ocultar un texto' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Ocultar un texto' });
    await dialogo.getByRole('button', { name: 'Ocultar un texto' }).click();
    await expect(dialogo.getByRole('alert')).toHaveText('La selección corta a medias otro dato encontrado. Amplíela para cubrirlo completo o ajústela para no tocarlo.');
    expect(await gancho(page).revision()).toBe(r0);
    await dialogo.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialogo).toBeHidden();
  });

  testMedicion('T-IU-05 «Descartar este documento» pide M-75, borra la revisión y vuelve a Cargar; Bloquear vacía la memoria (INV-G09)', async ({ page }) => {
    await abrirRevision(page);
    await page.getByRole('button', { name: 'Descartar este documento' }).click();
    const d = page.getByRole('dialog', { name: 'Descartar este documento' });
    await expect(d).toContainText('Se descartará este documento y su revisión. La llave del caso no cambia.');
    await d.getByRole('button', { name: 'Cancelar' }).click();
    await expect(h1(page, TITULO.detalle)).toBeVisible();
    await page.getByRole('button', { name: 'Descartar este documento' }).click();
    await page.getByRole('dialog', { name: 'Descartar este documento' }).getByRole('button', { name: 'Descartar este documento' }).click();
    await expect(h1(page, TITULO.cargar)).toBeVisible();
    expect(await gancho(page).revision()).toBe(-1);
    // Bloquear con una revisión abierta.
    await page.evaluate((t) => (globalThis as unknown as { __siglowRevisionPrueba: Gancho }).__siglowRevisionPrueba.cargar(t, 'plan_b'), TEXTO_REVISION);
    await expect(h1(page, TITULO.detalle)).toBeVisible();
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(h1(page, TITULO.cargar)).toBeVisible();
    expect(await gancho(page).revision()).toBe(-1);
    await expect(page.locator('body')).not.toContainText('Ana Ficticia Rojas');
    await expect(page.locator('body')).not.toContainText('Pedro Ejemplo');
  });

  testMedicion('T-IU-04 copia desde el original: escribe solo text/plain tomado de Part.text, sin insignias ni marcadores; «Ver documento anonimizado» no se copia (8.7)', async ({ page }) => {
    await abrirRevision(page);
    await seleccionarEnPanel(page, ['Señora', 0], [', identificada con cédula de ciudadanía número ', 20]);
    const r = await page.evaluate(() => {
      const panel = document.querySelector('[data-prueba="panel-texto"]') as HTMLElement;
      const dt = new DataTransfer();
      const ev = new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true });
      panel.dispatchEvent(ev);
      return { tipos: [...dt.types], texto: dt.getData('text/plain'), prevenido: ev.defaultPrevented };
    });
    expect(r.prevenido).toBe(true);
    expect(r.tipos).toEqual(['text/plain']);
    expect(r.texto).toBe(TEXTO_REVISION.slice(0, TEXTO_REVISION.indexOf(', identificada con cédula de ciudadanía número ') + 20));
    expect(r.texto).not.toMatch(/PER|\[/);
    await page.getByRole('button', { name: 'Ver documento anonimizado' }).click();
    await expect(page.locator('[data-prueba="aviso-salida"]')).toContainText('Esta vista no se puede copiar. Es solo para revisar cómo quedará el documento anonimizado.');
    await expect(panelTexto(page)).toHaveCount(0);
    const salida = page.getByRole('region', { name: 'Documento con las etiquetas como fichas' });
    await expect(salida.getByRole('img', { name: 'Etiqueta [DEMANDANTE_1]' }).first()).toBeVisible();
    const s = await page.evaluate(() => {
      const panel = document.querySelector('[data-prueba="panel-texto"]') as HTMLElement;
      const dt = new DataTransfer();
      const ev = new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true });
      panel.dispatchEvent(ev);
      const drag = new DragEvent('dragstart', { bubbles: true, cancelable: true });
      panel.dispatchEvent(drag);
      return { tipos: [...dt.types], prevenido: ev.defaultPrevented, drag: drag.defaultPrevented, sel: getComputedStyle(panel).userSelect };
    });
    expect(s).toEqual({ tipos: [], prevenido: true, drag: true, sel: 'none' });
    await expect(salida).not.toContainText('Ana Ficticia');
  });

  testMedicion('T-IU-05 virtualización (8.8): con más de 1.000 detecciones solo se montan unos pocos bloques y filas, y la navegación monta lo no montado', async ({ page }) => {
    const lineas = Array.from({ length: 560 }, (_, i) => `Línea ${i}: Pedro Ejemplo Prueba, cédula 1.000.${String(i).padStart(3, '0')}.${String((i * 7) % 1000).padStart(3, '0')}.`);
    const n = await abrirRevision(page, lineas.join('\n'));
    expect(n).toBeGreaterThan(1000);
    expect(await page.locator('.bloque-texto').count()).toBeLessThanOrEqual(5);
    expect(await panelTexto(page).locator('[data-det]').count()).toBeLessThan(250);
    expect(await page.getByRole('treegrid').getByRole('row').count()).toBeLessThan(40);
    await expect(page.getByRole('treegrid')).toHaveAttribute('aria-rowcount', /^\d+$/);
    // Una tecla sobre un resaltado actúa sobre el estado, no sobre el DOM; «Mayús+N» va al último pendiente aunque no esté montado.
    const primero = panelTexto(page).locator('[data-det]').first();
    await primero.focus();
    await page.keyboard.press('a');
    expect((await gancho(page).estado()).estados['aceptada']).toBe(1);
    await page.keyboard.press('Shift+N');
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('aria-label') ?? '')).toMatch(/por revisar/);
    await expect(panelTexto(page).locator('[data-det]').last()).toBeVisible();
    expect(await page.locator('.bloque-texto').count()).toBeLessThanOrEqual(5);
  });

  testMedicion('T-IU-05 etiqueta específica de TI: pasa de [DOCUMENTO_n] a [TI_n], restituye el rótulo y se deshace (M-177, M-178)', async ({ page }) => {
    await abrirRevision(page, 'El menor Juan Ejemplo Prueba, con T.I. 1.000.000.003, y su madre, con C.E. 1.000.000.004.', '');
    const panel = panelTexto(page);
    await expect(panel.locator('.res.edicion')).toHaveCount(2);
    const ti = panel.getByRole('button', { name: /^Tarjeta de identidad, por revisar/ });
    await ti.click();
    const ficha = page.getByRole('region', { name: 'Ficha del dato encontrado' });
    await expect(ficha.locator('[data-prueba="ficha-marcador"]')).toHaveText('[DOCUMENTO_1]');
    const r0 = await gancho(page).revision();
    await ficha.getByRole('button', { name: 'Usar etiqueta específica (TI)' }).click();
    await expect(ficha.locator('[data-prueba="ficha-marcador"]')).toHaveText('[TI_1]');
    await expect(panel.locator('.res.edicion')).toHaveCount(1);
    await expect(page.locator('[data-prueba="anuncio-revision"]')).toHaveText('Etiqueta específica aplicada: [TI_1].');
    expect(await gancho(page).revision()).toBe(r0 + 1);
    await ficha.getByRole('button', { name: 'Volver a la etiqueta general' }).click();
    await expect(ficha.locator('[data-prueba="ficha-marcador"]')).toHaveText('[DOCUMENTO_1]');
    await expect(panel.locator('.res.edicion')).toHaveCount(2);
    await expect(page.locator('[data-prueba="anuncio-revision"]')).toHaveText('Etiqueta general restablecida: [DOCUMENTO_1].');
  });

  testMedicion('T-IU-05 datos que llegan del detector adicional: insignia NUEVA, el foco y la selección no se mueven y se anuncia M-166', async ({ page }) => {
    const texto = 'La señora Marta Ficticia Gómez, con cédula 1.000.000.005, firma.';
    await abrirRevision(page, texto, '');
    await page.evaluate((t) => (globalThis as unknown as { __siglowRevisionPrueba: Gancho }).__siglowRevisionPrueba.cargar(t, 'en_curso'), texto);
    const marcas = panelTexto(page).locator('[data-det]');
    await expect(marcas).toHaveCount(1);
    const cc = panelTexto(page).locator('[data-det]', { hasText: '1.000.000.005' });
    await cc.click();
    await cc.focus();
    const n = await page.evaluate(() => (globalThis as unknown as { __siglowRevisionPrueba: { incorporarVentana(t: string[], v: number, total: number): Promise<number> } }).__siglowRevisionPrueba.incorporarVentana(['Marta Ficticia Gómez'], 1, 2));
    expect(n).toBe(1);
    await expect(marcas).toHaveCount(2);
    await expect(panelTexto(page).locator('.nueva')).toHaveCount(1);
    await expect(cc).toBeFocused();
    await expect(cc).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('[data-prueba="anuncio-revision"]')).toHaveText('El detector de nombres adicional agregó 1 datos encontrados por revisar.');
    // Al enfocar o seleccionar la nueva, pierde la marca.
    await panelTexto(page).locator('[data-det]', { hasText: 'Marta' }).click();
    await expect(panelTexto(page).locator('.nueva')).toHaveCount(0);
  });
});

// PE-4-r2 (T-PV-05): el lector de PDF conectado a la app. Los PDF son los de tests/fixtures/ (ficticios, generados en el privado).
const pdfFixture = (nombre: string): Buffer => readFileSync(join(process.cwd(), 'tests', 'fixtures', nombre));

test.describe('T-PV-05 PDF de punta a punta en la app (PE-4-r2)', () => {
  test('T-PV-05 @cero-red PDF con JavaScript y texto bajo un recuadro negro: se lee entero, llega a la Vista previa y no sale nada de la página', async ({ page, baseURL }) => {
    const origen = new URL(baseURL!).origin;
    const ajenas: string[] = [];
    const consola: string[] = [];
    const rutas: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.origin !== origen && u.protocol !== 'blob:' && u.protocol !== 'data:') ajenas.push(u.origin);
      if (u.origin === origen) rutas.push(u.pathname + u.search);
    });
    page.on('console', (m) => { consola.push(m.type()); });
    page.on('pageerror', () => { consola.push('pageerror'); });
    page.on('worker', (w) => w.on('console', (m) => consola.push(m.type())));
    await page.addInitScript(() => {
      (globalThis as unknown as { __violaciones: string[] }).__violaciones = [];
      addEventListener('securitypolicyviolation', (e) => {
        (globalThis as unknown as { __violaciones: string[] }).__violaciones.push(e.violatedDirective);
      });
    });
    await irAEntrada(page);
    await cargarArchivo(page, 'Sentencia de Prueba.pdf', pdfFixture('pdf-js-recuadro.pdf'), 'application/pdf');
    const cargado = page.locator('[data-prueba="archivo-cargado"]');
    await expect(cargado).toContainText('Archivo cargado: PDF, ', { timeout: 20_000 });
    await expect(alertaEntrada(page)).toHaveCount(0);
    await expect(analizar(page)).toBeEnabled();
    await analizar(page).click();
    await expect(h1(page, TITULO.vista)).toBeVisible({ timeout: 30_000 });
    // V-39: el texto bajo el recuadro negro llega a la revisión, donde el abogado puede verlo (en «Revisar dato por dato»: la vista
    // previa de un PDF muestra las páginas con los recuadros negros y no el texto).
    await aDetalle(page);
    await expect(page.locator('main')).toContainText('Pedro Ficticio Ejemplo');
    // INV-D05: el nombre del archivo no aparece en ninguna parte de la página, de la red ni del título.
    await expect(page.locator('body')).not.toContainText('Sentencia de Prueba');
    expect(await page.title()).toBe('Sig-Low');
    expect(ajenas).toEqual([]);
    expect(await page.evaluate(() => (globalThis as unknown as { __violaciones: string[] }).__violaciones)).toEqual([]);
    expect(consola).toEqual([]);
    expect(rutas.filter((r) => r.includes('Sentencia') || r.includes('?'))).toEqual([]);
    // El worker de pdf.js salió del propio origen, como archivo del build (nunca blob:).
    expect(rutas.some((r) => /^\/assets\/pdf\.worker-[\w-]+\.js$/.test(r))).toBe(true);
  });

  test('T-PV-05 PDF con formularios: los valores de campos son partes, las casillas no, y el aviso cuenta lo que no se lee (M-1325)', async ({ page }) => {
    await irAEntrada(page);
    await cargarArchivo(page, 'Formulario de Prueba.pdf', pdfFixture('pdf-formularios.pdf'), 'application/pdf');
    await expect(page.locator('[data-prueba="archivo-cargado"]')).toContainText('Archivo cargado: PDF, ', { timeout: 20_000 });
    await page.locator('details[data-prueba="partes"] summary').click();
    for (const [etiqueta, n] of [['Página 1', 30], ['Anotación 1 (página 1)', 22], ['Anotación 2 (página 1)', 13], ['Anotación 3 (página 1)', 14]] as const) {
      await expect(page.getByRole('checkbox', { name: `${etiqueta} · ${n} caracteres` })).toBeChecked();
    }
    await expect(page.getByRole('group', { name: 'Partes del documento' }).getByRole('checkbox')).toHaveCount(4);
    await expect(page.locator('[data-prueba="avisos-lectura"] li')).toHaveText(
      'El PDF tiene adjuntos, vínculos o índices (5) cuyo contenido Sig-Low no lee. Revíselos en el original.',
    );
    await expect(page.locator('body')).not.toContainText('ejemplo.test');
    await expect(page.locator('body')).not.toContainText('Capitulo Ejemplo');
  });

  test('T-PV-05 PDF escaneado y PDF con contraseña: M-54 y M-55, sin pedir la contraseña', async ({ page }) => {
    await irAEntrada(page);
    await cargarArchivo(page, 'Escaneado de Prueba.pdf', pdfFixture('pdf-escaneado.pdf'), 'application/pdf');
    await expect(alertaEntrada(page)).toHaveText(
      'Este PDF parece escaneado: más de la mitad de sus páginas no tienen texto seleccionable. Sig-Low no lee imágenes. Use un PDF con texto o pegue el texto.',
      { timeout: 20_000 },
    );
    await cargarArchivo(page, 'Protegido de Prueba.pdf', pdfFixture('pdf-con-contrasena.pdf'), 'application/pdf');
    await expect(alertaEntrada(page)).toHaveText(
      'Este PDF está protegido con contraseña. Quite la protección y vuelva a cargarlo, o pegue el texto.',
      { timeout: 20_000 },
    );
    await expect(page.locator('[data-prueba="carga"]').getByLabel(/contraseña/i)).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('de Prueba.');
    await expect(analizar(page)).toBeDisabled();
  });
});

// ===== PC-4 · Revisión II (8.2.6): sugerencias, banderas, contador, filtros, recorrido y búsqueda propia =====
// Mismo build de medición y mismo gancho que Revisión I. Datos ficticios (10.1.5). Los lugares son municipios reales de la DIVIPOLA
// (no son datos personales); todo lo demás lleva «Ficticia», «Ejemplo» o «Prueba».

const TEXTO_II = [
  'El Juzgado Tercero Civil del Circuito de Cartago ordenó el trámite. El Juzgado Promiscuo Municipal de Granada recibió el oficio.',
  'La señora Ana Ficticia Rojas vive en Cartago desde el 14 de marzo de 2026. Nació el 14 de marzo de 1991.',
  'La gerente general de Ferretería Ejemplo firmó. Diagnóstico CIE-10 G35. Como lo reiteró el Tribunal en el expediente 11001-03-15-999-2020-01234-00 se dispuso.',
  'La niña con T.I. 1.000.000.002 y el C.E. 123456 asistieron.',
].join('\n');

const contador = (page: Page) => page.locator('[data-prueba="contador-texto"]');
const continuar = (page: Page) => page.locator('[data-prueba="continuar"]');
const claseSug = (page: Page) => page.locator('li[data-sugerencia]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['clase']));

testMedicion.describe('Revisión II (PC-4)', () => {
  testMedicion.describe.configure({ timeout: 90_000 });

  testMedicion('T-IU-05 INV-R08: sugerencias en orden (recomendadas primero), con clase y prioridad; aplicar y descartar DESPACHO_A_GENERICO suben revision en 1', async ({ page }) => {
    await abrirRevision(page, TEXTO_II, '');
    await expect(page.getByRole('tab', { name: /^Sugerencias para hacer más general un dato/ })).toHaveAttribute('aria-selected', 'true');
    expect(await claseSug(page)).toEqual([
      'DESPACHO_A_GENERICO', 'DESPACHO_A_GENERICO', 'MUNICIPIO_A_DEPARTAMENTO',
      'FECHA_A_MES_ANIO', 'FECHA_NACIMIENTO_A_RANGO_EDAD', 'ROTULO_DOCUMENTO_A_GENERICO', 'ROTULO_DOCUMENTO_A_GENERICO',
    ]);
    await expect(page.locator('[data-prueba="prioridad"]').first()).toHaveText('Recomendada');
    await expect(page.locator('[data-prueba="sin-decidir"]')).toHaveText('Por decidir: 5');
    // `ROTULO_DOCUMENTO_A_GENERICO` nace aplicada: «Aplicada» y M-128, y no cuenta como sin decidir.
    const rotulo = page.locator('li[data-clase="ROTULO_DOCUMENTO_A_GENERICO"]').first();
    await expect(rotulo.locator('[data-prueba="estado-sugerencia"]')).toHaveText('Aplicada');
    await expect(rotulo).toContainText('Esta sugerencia ya viene aplicada');

    // Descartar la generalización del rótulo restituye «T.I.» (la edición de tramo desaparece) y deja el marcador neutro.
    const ediciones = panelTexto(page).locator('.res.edicion');
    await expect(ediciones).toHaveCount(2);
    const rAntes = await gancho(page).revision();
    await rotulo.getByRole('button', { name: /^Descartar/ }).click();
    await expect(rotulo.locator('[data-prueba="estado-sugerencia"]')).toHaveText('Descartada');
    await expect(ediciones).toHaveCount(1);
    expect(await gancho(page).revision()).toBe(rAntes + 1);

    const despacho = page.locator('li[data-clase="DESPACHO_A_GENERICO"]').first();
    const r0 = await gancho(page).revision();
    await despacho.getByRole('button', { name: /^Aplicar/ }).click();
    expect(await gancho(page).revision()).toBe(r0 + 1);
    await expect(despacho.locator('[data-prueba="estado-sugerencia"]')).toHaveText('Aplicada');
    await expect(page.locator('[data-prueba="sin-decidir"]')).toHaveText('Por decidir: 4');
    await expect(page.locator('[data-prueba="anuncio-revision"]')).toHaveText('Sugerencia aplicada. Quedan 4 por decidir.');
    await page.getByRole('button', { name: 'Ver documento anonimizado' }).click();
    await expect(page.locator('[data-prueba="panel-texto"]')).toContainText('[DEPARTAMENTO_1]');
    await page.getByRole('button', { name: 'Ver original' }).click();

    await despacho.getByRole('button', { name: /^Descartar/ }).click();
    expect(await gancho(page).revision()).toBe(r0 + 2);
    await expect(despacho.locator('[data-prueba="estado-sugerencia"]')).toHaveText('Descartada');
    await expect(page.locator('[data-prueba="sin-decidir"]')).toHaveText('Por decidir: 4');
    await page.getByRole('button', { name: 'Ver documento anonimizado' }).click();
    await expect(page.locator('[data-prueba="panel-texto"]')).not.toContainText('[DEPARTAMENTO_1]');
  });

  testMedicion('T-IU-05 INV-R08: MUNICIPIO_A_DEPARTAMENTO homónimo pide el departamento (M-127) antes de Aplicar y se puede descartar', async ({ page }) => {
    await abrirRevision(page, 'La señora Ana Ficticia Rojas vive en el municipio de Granada.', '');
    const tarjeta = page.locator('li[data-clase="MUNICIPIO_A_DEPARTAMENTO"]');
    await expect(tarjeta).toHaveCount(1);
    await expect(tarjeta.getByRole('group', { name: /Hay varios municipios con este nombre/ })).toBeVisible();
    await expect(tarjeta.getByRole('radio', { name: 'Antioquia' })).toBeVisible();
    const r0 = await gancho(page).revision();
    await tarjeta.getByRole('button', { name: /^Aplicar/ }).click();
    await expect(tarjeta.getByRole('alert')).toContainText('Hay varios municipios con este nombre');
    expect(await gancho(page).revision()).toBe(r0);
    await tarjeta.getByRole('radio', { name: 'Antioquia' }).check();
    await tarjeta.getByRole('button', { name: /^Aplicar/ }).click();
    await expect(tarjeta.locator('[data-prueba="estado-sugerencia"]')).toHaveText('Aplicada');
    expect(await gancho(page).revision()).toBe(r0 + 2);
    await tarjeta.getByRole('button', { name: /^Descartar/ }).click();
    await expect(tarjeta.locator('[data-prueba="estado-sugerencia"]')).toHaveText('Descartada');
    expect(await gancho(page).revision()).toBe(r0 + 3);
  });

  // En «Revisar dato por dato» el «Continuar» de la barra sigue pidiendo confirmar los datos indirectos (M-68); la puerta de Descargar,
  // en cambio, ya no (D-24, ver «Descargar (PC-5)»).
  testMedicion('T-IU-05 INV-R08: datos indirectos con «Mantener el texto» y «Reemplazar por…»; uno sin revisar mantiene cerrado el «Continuar» de la revisión dato por dato (M-68)', async ({ page }) => {
    await abrirRevision(page, 'La gerente general de Ferretería Ejemplo firmó. Diagnóstico CIE-10 G35.', '');
    await expect(contador(page)).toHaveText('0 datos encontrados por revisar · 2 datos indirectos por revisar');
    await expect(continuar(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('[data-prueba="ayuda-continuar"]')).toContainText('Para continuar, decida todos los datos encontrados por revisar');
    await page.getByRole('tab', { name: /^Datos indirectos para revisar/ }).click();
    const cargo = page.locator('li[data-bandera]').first();
    await expect(cargo).toContainText('Cargo que puede ser único');
    await expect(cargo).toContainText('Un cargo único puede identificar a la persona');
    const r0 = await gancho(page).revision();
    await cargo.getByRole('button', { name: /^Mantener el texto/ }).click();
    expect(await gancho(page).revision()).toBe(r0 + 1);
    await expect(cargo.locator('[data-prueba="estado-bandera"]')).toHaveText('Revisado');
    await expect(contador(page)).toHaveText('0 datos encontrados por revisar · 1 datos indirectos por revisar');
    await continuar(page).click({ force: true }); // aria-disabled: no hace nada
    await expect(h1(page, TITULO.detalle)).toBeVisible();
    // Reemplazo con una de las opciones de la bandera.
    const dx = page.locator('li[data-bandera]').nth(1);
    await dx.getByRole('button', { name: /^Reemplazar por…/ }).click();
    await expect(dx.getByRole('radio', { name: 'un diagnóstico médico' })).toBeChecked();
    await dx.getByRole('button', { name: 'Aplicar el reemplazo' }).click();
    expect(await gancho(page).revision()).toBe(r0 + 2);
    await expect(dx.locator('[data-prueba="estado-bandera"]')).toHaveText('Revisado');
    await expect(contador(page)).toHaveText('No quedan datos encontrados por revisar ni datos indirectos por revisar.');
    await expect(continuar(page)).toHaveAttribute('aria-disabled', 'false');
    await page.getByRole('button', { name: 'Ver documento anonimizado' }).click();
    await expect(page.locator('[data-prueba="panel-texto"]')).toContainText('un diagnóstico médico');
    await continuar(page).click();
    await expect(h1(page, 'Descargar')).toBeVisible();
  });

  testMedicion('T-IU-05 INV-R08: bandera con texto libre en «Reemplazar por…»: entra a la salida y confirma la bandera', async ({ page }) => {
    await abrirRevision(page, 'La gerente general de Ferretería Ejemplo firmó.', '');
    await page.getByRole('tab', { name: /^Datos indirectos para revisar/ }).click();
    const cargo = page.locator('li[data-bandera]').first();
    await cargo.getByRole('button', { name: /^Reemplazar por…/ }).click();
    await cargo.getByLabel('Texto del reemplazo del dato indirecto').fill('una directiva de Prueba');
    const r0 = await gancho(page).revision();
    await cargo.getByRole('button', { name: 'Aplicar el reemplazo' }).click();
    expect(await gancho(page).revision()).toBe(r0 + 1);
    await expect(cargo.locator('[data-prueba="estado-bandera"]')).toHaveText('Revisado');
    await page.getByRole('button', { name: 'Ver documento anonimizado' }).click();
    await expect(page.locator('[data-prueba="panel-texto"]')).toContainText('una directiva de Prueba');
  });

  testMedicion('T-IU-05 INV-R08: cita jurisprudencial («Es una cita: no reemplazar» rechaza el radicado; «Es un radicado del caso» lo acepta)', async ({ page }) => {
    await abrirRevision(page, 'Como lo reiteró el Tribunal en el expediente 11001-03-15-999-2020-01234-00 se dispuso.', '');
    await page.getByRole('tab', { name: /^Datos indirectos para revisar/ }).click();
    const cita = page.locator('li[data-bandera]').first();
    await expect(cita).toContainText('Parece una cita de jurisprudencia');
    await cita.getByRole('button', { name: 'Es una cita: no reemplazar' }).click();
    await expect.poll(async () => (await gancho(page).estado()).estados['rechazada']).toBe(1);
    await cita.getByRole('button', { name: 'Es un radicado del caso: reemplazar' }).click();
    await expect.poll(async () => (await gancho(page).estado()).estados['aceptada']).toBe(1);
    await expect(cita.locator('[data-prueba="estado-bandera"]')).toHaveText('Revisado');
  });

  testMedicion('T-IU-05 pestañas con flechas, Inicio y Fin; el recorrido de pendientes incluye las banderas y abre su pestaña', async ({ page }) => {
    await abrirRevision(page, TEXTO_II, '');
    const sug = page.getByRole('tab', { name: /^Sugerencias para hacer más general un dato/ });
    const ban = page.getByRole('tab', { name: /^Datos indirectos para revisar/ });
    await sug.focus();
    await page.keyboard.press('ArrowRight');
    await expect(ban).toHaveAttribute('aria-selected', 'true');
    await expect(ban).toBeFocused();
    await page.keyboard.press('Home');
    await expect(sug).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(ban).toHaveAttribute('aria-selected', 'true');
    await sug.click();
    // Hay 5 detecciones y 5 banderas: el recorrido de 10 pasos pasa por una tarjeta de bandera.
    let vistoBandera = false;
    for (let i = 0; i < 10 && !vistoBandera; i++) {
      await page.getByRole('button', { name: 'Siguiente por revisar' }).click();
      vistoBandera = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.hasAttribute('data-bandera') ?? false);
    }
    expect(vistoBandera).toBe(true);
    await expect(ban).toHaveAttribute('aria-selected', 'true');
    // Hacia atrás vuelve a una detección (texto o lista) sin perder el orden de lectura.
    await page.getByRole('button', { name: 'Anterior por revisar' }).click();
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.hasAttribute('data-det') ?? false)).toBe(true);
  });

  testMedicion('T-IU-05 «Ir a la ubicación» de una bandera lejana monta su bloque y la deja a la vista', async ({ page }) => {
    const relleno = Array.from({ length: 400 }, (_, i) => `Línea de relleno ${i + 1} sin datos.`).join('\n');
    await abrirRevision(page, `${relleno}\nLa gerente general de Ferretería Ejemplo firmó.`, '');
    await page.getByRole('tab', { name: /^Datos indirectos para revisar/ }).click();
    await expect(panelTexto(page).locator('[data-ban]')).toHaveCount(0);
    await page.locator('li[data-bandera]').first().getByRole('button', { name: 'Ir al lugar del documento' }).click();
    await expect(panelTexto(page).locator('[data-ban]')).toHaveCount(1);
    await expect(panelTexto(page).locator('[data-ban]')).toBeInViewport();
  });

  testMedicion('T-IU-06 búsqueda propia: coincidencias sobre el texto en memoria, sin tildes ni mayúsculas, Enter y Mayús+Enter, «{i} de {n}»', async ({ page }) => {
    await abrirRevision(page, TEXTO_REVISION);
    const campo = page.getByRole('textbox', { name: 'Buscar en el documento' });
    for (const [k, v] of [['spellcheck', 'false'], ['autocomplete', 'off'], ['autocorrect', 'off'], ['autocapitalize', 'off'], ['translate', 'no'], ['data-gramm', 'false']]) {
      await expect(campo).toHaveAttribute(k as string, v as string);
    }
    await expect(campo).toHaveAttribute('id', /^c\d+$/);
    await expect(page.locator('[data-prueba="busqueda"]')).toContainText('Busque aquí en el documento. La búsqueda del navegador puede enviar el texto de la página a servicios en línea.');
    await campo.fill('SENORA');
    await expect(page.locator('[data-prueba="busqueda-estado"]')).toHaveText('1 de 2');
    await expect(panelTexto(page).locator('mark.coincidencia')).toHaveCount(2);
    await expect(panelTexto(page).locator('mark.coincidencia-actual')).toHaveCount(1);
    await campo.press('Enter');
    await expect(page.locator('[data-prueba="busqueda-estado"]')).toHaveText('2 de 2');
    await campo.press('Enter');
    await expect(page.locator('[data-prueba="busqueda-estado"]')).toHaveText('1 de 2');
    await campo.press('Shift+Enter');
    await expect(page.locator('[data-prueba="busqueda-estado"]')).toHaveText('2 de 2');
    await campo.fill('texto que no existe');
    await expect(page.locator('[data-prueba="busqueda-estado"]')).toHaveText('Sin coincidencias');
    await expect(panelTexto(page).locator('mark.coincidencia')).toHaveCount(0);
    // Una coincidencia dentro de un resaltado también se marca, y el texto copiable no cambia (8.7).
    await campo.fill('ana ficticia');
    await expect(panelTexto(page).locator('[data-det] mark.coincidencia')).toHaveCount(2);
  });

  testMedicion('T-IU-06 «Agregar reemplazo para esta coincidencia» abre el diálogo con el tramo y crea una detección manual', async ({ page }) => {
    await abrirRevision(page, 'La Fundación Ejemplo Prueba atendió el caso del Barrio Ficticio.', '');
    const campo = page.getByRole('textbox', { name: 'Buscar en el documento' });
    await campo.fill('barrio ficticio');
    await expect(page.locator('[data-prueba="busqueda-estado"]')).toHaveText('1 de 1');
    await page.getByRole('button', { name: 'Ocultar esta coincidencia' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Ocultar un texto' });
    await expect(dialogo.locator('[data-prueba="reemplazo-texto"]')).toHaveText('Barrio Ficticio');
    const antes = await gancho(page).revision();
    await dialogo.getByRole('button', { name: 'Ocultar un texto' }).click();
    expect(await gancho(page).revision()).toBe(antes + 1);
    expect((await gancho(page).detalle()).some((d) => d.source === 'manual' && d.precedence === 1 && d.texto === 'Barrio Ficticio')).toBe(true);
  });

  testMedicion('T-IU-06 filtros de categoría, estado, confianza y fuente: filtran la lista y el contador cuenta todo', async ({ page }) => {
    await abrirRevision(page);
    await page.getByText('Filtros de la lista de datos encontrados').click();
    const filas = page.getByRole('treegrid', { name: 'Datos encontrados' }).getByRole('row');
    const antes = await filas.count();
    const textoContador = await contador(page).textContent();
    await page.getByLabel('Estado', { exact: true }).selectOption('aceptada');
    await expect(filas).toHaveCount(1); // solo el encabezado: nada aceptado
    await expect(contador(page)).toHaveText(textoContador ?? '');
    await page.getByLabel('Estado', { exact: true }).selectOption('');
    await panelTexto(page).locator('[data-det]').first().focus();
    await page.keyboard.press('a');
    await page.getByLabel('Estado', { exact: true }).selectOption('aceptada');
    await expect(filas).toHaveCount(2); // encabezado + la entidad con una mención aceptada
    await expect(contador(page)).not.toHaveText(textoContador ?? '');
    await page.getByLabel('Estado', { exact: true }).selectOption('');
    await expect(filas).toHaveCount(antes);
    await page.getByLabel('Categoría', { exact: true }).selectOption('con');
    expect(await filas.count()).toBeLessThan(antes);
    await page.getByLabel('Fuente', { exact: true }).selectOption('modelo');
    await expect(filas).toHaveCount(1);
    await page.getByRole('button', { name: 'Quitar filtros' }).click();
    await expect(filas).toHaveCount(antes);
  });
});

/// ===== PC-5 · Descargar (8.2.7; F3, D-24): puerta de copia, residuos, confirmación única, copiar y exportar =====
// Mismo build de medición que la Revisión I (lib/medicion.ts: servidor en un puerto libre). Para llegar a Descargar sin pasar por la
// vista previa se usa el gancho `__siglowListoPrueba` (solo en el build de medición): decide las detecciones UNA POR UNA con el
// reductor (la revisión dato por dato de la v1.0, sin la propuesta aplicada), fija el avance del modelo y fija un resultado de
// residuos. El texto que se espera en la salida se lee de la vista previa (la pantalla Descargar ya no muestra la salida). Datos ficticios.

type GanchoListo = {
  irAListo(): void;
  decidirUnoAUno(): number;
  restablecerPrimera(): boolean;
  editarPorTexto(original: string, nuevo: string): boolean;
  fijarModelo(m: unknown): void;
  fijarResiduo(hits: number, nuevas: number, revision?: number): void;
  fijarCompilacion(hex: string | null): void;
  estado(): { revision: number; ok: boolean; motivos: string[]; residuoRevision: number | null; buscando: boolean; committed: boolean; copiado: boolean; banderas: number };
};
const GL = '__siglowListoPrueba';
/**
 * Lee el portapapeles del sistema desde una página auxiliar de otro origen (la política de permisos de la app bloquea `clipboard-read`,
 * V-33): devuelve los tipos de cada elemento y el texto plano. Es el «navigator.clipboard.read() en la página auxiliar» de T-IU-10.
 */
async function leerPortapapeles(context: BrowserContext): Promise<{ tipos: string[]; texto: string }> {
  const origen = 'https://auxiliar.ejemplo.test';
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: origen });
  await context.route(`${origen}/**`, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>auxiliar</title><p>auxiliar</p>' }));
  const aux = await context.newPage();
  try {
    await aux.goto(`${origen}/`);
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
const ganchoListo = (page: Page) => ({
  estado: () => page.evaluate((g) => (globalThis as unknown as Record<string, GanchoListo>)[g]!.estado(), GL),
  decidir: () => page.evaluate((g) => (globalThis as unknown as Record<string, GanchoListo>)[g]!.decidirUnoAUno(), GL),
  restablecer: () => page.evaluate((g) => (globalThis as unknown as Record<string, GanchoListo>)[g]!.restablecerPrimera(), GL),
  editar: (o: string, n: string) => page.evaluate(([g, a, b]) => (globalThis as unknown as Record<string, GanchoListo>)[g as string]!.editarPorTexto(a as string, b as string), [GL, o, n]),
  modelo: (m: unknown) => page.evaluate(([g, x]) => (globalThis as unknown as Record<string, GanchoListo>)[g as string]!.fijarModelo(x), [GL, m] as const),
  residuo: (h: number, n: number) => page.evaluate(([g, a, b]) => (globalThis as unknown as Record<string, GanchoListo>)[g as string]!.fijarResiduo(a as number, b as number), [GL, h, n] as const),
  ir: () => page.evaluate((g) => (globalThis as unknown as Record<string, GanchoListo>)[g]!.irAListo(), GL),
  compilacion: (hex: string | null) => page.evaluate(([g, h]) => (globalThis as unknown as Record<string, GanchoListo>)[g as string]!.fijarCompilacion(h), [GL, hex] as const),
});

const TEXTO_LISTO = [
  'Señora Ana Ficticia Rojas, identificada con cédula de ciudadanía número 1.000.000.001, correo ana.ficticia@ejemplo.test, teléfono 3000000000.',
  'El demandado Pedro Ejemplo Prueba, con cédula 1.000.000.002, vive en la Calle 100 # 00-00 de Bogotá.',
  'La señora Ana Ficticia Rojas solicitó el reemplazo.',
].join('\n');
const ORIGINALES = ['Ana Ficticia', 'Pedro Ejemplo', '1.000.000.001', '1000000001', '1.000.000.002', '1000000002', 'ana.ficticia', '3000000000', 'Calle 100'];
const LISTA_LISTO = 'Ana Ficticia Rojas; demandante\nPedro Ejemplo Prueba; demandado';

/** Texto de la vista previa (un renglón por párrafo): el documento anonimizado tal como lo verá el abogado. */
async function textoDeLaVista(page: Page): Promise<string> {
  return vistaPrevia(page).locator('p.bloque').evaluateAll((ps) => ps.map((p) => (p as HTMLElement).innerText).join('\n'));
}
/** Compara textos sin depender de los saltos de línea (`Selection.toString()` y `writeText` los entregan distinto). */
const sinSaltos = (s: string): string => s.replace(/\r\n/g, '\n').replace(/\n+/g, '\n').trim();

/**
 * Abre la revisión dato por dato con el gancho de PC-3 (la lista de nombres sale de «Opciones avanzadas»), decide una por una (si se
 * pide) y entra a Descargar con el estado del modelo pedido. Devuelve el texto de la vista previa con todo decidido (el que se espera
 * en la salida). `caso`: código de un caso «No guardar» creado antes (con él hay chip, menú y código para el informe).
 */
async function abrirListo(
  page: Page, o: { modelo?: 'en_curso' | 'terminado' | 'plan_b'; decidir?: boolean; texto?: string; lista?: string; caso?: string } = {},
): Promise<string> {
  await irACargar(page);
  if (o.caso !== undefined) await crearCaso(page, { codigo: o.caso });
  const lista = o.lista ?? LISTA_LISTO;
  if (lista !== '') {
    await editarLista(page);
    await pegarLista(page, lista);
  }
  await page.waitForFunction(() => '__siglowRevisionPrueba' in globalThis && '__siglowListoPrueba' in globalThis);
  await page.evaluate(([t, m]) => (globalThis as unknown as { __siglowRevisionPrueba: Gancho }).__siglowRevisionPrueba.cargar(t as string, m as string), [o.texto ?? TEXTO_LISTO, o.modelo ?? 'plan_b']);
  await expect(h1(page, TITULO.detalle)).toBeVisible();
  let esperado = '';
  if (o.decidir !== false) {
    await ganchoListo(page).decidir();
    await page.getByRole('button', { name: 'Vista previa', exact: true }).click();
    await expect(h1(page, TITULO.vista)).toBeVisible();
    esperado = await textoDeLaVista(page);
  }
  await ganchoListo(page).ir();
  await expect(h1(page, TITULO.descargar)).toBeVisible();
  await abrirMasFormatos(page);
  return esperado;
}
const botones = (page: Page) => ({
  copiar: page.locator('[data-prueba="copiar"]'),
  vaciar: page.locator('[data-prueba="vaciar"]'),
  txt: page.locator('[data-prueba="descargar-txt"]'),
  docx: page.locator('[data-prueba="descargar-docx"]'),
  pdf: page.locator('[data-prueba="descargar-pdf"]'),
  informeTxt: page.locator('[data-prueba="informe-txt"]'),
  informeJson: page.locator('[data-prueba="informe-json"]'),
});
const confirmacion = (page: Page) => page.getByRole('checkbox', { name: /^Revisé la vista previa/ });
const motivos = (page: Page) => page.locator('[data-motivo]').evaluateAll((els) => els.map((e) => e.getAttribute('data-motivo')));

testMedicion.describe('Descargar (PC-5)', () => {
  testMedicion.describe.configure({ timeout: 120_000 });
  testMedicion.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  testMedicion('T-IU-01 INV-G06 INV-R11: la puerta tiene un estado visible por cada GateReason y se abre solo con todo resuelto y la confirmación única', async ({ page }) => {
    // Estado 1: nada decidido y el detector en curso → PENDIENTES, MODELO_EN_CURSO, RESIDUOS_NO_EJECUTADA (no se busca con pendientes) y RECORDATORIO.
    await abrirListo(page, { modelo: 'en_curso', decidir: false });
    const g = ganchoListo(page);
    await g.modelo({ kind: 'en_curso', ventanas: 2, ventanasTotales: 9 });
    const b = botones(page);
    const lista = page.locator('[data-prueba="motivos-puerta"]');
    await expect(page.locator('[data-prueba="motivos"]')).toContainText('Todavía no se puede descargar:');
    await expect(lista.locator('[data-motivo="PENDIENTES"]')).toHaveText(/^Quedan \d+ datos encontrados por revisar\.$/);
    await expect(lista.locator('[data-motivo="MODELO_EN_CURSO"]')).toHaveText('El detector de nombres adicional todavía está revisando el documento: faltan 7 de 9 bloques. Espere a que termine o elija seguir sin él.');
    await expect(lista.locator('[data-motivo="RESIDUOS_NO_EJECUTADA"]')).toHaveText('Falta la búsqueda de datos que se escaparon.');
    await expect(lista.locator('[data-motivo="RECORDATORIO"]')).toHaveText('Falta marcar la confirmación «Revisé la vista previa».');
    for (const x of [b.docx, b.pdf, b.copiar, b.txt, b.informeTxt, b.informeJson]) {
      await expect(x).toHaveAttribute('aria-disabled', 'true');
      await expect(x).toHaveAttribute('aria-describedby', 'motivos-puerta');
    }
    await expect(b.vaciar).toBeDisabled();
    // Estado 2: se deciden las detecciones y las banderas una por una. Con el detector en curso la búsqueda de datos que se escaparon
    // NO corre (7.13.7, INV-R11): quedan el detector, la búsqueda y la confirmación.
    await g.decidir();
    await expect.poll(() => motivos(page)).toEqual(['MODELO_EN_CURSO', 'RESIDUOS_NO_EJECUTADA', 'RECORDATORIO']);
    // Estado 3 (INV-R11): con la confirmación marcada siguen el detector y la búsqueda, aunque no haya pendientes.
    await confirmar(page);
    expect(await motivos(page)).toEqual(['MODELO_EN_CURSO', 'RESIDUOS_NO_EJECUTADA']);
    await expect(b.docx).toHaveAttribute('aria-disabled', 'true');
    // Con el detector terminado la búsqueda corre sola y, con la confirmación marcada, la puerta se abre y los botones se habilitan.
    await g.modelo({ kind: 'terminado', ventanas: 9, respaldo: false });
    await esperarBusqueda(page);
    await expect(page.locator('[data-prueba="motivos"]')).toHaveCount(0);
    for (const x of [b.docx, b.pdf, b.copiar, b.txt]) await expect(x).not.toHaveAttribute('aria-disabled', 'true');
    await g.modelo({ kind: 'plan_b', causa: 'cancelado', ventanas: 2, ventanasTotales: 9 });
    await expect(page.locator('[data-prueba="motivos"]')).toHaveCount(0);
    // Estados 4 y 5: un resultado con hallazgos y uno con detecciones nuevas, para la revisión vigente.
    await g.residuo(2, 0);
    expect(await motivos(page)).toEqual(['RESIDUOS_ENCONTRADOS']);
    await expect(lista.locator('[data-motivo="RESIDUOS_ENCONTRADOS"]')).toHaveText('La búsqueda encontró 2 datos originales en el documento anonimizado.');
    await expect(b.docx).toHaveAttribute('aria-disabled', 'true');
    await g.residuo(0, 3);
    expect(await motivos(page)).toEqual(['DETECCIONES_NUEVAS']);
    await expect(lista.locator('[data-motivo="DETECCIONES_NUEVAS"]')).toHaveText('La búsqueda de datos que se escaparon encontró 3 datos nuevos que no se habían encontrado antes.');
    // Estado 6 (INV-R07): una acción de revisión después de la búsqueda deja el resultado desactualizado y reaparece PENDIENTES.
    await g.residuo(0, 0);
    await expect(page.locator('[data-prueba="motivos"]')).toHaveCount(0);
    expect(await g.restablecer()).toBe(true);
    await expect(lista.locator('[data-motivo="RESIDUOS_DESACTUALIZADA"]')).toHaveText('Hubo cambios después de la búsqueda de datos que se escaparon.');
    await expect(lista.locator('[data-motivo="PENDIENTES"]')).toHaveText('Quedan 1 datos encontrados por revisar.');
    // Al decidir de nuevo la búsqueda vuelve a correr sola; la confirmación era de una revisión anterior (B-150, F23-r1): la puerta
    // pide confirmar otra vez, y con la confirmación nueva se abre.
    await g.decidir();
    await esperarBusqueda(page);
    expect(await motivos(page)).toEqual(['RECORDATORIO']);
    await expect(confirmacion(page)).not.toBeChecked();
    await confirmar(page);
    await expect(page.locator('[data-prueba="motivos"]')).toHaveCount(0);
    expect((await g.estado()).ok).toBe(true);
    // Estado 8: desmarcar la confirmación cierra la puerta con RECORDATORIO.
    await confirmacion(page).uncheck();
    expect(await motivos(page)).toEqual(['RECORDATORIO']);
    await expect(b.docx).toHaveAttribute('aria-disabled', 'true');
  });

  // D-24 (F3) cambió esta prueba: BANDERAS ya no es un motivo de la puerta (6.4.8). Una bandera sin confirmar queda como «punto para
  // revisar» de la vista previa, pero no impide descargar. Se usa la cita de jurisprudencia: sin opción de reemplazo, la propuesta la deja
  // sin confirmar (con su radicado oculto).
  testMedicion('T-IU-01 D-24 BANDERAS: una bandera sin confirmar ya NO cierra la puerta; queda como punto para revisar en la vista previa', async ({ page }) => {
    await irACargar(page);
    await pegarTexto(page, 'Como lo reiteró el Tribunal en el expediente 11001-03-15-999-2020-01234-00 se dispuso.');
    await anonimizar(page);
    await expect(page.locator('[data-prueba="puntos"]')).toContainText(/Puntos para revisar: [1-9]/);
    await aDescargar(page);
    await expect(page.locator('[data-motivo="BANDERAS"]')).toHaveCount(0);
    expect(await motivos(page)).toEqual(['RECORDATORIO']);
    await confirmar(page);
    const e = await ganchoListo(page).estado();
    expect(e.banderas).toBeGreaterThan(0);
    expect(e.ok).toBe(true);
    await expect(page.locator('[data-prueba="motivos"]')).toHaveCount(0);
    await expect(page.locator('[data-prueba="descargar-docx"]')).not.toHaveAttribute('aria-disabled', 'true');
  });

  testMedicion('T-IU-04 INV-X05 (a) con la puerta cerrada, copiar la vista previa no cambia el portapapeles y deja M-73 en Descargar', async ({ page, context }) => {
    await abrirListo(page);
    await page.evaluate(() => navigator.clipboard.writeText('SENTINELA-DE-PRUEBA'));
    const b = botones(page);
    await expect(b.copiar).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('button', { name: 'Volver a la vista previa' }).click();
    await expect(h1(page, TITULO.vista)).toBeVisible();
    const r = await page.evaluate(() => {
      const panel = document.querySelector('[data-prueba="vista-previa"]') as HTMLElement;
      const dt = new DataTransfer();
      const ev = new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true });
      panel.dispatchEvent(ev);
      const corte = new ClipboardEvent('cut', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
      panel.dispatchEvent(corte);
      const drag = new DragEvent('dragstart', { bubbles: true, cancelable: true });
      panel.dispatchEvent(drag);
      return { tipos: [...dt.types], prevenido: ev.defaultPrevented, corte: corte.defaultPrevented, drag: drag.defaultPrevented };
    });
    expect(r).toEqual({ tipos: [], prevenido: true, corte: true, drag: true });
    // Ctrl+C real sobre la vista previa, también con la puerta cerrada, no escribe nada.
    await etiquetas(page).first().focus();
    await page.evaluate(() => {
      const p = document.querySelector('[data-prueba="vista-previa"]') as HTMLElement;
      const rg = document.createRange();
      rg.selectNodeContents(p);
      const s = getSelection() as Selection;
      s.removeAllRanges();
      s.addRange(rg);
    });
    await page.keyboard.press('Control+C');
    expect((await leerPortapapeles(context)).texto).toBe('SENTINELA-DE-PRUEBA');
    await page.bringToFront();
    // El aviso M-73 queda en el almacén de Descargar.
    await page.getByRole('button', { name: 'Continuar a descargar' }).click();
    await expect(h1(page, TITULO.descargar)).toBeVisible();
    await expect(page.locator('[data-aviso="M-73"]')).toContainText('Podrá copiar o descargar cuando termine la búsqueda de datos que se escaparon');
    await abrirMasFormatos(page);
    await b.copiar.click({ force: true });
    await b.txt.click({ force: true });
    expect((await leerPortapapeles(context)).texto).toBe('SENTINELA-DE-PRUEBA');
    expect((await ganchoListo(page).estado()).committed).toBe(false);
  });

  testMedicion('T-IU-04 INV-G06 (b) flujo completo: pegar → vista previa → residuos → confirmación → copiar en verde, con M-84, M-85 y «Vaciar portapapeles» (M-86)', async ({ page, context }) => {
    await irACargar(page);
    await crearCaso(page, { codigo: 'PRUEBA-FLUJO' });
    await editarLista(page);
    await pegarLista(page, LISTA_LISTO);
    await pegarTexto(page, TEXTO_LISTO);
    await anonimizar(page);
    await page.waitForFunction(() => '__siglowListoPrueba' in globalThis);
    const g = ganchoListo(page);
    // D-24: la propuesta ya aplicó todo; no hay nada que decidir una por una.
    expect((await gancho(page).estado()).estados['pendiente'] ?? 0).toBe(0);
    await esperarBusqueda(page);
    const esperado = await textoDeLaVista(page);
    await aDescargar(page);
    await expect(page.locator('[data-prueba="residuos-estado"]')).toContainText(/ninguno de los \d+ datos buscados aparece en el documento anonimizado\./);
    // F3 reemplazó M-122 por M-2190 en la pantalla Descargar: lo que la búsqueda no puede encontrar (imágenes, fotos, firmas).
    await expect(page.locator('body')).toContainText('Sig-Low no puede encontrar datos en imágenes, fotos o firmas escaneadas.');
    await expect(page.locator('[data-prueba="prueba-final"]')).toContainText('Antes de copiar, pregúntese');
    await abrirMasFormatos(page);
    const b = botones(page);
    await expect(b.copiar).toHaveAttribute('aria-disabled', 'true');
    await expect(confirmacion(page)).not.toBeChecked();
    await confirmar(page);
    await expect(b.copiar).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('[data-prueba="motivos"]')).toHaveCount(0);
    for (const o of ORIGINALES) expect(esperado).not.toContain(o);
    expect(esperado).toMatch(/\[[A-ZÁÉÍÓÚÑ_]+_1\]/);
    expect((await g.estado()).committed).toBe(false);
    await b.copiar.click();
    await expect(page.locator('[data-aviso="M-84"]')).toHaveText('Texto anonimizado copiado. Péguelo solo en una herramienta autorizada por la política de uso de IA de su organización.');
    await expect(page.locator('[data-aviso="M-85"]')).toContainText('ese botón no borra el historial');
    // `writeText` en Windows entrega los saltos de línea del sistema (CRLF): se compara con el texto de la vista previa normalizado.
    expect((await leerPortapapeles(context)).texto.replace(/\r\n/g, '\n')).toBe(esperado);
    await page.bringToFront();
    expect((await g.estado()).committed).toBe(true);
    // «No guardar»: el recordatorio de guardar la llave (M-90) queda visible.
    await expect(page.locator('[data-prueba="respaldo-tabla"]')).toContainText('La llave está solo en memoria');
    await expect(b.vaciar).toBeEnabled();
    await b.vaciar.click();
    await expect(page.locator('[data-aviso="M-86"]')).toBeVisible();
    expect((await leerPortapapeles(context)).texto).toBe('');
    await page.bringToFront();
    await expect(page.locator('[data-aviso="M-86"]')).toContainText('conserva lo que copió antes');
  });

  testMedicion('T-IU-04 (b) si writeText falla aparece el área de respaldo con el texto anonimizado seleccionado (M-87)', async ({ page }) => {
    const esperado = await abrirListo(page);
    await esperarBusqueda(page);
    await confirmar(page);
    await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('bloqueado')); });
    await botones(page).copiar.click();
    await expect(page.locator('[data-aviso="M-87"]')).toHaveText('El navegador no permitió copiar automáticamente. El texto está seleccionado abajo: cópielo con Ctrl + C.');
    const area = page.getByRole('textbox', { name: 'Texto anonimizado' });
    await expect(area).toHaveValue(esperado);
    await expect(area).toBeFocused();
    expect(await area.evaluate((a: HTMLTextAreaElement) => [a.selectionStart, a.selectionEnd, a.value.length, a.getAttribute('spellcheck'), a.getAttribute('autocomplete'), a.getAttribute('translate')]))
      .toEqual([0, esperado.length, esperado.length, 'false', 'off', 'no']);
  });

  testMedicion('T-IU-10 copia-dom-salida INV-X05: con la puerta abierta, seleccionar toda la vista previa y Control+C escribe solo text/plain y 0 originales', async ({ page, context }) => {
    const esperado = await abrirListo(page);
    await esperarBusqueda(page);
    await confirmar(page);
    // La vista previa atiende Ctrl+C con la misma puerta que la descarga: se vuelve a ella con la puerta abierta.
    await page.getByRole('button', { name: 'Volver a la vista previa' }).click();
    await expect(h1(page, TITULO.vista)).toBeVisible();
    await etiquetas(page).first().focus();
    await page.evaluate(() => {
      const p = document.querySelector('[data-prueba="vista-previa"]') as HTMLElement;
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
    expect(sinSaltos(leido.texto)).toBe(sinSaltos(esperado));
    for (const o of ORIGINALES) expect(leido.texto).not.toContain(o);
    // Barrido del DOM: ningún atributo ni nodo de texto de la vista previa contiene originales; las etiquetas se llaman solo «Etiqueta […]».
    const barrido = await page.evaluate((originales) => {
      const p = document.querySelector('[data-prueba="vista-previa"]') as HTMLElement;
      const hallazgos: string[] = [];
      const revisar = (s: string, donde: string): void => { for (const o of originales) if (s.includes(o)) hallazgos.push(`${donde}:${o}`); };
      const recorrer = (n: Node): void => {
        if (n.nodeType === Node.TEXT_NODE) revisar(n.textContent ?? '', 'texto');
        if (n instanceof Element) for (const a of Array.from(n.attributes)) revisar(a.value, `@${a.name}`);
        n.childNodes.forEach(recorrer);
      };
      recorrer(p);
      const nombres = [...p.querySelectorAll('button.etiqueta')].map((f) => f.getAttribute('aria-label'));
      return { hallazgos, nombres, hayRevelados: p.querySelector('button.revelado') !== null };
    }, ORIGINALES);
    expect(barrido.hallazgos).toEqual([]);
    expect(barrido.hayRevelados).toBe(false);
    expect(barrido.nombres.length).toBeGreaterThan(0);
    for (const n of barrido.nombres) expect(n).toMatch(/^Etiqueta \[[A-ZÁÉÍÓÚÑ_]+_\d+\], .+\. Pulse para ver las opciones\.$/);
    // La copia atendida por Ctrl+C consolida igual que el botón y deja M-84 y M-85 en Descargar.
    expect((await ganchoListo(page).estado()).committed).toBe(true);
    await page.getByRole('button', { name: 'Continuar a descargar' }).click();
    await expect(h1(page, TITULO.descargar)).toBeVisible();
    await expect(page.locator('[data-aviso="M-84"]')).toBeVisible();
  });

  testMedicion('T-LE-10 T-PV-13 INV-X05 INV-X06: los botones llaman a exportarTxt, exportarDocx y exportarPdf, el nombre es neutro y no queda ninguna URL blob: viva', async ({ page }) => {
    await page.addInitScript(() => {
      const vivas = new Set<string>();
      const crear = URL.createObjectURL.bind(URL);
      const revocar = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (o: Blob | MediaSource): string => { const u = crear(o); vivas.add(u); return u; };
      URL.revokeObjectURL = (u: string): void => { vivas.delete(u); revocar(u); };
      (globalThis as unknown as { __blobsVivos: () => number }).__blobsVivos = () => vivas.size;
    });
    const esperado = await abrirListo(page);
    await esperarBusqueda(page);
    const b = botones(page);
    await b.txt.click({ force: true });
    await expect(page.locator('[data-aviso="M-88"]')).toHaveCount(0);       // con la puerta cerrada no actúa
    await confirmar(page);
    const [dTxt] = await Promise.all([page.waitForEvent('download'), b.txt.click()]);
    expect(dTxt.suggestedFilename()).toMatch(/^sig-low-anonimizado-\d{8}-\d{4}\.txt$/);
    const bytesTxt = readFileSync((await dTxt.path()) as string);
    expect([...bytesTxt.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const txt = bytesTxt.toString('utf8').slice(1);
    expect(txt).toBe(esperado.replace(/\n/g, '\r\n') + '\r\n');
    for (const o of ORIGINALES) expect(txt).not.toContain(o);
    await expect(page.locator('[data-aviso="M-88"]')).toContainText('Es un archivo nuevo: no conserva el formato ni los datos ocultos del original');
    // «Descargar documento (.docx)»: el original es texto pegado, así que sale el .docx simple (el fiel es para un .docx original).
    const [dDocx] = await Promise.all([page.waitForEvent('download'), b.docx.click()]);
    expect(dDocx.suggestedFilename()).toMatch(/^sig-low-anonimizado-\d{8}-\d{4}\.docx$/);
    const docx = readFileSync((await dDocx.path()) as string);
    expect([...docx.subarray(0, 2)]).toEqual([0x50, 0x4b]);
    // «Descargar PDF»: el PDF de texto (el tachado es para un PDF original).
    const [dPdf] = await Promise.all([page.waitForEvent('download'), b.pdf.click()]);
    expect(dPdf.suggestedFilename()).toMatch(/^sig-low-anonimizado-\d{8}-\d{4}\.pdf$/);
    expect(readFileSync((await dPdf.path()) as string).subarray(0, 4).toString('latin1')).toBe('%PDF');
    await page.waitForTimeout(1100);
    expect(await page.evaluate(() => (globalThis as unknown as { __blobsVivos: () => number }).__blobsVivos())).toBe(0);
    expect((await ganchoListo(page).estado()).committed).toBe(true);
    // Bloquear vacía todo y tampoco deja URL blob: vivas.
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(h1(page, TITULO.cargar)).toBeVisible();
    expect(await page.evaluate(() => (globalThis as unknown as { __blobsVivos: () => number }).__blobsVivos())).toBe(0);
  });

  testMedicion('INV-I01 INV-I03 el informe se descarga en .txt y .json solo con la puerta abierta, sin originales y con el código del caso solo si se pide', async ({ page }) => {
    await abrirListo(page, { caso: 'PRUEBA-001' });
    await esperarBusqueda(page);
    const b = botones(page);
    await expect(b.informeJson).toHaveAttribute('aria-disabled', 'true');
    await confirmar(page);
    // Sin la huella de la aplicación (caché del service worker vacía) el informe no se puede generar: M-1417.
    await ganchoListo(page).compilacion(null);
    await expect(page.getByText('No se puede generar el informe')).toBeVisible();
    await expect(b.informeJson).toHaveAttribute('aria-disabled', 'true');
    await ganchoListo(page).compilacion('ab'.repeat(32));
    await expect(b.informeJson).not.toHaveAttribute('aria-disabled', 'true');
    const [dJson] = await Promise.all([page.waitForEvent('download'), b.informeJson.click()]);
    expect(dJson.suggestedFilename()).toMatch(/^sig-low-informe-\d{8}-\d{4}\.json$/);
    const json = readFileSync((await dJson.path()) as string, 'utf8');
    const informe = JSON.parse(json) as {
      formato: string; residuos: { resultado: string }; asunto?: unknown; motor: { modelo: { planB: boolean } };
      recordatorio: { revisado: boolean }; propuestaAplicada: number;
    };
    expect(informe.formato).toBe('sig-low/informe');
    expect(informe.residuos.resultado).toBe('sin_residuos');
    expect(informe.motor.modelo.planB).toBe(true);
    // D-24: una sola confirmación («Revisé la vista previa») y el conteo de lo que aplicó la propuesta (aquí, 0: se decidió una por una).
    expect(informe.recordatorio.revisado).toBe(true);
    expect(informe.propuestaAplicada).toBe(0);
    expect(informe.asunto).toBeUndefined();
    for (const o of ORIGINALES) expect(json).not.toContain(o);
    await expect(page.locator('[data-aviso="M-89"]')).toContainText('No contiene los datos originales.');
    await page.getByRole('checkbox', { name: 'Incluir el código del caso en el informe' }).check();
    const [dTxt] = await Promise.all([page.waitForEvent('download'), b.informeTxt.click()]);
    expect(dTxt.suggestedFilename()).toMatch(/^sig-low-informe-\d{8}-\d{4}\.txt$/);
    const bytes = readFileSync((await dTxt.path()) as string);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const txt = bytes.toString('utf8');
    expect(txt).toContain('Código del asunto: PRUEBA-001');
    expect(txt).toContain('\r\n');
    for (const o of ORIGINALES) expect(txt).not.toContain(o);
  });

  testMedicion('INV-R07 un original que quedó dentro de un reemplazo editado: la búsqueda no pasa, la puerta sigue cerrada y la banda de ubicaciones aparece en «Revisar dato por dato»', async ({ page }) => {
    await abrirListo(page, { decidir: false });
    const g = ganchoListo(page);
    await g.decidir();
    await confirmar(page);
    // El abogado edita un reemplazo y deja en él un valor original: la búsqueda lo encuentra y la puerta no se abre.
    expect(await g.editar('Pedro Ejemplo Prueba', 'el señor Pedro Ejemplo Prueba')).toBe(true);
    await expect.poll(() => motivos(page), { timeout: 30_000 }).toContain('RESIDUOS_ENCONTRADOS');
    await expect(page.locator('[data-prueba="descargar-docx"]')).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('button', { name: 'Volver a la vista previa' }).click();
    await aDetalle(page);
    await expect(page.locator('[data-prueba="banda-residuos"]')).toBeVisible();
    await expect(page.locator('[data-prueba="banda-residuos"]')).toContainText('La búsqueda de datos que se escaparon encontró');
    await expect(page.locator('[data-prueba="banda-residuos"]')).not.toContainText('Pedro Ejemplo');
  });
});

// P0-3 (9.3, punto de control H3:30): el flujo de la demo en el build real (dist/, sin ganchos de medición), con la interfaz de PC-1 a
// PC-5 y el service worker de PD-1. F23 (D-23, D-24): cargar → vista previa (ya con todo aplicado) → «Continuar a descargar» → búsqueda
// → una sola confirmación → copiar. Se repite sin conexión tras la primera carga (la app sale de la caché del SW).
test.describe('P0-3 flujo de la demo en el build real', () => {
  test.describe.configure({ timeout: 180_000 });
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  const TEXTO_DEMO = [
    'Señora Ana Ficticia Rojas, identificada con cédula de ciudadanía número 1.000.000.001, correo ana.ficticia@ejemplo.test, teléfono 3000000000.',
    'El demandado Pedro Ejemplo Prueba, con cédula 1.000.000.002, presentó la contestación.',
    'La señora Ana Ficticia Rojas solicitó el reemplazo.',
  ].join('\n');
  const ORIGINALES_DEMO = ['Ana Ficticia', 'Pedro Ejemplo', '1.000.000.001', '1000000001', '1.000.000.002', '1000000002', 'ana.ficticia', '3000000000'];

  async function demo(page: Page, context: BrowserContext): Promise<void> {
    await crearCaso(page, { codigo: 'PRUEBA-DEMO' });
    await editarLista(page);
    await pegarLista(page, 'Ana Ficticia Rojas; demandante\nPedro Ejemplo Prueba; demandado');
    await pegarTexto(page, TEXTO_DEMO);
    await anonimizar(page);
    // D-24: la vista previa llega con todo aplicado (no hay que decidir mención por mención; no existe «aceptar todo» del documento: INV-R06).
    expect(await etiquetas(page).count()).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: /aceptar todo|aceptar todas/i })).toHaveCount(0);
    await esperarBusqueda(page);
    const salida = await vistaPrevia(page).locator('p.bloque').evaluateAll((ps) => ps.map((p) => (p as HTMLElement).innerText).join('\n'));
    for (const o of ORIGINALES_DEMO) expect(salida).not.toContain(o);
    expect(salida).toMatch(/\[[A-ZÁÉÍÓÚÑ_]+_1\]/);
    await aDescargar(page);
    await abrirMasFormatos(page);
    const copiar = page.locator('[data-prueba="copiar"]');
    await expect(copiar).toHaveAttribute('aria-disabled', 'true');
    await confirmar(page);
    await expect(copiar).not.toHaveAttribute('aria-disabled', 'true');
    await copiar.click();
    await expect(page.locator('[data-aviso="M-84"]')).toBeVisible();
    expect((await leerPortapapeles(context)).texto.replace(/\r\n/g, '\n')).toBe(salida);
    await page.bringToFront();
  }

  test('T-IU-04 @humo P0-3 pegar → Vista previa → residuos → confirmación → copiar en el build real, también sin conexión', async ({ page, context, baseURL }) => {
    const origen = new URL(baseURL!).origin;
    const ajenas: string[] = [];
    page.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== origen && u.protocol !== 'blob:' && u.protocol !== 'data:') ajenas.push(u.origin); });
    await irACargar(page);
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, { timeout: 30_000 });
    await demo(page, context);
    // Sin conexión tras la primera carga: la app sale de la caché del service worker y el flujo completo funciona igual.
    await context.setOffline(true);
    try {
      const nav = await page.reload();
      expect(nav?.fromServiceWorker()).toBe(true);
      await expect(h1(page, TITULO.cargar)).toBeVisible({ timeout: 30_000 });
      expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
      await demo(page, context);
    } finally {
      await context.setOffline(false);
    }
    expect(ajenas).toEqual([]);
  });
});
