// Prueba de cero red (10.5.1; T-RD-01 a T-RD-06, T-PV-06, T-PV-12). Todas las fases usan el arnés de tests/e2e/lib/ (PD-5a):
// servidor de la app que registra cada petición (el registro es la verdad de referencia), servidor señuelo, escucha UDP de STUN,
// vigilante de peticiones, consola y violaciones de CSP (página y workers) y contexto persistente. Una fase nueva (PD-4: C1 y C2) se
// escribe sobre el arnés sin cambiar lo que comprueba: ver `bitacora/entradas/*_PD-5a.md`, sección «Cómo pasar una fase al arnés».
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { build, defaultClientConditions } from 'vite';

import { construirDocx, decl, p, pt, r, raiz, tipoRel } from '../fixtures/docx/docx-builder';
import { delModelo, distConModelos, modeloSintetico, rutasDelManifiesto } from './harness/dist-modelo';
import { test, expect } from './lib/arnes';
import { volcarAlmacenamiento, textoDelVolcado } from './lib/almacenamiento';
import { diferenciasDeCabeceras } from './lib/cabeceras-esperadas';
import { guardarOriginales, type ConNativo } from './lib/originales';
import { levantarServidor } from './lib/servidores';
import {
  campoRespuesta, copiarEnListo, crearYAnalizar, FRASE, h1, leerPortapapeles, pegarYBuscar, textoDelResultado,
} from './ayudas-reinsercion';
import {
  abrirAvanzadas, abrirMasFormatos, aDescargar, aDetalle, anonimizar, confirmar, crearCaso, editarLista, pegarLista, pegarTexto,
} from './lib/flujo';

const sha256 = (t: string | Uint8Array): string => createHash('sha256').update(t).digest('hex');

/** Rutas del precache (la lista blanca de la app) y los datos del build. */
const precache = (dir = 'dist'): string[] => (JSON.parse(readFileSync(join(dir, 'precache.json'), 'utf8')) as { archivos: { ruta: string }[] }).archivos.map((a) => a.ruta);

/** Cargar documento → «Opciones avanzadas» → crear un caso sin guardar la llave (pasos comunes de las fases que parten del caso). */
async function crearAsunto(page: Page, codigo: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
  await crearCaso(page, { codigo, guardar: false });
}

// Fase mínima de P0-1 (10.5.1): carga, 0 peticiones a otros orígenes y 0 violaciones de CSP.
test('@cero-red carga: 0 peticiones a otros orígenes y 0 violaciones de CSP', async ({ arnes }) => {
  const a = await arnes();
  const s = await a.sesion();
  const page = await s.nuevaPagina();
  await page.goto('/');
  await expect(page.locator('[data-prueba="promesa"]')).toBeVisible();
  expect(s.vigilante.ajenas).toEqual([]);
  expect(s.vigilante.violaciones).toEqual([]);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  expect(await page.evaluate(() => typeof (globalThis as unknown as Record<string, unknown>)['RTCPeerConnection'])).toBe('undefined');
  await a.verificar(s, { exigirCorte: false });
});

test('@humo Inicio muestra la promesa literal y el título neutro', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-prueba="promesa"]')).toHaveText(
    'Sus documentos no salen de su equipo. Sig-Low propone qué ocultar, le muestra el documento ya anonimizado y usted decide antes de descargarlo.',
  );
  expect(await page.title()).toBe('Sig-Low');
});

// T-RD-01 (A1–A5): primera carga con conexión. El SW se activa y controla la página; pedidos de A4–A5 desde fuera del SW; todo
// lo que llega al servidor son GET sin query ni cuerpo a la lista blanca (precache, /precache.json, /sw.js y el manifiesto del modelo).
test('T-RD-01 @cero-red INV-G01 primera carga (A1–A5): solo GET sin query a la lista blanca; SW activado y controlando', async ({ arnes }) => {
  const a = await arnes({ reporteCsp: false });
  const s = await a.sesion();
  const page = await s.nuevaPagina();
  await page.goto('/');
  await a.esperarControlador(page); // A1–A2
  expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state)).toBe('activated');
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect(page.locator('[data-prueba="promesa"]')).toBeVisible();

  // A4–A5: la página, el SW, la política de tipos de confianza, un chunk de cada worker, ORT y el manifiesto del modelo.
  const lista = precache();
  const delChunk = (nombre: RegExp): string => lista.find((x) => nombre.test(x))!;
  const rutasA = [
    '/', '/index.html', '/sw.js', '/tt-policy.js', delChunk(/^\/assets\/detect\.worker-/), delChunk(/^\/assets\/io\.worker-/),
    delChunk(/^\/assets\/pdf\.worker-/), '/ort/ort-wasm-simd-threaded.wasm', '/ort/ort-wasm-simd-threaded.mjs',
    ...lista.filter((x) => /^\/models\/[^/]+\/manifest\.json$/.test(x)),
  ];
  const corteA = a.app.peticiones().length;
  for (const ruta of rutasA) expect((await s.ctx.request.get(ruta, { maxRetries: 3 })).status(), ruta).toBe(200);

  const permitidas = new Set([...lista, '/index.html', '/precache.json', '/sw.js']);
  const todas = a.app.peticiones();
  expect(todas.filter((q) => q.m !== 'GET' || q.q !== '' || q.b !== 0).map((q) => `${q.m} ${q.u}`)).toEqual([]);
  expect(todas.filter((q) => !permitidas.has(q.p)).map((q) => q.u)).toEqual([]);
  // Cada ruta pedida en A4–A5 llegó al servidor (y nada más, salvo la búsqueda de versión del SW: GET /sw.js).
  const trasA = todas.slice(corteA).map((q) => q.p);
  expect([...trasA].sort()).toEqual(expect.arrayContaining([...rutasA].sort()));
  expect(trasA.filter((u) => !rutasA.includes(u))).toEqual([]);
  await a.verificar(s, { exigirCorte: false });
});

