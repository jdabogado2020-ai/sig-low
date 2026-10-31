// Modelo de la pantalla Reinserción (PC-6, 8.2.8, 6.10): lógica pura, sin DOM, para que la prueben las unidades.
// Decide qué se ofrece (alertas una a una), qué tramos del texto reinsertado son datos reales (se resaltan, 8.4.4) y cómo se
// parte ese texto en líneas y trozos con su posición, para atender la copia DESDE EL MODELO y nunca desde el DOM (8.7).
// Todo lo que pasa por aquí es texto [M] (respuesta, valores reales): nada se registra, se guarda ni sale de la pestaña.
import { buildSearchView, toCanonicalSpan } from '../../core/normalize.ts';
import type {
  DocId, MappingTable, MarkerMatch, ReinsertionDecision, ReinsertionInput, ReinsertionResult,
} from '../../core/types.ts';

/** Reinsertar exige un asunto abierto y su tabla en memoria: con la tabla bloqueada (o sin abrir) no hay reinserción (T-RI-10). */
export function reinsercionDisponible(asuntoAbierto: boolean, tabla: MappingTable | null): tabla is MappingTable {
  return asuntoAbierto && tabla !== null;
}

export function entradaDe(respuesta: string, tabla: MappingTable, expectedFrom: DocId | null): ReinsertionInput {
  return { response: respuesta, table: tabla, expectedFrom };
}

/** Valor del `select` de origen → `expectedFrom`: la cadena vacía es «No sé o son varios» (M-93). */
export function origenDe(valor: string, tabla: MappingTable): DocId | null {
  const d = tabla.documents.find((x) => x.docId === valor);
  return d === undefined ? null : d.docId;
}

// ---------------------------------------------------------------------------------------------
// Alertas: qué decisión falta (INV-N02) y cómo se agrupan los alterados
// ---------------------------------------------------------------------------------------------

/** Un `alterado` o `desconocido` sin decisión válida para su clase. Un `desconocido` nunca admite `reemplazar` (INV-N01). */
export function decisionValida(m: MarkerMatch, d: ReinsertionDecision | undefined): boolean {
  if (d === undefined) return false;
  if (d.action === 'dejar') return true;
  if (d.action === 'editar') return typeof d.text === 'string';
  return m.kind !== 'desconocido';
}

export function pendientesDeDecision(matches: readonly MarkerMatch[], decisiones: Readonly<Record<string, ReinsertionDecision>>): MarkerMatch[] {
  return matches.filter((m) => m.kind !== 'exacto' && !decisionValida(m, decisiones[m.id]));
}

export interface GrupoDeMarcador { marcador: string; matches: MarkerMatch[] }

/** Agrupa por marcador canónico, en orden de aparición. «En grupo por marcador», nunca «todos los alterados» (6.10). */
export function agruparPorMarcador(matches: readonly MarkerMatch[]): GrupoDeMarcador[] {
  const grupos = new Map<string, MarkerMatch[]>();
  for (const m of matches) {
    const clave = m.canonical ?? m.found;
    const g = grupos.get(clave);
    if (g === undefined) grupos.set(clave, [m]); else g.push(m);
  }
  return [...grupos].map(([marcador, ms]) => ({ marcador, matches: ms }));
}

// ---------------------------------------------------------------------------------------------
// Tramos de datos reales dentro del texto reinsertado
// ---------------------------------------------------------------------------------------------

export interface Rango { start: number; end: number }

