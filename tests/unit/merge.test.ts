// T-MO-05 · Precedencia y solapamientos (plan 7.11.4), INV-R02, INV-R03 e INV-R04. Solo datos ficticios.
import { describe, expect, it } from 'vitest';
import { edgeRightLength, mergeCandidates, precedenceOf, RE_TRIM_LEFT, RE_TRIM_RIGHT, resolveRemainder } from '../../src/core/merge.ts';
import { buildSearchView } from '../../src/core/normalize.ts';
import type {
  CaseEntityId, Confidence, DataType, DetectionCandidate, DocId, LabelHit, MergeCandidatesFn, MergedCandidate, Part, PartId,
  PartKind, RuleRegistry, ValidatorResult,
} from '../../src/core/types.ts';

const PART_ID = 'prt_00000000000000000000000000000001' as PartId;
const OTHER_PART = 'prt_00000000000000000000000000000002' as PartId;
const DOC_ID = 'doc_00000000000000000000000000000001' as DocId;
const CAS_A = 'cas_0000000000000000000000000000000a' as CaseEntityId;
const CAS_B = 'cas_0000000000000000000000000000000b' as CaseEntityId;
const CAS_F = 'cas_0000000000000000000000000000000f' as CaseEntityId;
const NOMINAL: Record<Confidence, number> = { alta: 0.9, media: 0.6, baja: 0.3 };

const mkPart = (text: string, kind: PartKind = 'cuerpo'): Part =>
  ({ id: PART_ID, docId: DOC_ID, kind, label: 'Cuerpo', order: 0, index: 1, text, included: true });

type Src = 'manual' | 'lista' | 'regla' | 'modelo';
type Spec = Partial<DetectionCandidate> & { type: DataType; source: Src; canonicalKey: string };
/** Candidato sobre la aparición `occ` de `sub` en `text`. */
function mk(text: string, sub: string, spec: Spec, occ = 0): DetectionCandidate {
  let i = -1;
  for (let k = 0; k <= occ; k++) i = text.indexOf(sub, i + 1);
  if (i < 0) throw new Error(`falta «${sub}»`);
  const confidence = spec.confidence ?? 'media';
  return { partId: PART_ID, start: i, end: i + sub.length, confidence, score: NOMINAL[confidence], ...spec };
}
const label = (labelId: string): LabelHit => ({ labelId, start: 0, end: 0 });
const ok = (name: ValidatorResult['name']): ValidatorResult => ({ name, passed: true });
const ko = (name: ValidatorResult['name']): ValidatorResult => ({ name, passed: false });
/** regla/3 (validador estructural que pasa), regla/4 (rótulo), regla/5 (sin rótulo). */
const r3 = (name: ValidatorResult['name'] = 'RADICADO') => ({ source: 'regla' as const, validator: ok(name) });
const r4 = { source: 'regla' as const, label: label('rotulo') };
const r5 = { source: 'regla' as const };

const NO_RULES: RuleRegistry = { rerun: () => null };
const registry = (fns: Record<string, (t: string) => { start: number; end: number; canonicalKey: string } | null>): RuleRegistry =>
  ({ rerun: (id, t) => fns[id]?.(t) ?? null });
/** Regla de celular de prueba (3 + 9 dígitos) para `rerun`. */
const celular = (t: string) => {
  const m = /(?<![0-9])3[0-9]{2}[ -]?[0-9]{3}[ -]?[0-9]{4}(?![0-9])/u.exec(t);
  return m ? { start: m.index, end: m.index + m[0].length, canonicalKey: 'TEL:' + m[0].replace(/[^0-9]/g, '') } : null;
};

const show = (text: string, out: readonly MergedCandidate[]) => out.map((d) =>
  `${d.type}:«${text.slice(d.start, d.end)}»:${d.confidence}${d.extended ? ':extendido' : ''}${d.fragment ? ':fragmento' : ''}`);

const isHigh = (u: number) => u >= 0xd800 && u <= 0xdbff;
const isLow = (u: number) => u >= 0xdc00 && u <= 0xdfff;
const splitsPair = (t: string, i: number) => i > 0 && i < t.length && isHigh(t.charCodeAt(i - 1)) && isLow(t.charCodeAt(i));

/** INV-R02, INV-R04 y 6.1.3 sobre cualquier salida. */
function assertInvariants(part: Part, out: readonly MergedCandidate[]): void {
  for (let i = 0; i < out.length; i++) {
    const d = out[i] as MergedCandidate;
    expect(d.partId).toBe(part.id);
    expect(d.start).toBeGreaterThanOrEqual(0);
    expect(d.end).toBeLessThanOrEqual(part.text.length);
    expect(d.end).toBeGreaterThan(d.start);
    expect(splitsPair(part.text, d.start) || splitsPair(part.text, d.end)).toBe(false);
    expect(d.precedence).toBe(precedenceOf(d));
    if (i > 0) expect((out[i - 1] as MergedCandidate).end).toBeLessThanOrEqual(d.start);   // sin solapes y por inicio
  }
}
function run(text: string, cands: DetectionCandidate[], rules: RuleRegistry = NO_RULES, kind: PartKind = 'cuerpo') {
  const part = mkPart(text, kind);
  const out = mergeCandidates(part, cands, rules);
  assertInvariants(part, out);
  return out;
}

