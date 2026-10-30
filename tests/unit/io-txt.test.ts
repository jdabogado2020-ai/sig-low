// T-LE-01 · Lectura de .txt: codificaciones, saltos de línea y archivo vacío (6.1.1, 3.5). Solo datos ficticios.
import { describe, expect, it } from 'vitest';
import { SiglowError } from '../../src/core/types';
import type { DocId, DocumentModel, ErrorCode, IdSource } from '../../src/core/types';
import { canonico, decodeTxt, randomIds, readTxt } from '../../src/io/txt-read';

const DOC = 'doc_00112233445566778899aabbccddeeff' as DocId;
const ETIQUETA_NEUTRA = /^(Documento \d+|Cuerpo del documento|Texto pegado|Encabezado \d+|Pie de página \d+|Nota al pie \d+|Nota al final \d+|Comentario \d+|Página \d+|Anotación \d+ \(página \d+\))$/;

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
function utf16(s: string, endian: 'le' | 'be', bom: boolean): Uint8Array {
  const out: number[] = bom ? (endian === 'le' ? [0xff, 0xfe] : [0xfe, 0xff]) : [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (endian === 'le') out.push(c & 0xff, c >> 8); else out.push(c >> 8, c & 0xff);
  }
  return Uint8Array.from(out);
}
const latin1 = (s: string): Uint8Array => Uint8Array.from([...s].map((ch) => ch.charCodeAt(0)));
const cat = (...p: Array<ArrayLike<number>>): Uint8Array => Uint8Array.from(p.flatMap((x) => Array.from(x)));
const leer = (b: Uint8Array, ids?: IdSource): DocumentModel =>
  readTxt(b, ids === undefined ? { docId: DOC, label: 'Documento 1' } : { docId: DOC, label: 'Documento 1', ids });
function codigo(f: () => unknown): ErrorCode | 'NO_LANZA' {
  try { f(); } catch (e) { return e instanceof SiglowError ? e.code : 'ERROR_INTERNO'; }
  return 'NO_LANZA';
}

const TEXTO = 'Señor José Ficticia: la acción de tutela nº 123, “Ejemplo”.';

