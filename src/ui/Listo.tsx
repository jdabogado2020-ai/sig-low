// Pantalla 6 · Listo (PC-5, 8.2.7): búsqueda de residuos, vista previa de la salida, recordatorio de 3 casillas, motivos de la puerta,
// copiar (con el área de respaldo si el portapapeles falla), descargar .txt y .docx, informe y vaciar el portapapeles. La puerta
// (`exportGate`, 6.4.8) se calcula en cada render y cada manejador la vuelve a evaluar; con la puerta cerrada los botones llevan
// `aria-disabled="true"` (siguen enfocables) y `aria-describedby` hacia la lista de motivos. La vista muestra solo la salida
// anonimizada, nunca el original.
import './listo/listo.css';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { render } from '../core/render.ts';
import { contarBanderasSinConfirmar, contarPendientes, exportGate } from '../core/review/puerta.ts';
import type { GateReason, ReviewState } from '../core/types.ts';
import { descartarAnalisis } from './analisis.ts';
import { atributosDeContenido, Casilla, Grupo, useIdNeutro } from './campos.tsx';
import { Dialogo } from './dialogo.tsx';
import { obtenerDocumento, useRevision, vaciarTodoElDocumento } from './documento.ts';
import { actualizar, ir, useShell } from './estado.ts';
import { calcularHuellas } from './huellas.ts';
import { alterno, mensajeDeCodigo, ROTULOS, t, X } from './mensajes.ts';
import { quitarAvisoAsunto } from './sesion.ts';
import { actualizarListo, marcarCasilla, obtenerListo, reiniciarEntrada, useListo } from './listo/almacen.ts';
import type { EstadoListo } from './listo/almacen.ts';
import { buscarResiduos, textoDeModo } from './listo/busqueda.ts';
import { copiarConBoton, descargarDocx, descargarInforme, descargarTxt, vaciarPortapapeles } from './listo/salida.ts';
import { L } from './listo/textos.ts';
import { VistaSalidaPanel } from './listo/VistaSalidaPanel.tsx';

if (__SIGLOW_MEDICION__) {
  // Gancho de prueba de Listo: solo existe en el build --mode medicion (check-dist lo prohíbe en dist/).
  void import('./listo/prueba-listo.ts').then((m) => { m.instalarPruebaListo(); });
}

const ID_MOTIVOS = 'motivos-puerta';

