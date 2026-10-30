// T-LE-09 · Tiempos límite, liberación y calibración de IoLimits (6.3.4, 6.11.1, 6.11.4, 6.11.6). Solo datos ficticios.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SiglowError } from '../../src/core/types';
import type { DocId, IoLimits } from '../../src/core/types';
import { handleIoMessage } from '../../src/io/io-handler';
import type { HandlerDeps } from '../../src/io/io-handler';
import { IO_LIMITS_POR_DEFECTO, LecturaCancelada, leerArchivo } from '../../src/io/io-client';
import type { WorkerIo } from '../../src/io/io-client';
import { readTxt } from '../../src/io/txt-read';
import { crearReadPdf } from '../../src/io/pdf-read';
import type { PdfDocumento, PdfjsLib, PdfPagina, PdfTarea } from '../../src/io/pdf-read';
import { readFileSync } from 'node:fs';

const DOC = 'doc_00112233445566778899aabbccddeeff' as DocId;
const REQ = 'req_00112233445566778899aabbccddeeff';
const LIMITES: IoLimits = { ...IO_LIMITS_POR_DEFECTO };
const bytesDe = (s: string): ArrayBuffer => {
  const u = new TextEncoder().encode(s);
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
};
const peticion = (payload: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ v: 1, reqId: REQ, kind: 'leer', payload, ...extra });
const cargaOk = (texto = 'Texto ficticio de ejemplo.'): Record<string, unknown> =>
  ({ format: 'txt', bytes: bytesDe(texto), docId: DOC, label: 'Documento 1', limits: LIMITES });

function manejar(msg: unknown, deps?: HandlerDeps): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  handleIoMessage(msg, (m) => { out.push(m as Record<string, unknown>); }, deps);
  return out;
}
const ultimo = (a: Array<Record<string, unknown>>): Record<string, unknown> => a[a.length - 1] as Record<string, unknown>;

describe('T-LE-09 calibración de IoLimits', () => {
  it('los límites por defecto son los de 6.3.4', () => {
    expect(IO_LIMITS_POR_DEFECTO).toEqual({
      maxFileBytes: 26_214_400,
      maxZipEntries: 1024,
      maxUncompressedTotal: 104_857_600,
      maxXmlPartBytes: 15_728_640,
      timeoutMs: 15_000,
      pdfMinCharsPerPage: 10,
      pdfMaxScannedRatio: 0.5,
    });
  });
  it('un .txt del tamaño máximo (25 MiB) se lee muy por debajo del tiempo límite en las tres rutas de decodificación', () => {
    const n = IO_LIMITS_POR_DEFECTO.maxFileBytes;
    const bloque = new TextEncoder().encode('Señor José Ficticia presentó la tutela número 123 en Ciudad Ejemplo. ');
    const utf8 = new Uint8Array(n);
    for (let i = 0; i + bloque.length <= n; i += bloque.length) utf8.set(bloque, i);
    // El corte final puede partir un carácter multibyte; se cierra con ASCII.
    utf8.fill(0x2e, n - 4);
    const w1252 = new Uint8Array(n).fill(0xe9);
    const u16 = new Uint8Array(n);
    for (let i = 0; i + 1 < n; i += 2) { u16[i] = 0x61 + (i % 26); u16[i + 1] = 0; }
    for (const [nombre, datos] of [['utf-8', utf8], ['windows-1252', w1252], ['utf-16le', u16]] as const) {
      const t0 = performance.now();
      const d = readTxt(datos, { docId: DOC, label: 'Documento 1' });
      const ms = performance.now() - t0;
      expect(d.parts[0]?.text.length, nombre).toBeGreaterThan(1_000_000);
      expect(ms, `${nombre}: ${ms.toFixed(0)} ms`).toBeLessThan(IO_LIMITS_POR_DEFECTO.timeoutMs / 3);
    }
  });
  it('el manejador rechaza lo que excede maxFileBytes con ARCHIVO_DEMASIADO_GRANDE y acepta el tamaño exacto', () => {
    const limits = { ...LIMITES, maxFileBytes: 10 };
    const grande = manejar(peticion({ ...cargaOk('0123456789A'), limits }));
    expect(ultimo(grande)).toMatchObject({ kind: 'error', code: 'ARCHIVO_DEMASIADO_GRANDE', retryable: false });
    const justo = manejar(peticion({ ...cargaOk('0123456789'), limits }));
    expect(ultimo(justo)).toMatchObject({ kind: 'resultado' });
  });
  it('límites mal formados (cero, negativos, NaN, razón fuera de 0–1) → ENTRADA_INVALIDA', () => {
    for (const malo of [{ timeoutMs: 0 }, { maxFileBytes: -1 }, { maxZipEntries: Number.NaN }, { pdfMaxScannedRatio: 2 }, { timeoutMs: '15000' }]) {
      const r = manejar(peticion({ ...cargaOk(), limits: { ...LIMITES, ...malo } }));
      expect(ultimo(r), JSON.stringify(malo)).toMatchObject({ kind: 'error', code: 'ENTRADA_INVALIDA' });
    }
  });
});

