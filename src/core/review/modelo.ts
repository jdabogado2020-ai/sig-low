// Estado del modelo en la revisión: casos `incorporar_modelo` y `declarar_plan_b` del reductor (6.4.4, 6.4.8, 6.11.2) y su
// traducción al informe (6.8). PB-6. Código puro de core/: sin DOM ni red.
//
// La lógica de los dos casos vive en `reduce()` de entities.ts (PB-3), que es el único sitio donde se puede tocar el estado de
// la revisión sin duplicar la numeración de marcadores ni el orden de lectura. Este módulo es la puerta de entrada que usa la
// interfaz: arma la acción, llama al reductor con `doc` (orden de lectura de las partes) y comprueba el contrato del delta
// antes de despacharlo.
import { applyReviewAction } from '../entities.ts';
import type { ReviewContext } from '../entities.ts';
import type {
  DetectionSet, ModelProgress, ModelState, PlanBCause, ReviewOutcome, ReviewState,
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
 */
export function incorporarModelo(state: ReviewState, ventana: number, ventanasTotales: number, delta: DetectionSet,
  ctx: ReviewContext): ReviewOutcome {
  return applyReviewAction(state, { kind: 'incorporar_modelo', ventana, ventanasTotales, delta }, ctx);
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
