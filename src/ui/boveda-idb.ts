// Adaptador de BovedaPuerto (PC-1) sobre vault/ (PD-3, PD-4; plan 6.7.4, 6.6.5). Lo instala main.tsx con instalarPuertos.
// La clave AES-GCM no extraíble vive aquí solo mientras el asunto está abierto: cerrar() la descarta (bloqueo, cerrar asunto,
// pagehide) y también aborta un abrir, un crear o un «Pasar a Guardar cifrada» en curso (B-21). Frase y texto plano viven solo
// dentro de cada operación; el texto plano descifrado se pone en ceros tras leerlo. Si el registro del asunto abierto desaparece
// (otra pestaña lo borró, «Borrar todo», datos del sitio borrados) o cambia de frase, la sesión se pierde: ni guardar ni exportar
// lo resucitan ni deshacen el cambio, y la pantalla se bloquea (M-5, M-6, B-20).
// Además de BovedaPuerto ofrece lo que pide la pantalla Bóveda (PC-6): importar, exportar un asunto sin abrirlo, cambiar la frase,
// borrar un asunto, borrar todo y persist(). Las otras pestañas se enteran por el canal `siglow-boveda` (solo el `asuntoId`).
import { SiglowError } from '../core/types.ts';
import type { AsuntoId, AsuntoRecord, IsoDateTime, VaultPayload } from '../core/types.ts';
import { randomIds } from '../io/txt-read.ts';
import { descargarBytes, nombreDescarga } from '../io/txt-write.ts';
import {
  aBase64, abrirRegistro, abrirSiglow, analizarEncabezado, bytesAleatorios, calibrarIteraciones, claveParaFraseNueva, derivarClave, descifrar, exportarSiglow,
  SAL_BYTES, sellarRegistro, serializarPayload, validatePassphrase, type DatosAsunto,
} from '../vault/crypto.ts';
import { CODIGO_RE, payloadDe, validarPayload } from '../vault/export.ts';
import {
  agregarRegistro, alCerrarPorOtraPestana, borrarBase, borrarRegistro, buscarPorCodigo, idbDisponible, leerRegistro, listarRegistros,
  pedirPersistencia, persistenciaConcedida, ponerRegistro, reemplazarRegistros, type ClaveDelRegistro,
} from '../vault/store.ts';
import { bloquear } from './bloqueo.ts';
import { obtener } from './estado.ts';
import type { AsuntoAbierto, AsuntoListado, BovedaPuerto, InstantaneaAsunto } from './servicios.ts';

const ASUNTO_ID_RE = /^asu_[0-9a-f]{32}$/;
const MIME_SIGLOW = 'application/octet-stream';
const CANAL = 'siglow-boveda';

interface Abierto { clave: CryptoKey; sal: Uint8Array<ArrayBuffer>; it: number; codigo: string; creado: string }

/** Un asunto de la lista, con su fecha de creación (PC-6). */
export interface AsuntoGuardado extends AsuntoListado { creado: IsoDateTime }

