// Leyenda (8.4.5): divulgación (no ventana emergente) con tres bloques en texto: las 8 categorías con muestra, abreviaturas y
// nombres de tipo; los tres estilos de borde; y los íconos y marcas de 8.4.4. Se cierra con Esc o con el mismo botón.
import { IconoDeEstado, Insignia } from './iconos.tsx';
import { abreviaturaDe, CATEGORIAS, nombreDeTipo } from './presentacion.ts';
import { tx } from './textos.ts';

export const ID_LEYENDA = 'leyenda-revision';

export function Leyenda({ abierta }: { abierta: boolean }) {
  if (!abierta) return null;
  return (
    <section id={ID_LEYENDA} class="leyenda" aria-label={tx('M-1370')} data-prueba="leyenda">
      <h3>{tx('M-1370')}</h3>
      <ul class="leyenda-categorias">
        {CATEGORIAS.map((c) => (
          <li key={c.id}>
            <strong>{tx(c.nombre)}</strong>
            <ul>
              {c.tipos.map((tipo) => (
                <li key={tipo}>
                  <span class={`res muestra cat-${c.id} conf-alta est-pendiente`}>
                    <Insignia abreviatura={abreviaturaDe(tipo)} estado="pendiente" />
                    <span>{nombreDeTipo(tipo)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <h3>{tx('M-1371')}</h3>
      <ul class="leyenda-bordes">
        <li><span class="res muestra cat-per conf-alta est-pendiente"><span>{tx('M-1373')}</span></span></li>
        <li><span class="res muestra cat-per conf-media est-pendiente"><span>{tx('M-1374')}</span></span></li>
        <li><span class="res muestra cat-per conf-baja est-pendiente"><span>{tx('M-1375')}</span></span></li>
      </ul>
      <h3>{tx('M-1372')}</h3>
      <ul class="leyenda-marcas">
        <li><span class="ins" aria-hidden="true"><IconoDeEstado estado="pendiente" /></span> {tx('M-1376')}</li>
        <li><span class="ins" aria-hidden="true"><IconoDeEstado estado="aceptada" /></span> {tx('M-1377')}</li>
        <li><span class="ins" aria-hidden="true"><IconoDeEstado estado="editada" /></span> {tx('M-1378')}</li>
        <li><span class="ins" aria-hidden="true"><IconoDeEstado estado="rechazada" /></span> {tx('M-1379')}</li>
        <li><Insignia abreviatura="" estado="pendiente" sugerencia /> {tx('M-1380')}</li>
        <li><Insignia abreviatura="" bandera /> {tx('M-1381')}</li>
        <li><Insignia abreviatura="" estado="pendiente" nueva /> {tx('M-1382')}</li>
      </ul>
    </section>
  );
}
