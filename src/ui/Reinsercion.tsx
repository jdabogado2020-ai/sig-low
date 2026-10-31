// Pantalla 7 · Reinserción (PC-6, 8.2.8, 6.10): el abogado pega la respuesta de la IA, Sig-Low encuentra los marcadores y propone el
// dato real de cada uno. Solo los marcadores exactos se reemplazan solos (INV-N01); los alterados y los desconocidos se deciden UNO A
// UNO (o por grupo de un mismo marcador, nunca «todos los alterados»); el texto con datos reales solo aparece con `ready` (INV-N02) y
// solo se copia o descarga después de M-99 (INV-N05). Nada de esto se guarda: el resultado vive en memoria [M] y se borra al salir.
import './reinsercion/reinsercion.css';
import { Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { DocumentRef, MappingTable, MarkerMatch, ReinsertionDecision, ReinsertionResult } from '../core/types.ts';
import { canonico } from '../io/txt-read.ts';
import { descartarAnalisis } from './analisis.ts';
import { cerrarAsunto } from './bloqueo.ts';
import { AreaTexto, atributosDeContenedor, atributosDeContenido, CampoTexto, Casilla, Seleccion, useIdNeutro } from './campos.tsx';
import { Dialogo } from './dialogo.tsx';
import { vaciarTodoElDocumento } from './documento.ts';
import { actualizar, ir, useShell } from './estado.ts';
import { registrarBusqueda } from './globales.ts';
import { ROTULOS, t, X } from './mensajes.ts';
import {
  buscarMarcadores, decidir, decidirGrupo, elegirOrigen, escribirRespuesta, reconocerFaltantes, useReinsercion, vaciarReinsercion,
} from './reinsercion/almacen.ts';
import {
  agruparPorMarcador, buscarEnTexto, construirLineas, entradaDe, MAXIMO_COINCIDENCIAS, MINIMO_BUSQUEDA, origenDe, pendientesDeDecision,
  reinsercionDisponible, subcadena, tramosReales, type MarcaBusqueda, type Rango,
} from './reinsercion/modelo.ts';
import { copiarConDatosReales, copiarSeleccionReal, descargarConDatosReales, vaciarPortapapeles } from './reinsercion/salida.ts';
import { tp } from './review/pestanas/textos.ts';
import { R } from './reinsercion/textos.ts';
import { obtenerTabla, suscribirSesion } from './sesion.ts';

function useTabla(): MappingTable | null {
  const [, forzar] = useState(0);
  useEffect(() => suscribirSesion(() => { forzar((n) => n + 1); }), []);
  return obtenerTabla();
}

const FORMATO: Readonly<Record<DocumentRef['source'], string>> = { pegado: '', txt: '.txt', docx: '.docx', pdf: 'PDF' };

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-CO', { dateStyle: 'medium' });
}

function rotuloDeDocumento(d: DocumentRef): string {
  const formato = d.source === 'pegado' ? t(R.textoPegado) : FORMATO[d.source];
  return t(R.opcionDocumento, { etiqueta: d.label, formato, fecha: fechaCorta(d.processedAt) });
}

// ---------------------------------------------------------------------------------------------
// Alertas, una por una
// ---------------------------------------------------------------------------------------------

function estadoDe(d: ReinsertionDecision | undefined): string {
  if (d === undefined) return t(R.sinDecidir);
  if (d.action === 'reemplazar') return t(R.seReemplaza);
  if (d.action === 'dejar') return t(R.seDeja);
  return t(R.seEdita);
}

