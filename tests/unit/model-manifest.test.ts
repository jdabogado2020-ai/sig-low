/**
 * T-PV-07 y T-AB-05 (parte PF-1b): `fetchVerificado` (V-44), configuración sin red de ORT-web (V-09), integridad al cargar y
 * humo de 5 frases (V-08) del `GlinerEngine`, con un ORT simulado y un tokenizador T5 simulado. Los manifiestos de 26 y 13
 * archivos, los trozos y la cuota son de PF-2. Datos ficticios.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GlinerEngine, HILOS_AISLADO, HILOS_MAXIMO, hilosAislado, type GlinerEngineDeps, type OrtModule, type OrtSession } from '../../src/core/ner/engine';
import { createGlinerTokenizer } from '../../src/core/ner/gliner';
import { decidirFallo, entregarModelo, ordenDeVariantes, trozosEnOrden, type PuertosEntrega } from '../../src/core/ner/entrega';
import { crearManejadorNer } from '../../src/core/ner/handler';
import {
  esManifiesto, MAX_ARCHIVO_DIST, MAX_TROZO, mbDelManifiesto, RUTA_AUXILIAR, RUTA_ONNX, RUTA_TROZO, validarEntrega, type IdModelo,
} from '../../src/core/ner/manifest';
import { fetchVerificado, sha256Hex, type Fetcher } from '../../src/core/ner/model-fetch';
import { clasificar } from '../../vite-plugins/precache';
import { SiglowError, type ModelManifest, type NerEngine, type NerLoadProgress, type NerResponse } from '../../src/core/types';

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

// ---------------------------------------------------------------------------
// PF-2 · entrega del modelo (3.3): manifiestos, trozos, cuota, respaldo automático, integridad y reensamblado
// ---------------------------------------------------------------------------

describe('T-PV-07 · manifiestos del modelo versionados (principal: 25 trozos; respaldo: 13)', () => {
  const leer = (id: string): ModelManifest => JSON.parse(readFileSync(join('public', 'models', id, 'manifest.json'), 'utf8')) as ModelManifest;
  const GRANDE = leer('gliner-x-large');
  const BASE = leer('gliner-x-base');

  it('T-PV-07 ambos pasan la validación estricta de la entrega', () => {
    expect(esManifiesto(GRANDE) && validarEntrega(GRANDE)).toBe(true);
    expect(esManifiesto(BASE) && validarEntrega(BASE)).toBe(true);
  });
  it('T-PV-07 principal: 25 trozos (24 de 25.165.824 B y uno de 6.142.624 B), 610.122.400 B, SHA-256 fijado en H0-5/H0-6', () => {
    expect(GRANDE.trozos).toHaveLength(25);
    expect(GRANDE.trozos.slice(0, 24).every((t) => t.tamano === 25_165_824)).toBe(true);
    expect(GRANDE.trozos[24]!.tamano).toBe(6_142_624);
    expect(GRANDE.tamano).toBe(610_122_400);
    expect(GRANDE.sha256).toBe('90a7d3b8bf985da65748f0b1972bd6696bab34f375f23ad4f4a60ac14842ad2c');
    expect(GRANDE.auxiliares.map((a) => a.ruta)).toEqual(['tokenizer.json', 'tokenizer_config.json']);
    expect(GRANDE.auxiliares[0]).toMatchObject({ tamano: 16_350_298, sha256: '644a91650f64b0fe5974cefcd293bafa754f014f8f72503ae7940ae652d22b2f' });
    expect(mbDelManifiesto(GRANDE)).toBe(626);
  });
  it('T-PV-07 respaldo: 13 trozos (12 de 25.165.824 B y uno de 656.414 B), 302.646.302 B', () => {
    expect(BASE.trozos).toHaveLength(13);
    expect(BASE.trozos.slice(0, 12).every((t) => t.tamano === 25_165_824)).toBe(true);
    expect(BASE.trozos[12]!.tamano).toBe(656_414);
    expect(BASE.tamano).toBe(302_646_302);
    expect(BASE.sha256).toBe('9850feb5ecd7ccfa3e4f1802b7c7d404f1b357cb7b6198cc014fb441e91ace43');
    expect(mbDelManifiesto(BASE)).toBe(319);
  });
  it('T-PV-07 ningún archivo de public/models ni trozo pasa de 25 MiB; los trozos son de ≤ 24 MiB', () => {
    for (const m of [GRANDE, BASE]) {
      for (const t of m.trozos) expect(t.tamano).toBeLessThanOrEqual(MAX_TROZO);
      for (const a of m.auxiliares) expect(a.tamano).toBeLessThanOrEqual(MAX_ARCHIVO_DIST);
    }
    const pesados: string[] = [];
    const recorrer = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) recorrer(p);
        else if (statSync(p).size > MAX_ARCHIVO_DIST) pesados.push(p);
      }
    };
    recorrer(join('public', 'models'));
    expect(pesados).toEqual([]);
  });
  it('T-PV-07 manifiestos alterados no son válidos: suma distinta, hueco en la numeración, trozo de menos, base de otro id, auxiliar de menos', () => {
    const clon = (): ModelManifest => structuredClone(BASE);
    const a = clon(); a.trozos[5]!.tamano -= 1;
    const b = clon(); b.trozos[3]!.ruta = 'onnx/model_quantized.onnx.part004';
    const c = clon(); c.trozos.pop();
    const d = clon(); d.base = 'google/mt5-large';
    const e = clon(); e.auxiliares = e.auxiliares.filter((x) => x.ruta !== 'tokenizer_config.json');
    const f = clon(); f.trozos[0]!.tamano = 25_165_825;
    for (const m of [a, b, c, d, e, f]) expect(validarEntrega(m)).toBe(false);
  });
  it('T-PV-07 las regexes y los límites del service worker son los de src/core/ner/manifest.ts (sw.js no puede importarlos)', () => {
    const sw = readFileSync(join('src', 'sw.ts'), 'utf8');
    const de = (nombre: string): string => new RegExp(`const ${nombre} = /(.*)/;`).exec(sw)?.[1] ?? 'no está';
    expect(de('RUTA_AUXILIAR')).toBe(RUTA_AUXILIAR.source);
    expect(de('RUTA_TROZO')).toBe(RUTA_TROZO.source);
    expect(sw).toContain(`const MAX_TROZO = ${String(MAX_TROZO).replace(/(\d)(?=(\d{3})+$)/g, '$1_')};`);
    expect(sw).toContain(`const ONNX = '${RUTA_ONNX}';`);
  });
  it('T-PV-07 el .gitignore de la raíz deja fuera trozos y auxiliares y conserva los manifiestos (y no queda un .gitignore dentro de public/models)', () => {
    const g = readFileSync('.gitignore', 'utf8').split(/\r?\n/).map((l) => l.trim());
    expect(g).toContain('public/models/*/*');
    expect(g).toContain('!public/models/*/manifest.json');
    expect(readdirSync(join('public', 'models')).filter((n) => n.startsWith('.'))).toEqual([]);
  });
  it('T-PV-07 clasificar(): solo los manifiestos del modelo entran al precache; trozos y auxiliares quedan fuera; lo demás detiene el build', () => {
    expect(clasificar('models/gliner-x-large/manifest.json')).toBe('precache');
    expect(clasificar('models/gliner-x-base/manifest.json')).toBe('precache');
    expect(clasificar('models/gliner-x-large/onnx/model_quantized.onnx.part003')).toBe('fuera');
    expect(clasificar('models/gliner-x-base/tokenizer.json')).toBe('fuera');
    expect(clasificar('models/gliner-x-base/onnx/model_quantized.onnx')).toBeNull();
    expect(clasificar('models/otro/manifest.json')).toBeNull();
    expect(clasificar('models/gliner-x-base/gliner_config.json')).toBeNull();
  });
});

