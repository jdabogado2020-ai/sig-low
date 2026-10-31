// Adaptador de BovedaPuerto (PC-1) sobre vault/ (PD-3, PD-4; plan 6.7.4, 6.6.5). Lo instala main.tsx con instalarPuertos.
// La clave AES-GCM no extraíble vive aquí solo mientras el asunto está abierto: cerrar() la descarta (bloqueo, cerrar asunto,
// pagehide). Frase y texto plano viven solo dentro de cada operación; el texto plano descifrado se pone en ceros tras leerlo.
// Además de BovedaPuerto ofrece lo que pide la pantalla Bóveda (PC-6): importar, borrar un asunto, borrar todo y persist().
import { SiglowError } from '../core/types.ts';
import type { AsuntoId, AsuntoRecord, VaultPayload } from '../core/types.ts';
import { randomIds } from '../io/txt-read.ts';
import { descargarBytes, nombreDescarga } from '../io/txt-write.ts';
import {
  abrirRegistro, abrirSiglow, analizarEncabezado, bytesAleatorios, calibrarIteraciones, claveParaFraseNueva, derivarClave, exportarSiglow, SAL_BYTES,
  sellarRegistro, serializarPayload, type DatosAsunto,
} from '../vault/crypto.ts';
import { CODIGO_RE, payloadDe, validarPayload } from '../vault/export.ts';
import {
  agregarRegistro, alCerrarPorOtraPestana, borrarBase, borrarRegistro, buscarPorCodigo, idbDisponible, leerRegistro, listarRegistros,
  pedirPersistencia, persistenciaConcedida, ponerRegistro, reemplazarRegistros,
} from '../vault/store.ts';
import { bloquear } from './bloqueo.ts';
import { obtener } from './estado.ts';
import type { AsuntoAbierto, AsuntoListado, BovedaPuerto, InstantaneaAsunto } from './servicios.ts';

const ASUNTO_ID_RE = /^asu_[0-9a-f]{32}$/;
const MIME_SIGLOW = 'application/octet-stream';

interface Abierto { clave: CryptoKey; sal: Uint8Array<ArrayBuffer>; it: number; codigo: string; creado: string }

/** Lo que la Bóveda necesita además de BovedaPuerto. */
export interface BovedaCompleta extends BovedaPuerto {
  /** Pasos 1 a 12 de 6.7.6. Sin opción y con conflicto → ASUNTO_EXISTENTE (M-113): «Reemplazar» o «Importar con otro código». */
  importar(archivo: ArrayBuffer | Uint8Array, frase: string, opcion?: { reemplazar: true } | { codigoNuevo: string }): Promise<{ asuntoId: AsuntoId; codigo: string; persisted: boolean | null }>;
  /** «Borrar» (M-109). */
  borrarAsunto(asuntoId: AsuntoId): Promise<void>;
  /** «Borrar todo» (M-111); 'bloqueado' → M-112. El que llama vacía el estado en claro. */
  borrarTodo(): Promise<'borrado' | 'bloqueado'>;
  /** Resultado vigente de persist() (M-21 o M-22). */
  persistencia(): Promise<boolean | null>;
}

const abiertos = new Map<AsuntoId, Abierto>();
/** Escrituras de un asunto en orden: un guardado viejo nunca pisa a uno más nuevo. */
const colas = new Map<AsuntoId, Promise<unknown>>();

function encolar<T>(asuntoId: AsuntoId, f: () => Promise<T>): Promise<T> {
  const previa = colas.get(asuntoId) ?? Promise.resolve();
  const p = previa.then(f, f);
  const fin = p.catch(() => undefined);
  colas.set(asuntoId, fin);
  void fin.then(() => { if (colas.get(asuntoId) === fin) colas.delete(asuntoId); });
  return p;
}

function exigirContexto(): void {
  if (globalThis.isSecureContext !== true || !globalThis.crypto?.subtle) throw new SiglowError('CONTEXTO_NO_SEGURO');
  if (!idbDisponible()) throw new SiglowError('IDB_NO_DISPONIBLE');
}

