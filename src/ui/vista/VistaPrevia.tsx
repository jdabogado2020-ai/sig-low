// Pantalla 2 · Vista previa editable (F3, D-24): el documento ya anonimizado, con todo lo propuesto aplicado. Un .docx se muestra
// con sus párrafos, títulos, negritas y tablas; un PDF, como sus páginas con recuadros (o como texto); el texto pegado, como texto.
// Clic en una etiqueta → menú en lenguaje claro; seleccionar texto → «Ocultar este texto» u «Ocultar todas las apariciones»;
// «Puntos para revisar» con «Siguiente»; la búsqueda de datos que se escaparon corre sola. Nada de esto muestra un dato oculto: la
// vista es la salida de `render` (más el texto que el abogado decidió dejar a la vista), y los nombres accesibles solo dicen
// etiquetas y tipos.
import './vista.css';
import '../review/base/revision-base.css';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { render } from '../../core/render.ts';
import type { DetectionId, FlagId, PartId, Span, SpanEditId } from '../../core/types.ts';
import { originalDe } from '../../io/original.ts';
import { atributosDeContenedor } from '../campos.tsx';
import { Dialogo } from '../dialogo.tsx';
import { useRevision } from '../documento.ts';
import { actualizar, ir } from '../estado.ts';
import { useBusquedaAutomatica, buscarOtraVez } from '../flujo/busqueda-automatica.ts';
import { AvisoSinDetector } from '../flujo/Detector.tsx';
import { cerrarDocumento } from '../flujo/flujo.ts';
import { tf } from '../flujo/textos.ts';
import { useListo } from '../listo/almacen.ts';
import { copiarSeleccion } from '../listo/salida.ts';
import { etiqueta, mensajeDeCodigo, ROTULOS, t, X } from '../mensajes.ts';
import { solicitarReemplazo, useRevisionUi } from '../review/base/almacen.ts';
import { AgregarReemplazo } from '../review/base/AgregarReemplazo.tsx';
import { categoriaDe, nombreDeTipo } from '../review/base/presentacion.ts';
import { Banda } from '../review/pestanas/Banda.tsx';
import { estructuraDocx } from './estructura-docx.ts';
import { MenuEtiqueta, type Objetivo } from './MenuEtiqueta.tsx';
import { agrupar, construirVista, type Bloque, type Trozo, type Vista } from './modelo-vista.ts';
import { PaginasPdf } from './PaginasPdf.tsx';
import { puntosParaRevisar, type MotivoPunto } from './puntos.ts';

type Abrir = (o: Objetivo, el: HTMLElement) => void;

function claseDeEstilo(z: Trozo): string {
  const e = z.estilo;
  if (e === undefined) return '';
  return `${e.negrita ? ' negrita' : ''}${e.cursiva ? ' cursiva' : ''}${e.subrayado ? ' subrayado' : ''}`;
}

function TrozoVista({ z, abrir }: { z: Trozo; abrir: Abrir }) {
  const { state } = useRevisionUi();
  if (z.tipo === 'salto') return <br />;
  if (z.tipo === 'texto') return <span class={`txt${claseDeEstilo(z)}`} data-z="t" data-p={z.partId} data-i={z.ini}>{z.texto}</span>;
  if (z.tipo === 'etiqueta') {
    const d = z.det === undefined ? undefined : state?.detections[z.det];
    const objetivo: Objetivo | null = z.det !== undefined ? { tipo: 'det', id: z.det } : z.edicion !== undefined ? { tipo: 'edicion', id: z.edicion as SpanEditId } : null;
    const nombre = d !== undefined ? tf('M-2269', { etiqueta: state?.entities[d.entityId]?.marker ?? t(ROTULOS.sin_marcador), tipo: nombreDeTipo(d.type) }) : tf('M-2272');
    return (
      <button
        type="button"
        class={`etiqueta ${d === undefined ? 'cat-neutra' : `cat-${categoriaDe(d.type)}`}${d?.confidence === 'baja' ? ' baja' : ''}${claseDeEstilo(z)}`}
        data-z="e"
        data-det={z.det}
        data-edicion={z.edicion}
        aria-label={nombre}
        onClick={(e) => { if (objetivo !== null) abrir(objetivo, e.currentTarget); }}
      >
        {z.texto}
      </button>
    );
  }
  if (z.tipo === 'revelado' && z.det !== undefined) {
    const d = state?.detections[z.det];
    const det = z.det;
    return (
      <button type="button" class={`revelado${claseDeEstilo(z)}`} data-z="t" data-det={det} data-p={z.partId} data-i={z.ini}
        aria-label={tf('M-2270', { tipo: d === undefined ? '' : nombreDeTipo(d.type) })}
        onClick={(e) => { abrir({ tipo: 'det', id: det }, e.currentTarget); }}>
        {z.texto}
      </button>
    );
  }
  const flag = z.flag as FlagId;
  const f = state?.flags[flag];
  return (
    <button type="button" class={`revisar${claseDeEstilo(z)}`} data-z="t" data-flag={flag} data-p={z.partId} data-i={z.ini}
      aria-label={tf('M-2271', { tipo: f === undefined ? '' : etiqueta('bandera', f.reason) })}
      onClick={(e) => { abrir({ tipo: 'flag', id: flag }, e.currentTarget); }}>
      {z.texto}
    </button>
  );
}

