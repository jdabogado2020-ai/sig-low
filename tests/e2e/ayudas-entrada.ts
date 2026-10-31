// Ayudas de las pruebas E2E de Entrada y Procesando (PC-2). No es una prueba: lo importan flow.spec.ts y a11y.spec.ts.
// Envuelve `Worker` en la página para (a) registrar qué workers se crean y cuáles se terminan, (b) simular un worker `io`
// que no responde o que devuelve un DocumentModel de varias partes (hoy no existe el lector .docx) y (c) retener o fallar las
// respuestas del worker `detect` sin tocar su lógica. Los datos son ficticios evidentes (10.1.5).
import type { Page } from '@playwright/test';

export interface Simulador {
  creados: string[];
  terminados: string[];
  /** Mensajes `detectar` enviados: solo qué partes iban incluidas. */
  enviados: Array<{ kind: string; incluidas: boolean[] | null }>;
  retener: null | 'resultado' | 'todo';
  io: 'real' | 'mudo' | 'documento';
  errorDetect: string | null;
  docIo: unknown;
}

const SCRIPT = `(() => {
  const Real = window.Worker;
  const sim = window.__sim = { creados: [], terminados: [], enviados: [], retener: null, io: 'real', errorDetect: null, docIo: null, pendientes: [] };
  class Falso {
    constructor(url, opts) {
      const m = /([a-z]+)\\.worker/.exec(String(url));
      this.nombre = m ? m[1] : 'otro';
      sim.creados.push(this.nombre);
      this.onmessage = null; this.onerror = null; this.onmessageerror = null;
      this.real = this.nombre === 'io' && sim.io !== 'real' ? null : new Real(url, opts);
      if (this.real) this.real.onmessage = (ev) => this.llega(ev);
    }
    entregar(ev) { if (this.onmessage) this.onmessage(ev); }
    llega(ev) {
      const k = ev.data && ev.data.kind;
      if (sim.retener === 'todo' || (sim.retener === 'resultado' && k === 'resultado')) { sim.pendientes.push([this, ev]); return; }
      this.entregar(ev);
    }
    postMessage(msg, transfer) {
      if (this.nombre === 'detect') {
        const partes = msg && msg.payload && msg.payload.doc && msg.payload.doc.parts;
        sim.enviados.push({ kind: msg.kind, incluidas: partes ? partes.map((p) => p.included) : null });
        if (msg.kind === 'detectar' && sim.errorDetect) {
          setTimeout(() => this.entregar({ data: { v: 1, reqId: msg.reqId, kind: 'error', code: sim.errorDetect, retryable: false } }), 0);
          return;
        }
      }
      if (this.nombre === 'io' && sim.io === 'documento') {
        const p = msg.payload; const d = JSON.parse(JSON.stringify(sim.docIo));
        d.id = p.docId; d.label = p.label; d.parts.forEach((x) => { x.docId = p.docId; });
        setTimeout(() => this.entregar({ data: { v: 1, reqId: msg.reqId, kind: 'resultado', payload: { kind: 'leer', doc: d } } }), 0);
        return;
      }
      if (this.real) this.real.postMessage(msg, transfer);
    }
    terminate() { sim.terminados.push(this.nombre); if (this.real) this.real.terminate(); }
  }
  window.Worker = Falso;
  window.__soltarRetenidos = () => { const p = sim.pendientes.splice(0); for (const [w, ev] of p) w.entregar(ev); };
})();`;

/** Instala el simulador antes de que cargue la página. */
export async function instalarSimulador(page: Page): Promise<void> {
  await page.addInitScript({ content: SCRIPT });
}

export async function configurarSimulador(page: Page, parcial: Partial<Pick<Simulador, 'retener' | 'io' | 'errorDetect' | 'docIo'>>): Promise<void> {
  await page.evaluate((p) => { Object.assign((window as unknown as { __sim: object }).__sim, p); }, parcial);
}

export async function leerSimulador(page: Page): Promise<Simulador> {
  return page.evaluate(() => {
    const s = (window as unknown as { __sim: Simulador }).__sim;
    return { creados: [...s.creados], terminados: [...s.terminados], enviados: [...s.enviados], retener: s.retener, io: s.io, errorDetect: s.errorDetect, docIo: null };
  });
}

export async function soltarRetenidos(page: Page): Promise<void> {
  await page.evaluate(() => { (window as unknown as { __soltarRetenidos: () => void }).__soltarRetenidos(); });
}

/** DocumentModel ficticio de tres partes con metadatos y advertencias, para simular la lectura de un .docx. */
export const DOCUMENTO_DE_TRES_PARTES = {
  id: 'doc_00000000000000000000000000000000',
  label: 'Documento 1',
  source: 'docx',
  parts: [
    { id: 'prt_00000000000000000000000000000001', docId: 'x', kind: 'cuerpo', label: 'Cuerpo del documento', order: 0, index: 1, text: 'Ana Ficticia Rojas vive en la Calle 00 n.º 00-00. C.C. 1.000.000.017.', included: true },
    { id: 'prt_00000000000000000000000000000002', docId: 'x', kind: 'encabezado', label: 'Encabezado 1', order: 1, index: 1, text: 'Oficio de Prueba 001', included: true },
    { id: 'prt_00000000000000000000000000000003', docId: 'x', kind: 'comentario', label: 'Comentario 1', order: 2, index: 1, text: 'Revisar con Ejemplo Prueba.', included: true },
  ],
  metadata: { categories: { propiedades_documento: { count: 1 }, autores_revisiones: { count: 3 } } },
  warnings: [{ code: 'TEXTO_ELIMINADO_EXCLUIDO', count: 2 }, { code: 'MARCA_DE_AGUA', count: 1 }],
};
