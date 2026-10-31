// Panel de texto de la Revisión I (8.2.6, 8.4, 8.6.5, 8.7, 8.8): texto canónico por partes con resaltados por tipo (color y
// abreviatura) y por confianza (borde). Siempre por bloques de 50 líneas: se montan los visibles y uno arriba y otro abajo;
// la altura estimada se corrige con ResizeObserver y las posiciones se fijan con CSSOM (sin atributos `style`).
// El texto va siempre como nodo de texto (JSX). La copia sale del modelo (Part.text), nunca del DOM (8.7).
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { render as renderSalida } from '../../../core/render.ts';
import type { Detection, DetectionId, Entity, ReviewState, Span } from '../../../core/types.ts';
import { atributosDeContenedor } from '../../campos.tsx';
import { t } from '../../mensajes.ts';
import { aceptar, aceptarEntidad, restablecer, rechazar } from './acciones.ts';
import {
  consumirEnfoque, irAPendiente, pedirEnfoque, seleccionar, solicitarEdicion, solicitarReemplazo, useRevisionUi,
} from './almacen.ts';
import { Insignia } from './iconos.tsx';
import {
  abreviaturaDe, bloquesDeTexto, categoriaDe, elementosDeParte, nombreDeBandera, nombreDeResaltado, ordenDeLectura, partesIncluidas,
  type Elemento, type RangoDeBloque,
} from './presentacion.ts';
import { tx } from './textos.ts';

interface Fila {
  clave: string;
  fuente: number;
  titulo: boolean;
  inicio: number;
  fin: number;
  lineas: number;
}
interface Fuente {
  partId: string;
  etiqueta: string;
  texto: string;
  elementos: readonly { start: number; end: number }[];
  bloques: readonly RangoDeBloque[];
}

const MARCADOR = /^\[[A-ZÁÉÍÓÚÑ_]+_\d+\]$/u;
const MARGEN_FILAS = 1;

function Medido({ clave, alAlto, children }: { clave: string; alAlto: (k: string, h: number) => void; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const ro = new ResizeObserver(() => { alAlto(clave, el.offsetHeight); });
    ro.observe(el);
    alAlto(clave, el.offsetHeight);
    return () => { ro.disconnect(); };
  }, [clave]);
  return <div ref={ref} class="medido">{children}</div>;
}

/** Posición en `Part.text` de un punto de la selección, o null si cae fuera del texto del documento. */
function posicionDe(nodo: Node, desplazamiento: number): { partId: string; pos: number } | null {
  const de = (run: HTMLElement, pos: number): { partId: string; pos: number } | null => {
    const bloque = run.closest<HTMLElement>('[data-p]');
    return bloque === null ? null : { partId: bloque.dataset['p'] ?? '', pos };
  };
  if (nodo.nodeType === Node.TEXT_NODE) {
    const run = nodo.parentElement?.closest<HTMLElement>('[data-o]') ?? null;
    return run === null ? null : de(run, Number(run.dataset['o']) + Math.min(desplazamiento, (run.textContent ?? '').length));
  }
  const el = nodo as Element;
  const propio = el.closest<HTMLElement>('[data-o]');
  if (propio !== null) return de(propio, Number(propio.dataset['o']) + (desplazamiento > 0 ? (propio.textContent ?? '').length : 0));
  const runs = el.querySelectorAll<HTMLElement>('[data-o]');
  if (runs.length === 0) return null;
  const hijo = el.childNodes[desplazamiento];
  if (hijo === undefined) {
    const ultimo = runs[runs.length - 1] as HTMLElement;
    return de(ultimo, Number(ultimo.dataset['o']) + (ultimo.textContent ?? '').length);
  }
  const primero = hijo instanceof Element ? (hijo.matches('[data-o]') ? hijo as HTMLElement : hijo.querySelector<HTMLElement>('[data-o]')) : null;
  const run = primero ?? runs[0] as HTMLElement;
  return de(run, Number(run.dataset['o']));
}

