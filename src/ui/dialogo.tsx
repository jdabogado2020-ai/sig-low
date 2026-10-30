// Diálogos nativos <dialog> con showModal() (8.6.5): atrapan el foco, Esc los cierra y el foco vuelve al control que los abrió.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { useIdNeutro } from './campos.tsx';

interface Props {
  abierto: boolean;
  titulo: string;
  onCerrar: () => void;
  children: ComponentChildren;
  rol?: 'dialog' | 'alertdialog';
  clase?: string;
}

export function Dialogo({ abierto, titulo, onCerrar, children, rol = 'dialog', clase }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const previo = useRef<Element | null>(null);
  const tid = useIdNeutro();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) {
      previo.current = document.activeElement;
      d.showModal();
    } else if (!abierto && d.open) {
      d.close();
      if (previo.current instanceof HTMLElement && previo.current.isConnected) previo.current.focus();
    }
  }, [abierto]);
  return (
    <dialog
      ref={ref}
      class={clase ? `dialogo ${clase}` : 'dialogo'}
      role={rol}
      aria-labelledby={tid}
      onCancel={(e) => { e.preventDefault(); onCerrar(); }}
    >
      {abierto ? (
        <div class="dialogo-cuerpo">
          <h2 id={tid} tabIndex={-1}>{titulo}</h2>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
