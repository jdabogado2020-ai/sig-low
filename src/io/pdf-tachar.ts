// F4 · PDF tachado (D-22): cada página del original se dibuja en un lienzo con pdf.js, se pintan recuadros opacos con la etiqueta
// sobre los tramos reemplazados (con margen) y el resultado se guarda como un PDF de imágenes (`pdfDeImagenes`), del mismo tamaño
// de página. El PDF de salida no tiene texto, ni fuentes, ni anotaciones, ni formularios, ni metadatos: nada del original pasa
// salvo los píxeles de cada página ya tachada.
//
// Por qué no `extractPages([{ image }])` de pdf.js 6.4.299: pone cada imagen en una página del tamaño más frecuente de las páginas
// copiadas y, sin páginas copiadas, en tamaño carta con un 10 % de margen (`#modalPageSize`, `#makeImagePage`): el diseño cambia.
// El escritor propio conserva el tamaño exacto y no depende de `ImageBitmap` en el worker.
//
// Fallas seguras (A-20, P0-6a): una página excluida, sin capa de texto (escaneada, o con menos de `pdfMinCharsPerPage` caracteres
// útiles), con texto ilegible o cuyo mapa no se pudo armar se cubre entera, sin dibujar el original; vuelve en `paginasCubiertas`
// y, las no analizadas, en `avisos` (M-310). Las imágenes de las páginas que salen se cuentan (`imagenes`, M-122).
// Corre en el hilo principal (necesita un lienzo); errores solo con ErrorCode. Las anotaciones y los formularios no se dibujan.
import { SiglowError } from '../core/types';
import type { DetectionId, DocumentModel, IoLimits, ParseWarning, RenderedOutput } from '../core/types';
import { cambiosDe } from './docx-write-fiel';
import { IO_LIMITS_POR_DEFECTO, LecturaCancelada } from './io-client';
import { codigoPdf, crearWorkerPdfjs, textoDePagina } from './pdf-read';
import type { PiezaPdf } from './pdf-read';
import { descargarPdf, pdfDeImagenes } from './pdf-write';
import type { PaginaImagen } from './pdf-write';
import { nombreDescarga } from './txt-write';
import type { OpcionesExportacion, ResultadoExportacion } from './txt-write';

// ---------- Lo mínimo que se usa de pdf.js y del lienzo (inyectables en las pruebas) ----------
export interface VistaPdf { width: number; height: number; convertToViewportPoint(x: number, y: number): number[] }
export interface PaginaPdfTachado {
  getViewport(o: { scale: number }): VistaPdf;
  getTextContent(): Promise<{ items: ReadonlyArray<unknown>; styles?: unknown }>;
  render(p: Record<string, unknown>): { promise: Promise<unknown>; cancel?(): void };
  /** Para contar las imágenes que pinta la página (M-122). */
  getOperatorList?(o: Record<string, unknown>): Promise<{ fnArray: ArrayLike<number> & Iterable<number> }>;
  cleanup(): unknown;
}
export interface DocumentoPdfTachado { numPages: number; getPage(n: number): Promise<PaginaPdfTachado> }
export interface PdfjsTachado {
  getDocument(params: Record<string, unknown>): { promise: Promise<DocumentoPdfTachado>; destroy(): Promise<void> | void };
  PDFWorker: new (params: { port: unknown }) => { destroy(): void };
  AnnotationMode: { DISABLE: number };
  OPS?: Readonly<Record<string, number>>;
}
/** Contexto 2D: lo que se usa para pintar y leer los píxeles. */
export interface Contexto2D {
  fillStyle: unknown; font: string; textAlign: string; textBaseline: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; closePath(): void; fill(): void;
  fillText(t: string, x: number, y: number): void;
  measureText(t: string): { width: number };
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray | Uint8Array };
}
export interface Lienzo { canvas: unknown; ctx: Contexto2D; ancho: number; alto: number; liberar(): void }

