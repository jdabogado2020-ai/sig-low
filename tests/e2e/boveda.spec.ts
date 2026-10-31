// T-CI-08 (PD-3; 10.8.2, 6.7.3, 3.4): calibración de PBKDF2 en Chrome y Edge instalados (canales `chrome` y `msedge`).
// Se compila un arnés con vault/crypto.ts y las opciones de Vite de la app, se sirve con tests/e2e/server.mjs, que aplica
// public/_headers (CSP, Trusted Types, COOP/COEP), y se mide en el navegador: t₆₀₀ₖ (5 veces), `it` calibrado, la derivación
// real con ese `it` y el vector V-SIGLOW-1 con el motor del navegador. Fuera de verify (10.0): sin @cero-red ni @humo.
// Los tiempos quedan en test-results/boveda-calibracion.json. Un canal que no está instalado se salta.
// T-BO-01 (PD-4; 6.7.4, 6.6.5, V-17 a V-19, V-23, V-35): en la app real (dist/) guardar → bloquear → reabrir → desbloquear,
// pagehide/pageshow y bloqueo a los 15 min con reloj simulado; en el arnés, el adaptador de la bóveda (borrar, borrar todo con
// otra pestaña, persist(), cuota real con CDP, exportar e importar con otra sal y conflicto, archivo manipulado). Llevan @humo.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { chromium, expect, test, type Page } from '@playwright/test';
import { build } from 'vite';

import type { AsuntoId } from '../../src/core/types';
import type { BovedaCompleta } from '../../src/ui/boveda-idb';
import { iteracionesPara } from '../../src/vault/crypto';
import { levantarServidor, type Servidor } from './lib/servidores';

const RAIZ = process.cwd();
const FUENTE = join(RAIZ, 'test-results', 'boveda-harness-src');
const CARPETA = join(RAIZ, 'test-results', 'boveda-harness');
const RESULTADOS = join(RAIZ, 'test-results', 'boveda-calibracion.json');
let ORIGEN = ''; // lo declara el servidor del arnés (puerto libre) en el beforeAll
const SHA_PLANO = '5e3e992300afc98202a3a8b2fcea0ae3572d5ff7e80e12be67693072255f36aa';
const SHA_CT = '6bcc6d2f9b887f5fdac1aa547ca85bad8d42acfbd0d8546fca39ddedc424a03b';

const HTML = `<!doctype html>
<html lang="es-CO" translate="no">
  <head><meta charset="utf-8" /><title>Sig-Low</title><script src="/tt-policy.js"></script></head>
  <body><script type="module" src="./boveda.ts"></script></body>
</html>
`;
// Arnés: no es parte de la app; solo devuelve tiempos y huellas, nunca texto plano.
const TS = `import { bovedaIdb } from '../../src/ui/boveda-idb.ts';
import { instalarBloqueo } from '../../src/ui/bloqueo.ts';
import { instalarPuertos } from '../../src/ui/servicios.ts';
import { abrirSiglow, armarSiglow, derivarClave, exportarSiglow, iteracionesPara, medirT600k, serializarPayload } from '../../src/vault/crypto.ts';
const FRASE = 'frase de prueba ficticia ñandú';
const ID = 'asu_00112233445566778899aabbccddeeff';
const ENC = 'sig-low/tabla;v=1;uso=exportacion;id=' + ID + ';kdf=PBKDF2;hash=SHA-256;it=600000;sal=AAECAwQFBgcICQoLDA0ODw==;cif=AES-GCM;iv=EBESExQVFhcYGRob;tag=128';
const AHORA = '2026-10-22T20:00:00.000Z';
const hex = async (b) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');
globalThis.__bovedaIdb = bovedaIdb;
// Ayudas del arnés para T-BO-01: registros crudos (sin descifrar), tablas ficticias de n entidades y el código de un rechazo.
globalThis.__ayuda = {
  crudos: () => new Promise((ok, mal) => { const q = indexedDB.open('siglow-boveda'); q.onerror = () => mal(q.error);
    q.onsuccess = () => { const db = q.result; const g = db.transaction('asuntos').objectStore('asuntos').getAll();
      g.onsuccess = () => { db.close(); ok(g.result); }; g.onerror = () => { db.close(); mal(g.error); }; }; }),
  tabla: (id, n) => { const entries = {}; for (let i = 1; i <= n; i++) { const d = '1.000.000.' + String(i).padStart(3, '0');
    entries['[CC_' + i + ']'] = { marker: '[CC_' + i + ']', family: 'CC', type: 'CC', canonicalKey: 'CC:' + (1000000000 + i), display: d,
      originals: [d], firstSeen: { docId: 'doc_00112233445566778899aabbccddeeff', partKind: 'cuerpo', partOrder: 0, start: 0 },
      documents: ['doc_00112233445566778899aabbccddeeff'], sameHolderAs: [] }; }
    return { asuntoId: id, counters: n ? { CC: n } : {}, entries, documents: [] }; },
  codigo: async (f) => { try { await f(); return 'SIN_ERROR'; } catch (e) { return (e && e.code) || 'SIN_CODIGO'; } },
  // PD-4-r1. Escrituras crudas de «otra versión» (sin el adaptador ni su aviso entre pestañas) y bases presentes.
  crudo: (f) => new Promise((ok, mal) => { const q = indexedDB.open('siglow-boveda'); q.onerror = () => mal(q.error);
    q.onsuccess = () => { const db = q.result; const tx = db.transaction('asuntos', 'readwrite'); f(tx.objectStore('asuntos'));
      tx.oncomplete = () => { db.close(); ok(); }; tx.onabort = () => { db.close(); mal(tx.error); }; }; }),
  borrarCrudo: (id) => globalThis.__ayuda.crudo((s) => s.delete(id)),
  alterarCreado: (id, creado) => globalThis.__ayuda.crudo((s) => { const g = s.get(id); g.onsuccess = () => s.put({ ...g.result, creado }); }),
  bases: async () => (await indexedDB.databases()).map((d) => d.name),
  idNuevo: () => 'asu_' + [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join(''),
  // Retiene el próximo cifrado (un guardado «en curso») hasta soltar(); dentro se resuelve cuando ya entró.
  retener: () => { const orig = crypto.subtle.encrypt; let soltar; let entro;
    const puerta = new Promise((ok) => { soltar = ok; }); const dentro = new Promise((ok) => { entro = ok; });
    Object.defineProperty(crypto.subtle, 'encrypt', { configurable: true, writable: true,
      value: async (...a) => { delete crypto.subtle.encrypt; entro(); await puerta; return orig.apply(crypto.subtle, a); } });
    globalThis.__puerta = { dentro, soltar }; },
  // Cuenta las derivaciones (deriveKey) mientras corre f.
  derivaciones: async (f) => { const orig = crypto.subtle.deriveKey; let n = 0;
    Object.defineProperty(crypto.subtle, 'deriveKey', { configurable: true, writable: true, value: (...a) => { n++; return orig.apply(crypto.subtle, a); } });
    try { return [await globalThis.__ayuda.codigo(f), n]; } finally { delete crypto.subtle.deriveKey; } },
  // Del .siglow descargado: su encabezado y los campos del asunto del texto plano (este queda en ceros).
  siglow: async (bytes, frase) => { const u8 = Uint8Array.from(bytes); const { encabezado, plano } = await abrirSiglow(u8, frase);
    try { const o = JSON.parse(new TextDecoder().decode(plano)); return { encabezado, asunto: o.asunto, entradas: Object.keys(o.table.entries).length, lista: o.caseList.map((c) => c.name) }; }
    finally { plano.fill(0); } },
  instalarBloqueo: () => { instalarPuertos({ boveda: bovedaIdb }); instalarBloqueo(); },
};
globalThis.__boveda = {
  async calibrar(n) {
    const t = [];
    for (let i = 0; i < n; i++) t.push(await medirT600k());
    return { t, it: t.map(iteracionesPara), seguro: isSecureContext, aislado: crossOriginIsolated };
  },
  async derivarCon(it) {
    const t0 = performance.now();
    await derivarClave(FRASE, crypto.getRandomValues(new Uint8Array(16)), it);
    return performance.now() - t0;
  },
  async vector() {
    const plano = serializarPayload({ formato: 'sig-low/tabla-plana', v: 1, asunto: { asuntoId: ID, codigo: 'PRUEBA-001', creado: AHORA, actualizado: AHORA },
      appVersion: '0.1.0', table: { asuntoId: ID, counters: {}, entries: {}, documents: [] }, caseList: [], relleno: '' });
    const shaPlano = await hex(plano);
    const clave = await derivarClave(FRASE, Uint8Array.from({ length: 16 }, (_, i) => i), 600000);
    // cifrar solo admite encabezados recién creados (B-15): el vector, con IV fijo, se cifra con Web Crypto del navegador.
    const iv = Uint8Array.from({ length: 12 }, (_, i) => 0x10 + i);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(ENC), tagLength: 128 }, clave, plano));
    const json = armarSiglow(ENC, ct);
    const nfd = await abrirSiglow(new TextEncoder().encode(json), FRASE.normalize('NFD'));
    // exportarSiglow (sin registro: «No guardar») deja el texto plano en ceros.
    const otro = plano.slice();
    await exportarSiglow(FRASE, ID, 600000, otro, null);
    return { shaPlano, shaCt: await hex(ct), largoCt: ct.byteLength, shaNfd: await hex(nfd.plano), planoEnCeros: otro.every((x) => x === 0) };
  },
};
`;

