// Arnés de la E2E del modelo (T-AB-05): crea el worker `ner` real y expone un pedir() mínimo. No es parte de la app.
type Mensaje = { reqId: string; kind: string; [k: string]: unknown };

const worker = new Worker(new URL('../../../src/workers/ner.worker.ts', import.meta.url), { type: 'module' });
const escuchas = new Set<(m: Mensaje) => void>();
worker.addEventListener('message', (e: MessageEvent<Mensaje>) => escuchas.forEach((f) => f(e.data)));

(globalThis as unknown as Record<string, unknown>)['__ner'] = {
  /** Envía una petición y junta todos los mensajes de su reqId hasta el final (resultado, error o cancelado). */
  pedir(peticion: Mensaje, alVer?: string): Promise<Mensaje[]> {
    return new Promise((resolver) => {
      const vistos: Mensaje[] = [];
      let cancelo = false;
      const f = (m: Mensaje): void => {
        if (m.reqId !== peticion.reqId) return;
        vistos.push(m);
        if (alVer && m.kind === alVer && !cancelo) {
          cancelo = true;
          worker.postMessage({ v: 1, reqId: `${peticion.reqId}-c`, kind: 'cancelar', payload: { targetReqId: peticion.reqId } });
        }
        if (m.kind === 'resultado' || m.kind === 'error' || m.kind === 'cancelado') {
          escuchas.delete(f);
          resolver(vistos);
        }
      };
      escuchas.add(f);
      worker.postMessage(peticion);
    });
  },
};
