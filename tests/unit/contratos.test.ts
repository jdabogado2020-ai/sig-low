// T-MO-10 (parte P0-1): invariantes de las enumeraciones (6.2.5) y de los protocolos (6.11.8: INV-W07 e INV-W08).
// Los datos son ficticios. INV-W07 e INV-W08 se comprueban aquí contra el contrato de tipos con un validador y una traza de
// referencia; PB-6 los repite contra el worker `ner` real con las mismas funciones de validación.
// PB-6 añade al final: INV-W01, INV-W02, INV-W05 e INV-W07 contra el worker `detect` real, y el informe (6.8: INV-I01 a INV-I05, INV-G04).
import { describe, expect, it, vi } from 'vitest';
import {
  DATA_TYPES, FLAG_TYPES, MARKER_FAMILIES, MARKER_LABEL, SiglowError,
  type DetectableType, type FamilyForFn, type MarkerFamily, type ModelProgress, type NerResponse, type PartId,
  type PlanBCause, type RequestId, type ReviewAction,
} from '../../src/core/types';
import type { DetectionSet, DocId, DocumentModel, ExportGateFn, GateReason, IdSource, MetadataCategory, NerSpan, ParseWarningCode, ReviewState, TableIndex } from '../../src/core/types';
import { applyReviewAction } from '../../src/core/entities';
import type { ReviewContext } from '../../src/core/entities';
import { createDetectHandler } from '../../src/core/pipeline';
import { buildReport, reportToJson, reportToText, ETIQUETA_DE_METADATO } from '../../src/core/report';
import { declararPlanB, incorporarModelo, modeloInicial } from '../../src/core/review/modelo';

/** 6.2.3 (bandera `u`, sensible a mayúsculas). */
const MARCADOR = /\[(DEMANDANTE|DEMANDADO|TESTIGO|PACIENTE|CLIENTE|CONTACTO|PERSONA|EMPRESA|EPS|IPS|ENTIDAD|PROVEEDOR|CC|TI|CE|PPT|PEP|PASAPORTE|NIT|TP|DOCUMENTO|DIRECCIÓN|TELÉFONO|CORREO|RADICADO|HC|AFILIACIÓN|PLACA|MATRÍCULA|CUENTA|FECHA|VALOR|DEPARTAMENTO)_([1-9][0-9]{0,3})\]/u;
const MARCADOR_EXACTO = new RegExp(`^${MARCADOR.source}$`, 'u');

const DETECTABLES = DATA_TYPES.filter((t): t is DetectableType => !(FLAG_TYPES as readonly string[]).includes(t));

// familyFor lo implementa entities.ts (PB-3): INV-E02, INV-E03 e INV-E05 se activan solos cuando ese módulo existe.
const modulos = import.meta.glob('../../src/core/entities.ts');
const cargarEntities = Object.values(modulos)[0];
const familyFor: FamilyForFn | null = cargarEntities
  ? ((await cargarEntities()) as { familyFor: FamilyForFn }).familyFor
  : null;