describe('T-MO-05 · tabla de decisiones de 7.11.4', () => {
  it('INV-R02 M1 radicado absorbe el año y el número contenidos', () => {
    const t = 'Radicado 90001-31-03-999-2026-00123-00 del Juzgado';
    const out = run(t, [
      mk(t, '90001-31-03-999-2026-00123-00', { type: 'RADICADO', ...r3(), confidence: 'alta', canonicalKey: 'RAD:90001310399920260012300' }),
      mk(t, '2026', { type: 'FECHA', ...r5, confidence: 'baja', canonicalKey: 'FECHA:2026' }),
      mk(t, '00123', { type: 'CC', ...r5, confidence: 'baja', canonicalKey: 'CC:00123' }),
    ]);
    expect(show(t, out)).toEqual(['RADICADO:«90001-31-03-999-2026-00123-00»:alta']);
    expect(out[0]?.precedence).toBe(3);
  });

  it('INV-R02 M2 dirección gana; el teléfono queda como fragmento con clave TEL:~', () => {
    const t = 'Calle 00 # 00-00 300 000 0001, Villa Ejemplo';
    const out = run(t, [
      mk(t, 'Calle 00 # 00-00 300', { type: 'DIRECCION', ...r4, ruleId: 'R-DIR-01', confidence: 'alta', canonicalKey: 'DIR:CL 00 00 00 300' }),
      mk(t, '300 000 0001', { type: 'TELEFONO', ...r5, ruleId: 'R-TEL-01', validator: ok('NDC'), canonicalKey: 'TEL:3000000001' }),
    ], registry({ 'R-TEL-01': celular }));
    expect(show(t, out)).toEqual(['DIRECCION:«Calle 00 # 00-00 300»:alta', 'TELEFONO:«000 0001»:baja:fragmento']);
    expect(out[1]?.canonicalKey).toBe('TEL:~000 0001');
    expect(out[1]?.score).toBe(0.3);
    expect(out[1]?.validator).toBeUndefined();
  });

  it('INV-R02 M2b número tipo celular dentro de la dirección rural', () => {
    const t = 'Kilómetro 3 vía Villa Ejemplo, predio 3000000001';
    const out = run(t, [
      mk(t, t, { type: 'DIRECCION', ...r4, confidence: 'alta', canonicalKey: 'DIR:KM 3' }),
      mk(t, '3000000001', { type: 'TELEFONO', ...r5, ruleId: 'R-TEL-01', canonicalKey: 'TEL:3000000001' }),
    ], registry({ 'R-TEL-01': celular }));
    expect(show(t, out)).toEqual([`DIRECCION:«${t}»:alta`]);
  });

  it('INV-R02 M3 la lista gana; el ORG del modelo se parte, se recorta «de» y se recalcula su clave', () => {
    const t = 'Pagó la Ferretería Ejemplo de Ana Ficticia ayer';
    const out = run(t, [
      mk(t, 'Ana Ficticia', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, canonicalKey: `LISTA:${CAS_A}` }),
      mk(t, 'Ferretería Ejemplo de Ana Ficticia', { type: 'EMPRESA', source: 'modelo', nerLabel: 'ORG', score: 0.8, canonicalKey: 'ORG:ferreteria ejemplo de ana ficticia' }),
    ]);
    expect(show(t, out)).toEqual(['EMPRESA:«Ferretería Ejemplo»:baja', 'PERSONA:«Ana Ficticia»:media']);
    expect(out[0]?.canonicalKey).toBe('ORG:ferreteria ejemplo');
    expect(out[0]?.score).toBe(0.8);
  });

  it('INV-R02 M3b igual precedencia: gana la razón social completa de la lista', () => {
    const t = 'Pagó la Ferretería Ejemplo de Ana Ficticia ayer';
    const out = run(t, [
      mk(t, 'Ana Ficticia', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, canonicalKey: `LISTA:${CAS_A}` }),
      mk(t, 'Ferretería Ejemplo de Ana Ficticia', { type: 'EMPRESA', source: 'lista', caseEntityId: CAS_F, confidence: 'alta', canonicalKey: `LISTA:${CAS_F}` }),
    ]);
    expect(show(t, out)).toEqual(['EMPRESA:«Ferretería Ejemplo de Ana Ficticia»:alta']);
  });

  it('INV-R02 M4 el NIT con DV correcto absorbe la CC y guarda holderDigits', () => {
    const t = 'NIT 41.000.001-7 del contratista';
    const out = run(t, [
      mk(t, '41.000.001-7', { type: 'NIT', ...r3('DV_NIT'), label: label('nit'), confidence: 'alta', canonicalKey: 'NIT:41000001' }),
      mk(t, '41.000.001', { type: 'CC', ...r5, canonicalKey: 'CC:41000001' }),
    ]);
    expect(show(t, out)).toEqual(['NIT:«41.000.001-7»:alta']);
    expect(out[0]?.holderDigits).toBe('41000001');
  });

  it('INV-R02 M5 radicado validado gana a la tarjeta contenida', () => {
    const t = 'proceso 90001310399920260012300 en curso';
    const out = run(t, [
      mk(t, '90001310399920260012300', { type: 'RADICADO', ...r3(), confidence: 'alta', canonicalKey: 'RAD:90001310399920260012300' }),
      mk(t, '1310399920260012', { type: 'TARJETA', ...r5, canonicalKey: 'CUENTA:1310399920260012' }),
    ]);
    expect(show(t, out)).toEqual(['RADICADO:«90001310399920260012300»:alta']);
  });

  it('INV-R02 M5b igual precedencia (los validadores fallan): gana el más largo', () => {
    const t = 'proceso 90001310399920260012300 en curso';
    const out = run(t, [
      mk(t, '90001310399920260012300', { type: 'RADICADO', ...r5, validator: ko('RADICADO'), canonicalKey: 'RAD:90001310399920260012300' }),
      mk(t, '1310399920260012', { type: 'TARJETA', ...r5, canonicalKey: 'CUENTA:1310399920260012' }),
    ]);
    expect(show(t, out)).toEqual(['RADICADO:«90001310399920260012300»:media']);
    expect(out[0]?.precedence).toBe(5);
  });

  it('INV-R02 M6 valor en letras y cifra entre paréntesis con la misma clave: un tramo (R-MRG-01)', () => {
    const t = 'la suma de cuarenta y ocho millones de pesos ($48.000.000) por concepto';
    const out = run(t, [
      mk(t, 'cuarenta y ocho millones de pesos', { type: 'VALOR', ...r5, ruleId: 'R-VAL-04', canonicalKey: 'VALOR:48000000' }),
      mk(t, '$48.000.000', { type: 'VALOR', ...r5, ruleId: 'R-VAL-01', confidence: 'alta', canonicalKey: 'VALOR:48000000' }),
    ]);
    expect(show(t, out)).toEqual(['VALOR:«cuarenta y ocho millones de pesos ($48.000.000)»:alta']);
  });

  it('INV-R02 M6b claves distintas no se unen', () => {
    const t = 'la suma de cuarenta y ocho millones de pesos ($84.000.000) por concepto';
    const out = run(t, [
      mk(t, 'cuarenta y ocho millones de pesos', { type: 'VALOR', ...r5, canonicalKey: 'VALOR:48000000' }),
      mk(t, '$84.000.000', { type: 'VALOR', ...r5, confidence: 'alta', canonicalKey: 'VALOR:84000000' }),
    ]);
    expect(show(t, out)).toEqual(['VALOR:«cuarenta y ocho millones de pesos»:media', 'VALOR:«$84.000.000»:alta']);
  });

  it('INV-R02 M7 fecha en letras y en cifras: un tramo (R-MRG-01)', () => {
    const t = 'el catorce de marzo de dos mil veintiséis (14/03/2026) se radicó';
    const out = run(t, [
      mk(t, 'catorce de marzo de dos mil veintiséis', { type: 'FECHA', ...r5, canonicalKey: 'FECHA:2026-03-14' }),
      mk(t, '14/03/2026', { type: 'FECHA', ...r5, canonicalKey: 'FECHA:2026-03-14' }),
    ]);
    expect(show(t, out)).toEqual(['FECHA:«catorce de marzo de dos mil veintiséis (14/03/2026)»:media']);
  });

  it('INV-R02 M8 el modelo extiende el nombre de la lista con una palabra en mayúscula', () => {
    const t = 'Ana Ficticia Rojas Prueba declaró';
    const out = run(t, [
      mk(t, 'Ana Ficticia Rojas', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, confidence: 'alta', canonicalKey: `LISTA:${CAS_A}` }),
      mk(t, 'Ana Ficticia Rojas Prueba', { type: 'PERSONA', source: 'modelo', nerLabel: 'PER', canonicalKey: 'PER:ana ficticia rojas prueba' }),
    ]);
    expect(show(t, out)).toEqual(['PERSONA:«Ana Ficticia Rojas Prueba»:media:extendido']);
    expect(out[0]).toMatchObject({ source: 'lista', precedence: 2, caseEntityId: CAS_A, canonicalKey: `LISTA:${CAS_A}`, score: 0.6 });
  });

  it('INV-R02 M8b no extiende con minúscula; el remanente sin mayúscula se descarta', () => {
    const t = 'Ana Ficticia Rojas identificada con';
    const out = run(t, [
      mk(t, 'Ana Ficticia Rojas', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, confidence: 'alta', canonicalKey: `LISTA:${CAS_A}` }),
      mk(t, 'Ana Ficticia Rojas identificada', { type: 'PERSONA', source: 'modelo', nerLabel: 'PER', canonicalKey: 'PER:ana ficticia rojas identificada' }),
    ]);
    expect(show(t, out)).toEqual(['PERSONA:«Ana Ficticia Rojas»:alta']);
  });

  it('INV-R02 M8c el tratamiento no extiende; el remanente «Dra.» se descarta', () => {
    const t = 'la Dra. Ana Ficticia Rojas firmó';
    const out = run(t, [
      mk(t, 'Ana Ficticia Rojas', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, confidence: 'alta', canonicalKey: `LISTA:${CAS_A}` }),
      mk(t, 'Dra. Ana Ficticia Rojas', { type: 'PERSONA', source: 'modelo', nerLabel: 'PER', canonicalKey: 'PER:dra ana ficticia rojas' }),
    ]);
    expect(show(t, out)).toEqual(['PERSONA:«Ana Ficticia Rojas»:alta']);
  });

  it('INV-R02 M9 mismo tramo en el modelo y en la lista: gana la lista', () => {
    const t = 'Ana Ficticia Rojas firmó';
    const out = run(t, [
      mk(t, 'Ana Ficticia Rojas', { type: 'PERSONA', source: 'modelo', nerLabel: 'PER', canonicalKey: 'PER:ana ficticia rojas' }),
      mk(t, 'Ana Ficticia Rojas', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, confidence: 'alta', canonicalKey: `LISTA:${CAS_A}` }),
    ]);
    expect(show(t, out)).toEqual(['PERSONA:«Ana Ficticia Rojas»:alta']);
    expect(out[0]?.source).toBe('lista');
  });

  it('INV-R02 M10 el rótulo sube la precedencia: CUENTA gana a la CC sin rótulo', () => {
    const t = 'consignar en la cuenta 1000000017 del banco';
    const out = run(t, [
      mk(t, '1000000017', { type: 'CC', ...r5, canonicalKey: 'CC:1000000017' }),
      mk(t, '1000000017', { type: 'CUENTA', ...r4, confidence: 'alta', canonicalKey: 'CUENTA:1000000017' }),
    ]);
    expect(show(t, out)).toEqual(['CUENTA:«1000000017»:alta']);
    expect(out[0]?.precedence).toBe(4);
  });

  it('INV-R02 M11 empate total: decide el orden fijo de tipos (CC antes que TELEFONO)', () => {
    const t = 'número 1000000025 sin contexto';
    const a = mk(t, '1000000025', { type: 'TELEFONO', ...r5, confidence: 'baja', canonicalKey: 'TEL:1000000025' });
    const b = mk(t, '1000000025', { type: 'CC', ...r5, confidence: 'baja', canonicalKey: 'CC:1000000025' });
    expect(show(t, run(t, [a, b]))).toEqual(['CC:«1000000025»:baja']);
    expect(show(t, run(t, [b, a]))).toEqual(['CC:«1000000025»:baja']);
  });
});

