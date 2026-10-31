// Banda del modelo de apoyo (8.2.6, 8.5.12), encima del texto, con `role="status"`. En curso: título M-180, barra `<progress>` con
// «Modelo de apoyo: bloque {k} de {n}» (M-165), tiempo restante M-65 tras 2 bloques, M-62 si la pestaña estuvo oculta, M-174 si va con
// 1 hilo, M-63 desde la mitad del presupuesto y «Seguir sin el modelo» (confirmación M-173). Terminado: M-167 en una línea (M-170 si
// se usó la versión reducida). Plan B: M-172 (o M-171 si se acabó la memoria), persistente hasta salir de la Revisión.
import { useState } from 'preact/hooks';
import type { ModelProgress, PlanBCause } from '../../../core/types.ts';
import { seguirSinModelo } from '../../analisis.ts';
import { Dialogo } from '../../dialogo.tsx';
import { CAUSA_PLAN_B, ROTULOS, t } from '../../mensajes.ts';
import { formatoTiempo } from '../../Procesando.tsx';
import { obtenerVistaAnalisis, useAnalisis } from '../../analisis.ts';
import { useRevisionUi } from '../base/almacen.ts';
import { useBanda } from './banda.ts';
import { tp } from './textos.ts';

/** Texto del plan B declarado (M-172; M-171 si se acabó la memoria con el avance conocido; M-169 si no cupo ni empezó). */
export function textoDePlanB(m: Extract<ModelProgress, { kind: 'plan_b' }>): string {
  const causa: PlanBCause = m.causa;
  if (causa === 'memoria_insuficiente') {
    if (m.ventanas !== undefined && m.ventanasTotales !== undefined && m.ventanasTotales > 0) {
      return t('M-171', { k: Math.min(m.ventanas + 1, m.ventanasTotales), n: m.ventanasTotales });
    }
    return t('M-169');
  }
  return t('M-172', { causa: CAUSA_PLAN_B[causa] });
}

export function Banda() {
  const { state } = useRevisionUi();
  const banda = useBanda();
  const analisis = useAnalisis();
  const [confirmar, setConfirmar] = useState(false);
  if (state === null) return null;
  const m = state.modelo;

  if (m.kind === 'terminado') {
    return (
      <section class="banda banda-plegada" data-prueba="banda-modelo" data-estado="terminado" aria-label={tp('M-1425')}>
        <p role="status">{t('M-167')}{m.respaldo ? ` ${t('M-170')}` : ''}</p>
      </section>
    );
  }
  if (m.kind === 'plan_b') {
    return (
      <section class="banda banda-plan-b" data-prueba="banda-modelo" data-estado="plan_b" aria-label={tp('M-1425')}>
        <div role="status">
          {banda.agotado ? <p data-prueba="banda-agotado">{t('M-64')}</p> : null}
          <p data-prueba="banda-plan-b">{textoDePlanB(m)}</p>
        </div>
      </section>
    );
  }

  const total = m.ventanasTotales;
  const k = Math.min(m.ventanas + 1, Math.max(1, total));
  const avance = total > 0 ? t('M-165', { k, n: total }) : tp('M-1430');
  const calentamiento = obtenerVistaAnalisis().modelo?.calentamientoMs ?? analisis.modelo?.calentamientoMs ?? 0;
  const unHilo = typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated;
  return (
    <section class="banda banda-en-curso" data-prueba="banda-modelo" data-estado="en_curso" aria-label={tp('M-1425')}>
      <h2 class="banda-titulo">{t('M-180')}</h2>
      <div role="status">
        <p data-prueba="banda-avance">{avance}</p>
        {banda.restante !== null ? <p data-prueba="banda-restante">{t('M-65', { tiempo: formatoTiempo(banda.restante) })}</p> : null}
        {unHilo && total > 0 && calentamiento > 0 ? <p>{t('M-174', { tiempo: formatoTiempo(total * calentamiento) })}</p> : null}
        {banda.oculta ? <p data-prueba="banda-oculta">{t('M-62')}</p> : null}
        {banda.lenta ? <p data-prueba="banda-lenta">{t('M-63')}</p> : null}
      </div>
      {total > 0
        ? <progress value={m.ventanas} max={total} aria-label={tp('M-1428')} aria-valuetext={avance} />
        : <progress aria-label={tp('M-1428')} aria-valuetext={avance} />}
      <div class="acciones">
        <button type="button" class="secundario" data-prueba="seguir-sin-modelo" onClick={() => { setConfirmar(true); }}>{t(ROTULOS.seguir_sin_el_modelo)}</button>
      </div>
      <Dialogo abierto={confirmar} titulo={t(ROTULOS.seguir_sin_el_modelo)} onCerrar={() => { setConfirmar(false); }}>
        <p>{t('M-173')}</p>
        <div class="acciones">
          <button type="button" onClick={() => { setConfirmar(false); seguirSinModelo(); }}>{t(ROTULOS.seguir_sin_el_modelo)}</button>
          <button type="button" class="secundario" onClick={() => { setConfirmar(false); }}>{tp('M-1426')}</button>
        </div>
      </Dialogo>
    </section>
  );
}
