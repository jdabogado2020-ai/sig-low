// Revisión II · pestañas del panel lateral (PC-4, 8.2.6): «Sugerencias de generalización» y «Revisión manual (banderas)», bajo el panel
// «Detecciones» de PC-3. `tablist` / `tab` / `tabpanel` con flechas, Inicio y Fin (8.6.5). El contador de cada pestaña cuenta lo que
// falta por decidir. Importar este módulo registra además el recorrido de pendientes con banderas (`navegacion.ts`).
import './revision-pestanas.css';
import { useIdNeutro } from '../../campos.tsx';
import { ROTULOS, t } from '../../mensajes.ts';
import { useRevisionUi } from '../base/almacen.ts';
import { Banderas, sinConfirmar } from './Banderas.tsx';
import { elegirPestana, useLateral, type PestanaLateral } from './herramientas.ts';
import './navegacion.ts';
import { sinDecidir, Sugerencias } from './Sugerencias.tsx';
import { tp } from './textos.ts';

const ORDEN: readonly PestanaLateral[] = ['sugerencias', 'banderas'];

export function RevisionPestanas() {
  const { state } = useRevisionUi();
  const { pestana } = useLateral();
  const base = useIdNeutro();
  if (state === null) return null;
  const cuentas: Record<PestanaLateral, number> = { sugerencias: sinDecidir(state), banderas: sinConfirmar(state) };
  const nombres: Record<PestanaLateral, string> = {
    sugerencias: t(ROTULOS.sugerencias_de_generalizacion),
    banderas: t(ROTULOS.revision_manual_banderas),
  };
  const idTab = (p: PestanaLateral): string => `${base}-${p}`;

  const alTeclear = (e: KeyboardEvent): void => {
    const i = ORDEN.indexOf(pestana);
    let j = i;
    if (e.key === 'ArrowRight') j = (i + 1) % ORDEN.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + ORDEN.length) % ORDEN.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = ORDEN.length - 1;
    else return;
    e.preventDefault();
    elegirPestana(ORDEN[j] as PestanaLateral);
    document.getElementById(idTab(ORDEN[j] as PestanaLateral))?.focus();
  };

  return (
    <section class="pestanas-laterales" data-prueba="pestanas-laterales">
      <div role="tablist" aria-label={tp('M-1801')} onKeyDown={alTeclear}>
        {ORDEN.map((p) => (
          <button
            key={p}
            id={idTab(p)}
            type="button"
            role="tab"
            class="pestana"
            aria-selected={pestana === p}
            aria-controls={`${idTab(p)}-panel`}
            tabIndex={pestana === p ? 0 : -1}
            data-pestana={p}
            onClick={() => { elegirPestana(p); }}
          >
            {nombres[p]}{cuentas[p] > 0 ? ` (${cuentas[p]})` : ''}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${idTab(pestana)}-panel`} aria-labelledby={idTab(pestana)} tabIndex={0} class="panel-pestana">
        {pestana === 'sugerencias' ? <Sugerencias /> : <Banderas />}
      </div>
    </section>
  );
}