describe('T-MO-05 · criterio de aceptación de PB-2', () => {
  it('INV-R02 INV-R04 un radicado de 23 dígitos gana a una tarjeta y a una cédula contenidas', () => {
    const t = 'proceso 90001310399920260012300 en curso';
    const out = run(t, [
      mk(t, '1310399920260012', { type: 'TARJETA', ...r5, canonicalKey: 'CUENTA:1310399920260012' }),
      mk(t, '1310399920', { type: 'CC', ...r5, canonicalKey: 'CC:1310399920' }),
      mk(t, '90001310399920260012300', { type: 'RADICADO', ...r3(), confidence: 'alta', canonicalKey: 'RAD:90001310399920260012300' }),
    ]);
    expect(show(t, out)).toEqual(['RADICADO:«90001310399920260012300»:alta']);
    expect(out[0]?.precedence).toBe(3);
    expect(out[0]?.holderDigits).toBeUndefined();
  });

  it('INV-R03 el NIT «900.000.001-0» con DV erróneo sigue detectado, con menor precedencia y su confianza', () => {
    const t = 'NIT 900.000.001-0 de la sociedad';
    const nit = mk(t, '900.000.001-0', { type: 'NIT', source: 'regla', label: label('nit'), validator: ko('DV_NIT'), confidence: 'baja', canonicalKey: 'NIT:900000001' });
    const solo = run(t, [nit]);
    expect(show(t, solo)).toEqual(['NIT:«900.000.001-0»:baja']);
    expect(solo[0]?.validator).toEqual(ko('DV_NIT'));
    expect(solo[0]?.precedence).toBe(4);
    const conCc = run(t, [mk(t, '900.000.001', { type: 'CC', ...r5, canonicalKey: 'CC:900000001' }), nit]);
    expect(show(t, conCc)).toEqual(['NIT:«900.000.001-0»:baja']);
  });

  it('INV-R03 un validador fallido nunca descarta: frente a un tramo menor del mismo nivel gana por longitud', () => {
    const t = 'cuenta 4000000000000002 pagada';
    const out = run(t, [
      mk(t, '4000000000000002', { type: 'TARJETA', ...r5, validator: ko('LUHN'), confidence: 'baja', canonicalKey: 'CUENTA:4000000000000002' }),
      mk(t, '4000000000', { type: 'CC', ...r5, canonicalKey: 'CC:4000000000' }),
    ]);
    expect(show(t, out)).toEqual(['TARJETA:«4000000000000002»:baja']);
  });

  it('INV-R04 precedence según la fuente, el validador y el rótulo (6.2.4)', () => {
    const L = label('rotulo');
    const cases: Array<[Parameters<typeof precedenceOf>[0], number]> = [
      [{ source: 'manual' }, 1],
      [{ source: 'lista' }, 2],
      [{ source: 'lista', label: L, validator: ok('DV_NIT') }, 2],
      [{ source: 'regla', validator: ok('DV_NIT') }, 3],
      [{ source: 'regla', validator: ok('RADICADO') }, 3],
      [{ source: 'regla', validator: ok('CORREO') }, 3],
      [{ source: 'regla', validator: ok('LUHN'), label: L }, 3],
      [{ source: 'regla', validator: ok('LUHN') }, 5],
      [{ source: 'regla', validator: ok('NDC'), label: L }, 4],
      [{ source: 'regla', validator: ok('FECHA') }, 5],
      [{ source: 'regla', validator: ko('DV_NIT'), label: L }, 4],
      [{ source: 'regla', validator: ko('RADICADO') }, 5],
      [{ source: 'regla', label: L }, 4],
      [{ source: 'regla' }, 5],
      [{ source: 'modelo' }, 6],
      [{ source: 'modelo', label: L, validator: ok('CORREO') }, 6],
    ];
    for (const [c, p] of cases) expect(precedenceOf(c)).toBe(p);
  });

  it('INV-R02 INV-R04 un manual (precedencia 1) gana a la lista y el remanente de la lista se descarta', () => {
    const t = 'firmó Ana Ficticia Rojas ayer';
    const out = run(t, [
      mk(t, 'Ana Ficticia Rojas', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, confidence: 'alta', canonicalKey: `LISTA:${CAS_A}` }),
      mk(t, 'Ficticia Rojas', { type: 'PERSONA', source: 'manual', confidence: 'alta', score: 1, canonicalKey: 'PER:ficticia rojas' }),
    ]);
    expect(show(t, out)).toEqual(['PERSONA:«Ficticia Rojas»:alta']);
    expect(out[0]).toMatchObject({ source: 'manual', precedence: 1 });
  });

  it('INV-R04 mergeCandidates recalcula precedence aunque el candidato traiga otra', () => {
    const t = 'correo ana.ficticia@ejemplo.test fin';
    const c = { ...mk(t, 'ana.ficticia@ejemplo.test', { type: 'CORREO', ...r3('CORREO'), canonicalKey: 'CORREO:ana.ficticia@ejemplo.test' }), precedence: 6 };
    expect(run(t, [c])[0]?.precedence).toBe(3);
  });
});

