// Resaltado de las coincidencias de la búsqueda propia dentro del panel de texto (PC-4, 8.2.6). El panel de PC-3 llama a `trocear`
// para cada tramo de texto plano o de resaltado: el texto sigue siendo un nodo de texto (JSX), con `data-o` en la posición canónica
// de cada trozo, de modo que la selección y la copia (8.7) siguen saliendo del modelo. Sin `innerHTML`.
import type { ComponentChildren } from 'preact';
import type { Marca } from './herramientas.ts';

/**
 * Trozos de `texto[desde, hasta)` con las marcas que lo cruzan envueltas en `<mark>`. `etiquetaBase` distingue la clave de los trozos
 * sin marca. Las marcas deben venir en orden de lectura y sin solaparse (la búsqueda avanza `consulta.length` por coincidencia).
 */
export function trocear(texto: string, desde: number, hasta: number, marcas: readonly Marca[] | undefined, claveBase: string): ComponentChildren[] {
  if (marcas === undefined || marcas.length === 0) return [<span key={`${claveBase}t${desde}`} data-o={desde}>{texto.slice(desde, hasta)}</span>];
  const nodos: ComponentChildren[] = [];
  let cursor = desde;
  for (const m of marcas) {
    if (m.end <= cursor) continue;
    if (m.start >= hasta) break;
    const a = Math.max(m.start, cursor);
    const b = Math.min(m.end, hasta);
    if (a > cursor) nodos.push(<span key={`${claveBase}t${cursor}`} data-o={cursor}>{texto.slice(cursor, a)}</span>);
    nodos.push(
      <mark key={`${claveBase}m${a}`} class={m.actual ? 'coincidencia coincidencia-actual' : 'coincidencia'} data-o={a} data-coincidencia={m.actual ? 'actual' : 'otra'}>
        {texto.slice(a, b)}
      </mark>,
    );
    cursor = b;
  }
  if (cursor < hasta) nodos.push(<span key={`${claveBase}t${cursor}`} data-o={cursor}>{texto.slice(cursor, hasta)}</span>);
  return nodos;
}
