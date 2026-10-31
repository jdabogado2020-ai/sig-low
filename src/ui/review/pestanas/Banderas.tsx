// Pestaña «Revisión manual (banderas)» (8.2.6, 6.4.6): por `Flag`, el tipo, el motivo (8.5.11), la ayuda por tipo (M-117 a M-121), el
// contexto y «Mantener el texto» / «Reemplazar por…» (opciones y campo libre). `CITA_JURISPRUDENCIAL`: «Es una cita: no reemplazar» /
// «Es un radicado del caso: reemplazar». Resolver confirma la bandera (`acknowledged`); una sin confirmar mantiene `BANDERAS` en la
// compuerta de copia. Todo se despacha por `despachar()` con `resolver_bandera` (6.4.4).
import { useState } from 'preact/hooks';
import type { DataType, DocumentModel, Flag, FlagId, ReviewState } from '../../../core/types.ts';
import { atributosDeContenido, useIdNeutro } from '../../campos.tsx';
import { etiqueta, mensajeDeCodigo, ROTULOS, t } from '../../mensajes.ts';
import { anunciar, despachar, limpiarError, useRevisionUi } from '../base/almacen.ts';
import { nombreDeTipo } from '../base/presentacion.ts';
import { compararPosiciones, Contexto, IrALaUbicacion, posicionDe, Radio, useFocoDeTarjeta } from './comunes.tsx';
import { tp } from './textos.ts';

export const sinConfirmar = (state: ReviewState): number => Object.values(state.flags).filter((f) => !f.acknowledged).length;

/** Ayuda por tipo de bandera (M-117 a M-121). */
const AYUDA: Partial<Record<DataType, 'M-117' | 'M-118' | 'M-119' | 'M-120' | 'M-121'>> = {
  CARGO: 'M-117', DIAGNOSTICO: 'M-118', HECHO_LLAMATIVO: 'M-119', MENOR: 'M-120', CITA_JURISPRUDENCIAL: 'M-121',
};

export function ordenarBanderas(doc: DocumentModel, state: ReviewState): Flag[] {
  return Object.values(state.flags)
    .map((f) => ({ f, pos: posicionDe(doc, f.span) }))
    .sort((a, b) => compararPosiciones(a.pos, b.pos))
    .map((x) => x.f);
}

