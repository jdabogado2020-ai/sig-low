// Vista previa de la salida de Listo (8.2.7, 8.7): solo lectura, virtualizada por bloques de 50 líneas, con los marcadores como
// fichas cuyo nombre accesible es solo «Marcador {marcador}» (8.6.4). Con la puerta cerrada no se puede seleccionar ni copiar
// (`user-select: none`; `preventDefault` en `copy`, `cut` y `dragstart`, con M-73). Con la puerta abierta, Ctrl+C lo atiende un
// manejador propio: la selección se traduce a posiciones del texto único y se copia esa subcadena como `text/plain` (nunca
// `text/html`, nunca desde el DOM). `dragstart` está siempre bloqueado.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { RenderedOutput, ReviewState } from '../../core/types.ts';
import { atributosDeContenedor } from '../campos.tsx';
import { t } from '../mensajes.ts';
import { categoriaDe } from '../review/base/presentacion.ts';
import { copiarSeleccion } from './salida.ts';
import { L } from './textos.ts';
import { construirVista, subcadena, type BloqueVista, type Linea, type VistaSalida } from './vista-salida.ts';

const ALTO_LINEA_PX = 26;

/** Posición en el texto único de un punto de la selección. Una ficha cuenta como su marcador completo. */
function puntoG(panel: HTMLElement, vista: VistaSalida, nodo: Node, desp: number, inicio: boolean): number {
  const bloques = [...panel.querySelectorAll<HTMLElement>('[data-b]')];
  const r = document.createRange();
  for (let k = 0; k < bloques.length; k++) {
    const el = bloques[k] as HTMLElement;
    const b = vista.bloques[Number(el.dataset['b'])] as BloqueVista;
    r.selectNodeContents(el);
    const c = r.comparePoint(nodo, desp);
    if (c < 0) {
      if (inicio) return b.g0;
      const previo = k > 0 ? vista.bloques[Number((bloques[k - 1] as HTMLElement).dataset['b'])] : undefined;
      return previo === undefined ? 0 : previo.g1;
    }
    if (c === 0) return dentroDelBloque(el, b, nodo, desp, inicio, r);
  }
  return vista.texto.length;
}

function dentroDelBloque(bloque: HTMLElement, b: BloqueVista, nodo: Node, desp: number, inicio: boolean, r: Range): number {
  const trozos = [...bloque.querySelectorAll<HTMLElement>('[data-g]')];
  let finPrevio = b.g0;
  for (const el of trozos) {
    const g0 = Number(el.dataset['g']);
    const largo = Number(el.dataset['len']);
    r.selectNodeContents(el);
    const c = r.comparePoint(nodo, desp);
    if (c < 0) return inicio ? g0 : finPrevio;
    if (c === 0) {
      if (el.dataset['ficha'] !== undefined) return inicio ? g0 : g0 + largo;
      if (nodo.nodeType === Node.TEXT_NODE && el.contains(nodo)) return g0 + Math.min(desp, largo);
      return desp > 0 ? g0 + largo : g0;
    }
    finPrevio = g0 + largo;
  }
  return b.g1;
}

