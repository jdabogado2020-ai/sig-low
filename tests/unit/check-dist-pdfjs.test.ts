// T-CD-03 / V-42 · La excepción exacta de check-dist para los chunks de pdf.js 6.4.299 (aprobada en la P0-6a de PE-4, decisión 2) y sus
// canarios: pasa con las cuentas y las URL literales aprobadas y falla ante cualquier desvío. PD-2 puede mover estas pruebas a
// tests/unit/check-dist.test.ts. Los «dist» son sintéticos y se escriben en un directorio temporal; solo datos ficticios.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = resolve('scripts/check-dist.mjs');
const RAIZ = mkdtempSync(join(tmpdir(), 'siglow-checkdist-'));
afterAll(() => { rmSync(RAIZ, { recursive: true, force: true }); });

const CORE_JS = ['https://github.com/zloirock/core-js/blob/v3.50.0/LICENSE', 'https://github.com/zloirock/core-js'];
const URLS_PRINCIPAL = [...CORE_JS, 'http://example.com', 'https://foo.bar', 'https://foo.bar'];
const URLS_WORKER = [
  ...CORE_JS,
  ...['xci/', 'xfa-connection-set/', 'xfa-data/', 'xfa-data/1.0/', 'xfa-form/', 'xfa-locale-set/', 'xfa-source-set/', 'xfa-template/', 'xdc/']
    .map((p) => 'http://www.xfa.org/schema/' + p),
  ...['xdp/', 'xdp/pdf/', 'xfdf/', 'xmpmeta/'].map((p) => 'http://ns.adobe.com/' + p),
];
/** Un chunk sintético con la versión, `xhr` referencias a XMLHttpRequest, `consola` a console.log y las URL como literales. */
const chunk = (urls: string[], xhr: number, consola: number, extra = '', version = '6.4.299'): string =>
  `var apiVersion="${version}";` + 'XMLHttpRequest;'.repeat(xhr) + 'console.log.bind(console);'.repeat(consola) +
  urls.map((u) => `var u=\`${u}\`;`).join('') + extra;

interface Dist { principal?: string; worker?: string; nombrePrincipal?: string; nombreWorker?: string }
let n = 0;
/** Escribe un dist sintético y corre check-dist con `cwd` propio (para que lea node_modules/pdfjs-dist/package.json de ahí). */
function correr(d: Dist, versionPdfjs = '6.4.299'): { salida: number; texto: string } {
  const base = join(RAIZ, `caso-${n++}`);
  mkdirSync(join(base, 'dist', 'assets'), { recursive: true });
  mkdirSync(join(base, 'node_modules', 'pdfjs-dist'), { recursive: true });
  writeFileSync(join(base, 'node_modules', 'pdfjs-dist', 'package.json'), JSON.stringify({ name: 'pdfjs-dist', version: versionPdfjs }));
  writeFileSync(join(base, 'dist', 'index.html'), '<!doctype html><title>Sig-Low</title>');
  writeFileSync(join(base, 'dist', 'assets', d.nombrePrincipal ?? 'pdf-C2pV2Gs3.js'), d.principal ?? chunk(URLS_PRINCIPAL, 3, 0));
  writeFileSync(join(base, 'dist', 'assets', d.nombreWorker ?? 'pdf.worker-Cp5SGYZ2.js'), d.worker ?? chunk(URLS_WORKER, 1, 5));
  const r = spawnSync(process.execPath, [SCRIPT, 'dist'], { cwd: base, encoding: 'utf8' });
  return { salida: r.status ?? -1, texto: r.stdout + r.stderr };
}

