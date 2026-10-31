// Las API originales de la página, guardadas antes de la guardia (src/guard.ts, 5.2.1; PD-2-r1). La guardia es el primer módulo
// de la app: acota `fetch` (solo GET al mismo origen, sin query, a /, /index.html, /assets/, /ort/ y /models/), neutraliza
// XMLHttpRequest, WebSocket, EventSource, sendBeacon, window.open y WebRTC, y cierra los realms de iframe (M-4). Las pruebas que
// miden lo que hay debajo (la CSP, el interruptor del service worker, el servidor) necesitan las originales: este script de
// inicio corre antes que cualquier script de la página (`addInitScript`) y las deja en `globalThis.__nativo`, como las vería un
// código que corriera antes que la guardia. Solo existe en las pruebas. En un worker no hace falta: los propios llevan la guardia
// y el de pdf.js (de terceros, del mismo origen) no, así que la CSP del worker se prueba desde ese.
//
//   await guardarOriginales(ctx);                                  // antes de page.goto
//   await page.evaluate(() => (globalThis as unknown as ConNativo).__nativo.fetch('/fuga', { method: 'POST', body: 'x' }));
import type { BrowserContext, Page } from '@playwright/test';

/** Lo que el script deja en `globalThis.__nativo`. Las funciones ya van atadas a su objeto (`fetch(…)` se llama tal cual). */
export interface Nativo {
  fetch: typeof fetch;
  XMLHttpRequest: typeof XMLHttpRequest;
  WebSocket: typeof WebSocket;
  EventSource: typeof EventSource;
  sendBeacon: (url: string, datos: string) => boolean;
  open: (url: string) => unknown;
  /** `document.createElement` original (la guardia rechaza `iframe`, `frame`, `object` y `embed`). */
  createElement: (nombre: string) => HTMLElement;
  /** El getter original de `HTMLIFrameElement.prototype.contentWindow` (la guardia lo deja en `null`). */
  contentWindow: (marco: HTMLIFrameElement) => Window | null;
  /** `typeof speechSynthesis` y `typeof SpeechSynthesisUtterance` antes de la guardia (B-18), separados por un espacio. */
  voz: string;
}

/** Para leerlas dentro de la página: `(globalThis as unknown as ConNativo).__nativo`. */
export interface ConNativo { __nativo: Nativo }

/** Instala el script en el contexto o en la página: vale para las páginas y navegaciones que vengan después (también al recargar). */
export async function guardarOriginales(destino: BrowserContext | Page): Promise<void> {
  await destino.addInitScript(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    const ventana = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')?.get;
    g['__nativo'] = {
      fetch: globalThis.fetch.bind(globalThis),
      XMLHttpRequest, WebSocket, EventSource,
      sendBeacon: Navigator.prototype.sendBeacon.bind(navigator),
      open: globalThis.open.bind(globalThis),
      createElement: Document.prototype.createElement.bind(document),
      contentWindow: (marco: HTMLIFrameElement) => (ventana ? (ventana.call(marco) as Window | null) : null),
      voz: [typeof g['speechSynthesis'], typeof g['SpeechSynthesisUtterance']].join(' '),
    };
  });
}
