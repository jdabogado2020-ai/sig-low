// Armazón común (8.2.1): cabecera, pasos, avisos transversales (8.2.10), pie y diálogos de exportación e inactividad.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { aplicarActualizacionYRecargar } from './arranque-sw.ts';
import { bloquear, cerrarAsunto, seguirTrabajando, useCuentaRegresiva } from './bloqueo.ts';
import { Casilla, CampoFrase } from './campos.tsx';
import { Dialogo } from './dialogo.tsx';
import { actualizar, useShell, type Screen } from './estado.ts';
import { evaluarFrase } from './frase.ts';
import { mostrarAvisoGlobal, ocultarAvisoGlobal, useAvisoGlobal } from './globales.ts';
import { calcularHuellas, compilacionCorta } from './huellas.ts';
import { mensajeDeCodigo, ROTULOS, t, X } from './mensajes.ts';
import { obtenerListaDelCaso, obtenerTabla, quitarAvisoAsunto, agregarAvisoAsunto, useAvisosAsunto, useListaDelCaso } from './sesion.ts';
import { codigoDeError, puertos } from './servicios.ts';

export const NOMBRE_PANTALLA: Record<Screen, `M-${number}`> = {
  inicio: X.inicio, lista: X.lista, entrada: X.entrada, procesando: X.procesando, revision: X.revision, listo: X.listo,
  reinsercion: X.reinsercion, boveda: ROTULOS.boveda, sin_sw: X.arranque,
};

const PASOS: ReadonlyArray<readonly [Screen, `M-${number}`]> = [
  ['lista', X.lista], ['entrada', X.entrada], ['procesando', X.procesando], ['revision', X.revision], ['listo', X.listo],
];

function Pasos({ actual }: { actual: Screen }) {
  return (
    <nav aria-label={t(X.pasosDelAsunto)} class="pasos">
      <ol>
        {PASOS.map(([pantalla, id]) => (
          <li key={pantalla} aria-current={pantalla === actual ? 'step' : undefined} class={pantalla === actual ? 'actual' : undefined}>
            {t(id)}
          </li>
        ))}
      </ol>
    </nav>
  );
}

type Intencion = 'exportar' | 'pasar_a_guardar' | null;

