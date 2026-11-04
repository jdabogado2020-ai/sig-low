// F10 (v1.1.3) · La descarga del detector de nombres en la banda de la vista previa, cuando «Anonimizar» la empezó: avance real en
// MB y en %, tiempo estimado con la velocidad medida y «Descargar sin esperar al detector» con su confirmación. La vista previa ya
// muestra reglas y lista; al terminar, el detector revisa el documento abierto (analisis.ts, `descargarYCorrer`).
import { useRef, useState } from 'preact/hooks';
import type { DetectionSet, ReviewState } from '../../core/types.ts';
import { seguirSinModelo } from '../analisis.ts';
import { Dialogo } from '../dialogo.tsx';
import { actualizar, ir, useShell } from '../estado.ts';
import { puertos } from '../servicios.ts';
import { tf } from './textos.ts';

const MB = 1_000_000;
/** Tiempo y bytes mínimos antes de estimar: menos sería una velocidad de arranque, no la de la descarga. */
const MEDIR_DESDE_MS = 3000;
const MEDIR_DESDE_BYTES = 256 * 1024;

/** Minutos que faltan con la velocidad medida desde la primera muestra; null mientras no hay medida suficiente. */
export function minutosRestantes(inicio: { t: number; b: number }, ahora: number, hecho: number, total: number): number | null {
  const dt = ahora - inicio.t;
  const db = hecho - inicio.b;
  if (dt < MEDIR_DESDE_MS || db < MEDIR_DESDE_BYTES || total <= hecho) return null;
  const segundos = (total - hecho) / (db / (dt / 1000));
  return segundos / 60;
}

/** Texto del tiempo que falta (M-2328 a M-2330), o «midiendo» (M-2341). */
export function textoRestante(min: number | null): string {
  if (min === null) return tf('M-2341');
  if (min < 0.75) return tf('M-2329');
  if (min < 1.5) return tf('M-2330');
  return tf('M-2328', { n: Math.round(min) });
}

/** Cuántos datos agregó el detector de nombres (M-2335 a M-2337): las detecciones que vienen de él. */
export function textoAgregados(state: ReviewState | DetectionSet): string {
  const n = (Array.isArray(state.detections) ? state.detections : Object.values(state.detections)).filter((d) => d.source === 'modelo').length;
  return n === 0 ? tf('M-2337') : n === 1 ? tf('M-2336') : tf('M-2335', { n });
}

export function BandaDescarga() {
  const { model } = useShell();
  const [confirmar, setConfirmar] = useState(false);
  const inicio = useRef<{ t: number; b: number } | null>(null);
  const hecho = model.doneBytes ?? 0;
  const total = model.totalBytes ?? (puertos.modelo.estado().mb ?? 626) * MB;
  if (model.state === 'descargando' && inicio.current === null) inicio.current = { t: Date.now(), b: hecho };
  const pct = total > 0 ? Math.min(100, Math.floor((hecho / total) * 100)) : 0;
  const avance = tf('M-2327', { hecho: Math.round(hecho / MB), mb: Math.round(total / MB), pct });
  const restante = inicio.current === null ? null : minutosRestantes(inicio.current, Date.now(), hecho, total);
  return (
    <section class="banda banda-en-curso" data-prueba="banda-modelo" data-estado="descargando" aria-label={tf('M-2326')}>
      <h2 class="banda-titulo">{tf('M-2326')}</h2>
      <div role="status">
        <p data-prueba="avance-descarga">{avance}</p>
        <p data-prueba="tiempo-descarga">{model.state === 'verificando' ? tf('M-2329') : textoRestante(restante)}</p>
      </div>
      <progress value={hecho} max={total > 0 ? total : 1} aria-label={tf('M-2326')} aria-valuetext={avance} />
      <p class="ayuda">{tf('M-2331')}</p>
      <div class="acciones">
        <button type="button" class="secundario" data-prueba="descargar-sin-esperar" onClick={() => { setConfirmar(true); }}>{tf('M-2332')}</button>
      </div>
      <Dialogo abierto={confirmar} titulo={tf('M-2332')} onCerrar={() => { setConfirmar(false); }}>
        <p>{tf('M-2333')}</p>
        <div class="acciones">
          <button type="button" onClick={() => { setConfirmar(false); seguirSinModelo(); actualizar({ phase: 'listo' }); ir('listo'); }}>{tf('M-2332')}</button>
          <button type="button" class="secundario" onClick={() => { setConfirmar(false); }}>{tf('M-2334')}</button>
        </div>
      </Dialogo>
    </section>
  );
}
