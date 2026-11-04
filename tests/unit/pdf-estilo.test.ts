// F7 · T-PE-01 a T-PE-06 · PDF con el estilo del .docx (v1.1.1). Solo datos ficticios. Fallan con 6408759: el PDF de un .docx era
// texto en Helvetica, sin justificar, en tamaño carta con márgenes fijos y con el rótulo «=== Cuerpo del documento ===».
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { unzlibSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DocId, DocumentModel, IdSource, RenderedOutput } from '../../src/core/types';
import { readDocx } from '../../src/io/docx-read';
import { IO_LIMITS_POR_DEFECTO } from '../../src/io/io-client';
import { construirPdfConEstilo } from '../../src/io/pdf-maqueta';
import type { PdfConEstilo } from '../../src/io/pdf-maqueta';
import { construirPdf } from '../../src/io/pdf-write';
import { JUSTIFICADO, NOMBRE_ESTILO, PAGINA, docxConEstilo } from '../fixtures/docx/docx-con-estilo';
import { reemplazarTodo, salidaDeGold } from '../fixtures/salida';
import type { AnotacionGold } from '../fixtures/salida';

const DOC = 'doc_00112233445566778899aabbccddeeff' as DocId;
function ids(): IdSource {
  let n = 0;
  return { next: (pre: string) => `${pre}_${(n++).toString(16).padStart(32, '0')}` };
}
const leer = (b: Uint8Array): DocumentModel => readDocx(b, { docId: DOC, label: 'Documento 1', ids: ids() }, IO_LIMITS_POR_DEFECTO);

interface Item { str: string; x: number; y: number; w: number; familia: string }
interface PaginaLeida { view: number[]; items: Item[] }
async function leerPdf(bytes: Uint8Array): Promise<PaginaLeida[]> {
  const lib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as {
    getDocument(p: Record<string, unknown>): { promise: Promise<{ numPages: number; getPage(n: number): Promise<{ view: number[]; getTextContent(): Promise<{ items: Array<{ str: string; transform: number[]; width: number; fontName: string }>; styles: Record<string, { fontFamily: string }> }> }> }> };
  };
  const pdf = await lib.getDocument({ data: bytes.slice(), verbosity: 0, disableFontFace: true, useSystemFonts: false, useWasm: false }).promise;
  const out: PaginaLeida[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const p = await pdf.getPage(n);
    const tc = await p.getTextContent();
    out.push({
      view: p.view,
      items: tc.items.filter((i) => i.str.trim() !== '').map((i) => ({ str: i.str, x: i.transform[4] ?? 0, y: i.transform[5] ?? 0, w: i.width, familia: tc.styles[i.fontName]?.fontFamily ?? '' })),
    });
  }
  return out;
}
/**
 * Líneas de una página: ítems con casi la misma ordenada (un volado, como la llamada de una nota, va con su línea), de izquierda a
 * derecha y de arriba abajo. `texto` une los ítems sin espacios (pdf.js da los espacios como ítems aparte, que aquí se omiten).
 */
function lineas(p: PaginaLeida): Array<{ y: number; x: number; fin: number; texto: string; items: Item[] }> {
  const grupos: Array<{ y: number; items: Item[] }> = [];
  for (const i of p.items) {
    const g = grupos.find((x) => Math.abs(x.y - i.y) < 5);
    if (g === undefined) grupos.push({ y: i.y, items: [i] }); else g.items.push(i);
  }
  return grupos.sort((a, b) => b.y - a.y).map(({ y, items }) => {
    const orden = items.sort((a, b) => a.x - b.x);
    const base = orden.filter((i) => Math.abs(i.y - y) < 0.5);
    const ultimo = (base.length > 0 ? base : orden)[(base.length > 0 ? base : orden).length - 1] as Item;
    return { y, x: orden[0]?.x ?? 0, fin: ultimo.x + ultimo.w, texto: orden.map((i) => i.str).join(' '), items: orden };
  });
}
const sinEspacios = (s: string): string => s.replace(/\s+/gu, '');
/** Todos los flujos del PDF, descomprimidos, como texto latin1. */
function flujos(bytes: Uint8Array): string {
  const s = Buffer.from(bytes).toString('latin1');
  let out = '';
  for (let i = s.indexOf('stream\n'); i >= 0; i = s.indexOf('stream\n', i + 7)) {
    const fin = s.indexOf('\nendstream', i);
    if (fin < 0) break;
    try { out += Buffer.from(unzlibSync(bytes.subarray(i + 7, fin))).toString('latin1'); } catch { /* no comprimido */ }
    i = fin;
  }
  return out;
}

const IZQ = PAGINA.izq;
const DER = PAGINA.ancho - PAGINA.der;