/** Pide la frase (y su repetición en «No guardar») para exportar o para pasar a «Guardar cifrada». */
function DialogoFrase({ intencion, onCerrar }: { intencion: Exclude<Intencion, null>; onCerrar: () => void }) {
  const shell = useShell();
  const asunto = shell.asunto;
  const nueva = intencion === 'pasar_a_guardar' || asunto?.mode === 'no_guardar';
  const [frase, setFrase] = useState('');
  const [repetir, setRepetir] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [casilla, setCasilla] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  if (!asunto) return null;
  const ev = evaluarFrase(frase, nueva ? repetir : null, asunto.codigo);
  const puede = (nueva ? ev.valida : frase.length > 0) && (intencion !== 'pasar_a_guardar' || casilla) && !ocupado;

  const confirmar = async (): Promise<void> => {
    setOcupado(true);
    setError(undefined);
    const datos = { caseList: obtenerListaDelCaso(), table: obtenerTabla() ?? { asuntoId: asunto.asuntoId, counters: {}, entries: {}, documents: [] } };
    try {
      if (intencion === 'exportar') {
        const r = await puertos.boveda.exportar(datos, asunto.codigo, frase);
        actualizar({ asunto: { ...asunto, backedUpRevision: asunto.tableRevision } });
        mostrarAvisoGlobal('M-114', { archivo: r.archivo });
      } else {
        const r = await puertos.boveda.pasarAGuardar(asunto.codigo, frase, datos);
        actualizar({ asunto: { ...asunto, mode: 'guardar', asuntoId: r.asuntoId, persisted: r.persisted, backedUpRevision: asunto.tableRevision } });
        quitarAvisoAsunto('M-14');
        agregarAvisoAsunto({ id: r.persisted ? 'M-21' : 'M-22' });
      }
      setFrase('');
      setRepetir('');
      onCerrar();
    } catch (e) {
      setError(mensajeDeCodigo(codigoDeError(e), 'tabla'));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <p>{intencion === 'exportar' ? t(X.exportarCopia) : t('M-19')}</p>
      <CampoFrase
        etiqueta={nueva ? t('M-15') : t(X.fraseExportacion)}
        valor={frase}
        onInput={setFrase}
        mostrar={mostrar}
        alMostrar={() => { setMostrar(!mostrar); }}
        rotuloMostrar={mostrar ? t(X.ocultar) : t(ROTULOS.mostrar)}
        error={nueva ? ev.errorFrase : undefined}
        contador={nueva ? ev.contador : undefined}
        deshabilitado={ocupado}
      />
      {nueva ? (
        <CampoFrase etiqueta={t('M-16')} valor={repetir} onInput={setRepetir} mostrar={mostrar} error={ev.errorRepetir} deshabilitado={ocupado} />
      ) : null}
      {intencion === 'pasar_a_guardar' ? <Casilla etiqueta={t('M-19')} marcada={casilla} onCambio={setCasilla} deshabilitado={ocupado} /> : null}
      {ocupado ? <p role="status">{t('M-20')}</p> : null}
      {error ? <p role="alert" class="error-campo" data-prueba="error-frase">{error}</p> : null}
      <div class="acciones">
        <button type="button" disabled={!puede} onClick={() => { void confirmar(); }}>
          {intencion === 'exportar' ? t(ROTULOS.exportar_tabla_cifrada) : t(ROTULOS.pasar_a_guardar_cifrada)}
        </button>
        <button type="button" class="secundario" onClick={onCerrar}>{t(ROTULOS.cancelar)}</button>
      </div>
    </>
  );
}

function MenuAsunto({ alElegir }: { alElegir: (i: Exclude<Intencion, null>) => void }) {
  const { asunto } = useShell();
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const alClic = (e: Event): void => { if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false); };
    const alTecla = (e: KeyboardEvent): void => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('pointerdown', alClic);
    document.addEventListener('keydown', alTecla);
    return () => { document.removeEventListener('pointerdown', alClic); document.removeEventListener('keydown', alTecla); };
  }, [abierto]);
  if (!asunto) return null;
  const elegir = (i: Exclude<Intencion, null>): void => { setAbierto(false); alElegir(i); };
  return (
    <div class="menu" ref={ref}>
      <button type="button" class="secundario" aria-expanded={abierto} aria-haspopup="true" onClick={() => { setAbierto(!abierto); }}>
        {t(X.menuDelAsunto)}
      </button>
      {abierto ? (
        <ul class="menu-lista">
          <li><button type="button" class="secundario" onClick={() => { elegir('exportar'); }}>{t(ROTULOS.exportar_tabla_cifrada)}</button></li>
          {asunto.mode === 'no_guardar' ? (
            <li><button type="button" class="secundario" onClick={() => { elegir('pasar_a_guardar'); }}>{t(ROTULOS.pasar_a_guardar_cifrada)}</button></li>
          ) : null}
          <li><button type="button" class="secundario" onClick={() => { setAbierto(false); cerrarAsunto(); }}>{t(ROTULOS.cerrar_asunto)}</button></li>
        </ul>
      ) : null}
    </div>
  );
}

function BandaActualizacion({ alExportar }: { alExportar: () => void }) {
  const { asunto, phase } = useShell();
  const [oculta, setOculta] = useState(false);
  const [acepta, setAcepta] = useState(false);
  if (oculta) return null;
  const respaldada = asunto === null || asunto.backedUpRevision === asunto.tableRevision;
  const enCurso = asunto !== null && phase !== 'vacio';
  const puede = respaldada && (!enCurso || acepta);
  return (
    <section class="banda" aria-label={t(X.avisos)} data-prueba="banda-actualizacion">
      <p>{t('M-104')}</p>
      {enCurso ? <Casilla etiqueta={t('M-105')} marcada={acepta} onCambio={setAcepta} /> : null}
      {!respaldada ? <p class="ayuda">{t(X.antesDeActualizar)}</p> : null}
      <div class="acciones">
        {asunto ? <button type="button" class="secundario" onClick={alExportar}>{t(ROTULOS.exportar_tabla_cifrada)}</button> : null}
        <button
          type="button"
          disabled={!puede}
          onClick={() => { aplicarActualizacionYRecargar(() => { puertos.sw.aplicarActualizacion(); }); }}
        >
          {t(ROTULOS.actualizar_ahora)}
        </button>
        <button type="button" class="secundario" onClick={() => { setOculta(true); }}>{t(ROTULOS.mas_tarde)}</button>
      </div>
    </section>
  );
}

function AvisoInactividad() {
  const restantes = useCuentaRegresiva();
  return (
    <Dialogo abierto={restantes !== null} titulo={t(X.cuentaRegresiva)} onCerrar={seguirTrabajando} rol="alertdialog" clase="inactividad">
      <p data-prueba="aviso-inactividad">{t('M-101', { s: restantes ?? 0 })}</p>
      <div class="acciones">
        <button type="button" onClick={seguirTrabajando}>{t(ROTULOS.seguir_trabajando)}</button>
      </div>
    </Dialogo>
  );
}

