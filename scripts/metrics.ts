// Métricas de detección (PG-3a; plan 10.3): exhaustividad, precisión y F2 por grupo, emparejamiento (10.3.2), consistencia,
// colisiones, banderas y sugerencias esperadas, negativos, clasificación de residuos y omisiones (10.3.4), informe JSON
// (`MetricsReport`, 10.3.3) y código de salida. Node 26 con eliminación de tipos: `node scripts/metrics.ts --entrada=<json>`.
//
// Todo lo que calcula es una función pura exportada (T-ME-01). La corrida real (PG-3b) arma las entradas en el navegador
// con el build de medición y las pasa en un JSON; este archivo no lee modelos ni corre el motor. Ningún valor del gold se
// imprime ni se guarda en el informe: solo ids de anotación y conteos (10.3.3).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSearchView } from '../src/core/normalize.ts';
import { FLAG_TYPES } from '../src/core/types.ts';
import type {
  DataType, DetectableType, FlagType, GeneralizationKind, NerLoadResult, PartKind, Role, SuggestionKind,
} from '../src/core/types.ts';

// ===================================================================================================================
// Tipos del gold (10.2.1) y de las entradas de la medición
// ===================================================================================================================

export type CorpusDocId = string;
export type RunConfig = 'sin-modelo' | 'x-large' | 'x-base';
export type RunVista = 'natural' | 'mayusculas' | 'minusculas';

export interface ParteRef { kind: PartKind; index: number; page?: number }
export interface GoldEntity {
  id: string; tipo: DataType; rol?: Role; canonico: string; mismoTitular: string[]; enLista: boolean;
}
export interface GoldAnnotation {
  id: string; docId: CorpusDocId; parte: ParteRef; start: number; end: number; texto: string; tipo: DataType; rol?: Role;
  entidad: string; debe_generalizarse: boolean; generalizacion?: GeneralizationKind; es_negativo_esperado: boolean;
  bandera_esperada?: FlagType; estructura: 'valida' | 'invalida' | 'no_aplica'; enLista: boolean; claseVariante?: string;
  rotulado: boolean; contenidaEn?: string; caracteristicas: string[];
}
export interface GoldDocument {
  docId: CorpusDocId; conjunto: 'desarrollo' | 'reserva'; entidades: GoldEntity[]; anotaciones: GoldAnnotation[];
}

/** Detección tal como la mide el script: `parte` es `claveParte(...)`; `entidad` es el `EntityId` que le dio la fusión. */
export interface DeteccionMedida {
  id: string; parte: string; start: number; end: number; tipo: DetectableType; entidad: string;
}
export interface BanderaMedida { tipo: FlagType; parte: string; start: number; end: number; deteccion?: string }
export interface SugerenciaMedida { kind: SuggestionKind; parte: string; start: number; end: number }

/** Segmento de la salida renderizada (6.9): un tramo sin `detectionId` ni `spanEditId` es texto copiado. */
export interface SegmentoSalida {
  outStart: number; outEnd: number; partStart: number; partEnd: number; detectionId?: string; spanEditId?: string;
}
export interface TramoParte { parte: string; start: number; end: number }
export interface SalidaParte { parte: string; texto: string; segmentos: SegmentoSalida[] }

export interface TiempoDoc {
  docId: CorpusDocId; paginas: number; lecturaMs: number; reglasMs: number; modeloMs: number | null; ventanas: number | null;
  fusionMs: number; totalMs: number;
}

/** Todo lo que la corrida entrega por documento. */
export interface EntradaDocumento {
  gold: GoldDocument;
  detecciones: DeteccionMedida[];
  banderas: BanderaMedida[];
  sugerencias: SugerenciaMedida[];
  paginas: number;
  /** Salida en la primera pasada de residuos, ya revisada con el oráculo y antes de incorporar residuos (10.3.4). */
  salida?: SalidaParte[];
  /**
   * Salida tras el bucle de residuos (PG-3b). Si viene, la clasificación protegida / residuo / omisión (10.3.4) se hace sobre
   * ella; `salida` (primera vuelta) se usa solo para el escáner independiente y la concordancia con `residue.ts`.
   */
  salidaFinal?: SalidaParte[];
  hitsPrimeraVuelta?: number;
  hitsUltimaVuelta?: number;
  /** Posiciones de los hallazgos de `residue.ts` en la primera vuelta (para `concordanciaResidueTs`). */
  hitsResidue?: Array<{ parte: string; start: number; end: number }>;
  tiempos?: TiempoDoc;
}

export interface MetricsRow {
  grupo: string;
  n: number; cubiertas: number;
  exhaustividadMencion: number; exhaustividadTipificada: number;
  entidades: number; exhaustividadEntidadEstricta: number; exhaustividadEntidadLaxa: number;
  detecciones: number; verdaderas: number; falsas: number;
  precision: number; f2: number; coincidenciaExacta: number;
  umbral?: number; omisionesPermitidas?: number; cumple?: boolean;
  /** Ids de anotación (nunca valores) de las menciones de la fila sin cobertura aceptable; alimenta `corpus/brechas.json` (PG-3b). */
  idsNoCubiertas?: string[];
}

/** Grupos de consistencia de 10.4.1: identificadores, lista, fechas y valores, y personas / organizaciones del modelo. */
export type GrupoConsistencia = 'ids' | 'lista' | 'fechas_valores' | 'modelo';
export interface ConsistenciaGrupo { evaluadas: number; consistentes: number }
export interface ConsistenciaPorGrupo extends Record<GrupoConsistencia, ConsistenciaGrupo> {
  /** Colisiones cuyo `Entity` cubre al menos una entidad gold del grupo `modelo` (informativas); el resto son duras. */
  colisionesDelModelo: number;
}
/**
 * Ids de anotación afectados en las cifras que no son filas de exhaustividad (P0-4; 10.4.3 pide «ids de anotación afectados —nunca
 * valores—» en cada brecha): menciones esperadas sin su sugerencia o bandera, negativos con detección, menciones cubiertas de las
 * entidades inconsistentes por grupo y menciones que caen en una `Entity` con colisión (duras y del modelo).
 */
