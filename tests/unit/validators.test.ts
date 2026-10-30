// T-MO-02 · validadores. Sección del NIT (PA-2). A3 agrega la suya (Luhn, radicado, indicativos) con otro `describe`.
// ARRANQUE ANTICIPADO: hasta que PA-1 se fusione, la vista y el corredor vienen de `_vista-minima.local`; al rebasar se cambian
// por `../../src/core/normalize` (buildSearchView) y `../../src/core/rules/catalog` (runRules).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dvNit, dvNitCoincide, esNitJuridico } from '../../src/core/validators/nit.ts';
import { holderDigits, rules, sameHolderAs, verosimilCC, verosimilTI } from '../../src/core/rules/ids.ts';
import { buildSearchView } from '../../src/core/normalize.ts';
import { runRules } from '../../src/core/rules/catalog.ts';
import type { DetectionCandidate, PartId } from '../../src/core/types.ts';
import { rules as reglasContacto } from '../../src/core/rules/contacto.ts';
import { rules as reglasRadicado } from '../../src/core/rules/radicado.ts';
import { configurarDivipola, CORPORACIONES, divipolaCodes, radicado } from '../../src/core/validators/radicado.ts';
import { correoValido, ndcMovil } from '../../src/core/validators/telefono.ts';

const PARTE = 'prt_00000000000000000000000000000001' as PartId;
const detectar = (texto: string): DetectionCandidate[] =>
  runRules(buildSearchView(texto, 'reglas', 'cuerpo'), PARTE, rules, 2026);
const textoDe = (texto: string, c: DetectionCandidate): string => texto.slice(c.start, c.end);

