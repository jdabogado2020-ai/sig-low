// Validador de radicado judicial (PA-3; plan 7.2.2). TypeScript puro: sin DOM, sin red, sin registro.
//
// `radicado(d, refYear)` comprueba la estructura DANE (5) + corporación (2) + especialidad (2) + despacho (3) +
// año (4) + consecutivo (5) + recurso (2). Un validador que falla baja la confianza; nunca descarta (INV-R03).
//
// La DIVIPOLA (`data/divipola.json`, PG-4) se inyecta: o como último parámetro de `radicado`, o una vez por sesión del
// worker con `configurarDivipola`. Es un conjunto de códigos públicos, no datos del documento. Sin DIVIPOLA
// configurada, el código DANE no se reconoce y `ok` es falso (la confianza baja, el radicado no se pierde).

/** Códigos de la DIVIPOLA: municipios de 5 dígitos y departamentos de 2. */
export interface DivipolaCodes {
  readonly municipios: ReadonlySet<string>;
  readonly departamentos: ReadonlySet<string>;
}

/** Construye los dos conjuntos desde las filas de `data/divipola.json` (`DivipolaFile`). */
export function divipolaCodes(rows: readonly { readonly dep: string; readonly mun: string }[]): DivipolaCodes {
  const municipios = new Set<string>();
  const departamentos = new Set<string>();
  for (const row of rows) {
    municipios.add(row.mun);
    departamentos.add(row.dep);
  }
  return { municipios, departamentos };
}

let configurada: DivipolaCodes | null = null;

/** Fija (o, con `null`, borra) la DIVIPOLA que usa `radicado` cuando no recibe una explícita. */
export function configurarDivipola(codes: DivipolaCodes | null): void {
  configurada = codes;
}

/**
 * Corporaciones del Acuerdo 201 de 1997, art. 2, más 41 (pequeñas causas), que aparece en radicados reales.
 * Solo ajusta la confianza.
 */
export const CORPORACIONES: ReadonlySet<string> = new Set([
  '01', '02', '03', '04', '05', '06', '07', '11', '12', '21', '22', '23', '31', '32', '33', '40', '41', '60',
]);

export const ANIO_RADICADO_MINIMO = 1990;

export interface ResultadoRadicado { ok: boolean; corpOk: boolean }

function daneOk(code: string, divipola: DivipolaCodes): boolean {
  if (divipola.municipios.has(code)) return true;
  // Tribunales de sede departamental: DD000 con DD departamento válido [VERIFICAR].
  return code.endsWith('000') && divipola.departamentos.has(code.slice(0, 2));
}

/**
 * Valida un radicado escrito solo con dígitos (21, 22 o 23).
 * - 23 y 21: DANE `d[0..5)` en DIVIPOLA o `DD000`; año `d[12..16)` en [1990, refYear]; `corpOk` sobre `d[5..7)`.
 * - 22: (a) formato de 1998 a 2002 (consecutivo de 4): DANE `d[0..5)` y año `d[12..16)` en [1998, 2002];
 *   (b) DANE sin el 0 inicial (Excel): `'0' + d[0..4)` y año `d[11..15)` en [1990, refYear], `corpOk` sobre `d[4..6)`.
 *   `ok = a ∨ b`; si valen ambas, `corpOk` sale de (a).
 * Cualquier otra longitud, o caracteres que no sean dígitos: `{ ok: false, corpOk: false }`.
 */
export function radicado(d: string, refYear: number, divipola?: DivipolaCodes): ResultadoRadicado {
  const codes = divipola ?? configurada;
  const no: ResultadoRadicado = { ok: false, corpOk: false };
  if (!/^\d+$/u.test(d) || d.length < 21 || d.length > 23) return no;
  const anioEn = (from: number, lo: number, hi: number): boolean => {
    const y = Number(d.slice(from, from + 4));
    return y >= lo && y <= hi;
  };
  if (codes === null) return { ok: false, corpOk: CORPORACIONES.has(d.slice(5, 7)) };
  if (d.length !== 22) {
    return { ok: daneOk(d.slice(0, 5), codes) && anioEn(12, ANIO_RADICADO_MINIMO, refYear), corpOk: CORPORACIONES.has(d.slice(5, 7)) };
  }
  const a = daneOk(d.slice(0, 5), codes) && anioEn(12, 1998, 2002);
  const b = daneOk(`0${d.slice(0, 4)}`, codes) && anioEn(11, ANIO_RADICADO_MINIMO, refYear);
  return { ok: a || b, corpOk: a ? CORPORACIONES.has(d.slice(5, 7)) : CORPORACIONES.has(d.slice(4, 6)) };
}