/** Un marcador alterado o desconocido: el token tal como lo escribió la IA, la propuesta (solo si es alterado) y sus decisiones. */
function FilaAlerta({ m, d }: { m: MarkerMatch; d: ReinsertionDecision | undefined }) {
  const id = useIdNeutro();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const puedeReemplazar = m.kind === 'alterado' && m.proposal !== undefined;
  const abrirEdicion = (): void => {
    setValor(d?.action === 'editar' ? (d.text ?? '') : (m.proposal ?? m.found));
    setEditando(true);
  };
  return (
    <li class="alerta" data-prueba={`alerta-${m.kind}`}>
      <p id={`${id}-t`}>
        <code class="token" data-prueba="token">{t(R.encontrado, { token: m.found })}</code>
        {puedeReemplazar ? <span class="propuesta" data-prueba="propuesta">{' · '}{t(R.propuesta, { valor: m.proposal ?? '' })}</span> : null}
      </p>
      <p class="ayuda" data-prueba="estado-alerta" aria-live="polite">{estadoDe(d)}</p>
      {editando ? (
        <div class="edicion">
          <CampoTexto etiqueta={t(R.textoEditado)} valor={valor} onInput={setValor} />
          <div class="acciones">
            <button type="button" onClick={() => { decidir(m.id, 'editar', valor); setEditando(false); }}>{t(R.aplicar)}</button>
            <button type="button" class="secundario" onClick={() => { setEditando(false); }}>{t(X.cancelarEdicion)}</button>
          </div>
        </div>
      ) : (
        <div class="acciones">
          {puedeReemplazar ? (
            <button type="button" aria-pressed={d?.action === 'reemplazar'} aria-describedby={`${id}-t`} onClick={() => { decidir(m.id, 'reemplazar'); }}>
              {t(ROTULOS.reemplazar_por_el_dato_real)}
            </button>
          ) : null}
          <button type="button" class="secundario" aria-pressed={d?.action === 'dejar'} aria-describedby={`${id}-t`} onClick={() => { decidir(m.id, 'dejar'); }}>
            {t(ROTULOS.dejar_como_esta)}
          </button>
          <button type="button" class="secundario" aria-pressed={d?.action === 'editar'} aria-describedby={`${id}-t`} onClick={abrirEdicion}>
            {t(ROTULOS.editar)}
          </button>
        </div>
      )}
    </li>
  );
}

