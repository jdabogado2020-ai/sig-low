// Lo que la pantalla Bóveda (PC-6, 8.2.9) necesita de la bóveda y `BovedaPuerto` todavía no ofrece, sin tocar el adaptador de PD-4:
// las fechas de creación de cada asunto (el listado del adaptador solo trae `actualizado`) y «Cambiar frase de paso» (6.7.4).
// Ambos usan solo `vault/` (cifrado y almacén) y devuelven datos [P]: código y fechas. Nada de la tabla sale de aquí.
import { SiglowError } from '../../core/types.ts';
import type { AsuntoId, IsoDateTime } from '../../core/types.ts';
import { abrirRegistro, claveParaFraseNueva, serializarPayload, sellarRegistro, type DatosAsunto } from '../../vault/crypto.ts';
import { payloadDe, validarPayload } from '../../vault/export.ts';
import { idbDisponible, leerRegistro, listarRegistros, ponerRegistro } from '../../vault/store.ts';

export interface FilaBoveda { asuntoId: AsuntoId; codigo: string; creado: IsoDateTime; actualizado: IsoDateTime }

/** Los asuntos guardados con código y fechas, nunca su contenido (INV-V01, V-35). Las lecturas no crean la base. */
export async function listarAsuntos(): Promise<FilaBoveda[]> {
  if (!idbDisponible()) return [];
  return listarRegistros();
}

/**
 * «Cambiar frase de paso» (6.7.4): descifra con la frase actual (`CONTRASENA_O_ARCHIVO` si no abre), valida la nueva (INV-V10, antes de
 * derivar nada), calibra `it`, genera sal nueva, vuelve a cifrar con IV nuevo y reemplaza el registro. El texto plano queda en ceros.
 * Si falla algo antes del `put`, el registro anterior sigue intacto y abre con la frase actual.
 */
export async function cambiarFraseDeAsunto(asuntoId: AsuntoId, actual: string, nueva: string): Promise<void> {
  if (globalThis.isSecureContext !== true || !globalThis.crypto?.subtle) throw new SiglowError('CONTEXTO_NO_SEGURO');
  if (!idbDisponible()) throw new SiglowError('IDB_NO_DISPONIBLE');
  const r = await leerRegistro(asuntoId);
  if (!r) throw new SiglowError('ENTRADA_INVALIDA');
  const abierto = await abrirRegistro(r, actual);
  let payload;
  try {
    payload = validarPayload(abierto.plano, asuntoId);
  } finally {
    abierto.plano.fill(0);
  }
  if (payload.asunto.codigo !== r.codigo) throw new SiglowError('ARCHIVO_ALTERADO');
  const { clave, sal, it } = await claveParaFraseNueva(nueva.normalize('NFC'), r.codigo);
  const asunto: DatosAsunto = { asuntoId, codigo: r.codigo, creado: r.creado, actualizado: new Date().toISOString() };
  const nuevo = await sellarRegistro(clave, asunto, { sal, it }, serializarPayload(payloadDe({ caseList: payload.caseList, table: payload.table }, asunto, payload.appVersion)));
  await ponerRegistro(nuevo);
}
