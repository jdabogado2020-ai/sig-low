// Contador, recorrido de pendientes y «Continuar» de la Revisión (8.2.6). El contador (M-66, M-67 en cero, M-181 con el modelo en
// curso) es una región `status` y cuenta todo, sin importar los filtros. «Continuar» queda con `aria-disabled="true"` (enfocable) y M-68
// debajo (más M-508 si el modelo sigue en curso) hasta que haya 0 pendientes, 0 banderas sin confirmar y el modelo terminado o en plan B.
import { actualizar, ir } from '../../estado.ts';
import { ROTULOS, t } from '../../mensajes.ts';
import { useRevisionUi } from '../base/almacen.ts';
import { pendientesTotales } from '../base/presentacion.ts';
import { sinConfirmar } from './Banderas.tsx';
import { irAlPendiente } from './navegacion.ts';
import { tp } from './textos.ts';

export function Progreso() {
  const { state } = useRevisionUi();
  if (state === null) return null;
  const pend = pendientesTotales(state);
  const ban = sinConfirmar(state);
  const enCurso = state.modelo.kind === 'en_curso';
  const listo = pend === 0 && ban === 0 && !enCurso;
  const contador = pend === 0 && ban === 0 ? t('M-67') : t('M-66', { n: pend, m: ban });
  const faltan = state.modelo.kind === 'en_curso' ? Math.max(0, state.modelo.ventanasTotales - state.modelo.ventanas) : 0;
  const ayuda = enCurso && state.modelo.kind === 'en_curso' && state.modelo.ventanasTotales > 0
    ? `${t('M-68')} ${t('M-508', { n: faltan, total: state.modelo.ventanasTotales })}` : t('M-68');
  return (
    <div class="progreso-revision">
      <div class="fila-progreso">
        <p class="contador-revision" role="status" aria-label={tp('M-1835')} data-prueba="contador-revision">
          <span data-prueba="contador-texto">{contador}</span>
          {enCurso ? <span data-prueba="contador-modelo">{` ${t('M-181')}`}</span> : null}
        </p>
        <div class="acciones" role="group" aria-label={tp('M-1836')}>
          <button type="button" class="secundario" disabled={pend + ban === 0} onClick={() => { irAlPendiente(-1); }}>{t(ROTULOS.anterior_pendiente)}</button>
          <button type="button" class="secundario" disabled={pend + ban === 0} onClick={() => { irAlPendiente(1); }}>{t(ROTULOS.siguiente_pendiente)}</button>
          <button
            type="button"
            data-prueba="continuar"
            aria-disabled={!listo}
            aria-describedby={listo ? undefined : 'ayuda-continuar'}
            onClick={() => {
              if (!listo) return;
              actualizar({ phase: 'listo' });
              ir('listo');
            }}
          >
            {t(ROTULOS.continuar)}
          </button>
        </div>
      </div>
      {listo ? null : <p id="ayuda-continuar" class="ayuda" data-prueba="ayuda-continuar">{ayuda}</p>}
    </div>
  );
}