describe('T-MO-05 · bordes entre la lista y un tramo extendido por el modelo (7.11.1 paso 2)', () => {
  const lista = (t: string, sub: string, occ = 0, id: CaseEntityId = CAS_A) =>
    mk(t, sub, { type: 'PERSONA', source: 'lista', caseEntityId: id, confidence: 'alta', canonicalKey: `LISTA:${id}` }, occ);
  const per = (t: string, sub: string) => mk(t, sub, { type: 'PERSONA', source: 'modelo', nerLabel: 'PER', score: 0.7, canonicalKey: 'PER:x' });

  it('INV-R02 extiende a la izquierda, a ambos lados, con guion y en MAYÚSCULAS', () => {
    let t = 'firmó Ana Ficticia Rojas ayer';
    expect(show(t, run(t, [lista(t, 'Ficticia Rojas'), per(t, 'Ana Ficticia Rojas')]))).toEqual(['PERSONA:«Ana Ficticia Rojas»:media:extendido']);
    t = 'firmó Ana Ficticia Rojas Prueba ayer';
    expect(show(t, run(t, [lista(t, 'Ficticia Rojas'), per(t, 'Ana Ficticia Rojas Prueba')]))).toEqual(['PERSONA:«Ana Ficticia Rojas Prueba»:media:extendido']);
    t = 'firmó Ana Ficticia Rojas-Prueba ayer';
    expect(show(t, run(t, [lista(t, 'Ana Ficticia Rojas'), per(t, 'Ana Ficticia Rojas-Prueba')]))).toEqual(['PERSONA:«Ana Ficticia Rojas-Prueba»:media:extendido']);
    t = 'FIRMÓ ANA FICTICIA ROJAS PRUEBA AYER';
    expect(show(t, run(t, [lista(t, 'ANA FICTICIA ROJAS'), per(t, 'ANA FICTICIA ROJAS PRUEBA')]))).toEqual(['PERSONA:«ANA FICTICIA ROJAS PRUEBA»:media:extendido']);
  });

  it('INV-R02 una organización de la lista se extiende solo con un ORG del modelo', () => {
    const t = 'pagó Ferretería Ejemplo Prueba ayer';
    const emp = mk(t, 'Ferretería Ejemplo', { type: 'EMPRESA', source: 'lista', caseEntityId: CAS_F, confidence: 'alta', canonicalKey: `LISTA:${CAS_F}` });
    const org = mk(t, 'Ferretería Ejemplo Prueba', { type: 'EMPRESA', source: 'modelo', nerLabel: 'ORG', canonicalKey: 'ORG:ferreteria ejemplo prueba' });
    expect(show(t, run(t, [emp, org]))).toEqual(['EMPRESA:«Ferretería Ejemplo Prueba»:media:extendido']);
    const perM = mk(t, 'Ferretería Ejemplo Prueba', { type: 'PERSONA', source: 'modelo', nerLabel: 'PER', canonicalKey: 'PER:ferreteria ejemplo prueba' });
    expect(show(t, run(t, [emp, perM]))).toEqual(['EMPRESA:«Ferretería Ejemplo»:alta', 'PERSONA:«Prueba»:baja']);
  });

  it('INV-R02 no extiende con palabra de función, cifra, signo ni tratamiento; el resto sigue 7.11.2', () => {
    let t = 'Ana Ficticia Rojas de Prueba declaró';
    let out = run(t, [lista(t, 'Ana Ficticia Rojas'), per(t, 'Ana Ficticia Rojas de Prueba')]);
    expect(show(t, out)).toEqual(['PERSONA:«Ana Ficticia Rojas»:alta', 'PERSONA:«Prueba»:baja']);
    expect(out[1]).toMatchObject({ source: 'modelo', canonicalKey: 'PER:prueba', score: 0.7 });
    t = 'Ana Ficticia Rojas 2 declaró';
    expect(show(t, run(t, [lista(t, 'Ana Ficticia Rojas'), per(t, 'Ana Ficticia Rojas 2')]))).toEqual(['PERSONA:«Ana Ficticia Rojas»:alta']);
    t = 'Ana Ficticia Rojas, Prueba declaró';
    expect(show(t, run(t, [lista(t, 'Ana Ficticia Rojas'), per(t, 'Ana Ficticia Rojas, Prueba')])))
      .toEqual(['PERSONA:«Ana Ficticia Rojas»:alta', 'PERSONA:«Prueba»:baja']);
    t = 'el Ingeniero Ana Ficticia firmó';
    out = run(t, [lista(t, 'Ana Ficticia'), per(t, 'Ingeniero Ana Ficticia')]);
    expect(out.find((d) => d.source === 'lista')).toMatchObject({ start: t.indexOf('Ana'), confidence: 'alta' });
    expect(out.some((d) => d.extended === true)).toBe(false);
  });

  it('INV-R02 no extiende si lo agregado pisa otra entidad de la lista o un dato de una regla', () => {
    let t = 'testigos Ana Ficticia Pedro Ejemplo presentes';
    let out = run(t, [lista(t, 'Ana Ficticia'), lista(t, 'Pedro Ejemplo', 0, CAS_B), per(t, 'Ana Ficticia Pedro Ejemplo')]);
    expect(show(t, out)).toEqual(['PERSONA:«Ana Ficticia»:alta', 'PERSONA:«Pedro Ejemplo»:alta']);
    expect(out.map((d) => d.caseEntityId)).toEqual([CAS_A, CAS_B]);
    t = 'vecina Ana Ficticia Villa Ejemplo dijo';
    out = run(t, [lista(t, 'Ana Ficticia'), per(t, 'Ana Ficticia Villa Ejemplo'),
      mk(t, 'Villa Ejemplo', { type: 'MUNICIPIO', ...r5, canonicalKey: 'DEP:90' })]);
    expect(show(t, out)).toEqual(['PERSONA:«Ana Ficticia»:alta', 'MUNICIPIO:«Villa Ejemplo»:media']);
  });

  it('INV-R02 un tramo del modelo que se solapa en parte con la lista no la extiende y se recorta', () => {
    const t = 'dijo Ana Ficticia Rojas Prueba hoy';
    const out = run(t, [lista(t, 'Ana Ficticia Rojas'), per(t, 'Rojas Prueba hoy')]);
    expect(show(t, out)).toEqual(['PERSONA:«Ana Ficticia Rojas»:alta', 'PERSONA:«Prueba hoy»:baja']);
  });

  it('INV-R02 por ventana: la lista ya fusionada se extiende con el modelo y lo detectado por una regla no se desplaza', () => {
    const t = 'Ana Ficticia Rojas Prueba vive en Villa Ejemplo';
    const part = mkPart(t);
    const first = mergeCandidates(part, [lista(t, 'Ana Ficticia Rojas'),
      mk(t, 'Villa Ejemplo', { type: 'MUNICIPIO', ...r5, canonicalKey: 'DEP:90' })], NO_RULES);
    expect(mergeCandidates(part, first, NO_RULES)).toEqual(first);
    const second = mergeCandidates(part, [...first, per(t, 'Ana Ficticia Rojas Prueba'),
      mk(t, 'Villa Ejemplo', { type: 'LUGAR', source: 'modelo', nerLabel: 'LOC', canonicalKey: 'LUGAR:villa ejemplo' })], NO_RULES);
    assertInvariants(part, second);
    expect(show(t, second)).toEqual(['PERSONA:«Ana Ficticia Rojas Prueba»:media:extendido', 'MUNICIPIO:«Villa Ejemplo»:media']);
  });
});