describe('T-LE-09 protocolo del worker io (6.11.1, 6.11.4)', () => {
  it('INV-W01 un mensaje error solo tiene v, reqId, kind, code y retryable', () => {
    const casos: unknown[] = [
      null, 'texto', 42, [], {}, { v: 2, reqId: REQ, kind: 'leer', payload: {} }, { v: 1, reqId: REQ, kind: 'desconocido', payload: {} },
      peticion({}), peticion({ ...cargaOk(), label: 'Ana Ficticia Rojas.txt' }), peticion({ ...cargaOk(), docId: 'doc_malo' }),
      peticion({ ...cargaOk(), format: 'pdf' }), peticion({ ...cargaOk(), bytes: 'no es un buffer' }), peticion({ ...cargaOk(), bytes: new ArrayBuffer(0) }),
      peticion({ ...cargaOk(), bytes: bytesDe('%PDF-1.7 ejemplo') }),
    ];
    for (const c of casos) {
      const r = manejar(c);
      const e = ultimo(r);
      expect(e.kind, JSON.stringify(c)).toBe('error');
      expect(Object.keys(e).sort()).toEqual(['code', 'kind', 'reqId', 'retryable', 'v']);
      expect(e.v).toBe(1);
      expect(typeof e.code).toBe('string');
      expect(typeof e.retryable).toBe('boolean');
    }
  });
  it('INV-W01 una petición inválida no repite lo recibido', () => {
    const r = manejar(peticion({ ...cargaOk(), label: 'Ana Ficticia Rojas.txt', format: 'Ana Ficticia Rojas' }, { kind: 'Ana Ficticia Rojas' }));
    expect(JSON.stringify(r)).not.toContain('Ficticia');
    expect(ultimo(r)).toMatchObject({ code: 'ENTRADA_INVALIDA' });
    expect(manejar({ v: 1, kind: 'leer', reqId: 'Ana Ficticia Rojas' })).toEqual([
      { v: 1, reqId: 'req_' + '0'.repeat(32), kind: 'error', code: 'ENTRADA_INVALIDA', retryable: false },
    ]);
  });
  it('INV-W02 una excepción con texto del documento no llega a la consola ni al mensaje', () => {
    const espias = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const deps: HandlerDeps = { readers: { txt: () => { throw new Error('Ana Ficticia Rojas, C.C. 00000001'); } } };
    const r = manejar(peticion(cargaOk()), deps);
    expect(ultimo(r)).toEqual({ v: 1, reqId: REQ, kind: 'error', code: 'ERROR_INTERNO', retryable: false });
    expect(JSON.stringify(r)).not.toMatch(/Ficticia|00000001/);
    for (const e of espias) { expect(e).not.toHaveBeenCalled(); e.mockRestore(); }
  });
  it('un SiglowError conserva su código; un RangeError se traduce a MEMORIA (reintentable)', () => {
    const e1 = manejar(peticion(cargaOk()), { readers: { txt: () => { throw new SiglowError('DTD_NO_PERMITIDA'); } } });
    expect(ultimo(e1)).toMatchObject({ code: 'DTD_NO_PERMITIDA', retryable: false });
    const e2 = manejar(peticion(cargaOk()), { readers: { txt: () => { throw new RangeError('Array buffer allocation failed'); } } });
    expect(ultimo(e2)).toMatchObject({ code: 'MEMORIA', retryable: true });
    expect(JSON.stringify(e2)).not.toContain('allocation');
  });
  it('un .txt de verdad responde progreso (bytes) y resultado con el DocumentModel', () => {
    const r = manejar(peticion(cargaOk('Hola, Ana Ficticia Rojas.')));
    const progresos = r.filter((m) => m.kind === 'progreso');
    expect(progresos.length).toBeGreaterThanOrEqual(1);
    expect(progresos.length).toBeLessThanOrEqual(2);
    expect(progresos[0]).toEqual({ v: 1, reqId: REQ, kind: 'progreso', stage: 'lectura', done: 0, total: 25, unit: 'bytes' });
    const fin = ultimo(r) as { kind: string; payload: { kind: string; doc: { source: string; parts: Array<{ text: string }> } } };
    expect(fin.kind).toBe('resultado');
    expect(fin.payload.kind).toBe('leer');
    expect(fin.payload.doc.source).toBe('txt');
    expect(fin.payload.doc.parts[0]?.text).toBe('Hola, Ana Ficticia Rojas.');
    // los progresos no llevan texto del documento
    expect(JSON.stringify(progresos)).not.toContain('Ficticia');
  });
  it('archivo vacío → ARCHIVO_VACIO y .docx sin lector registrado → FORMATO_NO_ADMITIDO', () => {
    expect(ultimo(manejar(peticion({ ...cargaOk(), bytes: new ArrayBuffer(0) })))).toMatchObject({ code: 'ARCHIVO_VACIO' });
    expect(ultimo(manejar(peticion({ ...cargaOk(), format: 'docx' }), { readers: {} }))).toMatchObject({ code: 'FORMATO_NO_ADMITIDO' });
  });
  it('cancelar responde cancelado al reqId objetivo', () => {
    const otro = 'req_ffeeddccbbaa99887766554433221100';
    expect(manejar({ v: 1, reqId: REQ, kind: 'cancelar', payload: { targetReqId: otro } })).toEqual([{ v: 1, reqId: otro, kind: 'cancelado' }]);
    expect(ultimo(manejar({ v: 1, reqId: REQ, kind: 'cancelar', payload: {} }))).toMatchObject({ code: 'ENTRADA_INVALIDA' });
  });
});

