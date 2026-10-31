// Calibración y mediciones del modelo (PF-3; plan 9.3, 9.5, 7.10.9, 10.3.5 y 10.8.5). Node 26 con eliminación de tipos:
//   node scripts/calibrar-modelo.ts <orden> [--opcion=valor ...]
//
//   pasada     Pasada del modelo en la vista natural sobre el corpus y caché de salidas por ventana (puntaje >= 0,1):
//              metricas/modelo-<id>-natural.json. Candado del modelo.
//   etiquetas  Prueba de etiquetas (T-AB-03 a): las tres de `person`, `organization` y `location` frente a las traducidas y a
//              las nueve del informe del modelo. Candado del modelo.
//   latencia   Mediana y p90 por ventana, tiempo de un escrito de 10 páginas y memoria pico con 1, 4 y 8 hilos (T-AB-02, T-ME-04
//              preliminar), en Chromium o en Edge. Candado del modelo.
//   edge       T-ED-01 y T-ED-02: carga del modelo y dos documentos con el JIT desactivado, y calibración de PBKDF2.
//   calibrar   Sin modelo: barre `nerMinScore` y fija `nerHighThreshold` con las salidas guardadas (T-AB-03). Escribe
//              metricas/calibracion-umbral.json. Su caché por defecto (la natural de PF-3) quedó como histórico en P0-4
//              (metricas/historico/pf3-x-large-natural.json, texto anterior a PG-1a-r1 y PG-2-r1): pásela con --cache=.
//   confirmar  Sin modelo (P0-4): confirma el umbral y la banda de calibracion-umbral.json con la vista natural de
//              metricas/modelo-x-large-vistas.json, en el desarrollo con el texto final y en la reserva, aparte. Escribe
//              metricas/calibracion-reserva.json. La reserva nunca cambia el umbral: solo lo confirma o no.
//
// Las funciones de la calibración son puras y están exportadas (las usa tests/medicion/evaluacion-modelo.test.ts). La parte que
// maneja el navegador (Playwright y Vite) se importa solo al ejecutar la orden. El corpus es ficticio (10.1.5): lo único que se
// guarda de él son posiciones, etiquetas y puntajes por ventana.
import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  cpSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { calcularFila, claveParte, evaluarDocumento, esVerdadera, esPositiva, razon } from './metrics.ts';
import type { DeteccionMedida, EntradaDocumento, GoldDocument, GrupoDef, MetricsRow } from './metrics.ts';
import type { DataType, ModelManifest } from '../src/core/types.ts';

// ===================================================================================================================
// Tipos de la caché de salidas (9.5; 10.3.3)
// ===================================================================================================================

/** Formato fijado por PG-3b (tests/medicion/lib/cache.ts): metricas/modelo-<x-large|x-base>-<vista>.json. Posiciones de la parte canónica. */
export type EtiquetaModelo = 'PER' | 'ORG' | 'LOC';
export interface TramoCache { start: number; end: number; label: EtiquetaModelo; score: number }
export interface VentanaCache { windowIndex: number; windowTotal: number; ms?: number; spans: TramoCache[] }
export interface ParteCache { sha256: string; ventanas: VentanaCache[] }
export interface DocumentoCache { partes: Record<string, ParteCache> }
export interface CacheModelo {
  formato: 'sig-low/cache-modelo'; v: 1;
  modelo: 'x-large' | 'x-base';
  vista: 'natural' | 'mayusculas' | 'minusculas';
  piso: number;
  huella: { texto: string; vista: string; onnx: string; codigo: string };
  carga?: unknown;
  documentos: Record<string, DocumentoCache>;
  /** Extras de PF-3 (la lectura de PG-3b los ignora): variante de etiquetas, opciones y datos de la corrida. */
  etiquetas?: 'estandar' | 'traducidas' | 'nueve';
  opciones?: { windowTokens: number; overlapWords: number; maxSpanWords: 12 };
  corrida?: { hilos: number; navegador: string; nucleosLogicos: number; fecha: string; equipo: string; conjunto: string };
  medicion?: unknown;
}

export const ETIQUETA_TIPO: Record<EtiquetaModelo, DataType> = { PER: 'PERSONA', ORG: 'ENTIDAD', LOC: 'LUGAR' };
const ORGS: readonly DataType[] = ['EMPRESA', 'EPS', 'IPS', 'ENTIDAD', 'PROVEEDOR'];
const UBICACIONES: readonly DataType[] = ['MUNICIPIO', 'DEPARTAMENTO', 'LUGAR'];

// ===================================================================================================================
// Calibración sin modelo (T-AB-03): funciones puras sobre la caché y el gold
// ===================================================================================================================

/** Detecciones de un documento a un piso dado; el recorte por puntaje es exacto porque la selección voraz es por puntaje descendente. */
export function deteccionesDe(doc: DocumentoCache, docId: string, piso: number): DeteccionMedida[] {
  const out: DeteccionMedida[] = [];
  for (const [parte, pc] of Object.entries(doc.partes)) {
    for (const v of pc.ventanas) {
      for (const { start, end, label, score } of v.spans) {
        if (score < piso - 1e-9) continue;
        out.push({ id: `${docId}-${parte}-${v.windowIndex}-${out.length}`, parte, start, end, tipo: ETIQUETA_TIPO[label] as DeteccionMedida['tipo'], entidad: '' });
      }
    }
  }
  return out;
}

/** Puntaje de cada detección (en el mismo orden que `deteccionesDe`). */
export function puntajesDe(doc: DocumentoCache, piso: number): number[] {
  const out: number[] = [];
  for (const pc of Object.values(doc.partes)) for (const v of pc.ventanas) for (const s of v.spans) if (s.score >= piso - 1e-9) out.push(s.score);
  return out;
}

const GRUPOS_MODELO: GrupoDef[] = [
  { grupo: 'PER_ORG', tipos: ['PERSONA', ...ORGS] },
  { grupo: 'PER', tipos: ['PERSONA'] },
  { grupo: 'ORG', tipos: ORGS },
  { grupo: 'PER_ORG_FUERA', tipos: ['PERSONA', ...ORGS], donde: (g) => !g.enLista },
  { grupo: 'LOC', tipos: UBICACIONES },
];

export interface FilaUmbral {
  umbral: number;
  detecciones: number; verdaderas: number; precisionGlobal: number;
  grupos: Record<string, Pick<MetricsRow, 'n' | 'cubiertas' | 'exhaustividadMencion' | 'detecciones' | 'verdaderas' | 'precision' | 'f2'>>;
}

