// T-MO-04 · Mapa de offsets de la vista normalizada (PA-1; plan 6.1.2, 7.1 y 10.0).
// Notación de las tablas (7.1.6): ⏎ = salto de línea; ⍽ = U+00A0; ⟨U+XXXX⟩ = el carácter real.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildAlnumSearchView, buildSearchView, toCanonicalSpan } from '../../src/core/normalize';
import type { NormalizationProfile, PartKind, SearchView } from '../../src/core/types.local';

const dec = (s: string): string => s
  .replace(/⍽/gu, ' ')
  .replace(/⏎/gu, '\n')
  .replace(/⟨U\+([0-9A-Fa-f]{4,6})⟩/gu, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)));

// Generador pseudoaleatorio determinista (mulberry32) con semilla fija.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES: readonly string[] = [
  'a', 'Z', 'ñ', 'Ñ', 'é', 'Ó', 'ü', 'é', 'İ', 'ß', 'Σ', 'x', 'q',
  '0', '1', '5', '9', '000', '123', '1234', '.', '.', ',', '-', '-', ':', '/', "'", '#', '(', ')', ' ', ' ', '  ',
  '\n', '\n', '\t', 'C.C.', 'radicado ', 'Fic-\nticia', '1.000.\n000', '03-\n999',
  ' ', ' ', '　', ' ', '‐', '–', '—', '−', '－', '’', '‘', '´', '′',
  '°', 'º', '№', '＃', '​', '‍', '­', '﻿', '‮', '⁦', '⁩', '⁠',
  '😀', '👩🏽‍💻', '🇨🇴', '𝐀', '\uD83D', '\uDE00',
];

function randomText(next: () => number, maxPieces: number): string {
  const n = Math.floor(next() * (maxPieces + 1));
  let s = '';
  for (let i = 0; i < n; i += 1) s += PIECES[Math.floor(next() * PIECES.length)] ?? '';
  return s;
}

const PROFILES: readonly NormalizationProfile[] = ['reglas', 'lista', 'digitos'];
const KINDS: readonly PartKind[] = ['cuerpo', 'pagina_pdf'];

const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;
const isDigitCode = (c: number): boolean => c >= 0x30 && c <= 0x39;

/** Un límite canónico `p` corta un par sustituto si cae entre sus dos unidades. */
function cutsPair(text: string, p: number): boolean {
  return p > 0 && p < text.length && isHigh(text.charCodeAt(p - 1)) && isLow(text.charCodeAt(p));
}

function checkMaps(text: string, v: SearchView): void {
  const n = v.text.length;
  expect(v.startMap.length).toBe(n + 1);
  expect(v.endMap.length).toBe(n);
  expect(v.startMap[n]).toBe(text.length);
  for (let i = 0; i < n; i += 1) {
    expect(v.startMap[i + 1] ?? 0).toBeGreaterThanOrEqual(v.startMap[i] ?? 0);
    if (i > 0) expect(v.endMap[i] ?? 0).toBeGreaterThanOrEqual(v.endMap[i - 1] ?? 0);
    expect(v.endMap[i] ?? 0).toBeGreaterThan(v.startMap[i] ?? 0);
    expect(v.endMap[i] ?? 0).toBeLessThanOrEqual(text.length);
  }
}

