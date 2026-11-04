// Acciones de la pantalla Listo (8.2.7): copiar, vaciar el portapapeles, descargar .txt, .docx e informe. Todas vuelven a evaluar
// `exportGate` con lo vigente y no actúan si `ok` es falso (INV-G06, INV-X05); todas consolidan la numeración (6.6.4) de forma
// síncrona en el mismo manejador del clic, antes de que el texto salga. `writeText`, `exportarTxt` y `exportarDocx` se llaman sin
// ningún `await` antes: la activación del usuario vence con las esperas. Los errores salen solo como `ErrorCode` (F-12).
import { consolidate, emptyTable } from '../../core/entities.ts';
import { joinOutput, render } from '../../core/render.ts';
import { buildReport, isoBogota, reportToJson, reportToText } from '../../core/report.ts';
import type { AsuntoId, MappingTable, ReviewState, DocumentModel } from '../../core/types.ts';
import { SiglowError } from '../../core/types.ts';
import { exportarDocx } from '../../io/docx-write.ts';
import { exportarDocxFiel } from '../../io/docx-write-fiel.ts';
import { originalDe } from '../../io/original.ts';
import { construirPdfTachado, descargarPdfTachado } from '../../io/pdf-tachar.ts';
import type { PaginaCubierta, PdfTachado } from '../../io/pdf-tachar.ts';
import { exportarPdf } from '../../io/pdf-write.ts';
import { descargarBytes, exportarTxt, nombreDescarga, revocarUrlsVivas } from '../../io/txt-write.ts';
import type { ResultadoExportacion } from '../../io/txt-write.ts';
import { OPCIONES_DETECCION } from '../analisis.ts';
import { obtenerDocumento, obtenerRevision, fijarRevision } from '../documento.ts';
import { actualizar, obtener } from '../estado.ts';
import { idDeCodigo } from '../mensajes.ts';
import { codigoDeError, puertos } from '../servicios.ts';
import { fijarTabla, obtenerListaDelCaso, obtenerTabla, registrarLimpieza } from '../sesion.ts';
import { actualizarListo, confirmacionVigente, obtenerListo, ponerAviso, puertaDe, type AvisoListo } from './almacen.ts';

// Las URL `blob:` vivas se revocan al bloquear y en `pagehide` (V-48, INV-X06); `descargarBytes` ya revoca en el mismo manejador.
registrarLimpieza(revocarUrlsVivas);

interface Vigente { doc: DocumentModel; state: ReviewState }

/** Estado vigente con la puerta abierta; null si falta algo o la puerta está cerrada (cada manejador la evalúa de nuevo). */
function conPuertaAbierta(): Vigente | null {
  const doc = obtenerDocumento();
  const state = obtenerRevision();
  if (doc === null || state === null || !puertaDe(state).ok) return null;
  return { doc, state };
}

/** 6.6.4 · Primer copiar o exportar (y los siguientes): la numeración pasa a definitiva y la tabla del asunto se actualiza. Síncrona. */
function consolidarAhora({ doc, state }: Vigente): MappingTable {
  const asunto = obtener().asunto;
  const base = obtenerTabla() ?? emptyTable((asunto?.asuntoId ?? 'asu_') as AsuntoId);
  const r = consolidate(base, state, doc, isoBogota(new Date()));
  fijarTabla(r.table);
  fijarRevision(r.state);
  if (asunto !== null) actualizar({ asunto: { ...asunto, tableRevision: asunto.tableRevision + 1 } });
  return r.table;
}

function agregarAviso(a: AvisoListo): void {
  const previos = obtenerListo().avisos.filter((x) => x.id !== a.id || x.alterno !== a.alterno);
  ponerAviso([...previos, a]);
}

/** Después de consolidar: «Guardar» guarda cifrado (M-90 o el error, M-91 con la cuota); «No guardar» recuerda exportar la tabla (M-90). */
function respaldarTabla(tabla: MappingTable): void {
  const asunto = obtener().asunto;
  if (asunto === null) return;
  if (asunto.mode === 'guardar') {
    const asuntoId = asunto.asuntoId;
    puertos.boveda.guardar(asuntoId, { caseList: obtenerListaDelCaso(), table: tabla }).then(() => {
      const a = obtener().asunto;
      if (a !== null) actualizar({ asunto: { ...a, backedUpRevision: a.tableRevision } });
      agregarAviso({ id: 'M-90', rol: 'status' });
    }, (e: unknown) => { agregarAviso({ id: idDeCodigo(codigoDeError(e), 'tabla'), rol: 'alert' }); });
  }
  // «No guardar»: el recordatorio de exportar la tabla cifrada (M-90, segunda variante) lo muestra la pantalla de forma permanente.
}

