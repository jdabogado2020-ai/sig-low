// Parte superior de la Revisión II (PC-4, 8.2.6), encima del texto: banda del modelo, contador con recorrido de pendientes y
// «Continuar», filtros de la lista y búsqueda propia. La monta RevisionBase.tsx entre la barra de herramientas y el cuerpo.
import './revision-pestanas.css';
import { t } from '../../mensajes.ts';
import { registrarAnuncioDelModelo, useRevisionUi } from '../base/almacen.ts';
import './banda.ts';
import { Banda } from './Banda.tsx';
import { Busqueda } from './Busqueda.tsx';
import { Filtros } from './Filtros.tsx';
import { Progreso } from './Progreso.tsx';

// El anuncio de las ventanas del modelo es el M-166 (como máximo cada 5 s, y nunca durante una edición: lo garantiza el almacén).
registrarAnuncioDelModelo((n) => t('M-166', { n }));

export function RevisionBarra() {
  const { state } = useRevisionUi();
  if (state === null) return null;
  return (
    <div class="revision-barra" data-prueba="revision-barra">
      <Banda />
      <Progreso />
      <div class="herramientas-revision">
        <Busqueda />
        <Filtros />
      </div>
    </div>
  );
}