function Pie() {
  const [compilacion, setCompilacion] = useState<string | null>(null);
  const { offlineReady } = useShell();
  useEffect(() => {
    let vivo = true;
    void calcularHuellas().then((h) => { if (vivo) setCompilacion(compilacionCorta(h.indexHtml)); });
    return () => { vivo = false; };
  }, [offlineReady]);
  return (
    <footer class="pie">
      <p data-prueba="promesa-pie">{t('M-01')}</p>
      <p>
        <span data-prueba="version">{t(ROTULOS.version_version_compilacion_compilacion, { version: __SIGLOW_VERSION__, compilacion: compilacion ?? t('M-154') })}</span>
        {' '}
        <button type="button" class="enlace" onClick={() => { actualizar({ dialog: 'acerca' }); }}>{t(ROTULOS.acerca_de)}</button>
      </p>
    </footer>
  );
}

/** Avisos persistentes del asunto (M-14, M-21, M-22, M-91…) y aviso breve global (M-125, M-114). */
function Avisos() {
  const avisos = useAvisosAsunto();
  const global = useAvisoGlobal();
  return (
    <div class="avisos" role="region" aria-label={t(X.avisos)}>
      {avisos.map((a) => <p key={a.id} role="status" data-prueba={`aviso-${a.id}`}>{t(a.id, a.params)}</p>)}
      <p role="status" class="aviso-global" data-prueba="aviso-global">
        {global ? (
          <>
            {t(global.id, global.params)}
            {' '}
            <button type="button" class="enlace" onClick={ocultarAvisoGlobal}>{t(X.cerrar)}</button>
          </>
        ) : null}
      </p>
    </div>
  );
}

export function Armazon({ pantalla, children }: { pantalla: Screen; children: ComponentChildren }) {
  const shell = useShell();
  const asunto = shell.asunto;
  const [intencion, setIntencion] = useState<Intencion>(null);
  const [anuncio, setAnuncio] = useState('');
  const principal = useRef<HTMLElement>(null);
  const primera = useRef(true);
  useListaDelCaso();

  // Cambio de pantalla: foco al h1 nuevo y anuncio «Pantalla: {nombre}» (8.2.1, 8.6.3). No en la carga inicial.
  useEffect(() => {
    const nombre = t(NOMBRE_PANTALLA[pantalla]);
    if (primera.current) { primera.current = false; return; }
    setAnuncio(t(ROTULOS.pantalla_nombre, { nombre }));
    principal.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [pantalla]);

  const enPasos = asunto !== null && PASOS.some(([p]) => p === pantalla);
  return (
    <div class="app">
      <button type="button" class="salto" onClick={() => { principal.current?.focus(); }}>{t(X.irAlContenido)}</button>
      <header class="cabecera">
        <p class="marca">{t(ROTULOS.sig_low)}</p>
        {asunto ? (
          <p class="chip" data-prueba="chip-asunto">
            {t(X.asuntoChip, { codigo: asunto.codigo })}
            {' · '}
            {asunto.mode === 'guardar' ? t(ROTULOS.tabla_cifrada_en_este_equipo) : t(ROTULOS.tabla_solo_en_memoria)}
          </p>
        ) : null}
        <p class="sin-conexion" role="status" aria-label={t(X.estadoDeSigLow)} data-prueba="sin-conexion">
          {!shell.swReady
            ? (shell.swInstall ? t('M-37', { hecho: shell.swInstall.done, total: shell.swInstall.total }) : '')
            : shell.offlineReady ? t('M-39') : ''}
        </p>
        <div class="herramientas">
          {asunto ? <MenuAsunto alElegir={setIntencion} /> : null}
          {asunto ? <button type="button" onClick={() => { bloquear(true); }}>{t(ROTULOS.bloquear)}</button> : null}
        </div>
      </header>
      {enPasos ? <Pasos actual={pantalla} /> : null}
      {shell.updateWaiting ? <BandaActualizacion alExportar={() => { setIntencion('exportar'); }} /> : null}
      <Avisos />
      <main id="contenido" tabIndex={-1} ref={principal}>
        {children}
      </main>
      <p class="solo-lectores" role="status" data-prueba="anuncio-pantalla">{anuncio}</p>
      <Pie />
      <Dialogo
        abierto={intencion !== null}
        titulo={intencion === 'pasar_a_guardar' ? t(ROTULOS.pasar_a_guardar_cifrada) : t(ROTULOS.exportar_tabla_cifrada)}
        onCerrar={() => { setIntencion(null); }}
      >
        {intencion !== null ? <DialogoFrase intencion={intencion} onCerrar={() => { setIntencion(null); }} /> : null}
      </Dialogo>
      <AvisoInactividad />
    </div>
  );
}
