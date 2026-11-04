import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { copiarEnListo, crearYAnalizar, DOCUMENTO_REI, LISTA_REI, REALES_REI, SALIDA_REI, leerPortapapeles } from './ayudas-reinsercion';
import {
  abrirAvanzadas, aDescargar, aDetalle, anonimizar, confirmar, crearCaso, editarLista, etiquetas, irACargar, pegarLista, pegarTexto, vistaPrevia,
} from './lib/flujo';
import { textoDelVolcado, volcarAlmacenamiento } from './lib/almacenamiento';

// T-IU-03 (atributos de privacidad, título neutro) y T-PV-09 («Acerca de»: versión, SHA-256 y dirección oficial), de PC-1.
// PC-7 y las demás tareas agregan aquí los casos T-PV-01, T-PV-02, T-PV-11, T-PV-24 sobre el resto de las pantallas.
// v1.1 (F2/F3, D-23/D-24): el flujo es Cargar documento → Vista previa → Descargar; el caso con contraseña, la llave y «Devolver los
// datos reales» están en «Opciones avanzadas»; la revisión de la v1.0 es «Revisar dato por dato». Lo que se comprueba no cambia.

const h1 = (page: Page, nombre: string) => page.getByRole('heading', { level: 1, name: nombre });

async function abrirInicio(page: Page): Promise<void> {
  await page.goto('/');
  // La primera visita espera el precache del SW (8.1: «sin tiempo límite»; ≈ 1,5 s con el equipo cargado).
  await expect(h1(page, 'Cargar documento')).toBeVisible({ timeout: 30_000 });
}
/** «Opciones avanzadas» → crear un caso sin guardar la llave (se queda en Cargar con el caso abierto). */
async function crearAsunto(page: Page, codigo = 'PRUEBA-001'): Promise<void> {
  await crearCaso(page, { codigo, guardar: false });
}

/** Recorre el DOM y devuelve las infracciones de 8.7 (lista vacía = cumple). */
async function auditar(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const fallas: string[] = [];
    const comunes = { spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', translate: 'no' } as const;
    for (const el of Array.from(document.querySelectorAll('textarea, input'))) {
      const i = el as HTMLInputElement;
      const tipo = el.tagName === 'TEXTAREA' ? 'textarea' : i.type;
      if (['checkbox', 'radio', 'button', 'submit', 'file', 'hidden'].includes(tipo)) continue;
      const nombre = `${el.tagName.toLowerCase()}[${tipo}]#${el.id}`;
      for (const [k, v] of Object.entries(comunes)) if (el.getAttribute(k) !== v) fallas.push(`${nombre}: ${k}=${String(el.getAttribute(k))}`);
      const ac = el.getAttribute('autocomplete');
      // Campo de frase: type=password, o type=text mientras «Mostrar» está activo (conserva autocomplete=new-password).
      if (tipo === 'password' || ac === 'new-password') {
        if (ac !== 'new-password') fallas.push(`${nombre}: autocomplete=${String(ac)}`);
      } else {
        if (ac !== 'off') fallas.push(`${nombre}: autocomplete=${String(ac)}`);
        for (const d of ['data-gramm', 'data-gramm_editor', 'data-enable-grammarly', 'data-lt-active']) {
          if (el.getAttribute(d) !== 'false') fallas.push(`${nombre}: ${d}`);
        }
      }
      if (!/^c\d+$/.test(el.id) || el.getAttribute('name') !== el.id) fallas.push(`${nombre}: id o name no neutros`);
    }
    for (const el of Array.from(document.querySelectorAll('[id],[name]'))) {
      if (/c[eé]dula|nombre|name/i.test(`${el.id} ${el.getAttribute('name') ?? ''}`)) fallas.push(`id o name con palabra sensible: ${el.id}`);
    }
    for (const f of Array.from(document.querySelectorAll('form'))) {
      if (f.hasAttribute('action') || f.hasAttribute('method') || f.getAttribute('autocomplete') !== 'off') fallas.push('form con action, method o sin autocomplete=off');
    }
    for (const b of Array.from(document.querySelectorAll('button'))) {
      if (b.getAttribute('type') !== 'button') fallas.push(`button sin type=button: ${b.textContent ?? ''}`);
    }
    if (document.querySelector('[contenteditable]')) fallas.push('contenteditable');
    for (const a of Array.from(document.querySelectorAll('a[href]'))) fallas.push(`a[href]: ${a.getAttribute('href') ?? ''}`);
    if (document.querySelector('[target="_blank"]')) fallas.push('target=_blank');
    if (document.querySelector('[style]')) fallas.push('atributo style');
    if (document.title !== 'Sig-Low') fallas.push(`título: ${document.title}`);
    return fallas;
  });
}

