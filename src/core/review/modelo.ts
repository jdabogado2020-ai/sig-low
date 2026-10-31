// Estado del modelo en la revisión: casos `incorporar_modelo` y `declarar_plan_b` del reductor (6.4.4, 6.4.8, 6.11.2) y su
// traducción al informe (6.8). PB-6. Código puro de core/: sin DOM ni red.
//
// La lógica de los dos casos vive en `reduce()` de entities.ts (PB-3), que es el único sitio donde se puede tocar el estado de
// la revisión sin duplicar la numeración de marcadores ni el orden de lectura. Este módulo es la puerta de entrada que usa la
// interfaz: arma la acción, llama al reductor con `doc` (orden de lectura de las partes) y comprueba el contrato del delta
// antes de despacharlo.
import {
  applyReviewAction, cedeAnteModelo, cryptoIds, esPropuestaSobreLista, extensionSobreRechazada, orgKey, personKey,
} from '../entities.ts';
import type { ReviewContext } from '../entities.ts';
import { resolveRemainder } from '../merge.ts';
import type {
  DetectableType, Detection, DetectionCandidate, DetectionId, DetectionSet, EntityId, ModelProgress, ModelState, Part, PlanBCause,
  ReviewOutcome, ReviewState, Role, RuleRegistry, Span,
} from '../types.ts';

/** Causas del plan B en palabras (8.5.12, causas de M-172). La plantilla del informe legible las usa tal cual. */
export const PLAN_B_EN_PALABRAS: Readonly<Record<PlanBCause, string>> = {
  no_descargado: 'el modelo no está descargado',
  desactivado: 'usted lo desactivó',
  fallo_carga: 'no se pudo preparar',
  memoria_insuficiente: 'el equipo se quedó sin memoria',
  cancelado: 'usted decidió seguir sin él',
  sin_tiempo: 'superó el tiempo previsto',
};

/**
 * Estado del modelo al abrir la revisión (6.11.2, paso 1): `en_curso` con el total aún desconocido, o plan B `desactivado`
 * si el abogado apagó el modelo.
 */
export function modeloInicial(desactivado: boolean): ModelProgress {
  return desactivado ? { kind: 'plan_b', causa: 'desactivado' } : { kind: 'en_curso', ventanas: 0, ventanasTotales: 0 };
}

/**
 * `incorporar_modelo` (6.4.4): añade el delta de una ventana como detecciones `pendiente` de `source 'modelo'`. No toca lo ya
 * existente (INV-R12), ignora una ventana repetida o anterior sin sumar `revision`, y fija `modelo` en `en_curso` o `terminado`.
 * `ventana` cuenta ventanas incorporadas (1 a N), no el índice 0 del motor.
 *
 * Única excepción a INV-R12 (D-03 B y E, 31-oct): la fusión propone que una detección de la lista ceda ante el nombre completo
 * del modelo o lo tome. El reductor la acepta solo si esa detección sigue intacta (`listaIntacta` en entities.ts). Si el usuario
 * ya actuó sobre ella, aquí la propuesta vuelve a ser el tramo del modelo partido alrededor de lo que no cede, con cada resto
 * por 7.11.2 (recorte R-MOD-03, confianza baja): el resultado de antes de D-03, sin perder el resto del nombre.
 */
export function incorporarModelo(state: ReviewState, ventana: number, ventanasTotales: number, delta: DetectionSet,
  ctx: ReviewContext): ReviewOutcome {
  return applyReviewAction(state, { kind: 'incorporar_modelo', ventana, ventanasTotales, delta: restosDePropuestas(state, ventana, delta, ctx) }, ctx);
}

const SIN_REGLAS: RuleRegistry = { rerun: () => null };
const tocan = (x: Span, d: Detection): boolean => x.partId === d.partId && x.start < d.end && d.start < x.end;

