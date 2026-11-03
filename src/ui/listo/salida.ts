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
import { exportarPdf } from '../../io/pdf-write.ts';
import { descargarBytes, exportarTxt, nombreDescarga, revocarUrlsVivas } from '../../io/txt-write.ts';
import type { ResultadoExportacion } from '../../io/txt-write.ts';
import { OPCIONES_DETECCION } from '../analisis.ts';
import { obtenerDocumento, obtenerRevision, fijarRevision } from '../documento.ts';
import { actualizar, obtener } from '../estado.ts';
import { idDeCodigo } from '../mensajes.ts';
import { codigoDeError, puertos } from '../servicios.ts';
import { fijarTabla, obtenerListaDelCaso, obtenerTabla, registrarLimpieza } from '../sesion.ts';
import { actualizarListo, obtenerListo, ponerAviso, puertaDe, type AvisoListo } from './almacen.ts';

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

/** «Descargar documento (.docx)»: el .docx idéntico al original con solo los datos cambiados; si no se puede, el .docx simple. */
export function descargarDocxFiel(): void {
  const v = conPuertaAbierta();
  if (v === null) return;
  const original = v.doc.source === 'docx' ? originalDe(v.doc.id) : null;
  if (original === null) { descargarDocx(); return; }
  try {
    const out = render(v.doc, v.state);
    const tabla = consolidarAhora(v);
    let r: ResultadoExportacion;
    try {
      r = exportarDocxFiel(original.bytes, v.doc, out);
    } catch (e) {
      // El documento no admite la reescritura fiel (codificación, mapa): el .docx simple, que no lleva nada del original.
      if (!(e instanceof SiglowError) || e.code !== 'FORMATO_NO_ADMITIDO') throw e;
      r = exportarDocx(out);
    }
    const avisos: AvisoListo[] = [{ id: 'M-88', params: { archivo: r.nombre }, rol: 'status' }];
    for (const a of r.avisos) if (a.code === 'CARACTERES_CONTROL') avisos.push({ id: 'M-313', params: { n: a.count ?? 0 }, rol: 'status' });
    ponerAviso(avisos);
    respaldarTabla(tabla);
  } catch (e) {
    errorDeAccion(e);
  }
}

/**
 * «Descargar PDF»: con un PDF original, el PDF tachado (cada página como imagen, con recuadros); con .docx o texto, el PDF de
 * texto. Asíncrona por el dibujo de las páginas: la puerta se evalúa y la numeración se consolida antes de la primera espera.
 */
export async function descargarPdfSalida(): Promise<void> {
  const v = conPuertaAbierta();
  if (v === null) return;
  try {
    const out = render(v.doc, v.state);
    const tabla = consolidarAhora(v);
    const original = v.doc.source === 'pdf' ? originalDe(v.doc.id) : null;
    let r: ResultadoExportacion;
    if (original === null) r = exportarPdf(out);
    else {
      // Copia: el original en memoria puede ponerse en cero (bloqueo, `pagehide`) mientras se dibujan las páginas.
      const copia = original.bytes.slice();
      try {
        r = descargarPdfTachado(await construirPdfTachado(copia, v.doc, out));
      } finally {
        copia.fill(0);
      }
    }
    ponerAviso([{ id: 'M-88', params: { archivo: r.nombre }, rol: 'status' }]);
    respaldarTabla(tabla);
  } catch (e) {
    errorDeAccion(e);
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
      doc: v.doc, state: v.state, residue: l.residuo, reminder: l.recordatorio, caseList: obtenerListaDelCaso(),
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
