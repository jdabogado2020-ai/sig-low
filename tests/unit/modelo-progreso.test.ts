// T-MO-12 (parte PB-6) · Resultados por ventana del modelo: `incorporar_modelo` sin tocar lo decidido (INV-R12), `declarar_plan_b`,
// `fusionar` con `ventana` que devuelve solo el delta, `parcial` sin repetidos entre ventanas (INV-W06), cancelación (INV-W08) y la regla
// de progreso de 6.11.1 (máximo 10 mensajes por segundo). `exportGate` con `MODELO_EN_CURSO` (INV-R11) es de PC-5. Datos ficticios.
import { describe, expect, it } from 'vitest';
import { applyReviewAction } from '../../src/core/entities';
import { createDetectHandler, ProgressLimiter } from '../../src/core/pipeline';
import { declararPlanB, incorporarModelo, modeloInicial } from '../../src/core/review/modelo';
import type {
  DetectionSet, DocId, DocumentModel, IdSource, NerSpan, PartId, PlanBCause, ReviewState, TableIndex,
} from '../../src/core/types';
import type { ReviewContext } from '../../src/core/entities';

let contador = 0;
const ids: IdSource = { next: (p) => `${p}_${(++contador).toString(16).padStart(32, '0')}` };
const REQ = (n: number): string => `req_${n.toString(16).padStart(32, '0')}`;
const DOC = 'doc_' + 'a'.repeat(32) as DocId;
const PRT = (n: number): PartId => `prt_${n.toString(16).padStart(32, '0')}` as PartId;
const TABLA: TableIndex = { byKey: {}, counters: {}, documentCount: 0 };
const OPCIONES = { referenceDate: '2026-10-30', rulesVersion: '1.0.0', nerHighThreshold: 0.9, nerMinScore: 0.3 };

const TEXTO = 'El señor Pedro Prueba Ejemplo, C.C. 1000000001, recibió de la Ferretería Ficticia Ltda. un pago. '
  + 'Luego la señora Ana Ficticia Rojas firmó con Luisa Ejemplo Prueba el 14 de marzo de 2026, en Medellín. '
  + 'Contacto: pedro@ejemplo.test.';

function documento(textos: string[] = [TEXTO]): DocumentModel {
  return {
    id: DOC, label: 'Documento 1', source: 'pegado', metadata: { categories: {} }, warnings: [],
    parts: textos.map((text, i) => ({ id: PRT(i + 1), docId: DOC, kind: 'cuerpo' as const, label: i === 0 ? 'Texto pegado' : `Encabezado ${i}`,
      order: i, index: i + 1, text, included: true })),
  };
}
const tramo = (texto: string, sub: string, label: NerSpan['label'], score: number, desde = 0): NerSpan => {
  const i = texto.indexOf(sub, desde);
  if (i < 0) throw new Error(`falta «${sub}»`);
  return { start: i, end: i + sub.length, label, score };
};

type Mensaje = { v: number; reqId: string; kind: string; [k: string]: unknown };
interface Banco { h: ReturnType<typeof createDetectHandler>; enviar(kind: string, payload: unknown): Promise<Mensaje[]> }
function banco(deps: Parameters<typeof createDetectHandler>[0] = {}): Banco {
  const h = createDetectHandler({ ids, ...deps });
  let n = 0;
  return {
    h,
    async enviar(kind, payload) {
      const out: Mensaje[] = [];
      await h({ v: 1, reqId: REQ(++n), kind, payload }, (m) => out.push(m as Mensaje));
      return out;
    },
  };
}
const resultado = <T>(out: Mensaje[]): T => {
  const r = out.find((m) => m.kind === 'resultado');
  if (r === undefined) throw new Error('sin resultado: ' + JSON.stringify(out.map((m) => m.kind === 'error' ? m.code : m.kind)));
  return r.payload as T;
};
type Fusion = { kind: 'fusionar'; set: DetectionSet; ventana?: number };

