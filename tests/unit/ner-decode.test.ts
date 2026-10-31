/**
 * T-MO-09 · Motor del modelo I (PF-1a): divisor de palabras, tokenizador con el parche de mT5,
 * ventanas con zona propia, decodificación de tramos con umbral inclusivo y mapeo de offsets
 * (7.10.1 a 7.10.8). INV-W04 e INV-W06 con un motor simulado.
 *
 * Solo datos ficticios evidentes (10.1.5). Las pruebas contra el tokenizador real y contra los vectores
 * de referencia de `h0/referencia-gliner.json` (H0-16) se saltan si los archivos no están: se buscan en
 * `SIGLOW_MODELOS` (por defecto `../h0/modelos` relativo a la raíz del worktree).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { NullNerEngine } from '../../src/core/ner/engine';
import {
  GLINER_LABELS,
  NerAbortError,
  buildSpans,
  countSubtokens,
  createGlinerTokenizer,
  decodeSpans,
  detectByWindows,
  encodePrompt,
  encodeWindow,
  inOwnZone,
  ownZones,
  planText,
  planWindows,
  readTokenizer,
  reservedTokens,
  segmentWords,
  spanCandidatesFromLogits,
  splitWords,
  tokenizerAffixes,
  toNerSpans,
  type SpanCandidate,
  type TokenizerLike,
} from '../../src/core/ner/gliner';
import { GlinerError, codigoDeError } from '../../src/core/ner/gliner/errors';
import { crearManejadorNer } from '../../src/core/ner/handler';
import { SiglowError, type ModelManifest, type NerEngine, type NerLoadProgress, type NerLoadResult, type NerOptions, type NerResponse, type NerSpan, type NerWindowResult, type PartId } from '../../src/core/types';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const OPTIONS: NerOptions = {
  windowTokens: 512,
  overlapWords: 37,
  maxSpanWords: 12,
  threshold: 0.3,
  labels: ['person', 'organization', 'location'],
  threads: 1,
};

const words = (text: string): string[] => segmentWords(text).map((w) => text.slice(w.start, w.end));

/** Tokenizador T5 simulado: solo añade `</s>` (id 1) al final; trozos de 3 caracteres por subtoken. */
const fakeT5: TokenizerLike = {
  encode(text: string) {
    const ids: number[] = [];
    for (let i = 0; i < text.length; i += 3) {
      const chunk = text.slice(i, i + 3);
      let h = 0;
      for (const ch of chunk) h = (h * 31 + ch.codePointAt(0)!) % 5000;
      ids.push(100 + h);
    }
    return { ids: [...ids, 1] };
  },
};

/** Tokenizador estilo BERT simulado: `[CLS]` (id 2) al inicio y `[SEP]` (id 3) al final. */
const fakeBert: TokenizerLike = {
  encode(text: string) {
    const ids: number[] = [];
    for (let i = 0; i < text.length; i += 3) ids.push(100 + text.charCodeAt(i));
    return { ids: [2, ...ids, 3] };
  },
};

const T5 = createGlinerTokenizer(fakeT5);

// ---------------------------------------------------------------------------
// Divisor de palabras (R-MOD-01, 7.10.2)
// ---------------------------------------------------------------------------

describe('T-MO-09 · divisor de palabras (R-MOD-01)', () => {
  const cases: Array<[string, string[]]> = [
    [
      'ACCIONANTE: ANA FICTICIA ROJAS, C.C. 41.000.001 (Rojas-Ejemplo).',
      ['ACCIONANTE', ':', 'ANA', 'FICTICIA', 'ROJAS', ',', 'C', '.', 'C', '.', '41', '.', '000', '.', '001', '(', 'Rojas-Ejemplo', ')', '.'],
    ],
    ['ana_ficticia vive', ['ana_ficticia', 'vive']],
    ['D’Ejemplo vive', ['D', '’', 'Ejemplo', 'vive']],
    ['Muñoz Pérez', ['Muñoz', 'Pérez']],
    ['Ro\u00ADjas firmó', ['Ro\u00ADjas', 'firmó']],
    ['ana.ficticia@ejemplo.test', ['ana', '.', 'ficticia', '@', 'ejemplo', '.', 'test']],
    ['Ana Rojas', ['Ana', 'Rojas']],
    ['Ana \u200B Rojas', ['Ana', 'Rojas']],
    ['Rojas.', ['Rojas', '.']],
    ['Rojas-', ['Rojas', '-']],
    ['Ana - Rojas', ['Ana', '-', 'Rojas']],
  ];
  it.each(cases)('T-MO-09 palabras de «%s»', (text, expected) => {
    expect(words(text)).toEqual(expected);
  });

  it('T-MO-09 dos espacios: posiciones canónicas Ana [0,3) y Rojas [5,10)', () => {
    expect(segmentWords('Ana  Rojas')).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 10 },
    ]);
  });

  it('T-MO-09 el tokenizador recibe la palabra sin invisibles, las posiciones son las canónicas', () => {
    const text = 'Ro\u00ADjas firmó';
    const [w] = splitWords(text);
    expect(w).toEqual({ start: 0, end: 6, text: 'Rojas' });
    expect(text.slice(w!.start, w!.end)).toBe('Ro\u00ADjas');
  });

  it('T-MO-09 una marca combinante (\\p{M}) queda dentro de la palabra', () => {
    expect(words('José Ficticia')).toEqual(['José', 'Ficticia']);
  });

  it('T-MO-09 texto vacío o solo espacios e invisibles no da palabras', () => {
    expect(segmentWords('')).toEqual([]);
    expect(segmentWords(' \n\t \u200B\u00AD\uFEFF')).toEqual([]);
  });

  it('T-MO-09 las palabras son disjuntas y están en orden', () => {
    const text = 'Señor Ñandú-Ejemplo, de BOGOTÁ D.C. (prueba_1) — fin.';
    const ws = segmentWords(text);
    for (let i = 1; i < ws.length; i++) expect(ws[i]!.start).toBeGreaterThanOrEqual(ws[i - 1]!.end);
  });
});

// ---------------------------------------------------------------------------
// Tokenizador y parche de mT5 (7.10.2)
// ---------------------------------------------------------------------------

