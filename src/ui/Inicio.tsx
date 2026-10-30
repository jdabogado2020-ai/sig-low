// Pantalla 1 · Inicio y asunto (8.2.2): promesa, aviso inicial, crear o abrir un asunto y tarjeta del modelo.
import { useEffect, useState } from 'preact/hooks';
import { randomIds } from '../io/txt-read.ts';
import type { AsuntoId } from '../core/types.ts';
import { CampoFrase, CampoTexto, Casilla, Grupo, Seleccion } from './campos.tsx';
import { actualizar, fijarAvisoInicio, ir, obtenerAvisoInicio, suscribir, useShell, type SaveMode } from './estado.ts';
import { evaluarFrase } from './frase.ts';
import { mensajeDeCodigo, ROTULOS, t, X } from './mensajes.ts';
import { agregarAvisoAsunto, fijarListaDelCaso, fijarTabla, tablaVacia } from './sesion.ts';
import { codigoDeError, puertos, type AsuntoListado } from './servicios.ts';

const REGEX_CODIGO = /^(?=.*[A-Za-z0-9])[A-Za-z0-9 ._/-]{1,40}$/u;

function useAvisoInicio() {
  const [, forzar] = useState(0);
  useEffect(() => suscribir(() => { forzar((n) => n + 1); }), []);
  return obtenerAvisoInicio();
}

const AVISO_INICIAL: ReadonlyArray<`M-${number}`> = ['M-03', 'M-04', 'M-05', 'M-06', 'M-07'];

function AvisoInicial() {
  const [plegado, setPlegado] = useState(false);
  return (
    <section class="aviso-inicial" aria-labelledby="ai-titulo" data-prueba="aviso-inicial">
      <h2 id="ai-titulo">{t('M-02')}</h2>
      {plegado ? null : (
        <>
          <ul>
            {AVISO_INICIAL.map((id) => <li key={id}>{t(id)}</li>)}
          </ul>
          <button type="button" class="secundario" onClick={() => { setPlegado(true); }}>{t('M-08')}</button>
        </>
      )}
    </section>
  );
}

function memoriaDelEquipo(): number | null {
  const m = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof m === 'number' ? m : null;
}

