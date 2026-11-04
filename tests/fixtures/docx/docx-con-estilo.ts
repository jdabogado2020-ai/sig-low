// F7 · .docx ficticio con formato para el PDF con estilo: página oficio con márgenes propios, título centrado, párrafo justificado
// con negrita, cursiva y subrayado, sangrías, numeración y viñetas, tabla con bordes, encabezado, pie con «Página X de Y», nota al
// pie, salto de página, una imagen (que el PDF omite) y fuentes serif, sans y monoespaciada. Solo datos ficticios evidentes.
import { construirDocx, esc, raiz, tipoRel } from './docx-builder';

export const NOMBRE_ESTILO = 'Pedro Ejemplo Gómez';
/** Oficio (8,5 × 13 in) con márgenes izquierdo 85,05 pt y derecho 56,7 pt. */
export const PAGINA = { ancho: 612, alto: 936, izq: 1701 / 20, der: 1134 / 20, sup: 1417 / 20, inf: 1417 / 20, encabezado: 709 / 20, pie: 709 / 20 };

const t = (s: string): string => `<w:t xml:space="preserve">${esc(s)}</w:t>`;
const run = (s: string, rPr = ''): string => `<w:r>${rPr === '' ? '' : `<w:rPr>${rPr}</w:rPr>`}${t(s)}</w:r>`;
const par = (pPr: string, ...runs: string[]): string => `<w:p>${pPr === '' ? '' : `<w:pPr>${pPr}</w:pPr>`}${runs.join('')}</w:p>`;
const campo = (instr: string, resultado: string): string =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${instr}</w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run(resultado)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

export const JUSTIFICADO =
  `El señor ${NOMBRE_ESTILO}, mayor de edad y vecino del municipio ficticio de Villa Prueba, presenta esta acción de tutela ` +
  'contra la entidad promotora de salud ficticia porque le negó un tratamiento ordenado por su médico tratante, con lo cual se ' +
  'vulneran sus derechos fundamentales a la salud, a la vida digna y a la seguridad social, según los hechos que siguen.';

export function docxConEstilo(): Uint8Array {
  const estilos = raiz('styles',
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:rPr><w:sz w:val="20"/></w:rPr></w:style>');
  const numeracion = raiz('numbering',
    '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
    '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val=""/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr></w:lvl></w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>');
  const ajustes = raiz('settings', '<w:defaultTabStop w:val="708"/>');
  const encabezado = raiz('hdr', par('<w:jc w:val="center"/>', run(`Juzgado Ficticio de Villa Prueba · Proceso de ${NOMBRE_ESTILO}`, '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/>')));
  const pie = raiz('ftr', par('<w:jc w:val="center"/>', run('Página '), campo(' PAGE ', '1'), run(' de '), campo(' NUMPAGES ', '1')));
  const notas = raiz('footnotes', '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
    `<w:footnote w:id="1">${par('<w:pStyle w:val="FootnoteText"/>', run(`Historia clínica de ${NOMBRE_ESTILO}, folio 3.`))}</w:footnote>`);
  const imagen = `<w:r><w:drawing><wp:inline><wp:docPr id="1" name="Imagen 1"/><a:graphic><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="0" name="sello"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId30"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  const cuerpo = [
    par('<w:pStyle w:val="Heading1"/>', run('ACCIÓN DE TUTELA')),
    par('<w:jc w:val="both"/>', run(JUSTIFICADO.slice(0, 9)), run(JUSTIFICADO.slice(9, 9 + NOMBRE_ESTILO.length), '<w:b/>'),
      run(JUSTIFICADO.slice(9 + NOMBRE_ESTILO.length, 120)), run(JUSTIFICADO.slice(120, 160), '<w:i/>'), run(JUSTIFICADO.slice(160, 200), '<w:u w:val="single"/>'),
      run(JUSTIFICADO.slice(200)), `<w:r><w:footnoteReference w:id="1"/></w:r>`),
    par('<w:ind w:left="720" w:firstLine="360"/>', run('Párrafo con sangría izquierda de media pulgada y sangría de primera línea, para comprobar las sangrías.')),
    par('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:jc w:val="both"/>', run('Primer hecho numerado del caso ficticio.')),
    par('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>', run('Segundo hecho numerado del caso ficticio.')),
    par('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>', run('Viñeta de una prueba documental.')),
    `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="5000"/></w:tblGrid>` +
      `<w:tr><w:tc>${par('', run('Demandante', '<w:b/>'))}</w:tc><w:tc>${par('', run(NOMBRE_ESTILO))}</w:tc></w:tr>` +
      `<w:tr><w:tc>${par('', run('Despacho', '<w:b/>'))}</w:tc><w:tc>${par('', run('Juzgado Ficticio'))}</w:tc></w:tr></w:tbl>`,
    par('<w:jc w:val="right"/>', run('Villa Prueba, 3 de noviembre de 2026')),
    par('', run('Texto en Arial ', '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>'), run('y código en Courier.', '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>'), imagen),
    par('', '<w:r><w:br w:type="page"/></w:r>', run('Segunda página del escrito ficticio.')),
  ].join('');
  const sect = '<w:sectPr><w:headerReference w:type="default" r:id="rId10"/><w:footerReference w:type="default" r:id="rId11"/>' +
    '<w:pgSz w:w="12240" w:h="18720"/><w:pgMar w:top="1417" w:right="1134" w:bottom="1417" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>';
  return construirDocx({
    cuerpo: '',
    documentoXml: raiz('document', `<w:body>${cuerpo}${sect}</w:body>`),
    extras: [
      { nombre: 'header1.xml', tipo: 'header', xml: encabezado },
      { nombre: 'footer1.xml', tipo: 'footer', xml: pie },
      { nombre: 'styles.xml', tipo: 'styles', xml: estilos },
      { nombre: 'numbering.xml', tipo: 'numbering', xml: numeracion },
      { nombre: 'settings.xml', tipo: 'settings', xml: ajustes },
      { nombre: 'footnotes.xml', tipo: 'footnotes', xml: notas },
    ],
    relacionesDocumento: `<Relationship Id="rId30" Type="${tipoRel('image')}" Target="media/sello.png"/>`,
    entradas: { 'word/media/sello.png': Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]) },
  });
}

