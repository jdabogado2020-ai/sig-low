// Arnés de calibración y medición del modelo (PF-3). No es parte de la app. Expone `__cal` para que scripts/calibrar-modelo.ts
// lo maneje con Playwright: crea el worker de calibrar.worker.ts (el motor real con un número de hilos a elección) y mide
// el tiempo de PBKDF2 del navegador. Nada del documento sale de la página.
type Respuesta = { id: number; ok: boolean; [k: string]: unknown };

let worker: Worker | null = null;
let siguiente = 1;
const esperando = new Map<number, (r: Respuesta) => void>();

function pedir(msg: Record<string, unknown>): Promise<Respuesta> {
  if (!worker) throw new Error('sin worker');
  const id = siguiente++;
  return new Promise((resolver) => {
    esperando.set(id, resolver);
    worker?.postMessage({ ...msg, id });
  });
}

(globalThis as unknown as Record<string, unknown>)['__cal'] = {
  info: () => ({
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null,
    crossOriginIsolated,
    userAgent: navigator.userAgent,
    wasm: typeof WebAssembly === 'object' && typeof WebAssembly.Memory === 'function',
    sharedMemory: typeof SharedArrayBuffer === 'function',
  }),
  async iniciar(manifest: unknown, threads: number): Promise<Respuesta> {
    worker?.terminate();
    worker = new Worker(new URL('./calibrar.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<Respuesta>) => {
      const f = esperando.get(e.data.id);
      if (f) { esperando.delete(e.data.id); f(e.data); }
    });
    return pedir({ op: 'iniciar', manifest, threads });
  },
  partes: (partes: unknown, piso: number, etiquetas: string, solape?: number): Promise<Respuesta> =>
    pedir({ op: 'partes', partes, piso, etiquetas, solape }),
  async liberar(): Promise<void> {
    await pedir({ op: 'liberar' });
    worker?.terminate();
    worker = null;
  },
  /** Tiempo de PBKDF2-SHA-256 con una contraseña y sal ficticias (calibración de la bóveda, T-ED-01). */
  async pbkdf2(iteraciones: number): Promise<number> {
    const t0 = performance.now();
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode('clave-de-prueba'), 'PBKDF2', false, ['deriveBits']);
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(16), iterations: iteraciones }, base, 256);
    return performance.now() - t0;
  },
};
