/**
 * Restauración de mayúsculas por párrafo entero antes del modelo (PF-3-r1b; D-06, decisión 6; variante (b′) del experimento PF-3-r1).
 * Código propio de Sig-Low. TypeScript puro: sin DOM ni red.
 *
 * Un escrito en MAYÚSCULAS o en minúsculas (una carátula, un encabezado, una firma, un párrafo pegado de un chat) hace que GLiNER-X
 * encuentre menos nombres: con el texto tal cual, ORG_FUERA daba 0,626 en MAYÚSCULAS y 0,606 en minúsculas sobre el desarrollo. Antes de
 * entregar el texto al modelo, `restaurarMayusculas` pasa a Title Case los párrafos que vienen ENTEROS en MAYÚSCULAS o ENTEROS en
 * minúsculas. Un párrafo mixto o en texto natural no se toca (por eso el texto natural queda igual que sin esta función).
 *
 * Reglas (cambiarlas exige subir `VERSION_RESTAURAR`: la caché de salidas del modelo depende de ellas):
 *   - Párrafo: tramo separado por una línea en blanco (`\n`, blancos, `\n`). Su caja es `may` si tiene mayúsculas y ninguna minúscula,
 *     `min` al revés; `mixta` o `sin` (sin letras con caja) no se toca.
 *   - En un párrafo restaurable, cada palabra de R-MOD-01 (7.10.2) pasa a Title Case, con la inicial tras cada guion o guion bajo. Las
 *     palabras de función y los tratamientos de R-MOD-03 (FW) quedan en minúscula, salvo la primera palabra de la frase; una letra sola
 *     seguida de «.» (inicial o sigla: «S.A.», «C.C.») y una palabra con dígitos (un código: «C04», «ABC123») van en mayúsculas. Así un
 *     párrafo en MAYÚSCULAS y el mismo en minúsculas quedan idénticos.
 *   - Posiciones 1:1 (INV-W04): el resultado tiene la misma longitud UTF-16 y en cada posición el mismo carácter o su otra caja. Solo se
 *     convierte un carácter si la otra caja ocupa lo mismo («ß» → «SS» y «İ» → «i̇» se quedan como están; las ligaduras como «ﬁ», que
 *     pasan a dos letras en mayúscula, tampoco cambian). Lanza `RESTAURAR_CAMBIA_LONGITUD` si la longitud cambiara.
 *
 * El texto restaurado solo va al modelo (`handler.ts`): el texto canónico, los tramos y el resto de la tubería no lo ven.
 */

/** Versión de las reglas de arriba; la caché de salidas del modelo la guarda junto con la huella de este archivo. */
export const VERSION_RESTAURAR = 'restaurar-mayusculas@1';

/** FW de R-MOD-03 (7.10.7): palabras de función y tratamientos, plegadas (minúsculas, sin tildes). Una prueba la compara con la de merge.ts. */
export const PALABRAS_FUNCION: ReadonlySet<string> = new Set(
  'de|del|la|las|los|el|lo|y|e|o|u|a|al|en|por|para|con|sin|su|sus|que|se|un|una|unos|unas|senorita|senora|senor|srta|sra|sr|dona|don|doctora|doctor|dra|dr|mrs|mr|ms'.split('|'),
);

/** Palabra de R-MOD-01 (7.10.2), sin la alternativa del signo suelto. Sin retroceso: la expresión siempre casa en una pasada. */
const RE_PALABRA = /[\p{L}\p{M}\p{N}_][\p{L}\p{M}\p{N}_\u{AD}\u{200B}-\u{200D}]*(?:[-_][\p{L}\p{M}\p{N}_][\p{L}\p{M}\p{N}_\u{AD}\u{200B}-\u{200D}]*)*/gu;
const RE_SALTO_PARRAFO = /\r?\n[ \t\r]*\n/gu;
const RE_FIN_FRASE = /[.!?](?=\s|$)|\r?\n[ \t\r]*\n/gu;

const aMay = (c: string): string => { const t = c.toUpperCase(); return t.length === c.length ? t : c; };
const aMin = (c: string): string => { const t = c.toLowerCase(); return t.length === c.length ? t : c; };
/** Mayúscula o minúscula «convertible»: la que tiene la otra forma con la misma longitud (la «ß» y la «İ» no cuentan). */
const esMay = (c: string): boolean => aMin(c) !== c;
const esMin = (c: string): boolean => aMay(c) !== c;
const plegar = (p: string): string => p.normalize('NFD').replace(/[\p{M}\u{AD}\u{200B}-\u{200D}]/gu, '').toLowerCase();

