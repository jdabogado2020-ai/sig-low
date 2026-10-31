// Lector de .docx (PE-2; 3.5, 6.1.1, 6.3, 6.11.4). Un .docx es un ZIP: se lee el directorio central, se descomprimen
// solo las partes XML que hacen falta (por relaciones), con tope sobre los bytes REALES (nunca la cabecera) y se recorre
// el XML para sacar el texto canónico de cada parte. TypeScript puro: corre igual en el worker `io` y en las pruebas.
//
// Reglas de privacidad que cumple (9.1): sin consola (xmldom con `onError` silencioso), ningún `message` ni `stack` sale de
// aquí (solo SiglowError con ErrorCode), el nombre del archivo no se lee, los ids son aleatorios y las etiquetas son neutras.
// El inventario de metadatos y los avisos de PE-3 (campos, texto oculto, marcas de agua, altChunk, Strict) NO están aquí.
import { Inflate } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
import type { Element, Node } from '@xmldom/xmldom';
import { SiglowError } from '../core/types';
import type { DocumentModel, IoLimits, ParseWarning, Part, PartId, PartKind } from '../core/types';
import { randomIds } from './txt-read';
import type { ReadCtx } from './txt-read';

// ---------------------------------------------------------------------------------------------------------------------
// ZIP: directorio central, descompresión acotada y CRC
// ---------------------------------------------------------------------------------------------------------------------

interface EntradaZip { nombre: string; flags: number; metodo: number; crc: number; sc: number; su: number; offset: number; }

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCALIZADOR = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const SATURADO = 0xffffffff;
/** Se alimenta fflate de a 16 KiB de comprimido: la expansión máxima por paso (≈ 1032×) queda en ≈ 16 MiB. */
const PASO_COMPRIMIDO = 16 * 1024;

const u16 = (d: Uint8Array, p: number): number => (d[p] ?? 0) | ((d[p + 1] ?? 0) << 8);
const u32 = (d: Uint8Array, p: number): number => ((d[p] ?? 0) | ((d[p + 1] ?? 0) << 8) | ((d[p + 2] ?? 0) << 16) | ((d[p + 3] ?? 0) << 24)) >>> 0;
const u64 = (d: Uint8Array, p: number): number => u32(d, p) + u32(d, p + 4) * 4294967296;

function empieza(b: Uint8Array, ...firma: number[]): boolean {
  return b.length >= firma.length && firma.every((x, i) => b[i] === x);
}

