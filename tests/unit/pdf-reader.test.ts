// T-LE-06 a T-LE-08 · Lector de PDF con pdf.js legacy (PE-4; 6.1.1, 6.3, 6.11.5; V-39, V-42). Solo datos ficticios.
// Los PDF de tests/fixtures/ se generaron con el escritor privado (corpus/gen/fixtures-pdf.ts); aquí solo se leen.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiglowError } from '../../src/core/types';
import type { DocId, DocumentModel, ErrorCode, IdSource, IoLimits } from '../../src/core/types';
import { IO_LIMITS_POR_DEFECTO, LecturaCancelada } from '../../src/io/io-client';
import { crearReadPdf, crearWorkerPdfjs, readPdf } from '../../src/io/pdf-read';
import type { PdfDocumento, PdfjsLib, PdfPagina, PdfTarea } from '../../src/io/pdf-read';

const DOC = 'doc_00112233445566778899aabbccddeeff' as DocId;
const ETIQUETA_NEUTRA = /^(Documento \d+|Cuerpo del documento|Texto pegado|Encabezado \d+|Pie de página \d+|Nota al pie \d+|Nota al final \d+|Comentario \d+|Página \d+|Anotación \d+ \(página \d+\))$/;
const ID_PARTE = /^prt_[0-9a-f]{32}$/;

const SUMAS: Record<string, string> = {
  'pdf-dos-columnas.pdf': '237673d0aea7dfc1aabafc6c87338f19cc64d014cffae4f0537e2fa05e1f98d8',
  'pdf-anotaciones.pdf': 'a5b385f27a41a60a5aee4bfdae926ac3315397f22599bced39fce0ccf8e73895',
  'pdf-escaneado.pdf': '26bb1b2fb6c03410e727315e90699a39c67db267df414910c2651053fd3bac18',
  'pdf-con-contrasena.pdf': '7ebb50656c9b36c83300f87798740d17907af700d1777d98c3019f70cfd5289f',
  'pdf-pagina-sin-texto.pdf': '0e028df654bd43fee49a2e480deefd394712dac901d9dd384c217e848bf16c76',
  'pdf-js-recuadro.pdf': '1991a082cc8529bca80270d3648dbf7225235283fd27530de7a3d79744cb5cf5',
  'pdf-texto-ilegible.pdf': 'aee491035d930d613194d728025b3516130a69dcc9431611c171db04cbd28cf5',
};

