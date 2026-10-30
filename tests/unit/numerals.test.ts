// T-MO-03 · numerales y validadores de fecha (PA-6; plan 7.5.2 y 7.5.3), lectura de cifras (7.6.2) y consolidación de
// fechas sin año (7.5.4). Los ejemplos de reglas de fechas y valores van en tests/fixtures/reglas-ejemplos/{fechas,valores}.json
// (T-MO-01, los recorre rules-catalogo.test.ts).
import { describe, expect, it } from 'vitest';
import {
  NUMERAL_WORDS, daysIn, expandYY, isLeap, isoDate, monthNum, numberToWords, romanMonth, validDate, wordsToNumber,
} from '../../src/core/numerals.ts';
import type { NumeralMode } from '../../src/core/numerals.ts';
import { buildSearchView } from '../../src/core/normalize.ts';
import { runRules } from '../../src/core/rules/catalog.ts';
import { consolidarFechasSinAnio, rules as reglasFechas } from '../../src/core/rules/fechas.ts';
import { multiplier, parseCifra, rules as reglasValores } from '../../src/core/rules/valores.ts';
import type { DetectionCandidate, PartId } from '../../src/core/types.ts';

const PARTE = 'prt_00000000000000000000000000000001' as PartId;
const detectar = (texto: string, reglas: typeof reglasFechas, refYear = 2026): DetectionCandidate[] =>
  runRules(buildSearchView(texto, 'reglas', 'cuerpo'), PARTE, reglas, refYear);

describe('T-MO-03 wordsToNumber (7.5.2)', () => {
  const exactos: Array<[string, number]> = [
    ['cero', 0], ['uno', 1], ['un', 1], ['una', 1], ['quince', 15], ['dieciséis', 16], ['dieciseis', 16], ['veintiún', 21], ['veintiuno', 21],
    ['treinta y uno', 31], ['treinta y un', 31], ['cuarenta y ocho', 48], ['cien', 100], ['ciento uno', 101], ['doscientas', 200],
    ['novecientos noventa y nueve', 999], ['mil', 1000], ['mil uno', 1001], ['dos mil', 2000], ['dos mil veintiséis', 2026],
    ['mil novecientos noventa y uno', 1991], ['veintiún mil', 21000], ['cien mil', 100000], ['un millón', 1000000],
    ['un millón quinientos mil', 1500000], ['cuarenta y ocho millones', 48000000], ['cuarenta y ocho millones quinientos mil', 48500000],
    ['mil millones', 1000000000], ['dos mil millones', 2000000000], ['cien mil millones', 100000000000],
    ['novecientos noventa y nueve mil novecientos noventa y nueve millones novecientos noventa y nueve mil novecientos noventa y nueve', 999999999999],
    ['CUARENTA Y OCHO MILLONES', 48000000], ['Dos Mil Veintiséis', 2026], ['un millón quinientos', 1000500], ['treinta-y-uno', 31],
  ];
  it.each(exactos)('«%s» → %i, sin tolerancia', (frase, valor) => {
    expect(wordsToNumber(frase)).toEqual({ value: valor, tolerated: false });
  });

  const tolerados: Array<[string, number]> = [
    ['treinta uno', 31], ['diez y seis', 16], ['veinte y tres', 23], ['un mil quinientos', 1500], ['millón', 1000000],
    ['un millones', 1000000], ['ciento mil', 100000],
  ];
  it.each(tolerados)('«%s» → %i, tolerado', (frase, valor) => {
    expect(wordsToNumber(frase)).toEqual({ value: valor, tolerated: true });
  });

  const nulos = ['', '   ', 'y', 'dos dos', 'mil mil', 'veinte diez', 'cien ciento', 'millones', 'un billón', 'cuarenta y', 'mil millones millones', 'abc',
    'constructor', 'toString', '__proto__'];
  it.each(nulos)('«%s» → null', (frase) => {
    expect(wordsToNumber(frase)).toBeNull();
  });

  const modos: Array<[string, NumeralMode, number | null, boolean]> = [
    ['dos veintitrés', 'anio', 2023, true], ['dos veintitrés', 'general', null, false], ['primero', 'dia', 1, false],
    ['primer', 'dia', 1, false], ['primero', 'general', null, false], ['dos mil veintitrés', 'anio', 2023, false],
    ['dos mil', 'anio', 2000, false], ['quince', 'dia', 15, false],
  ];
  it.each(modos)('«%s» en modo %s → %s', (frase, modo, valor, tolerado) => {
    expect(wordsToNumber(frase, modo)).toEqual(valor === null ? null : { value: valor, tolerated: tolerado });
  });

  it('el vocabulario incluye las formas con y sin tilde y cada palabra se lee sola', () => {
    for (const w of ['veintiún', 'veintiun', 'dieciséis', 'dieciseis', 'millón', 'millon', 'veintidós', 'veintidos']) expect(NUMERAL_WORDS).toContain(w);
    for (const w of NUMERAL_WORDS) {
      if (w === 'primero' || w === 'primer') continue;     // solo en modo «dia»
      const r = wordsToNumber(w);
      expect(r === null || r.value >= 0).toBe(true);
    }
  });
});

