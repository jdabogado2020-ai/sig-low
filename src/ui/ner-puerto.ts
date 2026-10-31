// Puerto `ner` (PF-2, 6.11.3): lanza el worker `ner` sobre un documento ya leído y entrega sus resultados por ventanas.
// `NerPuerto.iniciar(doc, hooks)` es el contrato de PC-2 (servicios.ts); aquí se implementa con el worker real.
// - Un worker por análisis; se termina al acabar, al cancelar o al fallar (la memoria del modelo vuelve al sistema).
// - Qué modelo: el principal si está guardado; si su carga se queda sin memoria y el respaldo está guardado, se reintenta con
//   él (3.3, antes de recibir ninguna ventana). Cualquier otro fallo es plan B con su causa (`decidirFallo`).
// - Ni el texto del documento ni los tramos se registran: los mensajes del worker solo se reenvían a los ganchos.
import { cryptoIds } from '../core/entities.ts';
import type { IdModelo } from '../core/ner/manifest.ts';
import type { ErrorCode, ModelManifest, NerLoadResult, NerOptions, NerSpan, PartId, PlanBCause } from '../core/types.ts';
import { alFallarElMotor, manifiestoDe, modeloInstalado, respaldoGuardado } from './modelo-puerto.ts';
import type { NerHooks, NerPuerto } from './servicios.ts';

/** Tiempo que se espera a que el worker confirme una cancelación antes de terminarlo. */
const GRACIA_CANCELACION_MS = 2_000;

const CODIGO = /^[A-Z][A-Z0-9_]{2,40}$/;

export function crearWorkerNer(): Worker {
  return new Worker(new URL('../workers/ner.worker.ts', import.meta.url), { type: 'module' });
}

interface Ejecucion { cancelar(): void }

/** Un análisis con el modelo `id`. Resuelve cuando termina; rechaza con el código del primer fallo (sin texto). */
function ejecutar(
  id: IdModelo,
  doc: Parameters<NerPuerto['iniciar']>[0],
  hooks: NerHooks,
  m: ModelManifest,
  crear: () => Worker,
  salida: { ventanas: number; cancelar: (() => void) | null },
): Promise<void> {
  return new Promise<void>((ok, mal) => {
    let worker: Worker;
    try {
      worker = crear();
    } catch {
      mal(Object.assign(new Error('ERROR_INTERNO'), { codigo: 'ERROR_INTERNO' as ErrorCode }));
      return;
    }
    const reqCargar = cryptoIds.next('req');
    const reqDetectar = cryptoIds.next('req');
    let load: NerLoadResult | null = null;
    let terminado = false;
    const cerrar = (): void => {
      terminado = true;
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };
    const fallar = (codigo: ErrorCode): void => {
      if (terminado) return;
      cerrar();
      mal(Object.assign(new Error(codigo), { codigo }));
    };
    salida.cancelar = (): void => {
      if (terminado) return;
      try {
        worker.postMessage({ v: 1, reqId: cryptoIds.next('req'), kind: 'cancelar', payload: { targetReqId: load === null ? reqCargar : reqDetectar } });
      } catch { /* se termina abajo */ }
      setTimeout(() => { if (!terminado) { cerrar(); ok(); } }, GRACIA_CANCELACION_MS);
    };
    worker.onerror = (ev): void => { ev.preventDefault(); fallar('ERROR_INTERNO'); };
    worker.onmessageerror = (ev): void => { ev.preventDefault(); fallar('ERROR_INTERNO'); };
    worker.onmessage = (ev: MessageEvent<unknown>): void => {
      const d = ev.data as { v?: unknown; reqId?: unknown; kind?: unknown; code?: unknown; payload?: unknown; stage?: unknown; total?: unknown } | null;
      if (terminado || d === null || typeof d !== 'object' || d.v !== 1) return;
      if (d.kind === 'error') {
        fallar(typeof d.code === 'string' && CODIGO.test(d.code) ? (d.code as ErrorCode) : 'ERROR_INTERNO');
        return;
      }
      if (d.kind === 'cancelado') { cerrar(); ok(); return; }
      if (d.reqId === reqCargar && d.kind === 'resultado') {
        const p = d.payload as { kind?: unknown; load?: NerLoadResult } | undefined;
        if (!p || p.kind !== 'cargar' || !p.load) { fallar('ERROR_INTERNO'); return; }
        load = p.load;
        const partes = doc.parts.filter((x) => x.included && x.text.length > 0).map((x) => ({ partId: x.id, text: x.text }));
        const opciones: NerOptions = {
          windowTokens: m.ventanaTokens, overlapWords: m.solapePalabras, maxSpanWords: 12, threshold: m.umbral,
          labels: ['person', 'organization', 'location'], threads: load.threads,
        };
        worker.postMessage({ v: 1, reqId: reqDetectar, kind: 'detectar', payload: { parts: partes, options: opciones } });
        return;
      }
      if (d.reqId !== reqDetectar) return;
      if (d.kind === 'progreso' && d.stage === 'modelo' && typeof d.total === 'number' && load !== null && salida.ventanas === 0) {
        hooks.alTotal(d.total, load.warmupWindowMs);
        return;
      }
      if (d.kind === 'parcial' && load !== null) {
        const p = d.payload as { windowsDone: number; windowsTotal: number; window: { partId: PartId; spans: NerSpan[] } };
        salida.ventanas += 1;
        hooks.alVentana({
          ventana: p.windowsDone, ventanasTotales: p.windowsTotal, ner: { [p.window.partId]: p.window.spans } as Record<PartId, NerSpan[]>,
          engineId: load.engineId,
        });
        return;
      }
      if (d.kind === 'resultado') {
        cerrar();
        hooks.alTerminar({ respaldo: id === 'gliner-x-base' });
        ok();
      }
    };
    try {
      worker.postMessage({ v: 1, reqId: reqCargar, kind: 'cargar', payload: { manifest: m } });
    } catch {
      fallar('ERROR_INTERNO');
    }
  });
}