/** Lo que la Bóveda necesita además de BovedaPuerto. */
export interface BovedaCompleta extends BovedaPuerto {
  /**
   * Los asuntos con su `creado`: el del texto cifrado si el asunto está abierto en esta pestaña; si no, el del registro, que es
   * lo único que hay sin la frase (6.7.1, V-35: solo se muestra; abrir, exportar y cambiar la frase lo contrastan con el cifrado).
   */
  listar(): Promise<AsuntoGuardado[]>;
  /**
   * Pasos 1 a 12 de 6.7.6. Sin opción y con conflicto → ASUNTO_EXISTENTE (M-113): «Reemplazar» o «Importar con otro código».
   * Si `cerrar()` corre mientras se deriva (bloqueo), SESION_DESCONOCIDA y no se escribe nada (AJ-1).
   */
  importar(archivo: ArrayBuffer | Uint8Array, frase: string, opcion?: { reemplazar: true } | { codigoNuevo: string }): Promise<{ asuntoId: AsuntoId; codigo: string; persisted: boolean | null }>;
  /**
   * «Exportar» desde la Bóveda sin abrir el asunto (B-24): descifra el registro con la frase (la comprobación de B-16), lo vuelve
   * a cifrar para el .siglow con sal nueva y lo descarga. La clave no queda en memoria y los textos planos quedan en ceros. Si
   * `cerrar()` corre mientras se deriva (bloqueo), SESION_DESCONOCIDA y no se descarga nada (AJ-1).
   */
  exportarAsunto(asuntoId: AsuntoId, frase: string): Promise<{ archivo: string }>;
  /**
   * «Cambiar frase de paso» (6.7.4; M-6, B-23), en la cola de guardados del asunto. La frase nueva débil → ENTRADA_INVALIDA antes
   * de derivar nada (INV-V10); la actual errónea → CONTRASENA_O_ARCHIVO. Sal, IV e `it` nuevos; `creado` del texto cifrado; `put`
   * condicional al registro exacto que se descifró (CUOTA_EXCEDIDA o otra frase dejan el registro como estaba). Si otra pestaña
   * guardó con la clave vieja mientras se derivaba (B-28), se vuelve a leer y a cifrar su tabla, sin derivar, hasta 3 intentos;
   * después, ERROR_INTERNO (M-205, «Intente de nuevo») sin escribir. Si `cerrar()` corre mientras se deriva (bloqueo),
   * SESION_DESCONOCIDA y tampoco se escribe (AJ-1). Al terminar, el asunto abierto en esta pestaña pasa a la
   * clave nueva y las otras pestañas descartan la vieja y se bloquean.
   */
  cambiarFrase(asuntoId: AsuntoId, actual: string, nueva: string): Promise<void>;
  /** «Borrar» (M-109). Las otras pestañas con ese asunto abierto se bloquean. */
  borrarAsunto(asuntoId: AsuntoId): Promise<void>;
  /** «Borrar todo» (M-111); 'bloqueado' → M-112. El que llama vacía el estado en claro. */
  borrarTodo(): Promise<'borrado' | 'bloqueado'>;
  /** Resultado vigente de persist() (M-21 o M-22). */
  persistencia(): Promise<boolean | null>;
}

const abiertos = new Map<AsuntoId, Abierto>();
/** Asuntos guardados cuya sesión se perdió (registro borrado o clave descartada): hasta abrirlos otra vez, nada los guarda ni exporta. */
const perdidos = new Set<AsuntoId>();
/** Época de la sesión: cerrar() la incrementa (B-21). */
let epoca = 0;
/** Escrituras de un asunto en orden: un guardado viejo nunca pisa a uno más nuevo. */
const colas = new Map<AsuntoId, Promise<unknown>>();

/** abrir, crear y pasar a «Guardar cifrada» leen la época al empezar: si cerrar() corrió mientras derivaban, fallan sin guardar la clave. */
function exigirEpoca(e: number): void {
  if (e !== epoca) throw new SiglowError('SESION_DESCONOCIDA');
}

/**
 * La sesión de un asunto guardado se perdió: su registro ya no está o su clave se descartó (M-5, B-20). Se descarta la clave y,
 * si la pantalla tiene ese asunto abierto como guardado, se bloquea (estado `[M]` vacío, M-102). El bloqueo va después de que
 * quien llamó maneje el rechazo, para que su continuación (p. ej. ir a Entrada) no deje la pantalla en otro sitio.
 */
function perderAsunto(asuntoId: AsuntoId): void {
  abiertos.delete(asuntoId);
  perdidos.add(asuntoId);
  setTimeout(() => {
    const a = obtener().asunto;
    if (a !== null && a.asuntoId === asuntoId && a.mode === 'guardar') bloquear(false);
  }, 0);
}

let canal: BroadcastChannel | null = null;

/**
 * Canal entre pestañas (se abre con el primer asunto abierto o la primera escritura que lo usa): solo lleva el `asuntoId` de un
 * asunto cuyo registro se borró, se reemplazó o cambió de frase. La pestaña que lo tenga abierto descarta la clave y se bloquea.
 */