test.describe('T-IU-03 atributos de privacidad y título neutro', () => {
  test('T-IU-03 INV-D05: el documento servido fija idioma, traducción y título', async ({ page }) => {
    await abrirInicio(page);
    expect(await page.evaluate(() => document.documentElement.getAttribute('lang'))).toBe('es-CO');
    expect(await page.evaluate(() => document.documentElement.getAttribute('translate'))).toBe('no');
    expect(await page.evaluate(() => document.head.querySelector(':scope > meta[name="google"]')?.getAttribute('content'))).toBe('notranslate');
    expect(await page.evaluate(() => document.head.querySelector(':scope > meta[http-equiv="x-dns-prefetch-control"]')?.getAttribute('content'))).toBe('off');
    expect(await page.title()).toBe('Sig-Low');
  });

  test('T-IU-03 Cargar documento y lista de nombres: todo campo de texto cumple 8.7, sin form con envío, botones type=button, sin enlaces', async ({ page }) => {
    await abrirInicio(page);
    expect(await auditar(page)).toEqual([]);
    await pegarTexto(page, 'Texto ficticio de prueba.');
    expect(await auditar(page), 'Pegar texto').toEqual([]);
    // Con «Guardar» elegido (si la bóveda está conectada) aparecen los campos de frase; se auditan con «No guardar» y el diálogo de exportación.
    await crearAsunto(page);
    expect(await auditar(page)).toEqual([]);
    await editarLista(page);
    expect(await auditar(page), 'Nombres que siempre deben ocultarse').toEqual([]);
    await page.getByRole('textbox', { name: 'Texto de la lista' }).fill('Ana Ficticia Rojas; demandante');
    await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await page.getByRole('button', { name: 'Vista previa: Ana Ficticia Rojas' }).click();
    expect(await auditar(page)).toEqual([]);
    // Campos de frase (exportar con «No guardar» pide una frase nueva ×2).
    await page.getByRole('button', { name: 'Opciones del caso' }).click();
    await page.getByRole('button', { name: 'Guardar la llave para devolver los datos reales' }).click();
    await expect(page.getByRole('dialog', { name: 'Guardar la llave para devolver los datos reales' })).toBeVisible();
    expect(await page.locator('dialog[open] input[type="password"]').count()).toBe(2);
    expect(await auditar(page)).toEqual([]);
    await page.getByLabel('Contraseña de la llave. Mínimo 15 caracteres; puede usar varias palabras separadas por espacios.').fill('frase de prueba ficticia ñandú');
    await page.getByRole('button', { name: 'Mostrar' }).first().click();
    await expect(page.locator('dialog[open] input[type="text"]').first()).toBeVisible();
    expect(await auditar(page)).toEqual([]);
  });

  test('T-IU-03 INV-D05: soltar «Ana Ficticia Rojas.docx» fuera de la zona no cambia el título ni la URL', async ({ page }) => {
    await abrirInicio(page);
    const antes = page.url();
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['x'], 'Ana Ficticia Rojas.docx'));
      document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    expect(await page.title()).toBe('Sig-Low');
    expect(page.url()).toBe(antes);
    await expect(page.locator('body')).not.toContainText('Ana Ficticia Rojas.docx');
    await crearAsunto(page);
    expect(await page.title()).toBe('Sig-Low');
  });

  test('T-IU-03 INV-G02: la pantalla no usa rutas ni history.state; nada del asunto en el almacenamiento', async ({ page }) => {
    await abrirInicio(page);
    await crearAsunto(page, 'PRUEBA-003');
    await editarLista(page);
    await page.getByLabel('Nombre', { exact: true }).fill('Ana Ficticia Rojas');
    await page.getByRole('button', { name: 'Agregar', exact: true }).click();
    const r = await page.evaluate(async () => ({
      hash: location.hash,
      path: location.pathname,
      estado: JSON.stringify(history.state),
      local: Object.keys(globalThis.localStorage ?? {}).length + Object.keys(globalThis.sessionStorage ?? {}).length,
      cookies: document.cookie,
      caches: JSON.stringify(await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).map((q) => q.url)))),
      dbs: JSON.stringify((await indexedDB.databases()).map((d) => d.name)),
    }));
    expect(r.hash).toBe('');
    expect(r.path).toBe('/');
    expect(r.estado).toBe('null');
    expect(r.local).toBe(0);
    expect(r.cookies).toBe('');
    for (const texto of [r.caches, r.dbs]) {
      expect(texto).not.toContain('Ana Ficticia');
      expect(texto).not.toContain('PRUEBA-003');
    }
  });

  // D-23: el flujo por defecto abre un caso efímero en memoria (sin contraseña, sin guardar). Con él, tras analizar, nada del documento ni
  // del caso queda en ningún almacenamiento persistente (IndexedDB, local, sesión, cookies, Cache Storage), en la URL, el historial ni el título.
  test('T-IU-03 INV-G02 INV-V07 flujo por defecto (caso efímero): nada del documento ni del caso en IndexedDB, localStorage, sessionStorage, cookies, Cache Storage, URL ni título', async ({ page }) => {
    await abrirInicio(page);
    await pegarTexto(page, 'Cédula 1.000.000.017, correo ana.ficticia@ejemplo.test, teléfono 3000000017. Firmó la señora Ana Ficticia Rojas.');
    await anonimizar(page);
    await expect(etiquetas(page).first()).toBeVisible();
    const v = await volcarAlmacenamiento(page);
    for (const secreto of ['Ficticia', 'Rojas', '1.000.000.017', 'ana.ficticia', '3000000017', 'DOC-']) expect(textoDelVolcado(v), secreto).not.toContain(secreto);
    expect(v.indexedDB).toEqual({});
    expect(v.localStorage).toEqual({});
    expect(v.sessionStorage).toEqual({});
    expect(v.cookies).toEqual([]);
    expect(v.title).toBe('Sig-Low');
    expect(new URL(v.url).search + new URL(v.url).hash).toBe('');
    expect(await page.evaluate(() => JSON.stringify(history.state))).toBe('null');
    expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
  });
});