function BloqueVista({ b, abrir }: { b: Bloque; abrir: Abrir }) {
  const clase = `bloque ${b.tipo}${b.alinear !== undefined ? ` alinear-${b.alinear}` : ''}`;
  return <p class={clase}>{b.trozos.length === 0 ? <br /> : b.trozos.map((z, i) => <TrozoVista key={`${z.ini}-${i}`} z={z} abrir={abrir} />)}</p>;
}

/** Selección dentro del texto → tramo de `Part.text` (los dos extremos en texto de la misma parte), sin blancos en los bordes. */
function tramoSeleccionado(raiz: HTMLElement, partes: ReadonlyMap<PartId, string>): Span | null {
  const sel = getSelection();
  if (sel === null || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if (!raiz.contains(r.startContainer) || !raiz.contains(r.endContainer)) return null;
  const punto = (nodo: Node, desp: number): { p: string; i: number } | null => {
    const el = (nodo.nodeType === Node.TEXT_NODE ? nodo.parentElement : nodo as Element)?.closest<HTMLElement>('[data-i]');
    if (el === null || el === undefined || el.dataset['p'] === undefined) return null;
    const base = Number(el.dataset['i']);
    return { p: el.dataset['p'], i: nodo.nodeType === Node.TEXT_NODE ? base + desp : base };
  };
  const a = punto(r.startContainer, r.startOffset);
  const b = punto(r.endContainer, r.endOffset);
  if (a === null || b === null || a.p !== b.p) return null;
  const texto = partes.get(a.p as PartId);
  if (texto === undefined) return null;
  let ini = Math.min(a.i, b.i);
  let fin = Math.max(a.i, b.i);
  while (ini < fin && /\s/u.test(texto.charAt(ini))) ini++;
  while (fin > ini && /\s/u.test(texto.charAt(fin - 1))) fin--;
  return fin > ini ? { partId: a.p as PartId, start: ini, end: fin } : null;
}

/**
 * A-30 y M-142 · El texto de la salida que cubre un rango: solo los trozos de la vista (`[data-z]`) que el rango toca, con los
 * extremos recortados en el texto que sigue a la vista y las etiquetas siempre enteras; un párrafo por línea. Nunca el texto de
 * la página (ayudas, botones) ni un dato oculto: es lo que pintó el modelo de la vista.
 */
export function textoDeSeleccion(raiz: HTMLElement, r: Range): string {
  const lineas: string[] = [];
  for (const bloque of raiz.querySelectorAll<HTMLElement>('p.bloque')) {
    if (!r.intersectsNode(bloque)) continue;
    let linea = '';
    for (const el of bloque.querySelectorAll<HTMLElement>('[data-z], br')) {
      if (!r.intersectsNode(el)) continue;
      if (el.tagName === 'BR') { linea += '\n'; continue; }
      let texto = el.textContent ?? '';
      if (el.dataset['z'] === 't') {
        let fin = texto.length;
        if (el.contains(r.endContainer) && r.endContainer.nodeType === Node.TEXT_NODE) fin = r.endOffset;
        let ini = 0;
        if (el.contains(r.startContainer) && r.startContainer.nodeType === Node.TEXT_NODE) ini = r.startOffset;
        texto = texto.slice(ini, Math.max(ini, fin));
      }
      linea += texto;
    }
    lineas.push(linea);
  }
  return lineas.join('\n');
}

function DocumentoVista({ vista, abrir, alSeleccionar }: { vista: Vista; abrir: Abrir; alSeleccionar: (s: Span | null, texto: string) => void }) {
  const { doc } = useRevisionUi();
  const raiz = useRef<HTMLDivElement | null>(null);
  const textos = useMemo(() => new Map((doc?.parts ?? []).map((p) => [p.id, p.text])), [doc]);
  const revisar = (): void => {
    const el = raiz.current;
    if (el === null) return;
    const tramo = tramoSeleccionado(el, textos);
    const sel = getSelection();
    // M-142: el diálogo muestra el texto de la salida (con las etiquetas), nunca el original de un dato ya oculto.
    alSeleccionar(tramo, tramo === null || sel === null || sel.rangeCount === 0 ? '' : textoDeSeleccion(el, sel.getRangeAt(0)).trim());
  };
  return (
    <div
      ref={(el) => { raiz.current = el; atributosDeContenedor(el); }}
      class="documento-vista"
      role="region"
      aria-label={tf('M-2268')}
      data-prueba="vista-previa"
      onMouseUp={revisar}
      onKeyUp={(e) => { if (e.shiftKey || e.key === 'Shift') revisar(); }}
    >
      {vista.secciones.map((s) => (
        <section key={s.partId} class={`seccion-doc parte-${s.kind}`} data-parte={s.partId}>
          {vista.conTitulos ? <p class="rotulo-parte">{s.etiqueta}</p> : null}
          {agrupar(s.bloques).map((g, i) => (g.tipo === 'bloque'
            ? <BloqueVista key={i} b={g.bloque} abrir={abrir} />
            : (
              <table key={i} class="tabla-doc">
                <tbody>
                  {g.filas.map((fila, f) => (
                    <tr key={f}>{fila.map((celda, c) => <td key={c}>{celda.map((b, k) => <BloqueVista key={k} b={b} abrir={abrir} />)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            )))}
        </section>
      ))}
    </div>
  );
}

const MOTIVO: Readonly<Record<MotivoPunto, 'M-2235' | 'M-2236' | 'M-2237' | 'M-2238'>> = {
  certeza: 'M-2235', ambigua: 'M-2236', bandera: 'M-2237', escapado: 'M-2238',
};

export function VistaPrevia() {
  const { doc, state } = useRevisionUi();
  useRevision();
  const listo = useListo();
  useBusquedaAutomatica(state, listo);
  const [objetivo, setObjetivo] = useState<Objetivo | null>(null);
  const [seleccion, setSeleccion] = useState<{ tramo: Span; texto: string } | null>(null);
  const [comoLeer, setComoLeer] = useState(false);
  const [paginas, setPaginas] = useState(true);
  const [descartar, setDescartar] = useState(false);
  const [punto, setPunto] = useState(-1);
  const [anuncio, setAnuncio] = useState('');
  const origen = useRef<HTMLElement | null>(null);
  const ancla = useRef<HTMLDivElement>(null);

  // A-30 (INV-X05): copiar o cortar con una selección que toque la vista previa (también Ctrl+A, o una que empiece fuera) lo atiende
  // siempre este manejador, en captura sobre el documento, como el panel de la v1.0: con la puerta cerrada no copia nada (M-73); con
  // la puerta abierta copia solo `text/plain` con el texto de la vista (nunca el de la página) y consolida, como «Copiar».
  useEffect(() => {
    const alCopiar = (e: ClipboardEvent): void => {
      const cuerpo = ancla.current;
      const sel = getSelection();
      if (cuerpo === null) return;
      const r = sel !== null && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0) : null;
      const toca = r !== null && r.intersectsNode(cuerpo);
      const dentro = cuerpo.contains(document.activeElement) || (e.target instanceof Node && cuerpo.contains(e.target));
      if (!toca && !dentro) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'cut') return;
      const documento = cuerpo.querySelector<HTMLElement>('.documento-vista');
      copiarSeleccion(e, documento === null || r === null || !toca ? null : textoDeSeleccion(documento, r));
    };
    // A-31 (F23-r2): arrastrar la selección (también tras Ctrl+A, desde el título o la ayuda) armaría un `dataTransfer` con la vista
    // previa en `text/plain` y `text/html`, y el menú contextual ofrecería «Copiar». Con la misma condición que la copia, no hay ni lo
    // uno ni lo otro, con la puerta abierta o cerrada: la vista previa solo sale por la puerta.
    const alArrastrarOMenu = (e: Event): void => {
      const cuerpo = ancla.current;
      const sel = getSelection();
      if (cuerpo === null) return;
      const r = sel !== null && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0) : null;
      const toca = r !== null && r.intersectsNode(cuerpo);
      const dentro = e.target instanceof Node && cuerpo.contains(e.target);
      if (toca || dentro) e.preventDefault();
    };
    document.addEventListener('copy', alCopiar, true);
    document.addEventListener('cut', alCopiar, true);
    document.addEventListener('dragstart', alArrastrarOMenu, true);
    document.addEventListener('contextmenu', alArrastrarOMenu, true);
    return () => {
      document.removeEventListener('copy', alCopiar, true);
      document.removeEventListener('cut', alCopiar, true);
      document.removeEventListener('dragstart', alArrastrarOMenu, true);
      document.removeEventListener('contextmenu', alArrastrarOMenu, true);
    };
  }, []);

  const original = doc === null ? null : originalDe(doc.id);
  const estructuras = useMemo(() => (doc !== null && original !== null && doc.source === 'docx' ? estructuraDocx(original.bytes, doc) : undefined), [doc, original]);
  const out = useMemo(() => (doc !== null && state !== null ? render(doc, state) : null), [doc, state]);
  const vista = useMemo(() => (out !== null && state !== null && doc !== null ? construirVista(out, state, doc.parts, estructuras) : null), [out, state, doc, estructuras]);
  const escapadas = useMemo(() => new Set(listo.docIdHallazgos === state?.docId ? listo.hallazgos.flatMap((h) => h.detectionId ?? []) : []), [listo.hallazgos, listo.docIdHallazgos, state?.docId]);
  const puntos = useMemo(() => (state === null ? [] : puntosParaRevisar(state, escapadas)), [state, escapadas]);

  if (doc === null || state === null || out === null || vista === null) {
    return (
      <>
        <h1 tabIndex={-1}>{t(X.revision)}</h1>
        <p class="ayuda" data-prueba="sin-revision">{t('M-69')}</p>
        <div class="acciones"><button type="button" onClick={() => { ir('inicio'); }}>{t(X.inicio)}</button></div>
      </>
    );
  }

  const abrir: Abrir = (o, el) => { origen.current = el; setSeleccion(null); setObjetivo(o); };
  const cerrarMenu = (): void => {
    setObjetivo(null);
    const el = origen.current;
    // El elemento puede haberse vuelto a pintar (la etiqueta cambió): se busca el mismo dato en la vista.
    if (el !== null && el.isConnected) el.focus();
  };
  const siguiente = (): void => {
    if (puntos.length === 0) return;
    const i = (punto + 1) % puntos.length;
    setPunto(i);
    const p = puntos[i];
    if (p === undefined) return;
    const sel = p.det !== undefined ? `[data-det="${p.det}"]` : `[data-flag="${p.flag ?? ''}"]`;
    const el = document.querySelector<HTMLElement>(`.vista-previa-cuerpo ${sel}`);
    el?.scrollIntoView({ block: 'center' });
    el?.focus();
    const f = p.flag === undefined ? undefined : state.flags[p.flag];
    setAnuncio(tf('M-2234', { i: i + 1, n: puntos.length, motivo: tf(MOTIVO[p.motivo], { tipo: f === undefined ? '' : etiqueta('bandera', f.reason) }) }));
  };
  const enPaginas = doc.source === 'pdf' && original !== null && paginas;
  const residuo = listo.residuo;
  const pasa = residuo !== null && residuo.revision === state.revision && residuo.hits.length === 0 && residuo.newDetections === 0;

  return (
    <div class="vista-previa">
      <h1 tabIndex={-1}>{t(X.revision)}</h1>
      <p class="ayuda">{tf('M-2230')}</p>
      <Banda />
      {/* F8 (v1.1.1): analizado sin el detector de nombres → aviso breve, sin bloquear, con la descarga y el reanálisis. */}
      {state.modelo.kind === 'plan_b' ? <AvisoSinDetector /> : null}
      <div class="puntos" data-prueba="puntos">
        <p>{puntos.length === 0 ? tf('M-2233') : tf('M-2231', { n: puntos.length })}</p>
        {puntos.length > 0 ? <button type="button" class="secundario" data-prueba="siguiente-punto" onClick={siguiente}>{tf('M-2232')}</button> : null}
        <p class="solo-lectores" role="status" data-prueba="anuncio-punto">{anuncio}</p>
      </div>
      <div class="estado-busqueda" role="status" data-prueba="residuos-estado" aria-busy={listo.buscando}>
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
      {(estructuras?.imagenes ?? 0) > 0 ? <p class="ayuda" role="note" data-prueba="imagenes-docx">{tf('M-2299', { n: estructuras?.imagenes ?? 0 })}</p> : null}
      <div class="barra-vista" role="toolbar" aria-label={tf('M-2268')}>
        <button type="button" class="secundario" aria-expanded={comoLeer} aria-controls="como-leer" onClick={() => { setComoLeer(!comoLeer); }}>{t(ROTULOS.leyenda)}</button>
        {doc.source === 'pdf' && original !== null ? (
          <button type="button" class="secundario" aria-pressed={!paginas} onClick={() => { setPaginas(!paginas); setObjetivo(null); }}>
            {paginas ? tf('M-2277') : tf('M-2276')}
          </button>
        ) : null}
      </div>
      <section id="como-leer" class="como-leer" hidden={!comoLeer} aria-label={t(ROTULOS.leyenda)} data-prueba="como-leer">
        <ul>
          <li>{tf('M-2239')}</li>
          <li>{tf('M-2240')}</li>
          <li>{tf('M-2241')}</li>
          <li>{tf('M-2242')}</li>
          <li>{tf('M-2243')}</li>
          {doc.source === 'pdf' ? <li>{tf('M-2244')}</li> : null}
        </ul>
      </section>
      {/* A-30: ni menú contextual («Copiar imagen», «Guardar imagen como» en los lienzos del PDF) ni arrastre. */}
      <div class="vista-previa-cuerpo" ref={ancla} onContextMenu={(e) => { e.preventDefault(); }} onDragStart={(e) => { e.preventDefault(); }}>
        {enPaginas
          ? <PaginasPdf doc={doc} out={out} onAbrir={(id: DetectionId, el) => { abrir({ tipo: 'det', id }, el); }} />
          : <DocumentoVista vista={vista} abrir={abrir} alSeleccionar={(s, texto) => { setSeleccion(s === null ? null : { tramo: s, texto }); if (s !== null) setObjetivo(null); }} />}
        {seleccion !== null ? (
          <div class="menu-seleccion" role="group" aria-label={tf('M-2273')} data-prueba="menu-seleccion">
            <button type="button" onClick={() => { solicitarReemplazo(seleccion.tramo, false, seleccion.texto); setSeleccion(null); }}>{tf('M-2266')}</button>
            <button type="button" class="secundario" onClick={() => { solicitarReemplazo(seleccion.tramo, true, seleccion.texto); setSeleccion(null); }}>{tf('M-2267')}</button>
          </div>
        ) : null}
        {objetivo !== null ? <MenuEtiqueta objetivo={objetivo} onCerrar={cerrarMenu} /> : null}
      </div>
      <div class="acciones">
        <button type="button" data-prueba="continuar" onClick={() => { actualizar({ phase: 'listo' }); ir('listo'); }}>{tf('M-2280')}</button>
        <button type="button" class="secundario" onClick={() => { ir('detalle'); }}>{tf('M-2281')}</button>
        <button type="button" class="secundario" onClick={() => { setDescartar(true); }}>{t(ROTULOS.descartar_documento)}</button>
      </div>
      <AgregarReemplazo />
      <Dialogo abierto={descartar} titulo={t(ROTULOS.descartar_documento)} onCerrar={() => { setDescartar(false); }}>
        <p>{t('M-75')}</p>
        <div class="acciones">
          <button type="button" onClick={() => { setDescartar(false); cerrarDocumento(); }}>{t(ROTULOS.descartar_documento)}</button>
          <button type="button" class="secundario" onClick={() => { setDescartar(false); }}>{t(ROTULOS.cancelar)}</button>
        </div>
      </Dialogo>
    </div>
  );
}
