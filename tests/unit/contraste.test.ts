// T-AX-05 (8.4.2, 8.6.6): recalcula las razones de contraste WCAG desde los tokens de color de la interfaz (propiedades CSS de
// src/ui/**/*.css: el plan las llama «tokens.css»; viven en base.css y en review/base/revision-base.css) y la diferencia de color
// ΔE76 entre los bordes de las ocho categorías con las tres simulaciones de visión del color (Machado 2009, severidad 1,0).
// Falla si el texto queda por debajo de 4,5 o lo no textual por debajo de 3, o si ΔE76 < 10. Los números del plan (8.4.2) son el oráculo.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Rgb = readonly [number, number, number];
type Tema = 'claro' | 'oscuro';

function* css(dir: string): Generator<string> {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* css(p);
    else if (n.endsWith('.css')) yield p;
  }
}

/** Propiedades `--nombre: #rrggbb` de los bloques `:root`; el tema oscuro es el `:root` dentro de `@media (prefers-color-scheme: dark)`. */
function tokens(): Record<Tema, Map<string, string>> {
  const claro = new Map<string, string>();
  const oscuro = new Map<string, string>();
  for (const archivo of css(join(process.cwd(), 'src/ui'))) {
    const texto = readFileSync(archivo, 'utf8');
    const posOscuro = [...texto.matchAll(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{/g)].map((m) => m.index);
    for (const m of texto.matchAll(/:root\s*\{([^}]*)\}/g)) {
      const dentroDeOscuro = posOscuro.some((p) => p < m.index && texto.slice(p, m.index).split('{').length - texto.slice(p, m.index).split('}').length >= 1);
      for (const d of m[1]!.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) (dentroDeOscuro ? oscuro : claro).set(d[1]!, d[2]!.toLowerCase());
    }
  }
  // Un token que el tema oscuro no redefine conserva el valor claro.
  for (const [k, v] of claro) if (!oscuro.has(k)) oscuro.set(k, v);
  return { claro, oscuro };
}

