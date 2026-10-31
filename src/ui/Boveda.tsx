// Pantalla 8 · Bóveda (PC-6, 8.2.9, 6.7): los asuntos guardados cifrados en este navegador. Muestra solo el código de cada asunto y
// sus fechas, nunca el contenido de una tabla (INV-V01, V-35, S-5.3). Permite abrir, exportar cifrado, cambiar la frase de paso,
// importar un `.siglow`, borrar un asunto o todos, quitar el modelo de apoyo, ver el estado de `persist()` y bloquear. Las frases
// viven solo dentro de cada operación; los errores salen como `ErrorCode`, nunca como texto del sistema (F-07).
import './boveda/boveda.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ErrorCode } from '../core/types.ts';
import { bloquear } from './bloqueo.ts';
import { CampoFrase, CampoTexto, Casilla } from './campos.tsx';
import { Dialogo } from './dialogo.tsx';
import { actualizar, ir, obtener, useShell } from './estado.ts';
import { evaluarFrase } from './frase.ts';
import { alterno, idDeCodigo, mensajeDeCodigo, ROTULOS, t, X, type MessageId, type MsgParam } from './mensajes.ts';
import { fijarPreseleccion } from './boveda/preseleccion.ts';
import { cambiarFraseDeAsunto, listarAsuntos, type FilaBoveda } from './boveda/registros.ts';
import { B } from './boveda/textos.ts';
import { codigoDeError, puertos } from './servicios.ts';
import { vaciarEstadoM } from './sesion.ts';

interface Aviso { id: MessageId; params?: Readonly<Record<string, MsgParam>>; alterno?: number; rol: 'status' | 'alert' }

function fecha(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Mensaje de un rechazo al importar: los textos de 8.5.2 para los pasos de 6.7.6 (M-207 para el tamaño). */
function mensajeDeImportacion(codigo: ErrorCode | string): MessageId {
  return codigo === 'ARCHIVO_DEMASIADO_GRANDE' ? 'M-207' : idDeCodigo(codigo, 'tabla');
}

type Dialogos =
  | { tipo: 'exportar'; fila: FilaBoveda }
  | { tipo: 'frase'; fila: FilaBoveda }
  | { tipo: 'borrar'; fila: FilaBoveda }
  | { tipo: 'todo' }
  | { tipo: 'modelo' }
  | null;

// ---------------------------------------------------------------------------------------------
// Diálogos
// ---------------------------------------------------------------------------------------------

/** «Exportar cifrado»: pide la frase del asunto (M-15), lo abre en memoria y descarga el `.siglow` con sal nueva (M-114). */
function CuerpoExportar({ fila, alTerminar, alAviso }: { fila: FilaBoveda; alTerminar: () => void; alAviso: (a: Aviso) => void }) {
  const [frase, setFrase] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const exportar = async (): Promise<void> => {
    setOcupado(true);
    setError(undefined);
    try {
      const abierto = await puertos.boveda.abrir(fila.asuntoId, frase.normalize('NFC'));
      try {
        const r = await puertos.boveda.exportar({ caseList: abierto.caseList, table: abierto.table }, abierto.codigo, frase.normalize('NFC'));
        alAviso({ id: 'M-114', params: { archivo: r.archivo }, rol: 'status' });
      } finally {
        if (obtener().asunto === null) puertos.boveda.cerrar();
      }
      setFrase('');
      alTerminar();
    } catch (e) {
      setError(mensajeDeCodigo(codigoDeError(e), 'tabla'));
    } finally {
      setOcupado(false);
    }
  };
  return (
    <>
      <p>{t(X.exportarCopia)}</p>
      <CampoFrase
        etiqueta={t(X.fraseDelAsunto)} valor={frase} onInput={(v) => { setFrase(v); setError(undefined); }} mostrar={mostrar}
        alMostrar={() => { setMostrar(!mostrar); }} rotuloMostrar={mostrar ? t(X.ocultar) : t(ROTULOS.mostrar)}
        error={error} deshabilitado={ocupado} onEnter={() => { if (frase !== '' && !ocupado) void exportar(); }}
      />
      {ocupado ? <p role="status">{t('M-20')}</p> : null}
      <div class="acciones">
        <button type="button" disabled={frase === '' || ocupado} onClick={() => { void exportar(); }}>{t(ROTULOS.exportar_tabla_cifrada)}</button>
        <button type="button" class="secundario" onClick={alTerminar}>{t(ROTULOS.cancelar)}</button>
      </div>
    </>
  );
}

/** «Cambiar frase de paso»: frase actual, nueva ×2 y M-19 (6.7.4). */
function CuerpoCambiarFrase({ fila, alTerminar, alAviso }: { fila: FilaBoveda; alTerminar: () => void; alAviso: (a: Aviso) => void }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetir, setRepetir] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [sinRecuperacion, setSinRecuperacion] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const ev = evaluarFrase(nueva, repetir, fila.codigo);
  const puede = actual !== '' && ev.valida && sinRecuperacion && !ocupado;
  const cambiar = async (): Promise<void> => {
    if (!puede) return;
    setOcupado(true);
    setError(undefined);
    try {
      await cambiarFraseDeAsunto(fila.asuntoId, actual.normalize('NFC'), nueva.normalize('NFC'));
      puertos.boveda.cerrar();
      setActual('');
      setNueva('');
      setRepetir('');
      alAviso({ id: B.fraseCambiada, rol: 'status' });
      alTerminar();
    } catch (e) {
      setError(mensajeDeCodigo(codigoDeError(e), 'tabla'));
    } finally {
      setOcupado(false);
    }
  };
  const rotulo = mostrar ? t(X.ocultar) : t(ROTULOS.mostrar);
  return (
    <>
      <CampoFrase etiqueta={t(B.fraseActual)} valor={actual} onInput={(v) => { setActual(v); setError(undefined); }} mostrar={mostrar} alMostrar={() => { setMostrar(!mostrar); }} rotuloMostrar={rotulo} deshabilitado={ocupado} error={error} />
      <CampoFrase etiqueta={t('M-15')} valor={nueva} onInput={setNueva} mostrar={mostrar} contador={ev.contador} error={nueva !== '' ? ev.errorFrase : undefined} deshabilitado={ocupado} />
      <CampoFrase etiqueta={t('M-16')} valor={repetir} onInput={setRepetir} mostrar={mostrar} error={ev.errorRepetir} deshabilitado={ocupado} />
      <Casilla etiqueta={t('M-19')} marcada={sinRecuperacion} onCambio={setSinRecuperacion} deshabilitado={ocupado} />
      {ocupado ? <p role="status">{t('M-20')}</p> : null}
      <div class="acciones">
        <button type="button" disabled={!puede} onClick={() => { void cambiar(); }}>{t(ROTULOS.cambiar_frase_de_paso)}</button>
        <button type="button" class="secundario" onClick={alTerminar}>{t(ROTULOS.cancelar)}</button>
      </div>
    </>
  );
}

