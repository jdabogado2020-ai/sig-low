// T-MO-02 · validadores. Sección del NIT (PA-2). A3 agrega la suya (Luhn, radicado, indicativos) con otro `describe`.
// ARRANQUE ANTICIPADO: hasta que PA-1 se fusione, la vista y el corredor vienen de `_vista-minima.local`; al rebasar se cambian
// por `../../src/core/normalize` (buildSearchView) y `../../src/core/rules/catalog` (runRules).
import { describe, expect, it } from 'vitest';
import { dvNit, dvNitCoincide, esNitJuridico } from '../../src/core/validators/nit.ts';
import { holderDigits, rules, sameHolderAs, verosimilCC, verosimilTI } from '../../src/core/rules/ids.ts';
import { buildSearchView } from '../../src/core/normalize.ts';
import { runRules } from '../../src/core/rules/catalog.ts';
import type { DetectionCandidate, PartId } from '../../src/core/types.ts';

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
