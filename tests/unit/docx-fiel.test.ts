// F4 · T-FI-01 a T-FI-08 · .docx fiel (D-22): mismo archivo, solo cambian los datos. Solo datos ficticios evidentes.
// Fallan con el código anterior: `docx-write-fiel.ts` no existía y la única salida era el .docx mínimo sin formato.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { SiglowError } from '../../src/core/types';
import type { DocId, DocumentModel, ErrorCode, IdSource, Part } from '../../src/core/types';
import { leerDocxMapeado, readDocx } from '../../src/io/docx-read';
import { construirDocxFiel } from '../../src/io/docx-write-fiel';
import { IO_LIMITS_POR_DEFECTO } from '../../src/io/io-client';
import { salida, reemplazarTodo } from '../fixtures/salida';
import type { Reemplazo } from '../fixtures/salida';
import { construirDocx, decl, documento, esc, p, pt, r, raiz, tipoRel } from '../fixtures/docx/docx-builder';

const DOC = 'doc_00112233445566778899aabbccddeeff' as DocId;
function ids(): IdSource {
  let n = 0;
  return { next: (pre: string) => `${pre}_${(n++).toString(16).padStart(32, '0')}` };
}
const leer = (b: Uint8Array): DocumentModel => readDocx(b, { docId: DOC, label: 'Documento 1', ids: ids() }, IO_LIMITS_POR_DEFECTO);
function codigo(f: () => unknown): ErrorCode | 'NO_LANZA' {
  try { f(); return 'NO_LANZA'; } catch (e) { return e instanceof SiglowError ? e.code : 'ERROR_INTERNO'; }
}

/** Todas las entradas del ZIP, las XML como texto en minúsculas. */
function entradas(b: Uint8Array): Map<string, Uint8Array> {
  return new Map(Object.entries(unzipSync(b)));
}
function xmlEnMinusculas(b: Uint8Array): Array<[string, string]> {
  const dec = new TextDecoder();
  return [...entradas(b)].filter(([k]) => /\.(xml|rels)$/u.test(k)).map(([k, v]) => [k, dec.decode(v).toLowerCase()]);
}
const sinContenidoDeT = (x: string): string => x.replace(/(<w:t(?:\s[^>]*)?>)[^<]*(<\/w:t>)/gu, '$1$2');

// ---------------------------------------------------------------------------------------------------------------------
// Fixture: formato, tabla, encabezado, pie con PAGE, nota, comentario, revisiones, campo HYPERLINK, cuadro con Fallback,
// control de contenido, imagen con texto alternativo y metadatos.
// ---------------------------------------------------------------------------------------------------------------------
const NOMBRE = 'Ana Ficticia Rojas';
const VALORES: Record<string, string> = {
  [NOMBRE]: '[DEMANDANTE_1]', '1.020.304.050': '[CC_1]', 'Calle Falsa 123': '[DIRECCION_1]', 'ana.ficticia@ejemplo.test': '[CORREO_1]',
};
const SECRETOS = [
  'ana ficticia rojas', '1.020.304.050', 'calle falsa 123', 'ana.ficticia@ejemplo.test', 'revisor secreto', 'comentarista secreto',
  'autora secreta', 'empresa secreta', 'pedro borrado', 'cedula_ana', 'foto de ana', 'plantilla_de_ana', 'variable secreta',
];
const negrita = (t: string): string => `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
const campo = (instr: string, resultado: string): string =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${esc(instr)}</w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${r(resultado)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const dibujo = `<w:r><w:drawing><wp:inline><wp:docPr id="1" name="cedula_ana_ficticia.png" descr="Foto de Ana Ficticia Rojas" title="Foto de Ana"/>` +
  `<a:graphic><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="0" name="cedula_ana_ficticia.png" descr="Foto de Ana Ficticia Rojas"/><pic:cNvPicPr/></pic:nvPicPr>` +
  `<pic:blipFill><a:blip r:embed="rId20"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
