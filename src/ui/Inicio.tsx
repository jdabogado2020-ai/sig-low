// Pantalla 1 · Inicio = «Cargar documento» (8.2.2; F2, D-23): promesa, guía de 3 pasos la primera vez, tarjeta «Antes de empezar»,
// zona de carga y «Pegar texto» con el detector de nombres a la vista (F8, v1.1.1), y «Opciones avanzadas» plegadas: nombres que
// siempre deben ocultarse y la llave para devolver los datos reales (crear o abrir un caso con contraseña).
import './vista/vista.css';
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { randomIds } from '../io/txt-read.ts';
import type { AsuntoId } from '../core/types.ts';
import { CampoFrase, CampoTexto, Casilla, Grupo, Seleccion } from './campos.tsx';
import { actualizar, fijarAvisoInicio, ir, obtenerAvisoInicio, suscribir, useShell, type SaveMode } from './estado.ts';
import { evaluarFrase } from './frase.ts';
import { alterno, mensajeDeCodigo, ROTULOS, t, X } from './mensajes.ts';
import { tomarPreseleccion } from './boveda/preseleccion.ts';
import { persistenciaDelModelo } from './modelo-puerto.ts';
import { agregarAvisoAsunto, fijarListaDelCaso, fijarTabla, obtenerListaDelCaso, registrarLimpieza, tablaVacia, useFraseEscrita, useListaDelCaso } from './sesion.ts';
import { CargaDocumento } from './Entrada.tsx';
import { TarjetaDetector } from './flujo/Detector.tsx';
import { asegurarCaso } from './flujo/flujo.ts';
import { Ayuda } from './flujo/Ayuda.tsx';
import { tf } from './flujo/textos.ts';
import { codigoDeError, puertos, type AsuntoListado } from './servicios.ts';

const REGEX_CODIGO = /^(?=.*[A-Za-z0-9])[A-Za-z0-9 ._/-]{1,40}$/u;

/**
 * M-7: cada vaciado del estado `[M]` (el botón «Bloquear», la inactividad, el canal entre pestañas, `pagehide` y `pageshow`,
 * «Cerrar asunto», «Borrar todo») cambia este número, que es la `key` de los formularios: se vuelven a montar con las frases,
 * «Mostrar» y la casilla vacíos. Se registra antes de pintar, para que ningún bloqueo llegue sin la limpieza puesta.
 */
function useGeneracionDeFormularios(): number {
  const [n, setN] = useState(0);
  useLayoutEffect(() => registrarLimpieza(() => { setN((x) => x + 1); }), []);
  return n;
}

function useAvisoInicio() {
  const [, forzar] = useState(0);
  useEffect(() => suscribir(() => { forzar((n) => n + 1); }), []);
  return obtenerAvisoInicio();
}

const AVISO_INICIAL: ReadonlyArray<`M-${number}`> = ['M-03', 'M-04', 'M-05', 'M-06', 'M-07'];
const RECOMENDACIONES = ['M-2210', 'M-2211', 'M-2212'] as const;

/** F2 · «Antes de empezar»: tres recomendaciones breves y «Más información» con los avisos completos (M-03 a M-07). */
function AvisoInicial() {
  const [plegado, setPlegado] = useState(false);
  const [mas, setMas] = useState(false);
  return (
    <section class="aviso-inicial" aria-labelledby="ai-titulo" data-prueba="aviso-inicial">
      <h2 id="ai-titulo" tabIndex={-1}>{t('M-02')}</h2>
      {plegado ? null : (
        <>
          <ul>
            {RECOMENDACIONES.map((id) => <li key={id}>{tf(id)}</li>)}
          </ul>
          {mas ? <ul class="aviso-completo" data-prueba="aviso-completo">{AVISO_INICIAL.map((id) => <li key={id}>{t(id)}</li>)}</ul> : null}
          <div class="acciones">
            <button type="button" class="enlace" aria-expanded={mas} onClick={() => { setMas(!mas); }}>{mas ? tf('M-2214') : tf('M-2213')}</button>
            {/* 2.4.3: «Entendido» desaparece al plegar; el foco pasa al título de la tarjeta, que queda. */}
            <button type="button" class="secundario" onClick={() => { setPlegado(true); queueMicrotask(() => { document.getElementById('ai-titulo')?.focus(); }); }}>{t('M-08')}</button>
          </div>
        </>
      )}
    </section>
  );
}