describe('T-MO-03 numberToWords (7.5.2)', () => {
  const casos: Array<[number, string]> = [
    [0, 'cero'], [21, 'veintiuno'], [100, 'cien'], [101, 'ciento uno'], [2026, 'dos mil veintiséis'], [21000, 'veintiún mil'],
    [1500000, 'un millón quinientos mil'], [48000000, 'cuarenta y ocho millones'], [1000000000, 'mil millones'], [31000000, 'treinta y un millones'],
  ];
  it.each(casos)('%i → «%s»', (n, letras) => {
    expect(numberToWords(n)).toBe(letras);
  });
  it.each(casos.map(([n]) => n))('ida y vuelta de %i', (n) => {
    const letras = numberToWords(n);
    expect(letras).not.toBeNull();
    expect(wordsToNumber(letras as string)).toEqual({ value: n, tolerated: false });
  });
  it('fuera de rango o no entero → null', () => {
    expect(numberToWords(-1)).toBeNull();
    expect(numberToWords(1e12)).toBeNull();
    expect(numberToWords(1.5)).toBeNull();
    expect(numberToWords(Number.NaN)).toBeNull();
  });
});

describe('T-MO-03 validador FECHA y años de dos cifras (7.5.3)', () => {
  const fechas: Array<[number, number, number, boolean]> = [
    [2024, 2, 29, true], [2026, 2, 29, false], [2026, 4, 31, false], [1899, 12, 31, false], [2100, 1, 1, false],
    [1900, 1, 1, true], [2026, 12, 31, true], [2000, 2, 29, true], [1900, 2, 29, false], [2026, 0, 1, false], [2026, 13, 1, false], [2026, 1, 0, false],
  ];
  it.each(fechas)('validDate(%i, %i, %i) → %s', (y, m, d, ok) => {
    expect(validDate(y, m, d)).toBe(ok);
  });
  const anios: Array<[number, number]> = [[26, 2026], [27, 2027], [28, 1928], [90, 1990], [0, 2000]];
  it.each(anios)('expandYY(%i, 2026) → %i', (aa, y) => {
    expect(expandYY(aa, 2026)).toBe(y);
  });
  it('expandYY depende del año de referencia y los bisiestos siguen la regla gregoriana', () => {
    expect(expandYY(31, 2030)).toBe(2031);
    expect(expandYY(31, 2026)).toBe(1931);
    expect(isLeap(2000)).toBe(true);
    expect(isLeap(1900)).toBe(false);
    expect(daysIn(2024, 2)).toBe(29);
    expect(daysIn(2026, 2)).toBe(28);
  });
  it('meses: nombres, abreviaturas con punto, «set.» = septiembre y romanos solo en mayúscula', () => {
    expect(monthNum('Marzo')).toBe(3);
    expect(monthNum('sept.')).toBe(9);
    expect(monthNum('SET')).toBe(9);
    expect(monthNum('setiembre')).toBe(9);
    expect(monthNum('constructor')).toBeNull();
    expect(romanMonth('XII')).toBe(12);
    expect(romanMonth('xii')).toBeNull();
    expect(romanMonth('XIV')).toBeNull();
    expect(isoDate(2026, 3, 4)).toBe('2026-03-04');
  });
});

describe('T-MO-03 lectura de cifras y multiplicadores (7.6.2)', () => {
  const casos: Array<[string, string | undefined, number]> = [
    ['48.000.000', undefined, 48000000], ["48'000.000", undefined, 48000000], ['48.000.000,00', undefined, 48000000],
    ['48.000.000.oo', undefined, 48000000], ['1,000.00', undefined, 1000], ['48,5', 'millones', 48500000], ['1.500', 'millones', 1500000000],
    ['30', 'MM', 30000000], ['300', 'mil millones', 300000000000], ['1.500', undefined, 1500], ['4.5', 'millones', 4500000], ['48', 'MILLONES', 48000000],
  ];
  it.each(casos)('«%s» × %s → %i', (cifra, mult, valor) => {
    expect(Math.round(parseCifra(cifra) * multiplier(mult))).toBe(valor);
  });
  it('multiplicadores: «M» y «mill.» valen un millón; una palabra ajena da NaN', () => {
    expect(multiplier('M')).toBe(1e6);
    expect(multiplier('mill.')).toBe(1e6);
    expect(multiplier('mil')).toBe(1e3);
    expect(Number.isNaN(multiplier('docenas'))).toBe(true);
    expect(Number.isNaN(parseCifra('abc'))).toBe(true);
  });
});

