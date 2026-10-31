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
import {
  EXCLUSIONES, aplicarExclusiones, contextoDelExpediente, contextosDelModelo, esContextoDeCita, esPrecedenteCitado, exclusionDelModelo,
  finDeNormaAlInicio, tramosProtegidos,
} from '../../src/core/rules/exclusiones.ts';
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

  // De extremo a extremo: reglas → exclusiones → generalize.ts, con los ocho ejemplos de 7.3.3 (PG-4-r1: `isCitation` es `esContextoDeCita`).
  it.each(citas)('«%s» → bandera: %s', async (texto, esCita) => {
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

describe('T-MO-01 · PB-2-r6 (D-06): los contextos de exclusión enteros para los tramos PER y ORG del modelo', () => {
  it('contextosDelModelo da la coincidencia entera de las exclusiones de alcance «todos», con su modo, y la norma de una cita de artículo', () => {
    const t = 'Según la Ley 1122 de 2007, la Sentencia T-074 de 2020, el artículo 49 de la Constitución Política y 10 SMMLV; el artículo 3 '
      + 'del contrato con Ferretería Ejemplo.';
    const cx = contextosDelModelo(buildSearchView(t, 'reglas', 'cuerpo'));
    const de = (id: string): string[] => cx.filter((c) => c.exclusionId === id)
      .map((c) => `${t.slice(c.start, c.end)}${c.inicio === true ? ':inicio' : ''}:${c.modo}`);
    expect(de('E-NORMA-01')).toEqual(['Ley 1122 de 2007:suprime']);
    expect(de('E-SENT-01')).toEqual(['Sentencia T-074 de 2020:suprime']);
    // M-40 (PB-2-r7): el objeto es el nombre de la norma; antes iba hasta el final del renglón
    // («Constitución Política y 10 SMMLV; el artículo 3 del contrato con Ferretería Ejemplo.»).
    expect(de('E-ART-01')).toEqual(['artículo 49:suprime', 'Constitución Política:inicio:suprime', 'artículo 3:suprime']);
    expect(de('E-CANT-01')).toEqual(['10 SMMLV:baja']);
    const en = (x: string): ReturnType<typeof exclusionDelModelo> => exclusionDelModelo(cx, t.indexOf(x), t.indexOf(x) + x.length);
    expect(en('Constitución Política')).toBe('suprime');
    expect(en('Ley 1122')).toBe('suprime');
    expect(en('10 SMMLV')).toBe('baja');
    // El objeto de la cita vale solo para el tramo que empieza en él; «del contrato» no es una norma de la lista cerrada.
    expect(en('Ferretería Ejemplo')).toBeNull();
    expect(en('Política')).toBeNull();
  });
});

describe('T-MO-01 · M-40 (PB-2-r7): el objeto de la cita de artículo es el nombre de la norma (7.3.7: 4 positivos y 4 negativos)', () => {
  /** El objeto (contexto `inicio`) que deja `contextosDelModelo` tras cada «artículo N de la/del». */
  const objetos = (t: string): string[] => contextosDelModelo(buildSearchView(t, 'reglas', 'cuerpo'))
    .filter((c) => c.inicio === true).map((c) => t.slice(c.start, c.end));
  it.each([
    ['el artículo 49 de la Constitución Política de 1991 consagra', 'Constitución Política de 1991'],
    ['el artículo 1546 del Código Civil, que regula', 'Código Civil'],
    ['el artículo 90 del Código General del Proceso señala', 'Código General del Proceso'],
    ['el artículo 64 del Código Sustantivo del Trabajo Comercial Ejemplo S.A. dispone', 'Código Sustantivo del Trabajo'],
  ])('positivo: «%s» → objeto «%s»', (t, objeto) => {
    expect(objetos(t)).toEqual([objeto]);
    // El tramo del modelo igual al objeto se descarta; el que sigue más allá no (devuelve el fin de la norma para 7.11.2).
    const cx = contextosDelModelo(buildSearchView(t, 'reglas', 'cuerpo'));
    const s = t.indexOf(objeto);
    expect(exclusionDelModelo(cx, s, s + objeto.length)).toBe('suprime');
    expect(finDeNormaAlInicio(cx, s, s + objeto.length)).toBeNull();
    expect(finDeNormaAlInicio(cx, s, t.length - 1)).toBe(s + objeto.length);
  });
  it.each([
    ['el artículo 3 del contrato con Ferretería Ejemplo dispone', 'sin cabeza de la lista cerrada'],
    ['el artículo 12 del Código de Ética de Clínica Ejemplo S.A.S. dispone', 'Clínica Ejemplo S.A.S.'],
    ['el artículo 5 del Estatuto de Ejemplo EPS dispone', 'Ejemplo EPS'],
    ['el artículo 2 del Pacto Ejemplo S.A.S. dispone', 'Ejemplo S.A.S.'],
  ])('negativo: en «%s» el nombre (%s) no queda dentro de ningún contexto', (t, nombre) => {
    const cx = contextosDelModelo(buildSearchView(t, 'reglas', 'cuerpo'));
    const s = t.indexOf(nombre);
    if (s >= 0) {
      expect(exclusionDelModelo(cx, s, s + nombre.length)).toBeNull();
      // Con el código anterior el objeto iba hasta el final del renglón y contenía al nombre.
      expect(cx.some((c) => c.start <= s && s + nombre.length <= c.end)).toBe(false);
    } else expect(objetos(t)).toEqual([]);
  });
});

describe('T-MO-01 · A-1 (PB-2-r7 y PB-2-r8, D-11): R-RAD_ADMIN-03 solo descarta el expediente citado con otra providencia en la oración y sin señal del propio caso', () => {
  const ctx = (t: string, sub = 'T-9.000.001'): ReturnType<typeof contextoDelExpediente> => {
    const v = buildSearchView(t, 'reglas', 'cuerpo');
    const s = v.text.indexOf(sub);
    return contextoDelExpediente(v.text, s, s + sub.length, v);
  };
  it('D-11 (PB-2-r8): precedente solo con otra providencia de número y año en la misma oración, antes o después', () => {
    for (const t of [
      'Como precedente invoco la Sentencia T-074 de 2020 y, en particular, el expediente T-9.000.001, donde se amparó un caso análogo.',
      'Así lo dijo la Corte en la sentencia T-074 de 2020, expediente T-9.000.001.',
      'El mismo criterio se aplicó en el expediente T-9.000.001, que dio lugar a la T-456 de 2020.',
      'Ver la Sentencia SU-508/20 (expediente T-9.000.001), sobre la integralidad.',
      'Así lo sostuvo la Sala de Casación Civil en la STC1234-2019, expediente T-9.000.001.',
      'Cfr. Corte Constitucional, Sentencia T-760 de 2008, M.P. Ana Ficticia Rojas, expediente T-9.000.001.',
      'Como precedente invoco la Sentencia T-074 de 2020 y, en particular, el expediente\nT-9.000.001, donde se amparó un caso análogo.',
      'COMO PRECEDENTE INVOCO LA SENTENCIA T-074 DE 2020 Y, EN PARTICULAR, EL EXPEDIENTE\nT-9.000.001, DONDE SE AMPARÓ UN CASO ANÁLOGO.',
    ]) expect(ctx(t), t).toBe('precedente');
  });
  it('D-11 (PB-2-r8): «precedente», «cfr.», «véase», «caso análogo» o «citado» sin otra providencia de número y año no bastan: se toma (en -r7, precedente)', () => {
    for (const [t, esperado] of [
      ['Cfr. expediente T-9.000.001.', 'cita'],
      ['Véase también el expediente T-9.000.001.', 'cita'],
      ['El contratista guardará reserva, incluido el expediente T-9.000.001 citado como ejemplo.', 'cita'],
      ['Se examinó el citado expediente T-9.000.001.', 'cita'],
      ['En la sentencia T-1, expediente T-9.000.001, se habló de otro tema.', 'cita'],
      ['En el expediente T-9.000.001 se resolvió un caso análogo.', null],
    ] as const) expect(ctx(t), t).toBe(esperado);
  });
  it('«Corte», «Tribunal», «Sala», «Sección» o «sentencia» solos no bastan: se toma, con contexto de cita; B-70: sin él si hay señal del propio caso', () => {
    for (const t of [
      'Honorables Magistrados de la Corte Constitucional: en el expediente T-9.000.001 se discute la cobertura.',
      'La Sección Segunda revisó la sentencia del expediente T-9.000.001.',
    ]) expect(ctx(t), t).toBe('cita');
    // B-70 (PB-2-r8): el rótulo del renglón o un trámite del propio caso anulan el contexto de cita (en -r7, 'cita').
    for (const t of [
      'Señores\nCORTE CONSTITUCIONAL\nReferencia: Expediente T-9.000.001',
      'Señores\nCORTE CONSTITUCIONAL\nReferencia:\nT-9.000.001',
      'El Tribunal Superior de Ejemplo remitió a la Corte el expediente T-9.000.001.',
      'La Sala de Selección escogió el expediente T-9.000.001.',
    ]) expect(ctx(t), t).toBeNull();
    expect(ctx('Expediente: T-9.000.001')).toBeNull();
  });
  it('A-1 (PB-2-r8): la oración se corta en el salto de línea sin signo, en un título, tras «S.A.» o una inicial ante mayúscula y ante una minúscula tras un punto que no es de abreviatura', () => {
    for (const t of [
      'Como precedente invoco la Sentencia T-074 de 2020, con ponencia del Dr. Ejemplo\nLa accionante actuó en el expediente T-9.000.001.',
      'IV. PRECEDENTE: SENTENCIA T-074 DE 2020\nla accionante actuó en el expediente T-9.000.001.',
      'Como precedente invoco la Sentencia T-074 de 2020 contra Comercial Ejemplo S.A. La accionante actuó en el expediente T-9.000.001.',
      'Como precedente invoco la Sentencia T-074 de 2020, M.P. Ana Ejemplo R. La accionante actuó en el expediente T-9.000.001.',
      'Como precedente invoco la Sentencia T-074 de 2020. el expediente T-9.000.001 es otro.',
      'Como precedente invoco la Sentencia T-074 de 2020; la accionante actuó en el expediente T-9.000.001.',
      'La accionante actuó en el expediente T-9.000.001. Como precedente invoco la Sentencia T-074 de 2020.',
    ]) expect(ctx(t), t).not.toBe('precedente');
    // No cortan: «S.A.» ante minúscula, «M.P.», «No.» ni el PDF que parte la oración tras una palabra o una coma.
    for (const t of [
      'Como precedente invoco la Sentencia T-074 de 2020 contra Comercial Ejemplo S.A. y, en particular, el expediente T-9.000.001.',
      'Como precedente invoco la Sentencia T-074 de 2020, M.P. Ana Ficticia Rojas, y el expediente T-9.000.001.',
      'Como precedente invoco la Sentencia No. 74 de 2020 y el expediente T-9.000.001.',
      'Como precedente invoco la Sentencia T-074 de 2020 y, en particular,\nel expediente T-9.000.001, donde se amparó un caso análogo.',
    ]) expect(ctx(t), t).toBe('precedente');
  });
  it('A-1 y M-50 (PB-2-r8): una señal del propio caso en la oración o un rótulo en el renglón anterior anulan la providencia', () => {
    for (const t of [
      'En la sentencia T-123 de 2026, expediente T-9.000.001, la Corte me amparó el derecho a la salud.',
      'Tal como se ordenó en la sentencia T-123 de 2026 (expediente T-9.000.001), la EPS debe autorizar el procedimiento.',
      'La Sala Novena desconoció el precedente de la Sentencia SU-123 de 2020 al decidir el expediente T-9.000.001.',
      'Solicito abrir incidente de desacato por el incumplimiento de la sentencia T-123 de 2026, expediente T-9.000.001.',
      'Esta tutela no es temeraria: la sentencia T-123 de 2025 negó la anterior, expediente T-9.000.001.',
      'Cfr. Sentencia T-123 de 2026, folio 12 del expediente T-9.000.001.',
      'La accionante invoca la sentencia T-123 de 2026 dictada en su propia tutela, expediente T-9.000.001.',
      'Referencia:\nSentencia T-123 de 2026, expediente T-9.000.001',
      'Ref.: Sentencia T-123 de 2026\nExpediente T-9.000.001',
    ]) expect(ctx(t), t).toBeNull();
  });
  it('la señal de precedente está en otra oración, o hay un trámite o un rótulo del propio caso: se toma', () => {
    for (const t of [
      'Como precedente invoco la Sentencia T-074 de 2020. Solicito a la Corte revisar el expediente T-9.000.001.',
      'Por desconocimiento del precedente, solicito a la Corte Constitucional seleccionar para revisión el expediente T-9.000.001.',
      'Conforme a la norma citada, otorgo poder especial para actuar en el expediente T-9.000.001.',
      'Referencia: Expediente T-9.000.001, citado en el auto de la Sala.',
      'Como precedente, la Corte decretó pruebas en el expediente T-9.000.001 de la referencia.',
    ]) expect(ctx(t), t).not.toBe('precedente');
  });
  it('B-62 sin el índice de la vista da lo mismo (la consulta de generalize.ts y de las pruebas); `cita` implica el contexto de cita de E-CITA-01', () => {
    for (const t of [
      'Como precedente invoco la Sentencia T-074 de 2020 y, en particular, el expediente T-9.000.001, donde se amparó un caso análogo.',
      'Señores\nCORTE CONSTITUCIONAL\nReferencia: Expediente T-9.000.001',
      'Honorables Magistrados de la Corte Constitucional: en el expediente T-9.000.001 se discute la cobertura.',
      'Expediente: T-9.000.001',
      'Conforme a la norma citada, otorgo poder especial para actuar en el expediente T-9.000.001.',
      'En la sentencia T-123 de 2026, expediente T-9.000.001, la Corte me amparó el derecho a la salud.',
      'Como precedente invoco la Sentencia T-074 de 2020, M.P. Ana Ejemplo R. La accionante actuó en el expediente T-9.000.001.',
    ]) {
      const v = buildSearchView(t, 'reglas', 'cuerpo');
      const s = v.text.indexOf('T-9.000.001');
      expect(contextoDelExpediente(v.text, s, s + 11)).toBe(ctx(t));
      expect(esPrecedenteCitado(v.text, s, s + 11)).toBe(ctx(t) === 'precedente');
      // B-70 (PB-2-r8): una señal del propio caso anula el contexto de cita del expediente, no el de E-CITA-01 (el de generalize.ts).
      if (ctx(t) === 'cita') expect(esContextoDeCita(v.text, s, s + 11)).toBe(true);
    }
  });
  it('B-62 con índice da lo mismo que sin él en textos aleatorios con saltos, títulos, abreviaturas, providencias y señales del propio caso', () => {
    const trozos = ['Como precedente invoco la Sentencia T-074 de 2020', ' y, en particular,', ' el expediente T-9.000.001', '.', ' ', '\n', '\n\n',
      'IV. PRECEDENTE APLICABLE', ' S.A.', ' R.', ' M.P. Ana', ' Dr. Ejemplo', ';', ' la Corte', ' me amparó', ' desacato', ' folio 12', 'Referencia:',
      'Ref.:', ' que dio lugar a la T-456 de 2020', ' SU-508/20', ' de la referencia', ' Expediente: T-9.000.002', ' la accionante', ' citado'];
    let semilla = 7;
    const azar = (n: number): number => { semilla = (semilla * 48271) % 2147483647; return semilla % n; };
    let comparados = 0;
    for (let k = 0; k < 400; k++) {
      let t = '';
      for (let j = 0; j < 14; j++) t += trozos[azar(trozos.length)] as string;
      const v = buildSearchView(t, 'reglas', 'cuerpo');
      for (const m of v.text.matchAll(/T-9\.000\.00[12]/gu)) {
        expect(contextoDelExpediente(v.text, m.index, m.index + 11, v), t).toBe(contextoDelExpediente(v.text, m.index, m.index + 11));
        comparados++;
      }
    }
    expect(comparados).toBeGreaterThan(300);
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
    ['PA-4-r1: avenidas con número de la vía sin placa', 'Av. Ficticia 0C # '.repeat(N / 18)],
    ['PA-4-r1: separador, salto de línea y nada más', 'Cra 5 #\n'.repeat(N / 8)],
    ['PA-4-r1: barrios partidos por un salto de línea', 'barrio La\n'.repeat(N / 10)],
    ['mayúsculas encadenadas', 'Edificio Prueba Ejemplo Ficticio Real '.repeat(N / 37)],
    ['folios y artículos encadenados', 'artículo 1, 2, 3, 4, 5 y 6 al 7 '.repeat(N / 31)],
    // PA-6-r1: `{NUMPH}` ya no recorre toda una racha de numerales desde cada uno (tope de 16) ni cruza más de un salto seguido.
    ['numerales encadenados en una línea (R-FEC-06, R-VAL-04, R-VAL-05)', 'mil '.repeat(N / 4)],
    ['numerales encadenados con un salto entre cada uno', 'mil\n'.repeat(N / 4)],
    ['fechas y valores partidos por saltos', 'catorce (14) de marzo\nde dos mil veintiséis (2026) y cuarenta millones\nde pesos ($40.000.000)\n'.repeat(N / 96)],
  ];
  it.each(entradas)('%s', async (_n, texto) => {
    const reglas = await reglasDeModulos(MODULOS_REGLAS);
    const view = buildSearchView(texto, 'reglas', 'cuerpo');
    // Robusta a la carga de una máquina compartida (dos `verify` en paralelo): se mide el mejor de 3 corridas y el tope es de 10 s.
    // Aislada, cada entrada tarda de 0,9 a 1,4 s; una expresión cuadrática en 40.000 caracteres tardaría minutos y seguiría fallando.
    let mejor = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      aplicarExclusiones(view, runRules(view, PART, reglas, 2026));
      mejor = Math.min(mejor, performance.now() - t0);
    }
    expect(mejor).toBeLessThan(10_000);
  }, 90_000);

  // M-14 (PB-2-r5): los lookbehinds de largo variable de src/core/rules llevan tope. Un lookbehind se evalúa en cada posición, y
  // con `[ \t]*` o `[ ]+` sin tope su retroceso crecía con la racha de blancos: con 20.000 caracteres, de 0,7 a 3,8 s; con
  // 200.000, minutos. La vista `reglas` colapsa los espacios, no los tabuladores; el caso de «nuip» se mide sobre el texto crudo.
  // 200.000 caracteres hostiles, mejor de 3, por debajo de 200 ms (aislado tardan menos de 10 ms).
  const M = 200_000;
  const lookbehinds: Array<[string, string, readonly string[], 'vista' | 'cruda', string[]]> = [
    ['NOHC (R-CC-01, R-CE-01, R-DOC-01): tabuladores antes del rótulo', '\t'.repeat(M) + 'cc 1000000001', ['R-CC-01', 'R-CE-01', 'R-DOC-01'], 'vista', ['CC:1000000001']],
    ['L.CC_D (R-CC-01): «registro civil», espacios y «nuip»', 'registro civil' + ' '.repeat(M) + 'nuip 1000000001', ['R-CC-01'], 'cruda', ['nuip 1000000001']],
    ['R-VAL-02: «$» y tabuladores antes de la cifra', '$' + '\t'.repeat(M) + '1.000 pesos', ['R-VAL-02'], 'vista', ['VALOR:1000']],
    ['R-VAL-03: «$» y tabuladores antes de los millones', '$' + '\t'.repeat(M) + '2 millones', ['R-VAL-03'], 'vista', ['VALOR:2000000']],
  ];
  it.each(lookbehinds)('M-14 lookbehind acotado, %s: 200.000 caracteres por debajo de 200 ms', async (_n, texto, ids, modo, esperado) => {
    const reglas = (await reglasDeModulos(MODULOS_REGLAS)).filter((r) => ids.includes(r.id));
    expect(reglas.map((r) => r.id).sort()).toEqual([...ids].sort());
    const view = buildSearchView(texto, 'reglas', 'cuerpo');
    const correr = (): string[] => (modo === 'vista'
      ? runRules(view, PART, reglas, 2026).map((c) => c.canonicalKey)
      : reglas.flatMap((r) => [...texto.matchAll(new RegExp(r.source, r.flags))].map((m) => m[0].trim())));
    let mejor = Infinity;
    let hallado: string[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      hallado = correr();
      mejor = Math.min(mejor, performance.now() - t0);
    }
    expect(hallado).toEqual(esperado);
    expect(mejor).toBeLessThan(200);
  }, 90_000);

  // GAP (PB-2-r5, pedido del integrador): dos cuantificadores de blancos separados por un opcional (`[ \t]*[:.]?[ \t]*`) son
  // ambiguos. Cuando lo que sigue no casa, el retroceso prueba cada reparto de la racha: es cuadrático en el largo de la racha
  // (en `detectar`, «registro civil», 40.000 tabuladores y «nuip …» tardaban 28,6 s). Cada caso pasa al lenguaje equivalente
  // no ambiguo (`[ \t]*(?:[:.][ \t]*)?`, `(?:[ \t]*,)?[ \t]+`…). 40.000 blancos entre el rótulo y el resto; la expresión sola,
  // el mejor de 3, por debajo de 50 ms. Los tabuladores llegan a la tubería (la vista `reglas` no los colapsa); los espacios,
  // solo fuera de ella.
  const K = 40_000;
  const TB = '\t'.repeat(K);
  const SP = ' '.repeat(K);
  const ambiguos: Array<[string, string, string]> = [
    ['R-CC-01', 'GAP (ids.ts): «cc», tabuladores y otra cosa', 'cc' + TB + 'x'],
    ['R-CC-01', 'GAP con NUMSIGN (ids.ts): «cc:», tabuladores, «No.» y tabuladores', 'cc:' + TB + 'No.' + TB + 'x'],
    // PA-ids-r1: el salto de línea tras el signo de número y la sigla del radicado administrativo, también lineales.
    ['R-CC-01', 'GAP tras NUMSIGN (ids.ts): «cc», «No.», tabuladores, un salto y tabuladores', 'cc No.' + TB + '\n' + TB + 'x'],
    ['R-CC-01', 'V.CC con apóstrofo de millones (ids.ts): «cc 1.000» y apóstrofos', 'cc 1.000' + "'".repeat(K) + 'x'],
    ['R-CUENTA-01', 'GAP tras NUMSIGN (rotulados.ts): «cuenta», «No.», tabuladores, un salto y tabuladores', 'cuenta No.' + TB + '\n' + TB + 'x'],
    ['R-RAD_ADMIN-01', 'sigla y GAP (radicado.ts): «radicado», espacios, una sigla y espacios', 'radicado' + SP + 'AB' + SP + 'x'],
    ['R-RAD_ADMIN-01', 'rótulo «consecutivo de salida» (radicado.ts): «consecutivo» y espacios', 'consecutivo' + SP + 'x'],
    ['R-TEL-03', 'GAP tras NUMSIGN (contacto.ts): «tel», «No.», tabuladores, un salto y tabuladores', 'tel No.' + TB + '\n' + TB + 'x'],
    // PROPUESTAS PA-ids-r1 (rama t/PA-ids-r1-propuestas): rótulo diferido, verbo copulativo, salto en el rótulo y en los grupos.
    ['R-CC-01', 'rótulo diferido (ids.ts): «cédula de» y palabras', 'cédula de ' + 'a '.repeat(K / 2) + 'x'],
    ['R-CC-01', 'rótulo diferido (ids.ts): «cédula» y espacios', 'cédula' + SP + 'como'],
    ['R-RAD-01', 'grupos separados por salto (radicado.ts): «1», espacios y saltos', '1' + ' \n'.repeat(K / 2) + 'x'],
    ['R-TEL-03', 'verbo copulativo (contacto.ts): «fijo de la» y espacios', 'fijo de la' + SP + 'x'],
    ['R-TEL-03', 'indicativo 60x con salto (contacto.ts): «tel 603» y espacios', 'tel 603' + SP + 'x'],
    ['R-HC-01', 'verbo copulativo (rotulados.ts): «historia clínica de la» y espacios', 'historia clínica de la' + SP + 'x'],
    ['R-CUENTA-01', 'rótulo con salto (rotulados.ts): «cuenta de ahorros» y saltos con espacios', 'cuenta de ahorros' + ' \n'.repeat(K / 2) + 'x'],
    ['R-AFIL-01', 'contrato (rotulados.ts): «contrato de servicio» y tabuladores', 'contrato de servicio' + TB + 'x'],
    ['R-AFIL-01', 'AJ-2 subsistema (rotulados.ts): «riesgos laborales con el número» y espacios', 'riesgos laborales con el número' + SP + 'x'],
    ['R-AFIL-01', 'AJ-2 subsistema (rotulados.ts): «salud con el» y espacios', 'salud con el' + SP + 'x'],
    ['R-AFIL-01', 'AJ-2 participio (rotulados.ts): «afiliado» y tabuladores', 'afiliado' + TB + 'x'],
    ['R-RAD_ADMIN-01', 'AJ-2 título valor (radicado.ts): «pagaré en blanco» y espacios', 'pagaré en blanco' + SP + 'x'],
    ['R-RAD_ADMIN-01', 'AJ-2 título valor (radicado.ts): «letra de cambio» y tabuladores', 'letra de cambio' + TB + 'x'],
    ['R-TEL-03', 'GAP (contacto.ts): «fax» y tabuladores', 'fax' + TB + 'x'],
    ['R-TEL-01', 'EXT (contacto.ts): un celular y espacios', '300 000 0001' + SP + 'x'],
    ['R-TEL-01', 'EXT (contacto.ts): un celular, «ext» y espacios', '300 000 0001 ext' + SP + 'x'],
    ['R-RAD-01', 'GAP (radicado.ts): «radicado» y tabuladores', 'radicado' + TB + 'x'],
    ['R-RAD_ADMIN-03', 'GAP_CS (radicado.ts): «EXPEDIENTE» y tabuladores', 'EXPEDIENTE' + TB + 'x'],
    ['R-PLACA-01', 'GAP (rotulados.ts): «placa» y tabuladores', 'placa' + TB + 'x'],
    ['R-HC-01', 'V_DOCPFX (rotulados.ts): «HC: cc» y espacios', 'HC: cc' + SP + 'x'],
    ['R-TARJETA-02', 'R-TARJETA-02 (rotulados.ts): «terminada» y espacios', 'terminada' + SP + 'x'],
    ['R-DIR-01', 'COMPS (direccion.ts): una dirección y tabuladores', 'Calle 00 # 00-00' + TB + 'x'],
    ['R-BAR-01', 'R-BAR-01 (direccion.ts): «barrio» y tabuladores', 'barrio' + TB + 'x'],
    ['R-DIR-02', 'PA-4-r1 número de la vía (direccion.ts): una avenida, un número y espacios', 'Av. Ficticia 0C' + SP + 'x'],
    ['R-DIR-02', 'PA-4-r1 nombre de avenida (direccion.ts): una avenida y espacios', 'Av. Ficticia' + SP + 'x'],
    ['R-DIR-01', 'PA-4-r1 HU (direccion.ts): una dirección, un salto de línea y espacios', 'Calle 00 # 00-00\n' + SP + 'x'],
    ['R-DIR-01', 'PA-4-r1 HU (direccion.ts): separador y 40.000 saltos de línea', 'Cl. 00B No.' + '\n'.repeat(K) + 'x'],
    ['R-DIR-01', 'PA-4-r1 HU (direccion.ts): separador y tabuladores con saltos de línea', 'Calle 00 #' + '\t\n'.repeat(K / 2) + 'x'],
    ['R-DIR-01', 'PA-4-r1 cuadrante (direccion.ts): una dirección, espacios, salto de línea y espacios', 'Calle 00 # 00-00' + SP + '\n' + SP + 'x'],
    ['R-BAR-01', 'PA-4-r1 JN (direccion.ts): «barrio La», un salto de línea y tabuladores', 'barrio La\n' + TB + 'x'],
    ['R-FEC-04', 'R-FEC-04 (fechas.ts): un día de la semana y tabuladores', 'lunes' + TB + 'x'],
    ['R-FEC-09', 'R-FEC-09 (fechas.ts): «14 de marzo» y tabuladores', '14 de marzo' + TB + 'x'],
    // PA-6-r1: el separador con un salto de línea (HN) es `H+(?:⏎H*)?|⏎H*`: cada rama empieza distinto y el salto es único.
    ['R-FEC-06', 'HN (fechas.ts): un numeral, tabuladores, un salto, tabuladores y otra cosa', 'diez' + TB + '\n' + TB + 'x'],
    ['R-FEC-06', 'HN0 (fechas.ts): «diez», tabuladores, un salto y «(»', 'diez' + TB + '\n' + TB + '(x'],
    ['R-FEC-04', 'HN (fechas.ts): un día, tabuladores, un salto, tabuladores y otra cosa', '14' + TB + '\n' + TB + 'x'],
    ['R-FEC-05', 'HN (fechas.ts): un mes, tabuladores, un salto, tabuladores y otra cosa', 'marzo' + TB + '\n' + TB + 'x'],
    ['R-FEC-09', 'HN (fechas.ts): «14 de», tabuladores, un salto, tabuladores y otra cosa', '14 de' + TB + '\n' + TB + 'x'],
    ['R-VAL-04', 'HN (valores.ts): letras, tabuladores, un salto, tabuladores y otra cosa', 'cuarenta y ocho millones' + TB + '\n' + TB + 'x'],
    ['R-VAL-04', 'HN0 (valores.ts): letras, tabuladores, un salto y «(»', 'cuarenta y ocho millones' + TB + '\n' + TB + '(x'],
    ['R-VAL-05', 'HN (valores.ts): «diez (10)», tabuladores, un salto, tabuladores y otra cosa', 'diez (10)' + TB + '\n' + TB + 'x'],
    ['R-VAL-03', 'HN (valores.ts): «48 millones», tabuladores, un salto, tabuladores y «de»', '48 millones' + TB + '\n' + TB + 'de ' + TB + 'x'],
    ['E-NORMA-01', 'E-NORMA-01 (exclusiones.ts): «decreto» y espacios', 'decreto' + SP + 'x'],
    ['E-CIE10-01', 'E-CIE10-01 (exclusiones.ts): «diagnóstico» y espacios', 'diagnóstico' + SP + 'x'],
    ['E-DESP-01', 'E-DESP-01 (exclusiones.ts): «código del despacho» y espacios', 'código del despacho' + SP + 'x'],
    ['EXC_FECHA_A', 'EXC-FECHA-A (fechas.ts): «sentencia T» y tabuladores', 'sentencia T' + TB + 'x'],
    ['EXC_FECHA_A', 'EXC-FECHA-A (fechas.ts): «Ley 100» y tabuladores', 'Ley 100' + TB + 'x'],
    ['EXC_FECHA_B', 'EXC-FECHA-B (fechas.ts): «sentencia» y tabuladores', 'sentencia' + TB + 'x'],
    ['C_NAC', 'C_NAC (fechas.ts): «nació» y tabuladores', 'nació' + TB + 'x'],
  ];
  it.each(ambiguos)('GAP %s sin cuantificadores de blancos ambiguos, %s: 40.000 blancos por debajo de 50 ms', async (id, _n, texto) => {
    const fechas = await import('../../src/core/rules/fechas.ts');
    const exportadas: Record<string, RegExp> = { EXC_FECHA_A: fechas.EXC_FECHA_A, EXC_FECHA_B: fechas.EXC_FECHA_B, C_NAC: fechas.C_NAC };
    const regla = (await reglasDeModulos(MODULOS_REGLAS)).find((r) => r.id === id);
    const exclusion = EXCLUSIONES.find((e) => e.id === id);
    const re = exportadas[id] ?? (regla !== undefined ? new RegExp(regla.source, regla.flags)
      : exclusion !== undefined ? new RegExp(exclusion.source, exclusion.flags) : undefined);
    expect(re, id).toBeDefined();
    const correr = (): number => {
      const r = new RegExp((re as RegExp).source, (re as RegExp).flags.includes('g') ? (re as RegExp).flags : (re as RegExp).flags + 'g');
      let k = 0;
      while (r.exec(texto) !== null) { k++; if (r.lastIndex === 0) break; }
      return k;
    };
    const mejor = Math.min(...[0, 1, 2].map(() => { const t0 = performance.now(); correr(); return performance.now() - t0; }));
    expect(mejor).toBeLessThan(50);
  }, 120_000);

  // ROTULO_ARTICULO (fechas.ts) y OWN_CASE (exclusiones.ts) se aplican a una ventana fija antes del dato (25 y 150 caracteres), así
  // que no se podían explotar; también pasan al lenguaje no ambiguo, y la prueba recorre su camino público con 40.000 tabuladores.
  it.each([
    ['ROTULO_ARTICULO (R-FEC-*): «artículo», tabuladores y una fecha', 'artículo' + TB + '14 de marzo de 2026', 'fechas'],
    ['OWN_CASE (esContextoDeCita): «Radicado», tabuladores y un radicado', 'Radicado' + TB + '11001-31-03-999-2026-00123-00', 'cita'],
  ])('GAP %s: 40.000 tabuladores por debajo de 300 ms', async (_n, texto, camino) => {
    const reglas = (await reglasDeModulos(['fechas'])).filter((r) => r.id.startsWith('R-FEC-'));
    const view = buildSearchView(texto, 'reglas', 'cuerpo');
    const i = texto.indexOf('11001');
    const correr = (): unknown => (camino === 'fechas' ? runRules(view, PART, reglas, 2026) : esContextoDeCita(texto, i, texto.length));
    const mejor = Math.min(...[0, 1, 2].map(() => { const t0 = performance.now(); correr(); return performance.now() - t0; }));
    expect(mejor).toBeLessThan(300);
  }, 120_000);

  // PB-2-r6 (D-06): los contextos para el modelo recorren las mismas exclusiones con su coincidencia entera y miran el objeto de una
  // cita de artículo en una ventana fija; R-RAD_ADMIN-03 consulta `esContextoDeCita` (ventanas fijas) en cada expediente. Lineales.
  it.each([
    ['contextosDelModelo: «artículo 49 de la», tabuladores y «Constitución»', 'artículo 49 de la' + TB + 'Constitución Política', 'modelo'],
    ['contextosDelModelo: citas de artículo encadenadas', 'artículo 1 de la Constitución Política, '.repeat(K / 40), 'modelo'],
    ['contextosDelModelo: normas encadenadas con tabuladores', ('Ley 1122 de 2007' + '\t'.repeat(40)).repeat(K / 56), 'modelo'],
    ['R-RAD_ADMIN-03 con el contexto de cita: expedientes citados encadenados', 'la Sentencia T-1 y el expediente T-9.000.001, '.repeat(K / 46), 'cita'],
  ])('PB-2-r6 %s: 40.000 caracteres por debajo de 300 ms', async (_n, texto, camino) => {
    const reglas = (await reglasDeModulos(['radicado'])).filter((r) => r.id === 'R-RAD_ADMIN-03');
    const view = buildSearchView(texto, 'reglas', 'cuerpo');
    const correr = (): unknown => (camino === 'modelo' ? contextosDelModelo(view) : runRules(view, PART, reglas, 2026));
    const mejor = Math.min(...[0, 1, 2].map(() => { const t0 = performance.now(); correr(); return performance.now() - t0; }));
    expect(mejor).toBeLessThan(300);
    // A-1 (PB-2-r7): «la Sentencia T-1» sola no es una señal de precedente: cada expediente se toma, con el contexto de cita.
    if (camino === 'cita') {
      const c = runRules(view, PART, reglas, 2026);
      expect(c.length).toBe(Math.floor(K / 46));
      expect(c.every((x) => x.context === 'cita')).toBe(true);
    }
  }, 120_000);

  // B-62 (PB-2-r7) y B-72 (PB-2-r8): R-RAD_ADMIN-03 consulta el contexto en cada expediente con ventanas fijas y el índice de la vista.
  // En un solo renglón de 200.000 y 1.000.000 de caracteres toma lo que debe tomar: sin el tope de la regla, para que la cuenta no
  // dependa de la carga del equipo (en -r7 se pedía una corrida sin corte, y con 35 trabajadores en paralelo las tres cortaban). El
  // tiempo se mide aparte y con la función sola, como las demás pruebas de tiempo: el contexto de todos los expedientes, con una vista
  // nueva en cada corrida (el índice que arma la primera consulta entra en la medida), el mejor de 3, por debajo del tope de la
  // regla (RULE_TIME_LIMIT_MS, 250 ms: no se relaja).
  it.each([
    ['«el expediente T-9.000.001, »', 200_000, 'el expediente T-9.000.001, ', null, true],
    ['«el expediente T-9.000.001, »', 1_000_000, 'el expediente T-9.000.001, ', null, true],
    ['«la Corte y el expediente T-9.000.001, »', 200_000, 'la Corte y el expediente T-9.000.001, ', 'cita', true],
    ['«la Corte y el expediente T-9.000.001, »', 1_000_000, 'la Corte y el expediente T-9.000.001, ', 'cita', true],
    // PB-2-r8: el camino de la providencia y la oración (todos citados: ninguno se toma) y el del propio caso con puntos y abreviaturas.
    ['«la Sentencia T-1 de 2020 y el expediente T-9.000.001, »', 1_000_000, 'la Sentencia T-1 de 2020 y el expediente T-9.000.001, ', null, false],
    ['«S.A. La Corte, en la T-1 de 2020, Cfr. el expediente T-9.000.001 me amparó. »', 1_000_000, 'S.A. La Corte, en la T-1 de 2020, Cfr. el expediente T-9.000.001 me amparó. ', null, true],
  ] as const)('B-62 y B-72 R-RAD_ADMIN-03 en un renglón con %s hasta %i caracteres: toma lo que debe y el contexto va por debajo del tope', async (_n, largo, unidad, contexto, toma) => {
    const reglas = (await reglasDeModulos(['radicado'])).filter((r) => r.id === 'R-RAD_ADMIN-03');
    const texto = unidad.repeat(Math.ceil(largo / unidad.length));
    const total = Math.ceil(largo / unidad.length);
    const c = runRules(buildSearchView(texto, 'reglas', 'cuerpo'), PART, reglas, 2026, { maxMsPerRule: Number.POSITIVE_INFINITY });
    expect(c.length).toBe(toma ? total : 0);
    expect(c.every((x) => (x.context ?? null) === contexto)).toBe(true);
    const inicios = [...texto.matchAll(/T-9\.000\.001/gu)].map((m) => m.index);
    expect(inicios.length).toBe(total);
    const mejor = Math.min(...[0, 1, 2].map(() => {
      const v = buildSearchView(texto, 'reglas', 'cuerpo');
      const t0 = performance.now();
      for (const s of inicios) contextoDelExpediente(v.text, s, s + 11, v);
      return performance.now() - t0;
    }));
    expect(mejor).toBeLessThan(RULE_TIME_LIMIT_MS);
  }, 120_000);

  // PB-2-r8: las expresiones nuevas del expediente (la providencia con número y año, las señales del propio caso con su cola de letras
  // acotada, el rótulo del renglón anterior y los fines de oración) con 40.000 blancos, letras o signos: el contexto de cada expediente
  // con el índice de la vista, el mejor de 3, por debajo de 50 ms.
  it.each([
    ['la providencia con tabuladores antes del año', 'la Sentencia T-1' + TB + 'de 2020 y el expediente T-9.000.001'],
    ['la providencia con espacios antes del año, fuera de la vista', 'la Sentencia T-1' + SP + 'de 2020 y el expediente T-9.000.001'],
    ['«otorgo», tabuladores y «poder»', 'otorgo' + TB + 'poder en el expediente T-9.000.001'],
    ['una racha de letras con «remit» repetido', 'remit'.repeat(K / 5) + ' el expediente T-9.000.001'],
    ['una racha de «cumpl» y «temer» sin blancos', 'cumpltemer'.repeat(K / 10) + ' el expediente T-9.000.001'],
    ['el rótulo tras 40.000 tabuladores en el renglón anterior', TB + 'Referencia:\nT-9.000.001'],
    ['puntos y espacios antes del expediente', '. '.repeat(K / 2) + 'el expediente T-9.000.001'],
    ['saltos de línea antes del expediente', 'a\n'.repeat(K / 2) + 'T-9.000.001'],
    ['abreviaturas encadenadas', 'S.A. M.P. Dr. No. '.repeat(K / 18) + 'T-9.000.001'],
  ])('PB-2-r8 contextoDelExpediente, %s: 40.000 caracteres por debajo de 50 ms', (_n, texto) => {
    const inicios = [...texto.matchAll(/T-9\.000\.001/gu)].map((m) => m.index);
    const mejor = Math.min(...[0, 1, 2].map(() => {
      const v = buildSearchView(texto, 'reglas', 'cuerpo');
      const t0 = performance.now();
      for (const s of inicios) {
        const i = v.text === texto ? s : v.text.indexOf('T-9.000.001');
        contextoDelExpediente(v.text, i, i + 11, v);
        contextoDelExpediente(texto, s, s + 11);
      }
      return performance.now() - t0;
    }));
    expect(mejor).toBeLessThan(50);
  }, 120_000);

  it('B-62 contextosDelModelo en un renglón de 200.000 caracteres con citas de artículo encadenadas: el objeto mira una ventana fija y no corta', () => {
    const texto = 'artículo 1 de la Constitución Política, '.repeat(5_000);
    let cortes = 0;
    contextosDelModelo(buildSearchView(texto, 'reglas', 'cuerpo'));
    const cx = contextosDelModelo(buildSearchView(texto, 'reglas', 'cuerpo'), { onTimeout: () => { cortes++; } });
    expect(cortes).toBe(0);
    expect(cx.filter((c) => c.inicio === true).length).toBe(5_000);
    expect(cx.filter((c) => c.inicio === true).every((c) => texto.slice(c.start, c.end) === 'Constitución Política')).toBe(true);
  }, 120_000);

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

// ---- AJ-2 (D-10): contexto de nacimiento -------------------------------------------------------------------------
describe('T-MO-01 · AJ-2: el contexto «nacimiento» de una fecha admite «nací» y un salto de línea suelto (7.5.5, 7.1.5)', () => {
  const contextos = async (texto: string): Promise<Array<string | undefined>> =>
    correr(texto, 'cuerpo', await cargarReglas('fechas'), 2026).filter((c) => c.type === 'FECHA').map((c) => c.context);
  it.each([
    ['nació el 14/03/1991', 'nacimiento'],
    ['nació\nel 2015-08-11', 'nacimiento'],
    ['nació el\n2015-08-11', 'nacimiento'],
    ['nació\n2015-08-11', 'nacimiento'],
    ['el seguro vence el 09.05.2026.\n\npor cierto cumplo 44 años; nací el 1980-06-09.', 'nacimiento'],
    ['nací\nel 1980-06-09', 'nacimiento'],
    ['Fecha de nacimiento:\n14/03/1991', 'nacimiento'],
  ])('positivo «%s»', async (texto, ctx) => {
    expect((await contextos(texto)).at(-1)).toBe(ctx);
  });
  it.each([
    'nació\n\n2015-08-11',
    'nació en Cali el 2015-08-11',
    'Ignací 14/03/1991',
    'nació el\n\n2015-08-11',
  ])('negativo «%s»: no es nacimiento', async (texto) => {
    expect((await contextos(texto)).at(-1)).not.toBe('nacimiento');
  });
  it.each(['\n', '\t', ' \n', '\t\n\t'])('C_NAC con 40.000 %j entre «nació» y la fecha: por debajo de 50 ms', async (sep) => {
    const { C_NAC } = await import('../../src/core/rules/fechas.ts');
    const texto = 'nació' + sep.repeat(40_000) + 'x';
    const mejor = Math.min(...[0, 1, 2].map(() => {
      const r = new RegExp(C_NAC.source, C_NAC.flags + 'g');
      const t0 = performance.now();
      while (r.exec(texto) !== null) { if (r.lastIndex === 0) break; }
      return performance.now() - t0;
    }));
    expect(mejor).toBeLessThan(50);
  });
});
