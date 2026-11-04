// F2 · Ayuda en contexto: un «?» junto a cada opción, con una explicación de una frase que se abre y se cierra (sin ventana).
import { useState } from 'preact/hooks';
import { useIdNeutro } from '../campos.tsx';
import { tf } from './textos.ts';

export function Ayuda({ tema, texto }: { tema: string; texto: string }) {
  const [abierta, setAbierta] = useState(false);
  const id = useIdNeutro();
  return (
    <span class="ayuda-contexto">
      <button
        type="button"
        class="ayuda-boton"
        aria-expanded={abierta}
        aria-controls={id}
        aria-label={tf('M-2223', { tema })}
        onClick={() => { setAbierta(!abierta); }}
      >
        ?
      </button>
      <span id={id} class="ayuda-texto" role="note" hidden={!abierta}>{texto}</span>
    </span>
  );
}
