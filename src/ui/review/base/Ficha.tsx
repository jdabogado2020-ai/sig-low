// Ficha de la detección seleccionada (8.2.6): acciones por mención (aceptar, rechazar con motivo, editar, restablecer, cambiar tipo,
// separar de la entidad) y por entidad (aceptar o rechazar todas, cambiar rol o clase, unir, marcador específico).
// Los errores del reductor se muestran con 8.5.5 en una región `alert`; el estado no cambia si hay error.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { DetectableType, Detection, Entity, RejectReason, ReviewState, Role } from '../../../core/types.ts';
import { ORG_CLASSES } from '../../../core/types.ts';
import { atributosDeContenido, Seleccion, useIdNeutro } from '../../campos.tsx';
import { etiqueta, mensajeDeCodigo, ROTULOS, t } from '../../mensajes.ts';
import {
  aceptar, aceptarEntidad, cambiarRol, cambiarTipo, editar, especificarDocumento, rechazar, rechazarEntidad, restablecer, separar, unir,
} from './acciones.ts';
import { limpiarError, marcarEdicion, pedirEnfoque, seleccionar, seleccionarEntidad, solicitarEdicion, terminarEdicion, useRevision } from './almacen.ts';
import {
  nombreDeTipo, pendientesDe, TIPOS_CON_MARCADOR_ESPECIFICO, TIPOS_ELEGIBLES, textoDeMenciones, textoDePendientes,
} from './presentacion.ts';
import { tx } from './textos.ts';

const ROLES_PERSONA: readonly Role[] = ['DEMANDANTE', 'DEMANDADO', 'TESTIGO', 'PACIENTE', 'CLIENTE', 'CONTACTO', 'OTRA_PERSONA'];
const MOTIVOS: readonly RejectReason[] = ['SIN_MOTIVO', 'FALSO_POSITIVO', 'DATO_PUBLICO', 'CITA_JURISPRUDENCIAL', 'NECESARIO_ANALISIS', 'OTRO'];

/** Texto final de una mención con su estado actual (6.4.3): lo que entra en la salida. */
export function textoFinal(d: Detection, e: Entity | undefined): string {
  if (d.status === 'editada' && d.replacement.edited !== undefined) return d.replacement.edited;
  return (d.replacement.generalized?.template ?? d.replacement.proposedTemplate).split('{m}').join(e?.marker ?? '');
}
/** El marcador de la entidad ya consta en la tabla del asunto o es definitivo: no cambia de rol ni de familia (M-605). */
export const marcadorFijado = (e: Entity): boolean => e.markerState === 'heredado' || e.markerState === 'definitivo';

function EditorDeReemplazo({ d, e }: { d: Detection; e: Entity | undefined }) {
  const id = useIdNeutro();
  const [valor, setValor] = useState(() => textoFinal(d, e));
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    marcarEdicion(true);
    campo.current?.focus();
    campo.current?.select();
    return () => { marcarEdicion(false); };
  }, []);
  const cerrar = (): void => { terminarEdicion(); pedirEnfoque('resaltado', d.id); };
  const confirmar = (): void => { if (editar(d.id, valor)) cerrar(); };
  return (
    <div class="campo editor-reemplazo" data-prueba="editor-reemplazo">
      <label for={id}>{tx('M-1343')}</label>
      <input
        id={id}
        name={id}
        type="text"
        ref={(el) => { campo.current = el; atributosDeContenido(el); }}
        value={valor}
        onInput={(ev) => { setValor((ev.currentTarget as HTMLInputElement).value); }}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); confirmar(); }
          else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cerrar(); }
        }}
      />
      <div class="acciones">
        <button type="button" onClick={confirmar}>{tx('M-1344')}</button>
        <button type="button" class="secundario" onClick={cerrar}>{t('M-1161')}</button>
      </div>
    </div>
  );
}

