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
//              se pasan de nuevo. Desde PF-3-r1b el texto que recibe el modelo lleva la restauración de mayúsculas por párrafo del producto
//              (src/core/ner/mayusculas.ts, `--preproceso=restaurar-parrafos` por defecto) y la caché guarda su versión y la huella de ese archivo.
//   verificar  T-AB-06: una pasada nueva de C22, C10 y C13 (12 ventanas) debe reproducir tramos y puntajes de la caché a +-1e-4 y la
//              huella del motor y la de mayusculas.ts no deben haber cambiado; la pasada nueva usa el preproceso de la caché. Escribe `verificacion` en el mismo archivo. Candado del modelo.
//   evaluar    T-AB-01, sin modelo: exhaustividad de PER, ORG y LOC por vista frente al gold, dentro y fuera de la lista, filas por
//              vista de 10.4.1 con el umbral de PF-3, matriz de confusión y reserva aparte. Escribe `evaluacion` en el mismo archivo.
//              Con --modelo=x-base calcula además T-AB-04: la comparación con el principal (`comparacion`), sin criterio de cierre.
//   experimento PF-3-r1 (D-06, decisión 6), sin modelo y solo con el desarrollo (D-01): ORG_FUERA y PERSONA_FUERA por vista, con la
//              precisión global y la diferencia en la vista natural, para la línea base, (a) etiquetas traducidas, (b) restauración de
//              mayúsculas y (a)+(b). Lee las cachés de VARIANTES_PF3R1 y escribe metricas/pf3r1-experimento.json. Las cachés de (a), (b)
//              y (a)+(b) las hace `pasada` con --etiquetas=traducidas y/o --preproceso=restaurar y una --salida propia (nunca la caché
//              única); --reutilizar=<archivos> copia las partes cuyo texto de entrada al modelo ya pasó con las mismas etiquetas.
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
import { cargarCorpus as cargarTextos, deteccionesDe, evaluarUmbral, huellaMotor } from './calibrar-modelo.ts';
import type { CacheModelo as CachePF3, DocumentoCache, ParteCache, ParteTexto, VentanaCache } from './calibrar-modelo.ts';
import {
  PALABRAS_FUNCION, VERSION_RESTAURAR, cajaDe, restaurarMayusculas as restaurarDelProducto, restaurarSegmentos, segmentosFrase, segmentosParrafo,
} from '../src/core/ner/mayusculas.ts';
import type { DataType, ModelManifest } from '../src/core/types.ts';
import { calcularFila, claveParte, esPositiva, evaluarDocumento, grupoDeTipo, gruposDeCierre, omisionesPermitidas } from './metrics.ts';
import type { EntradaDocumento, GoldAnnotation, GoldDocument, GrupoDef, MetricsRow, RunVista } from './metrics.ts';

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
  /**
   * PF-3-r1: preproceso del texto antes del modelo (`restaurar`: restauración de mayúsculas, experimento (b)) con su versión. Sin el
   * campo, el modelo recibió la vista tal cual.
   */
  preproceso?: { id: Preproceso; version: string; /** sha256 de `src/core/ner/mayusculas.ts` al hacer la pasada (PF-3-r1b); las cachés del experimento no la traen. */ huella?: string };
  /** PF-3-r1: partes copiadas de otra pasada cuyo texto de entrada al modelo era idéntico (mismas etiquetas, ONNX y código). */
  partesReutilizadas?: number;
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
  /** PF-3-r1b: la caché se hizo con el `mayusculas.ts` vigente (o sin preproceso). Las verificaciones anteriores no traen el campo. */
  huellaPreprocesoCoincide?: boolean;
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

// ===================================================================================================================
// Restauración de mayúsculas antes del modelo (PF-3-r1: experimento de D-06, decisión 6; PF-3-r1b: (b′) en el producto)
// ===================================================================================================================
//
// La restauración (b′) vive en `src/core/ner/mayusculas.ts` y la aplica el worker `ner` (`handler.ts`): aquí se reutiliza tal cual, así
// que la caché de salidas se hace con el mismo código que usa el producto. Las reglas (párrafos enteros en MAYÚSCULAS o en minúsculas
// a Title Case, FW de R-MOD-03 en minúscula, siglas y códigos en mayúsculas, posiciones 1:1 de INV-W04) están descritas allí. La
// variante (b) del experimento (por líneas y frases) solo sirve para las cachés `metricas/pf3r1-restaurar*.json` y sus pruebas.
export { PALABRAS_FUNCION, VERSION_RESTAURAR, cajaDe, segmentosFrase, segmentosParrafo };

const RE_SALTO = /[\n\r\u{B}\u{C}\u{85}\u{2028}\u{2029}]/u;
const plegar = (p: string): string => p.normalize('NFD').replace(/[\p{M}\u{AD}\u{200B}-\u{200D}]/gu, '').toLowerCase();

/** Segmentos para las MAYÚSCULAS de (b): líneas, cortadas además tras [.!?;:] seguidos de un blanco. Posiciones [inicio, fin). */
export function segmentosLinea(t: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let s = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i] as string;
    if (RE_SALTO.test(c)) { if (i > s) out.push([s, i]); s = i + 1; continue; }
    if ('.!?;:'.includes(c) && (i + 1 === t.length || /\s/u.test(t[i + 1] as string))) { out.push([s, i + 1]); s = i + 1; }
  }
  if (s < t.length) out.push([s, t.length]);
  return out;
}

