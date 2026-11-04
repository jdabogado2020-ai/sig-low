// F8 (v1.1.1) · El detector de nombres adicional (el modelo de apoyo) a la vista en el momento de anonimizar.
// - En Cargar, junto a la zona de carga: tarjeta con su estado, para qué sirve, su tamaño y la casilla para usarlo. F10 (v1.1.3):
//   sin botón de descarga aparte (la empieza «Anonimizar»; analisis.ts), salvo «Reintentar» tras un fallo.
// - En la vista previa, si se analizó sin él: un aviso breve que no bloquea, con la descarga y, al terminar, «Volver a analizar
//   con el detector».
// La descarga es la de F0 (un solo aviso por fallo, «Reintentar», reanudación y respaldo por memoria o cuota) y siempre la empieza
// el clic del abogado: nada aquí la lanza solo.
import { useState } from 'preact/hooks';
import { ahorroDeDatos, iniciarAnalisis, sinConexion } from '../analisis.ts';
import { actualizarBorrador, obtenerDocumento } from '../documento.ts';
import { CasillaModelo } from '../Entrada.tsx';
import { actualizar, useShell, type ShellState } from '../estado.ts';
import { alterno, mensajeDeCodigo, ROTULOS, t } from '../mensajes.ts';
import { persistenciaDelModelo } from '../modelo-puerto.ts';
import { codigoDeError, puertos } from '../servicios.ts';
import { tf } from './textos.ts';

function memoriaDelEquipo(): number | null {
  const m = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof m === 'number' ? m : null;
}

/** Estado de la descarga compartido por la tarjeta y el aviso de la vista previa. */
function useDescargaDetector() {
  const { model } = useShell();
  const reducido = (memoriaDelEquipo() ?? 8) < 8;
  const mb = puertos.modelo.estado().mb ?? (model.variant === 'respaldo' || reducido ? 303 : 626);
  const descargable = model.state === 'no_descargado' || model.state === 'fallo';
  const [error, setError] = useState<string | undefined>(undefined);
  const lanzar = async (): Promise<void> => {
    setError(undefined);
    try { await puertos.modelo.descargar(); } catch (e) { setError(mensajeDeCodigo(codigoDeError(e), 'modelo')); }
  };
  // F0: tras un fallo, UN solo mensaje con el motivo (red: M-2102; integridad: M-31; el motor no pudo usarlo: M-30) y «Reintentar».
  const fallo = model.state === 'fallo'
    ? t(model.motivo === 'red' ? 'M-2102' : model.motivo === 'integridad' ? 'M-31' : 'M-30')
    : null;
  return { model, reducido, mb, descargable, error: fallo === null ? error : undefined, fallo, lanzar };
}

/** Avance, verificación, falta de espacio o de memoria y fallo: las líneas de estado de la descarga. */
function EstadoDescarga({ model, mb, fallo, error }: { model: ShellState['model']; mb: number; fallo: string | null; error: string | undefined }) {
  return (
    <>
      {model.state === 'descargando' ? (
        <p role="status" data-prueba="avance-modelo">{t('M-27', { hecho: Math.round((model.doneBytes ?? 0) / 1_000_000), mb })}</p>
      ) : null}
      {model.state === 'descargando' ? <p class="ayuda">{t('M-160', { mb })}</p> : null}
      {model.state === 'verificando' ? <p role="status">{t('M-28')}</p> : null}
      {fallo !== null ? <p role="alert" data-prueba="fallo-modelo" data-motivo={model.motivo ?? 'carga'}>{fallo}</p> : null}
      {model.state === 'sin_espacio' ? <p role="alert">{t('M-32')}</p> : null}
      {model.state === 'sin_memoria' ? <p role="alert">{t('M-169')}</p> : null}
      {error !== undefined ? <p role="alert" class="error-campo">{error}</p> : null}
    </>
  );
}

function BotonesDescarga({ d }: { d: ReturnType<typeof useDescargaDetector> }) {
  return (
    <>
      {d.descargable ? (
        <button type="button" data-prueba="descargar-detector" disabled={!puertos.modelo.disponible()} onClick={() => { void d.lanzar(); }}>
          {d.model.state === 'fallo' ? t('M-2101') : tf('M-2313', { mb: d.mb })}
        </button>
      ) : null}
      {d.model.state === 'descargando' ? (
        <button type="button" class="secundario" onClick={() => { puertos.modelo.cancelar(); }}>{t(ROTULOS.cancelar_descarga)}</button>
      ) : null}
    </>
  );
}