/** Lienzo del navegador (fuera del DOM visible). */
export function crearLienzoNavegador(ancho: number, alto: number): Lienzo {
  const c = document.createElement('canvas');
  c.width = ancho;
  c.height = alto;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (ctx === null) throw new SiglowError('ERROR_INTERNO');
  return { canvas: c, ctx: ctx as unknown as Contexto2D, ancho, alto, liberar: () => { c.width = 0; c.height = 0; } };
}

export interface TacharDeps {
  cargarPdfjs?: () => Promise<PdfjsTachado>;
  /** `null` = sin worker propio (pdf.js usa el simulado). */
  crearWorker?: () => { terminate(): void } | null;
  crearLienzo?: (ancho: number, alto: number) => Lienzo;
}
export interface OpcionesTachado {
  /** Píxeles por punto (2 ≈ 144 ppp). */
  escala?: number;
  signal?: AbortSignal;
  /** Páginas hechas del total. */
  alAvanzar?: (hecho: number, total: number) => void;
  limits?: IoLimits;
  deps?: TacharDeps;
}

/** Una página ya tachada en su lienzo (la vista previa de F3 la puede pintar; el lienzo se libera al volver de `alPagina`). */
/** Zona de un recuadro en píxeles del lienzo, con su detección (F3: el clic sobre el recuadro abre el menú de la etiqueta). */
export interface ZonaTachada { x: number; y: number; w: number; h: number; det?: DetectionId }
export interface PaginaTachada { n: number; total: number; ancho: number; alto: number; lienzo: Lienzo; zonas: ZonaTachada[] }

export const ESCALA_POR_DEFECTO = 2;
/** Tope de píxeles por página (≈ 16 MP): una página enorme baja de escala. */
const MAX_PIXELES = 16_000_000;
/** Margen del recuadro alrededor del tramo, en múltiplos de la altura de la letra. */
const MARGEN_LADO = 0.2;
/** Margen lateral extra en proporción al ancho del ítem (1,5 %): cubre el error de medir letra a letra una línea larga. */
const MARGEN_LINEA = 0.015;
const BAJO_LINEA = 0.3;
const SOBRE_LINEA = 1.05;

async function cargarPdfjsReal(): Promise<PdfjsTachado> {
  return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsTachado;
}

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

type Punto = [number, number];
interface Recuadro { esquinas: Punto[]; etiqueta: string | null; det?: DetectionId }

const LETRA_O_CIFRA = /[\p{L}\p{N}]/u;

/**
 * Fracción del ancho del ítem que ocupan sus primeros `k` caracteres. pdf.js da el ancho del ítem entero, no el de cada letra: se
 * mide con el lienzo en la familia de la fuente del ítem (como hace la capa de texto de pdf.js para la selección). Si no se puede
 * medir, por número de caracteres.
 */
function fraccion(ctx: Contexto2D, str: string, k: number, familia: string): number {
  if (k <= 0) return 0;
  if (k >= str.length) return 1;
  ctx.font = `100px ${familia}`;
  const total = ctx.measureText(str).width;
  const parcial = ctx.measureText(str.slice(0, k)).width;
  return total > 0 && Number.isFinite(parcial) ? Math.min(1, Math.max(0, parcial / total)) : k / str.length;
}

/**
 * Las cuatro esquinas (en píxeles del lienzo) del tramo [a, b) de caracteres del ítem; null si el ítem no trae posición usable.
 * Para no dejar a la vista medio carácter cuando la medida no es exacta: el tramo se amplía hasta el borde de la palabra y el margen
 * lateral crece con el ancho del ítem (el error de la medida crece a lo largo de una línea larga).
 */
