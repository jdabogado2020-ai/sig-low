// F4 · T-PT-01 a T-PT-05 (PDF tachado) y T-PW-01 a T-PW-03 (PDF de texto). Solo datos ficticios: los PDF del corpus (C03, C09,
// C15, C20 y C29) con las anotaciones de su gold. Fallan con el código anterior: no había salida PDF (ni `pdf-tachar.ts` ni
// `pdf-write.ts`) y `NOMBRE_DESCARGA` no admitía `.pdf`.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DocId, DocumentModel, IdSource } from '../../src/core/types';
import { IO_LIMITS_POR_DEFECTO } from '../../src/io/io-client';
import { crearReadPdf } from '../../src/io/pdf-read';
import { construirPdfTachado, tacharPaginas } from '../../src/io/pdf-tachar';
import type { Contexto2D, Lienzo } from '../../src/io/pdf-tachar';
import { construirPdf, pdfDeImagenes } from '../../src/io/pdf-write';
import { NOMBRE_DESCARGA, nombreDescarga } from '../../src/io/txt-write';
import { reemplazarTodo, salidaDeGold } from '../fixtures/salida';
import type { AnotacionGold } from '../fixtures/salida';

// Lienzo de Node: @napi-rs/canvas ya viene con pdfjs-dist (dependencia opcional fijada en check-dist); no es una dependencia nueva.
const { createCanvas } = createRequire(import.meta.url)('@napi-rs/canvas') as { createCanvas(w: number, h: number): { getContext(t: '2d'): unknown } };
function lienzoNode(ancho: number, alto: number): Lienzo {
  const canvas = createCanvas(ancho, alto);
  return { canvas, ctx: canvas.getContext('2d') as Contexto2D, ancho, alto, liberar: () => undefined };
}
const DEPS = { crearWorker: () => null, crearLienzo: lienzoNode };

const DOC = 'doc_00112233445566778899aabbccddeeff' as DocId;
function ids(): IdSource {
  let n = 0;
  return { next: (pre: string) => `${pre}_${(n++).toString(16).padStart(32, '0')}` };
}
async function leerPdf(bytes: Uint8Array): Promise<DocumentModel> {
  const copia = bytes.slice().buffer;
  return crearReadPdf({ crearWorker: () => null, ids: ids() })(copia, { docId: DOC, label: 'Documento 1', limits: IO_LIMITS_POR_DEFECTO }, () => undefined, new AbortController().signal);
}
interface PdfAbierto { numPages: number; getPage(n: number): Promise<{ view: number[]; getTextContent(): Promise<{ items: unknown[] }> }>; getMetadata(): Promise<{ info: Record<string, unknown>; metadata: unknown }> }
async function abrir(bytes: Uint8Array): Promise<PdfAbierto> {
  const lib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as { getDocument(p: Record<string, unknown>): { promise: Promise<PdfAbierto> } };
  return lib.getDocument({ data: bytes.slice(), verbosity: 0, disableFontFace: true, useSystemFonts: false, useWasm: false, useWorkerFetch: false, isOffscreenCanvasSupported: false }).promise;
}
const contiene = (h: Uint8Array, n: Uint8Array): boolean => n.length > 0 && Buffer.from(h).indexOf(Buffer.from(n)) >= 0;
const CORPUS = join(process.cwd(), 'corpus');
const PDFS = ['C03', 'C09', 'C15', 'C20', 'C29'];

