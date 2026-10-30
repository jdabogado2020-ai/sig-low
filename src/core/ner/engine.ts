/**
 * Motores de entidades (6.11.3). Código propio de Sig-Low.
 *
 * - `NullNerEngine`: plan B (reglas y lista del caso), sin modelo.
 * - `GlinerEngine`: GLiNER-X con ORT-web directo. Todo lo que toca el entorno (ORT, `fetch`, reloj) se inyecta
 *   desde `ner.worker.ts`, de modo que este archivo sigue siendo TypeScript puro (sin DOM ni red, F-01).
 *
 * La interfaz `NerEngine` y los tipos viven en `src/core/types.ts`.
 */

import {
  SiglowError,
  type ModelManifest,
  type NerEngine,
  type NerLoadProgress,
  type NerLoadResult,
  type NerOptions,
  type NerSpan,
  type NerWindowResult,
  type NullNerEngineShape,
  type PartId,
} from '../types';
import { NerAbortError, codigoDeError } from './gliner/errors';
import { spanCandidatesFromLogits } from './gliner/decoder';
import { GLINER_LABELS, buildSpans, countSubtokens, encodeWindow, reservedTokens } from './gliner/processor';
import { detectByWindows, planText, type WindowScoringInput } from './gliner/run';
import { splitWords } from './gliner/splitter';
import { readTokenizer, type GlinerTokenizer } from './gliner/tokenizer';
import type { SpanCandidate } from './gliner/types';
import { MINIMO_ENTIDADES_DE_HUMO, FRASES_DE_HUMO } from './humo';
import { fetchVerificado, type Fetcher } from './model-fetch';

// ---------------------------------------------------------------------------
// Plan B
// ---------------------------------------------------------------------------

/** Plan B (respaldo en ejecución, no vía de cierre): reglas + lista del caso. `load()` resuelve sin descargar; `planWindows()` devuelve 0; `detect()` devuelve [] (AbortError si `signal.aborted`). */
export class NullNerEngine implements NullNerEngineShape {
  readonly engineId = 'nulo' as const;

  load(_onProgress: (p: NerLoadProgress) => void): Promise<NerLoadResult> {
    return Promise.resolve({
      engineId: 'nulo',
      modelId: null,
      sha256: null,
      threads: 0,
      crossOriginIsolated:
        (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true,
      labels: [],
      decoder: 'ninguno',
      loadMs: 0,
      warmupWindowMs: 0,
    });
  }

  planWindows(_text: string, _options: NerOptions): number {
    return 0;
  }

  detect(
    _text: string,
    _options: NerOptions,
    signal: AbortSignal,
    _onWindow?: (w: NerWindowResult) => void,
  ): Promise<NerSpan[]> {
    if (signal.aborted) return Promise.reject(new NerAbortError());
    return Promise.resolve([]);
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// ORT-web (lo mínimo que usa el motor)
// ---------------------------------------------------------------------------

export interface OrtSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number> }>>;
  release(): Promise<void>;
}

export interface OrtModule {
  env: {
    logLevel?: string;
    wasm: { numThreads?: number; proxy?: boolean; wasmPaths?: unknown };
  };
  InferenceSession: { create(model: Uint8Array, options?: unknown): Promise<OrtSession> };
  Tensor: new (type: string, data: ArrayBufferView, dims: readonly number[]) => unknown;
}

/** Hilos por defecto con `crossOriginIsolated` (4 a 8 en 3.3; PF-3 calibra la cifra). Sin él, 1. */
export const HILOS_AISLADO = 4;

export interface GlinerEngineDeps {
  /** Importa ORT-web (build CPU, sin bundle de WebAssembly). Lo aporta `ner.worker.ts`. */
  loadOrt(): Promise<OrtModule>;
  /** Obtiene los bytes de una ruta del modelo (misma raíz que el manifiesto). Lo aporta `ner.worker.ts`. */
  fetcher: Fetcher;
  /** Rutas locales de los dos archivos del build CPU de ORT, fijadas antes del primer uso (V-09). */
  wasmPaths: { mjs: string; wasm: string };
  crossOriginIsolated: boolean;
  /** Fuerza el número de hilos (pruebas, PF-3). */
  threads?: number;
  now?: () => number;
  /** Lector de `tokenizer.json`; por defecto `@huggingface/tokenizers`. */
  createTokenizer?: (tokenizerJson: object, tokenizerConfig: object) => GlinerTokenizer;
}

const MAX_ANCHO = 12;
const decodificar = (bytes: Uint8Array): object =>
  JSON.parse(new TextDecoder().decode(bytes)) as object;

/**
 * GLiNER-X con ORT-web directo (el pipeline de Transformers.js no soporta GLiNER): divisor de palabras por regex Unicode,
 * ventanas, decodificación de tramos con sigmoide, umbral y selección sin solapes (7.10).
 */
export class GlinerEngine implements NerEngine {
  readonly engineId: 'gliner-x-large' | 'gliner-x-base';
  private session: OrtSession | null = null;
  private ort: OrtModule | null = null;
  private tokenizer: GlinerTokenizer | null = null;
  private reservado = 0;
  private hilos = 1;