const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

test.describe('T-PV-09 «Acerca de»: versión, SHA-256 y dirección oficial', () => {
  /** Espera a que el service worker de PD-1 deje en Cache Storage index.html («/») y la lista de precache (3.2). */
  async function sembrarCache(page: Page): Promise<void> {
    await page.evaluate(async () => {
      for (let i = 0; i < 300; i += 1) {
        if ((await caches.match('/')) && (await caches.match('/precache.json'))) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('el service worker no dejó la caché de la app');
    });
  }
  async function abrirAcerca(page: Page) {
    await page.getByRole('button', { name: 'Acerca de' }).click();
    const d = page.getByRole('dialog', { name: 'Acerca de Sig-Low' });
    await expect(d).toBeVisible();
    return d;
  }

  test('T-PV-09 @humo M-150 y M-151 coinciden con sha256sum de dist/index.html y de la lista de precache', async ({ page }) => {
    await abrirInicio(page);
    await sembrarCache(page);
    const esperadoIndex = sha256(readFileSync('dist/index.html'));
    const dialogo = await abrirAcerca(page);
    await expect(dialogo.locator('[data-prueba="acerca-index"]')).toHaveText(`Código de esta versión (SHA-256 de index.html): ${esperadoIndex}`);
    await expect(dialogo.locator('[data-prueba="acerca-precache"]')).toHaveText(
      `Código de la lista de archivos para uso sin conexión (SHA-256): ${sha256(readFileSync('dist/precache.json'))}`,
    );
    await expect(dialogo).toContainText('Versión 1.1.0');
    await expect(dialogo.locator('[data-prueba="acerca-direccion"]')).toHaveText('Dirección oficial: sig-low.vergarameloabogado.site');
    await expect(dialogo).toContainText('Esta misma copia de Sig-Low calcula estos códigos');
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(h1(page, 'Cargar documento')).toBeVisible();
    // El pie muestra la compilación de 12 hexadecimales (igual a app.compilacion de 6.8).
    await expect(page.locator('[data-prueba="version"]')).toHaveText('Versión 1.1.0 · compilación ' + esperadoIndex.slice(0, 12), { timeout: 5000 });
  });

  test('T-PV-09 @humo «Acerca de» trae el aviso de privacidad de los registros del alojamiento, como texto y sin enlaces (D-09)', async ({ page }) => {
    await abrirInicio(page);
    const dialogo = await abrirAcerca(page);
    const aviso = dialogo.locator('[data-prueba="acerca-aviso"]');
    await expect(aviso).toBeVisible();
    await expect(aviso.getByRole('heading', { name: 'Aviso de privacidad' })).toBeVisible();
    await expect(aviso).toContainText('dirección IP');
    await expect(aviso).toContainText('encargado del tratamiento');
    await expect(aviso).toContainText('docs/legal/politica-de-privacidad.md');
    expect(await aviso.locator('a, [href], [target]').count()).toBe(0);
  });

  test('T-PV-09 con la caché vacía «Acerca de» dice «No disponible» (M-154)', async ({ page }) => {
    await abrirInicio(page);
    await page.evaluate(async () => { for (const k of await caches.keys()) await caches.delete(k); });
    const dialogo = await abrirAcerca(page);
    await expect(dialogo.locator('[data-prueba="acerca-index"]')).toHaveText('Código de esta versión (SHA-256 de index.html): No disponible');
    await expect(dialogo.locator('[data-prueba="acerca-precache"]')).toHaveText(
      'Código de la lista de archivos para uso sin conexión (SHA-256): No disponible',
    );
  });

  test('T-PV-09 el cálculo no hace ninguna petición de red', async ({ page }) => {
    await abrirInicio(page);
    await sembrarCache(page);
    const peticiones: string[] = [];
    page.on('request', (r) => peticiones.push(r.url()));
    await abrirAcerca(page);
    await expect(page.locator('[data-prueba="acerca-index"]')).toContainText(sha256(readFileSync('dist/index.html')));
    expect(peticiones).toEqual([]);
  });
});

// T-PV-03 (PC-4, V-29): Ctrl+F y F3 abren la búsqueda de la app con `preventDefault`, y buscar no hace ninguna petición. Es el
// flujo real (pegar → Analizando → Vista previa → «Revisar dato por dato»), sin gancho de prueba ni modelo. v1.1: la búsqueda propia vive en
// «Revisar dato por dato» (la antigua Revisión).
test.describe('T-PV-03 búsqueda propia en Revisar dato por dato (V-29)', () => {
  test.describe.configure({ timeout: 60_000 });

  const DOC = 'La señora Ana Ficticia Rojas firmó el oficio. Su correo es ana.ficticia@ejemplo.test.';
  const registrarTeclas = (page: Page): Promise<void> => page.evaluate(() => {
    (globalThis as unknown as { __bf: boolean[] }).__bf = [];
    addEventListener('keydown', (e) => {
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') || e.key === 'F3') (globalThis as unknown as { __bf: boolean[] }).__bf.push(e.defaultPrevented);
    });
  });
  const teclasPrevenidas = (page: Page): Promise<boolean[]> => page.evaluate(() => (globalThis as unknown as { __bf: boolean[] }).__bf);

  test('T-PV-03 Ctrl+F y F3 abren la búsqueda de la app (el navegador no las recibe) y buscar no hace peticiones', async ({ page }) => {
    await abrirInicio(page);
    await pegarTexto(page, DOC);
    await anonimizar(page);
    await aDetalle(page);

    const campo = page.getByRole('textbox', { name: 'Buscar en el documento' });
    await expect(campo).toBeVisible();
    await registrarTeclas(page);
    const peticiones: string[] = [];
    page.on('request', (r) => peticiones.push(r.url()));

    // Ctrl+F con el foco en otro control: abre y enfoca la búsqueda de la app.
    await page.getByRole('button', { name: 'Cómo leer la vista previa' }).focus();
    await page.keyboard.press('Control+f');
    await expect(campo).toBeFocused();
    await campo.fill('ficticia');
    await expect(page.locator('[data-prueba="busqueda-estado"]')).toHaveText(/^1 de \d+$/);
    // F3 desde otro control vuelve a la búsqueda de la app y selecciona lo escrito.
    await page.getByRole('button', { name: 'Cómo leer la vista previa' }).focus();
    await page.keyboard.press('F3');
    await expect(campo).toBeFocused();
    expect(await campo.evaluate((el) => (el as HTMLInputElement).selectionEnd! - (el as HTMLInputElement).selectionStart!)).toBe('ficticia'.length);

    // Los manejadores de la página corren antes que el de la prueba (captura vs. burbuja): ambos eventos ya llegaron prevenidos.
    expect(await teclasPrevenidas(page)).toEqual([true, true]);
    expect(peticiones).toEqual([]);
  });
});

// ===== PC-7 · superficie de privacidad de toda la interfaz integrada: T-IU-03 (resto de pantallas), T-PV-01, T-PV-02, T-PV-11, T-PV-24 =====
test.describe('PC-7 superficie de privacidad del flujo integrado', () => {
  test.describe.configure({ timeout: 150_000 });
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  /** Cargar con el texto dado (y la lista de nombres de la demo) hasta la Vista previa, con todo ya aceptado (D-24). */
  async function hastaRevision(page: Page, documento: string, codigo: string): Promise<void> {
    await abrirInicio(page);
    await crearAsunto(page, codigo);
    await editarLista(page);
    await pegarLista(page, LISTA_REI);
    await pegarTexto(page, documento);
    await anonimizar(page);
  }
  /** Vista previa → Descargar (nada que decidir: la vista previa ya trae todo aceptado, D-24). */
  async function decidirYContinuar(page: Page): Promise<void> {
    await aDescargar(page);
  }
  const eventoPrevenido = (page: Page, selector: string, tipo: 'contextmenu' | 'copy'): Promise<{ prevenido: boolean; datos: string }> =>
    page.locator(selector).first().evaluate((el, t) => {
      const dt = new DataTransfer();
      const ev = t === 'copy' ? new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dt }) : new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      return { prevenido: ev.defaultPrevented, datos: dt.getData('text/plain') };
    }, tipo);

  test('T-IU-03 cada pantalla del flujo (Cargar, Vista previa con menú, Revisar dato por dato con ficha, Descargar, Devolver los datos reales) cumple 8.7: atributos, ids neutros, sin enlaces ni style', async ({ page }) => {
    await page.addInitScript(() => {
      (globalThis as unknown as { __csp: string[] }).__csp = [];
      addEventListener('securitypolicyviolation', (e) => { (globalThis as unknown as { __csp: string[] }).__csp.push(e.violatedDirective); });
    });
    // La virtualización de la revisión fija alturas y posiciones con CSSOM (permitido por la CSP, que no admite atributos style escritos en el HTML):
    // el atributo se refleja en el DOM, así que el criterio es 0 violaciones de la CSP, no 0 atributos style.
    const auditarSinStyle = async (): Promise<string[]> => (await auditar(page)).filter((x) => x !== 'atributo style');
    await hastaRevision(page, DOCUMENTO_REI, 'PRUEBA-PV-03');
    expect(await auditarSinStyle(), 'Vista previa').toEqual([]);
    for (const el of await page.locator('[data-prueba="vista-previa"]').all()) {
      await expect(el).toHaveAttribute('translate', 'no');
      await expect(el).toHaveAttribute('spellcheck', 'false');
    }
    // Menú de una etiqueta: sus campos («Cambiar a…», «Editar el texto…») también cumplen 8.7.
    await etiquetas(page).first().click();
    await expect(page.locator('[data-prueba="menu-etiqueta"]')).toBeVisible();
    expect(await auditarSinStyle(), 'Vista previa con menú de la etiqueta').toEqual([]);
    await page.getByRole('button', { name: 'Editar el texto de la etiqueta' }).click();
    await expect(page.getByRole('textbox', { name: 'Texto que reemplaza el dato' })).toBeVisible();
    expect(await auditarSinStyle(), 'Editar el texto de la etiqueta').toEqual([]);
    await page.keyboard.press('Escape');
    // Revisar dato por dato (la Revisión de la v1.0), con la ficha de un dato.
    await aDetalle(page);
    expect(await auditarSinStyle(), 'Revisar dato por dato').toEqual([]);
    await page.getByRole('region', { name: 'Documento con datos encontrados' }).locator('[data-det]').first().click();
    await expect(page.getByRole('region', { name: 'Ficha del dato encontrado' })).toBeVisible();
    expect(await auditarSinStyle(), 'Revisar dato por dato con ficha').toEqual([]);
    for (const el of await page.locator('.panel-texto, .ficha, .ficha-entidad, .cuadricula-borde').all()) {
      await expect(el).toHaveAttribute('translate', 'no');
      await expect(el).toHaveAttribute('spellcheck', 'false');
    }
    await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Vista previa' })).toBeVisible();
    await decidirYContinuar(page);
    expect(await auditarSinStyle(), 'Descargar').toEqual([]);
    await copiarEnListo(page);
    await abrirAvanzadas(page);
    await page.getByRole('button', { name: 'Devolver los datos reales a un texto' }).click();
    await expect(h1(page, 'Devolver los datos reales')).toBeVisible();
    expect(await auditar(page), 'Devolver los datos reales').toEqual([]);
    await page.getByRole('textbox', { name: 'Respuesta de la herramienta de IA' }).fill(SALIDA_REI);
    await page.getByRole('button', { name: 'Buscar etiquetas' }).click();
    await expect(page.locator('[data-prueba="resultado-real"]')).toBeVisible();
    await expect(page.locator('[data-prueba="resultado-real"]')).toHaveAttribute('translate', 'no');
    expect(await auditarSinStyle(), 'Devolver los datos reales con resultado').toEqual([]);
    expect(await page.evaluate(() => (globalThis as unknown as { __csp: string[] }).__csp), 'violaciones de la CSP').toEqual([]);
  });

  test('T-PV-01 sin enlaces, ventanas ni precarga: ninguna pantalla trae a[href], target, link externo ni form con envío, y window.open no abre nada', async ({ page, context }) => {
    const ventanas: string[] = [];
    context.on('page', (p) => ventanas.push(p.url()));
    const sinEnlaces = async (donde: string): Promise<void> => {
      const r = await page.evaluate(() => ({
        enlaces: document.querySelectorAll('a[href]').length,
        destinos: document.querySelectorAll('[target]').length,
        links: [...document.querySelectorAll('link[rel]')].filter((l) => /dns-prefetch|preconnect|prefetch|prerender|preload/.test(l.getAttribute('rel') ?? '')).length,
        formularios: [...document.querySelectorAll('form')].filter((f) => f.hasAttribute('action') || f.hasAttribute('method')).length,
        externos: [...document.querySelectorAll('[src], [href], [action], [formaction]')].filter((e) => /^(https?:|\/\/|mailto:|tel:|javascript:)/i.test(e.getAttribute('src') ?? e.getAttribute('href') ?? e.getAttribute('action') ?? e.getAttribute('formaction') ?? '')).length,
      }));
      expect(r, donde).toEqual({ enlaces: 0, destinos: 0, links: 0, formularios: 0, externos: 0 });
    };
    await abrirInicio(page);
    await sinEnlaces('Cargar documento');
    await page.getByRole('button', { name: 'Acerca de' }).click();
    await sinEnlaces('Acerca de');
    await page.getByRole('dialog', { name: 'Acerca de Sig-Low' }).getByRole('button', { name: 'Créditos y licencias' }).click();
    await sinEnlaces('Créditos y licencias');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await crearCaso(page, { codigo: 'PRUEBA-PV-01' });
    await editarLista(page);
    await sinEnlaces('Nombres que siempre deben ocultarse');
    await pegarLista(page, LISTA_REI);
    await pegarTexto(page, DOCUMENTO_REI);
    await anonimizar(page);
    await sinEnlaces('Vista previa');
    await aDetalle(page);
    await sinEnlaces('Revisar dato por dato');
    await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
    await aDescargar(page);
    await sinEnlaces('Descargar');
    await copiarEnListo(page);
    await abrirAvanzadas(page);
    await page.getByRole('button', { name: 'Devolver los datos reales a un texto' }).click();
    await expect(h1(page, 'Devolver los datos reales')).toBeVisible();
    await sinEnlaces('Devolver los datos reales');
    // guard.ts neutraliza window.open: no devuelve ventana y no se abre ninguna.
    const abierta = await page.evaluate(() => { try { return window.open('about:blank', '_blank') === null; } catch { return true; } });
    expect(abierta).toBe(true);
    expect(ventanas).toEqual([]);
  });

  test('T-PV-02 HTML y javascript: pegados quedan literales en la Vista previa, en Revisar dato por dato, en Descargar y en Devolver los datos reales: ningún nodo, ningún script', async ({ page }) => {
    const HOSTIL = 'Señora Ana Ficticia Rojas, cédula 1.000.000.001. <img src=x onerror="window.__xss=1"> <script>window.__xss=2</script> <a href="javascript:window.__xss=3">enlace</a> javascript:window.__xss=4';
    await hastaRevision(page, HOSTIL, 'PRUEBA-PV-02');
    const peligrosos = () => page.evaluate(() => ({
      nodos: document.querySelectorAll('main img, main iframe, main object, main embed, main a[href], main script, main svg script').length,
      xss: (globalThis as unknown as { __xss?: number }).__xss ?? null,
    }));
    const vista = vistaPrevia(page);
    await expect(vista).toContainText('<img src=x onerror="window.__xss=1">');
    await expect(vista).toContainText('<script>window.__xss=2</script>');
    await expect(vista).toContainText('javascript:window.__xss=4');
    expect(await peligrosos(), 'Vista previa').toEqual({ nodos: 0, xss: null });
    await aDetalle(page);
    const panel = page.getByRole('region', { name: 'Documento con datos encontrados' });
    await expect(panel).toContainText('<img src=x onerror="window.__xss=1">');
    await expect(panel).toContainText('<script>window.__xss=2</script>');
    await expect(panel).toContainText('javascript:window.__xss=4');
    expect(await peligrosos(), 'Revisar dato por dato').toEqual({ nodos: 0, xss: null });
    await page.getByRole('button', { name: 'Ver documento anonimizado' }).click();
    await expect(page.getByRole('region', { name: 'Documento con las etiquetas como fichas' })).toContainText('<script>window.__xss=2</script>');
    expect(await peligrosos(), 'Ver documento anonimizado').toEqual({ nodos: 0, xss: null });
    await page.getByRole('button', { name: 'Ver original' }).click();
    await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
    await decidirYContinuar(page);
    expect(await peligrosos(), 'Descargar').toEqual({ nodos: 0, xss: null });
    await copiarEnListo(page);
    await abrirAvanzadas(page);
    await page.getByRole('button', { name: 'Devolver los datos reales a un texto' }).click();
    await expect(h1(page, 'Devolver los datos reales')).toBeVisible();
    const respuesta = '[DEMANDANTE_1] respondió: <img src=x onerror="window.__xss=5"> <iframe src="javascript:window.__xss=6"></iframe> javascript:window.__xss=7 [CC_1]';
    await page.getByRole('textbox', { name: 'Respuesta de la herramienta de IA' }).fill(respuesta);
    await page.getByRole('button', { name: 'Buscar etiquetas' }).click();
    await expect(page.locator('[data-prueba="resultado-real"]')).toContainText('<iframe src="javascript:window.__xss=6"></iframe>');
    expect(await peligrosos(), 'Devolver los datos reales').toEqual({ nodos: 0, xss: null });
  });

  // v1.1 (D-24): la vista de salida de Descargar ya no existe; la salida se selecciona y se copia desde la Vista previa, y Ctrl+C pasa por la
  // puerta de la descarga (INV-X05): con la puerta cerrada no copia nada y deja el aviso M-73; con la puerta abierta copia solo text/plain.
  test('T-PV-11 menú contextual bloqueado en los contenedores de solo lectura y no en los campos; con la puerta cerrada la Vista previa no se copia (M-73) y con la puerta abierta copia solo texto plano anonimizado', async ({ page, context }) => {
    await hastaRevision(page, DOCUMENTO_REI, 'PRUEBA-PV-11');
    // Los campos de texto conservan su menú (la persona lo necesita para pegar); los contenedores del documento no.
    expect((await eventoPrevenido(page, '[data-prueba="vista-previa"]', 'contextmenu')).prevenido, 'vista previa').toBe(true);
    // Puerta cerrada (la confirmación única sin marcar): copy prevenido, vacío y con el aviso M-73 en Descargar.
    const copiaCerrada = await eventoPrevenido(page, '[data-prueba="vista-previa"]', 'copy');
    expect(copiaCerrada.prevenido, 'copy con la puerta cerrada').toBe(true);
    expect(copiaCerrada.datos, 'la copia con la puerta cerrada no escribe nada').toBe('');
    await aDescargar(page);
    await expect(page.locator('[data-aviso="M-73"]')).toBeVisible();
    // Puerta abierta: se confirma, se vuelve a la Vista previa y se copia un tramo del texto anonimizado con Ctrl+C.
    await confirmar(page);
    await page.getByRole('button', { name: 'Volver a la vista previa' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Vista previa' })).toBeVisible();
    await page.evaluate(() => {
      const bloque = document.querySelector('[data-prueba="vista-previa"] p.bloque') as HTMLElement;
      const r = document.createRange();
      r.selectNodeContents(bloque);
      const sel = getSelection() as Selection;
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.locator('[data-prueba="vista-previa"]').focus();
    await page.keyboard.press('Control+C');
    const copiado = await leerPortapapeles(context);
    expect(copiado.tipos, 'solo text/plain').toEqual(['text/plain']);
    for (const real of REALES_REI) expect(copiado.texto, `portapapeles con «${real}»`).not.toContain(real);
    expect(copiado.texto).toContain('[DEMANDANTE_1]');
    await page.bringToFront();
    await aDescargar(page);
    await copiarEnListo(page);
    await abrirAvanzadas(page);
    await page.getByRole('button', { name: 'Devolver los datos reales a un texto' }).click();
    await page.getByRole('textbox', { name: 'Respuesta de la herramienta de IA' }).fill(SALIDA_REI);
    await page.getByRole('button', { name: 'Buscar etiquetas' }).click();
    await expect(page.locator('[data-prueba="resultado-real"]')).toBeVisible();
    expect((await eventoPrevenido(page, '[data-prueba="resultado-real"]', 'contextmenu')).prevenido, 'resultado de Devolver los datos reales').toBe(true);
    // El campo de la respuesta no bloquea el menú contextual.
    expect((await eventoPrevenido(page, 'textarea', 'contextmenu')).prevenido, 'campo de texto').toBe(false);
  });

  /** Escribe en el portapapeles del sistema desde una página auxiliar de otro origen (la de `leerPortapapeles`). */
  async function escribirPortapapeles(context: import('@playwright/test').BrowserContext, texto: string): Promise<void> {
    const origenAux = 'https://auxiliar.ejemplo.test';
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: origenAux });
    await context.route(`${origenAux}/**`, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>auxiliar</title><p>auxiliar</p>' }));
    const aux = await context.newPage();
    try {
      await aux.goto(`${origenAux}/`);
      await aux.bringToFront();
      await aux.evaluate(async (t) => { await navigator.clipboard.writeText(t); }, texto);
    } finally {
      await aux.close();
    }
  }

  test('T-PV-11 INV-X05 A-30: Ctrl+A y Ctrl+C, o una selección que empieza fuera de la vista previa, pasan por la puerta: cerrada no copian nada; abierta, solo el texto de la vista en text/plain', async ({ page, context }) => {
    await hastaRevision(page, DOCUMENTO_REI, 'PRUEBA-PV-A30');
    // Puerta cerrada (confirmación sin marcar). Ctrl+A con el foco en la página: el evento va a la página, no al documento.
    await escribirPortapapeles(context, 'VACIO');
    await page.bringToFront();
    await page.getByRole('heading', { level: 1, name: 'Vista previa' }).click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Control+C');
    expect((await leerPortapapeles(context)).texto, 'Ctrl+A y Ctrl+C con la puerta cerrada').toBe('VACIO');
    // Una selección que empieza en la ayuda de arriba y termina dentro del documento.
    await page.bringToFront();
    await page.evaluate(() => {
      const ayuda = document.querySelector('.vista-previa > p.ayuda') as HTMLElement;
      const bloque = document.querySelector('[data-prueba="vista-previa"] p.bloque') as HTMLElement;
      const r = document.createRange();
      r.setStart(ayuda.firstChild as Node, 0);
      r.setEnd(bloque, bloque.childNodes.length);
      const sel = getSelection() as Selection;
      sel.removeAllRanges();
      sel.addRange(r);
      (document.querySelector('h1') as HTMLElement).focus();
    });
    await page.keyboard.press('Control+C');
    expect((await leerPortapapeles(context)).texto, 'selección que empieza fuera, con la puerta cerrada').toBe('VACIO');
    // Puerta abierta: Ctrl+A copia solo el texto de la vista previa (nunca la ayuda ni los botones), en text/plain.
    await page.bringToFront();
    await aDescargar(page);
    await confirmar(page);
    await page.getByRole('button', { name: 'Volver a la vista previa' }).click();
    await page.getByRole('heading', { level: 1, name: 'Vista previa' }).click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Control+C');
    const abierta = await leerPortapapeles(context);
    expect(abierta.tipos, 'solo text/plain').toEqual(['text/plain']);
    expect(abierta.texto).toContain('[DEMANDANTE_1]');
    expect(abierta.texto, 'sin la ayuda de la pantalla').not.toContain('Así quedará su documento');
    expect(abierta.texto, 'sin los botones').not.toContain('Continuar a descargar');
    for (const real of REALES_REI) expect(abierta.texto, `portapapeles con «${real}»`).not.toContain(real);
  });

  test('T-PV-11 INV-X05 A-31: tras Ctrl+A, arrastrar desde el título (fuera de la vista previa) no lleva la vista previa, y el menú contextual no ofrece copiarla', async ({ page }) => {
    await hastaRevision(page, DOCUMENTO_REI, 'PRUEBA-PV-A31');
    // Registro en la fase de burbuja de la ventana: corre después de cualquier manejador en captura.
    await page.evaluate(() => {
      const w = globalThis as unknown as { __a31: string[] };
      w.__a31 = [];
      addEventListener('dragstart', (e) => { w.__a31.push(`dragstart:${e.defaultPrevented ? 'prevenido' : 'NO'}`); });
      addEventListener('contextmenu', (e) => { w.__a31.push(`contextmenu:${e.defaultPrevented ? 'prevenido' : 'NO'}`); });
    });
    const titulo = page.getByRole('heading', { level: 1, name: 'Vista previa' });
    await titulo.click();
    await page.keyboard.press('Control+A');
    const caja = await titulo.boundingBox();
    if (caja === null) throw new Error('sin caja del título');
    await page.mouse.move(caja.x + 20, caja.y + caja.height / 2);
    await page.mouse.down();
    await page.mouse.move(caja.x + 220, caja.y + caja.height / 2 + 160, { steps: 8 });
    await page.mouse.up();
    // El menú contextual sobre el título, con la selección que toca la vista previa (el arrastre bloqueado la deshizo: otra vez Ctrl+A).
    await page.keyboard.press('Control+A');
    expect(await page.evaluate(() => getSelection()?.isCollapsed), 'selección de toda la página').toBe(false);
    await titulo.evaluate((el) => { el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    const registro = await page.evaluate(() => (globalThis as unknown as { __a31: string[] }).__a31);
    expect(registro.some((x) => x.startsWith('dragstart:')), 'hubo un arrastre').toBe(true);
    expect(registro.filter((x) => x.endsWith(':NO')), 'arrastre o menú sin prevenir').toEqual([]);
  });

  test('T-PV-11 A-30: en las páginas de un PDF el lienzo no ofrece menú contextual ni se arrastra (ni «Copiar imagen» ni «Guardar imagen como»)', async ({ page }) => {
    await abrirInicio(page);
    await page.locator('input[type=file]').setInputFiles('corpus/docs/C03.pdf');
    await expect(page.locator('[data-prueba="archivo-cargado"]')).toBeVisible({ timeout: 60_000 });
    await anonimizar(page);
    const lienzo = page.locator('[data-prueba="paginas-pdf"] canvas').first();
    await expect(lienzo).toBeAttached({ timeout: 60_000 });
    for (const tipo of ['contextmenu', 'dragstart'] as const) {
      const prevenido = await lienzo.evaluate((el, t) => {
        const ev = t === 'contextmenu' ? new MouseEvent('contextmenu', { bubbles: true, cancelable: true }) : new DragEvent('dragstart', { bubbles: true, cancelable: true });
        el.dispatchEvent(ev);
        return ev.defaultPrevented;
      }, tipo);
      expect(prevenido, `${tipo} sobre el lienzo`).toBe(true);
    }
  });

  test('T-PV-11 menú contextual bloqueado en los contenedores de Revisar dato por dato (panel de texto, cuadrícula, ficha, vista de salida)', async ({ page }) => {
    await hastaRevision(page, DOCUMENTO_REI, 'PRUEBA-PV-11B');
    await aDetalle(page);
    expect((await eventoPrevenido(page, '[data-prueba="panel-texto"]', 'contextmenu')).prevenido, 'panel de texto').toBe(true);
    expect((await eventoPrevenido(page, '[data-prueba="cuadricula"]', 'contextmenu')).prevenido, 'cuadrícula (contexto de menciones)').toBe(true);
    await page.getByRole('region', { name: 'Documento con datos encontrados' }).locator('[data-det]').first().click();
    expect((await eventoPrevenido(page, '[data-prueba="ficha"]', 'contextmenu')).prevenido, 'ficha').toBe(true);
    await page.getByRole('button', { name: 'Ver documento anonimizado' }).click();
    expect((await eventoPrevenido(page, '[data-prueba="panel-texto"]', 'contextmenu')).prevenido, 'vista de salida de la revisión').toBe(true);
    const copiaRevisionSalida = await eventoPrevenido(page, '[data-prueba="panel-texto"]', 'copy');
    expect(copiaRevisionSalida.datos, 'la copia de la salida en la revisión no escribe originales').not.toMatch(/Ficticia|1\.000\.000|ejemplo\.test/);
  });

  test('T-PV-24 ni la Vista previa, ni Descargar ni Devolver los datos reales (antes de pegar) muestran o copian la llave en claro', async ({ page, context }) => {
    const cuerpo = async (): Promise<string> => page.evaluate(() => document.body.innerText + '\n' + [...document.querySelectorAll('[aria-label],[title]')].map((e) => `${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('title') ?? ''}`).join('\n'));
    await hastaRevision(page, DOCUMENTO_REI, 'PRUEBA-PV-24');
    for (const real of REALES_REI) expect(await cuerpo(), `Vista previa con «${real}»`).not.toContain(real);
    await aDescargar(page);
    for (const real of REALES_REI) expect(await cuerpo(), `Descargar con «${real}»`).not.toContain(real);
    await copiarEnListo(page);
    const portapapeles = await leerPortapapeles(context);
    for (const real of REALES_REI) expect(portapapeles.texto, `portapapeles con «${real}»`).not.toContain(real);
    await abrirAvanzadas(page);
    await page.getByRole('button', { name: 'Devolver los datos reales a un texto' }).click();
    await expect(h1(page, 'Devolver los datos reales')).toBeVisible();
    for (const real of REALES_REI) expect(await cuerpo(), `Devolver los datos reales con «${real}»`).not.toContain(real);
  });

  // D-23: con el flujo por defecto (caso efímero, sin lista de nombres) lo que Sig-Low detecta tampoco aparece en la pantalla, en los
  // nombres accesibles, en los títulos, en la URL ni en el portapapeles.
  test('T-PV-24 flujo por defecto (caso efímero): lo detectado no aparece en la Vista previa, Descargar, nombres accesibles, título, URL ni portapapeles', async ({ page, context }) => {
    const detectados = ['1.000.000.017', 'ana.ficticia@ejemplo.test', '3000000017'];
    const cuerpo = async (): Promise<string> => page.evaluate(() => document.body.innerText + '\n' + [...document.querySelectorAll('[aria-label],[title]')].map((e) => `${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('title') ?? ''}`).join('\n') + '\n' + document.title + '\n' + location.href);
    await abrirInicio(page);
    await pegarTexto(page, 'Cédula 1.000.000.017, correo ana.ficticia@ejemplo.test, teléfono 3000000017.');
    await anonimizar(page);
    for (const real of detectados) expect(await cuerpo(), `Vista previa con «${real}»`).not.toContain(real);
    await aDescargar(page);
    for (const real of detectados) expect(await cuerpo(), `Descargar con «${real}»`).not.toContain(real);
    await copiarEnListo(page);
    const portapapeles = await leerPortapapeles(context);
    for (const real of detectados) expect(portapapeles.texto, `portapapeles con «${real}»`).not.toContain(real);
    await page.bringToFront();
    for (const real of detectados) expect(await cuerpo(), `Descargar tras copiar con «${real}»`).not.toContain(real);
  });
});
