// F4 · .docx fiel (D-22): el mismo archivo que se cargó, con el mismo formato, en el que solo cambia el texto de los nodos `w:t`
// que tocan los reemplazos de la salida (`RenderedOutput`). Un reemplazo que cruza varias corridas se escribe en la primera y se
// borra de las demás. Todo lo que no se leyó ni se anonimizó sale del archivo:
//   · comentarios, personas, control de cambios (se aceptan: lo insertado queda, lo eliminado se va), propiedades del documento
//     (`docProps`: autor, empresa), XML personalizado, glosario, macros, objetos incrustados y controles;
//   · los vínculos externos (destinos de hipervínculos, plantilla adjunta, combinación de correspondencia);
//   · el texto que el lector no lee (`mc:Fallback`, `a:t` de DrawingML, códigos de campo no seguros, valores de formularios), los
//     textos alternativos y nombres de imágenes, y las partes de texto que el abogado excluyó;
//   · gráficos y SmartArt (su texto vive en partes que no se leen).
// Fuera de los `w:t` tocados y de lo que se quita, el XML queda byte a byte igual: se edita el texto del XML, nunca se vuelve a
// serializar. Las imágenes, estilos, numeración, fuentes y tema se copian sin descomprimir.
//
// Antes de devolver, el resultado se vuelve a leer con `readDocx` y se compara con la salida esperada; y ningún valor reemplazado
// puede aparecer en ninguna parte XML. Si algo no cuadra, lanza (nunca entrega un archivo a medias). Errores solo con ErrorCode.
import { deflateSync, inflateSync, strToU8 } from 'fflate';
import type { Element, Node } from '@xmldom/xmldom';
import { SiglowError } from '../core/types';
import type { DetectionId, DocumentModel, IoLimits, OutputSection, ParseWarning, Part, RenderedOutput } from '../core/types';
import {
  W_NS, clave, crc32, leerDocxMapeado, leerEntrada, leerRelaciones, readDocx, resolver, rutaRels, ultimoSegmento, xmlDe,
} from './docx-read';
import type { DocxMapeado, EntradaZip, PiezaDocx, XmlDocx } from './docx-read';
import { MIME_DOCX } from './docx-write';
import { IO_LIMITS_POR_DEFECTO } from './io-client';
import { descargarBytes, nombreDescarga } from './txt-write';
import type { OpcionesExportacion, ResultadoExportacion } from './txt-write';

// ---------------------------------------------------------------------------------------------------------------------
// Tokenizador: posición exacta de cada elemento en el texto del XML (el DOM de xmldom no da desplazamientos)
// ---------------------------------------------------------------------------------------------------------------------

interface Atributo { nombre: string; ini: number; fin: number }
/** Un elemento del XML: [ini, fin) completo; [ini, finApertura) la etiqueta de apertura; [iniCierre, fin) la de cierre. */
interface Tok { nombre: string; ini: number; finApertura: number; iniCierre: number; fin: number; autocerrado: boolean; atributos: Atributo[] }

const ES_BLANCO = /[ \t\r\n]/u;

/** Elementos en orden de documento (preorden), igual que el DOM. El XML ya pasó por xmldom: es bien formado y sin DTD. */
function tokenizar(x: string): Tok[] {
  const out: Tok[] = [];
  const pila: Tok[] = [];
  let i = 0;
  const hasta = (fin: string, desde: number): number => {
    const k = x.indexOf(fin, desde);
    if (k < 0) throw new SiglowError('XML_INVALIDO');
    return k + fin.length;
  };
  while (i < x.length) {
    const lt = x.indexOf('<', i);
    if (lt < 0) break;
    if (x.startsWith('<!--', lt)) { i = hasta('-->', lt + 4); continue; }
    if (x.startsWith('<![CDATA[', lt)) { i = hasta(']]>', lt + 9); continue; }
    if (x.startsWith('<?', lt)) { i = hasta('?>', lt + 2); continue; }
    if (x.startsWith('<!', lt)) { i = hasta('>', lt + 2); continue; }
    if (x.startsWith('</', lt)) {
      const fin = hasta('>', lt + 2);
      const t = pila.pop();
      if (t === undefined) throw new SiglowError('XML_INVALIDO');
      t.iniCierre = lt;
      t.fin = fin;
      i = fin;
      continue;
    }
    let j = lt + 1;
    while (j < x.length && !ES_BLANCO.test(x[j] ?? '') && x[j] !== '>' && x[j] !== '/') j++;
    const t: Tok = { nombre: x.slice(lt + 1, j), ini: lt, finApertura: 0, iniCierre: 0, fin: 0, autocerrado: false, atributos: [] };
    for (;;) {
      const iniBlanco = j;
      while (j < x.length && ES_BLANCO.test(x[j] ?? '')) j++;
      if (j >= x.length) throw new SiglowError('XML_INVALIDO');
      if (x[j] === '>') { j++; break; }
      if (x.startsWith('/>', j)) { j += 2; t.autocerrado = true; break; }
      const iniNombre = j;
      while (j < x.length && x[j] !== '=' && !ES_BLANCO.test(x[j] ?? '')) j++;
      const nombre = x.slice(iniNombre, j);
      while (j < x.length && (ES_BLANCO.test(x[j] ?? '') || x[j] === '=')) j++;
      const comilla = x[j];
      if (comilla !== '"' && comilla !== "'") throw new SiglowError('XML_INVALIDO');
      j = hasta(comilla, j + 1);
      t.atributos.push({ nombre, ini: iniBlanco, fin: j });
    }
    t.finApertura = j;
    out.push(t);
    if (t.autocerrado) { t.iniCierre = j; t.fin = j; } else pila.push(t);
    i = j;
  }
  if (pila.length > 0) throw new SiglowError('XML_INVALIDO');
  return out;
}

/** Elementos del DOM en preorden, desde la raíz del documento. */
function elementosEnOrden(raiz: Element): Element[] {
  const out: Element[] = [];
  const pila: Node[] = [raiz];
  while (pila.length > 0) {
    const n = pila.pop() as Node;
    if (n.nodeType !== 1) continue;
    out.push(n as Element);
    const hijos = n.childNodes;
    for (let i = hijos.length - 1; i >= 0; i--) { const h = hijos.item(i); if (h !== null) pila.push(h); }
  }
  return out;
}