/** Rango de la selección actual dentro del panel, en posiciones de una sola parte; null si cruza partes o no hay selección. */
export function seleccionDelPanel(panel: HTMLElement): Span | null {
  const sel = getSelection();
  if (sel === null || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if (!panel.contains(r.startContainer) || !panel.contains(r.endContainer)) return null;
  const a = posicionDe(r.startContainer, r.startOffset);
  const b = posicionDe(r.endContainer, r.endOffset);
  if (a === null || b === null || a.partId !== b.partId || b.pos <= a.pos) return null;
  return { partId: a.partId as Span['partId'], start: a.pos, end: b.pos };
}

export function PanelTexto({ singleKey }: { singleKey: boolean }) {
  const rev = useRevisionUi();
  const { doc, state, vista, seleccion, nuevas, enfoque } = rev;
  const panel = useRef<HTMLDivElement | null>(null);
  const arriba = useRef<HTMLDivElement>(null);
  const abajo = useRef<HTMLDivElement>(null);
  const alturas = useRef(new Map<string, number>());
  const [, bump] = useState(0);
  const pendienteBump = useRef(false);
  const [pos, setPos] = useState({ st: 0, vh: 600, ancho: 700, lh: 24 });
  const [activoLocal, setActivoLocal] = useState<DetectionId | null>(null);
  const [flotante, setFlotante] = useState<{ span: Span; arriba: number; izq: number } | null>(null);
  const flotanteRef = useRef<HTMLButtonElement>(null);
  const intentos = useRef(0);

  const salida = useMemo(() => (doc !== null && state !== null && vista === 'salida' ? renderSalida(doc, state) : null),
    [doc, state, vista]);

  const conSugerencia = useMemo(() => {
    const s = new Set<string>();
    if (state !== null) for (const x of Object.values(state.suggestions)) if (x.target.kind === 'deteccion' && x.status !== 'descartada') s.add(x.target.detectionId);
    return s;
  }, [state]);

  const fuentes = useMemo<Fuente[]>(() => {
    if (doc === null || state === null) return [];
    if (vista === 'salida' && salida !== null) {
      return salida.sections.map((sec) => {
        const elementos = sec.segments.filter((x) => x.detectionId !== undefined || x.spanEditId !== undefined).map((x) => ({ start: x.outStart, end: x.outEnd }));
        return { partId: sec.partId, etiqueta: sec.label, texto: sec.text, elementos, bloques: bloquesDeTexto(sec.text, elementos) };
      });
    }
    return partesIncluidas(doc).map((p) => {
      const elementos = elementosDeParte(state, p.id);
      return { partId: p.id, etiqueta: p.label, texto: p.text, elementos, bloques: bloquesDeTexto(p.text, elementos) };
    });
  }, [doc, state, vista, salida]);

  const filas = useMemo<Fila[]>(() => {
    const f: Fila[] = [];
    fuentes.forEach((fu, i) => {
      f.push({ clave: `${vista}:${fu.partId}:t`, fuente: i, titulo: true, inicio: 0, fin: 0, lineas: 1 });
      fu.bloques.forEach((b, j) => { f.push({ clave: `${vista}:${fu.partId}:${j}`, fuente: i, titulo: false, inicio: b.inicio, fin: b.fin, lineas: b.lineas }); });
    });
    return f;
  }, [fuentes, vista]);

  const cpl = Math.max(20, Math.floor(pos.ancho / 8.8));
  const estimar = (fila: Fila): number => {
    if (fila.titulo) return pos.lh * 2.4;
    return Math.max(fila.lineas, Math.ceil((fila.fin - fila.inicio) / cpl)) * pos.lh;
  };
  const alto = (fila: Fila): number => alturas.current.get(fila.clave) ?? estimar(fila);
  const desplazamientos: number[] = [];
  let acumulado = 0;
  for (const f of filas) { desplazamientos.push(acumulado); acumulado += alto(f); }
  const total = acumulado;

  // Filas montadas: las visibles más una arriba y otra abajo (8.8).
  let primera = filas.findIndex((f, i) => (desplazamientos[i] as number) + alto(f) > pos.st);
  if (primera < 0) primera = Math.max(0, filas.length - 1);
  let ultima = primera;
  while (ultima + 1 < filas.length && (desplazamientos[ultima + 1] as number) < pos.st + pos.vh) ultima++;
  const desde = Math.max(0, primera - MARGEN_FILAS);
  const hasta = Math.min(filas.length - 1, ultima + MARGEN_FILAS);

  const alAlto = useRef((k: string, h: number): void => {
    const previo = alturas.current.get(k);
    if (previo !== undefined && Math.abs(previo - h) < 2) return;
    alturas.current.set(k, h);
    if (pendienteBump.current) return;
    pendienteBump.current = true;
    requestAnimationFrame(() => { pendienteBump.current = false; bump((n) => n + 1); });
  }).current;

  // Alturas de relleno (CSSOM) y medidas del contenedor.
  useLayoutEffect(() => {
    arriba.current?.style.setProperty('block-size', `${desde < filas.length ? (desplazamientos[desde] ?? 0) : 0}px`);
    const finMontado = hasta >= 0 && hasta < filas.length ? (desplazamientos[hasta] as number) + alto(filas[hasta] as Fila) : 0;
    abajo.current?.style.setProperty('block-size', `${Math.max(0, total - finMontado)}px`);
  });
  useEffect(() => {
    const el = panel.current;
    if (el === null) return;
    const medir = (): void => {
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      setPos((p) => (p.vh === el.clientHeight && p.ancho === el.clientWidth && p.lh === (Number.isFinite(lh) ? lh : 24) ? p
        : { ...p, vh: el.clientHeight, ancho: el.clientWidth, lh: Number.isFinite(lh) ? lh : 24 }));
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, []);
  const rafScroll = useRef(0);
  const alDesplazar = (): void => {
    if (rafScroll.current !== 0) return;
    rafScroll.current = requestAnimationFrame(() => {
      rafScroll.current = 0;
      const el = panel.current;
      if (el !== null) setPos((p) => (Math.abs(p.st - el.scrollTop) < 1 ? p : { ...p, st: el.scrollTop }));
    });
  };

  // Navegación a lo no montado (8.8): calcula la fila, desplaza, monta y enfoca.
  useLayoutEffect(() => {
    if (enfoque === null || enfoque.tipo !== 'resaltado' || state === null) return;
    const el = panel.current?.querySelector<HTMLElement>(`[data-det="${enfoque.id}"]`) ?? null;
    if (el !== null) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest' });
      setActivoLocal(enfoque.id as DetectionId);
      consumirEnfoque(enfoque.n);
      intentos.current = 0;
      return;
    }
    const d = state.detections[enfoque.id as DetectionId];
    if (d === undefined || panel.current === null || intentos.current > 3) { consumirEnfoque(enfoque.n); intentos.current = 0; return; }
    const idx = filas.findIndex((f) => !f.titulo && fuentes[f.fuente]?.partId === d.partId && d.start >= f.inicio && d.start < Math.max(f.fin, f.inicio + 1));
    if (idx < 0) { consumirEnfoque(enfoque.n); return; }
    intentos.current++;
    const destino = Math.max(0, (desplazamientos[idx] as number) - 8);
    panel.current.scrollTop = destino;
    setPos((p) => ({ ...p, st: destino }));
  });

  // Selección con el ratón → botón flotante «Agregar reemplazo» (solo en el original).
  const actualizarSeleccion = (): void => {
    if (vista !== 'original' || panel.current === null) { setFlotante(null); return; }
    const span = seleccionDelPanel(panel.current);
    if (span === null) { setFlotante(null); return; }
    const sel = getSelection();
    const r = sel?.getRangeAt(0).getBoundingClientRect();
    const caja = panel.current.getBoundingClientRect();
    if (r === undefined) { setFlotante(null); return; }
    setFlotante({ span, arriba: Math.max(0, r.bottom - caja.top + panel.current.scrollTop + 4), izq: Math.max(0, r.left - caja.left) });
  };
  useLayoutEffect(() => {
    if (flotante === null || flotanteRef.current === null) return;
    flotanteRef.current.style.setProperty('top', `${flotante.arriba}px`);
    flotanteRef.current.style.setProperty('left', `${flotante.izq}px`);
  }, [flotante]);

  if (doc === null || state === null) return null;

  const orden = ordenDeLectura(state);
  const activo: DetectionId | null = activoLocal !== null && state.detections[activoLocal] !== undefined ? activoLocal
    : seleccion !== null && state.detections[seleccion] !== undefined ? seleccion : (orden[0] ?? null);

  const alTeclear = (e: KeyboardEvent): void => {
    const objetivo = e.target instanceof Element ? e.target : null;
    if (objetivo === null || e.ctrlKey || e.metaKey || e.altKey) return;
    const resaltado = objetivo.closest<HTMLElement>('[data-det]');
    const id = (resaltado?.dataset['det'] ?? null) as DetectionId | null;
    const enPanel = objetivo === panel.current;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (!resaltado && !enPanel) return;
      if (orden.length === 0) return;
      const i = id === null ? -1 : orden.indexOf(id);
      const j = e.key === 'ArrowRight' ? Math.min(orden.length - 1, i + 1) : Math.max(0, (i < 0 ? orden.length : i) - 1);
      e.preventDefault();
      pedirEnfoque('resaltado', orden[j] as string);
      return;
    }
    if (!singleKey || id === null || e.shiftKey && e.key.toLowerCase() !== 'a' && e.key.toLowerCase() !== 'n') return;
    const d = state.detections[id];
    if (d === undefined) return;
    const k = e.key.toLowerCase();
    if (k === 'a') { e.preventDefault(); if (e.shiftKey) aceptarEntidad(d.entityId); else aceptar(id); }
    else if (k === 'r') { e.preventDefault(); rechazar(id); }
    else if (k === 'u') { e.preventDefault(); restablecer(id); }
    else if (k === 'e') { e.preventDefault(); solicitarEdicion(id); }
    else if (k === 'n') { e.preventDefault(); irAPendiente(e.shiftKey ? -1 : 1); }
  };

  const alCopiar = (e: ClipboardEvent): void => {
    e.preventDefault();
    if (vista !== 'original' || panel.current === null) return;
    const sel = getSelection();
    if (sel === null || sel.rangeCount === 0 || sel.isCollapsed) return;
    const r = sel.getRangeAt(0);
    const a = posicionDe(r.startContainer, r.startOffset);
    const b = posicionDe(r.endContainer, r.endOffset);
    if (a === null || b === null) return;
    const partes = partesIncluidas(doc);
    const ia = partes.findIndex((p) => p.id === a.partId);
    const ib = partes.findIndex((p) => p.id === b.partId);
    if (ia < 0 || ib < 0) return;
    const trozos: string[] = [];
    if (ia === ib) trozos.push((partes[ia]?.text ?? '').slice(a.pos, b.pos));
    else if (ia < ib) {
      trozos.push((partes[ia]?.text ?? '').slice(a.pos));
      for (let k = ia + 1; k < ib; k++) trozos.push(partes[k]?.text ?? '');
      trozos.push((partes[ib]?.text ?? '').slice(0, b.pos));
    }
    // Solo `text/plain`, desde el modelo: el navegador nunca genera `text/html` (8.7).
    e.clipboardData?.setData('text/plain', trozos.join('\n'));
  };

  const montadas = filas.slice(desde, hasta + 1);
  return (
    <div class="panel-texto-envoltura">
      <div
        ref={(el) => { panel.current = el; atributosDeContenedor(el); }}
        class={`panel-texto${vista === 'salida' ? ' solo-lectura' : ''}`}
        role="region"
        aria-label={vista === 'salida' ? tx('M-1306') : tx('M-1301')}
        tabIndex={0}
        data-prueba="panel-texto"
        onScroll={alDesplazar}
        onKeyDown={alTeclear}
        onCopy={alCopiar}
        onCut={(e) => { e.preventDefault(); }}
        onDragStart={(e) => { e.preventDefault(); }}
        onMouseUp={() => { setTimeout(actualizarSeleccion, 0); }}
        onKeyUp={(e) => { if (e.shiftKey) setTimeout(actualizarSeleccion, 0); }}
        onClick={(e) => {
          const b = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-det]') : null;
          if (b !== null) { seleccionar((b.dataset['det'] ?? null) as DetectionId | null); setActivoLocal((b.dataset['det'] ?? null) as DetectionId | null); }
        }}
        onFocusIn={(e) => {
          const b = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-det]') : null;
          if (b !== null) setActivoLocal((b.dataset['det'] ?? null) as DetectionId | null);
        }}
      >
        <div ref={arriba} class="relleno" />
        {montadas.map((f) => {
          const fu = fuentes[f.fuente] as Fuente;
          if (f.titulo) {
            return (
              <Medido key={f.clave} clave={f.clave} alAlto={alAlto}>
                <h3 class="titulo-parte">{fu.etiqueta}</h3>
              </Medido>
            );
          }
          return (
            <Medido key={f.clave} clave={f.clave} alAlto={alAlto}>
              <div class="bloque-texto" data-p={fu.partId}>
                {vista === 'original'
                  ? contenidoOriginal(fu, f, state, activo, nuevas, conSugerencia, seleccion)
                  : contenidoSalida(fu, f, state, salida?.sections.find((s) => s.partId === fu.partId)?.segments ?? [])}
              </div>
            </Medido>
          );
        })}
        <div ref={abajo} class="relleno" />
        {flotante !== null ? (
          <button
            ref={flotanteRef}
            type="button"
            class="flotante"
            onClick={() => { solicitarReemplazo(flotante.span); setFlotante(null); }}
          >
            {t('M-971')}
          </button>
        ) : null}
      </div>
      {vista === 'salida' ? <p class="ayuda" data-prueba="aviso-salida">{tx('M-1308')} {t('M-73')}</p> : null}
    </div>
  );
}