const grafico = `<w:r><w:drawing><wp:inline><wp:docPr id="2" name="Gráfico"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId21"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

function fixtureCompleto(): Uint8Array {
  const cuerpo = [
    p(r('La señora '), negrita('Ana Ficticia'), r(' Rojas, con C.C. 1.020.304.050, vive en la Calle Falsa 123.')),
    p(r('Contrato '), `<w:ins w:id="1" w:author="Revisor Secreto" w:date="2026-01-01T00:00:00Z">${r(`firmado por ${NOMBRE}`)}</w:ins>`,
      `<w:del w:id="2" w:author="Revisor Secreto" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>Pedro Borrado Ficticio</w:delText></w:r></w:del>`),
    p('<w:commentRangeStart w:id="0"/>', r('Correo: '), campo(' HYPERLINK "mailto:ana.ficticia@ejemplo.test" ', 'ana.ficticia@ejemplo.test'),
      '<w:commentRangeEnd w:id="0"/>', '<w:r><w:commentReference w:id="0"/></w:r>'),
    `<w:tbl><w:tr><w:tc>${pt('Demandante')}</w:tc><w:tc>${pt(NOMBRE)}</w:tc></w:tr></w:tbl>`,
    p(dibujo, grafico),
    p(`<mc:AlternateContent><mc:Choice Requires="wps"><w:r><w:drawing><wps:txbx><w:txbxContent>${pt(`Cuadro: ${NOMBRE}`)}</w:txbxContent></wps:txbx></w:drawing></w:r></mc:Choice>` +
      `<mc:Fallback><w:r><w:pict><v:shape alt="Cuadro de Ana Ficticia Rojas"><v:textbox><w:txbxContent>${pt(`Cuadro: ${NOMBRE}`)}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></mc:Fallback></mc:AlternateContent>`),
    `<w:sdt><w:sdtPr><w:alias w:val="Nombre de Ana Ficticia Rojas"/><w:tag w:val="${NOMBRE}"/></w:sdtPr><w:sdtContent>${pt(NOMBRE)}</w:sdtContent></w:sdt>`,
    p(r('Vínculo: '), `<w:hyperlink r:id="rId22" w:tooltip="Perfil de Ana Ficticia Rojas">${r('perfil')}</w:hyperlink>`),
  ].join('');
  const docXml = documento(cuerpo);
  const notas = raiz('footnotes', '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
    `<w:footnote w:id="1">${pt(`Nota sobre ${NOMBRE}.`)}</w:footnote>`);
  const comentarios = raiz('comments', `<w:comment w:id="0" w:author="Comentarista Secreto" w:initials="CS">${pt(`Revisar a ${NOMBRE}`)}</w:comment>`);
  const ajustes = raiz('settings', '<w:zoom w:percent="100"/><w:attachedTemplate r:id="rId1"/><w:docVars><w:docVar w:name="cliente" w:val="Variable Secreta"/></w:docVars>');
  const ajustesRels = `${decl}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${tipoRel('attachedTemplate')}" Target="file:///C:/Usuarios/plantilla_de_ana.dotx" TargetMode="External"/></Relationships>`;
  return construirDocx({
    cuerpo: '',
    documentoXml: docXml,
    extras: [
      { nombre: 'header1.xml', tipo: 'header', xml: raiz('hdr', pt(`Proceso de ${NOMBRE}`)) },
      { nombre: 'footer1.xml', tipo: 'footer', xml: raiz('ftr', p(r('Página '), campo(' PAGE ', '1'))) },
      { nombre: 'footnotes.xml', tipo: 'footnotes', xml: notas },
      { nombre: 'comments.xml', tipo: 'comments', xml: comentarios },
      { nombre: 'settings.xml', tipo: 'settings', xml: ajustes },
      { nombre: 'styles.xml', tipo: 'styles', xml: raiz('styles', '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>') },
      { nombre: 'people.xml', tipo: 'people', xml: `${decl}<w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:person w15:author="Comentarista Secreto"/></w15:people>` },
    ],
    relacionesDocumento:
      `<Relationship Id="rId20" Type="${tipoRel('image')}" Target="media/image1.png"/>` +
      `<Relationship Id="rId21" Type="${tipoRel('chart')}" Target="charts/chart1.xml"/>` +
      `<Relationship Id="rId22" Type="${tipoRel('hyperlink')}" Target="https://ejemplo.test/ana.ficticia" TargetMode="External"/>`,
    relacionesPaquete:
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      `<Relationship Id="rId3" Type="${tipoRel('extended-properties')}" Target="docProps/app.xml"/>` +
      `<Relationship Id="rId4" Type="${tipoRel('customXml')}" Target="customXml/item1.xml"/>`,
    entradas: {
      'word/media/image1.png': PNG,
      'word/charts/chart1.xml': `${decl}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:title>Ventas de Ana Ficticia Rojas</c:title></c:chartSpace>`,
      'word/_rels/settings.xml.rels': ajustesRels,
      'docProps/core.xml': `${decl}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Autora Secreta</dc:creator></cp:coreProperties>`,
      'docProps/app.xml': `${decl}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Company>Empresa Secreta</Company></Properties>`,
      'customXml/item1.xml': `${decl}<cliente><nombre>${NOMBRE}</nombre></cliente>`,
      // Un encabezado sin relación: Word no lo usa, pero está en el ZIP con datos.
      'word/header9.xml': raiz('hdr', pt(`Huérfano de ${NOMBRE}`)),
    },
  });
}

