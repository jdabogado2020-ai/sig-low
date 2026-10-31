// Build de medición (`vite build --mode medicion`, con los ganchos de las pantallas de Revisión y Listo; nunca existe en `dist/`) servido
// con server.mjs en un puerto que elige el sistema (PD-5b: ningún spec usa `PORT + n`). `testMedicion` es el `test` de Playwright con
// dos cambios: un fixture de worker `medicion` (construye el build si `src/` es más nuevo, levanta el servidor y lo apaga al terminar)
// y `baseURL` apuntando a ese servidor, así que `page.goto('/')` va al build de medición sin que la prueba sepa el puerto.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { test as base } from '@playwright/test';

import { levantarServidor, type Servidor } from './servidores';

const DIR_MEDICION = 'dist-medicion';

/** Mtime más reciente bajo `dir`. */
function masNuevo(dir: string): number {
  let m = 0;
  for (const n of readdirSync(dir)) {
    const ruta = join(dir, n);
    const st = statSync(ruta);
    m = Math.max(m, st.isDirectory() ? masNuevo(ruta) : st.mtimeMs);
  }
  return m;
}

/** Construye el build de medición si falta o si algo de `src/` es más nuevo. */
export function construirMedicion(): void {
  const indice = join(DIR_MEDICION, 'index.html');
  if (existsSync(indice) && statSync(indice).mtimeMs >= masNuevo('src')) return;
  const r = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'medicion'], { stdio: 'ignore' });
  if (r.status !== 0) throw new Error('No se pudo construir el build de medición');
}

export const testMedicion = base.extend<object, { medicion: Servidor }>({
  medicion: [async ({}, use) => {
    construirMedicion();
    const servidor = await levantarServidor({ dir: DIR_MEDICION });
    await use(servidor);
    await servidor.parar();
  }, { scope: 'worker', timeout: 180_000 }],
  baseURL: async ({ medicion }, use) => { await use(medicion.origen); },
});
