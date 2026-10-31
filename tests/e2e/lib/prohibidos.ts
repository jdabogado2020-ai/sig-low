// Barrido de textos prohibidos (8.5, «Barrido de textos prohibidos»; PC-7). Es la ÚNICA fuente de las dos expresiones: la usan
// T-IU-02 en unidad (tests/unit/mensajes.test.ts: catálogo, plantilla del informe, docs/legal y guía del abogado), la E2E de
// tests/e2e/accesibilidad.spec.ts (texto visible, aria-label y aria-valuetext de cada pantalla) y el barrido de dist/ (INV-G13).
// Excepción única: el diálogo «Créditos y licencias» (S-8.3), que nombra a los autores por obligación de licencia.
// Sin red ni DOM: solo cadenas y archivos locales. Datos ficticios.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

/** 1) Se aplica tras `normalize('NFD')`, quitar diacríticos y pasar a minúsculas. */
export const EXPRESION_PROMESAS =
  /garantiz|garantia|100\s*%|cien por ciento|totalmente anonim|completamente anonim|sin riesgo|\bsegur(o|a|os|as|idad)\b|infalible|a prueba de|dato falso/;
/** 2) Se aplica al texto original, sensible a mayúsculas (no atrapa «se llama»). */
export const EXPRESION_PROVEEDORES =
  /\b(ChatGPT|OpenAI|GPT-?\d+(\.\d+)?o?|Gemini|Bard|Copilot|Bing|Claude|Anthropic|Llama|Meta AI|Mistral|Perplexity|DeepSeek|Grok|xAI|Qwen|Hugging Face|Microsoft|Windows|Word|Google|Chrome|Edge|Firefox|Safari|Apple)\b/g;

export const sinDiacriticos = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Coincidencias de las dos expresiones en una cadena (vacío = limpia). */
export function coincidencias(texto: string): string[] {
  const halladas: string[] = [];
  const m1 = EXPRESION_PROMESAS.exec(sinDiacriticos(texto));
  if (m1 !== null) halladas.push(m1[0]);
  for (const m2 of texto.matchAll(EXPRESION_PROVEEDORES)) halladas.push(m2[0]);
  return halladas;
}

/** Hallazgos de una lista de cadenas: «cadena → coincidencias». Una lista vacía es el resultado esperado. */
export function hallazgos(cadenas: Iterable<string>): string[] {
  const salida: string[] = [];
  for (const c of cadenas) {
    const h = coincidencias(c);
    if (h.length > 0) salida.push(`${JSON.stringify(c.slice(0, 120))} → ${h.join(', ')}`);
  }
  return salida;
}

/**
 * Archivos propios de `dist/` que llevan el catálogo y la interfaz. Quedan fuera los de terceros (pdf.js, onnxruntime) y `ner.worker`, que
 * empaqueta el lector de tokenizadores y no lleva texto de interfaz (su código nombra la clase Word de las expresiones regulares Unicode).
 */
export function archivosPropiosDeDist(raiz: string): string[] {
  const out: string[] = [];
  for (const f of ['index.html', 'sw.js', 'tt-policy.js', 'precache.json', '_headers']) if (existsSync(join(raiz, f))) out.push(join(raiz, f));
  const assets = join(raiz, 'assets');
  if (existsSync(assets)) {
    for (const n of readdirSync(assets)) {
      const propio = /^(index|detect\.worker|io\.worker)-.+\.(js|css)$/.test(n);
      if (propio && statSync(join(assets, n)).isFile()) out.push(join(assets, n));
    }
  }
  return out;
}

/**
 * En `dist/` la expresión 1 no usa `garantia` ni `segur…`: en el chunk de entrada y en el de detección son datos (la expresión regular de
 * pólizas, la lista de frases de paso comunes y el léxico de «garantías» de las banderas), no texto de interfaz. Esas dos raíces se barren
 * sobre el catálogo completo desde sus fuentes (tests/unit/mensajes.test.ts). Aquí quedan `garantiz`, «100 %», «cien por ciento»,
 * «totalmente/completamente anonim», «sin riesgo», «infalible», «a prueba de» y «dato falso»; se omite en CSS (`100%` es un valor de ancho).
 * La expresión 2 (proveedores) se aplica íntegra.
 */
const PROMESAS_DIST = /garantiz|100\s*%|cien por ciento|totalmente anonim|completamente anonim|sin riesgo|infalible|a prueba de|dato falso/;
function coincidenciasDist(texto: string, css: boolean): string[] {
  const out: string[] = [];
  if (!css) { const m = PROMESAS_DIST.exec(sinDiacriticos(texto)); if (m !== null) out.push(m[0]); }
  for (const m of texto.matchAll(EXPRESION_PROVEEDORES)) out.push(m[0]);
  return out;
}

/**
 * Hallazgos en `dist/` fuera del diálogo «Créditos y licencias»: se quitan del texto las cadenas de `licencias`
 * (tal cual y con las comillas escapadas de JavaScript) y se barre lo que queda con las dos expresiones.
 */
export function hallazgosEnDist(raiz: string, licencias: readonly string[]): string[] {
  const salida: string[] = [];
  const ordenadas = [...licencias].sort((a, b) => b.length - a.length);
  for (const archivo of archivosPropiosDeDist(raiz)) {
    let texto = readFileSync(archivo, 'utf8');
    for (const l of ordenadas) {
      if (l.length < 3) continue;
      texto = texto.split(l).join(' ');
      const escapada = JSON.stringify(l).slice(1, -1);
      if (escapada !== l) texto = texto.split(escapada).join(' ');
    }
    const h = coincidenciasDist(texto, archivo.endsWith('.css'));
    for (const x of h) salida.push(`${archivo.slice(raiz.length + 1).split(sep).join('/')} → ${x}`);
  }
  return salida;
}
