// Gancho de prueba de Listo (PC-5). Solo se importa en el build `vite build --mode medicion` (Listo.tsx, bajo `__SIGLOW_MEDICION__`);
// nunca existe en `dist/` (check-dist, T-CD-01). Permite a las E2E llegar a Listo sin pasar por «Continuar» (de PC-4) y forzar cada
// `GateReason` (T-IU-01): decidir las detecciones UNA POR UNA con el reductor (nunca en bloque), fijar el avance del modelo y fijar el
// resultado de residuos. No trae texto del documento: solo conteos y códigos.
import { ir } from '../estado.ts';
import { fijarRevision, obtenerRevision } from '../documento.ts';
import type { ModelProgress, ResidueResult } from '../../core/types.ts';
import { despachar } from '../review/base/almacen.ts';
import { actualizarListo, obtenerListo } from './almacen.ts';
import { puertaDe } from './almacen.ts';

function decidirUnoAUno(): number {
  const s = obtenerRevision();
  if (s === null) return -1;
  let n = 0;
  for (const id of s.order) {
    const d = obtenerRevision()?.detections[id];
    if (d?.status === 'pendiente' && despachar({ kind: 'aceptar', detectionId: id }).ok) n++;
  }
  for (const f of Object.values(obtenerRevision()?.flags ?? {})) {
    if (!f.acknowledged && despachar({ kind: 'resolver_bandera', flagId: f.id, resolution: 'mantener' }).ok) n++;
  }
  return n;
}

export function instalarPruebaListo(): void {
  (globalThis as unknown as Record<string, unknown>)['__siglowListoPrueba'] = {
    irAListo: (): void => { ir('listo'); },
    /** El build de medición no trae la caché del service worker: fija el SHA-256 de index.html que usa el informe. */
    fijarCompilacion: (hex: string): void => { actualizarListo({ compilacion: hex }); },
    /** Devuelve a `pendiente` la primera detección aceptada (una acción de revisión que sube `revision`, INV-R07). */
    restablecerPrimera: (): boolean => {
      const s = obtenerRevision();
      const id = s?.order.find((x) => s.detections[x]?.status === 'aceptada');
      return id !== undefined && despachar({ kind: 'restablecer', detectionId: id }).ok;
    },
    /** Edita el reemplazo de la detección cuyo texto es `original` (solo para forzar un hallazgo de residuos). */
    editarPorTexto: (original: string, nuevo: string): boolean => {
      const s = obtenerRevision();
      const id = s?.order.find((x) => s.detections[x]?.text === original);
      return id !== undefined && despachar({ kind: 'editar', detectionId: id, text: nuevo }).ok;
    },
    decidirUnoAUno,
    /** Fija el avance del modelo sin cambiar `revision` (simula la llegada de ventanas). */
    fijarModelo: (m: ModelProgress): void => {
      const s = obtenerRevision();
      if (s !== null) fijarRevision({ ...s, modelo: m });
    },
    /** Fija un resultado de residuos para la revisión vigente (o la dada) con `hits` y `nuevas` simulados. */
    fijarResiduo: (hits: number, nuevas: number, revision?: number): void => {
      const s = obtenerRevision();
      if (s === null) return;
      const unaEntidad = Object.keys(s.entities)[0] ?? 'ent_0';
      const r: ResidueResult = {
        revision: revision ?? s.revision, ranAt: '2026-10-30T10:00:00-05:00', valuesSearched: 5, modes: ['literal', 'normalizado', 'digitos', 'variante'],
        hits: Array.from({ length: hits }, () => ({ sectionIndex: 0, start: 0, end: 1, partId: s.order.length > 0 ? (s.detections[s.order[0] as keyof typeof s.detections]?.partId ?? 'prt_0') : 'prt_0', partStart: 0, entityId: unaEntidad, mode: 'literal' as const })) as ResidueResult['hits'],
        newDetections: nuevas,
      };
      actualizarListo({ residuo: r });
    },
    /** Estado observable sin texto del documento. */
    estado: (): { revision: number; ok: boolean; motivos: string[]; residuoRevision: number | null; buscando: boolean; committed: boolean; copiado: boolean; banderas: number } => {
      const s = obtenerRevision();
      const l = obtenerListo();
      const g = s === null ? { ok: false, reasons: [] } : puertaDe(s);
      return { revision: s?.revision ?? -1, ok: g.ok, motivos: g.reasons, residuoRevision: l.residuo?.revision ?? null, buscando: l.buscando, committed: s?.committed ?? false, copiado: l.copiado, banderas: Object.keys(s?.flags ?? {}).length };
    },
  };
}
