import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { copiarEnListo, crearYAnalizar, DOCUMENTO_REI, LISTA_REI, REALES_REI, SALIDA_REI, leerPortapapeles } from './ayudas-reinsercion';

// T-IU-03 (atributos de privacidad, título neutro) y T-PV-09 («Acerca de»: versión, SHA-256 y dirección oficial), de PC-1.
// PC-7 y las demás tareas agregan aquí los casos T-PV-01, T-PV-02, T-PV-11, T-PV-24 sobre el resto de las pantallas.

const h1 = (page: Page, nombre: string) => page.getByRole('heading', { level: 1, name: nombre });

async function abrirInicio(page: Page): Promise<void> {
  await page.goto('/');
  // La primera visita espera el precache del SW (8.1: «sin tiempo límite»; ≈ 1,5 s con el equipo cargado).
  await expect(h1(page, 'Inicio')).toBeVisible({ timeout: 30_000 });
}
async function crearAsunto(page: Page, codigo = 'PRUEBA-001'): Promise<void> {
  await page.getByLabel('Código del asunto').fill(codigo);
  await page.getByRole('radio', { name: /^No guardar la tabla/ }).check();
  await page.getByRole('button', { name: 'Crear asunto' }).click();
  await expect(h1(page, 'Lista del caso')).toBeVisible();
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

  test('T-IU-03 Inicio y Lista del caso: todo campo de texto cumple 8.7, sin form con envío, botones type=button, sin enlaces', async ({ page }) => {
    await abrirInicio(page);
    expect(await auditar(page)).toEqual([]);
    // Con «Guardar» elegido (si la bóveda está conectada) aparecen los campos de frase; se auditan con «No guardar» y el diálogo de exportación.
    await crearAsunto(page);
    expect(await auditar(page)).toEqual([]);
    await page.getByRole('textbox', { name: 'Texto de la lista' }).fill('Ana Ficticia Rojas; demandante');
    await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await page.getByRole('button', { name: 'Vista previa: Ana Ficticia Rojas' }).click();
    expect(await auditar(page)).toEqual([]);
    // Campos de frase (exportar con «No guardar» pide una frase nueva ×2).
    await page.getByRole('button', { name: 'Menú del asunto' }).click();
    await page.getByRole('button', { name: 'Exportar tabla cifrada' }).click();
    await expect(page.getByRole('dialog', { name: 'Exportar tabla cifrada' })).toBeVisible();
    expect(await page.locator('dialog[open] input[type="password"]').count()).toBe(2);
    expect(await auditar(page)).toEqual([]);
    await page.getByLabel('Frase de paso. Mínimo 15 caracteres; puede usar varias palabras separadas por espacios.').fill('frase de prueba ficticia ñandú');
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
    await expect(dialogo.locator('[data-prueba="acerca-index"]')).toHaveText(`Código de compilación (SHA-256 de index.html): ${esperadoIndex}`);
    await expect(dialogo.locator('[data-prueba="acerca-precache"]')).toHaveText(
      `Código de la lista de archivos (SHA-256 de la lista de precache): ${sha256(readFileSync('dist/precache.json'))}`,
    );
    await expect(dialogo).toContainText('Versión 1.0.0');
    await expect(dialogo.locator('[data-prueba="acerca-direccion"]')).toHaveText('Dirección oficial: sig-low.vergarameloabogado.site');
    await expect(dialogo).toContainText('Esta misma copia de Sig-Low calcula estos códigos');
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(h1(page, 'Inicio')).toBeVisible();
    // El pie muestra la compilación de 12 hexadecimales (igual a app.compilacion de 6.8).
    await expect(page.locator('[data-prueba="version"]')).toHaveText('Versión 1.0.0 · compilación ' + esperadoIndex.slice(0, 12), { timeout: 5000 });
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
    await expect(dialogo.locator('[data-prueba="acerca-index"]')).toHaveText('Código de compilación (SHA-256 de index.html): No disponible');
    await expect(dialogo.locator('[data-prueba="acerca-precache"]')).toHaveText(
      'Código de la lista de archivos (SHA-256 de la lista de precache): No disponible',
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
// flujo real (pegar → Procesando → Revisión), sin gancho de prueba ni modelo.
test.describe('T-PV-03 búsqueda propia en Revisión (V-29)', () => {
  test.describe.configure({ timeout: 60_000 });

  test('T-PV-03 Ctrl+F y F3 abren la búsqueda de la app (el navegador no las recibe) y buscar no hace peticiones', async ({ page }) => {
    await abrirInicio(page);
    await crearAsunto(page);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(h1(page, 'Entrada')).toBeVisible();
    await page.getByRole('textbox', { name: 'Texto del documento' }).fill('La señora Ana Ficticia Rojas firmó el oficio. Su correo es ana.ficticia@ejemplo.test.');
    await page.getByRole('button', { name: 'Analizar', exact: true }).click();
    await expect(h1(page, 'Revisión')).toBeVisible({ timeout: 30_000 });

    const campo = page.getByRole('textbox', { name: 'Buscar en el documento' });
    await expect(campo).toBeVisible();
    await page.evaluate(() => {
      (globalThis as unknown as { __bf: boolean[] }).__bf = [];
      addEventListener('keydown', (e) => {
        if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') || e.key === 'F3') (globalThis as unknown as { __bf: boolean[] }).__bf.push(e.defaultPrevented);
      });
    });
    const peticiones: string[] = [];
    page.on('request', (r) => peticiones.push(r.url()));

    // Ctrl+F con el foco en otro control: abre y enfoca la búsqueda de la app.
    await page.getByRole('button', { name: 'Leyenda' }).focus();
    await page.keyboard.press('Control+f');
    await expect(campo).toBeFocused();
    await campo.fill('ficticia');
    await expect(page.locator('[data-prueba="busqueda-estado"]')).toHaveText(/^1 de \d+$/);
    // F3 desde otro control vuelve a la búsqueda de la app y selecciona lo escrito.
    await page.getByRole('button', { name: 'Leyenda' }).focus();
    await page.keyboard.press('F3');
    await expect(campo).toBeFocused();
    expect(await campo.evaluate((el) => (el as HTMLInputElement).selectionEnd! - (el as HTMLInputElement).selectionStart!)).toBe('ficticia'.length);

    // Los manejadores de la página corren antes que el de la prueba (captura vs. burbuja): ambos eventos ya llegaron prevenidos.
    expect(await page.evaluate(() => (globalThis as unknown as { __bf: boolean[] }).__bf)).toEqual([true, true]);
    expect(peticiones).toEqual([]);
  });
});

// ===== PC-7 · superficie de privacidad de toda la interfaz integrada: T-IU-03 (resto de pantallas), T-PV-01, T-PV-02, T-PV-11, T-PV-24 =====
test.describe('PC-7 superficie de privacidad del flujo integrado', () => {
  test.describe.configure({ timeout: 150_000 });
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  /** Entrada con el texto dado hasta Revisión (sin decidir). */
  async function hastaRevision(page: Page, documento: string, codigo: string): Promise<void> {
    await abrirInicio(page);
    await crearAsunto(page, codigo);
    await page.getByRole('textbox', { name: 'Texto de la lista' }).fill(LISTA_REI);
    await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(h1(page, 'Entrada')).toBeVisible();
    await page.getByRole('textbox', { name: 'Texto del documento' }).fill(documento);
    await page.getByRole('button', { name: 'Analizar', exact: true }).click();
    await expect(h1(page, 'Revisión')).toBeVisible({ timeout: 60_000 });
  }
  /** Decide cada mención pendiente con el teclado (A) y pasa a Listo. */
  async function decidirYContinuar(page: Page): Promise<void> {
    const marcas = page.getByRole('region', { name: 'Documento con detecciones' }).locator('[data-det]');
    for (let i = 0, n = await marcas.count(); i < n; i++) {
      if (/, pendiente, /.test((await marcas.nth(i).getAttribute('aria-label')) ?? '')) { await marcas.nth(i).focus(); await page.keyboard.press('a'); }
    }
    await page.locator('[data-prueba="continuar"]').click();
    await expect(h1(page, 'Listo')).toBeVisible();
  }
  const eventoPrevenido = (page: Page, selector: string, tipo: 'contextmenu' | 'copy'): Promise<{ prevenido: boolean; datos: string }> =>
    page.locator(selector).first().evaluate((el, t) => {
      const dt = new DataTransfer();
      const ev = t === 'copy' ? new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dt }) : new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      return { prevenido: ev.defaultPrevented, datos: dt.getData('text/plain') };
    }, tipo);

  test('T-IU-03 cada pantalla del flujo (Entrada, Revisión con ficha, Listo, Reinserción) cumple 8.7: atributos, ids neutros, sin enlaces ni style', async ({ page }) => {
    await page.addInitScript(() => {
      (globalThis as unknown as { __csp: string[] }).__csp = [];
      addEventListener('securitypolicyviolation', (e) => { (globalThis as unknown as { __csp: string[] }).__csp.push(e.violatedDirective); });
    });
    // La virtualización de Revisión fija alturas y posiciones con CSSOM (permitido por la CSP, que no admite atributos style escritos en el HTML):
    // el atributo se refleja en el DOM, así que el criterio es 0 violaciones de la CSP, no 0 atributos style.
    const auditarSinStyle = async (): Promise<string[]> => (await auditar(page)).filter((x) => x !== 'atributo style');
    await hastaRevision(page, DOCUMENTO_REI, 'PRUEBA-PV-03');
    expect(await auditarSinStyle(), 'Revisión').toEqual([]);
    await page.getByRole('region', { name: 'Documento con detecciones' }).locator('[data-det]').first().click();
    await expect(page.getByRole('region', { name: 'Ficha de la detección' })).toBeVisible();
    expect(await auditarSinStyle(), 'Revisión con ficha').toEqual([]);
    for (const el of await page.locator('.panel-texto, .ficha, .ficha-entidad, .cuadricula-borde').all()) {
      await expect(el).toHaveAttribute('translate', 'no');
      await expect(el).toHaveAttribute('spellcheck', 'false');
    }
    await decidirYContinuar(page);
    expect(await auditarSinStyle(), 'Listo').toEqual([]);
    await copiarEnListo(page);
    for (const el of await page.locator('[data-prueba="vista-salida"]').all()) {
      await expect(el).toHaveAttribute('translate', 'no');
      await expect(el).toHaveAttribute('spellcheck', 'false');
    }
    await page.getByRole('button', { name: 'Reinsertar una respuesta' }).click();
    await expect(h1(page, 'Reinserción')).toBeVisible();
    expect(await auditar(page), 'Reinserción').toEqual([]);
    await page.getByRole('textbox', { name: 'Respuesta de la herramienta de IA' }).fill(SALIDA_REI);
    await page.getByRole('button', { name: 'Buscar marcadores' }).click();
    await expect(page.locator('[data-prueba="resultado-real"]')).toBeVisible();
    await expect(page.locator('[data-prueba="resultado-real"]')).toHaveAttribute('translate', 'no');
    expect(await auditarSinStyle(), 'Reinserción con resultado').toEqual([]);
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
    await sinEnlaces('Inicio');
    await page.getByRole('button', { name: 'Acerca de' }).click();
    await sinEnlaces('Acerca de');
    await page.getByRole('dialog', { name: 'Acerca de Sig-Low' }).getByRole('button', { name: 'Créditos y licencias' }).click();
    await sinEnlaces('Créditos y licencias');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await crearYAnalizar(page, { codigo: 'PRUEBA-PV-01' });
    await sinEnlaces('Listo');
    await copiarEnListo(page);
    await page.getByRole('button', { name: 'Reinsertar una respuesta' }).click();
    await expect(h1(page, 'Reinserción')).toBeVisible();
    await sinEnlaces('Reinserción');
    // guard.ts neutraliza window.open: no devuelve ventana y no se abre ninguna.
    const abierta = await page.evaluate(() => { try { return window.open('about:blank', '_blank') === null; } catch { return true; } });
    expect(abierta).toBe(true);
    expect(ventanas).toEqual([]);
  });

  test('T-PV-02 HTML y javascript: pegados quedan literales en Revisión, en la salida y en Reinserción: ningún nodo, ningún script', async ({ page }) => {
    const HOSTIL = 'Señora Ana Ficticia Rojas, cédula 1.000.000.001. <img src=x onerror="window.__xss=1"> <script>window.__xss=2</script> <a href="javascript:window.__xss=3">enlace</a> javascript:window.__xss=4';
    await hastaRevision(page, HOSTIL, 'PRUEBA-PV-02');
    const peligrosos = () => page.evaluate(() => ({
      nodos: document.querySelectorAll('main img, main iframe, main object, main embed, main a[href], main script, main svg script').length,
      xss: (globalThis as unknown as { __xss?: number }).__xss ?? null,
    }));
    const panel = page.getByRole('region', { name: 'Documento con detecciones' });
    await expect(panel).toContainText('<img src=x onerror="window.__xss=1">');
    await expect(panel).toContainText('<script>window.__xss=2</script>');
    await expect(panel).toContainText('javascript:window.__xss=4');
    expect(await peligrosos(), 'Revisión').toEqual({ nodos: 0, xss: null });
    await page.getByRole('button', { name: 'Ver salida' }).click();
    await expect(page.getByRole('region', { name: 'Documento con los marcadores como fichas' })).toContainText('<script>window.__xss=2</script>');
    expect(await peligrosos(), 'Ver salida').toEqual({ nodos: 0, xss: null });
    await page.getByRole('button', { name: 'Ver original' }).click();
    await decidirYContinuar(page);
    await expect(page.locator('[data-prueba="vista-salida"]')).toContainText('<img src=x onerror="window.__xss=1">');
    expect(await peligrosos(), 'Listo').toEqual({ nodos: 0, xss: null });
    await copiarEnListo(page);
    await page.getByRole('button', { name: 'Reinsertar una respuesta' }).click();
    await expect(h1(page, 'Reinserción')).toBeVisible();
    const respuesta = '[DEMANDANTE_1] respondió: <img src=x onerror="window.__xss=5"> <iframe src="javascript:window.__xss=6"></iframe> javascript:window.__xss=7 [CC_1]';
    await page.getByRole('textbox', { name: 'Respuesta de la herramienta de IA' }).fill(respuesta);
    await page.getByRole('button', { name: 'Buscar marcadores' }).click();
    await expect(page.locator('[data-prueba="resultado-real"]')).toContainText('<iframe src="javascript:window.__xss=6"></iframe>');
    expect(await peligrosos(), 'Reinserción').toEqual({ nodos: 0, xss: null });
  });

  test('T-PV-11 menú contextual bloqueado en los contenedores de solo lectura y no en los campos; con la puerta cerrada la salida no se selecciona ni se copia', async ({ page }) => {
    await hastaRevision(page, DOCUMENTO_REI, 'PRUEBA-PV-11');
    // Los campos de texto conservan su menú (la persona lo necesita para pegar); los contenedores del documento no.
    expect((await eventoPrevenido(page, '[data-prueba="panel-texto"]', 'contextmenu')).prevenido, 'panel de texto').toBe(true);
    expect((await eventoPrevenido(page, '[data-prueba="cuadricula"]', 'contextmenu')).prevenido, 'cuadrícula (contexto de menciones)').toBe(true);
    await page.getByRole('region', { name: 'Documento con detecciones' }).locator('[data-det]').first().click();
    expect((await eventoPrevenido(page, '[data-prueba="ficha"]', 'contextmenu')).prevenido, 'ficha').toBe(true);
    await page.getByRole('button', { name: 'Ver salida' }).click();
    expect((await eventoPrevenido(page, '[data-prueba="panel-texto"]', 'contextmenu')).prevenido, 'vista de salida de Revisión').toBe(true);
    const copiaRevisionSalida = await eventoPrevenido(page, '[data-prueba="panel-texto"]', 'copy');
    expect(copiaRevisionSalida.datos, 'la copia de la salida en Revisión no escribe originales').not.toMatch(/Ficticia|1\.000\.000|ejemplo\.test/);
    await page.getByRole('button', { name: 'Ver original' }).click();
    await decidirYContinuar(page);
    // Listo con la puerta cerrada (recordatorio sin marcar): user-select none, copy prevenido y vacío, menú bloqueado.
    const vista = page.locator('[data-prueba="vista-salida"]');
    await expect(vista).toHaveAttribute('data-puerta', 'cerrada');
    expect(await vista.evaluate((el) => getComputedStyle(el).userSelect)).toBe('none');
    expect((await eventoPrevenido(page, '[data-prueba="vista-salida"]', 'contextmenu')).prevenido, 'vista de salida de Listo').toBe(true);
    const copia = await eventoPrevenido(page, '[data-prueba="vista-salida"]', 'copy');
    expect(copia.prevenido, 'copy con la puerta cerrada').toBe(true);
    expect(copia.datos).toBe('');
    await copiarEnListo(page);
    await page.getByRole('button', { name: 'Reinsertar una respuesta' }).click();
    await page.getByRole('textbox', { name: 'Respuesta de la herramienta de IA' }).fill(SALIDA_REI);
    await page.getByRole('button', { name: 'Buscar marcadores' }).click();
    await expect(page.locator('[data-prueba="resultado-real"]')).toBeVisible();
    expect((await eventoPrevenido(page, '[data-prueba="resultado-real"]', 'contextmenu')).prevenido, 'resultado de Reinserción').toBe(true);
    // El campo de la respuesta no bloquea el menú contextual.
    expect((await eventoPrevenido(page, 'textarea', 'contextmenu')).prevenido, 'campo de texto').toBe(false);
  });

  test('T-PV-24 ni Listo ni Reinserción (antes de pegar) muestran o copian la tabla en claro', async ({ page, context }) => {
    await crearYAnalizar(page, { codigo: 'PRUEBA-PV-24' });
    const cuerpo = async (): Promise<string> => page.evaluate(() => document.body.innerText + '\n' + [...document.querySelectorAll('[aria-label],[title]')].map((e) => `${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('title') ?? ''}`).join('\n'));
    for (const real of REALES_REI) expect(await cuerpo(), `Listo con «${real}»`).not.toContain(real);
    await copiarEnListo(page);
    const portapapeles = await leerPortapapeles(context);
    for (const real of REALES_REI) expect(portapapeles.texto, `portapapeles con «${real}»`).not.toContain(real);
    await page.getByRole('button', { name: 'Reinsertar una respuesta' }).click();
    await expect(h1(page, 'Reinserción')).toBeVisible();
    for (const real of REALES_REI) expect(await cuerpo(), `Reinserción con «${real}»`).not.toContain(real);
  });
});
