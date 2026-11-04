// Pantalla 3 · Descargar (PC-5, 8.2.7; F3, D-24): una sola confirmación («Revisé la vista previa…») en lugar de las tres casillas,
// «Descargar documento (.docx)» (el .docx fiel de F4) y «Descargar PDF» (el tachado de F4 para un PDF; el de texto para lo demás). Lo
// demás queda plegado: copiar, .txt e informe en «Más formatos»; la llave y la devolución de los datos reales en «Opciones avanzadas».
// La puerta (`exportGate`, 6.4.8) se calcula en cada render y cada manejador la vuelve a evaluar; con la puerta cerrada los botones
// llevan `aria-disabled="true"` (siguen enfocables) y `aria-describedby` hacia la lista de motivos. La búsqueda de datos que se
// escaparon sigue corriendo sola (también aquí).
import './listo/listo.css';
import './vista/vista.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import { contarPendientes, exportGate } from '../core/review/puerta.ts';
import type { GateReason, ReviewState } from '../core/types.ts';
import { descartarAnalisis } from './analisis.ts';
import { pedirLlave } from './Armazon.tsx';
import { atributosDeContenido, Casilla, useIdNeutro } from './campos.tsx';
import { Dialogo } from './dialogo.tsx';
import { obtenerDocumento, useRevision, vaciarTodoElDocumento } from './documento.ts';
import { actualizar, ir, useShell } from './estado.ts';
import { useBusquedaAutomatica, buscarOtraVez } from './flujo/busqueda-automatica.ts';
import { tf } from './flujo/textos.ts';
import { calcularHuellas } from './huellas.ts';
import { alterno, mensajeDeCodigo, ROTULOS, t, X } from './mensajes.ts';
import { quitarAvisoAsunto } from './sesion.ts';
import { actualizarListo, marcarConfirmacion, obtenerListo, useListo } from './listo/almacen.ts';
import type { EstadoListo } from './listo/almacen.ts';
import { copiarConBoton, descargarDocxFiel, descargarInforme, descargarPdfSalida, descargarTxt, vaciarPortapapeles } from './listo/salida.ts';
import { L } from './listo/textos.ts';

if (__SIGLOW_MEDICION__) {
  // Gancho de prueba de Listo: solo existe en el build --mode medicion (check-dist lo prohíbe en dist/).
  void import('./listo/prueba-listo.ts').then((m) => { m.instalarPruebaListo(); });
}

const ID_MOTIVOS = 'motivos-puerta';

/** Texto de un motivo de la puerta (8.5.9), solo con conteos. */
function textoDeMotivo(r: GateReason, state: ReviewState, residuo: EstadoListo['residuo']): string {
  switch (r) {
    case 'PENDIENTES': return t('M-501', { n: contarPendientes(state) });
    case 'MODELO_EN_CURSO': {
      const m = state.modelo;
      const total = m.kind === 'en_curso' ? m.ventanasTotales : 0;
      return t('M-508', { n: m.kind === 'en_curso' && total > 0 ? Math.max(0, total - m.ventanas) : '?', total: total > 0 ? total : '?' });
    }
    case 'RESIDUOS_NO_EJECUTADA': return t('M-503');
    case 'RESIDUOS_DESACTUALIZADA': return t('M-504');
    case 'RESIDUOS_ENCONTRADOS': return t('M-505', { n: residuo?.hits.length ?? 0 });
    case 'DETECCIONES_NUEVAS': return t('M-507', { n: residuo?.newDetections ?? 0 });
    case 'RECORDATORIO': return t('M-506');
  }
}

/** M-87: el navegador no permitió copiar; el texto anonimizado queda seleccionado para Ctrl + C. */
function AreaRespaldo({ texto }: { texto: string }) {
  const id = useIdNeutro();
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, [texto]);
  return (
    <div class="campo respaldo-copia" data-prueba="respaldo-copia">
      <label for={id}>{t(L.textoRespaldo)}</label>
      <textarea
        id={id}
        name={id}
        readOnly
        rows={8}
        value={texto}
        ref={(el) => { ref.current = el; atributosDeContenido(el); }}
      />
    </div>
  );
}