describe('T-FI-01 a T-FI-05 · .docx fiel sobre un documento con formato, revisiones, comentarios y metadatos', () => {
  const original = fixtureCompleto();
  const copiaOriginal = original.slice();
  const doc = leer(original);
  const out = reemplazarTodo(doc, VALORES);
  const { bytes, imagenes } = construirDocxFiel(original, doc, out);
  const zipSalida = entradas(bytes);

  it('T-FI-01 no modifica el original que recibe', () => {
    expect(original).toEqual(copiaOriginal);
  });

  it('T-FI-02 ningún valor original, autor ni metadato aparece en ningún archivo del .docx de salida', () => {
    for (const [k, x] of xmlEnMinusculas(bytes)) for (const s of SECRETOS) expect(x.includes(s), `${s} en ${k}`).toBe(false);
    const nombres = [...zipSalida.keys()];
    for (const n of nombres) expect(n, n).not.toMatch(/docprops|customxml|comments|people|chart|header9|settings\.xml\.rels/iu);
    expect(nombres).toContain('word/document.xml');
    expect(nombres).toContain('word/media/image1.png');
    expect(imagenes).toBe(1);
  });

  it('T-FI-03 se vuelve a leer con docx-read y da el texto anonimizado, parte por parte', () => {
    const leido = leer(bytes);
    const esperado = out.sections.filter((s) => s.kind !== 'comentario').map((s) => [s.kind, s.text]);
    expect(leido.parts.map((x) => [x.kind, x.text])).toEqual(esperado);
    const cuerpo = leido.parts[1]?.text ?? '';
    expect(cuerpo).toContain('La señora [DEMANDANTE_1], con C.C. [CC_1], vive en la [DIRECCION_1].');
    expect(cuerpo).toContain('Contrato firmado por [DEMANDANTE_1]');
    expect(cuerpo).not.toContain('Pedro');
  });

  it('T-FI-04 un reemplazo que cruza corridas va en la primera (con su formato) y vacía las demás', () => {
    const xml = new TextDecoder().decode(zipSalida.get('word/document.xml'));
    expect(xml).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">[DEMANDANTE_1]</w:t></w:r>');
    expect(xml).toContain('<w:t xml:space="preserve">, con C.C. [CC_1], vive en la [DIRECCION_1].</w:t>');
  });

  it('T-FI-05 control de cambios aceptado, comentarios, campos no seguros, Fallback y metadatos de imagen fuera; PAGE y la imagen se conservan', () => {
    const xml = new TextDecoder().decode(zipSalida.get('word/document.xml'));
    for (const fuera of ['w:ins ', 'w:del ', 'w:delText', 'w:author', 'commentRangeStart', 'commentReference', 'HYPERLINK', 'w:alias', 'w:tag', 'w:tooltip', 'descr=', 'title=', 'c:chart', 'r:id="rId22"']) {
      expect(xml.includes(fuera), fuera).toBe(false);
    }
    expect(xml).toContain('<mc:Fallback><w:r><w:pict><v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t xml:space="preserve"></w:t></w:r></w:p>');
    expect(xml).toContain('r:embed="rId20"');
    expect(zipSalida.get('word/media/image1.png')).toEqual(PNG);
    const pie = new TextDecoder().decode(zipSalida.get('word/footer1.xml'));
    expect(pie).toContain('> PAGE </w:instrText>');
    const ajustes = new TextDecoder().decode(zipSalida.get('word/settings.xml'));
    expect(ajustes).toContain('<w:zoom w:percent="100"/>');
    expect(ajustes).not.toMatch(/attachedTemplate|docVars/u);
    const ct = new TextDecoder().decode(zipSalida.get('[Content_Types].xml'));
    expect(ct).toContain('/word/document.xml');
    const rels = new TextDecoder().decode(zipSalida.get('_rels/.rels'));
    expect(rels).toContain('officeDocument');
    expect(rels).not.toMatch(/core-properties|extended-properties|customXml/u);
  });
});