/** Texto de la selección actual traducido desde el modelo, o null si la selección no toca la vista. */
function textoSeleccionado(panel: HTMLElement, vista: VistaSalida): string | null {
  const sel = getSelection();
  if (sel === null || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if (!r.intersectsNode(panel)) return null;
  const a = puntoG(panel, vista, r.startContainer, r.startOffset, true);
  const b = puntoG(panel, vista, r.endContainer, r.endOffset, false);
  return subcadena(vista.texto, a, b);
}

function LineaSalida({ linea, state }: { linea: Linea; state: ReviewState }) {
  return (
    <div class="linea-salida">
      {linea.trozos.length === 0 ? <br /> : linea.trozos.map((z) => {
        if (z.reemplazo === undefined) return <span key={z.g} data-g={z.g} data-len={z.texto.length}>{z.texto}</span>;
        const d = z.reemplazo.det === undefined ? undefined : state.detections[z.reemplazo.det];
        const clase = `ficha-marcador ${d === undefined ? 'cat-neutra' : `cat-${categoriaDe(d.type)}`}`;
        // Solo un marcador exacto lleva nombre accesible; un texto editado o generalizado se lee como texto.
        return z.reemplazo.marcador
          ? <span key={z.g} class={clase} role="img" aria-label={`Marcador ${z.texto}`} data-g={z.g} data-len={z.texto.length} data-ficha="1">{z.texto}</span>
          : <span key={z.g} class={clase} data-g={z.g} data-len={z.texto.length} data-ficha="1">{z.texto}</span>;
      })}
    </div>
  );
}

export function VistaSalidaPanel({ out, state, abierta }: { out: RenderedOutput; state: ReviewState; abierta: boolean }) {
  const vista = useMemo(() => construirVista(out), [out]);
  const panel = useRef<HTMLDivElement | null>(null);
  const alturas = useRef(new Map<number, number>());
  const [montados, setMontados] = useState<ReadonlySet<number>>(() => new Set(vista.bloques.slice(0, 3).map((b) => b.indice)));
  const vistaRef = useRef(vista);
  vistaRef.current = vista;
  const abiertaRef = useRef(abierta);
  abiertaRef.current = abierta;

  // Virtualización: se montan los bloques visibles y los que están a ~1.000 px; los demás conservan su altura medida.
  useEffect(() => {
    const raiz = panel.current;
    if (raiz === null || typeof IntersectionObserver === 'undefined') {
      setMontados(new Set(vista.bloques.map((b) => b.indice)));
      return undefined;
    }
    const io = new IntersectionObserver((entradas) => {
      setMontados((previo) => {
        const siguiente = new Set(previo);
        for (const e of entradas) {
          const i = Number((e.target as HTMLElement).dataset['b']);
          if (e.isIntersecting) siguiente.add(i);
          else { alturas.current.set(i, (e.target as HTMLElement).offsetHeight); siguiente.delete(i); }
        }
        return siguiente;
      });
    }, { root: raiz, rootMargin: '1000px 0px' });
    for (const el of raiz.querySelectorAll('[data-b]')) io.observe(el);
    return () => { io.disconnect(); };
  }, [vista]);

  // Ctrl+C sobre la vista: manejador propio en captura, para que ninguna copia salga del DOM ni sin la puerta abierta (INV-X05).
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
      copiarSeleccion(e, toca ? textoSeleccionado(raiz, vistaRef.current) : null);
    };
    document.addEventListener('copy', alCopiar, true);
    return () => { document.removeEventListener('copy', alCopiar, true); };
  }, []);

  return (
    <div
      ref={(el) => { panel.current = el; atributosDeContenedor(el); }}
      class={`vista-salida${abierta ? '' : ' cerrada'}`}
      role="region"
      aria-label={t(L.regionSalida)}
      tabIndex={0}
      data-prueba="vista-salida"
      data-puerta={abierta ? 'abierta' : 'cerrada'}
      onCut={(e) => { e.preventDefault(); }}
      onDragStart={(e) => { e.preventDefault(); }}
    >
      {vista.bloques.map((b) => (
        <div
          key={b.indice}
          class="bloque-salida"
          data-b={b.indice}
          ref={(el) => {
            if (el === null) return;
            const alto = alturas.current.get(b.indice) ?? (b.l1 - b.l0) * ALTO_LINEA_PX;
            el.style.minHeight = montados.has(b.indice) ? '' : `${alto}px`;
          }}
        >
          {montados.has(b.indice)
            ? vista.lineas.slice(b.l0, b.l1).map((linea, i) => <LineaSalida key={b.l0 + i} linea={linea} state={state} />)
            : null}
        </div>
      ))}
    </div>
  );
}