/** F2 · Guía de 3 pasos la primera vez (en memoria: vuelve a aparecer al recargar, nada se guarda en el navegador). */
let guiaCerrada = false;
function GuiaInicial() {
  const [cerrada, setCerrada] = useState(guiaCerrada);
  if (cerrada) return null;
  return (
    <section class="guia" aria-labelledby="guia-titulo" data-prueba="guia">
      <h2 id="guia-titulo">{tf('M-2205')}</h2>
      <ol>
        <li>{tf('M-2206')}</li>
        <li>{tf('M-2207')}</li>
        <li>{tf('M-2208')}</li>
      </ol>
      {/* 2.4.3: la guía sale del árbol; el foco pasa al título de la pantalla. */}
      <button type="button" class="secundario" onClick={() => { guiaCerrada = true; setCerrada(true); queueMicrotask(() => { document.querySelector<HTMLElement>('main h1')?.focus(); }); }}>{tf('M-2209')}</button>
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
  useFraseEscrita(frase !== '' || repetir !== '');

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
      // D-23: los nombres que el abogado ya escribió en el caso efímero pasan al caso nuevo.
      fijarListaDelCaso(shell.asunto?.efimero === true ? [...obtenerListaDelCaso()] : []);
      fijarTabla(tablaVacia(asuntoId));
      fijarAvisoInicio(null);
      agregarAvisoAsunto(modo === 'guardar' ? { id: persisted ? 'M-21' : 'M-22' } : { id: 'M-14' });
      actualizar({
        asunto: { asuntoId, codigo: limpio, mode: modo, persisted, tableRevision: 0, backedUpRevision: modo === 'guardar' ? 0 : null },
        phase: 'vacio',
      });
    } catch (e) {
      // SESION_DESCONOCIDA al crear solo sale de cerrar() durante la derivación o la escritura (B-21): es un bloqueo, que ya
      // mostró M-102 (o la página se fue con pagehide); no es un error del formulario.
      const codigo = codigoDeError(e);
      if (codigo !== 'SESION_DESCONOCIDA') setError(mensajeDeCodigo(codigo, 'tabla'));
    } finally {
      // 6.6.5 y M-7: las frases no quedan en los campos tras el intento, salga bien o mal.
      setFrase('');
      setRepetir('');
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
  // «Abrir» en la Bóveda lleva aquí con el asunto ya elegido (8.2.9); solo se usa si el asunto sigue en la lista.
  const [elegido, setElegido] = useState(() => tomarPreseleccion() ?? '');
  const [frase, setFrase] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  useFraseEscrita(frase !== '');
  const puede = !ocupado && elegido !== '' && frase !== '' && asuntos.some((a) => a.asuntoId === elegido);

  const abrir = async (destino: 'inicio' | 'reinsercion'): Promise<void> => {
    if (!puede) return;
    setOcupado(true);
    setError(undefined);
    try {
      const r = await puertos.boveda.abrir(elegido as AsuntoId, frase.normalize('NFC'));
      fijarListaDelCaso(r.caseList);
      fijarTabla(r.table);
      fijarAvisoInicio(null);
      actualizar({
        asunto: { asuntoId: r.asuntoId, codigo: r.codigo, mode: 'guardar', persisted: null, tableRevision: 0, backedUpRevision: 0 },
        phase: 'vacio',
      });
      ir(destino);
    } catch (e) {
      // SESION_DESCONOCIDA al abrir es el aborto por un bloqueo (el botón, la inactividad, otra pestaña) o pagehide mientras se
      // derivaba la clave (B-21): no es una frase equivocada y no se muestra M-202. El bloqueo ya volvió a montar el formulario,
      // con la frase vacía, y mostró M-102 (M-7).
      const codigo = codigoDeError(e);
      if (codigo !== 'SESION_DESCONOCIDA') setError(mensajeDeCodigo(codigo, 'tabla'));
    } finally {
      // 6.6.5 y M-7: el campo se vacía al terminar la derivación, también si falla; otro clic no reabre el asunto sin la frase.
      setFrase('');
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
            onEnter={() => { void abrir('inicio'); }}
          />
          {ocupado ? <p role="status">{t('M-20')}</p> : null}
          <div class="acciones">
            <button type="button" disabled={!puede} onClick={() => { void abrir('inicio'); }}>{t(ROTULOS.abrir_para_anonimizar)}</button>
            <button type="button" class="secundario" disabled={!puede} onClick={() => { void abrir('reinsercion'); }}>{t(ROTULOS.reinsertar_una_respuesta)}</button>
          </div>
        </form>
      )}
    </section>
  );
}

