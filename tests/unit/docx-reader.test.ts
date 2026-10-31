// T-LE-02 a T-LE-05 (parte I, PE-2): lector .docx: partes por relaciones, límites, XML hostil y etiquetas neutras.
// La parte II (PE-3) añade el inventario de metadatos, el texto oculto, altChunk, marcas de agua, gráficos y OOXML Strict. Solo datos ficticios.
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiglowError } from '../../src/core/types';
import type { DocId, DocumentModel, ErrorCode, IdSource, IoLimits } from '../../src/core/types';
import { readDocx } from '../../src/io/docx-read';
import { handleIoMessage } from '../../src/io/io-handler';
import { IO_LIMITS_POR_DEFECTO } from '../../src/io/io-client';
import { W, construirDocx, decl, documento, p, parchearCentral, pt, r, raiz, tipoRel, utf16 } from '../fixtures/docx/docx-builder';
import type { ParteExtra } from '../fixtures/docx/docx-builder';

const DOC = 'doc_00112233445566778899aabbccddeeff' as DocId;
const LIM = IO_LIMITS_POR_DEFECTO;
const ETIQUETA_NEUTRA = /^(Documento \d+|Cuerpo del documento|Texto pegado|Encabezado \d+|Pie de página \d+|Nota al pie \d+|Nota al final \d+|Comentario \d+|Página \d+|Anotación \d+ \(página \d+\))$/;

function ids(): IdSource {
  let n = 0;
  return { next: (prefix) => `${prefix}_${(n++).toString(16).padStart(32, '0')}` };
}
const leer = (b: Uint8Array, limits: IoLimits = LIM): DocumentModel => readDocx(b, { docId: DOC, label: 'Documento 1', ids: ids() }, limits);
function codigo(f: () => unknown): ErrorCode | 'NO_LANZA' {
  try { f(); } catch (e) { return e instanceof SiglowError ? e.code : 'ERROR_INTERNO'; }
  return 'NO_LANZA';
}
const textos = (d: DocumentModel): string[] => d.parts.map((x) => x.text);
const extra = (nombre: string, tipo: string, xml: string | Uint8Array): ParteExtra => ({ nombre, tipo, xml });
const hdr = (...ps: string[]): string => raiz('hdr', ps.join(''));
const ftr = (...ps: string[]): string => raiz('ftr', ps.join(''));
const refs = (...rIds: Array<[string, string]>): string =>
  `<w:p><w:pPr><w:sectPr>${rIds.map(([t, id]) => `<w:${t}Reference w:type="default" r:id="${id}"/>`).join('')}</w:sectPr></w:pPr></w:p>`;