/** Sufijo pegado que se conserva («[DEMANDANTE_1]'s» → «Ana Ficticia Rojas's»); espejo de `suffixOf` de core/reinsert.ts. */
function sufijoPegado(m: MarkerMatch): string {
  if (!m.alterations.includes('sufijo_pegado')) return '';
  return /(?:[\]})»>]|[0-9])((?:'|’)?(?:s|es))$/iu.exec(m.found)?.[1] ?? '';
}

/** Lo que `buildReinsertion` pone en lugar del marcador, o undefined si lo deja como está (espejo de su política, 6.10). */
export function reemplazoDe(tabla: MappingTable, m: MarkerMatch, d: ReinsertionDecision | undefined): { texto: string; real: boolean } | undefined {
  if (d !== undefined && d.action === 'editar') return typeof d.text === 'string' ? { texto: d.text, real: false } : undefined;
  if (m.kind === 'desconocido') return undefined;
  if (m.kind === 'exacto' && d !== undefined && d.action === 'dejar') return undefined;
  if (m.kind === 'alterado' && (d === undefined || d.action !== 'reemplazar')) return undefined;
  if (!m.inTable || m.canonical === undefined || !Object.hasOwn(tabla.entries, m.canonical)) return undefined;
  const display = tabla.entries[m.canonical]?.display;
  if (display === undefined) return undefined;
  return { texto: m.kind === 'alterado' ? display + sufijoPegado(m) : display, real: true };
}

/**
 * Tramos del texto reinsertado que son datos reales (los reemplazos por `display`; un texto escrito por el abogado no es dato real).
 * Recorre los marcadores en orden y comprueba cada tramo contra el texto que construyó el núcleo: si algo no coincide devuelve `null`
 * y la vista se muestra sin resaltar, nunca con un resaltado equivocado.
 */
export function tramosReales(input: ReinsertionInput, resultado: ReinsertionResult): Rango[] | null {
  const ordenados = [...resultado.matches].sort((a, b) => a.start - b.start);
  const texto = resultado.text;
  const reales: Rango[] = [];
  let origen = 0;       // posición en la respuesta
  let destino = 0;      // posición en el texto reinsertado
  for (const m of ordenados) {
    if (m.start < origen || m.end <= m.start || m.end > input.response.length) return null;
    const hueco = input.response.slice(origen, m.start);
    if (texto.slice(destino, destino + hueco.length) !== hueco) return null;
    destino += hueco.length;
    const r = reemplazoDe(input.table, m, resultado.decisions[m.id]);
    const puesto = r === undefined ? m.found : r.texto;
    if (texto.slice(destino, destino + puesto.length) !== puesto) return null;
    if (r !== undefined && r.real && puesto.length > 0) reales.push({ start: destino, end: destino + puesto.length });
    destino += puesto.length;
    origen = m.end;
  }
  const cola = input.response.slice(origen);
  return texto.slice(destino) === cola ? reales : null;
}

// ---------------------------------------------------------------------------------------------
// Búsqueda propia (V-29): sobre el texto en memoria, no sobre el DOM
// ---------------------------------------------------------------------------------------------

export const MINIMO_BUSQUEDA = 2;
export const MAXIMO_COINCIDENCIAS = 2000;

/** Coincidencias de `consulta` en `texto` (sin tildes ni mayúsculas, vista `lista`), en posiciones del texto original. */
export function buscarEnTexto(texto: string, consulta: string): { coincidencias: Rango[]; truncada: boolean } {
  const q = buildSearchView(consulta, 'lista', 'cuerpo').text.trim();
  const salida: Rango[] = [];
  if (q.length < MINIMO_BUSQUEDA || texto === '') return { coincidencias: salida, truncada: false };
  const v = buildSearchView(texto, 'lista', 'cuerpo');
  let desde = 0;
  for (;;) {
    const i = v.text.indexOf(q, desde);
    if (i < 0) break;
    const c = toCanonicalSpan(v, i, i + q.length);
    if (c.end > c.start) salida.push({ start: c.start, end: c.end });
    if (salida.length >= MAXIMO_COINCIDENCIAS) return { coincidencias: salida, truncada: true };
    desde = i + q.length;
  }
  return { coincidencias: salida, truncada: false };
}

// ---------------------------------------------------------------------------------------------
// Vista del texto: líneas y trozos con su posición global
// ---------------------------------------------------------------------------------------------

export interface TrozoVista { g: number; texto: string; real: boolean; buscada: boolean; actual: boolean }
export interface LineaVista { g0: number; trozos: TrozoVista[] }
export interface MarcaBusqueda extends Rango { actual: boolean }

/** ¿Cae la posición `p` dentro de alguno de los rangos ordenados y sin solapes? El puntero avanza solo hacia adelante. */
function dentro(rangos: readonly Rango[], p: number, ptr: { i: number }): Rango | undefined {
  while (ptr.i < rangos.length && (rangos[ptr.i] as Rango).end <= p) ptr.i++;
  const r = rangos[ptr.i];
  return r !== undefined && r.start <= p && p < r.end ? r : undefined;
}

/** Parte `texto` en líneas; cada trozo sabe si es dato real, si es una coincidencia de la búsqueda y si es la actual. */
export function construirLineas(texto: string, reales: readonly Rango[], marcas: readonly MarcaBusqueda[]): LineaVista[] {
  const cortes = new Set<number>([0, texto.length]);
  for (const r of reales) { cortes.add(r.start); cortes.add(r.end); }
  for (const r of marcas) { cortes.add(r.start); cortes.add(r.end); }
  for (let i = texto.indexOf('\n'); i >= 0; i = texto.indexOf('\n', i + 1)) { cortes.add(i); cortes.add(i + 1); }
  const puntos = [...cortes].filter((p) => p >= 0 && p <= texto.length).sort((a, b) => a - b);
  const pr = { i: 0 };
  const pm = { i: 0 };
  const lineas: LineaVista[] = [];
  let actual: LineaVista = { g0: 0, trozos: [] };
  for (let k = 0; k + 1 < puntos.length; k++) {
    const a = puntos[k] as number;
    const b = puntos[k + 1] as number;
    if (b === a) continue;
    const cadena = texto.slice(a, b);
    if (cadena === '\n') { lineas.push(actual); actual = { g0: b, trozos: [] }; continue; }
    const marca = dentro(marcas, a, pm) as MarcaBusqueda | undefined;
    actual.trozos.push({ g: a, texto: cadena, real: dentro(reales, a, pr) !== undefined, buscada: marca !== undefined, actual: marca?.actual === true });
  }
  lineas.push(actual);
  return lineas;
}

/** Subcadena del texto para un rango de posiciones, normalizado (a ≤ b, dentro del texto). */
export function subcadena(texto: string, a: number, b: number): string {
  const desde = Math.max(0, Math.min(a, b));
  const hasta = Math.min(texto.length, Math.max(a, b));
  return desde >= hasta ? '' : texto.slice(desde, hasta);
}