type Ayuda = {
  crudos(): Promise<Array<Record<string, unknown>>>;
  tabla(id: string, n: number): Record<string, unknown>;
  codigo(f: () => Promise<unknown>): Promise<string>;
  borrarCrudo(id: string): Promise<void>;
  alterarCreado(id: string, creado: string): Promise<void>;
  bases(): Promise<string[]>;
  idNuevo(): AsuntoId;
  retener(): void;
  derivaciones(f: () => Promise<unknown>): Promise<[string, number]>;
  siglow(bytes: number[], frase: string): Promise<{ encabezado: string; asunto: Record<string, string>; entradas: number; lista: string[] }>;
  instalarBloqueo(): void;
};
type Puerta = { __puerta: { dentro: Promise<void>; soltar(): void } };
type Calibracion = { t: number[]; it: number[]; seguro: boolean; aislado: boolean };
type Vector = { shaPlano: string; shaCt: string; largoCt: number; shaNfd: string; planoEnCeros: boolean };
const mediana = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };

test.describe('bóveda en el navegador (arnés)', () => {
  test.describe.configure({ mode: 'serial' });
  let servidor: Servidor | null = null;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    rmSync(FUENTE, { recursive: true, force: true });
    rmSync(CARPETA, { recursive: true, force: true });
    mkdirSync(FUENTE, { recursive: true });
    writeFileSync(join(FUENTE, 'boveda.html'), HTML);
    writeFileSync(join(FUENTE, 'boveda.ts'), TS);
    await build({
      configFile: false,
      root: FUENTE,
      publicDir: false,
      logLevel: 'silent',
      cacheDir: join(RAIZ, '.vite-cache'),
      define: { __SIGLOW_VERSION__: '"0.1.0"', __SIGLOW_MEDICION__: 'false' },
      oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
      build: {
        outDir: CARPETA, emptyOutDir: true, target: 'es2024', assetsInlineLimit: 0, sourcemap: false,
        modulePreload: { polyfill: false }, reportCompressedSize: false,
        rolldownOptions: { input: { boveda: join(FUENTE, 'boveda.html') }, output: { minify: { compress: { dropConsole: true, dropDebugger: true } } } },
      },
    });
    for (const f of ['_headers', 'tt-policy.js']) cpSync(join(RAIZ, 'public', f), join(CARPETA, f));
    writeFileSync(join(CARPETA, 'favicon.ico'), '');   // el navegador lo pide solo; sin él, un 404 en la consola
    servidor = await levantarServidor({ dir: CARPETA });
    ORIGEN = servidor.origen;
    writeFileSync(RESULTADOS, '{}\n');
  });
  test.afterAll(async () => { await servidor?.parar(); });

  for (const [nombre, canal] of [['Chrome', 'chrome'], ['Edge', 'msedge']] as const) {
    test(`T-CI-08 ${nombre}: t₆₀₀ₖ medido, it en [600 000, 5 000 000] y V-SIGLOW-1 con el motor del navegador`, async ({}, info) => {
      test.setTimeout(120_000);
      let navegador;
      try {
        navegador = await chromium.launch({ channel: canal });
      } catch {
        test.skip(true, `${nombre} no está instalado en este equipo`);
        return;
      }
      try {
        const contexto = await navegador.newContext({ serviceWorkers: 'block' });
        const page = await contexto.newPage();
        const consola: string[] = [];
        page.on('console', (m) => consola.push(m.text()));
        page.on('pageerror', (e) => consola.push(String(e.message)));
        page.on('response', (r) => { if (r.status() >= 400) consola.push(`${r.status()} ${new URL(r.url()).pathname}`); });
        await page.goto(`${ORIGEN}/boveda.html`);
        await page.waitForFunction(() => '__boveda' in globalThis);
        const api = 'globalThis.__boveda';

        const cal = await page.evaluate(`${api}.calibrar(5)`) as Calibracion;
        expect(cal.seguro).toBe(true);
        expect(cal.aislado).toBe(true);   // mismas cabeceras que producción (COOP/COEP)
        expect(cal.t).toHaveLength(5);
        cal.t.forEach((t, i) => {
          expect(t).toBeGreaterThan(0);
          expect(cal.it[i]).toBe(iteracionesPara(t));
          expect(cal.it[i]! >= 600000 && cal.it[i]! <= 5000000 && cal.it[i]! % 50000 === 0).toBe(true);
        });
        const itMediana = iteracionesPara(mediana(cal.t));
        const tConIt = await page.evaluate(`${api}.derivarCon(${itMediana})`) as number;
        expect(tConIt).toBeGreaterThan(0);
        expect(tConIt).toBeLessThan(10_000);

        const v = await page.evaluate(`${api}.vector()`) as Vector;
        expect(v).toEqual({ shaPlano: SHA_PLANO, shaCt: SHA_CT, largoCt: 4112, shaNfd: SHA_PLANO, planoEnCeros: true });
        expect(consola).toEqual([]);

        // navigator.userAgent lo fija el proyecto (devices['Desktop Chrome']); la versión real es la del ejecutable del canal.
        const version = navegador.version();
        expect(version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
        const fila = {
          navegador: nombre, version, t600kMs: cal.t.map((t) => Math.round(t)), t600kMedianaMs: Math.round(mediana(cal.t)),
          itPorMedida: cal.it, itCalibrado: itMediana, derivacionConItMs: Math.round(tConIt), crossOriginIsolated: cal.aislado,
        };
        const todo = existsSync(RESULTADOS) ? JSON.parse(readFileSync(RESULTADOS, 'utf8')) as Record<string, unknown> : {};
        todo[nombre] = fila;
        writeFileSync(RESULTADOS, JSON.stringify(todo, null, 2) + '\n');
        info.annotations.push({ type: 'T-CI-08', description: JSON.stringify(fila) });
        process.stdout.write(`T-CI-08 ${JSON.stringify(fila)}\n`);
        await contexto.close();
      } finally {
        await navegador.close();
      }
    });
  }
  // ===== T-BO-01 en el arnés: el adaptador real de la bóveda (src/ui/boveda-idb.ts) bajo la CSP y COEP de producción =====
  type G = { __bovedaIdb: BovedaCompleta };
  const FRASE = 'frase de prueba ficticia ñandú';
  const LISTA = [{ id: 'cas_00112233445566778899aabbccddeeff', name: 'Ana Ficticia Rojas', variants: [], kind: 'persona', role: 'demandante' }];

  test('T-BO-01 @humo INV-V01 INV-V07 INV-V09 arnés: guardar y abrir con tabla idéntica (0, 1 y 300 entidades), exportar e importar con otra sal, conflicto y archivo manipulado', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto(`${ORIGEN}/boveda.html`);
    await page.waitForFunction(() => '__bovedaIdb' in globalThis);
    const r = await page.evaluate(async ({ frase, lista }) => {
      const b = (globalThis as unknown as G).__bovedaIdb;
      const h = (globalThis as unknown as { __ayuda: Ayuda }).__ayuda;
      const latin1 = (b2: ArrayBuffer): string => Array.from(new Uint8Array(b2), (x) => String.fromCharCode(x)).join('');
      const c = await b.crear({ codigo: 'PRUEBA-001', frase });
      const out: Record<string, unknown> = { persisted: c.persisted, persistencia: await b.persistencia() };
      const ct: Record<number, number> = {};
      const identica: Record<number, boolean> = {};
      const cerrado: Record<number, string> = {};
      for (const n of [0, 1, 300]) {
        const t = h.tabla(c.asuntoId, n);
        await b.guardar(c.asuntoId, { caseList: lista as never, table: t as never });
        const reg = (await h.crudos()).find((x) => x['asuntoId'] === c.asuntoId)!;
        ct[n] = (reg['ct'] as ArrayBuffer).byteLength % 4096;
        b.cerrar();
        cerrado[n] = await h.codigo(() => b.guardar(c.asuntoId, { caseList: lista as never, table: t as never }));
        const a = await b.abrir(c.asuntoId, frase.normalize('NFD'));
        identica[n] = JSON.stringify(a.table) === JSON.stringify(t) && JSON.stringify(a.caseList) === JSON.stringify(lista);
      }
      Object.assign(out, { ct, identica, cerrado });
      out['fraseErronea'] = await h.codigo(() => b.abrir(c.asuntoId, 'frase de prueba ficticia nandu'));
      const todos = await h.crudos();
      out['campos'] = todos.map((x) => Object.keys(x).sort().join(','));
      out['claroConOriginal'] = todos.some((x) => JSON.stringify({ ...x, ct: undefined, iv: undefined }).includes('Ficticia'));
      out['ctConOriginal'] = todos.some((x) => latin1(x['ct'] as ArrayBuffer).includes('Ficticia') || latin1(x['ct'] as ArrayBuffer).includes('1.000.000.0'));
      out['cryptoKey'] = todos.some((x) => Object.values(x).some((v) => v instanceof CryptoKey));
      out['almacenes'] = [localStorage.length, sessionStorage.length, document.cookie];
      out['asuntoId'] = c.asuntoId;
      out['encabezado'] = todos[0]!['encabezado'];
      return out;
    }, { frase: FRASE, lista: LISTA });
    expect(r['persistencia']).toBe(r['persisted']);
    expect(r['ct']).toEqual({ 0: 16, 1: 16, 300: 16 });                                   // INV-V09
    expect(r['identica']).toEqual({ 0: true, 1: true, 300: true });                        // tabla idéntica tras cerrar y abrir
    expect(r['cerrado']).toEqual({ 0: 'SESION_DESCONOCIDA', 1: 'SESION_DESCONOCIDA', 300: 'SESION_DESCONOCIDA' });   // cerrar() descarta la clave
    expect(r['fraseErronea']).toBe('CONTRASENA_O_ARCHIVO');
    expect(r['campos']).toEqual(['actualizado,asuntoId,codigo,creado,ct,encabezado,iv']);  // INV-V01: solo los campos de 6.7.1
    expect([r['claroConOriginal'], r['ctConOriginal'], r['cryptoKey']]).toEqual([false, false, false]);   // INV-V01, INV-V07
    expect(r['almacenes']).toEqual([0, 0, '']);                                             // INV-V07
    const asuntoId = r['asuntoId'] as string;
    const salRegistro = /;sal=([^;]+);/.exec(r['encabezado'] as string)![1];

    // B-16: con el asunto guardado, una frase que no abre el registro no exporta nada.
    let descargas = 0;
    page.on('download', () => { descargas++; });
    expect(await page.evaluate(async ({ lista, id }) => {
      const h = (globalThis as unknown as { __ayuda: Ayuda }).__ayuda;
      return h.codigo(() => (globalThis as unknown as G).__bovedaIdb.exportar({ caseList: lista as never, table: h.tabla(id, 300) as never }, 'PRUEBA-001', 'frase de prueba ficticia nandu'));
    }, { lista: LISTA, id: r['asuntoId'] as string })).toBe('CONTRASENA_O_ARCHIVO');
    expect(descargas).toBe(0);

    // Exportar: descarga con nombre neutro y sal nueva.
    const [descarga] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(async ({ frase, lista, id }) => {
        const h = (globalThis as unknown as { __ayuda: Ayuda }).__ayuda;
        return (globalThis as unknown as G).__bovedaIdb.exportar({ caseList: lista as never, table: h.tabla(id, 300) as never }, 'PRUEBA-001', frase);
      }, { frase: FRASE, lista: LISTA, id: asuntoId }),
    ]);
    expect(descarga.suggestedFilename()).toMatch(/^sig-low-tabla-\d{8}-\d{4}\.siglow$/);
    const bytes = readFileSync((await descarga.path())!);
    const archivo = JSON.parse(bytes.toString('utf8')) as { kdf: { sal: string }; encabezado: string; ct: string };
    expect(archivo.encabezado).toContain(`;uso=exportacion;id=${asuntoId};`);
    expect(archivo.kdf.sal).not.toBe(salRegistro);
    expect(bytes.toString('utf8')).not.toContain('Ficticia');

    const imp = await page.evaluate(async ({ frase, bytes, id }) => {
      const b = (globalThis as unknown as G).__bovedaIdb;
      const h = (globalThis as unknown as { __ayuda: Ayuda }).__ayuda;
      const u8 = Uint8Array.from(bytes);
      const texto = new TextDecoder().decode(u8);
      const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
      const sal = (x: unknown): string => /;sal=([^;]+);/.exec(String(x))![1]!;
      const registro = async (aid: string): Promise<Record<string, unknown>> => (await h.crudos()).find((x) => x['asuntoId'] === aid)!;
      const out: Record<string, unknown> = {};
      out['conflicto'] = await h.codigo(() => b.importar(u8, frase));
      const otro = await b.importar(u8, frase, { codigoNuevo: 'PRUEBA-002' });
      out['otroCodigo'] = [otro.codigo, otro.asuntoId !== id];
      out['otroRepetido'] = await h.codigo(() => b.importar(u8, frase, { codigoNuevo: 'PRUEBA-002' }));
      const a = await b.abrir(otro.asuntoId, frase);
      out['otraTabla'] = [a.table.asuntoId === otro.asuntoId, Object.keys(a.table.entries).length, a.caseList[0]?.name === 'Ana Ficticia Rojas'];
      const antes = await registro(id);
      const reemplazo = await b.importar(u8, frase, { reemplazar: true });
      const despues = await registro(id);
      const j = JSON.parse(texto) as Record<string, unknown>;
      out['reemplazo'] = [reemplazo.asuntoId === id, reemplazo.codigo];
      out['sales'] = new Set([sal(antes['encabezado']), sal(despues['encabezado']), (j['kdf'] as { sal: string }).sal, sal((await registro(otro.asuntoId))['encabezado'])]).size;
      // Archivo manipulado (6.7.6): nada se escribe.
      const cuantos = (await h.crudos()).length;
      const ctMalo = String(j['ct']);
      out['manipulado'] = [
        await h.codigo(() => b.importar(enc(JSON.stringify({ ...j, ct: (ctMalo[0] === 'A' ? 'B' : 'A') + ctMalo.slice(1) })), frase, { reemplazar: true })),
        await h.codigo(() => b.importar(enc(JSON.stringify({ ...j, encabezado: String(j['encabezado']).replace('uso=exportacion', 'uso=almacen') })), frase, { reemplazar: true })),
        await h.codigo(() => b.importar(enc(JSON.stringify({ ...j, v: 2 })), frase, { reemplazar: true })),
        await h.codigo(() => b.importar(new Uint8Array(6 * 1024 * 1024), frase, { reemplazar: true })),
        await h.codigo(() => b.importar(u8, 'frase de prueba ficticia nandu', { reemplazar: true })),
      ];
      out['sinEscribir'] = (await h.crudos()).length === cuantos;
      await b.borrarAsunto(otro.asuntoId);
      out['trasBorrar'] = (await b.listar()).map((x) => x.codigo);
      return out;
    }, { frase: FRASE, bytes: Array.from(bytes), id: asuntoId });
    expect(imp['conflicto']).toBe('ASUNTO_EXISTENTE');                    // paso 12, M-113
    expect(imp['otroCodigo']).toEqual(['PRUEBA-002', true]);              // «Importar con otro código» (el id también chocaba)
    expect(imp['otroRepetido']).toBe('ASUNTO_EXISTENTE');
    expect(imp['otraTabla']).toEqual([true, 300, true]);
    expect(imp['reemplazo']).toEqual([true, 'PRUEBA-001']);               // «Reemplazar»
    expect(imp['sales']).toBe(4);                                         // registro, reemplazo, .siglow e importado: sales distintas
    expect(imp['manipulado']).toEqual(['CONTRASENA_O_ARCHIVO', 'ARCHIVO_ALTERADO', 'VERSION_MAS_RECIENTE', 'ARCHIVO_DEMASIADO_GRANDE', 'CONTRASENA_O_ARCHIVO']);
    expect(imp['sinEscribir']).toBe(true);
    expect(imp['trasBorrar']).toEqual(['PRUEBA-001']);                    // «Borrar» un asunto (M-109)
  });

  test('T-BO-01 @humo arnés: cuota agotada al confirmar → CUOTA_EXCEDIDA sin perder el registro; «Borrar todo» con otra pestaña abierta (normal y con conexión retenida → bloqueado, M-112)', async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.goto(`${ORIGEN}/boveda.html`);
    await page.waitForFunction(() => '__bovedaIdb' in globalThis);
    const c = await page.evaluate((frase) => (globalThis as unknown as G).__bovedaIdb.crear({ codigo: 'PRUEBA-010', frase }), FRASE);
    // Cuota agotada: Chromium la informa al confirmar, abortando la transacción con tx.error = QuotaExceededError. En el contexto
    // efímero de Playwright Storage.overrideQuotaForOrigin (CDP) no limita IndexedDB, así que se reproduce ese aborto exacto.
    const cuota = await page.evaluate(async ({ id, frase }) => {
      const h = (globalThis as unknown as { __ayuda: Ayuda }).__ayuda;
      const b = (globalThis as unknown as G).__bovedaIdb;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...a: Parameters<IDBObjectStore['put']>) {
        const tx = this.transaction;
        const req = put.apply(this, a);
        req.addEventListener('success', () => {
          Object.defineProperty(tx, 'error', { configurable: true, get: () => new DOMException('cuota', 'QuotaExceededError') });
          tx.abort();
        });
        return req;
      };
      let codigo: string;
      try {
        codigo = await h.codigo(() => b.guardar(id, { caseList: [], table: h.tabla(id, 3) as never }));
      } finally {
        IDBObjectStore.prototype.put = put;
      }
      b.cerrar();
      const abierto = await b.abrir(id, frase);   // el aborto deshizo la escritura: queda el registro anterior
      return [codigo, Object.keys(abierto.table.entries).length];
    }, { id: c.asuntoId, frase: FRASE });
    expect(cuota).toEqual(['CUOTA_EXCEDIDA', 0]);

    // Otra pestaña con su conexión normal: onversionchange la cierra y el borrado sigue.
    const otra = await context.newPage();
    await otra.goto(`${ORIGEN}/boveda.html`);
    await otra.waitForFunction(() => '__bovedaIdb' in globalThis);
    expect((await otra.evaluate(() => (globalThis as unknown as G).__bovedaIdb.listar())).map((x) => x.codigo)).toEqual(['PRUEBA-010']);
    expect(await page.evaluate(() => (globalThis as unknown as G).__bovedaIdb.borrarTodo())).toBe('borrado');
    const bases = (): Promise<string[]> => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ''));
    expect(await bases()).not.toContain('siglow-boveda');
    // Una pestaña que retiene la conexión (sin onversionchange, p. ej. una versión vieja): bloqueado → M-112.
    await page.evaluate((frase) => (globalThis as unknown as G).__bovedaIdb.crear({ codigo: 'PRUEBA-011', frase }), FRASE);
    await otra.evaluate(() => new Promise<void>((ok) => {
      const q = indexedDB.open('siglow-boveda');
      q.onsuccess = () => { (globalThis as unknown as { __retenida: IDBDatabase }).__retenida = q.result; ok(); };
    }));
    expect(await page.evaluate(() => (globalThis as unknown as G).__bovedaIdb.borrarTodo())).toBe('bloqueado');
    await otra.close();
    await expect.poll(bases, { timeout: 10_000 }).not.toContain('siglow-boveda');
  });

  // ===== PD-4-r1: M-5, M-6, B-20 a B-24 (revisión P0-6a de PD-4 y de PC-6) =====
  type GA = { __bovedaIdb: BovedaCompleta; __ayuda: Ayuda } & Puerta;
  async function preparar(p: Page): Promise<void> {
    await p.goto(`${ORIGEN}/boveda.html`);
    await p.waitForFunction(() => '__bovedaIdb' in globalThis);
  }
  /** Crea un asunto guardado con `n` entidades y la lista del caso; devuelve su asuntoId. */
  const crearCon = (p: Page, codigo: string, n: number, retener = false): Promise<AsuntoId> => p.evaluate(async ({ codigo, n, frase, lista, retener }) => {
    const g = globalThis as unknown as GA;
    const c = await g.__bovedaIdb.crear({ codigo, frase });
    if (n > 0) await g.__bovedaIdb.guardar(c.asuntoId, { caseList: lista as never, table: g.__ayuda.tabla(c.asuntoId, n) as never });
    if (retener) g.__ayuda.retener();
    return c.asuntoId;
  }, { codigo, n, frase: FRASE, lista: LISTA, retener });
  /** Código del rechazo de un guardado con `n` entidades ('SIN_ERROR' si guarda). */
  const guardarCodigo = (p: Page, id: AsuntoId, n: number): Promise<string> => p.evaluate(({ id, n }) => {
    const g = globalThis as unknown as GA;
    return g.__ayuda.codigo(() => g.__bovedaIdb.guardar(id, { caseList: [], table: g.__ayuda.tabla(id, n) as never }));
  }, { id, n });
  const dentro = (p: Page): Promise<void> => p.evaluate(() => (globalThis as unknown as GA).__puerta.dentro);
  const soltar = (p: Page): Promise<void> => p.evaluate(() => { (globalThis as unknown as GA).__puerta.soltar(); });
  const basesDe = (p: Page): Promise<string[]> => p.evaluate(() => (globalThis as unknown as GA).__ayuda.bases());

  test('T-BO-01 @humo arnés M-5: un registro borrado no vuelve al guardar (otra pestaña lo borra, «Borrar todo» con un guardado en curso, datos del sitio borrados)', async ({ page, context }) => {
    test.setTimeout(240_000);
    await preparar(page);
    const otra = await context.newPage();
    await preparar(otra);

    // A: otra pestaña borra el registro sin avisar (el almacén directo, o una versión sin el canal): ni el primer guardado ni
    // los siguientes lo recrean.
    const a = await crearCon(page, 'PRUEBA-020', 1);
    await otra.evaluate((id) => (globalThis as unknown as GA).__ayuda.borrarCrudo(id), a);
    expect(await guardarCodigo(page, a, 2)).toBe('SESION_DESCONOCIDA');
    expect(await guardarCodigo(page, a, 3)).toBe('SESION_DESCONOCIDA');
    expect(await page.evaluate(async () => (await (globalThis as unknown as GA).__ayuda.crudos()).length)).toBe(0);

    // A con el adaptador: «Borrar» en otra pestaña avisa por el canal y esta descarta la clave enseguida.
    const a2 = await crearCon(page, 'PRUEBA-021', 1);
    await otra.evaluate((id) => (globalThis as unknown as GA).__bovedaIdb.borrarAsunto(id), a2);
    expect(await guardarCodigo(page, a2, 2)).toBe('SESION_DESCONOCIDA');
    expect((await page.evaluate(() => (globalThis as unknown as GA).__bovedaIdb.listar())).map((x) => x.codigo)).toEqual([]);

    // D: «Borrar todo» en otra pestaña con un guardado en curso aquí (cifrado retenido): la base no vuelve.
    const d = await crearCon(page, 'PRUEBA-022', 1, true);
    const guardadoD = guardarCodigo(page, d, 2);
    await dentro(page);
    expect(await otra.evaluate(() => (globalThis as unknown as GA).__bovedaIdb.borrarTodo())).toBe('borrado');
    await soltar(page);
    expect(await guardadoD).toBe('SESION_DESCONOCIDA');
    expect(await basesDe(page)).not.toContain('siglow-boveda');

    // F: borrar los datos del sitio (cierre forzado de la conexión, como «Borrar datos de navegación»), sin y con un guardado en curso.
    const cdp = await context.newCDPSession(page);
    const borrarDatos = async (): Promise<void> => { await cdp.send('Storage.clearDataForOrigin', { origin: ORIGEN, storageTypes: 'indexeddb' }); };
    const f = await crearCon(page, 'PRUEBA-023', 1);
    await borrarDatos();
    expect(await guardarCodigo(page, f, 2)).toBe('SESION_DESCONOCIDA');
    expect(await basesDe(page)).not.toContain('siglow-boveda');
    const f2 = await crearCon(page, 'PRUEBA-024', 1, true);
    const guardadoF = guardarCodigo(page, f2, 2);
    await dentro(page);
    await borrarDatos();
    await soltar(page);
    expect(await guardadoF).toBe('SESION_DESCONOCIDA');
    expect(await basesDe(page)).not.toContain('siglow-boveda');
    await otra.close();
  });

  test('T-BO-01 @humo arnés B-20: sin su registro, el asunto guardado no se exporta con ninguna frase; con «No guardar», solo con una frase válida', async ({ page, context }) => {
    test.setTimeout(120_000);
    await preparar(page);
    let descargas = 0;
    page.on('download', () => { descargas++; });
    const id = await crearCon(page, 'PRUEBA-030', 1);
    const otra = await context.newPage();
    await preparar(otra);
    await otra.evaluate((x) => (globalThis as unknown as GA).__ayuda.borrarCrudo(x), id);
    const exportarCodigo = (asuntoId: AsuntoId, codigo: string, frase: string): Promise<string> => page.evaluate(({ asuntoId, codigo, frase, lista }) => {
      const g = globalThis as unknown as GA;
      return g.__ayuda.codigo(() => g.__bovedaIdb.exportar({ caseList: lista as never, table: g.__ayuda.tabla(asuntoId, 1) as never }, codigo, frase));
    }, { asuntoId, codigo, frase, lista: LISTA });
    expect(await exportarCodigo(id, 'PRUEBA-030', '1')).toBe('SESION_DESCONOCIDA');
    expect(await exportarCodigo(id, 'PRUEBA-030', FRASE)).toBe('SESION_DESCONOCIDA');
    expect(descargas).toBe(0);
    // «No guardar» (sin registro y sin clave): validatePassphrase también en el adaptador.
    const sinGuardar = await page.evaluate(() => (globalThis as unknown as GA).__ayuda.idNuevo());
    expect(await exportarCodigo(sinGuardar, 'PRUEBA-031', '1')).toBe('ENTRADA_INVALIDA');
    expect(descargas).toBe(0);
    const [descarga] = await Promise.all([page.waitForEvent('download'), exportarCodigo(sinGuardar, 'PRUEBA-031', FRASE)]);
    expect(descarga.suggestedFilename()).toMatch(/^sig-low-tabla-\d{8}-\d{4}\.siglow$/);
    expect(descargas).toBe(1);
    await otra.close();
  });

  test('T-BO-01 @humo arnés B-21: cerrar() aborta un abrir, un crear y un «Pasar a Guardar cifrada» en curso; pageshow con persisted descarta la clave', async ({ page }) => {
    test.setTimeout(120_000);
    await preparar(page);
    const r = await page.evaluate(async ({ frase, lista }) => {
      const g = globalThis as unknown as GA;
      const b = g.__bovedaIdb;
      const h = g.__ayuda;
      const out: Record<string, unknown> = {};
      // crear: cerrar() durante la derivación → ni clave ni registro.
      const pc = b.crear({ codigo: 'PRUEBA-040', frase });
      b.cerrar();
      out['crear'] = await h.codigo(() => pc);
      // «Pasar a Guardar cifrada» desde «No guardar».
      const idNg = h.idNuevo();
      const pp = b.pasarAGuardar('PRUEBA-041', frase, { caseList: lista as never, table: h.tabla(idNg, 1) as never });
      b.cerrar();
      out['pasar'] = await h.codigo(() => pp);
      out['lista'] = (await b.listar()).map((x) => x.codigo);
      // abrir: la clave derivada se descarta y el asunto no queda abierto.
      const c = await b.crear({ codigo: 'PRUEBA-042', frase });
      b.cerrar();
      const pa = b.abrir(c.asuntoId, frase);
      b.cerrar();
      out['abrir'] = await h.codigo(() => pa);
      out['guardarTrasAbrir'] = await h.codigo(() => b.guardar(c.asuntoId, { caseList: [], table: h.tabla(c.asuntoId, 1) as never }));
      // pageshow con persisted (restaurada de la caché de páginas) llama a boveda.cerrar() (bloqueo.ts de PC-1).
      h.instalarBloqueo();
      await b.abrir(c.asuntoId, frase);
      out['guardarAbierto'] = await h.codigo(() => b.guardar(c.asuntoId, { caseList: [], table: h.tabla(c.asuntoId, 1) as never }));
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      out['guardarTrasPageshow'] = await h.codigo(() => b.guardar(c.asuntoId, { caseList: [], table: h.tabla(c.asuntoId, 2) as never }));
      return out;
    }, { frase: FRASE, lista: LISTA });
    expect(r).toEqual({
      crear: 'SESION_DESCONOCIDA', pasar: 'SESION_DESCONOCIDA', lista: [], abrir: 'SESION_DESCONOCIDA', guardarTrasAbrir: 'SESION_DESCONOCIDA',
      guardarAbierto: 'SIN_ERROR', guardarTrasPageshow: 'SESION_DESCONOCIDA',
    });
  });

  test('T-BO-01 @humo arnés B-22: exportar y listar toman «creado» del texto cifrado; un «creado» en claro alterado no abre ni pasa al .siglow', async ({ page }) => {
    test.setTimeout(120_000);
    await preparar(page);
    const id = await crearCon(page, 'PRUEBA-050', 1);
    const original = await page.evaluate(async (x) => {
      const g = globalThis as unknown as GA;
      const creado = String((await g.__ayuda.crudos()).find((r) => r['asuntoId'] === x)!['creado']);
      await g.__ayuda.alterarCreado(x, '2001-01-01T00:00:00.000Z');
      return creado;
    }, id);
    expect(original).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const [descarga] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(({ x, frase, lista }) => {
        const g = globalThis as unknown as GA;
        return g.__bovedaIdb.exportar({ caseList: lista as never, table: g.__ayuda.tabla(x, 1) as never }, 'PRUEBA-050', frase);
      }, { x: id, frase: FRASE, lista: LISTA }),
    ]);
    const bytes = [...readFileSync((await descarga.path())!)];
    const s = await page.evaluate(({ bytes, frase }) => (globalThis as unknown as GA).__ayuda.siglow(bytes, frase), { bytes, frase: FRASE });
    expect(s.asunto['creado']).toBe(original);
    // Con el asunto abierto, listar() también da el del texto cifrado.
    expect((await page.evaluate(() => (globalThis as unknown as GA).__bovedaIdb.listar())).map((x) => x.creado)).toEqual([original]);
    // Al abrir, el campo en claro alterado se nota (como el código): ARCHIVO_ALTERADO, también con un valor que no es ISO.
    const abrir = await page.evaluate(async ({ x, frase }) => {
      const g = globalThis as unknown as GA;
      g.__bovedaIdb.cerrar();
      const fecha = await g.__ayuda.codigo(() => g.__bovedaIdb.abrir(x, frase));
      await g.__ayuda.alterarCreado(x, 'x');
      return [fecha, await g.__ayuda.codigo(() => g.__bovedaIdb.abrir(x, frase))];
    }, { x: id, frase: FRASE });
    expect(abrir).toEqual(['ARCHIVO_ALTERADO', 'ARCHIVO_ALTERADO']);
  });

  test('T-BO-01 @humo arnés M-6 y B-23: «cambiar frase» en la cola, con sal e IV nuevos; un guardado con la clave vieja (otra pestaña o en curso) no lo deshace', async ({ page, context }) => {
    test.setTimeout(300_000);
    const NUEVA = 'otra frase ficticia de prueba ñame';
    const NUEVA2 = 'tercera frase ficticia de ensayo';
    await preparar(page);
    const id = await crearCon(page, 'PRUEBA-060', 2);
    const encabezado = (p: Page): Promise<string> => p.evaluate(async (x) =>
      String((await (globalThis as unknown as GA).__ayuda.crudos()).find((r) => r['asuntoId'] === x)!['encabezado']), id);
    const e0 = await encabezado(page);
    const cambiar = (p: Page, actual: string, nueva: string): Promise<string> => p.evaluate(({ x, actual, nueva }) => {
      const g = globalThis as unknown as GA;
      return g.__ayuda.codigo(() => g.__bovedaIdb.cambiarFrase(x, actual, nueva));
    }, { x: id, actual, nueva });
    // Frase nueva débil: ENTRADA_INVALIDA sin derivar nada; frase actual errónea: CONTRASENA_O_ARCHIVO. El registro no cambia.
    expect(await page.evaluate(({ x, frase }) => {
      const g = globalThis as unknown as GA;
      return g.__ayuda.derivaciones(() => g.__bovedaIdb.cambiarFrase(x, frase, 'corta'));
    }, { x: id, frase: FRASE })).toEqual(['ENTRADA_INVALIDA', 0]);
    expect(await cambiar(page, 'frase de prueba ficticia nandu', NUEVA)).toBe('CONTRASENA_O_ARCHIVO');
    expect(await encabezado(page)).toBe(e0);
    // Cuota agotada al confirmar: CUOTA_EXCEDIDA y el registro sigue igual (abre con la actual).
    const cuota = await page.evaluate(async ({ x, frase, nueva }) => {
      const g = globalThis as unknown as GA;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...a: Parameters<IDBObjectStore['put']>) {
        const tx = this.transaction;
        const req = put.apply(this, a);
        req.addEventListener('success', () => {
          Object.defineProperty(tx, 'error', { configurable: true, get: () => new DOMException('cuota', 'QuotaExceededError') });
          tx.abort();
        });
        return req;
      };
      try {
        return await g.__ayuda.codigo(() => g.__bovedaIdb.cambiarFrase(x, frase, nueva));
      } finally {
        IDBObjectStore.prototype.put = put;
      }
    }, { x: id, frase: FRASE, nueva: NUEVA });
    expect(cuota).toBe('CUOTA_EXCEDIDA');
    expect(await encabezado(page)).toBe(e0);
    // B-23: un «creado» en claro alterado no pasa al registro nuevo (se rechaza al comprobar la frase actual).
    const creado = await page.evaluate(async (x) => {
      const g = globalThis as unknown as GA;
      const original = String((await g.__ayuda.crudos()).find((r) => r['asuntoId'] === x)!['creado']);
      await g.__ayuda.alterarCreado(x, '2001-01-01T00:00:00.000Z');
      return original;
    }, id);
    expect(await cambiar(page, FRASE, NUEVA)).toBe('ARCHIVO_ALTERADO');
    await page.evaluate(({ x, creado }) => (globalThis as unknown as GA).__ayuda.alterarCreado(x, creado), { x: id, creado });

    // Dos pestañas más con el asunto abierto con la frase actual; en `otra`, además, un guardado en curso con la clave vieja.
    const otra = await context.newPage();
    const tercera = await context.newPage();
    for (const p of [otra, tercera]) {
      await preparar(p);
      await p.evaluate(({ x, frase }) => (globalThis as unknown as GA).__bovedaIdb.abrir(x, frase), { x: id, frase: FRASE });
    }
    await otra.evaluate(() => { (globalThis as unknown as GA).__ayuda.retener(); });
    const viejo = guardarCodigo(otra, id, 5);
    await dentro(otra);
    expect(await cambiar(page, FRASE, NUEVA)).toBe('SIN_ERROR');
    await soltar(otra);
    expect(await viejo).toBe('SESION_DESCONOCIDA');                         // M-6: la sal ya no es la de su clave
    // El aviso del canal: la tercera descartó su clave (sin él, exportar con la frase vieja daría CONTRASENA_O_ARCHIVO).
    await expect.poll(() => tercera.evaluate(({ x, frase, lista }) => {
      const g = globalThis as unknown as GA;
      return g.__ayuda.codigo(() => g.__bovedaIdb.exportar({ caseList: lista as never, table: g.__ayuda.tabla(x, 2) as never }, 'PRUEBA-060', frase));
    }, { x: id, frase: FRASE, lista: LISTA })).toBe('SESION_DESCONOCIDA');
    expect(await guardarCodigo(tercera, id, 6)).toBe('SESION_DESCONOCIDA');
    const e1 = await encabezado(page);
    const campo = (e: string, k: string): string => new RegExp(`;${k}=([^;]+);`).exec(e)![1]!;
    expect(campo(e1, 'sal')).not.toBe(campo(e0, 'sal'));
    expect(campo(e1, 'iv')).not.toBe(campo(e0, 'iv'));
    const it1 = Number(campo(e1, 'it'));
    expect(it1 >= 600000 && it1 <= 5000000 && it1 % 50000 === 0).toBe(true);

    // Esta pestaña sigue con el asunto abierto, ya con la clave nueva. En la cola: un guardado en curso y después otro cambio.
    await page.evaluate(() => { (globalThis as unknown as GA).__ayuda.retener(); });
    const enCurso = guardarCodigo(page, id, 3);
    await dentro(page);
    const segundo = cambiar(page, NUEVA, NUEVA2);
    await soltar(page);
    expect([await enCurso, await segundo]).toEqual(['SIN_ERROR', 'SIN_ERROR']);
    const fin = await page.evaluate(async ({ x, frase, nueva, nueva2 }) => {
      const g = globalThis as unknown as GA;
      const b = g.__bovedaIdb;
      b.cerrar();
      const vieja = await g.__ayuda.codigo(() => b.abrir(x, frase));
      const intermedia = await g.__ayuda.codigo(() => b.abrir(x, nueva));
      const a = await b.abrir(x, nueva2);
      const crudo = (await g.__ayuda.crudos()).find((r) => r['asuntoId'] === x)!;
      return { vieja, intermedia, entradas: Object.keys(a.table.entries).length, creado: crudo['creado'], claro: JSON.stringify({ ...crudo, ct: undefined, iv: undefined }).includes('Ficticia') };
    }, { x: id, frase: FRASE, nueva: NUEVA, nueva2: NUEVA2 });
    expect(fin).toEqual({ vieja: 'CONTRASENA_O_ARCHIVO', intermedia: 'CONTRASENA_O_ARCHIVO', entradas: 3, creado, claro: false });
    await otra.close();
    await tercera.close();
  });

  test('T-BO-01 @humo arnés B-24: exportarAsunto exporta sin abrir el asunto: frase errónea sin descarga, clave fuera de memoria y .siglow que abre con la frase', async ({ page }) => {
    test.setTimeout(120_000);
    await preparar(page);
    let descargas = 0;
    page.on('download', () => { descargas++; });
    const id = await crearCon(page, 'PRUEBA-070', 2);
    const otroAbierto = await crearCon(page, 'PRUEBA-071', 1);
    const r0 = await page.evaluate(async (x) => {
      const g = globalThis as unknown as GA;
      // Solo PRUEBA-071 queda abierto: la clave de PRUEBA-070 se descarta (como tras un bloqueo y «Abrir» el otro).
      g.__bovedaIdb.cerrar();
      await g.__bovedaIdb.abrir(x.otro, x.frase);
      const crudo = (await g.__ayuda.crudos()).find((r) => r['asuntoId'] === x.id)!;
      return { encabezado: String(crudo['encabezado']), creado: String(crudo['creado']), mal: await g.__ayuda.codigo(() => g.__bovedaIdb.exportarAsunto(x.id, 'frase de prueba ficticia nandu')) };
    }, { id, otro: otroAbierto, frase: FRASE });
    expect(r0.mal).toBe('CONTRASENA_O_ARCHIVO');
    expect(descargas).toBe(0);
    const [descarga] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(({ x, frase }) => (globalThis as unknown as GA).__bovedaIdb.exportarAsunto(x, frase), { x: id, frase: FRASE }),
    ]);
    expect(descarga.suggestedFilename()).toMatch(/^sig-low-tabla-\d{8}-\d{4}\.siglow$/);
    const texto = readFileSync((await descarga.path())!);
    expect(texto.toString('utf8')).not.toContain('Ficticia');
    const s = await page.evaluate(({ bytes, frase }) => (globalThis as unknown as GA).__ayuda.siglow(bytes, frase), { bytes: [...texto], frase: FRASE });
    expect(s.encabezado).toContain(`;uso=exportacion;id=${id};`);
    expect(/;sal=([^;]+);/.exec(s.encabezado)![1]).not.toBe(/;sal=([^;]+);/.exec(r0.encabezado)![1]);
    expect([s.entradas, s.lista, s.asunto['creado'], s.asunto['codigo']]).toEqual([2, ['Ana Ficticia Rojas'], r0.creado, 'PRUEBA-070']);
    // La clave del asunto exportado no quedó en memoria; el otro asunto sigue abierto.
    expect([await guardarCodigo(page, id, 3), await guardarCodigo(page, otroAbierto, 2)]).toEqual(['SESION_DESCONOCIDA', 'SIN_ERROR']);
  });
});

