// Pestaña «Detecciones» (8.2.6, 8.6.5, 8.8): `treegrid` con una fila por entidad y, desplegadas, una fila por mención.
// Alto fijo (48 px entidad, 56 px mención), 10 filas de margen, `aria-rowcount` y `aria-rowindex`; las filas plegadas no se montan.
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Detection, DetectionId, Entity, EntityId, ReviewState } from '../../../core/types.ts';
import { etiqueta, ROTULOS, t } from '../../mensajes.ts';
import { aceptar, aceptarEntidad, rechazar, rechazarEntidad, restablecer } from './acciones.ts';
import {
  alternarExpandida, consumirEnfoque, irAPendiente, pedirEnfoque, seleccionar, seleccionarEntidad, solicitarEdicion, useRevisionUi,
} from './almacen.ts';
import { IconoDeEstado, Insignia } from './iconos.tsx';
import {
  abreviaturaDe, categoriaDe, contextoDe, nombreDeFilaEntidad, nombreDeTipo, pendientesDe, textoDeMenciones, textoDePendientes,
} from './presentacion.ts';
import { tx } from './textos.ts';

const ALTO_ENTIDAD = 48;
const ALTO_MENCION = 56;
const MARGEN = 10;

type FilaG =
  | { tipo: 'ent'; clave: string; e: Entity }
  | { tipo: 'men'; clave: string; d: Detection; e: Entity; i: number; n: number };

/** Entidades en orden de lectura (por su primera mención) y, desplegadas, sus menciones. */
export function aplanar(state: ReviewState, expandidas: ReadonlySet<EntityId>): FilaG[] {
  const pos = new Map(state.order.map((id, i) => [id, i]));
  const entidades = Object.values(state.entities)
    .filter((e) => e.mentions.some((m) => state.detections[m] !== undefined))
    .sort((a, b) => (pos.get(a.mentions[0] as DetectionId) ?? 0) - (pos.get(b.mentions[0] as DetectionId) ?? 0));
  const filas: FilaG[] = [];
  for (const e of entidades) {
    filas.push({ tipo: 'ent', clave: `e:${e.id}`, e });
    if (!expandidas.has(e.id)) continue;
    const ms = e.mentions.map((m) => state.detections[m]).filter((d): d is Detection => d !== undefined);
    ms.forEach((d, i) => { filas.push({ tipo: 'men', clave: `m:${d.id}`, d, e, i: i + 1, n: ms.length }); });
  }
  return filas;
}

const altoDe = (f: FilaG): number => (f.tipo === 'ent' ? ALTO_ENTIDAD : ALTO_MENCION);