async function arrancar(textos?: string[]) {
  const doc = documento(textos);
  const b = banco();
  const det = resultado<{ kind: 'detectar'; set: DetectionSet & { spanEdits?: [] } }>(await b.enviar('detectar',
    { sessionId: 'ses_1', doc, caseList: [], table: TABLA, options: OPCIONES }));
  return { b, doc, set: det.set };
}
function estadoDe(doc: DocumentModel, set: DetectionSet & { spanEdits?: Array<{ id: string }> }): ReviewState {
  const por = <T extends { id: string }>(xs: readonly T[]): Record<string, T> => Object.fromEntries(xs.map((x) => [x.id, x]));
  return {
    docId: doc.id, revision: 0, detections: por(set.detections), order: set.detections.map((d) => d.id), entities: por(set.entities),
    suggestions: por(set.suggestions), flags: por(set.flags), spanEdits: por(set.spanEdits ?? []), committed: false,
    modelo: modeloInicial(false),
  } as unknown as ReviewState;
}
const ctxDe = (doc: DocumentModel): ReviewContext => ({ table: TABLA, caseList: [], doc, ids });
const bien = (o: ReturnType<typeof applyReviewAction>): ReviewState => {
  if (!o.ok) throw new Error('rechazada: ' + o.code);
  return o.state;
};
async function ventana(b: Banco, n: number, total: number, ner: Record<string, NerSpan[]>): Promise<DetectionSet> {
  return resultado<Fusion>(await b.enviar('fusionar', { sessionId: 'ses_1', ner, nerEngineId: 'gliner-x-large', ventana: n, ventanasTotales: total })).set;
}

