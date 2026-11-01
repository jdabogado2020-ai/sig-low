// Condición para copiar o exportar (plan 6.4.8, INV-G06, INV-R07, INV-R11). PC-5. Código puro de core/: sin DOM ni red.
// La puerta se abre solo si se cumplen a la vez los ocho puntos; cada punto que falla aporta su `GateReason`, en este orden:
//   PENDIENTES · BANDERAS · MODELO_EN_CURSO · RESIDUOS_NO_EJECUTADA / RESIDUOS_DESACTUALIZADA · RESIDUOS_ENCONTRADOS ·
//   DETECCIONES_NUEVAS · RECORDATORIO.
// No lee texto del documento: solo estados, conteos y la revisión del resultado de residuos.
import type { ExportGate, ExportGateFn, GateReason, ResidueResult, ReviewState } from '../types.ts';
import { esAmbigua } from '../entities.ts';

/**
 * Detecciones con estado `pendiente` (incluye las que llegan del modelo y los residuos incorporados). D-16 (PB-3-r3): una mención
 * ambigua de la lista (la variante que comparten dos o más personas) cuenta aunque el revisor la haya aceptado, hasta que elige a
 * la persona, la separa o la rechaza (review/ambiguas.ts): es una decisión obligatoria y cierra la puerta con `PENDIENTES`.
 */
export function contarPendientes(state: ReviewState): number {
  let n = 0;
  for (const d of Object.values(state.detections)) if (d.status === 'pendiente' || esAmbigua(state, d)) n++;
  return n;
}

/** Banderas sin confirmar (`acknowledged` falso). */
export function contarBanderasSinConfirmar(state: ReviewState): number {
  let n = 0;
  for (const f of Object.values(state.flags)) if (!f.acknowledged) n++;
  return n;
}

/**
 * 6.4.8 · ok ⇔ 0 pendientes ∧ 0 banderas sin confirmar ∧ modelo `terminado` o `plan_b` ∧ residuos ejecutados sobre esta misma
 * `revision` con 0 hallazgos y 0 detecciones nuevas ∧ las tres casillas del recordatorio. Mientras el modelo está `en_curso` la
 * puerta sigue cerrada aunque no haya pendientes (INV-R11). Una acción que sube `revision` deja el resultado de residuos
 * desactualizado (INV-R07). Es pura y se vuelve a evaluar en cada manejador: nunca se guarda su resultado.
 */
export const exportGate: ExportGateFn = (state, residue: ResidueResult | null, reminder): ExportGate => {
  const reasons: GateReason[] = [];
  if (contarPendientes(state) > 0) reasons.push('PENDIENTES');
  if (contarBanderasSinConfirmar(state) > 0) reasons.push('BANDERAS');
  if (state.modelo.kind === 'en_curso') reasons.push('MODELO_EN_CURSO');
  if (residue === null) {
    reasons.push('RESIDUOS_NO_EJECUTADA');
  } else {
    if (residue.revision !== state.revision) reasons.push('RESIDUOS_DESACTUALIZADA');
    if (residue.hits.length > 0) reasons.push('RESIDUOS_ENCONTRADOS');
    if (residue.newDetections > 0) reasons.push('DETECCIONES_NUEVAS');
  }
  if (!(reminder.biometricos && reminder.reservaLegal && reminder.estrategia)) reasons.push('RECORDATORIO');
  return { ok: reasons.length === 0, reasons };
};
