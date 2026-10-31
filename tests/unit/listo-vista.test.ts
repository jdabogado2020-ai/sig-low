// T-IU-10 (parte de unidad) · modelo de la vista previa de la salida de Listo: el texto único que se copia y su partición en líneas,
// trozos y bloques con posiciones globales. La copia sale de este modelo, nunca del DOM (8.7): una selección se traduce a posiciones del
// texto único y se copia esa subcadena. INV-X05 (la copia exige la puerta abierta) se prueba en E2E; aquí, que el modelo no pierde ni
// inventa texto y que una ficha cuenta como su marcador completo. Datos ficticios.
import { describe, expect, it } from 'vitest';
import { joinOutput } from '../../src/core/render';
import type { DetectionId, OutputSection, PartId, RenderedOutput } from '../../src/core/types';
import { construirVista, MARCADOR, subcadena } from '../../src/ui/listo/vista-salida';

const PRT = (n: number): PartId => `prt_${n.toString(16).padStart(32, '0')}` as PartId;
const DET = (n: number): DetectionId => `det_${n.toString(16).padStart(32, '0')}` as DetectionId;

/** Una sección cuyo texto es `trozos` unidos; los trozos `[marcador]` son reemplazos. Los segmentos cubren el texto sin huecos (INV-X01). */
function seccion(n: number, label: string, trozos: Array<string | { reemplazo: string; det: number }>): OutputSection {
  let text = '';
  const segments: OutputSection['segments'] = [];
  for (const t of trozos) {
    const s = typeof t === 'string' ? t : t.reemplazo;
    segments.push({ outStart: text.length, outEnd: text.length + s.length, partStart: 0, partEnd: 0, ...(typeof t === 'string' ? {} : { detectionId: DET(t.det) }) });
    text += s;
  }
  return { partId: PRT(n), kind: 'cuerpo', label, text, segments };
}
const salida = (secciones: OutputSection[]): RenderedOutput =>
  ({ docId: 'doc_1' as RenderedOutput['docId'], revision: 4, sections: secciones, withHeadings: secciones.length > 1 });