describe('T-MO-12 · incorporar_modelo (INV-R12)', () => {
  it('INV-R12 incorporar_modelo no modifica lo existente, no crea detecciones aceptadas y no duplica una ventana repetida', async () => {
    const { b, doc, set } = await arrancar();
    const ctx = ctxDe(doc);
    let st = estadoDe(doc, set);
    const cc = Object.values(st.detections).find((d) => d.type === 'CC');
    expect(cc).toBeDefined();
    st = bien(applyReviewAction(st, { kind: 'aceptar', detectionId: cc!.id }, ctx));
    const antes = structuredClone(st);

    const w1 = await ventana(b, 1, 3, { [PRT(1)]: [tramo(TEXTO, 'Pedro Prueba Ejemplo', 'PER', 0.95), tramo(TEXTO, 'Ferretería Ficticia', 'ORG', 0.8)] });
    expect(w1.detections.map((d) => d.text).sort()).toEqual(['Ferretería Ficticia', 'Pedro Prueba Ejemplo']);
    const s1 = bien(incorporarModelo(st, 1, 3, w1, ctx));

    for (const [id, d] of Object.entries(antes.detections)) expect(s1.detections[id as keyof typeof s1.detections], id).toEqual(d);
    for (const [id, f] of Object.entries(antes.flags)) expect(s1.flags[id as keyof typeof s1.flags]).toEqual(f);
    for (const [id, x] of Object.entries(antes.suggestions)) expect(s1.suggestions[id as keyof typeof s1.suggestions]).toEqual(x);
    expect(s1.spanEdits).toEqual(antes.spanEdits);
    const nuevas = Object.values(s1.detections).filter((d) => antes.detections[d.id] === undefined);
    expect(nuevas).toHaveLength(2);
    for (const d of nuevas) { expect(d.status).toBe('pendiente'); expect(d.source).toBe('modelo'); }
    expect(Object.values(s1.detections).filter((d) => d.source === 'modelo' && d.status === 'aceptada')).toHaveLength(0);
    expect(s1.revision).toBe(antes.revision + 1);
    expect(s1.modelo).toEqual({ kind: 'en_curso', ventanas: 1, ventanasTotales: 3 });

    // La misma ventana otra vez: se ignora, sin error y sin sumar revision.
    const otra = bien(incorporarModelo(s1, 1, 3, w1, ctx));
    expect(otra).toEqual(s1);
    expect(otra.revision).toBe(s1.revision);

    // Dos ventanas con solape: el nombre del solape no se repite en el delta (tramo ya emitido) y, si llegara repetido con otro id, no se duplica.
    const w2 = await ventana(b, 2, 3, { [PRT(1)]: [tramo(TEXTO, 'Pedro Prueba Ejemplo', 'PER', 0.95), tramo(TEXTO, 'Ana Ficticia Rojas', 'PER', 0.92)] });
    expect(w2.detections.map((d) => d.text)).toEqual(['Ana Ficticia Rojas']);
    const s2 = bien(incorporarModelo(s1, 2, 3, w2, ctx));
    const reenviada = bien(incorporarModelo(s2, 3, 3, w1, ctx));   // la ventana 1 llega de nuevo, ya como «3»: sus detecciones no se duplican
    expect(Object.keys(reenviada.detections)).toHaveLength(Object.keys(s2.detections).length);
    const textos = Object.values(reenviada.detections).filter((d) => d.source === 'modelo').map((d) => d.text);
    expect(new Set(textos).size).toBe(textos.length);
    expect(reenviada.modelo).toEqual({ kind: 'terminado', ventanas: 3, respaldo: false });
  });

  it('INV-R12 con detecciones ya aceptadas y sugerencias ya descartadas, la ventana siguiente las deja como estaban', async () => {
    const { b, doc, set } = await arrancar();
    const ctx = ctxDe(doc);
    let st = estadoDe(doc, set);
    const w1 = await ventana(b, 1, 3, { [PRT(1)]: [tramo(TEXTO, 'Ferretería Ficticia', 'ORG', 0.8)] });
    st = bien(incorporarModelo(st, 1, 3, w1, ctx));
    const ferreteria = Object.values(st.detections).find((d) => d.text === 'Ferretería Ficticia')!;
    st = bien(applyReviewAction(st, { kind: 'aceptar', detectionId: ferreteria.id }, ctx));
    const sug = Object.values(st.suggestions)[0];
    expect(sug, 'la fecha ficticia genera una sugerencia').toBeDefined();
    st = bien(applyReviewAction(st, { kind: 'descartar_sugerencia', suggestionId: sug!.id }, ctx));
    const antes = structuredClone(st);

    const w2 = await ventana(b, 2, 3, { [PRT(1)]: [tramo(TEXTO, 'Luisa Ejemplo Prueba', 'PER', 0.7)] });
    const s2 = bien(incorporarModelo(st, 2, 3, w2, ctx));
    expect(s2.detections[ferreteria.id]).toEqual(antes.detections[ferreteria.id]);
    expect(s2.detections[ferreteria.id]?.status).toBe('aceptada');
    expect(s2.suggestions[sug!.id]?.status).toBe('descartada');
    expect(s2.modelo).toEqual({ kind: 'en_curso', ventanas: 2, ventanasTotales: 3 });
  });

  it('INV-R12 un tramo del modelo sobre uno rechazado, o que se solapa con una detección no rechazada, se descarta', async () => {
    const { b, doc, set } = await arrancar();
    const ctx = ctxDe(doc);
    let st = estadoDe(doc, set);
    const w1 = await ventana(b, 1, 4, { [PRT(1)]: [tramo(TEXTO, 'Ana Ficticia Rojas', 'PER', 0.92)] });
    st = bien(incorporarModelo(st, 1, 4, w1, ctx));
    const ana = Object.values(st.detections).find((d) => d.text === 'Ana Ficticia Rojas')!;
    st = bien(applyReviewAction(st, { kind: 'rechazar', detectionId: ana.id, reason: 'FALSO_POSITIVO' }, ctx));

    // «Ana Ficticia Rojas» vuelve en una ventana posterior con otro id: no revive lo rechazado.
    const delta: DetectionSet = {
      detections: [{ ...structuredClone(ana), id: ids.next('det') as typeof ana.id, status: 'pendiente' }], entities: [], suggestions: [], flags: [],
    };
    delete (delta.detections[0] as { rejectReason?: unknown }).rejectReason;
    const s2 = bien(incorporarModelo(st, 2, 4, delta, ctx));
    expect(Object.values(s2.detections).filter((d) => d.text === 'Ana Ficticia Rojas')).toHaveLength(1);
    expect(s2.detections[ana.id]?.status).toBe('rechazada');

    // Una detección manual no rechazada sobre «Luisa Ejemplo»: el modelo propone «Luisa Ejemplo Prueba» (se solapa) y se descarta.
    const luisa = TEXTO.indexOf('Luisa Ejemplo');
    const s3 = bien(applyReviewAction(s2, { kind: 'agregar_manual', span: { partId: PRT(1), start: luisa, end: luisa + 13 }, type: 'PERSONA', propagate: false }, ctx));
    const w3 = await ventana(b, 3, 4, { [PRT(1)]: [tramo(TEXTO, 'Luisa Ejemplo Prueba', 'PER', 0.92)] });
    const s4 = bien(incorporarModelo(s3, 3, 4, w3, ctx));
    expect(Object.values(s4.detections).filter((d) => d.text.includes('Luisa'))).toHaveLength(1);
  });
});

