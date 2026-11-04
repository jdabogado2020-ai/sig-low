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
  // PC-6-r2 (B-28). Retiene la próxima derivación (deriveKey; la primera de «cambiar frase», ya leído el registro) hasta soltar().
  retenerDerivacion: () => { const orig = crypto.subtle.deriveKey; let soltar; let entro;
    const puerta = new Promise((ok) => { soltar = ok; }); const dentro = new Promise((ok) => { entro = ok; });
    Object.defineProperty(crypto.subtle, 'deriveKey', { configurable: true, writable: true,
      value: async (...a) => { delete crypto.subtle.deriveKey; entro(); await puerta; return orig.apply(crypto.subtle, a); } });
    globalThis.__puerta = { dentro, soltar }; },
  // AJ-1 (época). Observa los textos planos que entran a encrypt y salen de decrypt, y con retenerCifrado retiene el primer cifrado
  // hasta soltar(); fin() devuelve cuántos fueron y si quedaron en ceros (INV-V09). No guarda copias: solo las referencias.
  observar: (retenerCifrado) => { const sub = crypto.subtle; const oe = sub.encrypt; const od = sub.decrypt; const cifrados = []; const descifrados = [];
    let soltar; let entro; let retenido = false;
    const puerta = new Promise((ok) => { soltar = ok; }); const dentro = new Promise((ok) => { entro = ok; });
    Object.defineProperty(sub, 'encrypt', { configurable: true, writable: true,
      value: async (p, k, d) => { cifrados.push(d); if (retenerCifrado && !retenido) { retenido = true; entro(); await puerta; } return oe.call(sub, p, k, d); } });
    Object.defineProperty(sub, 'decrypt', { configurable: true, writable: true,
      value: async (p, k, d) => { const r = await od.call(sub, p, k, d); descifrados.push(r); return r; } });
    const ceros = (b) => new Uint8Array(b.buffer ?? b, b.byteOffset ?? 0, b.byteLength).every((x) => x === 0);
    globalThis.__obs = { dentro, soltar, fin: () => { delete sub.encrypt; delete sub.decrypt;
      return { cifrados: cifrados.length, descifrados: descifrados.length, cifradosEnCeros: cifrados.every(ceros), descifradosEnCeros: descifrados.every(ceros) }; } }; },
  // AJ-1. Un .siglow ficticio (sin pasar por la descarga) para probar importar.
  siglowDe: async (frase, id, codigo) => { const plano = serializarPayload({ formato: 'sig-low/tabla-plana', v: 1, asunto: { asuntoId: id, codigo, creado: AHORA, actualizado: AHORA },
      appVersion: '0.1.0', table: globalThis.__ayuda.tabla(id, 2), caseList: [], relleno: '' });
    return Array.from(new TextEncoder().encode(await exportarSiglow(frase, id, 600000, plano, null))); },
  // Retiene cada cifrado: entro(n) se resuelve cuando entró el n-ésimo, soltar(n) lo deja seguir y fin() restaura encrypt.
  retenerCifrados: () => { const orig = crypto.subtle.encrypt; const t = { entradas: 0, avisos: [], puertas: [] };
    t.entro = (n) => new Promise((ok) => { const ver = () => { if (t.entradas >= n) ok(); else t.avisos.push(ver); }; ver(); });
    t.soltar = (n) => { t.puertas[n - 1](); };
    t.fin = () => { delete crypto.subtle.encrypt; for (const p of t.puertas) p(); };
    Object.defineProperty(crypto.subtle, 'encrypt', { configurable: true, writable: true,
      value: async (...a) => { let abrir; const puerta = new Promise((ok) => { abrir = ok; }); t.puertas.push(abrir); t.entradas++;
        for (const v of t.avisos.splice(0)) v(); await puerta; return orig.apply(crypto.subtle, a); } });
    globalThis.__turnos = t; },
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
  retenerDerivacion(): void;
  retenerCifrados(): void;
  derivaciones(f: () => Promise<unknown>): Promise<[string, number]>;
  siglow(bytes: number[], frase: string): Promise<{ encabezado: string; asunto: Record<string, string>; entradas: number; lista: string[] }>;
  instalarBloqueo(): void;
  observar(retenerCifrado: boolean): void;
  siglowDe(frase: string, id: string, codigo: string): Promise<number[]>;
};
type Planos = { cifrados: number; descifrados: number; cifradosEnCeros: boolean; descifradosEnCeros: boolean };
type Puerta = { __puerta: { dentro: Promise<void>; soltar(): void }; __obs: { dentro: Promise<void>; soltar(): void; fin(): Planos }; __turnos: { entro(n: number): Promise<void>; soltar(n: number): void; fin(): void } };
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

  test('T-BO-01 @humo arnés B-28: «cambiar frase» no pisa el guardado que otra pestaña confirma durante la derivación; tras 3 intentos, ERROR_INTERNO sin escribir', async ({ page, context }) => {
    test.setTimeout(240_000);
    const NUEVA = 'otra frase ficticia de prueba ñame';
    const NUEVA2 = 'tercera frase ficticia de ensayo';
    await preparar(page);
    const id = await crearCon(page, 'PRUEBA-080', 2);
    const otra = await context.newPage();
    await preparar(otra);
    const abrirEn = (p: Page, frase: string): Promise<unknown> => p.evaluate(({ x, frase }) => (globalThis as unknown as GA).__bovedaIdb.abrir(x, frase), { x: id, frase });
    await abrirEn(otra, FRASE);
    const encabezado = (): Promise<string> => page.evaluate(async (x) =>
      String((await (globalThis as unknown as GA).__ayuda.crudos()).find((r) => r['asuntoId'] === x)!['encabezado']), id);
    const sal = (e: string): string => /;sal=([^;]+);/.exec(e)![1]!;
    /** Cierra en esta pestaña y abre con cada frase: el código de las que no abren y las entradas de la tabla con la que abre. */
    const abreCon = (frases: string[]): Promise<Array<string | number>> => page.evaluate(async ({ x, frases }) => {
      const g = globalThis as unknown as GA;
      g.__bovedaIdb.cerrar();
      const out: Array<string | number> = [];
      for (const f of frases) {
        try { out.push(Object.keys((await g.__bovedaIdb.abrir(x, f)).table.entries).length); } catch (e) { out.push((e as { code?: string }).code ?? 'SIN_CODIGO'); }
      }
      return out;
    }, { x: id, frases });

    // S3: esta pestaña (X) cambia la frase y queda retenida en la derivación, con el registro de 2 entradas ya leído. Mientras,
    // la otra (Y), con el asunto abierto con la frase actual, guarda 5 entradas y se le confirma.
    await page.evaluate(() => { (globalThis as unknown as GA).__ayuda.retenerDerivacion(); });
    const cambio = page.evaluate(({ x, actual, nueva }) => {
      const g = globalThis as unknown as GA;
      return g.__ayuda.codigo(() => g.__bovedaIdb.cambiarFrase(x, actual, nueva));
    }, { x: id, actual: FRASE, nueva: NUEVA });
    await dentro(page);
    expect(await guardarCodigo(otra, id, 5)).toBe('SIN_ERROR');
    await soltar(page);
    expect(await cambio).toBe('SIN_ERROR');
    // El cambio volvió a leer y a cifrar el registro de Y: abre con la frase nueva y conserva las 5 entradas (antes: 2).
    expect(await abreCon([FRASE, NUEVA])).toEqual(['CONTRASENA_O_ARCHIVO', 5]);
    // Y queda con la clave vieja: su guardado siguiente no deshace el cambio (M-6) y el canal la bloquea.
    expect(await guardarCodigo(otra, id, 6)).toBe('SESION_DESCONOCIDA');

    // Y vuelve a abrir con la frase nueva y guarda en cada intento de X: tres veces el registro cambia entre la lectura y el `put`.
    // X falla con ERROR_INTERNO sin escribir nada, sin derivar más que las 3 veces de siempre (actual, calibración y nueva) y sin
    // bloquear a Y, cuyo último guardado sigue siendo el registro.
    await abrirEn(page, NUEVA);
    await abrirEn(otra, NUEVA);
    const antes = await encabezado();
    await page.evaluate(() => { (globalThis as unknown as GA).__ayuda.retenerCifrados(); });
    const tope = page.evaluate(({ x, actual, nueva }) => {
      const g = globalThis as unknown as GA;
      return g.__ayuda.derivaciones(() => g.__bovedaIdb.cambiarFrase(x, actual, nueva));
    }, { x: id, actual: NUEVA, nueva: NUEVA2 });
    for (let n = 1; n <= 3; n++) {
      await page.evaluate((k) => (globalThis as unknown as GA).__turnos.entro(k), n);
      expect(await guardarCodigo(otra, id, 10 + n)).toBe('SIN_ERROR');
      await page.evaluate((k) => { (globalThis as unknown as GA).__turnos.soltar(k); }, n);
    }
    expect(await tope).toEqual(['ERROR_INTERNO', 3]);
    await page.evaluate(() => { (globalThis as unknown as GA).__turnos.fin(); });
    expect(sal(await encabezado())).toBe(sal(antes));
    expect(await guardarCodigo(otra, id, 14)).toBe('SIN_ERROR');
    expect(await abreCon([NUEVA2, NUEVA])).toEqual(['CONTRASENA_O_ARCHIVO', 14]);
    // Sin otro guardado en medio, el mismo cambio sale al primer intento.
    expect(await page.evaluate(({ x, actual, nueva }) => {
      const g = globalThis as unknown as GA;
      return g.__ayuda.codigo(() => g.__bovedaIdb.cambiarFrase(x, actual, nueva));
    }, { x: id, actual: NUEVA, nueva: NUEVA2 })).toBe('SIN_ERROR');
    expect(await abreCon([NUEVA, NUEVA2])).toEqual(['CONTRASENA_O_ARCHIVO', 14]);
    await otra.close();
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

  // ===== AJ-1 · época de bloqueo en exportarAsunto, cambiarFrase e importar (revisión de PD-4-r1) =====
  // Un bloqueo (`cerrar()`) mientras la operación deriva una clave o cifra descarta el resultado: sin descarga ni escritura, con
  // SESION_DESCONOCIDA, y los textos planos (descifrados y por cifrar) en ceros. Dos puntos de retención por operación: dentro de
  // la primera derivación y dentro del primer cifrado (el último punto antes de descargar o de escribir).
  type Punto = 'derivacion' | 'cifrado';
  const PUNTOS: readonly Punto[] = ['derivacion', 'cifrado'];
  type Operacion = { nombre: 'exportarAsunto' | 'cambiarFrase' | 'importar' | 'exportar'; args: unknown[] };
  /** Corre `op`, la retiene en `punto`, simula el bloqueo con `cerrar()`, la suelta y devuelve su código y los textos planos observados. */
  async function bloqueoDuranteOp(p: Page, punto: Punto, op: Operacion): Promise<{ codigo: string; planos: Planos }> {
    await p.evaluate((q) => {
      const h = (globalThis as unknown as GA).__ayuda;
      h.observar(q === 'cifrado');
      if (q === 'derivacion') h.retenerDerivacion();
    }, punto);
    const resultado = p.evaluate(({ nombre, args }) => {
      const g = globalThis as unknown as GA;
      // `exportar` (B-51) recibe la instantánea del asunto: la arma aquí, con el asuntoId en `args[0]`.
      const a = nombre === 'importar' ? [Uint8Array.from(args[0] as number[]), ...args.slice(1)]
        : nombre === 'exportar' ? [{ caseList: [], table: g.__ayuda.tabla(args[0] as string, 2) }, ...args.slice(1)] : args;
      return g.__ayuda.codigo(() => (g.__bovedaIdb as unknown as Record<string, (...x: unknown[]) => Promise<unknown>>)[nombre]!(...a));
    }, op);
    await p.evaluate((q) => { const g = globalThis as unknown as GA; return q === 'cifrado' ? g.__obs.dentro : g.__puerta.dentro; }, punto);
    await p.evaluate(() => { (globalThis as unknown as GA).__bovedaIdb.cerrar(); });
    await p.evaluate((q) => { const g = globalThis as unknown as GA; if (q === 'cifrado') g.__obs.soltar(); else g.__puerta.soltar(); }, punto);
    const codigo = await resultado;
    return { codigo, planos: await p.evaluate(() => (globalThis as unknown as GA).__obs.fin()) };
  }
  /** Lo observable de una operación abortada por el bloqueo: descifró lo que la frase abre (1), cifró solo si llegó al último punto, y todo en ceros. */
  const abortada = (punto: Punto): { codigo: string; planos: Planos } => ({
    codigo: 'SESION_DESCONOCIDA',
    planos: { descifrados: 1, cifrados: punto === 'cifrado' ? 1 : 0, descifradosEnCeros: true, cifradosEnCeros: true },
  });

  test('T-BO-01 @humo INV-G09 arnés AJ-1 época: exportarAsunto descarta el resultado si hubo un bloqueo mientras se derivaba: sin descarga y con los textos planos en ceros', async ({ page }) => {
    test.setTimeout(240_000);
    await preparar(page);
    let descargas = 0;
    page.on('download', () => { descargas++; });
    const id = await crearCon(page, 'PRUEBA-090', 2);
    for (const punto of PUNTOS) {
      const r = await bloqueoDuranteOp(page, punto, { nombre: 'exportarAsunto', args: [id, FRASE] });
      expect(r, punto).toEqual(abortada(punto));
      expect(descargas, punto).toBe(0);
    }
    // Control: sin bloqueo en medio, la misma operación sí descarga.
    const [descarga] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(({ x, frase }) => (globalThis as unknown as GA).__bovedaIdb.exportarAsunto(x, frase), { x: id, frase: FRASE }),
    ]);
    expect(descarga.suggestedFilename()).toMatch(/^sig-low-tabla-\d{8}-\d{4}\.siglow$/);
  });

  test('T-BO-01 @humo INV-G09 arnés AJ-1 época: cambiarFrase descarta el cambio si hubo un bloqueo mientras se derivaba: el registro no cambia y los textos planos quedan en ceros', async ({ page }) => {
    test.setTimeout(240_000);
    const NUEVA = 'otra frase ficticia de prueba ñame';
    await preparar(page);
    const id = await crearCon(page, 'PRUEBA-091', 2);
    const encabezado = (): Promise<string> => page.evaluate(async (x) =>
      String((await (globalThis as unknown as GA).__ayuda.crudos()).find((r) => r['asuntoId'] === x)!['encabezado']), id);
    const e0 = await encabezado();
    for (const punto of PUNTOS) {
      const r = await bloqueoDuranteOp(page, punto, { nombre: 'cambiarFrase', args: [id, FRASE, NUEVA] });
      expect(r, punto).toEqual(abortada(punto));
      expect(await encabezado(), punto).toBe(e0);                               // ni escritura ni IV nuevo
    }
    // La frase vieja sigue abriendo el asunto y la nueva no. Control: sin bloqueo en medio, el cambio sí se hace.
    const ab = (frase: string): Promise<string> => page.evaluate(({ x, frase }) => {
      const g = globalThis as unknown as GA;
      return g.__ayuda.codigo(() => g.__bovedaIdb.abrir(x, frase));
    }, { x: id, frase });
    expect([await ab(FRASE), await ab(NUEVA)]).toEqual(['SIN_ERROR', 'CONTRASENA_O_ARCHIVO']);
    expect(await page.evaluate(({ x, a, n }) => (globalThis as unknown as GA).__ayuda.codigo(() => (globalThis as unknown as GA).__bovedaIdb.cambiarFrase(x, a, n)), { x: id, a: FRASE, n: NUEVA })).toBe('SIN_ERROR');
    expect(await encabezado()).not.toBe(e0);
    expect([await ab(FRASE), await ab(NUEVA)]).toEqual(['CONTRASENA_O_ARCHIVO', 'SIN_ERROR']);
  });

  test('T-BO-01 @humo INV-G09 arnés AJ-1 época: importar descarta el archivo si hubo un bloqueo mientras se derivaba: no se escribe nada y los textos planos quedan en ceros', async ({ page }) => {
    test.setTimeout(240_000);
    await preparar(page);
    const id = await page.evaluate(() => (globalThis as unknown as GA).__ayuda.idNuevo());
    const bytes = await page.evaluate(({ frase, x }) => (globalThis as unknown as GA).__ayuda.siglowDe(frase, x, 'PRUEBA-092'), { frase: FRASE, x: id });
    for (const punto of PUNTOS) {
      const r = await bloqueoDuranteOp(page, punto, { nombre: 'importar', args: [bytes, FRASE] });
      expect(r, punto).toEqual(abortada(punto));
      expect(await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name)), punto).toEqual([]);   // ni la base se creó
    }
    // Control: sin bloqueo en medio, el mismo archivo se importa.
    const ok = await page.evaluate(({ b, frase }) => (globalThis as unknown as GA).__bovedaIdb.importar(Uint8Array.from(b), frase).then((r) => r.codigo), { b: bytes, frase: FRASE });
    expect(ok).toBe('PRUEBA-092');
    expect(await page.evaluate(async () => (await (globalThis as unknown as GA).__bovedaIdb.listar()).map((a) => a.codigo))).toEqual(['PRUEBA-092']);
  });

  // AJ-3 (B-51): `exportar` (el «Exportar tabla cifrada» del menú del asunto) comprueba la época como exportarAsunto. Dos asuntos: uno
  // guardado (la frase abre su registro) y uno que no se guarda («No guardar»: frase nueva). En los dos, un bloqueo durante la derivación
  // o el cifrado no deja descarga alguna y los textos planos quedan en ceros. A diferencia de exportarAsunto, que comprueba la época
  // antes de serializar, `exportar` la comprueba al final (tras exportarSiglow): el texto plano sí llega a cifrarse (1 cifrado) y su
  // resultado se descarta; la frase se comprobó contra el registro (1 descifrado) solo en el asunto guardado.
  test('T-BO-01 @humo INV-G09 arnés B-51 época: exportar (el del menú del asunto) descarta el resultado si hubo un bloqueo mientras se derivaba o se cifraba: sin descarga y con los textos planos en ceros', async ({ page }) => {
    test.setTimeout(240_000);
    await preparar(page);
    let descargas = 0;
    page.on('download', () => { descargas++; });
    // Un asunto guardado por punto: el bloqueo (`cerrar()`) descarta la sesión, y sin ella `exportar` falla antes de derivar.
    for (const [i, punto] of PUNTOS.entries()) {
      const codigo = `PRUEBA-09${3 + i}`;
      const id = await crearCon(page, codigo, 2);
      const r = await bloqueoDuranteOp(page, punto, { nombre: 'exportar', args: [id, codigo, FRASE] });
      expect(r, `guardado, ${punto}`).toEqual({ codigo: 'SESION_DESCONOCIDA', planos: { descifrados: 1, cifrados: 1, descifradosEnCeros: true, cifradosEnCeros: true } });
      expect(descargas, `guardado, ${punto}`).toBe(0);
    }
    // «No guardar»: ningún registro; la frase es nueva (el adaptador la valida). Sin registro no hay descifrado que comprobar.
    const nuevo = await page.evaluate(() => (globalThis as unknown as GA).__ayuda.idNuevo());
    for (const punto of PUNTOS) {
      const r = await bloqueoDuranteOp(page, punto, { nombre: 'exportar', args: [nuevo, 'PRUEBA-095', FRASE] });
      expect(r, `no guardar, ${punto}`).toEqual({ codigo: 'SESION_DESCONOCIDA', planos: { descifrados: 0, cifrados: 1, descifradosEnCeros: true, cifradosEnCeros: true } });
      expect(descargas, `no guardar, ${punto}`).toBe(0);
    }
    // Control: sin bloqueo en medio, la misma operación sí descarga (con el código anterior, también tras el bloqueo).
    const idControl = await crearCon(page, 'PRUEBA-096', 2);
    const [descarga] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(({ x, frase }) => {
        const g = globalThis as unknown as GA;
        return g.__bovedaIdb.exportar({ caseList: [], table: g.__ayuda.tabla(x, 2) as never }, 'PRUEBA-096', frase);
      }, { x: idControl, frase: FRASE }),
    ]);
    expect(descarga.suggestedFilename()).toMatch(/^sig-low-tabla-\d{8}-\d{4}\.siglow$/);
  });
});