function errorDeAccion(e: unknown): void {
  ponerAviso([{ id: idDeCodigo(codigoDeError(e)), rol: 'alert' }]);
}

/** Copia hecha: M-84 y M-85 (historial del portapapeles), y la tabla se respalda. */
function copiaHecha(tabla: MappingTable): void {
  ponerAviso([{ id: 'M-84', rol: 'status' }, { id: 'M-85', rol: 'status' }]);
  actualizarListo({ copiado: true, respaldo: null });
  respaldarTabla(tabla);
}

/** «Copiar texto anonimizado» (principal). El texto ya está calculado; `writeText` se llama sin ningún `await` antes. */
export function copiarConBoton(): void {
  const v = conPuertaAbierta();
  if (v === null) return;
  const texto = joinOutput(render(v.doc, v.state), '\n');
  const tabla = consolidarAhora(v);
  let promesa: Promise<void> | null = null;
  try {
    promesa = navigator.clipboard.writeText(texto);
  } catch {
    promesa = null;
  }
  const respaldoManual = (): void => {
    // El navegador no dejó copiar: el área de respaldo (M-87) ya tiene el texto anonimizado seleccionado.
    ponerAviso([{ id: 'M-87', rol: 'alert' }]);
    actualizarListo({ copiado: true, respaldo: texto });
    respaldarTabla(tabla);
  };
  if (promesa === null) respaldoManual();
  else promesa.then(() => { copiaHecha(tabla); }, respaldoManual);
}

/**
 * Ctrl+C sobre la vista de salida (8.7): siempre lo atiende el manejador propio. Con la puerta cerrada no escribe nada y muestra
 * M-73; con la puerta abierta escribe solo `text/plain` con la subcadena del modelo y consolida como el botón.
 */
export function copiarSeleccion(e: ClipboardEvent, texto: string | null): void {
  e.preventDefault();
  const v = conPuertaAbierta();
  if (v === null) { ponerAviso([{ id: 'M-73', rol: 'status' }]); return; }
  if (texto === null || texto === '') return;
  e.clipboardData?.setData('text/plain', texto);
  copiaHecha(consolidarAhora(v));
}

/** «Vaciar portapapeles»: `writeText('')` en el clic. No borra el historial del sistema (M-86). */
export function vaciarPortapapeles(): void {
  let promesa: Promise<void>;
  try {
    promesa = navigator.clipboard.writeText('');
  } catch {
    promesa = Promise.reject(new Error('ERROR_INTERNO'));
  }
  promesa.then(() => { ponerAviso([{ id: 'M-86', rol: 'status' }]); }, () => { ponerAviso([{ id: 'M-205', rol: 'alert' }]); });
}

/** «Descargar .txt»: consolida, Blob, `<a download>`, `click()` y revocación, todo en el mismo manejador (PE-5). */
export function descargarTxt(): void {
  const v = conPuertaAbierta();
  if (v === null) return;
  try {
    const out = render(v.doc, v.state);
    const tabla = consolidarAhora(v);
    const r = exportarTxt(out);
    ponerAviso([{ id: 'M-88', params: { archivo: r.nombre }, rol: 'status' }]);
    respaldarTabla(tabla);
  } catch (e) {
    errorDeAccion(e);
  }
}