describe('T-MO-12 · declarar_plan_b', () => {
  const causas: PlanBCause[] = ['no_descargado', 'desactivado', 'fallo_carga', 'memoria_insuficiente', 'cancelado', 'sin_tiempo'];

  it.each(causas)('declarar_plan_b con la causa «%s»: fija el plan B, conserva las ventanas incorporadas y ya no admite ventanas', async (causa) => {
    const { b, doc, set } = await arrancar();
    const ctx = ctxDe(doc);
    let st = estadoDe(doc, set);
    const w1 = await ventana(b, 1, 4, { [PRT(1)]: [tramo(TEXTO, 'Pedro Prueba Ejemplo', 'PER', 0.95)] });
    st = bien(incorporarModelo(st, 1, 4, w1, ctx));
    const antes = Object.keys(st.detections).length;
    const p = bien(declararPlanB(st, causa, ctx));
    expect(p.modelo).toEqual({ kind: 'plan_b', causa });
    expect(p.revision).toBe(st.revision + 1);
    expect(Object.keys(p.detections)).toHaveLength(antes);   // las ventanas incorporadas se conservan
    const w2 = await ventana(b, 2, 4, { [PRT(1)]: [tramo(TEXTO, 'Ana Ficticia Rojas', 'PER', 0.9)] });
    const despues = bien(incorporarModelo(p, 2, 4, w2, ctx));
    expect(despues).toEqual(p);   // se ignora sin error y sin sumar revision
    const dos = declararPlanB(p, causa, ctx);
    expect(dos).toEqual({ ok: false, code: 'TIPO_NO_PERMITIDO' });
  });

  it('declarar_plan_b solo vale con el modelo en curso (terminado o ya en plan B: TIPO_NO_PERMITIDO) y la última ventana lo termina', async () => {
    const { doc, set } = await arrancar();
    const ctx = ctxDe(doc);
    const st = estadoDe(doc, set);
    const vacio: DetectionSet = { detections: [], entities: [], suggestions: [], flags: [] };
    const t = bien(incorporarModelo(st, 3, 3, vacio, ctx));
    expect(t.modelo).toEqual({ kind: 'terminado', ventanas: 3, respaldo: false });
    expect(declararPlanB(t, 'cancelado', ctx)).toEqual({ ok: false, code: 'TIPO_NO_PERMITIDO' });
    expect(modeloInicial(true)).toEqual({ kind: 'plan_b', causa: 'desactivado' });
    expect(modeloInicial(false)).toEqual({ kind: 'en_curso', ventanas: 0, ventanasTotales: 0 });
  });
});