describe('T-MO-04 · tabla 7.1.6 de la normalización', () => {
  const rows: Array<[NormalizationProfile, PartKind, string, string | 'igual']> = [
    ['reglas', 'cuerpo', 'C.C.⍽1.000.000.001', 'C.C. 1.000.000.001'],
    ['reglas', 'cuerpo', '11001–31–03', '11001-31-03'],
    ['reglas', 'cuerpo', '$48’000.000', "$48'000.000"],
    ['reglas', 'cuerpo', '№ 5', '# 5'],
    ['reglas', 'cuerpo', '300⟨U+200B⟩000⟨U+200B⟩0001', '3000000001'],
    ['reglas', 'cuerpo', '1000⟨U+202E⟩000017', '1000000017'],
    ['reglas', 'cuerpo', 'Ro⟨U+00AD⟩jas', 'Rojas'],
    ['reglas', 'cuerpo', 'radicado 11001-31-03-⏎999', 'radicado 11001-31-03-999'],
    ['reglas', 'cuerpo', 'C.C. 1.000.⏎000.017', 'C.C. 1.000.000.017'],
    ['reglas', 'cuerpo', 'C.C. 1.000.000.001.⏎2. Hechos', 'igual'],
    ['reglas', 'pagina_pdf', 'Fic-⏎ticia', 'Ficticia'],
    ['reglas', 'cuerpo', 'Fic-⏎ticia', 'igual'],
    ['reglas', 'pagina_pdf', 'Gómez-⏎Rojas', 'igual'],
    ['lista', 'cuerpo', 'ANA  FICTICIA⏎ROJAS', 'ana ficticia rojas'],
    ['lista', 'cuerpo', 'Bogotá PEÑA Müller', 'bogota pena muller'],
  ];
  for (const [profile, kind, canon, expected] of rows) {
    it(`${profile} · ${kind} · «${canon}»`, () => {
      const text = dec(canon);
      const v = buildSearchView(text, profile, kind);
      expect(v.text).toBe(expected === 'igual' ? text : dec(expected));
      expect(v.profile).toBe(profile);
      checkMaps(text, v);
    });
  }

  it('otras filas de 7.1.2 y 7.1.5: grado, signo de número, uniones de miles y de guion', () => {
    expect(buildSearchView('Art. 5° ＃ 3', 'reglas', 'cuerpo').text).toBe('Art. 5º # 3');
    expect(buildSearchView('900.000.\n002-1', 'reglas', 'cuerpo').text).toBe('900.000.002-1');
    expect(buildSearchView('de 2012.\n100 personas', 'reglas', 'cuerpo').text).toBe('de 2012.\n100 personas');
    expect(buildSearchView('12\n34', 'reglas', 'cuerpo').text).toBe('12\n34');
    expect(buildSearchView('a ​    b', 'reglas', 'cuerpo').text).toBe('a b');
    expect(buildSearchView('a\tb\nc', 'reglas', 'cuerpo').text).toBe('a\tb\nc');
    expect(buildSearchView('Fic-\nticia', 'reglas', 'anotacion_pdf').text).toBe('Ficticia');
    expect(buildSearchView('Cédula:\n1.000.000.001', 'reglas', 'cuerpo').text).toBe('Cédula:\n1.000.000.001');
    expect(buildSearchView('Cédula:\n1.000.000.001', 'lista', 'cuerpo').text).toBe('cedula: 1.000.000.001');
    expect(buildSearchView('Fic-\nticia', 'lista', 'cuerpo').text).toBe('fic- ticia');
  });

  it('perfil digitos y su variante digitos+letras', () => {
    const v = buildSearchView('C.C. 1.000-000​.017 ab', 'digitos', 'cuerpo');
    expect(v.text).toBe('1000000017');
    const t = 'Placa abc 123, N° 9';
    const w = buildAlnumSearchView(t, 'cuerpo');
    expect(w.text).toBe('PLACAABC123N9');
    expect(w.profile).toBe('digitos');
    checkMaps(t, w);
  });

  it('INV-S01 · ejemplo de 7.1.4: «Ro⟨U+00AD⟩jas» en lista → startMap [0,1,3,4,5,6], endMap [1,2,4,5,6]', () => {
    const text = dec('Ro⟨U+00AD⟩jas');
    const v = buildSearchView(text, 'lista', 'cuerpo');
    expect(v.text).toBe('rojas');
    expect(Array.from(v.startMap)).toEqual([0, 1, 3, 4, 5, 6]);
    expect(Array.from(v.endMap)).toEqual([1, 2, 4, 5, 6]);
    expect(toCanonicalSpan(v, 0, 5)).toEqual({ start: 0, end: 6 });
  });

  it('INV-S01 · un colapso n → 1 y una expansión 1 → n apuntan al mismo tramo; el par sustituto no se corta', () => {
    const colapso = buildSearchView('a   b', 'reglas', 'cuerpo');
    expect(colapso.text).toBe('a b');
    expect(Array.from(colapso.startMap)).toEqual([0, 1, 4, 5]);
    expect(Array.from(colapso.endMap)).toEqual([1, 4, 5]);
    const expansion = buildSearchView('İ', 'lista', 'cuerpo');          // minúscula + marca → «i» tras quitar la marca
    expect(expansion.text).toBe('i');
    const par = buildSearchView('a😀b', 'reglas', 'cuerpo');
    expect(par.text).toBe('a😀b');
    expect(Array.from(par.startMap)).toEqual([0, 1, 1, 3, 4]);
    expect(Array.from(par.endMap)).toEqual([1, 3, 3, 4]);
    expect(toCanonicalSpan(par, 2, 3)).toEqual({ start: 1, end: 3 });   // un tramo que arranca en la 2.ª unidad del par
    expect(toCanonicalSpan(par, 1, 2)).toEqual({ start: 1, end: 3 });   // y otro que termina en la 1.ª
  });

  it('un emoji delante de «C.C.⍽1.000.000.001» devuelve el tramo canónico exacto', () => {
    const text = dec('😀 C.C.⍽1.000.000.001 y 🇨🇴');
    const v = buildSearchView(text, 'reglas', 'cuerpo');
    const i = v.text.indexOf('1.000.000.001');
    expect(i).toBeGreaterThan(0);
    const { start, end } = toCanonicalSpan(v, i, i + '1.000.000.001'.length);
    expect(text.slice(start, end)).toBe('1.000.000.001');
  });

  it('un radicado escrito con «–» vuelve al original con sus «–»', () => {
    const text = 'radicado 11001–31–03–2026–00123–00 del juzgado';
    const v = buildSearchView(text, 'reglas', 'cuerpo');
    const rad = '11001-31-03-2026-00123-00';
    const i = v.text.indexOf(rad);
    const { start, end } = toCanonicalSpan(v, i, i + rad.length);
    expect(text.slice(start, end)).toBe('11001–31–03–2026–00123–00');
  });

  it('el tramo canónico incluye el salto unido y los invisibles interiores (sin restos)', () => {
    const text = 'radicado 11001-31-03-⏎999 fin'.replace('⏎', '\n');
    const v = buildSearchView(text, 'reglas', 'cuerpo');
    const rad = '11001-31-03-999';
    const i = v.text.indexOf(rad);
    const { start, end } = toCanonicalSpan(v, i, i + rad.length);
    expect(text.slice(start, end)).toBe('11001-31-03-\n999');
    const t2 = dec('Ro⟨U+00AD⟩jas');
    const v2 = buildSearchView(t2, 'reglas', 'cuerpo');
    expect(toCanonicalSpan(v2, 0, 5)).toEqual({ start: 0, end: 6 });
  });

  it('un texto en NFD no rompe la vista (el contrato exige NFC, pero la función no depende de ello)', () => {
    const text = 'José Peña';
    for (const p of PROFILES) checkMaps(text, buildSearchView(text, p, 'cuerpo'));
    expect(buildSearchView(text, 'lista', 'cuerpo').text).toBe('jose pena');
  });
});

