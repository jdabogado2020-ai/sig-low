// F9 (v1.1.2) · Nodos propios de la app fuera de #app, reconocidos por IDENTIDAD y no por atributos (M-160 de P0-6a de F8).
// El aviso de extensión (ui/extensiones.ts) da por ajeno todo hijo de <html> o de <body> que no esté aquí. Un atributo (`id="app"`,
// `data-siglow`) lo puede copiar cualquier extensión; la referencia a un objeto, no.
//
// - La raíz: el elemento en que main.tsx monta la app (`fijarRaiz`), tomado al arrancar.
// - Los nodos que la app cuelga de <body>: el párrafo de impresión M-126 (globales.ts) y el enlace efímero de una descarga
//   (io/txt-write.ts), con `registrarPropio`.
// - Lo que pdf.js crea al dibujar (B-170): pdf.js recibe `documentoParaPdfjs()`, un documento que registra cada elemento que crea
//   (el `div` oculto de su `DOMFilterFactory` con una función de transferencia `/TR`, sus lienzos). Se compara por el documento con que
//   pdf.js crea sus nodos, no por la hora: un nodo de una extensión que llegue durante el dibujo no pasa por aquí y sigue siendo ajeno.
// Código sin lectura de contenido: solo identidades de objetos.

const propios = new WeakSet<object>();
let raiz: Element | null = null;

/** main.tsx: el elemento en que se monta la app. */
export function fijarRaiz(el: Element): void { raiz = el; }
export const raizDeLaApp = (): Element | null => raiz;

/** Marca un nodo que la app cuelga fuera de su raíz. Devuelve el mismo nodo. */
export function registrarPropio<T extends object>(nodo: T): T {
  propios.add(nodo);
  return nodo;
}

export const esPropio = (nodo: object): boolean => nodo === raiz || propios.has(nodo);

const CREADORES: ReadonlySet<PropertyKey> = new Set(['createElement', 'createElementNS']);
const envoltorios = new WeakMap<Document, Document>();

/**
 * Documento para `getDocument({ ownerDocument })` de pdf.js: el mismo documento, salvo que `createElement` y `createElementNS`
 * registran como propio lo que crean. El resto de las propiedades se leen del documento real (`body`, `fonts`, `head`...).
 */
export function documentoParaPdfjs(doc: Document = document): Document {
  const ya = envoltorios.get(doc);
  if (ya !== undefined) return ya;
  const envoltorio = new Proxy(doc, {
    get(objetivo, prop) {
      const valor: unknown = Reflect.get(objetivo, prop, objetivo);
      if (typeof valor !== 'function') return valor;
      const fn = valor as (...a: unknown[]) => unknown;
      if (CREADORES.has(prop)) {
        return (...args: unknown[]): unknown => {
          const el = fn.apply(objetivo, args);
          if (typeof el === 'object' && el !== null) registrarPropio(el);
          return el;
        };
      }
      return fn.bind(objetivo);
    },
  });
  envoltorios.set(doc, envoltorio);
  return envoltorio;
}
