#!/usr/bin/env node
// Verificación externa de un despliegue (T-PV-15, T-RD-07; V-11; 3.6, 5.3.3, DoD-19). Node puro, sin dependencias.
// Descarga `/` y cada archivo del precache publicado y comprueba, contra una referencia que NO sale de la dirección verificada:
//   1. el SHA-256 y el tamaño de cada archivo;
//   2. las cabeceras de 3.6 (las de `public/_headers`) y el tipo MIME por extensión en cada respuesta;
//   3. que el HTML no contenga `/cdn-cgi/` (inyecciones del alojamiento) y que ninguna respuesta traiga `Set-Cookie`.
// Solo hace GET a la dirección dada: no envía ningún dato. Sale con 0 si todo coincide, con 1 ante cualquier diferencia (versión no
// aprobada) y con 2 si los argumentos o la referencia no sirven.
//
//   node scripts/verificar-despliegue.mjs <url> [<lista>] [opciones]
//
//   <url>            https://sig-low.vergarameloabogado.site  (http solo para localhost, 127.0.0.1 y [::1]: las pruebas)
//   <lista>          SHA256SUMS de las notas de la versión, con el formato de `sha256sum` (`<hex>  ./ruta`). Es la referencia.
//                    Sin ella, la referencia es el build local: `<dist>/precache.json`, `<dist>/sw.js` y la huella de `precache.json`.
//   --dist <dir>     build local de referencia cuando no hay lista (por defecto `dist`).
//   --headers <f>    `_headers` de referencia (por defecto `public/_headers` de este repositorio, la fuente de verdad de 3.6).
//   --todo           además descarga los trozos y auxiliares de cada modelo y los compara (tamaño, SHA-256 y cabeceras) con su
//                    manifiesto publicado, que a su vez coincide con la referencia (cientos de MB). Con lista, también los demás
//                    archivos de la lista, y cada archivo del modelo que esté en ella debe tener la misma huella que en el manifiesto.
//   --tiempo <s>     espera máxima por archivo (60 s por defecto; 10 min como mínimo para los archivos del modelo).
//
// Cloudflare Pages responde `/index.html` con un 308 hacia `/`: se acepta solo ese (308, hacia `/` del mismo sitio), y entonces
// los bytes del build se comprueban en `/`. Cualquier otra redirección es una diferencia.
//
// La lista debe salir de las notas de la versión publicadas con la etiqueta firmada, nunca de la dirección que se verifica.
// Los datos que llegan del servidor (precache.json publicado) son entrada no confiable: sus rutas se validan antes de pedirse.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_ARCHIVOS = 5000;
const MAX_BYTES = 64 * 1024 * 1024; // el alojamiento admite 25 MiB por archivo; el doble de margen
const PARALELO = 4;
const LOCALES = new Set(['localhost', '127.0.0.1', '[::1]']);
const RUTA_SEGURA = /^\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*)?$/;
// Lo que nunca entra al precache (vite-plugins/precache.ts, `clasificar`): el SW, `_headers` (Cloudflare no lo sirve), la propia lista y
// los trozos y auxiliares del modelo (se descargan a pedido). Con una lista, todo lo demás debe estar en el precache publicado.
const FUERA_DEL_PRECACHE = [/^\/(?:sw\.js|_headers|precache\.json)$/, /^\/models\/[^/]+\/(?:onnx\/[^/]+|tokenizer\.json|tokenizer_config\.json)$/];
// Content-Type por extensión (3.6 y tests/e2e/lib/cabeceras-esperadas.ts); se compara el tipo, sin parámetros como `charset`.
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
// Modelo (las formas de src/core/ner/manifest.ts y src/sw.ts): manifiesto en el precache; trozos y auxiliares fuera, a pedido.
const RUTA_MANIFIESTO = /^\/models\/(gliner-x-large|gliner-x-base)\/manifest\.json$/;
const ARCHIVO_DEL_MODELO = /^\/models\/[^/]+\/(?:onnx\/[^/]+|tokenizer\.json|tokenizer_config\.json|gliner_config\.json)$/;
const RUTA_AUXILIAR = /^(tokenizer|tokenizer_config|gliner_config)\.json$/;
const RUTA_TROZO = /^onnx\/model_quantized\.onnx\.part\d{3}$/;
const TIEMPO_MINIMO_MODELO_MS = 600_000;