// ===== T-BO-01 en la app real (dist/ servido por server.mjs con _headers): la interfaz de PC-1 con la bóveda conectada =====
test.describe('bóveda en la app', () => {
  test.describe.configure({ timeout: 120_000 });
  const FRASE_APP = 'frase de prueba ficticia ñandú';
  const ETIQUETA_FRASE = 'Contraseña de la llave. Mínimo 15 caracteres; puede usar varias palabras separadas por espacios.';

  /** Crea un asunto con «Guardar tabla cifrada», agrega «Ana Ficticia Rojas» a la lista y continúa (la lista se guarda cifrada). */
  async function crearGuardado(page: Page, codigo: string): Promise<void> {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    await page.getByLabel('Código del caso').fill(codigo);
    await page.getByRole('radio', { name: /^Guardar tabla cifrada/ }).check();
    await page.getByLabel(ETIQUETA_FRASE, { exact: true }).fill(FRASE_APP);
    await page.getByLabel('Repita la contraseña de la llave', { exact: true }).fill(FRASE_APP);
    await page.getByRole('checkbox', { name: /^Entiendo que Sig-Low no guarda mi frase/ }).check();
    await page.getByRole('button', { name: 'Crear caso' }).click();
    // Resultado de persist() visible (M-21 concedido o M-22 no concedido).
    await expect(page.locator('[data-prueba="aviso-M-21"], [data-prueba="aviso-M-22"]')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('textbox', { name: 'Texto de la lista' }).fill('Ana Ficticia Rojas; demandante');
    await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('textbox', { name: 'Texto del documento' })).toBeVisible({ timeout: 30_000 });
  }

  async function abrirGuardado(page: Page, codigo: string, frase: string): Promise<void> {
    const sel = page.getByLabel('Caso guardado', { exact: true });
    const valor = await sel.locator('option', { hasText: codigo }).getAttribute('value');
    await sel.selectOption(valor!);
    await page.getByLabel('Contraseña de la llave del caso', { exact: true }).fill(frase);
    await page.getByRole('button', { name: 'Abrir el caso' }).click();
  }

  const M102 = 'Sig-Low se bloqueó y borró de la memoria el documento y la revisión en curso.';
  const M20 = 'Protegiendo y abriendo el caso en su equipo…';
  const campoAbrir = (page: Page) => page.getByLabel('Contraseña de la llave del caso', { exact: true });
  /** Campos de texto o de frase con algo escrito en la pantalla (tras un bloqueo, ninguno). */
  const camposConTexto = (page: Page): Promise<number> => page.evaluate(() =>
    [...document.querySelectorAll('input')].filter((i) => (i.type === 'text' || i.type === 'password') && i.value !== '').length);
  /** Envía `{ tipo: 'bloquear' }` por el canal de bloqueo desde otra pestaña (8.2.10), como su botón «Bloquear» o su inactividad. */
  const bloquearDesde = (otra: Page): Promise<void> => otra.evaluate(() => {
    const c = new BroadcastChannel('siglow-bloqueo');
    c.postMessage({ tipo: 'bloquear' });
    c.close();
  });
  /** Retiene en la app la próxima derivación (deriveKey) hasta soltarla: un «Abrir» queda en curso, con el registro ya leído. */
  const retenerDerivacion = (page: Page): Promise<void> => page.evaluate(() => {
    const s = crypto.subtle;
    const orig = s.deriveKey.bind(s);
    let soltar = (): void => undefined;
    let entro = (): void => undefined;
    const puerta = new Promise<void>((ok) => { soltar = ok; });
    const dentro = new Promise<void>((ok) => { entro = ok; });
    Object.defineProperty(s, 'deriveKey', {
      configurable: true, writable: true,
      value: async (...a: Parameters<SubtleCrypto['deriveKey']>) => { Reflect.deleteProperty(s, 'deriveKey'); entro(); await puerta; return orig(...a); },
    });
    (globalThis as unknown as { __derivacion: { dentro: Promise<void>; soltar: () => void } }).__derivacion = { dentro, soltar };
  });
  const derivacion = (page: Page, que: 'dentro' | 'soltar'): Promise<void> => page.evaluate((q) => {
    const d = (globalThis as unknown as { __derivacion: { dentro: Promise<void>; soltar: () => void } }).__derivacion;
    return q === 'dentro' ? d.dentro : d.soltar();
  }, que);

  test('T-BO-01 @humo INV-V01 INV-V07 app: guardar → Bloquear → recargar → desbloquear con la lista idéntica; frase errónea → M-201; registro crudo sin originales', async ({ page }) => {
    await crearGuardado(page, 'PRUEBA-001');
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
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
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    await abrirGuardado(page, 'PRUEBA-001', 'frase de prueba ficticia nandu');
    await expect(page.getByText('Contraseña de la llave incorrecta o archivo dañado.')).toBeVisible({ timeout: 30_000 });
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
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
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
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    await expect(page.getByText(M102)).toBeVisible();
    await abrirGuardado(page, 'PRUEBA-003', FRASE_APP);
    await expect(page.getByText('Ana Ficticia Rojas').first()).toBeVisible({ timeout: 30_000 });
  });

  test('T-BO-01 @humo app M-5: si otra pestaña borra el registro del asunto abierto, el siguiente guardado bloquea (M-102, estado vacío) y el asunto no vuelve', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    await page.getByLabel('Código del caso').fill('PRUEBA-005');
    await page.getByRole('radio', { name: /^Guardar tabla cifrada/ }).check();
    await page.getByLabel(ETIQUETA_FRASE, { exact: true }).fill(FRASE_APP);
    await page.getByLabel('Repita la contraseña de la llave', { exact: true }).fill(FRASE_APP);
    await page.getByRole('checkbox', { name: /^Entiendo que Sig-Low no guarda mi frase/ }).check();
    await page.getByRole('button', { name: 'Crear caso' }).click();
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
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible({ timeout: 30_000 });
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
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    const sel = page.getByLabel('Caso guardado', { exact: true });
    await sel.selectOption((await sel.locator('option', { hasText: 'PRUEBA-006' }).getAttribute('value'))!);
    await page.getByLabel('Contraseña de la llave del caso', { exact: true }).fill(FRASE_APP);
    // El clic arranca la derivación (0,4 a 0,8 s) y, en la misma tarea, la página sale (pagehide → boveda.cerrar()).
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Abrir el caso')!.click();
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    });
    // PC-6-r1: el aborto es un bloqueo, no un error de frase; Inicio no muestra M-202 ni M-201. PC-6-r2 (M-7): pagehide vuelve a
    // montar el formulario, así que la frase ya no está y el botón sigue deshabilitado al terminar la derivación abortada.
    await expect(page.getByRole('button', { name: 'Abrir el caso' })).toBeDisabled();
    await expect(page.getByText(M20)).toHaveCount(0, { timeout: 30_000 });   // la derivación terminó y se abortó
    await expect(page.getByLabel('Contraseña de la llave del caso', { exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Abrir el caso' })).toBeDisabled();
    await expect(page.getByText('No se pudo completar la operación.', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Contraseña de la llave incorrecta o archivo dañado.')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    await expect(page.getByText('Ana Ficticia Rojas')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Texto de la lista' })).toHaveCount(0);
    // Con la frase, sin salir de la página, sí abre.
    await abrirGuardado(page, 'PRUEBA-006', FRASE_APP);
    await expect(page.getByText('Ana Ficticia Rojas').first()).toBeVisible({ timeout: 30_000 });
  });

  // ===== PC-6-r2 · M-7: un bloqueo vacía las frases de Inicio (6.6.5, V-19, V-35) =====
  test('T-BO-01 @humo app M-7 INV-G09: «bloquear» desde otra pestaña durante «Abrir» vacía la frase y muestra M-102; otro clic sin escribirla no abre el asunto', async ({ page, context }) => {
    await crearGuardado(page, 'PRUEBA-007');
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    await page.reload();   // sin el aviso M-102 del bloqueo propio: el que se vea después es el del canal
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    await expect(page.getByText(M102)).toHaveCount(0);
    const otra = await context.newPage();
    await otra.goto('/');
    await expect(otra.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    const sel = page.getByLabel('Caso guardado', { exact: true });
    await sel.selectOption((await sel.locator('option', { hasText: 'PRUEBA-007' }).getAttribute('value'))!);
    await campoAbrir(page).fill(FRASE_APP);
    // S9: «Abrir» en plena derivación (retenida; el registro ya se leyó) y, en ese momento, el bloqueo de la otra pestaña.
    await retenerDerivacion(page);
    const abrir = page.getByRole('button', { name: 'Abrir el caso' });
    await abrir.click();
    await derivacion(page, 'dentro');
    await expect(page.getByText(M20).first()).toBeVisible();
    await bloquearDesde(otra);
    // Antes de que termine la derivación, la frase ya no está en el campo y se ve por qué (M-102).
    await expect(page.locator('[data-prueba="aviso-bloqueo"]')).toContainText(M102);
    await expect(campoAbrir(page)).toHaveValue('');
    await derivacion(page, 'soltar');
    await expect(page.getByText(M20)).toHaveCount(0, { timeout: 30_000 });
    // El «Abrir» se abortó (B-21) sin M-201 ni M-202, y sin frase no hay segundo clic que abra el asunto.
    await expect(campoAbrir(page)).toHaveValue('');
    await expect(abrir).toBeDisabled();
    await campoAbrir(page).press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    await expect(page.getByText('Ana Ficticia Rojas')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Texto de la lista' })).toHaveCount(0);
    await expect(page.getByText('Contraseña de la llave incorrecta o archivo dañado.')).toHaveCount(0);
    await expect(page.getByText('No se pudo completar la operación.', { exact: false })).toHaveCount(0);
    // Con la frase escrita otra vez, abre.
    await abrirGuardado(page, 'PRUEBA-007', FRASE_APP);
    await expect(page.getByText('Ana Ficticia Rojas').first()).toBeVisible({ timeout: 30_000 });
    await otra.close();
  });

  test('T-BO-01 @humo app M-7 INV-G09: «bloquear» desde otra pestaña vacía las dos frases de «Crear asunto», y pageshow con persisted la de «Abrir»', async ({ page, context }) => {
    await crearGuardado(page, 'PRUEBA-008');
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    await expect(page.getByText(M102)).toHaveCount(0);
    const otra = await context.newPage();
    await otra.goto('/');
    await expect(otra.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    // S11: las dos frases de «Crear asunto» escritas, sin enviar; el bloqueo llega por el canal.
    await page.getByLabel('Código del caso').fill('PRUEBA-009');
    await page.getByRole('radio', { name: /^Guardar tabla cifrada/ }).check();
    await page.getByLabel(ETIQUETA_FRASE, { exact: true }).fill(FRASE_APP);
    await page.getByLabel('Repita la contraseña de la llave', { exact: true }).fill(FRASE_APP);
    await page.getByRole('checkbox', { name: /^Entiendo que Sig-Low no guarda mi frase/ }).check();
    await campoAbrir(page).fill(FRASE_APP);
    await bloquearDesde(otra);
    await expect(page.locator('[data-prueba="aviso-bloqueo"]')).toContainText(M102);
    // El formulario se volvió a montar: sin modo elegido (los campos de frase ni existen), sin casilla y sin la frase de «Abrir».
    await expect(page.getByRole('radio', { name: /^Guardar tabla cifrada/ })).not.toBeChecked();
    await expect(page.getByLabel(ETIQUETA_FRASE, { exact: true })).toHaveCount(0);
    await expect(campoAbrir(page)).toHaveValue('');
    await page.getByRole('radio', { name: /^Guardar tabla cifrada/ }).check();
    await expect(page.getByLabel(ETIQUETA_FRASE, { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Repita la contraseña de la llave', { exact: true })).toHaveValue('');
    await expect(page.getByRole('checkbox', { name: /^Entiendo que Sig-Low no guarda mi frase/ })).not.toBeChecked();
    expect(await camposConTexto(page)).toBe(0);
    await otra.close();
    // S10: la frase escrita en «Abrir» y en «Crear asunto»; la página sale y vuelve de la caché de páginas.
    await page.getByLabel(ETIQUETA_FRASE, { exact: true }).fill(FRASE_APP);
    await campoAbrir(page).fill(FRASE_APP);
    await page.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expect(page.getByText(M102)).toBeVisible();
    await expect(campoAbrir(page)).toHaveValue('');
    await expect(page.getByLabel(ETIQUETA_FRASE, { exact: true })).toHaveCount(0);
    expect(await camposConTexto(page)).toBe(0);
  });

  test('T-BO-01 @humo app M-7 INV-G09: sin asunto abierto, una frase escrita en Inicio hace correr el bloqueo por inactividad (aviso a los 14 min, bloqueo a los 15)', async ({ page }) => {
    await page.clock.install();
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    // Sin frase escrita no hay nada que bloquear: ni aviso ni M-102.
    await page.clock.fastForward('16:00');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByText(M102)).toHaveCount(0);
    // Con la frase escrita y olvidada en «Crear asunto».
    await page.getByLabel('Código del caso').fill('PRUEBA-010');
    await page.getByRole('radio', { name: /^Guardar tabla cifrada/ }).check();
    await page.getByLabel(ETIQUETA_FRASE, { exact: true }).fill(FRASE_APP);
    await page.clock.fastForward('14:05');
    await expect(page.getByRole('button', { name: 'Seguir trabajando' })).toBeVisible();
    await page.clock.fastForward('01:00');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByText(M102)).toBeVisible();
    await expect(page.getByRole('radio', { name: /^Guardar tabla cifrada/ })).not.toBeChecked();
    await expect(page.getByLabel(ETIQUETA_FRASE, { exact: true })).toHaveCount(0);
    expect(await camposConTexto(page)).toBe(0);
    // Ya sin frase, el reloj vuelve a no contar.
    await page.clock.fastForward('16:00');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  // ===== AJ-1 · M-20: la misma regla que M-7 en los diálogos de la Bóveda (Exportar, Cambiar frase, Importar) y en el menú del asunto =====
  const aLaBoveda = async (page: Page): Promise<void> => {
    await page.getByRole('button', { name: 'Casos guardados', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Casos guardados' })).toBeVisible();
  };
  const dialogoAbierto = (page: Page) => page.locator('dialog[open]');

  test('T-BO-01 @humo app M-20 INV-G09: sin asunto abierto, una frase escrita en Exportar cifrado, Cambiar frase o Importar de la Bóveda hace correr el bloqueo por inactividad: el campo queda vacío y el diálogo cerrado', async ({ page }) => {
    await page.clock.install();
    await crearGuardado(page, 'PRUEBA-011');
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    await aLaBoveda(page);
    // Sin frase escrita no hay nada que bloquear: ni aviso ni bloqueo, aunque pasen 16 min.
    await page.clock.fastForward('16:00');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Casos guardados' })).toBeVisible();

    const casos: ReadonlyArray<{ nombre: string; abrir: () => Promise<void>; campo: () => ReturnType<Page['getByLabel']> }> = [
      {
        nombre: 'Guardar la llave en un archivo',
        abrir: async () => { await page.getByRole('button', { name: 'Exportar cifrado PRUEBA-011', exact: true }).click(); await expect(dialogoAbierto(page)).toBeVisible(); },
        campo: () => dialogoAbierto(page).getByLabel('Contraseña de la llave del caso', { exact: true }),
      },
      {
        nombre: 'Cambiar la contraseña de la llave',
        abrir: async () => { await page.getByRole('button', { name: 'Cambiar frase de paso PRUEBA-011', exact: true }).click(); await expect(dialogoAbierto(page)).toBeVisible(); },
        campo: () => dialogoAbierto(page).getByLabel('Contraseña actual de la llave', { exact: true }),
      },
      {
        nombre: 'Importar',
        abrir: async () => { await expect(page.locator('[data-prueba="importar"]')).toBeVisible(); },
        campo: () => page.getByLabel('Contraseña de la llave del archivo', { exact: true }),
      },
    ];
    for (const caso of casos) {
      await caso.abrir();
      await caso.campo().fill(FRASE_APP);
      expect(await camposConTexto(page), caso.nombre).toBeGreaterThan(0);
      await page.clock.fastForward('14:05');
      await expect(page.getByRole('button', { name: 'Seguir trabajando' }), caso.nombre).toBeVisible();
      await page.clock.fastForward('01:00');
      // El bloqueo vuelve a Inicio con M-102: ni el diálogo ni la frase siguen en pantalla.
      await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' }), caso.nombre).toBeVisible();
      await expect(page.getByText(M102), caso.nombre).toBeVisible();
      await expect(dialogoAbierto(page), caso.nombre).toHaveCount(0);
      expect(await camposConTexto(page), caso.nombre).toBe(0);
      // De vuelta en la Bóveda, ni el diálogo está abierto ni el campo conserva la frase.
      await aLaBoveda(page);
      await expect(dialogoAbierto(page), caso.nombre).toHaveCount(0);
      if (caso.nombre === 'Importar') await expect(caso.campo(), caso.nombre).toHaveValue('');
      else {
        await caso.abrir();
        await expect(caso.campo(), caso.nombre).toHaveValue('');
        await page.keyboard.press('Escape');
        await expect(dialogoAbierto(page), caso.nombre).toHaveCount(0);
      }
    }
    // Ya sin frase escrita, el reloj vuelve a no contar.
    await page.clock.fastForward('16:00');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Casos guardados' })).toBeVisible();
  });

  test('T-BO-01 @humo app M-20 INV-G09: tras un intento fallido las frases de Exportar cifrado, Cambiar frase e Importar se vacían, y pagehide (sin cambiar de pantalla) cierra el diálogo y vuelve a montar «Importar»', async ({ page }) => {
    await crearGuardado(page, 'PRUEBA-012');
    await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    await aLaBoveda(page);
    const ERROR_FRASE = 'Contraseña de la llave incorrecta o archivo dañado.';
    // Exportar cifrado con una frase errónea: M-201 y el campo vacío.
    await page.getByRole('button', { name: 'Exportar cifrado PRUEBA-012', exact: true }).click();
    const d = dialogoAbierto(page);
    await d.getByLabel('Contraseña de la llave del caso', { exact: true }).fill('una frase equivocada ficticia');
    await d.getByRole('button', { name: 'Guardar la llave para devolver los datos reales' }).click();
    await expect(d.getByText(ERROR_FRASE)).toBeVisible({ timeout: 30_000 });
    await expect(d.getByLabel('Contraseña de la llave del caso', { exact: true })).toHaveValue('');
    expect(await camposConTexto(page)).toBe(0);
    await page.keyboard.press('Escape');
    // Cambiar frase con la actual errónea: M-201 y las tres frases vacías.
    await page.getByRole('button', { name: 'Cambiar frase de paso PRUEBA-012', exact: true }).click();
    await d.getByLabel('Contraseña actual de la llave', { exact: true }).fill('una frase equivocada ficticia');
    await d.getByLabel(ETIQUETA_FRASE, { exact: true }).fill('otra frase ficticia distinta ñandú 2');
    await d.getByLabel('Repita la contraseña de la llave', { exact: true }).fill('otra frase ficticia distinta ñandú 2');
    await d.getByRole('checkbox', { name: /^Entiendo que Sig-Low no guarda mi frase/ }).check();
    await d.getByRole('button', { name: 'Cambiar la contraseña de la llave', exact: true }).click();
    await expect(d.getByText(ERROR_FRASE)).toBeVisible({ timeout: 30_000 });
    expect(await camposConTexto(page)).toBe(0);
    // pagehide sin pageshow: la pantalla sigue siendo la Bóveda, pero el diálogo se cierra y no queda ninguna frase.
    await d.getByLabel('Contraseña actual de la llave', { exact: true }).fill('una frase equivocada ficticia');
    await page.getByLabel('Contraseña de la llave del archivo', { exact: true }).fill(FRASE_APP);
    await page.evaluate(() => { dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })); });
    await expect(dialogoAbierto(page)).toHaveCount(0);
    await expect(page.getByLabel('Contraseña de la llave del archivo', { exact: true })).toHaveValue('');
    expect(await camposConTexto(page)).toBe(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Casos guardados' })).toBeVisible();
  });

  test('T-BO-01 @humo app M-20 INV-G09: «bloquear» desde otra pestaña cierra el diálogo del menú del asunto («Exportar tabla cifrada») y no deja la frase en pantalla', async ({ page, context }) => {
    await crearGuardado(page, 'PRUEBA-013');
    const otra = await context.newPage();
    await otra.goto('/');
    await expect(otra.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    await page.getByRole('button', { name: 'Opciones del caso', exact: true }).click();
    await page.getByRole('button', { name: 'Guardar la llave para devolver los datos reales', exact: true }).click();
    const d = dialogoAbierto(page);
    await expect(d).toBeVisible();
    await d.getByLabel('Contraseña de la llave para el archivo', { exact: true }).fill(FRASE_APP);
    expect(await camposConTexto(page)).toBeGreaterThan(0);
    await bloquearDesde(otra);
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    await expect(page.locator('[data-prueba="aviso-bloqueo"]')).toContainText(M102);
    // Antes (observación de PC-6-r2, Q5) el <dialog> modal quedaba abierto y vacío sobre Inicio.
    await expect(dialogoAbierto(page)).toHaveCount(0);
    expect(await camposConTexto(page)).toBe(0);
    await otra.close();
  });

  test('T-BO-01 @humo app: sin IndexedDB «Guardar» queda deshabilitado con M-208 y «No guardar» sigue disponible', async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true }); });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /^Guardar tabla cifrada/ })).toBeDisabled();
    await expect(page.locator('[data-prueba="guardar-no-disponible"]')).toContainText('Este navegador no permite guardar datos de Sig-Low');
    await expect(page.getByRole('radio', { name: /^No guardar la tabla/ })).toBeEnabled();
  });

  test('T-BO-01 @humo app: «No guardar» (M-14) no escribe nada en IndexedDB, ni una base vacía', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Cargar documento' })).toBeVisible();
    await expect(page.locator('[data-prueba="sin-asuntos"]')).toBeVisible();   // listar() ya corrió
    await page.getByLabel('Código del caso').fill('PRUEBA-004');
    await page.getByRole('radio', { name: /^No guardar la tabla/ }).check();
    await page.getByRole('button', { name: 'Crear caso' }).click();
    await page.getByRole('textbox', { name: 'Texto de la lista' }).fill('Ana Ficticia Rojas; demandante');
    await page.getByRole('button', { name: 'Vista previa', exact: true }).first().click();
    await page.getByRole('button', { name: 'Agregar las líneas válidas' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('textbox', { name: 'Texto del documento' })).toBeVisible();
    expect(await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).toEqual([]);
  });
});
