// Lector de PDF (PE-4, 6.11.5): pdfjs-dist 6.4.299 legacy con su worker de módulo del mismo origen (F-09, nunca un blob).
// Corre en el hilo principal como adaptador sobre el worker de pdf.js: tiempo límite con loadingTask.destroy() (6.11.6),
// cancelación por AbortSignal y errores solo con ErrorCode (INV-W01, INV-W02): nunca se lee `message` ni `stack`.
// Texto canónico (6.1.1): una `pagina_pdf` por página y una `anotacion_pdf` por anotación con contenido.
// Autores, metadatos y XMP solo se cuentan en el inventario (V-39); ningún valor sale del lector (INV-D03, INV-D04).
import { SiglowError } from '../core/types';
import type {
  DocumentModel, IdSource, MetadataCategory, ParseWarning, Part, PartId, ReadPdfFn,
} from '../core/types';
import { LecturaCancelada } from './io-client';
import { canonico, randomIds } from './txt-read';

/** Proporción de caracteres ilegibles (U+FFFD o U+E000–U+F8FF) de una página a partir de la cual se avisa. [VERIFICAR y calibrar con un PDF sin ToUnicode real] */
export const UMBRAL_ILEGIBLE = 0.2;
/** Mínimo de caracteres ilegibles en la página para avisar (evita avisar por un único carácter suelto). */
export const MIN_ILEGIBLES = 2;

// ---------- Lo mínimo que se usa de pdf.js (permite inyectar uno falso en las pruebas) ----------
export interface PdfAnotacion { subtype?: unknown; contentsObj?: unknown; titleObj?: unknown }
export interface PdfPagina {
  getTextContent(): Promise<{ items: ReadonlyArray<unknown> }>;
  getAnnotations(opts: { intent: string }): Promise<ReadonlyArray<unknown>>;
  cleanup(): unknown;
}
export interface PdfDocumento {
  numPages: number;
  getPage(n: number): Promise<PdfPagina>;
  getMetadata(): Promise<{ info?: unknown; metadata?: unknown }>;
  /** Adjuntos del documento (en 6.4.299 un `Map`; antes un objeto). Solo se cuentan. */
  getAttachments?(): Promise<unknown>;
  /** Marcadores (árbol de títulos). Solo se cuentan. */
  getOutline?(): Promise<unknown>;
}
export interface PdfTarea { promise: Promise<PdfDocumento>; destroy(): Promise<void> | void }
export interface PdfWorkerPdfjs { destroy(): void }
export interface PdfjsLib {
  getDocument(params: Record<string, unknown>): PdfTarea;
  PDFWorker: new (params: { port: unknown }) => PdfWorkerPdfjs;
}

/** Worker de módulo del mismo origen (F-09): Vite lo emite como archivo propio en /assets/ (PD-1 lo agrega al precache). */
export function crearWorkerPdfjs(): Worker | null {
  if (typeof Worker === 'undefined') return null; // Node (pruebas): pdf.js usa su worker simulado
  return new Worker(new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url), { type: 'module' });
}

async function cargarPdfjs(): Promise<PdfjsLib> {
  return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsLib;
}

export interface PdfDeps {
  ids?: IdSource;
  cargarPdfjs?: () => Promise<PdfjsLib>;
  /** `null` = sin worker propio (pdf.js usa el simulado). */
  crearWorker?: () => { terminate(): void } | null;
}

