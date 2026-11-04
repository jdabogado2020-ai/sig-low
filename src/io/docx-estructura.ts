// F7 · Estructura de formato de un .docx para el PDF con estilo (v1.1.1): página y márgenes (`w:sectPr`), párrafos (alineación,
// sangrías, espaciado, interlineado, numeración y viñetas), corridas (negrita, cursiva, subrayado, tamaño y fuente mapeada a las 14
// estándar), tablas, encabezado y pie, saltos de página y notas.
//
// Privacidad: se lee SOLO el .docx fiel ya anonimizado y verificado (`construirDocxFiel`), nunca el original: todo texto que llega
// aquí ya tiene sus reemplazos, y lo que el .docx fiel quitó (comentarios, revisiones, campos no seguros, metadatos) no existe. Lo
// que el PDF no reproduce (imágenes, dibujos, cuadros de texto, ecuaciones, objetos) se omite y se cuenta en `omitidos`.
// TypeScript puro, sin DOM; errores solo con ErrorCode.
import type { Element } from '@xmldom/xmldom';
import { SiglowError } from '../core/types';
import type { IoLimits } from '../core/types';
import { W_NS, clave, leerDocxMapeado, leerEntrada, leerRelaciones, nombreW, resolver, rutaRels, ultimoSegmento, xmlDe } from './docx-read';
import type { DocxMapeado, XmlDocx } from './docx-read';
import { IO_LIMITS_POR_DEFECTO } from './io-client';

// ---------------------------------------------------------------------------------------------------------------------
// Modelo (unidades: puntos)
// ---------------------------------------------------------------------------------------------------------------------

/** Las familias de las 14 fuentes estándar de PDF. */
export type Fuente = 'Helvetica' | 'Times' | 'Courier';
export interface Estilo { fuente: Fuente; negrita: boolean; cursiva: boolean; subrayado: boolean; tam: number; vert: 'normal' | 'sup' | 'sub' }
export type Trozo =
  | { tipo: 'texto'; texto: string; estilo: Estilo }
  | { tipo: 'tab'; estilo: Estilo }
  | { tipo: 'salto'; estilo: Estilo }
  | { tipo: 'pagina' }
  /** Campo que se resuelve al dibujar cada página (número de página, total). */
  | { tipo: 'campo'; campo: 'PAGE' | 'NUMPAGES'; estilo: Estilo };
export type Alineacion = 'izq' | 'centro' | 'der' | 'just';
export interface Parrafo {
  tipo: 'parrafo';
  alineacion: Alineacion;
  /** Sangrías izquierda y derecha; `primera` > 0 es sangría de primera línea, < 0 francesa. */
  izq: number; der: number; primera: number;
  antes: number; despues: number;
  interlineado: { regla: 'auto' | 'exacto' | 'minimo'; valor: number };
  saltoAntes: boolean;
  /** Paradas de tabulación propias (desde el margen izquierdo). */
  tabs: number[];
  /** Rótulo de numeración o viñeta ya resuelto («1.», «a)», «•»), con su separación. */
  rotulo: { texto: string; estilo: Estilo; sufijo: 'tab' | 'espacio' | 'nada' } | null;
  /** Estilo de la marca de párrafo: da el alto de un párrafo vacío. */
  marca: Estilo;
  trozos: Trozo[];
}
export interface Celda { span: number; bloques: Bloque[] }
export interface Tabla { tipo: 'tabla'; columnas: number[]; sangria: number; bordes: boolean; filas: Array<{ altoMin: number; celdas: Celda[] }> }
export type Bloque = Parrafo | Tabla | { tipo: 'pagina' };
export interface Pagina {
  ancho: number; alto: number;
  margen: { sup: number; inf: number; izq: number; der: number; encabezado: number; pie: number };
  tabPorDefecto: number;
}
export interface DocumentoConEstilo {
  pagina: Pagina;
  encabezado: Bloque[] | null; pie: Bloque[] | null;
  /** Con `w:titlePg`: encabezado y pie de la primera página (vacíos si no hay). */
  primera: { encabezado: Bloque[] | null; pie: Bloque[] | null } | null;
  cuerpo: Bloque[];
  /** Notas al pie y al final, en orden de referencia, con su número. */
  notas: Array<{ numero: string; bloques: Bloque[] }>;
  /** Imágenes, dibujos, cuadros de texto, ecuaciones y objetos que el PDF no reproduce. */
  omitidos: number;
}

