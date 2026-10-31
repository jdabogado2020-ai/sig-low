// T-MO-12 (parte PB-6) · Resultados por ventana del modelo: `incorporar_modelo` sin tocar lo decidido (INV-R12), `declarar_plan_b`,
// `fusionar` con `ventana` que devuelve solo el delta, `parcial` sin repetidos entre ventanas (INV-W06), cancelación (INV-W08) y la regla
// de progreso de 6.11.1 (máximo 10 mensajes por segundo). `exportGate` con `MODELO_EN_CURSO` (INV-R11) es de PC-5. Datos ficticios.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newCaseEntity, refreshVariants } from '../../src/core/caselist';
import { applyReviewAction } from '../../src/core/entities';
import { candidatesFromNer, createDetectHandler, ProgressLimiter } from '../../src/core/pipeline';
import { declararPlanB, incorporarModelo, modeloInicial } from '../../src/core/review/modelo';
import { exportGate } from '../../src/core/review/puerta';
import { render } from '../../src/core/render';
import { UMBRALES_MODELO } from '../../src/core/umbrales';
import type {
  CaseEntity, DetectionSet, DocId, DocumentModel, IdSource, NerSpan, PartId, PlanBCause, ResidueResult, ReviewState, TableIndex,
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

describe('T-MO-12 · fusión por ventana contra lo ya fusionado y umbrales (7.10.7, 7.10.9, 7.10.10; PB-2-r3)', () => {
  const T = 'La demandante Ana Ficticia Rojas presentó la tutela. Declaró Pedro Luis Ficticia Gómez, vecino del sector, y firmó.';
  const NOMBRE = 'Pedro Luis Ficticia Gómez';
  /**
   * Letras de [desde, desde + largo) de la primera parte que la salida deja a la vista: las de los trozos que `render` copia tal cual
   * (sin detección ni edición de tramo). Antes de PB-2-r5 miraba solo si alguna detección cubría la letra, y contaba una rechazada
   * como cobertura (P0-6a de PB-2-r4, M-12).
   */
  const letrasALaVista = (doc: DocumentModel, st: ReviewState, desde: number, largo: number): string[] => {
    const texto = doc.parts[0]!.text;
    const fuera: string[] = [];
    for (const g of render(doc, st).sections[0]!.segments) {
      if (g.detectionId !== undefined || g.spanEditId !== undefined) continue;
      for (let i = Math.max(g.partStart, desde); i < Math.min(g.partEnd, desde + largo); i++) if (/\p{L}/u.test(texto[i] as string)) fuera.push(texto[i] as string);
    }
    return fuera;
  };

  /** Detectar con «Ana Ficticia Rojas» en la lista; la lista marca «Ficticia» suelto dentro del nombre de otra persona. */
  async function conApellidoSuelto(texto = T) {
    const caseList = refreshVariants([newCaseEntity('Ana Ficticia Rojas', 'persona', 'DEMANDANTE', ids) as CaseEntity]);
    const doc = documento([texto]);
    const b = banco();
    const det = resultado<{ kind: 'detectar'; set: DetectionSet }>(await b.enviar('detectar', { sessionId: 'ses_1', doc, caseList, table: TABLA, options: OPCIONES }));
    const ctx: ReviewContext = { table: TABLA, caseList, doc, ids };
    const st = estadoDe(doc, det.set);
    const suelto = Object.values(st.detections).find((d) => d.source === 'lista' && d.start === texto.indexOf('Ficticia', texto.indexOf(NOMBRE)));
    expect(suelto?.variantClass, 'la lista marca el apellido suelto dentro del nombre de otra persona').toBe('apellido_suelto');
    const w1 = await ventana(b, 1, 1, { [PRT(1)]: [tramo(texto, 'Ana Ficticia Rojas', 'PER', 0.97), tramo(texto, NOMBRE, 'PER', 0.95)] });
    return { doc, ctx, st, suelto: suelto!, w1 };
  }
  const modelo = (st: ReviewState): string[] => Object.values(st.detections).filter((d) => d.source === 'modelo')
    .map((d) => `${d.text}:${d.confidence}:${d.status}`).sort();

  it('INV-R02 INV-R12 D-03 B el nombre del modelo que contiene un apellido suelto de otra persona de la lista: la lista cede y el nombre entra entero (C01, C06)', async () => {
    const { doc, ctx, st: st0, suelto, w1 } = await conApellidoSuelto();
    const desde = T.indexOf(NOMBRE);
    // Antes (PB-2-r3), el delta traía «Pedro Luis» y «Gómez» de baja confianza y «Ficticia» seguía como la demandante.
    expect(w1.detections.map((d) => `${d.text}:${d.source}:${d.confidence}`)).toEqual([`${NOMBRE}:modelo:media`]);
    const st = bien(incorporarModelo(st0, 1, 1, w1, ctx));
    expect(letrasALaVista(doc, st, desde, NOMBRE.length)).toEqual([]);
    expect(st.detections[suelto.id]).toBeUndefined();   // la variante débil cedió
    expect(modelo(st)).toEqual([`${NOMBRE}:media:pendiente`]);
    const nombre = Object.values(st.detections).find((d) => d.text === NOMBRE)!;
    expect(st.entities[nombre.entityId]).toMatchObject({ canonicalKey: 'PER:pedro luis ficticia gomez', role: 'OTRA_PERSONA' });
    // La demandante conserva su mención completa; nada más cambió.
    for (const [id, d] of Object.entries(st0.detections)) if (id !== suelto.id) expect(st.detections[id as keyof typeof st.detections]).toEqual(d);
    expect(st.entities[suelto.entityId]?.mentions).toHaveLength(1);
  });

  it('INV-R12 D-03 la excepción ocurre con la detección de la lista intacta y no ocurre tras cualquier acción sobre ella', async () => {
    const base = await conApellidoSuelto();
    const { doc, ctx, suelto, w1 } = base;
    const desde = T.indexOf(NOMBRE);
    const sector = T.indexOf('sector');
    // `rechazar` y `rechazar_entidad` no están aquí: una rechazada no bloquea un tramo distinto (M-12, prueba siguiente).
    const acciones: Array<[string, (s: ReviewState) => ReviewState]> = [
      ['aceptar', (s) => bien(applyReviewAction(s, { kind: 'aceptar', detectionId: suelto.id }, ctx))],
      ['editar', (s) => bien(applyReviewAction(s, { kind: 'editar', detectionId: suelto.id, text: 'el testigo' }, ctx))],
      ['cambiar_tipo', (s) => bien(applyReviewAction(s, { kind: 'cambiar_tipo', detectionId: suelto.id, type: 'EMPRESA' }, ctx))],
      ['separar_mencion', (s) => bien(applyReviewAction(s, { kind: 'separar_mencion', detectionId: suelto.id }, ctx))],
      ['cambiar_rol', (s) => bien(applyReviewAction(s, { kind: 'cambiar_rol', entityId: suelto.entityId, role: 'TESTIGO' }, ctx))],
      ['aceptar_entidad', (s) => bien(applyReviewAction(s, { kind: 'aceptar_entidad', entityId: suelto.entityId }, ctx))],
      ['unir_entidades', (s) => {
        const m = bien(applyReviewAction(s, { kind: 'agregar_manual', span: { partId: PRT(1), start: sector, end: sector + 6 }, type: 'PERSONA', propagate: false }, ctx));
        const manual = Object.values(m.detections).find((d) => d.source === 'manual')!;
        return bien(applyReviewAction(m, { kind: 'unir_entidades', fromId: suelto.entityId, intoId: manual.entityId }, ctx));
      }],
    ];
    // Intacta: la excepción ocurre (cesión, D-03 B).
    const intacta = bien(incorporarModelo(base.st, 1, 1, w1, ctx));
    expect(intacta.detections[suelto.id]).toBeUndefined();
    expect(modelo(intacta)).toEqual([`${NOMBRE}:media:pendiente`]);
    for (const [nombre, accion] of acciones) {
      const antes = accion(base.st);
      const despues = bien(incorporarModelo(antes, 1, 1, w1, ctx));
      // La detección queda como la dejó el usuario; el tramo del modelo se parte como antes de D-03 (7.11.2) y no se pierde.
      expect(despues.detections[suelto.id], nombre).toEqual(antes.detections[suelto.id]);
      expect(modelo(despues), nombre).toEqual(['Gómez:baja:pendiente', 'Pedro Luis:baja:pendiente']);
      expect(letrasALaVista(doc, despues, desde, NOMBRE.length), nombre).toEqual([]);
      expect(despues.flags, nombre).toEqual(antes.flags);
      expect(despues.suggestions, nombre).toEqual(antes.suggestions);
      expect(despues.spanEdits, nombre).toEqual(antes.spanEdits);
      // Sin la vuelta a 7.11.2 de incorporarModelo, el reductor solo descarta la propuesta: no toca lo decidido.
      const directo = bien(applyReviewAction(antes, { kind: 'incorporar_modelo', ventana: 1, ventanasTotales: 1, delta: w1 }, ctx));
      expect(directo.detections, nombre).toEqual(antes.detections);
    }
    // Límite: restablecer devuelve la detección a su estado de nacimiento sin dejar rastro (6.4.4); vuelve a contar como intacta.
    const restablecida = bien(applyReviewAction(acciones[0]![1](base.st), { kind: 'restablecer', detectionId: suelto.id }, ctx));
    expect(restablecida.detections[suelto.id]).toEqual(base.st.detections[suelto.id]);
    expect(bien(incorporarModelo(restablecida, 1, 1, w1, ctx)).detections[suelto.id]).toBeUndefined();
  });

  it('INV-R12 M-12 una detección rechazada no bloquea el nombre completo del modelo: tras rechazar la variante débil o la entidad, el nombre entra entero y sin letras a la vista', async () => {
    const base = await conApellidoSuelto();
    const { doc, ctx, suelto, w1 } = base;
    const desde = T.indexOf(NOMBRE);
    const acciones: Array<[string, (s: ReviewState) => ReviewState]> = [
      ['rechazar con motivo', (s) => bien(applyReviewAction(s, { kind: 'rechazar', detectionId: suelto.id, reason: 'FALSO_POSITIVO' }, ctx))],
      ['rechazar sin motivo', (s) => bien(applyReviewAction(s, { kind: 'rechazar', detectionId: suelto.id }, ctx))],
      ['rechazar_entidad', (s) => bien(applyReviewAction(s, { kind: 'rechazar_entidad', entityId: suelto.entityId }, ctx))],
    ];
    for (const [nombre, accion] of acciones) {
      const antes = accion(base.st);
      expect(antes.detections[suelto.id]?.status, nombre).toBe('rechazada');
      // Por incorporarModelo y por el reductor directo (6.4.4: solo el tramo idéntico a una rechazada se descarta).
      for (const despues of [bien(incorporarModelo(antes, 1, 1, w1, ctx)),
        bien(applyReviewAction(antes, { kind: 'incorporar_modelo', ventana: 1, ventanasTotales: 1, delta: w1 }, ctx))]) {
        // Antes de PB-2-r5: «Pedro Luis» y «Gómez» de baja confianza y «Declaró [PERSONA_1] Ficticia [PERSONA_2]».
        expect(modelo(despues), nombre).toEqual([`${NOMBRE}:media:pendiente`]);
        expect(letrasALaVista(doc, despues, desde, NOMBRE.length), nombre).toEqual([]);
        const pedro = Object.values(despues.detections).find((d) => d.text === NOMBRE)!;
        expect(render(doc, despues).sections[0]!.text, nombre).toContain(`Declaró ${despues.entities[pedro.entityId]!.marker as string}, vecino`);
        // Lo decidido no cambia: la rechazada sigue rechazada, con su motivo y en su entidad; banderas, sugerencias y ediciones, igual.
        for (const [id, d] of Object.entries(antes.detections)) expect(despues.detections[id as keyof typeof despues.detections], nombre).toEqual(d);
        expect(despues.flags, nombre).toEqual(antes.flags);
        expect(despues.suggestions, nombre).toEqual(antes.suggestions);
        expect(despues.spanEdits, nombre).toEqual(antes.spanEdits);
      }
    }
  });

  it('INV-R12 M-12 la extensión de la lista (D-03 E) sobre una mención rechazada de la misma entidad no se le atribuye: entra como tramo del modelo con entidad propia', async () => {
    const t = 'La demandante Ana Ficticia Rojas Prueba presentó la tutela.';
    const caseList = refreshVariants([newCaseEntity('Ana Ficticia Rojas', 'persona', 'DEMANDANTE', ids) as CaseEntity]);
    const doc = documento([t]);
    const b = banco();
    const det = resultado<{ kind: 'detectar'; set: DetectionSet }>(await b.enviar('detectar', { sessionId: 'ses_1', doc, caseList, table: TABLA, options: OPCIONES }));
    const ctx: ReviewContext = { table: TABLA, caseList, doc, ids };
    const st0 = estadoDe(doc, det.set);
    const ana = Object.values(st0.detections).find((d) => d.text === 'Ana Ficticia Rojas')!;
    const rechazada = bien(applyReviewAction(st0, { kind: 'rechazar', detectionId: ana.id, reason: 'FALSO_POSITIVO' }, ctx));
    const w1 = await ventana(b, 1, 1, { [PRT(1)]: [tramo(t, 'Ana Ficticia Rojas Prueba', 'PER', 0.95)] });
    expect(w1.detections.map((d) => `${d.text}:${d.source}`)).toEqual(['Ana Ficticia Rojas Prueba:lista']);
    // El reductor solo no se la atribuye a la entidad de la lista: la descarta sin tocar nada.
    expect(bien(applyReviewAction(rechazada, { kind: 'incorporar_modelo', ventana: 1, ventanasTotales: 1, delta: w1 }, ctx)).detections).toEqual(rechazada.detections);
    // incorporarModelo la entrega como el tramo del modelo. Antes de PB-2-r5: solo «Prueba», y «Ana Ficticia Rojas» a la vista.
    const despues = bien(incorporarModelo(rechazada, 1, 1, w1, ctx));
    expect(despues.detections[ana.id]).toEqual(rechazada.detections[ana.id]);
    expect(modelo(despues)).toEqual(['Ana Ficticia Rojas Prueba:media:pendiente']);
    const nuevo = Object.values(despues.detections).find((d) => d.text === 'Ana Ficticia Rojas Prueba')!;
    expect(nuevo.caseEntityId).toBeUndefined();
    expect(nuevo.entityId).not.toBe(ana.entityId);
    expect(despues.entities[nuevo.entityId]).toMatchObject({ canonicalKey: 'PER:ana ficticia rojas prueba', role: 'OTRA_PERSONA' });
    expect(despues.entities[ana.entityId]?.mentions).toContain(ana.id);
    expect(letrasALaVista(doc, despues, t.indexOf('Ana'), 'Ana Ficticia Rojas Prueba'.length)).toEqual([]);
  });

  it('INV-R12 M-13 el tramo del modelo que toca una detección manual o una edición de tramo hecha antes de la ventana se parte en restos (7.11.2), no se descarta entero', async () => {
    const doc = documento([T]);
    const b = banco();
    const det = resultado<{ kind: 'detectar'; set: DetectionSet }>(await b.enviar('detectar', { sessionId: 'ses_1', doc, caseList: [], table: TABLA, options: OPCIONES }));
    const ctx = ctxDe(doc);
    const st0 = estadoDe(doc, det.set);
    const desde = T.indexOf(NOMBRE);
    const fic = T.indexOf('Ficticia', desde);
    // Sin lista, mientras corre el modelo: el usuario marca «Ficticia» a mano, o una edición de tramo la cubre.
    const manual = bien(applyReviewAction(st0, { kind: 'agregar_manual', span: { partId: PRT(1), start: fic, end: fic + 8 }, type: 'PERSONA', propagate: false }, ctx));
    const edicion: ReviewState = { ...st0, spanEdits: { ['edt_' + 'e'.repeat(32)]: { id: 'edt_' + 'e'.repeat(32), span: { partId: PRT(1), start: fic, end: fic + 8 },
      originalText: 'Ficticia', text: 'un tercero', origin: { kind: 'bandera', flagId: 'flg_' + 'f'.repeat(32) } } } } as unknown as ReviewState;
    const w1 = await ventana(b, 1, 1, { [PRT(1)]: [tramo(T, NOMBRE, 'PER', 0.95)] });
    expect(w1.detections.map((d) => `${d.text}:${d.source}`)).toEqual([`${NOMBRE}:modelo`]);   // el worker no conoce lo del usuario
    for (const [nombre, antes] of [['agregar_manual', manual], ['edición de tramo', edicion]] as const) {
      // Antes de PB-2-r5: el tramo se descartaba entero y la salida decía «Declaró Pedro Luis [PERSONA_1] Gómez».
      const despues = bien(incorporarModelo(antes, 1, 1, w1, ctx));
      expect(modelo(despues), nombre).toEqual(['Gómez:baja:pendiente', 'Pedro Luis:baja:pendiente']);
      expect(letrasALaVista(doc, despues, desde, NOMBRE.length), nombre).toEqual([]);
      for (const [id, d] of Object.entries(antes.detections)) expect(despues.detections[id as keyof typeof despues.detections], nombre).toEqual(d);
      expect(despues.spanEdits, nombre).toEqual(antes.spanEdits);
    }
    // Una detección rechazada tampoco bloquea un tramo del modelo que no es propuesta sobre la lista (M-12 y M-13).
    const manualRechazada = bien(applyReviewAction(manual, { kind: 'rechazar', detectionId: Object.values(manual.detections).find((d) => d.source === 'manual')!.id }, ctx));
    expect(modelo(bien(incorporarModelo(manualRechazada, 1, 1, w1, ctx)))).toEqual([`${NOMBRE}:media:pendiente`]);
  });

  it('INV-R12 B-55 (PB-4-r1) el usuario marca a mano un tramo que corta una palabra («Ficticia Gó», «Fic»): el resto en minúscula entra y no quedan letras a la vista', async () => {
    const doc = documento([T]);
    const b = banco();
    const det = resultado<{ kind: 'detectar'; set: DetectionSet }>(await b.enviar('detectar', { sessionId: 'ses_1', doc, caseList: [], table: TABLA, options: OPCIONES }));
    const ctx = ctxDe(doc);
    const st0 = estadoDe(doc, det.set);
    const desde = T.indexOf(NOMBRE);
    const w1 = await ventana(b, 1, 1, { [PRT(1)]: [tramo(T, NOMBRE, 'PER', 0.95)] });
    const corte = (sub: string): ReviewState => {
      const i = T.indexOf(sub, desde);
      return bien(applyReviewAction(st0, { kind: 'agregar_manual', span: { partId: PRT(1), start: i, end: i + sub.length }, type: 'PERSONA', propagate: false }, ctx));
    };
    // Con el código anterior, «Ficticia Gó» dejaba «mez» a la vista: el resto empieza en minúscula y 7.11.2 lo descartaba.
    for (const [sub, restos] of [['Ficticia Gó', ['Pedro Luis:baja:pendiente', 'mez:baja:pendiente']],
      ['Fic', ['Pedro Luis:baja:pendiente', 'ticia Gómez:baja:pendiente']]] as const) {
      const despues = bien(incorporarModelo(corte(sub), 1, 1, w1, ctx));
      expect(modelo(despues), sub).toEqual([...restos].sort());
      expect(letrasALaVista(doc, despues, desde, NOMBRE.length), sub).toEqual([]);
    }
  });

  it('INV-R12 D-03 E la detección de la lista intacta toma el nombre completo del modelo por ventana; tras una acción, el resto entra aparte', async () => {
    const t = 'La demandante Ana Ficticia Rojas Prueba presentó la tutela.';
    const caseList = refreshVariants([newCaseEntity('Ana Ficticia Rojas', 'persona', 'DEMANDANTE', ids) as CaseEntity]);
    const doc = documento([t]);
    const b = banco();
    const det = resultado<{ kind: 'detectar'; set: DetectionSet }>(await b.enviar('detectar', { sessionId: 'ses_1', doc, caseList, table: TABLA, options: OPCIONES }));
    const ctx: ReviewContext = { table: TABLA, caseList, doc, ids };
    const st0 = estadoDe(doc, det.set);
    const ana = Object.values(st0.detections).find((d) => d.text === 'Ana Ficticia Rojas')!;
    expect(ana).toMatchObject({ source: 'lista', variantClass: 'exacta' });
    const w1 = await ventana(b, 1, 1, { [PRT(1)]: [tramo(t, 'Ana Ficticia Rojas Prueba', 'PER', 0.95)] });
    // Antes (PB-2-r3): «Prueba» de baja confianza como otra persona.
    expect(w1.detections.map((d) => `${d.text}:${d.source}:${d.confidence}`)).toEqual(['Ana Ficticia Rojas Prueba:lista:media']);
    const st = bien(incorporarModelo(st0, 1, 1, w1, ctx));
    const ext = Object.values(st.detections).find((d) => d.text === 'Ana Ficticia Rojas Prueba')!;
    expect(ext).toMatchObject({ source: 'lista', caseEntityId: ana.caseEntityId, entityId: ana.entityId, status: 'pendiente', confidence: 'media' });
    expect(st.detections[ana.id]).toBeUndefined();
    expect(st.entities[ana.entityId]?.mentions).toEqual([ext.id]);
    expect(st.entities[ana.entityId]?.marker).toBe(st0.entities[ana.entityId]?.marker);
    // Tras aceptarla, la extensión no ocurre: «Ana Ficticia Rojas» sigue aceptada y «Prueba» entra aparte, como antes.
    const aceptada = bien(applyReviewAction(st0, { kind: 'aceptar', detectionId: ana.id }, ctx));
    const despues = bien(incorporarModelo(aceptada, 1, 1, w1, ctx));
    expect(despues.detections[ana.id]).toEqual(aceptada.detections[ana.id]);
    expect(modelo(despues)).toEqual(['Prueba:baja:pendiente']);
  });

  it('INV-R02 una ventana posterior que se solapa en el borde con un tramo ya emitido deja entrar su resto (7.10.5 y 7.10.10)', async () => {
    const t = 'Firmaron Pedro Prueba Ejemplo Rojas y Luisa Ficticia en la oficina.';
    const doc = documento([t]);
    const b = banco();
    const det = resultado<{ kind: 'detectar'; set: DetectionSet }>(await b.enviar('detectar', { sessionId: 'ses_1', doc, caseList: [], table: TABLA, options: OPCIONES }));
    const ctx = ctxDe(doc);
    let st = estadoDe(doc, det.set);
    const w1 = await ventana(b, 1, 2, { [PRT(1)]: [tramo(t, 'Pedro Prueba Ejemplo', 'PER', 0.95)] });
    st = bien(incorporarModelo(st, 1, 2, w1, ctx));
    const w2 = await ventana(b, 2, 2, { [PRT(1)]: [tramo(t, 'Ejemplo Rojas', 'PER', 0.95), tramo(t, 'Luisa Ficticia', 'PER', 0.95)] });
    expect(w2.detections.map((d) => `${d.text}:${d.confidence}`)).toEqual(['Rojas:baja', 'Luisa Ficticia:media']);
    st = bien(incorporarModelo(st, 2, 2, w2, ctx));
    expect(letrasALaVista(doc, st, t.indexOf('Pedro'), 'Pedro Prueba Ejemplo Rojas'.length)).toEqual([]);
  });

  it('M-1 candidatesFromNer recorta R-MOD-03 sin retroceso exponencial: 16 y 200 palabras hostiles en menos de 50 ms', () => {
    const mejorDe3 = (f: () => unknown): number => Math.min(...[0, 1, 2].map(() => { const t0 = performance.now(); f(); return performance.now() - t0; }));
    for (const palabras of [16, 200]) {
      const t = 'x' + ' !'.repeat(palabras - 2) + ' ana';
      const part = documento([t]).parts[0]!;
      const conv = (): ReturnType<typeof candidatesFromNer> =>
        candidatesFromNer([{ start: 0, end: t.length, label: 'PER', score: 0.95 }], { part, options: UMBRALES_MODELO, docDepCodes: [], base: [], ids });
      expect(mejorDe3(conv)).toBeLessThan(50);
      expect(conv().candidates.map((c) => [c.start, c.end])).toEqual([[0, t.length]]);   // la «Derecha» no casa: el tramo queda entero
    }
  });

  it('D-03 A 7.10.7 el tramo ORG del modelo conserva su sufijo societario final («S.A.», «Ltda.», «S.A.S.»)', () => {
    const t = 'Pagaron Comercial Ejemplo S.A., la Ferretería Ficticia Ltda. y Inversiones Prueba S.A.S. el saldo.';
    const part = documento([t]).parts[0]!;
    const conv = candidatesFromNer([tramo(t, 'Comercial Ejemplo S.A.,', 'ORG', 0.9), tramo(t, 'la Ferretería Ficticia Ltda.', 'ORG', 0.9),
      tramo(t, 'Inversiones Prueba S.A.S.', 'ORG', 0.9)], { part, options: UMBRALES_MODELO, docDepCodes: [], base: [], ids });
    // Antes: «Comercial Ejemplo S», «Ferretería Ficticia Ltda» e «Inversiones Prueba S.A.S».
    expect(conv.candidates.map((c) => `${c.type}:${t.slice(c.start, c.end)}`))
      .toEqual(['EMPRESA:Comercial Ejemplo S.A.', 'EMPRESA:Ferretería Ficticia Ltda.', 'EMPRESA:Inversiones Prueba S.A.S.']);
  });

  it('D-03 C y D 7.10.8 autoridad del modelo: con municipio, DESPACHO_A_GENERICO (también de 3 cifras); sin municipio y con nombre propio, ENTIDAD baja', () => {
    const t = 'Firmaron ante la Notaría Ejemplo, el Juzgado 003 Civil Municipal de Ubaté, el Juzgado 3 Civil del Circuito de Ubaté, la Corte '
      + 'Constitucional, la Notaría 999, el Juzgado Tercero Civil del Circuito y la Superintendencia Ficticia.';
    const part = documento([t]).parts[0]!;
    const conv = candidatesFromNer([
      tramo(t, 'Notaría Ejemplo', 'ORG', 0.95), tramo(t, 'Juzgado 003 Civil Municipal de Ubaté', 'ORG', 0.95),
      tramo(t, 'Juzgado 3 Civil del Circuito', 'ORG', 0.95),   // el municipio queda fuera del tramo: la cola de R-DESP-01 lo alcanza
      tramo(t, 'Corte Constitucional', 'ORG', 0.95), tramo(t, 'Notaría 999', 'ORG', 0.95),
      tramo(t, 'Juzgado Tercero Civil del Circuito', 'ORG', 0.95), tramo(t, 'Superintendencia Ficticia', 'ORG', 0.95),
    ], { part, options: UMBRALES_MODELO, docDepCodes: [], base: [], ids });
    // Antes: ninguna detección ni sugerencia (la autoridad se descartaba; R-DESP-01 no admitía «003»).
    expect(conv.candidates.map((c) => `${c.type}:${t.slice(c.start, c.end)}:${c.confidence}`)).toEqual(['ENTIDAD:Notaría Ejemplo:baja']);
    expect(conv.suggestions.map((s) => `${s.kind}:${s.originalText}`)).toEqual([
      'DESPACHO_A_GENERICO:Juzgado 003 Civil Municipal de Ubaté', 'DESPACHO_A_GENERICO:Juzgado 3 Civil del Circuito de Ubaté']);
    expect(conv.suggestions[0]?.options.map((o) => o.template)).toEqual(['Juzgado 003 Civil Municipal de un municipio de {m}', 'un juzgado civil municipal']);
  });

  it('AJ-3 «secretaría» (R-DESP-01): una secretaría con municipio da DESPACHO_A_GENERICO; sin municipio no es una autoridad con nombre propio (el cargo de una persona no es ENTIDAD)', () => {
    const t = 'La secretaria de salud municipal informó; la Secretaría de Movilidad de Envigado respondió.';
    const part = documento([t]).parts[0]!;
    const conv = candidatesFromNer([
      tramo(t, 'secretaria de salud municipal', 'ORG', 0.95), tramo(t, 'Secretaría de Movilidad de Envigado', 'ORG', 0.95),
    ], { part, options: UMBRALES_MODELO, docDepCodes: [], base: [], ids });
    // Con «secretaría» entre las cabezas del mapeo 7.10.8, «secretaria de salud municipal» salía como ENTIDAD baja (falso positivo de C15).
    expect(conv.candidates.map((c) => `${c.type}:${t.slice(c.start, c.end)}`)).toEqual([]);
    expect(conv.suggestions.map((x) => `${x.kind}:${x.originalText}`)).toEqual(['DESPACHO_A_GENERICO:Secretaría de Movilidad de Envigado']);
    expect(conv.suggestions[0]?.options.map((o) => o.template)).toEqual(['Secretaría de Movilidad de un municipio de {m}', 'una secretaría']);
  });

  it('B-33 7.10.8 el ORG del modelo que trae un despacho y algo más: el despacho da su sugerencia y el resto entra como candidato del modelo, confianza baja (7.11.2)', () => {
    const t = 'Lo firmó el Juzgado Civil Municipal de Ubaté Pedro Ejemplo Gómez y lo notificó el Juzgado 2 de Familia de Cartago, Seguros Ficticios S.A.';
    const part = documento([t]).parts[0]!;
    const de = (spans: NerSpan[]): ReturnType<typeof candidatesFromNer> => candidatesFromNer(spans, { part, options: UMBRALES_MODELO, docDepCodes: [], base: [], ids });
    const conv = de([tramo(t, 'Juzgado Civil Municipal de Ubaté Pedro Ejemplo Gómez', 'ORG', 0.95),
      tramo(t, 'Juzgado 2 de Familia de Cartago, Seguros Ficticios S.A.', 'ORG', 0.9)]);
    expect(conv.suggestions.map((s) => s.originalText)).toEqual(['Juzgado Civil Municipal de Ubaté', 'Juzgado 2 de Familia de Cartago']);
    // Antes de PB-2-r5: ningún candidato; «Pedro Ejemplo Gómez» y «Seguros Ficticios S.A.» quedaban a la vista.
    expect(conv.candidates.map((c) => `${c.type}:${t.slice(c.start, c.end)}:${c.confidence}:${c.source}:${c.canonicalKey}`)).toEqual([
      'EMPRESA:Pedro Ejemplo Gómez:baja:modelo:ORG:pedro ejemplo gomez', 'EMPRESA:Seguros Ficticios S.A.:baja:modelo:ORG:seguros ficticios']);
    // Si fuera del despacho no queda nada, solo palabras de función o solo un lugar de la DIVIPOLA, no hay candidato.
    expect(de([tramo(t, 'el Juzgado Civil Municipal de Ubaté', 'ORG', 0.95)]).candidates).toEqual([]);
    const t2 = 'Lo remitió el Juzgado 1 Civil del Circuito de Cartago (Valle) ayer.';
    const p2 = documento([t2]).parts[0]!;
    const conValle = candidatesFromNer([tramo(t2, 'Juzgado 1 Civil del Circuito de Cartago (Valle)', 'ORG', 0.95)], { part: p2, options: UMBRALES_MODELO, docDepCodes: [], base: [], ids });
    expect(conValle.suggestions.map((s) => s.originalText)).toEqual(['Juzgado 1 Civil del Circuito de Cartago']);
    expect(conValle.candidates).toEqual([]);
  });

  it('B-34 7.10.8 la autoridad con nombre propio y municipio recibe la sugerencia de despacho (o1 y o2 de R-DESP-01); si no casa con R-DESP-01, ENTIDAD baja', () => {
    const t = 'Ante la Notaría Ejemplo de Ubaté, la Notaría Simón Bolívar, la Notaría Ejemplo, Ubaté y el Juzgado 0003 Civil de Ubaté.';
    const part = documento([t]).parts[0]!;
    const conv = candidatesFromNer([tramo(t, 'Notaría Ejemplo de Ubaté', 'ORG', 0.95), tramo(t, 'Notaría Simón Bolívar', 'ORG', 0.95),
      tramo(t, 'Notaría Ejemplo, Ubaté', 'ORG', 0.95), tramo(t, 'Juzgado 0003 Civil de Ubaté', 'ORG', 0.95)],
    { part, options: UMBRALES_MODELO, docDepCodes: [], base: [], ids });
    // Antes de PB-2-r5: nada para las tres primeras (el municipio descartaba la ENTIDAD y R-DESP-01 no admite el nombre propio).
    expect(conv.suggestions.map((s) => `${s.originalText} → ${s.options.map((o) => o.template).join(' | ')}`))
      .toEqual(['Notaría Ejemplo de Ubaté → Notaría Ejemplo de un municipio de {m} | una notaría']);
    expect(conv.suggestions[0]?.options.map((o) => o.depCode)).toEqual(['25', undefined]);
    expect(conv.candidates.map((c) => `${c.type}:${t.slice(c.start, c.end)}:${c.confidence}`))
      .toEqual(['ENTIDAD:Notaría Simón Bolívar:baja', 'ENTIDAD:Notaría Ejemplo, Ubaté:baja']);
    // Sin nombre propio sigue sin nada: «0003» no es un número de despacho (R-DESP-01) ni un nombre.
  });

  it('las ventanas del modelo entran por incorporarModelo en la interfaz, la medición y el gancho de prueba de la Revisión I (P0-6a de PB-2-r4)', () => {
    for (const f of ['src/ui/analisis.ts', 'src/medicion/gancho.ts', 'src/ui/review/base/prueba-medicion.ts', 'tests/medicion/lib/motor.ts']) {
      const fuente = readFileSync(f, 'utf8');
      expect(fuente, f).toMatch(/\bincorporarModelo\(/u);
      expect(fuente, f).not.toMatch(/kind:\s*'incorporar_modelo'/u);
    }
  });

  it('D-03 D despachoDesdeTramo cableado en fusionar: el despacho del modelo no es detección y su sugerencia no se duplica con la del barrido', async () => {
    const t = 'Lo decidió el Juzgado 004 de Familia de Cartago y lo notificó la Notaría Ejemplo.';
    const doc = documento([t]);
    const b = banco();
    const det = resultado<{ kind: 'detectar'; set: DetectionSet }>(await b.enviar('detectar', { sessionId: 'ses_1', doc, caseList: [], table: TABLA, options: OPCIONES }));
    // R-DESP-01 con 3 cifras (D-03 D) ya la propone el barrido de generalize.ts al detectar.
    expect(det.set.suggestions.filter((s) => s.kind === 'DESPACHO_A_GENERICO').map((s) => s.originalText)).toEqual(['Juzgado 004 de Familia de Cartago']);
    const w1 = await ventana(b, 1, 1, { [PRT(1)]: [tramo(t, 'Juzgado 004 de Familia de Cartago', 'ORG', 0.95), tramo(t, 'Notaría Ejemplo', 'ORG', 0.9)] });
    expect(w1.detections.map((d) => `${d.type}:${d.text}:${d.confidence}`)).toEqual(['ENTIDAD:Notaría Ejemplo:baja']);
    expect(w1.suggestions.filter((s) => s.kind === 'DESPACHO_A_GENERICO')).toEqual([]);
    const todo = resultado<Fusion>(await b.enviar('fusionar', { sessionId: 'ses_1', ner: null, nerEngineId: 'nulo' })).set;
    expect(todo.suggestions.filter((s) => s.kind === 'DESPACHO_A_GENERICO')).toHaveLength(1);
  });

  it('7.10.9 una sola fuente de umbrales: UMBRALES_MODELO es la calibración de PF-3 y la usan la interfaz, la medición y el gancho', () => {
    const cal = JSON.parse(readFileSync('metricas/calibracion-umbral.json', 'utf8')) as { nerHighThreshold: number; nerMinScore: number };
    expect(UMBRALES_MODELO).toEqual({ nerHighThreshold: cal.nerHighThreshold, nerMinScore: cal.nerMinScore });
    for (const f of ['src/ui/analisis.ts', 'src/ui/review/base/prueba-medicion.ts', 'tests/medicion/lib/motor.ts']) {
      const fuente = readFileSync(f, 'utf8');
      expect(fuente, f).toContain('...UMBRALES_MODELO');
      expect(fuente, f).not.toMatch(/ner(?:HighThreshold|MinScore)\s*:\s*\d/u);
    }
    // Banda: desde nerHighThreshold, media (inclusivo); por debajo, baja; bajo nerMinScore, descartado.
    const t = 'Firmaron Pedro Prueba Ejemplo, Luisa Ficticia Rojas y Mario Ejemplo Gómez.';
    const part = documento([t]).parts[0]!;
    const conv = candidatesFromNer([
      tramo(t, 'Pedro Prueba Ejemplo', 'PER', UMBRALES_MODELO.nerHighThreshold),
      tramo(t, 'Luisa Ficticia Rojas', 'PER', UMBRALES_MODELO.nerHighThreshold - 0.01),
      tramo(t, 'Mario Ejemplo Gómez', 'PER', UMBRALES_MODELO.nerMinScore - 0.01),
    ], { part, options: UMBRALES_MODELO, docDepCodes: [], base: [], ids });
    expect(conv.candidates.map((c) => `${t.slice(c.start, c.end)}:${c.confidence}`)).toEqual(['Pedro Prueba Ejemplo:media', 'Luisa Ficticia Rojas:baja']);
  });
});

describe('T-MO-12 · D-06 en la tubería: regla estructural, exclusiones para el modelo, expediente citado y sufijo (PB-2-r6)', () => {
  async function detectarCon(texto: string, caseList: CaseEntity[]) {
    const doc = documento([texto]);
    const b = banco();
    const det = resultado<{ kind: 'detectar'; set: DetectionSet }>(await b.enviar('detectar', { sessionId: 'ses_1', doc, caseList, table: TABLA, options: OPCIONES }));
    const ctx: ReviewContext = { table: TABLA, caseList, doc, ids };
    return { b, doc, set: det.set, ctx };
  }

  it('INV-R02 INV-R12 D-06 decisión 5: el correo y el barrio salen enteros con el marcador de la regla aunque la lista tenga una palabra dentro, también tras una ventana', async () => {
    const T = 'La demandante Ana Ejemplo Rojas vive en el barrio Altos del Ejemplo. Escriba a notificaciones@ferreteria-ejemplo.test hoy.';
    const caseList = refreshVariants([newCaseEntity('Ana Ejemplo Rojas', 'persona', 'DEMANDANTE', ids) as CaseEntity,
      newCaseEntity('Ferretería Ejemplo S.A.S.', 'organizacion', 'EMPRESA', ids) as CaseEntity]);
    const { b, doc, set, ctx } = await detectarCon(T, caseList);
    // Con el código anterior: «Ejemplo» (apellido suelto) y «ferreteria-ejemplo» (razón social sin sufijo) partían la regla, y
    // «Altos del», «notificaciones@» y «.test» quedaban a la vista.
    expect(set.detections.map((d) => `${d.type}:${d.source}:${d.text}`).sort())
      .toEqual(['BARRIO:regla:Altos del Ejemplo', 'CORREO:regla:notificaciones@ferreteria-ejemplo.test', 'PERSONA:lista:Ana Ejemplo Rojas']);
    // Una ventana del modelo con un ORG dentro del correo y un LOC dentro del barrio: no entra nada y lo de antes no cambia (INV-R12).
    const w1 = await ventana(b, 1, 1, { [PRT(1)]: [tramo(T, 'ferreteria-ejemplo', 'ORG', 0.9), tramo(T, 'Altos', 'LOC', 0.6)] });
    expect(w1.detections).toEqual([]);
    const st0 = estadoDe(doc, set);
    const st = bien(incorporarModelo(st0, 1, 1, w1, ctx));
    expect(st.detections).toEqual(st0.detections);
    const out = render(doc, st).sections[0]!.text;
    for (const x of ['Altos', 'Ejemplo', 'notificaciones', 'ferreteria', 'test']) expect(out.includes(x), x).toBe(false);
  });

  it('D-06 los contextos de exclusión de PA-7 valen para los tramos PER y ORG del modelo: normas, sentencias, códigos y la norma de una cita de artículo', () => {
    const t = 'Según la Ley 1122 de 2007, el Decreto 1072 de 2015, la Sentencia T-074 de 2020, el artículo 49 de la Constitución Política, '
      + 'el artículo 1546 del Código Civil y la actividad CIIU 8610, Comercial Ejemplo S.A.S. y Ana Ficticia Rojas firmaron el artículo 3 '
      + 'del contrato con Ferretería Ejemplo.';
    const part = documento([t]).parts[0]!;
    const spans = ['Ley 1122 de 2007', 'Decreto 1072 de 2015', 'Sentencia T-074 de 2020', 'Constitución Política', 'Código Civil', 'CIIU 8610',
      'Comercial Ejemplo S.A.S.', 'Ferretería Ejemplo'].map((x) => tramo(t, x, 'ORG', 0.9));
    spans.push(tramo(t, 'Ana Ficticia Rojas', 'PER', 0.9), tramo(t, 'Ley 1122', 'PER', 0.9));
    const conv = candidatesFromNer(spans, { part, options: UMBRALES_MODELO, docDepCodes: [], base: [], ids });
    // Con el código anterior entraban los seis primeros como EMPRESA y «Ley 1122» como PERSONA.
    expect(conv.candidates.map((c) => `${c.type}:${t.slice(c.start, c.end)}`))
      .toEqual(['EMPRESA:Comercial Ejemplo S.A.S.', 'EMPRESA:Ferretería Ejemplo', 'PERSONA:Ana Ficticia Rojas']);
  });

  it('D-06 R-RAD_ADMIN-03 no toma el expediente de tutela citado como precedente (F31); el radicado citado sigue con su bandera CITA_JURISPRUDENCIAL (F32) y el expediente propio entra', async () => {
    const T = 'Como precedente invoco la Sentencia T-074 de 2020 y, en particular, el expediente T-9.000.004, donde se amparó un caso análogo. '
      + 'La Corte Suprema de Justicia, en el proceso con radicado 73001-31-03-999-2019-00022-00, recordó el principio de integralidad.\n'
      + 'Expediente: T-9.000.001';
    const { set } = await detectarCon(T, []);
    const exp = T.indexOf('T-9.000.004');
    // Con el código anterior: RADICADO_ADMIN «T-9.000.004».
    expect(set.detections.filter((d) => d.start < exp + 'T-9.000.004'.length && exp < d.end).map((d) => d.type)).toEqual([]);
    const rad = set.detections.find((d) => d.type === 'RADICADO');
    expect(rad?.text).toBe('73001-31-03-999-2019-00022-00');
    expect(set.flags.some((f) => f.type === 'CITA_JURISPRUDENCIAL' && f.detectionId === rad?.id)).toBe(true);
    expect(set.detections.find((d) => d.text === 'T-9.000.001')?.type).toBe('RADICADO_ADMIN');
  });

  it('D-03 A con el punto que sigue (PF-3-r1): el ORG del modelo que termina en «S.A» justo antes del punto lo toma; el sufijo completo y el PER no', () => {
    const t = 'Pagaron Comercial Ejemplo S.A. y Ferretería Ficticia SAS. Firmó Ana R.';
    const part = documento([t]).parts[0]!;
    const conv = candidatesFromNer([tramo(t, 'Comercial Ejemplo S.A', 'ORG', 0.9), tramo(t, 'Ferretería Ficticia SAS', 'ORG', 0.9),
      tramo(t, 'Ana R', 'PER', 0.9)], { part, options: UMBRALES_MODELO, docDepCodes: [], base: [], ids });
    // Con el código anterior: «Comercial Ejemplo S.A», sin el punto, que el gold sí incluye.
    expect(conv.candidates.map((c) => `${c.type}:${t.slice(c.start, c.end)}`))
      .toEqual(['EMPRESA:Comercial Ejemplo S.A.', 'EMPRESA:Ferretería Ficticia SAS', 'PERSONA:Ana R']);
  });
});

describe('T-MO-12 · A-1 y M-40 de la P0-6a de PB-2-r6: el expediente propio y los nombres tras una norma (PB-2-r7)', () => {
  async function detectarCon(texto: string) {
    const doc = documento([texto]);
    const det = resultado<{ kind: 'detectar'; set: DetectionSet }>(await banco().enviar('detectar', { sessionId: 'ses_1', doc, caseList: [], table: TABLA, options: OPCIONES }));
    return { doc, set: det.set };
  }
  /** Las 13 sondas S5 de la revisión: el expediente del propio caso cerca de la Corte, de un tribunal, de una sala o de una sentencia. */
  const PROPIOS: readonly string[] = [
    'Señores\nCORTE CONSTITUCIONAL\nReferencia: Expediente T-9.000.001',
    'Honorables Magistrados\nCORTE CONSTITUCIONAL\nRef.: expediente T-9.000.001',
    'Señores\nCORTE CONSTITUCIONAL\nReferencia: Acción de tutela. Expediente T-9.000.001',
    'Referencia: Expediente T-9.000.001. Magistrado ponente: Juan Ejemplo Prueba',
    'Solicito a la Corte Constitucional seleccionar para revisión el expediente T-9.000.001.',
    'La Sala de Selección Número Diez de la Corte escogió el expediente T-9.000.001 para revisión.',
    'Presento solicitud de nulidad contra la sentencia proferida dentro del expediente T-9.000.001.',
    'El Tribunal Superior de Ejemplo remitió a la Corte el expediente T-9.000.001 para su eventual revisión.',
    'Otorgo poder especial para actuar ante la Corte Constitucional en el expediente T-9.000.001.',
    'Mediante auto, la Corte decretó pruebas en el expediente T-9.000.001.',
    'La sentencia T-123 de 2026, proferida en el expediente T-9.000.001, amparó los derechos de la accionante.',
    'Tribunal Superior de Ejemplo\nRemite el expediente T-9.000.001',
    'Expediente: T-9.000.001\nSeñores Magistrados de la Corte Constitucional: en el expediente T-9.000.001 se discute la cobertura.',
  ];

  it.each(PROPIOS.map((t, i) => [i + 1, t] as const))('A-1 sonda %i: el expediente propio se toma, con la bandera CITA_JURISPRUDENCIAL si hay contexto de cita, y no queda a la vista', async (_n, T) => {
    const { doc, set } = await detectarCon(T);
    const exps = set.detections.filter((d) => d.text === 'T-9.000.001');
    // Con el código anterior (-r6): ninguna detección del expediente (salvo el «Expediente: T-9.000.001» del inicio de la sonda 13).
    expect(exps.length).toBe((T.match(/T-9\.000\.001/gu) ?? []).length);
    expect(exps.every((d) => d.type === 'RADICADO_ADMIN' && d.status === 'pendiente')).toBe(true);
    for (const d of exps) {
      const cita = set.flags.filter((f) => f.type === 'CITA_JURISPRUDENCIAL' && f.detectionId === d.id);
      expect(cita.length).toBeLessThanOrEqual(1);
      if (cita.length === 1) expect(cita[0]).toMatchObject({ reason: 'RADICADO_EN_CITA', options: [], span: { start: d.start, end: d.end } });
    }
    expect(render(doc, estadoDe(doc, set)).sections[0]!.text.includes('9.000.001')).toBe(false);
  });

  it('A-1 el expediente junto a la Corte, sin señal del propio caso, lleva la bandera; con el rótulo del renglón (B-70, PB-2-r8) o justo antes, no', async () => {
    const { set } = await detectarCon('Honorables Magistrados de la Corte Constitucional: en el expediente T-9.000.001 se discute la cobertura.');
    const d = set.detections.find((x) => x.text === 'T-9.000.001');
    expect(set.flags.filter((f) => f.type === 'CITA_JURISPRUDENCIAL').map((f) => f.detectionId)).toEqual([d?.id]);
    // B-70 (PB-2-r8): el encabezado propio («Referencia: Expediente …» tras la Corte) ya no lleva la bandera; en -r7 la llevaba.
    const encabezado = await detectarCon(PROPIOS[0] as string);
    expect(encabezado.set.detections.map((x) => x.type)).toEqual(['RADICADO_ADMIN']);
    expect(encabezado.set.flags.filter((f) => f.type === 'CITA_JURISPRUDENCIAL')).toEqual([]);
    const solo = await detectarCon('Expediente: T-9.000.001');
    expect(solo.set.detections.map((x) => x.type)).toEqual(['RADICADO_ADMIN']);
    expect(solo.set.flags.filter((f) => f.type === 'CITA_JURISPRUDENCIAL')).toEqual([]);
  });

  it('A-1 las 9 negativas del desarrollo con otra providencia de número y año (D-11) no se toman; con un trámite del propio caso en la oración, sí', async () => {
    const previa = 'El artículo 49 de la Constitución Política y la Ley 1751 de 2015 garantizan el acceso oportuno; además, la Ley 1122 de 2007 regula el trámite de las peticiones.';
    const citas: Array<[string, string]> = [
      ['C-313 de 2014', 'T-9.000.001'], ['T-259 de 2019', 'T-9.000.001'], ['T-074 de 2020', 'T-9.000.004'], ['C-089 de 2011', 'T-9.000.004'],
      ['T-597 de 1993', 'T-9.000.001'], ['T-259 de 2019', 'T-9.000.006'], ['T-121 de 2015', 'T-9.000.006'],
    ];
    const negativos = [
      ...citas.map(([s, e]) => `${previa}\nComo precedente invoco la Sentencia ${s} y, en particular, el expediente ${e}, donde se amparó un caso análogo.\nSobre la prestación de tratamientos.`),
      // C03: el PDF parte la oración antes del expediente.
      `${previa}\nComo precedente invoco la Sentencia T-074 de 2020 y, en particular, el expediente\nT-9.000.004, donde se amparó un caso análogo.\nPRETENSIONES`,
      `${previa}\n\nComo precedente invoco la Sentencia T-121 de 2015 y, en particular, el expediente\nT-9.000.004, donde se amparó un caso análogo.\n\nPRETENSIONES`,
      // La décima (C18, «incluido el expediente T-8.100.002 citado como ejemplo») no cita otra providencia: con D-11 se toma (PB-2-r8).
    ];
    for (const T of negativos) {
      const { set } = await detectarCon(T);
      expect(set.detections.filter((d) => d.type === 'RADICADO_ADMIN').map((d) => d.text), T).toEqual([]);
    }
    for (const T of [
      'Por desconocimiento del precedente, solicito a la Corte Constitucional seleccionar para revisión el expediente T-9.000.001.',
      'Referencia: Expediente T-9.000.001, citado en el auto de la Sala.',
      'Como precedente, la Corte decretó pruebas en el expediente T-9.000.001 de la referencia.',
    ]) {
      const { set } = await detectarCon(T);
      expect(set.detections.filter((d) => d.type === 'RADICADO_ADMIN').map((d) => d.text), T).toEqual(['T-9.000.001']);
    }
  });

  it('M-40 las 9 sondas S4: el tramo del modelo que empieza en la cabeza de la norma y sigue con un nombre conserva el nombre (7.11.2, baja); la norma sola se sigue descartando', () => {
    const casos: Array<[string, string, string]> = [
      ['el artículo 12 del Código de Ética de Clínica Ejemplo S.A.S. dispone', 'Código de Ética de Clínica Ejemplo S.A.S.', 'IPS:Clínica Ejemplo S.A.S.'],
      ['el artículo 3 del Estatuto Social de Inversiones Prueba S.A.S. dispone', 'Estatuto Social de Inversiones Prueba S.A.S.', 'EMPRESA:Inversiones Prueba S.A.S.'],
      ['el artículo 8 de la Convención Colectiva de Ferretería Ejemplo Ltda. dispone', 'Convención Colectiva de Ferretería Ejemplo Ltda.', 'EMPRESA:Ferretería Ejemplo Ltda.'],
      ['el artículo 2 del Pacto Arbitral entre Comercial Ejemplo S.A. y otros', 'Pacto Arbitral entre Comercial Ejemplo S.A.', 'EMPRESA:entre Comercial Ejemplo S.A.'],
      ['el artículo 5 del Estatuto de Ejemplo EPS dispone', 'Estatuto de Ejemplo EPS', 'EPS:Ejemplo EPS'],
      ['el artículo 1 del Pacto Ejemplo S.A.S. dispone', 'Pacto Ejemplo S.A.S.', 'EMPRESA:Ejemplo S.A.S.'],
      ['el artículo 20 del código de comercio de pedro ejemplo gómez dispone', 'código de comercio de pedro ejemplo gómez', 'EMPRESA:pedro ejemplo gómez'],
      ['el artículo 64 del Código Sustantivo del Trabajo Comercial Ejemplo S.A. dispone', 'Código Sustantivo del Trabajo Comercial Ejemplo S.A.', 'EMPRESA:Comercial Ejemplo S.A.'],
      ['EL ARTÍCULO 1546 DEL CÓDIGO CIVIL PEDRO EJEMPLO GÓMEZ DISPONE', 'CÓDIGO CIVIL PEDRO EJEMPLO GÓMEZ', 'EMPRESA:PEDRO EJEMPLO GÓMEZ'],
    ];
    for (const [t, sub, esperado] of casos) {
      const part = documento([t]).parts[0]!;
      const conv = candidatesFromNer([tramo(t, sub, 'ORG', 0.95)], { part, options: UMBRALES_MODELO, docDepCodes: [], base: [], ids });
      // Con el código anterior el tramo se descartaba entero y el nombre quedaba a la vista.
      expect(conv.candidates.map((c) => `${c.type}:${t.slice(c.start, c.end)}`), t).toEqual([esperado]);
      expect(conv.candidates[0]?.confidence).toBe('baja');
    }
    // Un PER que sigue a la norma, también.
    const tp = 'según el artículo 49 de la Constitución Política Pedro Ejemplo Gómez reclamó';
    const per = candidatesFromNer([tramo(tp, 'Constitución Política Pedro Ejemplo Gómez', 'PER', 0.95)],
      { part: documento([tp]).parts[0]!, options: UMBRALES_MODELO, docDepCodes: [], base: [], ids });
    expect(per.candidates.map((c) => `${c.type}:${tp.slice(c.start, c.end)}:${c.confidence}`)).toEqual(['PERSONA:Pedro Ejemplo Gómez:baja']);
    // La norma sola sigue fuera (negativos del desarrollo): «Constitución Política», «Código Civil», «Código General del Proceso».
    const tn = 'el artículo 49 de la Constitución Política, el artículo 1546 del Código Civil y el artículo 90 del Código General del Proceso.';
    const neg = candidatesFromNer(['Constitución Política', 'Código Civil', 'Código General del Proceso'].map((x) => tramo(tn, x, 'ORG', 0.95)),
      { part: documento([tn]).parts[0]!, options: UMBRALES_MODELO, docDepCodes: [], base: [], ids });
    expect(neg.candidates).toEqual([]);
  });
});

describe('T-MO-12 · D-11: el expediente propio nunca queda a la vista (A-1, M-50, B-70 y B-71 de la P0-6a de PB-2-r7; PB-2-r8)', () => {
  async function detectarCon(...textos: string[]) {
    const doc = documento(textos);
    const det = resultado<{ kind: 'detectar'; set: DetectionSet }>(await banco().enviar('detectar', { sessionId: 'ses_1', doc, caseList: [], table: TABLA, options: OPCIONES }));
    return { doc, set: det.set };
  }
  const salida = (doc: DocumentModel, set: DetectionSet): string => render(doc, estadoDe(doc, set)).sections.map((s) => s.text).join('\n');
  const citas = (set: DetectionSet): DetectionSet['flags'] => set.flags.filter((f) => f.type === 'CITA_JURISPRUDENCIAL');

  /** A-1 · Los 11 contextos de S2 con la oración mal cortada o el rótulo en el renglón anterior (en -r7, sin detección ni bandera). */
  const A1: readonly string[] = [
    'Ref.:\nT-9.000.001\nAsunto: desconocimiento del precedente',
    'Referencia:\nT-9.000.001\nAsunto: Desconocimiento del precedente constitucional',
    'Expediente\nT-9.000.001\nTema: precedente sobre la cobertura de tratamientos',
    'REF.:\nEXPEDIENTE:\nT-9.000.001\nASUNTO: DESCONOCIMIENTO DEL PRECEDENTE',
    'Ref.: Expediente\nT-9.000.001 · desconocimiento del precedente',
    'V. DESCONOCIMIENTO DEL PRECEDENTE\nLa Sala Novena, al fallar el expediente T-9.000.001, negó el amparo.',
    'IV. PRECEDENTE APLICABLE\nLa accionante interpuso tutela en el expediente T-9.000.001 contra Ejemplo EPS.',
    'Como precedente invoco la Sentencia T-074 de 2020 contra Comercial Ejemplo S.A. La accionante actuó en el expediente T-9.000.001.',
    'Como precedente invoco la Sentencia T-074 de 2020, con ponencia del Dr. Ejemplo\nLa accionante actuó en el expediente T-9.000.001.',
    'Como precedente invoco la Sentencia T-074 de 2020, M.P. Ana Ejemplo R. La accionante actuó en el expediente T-9.000.001.',
    'Como precedente invoco la Sentencia T-074 de 2020. el expediente T-9.000.001 corresponde a mi tutela.',
  ];
  /** M-50 · Los 9 contextos de S2 con la señal en la misma oración (en -r7, sin detección ni bandera). */
  const M50: readonly string[] = [
    'En la sentencia T-123 de 2026, expediente T-9.000.001, la Corte me amparó el derecho a la salud.',
    'Tal como se ordenó en la sentencia T-123 de 2026 (expediente T-9.000.001), la EPS debe autorizar el procedimiento.',
    'La Sala Novena desconoció el precedente de la Sentencia SU-123 de 2020 al decidir el expediente T-9.000.001.',
    'LA SALA NOVENA DESCONOCIÓ EL PRECEDENTE DE LA SENTENCIA SU-123 DE 2020 AL DECIDIR EL EXPEDIENTE T-9.000.001.',
    'Esta tutela no es temeraria: la anterior, expediente T-9.000.001, como lo reconoce el precedente de la Corte, se fundó en otros hechos.',
    'Cfr. folio 12 del cuaderno principal del expediente T-9.000.001.',
    'Véase el escrito de tutela, expediente T-9.000.001, folio 2.',
    'La accionante invoca como precedente su propia tutela, expediente T-9.000.001, que fue amparada.',
    'Como precedente invoco la Sentencia T-074 de 2020; la accionante actuó en el expediente T-9.000.001.',
  ];
  /** Los 14 contextos de S2 que -r7 ya tomaba: siguen tomándose. */
  const BIEN: readonly string[] = [
    'Solicito abrir incidente de desacato por el incumplimiento de la sentencia T-123 de 2026, proferida dentro del expediente T-9.000.001.',
    'La EPS no ha cumplido la orden dada en el expediente T-9.000.001.',
    'En el expediente T-9.000.001 la Corte amparó a la accionante; la EPS incumplió y por eso promuevo el desacato.',
    'Pido el cumplimiento del fallo dictado en el expediente T-9.000.001.',
    'Por desconocimiento del precedente, la accionante insiste en la selección del expediente T-9.000.001.',
    'Por desconocimiento del precedente constitucional, insisto en que se revise el expediente T-9.000.001.',
    'POR DESCONOCIMIENTO DEL PRECEDENTE, LA ACCIONANTE INSISTE EN LA SELECCIÓN DEL EXPEDIENTE T-9.000.001.',
    'Ref.\nExpediente T-9.000.001',
    'Expediente: T-9.000.001\nAsunto: desconocimiento del precedente',
    'SEÑORES\nCORTE CONSTITUCIONAL\nREFERENCIA: EXPEDIENTE T-9.000.001\nASUNTO: INSISTENCIA',
    'HONORABLES MAGISTRADOS\nREF.: EXPEDIENTE T-9.000.001',
    'Como precedente invoco la Sentencia T-074 de 2020. La accionante actuó en el expediente T-9.000.001.',
    'La accionante actuó en el expediente T-9.000.001. Como precedente invoco la Sentencia T-074 de 2020.',
    '¡Como precedente invoco la Sentencia T-074 de 2020! La accionante actuó en el expediente T-9.000.001.',
  ];
  const casos = [...A1.map((t, i) => ['A-1', i + 1, t] as const), ...M50.map((t, i) => ['M-50', i + 1, t] as const),
    ...BIEN.map((t, i) => ['S2 tomado en -r7', i + 1, t] as const)];

  it('los 34 contextos de S2: 11 de A-1, 9 de M-50 y 14 que ya se tomaban', () => {
    expect([A1.length, M50.length, BIEN.length]).toEqual([11, 9, 14]);
  });

  it.each(casos)('%s, contexto %i: el expediente propio se toma y no queda a la vista', async (_h, _n, T) => {
    const { doc, set } = await detectarCon(T);
    const exps = set.detections.filter((d) => d.text === 'T-9.000.001');
    // Con el código de -r7, A-1 y M-50 quedaban sin detección ni bandera, con el número en la salida.
    expect(exps.length).toBe(1);
    expect(exps[0]).toMatchObject({ type: 'RADICADO_ADMIN', status: 'pendiente' });
    expect(salida(doc, set).includes('9.000.001')).toBe(false);
    expect(citas(set).length).toBeLessThanOrEqual(1);
  });

  it('D-11 · las negativas con otra providencia de número y año en la oración no se toman (las 2 del desarrollo, C03 partida y los ejemplos de D-11), también en MAYÚSCULAS', async () => {
    for (const T of [
      'Como precedente invoco la Sentencia T-074 de 2020 y, en particular, el expediente T-9.000.004, donde se amparó un caso análogo.',
      'Como precedente invoco la Sentencia C-313 de 2014 y, en particular, el expediente T-9.000.004, donde se amparó un caso análogo.',
      'Como precedente invoco la Sentencia T-074 de 2020 y, en particular, el expediente\nT-9.000.004, donde se amparó un caso análogo.',
      'COMO PRECEDENTE INVOCO LA SENTENCIA T-074 DE 2020 Y, EN PARTICULAR, EL EXPEDIENTE\nT-9.000.004, DONDE SE AMPARÓ UN CASO ANÁLOGO.',
      'Así lo resolvió la Corte en la sentencia T-123 de 2019, expediente T-9.000.004.',
      'El mismo criterio se aplicó en el expediente T-9.000.004, que dio lugar a la T-456 de 2020.',
      'Cfr. Corte Constitucional, Sentencia T-760 de 2008, M.P. Ana Ficticia Rojas, expediente T-9.000.004.',
      'Ver la Sentencia SU-508/20 (expediente T-9.000.004), sobre la integralidad.',
    ]) {
      const { set } = await detectarCon(T);
      expect(set.detections.filter((d) => d.type === 'RADICADO_ADMIN').map((d) => d.text), T).toEqual([]);
    }
  });

  it('D-11 · sin otra providencia de número y año, el expediente citado se toma, con la bandera si hay señal de cita: «citado como ejemplo» (C18), «Cfr.», «véase», «caso análogo»', async () => {
    for (const [T, bandera] of [
      ['CLÁUSULA QUINTA. CONFIDENCIALIDAD. El contratista guardará reserva sobre la información de sus clientes, incluido el expediente T-8.100.002 citado como ejemplo.', true],
      ['Cfr. expediente T-8.100.002.', true],
      ['Véase también el expediente T-8.100.002.', true],
      ['Como precedente, véase la sentencia T-1 y el expediente T-8.100.002.', true],
      // «caso análogo» no es una señal de cita de 7.3.3: se toma sin bandera.
      ['En el expediente T-8.100.002 se resolvió un caso análogo.', false],
    ] as const) {
      const { set } = await detectarCon(T);
      const d = set.detections.find((x) => x.text === 'T-8.100.002');
      // Con el código de -r7 no se tomaban.
      expect(d?.type, T).toBe('RADICADO_ADMIN');
      expect(citas(set).map((f) => f.detectionId), T).toEqual(bandera ? [d?.id] : []);
    }
  });

  it('D-11 condición 3 · la misma clave en otra mención que se toma (en la misma parte o en otra): el expediente citado se toma; sin bandera si la otra va sin cita (B-70)', async () => {
    const cita = 'Como precedente invoco la Sentencia T-074 de 2020 y, en particular, el expediente T-9.000.001, donde se amparó un caso análogo.';
    // Con un renglón de por medio, para que el rótulo no sea el del renglón anterior (otra señal del propio caso).
    for (const [textos, banderas] of [
      [[`Expediente: T-9.000.001\nI. HECHOS\n${cita}`], 0],
      [['Referencia: Expediente T-9.000.001', cita], 0],
      [[cita, 'Expediente: T-9.000.001'], 0],
      // La otra mención va en contexto de cita («T-074» en los 150 caracteres de antes, R-CIT-01): las dos se toman, con su bandera.
      [[`${cita}\nII. PRETENSIONES\nSe ampare el derecho en el expediente T-9.000.001.`], 2],
    ] as const) {
      const { doc, set } = await detectarCon(...textos);
      const exps = set.detections.filter((d) => d.text === 'T-9.000.001');
      // Con el código de -r7, la mención citada quedaba sin detección.
      expect(exps.length, textos.join(' | ')).toBe(2);
      expect(new Set(exps.map((d) => d.entityId)).size).toBe(1);
      expect(citas(set).length, textos.join(' | ')).toBe(banderas);
      expect(salida(doc, set).includes('9.000.001')).toBe(false);
    }
    // Control: otra clave en la otra mención no la rescata.
    for (const textos of [[`Expediente: T-9.000.002\nI. HECHOS\n${cita}`], ['Referencia: Expediente T-9.000.002', cita]]) {
      const { set } = await detectarCon(...textos);
      expect(set.detections.filter((d) => d.type === 'RADICADO_ADMIN').map((d) => d.text)).toEqual(['T-9.000.002']);
    }
  });

  it('B-70 · la bandera no cae sobre el expediente con una señal del propio caso: rótulo del renglón o del anterior, trámite o la misma clave sin cita', async () => {
    for (const T of [
      'Señores\nCORTE CONSTITUCIONAL\nReferencia: Expediente T-9.000.001',
      'Honorables Magistrados\nCORTE CONSTITUCIONAL\nRef.: expediente T-9.000.001',
      'Señores\nCORTE CONSTITUCIONAL\nReferencia:\nT-9.000.001',
      'SOLICITO A LA CORTE CONSTITUCIONAL SELECCIONAR PARA REVISIÓN EL EXPEDIENTE T-9.000.001.',
      'El Tribunal Superior de Ejemplo remitió a la Corte el expediente T-9.000.001 para su eventual revisión.',
      'Expediente: T-9.000.001\nSeñores Magistrados de la Corte Constitucional: en el expediente T-9.000.001 se discute la cobertura.',
    ]) {
      const { set } = await detectarCon(T);
      const exps = set.detections.filter((d) => d.text === 'T-9.000.001');
      expect(exps.length, T).toBe((T.match(/T-9\.000\.001/gu) ?? []).length);
      // Con el código de -r7, cada uno llevaba CITA_JURISPRUDENCIAL; con «mantener», el número quedaba a la vista.
      expect(citas(set), T).toEqual([]);
    }
  });

  it('B-71 · las palabras de la lista de complementos que también son nombres van con el resto del tramo: no quedan a la vista; la norma sola se sigue descartando', () => {
    const casos: Array<[string, string, string, 'ORG' | 'PER']> = [
      ['el artículo 12 del Código de Ética de Protección Ejemplo S.A.S. dispone', 'Código de Ética de Protección Ejemplo S.A.S.', 'EMPRESA:Protección Ejemplo S.A.S.', 'ORG'],
      ['el artículo 8 de la Convención Colectiva de Colombiana de Ejemplo S.A. dispone', 'Convención Colectiva de Colombiana de Ejemplo S.A.', 'EMPRESA:Colombiana de Ejemplo S.A.', 'ORG'],
      ['según el artículo 1546 del Código Civil Tránsito Ejemplo Gómez reclamó', 'Código Civil Tránsito Ejemplo Gómez', 'PERSONA:Tránsito Ejemplo Gómez', 'PER'],
      ['el artículo 64 del Código Sustantivo del Trabajo Seguridad Ejemplo Ltda. dispone', 'Código Sustantivo del Trabajo Seguridad Ejemplo Ltda.', 'EMPRESA:Seguridad Ejemplo Ltda.', 'ORG'],
      ['el artículo 5 del Código de la Infancia y la Adolescencia Familia Ejemplo S.A.S. dispone', 'Código de la Infancia y la Adolescencia Familia Ejemplo S.A.S.', 'EMPRESA:Familia Ejemplo S.A.S.', 'ORG'],
      ['EL ARTÍCULO 3 DEL ESTATUTO NACIONAL DE EJEMPLO S.A. DISPONE', 'ESTATUTO NACIONAL DE EJEMPLO S.A.', 'EMPRESA:NACIONAL DE EJEMPLO S.A.', 'ORG'],
      ['el artículo 7 del Código de Ética de Nacional Ejemplo S.A. dispone', 'Código de Ética de Nacional Ejemplo S.A.', 'EMPRESA:Nacional Ejemplo S.A.', 'ORG'],
      ['según el artículo 131 del Código Nacional de Tránsito Terrestre Pedro Ejemplo Gómez pagó', 'Código Nacional de Tránsito Terrestre Pedro Ejemplo Gómez', 'PERSONA:Pedro Ejemplo Gómez', 'PER'],
    ];
    for (const [t, sub, esperado, label] of casos) {
      const conv = candidatesFromNer([tramo(t, sub, label, 0.95)], { part: documento([t]).parts[0]!, options: UMBRALES_MODELO, docDepCodes: [], base: [], ids });
      // Con el código de -r7, «Protección», «Colombiana de», «Tránsito», «Seguridad», «Familia», «NACIONAL DE» y «Nacional» quedaban fuera.
      expect(conv.candidates.map((c) => `${c.type}:${t.slice(c.start, c.end)}`), t).toEqual([esperado]);
    }
    // La norma sola, con sus complementos ambiguos dentro, sigue fuera.
    const tn = 'según el artículo 131 del Código Nacional de Tránsito Terrestre, el artículo 90 del Código General del Proceso y el artículo 2 del Estatuto Nacional.';
    const neg = candidatesFromNer(['Código Nacional de Tránsito Terrestre', 'Código General del Proceso', 'Estatuto Nacional'].map((x) => tramo(tn, x, 'ORG', 0.95)),
      { part: documento([tn]).parts[0]!, options: UMBRALES_MODELO, docDepCodes: [], base: [], ids });
    expect(neg.candidates).toEqual([]);
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

describe('T-MO-12 · exportGate con el avance del modelo (INV-R11, PC-5)', () => {
  const todas = { biometricos: true, reservaLegal: true, estrategia: true };
  const residuoDe = (s: ReviewState): ResidueResult => ({ revision: s.revision, ranAt: '2026-10-30T10:00:00-05:00', valuesSearched: 3,
    modes: ['literal', 'normalizado', 'digitos', 'variante'], hits: [], newDetections: 0 });

  it('INV-R11 MODELO_EN_CURSO mientras el modelo sigue en curso, aunque no haya pendientes; con terminado o plan_b desaparece', async () => {
    const { b, doc, set } = await arrancar();
    const ctx = ctxDe(doc);
    let st = estadoDe(doc, set);
    // Se deciden todas las detecciones de reglas y se confirman las banderas: la única razón que queda es el modelo.
    for (const d of Object.values(st.detections)) st = bien(applyReviewAction(st, { kind: 'aceptar', detectionId: d.id }, ctx));
    for (const f of Object.values(st.flags)) st = bien(applyReviewAction(st, { kind: 'resolver_bandera', flagId: f.id, resolution: 'mantener' }, ctx));
    expect(st.modelo.kind).toBe('en_curso');
    expect(exportGate(st, residuoDe(st), todas).reasons).toEqual(['MODELO_EN_CURSO']);

    // Una ventana sin detecciones nuevas: la revisión sube y el modelo sigue en curso.
    const w1 = await ventana(b, 1, 3, {});
    st = bien(incorporarModelo(st, 1, 3, w1, ctx));
    expect(st.modelo.kind).toBe('en_curso');
    expect(exportGate(st, residuoDe(st), todas).reasons).toEqual(['MODELO_EN_CURSO']);

    // Plan B declarado en mitad del documento: la razón desaparece y la puerta se abre.
    const planB = bien(declararPlanB(st, 'cancelado', ctx));
    expect(planB.modelo.kind).toBe('plan_b');
    expect(exportGate(planB, residuoDe(planB), todas)).toEqual({ ok: true, reasons: [] });

    // Modelo terminado (última ventana): igual.
    const w2 = await ventana(b, 2, 3, {});
    const w3 = await ventana(b, 3, 3, {});
    let fin = bien(incorporarModelo(st, 2, 3, w2, ctx));
    expect(exportGate(fin, residuoDe(fin), todas).reasons).toEqual(['MODELO_EN_CURSO']);
    fin = bien(incorporarModelo(fin, 3, 3, w3, ctx));
    expect(fin.modelo).toEqual({ kind: 'terminado', ventanas: 3, respaldo: false });
    expect(exportGate(fin, residuoDe(fin), todas)).toEqual({ ok: true, reasons: [] });
  });

  it('INV-R11 una ventana con detecciones del modelo deja PENDIENTES además de MODELO_EN_CURSO, y decidirlas no quita la segunda', async () => {
    const { b, doc, set } = await arrancar();
    const ctx = ctxDe(doc);
    let st = estadoDe(doc, set);
    for (const d of Object.values(st.detections)) st = bien(applyReviewAction(st, { kind: 'aceptar', detectionId: d.id }, ctx));
    for (const f of Object.values(st.flags)) st = bien(applyReviewAction(st, { kind: 'resolver_bandera', flagId: f.id, resolution: 'mantener' }, ctx));
    const w1 = await ventana(b, 1, 3, { [PRT(1)]: [tramo(TEXTO, 'Luisa Ejemplo Prueba', 'PER', 0.97)] });
    st = bien(incorporarModelo(st, 1, 3, w1, ctx));
    expect(exportGate(st, residuoDe(st), todas).reasons).toEqual(['PENDIENTES', 'MODELO_EN_CURSO']);
    for (const d of Object.values(st.detections)) {
      if (d.status === 'pendiente') st = bien(applyReviewAction(st, { kind: 'aceptar', detectionId: d.id }, ctx));
    }
    expect(exportGate(st, residuoDe(st), todas).reasons).toEqual(['MODELO_EN_CURSO']);
  });
});