// ---------- Utilidades ----------
function esObjeto(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
function cadenaDe(x: unknown): string {
  return esObjeto(x) && typeof x.str === 'string' ? x.str : '';
}
function sinBlancos(s: string): number {
  return s.replace(/\s/g, '').length;
}
/** Texto canónico de una parte PDF: CRLF → LF, NFC y sin saltos de línea finales (6.1.1). */
function canonicoPdf(s: string): string {
  return canonico(s).replace(/\n+$/, '');
}
function esIlegible(c: number): boolean {
  return c === 0xfffd || (c >= 0xe000 && c <= 0xf8ff);
}
function contarIlegibles(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (esIlegible(s.charCodeAt(i))) n++;
  return n;
}

/** Traduce lo lanzado a un código. Solo lee `name` (nunca `message` ni `stack`). */
export function codigoPdf(e: unknown): SiglowError | LecturaCancelada {
  if (e instanceof SiglowError || e instanceof LecturaCancelada) return e;
  if (e instanceof RangeError) return new SiglowError('MEMORIA');
  let nombre = '';
  try { nombre = esObjeto(e) && typeof e.name === 'string' ? e.name : ''; } catch { nombre = ''; }
  if (nombre === 'PasswordException') return new SiglowError('PDF_CON_CONTRASENA');
  return new SiglowError('PDF_DANADO');
}

interface Pagina { texto: string; saltosOrden: number }

/**
 * Aviso de PE-4 (PB-2-r10; CIERRE-1, D-19.9) · Hueco ancho entre dos fragmentos del mismo renglón, en múltiplos de la altura de la
 * letra: la separación entre las celdas de una fila de tabla. Un espacio entre palabras mide ≈ 0,25 de la altura; dos alturas no
 * las alcanza ni un texto justificado.
 */
export const HUECO_DE_CELDA = 2;
/** La posición que pdf.js da de un fragmento sin rotar: x e y del origen, ancho y alto. null si falta o el texto está girado. */
function posicionDe(it: Record<string, unknown>): { x: number; y: number; ancho: number; alto: number } | null {
  const tr = it.transform;
  if (!Array.isArray(tr) || tr.length < 6 || !tr.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  if (tr[1] !== 0 || tr[2] !== 0 || typeof it.width !== 'number' || !Number.isFinite(it.width) || it.width < 0) return null;
  const alto = typeof it.height === 'number' && it.height > 0 ? it.height : Math.abs(tr[3] as number);
  return alto > 0 ? { x: tr[4] as number, y: tr[5] as number, ancho: it.width, alto } : null;
}

/**
 * Concatena los `str` con '\n' cuando `hasEOL` (6.1.1) y cuenta los saltos hacia arriba del flujo (orden no visual).
 * Aviso de PE-4 (D-19.9): entre dos fragmentos del mismo renglón separados por un hueco ancho (`HUECO_DE_CELDA`), cuando pdf.js da
 * la posición, el lector emite un tabulador en lugar de los blancos que pdf.js puso (o de nada): las celdas de una fila de tabla
 * quedan separadas como en un .docx, y R-RAD_ADMIN-03 (M-70) las ve aunque pdf.js entregue un solo espacio. Lo demás no cambia.
 */
function textoDePagina(items: ReadonlyArray<unknown>): Pagina {
  let texto = '';
  let saltos = 0;
  let yAnterior: number | null = null;
  let altoAnterior = 0;
  /** El último fragmento con letras, si desde él no hubo fin de renglón: dónde acaba en la página y dónde acaba en `texto`. */
  let previo: { finX: number; y: number; alto: number; finTexto: number } | null = null;
  for (const it of items) {
    if (!esObjeto(it) || typeof it.str !== 'string') continue;
    const conLetras = it.str.trim() !== '';
    const pos = conLetras ? posicionDe(it) : null;
    if (conLetras && pos !== null && previo !== null) {
      const hueco = pos.x - previo.finX;
      const mismoRenglon = Math.abs(pos.y - previo.y) <= Math.min(pos.alto, previo.alto) / 2;
      const entre = texto.slice(previo.finTexto);
      const inicioBlancos = it.str.length - it.str.trimStart().length;
      if (mismoRenglon && hueco >= HUECO_DE_CELDA * Math.max(pos.alto, previo.alto) && /^[ \t ]*$/u.test(entre)) {
        texto = `${texto.slice(0, previo.finTexto)}\t`;
        texto += it.str.slice(inicioBlancos);
      } else texto += it.str;
    } else texto += it.str;
    if (conLetras) {
      previo = pos === null ? null : { finX: pos.x + pos.ancho, y: pos.y, alto: pos.alto, finTexto: texto.length - (it.str.length - it.str.trimEnd().length) };
    }
    if (it.hasEOL === true) { texto += '\n'; previo = null; }
    if (!conLetras) continue;
    const tr = it.transform;
    const y = Array.isArray(tr) && typeof tr[5] === 'number' ? tr[5] : null;
    const alto = typeof it.height === 'number' && it.height > 0 ? it.height : 1;
    // En el orden visual la ordenada solo baja (origen abajo a la izquierda). Subir más de una altura de letra
    // entre dos fragmentos consecutivos es la firma de columnas, tablas o pies escritos antes del cuerpo.
    if (y !== null && yAnterior !== null && y - yAnterior > Math.max(altoAnterior, 4)) saltos++;
    if (y !== null) { yAnterior = y; altoAnterior = alto; }
  }
  return { texto: canonicoPdf(texto), saltosOrden: saltos };
}

/**
 * Valores de campos de formulario con texto (`Tx`) u opción (`Ch`), incluidos los de campos ocultos (V-39). Las casillas,
 * los botones de opción y los botones (`Btn`) no se leen. El nombre del campo (`T`) nunca se guarda.
 */
function valoresDeCampo(an: Record<string, unknown>): string[] {
  if (an.subtype !== 'Widget' || (an.fieldType !== 'Tx' && an.fieldType !== 'Ch')) return [];
  const v = an.fieldValue;
  if (typeof v === 'string') return [v];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function contarAdjuntos(x: unknown): number {
  if (x instanceof Map) return x.size;
  return esObjeto(x) ? Object.keys(x).length : 0;
}

/** Cuenta los marcadores del árbol de títulos (con tope, por si el árbol es hostil). */
function contarMarcadores(x: unknown): number {
  let n = 0;
  const pila: unknown[] = Array.isArray(x) ? [...x] : [];
  while (pila.length > 0 && n < 1_000_000) {
    const it = pila.pop();
    if (!esObjeto(it)) continue;
    n++;
    if (Array.isArray(it.items)) pila.push(...it.items);
  }
  return n;
}

const INFO_IGNORADA: ReadonlySet<string> = new Set([
  'PDFFormatVersion', 'Language', 'EncryptFilterName', 'IsLinearized', 'IsAcroFormPresent', 'IsXFAPresent',
  'IsCollectionPresent', 'IsSignaturesPresent', 'Custom',
]);

/** Solo presencia y número de apariciones (6.3.3); nunca un valor. */
function contarInfo(info: unknown): number {
  if (!esObjeto(info)) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(info)) {
    if (INFO_IGNORADA.has(k)) continue;
    if (typeof v === 'string' && v.trim() !== '') n++;
  }
  if (esObjeto(info.Custom)) n += Object.keys(info.Custom).length;
  return n;
}

/**
 * Crea un lector con dependencias inyectables. `readPdf` es el de producción.
 * Rechaza con SiglowError(code) o LecturaCancelada; el buffer recibido queda en cero al terminar (T-PV-04).
 */
export function crearReadPdf(deps: PdfDeps = {}): ReadPdfFn {
  return async function leerPdf(bytes, ctx, onProgress, signal): Promise<DocumentModel> {
    const { limits } = ctx;
    const ids = deps.ids ?? randomIds();
    let tarea: PdfTarea | undefined;
    let datos: Uint8Array | undefined;
    let workerPdfjs: PdfWorkerPdfjs | undefined;
    let worker: { terminate(): void } | null = null;
    let terminado = false;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    let alAbortar: (() => void) | undefined;

    const liberar = (): void => {
      terminado = true;
      if (temporizador !== undefined) clearTimeout(temporizador);
      if (alAbortar !== undefined) signal.removeEventListener('abort', alAbortar);
      // No se espera: si el worker de pdf.js está atascado, destroy() nunca respondería.
      try { void Promise.resolve(tarea?.destroy()).catch(() => undefined); } catch { /* sin efecto */ }
      try { workerPdfjs?.destroy(); } catch { /* sin efecto */ }
      try { worker?.terminate(); } catch { /* sin efecto */ }
      if (!bytes.detached) new Uint8Array(bytes).fill(0);
      // La copia que recibió pdf.js: si no se transfirió al worker (worker simulado o clonada), se pone en cero también.
      if (datos !== undefined && datos.byteLength > 0) datos.fill(0); // byteLength 0 = ya transferida
    };

    // Vence el tiempo o se cancela: rechaza la carrera; el `finally` destruye la tarea.
    const parada = new Promise<never>((_, rechazar) => {
      temporizador = setTimeout(() => { rechazar(new SiglowError('TIEMPO_AGOTADO')); }, limits.timeoutMs);
      alAbortar = (): void => { rechazar(new LecturaCancelada()); };
      signal.addEventListener('abort', alAbortar, { once: true });
    });
    parada.catch(() => undefined);

    const extraer = async (): Promise<DocumentModel> => {
      if (bytes.byteLength === 0) throw new SiglowError('ARCHIVO_VACIO');
      if (bytes.byteLength > limits.maxFileBytes) throw new SiglowError('ARCHIVO_DEMASIADO_GRANDE');
      if (signal.aborted) throw new LecturaCancelada();
      let lib: PdfjsLib;
      try { lib = await (deps.cargarPdfjs ?? cargarPdfjs)(); } catch { throw new SiglowError('ERROR_INTERNO'); }
      if (terminado) throw new LecturaCancelada();
      // pdf.js toma la propiedad de lo que recibe: se le da una copia y el original se pone en cero al terminar.
      datos = new Uint8Array(bytes.slice(0));
      const params: Record<string, unknown> = {
        data: datos, disableFontFace: true, useSystemFonts: false, verbosity: 0, enableXfa: false,
        // Sin recursos opcionales (4.6.2): ni fuentes, ni cmaps, ni wasm; nada sale a la red.
        // `isEvalSupported` ya no existe en 6.4.299 (no figura en pdf.mjs ni en el worker): no hay nada que desactivar.
        useWasm: false, useWorkerFetch: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
      };
      try {
        worker = (deps.crearWorker ?? crearWorkerPdfjs)();
        if (worker !== null) {
          workerPdfjs = new lib.PDFWorker({ port: worker });
          params.worker = workerPdfjs;
        }
        tarea = lib.getDocument(params);
      } catch { throw new SiglowError('ERROR_INTERNO'); }
      // Sin `onPassword`: la contraseña nunca se pide (PasswordException → PDF_CON_CONTRASENA).
      const pdf = await tarea.promise;
      const total = pdf.numPages;
      if (!Number.isInteger(total) || total < 1) throw new SiglowError('PDF_DANADO');

      const partesPagina: Part[] = [];
      const partesNota: Array<{ page: number; text: string }> = [];
      const advertencias: ParseWarning[] = [];
      let paginasSinTexto = 0;
      let conAutor = 0;
      let enlaces = 0;
      let adjuntos = 0;
      let firmas = 0;
      onProgress(0, total);
      for (let n = 1; n <= total; n++) {
        if (terminado) throw new LecturaCancelada();
        const pagina = await pdf.getPage(n);
        const { items } = await pagina.getTextContent();
        const { texto, saltosOrden } = textoDePagina(items);
        const utiles = sinBlancos(texto);
        let partId: PartId | undefined;
        if (utiles > 0) {
          partId = ids.next('prt') as PartId;
          partesPagina.push({
            id: partId, docId: ctx.docId, kind: 'pagina_pdf', label: `Página ${n}`, order: 0,
            index: partesPagina.length + 1, page: n, text: texto, included: true,
          });
        }
        if (utiles < limits.pdfMinCharsPerPage) {
          paginasSinTexto++;
          advertencias.push({ code: 'PAGINA_SIN_TEXTO', page: n, count: 1 });
          // Más páginas vacías de las toleradas: no hace falta leer el resto (escaneado).
          if (paginasSinTexto / total > limits.pdfMaxScannedRatio) throw new SiglowError('PDF_SIN_CAPA_TEXTO');
        }
        const ilegibles = contarIlegibles(texto);
        if (ilegibles >= MIN_ILEGIBLES && ilegibles / utiles > UMBRAL_ILEGIBLE) {
          advertencias.push({ code: 'TEXTO_ILEGIBLE', ...(partId !== undefined ? { partId } : {}), page: n, count: ilegibles });
        }
        if (saltosOrden > 0) {
          advertencias.push({ code: 'ORDEN_LECTURA_PDF', ...(partId !== undefined ? { partId } : {}), page: n, count: saltosOrden });
        }
        // `intent: any` incluye también las anotaciones ocultas o que no se imprimen (V-39).
        for (const an of await pagina.getAnnotations({ intent: 'any' })) {
          if (!esObjeto(an) || an.subtype === 'Popup') continue; // la ventana emergente repite el contenido de su anotación
          if (cadenaDe(an.titleObj).trim() !== '') conAutor++; // solo se cuenta: el autor nunca se guarda
          // El URI de un enlace y el archivo de un adjunto no se leen: solo se cuentan (CONTENIDO_PDF_NO_LEIDO).
          if (an.subtype === 'Link' && (typeof an.url === 'string' || typeof an.unsafeUrl === 'string')) enlaces++;
          if (an.subtype === 'FileAttachment') adjuntos++;
          // B-12: pdf.js no extrae el texto de la apariencia de una firma («Firmado digitalmente por …»): se cuenta como no leído.
          if (an.subtype === 'Widget' && an.fieldType === 'Sig' && an.hasAppearance === true) firmas++;
          for (const crudo of [cadenaDe(an.contentsObj), ...valoresDeCampo(an)]) {
            const t = canonicoPdf(crudo);
            if (t.trim() !== '') partesNota.push({ page: n, text: t });
          }
        }
        pagina.cleanup();
        onProgress(n, total);
      }

      // Adjuntos y marcadores del documento: solo se cuentan.
      let marcadores = 0;
      try { adjuntos += contarAdjuntos(await pdf.getAttachments?.()); } catch { /* sin conteo */ }
      try { marcadores = contarMarcadores(await pdf.getOutline?.()); } catch { /* sin conteo */ }
      const noLeido = enlaces + adjuntos + marcadores + firmas;
      if (noLeido > 0) advertencias.push({ code: 'CONTENIDO_PDF_NO_LEIDO', count: noLeido });

      // Inventario: solo presencia y número (6.3.3).
      const categorias: Partial<Record<MetadataCategory, { count: number }>> = {};
      try {
        const meta = await pdf.getMetadata();
        const props = contarInfo(meta.info);
        if (props > 0) categorias.pdf_propiedades = { count: props };
        if (meta.metadata !== null && meta.metadata !== undefined) categorias.pdf_xmp = { count: 1 };
      } catch { /* el inventario es opcional: sin él no se cuenta nada */ }
      if (conAutor > 0) categorias.pdf_autores_anotaciones = { count: conAutor };
      if (enlaces > 0) categorias.vinculos_externos = { count: enlaces };
      if (adjuntos > 0) categorias.objetos_y_macros = { count: adjuntos };

      // Orden de lectura canónico (6.3.1): todas las páginas (rango 1) y luego todas las anotaciones (rango 5).
      const partes: Part[] = partesPagina.map((p, i) => ({ ...p, order: i }));
      partesNota.forEach((a, i) => {
        partes.push({
          id: ids.next('prt') as PartId, docId: ctx.docId, kind: 'anotacion_pdf',
          label: `Anotación ${i + 1} (página ${a.page})`, order: partes.length, index: i + 1, page: a.page, text: a.text, included: true,
        });
      });
      return { id: ctx.docId, label: ctx.label, source: 'pdf', parts: partes, metadata: { categories: categorias }, warnings: advertencias };
    };

    try {
      return await Promise.race([extraer(), parada]);
    } catch (e) {
      throw codigoPdf(e);
    } finally {
      liberar();
    }
  };
}

/** Lector de producción (6.11.5). */
export const readPdf: ReadPdfFn = crearReadPdf();
