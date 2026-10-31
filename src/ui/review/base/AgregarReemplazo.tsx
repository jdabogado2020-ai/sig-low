// Diálogo «Agregar reemplazo» (8.2.6): tipo (una organización elige su clase como tipo), rol si es persona y casilla
// «Aplicar a todas las apariciones idénticas». Efecto: `agregar_manual` con `propagate` (6.4.4): detección `manual`, aceptada,
// con `precedence` 1. Lo abre la selección con el ratón (botón flotante) o la búsqueda propia de PC-4 (`solicitarReemplazo`).
import { useEffect, useState } from 'preact/hooks';
import type { DetectableType, Role } from '../../../core/types.ts';
import { atributosDeContenedor, Casilla, Seleccion } from '../../campos.tsx';
import { Dialogo } from '../../dialogo.tsx';
import { etiqueta, mensajeDeCodigo, ROTULOS, t } from '../../mensajes.ts';
import { agregarManual } from './acciones.ts';
import { limpiarError, solicitarReemplazo, useRevision } from './almacen.ts';
import { nombreDeTipo, TIPOS_ELEGIBLES } from './presentacion.ts';
import { tx } from './textos.ts';

const ROLES_PERSONA: readonly Role[] = ['DEMANDANTE', 'DEMANDADO', 'TESTIGO', 'PACIENTE', 'CLIENTE', 'CONTACTO', 'OTRA_PERSONA'];

export function AgregarReemplazo() {
  const { reemplazo, doc, error } = useRevision();
  const [tipo, setTipo] = useState<string>('PERSONA');
  const [rol, setRol] = useState<string>('OTRA_PERSONA');
  const [propagar, setPropagar] = useState(false);
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => { if (reemplazo !== null) { setLocal(null); limpiarError(); } }, [reemplazo]);

  const parte = reemplazo !== null && doc !== null ? doc.parts.find((p) => p.id === reemplazo.partId) : undefined;
  const largo = reemplazo !== null ? reemplazo.end - reemplazo.start : 0;
  const cerrar = (): void => { solicitarReemplazo(null); setLocal(null); };
  const confirmar = (): void => {
    if (reemplazo === null) return;
    const r = tipo === 'PERSONA' ? (rol as Role) : undefined;
    if (agregarManual(reemplazo, tipo as DetectableType, r, propagar)) cerrar();
    else setLocal('x');
  };
  return (
    <Dialogo abierto={reemplazo !== null} titulo={t(ROTULOS.agregar_reemplazo)} onCerrar={cerrar}>
      {reemplazo !== null ? (
        <>
          <p class="ayuda">{tx('M-1395', { n: largo })}</p>
          <p class="dato-texto" data-prueba="reemplazo-texto" ref={atributosDeContenedor}>{parte?.text.slice(reemplazo.start, reemplazo.end) ?? ''}</p>
          {local !== null && error !== null ? <p class="error-campo" role="alert">{mensajeDeCodigo(error)}</p> : null}
          <Seleccion
            etiqueta={tx('M-1396')}
            valor={tipo}
            opciones={TIPOS_ELEGIBLES.map((x): readonly [string, string] => [x, nombreDeTipo(x)])}
            onCambio={setTipo}
          />
          {tipo === 'PERSONA' ? (
            <Seleccion
              etiqueta={tx('M-1397')}
              valor={rol}
              opciones={ROLES_PERSONA.map((r): readonly [string, string] => [r, etiqueta('rol', r)])}
              onCambio={setRol}
            />
          ) : null}
          <Casilla etiqueta={t(ROTULOS.aplicar_a_todas_las_apariciones_identica)} marcada={propagar} onCambio={setPropagar} />
          <div class="acciones">
            <button type="button" onClick={confirmar}>{t(ROTULOS.agregar_reemplazo)}</button>
            <button type="button" class="secundario" onClick={cerrar}>{t(ROTULOS.cancelar)}</button>
          </div>
        </>
      ) : null}
    </Dialogo>
  );
}