export interface IdsAfectados {
  generalizacion: Record<string, string[]>;
  negativos: string[];
  consistencia: Record<GrupoConsistencia, string[]>;
  colisiones: string[];
  colisionesDelModelo: string[];
}
export const idsAfectadosVacios = (): IdsAfectados => ({
  generalizacion: {}, negativos: [], consistencia: { ids: [], lista: [], fechas_valores: [], modelo: [] }, colisiones: [], colisionesDelModelo: [],
});
export interface MetricsReport {
  formato: 'sig-low/metricas'; v: 1;
  corrida: {
    config: RunConfig; vista: RunVista; hilos: 1 | 4 | 8; conjunto: 'todo' | 'desarrollo' | 'reserva';
    compilacion: string; modelo: NerLoadResult | null; navegador: string;
    equipo: { nucleosLogicos: number; memoriaGB?: number; descripcion: string }; fecha: string;
  };
  filas: MetricsRow[];
  global: { precision: number; f2: number; paginas: number; fpPorPagina: number; maxFpPorPaginaDoc: number };
  consistencia: { evaluadas: number; consistentes: number; colisiones: number; fusiones: number };
  consistenciaPorGrupo?: ConsistenciaPorGrupo;
  negativos: { total: number; conDeteccion: number; citasConRadicado: number; banderasPresentes: number };
  generalizacion: Array<{ tipo: string; esperadas: number; presentes: number }>;
  idsAfectados?: IdsAfectados;
  residuos: {
    antesDelBucle: number; despuesDelBucle: number; omisiones: number;
    porDocumento: Array<{ docId: CorpusDocId; residuos: number; omisiones: number; idsAnotacion: string[] }>;
    concordanciaResidueTs: boolean;
  };
  tiempos: TiempoDoc[];
  veredicto?: { cierra: boolean; incumplidos: string[] };
}

export type CorridaInfo = MetricsReport['corrida'];

// ===================================================================================================================
// Utilidades
// ===================================================================================================================

/** Cociente que da 0 cuando el denominador es 0 (un grupo sin menciones no tiene exhaustividad que informar). */
export function razon(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

/** F2 = 5·P·R / (4·P + R): la exhaustividad pesa 4 veces más que la precisión (10.3.1). 0 si P y R son 0. */
export function f2(precision: number, exhaustividad: number): number {
  const den = 4 * precision + exhaustividad;
  return den === 0 ? 0 : (5 * precision * exhaustividad) / den;
}

/** Omisiones permitidas por un umbral: ⌊(1 − umbral)·n⌋, con tolerancia de redondeo binario. */
export function omisionesPermitidas(umbral: number, n: number): number {
  return Math.floor((1 - umbral) * n + 1e-9);
}

export const claveParte = (p: ParteRef): string => `${p.kind}:${p.index}${p.page === undefined ? '' : `:p${p.page}`}`;

interface Tramo { start: number; end: number }
const largo = (t: Tramo): number => t.end - t.start;
const contiene = (a: Tramo, b: Tramo): boolean => a.start <= b.start && a.end >= b.end;
const interseccion = (a: Tramo, b: Tramo): number => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
const solapa = (a: Tramo, b: Tramo): boolean => interseccion(a, b) > 0;

// DESPACHO_A_GENERICO y EDAD_A_RANGO (D-06, decisión del dueño del 31-oct; nota de 10.3.2) no se protegen con marcador: son
// sugerencias, y cuentan en la fila de banderas y sugerencias, no en la exhaustividad de protección ni en las filas por entidad.
export const esPositiva = (g: GoldAnnotation): boolean =>
  !g.es_negativo_esperado && !(FLAG_TYPES as readonly string[]).includes(g.tipo)
  && g.generalizacion !== 'DESPACHO_A_GENERICO' && g.generalizacion !== 'EDAD_A_RANGO';

// ===================================================================================================================
// Emparejamiento (10.3.2)
// ===================================================================================================================

/** Exacto: mismos límites. */
export const esExacta = (d: Tramo, g: Tramo): boolean => d.start === g.start && d.end === g.end;

/** IoU = |d ∩ g| / |d ∪ g|. */
export function iou(d: Tramo, g: Tramo): number {
  const i = interseccion(d, g);
  const u = largo(d) + largo(g) - i;
  return u <= 0 ? 0 : i / u;
}

/** Solape: IoU ≥ 0,5 (acuerdo entre anotadores y reporte de límites). */
export const esSolape = (d: Tramo, g: Tramo): boolean => iou(d, g) >= 0.5;

/**
 * exceso(d, g) = |d| − |g| − Σ |g'| para g' ∈ G⁺, g' ≠ g, contenidas por completo en d. Dos datos contiguos detectados juntos
 * no cuentan como exceso. Una g' anidada dentro de g ya está en |g| y no se resta otra vez.
 */
export function exceso(d: Tramo, g: Tramo, otrasPositivas: readonly Tramo[]): number {
  let suma = 0;
  for (const o of otrasPositivas) {
    if (o === g || (o.start === g.start && o.end === g.end)) continue;
    if (contiene(d, o) && !contiene(g, o)) suma += largo(o);
  }
  return largo(d) - largo(g) - suma;
}

/** Cobertura aceptable: d.start ≤ g.start, d.end ≥ g.end y exceso(d, g) ≤ max(12, |g|). */
export function coberturaAceptable(d: Tramo, g: Tramo, otrasPositivas: readonly Tramo[]): boolean {
  return d.start <= g.start && d.end >= g.end && exceso(d, g, otrasPositivas) <= Math.max(12, largo(g));
}

/** Verdadera: al menos el 50 % de los caracteres de d caen dentro de tramos de G⁺. */
export function esVerdadera(d: Tramo, positivas: readonly Tramo[]): boolean {
  if (largo(d) <= 0) return false;
  const ordenadas = [...positivas].sort((a, b) => a.start - b.start || a.end - b.end);
  let dentro = 0;
  let hasta = -Infinity;
  for (const p of ordenadas) {
    const ini = Math.max(p.start, d.start, hasta);
    const fin = Math.min(p.end, d.end);
    if (fin > ini) dentro += fin - ini;
    hasta = Math.max(hasta, p.end);
  }
  return dentro * 2 >= largo(d);
}

/** Los seis grupos de tipo de la exhaustividad tipificada (10.3.1). */
export type GrupoTipo = 'personas' | 'organizaciones' | 'identificaciones' | 'contacto' | 'ubicacion' | 'fechas_valores' | 'otros';
export function grupoDeTipo(t: DataType): GrupoTipo {
  switch (t) {
    case 'PERSONA': return 'personas';
    case 'EMPRESA': case 'EPS': case 'IPS': case 'ENTIDAD': case 'PROVEEDOR': return 'organizaciones';
    case 'CC': case 'TI': case 'CE': case 'PPT': case 'PEP': case 'PASAPORTE': case 'NIT': case 'TP': case 'DOCUMENTO':
    case 'RADICADO': case 'RADICADO_ADMIN': case 'PLACA': case 'MATRICULA': case 'CUENTA': case 'TARJETA': case 'HC':
    case 'AFILIACION': return 'identificaciones';
    case 'TELEFONO': case 'CORREO': return 'contacto';
    case 'DIRECCION': case 'BARRIO': case 'MUNICIPIO': case 'DEPARTAMENTO': case 'LUGAR': return 'ubicacion';
    case 'FECHA': case 'VALOR': return 'fechas_valores';
    default: return 'otros';
  }
}

export interface ResultadoMencion {
  g: GoldAnnotation;
  cubierta: boolean;
  exacta: boolean;
  tipificada: boolean;
  /** Detecciones que la cubren (directas, o las de la anotación que la contiene). */
  cubridoras: DeteccionMedida[];
}
export interface ResultadoDeteccion {
  d: DeteccionMedida;
  verdadera: boolean;
  banderaCorrecta: boolean;
  falsa: boolean;
  /** Falsa que solapa un negativo esperado. */
  falsaDeNegativo: boolean;
  /** Anotación positiva con la que más se solapa (para asignarla a grupos); undefined si ninguna. */
  mejorG?: GoldAnnotation;
  /** La detección contiene por completo ≥ 2 positivas disjuntas: «fusión» (rompe la consistencia de marcadores). */
  fusion: boolean;
}
export interface ResultadoEntidad {
  entidad: GoldEntity;
  menciones: number;
  cubiertas: number;
}
export interface EvaluacionDocumento {
  docId: CorpusDocId;
  menciones: ResultadoMencion[];
  detecciones: ResultadoDeteccion[];
  entidades: ResultadoEntidad[];
  paginas: number;
  consistencia: { evaluadas: number; consistentes: number; colisiones: number; fusiones: number };
  consistenciaPorGrupo: ConsistenciaPorGrupo;
  negativos: { total: number; conDeteccion: number; citasConRadicado: number; banderasPresentes: number };
  generalizacion: Array<{ tipo: string; esperadas: number; presentes: number }>;
  idsAfectados: IdsAfectados;
  falsas: number;
}

/** Grupo de consistencia de una entidad gold (10.4.1): lista; fechas y valores; modelo (personas y organizaciones fuera de la lista); resto. */
export function grupoDeConsistencia(e: Pick<GoldEntity, 'tipo' | 'enLista'>): GrupoConsistencia {
  if (e.enLista) return 'lista';
  if (e.tipo === 'FECHA' || e.tipo === 'VALOR') return 'fechas_valores';
  const g = grupoDeTipo(e.tipo);
  return g === 'personas' || g === 'organizaciones' ? 'modelo' : 'ids';
}

const porParte = <T extends { parte: string }>(xs: readonly T[]): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const l = m.get(x.parte);
    if (l === undefined) m.set(x.parte, [x]);
    else l.push(x);
  }
  return m;
};

