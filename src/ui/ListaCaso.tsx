// Pantalla 2 · Lista del caso (8.2.3). Una persona lleva rol procesal; una organización lleva clase, nunca rol (6.2.2).
import { useState } from 'preact/hooks';
import { newCaseEntity, parsePastedList, refreshVariants, sharedVariantWarnings, type PasteResult } from '../core/caselist.ts';
import type { CaseEntity, CaseEntityId, CaseVariant, IdSource, OrgClass, PersonRole, Role } from '../core/types.ts';
import { randomIds } from '../io/txt-read.ts';
import { AreaTexto, CampoTexto, Casilla, Grupo, Seleccion } from './campos.tsx';
import { ir, useShell } from './estado.ts';
import { etiqueta, mensajeDeCodigo, ROTULOS, t, X } from './mensajes.ts';
import { agregarAvisoAsunto, fijarListaDelCaso, obtenerTabla, useListaDelCaso } from './sesion.ts';
import { codigoDeError, puertos } from './servicios.ts';

const ROLES_PERSONA: readonly PersonRole[] = ['DEMANDANTE', 'DEMANDADO', 'TESTIGO', 'PACIENTE', 'CLIENTE', 'CONTACTO', 'OTRA_PERSONA'];
const CLASES_ORG: readonly OrgClass[] = ['EMPRESA', 'EPS', 'IPS', 'ENTIDAD', 'PROVEEDOR'];
type Tipo = 'persona' | 'organizacion';

const opcionesDe = (tipo: Tipo): ReadonlyArray<readonly [string, string]> =>
  (tipo === 'persona' ? ROLES_PERSONA : CLASES_ORG).map((r): readonly [string, string] => [r, etiqueta('rol', r)]);
const porDefecto = (tipo: Tipo): Role => (tipo === 'persona' ? 'DEMANDANTE' : 'EMPRESA');

/** El rol o la clase no cambia si el dato ya tiene marcador en la tabla del asunto (INV-G07, M-605). */
function tieneMarcador(id: CaseEntityId): boolean {
  const tabla = obtenerTabla();
  return tabla !== null && Object.values(tabla.entries).some((e) => e.caseEntityId === id);
}

function conRol(e: CaseEntity, rol: string): CaseEntity {
  return { ...e, role: rol } as CaseEntity;
}