export function evaluarUmbral(cache: CacheModelo, golds: Record<string, GoldDocument>, umbral: number, docs?: readonly string[]): FilaUmbral {
  const ids = (docs ?? Object.keys(cache.documentos)).filter((d) => golds[d] !== undefined && cache.documentos[d] !== undefined);
  const evals = ids.map((id) => {
    const entrada: EntradaDocumento = {
      gold: golds[id] as GoldDocument, detecciones: deteccionesDe(cache.documentos[id] as DocumentoCache, id, umbral),
      banderas: [], sugerencias: [], paginas: 1,
    };
    return evaluarDocumento(entrada);
  });
  const dets = evals.flatMap((e) => e.detecciones);
  const verdaderas = dets.filter((r) => r.verdadera).length;
  const grupos: FilaUmbral['grupos'] = {};
  for (const def of GRUPOS_MODELO) {
    const f = calcularFila(def, evals);
    grupos[def.grupo] = {
      n: f.n, cubiertas: f.cubiertas, exhaustividadMencion: f.exhaustividadMencion, detecciones: f.detecciones, verdaderas: f.verdaderas,
      precision: f.precision, f2: f.f2,
    };
  }
  return { umbral, detecciones: dets.length, verdaderas, precisionGlobal: razon(verdaderas, dets.length), grupos };
}

export interface Seleccion { umbral: number; cumplePrecision: boolean; f2: number; motivo: string }

/** Mayor F2 de PER y ORG con precisión global >= `minPrecision`; a igual F2, el umbral más bajo (la exhaustividad pesa más). */
export function elegirUmbral(filas: readonly FilaUmbral[], minPrecision = 0.7): Seleccion {
  const f2De = (f: FilaUmbral): number => (f.grupos['PER_ORG'] as FilaUmbral['grupos'][string]).f2;
  const validas = filas.filter((f) => f.precisionGlobal >= minPrecision);
  const orden = (a: FilaUmbral, b: FilaUmbral): number => f2De(b) - f2De(a) || a.umbral - b.umbral;
  if (validas.length > 0) {
    const m = [...validas].sort(orden)[0] as FilaUmbral;
    return { umbral: m.umbral, cumplePrecision: true, f2: f2De(m), motivo: `mayor F2 de PER y ORG entre los umbrales con precisión global >= ${minPrecision}` };
  }
  const m = [...filas].sort((a, b) => b.precisionGlobal - a.precisionGlobal || a.umbral - b.umbral)[0] as FilaUmbral;
  return { umbral: m.umbral, cumplePrecision: false, f2: f2De(m), motivo: `ningún umbral alcanza precisión global >= ${minPrecision}: se toma el de mayor precisión` };
}

export interface FilaAlto { umbral: number; tramos: number; verdaderas: number; precision: number }

/** Precisión de los tramos con puntaje >= cada candidato a `nerHighThreshold` (los marcados `media`), a partir del piso elegido. */
export function barridoAlto(cache: CacheModelo, golds: Record<string, GoldDocument>, piso: number, candidatos: readonly number[], docs?: readonly string[]): FilaAlto[] {
  const ids = (docs ?? Object.keys(cache.documentos)).filter((d) => golds[d] !== undefined && cache.documentos[d] !== undefined);
  const todos: Array<{ score: number; verdadera: boolean }> = [];
  for (const id of ids) {
    const doc = cache.documentos[id] as DocumentoCache;
    const positivas = (golds[id] as GoldDocument).anotaciones.filter(esPositiva);
    const porParte = new Map<string, Array<{ start: number; end: number }>>();
    for (const g of positivas) {
      const k = claveParte(g.parte);
      const l = porParte.get(k);
      if (l === undefined) porParte.set(k, [g]); else l.push(g);
    }
    for (const [parte, pc] of Object.entries(doc.partes)) {
      for (const v of pc.ventanas) for (const { start, end, score } of v.spans) {
        if (score < piso - 1e-9) continue;
        todos.push({ score, verdadera: esVerdadera({ start, end }, porParte.get(parte) ?? []) });
      }
    }
  }
  return candidatos.map((umbral) => {
    const t = todos.filter((x) => x.score >= umbral - 1e-9);
    const v = t.filter((x) => x.verdadera).length;
    return { umbral, tramos: t.length, verdaderas: v, precision: razon(v, t.length) };
  });
}

/** El menor valor con precisión >= `minPrecision` entre los tramos que quedarían `media`. `null` si ninguno la alcanza. */
export function elegirAlto(filas: readonly FilaAlto[], minPrecision = 0.9): FilaAlto | null {
  return [...filas].sort((a, b) => a.umbral - b.umbral).find((f) => f.tramos > 0 && f.precision >= minPrecision) ?? null;
}

// ===================================================================================================================
// Estadística de latencia (T-AB-02)
// ===================================================================================================================

/** Percentil por interpolación lineal (0 a 1) de una muestra. */
export function percentil(valores: readonly number[], q: number): number {
  if (valores.length === 0) return 0;
  const o = [...valores].sort((a, b) => a - b);
  const pos = (o.length - 1) * q;
  const i = Math.floor(pos);
  const resto = pos - i;
  const a = o[i] as number;
  const b = o[Math.min(i + 1, o.length - 1)] as number;
  return a + (b - a) * resto;
}
export const mediana = (v: readonly number[]): number => percentil(v, 0.5);

// ===================================================================================================================
// Utilidades de archivos
// ===================================================================================================================

const sha256Texto = (t: string): string => createHash('sha256').update(t).digest('hex');
const sha256Archivo = (ruta: string): Promise<string> =>
  new Promise((ok, mal) => {
    const h = createHash('sha256');
    createReadStream(ruta).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', mal);
  });

/** Huella del motor: sha256 del código de `src/core/ner/gliner/` y de `engine.ts`, con saltos de línea normalizados. */
export function huellaMotor(raiz: string): string {
  const h = createHash('sha256');
  const dir = join(raiz, 'src/core/ner/gliner');
  const archivos = [...readdirSync(dir).filter((f) => f.endsWith('.ts')).sort().map((f) => join(dir, f)), join(raiz, 'src/core/ner/engine.ts')];
  for (const a of archivos) h.update(readFileSync(a, 'utf8').replace(/\r\n/g, '\n'));
  return h.digest('hex');
}

export interface ParteTexto { clave: string; texto: string; kind: string; index: number }

interface TextoGold { docId: string; partes: Array<{ kind: string; index: number; page?: number; texto: string }> }

export function cargarCorpus(raiz: string): { ids: string[]; textos: Record<string, ParteTexto[]>; golds: Record<string, GoldDocument> } {
  const dir = join(raiz, 'corpus/gold');
  const ids = readdirSync(dir).filter((f) => /^C\d+\.texto\.json$/.test(f)).map((f) => f.slice(0, 3)).sort();
  const textos: Record<string, ParteTexto[]> = {};
  const golds: Record<string, GoldDocument> = {};
  for (const id of ids) {
    const t = JSON.parse(readFileSync(join(dir, `${id}.texto.json`), 'utf8')) as TextoGold;
    textos[id] = t.partes.filter((p) => p.texto.trim() !== '').map((p) => ({
      clave: claveParte({ kind: p.kind as never, index: p.index, ...(p.page === undefined ? {} : { page: p.page }) }), texto: p.texto, kind: p.kind, index: p.index,
    }));
    golds[id] = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')) as GoldDocument;
  }
  return { ids: ids.filter((id) => (textos[id] as ParteTexto[]).length > 0), textos, golds };
}