describe('T-CD-03 excepción exacta de pdf.js en check-dist (V-42)', () => {
  it('pasa con las cuentas y las URL literales aprobadas en los dos chunks', () => {
    const r = correr({});
    expect(r.texto).toContain('check-dist: OK');
    expect(r.salida).toBe(0);
  });

  it('pasa con menos de lo aprobado (la excepción es un tope, no una obligación)', () => {
    expect(correr({ principal: chunk(URLS_PRINCIPAL, 2, 0), worker: chunk(URLS_WORKER, 0, 3) }).salida).toBe(0);
  });

  it('canario: una XMLHttpRequest de más en cualquiera de los dos chunks falla', () => {
    const p = correr({ principal: chunk(URLS_PRINCIPAL, 4, 0) });
    expect(p.salida).toBe(1);
    expect(p.texto).toMatch(/pdf-C2pV2Gs3\.js: XMLHttpRequest ×4/);
    const w = correr({ worker: chunk(URLS_WORKER, 2, 5) });
    expect(w.salida).toBe(1);
    expect(w.texto).toMatch(/pdf\.worker-Cp5SGYZ2\.js: XMLHttpRequest ×2/);
  });

  it('canario: una referencia a console de más falla (0 en el principal, 5 en el worker)', () => {
    expect(correr({ principal: chunk(URLS_PRINCIPAL, 3, 1) }).texto).toMatch(/pdf-C2pV2Gs3\.js: console ×1/);
    expect(correr({ worker: chunk(URLS_WORKER, 1, 6) }).texto).toMatch(/pdf\.worker-Cp5SGYZ2\.js: console ×6/);
    expect(correr({ worker: chunk(URLS_WORKER, 1, 6) }).salida).toBe(1);
  });

  it('canario: una URL externa de más falla, y cambiar una por otra de igual cuenta también (se compara la lista literal)', () => {
    const mas = correr({ principal: chunk([...URLS_PRINCIPAL, 'https://cdn.ejemplo.test/x.js'], 3, 0) });
    expect(mas.salida).toBe(1);
    expect(mas.texto).toMatch(/pdf-C2pV2Gs3\.js: URL externas fuera de la lista literal aprobada/);
    const cambiada = correr({ worker: chunk([...URLS_WORKER.slice(0, -1), 'http://ns.adobe.com/otro/'], 1, 5) });
    expect(cambiada.salida).toBe(1);
    expect(cambiada.texto).toMatch(/pdf\.worker-Cp5SGYZ2\.js: URL externas fuera de la lista literal aprobada/);
    const menos = correr({ principal: chunk(URLS_PRINCIPAL.slice(1), 3, 0) });
    expect(menos.salida).toBe(1);
  });

  it('canario: ninguna excepción para blob:, eval ni new Function dentro de los chunks de pdf.js', () => {
    for (const [extra, regla] of [['var b="blob:";', 'blob:'], ['eval("1");', 'eval'], ['new Function("return 1");', 'new Function']] as const) {
      for (const donde of ['principal', 'worker'] as const) {
        const d: Dist = donde === 'principal' ? { principal: chunk(URLS_PRINCIPAL, 3, 0, extra) } : { worker: chunk(URLS_WORKER, 1, 5, extra) };
        const r = correr(d);
        expect(r.salida, `${donde} ${regla}`).toBe(1);
        expect(r.texto, `${donde} ${regla}`).toContain(`${regla} ×1`);
      }
    }
  });

  it('canario: la misma cuenta en un archivo con otro nombre no goza de la excepción', () => {
    const r = correr({ nombrePrincipal: 'otro-C2pV2Gs3.js' });
    expect(r.salida).toBe(1);
    expect(r.texto).toContain('otro-C2pV2Gs3.js: XMLHttpRequest ×3');
    expect(correr({ nombreWorker: 'pdf.worker.js' }).salida).toBe(1);
  });

  it('canario: un chunk con el nombre de pdf.js pero sin la versión aprobada en su contenido no goza de la excepción', () => {
    const r = correr({ principal: chunk(URLS_PRINCIPAL, 3, 0, '', '6.4.300') });
    expect(r.salida).toBe(1);
    expect(r.texto).toContain('pdf-C2pV2Gs3.js: XMLHttpRequest ×3');
  });

  it('canario: si pdfjs-dist cambia de versión, la excepción no vale hasta revisarla de nuevo', () => {
    const r = correr({}, '6.5.0');
    expect(r.salida).toBe(1);
    expect(r.texto).toMatch(/versión de pdfjs-dist distinta de la aprobada/);
  });
});
