// F3 (D-24) · Estructura de un .docx para la vista previa: párrafos, títulos, alineación, negrita, cursiva, subrayado y celdas de
// tabla, en posiciones de `Part.text`. Sale del mapa de F4 (`leerDocxMapeado`: cada `w:t` con su tramo y su nodo): se sube desde
// cada nodo a su corrida (`w:r`), su párrafo (`w:p`) y su celda (`w:tc`). No guarda texto: solo posiciones y formato.
// El original sigue en memoria (`io/original.ts`); esta lectura no lo copia ni lo guarda. Si el original no es el documento
// analizado (otras partes u otro texto), no hay estructura y la vista previa muestra cada línea como un párrafo.
import type { Element, Node } from '@xmldom/xmldom';
import type { DocumentModel, PartId } from '../../core/types.ts';
import { leerDocxMapeado, W_NS, type ParteDocxMapeada, type PiezaDocx } from '../../io/docx-read.ts';
import { IO_LIMITS_POR_DEFECTO } from '../../io/io-client.ts';
import type { Alineacion, Estilo, EstructuraParte, ParrafoEstructura, TipoBloque } from './modelo-vista.ts';

const esW = (n: Node | null, local: string): boolean =>
  n !== null && n.nodeType === 1 && n.namespaceURI !== null && W_NS.has(n.namespaceURI) && n.localName === local;

function hijoW(el: Element, local: string): Element | null {
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes.item(i);
    if (esW(c, local)) return c as Element;
  }
  return null;
}
function valW(el: Element | null): string | null {
  if (el === null) return null;
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes.item(i);
    if (a !== null && a.localName === 'val') return a.value;
  }
  return null;
}
const activo = (el: Element | null): boolean => {
  if (el === null) return false;
  const v = valW(el);
  return !(v === '0' || v === 'false' || v === 'off' || v === 'none');
};
function ancestro(n: Node, local: string, hasta?: Node): Element | null {
  for (let p = n.parentNode; p !== null && p !== hasta; p = p.parentNode) if (esW(p, local)) return p as Element;
  return null;
}

function estiloDe(t: Element): Estilo {
  const r = ancestro(t, 'r');
  const rpr = r === null ? null : hijoW(r, 'rPr');
  const e: Estilo = {};
  if (rpr !== null) {
    if (activo(hijoW(rpr, 'b'))) e.negrita = true;
    if (activo(hijoW(rpr, 'i'))) e.cursiva = true;
    if (activo(hijoW(rpr, 'u'))) e.subrayado = true;
  }
  return e;
}

const TITULO = /^(?:heading|t[ií]tulo|titulo)\s*([1-9])$/iu;
function tipoDe(p: Element): { tipo: TipoBloque; alinear?: Alineacion } {
  const ppr = hijoW(p, 'pPr');
  const estilo = valW(ppr === null ? null : hijoW(ppr, 'pStyle')) ?? '';
  const m = TITULO.exec(estilo.replace(/[^\p{L}\p{N}\s]/gu, ''));
  const nivel = /^title$/iu.test(estilo) ? 1 : m === null ? 0 : Number(m[1]);
  const tipo: TipoBloque = nivel === 1 ? 'titulo1' : nivel === 2 ? 'titulo2' : nivel >= 3 ? 'titulo3' : 'p';
  const jc = valW(ppr === null ? null : hijoW(ppr, 'jc'));
  const alinear: Alineacion | undefined = jc === 'center' ? 'centro' : (jc === 'right' || jc === 'end') ? 'derecha' : (jc === 'both' || jc === 'distribute') ? 'justificado' : undefined;
  return alinear === undefined ? { tipo } : { tipo, alinear };
}

/** Índice de un elemento entre los hermanos del mismo nombre W. */
function indice(el: Element, local: string): number {
  let n = 0;
  for (let s = el.previousSibling; s !== null; s = s.previousSibling) if (esW(s, local)) n++;
  return n;
}

