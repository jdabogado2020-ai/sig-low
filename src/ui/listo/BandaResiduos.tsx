// Banda «Residuos incorporados» de Revisión (8.2.6, PC-5): al volver de Listo con hallazgos muestra M-78 con las ubicaciones
// (etiqueta neutra de la parte, línea, tipo y marcador; nunca el valor) y «Ir a la ubicación», que selecciona la detección pendiente
// que `incorporar_residuos` creó. Solo se pinta mientras Revisión es la pantalla actual y haya hallazgos de la última búsqueda.
import type { DetectionId } from '../../core/types.ts';
import { t } from '../mensajes.ts';
import { irA } from '../review/base/almacen.ts';
import { useListo } from './almacen.ts';
import { textoDeModo } from './busqueda.ts';
import { L } from './textos.ts';

export function BandaResiduos() {
  const { hallazgos, residuo } = useListo();
  if (residuo === null || hallazgos.length === 0) return null;
  return (
    <section class="banda-residuos" aria-labelledby="h-residuos-incorporados" data-prueba="banda-residuos">
      <h2 id="h-residuos-incorporados">{t(L.valoresEncontrados)}</h2>
      <p>{t('M-78', { n: residuo.hits.length + residuo.newDetections })}</p>
      <ul class="hallazgos">
        {hallazgos.map((h, i) => (
          <li key={i}>
            <span>{t(L.hallazgo, { seccion: h.seccion, linea: h.linea, tipo: h.tipo, marcador: h.marcador, modo: textoDeModo(h.modo) })}</span>
            {h.detectionId !== null ? (
              <button type="button" class="secundario" onClick={() => { irA(h.detectionId as DetectionId); }}>{t('M-973')}</button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