function Tarjeta({ f, i, n, doc, state }: { f: Flag; i: number; n: number; doc: DocumentModel; state: ReviewState }) {
  const ref = useFocoDeTarjeta('ban', f.id);
  const nombre = useIdNeutro();
  const campo = useIdNeutro();
  const propias = f.options.filter((o) => !o.template.includes('{m}'));
  const [abierto, setAbierto] = useState(false);
  const [opcion, setOpcion] = useState<string>(propias[0]?.id ?? '');
  const [texto, setTexto] = useState('');
  const [error, setError] = useState<string | null>(null);
  const tipo = nombreDeTipo(f.type);
  const parte = doc.parts.find((p) => p.id === f.span.partId);
  const esCita = f.type === 'CITA_JURISPRUDENCIAL';
  // Con una sugerencia o una detección vinculada, el reductor decide el reemplazo: no hay opciones ni texto libre que elegir.
  const vinculada = f.suggestionId !== undefined || f.detectionId !== undefined;

  const resolver = (resolution: 'mantener' | 'reemplazar', extra?: { optionId?: string; text?: string }): void => {
    setError(null);
    const r = despachar({ kind: 'resolver_bandera', flagId: f.id as FlagId, resolution, ...extra });
    if (!r.ok) { setError(mensajeDeCodigo(r.code)); limpiarError(); return; }
    setAbierto(false);
    anunciar(tp('M-1815', { m: sinConfirmar(r.state) }));
  };
  const confirmarReemplazo = (): void => {
    const libre = texto.trim();
    if (libre !== '') resolver('reemplazar', { text: libre });
    else if (opcion !== '') resolver('reemplazar', { optionId: opcion });
    else setError(mensajeDeCodigo('NO_ENCONTRADO'));
  };

  return (
    <li
      ref={ref}
      class={`tarjeta tarjeta-ban ${f.acknowledged ? 'confirmada' : 'sin-confirmar'}`}
      tabIndex={-1}
      data-bandera={f.id}
      aria-label={tp('M-1812', { i, n, tipo })}
    >
      <h4>
        {tipo}
        <span class="etiqueta-tarjeta etiqueta-estado" data-prueba="estado-bandera">{f.acknowledged ? tp('M-1809') : tp('M-1808')}</span>
      </h4>
      <p class="motivo-tarjeta">{etiqueta('bandera', f.reason)}</p>
      {AYUDA[f.type] !== undefined ? <p class="ayuda">{t(AYUDA[f.type] as 'M-117')}</p> : null}
      <Contexto part={parte} span={f.span} />
      {f.acknowledged && f.resolution !== undefined ? (
        <p class="ayuda">{f.resolution === 'mantener' ? tp('M-1820') : tp('M-1821')}</p>
      ) : null}
      {error !== null ? <p class="error-campo" role="alert">{error}</p> : null}
      <div class="acciones">
        {esCita ? (
          <>
            <button type="button" class="secundario" onClick={() => { resolver('mantener'); }}>{t(ROTULOS.es_una_cita_no_reemplazar)}</button>
            <button type="button" class="secundario" onClick={() => { resolver('reemplazar'); }}>{t(ROTULOS.es_un_radicado_del_caso_reemplazar)}</button>
          </>
        ) : (
          <>
            <button type="button" class="secundario" aria-label={`${t(ROTULOS.mantener_el_texto)}: ${tipo}`} onClick={() => { resolver('mantener'); }}>{t(ROTULOS.mantener_el_texto)}</button>
            <button
              type="button"
              class="secundario"
              aria-label={`${t(ROTULOS.reemplazar_por)}: ${tipo}`}
              aria-expanded={vinculada ? undefined : abierto}
              onClick={() => { if (vinculada) resolver('reemplazar'); else setAbierto((v) => !v); }}
            >
              {t(ROTULOS.reemplazar_por)}
            </button>
          </>
        )}
        <IrALaUbicacion span={f.span} />
      </div>
      {abierto && !vinculada && !esCita ? (
        <div class="reemplazo-bandera">
          {propias.length > 0 ? (
            <fieldset class="grupo">
              <legend>{tp('M-1817')}</legend>
              {propias.map((o) => (
                <Radio key={o.id} grupo={nombre} valor={o.id} marcado={opcion === o.id && texto === ''} onCambio={() => { setOpcion(o.id); setTexto(''); }}>{o.template}</Radio>
              ))}
            </fieldset>
          ) : null}
          <div class="campo">
            <label for={campo}>{tp('M-1810')}</label>
            <input id={campo} name={campo} type="text" value={texto} ref={atributosDeContenido} onInput={(e) => { setTexto((e.currentTarget as HTMLInputElement).value); }} />
          </div>
          <div class="acciones">
            <button type="button" onClick={confirmarReemplazo}>{tp('M-1819')}</button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function Banderas() {
  const { doc, state } = useRevisionUi();
  if (doc === null || state === null) return null;
  const lista = ordenarBanderas(doc, state);
  return (
    <div class="lista-pestana" data-prueba="pestana-banderas">
      <p class="contador-pestana" role="status" data-prueba="sin-confirmar">{t('M-502', { n: sinConfirmar(state) })}</p>
      {lista.length === 0 ? <p class="aviso-vacio">{tp('M-1804')}</p> : (
        <ol class="tarjetas">
          {lista.map((f, k) => <Tarjeta key={f.id} f={f} i={k + 1} n={lista.length} doc={doc} state={state} />)}
        </ol>
      )}
    </div>
  );
}
