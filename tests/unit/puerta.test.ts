// T-IU-01 (parte de unidad) · exportGate (6.4.8, D-24): un caso por cada GateReason, la puerta abierta solo con todos los puntos resueltos,
// INV-G06 (no se copia ni exporta con la puerta cerrada), INV-R07 (residuos desactualizados y detecciones nuevas) e INV-R11
// (MODELO_EN_CURSO). D-24: las banderas sin confirmar ya no cierran la puerta y el recordatorio es una sola confirmación. Datos ficticios; el estado se arma a mano porque la puerta solo lee estados y conteos.
import { describe, expect, it } from 'vitest';
import { contarBanderasSinConfirmar, contarPendientes, exportGate } from '../../src/core/review/puerta';
import type {
  Detection, DetectionStatus, Flag, GateReason, ModelProgress, ReminderConfirmation, ResidueResult, ReviewState,
} from '../../src/core/types';

const TODAS: readonly GateReason[] = ['PENDIENTES', 'MODELO_EN_CURSO', 'RESIDUOS_NO_EJECUTADA', 'RESIDUOS_DESACTUALIZADA',
  'RESIDUOS_ENCONTRADOS', 'DETECCIONES_NUEVAS', 'RECORDATORIO'];

const terminado: ModelProgress = { kind: 'terminado', ventanas: 3, respaldo: false };
const confirmacion = (revisado: boolean): ReminderConfirmation => ({ revisado });
const TODAS_MARCADAS = confirmacion(true);

const deteccion = (n: number, status: DetectionStatus): Detection => ({ id: `det_${n}`, status } as unknown as Detection);
const bandera = (n: number, acknowledged: boolean): Flag => ({ id: `flg_${n}`, acknowledged } as unknown as Flag);

function estado(parche: { dets?: DetectionStatus[]; banderas?: boolean[]; modelo?: ModelProgress; revision?: number } = {}): ReviewState {
  const dets = parche.dets ?? ['aceptada', 'rechazada', 'editada'];
  return {
    docId: 'doc_1', revision: parche.revision ?? 7,
    detections: Object.fromEntries(dets.map((s, i) => [`det_${i}`, deteccion(i, s)])),
    order: [], entities: {}, suggestions: {},
    flags: Object.fromEntries((parche.banderas ?? [true]).map((a, i) => [`flg_${i}`, bandera(i, a)])),
    spanEdits: {}, committed: false, modelo: parche.modelo ?? terminado,
  } as unknown as ReviewState;
}
const residuo = (revision: number, hits = 0, nuevas = 0): ResidueResult => ({
  revision, ranAt: '2026-10-30T10:00:00-05:00', valuesSearched: 12, modes: ['literal', 'normalizado', 'digitos', 'variante'],
  hits: Array.from({ length: hits }, () => ({ sectionIndex: 0, start: 0, end: 1, partId: 'prt_1', partStart: 0, entityId: 'ent_1', mode: 'literal' })) as ResidueResult['hits'],
  newDetections: nuevas,
});

