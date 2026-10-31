// npm run medir (PG-3b; plan 10.3.3): lanza las corridas de tests/medicion/ con el motor de producción sobre el texto canónico.
//   npm run medir -- --config=<sin-modelo|x-large|x-base> --vista=<natural|mayusculas|minusculas> --hilos=<1|4|8> --conjunto=<todo|desarrollo|reserva>
//   npm run medir -- --rapido            reglas y lista sobre los .txt, sin oráculo (medir:rapido)
//   npm run medir -- --todo              el recorrido de cierre: sin modelo, y x-large en las tres vistas, y luego el veredicto
//   npm run medir -- --solo-veredicto    solo el veredicto de 10.4.1 y el registro de brechas sobre los informes ya escritos
// No ejecuta el modelo: con --config=x-large o x-base lee la caché `metricas/modelo-<id>-<vista>.json` (PF-3, PF-4a, PF-4b).
// Con x-large, al terminar corre el veredicto (scripts/veredicto.ts). Sale con 0 si todo cumple, 1 si alguna prueba o el veredicto
// no cumple y 2 si los argumentos son inválidos.
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { main as veredicto } from './veredicto.ts';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIGS = ['sin-modelo', 'x-large', 'x-base'] as const;
const VISTAS = ['natural', 'mayusculas', 'minusculas'] as const;
const HILOS = ['1', '4', '8'] as const;
const CONJUNTOS = ['todo', 'desarrollo', 'reserva'] as const;

export interface Corrida { config: typeof CONFIGS[number]; vista: typeof VISTAS[number]; hilos: typeof HILOS[number]; conjunto: typeof CONJUNTOS[number]; rapido: boolean }

export function leerArgumentos(argv: readonly string[]): { corridas: Corrida[]; todo: boolean; soloVeredicto: boolean } | string {
  const a = new Map<string, string>();
  for (const x of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/u.exec(x);
    if (m === null) return `argumento no reconocido: ${x}`;
    a.set(m[1] as string, m[2] ?? '');
  }
  const permitido = new Set(['config', 'vista', 'hilos', 'conjunto', 'rapido', 'todo', 'solo-veredicto']);
  for (const k of a.keys()) if (!permitido.has(k)) return `opción desconocida: --${k}`;
  const elegir = <T extends string>(nombre: string, validos: readonly T[], porDefecto: T): { v: T } | { error: string } => {
    const v = a.get(nombre) ?? porDefecto;
    return (validos as readonly string[]).includes(v) ? { v: v as T } : { error: `--${nombre}=${v}: valores válidos ${validos.join(' | ')}` };
  };
  const conjuntoE = elegir('conjunto', CONJUNTOS, 'todo');
  const hilosE = elegir('hilos', HILOS, '8');
  if ('error' in conjuntoE) return conjuntoE.error;
  if ('error' in hilosE) return hilosE.error;
  const conjunto = conjuntoE.v;
  const hilos = hilosE.v;
  const todo = a.has('todo');
  const soloVeredicto = a.has('solo-veredicto');
  const rapido = a.has('rapido');
  if (todo) {
    const corridas: Corrida[] = [{ config: 'sin-modelo', vista: 'natural', hilos, conjunto, rapido }];
    for (const vista of VISTAS) corridas.push({ config: 'x-large', vista, hilos, conjunto, rapido });
    return { corridas, todo, soloVeredicto };
  }
  const configE = elegir('config', CONFIGS, 'sin-modelo');
  const vistaE = elegir('vista', VISTAS, 'natural');
  if ('error' in configE) return configE.error;
  if ('error' in vistaE) return vistaE.error;
  return { corridas: soloVeredicto ? [] : [{ config: configE.v, vista: vistaE.v, hilos, conjunto, rapido }], todo, soloVeredicto };
}

function lanzar(c: Corrida): number {
  const env = {
    ...process.env, SIGLOW_MEDIR: '1', SIGLOW_MEDIR_CONFIG: c.config, SIGLOW_MEDIR_VISTA: c.vista, SIGLOW_MEDIR_HILOS: c.hilos,
    SIGLOW_MEDIR_CONJUNTO: c.conjunto, SIGLOW_MEDIR_RAPIDO: c.rapido ? '1' : '0', SIGLOW_MEDIR_SALIDA: join(RAIZ, 'corpus', 'resultados'),
  };
  // Binario de Vitest invocado con Node y sin shell, como hace verify (en Windows la «|» de un patrón se leería como tubería).
  const r = spawnSync(process.execPath, [join(RAIZ, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', 'tests/medicion/vitest.config.ts',
    'tests/medicion/motor-medicion.test.ts'], { cwd: RAIZ, env, stdio: 'inherit' });
  return r.status ?? 1;
}

export function main(argv: readonly string[]): number {
  const args = leerArgumentos(argv);
  if (typeof args === 'string') {
    process.stderr.write(`medir: ${args}\nUso: npm run medir -- --config=<sin-modelo|x-large|x-base> --vista=<natural|mayusculas|minusculas> --hilos=<1|4|8> --conjunto=<todo|desarrollo|reserva> [--rapido] [--todo] [--solo-veredicto]\n`);
    return 2;
  }
  let codigo = 0;
  for (const c of args.corridas) {
    process.stdout.write(`\n== medir: ${c.config} · ${c.vista} · ${c.hilos} h · ${c.conjunto}${c.rapido ? ' · rápida' : ''} ==\n`);
    if (lanzar(c) !== 0) codigo = 1;
  }
  const usaModelo = args.corridas.some((c) => c.config === 'x-large' && !c.rapido) || args.soloVeredicto;
  if (usaModelo) {
    process.stdout.write('\n== veredicto de 10.4.1 ==\n');
    const v = veredicto([]);
    if (v !== 0) codigo = v === 2 ? 2 : 1;
  }
  return codigo;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