function codigoValido(codigo: string): string {
  const c = typeof codigo === 'string' ? codigo.trim() : '';
  if (!CODIGO_RE.test(c)) throw new SiglowError('CODIGO_INVALIDO');
  return c;
}

const ahora = (): string => new Date().toISOString();
const nuevoId = (): AsuntoId => randomIds().next('asu') as AsuntoId;

/** Descifra el registro y valida su VaultPayload; el texto plano queda en ceros aunque la validación falle. */
async function descifrarRegistro(r: AsuntoRecord, frase: string): Promise<{ abierto: Abierto; payload: VaultPayload }> {
  const { clave, sal, it, plano } = await abrirRegistro(r, frase);
  let payload: VaultPayload;
  try {
    payload = validarPayload(plano, r.asuntoId);
  } finally {
    plano.fill(0);
  }
  // El código en claro del registro no está autenticado: debe ser el del texto cifrado.
  if (payload.asunto.codigo !== r.codigo) throw new SiglowError('ARCHIVO_ALTERADO');
  return { abierto: { clave, sal, it, codigo: payload.asunto.codigo, creado: payload.asunto.creado }, payload };
}

/** Crear o «Pasar a Guardar cifrada»: frase validada (INV-V10), `it` calibrado, sal nueva, `add`, persist(). */
async function guardarNuevo(codigo: string, frase: string, asuntoId: AsuntoId, datos: InstantaneaAsunto): Promise<{ asuntoId: AsuntoId; persisted: boolean | null }> {
  exigirContexto();
  const c = codigoValido(codigo);
  if (!ASUNTO_ID_RE.test(asuntoId) || datos.table.asuntoId !== asuntoId) throw new SiglowError('ENTRADA_INVALIDA');
  if (await buscarPorCodigo(c) || await leerRegistro(asuntoId)) throw new SiglowError('ASUNTO_EXISTENTE');
  const { clave, sal, it } = await claveParaFraseNueva(frase, c);
  const t = ahora();
  const asunto: DatosAsunto = { asuntoId, codigo: c, creado: t, actualizado: t };
  const r = await sellarRegistro(clave, asunto, { sal, it }, serializarPayload(payloadDe(datos, asunto, __SIGLOW_VERSION__)));
  await agregarRegistro(r);
  abiertos.set(asuntoId, { clave, sal, it, codigo: c, creado: t });
  return { asuntoId, persisted: await pedirPersistencia() };
}