describe('T-AB-05 · B-8: el manifiesto que llega al worker se valida por completo', () => {
  const pedir = async (m: unknown): Promise<NerResponse> => {
    const salida: NerResponse[] = [];
    const h = crearManejadorNer({ post: (x) => salida.push(x), crearMotor: () => { throw new Error('no debe crearse'); } });
    h({ v: 1, reqId: 'r1', kind: 'cargar', payload: { manifest: m } });
    for (let i = 0; i < 100 && salida.length === 0; i += 1) await new Promise((r) => setTimeout(r, 5));
    return salida[0]!;
  };
  it('T-AB-05 una ruta auxiliar con ../ o fuera de las tres permitidas es ENTRADA_INVALIDA', async () => {
    for (const ruta of ['../x.json', '../../ort/ort-wasm-simd-threaded.mjs', 'otro.json', 'onnx/../tokenizer.json', 'tokenizer.json?x=1']) {
      const m = manifiesto();
      m.auxiliares = [{ ruta: ruta as 'tokenizer.json', tamano: 3, sha256: sha(enc('x')) }];
      expect(await pedir(m)).toMatchObject({ kind: 'error', code: 'ENTRADA_INVALIDA' });
    }
  });
  it('T-AB-05 tamano no entero o < 1 y sha256 que no es de 64 hexadecimales en minúsculas son ENTRADA_INVALIDA', async () => {
    const casos: Array<(m: ModelManifest) => void> = [
      (m) => { m.auxiliares[0]!.tamano = 0; },
      (m) => { m.auxiliares[0]!.tamano = 1.5; },
      (m) => { m.auxiliares[0]!.sha256 = 'abc'; },
      (m) => { m.auxiliares[0]!.sha256 = sha(enc('x')).toUpperCase(); },
      (m) => { m.sha256 = 'zz'.repeat(32); },
      (m) => { m.trozos = [{ ruta: '../onnx/model_quantized.onnx.part000', tamano: 4, sha256: sha(enc('x')) }]; },
    ];
    for (const caso of casos) {
      const m = manifiesto();
      caso(m);
      expect(await pedir(m)).toMatchObject({ kind: 'error', code: 'ENTRADA_INVALIDA' });
    }
  });
});