const arg = (a: Map<string, string>, k: string, d: string): string => a.get(k) ?? d;
function argumentos(argv: readonly string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const x of argv) {
    const r = /^--([a-z0-9-]+)(?:=(.*))?$/u.exec(x);
    if (r !== null) m.set(r[1] as string, r[2] ?? '');
  }
  return m;
}
const ahora = (): string => new Date().toISOString().slice(0, 19).replace('T', ' ');
const log = (t: string): void => { process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${t}\n`); };

function escribirJson(ruta: string, datos: unknown): void {
  mkdirSync(join(ruta, '..'), { recursive: true });
  const tmp = `${ruta}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(datos)}\n`);
  renameSync(tmp, ruta);
}

// ===================================================================================================================
// Candado del modelo (una sola pasada del modelo grande a la vez en el equipo)
// ===================================================================================================================

async function tomarCandado(raiz: string): Promise<() => void> {
  const dir = resolve(raiz, process.env['SIGLOW_CANDADO_MODELO'] ?? '../h0/candado-modelo');
  let avisado = false;
  for (;;) {
    try { mkdirSync(dir); break; } catch {
      if (!avisado) { log(`candado del modelo ocupado (${dir}): espero`); avisado = true; }
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
  try { writeFileSync(join(dir, 'quien.txt'), `PF-3 (A7), pid ${process.pid}, desde ${ahora()}\n`); } catch { /* el candado es el directorio */ }
  let liberado = false;
  const liberar = (): void => { if (!liberado) { liberado = true; try { rmSync(dir, { recursive: true, force: true }); } catch { /* ya no existe */ } } };
  process.on('exit', liberar);
  process.on('SIGINT', () => { liberar(); process.exit(130); });
  log('candado del modelo tomado');
  return liberar;
}

// ===================================================================================================================
// Arnés: build de Vite, servidor y navegador
// ===================================================================================================================

type Modelo = 'x-large' | 'x-base';
const ID_MODELO: Record<Modelo, ModelManifest['id']> = { 'x-large': 'gliner-x-large', 'x-base': 'gliner-x-base' };
const BASE_MODELO: Record<Modelo, ModelManifest['base']> = { 'x-large': 'google/mt5-large', 'x-base': 'google/mt5-base' };

async function manifiestoDe(carpeta: string, modelo: Modelo, umbral: number, solape: number): Promise<ModelManifest> {
  const info = async (ruta: string): Promise<{ ruta: string; tamano: number; sha256: string }> =>
    ({ ruta, tamano: statSync(join(carpeta, ruta)).size, sha256: await sha256Archivo(join(carpeta, ruta)) });
  const onnx = await info('onnx/model_quantized.onnx');
  return {
    formato: 'sig-low/modelo', v: 1, id: ID_MODELO[modelo], origen: 'prueba', familia: 'gliner', base: BASE_MODELO[modelo], cuantizacion: 'q8',
    etiquetas: ['person', 'organization', 'location'], umbral, ventanaTokens: 512, solapePalabras: solape, maxTramoPalabras: 12,
    tokenizador: { prefijo: 0, sufijo: 1, cls: false },
    archivo: 'onnx/model_quantized.onnx', tamano: onnx.tamano, sha256: onnx.sha256, trozos: [],
    auxiliares: [await info('tokenizer.json'), await info('tokenizer_config.json'), await info('gliner_config.json')] as never,
    licencia: 'Apache-2.0', memoria: { wasmMb: 0, jsMb: 0, minimoDispositivoGb: 8 },
  };
}

interface Arnes {
  origen: string;
  manifiesto: ModelManifest;
  cerrarServidor(): void;
}

async function prepararArnes(raiz: string, modelo: Modelo, solape: number): Promise<Arnes> {
  const { build, defaultClientConditions } = await import('vite');
  const modelos = resolve(raiz, process.env['SIGLOW_MODELOS'] ?? '../h0/modelos');
  const origenModelo = join(modelos, `gliner-${modelo}`);
  if (!existsSync(join(origenModelo, 'onnx', 'model_quantized.onnx'))) throw new Error(`faltan los modelos en ${modelos}`);
  const carpeta = join(raiz, 'test-results', 'calibrar-arnes');
  mkdirSync(carpeta, { recursive: true });
  log('compilo el arnés');
  await build({
    configFile: false, root: join(raiz, 'tests/e2e/harness'), publicDir: join(raiz, 'public'), logLevel: 'silent', cacheDir: join(raiz, '.vite-cache'),
    resolve: { conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions] },
    define: { __SIGLOW_VERSION__: '"prueba"', __SIGLOW_MEDICION__: 'false' },
    build: {
      outDir: carpeta, emptyOutDir: true, target: 'es2024', assetsInlineLimit: 0, sourcemap: false, modulePreload: { polyfill: false }, reportCompressedSize: false,
      rolldownOptions: { input: { calibrar: join(raiz, 'tests/e2e/harness/calibrar.html') }, output: { minify: { compress: { dropConsole: true, dropDebugger: true } } } },
    },
    worker: { format: 'es', rolldownOptions: { output: { minify: { compress: { dropConsole: true, dropDebugger: true } } } } },
  });
  const destino = join(carpeta, 'models', `gliner-${modelo}`);
  mkdirSync(join(destino, 'onnx'), { recursive: true });
  for (const a of ['tokenizer.json', 'tokenizer_config.json', 'gliner_config.json']) cpSync(join(origenModelo, a), join(destino, a));
  const onnxDestino = join(destino, 'onnx', 'model_quantized.onnx');
  if (!existsSync(onnxDestino) || statSync(onnxDestino).size !== statSync(join(origenModelo, 'onnx', 'model_quantized.onnx')).size) {
    log('copio el modelo al directorio de pruebas (fuera de git)');
    cpSync(join(origenModelo, 'onnx', 'model_quantized.onnx'), onnxDestino);
  }
  const manifiesto = await manifiestoDe(destino, modelo, 0.3, solape);
  const puerto = Number(process.env['PORT'] ?? 4173) + 7;
  const servidor: ChildProcess = spawn(process.execPath, ['tests/e2e/server.mjs', '--dir', carpeta, '--port', String(puerto)], { stdio: 'ignore', cwd: raiz });
  const origen = `http://127.0.0.1:${puerto}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${origen}/`)).status) break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  return { origen, manifiesto, cerrarServidor: () => { servidor.kill(); } };
}

