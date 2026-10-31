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
  /** Tipo de la detección que reemplazó el segmento (PB-4-r1): lo usa la clasificación de residuos para los límites cortos. */
  tipo?: DataType;
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
    /**
     * PB-4-r2 (M-60) · Lo que la definición por dato mueve frente a la letra de 10.3.4, contado aparte para que se vea: las menciones
     * con algo copiado que no lleva dato (pasan a «protegida») y las omisiones que la letra habría contado como residuo.
     */
    copiasSinDato?: number; omisionesPorLaLetra?: number;
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
  /** PB-4-r2 · La clase que daría la letra de 10.3.4 (entidad tocada, en la lista o de un mismo titular tocado); solo para contar aparte lo que mueve la definición por dato. */
  letra: ClaseMencion;
}

/**
 * Copia de las palabras de función y tratamientos de R-MOD-03 (`PALABRAS_DE_FUNCION` de `src/core/merge.ts`) y del sufijo societario
 * de R-LST-05 (`LST.SUFIJO` de `src/core/caselist.ts`). No se importan: esos módulos no cargan con Node sin Vite y este script sí
 * (`node scripts/metrics.ts`, `medir --solo-veredicto`). Una prueba de tests/unit/metrics.test.ts exige que sean iguales.
 */
export const FUNCION_RMOD03: ReadonlySet<string> = new Set(('de|del|la|las|los|el|lo|y|e|o|u|a|al|en|por|para|con|sin|su|sus|que|se|un|una|'
  + 'unos|unas|senorita|senora|senor|srta|sra|sr|dona|don|doctora|doctor|dra|dr|mrs|mr|ms').split('|'));
export const SUFIJO_RLST05 = String.raw`(?:s\. ?a\. ?s\.?|s ?a ?s|s\. ?a\.?|s ?a|ltda\.?|limitada|e\. ?s\. ?p\.?|esp|e\. ?s\. ?e\.?|e\. ?u\.?|(?:&|y) ?cia\.?(?: ?s\. ?en ?c\.?)?|s\. ?en ?c\.?(?: ?s\.?)?|s\. ?c\. ?a\.?|sociedad por acciones simplificada|sociedad anonima|empresa unipersonal)`;
/** El sufijo societario solo al final del texto (con blancos y signos detrás): «S.A.» de una razón social; nunca el apellido «Sá» del medio ni de una persona. */
const RE_SUFIJO_FINAL = new RegExp(String.raw`(?<![\p{L}\p{N}])` + SUFIJO_RLST05 + String.raw`[\s\p{P}\p{S}]*$`, 'u');

/** Lo que identifica en un trozo de texto (10.3.4, PB-4-r1): palabras, iniciales y dígitos. */
export interface DatoCopiado { palabras: string[]; iniciales: string[]; digitos: string }

/**
 * El dato que lleva un trozo: palabras de 2 letras o más que no son de función ni tratamiento (R-MOD-03), iniciales («A.») y los
 * dígitos. Los blancos y los signos no identifican; tampoco menos de 3 dígitos sueltos (la regla de remanentes de 7.11.2 descarta un
 * trozo así). Sobre la vista `lista` (sin tildes ni mayúsculas).
 *
 * PB-4-r2 (M-60, G4) · El sufijo societario (R-LST-05) solo se quita al final y solo de una organización (`sufijo`, por defecto
 * `true`): el apellido «Sá» de una persona es «sa» en la vista `lista` y no es un sufijo.
 */
export function datoDe(texto: string, sufijo = true): DatoCopiado {
  const vista = buildSearchView(texto, 'lista', 'cuerpo').text;
  const v = sufijo ? vista.replace(RE_SUFIJO_FINAL, ' ') : vista;
  const palabras: string[] = [];
  const iniciales: string[] = [];
  for (const m of v.matchAll(/\p{L}+(\.)?/gu)) {
    const w = m[0].replace(/\.$/u, '');
    if (w.length === 1 && m[1] === '.') iniciales.push(w);
    else if (w.length >= 2 && !FUNCION_RMOD03.has(w)) palabras.push(w);
  }
  return { palabras, iniciales, digitos: v.replace(/[^0-9]/gu, '') };
}
const conDato = (d: DatoCopiado): boolean => d.palabras.length > 0 || d.iniciales.length > 0 || d.digitos.length >= 3;

