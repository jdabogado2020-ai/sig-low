/**
 * Entrega del modelo (3.3, 2.2 fase 2; PF-2). Código propio. TypeScript puro: la red, la caché y la cuota entran por
 * `PuertosEntrega` (los aporta `src/ui/modelo-puerto.ts` con el service worker); aquí solo está la decisión.
 *
 * - Variantes (3.3): `navigator.deviceMemory` < 8 elige el respaldo (`gliner-x-base`); si no, el principal y, si su descarga
 *   no cabe en la cuota (`CUOTA_EXCEDIDA` o espacio libre menor que el modelo), el respaldo. Si tampoco cabe: plan B.
 * - Una descarga con un trozo alterado (`MODELO_INTEGRIDAD`) no prueba el respaldo: se borran los parciales y se declara el
 *   plan B con aviso (V-44). Un fallo de red tampoco.
 * - F11: dentro de un archivo, el reintento sigue donde se cortó si el servidor responde 206 a `Range` (src/sw.ts); con 200,
 *   empieza de cero. El SHA-256 del archivo completo se comprueba igual.
 * - F0: un archivo que falla por la red (`MODELO_NO_DESCARGADO`: corte, respuesta que no es 200 o silencio) se reintenta hasta
 *   `REINTENTOS_POR_ARCHIVO` veces. Si aun así falla, los archivos ya verificados (tamaño y SHA-256 en el service worker) se
 *   conservan: «Reintentar» sigue desde ahí, porque el SW no vuelve a pedir uno guardado y correcto. Con integridad, cuota o
 *   cancelación se borran los parciales, como antes. Un modelo a medias nunca se usa: solo cuenta como instalado el completo.
 */

import { SiglowError, type ErrorCode, type ModelManifest, type PlanBCause } from '../types';
import { bytesGuardados, IDS_MODELO, rutasDeDescarga, type IdModelo } from './manifest';

/** Memoria del equipo (GB) por debajo de la cual se elige el respaldo (3.3). */
export const MEMORIA_MINIMA_PRINCIPAL_GB = 8;

/** Reintentos de un archivo que falló por la red, además del primer intento (F0). */
export const REINTENTOS_POR_ARCHIVO = 2;
/** Pausa antes de cada reintento (se multiplica por el número de intento): da tiempo a que la conexión se recupere. */
export const PAUSA_REINTENTO_MS = 2_000;

/** Orden en que se intentan los modelos. `memoriaGb` es `navigator.deviceMemory` (solo existe en Chromium; null = no se sabe). */
export function ordenDeVariantes(memoriaGb: number | null): IdModelo[] {
  return memoriaGb !== null && memoriaGb < MEMORIA_MINIMA_PRINCIPAL_GB ? ['gliner-x-base'] : [...IDS_MODELO];
}

export interface PuertosEntrega {
  /** Manifiesto del modelo (del precache, verificado). Rechaza con `SiglowError`. */
  manifiesto(id: IdModelo): Promise<ModelManifest>;
  /**
   * Trae una ruta del manifiesto, comprueba tamaño y SHA-256 y la guarda en la caché del modelo. Rechaza con
   * `MODELO_INTEGRIDAD`, `CUOTA_EXCEDIDA` o `MODELO_NO_DESCARGADO`. `onBytes` informa los bytes de esa ruta ya recibidos.
   */
  descargarArchivo(id: IdModelo, ruta: string, onBytes: (n: number) => void, senal: AbortSignal): Promise<void>;
  /** Borra la caché del modelo (parciales o completa). */
  borrar(id: IdModelo): Promise<void>;
  /** `navigator.storage.estimate()`; null si el navegador no lo da. */
  cuota(): Promise<{ cuota: number; uso: number } | null>;
  /** `navigator.storage.persist()`; null si no existe. */
  persistir(): Promise<boolean | null>;
}

export interface AvanceEntrega { id: IdModelo; hechoBytes: number; totalBytes: number; respaldo: boolean }

export interface EntradaEntrega {
  memoriaGb: number | null;
  senal: AbortSignal;
  alAvance(a: AvanceEntrega): void;
  /** Se pasa al respaldo por falta de espacio (la interfaz muestra M-32 y M-168). */
  alRespaldo?(motivo: 'memoria_del_equipo' | 'sin_espacio'): void;
  /** Pausa antes del reintento `n` (1 o 2); por defecto `PAUSA_REINTENTO_MS × n`. Las pruebas la acortan. */
  pausaReintentoMs?(n: number): number;
}

export type ResultadoEntrega =
  | { tipo: 'listo'; id: IdModelo; respaldo: boolean; persistido: boolean | null }
  | { tipo: 'plan_b'; causa: 'espacio' | 'integridad' | 'red' | 'cancelado'; codigo: ErrorCode };

const esAbort = (senal: AbortSignal): boolean => senal.aborted;

/** Código de una excepción de `descargarArchivo` (solo por clase y `name`; su texto no sale). */
const codigoDe = (x: unknown): ErrorCode =>
  x instanceof SiglowError ? x.code : x instanceof Error && x.name === 'QuotaExceededError' ? 'CUOTA_EXCEDIDA' : 'MODELO_NO_DESCARGADO';

/** Espera `ms` o hasta que se cancele. */
const pausa = (ms: number, senal: AbortSignal): Promise<void> => new Promise((ok) => {
  if (ms <= 0 || senal.aborted) { ok(); return; }
  const fin = (): void => { clearTimeout(t); senal.removeEventListener('abort', fin); ok(); };
  const t = setTimeout(fin, ms);
  senal.addEventListener('abort', fin, { once: true });
});