interface Sesion {
  page: import('@playwright/test').Page;
  cerrar(): Promise<void>;
  marca: string;
  navegador: string;
}

async function abrirNavegador(arnes: Arnes, canal: string, extra: string[]): Promise<Sesion> {
  const { chromium } = await import('@playwright/test');
  const marca = `siglow-marca-${process.pid}-${Date.now()}`;
  const navegador = await chromium.launch({ headless: true, ...(canal === 'chromium' ? {} : { channel: canal }), args: [`--siglow-marca=${marca}`, ...extra] });
  const page = await navegador.newPage();
  page.on('pageerror', () => undefined);
  await page.goto(`${arnes.origen}/calibrar.html`);
  return { page, marca, navegador: `${canal} ${navegador.version()}`, cerrar: async () => { await navegador.close(); } };
}

/** Memoria de la familia de procesos del navegador (Windows): suma de tamaños de trabajo y de picos, en bytes. */
function memoriaProcesos(marca: string): { actual: number; pico: number; procesos: number } | null {
  const orden = 'Get-CimInstance Win32_Process | Where-Object { $_.Name -match "chrome|msedge|headless" } | '
    + 'Select-Object ProcessId,ParentProcessId,CommandLine,WorkingSetSize,PeakWorkingSetSize | ConvertTo-Json -Compress';
  const r = spawnSync('powershell', ['-NoProfile', '-Command', orden], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout.trim()) return null;
  const crudo = JSON.parse(r.stdout) as unknown;
  const filas = (Array.isArray(crudo) ? crudo : [crudo]) as Array<{ ProcessId: number; ParentProcessId: number; CommandLine: string | null; WorkingSetSize: number; PeakWorkingSetSize: number }>;
  const raices = filas.filter((f) => (f.CommandLine ?? '').includes(marca)).map((f) => f.ProcessId);
  const arbol = new Set<number>(raices);
  for (let cambio = true; cambio;) {
    cambio = false;
    for (const f of filas) if (!arbol.has(f.ProcessId) && arbol.has(f.ParentProcessId)) { arbol.add(f.ProcessId); cambio = true; }
  }
  const mios = filas.filter((f) => arbol.has(f.ProcessId));
  // PeakWorkingSetSize de Win32_Process está en KB; WorkingSetSize en bytes.
  return { actual: mios.reduce((a, f) => a + Number(f.WorkingSetSize), 0), pico: mios.reduce((a, f) => a + Number(f.PeakWorkingSetSize) * 1024, 0), procesos: mios.length };
}

interface FotoProceso { pid: number; ppid: number; cmd: string; cpuS: number }
/** Tiempo de CPU acumulado de todos los procesos (Windows): permite saber cuántos núcleos usaron los demás durante una corrida. */
function fotoProcesos(): { t: number; filas: FotoProceso[] } | null {
  const orden = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,UserModeTime,KernelModeTime | ConvertTo-Json -Compress';
  const r = spawnSync('powershell', ['-NoProfile', '-Command', orden], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout.trim()) return null;
  const crudo = JSON.parse(r.stdout) as Array<{ ProcessId: number; ParentProcessId: number; CommandLine: string | null; UserModeTime: number | string; KernelModeTime: number | string }>;
  return {
    t: Date.now(),
    filas: crudo.map((f) => ({ pid: f.ProcessId, ppid: f.ParentProcessId, cmd: f.CommandLine ?? '', cpuS: (Number(f.UserModeTime) + Number(f.KernelModeTime)) / 1e7 })),
  };
}

/** Núcleos usados en promedio por el navegador de la corrida y por todo lo demás entre dos fotos (cota inferior: no ve procesos que terminaron). */
function nucleosEntre(a: ReturnType<typeof fotoProcesos>, b: ReturnType<typeof fotoProcesos>, marca: string): { propios: number; ajenos: number } | null {
  if (a === null || b === null) return null;
  const arbol = new Set<number>(b.filas.filter((f) => f.cmd.includes(marca)).map((f) => f.pid));
  for (let cambio = true; cambio;) {
    cambio = false;
    for (const f of b.filas) if (!arbol.has(f.pid) && arbol.has(f.ppid)) { arbol.add(f.pid); cambio = true; }
  }
  const antes = new Map(a.filas.map((f) => [f.pid, f.cpuS]));
  let propios = 0;
  let ajenos = 0;
  for (const f of b.filas) {
    const previo = antes.get(f.pid);
    if (previo === undefined) { if (arbol.has(f.pid)) propios += f.cpuS; continue; }
    if (arbol.has(f.pid)) propios += f.cpuS - previo; else ajenos += f.cpuS - previo;
  }
  const dt = (b.t - a.t) / 1000;
  return { propios: Math.round((propios / dt) * 100) / 100, ajenos: Math.round((ajenos / dt) * 100) / 100 };
}

function cargaCpu(): number | null {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average'], { encoding: 'utf8' });
  const v = Number(r.stdout.trim());
  return Number.isFinite(v) ? v : null;
}

type Pagina = import('@playwright/test').Page;
interface RespuestaArnes {
  ok: boolean; error?: string; cargaTotalMs?: number; carga?: { warmupWindowMs: number; threads: number; [k: string]: unknown }; ventanas?: VentanaOut[];
  totalMs?: number; picoWasm?: number; picoJs?: number; wasmBytes?: number;
}
const iniciar = (p: Pagina, manifiesto: ModelManifest, hilos: number): Promise<RespuestaArnes> =>
  p.evaluate(([m, h]) => (globalThis as never as { __cal: { iniciar(a: unknown, b: number): Promise<never> } }).__cal.iniciar(m, h), [manifiesto, hilos] as const) as Promise<RespuestaArnes>;
const partes = (p: Pagina, ps: Array<{ clave: string; texto: string }>, piso: number, etiquetas: string, solape?: number): Promise<RespuestaArnes> =>
  p.evaluate(([a, b, c, d]) => (globalThis as never as { __cal: { partes(...x: unknown[]): Promise<never> } }).__cal.partes(a, b, c, d), [ps, piso, etiquetas, solape] as const) as Promise<RespuestaArnes>;
const liberar = (p: Pagina): Promise<void> => p.evaluate(() => (globalThis as never as { __cal: { liberar(): Promise<void> } }).__cal.liberar());

// ===================================================================================================================
// Órdenes que corren el modelo
// ===================================================================================================================

interface VentanaOut { parte: string; i: number; n: number; ms: number; spans: Array<[number, number, EtiquetaModelo, number]> }