describe('T-PT · PDF tachado sobre los PDF del corpus', () => {
  it.each(PDFS)('T-PT-01 %s: mismas páginas y tamaños, sin texto extraíble, sin metadatos ni bytes del original', async (id) => {
    const original = new Uint8Array(readFileSync(join(CORPUS, 'docs', `${id}.pdf`)));
    const copia = original.slice();
    const gold = JSON.parse(readFileSync(join(CORPUS, 'gold', `${id}.json`), 'utf8')) as { anotaciones: AnotacionGold[] };
    const doc = await leerPdf(original);
    const out = salidaDeGold(doc, gold.anotaciones);
    const { bytes } = await construirPdfTachado(original, doc, out, { escala: 1, deps: DEPS });
    expect(original).toEqual(copia); // el original en memoria no se toca

    const a = await abrir(original);
    const b = await abrir(bytes);
    expect(b.numPages).toBe(a.numPages);
    const tamanos: number[][] = [];
    for (let n = 1; n <= b.numPages; n++) {
      const [pa, pb] = [await a.getPage(n), await b.getPage(n)];
      expect(pb.view).toEqual(pa.view);
      tamanos.push(pa.view);
      expect((await pb.getTextContent()).items).toEqual([]);
    }
    const meta = await b.getMetadata();
    expect(meta.metadata).toBeNull();
    expect(Object.keys(meta.info).filter((k) => typeof meta.info[k] === 'string' && !['PDFFormatVersion'].includes(k))).toEqual([]);

    const latin1 = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff));
    for (const marca of ['/Font', '/Info', '/Author', '/Annots', '/AcroForm', '/Metadata', 'Autora Ejemplo', 'Generador del corpus']) {
      expect(contiene(bytes, latin1(marca)), marca).toBe(false);
    }
    // Los valores solo con cifras se buscan antes de la tabla `xref` (sus desplazamientos llevan ceros a la izquierda).
    const sinXref = bytes.subarray(0, Buffer.from(bytes).lastIndexOf('\nxref\n'));
    for (const x of gold.anotaciones.filter((g) => !g.es_negativo_esperado && g.texto.length >= 4)) {
      const donde = /\p{L}/u.test(x.texto) ? bytes : sinXref;
      expect(contiene(donde, new TextEncoder().encode(x.texto)), `${x.tipo} ${x.texto}`).toBe(false);
      expect(contiene(donde, latin1(x.texto)), x.tipo).toBe(false);
    }
    // Ninguna ventana de 32 bytes del original aparece en la salida, salvo la estructura que comparte cualquier PDF (la que también
    // está en un PDF de imágenes neutro de una página en blanco: `%PDF-1.4`, `/Type /Catalog`…).
    const neutro = pdfDeImagenes(tamanos.map((v) => ({ ancho: (v[2] ?? 0) - (v[0] ?? 0), alto: (v[3] ?? 0) - (v[1] ?? 0), pixAncho: 1, pixAlto: 1, rgb: new Uint8Array(3) })));
    let ventanas = 0;
    for (let i = 0; i + 32 <= original.length; i += 61) {
      const v = original.subarray(i, i + 32);
      if (contiene(neutro, v)) continue;
      ventanas++;
      expect(contiene(bytes, v), `bytes ${i}: ${JSON.stringify(Buffer.from(v).toString('latin1'))}`).toBe(false);
    }
    expect(ventanas).toBeGreaterThan(5);
  }, 60_000);

  it('T-PT-02 los recuadros se pintan sobre los tramos reemplazados: más píxeles negros que sin reemplazos', async () => {
    const original = new Uint8Array(readFileSync(join(CORPUS, 'docs', 'C03.pdf')));
    const doc = await leerPdf(original);
    const negros = async (out: ReturnType<typeof reemplazarTodo>): Promise<number[]> => {
      const cuenta: number[] = [];
      await tacharPaginas(original, doc, out, (p) => {
        const d = p.lienzo.ctx.getImageData(0, 0, p.lienzo.ancho, p.lienzo.alto).data;
        let k = 0;
        for (let i = 0; i < d.length; i += 4) if ((d[i] ?? 255) < 16 && (d[i + 1] ?? 255) < 16 && (d[i + 2] ?? 255) < 16) k++;
        cuenta.push(k);
      }, { escala: 1, deps: DEPS });
      return cuenta;
    };
    const sin = await negros(reemplazarTodo(doc, {}));
    const con = await negros(reemplazarTodo(doc, { 'Blanca Nubia Ficticia-Arango Ramírez': '[DEMANDANTE_1]', '7.000.001': '[CC_1]' }));
    expect(con[0]).toBeGreaterThan((sin[0] ?? 0) + 2000);
    con.forEach((k, i) => { expect(k).toBeGreaterThanOrEqual(sin[i] ?? 0); });
  }, 60_000);

  it('T-PT-03 una página excluida sale cubierta entera; un original distinto o una fuente que no es PDF se rechaza', async () => {
    const original = new Uint8Array(readFileSync(join(CORPUS, 'docs', 'C03.pdf')));
    const doc = await leerPdf(original);
    const sinPrimera: DocumentModel = { ...doc, parts: doc.parts.map((p) => (p.page === 1 && p.kind === 'pagina_pdf' ? { ...p, included: false } : p)) };
    const blancos: number[] = [];
    await tacharPaginas(original, sinPrimera, reemplazarTodo(sinPrimera, {}), (p) => {
      const d = p.lienzo.ctx.getImageData(0, 0, p.lienzo.ancho, p.lienzo.alto).data;
      let k = 0;
      for (let i = 0; i < d.length; i += 4) if ((d[i] ?? 0) > 128) k++;
      blancos.push(k);
    }, { escala: 1, deps: DEPS });
    expect(blancos[0]).toBe(0);
    expect(blancos[1]).toBeGreaterThan(0);

    const otro = new Uint8Array(readFileSync(join(CORPUS, 'docs', 'C09.pdf')));
    await expect(construirPdfTachado(otro, doc, reemplazarTodo(doc, {}), { escala: 1, deps: DEPS })).rejects.toMatchObject({ code: 'ERROR_INTERNO' });
    await expect(construirPdfTachado(original, { ...doc, source: 'docx' }, reemplazarTodo(doc, {}), { escala: 1, deps: DEPS })).rejects.toMatchObject({ code: 'FORMATO_NO_ADMITIDO' });
  }, 60_000);
});