describe('T-LE-01 .txt: codificaciones', () => {
  it('UTF-8 sin BOM', () => {
    const d = leer(utf8(TEXTO));
    expect(d.parts[0]?.text).toBe(TEXTO);
    expect(d.encoding).toBe('utf-8');
    expect(d.warnings).toEqual([]);
  });
  it('UTF-8 con BOM: el BOM no queda en el texto', () => {
    const d = leer(cat([0xef, 0xbb, 0xbf], utf8(TEXTO)));
    expect(d.parts[0]?.text).toBe(TEXTO);
    expect(d.encoding).toBe('utf-8');
    expect(d.warnings).toEqual([]);
  });
  it('UTF-16LE con BOM', () => {
    const d = leer(utf16(TEXTO, 'le', true));
    expect(d.parts[0]?.text).toBe(TEXTO);
    expect(d.encoding).toBe('utf-16le');
    expect(d.warnings).toEqual([]);
  });
  it('UTF-16BE con BOM', () => {
    const d = leer(utf16(TEXTO, 'be', true));
    expect(d.parts[0]?.text).toBe(TEXTO);
    expect(d.encoding).toBe('utf-16be');
    expect(d.warnings).toEqual([]);
  });
  it('UTF-16LE sin BOM: aviso UTF16_SIN_BOM', () => {
    const d = leer(utf16(TEXTO, 'le', false));
    expect(d.parts[0]?.text).toBe(TEXTO);
    expect(d.encoding).toBe('utf-16le');
    expect(d.warnings).toEqual([{ code: 'UTF16_SIN_BOM', count: 1 }]);
  });
  it('UTF-16BE sin BOM: aviso UTF16_SIN_BOM', () => {
    const d = leer(utf16(TEXTO, 'be', false));
    expect(d.parts[0]?.text).toBe(TEXTO);
    expect(d.encoding).toBe('utf-16be');
    expect(d.warnings).toEqual([{ code: 'UTF16_SIN_BOM', count: 1 }]);
  });
  it('windows-1252 («Señor José»): aviso CODIFICACION_ALTERNATIVA', () => {
    const d = leer(latin1('Señor José Ficticia, ñandú y camión.'));
    expect(d.parts[0]?.text).toBe('Señor José Ficticia, ñandú y camión.');
    expect(d.encoding).toBe('windows-1252');
    expect(d.warnings).toEqual([{ code: 'CODIFICACION_ALTERNATIVA', count: 1 }]);
  });
  it('windows-1252: los signos de 0x80 a 0x9F (comillas, raya, euro) se leen como tales', () => {
    const d = leer(cat([0x93], latin1('Ejemplo'), [0x94, 0x20, 0x96, 0x20, 0x80]));
    expect(d.parts[0]?.text).toBe('“Ejemplo” – €');
    expect(d.encoding).toBe('windows-1252');
  });
  it('UTF-8 con BOM pero bytes inválidos: cae a windows-1252 con aviso', () => {
    const d = leer(cat([0xef, 0xbb, 0xbf], latin1('Jos'), [0xe9]));
    expect(d.parts[0]?.text).toBe('José');
    expect(d.encoding).toBe('windows-1252');
    expect(d.warnings).toEqual([{ code: 'CODIFICACION_ALTERNATIVA', count: 1 }]);
  });
  it('ASCII puro es UTF-8 sin avisos', () => {
    const d = leer(utf8('Texto sin tildes.'));
    expect(d.encoding).toBe('utf-8');
    expect(d.warnings).toEqual([]);
  });
  it('un UTF-8 con unos pocos NUL (menos de 10 %) sigue siendo UTF-8', () => {
    const b = utf8('x'.repeat(200) + '\u0000' + 'y'.repeat(200));
    expect(decodeTxt(b).encoding).toBe('utf-8');
  });
  it('emoji y caracteres fuera del plano básico sobreviven a UTF-8 y UTF-16', () => {
    const t = 'Ejemplo 😀 𝒜 fin';
    expect(leer(utf8(t)).parts[0]?.text).toBe(t);
    expect(leer(utf16(t, 'le', true)).parts[0]?.text).toBe(t);
    expect(leer(utf16(t, 'be', true)).parts[0]?.text).toBe(t);
  });
  it('UTF-16 de longitud impar no lanza', () => {
    const b = utf16('Hola ejemplo', 'le', true);
    expect(() => leer(b.subarray(0, b.length - 1))).not.toThrow();
  });
});

describe('T-LE-01 .txt: saltos de línea y texto canónico', () => {
  it('CRLF y CR pasan a LF', () => {
    expect(leer(utf8('uno\r\ndos\rtres\ncuatro')).parts[0]?.text).toBe('uno\ndos\ntres\ncuatro');
    expect(leer(utf16('uno\r\ndos\rtres', 'le', true)).parts[0]?.text).toBe('uno\ndos\ntres');
  });
  it('el texto sale en NFC', () => {
    const nfd = 'María Ficticia Rojas';
    const d = leer(utf8(nfd));
    expect(d.parts[0]?.text).toBe('María Ficticia Rojas');
    expect(d.parts[0]?.text).toBe(canonico(nfd));
  });
  it('se conservan espacios duros, guiones largos, ceros de ancho, guiones blandos y tabuladores', () => {
    const t = 'a b — c​d Ro­jas\te';
    expect(leer(utf8(t)).parts[0]?.text).toBe(t);
  });
  it('un U+FEFF interior se conserva (solo se quita el BOM inicial)', () => {
    const t = 'uno﻿dos';
    expect(leer(utf8(t)).parts[0]?.text).toBe(t);
  });
  it('no recorta espacios ni saltos al principio o al final', () => {
    expect(leer(utf8('  hola\n\n')).parts[0]?.text).toBe('  hola\n\n');
  });
});