describe('T-IU-10 vista previa de la salida · modelo de texto y posiciones', () => {
  it('el texto del modelo es exactamente joinOutput(out, "\\n") y las líneas lo reconstruyen sin perder ni inventar nada', () => {
    const out = salida([
      seccion(1, 'Cuerpo del documento', ['Señora ', { reemplazo: '[DEMANDANTE_1]', det: 1 }, ', cédula ', { reemplazo: '[CC_1]', det: 2 }, '.\n\nSegunda línea.\n']),
      seccion(2, 'Pie de página 1', ['Pie con ', { reemplazo: 'el demandado', det: 3 }, ' editado.']),
    ]);
    const v = construirVista(out);
    expect(v.texto).toBe(joinOutput(out, '\n'));
    const reconstruido = v.lineas.map((l) => {
      let s = '';
      let pos = l.g0;
      for (const z of l.trozos) { expect(z.g).toBe(pos); s += z.texto; pos += z.texto.length; }
      return s;
    }).join('\n');
    expect(reconstruido).toBe(v.texto);
    // Cada línea empieza donde termina la anterior más un salto.
    v.lineas.forEach((l, i) => { if (i > 0) expect(l.g0).toBe((v.lineas[i - 1]!.g0) + v.lineas[i - 1]!.trozos.reduce((a, z) => a + z.texto.length, 0) + 1); });
  });

  it('solo los reemplazos llevan marca; un marcador exacto se distingue de un texto editado o generalizado', () => {
    const out = salida([seccion(1, 'Cuerpo del documento', ['A ', { reemplazo: '[CC_1]', det: 1 }, ' B ', { reemplazo: 'un municipio de [DEPARTAMENTO_1]', det: 2 }, ' C ', { reemplazo: 'la actora', det: 3 }])]);
    const v = construirVista(out);
    const trozos = v.lineas.flatMap((l) => l.trozos);
    expect(trozos.filter((z) => z.reemplazo === undefined).map((z) => z.texto)).toEqual(['A ', ' B ', ' C ']);
    expect(trozos.filter((z) => z.reemplazo?.marcador === true).map((z) => z.texto)).toEqual(['[CC_1]']);
    expect(trozos.filter((z) => z.reemplazo !== undefined && !z.reemplazo.marcador).map((z) => z.texto)).toEqual(['un municipio de [DEPARTAMENTO_1]', 'la actora']);
    expect(trozos.find((z) => z.texto === '[CC_1]')?.reemplazo?.det).toBe(DET(1));
    expect(MARCADOR.test('[DEMANDANTE_12]')).toBe(true);
    expect(MARCADOR.test('[CC_1] y más')).toBe(false);
    expect(MARCADOR.test('Ana Ficticia')).toBe(false);
  });

  it('la sección única no lleva encabezado y varias secciones llevan «=== rótulo ===» y una línea vacía entre ellas', () => {
    const una = construirVista(salida([seccion(1, 'Cuerpo del documento', ['Hola'])]));
    expect(una.texto).toBe('Hola');
    const dos = construirVista(salida([seccion(1, 'Cuerpo del documento', ['Uno']), seccion(2, 'Pie de página 1', ['Dos'])]));
    expect(dos.texto).toBe('=== Cuerpo del documento ===\nUno\n\n=== Pie de página 1 ===\nDos');
    expect(dos.lineas.map((l) => l.trozos.map((z) => z.texto).join(''))).toEqual(['=== Cuerpo del documento ===', 'Uno', '', '=== Pie de página 1 ===', 'Dos']);
  });

  it('8.8 la vista se parte en bloques de 50 líneas con posiciones contiguas; un documento de 1.000 líneas da 20 bloques', () => {
    const lineas = Array.from({ length: 1000 }, (_, i) => `Línea ${i} con [CC_1] y texto.`);
    const trozos: Array<string | { reemplazo: string; det: number }> = [];
    lineas.forEach((l, i) => { const [a, b] = l.split('[CC_1]') as [string, string]; trozos.push(a, { reemplazo: '[CC_1]', det: 1 }, b + (i < lineas.length - 1 ? '\n' : '')); });
    const v = construirVista(salida([seccion(1, 'Cuerpo del documento', trozos)]));
    expect(v.lineas).toHaveLength(1000);
    expect(v.bloques).toHaveLength(20);
    v.bloques.forEach((b, i) => {
      expect(b.indice).toBe(i);
      expect(b.l1 - b.l0).toBe(50);
      expect(b.g0).toBe(v.lineas[b.l0]!.g0);
      if (i > 0) expect(b.g0).toBeGreaterThan(v.bloques[i - 1]!.g1);
    });
    expect(v.bloques[19]!.g1).toBe(v.texto.length);
  });

  it('subcadena: copia el rango pedido, ordena los extremos y no sale del texto', () => {
    const t = 'Señora [DEMANDANTE_1], cédula [CC_1].';
    expect(subcadena(t, 0, 7)).toBe('Señora ');
    expect(subcadena(t, 7, 21)).toBe('[DEMANDANTE_1]');
    expect(subcadena(t, 21, 7)).toBe('[DEMANDANTE_1]');
    expect(subcadena(t, -5, 3)).toBe('Señ');
    expect(subcadena(t, 30, 999)).toBe('[CC_1].');
    expect(subcadena(t, 4, 4)).toBe('');
  });

  it('un texto vacío o con solo saltos no rompe el modelo', () => {
    const v = construirVista(salida([seccion(1, 'Cuerpo del documento', ['\n\n'])]));
    expect(v.texto).toBe('\n\n');
    expect(v.lineas).toHaveLength(3);
    expect(v.bloques).toHaveLength(1);
    const vacio = construirVista(salida([]));
    expect(vacio.texto).toBe('');
    expect(vacio.lineas).toHaveLength(1);
  });
});
