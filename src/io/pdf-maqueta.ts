// F7 · PDF con el estilo del .docx (v1.1.1). El dueño espera que el PDF de un .docx se vea como su documento, igual que el .docx
// fiel: mismo tamaño de página y márgenes, alineación (también justificado), sangrías, espaciado e interlineado, negrita, cursiva,
// subrayado y tamaño de letra, la fuente mapeada a las estándar (Times, Helvetica, Courier; WinAnsi), tablas con bordes simples,
// numeración y viñetas, encabezado y pie en cada página (con el número de página) y saltos de página.
//
// Privacidad: el PDF se arma desde el .docx fiel (`construirDocxFiel`), que ya trae los reemplazos, ya quitó lo que no se analizó
// y ya pasó su verificación final (relectura y búsqueda de cada valor reemplazado). Nunca se lee el original aquí. Lo que no se
// reproduce (imágenes, dibujos, cuadros de texto, ecuaciones) se omite y se cuenta. Sin /Info, /ID, XMP ni fechas.
import { SiglowError } from '../core/types';
import type { DocumentModel, IoLimits, RenderedOutput } from '../core/types';
import { construirDocxFiel } from './docx-write-fiel';
import { estructuraDocx } from './docx-estructura';
import type { Bloque, DocumentoConEstilo, Estilo, Parrafo, Tabla, Trozo } from './docx-estructura';
import { IO_LIMITS_POR_DEFECTO } from './io-client';
import { anchoFuente, diccionarioFuente, idFuente } from './pdf-fuentes';
import type { IdFuente } from './pdf-fuentes';
import { aWinAnsi, armarPdf, ascii, literal, num, objetoConFlujo } from './pdf-write';

// ---------------------------------------------------------------------------------------------------------------------
// Medidas
// ---------------------------------------------------------------------------------------------------------------------

/** Alto de una línea sencilla en múltiplos del tamaño de letra (el de Word con las fuentes habituales). */
const LINEA_SENCILLA = 1.15;
/** Posición de la línea base bajo el borde superior de la línea, en múltiplos del tamaño. */
const ASCENSO = 0.9;
/** Margen interior izquierdo y derecho de las celdas (108 twips, el de Word). */
const MARGEN_CELDA = 5.4;

const tamReal = (e: Estilo): number => (e.vert === 'normal' ? e.tam : e.tam * 0.65);
const subida = (e: Estilo): number => (e.vert === 'sup' ? e.tam * 0.35 : e.vert === 'sub' ? -e.tam * 0.14 : 0);
const medir = (s: string, e: Estilo): number => {
  const id = idFuente(e);
  let n = 0;
  for (const c of s) n += anchoFuente(c, id);
  return (n * tamReal(e)) / 1000;
};

interface Pag { n: number; total: number }
/** Lo que se dibuja en una página: operadores PDF y las fuentes usadas. */
interface Lienzo { ops: string[]; fuentes: Set<IdFuente> }
/** Una pieza vertical del flujo: una línea, una fila de tabla, un espacio. */
interface Unidad {
  alto: number;
  /** Solo espacio (antes o después de un párrafo): no abre página ni se dibuja al principio de una. */
  espacio?: boolean;
  /** Salto de página forzado. */
  pagina?: boolean;
  dibujar?: (x0: number, yTop: number, pag: Pag, l: Lienzo) => void;
}

// ---------------------------------------------------------------------------------------------------------------------
// Párrafos
// ---------------------------------------------------------------------------------------------------------------------

type Elem =
  | { k: 'texto'; x: number; s: string; e: Estilo; w: number; espacios: number }
  | { k: 'campo'; x: number; campo: 'PAGE' | 'NUMPAGES'; e: Estilo; w: number };
interface Linea { elems: Elem[]; inicio: number; fin: number; tam: number; justificable: boolean; conTab: boolean; espacios: number }

interface Contador { sustituidos: number }