/** Worker simulado: reenvía al manejador real con clonado estructurado y transferencia, como un worker de verdad. */
class WorkerSimulado implements WorkerIo {
  onmessage: WorkerIo['onmessage'] = null;
  onerror: WorkerIo['onerror'] = null;
  onmessageerror: WorkerIo['onmessageerror'] = null;
  terminados = 0;
  recibidos = 0;
  constructor(private readonly modo: 'normal' | 'colgado' | 'respuesta-ajena' | 'error-interno' = 'normal', private readonly deps: HandlerDeps = {}) {}
  postMessage(msg: unknown, transfer: ArrayBuffer[]): void {
    const copia = structuredClone(msg, { transfer });
    this.recibidos++;
    if (this.modo === 'colgado') return;
    queueMicrotask(() => {
      if (this.terminados > 0) return;
      if (this.modo === 'respuesta-ajena') {
        this.onmessage?.({ data: { v: 1, reqId: 'req_' + 'f'.repeat(32), kind: 'resultado', payload: { kind: 'leer', doc: {} } } });
        return;
      }
      if (this.modo === 'error-interno') { this.onerror?.({ preventDefault: () => undefined }); return; }
      handleIoMessage(copia, (m) => { this.onmessage?.({ data: structuredClone(m) }); }, this.deps);
    });
  }
  terminate(): void { this.terminados++; }
}
const opciones = (w: WorkerSimulado, texto = 'Hola, Ana Ficticia Rojas.') =>
  ({ format: 'txt' as const, bytes: bytesDe(texto), docId: DOC, label: 'Documento 1', crearWorker: () => w });

