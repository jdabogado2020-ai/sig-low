// T-LE-10 · Exportación: .txt y .docx exportados, nombres neutros, URL blob: revocadas (6.9, 3.8; V-36, V-40, V-48). Solo datos ficticios.
import { DOMParser } from '@xmldom/xmldom';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinOutput } from '../../src/core/render';
import type { DocId, PartId, RenderedOutput } from '../../src/core/types';
import { SiglowError } from '../../src/core/types';
import { construirDocx, exportarDocx } from '../../src/io/docx-write';
import {
  construirTxt, exportarTxt, nombreDescarga, NOMBRE_DESCARGA, revocarUrlsVivas, urlsBlobVivas,
} from '../../src/io/txt-write';

const DOC = 'doc_00112233445566778899aabbccddeeff' as DocId;
const parte = (n: number): PartId => `par_${String(n).padStart(32, '0')}` as PartId;

function seccion(n: number, label: string, text: string, kind: 'cuerpo' | 'encabezado' = 'cuerpo'): RenderedOutput['sections'][number] {
  return { partId: parte(n), kind, label, text, segments: [{ outStart: 0, outEnd: text.length, partStart: 0, partEnd: text.length }] };
}
function salida(...secs: RenderedOutput['sections']): RenderedOutput {
  return { docId: DOC, revision: 1, sections: secs, withHeadings: secs.length > 1 };
}

const UNA = salida(seccion(1, 'Cuerpo del documento', 'Línea uno con ñ y tilde: José Ficticia.\nSegunda línea [CC_1].\n\nCuarta línea.'));
const DOS = salida(
  seccion(1, 'Encabezado 1', 'Radicado: [RADICADO_1]', 'encabezado'),
  seccion(2, 'Cuerpo del documento', 'Campo\t[CC_1]\n\nPárrafo con [DEMANDANTE_1] & <EPS_1> "ejemplo" 😀.'),
);

const ahora = new Date(2026, 9, 22, 15, 40); // 22-oct-2026 15:40, hora local

// --- utilidades del .docx -------------------------------------------------------------------------------------------------
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const abrirDocx = (bytes: Uint8Array) => unzipSync(bytes);
const xmlDocumento = (bytes: Uint8Array): string => strFromU8(abrirDocx(bytes)['word/document.xml'] as Uint8Array);

/** Texto del documento unido por párrafos (w:p), con `w:tab` como '\t'. Falla si el XML está mal formado. */
function textoDelDocumento(xml: string): string {
  const errores: string[] = [];
  const dom = new DOMParser({ onError: (nivel, msg) => { errores.push(`${nivel}: ${msg}`); } }).parseFromString(xml, 'text/xml');
  expect(errores).toEqual([]);
  const ps = dom.getElementsByTagNameNS(W, 'p');
  const lineas: string[] = [];
  for (let i = 0; i < ps.length; i++) {
    let linea = '';
    const runs = ps.item(i)?.getElementsByTagNameNS(W, 'r');
    for (let j = 0; runs !== undefined && j < runs.length; j++) {
      const hijos = runs.item(j)?.childNodes;
      for (let k = 0; hijos !== undefined && k < hijos.length; k++) {
        const n = hijos.item(k);
        if (n?.localName === 't') linea += n.textContent ?? '';
        else if (n?.localName === 'tab') linea += '\t';
      }
    }
    lineas.push(linea);
  }
  return lineas.join('\n');
}

/** Campos fijos del encabezado local y del directorio central de un ZIP (lectura mínima, sin ZIP64). */
function leerZip(b: Uint8Array): { locales: { nombre: string; fechaDos: number; horaDos: number; extra: number }[]; centrales: { nombre: string; fechaDos: number; extra: number; comentario: number }[]; comentarioFinal: number } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const locales: { nombre: string; fechaDos: number; horaDos: number; extra: number }[] = [];
  const centrales: { nombre: string; fechaDos: number; extra: number; comentario: number }[] = [];
  let eocd = b.length - 22;
  while (v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const n = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  for (let i = 0; i < n; i++) {
    const nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
    centrales.push({ nombre: strFromU8(b.subarray(p + 46, p + 46 + nl)), fechaDos: v.getUint16(p + 14, true), extra: el, comentario: cl });
    const loc = v.getUint32(p + 42, true);
    const lnl = v.getUint16(loc + 26, true), lel = v.getUint16(loc + 28, true);
    locales.push({ nombre: strFromU8(b.subarray(loc + 30, loc + 30 + lnl)), horaDos: v.getUint16(loc + 10, true), fechaDos: v.getUint16(loc + 12, true), extra: lel });
    p += 46 + nl + el + cl;
  }
  return { locales, centrales, comentarioFinal: v.getUint16(eocd + 20, true) };
}

