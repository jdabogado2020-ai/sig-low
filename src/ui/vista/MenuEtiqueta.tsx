// F3 (D-24) · Menú breve de una etiqueta de la vista previa, en lenguaje claro. Cada opción es una acción del reductor por las de la
// revisión dato por dato (review/base/acciones.ts y `despachar`): mostrar el dato original aquí (rechazar la mención), en todo el
// documento (rechazar la entidad), «Es otra persona» (separar), «Es la misma que…» (unir), «Cambiar a…» (tipo) y editar el texto.
// Sobre un dato que el abogado dejó a la vista, «Volver a ocultar»; sobre un dato indirecto para revisar, ocultarlo con el texto
// genérico o dejarlo como está. Las opciones solo nombran etiquetas y tipos: ningún valor del documento.
import { useEffect, useRef, useState } from 'preact/hooks';
import { ORG_CLASSES, type DetectableType, type DetectionId, type EntityId, type FlagId, type SpanEditId } from '../../core/types.ts';
import { CampoTexto, Seleccion } from '../campos.tsx';
import { t, ROTULOS } from '../mensajes.ts';
import { aceptar, cambiarTipo, editar, rechazar, rechazarEntidad, separar, unir } from '../review/base/acciones.ts';
import { despachar, useRevisionUi } from '../review/base/almacen.ts';
import { nombreDeTipo, TIPOS_ELEGIBLES } from '../review/base/presentacion.ts';
import { etiqueta } from '../mensajes.ts';
import { tf } from '../flujo/textos.ts';

export type Objetivo = { tipo: 'det'; id: DetectionId } | { tipo: 'flag'; id: FlagId } | { tipo: 'edicion'; id: SpanEditId };

const TEMPLATE_M = '{m}';
const ORGANIZACIONES: ReadonlySet<string> = new Set(ORG_CLASSES);
const esPersonaUOrg = (tipo: DetectableType): boolean => tipo === 'PERSONA' || ORGANIZACIONES.has(tipo);

type Paso = 'menu' | 'unir' | 'tipo' | 'editar';