/** Evalúa un documento: emparejamiento por parte (10.3.2) y todas las métricas que dependen solo de él. */
export function evaluarDocumento(entrada: EntradaDocumento): EvaluacionDocumento {
  const { gold, detecciones, banderas, sugerencias } = entrada;
  const todas = gold.anotaciones;
  const positivas = todas.filter(esPositiva);
  const negativas = todas.filter((g) => g.es_negativo_esperado);
  const gPorId = new Map(todas.map((g) => [g.id, g]));
  const posPorParte = new Map<string, GoldAnnotation[]>();
  for (const g of positivas) {
    const k = claveParte(g.parte);
    const l = posPorParte.get(k);
    if (l === undefined) posPorParte.set(k, [g]);
    else l.push(g);
  }
  const negPorParte = new Map<string, GoldAnnotation[]>();
  for (const g of negativas) {
    const k = claveParte(g.parte);
    const l = negPorParte.get(k);
    if (l === undefined) negPorParte.set(k, [g]);
    else l.push(g);
  }
  const detPorParte = porParte(detecciones);

  // Cobertura directa de cualquier anotación (también las que no son G⁺, que pueden contener a una G⁺).
  const directa = (g: GoldAnnotation): DeteccionMedida[] => {
    const k = claveParte(g.parte);
    const otras = posPorParte.get(k) ?? [];
    return (detPorParte.get(k) ?? []).filter((d) => coberturaAceptable(d, g, otras));
  };
  const memo = new Map<string, DeteccionMedida[]>();
  const cubridorasDe = (g: GoldAnnotation, visitadas: Set<string> = new Set()): DeteccionMedida[] => {
    const previo = memo.get(g.id);
    if (previo !== undefined) return previo;
    if (visitadas.has(g.id)) return [];
    visitadas.add(g.id);
    let r = directa(g);
    if (r.length === 0 && g.contenidaEn !== undefined) {
      const h = gPorId.get(g.contenidaEn);
      if (h !== undefined) r = cubridorasDe(h, visitadas);
    }
    memo.set(g.id, r);
    return r;
  };

  const menciones: ResultadoMencion[] = positivas.map((g) => {
    const cubridoras = cubridorasDe(g);
    const grupo = grupoDeTipo(g.tipo);
    return {
      g,
      cubierta: cubridoras.length > 0,
      exacta: cubridoras.some((d) => esExacta(d, g)),
      tipificada: cubridoras.some((d) => grupoDeTipo(d.tipo) === grupo),
      cubridoras,
    };
  });

  const resDet: ResultadoDeteccion[] = detecciones.map((d) => {
    const pos = posPorParte.get(d.parte) ?? [];
    const neg = negPorParte.get(d.parte) ?? [];
    const verdadera = esVerdadera(d, pos);
    const banderaCorrecta = neg.some((n) => n.bandera_esperada !== undefined && solapa(d, n)
      && banderas.some((f) => f.tipo === n.bandera_esperada && f.deteccion === d.id));
    const falsa = !verdadera && !banderaCorrecta;
    const falsaDeNegativo = falsa && neg.some((n) => solapa(d, n));
    let mejorG: GoldAnnotation | undefined;
    let mejor = 0;
    for (const g of pos) {
      const i = interseccion(d, g);
      if (i > mejor) { mejor = i; mejorG = g; }
    }
    const completas = pos.filter((g) => contiene(d, g));
    const disjuntas = completas.filter((g, i) => completas.every((h, j) => i === j || !contiene(h, g) || (h.start === g.start && h.end === g.end)));
    const dos = disjuntas.length >= 2 && disjuntas.some((a, i) => disjuntas.some((b, j) => j > i && !solapa(a, b)));
    const r: ResultadoDeteccion = { d, verdadera, banderaCorrecta, falsa, falsaDeNegativo, fusion: dos };
    if (mejorG !== undefined) r.mejorG = mejorG;
    return r;
  });

  // Entidades gold con menciones positivas.
  const mencPorEntidad = new Map<string, ResultadoMencion[]>();
  for (const m of menciones) {
    const l = mencPorEntidad.get(m.g.entidad);
    if (l === undefined) mencPorEntidad.set(m.g.entidad, [m]);
    else l.push(m);
  }
  const entidades: ResultadoEntidad[] = [];
  for (const e of gold.entidades) {
    const ms = mencPorEntidad.get(e.id);
    if (ms === undefined || ms.length === 0) continue;
    entidades.push({ entidad: e, menciones: ms.length, cubiertas: ms.filter((m) => m.cubierta).length });
  }

  // Consistencia: entidades gold con ≥ 2 menciones cubiertas cuyas detecciones caen en la misma Entity.
  let evaluadas = 0;
  let consistentes = 0;
  const entGold = new Map(gold.entidades.map((e) => [e.id, e]));
  const porGrupo: ConsistenciaPorGrupo = {
    ids: { evaluadas: 0, consistentes: 0 }, lista: { evaluadas: 0, consistentes: 0 },
    fechas_valores: { evaluadas: 0, consistentes: 0 }, modelo: { evaluadas: 0, consistentes: 0 }, colisionesDelModelo: 0,
  };
  const grupoDe = (id: string): GrupoConsistencia => {
    const e = entGold.get(id);
    return e === undefined ? 'ids' : grupoDeConsistencia(e);
  };
  const idsAfectados = idsAfectadosVacios();
  for (const [idEnt, ms] of mencPorEntidad) {
    const cubiertas = ms.filter((m) => m.cubierta);
    if (cubiertas.length < 2) continue;
    evaluadas++;
    const ents = new Set(cubiertas.map((m) => (m.cubridoras[0] as DeteccionMedida).entidad));
    const gr = porGrupo[grupoDe(idEnt)];
    gr.evaluadas++;
    if (ents.size === 1) { consistentes++; gr.consistentes++; } else idsAfectados.consistencia[grupoDe(idEnt)].push(...cubiertas.map((m) => m.g.id));
  }
  // Colisiones: Entity cuyas detecciones cubren ≥ 2 entidades gold.
  const goldPorEntity = new Map<string, Set<string>>();
  const mencionesPorEntity = new Map<string, Set<string>>();
  for (const m of menciones) {
    for (const d of m.cubridoras) {
      const s = goldPorEntity.get(d.entidad);
      if (s === undefined) goldPorEntity.set(d.entidad, new Set([m.g.entidad]));
      else s.add(m.g.entidad);
      const ids = mencionesPorEntity.get(d.entidad);
      if (ids === undefined) mencionesPorEntity.set(d.entidad, new Set([m.g.id]));
      else ids.add(m.g.id);
    }
  }
  let colisiones = 0;
  for (const [entity, s] of goldPorEntity) {
    if (s.size < 2) continue;
    colisiones++;
    const delModelo = [...s].some((id) => grupoDe(id) === 'modelo');
    if (delModelo) porGrupo.colisionesDelModelo++;
    (delModelo ? idsAfectados.colisionesDelModelo : idsAfectados.colisiones).push(...(mencionesPorEntity.get(entity) ?? []));
  }
  const fusiones = resDet.filter((r) => r.fusion).length;

  // Negativos y citas con radicado.
  let conDeteccion = 0;
  let citas = 0;
  let citasConBandera = 0;
  let sinBanderaEsperada = 0;
  for (const n of negativas) {
    const k = claveParte(n.parte);
    const dets = (detPorParte.get(k) ?? []).filter((d) => solapa(d, n));
    if (n.bandera_esperada === undefined) {
      sinBanderaEsperada++;
      if (dets.length > 0) { conDeteccion++; idsAfectados.negativos.push(n.id); }
    }
    if (n.bandera_esperada === 'CITA_JURISPRUDENCIAL') {
      citas++;
      if (banderas.some((f) => f.tipo === 'CITA_JURISPRUDENCIAL' && f.parte === k && solapa(f, n))) citasConBandera++;
    }
  }

  // Banderas y sugerencias esperadas, por tipo esperado.
  const esperadas = new Map<string, { esperadas: number; presentes: number }>();
  const contar = (clave: string, presente: boolean, id: string): void => {
    const e = esperadas.get(clave) ?? { esperadas: 0, presentes: 0 };
    e.esperadas++;
    if (presente) e.presentes++;
    else (idsAfectados.generalizacion[clave] ??= []).push(id);
    esperadas.set(clave, e);
  };
  for (const g of todas) {
    const k = claveParte(g.parte);
    // AJ-4 (D-12): las citas se cuentan en `negativos`. Una anotación positiva que lleva `bandera_esperada` (CARGO, DIAGNOSTICO, MENOR,
    // HECHO_LLAMATIVO: 199 en el gold, una desviación de 10.2.3 que el escáner tolera sin tocar el gold, S-10.4) SÍ se cuenta; antes se
    // saltaba y la fila de banderas nunca midió CARGO ni DIAGNOSTICO.
    if (g.bandera_esperada === 'CITA_JURISPRUDENCIAL' || !g.debe_generalizarse) continue;
    const esFlag = (FLAG_TYPES as readonly string[]).includes(g.tipo);
    if (esFlag) {
      // AJ-2 (D-06, 10.3.2): la edad de un menor lleva el tipo `MENOR` (RG-r1) y `generalizacion: 'EDAD_A_RANGO'`, y «se mide con la
      // sugerencia presente». G-06 crea las dos cosas, pero S-7.8 deja como máximo una bandera `MENOR` por oración (la primera): en
      // «la menor, … nació el … y hoy tiene 13 años de edad» la primera es «la menor», y la bandera de la edad no puede existir. Se cuenta
      // presente si hay la bandera `MENOR` sobre la mención o la sugerencia `EDAD_A_RANGO`; la bandera, cuando la hay, sigue valiendo.
      const banderaPresente = banderas.some((f) => f.tipo === g.tipo && f.parte === k && solapa(f, g));
      const edadDeMenor = g.tipo === 'MENOR' && g.generalizacion === 'EDAD_A_RANGO';
      contar(g.tipo, banderaPresente || (edadDeMenor && sugerencias.some((s) => s.kind === 'EDAD_A_RANGO' && s.parte === k && solapa(s, g))), g.id);
    } else if (g.generalizacion !== undefined) {
      const kind = g.generalizacion;
      contar(kind, sugerencias.some((s) => s.kind === kind && s.parte === k && solapa(s, g))
        || banderas.some((f) => f.parte === k && solapa(f, g) && `${f.tipo}_A_GENERICO` === kind), g.id);
    } else {
      contar(g.tipo, false, g.id);
    }
  }

  return {
    docId: gold.docId,
    menciones,
    detecciones: resDet,
    entidades,
    paginas: entrada.paginas,
    consistencia: { evaluadas, consistentes, colisiones, fusiones },
    consistenciaPorGrupo: porGrupo,
    negativos: { total: sinBanderaEsperada, conDeteccion, citasConRadicado: citas, banderasPresentes: citasConBandera },
    generalizacion: [...esperadas.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([tipo, v]) => ({ tipo, ...v })),
    idsAfectados,
    falsas: resDet.filter((r) => r.falsa).length,
  };
}