// --- nombres --------------------------------------------------------------------------------------------------------------
describe('T-LE-10 nombres de descarga neutros (6.9; V-36)', () => {
  it('INV-G11 construye sig-low-<clase>-AAAAMMDD-HHMM.<ext> con la hora local', () => {
    expect(nombreDescarga('anonimizado', 'txt', ahora)).toBe('sig-low-anonimizado-20261022-1540.txt');
    expect(nombreDescarga('reinsertado', 'docx', ahora)).toBe('sig-low-reinsertado-20261022-1540.docx');
    expect(nombreDescarga('informe', 'json', ahora)).toBe('sig-low-informe-20261022-1540.json');
    expect(nombreDescarga('tabla', 'siglow', ahora)).toBe('sig-low-tabla-20261022-1540.siglow');
    expect(nombreDescarga('anonimizado', 'txt', new Date(2026, 0, 3, 7, 5))).toBe('sig-low-anonimizado-20260103-0705.txt');
  });
  it.each([
    'sig-low-anonimizado-20261022-1540.txt', 'sig-low-reinsertado-20261022-1540.docx', 'sig-low-informe-20261022-1540.json',
    'sig-low-tabla-20261022-1540.siglow',
  ])('casa con la expresión de 6.9: %s', (nombre) => {
    expect(NOMBRE_DESCARGA.test(nombre)).toBe(true);
  });
  it.each([
    'Ana Ficticia Rojas-anonimizado.docx', 'sig-low-anonimizado-PRUEBA-001.txt', 'sig-low-anonimizado-2026-10-22.txt',
    'sig-low-tabla-20261022-1540.json', 'sig-low-informe-20261022-1540.docx',
  ])('no casa con la expresión de 6.9: %s', (nombre) => {
    expect(NOMBRE_DESCARGA.test(nombre)).toBe(false);
  });
  it('una combinación fuera de 6.9 lanza ERROR_INTERNO y no produce nombre', () => {
    expect(() => nombreDescarga('tabla', 'json', ahora)).toThrowError(SiglowError);
    try { nombreDescarga('informe', 'docx', ahora); } catch (e) { expect((e as SiglowError).code).toBe('ERROR_INTERNO'); }
  });
});

