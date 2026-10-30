// T-MO-01 · Catálogo de reglas: recorre los ejemplos positivos y negativos de la sección 7 (PA-1, desvío D-03).
//
// FORMATO de cada archivo `tests/fixtures/reglas-ejemplos/<archivo-de-regla>.json` (uno por archivo de `src/core/rules/`):
//
//   {
//     "modulo": "ids",                 // `src/core/rules/<modulo>.ts`, que exporta `rules: readonly RuleSpec[]`.
//                                      // «_juguete» = reglas de juguete definidas en esta prueba (solo `_ejemplo.json`).
//     "casos": [
//       {
//         "texto": "…",                // texto canónico de la parte (se escribe con \uXXXX lo invisible: ⍽ =  )
//         "parte": "cuerpo",           // opcional: PartKind de la parte; por defecto «cuerpo»
//         "refYear": 2026,             // opcional: año de referencia que recibe `assess`; por defecto 2026
//         "reglas": ["R-CC-01"],       // opcional: ejecuta solo esas reglas del módulo; por defecto, todas
//         "negativo": true,            // opcional: el caso NO debe producir ningún candidato (`esperado` vacío)
//         "esperado": [                // candidatos en orden de posición; cada campo es opcional salvo `type` y `texto`
//           { "type": "CC",            // DetectableType del candidato
//             "texto": "1.000.000.001",// `Part.text.slice(start, end)` (INV-R01): el tramo canónico exacto
//             "ruleId": "R-CC-01",     // opcional
//             "confidence": "alta",    // opcional
//             "canonicalKey": "CC:1000000001" }   // opcional
//         ]
//       }
//     ]
//   }
//
// Se compara el total de candidatos y, en orden de posición (empates: orden de la regla), los campos presentes.
// Regla del plan (10.0): cada `ruleId` (`^R-[A-Z_]+-\d{2}$`) debe terminar con al menos 4 positivos y 4 negativos
// ficticios; la cuenta la hace PA-7 al cerrar el catálogo, aquí solo se valida el formato de los ids.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSearchView } from '../../src/core/normalize.ts';
import { CUE_WINDOW, RULE_TIME_LIMIT_MS, runRules } from '../../src/core/rules/catalog.ts';
import type {
  Confidence, DataType, DetectionCandidate, DetectableType, PartId, PartKind, RuleSpec, RuleVerdict,
} from '../../src/core/types.ts';

const PART = 'prt_00000000000000000000000000000001' as PartId;
const FIXTURES = new URL('../fixtures/reglas-ejemplos/', import.meta.url);
const ID_RE = /^R-[A-Z_]+-\d{2}$/u;

// ---- reglas de juguete (las usa `_ejemplo.json`) ---------------------------------------------------------------
const BL = String.raw`(?<![\p{L}\p{N}_])`;
const BR = String.raw`(?![\p{L}\p{N}_])`;

const JUGUETE: readonly RuleSpec[] = [
  {
    id: 'R-JUGUETE-01',
    type: 'CC',
    flags: 'dgiu',
    source: String.raw`${BL}(?<l>c\.c\.)[ ]*(?<v>\d{1,3}(?:[.​]\d{3}){1,3})${BR}`,
    assess(m): RuleVerdict {
      const v = m.groups?.['v'] ?? '';
      return { confidence: 'alta', canonicalKey: `CC:${v.replace(/\D/gu, '')}`, labelId: 'CC' };
    },
  },
  {
    id: 'R-JUGUETE-02',
    type: 'CUENTA',
    flags: 'dgiu',
    source: String.raw`${BL}(?<v>\d{4})${BR}`,
    needsCue: /(?<![\p{L}])(?:tarjeta|cuenta)(?![\p{L}])/iu,
    assess(m): RuleVerdict {
      return { confidence: 'media', canonicalKey: `CUENTA:${m.groups?.['v'] ?? ''}` };
    },
  },
];