describe('T-MO-12 · fusionar por ventana (6.11.2)', () => {
  it('fusionar con `ventana` devuelve solo el delta de esa ventana; una ventana repetida devuelve un delta vacío', async () => {
    const { b, set } = await arrancar();
    const reglas = new Set(set.detections.map((d) => d.id));
    expect(reglas.size).toBeGreaterThan(0);
    const w1 = await ventana(b, 1, 3, { [PRT(1)]: [tramo(TEXTO, 'Pedro Prueba Ejemplo', 'PER', 0.95)] });
    expect(w1.detections).toHaveLength(1);
    expect(w1.detections[0]?.source).toBe('modelo');
    expect(w1.detections[0]?.status).toBe('pendiente');
    for (const d of w1.detections) expect(reglas.has(d.id)).toBe(false);
    expect(w1.entities.map((e) => e.canonicalKey)).toEqual(['PER:pedro prueba ejemplo']);
    const w1bis = await ventana(b, 1, 3, { [PRT(1)]: [tramo(TEXTO, 'Pedro Prueba Ejemplo', 'PER', 0.95)] });
    expect(w1bis).toEqual({ detections: [], entities: [], flags: [], suggestions: [] });
    // Un nombre del solape que otra ventana repite no vuelve a salir.
    const w2 = await ventana(b, 2, 3, { [PRT(1)]: [tramo(TEXTO, 'Pedro Prueba Ejemplo', 'PER', 0.95), tramo(TEXTO, 'Luisa Ejemplo Prueba', 'PER', 0.95)] });
    expect(w2.detections.map((d) => d.text)).toEqual(['Luisa Ejemplo Prueba']);
  });

  it('fusionar aplica 7.10.8 y 7.10.9: bandas de confianza, piso de puntaje, mapeo de etiquetas y marcadores', async () => {
    const t = TEXTO.replace('Ana Ficticia Rojas', 'ana ficticia rojas').replace('en Medellín', 'hacia Envigado');
    const doc = documento([t]);
    const c = banco();
    await c.enviar('detectar', { sessionId: 'ses_1', doc, caseList: [], table: TABLA, options: OPCIONES });
    const d = await ventana(c, 1, 1, { [PRT(1)]: [
      tramo(t, 'Pedro Prueba Ejemplo', 'PER', 0.95),     // media
      tramo(t, 'ana ficticia rojas', 'PER', 0.55),        // baja, no se descarta
      tramo(t, 'Luisa Ejemplo Prueba', 'PER', 0.25),      // bajo el piso: descartado
      tramo(t, 'Ferretería Ficticia', 'ORG', 0.4),        // EMPRESA baja
      tramo(t, 'Envigado', 'LOC', 0.95),                  // municipio: lo consume generalize (sugerencia), no es detección
      tramo(t, 'señor Pedro', 'PER', 0.99, 0),            // se solapa con el primero: gana la primera
    ] });
    const por = Object.fromEntries(d.detections.map((x) => [x.text, x]));
    expect(por['Pedro Prueba Ejemplo']).toMatchObject({ type: 'PERSONA', confidence: 'media', role: 'OTRA_PERSONA', nerLabel: 'PER' });
    expect(por['ana ficticia rojas']).toMatchObject({ type: 'PERSONA', confidence: 'baja' });
    expect(por['Luisa Ejemplo Prueba']).toBeUndefined();
    expect(por['Ferretería Ficticia']).toMatchObject({ type: 'EMPRESA', confidence: 'baja' });
    expect(por['Envigado']).toBeUndefined();
    expect(d.suggestions.some((s) => s.kind === 'MUNICIPIO_A_DEPARTAMENTO')).toBe(true);
  });

  it('fusionar sin `ventana` entrega todo el resultado del modelo de una vez y con `ner: null` cierra la sesión sin más ventanas', async () => {
    const { b } = await arrancar();
    const todo = resultado<Fusion>(await b.enviar('fusionar', { sessionId: 'ses_1', nerEngineId: 'gliner-x-large',
      ner: { [PRT(1)]: [tramo(TEXTO, 'Pedro Prueba Ejemplo', 'PER', 0.95), tramo(TEXTO, 'Ana Ficticia Rojas', 'PER', 0.95)] } }));
    expect(todo.ventana).toBeUndefined();
    expect(todo.set.detections.filter((d) => d.source === 'modelo')).toHaveLength(2);
    expect(todo.set.detections.some((d) => d.source === 'regla')).toBe(true);   // el conjunto completo, no un delta
    const nulo = resultado<Fusion>(await b.enviar('fusionar', { sessionId: 'ses_1', ner: null, nerEngineId: 'nulo' }));
    expect(nulo.set.detections.filter((d) => d.source === 'modelo')).toHaveLength(2);   // lo incorporado antes se conserva (6.11.2, paso 4)
    const tarde = await b.enviar('fusionar', { sessionId: 'ses_1', nerEngineId: 'gliner-x-large', ventana: 1, ner: {} });
    expect(tarde[0]).toMatchObject({ kind: 'error', code: 'ENTRADA_INVALIDA' });
  });

  it('INV-W06 un documento de 3 ventanas con un nombre en cada solape: la unión de los deltas no repite ni pierde tramos', async () => {
    const relleno = 'visitó la casa del barrio y volvió a la oficina de la empresa. ';
    const nombres = ['Pedro Prueba Ejemplo', 'Ana Ficticia Rojas', 'Luisa Ejemplo Prueba', 'Mario Ficticio Rojas'];
    const t = nombres.map((n) => `${n} ${relleno}`.repeat(1)).join('');
    const b = banco();
    await b.enviar('detectar', { sessionId: 'ses_1', doc: documento([t]), caseList: [], table: TABLA, options: OPCIONES });
    // motor simulado: tres ventanas con zonas propias; los nombres 2 y 3 caen en solapes y el motor, defectuoso, los repite en la ventana vecina
    const reparto: NerSpan[][] = [
      [tramo(t, nombres[0]!, 'PER', 0.9), tramo(t, nombres[1]!, 'PER', 0.9)],
      [tramo(t, nombres[1]!, 'PER', 0.9), tramo(t, nombres[2]!, 'PER', 0.9)],
      [tramo(t, nombres[2]!, 'PER', 0.9), tramo(t, nombres[3]!, 'PER', 0.9)],
    ];
    const vistos: string[] = [];
    for (let i = 0; i < reparto.length; i++) {
      const delta = await ventana(b, i + 1, 3, { [PRT(1)]: reparto[i]! });
      for (const d of delta.detections) vistos.push(`${d.start}:${d.end}`);
    }
    expect(vistos).toHaveLength(nombres.length);
    expect(new Set(vistos).size).toBe(vistos.length);
  });
});

