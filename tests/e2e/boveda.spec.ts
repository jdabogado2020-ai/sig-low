// T-CI-08 (PD-3; 10.8.2, 6.7.3, 3.4): calibración de PBKDF2 en Chrome y Edge instalados (canales `chrome` y `msedge`).
// Se compila un arnés con vault/crypto.ts y las opciones de Vite de la app, se sirve con tests/e2e/server.mjs, que aplica
// public/_headers (CSP, Trusted Types, COOP/COEP), y se mide en el navegador: t₆₀₀ₖ (5 veces), `it` calibrado, la derivación
// real con ese `it` y el vector V-SIGLOW-1 con el motor del navegador. Fuera de verify (10.0): sin @cero-red ni @humo.
// Los tiempos quedan en test-results/boveda-calibracion.json. Un canal que no está instalado se salta.
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { chromium, expect, test } from '@playwright/test';
import { build } from 'vite';

import { iteracionesPara } from '../../src/vault/crypto';

const RAIZ = process.cwd();
const FUENTE = join(RAIZ, 'test-results', 'boveda-harness-src');
const CARPETA = join(RAIZ, 'test-results', 'boveda-harness');
const RESULTADOS = join(RAIZ, 'test-results', 'boveda-calibracion.json');
const PUERTO = Number(process.env['PORT'] ?? 4173) + 7;
const ORIGEN = `http://127.0.0.1:${PUERTO}`;
const SHA_PLANO = '5e3e992300afc98202a3a8b2fcea0ae3572d5ff7e80e12be67693072255f36aa';
const SHA_CT = '6bcc6d2f9b887f5fdac1aa547ca85bad8d42acfbd0d8546fca39ddedc424a03b';

const HTML = `<!doctype html>
<html lang="es-CO" translate="no">
  <head><meta charset="utf-8" /><title>Sig-Low</title><script src="/tt-policy.js"></script></head>
  <body><script type="module" src="./boveda.ts"></script></body>
</html>
`;
// Arnés: no es parte de la app; solo devuelve tiempos y huellas, nunca texto plano.
const TS = `import { abrirSiglow, armarSiglow, cifrar, derivarClave, iteracionesPara, medirT600k, serializarPayload } from '../../src/vault/crypto.ts';
const FRASE = 'frase de prueba ficticia ñandú';
const ID = 'asu_00112233445566778899aabbccddeeff';
const ENC = 'sig-low/tabla;v=1;uso=exportacion;id=' + ID + ';kdf=PBKDF2;hash=SHA-256;it=600000;sal=AAECAwQFBgcICQoLDA0ODw==;cif=AES-GCM;iv=EBESExQVFhcYGRob;tag=128';
const AHORA = '2026-10-22T20:00:00.000Z';
const hex = async (b) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');
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
    const ct = await cifrar(clave, ENC, plano);
    const json = armarSiglow(ENC, ct);
    const nfd = await abrirSiglow(new TextEncoder().encode(json), FRASE.normalize('NFD'));
    return { shaPlano, shaCt: await hex(ct), largoCt: ct.byteLength, shaNfd: await hex(nfd.plano), planoEnCeros: plano.every((x) => x === 0) };
  },
};
`;

type Calibracion = { t: number[]; it: number[]; seguro: boolean; aislado: boolean };
type Vector = { shaPlano: string; shaCt: string; largoCt: number; shaNfd: string; planoEnCeros: boolean };
const mediana = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };

test.describe('T-CI-08 calibración de PBKDF2 en el navegador', () => {
  test.describe.configure({ mode: 'serial' });
  let servidor: ChildProcess | null = null;

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
      build: {
        outDir: CARPETA, emptyOutDir: true, target: 'es2024', assetsInlineLimit: 0, sourcemap: false,
        modulePreload: { polyfill: false }, reportCompressedSize: false,
        rolldownOptions: { input: { boveda: join(FUENTE, 'boveda.html') }, output: { minify: { compress: { dropConsole: true, dropDebugger: true } } } },
      },
    });
    for (const f of ['_headers', 'tt-policy.js']) cpSync(join(RAIZ, 'public', f), join(CARPETA, f));
    writeFileSync(join(CARPETA, 'favicon.ico'), '');   // el navegador lo pide solo; sin él, un 404 en la consola
    servidor = spawn(process.execPath, ['tests/e2e/server.mjs', '--dir', CARPETA, '--port', String(PUERTO)], { stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(`${ORIGEN}/`)).status) break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    writeFileSync(RESULTADOS, '{}\n');
  });
  test.afterAll(() => { servidor?.kill(); });

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
});