const sha256 = (datos) => createHash('sha256').update(datos).digest('hex');

export class UsoIncorrecto extends Error {}

// ===== Referencia =====

/** Lee una lista con el formato de `sha256sum` (`<64 hex>␣␣<ruta>` o `<64 hex>␣*<ruta>`). Devuelve ruta del sitio → SHA-256. */
export function leerLista(texto) {
  const mapa = new Map();
  for (const [i, linea] of texto.split(/\r?\n/).entries()) {
    if (!linea.trim() || linea.startsWith('#')) continue;
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(linea);
    if (!m) throw new UsoIncorrecto(`la lista no tiene el formato de sha256sum en la línea ${i + 1}`);
    const rel = m[2].replace(/\\/g, '/').replace(/^\.\//, '');
    const ruta = `/${rel}`;
    const rutas = rel === 'index.html' ? ['/', '/index.html'] : [ruta];
    for (const r of rutas) {
      if (!RUTA_SEGURA.test(r)) throw new UsoIncorrecto(`la lista trae una ruta no válida en la línea ${i + 1}`);
      const h = m[1].toLowerCase();
      if (mapa.has(r) && mapa.get(r) !== h) throw new UsoIncorrecto(`la lista repite ${r} con dos huellas distintas`);
      mapa.set(r, h);
    }
  }
  if (mapa.size === 0) throw new UsoIncorrecto('la lista está vacía');
  return mapa;
}

/** Referencia desde un build local: el precache, `sw.js` y `precache.json` (la huella de la lista que el SW también calcula). */
export function referenciaDeDist(dir) {
  const leer = (nombre) => {
    const f = join(dir, nombre);
    if (!existsSync(f)) throw new UsoIncorrecto(`falta ${f}: construya con \`npm run build\` o pase la lista de la versión`);
    return readFileSync(f);
  };
  const lista = leer('precache.json');
  let archivos;
  try { archivos = JSON.parse(lista.toString('utf8')).archivos; } catch { archivos = undefined; }
  if (!Array.isArray(archivos)) throw new UsoIncorrecto(`${join(dir, 'precache.json')} no es una lista de precache`);
  const mapa = new Map(archivos.map((a) => [a.ruta, String(a.sha256).toLowerCase()]));
  if (mapa.has('/')) mapa.set('/index.html', mapa.get('/'));
  mapa.set('/precache.json', sha256(lista));
  mapa.set('/sw.js', sha256(leer('sw.js')));
  return mapa;
}

// ===== Cabeceras (_headers de Cloudflare Pages) =====

/** Reglas de `_headers`: una ruta con `*` como comodín y, sangradas debajo, `Nombre: valor` o `! Nombre` (quitar). */
export function leerCabeceras(texto) {
  const reglas = [];
  let actual = null;
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.trim() || linea.trim().startsWith('#')) continue;
    if (!/^\s/.test(linea)) { actual = { patron: linea.trim(), poner: [], quitar: [] }; reglas.push(actual); continue; }
    const t = linea.trim();
    if (actual && t.startsWith('!')) { actual.quitar.push(t.slice(1).trim().toLowerCase()); continue; }
    const i = linea.indexOf(':');
    if (actual && i > 0) actual.poner.push([linea.slice(0, i).trim().toLowerCase(), linea.slice(i + 1).trim()]);
  }
  return reglas;
}