export function MenuEtiqueta({ objetivo, onCerrar }: { objetivo: Objetivo; onCerrar: () => void }) {
  const { state } = useRevisionUi();
  const [paso, setPaso] = useState<Paso>('menu');
  const [unirCon, setUnirCon] = useState('');
  const [tipo, setTipo] = useState('PERSONA');
  const [texto, setTexto] = useState('');
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => { raiz.current?.querySelector<HTMLElement>('button, select, input')?.focus(); }, [paso]);
  if (state === null) return null;

  const hecho = (ok: boolean): void => { if (ok) onCerrar(); };
  let titulo = '';
  let cuerpo = null;

  if (objetivo.tipo === 'det') {
    const d = state.detections[objetivo.id];
    if (d === undefined) return null;
    const e = state.entities[d.entityId];
    const marcador = e?.marker ?? t(ROTULOS.sin_marcador);
    titulo = tf('M-2150', { etiqueta: d.status === 'rechazada' ? nombreDeTipo(d.type) : marcador });
    const cita = Object.values(state.flags).find((f) => f.detectionId === d.id && !f.acknowledged && f.type === 'CITA_JURISPRUDENCIAL');
    if (d.status === 'rechazada') {
      cuerpo = <button type="button" onClick={() => { hecho(aceptar(d.id)); }}>{tf('M-2157')}</button>;
    } else if (paso === 'unir') {
      const compatibles = Object.values(state.entities).filter((o) => o.id !== d.entityId && o.marker !== undefined
        && (o.type === d.type || (esPersonaUOrg(o.type) && esPersonaUOrg(d.type) && (o.type === 'PERSONA') === (d.type === 'PERSONA'))));
      cuerpo = compatibles.length === 0 ? <p class="ayuda">{tf('M-2174')}</p> : (
        <>
          <Seleccion
            etiqueta={tf('M-2158')}
            valor={unirCon}
            opciones={[['', '—'], ...compatibles.map((o): readonly [string, string] => [o.id, `${o.marker ?? ''} · ${nombreDeTipo(o.type)}`])]}
            onCambio={setUnirCon}
          />
          <button type="button" disabled={unirCon === '' || e === undefined} onClick={() => { if (e !== undefined) hecho(unir(e.id, unirCon as EntityId)); }}>{tf('M-2161')}</button>
        </>
      );
    } else if (paso === 'tipo') {
      cuerpo = (
        <>
          <Seleccion etiqueta={tf('M-2159')} valor={tipo} opciones={TIPOS_ELEGIBLES.map((x): readonly [string, string] => [x, nombreDeTipo(x)])} onCambio={setTipo} />
          <button type="button" onClick={() => { hecho(cambiarTipo(d.id, tipo as DetectableType)); }}>{tf('M-2161')}</button>
        </>
      );
    } else if (paso === 'editar') {
      cuerpo = (
        <>
          <CampoTexto etiqueta={tf('M-2160')} valor={texto} onInput={setTexto} />
          <button type="button" disabled={texto.trim() === ''} onClick={() => { hecho(editar(d.id, texto)); }}>{tf('M-2161')}</button>
        </>
      );
    } else {
      const varias = (e?.mentions.length ?? 0) > 1;
      cuerpo = (
        <>
          {cita !== undefined ? (
            <>
              <button type="button" onClick={() => { hecho(despachar({ kind: 'resolver_bandera', flagId: cita.id, resolution: 'mantener' }).ok); }}>{tf('M-2162')}</button>
              <button type="button" onClick={() => { hecho(despachar({ kind: 'resolver_bandera', flagId: cita.id, resolution: 'reemplazar' }).ok); }}>{tf('M-2163')}</button>
            </>
          ) : null}
          <button type="button" onClick={() => { hecho(rechazar(d.id)); }}>{tf('M-2151')}</button>
          {varias && e !== undefined ? <button type="button" onClick={() => { hecho(rechazarEntidad(e.id)); }}>{tf('M-2152')}</button> : null}
          {esPersonaUOrg(d.type) && varias ? <button type="button" onClick={() => { hecho(separar(d.id)); }}>{tf('M-2153')}</button> : null}
          {esPersonaUOrg(d.type) ? <button type="button" onClick={() => { setPaso('unir'); }}>{tf('M-2154')}</button> : null}
          <button type="button" onClick={() => { setTipo(d.type); setPaso('tipo'); }}>{tf('M-2155')}</button>
          <button type="button" onClick={() => { setTexto(d.replacement.edited ?? marcador); setPaso('editar'); }}>{tf('M-2156')}</button>
        </>
      );
    }
  } else if (objetivo.tipo === 'flag') {
    const f = state.flags[objetivo.id];
    if (f === undefined) return null;
    titulo = tf('M-2150', { etiqueta: etiqueta('bandera', f.reason) });
    cuerpo = (
      <>
        {f.options.filter((o) => !o.template.includes(TEMPLATE_M)).map((o) => (
          <button key={o.id} type="button" onClick={() => { hecho(despachar({ kind: 'resolver_bandera', flagId: f.id, resolution: 'reemplazar', optionId: o.id }).ok); }}>
            {tf('M-2164', { texto: o.template })}
          </button>
        ))}
        <button type="button" onClick={() => { hecho(despachar({ kind: 'resolver_bandera', flagId: f.id, resolution: 'mantener' }).ok); }}>{tf('M-2165')}</button>
      </>
    );
  } else {
    const x = state.spanEdits[objetivo.id];
    if (x === undefined) return null;
    titulo = tf('M-2172');
    const deshacer = (): boolean => (x.origin.kind === 'sugerencia'
      ? despachar({ kind: 'descartar_sugerencia', suggestionId: x.origin.suggestionId }).ok
      : despachar({ kind: 'resolver_bandera', flagId: x.origin.flagId, resolution: 'mantener' }).ok);
    cuerpo = <button type="button" onClick={() => { hecho(deshacer()); }}>{tf('M-2151')}</button>;
  }

  return (
    <div
      ref={raiz}
      class="menu-etiqueta"
      role="dialog"
      aria-label={titulo}
      data-prueba="menu-etiqueta"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCerrar(); } }}
    >
      <p class="menu-titulo">{titulo}</p>
      <div class="menu-opciones">{cuerpo}</div>
      <button type="button" class="secundario" onClick={onCerrar}>{t(ROTULOS.cancelar)}</button>
    </div>
  );
}