// ===================================================================================================================
// Filas por grupo (10.3.3 y 10.4.1)
// ===================================================================================================================

export interface GrupoDef {
  grupo: string;
  /** Tipos gold (exhaustividad) y tipos detectados (precisión) que entran en la fila. */
  tipos: readonly DataType[];
  /** Filtro adicional sobre la anotación gold (lista, fuera de la lista, rotulado…). */
  donde?: (g: GoldAnnotation) => boolean;
}

const ORGS: readonly DataType[] = ['EMPRESA', 'EPS', 'IPS', 'ENTIDAD', 'PROVEEDOR'];
const IDS_ROTULADOS: readonly DataType[] = ['TI', 'CE', 'PPT', 'PEP', 'PASAPORTE', 'TP', 'DOCUMENTO', 'RADICADO_ADMIN', 'PLACA',
  'MATRICULA', 'CUENTA', 'TARJETA', 'HC', 'AFILIACION'];
const TODOS_TIPOS: readonly DataType[] = ['PERSONA', ...ORGS, 'CC', 'NIT', 'RADICADO', 'TELEFONO', 'CORREO', ...IDS_ROTULADOS,
  'DIRECCION', 'BARRIO', 'FECHA', 'VALOR', 'MUNICIPIO', 'DEPARTAMENTO', 'LUGAR'];

