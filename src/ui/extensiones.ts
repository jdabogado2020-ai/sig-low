// F8 (v1.1.1) · Aviso de extensión del navegador. Una extensión que inyecta su panel en la página (un iframe, un div o un elemento
// con su propio shadow DOM) puede leer el documento que el abogado tiene abierto. Sig-Low no la puede frenar, pero sí avisar.
//
// El observador mira solo la PRESENCIA de nodos: los hijos de <html> que no son <head> ni <body>, y los hijos de <body> que no son
// la raíz de la app (#app) ni un nodo propio marcado con `data-siglow` (el párrafo de impresión M-126 y el enlace efímero de una
// descarga). No lee su contenido, sus atributos ni su texto, y no envía nada: solo enciende el aviso. Los diálogos y menús de la app
// viven dentro de #app, así que no cuentan. <head> no se mira: ahí también escriben el navegador y las bibliotecas (hojas de estilo).
// Una vez visto, el aviso queda hasta recargar: quitar el panel no saca a la extensión de la página.
import { useEffect, useState } from 'preact/hooks';

/** Atributo de los nodos propios que la app cuelga de <body> fuera de #app. */
export const ATRIBUTO_PROPIO = 'data-siglow';
const ID_RAIZ = 'app';

let detectada = false;
const oyentes = new Set<() => void>();

const esAjenoEnBody = (el: Element): boolean => el.id !== ID_RAIZ && !el.hasAttribute(ATRIBUTO_PROPIO);
const esAjenoEnHtml = (el: Element): boolean => el.tagName !== 'HEAD' && el.tagName !== 'BODY';

/** ¿Hay hoy algún nodo ajeno colgado de <html> o de <body>? Solo mira la etiqueta, el id y el atributo propio. */
export function hayNodosAjenos(doc: Document = document): boolean {
  for (const el of doc.documentElement.children) if (esAjenoEnHtml(el)) return true;
  if (doc.body !== null) for (const el of doc.body.children) if (esAjenoEnBody(el)) return true;
  return false;
}

function revisar(): void {
  if (detectada || !hayNodosAjenos()) return;
  detectada = true;
  for (const f of oyentes) f();
}

/** Revisa al arrancar y observa los cambios de hijos de <html> y <body> (no del resto del árbol). Devuelve la limpieza. */
export function vigilarExtensiones(): () => void {
  if (typeof MutationObserver === 'undefined') return () => undefined;
  revisar();
  const obs = new MutationObserver(revisar);
  obs.observe(document.documentElement, { childList: true });
  if (document.body !== null) obs.observe(document.body, { childList: true });
  return () => { obs.disconnect(); };
}

export const extensionDetectada = (): boolean => detectada;

export function useExtensionDetectada(): boolean {
  const [v, setV] = useState(detectada);
  useEffect(() => {
    const f = (): void => { setV(true); };
    oyentes.add(f);
    if (detectada) setV(true);
    return () => { oyentes.delete(f); };
  }, []);
  return v;
}