/** Trozos de [d.start, d.end) que no cubre ningún tramo de `fuera`. */
function libres(d: Detection, fuera: readonly Span[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let cur = d.start;
  for (const x of [...fuera].sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (x.start > cur) out.push([cur, Math.min(x.start, d.end)]);
    cur = Math.max(cur, x.end);
    if (cur >= d.end) break;
  }
  if (cur < d.end) out.push([cur, d.end]);
  return out.filter(([s, e]) => e > s);
}

/** Tipos del modelo cuyos restos tienen clave propia en 7.11.2 (`remainderKeyFromModel` de merge.ts): nombres y lugares sin DIVIPOLA. */
const CON_RESTOS: ReadonlySet<DetectableType> = new Set<DetectableType>(['PERSONA', 'EMPRESA', 'EPS', 'IPS', 'ENTIDAD', 'PROVEEDOR', 'LUGAR']);

/**
 * M-12 · La extensión de la lista sobre una mención rechazada de la misma entidad vuelve a ser el tramo del modelo que la fusión
 * extendió: misma posición, confianza y puntaje, `source 'modelo'`, clave de persona u organización y entidad propia.
 */
function comoTramoDelModelo(d0: Detection, part: Part): Detection {
  const persona = d0.type === 'PERSONA';
  const t: Detection = { id: d0.id, docId: d0.docId, partId: d0.partId, start: d0.start, end: d0.end, text: d0.text, type: d0.type,
    source: 'modelo', precedence: 6, confidence: d0.confidence, score: d0.score,
    canonicalKey: persona ? personKey(d0.text, part.kind) : orgKey(d0.text, part.kind), status: 'pendiente', entityId: '' as EntityId,
    replacement: { proposedTemplate: d0.replacement.proposedTemplate }, nerLabel: d0.nerLabel ?? (persona ? 'PER' : 'ORG') };
  t.role = persona ? 'OTRA_PERSONA' : d0.type as Role;
  return t;
}

/**
 * Reemplaza en el delta cada detección que el reductor no aceptaría por sus restos como tramos del modelo (7.11.2): la propuesta
 * sobre la lista que no cede y, desde M-13 (PB-2-r5), cualquier tramo del modelo que `blocks` descartaría porque se solapa con una
 * detección no rechazada (manual, de residuos, de otra ventana) o con una edición de tramo. Una detección rechazada no bloquea un
 * tramo distinto (M-12, 6.4.4): no cuenta. Con la ventana ignorada, sin el texto de las partes (`ctx.doc`) o sin nada que partir,
 * devuelve el mismo delta.
 */
function restosDePropuestas(state: ReviewState, ventana: number, delta: DetectionSet, ctx: ReviewContext): DetectionSet {
  if (state.modelo.kind !== 'en_curso' || ventana <= state.modelo.ventanas || ctx.doc === undefined) return delta;
  const partes = new Map(ctx.doc.parts.map((p) => [p.id, p]));
  const ids = ctx.ids ?? cryptoIds;
  const vivas = Object.values(state.detections).filter((o) => o.status !== 'rechazada');
  const rechazadas = Object.values(state.detections).filter((o) => o.status === 'rechazada');
  let cambio = false;
  const detections: Detection[] = [];
  for (const dv of delta.detections) {
    const part = partes.get(dv.partId);
    // El reductor descarta el tramo idéntico a uno rechazado (6.4.4) y el id repetido: se le deja tal cual.
    if (part === undefined || state.detections[dv.id] !== undefined
      || rechazadas.some((r) => r.partId === dv.partId && r.start === dv.start && r.end === dv.end)) { detections.push(dv); continue; }
    const d0 = extensionSobreRechazada(state, dv) ? comoTramoDelModelo(dv, part) : dv;
    if (d0 !== dv) cambio = true;
    const tocadas = vivas.filter((o) => tocan(o, d0));
    const ediciones = Object.values(state.spanEdits).map((x) => x.span).filter((x) => tocan(x, d0));
    const propuesta = esPropuestaSobreLista(state, d0);
    const entra = ediciones.length === 0 && (propuesta ? tocadas.every((o) => cedeAnteModelo(state, o, d0, ctx.caseList)) : tocadas.length === 0);
    if (entra || !CON_RESTOS.has(d0.type) || (!propuesta && d0.source !== 'modelo')) { detections.push(d0); continue; }
    cambio = true;
    const role = d0.type === 'PERSONA' ? 'OTRA_PERSONA' : undefined;
    const base: DetectionCandidate = { partId: d0.partId, start: d0.start, end: d0.end, type: d0.type, source: 'modelo',
      nerLabel: d0.nerLabel ?? (d0.type === 'PERSONA' ? 'PER' : 'ORG'), confidence: 'baja', score: d0.score, canonicalKey: d0.canonicalKey,
      ...(role === undefined ? {} : { role }) };
    for (const [s, e] of libres(d0, [...tocadas, ...ediciones])) {
      const r = resolveRemainder(part, base, s, e, SIN_REGLAS);
      if (r === null) continue;
      const resto: Detection = { id: ids.next('det') as DetectionId, docId: d0.docId, partId: d0.partId, start: r.start, end: r.end,
        text: part.text.slice(r.start, r.end), type: d0.type, source: 'modelo', precedence: r.precedence, confidence: r.confidence,
        score: r.score, canonicalKey: r.canonicalKey, status: 'pendiente', entityId: '' as EntityId,
        replacement: { proposedTemplate: d0.replacement.proposedTemplate } };
      resto.nerLabel = base.nerLabel ?? 'PER';
      if (role !== undefined) resto.role = role;
      detections.push(resto);
    }
  }
  return cambio ? { ...delta, detections } : delta;
}

/**
 * `declarar_plan_b` (6.4.4): el modelo no terminó; la revisión sigue con reglas y lista, y el informe lo declara.
 * Solo vale con el modelo `en_curso` (si no, `TIPO_NO_PERMITIDO`).
 */
export function declararPlanB(state: ReviewState, causa: PlanBCause, ctx: ReviewContext): ReviewOutcome {
  return applyReviewAction(state, { kind: 'declarar_plan_b', causa }, ctx);
}

/** Datos del modelo que el informe necesita del estado de la revisión (6.8). `null` mientras el modelo sigue en curso. */
export interface ModeloDelInforme { estado: ModelState; planB: boolean; ventanas?: number; ventanasTotales?: number }

/**
 * Traduce `ReviewState.modelo` a los campos de `motor.modelo` del informe. `planB` es verdadero si y solo si el estado no es
 * `usado` ni `respaldo_base` (INV-I04). El estado `plan_b` no guarda las ventanas incorporadas: las aporta quien llama
 * (`avance`, el último `en_curso` que vio la interfaz). Con plan B, `ventanas < ventanasTotales` o ambos campos ausentes.
 */
export function modeloParaInforme(modelo: ModelProgress, avance?: { ventanas: number; ventanasTotales: number }): ModeloDelInforme | null {
  switch (modelo.kind) {
    case 'en_curso':
      return null;
    case 'terminado':
      return { estado: modelo.respaldo ? 'respaldo_base' : 'usado', planB: false, ventanas: modelo.ventanas, ventanasTotales: modelo.ventanas };
    case 'plan_b': {
      const out: ModeloDelInforme = { estado: modelo.causa, planB: true };
      if (avance !== undefined && Number.isInteger(avance.ventanas) && Number.isInteger(avance.ventanasTotales)
        && avance.ventanasTotales > 0 && avance.ventanas >= 0 && avance.ventanas < avance.ventanasTotales) {
        out.ventanas = avance.ventanas;
        out.ventanasTotales = avance.ventanasTotales;
      }
      return out;
    }
  }
}