function TarjetaModelo() {
  const { model } = useShell();
  const reducido = (memoriaDelEquipo() ?? 8) < 8;
  const mb = puertos.modelo.estado().mb ?? (model.variant === 'respaldo' || reducido ? 303 : 626);
  const descargable = model.state === 'no_descargado' || model.state === 'fallo';
  const [error, setError] = useState<string | undefined>(undefined);
  const [quitar, setQuitar] = useState(false);
  const lanzar = async (): Promise<void> => {
    setError(undefined);
    try { await puertos.modelo.descargar(); } catch (e) { setError(mensajeDeCodigo(codigoDeError(e), 'modelo')); }
  };
  return (
    <section class="tarjeta" aria-labelledby="tm-titulo" data-prueba="tarjeta-modelo">
      <h2 id="tm-titulo">{t(X.modeloDeApoyo)}</h2>
      <p>{t('M-24', { mb })}</p>
      {descargable ? <p>{t('M-160', { mb })}</p> : null}
      {descargable && reducido ? <p>{t('M-168')}</p> : null}
      {model.state === 'descargando' ? (
        <p role="status">{t('M-27', { hecho: Math.round((model.doneBytes ?? 0) / 1_000_000), mb })}</p>
      ) : null}
      {model.state === 'verificando' ? <p role="status">{t('M-28')}</p> : null}
      {model.state === 'listo' ? <p role="status">{t('M-29')}</p> : null}
      {model.state === 'listo' && model.variant === 'respaldo' ? <p>{t('M-170')}</p> : null}
      {model.state === 'fallo' ? <p role="alert">{t('M-30')}</p> : null}
      {model.state === 'sin_espacio' ? <p role="alert">{t('M-32')}</p> : null}
      {model.state === 'sin_memoria' ? <p role="alert">{t('M-169')}</p> : null}
      {error ? <p role="alert" class="error-campo">{error}</p> : null}
      <p class="ayuda">{t('M-33')}</p>
      <div class="acciones">
        {descargable ? (
          <button type="button" disabled={!puertos.modelo.disponible()} onClick={() => { void lanzar(); }}>{t('M-25', { mb })}</button>
        ) : null}
        {model.state === 'descargando' ? (
          <button type="button" class="secundario" onClick={() => { puertos.modelo.cancelar(); }}>{t(ROTULOS.cancelar_descarga)}</button>
        ) : null}
        {model.state === 'listo' ? (
          <button type="button" class="secundario" onClick={() => { setQuitar(true); }}>{t(ROTULOS.quitar_el_modelo_de_este_equipo)}</button>
        ) : null}
        <button type="button" class="enlace" onClick={() => { actualizar({ dialog: 'creditos' }); }}>{t(ROTULOS.ver_creditos_y_licencias)}</button>
      </div>
      {quitar ? (
        <div class="confirmacion" role="alertdialog" aria-label={t(ROTULOS.quitar_el_modelo_de_este_equipo)}>
          <p>{t('M-34')}</p>
          <div class="acciones">
            <button
              type="button"
              onClick={() => {
                setQuitar(false);
                void puertos.modelo.quitar().then(() => { actualizar({ model: { state: 'no_descargado' } }); });
              }}
            >
              {t(ROTULOS.quitar_el_modelo_de_este_equipo)}
            </button>
            <button type="button" class="secundario" onClick={() => { setQuitar(false); }}>{t(ROTULOS.cancelar)}</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CrearAsunto({ existentes, ocupado, setOcupado }: { existentes: readonly AsuntoListado[]; ocupado: boolean; setOcupado: (b: boolean) => void }) {
  const shell = useShell();
  const [codigo, setCodigo] = useState('');
  const [tocoCodigo, setTocoCodigo] = useState(false);
  const [modo, setModo] = useState<SaveMode | null>(null);
  const [frase, setFrase] = useState('');
  const [repetir, setRepetir] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [sinRecuperacion, setSinRecuperacion] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const limpio = codigo.trim();
  const codigoValido = REGEX_CODIGO.test(limpio);
  const repetido = existentes.some((a) => a.codigo === limpio);
  const errorCodigo = tocoCodigo && limpio !== '' ? (!codigoValido ? t('M-10') : repetido ? t('M-11') : undefined) : undefined;
  const sinHttps = !shell.secureContext;
  const guardarNoDisponible = sinHttps || !puertos.boveda.disponible();
  const motivoGuardar = sinHttps ? t('M-38') : guardarNoDisponible ? t('M-208') : undefined;
  const guardar = modo === 'guardar';
  const ev = evaluarFrase(frase, repetir, limpio);
  const puede =
    !ocupado && codigoValido && !repetido && modo !== null &&
    (!guardar || (ev.valida && sinRecuperacion && !guardarNoDisponible));

  const crear = async (): Promise<void> => {
    if (!puede || modo === null) return;
    setOcupado(true);
    setError(undefined);
    try {
      let asuntoId: AsuntoId;
      let persisted: boolean | null = null;
      if (modo === 'guardar') {
        const r = await puertos.boveda.crear({ codigo: limpio, frase: frase.normalize('NFC') });
        asuntoId = r.asuntoId;
        persisted = r.persisted;
      } else {
        asuntoId = randomIds().next('asu') as AsuntoId;
      }
      setFrase('');
      setRepetir('');
      fijarListaDelCaso([]);
      fijarTabla(tablaVacia(asuntoId));
      fijarAvisoInicio(null);
      agregarAvisoAsunto(modo === 'guardar' ? { id: persisted ? 'M-21' : 'M-22' } : { id: 'M-14' });
      actualizar({
        asunto: { asuntoId, codigo: limpio, mode: modo, persisted, tableRevision: 0, backedUpRevision: modo === 'guardar' ? 0 : null },
        phase: 'vacio',
      });
      ir('lista');
    } catch (e) {
      setError(mensajeDeCodigo(codigoDeError(e), 'tabla'));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section class="crear" aria-labelledby="cr-titulo">
      <h2 id="cr-titulo">{t(X.crearUnAsunto)}</h2>
      <form
        autocomplete="off"
        noValidate
        onSubmit={(e) => { e.preventDefault(); }}
      >
        <CampoTexto
          etiqueta={t(X.codigoDelAsunto)}
          valor={codigo}
          onInput={(v) => { setCodigo(v); setTocoCodigo(true); }}
          ayuda={t('M-09')}
          error={errorCodigo}
          deshabilitado={ocupado}
        />
        <Grupo leyenda={t(X.modoDeLaTabla)}>
          <div class="radio">
            <input
              id="modo-guardar" type="radio" name="c-modo" checked={modo === 'guardar'} disabled={ocupado || guardarNoDisponible}
              aria-describedby={motivoGuardar ? 'modo-guardar-e' : 'modo-guardar-n'}
              onChange={() => { setModo('guardar'); }}
            />
            <label for="modo-guardar">{t('M-12')}</label>
            <p id="modo-guardar-n" class="ayuda">{t('M-23')}</p>
            {motivoGuardar ? <p id="modo-guardar-e" class="error-campo" data-prueba="guardar-no-disponible">{motivoGuardar}</p> : null}
          </div>
          <div class="radio">
            <input id="modo-no-guardar" type="radio" name="c-modo" checked={modo === 'no_guardar'} disabled={ocupado} onChange={() => { setModo('no_guardar'); }} />
            <label for="modo-no-guardar">{t('M-13')}</label>
          </div>
        </Grupo>
        {guardar ? (
          <>
            <CampoFrase
              etiqueta={t('M-15')}
              valor={frase}
              onInput={setFrase}
              mostrar={mostrar}
              alMostrar={() => { setMostrar(!mostrar); }}
              rotuloMostrar={mostrar ? t(X.ocultar) : t(ROTULOS.mostrar)}
              contador={ev.contador}
              error={frase !== '' ? ev.errorFrase : undefined}
              deshabilitado={ocupado}
            />
            <CampoFrase etiqueta={t('M-16')} valor={repetir} onInput={setRepetir} mostrar={mostrar} error={ev.errorRepetir} deshabilitado={ocupado} />
            <Casilla etiqueta={t('M-19')} marcada={sinRecuperacion} onCambio={setSinRecuperacion} deshabilitado={ocupado} />
          </>
        ) : null}
        {ocupado ? <p role="status" data-prueba="derivando">{t('M-20')}</p> : null}
        {error ? <p role="alert" class="error-campo" data-prueba="error-crear">{error}</p> : null}
        <div class="acciones">
          <button type="button" disabled={!puede} onClick={() => { void crear(); }}>{t(ROTULOS.crear_asunto)}</button>
        </div>
      </form>
    </section>
  );
}

function AbrirAsunto({ asuntos, ocupado, setOcupado }: { asuntos: readonly AsuntoListado[]; ocupado: boolean; setOcupado: (b: boolean) => void }) {
  const [elegido, setElegido] = useState('');
  const [frase, setFrase] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const puede = !ocupado && elegido !== '' && frase !== '';

  const abrir = async (destino: 'lista' | 'reinsercion'): Promise<void> => {
    if (!puede) return;
    setOcupado(true);
    setError(undefined);
    try {
      const r = await puertos.boveda.abrir(elegido as AsuntoId, frase.normalize('NFC'));
      setFrase('');
      fijarListaDelCaso(r.caseList);
      fijarTabla(r.table);
      fijarAvisoInicio(null);
      actualizar({
        asunto: { asuntoId: r.asuntoId, codigo: r.codigo, mode: 'guardar', persisted: null, tableRevision: 0, backedUpRevision: 0 },
        phase: 'vacio',
      });
      ir(destino);
    } catch (e) {
      setError(mensajeDeCodigo(codigoDeError(e), 'tabla'));
    } finally {
      setOcupado(false);
    }
  };

  const fecha = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
  };

  return (
    <section class="abrir" aria-labelledby="ab-titulo">
      <h2 id="ab-titulo">{t(X.abrirUnAsuntoGuardado)}</h2>
      {asuntos.length === 0 ? (
        <p data-prueba="sin-asuntos">{t('M-106')}</p>
      ) : (
        <form autocomplete="off" noValidate onSubmit={(e) => { e.preventDefault(); }}>
          <Seleccion
            etiqueta={t(X.asuntoGuardado)}
            valor={elegido}
            deshabilitado={ocupado}
            opciones={[['', t(X.elijaAsunto)], ...asuntos.map((a): readonly [string, string] => [a.asuntoId, `${a.codigo} · ${t(X.actualizadoEl, { fecha: fecha(a.actualizado) })}`])]}
            onCambio={setElegido}
          />
          <CampoFrase
            etiqueta={t(X.fraseDelAsunto)}
            valor={frase}
            onInput={(v) => { setFrase(v); setError(undefined); }}
            mostrar={mostrar}
            alMostrar={() => { setMostrar(!mostrar); }}
            rotuloMostrar={mostrar ? t(X.ocultar) : t(ROTULOS.mostrar)}
            error={error}
            deshabilitado={ocupado}
            onEnter={() => { void abrir('lista'); }}
          />
          {ocupado ? <p role="status">{t('M-20')}</p> : null}
          <div class="acciones">
            <button type="button" disabled={!puede} onClick={() => { void abrir('lista'); }}>{t(ROTULOS.abrir_para_anonimizar)}</button>
            <button type="button" class="secundario" disabled={!puede} onClick={() => { void abrir('reinsercion'); }}>{t(ROTULOS.reinsertar_una_respuesta)}</button>
          </div>
        </form>
      )}
    </section>
  );
}

export function Inicio() {
  const aviso = useAvisoInicio();
  const [asuntos, setAsuntos] = useState<readonly AsuntoListado[]>([]);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    let vivo = true;
    void puertos.boveda.listar().then((l) => { if (vivo) setAsuntos(l); }).catch(() => { if (vivo) setAsuntos([]); });
    return () => { vivo = false; };
  }, []);
  return (
    <>
      <h1 tabIndex={-1}>{t(X.inicio)}</h1>
      <p data-prueba="promesa" class="promesa">{t('M-01')}</p>
      {aviso ? (
        <div class="aviso-bloqueo" role="status" data-prueba="aviso-bloqueo">
          <p>{t('M-102')}</p>
          {aviso === 'bloqueado_sin_guardar' ? <p>{t('M-103')}</p> : null}
        </div>
      ) : null}
      <AvisoInicial />
      <div class="dos-columnas">
        <CrearAsunto existentes={asuntos} ocupado={ocupado} setOcupado={setOcupado} />
        <AbrirAsunto asuntos={asuntos} ocupado={ocupado} setOcupado={setOcupado} />
      </div>
      <TarjetaModelo />
      <div class="acciones">
        <button type="button" class="secundario" onClick={() => { ir('boveda'); }}>{t(ROTULOS.boveda)}</button>
      </div>
    </>
  );
}