describe('T-LE-01 .txt: archivo vacío y formatos que no son texto', () => {
  it('archivo vacío → ARCHIVO_VACIO', () => {
    expect(codigo(() => leer(new Uint8Array(0)))).toBe('ARCHIVO_VACIO');
  });
  it('solo BOM, o solo espacios y saltos → ARCHIVO_VACIO (no se crean partes vacías)', () => {
    expect(codigo(() => leer(Uint8Array.from([0xef, 0xbb, 0xbf])))).toBe('ARCHIVO_VACIO');
    expect(codigo(() => leer(Uint8Array.from([0xff, 0xfe])))).toBe('ARCHIVO_VACIO');
    expect(codigo(() => leer(utf8(' \r\n\t\n  ')))).toBe('ARCHIVO_VACIO');
  });
  it('contenedor CFB (.doc) → CONTENEDOR_CFB; ZIP y PDF disfrazados de .txt → FORMATO_NO_ADMITIDO', () => {
    expect(codigo(() => leer(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])))).toBe('CONTENEDOR_CFB');
    expect(codigo(() => leer(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])))).toBe('FORMATO_NO_ADMITIDO');
    expect(codigo(() => leer(utf8('%PDF-1.7\n%ejemplo')))).toBe('FORMATO_NO_ADMITIDO');
  });
  it('el error es un SiglowError cuyo message es el código', () => {
    expect.assertions(2);
    try { leer(new Uint8Array(0)); } catch (e) {
      expect(e).toBeInstanceOf(SiglowError);
      expect((e as SiglowError).message).toBe('ARCHIVO_VACIO');
    }
  });
});

describe('T-LE-01 .txt: forma del DocumentModel', () => {
  it('INV-D01 part.text está en NFC y no contiene \\r en las seis rutas de decodificación', () => {
    const t = 'María\r\nJosé\rFicticia\nEjemplo';
    const variantes = [utf8(t), cat([0xef, 0xbb, 0xbf], utf8(t)), utf16(t, 'le', true), utf16(t, 'be', true), utf16(t, 'le', false), utf16(t, 'be', false)];
    for (const b of variantes) {
      const x = leer(b).parts[0]?.text ?? '';
      expect(x).toBe(x.normalize('NFC'));
      expect(x).not.toContain('\r');
      expect(x).toBe('María\nJosé\nFicticia\nEjemplo');
    }
    const w = leer(cat(latin1('Se'), [0xf1], latin1('or Jos\r\nFicticia'))).parts[0]?.text ?? '';
    expect(w).not.toContain('\r');
    expect(w).toBe('Señor Jos\nFicticia');
  });
  it('INV-D02 una sola parte cuerpo, order 0, index 1, incluida', () => {
    const d = leer(utf8('Hola ejemplo'));
    expect(d.parts).toHaveLength(1);
    expect(d.parts[0]).toMatchObject({ kind: 'cuerpo', order: 0, index: 1, included: true, docId: DOC });
  });
  it('INV-D03 las etiquetas del documento y de la parte casan con ETIQUETA_NEUTRA', () => {
    const d = leer(utf8('Hola ejemplo'));
    expect(d.label).toMatch(ETIQUETA_NEUTRA);
    expect(d.parts[0]?.label).toMatch(ETIQUETA_NEUTRA);
    expect(d.parts[0]?.label).toBe('Cuerpo del documento');
  });
  it('INV-D04 metadatos y avisos solo llevan categorías, códigos y números', () => {
    const d = leer(utf16('Ana Ficticia Rojas', 'le', false));
    expect(d.metadata).toEqual({ categories: {} });
    expect(JSON.stringify(d.warnings)).not.toMatch(/Ficticia|Rojas/);
    expect(JSON.stringify(d.metadata)).not.toMatch(/Ficticia|Rojas/);
    expect(d.source).toBe('txt');
  });
  it('INV-G05 los ids de parte son aleatorios: dos lecturas idénticas dan ids distintos', () => {
    const a = leer(utf8('Mismo contenido'));
    const b = leer(utf8('Mismo contenido'));
    expect(a.parts[0]?.id).toMatch(/^prt_[0-9a-f]{32}$/);
    expect(a.parts[0]?.id).not.toBe(b.parts[0]?.id);
  });
  it('acepta un IdSource inyectado (pruebas deterministas)', () => {
    const fijo: IdSource = { next: (p) => `${p}_${'0'.repeat(31)}1` };
    expect(leer(utf8('Hola ejemplo'), fijo).parts[0]?.id).toBe('prt_' + '0'.repeat(31) + '1');
  });
  it('randomIds produce prefijo y 32 hexadecimales', () => {
    expect(randomIds().next('req')).toMatch(/^req_[0-9a-f]{32}$/);
  });
});
