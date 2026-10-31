// Evaluación del modelo por vista (PF-4a el principal x-large; PF-4b el respaldo x-base; plan 9.3, 9.5, 10.3.3, 10.4.1 y 10.8.5).
// Node 26 con eliminación de tipos:
//   node scripts/evaluar-modelo.ts <orden> [--opcion=valor ...]
//
// Opción común: --modelo=x-large (por defecto, archivo metricas/modelo-x-large-vistas.json) o --modelo=x-base (respaldo, PF-4b,
// archivo metricas/modelo-x-base-vistas.json).
//
//   pasada     Pasada del modelo en las vistas pedidas (por defecto mayusculas, minusculas y natural) sobre los documentos medibles
//              del corpus y caché de salidas por ventana (puntaje >= 0,1) en metricas/modelo-<modelo>-vistas.json. Candado del modelo.
//              Reanuda: un documento cuya huella de texto ya está en el archivo no se vuelve a pasar. La vista natural reutiliza,
//              documento a documento, la caché de PF-3 (x-large: metricas/historico/pf3-x-large-natural.json; x-base: la pasada de etiquetas
//              estándar metricas/etiquetas-x-base-estandar.json) si el texto, el ONNX y el código del motor son los mismos; los demás
//              se pasan de nuevo.
//   verificar  T-AB-06: una pasada nueva de C22, C10 y C13 (12 ventanas) debe reproducir tramos y puntajes de la caché a +-1e-4 y la
//              huella del motor no debe haber cambiado. Escribe `verificacion` en el mismo archivo. Candado del modelo.
//   evaluar    T-AB-01, sin modelo: exhaustividad de PER, ORG y LOC por vista frente al gold, dentro y fuera de la lista, filas por
//              vista de 10.4.1 con el umbral de PF-3, matriz de confusión y reserva aparte. Escribe `evaluacion` en el mismo archivo.
//              Con --modelo=x-base calcula además T-AB-04: la comparación con el principal (`comparacion`), sin criterio de cierre.
//
// Las funciones de la evaluación son puras y están exportadas (las usa tests/medicion/evaluacion-modelo.test.ts). La parte que maneja
// el navegador (Playwright y Vite) se importa solo al ejecutar la orden. El corpus es ficticio (10.1.5): de él solo se guardan
// posiciones, etiquetas, puntajes, contadores e ids de anotación; nunca texto ni valores del gold.
//
// La vista es solo de medición (10.3.3): el texto canónico se pasa a MAYÚSCULAS o a minúsculas antes de entregarlo al modelo y los
// tramos se devuelven a las posiciones canónicas (INV-W04). El producto nunca cambia las mayúsculas del escrito.
import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cargarCorpus as cargarTextos, deteccionesDe, huellaMotor } from './calibrar-modelo.ts';
import type { CacheModelo as CachePF3, DocumentoCache, ParteCache, ParteTexto, VentanaCache } from './calibrar-modelo.ts';
import type { DataType, ModelManifest } from '../src/core/types.ts';
import { calcularFila, claveParte, esPositiva, evaluarDocumento, grupoDeTipo, omisionesPermitidas } from './metrics.ts';
import type { EntradaDocumento, GoldAnnotation, GrupoDef, MetricsRow, RunVista } from './metrics.ts';

export type Vista = RunVista;
export const VISTAS: readonly Vista[] = ['natural', 'mayusculas', 'minusculas'];
export type Modelo = 'x-large' | 'x-base';
export const ARCHIVO_VISTAS = 'metricas/modelo-x-large-vistas.json';
export const ARCHIVO_VISTAS_X_BASE = 'metricas/modelo-x-base-vistas.json';
/** Caché natural de x-large de PF-3 (19 documentos de desarrollo), histórica desde P0-4: fuera del patrón que lee `npm run medir`. */
export const ARCHIVO_NATURAL_PF3 = 'metricas/historico/pf3-x-large-natural.json';
/** Caché natural de x-base de PF-3 (etiquetas estándar, piso 0,1): de ella la vista natural del respaldo toma los documentos que no cambiaron. */
export const ARCHIVO_NATURAL_X_BASE_PF3 = 'metricas/etiquetas-x-base-estandar.json';
export const archivoVistasDe = (modelo: Modelo): string => (modelo === 'x-base' ? ARCHIVO_VISTAS_X_BASE : ARCHIVO_VISTAS);
export const archivoNaturalPf3De = (modelo: Modelo): string => (modelo === 'x-base' ? ARCHIVO_NATURAL_X_BASE_PF3 : ARCHIVO_NATURAL_PF3);
/** Documentos de T-AB-06 (9.5 y 10.8.5): 3 + 4 + 5 = 12 ventanas. */
export const DOCUMENTOS_T_AB_06: readonly string[] = ['C22', 'C10', 'C13'];
export const TOLERANCIA_PUNTAJE = 1e-4;
export const PISO_CACHE = 0.1;

// ===================================================================================================================
// Formato del archivo combinado
// ===================================================================================================================

export interface CacheVista extends CachePF3 {
  /** Documentos cuya caché viene de PF-3 sin repetir la pasada (texto, ONNX y código del motor iguales). */
  procedencia?: Record<string, 'PF-3'>;
}

export interface ResultadoVerificacion {
  vista: Vista;
  documentos: string[];
  ventanas: number;
  tramos: number;
  maxDiferenciaPuntaje: number;
  ok: boolean;
  discrepancias: string[];
}
export interface Verificacion {
  fecha: string;
  tolerancia: number;
  huellaMotorCoincide: boolean;
  huellaOnnxCoincide: boolean;
  resultados: ResultadoVerificacion[];
  ok: boolean;
}
export interface ArchivoVistas {
  formato: 'sig-low/cache-modelo-vistas';
  v: 1;
  modelo: Modelo;
  vistas: Partial<Record<Vista, CacheVista>>;
  verificacion?: Verificacion;
  evaluacion?: unknown;
  /** T-AB-04 (solo el archivo de x-base): comparación con el principal. */
  comparacion?: unknown;
}

// ===================================================================================================================
// Funciones puras
// ===================================================================================================================

const sha256Texto = (t: string): string => createHash('sha256').update(t).digest('hex');
export const sha256 = sha256Texto;

/**
 * Vista de medición del texto canónico. Conserva la longitud (INV-W04): cada carácter se pasa a mayúsculas o a minúsculas solo si el
 * resultado ocupa lo mismo (la «ß» pasaría a «SS» y se queda como está). Lanza si la longitud cambiara.
 */
export function vistaDeTexto(texto: string, vista: Vista): string {
  if (vista === 'natural') return texto;
  const f = vista === 'mayusculas' ? (c: string): string => c.toUpperCase() : (c: string): string => c.toLowerCase();
  let salida = '';
  for (const c of texto) {
    const t = f(c);
    salida += t.length === c.length ? t : c;
  }
  if (salida.length !== texto.length) throw new Error('VISTA_CAMBIA_LONGITUD');
  return salida;
}

/** Huella de texto de una caché: sha256 de las huellas de las partes, en el orden de documentos dado (el mismo cálculo de PF-3). */
export function huellaTextoDeCache(documentos: Record<string, DocumentoCache>, ids: readonly string[]): string {
  return sha256Texto(ids.flatMap((id) => Object.values((documentos[id] as DocumentoCache).partes).map((p) => p.sha256)).join(''));
}

const redondear = (x: number): number => Math.round(x * 1e6) / 1e6;

/**
 * Compara dos listas de ventanas de una misma parte: mismo número, mismos tramos (posiciones y etiqueta) y puntajes a +-`tol`.
 * Devuelve las discrepancias como textos sin contenido del documento.
 */