describe('INV-G12 un validador de fecha que falla nunca descarta', () => {
  it('INV-G12 «31/02/2026» se detecta en baja con clave FECHA:~… (nunca se descarta)', () => {
    const c = detectar('radicada el 31/02/2026 en la secretaría', reglasFechas).filter((x) => x.ruleId === 'R-FEC-01');
    expect(c).toHaveLength(1);
    expect(c[0]?.confidence).toBe('baja');
    expect(c[0]?.canonicalKey).toBe('FECHA:~31/02/2026');
  });
  it('INV-G12 «2026-02-30» (ISO inválida) y «30 de febrero de 2026» siguen detectadas en baja', () => {
    for (const t of ['corte 2026-02-30', 'el 30 de febrero de 2026']) {
      const c = detectar(t, reglasFechas);
      expect(c).toHaveLength(1);
      expect(c[0]?.confidence).toBe('baja');
      expect(c[0]?.canonicalKey.startsWith('FECHA:~')).toBe(true);
    }
  });
  it('la misma fecha en letras y en números da la misma clave ISO y las letras prevalecen sobre las cifras', () => {
    const claves = ['14/03/2026', 'catorce (14) de marzo de dos mil veintiséis (2026)', '14-III-2026', '14 de marzo de 2026', 'Marzo 14, 2026', '14-mar-2026', '2026-03-14']
      .map((t) => detectar(t, reglasFechas).map((x) => x.canonicalKey));
    for (const k of claves) expect(k).toEqual(['FECHA:2026-03-14']);
    const difieren = detectar('el quince (14) de marzo de dos mil veintiséis (2026)', reglasFechas);
    expect(difieren[0]?.canonicalKey).toBe('FECHA:2026-03-15');
    expect(difieren[0]?.confidence).toBe('baja');
  });
  it('INV-G12 «cuarenta y ocho millones de pesos ($47.000.000)» es una sola detección con la clave de las letras, en baja', () => {
    const c = detectar('cuarenta y ocho millones de pesos ($47.000.000)', reglasValores).filter((x) => x.ruleId === 'R-VAL-04');
    expect(c).toHaveLength(1);
    expect(c[0]?.canonicalKey).toBe('VALOR:48000000');
    expect(c[0]?.confidence).toBe('baja');
  });
  it('«cuarenta y ocho millones de pesos ($48.000.000)» es un solo dato con clave VALOR:48000000 (criterio de PA-6)', () => {
    const t = 'cuarenta y ocho millones de pesos ($48.000.000)';
    const c = detectar(t, reglasValores).filter((x) => x.ruleId === 'R-VAL-04');
    expect(c).toHaveLength(1);
    expect(t.slice(c[0]?.start, c[0]?.end)).toBe(t);
    expect(c[0]?.canonicalKey).toBe('VALOR:48000000');
    expect(detectar('$48.000.000', reglasValores)[0]?.canonicalKey).toBe('VALOR:48000000');
    expect(detectar('48 millones', reglasValores)[0]?.canonicalKey).toBe('VALOR:48000000');
  });
  it('los ruleId de fechas y valores cumplen ^R-[A-Z_]+-\\d{2}$ y son únicos', () => {
    const ids = [...reglasFechas, ...reglasValores].map((r) => r.id);
    for (const id of ids) expect(id).toMatch(/^R-[A-Z_]+-\d{2}$/u);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(15);
  });
});

describe('consolidación de fechas sin año (R-FEC-09)', () => {
  const todas = [...reglasFechas];
  it('con una sola fecha completa del mismo día y mes, la fecha sin año toma su clave ISO', () => {
    const t = 'El 14 de marzo de 2026 se presentó; desde el 14 de marzo no recibe respuesta.';
    const c = consolidarFechasSinAnio(detectar(t, todas));
    expect(c.map((x) => x.canonicalKey)).toEqual(['FECHA:2026-03-14', 'FECHA:2026-03-14']);
  });
  it('con dos fechas completas distintas del mismo día y mes, o con ninguna, la fecha sin año queda como estaba', () => {
    const dos = consolidarFechasSinAnio(detectar('14 de marzo de 2025, 14 de marzo de 2026 y el 14 de marzo', todas));
    expect(dos.at(-1)?.canonicalKey).toBe('FECHA:~14 de marzo');
    const ninguna = consolidarFechasSinAnio(detectar('el 14 de marzo viajó', todas));
    expect(ninguna[0]?.canonicalKey).toBe('FECHA:~14 de marzo');
  });
  it('«primero de enero» toma la clave de «1 de enero de 2020» y la lista de entrada no se modifica', () => {
    const entrada = detectar('el primero de enero viajó; el 1 de enero de 2020 firmó', todas);
    const antes = JSON.stringify(entrada);
    const salida = consolidarFechasSinAnio(entrada);
    expect(JSON.stringify(entrada)).toBe(antes);
    expect(salida.map((x) => x.canonicalKey)).toEqual(['FECHA:2020-01-01', 'FECHA:2020-01-01']);
  });
});