describe('T-MO-12 · cancelación y progreso', () => {
  it('INV-W08 tras cancelar a mitad del documento, detect no envía más progreso ni resultado, responde cancelado y la sesión no existe', async () => {
    const partes = Array.from({ length: 6 }, (_, i) => `Parte ${i + 1}: Pedro Prueba Ejemplo, C.C. 100000000${i}.`);
    let t = 0;
    let cedidas = 0;
    const enviados: Mensaje[] = [];
    const post = (m: unknown): void => { enviados.push(m as Mensaje); };
    let h!: ReturnType<typeof createDetectHandler>;
    h = createDetectHandler({
      ids, now: () => (t += 100),
      yieldFn: async () => { cedidas++; if (cedidas === 2) await h({ v: 1, reqId: REQ(99), kind: 'cancelar', payload: { targetReqId: REQ(1) } }, post); },
    });
    await h({ v: 1, reqId: REQ(1), kind: 'detectar', payload: { sessionId: 'ses_1', doc: documento(partes), caseList: [], table: TABLA, options: OPCIONES } }, post);
    const ultimo = enviados[enviados.length - 1]!;
    expect(ultimo).toEqual({ v: 1, reqId: REQ(1), kind: 'cancelado' });
    expect(enviados.filter((m) => m.kind === 'resultado' || m.kind === 'error')).toHaveLength(0);
    expect(enviados.filter((m) => m.kind === 'cancelado')).toHaveLength(1);
    const avance = enviados.filter((m) => m.kind === 'progreso');
    expect(avance.length).toBeLessThan(partes.length);   // se detuvo a mitad
    const r: Mensaje[] = [];
    await h({ v: 1, reqId: REQ(2), kind: 'fusionar', payload: { sessionId: 'ses_1', ner: null, nerEngineId: 'nulo' } }, (m) => r.push(m as Mensaje));
    expect(r[0]).toMatchObject({ kind: 'error', code: 'SESION_DESCONOCIDA' });
  });

  it('un cancelar sin petición en curso responde cancelado para el objetivo (cooperativa, como el worker io)', async () => {
    const b = banco();
    const out = await b.enviar('cancelar', { targetReqId: REQ(7) });
    expect(out).toEqual([{ v: 1, reqId: REQ(7), kind: 'cancelado' }]);
  });

  it('la regla de progreso: nunca más de 10 mensajes por segundo en ninguna ventana de 1000 ms', async () => {
    const partes = Array.from({ length: 300 }, (_, i) => `Parte ${i}: Ana Ficticia Rojas.`);
    let reloj = 0;
    const marcas: number[] = [];
    const h = createDetectHandler({ ids, now: () => (reloj += 1) });   // cada consulta del reloj avanza 1 ms
    const post = (m: unknown): void => { if ((m as Mensaje).kind === 'progreso') marcas.push(reloj); };
    const salida: Mensaje[] = [];
    await h({ v: 1, reqId: REQ(1), kind: 'detectar', payload: { sessionId: 'ses_1', doc: documento(partes), caseList: [], table: TABLA, options: OPCIONES } },
      (m) => { post(m); salida.push(m as Mensaje); });
    expect(salida.some((m) => m.kind === 'resultado')).toBe(true);
    expect(marcas.length).toBeGreaterThan(1);
    for (let i = 0; i < marcas.length; i++) {
      const enVentana = marcas.filter((x) => x >= marcas[i]! && x < marcas[i]! + 1000).length;
      expect(enVentana).toBeLessThanOrEqual(10);
    }
  });

  it('ProgressLimiter deja pasar 10 mensajes por segundo y descarta el resto', () => {
    let t = 0;
    const lim = new ProgressLimiter(() => t);
    let pasan = 0;
    for (t = 0; t < 3000; t += 7) if (lim.take()) pasan++;
    expect(pasan).toBeLessThanOrEqual(30);
    expect(pasan).toBeGreaterThanOrEqual(25);
  });
});