describe('T-MO-05 · normalización, remanentes y R-MRG-01', () => {
  it('INV-R02 ningún límite queda dentro de un par sustituto (6.1.3)', () => {
    const t = 'clave 𝐀𝐁 1000000033 y 😀😀 fin';
    const i = t.indexOf('𝐀');
    const j = t.indexOf('😀');
    const out = run(t, [
      { ...mk(t, '1000000033', { type: 'CC', ...r5, canonicalKey: 'CC:1000000033' }), start: i + 1 },
      { ...mk(t, '😀', { type: 'DOCUMENTO', ...r5, canonicalKey: 'DOCUMENTO:X' }), start: j + 1, end: j + 3 },
    ]);
    expect(out.map((d) => [d.start, d.end])).toEqual([[i, t.indexOf('1000000033') + 10], [j, j + 4]]);
  });

  it('INV-R02 quita duplicados exactos dejando la mayor confianza; ignora banderas y otras partes', () => {
    const t = 'cédula 1000000041 del actor';
    const base = { type: 'CC' as const, ...r4, canonicalKey: 'CC:1000000041' };
    const out = run(t, [
      mk(t, '1000000041', { ...base, confidence: 'baja' }),
      mk(t, '1000000041', { ...base, confidence: 'alta' }),
      mk(t, 'actor', { type: 'CARGO', source: 'regla', canonicalKey: 'CARGO:actor' }),
      { ...mk(t, 'del', { type: 'CC', ...r5, canonicalKey: 'CC:0' }), partId: OTHER_PART },
    ]);
    expect(show(t, out)).toEqual(['CC:«1000000041»:alta']);
  });

  it('INV-R02 remanente de regla: rerun encuentra el patrón y queda con su clave, sin fragmento', () => {
    const t = 'Calle 00 # 00-00 int 2 300 000 0001';
    const out = run(t, [
      mk(t, 'Calle 00 # 00-00 int 2', { type: 'DIRECCION', ...r4, confidence: 'alta', canonicalKey: 'DIR:CL 00 00 00 IN 2' }),
      mk(t, '2 300 000 0001', { type: 'TELEFONO', ...r5, ruleId: 'R-TEL-01', validator: ok('NDC'), canonicalKey: 'TEL:x' }),
    ], registry({ 'R-TEL-01': celular }));
    expect(show(t, out)).toEqual(['DIRECCION:«Calle 00 # 00-00 int 2»:alta', 'TELEFONO:«300 000 0001»:media']);
    expect(out[1]).toMatchObject({ canonicalKey: 'TEL:3000000001', precedence: 5 });
    expect(out[1]?.fragment).toBeUndefined();
    expect(out[1]?.validator).toBeUndefined();
  });

  it('INV-R02 remanentes descartados: regla con menos de 3 dígitos y lista partida', () => {
    let t = 'Calle 00 # 00-00 30 sur';
    expect(show(t, run(t, [
      mk(t, 'Calle 00 # 00-00', { type: 'DIRECCION', ...r4, confidence: 'alta', canonicalKey: 'DIR:CL 00 00 00' }),
      mk(t, '00-00 30', { type: 'CC', ...r5, ruleId: 'R-CC-01', canonicalKey: 'CC:000030' }),
    ]))).toEqual(['DIRECCION:«Calle 00 # 00-00»:alta']);
    t = 'Ana Ficticia Rojas Prueba';
    expect(show(t, run(t, [
      mk(t, 'Ana Ficticia Rojas', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, confidence: 'alta', canonicalKey: `LISTA:${CAS_A}` }),
      mk(t, 'Rojas Prueba', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_B, confidence: 'alta', canonicalKey: `LISTA:${CAS_B}` }),
    ]))).toEqual(['PERSONA:«Ana Ficticia Rojas»:alta']);
  });

  it('INV-R02 resolveRemainder (pasada 3, 7.13.5) devuelve el recorte del modelo y descarta la lista', () => {
    const t = '[DEMANDANTE_1] Prueba firmó';
    const part = mkPart(t);
    const m = mk(t, '[DEMANDANTE_1] Prueba', { type: 'PERSONA', source: 'modelo', nerLabel: 'PER', score: 0.9, canonicalKey: 'PER:x' });
    const r = resolveRemainder(part, m, 14, 21, NO_RULES);
    expect(r && t.slice(r.start, r.end)).toBe('Prueba');
    expect(r).toMatchObject({ confidence: 'baja', canonicalKey: 'PER:prueba', precedence: 6 });
    const l = mk(t, 'Prueba', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, canonicalKey: `LISTA:${CAS_A}` });
    expect(resolveRemainder(part, l, 14, 21, NO_RULES)).toBeNull();
  });

  describe('R-MRG-01 hueco y cierre sobre la vista reglas', () => {
    const join = (gap: string, tail = ' fin') => {
      const t = `pagó diez pesos${gap}$10${tail}`;
      const out = run(t, [
        mk(t, 'diez pesos', { type: 'VALOR', ...r5, canonicalKey: 'VALOR:10' }),
        mk(t, '$10', { type: 'VALOR', ...r5, confidence: 'alta', canonicalKey: 'VALOR:10' }),
      ]);
      return out.map((d) => t.slice(d.start, d.end));
    };
    it.each([' (', '(', ' ( ', ' (', ' (​'])('INV-R02 + hueco «%s» une', (gap) => {
      expect(join(gap)).toEqual([`diez pesos${gap}$10`]);
    });
    it.each([' y (', ', ', ' (en letras: ', ' )', ''])('INV-R02 - hueco «%s» no une', (gap) => {
      expect(join(gap)).toHaveLength(2);
    });
    it.each([[')', ')'], [' )', ' )'], [') m/cte', ')'], [').', ')']])('INV-R02 + cierre «%s» entra en el tramo', (tail, inc) => {
      expect(join(' (', tail)).toEqual([`diez pesos ($10${inc}`]);
    });
    it.each([' y )', '(', 'm/cte)', '\n)'])('INV-R02 - cierre «%s» no entra', (tail) => {
      expect(join(' (', tail)).toEqual(['diez pesos ($10']);
    });
    it('INV-R02 hereda la menor precedencia y la mayor confianza', () => {
      const t = 'por diez pesos ($10) netos';
      const out = run(t, [
        mk(t, 'diez pesos', { type: 'VALOR', ...r4, confidence: 'baja', canonicalKey: 'VALOR:10' }),
        mk(t, '$10', { type: 'VALOR', ...r5, confidence: 'alta', canonicalKey: 'VALOR:10' }),
      ]);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ precedence: 4, confidence: 'alta', score: 0.9 });
    });
  });
});