/** Empareja cada elemento del DOM con su token. Si no cuadran (nombre o número), no se edita nada: ERROR_INTERNO. */
function emparejar(x: XmlDocx): Array<{ el: Element; tok: Tok }> {
  const raiz = x.raiz.ownerDocument?.documentElement ?? x.raiz;
  const els = elementosEnOrden(raiz);
  const toks = tokenizar(x.texto);
  if (els.length !== toks.length) throw new SiglowError('ERROR_INTERNO');
  return els.map((el, i) => {
    const tok = toks[i] as Tok;
    if (tok.nombre !== el.nodeName) throw new SiglowError('ERROR_INTERNO');
    return { el, tok };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Ediciones sobre el texto del XML
// ---------------------------------------------------------------------------------------------------------------------

interface Edicion { ini: number; fin: number; texto: string }

function aplicar(x: string, eds: Edicion[]): string {
  const orden = [...eds].sort((a, b) => a.ini - b.ini || a.fin - b.fin);
  let out = '';
  let pos = 0;
  for (const e of orden) {
    if (e.ini < pos) throw new SiglowError('ERROR_INTERNO'); // solapadas: nunca debería ocurrir
    out += x.slice(pos, e.ini) + e.texto;
    pos = e.fin;
  }
  return out + x.slice(pos);
}

/** U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, U+FFFE, U+FFFF y sustitutos sueltos: no válidos en XML 1.0. */
const NO_VALIDOS_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿\uD800-\uDFFF]/gu;
const escapar = (s: string): string => s.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
const escaparAtributo = (s: string): string => escapar(s).replace(/"/gu, '&quot;');

const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_VML = 'urn:schemas-microsoft-com:vml';
const NS_O = 'urn:schemas-microsoft-com:office:office';
const NS_XML = 'http://www.w3.org/XML/1998/namespace';

/** Elementos de WordprocessingML que se quitan con todo su contenido. */
const W_QUITAR: ReadonlySet<string> = new Set([
  // control de cambios: lo eliminado y las propiedades anteriores (con autor y fecha)
  'del', 'moveFrom', 'rPrChange', 'pPrChange', 'sectPrChange', 'tblPrChange', 'tblPrExChange', 'trPrChange', 'tcPrChange',
  'tblGridChange', 'numberingChange', 'cellIns', 'cellDel', 'cellMerge',
  'moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd',
  'customXmlInsRangeStart', 'customXmlInsRangeEnd', 'customXmlDelRangeStart', 'customXmlDelRangeEnd',
  'customXmlMoveFromRangeStart', 'customXmlMoveFromRangeEnd', 'customXmlMoveToRangeStart', 'customXmlMoveToRangeEnd',
  'delText', 'delInstrText',
  // comentarios y permisos (nombres de editores)
  'commentRangeStart', 'commentRangeEnd', 'commentReference', 'permStart', 'permEnd',
  // XML personalizado, etiquetas inteligentes y metadatos de controles de contenido
  'customXmlPr', 'smartTagPr', 'alias', 'tag', 'dataBinding', 'placeholder', 'listItem',
  // valores de formularios heredados (el resultado visible se lee y se anonimiza)
  'default', 'helpText', 'statusText',
  // contenido externo o no leído
  'altChunk', 'control', 'subDoc',
  // configuración: plantilla adjunta (ruta con usuario), variables y combinación de correspondencia
  'attachedTemplate', 'docVars', 'mailMerge',
  // B-130: identificadores que ligan la salida al original (sesiones de edición) y el hash con sal de la contraseña de protección
  'rsids', 'documentProtection', 'writeProtection',
  // M-121: alias de estilos y macros de formularios
  'aliases', 'entryMacro', 'exitMacro',
]);
/** Se quita la envoltura y se conserva el contenido (lo insertado se acepta). */
const W_DESENVOLVER: ReadonlySet<string> = new Set(['ins', 'moveTo', 'customXml', 'smartTag']);
/** Atributos de WordprocessingML con datos de personas, fechas de revisión o valores elegidos (M-121: `lastValue`). */
const W_ATRIBUTOS_FUERA: ReadonlySet<string> = new Set(['author', 'initials', 'date', 'tooltip', 'docLocation', 'fullDate', 'lastValue']);
/** Elementos (de WordprocessingML) cuyo `w:val` nombra un estilo: se renombran con los estilos propios (M-121). */
const W_REFERENCIA_ESTILO: ReadonlySet<string> = new Set(['pStyle', 'rStyle', 'tblStyle', 'basedOn', 'next', 'link', 'numStyleLink', 'styleLink']);
/** Marcadores automáticos de Word (índices, referencias, el de «volver»): no llevan datos y no se renombran. */
const MARCADOR_AUTOMATICO = /^_(?:Toc|Ref|Hlk|GoBack)\w*$/u;
/**
 * M-120 · Palabras que un rótulo de numeración (`w:lvlText`) puede llevar; las demás se quitan del rótulo («Artículo %1.» queda;
 * «Contrato de Pedro %1» queda « %1»). Se comparan sin tildes y en minúsculas.
 */
const PALABRAS_DE_NUMERACION: ReadonlySet<string> = new Set([
  'articulo', 'art', 'capitulo', 'cap', 'titulo', 'seccion', 'clausula', 'paragrafo', 'par', 'numeral', 'literal', 'anexo', 'hecho',
  'hechos', 'pretension', 'pretensiones', 'punto', 'inciso', 'item', 'paso', 'nota', 'tabla', 'figura', 'parte', 'libro', 'apartado',
  'considerando', 'no', 'num', 'n', 'prueba', 'pruebas', 'peticion', 'fundamento', 'article', 'chapter', 'section', 'part', 'step', 'note',
  'table', 'figure', 'appendix', 'annex', 'clause',
]);
const plegar = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
function neutralizarRotulo(v: string): string {
  return v.replace(/\p{L}+/gu, (p) => (PALABRAS_DE_NUMERACION.has(plegar(p)) ? p : ''));
}
/** Gráficos que se conservan dentro de `w:drawing`; los demás (gráficos, SmartArt) tienen su texto en partes que no se leen. */
const GRAFICOS_ADMITIDOS: ReadonlySet<string> = new Set([
  'http://schemas.openxmlformats.org/drawingml/2006/picture',
  'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
  'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas',
]);
/** Campos cuyo código no lleva datos del caso (número de página, índices, fechas del sistema, referencias internas). */
const CAMPOS_SEGUROS: ReadonlySet<string> = new Set([
  'PAGE', 'NUMPAGES', 'SECTIONPAGES', 'SECTION', 'SEQ', 'TOC', 'PAGEREF', 'REF', 'NOTEREF', 'STYLEREF', 'DATE', 'TIME',
  'FORMTEXT', 'FORMCHECKBOX', 'FORMDROPDOWN', 'AUTONUM', 'AUTONUMLGL', 'AUTONUMOUT',
]);
const FORMATOS_DE_NUMERO = /^(?:MERGEFORMAT|CHARFORMAT|Arabic|ArabicDash|alphabetic|ALPHABETIC|roman|ROMAN|CardText|OrdText|Ordinal|DollarText|Hex|Upper|Lower|Caps|FirstCap)$/u;
/** Palabras que un formato de fecha puede llevar entre comillas simples («d 'de' MMMM 'de' yyyy»). */
const PALABRAS_DE_FECHA: ReadonlySet<string> = new Set(['de', 'del', 'a', 'las', 'los', 'el', 'y', 'en', 'of', 'the']);
const SECUENCIAS: ReadonlySet<string> = new Set(['tabla', 'figura', 'ilustracion', 'ecuacion', 'grafico', 'table', 'figure', 'equation']);
function formatoDeFechaSeguro(f: string): boolean {
  const sinLiterales = f.replace(/'([^']*)'/gu, (_, lit: string) =>
    (lit.split(/\s+/u).filter((x) => x !== '').every((x) => PALABRAS_DE_FECHA.has(plegar(x))) ? ' ' : '\u0000'));
  return /^[dMyHhmsAaPp\s/:.,\-–]*$/u.test(sinLiterales);
}
/**
 * M-120 · Un código de campo es seguro si su tipo está en `CAMPOS_SEGUROS` y ningún argumento puede llevar un dato: formatos de
 * fecha solo con sus letras (y literales como «de»), formatos de número conocidos, marcadores automáticos en las referencias,
 * secuencias y estilos conocidos. Ante la duda, no es seguro y su código se vacía (el resultado visible se lee y se anonimiza).
 */
function campoSeguro(instr: string): boolean {
  const toks = instr.match(/"[^"]*"|\\[*@#!]|\\[A-Za-z]|[^\s"\\]+/gu) ?? [];
  const tipo = toks[0]?.toUpperCase();
  if (tipo === undefined || !CAMPOS_SEGUROS.has(tipo)) return false;
  for (let i = 1; i < toks.length; i++) {
    const t = toks[i] ?? '';
    if (t.startsWith('\\')) continue;
    const v = t.startsWith('"') ? t.slice(1, -1) : t;
    const previo = toks[i - 1];
    if (previo === '\\*') { if (!FORMATOS_DE_NUMERO.test(v)) return false; continue; }
    if (previo === '\\@') { if (!formatoDeFechaSeguro(v)) return false; continue; }
    if (previo === '\\#') { if (!/^[0#.,\-+%$\s;()]*$/u.test(v)) return false; continue; }
    if (i === 1 && (tipo === 'REF' || tipo === 'PAGEREF' || tipo === 'NOTEREF')) { if (!MARCADOR_AUTOMATICO.test(v)) return false; continue; }
    if (i === 1 && tipo === 'SEQ') { if (!SECUENCIAS.has(plegar(v))) return false; continue; }
    if (i === 1 && tipo === 'STYLEREF') { if (!/^(?:\d|heading \d|t[ií]tulo \d)$/iu.test(v)) return false; continue; }
    if (/\p{L}/u.test(v)) return false; // cualquier otro argumento con letras (estilos del TOC, textos): no
  }
  return true;
}

const esW = (el: Element): boolean => el.namespaceURI !== null && W_NS.has(el.namespaceURI);
function atributoLocal(el: Element, local: string, ns?: (u: string | null) => boolean): string | null {
  const a = el.attributes;
  for (let i = 0; i < a.length; i++) {
    const x = a.item(i);
    if (x !== null && x.localName === local && (ns === undefined || ns(x.namespaceURI))) return x.value;
  }
  return null;
}
const nsW = (u: string | null): boolean => u === null || W_NS.has(u);

interface Saneo {
  /** Nuevo texto de los `w:t` mapeados que cambian ('' = vaciar). Los `w:sym` con null se quitan. */
  nuevos: Map<Element, string | null>;
  /** Todos los `w:t`/`w:sym` mapeados a alguna parte (los demás se vacían o se quitan). */
  mapeados: Set<Element>;
  /** `r:id` de esta parte cuyas relaciones se descartaron. */
  relacionesFuera: ReadonlySet<string>;
  /** M-121 · Nombre neutro de un marcador o de un campo de formulario (el mismo en todas las partes); los automáticos no cambian. */
  nombreNeutro: (n: string) => string;
  /** M-121 · Estilos propios del documento: `styleId` original → identificador y nombre neutros. */
  estilos: ReadonlyMap<string, { id: string; nombre: string }>;
  /** M-120 · Opciones de listas desplegables ya neutralizadas («Opción N»). */
  opciones: { n: number };
}

const NS_W14_W15 = /^http:\/\/schemas\.microsoft\.com\/office\/word\/20\d\d\/wordml$/u;

/**
 * Valor neutro de un atributo de WordprocessingML que puede llevar un dato sin ser texto del documento (M-120, M-121), o null si se
 * deja igual: nombres de marcadores, anclas y campos de formulario; opciones de listas; rótulos de numeración; estilos propios.
 */
function valorNeutro(el: Element, w: string, local: string, valor: string, s: Saneo): string | null {
  const padre = el.parentNode !== null && el.parentNode.nodeType === 1 ? (el.parentNode as Element).localName : '';
  if ((w === 'bookmarkStart' && local === 'name') || (w === 'hyperlink' && local === 'anchor') || (w === 'name' && padre === 'ffData' && local === 'val')) {
    return s.nombreNeutro(valor);
  }
  if (w === 'listEntry' && local === 'val') return `Opción ${++s.opciones.n}`;
  if (w === 'lvlText' && local === 'val') return neutralizarRotulo(valor);
  if (w === 'style' && local === 'styleId') return s.estilos.get(valor)?.id ?? null;
  if (w === 'name' && padre === 'style' && local === 'val') {
    const id = atributoLocal(el.parentNode as Element, 'styleId', nsW);
    return id === null ? null : (s.estilos.get(id)?.nombre ?? null);
  }
  if (W_REFERENCIA_ESTILO.has(w) && local === 'val') return s.estilos.get(valor)?.id ?? null;
  return null;
}

/** Ediciones que sanean una parte XML (cuerpo, encabezado, pie, notas, configuración, estilos o numeración) y reescriben su texto. */
function sanear(x: XmlDocx, s: Saneo): string {
  const pares = emparejar(x);
  const indice = new Map<Element, Tok>(pares.map((p) => [p.el, p.tok]));
  // 1. Campos complejos: las instrucciones de cada campo se juntan; si el campo no es seguro, se vacían todas.
  const instrVaciar = new Set<Element>();
  const campos: Element[][] = [];
  for (const { el } of pares) {
    if (!esW(el)) continue;
    if (el.localName === 'fldChar') {
      const tipo = atributoLocal(el, 'fldCharType', nsW);
      if (tipo === 'begin') campos.push([]);
      else if (tipo === 'end') {
        const c = campos.pop() ?? [];
        if (!campoSeguro(c.map((e) => e.textContent ?? '').join(''))) for (const e of c) instrVaciar.add(e);
      }
    } else if (el.localName === 'instrText') {
      const c = campos[campos.length - 1];
      if (c === undefined) instrVaciar.add(el); else c.push(el);
    }
  }
  for (const c of campos) for (const e of c) instrVaciar.add(e); // campos sin cierre
  // 2. Dibujos con gráficos que no se conservan.
  const dibujosFuera = new Set<Element>();
  for (const { el } of pares) {
    if (el.localName !== 'graphicData' || el.namespaceURI !== NS_A) continue;
    if (GRAFICOS_ADMITIDOS.has(el.getAttribute('uri') ?? '')) continue;
    let p: Node | null = el.parentNode;
    while (p !== null && !(p.nodeType === 1 && esW(p as Element) && (p as Element).localName === 'drawing')) p = p.parentNode;
    if (p !== null) dibujosFuera.add(p as Element);
  }

  const eds: Edicion[] = [];
  let quitadoHasta = -1;
  const quitar = (t: Tok): void => { eds.push({ ini: t.ini, fin: t.fin, texto: '' }); quitadoHasta = t.fin; };
  const vaciarContenido = (t: Tok): void => { if (!t.autocerrado && t.iniCierre > t.finApertura) eds.push({ ini: t.finApertura, fin: t.iniCierre, texto: '' }); };
  for (const { el, tok } of pares) {
    if (tok.ini < quitadoHasta) continue; // dentro de algo ya quitado
    const w = esW(el) ? el.localName : null;
    if (w !== null && W_QUITAR.has(w)) { quitar(tok); continue; }
    if (dibujosFuera.has(el)) { quitar(tok); continue; }
    if (el.namespaceURI === NS_O && el.localName === 'OLEObject') { quitar(tok); continue; }
    // B-130: `w14:docId`/`w15:docId` (un GUID por documento) en `settings`.
    if (el.localName === 'docId' && el.namespaceURI !== null && NS_W14_W15.test(el.namespaceURI)) { quitar(tok); continue; }
    // B-132: la variante SVG de una imagen cuya relación se descartó (lleva su texto como texto); queda la imagen de mapa de bits.
    if (el.localName === 'svgBlip' && [...s.relacionesFuera].some((id) => atributoLocal(el, 'embed', (u) => u === NS_R) === id)) { quitar(tok); continue; }
    if (w === 'sym' && (s.nuevos.get(el) === null || !s.mapeados.has(el))) { quitar(tok); continue; }
    if (w === 'fldSimple' && !campoSeguro(atributoLocal(el, 'instr', nsW) ?? '')) {
      eds.push({ ini: tok.ini, fin: tok.finApertura, texto: '' });
      if (!tok.autocerrado) eds.push({ ini: tok.iniCierre, fin: tok.fin, texto: '' });
      continue;
    }
    if (w !== null && W_DESENVOLVER.has(w)) {
      eds.push({ ini: tok.ini, fin: tok.finApertura, texto: '' });
      if (!tok.autocerrado) eds.push({ ini: tok.iniCierre, fin: tok.fin, texto: '' });
      continue;
    }
    // Atributos: datos de revisión, textos alternativos, nombres de imagen, relaciones descartadas.
    let apertura: Edicion[] = [];
    const a = el.attributes;
    for (let i = 0; i < a.length; i++) {
      const at = a.item(i);
      if (at === null) continue;
      const span = tok.atributos.find((t) => t.nombre === at.nodeName);
      if (span === undefined) continue;
      const local = at.localName ?? '';
      const fuera =
        (at.namespaceURI !== null && W_NS.has(at.namespaceURI) && W_ATRIBUTOS_FUERA.has(local)) ||
        local === 'tooltip' || // M-121: también el de DrawingML (`a:hlinkClick`)
        (at.namespaceURI === NS_R && s.relacionesFuera.has(at.value)) ||
        ((el.localName === 'docPr' || el.localName === 'cNvPr') && at.namespaceURI === null && (local === 'descr' || local === 'title')) ||
        ((el.namespaceURI === NS_VML || el.namespaceURI === NS_O) && (local === 'alt' || local === 'title') && at.namespaceURI !== NS_R);
      const nuevoValor = fuera || !nsW(at.namespaceURI) || w === null ? null : valorNeutro(el, w, local, at.value, s);
      if (fuera) apertura.push({ ini: span.ini, fin: span.fin, texto: '' });
      else if (nuevoValor !== null && nuevoValor !== at.value) {
        apertura.push({ ini: span.ini, fin: span.fin, texto: ` ${at.nodeName}="${escaparAtributo(nuevoValor)}"` });
      }
      else if ((el.localName === 'docPr' || el.localName === 'cNvPr') && at.namespaceURI === null && local === 'name' && at.value !== 'Imagen') {
        apertura.push({ ini: span.ini, fin: span.fin, texto: ' name="Imagen"' });
      } else if (el.namespaceURI === NS_VML && el.localName === 'textpath' && local === 'string' && at.value !== '') {
        apertura.push({ ini: span.ini, fin: span.fin, texto: ' string=""' }); // texto de una marca de agua: no se lee
      }
    }
    // Texto: `w:t` mapeados con texto nuevo; el resto de `w:t`, `a:t`, `m:t` (ecuaciones, M-120) e instrucciones no seguras se vacían.
    const esT = (w === 't') || (el.localName === 't' && (el.namespaceURI === NS_A || el.namespaceURI === NS_M));
    if (esT || (w === 'instrText' && instrVaciar.has(el))) {
      const nuevo = w === 't' && s.mapeados.has(el) ? s.nuevos.get(el) : '';
      if (nuevo !== undefined && nuevo !== null) {
        const actual = tok.autocerrado ? '' : x.texto.slice(tok.finApertura, tok.iniCierre);
        if (nuevo === '') vaciarContenido(tok);
        else if (tok.autocerrado) throw new SiglowError('ERROR_INTERNO'); // un w:t mapeado con texto nunca está vacío
        else if (actual !== escapar(nuevo)) {
          eds.push({ ini: tok.finApertura, fin: tok.iniCierre, texto: escapar(nuevo) });
          const preserva = atributoLocal(el, 'space', (u) => u === NS_XML) === 'preserve';
          if (!preserva && /^\s|\s$|\s\s/u.test(nuevo)) {
            const cierre = tok.finApertura - 1; // la posición del '>'
            apertura.push({ ini: cierre, fin: cierre, texto: ' xml:space="preserve"' });
          }
        }
      }
    }
    if (apertura.length > 0) eds.push(...apertura);
    apertura = [];
  }
  return aplicar(x.texto, eds);
}

// ---------------------------------------------------------------------------------------------------------------------
// Texto nuevo de cada pieza (`w:t`) a partir de los segmentos de la salida
// ---------------------------------------------------------------------------------------------------------------------

/** `det`: la detección del reemplazo (F3: la vista previa del PDF lleva el clic de un recuadro a su dato). */
export interface Cambio { ini: number; fin: number; nuevo: string; det?: DetectionId }

/**
 * Los reemplazos de una sección: donde el texto de salida difiere del de la parte. Comprueba que los segmentos cubren ambos textos.
 * También lo usa `pdf-tachar.ts`.
 */
export function cambiosDe(parte: Part, sec: OutputSection): Cambio[] {
  const segs = [...sec.segments].sort((a, b) => a.partStart - b.partStart);
  let p = 0;
  let o = 0;
  const out: Cambio[] = [];
  for (const g of segs) {
    if (g.partStart !== p || g.outStart !== o || g.partEnd < g.partStart || g.outEnd < g.outStart) throw new SiglowError('ERROR_INTERNO');
    const nuevo = sec.text.slice(g.outStart, g.outEnd);
    if (nuevo !== parte.text.slice(g.partStart, g.partEnd)) out.push(g.detectionId === undefined ? { ini: g.partStart, fin: g.partEnd, nuevo } : { ini: g.partStart, fin: g.partEnd, nuevo, det: g.detectionId });
    p = g.partEnd;
    o = g.outEnd;
  }
  if (p !== parte.text.length || o !== sec.text.length) throw new SiglowError('ERROR_INTERNO');
  return out;
}

/** Texto nuevo de las piezas afectadas (null = quitar el `w:sym`). El reemplazo va en el primer `w:t` que toca. */
function piezasNuevas(piezas: PiezaDocx[], cambios: Cambio[], nuevos: Map<Element, string | null>): void {
  const borrar = new Map<PiezaDocx, Array<[number, number]>>();
  const insertar = new Map<PiezaDocx, Array<[number, string]>>();
  const anadir = <T>(m: Map<PiezaDocx, T[]>, p: PiezaDocx, v: T): void => { const l = m.get(p) ?? []; l.push(v); m.set(p, l); };
  for (const c of cambios) {
    const tocadas = piezas.filter((p) => p.ini < c.fin && p.fin > c.ini);
    for (const p of tocadas) anadir(borrar, p, [Math.max(c.ini, p.ini) - p.ini, Math.min(c.fin, p.fin) - p.ini]);
    if (c.nuevo === '') continue;
    const ancla = tocadas.find((p) => p.tipo === 't');
    if (ancla !== undefined) { anadir(insertar, ancla, [Math.max(c.ini, ancla.ini) - ancla.ini, c.nuevo]); continue; }
    // El reemplazo solo cubre caracteres sin `w:t` (tabulador, salto): va al final del `w:t` anterior o al inicio del siguiente.
    const antes = [...piezas].reverse().find((p) => p.tipo === 't' && p.fin <= c.ini);
    const despues = piezas.find((p) => p.tipo === 't' && p.ini >= c.fin);
    if (antes !== undefined) anadir(insertar, antes, [antes.texto.length, c.nuevo]);
    else if (despues !== undefined) anadir(insertar, despues, [0, c.nuevo]);
    else throw new SiglowError('FORMATO_NO_ADMITIDO');
  }
  for (const p of new Set([...borrar.keys(), ...insertar.keys()])) {
    const rangos = borrar.get(p) ?? [];
    if (p.tipo === 'sym') { if (rangos.length > 0) nuevos.set(p.el, null); continue; }
    const ins = insertar.get(p) ?? [];
    let t = '';
    for (let k = 0; k <= p.texto.length; k++) {
      for (const [pos, s] of ins) if (pos === k) t += s;
      if (k < p.texto.length && !rangos.some(([a, b]) => k >= a && k < b)) t += p.texto[k] ?? '';
    }
    nuevos.set(p.el, t);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// ZIP de salida: entradas copiadas tal cual (comprimidas) o nuevas; fecha fija y sin comentario ni campos extra
// ---------------------------------------------------------------------------------------------------------------------

interface EntradaSalida { nombre: string; metodo: 0 | 8; crc: number; comprimido: Uint8Array; tamano: number }

/** 1980-01-02 00:00 en formato DOS (como `FECHA_ENTRADAS` de docx-write). */
const FECHA_DOS = (0 << 9) | (1 << 5) | 2;

function zip(entradas: EntradaSalida[]): Uint8Array {
  const enc = new TextEncoder();
  const nombres = entradas.map((e) => enc.encode(e.nombre));
  const utf8 = (i: number): number => (/^[\x20-\x7e]*$/u.test(entradas[i]?.nombre ?? '') ? 0 : 0x800);
  let total = 22;
  entradas.forEach((e, i) => { total += 30 + 46 + 2 * (nombres[i]?.length ?? 0) + e.comprimido.length; });
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let p = 0;
  const offsets: number[] = [];
  entradas.forEach((e, i) => {
    const n = nombres[i] as Uint8Array;
    offsets.push(p);
    dv.setUint32(p, 0x04034b50, true); dv.setUint16(p + 4, 20, true); dv.setUint16(p + 6, utf8(i), true);
    dv.setUint16(p + 8, e.metodo, true); dv.setUint16(p + 10, 0, true); dv.setUint16(p + 12, FECHA_DOS, true);
    dv.setUint32(p + 14, e.crc, true); dv.setUint32(p + 18, e.comprimido.length, true); dv.setUint32(p + 22, e.tamano, true);
    dv.setUint16(p + 26, n.length, true); dv.setUint16(p + 28, 0, true);
    out.set(n, p + 30);
    out.set(e.comprimido, p + 30 + n.length);
    p += 30 + n.length + e.comprimido.length;
  });
  const iniCentral = p;
  entradas.forEach((e, i) => {
    const n = nombres[i] as Uint8Array;
    dv.setUint32(p, 0x02014b50, true); dv.setUint16(p + 4, 20, true); dv.setUint16(p + 6, 20, true); dv.setUint16(p + 8, utf8(i), true);
    dv.setUint16(p + 10, e.metodo, true); dv.setUint16(p + 12, 0, true); dv.setUint16(p + 14, FECHA_DOS, true);
    dv.setUint32(p + 16, e.crc, true); dv.setUint32(p + 20, e.comprimido.length, true); dv.setUint32(p + 24, e.tamano, true);
    dv.setUint16(p + 28, n.length, true); // extra, comentario, disco y atributos en 0
    dv.setUint32(p + 42, offsets[i] ?? 0, true);
    out.set(n, p + 46);
    p += 46 + n.length;
  });
  dv.setUint32(p, 0x06054b50, true);
  dv.setUint16(p + 8, entradas.length, true); dv.setUint16(p + 10, entradas.length, true);
  dv.setUint32(p + 12, p - iniCentral, true); dv.setUint32(p + 16, iniCentral, true);
  return out;
}

function entradaNueva(nombre: string, texto: string, bom: boolean): EntradaSalida {
  const cuerpo = strToU8(texto);
  const datos = bom ? new Uint8Array([0xef, 0xbb, 0xbf, ...cuerpo]) : cuerpo;
  return { nombre, metodo: 8, crc: crc32(datos), comprimido: deflateSync(datos, { level: 6 }), tamano: datos.length };
}

/** Copia una entrada del original sin descomprimirla (imágenes, estilos, tema): mismos bytes, mismo CRC. */
function entradaCopiada(d: Uint8Array, e: EntradaZip): EntradaSalida {
  if ((e.flags & 1) !== 0 || (e.metodo !== 0 && e.metodo !== 8)) throw new SiglowError('ZIP_INVALIDO');
  if (!Number.isSafeInteger(e.offset) || e.offset + 30 > d.length) throw new SiglowError('ZIP_INVALIDO');
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  if (dv.getUint32(e.offset, true) !== 0x04034b50) throw new SiglowError('ZIP_INVALIDO');
  const ini = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
  if (ini + e.sc > d.length || e.su > 0xffffffff || e.sc > 0xffffffff) throw new SiglowError('ZIP_INVALIDO');
  return { nombre: e.nombre, metodo: e.metodo as 0 | 8, crc: e.crc, comprimido: d.slice(ini, ini + e.sc), tamano: e.su };
}

// ---------------------------------------------------------------------------------------------------------------------
// Construcción
// ---------------------------------------------------------------------------------------------------------------------

/** Partes con texto que se leen y se reescriben. */
const TIPOS_TEXTO: ReadonlySet<string> = new Set(['header', 'footer', 'footnotes', 'endnotes']);
/** Partes de formato que salen. `settings`, estilos y numeración se sanean (B-130, M-120, M-121); las demás se copian tal cual.
 * Las otras relaciones (comentarios, personas, XML personalizado, glosario, macros, objetos, controles, gráficos, plantilla,
 * combinación de correspondencia…) se descartan. */
const TIPOS_COPIA: ReadonlySet<string> = new Set(['styles', 'stylesWithEffects', 'numbering', 'fontTable', 'settings', 'webSettings', 'theme', 'image', 'font']);
const TIPOS_SANEADOS: ReadonlySet<string> = new Set(['settings', 'styles', 'stylesWithEffects', 'numbering']);
/** B-132 · Imágenes vectoriales que guardan su texto como texto (EMF y WMF en UTF-16, SVG en claro): no salen. */
const VECTORIAL = /\.(?:emf|wmf|emz|wmz|svg|svgz)$/iu;
const TIPO_IMAGEN: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff',
  tiff: 'image/tiff', ico: 'image/x-icon', webp: 'image/webp',
};

export interface DocxFielConstruido {
  bytes: Uint8Array;
  /** `CARACTERES_CONTROL` si se quitaron caracteres no válidos en XML del texto de salida. */
  avisos: ParseWarning[];
  /** Imágenes que se conservan tal cual (pueden mostrar datos: la interfaz lo advierte, M-122). */
  imagenes: number;
  /** Imágenes EMF, WMF o SVG que no salieron (B-132; la interfaz lo advierte). */
  vectorialesQuitadas: number;
}

/** M-121 · Estilos propios (`w:customStyle`) de una parte de estilos: su nombre puede llevar un dato; se renombran a «Estilo N». */
function estilosPropios(x: XmlDocx, acumulado: Map<string, { id: string; nombre: string }>): void {
  const hijos = x.raiz.childNodes;
  for (let i = 0; i < hijos.length; i++) {
    const n = hijos.item(i);
    if (n === null || n.nodeType !== 1 || !esW(n as Element) || (n as Element).localName !== 'style') continue;
    const el = n as Element;
    const propio = atributoLocal(el, 'customStyle', nsW);
    const id = atributoLocal(el, 'styleId', nsW);
    if (id === null || (propio !== '1' && propio !== 'true' && propio !== 'on') || acumulado.has(id)) continue;
    const k = acumulado.size + 1;
    acumulado.set(id, { id: `SigLowEstilo${k}`, nombre: `Estilo ${k}` });
  }
}

const normalizarComparacion = (s: string): string => s.normalize('NFC').replace(/[\t\n‑­]/gu, '');

/**
 * Construye el .docx fiel. `original` son los bytes del archivo cargado (no se modifican), `doc` el modelo analizado (sus partes,
 * con las casillas de inclusión) y `out` la salida renderizada. Lanza `FORMATO_NO_ADMITIDO` si el documento no se puede reescribir
 * con fidelidad (la interfaz ofrece entonces el .docx simple) y `ERROR_INTERNO` si la verificación final falla.
 */
export function construirDocxFiel(original: Uint8Array, doc: DocumentModel, out: RenderedOutput, limits: IoLimits = IO_LIMITS_POR_DEFECTO): DocxFielConstruido {
  if (doc.source !== 'docx' || out.docId !== doc.id) throw new SiglowError('FORMATO_NO_ADMITIDO');
  const d = original;
  const m: DocxMapeado = leerDocxMapeado(d, { docId: doc.id, label: doc.label }, limits);
  // El original debe ser el mismo documento que se analizó: mismas partes, mismo texto.
  const partes = [...doc.parts].sort((a, b) => a.order - b.order);
  if (partes.length !== m.partes.length) throw new SiglowError('ERROR_INTERNO');
  partes.forEach((p, i) => {
    const q = m.partes[i];
    if (q === undefined || q.kind !== p.kind || q.texto !== p.text) throw new SiglowError('ERROR_INTERNO');
  });

  // 1. Texto nuevo de cada `w:t`.
  const nuevos = new Map<Element, string | null>();
  const mapeados = new Set<Element>();
  let quitados = 0;
  const valores: string[] = [];
  const esperadas: Array<{ kind: string; texto: string }> = [];
  partes.forEach((p, i) => {
    const mp = m.partes[i];
    if (mp === undefined || p.kind === 'comentario') return; // los comentarios salen del archivo
    if (mp.piezas !== null) for (const x of mp.piezas) mapeados.add(x.el);
    const sec = p.included ? out.sections.find((s) => s.partId === p.id) : undefined;
    if (sec === undefined) {
      // Parte excluida: su texto no se exporta.
      if (mp.piezas === null) throw new SiglowError('FORMATO_NO_ADMITIDO');
      for (const x of mp.piezas) nuevos.set(x.el, x.tipo === 'sym' ? null : '');
      return;
    }
    const cambios = cambiosDe(p, sec).map((c) => ({ ...c, nuevo: c.nuevo.replace(NO_VALIDOS_XML, () => { quitados++; return ''; }) }));
    for (const c of cambios) valores.push(p.text.slice(c.ini, c.fin));
    if (cambios.length > 0) {
      if (mp.piezas === null) throw new SiglowError('FORMATO_NO_ADMITIDO');
      piezasNuevas(mp.piezas, cambios, nuevos);
    }
    if (sec.text.trim() !== '') esperadas.push({ kind: p.kind, texto: normalizarComparacion(sec.text.replace(NO_VALIDOS_XML, '')) });
  });

  // 2. Recorrido por relaciones desde el paquete: qué partes salen y cómo.
  const salida = new Map<string, EntradaSalida>();
  const nombreDe = (k: string): string => m.entradas.get(k)?.nombre ?? k;
  const abrirXml = (k: string): (XmlDocx & { nombre: string }) | null => {
    const ya = m.xml.get(k);
    if (ya !== undefined) return ya;
    const e = m.entradas.get(k);
    if (e === undefined) return null;
    const x = xmlDe(leerEntrada(d, e, limits, { total: 0, consumido: 0 }));
    const r = { ...x, nombre: e.nombre };
    m.xml.set(k, r);
    return r;
  };
  const escribirXml = (k: string, x: XmlDocx & { nombre: string }, texto: string): void => {
    if (texto === x.texto) { const e = m.entradas.get(k); if (e !== undefined) { salida.set(k, entradaCopiada(d, e)); return; } }
    if (x.codificacion !== 'utf-8') throw new SiglowError('FORMATO_NO_ADMITIDO');
    salida.set(k, entradaNueva(x.nombre, texto, x.bom));
  };
  /** M-121 · Nombres neutros de las imágenes (el de la entrada del ZIP y el `Target` de las relaciones): clave original → nombre. */
  const imagenesNeutras = new Map<string, string>();
  let vectorialesQuitadas = 0;
  const vectorialesVistas = new Set<string>();
  const nombreImagen = (k: string): string => {
    const ya = imagenesNeutras.get(k);
    if (ya !== undefined) return ya;
    const ext = /\.([a-z0-9]{1,5})$/u.exec(k)?.[1] ?? 'bin';
    const nombre = `word/media/siglow-imagen${imagenesNeutras.size + 1}.${ext}`;
    imagenesNeutras.set(k, nombre);
    return nombre;
  };
  /** Relaciones de una parte: se quitan las externas y las de tipos no admitidos. Devuelve los destinos que siguen. */
  const relaciones = (origen: string, admitir: (tipo: string) => boolean): { fuera: Set<string>; destinos: Array<{ k: string; tipo: string }> } => {
    const kr = clave(rutaRels(nombreDe(origen)));
    const x = abrirXml(kr);
    const fuera = new Set<string>();
    const destinos: Array<{ k: string; tipo: string }> = [];
    if (x === null) return { fuera, destinos };
    const eds: Edicion[] = [];
    const rels = leerRelaciones(x.raiz);
    const pares = emparejar(x).filter((p) => p.el.localName === 'Relationship');
    for (const p of pares) {
      const id = p.el.getAttribute('Id') ?? '';
      const r = rels.find((q) => q.id === id && q.destino === p.el.getAttribute('Target'));
      const tipo = r === undefined ? '' : ultimoSegmento(r.tipo);
      const k = r === undefined ? '' : clave(resolver(nombreDe(origen), r.destino));
      const vectorial = tipo === 'image' && VECTORIAL.test(k);
      if (vectorial && r !== undefined && !r.externa && m.entradas.has(k) && !vectorialesVistas.has(k)) { vectorialesVistas.add(k); vectorialesQuitadas++; }
      if (r === undefined || r.externa || vectorial || !admitir(tipo) || !m.entradas.has(k)) {
        fuera.add(id);
        eds.push({ ini: p.tok.ini, fin: p.tok.fin, texto: '' });
      } else {
        destinos.push({ k, tipo });
        if (tipo === 'image') {
          // El destino pasa a un nombre neutro, absoluto desde la raíz del paquete (OPC lo admite desde cualquier parte).
          const span = p.tok.atributos.find((a) => a.nombre === 'Target');
          if (span !== undefined) eds.push({ ini: span.ini, fin: span.fin, texto: ` Target="/${nombreImagen(k)}"` });
        }
      }
    }
    // Sin ninguna relación que siga (p. ej. la plantilla adjunta de `settings`), el archivo de relaciones no sale.
    if (destinos.length > 0 || origen === '') escribirXml(kr, x, aplicar(x.texto, eds));
    return { fuera, destinos };
  };

  const pendientes: Array<{ k: string; tipo: string }> = [];
  const paquete = relaciones('', (t) => t === 'officeDocument');
  for (const x of paquete.destinos) if (x.k === m.principal) pendientes.push({ k: x.k, tipo: 'principal' });
  if (pendientes.length === 0) throw new SiglowError('FORMATO_NO_ADMITIDO'); // la principal no se halló por relación
  // M-121: estilos propios y nombres de marcadores y campos de formulario, neutros y los mismos en todas las partes.
  const estilos = new Map<string, { id: string; nombre: string }>();
  const relsPrincipal = abrirXml(clave(rutaRels(nombreDe(m.principal))));
  for (const r of relsPrincipal === null ? [] : leerRelaciones(relsPrincipal.raiz)) {
    const t = ultimoSegmento(r.tipo);
    if (r.externa || (t !== 'styles' && t !== 'stylesWithEffects')) continue;
    const x = abrirXml(clave(resolver(nombreDe(m.principal), r.destino)));
    if (x !== null) estilosPropios(x, estilos);
  }
  const marcadores = new Map<string, string>();
  const nombreNeutro = (n: string): string => {
    if (MARCADOR_AUTOMATICO.test(n)) return n;
    const ya = marcadores.get(n);
    if (ya !== undefined) return ya;
    const nuevo = `SigLowMarca${marcadores.size + 1}`;
    marcadores.set(n, nuevo);
    return nuevo;
  };
  const opciones = { n: 0 };
  const vistos = new Set<string>();
  while (pendientes.length > 0) {
    const { k, tipo } = pendientes.shift() as { k: string; tipo: string };
    if (vistos.has(k)) continue;
    vistos.add(k);
    const conTexto = tipo === 'principal' || TIPOS_TEXTO.has(tipo);
    if (conTexto || TIPOS_SANEADOS.has(tipo)) {
      const x = abrirXml(k);
      if (x === null) continue;
      const admitir = tipo === 'principal' ? (t: string): boolean => TIPOS_TEXTO.has(t) || TIPOS_COPIA.has(t) : (t: string): boolean => t === 'image';
      const { fuera, destinos } = relaciones(k, admitir);
      escribirXml(k, x, sanear(x, { nuevos, mapeados, relacionesFuera: fuera, nombreNeutro, estilos, opciones }));
      pendientes.push(...destinos);
    } else {
      const e = m.entradas.get(k);
      if (e === undefined) continue;
      const neutra = tipo === 'image' ? imagenesNeutras.get(k) : undefined;
      salida.set(k, neutra === undefined ? entradaCopiada(d, e) : { ...entradaCopiada(d, e), nombre: neutra });
      // El tema y las fuentes pueden tener imágenes (rellenos) o fuentes incrustadas.
      if (tipo === 'fontTable' || tipo === 'theme') {
        const { destinos } = relaciones(k, (t) => t === 'image' || t === 'font');
        pendientes.push(...destinos);
      }
    }
  }
  const imagenes = [...salida.keys()].filter((k) => imagenesNeutras.has(k)).length;

  // 3. [Content_Types].xml: sin las declaraciones de las partes que no salen ni de los nombres de imagen originales; con un
  // `Default` para la extensión de cada imagen renombrada que no lo tenga.
  const kct = clave('[Content_Types].xml');
  const ct = abrirXml(kct);
  if (ct === null) throw new SiglowError('FORMATO_NO_ADMITIDO');
  const edsCt: Edicion[] = [];
  const conDefault = new Set<string>();
  const tipoDeOverride = new Map<string, string>();
  let cierreTypes = -1;
  for (const { el, tok } of emparejar(ct)) {
    if (el.localName === 'Types') cierreTypes = tok.iniCierre;
    if (el.localName === 'Default') conDefault.add((el.getAttribute('Extension') ?? '').toLowerCase());
    if (el.localName !== 'Override') continue;
    const kp = clave(el.getAttribute('PartName') ?? '');
    if (imagenesNeutras.has(kp)) tipoDeOverride.set(/\.([a-z0-9]{1,5})$/u.exec(kp)?.[1] ?? 'bin', el.getAttribute('ContentType') ?? '');
    if (!salida.has(kp) || imagenesNeutras.has(kp)) edsCt.push({ ini: tok.ini, fin: tok.fin, texto: '' });
  }
  const nuevosDefault = [...new Set([...imagenesNeutras.values()].map((n) => /\.([a-z0-9]{1,5})$/u.exec(n)?.[1] ?? 'bin'))]
    .filter((ext) => !conDefault.has(ext))
    .map((ext) => `<Default Extension="${ext}" ContentType="${escaparAtributo(tipoDeOverride.get(ext) ?? TIPO_IMAGEN[ext] ?? 'application/octet-stream')}"/>`);
  if (nuevosDefault.length > 0) {
    if (cierreTypes < 0) throw new SiglowError('FORMATO_NO_ADMITIDO');
    edsCt.push({ ini: cierreTypes, fin: cierreTypes, texto: nuevosDefault.join('') });
  }
  escribirXml(kct, ct, aplicar(ct.texto, edsCt));

  // 4. ZIP: [Content_Types].xml y _rels/.rels primero; después, en el orden del original.
  const orden = [kct, clave('_rels/.rels'), ...[...m.entradas.keys()]];
  const finales: EntradaSalida[] = [];
  const puestos = new Set<string>();
  for (const k of orden) {
    const e = salida.get(k);
    if (e === undefined || puestos.has(k)) continue;
    puestos.add(k);
    finales.push(e);
  }
  const bytes = zip(finales);

  // 5. Verificación: el resultado se lee como cualquier .docx y da la salida esperada; ningún valor reemplazado queda en el XML.
  verificar(bytes, finales, esperadas, valores, out, limits);
  return { bytes, avisos: quitados > 0 ? [{ code: 'CARACTERES_CONTROL', count: quitados }] : [], imagenes, vectorialesQuitadas };
}

/** Forma plegada (sin tildes, en minúsculas, blancos colapsados) y compacta (solo letras y cifras) de un texto. */
const plegada = (s: string): string => plegar(s).replace(/\s+/gu, ' ');
const compacta = (s: string): string => plegar(s).replace(/[^\p{L}\p{N}]/gu, '');
/** UTF-16LE de un texto (EMF, WMF, campos de formatos binarios). */
function utf16le(s: string): Uint8Array {
  const b = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); b[2 * i] = c & 0xff; b[2 * i + 1] = c >> 8; }
  return b;
}
function contieneBytes(h: Uint8Array, n: Uint8Array): boolean {
  if (n.length === 0 || n.length > h.length) return false;
  const primero = n[0];
  for (let i = h.indexOf(primero ?? 0); i >= 0 && i + n.length <= h.length; i = h.indexOf(primero ?? 0, i + 1)) {
    let k = 1;
    while (k < n.length && h[i + k] === n[k]) k++;
    if (k === n.length) return true;
  }
  return false;
}

function verificar(bytes: Uint8Array, entradas: EntradaSalida[], esperadas: Array<{ kind: string; texto: string }>, valores: string[],
  out: RenderedOutput, limits: IoLimits): void {
  let leido: DocumentModel;
  try {
    leido = readDocx(bytes, { docId: out.docId, label: 'Documento 1' }, limits);
  } catch {
    throw new SiglowError('ERROR_INTERNO');
  }
  const reales = leido.parts.filter((p) => p.kind !== 'comentario').map((p) => ({ kind: p.kind, texto: normalizarComparacion(p.text) }));
  const comparables = esperadas.filter((e) => e.texto !== '');
  const realesComparables = reales.filter((r) => r.texto !== '');
  if (realesComparables.length !== comparables.length) throw new SiglowError('ERROR_INTERNO');
  realesComparables.forEach((r, i) => {
    const e = comparables[i];
    if (e === undefined || e.kind !== r.kind || e.texto !== r.texto) throw new SiglowError('ERROR_INTERNO');
  });
  // Ningún valor reemplazado (de 4 o más caracteres) en ninguna entrada, salvo que siga a la vista en la salida (el abogado lo dejó
  // en otra aparición). M-120/M-121: también en sus formas plegada («pedro ejemplo gomez») y compacta («pedroejemplogomez», que
  // atrapa `Pedro_Ejemplo_Gomez` en un marcador, un estilo o un nombre de archivo), en los nombres de las entradas y, tal cual, en
  // UTF-8 y UTF-16LE dentro de los binarios. Los valores sin letras (números de documento, cuentas) se buscan solo en el texto
  // entre etiquetas: los identificadores hexadecimales de los atributos (`w:rsid*`, `w14:paraId`) darían falsas alarmas.
  const textoVisible = out.sections.map((s) => s.text).join('\n');
  const visiblePlegado = plegada(textoVisible);
  const visibleCompacto = compacta(textoVisible);
  const buscados = [...new Set(valores.map((v) => v.replace(/\s+/gu, ' ').trim()))]
    .map((v) => ({ crudo: v, plegado: plegada(v), compacto: compacta(v), letras: /\p{L}/u.test(v) }))
    .filter((v) => v.plegado.length >= 4 && !visiblePlegado.includes(v.plegado) && !visibleCompacto.includes(v.compacto));
  if (buscados.length === 0) return;
  const dec = new TextDecoder('utf-8', { fatal: false });
  const aparece = (texto: string, v: (typeof buscados)[number]): boolean => {
    const p = plegada(texto);
    const donde = v.letras ? p : p.replace(/<[^>]*>/gu, ' ');
    return donde.includes(v.plegado) || donde.includes(plegada(escapar(v.crudo))) ||
      (v.compacto.length >= 6 && compacta(donde).includes(v.compacto));
  };
  for (const e of entradas) {
    for (const v of buscados) if (aparece(e.nombre, v)) throw new SiglowError('ERROR_INTERNO');
    // Entradas que este módulo escribió o copió de un original ya leído con tope: se inflan sin tope.
    const crudo = e.metodo === 8 ? inflateSync(e.comprimido) : e.comprimido.slice();
    try {
      if (/\.(xml|rels)$/iu.test(e.nombre)) {
        const texto = dec.decode(crudo);
        for (const v of buscados) if (aparece(texto, v)) throw new SiglowError('ERROR_INTERNO');
      } else {
        for (const v of buscados) {
          if (contieneBytes(crudo, strToU8(v.crudo)) || contieneBytes(crudo, utf16le(v.crudo))) throw new SiglowError('ERROR_INTERNO');
        }
      }
    } finally {
      crudo.fill(0);
    }
  }
}


/**
 * Exporta y descarga el .docx fiel con nombre neutro (6.9). Síncrona: F3 la llama en el manejador del clic de «Descargar documento
 * (.docx)», detrás de la puerta, con el original de `originalDe(doc.id)`. Si lanza `FORMATO_NO_ADMITIDO`, se ofrece el .docx simple.
 */
export function exportarDocxFiel(original: Uint8Array, doc: DocumentModel, out: RenderedOutput, opciones: OpcionesExportacion = {}):
  ResultadoExportacion & { imagenes: number; vectorialesQuitadas: number } {
  const { bytes, avisos, imagenes, vectorialesQuitadas } = construirDocxFiel(original, doc, out);
  const nombre = nombreDescarga(opciones.clase ?? 'anonimizado', 'docx', opciones.ahora);
  descargarBytes(bytes, MIME_DOCX, nombre);
  return { nombre, bytes: bytes.length, avisos, imagenes, vectorialesQuitadas };
}
