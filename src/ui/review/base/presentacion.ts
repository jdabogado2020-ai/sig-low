// Funciones puras de presentación de la Revisión I (PC-3): categoría, abreviatura y nombres de 8.4 y 8.6.4, elementos del
// texto (detecciones, banderas, ediciones de tramo), bloques de 50 líneas (8.8) y contexto de ±40 caracteres.
// Sin DOM. Los textos visibles salen del catálogo (mensajes.ts y textos.ts).
import type { DataType, Detection, DetectionId, DocumentModel, Entity, Flag, Part, PartId, ReviewState, SpanEdit } from '../../../core/types.ts';
import { DATA_TYPES } from '../../../core/types.ts';
import { etiqueta, type MessageId } from '../../mensajes.ts';
import { t } from '../../mensajes.ts';
import { tx } from './textos.ts';

export type Categoria = 'per' | 'org' | 'ide' | 'exp' | 'con' | 'bie' | 'fec' | 'ban';

/** 8.4.2: categoría y abreviatura de cada tipo. Sin paréntesis, la abreviatura es el propio código. */
const TABLA_TIPOS: Readonly<Record<DataType, readonly [Categoria, string]>> = {
  PERSONA: ['per', 'PER'],
  EMPRESA: ['org', 'EMP'], EPS: ['org', 'EPS'], IPS: ['org', 'IPS'], ENTIDAD: ['org', 'ENT'], PROVEEDOR: ['org', 'PRO'],
  CC: ['ide', 'CC'], TI: ['ide', 'TI'], CE: ['ide', 'CE'], PPT: ['ide', 'PPT'], PEP: ['ide', 'PEP'], PASAPORTE: ['ide', 'PAS'],
  NIT: ['ide', 'NIT'], TP: ['ide', 'TP'], DOCUMENTO: ['ide', 'DOC'],
  RADICADO: ['exp', 'RAD'], RADICADO_ADMIN: ['exp', 'RADA'], HC: ['exp', 'HC'], AFILIACION: ['exp', 'AFI'],
  TELEFONO: ['con', 'TEL'], CORREO: ['con', 'COR'], DIRECCION: ['con', 'DIR'], BARRIO: ['con', 'BAR'], MUNICIPIO: ['con', 'MUN'],
  DEPARTAMENTO: ['con', 'DEP'], LUGAR: ['con', 'LUG'],
  PLACA: ['bie', 'PLA'], MATRICULA: ['bie', 'MAT'], CUENTA: ['bie', 'CTA'], TARJETA: ['bie', 'TAR'], VALOR: ['bie', 'VAL'],
  FECHA: ['fec', 'FEC'],
  CARGO: ['ban', 'CAR'], DIAGNOSTICO: ['ban', 'DX'], HECHO_LLAMATIVO: ['ban', 'HEC'], MENOR: ['ban', 'MEN'], CITA_JURISPRUDENCIAL: ['ban', 'CITA'],
};

export const categoriaDe = (tipo: DataType): Categoria => TABLA_TIPOS[tipo][0];
export const abreviaturaDe = (tipo: DataType): string => TABLA_TIPOS[tipo][1];
/** Nombre visible del tipo (8.5.10: M-801 a M-837, en el orden de DATA_TYPES). */
export const nombreDeTipo = (tipo: DataType): string => t(`M-${801 + DATA_TYPES.indexOf(tipo)}` as MessageId);

export const CATEGORIAS: ReadonlyArray<{ id: Categoria; nombre: MessageId | 'M-1783' | 'M-1784' | 'M-1785' | 'M-1786' | 'M-1787' | 'M-1788' | 'M-1789' | 'M-1790'; tipos: readonly DataType[] }> = [
  { id: 'per', nombre: 'M-1783', tipos: ['PERSONA'] },
  { id: 'org', nombre: 'M-1784', tipos: ['EMPRESA', 'EPS', 'IPS', 'ENTIDAD', 'PROVEEDOR'] },
  { id: 'ide', nombre: 'M-1785', tipos: ['CC', 'TI', 'CE', 'PPT', 'PEP', 'PASAPORTE', 'NIT', 'TP', 'DOCUMENTO'] },
  { id: 'exp', nombre: 'M-1786', tipos: ['RADICADO', 'RADICADO_ADMIN', 'HC', 'AFILIACION'] },
  { id: 'con', nombre: 'M-1787', tipos: ['TELEFONO', 'CORREO', 'DIRECCION', 'BARRIO', 'MUNICIPIO', 'DEPARTAMENTO', 'LUGAR'] },
  { id: 'bie', nombre: 'M-1788', tipos: ['PLACA', 'MATRICULA', 'CUENTA', 'TARJETA', 'VALOR'] },
  { id: 'fec', nombre: 'M-1789', tipos: ['FECHA'] },
  { id: 'ban', nombre: 'M-1790', tipos: ['CARGO', 'DIAGNOSTICO', 'HECHO_LLAMATIVO', 'MENOR', 'CITA_JURISPRUDENCIAL'] },
];

