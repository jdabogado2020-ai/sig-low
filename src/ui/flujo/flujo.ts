// F2 y F3 (D-23, D-24) · Piezas del flujo «Cargar y listo» que no son de una pantalla:
// - el caso efímero: al cargar un documento sin caso abierto, Sig-Low abre uno en memoria («No guardar», código automático, sin
//   contraseña) que el abogado no ve. Su tabla vive solo en esta pestaña y se vacía con el bloqueo, como cualquier «No guardar»;
// - la propuesta después de un cambio que deja detecciones por revisar (las apariciones de «Ocultar todas las apariciones» y los
//   datos que se escaparon): se aplica de nuevo, para que la vista previa siga con todo oculto y la descarga no quede bloqueada.
import { randomIds } from '../../io/txt-read.ts';
import { sello } from '../../core/report.ts';
import type { AsuntoId } from '../../core/types.ts';
import { contarPendientes } from '../../core/review/puerta.ts';
import { descartarAnalisis } from '../analisis.ts';
import { obtenerRevision, vaciarTodoElDocumento } from '../documento.ts';
import { actualizar, ir, obtener } from '../estado.ts';
import { despachar } from '../review/base/almacen.ts';
import { fijarListaDelCaso, fijarTabla, tablaVacia } from '../sesion.ts';

/** Abre el caso efímero si no hay ninguno abierto. Devuelve true si lo abrió. */
export function asegurarCaso(ahora: Date = new Date()): boolean {
  if (obtener().asunto !== null) return false;
  const asuntoId = randomIds().next('asu') as AsuntoId;
  fijarListaDelCaso([]);
  fijarTabla(tablaVacia(asuntoId));
  actualizar({
    asunto: { asuntoId, codigo: `DOC-${sello(ahora)}`, mode: 'no_guardar', persisted: null, tableRevision: 0, backedUpRevision: null, efimero: true },
  });
  return true;
}

/** D-24 · Si quedan detecciones por revisar y el modelo no está en curso, vuelve a aplicar la propuesta. */
export function reaplicarPropuesta(): void {
  const st = obtenerRevision();
  if (st === null || st.modelo.kind === 'en_curso' || contarPendientes(st) === 0) return;
  despachar({ kind: 'aplicar_propuesta' });
}

/**
 * M-140 y B-154 (P0-6a de F2+F3) · «Descartar este documento» y «Anonimizar otro documento»: el documento, la revisión, el borrador y
 * el original retenido quedan en cero (`vaciarTodoElDocumento`), como al bloquear. El caso efímero no pasa al documento siguiente: su
 * llave (con los originales ya consolidados) se cambia por una vacía; se conservan los nombres que el abogado escribió en la lista.
 * Un caso abierto a propósito (con código o contraseña) sigue abierto, con su llave.
 */
export function cerrarDocumento(): void {
  descartarAnalisis();
  vaciarTodoElDocumento();
  const a = obtener().asunto;
  if (a?.efimero === true) {
    const asuntoId = randomIds().next('asu') as AsuntoId;
    fijarTabla(tablaVacia(asuntoId));
    actualizar({ asunto: { ...a, asuntoId, tableRevision: 0, backedUpRevision: null } });
  }
  actualizar({ phase: 'vacio' });
  ir('inicio');
}