const esOrganizacion = (t: DataType): boolean => ORGS.includes(t);
const esDeNombre = (t: DataType): boolean => t === 'PERSONA' || esOrganizacion(t);

/** Una variante que la lista del caso genera para un nombre (7.9): su texto y su clase (`exacta`, `apellidos`, `iniciales`, `sigla`…). */
export interface FormaGenerada { texto: string; clase: string }
/**
 * PB-4-r2 (M-60) · El generador de variantes de la lista (`newCaseEntity` y `refreshVariants` de `src/core/caselist.ts`). No se importa
 * por lo mismo que `FUNCION_RMOD03`: el módulo no carga con Node sin Vite. La corrida de medición lo da (tests/medicion/lib/formas-lista.ts),
 * con el generador real; sin él, solo cuentan el nombre de la lista y lo que el motor reemplazó.
 */
export type GeneradorDeFormas = (nombre: string, tipo: DataType) => readonly FormaGenerada[];

/** Lo que el motor conoce de cada entidad gold (10.3.4): palabras, primeras letras y dígitos, y las iniciales y siglas que la lista genera. */
interface Conocido { palabras: Set<string>; iniciales: Set<string>; digitos: string[]; formas: Set<string>; comodines: Set<string> }
const nuevoConocido = (): Conocido => ({ palabras: new Set<string>(), iniciales: new Set<string>(), digitos: [], formas: new Set<string>(), comodines: new Set<string>() });

const letrasDe = (texto: string): string[] => buildSearchView(texto, 'lista', 'cuerpo').text.match(/\p{L}+/gu) ?? [];

/**
 * Las letras de unas iniciales o una sigla, sin puntos ni blancos («A. F. R.», «A F R» y «AFR» dan «afr»; «IFV», «ifv»), o null si el
 * texto no tiene esa forma: tres letras o más, sueltas (con o sin punto) o pegadas en una sola palabra.
 */
export function letrasDeIniciales(texto: string): string | null {
  const t = letrasDe(texto);
  const letras = t.join('');
  return letras.length >= 3 && (t.length === 1 || t.every((x) => x.length === 1)) ? letras : null;
}

/** Guarda las iniciales y siglas de las variantes que la lista genera. «A. F. _.» (dos iniciales y una letra cualquiera) queda como comodín. */
function guardarFormas(k: Conocido, formas: readonly FormaGenerada[]): void {
  for (const f of formas) {
    if (f.clase !== 'iniciales' && f.clase !== 'sigla') continue;
    const letras = letrasDe(f.texto).join('');
    if (letras.length > 0) (f.texto.includes('_') ? k.comodines : k.formas).add(letras);
  }
}

/** ¿El texto es una inicial o sigla que la lista genera para alguna de estas entidades? Con o sin punto: es el mismo dato. */
function esFormaGenerada(texto: string, ks: readonly Conocido[]): boolean {
  const l = letrasDeIniciales(texto);
  return l !== null && ks.some((k) => k.formas.has(l) || [...k.comodines].some((c) => l.length === c.length + 1 && l.startsWith(c)));
}

/** Trozos [start, end) de la parte dentro de [g.start, g.end) que caen en segmentos copiados (`copiado`) o reemplazados. */
function trozos(segmentos: readonly SegmentoSalida[], g: Tramo, copiado: boolean): Array<{ start: number; end: number; deteccion: boolean }> {
  const out: Array<{ start: number; end: number; deteccion: boolean }> = [];
  for (const s of segmentos) {
    const reemplazado = s.detectionId !== undefined || s.spanEditId !== undefined;
    if (reemplazado === copiado) continue;
    const a = Math.max(s.partStart, g.start);
    const b = Math.min(s.partEnd, g.end);
    if (b > a) out.push({ start: a, end: b, deteccion: s.detectionId !== undefined });
  }
  return out;
}

