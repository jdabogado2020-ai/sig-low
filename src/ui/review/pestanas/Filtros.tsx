// Filtros de la lista de detecciones (8.2.6): categoría (8.4), estado, confianza y fuente. Filtran la cuadrícula; el contador cuenta todo.
import type { Confidence, DetectionSource, DetectionStatus } from '../../../core/types.ts';
import { Seleccion } from '../../campos.tsx';
import { etiqueta } from '../../mensajes.ts';
import { CATEGORIAS, type Categoria } from '../base/presentacion.ts';
import { tx } from '../base/textos.ts';
import { hayFiltros, ponerFiltros, useFiltros } from './herramientas.ts';
import { tp } from './textos.ts';

const ESTADOS: readonly DetectionStatus[] = ['pendiente', 'aceptada', 'rechazada', 'editada'];
const CONFIANZAS: readonly Confidence[] = ['alta', 'media', 'baja'];
const FUENTES: readonly DetectionSource[] = ['manual', 'lista', 'regla', 'modelo'];

export function Filtros() {
  const f = useFiltros();
  return (
    <details class="filtros-revision" data-prueba="filtros">
      <summary>{tp('M-1440')}</summary>
      <div class="filtros-campos">
      <Seleccion
        etiqueta={tp('M-1441')}
        valor={f.categoria}
        opciones={[['', tp('M-1445')], ...CATEGORIAS.map((c): readonly [string, string] => [c.id, tx(c.nombre as 'M-1383')])]}
        onCambio={(v) => { ponerFiltros({ categoria: v as Categoria | '' }); }}
      />
      <Seleccion
        etiqueta={tp('M-1442')}
        valor={f.estado}
        opciones={[['', tp('M-1446')], ...ESTADOS.map((e): readonly [string, string] => [e, etiqueta('estado', e)])]}
        onCambio={(v) => { ponerFiltros({ estado: v as DetectionStatus | '' }); }}
      />
      <Seleccion
        etiqueta={tp('M-1443')}
        valor={f.confianza}
        opciones={[['', tp('M-1445')], ...CONFIANZAS.map((c): readonly [string, string] => [c, etiqueta('confianza', c)])]}
        onCambio={(v) => { ponerFiltros({ confianza: v as Confidence | '' }); }}
      />
      <Seleccion
        etiqueta={tp('M-1444')}
        valor={f.fuente}
        opciones={[['', tp('M-1445')], ...FUENTES.map((s): readonly [string, string] => [s, etiqueta('fuente', s)])]}
        onCambio={(v) => { ponerFiltros({ fuente: v as DetectionSource | '' }); }}
      />
      <p class="ayuda">{tp('M-1447')}</p>
      {hayFiltros(f) ? (
        <button type="button" class="secundario" onClick={() => { ponerFiltros({ categoria: '', estado: '', confianza: '', fuente: '' }); }}>
          {tp('M-1448')}
        </button>
      ) : null}
      </div>
    </details>
  );
}