/** «Borrar»: M-108 con el código en el botón. */
function CuerpoBorrar({ fila, alTerminar, alAviso, alBorrado }: { fila: FilaBoveda; alTerminar: () => void; alAviso: (a: Aviso) => void; alBorrado: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  const borrar = async (): Promise<void> => {
    setOcupado(true);
    try {
      await puertos.boveda.borrarAsunto(fila.asuntoId);
      alAviso({ id: 'M-109', rol: 'status' });
      alBorrado();
    } catch (e) {
      alAviso({ id: idDeCodigo(codigoDeError(e), 'tabla'), rol: 'alert' });
    } finally {
      setOcupado(false);
      alTerminar();
    }
  };
  return (
    <>
      <p>{t('M-108', { codigo: fila.codigo })}</p>
      <div class="acciones">
        <button type="button" disabled={ocupado} onClick={() => { void borrar(); }}>{t(ROTULOS.borrar_codigo, { codigo: fila.codigo })}</button>
        <button type="button" class="secundario" onClick={alTerminar}>{t(ROTULOS.cancelar)}</button>
      </div>
    </>
  );
}

/** «Borrar todo»: M-110 y la palabra BORRAR escrita. Quien llama vacía el estado en claro (PD-4); 'bloqueado' → M-112. */
function CuerpoBorrarTodo({ alTerminar, alAviso, alBorrado }: { alTerminar: () => void; alAviso: (a: Aviso) => void; alBorrado: () => void }) {
  const [palabra, setPalabra] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const borrar = async (): Promise<void> => {
    if (palabra !== 'BORRAR') return;
    setOcupado(true);
    try {
      const r = await puertos.boveda.borrarTodo();
      if (r === 'bloqueado') {
        alAviso({ id: 'M-112', rol: 'alert' });
      } else {
        vaciarEstadoM();
        puertos.boveda.cerrar();
        fijarPreseleccion(null);
        actualizar({ asunto: null, phase: 'vacio' });
        alAviso({ id: 'M-111', rol: 'status' });
        alBorrado();
      }
    } catch (e) {
      alAviso({ id: idDeCodigo(codigoDeError(e), 'tabla'), rol: 'alert' });
    } finally {
      setOcupado(false);
      alTerminar();
    }
  };
  return (
    <>
      <p>{t('M-110')}</p>
      <CampoTexto etiqueta={t(B.escribaBorrar)} valor={palabra} onInput={setPalabra} deshabilitado={ocupado} onEnter={() => { void borrar(); }} />
      <div class="acciones">
        <button type="button" disabled={palabra !== 'BORRAR' || ocupado} onClick={() => { void borrar(); }}>{t(ROTULOS.borrar_todo)}</button>
        <button type="button" class="secundario" onClick={alTerminar}>{t(ROTULOS.cancelar)}</button>
      </div>
    </>
  );
}

/** «Quitar el modelo de apoyo»: igual que en Inicio (M-34). */
function CuerpoQuitarModelo({ alTerminar, alAviso }: { alTerminar: () => void; alAviso: (a: Aviso) => void }) {
  return (
    <>
      <p>{t('M-34')}</p>
      <div class="acciones">
        <button
          type="button"
          onClick={() => {
            alTerminar();
            void puertos.modelo.quitar().then(() => {
              actualizar({ model: { state: 'no_descargado' } });
              alAviso({ id: 'M-34', alterno: 0, rol: 'status' });
            });
          }}
        >
          {t(ROTULOS.quitar_el_modelo_de_apoyo)}
        </button>
        <button type="button" class="secundario" onClick={alTerminar}>{t(ROTULOS.cancelar)}</button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Importar un .siglow
// ---------------------------------------------------------------------------------------------

function ImportarTabla({ alAviso, alImportado }: { alAviso: (a: Aviso) => void; alImportado: () => void }) {
  const archivo = useRef<ArrayBuffer | null>(null);
  const entrada = useRef<HTMLInputElement | null>(null);
  const [hayArchivo, setHayArchivo] = useState(false);
  const [frase, setFrase] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [conflicto, setConflicto] = useState(false);
  const [otroCodigo, setOtroCodigo] = useState(false);
  const [codigoNuevo, setCodigoNuevo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const olvidar = (): void => {
    archivo.current = null;
    setHayArchivo(false);
    setFrase('');
    setConflicto(false);
    setOtroCodigo(false);
    setCodigoNuevo('');
  };
  const elegir = async (el: HTMLInputElement): Promise<void> => {
    const f = el.files?.[0];
    el.value = '';
    setError(undefined);
    setConflicto(false);
    if (f === undefined) return;
    try {
      archivo.current = await f.arrayBuffer();
      setHayArchivo(true);
    } catch {
      archivo.current = null;
      setHayArchivo(false);
      setError(t('M-205'));
    }
  };
  const importar = async (opcion?: { reemplazar: true } | { codigoNuevo: string }): Promise<void> => {
    const bytes = archivo.current;
    if (bytes === null || frase === '' || ocupado) return;
    setOcupado(true);
    setError(undefined);
    try {
      const r = await puertos.boveda.importar(bytes, frase.normalize('NFC'), opcion);
      olvidar();
      alAviso({ id: B.importado, params: { codigo: r.codigo }, rol: 'status' });
      alImportado();
    } catch (e) {
      const codigo = codigoDeError(e);
      if (codigo === 'ASUNTO_EXISTENTE') setConflicto(true);
      else setError(t(mensajeDeImportacion(codigo)));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section class="importar" aria-labelledby="h-importar" data-prueba="importar">
      <h2 id="h-importar">{t(ROTULOS.importar_tabla_siglow)}</h2>
      <form autocomplete="off" noValidate onSubmit={(e) => { e.preventDefault(); }}>
        <input
          type="file" accept=".siglow" hidden data-prueba="archivo-siglow" ref={entrada}
          onChange={(e) => { void elegir(e.currentTarget as HTMLInputElement); }}
        />
        <div class="acciones">
          <button type="button" class="secundario" disabled={ocupado} onClick={() => { entrada.current?.click(); }}>{t(B.elegirArchivo)}</button>
          {hayArchivo ? <span role="status" data-prueba="archivo-elegido">{t(B.archivoElegido)}</span> : null}
        </div>
        <CampoFrase
          etiqueta={t(B.fraseDelArchivo)} valor={frase} onInput={(v) => { setFrase(v); setError(undefined); }} mostrar={mostrar}
          alMostrar={() => { setMostrar(!mostrar); }} rotuloMostrar={mostrar ? t(X.ocultar) : t(ROTULOS.mostrar)}
          deshabilitado={ocupado} error={error} onEnter={() => { void importar(); }}
        />
        {ocupado ? <p role="status">{t('M-20')}</p> : null}
        <div class="acciones">
          <button type="button" disabled={!hayArchivo || frase === '' || ocupado || conflicto} onClick={() => { void importar(); }}>{t(B.importar)}</button>
        </div>
        {conflicto ? (
          <div class="confirmacion" role="alert" data-prueba="conflicto-importar">
            <p>{t('M-113')}</p>
            {otroCodigo ? (
              <>
                <CampoTexto etiqueta={t(B.nuevoCodigo)} valor={codigoNuevo} onInput={setCodigoNuevo} ayuda={t('M-09')} deshabilitado={ocupado} />
                <div class="acciones">
                  <button type="button" disabled={codigoNuevo.trim() === '' || ocupado} onClick={() => { void importar({ codigoNuevo: codigoNuevo.trim() }); }}>{t(ROTULOS.importar_con_otro_codigo)}</button>
                  <button type="button" class="secundario" onClick={() => { setOtroCodigo(false); }}>{t(ROTULOS.cancelar)}</button>
                </div>
              </>
            ) : (
              <div class="acciones">
                <button type="button" disabled={ocupado} onClick={() => { void importar({ reemplazar: true }); }}>{t(ROTULOS.reemplazar)}</button>
                <button type="button" class="secundario" disabled={ocupado} onClick={() => { setOtroCodigo(true); }}>{t(ROTULOS.importar_con_otro_codigo)}</button>
                <button type="button" class="secundario" disabled={ocupado} onClick={olvidar}>{t(ROTULOS.cancelar)}</button>
              </div>
            )}
          </div>
        ) : null}
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------------------------

export function Boveda() {
  const shell = useShell();
  const [filas, setFilas] = useState<readonly FilaBoveda[] | null>(null);
  const [persistida, setPersistida] = useState<boolean | null>(null);
  const [avisos, setAvisos] = useState<readonly Aviso[]>([]);
  const [dialogo, setDialogo] = useState<Dialogos>(null);
  const disponible = puertos.boveda.disponible();

  const cargar = async (): Promise<void> => {
    try { setFilas(await listarAsuntos()); } catch { setFilas([]); }
    try { setPersistida(await puertos.boveda.persistencia()); } catch { setPersistida(null); }
  };
  useEffect(() => {
    let vivo = true;
    void (async () => {
      let l: readonly FilaBoveda[] = [];
      let p: boolean | null = null;
      try { l = await listarAsuntos(); } catch { l = []; }
      try { p = await puertos.boveda.persistencia(); } catch { p = null; }
      if (vivo) { setFilas(l); setPersistida(p); }
    })();
    return () => { vivo = false; };
  }, []);

  const avisar = (a: Aviso): void => { setAvisos([a]); };
  const cerrarDialogo = (): void => { setDialogo(null); };
  const hay = filas !== null && filas.length > 0;

  return (
    <div class="boveda">
      <h1 tabIndex={-1}>{t(ROTULOS.boveda)}</h1>
      <p class="ayuda" data-prueba="solo-codigo">{t(B.soloCodigo)}</p>
      {!disponible ? <p role="alert" data-prueba="boveda-no-disponible">{t(shell.secureContext ? 'M-208' : 'M-38')}</p> : null}

      <section aria-labelledby="h-asuntos" data-prueba="asuntos-guardados">
        <h2 id="h-asuntos">{t(B.asuntosGuardados)}</h2>
        {filas === null ? null : filas.length === 0 ? (
          <p data-prueba="sin-asuntos">{t('M-106')}</p>
        ) : (
          <ul class="lista-asuntos" aria-label={t(B.listaDeAsuntos)}>
            {filas.map((f) => (
              <li key={f.asuntoId} class="tarjeta asunto-guardado" data-prueba="asunto-guardado">
                <p class="asunto-codigo"><strong data-prueba="codigo">{f.codigo}</strong></p>
                <p class="ayuda"><span data-prueba="creado">{t(B.creado, { fecha: fecha(f.creado) })}</span>{' · '}<span data-prueba="actualizado">{t(B.actualizado, { fecha: fecha(f.actualizado) })}</span></p>
                <div class="acciones" role="group" aria-label={t(B.accionesDe, { codigo: f.codigo })}>
                  <button type="button" aria-label={t(B.accionDe, { accion: t(ROTULOS.abrir), codigo: f.codigo })} onClick={() => { fijarPreseleccion(f.asuntoId); ir('inicio'); }}>{t(ROTULOS.abrir)}</button>
                  <button type="button" class="secundario" aria-label={t(B.accionDe, { accion: t(ROTULOS.exportar_cifrado), codigo: f.codigo })} onClick={() => { setDialogo({ tipo: 'exportar', fila: f }); }}>{t(ROTULOS.exportar_cifrado)}</button>
                  <button type="button" class="secundario" aria-label={t(B.accionDe, { accion: t(ROTULOS.cambiar_frase_de_paso), codigo: f.codigo })} onClick={() => { setDialogo({ tipo: 'frase', fila: f }); }}>{t(ROTULOS.cambiar_frase_de_paso)}</button>
                  <button type="button" class="secundario" aria-label={t(B.accionDe, { accion: t(ROTULOS.borrar), codigo: f.codigo })} onClick={() => { setDialogo({ tipo: 'borrar', fila: f }); }}>{t(ROTULOS.borrar)}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div class="acciones">
          <button type="button" class="secundario" disabled={!hay} onClick={() => { setDialogo({ tipo: 'todo' }); }}>{t(ROTULOS.borrar_todo)}</button>
        </div>
      </section>

      <section aria-labelledby="h-persistencia" data-prueba="persistencia-boveda">
        <h2 id="h-persistencia">{t(B.persistencia)}</h2>
        <p data-prueba="persistencia" data-persistente={persistida === true ? 'si' : 'no'}>{persistida === true ? t('M-107') : alterno('M-107', 0)}</p>
      </section>

      <ImportarTabla alAviso={avisar} alImportado={() => { void cargar(); }} />

      <section aria-labelledby="h-otras">
        <h2 id="h-otras">{t(B.otrasAcciones)}</h2>
        <div class="acciones">
          {shell.model.state === 'listo' ? (
            <button type="button" class="secundario" onClick={() => { setDialogo({ tipo: 'modelo' }); }}>{t(ROTULOS.quitar_el_modelo_de_apoyo)}</button>
          ) : null}
          <button type="button" onClick={() => { bloquear(true); }}>{t(ROTULOS.bloquear_ahora)}</button>
          <button type="button" class="secundario" onClick={() => { ir('inicio'); }}>{t(ROTULOS.volver)}</button>
        </div>
      </section>

      <div class="avisos-boveda" role="region" aria-label={t(X.avisos)} data-prueba="avisos-boveda">
        {avisos.map((a) => <p key={a.id} role={a.rol} data-aviso={a.id}>{a.alterno !== undefined ? alterno(a.id, a.alterno, a.params) : t(a.id, a.params)}</p>)}
      </div>

      <Dialogo abierto={dialogo?.tipo === 'exportar'} titulo={dialogo?.tipo === 'exportar' ? t(B.exportarDe, { codigo: dialogo.fila.codigo }) : ''} onCerrar={cerrarDialogo}>
        {dialogo?.tipo === 'exportar' ? <CuerpoExportar fila={dialogo.fila} alTerminar={cerrarDialogo} alAviso={avisar} /> : null}
      </Dialogo>
      <Dialogo abierto={dialogo?.tipo === 'frase'} titulo={dialogo?.tipo === 'frase' ? t(B.cambiarDe, { codigo: dialogo.fila.codigo }) : ''} onCerrar={cerrarDialogo}>
        {dialogo?.tipo === 'frase' ? <CuerpoCambiarFrase fila={dialogo.fila} alTerminar={cerrarDialogo} alAviso={avisar} /> : null}
      </Dialogo>
      <Dialogo abierto={dialogo?.tipo === 'borrar'} titulo={dialogo?.tipo === 'borrar' ? t(ROTULOS.borrar_codigo, { codigo: dialogo.fila.codigo }) : ''} onCerrar={cerrarDialogo} rol="alertdialog">
        {dialogo?.tipo === 'borrar' ? <CuerpoBorrar fila={dialogo.fila} alTerminar={cerrarDialogo} alAviso={avisar} alBorrado={() => { void cargar(); }} /> : null}
      </Dialogo>
      <Dialogo abierto={dialogo?.tipo === 'todo'} titulo={t(B.borrarTodos)} onCerrar={cerrarDialogo} rol="alertdialog">
        {dialogo?.tipo === 'todo' ? <CuerpoBorrarTodo alTerminar={cerrarDialogo} alAviso={avisar} alBorrado={() => { void cargar(); }} /> : null}
      </Dialogo>
      <Dialogo abierto={dialogo?.tipo === 'modelo'} titulo={t(ROTULOS.quitar_el_modelo_de_apoyo)} onCerrar={cerrarDialogo} rol="alertdialog">
        {dialogo?.tipo === 'modelo' ? <CuerpoQuitarModelo alTerminar={cerrarDialogo} alAviso={avisar} /> : null}
      </Dialogo>
    </div>
  );
}