function contenidoOriginal(fu: Fuente, f: Fila, state: ReviewState, activo: DetectionId | null, nuevas: ReadonlySet<DetectionId>, conSugerencia: ReadonlySet<string>, seleccion: DetectionId | null) {
  const elementos = fu.elementos as readonly Elemento[];
  const nodos: ComponentChildren[] = [];
  let cursor = f.inicio;
  for (const el of elementos) {
    if (el.start < f.inicio || el.start >= f.fin) continue;
    if (el.start > cursor) nodos.push(<span key={`t${cursor}`} data-o={cursor}>{fu.texto.slice(cursor, el.start)}</span>);
    nodos.push(resaltado(el, fu, state, activo, nuevas, conSugerencia, seleccion));
    cursor = el.end;
  }
  if (cursor < f.fin) nodos.push(<span key={`t${cursor}`} data-o={cursor}>{fu.texto.slice(cursor, f.fin)}</span>);
  return nodos;
}

function resaltado(el: Elemento, fu: Fuente, state: ReviewState, activo: DetectionId | null, nuevas: ReadonlySet<DetectionId>, conSugerencia: ReadonlySet<string>, seleccion: DetectionId | null) {
  if (el.clase === 'det') {
    const d: Detection = el.det;
    const entidad: Entity | undefined = state.entities[d.entityId];
    return (
      <button
        key={d.id}
        type="button"
        class={`res cat-${categoriaDe(d.type)} conf-${d.confidence} est-${d.status}`}
        data-det={d.id}
        tabIndex={activo === d.id ? 0 : -1}
        aria-label={nombreDeResaltado(d, entidad)}
        aria-current={seleccion === d.id ? 'true' : undefined}
      >
        <Insignia abreviatura={abreviaturaDe(d.type)} estado={d.status} sugerencia={conSugerencia.has(d.id)} nueva={nuevas.has(d.id)} />
        <span data-o={d.start}>{fu.texto.slice(d.start, d.end)}</span>
      </button>
    );
  }
  if (el.clase === 'ban') {
    const f = el.flag;
    return (
      <button
        key={f.id}
        type="button"
        class={`res cat-ban bandera ${f.acknowledged ? 'confirmada' : 'sin-confirmar'}`}
        data-ban={f.id}
        tabIndex={-1}
        aria-label={nombreDeBandera(f)}
      >
        <Insignia abreviatura={abreviaturaDe(f.type)} bandera confirmada={f.acknowledged} />
        <span data-o={f.span.start}>{fu.texto.slice(f.span.start, f.span.end)}</span>
      </button>
    );
  }
  return (
    <span key={el.edit.id} class="res edicion" role="note" aria-label={tx('M-1336', { texto: el.edit.text })}>
      <span class="ins" aria-hidden="true"><span class="abr">≈ TXT</span></span>
      <span data-o={el.start}>{fu.texto.slice(el.start, el.end)}</span>
    </span>
  );
}