/** Lo que queda de la mención detrás del trozo es solo blancos y signos: el trozo es el final de la mención. */
const alFinalDeLaMencion = (g: GoldAnnotation, t: Tramo): boolean => /^[\s\p{P}\p{S}]*$/u.test(g.texto.slice(t.end - g.start));

/**
 * Lo que el motor conoce de cada entidad gold: el nombre que el usuario dio en la lista del caso (`canonico` «LISTA:<nombre>»), lo que
 * reemplazó dentro de sus menciones (palabras, primeras letras y dígitos) y, con el generador de la lista, las iniciales y siglas que
 * genera para esos nombres (PB-4-r2).
 */
function conocidoPorEntidad(gold: GoldDocument, segs: ReadonlyMap<string, readonly SegmentoSalida[]>, generar?: GeneradorDeFormas): Map<string, Conocido> {
  const out = new Map<string, Conocido>();
  const generadas = new Map<string, readonly FormaGenerada[]>();
  const formasDe = (nombre: string, tipo: DataType): readonly FormaGenerada[] => {
    if (generar === undefined || !esDeNombre(tipo) || letrasDe(nombre).length < 2) return [];
    const clave = `${tipo}\u0000${nombre}`;
    let f = generadas.get(clave);
    if (f === undefined) { f = generar(nombre, tipo); generadas.set(clave, f); }
    return f;
  };
  for (const e of gold.entidades) {
    if (!e.enLista || !e.canonico.startsWith('LISTA:')) continue;
    const k = nuevoConocido();
    const nombre = e.canonico.slice('LISTA:'.length);
    const d = datoDe(nombre, esOrganizacion(e.tipo));
    for (const p of d.palabras) { k.palabras.add(p); k.iniciales.add(p.charAt(0)); }
    guardarFormas(k, formasDe(nombre, e.tipo));
    out.set(e.id, k);
  }
  for (const g of gold.anotaciones.filter(esPositiva)) {
    const k = out.get(g.entidad) ?? nuevoConocido();
    out.set(g.entidad, k);
    let dig = '';
    for (const t of trozos(segs.get(claveParte(g.parte)) ?? [], g, false)) {
      const texto = g.texto.slice(t.start - g.start, t.end - g.start);
      const d = datoDe(texto, esOrganizacion(g.tipo) && alFinalDeLaMencion(g, t));
      for (const p of d.palabras) { k.palabras.add(p); k.iniciales.add(p.charAt(0)); }
      for (const i of d.iniciales) k.iniciales.add(i);
      dig += d.digitos;
      if (t.deteccion) guardarFormas(k, formasDe(texto.trim(), g.tipo));
    }
    if (dig.length >= 3) k.digitos.push(dig);
  }
  return out;
}

/**
 * Clasifica cada mención gold positiva tras la revisión (10.3.4). **Protegida**: lo copiado no lleva dato (ningún carácter copiado,
 * o solo blancos, signos, palabras de función, el sufijo societario al final de una organización o menos de 3 dígitos). **Residuo**:
 * lo copiado lleva un dato que el motor conocía de esa entidad (o de un `mismoTitular`): una palabra, inicial o cifra que reemplazó
 * en otra de sus menciones o está en el nombre de la lista; una forma que la lista genera para ella (iniciales con o sin punto,
 * sigla); o la mención quedó reemplazada a medias por una detección aceptada, de cualquier tipo (límites cortos), salvo que esa
 * detección caiga sobre otra anotación positiva de otra entidad. **Omisión**: lo copiado lleva dato y el motor nunca lo conoció (un
 * apodo que nada detectó, o una mención tocada solo por la detección de otro dato).
 *
 * PB-4-r2 (M-60, D-14 decisión 1) · Una forma que el motor conoce o que la lista genera nunca es «protegida» ni «omisión».
 * Cierra los huecos de PB-4-r1: las iniciales sin punto («A F R»), «AFR» y la sigla («IFV») eran protegida u omisión; los límites cortos
 * dependían del tipo de la detección (una persona aceptada como empresa dejaba su resto como omisión); y el apellido «Sá» se tomaba
 * por el sufijo «S.A.».
 */
