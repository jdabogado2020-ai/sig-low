// Revisión simulada con oráculo (plan 10.3.4): hace lo que haría un abogado cuidadoso con las propuestas, sin agregar datos que el
// motor no propuso, salvo los que le señala la búsqueda de residuos. Solo Node; usa el reductor, `render` y `runResidueCheck` de
// producción. El gold solo decide aceptar o rechazar; nada de él sale de este módulo (ni a la consola ni al informe).
import { render } from '../../../src/core/render.ts';
import { createRuleRegistry } from '../../../src/core/pipeline.ts';
import { runResidueCheck } from '../../../src/core/residue.ts';
import { applyReviewAction } from '../../../src/core/entities.ts';
import type { ReviewContext } from '../../../src/core/entities.ts';
import type {
  Detection, DetectionSet, DocumentModel, ReviewAction, ReviewState, RenderedOutput, ResidueRun, RuleRegistry, Span,
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

  /** Decide las detecciones pendientes: verdadera -> aceptar; bandera correcta -> la resuelve la bandera; si no -> falso positivo. */
  const decidirPendientes = (): void => {
    const hechas = new Set<string>();
    for (const id of [...st.order]) {
      const d = st.detections[id];
      if (d === undefined || d.status !== 'pendiente') continue;
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

  decidirPendientes();
  // Banderas: la cita se mantiene (rechaza el radicado vinculado); con gold `debe_generalizarse` sobre su tramo se reemplaza con 'o1'.
  for (const f of Object.values(st.flags)) {
    if (f.type === 'CITA_JURISPRUDENCIAL') { act({ kind: 'resolver_bandera', flagId: f.id, resolution: 'mantener' }); continue; }
    if (generaliza({ ...f.span })) {
      const ok = act({ kind: 'resolver_bandera', flagId: f.id, resolution: 'reemplazar', optionId: 'o1' }, true);
      if (!ok) act({ kind: 'resolver_bandera', flagId: f.id, resolution: 'mantener' });
    } else act({ kind: 'resolver_bandera', flagId: f.id, resolution: 'mantener' });
  }
  // Sugerencias: aplicar 'o1' (con el primer departamento si hay opciones de lugar) si su tramo solapa gold con `debe_generalizarse`.
  for (const s of Object.values(st.suggestions)) {
    if (s.status !== 'pendiente') continue;
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
    decidirPendientes();
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
  return {
    state: st,
    salidaPrimera: salidaDe(dc, p1.out),
    salidaFinal: salidaDe(dc, pn.out),
    hitsPrimeraVuelta: p1.run.result.hits.length,
    hitsUltimaVuelta: pn.run.result.hits.length,
    hitsResidue: p1.run.result.hits.map((h) => ({ parte: seccionDe(h.sectionIndex), start: h.start, end: h.end })),
    vueltas,
    convergio,
    rechazadas,
  };
}

/** Completa la entrada de las métricas con lo que dejó el oráculo (10.3.4). */
export function conOraculo(entrada: EntradaDocumento, o: ResultadoOraculo): EntradaDocumento {
  return {
    ...entrada,
    salida: o.salidaPrimera, salidaFinal: o.salidaFinal,
    hitsPrimeraVuelta: o.hitsPrimeraVuelta, hitsUltimaVuelta: o.hitsUltimaVuelta, hitsResidue: o.hitsResidue,
  };
}

export type { HallazgoEscaner };
export { escanearResiduos };
