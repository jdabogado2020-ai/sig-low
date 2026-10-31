// Worker del arnés de calibración (PF-3). NO es parte de la app: reutiliza el motor real (GlinerEngine) con el número de hilos
// que pide el script y deja medir la salida por ventana, la latencia y la memoria. Para la prueba de etiquetas usa la misma
// sesión del motor con otras listas de etiquetas (mismo procesador, mismo decodificador, mismas ventanas con zona propia).
// Los resultados llevan posiciones, etiquetas y puntajes, nunca texto del documento.
import { GlinerEngine, type GlinerEngineDeps, type OrtModule, type OrtSession } from '../../../src/core/ner/engine';
import {
  buildSpans, countSubtokens, detectByWindows, encodeWindow, reservedTokens, spanCandidatesFromLogits,
  type GlinerLabel, type GlinerTokenizer, type SpanCandidate, type WindowScoringInput,
} from '../../../src/core/ner/gliner';
import type { Fetcher } from '../../../src/core/ner/model-fetch';
import type { ModelManifest, NerOptions, NerSpan } from '../../../src/core/types';

// Política `default` de Trusted Types (la misma que ner.worker.ts): ORT crea sus workers de hilos con una URL de cadena.
try {
  const tt = (self as unknown as {
    trustedTypes?: { createPolicy(nombre: string, reglas: { createScriptURL(s: string): string }): unknown };
  }).trustedTypes;
  tt?.createPolicy('default', {
    createScriptURL(s: string): string {
      const u = new URL(s, self.location.href);
      if (u.origin === self.location.origin && /^\/(assets|ort)\//.test(u.pathname)) return u.href;
      throw new TypeError('URL_NO_PERMITIDA');
    },
  });
} catch {
  // Ya existe la política.
}

// Registro de las memorias de WebAssembly (suma de bytes = memoria lineal del runtime, con el modelo dentro).
const memorias: WebAssembly.Memory[] = [];
// Sin JIT (--jitless) el navegador no define WebAssembly: el arnés debe llegar igual hasta el error del motor (T-ED-02).
if (typeof WebAssembly !== 'undefined') {
  const MemoriaOriginal = WebAssembly.Memory;
  (WebAssembly as unknown as { Memory: unknown }).Memory = new Proxy(MemoriaOriginal, {
    construct(objetivo, args, nuevo) {
      const m = Reflect.construct(objetivo, args, nuevo) as WebAssembly.Memory;
      memorias.push(m);
      return m;
    },
  });
}
const bytesWasm = (): number => memorias.reduce((a, m) => a + m.buffer.byteLength, 0);
const heapJs = (): number => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
let picoWasm = 0;
let picoJs = 0;
const muestrear = (): void => { picoWasm = Math.max(picoWasm, bytesWasm()); picoJs = Math.max(picoJs, heapJs()); };

function fetcherDe(manifest: ModelManifest): Fetcher {
  return async (ruta, tamano, onBytes) => {
    const res = await fetch(new URL(`/models/${manifest.id}/${ruta}`, self.location.href));
    if (!res.ok || !res.body) throw new Error('descarga');
    const bytes = new Uint8Array(tamano);
    const lector = res.body.getReader();
    let escrito = 0;
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      bytes.set(value, escrito);
      escrito += value.byteLength;
      onBytes(escrito);
    }
    if (escrito !== tamano) throw new Error('tamano');
    return bytes;
  };
}
const rutaOrt = (nombre: string): string => new URL(`/ort/${nombre}`, self.location.href).href;

interface InternoMotor { session: OrtSession; ort: OrtModule; tokenizer: GlinerTokenizer }

let motor: GlinerEngine | null = null;
let manifiesto: ModelManifest | null = null;

/** Variantes de etiquetas de T-AB-03 (a): `mapa` da el nombre canónico de cada etiqueta pedida; las demás compiten como `otro`. */
const VARIANTES: Record<string, { prompt: string[]; mapa: string[] }> = {
  estandar: { prompt: ['person', 'organization', 'location'], mapa: ['person', 'organization', 'location'] },
  traducidas: { prompt: ['persona', 'organización', 'ubicación'], mapa: ['person', 'organization', 'location'] },
  nueve: {
    prompt: ['person', 'organization', 'location', 'address', 'identity document number', 'phone number', 'email', 'medical condition', 'bank account number'],
    mapa: ['person', 'organization', 'location', 'otro', 'otro', 'otro', 'otro', 'otro', 'otro'],
  },
};