function contenidoSalida(fu: Fuente, f: Fila, state: ReviewState, segmentos: readonly { outStart: number; outEnd: number; detectionId?: DetectionId; spanEditId?: string }[]) {
  const nodos: ComponentChildren[] = [];
  let cursor = f.inicio;
  for (const s of segmentos) {
    if (s.detectionId === undefined && s.spanEditId === undefined) continue;
    if (s.outStart < f.inicio || s.outStart >= f.fin) continue;
    if (s.outStart > cursor) nodos.push(<span key={`t${cursor}`}>{fu.texto.slice(cursor, s.outStart)}</span>);
    const texto = fu.texto.slice(s.outStart, s.outEnd);
    const d = s.detectionId !== undefined ? state.detections[s.detectionId] : undefined;
    const clase = d !== undefined ? `cat-${categoriaDe(d.type)}` : 'cat-neutra';
    // Solo el marcador va en el nombre accesible; un texto editado o generalizado se lee como texto (8.6.4).
    nodos.push(
      MARCADOR.test(texto)
        ? <span key={`m${s.outStart}`} class={`ficha-marcador ${clase}`} aria-label={tx('M-1335', { marcador: texto })} role="img">{texto}</span>
        : <span key={`m${s.outStart}`} class={`ficha-marcador ${clase}`}>{texto}</span>,
    );
    cursor = s.outEnd;
  }
  if (cursor < f.fin) nodos.push(<span key={`t${cursor}`}>{fu.texto.slice(cursor, f.fin)}</span>);
  return nodos;
}
