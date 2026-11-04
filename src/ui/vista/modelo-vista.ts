// F3 (D-24) · Modelo de la vista previa editable: el documento ya anonimizado (`render`) partido en secciones, bloques (párrafos,
// títulos, celdas) y trozos. Cada trozo sabe de qué tramo de `Part.text` viene, así la interfaz lleva un clic sobre una etiqueta a su
// detección (`data-det`) y una selección de texto a un tramo para «Ocultar este texto». Código puro, sin DOM: lo prueban las unidades.
//
// Lo que se muestra es la salida: las etiquetas en lugar de los datos ocultos y el texto que no se reemplazó. Dos marcas más, sobre
// texto que ya está a la vista en la salida (nunca un dato oculto): `revelado` (el revisor pidió mostrar ese dato original) y
// `revisar` (una bandera sin confirmar sobre texto libre, como un cargo). La estructura de un .docx (párrafos, títulos, negritas y
// tablas) llega aparte (`EstructuraParte`, de estructura-docx.ts); sin ella cada línea es un párrafo.
import type { DetectionId, FlagId, Part, PartId, PartKind, RenderedOutput, ReviewState, SpanEditId } from '../../core/types.ts';

export interface Estilo { negrita?: true; cursiva?: true; subrayado?: true }
export type TipoBloque = 'p' | 'titulo1' | 'titulo2' | 'titulo3';
export type Alineacion = 'izquierda' | 'centro' | 'derecha' | 'justificado';

/** Un párrafo de la estructura, en posiciones de `Part.text` ([ini, fin), sin el salto final). */
export interface ParrafoEstructura {
  ini: number; fin: number; tipo: TipoBloque; alinear?: Alineacion;
  /** Celda de tabla: número de tabla en la parte, fila y columna. */
  celda?: { tabla: number; fila: number; col: number };
}
export interface EstructuraParte { parrafos: ParrafoEstructura[]; estilos: Array<{ ini: number; fin: number; estilo: Estilo }> }

export type TipoTrozo = 'texto' | 'etiqueta' | 'revelado' | 'revisar' | 'salto';
export interface Trozo {
  tipo: TipoTrozo;
  /** Texto que se ve (el de la salida). */
  texto: string;
  partId: PartId; ini: number; fin: number;
  det?: DetectionId; edicion?: SpanEditId; flag?: FlagId;
  estilo?: Estilo;
}
export interface Bloque { tipo: TipoBloque; alinear?: Alineacion; celda?: ParrafoEstructura['celda']; trozos: Trozo[] }
export interface SeccionVista { partId: PartId; kind: PartKind; etiqueta: string; bloques: Bloque[] }
export interface Vista { secciones: SeccionVista[]; conTitulos: boolean }

/** Párrafos de una parte sin estructura: uno por línea. */
function lineasDe(texto: string): ParrafoEstructura[] {
  const out: ParrafoEstructura[] = [];
  let i = 0;
  for (const l of texto.split('\n')) { out.push({ ini: i, fin: i + l.length, tipo: 'p' }); i += l.length + 1; }
  return out;
}

/** Cortes dentro de [a, b): bordes de estilo y de las marcas `revelado` y `revisar`. */
function cortes(a: number, b: number, bordes: readonly number[]): number[] {
  const out = [a];
  for (const x of bordes) if (x > a && x < b) out.push(x);
  out.push(b);
  return [...new Set(out)].sort((x, y) => x - y);
}

/**
 * Construye la vista. `estructuras` (opcional) va por id de parte; si falta o no cuadra con el texto de la parte, la parte se muestra
 * por líneas. Un reemplazo que cruza párrafos se muestra en el primero (como lo escribe el .docx fiel).
 */