async function ordenPasada(raiz: string, a: Map<string, string>, etiquetas: 'estandar' | 'traducidas' | 'nueve', salidaPorDefecto: (m: Modelo) => string): Promise<void> {
  const modelo = arg(a, 'modelo', 'x-large') as Modelo;
  const hilos = Number(arg(a, 'hilos', '8'));
  const solape = Number(arg(a, 'solape', '37'));
  const canal = arg(a, 'canal', 'chromium');
  const { ids: todos, textos, golds } = cargarCorpus(raiz);
  const filtro = a.get('docs');
  const ids = filtro === undefined || filtro === '' || filtro === 'todos' ? todos : filtro.split(',').filter((d) => todos.includes(d));
  const salida = resolve(raiz, arg(a, 'salida', salidaPorDefecto(modelo)));
  void golds;
  const liberarCandado = await tomarCandado(raiz);
  const arnes = await prepararArnes(raiz, modelo, solape);
  let sesion: Sesion | null = null;
  try {
    sesion = await abrirNavegador(arnes, canal, []);
    log(`cargo ${modelo} con ${hilos} hilos`);
    const carga = await iniciar(sesion.page, arnes.manifiesto, hilos);
    if (!carga.ok) throw new Error(`carga fallida: ${String(carga.error)}`);
    log(`cargado en ${Math.round(Number(carga.cargaTotalMs))} ms; calentamiento ${JSON.stringify(carga.carga?.warmupWindowMs)} ms`);
    const documentos: Record<string, DocumentoCache> = {};
    const cpu0 = cargaCpu();
    for (const id of ids) {
      const ps = (textos[id] as ParteTexto[]).map((p) => ({ clave: p.clave, texto: p.texto }));
      const r = await partes(sesion.page, ps, 0.1, etiquetas, solape);
      if (!r.ok) throw new Error(`fallo en ${id}: ${String(r.error)}`);
      const ventanas = r.ventanas ?? [];
      const porParte: Record<string, ParteCache> = {};
      for (const p of ps) porParte[p.clave] = { sha256: sha256Texto(p.texto), ventanas: [] };
      for (const v of ventanas) {
        (porParte[v.parte] as ParteCache).ventanas.push({ windowIndex: v.i, windowTotal: v.n, ms: v.ms, spans: v.spans.map(([start, end, label, score]) => ({ start, end, label, score })) });
      }
      documentos[id] = { partes: porParte };
      log(`${id}: ${ventanas.length} ventanas, ${Math.round(Number(r.totalMs) / 100) / 10} s, ${ventanas.reduce((n, v) => n + v.spans.length, 0)} tramos >= 0,1`);
    }
    const cpu1 = cargaCpu();
    const memoria = memoriaProcesos(sesion.marca);
    const cache: CacheModelo = {
      formato: 'sig-low/cache-modelo', v: 1, modelo, vista: 'natural', etiquetas, piso: 0.1,
      opciones: { windowTokens: 512, overlapWords: solape, maxSpanWords: 12 },
      huella: {
        texto: sha256Texto(ids.flatMap((id) => Object.values((documentos[id] as DocumentoCache).partes).map((p) => p.sha256)).join('')),
        vista: sha256Texto('natural'), onnx: arnes.manifiesto.sha256, codigo: huellaMotor(raiz),
      },
      carga: carga.carga,
      corrida: { hilos, navegador: sesion.navegador, nucleosLogicos: 16, fecha: ahora(), equipo: 'Ryzen 7 5700U, 16 hilos, 15 GB (h0/equipo.txt)', conjunto: ids.length === todos.length ? 'desarrollo' : 'parcial' },
      documentos,
    };
    const extra = { cpuAntes: cpu0, cpuDespues: cpu1, memoriaProcesos: memoria };
    escribirJson(salida, { ...cache, medicion: extra });
    log(`escrito ${salida}`);
    await liberar(sesion.page);
  } finally {
    await sesion?.cerrar();
    arnes.cerrarServidor();
    liberarCandado();
  }
}

/** Escrito de unas `palabras` palabras con partes del corpus en un orden fijo (para el tiempo de 10 páginas). */
export function escritoLargo(textos: Record<string, ParteTexto[]>, ids: readonly string[], palabras: number): string {
  const trozos: string[] = [];
  let n = 0;
  for (const id of ids) {
    for (const p of textos[id] as ParteTexto[]) {
      if (p.kind !== 'cuerpo' && p.kind !== 'pagina_pdf') continue;
      for (const w of p.texto.split(/\s+/).filter(Boolean)) { trozos.push(w); if (++n >= palabras) return trozos.join(' '); }
    }
  }
  return trozos.join(' ');
}

async function ordenLatencia(raiz: string, a: Map<string, string>): Promise<void> {
  const modelo = arg(a, 'modelo', 'x-large') as Modelo;
  const lista = arg(a, 'hilos', '8,4,1').split(',').map(Number);
  const canal = arg(a, 'canal', 'chromium');
  const extra = a.has('jitless') ? ['--js-flags=--jitless'] : [];
  const solape = Number(arg(a, 'solape', '37'));
  const palabras = Number(arg(a, 'palabras', '5000'));
  const palabras1 = Number(arg(a, 'palabras1', '1100'));
  const { ids, textos } = cargarCorpus(raiz);
  const salida = resolve(raiz, arg(a, 'salida', `metricas/latencia-${modelo}-${canal}.json`));
  const liberarCandado = await tomarCandado(raiz);
  const arnes = await prepararArnes(raiz, modelo, solape);
  const filas: unknown[] = [];
  try {
    for (const hilos of lista) {
      const sesion = await abrirNavegador(arnes, canal, extra);
      try {
        const cpu0 = cargaCpu();
        const carga = await iniciar(sesion.page, arnes.manifiesto, hilos);
        if (!carga.ok) { filas.push({ hilos, error: carga.error }); log(`${hilos} hilos: carga fallida (${String(carga.error)})`); continue; }
        const texto = escritoLargo(textos, ids, hilos === 1 ? palabras1 : palabras);
        const foto0 = fotoProcesos();
        const r = await partes(sesion.page, [{ clave: 'cuerpo:1', texto }], 0.1, 'estandar', solape);
        if (!r.ok) { filas.push({ hilos, error: r.error }); continue; }
        const ventanas = r.ventanas ?? [];
        const ms = ventanas.map((v) => v.ms);
        const nucleos = nucleosEntre(foto0, fotoProcesos(), sesion.marca);
        const memoria = memoriaProcesos(sesion.marca);
        const cpu1 = cargaCpu();
        const fila = {
          modelo, navegador: sesion.navegador, hilos, palabras: texto.split(/\s+/).length, ventanas: ventanas.length,
          cargaMs: Math.round(Number(carga.cargaTotalMs)), calentamientoMs: carga.carga?.warmupWindowMs,
          medianaMs: Math.round(mediana(ms)), p90Ms: Math.round(percentil(ms, 0.9)), minMs: Math.round(Math.min(...ms)), maxMs: Math.round(Math.max(...ms)),
          totalMs: r.totalMs, wasmMb: Math.round(Number(r.picoWasm) / 1048576),
          procesosMbActual: memoria ? Math.round(memoria.actual / 1048576) : null, procesosMbPico: memoria ? Math.round(memoria.pico / 1048576) : null,
          cpuAntes: cpu0, cpuDespues: cpu1, nucleosPropios: nucleos?.propios ?? null, nucleosAjenos: nucleos?.ajenos ?? null, ventanasMs: ms,
        };
        filas.push(fila);
        log(`${modelo} ${hilos} hilos: ${fila.ventanas} ventanas, mediana ${fila.medianaMs} ms, p90 ${fila.p90Ms} ms, total ${fila.totalMs} ms, wasm ${fila.wasmMb} MB, procesos pico ${fila.procesosMbPico} MB`);
        await liberar(sesion.page);
      } finally {
        await sesion.cerrar();
      }
    }
    escribirJson(salida, { formato: 'sig-low/latencia', v: 1, fecha: ahora(), equipo: 'Ryzen 7 5700U, 16 hilos, 15 GB', jitless: a.has('jitless'), filas });
    log(`escrito ${salida}`);
  } finally {
    arnes.cerrarServidor();
    liberarCandado();
  }
}