  constructor(
    private readonly manifest: ModelManifest,
    private readonly deps?: GlinerEngineDeps,
  ) {
    this.engineId = manifest.id;
  }

  private get d(): GlinerEngineDeps {
    if (!this.deps) throw new SiglowError('ERROR_INTERNO');
    return this.deps;
  }

  async load(onProgress: (p: NerLoadProgress) => void): Promise<NerLoadResult> {
    const now = this.d.now ?? Date.now;
    const m = this.manifest;
    if (this.session) throw new SiglowError('ERROR_INTERNO');

    // 1. Auxiliares verificados y tokenizador (el parche de mT5 se mide al crearlo)
    const totalAux = m.auxiliares.reduce((s, a) => s + a.tamano, 0);
    let hechos = 0;
    const archivos = new Map<string, Uint8Array>();
    for (const a of m.auxiliares) {
      const antes = hechos;
      archivos.set(
        a.ruta,
        await fetchVerificado(m, a.ruta, this.d.fetcher, (n) =>
          onProgress({ phase: 'verificando', done: antes + n, total: totalAux }),
        ),
      );
      hechos += a.tamano;
    }
    const json = archivos.get('tokenizer.json');
    const config = archivos.get('tokenizer_config.json');
    if (!json || !config) throw new SiglowError('MODELO_INTEGRIDAD');
    let tokenizer: GlinerTokenizer;
    try {
      tokenizer = (this.d.createTokenizer ?? readTokenizer)(decodificar(json), decodificar(config));
    } catch {
      throw new SiglowError('MODELO_INTEGRIDAD');
    }
    const t = m.tokenizador;
    if (
      tokenizer.affixes.prefix !== t.prefijo ||
      tokenizer.affixes.suffix !== t.sufijo ||
      tokenizer.affixes.cls !== t.cls
    ) {
      throw new SiglowError('MODELO_INTEGRIDAD');
    }
    this.tokenizer = tokenizer;
    this.reservado = reservedTokens(tokenizer);

    // 2. Modelo reensamblado (lo sirve el service worker, 3.3) verificado con su SHA-256
    let bytes: Uint8Array | null = await fetchVerificado(m, m.archivo, this.d.fetcher, (n) =>
      onProgress({ phase: 'ensamblando', done: n, total: m.tamano }),
    );

    // 3. Runtime sin red: rutas locales y número de hilos fijados antes del primer uso (V-09)
    onProgress({ phase: 'cargando_runtime', done: 0, total: 1 });
    const ort = await this.d.loadOrt();
    this.hilos = this.d.threads ?? (this.d.crossOriginIsolated ? HILOS_AISLADO : 1);
    ort.env.wasm.wasmPaths = { ...this.d.wasmPaths };
    ort.env.wasm.proxy = false;
    ort.env.wasm.numThreads = this.hilos;
    ort.env.logLevel = 'error';
    onProgress({ phase: 'cargando_runtime', done: 1, total: 1 });

    // 4. Sesión; el búfer del modelo se suelta en cuanto existe
    const t0 = now();
    onProgress({ phase: 'cargando_modelo', done: 0, total: m.tamano });
    try {
      this.session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    } catch (e) {
      // Un ONNX malformado o truncado no crea sesión: se rechaza con código de integridad, salvo falta de memoria.
      const codigo = codigoDeError(e);
      throw new SiglowError(codigo === 'ERROR_INTERNO' ? 'MODELO_INTEGRIDAD' : codigo);
    } finally {
      bytes = null;
    }
    this.ort = ort;
    onProgress({ phase: 'cargando_modelo', done: m.tamano, total: m.tamano });
    const loadMs = now() - t0;
    if (!this.session.inputNames.includes('span_idx') || !this.session.inputNames.includes('words_mask')) {
      await this.dispose();
      throw new SiglowError('MODELO_INTEGRIDAD');
    }

    // 5. Humo de 5 frases (rechaza un ONNX roto) y ventana de calentamiento
    onProgress({ phase: 'calentando', done: 0, total: 1 });
    try {
      await this.humo();
      const warmupWindowMs = await this.calentar();
      onProgress({ phase: 'calentando', done: 1, total: 1 });
      return {
        engineId: m.id,
        modelId: m.id,
        sha256: m.sha256,
        threads: this.hilos,
        crossOriginIsolated: this.d.crossOriginIsolated,
        labels: ['PER', 'ORG', 'LOC'],
        decoder: 'gliner-spans',
        loadMs,
        warmupWindowMs,
      };
    } catch (e) {
      await this.dispose();
      throw e;
    }
  }

