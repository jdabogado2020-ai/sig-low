// Pantalla 4 · Procesando (8.2.5): etapas con barra de progreso y «Cancelar análisis». Es corta: cubre reglas, lista del caso y
// sugerencias, y pasa a Revisión en cuanto `detect` responde; el modelo sigue en segundo plano y se ve en la banda de Revisión.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ProgressUnit } from '../core/types.ts';
import { cancelarAnalisis, useAnalisis, type Etapa, type EstadoEtapa } from './analisis.ts';
import { obtenerDocumento } from './documento.ts';
import { ir, obtener } from './estado.ts';
import { etiqueta, ROTULOS, t, X, type MessageId } from './mensajes.ts';
import { E } from './mensajes-entrada.ts';

const ESTADO: Readonly<Record<EstadoEtapa, string>> = { terminada: 'terminada', en_curso: 'en_curso', pendiente: 'pendiente', omitida: 'omitida' };
const UNIDAD: Readonly<Record<ProgressUnit, MessageId>> = {
  partes: E.unidadParte, paginas: E.unidadPagina, ventanas: E.unidadBloque, bytes: E.unidadKb,
};
const INTERVALO_ANUNCIO_MS = 5000;

/** Tiempo estimado redondeado a 10 s (8.2.5): «40 segundos», «3 minutos» o «2 min 30 s». */
export function formatoTiempo(ms: number): string {
  const total = Math.max(10, Math.round(ms / 10_000) * 10);
  if (total < 60) return t(E.segundos, { n: total });
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? t(E.minutos, { n: m }) : t(E.minutosYSegundos, { m, s });
}

function textoDeEstado(e: EstadoEtapa): string {
  return etiqueta('estadoEtapa', ESTADO[e]);
}

function FilaEtapa({ e }: { e: Etapa }) {
  const nombre = etiqueta('etapa', e.etapa);
  const determinada = e.total > 0;
  const valortexto = determinada ? t(E.valorEtapa, { etapa: nombre, unidad: t(UNIDAD[e.unidad]), hecho: e.hecho, total: e.total }) : nombre;
  const terminada = e.estado === 'terminada';
  return (
    <li data-prueba={`etapa-${e.etapa}`} data-estado={e.estado}>
      <span class="etapa-nombre">{nombre}</span>
      {' · '}
      <span class="etapa-estado">{textoDeEstado(e.estado)}</span>
      {e.estado === 'omitida' ? null : determinada || terminada ? (
        <progress max={determinada ? e.total : 1} value={terminada ? (determinada ? e.total : 1) : e.hecho} aria-label={nombre} aria-valuetext={valortexto} />
      ) : (
        <progress aria-label={nombre} aria-valuetext={valortexto} />
      )}
    </li>
  );
}

/** Región viva: anuncia el cambio de etapa, como mucho cada 5 s y sin texto del documento (8.6.3). */
function AnuncioDeProgreso({ texto }: { texto: string }) {
  const [anuncio, setAnuncio] = useState('');
  const ultimo = useRef(0);
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (temporizador.current !== undefined) clearTimeout(temporizador.current);
    const espera = Math.max(0, INTERVALO_ANUNCIO_MS - (Date.now() - ultimo.current));
    temporizador.current = setTimeout(() => { ultimo.current = Date.now(); setAnuncio(texto); }, espera);
    return () => { if (temporizador.current !== undefined) clearTimeout(temporizador.current); };
  }, [texto]);
  return <p class="solo-lectores" role="status" data-prueba="anuncio-progreso">{anuncio}</p>;
}

export function Procesando() {
  const v = useAnalisis();
  // Sin análisis en curso (por ejemplo, tras un bloqueo) no hay nada que mostrar aquí.
  useEffect(() => {
    if (!v.activo && obtener().screen === 'procesando' && obtenerDocumento() === null) ir('entrada');
  }, [v.activo]);
  const actual = v.etapas.find((e) => e.estado === 'en_curso') ?? null;
  const textoAnuncio = actual === null ? '' : `${etiqueta('etapa', actual.etapa)}: ${textoDeEstado(actual.estado)}`;
  return (
    <>
      <h1 tabIndex={-1}>{t(X.procesando)}</h1>
      <h2>{t('M-60')}</h2>
      <ol class="etapas" aria-label={t(E.etapasDelAnalisis)} data-prueba="etapas">
        {v.etapas.map((e) => <FilaEtapa key={e.etapa} e={e} />)}
      </ol>
      {v.modelo !== null ? (
        <p data-prueba="tiempo-modelo">
          {t('M-164', { n: v.modelo.ventanasTotales, tiempo: formatoTiempo(v.modelo.ventanasTotales * v.modelo.calentamientoMs) })}
        </p>
      ) : null}
      {v.estuvoOculta ? <p role="status" data-prueba="segundo-plano">{t('M-62')}</p> : null}
      <AnuncioDeProgreso texto={textoAnuncio} />
      <div class="acciones">
        <button type="button" class="secundario" disabled={v.cancelando} onClick={cancelarAnalisis} data-prueba="cancelar-analisis">
          {v.cancelando ? t(ROTULOS.cancelando) : t(ROTULOS.cancelar_analisis)}
        </button>
      </div>
    </>
  );
}