describe('T-ED-02 · sin WebAssembly: BACKEND_NO_DISPONIBLE antes de tocar el modelo', () => {
  it('T-ED-02 con backendDisponible() = false, cargar termina con BACKEND_NO_DISPONIBLE, sin crear el motor ni pedir nada', async () => {
    const salida: NerResponse[] = [];
    let motores = 0;
    const h = crearManejadorNer({ post: (x) => salida.push(x), crearMotor: () => { motores += 1; throw new Error('no debe crearse'); }, backendDisponible: () => false });
    h({ v: 1, reqId: 'r1', kind: 'cargar', payload: { manifest: manifiesto() } });
    for (let i = 0; i < 100 && salida.length === 0; i += 1) await new Promise((r) => setTimeout(r, 5));
    expect(motores).toBe(0);
    expect(salida).toEqual([{ v: 1, reqId: 'r1', kind: 'error', code: 'BACKEND_NO_DISPONIBLE', retryable: false }]);
  });
  it('T-ED-02 con WebAssembly disponible el motor se crea y carga', async () => {
    const salida: NerResponse[] = [];
    let motores = 0;
    const motor = { engineId: 'gliner-x-base', load: () => Promise.resolve({ engineId: 'gliner-x-base' }), dispose: () => Promise.resolve() } as unknown as NerEngine;
    const h = crearManejadorNer({ post: (x) => salida.push(x), crearMotor: () => { motores += 1; return motor; }, backendDisponible: () => true });
    h({ v: 1, reqId: 'r1', kind: 'cargar', payload: { manifest: manifiesto() } });
    for (let i = 0; i < 100 && !salida.some((s) => s.kind === 'resultado'); i += 1) await new Promise((r) => setTimeout(r, 5));
    expect(motores).toBe(1);
    expect(salida.at(-1)).toMatchObject({ kind: 'resultado' });
  });
  it('T-ED-02 el worker pasa typeof WebAssembly como backendDisponible (la comprobación vive en ner.worker.ts)', () => {
    expect(readFileSync(join('src', 'workers', 'ner.worker.ts'), 'utf8')).toContain("backendDisponible: () => typeof WebAssembly !== 'undefined'");
  });
  it('T-ED-02 decidirFallo: sin backend → plan B (fallo_carga) sin descartar el modelo ni probar el respaldo', () => {
    expect(decidirFallo('BACKEND_NO_DISPONIBLE', false)).toEqual({ causa: 'fallo_carga', probarRespaldo: false, descartar: false });
  });
});

// --- Entrega con puertos simulados -------------------------------------------------------------------------------------------

function manifiestoReal(id: IdModelo): ModelManifest {
  return JSON.parse(readFileSync(join('public', 'models', id, 'manifest.json'), 'utf8')) as ModelManifest;
}