function BloqueEntidad({ state, e }: { state: ReviewState; e: Entity }) {
  const esPersona = e.type === 'PERSONA';
  const esOrg = (ORG_CLASSES as readonly string[]).includes(e.type);
  const roles: readonly Role[] = esPersona ? ROLES_PERSONA : (ORG_CLASSES as readonly Role[]);
  const [rol, setRol] = useState<string>(e.role ?? '');
  const [destino, setDestino] = useState('');
  useEffect(() => { setRol(e.role ?? ''); setDestino(''); }, [e.id, e.role]);
  const fijado = marcadorFijado(e);
  const pend = pendientesDe(state, e);
  const otras = Object.values(state.entities).filter((x) => x.id !== e.id && x.type === e.type);
  const especificable = TIPOS_CON_MARCADOR_ESPECIFICO.has(e.type);
  const tipo = nombreDeTipo(e.type);
  const txtAceptar = t(ROTULOS.aceptar_todas_las_menciones_n, { n: pend });
  const txtRechazar = t(ROTULOS.rechazar_todas_las_menciones);
  const idAyuda = useIdNeutro();
  return (
    <section class="ficha-entidad" aria-label={tx('M-1341')}>
      <h4>{tx('M-1341')}</h4>
      <dl class="datos">
        <dt>{t('M-1143')}</dt><dd>{tipo}</dd>
        <dt>{tx('M-1350')}</dt><dd data-prueba="ficha-marcador">{e.marker ?? t('M-958')}</dd>
        <dt>{tx('M-1352')}</dt><dd>{e.display}</dd>
        <dt>{tx('M-1319')}</dt><dd>{textoDeMenciones(e.mentions.length)}, {textoDePendientes(pend)}</dd>
      </dl>
      <div class="acciones">
        <button type="button" class="secundario" disabled={pend === 0} aria-label={tx('M-1357', { visible: txtAceptar })} onClick={() => { aceptarEntidad(e.id); }}>{txtAceptar}</button>
        <button type="button" class="secundario" disabled={pend === 0} aria-label={tx('M-1357', { visible: txtRechazar })} onClick={() => { rechazarEntidad(e.id); }}>{txtRechazar}</button>
      </div>
      {esPersona || esOrg ? (
        <div class="fila">
          <Seleccion
            etiqueta={esPersona ? t(ROTULOS.cambiar_rol) : t(ROTULOS.cambiar_clase)}
            valor={rol}
            opciones={roles.map((r): readonly [string, string] => [r, etiqueta('rol', r)])}
            onCambio={setRol}
            deshabilitado={fijado}
            describedBy={fijado ? idAyuda : undefined}
          />
          <button type="button" class="secundario" disabled={fijado || rol === (e.role ?? '')} onClick={() => { cambiarRol(e.id, rol as Role); }}>{t('M-977')}</button>
        </div>
      ) : null}
      {fijado ? <p id={idAyuda} class="ayuda">{t('M-605')}</p> : null}
      {otras.length > 0 ? (
        <div class="fila">
          <Seleccion
            etiqueta={t(ROTULOS.unir_con_otra_entidad)}
            valor={destino}
            opciones={[['', ''], ...otras.map((x): readonly [string, string] => [x.id, `${x.marker ?? t('M-958')} · ${x.display}`])]}
            onCambio={setDestino}
          />
          <button type="button" class="secundario" disabled={destino === ''} onClick={() => { if (unir(e.id, destino as Entity['id'])) setDestino(''); }}>{tx('M-1349')}</button>
        </div>
      ) : null}
      {especificable ? (
        <div class="marcador-especifico">
          <button
            type="button"
            class="secundario"
            aria-pressed={e.marcadorEspecifico}
            aria-disabled={fijado}
            onClick={() => { if (!fijado) especificarDocumento(e.id, !e.marcadorEspecifico); else limpiarError(); }}
          >
            {e.marcadorEspecifico ? t(ROTULOS.volver_al_marcador_general) : t(ROTULOS.usar_marcador_especifico_tipo, { tipo: e.type })}
          </button>
          <p class="ayuda">{fijado ? t('M-605') : t('M-176')}</p>
        </div>
      ) : null}
    </section>
  );
}