describe('T-PE · PDF con el estilo del .docx', () => {
  let r: PdfConEstilo & { imagenes: number };
  let paginas: PaginaLeida[];
  beforeAll(async () => {
    const original = docxConEstilo();
    const doc = leer(original);
    r = construirPdfConEstilo(original, doc, reemplazarTodo(doc, { [NOMBRE_ESTILO]: '[DEMANDANTE_1]' }));
    paginas = await leerPdf(r.bytes);
  });

  it('T-PE-01 página oficio en dos páginas (salto de página), texto en orden, encabezado y pie con «Página X de Y» en cada una, sin «===»', () => {
    expect(paginas.map((p) => p.view)).toEqual([[0, 0, 612, 936], [0, 0, 612, 936]]);
    const p1 = lineas(paginas[0] as PaginaLeida).map((l) => l.texto);
    const orden = ['Juzgado Ficticio de Villa Prueba', 'ACCIÓN DE TUTELA', 'El señor [DEMANDANTE_1], mayor de edad', 'Párrafo con sangría',
      '1.Primer hecho', '2.Segundo hecho', '•Viñeta', 'Demandante[DEMANDANTE_1]', 'DespachoJuzgado Ficticio', 'Villa Prueba, 3 de noviembre', 'Texto en Arial', 'Página 1 de 2'];
    const posiciones = orden.map((o) => p1.findIndex((t) => sinEspacios(t).includes(sinEspacios(o))));
    expect(posiciones.every((x) => x >= 0), JSON.stringify(p1)).toBe(true);
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);
    const p2 = lineas(paginas[1] as PaginaLeida).map((l) => l.texto);
    expect(p2[0]).toContain('Juzgado Ficticio de Villa Prueba');
    expect(p2.map(sinEspacios)).toContain(sinEspacios('Segunda página del escrito ficticio.'));
    expect(sinEspacios(p2[p2.length - 1] ?? '')).toBe('Página2de2');
    // El encabezado arriba (bajo su margen) y el pie abajo (sobre el suyo).
    const enc = lineas(paginas[1] as PaginaLeida)[0];
    expect(enc?.y).toBeLessThan(PAGINA.alto - PAGINA.encabezado);
    expect(enc?.y).toBeGreaterThan(PAGINA.alto - PAGINA.sup);
    expect(lineas(paginas[1] as PaginaLeida).at(-1)?.y).toBeGreaterThan(PAGINA.pie);
    for (const p of paginas) for (const i of p.items) expect(i.str).not.toContain('===');
    expect(r.paginas).toBe(2);
    expect(r.omitidos).toBe(1); // la imagen
  });

  it('T-PE-02 posiciones: margen izquierdo, justificado al margen derecho, centrado, a la derecha, sangrías y numeración', () => {
    const ls = lineas(paginas[0] as PaginaLeida);
    const i0 = ls.findIndex((l) => l.texto.startsWith('El señor'));
    const iFin = ls.findIndex((l) => l.texto.includes('según los hechos que siguen'));
    expect(iFin - i0).toBeGreaterThanOrEqual(2);
    for (let k = i0; k <= iFin; k++) {
      expect(ls[k]?.x).toBeCloseTo(IZQ, 1); // margen izquierdo de la sección (1701 twips)
      if (k < iFin) expect(Math.abs((ls[k]?.fin ?? 0) - DER)).toBeLessThan(0.6); // justificado: cada línea llega al margen derecho
    }
    expect(DER - (ls[iFin]?.fin ?? 0)).toBeGreaterThan(20); // la última línea no se estira
    const titulo = ls.find((l) => sinEspacios(l.texto) === 'ACCIÓNDETUTELA');
    expect(Math.abs(((titulo?.x ?? 0) + (titulo?.fin ?? 0)) / 2 - (IZQ + DER) / 2)).toBeLessThan(1);
    const fecha = ls.find((l) => l.texto.startsWith('Villa Prueba, 3'));
    expect(Math.abs((fecha?.fin ?? 0) - DER)).toBeLessThan(0.6);
    const sangria = ls.findIndex((l) => l.texto.startsWith('Párrafo con sangría'));
    expect(ls[sangria]?.x).toBeCloseTo(IZQ + 36 + 18, 1);
    expect(ls[sangria + 1]?.x).toBeCloseTo(IZQ + 36, 1);
    const hecho = ls.find((l) => l.texto.includes('Primer hecho'));
    expect(hecho?.items[0]?.str).toBe('1.');
    expect(hecho?.items[0]?.x).toBeCloseTo(IZQ + 18, 1);
    expect(hecho?.items.find((i) => i.str.startsWith('Primer'))?.x).toBeCloseTo(IZQ + 36, 1);
    const fila = ls.find((l) => l.texto.startsWith('Demandante'));
    expect(fila?.items[0]?.x).toBeCloseTo(IZQ + 5.4, 1);
    expect(fila?.items.find((i) => i.str === '[DEMANDANTE_1]')?.x).toBeCloseTo(IZQ + 150 + 5.4, 1);
  });

  it('T-PE-03 fuentes estándar: Times (por Times New Roman), Helvetica (por Arial), Courier (por Courier New); negrita, cursiva, subrayado y tamaños', () => {
    const ls = lineas(paginas[0] as PaginaLeida);
    expect(ls.find((l) => sinEspacios(l.texto) === 'ACCIÓNDETUTELA')?.items[0]?.familia).toBe('serif');
    const mezcla = ls.find((l) => l.texto.startsWith('Texto en Arial'));
    expect(mezcla?.items[0]?.familia).toBe('sans-serif');
    expect(mezcla?.items.find((i) => i.str.includes('Courier'))?.familia).toBe('monospace');
    const texto = Buffer.from(r.bytes).toString('latin1');
    for (const f of ['/Times-Roman', '/Times-Bold', '/Times-Italic', '/Helvetica', '/Courier']) expect(texto, f).toContain(`/BaseFont ${f}`);
    expect(texto).toContain('/Encoding /WinAnsiEncoding');
    const ops = flujos(r.bytes);
    expect(ops).toMatch(/\/TB 16 Tf/u); // el título: negrita de 16 pt (estilo Heading1)
    expect(ops).toMatch(/\/T 12 Tf/u); // el cuerpo: 12 pt (docDefaults)
    expect(ops).toMatch(/ re f/u); // subrayado
    expect(ops).toMatch(/ Tw/u); // justificado con espaciado de palabras
  });

  it('T-PE-04 privacidad: ningún valor original en los bytes ni en los flujos ni en el texto; tabla con bordes; sin metadatos', () => {
    const crudo = Buffer.from(r.bytes);
    const ops = flujos(r.bytes);
    for (const v of [NOMBRE_ESTILO, 'Pedro Ejemplo', 'Ejemplo G', 'Gómez']) {
      expect(crudo.includes(Buffer.from(v, 'utf8')), v).toBe(false);
      expect(crudo.includes(Buffer.from(v, 'latin1')), v).toBe(false);
      expect(ops.includes(v) || ops.includes(Buffer.from(v, 'latin1').toString('latin1')), v).toBe(false);
    }
    for (const p of paginas) for (const i of p.items) expect(i.str).not.toMatch(/Pedro|Gómez/u);
    expect(ops).toMatch(/0\.5 w [\d.]+ [\d.]+ [\d.]+ [\d.]+ re S/u); // bordes de la tabla
    expect(crudo.toString('latin1')).not.toMatch(/\/Info|\/Metadata|\/ID|\/Author|\/Producer/u);
    expect(JUSTIFICADO).toContain(NOMBRE_ESTILO);
  });
});