interface Registro { descargas: string[]; borrados: string[]; persistencias: number; respaldos: string[]; avances: number[] }
function puertosSimulados(sobre: Partial<PuertosEntrega> & { falla?: (id: IdModelo, ruta: string) => Error | null } = {}): { p: PuertosEntrega; r: Registro } {
  const r: Registro = { descargas: [], borrados: [], persistencias: 0, respaldos: [], avances: [] };
  const { falla, ...resto } = sobre;
  const p: PuertosEntrega = {
    manifiesto: (id) => Promise.resolve(manifiestoReal(id)),
    descargarArchivo: (id, ruta, onBytes) => {
      const x = falla?.(id, ruta);
      if (x) return Promise.reject(x);
      r.descargas.push(`${id}/${ruta}`);
      onBytes(1);
      return Promise.resolve();
    },
    borrar: (id) => { r.borrados.push(id); return Promise.resolve(); },
    cuota: () => Promise.resolve(null),
    persistir: () => { r.persistencias += 1; return Promise.resolve(true); },
    ...resto,
  };
  return { p, r };
}
const ENTRADA = (memoriaGb: number | null, r?: Registro, senal: AbortSignal = new AbortController().signal) => ({
  memoriaGb, senal, alAvance: (a: { hechoBytes: number }) => { r?.avances.push(a.hechoBytes); }, alRespaldo: (m: string) => { r?.respaldos.push(m); },
});
const CUOTA_LLENA = (): SiglowError => new SiglowError('CUOTA_EXCEDIDA');

describe('T-AB-05 · entrega del modelo: variantes, cuota y respaldo automático (3.3)', () => {
  it('T-AB-05 el orden de variantes: deviceMemory < 8 → solo el respaldo; ≥ 8 o desconocida → principal y respaldo', () => {
    expect(ordenDeVariantes(4)).toEqual(['gliner-x-base']);
    expect(ordenDeVariantes(7.9)).toEqual(['gliner-x-base']);
    expect(ordenDeVariantes(8)).toEqual(['gliner-x-large', 'gliner-x-base']);
    expect(ordenDeVariantes(null)).toEqual(['gliner-x-large', 'gliner-x-base']);
  });
  it('T-AB-05 principal: pide los 2 auxiliares y los 25 trozos, uno tras otro, y al final pide persist()', async () => {
    const { p, r } = puertosSimulados();
    const res = await entregarModelo(p, ENTRADA(16, r));
    expect(res).toEqual({ tipo: 'listo', id: 'gliner-x-large', respaldo: false, persistido: true });
    expect(r.descargas).toHaveLength(27);
    expect(r.descargas.slice(0, 2)).toEqual(['gliner-x-large/tokenizer.json', 'gliner-x-large/tokenizer_config.json']);
    expect(r.descargas[26]).toBe('gliner-x-large/onnx/model_quantized.onnx.part024');
    expect(r.persistencias).toBe(1);
    expect(r.borrados).toEqual([]);
  });
  it('T-AB-05 deviceMemory < 8 elige el respaldo desde el principio (13 trozos + 2 auxiliares) y lo avisa', async () => {
    const { p, r } = puertosSimulados();
    const res = await entregarModelo(p, ENTRADA(4, r));
    expect(res).toMatchObject({ tipo: 'listo', id: 'gliner-x-base', respaldo: true });
    expect(r.descargas).toHaveLength(15);
    expect(r.descargas.every((d) => d.startsWith('gliner-x-base/'))).toBe(true);
    expect(r.respaldos).toEqual(['memoria_del_equipo']);
  });
  it('T-AB-05 cuota simulada insuficiente para el principal (estimate) → respaldo, sin tocar la red con el principal', async () => {
    const { p, r } = puertosSimulados({ cuota: () => Promise.resolve({ cuota: 400_000_000, uso: 10_000_000 }) });
    const res = await entregarModelo(p, ENTRADA(16, r));
    expect(res).toMatchObject({ tipo: 'listo', id: 'gliner-x-base', respaldo: true });
    expect(r.descargas.every((d) => d.startsWith('gliner-x-base/'))).toBe(true);
    expect(r.respaldos).toEqual(['sin_espacio']);
  });
  it('T-AB-05 QuotaExceededError a mitad del principal → se borran los parciales y se descarga el respaldo', async () => {
    const { p, r } = puertosSimulados({ falla: (id, ruta) => (id === 'gliner-x-large' && ruta.endsWith('part010') ? CUOTA_LLENA() : null) });
    const res = await entregarModelo(p, ENTRADA(16, r));
    expect(res).toMatchObject({ tipo: 'listo', id: 'gliner-x-base', respaldo: true });
    expect(r.borrados).toEqual(['gliner-x-large']);
    expect(r.descargas.filter((d) => d.startsWith('gliner-x-large/'))).toHaveLength(2 + 10);
    expect(r.respaldos).toEqual(['sin_espacio']);
  });
  it('T-AB-05 una excepción del navegador con name QuotaExceededError también cuenta como cuota', async () => {
    const e = new Error('texto que no debe salir');
    e.name = 'QuotaExceededError';
    const { p } = puertosSimulados({ falla: (id) => (id === 'gliner-x-large' ? e : null) });
    expect(await entregarModelo(p, ENTRADA(16))).toMatchObject({ tipo: 'listo', id: 'gliner-x-base' });
  });
  it('T-AB-05 si tampoco cabe el respaldo → plan B (espacio), con los parciales de ambos borrados', async () => {
    const { p, r } = puertosSimulados({ falla: (_id, ruta) => (ruta.endsWith('part003') ? CUOTA_LLENA() : null) });
    const res = await entregarModelo(p, ENTRADA(16, r));
    expect(res).toEqual({ tipo: 'plan_b', causa: 'espacio', codigo: 'CUOTA_EXCEDIDA' });
    expect(r.borrados).toEqual(['gliner-x-large', 'gliner-x-base']);
    expect(r.persistencias).toBe(0);
  });
  it('T-AB-05 con el respaldo forzado por la memoria, si no cabe → plan B (espacio)', async () => {
    const { p, r } = puertosSimulados({ cuota: () => Promise.resolve({ cuota: 100, uso: 0 }) });
    expect(await entregarModelo(p, ENTRADA(4, r))).toEqual({ tipo: 'plan_b', causa: 'espacio', codigo: 'CUOTA_EXCEDIDA' });
    expect(r.descargas).toEqual([]);
  });
});