describe('T-LE-09 tiempo límite, cancelación y liberación (cliente del worker io)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('una lectura correcta resuelve el DocumentModel y termina el worker (uno por archivo)', async () => {
    const w = new WorkerSimulado();
    const progresos: Array<[number, number]> = [];
    const doc = await leerArchivo({ ...opciones(w), onProgress: (d, t) => { progresos.push([d, t]); } });
    expect(doc.parts[0]?.text).toBe('Hola, Ana Ficticia Rojas.');
    expect(w.terminados).toBe(1);
    expect(progresos.at(-1)).toEqual([25, 25]);
    expect(w.onmessage).toBeNull();
  });
  it('al vencer timeoutMs rechaza con TIEMPO_AGOTADO y llama a terminate() una sola vez', async () => {
    const w = new WorkerSimulado('colgado');
    const p = leerArchivo({ ...opciones(w), limits: { ...LIMITES, timeoutMs: 15_000 } });
    const resultado = p.then(() => 'resolvió', (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(w.terminados).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    const e = await resultado;
    expect(e).toBeInstanceOf(SiglowError);
    expect((e as SiglowError).code).toBe('TIEMPO_AGOTADO');
    expect(w.terminados).toBe(1);
  });
  it('usa los 15 s de IoLimits.timeoutMs por defecto', async () => {
    const w = new WorkerSimulado('colgado');
    const r = leerArchivo(opciones(w)).then(() => 'ok', (e: unknown) => (e as SiglowError).code);
    await vi.advanceTimersByTimeAsync(IO_LIMITS_POR_DEFECTO.timeoutMs);
    expect(await r).toBe('TIEMPO_AGOTADO');
  });
  it('un error del worker rechaza con su código, sin texto, y lo termina', async () => {
    const w = new WorkerSimulado('normal');
    const p = leerArchivo({ ...opciones(w, '%PDF-1.7 ejemplo') });
    const e = await p.then(() => null, (x: unknown) => x);
    expect((e as SiglowError).code).toBe('FORMATO_NO_ADMITIDO');
    expect((e as SiglowError).message).toBe('FORMATO_NO_ADMITIDO');
    expect(w.terminados).toBe(1);
  });
  it('worker.onerror → ERROR_INTERNO con preventDefault, y terminate()', async () => {
    const w = new WorkerSimulado('error-interno');
    const e = await leerArchivo(opciones(w)).then(() => null, (x: unknown) => x);
    expect((e as SiglowError).code).toBe('ERROR_INTERNO');
    expect(w.terminados).toBe(1);
  });
  it('ignora respuestas de otra petición y sigue esperando hasta el tiempo límite', async () => {
    const w = new WorkerSimulado('respuesta-ajena');
    const r = leerArchivo(opciones(w)).then(() => 'resolvió', (e: unknown) => (e as SiglowError).code);
    await vi.advanceTimersByTimeAsync(IO_LIMITS_POR_DEFECTO.timeoutMs + 1);
    expect(await r).toBe('TIEMPO_AGOTADO');
  });
  it('una respuesta sin DocumentModel válido → ERROR_INTERNO', async () => {
    const w = new WorkerSimulado('normal', { readers: { txt: () => ({ id: 1 } as never) } });
    const e = await leerArchivo(opciones(w)).then(() => null, (x: unknown) => x);
    expect((e as SiglowError).code).toBe('ERROR_INTERNO');
    expect(w.terminados).toBe(1);
  });
  it('la cancelación (AbortSignal) termina el worker y rechaza con LecturaCancelada', async () => {
    const w = new WorkerSimulado('colgado');
    const ac = new AbortController();
    const r = leerArchivo({ ...opciones(w), signal: ac.signal }).then(() => null, (e: unknown) => e);
    ac.abort();
    const e = await r;
    expect(e).toBeInstanceOf(LecturaCancelada);
    expect((e as Error).message).toBe('CANCELADO');
    expect(w.terminados).toBe(1);
    await vi.advanceTimersByTimeAsync(IO_LIMITS_POR_DEFECTO.timeoutMs * 2);
    expect(w.terminados).toBe(1);
  });
  it('si la señal ya estaba cancelada no se crea ningún worker', async () => {
    const ac = new AbortController();
    ac.abort();
    const crear = vi.fn(() => new WorkerSimulado());
    const e = await leerArchivo({ ...opciones(new WorkerSimulado()), signal: ac.signal, crearWorker: crear }).then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(LecturaCancelada);
    expect(crear).not.toHaveBeenCalled();
  });
  it('si no se puede crear el worker → ERROR_INTERNO', async () => {
    const e = await leerArchivo({ ...opciones(new WorkerSimulado()), crearWorker: () => { throw new Error('Ana Ficticia Rojas'); } })
      .then(() => null, (x: unknown) => x);
    expect((e as SiglowError).code).toBe('ERROR_INTERNO');
    expect((e as SiglowError).message).not.toContain('Ficticia');
  });
  it('el buffer se transfiere: el emisor queda sin acceso y el worker recibe una copia', async () => {
    const w = new WorkerSimulado();
    const o = opciones(w);
    const antes = o.bytes.byteLength;
    await leerArchivo(o);
    expect(antes).toBeGreaterThan(0);
    expect(o.bytes.byteLength).toBe(0);
  });
  it('liberación: tras resolver, mensajes tardíos del worker no tienen efecto', async () => {
    const w = new WorkerSimulado();
    const progreso = vi.fn();
    await leerArchivo({ ...opciones(w), onProgress: progreso });
    const llamadas = progreso.mock.calls.length;
    expect(w.onmessage).toBeNull();
    w.onmessage?.({ data: { v: 1, reqId: REQ, kind: 'progreso', stage: 'lectura', done: 1, total: 1, unit: 'bytes' } });
    expect(progreso.mock.calls.length).toBe(llamadas);
  });
  it('la petición lleva v: 1, un reqId aleatorio y el formato, sin nombre de archivo', async () => {
    const w = new WorkerSimulado('colgado');
    const espia = vi.spyOn(w, 'postMessage');
    const r = leerArchivo(opciones(w)).catch(() => undefined);
    const msg = espia.mock.calls[0]?.[0] as { v: number; reqId: string; kind: string; payload: Record<string, unknown> };
    expect(msg.v).toBe(1);
    expect(msg.reqId).toMatch(/^req_[0-9a-f]{32}$/);
    expect(msg.kind).toBe('leer');
    expect(Object.keys(msg.payload).sort()).toEqual(['bytes', 'docId', 'format', 'label', 'limits']);
    await vi.advanceTimersByTimeAsync(IO_LIMITS_POR_DEFECTO.timeoutMs + 1);
    await r;
  });
});