/** Divide un párrafo en líneas dentro del ancho del área (`ancho`). */
function lineasDeParrafo(p: Parrafo, ancho: number, tabDef: number, cont: Contador): { lineas: Linea[]; saltos: number[] } {
  const derecha = ancho - p.der;
  const lineas: Linea[] = [];
  const saltos: number[] = []; // índices de línea tras los que hay un salto de página
  const vacia = (inicio: number): Linea => ({ elems: [], inicio, fin: inicio, tam: 0, justificable: true, conTab: false, espacios: 0 });
  let actual: Linea = vacia(p.izq + p.primera);
  const nueva = (inicio: number): void => { actual = vacia(inicio); };
  const cerrar = (justificable: boolean): void => {
    // Los espacios al final de una línea partida no cuentan (ni para el ancho ni para justificar).
    const ultimo = actual.elems[actual.elems.length - 1];
    if (ultimo !== undefined && ultimo.k === 'texto' && justificable) {
      const sin = ultimo.s.replace(/ +$/u, '');
      const quitados = ultimo.s.length - sin.length;
      if (quitados > 0) {
        ultimo.s = sin; ultimo.espacios -= quitados; actual.espacios -= quitados;
        ultimo.w = medir(sin, ultimo.e); actual.fin = ultimo.x + ultimo.w;
      }
    }
    actual.justificable = justificable && !actual.conTab;
    if (actual.tam === 0) actual.tam = p.marca.tam;
    lineas.push(actual);
    nueva(p.izq);
  };
  const poner = (s: string, e: Estilo): void => {
    const w = medir(s, e);
    const espacios = (s.match(/ /gu) ?? []).length;
    const prev = actual.elems[actual.elems.length - 1];
    if (prev !== undefined && prev.k === 'texto' && prev.e === e && prev.x + prev.w === actual.fin) {
      prev.s += s; prev.w += w; prev.espacios += espacios;
    } else actual.elems.push({ k: 'texto', x: actual.fin, s, e, w, espacios });
    actual.fin += w;
    actual.espacios += espacios;
    actual.tam = Math.max(actual.tam, e.tam);
  };
  const siguienteTab = (x: number): number => {
    const propias = [...p.tabs].sort((a, b) => a - b).find((t) => t > x + 0.01);
    if (propias !== undefined) return propias;
    if (p.izq > x + 0.01) return p.izq; // parada implícita en la sangría (listas con sangría francesa)
    return (Math.floor(x / tabDef) + 1) * tabDef;
  };
  // Rótulo de numeración o viñeta en la primera línea.
  if (p.rotulo !== null) {
    const r = aWinAnsi(p.rotulo.texto);
    cont.sustituidos += r.sustituidos;
    poner(r.texto, p.rotulo.estilo);
    if (p.rotulo.sufijo === 'tab') { actual.fin = siguienteTab(actual.fin); }
    else if (p.rotulo.sufijo === 'espacio') poner(' ', p.rotulo.estilo);
  }
  let trasCorte = false;
  let palabra: Array<{ s: string; e: Estilo }> = [];
  for (const t of p.trozos) {
    if (t.tipo !== 'texto') colocarPalabra();
    if (t.tipo === 'salto') { actual.tam = Math.max(actual.tam, t.estilo.tam); cerrar(false); trasCorte = false; continue; }
    if (t.tipo === 'pagina') { cerrar(false); saltos.push(lineas.length - 1); trasCorte = false; continue; }
    if (t.tipo === 'tab') {
      actual.fin = siguienteTab(actual.fin);
      actual.conTab = true;
      actual.tam = Math.max(actual.tam, t.estilo.tam);
      trasCorte = false;
      continue;
    }
    if (t.tipo === 'campo') {
      const w = medir('99', t.estilo);
      if (actual.fin + w > derecha && actual.elems.length > 0) cerrar(true);
      actual.elems.push({ k: 'campo', x: actual.fin, campo: t.campo, e: t.estilo, w });
      actual.fin += w;
      actual.tam = Math.max(actual.tam, t.estilo.tam);
      continue;
    }
    const w = aWinAnsi(t.texto.replace(/[\u0000-\u0008\u000b-\u001f\u007f\t\n\r]/gu, ''));
    cont.sustituidos += w.sustituidos;
    for (const pieza of w.texto.split(/( +)/u)) {
      if (pieza === '') continue;
      if (pieza.startsWith(' ')) {
        colocarPalabra();
        if (!trasCorte) poner(pieza, t.estilo);
        continue;
      }
      // Una palabra puede venir en varias corridas («tut» + «ela» en cursiva): se junta antes de decidir el corte.
      palabra.push({ s: pieza, e: t.estilo });
    }
  }
  colocarPalabra();
  cerrar(false); // la última línea del párrafo no se justifica
  return { lineas, saltos };

  /** Coloca la palabra pendiente: si no cabe en la línea, pasa entera a la siguiente; si no cabe ni sola, se parte. */
  function colocarPalabra(): void {
    if (palabra.length === 0) return;
    const segs = palabra;
    palabra = [];
    const total = segs.reduce((a, x) => a + medir(x.s, x.e), 0);
    if (actual.fin + total > derecha + 0.01 && actual.elems.length > 0 && actual.fin > actual.inicio + 0.01) cerrar(true);
    for (const seg of segs) {
      let resto = seg.s;
      while (resto !== '') {
        if (actual.fin + medir(resto, seg.e) <= derecha + 0.01 || actual.elems.length === 0 && resto.length === 1) { poner(resto, seg.e); break; }
        let k = resto.length;
        while (k > 1 && actual.fin + medir(resto.slice(0, k), seg.e) > derecha) k--;
        if (actual.fin + medir(resto.slice(0, k), seg.e) > derecha && actual.elems.length > 0) { cerrar(false); continue; }
        poner(resto.slice(0, k), seg.e);
        resto = resto.slice(k);
        if (resto !== '') cerrar(false);
      }
    }
    trasCorte = false;
  }
}

