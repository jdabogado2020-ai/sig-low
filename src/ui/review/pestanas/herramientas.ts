// Estado propio de la Revisión II (PC-4, 8.2.6): filtros de la lista, búsqueda propia, pestaña activa del panel lateral, petición de
// foco en un elemento de las pestañas y destino de «Ir a la ubicación». Todo vive en memoria y se vacía con el documento (INV-G09).
// El documento y el ReviewState siguen siendo de documento.ts; las acciones se despachan por `despachar()` de review/base/almacen.ts.
import { useEffect, useState } from 'preact/hooks';
import { buildSearchView, toCanonicalSpan } from '../../../core/normalize.ts';
import type { Confidence, Detection, DetectionSource, DetectionStatus, DocumentModel, Part, Span } from '../../../core/types.ts';
import { obtenerDocumento, suscribirDocumento } from '../../documento.ts';
import { registrarLimpieza } from '../../sesion.ts';
import { categoriaDe, type Categoria } from '../base/presentacion.ts';

/** Almacén mínimo con suscripción y hook, para el estado propio de esta pantalla. */
function crearAlmacen<T>(inicial: T): { obtener(): T; poner(parche: Partial<T>): void; reiniciar(): void; usar(): T } {
  let valor = inicial;
  const oyentes = new Set<() => void>();
  const avisar = (): void => { for (const o of [...oyentes]) o(); };
  return {
    obtener: () => valor,
    poner(parche) { valor = { ...valor, ...parche }; avisar(); },
    reiniciar() { valor = inicial; avisar(); },
    usar() {
      const [, forzar] = useState(0);
      useEffect(() => {
        const f = (): void => { forzar((n) => n + 1); };
        oyentes.add(f);
        return () => { oyentes.delete(f); };
      }, []);
      return valor;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Filtros (categoría, estado, confianza y fuente): filtran la lista, el contador cuenta todo
// ---------------------------------------------------------------------------------------------

export interface Filtros {
  categoria: Categoria | '';
  estado: DetectionStatus | '';
  confianza: Confidence | '';
  fuente: DetectionSource | '';
}
const SIN_FILTROS: Filtros = { categoria: '', estado: '', confianza: '', fuente: '' };
const filtros = crearAlmacen<Filtros>(SIN_FILTROS);
export const obtenerFiltros = filtros.obtener;
export const ponerFiltros = filtros.poner;
export const useFiltros = filtros.usar;
export const hayFiltros = (f: Filtros): boolean => f.categoria !== '' || f.estado !== '' || f.confianza !== '' || f.fuente !== '';
export function pasaFiltros(d: Detection, f: Filtros): boolean {
  return (f.categoria === '' || categoriaDe(d.type) === f.categoria)
    && (f.estado === '' || d.status === f.estado)
    && (f.confianza === '' || d.confidence === f.confianza)
    && (f.fuente === '' || d.source === f.fuente);
}

// ---------------------------------------------------------------------------------------------
// Pestaña activa del panel lateral y foco en un elemento de las pestañas
// ---------------------------------------------------------------------------------------------

export type PestanaLateral = 'sugerencias' | 'banderas';
interface Lateral { pestana: PestanaLateral; foco: { tipo: 'sug' | 'ban'; id: string; n: number } | null }
const lateral = crearAlmacen<Lateral>({ pestana: 'sugerencias', foco: null });
export const useLateral = lateral.usar;
export const obtenerLateral = lateral.obtener;
export const elegirPestana = (pestana: PestanaLateral): void => { lateral.poner({ pestana }); };
let peticiones = 0;
/** Abre la pestaña de la bandera o de la sugerencia y pide el foco en su tarjeta. */
export function pedirFocoDeTarjeta(tipo: 'sug' | 'ban', id: string): void {
  lateral.poner({ pestana: tipo === 'sug' ? 'sugerencias' : 'banderas', foco: { tipo, id, n: ++peticiones } });
}
export function consumirFocoDeTarjeta(n: number): void {
  const f = lateral.obtener().foco;
  if (f !== null && f.n === n) lateral.poner({ foco: null });
}

// ---------------------------------------------------------------------------------------------
// Destino del texto: «Ir a la ubicación» y la coincidencia actual de la búsqueda
// ---------------------------------------------------------------------------------------------

interface Destino { span: Span | null; n: number }
const destino = crearAlmacen<Destino>({ span: null, n: 0 });
export const useDestino = destino.usar;
export const obtenerDestino = destino.obtener;
/** Pide al panel de texto que monte, desplace y deje a la vista un tramo (8.8). */
export function irAUbicacion(span: Span): void {
  destino.poner({ span, n: ++peticiones });
}
export function consumirDestino(n: number): void {
  if (destino.obtener().n === n) destino.poner({ span: null });
}

// ---------------------------------------------------------------------------------------------
// Búsqueda propia (8.2.6, 8.7): sobre la vista `lista` (6.1.2) del texto canónico en memoria, nunca sobre el DOM
// ---------------------------------------------------------------------------------------------

export const MINIMO_BUSQUEDA = 2;
export const MAXIMO_COINCIDENCIAS = 2000;
export interface Marca { start: number; end: number; actual: boolean }
interface Busqueda {
  consulta: string;
  coincidencias: readonly Span[];
  indice: number;
  truncada: boolean;
  /** Marcas por parte para el panel de texto (la coincidencia actual lleva `actual`). */
  marcas: ReadonlyMap<string, readonly Marca[]>;
}
const VACIA: Busqueda = { consulta: '', coincidencias: [], indice: -1, truncada: false, marcas: new Map() };
const busqueda = crearAlmacen<Busqueda>(VACIA);
export const useBusqueda = busqueda.usar;
export const obtenerBusqueda = busqueda.obtener;

const vistas = new Map<string, ReturnType<typeof buildSearchView>>();
function vistaDe(p: Part): ReturnType<typeof buildSearchView> {
  const clave = p.id;
  const v = vistas.get(clave);
  if (v !== undefined) return v;
  const nueva = buildSearchView(p.text, 'lista', p.kind);
  vistas.set(clave, nueva);
  return nueva;
}

/** Todas las coincidencias de `consulta` en las partes incluidas, en orden de lectura y en posiciones canónicas. */
export function buscarEn(doc: DocumentModel, consulta: string): { coincidencias: Span[]; truncada: boolean } {
  const q = buildSearchView(consulta, 'lista', 'cuerpo').text.trim();
  const out: Span[] = [];
  if (q.length < MINIMO_BUSQUEDA) return { coincidencias: out, truncada: false };
  const partes = doc.parts.filter((p) => p.included).sort((a, b) => a.order - b.order);
  for (const p of partes) {
    const v = vistaDe(p);
    let desde = 0;
    for (;;) {
      const i = v.text.indexOf(q, desde);
      if (i < 0) break;
      const c = toCanonicalSpan(v, i, i + q.length);
      if (c.end > c.start) out.push({ partId: p.id, start: c.start, end: c.end });
      if (out.length >= MAXIMO_COINCIDENCIAS) return { coincidencias: out, truncada: true };
      desde = i + q.length;
    }
  }
  return { coincidencias: out, truncada: false };
}

function marcasDe(cs: readonly Span[], indice: number): Map<string, Marca[]> {
  const m = new Map<string, Marca[]>();
  cs.forEach((c, i) => {
    const l = m.get(c.partId) ?? [];
    l.push({ start: c.start, end: c.end, actual: i === indice });
    m.set(c.partId, l);
  });
  return m;
}

/** Escribe la consulta: recalcula las coincidencias y deja la primera como actual sin mover el foco. */
export function escribirBusqueda(consulta: string): void {
  const doc = obtenerDocumento();
  if (doc === null) { busqueda.reiniciar(); return; }
  const r = buscarEn(doc, consulta);
  const indice = r.coincidencias.length > 0 ? 0 : -1;
  busqueda.poner({ consulta, coincidencias: r.coincidencias, indice, truncada: r.truncada, marcas: marcasDe(r.coincidencias, indice) });
  if (indice === 0) irAUbicacion(r.coincidencias[0] as Span);
}
/** Va a la coincidencia siguiente (1) o anterior (-1), dando la vuelta; pide al panel de texto que la muestre. */
export function moverBusqueda(direccion: 1 | -1): Span | null {
  const b = busqueda.obtener();
  if (b.coincidencias.length === 0) return null;
  const indice = (b.indice + direccion + b.coincidencias.length) % b.coincidencias.length;
  busqueda.poner({ indice, marcas: marcasDe(b.coincidencias, indice) });
  const span = b.coincidencias[indice] as Span;
  irAUbicacion(span);
  return span;
}
export function limpiarBusqueda(): void {
  busqueda.reiniciar();
}

// Todo se vacía al cambiar o descartar el documento y en el bloqueo (INV-G09).
let docVisto: DocumentModel | null = null;
suscribirDocumento(() => {
  const actual = obtenerDocumento();
  if (actual === docVisto) return;
  docVisto = actual;
  vistas.clear();
  busqueda.reiniciar();
  filtros.reiniciar();
  destino.reiniciar();
  lateral.reiniciar();
});
registrarLimpieza(() => {
  docVisto = null;
  vistas.clear();
  busqueda.reiniciar();
  filtros.reiniciar();
  destino.reiniciar();
  lateral.reiniciar();
});
