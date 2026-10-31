// Pestaña «Sugerencias de generalización» (8.2.6, 6.4.5): por `Suggestion`, la clase (8.5.11), la prioridad «Recomendada» u «Opcional
// (ciudad grande)», el contexto, las opciones en radios y «Aplicar» / «Descartar». Orden: recomendadas y luego el resto, cada grupo en orden
// de lectura. Un municipio homónimo pide el departamento antes de «Aplicar» (M-127). `ROTULO_DOCUMENTO_A_GENERICO` nace aplicada y se
// muestra con «Aplicada» y M-128. El contador «sin decidir» no bloquea el paso a Listo. Todo se despacha por `despachar()` (6.4.4).
import { useEffect, useState } from 'preact/hooks';
import type { DocumentModel, ReviewState, Suggestion, SuggestionId } from '../../../core/types.ts';
import { useIdNeutro } from '../../campos.tsx';
import { etiqueta, mensajeDeCodigo, ROTULOS, t } from '../../mensajes.ts';
import { anunciar, despachar, limpiarError, useRevisionUi } from '../base/almacen.ts';
import { compararPosiciones, Contexto, IrALaUbicacion, posicionDe, tramoDeSugerencia, useFocoDeTarjeta } from './comunes.tsx';
import { tp } from './textos.ts';

/** Departamentos de la DIVIPOLA (DANE) por código, para las opciones de un municipio homónimo. */
const DEPARTAMENTOS: Readonly<Record<string, string>> = {
  '05': 'Antioquia', '08': 'Atlántico', '11': 'Bogotá, D.C.', '13': 'Bolívar', '15': 'Boyacá', '17': 'Caldas', '18': 'Caquetá',
  '19': 'Cauca', '20': 'Cesar', '23': 'Córdoba', '25': 'Cundinamarca', '27': 'Chocó', '41': 'Huila', '44': 'La Guajira',
  '47': 'Magdalena', '50': 'Meta', '52': 'Nariño', '54': 'Norte de Santander', '63': 'Quindío', '66': 'Risaralda',
  '68': 'Santander', '70': 'Sucre', '73': 'Tolima', '76': 'Valle del Cauca', '81': 'Arauca', '85': 'Casanare',
  '86': 'Putumayo', '88': 'San Andrés, Providencia y Santa Catalina', '91': 'Amazonas', '94': 'Guainía', '95': 'Guaviare',
  '97': 'Vaupés', '99': 'Vichada',
};
export const nombreDeDepartamento = (codigo: string): string => DEPARTAMENTOS[codigo] ?? `Departamento ${codigo}`;

/** Una opción se lee con el marcador genérico: el número definitivo lo asigna el reductor al aplicar. */
const verOpcion = (plantilla: string): string => plantilla.split('{m}').join('[DEPARTAMENTO_n]');

export const sinDecidir = (state: ReviewState): number => Object.values(state.suggestions).filter((s) => s.status === 'pendiente').length;

/** Recomendadas primero y luego el resto, cada grupo en orden de lectura (8.2.6). */
export function ordenarSugerencias(doc: DocumentModel, state: ReviewState): Suggestion[] {
  const lista = Object.values(state.suggestions).map((s) => {
    const tramo = tramoDeSugerencia(state, s);
    return { s, pos: tramo === null ? ([0, 0] as [number, number]) : posicionDe(doc, tramo), grupo: s.prioridad === 'recomendada' ? 0 : 1 };
  });
  lista.sort((a, b) => a.grupo - b.grupo || compararPosiciones(a.pos, b.pos));
  return lista.map((x) => x.s);
}