describe('T-MO-09 · tokenizador con el parche de mT5', () => {
  it('T-MO-09 mT5: encode("") solo trae </s> → prefijo 0, sufijo 1, sin cls', () => {
    expect(tokenizerAffixes([1], [259, 262, 1])).toEqual({ prefix: 0, suffix: 1, cls: false });
  });

  it('T-MO-09 estilo BERT: [CLS] … [SEP] → prefijo 1, sufijo 1, con cls', () => {
    expect(tokenizerAffixes([2, 3], [2, 140, 3])).toEqual({ prefix: 1, suffix: 1, cls: true });
  });

  it('T-MO-09 sin especiales: prefijo 0, sufijo 0, sin cls', () => {
    expect(tokenizerAffixes([], [140])).toEqual({ prefix: 0, suffix: 0, cls: false });
  });

  it('T-MO-09 envoltorio incoherente (la «a» no da tokens): error con código, sin texto', () => {
    expect(() => tokenizerAffixes([2, 3], [2, 3])).toThrowError('ERROR_INTERNO');
  });

  it('T-MO-09 parche mT5: la palabra conserva TODOS sus subtokens y no se antepone </s>', () => {
    const tk = createGlinerTokenizer(fakeT5);
    expect(tk.affixes).toEqual({ prefix: 0, suffix: 1, cls: false });
    expect(tk.clsId).toBeNull();
    expect(tk.sepId).toBe(1);
    const crudo = fakeT5.encode('Ficticia').ids; // [3 subtokens, </s>]
    expect(tk.encodeWord('Ficticia')).toEqual(crudo.slice(0, -1));
    // Sin el parche (un especial a cada lado) se perdería el primer subtoken: 5 % de exhaustividad en el sondeo.
    const sinParche = crudo.slice(1, crudo.length - 1);
    expect(tk.encodeWord('Ficticia')).not.toEqual(sinParche);
    expect(tk.encodeWord('Ficticia')).toHaveLength(sinParche.length + 1);
  });

  it('T-MO-09 estilo BERT: quita [CLS] y [SEP] de cada palabra y usa el [CLS] inicial', () => {
    const tk = createGlinerTokenizer(fakeBert);
    expect(tk.clsId).toBe(2);
    expect(tk.sepId).toBe(3);
    const w = encodeWindow(tk, ['Ana']);
    expect(w.inputIds[0]).toBe(2);
    expect(w.inputIds[w.inputIds.length - 1]).toBe(3);
  });

  it('T-MO-09 prompt: <<ENT>> person <<ENT>> organization <<ENT>> location <<SEP>>, cada pieza por separado', () => {
    const prompt = encodePrompt(T5);
    const piezas = ['<<ENT>>', 'person', '<<ENT>>', 'organization', '<<ENT>>', 'location', '<<SEP>>'];
    expect(prompt).toEqual(piezas.flatMap((p) => T5.encodeWord(p)));
    expect(GLINER_LABELS).toEqual(['person', 'organization', 'location']);
    expect(reservedTokens(T5)).toBe(prompt.length + 1);
  });

  it('T-MO-09 encodeWindow: words_mask lleva el índice (desde 1) en el primer subtoken de cada palabra', () => {
    const enc = encodeWindow(T5, ['Ana', 'Ficticia', 'vive']); // 1, 3 y 2 subtokens
    const prompt = encodePrompt(T5).length;
    expect(enc.inputIds).toHaveLength(prompt + 7);
    expect(enc.wordsMask.slice(0, prompt).every((v) => v === 0)).toBe(true);
    expect(enc.wordsMask.slice(prompt)).toEqual([1, 2, 0, 0, 3, 0, 0]);
    expect(enc.attentionMask.every((v) => v === 1)).toBe(true);
    expect(enc.inputIds.at(-1)).toBe(1);
    expect(enc.textLength).toBe(3);
    expect(enc.modelWordToWindowWord).toEqual([0, 1, 2]);
  });

  it('T-MO-09 encodeWindow trunca la palabra más larga que el presupuesto', () => {
    const enc = encodeWindow(T5, ['Ficticiaaaaaaaaaaa'], undefined, 2);
    const prompt = encodePrompt(T5).length;
    expect(enc.wordsMask.slice(prompt)).toEqual([1, 0, 0]);
  });

  it('T-MO-09 una palabra sin subtokens no recibe índice y no deja huecos en words_mask', () => {
    const vacio: TokenizerLike = {
      encode: (t) => (t === 'x' ? { ids: [1] } : fakeT5.encode(t)),
    };
    const tk = createGlinerTokenizer(vacio);
    const enc = encodeWindow(tk, ['Ana', 'x', 'vive']);
    const prompt = encodePrompt(tk).length;
    expect(enc.wordsMask.slice(prompt)).toEqual([1, 2, 0, 0]);
    expect(enc.textLength).toBe(2);
    expect(enc.modelWordToWindowWord).toEqual([0, 2]);
  });

  it('T-MO-09 buildSpans: pares (inicio, inicio + anchura − 1) y máscara de los que caben', () => {
    const { spanIdx, spanMask } = buildSpans(3, 12);
    expect(spanIdx).toHaveLength(36);
    expect(spanIdx.slice(0, 3)).toEqual([[0, 0], [0, 1], [0, 2]]);
    expect(spanMask.slice(0, 4)).toEqual([true, true, true, false]);
    expect(spanIdx[12 + 1]).toEqual([1, 2]);
    expect(spanMask.filter(Boolean)).toHaveLength(3 + 2 + 1);
  });
});

// ---------------------------------------------------------------------------
// Ventanas y zona propia (7.10.3 y 7.10.5)
// ---------------------------------------------------------------------------

const ones = (n: number): number[] => new Array<number>(n).fill(1);

describe('T-MO-09 · planWindows (7.10.3)', () => {
  it('T-MO-09 100 palabras de 1 subtoken, W=40, reservado 8, O=6', () => {
    expect(planWindows(ones(100), 40, 6, 8)).toEqual([[0, 32], [26, 58], [52, 84], [78, 100]]);
  });

  it('T-MO-09 una palabra de 20 subtokens, W=10, reservado 2: se trunca y queda [0,1)', () => {
    expect(planWindows([20], 10, 6, 2)).toEqual([[0, 1]]);
  });

  it('T-MO-09 1.000 palabras de 1 subtoken, W=512, reservado 16, O=37', () => {
    expect(planWindows(ones(1000), 512, 37, 16)).toEqual([[0, 496], [459, 955], [918, 1000]]);
  });

  it('T-MO-09 1.000 palabras con 1,95 subtokens de promedio: la primera ventana lleva de 240 a 260', () => {
    const patron = [2, 2, 1, 3, 2, 2, 1, 3, 2, 2, 2, 1, 2, 2, 1, 3, 2, 2, 2, 2]; // suma 39 → 1,95
    const counts = Array.from({ length: 1000 }, (_, i) => patron[i % patron.length]!);
    expect(counts.reduce((a, b) => a + b, 0) / 1000).toBeCloseTo(1.95, 5);
    const [primera] = planWindows(counts, 512, 37, 16);
    expect(primera![1] - primera![0]).toBeGreaterThanOrEqual(240);
    expect(primera![1] - primera![0]).toBeLessThanOrEqual(260);
  });

  it('T-MO-09 sin palabras no hay ventanas', () => {
    expect(planWindows([], 512, 37, 16)).toEqual([]);
  });

  it('T-MO-09 recuentos irregulares: empieza en 0, termina en n, inicios crecientes y presupuesto respetado', () => {
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let caso = 0; caso < 50; caso++) {
      const n = 1 + Math.floor(rnd() * 1500);
      const counts = Array.from({ length: n }, () => 1 + Math.floor(rnd() * 6));
      const W = 80 + Math.floor(rnd() * 500);
      const O = Math.floor(rnd() * 40);
      const reservado = 16;
      const ventanas = planWindows(counts, W, O, reservado);
      expect(ventanas[0]![0]).toBe(0);
      expect(ventanas.at(-1)![1]).toBe(n);
      for (let i = 0; i < ventanas.length; i++) {
        const [s, e] = ventanas[i]!;
        expect(e).toBeGreaterThan(s);
        if (i > 0) {
          expect(s).toBeGreaterThan(ventanas[i - 1]![0]);
          expect(s).toBeLessThanOrEqual(ventanas[i - 1]![1]); // cubren todo el documento
        }
        let usado = 0;
        for (let k = s; k < e; k++) usado += counts[k]!;
        expect(usado).toBeLessThanOrEqual(W - reservado);
      }
    }
  });
});