describe('nit', () => {
  describe('DV del NIT (7.2.2)', () => {
    it('T-MO-02 dvNit coincide con NIT públicos conocidos y con los NIT ficticios del plan', () => {
      expect(dvNit('800197268')).toBe(4);
      expect(dvNit('901267344')).toBe(3);
      expect(dvNit('900000001')).toBe(2);
      expect(dvNit('900000002')).toBe(1);
      expect(dvNit('800000005')).toBe(9);
      expect(dvNit('80000002')).toBe(6);
      expect(dvNit('1000000017')).toBe(6);   // NIT de persona natural = CC + DV
      expect(dvNit('901000002')).toBe(3);
    });
    it('T-MO-02 dvNit devuelve el residuo cuando es 0 o 1 y 11 menos el residuo en los demás casos', () => {
      // Base de un dígito: suma = 3·d. d=0 → r=0 → DV 0; d=4 → 12 mod 11 = 1 → DV 1; d=1 → r=3 → 8; d=3 → r=9 → 2.
      expect(dvNit('0')).toBe(0);
      expect(dvNit('4')).toBe(1);
      expect(dvNit('1')).toBe(8);
      expect(dvNit('3')).toBe(2);
    });
    it('T-MO-02 dvNitCoincide acepta número o cadena y rechaza un DV distinto', () => {
      expect(dvNitCoincide('900000001', '2')).toBe(true);
      expect(dvNitCoincide('900000001', 2)).toBe(true);
      expect(dvNitCoincide('900000001', '0')).toBe(false);
    });
    it('T-MO-02 persona jurídica: base de 9 dígitos que empieza por 8 o 9; el resto es persona natural', () => {
      expect(esNitJuridico('900000001')).toBe(true);
      expect(esNitJuridico('800000005')).toBe(true);
      expect(esNitJuridico('700000001')).toBe(false);
      expect(esNitJuridico('80000002')).toBe(false);
      expect(esNitJuridico('1000000017')).toBe(false);
    });
  });

  describe('INV-R03 e INV-G12: un validador que falla nunca descarta', () => {
    it('INV-R03 NIT «900.000.001-0» (DV erróneo) sigue detectado, con menor confianza que «900.000.001-2»', () => {
      const bueno = 'NIT 900.000.001-2';
      const malo = 'NIT 900.000.001-0';
      const b = detectar(bueno).filter(c => c.ruleId === 'R-NIT-01');
      const m = detectar(malo).filter(c => c.ruleId === 'R-NIT-01');
      expect(b).toHaveLength(1);
      expect(m).toHaveLength(1);
      expect(textoDe(malo, m[0]!)).toBe('900.000.001-0');
      expect(b[0]!.confidence).toBe('alta');
      expect(b[0]!.validator).toEqual({ name: 'DV_NIT', passed: true });
      expect(m[0]!.confidence).toBe('media');
      expect(m[0]!.validator).toEqual({ name: 'DV_NIT', passed: false });
      expect(m[0]!.canonicalKey).toBe('NIT:900000001');   // la clave no depende del DV
    });
    it('INV-G12 el NIT sin rótulo con DV erróneo se detecta y baja una muesca respecto de la base', () => {
      const t = 'Ferretería Ejemplo S.A.S. (900.000.001-0)';
      const c = detectar(t).filter(x => x.ruleId === 'R-NIT-02');
      expect(c).toHaveLength(1);
      expect(textoDe(t, c[0]!)).toBe('900.000.001-0');
      expect(c[0]!.confidence).toBe('baja');
      expect(c[0]!.validator?.passed).toBe(false);
    });
    it('INV-G12 con DV válido, R-NIT-02 sube a alta; sin DV queda en media (agrupado) o baja (seguido)', () => {
      const conf = (t: string): string | undefined => detectar(t).find(x => x.ruleId === 'R-NIT-02')?.confidence;
      expect(conf('900.000.001-2')).toBe('alta');
      expect(conf('900.000.002')).toBe('media');
      expect(conf('900000002')).toBe('baja');
    });
    it('INV-G12 base de persona natural no verosímil: una muesca menos, nunca descarte', () => {
      const t = 'NIT 123456789012';
      const c = detectar(t).filter(x => x.ruleId === 'R-NIT-01');
      expect(c).toHaveLength(1);
      expect(c[0]!.confidence).toBe('media');
    });
    it('INV-G12 verosimilCC y verosimilTI solo califican: «C.C. 00.000.000» sigue detectada en media', () => {
      expect(verosimilCC('00000000')).toBe(false);
      expect(verosimilCC('41000001')).toBe(true);
      expect(verosimilCC('1000000001')).toBe(true);
      expect(verosimilCC('3000000001')).toBe(false);
      expect(verosimilCC('123456789')).toBe(false);
      expect(verosimilTI('1000000002')).toBe(true);
      expect(verosimilTI('08031512345')).toBe(true);
      expect(verosimilTI('99133112345')).toBe(false);
      const c = detectar('C.C. 00.000.000').find(x => x.ruleId === 'R-CC-01');
      expect(c?.confidence).toBe('media');
    });
    it('INV-G12 los ruleId de identificaciones cumplen ^R-[A-Z_]+-\\d{2}$ y son únicos', () => {
      const ids = rules.map(r => r.id);
      for (const id of ids) expect(id).toMatch(/^R-[A-Z_]+-\d{2}$/);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(['R-CC-01', 'R-CC-02', 'R-CC-03', 'R-TI-01', 'R-DOC-01', 'R-CE-01', 'R-PPT-01', 'R-PEP-01',
        'R-PASAPORTE-01', 'R-NIT-01', 'R-NIT-02', 'R-TP-01']);
    });
  });

  describe('INV-T05 mismo titular (sameHolderAs, 7.12.3)', () => {
    const e = (id: string, type: Parameters<typeof holderDigits>[0], canonicalKey: string) => ({ id, type, canonicalKey });

    it('INV-T05 CC, NIT de persona natural y HC con los mismos dígitos se unen, y la relación es simétrica', () => {
      const m = sameHolderAs([
        e('a', 'CC', 'CC:80000002'), e('b', 'NIT', 'NIT:80000002'), e('c', 'HC', 'HC:80000002'),
        e('d', 'CC', 'CC:41000001'),
      ]);
      expect([...(m.get('a') ?? [])].sort()).toEqual(['b', 'c']);
      expect([...(m.get('b') ?? [])].sort()).toEqual(['a', 'c']);
      expect([...(m.get('c') ?? [])].sort()).toEqual(['a', 'b']);
      expect(m.has('d')).toBe(false);
      for (const [x, otros] of m) for (const y of otros) expect(m.get(y)?.has(x)).toBe(true);   // simetría
    });
    it('INV-T05 solo unen las familias de identificación: TP, PASAPORTE, NIT jurídico y AFILIACION alfanumérica no entran', () => {
      const m = sameHolderAs([
        e('cc', 'CC', 'CC:900000001'), e('nit', 'NIT', 'NIT:900000001'), e('tp', 'TP', 'TP:900000001'),
        e('pas', 'PASAPORTE', 'PASAPORTE:900000001'), e('afA', 'AFILIACION', 'AFIL:AB900000001'), e('afN', 'AFILIACION', 'AFIL:900000001'),
        e('tel', 'TELEFONO', 'TEL:900000001'),
      ]);
      expect([...(m.get('cc') ?? [])].sort()).toEqual(['afN']);
      expect(m.has('nit')).toBe(false);
      for (const id of ['tp', 'pas', 'afA', 'tel']) expect(m.has(id)).toBe(false);
    });
    it('INV-T05 TI, CE, PPT, PEP y DOCUMENTO con los mismos dígitos también se unen; los que no coinciden, no', () => {
      const m = sameHolderAs([
        e('ti', 'TI', 'TI:1000000002'), e('doc', 'DOCUMENTO', 'DOCUMENTO:1000000002'), e('cc', 'CC', 'CC:1000000002'),
        e('ce', 'CE', 'CE:1000003'), e('ppt', 'PPT', 'PPT:1000003'), e('pep', 'PEP', 'PEP:12345'),
      ]);
      expect([...(m.get('ti') ?? [])].sort()).toEqual(['cc', 'doc']);
      expect([...(m.get('ce') ?? [])]).toEqual(['ppt']);
      expect(m.has('pep')).toBe(false);
    });
    it('INV-T05 holderDigits: NIT natural toma los dígitos de la CC; el jurídico y los tipos ajenos devuelven null', () => {
      expect(holderDigits('NIT', 'NIT:80000002')).toBe('80000002');
      expect(holderDigits('NIT', 'NIT:900000001')).toBeNull();
      expect(holderDigits('TP', 'TP:00098')).toBeNull();
      expect(holderDigits('CC', 'CC:41000001')).toBe('41000001');
    });
    it('INV-T05 una lista vacía o de una sola entidad no produce uniones', () => {
      expect(sameHolderAs([]).size).toBe(0);
      expect(sameHolderAs([e('x', 'CC', 'CC:41000001')]).size).toBe(0);
    });
  });
});