describe('T-FI-06 · fuera de los w:t tocados, el XML queda igual', () => {
  it('T-FI-06 documento con formato, tabla y encabezado: mismo XML salvo el contenido de los w:t; estilos byte a byte', () => {
    const estilos = raiz('styles', '<w:style w:type="paragraph" w:styleId="Titulo1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>');
    const cuerpo = [
      `<w:p><w:pPr><w:pStyle w:val="Titulo1"/><w:jc w:val="center"/></w:pPr>${r('ACCIÓN DE TUTELA')}</w:p>`,
      p(r('Yo, '), negrita(NOMBRE), r(', identificada con C.C. 1.020.304.050, presento esta acción.')),
      `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tr><w:tc>${pt('Nombre')}</w:tc><w:tc>${pt(NOMBRE)}</w:tc></w:tr></w:tbl>`,
      pt('Sin datos en este párrafo.'),
    ].join('');
    const original = construirDocx({
      cuerpo,
      extras: [
        { nombre: 'header1.xml', tipo: 'header', xml: raiz('hdr', pt('Juzgado Ficticio')) },
        { nombre: 'styles.xml', tipo: 'styles', xml: estilos },
      ],
    });
    const doc = leer(original);
    const { bytes } = construirDocxFiel(original, doc, reemplazarTodo(doc, VALORES));
    const a = entradas(original);
    const b = entradas(bytes);
    const dec = new TextDecoder();
    const docA = dec.decode(a.get('word/document.xml'));
    const docB = dec.decode(b.get('word/document.xml'));
    expect(docB).not.toBe(docA);
    expect(sinContenidoDeT(docB)).toBe(sinContenidoDeT(docA));
    // Partes sin cambios: mismos bytes.
    expect(b.get('word/header1.xml')).toEqual(a.get('word/header1.xml'));
    expect(b.get('word/styles.xml')).toEqual(a.get('word/styles.xml'));
    expect(dec.decode(b.get('word/_rels/document.xml.rels'))).toBe(dec.decode(a.get('word/_rels/document.xml.rels')));
    expect(leer(bytes).parts.map((x) => x.text)).toEqual([
      'Juzgado Ficticio', 'ACCIÓN DE TUTELA\nYo, [DEMANDANTE_1], identificada con C.C. [CC_1], presento esta acción.\nNombre\n[DEMANDANTE_1]\nSin datos en este párrafo.',
    ]);
  });
});