/** Estructura de una parte mapeada. Las líneas sin pieza (párrafos vacíos) quedan como párrafos sueltos. */
export function estructuraDeParte(texto: string, piezas: readonly PiezaDocx[]): EstructuraParte {
  const tablas = new Map<Element, number>();
  const parrafoDe = new Map<PiezaDocx, Element | null>();
  for (const x of piezas) parrafoDe.set(x, ancestro(x.el, 'p'));
  // Una línea por cada '\n' del texto; cada línea va al párrafo de su primera pieza.
  const lineas: Array<{ ini: number; fin: number; p: Element | null }> = [];
  let i = 0;
  let k = 0;
  for (const l of texto.split('\n')) {
    const fin = i + l.length;
    while (k < piezas.length && (piezas[k] as PiezaDocx).ini < i) k++;
    const sig = piezas[k];
    const pz = sig !== undefined && sig.ini < fin ? sig : undefined;
    lineas.push({ ini: i, fin, p: pz === undefined ? null : parrafoDe.get(pz) ?? null });
    i = fin + 1;
  }
  const parrafos: ParrafoEstructura[] = [];
  for (const l of lineas) {
    const previo = parrafos[parrafos.length - 1];
    const previoEl = previo === undefined ? undefined : (previo as ParrafoEstructura & { el?: Element | null }).el;
    // Un salto de línea dentro del mismo `w:p` (w:br) sigue en el mismo bloque.
    if (previo !== undefined && l.p !== null && previoEl === l.p) { previo.fin = l.fin; continue; }
    const base: ParrafoEstructura & { el?: Element | null } = { ini: l.ini, fin: l.fin, tipo: 'p', el: l.p };
    if (l.p !== null) {
      const t = tipoDe(l.p);
      base.tipo = t.tipo;
      if (t.alinear !== undefined) base.alinear = t.alinear;
      const tc = ancestro(l.p, 'tc');
      const tr = tc === null ? null : ancestro(tc, 'tr');
      const tbl = tr === null ? null : ancestro(tr, 'tbl');
      if (tc !== null && tr !== null && tbl !== null) {
        if (!tablas.has(tbl)) tablas.set(tbl, tablas.size);
        base.celda = { tabla: tablas.get(tbl) as number, fila: indice(tr, 'tr'), col: indice(tc, 'tc') };
      }
    }
    parrafos.push(base);
  }
  const estilos: EstructuraParte['estilos'] = [];
  for (const x of piezas) {
    if (x.tipo !== 't') continue;
    const e = estiloDe(x.el);
    if (e.negrita || e.cursiva || e.subrayado) estilos.push({ ini: x.ini, fin: x.fin, estilo: e });
  }
  return { parrafos: parrafos.map(({ ini, fin, tipo, alinear, celda }) => ({ ini, fin, tipo, ...(alinear ? { alinear } : {}), ...(celda ? { celda } : {}) })), estilos };
}

/**
 * Estructura de cada parte del documento analizado, desde el original en memoria. Devuelve un mapa vacío si el original no cuadra
 * con el documento o no se puede leer: la vista previa no depende de esto para mostrar el texto anonimizado.
 */
export function estructuraDocx(original: Uint8Array, doc: DocumentModel): Map<PartId, EstructuraParte> {
  const out = new Map<PartId, EstructuraParte>();
  if (doc.source !== 'docx') return out;
  try {
    const m = leerDocxMapeado(original, { docId: doc.id, label: doc.label }, IO_LIMITS_POR_DEFECTO);
    const partes = [...doc.parts].sort((a, b) => a.order - b.order);
    if (partes.length !== m.partes.length) return out;
    partes.forEach((p, i) => {
      const q = m.partes[i] as ParteDocxMapeada | undefined;
      if (q === undefined || q.kind !== p.kind || q.texto !== p.text || q.piezas === null) return;
      out.set(p.id, estructuraDeParte(p.text, q.piezas));
    });
  } catch {
    return new Map();
  }
  return out;
}
