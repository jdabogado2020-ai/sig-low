// Orquestación del análisis en la interfaz (PC-2, 8.1 y 6.11.2): la tubería real de `detect` detrás de un worker falso en el hilo,
// y un puerto `ner` falso. Comprueba que Procesando pasa a Revisión con el modelo en curso (o en plan B), que cada ventana entra por
// `fusionar` + `incorporar_modelo`, el plan B por fallo y por «Seguir sin el modelo», y que INV-G09 termina el worker. Datos ficticios.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDetectHandler } from '../../src/core/pipeline';
import type { AsuntoId, Detection, NerSpan, PartId, ReviewState } from '../../src/core/types';
import { applyReviewAction, emptyTable, tableIndexOf } from '../../src/core/entities';
import { minutosRestantes, textoAgregados, textoRestante } from '../../src/ui/flujo/DescargaDetector';
import type { WorkerIo } from '../../src/io/io-client';
import { iniciarAnalisis, obtenerVistaAnalisis, seguirSinModelo, cancelarAnalisis, estadoDeConjunto, fechaDeReferencia } from '../../src/ui/analisis';
import { fijarRevision, obtenerBorrador, obtenerDocumento, obtenerRevision } from '../../src/ui/documento';
import { actualizar, obtener, reiniciarEstado, type ShellState } from '../../src/ui/estado';
import { documentoDeTextoPegado, detectarFormato, extensionDe } from '../../src/ui/lectura';
import { instalarPuertos, puertos, type NerHooks, type NerPuerto } from '../../src/ui/servicios';
import { vaciarEstadoM } from '../../src/ui/sesion';

const TEXTO = 'La señora Ana Ficticia Rojas, C.C. 1.000.000.017, vive en la Calle 00 n.º 00-00. Correo: ana.ficticia@ejemplo.test.';

interface Falso extends WorkerIo { terminado: boolean; enviados: Array<{ kind: string }> }

/** Worker falso que ejecuta el manejador real de `detect` en el mismo hilo. */
function crearFalso(): Falso {
  const manejar = createDetectHandler();
  const w: Falso = {
    terminado: false,
    enviados: [],
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(msg: unknown): void {
      w.enviados.push({ kind: (msg as { kind: string }).kind });
      void manejar(msg, (m) => { setTimeout(() => { if (!w.terminado) w.onmessage?.({ data: m }); }, 0); });
    },
    terminate(): void { w.terminado = true; },
  };
  return w;
}

const esperar = async (cond: () => boolean, ms = 20_000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('TIEMPO_DE_PRUEBA');
    await new Promise((r) => setTimeout(r, 5));
  }
};

interface NerFalso extends NerPuerto { hooks: NerHooks | null; cancelado: number }
function nerFalso(): NerFalso {
  const n: NerFalso = {
    hooks: null,
    cancelado: 0,
    iniciar(_doc, hooks) {
      n.hooks = hooks;
      return { cancelar(): void { n.cancelado++; } };
    },
  };
  return n;
}

const MODELO_LISTO = {
  disponible: () => true, estado: () => ({ state: 'listo' as const, mb: 1 }), descargar: () => Promise.resolve(), cancelar: () => undefined, quitar: () => Promise.resolve(),
};

