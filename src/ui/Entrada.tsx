// Carga del documento (8.2.4; F2: va dentro de Inicio = «Cargar documento», D-23): cargar un .docx, PDF o .txt o pegar texto; partes con casillas; aviso de metadatos solo por
// categoría (INV-D04); avisos de lectura. El nombre del archivo nunca se muestra ni se guarda (V-37): solo se mira su
// extensión y su tamaño, y el `input` se vacía tras leer (F-08).
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { DocumentModel, MetadataCategory, ParseWarning, ParseWarningCode } from '../core/types.ts';
import { renovarActividad } from './bloqueo.ts';
import { AreaTexto, Casilla, Grupo, useIdNeutro } from './campos.tsx';
import { actualizarBorrador, useBorrador, type PestanaEntrada } from './documento.ts';
import { useShell } from './estado.ts';
import { asegurarCaso } from './flujo/flujo.ts';
import { tf } from './flujo/textos.ts';
import { ATRIBUTO_ZONA_SOLTAR } from './globales.ts';
import { documentoDeTextoPegado, leerContenido, LecturaCancelada, partesAnalizables } from './lectura.ts';
import { mensajeDeCodigo, ROTULOS, t, X, type MessageId } from './mensajes.ts';
import { E } from './mensajes-entrada.ts';
import { ahorroDeDatos, iniciarAnalisis } from './analisis.ts';
import { obtenerTabla } from './sesion.ts';
import { codigoDeError, puertos } from './servicios.ts';

const ETIQUETA_METADATO: Readonly<Record<MetadataCategory, MessageId>> = {
  propiedades_documento: 'M-401', propiedades_aplicacion: 'M-402', propiedades_personalizadas: 'M-403', xml_personalizado: 'M-404',
  personas: 'M-405', autores_revisiones: 'M-406', texto_eliminado: 'M-407', codigos_campo: 'M-408', vinculos_externos: 'M-409',
  configuracion: 'M-410', permisos_edicion: 'M-411', texto_alternativo: 'M-412', propiedades_controles: 'M-413', glosario: 'M-414',
  imagenes_y_miniatura: 'M-415', objetos_y_macros: 'M-416', pdf_propiedades: 'M-417', pdf_xmp: 'M-418', pdf_autores_anotaciones: 'M-419',
};
const MENSAJE_ADVERTENCIA: Readonly<Record<ParseWarningCode, MessageId>> = {
  CODIFICACION_ALTERNATIVA: 'M-301', UTF16_SIN_BOM: 'M-302', TEXTO_ELIMINADO_EXCLUIDO: 'M-303', TEXTO_OCULTO_INCLUIDO: 'M-304',
  CONTENIDO_IMPORTADO_NO_LEIDO: 'M-305', SMARTART_O_GRAFICO_NO_LEIDO: 'M-306', MARCA_DE_AGUA: 'M-307',
  NUMERACION_NO_RECONSTRUIDA: 'M-308', OOXML_STRICT: 'M-309', PAGINA_SIN_TEXTO: 'M-310', TEXTO_ILEGIBLE: 'M-311',
  ORDEN_LECTURA_PDF: 'M-312', CARACTERES_CONTROL: 'M-313', CONTENIDO_PDF_NO_LEIDO: 'M-1325',
};