describe('T-LE-02 .docx: texto del cuerpo (6.1.1)', () => {
  it('«Ana Fic» + «ticia» se unen aunque estén en corridas, con formato distinto y con marcas de revisión entre ellas', () => {
    const cuerpo = p(r('Ana Fic'), '<w:proofErr w:type="spellStart"/>', '<w:r><w:rPr><w:b/></w:rPr><w:t>ticia</w:t></w:r>', r(' Rojas'));
    const d = leer(construirDocx({ cuerpo }));
    expect(textos(d)).toEqual(['Ana Ficticia Rojas']);
    expect(d.source).toBe('docx');
  });

  it('un párrafo por línea, sin salto final; celdas con un párrafo por línea', () => {
    const cuerpo = pt('Uno') + pt('') + pt('Tres') +
      '<w:tbl><w:tr><w:tc>' + pt('Celda A1') + pt('Celda A2') + '</w:tc><w:tc>' + pt('Celda B1') + '</w:tc></w:tr></w:tbl>' + pt('') + pt('');
    const d = leer(construirDocx({ cuerpo }));
    expect(textos(d)).toEqual(['Uno\n\nTres\nCelda A1\nCelda A2\nCelda B1']);
  });

  it('tabulación, salto, guion no separable, guion blando y símbolo', () => {
    const cuerpo = p('<w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t><w:noBreakHyphen/><w:softHyphen/><w:t>d</w:t><w:cr/><w:sym w:font="Symbol" w:char="F0B7"/></w:r>');
    expect(textos(leer(construirDocx({ cuerpo })))).toEqual(['a\tb\nc‑d\n']);
  });

  it('INV-D01 · el texto está en NFC y sin «\\r» aunque el XML traiga CRLF y letras combinadas', () => {
    const cuerpo = p('<w:r><w:t>uno&#13;\ndos&#13;tres</w:t></w:r>', r('José Ficticia'));
    const t = textos(leer(construirDocx({ cuerpo })))[0] ?? '';
    expect(t).not.toContain('\r');
    expect(t).toBe('uno\ndos\ntresJosé Ficticia'.normalize('NFC'));
    expect(t).toBe(t.normalize('NFC'));
  });

  it('w:ins se lee; w:del y w:moveFrom se excluyen (también un w:t dentro) con aviso TEXTO_ELIMINADO_EXCLUIDO', () => {
    const cuerpo = p(
      r('Antes '),
      '<w:del w:id="1" w:author="Revisor Ficticio"><w:r><w:delText>borrado Ficticio</w:delText></w:r></w:del>',
      '<w:del w:id="2" w:author="Revisor Ficticio"><w:r><w:t>otro borrado</w:t></w:r></w:del>',
      '<w:moveFrom w:id="3"><w:r><w:t>movido</w:t></w:r></w:moveFrom>',
      '<w:moveTo w:id="4"><w:r><w:t>destino</w:t></w:r></w:moveTo>',
      '<w:ins w:id="5" w:author="Revisor Ficticio"><w:r><w:t>insertado</w:t></w:r></w:ins>',
    );
    const d = leer(construirDocx({ cuerpo }));
    expect(textos(d)).toEqual(['Antes destinoinsertado']);
    expect(d.warnings).toEqual([{ code: 'TEXTO_ELIMINADO_EXCLUIDO', partId: d.parts[0]?.id, count: 3 }]);
    expect(JSON.stringify(d)).not.toMatch(/borrado|movido/);
  });

  it('cuadro de texto: mc:Choice + mc:Fallback aparece una vez, en su anclaje; con solo Choice también', () => {
    const caja = (t: string): string => `<w:txbxContent>${pt(t)}</w:txbxContent>`;
    const ac = `<mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:wsp><wps:txbx>${caja('Cuadro de prueba')}</wps:txbx></wps:wsp></w:drawing></mc:Choice>` +
      `<mc:Fallback><w:pict><v:shape><v:textbox>${caja('Cuadro de prueba')}</v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent>`;
    const solo = `<mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:wsp><wps:txbx>${caja('Solo Choice')}</wps:txbx></wps:wsp></w:drawing></mc:Choice></mc:AlternateContent>`;
    const cuerpo = p(r('Antes '), `<w:r>${ac}</w:r>`, r('después')) + p(`<w:r>${solo}</w:r>`);
    const d = leer(construirDocx({ cuerpo }));
    expect(textos(d)).toEqual(['Antes \nCuadro de prueba\ndespués\nSolo Choice']);
  });

  it('fldChar: el resultado sí, instrText no; fldSimple; w:sdt; smartTag y customXml', () => {
    const cuerpo =
      p('<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "https://ejemplo.test/oculto" </w:instrText></w:r>',
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>', r('resultado visible'), '<w:r><w:fldChar w:fldCharType="end"/></w:r>') +
      p('<w:fldSimple w:instr=" PAGE "><w:r><w:t>3</w:t></w:r></w:fldSimple>') +
      '<w:sdt><w:sdtPr><w:alias w:val="Autor Ficticio"/><w:tag w:val="etiqueta"/></w:sdtPr><w:sdtContent>' + pt('Dentro del control') + '</w:sdtContent></w:sdt>' +
      p('<w:sdt><w:sdtPr><w:alias w:val="Alias Prueba"/></w:sdtPr><w:sdtContent><w:r><w:t>control en línea</w:t></w:r></w:sdtContent></w:sdt>') +
      p('<w:smartTag w:uri="urn:x" w:element="x"><w:r><w:t>etiqueta inteligente</w:t></w:r></w:smartTag>') +
      '<w:customXml w:uri="urn:x" w:element="y">' + pt('XML personalizado') + '</w:customXml>';
    const d = leer(construirDocx({ cuerpo }));
    expect(textos(d)).toEqual(['resultado visible\n3\nDentro del control\ncontrol en línea\netiqueta inteligente\nXML personalizado']);
    expect(textos(d)[0]).not.toMatch(/HYPERLINK|oculto|Alias|Autor/);
  });

  it('un párrafo anidado muy profundo no agota la pila', () => {
    const n = 20_000;
    const cuerpo = '<w:customXml w:uri="u" w:element="e">'.repeat(n) + pt('Fondo de prueba') + '</w:customXml>'.repeat(n);
    expect(textos(leer(construirDocx({ cuerpo })))).toEqual(['Fondo de prueba']);
  });
});

describe('T-LE-02 .docx: partes por relaciones y orden de lectura (6.3.1, 6.3.2)', () => {
  const ENC = 'header';
  const cabeceras: ParteExtra[] = [
    extra('cabecera-primera.xml', ENC, hdr(pt('Encabezado de primera página'))),
    extra('raro/nombre libre.xml', ENC, hdr(pt('Encabezado predeterminado'))),
    extra('pares.xml', ENC, hdr(pt('Encabezado de páginas pares'))),
  ];

  it('encabezados y pies con nombres no estándar se localizan por relación; el orden sigue su aparición en el documento', () => {
    const extras: ParteExtra[] = [
      ...cabeceras,
      extra('pie-x.xml', 'footer', ftr(pt('Pie predeterminado'), pt('Segunda línea del pie'))),
    ];
    // Aparecen: predeterminado (rId11), pares (rId12), primera (rId10) y el pie (rId13).
    const cuerpo = pt('Cuerpo de prueba') + refs(['header', 'rId11'], ['header', 'rId12'], ['header', 'rId10'], ['footer', 'rId13']);
    const d = leer(construirDocx({ cuerpo, extras }));
    expect(d.parts.map((x) => [x.kind, x.label, x.text])).toEqual([
      ['encabezado', 'Encabezado 1', 'Encabezado predeterminado'],
      ['encabezado', 'Encabezado 2', 'Encabezado de páginas pares'],
      ['encabezado', 'Encabezado 3', 'Encabezado de primera página'],
      ['cuerpo', 'Cuerpo del documento', 'Cuerpo de prueba'],
      ['pie', 'Pie de página 1', 'Pie predeterminado\nSegunda línea del pie'],
    ]);
  });

  it('INV-D02 · partes ordenadas por rango y orden del lector; order es 0..n-1 sin huecos; index por tipo', () => {
    const sep = (t: string, id: number): string => `<w:footnote w:type="${t}" w:id="${id}">${pt('SEPARADOR ' + t)}</w:footnote>`;
    const extras: ParteExtra[] = [
      extra('comentarios.xml', 'comments', raiz('comments',
        `<w:comment w:id="0" w:author="Autor Ficticio" w:initials="AF" w:date="2020-01-01T00:00:00Z">${pt('Comentario uno')}</w:comment>` +
        `<w:comment w:id="1" w:author="Autora Ejemplo" w:initials="AE">${pt('Comentario dos')}</w:comment>`)),
      extra('finales.xml', 'endnotes', raiz('endnotes', sep('separator', -1) + `<w:endnote w:id="2">${pt('Nota final uno')}</w:endnote>`)),
      extra('notas.xml', 'footnotes', raiz('footnotes',
        sep('separator', -1) + sep('continuationSeparator', 0) + sep('continuationNotice', 1) +
        `<w:footnote w:id="7">${pt('Nota al pie siete')}</w:footnote><w:footnote w:id="3">${pt('Nota al pie tres')}</w:footnote>`)),
      extra('pie.xml', 'footer', ftr(pt('Pie uno'))),
      extra('cab.xml', 'header', hdr(pt('Cabeza uno'))),
    ];
    const d = leer(construirDocx({ cuerpo: pt('Cuerpo de prueba'), extras }));
    expect(d.parts.map((x) => x.kind)).toEqual(['encabezado', 'cuerpo', 'pie', 'nota_pie', 'nota_pie', 'nota_final', 'comentario', 'comentario']);
    expect(d.parts.map((x) => x.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(d.parts.map((x) => x.label)).toEqual([
      'Encabezado 1', 'Cuerpo del documento', 'Pie de página 1', 'Nota al pie 1', 'Nota al pie 2', 'Nota al final 1', 'Comentario 1', 'Comentario 2',
    ]);
    expect(d.parts.map((x) => x.index)).toEqual([1, 1, 1, 1, 2, 1, 1, 2]);
    expect(textos(d)).toEqual(['Cabeza uno', 'Cuerpo de prueba', 'Pie uno', 'Nota al pie siete', 'Nota al pie tres', 'Nota final uno', 'Comentario uno', 'Comentario dos']);
    expect(textos(d).join('|')).not.toContain('SEPARADOR');
    expect(d.parts.every((x) => x.included && x.docId === DOC)).toBe(true);
  });

  it('no se crean partes vacías o solo con espacios; si no queda ninguna → ARCHIVO_VACIO', () => {
    const extras = [extra('vacio.xml', 'header', hdr(pt('   '), pt('')))];
    const d = leer(construirDocx({ cuerpo: pt('Cuerpo de prueba'), extras }));
    expect(d.parts.map((x) => x.kind)).toEqual(['cuerpo']);
    expect(codigo(() => leer(construirDocx({ cuerpo: pt('  ') + pt('') })))).toBe('ARCHIVO_VACIO');
  });

  it('la parte principal se localiza por la relación officeDocument, aunque tenga otro nombre; y por [Content_Types].xml si falta _rels/.rels', () => {
    const cuerpoXml = strToU8(documento(pt('Cuerpo con nombre libre')));
    const porRel = zipSync({
      '[Content_Types].xml': strToU8(`${decl}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`),
      '_rels/.rels': strToU8(`${decl}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="a" Type="${tipoRel('officeDocument')}" Target="/contenido/Principal.XML"/></Relationships>`),
      'contenido/principal.xml': cuerpoXml,
    });
    expect(textos(leer(porRel))).toEqual(['Cuerpo con nombre libre']);
    const porTipo = zipSync({
      '[Content_Types].xml': strToU8(`${decl}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/otro/cuerpo.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
      'otro/cuerpo.xml': cuerpoXml,
    });
    expect(textos(leer(porTipo))).toEqual(['Cuerpo con nombre libre']);
    expect(codigo(() => leer(zipSync({ 'a.xml': strToU8('<a/>') })))).toBe('SIN_DOCUMENTO_PRINCIPAL');
  });

  it('partes XML en UTF-8 con BOM, UTF-16 con y sin BOM, y declaración iso-8859-1', () => {
    const xml = documento(pt('Señor Ejemplo Ficticio'));
    const esperado = ['Señor Ejemplo Ficticio'];
    const bom8 = Uint8Array.from([0xef, 0xbb, 0xbf, ...strToU8(xml)]);
    expect(textos(leer(construirDocx({ cuerpo: '', documentoXml: bom8 })))).toEqual(esperado);
    for (const [fin, bom] of [['le', true], ['be', true], ['le', false], ['be', false]] as const) {
      expect(textos(leer(construirDocx({ cuerpo: '', documentoXml: utf16(xml, fin, bom) })))).toEqual(esperado);
    }
    const l1 = Uint8Array.from(documento(pt('Señor Ejemplo Ficticio')).replace('UTF-8', 'ISO-8859-1'), (c) => c.charCodeAt(0));
    expect(textos(leer(construirDocx({ cuerpo: '', documentoXml: l1 })))).toEqual(esperado);
  });
});

describe('T-LE-03 .docx: límites y contenedores (V-41)', () => {
  const docMin = (): Uint8Array => construirDocx({ cuerpo: pt('Cuerpo de prueba') });
  const grande = (bytes: number): string => pt(' '.repeat(bytes));

  it('archivo > maxFileBytes → ARCHIVO_DEMASIADO_GRANDE; vacío → ARCHIVO_VACIO', () => {
    expect(codigo(() => leer(docMin(), { ...LIM, maxFileBytes: 100 }))).toBe('ARCHIVO_DEMASIADO_GRANDE');
    expect(codigo(() => leer(new Uint8Array(0)))).toBe('ARCHIVO_VACIO');
  });

  it('más de 1024 entradas → DEMASIADAS_ENTRADAS (también con el tope reducido)', () => {
    const muchas: Record<string, Uint8Array> = { 'word/document.xml': strToU8(documento(pt('x'))) };
    for (let i = 0; i < 1100; i++) muchas[`word/media/i${i}.png`] = new Uint8Array(1);
    expect(codigo(() => leer(zipSync(muchas, { level: 0 })))).toBe('DEMASIADAS_ENTRADAS');
    expect(codigo(() => leer(docMin(), { ...LIM, maxZipEntries: 3 }))).toBe('DEMASIADAS_ENTRADAS');
  });

  it('parte XML > 15 MiB → PARTE_XML_EXCEDE_LIMITE (bomba honesta, con los límites por defecto)', () => {
    const d = construirDocx({ cuerpo: grande(16 * 1024 * 1024) });
    expect(d.length).toBeLessThan(200_000);
    expect(codigo(() => leer(d))).toBe('PARTE_XML_EXCEDE_LIMITE');
  });

  it('suma descomprimida sobre el tope → DESCOMPRIMIDO_EXCEDE_LIMITE (partes cada una dentro de su tope)', () => {
    const extras = [1, 2, 3, 4].map((i) => extra(`h${i}.xml`, 'header', hdr(pt('x'.repeat(2000)))));
    const d = construirDocx({ cuerpo: pt('Cuerpo de prueba'), extras });
    expect(codigo(() => leer(d, { ...LIM, maxXmlPartBytes: 3000, maxUncompressedTotal: 7000 }))).toBe('DESCOMPRIMIDO_EXCEDE_LIMITE');
    expect(codigo(() => leer(d, { ...LIM, maxXmlPartBytes: 3000, maxUncompressedTotal: 100_000 }))).toBe('NO_LANZA');
  });

  it('tamaño declarado falso (menor o mayor que el real) → PARTE_TRUNCADA, sin descomprimir de más', () => {
    const d = construirDocx({ cuerpo: grande(5 * 1024 * 1024) });
    const t0 = performance.now();
    expect(codigo(() => leer(parchearCentral(d, 'word/document.xml', 24, 100)))).toBe('PARTE_TRUNCADA');
    expect(performance.now() - t0).toBeLessThan(3000);
    const real = docMin();
    expect(codigo(() => leer(parchearCentral(real, 'word/document.xml', 24, 1_000_000)))).toBe('PARTE_TRUNCADA');
    expect(codigo(() => leer(parchearCentral(real, 'word/document.xml', 20, 3)))).not.toBe('NO_LANZA');
  });

  it('bomba con tamaño declarado falso y flujo enorme: se corta pronto con PARTE_TRUNCADA', () => {
    const d = construirDocx({ cuerpo: '', documentoXml: new Uint8Array(48 * 1024 * 1024).fill(0x20) });
    const falso = parchearCentral(d, 'word/document.xml', 24, 1000);
    const t0 = performance.now();
    expect(codigo(() => leer(falso))).toBe('PARTE_TRUNCADA');
    expect(performance.now() - t0).toBeLessThan(3000);
  });

  // PE-3-r1 · B-13: los bytes descomprimidos son texto del documento; los trozos intermedios de `inflar` y la parte que no se
  // entrega (`out`) se ponen en cero antes de lanzar. Se espía `fill` (instalado después de armar los archivos de prueba).
  describe('B-13 · memoria descomprimida en cero en los caminos de error', () => {
    afterEach(() => { vi.restoreAllMocks(); });
    // Texto poco comprimible (determinista): el flujo supera varios pasos de 16 KiB y produce varios trozos al descomprimir.
    function ruido(n: number): string {
      let x = 12345;
      let s = '';
      while (s.length < n) { x = (x * 1103515245 + 12345) % 2147483648; s += (x >> 8).toString(36) + (x % 7 === 0 ? ' Ana Ficticia Rojas ' : ' '); }
      return s.slice(0, n);
    }
    function espiarFill(): Array<{ ref: Uint8Array; habiaDatos: boolean }> {
      const original = Uint8Array.prototype.fill;
      const vistos: Array<{ ref: Uint8Array; habiaDatos: boolean }> = [];
      vi.spyOn(Uint8Array.prototype, 'fill').mockImplementation(function (this: Uint8Array, ...args: [number, number?, number?]) {
        vistos.push({ ref: this, habiaDatos: this.some((x) => x !== 0) });
        return original.apply(this, args);
      });
      return vistos;
    }
    const conDatos = (v: Array<{ ref: Uint8Array; habiaDatos: boolean }>, entrada: Uint8Array): Uint8Array[] =>
      v.filter((x) => x.habiaDatos && x.ref.length > 1000 && x.ref.buffer !== entrada.buffer).map((x) => x.ref); // sin el buffer de entrada ni las partes pequeñas (`[Content_Types].xml`, relaciones), que xmlDe siempre pone en cero

    it('T-LE-03 B-13 tamaño declarado menor que el real: los trozos ya descomprimidos quedan en cero', () => {
      const d = construirDocx({ cuerpo: pt(ruido(300_000)) });
      const falso = parchearCentral(d, 'word/document.xml', 24, 1000);
      const vistos = espiarFill();
      expect(codigo(() => leer(falso))).toBe('PARTE_TRUNCADA');
      const rastro = conDatos(vistos, falso);
      expect(rastro.length).toBeGreaterThan(0);
      for (const t of rastro) expect(t.every((x) => x === 0)).toBe(true);
    });

    it('T-LE-03 B-13 tamaño declarado mayor que el real: la parte no entregada (`out`) queda en cero', () => {
      const d = construirDocx({ cuerpo: pt(ruido(2000)) });
      const falso = parchearCentral(d, 'word/document.xml', 24, 1_000_000);
      const vistos = espiarFill();
      expect(codigo(() => leer(falso))).toBe('PARTE_TRUNCADA');
      const rastro = conDatos(vistos, falso);
      expect(rastro.length).toBeGreaterThan(0);
      expect(rastro.some((t) => t.length > 500)).toBe(true);
      for (const t of rastro) expect(t.every((x) => x === 0)).toBe(true);
    });

    it('T-LE-03 B-13 flujo deflate dañado a mitad de la parte: los trozos previos quedan en cero', () => {
      const d = construirDocx({ cuerpo: pt(ruido(300_000)) });
      const roto = d.slice();
      // Se corrompe el flujo comprimido de word/document.xml (después de la cabecera local) para que falle a mitad de camino.
      const nombre = strToU8('word/document.xml');
      let ini = -1;
      for (let i = 0; i + 30 + nombre.length < roto.length; i++) {
        if (roto[i] === 0x50 && roto[i + 1] === 0x4b && roto[i + 2] === 3 && roto[i + 3] === 4 && nombre.every((b, k) => roto[i + 30 + k] === b)) { ini = i + 30 + nombre.length; break; }
      }
      expect(ini).toBeGreaterThan(0);
      for (let k = 40_000; k < 40_064; k++) roto[ini + k] = 0xff;
      const vistos = espiarFill();
      expect(codigo(() => leer(roto))).not.toBe('NO_LANZA');
      expect(conDatos(vistos, roto).length).toBeGreaterThan(0);
      for (const t of conDatos(vistos, roto)) expect(t.every((x) => x === 0)).toBe(true);
    });

    it('T-LE-03 B-13 camino feliz con varios trozos: se unen, el resultado sale íntegro y los trozos intermedios quedan en cero', () => {
      const largo = 300_000;
      const d = construirDocx({ cuerpo: pt(ruido(largo)) });
      const vistos = espiarFill();
      const doc = leer(d, { ...LIM, maxXmlPartBytes: 8 * 1024 * 1024, maxUncompressedTotal: 16 * 1024 * 1024 });
      expect(doc.parts[0]?.text.length).toBe(largo);
      const rastro = conDatos(vistos, d);
      expect(rastro.length).toBeGreaterThan(0);
      expect(rastro.some((t) => t.length > 0 && t.length < largo)).toBe(true); // al menos un trozo intermedio, no solo la parte entera
    });
  });

  it('ZIP64 malformado y directorio central dañado → ZIP_INVALIDO (nunca un bucle)', () => {
    const real = docMin();
    // Tamaño saturado (0xFFFFFFFF) sin campo extra ZIP64.
    expect(codigo(() => leer(parchearCentral(real, 'word/document.xml', 24, 0xffffffff)))).toBe('ZIP_INVALIDO');
    // Cuenta de entradas saturada sin localizador ZIP64.
    const e = real.slice();
    const dv = new DataView(e.buffer);
    let i = e.length - 22;
    while (dv.getUint32(i, true) !== 0x06054b50) i--;
    dv.setUint16(i + 10, 0xffff, true);
    expect(codigo(() => leer(e))).toBe('ZIP_INVALIDO');
    // Desplazamiento del directorio central fuera del archivo.
    const f = real.slice();
    new DataView(f.buffer).setUint32(i + 16, f.length + 10, true);
    expect(codigo(() => leer(f))).toBe('ZIP_INVALIDO');
    // Archivo cortado a la mitad (sin directorio central) y bytes al azar.
    expect(codigo(() => leer(real.subarray(0, Math.floor(real.length / 2))))).toBe('ZIP_INVALIDO');
    expect(codigo(() => leer(Uint8Array.from({ length: 500 }, (_, k) => (k * 37 + 11) & 0xff)))).toBe('ZIP_INVALIDO');
  });

  it('contenedor CFB (D0 CF 11 E0) → CONTENEDOR_CFB; un PDF → FORMATO_NO_ADMITIDO', () => {
    const cfb = new Uint8Array(2048);
    cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(codigo(() => leer(cfb))).toBe('CONTENEDOR_CFB');
    expect(codigo(() => leer(strToU8('%PDF-1.7\n...')))).toBe('FORMATO_NO_ADMITIDO');
  });

  it('entrada cifrada o con método de compresión desconocido → ZIP_INVALIDO; el CRC alterado → PARTE_TRUNCADA', () => {
    const real = docMin();
    const cambiar = (nombre: string, off: number, bytes: number[]): Uint8Array => {
      const d = real.slice();
      const n = strToU8(nombre);
      for (let i = 0; i + 46 <= d.length; i++) {
        if (d[i] === 0x50 && d[i + 1] === 0x4b && d[i + 2] === 1 && d[i + 3] === 2 && d[i + 28] === n.length && n.every((b, k) => d[i + 46 + k] === b)) {
          bytes.forEach((b, k) => { d[i + off + k] = b; });
          return d;
        }
      }
      throw new Error('no hallada');
    };
    expect(codigo(() => leer(cambiar('word/document.xml', 8, [1])))).toBe('ZIP_INVALIDO');
    expect(codigo(() => leer(cambiar('word/document.xml', 10, [99])))).toBe('ZIP_INVALIDO');
    expect(codigo(() => leer(cambiar('word/document.xml', 16, [1, 2, 3, 4])))).toBe('PARTE_TRUNCADA');
  });
});

describe('T-LE-04 .docx: XML hostil (V-20, V-41)', () => {
  const dtd = '<!DOCTYPE w:document [<!ENTITY a "Ejemplo">]>';
  const conDtd = (decl2: string): string => `${decl2}${dtd}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${pt('&a;')}</w:body></w:document>`;

  it('<!DOCTYPE en UTF-8, UTF-8 con BOM y UTF-16 (LE/BE, con y sin BOM) → DTD_NO_PERMITIDA', () => {
    const utf8 = conDtd('<?xml version="1.0" encoding="UTF-8"?>');
    expect(codigo(() => leer(construirDocx({ cuerpo: '', documentoXml: utf8 })))).toBe('DTD_NO_PERMITIDA');
    expect(codigo(() => leer(construirDocx({ cuerpo: '', documentoXml: Uint8Array.from([0xef, 0xbb, 0xbf, ...strToU8(utf8)]) })))).toBe('DTD_NO_PERMITIDA');
    const u16 = conDtd('<?xml version="1.0" encoding="UTF-16"?>');
    for (const [fin, bom] of [['le', true], ['be', true], ['le', false], ['be', false]] as const) {
      expect(codigo(() => leer(construirDocx({ cuerpo: '', documentoXml: utf16(u16, fin, bom) })))).toBe('DTD_NO_PERMITIDA');
    }
  });

  it('el DTD también se rechaza en encabezados, notas y relaciones, no solo en el cuerpo', () => {
    const malo = conDtd('<?xml version="1.0"?>');
    for (const tipo of ['header', 'footer', 'footnotes', 'endnotes', 'comments']) {
      const d = construirDocx({ cuerpo: pt('Cuerpo de prueba'), extras: [extra('x.xml', tipo, utf16(malo, 'le', true))] });
      expect(codigo(() => leer(d))).toBe('DTD_NO_PERMITIDA');
    }
  });

  it('«billion laughs» → DTD_NO_PERMITIDA sin expandir nada', () => {
    const lol = `${decl}<!DOCTYPE lolz [<!ENTITY a "ja"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${pt('&c;')}</w:body></w:document>`;
    expect(codigo(() => leer(construirDocx({ cuerpo: '', documentoXml: lol })))).toBe('DTD_NO_PERMITIDA');
  });

  it('declara UTF-16 en bytes ASCII, codificación desconocida y UTF-32 → XML_INVALIDO', () => {
    const base = documento(pt('Cuerpo de prueba'));
    expect(codigo(() => leer(construirDocx({ cuerpo: '', documentoXml: base.replace('UTF-8', 'UTF-16') })))).toBe('XML_INVALIDO');
    expect(codigo(() => leer(construirDocx({ cuerpo: '', documentoXml: base.replace('UTF-8', 'codificacion-inventada') })))).toBe('XML_INVALIDO');
    expect(codigo(() => leer(construirDocx({ cuerpo: '', documentoXml: Uint8Array.from([0xff, 0xfe, 0, 0, 0x3c, 0, 0, 0]) })))).toBe('XML_INVALIDO');
  });

  it('XML inválido con «Ana Ficticia Rojas» → XML_INVALIDO, sin una sola línea en la consola y con message igual al código', () => {
    const espias = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const casos = [
      documento(pt('Ana Ficticia Rojas')).replace('</w:body>', '</w:cuerpo>'),
      `${decl}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Ana Ficticia Rojas`,
      'Ana Ficticia Rojas no es XML',
      documento(pt('Ana Ficticia Rojas')).replace('Rojas', 'Rojas &inexistente;'),
      documento(pt('Ana Ficticia Rojas')).replace('<w:body>', '<w:body x="1" x="2">'),
    ];
    for (const xml of casos) {
      let capturado: unknown;
      try { leer(construirDocx({ cuerpo: '', documentoXml: xml })); } catch (e) { capturado = e; }
      expect(capturado).toBeInstanceOf(SiglowError);
      expect((capturado as SiglowError).code).toBe('XML_INVALIDO');
      expect((capturado as SiglowError).message).toBe('XML_INVALIDO');
      expect(JSON.stringify(capturado)).not.toContain('Ficticia');
    }
    for (const e of espias) expect(e).not.toHaveBeenCalled();
  });

  it('un elemento con miles de atributos se lee dentro de un tiempo razonable (el tope duro es terminate(), T-LE-09)', () => {
    let attrs = '';
    for (let i = 0; i < 5000; i++) attrs += ` a${i}="1"`;
    const xml = documento(pt('Cuerpo de prueba')).replace('<w:body>', `<w:body${attrs}>`);
    const t0 = performance.now();
    expect(textos(leer(construirDocx({ cuerpo: '', documentoXml: xml })))).toEqual(['Cuerpo de prueba']);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});

describe('T-LE-05 .docx: metadatos y autores no entran al modelo (INV-D03, INV-D04)', () => {
  const PROHIBIDOS = ['Autora Ejemplo', 'Autor Ficticio', 'Revisor Ficticio', 'ejemplo.test', 'Programa de Prueba'];
  function docConMetadatos(): Uint8Array {
    const core = `${decl}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Autora Ejemplo</dc:creator><cp:lastModifiedBy>Revisor Ficticio</cp:lastModifiedBy></cp:coreProperties>`;
    const app = `${decl}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Programa de Prueba</Application><Company>Empresa Ejemplo</Company></Properties>`;
    const people = `${decl}<w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:person w15:author="Autor Ficticio"/></w15:people>`;
    const cuerpo = p(r('Texto de prueba'), '<w:del w:id="1" w:author="Revisor Ficticio"><w:r><w:delText>oculto</w:delText></w:r></w:del>',
      '<w:ins w:id="2" w:author="Autor Ficticio" w:date="2020-01-01T00:00:00Z"><w:r><w:t> nuevo</w:t></w:r></w:ins>');
    return construirDocx({
      cuerpo,
      extras: [extra('comentarios.xml', 'comments', raiz('comments',
        `<w:comment w:id="0" w:author="Autor Ficticio" w:initials="AF">${pt('Comentario de prueba')}</w:comment>`))],
      entradas: { 'docProps/core.xml': core, 'docProps/app.xml': app, 'word/people.xml': people },
    });
  }

  it('INV-D03 · las etiquetas de documento y partes casan con ETIQUETA_NEUTRA y no llevan autor, iniciales ni nombre de parte', () => {
    const d = leer(docConMetadatos());
    expect(ETIQUETA_NEUTRA.test(d.label)).toBe(true);
    for (const x of d.parts) expect(ETIQUETA_NEUTRA.test(x.label)).toBe(true);
    expect(d.parts.map((x) => x.label)).toEqual(['Cuerpo del documento', 'Comentario 1']);
    for (const s of PROHIBIDOS) expect(JSON.stringify({ label: d.label, labels: d.parts.map((x) => x.label) })).not.toContain(s);
  });

  it('INV-D04 · metadata y warnings solo llevan categorías, códigos, claves fijas, ids y dígitos', () => {
    const d = leer(docConMetadatos());
    const json = JSON.stringify({ metadata: d.metadata, warnings: d.warnings });
    for (const s of PROHIBIDOS) expect(json).not.toContain(s);
    expect(Object.keys(d.metadata.categories).sort()).toEqual(['autores_revisiones', 'propiedades_aplicacion', 'propiedades_documento', 'personas', 'texto_eliminado'].sort());
    for (const w of d.warnings) expect(Object.keys(w).sort()).toEqual(['code', 'count', 'partId']);
    expect(d.parts.map((x) => x.text).join('\n')).not.toMatch(/Autora Ejemplo|Revisor Ficticio|oculto|Programa de Prueba/);
  });

  it('INV-D03 · los ids son aleatorios por omisión (no derivados del contenido): dos lecturas del mismo archivo difieren', () => {
    const b = docConMetadatos();
    const a1 = readDocx(b, { docId: DOC, label: 'Documento 1' }, LIM);
    const a2 = readDocx(b, { docId: DOC, label: 'Documento 1' }, LIM);
    expect(a1.parts[0]?.id).not.toBe(a2.parts[0]?.id);
    expect(a1.parts[0]?.id).toMatch(/^prt_[0-9a-f]{32}$/);
  });
});

describe('PE-3 · T-LE-02 parte II: texto oculto, contenido importado, marcas de agua, gráficos y notas', () => {
  const avisos = (d: DocumentModel): Array<{ code: string; count: number; con: boolean }> =>
    d.warnings.map((w) => ({ code: w.code, count: w.count, con: w.partId !== undefined }));

  it('w:vanish se incluye en el texto y se marca: TEXTO_OCULTO_INCLUIDO cuenta corridas, no fragmentos; val=0 y val=false no cuentan', () => {
    const cuerpo = p(r('Visible '), '<w:r><w:rPr><w:vanish/></w:rPr><w:t>oculto uno</w:t><w:t> oculto dos</w:t></w:r>',
      '<w:r><w:rPr><w:vanish w:val="0"/></w:rPr><w:t> visible dos</w:t></w:r>', '<w:r><w:rPr><w:vanish w:val="false"/></w:rPr><w:t> tres</w:t></w:r>');
    const extras = [extra('c.xml', 'header', hdr(p('<w:r><w:rPr><w:vanish/></w:rPr><w:t>Encabezado oculto de prueba</w:t></w:r>')))];
    const d = leer(construirDocx({ cuerpo, extras }));
    expect(textos(d)).toEqual(['Encabezado oculto de prueba', 'Visible oculto uno oculto dos visible dos tres']);
    expect(d.warnings).toEqual([
      { code: 'TEXTO_OCULTO_INCLUIDO', partId: d.parts[0]?.id, count: 1 },
      { code: 'TEXTO_OCULTO_INCLUIDO', partId: d.parts[1]?.id, count: 1 },
    ]);
  });

  it('w:altChunk → CONTENIDO_IMPORTADO_NO_LEIDO; el contenido importado no entra en el texto', () => {
    const d = leer(construirDocx({ cuerpo: pt('Antes') + '<w:altChunk r:id="rId5"/>' + pt('Después') + '<w:altChunk r:id="rId6"/>' }));
    expect(textos(d)).toEqual(['Antes\nDespués']);
    expect(d.warnings).toEqual([{ code: 'CONTENIDO_IMPORTADO_NO_LEIDO', partId: d.parts[0]?.id, count: 2 }]);
  });

  it('marca de agua VML (v:textpath) en un encabezado sin más texto → MARCA_DE_AGUA sin partId; el texto de la marca no se copia', () => {
    const marca = '<w:r><w:pict><v:shapetype id="_x0000_t136"/><v:shape id="PowerPlusWaterMarkObject1" type="#_x0000_t136"><v:textpath string="CONFIDENCIAL Ejemplo"/></v:shape></w:pict></w:r>';
    const d = leer(construirDocx({ cuerpo: pt('Cuerpo de prueba'), extras: [extra('m.xml', 'header', hdr(p(marca)))] }));
    expect(d.parts.map((x) => x.kind)).toEqual(['cuerpo']);
    expect(d.warnings).toEqual([{ code: 'MARCA_DE_AGUA', count: 1 }]);
    expect(JSON.stringify(d)).not.toContain('CONFIDENCIAL');
  });

  it('WordArt: Choice (a:prstTxWarp) + Fallback (v:textpath) cuenta una sola vez; textNoShape no es marca', () => {
    const ac = '<mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:wsp><wps:bodyPr><a:prstTxWarp prst="textPlain"/></wps:bodyPr></wps:wsp></w:drawing></mc:Choice>' +
      '<mc:Fallback><w:pict><v:shape><v:textpath string="X"/></v:shape></w:pict></mc:Fallback></mc:AlternateContent>';
    const normal = '<w:drawing><wps:wsp><wps:bodyPr><a:prstTxWarp prst="textNoShape"/></wps:bodyPr></wps:wsp></w:drawing>';
    const d = leer(construirDocx({ cuerpo: p(r('Texto de prueba'), `<w:r>${ac}</w:r>`, `<w:r>${normal}</w:r>`) }));
    expect(avisos(d)).toEqual([{ code: 'MARCA_DE_AGUA', count: 1, con: true }]);
  });

  it('gráficos y diagramas (graphicData chart/diagram) → SMARTART_O_GRAFICO_NO_LEIDO; una imagen no', () => {
    const g = (uri: string): string => `<w:r><w:drawing><wp:inline><a:graphic><a:graphicData uri="${uri}"/></a:graphic></wp:inline></w:drawing></w:r>`;
    const cuerpo = p(r('Texto de prueba'), g('http://schemas.openxmlformats.org/drawingml/2006/chart'), g('http://schemas.openxmlformats.org/drawingml/2006/diagram'),
      g('http://schemas.openxmlformats.org/drawingml/2006/picture'));
    expect(avisos(leer(construirDocx({ cuerpo })))).toEqual([{ code: 'SMARTART_O_GRAFICO_NO_LEIDO', count: 2, con: true }]);
  });

  it('comentario con varios párrafos y referencias; notas que solo tienen separadores no crean partes', () => {
    const comentario = '<w:comment w:id="0" w:author="Autor Ficticio" w:initials="AF"><w:p><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>' +
      '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r><w:r><w:t>Primera línea</w:t></w:r></w:p>' + pt('Segunda línea') + '</w:comment>';
    const sep = '<w:footnote w:type="separator" w:id="-1">' + pt('') + '</w:footnote><w:footnote w:type="continuationSeparator" w:id="0">' + pt('') + '</w:footnote>';
    const extras = [extra('c.xml', 'comments', raiz('comments', comentario)), extra('n.xml', 'footnotes', raiz('footnotes', sep))];
    const d = leer(construirDocx({ cuerpo: pt('Cuerpo de prueba'), extras }));
    expect(d.parts.map((x) => [x.kind, x.text])).toEqual([['cuerpo', 'Cuerpo de prueba'], ['comentario', 'Primera línea\nSegunda línea']]);
  });
});

describe('PE-3 · T-LE-02 parte II: OOXML Strict', () => {
  const WS = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
  const RS = 'http://purl.oclc.org/ooxml/officeDocument/relationships';
  function strict(cuerpo: string, cabecera?: string): Uint8Array {
    const rels = cabecera === undefined ? '' : `<Relationship Id="rId2" Type="${RS}/header" Target="cab.xml"/>`;
    const archivos: Record<string, Uint8Array> = {
      '_rels/.rels': strToU8(`${decl}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RS}/officeDocument" Target="word/document.xml"/></Relationships>`),
      'word/document.xml': strToU8(documento(cuerpo).replace(W, WS)),
      'word/_rels/document.xml.rels': strToU8(`${decl}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`),
    };
    if (cabecera !== undefined) archivos['word/cab.xml'] = strToU8(hdr(pt(cabecera)).replace(W, WS));
    return zipSync(archivos);
  }

  it('Strict se acepta y se lee igual que el normal, con el aviso OOXML_STRICT (una vez por parte Strict)', () => {
    const d = leer(strict(pt('Cuerpo estricto de prueba'), 'Encabezado estricto'));
    expect(textos(d)).toEqual(['Encabezado estricto', 'Cuerpo estricto de prueba']);
    expect(d.warnings).toEqual([{ code: 'OOXML_STRICT', count: 2 }]);
    expect(leer(construirDocx({ cuerpo: pt('Normal') })).warnings).toEqual([]);
  });

  it('un vocabulario Strict que no es WordprocessingML → OOXML_STRICT_NO_ADMITIDO', () => {
    const raro = zipSync({
      '_rels/.rels': strToU8(`${decl}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RS}/officeDocument" Target="word/document.xml"/></Relationships>`),
      'word/document.xml': strToU8(`${decl}<d:document xmlns:d="http://purl.oclc.org/ooxml/drawingml/main"/>`),
    });
    expect(codigo(() => leer(raro))).toBe('OOXML_STRICT_NO_ADMITIDO');
  });
});

describe('PE-3 · T-LE-05 parte II: inventario de metadatos solo de presencia (6.3.3, INV-D03, INV-D04)', () => {
  function docCompleto(): Uint8Array {
    const cuerpo =
      p(r('Texto de prueba'),
        '<w:del w:id="1" w:author="Revisor Ficticio" w:date="2020-01-01T00:00:00Z"><w:r><w:delText>borrado</w:delText></w:r></w:del>',
        '<w:ins w:id="2" w:author="Autor Ficticio"><w:r><w:t> insertado</w:t></w:r></w:ins>') +
      p('<w:r><w:instrText> HYPERLINK "x" </w:instrText></w:r>', r('campo')) +
      p('<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>') +
      p('<w:permStart w:id="9" w:ed="Autora Ejemplo"/>', r('permiso')) +
      '<w:sdt><w:sdtPr><w:alias w:val="Alias Prueba"/></w:sdtPr><w:sdtContent>' + pt('control') + '</w:sdtContent></w:sdt>' +
      p('<w:hyperlink r:id="rId99" w:tooltip="Vínculo Ejemplo"><w:r><w:t>enlace</w:t></w:r></w:hyperlink>') +
      p('<w:r><w:drawing><wp:inline><wp:docPr id="1" name="Imagen 1" descr="Foto de Autor Ficticio"/></wp:inline></w:drawing></w:r>');
    const tipo = (u: string): string => `http://schemas.openxmlformats.org/package/2006/relationships/metadata/${u}`;
    return construirDocx({
      cuerpo,
      extras: [
        extra('comentarios.xml', 'comments', raiz('comments', `<w:comment w:id="0" w:author="Autor Ficticio" w:initials="AF" w:date="2020-01-01T00:00:00Z">${pt('Comentario de prueba')}</w:comment>`)),
        extra('settings.xml', 'settings', raiz('settings', '')),
        extra('people.xml', 'people', `${decl}<w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:person w15:author="Autor Ficticio"/></w15:people>`),
        extra('media/image1.png', 'image', Uint8Array.from([0x89, 0x50, 0x4e, 0x47])),
      ],
      relacionesDocumento: `<Relationship Id="rId99" Type="${tipoRel('hyperlink')}" Target="https://ejemplo.test/x" TargetMode="External"/>`,
      relacionesPaquete: `<Relationship Id="rId7" Type="${tipo('core-properties')}" Target="docProps/core.xml"/>`,
      entradas: {
        'docProps/core.xml': `${decl}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Autora Ejemplo</dc:creator></cp:coreProperties>`,
        'docProps/app.xml': `${decl}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Company>Empresa Ejemplo</Company></Properties>`,
        'docProps/custom.xml': `${decl}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"/>`,
        'customXml/item1.xml': `${decl}<datos>Dato Ficticio</datos>`,
      },
    });
  }

  it('cuenta apariciones por categoría y recursos distintos; ningún valor aparece', () => {
    const d = leer(docCompleto());
    expect(d.metadata.categories).toEqual({
      propiedades_documento: { count: 1 }, propiedades_aplicacion: { count: 1 }, propiedades_personalizadas: { count: 1 },
      xml_personalizado: { count: 1 }, personas: { count: 1 }, configuracion: { count: 1 }, imagenes_y_miniatura: { count: 1 },
      autores_revisiones: { count: 3 }, texto_eliminado: { count: 1 }, codigos_campo: { count: 2 }, vinculos_externos: { count: 2 },
      permisos_edicion: { count: 1 }, texto_alternativo: { count: 1 }, propiedades_controles: { count: 1 },
    });
    expect(textos(d).join('\n')).not.toMatch(/borrado|HYPERLINK|Alias Prueba|Foto de/);
  });

  it('INV-D04 · metadata y warnings solo tienen claves fijas, códigos, ids y dígitos; ningún valor del archivo', () => {
    const d = leer(docCompleto());
    const json = JSON.stringify(d.metadata);
    expect(json).toMatch(/^[a-z0-9_{}":,]+$/);
    for (const s of ['Autora Ejemplo', 'Autor Ficticio', 'Revisor Ficticio', 'Empresa Ejemplo', 'Dato Ficticio', 'ejemplo.test', 'Vínculo']) {
      expect(JSON.stringify({ m: d.metadata, w: d.warnings, l: d.parts.map((x) => x.label) })).not.toContain(s);
    }
    for (const w of d.warnings) expect(Object.keys(w).every((k) => ['code', 'count', 'partId'].includes(k))).toBe(true);
  });

  it('las partes se localizan por tipo de relación aunque el nombre sea libre; sin ellas, por la ruta habitual y [Content_Types].xml', () => {
    const libre = construirDocx({
      cuerpo: pt('Cuerpo de prueba'),
      extras: [extra('raro/configuracion-x.xml', 'settings', raiz('settings', '')), extra('raro/glosario.xml', 'glossaryDocument', raiz('glossaryDocument', ''))],
    });
    expect(leer(libre).metadata.categories).toEqual({ configuracion: { count: 1 }, glosario: { count: 1 } });
    const porTipo = construirDocx({
      cuerpo: pt('Cuerpo de prueba'),
      entradas: {
        'docProps/otra.xml': `${decl}<Properties/>`,
        'word/vbaProject.bin': Uint8Array.from([1, 2, 3]),
        '[Content_Types].xml': `${decl}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/docProps/otra.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      },
    });
    expect(leer(porTipo).metadata.categories).toEqual({ propiedades_documento: { count: 1 }, objetos_y_macros: { count: 1 } });
  });

  it('un archivo sin metadatos tiene el inventario vacío; un [Content_Types].xml hostil no impide leer ni se interpreta', () => {
    expect(leer(construirDocx({ cuerpo: pt('Cuerpo de prueba') })).metadata).toEqual({ categories: {} });
    const hostil = construirDocx({ cuerpo: pt('Cuerpo de prueba'), entradas: { '[Content_Types].xml': `${decl}<!DOCTYPE t [<!ENTITY a "b">]><Types/>` } });
    expect(textos(leer(hostil))).toEqual(['Cuerpo de prueba']);
  });

  it('vínculos externos de un encabezado y metadatos de partes secundarias también se cuentan', () => {
    const d = construirDocx({
      cuerpo: pt('Cuerpo de prueba'),
      extras: [extra('cab.xml', 'header', hdr(pt('Encabezado de prueba')))],
      entradas: {
        'word/_rels/cab.xml.rels': `${decl}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${tipoRel('hyperlink')}" Target="https://ejemplo.test/z" TargetMode="External"/><Relationship Id="rId2" Type="${tipoRel('image')}" Target="media/logo.png"/></Relationships>`,
      },
    });
    expect(leer(d).metadata.categories).toEqual({ vinculos_externos: { count: 1 }, imagenes_y_miniatura: { count: 1 } });
  });
});

describe('Worker io con .docx (INV-W01, INV-W02, T-PV-04)', () => {
  const REQ = 'req_' + 'ab'.repeat(16);
  function manejar(bytes: ArrayBuffer, limits: IoLimits = LIM): Array<Record<string, unknown>> {
    const salida: Array<Record<string, unknown>> = [];
    handleIoMessage({ v: 1, reqId: REQ, kind: 'leer', payload: { format: 'docx', bytes, docId: DOC, label: 'Documento 1', limits } },
      (m) => salida.push(m as Record<string, unknown>));
    return salida;
  }
  afterEach(() => { vi.restoreAllMocks(); });

  it('lee un .docx por el lector registrado, avisa el progreso y pone en cero el buffer recibido', () => {
    const b = construirDocx({ cuerpo: pt('Cuerpo de prueba') }).slice().buffer;
    const sal = manejar(b);
    expect(sal.at(-1)).toMatchObject({ v: 1, reqId: REQ, kind: 'resultado', payload: { kind: 'leer', doc: { source: 'docx' } } });
    expect(sal.some((m) => m['kind'] === 'progreso')).toBe(true);
    expect(new Uint8Array(b).every((x) => x === 0)).toBe(true);
  });

  it('INV-W01 · un fallo de lectura responde solo con v, reqId, kind, code y retryable; el buffer también queda en cero', () => {
    const malo = strToU8(documento(pt('Ana Ficticia Rojas')).replace('</w:body>', '</w:cuerpo>'));
    const b = construirDocx({ cuerpo: '', documentoXml: malo }).slice().buffer;
    const sal = manejar(b);
    const ultimo = sal.at(-1) ?? {};
    expect(Object.keys(ultimo).sort()).toEqual(['code', 'kind', 'reqId', 'retryable', 'v']);
    expect(ultimo).toMatchObject({ kind: 'error', code: 'XML_INVALIDO', retryable: false });
    expect(JSON.stringify(sal)).not.toContain('Ficticia');
    expect(new Uint8Array(b).every((x) => x === 0)).toBe(true);
  });

  it('INV-W02 · XML inválido con «Ana Ficticia Rojas»: 0 apariciones en la consola', () => {
    const espias = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const malo = strToU8(documento(pt('Ana Ficticia Rojas')).replace('Rojas', 'Rojas &x;'));
    manejar(construirDocx({ cuerpo: '', documentoXml: malo }).slice().buffer);
    for (const e of espias) expect(e).not.toHaveBeenCalled();
  });

  it('CFB, DTD y bomba llegan como ErrorCode y nunca como excepción', () => {
    const cfb = new Uint8Array(1024);
    cfb.set([0xd0, 0xcf, 0x11, 0xe0]);
    expect(manejar(cfb.buffer).at(-1)).toMatchObject({ kind: 'error', code: 'CONTENEDOR_CFB' });
    const dtdXml = `${decl}<!DOCTYPE x [<!ENTITY a "b">]><w:document xmlns:w="urn:x"/>`;
    expect(manejar(construirDocx({ cuerpo: '', documentoXml: dtdXml }).slice().buffer).at(-1)).toMatchObject({ code: 'DTD_NO_PERMITIDA' });
    expect(manejar(construirDocx({ cuerpo: pt(' '.repeat(2000)) }).slice().buffer, { ...LIM, maxXmlPartBytes: 1000 }).at(-1))
      .toMatchObject({ code: 'PARTE_XML_EXCEDE_LIMITE' });
  });
});

