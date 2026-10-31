/**
 * Protocolo del worker `ner` (6.11.1 y 6.11.3). Código propio de Sig-Low.
 *
 * Es la lógica de mensajes del worker, sin tocar `self`: `ner.worker.ts` solo la conecta con `postMessage`,
 * `fetch` y ORT-web. Así se prueba con un motor simulado.
 *
 * - Una sola operación de modelo a la vez (cola); `cancelar` salta la cola y es cooperativa.
 * - Los errores salen solo con `ErrorCode` (INV-W01, F-07): ningún mensaje ni pila de la excepción sale del worker.
 * - `progreso` y `parcial` no llevan texto del documento (INV-W07); tras `cancelar` no sale otro `parcial` (INV-W08).
 */

import { codigoDeError } from './gliner/errors';
import { esManifiesto } from './manifest';
import {
  SiglowError,
  type ErrorCode,
  type ModelManifest,
  type NerEngine,
  type NerOptions,
  type NerResponse,
  type NerSpan,
  type PartId,
  type RequestId,
} from '../types';

export interface NerHandlerDeps {
  post(msg: NerResponse): void;
  crearMotor(manifest: ModelManifest): NerEngine;
  /**
   * ¿Puede este entorno ejecutar WebAssembly? Lo decide `ner.worker.ts` (`typeof WebAssembly !== 'undefined'`). Si es `false`,
   * `cargar` termina con `BACKEND_NO_DISPONIBLE` antes de pedir un solo byte del modelo (Edge con seguridad mejorada
   * estricta, `--jitless`; T-ED-02). Sin esta dependencia se asume que sí.
   */
  backendDisponible?: () => boolean;
  now?: () => number;
}

const INTERVALO_PROGRESO_MS = 100; // máximo 10 mensajes de progreso por segundo (6.11.1)

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const esEntero = (x: unknown, min = 0): x is number => typeof x === 'number' && Number.isInteger(x) && x >= min;

const esOpciones = (x: unknown): x is NerOptions =>
  esObjeto(x) &&
  esEntero(x['windowTokens'], 1) &&
  esEntero(x['overlapWords']) &&
  x['maxSpanWords'] === 12 &&
  typeof x['threshold'] === 'number' &&
  x['threshold'] >= 0 &&
  x['threshold'] <= 1;