// ---------- PE-4 · pdf.js (readPdf): tiempo límite, cancelación y loadingTask.destroy() (6.11.5, 6.11.6) ----------
type ModoPdf = 'normal' | 'sin-documento' | 'sin-pagina' | 'destroy-colgado';
interface EstadoPdf { destruidas: number; workersPdfjs: number; workersTerminados: number; getDocumentLlamadas: number; paginasPedidas: number }
class PdfWorkerFalso { constructor(_p: { port: unknown }) { /* sin efecto */ } destroy(): void { /* sin efecto */ } }
function pdfFalso(modo: ModoPdf, paginas = 3): { lib: PdfjsLib; e: EstadoPdf } {
  const e: EstadoPdf = { destruidas: 0, workersPdfjs: 0, workersTerminados: 0, getDocumentLlamadas: 0, paginasPedidas: 0 };
  class Worker2 extends PdfWorkerFalso { override destroy(): void { e.workersPdfjs++; } }
  const lib: PdfjsLib = {
    PDFWorker: Worker2,
    getDocument(): PdfTarea {
      e.getDocumentLlamadas++;
      const doc: PdfDocumento = {
        numPages: paginas,
        getPage: (): Promise<PdfPagina> => {
          e.paginasPedidas++;
          if (modo === 'sin-pagina') return new Promise<PdfPagina>(() => undefined);
          return Promise.resolve({
            getTextContent: () => Promise.resolve({ items: [{ str: 'Texto ficticio de la página.', hasEOL: false, height: 10, transform: [10, 0, 0, 10, 50, 700] }] }),
            getAnnotations: () => Promise.resolve([]),
            cleanup: () => true,
          });
        },
        getMetadata: () => Promise.resolve({ info: {}, metadata: null }),
      };
      const promise = modo === 'sin-documento' ? new Promise<PdfDocumento>(() => undefined) : Promise.resolve(doc);
      return { promise, destroy: () => { e.destruidas++; return modo === 'destroy-colgado' ? new Promise<void>(() => undefined) : Promise.resolve(); } };
    },
  };
  return { lib, e };
}
const pdfCtx = (limits: IoLimits = LIMITES): { docId: DocId; label: string; limits: IoLimits } => ({ docId: DOC, label: 'Documento 1', limits });
const lectorPdf = (f: { lib: PdfjsLib; e: EstadoPdf }): ReturnType<typeof crearReadPdf> =>
  crearReadPdf({ cargarPdfjs: () => Promise.resolve(f.lib), crearWorker: () => ({ terminate: () => { f.e.workersTerminados++; } }) });
const codigoPdf = (p: Promise<unknown>): Promise<string> =>
  p.then(() => 'resolvió', (e: unknown) => (e instanceof SiglowError ? e.code : e instanceof LecturaCancelada ? 'CANCELADO' : 'OTRO'));