export function clasificarMenciones(gold: GoldDocument, salida: readonly SalidaParte[], generar?: GeneradorDeFormas): ResultadoResiduo[] {
  const segs = new Map(salida.map((s) => [s.parte, s.segmentos]));
  const conocido = conocidoPorEntidad(gold, segs, generar);
  const entPorId = new Map(gold.entidades.map((e) => [e.id, e]));
  const vacio = nuevoConocido();
  const titulares = (id: string): string[] => [id, ...(entPorId.get(id)?.mismoTitular ?? [])];
  const deEntidad = (id: string): Conocido[] => titulares(id).map((o) => conocido.get(o) ?? vacio);
  const positivas = gold.anotaciones.filter(esPositiva);
  // La letra de 10.3.4: entidad con alguna mención reemplazada, en la lista del caso, o con un `mismoTitular` en alguno de los dos casos.
  const tocadas = new Set<string>();
  for (const g of positivas) if (caracteresCopiados(segs.get(claveParte(g.parte)) ?? [], g.start, g.end) < g.end - g.start) tocadas.add(g.entidad);
  const tocadaPorLaLetra = (id: string): boolean => titulares(id).some((o) => tocadas.has(o) || entPorId.get(o)?.enLista === true);
  /** El tramo reemplazado cae sobre otra anotación positiva de otra entidad (que no es del mismo titular): es la detección de otro dato. */
  const sobreOtroDato = (g: GoldAnnotation, t: Tramo): boolean => {
    const propios = new Set(titulares(g.entidad));
    return positivas.some((o) => !propios.has(o.entidad) && claveParte(o.parte) === claveParte(g.parte) && solapa(o, t));
  };
  return positivas.map((g): ResultadoResiduo => {
    const s = segs.get(claveParte(g.parte)) ?? [];
    const copiados = caracteresCopiados(s, g.start, g.end);
    if (copiados === 0) return { g, clase: 'protegida', copiados: 0, letra: 'protegida' };
    const letra: ClaseMencion = tocadaPorLaLetra(g.entidad) ? 'residuo' : 'omision';
    const piezas = trozos(s, g, true);
    const textos = piezas.map((t) => g.texto.slice(t.start - g.start, t.end - g.start));
    const ks = deEntidad(g.entidad);
    if ([...textos, textos.join(' ')].some((x) => esFormaGenerada(x, ks))) return { g, clase: 'residuo', copiados, letra };
    const ultima = piezas[piezas.length - 1];
    const dato = datoDe(textos.join(' '), esOrganizacion(g.tipo) && ultima !== undefined && alFinalDeLaMencion(g, ultima));
    if (!conDato(dato)) return { g, clase: 'protegida', copiados, letra };
    const sabida = dato.palabras.some((p) => ks.some((k) => k.palabras.has(p)))
      || dato.iniciales.some((i) => ks.some((k) => k.iniciales.has(i)))
      || (dato.digitos.length >= 3 && ks.some((k) => k.digitos.some((d) => d.includes(dato.digitos) || (d.length >= 5 && dato.digitos.includes(d)))));
    const corta = trozos(s, g, false).some((t) => t.deteccion
      && conDato(datoDe(g.texto.slice(t.start - g.start, t.end - g.start), esOrganizacion(g.tipo) && alFinalDeLaMencion(g, t))) && !sobreOtroDato(g, t));
    return { g, clase: sabida || corta ? 'residuo' : 'omision', copiados, letra };
  });
}

/**
 * Textos gold que el escáner independiente busca (10.3.4, PB-4-r1): los de las menciones positivas cuyo dato el motor ya conocía
 * entero (cada palabra, inicial y cifra está en lo que reemplazó de esa entidad), y (PB-4-r2) las que son una inicial o sigla que la
 * lista genera para ella. Un apodo que nada detectó no es una forma conocida.
 */
