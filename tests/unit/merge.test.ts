// T-MO-05 · Precedencia y solapamientos (plan 7.11.4), INV-R02, INV-R03 e INV-R04. Solo datos ficticios.
import { describe, expect, it } from 'vitest';
import {
  completarSufijoSocietario, edgeRightLength, mergeCandidates, mergeIntoFused, precedenceOf, RE_TRIM_LEFT, RE_TRIM_RIGHT, resolveRemainder,
  trimFunctionWords,
} from '../../src/core/merge.ts';
import type { EsVarianteDe } from '../../src/core/merge.ts';
import { buildSearchView } from '../../src/core/normalize.ts';
import { runRules } from '../../src/core/rules/catalog.ts';
import { aplicarExclusiones } from '../../src/core/rules/exclusiones.ts';
import { rules as rFechas } from '../../src/core/rules/fechas.ts';
import { rules as rIds } from '../../src/core/rules/ids.ts';
import { rules as rValores } from '../../src/core/rules/valores.ts';
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
function run(text: string, cands: DetectionCandidate[], rules: RuleRegistry = NO_RULES, kind: PartKind = 'cuerpo', esVariante?: EsVarianteDe) {
  const part = mkPart(text, kind);
  const out = mergeCandidates(part, cands, rules, esVariante);
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

  it('INV-R02 M8c el tratamiento no extiende a la lista; el remanente «Dra.» se descarta (AJ-6: y la persona lo toma pegado, D-16)', () => {
    const t = 'la Dra. Ana Ficticia Rojas firmó';
    const out = run(t, [
      mk(t, 'Ana Ficticia Rojas', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, confidence: 'alta', canonicalKey: `LISTA:${CAS_A}` }),
      mk(t, 'Dra. Ana Ficticia Rojas', { type: 'PERSONA', source: 'modelo', nerLabel: 'PER', canonicalKey: 'PER:dra ana ficticia rojas' }),
    ]);
    // Antes de D-16 el tramo era «Ana Ficticia Rojas»: el tratamiento se recortaba y quedaba a la vista. Sigue siendo la persona de la
    // lista, con la confianza y la clave de siempre; ahora el tratamiento pegado va dentro del mismo marcador.
    expect(show(t, out)).toEqual(['PERSONA:«Dra. Ana Ficticia Rojas»:alta']);
    expect(out[0]).toMatchObject({ source: 'lista', caseEntityId: CAS_A, canonicalKey: `LISTA:${CAS_A}` });
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

  /** El oráculo de pipeline.ts para la persona de la lista «Ana Ficticia Rojas»: un texto hecho de palabras de su nombre. */
  const deAnaFicticiaRojas: EsVarianteDe = (id, texto) => id === CAS_A
    && texto.trim().split(/\s+/u).every((w) => ['ana', 'ficticia', 'rojas'].includes(w.toLowerCase()));

  it('INV-R02 extiende a la izquierda, a ambos lados, con guion y en MAYÚSCULAS', () => {
    let t = 'firmó Ana Ficticia Rojas ayer';
    // A la izquierda solo con el nombre de pila de la persona de la lista (D-14, A-2: el oráculo de la lista lo confirma).
    expect(show(t, run(t, [lista(t, 'Ficticia Rojas'), per(t, 'Ana Ficticia Rojas')], NO_RULES, 'cuerpo', deAnaFicticiaRojas)))
      .toEqual(['PERSONA:«Ana Ficticia Rojas»:media:extendido']);
    t = 'firmó Ana Ficticia Rojas Prueba ayer';
    expect(show(t, run(t, [lista(t, 'Ficticia Rojas'), per(t, 'Ana Ficticia Rojas Prueba')], NO_RULES, 'cuerpo', deAnaFicticiaRojas)))
      .toEqual(['PERSONA:«Ana Ficticia Rojas Prueba»:media:extendido']);
    t = 'firmó Ana Ficticia Rojas-Prueba ayer';
    expect(show(t, run(t, [lista(t, 'Ana Ficticia Rojas'), per(t, 'Ana Ficticia Rojas-Prueba')]))).toEqual(['PERSONA:«Ana Ficticia Rojas-Prueba»:media:extendido']);
    t = 'FIRMÓ ANA FICTICIA ROJAS PRUEBA AYER';
    expect(show(t, run(t, [lista(t, 'ANA FICTICIA ROJAS'), per(t, 'ANA FICTICIA ROJAS PRUEBA')]))).toEqual(['PERSONA:«ANA FICTICIA ROJAS PRUEBA»:media:extendido']);
  });

  it('INV-R02 D-14 (A-2) la regla E no une a dos titulares: con otro nombre de pila delante o con parentesco, la lista cede y el nombre entra entero', () => {
    const apellidos = (tt: string, sub: string) => mk(tt, sub, { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, variantClass: 'apellidos',
      confidence: 'media', canonicalKey: `LISTA:${CAS_A}` });
    // C29: el hermano con los apellidos de la persona de la lista quedaba con su marcador («Wilson» + la variante `apellidos`).
    let t = 'Asistieron Wilson Ficticia Rojas y la demandante.';
    let out = run(t, [apellidos(t, 'Ficticia Rojas'), per(t, 'Wilson Ficticia Rojas')], NO_RULES, 'cuerpo', deAnaFicticiaRojas);
    expect(show(t, out)).toEqual(['PERSONA:«Wilson Ficticia Rojas»:media']);
    expect(out[0]).toMatchObject({ source: 'modelo', canonicalKey: 'PER:x' });
    expect(out[0]?.caseEntityId).toBeUndefined();
    // Sin el oráculo de la lista no se sabe de quién es el nombre de pila: no extiende a la izquierda (cede, como en D-03 B).
    t = 'firmó Ana Ficticia Rojas ayer';
    out = run(t, [lista(t, 'Ficticia Rojas'), per(t, 'Ana Ficticia Rojas')]);
    expect(out.map((d) => `${d.source}:${t.slice(d.start, d.end)}`)).toEqual(['modelo:Ana Ficticia Rojas']);
    // El parentesco marca a otra persona de la familia: antes del nombre, en aposición después o dentro del tramo.
    const casos: Array<[string, string]> = [
      ['Ana Ficticia Rojas demandó. Su hija Ana Ficticia Rojas Prueba declaró.', 'Ana Ficticia Rojas Prueba'],
      ['Declaró Ana Ficticia Rojas Prueba, hija de la demandante.', 'Ana Ficticia Rojas Prueba'],
      ['Declaró la tía, Ana Ficticia Rojas Prueba, ayer.', 'Ana Ficticia Rojas Prueba'],
      ['FIRMÓ ANA FICTICIA ROJAS JUNIOR AYER', 'ANA FICTICIA ROJAS JUNIOR'],
    ];
    for (const [tt, largo] of casos) {
      const corto = largo.split(' ').slice(0, 3).join(' ');
      // La aparición de la lista es la que empieza el nombre largo.
      let occ = 0;
      for (let k = tt.indexOf(corto); k >= 0 && k < tt.indexOf(largo); k = tt.indexOf(corto, k + 1)) occ++;
      const o = run(tt, [lista(tt, corto, occ), per(tt, largo)], NO_RULES, 'cuerpo', deAnaFicticiaRojas);
      expect(o.map((d) => `${d.source}:${tt.slice(d.start, d.end)}`), tt).toEqual([`modelo:${largo}`]);
    }
    // Sin parentesco ni otro nombre de pila, la regla E sigue igual (D-03 E).
    t = 'Declaró la señora Ana Ficticia Rojas Prueba ayer.';
    expect(show(t, run(t, [lista(t, 'Ana Ficticia Rojas'), per(t, 'Ana Ficticia Rojas Prueba')], NO_RULES, 'cuerpo', deAnaFicticiaRojas)))
      .toEqual(['PERSONA:«señora Ana Ficticia Rojas Prueba»:media:extendido']);   // AJ-6 (D-16): con el tratamiento pegado dentro del tramo
  });

  it('INV-R02 A-4 (PB-3-r4) la regla E no extiende la lista al pariente que la oración presenta como tal, con texto en medio o con otra palabra de relación', () => {
    // Las tres sondas de la regla E de la revisión (antes la lista tomaba el nombre del pariente) y las palabras nuevas.
    const casos: Array<[string, string]> = [
      ['La madre de la demandante, Ana Ficticia Rojas Prueba, declaró.', 'Ana Ficticia Rojas'],
      ['Su hija menor de edad Ana Ficticia Rojas Prueba declaró.', 'Ana Ficticia Rojas'],
      ['Ana Ficticia Rojas Prueba, quien es hija de Ana Ficticia Rojas, declaró.', 'Ana Ficticia Rojas'],
      ['Su ahijada Ana Ficticia Rojas Prueba declaró.', 'Ana Ficticia Rojas'],
      ['Su apoderada en este proceso es Ana Ficticia Rojas Prueba.', 'Ana Ficticia Rojas'],
    ];
    for (const [t, corto] of casos) {
      const o = run(t, [lista(t, corto), per(t, 'Ana Ficticia Rojas Prueba')], NO_RULES, 'cuerpo', deAnaFicticiaRojas);
      expect(o.filter((d) => t.slice(d.start, d.end).startsWith('Ana Ficticia Rojas Prueba')).map((d) => `${d.source}:${t.slice(d.start, d.end)}`), t)
        .toEqual(['modelo:Ana Ficticia Rojas Prueba']);
      expect(o.some((d) => d.caseEntityId === CAS_A && d.start === t.indexOf('Ana Ficticia Rojas Prueba')), t).toBe(false);
    }
    // En otra oración, el parentesco no cuenta (D-13): la regla E extiende como siempre.
    const t = 'La madre vino ayer. Ana Ficticia Rojas Prueba declaró.';
    expect(show(t, run(t, [lista(t, 'Ana Ficticia Rojas'), per(t, 'Ana Ficticia Rojas Prueba')], NO_RULES, 'cuerpo', deAnaFicticiaRojas)))
      .toEqual(['PERSONA:«Ana Ficticia Rojas Prueba»:media:extendido']);
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
    let t = 'Ana Ficticia Rojas y Prueba declaró';
    let out = run(t, [lista(t, 'Ana Ficticia Rojas'), per(t, 'Ana Ficticia Rojas y Prueba')]);
    expect(show(t, out)).toEqual(['PERSONA:«Ana Ficticia Rojas»:alta', 'PERSONA:«Prueba»:baja']);
    expect(out[1]).toMatchObject({ source: 'modelo', canonicalKey: 'PER:prueba', score: 0.7 });
    // PB-3-r1 (D-12, C29) · Las partículas de 7.9.2 pegadas a una palabra de nombre son parte del apellido: sí extienden.
    // Sueltas al final, no («de» sin palabra de nombre detrás es palabra de función).
    t = 'Ana Ficticia Rojas de Prueba declaró';
    expect(show(t, run(t, [lista(t, 'Ana Ficticia Rojas'), per(t, 'Ana Ficticia Rojas de Prueba')])))
      .toEqual(['PERSONA:«Ana Ficticia Rojas de Prueba»:media:extendido']);
    t = 'ANA FICTICIA DE LA PRUEBA declaró';
    expect(show(t, run(t, [lista(t, 'ANA FICTICIA'), per(t, 'ANA FICTICIA DE LA PRUEBA')])))
      .toEqual(['PERSONA:«ANA FICTICIA DE LA PRUEBA»:media:extendido']);
    t = 'Ana Ficticia Rojas de prueba declaró';
    expect(show(t, run(t, [lista(t, 'Ana Ficticia Rojas'), per(t, 'Ana Ficticia Rojas de prueba')])))
      .toEqual(['PERSONA:«Ana Ficticia Rojas»:alta']);
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

  // PA-6-r1 (P0-4, VALOR 37 de 46): R-VAL-04 ya trae la cifra entre paréntesis y R-VAL-01 (con rótulo, precedencia 4) queda dentro
  // del mismo tramo con la misma clave. Antes ganaba R-VAL-01 por precedencia y recortaba a R-VAL-04: dos detecciones, ninguna entera.
  describe('R-MRG-01 contención: el tramo largo ya trae la cifra (7.6.5)', () => {
    it('INV-R02 un VALOR completo y el VALOR rotulado que contiene, con la misma clave: un solo tramo con la menor precedencia', () => {
      const t = 'asciende a cuarenta y ocho millones de pesos ($48.000.000), suma que no puedo pagar';
      const out = run(t, [
        mk(t, 'cuarenta y ocho millones de pesos ($48.000.000)', { type: 'VALOR', ...r5, ruleId: 'R-VAL-04', canonicalKey: 'VALOR:48000000' }),
        mk(t, '$48.000.000', { type: 'VALOR', ...r4, ruleId: 'R-VAL-01', confidence: 'alta', canonicalKey: 'VALOR:48000000' }),
      ]);
      expect(show(t, out)).toEqual(['VALOR:«cuarenta y ocho millones de pesos ($48.000.000)»:alta']);
      expect(out[0]).toMatchObject({ precedence: 4, score: 0.9 });
    });
    it('INV-R02 la contención también une dos FECHA con la misma clave', () => {
      const t = 'el catorce (14) de marzo de dos mil veintiséis (14/03/2026) se radicó';
      const out = run(t, [
        mk(t, 'catorce (14) de marzo de dos mil veintiséis (14/03/2026)', { type: 'FECHA', ...r5, canonicalKey: 'FECHA:2026-03-14' }),
        mk(t, '14/03/2026', { type: 'FECHA', ...r4, confidence: 'alta', canonicalKey: 'FECHA:2026-03-14' }),
      ]);
      expect(show(t, out)).toEqual(['FECHA:«catorce (14) de marzo de dos mil veintiséis (14/03/2026)»:alta']);
    });
    it('INV-R02 contención con otra clave, otro tipo o el mismo tramo no se une', () => {
      const t = 'asciende a cuarenta y ocho millones de pesos ($84.000.000), suma';
      const todo = 'cuarenta y ocho millones de pesos ($84.000.000)';
      const letras = (s: string) => (s.startsWith('cuarenta') ? { start: 0, end: 'cuarenta y ocho millones de pesos'.length, canonicalKey: 'VALOR:48000000' } : null);
      const otraClave = run(t, [
        mk(t, todo, { type: 'VALOR', ...r5, ruleId: 'R-VAL-04', canonicalKey: 'VALOR:48000000' }),
        mk(t, '$84.000.000', { type: 'VALOR', ...r4, confidence: 'alta', canonicalKey: 'VALOR:84000000' }),
      ], registry({ 'R-VAL-04': letras }));
      expect(show(t, otraClave)).toEqual(['VALOR:«cuarenta y ocho millones de pesos»:media', 'VALOR:«$84.000.000»:alta']);
      const otroTipo = run(t, [
        mk(t, todo, { type: 'VALOR', ...r5, canonicalKey: 'VALOR:84000000' }),
        mk(t, '84.000.000', { type: 'CC', ...r4, canonicalKey: 'VALOR:84000000' }),
      ]);
      expect(show(t, otroTipo).filter((x) => x.startsWith('CC'))).toEqual(['CC:«84.000.000»:media']);
    });
    it('INV-R02 con las reglas reales: letras y cifra entre paréntesis, con o sin salto de línea, son un solo VALOR (alta con letras = cifra)', () => {
      const reglas = [...rIds, ...rFechas, ...rValores];
      const casos: Array<[string, string, string]> = [
        ['la suma de cuarenta y ocho millones de pesos ($48.000.000) por concepto', 'cuarenta y ocho millones de pesos ($48.000.000)', 'VALOR:48000000'],
        ['el canon es de un millón ochocientos cincuenta mil pesos ($1.850.000), pagadero', 'un millón ochocientos cincuenta mil pesos ($1.850.000)', 'VALOR:1850000'],
        ['por un valor máximo de doscientos cincuenta mil pesos M/CTE ($250.000).\nSEGUNDA.', 'doscientos cincuenta mil pesos M/CTE ($250.000)', 'VALOR:250000'],
        ['cobrar TRES MILLONES DE PESOS M/CTE ($3.000.000) por concepto', 'TRES MILLONES DE PESOS M/CTE ($3.000.000)', 'VALOR:3000000'],
        ['con un salario de un\nmillón cuatrocientos veintitrés mil quinientos pesos ($1.423.500), lo que', 'un\nmillón cuatrocientos veintitrés mil quinientos pesos ($1.423.500)', 'VALOR:1423500'],
        ['precio es de trescientos ochenta\nmillones de pesos ($380.000.000); a\ntítulo', 'trescientos ochenta\nmillones de pesos ($380.000.000)', 'VALOR:380000000'],
        ['cobrar SIETE MILLONES\nQUINIENTOS MIL PESOS M/CTE ($7.500.000)\npor concepto', 'SIETE MILLONES\nQUINIENTOS MIL PESOS M/CTE ($7.500.000)', 'VALOR:7500000'],
        ['por mil millones doscientos cincuenta millones de pesos ($1.250.000.000), elección', 'mil millones doscientos cincuenta millones de pesos ($1.250.000.000)', 'VALOR:1250000000'],
      ];
      for (const [t, esperado, clave] of casos) {
        const part = mkPart(t);
        const view = buildSearchView(t, 'reglas', 'cuerpo');
        const out = mergeCandidates(part, aplicarExclusiones(view, runRules(view, PART_ID, reglas, 2026)), NO_RULES);
        assertInvariants(part, out);
        expect(out.filter((d) => d.type === 'VALOR').map((d) => [t.slice(d.start, d.end), d.canonicalKey]), t).toEqual([[esperado, clave]]);
      }
    });
    it('INV-R02 con las reglas reales: una fecha en letras y cifra partida por un salto de línea es una sola FECHA', () => {
      const reglas = [...rIds, ...rFechas, ...rValores];
      const casos: Array<[string, string, string]> = [
        ['declaró el dieciocho (18) de julio\nde dos mil veintiséis (2026). Luego', 'dieciocho (18) de julio\nde dos mil veintiséis (2026)', 'FECHA:2026-07-18'],
        ['firman en Bucaramanga a los\ndiecisiete (17) días del mes de julio de\n2026\nEntre los suscritos', 'diecisiete (17) días del mes de julio de\n2026', 'FECHA:2026-07-17'],
        ['se otorgará el quince\n(15) de septiembre de dos mil veintiséis\n(2026) en la Notaría', 'quince\n(15) de septiembre de dos mil veintiséis\n(2026)', 'FECHA:2026-09-15'],
        ['hasta el\nveintiuno (21) de agosto de dos mil\nveintisiete (2027). Sobre', 'veintiuno (21) de agosto de dos mil\nveintisiete (2027)', 'FECHA:2027-08-21'],
      ];
      for (const [t, esperado, clave] of casos) {
        const part = mkPart(t);
        const view = buildSearchView(t, 'reglas', 'cuerpo');
        const out = mergeCandidates(part, aplicarExclusiones(view, runRules(view, PART_ID, reglas, 2026)), NO_RULES);
        assertInvariants(part, out);
        expect(out.filter((d) => d.type === 'FECHA').map((d) => [t.slice(d.start, d.end), d.canonicalKey]), t).toEqual([[esperado, clave]]);
      }
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

  /** trimFunctionWords sobre todo el texto: lo que queda, o null. */
  const recorte = (s: string): string | null => { const r = trimFunctionWords(s, 'cuerpo'); return r === null ? null : s.slice(r.start, r.end); };
  it.each([
    ['Comercial Ejemplo S.A.', 'Comercial Ejemplo S.A.'], ['la Ferretería Ficticia Ltda.,', 'Ferretería Ficticia Ltda.'],
    ['Inversiones Prueba S.A.S.', 'Inversiones Prueba S.A.S.'], ['Distribuidora Ejemplo S. en C.', 'Distribuidora Ejemplo S. en C.'],
    ['Ejemplo y Cía.', 'Ejemplo y Cía.'], ['COMERCIAL EJEMPLO S.A.', 'COMERCIAL EJEMPLO S.A.'], ['Comercial Ejemplo S.A. de', 'Comercial Ejemplo S.A.'],
    ['Comercial Ejemplo S A', 'Comercial Ejemplo S A'], ['Banco Ficticio E.S.P.)', 'Banco Ficticio E.S.P.'],
  ])('D-03 A R-MOD-03 no entra en el sufijo societario final (R-LST-05): «%s» → «%s»', (span, want) => {
    expect(recorte(span)).toBe(want);
  });

  it.each([
    ['Pedro S al', 'Pedro S'], ['Ltda.', 'Ltda'], ['S.A.', 'S'], ['Ana Ficticia de la', 'Ana Ficticia'], ['Delia Sánchez a', 'Delia Sánchez'],
    ['Dra. Ana Ficticia', 'Ana Ficticia'],
  ])('D-03 A sin sufijo final (o el sufijo es todo el tramo) el recorte es el de siempre: «%s» → «%s»', (span, want) => {
    expect(recorte(span)).toBe(want);
  });

  it.each([16, 200])('D-03 A con %i signos sueltos tras el sufijo («S.A. , , …») el recorte tarda menos de 50 ms y conserva el sufijo', (n) => {
    // Un tramo del modelo tiene a lo sumo 12 palabras (maxSpanWords): 200 signos ya es más de lo que puede llegar.
    const s = 'Comercial Ejemplo S.A.' + ' ,'.repeat(n);
    expect(bestOf3(() => trimFunctionWords(s, 'cuerpo'))).toBeLessThan(50);
    expect(recorte(s)).toBe('Comercial Ejemplo S.A.');
    const t = 'Comercial Ejemplo S.A' + ' !'.repeat(n) + ' de';
    expect(bestOf3(() => trimFunctionWords(t, 'cuerpo'))).toBeLessThan(50);
    expect(recorte(t)).toBe('Comercial Ejemplo S.A');
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

describe('T-MO-05 · fusión de una ventana del modelo contra lo ya fusionado (7.10.10, PB-2-r3)', () => {
  /**
   * Lo ya fusionado (lo que `detectar` emitió) y la ventana nueva; comprueba INV-R02 y que lo de antes sale igual (INV-R12), con la
   * única excepción de D-03: un candidato de la lista que cede o se extiende queda dentro de un candidato nuevo más largo.
   */
  function porVentana(text: string, antes: DetectionCandidate[], nuevos: DetectionCandidate[], rules: RuleRegistry = NO_RULES,
    esVariante?: EsVarianteDe) {
    const part = mkPart(text);
    const fused = mergeCandidates(part, antes, rules).map((c) => Object.freeze(c));
    const copia = structuredClone(fused);
    const out = mergeIntoFused(part, fused, nuevos.map((c) => Object.freeze(c)), rules, esVariante);
    assertInvariants(part, out);
    expect(fused).toEqual(copia);   // la entrada no cambia
    for (const f of fused) {
      if (out.some((o) => JSON.stringify(o) === JSON.stringify(f))) continue;
      expect(f.source, 'solo la lista cede o se extiende (D-03)').toBe('lista');
      expect(out.some((o) => o.start <= f.start && f.end <= o.end && o.end - o.start > f.end - f.start)).toBe(true);
    }
    return out;
  }
  const apellido = (t: string, sub: string, occ = 0): DetectionCandidate =>
    mk(t, sub, { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, variantClass: 'apellido_suelto', role: 'DEMANDANTE', canonicalKey: `LISTA:${CAS_A}` }, occ);
  const per = (t: string, sub: string, score = 0.95, occ = 0): DetectionCandidate =>
    mk(t, sub, { type: 'PERSONA', source: 'modelo', nerLabel: 'PER', role: 'OTRA_PERSONA', confidence: 'media', score, canonicalKey: `PER:${sub.toLowerCase()}` }, occ);
  const org = (t: string, sub: string): DetectionCandidate =>
    mk(t, sub, { type: 'EMPRESA', source: 'modelo', nerLabel: 'ORG', confidence: 'media', score: 0.9, canonicalKey: `ORG:${sub.toLowerCase()}` });

  it('INV-R02 INV-R12 D-03 B el tramo del modelo que contiene un apellido suelto de otra entidad de la lista: la lista cede y el nombre entra entero (C01, C06)', () => {
    const t = 'Declaró Pedro Luis Ejemplo Gómez ante el juez.';
    const out = porVentana(t, [apellido(t, 'Ejemplo')], [per(t, 'Pedro Luis Ejemplo Gómez')]);
    // Antes (PB-2-r3) se partía: «Pedro Luis» y «Gómez» como restos de baja confianza alrededor de la lista.
    expect(show(t, out)).toEqual(['PERSONA:«Pedro Luis Ejemplo Gómez»:media']);
    expect(out[0]).toMatchObject({ source: 'modelo', canonicalKey: 'PER:pedro luis ejemplo gómez', role: 'OTRA_PERSONA' });
    expect(out[0]?.caseEntityId).toBeUndefined();
    // La fusión de una sola vez aplica la misma excepción al paso 2: antes extendía la lista (la entidad de «Ejemplo») sobre el
    // nombre de otra persona.
    expect(show(t, mergeCandidates(mkPart(t), [apellido(t, 'Ejemplo'), per(t, 'Pedro Luis Ejemplo Gómez')], NO_RULES)))
      .toEqual(['PERSONA:«Pedro Luis Ejemplo Gómez»:media']);
  });

  it('INV-R02 D-03 B no cede si el tramo es una variante de esa misma entidad: entonces la lista toma el tramo (paso 2)', () => {
    const t = 'Declaró Pedro Luis Ejemplo Gómez ante el juez.';
    const misma: EsVarianteDe = (id, texto) => id === CAS_A && texto === 'Pedro Luis Ejemplo Gómez';
    const out = porVentana(t, [apellido(t, 'Ejemplo')], [per(t, 'Pedro Luis Ejemplo Gómez')], NO_RULES, misma);
    expect(show(t, out)).toEqual(['PERSONA:«Pedro Luis Ejemplo Gómez»:media:extendido']);
    expect(out[0]).toMatchObject({ source: 'lista', caseEntityId: CAS_A, canonicalKey: `LISTA:${CAS_A}` });
    expect(show(t, mergeCandidates(mkPart(t), [apellido(t, 'Ejemplo'), per(t, 'Pedro Luis Ejemplo Gómez')], NO_RULES, misma)))
      .toEqual(['PERSONA:«Pedro Luis Ejemplo Gómez»:media:extendido']);
  });

  it('INV-R02 D-03 B no cede una variante de dos palabras ni con otro dato en el tramo: se parte como antes (7.11.2)', () => {
    let t = 'Declaró Pedro Luis Ejemplo Gómez ante el juez.';
    const dos = mk(t, 'Pedro Luis', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_B, variantClass: 'nombre_suelto', role: 'TESTIGO', canonicalKey: `LISTA:${CAS_B}` });
    const otra = mk(t, 'Gómez', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_F, variantClass: 'exacta', role: 'TESTIGO', canonicalKey: `LISTA:${CAS_F}` });
    expect(show(t, porVentana(t, [dos, otra], [per(t, 'Pedro Luis Ejemplo Gómez')])))
      .toEqual(['PERSONA:«Pedro Luis»:media', 'PERSONA:«Ejemplo»:baja', 'PERSONA:«Gómez»:media']);
    t = 'Firmó Pedro Ejemplo Villa Ejemplo hoy';
    const mun = mk(t, 'Villa Ejemplo', { type: 'MUNICIPIO', ...r5, canonicalKey: 'DEP:90' });
    expect(show(t, porVentana(t, [apellido(t, 'Ejemplo'), mun], [per(t, 'Pedro Ejemplo Villa')])))
      .toEqual(['PERSONA:«Pedro»:baja', 'PERSONA:«Ejemplo»:media', 'MUNICIPIO:«Villa Ejemplo»:media']);
  });

  it('INV-R02 INV-R12 D-03 E M8 por ventana: la lista ya emitida toma el nombre completo del modelo (extendida, media)', () => {
    const t = 'Ana Ficticia Rojas Prueba declaró';
    const lista = mk(t, 'Ana Ficticia Rojas', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, variantClass: 'exacta', confidence: 'alta', canonicalKey: `LISTA:${CAS_A}` });
    const out = porVentana(t, [lista], [per(t, 'Ana Ficticia Rojas Prueba')]);
    // Antes (PB-2-r3): «Ana Ficticia Rojas» alta y «Prueba» aparte, baja, como otra entidad.
    expect(show(t, out)).toEqual(['PERSONA:«Ana Ficticia Rojas Prueba»:media:extendido']);
    expect(out[0]).toMatchObject({ source: 'lista', caseEntityId: CAS_A, canonicalKey: `LISTA:${CAS_A}`, precedence: 2 });
    // El nombre de la lista en dos trozos de la misma entidad («Ana» y «Rojas», sueltos) y el modelo con el nombre: un solo tramo.
    const t2 = 'Firmó Ana Rojas el acta';
    const suelto = (sub: string, cls: 'nombre_suelto' | 'apellido_suelto') =>
      mk(t2, sub, { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, variantClass: cls, canonicalKey: `LISTA:${CAS_A}` });
    const deAna: EsVarianteDe = (id) => id === CAS_A;
    expect(show(t2, porVentana(t2, [suelto('Ana', 'nombre_suelto'), suelto('Rojas', 'apellido_suelto')], [per(t2, 'Ana Rojas')], NO_RULES, deAna)))
      .toEqual(['PERSONA:«Ana Rojas»:media:extendido']);
  });

  it('INV-R02 INV-R12 D-14 (A-2) por ventana: el nombre de otra persona de la familia o con otro nombre de pila no toma la mención de la lista; la lista cede', () => {
    let t = 'Su hija Ana Ficticia Rojas Prueba declaró';
    const exacta = mk(t, 'Ana Ficticia Rojas', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, variantClass: 'exacta', confidence: 'alta', canonicalKey: `LISTA:${CAS_A}` });
    const deAna: EsVarianteDe = (id, texto) => id === CAS_A && texto.trim().split(/\s+/u).every((w) => ['ana', 'ficticia', 'rojas'].includes(w.toLowerCase()));
    // Antes (PB-3-r1): la lista tomaba el tramo entero y la hija quedaba con el marcador de la demandante.
    let out = porVentana(t, [exacta], [per(t, 'Ana Ficticia Rojas Prueba')], NO_RULES, deAna);
    expect(show(t, out)).toEqual(['PERSONA:«Ana Ficticia Rojas Prueba»:media']);
    expect(out[0]).toMatchObject({ source: 'modelo', canonicalKey: 'PER:ana ficticia rojas prueba' });
    t = 'Asistió Wilson Ficticia Rojas al despacho';
    const ap = mk(t, 'Ficticia Rojas', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, variantClass: 'apellidos', confidence: 'media', canonicalKey: `LISTA:${CAS_A}` });
    out = porVentana(t, [ap], [per(t, 'Wilson Ficticia Rojas')], NO_RULES, deAna);
    expect(show(t, out)).toEqual(['PERSONA:«Wilson Ficticia Rojas»:media']);
    expect(out[0]?.source).toBe('modelo');
    // Con el nombre de pila de la persona de la lista, la regla E sigue igual.
    t = 'Asistió Ana Ficticia Rojas al despacho';
    const ap2 = mk(t, 'Ficticia Rojas', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, variantClass: 'apellidos', confidence: 'media', canonicalKey: `LISTA:${CAS_A}` });
    expect(show(t, porVentana(t, [ap2], [per(t, 'Ana Ficticia Rojas')], NO_RULES, deAna))).toEqual(['PERSONA:«Ana Ficticia Rojas»:media:extendido']);
  });

  it('INV-R02 INV-R12 A-4 (PB-3-r4) por ventana: el pariente que la oración presenta como tal, con texto en medio, no toma la mención de la lista; la lista cede', () => {
    const deAna: EsVarianteDe = (id, texto) => id === CAS_A && texto.trim().split(/\s+/u).every((w) => ['ana', 'ficticia', 'rojas'].includes(w.toLowerCase()));
    for (const t of ['La madre de la demandante, Ana Ficticia Rojas Prueba, declaró.', 'Su hija menor de edad Ana Ficticia Rojas Prueba declaró.',
      'Ana Ficticia Rojas Prueba, quien es hija de la demandante, declaró.']) {
      const exacta = mk(t, 'Ana Ficticia Rojas', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, variantClass: 'exacta', confidence: 'alta', canonicalKey: `LISTA:${CAS_A}` });
      const out = porVentana(t, [exacta], [per(t, 'Ana Ficticia Rojas Prueba')], NO_RULES, deAna);
      expect(show(t, out), t).toEqual(['PERSONA:«Ana Ficticia Rojas Prueba»:media']);
      expect(out[0]?.source).toBe('modelo');
    }
  });

  it('INV-R02 D-03 A y B el ORG del modelo con un apellido suelto de la lista entra entero, con su sufijo (M3 por ventana)', () => {
    const t = 'Pagó en la Droguería Ejemplo Central y en el Banco Ejemplo S.A. la cuota.';
    const out = porVentana(t, [apellido(t, 'Ejemplo'), apellido(t, 'Ejemplo', 1)], [org(t, 'Droguería Ejemplo Central'), org(t, 'Banco Ejemplo S.A.')]);
    // Antes (PB-2-r3): «Droguería», «Central» y «Banco» como restos, el apellido como persona y «S.A» perdido (7.11.2).
    expect(show(t, out)).toEqual(['EMPRESA:«Droguería Ejemplo Central»:media', 'EMPRESA:«Banco Ejemplo S.A.»:media']);
    // Con una persona de la lista (no un apellido suelto) dentro del ORG, el paso 2 no aplica (M3): el ORG se parte.
    const t2 = 'Pagó en la Droguería Ana Ficticia Central la cuota.';
    const ana = mk(t2, 'Ana Ficticia', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, variantClass: 'exacta', confidence: 'alta', canonicalKey: `LISTA:${CAS_A}` });
    expect(show(t2, porVentana(t2, [ana], [org(t2, 'Droguería Ana Ficticia Central')])))
      .toEqual(['EMPRESA:«Droguería»:baja', 'PERSONA:«Ana Ficticia»:alta', 'EMPRESA:«Central»:baja']);
  });

  it('INV-R02 lo contenido en algo ya fusionado se absorbe; lo que se solapa con un tramo de una ventana anterior se parte; lo libre entra igual', () => {
    const t = 'Firmaron Pedro Prueba Ejemplo Rojas y Luisa Ficticia en Villa Ejemplo.';
    const ventana1 = [per(t, 'Pedro Prueba Ejemplo')];
    const out = porVentana(t, ventana1, [
      per(t, 'Prueba Ejemplo', 0.99),            // contenido en lo de la ventana 1: se absorbe
      per(t, 'Ejemplo Rojas', 0.9),              // se solapa en el borde de zona: queda «Rojas»
      per(t, 'Luisa Ficticia', 0.8),             // libre: entra con su confianza
    ]);
    expect(show(t, out)).toEqual(['PERSONA:«Pedro Prueba Ejemplo»:media', 'PERSONA:«Rojas»:baja', 'PERSONA:«Luisa Ficticia»:media']);
  });

  it('INV-R12 un NIT ya fusionado no cambia su holderDigits por una cédula de una ventana posterior', () => {
    const t = 'NIT 41.000.001-7 del contratista';
    const nit = mk(t, '41.000.001-7', { type: 'NIT', ...r3('DV_NIT'), confidence: 'alta', canonicalKey: 'NIT:410000017' });
    const out = porVentana(t, [nit], [mk(t, '41.000.001', { type: 'CC', ...r5, canonicalKey: 'CC:41000001' })]);
    expect(show(t, out)).toEqual(['NIT:«41.000.001-7»:alta']);
    expect(out[0]?.holderDigits).toBeUndefined();
  });

  it('INV-R02 INV-R12 200 ventanas aleatorias: sin solapes, lo de antes intacto, misma salida en cualquier orden', () => {
    let seed = 20261031;
    const r = (): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 2 ** 32; };
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    const PALABRAS = ['Ana', 'Pedro', 'Ficticia', 'Ejemplo', 'Prueba', 'Rojas', 'de', 'la', 'S.A.', 'firmó', '1000000017', 'y', 'Banco'];
    for (let n = 0; n < 200; n++) {
      const t = Array.from({ length: 6 + Math.floor(r() * 14) }, () => pick(PALABRAS)).join(' ');
      const tramo = (): [number, number] => {
        const s = Math.floor(r() * t.length);
        return [s, Math.min(t.length, s + 2 + Math.floor(r() * 20))];
      };
      const cand = (source: Src): DetectionCandidate => {
        const [s, e] = tramo();
        const type = source === 'regla' ? 'CC' : pick<DataType>(['PERSONA', 'EMPRESA']);
        const c: DetectionCandidate = { partId: PART_ID, start: s, end: e, type, source, confidence: pick<Confidence>(['alta', 'media', 'baja']),
          score: r(), canonicalKey: `${type}:${n}:${s}` };
        if (source === 'modelo') c.nerLabel = type === 'PERSONA' ? 'PER' : 'ORG';
        if (source === 'lista') { c.caseEntityId = CAS_A; c.variantClass = 'apellido_suelto'; }
        if (source === 'regla') c.ruleId = 'R-CC-01';
        return c;
      };
      const antes = Array.from({ length: Math.floor(r() * 5) }, () => cand(pick<Src>(['lista', 'regla', 'modelo'])));
      const nuevos = Array.from({ length: Math.floor(r() * 6) }, () => cand('modelo'));
      const out = porVentana(t, antes, nuevos);
      const part = mkPart(t);
      const fused = mergeCandidates(part, antes, NO_RULES);
      expect(mergeIntoFused(part, [...fused].reverse(), [...nuevos].reverse(), NO_RULES)).toEqual(out);
    }
  });
});

describe('T-MO-05 · D-06 decisión 5: la lista de una sola palabra dentro de una regla estructural se absorbe (7.11.1, PB-2-r6)', () => {
  const lista = (t: string, sub: string, spec: Partial<DetectionCandidate> = {}, occ = 0): DetectionCandidate =>
    mk(t, sub, { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, variantClass: 'apellido_suelto', role: 'DEMANDANTE',
      canonicalKey: `LISTA:${CAS_A}`, ...spec }, occ);
  const empresa = (t: string, sub: string): DetectionCandidate =>
    lista(t, sub, { type: 'EMPRESA', caseEntityId: CAS_F, variantClass: 'razon_social_sin_sufijo', role: 'EMPRESA', canonicalKey: `LISTA:${CAS_F}` });

  it('INV-R02 CORREO: la razón social de la lista dentro del dominio ya no parte el correo (antes: solo la EMPRESA y el resto del correo a la vista)', () => {
    const t = 'Las solicitudes se enviarán a notificaciones@ferreteria-ejemplo.test, en horario hábil.';
    const correo = mk(t, 'notificaciones@ferreteria-ejemplo.test', { type: 'CORREO', ...r3('CORREO'), ruleId: 'R-CORREO-01', confidence: 'alta',
      canonicalKey: 'CORREO:notificaciones@ferreteria-ejemplo.test' });
    // Con el código anterior: ['EMPRESA:«ferreteria-ejemplo»:media'] (el remanente «notificaciones@» no tiene 3 dígitos y se descarta).
    expect(show(t, run(t, [correo, empresa(t, 'ferreteria-ejemplo')]))).toEqual(['CORREO:«notificaciones@ferreteria-ejemplo.test»:alta']);
    // Y en el orden inverso de llegada.
    expect(show(t, run(t, [empresa(t, 'ferreteria-ejemplo'), correo]))).toEqual(['CORREO:«notificaciones@ferreteria-ejemplo.test»:alta']);
  });

  it('INV-R02 BARRIO y DIRECCION: el apellido suelto de una persona de la lista dentro del nombre del barrio o de la vía no recorta la regla', () => {
    const t = 'Vivo en el barrio Altos del Ejemplo, en la Avenida Ficticia 00 # 00-03, local 10, vereda Chuscal Prueba.';
    const barrio = mk(t, 'Altos del Ejemplo', { type: 'BARRIO', ...r4, ruleId: 'R-BAR-01', confidence: 'alta', canonicalKey: 'BARRIO:altos del ejemplo' });
    const dir = mk(t, 'Avenida Ficticia 00 # 00-03, local 10', { type: 'DIRECCION', ...r5, ruleId: 'R-DIR-02', confidence: 'alta', canonicalKey: 'DIR:AV FICTICIA 00 00 03' });
    const vereda = mk(t, 'Chuscal Prueba', { type: 'DIRECCION', ...r5, ruleId: 'R-DIR-05', confidence: 'alta', canonicalKey: 'DIR:VEREDA CHUSCAL PRUEBA' });
    const out = run(t, [barrio, dir, vereda, lista(t, 'Ejemplo'), lista(t, 'Ficticia', { variantClass: 'nombre_suelto' }), lista(t, 'Prueba')]);
    // Con el código anterior: solo las tres palabras de la lista; «Altos del», «Chuscal» y la vía sin número quedaban a la vista.
    expect(show(t, out)).toEqual(['BARRIO:«Altos del Ejemplo»:alta', 'DIRECCION:«Avenida Ficticia 00 # 00-03, local 10»:alta', 'DIRECCION:«Chuscal Prueba»:alta']);
  });

  it('INV-R02 las demás estructurales (RADICADO, RADICADO_ADMIN, NIT con DV y las rotuladas) también absorben; la lista de una palabra fuera de ellas sigue igual', () => {
    const casos: Array<[string, Spec]> = [
      ['RADICADO', { type: 'RADICADO', ...r3('RADICADO'), canonicalKey: 'RAD:x' }],
      ['RADICADO_ADMIN', { type: 'RADICADO_ADMIN', ...r5, canonicalKey: 'RAD:x' }],
      ['NIT con DV que falla', { type: 'NIT', source: 'regla', validator: ko('DV_NIT'), canonicalKey: 'NIT:x' }],
      ['AFILIACION rotulada', { type: 'AFILIACION', ...r4, canonicalKey: 'AFIL:x' }],
    ];
    for (const [nombre, spec] of casos) {
      const t = 'Consta en el registro VSE-PRUEBA-000123 del asunto y Prueba firmó.';
      const out = run(t, [mk(t, 'VSE-PRUEBA-000123', spec), lista(t, 'PRUEBA'), lista(t, 'Prueba', {}, 0)]);
      expect(show(t, out), nombre).toEqual([`${spec.type}:«VSE-PRUEBA-000123»:media`, 'PERSONA:«Prueba»:media']);
    }
  });

  it('INV-R02 controles: una regla que no es estructural, una lista de varias palabras o una lista igual a la regla conservan la precedencia 2 de la lista (como antes)', () => {
    const t = 'Llamó al 300 Ejemplo 0001 desde el barrio Villa Ana Ficticia y del barrio Prueba.';
    const tel = mk(t, '300 Ejemplo 0001', { type: 'TELEFONO', ...r5, canonicalKey: 'TEL:3000001' });
    const barrio = mk(t, 'Villa Ana Ficticia', { type: 'BARRIO', ...r4, canonicalKey: 'BARRIO:villa ana ficticia' });
    const igual = mk(t, 'Prueba', { type: 'BARRIO', ...r4, canonicalKey: 'BARRIO:prueba' });
    const out = run(t, [tel, barrio, igual, lista(t, 'Ejemplo'), lista(t, 'Ana Ficticia', { variantClass: 'apellidos' }), lista(t, 'Prueba')]);
    // El teléfono y el barrio se parten (7.11.2: el teléfono queda como fragmento con ≥ 3 dígitos; «Villa», sin dígitos, se descarta).
    expect(show(t, out)).toEqual(['TELEFONO:«300»:baja:fragmento', 'PERSONA:«Ejemplo»:media', 'TELEFONO:«0001»:baja:fragmento',
      'PERSONA:«Ana Ficticia»:media', 'PERSONA:«Prueba»:media']);
  });

  it('INV-R02 INV-R12 por ventana: mergeIntoFused absorbe entre los candidatos nuevos y un tramo nuevo del modelo dentro del correo ya fusionado no lo toca', () => {
    const t = 'Escriba a notificaciones@ferreteria-ejemplo.test o llame.';
    const correo = mk(t, 'notificaciones@ferreteria-ejemplo.test', { type: 'CORREO', ...r3('CORREO'), confidence: 'alta', canonicalKey: 'CORREO:n' });
    const part = mkPart(t);
    // Sin nada fusionado, la ventana con el correo y la lista da lo mismo que la fusión completa (antes: solo la EMPRESA).
    const deUna = mergeIntoFused(part, [], [correo, empresa(t, 'ferreteria-ejemplo')], NO_RULES);
    assertInvariants(part, deUna);
    expect(show(t, deUna)).toEqual(['CORREO:«notificaciones@ferreteria-ejemplo.test»:alta']);
    // Lo ya fusionado (el correo entero) no cambia con el ORG del modelo que cae dentro (paso 4b).
    const fused = mergeCandidates(part, [correo, empresa(t, 'ferreteria-ejemplo')], NO_RULES);
    const modelo = mk(t, 'ferreteria-ejemplo', { type: 'EMPRESA', source: 'modelo', nerLabel: 'ORG', confidence: 'media', score: 0.9, canonicalKey: 'ORG:f' });
    expect(mergeIntoFused(part, fused, [modelo], NO_RULES)).toEqual(fused);
  });
});

describe('T-MO-05 · B-61: la absorción de D-06 se decide al colocar, en el paso 4b (7.11.1, PB-2-r7)', () => {
  const persona = (t: string, sub: string, cas: CaseEntityId, variantClass: DetectionCandidate['variantClass']): DetectionCandidate =>
    mk(t, sub, { type: 'PERSONA', source: 'lista', caseEntityId: cas, variantClass, role: cas === CAS_A ? 'DEMANDANTE' : 'DEMANDADO',
      canonicalKey: `LISTA:${cas}` });
  const T = 'Vive en el barrio Villa Prueba de Ana Ficticia Rojas desde 2020.';
  const barrio = mk(T, 'Villa Prueba de Ana Ficticia', { type: 'BARRIO', ...r4, ruleId: 'R-BAR-01', confidence: 'alta',
    canonicalKey: 'BARRIO:villa prueba de ana ficticia' });
  const cands = (): DetectionCandidate[] => [barrio, persona(T, 'Ana Ficticia Rojas', CAS_A, 'exacta'), persona(T, 'Prueba', CAS_B, 'apellido_suelto')];

  it('INV-R02 si un candidato de mayor prioridad parte la regla, la palabra de la lista que absorbía se coloca y no queda a la vista', () => {
    // El nombre de varias palabras (precedencia 2) solapa el final del barrio: el barrio se parte y su resto sin dígitos se descarta.
    // Con el código anterior la absorción se decidía antes de colocar: «Prueba» desaparecía con el barrio y quedaba a la vista.
    const part = mkPart(T);
    const out = mergeCandidates(part, cands(), NO_RULES);
    assertInvariants(part, out);
    expect(show(T, out)).toEqual(['PERSONA:«Prueba»:media', 'PERSONA:«Ana Ficticia Rojas»:media']);
    // Por ventana, entre los candidatos nuevos, lo mismo.
    expect(show(T, mergeIntoFused(part, [], cands(), NO_RULES))).toEqual(['PERSONA:«Prueba»:media', 'PERSONA:«Ana Ficticia Rojas»:media']);
  });

  it('INV-R02 si la regla entra entera, 4b absorbe la palabra como antes (D-06), en cualquier orden de llegada', () => {
    const t = 'Vive en el barrio Villa Prueba de la Sierra desde 2020; Ana Ficticia Rojas firmó.';
    const bar = mk(t, 'Villa Prueba de la Sierra', { type: 'BARRIO', ...r4, ruleId: 'R-BAR-01', confidence: 'alta', canonicalKey: 'BARRIO:v' });
    const xs = [bar, persona(t, 'Prueba', CAS_B, 'apellido_suelto'), persona(t, 'Ana Ficticia Rojas', CAS_A, 'exacta')];
    const esperado = ['BARRIO:«Villa Prueba de la Sierra»:alta', 'PERSONA:«Ana Ficticia Rojas»:media'];
    expect(show(t, run(t, xs))).toEqual(esperado);
    expect(show(t, run(t, [...xs].reverse()))).toEqual(esperado);
  });

  it('INV-R02 la palabra dentro de dos reglas estructurales se coloca detrás de la última: la absorbe la que entra entera', () => {
    const t = 'Consta en el registro VSE-PRUEBA-000123 del asunto.';
    const afil = mk(t, 'VSE-PRUEBA-000123', { type: 'AFILIACION', ...r4, canonicalKey: 'AFIL:x' });
    const rad = mk(t, 'VSE-PRUEBA-000123', { type: 'RADICADO_ADMIN', ...r5, canonicalKey: 'RAD:x' });
    const out = run(t, [persona(t, 'PRUEBA', CAS_B, 'apellido_suelto'), rad, afil]);
    expect(show(t, out)).toEqual(['AFILIACION:«VSE-PRUEBA-000123»:media']);
  });
});

describe('T-MO-05 · el punto que completa el sufijo societario de un tramo ORG (D-03 A, hallazgo de PF-3-r1; PB-2-r6)', () => {
  const fin = (t: string, sub: string): string => {
    const s = t.indexOf(sub);
    return t.slice(s, completarSufijoSocietario(t, s, s + sub.length, 'cuerpo'));
  };
  it('se extiende sobre el punto que falta: «S.A», «S.A.S», «E.S.E», «S. en C», también en MAYÚSCULAS y minúsculas', () => {
    expect(fin('Pagó Comercial Ejemplo S.A. el saldo.', 'Comercial Ejemplo S.A')).toBe('Comercial Ejemplo S.A.');
    expect(fin('Firmó Inversiones Prueba S.A.S. ayer.', 'Inversiones Prueba S.A.S')).toBe('Inversiones Prueba S.A.S.');
    expect(fin('Atendió el Hospital Ficticio E.S.E. de turno.', 'Hospital Ficticio E.S.E')).toBe('Hospital Ficticio E.S.E.');
    expect(fin('Vendió Pérez Ejemplo y Cía. S. en C. el lote.', 'Pérez Ejemplo y Cía. S. en C')).toBe('Pérez Ejemplo y Cía. S. en C.');
    expect(fin('PAGÓ COMERCIAL EJEMPLO S.A. EL SALDO.', 'COMERCIAL EJEMPLO S.A')).toBe('COMERCIAL EJEMPLO S.A.');
    expect(fin('pagó comercial ejemplo s. a. el saldo.', 'comercial ejemplo s. a')).toBe('comercial ejemplo s. a.');
  });
  it('nunca toma el punto de la oración tras un sufijo ya completo ni tras un nombre sin sufijo', () => {
    expect(fin('Lo pagó Ferretería Ejemplo SAS.', 'Ferretería Ejemplo SAS')).toBe('Ferretería Ejemplo SAS');
    expect(fin('Lo pagó Ferretería Ejemplo Ltda.', 'Ferretería Ejemplo Ltda')).toBe('Ferretería Ejemplo Ltda');
    expect(fin('Lo pagó Ferretería Ejemplo S.A..', 'Ferretería Ejemplo S.A.')).toBe('Ferretería Ejemplo S.A.');
    expect(fin('Lo pagó la Ferretería Ejemplo.', 'Ferretería Ejemplo')).toBe('Ferretería Ejemplo');
    expect(fin('Lo pagó Comercial Ejemplo S.A, ayer.', 'Comercial Ejemplo S.A')).toBe('Comercial Ejemplo S.A');
    expect(fin('Lo pagó Comercial Ejemplo S.A', 'Comercial Ejemplo S.A')).toBe('Comercial Ejemplo S.A');   // fin del texto
    expect(fin('Firmó Ana Ficticia Rojas S.A.', 'S.A')).toBe('S.A');   // el sufijo solo no es un nombre
  });
  it('tiempo constante: 40.000 blancos o signos antes del sufijo, por debajo de 50 ms (mira solo los últimos caracteres)', () => {
    for (const relleno of [' '.repeat(40_000), '\t'.repeat(40_000), '. '.repeat(20_000), 's.a '.repeat(10_000)]) {
      const t = 'Comercial' + relleno + 'Ejemplo S.A.';
      const mejor = Math.min(...[0, 1, 2].map(() => { const t0 = performance.now(); completarSufijoSocietario(t, 0, t.length - 1, 'cuerpo'); return performance.now() - t0; }));
      expect(mejor).toBeLessThan(50);
      expect(completarSufijoSocietario(t, 0, t.length - 1, 'cuerpo')).toBe(t.length);
    }
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

describe('T-MO-05 · AJ-6 (D-16): el tratamiento pegado al nombre de una persona entra en el tramo', () => {
  const lista = (t: string, sub: string, id: CaseEntityId = CAS_A) =>
    mk(t, sub, { type: 'PERSONA', source: 'lista', caseEntityId: id, confidence: 'alta', canonicalKey: `LISTA:${id}` });
  const modelo = (t: string, sub: string, key = 'PER:x') =>
    mk(t, sub, { type: 'PERSONA', source: 'modelo', nerLabel: 'PER', score: 0.7, canonicalKey: key });
  const tramos = (t: string, out: readonly MergedCandidate[]): string[] => out.map((d) => t.slice(d.start, d.end));

  it.each([
    ['Doña', 'Gloria'], ['DOÑA', 'GLORIA'], ['doña', 'gloria'], ['Dona', 'Gloria'], ['Don', 'Pedro Ejemplo'], ['don', 'Pedro Ejemplo'],
    ['Sr.', 'Pedro Ejemplo'], ['Sr', 'Pedro Ejemplo'], ['Sra.', 'Ana Prueba'], ['Srta.', 'Ana Prueba'], ['Dr.', 'Iván Ejemplo'],
    ['Dra.', 'Ana Ficticia Rojas'], ['señor', 'Wilson Prueba Bonilla'], ['señora', 'Liliana Ejemplo González'], ['señorita', 'Ana Prueba'],
    ['doctor', 'Iván Darío Ejemplo Pérez'], ['doctora', 'Ana Ficticia'], ['Mr.', 'John Ejemplo'], ['Mrs.', 'Mary Ejemplo'], ['Ms.', 'Mary Ejemplo'],
    ['SEÑOR', 'WILSON PRUEBA'],
  ])('INV-R02 «%s» pegado a «%s»: el tramo lo incluye y la clave canónica no cambia', (trat, nombre) => {
    const t = `El negocio es de ${trat} ${nombre} con Inmobiliaria Ficticia.`;
    const out = run(t, [modelo(t, nombre, 'PER:clave-del-nombre')]);
    expect(tramos(t, out)).toEqual([`${trat} ${nombre}`]);
    expect(out[0]).toMatchObject({ type: 'PERSONA', source: 'modelo', canonicalKey: 'PER:clave-del-nombre', confidence: 'media' });
  });

  it('INV-R02 C24-A007: «Doña Gloria» con el tratamiento dentro del tramo (caso 5 del dictamen de RG-r2)', () => {
    const t = 'Le comento que el negocio es de Doña Gloria con Inmobiliaria Ficticia (nit 800.000.001-1).';
    const out = run(t, [modelo(t, 'Gloria', 'PER:gloria')]);
    expect(show(t, out)).toEqual(['PERSONA:«Doña Gloria»:media']);
    expect(out[0]?.canonicalKey).toBe('PER:gloria');
  });

  it('INV-R02 la persona de la lista conserva su entidad y su clave con el tratamiento dentro del tramo', () => {
    const t = 'Firma Don Mauricio Ficticio Rodríguez, cliente.';
    const out = run(t, [lista(t, 'Mauricio Ficticio Rodríguez')]);
    expect(tramos(t, out)).toEqual(['Don Mauricio Ficticio Rodríguez']);
    expect(out[0]).toMatchObject({ source: 'lista', caseEntityId: CAS_A, canonicalKey: `LISTA:${CAS_A}`, confidence: 'alta' });
  });

  it('INV-R02 dos tratamientos seguidos («el señor doctor Pedro») entran los dos', () => {
    const t = 'Habló el señor doctor Pedro Ejemplo ayer.';
    expect(tramos(t, run(t, [modelo(t, 'Pedro Ejemplo')]))).toEqual(['señor doctor Pedro Ejemplo']);
  });

  it('INV-R02 la lista extendida por el modelo (D-03 E) toma también el tratamiento: «Doña Ana Ficticia Rojas»', () => {
    const t = 'Firmó Doña Ana Ficticia Rojas ayer.';
    const deAna: EsVarianteDe = (id, texto) => id === CAS_A && texto.trim().split(/\s+/u).every((w) => ['ana', 'ficticia', 'rojas'].includes(w.toLowerCase()));
    const out = run(t, [lista(t, 'Ficticia Rojas'), modelo(t, 'Ana Ficticia Rojas')], NO_RULES, 'cuerpo', deAna);
    expect(show(t, out)).toEqual(['PERSONA:«Doña Ana Ficticia Rojas»:media:extendido']);
    expect(out[0]).toMatchObject({ caseEntityId: CAS_A, canonicalKey: `LISTA:${CAS_A}` });
  });

  it.each([
    ['con una coma', 'Habló el señor, Pedro Ejemplo ayer.', 'Pedro Ejemplo'],
    ['con un salto de línea', 'Habló el doctor\nGustavo Ejemplo ayer.', 'Gustavo Ejemplo'],
    ['con otra palabra en medio', 'Habló el señor muy Pedro Ejemplo ayer.', 'Pedro Ejemplo'],
    ['con tres blancos', 'Habló el señor   Pedro Ejemplo ayer.', 'Pedro Ejemplo'],
    ['dentro de una palabra («Cardón»)', 'Habló Cardon Pedro Ejemplo ayer.', 'Pedro Ejemplo'],
    ['dentro de una palabra («Madona»)', 'Habló Madona Pedro Ejemplo ayer.', 'Pedro Ejemplo'],
    ['una palabra que no es tratamiento («Donde»)', 'Habló Donde Pedro Ejemplo ayer.', 'Pedro Ejemplo'],
    ['un artículo no es tratamiento', 'Habló la Pedro Ejemplo ayer.', 'Pedro Ejemplo'],
    ['un título profesional que no está en R-MOD-03', 'Habló la ingeniera Ana Prueba ayer.', 'Ana Prueba'],
  ])('INV-R02 no se extiende %s', (_motivo, t, nombre) => {
    expect(tramos(t, run(t, [modelo(t, nombre)]))).toEqual([nombre]);
  });

  it('INV-R02 solo las personas: una organización o un lugar con «Don» delante no cambia', () => {
    const t = 'Compró en Don Ejemplo S.A.S. ayer.';
    const out = run(t, [mk(t, 'Ejemplo S.A.S.', { type: 'EMPRESA', source: 'modelo', nerLabel: 'ORG', score: 0.7, canonicalKey: 'ORG:ejemplo' })]);
    expect(tramos(t, out)).toEqual(['Ejemplo S.A.S.']);
  });

  it('INV-R02 la detección manual del usuario nunca se amplía', () => {
    const t = 'Habló el señor Pedro Ejemplo ayer.';
    const out = run(t, [mk(t, 'Pedro Ejemplo', { type: 'PERSONA', source: 'manual', confidence: 'alta', canonicalKey: 'PER:pedro ejemplo' })]);
    expect(tramos(t, out)).toEqual(['Pedro Ejemplo']);
  });

  it('INV-R02 si otra detección ocupa el tratamiento, el tramo no lo pisa', () => {
    const t = 'Habló la Dra. Ana Prueba ayer.';
    const out = run(t, [modelo(t, 'Ana Prueba'), mk(t, 'Dra.', { type: 'ENTIDAD', source: 'regla', canonicalKey: 'ORG:dra' })]);
    expect(show(t, out)).toEqual(['ENTIDAD:«Dra.»:media', 'PERSONA:«Ana Prueba»:media']);
  });

  it('INV-R12 la variante débil de la lista (una palabra) no toma el tratamiento; el nombre completo del modelo sí', () => {
    // El reductor (cedeAnteModelo, entities.ts) reconoce la variante débil por no tener blancos: con «señor» dentro ya no cedería el paso.
    const t = 'Pedro Ejemplo demandó. El señor Pedro Luis Ejemplo Prueba declaró.';
    const debil = mk(t, 'Pedro', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, variantClass: 'nombre_suelto', confidence: 'media', canonicalKey: `LISTA:${CAS_A}` }, 1);
    expect(tramos(t, run(t, [debil]))).toEqual(['Pedro']);
    const apellido = mk(t, 'Ejemplo', { type: 'PERSONA', source: 'lista', caseEntityId: CAS_A, variantClass: 'apellido_suelto', confidence: 'media', canonicalKey: `LISTA:${CAS_A}` }, 1);
    const part = mkPart(t);
    const fused = mergeCandidates(part, [debil, apellido], NO_RULES);
    const out = mergeIntoFused(part, fused, [modelo(t, 'Pedro Luis Ejemplo Prueba')], NO_RULES);
    assertInvariants(part, out);
    expect(tramos(t, out)).toEqual(['señor Pedro Luis Ejemplo Prueba']);
  });

  it('INV-R02 el tratamiento ya incluido en el tramo no se repite', () => {
    const t = 'Habló el señor Pedro Ejemplo ayer.';
    expect(tramos(t, run(t, [modelo(t, 'señor Pedro Ejemplo')]))).toEqual(['señor Pedro Ejemplo']);
  });

  it('INV-R02 la salida es la misma en cualquier orden de entrada', () => {
    const t = 'Firmó Doña Ana Ficticia Rojas y el Dr. Pedro Ejemplo.';
    const cands = [modelo(t, 'Ana Ficticia Rojas'), modelo(t, 'Pedro Ejemplo'), lista(t, 'Ficticia Rojas')];
    const a = tramos(t, run(t, cands));
    expect(a).toEqual(['Doña Ana Ficticia Rojas', 'Dr. Pedro Ejemplo']);
    expect(tramos(t, run(t, [...cands].reverse()))).toEqual(a);
  });

  it('INV-R12 la ventana nueva del modelo vuelve a extender la lista que ya traía el tratamiento (D-03 E)', () => {
    const t = 'Firma Don Mauricio Ficticio Rodríguez, cliente.';
    const part = mkPart(t);
    const fused = mergeCandidates(part, [lista(t, 'Mauricio Ficticio')], NO_RULES).map((c) => Object.freeze(c));
    expect(tramos(t, fused)).toEqual(['Don Mauricio Ficticio']);
    const out = mergeIntoFused(part, fused, [modelo(t, 'Mauricio Ficticio Rodríguez')], NO_RULES);
    assertInvariants(part, out);
    expect(show(t, out)).toEqual(['PERSONA:«Don Mauricio Ficticio Rodríguez»:media:extendido']);
    expect(out[0]?.caseEntityId).toBe(CAS_A);
  });

  it('INV-R12 la ventana nueva con un nombre ya fusionado con su tratamiento no lo parte', () => {
    const t = 'Habló la Dra. Ana Prueba ayer.';
    const part = mkPart(t);
    const fused = mergeCandidates(part, [modelo(t, 'Ana Prueba')], NO_RULES).map((c) => Object.freeze(c));
    expect(tramos(t, fused)).toEqual(['Dra. Ana Prueba']);
    const out = mergeIntoFused(part, fused, [modelo(t, 'Ana Prueba')], NO_RULES);
    expect(tramos(t, out)).toEqual(['Dra. Ana Prueba']);
    const sola = mergeIntoFused(part, [], [modelo(t, 'Ana Prueba')], NO_RULES);
    expect(tramos(t, sola)).toEqual(['Dra. Ana Prueba']);
  });

  it('INV-R02 tiempo lineal: 40.000 blancos entre el tratamiento y el nombre no se recorren', () => {
    const t = 'Dr.' + ' '.repeat(40000) + 'Ana Ficticia';
    const cands = [modelo(t, 'Ana Ficticia')];
    const t0 = performance.now();
    const out = run(t, cands);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(tramos(t, out)).toEqual(['Ana Ficticia']);
    const u = 'Dr. '.repeat(10000) + 'Ana Ficticia';
    const t1 = performance.now();
    run(u, [modelo(u, 'Ana Ficticia')]);
    expect(performance.now() - t1).toBeLessThan(200);
  });
});