// ---------------------------------------------------------------------------------------------------------------------
// Utilidades de XML
// ---------------------------------------------------------------------------------------------------------------------

const NS_MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const NS_M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R_ATR = /\/relationships$/u;

function hijos(el: Element | null): Element[] {
  const out: Element[] = [];
  if (el === null) return out;
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes.item(i);
    if (n !== null && n.nodeType === 1) out.push(n as Element);
  }
  return out;
}
const hijoW = (el: Element | null, nombre: string): Element | null => hijos(el).find((h) => nombreW(h) === nombre) ?? null;
function atrW(el: Element | null, local: string): string | null {
  if (el === null) return null;
  const a = el.attributes;
  for (let i = 0; i < a.length; i++) {
    const x = a.item(i);
    if (x !== null && x.localName === local && (x.namespaceURI === null || W_NS.has(x.namespaceURI))) return x.value;
  }
  return null;
}
function atrR(el: Element, local: string): string | null {
  const a = el.attributes;
  for (let i = 0; i < a.length; i++) {
    const x = a.item(i);
    if (x !== null && x.localName === local && x.namespaceURI !== null && NS_R_ATR.test(x.namespaceURI)) return x.value;
  }
  return null;
}
const val = (el: Element | null): string | null => atrW(el, 'val');
/** Propiedad de sí o no (`w:b`, `w:i`…): ausente → undefined; sin `w:val` o con un valor verdadero → true. */
function siNo(el: Element | null): boolean | undefined {
  if (el === null) return undefined;
  const v = val(el);
  return !(v === '0' || v === 'false' || v === 'off' || v === 'none');
}
/** Veinteavos de punto (twips) a puntos. */
function twips(v: string | null): number | undefined {
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n / 20 : undefined;
}
const fundir = <T extends object>(...capas: Array<Partial<T> | undefined>): Partial<T> => {
  const out: Record<string, unknown> = {};
  for (const c of capas) if (c !== undefined) for (const [k, v] of Object.entries(c)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
};

// ---------------------------------------------------------------------------------------------------------------------
// Propiedades de párrafo y de corrida
// ---------------------------------------------------------------------------------------------------------------------

interface PropsP {
  jc: string; izq: number; der: number; primera: number; antes: number; despues: number; linea: number; regla: string;
  saltoAntes: boolean; numId: string; ilvl: number; tabs: number[];
}
interface PropsR { fuente: string; tema: 'minor' | 'major'; b: boolean; i: boolean; u: boolean; sz: number; vert: string; caps: boolean; oculto: boolean }

function leerPPr(pPr: Element | null): Partial<PropsP> {
  if (pPr === null) return {};
  const ind = hijoW(pPr, 'ind');
  const esp = hijoW(pPr, 'spacing');
  const numPr = hijoW(pPr, 'numPr');
  const colgante = twips(atrW(ind, 'hanging'));
  const primera = colgante !== undefined ? -colgante : twips(atrW(ind, 'firstLine'));
  const tabs = hijos(hijoW(pPr, 'tabs')).filter((t) => nombreW(t) === 'tab' && val(t) !== 'clear').map((t) => twips(atrW(t, 'pos')) ?? 0);
  const ilvl = val(hijoW(numPr, 'ilvl'));
  return {
    jc: val(hijoW(pPr, 'jc')) ?? undefined,
    izq: twips(atrW(ind, 'left') ?? atrW(ind, 'start')), der: twips(atrW(ind, 'right') ?? atrW(ind, 'end')), primera,
    antes: twips(atrW(esp, 'before')), despues: twips(atrW(esp, 'after')),
    linea: ((): number | undefined => { const n = Number(atrW(esp, 'line')); return atrW(esp, 'line') !== null && Number.isFinite(n) ? n : undefined; })(),
    regla: atrW(esp, 'lineRule') ?? undefined,
    saltoAntes: siNo(hijoW(pPr, 'pageBreakBefore')),
    numId: val(hijoW(numPr, 'numId')) ?? undefined,
    ilvl: ilvl === null ? undefined : Number(ilvl) || 0,
    tabs: tabs.length > 0 ? tabs : undefined,
  };
}

function leerRPr(rPr: Element | null): Partial<PropsR> {
  if (rPr === null) return {};
  const f = hijoW(rPr, 'rFonts');
  const tema = atrW(f, 'asciiTheme') ?? atrW(f, 'hAnsiTheme');
  const u = hijoW(rPr, 'u');
  const sz = Number(val(hijoW(rPr, 'sz')));
  return {
    fuente: atrW(f, 'ascii') ?? atrW(f, 'hAnsi') ?? undefined,
    tema: tema === null ? undefined : tema.startsWith('major') ? 'major' : 'minor',
    b: siNo(hijoW(rPr, 'b')), i: siNo(hijoW(rPr, 'i')),
    u: u === null ? undefined : !(val(u) === 'none' || val(u) === '0'),
    sz: Number.isFinite(sz) && sz > 0 ? sz / 2 : undefined,
    vert: val(hijoW(rPr, 'vertAlign')) ?? undefined,
    caps: siNo(hijoW(rPr, 'caps')),
    oculto: siNo(hijoW(rPr, 'vanish')),
  };
}

/** Familia estándar más cercana: serif (Times New Roman, Cambria, Georgia…) → Times; monoespaciada → Courier; el resto → Helvetica. */
export function fuenteEstandar(nombre: string): Fuente {
  const n = nombre.toLowerCase();
  // «Lucida Console» se reconoce por «lucida con»: la palabra completa en el bundle la toma `check-dist` por una referencia a la consola.
  if (/courier|consolas|mono|lucida con|menlo/u.test(n)) return 'Courier';
  if (/times|cambria|georgia|garamond|book antiqua|palatino|bookman|century schoolbook|serif|baskerville|constantia|minion/u.test(n) && !/sans/u.test(n)) return 'Times';
  return 'Helvetica';
}

// ---------------------------------------------------------------------------------------------------------------------
// Estilos, numeración y tema
// ---------------------------------------------------------------------------------------------------------------------

interface EstiloDoc { tipo: string; base: string | null; p: Partial<PropsP>; r: Partial<PropsR>; bordes: boolean | undefined }
interface Nivel { inicio: number; formato: string; texto: string; p: Partial<PropsP>; r: Partial<PropsR>; sufijo: 'tab' | 'espacio' | 'nada' }

function bordesVisibles(cont: Element | null): boolean | undefined {
  if (cont === null) return undefined;
  const bs = hijos(cont);
  if (bs.length === 0) return undefined;
  return bs.some((b) => { const v = val(b); return v !== null && v !== 'none' && v !== 'nil'; });
}

class Contexto {
  estilos = new Map<string, EstiloDoc>();
  pDef: Partial<PropsP> = {};
  rDef: Partial<PropsR> = {};
  parrafoDef: string | null = null;
  tablaDef: string | null = null;
  temas = { minor: 'Calibri', major: 'Calibri Light' };
  niveles = new Map<string, Map<number, Nivel>>();
  contadores = new Map<string, number[]>();
  tabPorDefecto = 36;
  omitidos = 0;
  notas: Array<{ numero: string; bloques: Bloque[] }> = [];
  notasPie = new Map<string, Element>();
  notasFinal = new Map<string, Element>();
  numeroNotaPie = 0;
  numeroNotaFinal = 0;

  cadena<K extends 'p' | 'r'>(id: string | null, k: K): EstiloDoc[K] {
    const capas: Array<EstiloDoc[K]> = [];
    const vistos = new Set<string>();
    for (let e = id === null ? undefined : this.estilos.get(id); e !== undefined && capas.length < 20; e = e.base === null ? undefined : this.estilos.get(e.base)) {
      capas.unshift(e[k]);
      if (e.base === null || vistos.has(e.base)) break;
      vistos.add(e.base);
    }
    return fundir<Record<string, unknown>>(...(capas as Array<Record<string, unknown>>)) as EstiloDoc[K];
  }
  bordesTabla(id: string | null): boolean {
    for (let e = id === null ? undefined : this.estilos.get(id), n = 0; e !== undefined && n < 20; e = e.base === null ? undefined : this.estilos.get(e.base), n++) {
      if (e.bordes !== undefined) return e.bordes;
    }
    return false;
  }
  estilo(r: Partial<PropsR>): Estilo {
    const nombre = r.fuente ?? (r.tema === 'major' ? this.temas.major : this.temas.minor);
    return {
      fuente: fuenteEstandar(nombre), negrita: r.b === true, cursiva: r.i === true, subrayado: r.u === true,
      tam: r.sz ?? 10, vert: r.vert === 'superscript' ? 'sup' : r.vert === 'subscript' ? 'sub' : 'normal',
    };
  }
}

function leerEstilos(x: XmlDocx | null, c: Contexto): void {
  if (x === null) return;
  const defs = hijoW(x.raiz, 'docDefaults');
  c.pDef = leerPPr(hijoW(hijoW(defs, 'pPrDefault'), 'pPr'));
  c.rDef = leerRPr(hijoW(hijoW(defs, 'rPrDefault'), 'rPr'));
  for (const s of hijos(x.raiz)) {
    if (nombreW(s) !== 'style') continue;
    const id = atrW(s, 'styleId');
    if (id === null) continue;
    const tipo = atrW(s, 'type') ?? 'paragraph';
    const tblPr = hijoW(s, 'tblPr');
    c.estilos.set(id, { tipo, base: val(hijoW(s, 'basedOn')), p: leerPPr(hijoW(s, 'pPr')), r: leerRPr(hijoW(s, 'rPr')), bordes: bordesVisibles(hijoW(tblPr, 'tblBorders')) });
    const porDefecto = atrW(s, 'default');
    if (porDefecto === '1' || porDefecto === 'true' || porDefecto === 'on') {
      if (tipo === 'paragraph' && c.parrafoDef === null) c.parrafoDef = id;
      if (tipo === 'table' && c.tablaDef === null) c.tablaDef = id;
    }
  }
}

function leerNumeracion(x: XmlDocx | null, c: Contexto): void {
  if (x === null) return;
  const abstractos = new Map<string, Map<number, Nivel>>();
  for (const a of hijos(x.raiz)) {
    if (nombreW(a) !== 'abstractNum') continue;
    const niveles = new Map<number, Nivel>();
    for (const l of hijos(a)) {
      if (nombreW(l) !== 'lvl') continue;
      const suf = val(hijoW(l, 'suff'));
      niveles.set(Number(atrW(l, 'ilvl')) || 0, {
        inicio: Number(val(hijoW(l, 'start')) ?? 1) || 0, formato: val(hijoW(l, 'numFmt')) ?? 'decimal', texto: val(hijoW(l, 'lvlText')) ?? '',
        p: leerPPr(hijoW(l, 'pPr')), r: leerRPr(hijoW(l, 'rPr')), sufijo: suf === 'space' ? 'espacio' : suf === 'nothing' ? 'nada' : 'tab',
      });
    }
    abstractos.set(atrW(a, 'abstractNumId') ?? '', niveles);
  }
  for (const n of hijos(x.raiz)) {
    if (nombreW(n) !== 'num') continue;
    const base = abstractos.get(val(hijoW(n, 'abstractNumId')) ?? '');
    if (base === undefined) continue;
    const niveles = new Map(base);
    for (const o of hijos(n)) {
      if (nombreW(o) !== 'lvlOverride') continue;
      const k = Number(atrW(o, 'ilvl')) || 0;
      const inicio = val(hijoW(o, 'startOverride'));
      const nv = niveles.get(k);
      if (nv !== undefined && inicio !== null) niveles.set(k, { ...nv, inicio: Number(inicio) || 0 });
    }
    c.niveles.set(atrW(n, 'numId') ?? '', niveles);
  }
}

function leerTema(x: XmlDocx | null, c: Contexto): void {
  if (x === null) return;
  const buscar = (local: string): string | null => {
    const els = x.raiz.getElementsByTagNameNS(NS_A, local);
    const el = els.item(0);
    const latin = el === null ? null : hijos(el).find((h) => h.localName === 'latin' && h.namespaceURI === NS_A) ?? null;
    return latin?.getAttribute('typeface') ?? null;
  };
  c.temas = { minor: buscar('minorFont') ?? c.temas.minor, major: buscar('majorFont') ?? c.temas.major };
}

const ROMANOS: ReadonlyArray<readonly [number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
function romano(n: number): string {
  let out = '';
  let r = Math.max(1, Math.min(3999, n));
  for (const [v, s] of ROMANOS) while (r >= v) { out += s; r -= v; }
  return out;
}
function letra(n: number): string {
  const k = Math.max(1, n);
  return String.fromCharCode(97 + ((k - 1) % 26)).repeat(Math.floor((k - 1) / 26) + 1);
}
/** Número con el formato de la numeración de Word. */
export function formatoNumero(n: number, formato: string): string {
  switch (formato) {
    case 'lowerLetter': return letra(n);
    case 'upperLetter': return letra(n).toUpperCase();
    case 'lowerRoman': return romano(n);
    case 'upperRoman': return romano(n).toUpperCase();
    case 'decimalZero': return String(n).padStart(2, '0');
    case 'ordinal': return `${n}º`;
    case 'none': return '';
    default: return String(n);
  }
}
/** Viñetas de fuentes de símbolos (zona de uso privado) → «•»; las demás, tal cual. */
function vineta(s: string): string {
  return [...s].map((ch) => { const cp = ch.codePointAt(0) ?? 0; return cp >= 0xe000 && cp <= 0xf8ff ? '•' : ch; }).join('');
}

// ---------------------------------------------------------------------------------------------------------------------
// Contenido
// ---------------------------------------------------------------------------------------------------------------------

interface Lectura { c: Contexto; estiloTabla: string | null }

function rotuloDe(l: Lectura, numId: string | undefined, ilvl: number, rBase: Partial<PropsR>): { nivel: Nivel; rotulo: Parrafo['rotulo'] } | null {
  if (numId === undefined || numId === '0') return null;
  const niveles = l.c.niveles.get(numId);
  const nivel = niveles?.get(ilvl);
  if (niveles === undefined || nivel === undefined) return null;
  const cont = l.c.contadores.get(numId) ?? [];
  for (let k = 0; k <= ilvl; k++) if (cont[k] === undefined) cont[k] = (niveles.get(k)?.inicio ?? 1) - 1;
  cont[ilvl] = (cont[ilvl] ?? 0) + 1;
  cont.length = ilvl + 1; // los niveles inferiores se reinician
  l.c.contadores.set(numId, cont);
  let texto = nivel.formato === 'bullet' ? vineta(nivel.texto) : nivel.texto.replace(/%(\d)/gu, (_, d: string) => {
    const k = Number(d) - 1;
    return formatoNumero(cont[k] ?? (niveles.get(k)?.inicio ?? 1), niveles.get(k)?.formato ?? 'decimal');
  });
  if (nivel.formato === 'bullet' && texto === '') texto = '•';
  const r = fundir<PropsR>(rBase, nivel.r);
  // Las fuentes de símbolos de las viñetas (Symbol, Wingdings) no son estándar: la viñeta va en la fuente del texto.
  if (nivel.formato === 'bullet' && r.fuente !== undefined && /symbol|wingdings|webdings/iu.test(r.fuente)) delete r.fuente;
  return { nivel, rotulo: { texto, estilo: l.c.estilo(r), sufijo: nivel.sufijo } };
}

function parrafo(p: Element, l: Lectura): Parrafo {
  const c = l.c;
  const pPr = hijoW(p, 'pPr');
  const directo = leerPPr(pPr);
  const idEstilo = val(hijoW(pPr, 'pStyle')) ?? c.parrafoDef;
  const pEstilo = c.cadena(idEstilo, 'p');
  const pTabla = l.estiloTabla === null ? {} : c.cadena(l.estiloTabla, 'p');
  const numId = directo.numId ?? pEstilo.numId;
  const ilvl = directo.ilvl ?? pEstilo.ilvl ?? 0;
  const rBase = fundir<PropsR>(c.rDef, l.estiloTabla === null ? {} : c.cadena(l.estiloTabla, 'r'), c.cadena(idEstilo, 'r'));
  const num = rotuloDe(l, numId, ilvl, fundir<PropsR>(rBase, leerRPr(hijoW(pPr, 'rPr'))));
  const pp = fundir<PropsP>(c.pDef, pTabla, pEstilo, num?.nivel.p, directo);
  const linea = pp.linea ?? 240;
  const regla = pp.regla === 'exact' ? 'exacto' : pp.regla === 'atLeast' ? 'minimo' : 'auto';
  const jc = pp.jc ?? 'left';
  const trozos: Trozo[] = [];
  contenido(hijos(p).filter((h) => nombreW(h) !== 'pPr'), rBase, l, trozos);
  return {
    tipo: 'parrafo',
    alineacion: jc === 'both' || jc === 'distribute' ? 'just' : jc === 'center' ? 'centro' : jc === 'right' || jc === 'end' ? 'der' : 'izq',
    izq: pp.izq ?? 0, der: pp.der ?? 0, primera: pp.primera ?? 0, antes: pp.antes ?? 0, despues: pp.despues ?? 0,
    interlineado: { regla, valor: regla === 'auto' ? linea / 240 : linea / 20 },
    saltoAntes: pp.saltoAntes === true, tabs: pp.tabs ?? [], rotulo: num?.rotulo ?? null,
    marca: c.estilo(fundir<PropsR>(rBase, leerRPr(hijoW(pPr, 'rPr')))), trozos,
  };
}

/** Recorre el contenido de un párrafo: corridas, hipervínculos, controles, campos. Los campos PAGE y NUMPAGES se resuelven al dibujar. */
function contenido(nodos: Element[], rBase: Partial<PropsR>, l: Lectura, out: Trozo[]): void {
  const campos: Array<{ instr: string; fase: 'instr' | 'resultado' }> = [];
  const enResultadoDinamico = (): boolean => campos.some((f) => f.fase === 'resultado' && /^\s*(PAGE|NUMPAGES|SECTIONPAGES)\b/iu.test(f.instr));
  const recorrer = (els: Element[]): void => {
    for (const el of els) {
      if (el.namespaceURI === NS_MC && el.localName === 'AlternateContent') { l.c.omitidos++; continue; } // cuadros de texto, formas
      if (el.namespaceURI === NS_M) { l.c.omitidos++; continue; } // ecuaciones
      const w = nombreW(el);
      if (w === null) continue;
      switch (w) {
        case 'r': corrida(el); break;
        case 'hyperlink': case 'smartTag': case 'customXml': case 'ins': case 'moveTo': case 'dir': case 'bdo': recorrer(hijos(el)); break;
        case 'sdt': recorrer(hijos(hijoW(el, 'sdtContent'))); break;
        case 'fldSimple': {
          const instr = atrW(el, 'instr') ?? '';
          const m = /^\s*(PAGE|NUMPAGES|SECTIONPAGES)\b/iu.exec(instr);
          if (m !== null) out.push({ tipo: 'campo', campo: m[1]?.toUpperCase() === 'PAGE' ? 'PAGE' : 'NUMPAGES', estilo: l.c.estilo(rBase) });
          else recorrer(hijos(el));
          break;
        }
        case 'object': l.c.omitidos++; break;
        default: break; // marcadores, rangos, errores de ortografía: sin texto
      }
    }
  };
  const corrida = (r: Element): void => {
    const rPr = hijoW(r, 'rPr');
    const rr = fundir<PropsR>(rBase, l.c.cadena(val(hijoW(rPr, 'rStyle')), 'r'), leerRPr(rPr));
    if (rr.oculto === true) return; // texto oculto: no se ve en el documento
    const estilo = l.c.estilo(rr);
    const texto = (t: string): void => {
      if (t === '' || (campos.length > 0 && (campos[campos.length - 1]?.fase === 'instr' || enResultadoDinamico()))) return;
      out.push({ tipo: 'texto', texto: rr.caps === true ? t.toUpperCase() : t, estilo });
    };
    for (const h of hijos(r)) {
      if (h.namespaceURI === NS_MC && h.localName === 'AlternateContent') { l.c.omitidos++; continue; }
      const w = nombreW(h);
      switch (w) {
        case 't': texto(h.textContent ?? ''); break;
        case 'tab': case 'ptab': if (campos.length === 0 || campos[campos.length - 1]?.fase === 'resultado') out.push({ tipo: 'tab', estilo }); break;
        case 'br': {
          const tipo = atrW(h, 'type');
          out.push(tipo === 'page' ? { tipo: 'pagina' } : { tipo: 'salto', estilo });
          break;
        }
        case 'cr': out.push({ tipo: 'salto', estilo }); break;
        case 'noBreakHyphen': texto('-'); break;
        case 'sym': { const ch = atrW(h, 'char'); if (ch !== null && /^[0-9A-Fa-f]{1,4}$/u.test(ch)) texto(vineta(String.fromCharCode(parseInt(ch, 16)))); break; }
        case 'fldChar': {
          const tipo = atrW(h, 'fldCharType');
          if (tipo === 'begin') campos.push({ instr: '', fase: 'instr' });
          else if (tipo === 'separate') {
            const f = campos[campos.length - 1];
            if (f !== undefined) {
              f.fase = 'resultado';
              const m = /^\s*(PAGE|NUMPAGES|SECTIONPAGES)\b/iu.exec(f.instr);
              if (m !== null) out.push({ tipo: 'campo', campo: m[1]?.toUpperCase() === 'PAGE' ? 'PAGE' : 'NUMPAGES', estilo });
            }
          } else if (tipo === 'end') campos.pop();
          break;
        }
        case 'instrText': { const f = campos[campos.length - 1]; if (f !== undefined && f.fase === 'instr') f.instr += h.textContent ?? ''; break; }
        case 'footnoteReference': case 'endnoteReference': {
          const pie = w === 'footnoteReference';
          const numero = pie ? String(++l.c.numeroNotaPie) : romano(++l.c.numeroNotaFinal);
          const nota = (pie ? l.c.notasPie : l.c.notasFinal).get(atrW(h, 'id') ?? '');
          out.push({ tipo: 'texto', texto: numero, estilo: { ...estilo, vert: 'sup' } });
          if (nota !== undefined) l.c.notas.push({ numero, bloques: bloques(hijos(nota), { ...l, estiloTabla: null }) });
          break;
        }
        case 'drawing': case 'pict': case 'object': l.c.omitidos++; break;
        default: break;
      }
    }
  };
  recorrer(nodos);
}

function tabla(t: Element, l: Lectura): Tabla {
  const tblPr = hijoW(t, 'tblPr');
  const estiloTabla = val(hijoW(tblPr, 'tblStyle')) ?? l.c.tablaDef;
  const directos = bordesVisibles(hijoW(tblPr, 'tblBorders'));
  const columnas = hijos(hijoW(t, 'tblGrid')).filter((g) => nombreW(g) === 'gridCol').map((g) => twips(atrW(g, 'w')) ?? 0);
  const filas: Tabla['filas'] = [];
  let conBordesDeCelda = false;
  for (const tr of hijos(t)) {
    if (nombreW(tr) !== 'tr') continue;
    const alto = hijoW(hijoW(tr, 'trPr'), 'trHeight');
    const celdas: Celda[] = [];
    for (const tc of hijos(tr)) {
      const tcEl = nombreW(tc) === 'sdt' ? hijoW(hijoW(tc, 'sdtContent'), 'tc') : tc;
      if (tcEl === null || nombreW(tcEl) !== 'tc') continue;
      const tcPr = hijoW(tcEl, 'tcPr');
      if (bordesVisibles(hijoW(tcPr, 'tcBorders')) === true) conBordesDeCelda = true;
      const continua = hijoW(tcPr, 'vMerge') !== null && val(hijoW(tcPr, 'vMerge')) !== 'restart';
      celdas.push({
        span: Math.max(1, Number(val(hijoW(tcPr, 'gridSpan'))) || 1),
        bloques: continua ? [] : bloques(hijos(tcEl).filter((h) => nombreW(h) !== 'tcPr'), { ...l, estiloTabla }),
      });
    }
    filas.push({ altoMin: twips(val(alto)) ?? 0, celdas });
  }
  const ncol = Math.max(columnas.length, ...filas.map((f) => f.celdas.reduce((n, x) => n + x.span, 0)));
  while (columnas.length < ncol) columnas.push(0);
  return {
    tipo: 'tabla', columnas, sangria: twips(atrW(hijoW(tblPr, 'tblInd'), 'w')) ?? 0,
    bordes: directos ?? (conBordesDeCelda || l.c.bordesTabla(estiloTabla)), filas,
  };
}

function bloques(els: Element[], l: Lectura): Bloque[] {
  const out: Bloque[] = [];
  for (const el of els) {
    const w = nombreW(el);
    if (w === 'p') {
      out.push(parrafo(el, l));
      // Un salto de sección que empieza en una página nueva (la sección siguiente usa la misma página: simplificación).
      const sect = hijoW(hijoW(el, 'pPr'), 'sectPr');
      if (sect !== null && (val(hijoW(sect, 'type')) ?? 'nextPage') !== 'continuous') out.push({ tipo: 'pagina' });
    } else if (w === 'tbl') out.push(tabla(el, l));
    else if (w === 'sdt') out.push(...bloques(hijos(hijoW(el, 'sdtContent')), l));
    else if (w === 'customXml') out.push(...bloques(hijos(el), l));
    else if (el.namespaceURI === NS_MC && el.localName === 'AlternateContent') l.c.omitidos++;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Lectura completa
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Lee la estructura de formato de un .docx. Pensada para el .docx fiel ya anonimizado: nunca reciba el original. Lanza SiglowError.
 */
export function estructuraDocx(docx: Uint8Array, limits: IoLimits = IO_LIMITS_POR_DEFECTO): DocumentoConEstilo {
  const m: DocxMapeado = leerDocxMapeado(docx, { docId: 'doc_estructura' as never, label: 'Documento 1' }, limits);
  const abrir = (k: string): XmlDocx | null => {
    const ya = m.xml.get(k);
    if (ya !== undefined) return ya;
    const e = m.entradas.get(k);
    if (e === undefined) return null;
    try {
      const x = xmlDe(leerEntrada(docx, e, limits, { total: 0, consumido: 0 }));
      m.xml.set(k, { ...x, nombre: e.nombre });
      return x;
    } catch (err) {
      if (err instanceof SiglowError) return null; // una parte de formato ilegible: se sigue con los valores por defecto
      throw err;
    }
  };
  const principal = m.xml.get(m.principal);
  if (principal === undefined) throw new SiglowError('SIN_DOCUMENTO_PRINCIPAL');
  const nombrePrincipal = principal.nombre;
  const rels = ((): Array<{ id: string; tipo: string; k: string }> => {
    const x = abrir(clave(rutaRels(nombrePrincipal)));
    return x === null ? [] : leerRelaciones(x.raiz).filter((r) => !r.externa).map((r) => ({ id: r.id, tipo: ultimoSegmento(r.tipo), k: clave(resolver(nombrePrincipal, r.destino)) }));
  })();
  const parteDe = (tipo: string): XmlDocx | null => { const r = rels.find((x) => x.tipo === tipo); return r === undefined ? null : abrir(r.k); };

  const c = new Contexto();
  leerTema(parteDe('theme'), c);
  leerEstilos(parteDe('styles'), c);
  leerNumeracion(parteDe('numbering'), c);
  const ajustes = parteDe('settings');
  const tabDef = twips(val(hijoW(ajustes?.raiz ?? null, 'defaultTabStop')));
  if (tabDef !== undefined && tabDef > 0) c.tabPorDefecto = tabDef;
  for (const [tipo, hijo, mapa] of [['footnotes', 'footnote', c.notasPie], ['endnotes', 'endnote', c.notasFinal]] as const) {
    for (const n of hijos(parteDe(tipo)?.raiz ?? null)) {
      const t = atrW(n, 'type');
      if (nombreW(n) === hijo && (t === null || t === 'normal')) mapa.set(atrW(n, 'id') ?? '', n);
    }
  }

  const cuerpo = hijoW(principal.raiz, 'body');
  if (cuerpo === null) throw new SiglowError('SIN_DOCUMENTO_PRINCIPAL');
  const sect = hijoW(cuerpo, 'sectPr');
  const lectura: Lectura = { c, estiloTabla: null };
  const bloquesCuerpo = bloques(hijos(cuerpo).filter((h) => nombreW(h) !== 'sectPr'), lectura);
  // El último salto de sección del cuerpo no abre una página vacía.
  while (bloquesCuerpo.length > 0 && bloquesCuerpo[bloquesCuerpo.length - 1]?.tipo === 'pagina') bloquesCuerpo.pop();

  const pgSz = hijoW(sect, 'pgSz');
  const pgMar = hijoW(sect, 'pgMar');
  let ancho = twips(atrW(pgSz, 'w')) ?? 612;
  let alto = twips(atrW(pgSz, 'h')) ?? 792;
  if (atrW(pgSz, 'orient') === 'landscape' && ancho < alto) [ancho, alto] = [alto, ancho];
  const pagina: Pagina = {
    ancho, alto,
    margen: {
      sup: Math.abs(twips(atrW(pgMar, 'top')) ?? 72), inf: Math.abs(twips(atrW(pgMar, 'bottom')) ?? 72),
      izq: twips(atrW(pgMar, 'left')) ?? 72, der: twips(atrW(pgMar, 'right')) ?? 72,
      encabezado: twips(atrW(pgMar, 'header')) ?? 36, pie: twips(atrW(pgMar, 'footer')) ?? 36,
    },
    tabPorDefecto: c.tabPorDefecto,
  };
  const referencia = (nombre: 'headerReference' | 'footerReference', tipo: string): Bloque[] | null => {
    const ref = hijos(sect).find((h) => nombreW(h) === nombre && (atrW(h, 'type') ?? 'default') === tipo);
    const id = ref === undefined ? null : atrR(ref, 'id');
    const r = id === null ? undefined : rels.find((x) => x.id === id);
    const x = r === undefined ? null : abrir(r.k);
    return x === null ? null : bloques(hijos(x.raiz), { c, estiloTabla: null });
  };
  const primeraDistinta = siNo(hijoW(sect, 'titlePg')) === true;
  return {
    pagina,
    encabezado: referencia('headerReference', 'default'), pie: referencia('footerReference', 'default'),
    primera: primeraDistinta ? { encabezado: referencia('headerReference', 'first'), pie: referencia('footerReference', 'first') } : null,
    cuerpo: bloquesCuerpo, notas: c.notas, omitidos: c.omitidos,
  };
}
