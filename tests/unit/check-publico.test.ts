// T-BI-04: check-publico pasa sobre el esqueleto y falla ante cada canario de material privado.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_REPO = resolve(AQUI, '..', '..');
const SCRIPT = join(RAIZ_REPO, 'scripts', 'check-publico.mjs');

function correr(raiz?: string) {
  const args = [SCRIPT, ...(raiz ? ['--raiz', raiz] : [])];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { code: r.status, salida: `${r.stdout}${r.stderr}` };
}

const temporales: string[] = [];
function arbolTemporal(archivos: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'siglow-publico-'));
  temporales.push(dir);
  // un árbol público inocuo
  for (const f of ['src/core/types.ts', 'tests/unit/ejemplo.test.ts', 'docs/guia-abogado.md', 'README.md', ...archivos]) {
    const ruta = join(dir, ...f.split('/'));
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, 'contenido ficticio\n');
  }
  return dir;
}
afterEach(() => {
  while (temporales.length) rmSync(temporales.pop()!, { recursive: true, force: true });
});

describe('check-publico (T-BI-04)', () => {
  it('pasa sobre el esqueleto del repositorio público', () => {
    const r = correr();
    expect(r.salida).toContain('sin material privado');
    expect(r.code).toBe(0);
  });

  it('pasa sobre un árbol público sin material privado', () => {
    expect(correr(arbolTemporal([])).code).toBe(0);
  });

  const canarios: Array<[string, string]> = [
    ['bitacora/', 'bitacora/entradas/20261029-1200_P0-1.md'],
    ['prompts/', 'prompts/P0-1.md'],
    ['corpus/gen/', 'corpus/gen/generar.mjs'],
    ['plan técnico', 'Sig-Low_Plan_Tecnico_Hackaton.md'],
    ['plan técnico en subcarpeta', 'plan/Sig-Low_Plan_Tecnico_v1.1.md'],
    ['docs/piloto.md', 'docs/piloto.md'],
    ['plantilla de consentimiento en docs/', 'docs/consentimiento-informado.docx'],
    ['plantilla de consentimiento .md', 'plantillas/Consentimiento_Informado.md'],
  ];
  for (const [nombre, archivo] of canarios) {
    it(`falla ante el canario ${nombre}`, () => {
      const r = correr(arbolTemporal([archivo]));
      expect(r.code).toBe(1);
      expect(r.salida).toContain('check-publico');
    });
  }

  it('ignora node_modules, dist y .git', () => {
    const dir = arbolTemporal([
      'node_modules/paquete/bitacora/x.md', 'dist/prompts/x.md', '.git/bitacora/x.md', 'node_modules/Plan_Tecnico.md',
    ]);
    expect(correr(dir).code).toBe(0);
  });

  it('el corpus público (corpus/ficticio) no es el generador y pasa', () => {
    expect(correr(arbolTemporal(['corpus/ficticio/C01.txt', 'corpus/anotaciones/C01.json'])).code).toBe(0);
  });

  it('informa la ruta del hallazgo y no el contenido del archivo', () => {
    const dir = arbolTemporal(['docs/piloto.md']);
    const r = correr(dir);
    expect(r.salida).toContain('docs/piloto.md');
    expect(r.salida).not.toContain('contenido ficticio');
  });
});