export function Cuadricula({ singleKey }: { singleKey: boolean }) {
  const rev = useRevisionUi();
  const { doc, state, expandidas, seleccion, entidadSeleccion, enfoque, nuevas } = rev;
  const cont = useRef<HTMLDivElement>(null);
  const rejilla = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ st: 0, vh: 480 });
  const [activa, setActiva] = useState<string | null>(null);
  const aEnfocar = useRef<string | null>(null);
  const raf = useRef(0);

  const filas = useMemo(() => (state === null ? [] : aplanar(state, expandidas)), [state, expandidas]);
  const offs: number[] = [];
  let total = 0;
  for (const f of filas) { offs.push(total); total += altoDe(f); }

  let primera = offs.findIndex((o, i) => o + altoDe(filas[i] as FilaG) > pos.st);
  if (primera < 0) primera = Math.max(0, filas.length - 1);
  let ultima = primera;
  while (ultima + 1 < filas.length && (offs[ultima + 1] as number) < pos.st + pos.vh) ultima++;
  const desde = Math.max(0, primera - MARGEN);
  const hasta = Math.min(filas.length - 1, ultima + MARGEN);

  useLayoutEffect(() => {
    rejilla.current?.style.setProperty('padding-block-start', `${filas.length > 0 ? (offs[desde] ?? 0) : 0}px`);
    const fin = hasta >= 0 && hasta < filas.length ? (offs[hasta] as number) + altoDe(filas[hasta] as FilaG) : 0;
    rejilla.current?.style.setProperty('padding-block-end', `${Math.max(0, total - fin)}px`);
  });
  useLayoutEffect(() => {
    const el = cont.current;
    if (el === null) return;
    const medir = (): void => { setPos((p) => (p.vh === el.clientHeight ? p : { ...p, vh: el.clientHeight })); };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, []);

  const alDesplazar = (): void => {
    if (raf.current !== 0) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const el = cont.current;
      if (el !== null) setPos((p) => (Math.abs(p.st - el.scrollTop) < 1 ? p : { ...p, st: el.scrollTop }));
    });
  };

  const indiceDe = (clave: string): number => filas.findIndex((f) => f.clave === clave);
  const mostrar = (idx: number): void => {
    const el = cont.current;
    if (el === null || idx < 0) return;
    const o = offs[idx] as number;
    const h = altoDe(filas[idx] as FilaG);
    let st = el.scrollTop;
    if (o < st) st = o;
    else if (o + h > st + el.clientHeight) st = o + h - el.clientHeight;
    if (st !== el.scrollTop) { el.scrollTop = st; setPos((p) => ({ ...p, st })); }
  };
  const enfocarFila = (clave: string): void => {
    const idx = indiceDe(clave);
    if (idx < 0) return;
    setActiva(clave);
    aEnfocar.current = clave;
    mostrar(idx);
  };

  // Al seleccionar una mención desde el texto, la cuadrícula la muestra (sin quitar el foco del texto).
  useLayoutEffect(() => {
    const clave = seleccion !== null ? `m:${seleccion}` : entidadSeleccion !== null ? `e:${entidadSeleccion}` : null;
    if (clave === null) return;
    const idx = indiceDe(clave);
    if (idx >= 0) mostrar(idx);
  }, [seleccion, entidadSeleccion, expandidas]);

  // Foco pedido por el almacén («fila») o por las flechas: se monta, se desplaza y se enfoca.
  useLayoutEffect(() => {
    if (enfoque !== null && enfoque.tipo === 'fila') {
      const clave = `m:${enfoque.id}`;
      if (indiceDe(clave) >= 0) { setActiva(clave); aEnfocar.current = clave; mostrar(indiceDe(clave)); consumirEnfoque(enfoque.n); }
    }
    const k = aEnfocar.current;
    if (k === null) return;
    const el = cont.current?.querySelector<HTMLElement>(`[data-fila="${k}"]`) ?? null;
    if (el !== null) { el.focus({ preventScroll: true }); aEnfocar.current = null; }
  });

  if (state === null || doc === null) return null;
  const partes = new Map(doc.parts.map((p) => [p.id, p]));
  const claveActiva = activa !== null && indiceDe(activa) >= 0 ? activa : (filas[0]?.clave ?? null);

  const alTeclear = (e: KeyboardEvent): void => {
    const fila = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-fila]') : null;
    if (fila === null || e.ctrlKey || e.metaKey || e.altKey) return;
    const clave = fila.dataset['fila'] ?? '';
    const idx = indiceDe(clave);
    const f = filas[idx];
    if (f === undefined) return;
    const enFila = e.target === fila;
    if (!enFila) {
      if (e.key === 'ArrowLeft' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); fila.focus(); }
      return;
    }
    const k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); const n = filas[idx + 1]; if (n) enfocarFila(n.clave); }
    else if (k === 'ArrowUp') { e.preventDefault(); const n = filas[idx - 1]; if (n) enfocarFila(n.clave); }
    else if (k === 'Home') { e.preventDefault(); const n = filas[0]; if (n) enfocarFila(n.clave); }
    else if (k === 'End') { e.preventDefault(); const n = filas[filas.length - 1]; if (n) enfocarFila(n.clave); }
    else if (k === 'ArrowRight') {
      e.preventDefault();
      if (f.tipo === 'ent') {
        if (!expandidas.has(f.e.id)) alternarExpandida(f.e.id, true);
        else { const n = filas[idx + 1]; if (n && n.tipo === 'men') enfocarFila(n.clave); }
      } else (fila.querySelector<HTMLElement>('button'))?.focus();
    } else if (k === 'ArrowLeft') {
      e.preventDefault();
      if (f.tipo === 'ent') { if (expandidas.has(f.e.id)) alternarExpandida(f.e.id, false); }
      else enfocarFila(`e:${f.e.id}`);
    } else if (k === 'Enter') {
      e.preventDefault();
      if (f.tipo === 'ent') { seleccionarEntidad(f.e.id); alternarExpandida(f.e.id); }
      else { seleccionar(f.d.id); pedirEnfoque('resaltado', f.d.id); }
    } else if (singleKey) {
      const l = k.toLowerCase();
      if (l === 'a' && e.shiftKey) { e.preventDefault(); aceptarEntidad(f.e.id); }
      else if (l === 'n') { e.preventDefault(); const id = irAPendiente(e.shiftKey ? -1 : 1); if (id !== null) pedirEnfoque('fila', id); }
      else if (f.tipo === 'men' && !e.shiftKey) {
        if (l === 'a') { e.preventDefault(); aceptar(f.d.id); }
        else if (l === 'r') { e.preventDefault(); rechazar(f.d.id); }
        else if (l === 'u') { e.preventDefault(); restablecer(f.d.id); }
        else if (l === 'e') { e.preventDefault(); solicitarEdicion(f.d.id); }
      }
    }
  };

  const montadas = filas.slice(desde, hasta + 1);
  return (
    <div class="cuadricula-envoltura">
      <div class="cuadricula-borde" ref={cont} onScroll={alDesplazar} onKeyDown={alTeclear}>
        <div
          role="treegrid"
          aria-label={t('M-957')}
          aria-rowcount={filas.length + 1}
          class="cuadricula"
          data-prueba="cuadricula"
        >
          <div role="row" aria-rowindex={1} class="fila-g encabezado-g">
            <div role="columnheader">{tx('M-1319')}</div>
            <div role="columnheader">{tx('M-1326')}</div>
            <div role="columnheader">{tx('M-1320')}</div>
            <div role="columnheader">{tx('M-1321')}</div>
            <div role="columnheader">{tx('M-1322')}</div>
            <div role="columnheader">{tx('M-1323')}</div>
            <div role="columnheader">{tx('M-1324')}</div>
            <div role="columnheader">{tx('M-1325')}</div>
          </div>
          <div role="rowgroup" ref={rejilla}>
          {montadas.map((f, k) => {
            const indice = desde + k;
            const activaF = f.clave === claveActiva;
            const ti = activaF ? 0 : -1;
            if (f.tipo === 'ent') {
              const e = f.e;
              const abierta = expandidas.has(e.id);
              const pend = pendientesDe(state, e);
              const tipo = nombreDeTipo(e.type);
              const txtAceptar = t(ROTULOS.aceptar_todas_las_menciones_n, { n: pend });
              const txtRechazar = t(ROTULOS.rechazar_todas_las_menciones);
              return (
                <div
                  key={f.clave}
                  role="row"
                  class={`fila-g fila-ent cat-${categoriaDe(e.type)}${entidadSeleccion === e.id ? ' sel' : ''}`}
                  aria-level={1}
                  aria-expanded={abierta}
                  aria-rowindex={indice + 2}
                  aria-label={nombreDeFilaEntidad(state, e)}
                  data-fila={f.clave}
                  tabIndex={ti}
                  onClick={(ev) => {
                    if ((ev.target as Element).closest('button') !== null) return;
                    setActiva(f.clave); seleccionarEntidad(e.id); alternarExpandida(e.id);
                  }}
                  onFocus={(ev) => { if (ev.target === ev.currentTarget) setActiva(f.clave); }}
                >
                  <div role="gridcell" class="c-nombre">
                    <Insignia abreviatura={abreviaturaDe(e.type)} estado="pendiente" />
                    <span class="g-tipo">{tipo}</span>
                    <span class="g-marcador">{e.marker ?? t('M-958')}</span>
                    <span class="g-valor">{e.display}</span>
                  </div>
                  <div role="gridcell" class="c-acciones">
                    <button
                      type="button" class="secundario" tabIndex={ti} disabled={pend === 0}
                      aria-label={tx('M-1318', { visible: txtAceptar, tipo })}
                      onClick={() => { aceptarEntidad(e.id); }}
                    >{txtAceptar}</button>
                    <button
                      type="button" class="secundario" tabIndex={ti} disabled={pend === 0}
                      aria-label={tx('M-1318', { visible: txtRechazar, tipo })}
                      onClick={() => { rechazarEntidad(e.id); }}
                    >{txtRechazar}</button>
                  </div>
                  <div role="gridcell" class="c-estado" />
                  <div role="gridcell" class="c-ctx">{textoDeMenciones(e.mentions.length)}, {textoDePendientes(pend)}</div>
                  <div role="gridcell" class="c-parte" />
                  <div role="gridcell" class="c-conf" />
                  <div role="gridcell" class="c-fuente" />
                  <div role="gridcell" class="c-reemplazo" />
                </div>
              );
            }
            const d = f.d;
            const tipo = nombreDeTipo(d.type);
            const parte = partes.get(d.partId);
            const ctx = contextoDe(parte, d);
            const final = d.status === 'rechazada' ? tx('M-1359')
              : d.status === 'editada' ? (d.replacement.edited ?? '')
                : (d.replacement.generalized?.template ?? d.replacement.proposedTemplate).split('{m}').join(f.e.marker ?? '');
            const nombre = (accion: string): string => tx('M-1317', { accion, i: f.i, tipo });
            return (
              <div
                key={f.clave}
                role="row"
                class={`fila-g fila-men cat-${categoriaDe(d.type)} est-${d.status}${seleccion === d.id ? ' sel' : ''}`}
                aria-level={2}
                aria-rowindex={indice + 2}
                aria-label={tx('M-1316', {
                  i: f.i, n: f.n, estado: etiqueta('estado', d.status).toLocaleLowerCase('es-CO'),
                  confianza: etiqueta('confianza', d.confidence).toLocaleLowerCase('es-CO'), parte: parte?.label ?? '',
                })}
                data-fila={f.clave}
                tabIndex={ti}
                onClick={(ev) => {
                  if ((ev.target as Element).closest('button') !== null) return;
                  setActiva(f.clave); seleccionar(d.id);
                }}
                onFocus={(ev) => { if (ev.target === ev.currentTarget) setActiva(f.clave); }}
              >
                <div role="gridcell" class="c-nombre">{tx('M-1329')} {f.i}</div>
                <div role="gridcell" class="c-acciones">
                  <button type="button" class="secundario" tabIndex={ti} aria-label={nombre(t(ROTULOS.aceptar))} onClick={() => { aceptar(d.id); }}>{t(ROTULOS.aceptar)}</button>
                  <button type="button" class="secundario" tabIndex={ti} aria-label={nombre(t(ROTULOS.rechazar))} onClick={() => { rechazar(d.id); }}>{t(ROTULOS.rechazar)}</button>
                  <button type="button" class="secundario" tabIndex={ti} aria-label={nombre(t(ROTULOS.editar))} onClick={() => { solicitarEdicion(d.id); }}>{t(ROTULOS.editar)}</button>
                  <button type="button" class="secundario" tabIndex={ti} aria-label={nombre(t(ROTULOS.restablecer))} onClick={() => { restablecer(d.id); }}>{t(ROTULOS.restablecer)}</button>
                </div>
                <div role="gridcell" class="c-estado">
                  <span class="ins" aria-hidden="true"><IconoDeEstado estado={d.status} /></span>
                  <span>{etiqueta('estado', d.status)}{nuevas.has(d.id) ? ` · ${tx('M-1337')}` : ''}</span>
                </div>
                <div role="gridcell" class="c-ctx"><span class="ctx">{ctx.antes}<strong>{ctx.texto}</strong>{ctx.despues}</span></div>
                <div role="gridcell" class="c-parte">{parte?.label ?? ''}</div>
                <div role="gridcell" class="c-conf">{etiqueta('confianza', d.confidence)}</div>
                <div role="gridcell" class="c-fuente">{etiqueta('fuente', d.source)}</div>
                <div role="gridcell" class="c-reemplazo">{final}</div>
              </div>
            );
          })}
          </div>
        </div>
      </div>
    </div>
  );
}