// ---- PA-3 (A3): radicado y telefono ----
const PART_A3 = 'prt_00000000000000000000000000000001' as PartId;
const DIVIPOLA = divipolaCodes([
  { dep: '11', mun: '11001' }, { dep: '05', mun: '05001' }, { dep: '25', mun: '25843' }, { dep: '76', mun: '76001' },
]);

function detectarCon(texto: string, reglas: typeof reglasRadicado, refYear = 2026): ReturnType<typeof runRules> {
  return runRules(buildSearchView(texto, 'reglas', 'cuerpo'), PART_A3, reglas, refYear);
}

describe('radicado', () => {
  beforeEach(() => configurarDivipola(DIVIPOLA));
  afterEach(() => configurarDivipola(null));

  it('T-MO-02 23 dígitos: DANE en la DIVIPOLA, año en [1990, refYear] y corporación de la lista', () => {
    expect(radicado('11001310399920260012300', 2026)).toEqual({ ok: true, corpOk: true });
    expect(radicado('05001400399920250004500', 2026)).toEqual({ ok: true, corpOk: true });
    expect(radicado('11001310399919900012300', 2026).ok).toBe(true);        // límite inferior
    expect(radicado('11001310399920260012300', 2026).ok).toBe(true);        // límite superior
    expect(radicado('11001310399920270012300', 2026).ok).toBe(false);       // año futuro
    expect(radicado('11001310399919890012300', 2026).ok).toBe(false);       // año anterior a 1990
    expect(radicado('11001310399920270012300', 2027).ok).toBe(true);        // depende de refYear
  });

  it('T-MO-02 el DANE debe estar en la DIVIPOLA, o ser DD000 con DD departamento válido (tribunales)', () => {
    expect(radicado('99999310399920260012300', 2026).ok).toBe(false);
    expect(radicado('25000232699920120012301', 2026).ok).toBe(true);        // 25000: tribunal de Cundinamarca
    expect(radicado('99000232699920120012301', 2026).ok).toBe(false);       // departamento 99 fuera del conjunto
    expect(radicado('11002310399920260012300', 2026).ok).toBe(false);       // municipio inexistente
  });

  it('T-MO-02 la corporación fuera de la lista baja la confianza (corpOk) pero no invalida', () => {
    const r = radicado('11001990399920260012300', 2026);
    expect(r).toEqual({ ok: true, corpOk: false });
    expect(CORPORACIONES.has('41')).toBe(true);                             // pequeñas causas
    expect(CORPORACIONES.has('99')).toBe(false);
  });

  it('T-MO-02 21 dígitos (sin recurso) se validan como los de 23', () => {
    expect(radicado('110016000999202600001', 2026)).toEqual({ ok: true, corpOk: true });
    expect(radicado('990016000999202600001', 2026).ok).toBe(false);
  });

  it('T-MO-02 22 dígitos: formato de 1998 a 2002 (a) o DANE sin el 0 inicial (b)', () => {
    expect(radicado('1100131039992001012300', 2026)).toEqual({ ok: true, corpOk: true });   // (a) año 2001
    expect(radicado('1100131039992005012300', 2026).ok).toBe(false);                        // (a) año fuera de 1998–2002
    expect(radicado('5001310399920260012300', 2026)).toEqual({ ok: true, corpOk: true });   // (b) 05001 sin el 0
    expect(radicado('5001990399920260012300', 2026)).toEqual({ ok: true, corpOk: false });  // (b) corporación fuera
    expect(radicado('9999310399920260012300', 2026).ok).toBe(false);
  });

  it('T-MO-02 otras longitudes y caracteres que no son dígitos nunca validan', () => {
    for (const d of ['', '1', '1100131039992026001230', '1100131039992026001230000', '11001-310399920260012300', '1100131039992026001230a']) {
      if (d === '1100131039992026001230') continue;                           // es de 22 dígitos: lo cubre la prueba anterior
      expect(radicado(d, 2026)).toEqual({ ok: false, corpOk: false });
    }
  });

  it('T-MO-02 sin DIVIPOLA configurada ni inyectada el DANE no se reconoce: ok es falso, sin lanzar', () => {
    configurarDivipola(null);
    expect(radicado('11001310399920260012300', 2026)).toEqual({ ok: false, corpOk: true });
    expect(radicado('11001310399920260012300', 2026, DIVIPOLA).ok).toBe(true);              // inyectada como parámetro
  });

  it('T-MO-02 INV-R03 · un radicado que no valida sigue detectado con menor confianza; nunca se descarta', () => {
    const valido = detectarCon('radicado 11001-31-03-999-2026-00123-00', reglasRadicado);
    expect(valido).toHaveLength(1);
    expect(valido[0]).toMatchObject({ confidence: 'alta', validator: { name: 'RADICADO', passed: true }, label: { labelId: 'ROT-RAD' } });
    const invalidoRotulado = detectarCon('radicado 99999-31-03-999-2026-00123-00', reglasRadicado);
    expect(invalidoRotulado).toHaveLength(1);
    expect(invalidoRotulado[0]).toMatchObject({ confidence: 'media', validator: { name: 'RADICADO', passed: false } });
    const invalidoSinRotulo = detectarCon('99999310399920260012300', reglasRadicado);
    expect(invalidoSinRotulo).toHaveLength(1);
    expect(invalidoSinRotulo[0]).toMatchObject({ confidence: 'baja', validator: { name: 'RADICADO', passed: false } });
    expect(invalidoSinRotulo[0]?.label).toBeUndefined();
    const corpFuera = detectarCon('11001-99-03-999-2026-00123-00', reglasRadicado);
    expect(corpFuera[0]).toMatchObject({ confidence: 'media', validator: { passed: true } });
  });

  it('T-MO-02 varios radicados contiguos salen como candidatos separados y el tramo es el radicado completo', () => {
    const texto = 'Procesos 11001-31-03-999-2026-00123-00 y 05001-40-03-999-2025-00045-00 acumulados';
    const out = detectarCon(texto, reglasRadicado);
    expect(out.map((c) => texto.slice(c.start, c.end))).toEqual(['11001-31-03-999-2026-00123-00', '05001-40-03-999-2025-00045-00']);
    expect(new Set(out.map((c) => c.canonicalKey)).size).toBe(2);
  });
});

