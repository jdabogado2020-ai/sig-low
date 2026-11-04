// Seguimiento del modelo en la Revisión (8.2.6, 6.11.3): tiempo restante (M-65 tras 2 bloques), pestaña oculta (M-62), aviso de
// demora desde la mitad del presupuesto (M-63) y plan B automático al agotarse el presupuesto (M-64, `sin_tiempo`). Es un módulo
// y no un componente porque el presupuesto corre aunque el abogado no esté mirando la banda. No guarda texto del documento.
// El estado visible del modelo (`ModelProgress`) sigue siendo del ReviewState; aquí solo hay tiempos y banderas de la banda.
import { useEffect, useState } from 'preact/hooks';
import { obtenerRevision, suscribirDocumento } from '../../documento.ts';
import { obtenerVistaAnalisis, seguirSinModelo } from '../../analisis.ts';
import { registrarLimpieza } from '../../sesion.ts';
import { anunciar } from '../base/almacen.ts';
import { t } from '../../mensajes.ts';

/** 6.11.3: 60 s hasta terminar la primera ventana; después, `max(60 s, 2 × t₁ × ventanas)`. */
export const PRESUPUESTO_MINIMO_MS = 60_000;
export const FACTOR_DEL_PRESUPUESTO = 2;

export function presupuestoMs(t0: number, t1: number | null, calentamientoMs: number, ventanasTotales: number): number {
  if (t1 === null) return PRESUPUESTO_MINIMO_MS;
  const primera = Math.max(1, t1 - t0 - calentamientoMs);
  return Math.max(PRESUPUESTO_MINIMO_MS, FACTOR_DEL_PRESUPUESTO * primera * Math.max(1, ventanasTotales));
}

/** Tiempo restante estimado a partir de las ventanas hechas; `null` hasta que haya 2 (8.2.6). */
export function restanteMs(t0: number, ahora: number, calentamientoMs: number, ventanas: number, ventanasTotales: number): number | null {
  if (ventanas < 2 || ventanasTotales <= ventanas) return null;
  const transcurrido = Math.max(1, ahora - t0 - calentamientoMs);
  return (transcurrido / ventanas) * (ventanasTotales - ventanas);
}

export interface EstadoBanda {
  /** Documento al que pertenece el seguimiento. */
  docId: string | null;
  /** El modelo estuvo o está en curso en esta revisión. */
  conModelo: boolean;
  /** Tiempo restante estimado ya calculado (se actualiza al llegar cada ventana, no cada segundo). */
  restante: number | null;
  /** Pasada la mitad del presupuesto: M-63. */
  lenta: boolean;
  /** La pestaña estuvo oculta mientras el modelo corría: M-62. */
  oculta: boolean;
  /** El presupuesto se agotó y se pasó al plan B solo: M-64. */
  agotado: boolean;
}
const INICIAL: EstadoBanda = { docId: null, conModelo: false, restante: null, lenta: false, oculta: false, agotado: false };

let estado: EstadoBanda = INICIAL;
const oyentes = new Set<() => void>();
const poner = (parche: Partial<EstadoBanda>): void => {
  const nuevo = { ...estado, ...parche };
  if ((Object.keys(nuevo) as Array<keyof EstadoBanda>).every((k) => nuevo[k] === estado[k])) return;
  estado = nuevo;
  for (const o of [...oyentes]) o();
};
export function obtenerBanda(): EstadoBanda {
  return estado;
}
export function useBanda(): EstadoBanda {
  const [, forzar] = useState(0);
  useEffect(() => {
    const f = (): void => { forzar((n) => n + 1); };
    oyentes.add(f);
    return () => { oyentes.delete(f); };
  }, []);
  return estado;
}

let t0: number | null = null;
let t1: number | null = null;
let ventanasVistas = 0;
let temporizador: ReturnType<typeof setInterval> | undefined;

function parar(): void {
  if (temporizador !== undefined) { clearInterval(temporizador); temporizador = undefined; }
}

function evaluar(): void {
  const st = obtenerRevision();
  if (st === null || st.modelo.kind !== 'en_curso') { parar(); return; }
  // F10 (v1.1.3): mientras el detector se descarga no corre el presupuesto de 6.11.3; empieza cuando el detector arranca.
  if (obtenerVistaAnalisis().descargaModelo) { t0 = null; return; }
  if (t0 === null) { t0 = Date.now(); return; }
  const ahora = Date.now();
  const transcurrido = ahora - t0;
  const calentamiento = obtenerVistaAnalisis().modelo?.calentamientoMs ?? 0;
  const total = st.modelo.ventanasTotales;
  const presupuesto = presupuestoMs(t0, t1, calentamiento, total);
  if (transcurrido >= presupuesto) {
    parar();
    poner({ agotado: true, lenta: true });
    anunciar(t('M-64'));
    seguirSinModelo('sin_tiempo');
    return;
  }
  poner({ lenta: transcurrido >= presupuesto / 2 });
}

function alCambiar(): void {
  const st = obtenerRevision();
  if (st === null) {
    parar();
    t0 = null; t1 = null; ventanasVistas = 0;
    poner({ ...INICIAL });
    return;
  }
  if (estado.docId !== st.docId) {
    parar();
    t0 = null; t1 = null; ventanasVistas = 0;
    estado = { ...INICIAL, docId: st.docId };
  }
  const m = st.modelo;
  if (m.kind === 'en_curso') {
    const ahora = Date.now();
    if (t0 === null && !obtenerVistaAnalisis().descargaModelo) t0 = ahora;
    if (m.ventanas >= 1 && t1 === null) t1 = ahora;
    const calentamiento = obtenerVistaAnalisis().modelo?.calentamientoMs ?? 0;
    if (m.ventanas !== ventanasVistas) {
      ventanasVistas = m.ventanas;
      poner({ restante: t0 === null ? null : restanteMs(t0, ahora, calentamiento, m.ventanas, m.ventanasTotales) });
    }
    poner({ conModelo: true });
    if (temporizador === undefined) temporizador = setInterval(evaluar, 1000);
    return;
  }
  parar();
  poner({ conModelo: estado.conModelo || m.kind === 'terminado' || (m.kind === 'plan_b' && m.ventanas !== undefined), restante: null, lenta: false });
}

suscribirDocumento(alCambiar);
registrarLimpieza(() => {
  parar();
  t0 = null; t1 = null; ventanasVistas = 0;
  poner({ ...INICIAL });
});
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && obtenerRevision()?.modelo.kind === 'en_curso') poner({ oculta: true });
  });
}