describe('T-MO-09 · ownZones (7.10.5)', () => {
  const ventanas = planWindows(ones(1000), 512, 37, 16);

  it('T-MO-09 zonas propias de [0,496) [459,955) [918,1000): [0,477) [477,936) [936,1000)', () => {
    expect(ownZones(ventanas, 1000)).toEqual([[0, 477], [477, 936], [936, 1000]]);
  });

  it('T-MO-09 un tramo que empieza en la palabra 470 lo emite la primera ventana y la segunda lo descarta', () => {
    const zonas = ownZones(ventanas, 1000);
    expect(inOwnZone(zonas[0]!, 470)).toBe(true);
    expect(inOwnZone(zonas[1]!, 470)).toBe(false);
  });

  it('T-MO-09 un tramo de 12 palabras que empieza en la última palabra de la zona propia cabe en su ventana', () => {
    const zonas = ownZones(ventanas, 1000);
    zonas.forEach((z, i) => {
      const ultima = z[1] - 1;
      expect(Math.min(ultima + 11, 999)).toBeLessThan(ventanas[i]![1]);
    });
  });

  it('T-MO-09 cada palabra pertenece a una sola zona', () => {
    const zonas = ownZones(ventanas, 1000);
    for (let w = 0; w < 1000; w++) {
      expect(zonas.filter((z) => inOwnZone(z, w))).toHaveLength(1);
    }
  });

  it('T-MO-09 ventanas muy cortas [0,3) [2,4) [3,5): las zonas no se invierten', () => {
    const zonas = ownZones([[0, 3], [2, 4], [3, 5]], 5);
    for (const [a, b] of zonas) expect(a).toBeLessThanOrEqual(b);
    expect(zonas[0]![0]).toBe(0);
    expect(zonas.at(-1)![1]).toBe(5);
  });

  it('T-MO-09 propiedad: zonas contiguas que parten el documento y contexto garantizado con solape ≥ 24', () => {
    let seed = 777;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let caso = 0; caso < 50; caso++) {
      const n = 1 + Math.floor(rnd() * 1500);
      const counts = Array.from({ length: n }, () => 1 + Math.floor(rnd() * 4));
      const ventanasAl = planWindows(counts, 300, 37, 16);
      const zonas = ownZones(ventanasAl, n);
      expect(zonas[0]![0]).toBe(0);
      expect(zonas.at(-1)![1]).toBe(n);
      zonas.forEach((z, i) => {
        expect(z[0]).toBeLessThanOrEqual(z[1]);
        if (i > 0) expect(z[0]).toBe(zonas[i - 1]![1]);
        // un tramo propio de hasta 12 palabras termina dentro de su ventana
        for (let w = z[0]; w < z[1]; w++) {
          expect(Math.min(w + 11, n - 1)).toBeLessThan(ventanasAl[i]![1]);
        }
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Decodificación de tramos (7.10.4)
// ---------------------------------------------------------------------------

type Etq = 'person' | 'organization' | 'location';
const cand = (s: number, w: number, label: Etq, p: number): SpanCandidate => ({ s, w, label, p });
const resumen = (c: SpanCandidate[], umbral = 0.3): Array<[Etq, number, number]> =>
  decodeSpans(c, umbral).map((d) => [d.label, d.s, d.e]);

describe('T-MO-09 · decodeSpans (7.10.4)', () => {
  it('T-MO-09 PER[0–1]; el segundo queda bajo el umbral', () => {
    expect(resumen([cand(0, 2, 'person', 0.95), cand(5, 1, 'organization', 0.25)])).toEqual([['person', 0, 1]]);
  });
  it('T-MO-09 el umbral es inclusivo', () => {
    expect(resumen([cand(3, 1, 'location', 0.3)])).toEqual([['location', 3, 3]]);
  });
  it('T-MO-09 gana el mayor puntaje cuando se solapan', () => {
    expect(resumen([cand(0, 3, 'person', 0.7), cand(1, 2, 'organization', 0.9)])).toEqual([['organization', 1, 2]]);
  });
  it('T-MO-09 a igual puntaje gana el tramo más ancho', () => {
    expect(resumen([cand(0, 2, 'person', 0.8), cand(0, 3, 'person', 0.8)])).toEqual([['person', 0, 2]]);
  });
  it('T-MO-09 a igual puntaje y anchura gana el menor inicio', () => {
    expect(resumen([cand(1, 2, 'person', 0.8), cand(0, 2, 'organization', 0.8)])).toEqual([['organization', 0, 1]]);
  });
  it('T-MO-09 adyacentes no se solapan', () => {
    expect(resumen([cand(0, 2, 'person', 0.9), cand(2, 2, 'person', 0.9)])).toEqual([
      ['person', 0, 1],
      ['person', 2, 3],
    ]);
  });
  it('T-MO-09 la anchura 13 se ignora', () => {
    expect(resumen([cand(0, 13, 'organization', 0.99), cand(0, 12, 'organization', 0.5)])).toEqual([['organization', 0, 11]]);
  });
  it('T-MO-09 orden por posición', () => {
    expect(resumen([cand(8, 1, 'location', 0.6), cand(1, 1, 'person', 0.9)])).toEqual([
      ['person', 1, 1],
      ['location', 8, 8],
    ]);
  });
  it('T-MO-09 2/1/PER/0,40 con umbral 0,5: nada', () => {
    expect(resumen([cand(2, 1, 'person', 0.4)], 0.5)).toEqual([]);
  });
  it('T-MO-09 dos tramos solapados nunca coexisten aunque tengan etiquetas distintas', () => {
    const r = resumen([cand(0, 2, 'person', 0.9), cand(1, 2, 'location', 0.85)]);
    expect(r).toEqual([['person', 0, 1]]);
  });

  it('T-MO-09 logits [1, L, 12, 3]: orden (inicio, anchura, etiqueta) y sigmoide', () => {
    const L = 3;
    const logits = new Float32Array(L * 12 * 3).fill(-20);
    // inicio 1, anchura 2 (índice 1), etiqueta organization (índice 1)
    logits[(1 * 12 + 1) * 3 + 1] = 0; // sigmoide(0) = 0,5
    const c = spanCandidatesFromLogits(logits, L, 12, ['person', 'organization', 'location']);
    const buenos = c.filter((x) => x.p >= 0.3);
    expect(buenos).toHaveLength(1);
    expect(buenos[0]).toMatchObject({ s: 1, w: 2, label: 'organization' });
    expect(buenos[0]!.p).toBeCloseTo(0.5, 6);
    // solo caben los tramos dentro de las L palabras: 3 + 2 + 1 anchuras × 3 etiquetas
    expect(c).toHaveLength((3 + 2 + 1) * 3);
  });
});

// ---------------------------------------------------------------------------
// Mapeo de offsets (7.10.4, 7.10.5 y 7.10.8)
// ---------------------------------------------------------------------------

describe('T-MO-09 · mapeo de palabras a posiciones canónicas', () => {
  const texto = 'Ana  Ficticia vive en Villa Ejemplo.';
  const ws = segmentWords(texto);

  it('T-MO-09 inicio de la primera palabra y fin de la última; etiqueta person → PER', () => {
    const r = toNerSpans(
      [{ label: 'person', s: 0, e: 1, p: 0.9 }, { label: 'location', s: 4, e: 5, p: 0.8 }],
      ws,
      [0, ws.length],
      [0, ws.length],
    );
    expect(r).toEqual([
      { start: 0, end: 13, label: 'PER', score: 0.9 },
      { start: 22, end: 35, label: 'LOC', score: 0.8 },
    ]);
    expect(texto.slice(r[0]!.start, r[0]!.end)).toBe('Ana  Ficticia');
  });

  it('T-MO-09 solo conserva los tramos cuya primera palabra cae en la zona propia', () => {
    const r = toNerSpans(
      [{ label: 'person', s: 0, e: 1, p: 0.9 }, { label: 'location', s: 4, e: 5, p: 0.8 }],
      ws,
      [0, ws.length],
      [2, ws.length],
    );
    expect(r.map((x) => x.label)).toEqual(['LOC']);
  });

  it('T-MO-09 ventana que no empieza en 0: los índices de la ventana se suman a su inicio', () => {
    const r = toNerSpans([{ label: 'organization', s: 0, e: 1, p: 0.7 }], ws, [4, 6], [4, 6]);
    expect(r).toEqual([{ start: 22, end: 35, label: 'ORG', score: 0.7 }]);
  });

  it('T-MO-09 con palabras sin subtokens traduce la numeración del modelo a la de la ventana', () => {
    // el modelo ve las palabras 0, 2 y 3 de la ventana; el tramo modelo [1,2] = palabras 2 y 3
    const r = toNerSpans([{ label: 'person', s: 1, e: 2, p: 0.9 }], ws, [0, 4], [0, 4], [0, 2, 3]);
    expect(r).toEqual([{ start: ws[2]!.start, end: ws[3]!.end, label: 'PER', score: 0.9 }]);
  });
});

// ---------------------------------------------------------------------------
// Motor simulado: INV-W04 e INV-W06
// ---------------------------------------------------------------------------

const PARTE = 'parte_00000000000000000000000000000000' as PartId;
const countFake = (ws: readonly string[]): number[] => countSubtokens(T5, ws);
const RESERVADO = reservedTokens(T5);

/** Motor simulado: usa el recorrido real por ventanas y un «modelo» que reconoce nombres ficticios sin importar mayúsculas. */
class SimulatedNerEngine implements NerEngine {
  readonly engineId = 'gliner-x-base' as const;
  readonly vistos: string[][] = [];
  constructor(private readonly nombres: string[][]) {}

  load() {
    return Promise.resolve({
      engineId: 'gliner-x-base' as const, modelId: null, sha256: null, threads: 1,
      crossOriginIsolated: false, labels: ['PER' as const], decoder: 'gliner-spans' as const, loadMs: 0, warmupWindowMs: 0,
    });
  }

  planWindows(text: string, options: NerOptions): number {
    return planText(text, options, countFake, RESERVADO).windows.length;
  }

  detect(text: string, options: NerOptions, signal: AbortSignal, onWindow?: (w: NerWindowResult) => void): Promise<NerSpan[]> {
    return detectByWindows({
      text, options, reserved: RESERVADO, countSubtokens: countFake, signal,
      scoreWindow: ({ wordTexts }) => {
        this.vistos.push(wordTexts);
        const bajo = wordTexts.map((w) => w.toLowerCase());
        const out: SpanCandidate[] = [];
        for (const nombre of this.nombres) {
          for (let s = 0; s + nombre.length <= bajo.length; s++) {
            if (nombre.every((p, k) => bajo[s + k] === p)) {
              out.push({ s, w: nombre.length, label: 'person', p: 0.9 });
              // un candidato más corto y menos seguro que debe perder
              if (nombre.length > 1) out.push({ s, w: nombre.length - 1, label: 'organization', p: 0.5 });
            }
          }
        }
        return out;
      },
      onWindow: (w) => onWindow?.({ partId: PARTE, ...w }),
    });
  }

  dispose() {
    return Promise.resolve();
  }
}

describe('T-MO-09 · INV-W04 posiciones canónicas con minúsculas, Title Case y MAYÚSCULAS', () => {
  const base = 'Sr. José Muñoz  Ficticia\nvive en  Bogotá   con   Ana Prueba.';
  const formas: Array<[string, string]> = [
    ['minúsculas', base.toLowerCase()],
    ['Title Case', base],
    ['MAYÚSCULAS', base.toUpperCase()],
  ];

  it.each(formas)('INV-W04 %s: text.slice(start, end) es el nombre exacto y el modelo recibió el texto sin transformar', async (_n, texto) => {
    const motor = new SimulatedNerEngine([['josé', 'muñoz', 'ficticia'], ['ana', 'prueba']]);
    const spans = await motor.detect(texto, OPTIONS, new AbortController().signal);
    expect(spans).toHaveLength(2);
    expect(texto.slice(spans[0]!.start, spans[0]!.end).toLowerCase()).toBe('josé muñoz  ficticia');
    expect(texto.slice(spans[1]!.start, spans[1]!.end).toLowerCase()).toBe('ana prueba');
    expect(spans.map((s) => s.label)).toEqual(['PER', 'PER']);
    // el motor ve las palabras con su caja original (nada de Title Case ni minúsculas forzadas, 7.10.6)
    const vistas = motor.vistos.flat();
    expect(vistas).toEqual(segmentWords(texto).map((w) => texto.slice(w.start, w.end)));
  });

  it('INV-W04 las tres formas dan exactamente las mismas posiciones', async () => {
    const posiciones: Array<Array<[number, number]>> = [];
    for (const [, texto] of formas) {
      const motor = new SimulatedNerEngine([['josé', 'muñoz', 'ficticia'], ['ana', 'prueba']]);
      const spans = await motor.detect(texto, OPTIONS, new AbortController().signal);
      posiciones.push(spans.map((s) => [s.start, s.end]));
    }
    expect(posiciones[1]).toEqual(posiciones[0]);
    expect(posiciones[2]).toEqual(posiciones[0]);
  });
});

describe('T-MO-09 · INV-W06 sin duplicados entre ventanas', () => {
  // Un nombre cada 15 palabras: cada solape de 30 palabras contiene varios.
  const relleno = 'de la casa del barrio'.split(' ');
  const construir = (nombres: number): { texto: string; esperados: number } => {
    const partes: string[] = [];
    let n = 0;
    while (n < nombres) {
      for (let k = 0; k < 13; k++) partes.push(relleno[k % relleno.length]!);
      partes.push('Ana', 'Ficticia');
      n++;
    }
    return { texto: partes.join(' ') + '.', esperados: nombres };
  };
  const opciones: NerOptions = { ...OPTIONS, windowTokens: RESERVADO + 120, overlapWords: 30 };

  it('INV-W06 el documento de prueba tiene al menos 3 ventanas y un nombre en cada solape', () => {
    const { texto } = construir(30);
    const plan = planText(texto, opciones, countFake, RESERVADO);
    expect(plan.windows.length).toBeGreaterThanOrEqual(3);
    const inicios = new Set<number>();
    plan.words.forEach((w, i) => { if (w.text === 'Ana') inicios.add(i); });
    for (let i = 1; i < plan.windows.length; i++) {
      const [ini] = plan.windows[i]!;
      const [, finAnterior] = plan.windows[i - 1]!;
      const enSolape = [...inicios].filter((p) => p >= ini && p < finAnterior);
      expect(enSolape.length).toBeGreaterThan(0);
    }
  });

  it('INV-W06 los parcial no repiten ningún tramo y su unión coincide con la lista final de detect', async () => {
    const { texto, esperados } = construir(30);
    const motor = new SimulatedNerEngine([['ana', 'ficticia']]);
    const parciales: NerWindowResult[] = [];
    const final = await motor.detect(texto, opciones, new AbortController().signal, (w) => parciales.push(w));

    expect(parciales.length).toBe(motor.planWindows(texto, opciones));
    expect(parciales.length).toBeGreaterThanOrEqual(3);
    parciales.forEach((p, i) => {
      expect(p.windowIndex).toBe(i);
      expect(p.windowTotal).toBe(parciales.length);
      expect(p.partId).toBe(PARTE);
    });

    const union = parciales.flatMap((p) => p.spans);
    expect(union).toEqual(final);
    const claves = union.map((s) => `${s.start}:${s.end}:${s.label}`);
    expect(new Set(claves).size).toBe(claves.length);
    // y ni siquiera se solapan: cada nombre sale una sola vez, de la ventana que lo posee
    for (let i = 1; i < union.length; i++) expect(union[i]!.start).toBeGreaterThanOrEqual(union[i - 1]!.end);
    expect(union).toHaveLength(esperados);
    for (const s of union) expect(texto.slice(s.start, s.end)).toBe('Ana Ficticia');
  });

  it('INV-W06 sin zona propia el mismo documento sí repetiría tramos (la prueba detecta el defecto)', async () => {
    const { texto, esperados } = construir(30);
    const plan = planText(texto, opciones, countFake, RESERVADO);
    let crudo = 0;
    for (const [s, e] of plan.windows) {
      const ws = plan.words.slice(s, e).map((w) => w.text);
      for (let i = 0; i + 1 < ws.length; i++) if (ws[i] === 'Ana' && ws[i + 1] === 'Ficticia') crudo++;
    }
    expect(crudo).toBeGreaterThan(esperados);
  });

  it('INV-W06 un tramo que cruza el borde de zona no se corta: lo emite la ventana que lo posee', async () => {
    const { texto } = construir(30);
    const plan = planText(texto, opciones, countFake, RESERVADO);
    const motor = new SimulatedNerEngine([['ana', 'ficticia']]);
    const final = await motor.detect(texto, opciones, new AbortController().signal);
    for (const s of final) {
      const primera = plan.words.findIndex((w) => w.start === s.start);
      const i = plan.zones.findIndex((z) => inOwnZone(z, primera));
      expect(plan.windows[i]![1]).toBeGreaterThan(primera + 1);
    }
  });

  it('INV-W06 cancelar entre ventanas lanza AbortError sin texto', async () => {
    const { texto } = construir(30);
    const motor = new SimulatedNerEngine([['ana', 'ficticia']]);
    const ac = new AbortController();
    let n = 0;
    const r = motor.detect(texto, opciones, ac.signal, () => { if (++n === 1) ac.abort(); });
    await expect(r).rejects.toBeInstanceOf(NerAbortError);
    await expect(r).rejects.toMatchObject({ name: 'AbortError', message: 'AbortError' });
    expect(n).toBe(1);
  });

  it('INV-W06 texto vacío: 0 ventanas y lista vacía', async () => {
    const motor = new SimulatedNerEngine([['ana']]);
    expect(motor.planWindows('', OPTIONS)).toBe(0);
    expect(await motor.detect('', OPTIONS, new AbortController().signal)).toEqual([]);
  });
});

describe('T-MO-09 · NullNerEngine (plan B, 6.11.3)', () => {
  const motor = new NullNerEngine();
  it('T-MO-09 INV-W03 load() resuelve sin descargar; planWindows() devuelve 0; detect() devuelve []', async () => {
    const r = await motor.load(() => undefined);
    expect(r).toMatchObject({ engineId: 'nulo', modelId: null, sha256: null, threads: 0, decoder: 'ninguno' });
    expect(motor.planWindows('Ana Prueba', OPTIONS)).toBe(0);
    expect(await motor.detect('Ana Prueba', OPTIONS, new AbortController().signal)).toEqual([]);
    await expect(motor.dispose()).resolves.toBeUndefined();
  });
  it('T-MO-09 detect() con signal abortada lanza AbortError', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(motor.detect('x', OPTIONS, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

// ---------------------------------------------------------------------------
// Código incorporado: aviso MIT y privacidad (F-01, F-02, F-05, F-06 en src/core/ner)
// ---------------------------------------------------------------------------

const RAIZ = process.cwd();
const listar = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? listar(p) : p.endsWith('.ts') ? [p] : [];
  });

describe('T-MO-09 · código incorporado (MIT) y privacidad', () => {
  const derivados = ['splitter.ts', 'tokenizer.ts', 'processor.ts', 'decoder.ts'];
  it.each(derivados)('T-MO-09 el aviso MIT del original y la nota «Modificado para Sig-Low» figuran en %s', (f) => {
    const src = readFileSync(join(RAIZ, 'src/core/ner/gliner', f), 'utf8');
    const cabecera = src.slice(0, src.indexOf('*/'));
    expect(cabecera).toContain('@piighost/ner-web 0.3.0');
    expect(cabecera).toContain('MIT License');
    expect(cabecera).toContain('Copyright (c) 2025 Athroniaeth');
    expect(cabecera).toContain('Permission is hereby granted, free of charge');
    expect(cabecera).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
    expect(cabecera).toContain('Modificado para Sig-Low:');
  });

  it('T-MO-09 el parche de mT5 está documentado en el tokenizador', () => {
    const src = readFileSync(join(RAIZ, 'src/core/ner/gliner/tokenizer.ts'), 'utf8');
    expect(src).toContain('PARCHE OBLIGATORIO PARA mT5');
  });

  it('T-MO-09 src/core/ner no usa red, almacenamiento, console ni DOM (lista de privacidad)', () => {
    const prohibidos = [
      /\bconsole\s*\./, /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /sendBeacon/,
      /RTCPeerConnection/, /window\.open/, /\blocation\s*=/, /innerHTML|outerHTML|insertAdjacentHTML/,
      /document\.write/, /dangerouslySetInnerHTML/, /localStorage|sessionStorage|document\.cookie/,
      /document\.title\s*=/, /\bdocument\./, /\bwindow\./, /Math\.random/, /\.stack\b/, /error\.message|err\.message|e\.message/,
    ];
    const archivos = listar(join(RAIZ, 'src/core/ner'));
    expect(archivos.length).toBeGreaterThan(8);
    for (const f of archivos) {
      const src = readFileSync(f, 'utf8');
      for (const re of prohibidos) expect(src, `${f} ${String(re)}`).not.toMatch(re);
      // solo se importa la dependencia aprobada en H-0; sin importaciones dinámicas ni require; comillas simples o dobles
      expect(src, `${f} import()`).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
      for (const m of src.matchAll(/(?:\bfrom|\bimport)\s*(['"])([^'"]+)\1/g)) {
        if (!m[2]!.startsWith('.')) expect(['@huggingface/tokenizers'], `${f} importa ${m[2]}`).toContain(m[2]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Tokenizador real y vectores de referencia (H0-16): se saltan si no están
// ---------------------------------------------------------------------------

const MODELOS = resolve(RAIZ, process.env['SIGLOW_MODELOS'] ?? '../h0/modelos');
const REFERENCIA = resolve(RAIZ, process.env['SIGLOW_REFERENCIA'] ?? join(MODELOS, '..', 'referencia-gliner.json'));
const existeReferencia = existsSync(REFERENCIA);
const modelosConTokenizador = ['gliner-x-base', 'gliner-x-large'].filter(
  (m) => existsSync(join(MODELOS, m, 'tokenizer.json')) && existsSync(join(MODELOS, m, 'tokenizer_config.json')),
);
const leerTokenizador = (m: string) =>
  readTokenizer(
    JSON.parse(readFileSync(join(MODELOS, m, 'tokenizer.json'), 'utf8')) as object,
    JSON.parse(readFileSync(join(MODELOS, m, 'tokenizer_config.json'), 'utf8')) as object,
  );

describe.each(['gliner-x-base', 'gliner-x-large'])('T-MO-09 · tokenizador real %s', (m) => {
  const hay = modelosConTokenizador.includes(m);

  it.skipIf(!hay)('T-MO-09 el parche mide prefijo 0, sufijo 1, sin cls; cierra con </s> (id 1)', () => {
    const tk = leerTokenizador(m);
    expect(tk.affixes).toEqual({ prefix: 0, suffix: 1, cls: false });
    expect(tk.clsId).toBeNull();
    expect(tk.sepId).toBe(1);
  });

  it.skipIf(!hay)('T-MO-09 con el parche «Ana» conserva su subtoken; sin él (recorte a ambos lados) quedaría vacío', () => {
    const tk = leerTokenizador(m);
    expect(tk.encodeWord('Ana').length).toBeGreaterThan(0);
    expect(tk.encodeWord('Muñoz')).toEqual([2724, 11344, 360]);
  });

  it.skipIf(!hay)('T-MO-09 el prompt de las tres etiquetas termina en <<SEP>> y reserva 8 tokens (7 del prompt + </s>)', () => {
    const tk = leerTokenizador(m);
    const prompt = encodePrompt(tk);
    expect(prompt[0]).toBe(250100); // <<ENT>>
    expect(prompt.at(-1)).toBe(250101); // <<SEP>>
    expect(prompt.filter((id) => id === 250100)).toHaveLength(3);
    expect(prompt).toHaveLength(7);
    expect(reservedTokens(tk)).toBe(8);
  });

  it.skipIf(!hay)('T-MO-09 secuencia de una frase ficticia: words_mask numera las palabras desde 1 y cierra con </s>', () => {
    const tk = leerTokenizador(m);
    const texto = 'ANA FICTICIA ROJAS vive en Villa Ejemplo.';
    const ws = splitWords(texto).map((w) => w.text);
    const enc = encodeWindow(tk, ws);
    expect(enc.textLength).toBe(ws.length);
    const prompt = encodePrompt(tk).length;
    expect(enc.wordsMask.slice(prompt).filter((v) => v > 0)).toEqual(ws.map((_, i) => i + 1));
    expect(enc.inputIds.at(-1)).toBe(1);
    expect(enc.inputIds).toHaveLength(enc.wordsMask.length);
  });
});

interface TramoReferencia { texto: string; inicio: number; fin: number; etiqueta: string; puntaje: number }
interface PalabraReferencia { t: string; i: number; f: number }
interface ModeloReferencia {
  entrada: { input_ids: number[]; words_mask: number[]; attention_mask: number[]; text_lengths: number[] };
  prompt: { ids: number[]; n_tokens: number };
  ventanas: {
    windowTokens: number; overlapWords: number; reserved: number; subtokens_por_palabra: number[];
    ventanas: Array<[number, number]>; zonas_propias: Array<[number, number]>;
  };
  tramos: TramoReferencia[];
  candidatos_umbral_0_3: SpanCandidate[];
  decodificacion_propia: Array<{ label: string; s: number; e: number; p: number }>;
}
interface FraseReferencia {
  id: string; texto: string; palabras_r_mod_01: PalabraReferencia[]; modelos: Record<string, ModeloReferencia>;
}

describe('T-MO-09 · contra los vectores de referencia de h0/referencia-gliner.json (H0-16)', () => {
  const frases = (): FraseReferencia[] =>
    (JSON.parse(readFileSync(REFERENCIA, 'utf8')) as { frases: FraseReferencia[] }).frases;

  it.skipIf(!existeReferencia)('T-MO-09 referencia: 10 frases, la última del documento largo con varias ventanas', () => {
    const fs = frases();
    expect(fs.length).toBeGreaterThanOrEqual(10);
    expect(fs.some((f) => Object.values(f.modelos).some((m) => m.ventanas.ventanas.length > 1))).toBe(true);
  });

  it.skipIf(!existeReferencia)('T-MO-09 referencia: palabras (R-MOD-01) idénticas, con posiciones UTF-16', () => {
    for (const f of frases()) {
      const ours = splitWords(f.texto).map((w) => ({ t: w.text, i: w.start, f: w.end }));
      expect(ours, f.id).toEqual(f.palabras_r_mod_01.map((p) => ({ t: p.t, i: p.i, f: p.f })));
    }
  });

  it.skipIf(!existeReferencia)('T-MO-09 referencia: el documento largo da [0,293) [256,474) con zonas [0,274) [274,474) y cada tramo esperado cae en una sola zona', () => {
    const f = frases().find((x) => x.id === 'F09')!;
    const ref = f.modelos['gliner-x-base']!;
    expect(ref.ventanas.ventanas).toEqual([[0, 293], [256, 474]]);
    expect(ref.ventanas.zonas_propias).toEqual([[0, 274], [274, 474]]);
    const zonas = ref.ventanas.zonas_propias;
    const esperados = (ref as unknown as { tramos_por_ventanas: Array<{ palabra_inicio: number }> }).tramos_por_ventanas;
    expect(esperados.length).toBeGreaterThan(0);
    for (const t of esperados) expect(zonas.filter((z) => inOwnZone(z, t.palabra_inicio))).toHaveLength(1);
  });

  for (const m of ['gliner-x-base', 'gliner-x-large']) {
    it.skipIf(!existeReferencia || !modelosConTokenizador.includes(m))(
      `T-MO-09 referencia ${m}: ids de tokens, máscara de palabras, prompt y ventanas idénticos`,
      () => {
        const tk = leerTokenizador(m);
        for (const f of frases()) {
          const ref = f.modelos[m];
          if (!ref) continue;
          const textos = splitWords(f.texto).map((w) => w.text);
          const enc = encodeWindow(tk, textos);
          expect(enc.inputIds, `${f.id} input_ids`).toEqual(ref.entrada.input_ids);
          expect(enc.wordsMask, `${f.id} words_mask`).toEqual(ref.entrada.words_mask);
          expect(enc.attentionMask, `${f.id} attention_mask`).toEqual(ref.entrada.attention_mask);
          expect([enc.textLength], `${f.id} text_lengths`).toEqual(ref.entrada.text_lengths);
          expect(encodePrompt(tk), `${f.id} prompt`).toEqual(ref.prompt.ids);
          expect(reservedTokens(tk), `${f.id} reservado`).toBe(ref.ventanas.reserved);
          const counts = countSubtokens(tk, textos);
          expect(counts, `${f.id} subtokens por palabra`).toEqual(ref.ventanas.subtokens_por_palabra);
          const ventanas = planWindows(counts, ref.ventanas.windowTokens, ref.ventanas.overlapWords, ref.ventanas.reserved);
          expect(ventanas, `${f.id} ventanas`).toEqual(ref.ventanas.ventanas);
          expect(ownZones(ventanas, textos.length), `${f.id} zonas propias`).toEqual(ref.ventanas.zonas_propias);
        }
      },
    );

    it.skipIf(!existeReferencia)(
      `T-MO-09 referencia ${m}: la decodificación propia (umbral inclusivo) y los offsets coinciden con los tramos de GLiNER`,
      () => {
        for (const f of frases()) {
          const ref = f.modelos[m];
          if (!ref) continue;
          const ws = splitWords(f.texto);
          const decoded = decodeSpans(ref.candidatos_umbral_0_3, 0.3);
          expect(
            decoded.map((d) => ({ label: d.label, s: d.s, e: d.e, p: d.p })),
            `${f.id} decodificación`,
          ).toEqual(ref.decodificacion_propia);
          if (ref.ventanas.ventanas.length !== 1) continue; // los tramos por ventana exigen logits de cada ventana
          const spans = toNerSpans(decoded, ws, [0, ws.length], [0, ws.length]);
          expect(
            spans.map((s) => ({ start: s.start, end: s.end, texto: f.texto.slice(s.start, s.end) })),
            `${f.id} offsets`,
          ).toEqual(ref.tramos.map((t) => ({ start: t.inicio, end: t.fin, texto: t.texto })));
          spans.forEach((s, i) => expect(s.score).toBeCloseTo(ref.tramos[i]!.puntaje, 3));
        }
      },
    );
  }
});

// ---------------------------------------------------------------------------
// Protocolo del worker `ner` (handler.ts) con un motor simulado: INV-W01, INV-W07, INV-W08
// ---------------------------------------------------------------------------

class MotorFalso implements NerEngine {
  readonly engineId = 'gliner-x-base' as const;
  liberado = false;
  constructor(private readonly alCargar?: () => never) {}
  load(onProgress: (p: NerLoadProgress) => void): Promise<NerLoadResult> {
    if (this.alCargar) this.alCargar();
    for (let i = 0; i <= 50; i++) onProgress({ phase: 'verificando', done: i, total: 50 });
    return Promise.resolve({ engineId: 'gliner-x-base', modelId: 'gliner-x-base', sha256: 'a'.repeat(64), threads: 4, crossOriginIsolated: true, labels: ['PER'], decoder: 'gliner-spans', loadMs: 1, warmupWindowMs: 1 });
  }
  planWindows(text: string): number { return Math.ceil(text.length / 10); }
  async detect(text: string, _o: NerOptions, signal: AbortSignal, onWindow?: (w: NerWindowResult) => void): Promise<NerSpan[]> {
    const n = this.planWindows(text);
    const todos: NerSpan[] = [];
    for (let i = 0; i < n; i++) {
      if (signal.aborted) throw new NerAbortError();
      await new Promise((r) => setTimeout(r, 5));
      const spans: NerSpan[] = [{ start: i, end: i + 1, label: 'PER', score: 0.9 }];
      todos.push(...spans);
      onWindow?.({ partId: '' as PartId, windowIndex: i, windowTotal: n, spans, ms: 5 });
    }
    return todos;
  }
  dispose(): Promise<void> { this.liberado = true; return Promise.resolve(); }
}

const MANIFIESTO_MINIMO = {
  formato: 'sig-low/modelo', v: 1, id: 'gliner-x-base', archivo: 'onnx/model_quantized.onnx', tamano: 10, sha256: 'a'.repeat(64),
  auxiliares: [], tokenizador: { prefijo: 0, sufijo: 1, cls: false }, ventanaTokens: 512, solapePalabras: 37, umbral: 0.3, etiquetas: ['person', 'organization', 'location'],
} as unknown as ModelManifest;

function banco(motor: NerEngine = new MotorFalso()): { enviar: (m: unknown) => void; salida: NerResponse[]; esperar: (f: (s: NerResponse[]) => boolean) => Promise<void> } {
  const salida: NerResponse[] = [];
  const enviar = crearManejadorNer({ post: (m) => salida.push(m), crearMotor: () => motor });
  const esperar = async (f: (s: NerResponse[]) => boolean): Promise<void> => {
    for (let i = 0; i < 400 && !f(salida); i++) await new Promise((r) => setTimeout(r, 5));
    expect(f(salida)).toBe(true);
  };
  return { enviar, salida, esperar };
}
const req = (reqId: string, kind: string, payload: unknown) => ({ v: 1, reqId, kind, payload });
const OPC = { windowTokens: 512, overlapWords: 37, maxSpanWords: 12, threshold: 0.3, labels: ['person', 'organization', 'location'], threads: 4 };
const PARTE_A = 'parte_0000000000000000000000000000000a';

describe('T-MO-09 · worker ner: protocolo (INV-W01, INV-W07, INV-W08)', () => {
  it('INV-W01 un mensaje de error solo tiene v, reqId, kind, code y retryable, y no repite lo recibido', async () => {
    const b = banco();
    b.enviar({ v: 1, reqId: 'x1', kind: 'inventado', payload: { texto: 'Ana Ficticia Rojas' } });
    b.enviar({ v: 2, reqId: 'x2', kind: 'cargar', payload: {} });
    b.enviar(req('x3', 'cargar', { manifest: { formato: 'Ana Ficticia Rojas' } }));
    b.enviar(req('x4', 'detectar', { parts: [{ partId: 1 }], options: OPC }));
    b.enviar('Ana Ficticia Rojas');
    await b.esperar((s) => s.length === 5);
    for (const m of b.salida) {
      expect(Object.keys(m).sort()).toEqual(['code', 'kind', 'reqId', 'retryable', 'v']);
      expect(m).toMatchObject({ kind: 'error', code: 'ENTRADA_INVALIDA', retryable: false });
    }
    expect(JSON.stringify(b.salida)).not.toContain('Ana');
  });

  it('INV-W01 un fallo del motor con texto del documento en la excepción sale solo como código', async () => {
    const b = banco(new MotorFalso(() => { throw new Error('fallo con Ana Ficticia Rojas en el texto'); }));
    b.enviar(req('c1', 'cargar', { manifest: MANIFIESTO_MINIMO }));
    await b.esperar((s) => s.length === 1);
    expect(b.salida[0]).toEqual({ v: 1, reqId: 'c1', kind: 'error', code: 'ERROR_INTERNO', retryable: false });
  });

  it('T-MO-09 cargar: progreso en bytes, a lo sumo uno cada 100 ms, y el resultado con NerLoadResult', async () => {
    const b = banco();
    b.enviar(req('c2', 'cargar', { manifest: MANIFIESTO_MINIMO }));
    await b.esperar((s) => s.some((m) => m.kind === 'resultado'));
    const prog = b.salida.filter((m) => m.kind === 'progreso');
    expect(prog.length).toBeGreaterThan(0);
    expect(prog.length).toBeLessThan(10);
    for (const p of prog) expect(p).toMatchObject({ stage: 'modelo_carga', unit: 'bytes' });
    expect(b.salida.at(-1)).toMatchObject({ kind: 'resultado', payload: { kind: 'cargar', load: { engineId: 'gliner-x-base', threads: 4 } } });
  });

  it('INV-W07 parcial y progreso no llevan texto: el parcial solo trae partId, posiciones, etiquetas y puntajes', async () => {
    const b = banco();
    b.enviar(req('c3', 'cargar', { manifest: MANIFIESTO_MINIMO }));
    b.enviar(req('d1', 'detectar', { parts: [{ partId: PARTE_A, text: 'Ana Ficticia Rojas vive en Villa Ejemplo y trabaja ahí.' }, { partId: 'parte_0000000000000000000000000000000b', text: '' }], options: OPC }));
    await b.esperar((s) => s.some((m) => m.reqId === 'd1' && m.kind === 'resultado'));
    const d = b.salida.filter((m) => m.reqId === 'd1');
    const parciales = d.filter((m) => m.kind === 'parcial');
    expect(parciales.length).toBe(6);
    for (const [i, p] of parciales.entries()) {
      expect(Object.keys(p).sort()).toEqual(['kind', 'payload', 'reqId', 'v']);
      const pl = (p as { payload: { windowsDone: number; windowsTotal: number; window: NerWindowResult } }).payload;
      expect(Object.keys(pl).sort()).toEqual(['window', 'windowsDone', 'windowsTotal']);
      expect(Object.keys(pl.window).sort()).toEqual(['ms', 'partId', 'spans', 'windowIndex', 'windowTotal']);
      expect(pl.window.partId).toBe(PARTE_A);
      expect(pl.windowsDone).toBe(i + 1);
      expect(pl.windowsTotal).toBe(6);
      for (const s of pl.window.spans) expect(Object.keys(s).sort()).toEqual(['end', 'label', 'score', 'start']);
    }
    for (const p of d.filter((m) => m.kind === 'progreso')) {
      expect(Object.keys(p).sort()).toEqual(['done', 'kind', 'reqId', 'stage', 'total', 'unit', 'v']);
      expect(p).toMatchObject({ stage: 'modelo', unit: 'ventanas', total: 6 });
    }
    expect(d[0]).toMatchObject({ kind: 'progreso', done: 0, total: 6 }); // primer progreso con el total del documento
    expect(d.at(-1)).toMatchObject({ kind: 'resultado', payload: { kind: 'detectar', windows: 6 } });
    expect(JSON.stringify(d)).not.toContain('Ficticia');
  });

  it('INV-W08 tras cancelar no sale otro parcial, se responde cancelado y no hay resultado', async () => {
    const b = banco();
    b.enviar(req('c4', 'cargar', { manifest: MANIFIESTO_MINIMO }));
    b.enviar(req('d2', 'detectar', { parts: [{ partId: PARTE_A, text: 'x'.repeat(400) }], options: OPC }));
    await b.esperar((s) => s.some((m) => m.reqId === 'd2' && m.kind === 'parcial'));
    b.enviar(req('d2-c', 'cancelar', { targetReqId: 'd2' }));
    await b.esperar((s) => s.some((m) => m.reqId === 'd2' && m.kind === 'cancelado'));
    const cuantos = b.salida.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(b.salida.length).toBe(cuantos); // no llega nada más
    const d = b.salida.filter((m) => m.reqId === 'd2');
    expect(d.at(-1)!.kind).toBe('cancelado');
    expect(d.filter((m) => m.kind === 'parcial').length).toBeLessThan(40);
    expect(d.some((m) => m.kind === 'resultado')).toBe(false);
    expect(b.salida.some((m) => m.reqId === 'd2-c')).toBe(false);
  });

  it('T-MO-09 detectar sin cargar responde MODELO_NO_DESCARGADO', async () => {
    const b = banco();
    b.enviar(req('d3', 'detectar', { parts: [{ partId: PARTE_A, text: 'hola' }], options: OPC }));
    await b.esperar((s) => s.length === 1);
    expect(b.salida[0]).toEqual({ v: 1, reqId: 'd3', kind: 'error', code: 'MODELO_NO_DESCARGADO', retryable: true });
  });

  it('T-MO-09 liberar suelta el motor y deja de detectar', async () => {
    const motor = new MotorFalso();
    const b = banco(motor);
    b.enviar(req('c5', 'cargar', { manifest: MANIFIESTO_MINIMO }));
    b.enviar(req('l1', 'liberar', {}));
    b.enviar(req('d4', 'detectar', { parts: [{ partId: PARTE_A, text: 'hola' }], options: OPC }));
    await b.esperar((s) => s.some((m) => m.reqId === 'd4'));
    expect(motor.liberado).toBe(true);
    expect(b.salida.find((m) => m.reqId === 'l1')).toMatchObject({ kind: 'resultado', payload: { kind: 'liberar' } });
    expect(b.salida.find((m) => m.reqId === 'd4')).toMatchObject({ kind: 'error', code: 'MODELO_NO_DESCARGADO' });
  });
});

describe('T-MO-09 · worker ner: nada del documento en la consola ni en los errores (INV-W01, INV-W02, F-07)', () => {
  const metodos = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;

  it('INV-W02 un fallo con texto del documento en la excepción no llega a la consola ni a ningún mensaje', async () => {
    const espias = metodos.map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    try {
      const fallos: Array<() => never> = [
        () => { throw new Error('fallo con Ana Ficticia Rojas en el texto'); },
        () => { throw 'Ana Ficticia Rojas como cadena'; },
        () => { throw { message: 'Ana Ficticia Rojas', stack: 'Ana Ficticia Rojas' }; },
        () => { throw new SiglowError('MODELO_INTEGRIDAD'); },
        () => { throw new GlinerError('ENTRADA_INVALIDA'); },
      ];
      const esperados = ['ERROR_INTERNO', 'ERROR_INTERNO', 'ERROR_INTERNO', 'MODELO_INTEGRIDAD', 'ENTRADA_INVALIDA'];
      for (const [i, fallo] of fallos.entries()) {
        const b = banco(new MotorFalso(fallo));
        b.enviar(req(`f${i}`, 'cargar', { manifest: MANIFIESTO_MINIMO }));
        await b.esperar((s) => s.length === 1);
        expect(b.salida[0]).toMatchObject({ kind: 'error', code: esperados[i] });
        expect(Object.keys(b.salida[0]!).sort()).toEqual(['code', 'kind', 'reqId', 'retryable', 'v']);
        expect(JSON.stringify(b.salida)).not.toContain('Ana');
      }
      for (const e of espias) expect(e).not.toHaveBeenCalled();
    } finally {
      for (const e of espias) e.mockRestore();
    }
  });

  it('INV-W02 una excepción síncrona del manejador o de planWindows sale como ERROR_INTERNO, sin su texto', async () => {
    const b = banco();
    const trampa = { reqId: 'g1', kind: 'liberar', get v(): number { throw new Error('Ana Ficticia Rojas'); } };
    b.enviar(trampa);
    await b.esperar((s) => s.length === 1);
    expect(b.salida[0]).toEqual({ v: 1, reqId: 'g1', kind: 'error', code: 'ERROR_INTERNO', retryable: false });

    const roto = new MotorFalso();
    roto.planWindows = () => { throw new Error('Ana Ficticia Rojas'); };
    const c = banco(roto);
    c.enviar(req('c6', 'cargar', { manifest: MANIFIESTO_MINIMO }));
    c.enviar(req('d5', 'detectar', { parts: [{ partId: PARTE_A, text: 'Ana' }], options: OPC }));
    await c.esperar((s) => s.some((m) => m.reqId === 'd5'));
    expect(c.salida.find((m) => m.reqId === 'd5')).toEqual({ v: 1, reqId: 'd5', kind: 'error', code: 'ERROR_INTERNO', retryable: false });
  });

  it('INV-W01 clasifica por clase: reserva que no cabe → MEMORIA; cuota → CUOTA_EXCEDIDA; lo demás → ERROR_INTERNO', () => {
    expect(codigoDeError(new RangeError('Ana'))).toBe('MEMORIA');
    expect(codigoDeError(Object.assign(new Error('Ana'), { name: 'QuotaExceededError' }))).toBe('CUOTA_EXCEDIDA');
    expect(codigoDeError(new TypeError('Ana'))).toBe('ERROR_INTERNO');
    expect(codigoDeError(undefined)).toBe('ERROR_INTERNO');
  });
});