/** Cargar · tarjeta del detector de nombres, a la vista junto a la zona de carga. */
export function TarjetaDetector() {
  const d = useDescargaDetector();
  const { model, mb } = d;
  // Resultado de `navigator.storage.persist()` tras la descarga (PF-2, 3.3: «resultado visible»); null si no se pidió o no existe.
  const persistente = persistenciaDelModelo();
  const [quitar, setQuitar] = useState(false);
  return (
    <section class="tarjeta tarjeta-detector" aria-labelledby="tm-titulo" data-prueba="tarjeta-modelo" data-estado={model.state}>
      <h2 id="tm-titulo">{tf('M-2310')}</h2>
      <p>{tf('M-2311')}</p>
      <p class="ayuda">{tf('M-2312', { mb })}</p>
      {/* F10: al recargar, hasta saber si ya está guardado, no se dice «No está descargado». */}
      {puertos.modelo.comprobando?.() === true
        ? <p role="status" data-prueba="estado-detector">{tf('M-2344')}</p>
        : model.state === 'no_descargado' ? <p data-prueba="estado-detector">{tf('M-2319')}</p> : null}
      {d.descargable && d.reducido ? <p>{t('M-168')}</p> : null}
      {model.state === 'listo' ? <p role="status" data-prueba="estado-detector">{t('M-29')}</p> : null}
      {model.state === 'listo' && model.variant === 'respaldo' ? <p>{t('M-170')}</p> : null}
      {model.state === 'listo' && persistente !== null ? (
        <p data-prueba="persistencia-modelo" data-persistente={persistente ? 'si' : 'no'}>{persistente ? t('M-107') : alterno('M-107', 0)}</p>
      ) : null}
      <EstadoDescarga model={model} mb={mb} fallo={d.fallo} error={d.error} />
      <CasillaModelo />
      <div class="acciones">
        {/* F10 (v1.1.3): la tarjeta solo muestra el estado; la descarga la empieza «Anonimizar». Tras un fallo, «Reintentar» (F0). */}
        {model.state === 'fallo' ? (
          <button type="button" data-prueba="reintentar-detector" disabled={!puertos.modelo.disponible()} onClick={() => { void d.lanzar(); }}>{t('M-2101')}</button>
        ) : null}
        {model.state === 'listo' ? (
          <button type="button" class="secundario" onClick={() => { setQuitar(true); }}>{t(ROTULOS.quitar_el_modelo_de_este_equipo)}</button>
        ) : null}
        <button type="button" class="enlace" onClick={() => { actualizar({ dialog: 'creditos' }); }}>{t(ROTULOS.ver_creditos_y_licencias)}</button>
      </div>
      <p class="ayuda">{t('M-33')}</p>
      {quitar ? (
        <div class="confirmacion" role="alertdialog" aria-label={t(ROTULOS.quitar_el_modelo_de_este_equipo)}>
          <p>{t('M-34')}</p>
          <div class="acciones">
            <button
              type="button"
              onClick={() => {
                setQuitar(false);
                void puertos.modelo.quitar().then(() => { actualizar({ model: { state: 'no_descargado' } }); });
              }}
            >
              {t(ROTULOS.quitar_el_modelo_de_este_equipo)}
            </button>
            <button type="button" class="secundario" onClick={() => { setQuitar(false); }}>{t(ROTULOS.cancelar)}</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Vuelve a analizar el mismo documento, esta vez con el detector (la revisión en curso se reemplaza). */
function volverAAnalizar(): void {
  const doc = obtenerDocumento();
  if (doc === null) return;
  actualizarBorrador({ usarModelo: true });
  iniciarAnalisis({ doc, usarModelo: true });
}

/** Vista previa · aviso breve, sin bloquear, cuando el análisis corrió sin el detector de nombres. */
export function AvisoSinDetector() {
  const d = useDescargaDetector();
  const listo = d.model.state === 'listo';
  return (
    <section class="aviso-detector" aria-labelledby="sd-titulo" data-prueba="aviso-sin-detector">
      <p id="sd-titulo"><strong>{tf('M-2320')}</strong></p>
      {/* F10: con ahorro de datos la descarga no empieza sola: aquí se pregunta. */}
      {d.descargable && ahorroDeDatos() ? <p data-prueba="ahorro-de-datos">{tf('M-2339')}</p> : null}
      {d.descargable && !ahorroDeDatos() && sinConexion() ? <p data-prueba="sin-conexion-detector">{tf('M-2343')}</p> : null}
      {listo ? <p role="status">{tf('M-2323')}</p> : null}
      <EstadoDescarga model={d.model} mb={d.mb} fallo={d.fallo} error={d.error} />
      <div class="acciones">
        <BotonesDescarga d={d} />
        {listo ? <button type="button" data-prueba="volver-a-analizar" onClick={volverAAnalizar}>{tf('M-2321')}</button> : null}
      </div>
      {listo ? <p class="ayuda">{tf('M-2322')}</p> : null}
    </section>
  );
}