function canalBoveda(): BroadcastChannel | null {
  if (canal === null && typeof BroadcastChannel !== 'undefined') {
    try {
      canal = new BroadcastChannel(CANAL);
      canal.onmessage = (e: MessageEvent) => {
        const m = e.data as { tipo?: unknown; asuntoId?: unknown } | null;
        if (m?.tipo === 'perdido' && typeof m.asuntoId === 'string' && ASUNTO_ID_RE.test(m.asuntoId)) perderAsunto(m.asuntoId as AsuntoId);
      };
    } catch {
      canal = null;
    }
  }
  return canal;
}

/** Avisa a las otras pestañas de que la clave que tengan de este asunto ya no vale. */
function difundirPerdido(asuntoId: AsuntoId): void {
  try { canalBoveda()?.postMessage({ tipo: 'perdido', asuntoId }); } catch { /* canal cerrado: queda el guardado condicional */ }
}

function abierto(asuntoId: AsuntoId, a: Abierto): void {
  canalBoveda();
  abiertos.set(asuntoId, a);
  perdidos.delete(asuntoId);
}

/** La clave con que se cifró el registro de un asunto abierto: la que exige el guardado condicional (M-6). */
const claveEsperada = (a: Abierto): ClaveDelRegistro => ({ salB64: aBase64(a.sal), it: a.it });

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

/** Descarga el .siglow con nombre neutro (F-03, 6.9); la URL `blob:` se revoca en el mismo manejador. */
function descargarSiglow(json: string): { archivo: string } {
  const archivo = nombreDescarga('tabla', 'siglow');
  descargarBytes(new TextEncoder().encode(json), MIME_SIGLOW, archivo);
  return { archivo };
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
  // El código y la fecha de creación en claro del registro no están autenticados: deben ser los del texto cifrado (B-22).
  if (payload.asunto.codigo !== r.codigo || payload.asunto.creado !== r.creado) throw new SiglowError('ARCHIVO_ALTERADO');
  return { abierto: { clave, sal, it, codigo: payload.asunto.codigo, creado: payload.asunto.creado }, payload };
}

/**
 * Crear o «Pasar a Guardar cifrada»: frase validada (INV-V10), `it` calibrado, sal nueva, `add`, persist(). Si cerrar() corre
 * mientras tanto (B-21), no queda nada: ni la clave ni el registro.
 */
async function guardarNuevo(codigo: string, frase: string, asuntoId: AsuntoId, datos: InstantaneaAsunto): Promise<{ asuntoId: AsuntoId; persisted: boolean | null }> {
  const e = epoca;
  exigirContexto();
  const c = codigoValido(codigo);
  if (!ASUNTO_ID_RE.test(asuntoId) || datos.table.asuntoId !== asuntoId) throw new SiglowError('ENTRADA_INVALIDA');
  if (await buscarPorCodigo(c) || await leerRegistro(asuntoId)) throw new SiglowError('ASUNTO_EXISTENTE');
  const { clave, sal, it } = await claveParaFraseNueva(frase, c);
  const t = ahora();
  const asunto: DatosAsunto = { asuntoId, codigo: c, creado: t, actualizado: t };
  const r = await sellarRegistro(clave, asunto, { sal, it }, serializarPayload(payloadDe(datos, asunto, __SIGLOW_VERSION__)));
  exigirEpoca(e);
  await agregarRegistro(r);
  if (e !== epoca) {
    // cerrar() durante la escritura: se deshace, para que tras el bloqueo no quede un asunto que la pantalla no abrió.
    await borrarRegistro(asuntoId).catch(() => undefined);
    throw new SiglowError('SESION_DESCONOCIDA');
  }
  abierto(asuntoId, { clave, sal, it, codigo: c, creado: t });
  return { asuntoId, persisted: await pedirPersistencia() };
}

/** «Cambiar frase» (B-28): intentos del `put` condicional cuando otra pestaña guarda con la clave vieja durante el cambio. */
const INTENTOS_CAMBIAR_FRASE = 3;