/**
 * Restauración de mayúsculas. `parrafos` es (b′), la del producto (`restaurarMayusculas` de `src/core/ner/mayusculas.ts`); `segmentos`
 * es (b) del experimento: las líneas enteras en MAYÚSCULAS y las frases enteras en minúsculas. Misma longitud UTF-16 (INV-W04).
 */
export function restaurarMayusculas(texto: string, alcance: 'segmentos' | 'parrafos' = 'segmentos'): string {
  if (alcance === 'parrafos') return restaurarDelProducto(texto);
  return restaurarSegmentos(texto, (frases) => [
    ...segmentosLinea(texto).filter(([s, e]) => cajaDe(texto.slice(s, e)) === 'may'),
    ...frases.filter(([s, e]) => cajaDe(texto.slice(s, e)) === 'min'),
  ]);
}

/** `restaurar`: (b) por líneas y frases; `restaurar-parrafos`: (b′), solo párrafos enteros en MAYÚSCULAS o en minúsculas. */
export type Preproceso = 'ninguno' | 'restaurar' | 'restaurar-parrafos';
/** El preproceso que hace el producto: la caché única (`metricas/modelo-<modelo>-vistas.json`) se pasa siempre con él (PF-3-r1b). */
export const PREPROCESO_PRODUCTO: Preproceso = 'restaurar-parrafos';
export type EtiquetasPasada = 'estandar' | 'traducidas';
/** Texto que recibe el modelo: la vista de medición y, con la restauración, la restauración de mayúsculas encima. */
export function entradaModelo(texto: string, vista: Vista, preproceso: Preproceso): string {
  const v = vistaDeTexto(texto, vista);
  if (preproceso === 'ninguno') return v;
  return restaurarMayusculas(v, preproceso === 'restaurar-parrafos' ? 'parrafos' : 'segmentos');
}

