// Íconos SVG y insignias del resaltado (8.4.1, 8.4.4). Todos con aria-hidden: su significado va en el nombre accesible (8.6.4).
// La interfaz no usa caracteres Unicode para los símbolos de estado.
import type { DetectionStatus } from '../../../core/types.ts';
import { tx } from './textos.ts';

type Glifo = 'pendiente' | 'aceptada' | 'editada' | 'rechazada' | 'aprox' | 'bandera' | 'confirmada';

function Glifo({ g }: { g: Glifo }) {
  return (
    <svg class={`ico ico-${g}`} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      {g === 'pendiente' ? <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6" /> : null}
      {g === 'aceptada' || g === 'confirmada' ? <path d="M1.8 6.6 4.8 9.4 10.4 2.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /> : null}
      {g === 'editada' ? <path d="M2 10 2.6 7.4 8.2 1.8 10.2 3.8 4.6 9.4Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" /> : null}
      {g === 'rechazada' ? <path d="M2.4 2.4 9.6 9.6M9.6 2.4 2.4 9.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /> : null}
      {g === 'aprox' ? <path d="M1.5 4.5C3 2.8 4.4 2.8 6 4.5S9 6.2 10.5 4.5M1.5 8.5C3 6.8 4.4 6.8 6 8.5S9 10.2 10.5 8.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" /> : null}
      {g === 'bandera' ? <path d="M6 1.8V7M6 9.6V10.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /> : null}
    </svg>
  );
}

export function IconoDeEstado({ estado }: { estado: DetectionStatus }) {
  return <Glifo g={estado} />;
}

/** Insignia (0,75 em, negrita) antes del texto resaltado: estado + abreviatura (+ ≈ y NUEVA). No es parte del texto canónico. */
export function Insignia({ abreviatura, estado, bandera, confirmada, sugerencia, nueva }: {
  abreviatura: string;
  estado?: DetectionStatus;
  bandera?: boolean;
  confirmada?: boolean;
  sugerencia?: boolean;
  nueva?: boolean;
}) {
  const g: Glifo = bandera ? (confirmada ? 'confirmada' : 'bandera') : (estado ?? 'pendiente');
  return (
    <span class="ins" aria-hidden="true">
      <Glifo g={g} />
      <span class="abr">{abreviatura}</span>
      {sugerencia ? <Glifo g="aprox" /> : null}
      {nueva ? <span class="nueva">{tx('M-1337')}</span> : null}
    </span>
  );
}
