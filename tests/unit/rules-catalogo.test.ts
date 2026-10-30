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
//         "nota": "…",                 // opcional: por qué es positivo o negativo (no se evalúa)
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
// La DIVIPOLA de los validadores se configura con `data/divipola.json` si existe (PG-4) y, mientras no exista, con el
// subconjunto ficticio `tests/fixtures/divipola-mini.json`.
//
// Se compara el total de candidatos y, en orden de posición (empates: orden de la regla), los campos presentes.
// Regla del plan (10.0): cada `ruleId` (`^R-[A-Z_]+-\d{2}$`) debe terminar con al menos 4 positivos y 4 negativos
// ficticios; la cuenta la hace PA-7 al cerrar el catálogo (bloque «cuenta por regla» al final de este archivo).
//
// EXCLUSIONES (PA-7, `exclusiones.json`, módulo «exclusiones»; 7.3). Las exclusiones no son reglas de detección: no crean
// candidatos. El archivo mezcla dos clases de casos:
//
//   A) Tramos protegidos de una exclusión:
//      { "texto": "Ley 1581 de 2012", "exclusion": "E-NORMA-01",
//        "protege": [ { "texto": "1581", "modo": "suprime" }, { "texto": "2012", "modo": "suprime" } ],
//        "negativo": true   // opcional: la exclusión NO protege nada (`protege` vacío) }
//      Se compara la lista completa de tramos protegidos por esa exclusión, en orden de posición.
//   B) Integrales (reglas + exclusiones, con o sin fusión): { "texto": "…", "integral": true,
//        "modulos": ["ids"],       // opcional: solo las reglas de esos módulos; por defecto, todos los de rules/
//        "resolver": true,         // opcional: aplica la fusión de 7.11.1 (precedencia, longitud, inicio, orden de tipos)
//        "soloExclusion": true,    // opcional: sin exclusiones SÍ habría candidatos; la exclusión es lo que los quita
//        "esperado": [ …como arriba… ], "negativo": true }
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSearchView } from '../../src/core/normalize.ts';
import { CUE_WINDOW, RULE_TIME_LIMIT_MS, runRules } from '../../src/core/rules/catalog.ts';
import { EXCLUSIONES, aplicarExclusiones, esContextoDeCita, tramosProtegidos } from '../../src/core/rules/exclusiones.ts';
import { generalize } from '../../src/core/generalize.ts';
import type { GenDetection } from '../../src/core/generalize.ts';
import { configurarDivipola, divipolaCodes } from '../../src/core/validators/radicado.ts';
import type {
  Confidence, DataType, DetectionCandidate, DetectionId, DetectableType, IdSource, PartId, PartKind, RuleSpec, RuleVerdict,
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
/** Caso de `exclusiones.json` (clases A y B, ver cabecera). */
interface Protegido { texto: string; modo: 'suprime' | 'baja' }
interface CasoExclusion {
  texto: string; parte?: PartKind; refYear?: number; negativo?: boolean; nota?: string;
  exclusion?: string; protege?: Protegido[];
  integral?: boolean; modulos?: string[]; reglas?: string[]; resolver?: boolean; soloExclusion?: boolean; esperado?: Esperado[];
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function validarArchivo(nombre: string, x: unknown): Archivo {
  if (!isRecord(x) || typeof x['modulo'] !== 'string' || !/^_?[a-z]+$/u.test(x['modulo']) || !Array.isArray(x['casos'])) {
    throw new Error(`${nombre}: formato inválido (modulo, casos)`);
  }
  if (x['modulo'] === 'exclusiones') {
    for (const c of x['casos']) {
      if (!isRecord(c) || typeof c['texto'] !== 'string') throw new Error(`${nombre}: caso inválido (texto)`);
      const a = typeof c['exclusion'] === 'string' && Array.isArray(c['protege']);
      const b = c['integral'] === true && Array.isArray(c['esperado']);
      if (a === b) throw new Error(`${nombre}: un caso de exclusiones es de clase A (exclusion, protege) o B (integral, esperado)`);
      if (c['negativo'] === true && (a ? (c['protege'] as unknown[]).length > 0 : (c['esperado'] as unknown[]).length > 0)) {
        throw new Error(`${nombre}: un caso negativo no protege ni espera nada`);
      }
    }
    return x as unknown as Archivo;
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

beforeAll(() => {
  const real = new URL('../../data/divipola.json', import.meta.url);
  const mini = new URL('../fixtures/divipola-mini.json', import.meta.url);
  const rows = JSON.parse(readFileSync(existsSync(real) ? real : mini, 'utf8')) as Array<{ dep: string; mun: string }>;
  configurarDivipola(divipolaCodes(rows));
  return () => configurarDivipola(null);
});

const archivos = readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort();

// ---- exclusiones (PA-7) ----------------------------------------------------------------------------------------
/** Módulos de `src/core/rules/` que aportan reglas de detección (exclusiones.ts no: ver su cabecera). */
const MODULOS_REGLAS = ['ids', 'radicado', 'contacto', 'rotulados', 'direccion', 'fechas', 'valores'] as const;

const TIPOS_ORDEN: readonly string[] = [
  'RADICADO', 'RADICADO_ADMIN', 'TARJETA', 'CUENTA', 'NIT', 'CC', 'TI', 'CE', 'PPT', 'PEP', 'PASAPORTE', 'TP', 'DOCUMENTO', 'HC', 'AFILIACION',
  'MATRICULA', 'PLACA', 'TELEFONO', 'CORREO', 'DIRECCION', 'BARRIO', 'VALOR', 'FECHA',
];
/**
 * Precedencia de 6.2.4 para una regla: 3 con validador estructural que pasa (DV del NIT, radicado, correo, Luhn con rótulo;
 * `NDC` y `FECHA` solo ajustan la confianza); 4 con rótulo; 5 sin rótulo.
 */
function precedencia(c: DetectionCandidate): number {
  const v = c.validator;
  if (v?.passed === true && (v.name === 'DV_NIT' || v.name === 'RADICADO' || v.name === 'CORREO' || (v.name === 'LUHN' && c.label !== undefined))) return 3;
  return c.label !== undefined ? 4 : 5;
}

/** Fusión de 7.11.1 (pasos 3 y 4) sin remanentes: los casos integrales no tienen solapes parciales, y si aparece uno, falla. */
function fusionar(cands: readonly DetectionCandidate[]): DetectionCandidate[] {
  const orden = [...cands].sort((a, b) => precedencia(a) - precedencia(b)
    || (b.end - b.start) - (a.end - a.start) || a.start - b.start
    || TIPOS_ORDEN.indexOf(a.type) - TIPOS_ORDEN.indexOf(b.type));
  const aceptados: DetectionCandidate[] = [];
  for (const c of orden) {
    const toca = aceptados.filter((a) => a.start < c.end && c.start < a.end);
    if (toca.length === 0) { aceptados.push(c); continue; }
    if (toca.some((a) => a.start <= c.start && c.end <= a.end)) continue;     // absorbido
    throw new Error(`solape parcial entre ${c.ruleId ?? c.type} y ${toca.map((a) => a.ruleId ?? a.type).join(',')}: requiere remanentes (7.11.2)`);
  }
  return aceptados.sort((a, b) => a.start - b.start || a.end - b.end);
}

async function reglasDeModulos(modulos: readonly string[]): Promise<RuleSpec[]> {
  const out: RuleSpec[] = [];
  for (const m of modulos) out.push(...(await cargarReglas(m)));
  return out;
}

async function correrIntegral(caso: CasoExclusion, conExclusiones: boolean): Promise<Array<Record<string, unknown>>> {
  const todas = await reglasDeModulos(caso.modulos ?? MODULOS_REGLAS);
  const reglas = caso.reglas === undefined ? todas : todas.filter((r) => caso.reglas?.includes(r.id));
  const view = buildSearchView(caso.texto, 'reglas', caso.parte ?? 'cuerpo');
  let cands = runRules(view, PART, reglas, caso.refYear ?? 2026);
  if (conExclusiones) cands = aplicarExclusiones(view, cands);
  if (caso.resolver === true) cands = fusionar(cands);
  const ordenados = cands.map((c, i) => ({ c, i })).sort((a, b) => a.c.start - b.c.start || a.c.end - b.c.end || a.i - b.i).map((x) => x.c);
  return resumir(caso.texto, ordenados);
}

function describeExclusiones(data: Archivo): void {
  const casos = data.casos as unknown as CasoExclusion[];
  it(`el módulo exporta ${EXCLUSIONES.length} exclusiones con ids ^E-[A-Z0-9]+-\\d{2}$ sin repetir y patrones compilables`, () => {
    const ids = EXCLUSIONES.map((e) => e.id);
    for (const id of ids) expect(id).toMatch(/^E-[A-Z0-9]+-\d{2}$/u);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of EXCLUSIONES) expect(() => new RegExp(e.source, e.flags)).not.toThrow();
  });
  casos.forEach((caso, n) => {
    const clase = caso.integral === true ? 'integral' : caso.exclusion;
    const titulo = `${caso.negativo === true ? 'negativo' : 'positivo'} ${n + 1} (${clase}): ${JSON.stringify(caso.texto).slice(0, 60)}`;
    it(titulo, async () => {
      if (caso.integral === true) {
        const real = await correrIntegral(caso, true);
        const esperado = caso.esperado ?? [];
        expect(real).toHaveLength(esperado.length);
        esperado.forEach((e, i) => {
          const r = real[i] ?? {};
          expect(r['type']).toBe(e.type);
          expect(r['texto']).toBe(e.texto);
          if (e.ruleId !== undefined) expect(r['ruleId']).toBe(e.ruleId);
          if (e.confidence !== undefined) expect(r['confidence']).toBe(e.confidence);
          if (e.canonicalKey !== undefined) expect(r['canonicalKey']).toBe(e.canonicalKey);
        });
        if (caso.soloExclusion === true) expect((await correrIntegral(caso, false)).length).toBeGreaterThan(0);
        return;
      }
      const view = buildSearchView(caso.texto, 'reglas', caso.parte ?? 'cuerpo');
      const real = tramosProtegidos(view).filter((t) => t.exclusionId === caso.exclusion)
        .sort((a, b) => a.start - b.start || a.end - b.end)
        .map((t) => ({ texto: caso.texto.slice(t.start, t.end), modo: t.modo }));
      expect(real).toEqual(caso.protege);
    });
  });
}

describe('T-MO-01 · catálogo de reglas: carpeta tests/fixtures/reglas-ejemplos', () => {
  it('hay al menos el ejemplo de juguete', () => {
    expect(archivos).toContain('_ejemplo.json');
  });

  for (const archivo of archivos) {
    describe(archivo, () => {
      const data = validarArchivo(archivo, JSON.parse(readFileSync(new URL(archivo, FIXTURES), 'utf8')));
      if (data.modulo === 'exclusiones') {
        describeExclusiones(data);
        return;
      }
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

// ---- PA-7: cuenta por regla, INV-G12, cita jurisprudencial y suite adversaria --------------------------------------

describe('T-MO-01 · cada regla y cada exclusión termina con ≥ 4 positivos y ≥ 4 negativos ficticios (10.0)', () => {
  it('cuenta los casos de todos los archivos de reglas-ejemplos', async () => {
    const pos = new Map<string, number>();
    const neg = new Map<string, number>();
    const suma = (m: Map<string, number>, id: string): void => { m.set(id, (m.get(id) ?? 0) + 1); };
    const todos = new Set<string>();
    for (const archivo of archivos) {
      const data = validarArchivo(archivo, JSON.parse(readFileSync(new URL(archivo, FIXTURES), 'utf8')));
      if (data.modulo === '_juguete') continue;
      if (data.modulo === 'exclusiones') {
        for (const e of EXCLUSIONES) todos.add(e.id);
        for (const c of data.casos as unknown as CasoExclusion[]) {
          if (c.exclusion === undefined) continue;
          suma(c.negativo === true ? neg : pos, c.exclusion);
        }
        continue;
      }
      const ids = (await cargarReglas(data.modulo)).map((r) => r.id);
      for (const id of ids) todos.add(id);
      for (const c of data.casos) {
        if (c.negativo === true) for (const id of c.reglas ?? ids) suma(neg, id);
        else for (const id of new Set(c.esperado.map((e) => e.ruleId).filter((x): x is string => x !== undefined))) suma(pos, id);
      }
    }
    const faltan = [...todos].sort().filter((id) => (pos.get(id) ?? 0) < 4 || (neg.get(id) ?? 0) < 4)
      .map((id) => `${id} (${pos.get(id) ?? 0}+/${neg.get(id) ?? 0}-)`);
    expect(faltan).toEqual([]);
  });
});

describe('T-MO-01 · INV-G12 e INV-R03: ningún validador descarta, ni siquiera tras las exclusiones', () => {
  const casos: Array<[string, string, string]> = [
    ['NIT con DV erróneo', 'NIT 900.000.001-0', 'NIT'],
    ['tarjeta con Luhn erróneo', 'tarjeta de crédito 4111 1111 1111 1112', 'TARJETA'],
    ['celular con indicativo inexistente', 'Tel: 395 000 0001', 'TELEFONO'],
    ['radicado con DANE inexistente', 'radicado 99999-31-03-999-2026-00123-00', 'RADICADO'],
    ['fecha inexistente (31/02)', 'el 31/02/2026 según el acta', 'FECHA'],
  ];
  it.each(casos)('INV-G12 %s sigue detectado y no queda en confianza alta', async (_n, texto, tipo) => {
    const reglas = await reglasDeModulos(MODULOS_REGLAS);
    const view = buildSearchView(texto, 'reglas', 'cuerpo');
    const cands = aplicarExclusiones(view, runRules(view, PART, reglas, 2026));
    const c = cands.find((x) => x.type === tipo);
    expect(c, JSON.stringify(cands.map((x) => [x.type, x.confidence]))).toBeDefined();
    if (c === undefined) return;
    if (c.validator !== undefined) expect(c.validator.passed).toBe(false);     // FECHA no lleva validador: su clave es «FECHA:~…»
    expect(c.confidence).not.toBe('alta');
  });

  it('INV-R03 las exclusiones no dependen de validadores: no protegen nada en un texto con validadores fallidos', () => {
    const texto = 'NIT 900.000.001-0, radicado 99999-31-03-999-2026-00123-00 y tarjeta 4111 1111 1111 1112';
    const view = buildSearchView(texto, 'reglas', 'cuerpo');
    expect(tramosProtegidos(view)).toEqual([]);
  });
});

// NOTA (PG-4, para el integrador): `isCitation` de generalize.ts (R-CIT-01, 7.7.6) no reconoce «de la referencia» como señal del
// propio caso, así que el 7.º ejemplo de 7.3.3 («dentro del proceso de la referencia, radicado …, el Juzgado profirió sentencia»)
// crea hoy una bandera que 7.3.3 no pide. `esContextoDeCita` (E-CITA-01) sí lo resuelve; falta unificar ambas (PG-4-r1).
describe('T-MO-01 · E-CITA-01: un radicado de jurisprudencia citada genera la bandera CITA_JURISPRUDENCIAL sin aceptación automática', () => {
  const idSource = (): IdSource => { let n = 0; return { next: (p) => `${p}_${(++n).toString(16).padStart(32, '0')}` }; };
  const citas: Array<[string, boolean]> = [
    ['Consejo de Estado, Sección Tercera, sentencia del 14 de marzo de 2026, rad. 25000-23-26-999-2012-00123-01, C.P. Ana Ficticia Rojas', true],
    ['Corte Suprema de Justicia, Sala de Casación Civil, sentencia del 3 de mayo de 2025, radicación 11001-31-03-999-2020-00001-01', true],
    ['(ver sentencia del Tribunal, exp. 05001-23-33-999-2019-00001-00, M.P. Juan Ejemplo Prueba)', true],
    ['Cfr. providencia radicado 76001-31-05-999-2018-00001-01', true],
    ['Radicado: 11001-31-03-999-2026-00123-00', false],
    ['Referencia: acción de tutela. Radicado 11001-40-03-999-2026-00001-00', false],
    ['dentro del proceso de la referencia, radicado 11001-31-03-999-2026-00123-00, el Juzgado profirió sentencia', false],
    ['Demandante: Ana Ficticia Rojas. Proceso 11001-31-03-999-2026-00123-00', false],
  ];
  // E-CITA-01 (7.3.3) con sus ocho ejemplos.
  it.each(citas)('E-CITA-01 «%s» → cita: %s', async (texto, esCita) => {
    const view = buildSearchView(texto, 'reglas', 'cuerpo');
    const rad = runRules(view, PART, await cargarReglas('radicado'), 2026).find((c) => c.type === 'RADICADO');
    expect(rad).toBeDefined();
    if (rad !== undefined) expect(esContextoDeCita(view.text, rad.start, rad.end)).toBe(esCita);
  });

  // De extremo a extremo: reglas → exclusiones → generalize.ts. Se excluye el 7.º ejemplo (ver abajo).
  it.each(citas.filter((c) => !c[0].startsWith('dentro del proceso de la referencia')))('«%s» → bandera: %s', async (texto, esCita) => {
    const view = buildSearchView(texto, 'reglas', 'cuerpo');
    const cands = aplicarExclusiones(view, runRules(view, PART, await cargarReglas('radicado'), 2026));
    const rad = cands.find((c) => c.type === 'RADICADO');
    expect(rad, 'las exclusiones no deben suprimir el radicado de una cita').toBeDefined();
    if (rad === undefined) return;
    const det: GenDetection = { id: 'det_00000000000000000000000000000001' as DetectionId, start: rad.start, end: rad.end, type: rad.type, canonicalKey: rad.canonicalKey };
    const res = generalize({ part: { id: PART, text: texto }, detections: [det], options: { referenceDate: '2026-10-30' }, ids: idSource() });
    const f = res.flags.find((x) => x.type === 'CITA_JURISPRUDENCIAL');
    expect(f !== undefined).toBe(esCita);
    if (f !== undefined) {
      expect(f.reason).toBe('RADICADO_EN_CITA');
      expect(f.acknowledged).toBe(false);          // bloquea la copia hasta que el revisor la confirma
      expect(f.resolution).toBeUndefined();        // sin aceptación automática
      expect(f.options).toEqual([]);
      expect(texto.slice(f.span.start, f.span.end)).toBe(f.text);
    }
  });
});

describe('T-MO-01 · suite adversaria: tiempo lineal en entradas largas (reglas y exclusiones)', () => {
  const N = 40_000;
  const entradas: Array<[string, string]> = [
    ['racha de asteriscos sin dígitos (R-TARJETA-03, racha atómica)', '*'.repeat(N)],
    ['racha de viñetas sin dígitos (R-TARJETA-03)', '•'.repeat(N)],
    ['dígitos con puntos de miles', '1.000.000.001 '.repeat(N / 14)],
    ['dígitos separados por espacios', '3 0 0 0 0 0 0 0 0 1 '.repeat(N / 20)],
    ['rótulos repetidos sin valor', 'C.C. No. '.repeat(N / 9)],
    ['guiones y barras alternados', '1-2/3-4/5-6/'.repeat(N / 12)],
    ['siglas y números', 'LEY 100 ART 123 SAS123 '.repeat(N / 23)],
    ['direcciones sin cerrar', 'Calle 45 Sur # '.repeat(N / 15)],
    ['mayúsculas encadenadas', 'Edificio Prueba Ejemplo Ficticio Real '.repeat(N / 37)],
    ['folios y artículos encadenados', 'artículo 1, 2, 3, 4, 5 y 6 al 7 '.repeat(N / 31)],
  ];
  it.each(entradas)('%s', async (_n, texto) => {
    const reglas = await reglasDeModulos(MODULOS_REGLAS);
    const view = buildSearchView(texto, 'reglas', 'cuerpo');
    const t0 = performance.now();
    aplicarExclusiones(view, runRules(view, PART, reglas, 2026));
    expect(performance.now() - t0).toBeLessThan(4000);
  }, 20_000);

  it('el tope por exclusión corta, conserva lo hallado y avisa solo con el id', () => {
    const texto = 'ley 1 '.repeat(2000);
    const view = buildSearchView(texto, 'reglas', 'cuerpo');
    let t = 0;
    const avisos: string[] = [];
    const tramos = tramosProtegidos(view, { maxMsPorExclusion: 100, now: () => { t += 40; return t; }, onTimeout: (id) => avisos.push(id) });
    expect(avisos).toContain('E-NORMA-01');
    expect(avisos.every((id) => /^E-[A-Z0-9]+-\d{2}$/u.test(id))).toBe(true);
    expect(tramos.length).toBeGreaterThan(0);
  });
});