function bytesDe(nombre: string): ArrayBuffer {
  const b = readFileSync(new URL(`../fixtures/${nombre}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
const ctx = (limits: IoLimits = IO_LIMITS_POR_DEFECTO): { docId: DocId; label: string; limits: IoLimits } =>
  ({ docId: DOC, label: 'Documento 1', limits });
const sinProgreso = (): void => undefined;
const senal = (): AbortSignal => new AbortController().signal;

/** Identificadores deterministas, solo para pruebas (nunca derivados del contenido). */
function idsFijos(): IdSource {
  let n = 0;
  return { next: (prefix) => `${prefix}_${(n++).toString(16).padStart(32, '0')}` };
}
const lector = crearReadPdf({ ids: idsFijos() });
const leer = (nombre: string): Promise<DocumentModel> => lector(bytesDe(nombre), ctx(), sinProgreso, senal());
async function codigoDe(p: Promise<unknown>): Promise<ErrorCode | 'NO_LANZA' | 'CANCELADO'> {
  try { await p; } catch (e) {
    if (e instanceof LecturaCancelada) return 'CANCELADO';
    return e instanceof SiglowError ? e.code : 'ERROR_INTERNO';
  }
  return 'NO_LANZA';
}

/** pdf.js falso: registra los parámetros, las destrucciones y los workers terminados. */
interface Pag { items?: unknown[]; anots?: unknown[] }
function libFalsa(paginas: Pag[], modo: 'normal' | 'lanza' = 'normal', lanzado: unknown = new Error('Ana Ficticia Rojas')): {
  lib: PdfjsLib; params: Array<Record<string, unknown>>; destruidas: () => number; workersDestruidos: () => number;
} {
  const params: Array<Record<string, unknown>> = [];
  let destruidas = 0;
  let workersDestruidos = 0;
  const lib: PdfjsLib = {
    PDFWorker: class { constructor(public readonly p: { port: unknown }) { /* sin efecto */ } destroy(): void { workersDestruidos++; } },
    getDocument(p): PdfTarea {
      params.push(p);
      const doc: PdfDocumento = {
        numPages: paginas.length,
        getPage: (n): Promise<PdfPagina> => {
          const pg = paginas[n - 1] as Pag;
          return Promise.resolve({
            getTextContent: () => (modo === 'lanza' ? Promise.reject(lanzado) : Promise.resolve({ items: pg.items ?? [] })),
            getAnnotations: () => Promise.resolve(pg.anots ?? []),
            cleanup: () => true,
          });
        },
        getMetadata: () => Promise.resolve({ info: {}, metadata: null }),
      };
      return { promise: Promise.resolve(doc), destroy: () => { destruidas++; } };
    },
  };
  return { lib, params, destruidas: () => destruidas, workersDestruidos: () => workersDestruidos };
}
const item = (str: string, y = 700, hasEOL = false): Record<string, unknown> =>
  ({ str, hasEOL, height: 10, transform: [10, 0, 0, 10, 50, y] });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('T-LE-06 PDF con capa de texto', () => {
  it('los fixtures conservan sus sumas SHA-256 (solo cambian regenerándolos con el escritor privado)', () => {
    for (const [nombre, suma] of Object.entries(SUMAS)) {
      expect(createHash('sha256').update(new Uint8Array(bytesDe(nombre))).digest('hex'), nombre).toBe(suma);
    }
  });

  it('una pagina_pdf por página; el texto concatena los str con salto donde hasEOL y sin salto final (6.1.1)', async () => {
    const d = await leer('pdf-dos-columnas.pdf');
    expect(d.source).toBe('pdf');
    expect(d.parts.map((p) => p.kind)).toEqual(['pagina_pdf', 'pagina_pdf']);
    expect(d.parts[0]?.text).toBe(
      'Primera página de un documento ficticio.\nSeñora Marta Ficticia Prueba, cédula 1.000.000.001.\nLínea final de la primera página.',
    );
    expect(d.parts.every((p) => !p.text.endsWith('\n') && p.text.normalize('NFC') === p.text && !p.text.includes('\r'))).toBe(true);
  });

  it('dos columnas: el texto sale en el orden del flujo (izquierda y luego derecha) y avisa ORDEN_LECTURA_PDF solo en esa página', async () => {
    const d = await leer('pdf-dos-columnas.pdf');
    const p2 = d.parts[1]?.text ?? '';
    expect(p2.indexOf('Fin de la primera columna.')).toBeGreaterThan(-1);
    expect(p2.indexOf('Fin de la primera columna.')).toBeLessThan(p2.indexOf('Segunda columna:'));
    expect(p2.split('\n')).toHaveLength(16);
    expect(d.warnings).toEqual([{ code: 'ORDEN_LECTURA_PDF', partId: d.parts[1]?.id, page: 2, count: 1 }]);
  });

  it('etiquetas «Página N», page, index y order en orden de lectura; ids con forma prt_ de 128 bits', async () => {
    const d = await leer('pdf-dos-columnas.pdf');
    expect(d.parts.map((p) => [p.label, p.page, p.index, p.order, p.included])).toEqual([
      ['Página 1', 1, 1, 0, true], ['Página 2', 2, 2, 1, true],
    ]);
    expect(d.parts.every((p) => ID_PARTE.test(p.id) && p.docId === DOC)).toBe(true);
  });

  it('INV-D03 las etiquetas del documento y de las partes casan con ETIQUETA_NEUTRA', async () => {
    for (const f of ['pdf-dos-columnas.pdf', 'pdf-anotaciones.pdf']) {
      const d = await leer(f);
      expect(d.label).toMatch(ETIQUETA_NEUTRA);
      for (const p of d.parts) expect(p.label, `${f} ${p.kind}`).toMatch(ETIQUETA_NEUTRA);
    }
  });

  it('INV-D01 e INV-D02 texto en NFC sin CR, partes por rango (páginas y luego anotaciones) y order 0..n-1', async () => {
    const d = await leer('pdf-anotaciones.pdf');
    expect(d.parts.map((p) => p.order)).toEqual([0, 1, 2, 3, 4]);
    expect(d.parts.map((p) => p.kind)).toEqual(['pagina_pdf', 'pagina_pdf', 'anotacion_pdf', 'anotacion_pdf', 'anotacion_pdf']);
    for (const p of d.parts) {
      expect(p.text.normalize('NFC')).toBe(p.text);
      expect(p.text).not.toContain('\r');
      expect(p.text.trim()).not.toBe('');
    }
  });

  it('cada anotación con contenido es una parte anotacion_pdf, con su página y etiqueta neutra', async () => {
    const d = await leer('pdf-anotaciones.pdf');
    const notas = d.parts.filter((p) => p.kind === 'anotacion_pdf');
    expect(notas.map((p) => [p.label, p.page, p.index, p.text])).toEqual([
      ['Anotación 1 (página 1)', 1, 1, 'Llamar a Marta Ficticia Prueba al 300 000 0001'],
      ['Anotación 2 (página 1)', 1, 2, 'Verificar la cédula 1.000.000.001'],
      ['Anotación 3 (página 2)', 2, 3, 'Correo marta@ejemplo.test'],
    ]);
  });

  it('V-39 / INV-D04 metadatos, XMP y autores de anotaciones solo se cuentan; ningún valor llega al modelo', async () => {
    const d = await leer('pdf-anotaciones.pdf');
    expect(d.metadata.categories).toEqual({ pdf_propiedades: { count: 3 }, pdf_autores_anotaciones: { count: 3 } });
    const serializado = JSON.stringify(d);
    for (const valor of ['Autora Ejemplo', 'Revisor Ficticio', 'Revisora Ejemplo', 'Documento ficticio de prueba', 'Productor Ficticio']) {
      expect(serializado, valor).not.toContain(valor);
    }
    expect(JSON.stringify(d.metadata)).toMatch(/^[a-z_{}":,\d]+$/);
    expect((await leer('pdf-dos-columnas.pdf')).metadata.categories).toEqual({ pdf_propiedades: { count: 3 } });
  });

  it('INV-D05 el nombre del archivo no aparece en el DocumentModel: el lector no lo recibe y la etiqueta es «Documento N»', async () => {
    const d = await lector(bytesDe('pdf-anotaciones.pdf'), { docId: DOC, label: 'Documento 7', limits: IO_LIMITS_POR_DEFECTO }, sinProgreso, senal());
    expect(d.label).toBe('Documento 7');
    expect(readPdf.length).toBe(4); // (bytes, ctx, onProgress, signal): ningún parámetro lleva el nombre
    const s = JSON.stringify(d);
    expect(s).not.toMatch(/pdf-anotaciones|\.pdf/i);
  });

  it('V-39 todo el texto, visible o no, se extrae: el texto bajo un recuadro negro está en la parte (T-PV-05) y el JavaScript no se ejecuta', async () => {
    const d = await leer('pdf-js-recuadro.pdf');
    expect(d.parts).toHaveLength(1);
    expect(d.parts[0]?.text).toContain('Pedro Ficticio Ejemplo 1.000.000.002');
    expect(d.parts[0]?.text).toContain('Línea visible de la primera página.');
    expect(d.warnings).toEqual([]);
  });

  it('el avance se informa por páginas, de 0 al total', async () => {
    const pasos: Array<[number, number]> = [];
    await lector(bytesDe('pdf-anotaciones.pdf'), ctx(), (a, b) => { pasos.push([a, b]); }, senal());
    expect(pasos).toEqual([[0, 2], [1, 2], [2, 2]]);
  });

  it('INV-W02 una lectura correcta no escribe en la consola', async () => {
    const espias = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    await leer('pdf-dos-columnas.pdf');
    await codigoDe(leer('pdf-con-contrasena.pdf'));
    for (const e of espias) expect(e).not.toHaveBeenCalled();
  });

  it('T-PV-04 el buffer recibido queda en cero al terminar (con éxito y con error)', async () => {
    const ok = bytesDe('pdf-dos-columnas.pdf');
    await lector(ok, ctx(), sinProgreso, senal());
    expect(new Uint8Array(ok).every((x) => x === 0)).toBe(true);
    const mal = bytesDe('pdf-con-contrasena.pdf');
    await codigoDe(lector(mal, ctx(), sinProgreso, senal()));
    expect(new Uint8Array(mal).every((x) => x === 0)).toBe(true);
  });
});

describe('T-LE-07 PDF escaneado y páginas sin texto', () => {
  it('C04: escaneado (todas las páginas son imágenes) → PDF_SIN_CAPA_TEXTO', async () => {
    expect(await codigoDe(leer('pdf-escaneado.pdf'))).toBe('PDF_SIN_CAPA_TEXTO');
  });

  it('una página sin texto entre dos con texto → advertencia PAGINA_SIN_TEXTO y solo dos partes (sin partes vacías)', async () => {
    const d = await leer('pdf-pagina-sin-texto.pdf');
    expect(d.parts.map((p) => [p.label, p.page, p.index, p.order])).toEqual([['Página 1', 1, 1, 0], ['Página 3', 3, 2, 1]]);
    expect(d.warnings).toEqual([{ code: 'PAGINA_SIN_TEXTO', page: 2, count: 1 }]);
  });

  it('el umbral es «más de la mitad»: 1 de 2 páginas sin texto avisa, 2 de 3 rechaza', async () => {
    const vacia = { items: [] };
    const con = { items: [item('Texto ficticio suficiente.')] };
    const uno = libFalsa([con, vacia]);
    const d = await crearReadPdf({ cargarPdfjs: () => Promise.resolve(uno.lib), crearWorker: () => null, ids: idsFijos() })(
      new ArrayBuffer(8).slice(0), ctx(), sinProgreso, senal());
    expect(d.warnings).toEqual([{ code: 'PAGINA_SIN_TEXTO', page: 2, count: 1 }]);
    const dos = libFalsa([con, vacia, vacia]);
    expect(await codigoDe(crearReadPdf({ cargarPdfjs: () => Promise.resolve(dos.lib), crearWorker: () => null })(
      new ArrayBuffer(8), ctx(), sinProgreso, senal()))).toBe('PDF_SIN_CAPA_TEXTO');
  });

  it('una página con menos de pdfMinCharsPerPage caracteres no blancos cuenta como sin texto, pero su texto se conserva', async () => {
    const f = libFalsa([{ items: [item('Texto ficticio suficiente.')] }, { items: [item('  1 2  ')] }]);
    const d = await crearReadPdf({ cargarPdfjs: () => Promise.resolve(f.lib), crearWorker: () => null, ids: idsFijos() })(
      new ArrayBuffer(8), ctx(), sinProgreso, senal());
    expect(d.parts.map((p) => p.text)).toEqual(['Texto ficticio suficiente.', '  1 2  ']);
    expect(d.warnings).toEqual([{ code: 'PAGINA_SIN_TEXTO', page: 2, count: 1 }]);
  });

  it('un PDF de una sola página sin texto es un escaneado (1 de 1 supera la mitad)', async () => {
    const f = libFalsa([{ items: [] }]);
    expect(await codigoDe(crearReadPdf({ cargarPdfjs: () => Promise.resolve(f.lib), crearWorker: () => null })(
      new ArrayBuffer(8), ctx(), sinProgreso, senal()))).toBe('PDF_SIN_CAPA_TEXTO');
  });
});

describe('T-LE-08 contraseña, PDF dañado y texto ilegible', () => {
  it('con contraseña → PDF_CON_CONTRASENA, sin pedirla (no hay onPassword) y sin contraseña en la petición (V-42)', async () => {
    expect(await codigoDe(leer('pdf-con-contrasena.pdf'))).toBe('PDF_CON_CONTRASENA');
    const f = libFalsa([{ items: [item('Texto ficticio suficiente.')] }]);
    await crearReadPdf({ cargarPdfjs: () => Promise.resolve(f.lib), crearWorker: () => null })(new ArrayBuffer(8), ctx(), sinProgreso, senal());
    expect(f.params[0]).not.toHaveProperty('password');
  });

  it('PDF truncado y archivo que no es PDF → PDF_DANADO', async () => {
    const b = new Uint8Array(bytesDe('pdf-dos-columnas.pdf'));
    for (const n of [5, 100, 1000, b.length - 120]) {
      const corte = b.slice(0, n).buffer as ArrayBuffer;
      expect(await codigoDe(lector(corte, ctx(), sinProgreso, senal())), `truncado a ${n} B`).toBe('PDF_DANADO');
    }
    const texto = new TextEncoder().encode('Esto no es un PDF de Ana Ficticia Rojas.');
    expect(await codigoDe(lector(texto.buffer as ArrayBuffer, ctx(), sinProgreso, senal()))).toBe('PDF_DANADO');
  });

  it('archivo vacío → ARCHIVO_VACIO; sobre maxFileBytes → ARCHIVO_DEMASIADO_GRANDE', async () => {
    expect(await codigoDe(lector(new ArrayBuffer(0), ctx(), sinProgreso, senal()))).toBe('ARCHIVO_VACIO');
    expect(await codigoDe(lector(bytesDe('pdf-dos-columnas.pdf'), ctx({ ...IO_LIMITS_POR_DEFECTO, maxFileBytes: 100 }), sinProgreso, senal()))).toBe('ARCHIVO_DEMASIADO_GRANDE');
  });

  it('TEXTO_ILEGIBLE: fuente cuyo ToUnicode mapea al área de uso privado → advertencia con la página, sin perder la parte', async () => {
    const d = await leer('pdf-texto-ilegible.pdf');
    expect(d.parts).toHaveLength(1);
    expect(d.warnings).toHaveLength(1);
    expect(d.warnings[0]).toMatchObject({ code: 'TEXTO_ILEGIBLE', page: 1, partId: d.parts[0]?.id });
    expect(d.warnings[0]?.count).toBe(36);
  });

  it('TEXTO_ILEGIBLE: umbral de 20 % de U+FFFD o U+E000–U+F8FF y al menos 2 caracteres', async () => {
    const con = (s: string) => libFalsa([{ items: [item(s)] }]);
    const avisos = async (s: string): Promise<string[]> => {
      const f = con(s);
      const d = await crearReadPdf({ cargarPdfjs: () => Promise.resolve(f.lib), crearWorker: () => null, ids: idsFijos() })(
        new ArrayBuffer(8), ctx(), sinProgreso, senal());
      return d.warnings.map((w) => w.code);
    };
    expect(await avisos('Texto ficticio de ejemplo con un único � suelto.')).toEqual([]);
    expect(await avisos('Texto �������� ficticio')).toEqual(['TEXTO_ILEGIBLE']);
    expect(await avisos(' ab cd ef gh')).toEqual(['TEXTO_ILEGIBLE']);
    expect(await avisos('Texto ficticio largo largo largo largo largo largo ��')).toEqual([]);
  });

  it('INV-W01 / INV-W02 un fallo interno con texto del documento se traduce a PDF_DANADO sin message ni stack ni consola', async () => {
    const espias = (['log', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const f = libFalsa([{ items: [] }], 'lanza', new Error('Ana Ficticia Rojas, C.C. 1.000.000.001'));
    let atrapado: unknown;
    try {
      await crearReadPdf({ cargarPdfjs: () => Promise.resolve(f.lib), crearWorker: () => null })(new ArrayBuffer(8), ctx(), sinProgreso, senal());
    } catch (e) { atrapado = e; }
    expect(atrapado).toBeInstanceOf(SiglowError);
    expect((atrapado as SiglowError).code).toBe('PDF_DANADO');
    expect(JSON.stringify(atrapado) + String((atrapado as Error).message) + String((atrapado as Error).stack)).not.toContain('Ana Ficticia');
    for (const e of espias) expect(e).not.toHaveBeenCalled();
  });

  it('otros fallos: RangeError → MEMORIA; no poder cargar pdf.js → ERROR_INTERNO; PasswordException por nombre → PDF_CON_CONTRASENA', async () => {
    const lanza = (e: unknown) => libFalsa([{ items: [] }], 'lanza', e);
    const probar = (f: { lib: PdfjsLib }) => codigoDe(crearReadPdf({ cargarPdfjs: () => Promise.resolve(f.lib), crearWorker: () => null })(new ArrayBuffer(8), ctx(), sinProgreso, senal()));
    expect(await probar(lanza(new RangeError('Array buffer allocation failed')))).toBe('MEMORIA');
    expect(await probar(lanza(Object.assign(new Error('x'), { name: 'PasswordException' })))).toBe('PDF_CON_CONTRASENA');
    expect(await codigoDe(crearReadPdf({ cargarPdfjs: () => Promise.reject(new Error('sin red')), crearWorker: () => null })(new ArrayBuffer(8), ctx(), sinProgreso, senal()))).toBe('ERROR_INTERNO');
  });
});

describe('V-42 pdf.js sin recursos opcionales y con worker del mismo origen', () => {
  const parametros = async (): Promise<Record<string, unknown>> => {
    const f = libFalsa([{ items: [item('Texto ficticio suficiente.')] }]);
    await crearReadPdf({ cargarPdfjs: () => Promise.resolve(f.lib), crearWorker: () => null })(new ArrayBuffer(8), ctx(), sinProgreso, senal());
    return f.params[0] as Record<string, unknown>;
  };

  it('getDocument usa las opciones de 6.11.5 y ninguna URL de recursos (cMapUrl, standardFontDataUrl, wasmUrl, iccUrl)', async () => {
    const p = await parametros();
    expect(p).toMatchObject({ disableFontFace: true, useSystemFonts: false, verbosity: 0, enableXfa: false });
    for (const k of ['cMapUrl', 'standardFontDataUrl', 'wasmUrl', 'iccUrl', 'url', 'httpHeaders', 'withCredentials']) expect(p, k).not.toHaveProperty(k);
    expect(p.useWasm).toBe(false);
    expect(p.useWorkerFetch).toBe(false);
    expect(p.data).toBeInstanceOf(Uint8Array);
  });

  it('pdf.js recibe una copia: el buffer del llamador no se transfiere y se pone en cero al terminar', async () => {
    const f = libFalsa([{ items: [item('Texto ficticio suficiente.')] }]);
    const buf = new Uint8Array([1, 2, 3, 4]).buffer;
    await crearReadPdf({ cargarPdfjs: () => Promise.resolve(f.lib), crearWorker: () => null })(buf, ctx(), sinProgreso, senal());
    expect(buf.detached).toBe(false);
    expect(Array.from(new Uint8Array(buf))).toEqual([0, 0, 0, 0]);
    expect(Array.from((f.params[0]?.data as Uint8Array))).toEqual([1, 2, 3, 4]);
  });

  it('el worker es de módulo, del mismo origen y nunca blob: ni data:', () => {
    const creados: Array<{ url: string; opts: unknown }> = [];
    vi.stubGlobal('Worker', class { constructor(url: URL | string, opts: unknown) { creados.push({ url: String(url), opts }); } terminate(): void { /* sin efecto */ } });
    const w = crearWorkerPdfjs();
    expect(w).not.toBeNull();
    expect(creados).toHaveLength(1);
    expect(creados[0]?.opts).toEqual({ type: 'module' });
    expect(creados[0]?.url).toMatch(/pdf\.worker\.mjs$/);
    expect(creados[0]?.url).not.toMatch(/^(blob|data):/);
  });

  it('sin Worker (Node) no se crea ninguno y pdf.js usa el simulado', () => {
    vi.stubGlobal('Worker', undefined);
    expect(crearWorkerPdfjs()).toBeNull();
  });

  it('con worker propio: se pasa a pdf.js como PDFWorker, y al terminar se destruyen el PDFWorker y el worker', async () => {
    const f = libFalsa([{ items: [item('Texto ficticio suficiente.')] }]);
    let terminados = 0;
    await crearReadPdf({ cargarPdfjs: () => Promise.resolve(f.lib), crearWorker: () => ({ terminate: () => { terminados++; } }) })(
      new ArrayBuffer(8), ctx(), sinProgreso, senal());
    expect(f.params[0]?.worker).toBeDefined();
    expect(f.workersDestruidos()).toBe(1);
    expect(terminados).toBe(1);
  });

  it('el código fuente del lector no contiene blob:, data:, fetch(, console ni URL de recursos', () => {
    const src = readFileSync(new URL('../../src/io/pdf-read.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\bblob:|\bdata:[a-z]+\/|\bfetch\s*\(|\bconsole\b|\bXMLHttpRequest\b|\bonPassword\b\s*=/);
    expect(src).toContain("{ type: 'module' }");
    expect(src).toContain("import('pdfjs-dist/legacy/build/pdf.mjs')");
  });
});
