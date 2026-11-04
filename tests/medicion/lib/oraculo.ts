// Revisión simulada con oráculo (plan 10.3.4): hace lo que haría un abogado cuidadoso con las propuestas, sin agregar datos que el
// motor no propuso, salvo los que le señala la búsqueda de residuos. Solo Node; usa el reductor, `render` y `runResidueCheck` de
// producción. El gold solo decide aceptar o rechazar y, en una mención ambigua de la lista (D-16), a cuál de las personas
// sugeridas corresponde; nada de él sale de este módulo (ni a la consola ni al informe).
import { render } from '../../../src/core/render.ts';
import { createRuleRegistry } from '../../../src/core/pipeline.ts';
import { runResidueCheck } from '../../../src/core/residue.ts';
import { applyReviewAction } from '../../../src/core/entities.ts';
import type { ReviewContext } from '../../../src/core/entities.ts';
import { decisionesAmbiguas } from '../../../src/core/review/ambiguas.ts';
import type {
  CaseEntityId, Detection, DetectionId, DetectionSet, DocumentModel, EntityId, ReviewAction, ReviewState, RenderedOutput, ResidueRun,
  RuleRegistry, Span,
} from '../../../src/core/types.ts';
import { claveParte, esPositiva, esVerdadera } from '../../../scripts/metrics.ts';
import type { EntradaDocumento, GoldAnnotation, SalidaParte, HallazgoEscaner } from '../../../scripts/metrics.ts';
import { escanearResiduos } from '../../../scripts/metrics.ts';
import type { DocCorpus } from './corpus.ts';
import { OPCIONES_DETECCION, TABLA_VACIA, salidaDe } from './motor.ts';
import type { DocProcesado, Motor } from './motor.ts';

export const MAX_VUELTAS = 5;

interface Tramo { start: number; end: number }
const solapa = (a: Tramo, b: Tramo): boolean => Math.min(a.end, b.end) > Math.max(a.start, b.start);

export interface ResultadoOraculo {
  state: ReviewState;
  /** Salida de la primera pasada de residuos (ya revisada, antes de incorporar residuos). */
  salidaPrimera: SalidaParte[];
  /** Salida tras el bucle. */
  salidaFinal: SalidaParte[];
  hitsPrimeraVuelta: number;
  hitsUltimaVuelta: number;
  /** Posiciones (en la salida de la primera vuelta) de los hallazgos de `residue.ts`. */
  hitsResidue: Array<{ parte: string; start: number; end: number }>;
  /** Cuántas veces corrió la búsqueda de residuos. */
  vueltas: number;
  convergio: boolean;
  /** Acciones del reductor que se rechazaron (código): informativo; nunca texto. */
  rechazadas: string[];
  /** D-16 · Menciones ambiguas de la lista que decidió el oráculo, con la entidad que les quedó (la persona elegida, o la propia
   *  si las separó como otra persona). */
  ambiguas: Array<{ detectionId: DetectionId; entityId: EntityId }>;
}

/** `detect` de la búsqueda de residuos: la misma ida y vuelta al worker `detect` (+ `fusionar` con `ner = null`) del producto. */
export function detectDeResiduos(m: Motor, dc: DocCorpus): (tmp: DocumentModel) => Promise<DetectionSet> {
  let n = 0;
  return async (tmp) => {
    const sessionId = `res_${dc.docId}_${++n}`;
    await m.pedir('detectar', { sessionId, doc: tmp, caseList: dc.caseList, table: TABLA_VACIA, options: OPCIONES_DETECCION });
    const r = await m.pedir<{ kind: 'fusionar'; set: DetectionSet }>('fusionar', { sessionId, ner: null, nerEngineId: 'nulo' });
    await m.pedir('liberar', { sessionId });
    return r.set;
  };
}

export interface ArgsOraculo {
  p: DocProcesado;
  motor: Motor;
  detect?: (tmp: DocumentModel) => Promise<DetectionSet>;
  maxVueltas?: number;
}