function Tarjeta({ s, i, n, doc, state }: { s: Suggestion; i: number; n: number; doc: DocumentModel; state: ReviewState }) {
  const ref = useFocoDeTarjeta('sug', s.id);
  const nombre = useIdNeutro();
  const [opcion, setOpcion] = useState<string>(s.chosenOptionId ?? s.options[0]?.id ?? '');
  const [dep, setDep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const tramo = tramoDeSugerencia(state, s);
  const parte = tramo === null ? undefined : doc.parts.find((p) => p.id === tramo.partId);
  const homonimo = (s.placeOptions?.length ?? 0) >= 2;
  const clase = etiqueta('sugerencia', s.kind);
  const elegida = opcion;
  useEffect(() => { if (s.chosenOptionId !== undefined) setOpcion(s.chosenOptionId); }, [s.chosenOptionId]);

  const aplicar = (): void => {
    setError(null);
    if (homonimo) {
      if (dep === '') { setError(mensajeDeCodigo('DEPARTAMENTO_SIN_ELEGIR')); return; }
      const e = despachar({ kind: 'elegir_departamento', suggestionId: s.id as SuggestionId, depCode: dep });
      if (!e.ok) { setError(mensajeDeCodigo(e.code)); limpiarError(); return; }
    }
    const r = despachar({ kind: 'aplicar_sugerencia', suggestionId: s.id as SuggestionId, optionId: opcion });
    if (!r.ok) { setError(mensajeDeCodigo(r.code)); limpiarError(); return; }
    anunciar(tp('M-1413', { n: sinDecidir(r.state) }));
  };
  const descartar = (): void => {
    setError(null);
    const r = despachar({ kind: 'descartar_sugerencia', suggestionId: s.id as SuggestionId });
    if (!r.ok) { setError(mensajeDeCodigo(r.code)); limpiarError(); return; }
    anunciar(tp('M-1414', { n: sinDecidir(r.state) }));
  };

  return (
    <li
      ref={ref}
      class={`tarjeta tarjeta-sug est-sug-${s.status}`}
      tabIndex={-1}
      data-sugerencia={s.id}
      data-clase={s.kind}
      aria-label={tp('M-1411', { i, n, clase })}
    >
      <h4>
        {clase}
        {s.prioridad !== undefined ? <span class="etiqueta-tarjeta etiqueta-prioridad" data-prueba="prioridad">{etiqueta('prioridad', s.prioridad)}</span> : null}
        {s.status === 'aplicada' ? <span class="etiqueta-tarjeta etiqueta-estado" data-prueba="estado-sugerencia">{t(ROTULOS.aplicada)}</span> : null}
        {s.status === 'descartada' ? <span class="etiqueta-tarjeta etiqueta-estado" data-prueba="estado-sugerencia">{tp('M-1405')}</span> : null}
      </h4>
      {tramo !== null ? <Contexto part={parte} span={tramo} /> : null}
      {s.kind === 'ROTULO_DOCUMENTO_A_GENERICO' && s.status === 'aplicada' ? <p class="ayuda">{t('M-128')}</p> : null}
      {homonimo && s.status !== 'aplicada' ? (
        <fieldset class="grupo">
          <legend>{t('M-127')}</legend>
          {(s.placeOptions ?? []).map((codigo) => (
            <label key={codigo} class="opcion">
              <input type="radio" name={`${nombre}d`} value={codigo} checked={dep === codigo} onChange={() => { setDep(codigo); setError(null); }} />
              {' '}{nombreDeDepartamento(codigo)}
            </label>
          ))}
        </fieldset>
      ) : null}
      <fieldset class="grupo">
        <legend>{tp('M-1406')}</legend>
        {s.options.map((o) => (
          <label key={o.id} class="opcion">
            <input type="radio" name={`${nombre}o`} value={o.id} checked={elegida === o.id} onChange={() => { setOpcion(o.id); }} />
            {' '}{verOpcion(o.template)}{o.depCode !== undefined ? ` (${nombreDeDepartamento(o.depCode)})` : ''}
          </label>
        ))}
      </fieldset>
      {error !== null ? <p class="error-campo" role="alert">{error}</p> : null}
      <div class="acciones">
        {s.status !== 'aplicada' || elegida !== s.chosenOptionId ? (
          <button type="button" aria-label={`${t(ROTULOS.aplicar)}: ${clase}`} onClick={aplicar}>{t(ROTULOS.aplicar)}</button>
        ) : null}
        {s.status !== 'descartada' ? (
          <button type="button" class="secundario" aria-label={`${t(ROTULOS.descartar)}: ${clase}`} onClick={descartar}>{t(ROTULOS.descartar)}</button>
        ) : null}
        {tramo !== null ? <IrALaUbicacion span={tramo} /> : null}
      </div>
    </li>
  );
}

export function Sugerencias() {
  const { doc, state } = useRevisionUi();
  if (doc === null || state === null) return null;
  const lista = ordenarSugerencias(doc, state);
  return (
    <div class="lista-pestana" data-prueba="pestana-sugerencias">
      <p class="ayuda">{t('M-115')}</p>
      <p class="contador-pestana" role="status" data-prueba="sin-decidir">{tp('M-1402', { n: sinDecidir(state) })}</p>
      {lista.length === 0 ? <p class="aviso-vacio">{tp('M-1403')}</p> : (
        <ol class="tarjetas">
          {lista.map((s, k) => <Tarjeta key={s.id} s={s} i={k + 1} n={lista.length} doc={doc} state={state} />)}
        </ol>
      )}
      <p class="ayuda">{t('M-116')}</p>
    </div>
  );
}
