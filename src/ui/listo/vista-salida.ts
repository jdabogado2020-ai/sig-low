// Modelo de la vista previa de la salida de Listo (8.2.7, 8.7): el texto único `joinOutput(out, '\n')` partido en líneas y trozos
// con su posición global, para pintar el texto por bloques (virtualización, 8.8) y para atender la copia DESDE EL MODELO, no desde
// el DOM: una selección se traduce a posiciones del texto único y lo copiado es la subcadena (una ficha cuenta como su marcador
// completo). Código puro, sin DOM: lo prueban las unidades. El texto de este modelo es la salida ya anonimizada: nunca el original.
import { joinOutput } from '../../core/render.ts';
import type { DetectionId, RenderedOutput } from '../../core/types.ts';

/** Marcador exacto `[FAMILIA_n]`: solo este tramo lleva el nombre accesible «Marcador …» (8.6.4). */
export const MARCADOR = /^\[[A-ZÁÉÍÓÚÑ_]+_\d+\]$/u;

export interface Trozo {
  /** Posición del primer carácter en el texto único. */
  g: number;
  texto: string;
  /** Presente si el tramo es un reemplazo (marcador, plantilla o texto editado). */
  reemplazo?: { det?: DetectionId; marcador: boolean };
}
export interface Linea { g0: number; trozos: Trozo[] }
export interface BloqueVista { indice: number; l0: number; l1: number; g0: number; g1: number }
export interface VistaSalida {
  /** `joinOutput(out, '\n')`: lo que se copia. */
  texto: string;
  lineas: Linea[];
  bloques: BloqueVista[];
}

export const LINEAS_POR_BLOQUE_SALIDA = 50;

/** Parte el texto único en líneas y trozos (con posiciones globales) y las agrupa en bloques de 50 líneas. */
export function construirVista(out: RenderedOutput, porBloque = LINEAS_POR_BLOQUE_SALIDA): VistaSalida {
  const texto = joinOutput(out, '\n');
  const lineas: Linea[] = [];
  let g = 0;
  let actual: Linea = { g0: 0, trozos: [] };
  const cerrar = (): void => { lineas.push(actual); g += 1; actual = { g0: g, trozos: [] }; };
  const emitir = (cadena: string, reemplazo?: Trozo['reemplazo']): void => {
    const partes = cadena.split('\n');
    partes.forEach((p, i) => {
      if (i > 0) cerrar();
      if (p !== '') {
        const t: Trozo = { g, texto: p };
        if (reemplazo !== undefined) t.reemplazo = reemplazo;
        actual.trozos.push(t);
        g += p.length;
      }
    });
  };
  out.sections.forEach((sec, i) => {
    if (i > 0) { emitir('\n\n'); }
    if (out.withHeadings) emitir(`=== ${sec.label} ===\n`);
    for (const s of sec.segments) {
      const tramo = sec.text.slice(s.outStart, s.outEnd);
      if (s.detectionId === undefined && s.spanEditId === undefined) emitir(tramo);
      else emitir(tramo, { ...(s.detectionId !== undefined ? { det: s.detectionId } : {}), marcador: MARCADOR.test(tramo) });
    }
  });
  lineas.push(actual);
  const bloques: BloqueVista[] = [];
  for (let l = 0; l < lineas.length; l += porBloque) {
    const l1 = Math.min(lineas.length, l + porBloque);
    const ultima = lineas[l1 - 1] as Linea;
    const fin = ultima.trozos.length === 0 ? ultima.g0 : (ultima.trozos[ultima.trozos.length - 1] as Trozo).g + (ultima.trozos[ultima.trozos.length - 1] as Trozo).texto.length;
    bloques.push({ indice: bloques.length, l0: l, l1, g0: (lineas[l] as Linea).g0, g1: fin });
  }
  return { texto, lineas, bloques };
}

/** Subcadena del texto único para un rango de posiciones, normalizado (a ≤ b, dentro del texto). */
export function subcadena(texto: string, a: number, b: number): string {
  const desde = Math.max(0, Math.min(a, b));
  const hasta = Math.min(texto.length, Math.max(a, b));
  return desde >= hasta ? '' : texto.slice(desde, hasta);
}
