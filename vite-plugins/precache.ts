// Lista de precache con SHA-256 (3.2, V-15; PD-1). Cuando Vite termina de escribir dist/, el plugin recorre los
// archivos ya escritos (los mismos bytes que se publican), emite dist/precache.json y escribe en dist/sw.js, en lugar
// del marcador `__SIGLOW_SW__`, el texto exacto de esa lista, las cabeceras de public/_headers (una sola fuente) y los
// tipos MIME. Todo archivo de dist/ debe estar clasificado: uno no previsto detiene el build (nada entra ni queda
// fuera del precache sin decidirlo aquí). PF-2 agrega en `clasificar` los manifiestos del modelo.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

export interface ArchivoPrecache {
  ruta: string; // ruta absoluta del sitio: «/» para index.html
  sha256: string; // hexadecimal en minúsculas
  bytes: number;
}
/** Regla de `_headers` de Cloudflare Pages: patrón (con `*` como comodín) y sus cabeceras, en orden. */
export type ReglaCabeceras = [patron: string, cabeceras: [nombre: string, valor: string][]];
/** Lo que el plugin escribe en sw.js en lugar de `__SIGLOW_SW__`. */
export interface ConfigSw {
  lista: string; // texto exacto de dist/precache.json; el SW calcula su SHA-256 (nombre de la caché)
  cabeceras: ReglaCabeceras[];
  tipos: Record<string, string>; // extensión → Content-Type
}

export const MARCADOR = '__SIGLOW_SW__';
export const RUTA_LISTA = '/precache.json';

/** Content-Type por extensión: los mismos de tests/e2e/server.mjs; `.wasm` y `.mjs` según 3.6. */
export const TIPOS: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

/**
 * Destino de cada archivo de dist/ (ruta relativa con «/»): 'precache' entra a la lista; 'fuera' nunca se cachea;
 * null es un archivo no previsto y detiene el build. Nunca en el precache: sw.js, _headers ni trozos del modelo (3.2).
 */
export function clasificar(rel: string): 'precache' | 'fuera' | null {
  if (rel === 'index.html' || rel === 'tt-policy.js' || rel.startsWith('assets/')) return 'precache';
  if (rel === 'ort/ort-wasm-simd-threaded.mjs' || rel === 'ort/ort-wasm-simd-threaded.wasm') return 'precache';
  if (rel === 'sw.js' || rel === '_headers' || rel === 'precache.json') return 'fuera';
  return null;
}

/** Entradas que todo build debe tener (3.2): sin ellas la app no funcionaría sin conexión. */
const OBLIGATORIAS = ['/', '/tt-policy.js', '/ort/ort-wasm-simd-threaded.mjs', '/ort/ort-wasm-simd-threaded.wasm'];
// Solo caracteres que el navegador no codifica en `URL.pathname`: el SW compara la ruta pedida tal cual.
const RUTA_SEGURA = /^\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*)?$/;

export const sha256Hex = (datos: Uint8Array | string): string => createHash('sha256').update(datos).digest('hex');

export function extension(ruta: string): string {
  if (ruta === '/') return '.html';
  const nombre = ruta.slice(ruta.lastIndexOf('/') + 1);
  const i = nombre.lastIndexOf('.');
  return i > 0 ? nombre.slice(i) : '';
}

/** Texto canónico de precache.json: entradas ordenadas por ruta, sin campos de más y con salto final. */
export function serializarLista(archivos: readonly ArchivoPrecache[]): string {
  const orden = [...archivos].sort((a, b) => (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : 0));
  return JSON.stringify({ formato: 1, archivos: orden.map(({ ruta, sha256, bytes }) => ({ ruta, sha256, bytes })) }, null, 2) + '\n';
}