/** Tipos que el abogado puede elegir para un reemplazo: todos menos las banderas (TIPO_NO_PERMITIDO). */
export const TIPOS_ELEGIBLES: readonly DataType[] = DATA_TYPES.filter((x) => categoriaDe(x) !== 'ban');
/** TI, CE, PPT y PEP admiten el marcador específico (6.4.4). */
export const TIPOS_CON_MARCADOR_ESPECIFICO: ReadonlySet<string> = new Set(['TI', 'CE', 'PPT', 'PEP']);

const bajas = (s: string): string => s.toLocaleLowerCase('es-CO');
export const estadoEnMinusculas = (d: Detection): string => bajas(etiqueta('estado', d.status));
export const confianzaEnMinusculas = (d: Detection): string => bajas(etiqueta('confianza', d.confidence));

/** Nombre accesible de un resaltado del original (8.6.4). Lleva el texto: es lo que el abogado revisa en su equipo. */
export function nombreDeResaltado(d: Detection, entidad: Entity | undefined): string {
  const tipo = nombreDeTipo(d.type);
  const confianza = confianzaEnMinusculas(d);
  if (d.status === 'aceptada' && entidad?.marker !== undefined) {
    return tx('M-1731', { tipo, marcador: entidad.marker, confianza, texto: d.text });
  }
  if (d.status === 'editada' && d.replacement.edited !== undefined) {
    return tx('M-1738', { tipo, texto: d.replacement.edited, confianza, original: d.text });
  }
  return tx('M-1730', { tipo, estado: estadoEnMinusculas(d), confianza, texto: d.text });
}
export function nombreDeBandera(f: Flag): string {
  return tx('M-1732', { tipo: nombreDeTipo(f.type), estado: tx(f.acknowledged ? 'M-1733' : 'M-1734'), texto: f.text });
}

/** «{n} menciones» / «1 mención»; «{p} pendientes» / «1 pendiente». */
export const textoDeMenciones = (n: number): string => (n === 1 ? tx('M-1712') : tx('M-1713', { n }));
export const textoDePendientes = (n: number): string => (n === 1 ? tx('M-1714') : tx('M-1715', { n }));

export function pendientesDe(state: ReviewState, e: Entity): number {
  let n = 0;
  for (const id of e.mentions) if (state.detections[id]?.status === 'pendiente') n++;
  return n;
}
export function pendientesTotales(state: ReviewState): number {
  let n = 0;
  for (const d of Object.values(state.detections)) if (d.status === 'pendiente') n++;
  return n;
}

/** Nombre de la fila de entidad (8.6.4): «{tipo}, {marcador o sin marcador}, {n} menciones, {p} pendientes». */
export function nombreDeFilaEntidad(state: ReviewState, e: Entity): string {
  return tx('M-1711', {
    tipo: nombreDeTipo(e.type),
    marcador: e.marker ?? t('M-958'),
    menciones: textoDeMenciones(e.mentions.length),
    pendientes: textoDePendientes(pendientesDe(state, e)),
  });
}

/** Contexto de ±40 caracteres de una mención, en una sola línea. */
export function contextoDe(part: Part | undefined, d: Detection): { antes: string; texto: string; despues: string } {
  const plano = (s: string): string => s.replace(/\s+/gu, ' ');
  if (part === undefined) return { antes: '', texto: plano(d.text), despues: '' };
  const a = Math.max(0, d.start - 40);
  const b = Math.min(part.text.length, d.end + 40);
  return {
    antes: (a > 0 ? '…' : '') + plano(part.text.slice(a, d.start)),
    texto: plano(d.text),
    despues: plano(part.text.slice(d.end, b)) + (b < part.text.length ? '…' : ''),
  };
}

// ---------------------------------------------------------------------------------------------
// Elementos del texto
// ---------------------------------------------------------------------------------------------

export type Elemento =
  | { clase: 'det'; start: number; end: number; det: Detection }
  | { clase: 'ban'; start: number; end: number; flag: Flag }
  | { clase: 'edi'; start: number; end: number; edit: SpanEdit };