export function construirVista(out: RenderedOutput, state: ReviewState, partes: readonly Part[],
  estructuras?: ReadonlyMap<PartId, EstructuraParte>): Vista {
  const porId = new Map(partes.map((p) => [p.id, p]));
  const secciones: SeccionVista[] = [];
  for (const sec of out.sections) {
    const parte = porId.get(sec.partId);
    if (parte === undefined) continue;
    const texto = parte.text;
    const est = estructuras?.get(parte.id);
    const parrafos = est !== undefined && est.parrafos.every((p) => p.ini >= 0 && p.fin <= texto.length && p.ini <= p.fin) ? est.parrafos : lineasDe(texto);
    const estilos = est?.estilos ?? [];
    // Marcas sobre texto que sigue a la vista: menciones que el revisor mostró y banderas sin confirmar de texto libre.
    const marcas: Array<{ ini: number; fin: number; tipo: 'revelado' | 'revisar'; det?: DetectionId; flag?: FlagId }> = [];
    for (const d of Object.values(state.detections)) {
      if (d.partId === parte.id && d.status === 'rechazada') marcas.push({ ini: d.start, fin: d.end, tipo: 'revelado', det: d.id });
    }
    for (const f of Object.values(state.flags)) {
      if (f.span.partId !== parte.id || f.acknowledged) continue;
      const oculta = f.detectionId !== undefined && state.detections[f.detectionId]?.status !== 'rechazada';
      if (!oculta) marcas.push({ ini: f.span.start, fin: f.span.end, tipo: 'revisar', flag: f.id });
    }
    const bordes = [...estilos.flatMap((e) => [e.ini, e.fin]), ...marcas.flatMap((m) => [m.ini, m.fin])];
    const segs = [...sec.segments].sort((x, y) => x.partStart - y.partStart);
    const emitidos = new Set<number>();
    const bloques: Bloque[] = parrafos.map((p): Bloque => {
      const trozos: Trozo[] = [];
      segs.forEach((g, k) => {
        if (g.partEnd <= p.ini && !(g.partStart === g.partEnd && g.partStart === p.ini)) return;
        if (g.partStart >= p.fin && !(p.ini === p.fin && g.partStart === p.ini)) return;
        if (g.detectionId !== undefined || g.spanEditId !== undefined) {
          if (emitidos.has(k)) return;
          emitidos.add(k);
          const t: Trozo = { tipo: 'etiqueta', texto: sec.text.slice(g.outStart, g.outEnd), partId: parte.id, ini: g.partStart, fin: g.partEnd };
          if (g.detectionId !== undefined) t.det = g.detectionId;
          if (g.spanEditId !== undefined) t.edicion = g.spanEditId;
          const e = estilos.find((x) => x.ini <= g.partStart && x.fin > g.partStart);
          if (e !== undefined) t.estilo = e.estilo;
          trozos.push(t);
          return;
        }
        const a = Math.max(g.partStart, p.ini);
        const b = Math.min(g.partEnd, p.fin);
        const cs = cortes(a, b, bordes);
        for (let i = 0; i + 1 < cs.length; i++) {
          const x = cs[i] as number;
          const y = cs[i + 1] as number;
          if (y <= x) continue;
          const m = marcas.find((z) => z.ini <= x && z.fin >= y);
          const e = estilos.find((z) => z.ini <= x && z.fin >= y);
          // Un salto de línea dentro del párrafo (w:br) se muestra como salto; el resto, como texto.
          const pedazos = texto.slice(x, y).split('\n');
          let pos = x;
          pedazos.forEach((pedazo, j) => {
            if (j > 0) { trozos.push({ tipo: 'salto', texto: '\n', partId: parte.id, ini: pos, fin: pos + 1 }); pos++; }
            if (pedazo === '') return;
            const t: Trozo = { tipo: m?.tipo ?? 'texto', texto: pedazo, partId: parte.id, ini: pos, fin: pos + pedazo.length };
            if (m?.det !== undefined) t.det = m.det;
            if (m?.flag !== undefined) t.flag = m.flag;
            if (e !== undefined) t.estilo = e.estilo;
            trozos.push(t);
            pos += pedazo.length;
          });
        }
      });
      const b: Bloque = { tipo: p.tipo, trozos };
      if (p.alinear !== undefined) b.alinear = p.alinear;
      if (p.celda !== undefined) b.celda = p.celda;
      return b;
    });
    secciones.push({ partId: parte.id, kind: parte.kind, etiqueta: sec.label, bloques });
  }
  return { secciones, conTitulos: out.withHeadings };
}

/** Grupo de bloques para pintar: un párrafo suelto o una tabla (filas de celdas, cada celda con sus bloques). */
export type Grupo = { tipo: 'bloque'; bloque: Bloque } | { tipo: 'tabla'; filas: Bloque[][][] };

/** Agrupa los bloques consecutivos de una misma tabla. */
export function agrupar(bloques: readonly Bloque[]): Grupo[] {
  const out: Grupo[] = [];
  let tabla: { n: number; filas: Map<number, Map<number, Bloque[]>> } | null = null;
  const cerrar = (): void => {
    if (tabla === null) return;
    const filas = [...tabla.filas.entries()].sort((a, b) => a[0] - b[0])
      .map(([, cols]) => [...cols.entries()].sort((a, b) => a[0] - b[0]).map(([, bs]) => bs));
    out.push({ tipo: 'tabla', filas });
    tabla = null;
  };
  for (const b of bloques) {
    if (b.celda === undefined) { cerrar(); out.push({ tipo: 'bloque', bloque: b }); continue; }
    if (tabla === null || tabla.n !== b.celda.tabla) { cerrar(); tabla = { n: b.celda.tabla, filas: new Map() }; }
    const fila = tabla.filas.get(b.celda.fila) ?? new Map<number, Bloque[]>();
    const celda = fila.get(b.celda.col) ?? [];
    celda.push(b);
    fila.set(b.celda.col, celda);
    tabla.filas.set(b.celda.fila, fila);
  }
  cerrar();
  return out;
}