function ListaAlertas({ titulo, matches, decisiones, agrupable }: {
  titulo: string; matches: readonly MarkerMatch[]; decisiones: Readonly<Record<string, ReinsertionDecision>>; agrupable: boolean;
}) {
  if (matches.length === 0) return null;
  return (
    <section class="grupo-alertas" aria-label={titulo} data-prueba="lista-alertas">
      <h3>{titulo}</h3>
      {agruparPorMarcador(matches).map((g) => (
        <div key={g.marcador} class="grupo-marcador">
          {agrupable && g.matches.length > 1 ? (
            <div class="grupo-cabecera" data-prueba="grupo-marcador">
              <p>{t(R.grupo, { marcador: g.marcador, n: g.matches.length })}</p>
              <div class="acciones">
                <button type="button" class="secundario" onClick={() => { decidirGrupo(g.matches.map((x) => x.id), 'reemplazar'); }}>
                  {t(R.reemplazarGrupo, { n: g.matches.length })}
                </button>
                <button type="button" class="secundario" onClick={() => { decidirGrupo(g.matches.map((x) => x.id), 'dejar'); }}>
                  {t(R.dejarGrupo, { n: g.matches.length })}
                </button>
              </div>
            </div>
          ) : null}
          <ul class="lista-alertas">
            {g.matches.map((m) => <FilaAlerta key={m.id} m={m} d={decisiones[m.id]} />)}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Exactos({ matches, decisiones }: { matches: readonly MarkerMatch[]; decisiones: Readonly<Record<string, ReinsertionDecision>> }) {
  if (matches.length === 0) return null;
  return (
    <details class="exactos" data-prueba="exactos">
      <summary>{t(R.exactos, { n: matches.length })}</summary>
      <ul class="lista-alertas">
        {matches.map((m) => {
          const dejado = decisiones[m.id]?.action === 'dejar';
          return (
            <li key={m.id} class="alerta" data-prueba="alerta-exacto">
              <p><code class="token">{m.found}</code>{' '}<span class="ayuda">{dejado ? t(R.seDeja) : t(R.seReemplaza)}</span></p>
              <div class="acciones">
                {dejado ? (
                  <button type="button" class="secundario" onClick={() => { decidir(m.id, 'reemplazar'); }}>{t(ROTULOS.reemplazar_por_el_dato_real)}</button>
                ) : (
                  <button type="button" class="secundario" onClick={() => { decidir(m.id, 'dejar'); }}>{t(ROTULOS.dejar_como_esta)}</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function Alertas({ resultado }: { resultado: ReinsertionResult }) {
  const exactos = resultado.matches.filter((m) => m.kind === 'exacto');
  const alterados = resultado.matches.filter((m) => m.kind === 'alterado');
  const desconocidos = resultado.matches.filter((m) => m.kind === 'desconocido');
  const faltantes = resultado.alerts.missing;
  return (
    <section class="alertas" aria-labelledby="h-alertas" data-prueba="alertas">
      <h2 id="h-alertas">{t(R.alertas)}</h2>
      <div role="status" data-prueba="resumen-alertas">
        <p>{t(R.encontrados, { n: resultado.matches.length })}</p>
        {alterados.length > 0 ? <p data-prueba="resumen-alterados">{t('M-95', { n: alterados.length })}</p> : null}
        {desconocidos.length > 0 ? <p data-prueba="resumen-desconocidos">{t('M-96', { n: desconocidos.length })}</p> : null}
        {faltantes.length > 0 ? <p data-prueba="resumen-faltantes">{t('M-97', { n: faltantes.length })}</p> : null}
      </div>
      <ListaAlertas titulo={t(R.modificados)} matches={alterados} decisiones={resultado.decisions} agrupable />
      <ListaAlertas titulo={t(R.desconocidos)} matches={desconocidos} decisiones={resultado.decisions} agrupable={false} />
      <Exactos matches={exactos} decisiones={resultado.decisions} />
      {faltantes.length > 0 ? (
        <section class="faltantes" aria-labelledby="h-faltantes" data-prueba="faltantes">
          <h3 id="h-faltantes">{t(R.faltantes)}</h3>
          <ul>{faltantes.map((f) => <li key={f}><code class="token">{f}</code></li>)}</ul>
          <Casilla etiqueta={t(R.revisadoFaltantes)} marcada={resultado.missingAcknowledged} onCambio={reconocerFaltantes} />
        </section>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Resultado con datos reales
// ---------------------------------------------------------------------------------------------

/** Posición en el texto reinsertado de un punto de la selección. Los trozos llevan `data-g` y `data-len`; los saltos de línea no. */
function puntoG(panel: HTMLElement, nodo: Node, desp: number, inicio: boolean, largo: number): number {
  const r = document.createRange();
  let finPrevio = 0;
  for (const el of panel.querySelectorAll<HTMLElement>('[data-g]')) {
    const g = Number(el.dataset['g']);
    const len = Number(el.dataset['len']);
    r.selectNodeContents(el);
    const c = r.comparePoint(nodo, desp);
    if (c < 0) return inicio ? g : finPrevio;
    if (c === 0) {
      if (nodo.nodeType === Node.TEXT_NODE && el.contains(nodo)) return g + Math.min(desp, len);
      return desp > 0 ? g + len : g;
    }
    finPrevio = g + len;
  }
  return inicio ? largo : finPrevio;
}

function textoSeleccionado(panel: HTMLElement, texto: string): string | null {
  const sel = getSelection();
  if (sel === null || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if (!r.intersectsNode(panel)) return null;
  return subcadena(texto, puntoG(panel, r.startContainer, r.startOffset, true, texto.length), puntoG(panel, r.endContainer, r.endOffset, false, texto.length));
}

function VistaReal({ texto, reales, marcas }: { texto: string; reales: readonly Rango[]; marcas: readonly MarcaBusqueda[] }) {
  const panel = useRef<HTMLDivElement | null>(null);
  const textoRef = useRef(texto);
  textoRef.current = texto;
  const lineas = useMemo(() => construirLineas(texto, reales, marcas), [texto, reales, marcas]);

  // La coincidencia actual de la búsqueda se deja a la vista.
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('[data-actual="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [marcas]);

  // Ctrl + C sobre el resultado: manejador propio en captura; el navegador nunca genera text/html (8.7).
  useEffect(() => {
    const alCopiar = (e: ClipboardEvent): void => {
      const raiz = panel.current;
      if (raiz === null) return;
      const sel = getSelection();
      const toca = sel !== null && sel.rangeCount > 0 && !sel.isCollapsed && sel.getRangeAt(0).intersectsNode(raiz);
      const enfocado = raiz.contains(document.activeElement) || (e.target instanceof Node && raiz.contains(e.target));
      if (!toca && !enfocado) return;
      e.preventDefault();
      e.stopPropagation();
      copiarSeleccionReal(e, toca ? textoSeleccionado(raiz, textoRef.current) : null);
    };
    document.addEventListener('copy', alCopiar, true);
    return () => { document.removeEventListener('copy', alCopiar, true); };
  }, []);

  return (
    <div
      ref={(el) => { panel.current = el; atributosDeContenedor(el); }}
      class="vista-real"
      role="region"
      tabIndex={0}
      aria-label={t(R.regionResultado)}
      data-prueba="resultado-real"
      onContextMenu={(e) => { e.preventDefault(); }}
      onCut={(e) => { e.preventDefault(); }}
      onDragStart={(e) => { e.preventDefault(); }}
    >
      {lineas.map((l) => (
        <div key={l.g0} class="linea-real">
          {l.trozos.length === 0 ? <br /> : l.trozos.map((z) => {
            const actual = z.actual ? '1' : undefined;
            const clase = z.buscada ? (z.actual ? 'coincidencia coincidencia-actual' : 'coincidencia') : undefined;
            return z.real ? (
              <Fragment key={z.g}>
                <span class="insignia-real">{t(R.datoReal)}</span>
                <mark class={clase} data-g={z.g} data-len={z.texto.length} data-actual={actual} data-dato-real="1">{z.texto}</mark>
              </Fragment>
            ) :<span key={z.g} class={clase} data-g={z.g} data-len={z.texto.length} data-actual={actual}>{z.texto}</span>;
          })}
        </div>
      ))}
    </div>
  );
}

function AreaRespaldo({ texto }: { texto: string }) {
  const id = useIdNeutro();
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, [texto]);
  return (
    <div class="campo respaldo-copia" data-prueba="respaldo-copia">
      <label for={id}>{t(R.respaldo)}</label>
      <textarea id={id} name={id} readOnly rows={8} value={texto} ref={(el) => { ref.current = el; atributosDeContenido(el); }} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Búsqueda propia (V-29, M-72)
// ---------------------------------------------------------------------------------------------

function CampoBusqueda(p: {
  entrada: { current: HTMLInputElement | null }; consulta: string; n: number; indice: number; truncada: boolean;
  alEscribir: (v: string) => void; alMover: (delta: number) => void;
}) {
  const id = useIdNeutro();
  const corta = p.consulta.trim().length > 0 && p.consulta.trim().length < MINIMO_BUSQUEDA;
  return (
    <div class="busqueda-reinsercion" role="search" aria-label={tp('M-1851')} data-prueba="busqueda">
      <div class="campo">
        <label for={id}>{tp('M-1850')}</label>
        <div class="fila">
          <input
            id={id} name={id} type="text" value={p.consulta} aria-describedby={`${id}-a`}
            ref={(el) => { p.entrada.current = el; atributosDeContenido(el); }}
            onInput={(e) => { p.alEscribir((e.currentTarget as HTMLInputElement).value); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); p.alMover(e.shiftKey ? -1 : 1); }
              else if (e.key === 'Escape' && p.consulta !== '') { e.preventDefault(); e.stopPropagation(); p.alEscribir(''); }
            }}
          />
          <button type="button" class="secundario" disabled={p.n === 0} aria-label={tp('M-1855')} onClick={() => { p.alMover(-1); }}>‹</button>
          <button type="button" class="secundario" disabled={p.n === 0} aria-label={tp('M-1854')} onClick={() => { p.alMover(1); }}>›</button>
          <span class="estado-busqueda" role="status" data-prueba="busqueda-estado">
            {p.n > 0 ? tp('M-1852', { i: p.indice + 1, n: p.n }) : p.consulta.trim().length >= MINIMO_BUSQUEDA ? tp('M-1853') : ''}
          </span>
        </div>
        <p id={`${id}-a`} class="ayuda">{t('M-72')}</p>
        {corta ? <p class="ayuda">{tp('M-1857')}</p> : null}
        {p.truncada ? <p class="ayuda">{tp('M-1858', { n: MAXIMO_COINCIDENCIAS })}</p> : null}
      </div>
    </div>
  );
}

type Salida = 'salir' | 'nuevo' | 'cambiar';
type Confirmacion = 'copiar' | 'descargar' | Salida | null;

// ---------------------------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------------------------

export function Reinsercion() {
  const shell = useShell();
  const tabla = useTabla();
  const e = useReinsercion();
  const [confirmar, setConfirmar] = useState<Confirmacion>(null);
  const [consulta, setConsulta] = useState('');
  const [indice, setIndice] = useState(0);
  const entradaBusqueda = useRef<HTMLInputElement | null>(null);
  const contenedorRespuesta = useRef<HTMLDivElement | null>(null);

  // Salir de la pantalla borra el texto con datos reales (6.6.5): también si cambia la pantalla por cualquier otro camino.
  useEffect(() => () => { vaciarReinsercion(); }, []);
  useEffect(() => registrarBusqueda(() => { entradaBusqueda.current?.focus(); entradaBusqueda.current?.select(); }), []);

  const asunto = shell.asunto;
  const resultado = e.resultado;
  const listo = resultado?.ready === true;
  // La búsqueda trabaja sobre el texto en memoria que se ve: el resultado si ya está listo; si no, la respuesta pegada.
  const textoBuscable = listo && resultado !== null ? resultado.text : canonico(e.respuesta);
  const { coincidencias, truncada } = useMemo(() => buscarEnTexto(textoBuscable, consulta), [textoBuscable, consulta]);
  const n = coincidencias.length;
  const actual = n === 0 ? -1 : Math.min(indice, n - 1);
  const marcas = useMemo<MarcaBusqueda[]>(() => (listo ? coincidencias.map((c, k) => ({ ...c, actual: k === actual })) : []), [listo, coincidencias, actual]);

  const reales = useMemo<Rango[]>(() => {
    if (!listo || resultado === null || tabla === null) return [];
    return tramosReales(entradaDe(e.canonica, tabla, origenDe(e.origen, tabla)), resultado) ?? [];
  }, [listo, resultado, tabla, e.canonica, e.origen]);

  if (asunto === null || !reinsercionDisponible(true, tabla)) {
    return (
      <div class="reinsercion">
        <h1 tabIndex={-1}>{t(X.reinsercion)}</h1>
        <p role="alert" data-prueba="reinsercion-no-disponible">{t(R.noDisponible)}</p>
        <div class="acciones"><button type="button" onClick={() => { ir('inicio'); }}>{t(R.irAInicio)}</button></div>
      </div>
    );
  }

  const mover = (delta: number): void => {
    if (n === 0) return;
    const siguiente = (((actual + delta) % n) + n) % n;
    setIndice(siguiente);
    const c = coincidencias[siguiente];
    const ta = contenedorRespuesta.current?.querySelector('textarea');
    if (!listo && c !== undefined && ta) {
      // Antes del resultado, la coincidencia se selecciona en la respuesta pegada y el foco vuelve al campo de búsqueda.
      ta.focus();
      ta.setSelectionRange(c.start, c.end);
      entradaBusqueda.current?.focus();
    }
  };

  const ejecutarSalida = (a: Salida): void => {
    setConfirmar(null);
    if (a === 'cambiar') { cerrarAsunto(); return; }
    if (a === 'nuevo') {
      descartarAnalisis();
      vaciarTodoElDocumento();
      actualizar({ phase: 'vacio' });
      ir('entrada');
      return;
    }
    ir('lista');
  };
  const salirPor = (a: Salida): void => {
    if (listo) setConfirmar(a); else ejecutarSalida(a);
  };

  const hayMarcadores = e.matches !== null && e.matches.length > 0;
  const pendientes = resultado === null || e.matches === null ? [] : pendientesDeDecision(e.matches, resultado.decisions);
  const faltaReconocer = resultado !== null && resultado.alerts.missing.length > 0 && !resultado.missingAcknowledged;
  const origenNulo = origenDe(e.origen, tabla) === null;

  return (
    <div class="reinsercion">
      <h1 tabIndex={-1}>{t(X.reinsercion)}</h1>

      <section class="paso" aria-label={t(X.asuntoChip, { codigo: asunto.codigo })}>
        <p data-prueba="asunto-reinsercion">{t('M-92', { codigo: asunto.codigo })}</p>
        <div class="acciones">
          <button type="button" class="secundario" onClick={() => { salirPor('cambiar'); }}>{t(ROTULOS.cambiar_de_asunto)}</button>
        </div>
      </section>

      <div class="paso">
        <Seleccion
          etiqueta={t(R.origen)}
          valor={e.origen}
          opciones={[['', t(ROTULOS.no_se_o_son_varios)], ...tabla.documents.map((d): readonly [string, string] => [d.docId, rotuloDeDocumento(d)])]}
          onCambio={(v) => { elegirOrigen(v, tabla); }}
        />
        {origenNulo ? <p class="ayuda" data-prueba="aviso-origen">{t('M-93')}</p> : null}
      </div>

      <div class="paso">
        <div ref={contenedorRespuesta} data-prueba="respuesta">
          <AreaTexto etiqueta={t(R.respuesta)} valor={e.respuesta} filas={8} onInput={(v) => { escribirRespuesta(v); setIndice(0); }} />
        </div>
        <div class="acciones">
          <button type="button" disabled={e.respuesta.trim() === ''} onClick={() => { buscarMarcadores(tabla); }}>{t(ROTULOS.buscar_marcadores)}</button>
        </div>
        {e.matches !== null && e.matches.length === 0 ? <p role="status" data-prueba="sin-marcadores">{t('M-94')}</p> : null}
      </div>

      <CampoBusqueda
        entrada={entradaBusqueda} consulta={consulta} n={n} indice={Math.max(actual, 0)} truncada={truncada}
        alEscribir={(v) => { setConsulta(v); setIndice(0); }} alMover={mover}
      />

      {resultado !== null && hayMarcadores ? <Alertas resultado={resultado} /> : null}

      {resultado !== null && !listo && hayMarcadores ? (
        <div role="status" class="motivos" data-prueba="faltan-decisiones">
          {pendientes.length > 0 ? <p>{t(R.faltanDecisiones, { n: pendientes.length })}</p> : null}
          {faltaReconocer ? <p>{t(R.faltaReconocer)}</p> : null}
        </div>
      ) : null}

      {listo && resultado !== null ? (
        <section class="resultado" aria-labelledby="h-real" data-prueba="resultado">
          <h2 id="h-real">{t(R.resultado)}</h2>
          <p class="aviso-real" data-prueba="aviso-datos-reales">{t('M-98')}</p>
          <p class="ayuda" data-prueba="aviso-genero">{t('M-123')}</p>
          <VistaReal texto={resultado.text} reales={reales} marcas={marcas} />
          <div class="acciones">
            <button type="button" data-prueba="copiar-real" onClick={() => { setConfirmar('copiar'); }}>{t(ROTULOS.copiar_texto_con_datos_reales)}</button>
            <button type="button" class="secundario" data-prueba="vaciar-real" disabled={!e.copiado} onClick={vaciarPortapapeles}>{t(ROTULOS.vaciar_portapapeles)}</button>
            <button type="button" class="secundario" data-prueba="descargar-real" onClick={() => { setConfirmar('descargar'); }}>{t(ROTULOS.descargar_txt)}</button>
          </div>
        </section>
      ) : null}

      {e.respaldo !== null ? <AreaRespaldo texto={e.respaldo} /> : null}
      <div class="avisos-reinsercion" role="region" aria-label={t(R.avisos)} data-prueba="avisos-reinsercion">
        {e.avisos.map((a) => <p key={a.id} role={a.rol} data-aviso={a.id}>{t(a.id, a.params)}</p>)}
      </div>

      <section class="paso" aria-label={t(R.salir)}>
        <div class="acciones">
          <button type="button" class="secundario" onClick={() => { salirPor('nuevo'); }}>{t(ROTULOS.nuevo_documento_del_asunto)}</button>
          <button type="button" class="secundario" onClick={() => { salirPor('salir'); }}>{t(R.salir)}</button>
        </div>
      </section>

      <Dialogo abierto={confirmar === 'copiar' || confirmar === 'descargar'} titulo={t(R.resultado)} onCerrar={() => { setConfirmar(null); }} rol="alertdialog">
        <p>{t('M-99')}</p>
        <div class="acciones">
          <button
            type="button"
            data-prueba="confirmar-datos-reales"
            onClick={() => {
              const a = confirmar;
              setConfirmar(null);
              if (a === 'copiar') copiarConDatosReales(); else if (a === 'descargar') descargarConDatosReales();
            }}
          >
            {t(ROTULOS.continuar_con_datos_reales)}
          </button>
          <button type="button" class="secundario" onClick={() => { setConfirmar(null); }}>{t(ROTULOS.cancelar)}</button>
        </div>
      </Dialogo>

      <Dialogo abierto={confirmar === 'salir' || confirmar === 'nuevo' || confirmar === 'cambiar'} titulo={t(R.tituloSalir)} onCerrar={() => { setConfirmar(null); }} rol="alertdialog">
        <p>{t('M-100')}</p>
        <div class="acciones">
          <button type="button" data-prueba="confirmar-salir" onClick={() => { if (confirmar === 'salir' || confirmar === 'nuevo' || confirmar === 'cambiar') ejecutarSalida(confirmar); }}>
            {t(ROTULOS.salir_y_borrar)}
          </button>
          <button type="button" class="secundario" onClick={() => { setConfirmar(null); }}>{t(ROTULOS.quedarme)}</button>
        </div>
      </Dialogo>
    </div>
  );
}