/** «Descargar .docx»: igual; si se quitaron caracteres de control del XML, M-313 con la cuenta. */
export function descargarDocx(): void {
  const v = conPuertaAbierta();
  if (v === null) return;
  try {
    const out = render(v.doc, v.state);
    const tabla = consolidarAhora(v);
    const r = exportarDocx(out);
    const avisos: AvisoListo[] = [{ id: 'M-88', params: { archivo: r.nombre }, rol: 'status' }];
    for (const a of r.avisos) if (a.code === 'CARACTERES_CONTROL') avisos.push({ id: 'M-313', params: { n: a.count ?? 0 }, rol: 'status' });
    ponerAviso(avisos);
    respaldarTabla(tabla);
  } catch (e) {
    errorDeAccion(e);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// F4 (D-22) · Salida fiel. F3 conecta estos manejadores a «Descargar documento (.docx)» y «Descargar PDF»; las pantallas no cambian
// aquí. Usan el original en memoria (`io/original.ts`): sin él (texto pegado, original ya soltado), la salida simple de siempre.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Lo que F3 necesita para avisar después de una descarga fiel (M-122): las imágenes que salieron tal cual, las páginas del PDF que
 * se cubrieron enteras (A-20) y lo que se quitó o se sustituyó. Los textos de esos avisos son de F3; aquí solo se muestran los que
 * ya existen (M-88, M-313 y M-310).
 */
export interface ResumenSalidaFiel {
  nombre: string;
  /** false: se descargó la salida simple (.docx mínimo o PDF de texto). */
  fiel: boolean;
  imagenes: number;
  paginasConImagenes: number[];
  paginasCubiertas: PaginaCubierta[];
  /** Imágenes EMF, WMF o SVG del .docx que no salieron (llevan su texto como texto, B-132). */
  vectorialesQuitadas: number;
  /** Caracteres fuera de WinAnsi sustituidos en el PDF de texto. */
  sustituidos: number;
}

/**
 * B-131 · Época del estado [M]: cada vaciado (bloqueo, «Cerrar asunto», `pagehide`, «Borrar todo») la incrementa y aborta el dibujo
 * del PDF en curso. Una descarga que empezó en otra época no se entrega.
 */
let epoca = 0;
const dibujos = new Set<AbortController>();
registrarLimpieza(() => {
  epoca++;
  for (const c of dibujos) c.abort();
  dibujos.clear();
});

/** «Descargar documento (.docx)»: el .docx idéntico al original con solo los datos cambiados; si no se puede, el .docx simple. */
export function descargarDocxFiel(): ResumenSalidaFiel | null {
  const v = conPuertaAbierta();
  if (v === null) return null;
  const original = v.doc.source === 'docx' ? originalDe(v.doc.id) : null;
  if (original === null) { descargarDocx(); return null; }
  try {
    const out = render(v.doc, v.state);
    const tabla = consolidarAhora(v);
    let r: ResultadoExportacion;
    const resumen: ResumenSalidaFiel = { nombre: '', fiel: true, imagenes: 0, paginasConImagenes: [], paginasCubiertas: [], vectorialesQuitadas: 0, sustituidos: 0 };
    try {
      const f = exportarDocxFiel(original.bytes, v.doc, out);
      r = f;
      resumen.imagenes = f.imagenes;
      resumen.vectorialesQuitadas = f.vectorialesQuitadas;
    } catch (e) {
      // El documento no admite la reescritura fiel (codificación, mapa): el .docx simple, que no lleva nada del original.
      if (!(e instanceof SiglowError) || e.code !== 'FORMATO_NO_ADMITIDO') throw e;
      r = exportarDocx(out);
      resumen.fiel = false;
    }
    resumen.nombre = r.nombre;
    // F3: el .docx fiel conserva el formato (M-2292); el simple, no (M-88). M-122: las imágenes que pasan sin revisar (V-53), M-2294.
    const avisos: AvisoListo[] = [{ id: resumen.fiel ? 'M-2292' : 'M-88', params: { archivo: r.nombre }, rol: 'status' }];
    if (resumen.fiel && resumen.imagenes > 0) avisos.push({ id: 'M-2294', params: { n: resumen.imagenes }, rol: 'alert' });
    if (resumen.vectorialesQuitadas > 0) avisos.push({ id: 'M-2296', params: { n: resumen.vectorialesQuitadas }, rol: 'status' });
    for (const a of r.avisos) if (a.code === 'CARACTERES_CONTROL') avisos.push({ id: 'M-313', params: { n: a.count ?? 0 }, rol: 'status' });
    ponerAviso(avisos);
    respaldarTabla(tabla);
    return resumen;
  } catch (e) {
    errorDeAccion(e);
    return null;
  }
}

/**
 * «Descargar PDF»: con un PDF original, el PDF tachado (cada página como imagen, con recuadros); con .docx o texto, el PDF de
 * texto. Asíncrona por el dibujo de las páginas: la puerta se evalúa y la numeración se consolida antes de la primera espera. Si
 * el estado [M] se vacía mientras se dibuja (B-131), el dibujo se aborta y no se descarga nada.
 */
export async function descargarPdfSalida(): Promise<ResumenSalidaFiel | null> {
  const v = conPuertaAbierta();
  if (v === null) return null;
  const inicio = epoca;
  const control = new AbortController();
  dibujos.add(control);
  try {
    const out = render(v.doc, v.state);
    const tabla = consolidarAhora(v);
    const original = v.doc.source === 'pdf' ? originalDe(v.doc.id) : null;
    const resumen: ResumenSalidaFiel = { nombre: '', fiel: original !== null, imagenes: 0, paginasConImagenes: [], paginasCubiertas: [], vectorialesQuitadas: 0, sustituidos: 0 };
    const avisos: AvisoListo[] = [];
    if (original === null) {
      const r = exportarPdf(out);
      resumen.nombre = r.nombre;
      resumen.sustituidos = r.sustituidos;
    } else {
      // Copia: el original en memoria puede ponerse en cero (bloqueo, `pagehide`) mientras se dibujan las páginas.
      const copia = original.bytes.slice();
      let pdf: PdfTachado;
      try {
        pdf = await construirPdfTachado(copia, v.doc, out, { signal: control.signal });
      } finally {
        copia.fill(0);
      }
      if (epoca !== inicio || control.signal.aborted) { pdf.bytes.fill(0); return null; }
      const r = descargarPdfTachado(pdf);
      pdf.bytes.fill(0);
      Object.assign(resumen, { nombre: r.nombre, imagenes: pdf.imagenes, paginasConImagenes: pdf.paginasConImagenes, paginasCubiertas: pdf.paginasCubiertas });
      // A-20: las páginas no analizadas salen cubiertas; M-310 lo dice con sus números.
      const sinAnalizar = pdf.avisos.filter((a) => a.page !== undefined).map((a) => a.page as number);
      if (sinAnalizar.length > 0) avisos.push({ id: 'M-310', params: { paginas: [...new Set(sinAnalizar)].sort((a, b) => a - b).join(', ') }, rol: 'alert' });
    }
    // F3: el PDF tachado es imagen con recuadros (M-2293); el de texto, M-88. M-122: imágenes de las páginas que salen (V-56), M-2294.
    if (resumen.fiel && resumen.imagenes > 0) avisos.push({ id: 'M-2294', params: { n: resumen.imagenes }, rol: 'alert' });
    // A-20: las demás páginas cubiertas enteras (sin mapa o excluidas), con sus números.
    const cubiertas = (m: PaginaCubierta['motivo']): string => resumen.paginasCubiertas.filter((c) => c.motivo === m).map((c) => c.page).join(', ');
    if (cubiertas('sin_mapa') !== '') avisos.push({ id: 'M-2297', params: { paginas: cubiertas('sin_mapa') }, rol: 'alert' });
    if (cubiertas('excluida') !== '') avisos.push({ id: 'M-2298', params: { paginas: cubiertas('excluida') }, rol: 'status' });
    ponerAviso([{ id: resumen.fiel ? 'M-2293' : 'M-88', params: { archivo: resumen.nombre }, rol: 'status' }, ...avisos]);
    respaldarTabla(tabla);
    return resumen;
  } catch (e) {
    if (epoca !== inicio || control.signal.aborted) return null; // el bloqueo ya vació la pantalla
    errorDeAccion(e);
    return null;
  } finally {
    dibujos.delete(control);
  }
}

/** Informe de 6.8 (INV-I03: solo con `exportGate.ok`), en `.txt` (UTF-8 con BOM y CRLF) o `.json`. No lleva ningún original. */
export function descargarInforme(ext: 'txt' | 'json'): void {
  const v = conPuertaAbierta();
  const l = obtenerListo();
  if (v === null || l.residuo === null) return;
  if (l.compilacion === null) { ponerAviso([{ id: 'M-1417', rol: 'alert' }]); return; }
  try {
    const asunto = obtener().asunto;
    const m = v.state.modelo;
    const avance = m.kind === 'plan_b' && m.ventanas !== undefined && m.ventanasTotales !== undefined
      ? { ventanas: m.ventanas, ventanasTotales: m.ventanasTotales } : undefined;
    const informe = buildReport({
      doc: v.doc, state: v.state, residue: l.residuo, reminder: confirmacionVigente(v.state, l), caseList: obtenerListaDelCaso(),
      app: { version: __SIGLOW_VERSION__, compilacion: l.compilacion }, rulesVersion: OPCIONES_DETECCION.rulesVersion, now: new Date(),
      ...(l.recordatorioConfirmado !== null ? { recordatorioConfirmado: l.recordatorioConfirmado } : {}),
      ...(avance !== undefined ? { avanceDelModelo: avance } : {}),
      ...(l.incluirCodigoAsunto && asunto !== null ? { asunto: { codigo: asunto.codigo }, incluirCodigoAsunto: true } : {}),
    });
    const nombre = nombreDescarga('informe', ext);
    const bytes = new TextEncoder().encode(ext === 'json' ? reportToJson(informe) : reportToText(informe));
    descargarBytes(bytes, ext === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8', nombre);
    ponerAviso([{ id: 'M-89', params: { archivo: nombre }, rol: 'status' }]);
  } catch (e) {
    errorDeAccion(e);
  }
}