describe('T-PV-08 · un trozo alterado → MODELO_INTEGRIDAD y plan B con aviso (V-44)', () => {
  it('T-PV-08 MODELO_INTEGRIDAD en un trozo: se borran los parciales y NO se prueba el respaldo', async () => {
    const { p, r } = puertosSimulados({ falla: (_id, ruta) => (ruta.endsWith('part007') ? new SiglowError('MODELO_INTEGRIDAD') : null) });
    const res = await entregarModelo(p, ENTRADA(16, r));
    expect(res).toEqual({ tipo: 'plan_b', causa: 'integridad', codigo: 'MODELO_INTEGRIDAD' });
    expect(r.borrados).toEqual(['gliner-x-large']);
    expect(r.descargas.some((d) => d.startsWith('gliner-x-base/'))).toBe(false);
    expect(r.persistencias).toBe(0);
  });
  it('T-PV-08 un auxiliar alterado (el primero que se pide) también es integridad', async () => {
    const { p, r } = puertosSimulados({ falla: (_id, ruta) => (ruta === 'tokenizer.json' ? new SiglowError('MODELO_INTEGRIDAD') : null) });
    expect(await entregarModelo(p, ENTRADA(16, r))).toMatchObject({ tipo: 'plan_b', causa: 'integridad' });
    expect(r.descargas).toEqual([]);
  });
  it('T-PV-08 red caída: plan B (red) con MODELO_NO_DESCARGADO y los parciales borrados; una excepción con texto sale sin él', async () => {
    const { p, r } = puertosSimulados({ falla: (_id, ruta) => (ruta.endsWith('part002') ? new Error('GET /models/x falló: Ana Ficticia') : null) });
    const res = await entregarModelo(p, ENTRADA(16, r));
    expect(res).toEqual({ tipo: 'plan_b', causa: 'red', codigo: 'MODELO_NO_DESCARGADO' });
    expect(JSON.stringify(res)).not.toContain('Ana');
    expect(r.borrados).toEqual(['gliner-x-large']);
  });
  it('T-PV-08 sin manifiesto (precache incompleto) → plan B (red), sin descargar nada', async () => {
    const { p, r } = puertosSimulados({ manifiesto: () => Promise.reject(new SiglowError('ENTRADA_INVALIDA')) });
    expect(await entregarModelo(p, ENTRADA(16, r))).toEqual({ tipo: 'plan_b', causa: 'red', codigo: 'ENTRADA_INVALIDA' });
  });
  it('T-PV-08 cancelar a mitad: se borran los parciales y no se pide el respaldo ni persist()', async () => {
    const ac = new AbortController();
    const { p, r } = puertosSimulados();
    const original = p.descargarArchivo;
    p.descargarArchivo = (id, ruta, onBytes, senal) => {
      if (ruta.endsWith('part004')) ac.abort();
      return original(id, ruta, onBytes, senal);
    };
    const res = await entregarModelo(p, ENTRADA(16, r, ac.signal));
    expect(res).toMatchObject({ tipo: 'plan_b', causa: 'cancelado' });
    expect(r.borrados).toEqual(['gliner-x-large']);
    expect(r.persistencias).toBe(0);
  });
  it('T-PV-08 decidirFallo (carga del motor): integridad descarta el modelo; memoria prueba el respaldo solo desde el principal', () => {
    expect(decidirFallo('MODELO_INTEGRIDAD', false)).toEqual({ causa: 'fallo_carga', probarRespaldo: false, descartar: true });
    expect(decidirFallo('MEMORIA', false)).toEqual({ causa: 'memoria_insuficiente', probarRespaldo: true, descartar: false });
    expect(decidirFallo('MEMORIA', true)).toEqual({ causa: 'memoria_insuficiente', probarRespaldo: false, descartar: false });
    expect(decidirFallo('CUOTA_EXCEDIDA', false).probarRespaldo).toBe(true);
    expect(decidirFallo('MODELO_NO_DESCARGADO', false).causa).toBe('no_descargado');
    expect(decidirFallo('ERROR_INTERNO', false)).toEqual({ causa: 'fallo_carga', probarRespaldo: false, descartar: false });
  });
});

