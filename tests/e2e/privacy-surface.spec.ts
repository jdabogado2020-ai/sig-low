import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

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
