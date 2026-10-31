// Pantalla 5 · Revisión, parte I (PC-3, 8.2.6): resaltado por tipo (color y abreviatura) y por confianza (borde), panel de texto
// virtualizado, pestaña «Detecciones» (treegrid por entidad), ficha con aceptar, rechazar, editar, «aceptar todas las menciones de
// esta entidad» (nunca todo el documento, INV-R06) y reemplazo manual por selección. PC-4 enchufa su parte en `RevisionPestanas`.
import './revision-base.css';
import { useRef, useState } from 'preact/hooks';
import { actualizar, ir, useShell } from '../../estado.ts';
import { Casilla } from '../../campos.tsx';
import { Dialogo } from '../../dialogo.tsx';
import { ROTULOS, t, X } from '../../mensajes.ts';
import { RevisionBarra } from '../pestanas/RevisionBarra.tsx';
import { RevisionPestanas } from '../pestanas/RevisionPestanas.tsx';
import { AgregarReemplazo } from './AgregarReemplazo.tsx';
import { Cuadricula } from './Cuadricula.tsx';
import { Ficha } from './Ficha.tsx';
import { ID_LEYENDA, Leyenda } from './Leyenda.tsx';
import { PanelTexto } from './PanelTexto.tsx';
import { descartarAnalisis } from '../../analisis.ts';
import { cambiarVista, useRevisionUi } from './almacen.ts';
import { tx } from './textos.ts';

if (__SIGLOW_MEDICION__) {
  // Gancho de prueba de la Revisión I: solo existe en el build --mode medicion (check-dist lo prohíbe en dist/).
  void import('./prueba-medicion.ts').then((m) => { m.instalarPruebaRevision(); });
}

export function RevisionBase() {
  const shell = useShell();
  const { doc, state, vista, anuncio } = useRevisionUi();
  const [leyenda, setLeyenda] = useState(false);
  const [atajos, setAtajos] = useState(false);
  const [descartar, setDescartar] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const aside = useRef<HTMLElement>(null);

  const alTeclear = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && leyenda) { e.stopPropagation(); setLeyenda(false); boton.current?.focus(); return; }
    if (e.key === '?' && e.target instanceof Element && e.target.closest('.panel-texto, .cuadricula') !== null) {
      e.preventDefault();
      setAtajos(true);
    }
  };

  if (doc === null || state === null) {
    return (
      <>
        <h1 tabIndex={-1}>{t(X.revision)}</h1>
        <p class="ayuda" data-prueba="sin-revision">{t('M-69')}</p>
      </>
    );
  }
  const sinDetecciones = Object.keys(state.detections).length === 0 && state.modelo.kind !== 'en_curso';
  const provisional = !state.committed && Object.values(state.entities).some((e) => e.markerState === 'vista_previa');

  return (
    <div class="revision" onKeyDown={alTeclear}>
      <h1 tabIndex={-1}>{t(X.revision)}</h1>
      <button
        type="button"
        class="salto salto-local"
        onClick={() => { aside.current?.querySelector<HTMLElement>('.cuadricula [tabindex="0"]')?.focus(); }}
      >
        {tx('M-1703')}
      </button>
      <div class="barra-revision" role="toolbar" aria-label={tx('M-1702')}>
        <button type="button" class="secundario" aria-pressed={vista === 'original'} onClick={() => { cambiarVista('original'); }}>{t(ROTULOS.ver_original)}</button>
        <button type="button" class="secundario" aria-pressed={vista === 'salida'} onClick={() => { cambiarVista('salida'); }}>{t(ROTULOS.ver_salida)}</button>
        <button
          ref={boton}
          type="button"
          class="secundario"
          aria-expanded={leyenda}
          aria-controls={ID_LEYENDA}
          onClick={() => { setLeyenda((v) => !v); }}
        >
          {t(ROTULOS.leyenda)}
        </button>
        <button type="button" class="secundario" onClick={() => { setAtajos(true); }}>{tx('M-1791')}</button>
        <button type="button" class="secundario" onClick={() => { setDescartar(true); }}>{t(ROTULOS.descartar_documento)}</button>
      </div>
      <Leyenda abierta={leyenda} />
      <p class="solo-lectores" role="status" aria-label={tx('M-1707')} data-prueba="anuncio-revision">{anuncio}</p>
      <RevisionBarra />
      {sinDetecciones ? <p class="aviso-vacio" data-prueba="sin-detecciones">{t('M-69')}</p> : null}
      <div class="revision-cuerpo">
        <PanelTexto singleKey={shell.singleKeyShortcuts} />
        <aside class="panel-lateral" aria-label={t(ROTULOS.detecciones)} ref={aside}>
          <h2>{t(ROTULOS.detecciones)}</h2>
          {provisional ? <p class="ayuda" data-prueba="numeracion-provisional">{t('M-70')}</p> : null}
          <Ficha />
          <Cuadricula singleKey={shell.singleKeyShortcuts} />
          <RevisionPestanas />
        </aside>
      </div>
      <AgregarReemplazo />
      <Dialogo abierto={descartar} titulo={t(ROTULOS.descartar_documento)} onCerrar={() => { setDescartar(false); }}>
        <p>{t('M-75')}</p>
        <div class="acciones">
          <button type="button" onClick={() => { setDescartar(false); descartarAnalisis(); ir('entrada'); }}>{t(ROTULOS.descartar_documento)}</button>
          <button type="button" class="secundario" onClick={() => { setDescartar(false); }}>{t(ROTULOS.cancelar)}</button>
        </div>
      </Dialogo>
      <Dialogo abierto={atajos} titulo={tx('M-1791')} onCerrar={() => { setAtajos(false); }}>
        <p>{tx('M-1793')}</p>
        <p class="ayuda">{tx('M-1794')}</p>
        <Casilla etiqueta={tx('M-1792')} marcada={shell.singleKeyShortcuts} onCambio={(v) => { actualizar({ singleKeyShortcuts: v }); }} />
        <div class="acciones">
          <button type="button" onClick={() => { setAtajos(false); }}>{t(X.cerrar)}</button>
        </div>
      </Dialogo>
    </div>
  );
}