describe('T-MO-04 · invariantes de la vista', () => {
  it('INV-S01 · longitudes, startMap[text.length] y mapas no decrecientes en 300 cadenas aleatorias', () => {
    const next = rng(20261029);
    for (let k = 0; k < 300; k += 1) {
      const text = randomText(next, 40);
      for (const profile of PROFILES) {
        for (const kind of KINDS) checkMaps(text, buildSearchView(text, profile, kind));
      }
      checkMaps(text, buildAlnumSearchView(text, 'cuerpo'));
    }
  });

  it('INV-S02 · todo tramo de la vista vuelve a un tramo canónico válido cuya vista contiene el texto del tramo', () => {
    const next = rng(777001);
    let spans = 0;
    for (let k = 0; k < 300; k += 1) {
      const text = randomText(next, 40);
      for (const profile of PROFILES) {
        for (const kind of KINDS) {
          const v = buildSearchView(text, profile, kind);
          const n = v.text.length;
          if (n === 0) continue;
          for (let j = 0; j < 4; j += 1) {
            let a = Math.floor(next() * n);
            let b = a + 1 + Math.floor(next() * Math.min(12, n - a));
            // Como las expresiones del catálogo (frontera NL/NR de 7.2.0), el tramo no parte una racha de dígitos ni
            // arranca en su «-» o «.»: la unión «1.000.⏎000» o «03-⏎999» (7.1.5) depende de los dígitos de cada lado del salto.
            if (profile !== 'digitos') {
              // Y tampoco arranca en el «-» o el «.» que va pegado a esos dígitos (el dígito previo es contexto de la unión).
              if (a > 0 && (v.text[a] === '-' || v.text[a] === '.')) a -= 1;
              while (a > 0 && isDigitCode(v.text.charCodeAt(a)) && isDigitCode(v.text.charCodeAt(a - 1))) a -= 1;
              while (b < n && isDigitCode(v.text.charCodeAt(b - 1)) && isDigitCode(v.text.charCodeAt(b))) b += 1;
            }
            const { start, end } = toCanonicalSpan(v, a, b);
            expect(start).toBeGreaterThanOrEqual(0);
            expect(end).toBeGreaterThan(start);
            expect(end).toBeLessThanOrEqual(text.length);
            expect(cutsPair(text, start)).toBe(false);
            expect(cutsPair(text, end)).toBe(false);
            const again = buildSearchView(text.slice(start, end), profile, kind);
            expect(again.text.includes(v.text.slice(a, b)), JSON.stringify({ text, profile, kind, a, b, start, end, vt: v.text, at: again.text })).toBe(true);
            spans += 1;
          }
        }
      }
    }
    expect(spans).toBeGreaterThan(1000);
  });

  it('INV-S03 · la vista reglas es idempotente en 300 cadenas aleatorias', () => {
    const next = rng(31337);
    for (let k = 0; k < 300; k += 1) {
      const text = randomText(next, 40);
      for (const kind of KINDS) {
        const v = buildSearchView(text, 'reglas', kind);
        expect(buildSearchView(v.text, 'reglas', kind).text).toBe(v.text);
      }
    }
  });

  it('INV-S03 · idempotencia en casos de borde (uniones encadenadas, espacios y invisibles mezclados)', () => {
    const casos = [
      '1.\n000.\n000', '5.\n123-\n456', 'a-\nb-\nc', '1-\n2-\n3', ' ​ \n ‍ ', 'x   y',
      '12.\n3.\n456', '1.\n00\n0', 'ab-\n-\ncd', '\n-\n1', '.\n000', '1​.\n​000',
    ];
    for (const c of casos) {
      for (const kind of KINDS) {
        const v = buildSearchView(c, 'reglas', kind);
        expect(buildSearchView(v.text, 'reglas', kind).text).toBe(v.text);
      }
    }
  });

  it('INV-S04 · no lanza con texto vacío, no registra nada y no retiene el texto', () => {
    const espias = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    try {
      for (const profile of PROFILES) {
        for (const kind of KINDS) {
          const v = buildSearchView('', profile, kind);
          expect(v.text).toBe('');
          expect(Array.from(v.startMap)).toEqual([0]);
          expect(v.endMap.length).toBe(0);
        }
      }
      expect(buildAlnumSearchView('', 'cuerpo').text).toBe('');
      expect(toCanonicalSpan(buildSearchView('', 'reglas', 'cuerpo'), 0, 0)).toEqual({ start: 0, end: 0 });
      const texto = 'C.C. 1.000.000.001';
      const v = buildSearchView(texto, 'reglas', 'cuerpo');
      expect(Object.keys(v).sort()).toEqual(['endMap', 'profile', 'startMap', 'text']);
      expect(v.text).not.toBe(texto);                 // la vista es una cadena nueva, no el canónico
      for (const e of espias) expect(e).not.toHaveBeenCalled();
    } finally {
      for (const e of espias) e.mockRestore();
    }
  });

  it('INV-S04 · el código fuente no usa console, DOM, red ni almacenamiento ni estado de módulo', () => {
    for (const f of ['../../src/core/normalize.ts', '../../src/core/rules/catalog.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\/.*$/gmu, '').replace(/\/\*[\s\S]*?\*\//gu, '');
      for (const prohibido of [
        /\bconsole\b/u, /\bfetch\s*\(/u, /XMLHttpRequest/u, /WebSocket/u, /EventSource/u, /sendBeacon/u, /RTCPeerConnection/u,
        /window\.open/u, /\binnerHTML\b/u, /\bouterHTML\b/u, /insertAdjacentHTML/u, /document\./u, /\bwindow\b/u,
        /localStorage/u, /sessionStorage/u, /\bcookie\b/u, /\bnavigator\b/u, /\blocation\b/u, /Math\.random/u,
      ]) {
        expect(src, `${f} contiene ${String(prohibido)}`).not.toMatch(prohibido);
      }
    }
    const norm = readFileSync(new URL('../../src/core/normalize.ts', import.meta.url), 'utf8');
    expect(norm).not.toMatch(/^let\s/mu);             // sin estado mutable de módulo
  });
});

describe('T-MO-04 · pares sustitutos', () => {
  it('1.000 cadenas aleatorias: toCanonicalSpan nunca corta un par sustituto (tres perfiles, cuerpo y pagina_pdf)', () => {
    const next = rng(42424242);
    let checked = 0;
    for (let k = 0; k < 1000; k += 1) {
      // Solo pares completos (se quitan las mitades sueltas del alfabeto): el canónico válido nunca las trae.
      const text = randomText(next, 30).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu, '');
      for (const profile of PROFILES) {
        for (const kind of KINDS) {
          const v = buildSearchView(text, profile, kind);
          const n = v.text.length;
          // Todos los tramos posibles de las vistas cortas; una muestra de las largas.
          const pares: Array<[number, number]> = [];
          if (n <= 14) {
            for (let a = 0; a < n; a += 1) for (let b = a + 1; b <= n; b += 1) pares.push([a, b]);
          } else {
            for (let j = 0; j < 40; j += 1) {
              const a = Math.floor(next() * n);
              pares.push([a, a + 1 + Math.floor(next() * (n - a))]);
            }
          }
          for (const [a, b] of pares) {
            const { start, end } = toCanonicalSpan(v, a, b);
            expect(cutsPair(text, start)).toBe(false);
            expect(cutsPair(text, end)).toBe(false);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10000);
  });
});
