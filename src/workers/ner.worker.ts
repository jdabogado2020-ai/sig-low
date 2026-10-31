/// <reference lib="webworker" />
// Worker `ner` (6.11.3): conecta el protocolo de src/core/ner/handler.ts con el entorno.
// Worker de módulo del mismo origen (F-09). Es el único archivo del modelo que llama a `fetch(` (F-01):
// los bytes del modelo y del tokenizador salen de `/models/<id>/` del mismo origen y se verifican con SHA-256
// contra el manifiesto antes de crear la sesión (V-44). ORT-web se sirve desde `/ort/` con la ruta fijada antes
// del primer uso y sin proxy (V-09); no hay CDN.
import '../guard'; // Primer import: la guardia de 5.2.1 (PD-2-r1); su fetch acotado admite /ort/ y /models/.
import { GlinerEngine, type GlinerEngineDeps, type OrtModule } from '../core/ner/engine';
import { crearManejadorNer } from '../core/ner/handler';
import type { Fetcher } from '../core/ner/model-fetch';
import { SiglowError, type ModelManifest } from '../core/types';

// Política `default` de Trusted Types (3.6): ORT crea sus workers de hilos con una URL de cadena. Solo se admite
// el mismo protocolo y origen y las rutas /assets/ y /ort/ (la misma expresión que public/tt-policy.js, sin /sw.js; B-9).
try {
  const tt = (self as unknown as {
    trustedTypes?: { createPolicy(nombre: string, reglas: { createScriptURL(s: string): string }): unknown };
  }).trustedTypes;
  tt?.createPolicy('default', {
    createScriptURL(s: string): string {
      const u = new URL(s, self.location.href);
      if (u.protocol === self.location.protocol && u.origin === self.location.origin && /^\/(assets|ort)\//.test(u.pathname)
        && u.search === '' && u.hash === '') return u.href;   // B-40: sin query ni fragmento
      throw new TypeError('URL_NO_PERMITIDA');
    },
  });
} catch {
  // Ya existe la política (o el navegador no tiene Trusted Types): la CSP decide.
}

/** Descarga de una ruta del modelo en un búfer preasignado (sin `Blob` encadenados, que duplican la memoria). */
function fetcherDe(manifest: ModelManifest): Fetcher {
  return async (ruta, tamano, onBytes) => {
    // B-8: la URL normalizada debe seguir bajo /models/<id>/ del mismo origen (la ruta ya sale de una lista de rutas del
    // manifiesto validadas), sin query, y una redirección es un error: nunca se sigue a otra ruta.
    const url = new URL(`/models/${manifest.id}/${ruta}`, self.location.href);
    if (url.origin !== self.location.origin || url.search !== '' || !url.pathname.startsWith(`/models/${manifest.id}/`)) {
      throw new SiglowError('ENTRADA_INVALIDA');
    }
    const res = await fetch(url, { method: 'GET', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok || !res.body) throw new SiglowError('MODELO_NO_DESCARGADO');
    const bytes = new Uint8Array(tamano);
    const lector = res.body.getReader();
    let escrito = 0;
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      if (escrito + value.byteLength > tamano) throw new SiglowError('MODELO_INTEGRIDAD');
      bytes.set(value, escrito);
      escrito += value.byteLength;
      onBytes(escrito);
    }
    if (escrito !== tamano) throw new SiglowError('MODELO_INTEGRIDAD');
    return bytes;
  };
}

const rutaOrt = (nombre: string): string => new URL(`/ort/${nombre}`, self.location.href).href;

const cargarOrt = async (): Promise<OrtModule> => {
  // La condición de resolución `onnxruntime-web-use-extern-wasm` (vite.config.ts) elige el build sin el WebAssembly incrustado.
  const m = await import('onnxruntime-web/wasm');
  return m as unknown as OrtModule;
};

const manejar = crearManejadorNer({
  post: (msg) => self.postMessage(msg),
  // Sin WebAssembly (Edge con seguridad mejorada estricta, --jitless; T-ED-02) no hay motor: BACKEND_NO_DISPONIBLE antes de
  // pedir un solo byte del modelo, y la Revisión sigue con reglas y lista del caso.
  backendDisponible: () => typeof WebAssembly !== 'undefined',
  crearMotor: (manifest) => {
    const deps: GlinerEngineDeps = {
      loadOrt: cargarOrt,
      fetcher: fetcherDe(manifest),
      wasmPaths: { mjs: rutaOrt('ort-wasm-simd-threaded.mjs'), wasm: rutaOrt('ort-wasm-simd-threaded.wasm') },
      crossOriginIsolated: self.crossOriginIsolated === true,
    };
    return new GlinerEngine(manifest, deps);
  },
});

// Nada del documento llega a la consola (INV-W02): los errores no capturados se descartan sin registrarlos, y toda
// excepción del manejador se traduce a ERROR_INTERNO, sin mensaje ni pila (F-07).
self.addEventListener('error', (e) => e.preventDefault());
self.addEventListener('unhandledrejection', (e) => e.preventDefault());
self.addEventListener('message', (e: MessageEvent) => {
  try {
    manejar(e.data);
  } catch {
    self.postMessage({ v: 1, reqId: '', kind: 'error', code: 'ERROR_INTERNO', retryable: false });
  }
});
export {};
