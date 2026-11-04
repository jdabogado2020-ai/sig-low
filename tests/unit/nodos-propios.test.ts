// F9 (v1.1.2) · M-160 y B-170: lo propio se reconoce por identidad. Un documento simulado (vitest corre sin DOM).
import { describe, expect, it } from 'vitest';
import { documentoParaPdfjs, esPropio, fijarRaiz, registrarPropio } from '../../src/nodos-propios.ts';

function documentoFalso() {
  const cuerpo = { hijos: [] as object[], append(n: object) { this.hijos.push(n); } };
  return {
    body: cuerpo,
    title: 'Sig-Low',
    createElement: (tag: string) => ({ tag }),
    createElementNS: (ns: string, tag: string) => ({ ns, tag }),
    createTextNode: (t: string) => ({ t }),
    getElementsByTagName(this: { body: unknown }, _t: string) { return [this.body]; },
  };
}

describe('F9 nodos propios por identidad (M-160, B-170)', () => {
  it('la raíz y lo registrado son propios; un nodo igual pero distinto, no', () => {
    const raiz = { id: 'app' };
    fijarRaiz(raiz as unknown as Element);
    expect(esPropio(raiz)).toBe(true);
    // Una extensión que copia el id o el atributo de la app no se vuelve propia.
    expect(esPropio({ id: 'app' })).toBe(false);
    expect(esPropio({ 'data-siglow': '' })).toBe(false);
    const p = registrarPropio({ clase: 'solo-impresion' });
    expect(esPropio(p)).toBe(true);
  });

  it('documentoParaPdfjs registra lo que crean createElement y createElementNS, y deja pasar lo demás del documento real', () => {
    const real = documentoFalso();
    const envoltorio = documentoParaPdfjs(real as unknown as Document);
    expect(documentoParaPdfjs(real as unknown as Document)).toBe(envoltorio);   // uno por documento
    const div = (envoltorio as unknown as ReturnType<typeof documentoFalso>).createElement('div');
    const svg = (envoltorio as unknown as ReturnType<typeof documentoFalso>).createElementNS('http://www.w3.org/2000/svg', 'svg');
    expect(esPropio(div)).toBe(true);
    expect(esPropio(svg)).toBe(true);
    // Lo que no crea pdf.js por su documento no es propio, aunque llegue en el mismo momento.
    const ajeno = real.createElement('div');
    expect(esPropio(ajeno)).toBe(false);
    // Las demás propiedades y métodos son los del documento real (con su `this`).
    const e = envoltorio as unknown as ReturnType<typeof documentoFalso>;
    expect(e.body).toBe(real.body);
    expect(e.title).toBe('Sig-Low');
    expect(e.getElementsByTagName('body')[0]).toBe(real.body);
    expect(esPropio(e.createTextNode('x'))).toBe(false);
  });
});