/**
 * Filas de 10.4.1 que alimentan el veredicto (el veredicto es de PG-3b). Por vista, `PERSONA_FUERA` y `ORG_FUERA` salen también
 * con el sufijo `@<vista>`: cada corrida mide una sola vista, y T-UA-01 junta las tres corridas.
 */
export function gruposDeCierre(vista: RunVista): GrupoDef[] {
  const fuera = (g: GoldAnnotation): boolean => !g.enLista;
  const lista = (g: GoldAnnotation): boolean => g.enLista;
  const base: GrupoDef[] = [
    ...(['CC', 'NIT', 'RADICADO', 'TELEFONO', 'CORREO'] as const).map((t) => ({ grupo: t, tipos: [t] as readonly DataType[] })),
    { grupo: 'IDS_ROTULADOS', tipos: IDS_ROTULADOS },
    ...IDS_ROTULADOS.map((t) => ({ grupo: t, tipos: [t] as readonly DataType[] })),
    { grupo: 'IDS_ROTULADOS_CON_ROTULO', tipos: IDS_ROTULADOS, donde: (g) => g.rotulado },
    { grupo: 'LISTA', tipos: ['PERSONA', ...ORGS], donde: lista },
    { grupo: 'LISTA_CLASES_FUERTES', tipos: ['PERSONA', ...ORGS],
      donde: (g) => g.enLista && (g.claseVariante === 'exacta' || g.claseVariante === 'sin_tildes' || g.claseVariante === 'mayusculas') },
    { grupo: 'PERSONA_FUERA', tipos: ['PERSONA'], donde: fuera },
    { grupo: 'ORG_FUERA', tipos: ORGS, donde: fuera },
    { grupo: `PERSONA_FUERA@${vista}`, tipos: ['PERSONA'], donde: fuera },
    { grupo: `ORG_FUERA@${vista}`, tipos: ORGS, donde: fuera },
    { grupo: 'DIRECCIONES', tipos: ['DIRECCION', 'BARRIO'] },
    { grupo: 'FECHA', tipos: ['FECHA'] },
    { grupo: 'VALOR', tipos: ['VALOR'] },
    { grupo: 'MUNICIPIO', tipos: ['MUNICIPIO'] },
    { grupo: 'TODOS', tipos: TODOS_TIPOS },
  ];
  return base;
}

/**
 * Calcula una fila. Gold: menciones positivas con tipo del grupo y que cumplan `donde`. Detecciones: las de tipo detectado en el
 * grupo; si el grupo filtra por anotación, una verdadera cuenta solo si su mejor anotación cumple `donde`, y una falsa cuenta
 * siempre (no tiene anotación a la que asignarla).
 */
export function calcularFila(def: GrupoDef, evals: readonly EvaluacionDocumento[]): MetricsRow {
  const tipos = new Set<DataType>(def.tipos);
  const donde = def.donde ?? ((): boolean => true);
  const ms = evals.flatMap((e) => e.menciones).filter((m) => tipos.has(m.g.tipo) && donde(m.g));
  const cubiertas = ms.filter((m) => m.cubierta);
  const dets = evals.flatMap((e) => e.detecciones).filter((r) => tipos.has(r.d.tipo)
    && (r.mejorG === undefined || !r.verdadera || donde(r.mejorG)));
  const verdaderas = dets.filter((r) => r.verdadera).length;
  const falsas = dets.filter((r) => r.falsa).length;
  const ents = evals.flatMap((e) => e.entidades).filter((r) => tipos.has(r.entidad.tipo)
    && (def.donde === undefined || ms.some((m) => m.g.entidad === r.entidad.id)));
  const precision = razon(verdaderas, verdaderas + falsas);
  const exhaustividadMencion = razon(cubiertas.length, ms.length);
  return {
    grupo: def.grupo,
    n: ms.length,
    cubiertas: cubiertas.length,
    exhaustividadMencion,
    exhaustividadTipificada: razon(ms.filter((m) => m.tipificada).length, ms.length),
    entidades: ents.length,
    exhaustividadEntidadEstricta: razon(ents.filter((e) => e.cubiertas === e.menciones).length, ents.length),
    exhaustividadEntidadLaxa: razon(ents.filter((e) => e.cubiertas >= 1).length, ents.length),
    detecciones: dets.length,
    verdaderas,
    falsas,
    precision,
    f2: f2(precision, exhaustividadMencion),
    coincidenciaExacta: razon(cubiertas.filter((m) => m.exacta).length, cubiertas.length),
    idsNoCubiertas: ms.filter((m) => !m.cubierta).map((m) => m.g.id),
  };
}