/** Devuelve el manejador de mensajes (`self.onmessage` lo llama con `event.data`). */
export function crearManejadorNer(deps: NerHandlerDeps): (data: unknown) => void {
  const now = deps.now ?? Date.now;
  let motor: NerEngine | null = null;
  let cola: Promise<void> = Promise.resolve();
  const activos = new Map<RequestId, AbortController>();

  const error = (reqId: RequestId, code: ErrorCode): void =>
    deps.post({ v: 1, reqId, kind: 'error', code, retryable: code === 'MODELO_NO_DESCARGADO' || code === 'TIEMPO_AGOTADO' });

  /** Ejecuta `tarea` en la cola; el error o la cancelación se informan aquí (el resultado, la propia tarea). */
  const encolar = (reqId: RequestId, tarea: (signal: AbortSignal) => Promise<boolean>): void => {
    const ac = new AbortController();
    activos.set(reqId, ac);
    cola = cola.then(async () => {
      try {
        if (ac.signal.aborted) {
          deps.post({ v: 1, reqId, kind: 'cancelado' });
          return;
        }
        const terminada = await tarea(ac.signal); // true = ya envió su resultado
        if (!terminada) deps.post({ v: 1, reqId, kind: 'cancelado' });
      } catch (e) {
        if (ac.signal.aborted || (e instanceof Error && e.name === 'AbortError')) deps.post({ v: 1, reqId, kind: 'cancelado' });
        else error(reqId, codigoDeError(e));
      } finally {
        activos.delete(reqId);
      }
    });
  };

  const cargar = (reqId: RequestId, manifest: ModelManifest): void =>
    encolar(reqId, async () => {
      if (deps.backendDisponible && !deps.backendDisponible()) throw new SiglowError('BACKEND_NO_DISPONIBLE');
      if (motor) {
        await motor.dispose(); // nunca hay dos sesiones grandes a la vez
        motor = null;
      }
      const nuevo = deps.crearMotor(manifest);
      let ultimo = -Infinity;
      try {
        const load = await nuevo.load((p) => {
          const t = now();
          if (t - ultimo < INTERVALO_PROGRESO_MS && p.done < p.total) return;
          ultimo = t;
          deps.post({ v: 1, reqId, kind: 'progreso', stage: 'modelo_carga', done: p.done, total: p.total, unit: 'bytes' });
        });
        motor = nuevo;
        deps.post({ v: 1, reqId, kind: 'resultado', payload: { kind: 'cargar', load } });
        return true;
      } catch (e) {
        await nuevo.dispose().catch(() => undefined);
        throw e;
      }
    });

  const detectar = (reqId: RequestId, partes: Array<{ partId: PartId; text: string }>, opciones: NerOptions): void =>
    encolar(reqId, async (signal) => {
      const m = motor;
      if (!m) throw new SiglowError('MODELO_NO_DESCARGADO');
      const t0 = now();
      const total = partes.reduce((s, p) => s + m.planWindows(p.text, opciones), 0);
      deps.post({ v: 1, reqId, kind: 'progreso', stage: 'modelo', done: 0, total, unit: 'ventanas' });
      let hechas = 0;
      let ultimo = now();
      for (const parte of partes) {
        if (signal.aborted) return false;
        await m.detect(parte.text, opciones, signal, (w) => {
          if (signal.aborted) return; // INV-W08: tras cancelar no sale otro parcial
          hechas += 1;
          const spans: NerSpan[] = w.spans;
          deps.post({
            v: 1,
            reqId,
            kind: 'parcial',
            payload: {
              windowsDone: hechas,
              windowsTotal: total,
              window: { partId: parte.partId, windowIndex: w.windowIndex, windowTotal: w.windowTotal, spans, ms: w.ms },
            },
          });
          const t = now();
          if (t - ultimo >= INTERVALO_PROGRESO_MS || hechas === total) {
            ultimo = t;
            deps.post({ v: 1, reqId, kind: 'progreso', stage: 'modelo', done: hechas, total, unit: 'ventanas' });
          }
        });
      }
      if (signal.aborted) return false;
      deps.post({ v: 1, reqId, kind: 'resultado', payload: { kind: 'detectar', windows: hechas, ms: now() - t0 } });
      return true;
    });

  const liberar = (reqId: RequestId): void =>
    encolar(reqId, async () => {
      const m = motor;
      motor = null;
      if (m) await m.dispose();
      deps.post({ v: 1, reqId, kind: 'resultado', payload: { kind: 'liberar' } });
      return true;
    });

  const procesar = (data: unknown): void => {
    if (!esObjeto(data) || typeof data['reqId'] !== 'string') {
      error('' as RequestId, 'ENTRADA_INVALIDA');
      return;
    }
    const reqId = data['reqId'] as RequestId;
    if (data['v'] !== 1) return error(reqId, 'ENTRADA_INVALIDA');
    const payload = data['payload'];
    switch (data['kind']) {
      case 'cargar':
        if (!esObjeto(payload) || !esManifiesto(payload['manifest'])) return error(reqId, 'ENTRADA_INVALIDA');
        return cargar(reqId, payload['manifest']);
      case 'detectar': {
        if (!esObjeto(payload) || !Array.isArray(payload['parts']) || !esOpciones(payload['options'])) {
          return error(reqId, 'ENTRADA_INVALIDA');
        }
        const partes: Array<{ partId: PartId; text: string }> = [];
        for (const p of payload['parts'] as unknown[]) {
          if (!esObjeto(p) || typeof p['partId'] !== 'string' || typeof p['text'] !== 'string') return error(reqId, 'ENTRADA_INVALIDA');
          partes.push({ partId: p['partId'] as PartId, text: p['text'] });
        }
        return detectar(reqId, partes, payload['options']);
      }
      case 'liberar':
        return liberar(reqId);
      case 'cancelar': {
        if (!esObjeto(payload) || typeof payload['targetReqId'] !== 'string') return error(reqId, 'ENTRADA_INVALIDA');
        activos.get(payload['targetReqId'] as RequestId)?.abort();
        return;
      }
      default:
        return error(reqId, 'ENTRADA_INVALIDA');
    }
  };

  // Nada que se lance sale con su texto: toda excepción síncrona se traduce a ERROR_INTERNO (INV-W01, INV-W02, F-07).
  return (data: unknown): void => {
    try {
      procesar(data);
    } catch {
      const id = esObjeto(data) && typeof data['reqId'] === 'string' ? (data['reqId'] as RequestId) : ('' as RequestId);
      error(id, 'ERROR_INTERNO');
    }
  };
}