const coincide = (patron, ruta) =>
  new RegExp('^' + patron.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(ruta);

/** Lo que `_headers` pide para `ruta`: las cabeceras con su valor y las que deben faltar. Las reglas posteriores pisan a las anteriores. */
export function cabecerasEsperadas(reglas, ruta) {
  const poner = new Map();
  const quitar = new Set(['set-cookie']);
  for (const r of reglas) {
    if (!coincide(r.patron, ruta)) continue;
    for (const [k, v] of r.poner) { poner.set(k, v); quitar.delete(k); }
    for (const k of r.quitar) { poner.delete(k); quitar.add(k); }
  }
  return { poner, quitar };
}

function mimeEsperado(ruta) {
  if (ruta === '/') return MIME['.html'];
  const m = /\.[a-z0-9]+$/.exec(ruta);
  return m ? MIME[m[0]] : undefined;
}

/** Diferencias entre la respuesta (`Headers` de fetch) y lo que pide `_headers`, más el tipo MIME por extensión. */
export function diferenciasDeCabeceras(ruta, recibidas, reglas) {
  const dif = [];
  const { poner, quitar } = cabecerasEsperadas(reglas, ruta);
  for (const [k, v] of poner) {
    const r = recibidas.get(k);
    if (r !== v) dif.push(`${ruta}: cabecera ${k} = ${r === null ? 'ausente' : JSON.stringify(r)} (esperado ${JSON.stringify(v)})`);
  }
  for (const k of quitar) if (recibidas.get(k) !== null) dif.push(`${ruta}: la cabecera ${k} debe faltar y llegó ${JSON.stringify(recibidas.get(k))}`);
  const mime = mimeEsperado(ruta);
  const tipo = (recibidas.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (mime !== undefined && tipo !== mime) dif.push(`${ruta}: content-type = ${JSON.stringify(recibidas.get('content-type'))} (esperado ${mime})`);
  return dif;
}

// ===== Descarga =====

async function descargar(base, ruta, tiempoMs, pedir) {
  try {
    const resp = await pedir(base + ruta, { method: 'GET', redirect: 'manual', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(tiempoMs) });
    if (resp.status !== 200) {
      await resp.body?.cancel().catch(() => undefined);
      const destino = resp.headers.get('location');
      // F0: el 308 de Cloudflare Pages de /index.html a / (del mismo sitio); los bytes se comprueban en «/».
      if (ruta === '/index.html' && resp.status === 308 && destino !== null && aMismaRaiz(destino, base)) return { redirigeA: '/', cabeceras: resp.headers };
      return { error: `HTTP ${resp.status}${destino ? ` hacia ${destino.slice(0, 120)}` : ''}` };
    }
    const largo = Number(resp.headers.get('content-length') ?? 0);
    if (largo > MAX_BYTES) { await resp.body?.cancel().catch(() => undefined); return { error: `pesa más de ${MAX_BYTES} bytes` }; }
    const datos = Buffer.from(await resp.arrayBuffer());
    if (datos.length > MAX_BYTES) return { error: `pesa más de ${MAX_BYTES} bytes` };
    return { datos, cabeceras: resp.headers };
  } catch (e) {
    const causa = e instanceof Error ? (e.cause && typeof e.cause === 'object' && 'code' in e.cause ? String(e.cause.code) : e.name) : 'error';
    return { error: `no se pudo descargar (${causa})` };
  }
}

/** ¿`destino` (Location, relativa o absoluta) es exactamente la raíz `/` del sitio verificado? */
function aMismaRaiz(destino, base) {
  try { return new URL(destino, `${base}/index.html`).href === `${base}/`; } catch { return false; }
}

/** Archivos que declara un manifiesto del modelo publicado (ruta del sitio → { tamano, sha256 }), o el motivo si no es válido. */
export function archivosDelManifiesto(ruta, datos) {
  const id = RUTA_MANIFIESTO.exec(ruta)?.[1];
  let m;
  try { m = JSON.parse(datos.toString('utf8')); } catch { m = undefined; }
  if (!id || m?.formato !== 'sig-low/modelo' || m.id !== id || !Array.isArray(m.trozos) || !Array.isArray(m.auxiliares) || m.trozos.length === 0) {
    return { error: `${ruta}: no es un manifiesto del modelo válido` };
  }
  const archivos = new Map();
  for (const [lista, patron] of [[m.auxiliares, RUTA_AUXILIAR], [m.trozos, RUTA_TROZO]]) {
    for (const a of lista) {
      if (typeof a?.ruta !== 'string' || !patron.test(a.ruta) || !Number.isInteger(a.tamano) || a.tamano < 1 || a.tamano > MAX_BYTES || !/^[0-9a-f]{64}$/.test(String(a.sha256))) {
        return { error: `${ruta}: el manifiesto trae un archivo no válido (${JSON.stringify(String(a?.ruta).slice(0, 80))})` };
      }
      archivos.set(`/models/${id}/${a.ruta}`, { tamano: a.tamano, sha256: a.sha256 });
    }
  }
  const suma = m.trozos.reduce((s, t) => s + t.tamano, 0);
  if (suma !== m.tamano) return { error: `${ruta}: la suma de los trozos (${suma}) no es el tamaño del modelo (${m.tamano})` };
  return { archivos };
}

async function enParalelo(items, n, tarea) {
  const salida = new Array(items.length);
  let siguiente = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (let i = siguiente++; i < items.length; i = siguiente++) salida[i] = await tarea(items[i]);
  }));
  return salida;
}