/** Huella de `src/core/ner/mayusculas.ts` (saltos de línea normalizados): la caché con preproceso guarda la del código que la hizo. */
export function huellaMayusculas(raiz: string): string {
  return sha256Texto(readFileSync(join(raiz, 'src/core/ner/mayusculas.ts'), 'utf8').replace(/\r\n/g, '\n'));
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

/**
 * Une una caché de PF-3 en la de una vista natural: copia los documentos cuyo texto no cambió (parte por parte, por sha256). Con un
 * preproceso (PF-3-r1b), `sinCambio` dice si el texto de una parte llega al modelo igual: solo entonces vale la salida de PF-3.
 */
export function reutilizarNatural(
  base: CachePF3, textos: Record<string, ParteTexto[]>, ids: readonly string[], onnx: string, codigo: string, modelo?: Modelo,
  sinCambio: (texto: string) => boolean = () => true,
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
    const mismas = ps.length > 0 && ps.every((p) => bd.partes[p.clave]?.sha256 === sha256Texto(p.texto) && sinCambio(p.texto));
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

/** PF-3-r1: `--etiquetas=estandar|traducidas` (las del prompt; el arnés las devuelve con el nombre canónico PER, ORG y LOC). */
function parseEtiquetas(a: Map<string, string>): EtiquetasPasada {
  const e = arg(a, 'etiquetas', 'estandar');
  if (e !== 'estandar' && e !== 'traducidas') throw new Error(`etiquetas no válidas: ${e}`);
  return e;
}
/**
 * `--preproceso=ninguno|restaurar|restaurar-parrafos` (restauración de mayúsculas antes del modelo: (b) y (b′) de PF-3-r1). Por defecto, el del
 * producto (PF-3-r1b: `restaurar-parrafos`): la caché única se pasa con el mismo texto que el worker `ner` entrega al modelo.
 */
function parsePreproceso(a: Map<string, string>): Preproceso {
  const p = arg(a, 'preproceso', PREPROCESO_PRODUCTO);
  if (p !== 'ninguno' && p !== 'restaurar' && p !== 'restaurar-parrafos') throw new Error(`preproceso no válido: ${p}`);
  return p;
}
const preprocesoDe = (c: CacheVista): Preproceso => c.preproceso?.id ?? 'ninguno';
/**
 * La caché se hizo con el preproceso pedido y, si es la restauración, con la versión vigente de sus reglas y, si se da `huella`, con el
 * `mayusculas.ts` vigente (la caché sin huella, la del experimento, no la cumple).
 */
const mismoPreproceso = (c: CacheVista, p: Preproceso, huella?: string): boolean =>
  preprocesoDe(c) === p && (p === 'ninguno' || (c.preproceso?.version === VERSION_RESTAURAR && (huella === undefined || c.preproceso?.huella === huella)));

/**
 * PF-3-r1 · índice de salidas por texto de entrada al modelo: `<etiquetas>|<sha256 de la entrada>` → ventanas. Una parte cuyo texto
 * de entrada (la vista con su preproceso) ya pasó con las mismas etiquetas, el mismo ONNX y el mismo código del motor da las mismas
 * ventanas (el motor es determinista: T-AB-06 reproduce con diferencia 0), así que se copia sin volver a pasarla.
 */
export function indiceDeEntradas(
  caches: ReadonlyArray<CacheVista>, textos: Record<string, ParteTexto[]>, onnx: string, codigo: string, huellaPreproceso?: string,
): Map<string, VentanaCache[]> {
  const indice = new Map<string, VentanaCache[]>();
  for (const c of caches) {
    if (c.huella.onnx !== onnx || c.huella.codigo !== codigo) continue;
    if (preprocesoDe(c) !== 'ninguno' && c.preproceso?.version !== VERSION_RESTAURAR) continue;
    // Una caché con la huella de `mayusculas.ts` de otra versión del código no vale; las del experimento (sin huella) valen por su versión.
    if (huellaPreproceso !== undefined && c.preproceso?.huella !== undefined && c.preproceso.huella !== huellaPreproceso) continue;
    const etiquetas = c.etiquetas ?? 'estandar';
    for (const [id, d] of Object.entries(c.documentos)) {
      for (const p of textos[id] ?? []) {
        const pc = d.partes[p.clave];
        if (pc === undefined || pc.sha256 !== sha256Texto(p.texto)) continue;
        indice.set(`${etiquetas}|${sha256Texto(entradaModelo(p.texto, c.vista, preprocesoDe(c)))}`, pc.ventanas);
      }
    }
  }
  return indice;
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

const pasarPartes = (p: Pagina, ps: Array<{ clave: string; texto: string }>, solape: number, etiquetas: EtiquetasPasada = 'estandar'): Promise<RespuestaArnes> =>
  p.evaluate(([a, b, c, d]) => (globalThis as never as { __cal: { partes(...x: unknown[]): Promise<never> } }).__cal.partes(a, b, c, d),
    [ps, PISO_CACHE, etiquetas, solape] as const) as Promise<RespuestaArnes>;

function cargaCpu(): number | null {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average'], { encoding: 'utf8' });
  const v = Number(r.stdout.trim());
  return Number.isFinite(v) ? v : null;
}

/** Opciones de PF-3-r1 de una pasada: etiquetas del prompt, preproceso y el índice de entradas ya pasadas (se copian sin el modelo). */
interface OpcionesPasada { etiquetas: EtiquetasPasada; preproceso: Preproceso; indice?: Map<string, VentanaCache[]> }

/**
 * Pasa un documento (todas sus partes, con el texto en la vista pedida y el preproceso) y devuelve su caché. Las partes en blanco no
 * se pasan. Con `indice`, una parte cuyo texto de entrada ya pasó se copia, y las que pasan se agregan al índice.
 */
async function pasarDocumento(
  s: Sesion | null, partes: readonly ParteTexto[], vista: Vista, solape: number,
  o: OpcionesPasada = { etiquetas: 'estandar', preproceso: 'ninguno' },
): Promise<{ doc: DocumentoCache; ventanas: number; ms: number; tramos: number; reutilizadas: number }> {
  const porParte: Record<string, ParteCache> = {};
  for (const p of partes) porParte[p.clave] = { sha256: sha256Texto(p.texto), ventanas: [] };
  const claveIndice = new Map<string, string>();
  const ps: Array<{ clave: string; texto: string }> = [];
  let reutilizadas = 0;
  for (const p of partes) {
    if (p.texto.trim() === '') continue;
    const entrada = entradaModelo(p.texto, vista, o.preproceso);
    const k = `${o.etiquetas}|${sha256Texto(entrada)}`;
    const previa = o.indice?.get(k);
    if (previa !== undefined) { (porParte[p.clave] as ParteCache).ventanas = structuredClone(previa); reutilizadas++; continue; }
    claveIndice.set(p.clave, k);
    ps.push({ clave: p.clave, texto: entrada });
  }
  let ventanas: VentanaOut[] = [];
  let total = 0;
  if (ps.length > 0) {
    if (s === null) throw new Error('sin sesión del modelo');
    const r = await pasarPartes(s.page, ps, solape, o.etiquetas);
    if (!r.ok) throw new Error(`fallo de la pasada: ${String(r.error)}`);
    ventanas = r.ventanas ?? [];
    total = Number(r.totalMs);
  }
  for (const v of ventanas) {
    (porParte[v.parte] as ParteCache).ventanas.push({ windowIndex: v.i, windowTotal: v.n, ms: v.ms, spans: v.spans.map(([start, end, label, score]) => ({ start, end, label, score })) });
  }
  for (const [clave, k] of claveIndice) o.indice?.set(k, (porParte[clave] as ParteCache).ventanas);
  return { doc: { partes: porParte }, ventanas: ventanas.length, ms: total, tramos: ventanas.reduce((n, v) => n + v.spans.length, 0), reutilizadas };
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
  const etiquetas = parseEtiquetas(a);
  const preproceso = parsePreproceso(a);
  // Las variantes de PF-3-r1 van a su propio archivo de experimento: la caché que mide `npm run medir` es la del producto (PF-3-r1b).
  if ((etiquetas !== 'estandar' || preproceso !== PREPROCESO_PRODUCTO) && salida === resolve(raiz, archivoVistasDe(modelo))) throw new Error('una variante de experimento necesita --salida propia');
  const huellaPre = huellaMayusculas(raiz);
  const { ids, textos, carpeta } = cargarContexto(raiz, a);
  const huellaCodigo = huellaMotor(raiz);
  const liberarCandado = await tomarCandado(raiz, arg(a, 'quien', `evaluar-modelo pasada ${modelo}`));
  const arnes = await prepararArnes(raiz, modelo, solape);
  let sesion: Sesion | null = null;
  try {
    const archivo = leerArchivoVistas(salida, modelo);
    const conCpu0 = cargaCpu();
    // Índice de entradas ya pasadas (PF-3-r1): las demás vistas de este archivo y los archivos de --reutilizar.
    const fuentes = (a.get('reutilizar') ?? '').split(',').filter((r) => r !== '').map((r) => leerArchivoVistas(resolve(raiz, r), modelo));
    const indice = indiceDeEntradas(
      [archivo, ...fuentes].flatMap((f) => Object.values(f.vistas)).filter((c): c is CacheVista => c !== undefined),
      textos, arnes.manifiesto.sha256, huellaCodigo, huellaPre,
    );
    for (const vista of vistas) {
      const previa = archivo.vistas[vista];
      if (previa !== undefined && (previa.huella.onnx !== arnes.manifiesto.sha256 || previa.huella.codigo !== huellaCodigo)) {
        log(`la caché de ${vista} del archivo es de otro ONNX o de otro código del motor: la descarto`);
        delete archivo.vistas[vista];
      }
      if (previa !== undefined && archivo.vistas[vista] !== undefined && ((previa.etiquetas ?? 'estandar') !== etiquetas || !mismoPreproceso(previa, preproceso, huellaPre))) {
        log(`la caché de ${vista} del archivo es de otras etiquetas o de otro preproceso: la descarto`);
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
      if (vista === 'natural' && etiquetas === 'estandar' && existsSync(resolve(raiz, archivoNaturalPf3De(modelo))) && !a.has('sin-pf3')) {
        const base = JSON.parse(readFileSync(resolve(raiz, archivoNaturalPf3De(modelo)), 'utf8')) as CachePF3;
        const { documentos: reus, reutilizados } = reutilizarNatural(base, textos, ids.filter((id) => documentos[id] === undefined), arnes.manifiesto.sha256, huellaCodigo, modelo,
          (texto) => entradaModelo(texto, 'natural', preproceso) === texto);
        for (const id of reutilizados) { documentos[id] = reus[id] as DocumentoCache; procedencia[id] = 'PF-3'; }
        if (reutilizados.length > 0) log(`natural: ${reutilizados.length} documentos reutilizados de PF-3 (${reutilizados.join(' ')})`);
      }
      const pendientes = ids.filter((id) => documentos[id] === undefined);
      log(`vista ${vista}: ${ids.length - pendientes.length} documentos ya en la caché, ${pendientes.length} por pasar`);
      let reutilizadas = archivo.vistas[vista]?.partesReutilizadas ?? 0;
      const guardar = (completa: boolean): void => {
        const conocidos = ids.filter((id) => documentos[id] !== undefined);
        const cuerpo: CacheVista = {
          formato: 'sig-low/cache-modelo', v: 1, modelo, vista, piso: PISO_CACHE, etiquetas,
          opciones: { windowTokens: 512, overlapWords: solape, maxSpanWords: 12 },
          huella: { texto: huellaTextoDeCache(documentos, conocidos), vista: sha256Texto(vista), onnx: arnes.manifiesto.sha256, codigo: huellaCodigo },
          ...(sesion?.carga.carga === undefined ? (archivo.vistas[vista]?.carga === undefined ? {} : { carga: archivo.vistas[vista]?.carga }) : { carga: sesion.carga.carga }),
          corrida: {
            hilos, navegador: sesion?.navegador ?? archivo.vistas[vista]?.corrida?.navegador ?? 'chromium', nucleosLogicos: 16, fecha: ahora(),
            equipo: 'Ryzen 7 5700U, 16 hilos, 15 GB (h0/equipo.txt)', conjunto: completa ? arg(a, 'conjunto', 'todo') : 'parcial',
          },
          documentos: Object.fromEntries(conocidos.map((id) => [id, documentos[id] as DocumentoCache])),
          ...(Object.keys(procedencia).length > 0 ? { procedencia } : {}),
          ...(preproceso === 'ninguno' ? {} : { preproceso: { id: preproceso, version: VERSION_RESTAURAR, huella: huellaPre } }),
          ...(reutilizadas > 0 ? { partesReutilizadas: reutilizadas } : {}),
        };
        archivo.vistas[vista] = cuerpo;
        escribirJson(salida, archivo);
      };
      if (pendientes.length === 0) { guardar(true); continue; }
      let hechos = 0;
      for (const id of pendientes) {
        const ps = textos[id] as ParteTexto[];
        const falta = ps.some((p) => p.texto.trim() !== '' && !indice.has(`${etiquetas}|${sha256Texto(entradaModelo(p.texto, vista, preproceso))}`));
        if (falta) sesion ??= await abrirSesion(arnes, hilos, modelo);
        const r = await pasarDocumento(sesion, ps, vista, solape, { etiquetas, preproceso, indice });
        documentos[id] = r.doc;
        reutilizadas += r.reutilizadas;
        hechos++;
        log(`${vista} ${id}: ${r.ventanas} ventanas, ${Math.round(r.ms / 100) / 10} s, ${r.tramos} tramos >= 0,1${r.reutilizadas > 0 ? `, ${r.reutilizadas} partes con la misma entrada copiadas` : ''} (${hechos}/${pendientes.length})`);
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
  const vistas = parseVistas(arg(a, 'vistas', 'natural,mayusculas,minusculas'));
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
        // Con las mismas etiquetas y el mismo preproceso con que se hizo la caché (PF-3-r1b: el del producto).
        const r = await pasarDocumento(sesion, textos[id] as ParteTexto[], vista, solape, { etiquetas: cache.etiquetas === 'traducidas' ? 'traducidas' : 'estandar', preproceso: preprocesoDe(cache) });
        nueva[id] = r.doc;
        log(`${vista} ${id}: ${r.ventanas} ventanas nuevas, ${Math.round(r.ms / 100) / 10} s`);
      }
      const res = verificarCache(vista, cache, nueva, docs);
      resultados.push(res);
      log(`${vista}: ${res.ventanas} ventanas, ${res.tramos} tramos, diferencia máxima de puntaje ${res.maxDiferenciaPuntaje}, ${res.ok ? 'REPRODUCE' : `NO REPRODUCE (${res.discrepancias.length})`}`);
    }
    const huellasCoinciden = vistas.every((v) => archivo.vistas[v]?.huella.codigo === huellaCodigo);
    const onnxCoincide = vistas.every((v) => archivo.vistas[v]?.huella.onnx === arnes.manifiesto.sha256);
    const huellaPre = huellaMayusculas(raiz);
    const preprocesoCoincide = vistas.every((v) => { const c = archivo.vistas[v]; return c !== undefined && mismoPreproceso(c, preprocesoDe(c), preprocesoDe(c) === 'ninguno' ? undefined : huellaPre); });
    const verificacion: Verificacion = {
      fecha: ahora(), tolerancia: TOLERANCIA_PUNTAJE, huellaMotorCoincide: huellasCoinciden, huellaOnnxCoincide: onnxCoincide, huellaPreprocesoCoincide: preprocesoCoincide,
      resultados, ok: huellasCoinciden && onnxCoincide && preprocesoCoincide && resultados.every((r) => r.ok),
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
  vista: Vista, cache: CacheVista, carpetaCorpus: string, umbrales: { nerMinScore: number; nerHighThreshold: number }, conjunto: Conjunto = 'todo',
): Promise<{ evaluacion: EvaluacionVista; conjuntos: string[]; producto: EntradaDocumento[]; golds: Record<string, GoldDocument> }> {
  // Los módulos del motor y del corpus se importan solo aquí: las funciones puras de arriba no los necesitan.
  const { cargarCorpus } = await import('../tests/medicion/lib/corpus.ts');
  const { validarCache } = await import('../tests/medicion/lib/cache.ts');
  const { crearMotor, entradaDeEstado, procesarDocumento } = await import('../tests/medicion/lib/motor.ts');
  const corpus = cargarCorpus(conjunto, carpetaCorpus);
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
  return {
    evaluacion: evaluarVista(vista, producto, soloModelo), conjuntos: corpus.map((d) => d.gold.conjunto), producto,
    golds: Object.fromEntries(corpus.map((d) => [d.docId, d.gold])),
  };
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

// ===================================================================================================================
// PF-3-r1 · experimento de mayúsculas (D-06, decisión 6), solo con el desarrollo (D-01: la reserva no se mira)
// ===================================================================================================================

/** Variantes del experimento y su archivo de caché por vista. La línea base es la caché única de PF-4a y P0-4 (se lee, no se escribe). */
export const VARIANTES_PF3R1: ReadonlyArray<{ id: 'base' | 'a' | 'b' | 'bp' | 'ab' | 'abp'; nombre: string; archivo: string; etiquetas: EtiquetasPasada; preproceso: Preproceso }> = [
  { id: 'base', nombre: 'línea base (etiquetas en inglés, sin preproceso)', archivo: ARCHIVO_VISTAS, etiquetas: 'estandar', preproceso: 'ninguno' },
  { id: 'a', nombre: '(a) etiquetas traducidas', archivo: 'metricas/pf3r1-traducidas.json', etiquetas: 'traducidas', preproceso: 'ninguno' },
  { id: 'b', nombre: '(b) restauración de mayúsculas', archivo: 'metricas/pf3r1-restaurar.json', etiquetas: 'estandar', preproceso: 'restaurar' },
  { id: 'bp', nombre: '(b′) restauración solo de párrafos enteros', archivo: 'metricas/pf3r1-restaurar-parrafos.json', etiquetas: 'estandar', preproceso: 'restaurar-parrafos' },
  { id: 'ab', nombre: '(a)+(b) traducidas con restauración', archivo: 'metricas/pf3r1-traducidas-restaurar.json', etiquetas: 'traducidas', preproceso: 'restaurar' },
  { id: 'abp', nombre: '(a)+(b′) traducidas con restauración de párrafos', archivo: 'metricas/pf3r1-traducidas-restaurar-parrafos.json', etiquetas: 'traducidas', preproceso: 'restaurar-parrafos' },
];
export const ARCHIVO_EXPERIMENTO_PF3R1 = 'metricas/pf3r1-experimento.json';
/** Criterio de la tarjeta PF-3-r1: las seis filas por vista (personas 0,85 y 0,75; organizaciones 0,80 y 0,70) y precisión global >= 0,70. */
export const PRECISION_GLOBAL_MINIMA = 0.7;

export interface FilaExperimento {
  fila: 'PERSONA_FUERA' | 'ORG_FUERA';
  n: number;
  mencion: number;
  entidad: number;
  cumple: boolean;
}
export interface CeldaExperimento {
  variante: string;
  vista: Vista;
  documentos: number;
  /** Modelo solo (sin reglas ni lista), con el piso de PF-3: las cifras de la tarjeta (0,626 y 0,606). */
  soloModelo: { filas: FilaExperimento[]; precisionGlobal: number; tramos: number; verdaderos: number };
  /** Producto (reglas + lista + modelo) con el umbral y la banda de PF-3: las filas de cierre de 10.4.1. */
  producto: { filas: FilaExperimento[]; precisionGlobal: number; detecciones: number };
}
export interface ResumenVariante {
  variante: string;
  nombre: string;
  /** Las seis filas por vista cumplen (producto y modelo solo), con precisión global >= 0,70 en las tres vistas. */
  cumpleFilas: boolean;
  cumplePrecision: boolean;
  /** Vista natural frente a la línea base: diferencia de exhaustividad por mención (fila) y de precisión global; negativa = empeora. */
  natural: { filas: Array<{ fila: string; medida: 'soloModelo' | 'producto'; diferencia: number }>; dPrecisionModelo: number; dPrecisionProducto: number; empeora: boolean };
  gana: boolean;
}
export interface Experimento {
  formato: 'sig-low/experimento-pf3r1';
  v: 1;
  fecha: string;
  conjunto: 'desarrollo';
  advertencia: string;
  umbrales: { nerMinScore: number; nerHighThreshold: number; fuente: string };
  celdas: CeldaExperimento[];
  resumen: ResumenVariante[];
  decision: { ganadora: string | null; motivo: string };
  /** Informativa, no decide: las mismas variantes con el sufijo societario completado (`completarSufijo`), el límite que el producto no cierra. */
  simulacionSufijo?: { informativa: true; descripcion: string; tramosExtendidos: Record<string, number>; celdas: CeldaExperimento[]; resumen: ResumenVariante[] };
}

const filaExp = (c: FilaCierre): FilaExperimento => ({ fila: c.fila, n: c.mencion.n, mencion: c.mencion.valor, entidad: c.entidad.valor, cumple: c.cumple });

/** Celda del experimento a partir de la evaluación de una vista (las filas de cierre) y de las precisiones globales ya calculadas. */
export function celdaExperimento(
  variante: string, vista: Vista, documentos: number, e: EvaluacionVista,
  modelo: { precisionGlobal: number; tramos: number; verdaderos: number }, producto: { precisionGlobal: number; detecciones: number },
): CeldaExperimento {
  return {
    variante, vista, documentos,
    soloModelo: { filas: e.cierreSoloModelo.map(filaExp), ...modelo },
    producto: { filas: e.cierre.map(filaExp), ...producto },
  };
}

/**
 * Resumen y decisión (pura). Una variante gana si, en las tres vistas, las seis filas cumplen con el modelo solo y con el producto, la
 * precisión global no baja de 0,70 y la vista natural no empeora frente a la línea base en ninguna de las dos filas ni en ninguna medida.
 * Entre varias que ganan, la de mayor mínimo de ORG_FUERA en MAYÚSCULAS y minúsculas (producto).
 */
export function resumirExperimento(celdas: readonly CeldaExperimento[], fecha: string, umbrales: Experimento['umbrales']): Experimento {
  const celda = (v: string, vista: Vista): CeldaExperimento | undefined => celdas.find((c) => c.variante === v && c.vista === vista);
  const e = 1e-9;
  const resumen: ResumenVariante[] = [];
  for (const def of VARIANTES_PF3R1) {
    const cs = VISTAS.map((v) => celda(def.id, v));
    if (cs.some((c) => c === undefined)) continue;
    const todas = cs as CeldaExperimento[];
    const cumpleFilas = todas.every((c) => c.soloModelo.filas.length === 2 && c.producto.filas.length === 2 && [...c.soloModelo.filas, ...c.producto.filas].every((f) => f.cumple));
    const cumplePrecision = todas.every((c) => c.soloModelo.precisionGlobal + e >= PRECISION_GLOBAL_MINIMA && c.producto.precisionGlobal + e >= PRECISION_GLOBAL_MINIMA);
    const base = celda('base', 'natural');
    const nat = celda(def.id, 'natural') as CeldaExperimento;
    const filas: ResumenVariante['natural']['filas'] = [];
    for (const medida of ['soloModelo', 'producto'] as const) {
      for (const f of nat[medida].filas) {
        const b = base?.[medida].filas.find((x) => x.fila === f.fila);
        if (b !== undefined) filas.push({ fila: f.fila, medida, diferencia: f.mencion - b.mencion });
      }
    }
    const dPrecisionModelo = base === undefined ? 0 : nat.soloModelo.precisionGlobal - base.soloModelo.precisionGlobal;
    const dPrecisionProducto = base === undefined ? 0 : nat.producto.precisionGlobal - base.producto.precisionGlobal;
    const empeora = def.id !== 'base' && filas.some((f) => f.diferencia < -e);
    resumen.push({ variante: def.id, nombre: def.nombre, cumpleFilas, cumplePrecision, natural: { filas, dPrecisionModelo, dPrecisionProducto, empeora }, gana: def.id !== 'base' && cumpleFilas && cumplePrecision && !empeora });
  }
  const minOrg = (v: string): number => Math.min(...(['mayusculas', 'minusculas'] as const).map((x) => celda(v, x)?.producto.filas.find((f) => f.fila === 'ORG_FUERA')?.mencion ?? 0));
  const ganadoras = resumen.filter((r) => r.gana).sort((p, q) => minOrg(q.variante) - minOrg(p.variante));
  const ganadora = ganadoras[0]?.variante ?? null;
  const motivo = ganadora !== null
    ? `${ganadora} lleva las seis filas por vista a >= 0,85 (personas) y >= 0,80 (organizaciones), con precisión global >= 0,70 y sin empeorar la vista natural`
    : 'ninguna variante lleva las seis filas por vista a >= 0,85 (personas) y >= 0,80 (organizaciones) con precisión global >= 0,70 y sin empeorar la vista natural: no se implementa nada';
  return {
    formato: 'sig-low/experimento-pf3r1', v: 1, fecha, conjunto: 'desarrollo',
    advertencia: 'Solo los documentos de desarrollo (D-01: la reserva no se mira). Cada cifra lleva su n (menciones del corpus ficticio, sintético).',
    umbrales, celdas: [...celdas], resumen, decision: { ganadora, motivo },
  };
}

/**
 * Simulación informativa (no es un cambio del producto): un tramo ORG del modelo que termina justo antes del punto que completa un sufijo
 * societario de R-LST-05 («Banco Ejemplo S.A» + «.») se extiende sobre ese punto. El modelo no puede incluirlo solo cuando R-MOD-01 lo
 * separa como palabra aparte, y el producto (D-03 A) no lo ve porque recorta sobre el texto del tramo. `reSufijoFinal` es R-LST-05
 * anclado al final, sobre la vista plegada. Devuelve una copia de la caché y cuántos tramos se extendieron.
 */
export function completarSufijo(
  cache: CacheVista, textos: Record<string, ParteTexto[]>, reSufijoFinal: RegExp,
): { cache: CacheVista; extendidos: number } {
  const copia = structuredClone(cache);
  let extendidos = 0;
  for (const [id, d] of Object.entries(copia.documentos)) {
    for (const [clave, pc] of Object.entries(d.partes)) {
      const texto = (textos[id] ?? []).find((p) => p.clave === clave)?.texto;
      if (texto === undefined) continue;
      for (const v of pc.ventanas) {
        for (const s of v.spans) {
          if (s.label !== 'ORG' || texto[s.end] !== '.') continue;
          if (reSufijoFinal.test(plegar(`${texto.slice(s.start, s.end)}.`))) { s.end += 1; extendidos++; }
        }
      }
    }
  }
  return { cache: copia, extendidos };
}

/** Tabla de texto del experimento (solo contadores y proporciones). */
export function tablaExperimento(x: Experimento): string {
  const lineas = ['variante  vista        medida      PERSONA_FUERA m / e         ORG_FUERA m / e             precisión global'];
  for (const c of x.celdas) {
    for (const medida of ['soloModelo', 'producto'] as const) {
      const f = (n: string): string => {
        const r = c[medida].filas.find((y) => y.fila === n);
        return r === undefined ? '-'.padEnd(26) : `${r.mencion.toFixed(3)} / ${r.entidad.toFixed(3)} (n ${r.n}) ${r.cumple ? 'sí' : 'NO'}`.padEnd(26);
      };
      lineas.push(`${c.variante.padEnd(8)}  ${c.vista.padEnd(11)}  ${(medida === 'soloModelo' ? 'modelo' : 'producto').padEnd(10)}  ${f('PERSONA_FUERA')}  ${f('ORG_FUERA')}  ${c[medida].precisionGlobal.toFixed(3)}`);
    }
  }
  for (const r of x.resumen) {
    const d = r.natural.filas.map((f) => `${f.fila}/${f.medida === 'soloModelo' ? 'modelo' : 'producto'} ${f.diferencia >= 0 ? '+' : ''}${f.diferencia.toFixed(3)}`).join(', ');
    lineas.push(`${r.variante}: filas ${r.cumpleFilas ? 'cumplen' : 'NO cumplen'}; precisión ${r.cumplePrecision ? '>= 0,70' : '< 0,70'}; natural frente a la base: ${d}; precisión ${r.natural.dPrecisionModelo.toFixed(3)} (modelo) ${r.natural.dPrecisionProducto.toFixed(3)} (producto)${r.natural.empeora ? ' EMPEORA' : ''}${r.gana ? ' -> GANA' : ''}`);
  }
  lineas.push(`decisión: ${x.decision.motivo}`);
  return lineas.join('\n');
}

/** Calcula el experimento con las cachés de las cuatro variantes, solo sobre el desarrollo, y lo guarda. Corre bajo Vitest (motor). */
export async function ejecutarExperimento(raiz: string, a: Map<string, string>): Promise<void> {
  const raizCorpus = resolve(raiz, arg(a, 'corpus', '.'));
  const calibracion = JSON.parse(readFileSync(resolve(raiz, 'metricas/calibracion-umbral.json'), 'utf8')) as { nerMinScore: number; nerHighThreshold: number };
  const umbrales = { nerMinScore: calibracion.nerMinScore, nerHighThreshold: calibracion.nerHighThreshold, fuente: 'metricas/calibracion-umbral.json (PF-3)' };
  const todos = gruposDeCierre('natural').find((g) => g.grupo === 'TODOS') as GrupoDef;
  const { textos } = cargarTextos(raizCorpus);
  const { LST } = await import('../src/core/caselist.ts');
  const reSufijoFinal = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:` + LST.SUFIJO + String.raw`)$`, 'u');
  const celdas: CeldaExperimento[] = [];
  const simuladas: CeldaExperimento[] = [];
  const extendidos: Record<string, number> = {};
  const pedidas = (a.get('variantes') ?? VARIANTES_PF3R1.map((d) => d.id).join(',')).split(',');
  const celdaDe = async (id: string, vista: Vista, cache: CacheVista): Promise<CeldaExperimento> => {
    // `desarrollo` aunque la carpeta traiga el corpus entero: la reserva nunca entra en el experimento (D-01).
    const r = await evaluarVistaDesdeCache(vista, cache, join(raizCorpus, 'corpus'), umbrales, 'desarrollo');
    const ids = Object.keys(r.golds);
    const u = evaluarUmbral(cache, r.golds, umbrales.nerMinScore, ids);
    const prod = calcularFila(todos, r.producto.map((x) => evaluarDocumento(x)));
    return celdaExperimento(id, vista, ids.length, r.evaluacion, { precisionGlobal: u.precisionGlobal, tramos: u.detecciones, verdaderos: u.verdaderas },
      { precisionGlobal: prod.precision, detecciones: prod.detecciones });
  };
  for (const def of VARIANTES_PF3R1.filter((d) => pedidas.includes(d.id))) {
    const ruta = resolve(raiz, def.archivo);
    if (!existsSync(ruta)) { log(`${def.id}: falta ${def.archivo}, se omite`); continue; }
    const archivo = leerArchivoVistas(ruta, 'x-large');
    for (const vista of VISTAS) {
      const cache = archivo.vistas[vista];
      if (cache === undefined) { log(`${def.id} ${vista}: sin caché, se omite`); continue; }
      if (cache.corrida?.conjunto === 'parcial') { log(`${def.id} ${vista}: la pasada no terminó, se omite`); continue; }
      if ((cache.etiquetas ?? 'estandar') !== def.etiquetas || !mismoPreproceso(cache, def.preproceso)) throw new Error(`VARIANTE_DISTINTA ${def.id} ${vista}`);
      celdas.push(await celdaDe(def.id, vista, cache));
      if (!a.has('sin-simulacion')) {
        const s = completarSufijo(cache, textos, reSufijoFinal);
        extendidos[`${def.id}:${vista}`] = s.extendidos;
        simuladas.push(await celdaDe(def.id, vista, s.cache));
      }
    }
  }
  const x = resumirExperimento(celdas, ahora(), umbrales);
  if (simuladas.length > 0) {
    const s = resumirExperimento(simuladas, x.fecha, umbrales);
    x.simulacionSufijo = {
      informativa: true,
      descripcion: 'Informativa, no decide: las mismas cachés con cada tramo ORG del modelo extendido sobre el punto que completa un sufijo '
        + 'societario de R-LST-05 («S.A» + «.»), el límite que la fusión no cierra hoy. La vista natural se compara con la base simulada.',
      tramosExtendidos: extendidos, celdas: s.celdas, resumen: s.resumen,
    };
  }
  escribirJson(resolve(raiz, arg(a, 'salida', ARCHIVO_EXPERIMENTO_PF3R1)), x);
  process.stdout.write(`${tablaExperimento(x)}\n`);
  if (x.simulacionSufijo !== undefined) {
    process.stdout.write(`== simulación informativa: sufijo societario completado (tramos extendidos ${JSON.stringify(x.simulacionSufijo.tramosExtendidos)}) ==\n`);
    const g = resumirExperimento(simuladas, x.fecha, umbrales).decision.ganadora;
    const motivo = `informativa (no decide): con el sufijo completado, ${g === null ? 'ninguna variante cumpliría' : `${g} cumpliría las seis filas sin empeorar la vista natural`}`;
    process.stdout.write(`${tablaExperimento({ ...x, celdas: x.simulacionSufijo.celdas, resumen: x.simulacionSufijo.resumen, decision: { ganadora: g, motivo } })}\n`);
  }
}

/** La orden `evaluar`: el motor de producción se importa sin extensiones, algo que Node no resuelve; se corre bajo Vitest como `npm run medir`. */
function ordenEvaluar(raiz: string, a: Map<string, string>, modo: '1' | 'experimento' = '1'): number {
  const env = { ...process.env, SIGLOW_EVALUAR: modo, SIGLOW_EVALUAR_ARGS: JSON.stringify([...a.entries()]) };
  const r = spawnSync(process.execPath, [join(raiz, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', 'tests/medicion/vitest.config.ts',
    'tests/medicion/evaluacion-modelo.test.ts', '-t', modo === '1' ? 'T-AB-01 evaluar' : 'T-AB-01 experimento'], { cwd: raiz, env, stdio: 'inherit' });
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
    case 'experimento': return ordenEvaluar(raiz, a, 'experimento');
    case 'verificar': await ordenVerificar(raiz, a); return typeof process.exitCode === 'number' ? process.exitCode : 0;
    default:
      process.stderr.write('Uso: node scripts/evaluar-modelo.ts <pasada|verificar|evaluar|experimento> [--opcion=valor]\n');
      return 2;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e: unknown) => {
    process.stderr.write(`evaluar-modelo: ${e instanceof Error ? e.message : 'error'}\n`);
    process.exitCode = 1;
  });
}