async function ordenEdge(raiz: string, a: Map<string, string>): Promise<void> {
  const modelo = arg(a, 'modelo', 'x-large') as Modelo;
  const canal = arg(a, 'canal', 'msedge');
  const hilos = Number(arg(a, 'hilos', '4'));
  const banderas = arg(a, 'banderas', '--js-flags=--jitless').split(' ').filter(Boolean);
  const { textos } = cargarCorpus(raiz);
  const docs = arg(a, 'docs', 'C01,C20').split(',');
  const salida = resolve(raiz, arg(a, 'salida', `metricas/edge-${modelo}.json`));
  const limiteMs = Number(arg(a, 'limite-s', '900')) * 1000;
  const liberarCandado = await tomarCandado(raiz);
  const arnes = await prepararArnes(raiz, modelo, 37);
  const sesion = await abrirNavegador(arnes, canal, banderas);
  const informe: Record<string, unknown> = { formato: 'sig-low/edge', v: 1, fecha: ahora(), navegador: sesion.navegador, banderas, hilos, modelo };
  try {
    informe['info'] = await sesion.page.evaluate(() => (globalThis as never as { __cal: { info(): unknown } }).__cal.info());
    // Calibración de PBKDF2 (600 000 iteraciones, SHA-256), 3 repeticiones.
    const pb: number[] = [];
    for (let i = 0; i < 3; i++) pb.push(await sesion.page.evaluate(() => (globalThis as never as { __cal: { pbkdf2(n: number): Promise<number> } }).__cal.pbkdf2(600000)));
    informe['pbkdf2Ms600k'] = pb.map((x) => Math.round(x));
    const t0 = Date.now();
    const carga = await Promise.race([
      iniciar(sesion.page, arnes.manifiesto, hilos),
      new Promise<RespuestaArnes>((r) => setTimeout(() => r({ ok: false, error: 'sin_tiempo' }), limiteMs)),
    ]);
    informe['cargaOk'] = carga.ok;
    informe['cargaMs'] = Date.now() - t0;
    if (!carga.ok) informe['cargaError'] = carga.error;
    else {
      informe['carga'] = carga.carga;
      const docsMed: Record<string, unknown> = {};
      for (const id of docs) {
        const ps = ((textos[id] ?? []) as ParteTexto[]).map((p) => ({ clave: p.clave, texto: p.texto }));
        const t1 = Date.now();
        const r = await Promise.race([
          partes(sesion.page, ps, 0.3, 'estandar'),
          new Promise<RespuestaArnes>((res) => setTimeout(() => res({ ok: false, error: 'sin_tiempo' }), limiteMs)),
        ]);
        const ventanas = r.ok ? (r.ventanas ?? []) : [];
        docsMed[id] = { ok: r.ok, error: r.error ?? null, ventanas: ventanas.length, ms: Date.now() - t1, medianaVentanaMs: ventanas.length ? Math.round(mediana(ventanas.map((v) => v.ms))) : null };
        log(`${id}: ${JSON.stringify(docsMed[id])}`);
        if (!r.ok) break;
      }
      informe['documentos'] = docsMed;
    }
    informe['memoriaProcesosMb'] = (() => { const m = memoriaProcesos(sesion.marca); return m ? { actual: Math.round(m.actual / 1048576), pico: Math.round(m.pico / 1048576) } : null; })();
  } finally {
    await sesion.cerrar();
    arnes.cerrarServidor();
    liberarCandado();
  }
  escribirJson(salida, informe);
  log(`escrito ${salida}`);
}

// ===================================================================================================================
// Orden sin modelo: calibrar (T-AB-03)
// ===================================================================================================================

export const UMBRALES = [0.3, 0.4, 0.5, 0.6] as const;
/** Pisos por debajo de la rejilla del plan: solo informativos (la caché guarda desde 0,1). */
export const UMBRALES_INFO = [0.1, 0.15, 0.2, 0.25] as const;
/** Curva fina para comparar variantes de etiquetas a igual precisión (informativa). */
export const UMBRALES_CURVA = [0.15, 0.2, 0.25, 0.35] as const;
const leerCache = (ruta: string): CacheModelo => JSON.parse(readFileSync(ruta, 'utf8')) as CacheModelo;

export interface InformeEtiquetas {
  modelo: string; docs: string[];
  variantes: Record<string, { filas: FilaUmbral[]; seleccion: Seleccion; curva: FilaUmbral[] }>;
}

export function resumenEtiquetas(rutas: Record<string, string>, golds: Record<string, GoldDocument>, minPrecision: number): InformeEtiquetas | null {
  const variantes: InformeEtiquetas['variantes'] = {};
  let modelo = '';
  let docs: string[] = [];
  for (const [nombre, ruta] of Object.entries(rutas)) {
    if (!existsSync(ruta)) continue;
    const c = leerCache(ruta);
    modelo = c.modelo;
    docs = Object.keys(c.documentos);
    const filas = UMBRALES.map((u) => evaluarUmbral(c, golds, u));
    variantes[nombre] = { filas, seleccion: elegirUmbral(filas, minPrecision), curva: UMBRALES_CURVA.map((u) => evaluarUmbral(c, golds, u)) };
  }
  return Object.keys(variantes).length === 0 ? null : { modelo, docs, variantes };
}