const TABLA_CRC: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(d: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = (TABLA_CRC[(c ^ (d[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Lee el directorio central. Toda lectura está acotada: un ZIP64 malformado no puede entrar en un bucle (V-41). */
function leerDirectorio(d: Uint8Array, limits: IoLimits): EntradaZip[] {
  if (d.length < 22) throw new SiglowError('ZIP_INVALIDO');
  const min = Math.max(0, d.length - 22 - 65535);
  let e = d.length - 22;
  while (e >= min && u32(d, e) !== SIG_EOCD) e--;
  if (e < min) throw new SiglowError('ZIP_INVALIDO');

  let cuenta = u16(d, e + 10);
  let p = u32(d, e + 16);
  if (cuenta === 0xffff || p === SATURADO) {
    if (e < 20 || u32(d, e - 20) !== SIG_EOCD64_LOCALIZADOR) throw new SiglowError('ZIP_INVALIDO');
    const z = u64(d, e - 12);
    if (!Number.isSafeInteger(z) || z + 56 > d.length || u32(d, z) !== SIG_EOCD64) throw new SiglowError('ZIP_INVALIDO');
    cuenta = u64(d, z + 32);
    p = u64(d, z + 48);
  }
  if (cuenta > limits.maxZipEntries) throw new SiglowError('DEMASIADAS_ENTRADAS');

  const entradas: EntradaZip[] = [];
  for (let i = 0; i < cuenta; i++) {
    if (!Number.isSafeInteger(p) || p + 46 > d.length || u32(d, p) !== SIG_CENTRAL) throw new SiglowError('ZIP_INVALIDO');
    const flags = u16(d, p + 8);
    const metodo = u16(d, p + 10);
    const crc = u32(d, p + 16);
    let sc = u32(d, p + 20);
    let su = u32(d, p + 24);
    const nl = u16(d, p + 28);
    const el = u16(d, p + 30);
    const cl = u16(d, p + 32);
    let offset = u32(d, p + 42);
    const iniExtra = p + 46 + nl;
    const finExtra = iniExtra + el;
    const fin = finExtra + cl;
    if (fin > d.length) throw new SiglowError('ZIP_INVALIDO');
    if (su === SATURADO || sc === SATURADO || offset === SATURADO) {
      // Campo extra 0x0001 (ZIP64): cada bloque avanza al menos 4 bytes y debe caber en el campo extra.
      let q = iniExtra;
      let hallado = false;
      while (q + 4 <= finExtra) {
        const id = u16(d, q);
        const tam = u16(d, q + 2);
        const cuerpo = q + 4;
        if (cuerpo + tam > finExtra) throw new SiglowError('ZIP_INVALIDO');
        if (id === 1) {
          let r = cuerpo;
          const fin64 = cuerpo + tam;
          if (su === SATURADO) { if (r + 8 > fin64) throw new SiglowError('ZIP_INVALIDO'); su = u64(d, r); r += 8; }
          if (sc === SATURADO) { if (r + 8 > fin64) throw new SiglowError('ZIP_INVALIDO'); sc = u64(d, r); r += 8; }
          if (offset === SATURADO) { if (r + 8 > fin64) throw new SiglowError('ZIP_INVALIDO'); offset = u64(d, r); r += 8; }
          hallado = true;
        }
        q = cuerpo + tam;
      }
      if (!hallado) throw new SiglowError('ZIP_INVALIDO');
    }
    const nombre = new TextDecoder(flags & 0x800 ? 'utf-8' : 'windows-1252').decode(d.subarray(p + 46, p + 46 + nl));
    entradas.push({ nombre, flags, metodo, crc, sc, su, offset });
    p = fin;
  }
  return entradas;
}

/** Descomprime con tope sobre los bytes reales: pasa de `su` (lo declarado) en cuanto se detecta → PARTE_TRUNCADA. */
function inflar(comp: Uint8Array, su: number): Uint8Array {
  const trozos: Uint8Array[] = [];
  let n = 0;
  const inf = new Inflate((c) => { trozos.push(c); n += c.length; });
  try {
    let i = 0;
    do {
      const fin = Math.min(comp.length, i + PASO_COMPRIMIDO);
      inf.push(comp.subarray(i, fin), fin === comp.length);
      if (n > su) throw new SiglowError('PARTE_TRUNCADA');
      i = fin;
    } while (i < comp.length);
  } catch (e) {
    if (e instanceof SiglowError || e instanceof RangeError) throw e;
    // fflate: código 0 = fin inesperado de datos; el resto, flujo deflate inválido.
    const codigo = (e as { code?: unknown } | null)?.code;
    throw new SiglowError(codigo === 0 ? 'PARTE_TRUNCADA' : 'ZIP_INVALIDO');
  }
  if (trozos.length === 1) return trozos[0] ?? new Uint8Array(0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const t of trozos) { out.set(t, o); o += t.length; }
  return out;
}

interface Acumulado { total: number; consumido: number; }

/** Lee una entrada XML. Los topes se aplican antes (cabecera) y durante (bytes reales); el CRC cierra la comprobación. */
function leerEntrada(d: Uint8Array, e: EntradaZip, limits: IoLimits, acum: Acumulado): Uint8Array {
  if (e.flags & 1) throw new SiglowError('ZIP_INVALIDO'); // cifrado
  if (e.su > limits.maxXmlPartBytes) throw new SiglowError('PARTE_XML_EXCEDE_LIMITE');
  if (acum.total + e.su > limits.maxUncompressedTotal) throw new SiglowError('DESCOMPRIMIDO_EXCEDE_LIMITE');
  if (!Number.isSafeInteger(e.offset) || e.offset + 30 > d.length || u32(d, e.offset) !== SIG_LOCAL) throw new SiglowError('ZIP_INVALIDO');
  const ini = e.offset + 30 + u16(d, e.offset + 26) + u16(d, e.offset + 28);
  if (!Number.isSafeInteger(e.sc) || ini + e.sc > d.length) throw new SiglowError('PARTE_TRUNCADA');
  const comp = d.subarray(ini, ini + e.sc);
  let out: Uint8Array;
  if (e.metodo === 0) {
    if (e.sc !== e.su) throw new SiglowError('PARTE_TRUNCADA');
    out = comp.slice();
  } else if (e.metodo === 8) {
    out = inflar(comp, e.su);
  } else {
    throw new SiglowError('ZIP_INVALIDO');
  }
  if (out.length !== e.su || crc32(out) !== e.crc) throw new SiglowError('PARTE_TRUNCADA');
  acum.total += out.length;
  if (acum.total > limits.maxUncompressedTotal) throw new SiglowError('DESCOMPRIMIDO_EXCEDE_LIMITE');
  acum.consumido += e.sc;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// XML: decodificación según BOM o declaración ANTES de buscar <!DOCTYPE, y análisis sin consola
// ---------------------------------------------------------------------------------------------------------------------

/** Decodifica una parte XML por su BOM, por el patrón de NUL (UTF-16 sin BOM) o por su declaración `encoding`. */
export function decodificarXml(b: Uint8Array): string {
  let enc: string;
  let salto = 0;
  if (empieza(b, 0xef, 0xbb, 0xbf)) { enc = 'utf-8'; salto = 3; }
  else if (empieza(b, 0xff, 0xfe, 0x00, 0x00) || empieza(b, 0x00, 0x00, 0xfe, 0xff)) throw new SiglowError('XML_INVALIDO'); // UTF-32
  else if (empieza(b, 0xff, 0xfe)) { enc = 'utf-16le'; salto = 2; }
  else if (empieza(b, 0xfe, 0xff)) { enc = 'utf-16be'; salto = 2; }
  else {
    // Sin BOM: un XML en UTF-8 o ASCII nunca lleva NUL; con NUL en la cabecera se trata como UTF-16 (también evita evadir el filtro).
    const n = Math.min(b.length, 256);
    let pares = 0;
    let impares = 0;
    for (let i = 0; i < n; i++) if (b[i] === 0) { if (i % 2 === 0) pares++; else impares++; }
    if (pares + impares > 0) {
      if (impares >= pares) enc = 'utf-16le'; else enc = 'utf-16be';
      if (Math.min(pares, impares) > 0 && Math.max(pares, impares) < 2 * Math.min(pares, impares)) throw new SiglowError('XML_INVALIDO'); // UTF-32 o mezcla
    } else {
      const cab = new TextDecoder('windows-1252').decode(b.subarray(0, 256));
      const m = /^\s*<\?xml[^>]*?\sencoding\s*=\s*["']([A-Za-z0-9._:-]+)["']/.exec(cab);
      enc = m?.[1] !== undefined ? m[1].toLowerCase() : 'utf-8';
      if (enc === 'utf-16' || enc === 'utf-32' || enc === 'ucs-2' || enc === 'ucs-4') throw new SiglowError('XML_INVALIDO'); // declara lo que los bytes no son
    }
  }
  let texto: string;
  try {
    texto = new TextDecoder(enc, { fatal: true, ignoreBOM: true }).decode(salto ? b.subarray(salto) : b);
  } catch {
    throw new SiglowError('XML_INVALIDO'); // codificación desconocida o bytes inválidos
  }
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

/** Rechaza cualquier DTD (V-41): entidades, «billion laughs». Se busca en el texto ya decodificado. */
function rechazarDtd(texto: string): void {
  if (/<!DOCTYPE/i.test(texto) || /<!ENTITY/i.test(texto)) throw new SiglowError('DTD_NO_PERMITIDA');
}

/** Analiza el XML. `onError` silencioso (V-20): xmldom no imprime nada y su `message` (con nombres de etiquetas) se descarta. */
function analizarXml(texto: string): Element {
  let invalido = false;
  const parser = new DOMParser({ onError: (nivel: string) => { if (nivel !== 'warning') invalido = true; } });
  let raiz: Element | null;
  try {
    raiz = parser.parseFromString(texto, 'text/xml').documentElement;
  } catch (e) {
    if (e instanceof RangeError) throw e;
    throw new SiglowError('XML_INVALIDO');
  }
  if (invalido || raiz === null) throw new SiglowError('XML_INVALIDO');
  return raiz;
}

/** Decodifica, rechaza DTD y analiza. Pone en cero el buffer descomprimido al terminar. */
function xmlDe(bytes: Uint8Array): Element {
  try {
    const texto = decodificarXml(bytes);
    rechazarDtd(texto);
    return analizarXml(texto);
  } finally {
    bytes.fill(0);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Relaciones y localización de partes
// ---------------------------------------------------------------------------------------------------------------------

interface Relacion { id: string; tipo: string; destino: string; }

const clave = (nombre: string): string => nombre.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();

/** Resuelve `destino` (relativo a la parte `origen`, o absoluto con «/») a un nombre de entrada del ZIP. */
function resolver(origen: string, destino: string): string {
  let t = destino.replace(/\\/g, '/');
  try { t = decodeURIComponent(t); } catch { /* se deja tal cual */ }
  const segmentos = t.startsWith('/') ? [] : origen.replace(/\\/g, '/').split('/').slice(0, -1);
  for (const s of t.split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') segmentos.pop();
    else segmentos.push(s);
  }
  return segmentos.join('/');
}

function rutaRels(parte: string): string {
  const i = parte.lastIndexOf('/');
  return (i < 0 ? '' : parte.slice(0, i + 1)) + '_rels/' + parte.slice(i + 1) + '.rels';
}

const ultimoSegmento = (tipo: string): string => tipo.slice(tipo.lastIndexOf('/') + 1);

interface Marco { nodos: { readonly length: number; item(i: number): Node | null }; i: number; cierra: (() => void) | null; }

/** Recorrido iterativo en preorden (la profundidad del XML no consume pila). */
function recorrer(raiz: Element, visita: (el: Element) => void): void {
  const pila: Marco[] = [{ nodos: raiz.childNodes, i: 0, cierra: null }];
  for (let m = pila[pila.length - 1]; m !== undefined; m = pila[pila.length - 1]) {
    if (m.i >= m.nodos.length) { pila.pop(); continue; }
    const n = m.nodos.item(m.i++);
    if (n === null || n.nodeType !== 1) continue;
    visita(n as Element);
    pila.push({ nodos: n.childNodes, i: 0, cierra: null });
  }
}

function leerRelaciones(raiz: Element): Relacion[] {
  const out: Relacion[] = [];
  const hijos = raiz.childNodes;
  for (let i = 0; i < hijos.length; i++) {
    const n = hijos.item(i);
    if (n === null || n.nodeType !== 1 || n.localName !== 'Relationship') continue;
    const el = n as Element;
    if ((el.getAttribute('TargetMode') ?? '').toLowerCase() === 'external') continue;
    const destino = el.getAttribute('Target');
    if (destino === null || destino === '') continue;
    out.push({ id: el.getAttribute('Id') ?? '', tipo: el.getAttribute('Type') ?? '', destino });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// WordprocessingML: texto canónico de cada parte (6.1.1)
// ---------------------------------------------------------------------------------------------------------------------

const W_NS: ReadonlySet<string> = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main', // OOXML Strict: se lee igual; el aviso es de PE-3
]);
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** Subárboles sin texto del documento (propiedades) o excluidos (cambios eliminados, códigos de campo). */
const SIN_TEXTO: ReadonlySet<string> = new Set([
  'pPr', 'rPr', 'sectPr', 'tblPr', 'tblGrid', 'tblPrEx', 'trPr', 'tcPr', 'sdtPr', 'sdtEndPr',
  'instrText', 'delText', 'delInstrText',
]);
const ELIMINADOS: ReadonlySet<string> = new Set(['del', 'moveFrom']);

const nombreW = (n: Node): string | null => (n.nodeType === 1 && n.namespaceURI !== null && W_NS.has(n.namespaceURI) ? n.localName : null);

/** Atributo de WordprocessingML (con o sin espacio de nombres) por su nombre local. */
function atributoW(el: Element, local: string): string | null {
  const a = el.attributes;
  for (let i = 0; i < a.length; i++) {
    const x = a.item(i);
    if (x !== null && x.localName === local && (x.namespaceURI === null || W_NS.has(x.namespaceURI))) return x.value;
  }
  return null;
}

function simbolo(el: Element): string {
  const h = atributoW(el, 'char');
  if (h === null || !/^[0-9A-Fa-f]{1,6}$/.test(h)) return '';
  const cp = parseInt(h, 16);
  return cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '';
}

/**
 * Texto de una raíz (cuerpo, encabezado, nota o comentario): un párrafo por línea, unidos con '\n' y sin '\n' final.
 * `w:tab` → '\t'; `w:br`/`w:cr` → '\n'; `w:noBreakHyphen` → U+2011; `w:softHyphen` → nada; `w:sym` → su carácter.
 * Excluye `w:del`/`w:moveFrom` (se cuentan), `w:instrText` y las propiedades. Un cuadro de texto anidado corta el
 * párrafo en su anclaje y aporta sus líneas. `mc:AlternateContent` lee solo `mc:Choice` (Fallback si no hay), sin duplicar.
 */
function extraerTexto(raiz: Element): { texto: string; eliminados: number } {
  const lineas: string[] = [];
  const parrafos: Array<{ buf: string; anidado: boolean }> = [];
  let suelto = '';
  let eliminados = 0;
  const anadir = (s: string): void => {
    const p = parrafos[parrafos.length - 1];
    if (p !== undefined) p.buf += s; else suelto += s;
  };
  const vaciarSuelto = (): void => { if (suelto !== '') { lineas.push(suelto); suelto = ''; } };

  const pila: Marco[] = [{ nodos: raiz.childNodes, i: 0, cierra: null }];
  for (let m = pila[pila.length - 1]; m !== undefined; m = pila[pila.length - 1]) {
    if (m.i >= m.nodos.length) { pila.pop(); m.cierra?.(); continue; }
    const n = m.nodos.item(m.i++);
    if (n === null || n.nodeType !== 1) continue;
    const el = n as Element;
    const w = nombreW(n);
    if (w === null) {
      if (n.namespaceURI === MC_NS && n.localName === 'AlternateContent') {
        let elegido: Node | null = null;
        let alterno: Node | null = null;
        for (let i = 0; i < n.childNodes.length; i++) {
          const h = n.childNodes.item(i);
          if (h === null || h.nodeType !== 1 || h.namespaceURI !== MC_NS) continue;
          if (h.localName === 'Choice' && elegido === null) elegido = h;
          else if (h.localName === 'Fallback' && alterno === null) alterno = h;
        }
        const uno = elegido ?? alterno;
        if (uno !== null) pila.push({ nodos: { length: 1, item: () => uno }, i: 0, cierra: null });
        continue;
      }
      pila.push({ nodos: n.childNodes, i: 0, cierra: null });
      continue;
    }
    if (ELIMINADOS.has(w)) { if ((el.textContent ?? '') !== '') eliminados++; continue; }
    if (SIN_TEXTO.has(w)) continue;
    switch (w) {
      case 'p': {
        const externo = parrafos[parrafos.length - 1];
        if (externo !== undefined) {
          if (externo.buf !== '') { lineas.push(externo.buf); externo.buf = ''; }
          externo.anidado = true;
        } else vaciarSuelto();
        const p = { buf: '', anidado: false };
        parrafos.push(p);
        pila.push({
          nodos: n.childNodes, i: 0,
          cierra: () => { parrafos.pop(); if (p.buf !== '' || !p.anidado) lineas.push(p.buf); },
        });
        break;
      }
      case 't': anadir(el.textContent ?? ''); break;
      case 'tab': case 'ptab': anadir('\t'); break;
      case 'br': case 'cr': anadir('\n'); break;
      case 'noBreakHyphen': anadir('‑'); break;
      case 'softHyphen': break;
      case 'sym': anadir(simbolo(el)); break;
      default: pila.push({ nodos: n.childNodes, i: 0, cierra: null });
    }
  }
  vaciarSuelto();
  while (lineas.length > 0 && lineas[lineas.length - 1] === '') lineas.pop();
  return { texto: lineas.join('\n'), eliminados };
}

// ---------------------------------------------------------------------------------------------------------------------
// Lectura completa
// ---------------------------------------------------------------------------------------------------------------------

/** Rango de orden de lectura por tipo (6.3.1). */
const RANGO: Record<PartKind, number> = {
  encabezado: 0, cuerpo: 1, pagina_pdf: 1, pie: 2, nota_pie: 3, nota_final: 4, comentario: 5, anotacion_pdf: 5,
};
const ETIQUETA: Partial<Record<PartKind, string>> = {
  encabezado: 'Encabezado', pie: 'Pie de página', nota_pie: 'Nota al pie', nota_final: 'Nota al final', comentario: 'Comentario',
};

/** Canónico (6.1.1): CRLF y CR a LF, y NFC. Nada más. */
const canonico = (t: string): string => t.replace(/\r\n?/g, '\n').normalize('NFC');

interface Hallazgo { kind: PartKind; texto: string; eliminados: number; }

export type ProgresoLectura = (done: number, total: number) => void;

/** Lee un .docx completo. Lanza SiglowError(code); nunca devuelve ni registra texto del documento en un error. */
export function readDocx(input: ArrayBuffer | Uint8Array, ctx: ReadCtx, limits: IoLimits, progress?: ProgresoLectura): DocumentModel {
  const d = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (d.length === 0) throw new SiglowError('ARCHIVO_VACIO');
  if (d.length > limits.maxFileBytes) throw new SiglowError('ARCHIVO_DEMASIADO_GRANDE');
  if (empieza(d, 0xd0, 0xcf, 0x11, 0xe0)) throw new SiglowError('CONTENEDOR_CFB');
  if (empieza(d, 0x25, 0x50, 0x44, 0x46, 0x2d)) throw new SiglowError('FORMATO_NO_ADMITIDO');

  const entradas = new Map<string, EntradaZip>();
  for (const e of leerDirectorio(d, limits)) {
    if (/[\\/]$/.test(e.nombre)) continue; // directorios
    const k = clave(e.nombre);
    if (entradas.has(k)) throw new SiglowError('ZIP_INVALIDO'); // nombres duplicados
    entradas.set(k, e);
  }
  const acum: Acumulado = { total: 0, consumido: 0 };
  const avanzar = (): void => { progress?.(Math.min(acum.consumido, d.length), d.length); };
  const abrir = (nombre: string): Element | null => {
    const e = entradas.get(clave(nombre));
    if (e === undefined) return null;
    const raiz = xmlDe(leerEntrada(d, e, limits, acum));
    avanzar();
    return raiz;
  };
  const relacionesDe = (parte: string): Relacion[] => {
    const raiz = abrir(rutaRels(parte));
    return raiz === null ? [] : leerRelaciones(raiz);
  };

  // 1. Parte principal: relación `officeDocument`; respaldo [Content_Types].xml; último respaldo word/document.xml.
  let principal: string | null = null;
  for (const r of relacionesDe('')) {
    if (ultimoSegmento(r.tipo) === 'officeDocument' && entradas.has(clave(resolver('', r.destino)))) { principal = resolver('', r.destino); break; }
  }
  if (principal === null) {
    const ct = abrir('[Content_Types].xml');
    if (ct !== null) {
      for (let i = 0; i < ct.childNodes.length && principal === null; i++) {
        const n = ct.childNodes.item(i);
        if (n === null || n.nodeType !== 1 || n.localName !== 'Override') continue;
        const el = n as Element;
        const tipo = el.getAttribute('ContentType') ?? '';
        const nombre = el.getAttribute('PartName') ?? '';
        if (/wordprocessingml\.(document|template)\.main\+xml$/.test(tipo) && entradas.has(clave(nombre))) principal = nombre;
      }
    }
  }
  if (principal === null && entradas.has('word/document.xml')) principal = 'word/document.xml';
  if (principal === null) throw new SiglowError('SIN_DOCUMENTO_PRINCIPAL');

  // 2. Cuerpo.
  const raizDoc = abrir(principal);
  if (raizDoc === null || nombreW(raizDoc) !== 'document') throw new SiglowError('SIN_DOCUMENTO_PRINCIPAL');
  let cuerpo: Element | null = null;
  for (let i = 0; i < raizDoc.childNodes.length && cuerpo === null; i++) {
    const n = raizDoc.childNodes.item(i);
    if (n !== null && nombreW(n) === 'body') cuerpo = n as Element;
  }
  if (cuerpo === null) throw new SiglowError('SIN_DOCUMENTO_PRINCIPAL');

  // Orden de aparición de los encabezados y pies: `r:id` de `w:headerReference`/`w:footerReference` (también dentro de `w:pPr`).
  const aparicion = new Map<string, number>();
  recorrer(raizDoc, (el) => {
    const w = nombreW(el);
    if (w !== 'headerReference' && w !== 'footerReference') return;
    const a = el.attributes;
    for (let i = 0; i < a.length; i++) {
      const x = a.item(i);
      if (x !== null && x.localName === 'id' && x.namespaceURI !== null && x.namespaceURI.endsWith('/relationships') && !aparicion.has(x.value)) {
        aparicion.set(x.value, aparicion.size);
      }
    }
  });

  const hallazgos: Hallazgo[] = [];
  const unaParte = (kind: PartKind, raiz: Element): void => {
    const { texto, eliminados } = extraerTexto(raiz);
    hallazgos.push({ kind, texto, eliminados });
  };
  unaParte('cuerpo', cuerpo);

  // 3. Partes por tipo de relación (último segmento); los nombres de las partes son libres.
  const rels = relacionesDe(principal);
  const vistos = new Set<string>();
  const porTipo = (tipo: string): Relacion[] => rels.filter((r) => {
    if (ultimoSegmento(r.tipo) !== tipo) return false;
    const destino = resolver(principal, r.destino);
    if (vistos.has(destino) || !entradas.has(clave(destino))) return false;
    vistos.add(destino);
    return true;
  });
  const orden = (a: Relacion, b: Relacion): number => (aparicion.get(a.id) ?? Infinity) - (aparicion.get(b.id) ?? Infinity);
  for (const [tipo, kind] of [['header', 'encabezado'], ['footer', 'pie']] as const) {
    for (const r of porTipo(tipo).sort(orden)) {
      const raiz = abrir(resolver(principal, r.destino));
      if (raiz !== null) unaParte(kind, raiz);
    }
  }
  const hijosDe = (raiz: Element, nombre: string, vistaPrevia?: (el: Element) => boolean): Element[] => {
    const out: Element[] = [];
    for (let i = 0; i < raiz.childNodes.length; i++) {
      const n = raiz.childNodes.item(i);
      if (n !== null && nombreW(n) === nombre && (vistaPrevia === undefined || vistaPrevia(n as Element))) out.push(n as Element);
    }
    return out;
  };
  const noEsSeparador = (el: Element): boolean => {
    const t = atributoW(el, 'type');
    return t !== 'separator' && t !== 'continuationSeparator' && t !== 'continuationNotice';
  };
  for (const [tipo, hijo, kind, filtro] of [
    ['footnotes', 'footnote', 'nota_pie', noEsSeparador],
    ['endnotes', 'endnote', 'nota_final', noEsSeparador],
    ['comments', 'comment', 'comentario', undefined],
  ] as const) {
    for (const r of porTipo(tipo)) {
      const raiz = abrir(resolver(principal, r.destino));
      if (raiz === null) continue;
      for (const nota of hijosDe(raiz, hijo, filtro)) unaParte(kind, nota);
    }
  }

  // 4. Partes en orden de lectura canónico (6.3.1): rango y, dentro del rango, orden de hallazgo. Sin partes vacías.
  const ordenadas = hallazgos
    .map((h, i) => ({ h, i, texto: canonico(h.texto) }))
    .filter((x) => x.texto.trim() !== '')
    .sort((a, b) => (RANGO[a.h.kind] - RANGO[b.h.kind]) || (a.i - b.i));
  if (ordenadas.length === 0) throw new SiglowError('ARCHIVO_VACIO');
  const ids = ctx.ids ?? randomIds();
  const indice: Partial<Record<PartKind, number>> = {};
  const warnings: ParseWarning[] = [];
  const parts: Part[] = ordenadas.map((x, order) => {
    const kind = x.h.kind;
    const index = (indice[kind] ?? 0) + 1;
    indice[kind] = index;
    const id = ids.next('prt') as PartId;
    if (x.h.eliminados > 0) warnings.push({ code: 'TEXTO_ELIMINADO_EXCLUIDO', partId: id, count: x.h.eliminados });
    return {
      id, docId: ctx.docId, kind, order, index, included: true, text: x.texto,
      label: ETIQUETA[kind] === undefined ? 'Cuerpo del documento' : `${ETIQUETA[kind]} ${index}`,
    };
  });
  progress?.(d.length, d.length);
  return { id: ctx.docId, label: ctx.label, source: 'docx', parts, metadata: { categories: {} }, warnings };
}