describe('T-IU-01 exportGate · un estado por cada GateReason (6.4.8)', () => {
  it('INV-G06 con todos los puntos resueltos la puerta está abierta y no trae motivos', () => {
    const s = estado();
    expect(exportGate(s, residuo(s.revision), TODAS_MARCADAS)).toEqual({ ok: true, reasons: [] });
  });

  it('INV-G06 PENDIENTES: una sola detección pendiente cierra la puerta', () => {
    const s = estado({ dets: ['aceptada', 'pendiente'] });
    expect(exportGate(s, residuo(s.revision), TODAS_MARCADAS)).toEqual({ ok: false, reasons: ['PENDIENTES'] });
  });

  it('INV-G06 PENDIENTES D-16: una mención ambigua de la lista sin persona elegida cuenta como pendiente aunque esté aceptada; rechazada no', () => {
    // La entidad propia de la mención ambigua lleva la clave de su tramo (`AMBIGUA:`, entities.ts); la de la persona, `LISTA:`.
    const amb = (n: number, status: DetectionStatus): Detection => ({ id: `det_${n}`, status, entityId: `ent_${n}` } as unknown as Detection);
    const s = {
      ...estado({ dets: [] }),
      detections: { det_1: amb(1, 'aceptada'), det_2: amb(2, 'aceptada'), det_3: amb(3, 'rechazada') },
      entities: { ent_1: { id: 'ent_1', canonicalKey: 'AMBIGUA:prt_1:10-16' }, ent_2: { id: 'ent_2', canonicalKey: 'LISTA:cas_1' },
        ent_3: { id: 'ent_3', canonicalKey: 'AMBIGUA:prt_1:40-46' } },
    } as unknown as ReviewState;
    expect(contarPendientes(s)).toBe(1);
    expect(exportGate(s, residuo(s.revision), TODAS_MARCADAS)).toEqual({ ok: false, reasons: ['PENDIENTES'] });
    // Elegida la persona (la detección ya está en la entidad de la lista), la puerta se abre.
    const elegida = { ...s, detections: { ...s.detections, det_1: { ...amb(1, 'aceptada'), entityId: 'ent_2' } } } as unknown as ReviewState;
    expect(exportGate(elegida, residuo(elegida.revision), TODAS_MARCADAS)).toEqual({ ok: true, reasons: [] });
  });

  it('INV-G06 D-24: una bandera sin confirmar ya no cierra la puerta (queda como punto para revisar)', () => {
    const s = estado({ banderas: [true, false] });
    expect(contarBanderasSinConfirmar(s)).toBe(1);
    expect(exportGate(s, residuo(s.revision), TODAS_MARCADAS)).toEqual({ ok: true, reasons: [] });
  });

  it('INV-R11 MODELO_EN_CURSO: mientras el modelo está en curso la puerta sigue cerrada aunque no haya pendientes', () => {
    const s = estado({ modelo: { kind: 'en_curso', ventanas: 2, ventanasTotales: 9 } });
    expect(contarPendientes(s)).toBe(0);
    expect(exportGate(s, residuo(s.revision), TODAS_MARCADAS)).toEqual({ ok: false, reasons: ['MODELO_EN_CURSO'] });
    const sinTotal = estado({ modelo: { kind: 'en_curso', ventanas: 0, ventanasTotales: 0 } });
    expect(exportGate(sinTotal, residuo(sinTotal.revision), TODAS_MARCADAS).reasons).toEqual(['MODELO_EN_CURSO']);
  });

  it('INV-R11 con el modelo terminado (principal o respaldo) o en plan B declarado, MODELO_EN_CURSO no aparece', () => {
    const modelos: ModelProgress[] = [
      { kind: 'terminado', ventanas: 9, respaldo: false },
      { kind: 'terminado', ventanas: 9, respaldo: true },
      { kind: 'plan_b', causa: 'no_descargado' },
      { kind: 'plan_b', causa: 'desactivado' },
      { kind: 'plan_b', causa: 'fallo_carga' },
      { kind: 'plan_b', causa: 'memoria_insuficiente' },
      { kind: 'plan_b', causa: 'cancelado', ventanas: 3, ventanasTotales: 23 },
      { kind: 'plan_b', causa: 'sin_tiempo' },
    ];
    for (const modelo of modelos) {
      const s = estado({ modelo });
      expect(exportGate(s, residuo(s.revision), TODAS_MARCADAS)).toEqual({ ok: true, reasons: [] });
    }
  });

  it('INV-G06 RESIDUOS_NO_EJECUTADA: sin resultado de la búsqueda la puerta está cerrada', () => {
    expect(exportGate(estado(), null, TODAS_MARCADAS)).toEqual({ ok: false, reasons: ['RESIDUOS_NO_EJECUTADA'] });
  });

  it('INV-R07 RESIDUOS_DESACTUALIZADA: si la revisión cambió después de la búsqueda, el resultado ya no vale', () => {
    const s = estado({ revision: 8 });
    expect(exportGate(s, residuo(7), TODAS_MARCADAS)).toEqual({ ok: false, reasons: ['RESIDUOS_DESACTUALIZADA'] });
    expect(exportGate(s, residuo(9), TODAS_MARCADAS).reasons).toContain('RESIDUOS_DESACTUALIZADA');
    expect(exportGate(s, residuo(8), TODAS_MARCADAS).ok).toBe(true);
  });

  it('INV-G06 RESIDUOS_ENCONTRADOS: cualquier hallazgo de las pasadas 1 y 2 o de los residuos de la 3 cierra la puerta', () => {
    const s = estado();
    expect(exportGate(s, residuo(s.revision, 2), TODAS_MARCADAS)).toEqual({ ok: false, reasons: ['RESIDUOS_ENCONTRADOS'] });
  });

  it('INV-R07 DETECCIONES_NUEVAS: la pasada 3 halló datos nuevos aunque no haya residuos', () => {
    const s = estado();
    expect(exportGate(s, residuo(s.revision, 0, 3), TODAS_MARCADAS)).toEqual({ ok: false, reasons: ['DETECCIONES_NUEVAS'] });
  });

  it('INV-G06 RECORDATORIO D-24: sin la confirmación única «Revisé la vista previa…» la puerta está cerrada', () => {
    const s = estado();
    expect(exportGate(s, residuo(s.revision), confirmacion(false))).toEqual({ ok: false, reasons: ['RECORDATORIO'] });
    expect(exportGate(s, residuo(s.revision), confirmacion(true))).toEqual({ ok: true, reasons: [] });
  });

  it('T-IU-01 cada GateReason aparece en algún estado y solo cuando corresponde; los motivos se acumulan en el orden de 6.4.8', () => {
    const vistos = new Set<GateReason>();
    const casos: Array<[ReviewState, ResidueResult | null, ReminderConfirmation]> = [
      [estado({ dets: ['pendiente'] }), null, confirmacion(false)],
      [estado({ modelo: { kind: 'en_curso', ventanas: 1, ventanasTotales: 4 } }), residuo(7), TODAS_MARCADAS],
      [estado(), residuo(1, 1, 1), TODAS_MARCADAS],
    ];
    for (const [s, r, c] of casos) for (const m of exportGate(s, r, c).reasons) vistos.add(m);
    expect([...vistos].sort()).toEqual([...TODAS].sort());
    const todo = exportGate(estado({ dets: ['pendiente'], banderas: [false], modelo: { kind: 'en_curso', ventanas: 0, ventanasTotales: 0 } }),
      residuo(1, 1, 1), confirmacion(false));
    expect(todo.reasons).toEqual(['PENDIENTES', 'MODELO_EN_CURSO', 'RESIDUOS_DESACTUALIZADA', 'RESIDUOS_ENCONTRADOS',
      'DETECCIONES_NUEVAS', 'RECORDATORIO']);
    expect(todo.ok).toBe(false);
  });

  it('los contadores de pendientes y de banderas sin confirmar no cuentan las decididas', () => {
    const s = estado({ dets: ['pendiente', 'aceptada', 'pendiente', 'rechazada', 'editada'], banderas: [false, true, false] });
    expect(contarPendientes(s)).toBe(2);
    expect(contarBanderasSinConfirmar(s)).toBe(2);
  });

  it('la puerta es pura: no modifica sus argumentos y da el mismo resultado al repetir', () => {
    const s = estado({ dets: ['pendiente'] });
    const r = residuo(7, 1);
    const c = confirmacion(false);
    const antes = JSON.stringify([s, r, c]);
    const a = exportGate(s, r, c);
    const b = exportGate(s, r, c);
    expect(a).toEqual(b);
    expect(JSON.stringify([s, r, c])).toBe(antes);
  });
});
