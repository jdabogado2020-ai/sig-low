// T-CS-06 (unidad) · B-40: la política «default» de Trusted Types (3.6) solo admite rutas del build SIN query ni fragmento.
// `navigator.serviceWorker.register('/sw.js?d=<dato>')` llevaba datos al alojamiento en la query: la CSP compara rutas y la
// política antigua miraba solo `pathname`. public/tt-policy.js se ejecuta tal cual en un contexto aislado (`node:vm`) con un
// `trustedTypes` falso que captura las reglas; la copia de la política de `ner.worker.ts` (que no se puede importar sin arrancar el
// worker) se comprueba por su texto. Solo datos ficticios.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const RAIZ = process.cwd();
const ORIGEN = 'http://127.0.0.1:4173';

type Reglas = { createScriptURL(s: string): string };

function cargarPolitica(): Reglas {
  let reglas: Reglas | null = null;
  const sandbox: Record<string, unknown> = {
    URL,
    TypeError,
    location: new URL(`${ORIGEN}/`),
  };
  sandbox['self'] = { trustedTypes: { createPolicy: (_nombre: string, r: Reglas) => { reglas = r; return {}; } } };
  createContext(sandbox);
  runInContext(readFileSync(join(RAIZ, 'public', 'tt-policy.js'), 'utf8'), sandbox);
  if (reglas === null) throw new Error('tt-policy.js no creó la política');
  return reglas;
}

const resultado = (reglas: Reglas, url: string): string => {
  try { return reglas.createScriptURL(url); } catch (e) { return `lanza ${(e as Error).message}`; }
};

describe('T-CS-06 B-40 · tt-policy.js: createScriptURL exige ruta del build, sin query ni fragmento', () => {
  const reglas = cargarPolitica();

  it.each([
    ['/sw.js', `${ORIGEN}/sw.js`],
    ['/assets/detect.worker-AbC123.js', `${ORIGEN}/assets/detect.worker-AbC123.js`],
    ['/ort/ort-wasm-simd-threaded.mjs', `${ORIGEN}/ort/ort-wasm-simd-threaded.mjs`],
    [`${ORIGEN}/sw.js`, `${ORIGEN}/sw.js`],
  ])('admite %s', (entrada, esperado) => {
    expect(resultado(reglas, entrada)).toBe(esperado);
  });

  it.each([
    '/sw.js?d=r6-modulo', '/sw.js?d=', '/assets/detect.worker-AbC123.js?d=x', '/ort/ort-wasm-simd-threaded.mjs?d=x',
    '/sw.js#d', '/assets/x.js#d', `${ORIGEN}/sw.js?d=x`, '/assets/x.js?a=1&b=2',
  ])('B-40 rechaza %s (query o fragmento)', (entrada) => {
    expect(resultado(reglas, entrada)).toBe('lanza URL_NO_PERMITIDA');
  });

  it.each([
    '/otra.js', '/cdn-cgi/x.js', '/models/x/manifest.json', 'http://ejemplo.test/sw.js', 'http://ejemplo.test/assets/x.js', 'blob:http://127.0.0.1:4173/abc',
    'data:text/javascript,1', '//ejemplo.test/sw.js', 'https://127.0.0.1:4173/sw.js',
  ])('sigue rechazando %s (otra ruta, otro origen o protocolo)', (entrada) => {
    expect(resultado(reglas, entrada)).toBe('lanza URL_NO_PERMITIDA');
  });
});

describe('T-CS-06 B-40 · la copia de la política en ner.worker.ts lleva la misma condición', () => {
  it('createScriptURL de ner.worker.ts exige search === \'\' y hash === \'\' además de las rutas /assets/ y /ort/', () => {
    const fuente = readFileSync(join(RAIZ, 'src', 'workers', 'ner.worker.ts'), 'utf8');
    const cuerpo = /createScriptURL\(s: string\): string \{([\s\S]*?)\n    \},/.exec(fuente)?.[1] ?? '';
    expect(cuerpo).toContain('/^\\/(assets|ort)\\//.test(u.pathname)');
    expect(cuerpo).toContain("u.search === ''");
    expect(cuerpo).toContain("u.hash === ''");
    expect(cuerpo).toContain("throw new TypeError('URL_NO_PERMITIDA')");
  });
});
