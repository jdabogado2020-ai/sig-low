/**
 * T-PV-07 y T-AB-05 (parte PF-1b): `fetchVerificado` (V-44), configuración sin red de ORT-web (V-09), integridad al cargar y
 * humo de 5 frases (V-08) del `GlinerEngine`, con un ORT simulado y un tokenizador T5 simulado. Los manifiestos de 26 y 13
 * archivos, los trozos y la cuota son de PF-2. Datos ficticios.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GlinerEngine, HILOS_AISLADO, type GlinerEngineDeps, type OrtModule, type OrtSession } from '../../src/core/ner/engine';
import { createGlinerTokenizer } from '../../src/core/ner/gliner';
import { fetchVerificado, sha256Hex, type Fetcher } from '../../src/core/ner/model-fetch';
import { SiglowError, type ModelManifest, type NerLoadProgress } from '../../src/core/types';

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const TOKENIZER = enc('{"prueba":"tokenizer"}');
const CONFIG_TOK = enc('{"prueba":"config"}');
const CONFIG_GLINER = enc('{"prueba":"gliner"}');
const ONNX = new Uint8Array(4096).map((_, i) => i % 251);

function manifiesto(sobre: Partial<ModelManifest> = {}): ModelManifest {
  return {
    formato: 'sig-low/modelo', v: 1, id: 'gliner-x-base', origen: 'prueba', familia: 'gliner', base: 'google/mt5-base',
    cuantizacion: 'q8', etiquetas: ['person', 'organization', 'location'], umbral: 0.3, ventanaTokens: 512, solapePalabras: 37,
    maxTramoPalabras: 12, tokenizador: { prefijo: 0, sufijo: 1, cls: false }, archivo: 'onnx/model_quantized.onnx',
    tamano: ONNX.byteLength, sha256: sha(ONNX), trozos: [],
    auxiliares: [
      { ruta: 'tokenizer.json', tamano: TOKENIZER.byteLength, sha256: sha(TOKENIZER) },
      { ruta: 'tokenizer_config.json', tamano: CONFIG_TOK.byteLength, sha256: sha(CONFIG_TOK) },
      { ruta: 'gliner_config.json', tamano: CONFIG_GLINER.byteLength, sha256: sha(CONFIG_GLINER) },
    ],
    licencia: 'Apache-2.0', memoria: { wasmMb: 1, jsMb: 1, minimoDispositivoGb: 8 }, ...sobre,
  };
}

const ARCHIVOS: Record<string, Uint8Array> = {
  'tokenizer.json': TOKENIZER, 'tokenizer_config.json': CONFIG_TOK, 'gliner_config.json': CONFIG_GLINER, 'onnx/model_quantized.onnx': ONNX,
};
const fetcherBueno: Fetcher = (ruta, _t, onBytes) => {
  const b = ARCHIVOS[ruta];
  if (!b) return Promise.reject(new Error('404'));
  onBytes(b.byteLength);
  return Promise.resolve(b);
};
const codigo = async (p: Promise<unknown>): Promise<string> => {
  try { await p; return 'sin error'; } catch (e) { return e instanceof SiglowError ? e.code : `otro:${String(e)}`; }
};

describe('T-PV-07 · fetchVerificado (V-44)', () => {
  it('T-PV-07 devuelve los mismos bytes que verificó (un solo Uint8Array, sin copia)', async () => {
    const b = await fetchVerificado(manifiesto(), 'onnx/model_quantized.onnx', fetcherBueno);
    expect(b).toBe(ONNX);
    expect(await sha256Hex(b)).toBe(sha(ONNX));
  });
  it('T-PV-07 solo admite rutas del manifiesto', async () => {
    for (const ruta of ['../secreto', 'otro.bin', 'onnx/otro.onnx', '/models/gliner-x-base/tokenizer.json', 'tokenizer.json?x=1']) {
      expect(await codigo(fetchVerificado(manifiesto(), ruta, fetcherBueno))).toBe('ENTRADA_INVALIDA');
    }
  });
  it('T-PV-07 un SHA-256 distinto se rechaza con MODELO_INTEGRIDAD', async () => {
    expect(await codigo(fetchVerificado(manifiesto({ sha256: 'a'.repeat(64) }), 'onnx/model_quantized.onnx', fetcherBueno))).toBe('MODELO_INTEGRIDAD');
  });
  it('T-PV-07 un tamaño distinto (truncado) se rechaza con MODELO_INTEGRIDAD', async () => {
    const corto: Fetcher = () => Promise.resolve(ONNX.slice(0, 100));
    expect(await codigo(fetchVerificado(manifiesto(), 'onnx/model_quantized.onnx', corto))).toBe('MODELO_INTEGRIDAD');
  });
  it('T-PV-07 un byte alterado con el mismo tamaño se rechaza', async () => {
    const alterado = ONNX.slice();
    alterado[10] = (alterado[10]! + 1) % 256;
    expect(await codigo(fetchVerificado(manifiesto(), 'onnx/model_quantized.onnx', () => Promise.resolve(alterado)))).toBe('MODELO_INTEGRIDAD');
  });
  it('T-PV-07 un fallo de red sale como MODELO_NO_DESCARGADO, sin el texto de la excepción', async () => {
    const mal: Fetcher = () => Promise.reject(new Error('Ana Ficticia Rojas en la URL'));
    const e = await fetchVerificado(manifiesto(), 'tokenizer.json', mal).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SiglowError);
    expect((e as SiglowError).code).toBe('MODELO_NO_DESCARGADO');
    expect((e as SiglowError).message).toBe('MODELO_NO_DESCARGADO');
  });
});

describe('T-AB-05 · los dos archivos de ORT-web en public/ort son copia exacta de la dependencia fijada', () => {
  for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
    it(`T-AB-05 public/ort/${f}`, () => {
      const copia = readFileSync(join(process.cwd(), 'public/ort', f));
      const origen = readFileSync(join(process.cwd(), 'node_modules/onnxruntime-web/dist', f));
      expect(createHash('sha256').update(copia).digest('hex')).toBe(createHash('sha256').update(origen).digest('hex'));
    });
  }
});

// ---------------------------------------------------------------------------
// GlinerEngine con ORT simulado
// ---------------------------------------------------------------------------

const fakeT5 = {
  encode(text: string): { ids: number[] } {
    const ids: number[] = [];
    for (let i = 0; i < text.length; i += 3) ids.push(100 + (text.charCodeAt(i) % 500));
    return { ids: [...ids, 1] };
  },
};

interface Traza { eventos: string[]; feeds: Array<Record<string, { dims: readonly number[] }>>; modelo?: Uint8Array; liberada: boolean }

/** ORT simulado. `forma` decide los logits de cada ventana: 'entidades' pone un tramo cada 5 palabras; 'ceros' no pone ninguno. */
function ortSimulado(traza: Traza, forma: 'entidades' | 'ceros', entradas = ['input_ids', 'attention_mask', 'words_mask', 'text_lengths', 'span_idx', 'span_mask']): OrtModule {
  const env: OrtModule['env'] = { wasm: {} };
  const sesion: OrtSession = {
    inputNames: entradas,
    outputNames: ['logits'],
    run(feeds) {
      traza.feeds.push(feeds as never);
      const L = (feeds['text_lengths'] as unknown as { data: BigInt64Array }).data[0]!;
      const n = Number(L);
      const data = new Float32Array(n * 12 * 3).fill(-20);
      if (forma === 'entidades') for (let s = 0; s < n; s += 5) data[(s * 12) * 3] = 10;
      return Promise.resolve({ logits: { data } });
    },
    release() { traza.liberada = true; return Promise.resolve(); },
  };
  return {
    env,
    InferenceSession: {
      create(modelo) {
        traza.eventos.push(`create:hilos=${String(env.wasm.numThreads)}:proxy=${String(env.wasm.proxy)}:rutas=${JSON.stringify(env.wasm.wasmPaths)}`);
        traza.modelo = modelo;
        return Promise.resolve(sesion);
      },
    },
    Tensor: class { dims: readonly number[]; data: ArrayBufferView; constructor(public type: string, data: ArrayBufferView, dims: readonly number[]) { this.data = data; this.dims = dims; } } as never,
  };
}

