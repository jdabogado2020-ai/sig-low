// F3 (D-24) · La búsqueda de datos que se escaparon corre sola en la vista previa y en la descarga: al llegar y después de cada cambio
// (cada acción sube `revision` y deja el resultado anterior desactualizado, INV-R07). Solo con 0 por revisar y el modelo terminado u
// omitido (7.13.7, INV-R11). Lo que encuentra se oculta (busqueda.ts) y vuelve como punto para revisar.
import { useEffect } from 'preact/hooks';
import { contarPendientes } from '../../core/review/puerta.ts';
import type { ReviewState } from '../../core/types.ts';
import { actualizarListo, type EstadoListo } from '../listo/almacen.ts';
import { buscarResiduos } from '../listo/busqueda.ts';

export function useBusquedaAutomatica(state: ReviewState | null, listo: EstadoListo): void {
  const pendientes = state === null ? 0 : contarPendientes(state);
  const enCurso = state?.modelo.kind === 'en_curso';
  useEffect(() => {
    if (state === null || listo.buscando || pendientes > 0 || enCurso) return;
    if (listo.residuo !== null && listo.residuo.revision === state.revision) return;
    if (listo.errorBusqueda !== null && listo.errorBusqueda.revision === state.revision) return;
    void buscarResiduos();
  }, [state?.revision, pendientes, enCurso, listo.buscando, listo.residuo, listo.errorBusqueda]);
}

/** «Buscar de nuevo» tras un error de la búsqueda. */
export function buscarOtraVez(): void {
  actualizarListo({ errorBusqueda: null });
  void buscarResiduos();
}