describe('telefono', () => {
  it('T-MO-02 ndcMovil: aproximación 3[0-5]x a los indicativos móviles', () => {
    for (const d of ['3000000001', '3051234567', '3101234567', '3331234567', '3501234567', '3591234567']) expect(ndcMovil(d)).toBe(true);
    for (const d of ['3601234567', '3991234567', '6011234567', '2001234567', '1000000001', '']) expect(ndcMovil(d)).toBe(false);
  });

  it('T-MO-02 correoValido: parte local ≤ 64, dominio ≤ 253, sin «..» y último rótulo de 2 a 24 letras', () => {
    expect(correoValido('ana.ficticia@ejemplo.test')).toBe(true);
    expect(correoValido('josé.ejemplo@ejemplo.test')).toBe(true);
    expect(correoValido(`${'a'.repeat(64)}@ejemplo.test`)).toBe(true);
    expect(correoValido(`${'a'.repeat(65)}@ejemplo.test`)).toBe(false);
    expect(correoValido('ana..ficticia@ejemplo.test')).toBe(false);
    expect(correoValido('ana@ejemplo..test')).toBe(false);
    expect(correoValido('ana@ejemplo.t')).toBe(false);
    expect(correoValido(`ana@ejemplo.${'a'.repeat(25)}`)).toBe(false);
    expect(correoValido('ana@ejemplo')).toBe(false);
    expect(correoValido('sin-arroba.test')).toBe(false);
    expect(correoValido('@ejemplo.test')).toBe(false);
    expect(correoValido(`ana@${'b'.repeat(250)}.test`)).toBe(false);        // dominio de más de 253 caracteres
  });

  it('T-MO-02 INV-R03 · el celular con NDC fallido y el correo inválido siguen detectados con una muesca menos', () => {
    const cel = detectarCon('395 000 0001', reglasContacto);
    expect(cel).toHaveLength(1);
    expect(cel[0]).toMatchObject({ confidence: 'baja', validator: { name: 'NDC', passed: false }, canonicalKey: 'TEL:3950000001' });
    const celOk = detectarCon('300 000 0001', reglasContacto);
    expect(celOk[0]).toMatchObject({ confidence: 'media', validator: { name: 'NDC', passed: true } });
    const intl = detectarCon('+57 395 000 0001', reglasContacto);
    expect(intl[0]).toMatchObject({ confidence: 'media', validator: { passed: false } });
    const correo = detectarCon('ana..ficticia@ejemplo.test', reglasContacto);
    expect(correo).toHaveLength(1);
    expect(correo[0]).toMatchObject({ confidence: 'media', validator: { name: 'CORREO', passed: false } });
    expect(detectarCon('ana.ficticia@ejemplo.test', reglasContacto)[0]).toMatchObject({ confidence: 'alta', validator: { passed: true } });
  });

  it('T-MO-02 la clave del teléfono es la misma con o sin prefijo, separadores o rótulo', () => {
    const claves = ['300 000 0001', '+57 300 000 0001', '(+57) 300-000-0001', '3000000001', '0057 3000000001', 'Cel. 300.000.0001']
      .map((t) => [...new Set(detectarCon(t, reglasContacto).map((c) => c.canonicalKey))]);   // con rótulo, R-TEL-01 y R-TEL-03 coinciden: lo resuelve la fusión
    for (const k of claves) expect(k).toEqual(['TEL:3000000001']);
    expect(detectarCon('(601) 000 0001', reglasContacto)[0]?.canonicalKey).toBe('TEL:6010000001');
    expect(detectarCon('teléfono (1) 000 0001', reglasContacto)[0]?.canonicalKey).toBe('TEL:6010000001');   // fijo antiguo → plan vigente
    expect(detectarCon('Oficina (1) 000 0001', reglasContacto)[0]?.canonicalKey).toBe('TEL:6010000001');
    expect(detectarCon('Tel. 000 0001', reglasContacto)[0]?.canonicalKey).toBe('TEL:0000001');              // 7 dígitos sin indicativo
  });

  it('T-MO-02 el correo ofuscado y el normal comparten clave', () => {
    const normal = detectarCon('ana.ficticia@ejemplo.test', reglasContacto)[0]?.canonicalKey;
    const ofuscado = detectarCon('ana.ficticia (arroba) ejemplo (punto) test', reglasContacto)[0]?.canonicalKey;
    expect(ofuscado).toBe(normal);
    expect(detectarCon('ana.ficticia [at] ejemplo punto test', reglasContacto)[0]?.canonicalKey).toBe(normal);
  });
});

describe('rendimiento de radicado y contacto', () => {
  it('T-MO-02 entradas adversarias de 100.000 caracteres (rachas de dígitos, espacios, guiones y arrobas) se procesan sin cuelgue', () => {
    const casos = [
      '1 '.repeat(50000), '1-'.repeat(50000), '12345.'.repeat(16000), '1\n'.repeat(50000), 'a'.repeat(100000),
      '3 '.repeat(50000), 'a@'.repeat(50000), '(arroba) '.repeat(11000), 'ana.ficticia '.repeat(7000) + 'arroba ',
      '300 000 0001 '.repeat(7000), 'radicado 11001-31-03-999-2026-00123-00 '.repeat(2500),
    ];
    for (const texto of casos) {
      const t0 = Date.now();
      detectarCon(texto, [...reglasRadicado, ...reglasContacto]);
      expect(Date.now() - t0, `${texto.slice(0, 12)}…`).toBeLessThan(20000);
    }
  });
});