// T-RD-02: cabeceras y tipos MIME de cada recurso de A4–A5, comparados con los valores de `dist/_headers` (3.6) leídos por
// lib/cabeceras-esperadas.ts, sin copias a mano. Se piden fuera del SW y desde la página (la navegación).
test('T-RD-02 @cero-red cabeceras de 3.6 y Content-Type por extensión en cada recurso', async ({ arnes }) => {
  const a = await arnes({ reporteCsp: false });
  const s = await a.sesion();
  const page = await s.nuevaPagina();
  const nav = await page.goto('/');
  expect(diferenciasDeCabeceras('/', nav!.headers())).toEqual([]);
  await a.esperarControlador(page);
  const lista = precache();
  const rutas = ['/', '/index.html', '/sw.js', '/tt-policy.js', '/precache.json', ...lista.filter((x) => /^\/(assets|ort)\//.test(x))];
  const diferencias: string[] = [];
  for (const ruta of new Set(rutas)) {
    const resp = await s.ctx.request.get(ruta, { maxRetries: 3 });
    expect(resp.status(), ruta).toBe(200);
    diferencias.push(...diferenciasDeCabeceras(ruta, resp.headers()));
  }
  expect(diferencias).toEqual([]);
  await a.verificar(s, { exigirCorte: false });
});

// Fase «pegar» (PC-2, 10.5.1; T-RD-03): flujo por defecto de la v1.1 (D-23: sin crear caso; Sig-Low abre uno efímero en memoria), pegar un texto
// con datos ficticios, analizar y llegar a la Vista previa, sin conexión desde el corte (B1). 0 peticiones fuera del origen, 0 violaciones
// de CSP, 0 mensajes de consola y el texto pegado no viaja en ninguna URL ni cuerpo.
test('T-RD-03 @cero-red INV-G01 INV-W03 fase pegar (sin modelo descargado): pegar → Analizando → Vista previa sin peticiones ajenas, sin violaciones de CSP ni texto en la red', async ({ arnes }) => {
  const a = await arnes();
  const s = await a.sesion();
  const page = await s.nuevaPagina();
  await page.goto('/');
  await a.cortar(s, page);
  await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
  await pegarTexto(page, 'Ana Ficticia Rojas, C.C. 1.000.000.017, vive en la Calle 00 n.º 00-00. Correo: ana.ficticia@ejemplo.test.');
  await page.getByRole('button', { name: 'Anonimizar', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vista previa' })).toBeVisible({ timeout: 15_000 });
  await a.verificar(s, { secretos: ['Ficticia', '1.000.000.017'] });
});

// Variante con caso explícito (T-RD-03): «Opciones avanzadas» → crear un caso sin guardar la llave + lista de nombres, y el mismo recorrido.
test('T-RD-03 @cero-red INV-G01 INV-W03 fase pegar con caso y lista de nombres: sin peticiones ajenas, sin violaciones de CSP ni texto en la red', async ({ arnes }) => {
  const a = await arnes();
  const s = await a.sesion();
  const page = await s.nuevaPagina();
  await page.goto('/');
  await a.cortar(s, page);
  await crearAsunto(page, 'PRUEBA-CERO');
  await editarLista(page);
  await pegarLista(page, 'Ana Ficticia Rojas; demandante');
  await pegarTexto(page, 'Ana Ficticia Rojas, C.C. 1.000.000.017, vive en la Calle 00 n.º 00-00. Correo: ana.ficticia@ejemplo.test.');
  await page.getByRole('button', { name: 'Anonimizar', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vista previa' })).toBeVisible({ timeout: 15_000 });
  await a.verificar(s, { secretos: ['Ficticia', '1.000.000.017', 'PRUEBA-CERO'] });
});

// Fase «docx» (PE-3-r1, B-14; 10.5.1; T-RD-03): flujo por defecto (sin crear caso), cargar un .docx ficticio armado con el docx-builder (cuerpo, encabezado,
// comentario con autor, texto eliminado, propiedades y un vínculo externo), analizar y llegar a la Vista previa. 0 peticiones fuera del
// origen, 0 violaciones de CSP (página y workers, el `io` incluido), 0 mensajes de consola y nada del documento en URL ni cuerpos.
test('T-RD-03 @cero-red fase docx: cargar .docx → Analizando → Vista previa sin peticiones ajenas, sin violaciones de CSP (página y workers) ni texto en la red', async ({ arnes }) => {
  const a = await arnes();
  const s = await a.sesion();
  const page = await s.nuevaPagina();

  const tipoMeta = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';
  const docx = construirDocx({
    cuerpo:
      p(r('Ana Ficticia Rojas, C.C. 1.000.000.017, vive en la Calle 00 n.º 00-00. Correo: ana.ficticia@ejemplo.test.')) +
      pt('Contrato de Prueba entre Ana Ficticia Rojas y Empresa Ejemplo S.A.S., NIT 000.000.000-0.') +
      p('<w:del w:id="1" w:author="Revisor Ficticio" w:date="2020-01-01T00:00:00Z"><w:r><w:delText>Clausula eliminada de Ana Ficticia</w:delText></w:r></w:del>') +
      p('<w:hyperlink r:id="rId99"><w:r><w:t>enlace de prueba</w:t></w:r></w:hyperlink>'),
    extras: [
      { nombre: 'cabecera.xml', tipo: 'header', xml: raiz('hdr', pt('Encabezado de Prueba de Ana Ficticia Rojas')) },
      { nombre: 'comentarios.xml', tipo: 'comments', xml: raiz('comments', `<w:comment w:id="0" w:author="Autora Ejemplo" w:initials="AE" w:date="2020-01-01T00:00:00Z">${pt('Comentario de prueba sobre Ana Ficticia')}</w:comment>`) },
    ],
    relacionesDocumento: `<Relationship Id="rId99" Type="${tipoRel('hyperlink')}" Target="https://ejemplo.test/ficticia" TargetMode="External"/>`,
    relacionesPaquete: `<Relationship Id="rId7" Type="${tipoMeta}" Target="docProps/core.xml"/>`,
    entradas: {
      'docProps/core.xml': `${decl}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Autora Ejemplo</dc:creator></cp:coreProperties>`,
    },
  });

  await page.goto('/');
  await a.cortar(s, page);
  await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
  await page.getByRole('tab', { name: 'Cargar archivo' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Contrato de Prueba.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(docx),
  });
  await expect(page.locator('[data-prueba="archivo-cargado"]')).toContainText('Archivo cargado: .docx, ', { timeout: 15_000 });
  await page.locator('details[data-prueba="partes"] summary').click();   // «Elegir qué partes del documento se anonimizan» (plegado por defecto)
  await expect(page.getByRole('checkbox', { name: /^Encabezado 1 · \d+ caracteres$/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /^Comentario 1 · \d+ caracteres$/ })).toBeChecked();
  await page.getByRole('button', { name: 'Anonimizar', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vista previa' })).toBeVisible({ timeout: 15_000 });

  expect(s.vigilante.workers.some((u) => /io/.test(new URL(u).pathname))).toBe(true); // la lectura corrió en el worker `io` del mismo origen
  await a.verificar(s, { secretos: ['Ficticia', 'Rojas', '1.000.000.017', 'ejemplo.test', 'Autora Ejemplo', 'Revisor', 'Contrato de Prueba'] });
});

// T-RD-05 (INV-W02): consola y errores. Un .docx con XML inválido que contiene «Ana Ficticia Rojas»: la app muestra su error con
// código y ni la consola, ni un `pageerror`, ni la red, ni la pantalla llevan el texto del documento.
test('T-RD-05 @cero-red INV-W02 un .docx con XML inválido no deja «Ana Ficticia Rojas» en consola, pageerror, red ni pantalla', async ({ arnes }) => {
  const a = await arnes();
  const s = await a.sesion();
  const page = await s.nuevaPagina();
  const invalido = construirDocx({
    cuerpo: '',
    documentoXml: `${decl}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Ana Ficticia Rojas</w:t></w:r></w:p></w:body>`, // sin cerrar <w:document>
  });
  await page.goto('/');
  await a.cortar(s, page);
  await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
  await page.getByRole('tab', { name: 'Cargar archivo' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Invalido de Prueba.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(invalido),
  });
  await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();   // v1.1: un error de lectura deja al abogado en Cargar documento
  await page.waitForTimeout(500); // lo que un fallo interno escribiera en la consola llega en el mismo ciclo
  expect(await page.locator('body').innerText()).not.toContain('Ficticia');
  await a.verificar(s, { secretos: ['Ana Ficticia Rojas', 'Ficticia', 'Rojas'] });
});

// T-RD-06 (B10): volcado del almacenamiento del origen tras el flujo. Ningún original en claro en IndexedDB, `localStorage`,
// `sessionStorage`, cookies, `history.state`, título ni URL (INV-G02, INV-V01); Cache Storage solo con URL de la app (INV-G10);
// `document.title === 'Sig-Low'`. Con el flujo por defecto (caso efímero, D-23) o con «No guardar la llave» no hay base de datos; PD-4 añade
// aquí el volcado con «Guardar la llave en este equipo». Se comprueba tras la Vista previa y también tras copiar en Descargar.
const SECRETOS_VOLCADO = ['Ficticia', 'Rojas', '1.000.000.017', 'ana.ficticia', 'Calle 00'];
const TEXTO_VOLCADO = 'Ana Ficticia Rojas, C.C. 1.000.000.017, vive en la Calle 00 n.º 00-00. Correo: ana.ficticia@ejemplo.test.';
function exigirVolcadoLimpio(v: Awaited<ReturnType<typeof volcarAlmacenamiento>>, extra: string[] = []): void {
  for (const secreto of [...SECRETOS_VOLCADO, ...extra]) expect(textoDelVolcado(v), secreto).not.toContain(secreto);
  expect(v.indexedDB).toEqual({});
  expect(v.localStorage).toEqual({});
  expect(v.sessionStorage).toEqual({});
  expect(v.cookies).toEqual([]);
  expect(v.title).toBe('Sig-Low');
  expect(new URL(v.url).search).toBe('');
  expect(new URL(v.url).hash).toBe('');
  // INV-G10: Cache Storage solo guarda la app (precache + /precache.json) y el modelo; ninguna entrada lleva query.
  const permitidas = new Set([...precache(), '/precache.json']);
  const guardadas = Object.values(v.caches).flat();
  expect(guardadas.filter((u) => !permitidas.has(u) && !/^\/models\//.test(u))).toEqual([]);
  expect(guardadas.filter((u) => u.includes('?'))).toEqual([]);
}

test('T-RD-06 @cero-red INV-G02 INV-V01 INV-G10 volcado del almacenamiento con el flujo por defecto (caso efímero): sin originales, sin base de datos, solo la app en Cache Storage y título neutro', async ({ arnes }) => {
  const a = await arnes();
  const s = await a.sesion();
  const page = await s.nuevaPagina();
  await page.goto('/');
  await a.cortar(s, page);
  await pegarTexto(page, TEXTO_VOLCADO);
  await page.getByRole('button', { name: 'Anonimizar', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vista previa' })).toBeVisible({ timeout: 15_000 });
  exigirVolcadoLimpio(await volcarAlmacenamiento(page), ['DOC-']);
  // D-23: tampoco al pasar por Descargar y copiar el texto anonimizado (la copia consolida la llave del caso efímero, que vive solo en memoria).
  // Sin permiso de portapapeles el texto queda en el área de respaldo (M-87); la consolidación ocurre igual.
  await aDescargar(page);
  await confirmar(page);
  await abrirMasFormatos(page);
  await page.getByRole('button', { name: 'Copiar texto anonimizado' }).click();
  await expect(page.locator('[data-aviso="M-84"], [data-aviso="M-87"]').first()).toBeVisible();
  exigirVolcadoLimpio(await volcarAlmacenamiento(page), ['DOC-']);
  await a.verificar(s, { secretos: ['Ficticia', '1.000.000.017'] });
});

test('T-RD-06 @cero-red INV-G02 INV-V01 INV-G10 volcado del almacenamiento con un caso «No guardar la llave»: sin originales ni código del caso, sin base de datos, solo la app en Cache Storage y título neutro', async ({ arnes }) => {
  const a = await arnes();
  const s = await a.sesion();
  const page = await s.nuevaPagina();
  await page.goto('/');
  await a.cortar(s, page);
  await crearAsunto(page, 'PRUEBA-VOLCADO');
  await pegarTexto(page, TEXTO_VOLCADO);
  await page.getByRole('button', { name: 'Anonimizar', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vista previa' })).toBeVisible({ timeout: 15_000 });
  exigirVolcadoLimpio(await volcarAlmacenamiento(page), ['PRUEBA-VOLCADO']);
  await a.verificar(s, { secretos: ['Ficticia', '1.000.000.017'] });
});

// Canarios del arnés (sin T-id: comprueban que los detectores de T-RD-01 a T-RD-06 ven lo que dicen ver).
// 1) el servidor registra método, ruta, query, cuerpo y cabeceras de origen; 2) el señuelo ve lo que la CSP no bloquea y no ve lo que bloquea.
test('@cero-red arnés canarios: el servidor registra todo y el señuelo solo ve lo que una página sin CSP envía', async ({ arnes }) => {
  const a = await arnes();
  const s = await a.sesion();
  await guardarOriginales(s.ctx); // el fetch original: el de la guardia (src/guard.ts) rechaza otro origen antes de la CSP
  const page = await s.nuevaPagina();
  await page.goto('/');
  // Servidor: método, ruta, query, cuerpo y cabeceras de origen quedan en el registro (404 para lo que no es GET).
  const resp = await s.ctx.request.post('/canario-servidor?d=x', { data: 'cuerpo de prueba', headers: { 'content-type': 'text/plain' } });
  expect(resp.status()).toBe(404);
  const visto = a.app.peticiones().find((q) => q.p === '/canario-servidor')!;
  expect(visto).toMatchObject({ m: 'POST', u: '/canario-servidor?d=x', q: 'd=x', b: 16, c: 'cuerpo de prueba' });
  expect(visto.h['host']).toBe(new URL(a.origen).host);
  expect(visto.h['content-type']).toBe('text/plain');
  // El corte: tras él solo `GET /sw.js` exacto y sin cuerpo es aceptable; una query, un cuerpo, otro método o otra ruta se señalan.
  await a.esperarControlador(page);
  a.marcarCorte(s);
  await s.ctx.request.get('/sw.js');
  expect(a.inesperadasDesdeElCorte()).toEqual([]);
  await s.ctx.request.get('/sw.js?x=1');
  await s.ctx.request.post('/sw.js', { data: 'x' });
  await s.ctx.request.get('/index.html');
  expect(a.inesperadasDesdeElCorte()).toEqual(['GET /sw.js?x=1', 'POST /sw.js', 'GET /index.html']);
  // La página de la app: la CSP bloquea la salida al señuelo (el navegador la intenta y el vigilante la ve) y el señuelo no recibe nada.
  // Con el fetch original, por debajo de la guardia, que la rechazaría antes y sin violación (T-CS-01).
  const alSenuelo = `${a.senuelo.origen}/canario-app?d=x`;
  await page.evaluate((u) => (globalThis as unknown as ConNativo).__nativo.fetch(u, { mode: 'no-cors' }).then(() => 'llegó', () => 'bloqueada'), alSenuelo);
  await expect.poll(() => s.vigilante.violaciones).toContain('pagina:connect-src');
  expect(a.senuelo.peticiones()).toEqual([]); // (la CSP lo frena antes de la red: no hay ni evento `request`)
  // Control: una página que sirve el propio señuelo no lleva la CSP de la app; lo que ella pide llega al señuelo con su ruta, query y
  // cabeceras de origen. (Desde `about:blank` Chromium frena el acceso a 127.0.0.1 por permiso de red privada, así que no sirve de control.)
  const aux = await s.ctx.newPage();
  await aux.goto(`${a.senuelo.origen}/pagina-aux`);
  await aux.evaluate(() => fetch('/canario-aux?d=x').then(() => 'llegó', () => 'bloqueada'));
  expect(a.senuelo.peticiones().map((q) => q.u)).toEqual(['/pagina-aux', '/canario-aux?d=x']);
  expect(a.senuelo.peticiones()[1]!.h['sec-fetch-site']).toBe('same-origin');
  await aux.close();
  // El señuelo responde 200 a todo, con `Access-Control-Allow-Origin: *`: una fuga que pase la CSP se vería completa.
  const eco = await s.ctx.request.get(`${a.senuelo.origen}/cualquier-ruta`);
  expect(eco.status()).toBe(200);
  expect(eco.headers()['access-control-allow-origin']).toBe('*');
});

// 3) STUN: la CSP no bloquea WebRTC; una página sin guardia que lo use deja paquetes UDP en la escucha. 4) una violación de CSP dentro
// de un worker llega al vigilante (escucha en el worker y registro CDP), que es lo que no ve la ventana.
test('@cero-red arnés canarios: la escucha STUN cuenta paquetes y las violaciones de CSP de un worker se ven', async ({ arnes }) => {
  const a = await arnes();
  const s = await a.sesion();
  const page = await s.nuevaPagina();
  await page.goto('/');
  await a.esperarControlador(page);
  // STUN: en la app no existe `RTCPeerConnection` (guardia); en una página auxiliar sí, y su petición de enlace llega a la escucha.
  expect(await page.evaluate(() => typeof (globalThis as unknown as Record<string, unknown>)['RTCPeerConnection'])).toBe('undefined');
  expect(a.stun.paquetes()).toEqual([]);
  const aux = await s.ctx.newPage();
  await aux.goto('about:blank');
  await aux.evaluate(async (stun) => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: stun }] });
    pc.createDataChannel('canario');
    await pc.setLocalDescription(await pc.createOffer());
  }, a.stun.url);
  await expect.poll(() => a.stun.paquetes().length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(a.stun.paquetes().some((q) => q.stun)).toBe(true);
  await aux.close();
  // Workers: un worker del mismo origen intenta salir al señuelo; la CSP lo bloquea y se ve por las dos vías. Es el de pdf.js (de
  // terceros, sin guardia): en los propios, la guardia lo rechaza antes de la CSP (T-CS-02).
  const sinGuardia = precache().find((x) => /^\/assets\/pdf\.worker-/.test(x))!;
  const [worker] = await Promise.all([page.waitForEvent('worker'), page.evaluate((u) => { (globalThis as unknown as { w: Worker }).w = new Worker(u, { type: 'module' }); }, sinGuardia)]);
  await worker.evaluate((u) => fetch(u, { mode: 'no-cors' }).then(() => 'llegó', () => 'bloqueada'), `${a.senuelo.origen}/canario-worker`);
  await expect.poll(() => s.vigilante.violaciones, { timeout: 10_000 }).toContain('worker:connect-src');
  expect(a.senuelo.peticiones()).toEqual([]);
});

// 5) Contexto persistente (base de C1 y C2, T-RD-04): lo que se guarda con conexión sigue en el perfil relanzado sin conexión, y la
// app sale del service worker sin que el servidor vea nada más que `GET /sw.js`.
test('@cero-red arnés canarios: el perfil persistente relanzado sin conexión conserva IndexedDB y sale del service worker', async ({ arnes }) => {
  const a = await arnes();
  const s1 = await a.sesion({ persistente: true });
  const p1 = await s1.nuevaPagina();
  await p1.goto('/');
  await a.esperarControlador(p1);
  await p1.evaluate(() => new Promise<void>((ok, mal) => {
    const rq = indexedDB.open('canario-perfil', 1);
    rq.onupgradeneeded = () => { rq.result.createObjectStore('s'); };
    rq.onsuccess = () => {
      const tx = rq.result.transaction('s', 'readwrite');
      tx.objectStore('s').put('guardado con conexión', 'k');
      tx.oncomplete = () => { rq.result.close(); ok(); };
      tx.onerror = () => { mal(new Error('idb')); };
    };
  }));
  await a.verificar(s1, { exigirCorte: false });
  a.marcarCorte(s1);
  const perfil = s1.perfil!;
  await s1.cerrar();

  const s2 = await a.sesion({ persistente: perfil, offline: true });
  const p2 = await s2.nuevaPagina();
  await p2.goto('/');
  await expect(p2.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
  expect(await p2.evaluate(() => ({ aislado: crossOriginIsolated, controlador: navigator.serviceWorker.controller !== null }))).toEqual({ aislado: true, controlador: true });
  const v = await volcarAlmacenamiento(p2);
  expect(v.indexedDB['canario-perfil']?.['s']).toEqual([{ clave: 'k', valor: 'guardado con conexión' }]);
  await a.verificar(s2);
});

// T-PV-12 (V-01; PD-2): un WebSocket al propio origen. El SW no intercepta WebSocket, y `connect-src 'self'` admite ws: y
// wss: al mismo host: la petición llegaría al alojamiento con su query aunque la subida falle. La segunda política de la CSP
// (`connect-src https: http:`) lo bloquea en la ventana, en un realm `about:blank` (que hereda la CSP y no la guardia; como la
// guardia cierra ese camino, M-4, el iframe se crea con el createElement y el contentWindow originales de tests/e2e/lib/originales.ts)
// y en un worker sin guardia (el de pdf.js; los propios llevan la guardia, T-CS-02). La verdad es el registro de server.mjs; el
// control, con solo la política canónica, muestra que sí llegaría.
// B-26 (PD-2-r2): los otros dos transportes. `WebSocketStream` lo frena la segunda política como al WebSocket, y la guardia
// antes. `WebTransport` al propio origen (`https://<host de la app>/…`) no lo frena ninguna otra capa: `'self'` y `https:` lo
// admiten, sale por UDP (HTTP/3) al puerto de la app y el SW no lo ve; solo la guardia. Una escucha UDP en el puerto de la app
// cuenta lo que sale: 0 desde la ventana y desde un worker propio, sobre el build real (la guardia actúa solo en producción).
// El control (el WebTransport original, en el realm sin guardia) muestra que la escucha ve los paquetes.
test('T-PV-12 @cero-red un WebSocket al propio origen lo bloquea connect-src y no llega al servidor; con solo la política canónica, sí (control); WebSocketStream y WebTransport (B-26): la guardia los frena y no sale ningún paquete UDP al puerto de la app', async ({ browser }) => {
  const raiz = join(process.cwd(), 'test-results', `tpv12-${Date.now()}`);
  const soloCanonica = join(raiz, 'solo-canonica');
  cpSync('dist', soloCanonica, { recursive: true });
  // Control: la CSP de 3.6 sin la segunda política, en la cabecera y en el <meta> (el SW queda bloqueado en el control).
  writeFileSync(join(soloCanonica, '_headers'), readFileSync(join(soloCanonica, '_headers'), 'utf8').replace(/^(\s*Content-Security-Policy:[^,\n]*),[^\n]*$/m, '$1'));
  writeFileSync(join(soloCanonica, 'index.html'), readFileSync(join(soloCanonica, 'index.html'), 'utf8').replace(/\s*<meta http-equiv="Content-Security-Policy" content="script-src[^"]*"\s*\/?>/, ''));
  expect(readFileSync(join(soloCanonica, 'index.html'), 'utf8').match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
  interface Intentos { ventana: string; ventanaWss: string; ventanaWt: string; marco: string; marcoWss: string; violacion: string[] }
  const intentar = (page: Page): Promise<Intentos> => page.evaluate(async () => {
    const g = globalThis as unknown as Record<string, new (u: string) => unknown>;
    const crear = (clase: string, u: string): string => { try { new g[clase]!(u); return 'creado'; } catch (e) { return `lanza ${(e as Error).name}`; } };
    const ventana = crear('WebSocket', `ws://${location.host}/tpv12-ventana?d=x`);
    const ventanaWss = crear('WebSocketStream', `ws://${location.host}/tpv12-ventana-wss?d=x`);
    const ventanaWt = crear('WebTransport', `https://${location.host}/tpv12-ventana-wt?d=x`);
    const N = (globalThis as unknown as ConNativo).__nativo;
    const f = N.createElement('iframe') as HTMLIFrameElement;
    document.body.append(f);
    const violacion: string[] = [];
    (N.contentWindow(f) as Window).addEventListener('securitypolicyviolation', (e) => { violacion.push((e as SecurityPolicyViolationEvent).effectiveDirective); });
    const M = (N.contentWindow(f) as unknown as Record<string, typeof WebSocket>)['WebSocket']!;
    const marco = await new Promise<string>((ok) => {
      const s = new M(`ws://${location.host}/tpv12-marco?d=x`);
      s.onerror = () => { ok('error'); };
      s.onopen = () => { ok('abierto'); };
      setTimeout(() => { ok('sin evento'); }, 3000);
    });
    // WebSocketStream sin guardia: si la CSP lo bloquea, `opened` se rechaza.
    const MS = (N.contentWindow(f) as unknown as Record<string, new (u: string) => { opened: Promise<unknown> }>)['WebSocketStream']!;
    const marcoWss = await new Promise<string>((ok) => {
      try { new MS(`ws://${location.host}/tpv12-marco-wss?d=x`).opened.then(() => { ok('abierto'); }, () => { ok('error'); }); } catch (e) { ok(`lanza ${(e as Error).name}`); }
      setTimeout(() => { ok('sin evento'); }, 3000);
    });
    await new Promise((ok) => { setTimeout(ok, 300); });
    return { ventana, ventanaWss, ventanaWt, marco, marcoWss, violacion };
  });
  // Puertos libres del sistema (`--port 0`): otros carriles dejan servidores abiertos en puertos fijos.
  // B-26: escucha UDP en el puerto de la app (HTTP/3 de WebTransport); el servidor de la app usa TCP en ese mismo número. El
  // sistema elige un puerto TCP libre, pero ese número puede estar reservado en UDP (en Windows, los rangos excluidos de UDP y
  // de TCP no coinciden: `bind EACCES`). Entonces se levanta otro servidor, hasta 5 veces.
  const paquetes: number[] = [];
  const escuchar = (puerto: number): Promise<ReturnType<typeof createSocket> | null> => new Promise((ok) => {
    const s = createSocket('udp4');
    s.once('error', () => { try { s.close(); } catch { /* ya cerrado */ } ok(null); });
    s.bind(puerto, '127.0.0.1', () => { s.on('message', (m) => { paquetes.push(m.length); }); ok(s); });
  });
  let con = await levantarServidor({ dir: 'dist', reporteCsp: false });
  let udp = await escuchar(con.puerto);
  for (let i = 1; udp === null && i < 5; i++) {
    await con.parar();
    con = await levantarServidor({ dir: 'dist', reporteCsp: false });
    udp = await escuchar(con.puerto);
  }
  const sin = await levantarServidor({ dir: soloCanonica, reporteCsp: false });
  const rutas = (srv: typeof con): string[] => srv.peticiones().map((q) => q.u).filter((u) => u.startsWith('/tpv12'));
  try {
    expect(udp, `sin un puerto libre a la vez en TCP y UDP (último: ${con.puerto})`).not.toBeNull();
    // Con la CSP de PD-2 y el SW activo.
    const ctx = await browser.newContext({ baseURL: con.origen });
    await guardarOriginales(ctx);
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, { timeout: 30_000 });
    const r = await intentar(page);
    expect(r.ventana).toBe('lanza SiglowError'); // la guardia, antes de la CSP
    expect([r.ventanaWss, r.ventanaWt]).toEqual(['lanza SiglowError', 'lanza SiglowError']); // B-26
    expect(r.marco).toBe('error');
    expect(r.marcoWss).toBe('error');
    expect(r.violacion).toContain('connect-src');
    // Un worker sin guardia (pdf.js, de terceros): en los propios, la guardia lanza antes que la CSP (T-CS-02).
    const sinGuardia = precache().find((x) => /pdf\.worker/.test(x))!;
    const [worker] = await Promise.all([page.waitForEvent('worker'), page.evaluate((u) => { (globalThis as unknown as { w: Worker }).w = new Worker(u, { type: 'module' }); }, sinGuardia)]);
    expect(await worker.evaluate(async () => {
      const v: string[] = [];
      self.addEventListener('securitypolicyviolation', (e) => { v.push((e as SecurityPolicyViolationEvent).effectiveDirective); });
      const res = await new Promise<string>((ok) => { const s = new WebSocket(`ws://${self.location.host}/tpv12-worker?d=x`); s.onerror = () => { ok('error'); }; s.onopen = () => { ok('abierto'); }; setTimeout(() => { ok('sin evento'); }, 3000); });
      await new Promise((ok) => { setTimeout(ok, 300); });
      const delWs = v.splice(0);
      // B-26: WebSocketStream, igual que el WebSocket.
      const MS = (self as unknown as Record<string, new (u: string) => { opened: Promise<unknown> }>)['WebSocketStream']!;
      const wss = await new Promise<string>((ok) => { new MS(`ws://${self.location.host}/tpv12-worker-wss?d=x`).opened.then(() => { ok('abierto'); }, () => { ok('error'); }); setTimeout(() => { ok('sin evento'); }, 3000); });
      await new Promise((ok) => { setTimeout(ok, 300); });
      return { res, v: delWs, wss, vWss: [...new Set(v)] };
    })).toEqual({ res: 'error', v: ['connect-src'], wss: 'error', vWss: ['connect-src'] });
    // B-26: un worker propio (detect) lleva la guardia: WebSocketStream y WebTransport lanzan.
    const propio = precache().find((x) => /^\/assets\/detect\.worker-/.test(x))!;
    const [conGuardia] = await Promise.all([
      page.waitForEvent('worker', (w) => new URL(w.url()).pathname === propio),
      page.evaluate((u) => { (globalThis as unknown as { w2: Worker }).w2 = new Worker(u, { type: 'module' }); }, propio),
    ]);
    expect(await conGuardia.evaluate(() => [['WebSocketStream', 'ws'], ['WebTransport', 'https']].map(([clase, esquema]) => {
      try { new (self as unknown as Record<string, new (u: string) => unknown>)[clase!]!(`${esquema!}://${self.location.host}/tpv12-detect?d=x`); return 'creado'; } catch (e) { return `lanza ${(e as Error).name}`; }
    }))).toEqual(['lanza SiglowError', 'lanza SiglowError']);
    await page.waitForTimeout(1500);
    expect(rutas(con)).toEqual([]);
    expect(paquetes).toEqual([]); // ningún paquete UDP al puerto de la app
    // Control (B-26): el WebTransport original, en el realm sin guardia (que hereda la CSP), sí sale: ninguna violación y
    // paquetes en la escucha. Así el 0 de arriba prueba algo.
    const control = await page.evaluate(async () => {
      const N = (globalThis as unknown as ConNativo).__nativo;
      const f = N.createElement('iframe') as HTMLIFrameElement;
      document.body.append(f);
      const v: string[] = [];
      (N.contentWindow(f) as Window).addEventListener('securitypolicyviolation', (e) => { v.push((e as SecurityPolicyViolationEvent).effectiveDirective); });
      const T = (N.contentWindow(f) as unknown as Record<string, new (u: string) => unknown>)['WebTransport']!;
      let res: string;
      try { new T(`https://${location.host}/tpv12-marco-wt?d=x`); res = 'creado'; } catch (e) { res = `lanza ${(e as Error).name}`; }
      await new Promise((ok) => { setTimeout(ok, 500); });
      return { res, v };
    });
    expect(control).toEqual({ res: 'creado', v: [] });
    await expect.poll(() => paquetes.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const delControl = paquetes.length;
    // Riesgo residual (V-01: la guardia no corre en workers de terceros): el WebTransport del worker de pdf.js. Se mide y se
    // anota; check-dist prohíbe el nombre en el build (regla `WebTransport`).
    await worker.evaluate(() => { new (self as unknown as Record<string, new (u: string) => unknown>)['WebTransport']!(`https://${self.location.host}/tpv12-worker-wt?d=x`); });
    await page.waitForTimeout(1500);
    test.info().annotations.push({ type: 'riesgo residual (B-26, V-01)', description: `WebTransport al propio origen sin guardia: ${delControl} paquetes UDP desde un iframe about:blank (control) y ${paquetes.length - delControl} desde el worker de pdf.js, sin violación de CSP` });
    expect(rutas(con)).toEqual([]);
    await ctx.close();
    // Control: solo la política canónica (`connect-src 'self'`). El WebSocket y el WebSocketStream del realm sin guardia llegan
    // al servidor, query incluida.
    const ctx2 = await browser.newContext({ baseURL: sin.origen, serviceWorkers: 'block' });
    await guardarOriginales(ctx2);
    const page2 = await ctx2.newPage();
    await page2.goto('/');
    const r2 = await intentar(page2);
    expect(r2.violacion).toEqual([]);
    await expect.poll(() => rutas(sin).sort()).toEqual(['/tpv12-marco-wss?d=x', '/tpv12-marco?d=x']);
    await ctx2.close();
  } finally {
    await con.parar();
    await sin.parar();
    await new Promise<void>((ok) => { if (udp === null) { ok(); return; } try { udp.close(() => { ok(); }); } catch { ok(); } });
    rmSync(raiz, { recursive: true, force: true });
  }
});

// Fase del service worker (PD-1, 3.2 y V-15): con conexión el SW instala el precache verificado; sin conexión la app
// sale de la caché con las cabeceras de 3.6 (las de dist/_headers, inyectadas en sw.js al construir).
const TRANSPORTE = new Set(['date', 'connection', 'keep-alive', 'content-length', 'transfer-encoding']);
const OBLIGATORIAS = [
  'content-security-policy', 'cross-origin-opener-policy', 'cross-origin-embedder-policy', 'cross-origin-resource-policy',
  'x-content-type-options', 'referrer-policy', 'content-type',
];
const sinTransporte = (h: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(h).filter(([k]) => !TRANSPORTE.has(k.toLowerCase())).map(([k, v]) => [k.toLowerCase(), v]).sort());

// El servidor es el del arnés (puerto libre, conexiones persistentes de 120 s) y los pedidos fuera del SW reintentan un `ECONNRESET`
// (`maxRetries`, la opción de Playwright para ese error): bajo la carga de varios agentes, el cierre de una conexión ociosa del
// servidor de Node (5 s) coincidía con su reutilización.
test('T-PV-06 @cero-red INV-G10 sin conexión: crossOriginIsolated y las cabeceras de 3.6 en cada respuesta de la caché', async ({ arnes }) => {
  const a = await arnes({ reporteCsp: false });
  const s = await a.sesion();
  // El fetch original: /tt-policy.js y /precache.json no son rutas del fetch de la guardia (5.2.1), y aquí se lee la caché del
  // SW, no lo que pide la app.
  await guardarOriginales(s.ctx);
  const page = await s.nuevaPagina();
  const { ctx: context } = s;
  await page.goto('/');
  await a.esperarControlador(page);
  const texto = readFileSync('dist/precache.json', 'utf8');
  const lista = (JSON.parse(texto) as { archivos: { ruta: string; sha256: string }[] }).archivos;
  const esperado = new Map([...lista.map((x) => [x.ruta, x.sha256] as const), ['/precache.json', sha256(texto)]]);
  const rutas = [...esperado.keys()].sort();
  // INV-G10: Cache Storage solo guarda la app: una caché `siglow-app-<SHA-256 de precache.json>` con la lista exacta.
  const cachesVistas = await page.evaluate(async () => Promise.all((await caches.keys()).map(async (k) => ({
    k, urls: (await (await caches.open(k)).keys()).map((rq) => { const u = new URL(rq.url); return u.pathname + u.search; }).sort(),
  }))));
  expect(cachesVistas).toEqual([{ k: `siglow-app-${sha256(texto)}`, urls: rutas }]);
  // Cabeceras del alojamiento con conexión, pedidas por fuera del SW (server.mjs aplica dist/_headers).
  const delServidor = new Map<string, Record<string, string>>();
  for (const ruta of rutas) {
    const resp = await context.request.get(ruta, { maxRetries: 3 });
    expect(resp.status(), ruta).toBe(200);
    delServidor.set(ruta, sinTransporte(resp.headers()));
  }
  await context.setOffline(true);
  try {
    const nav = await page.reload();
    expect(nav?.fromServiceWorker()).toBe(true);
    await expect(page.locator('[data-prueba="promesa"]')).toBeVisible();
    expect(await page.evaluate(() => ({ aislado: crossOriginIsolated, controlador: navigator.serviceWorker.controller !== null })))
      .toEqual({ aislado: true, controlador: true });
    expect(sinTransporte(await nav!.allHeaders())).toEqual(delServidor.get('/'));
    const desdeCache = await page.evaluate(async (rs) => Promise.all(rs.map(async (ruta) => {
      const resp = await (globalThis as unknown as ConNativo).__nativo.fetch(ruta);
      const h: Record<string, string> = {};
      resp.headers.forEach((v, k) => { h[k] = v; });
      const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await resp.arrayBuffer()));
      return { ruta, status: resp.status, h, sha: Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('') };
    })), rutas);
    for (const { ruta, status, h, sha } of desdeCache) {
      expect({ ruta, status, sha }).toEqual({ ruta, status: 200, sha: esperado.get(ruta) });
      expect(sinTransporte(h), ruta).toEqual(delServidor.get(ruta));
      for (const k of OBLIGATORIAS) expect(h[k], `${ruta}: ${k}`).toBeTruthy();
      if (ruta.endsWith('.wasm')) expect(h['content-type']).toBe('application/wasm');
      if (ruta.endsWith('.mjs')) expect(h['content-type']).toBe('text/javascript');
    }
  } finally {
    await context.setOffline(false);
  }
});

// Fase «pdf» (PE-4-r1, M-3; 10.5.1): se compila un arnés (tests/e2e/harness/pdf.ts) que usa readPdf con la configuración de la
// app y las mismas opciones de Vite, se sirve con server.mjs (que aplica public/_headers: CSP, Trusted Types, COEP) y se leen
// los PDF de tests/fixtures/. Exige 0 peticiones a otros orígenes, 0 violaciones de CSP y 0 consola (página y workers).
// PE-4-r2 (M-3): lleva @cero-red (≈ 4 s la prueba y ≈ 13 s con la compilación del arnés). Una violación de CSP dentro del worker
// de pdf.js no llega a la ventana ni a la consola que ve Playwright. Por eso el servidor del arnés añade `report-uri /csp-report`
// a cada política al servirla (`--reporte-csp`; producción no lleva report-uri, V-21): cada violación, también la del worker, es una
// petición que el servidor registra, y la prueba exige que no haya ninguna. Un canario demuestra que el mecanismo funciona.
test.describe('fase pdf', () => {
  test.describe.configure({ mode: 'serial' });
  const RAIZ = process.cwd();
  const CARPETA = join(RAIZ, 'test-results', 'pdf-harness');

  test.beforeAll(async () => {
    rmSync(CARPETA, { recursive: true, force: true });
    mkdirSync(CARPETA, { recursive: true });
    await build({
      configFile: false,
      root: join(RAIZ, 'tests/e2e/harness'),
      publicDir: join(RAIZ, 'public'),
      logLevel: 'silent',
      cacheDir: join(RAIZ, '.vite-cache'),
      define: { __SIGLOW_VERSION__: '"prueba"', __SIGLOW_MEDICION__: 'false' },
      build: {
        outDir: CARPETA, emptyOutDir: false, target: 'es2024', assetsInlineLimit: 0, sourcemap: false,
        modulePreload: { polyfill: false }, reportCompressedSize: false,
        rolldownOptions: { input: { pdf: join(RAIZ, 'tests/e2e/harness/pdf.html') }, output: { minify: { compress: { dropConsole: true, dropDebugger: true } } } },
      },
      worker: { format: 'es', rolldownOptions: { output: { minify: { compress: { dropConsole: true, dropDebugger: true } } } } },
      resolve: { conditions: [...defaultClientConditions] },
    });
    mkdirSync(join(CARPETA, 'fixtures'), { recursive: true });
    // Canario: un worker del mismo origen que intenta salir a la red; la CSP (connect-src 'self') lo bloquea y lo reporta.
    writeFileSync(join(CARPETA, 'assets', 'canario-worker.js'), "fetch('https://ejemplo.test/canario').catch(() => undefined);");
    for (const f of readdirSync(join(RAIZ, 'tests/fixtures')).filter((n) => n.endsWith('.pdf'))) cpSync(join(RAIZ, 'tests/fixtures', f), join(CARPETA, 'fixtures', f));
  });

  type Resumen = { error?: string; partes?: Array<{ kind: string; label: string; largo: number }>; avisos?: string[]; categorias?: string[] };
  // Resultado esperado de cada fixture (T-LE-06 a T-LE-08, M-2).
  const ESPERADO: Record<string, { error?: string; partes?: number; avisos?: string[] }> = {
    'pdf-dos-columnas.pdf': { partes: 2, avisos: ['ORDEN_LECTURA_PDF'] },
    'pdf-anotaciones.pdf': { partes: 5, avisos: [] },
    'pdf-escaneado.pdf': { error: 'PDF_SIN_CAPA_TEXTO' },
    'pdf-con-contrasena.pdf': { error: 'PDF_CON_CONTRASENA' },
    'pdf-pagina-sin-texto.pdf': { partes: 2, avisos: ['PAGINA_SIN_TEXTO'] },
    'pdf-js-recuadro.pdf': { partes: 1, avisos: [] },
    'pdf-texto-ilegible.pdf': { partes: 1, avisos: ['TEXTO_ILEGIBLE'] },
    'pdf-formularios.pdf': { partes: 4, avisos: ['CONTENIDO_PDF_NO_LEIDO'] },
  };

  test('@cero-red fase pdf: lee los PDF con el worker del mismo origen, 0 peticiones ajenas, 0 violaciones de CSP y 0 consola', async ({ arnes }) => {
    const a = await arnes({ dir: CARPETA, reporteCsp: true });
    const s = await a.sesion();
    const page = await s.nuevaPagina();
    await page.goto('/pdf.html');
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

    for (const [nombre, esperado] of Object.entries(ESPERADO)) {
      const res = await page.evaluate((ruta) => (globalThis as unknown as { __pdf: { leer(r: string): Promise<Resumen> } }).__pdf.leer(ruta), `/fixtures/${nombre}`);
      if (esperado.error !== undefined) expect(res.error, nombre).toBe(esperado.error);
      else {
        expect(res.error, nombre).toBeUndefined();
        expect(res.partes, nombre).toHaveLength(esperado.partes ?? 0);
        expect(res.avisos, nombre).toEqual(esperado.avisos);
      }
    }

    expect(s.vigilante.ajenas).toEqual([]);
    expect(s.vigilante.peticiones.filter((q) => /^(data|blob):/.test(q.url))).toEqual([]); // el worker de pdf.js es un archivo propio, nunca blob:
    expect(s.vigilante.consola).toEqual([]); // esta fase no admite ningún mensaje, ni de `log`
    // Todo al mismo origen: solo rutas del build, el worker de pdf.js como archivo propio (nunca blob:) y los PDF, sin query.
    const registro = a.app.peticiones();
    for (const x of registro) {
      expect(x.m).toBe('GET');
      expect(x.u, x.u).toMatch(/^\/(pdf\.html|tt-policy\.js|assets\/[A-Za-z0-9._-]+\.js|fixtures\/pdf-[a-z-]+\.pdf)$/);
    }
    expect(registro.some((x) => /^\/assets\/pdf\.worker-[A-Za-z0-9_-]+\.js$/.test(x.u))).toBe(true);
    await a.verificar(s, { exigirCorte: false });
  });

  // El canario viola la CSP en su primera línea, antes de que el escucha del vigilante pueda existir: lo ven el servidor (report-uri,
  // solo en páginas sin service worker) y el registro CDP del vigilante (también con service worker).
  test('@cero-red fase pdf canario: una violación de CSP dentro de un worker llega al registro del servidor y al vigilante', async ({ arnes }) => {
    const a = await arnes({ dir: CARPETA, reporteCsp: true });
    const s = await a.sesion();
    const page = await s.nuevaPagina();
    await page.goto('/pdf.html');
    await page.evaluate(() => { new Worker('/assets/canario-worker.js'); });
    await expect.poll(() => a.app.peticiones().some((q) => q.p === '/csp-report'), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => s.vigilante.violaciones, { timeout: 10_000 }).toContain('worker:connect-src');
  });
});

// Fase «exportar» (PC-5, 10.5.1, B6; T-RD-03): pegar → Vista previa → Descargar → copiar y descargar .docx, PDF, .txt e informe, sin peticiones
// fuera del origen, sin violaciones de CSP, sin mensajes de consola y sin que el texto del documento viaje en ninguna URL ni cuerpo. v1.1
// (F3, D-24): ya no hace falta el gancho del build de medición; se recorre el flujo real de `dist/` (la vista previa trae todo aceptado y
// Descargar pide una sola confirmación). Las descargas son `<a download>` sobre una URL `blob:` bajo la misma CSP que `dist/`.
test.describe('@cero-red fase exportar', () => {
  test.describe.configure({ timeout: 180_000 });

  test('T-RD-03 @cero-red INV-W03 fase exportar: Descargar → copiar y descargar .docx, PDF, .txt e informe sin peticiones ajenas, sin violaciones de CSP ni texto en la red', async ({ arnes }) => {
    const a = await arnes({ dir: 'dist' });
    const s = await a.sesion();
    const page = await s.nuevaPagina();
    await page.goto('/');
    await a.cortar(s, page);
    await crearAsunto(page, 'PRUEBA-EXPORTAR');
    await editarLista(page);
    await pegarLista(page, 'Ana Ficticia Rojas; demandante');
    await pegarTexto(page, 'Ana Ficticia Rojas, C.C. 1.000.000.017, vive en la Calle 00 n.º 00-00. Correo: ana.ficticia@ejemplo.test.');
    await anonimizar(page);
    await aDescargar(page);
    await confirmar(page);
    await abrirMasFormatos(page);
    await page.getByRole('button', { name: 'Copiar texto anonimizado' }).click();
    await expect(page.locator('[data-aviso="M-84"]')).toBeVisible();
    // El informe necesita el código de la compilación (sale de la caché del service worker, sin red).
    await expect(page.locator('[data-prueba="informe-json"]')).not.toHaveAttribute('aria-disabled', 'true', { timeout: 30_000 });
    for (const [boton, patron] of [
      ['Descargar documento (.docx)', /\.docx$/], ['Descargar PDF', /\.pdf$/], ['Descargar texto (.txt)', /\.txt$/],
      ['Descargar informe (.txt)', /\.txt$/], ['Descargar informe (.json)', /\.json$/],
    ] as const) {
      const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByRole('button', { name: boton }).click()]);
      expect(d.suggestedFilename(), boton).toMatch(patron);
      expect(d.suggestedFilename(), boton).toMatch(/^sig-low-(anonimizado|informe)-\d{8}-\d{4}\./);
    }
    await a.verificar(s, { secretos: ['Ficticia', '1.000.000.017', 'PRUEBA-EXPORTAR'] });
  });

  // D-23: lo mismo con el flujo por defecto (caso efímero, sin lista de nombres y sin crear nada).
  test('T-RD-03 @cero-red INV-W03 fase exportar con el flujo por defecto (caso efímero): copiar y descargar .docx y PDF sin peticiones ajenas, sin violaciones de CSP ni texto en la red', async ({ arnes }) => {
    const a = await arnes({ dir: 'dist' });
    const s = await a.sesion();
    const page = await s.nuevaPagina();
    await page.goto('/');
    await a.cortar(s, page);
    await pegarTexto(page, 'Ana Ficticia Rojas, C.C. 1.000.000.017, vive en la Calle 00 n.º 00-00. Correo: ana.ficticia@ejemplo.test.');
    await anonimizar(page);
    await aDescargar(page);
    await confirmar(page);
    for (const [boton, patron] of [['Descargar documento (.docx)', /\.docx$/], ['Descargar PDF', /\.pdf$/]] as const) {
      const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByRole('button', { name: boton }).click()]);
      expect(d.suggestedFilename(), boton).toMatch(patron);
    }
    await a.verificar(s, { secretos: ['Ficticia', '1.000.000.017', 'DOC-'] });
  });
});

// Fase A3 (PF-2, 10.5.1; T-RD-01): «Descargar modelo de apoyo» y esperar «listo»; las peticiones del modelo son SOLO las rutas del manifiesto
// (auxiliares y trozos; el equivalente de las 26 del principal y las 13 del respaldo, con el modelo sintético de esta prueba), todas
// GET sin query ni cuerpo; después, fase A (todo a la lista blanca: precache, manifiesto y /sw.js) y B1 sin conexión. Corre en `verify`
// sobre el build real con un modelo ficticio de bytes pequeños (el real, de 626 MB, lo cubre model.spec.ts con SIGLOW_E2E_APP_MODELO=1).
test.describe('@cero-red fase A3 · descarga del modelo', () => {
  test.describe.configure({ timeout: 120_000 });

  test('T-RD-01 @cero-red fase A3: el modelo se descarga solo desde las rutas del manifiesto, la fase A queda en la lista blanca y sin conexión sigue «listo»', async ({ arnes }) => {
    const tmp = mkdtempSync(join(tmpdir(), 'siglow-a3-'));
    try {
      const grande = modeloSintetico('gliner-x-large', { trozos: 5, tamTrozo: 30_000, semilla: 3 });
      const base = modeloSintetico('gliner-x-base', { trozos: 2, tamTrozo: 20_000, semilla: 5 });
      distConModelos(join(process.cwd(), 'dist'), join(tmp, 'dist'), [grande, base]);
      const a = await arnes({ dir: join(tmp, 'dist') });
      const s = await a.sesion();
      await s.ctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 16, configurable: true }); });
      const page = await s.nuevaPagina();

      // A1–A2: el SW se activa y la app pasa de «sin service worker» a lista.
      await page.goto('/');
      await a.esperarControlador(page);
      // F10 (v1.1.3): la descarga la empieza «Anonimizar»; con el detector disponible, su casilla se puede usar sin descargarlo.
      await expect(page.getByRole('checkbox', { name: 'Usar el detector de nombres en este documento' })).toBeEnabled({ timeout: 20_000 });
      const corte = a.app.peticiones().length;

      // A3: anonimizar un texto ficticio (empieza la descarga), volver a Cargar y esperar «listo».
      await page.getByRole('tab', { name: 'Pegar texto' }).click();
      await page.getByRole('textbox', { name: 'Texto del documento' }).fill('Texto ficticio de prueba para empezar la descarga del detector.');
      await page.getByRole('button', { name: 'Anonimizar', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Vista previa' })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Descartar este documento' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Descartar este documento' }).click();
      await expect(page.locator('[data-prueba="tarjeta-modelo"]')).toContainText('Detector de nombres adicional listo en este equipo.', { timeout: 60_000 });
      // PC-6 (3.3, «resultado visible»): el resultado de navigator.storage.persist() aparece en la tarjeta con el mensaje M-107 del catálogo.
      await expect(page.locator('[data-prueba="persistencia-modelo"]')).toHaveText(/^(Persistente: El navegador marcó|No persistente: El navegador puede borrar)/);
      const delModeloA3 =delModelo(a.app.peticiones().slice(corte));
      expect(delModeloA3.every((q) => q.m === 'GET' && !q.u.includes('?'))).toBe(true);
      expect(delModeloA3.map((q) => q.u).sort()).toEqual(rutasDelManifiesto(grande.manifest));

      // A4–A5: pedidos desde fuera del SW (APIRequestContext) a la lista blanca; el corte marca dónde empiezan.
      const corteA = a.app.peticiones().length;
      const rutasA = ['/', '/index.html', '/sw.js', '/tt-policy.js', `/models/${grande.id}/manifest.json`, `/models/${grande.id}/onnx/model_quantized.onnx.part000`];
      for (const ruta of rutasA) expect((await s.ctx.request.get(ruta, { maxRetries: 3 })).status(), ruta).toBe(200);

      // Fase A completa: cada petición del registro es un GET, sin query, a la lista blanca (precache + /precache.json + manifiestos + /sw.js
      // + las rutas del manifiesto del principal que acaba de pedir la descarga).
      const permitidas = new Set([...precache(join(tmp, 'dist')), '/index.html', '/precache.json', '/sw.js', ...rutasDelManifiesto(grande.manifest)]);
      const todas = a.app.peticiones();
      expect(todas.filter((q) => q.m !== 'GET' || q.u.includes('?'))).toEqual([]);
      expect(todas.filter((q) => !permitidas.has(q.u)).map((q) => q.u)).toEqual([]);
      // (el navegador puede añadir su búsqueda de versión: GET /sw.js, que es metadato y está en la lista blanca)
      const trasElCorte = todas.slice(corteA).map((q) => q.u);
      expect([...trasElCorte].sort()).toEqual(expect.arrayContaining([...rutasA].sort()));
      expect(trasElCorte.length - rutasA.length).toBeLessThanOrEqual(1);

      // B1: sin conexión y recargando, el modelo sigue «listo» (se lee de siglow-modelo-<sha>) y la página sigue aislada.
      await a.cortar(s, page);
      await expect(page.locator('[data-prueba="tarjeta-modelo"]')).toContainText('Detector de nombres adicional listo en este equipo.', { timeout: 20_000 });
      await a.verificar(s); // salvo GET /sw.js exacto (3.2), nada más llega al servidor tras el corte
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// Fases C1 y C2 (PD-4, 10.5.1; T-RD-04), sobre el arnés: perfil persistente con conexión → asunto PRUEBA-RED-01 con «Guardar tabla
// cifrada» y la lista del caso; se cierra el contexto (corte) y se relanza el mismo perfil sin conexión: la app sale del service
// worker, el asunto se desbloquea con la lista intacta y se procesa otro documento. `verificar` exige desde el corte solo
// `GET /sw.js` exacto, 0 peticiones a otros orígenes, 0 violaciones de CSP, 0 consola y nada del documento en la red; el volcado
// del perfil (T-RD-06 con «Guardar tabla cifrada») no tiene ningún original fuera de `ct`. La reinserción (PC-6) y el modelo
// (PF-2) se suman a C2 cuando esas tareas se fusionen.
test('T-RD-04 @cero-red fases C1 y C2: el perfil relanzado sin conexión desbloquea PRUEBA-RED-01 y procesa otro documento sin red', async ({ arnes }) => {
  test.setTimeout(180_000);
  const frase = 'frase de prueba ficticia ñandú';
  const a = await arnes({ dir: 'dist' });

  // Con conexión: SW activo, asunto guardado con la lista del caso.
  const s1 = await a.sesion({ persistente: true });
  const p1 = await s1.nuevaPagina();
  await p1.goto('/');
  await a.esperarControlador(p1);
  await expect(p1.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
  await crearCaso(p1, { codigo: 'PRUEBA-RED-01', guardar: true, frase });
  await expect(p1.locator('[data-prueba="aviso-M-21"], [data-prueba="aviso-M-22"]')).toBeVisible({ timeout: 30_000 });
  await editarLista(p1);
  await pegarLista(p1, 'Ana Ficticia Rojas; demandante');
  await a.verificar(s1, { exigirCorte: false, secretos: ['Ficticia', 'PRUEBA-RED-01'] });
  a.marcarCorte(s1);                                                     // el corte: el contexto se cierra
  const perfil = s1.perfil!;
  await s1.cerrar();

  // C1: el mismo perfil, sin conexión.
  const s2 = await a.sesion({ persistente: perfil, offline: true });
  const p2 = await s2.nuevaPagina();
  await p2.goto('/');
  await expect(p2.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
  expect(await p2.evaluate(() => ({ aislado: crossOriginIsolated, controlador: navigator.serviceWorker.controller !== null })))
    .toEqual({ aislado: true, controlador: true });
  await abrirAvanzadas(p2);   // abrir un caso guardado está en «Opciones avanzadas» de Cargar documento
  const sel = p2.getByLabel('Caso guardado', { exact: true });
  const valor = await sel.locator('option', { hasText: 'PRUEBA-RED-01' }).getAttribute('value');
  await sel.selectOption(valor!);
  await p2.getByLabel('Contraseña de la llave del caso', { exact: true }).fill(frase);
  await p2.getByRole('button', { name: 'Abrir el caso' }).click();
  await expect(p2.locator('[data-prueba="caso-abierto"]')).toContainText('PRUEBA-RED-01', { timeout: 30_000 });
  await editarLista(p2);
  await expect(p2.getByText('Ana Ficticia Rojas').first()).toBeVisible({ timeout: 30_000 });   // llave y lista cifradas disponibles
  await p2.getByRole('button', { name: 'Continuar' }).click();
  await expect(p2.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
  // C2: otro documento en la sesión nueva, sin conexión.
  const texto = 'Ana Ficticia Rojas, C.C. 1.000.000.017, vive en la Calle 00 n.º 00-00. Correo: ana.ficticia@ejemplo.test.';
  await pegarTexto(p2, texto);
  await p2.getByRole('button', { name: 'Anonimizar', exact: true }).click();
  await expect(p2.getByRole('heading', { level: 1, name: 'Vista previa' })).toBeVisible({ timeout: 30_000 });
  // El perfil solo guarda la tabla cifrada: ningún original en claro en IndexedDB, Cache Storage ni almacenamiento web.
  const v = await volcarAlmacenamiento(p2);
  expect(Object.keys(v.indexedDB)).toEqual(['siglow-boveda']);
  for (const secreto of ['Ficticia', 'Rojas', '1.000.000.017', 'ana.ficticia', 'Calle 00']) expect(textoDelVolcado(v), secreto).not.toContain(secreto);
  await a.verificar(s2, { secretos: ['Ficticia', '1.000.000.017', 'PRUEBA-RED-01'] });
});

// ===== Fase «reinserción» (PC-6; 10.5.1, pasos B8–B9, T-RD-03) =====
// Sin conexión desde el corte: guardar el asunto cifrado, llevar la tabla a Reinserción, pegar una respuesta con un marcador exacto, uno
// alterado y uno desconocido, decidir uno a uno, copiar y descargar con el aviso de datos reales, bloquear, desbloquear con la frase y
// reinsertar de nuevo. 0 peticiones ajenas, 0 violaciones de CSP, 0 consola y ni el texto reinsertado ni la frase en la red ni en el almacenamiento.
test('T-RD-03 INV-N04 @cero-red fase reinserción: copiar y descargar con datos reales, bloquear y desbloquear sin red; nada del texto reinsertado sale ni se guarda', async ({ arnes }) => {
  test.setTimeout(180_000);
  const AUXILIAR = 'https://auxiliar.ejemplo.test';   // página auxiliar atendida por `route` (no sale a la red): solo para leer el portapapeles
  const a = await arnes({ dir: 'dist' });
  const s = await a.sesion({ origenesPermitidos: [AUXILIAR] });
  const page = await s.nuevaPagina();
  await page.goto('/');
  await a.cortar(s, page);

  await crearYAnalizar(page, { codigo: 'PRUEBA-RED-REI', guardar: true });
  await copiarEnListo(page);
  await abrirAvanzadas(page);   // «Devolver los datos reales a un texto» está en «Opciones avanzadas» de Descargar
  await page.getByRole('button', { name: 'Devolver los datos reales a un texto' }).click();
  await expect(h1(page, 'Devolver los datos reales')).toBeVisible();
  await pegarYBuscar(page, '[DEMANDANTE_1] presentó la tutela. Demandante 1 firmó. [TESTIGO_3] declaró.');
  const alterado = page.locator('[data-prueba="alerta-alterado"]');
  const desconocido = page.locator('[data-prueba="alerta-desconocido"]');
  await expect(page.locator('[data-prueba="resultado"]')).toHaveCount(0);
  await alterado.getByRole('button', { name: 'Devolver el dato real' }).click();
  await desconocido.getByRole('button', { name: 'Dejar como está' }).click();
  await expect(page.locator('[data-prueba="resultado"]')).toBeVisible();
  const esperado = 'Ana Ficticia Rojas presentó la tutela. Ana Ficticia Rojas firmó. [TESTIGO_3] declaró.';
  expect(await textoDelResultado(page)).toBe(esperado);

  // Aviso de datos reales (M-99) al copiar y al descargar.
  await page.getByRole('button', { name: 'Copiar texto con datos reales' }).click();
  const confirmar = page.getByRole('alertdialog', { name: 'Texto con datos reales' });
  await expect(confirmar).toContainText('Va a copiar o descargar texto con datos reales.');
  await confirmar.getByRole('button', { name: 'Continuar con datos reales' }).click();
  await expect(page.locator('[data-aviso="M-124"]')).toBeVisible();
  expect((await leerPortapapeles(s.ctx)).texto).toBe(esperado);
  await page.bringToFront();
  await page.getByRole('button', { name: 'Descargar texto (.txt)' }).click();
  const [descarga] = await Promise.all([
    page.waitForEvent('download'),
    confirmar.getByRole('button', { name: 'Continuar con datos reales' }).click(),
  ]);
  expect(descarga.suggestedFilename()).toMatch(/^sig-low-reinsertado-\d{8}-\d{4}\.txt$/);

  // INV-N04 (T-RD-06): el texto reinsertado no queda en el almacenamiento del origen.
  const volcado = textoDelVolcado(await volcarAlmacenamiento(page));
  for (const real of ['Ana Ficticia', '1.000.000.001', 'tutela']) expect(volcado).not.toContain(real);

  // B9 · bloquear y desbloquear (INV-G09): el estado en claro se vacía y la frase vuelve a abrir la tabla.
  await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
  await expect(h1(page, 'Cargar documento')).toBeVisible();
  await expect(page.locator('[data-prueba="resultado-real"]')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toContain('Ana Ficticia');
  await abrirAvanzadas(page);
  await page.getByLabel('Caso guardado', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Contraseña de la llave del caso', { exact: true }).fill(FRASE);
  await page.getByRole('button', { name: 'Devolver los datos reales a un texto' }).click();
  await expect(h1(page, 'Devolver los datos reales')).toBeVisible({ timeout: 30_000 });
  await campoRespuesta(page).fill('Cédula [CC_1].');
  await page.getByRole('button', { name: 'Buscar etiquetas' }).click();
  expect(await textoDelResultado(page)).toBe('Cédula 1.000.000.001.');

  await a.verificar(s, { secretos: ['Ficticia', '1.000.000.001', 'PRUEBA-RED-REI', FRASE, 'tutela'] });
});

// ===== Fase «pdf» en la app (PE-4; 10.5.1, paso B7, T-RD-03; PD-5b) =====
// La fase «pdf» de arriba prueba el lector con un arnés de Vite; esta es la app real, sin conexión desde el corte: cargar un PDF
// ficticio (texto bajo un recuadro negro, JavaScript incrustado) → Analizando → Vista previa (flujo por defecto, sin crear caso). El worker de pdf.js sale del propio origen
// como archivo del build (nunca blob:), no hay violaciones de CSP, consola ni red, y ni el texto ni el nombre del archivo viajan (INV-D05).
test('T-RD-03 INV-D05 @cero-red fase pdf en la app (B7): cargar un PDF → Analizando → Vista previa sin conexión, sin red y sin el nombre del archivo', async ({ arnes }) => {
  test.setTimeout(120_000);
  const a = await arnes();
  const s = await a.sesion();
  const page = await s.nuevaPagina();
  await page.goto('/');
  await a.cortar(s, page);
  await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
  await page.getByRole('tab', { name: 'Cargar archivo' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Sentencia de Prueba.pdf', mimeType: 'application/pdf', buffer: readFileSync(join('tests', 'fixtures', 'pdf-js-recuadro.pdf')),
  });
  await expect(page.locator('[data-prueba="archivo-cargado"]')).toContainText('Archivo cargado: PDF, ', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Anonimizar', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vista previa' })).toBeVisible({ timeout: 30_000 });
  // D-24: con el original en memoria la Vista previa muestra las páginas del PDF con recuadros (lienzos), sin red.
  await expect(page.locator('[data-prueba="paginas-pdf"]')).toBeVisible({ timeout: 30_000 });
  // V-39: el texto bajo el recuadro negro llega a la revisión (se ve en «Revisar dato por dato», la revisión de la v1.0).
  await aDetalle(page);
  await expect(page.locator('main')).toContainText('Pedro Ficticio Ejemplo');
  await expect(page.locator('body')).not.toContainText('Sentencia de Prueba');
  expect(await page.title()).toBe('Sig-Low');
  expect(s.vigilante.workers.some((u) => /^\/assets\/pdf\.worker-[\w-]+\.js$/.test(new URL(u).pathname))).toBe(true);
  expect(s.vigilante.peticiones.filter((q) => /^(data|blob):/.test(q.url))).toEqual([]);
  await a.verificar(s, { secretos: ['Pedro Ficticio Ejemplo', 'Sentencia de Prueba', 'PRUEBA-PDF'] });
});

// ===== T-RD-07 en local (PD-5b; V-11, DoD-19) =====
// El hash del HTML servido es el del build: por la red, desde el service worker sin conexión y por `verificar-despliegue.mjs` (T-PV-15), que
// contra tests/e2e/server.mjs sale con 0; una copia del build con un archivo alterado sale con 1. En el dominio oficial lo repite P0-5.
test('T-RD-07 @cero-red local: el HTML servido (en la red y sin conexión) es el del build y verificar-despliegue.mjs sale con 0; un archivo alterado, con 1', async ({ arnes }) => {
  test.setTimeout(120_000);
  const html = readFileSync(join('dist', 'index.html'));
  const lista = JSON.parse(readFileSync(join('dist', 'precache.json'), 'utf8')) as { archivos: { ruta: string; sha256: string }[] };
  expect(lista.archivos.find((x) => x.ruta === '/')?.sha256, 'el precache declara el hash de dist/index.html').toBe(sha256(html));

  const a = await arnes({ reporteCsp: false });
  const s = await a.sesion();
  const page = await s.nuevaPagina();
  const nav = await page.goto('/');
  expect(sha256(await nav!.body()), 'HTML de la primera carga').toBe(sha256(html));
  await a.esperarControlador(page);
  for (const ruta of ['/', '/index.html']) expect(sha256(await (await s.ctx.request.get(ruta, { maxRetries: 3 })).body()), ruta).toBe(sha256(html));

  // T-PV-15 contra el servidor local, con conexión (antes del corte: el script es un cliente más del servidor).
  const corre = (origen: string, ...args: string[]) => spawnSync(process.execPath, ['scripts/verificar-despliegue.mjs', origen, ...args], { encoding: 'utf8' });
  const limpio = corre(a.origen, '--dist', 'dist');
  expect({ estado: limpio.status, salida: limpio.stdout + limpio.stderr }).toEqual({ estado: 0, salida: expect.stringContaining('verificar-despliegue: OK') });
  const alterado = mkdtempSync(join(tmpdir(), 'siglow-despliegue-'));
  try {
    cpSync('dist', alterado, { recursive: true });
    writeFileSync(join(alterado, 'index.html'), html.toString('utf8').replace('</body>', '<!-- alterado --></body>'));
    const b = await arnes({ dir: alterado, reporteCsp: false });
    const roto = corre(b.origen, '--dist', 'dist');
    expect(roto.status, roto.stdout).toBe(1);
    expect(roto.stdout).toContain('/: SHA-256');
    expect(b.senuelo.peticiones()).toEqual([]);
  } finally {
    rmSync(alterado, { recursive: true, force: true });
  }

  // Sin conexión, el HTML sale del service worker y sigue siendo el del build.
  await a.cortar(s, page);
  const recarga = await page.reload();
  expect(recarga!.fromServiceWorker()).toBe(true);
  expect(sha256(await recarga!.body()), 'HTML servido por el service worker sin conexión').toBe(sha256(html));
  await a.verificar(s);
});