/** Lee `_headers` como lo hace tests/e2e/server.mjs: una ruta sin sangría y sus cabeceras sangradas debajo. */
export function leerCabeceras(texto: string): ReglaCabeceras[] {
  const reglas: ReglaCabeceras[] = [];
  let actual: ReglaCabeceras | null = null;
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.trim() || linea.trim().startsWith('#')) continue;
    if (!/^\s/.test(linea)) {
      actual = [linea.trim(), []];
      reglas.push(actual);
      continue;
    }
    const i = linea.indexOf(':');
    if (actual && i > 0) actual[1].push([linea.slice(0, i).trim(), linea.slice(i + 1).trim()]);
  }
  return reglas;
}

function recorrer(dir: string, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) recorrer(p, salida);
    else salida.push(p);
  }
  return salida;
}

/** Calcula la lista desde los archivos ya escritos en `dir`. Lanza ante un archivo no previsto o una ruta insegura. */
export function listaDesdeDist(dir: string): ArchivoPrecache[] {
  const archivos: ArchivoPrecache[] = [];
  const problemas: string[] = [];
  for (const p of recorrer(dir)) {
    const rel = relative(dir, p).split(sep).join('/');
    const destino = clasificar(rel);
    if (destino === null) problemas.push(`${rel}: archivo no previsto en dist/ (clasifíquelo en vite-plugins/precache.ts)`);
    if (destino !== 'precache') continue;
    const ruta = rel === 'index.html' ? '/' : `/${rel}`;
    if (!RUTA_SEGURA.test(ruta)) problemas.push(`${rel}: nombre con caracteres fuera de [A-Za-z0-9._-]`);
    if (!Object.hasOwn(TIPOS, extension(ruta))) problemas.push(`${rel}: extensión sin tipo MIME conocido`);
    const datos = readFileSync(p);
    archivos.push({ ruta, sha256: sha256Hex(datos), bytes: datos.length });
  }
  for (const r of OBLIGATORIAS) if (!archivos.some((a) => a.ruta === r)) problemas.push(`${r}: falta en dist/`);
  if (problemas.length) throw new Error(`precache: ${problemas.length} problema(s)\n  - ${problemas.join('\n  - ')}`);
  return archivos;
}

/** Reemplaza el único marcador de sw.js por la configuración. Lanza si el marcador no aparece exactamente una vez. */
export function incrustarEnSw(codigo: string, config: ConfigSw): string {
  const apariciones = codigo.split(MARCADOR).length - 1;
  if (apariciones !== 1) throw new Error(`precache: sw.js tiene ${apariciones} marcadores ${MARCADOR}; se esperaba 1`);
  return codigo.replace(MARCADOR, () => JSON.stringify(config));
}

export function precache(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'siglow-precache',
    apply: 'build',
    enforce: 'post',
    configResolved(c) {
      config = c;
    },
    writeBundle: {
      order: 'post',
      sequential: true,
      handler(opciones, bundle) {
        const sw = bundle['sw.js'];
        if (!sw || sw.type !== 'chunk' || !sw.isEntry) this.error('precache: el build no emitió sw.js como entrada');
        // sw.js va solo: un import suyo saldría de la red al registrar y escaparía a la lista.
        if (sw.imports.length || sw.dynamicImports.length) this.error('precache: sw.js no puede importar otros chunks');
        const dir = resolve(config.root, opciones.dir ?? config.build.outDir);
        try {
          const lista = serializarLista(listaDesdeDist(dir));
          const cabeceras = leerCabeceras(readFileSync(join(config.publicDir, '_headers'), 'utf8'));
          if (!cabeceras.length) throw new Error('precache: public/_headers sin reglas');
          writeFileSync(join(dir, 'precache.json'), lista);
          const rutaSw = join(dir, 'sw.js');
          writeFileSync(rutaSw, incrustarEnSw(readFileSync(rutaSw, 'utf8'), { lista, cabeceras, tipos: { ...TIPOS } }));
        } catch (e) {
          this.error(e instanceof Error ? e.message : 'precache: error desconocido');
        }
      },
    },
  };
}