export function compararVentanas(
  docId: string, clave: string, cache: readonly VentanaCache[], nueva: readonly VentanaCache[], tol: number = TOLERANCIA_PUNTAJE,
): { tramos: number; maxDiferencia: number; discrepancias: string[] } {
  const d: string[] = [];
  let tramos = 0;
  let max = 0;
  if (cache.length !== nueva.length) d.push(`${docId}:${clave}: ${cache.length} ventanas en la caché y ${nueva.length} en la pasada nueva`);
  const n = Math.min(cache.length, nueva.length);
  for (let i = 0; i < n; i++) {
    const a = (cache[i] as VentanaCache).spans;
    const b = (nueva[i] as VentanaCache).spans;
    // Los dos lados se ordenan igual: el orden de salida del motor es por puntaje y no tiene por qué repetirse con los empates.
    const ord = (xs: readonly { start: number; end: number; label: string; score: number }[]) =>
      [...xs].sort((p, q) => p.start - q.start || p.end - q.end || p.label.localeCompare(q.label));
    const oa = ord(a);
    const ob = ord(b);
    if (oa.length !== ob.length) d.push(`${docId}:${clave}:ventana ${i}: ${oa.length} tramos en la caché y ${ob.length} en la pasada nueva`);
    const m = Math.min(oa.length, ob.length);
    for (let k = 0; k < m; k++) {
      const x = oa[k] as { start: number; end: number; label: string; score: number };
      const y = ob[k] as { start: number; end: number; label: string; score: number };
      tramos++;
      if (x.start !== y.start || x.end !== y.end || x.label !== y.label) {
        d.push(`${docId}:${clave}:ventana ${i}: tramo ${x.start}-${x.end} ${x.label} distinto de ${y.start}-${y.end} ${y.label}`);
        continue;
      }
      const dif = Math.abs(x.score - y.score);
      max = Math.max(max, dif);
      if (dif > tol) d.push(`${docId}:${clave}:ventana ${i}: tramo ${x.start}-${x.end} puntaje ${x.score} frente a ${y.score}`);
    }
  }
  return { tramos, maxDiferencia: max, discrepancias: d };
}

/** T-AB-06 sobre dos cachés ya leídas (la de la pasada y la nueva): resultado por vista. */
export function verificarCache(
  vista: Vista, cache: CacheVista, nueva: Record<string, DocumentoCache>, docs: readonly string[], tol: number = TOLERANCIA_PUNTAJE,
): ResultadoVerificacion {
  let ventanas = 0;
  let tramos = 0;
  let max = 0;
  const discrepancias: string[] = [];
  for (const id of docs) {
    const dc = cache.documentos[id];
    const dn = nueva[id];
    if (dc === undefined) { discrepancias.push(`${id}: no está en la caché`); continue; }
    if (dn === undefined) { discrepancias.push(`${id}: no está en la pasada nueva`); continue; }
    for (const [clave, parte] of Object.entries(dc.partes)) {
      const pn = dn.partes[clave];
      if (pn === undefined) { discrepancias.push(`${id}:${clave}: la pasada nueva no trae la parte`); continue; }
      if (parte.sha256 !== pn.sha256) discrepancias.push(`${id}:${clave}: el texto de la pasada nueva no es el de la caché`);
      const r = compararVentanas(id, clave, parte.ventanas, pn.ventanas, tol);
      ventanas += parte.ventanas.length;
      tramos += r.tramos;
      max = Math.max(max, r.maxDiferencia);
      discrepancias.push(...r.discrepancias);
    }
  }
  return { vista, documentos: [...docs], ventanas, tramos, maxDiferenciaPuntaje: redondear(max), ok: discrepancias.length === 0 && ventanas > 0, discrepancias };
}

/** Une una caché de PF-3 en la de una vista natural: copia los documentos cuyo texto no cambió (parte por parte, por sha256). */
export function reutilizarNatural(
  base: CachePF3, textos: Record<string, ParteTexto[]>, ids: readonly string[], onnx: string, codigo: string, modelo?: Modelo,
): { documentos: Record<string, DocumentoCache>; reutilizados: string[] } {
  const documentos: Record<string, DocumentoCache> = {};
  const reutilizados: string[] = [];
  if (base.huella.onnx !== onnx || base.huella.codigo !== codigo || base.piso > PISO_CACHE + 1e-9 || base.etiquetas !== 'estandar') return { documentos, reutilizados };
  if (modelo !== undefined && base.modelo !== modelo) return { documentos, reutilizados };
  if (base.vista !== undefined && base.vista !== 'natural') return { documentos, reutilizados };
  for (const id of ids) {
    const bd = base.documentos[id];
    const ps = textos[id] ?? [];
    if (bd === undefined) continue;
    const mismas = ps.length > 0 && ps.every((p) => bd.partes[p.clave]?.sha256 === sha256Texto(p.texto));
    const soloEsas = Object.keys(bd.partes).every((k) => ps.some((p) => p.clave === k));
    if (mismas && soloEsas) {
      documentos[id] = structuredClone(bd);
      reutilizados.push(id);
    }
  }
  return { documentos, reutilizados };
}

// ===================================================================================================================
// Utilidades de la línea de órdenes
// ===================================================================================================================

const ahora = (): string => {
  const z = (n: number): string => String(n).padStart(2, '0');
  const d = new Date();
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
};
const log = (t: string): void => { process.stdout.write(`${ahora().slice(11)} ${t}\n`); };
const arg = (a: Map<string, string>, k: string, d: string): string => a.get(k) ?? d;
function argumentos(argv: readonly string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const x of argv) {
    const r = /^--([a-z0-9-]+)(?:=(.*))?$/u.exec(x);
    if (r !== null) m.set(r[1] as string, r[2] ?? '');
  }
  return m;
}

function escribirJson(ruta: string, datos: unknown): void {
  mkdirSync(join(ruta, '..'), { recursive: true });
  const tmp = `${ruta}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(datos)}\n`);
  renameSync(tmp, ruta);
}
export function leerArchivoVistas(ruta: string, modelo: Modelo = 'x-large'): ArchivoVistas {
  if (!existsSync(ruta)) return { formato: 'sig-low/cache-modelo-vistas', v: 1, modelo, vistas: {} };
  return JSON.parse(readFileSync(ruta, 'utf8')) as ArchivoVistas;
}

function parseModelo(a: Map<string, string>): Modelo {
  const m = arg(a, 'modelo', 'x-large');
  if (m !== 'x-large' && m !== 'x-base') throw new Error(`modelo no válido: ${m}`);
  return m;
}

function parseVistas(texto: string): Vista[] {
  const v = texto.split(',').filter((x) => x !== '');
  for (const x of v) if (!(VISTAS as readonly string[]).includes(x)) throw new Error(`vista no válida: ${x}`);
  return v as Vista[];
}

// ===================================================================================================================
// Candado del modelo (una sola pasada del modelo grande a la vez en el equipo)
// ===================================================================================================================

