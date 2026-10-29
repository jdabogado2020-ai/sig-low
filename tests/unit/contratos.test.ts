// T-MO-10 (parte P0-1): invariantes de las enumeraciones (6.2.5) y de los protocolos (6.11.8: INV-W07 e INV-W08).
// Los datos son ficticios. INV-W07 e INV-W08 se comprueban aquí contra el contrato de tipos con un validador y una traza de
// referencia; PB-6 los repite contra el worker `ner` real con las mismas funciones de validación.
import { describe, expect, it } from 'vitest';
import {
  DATA_TYPES, FLAG_TYPES, MARKER_FAMILIES, MARKER_LABEL, SiglowError,
  type DetectableType, type FamilyForFn, type MarkerFamily, type ModelProgress, type NerResponse, type PartId,
  type PlanBCause, type RequestId, type ReviewAction,
} from '../../src/core/types';

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