function TablaEntidades({ lista, editando, onEditar, onQuitar, onRol, seleccion, onSeleccionar }: {
  lista: readonly CaseEntity[];
  editando: CaseEntityId | null;
  onEditar: (e: CaseEntity) => void;
  onQuitar: (e: CaseEntity) => void;
  onRol: (e: CaseEntity, rol: string) => void;
  seleccion: CaseEntityId | null;
  onSeleccionar: (e: CaseEntity) => void;
}) {
  if (lista.length === 0) return <p data-prueba="lista-vacia">{t('M-40')}</p>;
  return (
    <div class="tabla-envoltura">
      <table class="tabla" data-prueba="tabla-entidades">
        <caption>{t(X.entidadesDelCaso)}</caption>
        <thead>
          <tr>
            <th scope="col">{t(X.nombre)}</th>
            <th scope="col">{t(X.tipo)}</th>
            <th scope="col">{t(X.rolOClase)}</th>
            <th scope="col">{t(X.variantesActivas)}</th>
            <th scope="col">{t(X.acciones)}</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((e) => {
            const fijado = tieneMarcador(e.id);
            const activas = e.variants.filter((v) => v.enabled).length;
            return (
              <tr key={e.id} aria-current={seleccion === e.id ? 'true' : undefined} class={seleccion === e.id ? 'seleccionada' : undefined}>
                <th scope="row" translate={false}>{e.name}</th>
                <td>{e.kind === 'persona' ? t(ROTULOS.persona) : t(ROTULOS.organizacion)}</td>
                <td>
                  <Seleccion
                    etiqueta={`${t(e.kind === 'persona' ? X.rol : X.clase)}: ${e.name}`}
                    valor={e.role}
                    opciones={opcionesDe(e.kind)}
                    deshabilitado={fijado}
                    describedBy={fijado ? `fijo-${e.id}` : undefined}
                    onCambio={(v) => { onRol(e, v); }}
                  />
                  {fijado ? <p id={`fijo-${e.id}`} class="error-campo" data-prueba="rol-fijado">{t('M-605')}</p> : null}
                </td>
                <td>{activas} / {e.variants.length}</td>
                <td>
                  <div class="acciones">
                    <button type="button" class="secundario" aria-pressed={seleccion === e.id} aria-label={`${t(ROTULOS.vista_previa)}: ${e.name}`} onClick={() => { onSeleccionar(e); }}>
                      {t(ROTULOS.vista_previa)}
                    </button>
                    <button type="button" class="secundario" aria-label={t(X.editarA, { nombre: e.name })} disabled={editando === e.id} onClick={() => { onEditar(e); }}>
                      {t(ROTULOS.editar)}
                    </button>
                    <button type="button" class="secundario" aria-label={t(X.quitarA, { nombre: e.name })} onClick={() => { onQuitar(e); }}>
                      {t(ROTULOS.quitar)}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PanelVariantes({ lista, entidad }: { lista: readonly CaseEntity[]; entidad: CaseEntity }) {
  const [texto, setTexto] = useState('');
  const avisos = sharedVariantWarnings(lista).filter((a) => a.entityId === entidad.id);
  const cambiar = (nuevas: CaseVariant[]): void => {
    fijarListaDelCaso(refreshVariants(lista.map((e) => (e.id === entidad.id ? ({ ...e, variants: nuevas } as CaseEntity) : e))));
  };
  const alternar = (i: number, v: boolean): void => {
    cambiar(entidad.variants.map((x, j) => (j === i ? { ...x, enabled: v } : x)));
  };
  const agregar = (): void => {
    const limpio = texto.normalize('NFC').replace(/\s+/gu, ' ').trim();
    if (limpio === '' || entidad.variants.some((v) => v.text === limpio)) return;
    cambiar([...entidad.variants, { text: limpio, class: 'exacta', confidence: 'alta', enabled: true, origin: 'manual' }]);
    setTexto('');
  };
  return (
    <section class="variantes" aria-labelledby="pv-titulo" data-prueba="panel-variantes">
      <h3 id="pv-titulo">{t(X.variantesDeLaEntidad)}: <span translate={false}>{entidad.name}</span></h3>
      {entidad.variants.length === 0 ? <p>{t(X.sinVariantes)}</p> : (
        <ul class="lista-variantes">
          {entidad.variants.map((v, i) => {
            const compartida = avisos.some((a) => a.text === v.text);
            return (
              <li key={`${v.class}-${v.text}`}>
                <span class="var-texto" translate={false}>{v.text}</span>
                <span class="var-meta">
                  {v.origin === 'manual' ? t(X.manual) : t(X.claseDeVariante[v.class])}
                  {' · '}
                  {etiqueta('confianza', v.confidence)}
                </span>
                <Casilla
                  etiqueta={`${t(ROTULOS.buscar_esta_variante)} (${v.text})`}
                  marcada={v.enabled}
                  onCambio={(c) => { alternar(i, c); }}
                />
                {compartida ? <p class="ayuda" data-prueba="variante-compartida">{t('M-44')}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
      <div class="fila">
        <CampoTexto etiqueta={t(X.textoDeLaVariante)} valor={texto} onInput={setTexto} onEnter={agregar} />
        <button type="button" class="secundario" disabled={texto.trim() === ''} onClick={agregar}>{t(ROTULOS.agregar_variante)}</button>
      </div>
    </section>
  );
}

function Formulario({ lista, editando, onTerminar }: { lista: readonly CaseEntity[]; editando: CaseEntity | null; onTerminar: () => void }) {
  const [nombre, setNombre] = useState(editando?.name ?? '');
  const [tipo, setTipo] = useState<Tipo>(editando?.kind ?? 'persona');
  const [rol, setRol] = useState<string>(editando?.role ?? porDefecto('persona'));
  const [error, setError] = useState<string | undefined>(undefined);
  const fijado = editando !== null && tieneMarcador(editando.id);

  const cambiarTipo = (n: Tipo): void => {
    setTipo(n);
    setRol(porDefecto(n));
  };
  const guardar = (): void => {
    const limpio = nombre.trim();
    if (limpio === '') { setError(t(X.faltaNombre)); return; }
    const ids: IdSource = editando ? { next: () => editando.id } : randomIds();
    const nueva = newCaseEntity(limpio, tipo, rol as Role, ids);
    if (nueva === null) return;
    if (editando) {
      const manuales = editando.variants.filter((v) => v.origin === 'manual');
      fijarListaDelCaso(refreshVariants(lista.map((e) => (e.id === editando.id ? ({ ...nueva, variants: manuales } as CaseEntity) : e))));
    } else {
      fijarListaDelCaso(refreshVariants([...lista, nueva]));
    }
    setNombre('');
    setError(undefined);
    onTerminar();
  };
  return (
    <section class="agregar" aria-labelledby="ag-titulo">
      <h2 id="ag-titulo">{t(X.agregarALista)}</h2>
      <form autocomplete="off" noValidate onSubmit={(e) => { e.preventDefault(); }}>
        <CampoTexto etiqueta={t(X.nombre)} valor={nombre} onInput={(v) => { setNombre(v); setError(undefined); }} error={error} onEnter={guardar} />
        <Grupo leyenda={t(X.tipo)}>
          <div class="radio">
            <input id="tipo-persona" type="radio" name="c-tipo" checked={tipo === 'persona'} disabled={fijado} onChange={() => { cambiarTipo('persona'); }} />
            <label for="tipo-persona">{t(ROTULOS.persona)}</label>
          </div>
          <div class="radio">
            <input id="tipo-org" type="radio" name="c-tipo" checked={tipo === 'organizacion'} disabled={fijado} onChange={() => { cambiarTipo('organizacion'); }} />
            <label for="tipo-org">{t(ROTULOS.organizacion)}</label>
          </div>
        </Grupo>
        <Seleccion
          etiqueta={t(tipo === 'persona' ? X.rol : X.clase)}
          valor={rol}
          opciones={opcionesDe(tipo)}
          deshabilitado={fijado}
          describedBy={fijado ? 'fijo-formulario' : undefined}
          onCambio={setRol}
        />
        {fijado ? <p id="fijo-formulario" class="error-campo">{t('M-605')}</p> : null}
        <div class="acciones">
          <button type="button" onClick={guardar}>{editando ? t(X.guardarCambios) : t(ROTULOS.agregar)}</button>
          {editando ? <button type="button" class="secundario" onClick={onTerminar}>{t(X.cancelarEdicion)}</button> : null}
        </div>
      </form>
    </section>
  );
}

function PegarLista({ lista }: { lista: readonly CaseEntity[] }) {
  const [texto, setTexto] = useState('');
  const [vista, setVista] = useState<PasteResult | null>(null);
  const [agregadas, setAgregadas] = useState<number | null>(null);
  const previsualizar = (): void => {
    setAgregadas(null);
    setVista(parsePastedList(texto, randomIds(), lista));
  };
  const agregar = (): void => {
    if (!vista || vista.entities.length === 0) return;
    fijarListaDelCaso(refreshVariants([...lista, ...vista.entities]));
    setAgregadas(vista.entities.length);
    setVista(null);
    setTexto('');
  };
  return (
    <section class="pegar" aria-labelledby="pl-titulo">
      <h2 id="pl-titulo">{t(ROTULOS.pegar_lista)}</h2>
      <AreaTexto etiqueta={t(X.textoDeLaLista)} valor={texto} onInput={(v) => { setTexto(v); setVista(null); }} ayuda={t('M-41')} filas={5} />
      <div class="acciones">
        <button type="button" class="secundario" disabled={texto.trim() === ''} onClick={previsualizar}>{t(ROTULOS.vista_previa)}</button>
      </div>
      {vista ? (
        <div class="vista-previa" data-prueba="vista-previa-lista">
          {vista.errors.length > 0 ? (
            <div role="alert">
              <h3>{t(X.lineasConError)}</h3>
              <ul>
                {vista.errors.map((e) => <li key={`${e.line}-${e.code}`}>{t(e.code, { n: e.line })}</li>)}
              </ul>
            </div>
          ) : null}
          {vista.entities.length > 0 ? (
            <div>
              <h3>{t(X.lineasValidas)}</h3>
              <ul>
                {vista.entities.map((e) => (
                  <li key={e.id}>
                    <span translate={false}>{e.name}</span>
                    {' · '}
                    {e.kind === 'persona' ? t(ROTULOS.persona) : t(ROTULOS.organizacion)}
                    {' · '}
                    {etiqueta('rol', e.role)}
                  </li>
                ))}
              </ul>
              {vista.inferred.length > 0 ? (
                <ul class="ayuda">
                  {vista.inferred.map((i) => <li key={i.entityId}>{t('M-45', { n: i.line, clase: etiqueta('rol', i.class) })}</li>)}
                </ul>
              ) : null}
              <div class="acciones">
                <button type="button" onClick={agregar}>{t(ROTULOS.agregar_las_lineas_validas)}</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {agregadas !== null ? <p role="status" data-prueba="lineas-agregadas">{t(X.seAgregaron, { n: agregadas })}</p> : null}
    </section>
  );
}

export function ListaCaso() {
  const lista = useListaDelCaso();
  const { asunto } = useShell();
  const [editando, setEditando] = useState<CaseEntity | null>(null);
  const [seleccion, setSeleccion] = useState<CaseEntityId | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [ocupado, setOcupado] = useState(false);
  const elegida = lista.find((e) => e.id === seleccion) ?? null;

  const quitar = (e: CaseEntity): void => {
    if (editando?.id === e.id) setEditando(null);
    if (seleccion === e.id) setSeleccion(null);
    fijarListaDelCaso(refreshVariants(lista.filter((x) => x.id !== e.id)));
  };
  const continuar = async (): Promise<void> => {
    setOcupado(true);
    setError(undefined);
    // Con «Guardar», la lista del caso viaja cifrada con la tabla (S-6.19). Un fallo no detiene el trabajo: queda el aviso.
    if (asunto?.mode === 'guardar' && puertos.boveda.disponible()) {
      try {
        const tabla = obtenerTabla();
        if (tabla) await puertos.boveda.guardar(asunto.asuntoId, { caseList: lista, table: tabla });
      } catch (e) {
        const codigo = codigoDeError(e);
        if (codigo === 'CUOTA_EXCEDIDA') agregarAvisoAsunto({ id: 'M-91' });
        else setError(mensajeDeCodigo(codigo, 'tabla'));
      }
    }
    setOcupado(false);
    ir('entrada');
  };

  return (
    <>
      <h1 tabIndex={-1}>{t(X.lista)}</h1>
      <TablaEntidades
        lista={lista}
        editando={editando?.id ?? null}
        seleccion={seleccion}
        onSeleccionar={(e) => { setSeleccion(seleccion === e.id ? null : e.id); }}
        onEditar={(e) => { setEditando(e); }}
        onQuitar={quitar}
        onRol={(e, rol) => { fijarListaDelCaso(refreshVariants(lista.map((x) => (x.id === e.id ? conRol(x, rol) : x)))); }}
      />
      {elegida ? <PanelVariantes lista={lista} entidad={elegida} /> : null}
      <div class="dos-columnas">
        <Formulario key={editando?.id ?? 'nuevo'} lista={lista} editando={editando} onTerminar={() => { setEditando(null); }} />
        <PegarLista lista={lista} />
      </div>
      {error ? <p role="alert" class="error-campo" data-prueba="error-guardar">{error}</p> : null}
      <div class="acciones">
        <button type="button" disabled={ocupado} onClick={() => { void continuar(); }}>{t(ROTULOS.continuar)}</button>
      </div>
    </>
  );
}
