// Transformador de respuestas de la IA para T-RI-06 (plan 10.7). Determinista: sin azar ni reloj.
// A partir de la salida anonimizada de un documento y de su tabla de correspondencia produce siete respuestas simuladas
// (V0 a V6) y, junto a cada una, la clasificación que debe devolver `findMarkers`, marcador por marcador y en orden.
// No usa `findMarkers`: reconoce los marcadores de la salida con su propia expresión (la 6.2.3) y arma las formas a mano.
// Solo datos ficticios: toda cadena sale de la salida del corpus o de los literales de abajo.
import { MARKER_LABEL } from '../../../src/core/types.ts';
import type { AlterationKind, MappingTable, MarkerMatchKind } from '../../../src/core/types.ts';

export type VarianteId = 'V0' | 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6';
export const VARIANTES: readonly VarianteId[] = ['V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];

/** Lo que `findMarkers` debe devolver para una coincidencia: el tramo tal como lo escribió la IA y su clase. */
export interface Esperado {
  found: string;
  kind: MarkerMatchKind;
  alterations: AlterationKind[];
  canonical?: string;
}
export interface Respuesta {
  variante: VarianteId;
  text: string;
  /** En orden de posición. */
  esperado: Esperado[];
  /** Marcadores de la tabla que la respuesta no trae (ni exactos ni alterados). */
  omitidos: string[];
}

const ETIQUETAS = Object.values(MARKER_LABEL).join('|');
const RE_MARCADOR = new RegExp(String.raw`\[(${ETIQUETAS})_([1-9][0-9]{0,3})\]`, 'gu');
const quitarTilde = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '');

/** Marcadores de la tabla que aparecen en la salida, en orden de primera aparición. */
function distintos(salida: string, table: MappingTable): string[] {
  const vistos: string[] = [];
  for (const m of salida.matchAll(RE_MARCADOR)) {
    if (Object.hasOwn(table.entries, m[0]) && !vistos.includes(m[0])) vistos.push(m[0]);
  }
  return vistos;
}
/** Apariciones exactas (en la tabla) de la salida, en orden. */
function exactos(salida: string, table: MappingTable): Esperado[] {
  const out: Esperado[] = [];
  for (const m of salida.matchAll(RE_MARCADOR)) {
    if (Object.hasOwn(table.entries, m[0])) out.push({ found: m[0], kind: 'exacto', alterations: [], canonical: m[0] });
  }
  return out;
}
const partes = (marcador: string): { etiqueta: string; n: string } => {
  const m = /^\[(.+)_([0-9]+)\]$/u.exec(marcador);
  return { etiqueta: m?.[1] ?? '', n: m?.[2] ?? '1' };
};
/** Una forma alterada de `marcador` por cada clase de alteración que se pueda construir con él. */
function alteraciones(marcador: string, conTilde: string | undefined): Esperado[] {
  const { etiqueta, n } = partes(marcador);
  const forma = (found: string, alterations: AlterationKind[], canonical: string = marcador): Esperado =>
    ({ found, kind: 'alterado', alterations, canonical });
  const out: Esperado[] = [
    forma(`(${etiqueta}_${n})`, ['delimitador']),
    forma(`${etiqueta}_${n}`, ['sin_delimitador']),
    forma(`[${etiqueta} ${n}]`, ['separador']),
    forma(`[${etiqueta.toLowerCase()}_${n}]`, ['mayusculas_minusculas']),
    forma(`[ ${etiqueta}_${n} ]`, ['espacios']),
    forma(`${marcador}'s`, ['sufijo_pegado']),
  ];
  if (conTilde !== undefined) {
    const t = partes(conTilde);
    out.push(forma(`[${quitarTilde(t.etiqueta)}_${t.n}]`, ['sin_tilde'], conTilde));
  }
  return out;
}

/**
 * Respuesta simulada `variante` para la `salida` de un documento cuya tabla es `table`.
 * V0 identidad · V1 resumen con el 60 % de los marcadores en otro orden · V2 una alteración de cada clase ·
 * V3 dos marcadores omitidos · V4 tres marcadores inventados · V5 escapes de Markdown · V6 marcadores pegados y con puntuación.
 */
export function transformar(salida: string, table: MappingTable, variante: VarianteId): Respuesta {
  const todos = distintos(salida, table);
  const base = exactos(salida, table);
  const res = (text: string, esperado: Esperado[], omitidos: string[] = []): Respuesta => ({ variante, text, esperado, omitidos });
  switch (variante) {
    case 'V0':
      return res(salida, base);
    case 'V1': {
      const k = Math.ceil(todos.length * 0.6);
      const elegidos = todos.slice(0, k).reverse();
      const esperado: Esperado[] = elegidos.map((m) => ({ found: m, kind: 'exacto', alterations: [], canonical: m }));
      return res(`Resumen: ${elegidos.join('; ')}.`, esperado, todos.slice(k));
    }
    case 'V2': {
      const primero = todos[0];
      if (primero === undefined) return res(salida, base);
      const tilde = todos.find((m) => quitarTilde(partes(m).etiqueta) !== partes(m).etiqueta);
      const alt = alteraciones(primero, tilde);
      return res(`${salida}\n\nAlteraciones: ${alt.map((a) => a.found).join('; ')}.`, [...base, ...alt]);
    }
    case 'V3': {
      const omitidos = todos.slice(0, 2);
      let text = salida;
      for (const m of omitidos) text = text.split(m).join('omitido');
      return res(text, base.filter((e) => !omitidos.includes(e.found)), omitidos);
    }
    case 'V4': {
      const n = (fam: string): number => { let k = 9; while (Object.hasOwn(table.entries, `[${fam}_${k}]`)) k += 90; return k; };
      const inventados: Esperado[] = [
        { found: `[DEMANDANTE_${n('DEMANDANTE')}]`, kind: 'desconocido', alterations: [], canonical: `[DEMANDANTE_${n('DEMANDANTE')}]` },
        { found: '[ABOGADO_1]', kind: 'desconocido', alterations: [] },
        { found: '[PLAINTIFF_1]', kind: 'desconocido', alterations: [] },
      ];
      const [a, b, c] = inventados as [Esperado, Esperado, Esperado];
      return res(`${salida}\n\nNotas: ${a.found}, ${b.found} y ${c.found}.`, [...base, ...inventados]);
    }
    case 'V5': {
      const tres = todos.slice(0, 3);
      const esperado: Esperado[] = [];
      const piezas: string[] = [];
      for (const m of tres) {
        const { etiqueta, n } = partes(m);
        const escapado = `\\[${etiqueta}\\_${n}\\]`;
        piezas.push(escapado, `**${m}**`);
        esperado.push({ found: escapado, kind: 'alterado', alterations: ['delimitador', 'separador'], canonical: m });
        esperado.push({ found: m, kind: 'exacto', alterations: [], canonical: m });
      }
      return res(`${salida}\n\nMarkdown: ${piezas.join(' ')}`, [...base, ...esperado]);
    }
    case 'V6': {
      const m = todos[0];
      if (m === undefined) return res(salida, base);
      const e = (found: string = m): Esperado => ({ found, kind: 'exacto', alterations: [], canonical: m });
      const esperado: Esperado[] = [e(), e(), e(), e(), { found: `${m}'s`, kind: 'alterado', alterations: ['sufijo_pegado'], canonical: m }];
      return res(`${salida}\n\nPegados: ${m}${m}. (${m}) ${m}, ${m}'s fin`, [...base, ...esperado]);
    }
  }
}