function ordenCalibrar(raiz: string, a: Map<string, string>): void {
  const { golds } = cargarCorpus(raiz);
  const principal = resolve(raiz, arg(a, 'cache', 'metricas/modelo-x-large-natural.json'));
  if (!existsSync(principal)) throw new Error(`falta la caché de salidas: ${principal}`);
  const cache = leerCache(principal);
  const minP = Number(arg(a, 'precision', '0.7'));
  const filas = UMBRALES.map((u) => evaluarUmbral(cache, golds, u));
  const sel = elegirUmbral(filas, minP);
  const n = Math.round((0.99 - sel.umbral) * 100) + 1;
  const candidatos = Array.from({ length: n }, (_, i) => Math.round((sel.umbral + i * 0.01) * 100) / 100);
  const informativo = UMBRALES_INFO.map((u) => evaluarUmbral(cache, golds, u));
  const alto = barridoAlto(cache, golds, sel.umbral, candidatos);
  const elegidoAlto = elegirAlto(alto, 0.9);
  const etiquetas: Record<string, InformeEtiquetas | null> = {
    'x-base': resumenEtiquetas({ estandar: join(raiz, 'metricas/etiquetas-x-base-estandar.json'), traducidas: join(raiz, 'metricas/etiquetas-x-base-traducidas.json'), nueve: join(raiz, 'metricas/etiquetas-x-base-nueve.json') }, golds, minP),
    'x-large': resumenEtiquetas({ estandar: join(raiz, 'metricas/etiquetas-x-large-estandar.json'), traducidas: join(raiz, 'metricas/etiquetas-x-large-traducidas.json'), nueve: join(raiz, 'metricas/etiquetas-x-large-nueve.json') }, golds, minP),
  };
  // Solape de 25 palabras (9.5: ganar ventanas si la meta de rendimiento no se cumple): ventanas y exhaustividad frente al solape de 37.
  const contarVentanas = (c: CacheModelo): number => Object.values(c.documentos).reduce((n, d) => n + Object.values(d.partes).reduce((m, p) => m + p.ventanas.length, 0), 0);
  const rutaSolape = join(raiz, 'metricas/solape-25-x-large-natural.json');
  let solape: unknown = null;
  if (existsSync(rutaSolape)) {
    const c25 = leerCache(rutaSolape);
    const r37 = evaluarUmbral(cache, golds, sel.umbral);
    const r25 = evaluarUmbral(c25, golds, sel.umbral);
    solape = {
      umbral: sel.umbral, solapes: [37, 25], ventanas: [contarVentanas(cache), contarVentanas(c25)],
      exhaustividadPerOrg: [r37.grupos['PER_ORG']?.exhaustividadMencion, r25.grupos['PER_ORG']?.exhaustividadMencion],
      cubiertasPerOrg: [r37.grupos['PER_ORG']?.cubiertas, r25.grupos['PER_ORG']?.cubiertas],
      f2PerOrg: [r37.grupos['PER_ORG']?.f2, r25.grupos['PER_ORG']?.f2],
    };
  }
  const informe = {
    formato: 'sig-low/calibracion-modelo', v: 1, fecha: ahora(), cache: { modelo: cache.modelo, huella: cache.huella, documentos: Object.keys(cache.documentos).length },
    minPrecisionGlobal: minP, barridoUmbral: filas, seleccion: sel, barridoInformativo: informativo, solape,
    nerMinScore: sel.umbral, nerHighThreshold: elegidoAlto?.umbral ?? null, barridoAlto: alto, altoAlcanzable: elegidoAlto !== null, etiquetas,
  };
  escribirJson(resolve(raiz, arg(a, 'salida', 'metricas/calibracion-umbral.json')), informe);
  for (const f of filas) {
    const g = f.grupos['PER_ORG'] as FilaUmbral['grupos'][string];
    log(`umbral ${f.umbral}: precisión global ${f.precisionGlobal.toFixed(3)} (${f.verdaderas}/${f.detecciones}); PER+ORG R ${g.exhaustividadMencion.toFixed(3)} P ${g.precision.toFixed(3)} F2 ${g.f2.toFixed(3)}`);
  }
  log(`elegido nerMinScore = ${sel.umbral} (${sel.motivo}); nerHighThreshold = ${elegidoAlto?.umbral ?? 'no alcanzable'}`);
}

// ===================================================================================================================
// Confirmación de la calibración en la reserva (P0-4; T-AB-03, 10.8.5), sin modelo
// ===================================================================================================================

/** Lo que dan el umbral y la banda calibrados en un conjunto de documentos (desarrollo con el texto final, o reserva). */
export interface ConfirmacionConjunto {
  docs: string[];
  barridoUmbral: FilaUmbral[];
  /** Lo que elegiría la misma regla de T-AB-03 (a) en este conjunto. Informativo: la reserva nunca cambia el umbral. */
  seleccion: Seleccion;
  barridoAlto: FilaAlto[];
  /** El menor valor con precisión >= 0,90 entre los tramos `media` en este conjunto (informativo). */
  alto: FilaAlto | null;
  enElUmbral: FilaUmbral;
  enLaBanda: FilaAlto;
  /** La regla de (a) elige en este conjunto el mismo `nerMinScore`, con precisión global >= 0,70. */
  confirmaUmbral: boolean;
  /** Los tramos `media` (puntaje >= `nerHighThreshold`) tienen precisión >= 0,90 en este conjunto. */
  confirmaBanda: boolean;
}
export interface ConfirmacionCalibracion {
  formato: 'sig-low/confirmacion-calibracion'; v: 1; fecha: string;
  cache: { archivo: string; modelo: string; vista: string; etiquetas: string; huella: CacheModelo['huella']; documentos: number };
  calibrado: { nerMinScore: number; nerHighThreshold: number; fuente: string };
  minPrecisionGlobal: number; minPrecisionBanda: number;
  desarrollo: ConfirmacionConjunto;
  reserva: ConfirmacionConjunto;
  etiquetas: { calibradas: string; nota: string };
  /** Umbral y banda confirmados en la reserva. */
  confirmada: boolean;
}

/** T-AB-03 sobre un conjunto: barre el piso, aplica la regla de (a) y mide la banda calibrada. `docs` filtra la caché (la reserva aparte). */
export function confirmarConjunto(
  cache: CacheModelo, golds: Record<string, GoldDocument>, docs: readonly string[], nerMinScore: number, nerHighThreshold: number,
  minPrecision = 0.7, minPrecisionBanda = 0.9,
): ConfirmacionConjunto {
  const ids = [...docs].filter((d) => cache.documentos[d] !== undefined && golds[d] !== undefined).sort();
  const rejilla = [...new Set([...UMBRALES, nerMinScore])].sort((a, b) => a - b);
  const barridoUmbral = rejilla.map((u) => evaluarUmbral(cache, golds, u, ids));
  const seleccion = elegirUmbral(barridoUmbral.filter((f) => (UMBRALES as readonly number[]).includes(f.umbral)), minPrecision);
  const n = Math.round((0.99 - nerMinScore) * 100) + 1;
  const candidatos = [...new Set([...Array.from({ length: n }, (_, i) => Math.round((nerMinScore + i * 0.01) * 100) / 100), nerHighThreshold])].sort((a, b) => a - b);
  const barridoAlto0 = barridoAlto(cache, golds, nerMinScore, candidatos, ids);
  const enElUmbral = barridoUmbral.find((f) => f.umbral === nerMinScore) as FilaUmbral;
  const enLaBanda = barridoAlto0.find((f) => f.umbral === nerHighThreshold) as FilaAlto;
  return {
    docs: ids, barridoUmbral, seleccion, barridoAlto: barridoAlto0, alto: elegirAlto(barridoAlto0, minPrecisionBanda), enElUmbral, enLaBanda,
    confirmaUmbral: seleccion.cumplePrecision && seleccion.umbral === nerMinScore && enElUmbral.precisionGlobal >= minPrecision,
    confirmaBanda: enLaBanda.tramos > 0 && enLaBanda.precision >= minPrecisionBanda,
  };
}