/** «Nombres que siempre deben ocultarse»: abre el caso efímero si hace falta y lleva a la lista (D-23). */
function OpcionLista() {
  const lista = useListaDelCaso();
  return (
    <section class="opcion" aria-labelledby="op-lista" data-prueba="opcion-lista">
      <h3 id="op-lista">{t(X.lista)} <Ayuda tema={t(X.lista)} texto={tf('M-2217')} /></h3>
      <button type="button" class="secundario" onClick={() => { asegurarCaso(); ir('lista'); }}>{tf('M-2218', { n: lista.length })}</button>
    </section>
  );
}

export function Inicio() {
  const shell = useShell();
  const aviso = useAvisoInicio();
  const [asuntos, setAsuntos] = useState<readonly AsuntoListado[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const generacion = useGeneracionDeFormularios();
  useEffect(() => {
    let vivo = true;
    void puertos.boveda.listar().then((l) => { if (vivo) setAsuntos(l); }).catch(() => { if (vivo) setAsuntos([]); });
    return () => { vivo = false; };
  }, []);
  const caso = shell.asunto !== null && shell.asunto.efimero !== true ? shell.asunto : null;
  return (
    <>
      <h1 tabIndex={-1}>{t(X.inicio)}</h1>
      <p data-prueba="promesa" class="promesa">{t('M-01')}</p>
      <p class="ayuda">{tf('M-2215')}</p>
      {aviso ? (
        <div class="aviso-bloqueo" role="status" data-prueba="aviso-bloqueo">
          <p>{aviso === 'bloqueado_efimero' ? tf('M-2300') : t('M-102')}</p>
          {aviso === 'bloqueado_sin_guardar' ? <p>{t('M-103')}</p> : null}
        </div>
      ) : null}
      <GuiaInicial />
      <AvisoInicial />
      {caso !== null ? <p role="status" data-prueba="caso-abierto">{tf('M-2224', { codigo: caso.codigo })}</p> : null}
      <CargaDocumento detector={<TarjetaDetector />} />
      <details class="avanzadas" data-prueba="opciones-avanzadas">
        <summary>{tf('M-2216')}</summary>
        <OpcionLista />
        <section class="opcion" aria-labelledby="op-llave" data-prueba="opcion-llave">
          <h3 id="op-llave">{tf('M-2220')} <Ayuda tema={tf('M-2220')} texto={tf('M-2221')} /></h3>
          <div class="dos-columnas">
            <CrearAsunto key={`crear-${generacion}`} existentes={asuntos} ocupado={ocupado} setOcupado={setOcupado} />
            <AbrirAsunto key={`abrir-${generacion}`} asuntos={asuntos} ocupado={ocupado} setOcupado={setOcupado} />
          </div>
          <div class="acciones">
            <button type="button" class="secundario" onClick={() => { ir('boveda'); }}>{tf('M-2222')}</button>
          </div>
        </section>
      </details>
    </>
  );
}