export function Listo() {
  const shell = useShell();
  const state = useRevision();
  const doc = obtenerDocumento();
  const listo = useListo();
  const [confirmarNuevo, setConfirmarNuevo] = useState(false);
  const [preparandoPdf, setPreparandoPdf] = useState(false);
  const iniciado = useRef(false);
  // Al llegar, la confirmación se desmarca (D-24): se marca después de mirar la vista previa. El resultado de la búsqueda se conserva.
  if (!iniciado.current) {
    iniciado.current = true;
    marcarConfirmacion(false);
  }
  useBusquedaAutomatica(state, listo);

  useEffect(() => {
    quitarAvisoAsunto('M-78');
    actualizar({ phase: 'listo' });
  }, []);
  // La compilación del informe (`app.compilacion`) es el SHA-256 de index.html en la caché; se recalcula cuando el precache termina.
  useEffect(() => {
    let vivo = true;
    void calcularHuellas().then((h) => { if (vivo) actualizarListo({ compilacion: h.indexHtml ?? obtenerListo().compilacion }); });
    return () => { vivo = false; };
  }, [shell.offlineReady]);

  if (doc === null || state === null) {
    return (
      <div class="listo descargar">
        <h1 tabIndex={-1}>{t(X.listo)}</h1>
        <p class="ayuda" data-prueba="sin-documento">{t(L.sinDocumento)}</p>
        <div class="acciones"><button type="button" onClick={() => { ir('inicio'); }}>{t(X.inicio)}</button></div>
      </div>
    );
  }

  const puerta = exportGate(state, listo.residuo, listo.recordatorio);
  const abierta = puerta.ok;
  const residuo = listo.residuo;
  const pasa = residuo !== null && residuo.revision === state.revision && residuo.hits.length === 0 && residuo.newDetections === 0;
  const asunto = shell.asunto;
  const informeListo = listo.compilacion !== null;
  const aria = (activo: boolean): Record<string, string> => (activo ? {} : { 'aria-disabled': 'true', 'aria-describedby': ID_MOTIVOS });

  const nuevoDocumento = (): void => {
    descartarAnalisis();
    vaciarTodoElDocumento();
    actualizar({ phase: 'vacio' });
    ir('inicio');
  };
  const volver = (): void => { actualizar({ phase: 'revision' }); ir('revision'); };
  const pdf = (): void => {
    if (!abierta || preparandoPdf) return;
    setPreparandoPdf(true);
    void descargarPdfSalida().finally(() => { setPreparandoPdf(false); });
  };

  return (
    <div class="listo descargar">
      <h1 tabIndex={-1}>{t(X.listo)}</h1>

      <section aria-labelledby="h-antes">
        <h2 id="h-antes">{tf('M-2288')}</h2>
        <div data-prueba="residuos-estado" role="status" aria-busy={listo.buscando}>
          {listo.buscando ? <p>{t('M-76')}</p> : null}
          {!listo.buscando && pasa ? <p>{t('M-77', { n: residuo.valuesSearched })}</p> : null}
          {!listo.buscando && residuo !== null && residuo.revision !== state.revision ? <p>{t('M-79')}</p> : null}
        </div>
        {listo.errorBusqueda !== null ? (
          <div class="acciones">
            <p role="alert" class="error-campo" data-prueba="error-residuos">{mensajeDeCodigo(listo.errorBusqueda.codigo)}</p>
            <button type="button" class="secundario" onClick={buscarOtraVez}>{t(ROTULOS.buscar_de_nuevo)}</button>
          </div>
        ) : null}
        <p class="ayuda">{t('M-122')}</p>
        <p class="ayuda">{tf('M-2290')}</p>
        <p data-prueba="prueba-final">{t('M-115')}</p>
        <div class="confirmacion-unica">
          <Casilla etiqueta={tf('M-2285')} marcada={listo.recordatorio.revisado} onCambio={(v) => { marcarConfirmacion(v); }} />
        </div>
      </section>

      {!abierta ? (
        <section class="motivos" aria-labelledby="h-motivos" data-prueba="motivos">
          <h2 id="h-motivos">{tf('M-2291')}</h2>
          <ul id={ID_MOTIVOS} data-prueba={ID_MOTIVOS}>
            {puerta.reasons.map((r) => <li key={r} data-motivo={r}>{textoDeMotivo(r, state, residuo)}</li>)}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="h-descargar">
        <h2 id="h-descargar">{t(X.listo)}</h2>
        <div class="acciones">
          <button type="button" data-prueba="descargar-docx" {...aria(abierta)} onClick={descargarDocxFiel}>{t(ROTULOS.descargar_docx)}</button>
          <button type="button" class="secundario" data-prueba="descargar-pdf" {...aria(abierta && !preparandoPdf)} onClick={pdf}>{tf('M-2286')}</button>
        </div>
        {preparandoPdf ? <p role="status" data-prueba="preparando-pdf">{tf('M-2289')}</p> : null}
        <details class="mas-formatos" data-prueba="mas-formatos">
          <summary>{tf('M-2287')}</summary>
          <div class="acciones">
            <button type="button" class="secundario" data-prueba="copiar" {...aria(abierta)} onClick={copiarConBoton}>{t(ROTULOS.copiar_texto_anonimizado)}</button>
            <button type="button" class="secundario" data-prueba="vaciar" disabled={!listo.copiado} onClick={vaciarPortapapeles}>{t(ROTULOS.vaciar_portapapeles)}</button>
            <button type="button" class="secundario" data-prueba="descargar-txt" {...aria(abierta)} onClick={descargarTxt}>{t(ROTULOS.descargar_txt)}</button>
          </div>
          <h3>{t(L.informe)}</h3>
          {asunto !== null && asunto.efimero !== true ? (
            <Casilla etiqueta={t(L.incluirCodigo)} marcada={listo.incluirCodigoAsunto} onCambio={(v) => { actualizarListo({ incluirCodigoAsunto: v }); }} />
          ) : null}
          {abierta && !informeListo ? <p class="ayuda" data-prueba="sin-huella">{t(L.sinHuella)}</p> : null}
          <div class="acciones">
            <button type="button" class="secundario" data-prueba="informe-txt" {...aria(abierta && informeListo)} onClick={() => { descargarInforme('txt'); }}>
              {t(ROTULOS.descargar_informe_txt)}
            </button>
            <button type="button" class="secundario" data-prueba="informe-json" {...aria(abierta && informeListo)} onClick={() => { descargarInforme('json'); }}>
              {t(L.informeJson)}
            </button>
          </div>
        </details>
        {listo.respaldo !== null ? <AreaRespaldo texto={listo.respaldo} /> : null}
        <div class="avisos-listo" role="region" aria-label={t(L.anuncios)} data-prueba="avisos-listo">
          {listo.avisos.map((a) => (
            <p key={`${a.id}${a.alterno ?? ''}`} role={a.rol} data-aviso={a.id}>
              {a.alterno !== undefined ? alterno(a.id, a.alterno, a.params) : t(a.id, a.params)}
            </p>
          ))}
        </div>
        {asunto?.mode === 'no_guardar' && asunto.efimero !== true && state.committed ? <p data-prueba="respaldo-tabla">{alterno('M-90', 0)}</p> : null}
      </section>

      <details class="avanzadas" data-prueba="opciones-avanzadas">
        <summary>{tf('M-2216')}</summary>
        <p class="ayuda">{tf('M-2221')}</p>
        <div class="acciones">
          <button type="button" class="secundario" onClick={() => { pedirLlave('exportar'); }}>{tf('M-2220')}</button>
          <button type="button" class="secundario" onClick={() => { ir('reinsercion'); }}>{t(ROTULOS.reinsertar_una_respuesta)}</button>
          <button type="button" class="secundario" onClick={() => { ir('boveda'); }}>{tf('M-2222')}</button>
        </div>
      </details>

      <section aria-labelledby="h-salir">
        <h2 id="h-salir">{t(L.salir)}</h2>
        <div class="acciones">
          <button type="button" class="secundario" onClick={volver}>{t(ROTULOS.volver_a_revisar)}</button>
          <button
            type="button"
            class="secundario"
            onClick={() => { if (state.committed) nuevoDocumento(); else setConfirmarNuevo(true); }}
          >
            {t(ROTULOS.nuevo_documento_del_asunto)}
          </button>
        </div>
      </section>

      <Dialogo abierto={confirmarNuevo} titulo={t(ROTULOS.descartar_documento)} onCerrar={() => { setConfirmarNuevo(false); }}>
        <p>{t('M-75')}</p>
        <div class="acciones">
          <button type="button" onClick={() => { setConfirmarNuevo(false); nuevoDocumento(); }}>{t(ROTULOS.descartar_documento)}</button>
          <button type="button" class="secundario" onClick={() => { setConfirmarNuevo(false); }}>{t(ROTULOS.cancelar)}</button>
        </div>
      </Dialogo>
    </div>
  );
}
