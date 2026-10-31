// Búsqueda propia de la Revisión (8.2.6, 8.7, V-29): busca en la vista `lista` (6.1.2) del texto canónico en memoria, nunca en el DOM;
// Enter y Mayús+Enter recorren las coincidencias, «{i} de {n}», ayuda M-72 y «Agregar reemplazo para esta coincidencia». Ctrl+F y F3
// abren esta búsqueda en lugar de la del navegador (la registra `registrarBusqueda` de globales.ts; T-PV-03). El campo lleva los
// atributos de 8.7 y un `id` neutro.
import { useEffect, useRef } from 'preact/hooks';
import { atributosDeContenido, useIdNeutro } from '../../campos.tsx';
import { registrarBusqueda } from '../../globales.ts';
import { t } from '../../mensajes.ts';
import { solicitarReemplazo } from '../base/almacen.ts';
import { escribirBusqueda, limpiarBusqueda, MAXIMO_COINCIDENCIAS, MINIMO_BUSQUEDA, moverBusqueda, useBusqueda } from './herramientas.ts';
import { tp } from './textos.ts';

export function Busqueda() {
  const id = useIdNeutro();
  const entrada = useRef<HTMLInputElement | null>(null);
  const b = useBusqueda();

  useEffect(() => registrarBusqueda(() => {
    const el = entrada.current;
    if (el === null) return;
    el.focus();
    el.select();
  }), []);

  const n = b.coincidencias.length;
  const actual = b.indice >= 0 ? b.coincidencias[b.indice] : undefined;
  const corta = b.consulta.trim().length > 0 && b.consulta.trim().length < MINIMO_BUSQUEDA;
  const estado = n > 0 ? tp('M-1852', { i: b.indice + 1, n }) : b.consulta.trim().length >= MINIMO_BUSQUEDA ? tp('M-1853') : '';

  return (
    <div class="busqueda-revision" role="search" aria-label={tp('M-1851')} data-prueba="busqueda">
      <div class="campo">
        <label for={id}>{tp('M-1850')}</label>
        <div class="fila">
          <input
            id={id}
            name={id}
            type="text"
            value={b.consulta}
            aria-describedby={`${id}-a`}
            ref={(el) => { entrada.current = el; atributosDeContenido(el); }}
            onInput={(e) => { escribirBusqueda((e.currentTarget as HTMLInputElement).value); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); moverBusqueda(e.shiftKey ? -1 : 1); }
              else if (e.key === 'Escape' && b.consulta !== '') { e.preventDefault(); e.stopPropagation(); limpiarBusqueda(); }
            }}
          />
          <button type="button" class="secundario" disabled={n === 0} aria-label={tp('M-1855')} onClick={() => { moverBusqueda(-1); }}>‹</button>
          <button type="button" class="secundario" disabled={n === 0} aria-label={tp('M-1854')} onClick={() => { moverBusqueda(1); }}>›</button>
          <span class="estado-busqueda" role="status" data-prueba="busqueda-estado">{estado}</span>
        </div>
        <p id={`${id}-a`} class="ayuda">{t('M-72')}</p>
        {corta ? <p class="ayuda">{tp('M-1857')}</p> : null}
        {b.truncada ? <p class="ayuda">{tp('M-1858', { n: MAXIMO_COINCIDENCIAS })}</p> : null}
      </div>
      {actual !== undefined ? (
        <button type="button" class="secundario" data-prueba="agregar-desde-busqueda" onClick={() => { solicitarReemplazo(actual); }}>
          {tp('M-1856')}
        </button>
      ) : null}
    </div>
  );
}