interface Esperado { type: DataType; texto: string; ruleId?: string; confidence?: Confidence; canonicalKey?: string }
interface Caso {
  texto: string; parte?: PartKind; refYear?: number; reglas?: string[]; negativo?: boolean; esperado: Esperado[];
}
interface Archivo { modulo: string; casos: Caso[] }

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function validarArchivo(nombre: string, x: unknown): Archivo {
  if (!isRecord(x) || typeof x['modulo'] !== 'string' || !/^_?[a-z]+$/u.test(x['modulo']) || !Array.isArray(x['casos'])) {
    throw new Error(`${nombre}: formato inválido (modulo, casos)`);
  }
  for (const c of x['casos']) {
    if (!isRecord(c) || typeof c['texto'] !== 'string' || !Array.isArray(c['esperado'])) {
      throw new Error(`${nombre}: caso inválido (texto, esperado)`);
    }
    if (c['negativo'] === true && c['esperado'].length > 0) throw new Error(`${nombre}: un caso negativo no lleva esperado`);
    if (c['negativo'] !== true && c['esperado'].length === 0) throw new Error(`${nombre}: un caso positivo necesita esperado`);
  }
  return x as unknown as Archivo;
}

async function cargarReglas(modulo: string): Promise<readonly RuleSpec[]> {
  if (modulo === '_juguete') return JUGUETE;
  const mod: unknown = await import(/* @vite-ignore */ `../../src/core/rules/${modulo}.ts`);
  const rules = isRecord(mod) ? mod['rules'] : undefined;
  if (!Array.isArray(rules)) throw new Error(`src/core/rules/${modulo}.ts no exporta «rules»`);
  return rules as RuleSpec[];
}

function resumir(texto: string, cands: DetectionCandidate[]): Array<Record<string, unknown>> {
  return cands.map((c) => ({
    type: c.type, texto: texto.slice(c.start, c.end), ruleId: c.ruleId, confidence: c.confidence, canonicalKey: c.canonicalKey,
  }));
}

function correr(texto: string, kind: PartKind, reglas: readonly RuleSpec[], refYear: number): DetectionCandidate[] {
  const view = buildSearchView(texto, 'reglas', kind);
  const cands = runRules(view, PART, reglas, refYear);
  return cands
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.start - b.c.start || a.c.end - b.c.end || a.i - b.i)
    .map((x) => x.c);
}

const archivos = readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort();

describe('T-MO-01 · catálogo de reglas: carpeta tests/fixtures/reglas-ejemplos', () => {
  it('hay al menos el ejemplo de juguete', () => {
    expect(archivos).toContain('_ejemplo.json');
  });

  for (const archivo of archivos) {
    describe(archivo, () => {
      const data = validarArchivo(archivo, JSON.parse(readFileSync(new URL(archivo, FIXTURES), 'utf8')));
      if (data.modulo === '_juguete') {
        it('el módulo «_juguete» solo se admite en _ejemplo.json', () => {
          expect(archivo).toBe('_ejemplo.json');
        });
      }
      it(`el módulo «${data.modulo}» exporta reglas con ids ^R-[A-Z_]+-\\d{2}$ sin repetir`, async () => {
        const reglas = await cargarReglas(data.modulo);
        const ids = reglas.map((r) => r.id);
        for (const id of ids) expect(id).toMatch(ID_RE);
        expect(new Set(ids).size).toBe(ids.length);
        for (const r of reglas) {
          expect(r.flags === 'dgu' || r.flags === 'dgiu').toBe(true);
          expect(() => new RegExp(r.source, r.flags)).not.toThrow();
        }
      });
      data.casos.forEach((caso, n) => {
        const titulo = `${caso.negativo === true ? 'negativo' : 'positivo'} ${n + 1}: ${JSON.stringify(caso.texto).slice(0, 60)}`;
        it(titulo, async () => {
          const todas = await cargarReglas(data.modulo);
          const reglas = caso.reglas === undefined ? todas : todas.filter((r) => caso.reglas?.includes(r.id));
          if (caso.reglas !== undefined) expect(reglas.map((r) => r.id).sort()).toEqual([...caso.reglas].sort());
          const cands = correr(caso.texto, caso.parte ?? 'cuerpo', reglas, caso.refYear ?? 2026);
          const real = resumir(caso.texto, cands);
          expect(real).toHaveLength(caso.esperado.length);
          caso.esperado.forEach((e, i) => {
            const r = real[i] ?? {};
            expect(r['type']).toBe(e.type);
            expect(r['texto']).toBe(e.texto);
            if (e.ruleId !== undefined) expect(r['ruleId']).toBe(e.ruleId);
            if (e.confidence !== undefined) expect(r['confidence']).toBe(e.confidence);
            if (e.canonicalKey !== undefined) expect(r['canonicalKey']).toBe(e.canonicalKey);
          });
        });
      });
    });
  }
});