export const bovedaIdb: BovedaCompleta = {
  disponible: () => globalThis.isSecureContext === true && !!globalThis.crypto?.subtle && idbDisponible(),

  async listar(): Promise<AsuntoListado[]> {
    exigirContexto();
    return (await listarRegistros()).map((r) => ({ asuntoId: r.asuntoId, codigo: r.codigo, actualizado: r.actualizado }));
  },

  crear({ codigo, frase }) {
    const asuntoId = nuevoId();
    return guardarNuevo(codigo, frase, asuntoId, { caseList: [], table: { asuntoId, counters: {}, entries: {}, documents: [] } });
  },

  async abrir(asuntoId, frase): Promise<AsuntoAbierto> {
    exigirContexto();
    const r = await leerRegistro(asuntoId);
    if (!r) throw new SiglowError('ENTRADA_INVALIDA');
    const { abierto, payload } = await descifrarRegistro(r, frase);
    abiertos.set(asuntoId, abierto);
    return { asuntoId, codigo: abierto.codigo, caseList: payload.caseList, table: payload.table };
  },

  guardar(asuntoId, datos) {
    return encolar(asuntoId, async () => {
      exigirContexto();
      const a = abiertos.get(asuntoId);
      if (!a) throw new SiglowError('SESION_DESCONOCIDA');
      const asunto: DatosAsunto = { asuntoId, codigo: a.codigo, creado: a.creado, actualizado: ahora() };
      const r = await sellarRegistro(a.clave, asunto, { sal: a.sal, it: a.it }, serializarPayload(payloadDe(datos, asunto, __SIGLOW_VERSION__)));
      await ponerRegistro(r);
    });
  },

  async exportar(datos, codigo, frase) {
    if (globalThis.isSecureContext !== true || !globalThis.crypto?.subtle) throw new SiglowError('CONTEXTO_NO_SEGURO');
    const asuntoId = datos.table.asuntoId;
    const c = codigoValido(codigo);
    // Con el asunto guardado, exportarSiglow exige que la frase abra su registro (B-16): una frase mal escrita no produce un
    // .siglow que nadie abre. Un registro ilegible no se salta: el error sube. Sin registro («No guardar») no hay con qué comparar.
    const r = idbDisponible() ? await leerRegistro(asuntoId) : null;
    const it = r ? analizarEncabezado(r.encabezado).it : await calibrarIteraciones();
    const creado = r ? r.creado : ahora();
    const plano = serializarPayload(payloadDe(datos, { asuntoId, codigo: c, creado, actualizado: ahora() }, __SIGLOW_VERSION__));
    const json = await exportarSiglow(frase, asuntoId, it, plano, r);
    const archivo = nombreDescarga('tabla', 'siglow');
    descargarBytes(new TextEncoder().encode(json), MIME_SIGLOW, archivo);
    return { archivo };
  },

  pasarAGuardar(codigo, frase, datos) {
    return guardarNuevo(codigo, frase, datos.table.asuntoId, datos);
  },

  cerrar() {
    abiertos.clear();
  },

  async importar(archivo, frase, opcion) {
    exigirContexto();
    const { asuntoId: idArchivo, plano } = await abrirSiglow(archivo, frase);   // pasos 1 a 10
    let payload: VaultPayload;
    try {
      payload = validarPayload(plano, idArchivo);                                 // paso 11
    } finally {
      plano.fill(0);
    }
    // Paso 12: conflicto por asuntoId o por código.
    let asuntoId = idArchivo;
    let codigo = payload.asunto.codigo;
    const porId = await leerRegistro(asuntoId);
    let porCodigo = await buscarPorCodigo(codigo);
    const borrar: AsuntoId[] = [];
    if (opcion && 'codigoNuevo' in opcion) {
      codigo = codigoValido(opcion.codigoNuevo);
      porCodigo = await buscarPorCodigo(codigo);
      if (porCodigo) throw new SiglowError('ASUNTO_EXISTENTE');
      if (porId) asuntoId = nuevoId();
    } else if (porId || porCodigo) {
      if (!opcion?.reemplazar) throw new SiglowError('ASUNTO_EXISTENTE');
      for (const x of [porId, porCodigo]) if (x && !borrar.includes(x.asuntoId)) borrar.push(x.asuntoId);
    }
    // Se vuelve a cifrar para el almacén con sal nueva y la misma frase (importar no aplica validatePassphrase, 6.7.3).
    const it = await calibrarIteraciones();
    const sal = bytesAleatorios(SAL_BYTES);
    const clave = await derivarClave(frase, sal, it);
    const t = ahora();
    const asunto: DatosAsunto = { asuntoId, codigo, creado: payload.asunto.creado, actualizado: t };
    const tabla = asuntoId === idArchivo ? payload.table : { ...payload.table, asuntoId };
    const r = await sellarRegistro(clave, asunto, { sal, it }, serializarPayload(payloadDe({ caseList: payload.caseList, table: tabla }, asunto, payload.appVersion)));
    for (const id of borrar) abiertos.delete(id);
    if (borrar.length > 0) await reemplazarRegistros(borrar, r);
    else await agregarRegistro(r);
    return { asuntoId, codigo, persisted: await pedirPersistencia() };
  },

  async borrarAsunto(asuntoId) {
    exigirContexto();
    abiertos.delete(asuntoId);
    await borrarRegistro(asuntoId);
  },

  async borrarTodo() {
    exigirContexto();
    abiertos.clear();
    return borrarBase();
  },

  persistencia: () => persistenciaConcedida(),
};

// Otra pestaña borró todo o actualizó la base: se descartan las claves y, si hay un asunto guardado abierto, esta pestaña se
// bloquea (su registro ya no está; seguir guardando lo resucitaría).
alCerrarPorOtraPestana(() => {
  abiertos.clear();
  const a = obtener().asunto;
  if (a !== null && a.mode === 'guardar') bloquear(false);
});