/** Caja de un segmento: `may` si tiene mayúsculas y ninguna minúscula, `min` al revés, `mixta` o `sin` (sin letras con caja). */
export function cajaDe(t: string): 'may' | 'min' | 'mixta' | 'sin' {
  let may = false;
  let min = false;
  for (const c of t) {
    if (esMay(c)) may = true; else if (esMin(c)) min = true;
    if (may && min) return 'mixta';
  }
  return may ? 'may' : min ? 'min' : 'sin';
}

/** Tramos de un texto separados por las coincidencias de `re` (el separador queda fuera): posiciones [inicio, fin). */
function cortar(t: string, re: RegExp): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let s = 0;
  re.lastIndex = 0;
  for (let m = re.exec(t); m !== null; m = re.exec(t)) {
    if (m.index > s) out.push([s, m.index]);
    s = m.index + m[0].length;
  }
  if (s < t.length) out.push([s, t.length]);
  return out;
}

/** Párrafos: tramos separados por una línea en blanco (posiciones [inicio, fin)). */
export function segmentosParrafo(t: string): Array<[number, number]> { return cortar(t, RE_SALTO_PARRAFO); }

/** Frases enteras, cortadas tras «.», «!» o «?» seguidos de un blanco o por una línea en blanco (el corte incluye el signo). */
export function segmentosFrase(t: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let s = 0;
  RE_FIN_FRASE.lastIndex = 0;
  for (let m = RE_FIN_FRASE.exec(t); m !== null; m = RE_FIN_FRASE.exec(t)) {
    const e = m.index + m[0].length;
    if (e > s) out.push([s, e]);
    s = e;
  }
  if (s < t.length) out.push([s, t.length]);
  return out;
}

/** Caja de una palabra dentro de un segmento restaurable. */
function casarPalabra(p: string, primera: boolean, seguidaDePunto: boolean): string {
  const base = plegar(p);
  if (/\p{N}/u.test(p) || ([...base].length === 1 && seguidaDePunto)) return [...p].map(aMay).join('');
  if (!primera && PALABRAS_FUNCION.has(base)) return [...p].map(aMin).join('');
  let inicio = true;
  let out = '';
  for (const c of p) {
    if (c === '-' || c === '_') { out += c; inicio = true; continue; }
    if (/\p{L}/u.test(c)) { out += inicio ? aMay(c) : aMin(c); inicio = false; continue; }
    out += c;
  }
  return out;
}

/**
 * Restaura la caja de los segmentos que `elegir` devuelve (posiciones [inicio, fin) del texto). `frases` son las frases del texto,
 * calculadas una sola vez: la primera palabra de cada una es la única de función que se escribe con mayúscula inicial. Es la base de
 * `restaurarMayusculas` y de las variantes del experimento (`scripts/evaluar-modelo.ts`).
 */
export function restaurarSegmentos(
  texto: string, elegir: (frases: ReadonlyArray<readonly [number, number]>) => ReadonlyArray<readonly [number, number]>,
): string {
  const frases = segmentosFrase(texto);
  const iniciales = new Set<number>();
  for (const [s, e] of frases) {
    RE_PALABRA.lastIndex = 0;
    const m = RE_PALABRA.exec(texto.slice(s, e));
    if (m !== null) iniciales.add(s + m.index);
  }
  const cambios: Array<[number, number, string]> = [];
  for (const [s, e] of elegir(frases)) {
    const seg = texto.slice(s, e);
    RE_PALABRA.lastIndex = 0;
    for (let m = RE_PALABRA.exec(seg); m !== null; m = RE_PALABRA.exec(seg)) {
      const ini = s + m.index;
      const fin = ini + m[0].length;
      const nuevo = casarPalabra(m[0], iniciales.has(ini), texto[fin] === '.');
      if (nuevo !== m[0]) cambios.push([ini, fin, nuevo]);
    }
  }
  if (cambios.length === 0) return texto;
  cambios.sort((x, y) => x[0] - y[0]);
  let salida = '';
  let k = 0;
  for (const [ini, fin, nuevo] of cambios) { salida += texto.slice(k, ini) + nuevo; k = fin; }
  salida += texto.slice(k);
  if (salida.length !== texto.length) throw new Error('RESTAURAR_CAMBIA_LONGITUD');
  return salida;
}

/**
 * (b′) El texto para el modelo: los párrafos enteros en MAYÚSCULAS o enteros en minúsculas pasan a Title Case; todo lo demás queda
 * igual. Misma longitud que `texto` y, en cada posición, el mismo carácter o su otra caja (INV-W04). Tiempo lineal en el largo.
 */
export function restaurarMayusculas(texto: string): string {
  return restaurarSegmentos(texto, () => segmentosParrafo(texto).filter(([s, e]) => {
    const caja = cajaDe(texto.slice(s, e));
    return caja === 'may' || caja === 'min';
  }));
}