// --- .txt -----------------------------------------------------------------------------------------------------------------
describe('T-LE-10 .txt (6.9.1)', () => {
  it.each([['una sección', UNA], ['dos secciones con rótulos', DOS]] as const)('INV-X02 empieza por EF BB BF y no tiene "\\n" sin "\\r" delante: %s', (_n, out) => {
    const b = construirTxt(out);
    expect([...b.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const t = new TextDecoder('utf-8', { ignoreBOM: true }).decode(b);
    expect(t.startsWith('\uFEFF')).toBe(true);
    expect(/(?<!\r)\n/u.test(t)).toBe(false);
    expect(/\r(?!\n)/u.test(t)).toBe(false);
    expect(t).toBe('\uFEFF' + joinOutput(out, '\r\n') + '\r\n');
  });
  it('INV-X02 una cadena (texto reinsertado) con \\n, \\r\\n y \\r sale solo con CRLF', () => {
    const t = new TextDecoder('utf-8', { ignoreBOM: true }).decode(construirTxt('a\nb\r\nc\rd'));
    expect(t).toBe('\uFEFFa\r\nb\r\nc\r\nd\r\n');
  });
  it('conserva tildes, ñ y caracteres fuera del plano básico en UTF-8', () => {
    const t = new TextDecoder().decode(construirTxt(UNA));
    expect(t).toContain('ñ y tilde: José Ficticia');
    expect(new TextDecoder().decode(construirTxt(DOS))).toContain('😀');
  });
  it('con rótulos usa "=== rótulo ===" y una línea vacía entre secciones', () => {
    const t = new TextDecoder().decode(construirTxt(DOS));
    expect(t).toBe('=== Encabezado 1 ===\r\nRadicado: [RADICADO_1]\r\n\r\n=== Cuerpo del documento ===\r\nCampo\t[CC_1]\r\n\r\nPárrafo con [DEMANDANTE_1] & <EPS_1> "ejemplo" 😀.\r\n');
  });
  it('el .txt no lleva metadatos: solo el texto (V-40)', () => {
    expect(construirTxt(UNA).length).toBe(new TextEncoder().encode('\uFEFF' + joinOutput(UNA, '\r\n') + '\r\n').length);
  });
});

// --- .docx ----------------------------------------------------------------------------------------------------------------
describe('T-LE-10 .docx mínimo (6.9.2)', () => {
  const { bytes } = construirDocx(DOS);

  it('INV-X03 tiene exactamente 3 entradas, en orden, y ninguna docProps/*', () => {
    const entradas = Object.keys(abrirDocx(bytes));
    expect(entradas).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']);
    expect(entradas.some((e) => e.startsWith('docProps'))).toBe(false);
    expect(leerZip(bytes).centrales.map((c) => c.nombre)).toEqual(entradas);
  });
  it('INV-X03 cada entrada lleva fecha DOS 1980-01-02 (local y central), sin campos extra ni comentario de ZIP (V-40)', () => {
    const z = leerZip(bytes);
    const FECHA_DOS = ((1980 - 1980) << 9) | (1 << 5) | 2; // 1980-01-02
    expect(z.locales.map((l) => l.fechaDos)).toEqual([FECHA_DOS, FECHA_DOS, FECHA_DOS]);
    expect(z.centrales.map((c) => c.fechaDos)).toEqual([FECHA_DOS, FECHA_DOS, FECHA_DOS]);
    expect(z.locales.map((l) => l.horaDos)).toEqual([0, 0, 0]);
    expect(z.locales.map((l) => l.extra)).toEqual([0, 0, 0]);
    expect(z.centrales.map((c) => c.extra)).toEqual([0, 0, 0]);
    expect(z.centrales.map((c) => c.comentario)).toEqual([0, 0, 0]);
    expect(z.comentarioFinal).toBe(0);
  });
  it('INV-X03 es determinista: dos exportaciones del mismo contenido son idénticas byte a byte (sin hora de exportación)', () => {
    expect([...construirDocx(DOS).bytes]).toEqual([...bytes]);
  });
  it('las partes tienen el contenido de 6.9.2', () => {
    const e = abrirDocx(bytes);
    expect(strFromU8(e['[Content_Types].xml'] as Uint8Array)).toContain('/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"');
    expect(strFromU8(e['_rels/.rels'] as Uint8Array)).toContain('Target="word/document.xml"');
    for (const n of Object.keys(e)) expect(strFromU8(e[n] as Uint8Array).startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')).toBe(true);
    expect(xmlDocumento(bytes)).not.toMatch(/dcterms|cp:|creator|lastModifiedBy|docProps/u);
  });
  it.each([['una sección', UNA], ['dos secciones con rótulos', DOS]] as const)('INV-X04 word/document.xml está bien formado y su texto por párrafos es joinOutput(out, "\\n"): %s', (_n, out) => {
    const { bytes: b } = construirDocx(out);
    expect(textoDelDocumento(xmlDocumento(b))).toBe(joinOutput(out, '\n'));
  });
  it('INV-X04 cadena (texto reinsertado): el texto por párrafos es la cadena con \\n', () => {
    const t = 'Primera & <línea>\tcon tab\r\n\r\nTercera\rCuarta';
    expect(textoDelDocumento(xmlDocumento(construirDocx(t).bytes))).toBe('Primera & <línea>\tcon tab\n\nTercera\nCuarta');
  });
  it('INV-X04 bordes: sección vacía, tabulaciones al inicio, al final y consecutivas', () => {
    const out = salida(seccion(1, 'Encabezado 1', ''), seccion(2, 'Cuerpo del documento', '\tA\t\tB\t'));
    expect(textoDelDocumento(xmlDocumento(construirDocx(out).bytes))).toBe(joinOutput(out, '\n'));
  });
  it('escapa & < > y marca el rótulo en negrita solo con withHeadings; todo w:t lleva xml:space="preserve"', () => {
    const xml = xmlDocumento(bytes);
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;EPS_1&gt;');
    expect(xml).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">=== Encabezado 1 ===</w:t></w:r>');
    expect(xml).toContain('<w:t xml:space="preserve">Campo</w:t><w:tab/><w:t xml:space="preserve">[CC_1]</w:t>');
    expect(xml).toContain('<w:p/>');
    expect(xml.match(/<w:t>/gu)).toBeNull();
    expect(xmlDocumento(construirDocx(UNA).bytes)).not.toContain('<w:b/>');
  });
  it('quita los caracteres no válidos en XML solo al escribir y avisa con CARACTERES_CONTROL', () => {
    const sucio = salida(seccion(1, 'Cuerpo del documento', 'a\u0000b\u0001c\u000Bd\u000Ce\u001Ff\uFFFEg\uFFFFh\uD800i\uDC00j ok\u0009fin'));
    const { bytes: b, avisos } = construirDocx(sucio);
    expect(avisos).toEqual([{ code: 'CARACTERES_CONTROL', count: 9 }]);
    expect(textoDelDocumento(xmlDocumento(b))).toBe('abcdefghij ok\tfin');
    // la salida original no se modifica (se quita solo al escribir)
    expect(sucio.sections[0]?.text).toContain('\u0000');
  });
  it('conserva un par suplente válido y no avisa si no hay caracteres inválidos', () => {
    const r = construirDocx(DOS);
    expect(r.avisos).toEqual([]);
    expect(textoDelDocumento(xmlDocumento(r.bytes))).toContain('😀');
  });
});

// --- descarga y URL blob: -------------------------------------------------------------------------------------------------
describe('T-LE-10 descarga (3.8, V-48)', () => {
  const bitacora: string[] = [];
  let ancla: { href: string; download: string; rel: string; hidden: boolean; click: () => void; remove: () => void } | undefined;
  let blobs: Blob[] = [];

  function instalar(opciones: { fallaClick?: boolean } = {}): void {
    bitacora.length = 0;
    blobs = [];
    let n = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((o: Blob | MediaSource) => {
      blobs.push(o as Blob);
      const url = `blob:https://localhost/${++n}`;
      bitacora.push('crea ' + url);
      return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => { bitacora.push('revoca ' + url); });
    const docFalso = {
      createElement: (tag: string) => {
        expect(tag).toBe('a');
        ancla = {
          href: '', download: '', rel: '', hidden: false,
          click: () => { bitacora.push('click ' + (ancla?.href ?? '')); if (opciones.fallaClick) throw new Error('fallo del clic'); },
          remove: () => { bitacora.push('retira'); },
        };
        return ancla;
      },
      body: { append: () => { bitacora.push('agrega'); } },
    };
    vi.stubGlobal('document', docFalso);
  }
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); revocarUrlsVivas(); ancla = undefined; });

  it('INV-X06 la URL se revoca en el mismo manejador, justo después de click(); no queda ninguna viva', () => {
    instalar();
    const r = exportarTxt(UNA, { ahora });
    expect(bitacora).toEqual(['crea blob:https://localhost/1', 'agrega', 'click blob:https://localhost/1', 'revoca blob:https://localhost/1', 'retira']);
    expect(urlsBlobVivas()).toBe(0);
    expect(ancla?.download).toBe('sig-low-anonimizado-20261022-1540.txt');
    expect(r.nombre).toBe('sig-low-anonimizado-20261022-1540.txt');
    expect(NOMBRE_DESCARGA.test(r.nombre)).toBe(true);
    expect(blobs[0]?.type).toBe('text/plain;charset=utf-8');
    expect(r.bytes).toBe(blobs[0]?.size);
    expect(r.avisos).toEqual([]);
  });
  it('INV-X06 lo mismo para el .docx: tipo MIME de OOXML, nombre neutro y revocación inmediata', () => {
    instalar();
    const r = exportarDocx(DOS, { clase: 'reinsertado', ahora });
    expect(bitacora.map((l) => l.split(' ')[0])).toEqual(['crea', 'agrega', 'click', 'revoca', 'retira']);
    expect(urlsBlobVivas()).toBe(0);
    expect(r.nombre).toBe('sig-low-reinsertado-20261022-1540.docx');
    expect(blobs[0]?.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(r.bytes).toBe(blobs[0]?.size);
  });
  it('INV-X06 si el clic falla, la URL se revoca de todos modos (sin URL viva)', () => {
    instalar({ fallaClick: true });
    expect(() => exportarTxt(UNA, { ahora })).toThrow();
    expect(bitacora.filter((l) => l.startsWith('revoca'))).toHaveLength(1);
    expect(bitacora.at(-1)).toBe('retira');
    expect(urlsBlobVivas()).toBe(0);
  });
  it('el nombre del archivo no contiene nada del contenido (V-36)', () => {
    instalar();
    exportarTxt(salida(seccion(1, 'Cuerpo del documento', 'Ana Ficticia Rojas, CC 1.000.000.001')), { ahora });
    expect(ancla?.download).not.toMatch(/ana|ficticia|rojas|1\.?000/iu);
  });
  it('revocarUrlsVivas no falla sin URL vivas', () => {
    instalar();
    revocarUrlsVivas();
    expect(bitacora).toEqual([]);
  });
});