describe('T-PE-05 · el PDF de un texto pegado o de varias partes no imprime «===»', () => {
  it('T-PE-05 secciones separadas por una línea vacía, sin el rótulo', async () => {
    const out: RenderedOutput = {
      docId: DOC, revision: 1, withHeadings: true, sections: [
        { partId: 'prt_1' as never, kind: 'cuerpo', label: 'Cuerpo del documento', text: 'Texto del cuerpo ficticio.', segments: [] },
        { partId: 'prt_2' as never, kind: 'nota_pie', label: 'Nota al pie 1', text: 'Nota ficticia.', segments: [] },
      ],
    };
    const items = (await leerPdf(construirPdf(out).bytes)).flatMap((p) => p.items.map((i) => i.str));
    expect(items).toEqual(['Texto del cuerpo ficticio.', 'Nota ficticia.']);
  });
});

const CORPUS = join(process.cwd(), 'corpus');
const DOCX = existsSync(join(CORPUS, 'docs')) ? readdirSync(join(CORPUS, 'docs')).filter((f) => /^C\d\d\.docx$/u.test(f)).sort() : [];

describe('T-PE-06 · corpus .docx con su gold', () => {
  it.each(DOCX)('T-PE-06 %s: el PDF con estilo sale, sin «===» y sin ningún valor anotado que no siga visible', async (archivo) => {
    const original = new Uint8Array(readFileSync(join(CORPUS, 'docs', archivo)));
    const gold = JSON.parse(readFileSync(join(CORPUS, 'gold', archivo.replace('.docx', '.json')), 'utf8')) as { anotaciones: AnotacionGold[] };
    const doc = leer(original);
    const out = salidaDeGold(doc, gold.anotaciones);
    const r = construirPdfConEstilo(original, doc, out);
    const texto = (await leerPdf(r.bytes)).flatMap((p) => p.items.map((i) => i.str)).join(' ').replace(/\s+/gu, ' ').toLowerCase();
    const ops = flujos(r.bytes).toLowerCase();
    expect(texto).not.toContain('===');
    const visible = out.sections.map((s) => s.text).join('\n').toLowerCase();
    for (const a of gold.anotaciones.filter((x) => !x.es_negativo_esperado && x.texto.length >= 4)) {
      const v = a.texto.toLowerCase();
      if (visible.includes(v)) continue;
      expect(texto.includes(v), `${archivo}: «${a.tipo}»`).toBe(false);
      expect(ops.includes(Buffer.from(v, 'latin1').toString('latin1')), `${archivo}: «${a.tipo}» en el flujo`).toBe(false);
    }
  }, 30_000);
});