// ---- el ejecutor `runRules` (contrato 6.4.2 y 7.2.0) -------------------------------------------------------------

function regla(id: string, type: DetectableType, source: string, assess: RuleSpec['assess'], extra: Partial<RuleSpec> = {}): RuleSpec {
  return { id, type, flags: 'dgu', source, assess, ...extra };
}

describe('T-MO-01 · runRules ejecuta RuleSpec sobre la vista reglas', () => {
  it('devuelve posiciones canónicas del texto original (espacio duro, guion largo, invisibles, emoji)', () => {
    const texto = '😀 radicado 11001–31–03–​2026 fin';
    const view = buildSearchView(texto, 'reglas', 'cuerpo');
    const r = regla('R-PRUEBA-01', 'RADICADO', String.raw`(?<l>radicado) (?<v>11001-31-03-2026)`,
      () => ({ confidence: 'alta', canonicalKey: 'RAD:x', labelId: 'radicado' }));
    const [c, ...resto] = runRules(view, PART, [r], 2026);
    expect(resto).toEqual([]);
    expect(c).toBeDefined();
    if (c === undefined) return;
    expect(texto.slice(c.start, c.end)).toBe('11001–31–03–​2026');
    expect(c.label).toEqual({ labelId: 'radicado', start: 3, end: 11 });
    expect(texto.slice(c.label?.start, c.label?.end)).toBe('radicado');
    expect(c).toMatchObject({
      partId: PART, type: 'RADICADO', source: 'regla', ruleId: 'R-PRUEBA-01', confidence: 'alta', score: 0.9, canonicalKey: 'RAD:x',
    });
  });

  it('el grupo v es el tramo por defecto; sin v se usa la coincidencia entera', () => {
    const view = buildSearchView('xx 12345 yy', 'reglas', 'cuerpo');
    const v = regla('R-PRUEBA-02', 'CC', String.raw`xx (?<v>\d+)`, () => ({ confidence: 'media', canonicalKey: 'k' }));
    const sinV = regla('R-PRUEBA-03', 'CC', String.raw`xx \d+`, () => ({ confidence: 'baja', canonicalKey: 'k' }));
    const out = runRules(view, PART, [v, sinV], 2026);
    expect(out.map((c) => 'xx 12345 yy'.slice(c.start, c.end))).toEqual(['12345', 'xx 12345']);
    expect(out.map((c) => c.score)).toEqual([0.6, 0.3]);
  });

  it('assess puede dar un subtramo (nStart/nEnd), cambiar el tipo y devolver varios veredictos o ninguno', () => {
    const texto = 'rad 11001-31-03-2026-00123-00 y nada 99999';
    const view = buildSearchView(texto, 'reglas', 'cuerpo');
    const r = regla('R-PRUEBA-04', 'RADICADO', String.raw`(?<v>\d{5}-\d{2}-\d{2}-\d{4}-\d{5}-\d{2})|(?<w>99999)`, (m, ctx) => {
      if (m.groups?.['w'] !== undefined) return null;
      const i = m.index;
      expect(ctx.refYear).toBe(2031);
      expect(ctx.partId).toBe(PART);
      return [
        { nStart: i, nEnd: i + 5, confidence: 'alta', canonicalKey: 'a' },
        { nStart: i + 6, nEnd: i + 8, type: 'RADICADO_ADMIN', confidence: 'baja', canonicalKey: 'b' },
      ];
    });
    const out = runRules(view, PART, [r], 2031);
    expect(out.map((c) => [texto.slice(c.start, c.end), c.type, c.canonicalKey])).toEqual([
      ['11001', 'RADICADO', 'a'], ['31', 'RADICADO_ADMIN', 'b'],
    ]);
  });

  it('needsCue: la pista debe estar en los 60 caracteres previos de la misma línea', () => {
    const cue = /(?<![\p{L}])tarjeta(?![\p{L}])/iu;
    const r = regla('R-PRUEBA-05', 'TARJETA', String.raw`(?<v>\d{4})`, () => ({ confidence: 'media', canonicalKey: 'k' }), { needsCue: cue });
    const hallado = (t: string): string[] => runRules(buildSearchView(t, 'reglas', 'cuerpo'), PART, [r], 2026).map((c) => t.slice(c.start, c.end));
    expect(hallado('Tarjeta 1234')).toEqual(['1234']);
    expect(hallado('la tarjeta nueva es 1234')).toEqual(['1234']);
    expect(hallado('1234')).toEqual([]);
    expect(hallado('tarjeta\n1234')).toEqual([]);                                  // otra línea
    expect(hallado(`tarjeta${'.'.repeat(CUE_WINDOW - 6)}1234`)).toEqual([]);          // fuera de los 60 caracteres
    expect(hallado(`tarjeta${'.'.repeat(CUE_WINDOW - 7)}1234`)).toEqual(['1234']);   // justo dentro
    expect(hallado('tarjeta 1234 y 5678')).toEqual(['1234', '5678']);
    expect(hallado('tarjeta 1234 y 5678')).toEqual(['1234', '5678']);              // la expresión no queda con estado entre llamadas
  });

  it('una coincidencia vacía no cuelga el ciclo y se descarta un subtramo inválido', () => {
    const view = buildSearchView('a😀b', 'reglas', 'cuerpo');
    const vacia = regla('R-PRUEBA-06', 'CC', String.raw`(?<v>)`, () => ({ confidence: 'baja', canonicalKey: 'k' }));
    const malo = regla('R-PRUEBA-07', 'CC', String.raw`(?<v>b)`, () => ({ nStart: 5, nEnd: 9, confidence: 'baja', canonicalKey: 'k' }));
    expect(runRules(view, PART, [vacia, malo], 2026)).toEqual([]);
  });

  it('tope de tiempo por regla: corta, conserva lo hallado y avisa solo con el id', () => {
    const texto = '1 2 3 4 5 6';
    const view = buildSearchView(texto, 'reglas', 'cuerpo');
    const r = regla('R-PRUEBA-08', 'CC', String.raw`(?<v>\d)`, () => ({ confidence: 'baja', canonicalKey: 'k' }));
    let t = 0;
    const avisos: string[] = [];
    const out = runRules(view, PART, [r], 2026, {
      maxMsPerRule: 100, now: () => { t += 40; return t; }, onTimeout: (id) => avisos.push(id),
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(6);
    expect(avisos).toEqual(['R-PRUEBA-08']);
    const todo = runRules(view, PART, [r], 2026);
    expect(todo).toHaveLength(6);
    expect(RULE_TIME_LIMIT_MS).toBe(250);
  });

  it('copia context y role del veredicto al candidato (7.2.0) y no los inventa si faltan', () => {
    const view = buildSearchView('nació 12 y 34', 'reglas', 'cuerpo');
    const r = regla('R-PRUEBA-10', 'FECHA', String.raw`(?<v>\d\d)`, (m) => (m[0] === '12'
      ? { confidence: 'alta', canonicalKey: 'k1', context: 'nacimiento', role: 'PACIENTE' }
      : { confidence: 'alta', canonicalKey: 'k2' }));
    const [a, b] = runRules(view, PART, [r], 2026);
    expect(a).toMatchObject({ context: 'nacimiento', role: 'PACIENTE' });
    expect(b).toBeDefined();
    expect(b !== undefined && 'context' in b).toBe(false);
    expect(b !== undefined && 'role' in b).toBe(false);
  });

  it('los candidatos nunca cortan un par sustituto', () => {
    const texto = 'Ana 😀 1234 🇨🇴 5678';
    const view = buildSearchView(texto, 'reglas', 'cuerpo');
    const r = regla('R-PRUEBA-09', 'CC', String.raw`(?<v>\p{Extended_Pictographic}|\d{4})`, () => ({ confidence: 'baja', canonicalKey: 'k' }));
    for (const c of runRules(view, PART, [r], 2026)) {
      const t = texto.slice(c.start, c.end);
      expect(t === [...t].join('')).toBe(true);
      expect(/[\uD800-\uDBFF]$/u.test(t)).toBe(false);
    }
  });
});