const codigoDe = (e: unknown): ErrorCode => (typeof e === 'object' && e !== null && 'codigo' in e ? ((e as { codigo: ErrorCode }).codigo) : 'ERROR_INTERNO');

/** Implementación de `NerPuerto`. `crear` permite sustituir el worker en pruebas. */
export function crearNerPuerto(crear: () => Worker = crearWorkerNer): NerPuerto {
  return {
    iniciar(doc, hooks): Ejecucion {
      let cancelado = false;
      const salida: { ventanas: number; cancelar: (() => void) | null } = { ventanas: 0, cancelar: null };
      const fallo = (causa: PlanBCause): void => { if (!cancelado) hooks.alFallar(causa); };
      void (async (): Promise<void> => {
        let id = modeloInstalado();
        if (id === null) { fallo('no_descargado'); return; }
        for (;;) {
          let m: ModelManifest;
          try {
            m = await manifiestoDe(id);
          } catch {
            fallo('no_descargado');
            return;
          }
          if (cancelado) return;
          try {
            await ejecutar(id, doc, hooks, m, crear, salida);
            return;
          } catch (e) {
            if (cancelado) return;
            const codigo = codigoDe(e);
            const d = await alFallarElMotor(id, codigo);
            // Respaldo (3.3): solo si el principal no cupo en memoria al cargar (aún sin ventanas) y el respaldo ya está guardado.
            if (d.probarRespaldo && salida.ventanas === 0 && (await respaldoGuardado())) {
              id = 'gliner-x-base';
              continue;
            }
            fallo(d.causa);
            return;
          }
        }
      })();
      return {
        cancelar(): void {
          cancelado = true;
          salida.cancelar?.();
        },
      };
    },
  };
}

export const nerPuerto: NerPuerto = crearNerPuerto();