/** «Cambiar frase» (B-28): el registro sigue cifrado con la clave que abrió la frase actual (misma sal y mismo `it`). */
function cifradoCon(r: AsuntoRecord, a: Abierto): boolean {
  try {
    const e = analizarEncabezado(r.encabezado);
    return e.uso === 'almacen' && e.asuntoId === r.asuntoId && e.salB64 === aBase64(a.sal) && e.it === a.it;
  } catch {
    return false;
  }
}

/**
 * «Cambiar frase» (B-28): descifra con la clave ya derivada de la frase actual el registro que otra pestaña guardó mientras tanto,
 * sin derivar otra vez. Las mismas comprobaciones que al abrir (abrirRegistro y descifrarRegistro); el texto plano queda en ceros.
 */
async function descifrarConClave(r: AsuntoRecord, a: Abierto): Promise<VaultPayload> {
  const e = analizarEncabezado(r.encabezado);
  if (e.uso !== 'almacen' || e.asuntoId !== r.asuntoId || !(r.iv instanceof ArrayBuffer) || !(r.ct instanceof ArrayBuffer)
    || aBase64(new Uint8Array(r.iv)) !== e.ivB64) throw new SiglowError('ARCHIVO_ALTERADO');
  const plano = await descifrar(a.clave, r.encabezado, new Uint8Array(r.ct));
  let payload: VaultPayload;
  try {
    payload = validarPayload(plano, r.asuntoId);
  } finally {
    plano.fill(0);
  }
  if (payload.asunto.codigo !== r.codigo || payload.asunto.creado !== r.creado || payload.asunto.creado !== a.creado) throw new SiglowError('ARCHIVO_ALTERADO');
  return payload;
}