function altoDeLinea(p: Parrafo, tam: number): { alto: number; base: number } {
  const sencilla = tam * LINEA_SENCILLA;
  const i = p.interlineado;
  if (i.regla === 'exacto') return { alto: i.valor, base: Math.min(i.valor, tam * ASCENSO + (i.valor - sencilla) / 2) };
  if (i.regla === 'minimo') { const alto = Math.max(sencilla, i.valor); return { alto, base: alto - sencilla + tam * ASCENSO }; }
  return { alto: sencilla * i.valor, base: tam * ASCENSO };
}

function dibujarLinea(lin: Linea, p: Parrafo, ancho: number, base: number, x0: number, yTop: number, pag: Pag, l: Lienzo): void {
  const derecha = ancho - p.der;
  // Los campos se resuelven con la página real: lo que sigue se corre lo que va del ancho reservado («99») al del número.
  let corrimiento = 0;
  const elems = lin.elems.map((e) => {
    const x = e.x + corrimiento;
    if (e.k !== 'campo') return { ...e, x, texto: e.s };
    const texto = String(e.campo === 'PAGE' ? pag.n : pag.total);
    const w = medir(texto, e.e);
    corrimiento += w - e.w;
    return { ...e, x, w, texto };
  });
  let desplazamiento = 0;
  let tw = 0;
  const libre = derecha - (lin.fin + corrimiento);
  if (p.alineacion === 'centro') desplazamiento = libre / 2;
  else if (p.alineacion === 'der') desplazamiento = libre;
  else if (p.alineacion === 'just' && lin.justificable && lin.espacios > 0 && libre > 0) tw = libre / lin.espacios;
  const y = yTop - base;
  let espaciosAntes = 0;
  l.ops.push('BT');
  l.ops.push(`${num(tw)} Tw`);
  const subrayados: string[] = [];
  for (const e of elems) {
    const id = idFuente(e.e);
    l.fuentes.add(id);
    const x = x0 + e.x + desplazamiento + tw * espaciosAntes;
    l.ops.push(`/${id} ${num(tamReal(e.e))} Tf ${num(subida(e.e))} Ts 1 0 0 1 ${num(x)} ${num(y)} Tm ${literal(e.texto)} Tj`);
    const espacios = e.k === 'texto' ? e.espacios : 0;
    const w = e.w + tw * espacios;
    if (e.e.subrayado && w > 0) subrayados.push(`${num(x)} ${num(y - e.e.tam * 0.12)} ${num(w)} ${num(Math.max(0.4, e.e.tam * 0.05))} re f`);
    espaciosAntes += espacios;
  }
  l.ops.push('ET');
  l.ops.push(...subrayados);
}