function esquinasDe(it: Record<string, unknown>, a0: number, b0: number, vista: VistaPdf, ctx: Contexto2D, familia: string): Punto[] | null {
  const tr = it.transform;
  const str = typeof it.str === 'string' ? it.str : '';
  if (!Array.isArray(tr) || tr.length < 6 || !tr.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  if (typeof it.width !== 'number' || !Number.isFinite(it.width) || str.length === 0) return null;
  const [ta, tb, tc, td, te, tf] = tr as number[];
  const largoU = Math.hypot(ta ?? 0, tb ?? 0);
  const largoV = Math.hypot(tc ?? 0, td ?? 0);
  if (largoU === 0 || largoV === 0) return null;
  const u: Punto = [(ta ?? 0) / largoU, (tb ?? 0) / largoU];
  const v: Punto = [(tc ?? 0) / largoV, (td ?? 0) / largoV];
  const h = typeof it.height === 'number' && it.height > 0 ? it.height : largoV;
  const w = Math.abs(it.width);
  let a = a0;
  let b = b0;
  while (a > 0 && LETRA_O_CIFRA.test(str[a - 1] ?? '')) a--;
  while (b < str.length && LETRA_O_CIFRA.test(str[b] ?? '')) b++;
  const margen = MARGEN_LADO * h + MARGEN_LINEA * w;
  const x0 = a === 0 ? -MARGEN_LADO * h : w * fraccion(ctx, str, a, familia) - margen;
  const x1 = b === str.length ? w + MARGEN_LADO * h : w * fraccion(ctx, str, b, familia) + margen;
  const y0 = -BAJO_LINEA * h;
  const y1 = SOBRE_LINEA * h;
  return ([[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as Punto[]).map(([x, y]) => {
    const px = (te ?? 0) + u[0] * x + v[0] * y;
    const py = (tf ?? 0) + u[1] * x + v[1] * y;
    const [cx, cy] = vista.convertToViewportPoint(px, py);
    return [cx ?? 0, cy ?? 0];
  });
}

/** Recuadros de una página: por cada reemplazo, uno por pieza que toca; la etiqueta va en el primero. null = cubrir la página. */
function recuadrosDe(items: ReadonlyArray<unknown>, estilos: unknown, piezas: PiezaPdf[], cambios: ReadonlyArray<{ ini: number; fin: number; nuevo: string; det?: DetectionId }>,
  vista: VistaPdf, ctx: Contexto2D): Recuadro[] | null {
  const familiaDe = (it: Record<string, unknown>): string => {
    const e = esObjeto(estilos) && typeof it.fontName === 'string' ? estilos[it.fontName] : undefined;
    const f = esObjeto(e) && typeof e.fontFamily === 'string' ? e.fontFamily : '';
    return /^(sans-serif|serif|monospace)$/u.test(f) ? f : 'sans-serif';
  };
  const out: Recuadro[] = [];
  for (const c of cambios) {
    let etiqueta: string | null = c.nuevo;
    for (const p of piezas) {
      if (p.ini >= c.fin || p.fin <= c.ini) continue;
      const it = items[p.item];
      if (!esObjeto(it) || typeof it.str !== 'string') return null;
      const [a, b] = p.desde < 0
        ? [0, it.str.length]
        : [p.desde + Math.max(c.ini, p.ini) - p.ini, p.desde + Math.min(c.fin, p.fin) - p.ini];
      const esquinas = esquinasDe(it, a, b, vista, ctx, familiaDe(it));
      if (esquinas === null) return null;
      out.push(c.det === undefined ? { esquinas, etiqueta } : { esquinas, etiqueta, det: c.det });
      etiqueta = null;
    }
  }
  return out;
}

function pintar(ctx: Contexto2D, r: Recuadro): void {
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  r.esquinas.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
  ctx.closePath();
  ctx.fill();
  if (r.etiqueta === null || r.etiqueta === '') return;
  const xs = r.esquinas.map((p) => p[0]);
  const ys = r.esquinas.map((p) => p[1]);
  const ancho = Math.max(...xs) - Math.min(...xs);
  const alto = Math.max(...ys) - Math.min(...ys);
  let tam = Math.floor(alto * 0.62);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (; tam >= 6; tam--) {
    ctx.font = `${tam}px sans-serif`;
    if (ctx.measureText(r.etiqueta).width <= ancho * 0.94) break;
  }
  if (tam < 6) return; // no cabe legible: queda el recuadro solo
  ctx.fillStyle = '#ffffff';
  ctx.fillText(r.etiqueta, (Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2);
}

/** Etiqueta de una página cubierta entera, según el motivo. */
const ETIQUETA_CUBIERTA: Readonly<Record<MotivoCubierta, string>> = {
  excluida: '[PÁGINA EXCLUIDA]', sin_texto: '[PÁGINA NO ANALIZADA]', ilegible: '[PÁGINA NO ANALIZADA]', sin_mapa: '[PÁGINA CUBIERTA]',
};

/** Cubre la página entera (sin haber dibujado el original) con su etiqueta en el centro. */
function zonaDe(r: Recuadro): ZonaTachada {
  const xs = r.esquinas.map((p) => p[0]);
  const ys = r.esquinas.map((p) => p[1]);
  const z: ZonaTachada = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  if (r.det !== undefined) z.det = r.det;
  return z;
}

function cubrirPagina(l: Lienzo, motivo: MotivoCubierta): void {
  l.ctx.fillStyle = '#000000';
  l.ctx.fillRect(0, 0, l.ancho, l.alto);
  const tam = Math.max(8, Math.floor(l.ancho / 28));
  l.ctx.font = `${tam}px sans-serif`;
  l.ctx.textAlign = 'center';
  l.ctx.textBaseline = 'middle';
  l.ctx.fillStyle = '#ffffff';
  l.ctx.fillText(ETIQUETA_CUBIERTA[motivo], l.ancho / 2, l.alto / 2);
}

/**
 * Por qué una página sale cubierta entera:
 *   · `excluida`: el abogado excluyó su parte;
 *   · `sin_texto`: no tiene parte o tiene menos de `pdfMinCharsPerPage` caracteres útiles (escaneada, «Folio 3» sobre una imagen);
 *   · `ilegible`: el lector avisó `TEXTO_ILEGIBLE` (lo que se ve no es lo que se analizó);
 *   · `sin_mapa`: no se pudo ubicar el texto en la página.
 * A-20 (P0-6a): lo que no se analizó no sale; que el abogado incluya una página así a propósito lo decide el dueño (D-22).
 */
export type MotivoCubierta = 'excluida' | 'sin_texto' | 'ilegible' | 'sin_mapa';
export interface PaginaCubierta { page: number; motivo: MotivoCubierta }

export interface ResultadoTachado {
  /** `PAGINA_SIN_TEXTO` y `TEXTO_ILEGIBLE` de las páginas que se cubrieron por eso (con su página), para M-310. */
  avisos: ParseWarning[];
  /** Todas las páginas cubiertas enteras y por qué. */
  paginasCubiertas: PaginaCubierta[];
  /** Imágenes dibujadas en las páginas que salen con su contenido (firmas, sellos, documentos pegados): pasan tal cual (V-56). */
  imagenes: number;
  paginasConImagenes: number[];
}

/** Operadores de pdf.js que pintan una imagen (nombres de `OPS`). */
const OPERADORES_IMAGEN = [
  'paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject', 'paintImageXObjectRepeat',
  'paintInlineImageXObjectGroup', 'paintImageMaskXObjectGroup', 'paintImageMaskXObjectRepeat', 'paintSolidColorImageMask',
] as const;

/**
 * Dibuja cada página del original con sus recuadros y la entrega a `alPagina` (en orden). Rechaza con SiglowError(code) o
 * LecturaCancelada. Una página que no se analizó, se excluyó o no se pudo mapear se cubre entera sin dibujar el original.
 */
export async function tacharPaginas(original: Uint8Array, doc: DocumentModel, out: RenderedOutput,
  alPagina: (p: PaginaTachada) => void | Promise<void>, o: OpcionesTachado = {}): Promise<ResultadoTachado> {
  if (doc.source !== 'pdf' || out.docId !== doc.id) throw new SiglowError('FORMATO_NO_ADMITIDO');
  const limits = o.limits ?? IO_LIMITS_POR_DEFECTO;
  if (original.byteLength === 0 || original.byteLength > limits.maxFileBytes) throw new SiglowError('ARCHIVO_DEMASIADO_GRANDE');
  const deps = o.deps ?? {};
  const crearLienzo = deps.crearLienzo ?? crearLienzoNavegador;
  const escalaBase = o.escala ?? ESCALA_POR_DEFECTO;
  const cancelado = (): boolean => o.signal?.aborted === true;
  let tarea: { destroy(): Promise<void> | void } | undefined;
  let workerPdfjs: { destroy(): void } | undefined;
  let worker: { terminate(): void } | null = null;
  // pdf.js toma la propiedad de lo que recibe: una copia que se pone en cero al terminar; el original no se toca.
  const datos = original.slice();
  try {
    if (cancelado()) throw new LecturaCancelada();
    const lib = await (deps.cargarPdfjs ?? cargarPdfjsReal)();
    const params: Record<string, unknown> = {
      data: datos, disableFontFace: true, useSystemFonts: false, verbosity: 0, enableXfa: false,
      useWasm: false, useWorkerFetch: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
    };
    worker = (deps.crearWorker ?? crearWorkerPdfjs)();
    if (worker !== null) { workerPdfjs = new lib.PDFWorker({ port: worker }); params.worker = workerPdfjs; }
    const t = lib.getDocument(params);
    tarea = t;
    const pdf = await t.promise;
    const total = pdf.numPages;
    const r: ResultadoTachado = { avisos: [], paginasCubiertas: [], imagenes: 0, paginasConImagenes: [] };
    const partes = new Map(doc.parts.filter((p) => p.kind === 'pagina_pdf' && p.page !== undefined).map((p) => [p.page as number, p]));
    const avisoDe = (code: 'PAGINA_SIN_TEXTO' | 'TEXTO_ILEGIBLE', n: number): ParseWarning | undefined =>
      doc.warnings.find((w) => w.code === code && w.page === n);
    const codigosImagen = new Set(OPERADORES_IMAGEN.map((k) => lib.OPS?.[k]).filter((v): v is number => typeof v === 'number'));
    for (let n = 1; n <= total; n++) {
      if (cancelado()) throw new LecturaCancelada();
      const pagina = await pdf.getPage(n);
      const base = pagina.getViewport({ scale: 1 });
      const escala = Math.min(escalaBase, Math.sqrt(MAX_PIXELES / Math.max(1, base.width * base.height)));
      const vista = pagina.getViewport({ scale: escala });
      const lienzo = crearLienzo(Math.max(1, Math.ceil(vista.width)), Math.max(1, Math.ceil(vista.height)));
      try {
        lienzo.ctx.fillStyle = '#ffffff';
        lienzo.ctx.fillRect(0, 0, lienzo.ancho, lienzo.alto);
        const parte = partes.get(n);
        const sec = parte !== undefined && parte.included ? out.sections.find((s) => s.partId === parte.id) : undefined;
        const zonas: ZonaTachada[] = [];
        const utiles = parte === undefined ? 0 : parte.text.replace(/\s/gu, '').length;
        let motivo: MotivoCubierta | null = null;
        if (parte === undefined || utiles < limits.pdfMinCharsPerPage || avisoDe('PAGINA_SIN_TEXTO', n) !== undefined) {
          motivo = 'sin_texto';
          r.avisos.push({ code: 'PAGINA_SIN_TEXTO', page: n, count: 1 });
        } else if (avisoDe('TEXTO_ILEGIBLE', n) !== undefined) {
          motivo = 'ilegible';
          r.avisos.push({ code: 'TEXTO_ILEGIBLE', page: n, count: avisoDe('TEXTO_ILEGIBLE', n)?.count ?? 1 });
        } else if (sec === undefined) {
          motivo = 'excluida';
        } else {
          const { items, styles } = await pagina.getTextContent();
          const leida = textoDePagina(items);
          if (leida.texto !== parte.text) throw new SiglowError('ERROR_INTERNO'); // el original no es el documento analizado
          const recuadros = leida.piezas === null ? null : recuadrosDe(items, styles, leida.piezas, cambiosDe(parte, sec), vista, lienzo.ctx);
          if (recuadros === null) motivo = 'sin_mapa';
          else {
            await pagina.render({ canvasContext: lienzo.ctx, canvas: lienzo.canvas, viewport: vista, annotationMode: lib.AnnotationMode.DISABLE }).promise;
            for (const x of recuadros) { pintar(lienzo.ctx, x); zonas.push(zonaDe(x)); }
            // M-122: las imágenes de una página que sale con su contenido pasan tal cual; se cuentan para que la interfaz avise.
            const lista = codigosImagen.size > 0 ? await pagina.getOperatorList?.({ annotationMode: lib.AnnotationMode.DISABLE }) : undefined;
            const imagenes = Array.from(lista?.fnArray ?? []).filter((f) => codigosImagen.has(f)).length;
            if (imagenes > 0) { r.imagenes += imagenes; r.paginasConImagenes.push(n); }
          }
        }
        if (motivo !== null) {
          cubrirPagina(lienzo, motivo); // el original de esta página nunca se dibuja
          r.paginasCubiertas.push({ page: n, motivo });
        }
        await alPagina({ n, total, ancho: base.width, alto: base.height, lienzo, zonas });
      } finally {
        lienzo.liberar();
        pagina.cleanup();
      }
      o.alAvanzar?.(n, total);
    }
    return r;
  } catch (e) {
    throw codigoPdf(e);
  } finally {
    try { void Promise.resolve(tarea?.destroy()).catch(() => undefined); } catch { /* sin efecto */ }
    try { workerPdfjs?.destroy(); } catch { /* sin efecto */ }
    try { worker?.terminate(); } catch { /* sin efecto */ }
    if (datos.byteLength > 0) datos.fill(0);
  }
}

export interface PdfTachado extends ResultadoTachado { bytes: Uint8Array }

/** RGB (3 bytes por píxel) del lienzo, sobre fondo blanco. */
function rgbDe(l: Lienzo): Uint8Array {
  const rgba = l.ctx.getImageData(0, 0, l.ancho, l.alto).data;
  const rgb = new Uint8Array(l.ancho * l.alto * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i] ?? 255; rgb[j + 1] = rgba[i + 1] ?? 255; rgb[j + 2] = rgba[i + 2] ?? 255;
  }
  rgba.fill(0);
  return rgb;
}

/**
 * Construye el PDF tachado (asíncrono: F3 lo arma antes del clic de «Descargar PDF» y descarga con `descargarPdfTachado`).
 * `original` son los bytes guardados en memoria (`originalDe(doc.id)`); no se modifican.
 */
export async function construirPdfTachado(original: Uint8Array, doc: DocumentModel, out: RenderedOutput, o: OpcionesTachado = {}): Promise<PdfTachado> {
  const paginas: PaginaImagen[] = [];
  try {
    const r = await tacharPaginas(original, doc, out, (p) => {
      paginas.push({ ancho: p.ancho, alto: p.alto, pixAncho: p.lienzo.ancho, pixAlto: p.lienzo.alto, rgb: rgbDe(p.lienzo) });
    }, o);
    return { ...r, bytes: pdfDeImagenes(paginas) };
  } finally {
    for (const p of paginas) p.rgb.fill(0);
  }
}

/** Descarga un PDF tachado ya construido con nombre neutro (6.9). Síncrona: va en el manejador del clic. */
export function descargarPdfTachado(pdf: PdfTachado, opciones: OpcionesExportacion = {}): ResultadoExportacion {
  const nombre = nombreDescarga(opciones.clase ?? 'anonimizado', 'pdf', opciones.ahora);
  descargarPdf(pdf.bytes, nombre);
  return { nombre, bytes: pdf.bytes.length, avisos: pdf.avisos };
}