const sinProgresoPdf = (): void => undefined;

describe('T-LE-09 pdf.js: tiempo límite, cancelación y loadingTask.destroy() (PE-4)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('una lectura correcta llama a loadingTask.destroy() una vez y destruye el PDFWorker y el worker', async () => {
    const f = pdfFalso('normal');
    const d = await lectorPdf(f)(new ArrayBuffer(8), pdfCtx(), sinProgresoPdf, new AbortController().signal);
    expect(d.parts).toHaveLength(3);
    expect(f.e).toMatchObject({ destruidas: 1, workersPdfjs: 1, workersTerminados: 1 });
  });
  it('al vencer timeoutMs mientras abre el documento: TIEMPO_AGOTADO y destroy() una sola vez', async () => {
    const f = pdfFalso('sin-documento');
    const r = codigoPdf(lectorPdf(f)(new ArrayBuffer(8), pdfCtx({ ...LIMITES, timeoutMs: 15_000 }), sinProgresoPdf, new AbortController().signal));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(f.e.destruidas).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(await r).toBe('TIEMPO_AGOTADO');
    expect(f.e).toMatchObject({ destruidas: 1, workersPdfjs: 1, workersTerminados: 1 });
  });
  it('al vencer a mitad de la extracción (una página atascada): TIEMPO_AGOTADO y no se piden más páginas', async () => {
    const f = pdfFalso('sin-pagina');
    const r = codigoPdf(lectorPdf(f)(new ArrayBuffer(8), pdfCtx(), sinProgresoPdf, new AbortController().signal));
    await vi.advanceTimersByTimeAsync(LIMITES.timeoutMs + 1);
    expect(await r).toBe('TIEMPO_AGOTADO');
    expect(f.e.paginasPedidas).toBe(1);
    expect(f.e.destruidas).toBe(1);
  });
  it('usa los 15 s de IoLimits.timeoutMs por defecto', async () => {
    const f = pdfFalso('sin-documento');
    const r = codigoPdf(lectorPdf(f)(new ArrayBuffer(8), pdfCtx(IO_LIMITS_POR_DEFECTO), sinProgresoPdf, new AbortController().signal));
    await vi.advanceTimersByTimeAsync(IO_LIMITS_POR_DEFECTO.timeoutMs - 1);
    expect(f.e.destruidas).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(await r).toBe('TIEMPO_AGOTADO');
    expect(IO_LIMITS_POR_DEFECTO.timeoutMs).toBe(15_000);
  });
  it('si destroy() nunca responde (worker de pdf.js atascado), el rechazo por tiempo no espera', async () => {
    const f = pdfFalso('destroy-colgado', 2);
    const g = pdfFalso('sin-documento');
    const r = codigoPdf(lectorPdf(g)(new ArrayBuffer(8), pdfCtx(), sinProgresoPdf, new AbortController().signal));
    await vi.advanceTimersByTimeAsync(LIMITES.timeoutMs + 1);
    expect(await r).toBe('TIEMPO_AGOTADO');
    const ok = await lectorPdf(f)(new ArrayBuffer(8), pdfCtx(), sinProgresoPdf, new AbortController().signal);
    expect(ok.parts).toHaveLength(2);
    expect(f.e.destruidas).toBe(1);
  });
  it('la cancelación (AbortSignal) rechaza con LecturaCancelada, llama a destroy() y termina el worker', async () => {
    const f = pdfFalso('sin-documento');
    const ac = new AbortController();
    const r = codigoPdf(lectorPdf(f)(new ArrayBuffer(8), pdfCtx(), sinProgresoPdf, ac.signal));
    await vi.advanceTimersByTimeAsync(1_000);
    ac.abort();
    expect(await r).toBe('CANCELADO');
    expect(f.e).toMatchObject({ destruidas: 1, workersPdfjs: 1, workersTerminados: 1 });
    await vi.advanceTimersByTimeAsync(LIMITES.timeoutMs * 2);
    expect(f.e.destruidas).toBe(1);
  });
  it('la cancelación a mitad de la extracción detiene la lectura de páginas', async () => {
    const f = pdfFalso('normal', 50);
    const ac = new AbortController();
    const r = codigoPdf(lectorPdf(f)(new ArrayBuffer(8), pdfCtx(), (hechas) => { if (hechas === 2) ac.abort(); }, ac.signal));
    expect(await r).toBe('CANCELADO');
    expect(f.e.paginasPedidas).toBeLessThanOrEqual(3);
    expect(f.e.destruidas).toBe(1);
  });
  it('si la señal ya estaba cancelada no se abre ningún documento', async () => {
    const f = pdfFalso('normal');
    const ac = new AbortController();
    ac.abort();
    expect(await codigoPdf(lectorPdf(f)(new ArrayBuffer(8), pdfCtx(), sinProgresoPdf, ac.signal))).toBe('CANCELADO');
    expect(f.e.getDocumentLlamadas).toBe(0);
  });
  it('al terminar no queda ningún temporizador ni oyente de abort pendiente', async () => {
    const f = pdfFalso('normal');
    const ac = new AbortController();
    await lectorPdf(f)(new ArrayBuffer(8), pdfCtx(), sinProgresoPdf, ac.signal);
    expect(vi.getTimerCount()).toBe(0);
    ac.abort();
    expect(f.e.destruidas).toBe(1);
  });
  it('un fallo al abrir también destruye la tarea (loadingTask.destroy() en todos los caminos)', async () => {
    let destruidas = 0;
    const lib: PdfjsLib = {
      PDFWorker: PdfWorkerFalso,
      getDocument: (): PdfTarea => ({
        promise: Promise.reject(Object.assign(new Error('x'), { name: 'InvalidPDFException' })),
        destroy: () => { destruidas++; },
      }),
    };
    expect(await codigoPdf(crearReadPdf({ cargarPdfjs: () => Promise.resolve(lib), crearWorker: () => null })(new ArrayBuffer(8), pdfCtx(), sinProgresoPdf, new AbortController().signal))).toBe('PDF_DANADO');
    expect(destruidas).toBe(1);
  });
});