/** Descarga con respaldo automático (3.3). No lanza: todo desenlace es un `ResultadoEntrega`. */
export async function entregarModelo(p: PuertosEntrega, e: EntradaEntrega): Promise<ResultadoEntrega> {
  const orden = ordenDeVariantes(e.memoriaGb);
  if (orden[0] === 'gliner-x-base') e.alRespaldo?.('memoria_del_equipo');
  let ultimoCodigo: ErrorCode = 'CUOTA_EXCEDIDA';
  for (const id of orden) {
    const respaldo = id === 'gliner-x-base';
    if (esAbort(e.senal)) return { tipo: 'plan_b', causa: 'cancelado', codigo: 'ENTRADA_INVALIDA' };
    let m: ModelManifest;
    try {
      m = await p.manifiesto(id);
    } catch (x) {
      return { tipo: 'plan_b', causa: 'red', codigo: x instanceof SiglowError ? x.code : 'MODELO_NO_DESCARGADO' };
    }
    const total = bytesGuardados(m);
    const q = await p.cuota().catch(() => null);
    if (q !== null && q.cuota - q.uso < total) {
      ultimoCodigo = 'CUOTA_EXCEDIDA';
      if (!respaldo) e.alRespaldo?.('sin_espacio');
      continue;
    }
    let acumulado = 0;
    try {
      for (const ruta of rutasDeDescarga(m)) {
        for (let intento = 0; ; intento++) {
          if (esAbort(e.senal)) throw new SiglowError('ENTRADA_INVALIDA');
          let previo = 0;
          try {
            await p.descargarArchivo(id, ruta, (n) => {
              acumulado += n - previo;
              previo = n;
              e.alAvance({ id, hechoBytes: acumulado, totalBytes: total, respaldo });
            }, e.senal);
            break;
          } catch (x) {
            // Lo recibido en el intento fallido se resta aquí. F11: el siguiente intento lo reanuda en el SW (Range) o vuelve a
            // empezar; en los dos casos el SW informa los bytes del archivo desde cero, así que el avance vuelve a sumarse entero.
            acumulado -= previo;
            if (esAbort(e.senal) || intento >= REINTENTOS_POR_ARCHIVO || codigoDe(x) !== 'MODELO_NO_DESCARGADO') throw x;
            e.alAvance({ id, hechoBytes: acumulado, totalBytes: total, respaldo });
            await pausa(e.pausaReintentoMs?.(intento + 1) ?? PAUSA_REINTENTO_MS * (intento + 1), e.senal);
          }
        }
      }
    } catch (x) {
      const codigo = codigoDe(x);
      // F0: tras un fallo de red se conservan los archivos ya verificados, para reanudar.
      const conservar = !esAbort(e.senal) && codigo !== 'MODELO_INTEGRIDAD' && codigo !== 'CUOTA_EXCEDIDA';
      if (!conservar) await p.borrar(id).catch(() => undefined);
      if (esAbort(e.senal)) return { tipo: 'plan_b', causa: 'cancelado', codigo: 'ENTRADA_INVALIDA' };
      if (codigo === 'CUOTA_EXCEDIDA') {
        ultimoCodigo = codigo;
        if (!respaldo) e.alRespaldo?.('sin_espacio');
        continue; // parciales borrados: se prueba el respaldo
      }
      return { tipo: 'plan_b', causa: codigo === 'MODELO_INTEGRIDAD' ? 'integridad' : 'red', codigo };
    }
    return { tipo: 'listo', id, respaldo, persistido: await p.persistir().catch(() => null) };
  }
  return { tipo: 'plan_b', causa: 'espacio', codigo: ultimoCodigo };
}

/** Qué hacer cuando el motor no pudo cargarse o se quedó sin memoria (`GlinerEngine.load` y `detectar`). */
export interface DecisionDeFallo {
  causa: PlanBCause;
  /** Probar el respaldo si ya está descargado (memoria o espacio insuficientes con el principal). */
  probarRespaldo: boolean;
  /** El modelo guardado no es confiable: se borra de la caché. */
  descartar: boolean;
}

export function decidirFallo(codigo: ErrorCode, esRespaldo: boolean): DecisionDeFallo {
  switch (codigo) {
    case 'MEMORIA':
    case 'CUOTA_EXCEDIDA':
      return { causa: 'memoria_insuficiente', probarRespaldo: !esRespaldo, descartar: false };
    case 'MODELO_INTEGRIDAD':
      return { causa: 'fallo_carga', probarRespaldo: false, descartar: true };
    case 'MODELO_NO_DESCARGADO':
      return { causa: 'no_descargado', probarRespaldo: false, descartar: false };
    default: // BACKEND_NO_DISPONIBLE (sin WebAssembly), TIEMPO_AGOTADO, ERROR_INTERNO…
      return { causa: 'fallo_carga', probarRespaldo: false, descartar: false };
  }
}

/**
 * Los trozos en orden, uno a la vez. El reensamblado del service worker (3.3) los entrega así: quien recibe el modelo
 * (`ner.worker.ts`) escribe cada trozo en SU búfer preasignado de `tamano` bytes, y en la caché solo se lee un trozo
 * por vez (≤ 24 MiB). Nunca se encadenan `Blob` ni se concatenan arreglos (eso duplicaría el modelo en memoria).
 * `leer` devuelve los bytes del trozo o null si falta.
 */
export async function* trozosEnOrden(
  m: ModelManifest,
  leer: (ruta: string) => Promise<Uint8Array | null>,
): AsyncGenerator<Uint8Array, void, void> {
  for (const t of m.trozos) {
    const bytes = await leer(t.ruta);
    if (bytes === null || bytes.byteLength !== t.tamano) throw new SiglowError('MODELO_NO_DESCARGADO');
    yield bytes;
  }
}
