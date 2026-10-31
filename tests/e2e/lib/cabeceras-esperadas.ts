// Cabeceras esperadas por recurso (10.5.1, T-RD-02): se leen de `_headers` del build (valores literales en 3.6), nunca se copian
// a mano en la prueba. El plan nombra este módulo `tests/e2e/cabeceras-esperadas.ts`; vive en `lib/` por la propiedad de archivos de PD-5a.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cabecerasPara, parseHeaders } from './cabeceras.mjs';

/** Tipo de contenido que debe llevar cada extensión (la ruta «/» y «/index.html» son HTML). */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm',
};

export function mimeEsperado(ruta: string): string | undefined {
  if (ruta === '/') return MIME['.html'];
  const m = /\.[a-z0-9]+$/.exec(ruta.split('?')[0] ?? '');
  return m ? MIME[m[0]] : undefined;
}

/** Cabeceras de `dist/_headers` que aplican a `ruta`, en minúsculas. */
export function cabecerasEsperadas(ruta: string, dir = 'dist'): Record<string, string> {
  const reglas = parseHeaders(readFileSync(join(dir, '_headers'), 'utf8'));
  return Object.fromEntries([...cabecerasPara(reglas, ruta)].map(([k, v]) => [k.toLowerCase(), v]));
}

/** Diferencias entre las cabeceras recibidas y las esperadas (vacío = cumple). Las de transporte no se comparan. */
export function diferenciasDeCabeceras(ruta: string, recibidas: Record<string, string>, dir = 'dist'): string[] {
  const dif: string[] = [];
  const rec = Object.fromEntries(Object.entries(recibidas).map(([k, v]) => [k.toLowerCase(), v]));
  for (const [k, v] of Object.entries(cabecerasEsperadas(ruta, dir))) {
    if (rec[k] !== v) dif.push(`${ruta}: ${k} = ${JSON.stringify(rec[k])} (esperado ${JSON.stringify(v)})`);
  }
  const mime = mimeEsperado(ruta);
  if (mime !== undefined && rec['content-type'] !== mime) dif.push(`${ruta}: content-type = ${JSON.stringify(rec['content-type'])} (esperado ${JSON.stringify(mime)})`);
  return dif;
}