export function Ficha() {
  const rev = useRevision();
  const { state, doc, seleccion, entidadSeleccion, edicion, error } = rev;
  const [motivo, setMotivo] = useState<RejectReason>('SIN_MOTIVO');
  const [tipoNuevo, setTipoNuevo] = useState('');
  const d = state !== null && seleccion !== null ? state.detections[seleccion] : undefined;
  useEffect(() => { setMotivo('SIN_MOTIVO'); setTipoNuevo(d?.type ?? ''); }, [seleccion]);

  if (state === null || doc === null) return null;
  const entidad = d !== undefined ? state.entities[d.entityId] : entidadSeleccion !== null ? state.entities[entidadSeleccion] : undefined;
  const parte = d !== undefined ? doc.parts.find((p) => p.id === d.partId) : undefined;

  return (
    <section class="ficha" role="region" aria-label={tx('M-1304')} data-prueba="ficha">
      <h3>{tx('M-1340')}</h3>
      {error !== null ? <p class="error-campo" role="alert" data-prueba="error-revision">{mensajeDeCodigo(error)}</p> : null}
      {d === undefined && entidad === undefined ? <p class="ayuda">{tx('M-1354')}</p> : null}
      {d !== undefined ? (
        <>
          <dl class="datos">
            <dt>{t('M-1143')}</dt><dd>{nombreDeTipo(d.type)}</dd>
            <dt>{tx('M-1320')}</dt><dd>{etiqueta('estado', d.status)}</dd>
            <dt>{tx('M-1323')}</dt><dd>{etiqueta('confianza', d.confidence)}</dd>
            <dt>{tx('M-1324')}</dt><dd>{etiqueta('fuente', d.source)}</dd>
            <dt>{tx('M-1322')}</dt><dd>{parte?.label ?? ''}</dd>
            <dt>{tx('M-1329')}</dt><dd data-prueba="ficha-texto">{d.text}</dd>
            <dt>{tx('M-1351')}</dt><dd>{d.status === 'rechazada' ? tx('M-1359') : textoFinal(d, entidad) || tx('M-1355')}</dd>
          </dl>
          {d.validator?.passed === false ? <p class="aviso-validador" data-prueba="validador-fallido">{t('M-71')}</p> : null}
          <div class="acciones">
            <button type="button" class="secundario" aria-label={tx('M-1356', { accion: t(ROTULOS.aceptar) })} disabled={d.status === 'aceptada'} onClick={() => { aceptar(d.id); }}>{t(ROTULOS.aceptar)}</button>
            <button type="button" class="secundario" aria-label={tx('M-1356', { accion: t(ROTULOS.rechazar) })} disabled={d.status === 'rechazada'} onClick={() => { rechazar(d.id, motivo); }}>{t(ROTULOS.rechazar)}</button>
            <button type="button" class="secundario" aria-label={tx('M-1356', { accion: t(ROTULOS.editar) })} onClick={() => { solicitarEdicion(d.id); }}>{t(ROTULOS.editar)}</button>
            <button type="button" class="secundario" aria-label={tx('M-1356', { accion: t(ROTULOS.restablecer) })} disabled={d.status === 'pendiente'} onClick={() => { restablecer(d.id); }}>{t(ROTULOS.restablecer)}</button>
          </div>
          {edicion === d.id ? <EditorDeReemplazo key={d.id} d={d} e={entidad} /> : null}
          <Seleccion
            etiqueta={tx('M-1342')}
            valor={motivo}
            opciones={MOTIVOS.map((m): readonly [string, string] => [m, etiqueta('rechazo', m)])}
            onCambio={(v) => { setMotivo(v as RejectReason); }}
          />
          <div class="fila">
            <Seleccion
              etiqueta={tx('M-1345')}
              valor={tipoNuevo}
              opciones={TIPOS_ELEGIBLES.map((x): readonly [string, string] => [x, nombreDeTipo(x)])}
              onCambio={setTipoNuevo}
            />
            <button type="button" class="secundario" disabled={tipoNuevo === '' || tipoNuevo === d.type} onClick={() => { cambiarTipo(d.id, tipoNuevo as DetectableType); }}>{t(ROTULOS.cambiar_tipo)}</button>
          </div>
          <div class="acciones">
            <button type="button" class="secundario" disabled={entidad === undefined || entidad.mentions.length < 2} onClick={() => { separar(d.id); }}>{t(ROTULOS.separar_de_la_entidad)}</button>
          </div>
        </>
      ) : null}
      {entidad !== undefined ? <BloqueEntidad state={state} e={entidad} /> : null}
      {d !== undefined || entidad !== undefined ? (
        <div class="acciones">
          <button type="button" class="enlace" onClick={() => { seleccionar(null); seleccionarEntidad(null); }}>{tx('M-1305')}</button>
        </div>
      ) : null}
    </section>
  );
}