/** Tamaño legible de un número de bytes ([P]). */
export function formatoTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1_048_576) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1).replace('.', ',')} MB`;
}
const NOMBRE_FORMATO = { txt: '.txt', docx: '.docx', pdf: 'PDF' } as const;

/** «Documento N» (N = documentos ya procesados del asunto + 1); nunca el nombre del archivo (6.3.2). */
function etiquetaDeDocumento(): string {
  return `Documento ${(obtenerTabla()?.documents.length ?? 0) + 1}`;
}

/** Una línea por código de advertencia: suma los conteos y reúne las páginas (8.5.3). */
export function lineasDeAdvertencias(w: readonly ParseWarning[]): Array<{ id: MessageId; params: Record<string, number | string> }> {
  const porCodigo = new Map<ParseWarningCode, { n: number; paginas: Set<number> }>();
  for (const x of w) {
    const e = porCodigo.get(x.code) ?? { n: 0, paginas: new Set<number>() };
    e.n += x.count;
    if (x.page !== undefined) e.paginas.add(x.page);
    porCodigo.set(x.code, e);
  }
  return [...porCodigo].map(([code, e]) => ({
    id: MENSAJE_ADVERTENCIA[code],
    params: { n: e.n, paginas: [...e.paginas].sort((a, b) => a - b).join(', ') },
  }));
}

function Metadatos({ doc }: { doc: DocumentModel }) {
  const categorias = (Object.keys(doc.metadata.categories) as MetadataCategory[]);
  if (categorias.length === 0) return null;
  // Solo categorías (INV-D04): nunca un valor del archivo.
  const lista = categorias.map((c) => t(ETIQUETA_METADATO[c])).join('; ');
  return (
    <section aria-label={t(E.avisoOriginal)} class="aviso-original" data-prueba="aviso-metadatos">
      <p>{t('M-49', { categorias: lista })}</p>
    </section>
  );
}

function Advertencias({ doc }: { doc: DocumentModel }) {
  const lineas = lineasDeAdvertencias(doc.warnings);
  if (lineas.length === 0) return null;
  return (
    <section aria-label={t(E.avisosDeLectura)} data-prueba="avisos-lectura">
      <ul class="avisos-lectura">
        {lineas.map((l) => <li key={l.id}>{t(l.id, l.params)}</li>)}
      </ul>
    </section>
  );
}

function PartesEncontradas({ doc }: { doc: DocumentModel }) {
  if (doc.parts.length <= 1) return null;
  const alternar = (id: string, incluida: boolean): void => {
    actualizarBorrador({ archivo: { ...doc, parts: doc.parts.map((p) => (p.id === id ? { ...p, included: incluida } : p)) } });
  };
  return (
    <details class="partes" data-prueba="partes">
      <summary>{tf('M-2225')}</summary>
      <Grupo leyenda={t(E.partesEncontradas)}>
      <p class="ayuda">{t('M-48')}</p>
      {doc.parts.map((p) => (
        <Casilla
          key={p.id}
          etiqueta={t(E.parteConTamano, { etiqueta: p.label, n: p.text.length })}
          marcada={p.included}
          onCambio={(v) => { alternar(p.id, v); }}
        />
      ))}
      </Grupo>
    </details>
  );
}

function Pestanas({ actual, onCambio, deshabilitado }: { actual: PestanaEntrada; onCambio: (p: PestanaEntrada) => void; deshabilitado: boolean }) {
  const refs = useRef<Record<PestanaEntrada, HTMLButtonElement | null>>({ pegar: null, cargar: null });
  const orden: readonly PestanaEntrada[] = ['cargar', 'pegar'];
  const etiquetas: Record<PestanaEntrada, MessageId> = { pegar: ROTULOS.pegar_texto, cargar: ROTULOS.cargar_archivo };
  const alTeclear = (e: KeyboardEvent): void => {
    const i = orden.indexOf(actual);
    let destino: PestanaEntrada | null = null;
    if (e.key === 'ArrowRight') destino = orden[(i + 1) % orden.length] ?? null;
    else if (e.key === 'ArrowLeft') destino = orden[(i + orden.length - 1) % orden.length] ?? null;
    else if (e.key === 'Home') destino = orden[0] ?? null;
    else if (e.key === 'End') destino = orden[orden.length - 1] ?? null;
    if (destino === null) return;
    e.preventDefault();
    onCambio(destino);
    refs.current[destino]?.focus();
  };
  return (
    <div role="tablist" aria-label={t(E.formaDeEntrada)} class="pestanas" onKeyDown={alTeclear}>
      {orden.map((p) => (
        <button
          key={p}
          type="button"
          role="tab"
          id={`pestana-${p}`}
          aria-selected={actual === p}
          aria-controls={`panel-${p}`}
          tabIndex={actual === p ? 0 : -1}
          disabled={deshabilitado}
          ref={(el) => { refs.current[p] = el; }}
          onClick={() => { onCambio(p); }}
        >
          {t(etiquetas[p])}
        </button>
      ))}
    </div>
  );
}

interface Avance { hecho: number; total: number; unidad: 'KB' | 'paginas' }

/** Zona de carga, pestaña «Pegar texto», avisos de lectura y «Anonimizar». Al anonimizar abre el caso efímero si no hay uno (D-23). */
export function CargaDocumento({ detector }: { detector?: ComponentChildren } = {}) {
  const b = useBorrador();
  const shell = useShell();
  const [leyendo, setLeyendo] = useState<Avance | null>(null);
  const [contador, setContador] = useState(b.texto.length);
  const control = useRef<AbortController | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const idArchivo = useIdNeutro();

  // Al salir de la pantalla (p. ej. «Editar lista del caso») se corta una lectura en curso: no queda nada a medias.
  useEffect(() => () => {
    control.current?.abort();
    if (temporizador.current !== undefined) clearTimeout(temporizador.current);
  }, []);

  const alEscribir = (v: string): void => {
    actualizarBorrador({ texto: v, analisisCancelado: false });
    // Contador con actualización diferida de 300 ms (8.2.4).
    if (temporizador.current !== undefined) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => { setContador(v.length); }, 300);
  };

  const cargar = async (archivo: File): Promise<void> => {
    const ctrl = new AbortController();
    control.current = ctrl;
    actualizarBorrador({ errorLectura: null, lecturaCancelada: false, analisisCancelado: false });
    setLeyendo({ hecho: 0, total: 0, unidad: 'KB' });
    try {
      const r = await leerContenido({
        archivo,
        label: etiquetaDeDocumento(),
        signal: ctrl.signal,
        alAvanzar: (hecho, total, unidad) => { setLeyendo({ hecho, total, unidad }); renovarActividad(); },
      });
      actualizarBorrador({ archivo: r.doc, formato: r.formato, bytes: r.bytes, errorLectura: null });
    } catch (e) {
      if (e instanceof LecturaCancelada) actualizarBorrador({ lecturaCancelada: true });
      else actualizarBorrador({ errorLectura: codigoDeError(e), archivo: null, formato: null, bytes: null });
    } finally {
      if (control.current === ctrl) control.current = null;
      setLeyendo(null);
    }
  };
  const alElegir = (e: Event): void => {
    const input = e.currentTarget as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';               // el nombre del archivo no queda en el campo (F-08)
    if (archivo) void cargar(archivo);
  };
  const alSoltar = (e: DragEvent): void => {
    e.preventDefault();
    const archivo = e.dataTransfer?.files[0];
    if (archivo && leyendo === null) void cargar(archivo);
  };

  const modeloListo = shell.model.state === 'listo';
  const documentoActual = b.pestana === 'pegar' ? null : b.archivo;
  const analizable = b.pestana === 'pegar' ? b.texto.trim() !== '' : partesAnalizables(documentoActual).length > 0;
  const puedeAnalizar = analizable && shell.swReady && leyendo === null;
  const analizar = (): void => {
    if (!puedeAnalizar) return;
    const doc = b.pestana === 'pegar' ? documentoDeTextoPegado(b.texto, etiquetaDeDocumento()) : b.archivo;
    if (doc === null) return;
    asegurarCaso();
    // `usarModelo` tal como lo dejó el abogado: sin el modelo descargado, el plan B dice «no descargado», no «desactivado».
    iniciarAnalisis({ doc, usarModelo: b.usarModelo });
  };

  const codigoError = b.errorLectura ?? (shell.error && (shell.error.context === 'procesando' || shell.error.context === 'entrada') ? shell.error.code : null);
  return (
    <section class="carga" aria-label={t(X.entrada)} data-prueba="carga">
      <Pestanas
        actual={b.pestana}
        deshabilitado={leyendo !== null}
        onCambio={(p) => { actualizarBorrador({ pestana: p, errorLectura: null, lecturaCancelada: false }); }}
      />

      {b.pestana === 'pegar' ? (
        <div role="tabpanel" id="panel-pegar" aria-labelledby="pestana-pegar" class="panel-entrada">
          <AreaTexto
            etiqueta={t(E.textoDelDocumento)}
            valor={b.texto}
            onInput={alEscribir}
            ayuda={t('M-46')}
            filas={14}
            clase="texto-documento"
          />
          <p class="ayuda" data-prueba="contador-caracteres" aria-live="off">{t(E.caracteres, { n: contador })}</p>
        </div>
      ) : (
        <div role="tabpanel" id="panel-cargar" aria-labelledby="pestana-cargar" class="panel-entrada">
          <div
            role="group"
            aria-label={t(E.zonaParaSoltar)}
            class="zona-soltar"
            data-prueba="zona-soltar"
            {...{ [ATRIBUTO_ZONA_SOLTAR]: '' }}
            onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }}
            onDrop={alSoltar}
          >
            <p>{t(E.zonaSoltar)}</p>
            <button type="button" class="secundario" disabled={leyendo !== null} onClick={() => { entrada.current?.click(); }}>{t('M-941')}</button>
            <input
              ref={entrada}
              id={idArchivo}
              name={idArchivo}
              type="file"
              accept=".txt,.docx,.pdf"
              hidden
              tabIndex={-1}
              onChange={alElegir}
            />
          </div>
          {leyendo !== null ? (
            <div role="status" data-prueba="lectura-en-curso">
              <p>
                {t('M-52', {
                  hecho: leyendo.hecho,
                  total: leyendo.total,
                  unidad: t(leyendo.unidad === 'KB' ? E.unidadKb : E.unidadPaginas),
                })}
              </p>
              <button type="button" class="secundario" onClick={() => { control.current?.abort(); }}>{t('M-942')}</button>
            </div>
          ) : null}
          {b.archivo !== null && b.formato !== null && b.bytes !== null ? (
            <section aria-label={t(ROTULOS.cargar_archivo)} data-prueba="archivo-cargado">
              <p role="status">{t('M-47', { formato: NOMBRE_FORMATO[b.formato], tamano: formatoTamano(b.bytes) })}</p>
              <PartesEncontradas doc={b.archivo} />
              <Metadatos doc={b.archivo} />
              <Advertencias doc={b.archivo} />
            </section>
          ) : null}
          {b.lecturaCancelada ? <p role="status" data-prueba="lectura-cancelada">{t(E.lecturaCancelada)}</p> : null}
        </div>
      )}

      {codigoError !== null ? <p role="alert" class="error-campo" data-prueba="error-entrada">{mensajeDeCodigo(codigoError)}</p> : null}
      {b.analisisCancelado ? <p role="status" data-prueba="analisis-cancelado">{t('M-61')}</p> : null}

      {/* F8 (v1.1.1): el detector de nombres, a la vista antes de «Anonimizar». */}
      {detector}
      <div class="acciones">
        <button type="button" disabled={!puedeAnalizar} aria-describedby={analizable ? undefined : 'ayuda-analizar'} onClick={analizar}>{t('M-944')}</button>
      </div>
      {!analizable ? <p id="ayuda-analizar" class="ayuda">{t(E.ayudaAnalizar)}</p> : null}
      {/* F10 (v1.1.3): «Anonimizar» descarga el detector la primera vez; se dice antes del clic. */}
      {seDescargaraAlAnonimizar(shell.model.state, b.usarModelo)
        ? <p class="ayuda" data-prueba="nota-descarga">{tf('M-2338', { mb: puertos.modelo.estado().mb ?? 626 })}</p>
        : null}
    </section>
  );
}

/** Casilla «Usar el detector de nombres en este documento» (en la tarjeta del detector de Cargar, F8). */
/** F10 (v1.1.3): ¿«Anonimizar» empezará la descarga del detector? (Disponible, no descargado o con fallo, sin ahorro de datos.) */
export function seDescargaraAlAnonimizar(estado: string, usarModelo: boolean): boolean {
  return usarModelo && (estado === 'no_descargado' || estado === 'fallo') && puertos.modelo.disponible() && !ahorroDeDatos();
}

export function CasillaModelo() {
  const b = useBorrador();
  const shell = useShell();
  const modeloListo = shell.model.state === 'listo';
  // F10: sin el detector descargado la casilla también se puede usar: marcada, «Anonimizar» lo descarga; desmarcada, no.
  const usable = modeloListo || puertos.modelo.disponible();
  return (
    <div class="campo-modelo">
      <Casilla
        etiqueta={tf('M-2314')}
        marcada={b.usarModelo && usable}
        onCambio={(v) => { actualizarBorrador({ usarModelo: v }); }}
        deshabilitado={!usable}
        ayuda={modeloListo ? t(E.ayudaModelo) : usable ? tf('M-2340') : t('M-51')}
      />
    </div>
  );
}
