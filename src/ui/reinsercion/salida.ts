// Acciones de salida de la pantalla Reinserción (PC-6, 8.2.8, 8.7): copiar con datos reales, Ctrl + C sobre el resultado, vaciar el
// portapapeles y descargar .txt. Todas vuelven a evaluar `ready` con lo vigente y no actúan si es falso (INV-N05). La confirmación
// M-99 la pide la pantalla antes de llamar aquí; `writeText` y la descarga se llaman sin ningún `await` antes (la activación del
// usuario vence con las esperas). El texto reinsertado no se escribe en ningún almacenamiento ni en la consola (INV-N04); los errores
// salen solo como `ErrorCode` (F-07).
import { exportarTxt, revocarUrlsVivas } from '../../io/txt-write.ts';
import { idDeCodigo } from '../mensajes.ts';
import { codigoDeError } from '../servicios.ts';
import { registrarLimpieza } from '../sesion.ts';
import { actualizarReinsercion, obtenerReinsercion, ponerAvisosReinsercion } from './almacen.ts';

// Las URL `blob:` vivas se revocan al bloquear y en `pagehide` (V-48); `descargarBytes` ya revoca en el mismo manejador.
registrarLimpieza(revocarUrlsVivas);

/** Texto reinsertado listo para salir, o null si no hay resultado o aún hay alertas sin decidir. */
function textoListo(): string | null {
  const r = obtenerReinsercion().resultado;
  return r !== null && r.ready ? r.text : null;
}

/** Copia hecha: M-124 (el historial del portapapeles puede conservarla). */
function copiaHecha(): void {
  actualizarReinsercion({ copiado: true, respaldo: null });
  ponerAvisosReinsercion([{ id: 'M-124', rol: 'status' }]);
}

/** «Copiar texto con datos reales», después de M-99. Si el navegador no deja, queda el área de respaldo seleccionada (M-87). */
export function copiarConDatosReales(): void {
  const texto = textoListo();
  if (texto === null) return;
  let promesa: Promise<void> | null;
  try {
    promesa = navigator.clipboard.writeText(texto);
  } catch {
    promesa = null;
  }
  const respaldoManual = (): void => {
    actualizarReinsercion({ copiado: true, respaldo: texto });
    ponerAvisosReinsercion([{ id: 'M-87', rol: 'alert' }]);
  };
  if (promesa === null) respaldoManual();
  else promesa.then(copiaHecha, respaldoManual);
}

/**
 * Ctrl + C sobre el resultado (8.7): lo atiende el manejador propio; escribe solo `text/plain` con la subcadena del modelo
 * (`ReinsertionResult.text`), sin confirmación, y muestra M-124. Sin `ready` no escribe nada.
 */
export function copiarSeleccionReal(e: ClipboardEvent, texto: string | null): void {
  e.preventDefault();
  if (textoListo() === null) return;
  if (texto === null || texto === '') return;
  e.clipboardData?.setData('text/plain', texto);
  copiaHecha();
}

/** «Vaciar portapapeles»: `writeText('')` en el clic. No borra el historial del sistema (M-86). */
export function vaciarPortapapeles(): void {
  let promesa: Promise<void>;
  try {
    promesa = navigator.clipboard.writeText('');
  } catch {
    promesa = Promise.reject(new Error('ERROR_INTERNO'));
  }
  promesa.then(() => { ponerAvisosReinsercion([{ id: 'M-86', rol: 'status' }]); }, () => { ponerAvisosReinsercion([{ id: 'M-205', rol: 'alert' }]); });
}

/** «Descargar .txt», después de M-99: nombre neutro `sig-low-reinsertado-…`, Blob, `<a download>` y revocación en el mismo manejador (V-48). */
export function descargarConDatosReales(): void {
  const texto = textoListo();
  if (texto === null) return;
  try {
    const r = exportarTxt(texto, { clase: 'reinsertado' });
    ponerAvisosReinsercion([{ id: 'M-88', params: { archivo: r.nombre }, rol: 'status' }]);
  } catch (e) {
    ponerAvisosReinsercion([{ id: idDeCodigo(codigoDeError(e)), rol: 'alert' }]);
  }
}