describe('T-PW · PDF de texto (desde .docx o texto pegado)', () => {
  it('T-PW-01 Helvetica WinAnsi: el texto se extrae igual, con tildes y eñes; sin metadatos', async () => {
    const texto = 'ACCIÓN DE TUTELA\nLa señora [DEMANDANTE_1], identificada con [CC_1], pide amparo ¿por qué? «ya».\n\nDemandante\t[DEMANDANTE_1]';
    const { bytes, sustituidos } = construirPdf(texto);
    expect(sustituidos).toBe(0);
    const d = await abrir(bytes);
    expect(d.numPages).toBe(1);
    const items = (await (await d.getPage(1)).getTextContent()).items as Array<{ str: string }>;
    const extraido = items.map((x) => x.str).join(' ');
    expect(extraido).toContain('ACCIÓN DE TUTELA');
    expect(extraido).toContain('La señora [DEMANDANTE_1], identificada con [CC_1], pide amparo ¿por qué? «ya».');
    expect(extraido).toContain('Demandante');
    expect((await d.getMetadata()).metadata).toBeNull();
  });

  it('T-PW-02 lo que no está en WinAnsi se sustituye por «?» y se cuenta; un texto largo ocupa varias páginas', async () => {
    const { bytes, sustituidos } = construirPdf('Nombre en otro alfabeto: 漢字 y ✓');
    expect(sustituidos).toBe(3);
    const items = (await (await (await abrir(bytes)).getPage(1)).getTextContent()).items as Array<{ str: string }>;
    expect(items.map((x) => x.str).join('')).toContain('Nombre en otro alfabeto: ?? y ?');
    const largo = construirPdf(Array.from({ length: 120 }, (_, i) => `Párrafo ${i + 1} de prueba con texto ficticio suficiente para ocupar más de una línea en la página de tamaño carta.`).join('\n'));
    expect((await abrir(largo.bytes)).numPages).toBeGreaterThan(3);
  });

  it('T-PW-03 el nombre de descarga neutro admite .pdf (6.9) y no otras combinaciones', () => {
    const ahora = new Date(2026, 10, 3, 9, 5);
    expect(nombreDescarga('anonimizado', 'pdf', ahora)).toBe('sig-low-anonimizado-20261103-0905.pdf');
    expect(NOMBRE_DESCARGA.test('sig-low-anonimizado-20261103-0905.pdf')).toBe(true);
    expect(NOMBRE_DESCARGA.test('sig-low-informe-20261103-0905.pdf')).toBe(false);
    expect(NOMBRE_DESCARGA.test('sig-low-tabla-20261103-0905.pdf')).toBe(false);
  });
});