// ===== Verificación =====

/**
 * Compara el despliegue en `url` con la referencia. `opciones.referencia`: Map ruta → SHA-256; `opciones.reglas`: de leerCabeceras;
 * `opciones.todo`: pide también lo que la lista trae fuera del precache; `opciones.pedir`: fetch (para pruebas).
 * Devuelve { diferencias, archivos }; no lanza ante un despliegue malo.
 */
export async function verificarDespliegue(url, opciones) {
  const { referencia, reglas, todo = false, tiempoMs = 60_000, pedir = fetch, conLista = true } = opciones;
  const base = normalizarUrl(url);
  const dif = [];
  const publicado = await descargar(base, '/precache.json', tiempoMs, pedir);
  if (publicado.error) return { diferencias: [`/precache.json: ${publicado.error}`], archivos: 0 };

  let entradas;
  try { entradas = JSON.parse(publicado.datos.toString('utf8')); } catch { entradas = undefined; }
  const lista = entradas?.formato === 1 && Array.isArray(entradas.archivos) ? entradas.archivos : null;
  if (lista === null || lista.length > MAX_ARCHIVOS) return { diferencias: ['/precache.json publicado no es una lista de precache (formato 1) o es desmesurada'], archivos: 0 };

  const propias = new Map(); // ruta → { sha256, bytes } según el precache publicado
  for (const a of lista) {
    if (typeof a?.ruta !== 'string' || !RUTA_SEGURA.test(a.ruta) || !/^[0-9a-f]{64}$/.test(String(a.sha256))) { dif.push(`/precache.json publicado: entrada no válida (${JSON.stringify(String(a?.ruta).slice(0, 80))})`); continue; }
    propias.set(a.ruta, { sha256: a.sha256, bytes: a.bytes });
  }

  // El precache publicado debe ser el de la referencia: ni un archivo de más ni uno de menos (uno ausente no se verificaría).
  const esperadosEnPrecache = new Set([...referencia.keys()].filter((r) => r !== '/index.html' && !FUERA_DEL_PRECACHE.some((re) => re.test(r))));
  for (const r of esperadosEnPrecache) if (!propias.has(r)) dif.push(`${r}: está en la referencia y falta en el precache publicado`);
  for (const r of propias.keys()) if (!esperadosEnPrecache.has(r)) dif.push(`${r}: está en el precache publicado y no en ${conLista ? 'la lista' : 'el build de referencia'}`);

  const rutas = new Set(['/', '/index.html', '/sw.js', '/precache.json', ...propias.keys()]);
  // Los archivos del modelo de la lista se piden con su manifiesto (abajo), una sola vez.
  if (todo) for (const r of referencia.keys()) if (r !== '/_headers' && !ARCHIVO_DEL_MODELO.test(r)) rutas.add(r);
  const ordenadas = [...rutas].sort();
  const resultados = await enParalelo(ordenadas, PARALELO, async (ruta) => [ruta, ruta === '/precache.json' ? publicado : await descargar(base, ruta, tiempoMs, pedir)]);

  const cuerpos = new Map();
  let indiceRedirigido = false;
  for (const [ruta, r] of resultados) {
    if (r.error) { dif.push(`${ruta}: ${r.error}`); continue; }
    if (r.redirigeA) {
      indiceRedirigido = true;
      if (r.cabeceras.get('set-cookie') !== null) dif.push(`${ruta}: la cabecera set-cookie debe faltar y llegó ${JSON.stringify(r.cabeceras.get('set-cookie'))}`);
      continue;
    }
    cuerpos.set(ruta, r.datos);
    const huella = sha256(r.datos);
    const esperada = referencia.get(ruta);
    if (esperada === undefined) {
      if (ruta !== '/precache.json' || !conLista) dif.push(`${ruta}: no figura en ${conLista ? 'la lista' : 'el build de referencia'}`);
    } else if (huella !== esperada) dif.push(`${ruta}: SHA-256 ${huella} (esperado ${esperada})`);
    const propia = propias.get(ruta);
    if (propia) {
      if (huella !== propia.sha256) dif.push(`${ruta}: SHA-256 ${huella} distinto del que declara el precache publicado (${propia.sha256})`);
      if (propia.bytes !== undefined && propia.bytes !== r.datos.length) dif.push(`${ruta}: ${r.datos.length} bytes (el precache publicado declara ${propia.bytes})`);
    }
    dif.push(...diferenciasDeCabeceras(ruta, r.cabeceras, reglas));
  }
  const inicio = cuerpos.get('/');
  const indice = cuerpos.get('/index.html');
  if (inicio && indice && !inicio.equals(indice)) dif.push('/ y /index.html no sirven los mismos bytes');
  if (indiceRedirigido && !inicio) dif.push('/index.html redirige a /, y / no se pudo comprobar');
  if (inicio && inicio.includes('/cdn-cgi/')) dif.push('/: el HTML contiene /cdn-cgi/ (inyección del alojamiento)');

  let archivos = ordenadas.length;
  if (todo) {
    const delModelo = await verificarModelo(base, cuerpos, referencia, reglas, Math.max(tiempoMs, TIEMPO_MINIMO_MODELO_MS), pedir, dif);
    archivos += delModelo;
  }
  return { diferencias: dif, archivos };
}