function unidadesDeParrafo(p: Parrafo, ancho: number, tabDef: number, cont: Contador): Unidad[] {
  const out: Unidad[] = [];
  if (p.saltoAntes) out.push({ alto: 0, pagina: true });
  if (p.antes > 0) out.push({ alto: p.antes, espacio: true });
  const { lineas, saltos } = lineasDeParrafo(p, ancho, tabDef, cont);
  lineas.forEach((lin, i) => {
    const { alto, base } = altoDeLinea(p, lin.tam);
    out.push({ alto, dibujar: (x0, yTop, pag, l) => { dibujarLinea(lin, p, ancho, base, x0, yTop, pag, l); } });
    if (saltos.includes(i)) out.push({ alto: 0, pagina: true });
  });
  if (p.despues > 0) out.push({ alto: p.despues, espacio: true });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------------------------------------------------------

function unidadesDeTabla(t: Tabla, ancho: number, tabDef: number, cont: Contador): Unidad[] {
  const disponible = Math.max(1, ancho - t.sangria);
  let cols = t.columnas.map((c) => Math.max(0, c));
  const suma = cols.reduce((a, b) => a + b, 0);
  if (suma <= 0) cols = cols.map(() => disponible / Math.max(1, cols.length));
  else if (suma > disponible) cols = cols.map((c) => (c * disponible) / suma);
  const out: Unidad[] = [];
  for (const fila of t.filas) {
    let col = 0;
    const celdas = fila.celdas.map((c) => {
      const x = cols.slice(0, col).reduce((a, b) => a + b, 0);
      const w = cols.slice(col, col + c.span).reduce((a, b) => a + b, 0);
      col += c.span;
      const interior = Math.max(1, w - 2 * MARGEN_CELDA);
      const us = unidadesDeBloques(c.bloques, interior, tabDef, cont).filter((u) => u.pagina !== true);
      // Dentro de una celda no hay espacio después del último párrafo (Word lo ignora al medir la fila).
      while (us.length > 0 && us[us.length - 1]?.espacio === true) us.pop();
      return { x, w, us, alto: us.reduce((a, u) => a + u.alto, 0) };
    });
    const alto = Math.max(fila.altoMin, 2, ...celdas.map((c) => c.alto));
    out.push({
      alto,
      dibujar: (x0, yTop, pag, l) => {
        for (const c of celdas) {
          let y = yTop;
          for (const u of c.us) { u.dibujar?.(x0 + t.sangria + c.x + MARGEN_CELDA, y, pag, l); y -= u.alto; }
          if (t.bordes) l.ops.push(`0.5 w ${num(x0 + t.sangria + c.x)} ${num(yTop - alto)} ${num(c.w)} ${num(alto)} re S`);
        }
      },
    });
  }
  return out;
}

function unidadesDeBloques(bloques: Bloque[], ancho: number, tabDef: number, cont: Contador): Unidad[] {
  const out: Unidad[] = [];
  for (const b of bloques) {
    if (b.tipo === 'pagina') out.push({ alto: 0, pagina: true });
    else if (b.tipo === 'parrafo') out.push(...unidadesDeParrafo(b, ancho, tabDef, cont));
    else out.push(...unidadesDeTabla(b, ancho, tabDef, cont));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Páginas
// ---------------------------------------------------------------------------------------------------------------------

export interface PdfConEstilo {
  bytes: Uint8Array;
  /** Caracteres fuera de WinAnsi sustituidos por «?». */
  sustituidos: number;
  /** Imágenes, dibujos, cuadros de texto, ecuaciones y objetos que el PDF no reproduce. */
  omitidos: number;
  paginas: number;
}

/** Maqueta la estructura en páginas y arma el PDF. */
export function pdfDeEstructura(d: DocumentoConEstilo): PdfConEstilo {
  const cont: Contador = { sustituidos: 0 };
  const pg = d.pagina;
  const ancho = Math.max(36, pg.ancho - pg.margen.izq - pg.margen.der);
  const cuerpo = unidadesDeBloques(d.cuerpo, ancho, pg.tabPorDefecto, cont);
  if (d.notas.length > 0) {
    // Notas al final del documento, tras una línea corta: el número y su texto.
    cuerpo.push({ alto: 12, espacio: true });
    cuerpo.push({ alto: 6, dibujar: (x0, yTop, _pag, l) => { l.ops.push(`0.5 w ${num(x0)} ${num(yTop - 3)} m ${num(x0 + ancho / 3)} ${num(yTop - 3)} l S`); } });
    for (const nota of d.notas) {
      const [primero, ...resto] = nota.bloques;
      const conNumero: Bloque[] = primero !== undefined && primero.tipo === 'parrafo'
        ? [{ ...primero, trozos: [{ tipo: 'texto', texto: `${nota.numero} `, estilo: { ...primero.marca, vert: 'sup' } } satisfies Trozo, ...primero.trozos] }, ...resto]
        : nota.bloques;
      cuerpo.push(...unidadesDeBloques(conNumero, ancho, pg.tabPorDefecto, cont));
    }
  }

  // Flujo: las unidades se apilan desde el margen superior; la que no cabe pasa a la página siguiente.
  const paginas: Array<Array<{ u: Unidad; yTop: number }>> = [[]];
  const arriba = pg.alto - pg.margen.sup;
  let y = arriba;
  const nuevaPagina = (): void => { paginas.push([]); y = arriba; };
  for (const u of cuerpo) {
    const actual = paginas[paginas.length - 1] ?? [];
    if (u.pagina === true) { if (actual.length > 0) nuevaPagina(); continue; }
    if (u.espacio === true && actual.length === 0) continue;
    if (y - u.alto < pg.margen.inf - 0.01 && actual.length > 0) {
      nuevaPagina();
      if (u.espacio === true) continue;
    }
    (paginas[paginas.length - 1] ?? []).push({ u, yTop: y });
    y -= u.alto;
  }

  const total = paginas.length;
  const flujos: Lienzo[] = paginas.map((lista, i) => {
    const pag: Pag = { n: i + 1, total };
    const l: Lienzo = { ops: ['0 g 0 G'], fuentes: new Set() };
    const primera = i === 0 && d.primera !== null;
    const encabezado = primera ? d.primera?.encabezado ?? null : d.encabezado;
    const pie = primera ? d.primera?.pie ?? null : d.pie;
    if (encabezado !== null) {
      let ye = pg.alto - pg.margen.encabezado;
      for (const u of unidadesDeBloques(encabezado, ancho, pg.tabPorDefecto, cont)) {
        if (u.pagina === true) continue;
        u.dibujar?.(pg.margen.izq, ye, pag, l);
        ye -= u.alto;
      }
    }
    if (pie !== null) {
      const us = unidadesDeBloques(pie, ancho, pg.tabPorDefecto, cont).filter((u) => u.pagina !== true);
      while (us.length > 0 && us[us.length - 1]?.espacio === true) us.pop();
      let yp = pg.margen.pie + us.reduce((a, u) => a + u.alto, 0);
      for (const u of us) { u.dibujar?.(pg.margen.izq, yp, pag, l); yp -= u.alto; }
    }
    for (const { u, yTop } of lista) u.dibujar?.(pg.margen.izq, yTop, pag, l);
    return l;
  });

  // Objetos: catálogo, páginas, fuentes usadas (con sus anchos), y página y contenido de cada página.
  const usadas = [...new Set(flujos.flatMap((f) => [...f.fuentes]))].sort();
  const objetos: Array<string | Uint8Array> = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const numeroFuente = new Map<IdFuente, number>();
  for (const id of usadas) { objetos.push(diccionarioFuente(id)); numeroFuente.set(id, objetos.length); }
  const recursos = `<< /Font << ${usadas.map((id) => `/${id} ${numeroFuente.get(id) ?? 0} 0 R`).join(' ')} >> >>`;
  const kids: number[] = [];
  for (const f of flujos) {
    const n = objetos.length + 1;
    objetos.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pg.ancho)} ${num(pg.alto)}] /Resources ${recursos} /Contents ${n + 1} 0 R >>`);
    objetos.push(objetoConFlujo('', ascii(f.ops.join('\n'))));
    kids.push(n);
  }
  objetos[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  return { bytes: armarPdf(objetos), sustituidos: cont.sustituidos, omitidos: d.omitidos, paginas: total };
}

/**
 * PDF con el estilo del .docx: arma el .docx fiel (anonimizado y verificado), lee su formato y lo maqueta. Lanza
 * `FORMATO_NO_ADMITIDO` si el documento no admite el .docx fiel (la interfaz ofrece entonces el PDF de texto) y `ERROR_INTERNO`
 * si la verificación del .docx fiel falla. El .docx intermedio queda en ceros.
 */
export function construirPdfConEstilo(original: Uint8Array, doc: DocumentModel, out: RenderedOutput, limits: IoLimits = IO_LIMITS_POR_DEFECTO): PdfConEstilo & { imagenes: number } {
  if (doc.source !== 'docx') throw new SiglowError('FORMATO_NO_ADMITIDO');
  const fiel = construirDocxFiel(original, doc, out, limits);
  try {
    return { ...pdfDeEstructura(estructuraDocx(fiel.bytes, limits)), imagenes: fiel.imagenes };
  } finally {
    fiel.bytes.fill(0);
  }
}