describe('T-AB-05 · el reensamblado no duplica el búfer (R-31)', () => {
  const trozosDe = (n: number, tam: number): { m: ModelManifest; datos: Uint8Array[] } => {
    const datos = Array.from({ length: n }, (_, i) => new Uint8Array(tam).fill(i + 1));
    const m = manifiesto({
      tamano: n * tam,
      trozos: datos.map((d, i) => ({ ruta: `onnx/model_quantized.onnx.part${String(i).padStart(3, '0')}`, tamano: d.byteLength, sha256: sha(d) })),
    });
    return { m, datos };
  };
  it('T-AB-05 trozosEnOrden es perezoso: nunca hay más de un trozo leído sin consumir, y el destino es UN búfer preasignado', async () => {
    const { m, datos } = trozosDe(5, 1000);
    let pendientes = 0;
    let maximo = 0;
    const leer = (ruta: string): Promise<Uint8Array | null> => {
      pendientes += 1;
      maximo = Math.max(maximo, pendientes);
      return Promise.resolve(datos[Number(ruta.slice(-3))] ?? null);
    };
    const destino = new Uint8Array(m.tamano); // búfer preasignado de quien recibe (ner.worker.ts)
    const ref = destino.buffer;
    let escrito = 0;
    for await (const t of trozosEnOrden(m, leer)) {
      destino.set(t, escrito);
      escrito += t.byteLength;
      pendientes -= 1;
    }
    expect(maximo).toBe(1);
    expect(escrito).toBe(m.tamano);
    expect(destino.buffer).toBe(ref); // no se reasignó ni se copió a otro búfer
    expect(sha(destino)).toBe(sha(Buffer.concat(datos)));
  });
  it('T-AB-05 un trozo que falta o con otro tamaño es MODELO_NO_DESCARGADO (nunca un modelo a medias)', async () => {
    const { m, datos } = trozosDe(3, 100);
    const consumir = async (leer: (r: string) => Promise<Uint8Array | null>): Promise<void> => {
      for await (const t of trozosEnOrden(m, leer)) void t;
    };
    expect(await codigo(consumir((r) => Promise.resolve(r.endsWith('001') ? null : datos[Number(r.slice(-3))]!)))).toBe('MODELO_NO_DESCARGADO');
    expect(await codigo(consumir((r) => Promise.resolve(datos[Number(r.slice(-3))]!.subarray(1))))).toBe('MODELO_NO_DESCARGADO');
  });
  it('T-AB-05 el service worker emite los trozos en un ReadableStream de highWaterMark 0 y no usa Blob ni concatena', () => {
    const sw = readFileSync(join('src', 'sw.ts'), 'utf8');
    expect(sw).toContain('{ highWaterMark: 0 }');
    expect(sw).not.toMatch(/new Blob|\.concat\(/);
  });
});

describe('D-20 · hilos del modelo según el equipo', () => {
  it('usa todos los hilos lógicos entre 4 y 16; sin dato, 4', () => {
    expect(hilosAislado(16)).toBe(16);
    expect(hilosAislado(8)).toBe(8);
    expect(hilosAislado(12.5)).toBe(12);
    expect(hilosAislado(2)).toBe(HILOS_AISLADO);
    expect(hilosAislado(64)).toBe(HILOS_MAXIMO);
    expect(hilosAislado(undefined)).toBe(HILOS_AISLADO);
    expect(hilosAislado(Number.NaN)).toBe(HILOS_AISLADO);
  });
});