// ===================================================================================================================
// Residuos y omisiones (10.3.4)
// ===================================================================================================================

export type ClaseMencion = 'protegida' | 'residuo' | 'omision';

/** Caracteres de [start, end) de la parte que quedaron copiados: caen en un segmento sin `detectionId` ni `spanEditId`. */
export function caracteresCopiados(segmentos: readonly SegmentoSalida[], start: number, end: number): number {
  let n = 0;
  for (const s of segmentos) {
    if (s.detectionId !== undefined || s.spanEditId !== undefined) continue;
    n += interseccion({ start: s.partStart, end: s.partEnd }, { start, end });
  }
  return n;
}

export interface ResultadoResiduo {
  g: GoldAnnotation;
  clase: ClaseMencion;
  copiados: number;
}

/**
 * Clasifica cada mención gold positiva tras la revisión (10.3.4). **Protegida**: ningún carácter copiado. **Residuo**: algún
 * carácter copiado y el motor conocía el dato: la entidad está en la lista del caso, tiene otra mención tocada (≥ 1 carácter
 * fuera de lo copiado), un `mismoTitular` tocado, o la propia mención quedó tocada a medias (límites cortos). **Omisión**:
 * algún carácter copiado y el motor nunca conoció el dato.
 */
export function clasificarMenciones(gold: GoldDocument, salida: readonly SalidaParte[]): ResultadoResiduo[] {
  const segs = new Map(salida.map((s) => [s.parte, s.segmentos]));
  const positivas = gold.anotaciones.filter(esPositiva);
  const medida = positivas.map((g) => {
    const s = segs.get(claveParte(g.parte)) ?? [];
    return { g, copiados: caracteresCopiados(s, g.start, g.end) };
  });
  const tocada = (m: { g: GoldAnnotation; copiados: number }): boolean => m.copiados < largo(m.g);
  const tocadaPorEntidad = new Set<string>();
  for (const m of medida) if (tocada(m)) tocadaPorEntidad.add(m.g.entidad);
  const entPorId = new Map(gold.entidades.map((e) => [e.id, e]));
  const conocida = (id: string): boolean => {
    if (tocadaPorEntidad.has(id)) return true;
    const e = entPorId.get(id);
    if (e === undefined) return false;
    if (e.enLista) return true;
    return e.mismoTitular.some((o) => tocadaPorEntidad.has(o));
  };
  return medida.map((m) => {
    if (m.copiados === 0) return { g: m.g, clase: 'protegida', copiados: 0 };
    return { g: m.g, clase: conocida(m.g.entidad) ? 'residuo' : 'omision', copiados: m.copiados };
  });
}

export interface HallazgoEscaner { parte: string; start: number; end: number; forma: 'literal' | 'lista' | 'digitos' }

/**
 * Escáner independiente de residuos (no es `residue.ts`): busca en el texto de salida cada valor dado en tres formas: literal,
 * vista `lista` y solo dígitos (rachas numéricas de ≥ 5 dígitos, con a lo sumo un separador entre dígitos). Un hallazgo literal o de
 * vista `lista` no puede ir pegado a otra letra o dígito, y uno de una sola palabra exige mayúscula inicial (solo con `estricto`,
 * que usa el informe; sin él el escáner busca la subcadena pura). Devuelve posiciones en el texto de salida. Los valores son los textos
 * gold de las entidades con ≥ 1 mención reemplazada; este módulo no los guarda ni los imprime.
 */
export function escanearResiduos(
  parte: string, textoSalida: string, valores: readonly string[], kind: PartKind = 'cuerpo', estricto = false,
): HallazgoEscaner[] {
  const out: HallazgoEscaner[] = [];
  const vistaSalida = buildSearchView(textoSalida, 'lista', kind);
  const vistos = new Set<string>();
  const poner = (h: HallazgoEscaner): void => {
    const k = `${h.parte}|${h.start}|${h.end}|${h.forma}`;
    if (!vistos.has(k)) { vistos.add(k); out.push(h); }
  };
  const alfanum = /[\p{L}\p{N}]/u;
  /** Letra o dígito pegado al tramo (por la izquierda o la derecha): es parte de otra palabra y no un residuo. */
  const pegado = (t: string, ini: number, fin: number): boolean => estricto && ((ini > 0 && alfanum.test(t.charAt(ini - 1))) || (fin < t.length && alfanum.test(t.charAt(fin))));
  // Rachas numéricas: dígitos con, a lo sumo, un separador (espacio, punto o guion) entre dos dígitos. Una racha entera es un número.
  const rachas: Array<{ d: string; ini: number; fin: number }> = [];
  for (const m of textoSalida.matchAll(/(?<![0-9])[0-9](?:[ .-]?[0-9])*/gu)) {
    rachas.push({ d: m[0].replace(/\D/gu, ''), ini: m.index, fin: m.index + m[0].length });
  }
  for (const v of valores) {
    if (v.length === 0) continue;
    const unaPalabra = !/\s/u.test(v.trim());
    // Un valor de una sola palabra exige mayúscula inicial en la salida (un nombre común no es un residuo); misma regla que 7.13.3.
    const mayuscula = (t: string, ini: number): boolean => !estricto || !unaPalabra || /^\p{Lu}/u.test(t.slice(ini).replace(/^[^\p{L}]+/u, ''));
    for (let i = textoSalida.indexOf(v); i >= 0; i = textoSalida.indexOf(v, i + 1)) {
      if (!pegado(textoSalida, i, i + v.length) && mayuscula(textoSalida, i)) poner({ parte, start: i, end: i + v.length, forma: 'literal' });
    }
    const vl = buildSearchView(v, 'lista', kind).text;
    if (vl.length > 0) {
      for (let i = vistaSalida.text.indexOf(vl); i >= 0; i = vistaSalida.text.indexOf(vl, i + 1)) {
        const ini = vistaSalida.startMap[i];
        const fin = vistaSalida.endMap[i + vl.length - 1];
        if (ini !== undefined && fin !== undefined && !pegado(textoSalida, ini, fin) && mayuscula(textoSalida, ini)) {
          poner({ parte, start: ini, end: fin, forma: 'lista' });
        }
      }
    }
    const dv = v.replace(/\D/gu, '');
    if (dv.length >= 5) {
      for (const r of rachas) if (r.d === dv) poner({ parte, start: r.ini, end: r.fin, forma: 'digitos' });
    }
  }
  return out;
}