// ===== T-BO-01 en la app real (dist/ servido por server.mjs con _headers): la interfaz de PC-1 con la bóveda conectada =====
test.describe('bóveda en la app', () => {
  test.describe.configure({ timeout: 120_000 });
  const FRASE_APP = 'frase de prueba ficticia ñandú';
  const ETIQUETA_FRASE = 'Frase de paso. Mínimo 15 caracteres; puede usar varias palabras separadas por espacios.';

  /** Crea un asunto con «Guardar tabla cifrada», agrega «Ana Ficticia Rojas» a la lista y continúa (la lista se guarda cifrada). */
  async function crearGuardado(page: Page, codigo: string): Promise<void> {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Inicio' })).toBeVisible();
    await page.getByLabel('Código del asunto').fill(codigo);
    await page.getByRole('radio', { name: /^Guardar tabla cifrada/ }).check();
    await page.getByLabel(ETIQUETA_FRASE, { exact: true }).fill(FRASE_APP);
    await page.getByLabel('Repita la frase de paso', { exact: true }).fill(FRASE_APP);
    await page.getByRole('checkbox', { name: /^Entiendo que Sig-Low no guarda mi frase/ }).check();
    await page.getByRole('button', { name: 'Crear asunto' }).click();
    // Resultado de persist() visible (M-21 concedido o M-22 no concedido).
    await expect(page.locator('[data-prueba="aviso-M-21"], [data-prueba="aviso-M-22"]')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('textbox', { name: 'Texto de la lista' }).fill('Ana Ficticia Rojas; demandante');
    await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('textbox', { name: 'Texto del documento' })).toBeVisible({ timeout: 30_000 });
  }

  async function abrirGuardado(page: Page, codigo: string, frase: string): Promise<void> {
    const sel = page.getByLabel('Asunto guardado', { exact: true });
    const valor = await sel.locator('option', { hasText: codigo }).getAttribute('value');
    await sel.selectOption(valor!);
    await page.getByLabel('Frase de paso del asunto', { exact: true }).fill(frase);
    await page.getByRole('button', { name: 'Abrir para anonimizar' }).click();
  }

  const M102 = 'Sig-Low se bloqueó y borró de la memoria el documento y la revisión en curso.';

  test('T-BO-01 @humo INV-V01 INV-V07 app: guardar → Bloquear → recargar → desbloquear con la lista idéntica; frase errónea → M-201; registro crudo sin originales', async ({ page }) => {
    await crearGuardado(page, 'PRUEBA-001');
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Inicio' })).toBeVisible();
    await expect(page.getByText(M102)).toBeVisible();
    // INV-V01 e INV-V07 sobre el almacenamiento crudo del origen.
    const crudo = await page.evaluate(async () => {
      const regs = await new Promise<Array<Record<string, unknown>>>((ok, mal) => {
        const q = indexedDB.open('siglow-boveda');
        q.onerror = () => { mal(q.error); };
        q.onsuccess = () => {
          const db = q.result;
          const g = db.transaction('asuntos').objectStore('asuntos').getAll();
          g.onsuccess = () => { db.close(); ok(g.result as Array<Record<string, unknown>>); };
        };
      });
      const latin1 = (b: ArrayBuffer): string => Array.from(new Uint8Array(b), (x) => String.fromCharCode(x)).join('');
      return {
        n: regs.length,
        campos: regs.map((x) => Object.keys(x).sort().join(',')),
        claro: regs.map((x) => JSON.stringify({ ...x, ct: undefined, iv: undefined })).join(''),
        ct: regs.map((x) => latin1(x['ct'] as ArrayBuffer)).join(''),
        modulo: regs.map((x) => (x['ct'] as ArrayBuffer).byteLength % 4096),
        clave: regs.some((x) => Object.values(x).some((v) => v instanceof CryptoKey)),
        almacenes: [localStorage.length, sessionStorage.length, document.cookie],
        bases: (await indexedDB.databases()).map((d) => d.name),
      };
    });
    expect(crudo.n).toBe(1);
    expect(crudo.campos).toEqual(['actualizado,asuntoId,codigo,creado,ct,encabezado,iv']);
    expect(crudo.claro).toContain('PRUEBA-001');
    expect(crudo.claro).not.toContain('Ficticia');
    expect(crudo.ct).not.toContain('Ficticia');
    expect(crudo.modulo).toEqual([16]);
    expect(crudo.clave).toBe(false);
    expect(crudo.almacenes).toEqual([0, 0, '']);
    expect(crudo.bases).toEqual(['siglow-boveda']);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Inicio' })).toBeVisible();
    await abrirGuardado(page, 'PRUEBA-001', 'frase de prueba ficticia nandu');
    await expect(page.getByText('Frase de paso incorrecta o archivo dañado.')).toBeVisible({ timeout: 30_000 });
    await abrirGuardado(page, 'PRUEBA-001', FRASE_APP.normalize('NFD'));
    await expect(page.getByText('Ana Ficticia Rojas').first()).toBeVisible({ timeout: 30_000 });
    expect(await page.title()).toBe('Sig-Low');
  });

  test('T-BO-01 @humo app: pagehide bloquea y pageshow con persisted pide la frase con el estado vacío; la tabla sigue cifrada', async ({ page }) => {
    await crearGuardado(page, 'PRUEBA-002');
    await page.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expect(page.getByRole('heading', { level: 1, name: 'Inicio' })).toBeVisible();
    await expect(page.getByText(M102)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Texto del documento' })).toHaveCount(0);
    await expect(page.getByText('Ana Ficticia Rojas')).toHaveCount(0);
    await abrirGuardado(page, 'PRUEBA-002', FRASE_APP);
    await expect(page.getByText('Ana Ficticia Rojas').first()).toBeVisible({ timeout: 30_000 });
  });

  test('T-BO-01 @humo app: bloqueo por inactividad con reloj simulado: aviso a los 14 min, bloqueo a los 15; se reabre con la frase', async ({ page }) => {
    await page.clock.install();
    await crearGuardado(page, 'PRUEBA-003');
    await page.clock.fastForward('14:05');
    await expect(page.getByRole('button', { name: 'Seguir trabajando' })).toBeVisible();
    await page.clock.fastForward('01:00');
    await expect(page.getByRole('heading', { level: 1, name: 'Inicio' })).toBeVisible();
    await expect(page.getByText(M102)).toBeVisible();
    await abrirGuardado(page, 'PRUEBA-003', FRASE_APP);
    await expect(page.getByText('Ana Ficticia Rojas').first()).toBeVisible({ timeout: 30_000 });
  });

  test('T-BO-01 @humo app M-5: si otra pestaña borra el registro del asunto abierto, el siguiente guardado bloquea (M-102, estado vacío) y el asunto no vuelve', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Inicio' })).toBeVisible();
    await page.getByLabel('Código del asunto').fill('PRUEBA-005');
    await page.getByRole('radio', { name: /^Guardar tabla cifrada/ }).check();
    await page.getByLabel(ETIQUETA_FRASE, { exact: true }).fill(FRASE_APP);
    await page.getByLabel('Repita la frase de paso', { exact: true }).fill(FRASE_APP);
    await page.getByRole('checkbox', { name: /^Entiendo que Sig-Low no guarda mi frase/ }).check();
    await page.getByRole('button', { name: 'Crear asunto' }).click();
    await expect(page.locator('[data-prueba="aviso-M-21"], [data-prueba="aviso-M-22"]')).toBeVisible({ timeout: 30_000 });
    // Otra pestaña borra el registro directamente en IndexedDB (sin `versionchange` ni aviso del adaptador).
    const otra = await context.newPage();
    await otra.goto('/');
    await otra.evaluate(() => new Promise<void>((ok, mal) => {
      const q = indexedDB.open('siglow-boveda');
      q.onerror = () => { mal(new Error('idb')); };
      q.onsuccess = () => {
        const tx = q.result.transaction('asuntos', 'readwrite');
        tx.objectStore('asuntos').clear();
        tx.oncomplete = () => { q.result.close(); ok(); };
      };
    }));
    await otra.close();
    // «Continuar» guarda la lista del caso: el registro no se recrea y la pestaña se bloquea.
    await page.getByRole('textbox', { name: 'Texto de la lista' }).fill('Ana Ficticia Rojas; demandante');
    await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Inicio' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(M102)).toBeVisible();
    await expect(page.locator('[data-prueba="sin-asuntos"]')).toBeVisible();   // M-106: no volvió a la lista
    await expect(page.getByText('Ana Ficticia Rojas')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Texto del documento' })).toHaveCount(0);
    expect(await page.evaluate(() => new Promise<number>((ok) => {
      const q = indexedDB.open('siglow-boveda');
      q.onsuccess = () => { const g = q.result.transaction('asuntos').objectStore('asuntos').count(); g.onsuccess = () => { q.result.close(); ok(g.result); }; };
    }))).toBe(0);
  });

  test('T-BO-01 @humo app B-21: un pagehide durante «Abrir para anonimizar» descarta la clave derivada y la pantalla no abre el asunto', async ({ page }) => {
    await crearGuardado(page, 'PRUEBA-006');
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Inicio' })).toBeVisible();
    const sel = page.getByLabel('Asunto guardado', { exact: true });
    await sel.selectOption((await sel.locator('option', { hasText: 'PRUEBA-006' }).getAttribute('value'))!);
    await page.getByLabel('Frase de paso del asunto', { exact: true }).fill(FRASE_APP);
    // El clic arranca la derivación (0,4 a 0,8 s) y, en la misma tarea, la página sale (pagehide → boveda.cerrar()).
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Abrir para anonimizar')!.click();
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    });
    // PC-6-r1: el aborto es un bloqueo, no un error de frase; Inicio ya no muestra M-202 ni M-201 (el botón vuelve a quedar disponible).
    await expect(page.getByRole('button', { name: 'Abrir para anonimizar' })).toBeDisabled();   // deriva la clave...
    await expect(page.getByRole('button', { name: 'Abrir para anonimizar' })).toBeEnabled({ timeout: 30_000 });   // ...y se aborta
    await expect(page.getByText('No se pudo completar la operación.', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Frase de paso incorrecta o archivo dañado.')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Inicio' })).toBeVisible();
    await expect(page.getByText('Ana Ficticia Rojas')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Texto de la lista' })).toHaveCount(0);
    // Con la frase, sin salir de la página, sí abre.
    await abrirGuardado(page, 'PRUEBA-006', FRASE_APP);
    await expect(page.getByText('Ana Ficticia Rojas').first()).toBeVisible({ timeout: 30_000 });
  });

  test('T-BO-01 @humo app: sin IndexedDB «Guardar» queda deshabilitado con M-208 y «No guardar» sigue disponible', async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true }); });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Inicio' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /^Guardar tabla cifrada/ })).toBeDisabled();
    await expect(page.locator('[data-prueba="guardar-no-disponible"]')).toContainText('Este navegador no permite guardar datos de Sig-Low');
    await expect(page.getByRole('radio', { name: /^No guardar la tabla/ })).toBeEnabled();
  });

  test('T-BO-01 @humo app: «No guardar» (M-14) no escribe nada en IndexedDB, ni una base vacía', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Inicio' })).toBeVisible();
    await expect(page.locator('[data-prueba="sin-asuntos"]')).toBeVisible();   // listar() ya corrió
    await page.getByLabel('Código del asunto').fill('PRUEBA-004');
    await page.getByRole('radio', { name: /^No guardar la tabla/ }).check();
    await page.getByRole('button', { name: 'Crear asunto' }).click();
    await page.getByRole('textbox', { name: 'Texto de la lista' }).fill('Ana Ficticia Rojas; demandante');
    await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('textbox', { name: 'Texto del documento' })).toBeVisible();
    expect(await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).toEqual([]);
  });
});