/** Textos de todos los casos de este archivo (y la tabla de 7.10.7): se prueba cada subcadena por puntos de código. */
const CASES = [
  'Radicado 90001-31-03-999-2026-00123-00 del Juzgado', 'Calle 00 # 00-00 300 000 0001, Villa Ejemplo',
  'Kilómetro 3 vía Villa Ejemplo, predio 3000000001', 'Pagó la Ferretería Ejemplo de Ana Ficticia ayer',
  'NIT 41.000.001-7 del contratista', 'NIT 900.000.001-0 de la sociedad', 'proceso 90001310399920260012300 en curso',
  'la suma de cuarenta y ocho millones de pesos ($48.000.000) por concepto',
  'el catorce de marzo de dos mil veintiséis (14/03/2026) se radicó', 'Ana Ficticia Rojas Prueba declaró',
  'Ana Ficticia Rojas identificada con', 'la Dra. Ana Ficticia Rojas firmó', 'Ana Ficticia Rojas firmó',
  'consignar en la cuenta 1000000017 del banco', 'número 1000000025 sin contexto', 'cuenta 4000000000000002 pagada',
  'correo ana.ficticia@ejemplo.test fin', 'firmó Ana Ficticia Rojas Prueba ayer', 'firmó Ana Ficticia Rojas-Prueba ayer',
  'FIRMÓ ANA FICTICIA ROJAS PRUEBA AYER', 'pagó Ferretería Ejemplo Prueba ayer', 'Ana Ficticia Rojas de Prueba declaró',
  'Ana Ficticia Rojas 2 declaró', 'Ana Ficticia Rojas, Prueba declaró', 'el Ingeniero Ana Ficticia firmó',
  'testigos Ana Ficticia Pedro Ejemplo presentes', 'vecina Ana Ficticia Villa Ejemplo dijo', 'dijo Ana Ficticia Rojas Prueba hoy',
  'Ana Ficticia Rojas Prueba vive en Villa Ejemplo', 'clave 𝐀𝐁 1000000033 y 😀😀 fin', 'cédula 1000000041 del actor',
  'Calle 00 # 00-00 int 2 300 000 0001', 'Calle 00 # 00-00 30 sur', '[DEMANDANTE_1] Prueba firmó', 'por diez pesos ($10) netos',
  'pagó diez pesos ( $10) m/cte fin', 'pagó diez pesos (en letras: $10 y ) fin', 'pagó diez pesos (​$10\n) fin',
  'Dra. Ana Ficticia', 'la Ferretería Ejemplo,', 'señor Pedro Ejemplo de', '(Ana Rojas)', 'de', 'X', '2026', 'Delia Prueba', 'Ana',
];

