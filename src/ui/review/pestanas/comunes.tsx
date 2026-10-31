// Piezas comunes de las pestañas «Sugerencias de generalización» y «Revisión manual (banderas)» (PC-4, 8.2.6).
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { DocumentModel, Part, ReviewState, Span } from '../../../core/types.ts';
import { atributosDeContenedor, useIdNeutro } from '../../campos.tsx';
import { ROTULOS, t } from '../../mensajes.ts';
import { consumirFocoDeTarjeta, irAUbicacion, useLateral } from './herramientas.ts';

/** Contexto de ±40 caracteres de un tramo, en una sola línea (8.2.6). */
export function contextoDeTramo(part: Part | undefined, span: Span): { antes: string; texto: string; despues: string } {
  const plano = (s: string): string => s.replace(/\s+/gu, ' ');
  if (part === undefined) return { antes: '', texto: '', despues: '' };
  const a = Math.max(0, span.start - 40);
  const b = Math.min(part.text.length, span.end + 40);
  return {
    antes: (a > 0 ? '…' : '') + plano(part.text.slice(a, span.start)),
    texto: plano(part.text.slice(span.start, span.end)),
    despues: plano(part.text.slice(span.end, b)) + (b < part.text.length ? '…' : ''),
  };
}

/** Posición de lectura de un tramo: (orden de la parte, inicio). */
export const posicionDe = (doc: DocumentModel, span: Span): [number, number] => [doc.parts.find((p) => p.id === span.partId)?.order ?? 0, span.start];
export const compararPosiciones = (a: readonly [number, number], b: readonly [number, number]): number => a[0] - b[0] || a[1] - b[1];

/** Tramo donde está una sugerencia: el del objetivo o el de su detección. */
export function tramoDeSugerencia(state: ReviewState, s: ReviewState['suggestions'][keyof ReviewState['suggestions']]): Span | null {
  if (s.target.kind === 'tramo') return s.target.span;
  const d = state.detections[s.target.detectionId];
  return d === undefined ? null : { partId: d.partId, start: d.start, end: d.end };
}

export function Contexto({ part, span }: { part: Part | undefined; span: Span }) {
  const c = contextoDeTramo(part, span);
  return (
    <p class="ctx-tarjeta" ref={atributosDeContenedor}>
      <span class="ctx">{c.antes}<strong>{c.texto}</strong>{c.despues}</span>
      {part !== undefined ? <span class="parte-tarjeta"> · {part.label}</span> : null}
    </p>
  );
}

export function IrALaUbicacion({ span }: { span: Span }) {
  return (
    <button type="button" class="secundario" onClick={() => { irAUbicacion(span); }}>{t(ROTULOS.ir_a_la_ubicacion)}</button>
  );
}

/** Enfoca la tarjeta cuando el recorrido de pendientes la pide (el foco no se mueve en ningún otro caso). */
export function useFocoDeTarjeta(tipo: 'sug' | 'ban', id: string) {
  const ref = useRef<HTMLLIElement>(null);
  const { foco } = useLateral();
  useEffect(() => {
    if (foco === null || foco.tipo !== tipo || foco.id !== id || ref.current === null) return;
    ref.current.focus({ preventScroll: true });
    ref.current.scrollIntoView({ block: 'nearest' });
    consumirFocoDeTarjeta(foco.n);
  }, [foco, tipo, id]);
  return ref;
}

/** Radio con `id` neutro (c1, c2…): 8.7 pide ids sin palabras del contenido; el grupo comparte un `name` neutro. */
export function Radio(p: { grupo: string; valor: string; marcado: boolean; onCambio: () => void; children: ComponentChildren }) {
  const id = useIdNeutro();
  return (
    <label class="opcion" for={id}>
      <input id={id} type="radio" name={p.grupo} value={p.valor} checked={p.marcado} onChange={p.onCambio} />
      {' '}{p.children}
    </label>
  );
}