async function puntuarConEtiquetas(input: WindowScoringInput, variante: { prompt: string[]; mapa: string[] }): Promise<SpanCandidate[]> {
  const { session, ort, tokenizer } = motor as unknown as InternoMotor;
  const etiquetas = variante.prompt as unknown as readonly GlinerLabel[];
  const enc = encodeWindow(tokenizer, input.wordTexts, etiquetas, input.maxSubtokensPerWord);
  const L = enc.textLength;
  if (L === 0) return [];
  const int64 = (v: readonly number[]): BigInt64Array => BigInt64Array.from(v, BigInt);
  const { spanIdx, spanMask } = buildSpans(L, 12);
  const T = ort.Tensor;
  const largo = enc.inputIds.length;
  const salida = await session.run({
    input_ids: new T('int64', int64(enc.inputIds), [1, largo]),
    attention_mask: new T('int64', int64(enc.attentionMask), [1, largo]),
    words_mask: new T('int64', int64(enc.wordsMask), [1, largo]),
    text_lengths: new T('int64', int64([L]), [1, 1]),
    span_idx: new T('int64', int64(spanIdx.flat()), [1, spanIdx.length, 2]),
    span_mask: new T('bool', Uint8Array.from(spanMask, (k) => (k ? 1 : 0)), [1, spanMask.length]),
  });
  const nombre = session.outputNames[0];
  const logits = nombre === undefined ? undefined : salida[nombre]?.data;
  if (!logits || logits.length !== L * 12 * etiquetas.length) throw new Error('logits');
  const candidatos = spanCandidatesFromLogits(logits, L, 12, variante.mapa as unknown as readonly GlinerLabel[]);
  if (L === input.wordTexts.length) return candidatos;
  const traducidos: SpanCandidate[] = [];
  for (const c of candidatos) {
    const s = enc.modelWordToWindowWord[c.s];
    const e = enc.modelWordToWindowWord[c.s + c.w - 1];
    if (s === undefined || e === undefined || e - s + 1 > 12) continue;
    traducidos.push({ ...c, s, w: e - s + 1 });
  }
  return traducidos;
}

interface VentanaOut { parte: string; i: number; n: number; ms: number; spans: Array<[number, number, string, number]> }
const redondear = (x: number): number => Math.round(x * 1e6) / 1e6;
const abreviar = (s: NerSpan): [number, number, string, number] => [s.start, s.end, s.label, redondear(s.score)];

type Peticion =
  | { op: 'iniciar'; id: number; manifest: ModelManifest; threads: number }
  | { op: 'partes'; id: number; partes: Array<{ clave: string; texto: string }>; piso: number; etiquetas: string; ventanaTokens?: number; solape?: number }
  | { op: 'liberar'; id: number };

const responder = (m: Record<string, unknown>): void => self.postMessage(m);

async function atender(p: Peticion): Promise<void> {
  if (p.op === 'iniciar') {
    manifiesto = p.manifest;
    const deps: GlinerEngineDeps = {
      loadOrt: async () => (await import('onnxruntime-web/wasm')) as unknown as OrtModule,
      fetcher: fetcherDe(p.manifest),
      wasmPaths: { mjs: rutaOrt('ort-wasm-simd-threaded.mjs'), wasm: rutaOrt('ort-wasm-simd-threaded.wasm') },
      crossOriginIsolated: self.crossOriginIsolated === true,
      threads: p.threads,
    };
    motor = new GlinerEngine(p.manifest, deps);
    const t0 = performance.now();
    const fases: Record<string, number> = {};
    const carga = await motor.load((f) => { fases[f.phase] = performance.now() - t0; muestrear(); });
    muestrear();
    responder({ id: p.id, ok: true, carga, cargaTotalMs: performance.now() - t0, fases, wasmBytes: bytesWasm(), picoWasm, picoJs });
    return;
  }
  if (p.op === 'partes') {
    if (!motor || !manifiesto) throw new Error('sin motor');
    const m = manifiesto;
    const opciones: NerOptions = {
      windowTokens: m.ventanaTokens, overlapWords: p.solape ?? m.solapePalabras, maxSpanWords: 12, threshold: p.piso,
      labels: m.etiquetas, threads: 0,
    };
    const ventanas: VentanaOut[] = [];
    const variante = VARIANTES[p.etiquetas];
    if (!variante) throw new Error('variante');
    const ac = new AbortController();
    const t0 = performance.now();
    for (const parte of p.partes) {
      const alVentana = (w: { windowIndex: number; windowTotal: number; ms: number; spans: NerSpan[] }): void => {
        muestrear();
        ventanas.push({ parte: parte.clave, i: w.windowIndex, n: w.windowTotal, ms: Math.round(w.ms * 10) / 10,
          spans: w.spans.filter((s) => s.label !== undefined).map(abreviar) });
      };
      if (p.etiquetas === 'estandar') {
        await motor.detect(parte.texto, opciones, ac.signal, (w) => alVentana(w));
      } else {
        const { tokenizer } = motor as unknown as InternoMotor;
        const reservado = reservedTokens(tokenizer, variante.prompt as unknown as readonly GlinerLabel[]);
        await detectByWindows({
          text: parte.texto, options: opciones, reserved: reservado,
          countSubtokens: (w) => countSubtokens(tokenizer, w), signal: ac.signal, now: () => performance.now(),
          scoreWindow: (input) => puntuarConEtiquetas(input, variante), onWindow: (w) => alVentana(w),
        });
      }
    }
    responder({ id: p.id, ok: true, ventanas, totalMs: Math.round(performance.now() - t0), wasmBytes: bytesWasm(), picoWasm, picoJs });
    return;
  }
  if (motor) await motor.dispose();
  motor = null;
  responder({ id: p.id, ok: true });
}

self.addEventListener('error', (e) => e.preventDefault());
self.addEventListener('message', (e: MessageEvent<Peticion>) => {
  void atender(e.data).catch((err: unknown) => {
    // Solo la clase del error: el texto del mensaje podría contener contenido (F-07).
    const codigo = (err as { code?: unknown } | null)?.code;
    responder({ id: e.data.id, ok: false, error: typeof codigo === 'string' && /^[A-Z_]+$/.test(codigo) ? codigo : err instanceof Error ? err.name : 'desconocido' });
  });
});
export {};