/**
 * `concordanciaResidueTs`: todo lo que halló el escáner en la primera vuelta lo vio también `residue.ts`: algún hallazgo suyo en la
 * misma parte se solapa con el del escáner (los dos pueden diferir en los bordes: separadores, DV pegado, artículos).
 */
export function concordancia(
  escaner: readonly TramoParte[],
  residue: readonly TramoParte[],
): boolean {
  return escaner.every((h) => residue.some((r) => r.parte === h.parte && Math.min(r.end, h.end) > Math.max(r.start, h.start)));
}

// ===================================================================================================================
// Informe (10.3.3)
// ===================================================================================================================

export function construirInforme(
  entradas: readonly EntradaDocumento[], corrida: CorridaInfo, opciones: { escanerEstricto?: boolean } = {},
): MetricsReport {
  const evals = entradas.map(evaluarDocumento);
  const filas = gruposDeCierre(corrida.vista).map((def) => calcularFila(def, evals));
  const todas = calcularFila({ grupo: 'TODOS', tipos: TODOS_TIPOS }, evals);
  const paginas = evals.reduce((s, e) => s + e.paginas, 0);
  const falsasTotal = evals.reduce((s, e) => s + e.falsas, 0);
  const maxFpDoc = evals.reduce((m, e) => Math.max(m, e.paginas > 0 ? e.falsas / e.paginas : 0), 0);
  const suma = <K extends keyof EvaluacionDocumento['consistencia']>(k: K): number => evals.reduce((s, e) => s + e.consistencia[k], 0);
  const sumaNeg = <K extends keyof EvaluacionDocumento['negativos']>(k: K): number => evals.reduce((s, e) => s + e.negativos[k], 0);
  const grupos: ConsistenciaPorGrupo = {
    ids: { evaluadas: 0, consistentes: 0 }, lista: { evaluadas: 0, consistentes: 0 },
    fechas_valores: { evaluadas: 0, consistentes: 0 }, modelo: { evaluadas: 0, consistentes: 0 }, colisionesDelModelo: 0,
  };
  for (const e of evals) {
    for (const k of ['ids', 'lista', 'fechas_valores', 'modelo'] as const) {
      grupos[k].evaluadas += e.consistenciaPorGrupo[k].evaluadas;
      grupos[k].consistentes += e.consistenciaPorGrupo[k].consistentes;
    }
    grupos.colisionesDelModelo += e.consistenciaPorGrupo.colisionesDelModelo;
  }
  const gen = new Map<string, { esperadas: number; presentes: number }>();
  for (const e of evals) {
    for (const x of e.generalizacion) {
      const v = gen.get(x.tipo) ?? { esperadas: 0, presentes: 0 };
      v.esperadas += x.esperadas;
      v.presentes += x.presentes;
      gen.set(x.tipo, v);
    }
  }
  const afectados = idsAfectadosVacios();
  for (const e of evals) {
    for (const [k, l] of Object.entries(e.idsAfectados.generalizacion)) (afectados.generalizacion[k] ??= []).push(...l);
    afectados.negativos.push(...e.idsAfectados.negativos);
    for (const k of ['ids', 'lista', 'fechas_valores', 'modelo'] as const) afectados.consistencia[k].push(...e.idsAfectados.consistencia[k]);
    afectados.colisiones.push(...e.idsAfectados.colisiones);
    afectados.colisionesDelModelo.push(...e.idsAfectados.colisionesDelModelo);
  }

  let antes = 0;
  let despues = 0;
  let omisionesTotal = 0;
  const porDocumento: MetricsReport['residuos']['porDocumento'] = [];
  const escaneres: HallazgoEscaner[] = [];
  const residue: Array<{ parte: string; start: number; end: number }> = [];
  for (const en of entradas) {
    antes += en.hitsPrimeraVuelta ?? 0;
    despues += en.hitsUltimaVuelta ?? 0;
    residue.push(...(en.hitsResidue ?? []));
    if (en.salida === undefined) continue;
    const primera = clasificarMenciones(en.gold, en.salida);
    // Residuos y omisiones se cuentan tras el bucle (`salidaFinal`); sin ella, sobre la salida entregada.
    const clases = en.salidaFinal === undefined ? primera : clasificarMenciones(en.gold, en.salidaFinal);
    const res = clases.filter((c) => c.clase === 'residuo');
    const omi = clases.filter((c) => c.clase === 'omision');
    omisionesTotal += omi.length;
    porDocumento.push({ docId: en.gold.docId, residuos: res.length, omisiones: omi.length, idsAnotacion: [...res, ...omi].map((c) => c.g.id) });
    // El escáner busca el texto gold de las entidades con ≥ 1 mención reemplazada; solo para comparar posiciones.
    const tocadas = new Set(primera.filter((c) => c.copiados < c.g.end - c.g.start).map((c) => c.g.entidad));
    for (const s of en.salida) {
      const valores = en.gold.anotaciones.filter((g) => esPositiva(g) && tocadas.has(g.entidad)).map((g) => g.texto);
      escaneres.push(...escanearResiduos(s.parte, s.texto, [...new Set(valores)], 'cuerpo', opciones.escanerEstricto === true));
    }
  }

  return {
    formato: 'sig-low/metricas', v: 1,
    corrida,
    filas,
    global: {
      precision: todas.precision, f2: todas.f2, paginas, fpPorPagina: razon(falsasTotal, paginas), maxFpPorPaginaDoc: maxFpDoc,
    },
    consistencia: { evaluadas: suma('evaluadas'), consistentes: suma('consistentes'), colisiones: suma('colisiones'), fusiones: suma('fusiones') },
    consistenciaPorGrupo: grupos,
    negativos: { total: sumaNeg('total'), conDeteccion: sumaNeg('conDeteccion'), citasConRadicado: sumaNeg('citasConRadicado'), banderasPresentes: sumaNeg('banderasPresentes') },
    generalizacion: [...gen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([tipo, v]) => ({ tipo, ...v })),
    idsAfectados: afectados,
    residuos: {
      antesDelBucle: antes, despuesDelBucle: despues, omisiones: omisionesTotal, porDocumento,
      concordanciaResidueTs: concordancia(escaneres, residue),
    },
    tiempos: entradas.flatMap((e) => (e.tiempos === undefined ? [] : [e.tiempos])),
  };
}