async function tomarCandado(raiz: string, quien: string): Promise<() => void> {
  const dir = resolve(raiz, process.env['SIGLOW_CANDADO_MODELO'] ?? '../h0/candado-modelo');
  let avisado = false;
  for (;;) {
    try { mkdirSync(dir); break; } catch {
      if (!avisado) { log(`candado del modelo ocupado (${dir}): espero`); avisado = true; }
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
  try { writeFileSync(join(dir, 'quien.txt'), `${quien}, pid ${process.pid}, desde ${ahora()}\n`); } catch { /* el candado es el directorio */ }
  let liberado = false;
  const liberar = (): void => { if (!liberado) { liberado = true; try { rmSync(dir, { recursive: true, force: true }); } catch { /* ya no existe */ } } };
  process.on('exit', liberar);
  process.on('SIGINT', () => { liberar(); process.exit(130); });
  process.on('SIGTERM', () => { liberar(); process.exit(143); });
  log('candado del modelo tomado');
  return liberar;
}

// ===================================================================================================================
// Arnés: build de Vite (el de PF-3, tests/e2e/harness/calibrar.*), servidor y navegador
// ===================================================================================================================

async function sha256Archivo(ruta: string): Promise<string> {
  const { createReadStream } = await import('node:fs');
  return new Promise((ok, mal) => {
    const h = createHash('sha256');
    createReadStream(ruta).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', mal);
  });
}

async function manifiestoDe(carpeta: string, modelo: Modelo, umbral: number, solape: number): Promise<ModelManifest> {
  const info = async (ruta: string): Promise<{ ruta: string; tamano: number; sha256: string }> =>
    ({ ruta, tamano: statSync(join(carpeta, ruta)).size, sha256: await sha256Archivo(join(carpeta, ruta)) });
  const onnx = await info('onnx/model_quantized.onnx');
  return {
    formato: 'sig-low/modelo', v: 1, id: `gliner-${modelo}`, origen: 'prueba', familia: 'gliner', base: modelo === 'x-base' ? 'google/mt5-base' : 'google/mt5-large', cuantizacion: 'q8',
    etiquetas: ['person', 'organization', 'location'], umbral, ventanaTokens: 512, solapePalabras: solape, maxTramoPalabras: 12,
    tokenizador: { prefijo: 0, sufijo: 1, cls: false },
    archivo: 'onnx/model_quantized.onnx', tamano: onnx.tamano, sha256: onnx.sha256, trozos: [],
    auxiliares: [await info('tokenizer.json'), await info('tokenizer_config.json'), await info('gliner_config.json')] as never,
    licencia: 'Apache-2.0', memoria: { wasmMb: 0, jsMb: 0, minimoDispositivoGb: 8 },
  } as ModelManifest;
}

interface Arnes { origen: string; manifiesto: ModelManifest; cerrarServidor(): void }

async function prepararArnes(raiz: string, modelo: Modelo, solape: number): Promise<Arnes> {
  const { build, defaultClientConditions } = await import('vite');
  const modelos = resolve(raiz, process.env['SIGLOW_MODELOS'] ?? '../h0/modelos');
  const origenModelo = join(modelos, `gliner-${modelo}`);
  if (!existsSync(join(origenModelo, 'onnx', 'model_quantized.onnx'))) throw new Error(`faltan los modelos en ${modelos}`);
  // Fuera del repositorio: `test-results/` lo vacía cada E2E de Playwright (verify) y el ONNX pesa 600 MB.
  const carpeta = join(tmpdir(), 'siglow-A9-evaluar-arnes');
  mkdirSync(carpeta, { recursive: true });
  log('compilo el arnés');
  await build({
    configFile: false, root: join(raiz, 'tests/e2e/harness'), publicDir: join(raiz, 'public'), logLevel: 'silent', cacheDir: join(raiz, '.vite-cache'),
    resolve: { conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions] },
    define: { __SIGLOW_VERSION__: '"prueba"', __SIGLOW_MEDICION__: 'false' },
    build: {
      outDir: carpeta, emptyOutDir: false, target: 'es2024', assetsInlineLimit: 0, sourcemap: false, modulePreload: { polyfill: false }, reportCompressedSize: false,
      rolldownOptions: { input: { calibrar: join(raiz, 'tests/e2e/harness/calibrar.html') }, output: { minify: { compress: { dropConsole: true, dropDebugger: true } } } },
    },
    worker: { format: 'es', rolldownOptions: { output: { minify: { compress: { dropConsole: true, dropDebugger: true } } } } },
  });
  const destino = join(carpeta, 'models', `gliner-${modelo}`);
  mkdirSync(join(destino, 'onnx'), { recursive: true });
  for (const a of ['tokenizer.json', 'tokenizer_config.json', 'gliner_config.json']) cpSync(join(origenModelo, a), join(destino, a));
  const onnxDestino = join(destino, 'onnx', 'model_quantized.onnx');
  if (!existsSync(onnxDestino) || statSync(onnxDestino).size !== statSync(join(origenModelo, 'onnx', 'model_quantized.onnx')).size) {
    log('copio el modelo a la carpeta temporal (fuera de git)');
    cpSync(join(origenModelo, 'onnx', 'model_quantized.onnx'), onnxDestino);
  }
  const manifiesto = await manifiestoDe(destino, modelo, 0.3, solape);
  const puerto = Number(process.env['PORT'] ?? 5100);
  const servidor: ChildProcess = spawn(process.execPath, ['tests/e2e/server.mjs', '--dir', carpeta, '--port', String(puerto)], { stdio: 'ignore', cwd: raiz });
  const origen = `http://127.0.0.1:${puerto}`;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${origen}/`)).status) break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  return { origen, manifiesto, cerrarServidor: () => { servidor.kill(); } };
}

type Pagina = import('@playwright/test').Page;
interface VentanaOut { parte: string; i: number; n: number; ms: number; spans: Array<[number, number, 'PER' | 'ORG' | 'LOC', number]> }
interface RespuestaArnes {
  ok: boolean; error?: string; cargaTotalMs?: number; carga?: { warmupWindowMs: number; threads: number; [k: string]: unknown }; ventanas?: VentanaOut[]; totalMs?: number;
}
interface Sesion { page: Pagina; cerrar(): Promise<void>; navegador: string; carga: RespuestaArnes }

async function abrirSesion(arnes: Arnes, hilos: number, modelo: Modelo): Promise<Sesion> {
  const { chromium } = await import('@playwright/test');
  const navegador = await chromium.launch({ headless: true });
  const page = await navegador.newPage();
  page.on('pageerror', () => undefined);
  await page.goto(`${arnes.origen}/calibrar.html`);
  log(`cargo ${modelo} con ${hilos} hilos`);
  const carga = await page.evaluate(([m, h]) => (globalThis as never as { __cal: { iniciar(a: unknown, b: number): Promise<never> } }).__cal.iniciar(m, h),
    [arnes.manifiesto, hilos] as const) as RespuestaArnes;
  if (!carga.ok) { await navegador.close(); throw new Error(`carga fallida: ${String(carga.error)}`); }
  log(`cargado en ${Math.round(Number(carga.cargaTotalMs))} ms; calentamiento ${JSON.stringify(carga.carga?.warmupWindowMs)} ms`);
  return { page, carga, navegador: `chromium ${navegador.version()}`, cerrar: async () => { await navegador.close(); } };
}

const pasarPartes = (p: Pagina, ps: Array<{ clave: string; texto: string }>, solape: number): Promise<RespuestaArnes> =>
  p.evaluate(([a, b, c, d]) => (globalThis as never as { __cal: { partes(...x: unknown[]): Promise<never> } }).__cal.partes(a, b, c, d),
    [ps, PISO_CACHE, 'estandar', solape] as const) as Promise<RespuestaArnes>;

function cargaCpu(): number | null {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average'], { encoding: 'utf8' });
  const v = Number(r.stdout.trim());
  return Number.isFinite(v) ? v : null;
}

/** Pasa un documento (todas sus partes, con el texto en la vista pedida) y devuelve su caché. Las partes en blanco no se pasan. */
async function pasarDocumento(s: Sesion, partes: readonly ParteTexto[], vista: Vista, solape: number): Promise<{ doc: DocumentoCache; ventanas: number; ms: number; tramos: number }> {
  const ps = partes.filter((p) => p.texto.trim() !== '').map((p) => ({ clave: p.clave, texto: vistaDeTexto(p.texto, vista) }));
  const porParte: Record<string, ParteCache> = {};
  for (const p of partes) porParte[p.clave] = { sha256: sha256Texto(p.texto), ventanas: [] };
  let ventanas: VentanaOut[] = [];
  let total = 0;
  if (ps.length > 0) {
    const r = await pasarPartes(s.page, ps, solape);
    if (!r.ok) throw new Error(`fallo de la pasada: ${String(r.error)}`);
    ventanas = r.ventanas ?? [];
    total = Number(r.totalMs);
  }
  for (const v of ventanas) {
    (porParte[v.parte] as ParteCache).ventanas.push({ windowIndex: v.i, windowTotal: v.n, ms: v.ms, spans: v.spans.map(([start, end, label, score]) => ({ start, end, label, score })) });
  }
  return { doc: { partes: porParte }, ventanas: ventanas.length, ms: total, tramos: ventanas.reduce((n, v) => n + v.spans.length, 0) };
}

// ===================================================================================================================
// Orden pasada
// ===================================================================================================================

interface ContextoCorpus { carpeta: string; ids: string[]; textos: Record<string, ParteTexto[]> }
function cargarContexto(raiz: string, a: Map<string, string>): ContextoCorpus {
  const carpeta = resolve(raiz, arg(a, 'corpus', '.'));
  const { ids: todos, textos } = cargarTextos(carpeta);
  const filtro = a.get('docs');
  const ids = filtro === undefined || filtro === '' || filtro === 'todos' ? todos : filtro.split(',').filter((d) => todos.includes(d));
  return { carpeta, ids, textos };
}

async function ordenPasada(raiz: string, a: Map<string, string>): Promise<void> {
  const hilos = Number(arg(a, 'hilos', '8'));
  const solape = Number(arg(a, 'solape', '37'));
  const modelo = parseModelo(a);
  const vistas = parseVistas(arg(a, 'vistas', 'mayusculas,minusculas,natural'));
  const salida = resolve(raiz, arg(a, 'salida', archivoVistasDe(modelo)));
  const { ids, textos, carpeta } = cargarContexto(raiz, a);
  const huellaCodigo = huellaMotor(raiz);
  const liberarCandado = await tomarCandado(raiz, arg(a, 'quien', `evaluar-modelo pasada ${modelo}`));
  const arnes = await prepararArnes(raiz, modelo, solape);
  let sesion: Sesion | null = null;
  try {
    const archivo = leerArchivoVistas(salida, modelo);
    const conCpu0 = cargaCpu();
    for (const vista of vistas) {
      const previa = archivo.vistas[vista];
      if (previa !== undefined && (previa.huella.onnx !== arnes.manifiesto.sha256 || previa.huella.codigo !== huellaCodigo)) {
        log(`la caché de ${vista} del archivo es de otro ONNX o de otro código del motor: la descarto`);
        delete archivo.vistas[vista];
      }
      const documentos: Record<string, DocumentoCache> = { ...(archivo.vistas[vista]?.documentos ?? {}) };
      const procedencia: Record<string, 'PF-3'> = { ...(archivo.vistas[vista]?.procedencia ?? {}) };
      const vigente = (id: string): boolean => {
        const d = documentos[id];
        const ps = textos[id] ?? [];
        return d !== undefined && ps.every((p) => d.partes[p.clave]?.sha256 === sha256Texto(p.texto)) && Object.keys(d.partes).length === ps.length;
      };
      for (const id of Object.keys(documentos)) if (!ids.includes(id) || !vigente(id)) { delete documentos[id]; delete procedencia[id]; }
      if (vista === 'natural' && existsSync(resolve(raiz, archivoNaturalPf3De(modelo))) && !a.has('sin-pf3')) {
        const base = JSON.parse(readFileSync(resolve(raiz, archivoNaturalPf3De(modelo)), 'utf8')) as CachePF3;
        const { documentos: reus, reutilizados } = reutilizarNatural(base, textos, ids.filter((id) => documentos[id] === undefined), arnes.manifiesto.sha256, huellaCodigo, modelo);
        for (const id of reutilizados) { documentos[id] = reus[id] as DocumentoCache; procedencia[id] = 'PF-3'; }
        if (reutilizados.length > 0) log(`natural: ${reutilizados.length} documentos reutilizados de PF-3 (${reutilizados.join(' ')})`);
      }
      const pendientes = ids.filter((id) => documentos[id] === undefined);
      log(`vista ${vista}: ${ids.length - pendientes.length} documentos ya en la caché, ${pendientes.length} por pasar`);
      const guardar = (completa: boolean): void => {
        const conocidos = ids.filter((id) => documentos[id] !== undefined);
        const cuerpo: CacheVista = {
          formato: 'sig-low/cache-modelo', v: 1, modelo, vista, piso: PISO_CACHE, etiquetas: 'estandar',
          opciones: { windowTokens: 512, overlapWords: solape, maxSpanWords: 12 },
          huella: { texto: huellaTextoDeCache(documentos, conocidos), vista: sha256Texto(vista), onnx: arnes.manifiesto.sha256, codigo: huellaCodigo },
          ...(sesion?.carga.carga === undefined ? (archivo.vistas[vista]?.carga === undefined ? {} : { carga: archivo.vistas[vista]?.carga }) : { carga: sesion.carga.carga }),
          corrida: {
            hilos, navegador: sesion?.navegador ?? archivo.vistas[vista]?.corrida?.navegador ?? 'chromium', nucleosLogicos: 16, fecha: ahora(),
            equipo: 'Ryzen 7 5700U, 16 hilos, 15 GB (h0/equipo.txt)', conjunto: completa ? 'todo' : 'parcial',
          },
          documentos: Object.fromEntries(conocidos.map((id) => [id, documentos[id] as DocumentoCache])),
          ...(Object.keys(procedencia).length > 0 ? { procedencia } : {}),
        };
        archivo.vistas[vista] = cuerpo;
        escribirJson(salida, archivo);
      };
      if (pendientes.length === 0) { guardar(true); continue; }
      sesion ??= await abrirSesion(arnes, hilos, modelo);
      let hechos = 0;
      for (const id of pendientes) {
        const r = await pasarDocumento(sesion, textos[id] as ParteTexto[], vista, solape);
        documentos[id] = r.doc;
        hechos++;
        log(`${vista} ${id}: ${r.ventanas} ventanas, ${Math.round(r.ms / 100) / 10} s, ${r.tramos} tramos >= 0,1 (${hechos}/${pendientes.length})`);
        guardar(false);
      }
      guardar(true);
      log(`vista ${vista} completa: ${ids.length} documentos; escrito ${salida}`);
    }
    log(`carga de CPU antes ${String(conCpu0)} % y después ${String(cargaCpu())} %; corpus ${carpeta}`);
    if (sesion !== null) await sesion.page.evaluate(() => (globalThis as never as { __cal: { liberar(): Promise<void> } }).__cal.liberar());
  } finally {
    await sesion?.cerrar();
    arnes.cerrarServidor();
    liberarCandado();
  }
}

// ===================================================================================================================
// Orden verificar (T-AB-06)
// ===================================================================================================================

async function ordenVerificar(raiz: string, a: Map<string, string>): Promise<void> {
  const hilos = Number(arg(a, 'hilos', '8'));
  const solape = Number(arg(a, 'solape', '37'));
  const modelo = parseModelo(a);
  const vistas = parseVistas(arg(a, 'vistas', 'natural,mayusculas'));
  const salida = resolve(raiz, arg(a, 'salida', archivoVistasDe(modelo)));
  const docsArg = a.get('docs');
  const docs = docsArg === undefined || docsArg === '' ? [...DOCUMENTOS_T_AB_06] : docsArg.split(',');
  const { textos } = cargarContexto(raiz, a);
  const archivo = leerArchivoVistas(salida, modelo);
  const huellaCodigo = huellaMotor(raiz);
  const liberarCandado = await tomarCandado(raiz, arg(a, 'quien', `evaluar-modelo verificar ${modelo}`));
  const arnes = await prepararArnes(raiz, modelo, solape);
  let sesion: Sesion | null = null;
  try {
    sesion = await abrirSesion(arnes, hilos, modelo);
    const resultados: ResultadoVerificacion[] = [];
    for (const vista of vistas) {
      const cache = archivo.vistas[vista];
      if (cache === undefined) throw new Error(`la caché de la vista ${vista} no existe en ${salida}`);
      const nueva: Record<string, DocumentoCache> = {};
      for (const id of docs) {
        const r = await pasarDocumento(sesion, textos[id] as ParteTexto[], vista, solape);
        nueva[id] = r.doc;
        log(`${vista} ${id}: ${r.ventanas} ventanas nuevas, ${Math.round(r.ms / 100) / 10} s`);
      }
      const res = verificarCache(vista, cache, nueva, docs);
      resultados.push(res);
      log(`${vista}: ${res.ventanas} ventanas, ${res.tramos} tramos, diferencia máxima de puntaje ${res.maxDiferenciaPuntaje}, ${res.ok ? 'REPRODUCE' : `NO REPRODUCE (${res.discrepancias.length})`}`);
    }
    const huellasCoinciden = vistas.every((v) => archivo.vistas[v]?.huella.codigo === huellaCodigo);
    const onnxCoincide = vistas.every((v) => archivo.vistas[v]?.huella.onnx === arnes.manifiesto.sha256);
    const verificacion: Verificacion = {
      fecha: ahora(), tolerancia: TOLERANCIA_PUNTAJE, huellaMotorCoincide: huellasCoinciden, huellaOnnxCoincide: onnxCoincide,
      resultados, ok: huellasCoinciden && onnxCoincide && resultados.every((r) => r.ok),
    };
    archivo.verificacion = verificacion;
    escribirJson(salida, archivo);
    log(`T-AB-06: ${verificacion.ok ? 'la caché reproduce una pasada nueva' : 'LA CACHÉ NO SE REPRODUCE'}`);
    process.exitCode = verificacion.ok ? 0 : 1;
    await sesion.page.evaluate(() => (globalThis as never as { __cal: { liberar(): Promise<void> } }).__cal.liberar());
  } finally {
    await sesion?.cerrar();
    arnes.cerrarServidor();
    liberarCandado();
  }
}

// ===================================================================================================================
// T-AB-01: exhaustividad de PER, ORG y LOC por vista (funciones puras)
// ===================================================================================================================

const ORGS: readonly DataType[] = ['EMPRESA', 'EPS', 'IPS', 'ENTIDAD', 'PROVEEDOR'];
const UBICACIONES: readonly DataType[] = ['MUNICIPIO', 'DEPARTAMENTO', 'LUGAR'];
const enLista = (g: GoldAnnotation): boolean => g.enLista;
const fueraDeLista = (g: GoldAnnotation): boolean => !g.enLista;

/** Filas de T-AB-01: personas y organizaciones dentro y fuera de la lista, y ubicaciones (informativa). */
export const GRUPOS_T_AB_01: readonly GrupoDef[] = [
  { grupo: 'PERSONA_FUERA', tipos: ['PERSONA'], donde: fueraDeLista },
  { grupo: 'ORG_FUERA', tipos: ORGS, donde: fueraDeLista },
  { grupo: 'PERSONA_LISTA', tipos: ['PERSONA'], donde: enLista },
  { grupo: 'ORG_LISTA', tipos: ORGS, donde: enLista },
  { grupo: 'PERSONA_TODAS', tipos: ['PERSONA'] },
  { grupo: 'ORG_TODAS', tipos: ORGS },
  { grupo: 'LOC_TODAS', tipos: UBICACIONES },
];

/** Umbrales de cierre de las filas por vista de 10.4.1: [mención, entidad]. Personas 0,85 y 0,75; organizaciones 0,80 y 0,70 (S-10.2). */
export const UMBRALES_POR_VISTA: Readonly<Record<'PERSONA_FUERA' | 'ORG_FUERA', readonly [number, number]>> = {
  PERSONA_FUERA: [0.85, 0.75],
  ORG_FUERA: [0.8, 0.7],
};

export type Conjunto = 'todo' | 'desarrollo' | 'reserva';
export interface FilasPorConjunto { todo: MetricsRow[]; desarrollo: MetricsRow[]; reserva: MetricsRow[] }

/** Calcula las filas de T-AB-01 para los documentos de un conjunto del corpus (o todos). */
export function filasDe(entradas: readonly EntradaDocumento[], conjunto: Conjunto = 'todo'): MetricsRow[] {
  const sel = entradas.filter((e) => conjunto === 'todo' || e.gold.conjunto === conjunto);
  const evals = sel.map((e) => evaluarDocumento(e));
  return GRUPOS_T_AB_01.map((def) => calcularFila(def, evals));
}
export function filasPorConjunto(entradas: readonly EntradaDocumento[]): FilasPorConjunto {
  return { todo: filasDe(entradas, 'todo'), desarrollo: filasDe(entradas, 'desarrollo'), reserva: filasDe(entradas, 'reserva') };
}

export type EtiquetaModelo3 = 'PER' | 'ORG' | 'LOC';
const ETIQUETA_DE_TIPO: Record<string, EtiquetaModelo3> = { PERSONA: 'PER', ENTIDAD: 'ORG', LUGAR: 'LOC' };
export interface MatrizConfusion {
  /** Menciones positivas del gold por grupo de tipo y la etiqueta del modelo que más las cubre (`ninguna` si ninguna). */
  menciones: Record<string, Record<EtiquetaModelo3 | 'ninguna', number>>;
  /** Tramos del modelo que no tocan ninguna mención positiva, por etiqueta; los que tocan un negativo esperado van aparte. */
  sinMencion: Record<EtiquetaModelo3, number>;
  enNegativos: Record<EtiquetaModelo3, number>;
}
const cero3 = (): Record<EtiquetaModelo3, number> => ({ PER: 0, ORG: 0, LOC: 0 });

/**
 * Matriz de confusión del modelo solo (sin reglas ni lista) frente al gold: para cada mención positiva, la etiqueta del tramo del
 * modelo que más caracteres comparte con ella; y los tramos del modelo que no corresponden a ninguna mención positiva.
 */
export function matrizConfusion(entradas: readonly EntradaDocumento[]): MatrizConfusion {
  const menciones: MatrizConfusion['menciones'] = {};
  const sinMencion = cero3();
  const enNegativos = cero3();
  const inter = (a: { start: number; end: number }, b: { start: number; end: number }): number => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  for (const e of entradas) {
    const positivas = e.gold.anotaciones.filter((g) => esPositiva(g));
    const negativas = e.gold.anotaciones.filter((g) => g.es_negativo_esperado);
    for (const g of positivas) {
      const grupo = grupoDeTipo(g.tipo);
      const fila = (menciones[grupo] ??= { PER: 0, ORG: 0, LOC: 0, ninguna: 0 });
      const clave = claveParte(g.parte);
      let mejor: { et: EtiquetaModelo3; n: number } | null = null;
      for (const d of e.detecciones) {
        if (d.parte !== clave) continue;
        const n = inter(d, g);
        if (n > 0 && (mejor === null || n > mejor.n)) mejor = { et: ETIQUETA_DE_TIPO[d.tipo] as EtiquetaModelo3, n };
      }
      fila[mejor === null ? 'ninguna' : mejor.et]++;
    }
    for (const d of e.detecciones) {
      const et = ETIQUETA_DE_TIPO[d.tipo] as EtiquetaModelo3;
      if (positivas.some((g) => claveParte(g.parte) === d.parte && inter(d, g) > 0)) continue;
      if (negativas.some((g) => claveParte(g.parte) === d.parte && inter(d, g) > 0)) enNegativos[et]++;
      else sinMencion[et]++;
    }
  }
  return { menciones, sinMencion, enNegativos };
}

export interface FilaCierre {
  fila: 'PERSONA_FUERA' | 'ORG_FUERA';
  vista: Vista;
  mencion: { valor: number; umbral: number; n: number; cubiertas: number; omisionesPermitidas: number; omisiones: number; cumple: boolean };
  entidad: { valor: number; umbral: number; n: number; cumple: boolean };
  cumple: boolean;
  /** Ids de anotación sin cobertura (nunca valores). */
  idsNoCubiertas: string[];
}

/** Filas por vista de 10.4.1 (personas y organizaciones fuera de la lista) a partir de las filas del producto en esa vista. */
export function filasDeCierre(vista: Vista, filas: readonly MetricsRow[]): FilaCierre[] {
  const out: FilaCierre[] = [];
  for (const nombre of ['PERSONA_FUERA', 'ORG_FUERA'] as const) {
    const f = filas.find((x) => x.grupo === nombre);
    if (f === undefined) continue;
    const [um, ue] = UMBRALES_POR_VISTA[nombre];
    const e = 1e-9;
    const cm = f.n === 0 || f.exhaustividadMencion + e >= um;
    const ce = f.entidades === 0 || f.exhaustividadEntidadEstricta + e >= ue;
    out.push({
      fila: nombre, vista,
      mencion: { valor: f.exhaustividadMencion, umbral: um, n: f.n, cubiertas: f.cubiertas, omisionesPermitidas: omisionesPermitidas(um, f.n), omisiones: f.n - f.cubiertas, cumple: cm },
      entidad: { valor: f.exhaustividadEntidadEstricta, umbral: ue, n: f.entidades, cumple: ce },
      cumple: cm && ce,
      idsNoCubiertas: f.idsNoCubiertas ?? [],
    });
  }
  return out;
}

export interface Sobreajuste { vista: Vista; fila: string; desarrollo: number; reserva: number; diferencia: number; nDesarrollo: number; nReserva: number }
/** 10.4.1: si en algún grupo la exhaustividad de la reserva queda más de 0,03 bajo la de desarrollo, se registra «posible sobreajuste». */
export function posibleSobreajuste(vista: Vista, p: FilasPorConjunto): Sobreajuste[] {
  const out: Sobreajuste[] = [];
  for (const d of p.desarrollo) {
    const r = p.reserva.find((x) => x.grupo === d.grupo);
    if (r === undefined || d.n === 0 || r.n === 0) continue;
    const dif = d.exhaustividadMencion - r.exhaustividadMencion;
    if (dif > 0.03 + 1e-9) {
      out.push({ vista, fila: d.grupo, desarrollo: d.exhaustividadMencion, reserva: r.exhaustividadMencion, diferencia: dif, nDesarrollo: d.n, nReserva: r.n });
    }
  }
  return out;
}

export interface EvaluacionVista {
  producto: FilasPorConjunto;
  soloModelo: FilasPorConjunto;
  matriz: MatrizConfusion;
  /** Filas por vista de 10.4.1 con el producto completo (reglas + lista + modelo): las que cuentan para el cierre. */
  cierre: FilaCierre[];
  /** Las mismas filas medidas con el modelo solo: separan lo que rinde el modelo de lo que pierde la fusión con las reglas y la lista. */
  cierreSoloModelo: FilaCierre[];
  sobreajuste: Sobreajuste[];
}
export interface EvaluacionModelo {
  formato: 'sig-low/evaluacion-modelo';
  v: 1;
  /** Modelo evaluado (PF-4b lo agrega; el archivo de x-large de PF-4a no lo trae y es x-large). */
  modelo?: Modelo;
  fecha: string;
  corpus: { documentos: number; desarrollo: number; reserva: number; origen: string };
  umbrales: { nerMinScore: number; nerHighThreshold: number; fuente: string };
  advertencia: string;
  vistas: Partial<Record<Vista, EvaluacionVista>>;
  /** Exhaustividad de mención por fila y vista (producto, todo el corpus) y su diferencia con la vista natural. */
  contraste: Array<{ fila: string; natural: number | null; mayusculas: number | null; minusculas: number | null; dMayusculas: number | null; dMinusculas: number | null }>;
  cierra: boolean;
}

export const ADVERTENCIA_MUESTRA =
  'Cada cifra lleva su n. El sondeo previo del modelo (0,97 natural, 0,91 en MAYÚSCULAS, 0,93 en minúsculas) fue una muestra pequeña '
  + '(25 fragmentos, 96 entidades); aquí n son menciones del corpus ficticio, que es sintético y no son escritos reales.';

/** Arma la evaluación de una vista a partir de las entradas del producto (reglas + lista + modelo) y del modelo solo. */
export function evaluarVista(vista: Vista, producto: readonly EntradaDocumento[], soloModelo: readonly EntradaDocumento[]): EvaluacionVista {
  const p = filasPorConjunto(producto);
  return { producto: p, soloModelo: filasPorConjunto(soloModelo), matriz: matrizConfusion(soloModelo), cierre: filasDeCierre(vista, p.todo), cierreSoloModelo: filasDeCierre(vista, filasPorConjunto(soloModelo).todo), sobreajuste: posibleSobreajuste(vista, p) };
}

export function armarEvaluacion(
  vistas: Partial<Record<Vista, EvaluacionVista>>, corpus: EvaluacionModelo['corpus'], umbrales: EvaluacionModelo['umbrales'], fecha: string,
  modelo?: Modelo,
): EvaluacionModelo {
  const valor = (v: Vista, fila: string): number | null => vistas[v]?.producto.todo.find((f) => f.grupo === fila)?.exhaustividadMencion ?? null;
  const dif = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a - b);
  const contraste = GRUPOS_T_AB_01.map((g) => {
    const n = valor('natural', g.grupo);
    const m = valor('mayusculas', g.grupo);
    const l = valor('minusculas', g.grupo);
    return { fila: g.grupo, natural: n, mayusculas: m, minusculas: l, dMayusculas: dif(m, n), dMinusculas: dif(l, n) };
  });
  const cierra = VISTAS.every((v) => (vistas[v]?.cierre.length ?? 0) === 2 && vistas[v]?.cierre.every((c) => c.cumple) === true);
  return {
    formato: 'sig-low/evaluacion-modelo', v: 1, ...(modelo === undefined ? {} : { modelo }), fecha, corpus, umbrales, advertencia: ADVERTENCIA_MUESTRA, vistas, contraste, cierra,
  };
}

const tres = (x: number): string => x.toFixed(3);
/** Tabla de texto de una vista (sin ningún valor del gold: solo contadores). */
export function tablaVista(vista: Vista, e: EvaluacionVista): string {
  const lineas = [`== ${vista} · producto (reglas + lista + modelo) · todo el corpus ==`, 'fila              n   cub  R-mención  R-entidad  P      F2     cumple'];
  const fila = (f: MetricsRow, c: string): string =>
    `${f.grupo.padEnd(14)} ${String(f.n).padStart(5)} ${String(f.cubiertas).padStart(5)}  ${tres(f.exhaustividadMencion)}      ${tres(f.exhaustividadEntidadEstricta)}      ${tres(f.precision)}  ${tres(f.f2)}  ${c}`;
  for (const f of e.producto.todo) {
    const c = e.cierre.find((x) => x.fila === f.grupo);
    lineas.push(fila(f, c === undefined ? '-' : c.cumple ? 'sí' : 'NO'));
  }
  lineas.push('-- solo el modelo (sin reglas ni lista) --');
  for (const f of e.soloModelo.todo) lineas.push(fila(f, ''));
  return lineas.join('\n');
}

// ===================================================================================================================
// T-AB-04: el respaldo (x-base) frente al principal (x-large), por vista (funciones puras)
// ===================================================================================================================

export type EtiquetaT04 = 'PER' | 'ORG' | 'LOC';
/** Filas de T-AB-04: PER, ORG y LOC (todas las menciones) y, además, PER y ORG fuera de la lista (las filas de 10.4.1). */
export const FILAS_T_AB_04: ReadonlyArray<{ etiqueta: EtiquetaT04; fila: string; ambito: 'todas' | 'fuera' }> = [
  { etiqueta: 'PER', fila: 'PERSONA_TODAS', ambito: 'todas' },
  { etiqueta: 'ORG', fila: 'ORG_TODAS', ambito: 'todas' },
  { etiqueta: 'LOC', fila: 'LOC_TODAS', ambito: 'todas' },
  { etiqueta: 'PER', fila: 'PERSONA_FUERA', ambito: 'fuera' },
  { etiqueta: 'ORG', fila: 'ORG_FUERA', ambito: 'fuera' },
];

/** `modelo`: el modelo solo (sin reglas ni lista); `producto`: reglas + lista + modelo con el umbral de PF-3. */
export type MedidaT04 = 'modelo' | 'producto';
export interface FilaRespaldo {
  vista: Vista;
  etiqueta: EtiquetaT04;
  fila: string;
  ambito: 'todas' | 'fuera';
  medida: MedidaT04;
  /** Menciones del gold en la fila (el mismo n para los dos modelos). */
  n: number;
  principal: number;
  respaldo: number;
  /** respaldo - principal, en exhaustividad de mención. */
  diferencia: number;
}
export interface CaidaPorVista {
  modelo: Modelo;
  etiqueta: EtiquetaT04;
  n: number;
  natural: number;
  mayusculas: number;
  minusculas: number;
  dMayusculas: number;
  dMinusculas: number;
}
export interface ComparacionRespaldo {
  formato: 'sig-low/comparacion-respaldo';
  v: 1;
  fecha: string;
  principal: 'x-large';
  respaldo: 'x-base';
  /** T-AB-04 es informativa: el respaldo es un camino en ejecución y no un criterio de cierre (10.4.2). */
  informativa: true;
  advertencia: string;
  filas: FilaRespaldo[];
  /** Exhaustividad del modelo solo (todas las menciones) en cada vista y su caída frente a la natural, por modelo. */
  caidaPorVista: CaidaPorVista[];
}

export const ADVERTENCIA_RESPALDO =
  'Informativa (T-AB-04): el respaldo es un camino en ejecución, no un criterio de cierre. Cada cifra lleva su n (menciones del corpus ficticio, '
  + 'sintético): con n pequeño una diferencia de uno o dos puntos no distingue a un modelo del otro.';

/**
 * Compara dos evaluaciones del mismo corpus (el principal y el respaldo): exhaustividad por mención de PER, ORG y LOC en cada vista, con el
 * modelo solo y con el producto, y la diferencia respaldo - principal. Lanza `N_DISTINTO` si las dos no miden las mismas menciones.
 */
export function compararRespaldo(principal: EvaluacionModelo, respaldo: EvaluacionModelo, fecha: string): ComparacionRespaldo {
  const filas: FilaRespaldo[] = [];
  const caidaPorVista: CaidaPorVista[] = [];
  const buscar = (e: EvaluacionVista, medida: MedidaT04, fila: string): MetricsRow | undefined =>
    (medida === 'modelo' ? e.soloModelo : e.producto).todo.find((f) => f.grupo === fila);
  for (const vista of VISTAS) {
    const p = principal.vistas[vista];
    const r = respaldo.vistas[vista];
    if (p === undefined || r === undefined) continue;
    for (const def of FILAS_T_AB_04) {
      for (const medida of ['modelo', 'producto'] as const) {
        const fp = buscar(p, medida, def.fila);
        const fr = buscar(r, medida, def.fila);
        if (fp === undefined || fr === undefined) continue;
        if (fp.n !== fr.n) throw new Error('N_DISTINTO');
        filas.push({
          vista, etiqueta: def.etiqueta, fila: def.fila, ambito: def.ambito, medida, n: fp.n,
          principal: fp.exhaustividadMencion, respaldo: fr.exhaustividadMencion, diferencia: fr.exhaustividadMencion - fp.exhaustividadMencion,
        });
      }
    }
  }
  const valor = (e: EvaluacionModelo, v: Vista, fila: string): MetricsRow | undefined => {
    const x = e.vistas[v];
    return x === undefined ? undefined : buscar(x, 'modelo', fila);
  };
  for (const [modelo, ev] of [['x-large', principal], ['x-base', respaldo]] as const) {
    for (const def of FILAS_T_AB_04.filter((d) => d.ambito === 'todas')) {
      const n = valor(ev, 'natural', def.fila);
      const m = valor(ev, 'mayusculas', def.fila);
      const l = valor(ev, 'minusculas', def.fila);
      if (n === undefined || m === undefined || l === undefined) continue;
      caidaPorVista.push({
        modelo, etiqueta: def.etiqueta, n: n.n, natural: n.exhaustividadMencion, mayusculas: m.exhaustividadMencion, minusculas: l.exhaustividadMencion,
        dMayusculas: m.exhaustividadMencion - n.exhaustividadMencion, dMinusculas: l.exhaustividadMencion - n.exhaustividadMencion,
      });
    }
  }
  return { formato: 'sig-low/comparacion-respaldo', v: 1, fecha, principal: 'x-large', respaldo: 'x-base', informativa: true, advertencia: ADVERTENCIA_RESPALDO, filas, caidaPorVista };
}

const conSigno = (x: number): string => `${x >= 0 ? '+' : '-'}${Math.abs(x).toFixed(3)}`;
/** Tabla de texto de T-AB-04 (solo contadores y proporciones; ningún valor del gold). */
export function tablaRespaldo(c: ComparacionRespaldo): string {
  const lineas: string[] = [];
  for (const medida of ['modelo', 'producto'] as const) {
    for (const vista of VISTAS) {
      const fs = c.filas.filter((f) => f.vista === vista && f.medida === medida);
      if (fs.length === 0) continue;
      lineas.push(`== T-AB-04 · ${vista} · ${medida === 'modelo' ? 'solo el modelo' : 'producto (reglas + lista + modelo)'} · exhaustividad por mención ==`);
      lineas.push('etiqueta  fila             n    x-large  x-base   respaldo - principal');
      for (const f of fs) lineas.push(`${f.etiqueta.padEnd(8)}  ${f.fila.padEnd(14)} ${String(f.n).padStart(4)}   ${f.principal.toFixed(3)}    ${f.respaldo.toFixed(3)}    ${conSigno(f.diferencia)}`);
    }
  }
  lineas.push('== caída frente a la vista natural (solo el modelo, todas las menciones) ==');
  lineas.push('modelo   etiqueta   n    natural  MAYÚSC.  minúsc.  d MAYÚSC.  d minúsc.');
  for (const k of c.caidaPorVista) {
    lineas.push(`${k.modelo.padEnd(8)} ${k.etiqueta.padEnd(8)} ${String(k.n).padStart(4)}   ${k.natural.toFixed(3)}    ${k.mayusculas.toFixed(3)}    ${k.minusculas.toFixed(3)}    ${conSigno(k.dMayusculas)}     ${conSigno(k.dMinusculas)}`);
  }
  return lineas.join('\n');
}

// ===================================================================================================================
// Orden evaluar (T-AB-01)
// ===================================================================================================================

function commitDe(carpeta: string): string {
  const r = spawnSync('git', ['-C', carpeta, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'desconocido';
}

/**
 * Evalúa una vista desde su caché: el producto (reglas + lista + modelo, el mismo motor de producción que `npm run medir`, con el
 * umbral y la banda de PF-3) y el modelo solo. `carpetaCorpus` es la carpeta `corpus/` con `gold/`. Valida antes la caché con el
 * lector de PG-3b: si `npm run medir` no la aceptaría, aquí tampoco.
 */
export async function evaluarVistaDesdeCache(
  vista: Vista, cache: CacheVista, carpetaCorpus: string, umbrales: { nerMinScore: number; nerHighThreshold: number },
): Promise<{ evaluacion: EvaluacionVista; conjuntos: string[] }> {
  // Los módulos del motor y del corpus se importan solo aquí: las funciones puras de arriba no los necesitan.
  const { cargarCorpus } = await import('../tests/medicion/lib/corpus.ts');
  const { validarCache } = await import('../tests/medicion/lib/cache.ts');
  const { crearMotor, entradaDeEstado, procesarDocumento } = await import('../tests/medicion/lib/motor.ts');
  const corpus = cargarCorpus('todo', carpetaCorpus);
  validarCache(cache, corpus, vista);
  const motor = crearMotor();
  const opciones = { referenceDate: '2026-10-30', rulesVersion: '1.0.0', nerHighThreshold: umbrales.nerHighThreshold, nerMinScore: umbrales.nerMinScore };
  const producto: EntradaDocumento[] = [];
  const soloModelo: EntradaDocumento[] = [];
  for (const dc of corpus) {
    const dcache = cache.documentos[dc.docId] as DocumentoCache;
    const p = await procesarDocumento(motor, dc, dcache, opciones);
    producto.push(entradaDeEstado(p));
    soloModelo.push({ gold: dc.gold, detecciones: deteccionesDe(dcache, dc.docId, umbrales.nerMinScore), banderas: [], sugerencias: [], paginas: dc.paginas });
  }
  return { evaluacion: evaluarVista(vista, producto, soloModelo), conjuntos: corpus.map((d) => d.gold.conjunto) };
}

/** Calcula y guarda T-AB-01. Importa el motor (imports sin extensión), así que solo corre bajo Vitest: la orden `evaluar` lo lanza ahí. */
export async function ejecutarEvaluacion(raiz: string, a: Map<string, string>): Promise<void> {
  const modelo = parseModelo(a);
  const salida = resolve(raiz, arg(a, 'salida', archivoVistasDe(modelo)));
  const raizCorpus = resolve(raiz, arg(a, 'corpus', '.'));
  const calibracion = JSON.parse(readFileSync(resolve(raiz, 'metricas/calibracion-umbral.json'), 'utf8')) as { nerMinScore: number; nerHighThreshold: number };
  const umbrales = { nerMinScore: calibracion.nerMinScore, nerHighThreshold: calibracion.nerHighThreshold, fuente: 'metricas/calibracion-umbral.json (PF-3)' };
  const archivo = leerArchivoVistas(salida, modelo);
  const vistas: Partial<Record<Vista, EvaluacionVista>> = {};
  let conjuntos: string[] = [];
  for (const vista of VISTAS) {
    const cache = archivo.vistas[vista];
    if (cache === undefined) { log(`vista ${vista}: sin caché, se omite`); continue; }
    const r = await evaluarVistaDesdeCache(vista, cache, join(raizCorpus, 'corpus'), umbrales);
    vistas[vista] = r.evaluacion;
    conjuntos = r.conjuntos;
    process.stdout.write(`${tablaVista(vista, r.evaluacion)}
`);
  }
  const evaluacion = armarEvaluacion(vistas, {
    documentos: conjuntos.length, desarrollo: conjuntos.filter((c) => c === 'desarrollo').length, reserva: conjuntos.filter((c) => c === 'reserva').length,
    origen: `corpus/gold del commit ${commitDe(raizCorpus)}`,
  }, umbrales, ahora(), modelo);
  archivo.evaluacion = evaluacion;
  if (modelo === 'x-base') {
    // T-AB-04: el principal es el archivo de PF-4a, ya evaluado con el mismo corpus, el mismo umbral y el mismo motor de producción.
    const rutaPrincipal = resolve(raiz, arg(a, 'principal', ARCHIVO_VISTAS));
    const principal = leerArchivoVistas(rutaPrincipal, 'x-large').evaluacion as EvaluacionModelo | undefined;
    if (principal === undefined) throw new Error('falta la evaluación del principal (node scripts/evaluar-modelo.ts evaluar)');
    if (principal.umbrales.nerMinScore !== umbrales.nerMinScore || principal.umbrales.nerHighThreshold !== umbrales.nerHighThreshold) throw new Error('UMBRALES_DISTINTOS');
    const comparacion = compararRespaldo(principal, evaluacion, ahora());
    archivo.comparacion = comparacion;
    process.stdout.write(`${tablaRespaldo(comparacion)}\n`);
  }
  escribirJson(salida, archivo);
  log(`${modelo === 'x-base' ? 'T-AB-01 y T-AB-04' : 'T-AB-01'} escrito en ${salida}: ${evaluacion.cierra ? 'las seis filas por vista cumplen' : 'alguna fila por vista no cumple (ver evaluacion.vistas.*.cierre)'}`);
}

/** La orden `evaluar`: el motor de producción se importa sin extensiones, algo que Node no resuelve; se corre bajo Vitest como `npm run medir`. */
function ordenEvaluar(raiz: string, a: Map<string, string>): number {
  const env = { ...process.env, SIGLOW_EVALUAR: '1', SIGLOW_EVALUAR_ARGS: JSON.stringify([...a.entries()]) };
  const r = spawnSync(process.execPath, [join(raiz, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', 'tests/medicion/vitest.config.ts',
    'tests/medicion/evaluacion-modelo.test.ts', '-t', 'T-AB-01 evaluar'], { cwd: raiz, env, stdio: 'inherit' });
  return r.status ?? 1;
}

// ===================================================================================================================
// Línea de órdenes
// ===================================================================================================================

export async function main(argv: readonly string[]): Promise<number> {
  const orden = argv[0];
  const a = argumentos(argv.slice(1));
  const raiz = process.cwd();
  switch (orden) {
    case 'pasada': await ordenPasada(raiz, a); return 0;
    case 'evaluar': return ordenEvaluar(raiz, a);
    case 'verificar': await ordenVerificar(raiz, a); return typeof process.exitCode === 'number' ? process.exitCode : 0;
    default:
      process.stderr.write('Uso: node scripts/evaluar-modelo.ts <pasada|verificar|evaluar> [--opcion=valor]\n');
      return 2;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e: unknown) => {
    process.stderr.write(`evaluar-modelo: ${e instanceof Error ? e.message : 'error'}\n`);
    process.exitCode = 1;
  });
}
