// Búsqueda de residuos de la pantalla Listo (7.13, 8.2.7): corre sola al entrar y cada vez que el resultado queda desactualizado.
// Solo se ejecuta con 0 detecciones pendientes (7.13.7). Si no pasa, despacha `incorporar_residuos` y (F3, D-24) vuelve a aplicar la
// propuesta: lo encontrado también queda oculto y aparece en la vista previa como punto para revisar; si pasa, deja el `ResidueResult` en el almacén de Listo. Corre en el hilo principal (8.8); solo la
// pasada 3 va al worker `detect` por `detectarEnSalida`. Nada de lo buscado sale de esta función: ni consola, ni URL, ni informe.
import { emptyTable, tableIndexOf } from '../../core/entities.ts';
import { createRuleRegistry } from '../../core/pipeline.ts';
import { render } from '../../core/render.ts';
import { runResidueCheck } from '../../core/residue.ts';
import { contarPendientes } from '../../core/review/puerta.ts';
import type { AsuntoId, MappingTable, RenderedOutput, ResidueHit, ReviewState } from '../../core/types.ts';
import { detectarEnSalida, fechaDeReferencia } from '../analisis.ts';
import { obtenerDocumento, obtenerRevision } from '../documento.ts';
import { reaplicarPropuesta } from '../flujo/flujo.ts';
import { t, type MessageId } from '../mensajes.ts';
import { despachar } from '../review/base/almacen.ts';
import { nombreDeTipo } from '../review/base/presentacion.ts';
import { obtenerListaDelCaso, obtenerTabla, quitarAvisoAsunto } from '../sesion.ts';
import { actualizarListo, obtenerListo, type Hallazgo } from './almacen.ts';
import { L } from './textos.ts';

const MODO: Readonly<Record<ResidueHit['mode'], MessageId>> = {
  literal: L.modoLiteral, normalizado: L.modoNormalizado, digitos: L.modoDigitos, variante: L.modoVariante,
};
export const textoDeModo = (modo: ResidueHit['mode']): string => t(MODO[modo]);

const CODIGO = /^[A-Z][A-Z_]{2,40}$/u;
/** Solo un código de error: ni `message` libre ni `stack` salen de aquí (F-12). */
function codigoDe(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'code' in e && typeof (e as { code: unknown }).code === 'string') return (e as { code: string }).code;
  if (e instanceof Error && CODIGO.test(e.message)) return e.message;
  return 'ERROR_INTERNO';
}

/** Hallazgos descritos solo con datos [P]: etiqueta neutra de la sección, línea, tipo, marcador y modo (7.13.8). */
export function describirHallazgos(state: ReviewState, out: RenderedOutput, hits: readonly ResidueHit[]): Hallazgo[] {
  return hits.map((h) => {
    const seccion = out.sections[h.sectionIndex];
    const entidad = state.entities[h.entityId];
    const antes = seccion === undefined ? '' : seccion.text.slice(0, h.start);
    return {
      seccion: seccion?.label ?? '', linea: antes.split('\n').length, tipo: entidad === undefined ? '' : nombreDeTipo(entidad.type),
      marcador: entidad?.marker ?? '', modo: h.mode, partId: h.partId, partStart: h.partStart, detectionId: null,
    };
  });
}

/** Valores originales de las entidades heredadas del asunto, por clave canónica (7.13.2): el contexto `originals` de la búsqueda. */
function originalesDelAsunto(tabla: MappingTable | null): Record<string, readonly string[]> {
  const r: Record<string, readonly string[]> = {};
  if (tabla !== null) for (const e of Object.values(tabla.entries)) r[e.canonicalKey] = [...e.originals];
  return r;
}

/**
 * Ejecuta la búsqueda sobre el estado vigente. Si la revisión cambió mientras buscaba, descarta el resultado (el efecto de la
 * pantalla vuelve a lanzarla). Con hallazgos incorpora los residuos y los oculta con la propuesta (D-24); la vista previa los muestra
 * como puntos para revisar y el efecto de la pantalla vuelve a buscar.
 */
export async function buscarResiduos(): Promise<void> {
  if (obtenerListo().buscando) return;
  const doc = obtenerDocumento();
  const state = obtenerRevision();
  if (doc === null || state === null || contarPendientes(state) > 0) return;
  actualizarListo({ buscando: true, errorBusqueda: null });
  try {
    const out = render(doc, state);
    const tabla = obtenerTabla();
    const tablaIdx = tableIndexOf(tabla ?? emptyTable('asu_' as AsuntoId));
    const run = await runResidueCheck(doc, state, out, {
      table: tablaIdx, caseList: obtenerListaDelCaso(), rules: createRuleRegistry(Number(fechaDeReferencia().slice(0, 4))),
      detect: detectarEnSalida, originals: originalesDelAsunto(tabla),
    });
    const vigente = obtenerRevision();
    if (vigente === null || vigente.docId !== state.docId) { actualizarListo({ buscando: false }); return; }   // se vació el estado (INV-G09)
    if (vigente.revision !== state.revision) { actualizarListo({ buscando: false }); return; }   // el efecto la lanza de nuevo
    const { result, nuevas } = run;
    if (result.hits.length === 0 && nuevas.length === 0 && result.newDetections === 0) {
      quitarAvisoAsunto('M-78');
      // Los hallazgos de vueltas anteriores siguen siendo puntos para revisar (ya están ocultos).
      actualizarListo({ residuo: result, buscando: false });
      return;
    }
    const hallazgos = describirHallazgos(state, out, result.hits);
    const r = despachar({ kind: 'incorporar_residuos', residueRevision: result.revision, candidates: nuevas });
    if (!r.ok) { actualizarListo({ residuo: result, hallazgos, buscando: false, errorBusqueda: { codigo: r.code, revision: state.revision } }); return; }
    // «Ir a la ubicación»: la detección pendiente que `incorporar_residuos` creó en el tramo del hallazgo.
    const despues = obtenerRevision();
    const conUbicacion = hallazgos.map((h): Hallazgo => {
      const id = despues?.order.find((x) => { const d = despues.detections[x]; return d !== undefined && d.status === 'pendiente' && d.partId === h.partId && d.start === h.partStart; });
      return id === undefined ? h : { ...h, detectionId: id };
    });
    const previos = obtenerListo().docIdHallazgos === state.docId ? obtenerListo().hallazgos : [];
    actualizarListo({ residuo: result, hallazgos: [...previos, ...conUbicacion], docIdHallazgos: state.docId, buscando: false });
    reaplicarPropuesta();
  } catch (e) {
    const vigente = obtenerRevision();
    actualizarListo({ buscando: false, errorBusqueda: { codigo: codigoDe(e), revision: vigente?.revision ?? state.revision } });
  }
}