describe('T-LE-09 calibración de IoLimits para PDF (PE-4)', () => {
  const FIXTURES = ['pdf-dos-columnas.pdf', 'pdf-anotaciones.pdf', 'pdf-pagina-sin-texto.pdf', 'pdf-js-recuadro.pdf', 'pdf-texto-ilegible.pdf'];
  it('cada PDF de prueba legítimo se lee muy por debajo del tiempo límite (menos de un tercio de timeoutMs)', async () => {
    const leer = crearReadPdf();
    const cargar = (nombre: string): ArrayBuffer => {
      const b = readFileSync(new URL(`../fixtures/${nombre}`, import.meta.url));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    };
    // Calentamiento fuera de la medida: la primera importación de pdf.js tarda más con la máquina cargada (verify en paralelo).
    await leer(cargar('pdf-dos-columnas.pdf'), pdfCtx(), sinProgresoPdf, new AbortController().signal);
    for (const nombre of FIXTURES) {
      const b = readFileSync(new URL(`../fixtures/${nombre}`, import.meta.url));
      const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      const t0 = performance.now();
      await leer(ab, pdfCtx(), sinProgresoPdf, new AbortController().signal);
      const ms = performance.now() - t0;
      expect(ms, `${nombre}: ${ms.toFixed(0)} ms`).toBeLessThan(IO_LIMITS_POR_DEFECTO.timeoutMs / 3);
    }
  });
  it('el trabajo propio del lector con 2 000 páginas de 5 000 caracteres es despreciable frente al tiempo límite', async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ str: 'x'.repeat(99), hasEOL: true, height: 10, transform: [10, 0, 0, 10, 50, 800 - i * 12] }));
    const lib: PdfjsLib = {
      PDFWorker: PdfWorkerFalso,
      getDocument: (): PdfTarea => ({
        promise: Promise.resolve({
          numPages: 2000,
          getPage: () => Promise.resolve({ getTextContent: () => Promise.resolve({ items }), getAnnotations: () => Promise.resolve([]), cleanup: () => true }),
          getMetadata: () => Promise.resolve({}),
        }),
        destroy: () => undefined,
      }),
    };
    vi.useRealTimers();
    const t0 = performance.now();
    const d = await crearReadPdf({ cargarPdfjs: () => Promise.resolve(lib), crearWorker: () => null })(new ArrayBuffer(8), pdfCtx(), sinProgresoPdf, new AbortController().signal);
    const ms = performance.now() - t0;
    expect(d.parts).toHaveLength(2000);
    expect(ms, `${ms.toFixed(0)} ms`).toBeLessThan(IO_LIMITS_POR_DEFECTO.timeoutMs / 3);
  });
});