export function valoresDelEscaner(gold: GoldDocument, salida: readonly SalidaParte[], generar?: GeneradorDeFormas): string[] {
  const segs = new Map(salida.map((s) => [s.parte, s.segmentos]));
  const conocido = conocidoPorEntidad(gold, segs, generar);
  const out = new Set<string>();
  for (const g of gold.anotaciones.filter(esPositiva)) {
    const k = conocido.get(g.entidad);
    if (k === undefined) continue;
    if (esFormaGenerada(g.texto, [k])) { out.add(g.texto); continue; }
    const d = datoDe(g.texto, esOrganizacion(g.tipo));
    if (!conDato(d)) continue;
    const ok = d.palabras.every((p) => k.palabras.has(p)) && d.iniciales.every((i) => k.iniciales.has(i))
      && (d.digitos.length < 3 || k.digitos.some((x) => x.includes(d.digitos)));
    if (ok) out.add(g.texto);
  }
  return [...out];
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
  entradas: readonly EntradaDocumento[], corrida: CorridaInfo, opciones: { escanerEstricto?: boolean; formas?: GeneradorDeFormas } = {},
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
  let copiasSinDato = 0;
  let omisionesPorLaLetra = 0;
  const porDocumento: MetricsReport['residuos']['porDocumento'] = [];
  const escaneres: HallazgoEscaner[] = [];
  const residue: Array<{ parte: string; start: number; end: number }> = [];
  for (const en of entradas) {
    antes += en.hitsPrimeraVuelta ?? 0;
    despues += en.hitsUltimaVuelta ?? 0;
    residue.push(...(en.hitsResidue ?? []));
    if (en.salida === undefined) continue;
    // Residuos y omisiones se cuentan tras el bucle (`salidaFinal`); sin ella, sobre la salida entregada.
    const clases = clasificarMenciones(en.gold, en.salidaFinal ?? en.salida, opciones.formas);
    const res = clases.filter((c) => c.clase === 'residuo');
    const omi = clases.filter((c) => c.clase === 'omision');
    omisionesTotal += omi.length;
    // PB-4-r2 (M-60) · Lo que la definición por dato mueve frente a la letra de 10.3.4, aparte para que se vea.
    copiasSinDato += clases.filter((c) => c.clase === 'protegida' && c.copiados > 0).length;
    omisionesPorLaLetra += omi.filter((c) => c.letra === 'residuo').length;
    porDocumento.push({ docId: en.gold.docId, residuos: res.length, omisiones: omi.length, idsAnotacion: [...res, ...omi].map((c) => c.g.id) });
    // El escáner busca los textos gold cuyo dato el motor ya conocía (`valoresDelEscaner`); solo para comparar posiciones. Cuenta lo
    // que cae sobre una mención positiva (la clasificación por posición, 10.3.4): el mismo texto en otro sitio que el gold no marca
    // («PERÍODO DE PRUEBA», un homónimo que el revisor rechazó) no es un residuo que `residue.ts` deba ver.
    const valores = valoresDelEscaner(en.gold, en.salida, opciones.formas);
    for (const s of en.salida) {
      const positivas = en.gold.anotaciones.filter((g) => esPositiva(g) && claveParte(g.parte) === s.parte);
      const sobreMencion = (h: HallazgoEscaner): boolean => s.segmentos.some((g) => g.detectionId === undefined && g.spanEditId === undefined
        && g.outEnd > h.start && g.outStart < h.end && positivas.some((m) => {
          const a = g.partStart + (Math.max(h.start, g.outStart) - g.outStart);
          const b = g.partStart + (Math.min(h.end, g.outEnd) - g.outStart);
          return Math.min(b, m.end) > Math.max(a, m.start);
        }));
      escaneres.push(...escanearResiduos(s.parte, s.texto, valores, 'cuerpo', opciones.escanerEstricto === true).filter(sobreMencion));
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
      antesDelBucle: antes, despuesDelBucle: despues, omisiones: omisionesTotal, copiasSinDato, omisionesPorLaLetra, porDocumento,
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
  l.push(`residuos: primera vuelta ${r.residuos.antesDelBucle} · última ${r.residuos.despuesDelBucle} · omisiones ${r.residuos.omisiones} · copias sin dato ${r.residuos.copiasSinDato ?? 0} · omisiones que la letra contaba como residuo ${r.residuos.omisionesPorLaLetra ?? 0} · concordancia residue.ts ${r.residuos.concordanciaResidueTs ? 'sí' : 'NO'}`);
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
