// F3 (D-24) · Vista previa de un PDF tal como saldrá: cada página dibujada por F4 (`tacharPaginas`) con sus recuadros negros, en un
// lienzo visible, y encima un botón transparente por recuadro que abre el menú de su etiqueta. Los lienzos solo tienen la página ya
// tachada; se vacían al salir de la vista, al cambiar el estado y en el bloqueo (V-57). Corre en el hilo principal (necesita lienzo).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { DetectionId, DocumentModel, RenderedOutput } from '../../core/types.ts';
import { originalDe } from '../../io/original.ts';
import { tacharPaginas, type ZonaTachada } from '../../io/pdf-tachar.ts';
import { lineasDeAdvertencias } from '../Entrada.tsx';
import { mensajeDeCodigo, t } from '../mensajes.ts';
import { registrarLimpieza } from '../sesion.ts';
import { codigoDeError } from '../servicios.ts';
import { tf } from '../flujo/textos.ts';

interface PaginaVista { n: number; total: number; lienzo: HTMLCanvasElement; zonas: ZonaTachada[] }

/** Escala de la vista previa (píxeles por punto): nítida en pantalla sin el costo de la descarga (2). */
const ESCALA_VISTA = 1.25;

const vivos = new Set<HTMLCanvasElement>();
const vaciar = (c: HTMLCanvasElement): void => { c.width = 0; c.height = 0; vivos.delete(c); };
registrarLimpieza(() => { for (const c of [...vivos]) vaciar(c); });

function Lienzo({ c }: { c: HTMLCanvasElement }) {
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = caja.current;
    if (el === null) return undefined;
    el.appendChild(c);
    return () => { if (c.parentNode === el) el.removeChild(c); };
  }, [c]);
  return <div class="lienzo-pdf" ref={caja} />;
}

function Zona({ z, ancho, alto, onAbrir }: { z: ZonaTachada; ancho: number; alto: number; onAbrir: (id: DetectionId, el: HTMLElement) => void }) {
  if (z.det === undefined) return null;
  const det = z.det;
  return (
    <button
      type="button"
      class="zona-pdf"
      data-det={det}
      aria-label={tf('M-2272')}
      ref={(el) => {
        if (el === null) return;
        el.style.left = `${(z.x / ancho) * 100}%`;
        el.style.top = `${(z.y / alto) * 100}%`;
        el.style.width = `${(z.w / ancho) * 100}%`;
        el.style.height = `${(z.h / alto) * 100}%`;
      }}
      onClick={(e) => { onAbrir(det, e.currentTarget); }}
    />
  );
}

export function PaginasPdf({ doc, out, onAbrir }: { doc: DocumentModel; out: RenderedOutput; onAbrir: (id: DetectionId, el: HTMLElement) => void }) {
  const [paginas, setPaginas] = useState<PaginaVista[]>([]);
  const [avance, setAvance] = useState<{ hecho: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const actuales = useRef<PaginaVista[]>([]);
  actuales.current = paginas;

  useEffect(() => {
    const original = originalDe(doc.id);
    if (original === null || doc.source !== 'pdf') return undefined;
    const ctrl = new AbortController();
    const nuevas: PaginaVista[] = [];
    let entregadas = false;
    setError(null);
    setAvance({ hecho: 0, total: 0 });
    void tacharPaginas(original.bytes, doc, out, (p) => {
      const c = document.createElement('canvas');
      c.width = p.lienzo.ancho;
      c.height = p.lienzo.alto;
      c.setAttribute('aria-hidden', 'true');
      c.getContext('2d')?.drawImage(p.lienzo.canvas as HTMLCanvasElement, 0, 0);
      vivos.add(c);
      nuevas.push({ n: p.n, total: p.total, lienzo: c, zonas: p.zonas });
    }, { escala: ESCALA_VISTA, signal: ctrl.signal, alAvanzar: (hecho, total) => { setAvance({ hecho, total }); } })
      .then((w) => {
        if (ctrl.signal.aborted) return;
        entregadas = true;
        setPaginas((previas) => { for (const x of previas) vaciar(x.lienzo); return [...nuevas]; });
        // A-20 y M-122 (F4-r1): las páginas no analizadas salen cubiertas (M-310); las imágenes de las que salen, tal cual.
        const lineas = lineasDeAdvertencias(w.avisos).map((l) => t(l.id, l.params));
        const cubiertas = (m: string): string => w.paginasCubiertas.filter((c) => c.motivo === m).map((c) => c.page).join(', ');
        if (cubiertas('sin_mapa') !== '') lineas.push(tf('M-2297', { paginas: cubiertas('sin_mapa') }));
        if (cubiertas('excluida') !== '') lineas.push(tf('M-2298', { paginas: cubiertas('excluida') }));
        if (w.paginasConImagenes.length > 0) lineas.push(tf('M-2295', { paginas: w.paginasConImagenes.join(', ') }));
        setAvisos(lineas);
        setAvance(null);
      }, (e: unknown) => {
        for (const x of nuevas) vaciar(x.lienzo);
        if (ctrl.signal.aborted) return;
        setError(mensajeDeCodigo(codigoDeError(e)));
        setAvance(null);
      });
    return () => { ctrl.abort(); if (!entregadas) for (const x of nuevas) vaciar(x.lienzo); };
  }, [doc, out]);

  useEffect(() => () => { for (const x of actuales.current) vaciar(x.lienzo); }, []);

  return (
    <div class="paginas-pdf" data-prueba="paginas-pdf">
      <p class="ayuda">{tf('M-2244')} {tf('M-2279')}</p>
      {avance !== null ? <p role="status" data-prueba="preparando-paginas">{tf('M-2278', { hecho: avance.hecho, total: avance.total || '…' })}</p> : null}
      {error !== null ? <p role="alert" class="error-campo">{error}</p> : null}
      {avisos.length > 0 ? <ul class="avisos-lectura">{avisos.map((a) => <li key={a}>{a}</li>)}</ul> : null}
      {paginas.map((p) => (
        <figure key={p.n} class="pagina-pdf" aria-label={tf('M-2275', { n: p.n, total: p.total })}>
          <div class="pagina-pdf-marco">
            <Lienzo c={p.lienzo} />
            {p.zonas.map((z, i) => <Zona key={i} z={z} ancho={p.lienzo.width} alto={p.lienzo.height} onAbrir={onAbrir} />)}
          </div>
          <figcaption>{tf('M-2275', { n: p.n, total: p.total })}</figcaption>
        </figure>
      ))}
    </div>
  );
}