/** Texto de un motivo de la puerta (8.5.9), solo con conteos. */
function textoDeMotivo(r: GateReason, state: ReviewState, residuo: EstadoListo['residuo']): string {
  switch (r) {
    case 'PENDIENTES': return t('M-501', { n: contarPendientes(state) });
    case 'BANDERAS': return t('M-502', { n: contarBanderasSinConfirmar(state) });
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
  const iniciado = useRef(false);
  // Al entrar desde Revisión las casillas se desmarcan y no se reutiliza un resultado anterior (8.2.7). Antes del primer pintado.
  if (!iniciado.current) {
    iniciado.current = true;
    reiniciarEntrada(obtenerListo().compilacion);
  }

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

  const pendientes = state === null ? 0 : contarPendientes(state);
  // La búsqueda corre sola al entrar y cada vez que el resultado queda desactualizado, solo con 0 pendientes (7.13.7).
  useEffect(() => {
    if (state === null || listo.buscando || pendientes > 0) return;
    if (listo.residuo !== null && listo.residuo.revision === state.revision) return;
    if (listo.errorBusqueda !== null && listo.errorBusqueda.revision === state.revision) return;
    void buscarResiduos();
  }, [state?.revision, pendientes, listo.buscando, listo.residuo, listo.errorBusqueda]);

  const salida = useMemo(() => (doc !== null && state !== null ? render(doc, state) : null), [doc, state]);

  if (doc === null || state === null || salida === null) {
    return (
      <div class="listo">
        <h1 tabIndex={-1}>{t(X.listo)}</h1>
        <p class="ayuda" data-prueba="sin-documento">{t(L.sinDocumento)}</p>
        <div class="acciones"><button type="button" onClick={() => { ir('entrada'); }}>{t(X.entrada)}</button></div>
      </div>
    );
  }

  const puerta = exportGate(state, listo.residuo, listo.recordatorio);
  const abierta = puerta.ok;
  const residuo = listo.residuo;
  const desactualizado = residuo !== null && residuo.revision !== state.revision;
  const pasa = residuo !== null && !desactualizado && residuo.hits.length === 0 && residuo.newDetections === 0;
  const asunto = shell.asunto;
  const informeListo = listo.compilacion !== null;
  const aria = (activo: boolean): Record<string, string> => (activo ? {} : { 'aria-disabled': 'true', 'aria-describedby': ID_MOTIVOS });

  const nuevoDocumento = (): void => {
    descartarAnalisis();
    vaciarTodoElDocumento();
    actualizar({ phase: 'vacio' });
    ir('entrada');
  };
  const volverARevisar = (): void => { actualizar({ phase: 'revision' }); ir('revision'); };

  return (
    <div class="listo">
      <h1 tabIndex={-1}>{t(X.listo)}</h1>

      <section aria-labelledby="h-residuos">
        <h2 id="h-residuos">{t(L.busqueda)}</h2>
        <div data-prueba="residuos-estado" role="status" aria-busy={listo.buscando}>
          {listo.buscando ? <p>{t('M-76')}</p> : null}
          {!listo.buscando && pendientes > 0 ? <p>{t(L.esperaPendientes)}</p> : null}
          {!listo.buscando && desactualizado ? <p>{t('M-79')}</p> : null}
          {!listo.buscando && pasa && residuo !== null ? <p>{t('M-77', { n: residuo.valuesSearched })}</p> : null}
        </div>
        {listo.errorBusqueda !== null ? (
          <p role="alert" class="error-campo" data-prueba="error-residuos">{mensajeDeCodigo(listo.errorBusqueda.codigo)}</p>
        ) : null}
        <p class="ayuda">{t('M-122')}</p>
        <div class="acciones">
          <button
            type="button"
            class="secundario"
            disabled={listo.buscando || pendientes > 0}
            onClick={() => { actualizarListo({ errorBusqueda: null }); void buscarResiduos(); }}
          >
            {t(ROTULOS.buscar_de_nuevo)}
          </button>
        </div>
        {residuo !== null && listo.hallazgos.length > 0 ? (
          <div data-prueba="hallazgos">
            <h3>{t(L.valoresEncontrados)}</h3>
            <ul class="hallazgos">
              {listo.hallazgos.map((h, i) => (
                <li key={i}>
                  <span>{t(L.hallazgo, { seccion: h.seccion, linea: h.linea, tipo: h.tipo, marcador: h.marcador, modo: textoDeModo(h.modo) })}</span>
                  <button type="button" class="secundario" onClick={volverARevisar}>{t(L.irARevision)}</button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="h-vista">
        <h2 id="h-vista">{t(L.vistaPrevia)}</h2>
        <VistaSalidaPanel out={salida} state={state} abierta={abierta} />
        {!abierta ? <p class="ayuda" data-prueba="aviso-vista">{t('M-73')}</p> : null}
      </section>

      <section aria-labelledby="h-recordatorio">
        <h2 id="h-recordatorio">{t(L.recordatorioTitulo)}</h2>
        <p data-prueba="prueba-final">{t('M-115')}</p>
        <Grupo leyenda={t('M-80')}>
          <Casilla etiqueta={t('M-81')} marcada={listo.recordatorio.biometricos} onCambio={(v) => { marcarCasilla('biometricos', v); }} />
          <Casilla etiqueta={t('M-82')} marcada={listo.recordatorio.reservaLegal} onCambio={(v) => { marcarCasilla('reservaLegal', v); }} />
          <Casilla etiqueta={t('M-83')} marcada={listo.recordatorio.estrategia} onCambio={(v) => { marcarCasilla('estrategia', v); }} />
        </Grupo>
      </section>

      {!abierta ? (
        <section class="motivos" aria-labelledby="h-motivos" data-prueba="motivos">
          <h2 id="h-motivos">{t(L.motivos)}</h2>
          <ul id={ID_MOTIVOS} data-prueba={ID_MOTIVOS}>
            {puerta.reasons.map((r) => <li key={r} data-motivo={r}>{textoDeMotivo(r, state, residuo)}</li>)}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="h-copiar">
        <h2 id="h-copiar">{t(L.copiarYExportar)}</h2>
        <div class="acciones">
          <button type="button" data-prueba="copiar" {...aria(abierta)} onClick={copiarConBoton}>{t(ROTULOS.copiar_texto_anonimizado)}</button>
          <button type="button" class="secundario" data-prueba="vaciar" disabled={!listo.copiado} onClick={vaciarPortapapeles}>{t(ROTULOS.vaciar_portapapeles)}</button>
        </div>
        <div class="acciones">
          <button type="button" class="secundario" data-prueba="descargar-txt" {...aria(abierta)} onClick={descargarTxt}>{t(ROTULOS.descargar_txt)}</button>
          <button type="button" class="secundario" data-prueba="descargar-docx" {...aria(abierta)} onClick={descargarDocx}>{t(ROTULOS.descargar_docx)}</button>
        </div>
        <h3>{t(L.informe)}</h3>
        {asunto !== null ? (
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
        {listo.respaldo !== null ? <AreaRespaldo texto={listo.respaldo} /> : null}
        <div class="avisos-listo" role="region" aria-label={t(L.anuncios)} data-prueba="avisos-listo">
          {listo.avisos.map((a) => (
            <p key={`${a.id}${a.alterno ?? ''}`} role={a.rol} data-aviso={a.id}>
              {a.alterno !== undefined ? alterno(a.id, a.alterno, a.params) : t(a.id, a.params)}
            </p>
          ))}
        </div>
        {asunto?.mode === 'no_guardar' && state.committed ? <p data-prueba="respaldo-tabla">{alterno('M-90', 0)}</p> : null}
      </section>

      <section aria-labelledby="h-salir">
        <h2 id="h-salir">{t(L.salir)}</h2>
        <div class="acciones">
          <button type="button" class="secundario" onClick={volverARevisar}>{t(ROTULOS.volver_a_revisar)}</button>
          <button
            type="button"
            class="secundario"
            onClick={() => { if (state.committed) nuevoDocumento(); else setConfirmarNuevo(true); }}
          >
            {t(ROTULOS.nuevo_documento_del_asunto)}
          </button>
          <button type="button" class="secundario" onClick={() => { ir('reinsercion'); }}>{t(ROTULOS.reinsertar_una_respuesta)}</button>
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