describe('análisis en la interfaz', () => {
  const original = { ...puertos };
  beforeEach(() => { reiniciarEstado(); });
  afterEach(() => {
    vaciarEstadoM();
    instalarPuertos(original);
    vi.restoreAllMocks();
  });

  it('sin modelo descargado, Procesando pasa a la vista previa con el modelo en plan B (no_descargado) y todo aplicado (D-24)', async () => {
    const w = crearFalso();
    iniciarAnalisis({ doc: documentoDeTextoPegado(TEXTO, 'Documento 1'), usarModelo: true, crearWorker: () => w });
    expect(obtener().screen).toBe('procesando');
    expect(obtener().phase).toBe('procesando');
    await esperar(() => obtener().screen === 'revision');
    const r = obtenerRevision();
    expect(r?.modelo).toEqual({ kind: 'plan_b', causa: 'no_descargado' });
    expect(Object.keys(r?.detections ?? {}).length).toBeGreaterThan(0);
    expect(r?.order).toHaveLength(Object.keys(r?.detections ?? {}).length);
    expect(obtener().modelRun).toEqual({ kind: 'plan_b', causa: 'no_descargado' });
    // D-24: la vista previa llega con la propuesta aplicada: nada por revisar y cada decisión marcada como de la propuesta.
    expect(Object.values(r?.detections ?? {}).every((d) => d.status === 'aceptada' && d.decidedBy === 'propuesta')).toBe(true);
    await esperar(() => w.enviados.some((e) => e.kind === 'liberar'));
    expect(w.enviados.map((e) => e.kind)).toEqual(['detectar', 'fusionar', 'liberar']);
  });

  it('con el modelo apagado por el abogado, el plan B nace «desactivado»', async () => {
    instalarPuertos({ modelo: MODELO_LISTO, ner: nerFalso() });
    iniciarAnalisis({ doc: documentoDeTextoPegado(TEXTO, 'Documento 1'), usarModelo: false, crearWorker: crearFalso });
    await esperar(() => obtener().screen === 'revision');
    expect(obtenerRevision()?.modelo).toEqual({ kind: 'plan_b', causa: 'desactivado' });
  });

  it('con el modelo listo, la revisión nace con el modelo en curso y cada ventana entra por fusionar + incorporar_modelo hasta «terminado»', async () => {
    const ner = nerFalso();
    instalarPuertos({ modelo: MODELO_LISTO, ner });
    const doc = documentoDeTextoPegado(TEXTO, 'Documento 1');
    const w = crearFalso();
    iniciarAnalisis({ doc, usarModelo: true, crearWorker: () => w });
    expect(obtenerVistaAnalisis().conModelo).toBe(true);
    await esperar(() => obtener().screen === 'revision' && ner.hooks !== null);
    expect(obtenerRevision()?.modelo).toEqual({ kind: 'en_curso', ventanas: 0, ventanasTotales: 0 });
    const revisionInicial = obtenerRevision()?.revision ?? -1;
    const parte = doc.parts[0]?.id as PartId;
    const span = (start: number, end: number): NerSpan => ({ start, end, label: 'PER', score: 0.95 });
    ner.hooks?.alTotal(2, 1000);
    expect(obtenerVistaAnalisis().modelo).toEqual({ ventanasTotales: 2, calentamientoMs: 1000 });
    ner.hooks?.alVentana({ ventana: 1, ventanasTotales: 2, ner: { [parte]: [span(10, 28)] }, engineId: 'gliner-x-large' });
    await esperar(() => (obtenerRevision()?.modelo.kind === 'en_curso' && obtenerRevision()?.modelo.ventanas === 1));
    expect(obtenerRevision()?.revision).toBeGreaterThan(revisionInicial);
    expect(obtener().screen).toBe('revision');                      // el foco y la pantalla no se mueven (8.8)
    // Con el modelo en curso la propuesta espera (D-03: lo de la lista debe seguir intacto para ceder ante el modelo).
    expect(Object.values(obtenerRevision()?.detections ?? {}).some((d) => d.status === 'pendiente')).toBe(true);
    ner.hooks?.alVentana({ ventana: 2, ventanasTotales: 2, ner: { [parte]: [] }, engineId: 'gliner-x-large' });
    await esperar(() => obtenerRevision()?.modelo.kind === 'terminado');
    // Al terminar el modelo, todo queda aplicado.
    expect(Object.values(obtenerRevision()?.detections ?? {}).some((d) => d.status === 'pendiente')).toBe(false);
    ner.hooks?.alTerminar({ respaldo: false });
    await esperar(() => w.enviados.some((e) => e.kind === 'liberar'));
    expect(obtener().modelRun?.kind).toBe('terminado');
  });

  it('si el modelo falla (memoria), se cierra la fusión, se declara el plan B y se libera la sesión conservando lo incorporado', async () => {
    const ner = nerFalso();
    instalarPuertos({ modelo: MODELO_LISTO, ner });
    const w = crearFalso();
    iniciarAnalisis({ doc: documentoDeTextoPegado(TEXTO, 'Documento 1'), usarModelo: true, crearWorker: () => w });
    await esperar(() => obtener().screen === 'revision' && ner.hooks !== null);
    ner.hooks?.alFallar('memoria_insuficiente');
    await esperar(() => obtenerRevision()?.modelo.kind === 'plan_b');
    expect(obtenerRevision()?.modelo).toMatchObject({ kind: 'plan_b', causa: 'memoria_insuficiente' });
    await esperar(() => w.enviados.some((e) => e.kind === 'liberar'));
  });

  it('«Seguir sin el modelo» cancela `ner`, cierra la fusión y declara el plan B «cancelado»', async () => {
    const ner = nerFalso();
    instalarPuertos({ modelo: MODELO_LISTO, ner });
    const w = crearFalso();
    iniciarAnalisis({ doc: documentoDeTextoPegado(TEXTO, 'Documento 1'), usarModelo: true, crearWorker: () => w });
    await esperar(() => obtener().screen === 'revision' && ner.hooks !== null);
    seguirSinModelo();
    await esperar(() => obtenerRevision()?.modelo.kind === 'plan_b');
    expect(obtenerRevision()?.modelo).toMatchObject({ kind: 'plan_b', causa: 'cancelado' });
    expect(ner.cancelado).toBe(1);
  });

  it('INV-G09 vaciar el estado [M] termina el worker, cancela `ner` y borra documento y revisión', async () => {
    const ner = nerFalso();
    instalarPuertos({ modelo: MODELO_LISTO, ner });
    const w = crearFalso();
    iniciarAnalisis({ doc: documentoDeTextoPegado(TEXTO, 'Documento 1'), usarModelo: true, crearWorker: () => w });
    await esperar(() => obtener().screen === 'revision' && ner.hooks !== null);
    vaciarEstadoM();
    expect(w.terminado).toBe(true);
    expect(ner.cancelado).toBe(1);
    expect(obtenerRevision()).toBeNull();
    expect(obtenerDocumento()).toBeNull();
    expect(obtenerBorrador().texto).toBe('');
  });

  it('cancelar sin respuesta del worker lo termina a los 2 s y vuelve a «Cargar documento» con el texto conservado', async () => {
    vi.useFakeTimers();
    try {
      const w: Falso = { terminado: false, enviados: [], onmessage: null, onerror: null, onmessageerror: null, postMessage(m: unknown) { w.enviados.push({ kind: (m as { kind: string }).kind }); }, terminate() { w.terminado = true; } };
      iniciarAnalisis({ doc: documentoDeTextoPegado(TEXTO, 'Documento 1'), usarModelo: false, crearWorker: () => w });
      cancelarAnalisis();
      expect(obtenerVistaAnalisis().cancelando).toBe(true);
      expect(w.enviados.map((e) => e.kind)).toEqual(['detectar', 'cancelar']);
      vi.advanceTimersByTime(1999);
      expect(w.terminado).toBe(false);
      vi.advanceTimersByTime(2);
      expect(w.terminado).toBe(true);
      expect(obtener().screen).toBe('inicio');
      expect(obtenerBorrador().analisisCancelado).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('un error del worker `detect` vuelve a «Cargar documento» con solo el código (sin texto del documento)', async () => {
    const w: Falso = {
      terminado: false, enviados: [], onmessage: null, onerror: null, onmessageerror: null,
      postMessage(m: unknown) { const r = (m as { reqId: string }).reqId; setTimeout(() => w.onmessage?.({ data: { v: 1, reqId: r, kind: 'error', code: 'MEMORIA', retryable: true } }), 0); },
      terminate() { w.terminado = true; },
    };
    iniciarAnalisis({ doc: documentoDeTextoPegado(TEXTO, 'Documento 1'), usarModelo: false, crearWorker: () => w });
    await esperar(() => obtener().screen === 'inicio');
    expect(obtener().error).toEqual({ code: 'MEMORIA', context: 'procesando' });
    expect(JSON.stringify(obtener().error)).not.toContain('Ficticia');
    expect(w.terminado).toBe(true);
  });
});

// ===== F10 (v1.1.3) · el detector se descarga al pulsar «Anonimizar» =====

interface ModeloDescargable {
  disponible(): boolean; estado(): { state: ShellState['model']['state']; mb: number }; descargar(): Promise<void>; cancelar(): void; quitar(): Promise<void>;
  llamadas: number; terminar(ok: boolean): void;
}
/** Puerto `modelo` que no está descargado: `descargar` pasa a «descargando» y espera a `terminar` (listo o fallo), como el de F0. */
function modeloSinDescargar(): ModeloDescargable {
  let estado: ShellState['model']['state'] = 'no_descargado';
  let fin: (() => void) | null = null;
  const m: ModeloDescargable = {
    llamadas: 0,
    disponible: () => true,
    estado: () => ({ state: estado, mb: 626 }),
    descargar() {
      m.llamadas++;
      estado = 'descargando';
      actualizar({ model: { state: 'descargando', doneBytes: 0, totalBytes: 626_000_000 } });
      return new Promise<void>((ok) => { fin = ok; });
    },
    cancelar: () => undefined,
    quitar: () => Promise.resolve(),
    terminar(ok) {
      estado = ok ? 'listo' : 'fallo';
      actualizar({ model: ok ? { state: 'listo', variant: 'principal' } : { state: 'fallo', motivo: 'red' } });
      fin?.();
    },
  };
  return m;
}

describe('F10 descarga del detector al anonimizar', () => {
  const original = { ...puertos };
  beforeEach(() => { reiniciarEstado(); });
  afterEach(() => {
    vaciarEstadoM();
    instalarPuertos(original);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sin el detector: la vista previa sale con reglas y lista mientras se descarga; al terminar corre sobre el documento, suma lo suyo y no deshace lo corregido', async () => {
    const modelo = modeloSinDescargar();
    const ner = nerFalso();
    instalarPuertos({ modelo, ner });
    const doc = documentoDeTextoPegado(TEXTO, 'Documento 1');
    const w = crearFalso();
    iniciarAnalisis({ doc, usarModelo: true, crearWorker: () => w });
    expect(obtenerVistaAnalisis().conModelo).toBe(true);
    await esperar(() => obtener().screen === 'revision');
    // Vista previa de inmediato, con el modelo «en curso» (la puerta sigue cerrada por MODELO_EN_CURSO) y la descarga empezada.
    expect(obtenerRevision()?.modelo.kind).toBe('en_curso');
    expect(modelo.llamadas).toBe(1);
    expect(obtenerVistaAnalisis().descargaModelo).toBe(true);
    expect(ner.hooks).toBeNull();
    // El abogado corrige mientras tanto: muestra un dato.
    const r0 = obtenerRevision() as ReviewState;
    const det = Object.values(r0.detections).find((d) => d.type === 'CC') as Detection;
    const out = applyReviewAction(r0, { kind: 'rechazar', detectionId: det.id }, { table: tableIndexOf(emptyTable('asu_' as AsuntoId)), caseList: [], doc });
    if (!out.ok) throw new Error(out.code);
    fijarRevision(out.state);
    // Termina la descarga: el detector arranca sobre este documento.
    modelo.terminar(true);
    await esperar(() => ner.hooks !== null);
    expect(obtenerVistaAnalisis().descargaModelo).toBe(false);
    const parte = doc.parts[0]?.id as PartId;
    ner.hooks?.alTotal(1, 0);
    // «La señora Ana Ficticia Rojas»: el detector encuentra a la persona (aquí, una que no está en ninguna lista).
    const ini = TEXTO.indexOf('Ana Ficticia Rojas');
    ner.hooks?.alVentana({ ventana: 1, ventanasTotales: 1, ner: { [parte]: [{ start: ini, end: ini + 'Ana Ficticia Rojas'.length, label: 'PER', score: 0.95 }] }, engineId: 'gliner-x-large' });
    await esperar(() => obtenerRevision()?.modelo.kind === 'terminado');
    const final = obtenerRevision() as ReviewState;
    expect(Object.values(final.detections).some((d) => d.source === 'modelo')).toBe(true);
    expect(textoAgregados(final)).toMatch(/^El detector de nombres agregó (1 dato|\d+ datos)\.$/);
    // Lo que el abogado mostró sigue a la vista y, con el detector terminado, la propuesta quedó aplicada.
    expect(final.detections[det.id]?.status).toBe('rechazada');
    expect(Object.values(final.detections).some((d) => d.status === 'pendiente')).toBe(false);
  });

  it('si la descarga falla, la vista previa sigue con reglas y lista (plan B «no descargado») y el detector no arranca', async () => {
    const modelo = modeloSinDescargar();
    const ner = nerFalso();
    instalarPuertos({ modelo, ner });
    iniciarAnalisis({ doc: documentoDeTextoPegado(TEXTO, 'Documento 1'), usarModelo: true, crearWorker: crearFalso });
    await esperar(() => obtener().screen === 'revision' && obtenerVistaAnalisis().descargaModelo);
    modelo.terminar(false);
    await esperar(() => obtenerRevision()?.modelo.kind === 'plan_b');
    expect(obtenerRevision()?.modelo).toMatchObject({ kind: 'plan_b', causa: 'no_descargado' });
    expect(obtener().model.state).toBe('fallo');
    expect(ner.hooks).toBeNull();
    expect(Object.values(obtenerRevision()?.detections ?? {}).every((d) => d.status === 'aceptada')).toBe(true);
  });

  it('«Descargar sin esperar al detector»: plan B «cancelado» enseguida; la descarga sigue y, al terminar, no toca ese documento', async () => {
    const modelo = modeloSinDescargar();
    const ner = nerFalso();
    instalarPuertos({ modelo, ner });
    iniciarAnalisis({ doc: documentoDeTextoPegado(TEXTO, 'Documento 1'), usarModelo: true, crearWorker: crearFalso });
    await esperar(() => obtener().screen === 'revision' && obtenerVistaAnalisis().descargaModelo);
    seguirSinModelo();
    await esperar(() => obtenerRevision()?.modelo.kind === 'plan_b');
    expect(obtenerRevision()?.modelo).toMatchObject({ kind: 'plan_b', causa: 'cancelado' });
    expect(obtenerVistaAnalisis().descargaModelo).toBe(false);
    modelo.terminar(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(obtener().model.state).toBe('listo');   // queda para el próximo documento
    expect(ner.hooks).toBeNull();
    expect(obtenerRevision()?.modelo.kind).toBe('plan_b');
  });

  it('con ahorro de datos (saveData) o con la casilla desmarcada, «Anonimizar» no descarga nada', async () => {
    const modelo = modeloSinDescargar();
    instalarPuertos({ modelo, ner: nerFalso() });
    vi.stubGlobal('navigator', { connection: { saveData: true } });
    iniciarAnalisis({ doc: documentoDeTextoPegado(TEXTO, 'Documento 1'), usarModelo: true, crearWorker: crearFalso });
    await esperar(() => obtener().screen === 'revision');
    expect(obtenerRevision()?.modelo).toEqual({ kind: 'plan_b', causa: 'no_descargado' });
    expect(modelo.llamadas).toBe(0);
    vi.unstubAllGlobals();
    iniciarAnalisis({ doc: documentoDeTextoPegado(TEXTO, 'Documento 2'), usarModelo: false, crearWorker: crearFalso });
    await esperar(() => obtener().screen === 'revision' && obtenerRevision()?.modelo.kind === 'plan_b');
    expect(obtenerRevision()?.modelo).toEqual({ kind: 'plan_b', causa: 'desactivado' });
    expect(modelo.llamadas).toBe(0);
  });
});

describe('F10 tiempo estimado de la descarga', () => {
  it('estima con la velocidad medida desde la primera muestra y no antes de 3 s', () => {
    expect(minutosRestantes({ t: 0, b: 0 }, 2000, 10_000_000, 626_000_000)).toBeNull();
    // 60 MB en 60 s = 1 MB/s; faltan 566 MB → unos 9,4 minutos.
    const min = minutosRestantes({ t: 0, b: 0 }, 60_000, 60_000_000, 626_000_000) as number;
    expect(min).toBeCloseTo(566 / 60, 1);
    expect(textoRestante(min)).toBe('Faltan unos 9 minutos.');
    expect(textoRestante(0.5)).toBe('Falta menos de un minuto.');
    expect(textoRestante(1.2)).toBe('Falta cerca de un minuto.');
    expect(textoRestante(null)).toBe('Midiendo la velocidad de la descarga…');
  });
});

describe('lectura y estado inicial de la revisión', () => {
  it('detectarFormato: bytes mágicos y extensión (nunca el nombre completo)', () => {
    const b = (...x: number[]): Uint8Array => new Uint8Array(x);
    expect(detectarFormato(b(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31), 'pdf')).toEqual({ formato: 'pdf' });
    expect(detectarFormato(b(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31), 'txt')).toEqual({ formato: 'pdf' });
    expect(detectarFormato(b(0x50, 0x4b, 0x03, 0x04), 'docx')).toEqual({ formato: 'docx' });
    expect(detectarFormato(b(0x50, 0x4b, 0x03, 0x04), 'xlsx')).toEqual({ error: 'FORMATO_NO_ADMITIDO' });
    expect(detectarFormato(b(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), 'doc')).toEqual({ error: 'CONTENEDOR_CFB' });
    expect(detectarFormato(b(0x68, 0x6f, 0x6c, 0x61), 'txt')).toEqual({ formato: 'txt' });
    expect(detectarFormato(b(0x68, 0x6f, 0x6c, 0x61), 'docx')).toEqual({ error: 'ZIP_INVALIDO' });
    expect(detectarFormato(b(0x68, 0x6f, 0x6c, 0x61), 'pdf')).toEqual({ error: 'PDF_DANADO' });
    expect(detectarFormato(b(0x68, 0x6f, 0x6c, 0x61), '')).toEqual({ error: 'FORMATO_NO_ADMITIDO' });
    expect(detectarFormato(b(), 'txt')).toEqual({ error: 'ARCHIVO_VACIO' });
    expect(extensionDe('Ana Ficticia Rojas.TXT')).toBe('txt');
    expect(extensionDe('sin extension')).toBe('');
    expect(extensionDe('raro.demasiadolargo')).toBe('');
  });

  it('el texto pegado es una sola parte `cuerpo` «Texto pegado» con texto canónico', () => {
    const d = documentoDeTextoPegado('uno\r\ndos\rtres', 'Documento 3');
    expect(d.source).toBe('pegado');
    expect(d.label).toBe('Documento 3');
    expect(d.parts).toHaveLength(1);
    expect(d.parts[0]).toMatchObject({ kind: 'cuerpo', label: 'Texto pegado', order: 0, index: 1, included: true, text: 'uno\ndos\ntres' });
  });

  it('estadoDeConjunto ordena por (part.order, start) y fija el modelo recibido', () => {
    const d = documentoDeTextoPegado(TEXTO, 'Documento 1');
    const base = { id: 'x', docId: d.id, replacement: {}, status: 'pendiente' };
    const set = {
      detections: [{ ...base, id: 'det_b', partId: d.parts[0]?.id, start: 50, end: 60 }, { ...base, id: 'det_a', partId: d.parts[0]?.id, start: 5, end: 9 }],
      entities: [], flags: [], suggestions: [],
    } as never;
    const e = estadoDeConjunto(d, set, { kind: 'en_curso', ventanas: 0, ventanasTotales: 0 });
    expect(e.order).toEqual(['det_a', 'det_b']);
    expect(e.revision).toBe(0);
    expect(e.committed).toBe(false);
  });

  it('la fecha de referencia es la del día en America/Bogota (UTC-5)', () => {
    expect(fechaDeReferencia(new Date('2026-10-31T03:30:00Z'))).toBe('2026-10-30');
    expect(fechaDeReferencia(new Date('2026-10-30T05:00:00Z'))).toBe('2026-10-30');
  });
});