const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as Rgb;
const lineal = (c: number): number => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminancia = ([r, g, b]: Rgb): number => 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b);
function razon(a: string, b: string): number {
  const [la, lb] = [luminancia(hex(a)), luminancia(hex(b))];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Machado, Oliveira y Fernandes (2009), severidad 1,0, sobre RGB lineal.
const SIMULACIONES: Readonly<Record<string, readonly number[]>> = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};
const acotar = (v: number): number => Math.min(1, Math.max(0, v));
function simular(h: string, m: readonly number[] | null): Rgb {
  const [r, g, b] = hex(h).map(lineal) as unknown as Rgb;
  if (m === null) return [r, g, b];
  return [acotar(m[0]! * r + m[1]! * g + m[2]! * b), acotar(m[3]! * r + m[4]! * g + m[5]! * b), acotar(m[6]! * r + m[7]! * g + m[8]! * b)];
}
function lab([r, g, b]: Rgb): [number, number, number] {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const deltaE76 = (a: Rgb, b: Rgb): number => { const [p, q] = [lab(a), lab(b)]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

const CATEGORIAS = ['per', 'org', 'ide', 'exp', 'con', 'bie', 'fec', 'ban'] as const;
// Oráculo: las razones mínimas «recalculadas para esta versión» de 8.4.2.
const PLAN = {
  claro: { textoRelleno: 12.53, bordePagina: 3.36, bordeRelleno: 3.13, insignia: 5.11, de: 13.2 },
  oscuro: { textoRelleno: 6.59, bordePagina: 4.18, bordeRelleno: 3.08, insignia: 4.89, de: 13.6 },
} as const;
const PAGINA: Record<Tema, string> = { claro: '--sl-fondo', oscuro: '--sl-fondo' };

describe.each(['claro', 'oscuro'] as const)('T-AX-05 contraste y daltonismo · tema %s', (tema) => {
  const t = tokens()[tema];
  const v = (nombre: string): string => { const h = t.get(nombre); expect(h, `token ${nombre}`).toBeDefined(); return h as string; };
  const pagina = (): string => v(PAGINA[tema]);

  it(`T-AX-05 las ocho categorías: texto/relleno, borde/página, borde/relleno e insignia cumplen las razones de 8.4.2 (${tema})`, () => {
    const texto = v('--hl-texto');
    const mins = { textoRelleno: Infinity, bordePagina: Infinity, bordeRelleno: Infinity, insignia: Infinity };
    for (const c of CATEGORIAS) {
      const [relleno, borde, ins] = [v(`--hl-${c}-relleno`), v(`--hl-${c}-borde`), v(`--hl-${c}-ins`)];
      const r = { textoRelleno: razon(texto, relleno), bordePagina: razon(borde, pagina()), bordeRelleno: razon(borde, relleno), insignia: razon(ins, borde) };
      expect(r.textoRelleno, `${c} texto/relleno`).toBeGreaterThanOrEqual(4.5);
      expect(r.insignia, `${c} insignia`).toBeGreaterThanOrEqual(4.5);
      expect(r.bordePagina, `${c} borde/página`).toBeGreaterThanOrEqual(3);
      for (const k of Object.keys(mins) as Array<keyof typeof mins>) mins[k] = Math.min(mins[k], r[k]);
    }
    // El borde contra el relleno de su propia categoría llega a 3,08 en oscuro (8.4.2): es el mínimo documentado, no una regresión.
    expect(mins.bordeRelleno).toBeGreaterThanOrEqual(3);
    for (const k of ['textoRelleno', 'bordePagina', 'bordeRelleno', 'insignia'] as const) {
      expect(mins[k], `mínimo de ${k}`).toBeGreaterThanOrEqual(PLAN[tema][k] - 0.02);
    }
  });

  it(`T-AX-05 ΔE76 ≥ 10 entre los bordes de las categorías con visión normal y con las tres simulaciones (${tema})`, () => {
    let minimo = Infinity;
    for (const [nombre, m] of [['normal', null], ...Object.entries(SIMULACIONES)] as Array<[string, readonly number[] | null]>) {
      for (let i = 0; i < CATEGORIAS.length; i++) {
        for (let j = i + 1; j < CATEGORIAS.length; j++) {
          const de = deltaE76(simular(v(`--hl-${CATEGORIAS[i]}-borde`), m), simular(v(`--hl-${CATEGORIAS[j]}-borde`), m));
          expect(de, `${nombre}: ${CATEGORIAS[i]}–${CATEGORIAS[j]}`).toBeGreaterThanOrEqual(10);
          if (nombre !== 'normal') minimo = Math.min(minimo, de);
        }
      }
    }
    expect(minimo).toBeGreaterThanOrEqual(10);
  });

  it(`T-AX-05 tokens auxiliares: texto ≥ 4,5 y no textual ≥ 3 (${tema})`, () => {
    const fondo = pagina();
    const texto: Array<[string, string, string]> = [
      ['texto/fondo', v('--sl-texto'), fondo], ['texto secundario/fondo', v('--sl-texto-2'), fondo],
      ['texto/superficie', v('--sl-texto'), v('--sl-fondo-2')], ['texto secundario/superficie', v('--sl-texto-2'), v('--sl-fondo-2')],
      ['botón principal', v('--sl-primario-texto'), v('--sl-primario')], ['enlace/fondo', v('--sl-primario'), fondo],
      ['error/fondo', v('--sl-error'), fondo], ['texto/aviso', v('--sl-texto'), v('--sl-aviso-fondo')],
      ['texto de insignia de residuo/fondo', v('--hl-residuo'), fondo], ['texto/superficie de paneles', v('--hl-texto'), v('--hl-superficie')],
      ['rechazada/fondo', v('--hl-rechazada'), fondo],
    ];
    for (const [nombre, a, b] of texto) expect(razon(a, b), nombre).toBeGreaterThanOrEqual(4.5);
    const noTexto: Array<[string, string, string]> = [
      ['foco/fondo', v('--sl-foco'), fondo], ['foco/superficie', v('--sl-foco'), v('--sl-fondo-2')], ['borde de campos/fondo', v('--sl-borde'), fondo],
      ['borde de aviso/aviso', v('--sl-aviso-borde'), v('--sl-aviso-fondo')], ['borde de aviso/fondo', v('--sl-aviso-borde'), fondo],
      ['residuo/fondo', v('--hl-residuo'), fondo], ['rechazada/superficie', v('--hl-rechazada'), v('--hl-superficie')],
    ];
    for (const [nombre, a, b] of noTexto) expect(razon(a, b), nombre).toBeGreaterThanOrEqual(3);
  });
});

describe('T-AX-05 la paleta del plan', () => {
  it('T-AX-05 los hexadecimales de las ocho categorías y de los tokens auxiliares coinciden con 8.4.2', () => {
    const { claro, oscuro } = tokens();
    expect(claro.get('--hl-per-borde')).toBe('#00446b');
    expect(oscuro.get('--hl-per-borde')).toBe('#338ec1');
    expect(claro.get('--hl-texto')).toBe('#1b1b1f');
    expect(oscuro.get('--hl-texto')).toBe('#ececee');
    expect(claro.get('--hl-superficie')).toBe('#f4f5f7');
    expect(oscuro.get('--hl-superficie')).toBe('#1f2226');
    expect(claro.get('--hl-residuo')).toBe('#b00020');
    expect(oscuro.get('--hl-residuo')).toBe('#ff8a80');
    expect(claro.get('--hl-rechazada')).toBe('#6b6b6b');
    expect(oscuro.get('--hl-rechazada')).toBe('#9a9aa2');
  });

  it('T-AX-05 la razón calculada reproduce un valor conocido de 8.4.2 (texto/página claro 17,17)', () => {
    expect(razon('#1b1b1f', '#ffffff')).toBeCloseTo(17.17, 1);
    expect(razon('#ececee', '#15171a')).toBeCloseTo(15.22, 1);
  });
});