/**
 * Elementos de una parte sin solapes, en orden de lectura. Las detecciones cubiertas por una edición de tramo no se pintan
 * (6.4.7); una bandera solo se pinta si no pisa una detección ni una edición (la pestaña de banderas la cubre, PC-4).
 */
export function elementosDeParte(state: ReviewState, partId: PartId): Elemento[] {
  const base: Elemento[] = [];
  for (const e of Object.values(state.spanEdits)) if (e.span.partId === partId) base.push({ clase: 'edi', start: e.span.start, end: e.span.end, edit: e });
  for (const id of state.order) {
    const d = state.detections[id];
    if (d !== undefined && d.partId === partId && d.coveredBy === undefined) base.push({ clase: 'det', start: d.start, end: d.end, det: d });
  }
  base.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const out: Elemento[] = [];
  let fin = -1;
  for (const el of base) {
    if (el.start < fin) continue;
    out.push(el);
    fin = el.end;
  }
  const banderas: Elemento[] = [];
  for (const f of Object.values(state.flags)) {
    if (f.span.partId !== partId) continue;
    if (out.some((o) => o.start < f.span.end && f.span.start < o.end)) continue;
    banderas.push({ clase: 'ban', start: f.span.start, end: f.span.end, flag: f });
  }
  return [...out, ...banderas].sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Orden de lectura de los resaltados que son detecciones (para la flecha izquierda y derecha). */
export function ordenDeLectura(state: ReviewState): DetectionId[] {
  return state.order.filter((id) => {
    const d = state.detections[id];
    return d !== undefined && d.coveredBy === undefined;
  });
}

// ---------------------------------------------------------------------------------------------
// Bloques de 50 líneas (8.8)
// ---------------------------------------------------------------------------------------------

export const LINEAS_POR_BLOQUE = 50;
export interface RangoDeBloque { inicio: number; fin: number; lineas: number }

/** Parte el texto en bloques de `tam` líneas. Ningún elemento queda cortado entre dos bloques. */
export function bloquesDeTexto(texto: string, elementos: readonly { start: number; end: number }[], tam = LINEAS_POR_BLOQUE): RangoDeBloque[] {
  if (texto.length === 0) return [{ inicio: 0, fin: 0, lineas: 1 }];
  const bloques: RangoDeBloque[] = [];
  let inicio = 0;
  let lineas = 0;
  let pos = 0;
  const finDeLinea = (desde: number): number => {
    const nl = texto.indexOf('\n', desde);
    return nl === -1 ? texto.length : nl + 1;
  };
  let k = 0;
  while (pos < texto.length) {
    pos = finDeLinea(pos);
    lineas++;
    if (lineas < tam && pos < texto.length) continue;
    // Cierra el bloque en `pos`, ampliándolo si un elemento lo cruza.
    for (;;) {
      while (k < elementos.length && (elementos[k] as { end: number }).end <= pos) k++;
      const cruza = elementos.find((e, i) => i >= k && e.start < pos && e.end > pos);
      if (cruza === undefined) break;
      pos = finDeLinea(Math.max(pos, cruza.end - 1));
    }
    let nl = 0;
    for (let i = inicio; i < pos; i++) if (texto.charCodeAt(i) === 10) nl++;
    bloques.push({ inicio, fin: pos, lineas: Math.max(1, nl + (texto.charCodeAt(pos - 1) === 10 ? 0 : 1)) });
    inicio = pos;
    lineas = 0;
  }
  return bloques;
}

// ---------------------------------------------------------------------------------------------
// Pendientes (siguiente y anterior), en orden de lectura
// ---------------------------------------------------------------------------------------------

/** Siguiente (o anterior) detección `pendiente` respecto de `desde`, en el orden de `state.order`; da la vuelta. */
export function pendienteAdyacente(state: ReviewState, desde: DetectionId | null, direccion: 1 | -1): DetectionId | null {
  const orden = ordenDeLectura(state);
  if (orden.length === 0) return null;
  const i = desde === null ? (direccion === 1 ? -1 : orden.length) : orden.indexOf(desde);
  for (let paso = 1; paso <= orden.length; paso++) {
    const j = (((i + direccion * paso) % orden.length) + orden.length) % orden.length;
    const id = orden[j] as DetectionId;
    if (state.detections[id]?.status === 'pendiente' && id !== desde) return id;
  }
  return null;
}

export function partesIncluidas(doc: DocumentModel): Part[] {
  return doc.parts.filter((p) => p.included).sort((a, b) => a.order - b.order);
}