describe('T-FI-07 · partes excluidas, coherencia y errores', () => {
  it('T-FI-07 una parte excluida sale vacía; un original que no corresponde, o una fuente que no es .docx, se rechaza', () => {
    const original = construirDocx({ cuerpo: pt(`Demanda de ${NOMBRE}.`), extras: [{ nombre: 'header1.xml', tipo: 'header', xml: raiz('hdr', pt(`Membrete de ${NOMBRE}`)) }] });
    const doc = leer(original);
    const sinEncabezado: DocumentModel = { ...doc, parts: doc.parts.map((x) => (x.kind === 'encabezado' ? { ...x, included: false } : x)) };
    const { bytes } = construirDocxFiel(original, sinEncabezado, reemplazarTodo(sinEncabezado, VALORES));
    for (const [, x] of xmlEnMinusculas(bytes)) expect(x).not.toContain('ana ficticia');
    expect(leer(bytes).parts.map((x) => x.text)).toEqual(['Demanda de [DEMANDANTE_1].']);

    const otro = construirDocx({ cuerpo: pt('Otro documento distinto.') });
    expect(codigo(() => construirDocxFiel(otro, doc, reemplazarTodo(doc, VALORES)))).toBe('ERROR_INTERNO');
    expect(codigo(() => construirDocxFiel(original, { ...doc, source: 'txt' }, reemplazarTodo(doc, VALORES)))).toBe('FORMATO_NO_ADMITIDO');
  });

  it('T-FI-07 el mapa de desplazamientos cubre cada carácter de texto de cada w:t, en orden', () => {
    const original = fixtureCompleto();
    const m = leerDocxMapeado(original, { docId: DOC, label: 'Documento 1', ids: ids() }, IO_LIMITS_POR_DEFECTO);
    for (const parte of m.partes) {
      expect(parte.piezas).not.toBeNull();
      let ultimo = 0;
      for (const x of parte.piezas ?? []) {
        expect(x.ini).toBeGreaterThanOrEqual(ultimo);
        expect(parte.texto.slice(x.ini, x.fin)).toBe(x.texto);
        ultimo = x.fin;
      }
    }
    // Con texto en NFD (tilde combinada) el mapa se arma pieza a pieza y el texto se escribe en NFC.
    const nfd = construirDocx({ cuerpo: p(r('Jose\u0301 '), r('Pe\u0301rez Ficticio')) });
    const dn = leer(nfd);
    expect(dn.parts[0]?.text).toBe('José Pérez Ficticio');
    const { bytes } = construirDocxFiel(nfd, dn, reemplazarTodo(dn, { 'José Pérez Ficticio': '[PERSONA_1]' }));
    expect(leer(bytes).parts[0]?.text).toBe('[PERSONA_1]');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// T-FI-08 · Corpus: los .docx de corpus/docs con las anotaciones de su gold
// ---------------------------------------------------------------------------------------------------------------------
interface AnotacionGold { parte: { kind: string; index: number }; start: number; end: number; texto: string; tipo: string; es_negativo_esperado: boolean }
const CORPUS = join(process.cwd(), 'corpus');
const DOCX = existsSync(join(CORPUS, 'docs')) ? readdirSync(join(CORPUS, 'docs')).filter((f) => /^C\d\d\.docx$/u.test(f)).sort() : [];
const AUTORES_CORPUS = ['autora ejemplo', 'revisor ficticio', 'autor ficticio', 'despacho ficticio s.a.s.', 'editor ficticio'];

describe('T-FI-08 · corpus .docx con su gold', () => {
  it.each(DOCX)('T-FI-08 %s: sin valores anotados ni autores en ningún XML; se relee con el texto anonimizado', (archivo) => {
    const original = new Uint8Array(readFileSync(join(CORPUS, 'docs', archivo)));
    const gold = JSON.parse(readFileSync(join(CORPUS, 'gold', archivo.replace('.docx', '.json')), 'utf8')) as { anotaciones: AnotacionGold[] };
    const doc = leer(original);
    const m = new Map<Part, Reemplazo[]>();
    const anotadas = gold.anotaciones.filter((a) => !a.es_negativo_esperado);
    for (const a of anotadas) {
      // Un dato anotado donde el lector no lee (C07: el nombre en la marca de agua del encabezado, brecha conocida) no se reemplaza,
      // pero igual debe desaparecer de la salida: el escritor vacía el texto que no se leyó.
      const parte = doc.parts.find((x) => x.kind === a.parte.kind && x.index === a.parte.index);
      if (parte === undefined) continue;
      expect(parte.text.slice(a.start, a.end)).toBe(a.texto);
      const l = m.get(parte) ?? [];
      l.push({ ini: a.start, fin: a.end, nuevo: `[${a.tipo}_1]` });
      m.set(parte, l);
    }
    const out = salida(doc, m);
    const { bytes } = construirDocxFiel(original, doc, out);
    const visible = out.sections.map((s) => s.text).join('\n').toLowerCase();
    const xmls = xmlEnMinusculas(bytes);
    for (const a of anotadas) {
      const v = a.texto.toLowerCase();
      if (v.length < 4 || visible.includes(v)) continue;
      for (const [k, x] of xmls) {
        const donde = /\p{L}/u.test(v) ? x : x.replace(/<[^>]*>/gu, ' ');
        expect(donde.includes(v), `${archivo}: «${a.tipo}» en ${k}`).toBe(false);
      }
    }
    for (const [k, x] of xmls) for (const s of AUTORES_CORPUS) expect(x.includes(s), `${archivo}: ${s} en ${k}`).toBe(false);
    for (const n of entradas(bytes).keys()) expect(n).not.toMatch(/docprops|customxml|comments|people/iu);
    const leido = leer(bytes);
    const norm = (s: string): string => s.replace(/[\t\n\u2011]/gu, '');
    expect(leido.parts.map((x) => norm(x.text))).toEqual(out.sections.filter((s) => s.kind !== 'comentario').map((s) => norm(s.text)).filter((t) => t.trim() !== ''));
  });
  it('T-FI-08 hay .docx en el corpus', () => { expect(DOCX.length).toBeGreaterThanOrEqual(5); });
});