/**
 * Código de salida del script: 0 si el informe se calculó y no trae un veredicto que incumpla; 1 si `veredicto.cierra` es falso
 * o el bucle de residuos no terminó en 0 hallazgos o `residue.ts` no concordó con el escáner; 2 (uso o entrada inválidos) lo
 * decide `main`.
 */
export function codigoDeSalida(r: MetricsReport): 0 | 1 {
  if (r.veredicto !== undefined && !r.veredicto.cierra) return 1;
  if (r.residuos.despuesDelBucle > 0) return 1;
  if (!r.residuos.concordanciaResidueTs) return 1;
  return 0;
}

const pct = (x: number): string => x.toFixed(3);

/** Tabla para la terminal. Solo grupos, conteos y razones; ningún valor del gold. */
export function tablaTexto(r: MetricsReport): string {
  const l: string[] = [];
  l.push(`Corrida ${r.corrida.config} · vista ${r.corrida.vista} · ${r.corrida.hilos} h · ${r.corrida.conjunto}`);
  l.push('grupo                      n   cub  mención  tipif.  ent.estr ent.laxa  det  verd falsa  prec   F2   exacta');
  for (const f of r.filas) {
    if (f.n === 0 && f.detecciones === 0) continue;
    l.push([
      f.grupo.padEnd(24), String(f.n).padStart(5), String(f.cubiertas).padStart(5), pct(f.exhaustividadMencion).padStart(8),
      pct(f.exhaustividadTipificada).padStart(7), pct(f.exhaustividadEntidadEstricta).padStart(8), pct(f.exhaustividadEntidadLaxa).padStart(8),
      String(f.detecciones).padStart(5), String(f.verdaderas).padStart(5), String(f.falsas).padStart(5), pct(f.precision).padStart(6),
      pct(f.f2).padStart(6), pct(f.coincidenciaExacta).padStart(7),
    ].join(' '));
  }
  l.push(`global: precisión ${pct(r.global.precision)} · F2 ${pct(r.global.f2)} · FP/página ${r.global.fpPorPagina.toFixed(2)} (máx. por documento ${r.global.maxFpPorPaginaDoc.toFixed(2)}) · ${r.global.paginas} páginas`);
  l.push(`consistencia: ${r.consistencia.consistentes}/${r.consistencia.evaluadas} · colisiones ${r.consistencia.colisiones} · fusiones ${r.consistencia.fusiones}`);
  l.push(`negativos: ${r.negativos.conDeteccion}/${r.negativos.total} con detección · citas con bandera ${r.negativos.banderasPresentes}/${r.negativos.citasConRadicado}`);
  for (const g of r.generalizacion) l.push(`generalización ${g.tipo}: ${g.presentes}/${g.esperadas}`);
  l.push(`residuos: primera vuelta ${r.residuos.antesDelBucle} · última ${r.residuos.despuesDelBucle} · omisiones ${r.residuos.omisiones} · concordancia residue.ts ${r.residuos.concordanciaResidueTs ? 'sí' : 'NO'}`);
  for (const d of r.residuos.porDocumento) {
    if (d.residuos + d.omisiones > 0) l.push(`  ${d.docId}: residuos ${d.residuos} · omisiones ${d.omisiones} · ${d.idsAnotacion.join(' ')}`);
  }
  if (r.veredicto !== undefined) l.push(`veredicto: ${r.veredicto.cierra ? 'CIERRA' : 'NO CIERRA'}${r.veredicto.incumplidos.length > 0 ? ` · ${r.veredicto.incumplidos.join(', ')}` : ''}`);
  return l.join('\n');
}

/**
 * Nombre del informe: `AAAAMMDD-HHMM-<config>-<vista>-<hilos>h.json` (10.3.3) para todo el corpus. Una corrida de un solo conjunto
 * (`--conjunto=desarrollo` o `reserva`, la reserva aparte de 10.4.1) lleva además `-<conjunto>`: sin él, la corrida de la reserva del
 * mismo minuto pisaría el informe de los 29 (P0-4). `fecha` es ISO local `AAAA-MM-DDTHH:MM`.
 */
export function nombreInforme(c: Pick<CorridaInfo, 'config' | 'vista' | 'hilos'> & { conjunto?: CorridaInfo['conjunto'] }, fecha: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/u.exec(fecha);
  const sello = m === null ? 'sin-fecha' : `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}`;
  const conjunto = c.conjunto === undefined || c.conjunto === 'todo' ? '' : `-${c.conjunto}`;
  return `${sello}-${c.config}-${c.vista}-${c.hilos}h${conjunto}.json`;
}

// ===================================================================================================================
// Línea de órdenes
// ===================================================================================================================

interface EntradaArchivo { corrida: CorridaInfo; documentos: EntradaDocumento[] }

function argumentos(argv: readonly string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of argv) {
    const x = /^--([a-z-]+)(?:=(.*))?$/u.exec(a);
    if (x !== null) m.set(x[1] as string, x[2] ?? '');
  }
  return m;
}

export function main(argv: readonly string[]): number {
  const a = argumentos(argv);
  const entrada = a.get('entrada');
  if (entrada === undefined || entrada === '') {
    process.stderr.write('Uso: node scripts/metrics.ts --entrada=<medicion-entrada.json> [--salida=<carpeta>]\n'
      + '  La entrada la deja la corrida de medición (PG-3b): { corrida, documentos[] } con el gold, las detecciones, banderas,\n'
      + '  sugerencias y la salida revisada de cada documento. Código de salida: 0 correcto, 1 no cumple, 2 uso o entrada inválidos.\n');
    return 2;
  }
  let datos: EntradaArchivo;
  try {
    datos = JSON.parse(readFileSync(resolve(entrada), 'utf8')) as EntradaArchivo;
    if (!Array.isArray(datos.documentos) || typeof datos.corrida !== 'object') throw new Error('formato');
  } catch {
    process.stderr.write('metrics: la entrada no es un JSON con { corrida, documentos[] }\n');
    return 2;
  }
  const informe = construirInforme(datos.documentos, datos.corrida);
  const carpeta = resolve(a.get('salida') ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'corpus', 'resultados'));
  if (!existsSync(carpeta)) mkdirSync(carpeta, { recursive: true });
  const archivo = join(carpeta, nombreInforme(informe.corrida, informe.corrida.fecha));
  writeFileSync(archivo, `${JSON.stringify(informe, null, 2)}\n`);
  process.stdout.write(`${tablaTexto(informe)}\n`);
  process.stdout.write(`informe: ${archivo}\n`);
  return codigoDeSalida(informe);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