/** El oráculo del plan 10.3.4. Devuelve el estado final y las salidas de la primera y la última vuelta. */
export async function revisarConOraculo(a: ArgsOraculo): Promise<ResultadoOraculo> {
  const { dc } = a.p;
  const ctx: ReviewContext = a.p.ctx;
  let st: ReviewState = a.p.state;
  const rechazadas: string[] = [];
  const act = (accion: ReviewAction, tolerar = false): boolean => {
    const r = applyReviewAction(st, accion, ctx);
    if (r.ok) st = r.state;
    else if (!tolerar) rechazadas.push(`${accion.kind}:${r.code}`);
    return r.ok;
  };

  const positivas = new Map<string, GoldAnnotation[]>();
  const negativas = new Map<string, GoldAnnotation[]>();
  for (const g of dc.gold.anotaciones) {
    const k = claveParte(g.parte);
    const mapa = esPositiva(g) ? positivas : g.es_negativo_esperado ? negativas : undefined;
    if (mapa === undefined) continue;
    const l = mapa.get(k);
    if (l === undefined) mapa.set(k, [g]); else l.push(g);
  }
  const clave = (d: { partId: Detection['partId'] }): string => dc.claveDe.get(d.partId) as string;
  const tramos = (d: Detection): Array<Tramo> => positivas.get(clave(d)) ?? [];
  const verdadera = (d: Detection): boolean => esVerdadera(d, tramos(d));
  const banderaCorrecta = (d: Detection): boolean => (negativas.get(clave(d)) ?? []).some((n) => n.bandera_esperada !== undefined
    && solapa(d, n) && Object.values(st.flags).some((f) => f.type === n.bandera_esperada && f.detectionId === d.id));

  /**
   * Decide lo que nadie decidió: las detecciones pendientes y las que aceptó `aplicar_propuesta` (D-24). Verdadera -> se queda oculta
   * (si estaba pendiente, aceptar); bandera correcta -> la resuelve la bandera; si no -> falso positivo: el abogado la muestra.
   */
  const decidirPendientes = (): void => {
    const hechas = new Set<string>();
    for (const id of [...st.order]) {
      const d = st.detections[id];
      if (d === undefined) continue;
      const propuesta = d.status === 'aceptada' && d.decidedBy === 'propuesta';
      if (d.status !== 'pendiente' && !propuesta) continue;
      if (propuesta) {
        if (!verdadera(d) && !banderaCorrecta(d)) act({ kind: 'rechazar', detectionId: d.id, reason: 'FALSO_POSITIVO' });
        continue;
      }
      if (verdadera(d)) {
        const e = st.entities[d.entityId];
        const todas = e !== undefined && e.mentions.length > 1 && e.mentions.every((m) => {
          const x = st.detections[m];
          return x !== undefined && (x.status === 'rechazada' || verdadera(x));
        });
        if (todas && e !== undefined) {
          if (!hechas.has(e.id)) { hechas.add(e.id); act({ kind: 'aceptar_entidad', entityId: e.id }); }
        } else act({ kind: 'aceptar', detectionId: d.id });
      } else if (!banderaCorrecta(d)) act({ kind: 'rechazar', detectionId: d.id, reason: 'FALSO_POSITIVO' });
    }
  };
  const generaliza = (s: Tramo & { partId: Span['partId'] }): boolean =>
    dc.gold.anotaciones.some((g) => g.debe_generalizarse && claveParte(g.parte) === dc.claveDe.get(s.partId) && solapa(g, s));

  // D-16 · La mención que comparten dos o más personas de la lista la decide el revisor, que lee el contexto: si alguna de las
  // personas sugeridas es la del gold, la elige («Unir con otra entidad»); si el gold la da a otra persona, la separa. Una que no
  // es dato personal la rechaza `decidirPendientes`. La entidad gold de cada persona de la lista es la de `LISTA:<nombre>`.
  const nfc = (s: string): string => s.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const goldDeCaso = new Map<CaseEntityId, string>();
  for (const ce of dc.caseList) {
    const ge = dc.gold.entidades.find((e) => e.enLista && nfc(e.canonico) === `LISTA:${nfc(ce.name)}`);
    if (ge !== undefined) goldDeCaso.set(ce.id, ge.id);
  }
  const entidadGold = (d: Detection): string | undefined => {
    let mejor: { entidad: string } | undefined;
    let largo = 0;
    for (const g of tramos(d) as Array<Tramo & { entidad: string }>) {
      const i = Math.min(g.end, d.end) - Math.max(g.start, d.start);
      if (i > largo) { largo = i; mejor = g; }
    }
    return mejor?.entidad;
  };
  const decididas = new Set<DetectionId>();
  // PB-3-r4 (M-72 y D-16 en el modelo): las opciones fuera de la lista (`fuera`, la otra persona con ese apellido o las anfitrionas de
  // una forma corta del modelo) se eligen si alguna de sus menciones es de la entidad gold de la mención.
  const deLaEntidadGold = (id: EntityId, d: Detection, g: string | undefined): boolean => g !== undefined
    && (st.entities[id]?.mentions ?? []).some((m) => { const o = st.detections[m]; return o !== undefined && o.id !== d.id && entidadGold(o) === g; });
  // D-24 · La interfaz aplica la propuesta antes de que el abogado mire: cada ambigua sale separada con una etiqueta propia. El
  // oráculo decide antes de aplicarla a quién corresponde cada una (mira las opciones mientras siguen ambiguas) y la corrige después:
  // la une a la persona elegida («Es la misma que…») o, si el gold la da a otra persona, la separa como antes («Es otra persona»).
  const planAmbiguas = (): Array<{ detectionId: DetectionId; elegida: EntityId | undefined }> => {
    const plan: Array<{ detectionId: DetectionId; elegida: EntityId | undefined }> = [];
    for (const x of decisionesAmbiguas(st, dc.caseList, dc.doc)) {
      const d = st.detections[x.detectionId];
      if (d === undefined || decididas.has(d.id) || !verdadera(d)) continue;
      const g = entidadGold(d);
      const elegida = x.opciones.find((id) => { const c = st.entities[id]?.caseEntityId; return c !== undefined && goldDeCaso.get(c) === g; })
        ?? x.fuera.find((id) => deLaEntidadGold(id, d, g));
      plan.push({ detectionId: d.id, elegida });
    }
    return plan;
  };
  const resolverAmbiguas = (plan: ReturnType<typeof planAmbiguas>): void => {
    for (const x of plan) {
      const d = st.detections[x.detectionId];
      if (d === undefined) continue;
      const ok = x.elegida !== undefined
        ? act({ kind: 'unir_entidades', fromId: d.entityId, intoId: x.elegida })
        : act({ kind: 'separar_mencion', detectionId: d.id });
      if (ok) decididas.add(d.id);
    }
  };
  /** Sugerencias pendientes antes de la propuesta: las que ella aplicó las vuelve a decidir el oráculo, como antes. */
  let sugerenciasDelRevisor = new Set<string>();
  const proponer = (): void => {
    const plan = planAmbiguas();
    const pendientes = new Set(Object.values(st.suggestions).filter((s) => s.status === 'pendiente').map((s) => s.id));
    const sinConfirmar = new Set(Object.values(st.flags).filter((f) => !f.acknowledged).map((f) => f.id));
    if (sugerenciasDelRevisor.size === 0) sugerenciasDelRevisor = pendientes;
    act({ kind: 'aplicar_propuesta' }, true);
    // Banderas y sugerencias: el abogado las vuelve a decidir con el gold más abajo. Lo que la propuesta les aplicó se deshace aquí,
    // antes de mostrar los falsos positivos, para decidirlas en el mismo orden que antes (una edición de tramo de la propuesta no
    // debe impedir otra que el gold sí pide, ni al revés).
    for (const f of Object.values(st.flags)) if (sinConfirmar.has(f.id) && f.acknowledged) act({ kind: 'resolver_bandera', flagId: f.id, resolution: 'mantener' });
    for (const s of Object.values(st.suggestions)) if (pendientes.has(s.id) && s.status === 'aplicada') act({ kind: 'descartar_sugerencia', suggestionId: s.id });
    resolverAmbiguas(plan);
    decidirPendientes();
  };

  proponer();
  // Banderas: la cita se mantiene (rechaza el radicado vinculado), salvo que el gold marque ese expediente como dato positivo del
  // propio caso (7.3.3: quien sigue la guía lo conserva anonimizado; PB-2-r7, A-1): entonces se resuelve como «reemplazar», que
  // acepta la detección vinculada. Con gold `debe_generalizarse` sobre su tramo, las demás banderas se reemplazan con 'o1'.
  for (const f of Object.values(st.flags)) {
    if (f.type === 'CITA_JURISPRUDENCIAL') {
      const vinculada = f.detectionId === undefined ? undefined : st.detections[f.detectionId];
      const propio = vinculada !== undefined && verdadera(vinculada);
      act({ kind: 'resolver_bandera', flagId: f.id, resolution: propio ? 'reemplazar' : 'mantener' });
      continue;
    }
    if (generaliza({ ...f.span })) {
      const ok = act({ kind: 'resolver_bandera', flagId: f.id, resolution: 'reemplazar', optionId: 'o1' }, true);
      if (!ok) act({ kind: 'resolver_bandera', flagId: f.id, resolution: 'mantener' });
    } else act({ kind: 'resolver_bandera', flagId: f.id, resolution: 'mantener' });
  }
  // Sugerencias: aplicar 'o1' (con el primer departamento si hay opciones de lugar) si su tramo solapa gold con `debe_generalizarse`.
  for (const s of Object.values(st.suggestions)) {
    // Las que estaban pendientes antes de la propuesta (aunque ella las aplicara y aquí se deshicieran), salvo las que una bandera
    // ya decidió.
    if (!sugerenciasDelRevisor.has(s.id) || s.status === 'aplicada') continue;
    if (s.status === 'descartada' && Object.values(st.flags).some((f) => f.suggestionId === s.id)) continue;
    const span: (Tramo & { partId: Span['partId'] }) | undefined = s.target.kind === 'tramo' ? s.target.span : (() => {
      const d = st.detections[s.target.detectionId];
      return d === undefined ? undefined : { partId: d.partId, start: d.start, end: d.end };
    })();
    if (span === undefined || !generaliza(span)) { act({ kind: 'descartar_sugerencia', suggestionId: s.id }); continue; }
    if ((s.placeOptions?.length ?? 0) > 1) act({ kind: 'elegir_departamento', suggestionId: s.id, depCode: s.placeOptions?.[0] as string });
    if (!act({ kind: 'aplicar_sugerencia', suggestionId: s.id, optionId: 'o1' }, true)) act({ kind: 'descartar_sugerencia', suggestionId: s.id });
  }
  // Recordatorio: las 3 casillas son de la interfaz; el oráculo no las necesita (no cambian el texto de la salida).

  const rules: RuleRegistry = createRuleRegistry(Number(OPCIONES_DETECCION.referenceDate.slice(0, 4)));
  const detect = a.detect ?? detectDeResiduos(a.motor, dc);
  const correr = async (): Promise<{ out: RenderedOutput; run: ResidueRun }> => {
    const out = render(dc.doc, st);
    const run = await runResidueCheck(dc.doc, st, out, { table: TABLA_VACIA, caseList: dc.caseList, rules, detect });
    return { out, run };
  };

  const max = a.maxVueltas ?? MAX_VUELTAS;
  let primera: { out: RenderedOutput; run: ResidueRun } | undefined;
  let ultima: { out: RenderedOutput; run: ResidueRun } | undefined;
  let vueltas = 0;
  let convergio = false;
  while (vueltas < max) {
    const r = await correr();
    vueltas++;
    primera ??= r;
    ultima = r;
    if (r.run.result.hits.length === 0 && r.run.nuevas.length === 0) { convergio = true; break; }
    act({ kind: 'incorporar_residuos', residueRevision: r.run.result.revision, candidates: r.run.nuevas });
    // Como la interfaz: lo que encuentra la búsqueda también se oculta de entrada, y el abogado lo corrige.
    proponer();
  }
  if (!convergio) {
    // La última vuelta ejecutada dejó cambios sin comprobar: una comprobación final dice si quedó en cero.
    const r = await correr();
    ultima = r;
    convergio = r.run.result.hits.length === 0 && r.run.nuevas.length === 0;
  }
  const p1 = primera as { out: RenderedOutput; run: ResidueRun };
  const pn = ultima as { out: RenderedOutput; run: ResidueRun };
  const seccionDe = (i: number): string => dc.claveDe.get((p1.out.sections[i] as { partId: Detection['partId'] }).partId) as string;
  // PB-4-r1 · Cada segmento reemplazado lleva el tipo de su detección: la clasificación de residuos distingue así los límites cortos
  // de una detección del mismo dato de un trozo que cubrió, por coincidencia, la detección de otro (10.3.4).
  const conTipo = (out: RenderedOutput): SalidaParte[] => salidaDe(dc, out).map((s) => ({
    ...s,
    segmentos: s.segmentos.map((g) => {
      const t = g.detectionId === undefined ? undefined : st.detections[g.detectionId as Detection['id']]?.type;
      return t === undefined ? g : { ...g, tipo: t };
    }),
  }));
  return {
    state: st,
    salidaPrimera: conTipo(p1.out),
    salidaFinal: conTipo(pn.out),
    hitsPrimeraVuelta: p1.run.result.hits.length,
    hitsUltimaVuelta: pn.run.result.hits.length,
    hitsResidue: p1.run.result.hits.map((h) => ({ parte: seccionDe(h.sectionIndex), start: h.start, end: h.end })),
    vueltas,
    convergio,
    rechazadas,
    ambiguas: [...decididas].flatMap((id) => { const d = st.detections[id]; return d === undefined ? [] : [{ detectionId: id, entityId: d.entityId }]; }),
  };
}

/**
 * Completa la entrada de las métricas con lo que dejó el oráculo (10.3.4). D-16: la entidad de una mención ambigua de la lista es
 * la que eligió el revisor (el motor no la asigna), así que la consistencia y las colisiones la miden con esa elección. Las demás
 * detecciones conservan la entidad que les dio el motor.
 */
export function conOraculo(entrada: EntradaDocumento, o: ResultadoOraculo): EntradaDocumento {
  const elegida = new Map<string, string>(o.ambiguas.map((a) => [a.detectionId, a.entityId]));
  return {
    ...entrada,
    detecciones: elegida.size === 0 ? entrada.detecciones
      : entrada.detecciones.map((d) => { const e = elegida.get(d.id); return e === undefined ? d : { ...d, entidad: e }; }),
    salida: o.salidaPrimera, salidaFinal: o.salidaFinal,
    hitsPrimeraVuelta: o.hitsPrimeraVuelta, hitsUltimaVuelta: o.hitsUltimaVuelta, hitsResidue: o.hitsResidue,
  };
}

export type { HallazgoEscaner };
export { escanearResiduos };