describe('T-MO-05 · R-MOD-03 sin retroceso exponencial (P0-6a M-1, 7.10.7)', () => {
  /** R-MOD-03 del plan v1.1 antes de la corrección, con el `+` interno: solo de oráculo y solo con entradas cortas. */
  const FW_PLAN = 'de|del|la|las|los|el|lo|y|e|o|u|a|al|en|por|para|con|sin|su|sus|que|se|un|una|unos|unas|senorita|senora|senor|srta|sra|sr|dona|don|doctora|doctor|dra|dr|mrs|mr|ms';
  const OLD_LEFT = new RegExp(String.raw`^(?:[\s\p{P}\p{S}]+|(?:` + FW_PLAN + String.raw`)(?=[\s\p{P}\p{S}]|$))+`, 'u');
  const OLD_RIGHT = new RegExp(String.raw`(?:[\s\p{P}\p{S}]+|(?<=^|[\s\p{P}\p{S}])(?:` + FW_PLAN + String.raw`))+$`, 'u');
  const lista = (s: string) => buildSearchView(s, 'lista', 'cuerpo').text;
  /** Como trimFunctionWords: largo de la Izquierda, índice de la Derecha sobre el resto e índice de la Derecha sobre todo. */
  const trimIdx = (left: RegExp, right: RegExp, v: string): [number, number, number] => {
    const l = left.exec(v);
    const ns = l === null ? 0 : l[0].length;
    const r = right.exec(v.slice(ns));
    const all = right.exec(v);
    return [ns, r === null ? -1 : r.index, all === null ? -1 : all.index];
  };
  const bestOf3 = (f: () => unknown): number => Math.min(...[0, 1, 2].map(() => {
    const t0 = performance.now();
    f();
    return performance.now() - t0;
  }));
  const modelo = (t: string): DetectionCandidate =>
    ({ partId: PART_ID, start: 0, end: t.length, type: 'PERSONA', source: 'modelo', nerLabel: 'PER', confidence: 'media', score: 0.7, canonicalKey: 'PER:x' });

  it.each([12, 14, 16, 200])('R-MOD-03 con %i palabras hostiles («x ! ! … ! ana») tarda menos de 50 ms', (words) => {
    const s = 'x' + ' !'.repeat(words - 2) + ' ana';
    expect(s.split(' ')).toHaveLength(words);
    expect(bestOf3(() => RE_TRIM_RIGHT.exec(s))).toBeLessThan(50);
    expect(RE_TRIM_RIGHT.exec(s)).toBeNull();
    const l = ' !'.repeat(words - 1) + ' ana';
    expect(bestOf3(() => RE_TRIM_LEFT.exec(l))).toBeLessThan(50);
    expect(RE_TRIM_LEFT.exec(l)?.[0].length).toBe(2 * (words - 1) + 1);
    // Por la función real (remanente del modelo, pasada 3 de PB-4): conserva el tramo entero.
    const t = 'Ana' + ' !'.repeat(words - 2) + ' Ficticia';
    const part = mkPart(t);
    expect(bestOf3(() => resolveRemainder(part, modelo(t), 0, t.length, NO_RULES))).toBeLessThan(50);
    const r = resolveRemainder(part, modelo(t), 0, t.length, NO_RULES);
    expect(r && t.slice(r.start, r.end)).toBe(t);
  });

  it.each([
    ['Dra. Ana Ficticia', 'Ana Ficticia'], ['la Ferretería Ejemplo,', 'Ferretería Ejemplo'], ['señor Pedro Ejemplo de', 'Pedro Ejemplo'],
    ['(Ana Rojas)', 'Ana Rojas'], ['de', null], ['X', null], ['2026', null], ['Delia Prueba', 'Delia Prueba'], ['Ana', 'Ana'],
  ])('R-MOD-03 tabla de 7.10.7: «%s» → %s', (span, want) => {
    const r = resolveRemainder(mkPart(span), modelo(span), 0, span.length, NO_RULES);
    expect(r && span.slice(r.start, r.end)).toBe(want);
  });

  it('R-MOD-03 corregida da el mismo índice que la del plan en cada subcadena de los casos de merge.test.ts', () => {
    const diff: string[] = [];
    let n = 0;
    for (const t of CASES) {
      const cps = [...t];
      for (let i = 0; i < cps.length; i++) {
        for (let j = i + 1; j <= cps.length; j++) {
          const v = lista(cps.slice(i, j).join(''));
          const a = trimIdx(RE_TRIM_LEFT, RE_TRIM_RIGHT, v); const b = trimIdx(OLD_LEFT, OLD_RIGHT, v);
          if (a.join() !== b.join()) diff.push(`«${v}»: ${a.join()} ≠ ${b.join()}`);
          n++;
        }
      }
    }
    expect(diff).toEqual([]);
    expect(n).toBeGreaterThan(25000);
  });

  it('R-MOD-03 corregida da el mismo índice que la del plan en 300 cadenas aleatorias con semilla', () => {
    let seed = 20261030;
    const r = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 2 ** 32; };
    const TOKENS = ['de', 'del', 'la', 'las', 'los', 'y', 'e', 'a', 'al', 'un', 'unas', 'sr', 'Sra.', 'Dra', 'señor', 'don', 'doña',
      'Ana', 'Ficticia', 'Delia', 'Prueba', 'x', 'X', '2026', 'é', '😀', '𝐀', ' ', ' ', '  ', '\n', '\t', '.', ',', ';', '!', '¡',
      '(', ')', '-', '$', '«', '»', '[DEMANDANTE_1]'];
    const diff: string[] = [];
    let trimmed = 0;
    for (let k = 0; k < 300; k++) {
      const s = Array.from({ length: 1 + Math.floor(r() * 12) }, () => TOKENS[Math.floor(r() * TOKENS.length)] as string).join('');
      const v = lista(s);
      const a = trimIdx(RE_TRIM_LEFT, RE_TRIM_RIGHT, v); const b = trimIdx(OLD_LEFT, OLD_RIGHT, v);
      if (a.join() !== b.join()) diff.push(`«${v}»: ${a.join()} ≠ ${b.join()}`);
      if (a[0] > 0 && a[1] >= 0) trimmed++;
    }
    expect(diff).toEqual([]);
    expect(trimmed).toBeGreaterThan(30);   // la muestra recorta por los dos lados, no solo casos triviales
  });
});