/**
 * --todo (F0): cada trozo y auxiliar que declara un manifiesto publicado (ya comparado con la referencia) se descarga y se compara
 * con el manifiesto: tamaño, SHA-256 y cabeceras (el Content-Type de los trozos sale de `_headers`). Un archivo del modelo de la
 * lista que ningún manifiesto declara también se pide y se compara con la lista. Devuelve cuántos archivos pidió.
 */
async function verificarModelo(base, cuerpos, referencia, reglas, tiempoMs, pedir, dif) {
  const esperados = new Map(); // ruta → { tamano?, sha256 (manifiesto), lista? }
  for (const [ruta, datos] of cuerpos) {
    if (!RUTA_MANIFIESTO.test(ruta)) continue;
    if (referencia.get(ruta) !== sha256(datos)) continue; // ya es una diferencia: su contenido no es de fiar
    const m = archivosDelManifiesto(ruta, datos);
    if (m.error) { dif.push(m.error); continue; }
    for (const [r, a] of m.archivos) esperados.set(r, { ...a, lista: referencia.get(r) });
  }
  for (const [r, h] of referencia) {
    if (!ARCHIVO_DEL_MODELO.test(r) || esperados.has(r)) continue;
    esperados.set(r, { sha256: h, lista: h });
  }
  const rutas = [...esperados.keys()].sort();
  const resultados = await enParalelo(rutas, PARALELO, async (ruta) => [ruta, await descargar(base, ruta, tiempoMs, pedir)]);
  for (const [ruta, r] of resultados) {
    if (r.error) { dif.push(`${ruta}: ${r.error}`); continue; }
    const e = esperados.get(ruta);
    const huella = sha256(r.datos);
    if (e.tamano !== undefined && r.datos.length !== e.tamano) dif.push(`${ruta}: ${r.datos.length} bytes (el manifiesto declara ${e.tamano})`);
    if (huella !== e.sha256) dif.push(`${ruta}: SHA-256 ${huella} (esperado ${e.sha256})`);
    else if (e.lista !== undefined && e.lista !== e.sha256) dif.push(`${ruta}: la lista de la versión y el manifiesto declaran huellas distintas`);
    dif.push(...diferenciasDeCabeceras(ruta, r.cabeceras, reglas));
  }
  return rutas.length;
}

function normalizarUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new UsoIncorrecto('la dirección no es una URL'); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOCALES.has(u.hostname))) throw new UsoIncorrecto('la dirección debe ser https (http solo para localhost, 127.0.0.1 o [::1])');
  if (u.username || u.password || u.search || u.hash) throw new UsoIncorrecto('la dirección no lleva usuario, contraseña, query ni fragmento');
  return u.origin + u.pathname.replace(/\/+$/, '');
}

// ===== Línea de comandos =====

function leerArgumentos(argv) {
  const pos = [];
  const o = { dist: 'dist', headers: join(RAIZ, 'public', '_headers'), todo: false, tiempo: 60 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--todo') o.todo = true;
    else if (a === '--dist' || a === '--headers' || a === '--tiempo') {
      const v = argv[++i];
      if (v === undefined) throw new UsoIncorrecto(`${a} necesita un valor`);
      if (a === '--tiempo') { o.tiempo = Number(v); if (!(o.tiempo > 0)) throw new UsoIncorrecto('--tiempo debe ser un número de segundos positivo'); } else o[a.slice(2)] = v;
    } else if (a.startsWith('--')) throw new UsoIncorrecto(`opción desconocida: ${a}`);
    else pos.push(a);
  }
  if (pos.length < 1 || pos.length > 2) throw new UsoIncorrecto('uso: node scripts/verificar-despliegue.mjs <url> [<lista>] [--dist <dir>] [--headers <_headers>] [--todo] [--tiempo <s>]');
  return { url: pos[0], lista: pos[1], ...o };
}

async function principal() {
  let a;
  let referencia;
  let reglas;
  try {
    a = leerArgumentos(process.argv.slice(2));
    normalizarUrl(a.url);
    if (!existsSync(a.headers)) throw new UsoIncorrecto(`falta ${a.headers}`);
    reglas = leerCabeceras(readFileSync(a.headers, 'utf8'));
    if (a.lista !== undefined) {
      if (!existsSync(a.lista)) throw new UsoIncorrecto(`falta la lista ${a.lista}`);
      referencia = leerLista(readFileSync(a.lista, 'utf8'));
    } else {
      referencia = referenciaDeDist(a.dist);
    }
  } catch (e) {
    if (!(e instanceof UsoIncorrecto)) throw e;
    process.stderr.write(`verificar-despliegue: ${e.message}\n`);
    return 2;
  }
  const { diferencias, archivos } = await verificarDespliegue(a.url, { referencia, reglas, todo: a.todo, tiempoMs: a.tiempo * 1000, conLista: a.lista !== undefined });
  if (diferencias.length === 0) {
    process.stdout.write(`verificar-despliegue: OK (${archivos} archivos: SHA-256 y cabeceras de 3.6 coinciden)\n`);
    return 0;
  }
  for (const d of diferencias) process.stdout.write(`  ${d}\n`);
  process.stdout.write(`verificar-despliegue: FALLA (${diferencias.length} diferencias en ${archivos} archivos): versión no aprobada\n`);
  return 1;
}

if (import.meta.main) process.exitCode = await principal();
