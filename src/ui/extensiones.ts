// F8 (v1.1.1) · Aviso de extensión del navegador. Una extensión que inyecta su panel en la página (un iframe, un div o un elemento
// con su propio shadow DOM) puede leer el documento que el abogado tiene abierto. Sig-Low no la puede frenar, pero sí avisar.
//
// El observador mira solo la PRESENCIA de nodos: los hijos de <html> que no son <head> ni <body>, y los hijos de <body> que no son
// la raíz de la app ni un nodo propio. F9 (v1.1.2, M-160): lo propio se reconoce por IDENTIDAD (nodos-propios.ts: la raíz tomada al
// arrancar y un WeakSet con el párrafo de impresión M-126, el enlace efímero de una descarga y lo que crea pdf.js al dibujar), no
// por un atributo que una extensión puede copiar (`id="app"`, `data-siglow`). No lee su contenido, sus atributos ni su texto, y no
// envía nada: solo enciende el aviso. Los diálogos y menús de la app viven dentro de la raíz, así que no cuentan. <head> no se mira:
// ahí también escriben el navegador y las bibliotecas (hojas de estilo). Una vez visto, el aviso queda hasta recargar: quitar el
// panel no saca a la extensión de la página.
import { useEffect, useState } from 'preact/hooks';
import { esPropio, raizDeLaApp } from '../nodos-propios.ts';

let detectada = false;
const oyentes = new Set<() => void>();

/** ¿Hay hoy algún nodo ajeno colgado de <html> o de <body>? Solo compara identidades: <head>, <body>, la raíz y lo registrado. */
export function hayNodosAjenos(doc: Document = document): boolean {
  for (const el of doc.documentElement.children) if (el !== doc.head && el !== doc.body && !esPropio(el)) return true;
  if (doc.body !== null) for (const el of doc.body.children) if (!esPropio(el)) return true;
  return false;
}

function revisar(): void {
  // Hasta que main.tsx fija la raíz (justo después de importar los módulos), no se sabe cuál es el #app propio.
  if (detectada || raizDeLaApp() === null || !hayNodosAjenos()) return;
  detectada = true;
  for (const f of oyentes) f();
}

/** Revisa al arrancar y observa los cambios de hijos de <html> y <body> (no del resto del árbol). Devuelve la limpieza. */
export function vigilarExtensiones(): () => void {
  if (typeof MutationObserver === 'undefined') return () => undefined;
  // La primera revisión va en una microtarea: este módulo se registra al importarse, antes de que main.tsx fije la raíz.
  queueMicrotask(revisar);
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