  planWindows(text: string, options: NerOptions): number {
    const tk = this.tokenizer;
    if (!tk) throw new SiglowError('ERROR_INTERNO');
    return planText(text, options, (w) => countSubtokens(tk, w), this.reservado).windows.length;
  }

  detect(
    text: string,
    options: NerOptions,
    signal: AbortSignal,
    onWindow?: (w: NerWindowResult) => void,
  ): Promise<NerSpan[]> {
    const tk = this.tokenizer;
    if (!tk || !this.session) return Promise.reject(new SiglowError('ERROR_INTERNO'));
    return detectByWindows({
      text,
      options,
      reserved: this.reservado,
      countSubtokens: (w) => countSubtokens(tk, w),
      scoreWindow: (input) => this.puntuar(input, tk),
      signal,
      now: this.d.now ?? Date.now,
      // `partId` lo pone el worker, que es quien conoce la parte
      onWindow: (w) => onWindow?.({ ...w, partId: '' as PartId }),
    });
  }

  async dispose(): Promise<void> {
    const s = this.session;
    this.session = null;
    this.ort = null;
    this.tokenizer = null;
    if (s) await s.release();
  }

  // -------------------------------------------------------------------------

  /** Una ventana: entradas del grafo, inferencia y candidatos con índices de la ventana (7.10.2). */
  private async puntuar(input: WindowScoringInput, tk: GlinerTokenizer): Promise<SpanCandidate[]> {
    const { session, ort } = this;
    if (!session || !ort) throw new SiglowError('ERROR_INTERNO');
    const enc = encodeWindow(tk, input.wordTexts, GLINER_LABELS, input.maxSubtokensPerWord);
    const L = enc.textLength;
    if (L === 0) return [];
    const int64 = (v: readonly number[]): BigInt64Array => BigInt64Array.from(v, BigInt);
    const { spanIdx, spanMask } = buildSpans(L, MAX_ANCHO);
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
    if (!logits || logits.length !== L * MAX_ANCHO * GLINER_LABELS.length) {
      throw new SiglowError('MODELO_INTEGRIDAD');
    }
    const candidatos = spanCandidatesFromLogits(logits, L, MAX_ANCHO, GLINER_LABELS);
    const mapa = enc.modelWordToWindowWord;
    if (L === input.wordTexts.length) return candidatos; // sin palabras omitidas: identidad
    // Palabras sin subtokens: se traducen a la numeración de la ventana.
    const traducidos: SpanCandidate[] = [];
    for (const c of candidatos) {
      const s = mapa[c.s];
      const e = mapa[c.s + c.w - 1];
      if (s === undefined || e === undefined || e - s + 1 > MAX_ANCHO) continue;
      traducidos.push({ ...c, s, w: e - s + 1 });
    }
    return traducidos;
  }

  private opcionesPorDefecto(): NerOptions {
    const m = this.manifest;
    return {
      windowTokens: m.ventanaTokens,
      overlapWords: m.solapePalabras,
      maxSpanWords: 12,
      threshold: m.umbral,
      labels: m.etiquetas,
      threads: this.hilos,
    };
  }

  /** Cinco frases ficticias con al menos ocho entidades; un q8 roto da cero sin error (V-08). */
  private async humo(): Promise<void> {
    const opciones = this.opcionesPorDefecto();
    const ac = new AbortController();
    let total = 0;
    for (const frase of FRASES_DE_HUMO) total += (await this.detect(frase, opciones, ac.signal)).length;
    if (total < MINIMO_ENTIDADES_DE_HUMO) throw new SiglowError('MODELO_INTEGRIDAD');
  }

  /** Una ventana llena (≈ 512 tokens) con las mismas frases; su duración es la base de la estimación de 8.5. */
  private async calentar(): Promise<number> {
    const tk = this.tokenizer;
    if (!tk) throw new SiglowError('ERROR_INTERNO');
    const opciones = this.opcionesPorDefecto();
    const presupuesto = opciones.windowTokens - this.reservado;
    const partes: string[] = [];
    let usado = 0;
    for (let i = 0; ; i++) {
      const frase = FRASES_DE_HUMO[i % FRASES_DE_HUMO.length] as string;
      const n = countSubtokens(tk, splitWords(frase).map((w) => w.text)).reduce((a, b) => a + b, 0);
      if (usado + n > presupuesto) break;
      partes.push(frase);
      usado += n;
    }
    let ms = 0;
    await this.detect(partes.join(' '), opciones, new AbortController().signal, (w) => {
      if (w.windowIndex === 0) ms = w.ms;
    });
    return ms;
  }
}