describe('enumeraciones (6.2.5)', () => {
  it('INV-E01 toda familia tiene etiqueta en MARKER_LABEL, en NFC y en mayúsculas', () => {
    expect(Object.keys(MARKER_LABEL).sort()).toEqual([...MARKER_FAMILIES].sort());
    for (const f of MARKER_FAMILIES) {
      const etiqueta = MARKER_LABEL[f];
      expect(etiqueta, f).toBeTypeOf('string');
      expect(etiqueta.normalize('NFC'), f).toBe(etiqueta);
      expect(etiqueta.toUpperCase(), f).toBe(etiqueta);
    }
    expect(MARKER_LABEL.DIRECCION).toBe('DIRECCIÓN');
    expect(MARKER_LABEL.TELEFONO).toBe('TELÉFONO');
    expect(MARKER_LABEL.AFILIACION).toBe('AFILIACIÓN');
    expect(MARKER_LABEL.MATRICULA).toBe('MATRÍCULA');
  });

  it('INV-E04 la expresión de 6.2.3 reconoce los 33 marcadores con _1 y _9999 y rechaza _0, _01 y _10000', () => {
    expect(MARKER_FAMILIES).toHaveLength(33);
    for (const f of MARKER_FAMILIES) {
      const etiqueta = MARKER_LABEL[f as MarkerFamily];
      expect(MARCADOR_EXACTO.test(`[${etiqueta}_1]`), `${etiqueta}_1`).toBe(true);
      expect(MARCADOR_EXACTO.test(`[${etiqueta}_9999]`), `${etiqueta}_9999`).toBe(true);
      expect(MARCADOR_EXACTO.test(`[${etiqueta}_0]`), `${etiqueta}_0`).toBe(false);
      expect(MARCADOR_EXACTO.test(`[${etiqueta}_01]`), `${etiqueta}_01`).toBe(false);
      expect(MARCADOR_EXACTO.test(`[${etiqueta}_10000]`), `${etiqueta}_10000`).toBe(false);
    }
  });

  it('INV-E04 tabla de 6.2.3: casa y no casa', () => {
    for (const ok of ['[DEMANDANTE_1]', '[DIRECCIÓN_12]', '[AFILIACIÓN_9999]', '[DOCUMENTO_1]']) {
      expect(MARCADOR_EXACTO.test(ok), ok).toBe(true);
    }
    for (const no of ['[DEMANDANTE_0]', '[CC_01]', '[CC_10000]', '[DIRECCION_1]', '[demandante_1]', '[ABOGADO_1]']) {
      expect(MARCADOR_EXACTO.test(no), no).toBe(false);
    }
  });

  it('INV-E04 el marcador se reconoce dentro de un texto y la expresión lista las mismas etiquetas que MARKER_LABEL', () => {
    const m = MARCADOR.exec('Se notificó a [TESTIGO_3] y a [MATRÍCULA_10].');
    expect(m?.[0]).toBe('[TESTIGO_3]');
    const alternativas = /\\\[\(([^)]+)\)/u.exec(MARCADOR.source)?.[1]?.split('|') ?? [];
    expect(alternativas).toEqual(MARKER_FAMILIES.map((f) => MARKER_LABEL[f as MarkerFamily]));
  });

  it.skipIf(familyFor === null)('INV-E02 familyFor es total sobre DetectableType', () => {
    for (const t of DETECTABLES) {
      const fam = familyFor!(t);
      expect(MARKER_FAMILIES as readonly string[], t).toContain(fam);
    }
  });

  it.skipIf(familyFor === null)('INV-E03 familyFor no devuelve familia para un FlagType', () => {
    for (const t of FLAG_TYPES) {
      let r: unknown;
      try { r = familyFor!(t as unknown as DetectableType); } catch { r = undefined; }
      expect(r, t).toBeUndefined();
    }
  });

  it.skipIf(familyFor === null)('INV-E05 TI, CE, PPT y PEP dan DOCUMENTO salvo con marcadorEspecifico', () => {
    for (const t of ['TI', 'CE', 'PPT', 'PEP'] as const) {
      expect(familyFor!(t), t).toBe('DOCUMENTO');
      expect(familyFor!(t, undefined, { marcadorEspecifico: false }), t).toBe('DOCUMENTO');
      expect(familyFor!(t, undefined, { marcadorEspecifico: true }), t).toBe(t);
    }
    expect(familyFor!('CC', undefined, { marcadorEspecifico: true })).toBe('CC');
  });

  it('las constantes de catálogo son coherentes: 37 tipos únicos y banderas dentro de DATA_TYPES', () => {
    expect(DATA_TYPES).toHaveLength(37);
    expect(new Set(DATA_TYPES).size).toBe(DATA_TYPES.length);
    for (const f of FLAG_TYPES) expect(DATA_TYPES as readonly string[]).toContain(f);
    expect(DETECTABLES).toHaveLength(DATA_TYPES.length - FLAG_TYPES.length);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Protocolos (6.11.8)

const ID = (prefijo: string, n: number) => `${prefijo}_${n.toString(16).padStart(32, '0')}`;
const REQ = (n: number) => ID('req', n) as RequestId;
const PRT = (n: number) => ID('prt', n) as PartId;
const RE_ID = /^(doc|prt|det|ent|cas|sug|flg|edt|asu|req|rei)_[0-9a-f]{32}$/;
const TEXTO_DEL_DOCUMENTO = 'Ana Ficticia Rojas';   // aparece en el documento de prueba y jamás en un mensaje

const ETAPAS = ['lectura', 'reglas', 'lista', 'generalizacion', 'modelo_carga', 'modelo', 'fusion'];
const UNIDADES = ['partes', 'paginas', 'ventanas', 'bytes'];
const ETIQUETAS = ['PER', 'ORG', 'LOC', 'OTH', 'DATE'];

const claves = (o: object) => Object.keys(o).sort();
const mismasClaves = (o: object, esperadas: string[]) => JSON.stringify(claves(o)) === JSON.stringify(esperadas);
const esNumeroFinito = (x: unknown) => typeof x === 'number' && Number.isFinite(x);

/** Forma exacta de un `progreso` (6.11.1). */
function esProgresoValido(m: Record<string, unknown>): boolean {
  return mismasClaves(m, ['done', 'kind', 'reqId', 'stage', 'total', 'unit', 'v'])
    && m.v === 1 && m.kind === 'progreso' && RE_ID.test(String(m.reqId))
    && ETAPAS.includes(String(m.stage)) && UNIDADES.includes(String(m.unit))
    && esNumeroFinito(m.done) && esNumeroFinito(m.total);
}

/** Forma exacta de un `parcial` del worker `ner` (6.11.3): solo partId, posiciones, etiquetas y puntajes. */
function esParcialNerValido(m: Record<string, unknown>): boolean {
  if (!mismasClaves(m, ['kind', 'payload', 'reqId', 'v'])) return false;
  if (m.v !== 1 || m.kind !== 'parcial' || !RE_ID.test(String(m.reqId))) return false;
  const p = m.payload as Record<string, unknown> | undefined;
  if (typeof p !== 'object' || p === null || !mismasClaves(p, ['window', 'windowsDone', 'windowsTotal'])) return false;
  if (!esNumeroFinito(p.windowsDone) || !esNumeroFinito(p.windowsTotal)) return false;
  const w = p.window as Record<string, unknown>;
  if (!mismasClaves(w, ['ms', 'partId', 'spans', 'windowIndex', 'windowTotal'])) return false;
  if (!RE_ID.test(String(w.partId)) || !String(w.partId).startsWith('prt_')) return false;
  if (!esNumeroFinito(w.ms) || !esNumeroFinito(w.windowIndex) || !esNumeroFinito(w.windowTotal) || !Array.isArray(w.spans)) return false;
  return (w.spans as Record<string, unknown>[]).every((s) =>
    mismasClaves(s, ['end', 'label', 'score', 'start'])
    && esNumeroFinito(s.start) && esNumeroFinito(s.end) && ETIQUETAS.includes(String(s.label)) && esNumeroFinito(s.score));
}

const progreso = {
  v: 1, reqId: REQ(1), kind: 'progreso', stage: 'modelo', done: 2, total: 5, unit: 'ventanas',
} as const satisfies NerResponse;
const parcial = (n: number, de = 5) => ({
  v: 1, reqId: REQ(1), kind: 'parcial',
  payload: {
    windowsDone: n, windowsTotal: de,
    window: { partId: PRT(7), windowIndex: n - 1, windowTotal: de, ms: 6200, spans: [{ start: 10, end: 28, label: 'PER', score: 0.93 }] },
  },
}) satisfies NerResponse;

describe('protocolos (6.11.8)', () => {
  it('INV-W07 un parcial y un progreso no llevan texto del documento: forma exacta de cada mensaje', () => {
    expect(esProgresoValido(progreso)).toBe(true);
    const p = parcial(2);
    expect(esParcialNerValido(p)).toBe(true);
    for (const m of [progreso, p]) expect(JSON.stringify(m)).not.toContain(TEXTO_DEL_DOCUMENTO);
    // todo valor de texto del parcial es un id, una etiqueta o el tipo de mensaje
    const textos: string[] = [];
    JSON.stringify(p, (_k, v) => { if (typeof v === 'string') textos.push(v); return v; });
    for (const t of textos) expect(RE_ID.test(t) || ETIQUETAS.includes(t) || t === 'parcial', t).toBe(true);
  });

  it('INV-W07 un campo extra, un texto o una forma distinta se rechazan', () => {
    const p = parcial(1);
    const conTexto = { ...p, payload: { ...p.payload, window: { ...p.payload.window, text: TEXTO_DEL_DOCUMENTO } } };
    const conTramoTexto = { ...p, payload: { ...p.payload, window: { ...p.payload.window,
      spans: [{ start: 0, end: 18, label: 'PER', score: 0.9, text: TEXTO_DEL_DOCUMENTO }] } } };
    const conEtiquetaLibre = { ...p, payload: { ...p.payload, window: { ...p.payload.window,
      spans: [{ start: 0, end: 18, label: TEXTO_DEL_DOCUMENTO, score: 0.9 }] } } };
    const sinPayload = { v: 1, reqId: REQ(1), kind: 'parcial' };
    for (const malo of [conTexto, conTramoTexto, conEtiquetaLibre, sinPayload]) {
      expect(esParcialNerValido(malo as Record<string, unknown>)).toBe(false);
    }
    expect(esProgresoValido({ ...progreso, detail: TEXTO_DEL_DOCUMENTO })).toBe(false);
    expect(esProgresoValido({ ...progreso, stage: TEXTO_DEL_DOCUMENTO })).toBe(false);
    expect(esProgresoValido({ ...progreso, reqId: 'Ana Ficticia Rojas.docx' })).toBe(false);
  });

  /** Traza de referencia: lo que un worker `ner` puede emitir para una petición `detectar`. */
  type Evento = { de: 'worker'; msg: NerResponse } | { de: 'hilo'; kind: 'cancelar'; targetReqId: RequestId };
  /** Protocolo de cancelación: tras `cancelar`, el worker no envía más `parcial`, `progreso` ni `resultado` de esa petición. */
  function violacionesDeCancelacion(traza: Evento[]): number {
    let cancelada = false;
    let violaciones = 0;
    for (const e of traza) {
      if (e.de === 'hilo') { cancelada = true; continue; }
      if (cancelada && (e.msg.kind === 'parcial' || e.msg.kind === 'progreso' || e.msg.kind === 'resultado')) violaciones++;
    }
    return violaciones;
  }
  /** Pliega la traza en el estado `modelo` del reductor: solo un `resultado` sin cancelación lo lleva a `terminado`. */
  function estadoModelo(traza: Evento[], total: number, causa: PlanBCause = 'cancelado'): ModelProgress {
    let ventanas = 0;
    let estado: ModelProgress = { kind: 'en_curso', ventanas: 0, ventanasTotales: total };
    let cancelado = false;
    for (const e of traza) {
      if (e.de === 'hilo') continue;
      if (e.msg.kind === 'parcial') { ventanas = e.msg.payload.windowsDone; estado = { kind: 'en_curso', ventanas, ventanasTotales: total }; }
      if (e.msg.kind === 'cancelado') cancelado = true;
      if (e.msg.kind === 'resultado' && !cancelado) estado = { kind: 'terminado', ventanas, respaldo: false };
    }
    if (cancelado) estado = { kind: 'plan_b', causa };   // efecto de la acción `declarar_plan_b`
    return estado;
  }

  const cancelado = { v: 1, reqId: REQ(1), kind: 'cancelado' } as const satisfies NerResponse;
  const cancelar: Evento = { de: 'hilo', kind: 'cancelar', targetReqId: REQ(1) };
  const w = (msg: NerResponse): Evento => ({ de: 'worker', msg });
  const resultado = (windows: number, ms: number): NerResponse =>
    ({ v: 1, reqId: REQ(1), kind: 'resultado', payload: { kind: 'detectar', windows, ms } });

  it('INV-W08 tras cancelar a mitad del documento, ner no envía más parcial y el estado modelo no pasa a terminado', () => {
    const traza: Evento[] = [w(parcial(1)), w(parcial(2)), w(parcial(3)), cancelar, w(cancelado)];
    expect(violacionesDeCancelacion(traza)).toBe(0);
    const estado = estadoModelo(traza, 5);
    expect(estado.kind).not.toBe('terminado');
    expect(estado).toEqual({ kind: 'plan_b', causa: 'cancelado' });
    // la acción posterior es declarar el plan B con la causa «cancelado»
    const accion = { kind: 'declarar_plan_b', causa: 'cancelado' } as const satisfies ReviewAction;
    expect(estadoModelo(traza, 5, accion.causa)).toEqual({ kind: 'plan_b', causa: accion.causa });
  });

  it('INV-W08 un parcial o un resultado posterior a cancelar es una violación y no deja el modelo terminado', () => {
    const conParcialTardio: Evento[] = [w(parcial(1)), cancelar, w(parcial(2)), w(cancelado)];
    expect(violacionesDeCancelacion(conParcialTardio)).toBe(1);
    const conResultadoTardio: Evento[] = [w(parcial(1)), cancelar, w(resultado(5, 31000)), w(cancelado)];
    expect(violacionesDeCancelacion(conResultadoTardio)).toBe(1);
    expect(estadoModelo(conResultadoTardio, 5).kind).toBe('plan_b');
    // sin cancelación, el resultado final sí termina el modelo
    const completa: Evento[] = [w(parcial(1, 1)), w(resultado(1, 6200))];
    expect(violacionesDeCancelacion(completa)).toBe(0);
    expect(estadoModelo(completa, 1)).toEqual({ kind: 'terminado', ventanas: 1, respaldo: false });
  });

  it('SiglowError no lleva contenido: message === code', () => {
    const e = new SiglowError('MODELO_INTEGRIDAD');
    expect(e.message).toBe('MODELO_INTEGRIDAD');
    expect(e.code).toBe('MODELO_INTEGRIDAD');
    expect(e).toBeInstanceOf(Error);
  });
});

describe('identificadores (6.1.4)', () => {
  it('la expresión de id casa con los ejemplos y rechaza los contraejemplos', () => {
    for (const ok of ['doc_00112233445566778899aabbccddeeff', 'asu_0123456789abcdef0123456789abcdef']) expect(RE_ID.test(ok), ok).toBe(true);
    for (const no of ['doc_00112233445566778899AABBCCDDEEFF', 'abc_00112233445566778899aabbccddeeff', 'doc_0011', 'doc-00112233445566778899aabbccddeeff']) {
      expect(RE_ID.test(no), no).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// PB-6 · worker `detect` real (INV-W01, INV-W02, INV-W05, INV-W07) e informe (6.8)

let contadorIds = 0;
const idsDeterministas: IdSource = { next: (p) => `${p}_${(++contadorIds).toString(16).padStart(32, '0')}` };
const DOC_ID = 'doc_' + 'c'.repeat(32) as DocId;
const TABLA_VACIA: TableIndex = { byKey: {}, counters: {}, documentCount: 0 };
const OPCIONES_DETECT = { referenceDate: '2026-10-30', rulesVersion: '1.0.0', nerHighThreshold: 0.9, nerMinScore: 0.3 };
const TEXTO_INFORME = 'El señor Pedro Prueba Ejemplo, C.C. 1000000001, recibió de la Ferretería Ficticia Ltda. un pago. '
  + 'Luego la señora Ana Ficticia Rojas firmó con Luisa Ejemplo Prueba el 14 de marzo de 2026, en Medellín. '
  + 'Contacto: pedro@ejemplo.test. Tel. 300 000 0001.';
const docDe = (text: string, partes = 1): DocumentModel => ({
  id: DOC_ID, label: 'Documento 1', source: 'txt', metadata: { categories: { propiedades_documento: { count: 3 }, personas: { count: 1 } } },
  warnings: [{ code: 'CARACTERES_CONTROL', count: 2 }, { code: 'CARACTERES_CONTROL', count: 1 }],
  parts: Array.from({ length: partes }, (_, i) => ({ id: PRT(i + 1), docId: DOC_ID, kind: i === 0 ? 'cuerpo' as const : 'encabezado' as const,
    label: i === 0 ? 'Cuerpo del documento' : `Encabezado ${i}`, order: i, index: i === 0 ? 1 : i, text: i === 0 ? text : `Encabezado ${i}`, included: i !== 1 })),
});
type Msg = { v: number; reqId: string; kind: string; code?: string; retryable?: boolean; payload?: unknown; [k: string]: unknown };
async function enviarA(h: ReturnType<typeof createDetectHandler>, data: unknown): Promise<Msg[]> {
  const out: Msg[] = [];
  await h(data, (m) => out.push(m as Msg));
  return out;
}
const peticion = (n: number, kind: string, payload: unknown): unknown => ({ v: 1, reqId: ID('req', n), kind, payload });
const tramoDe = (t: string, sub: string, label: NerSpan['label'], score: number): NerSpan => {
  const i = t.indexOf(sub);
  return { start: i, end: i + sub.length, label, score };
};

describe('worker detect (6.11.8)', () => {
  it('INV-W01 un mensaje error solo tiene v, reqId, kind, code y retryable, con cada fallo forzado', async () => {
    const h = createDetectHandler({ ids: idsDeterministas });
    const malos: unknown[] = [
      null, 'texto', [], { v: 2, reqId: ID('req', 1), kind: 'detectar', payload: {} }, { v: 1, reqId: 'req_zzz', kind: 'detectar', payload: {} },
      { v: 1, reqId: ID('req', 2), kind: 'inventado', payload: {} }, { v: 1, reqId: ID('req', 3), kind: 'detectar' },
      peticion(4, 'detectar', { sessionId: 's', doc: { id: 'x' }, caseList: [], table: TABLA_VACIA, options: OPCIONES_DETECT }),
      peticion(5, 'detectar', { sessionId: 's', doc: docDe(TEXTO_INFORME), caseList: [], table: TABLA_VACIA, options: { referenceDate: 'ayer' } }),
      peticion(6, 'fusionar', { sessionId: 'no_existe', ner: null, nerEngineId: 'nulo' }),
      peticion(7, 'cancelar', { targetReqId: 'no' }),
    ];
    for (const m of malos) {
      const r = await enviarA(h, m);
      expect(r).toHaveLength(1);
      const e = r[0] as Msg;
      expect(Object.keys(e).sort()).toEqual(['code', 'kind', 'reqId', 'retryable', 'v']);
      expect(e.kind).toBe('error');
      expect(e.v).toBe(1);
      expect(typeof e.retryable).toBe('boolean');
      expect(RE_ID.test(e.reqId) || e.reqId === 'req_' + '0'.repeat(32), e.reqId).toBe(true);
    }
    // un fallo interno (ids que lanzan) también sale solo con código
    const roto = createDetectHandler({ ids: { next: () => { throw new Error('falla interna'); } } });
    const r = await enviarA(roto, peticion(8, 'detectar', { sessionId: 's', doc: docDe(TEXTO_INFORME), caseList: [], table: TABLA_VACIA, options: OPCIONES_DETECT }));
    const e = r[r.length - 1] as Msg;
    expect(Object.keys(e).sort()).toEqual(['code', 'kind', 'reqId', 'retryable', 'v']);
    expect(e.code).toBe('ERROR_INTERNO');
    // MEMORIA es reintentable
    const sinMemoria = createDetectHandler({ ids: { next: () => { throw new RangeError('x'); } } });
    const m = await enviarA(sinMemoria, peticion(9, 'detectar', { sessionId: 's', doc: docDe(TEXTO_INFORME), caseList: [], table: TABLA_VACIA, options: OPCIONES_DETECT }));
    expect(m[m.length - 1]).toMatchObject({ kind: 'error', code: 'MEMORIA', retryable: true });
  });

  it('INV-W02 un fallo interno con texto del documento en la excepción no llega a la consola ni a ningún mensaje', async () => {
    const espias = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => undefined));
    try {
      for (const lanzar of [() => new Error('Ana Ficticia Rojas'), () => new RangeError('Ana Ficticia Rojas'), () => new SiglowError('ERROR_INTERNO')]) {
        const h = createDetectHandler({ ids: { next: () => { throw lanzar(); } } });
        const r = await enviarA(h, peticion(1, 'detectar', { sessionId: 's', doc: docDe(TEXTO_INFORME), caseList: [], table: TABLA_VACIA, options: OPCIONES_DETECT }));
        expect(JSON.stringify(r)).not.toContain('Ana Ficticia Rojas');
        expect(JSON.stringify(r)).not.toContain('Pedro Prueba');
        expect(r[r.length - 1]).toMatchObject({ kind: 'error' });
      }
      for (const e of espias) expect(e).not.toHaveBeenCalled();
    } finally {
      for (const e of espias) e.mockRestore();
    }
  });

  it('INV-W05 tras liberar, un fusionar posterior de la misma sesión recibe SESION_DESCONOCIDA', async () => {
    const h = createDetectHandler({ ids: idsDeterministas });
    const det = await enviarA(h, peticion(1, 'detectar', { sessionId: 'ses_a', doc: docDe(TEXTO_INFORME), caseList: [], table: TABLA_VACIA, options: OPCIONES_DETECT }));
    expect(det.some((x) => x.kind === 'resultado')).toBe(true);
    const ok = await enviarA(h, peticion(2, 'fusionar', { sessionId: 'ses_a', ner: null, nerEngineId: 'nulo' }));
    expect(ok[0]).toMatchObject({ kind: 'resultado' });
    expect(await enviarA(h, peticion(3, 'liberar', { sessionId: 'ses_a' }))).toEqual([{ v: 1, reqId: ID('req', 3), kind: 'resultado', payload: { kind: 'liberar' } }]);
    const tarde = await enviarA(h, peticion(4, 'fusionar', { sessionId: 'ses_a', ner: null, nerEngineId: 'nulo' }));
    expect(tarde).toEqual([{ v: 1, reqId: ID('req', 4), kind: 'error', code: 'SESION_DESCONOCIDA', retryable: false }]);
    // otra sesión sigue viva: liberar una no toca la otra
    await enviarA(h, peticion(5, 'detectar', { sessionId: 'ses_b', doc: docDe(TEXTO_INFORME), caseList: [], table: TABLA_VACIA, options: OPCIONES_DETECT }));
    await enviarA(h, peticion(6, 'detectar', { sessionId: 'ses_c', doc: docDe(TEXTO_INFORME), caseList: [], table: TABLA_VACIA, options: OPCIONES_DETECT }));
    await enviarA(h, peticion(7, 'liberar', { sessionId: 'ses_b' }));
    expect((await enviarA(h, peticion(8, 'fusionar', { sessionId: 'ses_c', ner: null, nerEngineId: 'nulo' })))[0]).toMatchObject({ kind: 'resultado' });
    expect((await enviarA(h, peticion(9, 'fusionar', { sessionId: 'ses_b', ner: null, nerEngineId: 'nulo' })))[0]).toMatchObject({ code: 'SESION_DESCONOCIDA' });
  });

  it('INV-W07 los progreso del worker detect tienen la forma exacta y ningún texto del documento', async () => {
    let t = 0;
    const h = createDetectHandler({ ids: idsDeterministas, now: () => (t += 500) });
    const r = await enviarA(h, peticion(1, 'detectar', { sessionId: 's', doc: docDe(TEXTO_INFORME, 3), caseList: [], table: TABLA_VACIA, options: OPCIONES_DETECT }));
    const avance = r.filter((m) => m.kind === 'progreso');
    expect(avance.length).toBeGreaterThan(0);
    for (const p of avance) {
      expect(esProgresoValido(p), JSON.stringify(p)).toBe(true);
      for (const palabra of ['Pedro', 'Prueba', 'Ficticia', 'ejemplo.test', '1000000001']) expect(JSON.stringify(p)).not.toContain(palabra);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Informe (6.8)

/** `exportGate` según 6.4.8 (el real es de PC-5): la prueba del informe no depende de él. */
const puertaAbierta: ExportGateFn = (state, residue, reminder) => {
  const reasons: GateReason[] = [];
  if (Object.values(state.detections).some((d) => d.status === 'pendiente')) reasons.push('PENDIENTES');
  if (Object.values(state.flags).some((f) => !f.acknowledged)) reasons.push('BANDERAS');
  if (state.modelo.kind === 'en_curso') reasons.push('MODELO_EN_CURSO');
  if (residue === null) reasons.push('RESIDUOS_NO_EJECUTADA');
  else {
    if (residue.revision !== state.revision) reasons.push('RESIDUOS_DESACTUALIZADA');
    if (residue.hits.length > 0) reasons.push('RESIDUOS_ENCONTRADOS');
    if (residue.newDetections > 0) reasons.push('DETECCIONES_NUEVAS');
  }
  if (!(reminder.biometricos && reminder.reservaLegal && reminder.estrategia)) reasons.push('RECORDATORIO');
  return { ok: reasons.length === 0, reasons };
};

const HASH = 'ab'.repeat(32);
const AHORA = new Date('2026-10-22T20:40:12.000Z');   // 15:40:12 en Colombia
const recordatorio = { biometricos: true, reservaLegal: true, estrategia: true };

interface Escenario { doc: DocumentModel; state: ReviewState; originales: string[]; ctx: ReviewContext }
/** Documento revisado de punta a punta: reglas, ventanas del modelo, decisiones del abogado y un rechazo. */
async function revisado(final: 'terminado' | PlanBCause, ventanasHechas = 3): Promise<Escenario> {
  const doc = docDe(TEXTO_INFORME, 3);
  const ctx: ReviewContext = { table: TABLA_VACIA, caseList: [], doc, ids: idsDeterministas };
  const h = createDetectHandler({ ids: idsDeterministas });
  const det = await enviarA(h, peticion(1, 'detectar', { sessionId: 's', doc, caseList: [], table: TABLA_VACIA, options: OPCIONES_DETECT }));
  const set = (det.find((m) => m.kind === 'resultado')!.payload as { set: DetectionSet & { spanEdits?: Array<{ id: string }> } }).set;
  const por = <T extends { id: string }>(xs: readonly T[]): Record<string, T> => Object.fromEntries(xs.map((x) => [x.id, x]));
  let st = { docId: doc.id, revision: 0, detections: por(set.detections), order: set.detections.map((d) => d.id), entities: por(set.entities),
    suggestions: por(set.suggestions), flags: por(set.flags), spanEdits: por(set.spanEdits ?? []), committed: false, modelo: modeloInicial(false) } as unknown as ReviewState;
  const ventanas: Array<Record<string, NerSpan[]>> = [
    { [PRT(1)]: [tramoDe(TEXTO_INFORME, 'Pedro Prueba Ejemplo', 'PER', 0.95), tramoDe(TEXTO_INFORME, 'Ferretería Ficticia', 'ORG', 0.8)] },
    { [PRT(1)]: [tramoDe(TEXTO_INFORME, 'Ana Ficticia Rojas', 'PER', 0.92)] },
    { [PRT(1)]: [tramoDe(TEXTO_INFORME, 'Luisa Ejemplo Prueba', 'PER', 0.5)] },
  ];
  for (let i = 0; i < Math.min(ventanasHechas, 3); i++) {
    const r = await enviarA(h, peticion(10 + i, 'fusionar', { sessionId: 's', ner: ventanas[i], nerEngineId: 'gliner-x-large', ventana: i + 1, ventanasTotales: 3 }));
    const delta = (r.find((m) => m.kind === 'resultado')!.payload as { set: DetectionSet }).set;
    const o = incorporarModelo(st, i + 1, 3, delta, ctx);
    if (!o.ok) throw new Error(o.code);
    st = o.state;
  }
  if (final !== 'terminado') {
    const o = declararPlanB(st, final, ctx);
    if (!o.ok) throw new Error(o.code);
    st = o.state;
  }
  const ferreteria = Object.values(st.detections).find((d) => d.text === 'Ferretería Ficticia');
  if (ferreteria !== undefined) {
    const o = applyReviewAction(st, { kind: 'rechazar', detectionId: ferreteria.id, reason: 'FALSO_POSITIVO' }, ctx);
    if (o.ok) st = o.state;
  }
  for (const e of Object.values(st.entities)) {
    if (Object.values(st.detections).some((d) => d.entityId === e.id && d.status === 'pendiente')) {
      const o = applyReviewAction(st, { kind: 'aceptar_entidad', entityId: e.id }, ctx);
      if (o.ok) st = o.state;
    }
  }
  return { doc, state: st, ctx, originales: Object.values(st.detections).map((d) => d.text) };
}
const residuoDe = (st: ReviewState) => ({ revision: st.revision, ranAt: '2026-10-22T20:39:58.000Z', valuesSearched: 24,
  modes: ['literal', 'normalizado', 'digitos', 'variante'] as Array<'literal' | 'normalizado' | 'digitos' | 'variante'>, hits: [], newDetections: 0 });
const entradaInforme = (e: Escenario, extra: Record<string, unknown> = {}) => ({
  doc: e.doc, state: e.state, residue: residuoDe(e.state), reminder: recordatorio, caseList: [],
  app: { version: '1.0.0', compilacion: HASH }, rulesVersion: '1.0.0', modelo: { id: 'gliner-x-large', sha256: HASH }, now: AHORA, ...extra,
});
const hojas = (x: unknown, ruta = ''): Array<[string, unknown]> =>
  Array.isArray(x) ? x.flatMap((v, i) => hojas(v, `${ruta}[${i}]`))
    : typeof x === 'object' && x !== null ? Object.entries(x).flatMap(([k, v]) => hojas(v, `${ruta}.${k}`)) : [[ruta, x]];

describe('informe de anonimización (6.8)', () => {
  it('INV-I01 y INV-G04 ningún original aparece en el informe: ni literal, ni en vista lista, ni en vista dígitos, ni en el texto legible', async () => {
    const e = await revisado('terminado');
    const informe = buildReport(entradaInforme(e), { exportGate: puertaAbierta });
    const json = reportToJson(informe);
    const txt = reportToText(informe);
    const plegar = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    expect(e.originales.length).toBeGreaterThanOrEqual(6);
    for (const t of new Set([...e.originales, ...Object.values(e.state.entities).map((x) => x.display)])) {
      if (t.length < 4) continue;
      for (const salida of [json, txt]) {
        expect(salida, t).not.toContain(t);
        if (t.includes(' ')) expect(plegar(salida), t).not.toContain(plegar(t));
        const digitos = t.replace(/\D/gu, '');
        if (digitos.length >= 7) expect(salida.replace(/\D/gu, ''), t).not.toContain(digitos);
      }
    }
    for (const palabra of ['Pedro', 'Ficticia', 'ejemplo.test', 'Luisa', 'Medellín']) { expect(json).not.toContain(palabra); expect(txt).not.toContain(palabra); }
  });

  it('INV-I02 INV-G04 INV-G11 toda cadena del JSON pertenece a una lista permitida; sin la casilla, asunto no existe', async () => {
    const e = await revisado('terminado');
    const permitidas = new Set<string>([
      'sig-low/informe', 'usado', 'respaldo_base', 'no_descargado', 'desactivado', 'fallo_carga', 'memoria_insuficiente', 'cancelado', 'sin_tiempo',
      ...DATA_TYPES, ...MARKER_FAMILIES, ...FLAG_TYPES, 'manual', 'lista', 'regla', 'modelo', 'alta', 'media', 'baja',
      'literal', 'normalizado', 'digitos', 'variante', 'sin_residuos', 'pegado', 'txt', 'docx', 'pdf',
      'encabezado', 'cuerpo', 'pie', 'nota_pie', 'nota_final', 'comentario', 'anotacion_pdf', 'pagina_pdf',
      'SIN_MOTIVO', 'FALSO_POSITIVO', 'DATO_PUBLICO', 'CITA_JURISPRUDENCIAL', 'NECESARIO_ANALISIS', 'OTRO',
      'FECHA_A_MES_ANIO', 'FECHA_NACIMIENTO_A_RANGO_EDAD', 'EDAD_A_RANGO', 'ROTULO_DOCUMENTO_A_GENERICO', 'MUNICIPIO_A_DEPARTAMENTO', 'DESPACHO_A_GENERICO',
      ...(Object.keys(ETIQUETA_DE_METADATO) as MetadataCategory[]),
      ...(['CODIFICACION_ALTERNATIVA', 'CARACTERES_CONTROL', 'TEXTO_OCULTO_INCLUIDO', 'PAGINA_SIN_TEXTO'] satisfies ParseWarningCode[]),
    ]);
    const patrones = [/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-05:00$/u, /^\d+\.\d+\.\d+$/u, /^[0-9a-f]{64}$/u, /^gliner-x-(?:large|base)$/u,
      /^Documento \d+$/u, /^(?:Cuerpo del documento|Texto pegado|Encabezado \d+|Pie de página \d+|Nota al pie \d+|Nota al final \d+|Comentario \d+|Página \d+)$/u];
    const informe = buildReport(entradaInforme(e), { exportGate: puertaAbierta });
    expect(informe.asunto).toBeUndefined();
    expect('asunto' in informe).toBe(false);
    for (const [ruta, v] of hojas(informe)) {
      if (typeof v === 'string') expect(permitidas.has(v) || patrones.some((p) => p.test(v)), `${ruta} = ${v}`).toBe(true);
    }
    // con la casilla marcada, el código del asunto entra y solo ahí
    const con = buildReport(entradaInforme(e, { asunto: { codigo: 'ASUNTO-PRUEBA-001' }, incluirCodigoAsunto: true }), { exportGate: puertaAbierta });
    expect(con.asunto).toEqual({ codigo: 'ASUNTO-PRUEBA-001' });
    const sin = buildReport(entradaInforme(e, { asunto: { codigo: 'ASUNTO-PRUEBA-001' }, incluirCodigoAsunto: false }), { exportGate: puertaAbierta });
    expect(JSON.stringify(sin)).not.toContain('ASUNTO-PRUEBA-001');
    expect(reportToText(sin)).not.toContain('ASUNTO-PRUEBA-001');
    // una etiqueta que no es neutra (p. ej. el nombre de un archivo) nunca pasa al informe
    const sucio = { ...e.doc, label: 'Documento 1', parts: e.doc.parts.map((p, i) => i === 2 ? { ...p, label: 'Ana Ficticia Rojas.docx' } : p) };
    const limpio = buildReport(entradaInforme({ ...e, doc: sucio }), { exportGate: puertaAbierta });
    expect(JSON.stringify(limpio)).not.toContain('Ficticia');
  });

  it('INV-I03 el informe solo se genera con exportGate.ok y residuos.resultado es siempre sin_residuos', async () => {
    const e = await revisado('terminado');
    const cerrada: ExportGateFn = () => ({ ok: false, reasons: ['PENDIENTES'] });
    expect(() => buildReport(entradaInforme(e), { exportGate: cerrada })).toThrow(SiglowError);
    try { buildReport(entradaInforme(e), { exportGate: cerrada }); } catch (x) { expect((x as SiglowError).code).toBe('ENTRADA_INVALIDA'); }
    // sin búsqueda de residuos, con residuos desactualizados o sin recordatorio, la puerta (6.4.8) se cierra y no hay informe
    expect(() => buildReport(entradaInforme(e, { residue: null }), { exportGate: puertaAbierta })).toThrow(SiglowError);
    expect(() => buildReport(entradaInforme(e, { residue: { ...residuoDe(e.state), revision: e.state.revision - 1 } }), { exportGate: puertaAbierta })).toThrow(SiglowError);
    expect(() => buildReport(entradaInforme(e, { reminder: { ...recordatorio, estrategia: false } }), { exportGate: puertaAbierta })).toThrow(SiglowError);
    const ok = buildReport(entradaInforme(e), { exportGate: puertaAbierta });
    expect(ok.residuos.resultado).toBe('sin_residuos');
    expect(ok.residuos).toEqual({ resultado: 'sin_residuos', valoresBuscados: 24, modos: ['literal', 'normalizado', 'digitos', 'variante'], ejecutada: '2026-10-22T15:39:58-05:00' });
    expect(ok.generado).toBe('2026-10-22T15:40:12-05:00');
    expect(ok.recordatorio).toEqual({ biometricos: true, reservaLegal: true, estrategia: true, confirmado: '2026-10-22T15:40:12-05:00' });
    // aun con una puerta mal implementada, un informe con pendientes no se construye
    const pendiente = JSON.parse(JSON.stringify(e.state)) as ReviewState;
    Object.values(pendiente.detections)[0]!.status = 'pendiente';
    expect(() => buildReport(entradaInforme({ ...e, state: pendiente }), { exportGate: () => ({ ok: true, reasons: [] }) })).toThrow(SiglowError);
  });

  it('INV-I04 motor.modelo.planB es true si y solo si el estado no es usado ni respaldo_base; el informe nunca calla un plan B', async () => {
    // modelo terminado
    const t = await revisado('terminado');
    const a = buildReport(entradaInforme(t), { exportGate: puertaAbierta });
    expect(a.motor.modelo).toMatchObject({ estado: 'usado', planB: false, id: 'gliner-x-large', ventanas: 3, ventanasTotales: 3 });
    // modelo de respaldo (x-base) terminado
    const r = { ...t, state: { ...t.state, modelo: { kind: 'terminado', ventanas: 5, respaldo: true } } as ReviewState };
    const b = buildReport(entradaInforme(r, { modelo: { id: 'gliner-x-base', sha256: HASH } }), { exportGate: puertaAbierta });
    expect(b.motor.modelo).toMatchObject({ estado: 'respaldo_base', planB: false, ventanas: 5, ventanasTotales: 5 });
    // cancelado con «Seguir sin el modelo» a mitad del documento: 3 de 23
    const c = await revisado('cancelado', 2);
    const ic = buildReport(entradaInforme(c, { avanceDelModelo: { ventanas: 3, ventanasTotales: 23 } }), { exportGate: puertaAbierta });
    expect(ic.motor.modelo).toMatchObject({ estado: 'cancelado', planB: true, ventanas: 3, ventanasTotales: 23 });
    expect(ic.motor.modelo.ventanas!).toBeLessThan(ic.motor.modelo.ventanasTotales!);
    // MEMORIA forzada: la causa es memoria_insuficiente
    const m = await revisado('memoria_insuficiente', 2);
    const im = buildReport(entradaInforme(m, { avanceDelModelo: { ventanas: 2, ventanasTotales: 9 } }), { exportGate: puertaAbierta });
    expect(im.motor.modelo).toMatchObject({ estado: 'memoria_insuficiente', planB: true });
    // plan B sin avance conocido: ventanas ausentes (nunca ventanas === ventanasTotales con plan B)
    const ia = buildReport(entradaInforme(m), { exportGate: puertaAbierta });
    expect(ia.motor.modelo.planB).toBe(true);
    expect(ia.motor.modelo.ventanas).toBeUndefined();
    const incoherente = buildReport(entradaInforme(m, { avanceDelModelo: { ventanas: 9, ventanasTotales: 9 } }), { exportGate: puertaAbierta });
    expect(incoherente.motor.modelo.ventanas).toBeUndefined();
    // la biimplicación, con las seis causas
    for (const causa of ['no_descargado', 'desactivado', 'fallo_carga', 'memoria_insuficiente', 'cancelado', 'sin_tiempo'] as PlanBCause[]) {
      const e = await revisado(causa, 1);
      const inf = buildReport(entradaInforme(e, { avanceDelModelo: { ventanas: 1, ventanasTotales: 3 } }), { exportGate: puertaAbierta });
      expect(inf.motor.modelo.planB, causa).toBe(true);
      expect(inf.motor.modelo.estado, causa).toBe(causa);
      expect(reportToText(inf), causa).toContain('Modelo de apoyo: no se completó (');
      expect(reportToText(inf), causa).toContain('La revisión se apoyó solo en las reglas y en la lista del caso.');
    }
    expect(reportToText(a)).not.toContain('no se completó');
    // con el modelo en curso no hay informe
    const enCurso = { ...t, state: { ...t.state, modelo: { kind: 'en_curso', ventanas: 1, ventanasTotales: 3 } } as ReviewState };
    expect(() => buildReport(entradaInforme(enCurso), { exportGate: () => ({ ok: true, reasons: [] }) })).toThrow(SiglowError);
  });

  it('INV-I05 detectadas = aceptadas + editadas + rechazadas por tipo (sin pendientes al generar)', async () => {
    const e = await revisado('terminado');
    // una edición del revisor entra como «editadas»
    const luisa = Object.values(e.state.detections).find((d) => d.text === 'Luisa Ejemplo Prueba')!;
    const ed = applyReviewAction(e.state, { kind: 'editar', detectionId: luisa.id, text: 'la otra firmante' }, e.ctx);
    expect(ed.ok).toBe(true);
    const state = ed.ok ? ed.state : e.state;
    const informe = buildReport(entradaInforme({ ...e, state }), { exportGate: puertaAbierta });
    expect(informe.conteos.length).toBeGreaterThan(3);
    let total = 0;
    for (const c of informe.conteos) {
      expect(c.detectadas, c.tipo).toBe(c.aceptadas + c.editadas + c.rechazadas);
      expect(c.porFuente.manual + c.porFuente.lista + c.porFuente.regla + c.porFuente.modelo, c.tipo).toBe(c.detectadas);
      expect(c.porConfianza.alta + c.porConfianza.media + c.porConfianza.baja, c.tipo).toBe(c.detectadas);
      total += c.detectadas;
    }
    expect(total).toBe(Object.keys(state.detections).length);
    expect(informe.conteos.find((c) => c.tipo === 'PERSONA')!.editadas).toBe(1);
    expect(informe.conteos.find((c) => c.tipo === 'EMPRESA')!.rechazadas).toBe(1);
    expect(informe.rechazos).toEqual([{ tipo: 'EMPRESA', motivo: 'FALSO_POSITIVO', cantidad: 1 }]);
    expect(informe.aCriterio.rechazadas).toBe(1);
    expect(informe.aprobacionesPorGrupo).toBeGreaterThan(0);
    expect(informe.advertencias).toEqual([{ codigo: 'CARACTERES_CONTROL', cantidad: 3 }]);
    expect(informe.metadatos.categorias).toEqual(['personas', 'propiedades_documento']);
    expect(informe.documento.partes.map((p) => p.incluida)).toEqual([true, false, true]);
    expect(informe.marcadores.length).toBeGreaterThan(2);
    for (const f of informe.marcadores) expect(f.distintos).toBe(f.nuevos + f.heredados);
  });

  it('INV-I06 la versión legible: título, secciones en orden, BOM y CRLF, y ninguna expresión de textos prohibidos (8.5)', async () => {
    const e = await revisado('cancelado', 2);
    const informe = buildReport(entradaInforme(e, { avanceDelModelo: { ventanas: 2, ventanasTotales: 23 } }), { exportGate: puertaAbierta });
    const txt = reportToText(informe);
    expect(txt.startsWith('﻿INFORME DE ANONIMIZACIÓN · Sig-Low 1.0.0\r\n')).toBe(true);
    expect(txt.endsWith('\r\n')).toBe(true);
    expect(txt.replace(/\r\n/gu, '')).not.toMatch(/[\r\n]/u);
    const orden = ['DATOS REEMPLAZADOS', 'LO QUE USTED RECHAZÓ', 'LO QUE QUEDÓ A SU CRITERIO', 'BÚSQUEDA DE RESIDUOS',
      'METADATOS DEL ARCHIVO ORIGINAL (no se copian a la salida)', 'RECORDATORIO CONFIRMADO', 'Este informe no contiene los datos originales.'];
    let pos = -1;
    for (const s of orden) { const i = txt.indexOf(s); expect(i, s).toBeGreaterThan(pos); pos = i; }
    expect(txt).toContain('Fecha: 2026-10-22 15:40 (hora de Colombia)');
    expect(txt).toContain('No se encontraron en la salida los 24 valores buscados');
    expect(txt).toContain('usted decidió seguir sin él');
    expect(txt).toContain('Cédula de ciudadanía · 1 · 1 · 0 · 0');
    // 8.5: textos prohibidos
    const sinAcento = txt.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    expect(sinAcento).not.toMatch(/garantiz|garantia|100\s*%|cien por ciento|totalmente anonim|completamente anonim|sin riesgo|\bsegur(o|a|os|as|idad)\b|infalible|a prueba de|dato falso/u);
    expect(txt).not.toMatch(/\b(ChatGPT|OpenAI|GPT-?\d+(\.\d+)?o?|Gemini|Bard|Copilot|Bing|Claude|Anthropic|Llama|Meta AI|Mistral|Perplexity|DeepSeek|Grok|xAI|Qwen|Hugging Face|Microsoft|Windows|Word|Google|Chrome|Edge|Firefox|Safari|Apple)\b/u);
  });
});