describe('T-MO-05 · borde derecho del fragmento en tiempo lineal (P0-6a, PB-2-r2)', () => {
  /** Expresión anterior del remanente de regla: solo de oráculo y solo con entradas cortas. */
  const OLD_EDGE_RIGHT = /[\s\p{P}\p{S}]*$/u;
  const oldEdge = (s: string): number => (OLD_EDGE_RIGHT.exec(s) as RegExpExecArray)[0].length;
  const bestOf3 = (f: () => unknown): number => Math.min(...[0, 1, 2].map(() => {
    const t0 = performance.now();
    f();
    return performance.now() - t0;
  }));
  const BLANKS = ' '.repeat(30000);

  it.each([
    ['blancos y una letra al final', `1000000017${BLANKS}x`, 0],
    ['blancos hasta el final', `1000000017${BLANKS}`, 30000],
    ['tabuladores, signos y emoji', `1000000017${'\t.😀'.repeat(10000)}`, 40000],
  ])('edgeRightLength con 30.000 bordes (%s) tarda menos de 50 ms', (_n, s, want) => {
    expect(bestOf3(() => edgeRightLength(s))).toBeLessThan(50);
    expect(edgeRightLength(s)).toBe(want);
  });

  it('el fragmento de un remanente de regla con 30.000 blancos se resuelve en menos de 50 ms', () => {
    const t = `CC 1000000017${BLANKS}x fin`;
    const part = mkPart(t);
    const c = mk(t, `1000000017${BLANKS}x`, { type: 'CC', ...r5, ruleId: 'R-CC-01', canonicalKey: 'CC:1000000017' });
    expect(bestOf3(() => resolveRemainder(part, c, c.start, c.end, NO_RULES))).toBeLessThan(50);
    const r = resolveRemainder(part, c, c.start, c.end, NO_RULES);
    expect(r).toMatchObject({ start: c.start, end: c.end, fragment: true, confidence: 'baja' });
    const trailing = mk(t, `1000000017${BLANKS}`, { type: 'CC', ...r5, ruleId: 'R-CC-01', canonicalKey: 'CC:1000000017' });
    const r2 = resolveRemainder(part, trailing, trailing.start, trailing.end, NO_RULES);
    expect(r2 && t.slice(r2.start, r2.end)).toBe('1000000017');
  });

  it('edgeRightLength da lo mismo que la expresión anterior en cada subcadena de los casos de merge.test.ts', () => {
    const diff: string[] = [];
    let n = 0;
    for (const t of CASES) {
      for (let i = 0; i < t.length; i++) {
        for (let j = i + 1; j <= t.length; j++) {   // por unidades UTF-16: también corta pares sustitutos
          const s = t.slice(i, j);
          if (edgeRightLength(s) !== oldEdge(s)) diff.push(JSON.stringify(s));
          n++;
        }
      }
    }
    expect(diff).toEqual([]);
    expect(n).toBeGreaterThan(25000);
  });

  it('edgeRightLength da lo mismo que la expresión anterior en 300 cadenas aleatorias con semilla', () => {
    let seed = 20261030;
    const r = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 2 ** 32; };
    const TOKENS = ['a', 'Z', '1', 'é', 'é', ' ', '\t', '\n', ' ', '​', '﻿', '.', ',', '-', '$', '+', '«', '»',
      '😀', '𝐀', '\ud83d', '\ude00', '(', ')', '#', '/'];
    const diff: string[] = [];
    let edged = 0;
    for (let k = 0; k < 300; k++) {
      const s = Array.from({ length: Math.floor(r() * 14) }, () => TOKENS[Math.floor(r() * TOKENS.length)] as string).join('');
      if (edgeRightLength(s) !== oldEdge(s)) diff.push(JSON.stringify(s));
      if (oldEdge(s) > 0) edged++;
    }
    expect(diff).toEqual([]);
    expect(edged).toBeGreaterThan(100);   // la muestra tiene bordes de verdad, no solo cadenas que terminan en letra
  });
});

describe('T-MO-05 · función pura y determinista', () => {
  /** Generador congruencial con semilla: las propiedades se reproducen siempre igual. */
  const rng = (seed: number) => () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 2 ** 32; };
  const ALPHA = ['A', 'n', 'a', ' ', 'F', 'i', 'c', '0', '1', '-', '(', ')', '.', ' ', '😀', '𝐀', 'é', '\n', '$'];
  const TYPES: DataType[] = ['CC', 'TELEFONO', 'NIT', 'VALOR', 'FECHA', 'PERSONA', 'EMPRESA', 'DIRECCION', 'RADICADO'];
  const CONF: Confidence[] = ['alta', 'media', 'baja'];

  it('INV-R02 INV-R04 300 conjuntos aleatorios: sin solapes, límites válidos, misma salida en cualquier orden y sin mutar la entrada', () => {
    const r = rng(20261029);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    for (let n = 0; n < 300; n++) {
      const t = Array.from({ length: 20 + Math.floor(r() * 60) }, () => pick(ALPHA)).join('');
      const part = mkPart(t);
      const cands: DetectionCandidate[] = Array.from({ length: Math.floor(r() * 12) }, () => {
        const s = Math.floor(r() * t.length);
        const e = Math.min(t.length, s + 1 + Math.floor(r() * 15));
        const src = pick<Src>(['lista', 'regla', 'regla', 'modelo']);
        const type = pick(TYPES);
        const confidence = pick(CONF);
        const c: DetectionCandidate = { partId: PART_ID, start: s, end: e, type, source: src, confidence, score: NOMINAL[confidence],
          canonicalKey: `${type}:${Math.floor(r() * 3)}`, ruleId: 'R-CC-01' };
        if (src === 'regla' && r() < 0.4) c.label = label('rotulo');
        if (src === 'regla' && r() < 0.4) c.validator = { name: pick(['DV_NIT', 'LUHN', 'NDC'] as const), passed: r() < 0.5 };
        if (src === 'modelo') c.nerLabel = type === 'PERSONA' ? 'PER' : 'ORG';
        if (src === 'lista') c.caseEntityId = CAS_A;
        return Object.freeze(c);
      });
      const rules: RuleRegistry = { rerun: (_id, x) => (/[0-9]{4}/u.test(x) ? { start: x.search(/[0-9]{4}/u), end: x.search(/[0-9]{4}/u) + 4, canonicalKey: 'CC:x' } : null) };
      const out = mergeCandidates(part, cands, rules);
      assertInvariants(part, out);
      expect(mergeCandidates(part, [...cands].reverse(), rules)).toEqual(out);
      expect(mergeCandidates(part, cands, rules)).toEqual(out);
      for (const d of out) expect(t.slice(d.start, d.end).length).toBe(d.end - d.start);
    }
  });

  it('INV-R02 sin candidatos o con texto vacío devuelve una lista vacía', () => {
    expect(mergeCandidates(mkPart(''), [], NO_RULES)).toEqual([]);
    expect(mergeCandidates(mkPart(''), [{ partId: PART_ID, start: 0, end: 3, type: 'CC', source: 'regla', confidence: 'baja', score: 0.3, canonicalKey: 'CC:1' }], NO_RULES)).toEqual([]);
  });
});

describe('T-MO-05 · contrato de 6.4.2', () => {
  it('mergeCandidates cumple MergeCandidatesFn de types.ts', () => {
    const contrato: MergeCandidatesFn = mergeCandidates;
    expect(contrato(mkPart('sin datos'), [], NO_RULES)).toEqual([]);
  });
});