export const NOTA_ETIQUETAS_RESERVA =
  'La caché de la reserva solo trae las etiquetas estándar (person, organization, location): la comparación con las traducidas y con las nueve '
  + 'de T-AB-03 (a) no se repite en la reserva sin una pasada nueva del modelo. Con las estándar se confirma el umbral (misma regla, misma elección).';

/** Arma la confirmación de P0-4: el desarrollo con el texto final (19 documentos) y la reserva (10), con el umbral y la banda de PF-3. */
export function confirmarCalibracion(
  cache: CacheModelo, archivo: string, golds: Record<string, GoldDocument>, calibrado: { nerMinScore: number; nerHighThreshold: number }, fecha: string,
  minPrecision = 0.7, minPrecisionBanda = 0.9,
): ConfirmacionCalibracion {
  if (cache.vista !== 'natural') throw new Error('VISTA_NO_NATURAL');
  const de = (c: string): string[] => Object.keys(cache.documentos).filter((id) => golds[id]?.conjunto === c).sort();
  const desarrollo = confirmarConjunto(cache, golds, de('desarrollo'), calibrado.nerMinScore, calibrado.nerHighThreshold, minPrecision, minPrecisionBanda);
  const reserva = confirmarConjunto(cache, golds, de('reserva'), calibrado.nerMinScore, calibrado.nerHighThreshold, minPrecision, minPrecisionBanda);
  return {
    formato: 'sig-low/confirmacion-calibracion', v: 1, fecha,
    cache: { archivo, modelo: cache.modelo, vista: cache.vista, etiquetas: cache.etiquetas ?? 'estandar', huella: cache.huella, documentos: Object.keys(cache.documentos).length },
    calibrado: { ...calibrado, fuente: 'metricas/calibracion-umbral.json (PF-3)' },
    minPrecisionGlobal: minPrecision, minPrecisionBanda,
    desarrollo, reserva,
    etiquetas: { calibradas: cache.etiquetas ?? 'estandar', nota: NOTA_ETIQUETAS_RESERVA },
    confirmada: reserva.confirmaUmbral && reserva.confirmaBanda,
  };
}

function ordenConfirmar(raiz: string, a: Map<string, string>): number {
  const { golds } = cargarCorpus(raiz);
  const rutaVistas = arg(a, 'vistas', 'metricas/modelo-x-large-vistas.json');
  const archivo = JSON.parse(readFileSync(resolve(raiz, rutaVistas), 'utf8')) as { vistas?: { natural?: CacheModelo } };
  const cache = archivo.vistas?.natural;
  if (cache === undefined) throw new Error(`falta la vista natural en ${rutaVistas}`);
  const cal = JSON.parse(readFileSync(resolve(raiz, 'metricas/calibracion-umbral.json'), 'utf8')) as { nerMinScore: number; nerHighThreshold: number };
  const c = confirmarCalibracion(cache, `${rutaVistas} (vista natural)`, golds, { nerMinScore: cal.nerMinScore, nerHighThreshold: cal.nerHighThreshold }, ahora());
  escribirJson(resolve(raiz, arg(a, 'salida', 'metricas/calibracion-reserva.json')), c);
  for (const [nombre, x] of [['desarrollo', c.desarrollo], ['reserva', c.reserva]] as const) {
    log(`== ${nombre} (${x.docs.length} documentos) ==`);
    for (const f of x.barridoUmbral) {
      const g = f.grupos['PER_ORG'] as FilaUmbral['grupos'][string];
      log(`umbral ${f.umbral}: precisión global ${f.precisionGlobal.toFixed(3)} (${f.verdaderas}/${f.detecciones}); PER+ORG n ${g.n} R ${g.exhaustividadMencion.toFixed(3)} P ${g.precision.toFixed(3)} F2 ${g.f2.toFixed(3)}`);
    }
    log(`regla de (a): ${x.seleccion.umbral} (${x.confirmaUmbral ? 'confirma' : 'NO confirma'} ${c.calibrado.nerMinScore}); banda ${c.calibrado.nerHighThreshold}: ${x.enLaBanda.verdaderas}/${x.enLaBanda.tramos} = ${x.enLaBanda.precision.toFixed(3)} (${x.confirmaBanda ? 'confirma' : 'NO confirma'}); el conjunto elegiría ${x.alto?.umbral ?? 'ninguno'}`);
  }
  log(`T-AB-03 en la reserva: ${c.confirmada ? 'confirmada' : 'NO confirmada'}`);
  return c.confirmada ? 0 : 1;
}

// ===================================================================================================================

export async function main(argv: readonly string[]): Promise<number> {
  const orden = argv[0];
  const a = argumentos(argv.slice(1));
  const raiz = process.cwd();
  switch (orden) {
    case 'pasada': await ordenPasada(raiz, a, 'estandar', (m) => `metricas/modelo-${m}-natural.json`); return 0;
    case 'etiquetas': {
      const modelo = arg(a, 'modelo', 'x-base') as Modelo;
      const variantes = arg(a, 'variantes', 'estandar,traducidas,nueve').split(',') as Array<'estandar' | 'traducidas' | 'nueve'>;
      for (const v of variantes) {
        a.set('salida', `metricas/etiquetas-${modelo}-${v}.json`);
        await ordenPasada(raiz, a, v, () => '');
      }
      return 0;
    }
    case 'latencia': await ordenLatencia(raiz, a); return 0;
    case 'edge': await ordenEdge(raiz, a); return 0;
    case 'calibrar': ordenCalibrar(raiz, a); return 0;
    case 'confirmar': return ordenConfirmar(raiz, a);
    default:
      process.stderr.write('Uso: node scripts/calibrar-modelo.ts <pasada|etiquetas|latencia|edge|calibrar|confirmar> [--opcion=valor]\n');
      return 2;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e: unknown) => {
    process.stderr.write(`calibrar-modelo: ${e instanceof Error ? e.message : 'error'}\n`);
    process.exitCode = 1;
  });
}
