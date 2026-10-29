// npm run verify (9.1): los 7 pasos en orden, serializados con un candado de 2 ranuras (H0-12).
// --full agrega toda la suite E2E, --repeat-each=5 de cero red y T-IV-01 estricto (P0-5).
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FULL = process.argv.includes('--full');
const RAIZ_CANDADO = join(tmpdir(), 'siglow-verify');
mkdirSync(RAIZ_CANDADO, { recursive: true });

const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const espera = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function tomarRanura() {
  const t0 = Date.now();
  for (;;) {
    for (const n of [0, 1]) {
      const d = join(RAIZ_CANDADO, `ranura-${n}`);
      try { mkdirSync(d); writeFileSync(join(d, 'pid'), String(process.pid)); return { n, d }; } catch {
        const pid = Number(existsSync(join(d, 'pid')) ? readFileSync(join(d, 'pid'), 'utf8') : 0);
        if (pid && !vivo(pid)) rmSync(d, { recursive: true, force: true });
      }
    }
    if (Date.now() - t0 > 30 * 60_000) { process.stderr.write('verify: candado ocupado más de 30 min\n'); process.exit(2); }
    espera(2000);
  }
}

const ranura = tomarRanura();
const liberar = () => rmSync(ranura.d, { recursive: true, force: true });
process.on('exit', liberar);
process.on('SIGINT', () => process.exit(130));
const PORT = String(4173 + ranura.n * 10);

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const pasos = [
  ['1 typecheck', npx, ['tsc', '--noEmit', '-p', 'tsconfig.json']],
  ['1 typecheck (workers)', npx, ['tsc', '--noEmit', '-p', 'tsconfig.worker.json']],
  ['1 typecheck (pruebas y scripts)', npx, ['tsc', '--noEmit', '-p', 'tsconfig.node.json']],
  ['2 lint', npx, ['eslint', '.']],
  ['3 test:unit', npx, ['vitest', 'run']],
  ['4 build', npx, ['vite', 'build']],
  ['5 check-dist', process.execPath, ['scripts/check-dist.mjs']],
  ['6 test:e2e:verify', npx, ['playwright', 'test', '--grep', '@cero-red|@humo']],
  ['7 check-publico', process.execPath, ['scripts/check-publico.mjs']],
];
if (FULL) {
  pasos.push(['full e2e', npx, ['playwright', 'test']]);
  pasos.push(['full cero red ×5', npx, ['playwright', 'test', 'tests/e2e/zero-network.spec.ts', '--repeat-each=5']]);
  pasos.push(['full T-IV-01', process.execPath, ['scripts/check-invariantes.mjs']]);
} else if (existsSync('scripts/check-invariantes.mjs')) {
  pasos.push(['T-IV-01 (informa)', process.execPath, ['scripts/check-invariantes.mjs', '--informar']]);
}

const inicio = Date.now();
for (const [nombre, cmd, args] of pasos) {
  const t = Date.now();
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' && cmd !== process.execPath, env: { ...process.env, PORT } });
  const s = ((Date.now() - t) / 1000).toFixed(1);
  if (r.status !== 0) { process.stderr.write(`\nverify: FALLA en «${nombre}» (${s} s)\n`); process.exit(1); }
  process.stdout.write(`verify: ✔ ${nombre} (${s} s)\n`);
}
process.stdout.write(`verify: VERDE en ${((Date.now() - inicio) / 1000).toFixed(0)} s (ranura ${ranura.n}, puerto ${PORT})\n`);
