// Campos de formulario con los atributos de privacidad de 8.7 (F-08, V-19, V-25, V-26, V-27).
// Los atributos se fijan con setAttribute: en Preact `translate` y `autocorrect` se asignarían como propiedades booleanas
// del elemento y 'no' / 'off' se convertirían en «yes» / «on».
import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';

let contador = 0;
/** `id` y `name` neutros (c1, c2…): los navegadores envían la estructura del formulario a sus servidores (8.7). */
export function useIdNeutro(): string {
  const r = useRef<string>('');
  if (r.current === '') r.current = 'c' + String(++contador);
  return r.current;
}

const COMUNES: ReadonlyArray<readonly [string, string]> = [
  ['spellcheck', 'false'], ['autocorrect', 'off'], ['autocapitalize', 'off'], ['translate', 'no'],
];
const CORRECTORES: ReadonlyArray<readonly [string, string]> = [
  ['data-gramm', 'false'], ['data-gramm_editor', 'false'], ['data-enable-grammarly', 'false'], ['data-lt-active', 'false'],
];

/** Texto del documento, nombres, valores o la respuesta de la IA (8.7, primera fila). */
export function atributosDeContenido(el: HTMLElement | null): void {
  if (!el) return;
  for (const [k, v] of [...COMUNES, ...CORRECTORES, ['autocomplete', 'off'] as const]) el.setAttribute(k, v);
}
/** Frases de paso (8.7, segunda fila): `type="password"` lo pone el campo; pegar queda permitido. */
export function atributosDeFrase(el: HTMLElement | null): void {
  if (!el) return;
  for (const [k, v] of [...COMUNES, ['autocomplete', 'new-password'] as const]) el.setAttribute(k, v);
}
/** Contenedores con contenido (8.7, tercera fila). */
export function atributosDeContenedor(el: HTMLElement | null): void {
  if (!el) return;
  el.setAttribute('translate', 'no');
  el.setAttribute('spellcheck', 'false');
}

interface BaseProps {
  etiqueta: string;
  valor: string;
  onInput: (v: string) => void;
  ayuda?: string | undefined;
  error?: string | undefined;
  deshabilitado?: boolean | undefined;
  onEnter?: (() => void) | undefined;
  /** Etiqueta visible y nombre accesible de un campo de contenido con `class` extra. */
  clase?: string | undefined;
}

function Descripcion({ id, ayuda, error }: { id: string; ayuda?: string | undefined; error?: string | undefined }) {
  return (
    <>
      {ayuda ? <p id={`${id}-a`} class="ayuda">{ayuda}</p> : null}
      {error ? <p id={`${id}-e`} class="error-campo" role="alert">{error}</p> : null}
    </>
  );
}
function describedBy(id: string, ayuda?: string, error?: string): string | undefined {
  const ids = [ayuda ? `${id}-a` : '', error ? `${id}-e` : ''].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

/** `input` de contenido (código del asunto, nombres, variantes): atributos de 8.7, fila 1. */
export function CampoTexto(p: BaseProps) {
  const id = useIdNeutro();
  return (
    <div class="campo">
      <label for={id}>{p.etiqueta}</label>
      <input
        id={id}
        name={id}
        type="text"
        class={p.clase}
        value={p.valor}
        disabled={p.deshabilitado}
        aria-invalid={p.error ? 'true' : undefined}
        aria-describedby={describedBy(id, p.ayuda, p.error)}
        ref={atributosDeContenido}
        onInput={(e) => { p.onInput((e.currentTarget as HTMLInputElement).value); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && p.onEnter) { e.preventDefault(); p.onEnter(); } }}
      />
      <Descripcion id={id} ayuda={p.ayuda} error={p.error} />
    </div>
  );
}

/** `textarea` de contenido («Pegar lista», Entrada, Reinserción). */
export function AreaTexto(p: BaseProps & { filas?: number }) {
  const id = useIdNeutro();
  return (
    <div class="campo">
      <label for={id}>{p.etiqueta}</label>
      <textarea
        id={id}
        name={id}
        class={p.clase}
        rows={p.filas ?? 6}
        value={p.valor}
        disabled={p.deshabilitado}
        aria-invalid={p.error ? 'true' : undefined}
        aria-describedby={describedBy(id, p.ayuda, p.error)}
        ref={atributosDeContenido}
        onInput={(e) => { p.onInput((e.currentTarget as HTMLTextAreaElement).value); }}
      />
      <Descripcion id={id} ayuda={p.ayuda} error={p.error} />
    </div>
  );
}

/** Campo de frase de paso con «Mostrar» / «Ocultar» (alterna `password` y `text`). */
export function CampoFrase(p: BaseProps & { mostrar: boolean; alMostrar?: (() => void) | undefined; rotuloMostrar?: string | undefined; contador?: string | undefined }) {
  const id = useIdNeutro();
  return (
    <div class="campo">
      <label for={id}>{p.etiqueta}</label>
      <div class="fila">
        <input
          id={id}
          name={id}
          type={p.mostrar ? 'text' : 'password'}
          value={p.valor}
          disabled={p.deshabilitado}
          aria-invalid={p.error ? 'true' : undefined}
          aria-describedby={describedBy(id, p.ayuda, p.error)}
          ref={atributosDeFrase}
          onInput={(e) => { p.onInput((e.currentTarget as HTMLInputElement).value); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && p.onEnter) { e.preventDefault(); p.onEnter(); } }}
        />
        {p.alMostrar ? (
          <button type="button" class="secundario" aria-pressed={p.mostrar} disabled={p.deshabilitado} onClick={p.alMostrar}>
            {p.rotuloMostrar}
          </button>
        ) : null}
      </div>
      {p.contador ? <p class="ayuda" aria-live="off">{p.contador}</p> : null}
      <Descripcion id={id} ayuda={p.ayuda} error={p.error} />
    </div>
  );
}

export function Casilla(p: { etiqueta: string; marcada: boolean; onCambio: (v: boolean) => void; deshabilitado?: boolean | undefined; ayuda?: string | undefined }) {
  const id = useIdNeutro();
  return (
    <div class="casilla">
      <input
        id={id}
        name={id}
        type="checkbox"
        checked={p.marcada}
        disabled={p.deshabilitado}
        aria-describedby={p.ayuda ? `${id}-a` : undefined}
        onChange={(e) => { p.onCambio((e.currentTarget as HTMLInputElement).checked); }}
      />
      <label for={id}>{p.etiqueta}</label>
      {p.ayuda ? <p id={`${id}-a`} class="ayuda">{p.ayuda}</p> : null}
    </div>
  );
}

export function Seleccion(p: {
  etiqueta: string;
  valor: string;
  opciones: ReadonlyArray<readonly [string, string]>;
  onCambio: (v: string) => void;
  deshabilitado?: boolean | undefined;
  describedBy?: string | undefined;
}) {
  const id = useIdNeutro();
  return (
    <div class="campo">
      <label for={id}>{p.etiqueta}</label>
      <select
        id={id}
        name={id}
        value={p.valor}
        disabled={p.deshabilitado}
        aria-describedby={p.describedBy}
        onChange={(e) => { p.onCambio((e.currentTarget as HTMLSelectElement).value); }}
      >
        {p.opciones.map(([v, e]) => <option key={v} value={v}>{e}</option>)}
      </select>
    </div>
  );
}

export function Grupo(p: { leyenda: string; children: ComponentChildren }) {
  return (
    <fieldset class="grupo">
      <legend>{p.leyenda}</legend>
      {p.children}
    </fieldset>
  );
}