function motor(forma: 'entidades' | 'ceros', sobre: Partial<GlinerEngineDeps> = {}, m: ModelManifest = manifiesto(), entradas?: string[]): { engine: GlinerEngine; traza: Traza; fases: NerLoadProgress['phase'][] } {
  const traza: Traza = { eventos: [], feeds: [], liberada: false };
  const deps: GlinerEngineDeps = {
    loadOrt: () => { traza.eventos.push('loadOrt'); return Promise.resolve(ortSimulado(traza, forma, entradas)); },
    fetcher: (ruta, t, onBytes) => { traza.eventos.push(`fetch:${ruta}`); return fetcherBueno(ruta, t, onBytes); },
    wasmPaths: { mjs: 'http://localhost/ort/ort-wasm-simd-threaded.mjs', wasm: 'http://localhost/ort/ort-wasm-simd-threaded.wasm' },
    crossOriginIsolated: true,
    createTokenizer: () => createGlinerTokenizer(fakeT5),
    ...sobre,
  };
  return { engine: new GlinerEngine(m, deps), traza, fases: [] };
}

describe('T-AB-05 · GlinerEngine: configuración sin red, integridad y humo (V-08, V-09, V-44)', () => {
  it('T-AB-05 carga: verifica antes de ORT, fija rutas locales, hilos y sin proxy antes de crear la sesión', async () => {
    const { engine, traza } = motor('entidades');
    const fases: string[] = [];
    const r = await engine.load((p) => { if (!fases.includes(p.phase)) fases.push(p.phase); });
    expect(fases).toEqual(['verificando', 'ensamblando', 'cargando_runtime', 'cargando_modelo', 'calentando']);
    const orden = traza.eventos;
    expect(orden.indexOf('loadOrt')).toBeGreaterThan(orden.indexOf('fetch:onnx/model_quantized.onnx'));
    const create = orden.find((e) => e.startsWith('create'))!;
    expect(create).toBe(
      `create:hilos=${HILOS_AISLADO}:proxy=false:rutas=${JSON.stringify({ mjs: 'http://localhost/ort/ort-wasm-simd-threaded.mjs', wasm: 'http://localhost/ort/ort-wasm-simd-threaded.wasm' })}`,
    );
    expect(traza.modelo).toBe(ONNX); // los bytes verificados son los que recibe ORT
    expect(r).toMatchObject({ engineId: 'gliner-x-base', decoder: 'gliner-spans', threads: 4, crossOriginIsolated: true, sha256: sha(ONNX), labels: ['PER', 'ORG', 'LOC'] });
    expect(r.warmupWindowMs).toBeGreaterThanOrEqual(0);
  });

  it('T-AB-05 sin crossOriginIsolated usa 1 hilo', async () => {
    const { engine } = motor('entidades', { crossOriginIsolated: false });
    expect((await engine.load(() => undefined)).threads).toBe(1);
  });

  it('T-AB-05 entradas del grafo: input_ids, attention_mask, words_mask, text_lengths, span_idx [1, L·12, 2] y span_mask [1, L·12]', async () => {
    const { engine, traza } = motor('entidades');
    await engine.load(() => undefined);
    const f = traza.feeds[0]!;
    expect(Object.keys(f).sort()).toEqual(['attention_mask', 'input_ids', 'span_idx', 'span_mask', 'text_lengths', 'words_mask']);
    const L = Number((f['text_lengths'] as unknown as { data: BigInt64Array }).data[0]);
    expect(f['span_idx']!.dims).toEqual([1, L * 12, 2]);
    expect(f['span_mask']!.dims).toEqual([1, L * 12]);
    expect(f['text_lengths']!.dims).toEqual([1, 1]);
    expect(f['input_ids']!.dims[1]).toBe(f['words_mask']!.dims[1]);
  });

  it('T-AB-05 el humo de 5 frases rechaza un modelo que no detecta nada y libera la sesión (V-08)', async () => {
    const { engine, traza } = motor('ceros');
    expect(await codigo(engine.load(() => undefined))).toBe('MODELO_INTEGRIDAD');
    expect(traza.liberada).toBe(true);
    await expect(engine.detect('Ana', { windowTokens: 512, overlapWords: 37, maxSpanWords: 12, threshold: 0.3, labels: ['person', 'organization', 'location'], threads: 1 }, new AbortController().signal)).rejects.toBeInstanceOf(SiglowError);
  });

  it('T-AB-05 un grafo sin span_idx se rechaza con MODELO_INTEGRIDAD', async () => {
    const { engine, traza } = motor('entidades', {}, manifiesto(), ['input_ids', 'attention_mask']);
    expect(await codigo(engine.load(() => undefined))).toBe('MODELO_INTEGRIDAD');
    expect(traza.liberada).toBe(true);
  });

  it('T-AB-05 el SHA-256 del modelo o de un auxiliar distinto se rechaza antes de crear la sesión', async () => {
    const a = motor('entidades', {}, manifiesto({ sha256: 'b'.repeat(64) }));
    expect(await codigo(a.engine.load(() => undefined))).toBe('MODELO_INTEGRIDAD');
    expect(a.traza.eventos.some((e) => e.startsWith('create') || e === 'loadOrt')).toBe(false);
    const m = manifiesto();
    const b = motor('entidades', {}, { ...m, auxiliares: m.auxiliares.map((x) => (x.ruta === 'tokenizer.json' ? { ...x, sha256: 'c'.repeat(64) } : x)) });
    expect(await codigo(b.engine.load(() => undefined))).toBe('MODELO_INTEGRIDAD');
    expect(b.traza.eventos.some((e) => e.startsWith('create'))).toBe(false);
  });

  it('T-AB-05 el parche medido debe coincidir con el manifiesto (tokenizador mT5: 0 / 1 / false)', async () => {
    const { engine } = motor('entidades', {}, manifiesto({ tokenizador: { prefijo: 1, sufijo: 1, cls: true } }));
    expect(await codigo(engine.load(() => undefined))).toBe('MODELO_INTEGRIDAD');
  });

  it('T-AB-05 una sesión que no se puede crear (ONNX malformado) sale como MODELO_INTEGRIDAD, sin su texto', async () => {
    const { engine } = motor('entidades', {
      loadOrt: () => Promise.resolve({
        ...ortSimulado({ eventos: [], feeds: [], liberada: false }, 'entidades'),
        InferenceSession: { create: () => Promise.reject(new Error('protobuf parsing failed: Ana Ficticia')) },
      }),
    });
    const e = await engine.load(() => undefined).catch((x: unknown) => x);
    expect((e as SiglowError).code).toBe('MODELO_INTEGRIDAD');
    expect((e as SiglowError).message).not.toContain('Ana');
  });

  it('T-AB-05 planWindows cuenta ventanas sin ejecutar el modelo; dispose libera la sesión', async () => {
    const { engine, traza } = motor('entidades');
    await engine.load(() => undefined);
    const opciones = { windowTokens: 512, overlapWords: 37, maxSpanWords: 12 as const, threshold: 0.3, labels: ['person', 'organization', 'location'] as const, threads: 4 };
    const antes = traza.feeds.length;
    expect(engine.planWindows('', opciones)).toBe(0);
    expect(engine.planWindows('Ana Prueba vive en Villa Ejemplo.', opciones)).toBe(1);
    expect(engine.planWindows(Array.from({ length: 600 }, () => 'Ana').join(' '), opciones)).toBeGreaterThan(1);
    expect(traza.feeds.length).toBe(antes);
    await engine.dispose();
    expect(traza.liberada).toBe(true);
  });
});