export const bovedaIdb: BovedaCompleta = {
  disponible: () => globalThis.isSecureContext === true && !!globalThis.crypto?.subtle && idbDisponible(),

  async listar(): Promise<AsuntoGuardado[]> {
    exigirContexto();
    return (await listarRegistros()).map((r) => ({
      asuntoId: r.asuntoId, codigo: r.codigo, creado: abiertos.get(r.asuntoId)?.creado ?? r.creado, actualizado: r.actualizado,
    }));
  },

  crear({ codigo, frase }) {
    const asuntoId = nuevoId();
    return guardarNuevo(codigo, frase, asuntoId, { caseList: [], table: { asuntoId, counters: {}, entries: {}, documents: [] } });
  },

  async abrir(asuntoId, frase): Promise<AsuntoAbierto> {
    const e = epoca;
    exigirContexto();
    const r = await leerRegistro(asuntoId);
    if (!r) throw new SiglowError('ENTRADA_INVALIDA');
    const { abierto: a, payload } = await descifrarRegistro(r, frase);
    // cerrar() corrió mientras se derivaba (bloqueo, pagehide): la clave se descarta y la pantalla no abre el asunto (B-21).
    exigirEpoca(e);
    abierto(asuntoId, a);
    return { asuntoId, codigo: a.codigo, caseList: payload.caseList, table: payload.table };
  },

  guardar(asuntoId, datos) {
    return encolar(asuntoId, async () => {
      exigirContexto();
      const a = abiertos.get(asuntoId);
      if (!a) {
        perderAsunto(asuntoId);
        throw new SiglowError('SESION_DESCONOCIDA');
      }
      const asunto: DatosAsunto = { asuntoId, codigo: a.codigo, creado: a.creado, actualizado: ahora() };
      const r = await sellarRegistro(a.clave, asunto, { sal: a.sal, it: a.it }, serializarPayload(payloadDe(datos, asunto, __SIGLOW_VERSION__)));
      try {
        await ponerRegistro(r, claveEsperada(a));
      } catch (e) {
        // El registro ya no está (M-5) o cambió de frase (M-6): no se recrea ni se vuelve a la frase vieja; la sesión se pierde
        // y la pantalla se bloquea.
        if (e instanceof SiglowError && e.code === 'SESION_DESCONOCIDA') perderAsunto(asuntoId);
        throw e;
      }
    });
  },

  async exportar(datos, codigo, frase) {
    if (globalThis.isSecureContext !== true || !globalThis.crypto?.subtle) throw new SiglowError('CONTEXTO_NO_SEGURO');
    const asuntoId = datos.table.asuntoId;
    const c = codigoValido(codigo);
    const a = abiertos.get(asuntoId);
    const r = idbDisponible() ? await leerRegistro(asuntoId) : null;
    const pantalla = obtener().asunto;
    const guardado = a !== undefined || r !== null || perdidos.has(asuntoId)
      || (pantalla !== null && pantalla.asuntoId === asuntoId && pantalla.mode === 'guardar');
    let creado: string;
    if (guardado) {
      // Asunto guardado: hacen falta su clave y su registro. Sin ellos (otra pestaña lo borró, «Borrar todo», datos del sitio
      // borrados) ninguna frase exporta: la sesión se pierde y la pantalla se bloquea (B-20). Con ellos, exportarSiglow exige que
      // la frase abra el registro (B-16): una frase mal escrita no produce un .siglow que nadie abre.
      if (a === undefined || r === null) {
        perderAsunto(asuntoId);
        throw new SiglowError('SESION_DESCONOCIDA');
      }
      creado = a.creado;   // B-22: del texto cifrado (al abrir o crear), nunca del campo en claro del registro
    } else {
      // «No guardar»: la frase es nueva; además de la interfaz, el adaptador aplica validatePassphrase (INV-V10).
      if (typeof frase !== 'string' || validatePassphrase(frase, c).length > 0) throw new SiglowError('ENTRADA_INVALIDA');
      creado = ahora();
    }
    const it = r ? analizarEncabezado(r.encabezado).it : await calibrarIteraciones();
    const plano = serializarPayload(payloadDe(datos, { asuntoId, codigo: c, creado, actualizado: ahora() }, __SIGLOW_VERSION__));
    const json = await exportarSiglow(frase, asuntoId, it, plano, r);
    return descargarSiglow(json);
  },

  async exportarAsunto(asuntoId, frase) {
    const e = epoca;
    exigirContexto();
    const r = await leerRegistro(asuntoId);
    if (!r) throw new SiglowError('ENTRADA_INVALIDA');
    // Descifrar con la frase es la comprobación de B-16; la clave se descarta aquí mismo (nunca entra en `abiertos`).
    const { abierto: a, payload } = await descifrarRegistro(r, frase);
    // Época (AJ-1): un bloqueo durante la derivación descarta el resultado, sin serializar el texto plano ni descargar nada.
    exigirEpoca(e);
    const plano = serializarPayload(payloadDe({ caseList: payload.caseList, table: payload.table }, payload.asunto, __SIGLOW_VERSION__));
    // exportarSiglow deriva otra clave (sal nueva) y pone `plano` en ceros al terminar, también si falla.
    const json = await exportarSiglow(frase, asuntoId, a.it, plano, null);
    exigirEpoca(e);
    return descargarSiglow(json);
  },

  cambiarFrase(asuntoId, actual, nueva) {
    const e = epoca;   // AJ-1: se lee al pedir el cambio, también si espera turno en la cola del asunto
    return encolar(asuntoId, async () => {
      exigirEpoca(e);
      exigirContexto();
      let r = await leerRegistro(asuntoId);
      if (!r) throw new SiglowError('ENTRADA_INVALIDA');
      // INV-V10 antes de derivar nada (claveParaFraseNueva lo vuelve a comprobar).
      if (typeof nueva !== 'string' || validatePassphrase(nueva, r.codigo).length > 0) throw new SiglowError('ENTRADA_INVALIDA');
      const leido = await descifrarRegistro(r, actual);                          // la frase actual abre el registro
      const viejo = leido.abierto;
      let payload = leido.payload;
      exigirEpoca(e);                                                            // un bloqueo durante la derivación: nada se escribe
      const { clave, sal, it } = await claveParaFraseNueva(nueva, r.codigo);    // sal nueva e `it` recalibrado
      for (let intento = 1; ; intento++) {
        exigirEpoca(e);
        // B-23: `creado` del texto cifrado, nunca del campo en claro.
        const asunto: DatosAsunto = { asuntoId, codigo: payload.asunto.codigo, creado: payload.asunto.creado, actualizado: ahora() };
        const nuevo = await sellarRegistro(clave, asunto, { sal, it },
          serializarPayload(payloadDe({ caseList: payload.caseList, table: payload.table }, asunto, payload.appVersion)));
        exigirEpoca(e);                                                          // el último punto antes del `put`
        try {
          // En la misma transacción, solo si el registro es exactamente el que se descifró (misma clave y mismo encabezado):
          // ni otra frase ni un guardado concurrente con la clave vieja se pisan (M-6, B-28).
          await ponerRegistro(nuevo, { ...claveEsperada(viejo), encabezado: r.encabezado });
        } catch (e) {
          if (!(e instanceof SiglowError && e.code === 'SESION_DESCONOCIDA')) throw e;
          const otro = await leerRegistro(asuntoId);
          if (otro === null || !cifradoCon(otro, viejo)) {
            // Borrado o con otra frase (M-5, M-6): no se recrea ni se vuelve atrás; la sesión se pierde.
            perderAsunto(asuntoId);
            throw e;
          }
          // B-28: otra pestaña guardó con la clave vieja mientras se derivaba. Su tabla pasa a la clave nueva (sin derivar).
          if (intento >= INTENTOS_CAMBIAR_FRASE) throw new SiglowError('ERROR_INTERNO');
          payload = await descifrarConClave(otro, viejo);
          r = otro;
          continue;
        }
        // Esta pestaña sigue con el asunto abierto, ya con la clave nueva; las otras descartan la vieja y se bloquean.
        if (abiertos.has(asuntoId)) abierto(asuntoId, { clave, sal, it, codigo: asunto.codigo, creado: asunto.creado });
        difundirPerdido(asuntoId);
        return;
      }
    });
  },

  pasarAGuardar(codigo, frase, datos) {
    return guardarNuevo(codigo, frase, datos.table.asuntoId, datos);
  },

  cerrar() {
    epoca++;
    abiertos.clear();
  },

  async importar(archivo, frase, opcion) {
    const e = epoca;   // AJ-1: un bloqueo mientras se deriva la clave descarta el resultado, sin escribir nada
    exigirContexto();
    const { asuntoId: idArchivo, plano } = await abrirSiglow(archivo, frase);   // pasos 1 a 10
    let payload: VaultPayload;
    try {
      payload = validarPayload(plano, idArchivo);                                 // paso 11
    } finally {
      plano.fill(0);
    }
    exigirEpoca(e);
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
    exigirEpoca(e);   // el último punto antes de tocar `abiertos`, `perdidos` o el almacén
    // Un asunto reemplazado que estuviera abierto pierde su sesión: su clave no abre el registro nuevo. En esta pestaña, su
    // siguiente guardado bloquea; las otras se bloquean ya.
    for (const id of borrar) { abiertos.delete(id); perdidos.add(id); }
    if (borrar.length > 0) await reemplazarRegistros(borrar, r);
    else await agregarRegistro(r);
    for (const id of borrar) difundirPerdido(id);
    return { asuntoId, codigo, persisted: await pedirPersistencia() };
  },

  async borrarAsunto(asuntoId) {
    exigirContexto();
    abiertos.delete(asuntoId);
    perdidos.add(asuntoId);
    await borrarRegistro(asuntoId);
    difundirPerdido(asuntoId);   // M-5: la otra pestaña con el asunto abierto se bloquea sin esperar a su siguiente guardado
  },

  async borrarTodo() {
    exigirContexto();
    abiertos.clear();
    return borrarBase();
  },

  persistencia: () => persistenciaConcedida(),
};

// Otra pestaña borró todo o actualizó la base, o el navegador cerró la conexión a la fuerza (datos del sitio borrados): se
// descartan las claves, se abortan las aperturas en curso y, si hay un asunto guardado abierto, esta pestaña se bloquea (su
// registro ya no está; y aunque se intentara guardar, ponerRegistro no lo recrea).
alCerrarPorOtraPestana(() => {
  for (const id of abiertos.keys()) perdidos.add(id);
  bovedaIdb.cerrar();
  const a = obtener().asunto;
  if (a !== null && a.mode === 'guardar') bloquear(false);
});
