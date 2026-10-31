// Catálogo de direcciones y barrios (PA-4; plan 7.4): R-DIR-01 a R-DIR-06 y R-BAR-01.
// TypeScript puro: sin DOM, sin red, sin registro. `assess` es una función pura sobre la vista `reglas` (nunca conserva el texto).
// La clave canónica urbana sigue la forma estandarizada DANE/MinTIC (7.4.6): «Calle 00 n.º 00-00», «Cl. 00 # 00-00» y
// «CL 00 00 00» producen la misma clave `DIR:CL 00 00 0`.
import divipolaRaw from '../../../data/divipola.json';
import type { Confidence, DivipolaFile, RuleContext, RuleSpec, RuleVerdict } from '../types.ts';
import { H, LB, alt, v3, vistaLista } from './fechas.ts';

// ---------------------------------------------------------------------------------------------------------------------
// Léxico (7.4.3)
// ---------------------------------------------------------------------------------------------------------------------
const VIA_FORMS: Readonly<Record<string, readonly string[]>> = {
  CL: ['Calle', 'CALLE', 'calle', 'Cl.', 'Cl', 'CL.', 'CL', 'cl.', 'cl', 'Cll.', 'Cll', 'CLL.', 'CLL', 'cll.', 'cll'],
  KR: ['Carrera', 'CARRERA', 'carrera', 'Cra.', 'Cra', 'CRA.', 'CRA', 'cra.', 'cra', 'Kr.', 'Kr', 'KR.', 'KR', 'kr.', 'kr', 'Kra.', 'Kra', 'KRA.', 'KRA', 'kra.', 'CR.', 'CR', 'Cr.', 'Cr', 'cr.', 'Carr.', 'CARR.'],
  AC: ['Avenida Calle', 'AVENIDA CALLE', 'avenida calle', 'Av. Calle', 'Av Calle', 'AV. CALLE', 'AV CALLE', 'av. calle', 'Av. Cl.', 'Av. Cll.', 'AV. CL.', 'AC'],
  AK: ['Avenida Carrera', 'AVENIDA CARRERA', 'avenida carrera', 'Av. Carrera', 'Av Carrera', 'AV. CARRERA', 'AV CARRERA', 'av. carrera', 'Av. Cra.', 'Av. Cra', 'Av Cra', 'AV. CRA.', 'AV CRA', 'Av. Kr.', 'Av. Kr', 'AV. KR.', 'Av. Kra.', 'AK'],
  AV: ['Avenida', 'AVENIDA', 'avenida', 'Av.', 'Av', 'AV.', 'AV', 'av.', 'Avda.', 'Avda', 'AVDA.'],
  DG: ['Diagonal', 'DIAGONAL', 'diagonal', 'Dg.', 'Dg', 'DG.', 'DG', 'dg.', 'Diag.', 'Diag', 'DIAG.', 'DIAG'],
  TV: ['Transversal', 'TRANSVERSAL', 'transversal', 'Tv.', 'Tv', 'TV.', 'TV', 'tv.', 'Tr.', 'Tr', 'TR.', 'TR', 'Trans.', 'TRANS.', 'Transv.', 'TRANSV.'],
  CQ: ['Circular', 'CIRCULAR', 'circular', 'Cq.', 'CQ', 'Circ.', 'CIRC.'],
  AU: ['Autopista', 'AUTOPISTA', 'autopista', 'AU', 'AUT', 'Aut.', 'AUT.', 'Autop.'],
  VIA: ['Vía', 'VÍA', 'vía', 'Via', 'VIA', 'via'],
  VARIANTE: ['Variante', 'VARIANTE', 'variante'],
};
/** Letras sueltas: solo en MAYÚSCULA y solo con separador. */
const VIA_SINGLE: Readonly<Record<string, string>> = { C: 'CL', K: 'KR', D: 'DG', T: 'TV' };

/** Sin diacríticos (NFD → quita marcas combinadas → NFC). */
const deacc = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/gu, '').normalize('NFC');
/** Clave de búsqueda de un token de vía o de complemento: sin diacríticos, sin puntos ni blancos, en mayúscula. */
const claveToken = (s: string): string => deacc(s).replace(/[.\s]/gu, '').toUpperCase();

const VIA_CANON = new Map<string, string>();
for (const [code, forms] of Object.entries(VIA_FORMS)) for (const f of forms) VIA_CANON.set(claveToken(f), code);
for (const [l, code] of Object.entries(VIA_SINGLE)) VIA_CANON.set(l, code);
const canonVia = (tok: string): string => VIA_CANON.get(claveToken(tok)) ?? claveToken(tok);
/** Códigos estándar de la guía (la rama 3, sin separador ni guion, solo los acepta en MAYÚSCULAS y con estos códigos). */
const STD_CODES: ReadonlySet<string> = new Set(['CL', 'KR', 'AC', 'AK', 'DG', 'TV', 'AV', 'AU', 'CQ']);

const COMP_NUM: Readonly<Record<string, readonly string[]>> = {
  AP: ['Apartamento', 'APARTAMENTO', 'apartamento', 'Apto.', 'Apto', 'APTO.', 'APTO', 'apto.', 'apto', 'Apt.', 'Ap.', 'AP'],
  IN: ['Interior', 'INTERIOR', 'interior', 'Int.', 'Int', 'INT.', 'INT', 'int.', 'IN'],
  TO: ['Torre', 'TORRE', 'torre', 'TO'],
  CA: ['Casa', 'CASA', 'casa', 'CA'],
  MZ: ['Manzana', 'MANZANA', 'manzana', 'Mz.', 'Mz', 'MZ.', 'MZ', 'mz.', 'mz', 'Mza.', 'MZA.'],
  LT: ['Lote', 'LOTE', 'lote', 'Lt.', 'LT'],
  LC: ['Local', 'LOCAL', 'local', 'Loc.', 'LC', 'Lc.'],
  OF: ['Oficina', 'OFICINA', 'oficina', 'Of.', 'OF.', 'OF', 'of.', 'Ofc.'],
  BQ: ['Bloque', 'BLOQUE', 'bloque', 'Bl.', 'BL.', 'Blq.', 'BQ'],
  PI: ['Piso', 'PISO', 'piso', 'PI'],
  ET: ['Etapa', 'ETAPA', 'etapa', 'ET'],
  BG: ['Bodega', 'BODEGA', 'bodega', 'Bod.', 'BG'],
  PL: ['Planta', 'PLANTA', 'planta', 'PL'],
  UN: ['Unidad', 'UNIDAD', 'unidad', 'UN'],
};
const COMP_NAME: Readonly<Record<string, readonly string[]>> = {
  CO: ['Conjunto Residencial', 'CONJUNTO RESIDENCIAL', 'conjunto residencial', 'Conjunto', 'CONJUNTO', 'conjunto', 'Conj. Res.', 'Conj.', 'CO'],
  ED: ['Edificio', 'EDIFICIO', 'edificio', 'Edif.', 'ED'],
  UR: ['Unidad Residencial', 'UNIDAD RESIDENCIAL', 'unidad residencial', 'U.R.', 'UR'],
};
const COMP_EQ: readonly string[] = ['Esquina', 'ESQUINA', 'esquina', 'EQ'];
const COMP_CANON = new Map<string, string>();
for (const [code, forms] of Object.entries({ ...COMP_NUM, ...COMP_NAME, EQ: COMP_EQ })) for (const f of forms) COMP_CANON.set(claveToken(f), code);

const todas = (r: Readonly<Record<string, readonly string[]>>): string[] => Object.values(r).flat();

// ---------------------------------------------------------------------------------------------------------------------
// Fragmentos (7.4.4)
// ---------------------------------------------------------------------------------------------------------------------
const VIA = alt([...todas(VIA_FORMS), ...Object.keys(VIA_SINGLE)]);
const VIA_NOSINGLE = alt(todas(VIA_FORMS));
const QUAD = alt(['Sur', 'SUR', 'sur', 'Norte', 'NORTE', 'norte', 'Este', 'ESTE', 'Oeste', 'OESTE', 'Occidente', 'OCCIDENTE', 'Oriente', 'ORIENTE', 'S', 'N', 'E', 'W']) + '(?!\\p{L})';
const SEP = alt(['#', 'No.', 'No', 'NO.', 'NO', 'no.', 'Nº.', 'Nº', 'nº.', 'nº', 'n.º', 'N.º', 'Nro.', 'Nro', 'NRO.', 'NRO', 'nro.', 'nro', 'Núm.', 'Núm', 'núm.', 'núm', 'Número', 'número', 'NÚMERO']) + '(?!\\p{L})';
// PA-4-r1: la letra admite el ordinal pegado («0Aª», «00Bª Bis A»); «Nº» sigue siendo el separador, nunca una letra.
const LET = `(?!${H}?(?:NO|No|no)(?!\\p{L}))(?!${H}?[Nn]º)(?:[A-Za-z]{1,2}|${H}[A-Z]{1,2})(?:[ºª])?(?!\\p{L})`;
/** Blanco de una dirección: horizontal o un salto de línea suelto, nunca una línea en blanco (los PDF parten las direcciones; PA-4-r1). */
const HU = `(?:${H}|\\r?\\n(?!${H}*\\r?\\n))`;
/** Cuadrante tras un salto de línea: solo la palabra completa y cerrando el renglón o seguida de signo (no «\nNorte de Santander», ni «\nE-mail»). */
const QUAD_PALABRA = alt(['Sur', 'SUR', 'Norte', 'NORTE', 'Este', 'ESTE', 'Oeste', 'OESTE', 'Occidente', 'OCCIDENTE', 'Oriente', 'ORIENTE'])
  + `(?!\\p{L})(?=${H}*(?:[,;.]|\\r?\\n|$))`;
const BIS = `${H}*(?:BIS|Bis|bis)(?!\\p{L})(?:${H}?[A-Z](?!\\p{L}))?`;
const GEN = `\\d{1,3}(?!\\d)(?:\\.?[ºª])?(?:${LET})?(?!\\p{L})(?:${BIS})?`;
const KWSTOP = alt([...todas(COMP_NUM), ...todas(COMP_NAME), ...COMP_EQ, 'No', 'NO', 'Nº']) + '(?!\\p{L})';
const CONN = '(?:de|del|la|las|los|el|y)';
const NAMEW = "\\p{Lu}(?:[\\p{L}']|[.-](?=\\p{L}))*";
const NAME = `${NAMEW}(?:${H}+(?:${CONN}${H}+){0,2}(?:${NAMEW}|\\d{1,3}(?!\\p{N}))){0,3}`;
const NAME_ADDR = `${NAMEW}(?:${H}+(?:${CONN}${H}+){0,2}(?:(?!${KWSTOP})${NAMEW}|\\d{1,3}(?!\\p{N}))){0,3}`;
const COMP_ITEM = `(?:${alt(todas(COMP_NUM))}(?!\\p{L})\\.?${HU}*(?:(?:No\\.?|#|Nº)${HU}*)?[A-Z0-9]{1,5}(?:-[A-Z0-9]{1,4})?(?![\\p{L}\\p{N}])`
  + `|${alt(todas(COMP_NAME))}(?!\\p{L})${H}+${NAME_ADDR}|${alt(COMP_EQ)}(?!\\p{L}))`;
// COMPS y R-BAR-01 sin cuantificadores de blancos separados por un opcional (PB-2-r5): `B*(?:S B*)?` es el lenguaje de
// `B* S? B*` sin su retroceso cuadrático.
const COMPS = `(?:${HU}*(?:,${HU}*)?${COMP_ITEM})*`;
const ADDR_LABEL = `(?:(?:[Dd]omiciliad[oa]s?|[Rr]esidenciad[oa]s?|[Uu]bicad[oa]s?|[Ss]ituad[oa]s?|[Rr]esidentes?|[Rr]eside|[Vv]ive|[Cc]on${H}+domicilio)${H}+en|(?:[Dd]irecci[oó]n|DIRECCI[OÓ]N|[Dd]omicilio|DOMICILIO)(?:${H}+de${H}+notificaci[oó]n(?:es)?)?${H}*:?)`;
const AVNAMED = alt(['Avenida', 'AVENIDA', 'avenida', 'Av.', 'Av', 'AV.', 'AV', 'Avda.', 'Autopista', 'AUTOPISTA', 'autopista', 'Autop.', 'Vía', 'VÍA', 'vía', 'Variante', 'VARIANTE', 'variante', 'Circunvalar', 'CIRCUNVALAR', 'Troncal', 'TRONCAL', 'Calle', 'CALLE', 'Carrera', 'CARRERA', 'Cl.', 'Cra.']);
// PA-4-r1: el nombre de un barrio admite un salto de línea justo después de un conector o artículo («barrio La⏎Esperanza Ficticia»).
const JN = `(?:${H}+|(?<=(?<![\\p{L}\\p{N}])(?:de|del|la|las|los|el|y|De|Del|La|Las|Los|El))\\r?\\n${H}*)`;
const NAME_BARW = `${NAMEW}(?:${JN}(?:${CONN}${JN}){0,2}(?:${NAMEW}|\\d{1,3}(?!\\p{N}))){0,3}`;
const NAME_BAR = `(?:${NAME_BARW}|\\d{1,2}${H}+del?${H}+\\p{Lu}\\p{L}+)`;

// ---------------------------------------------------------------------------------------------------------------------
// Utilidades de aceptación y de clave (7.4.6)
// ---------------------------------------------------------------------------------------------------------------------
const g = (m: RegExpExecArray, k: string): string => m.groups?.[k] ?? '';
const gOpt = (m: RegExpExecArray, k: string): string | undefined => {
  const v = m.groups?.[k];
  return v === undefined || v === '' ? undefined : v;
};
const span = (m: RegExpExecArray, k: string): [number, number] | undefined => m.indices?.groups?.[k];

const upperName = (s: string): string => deacc(s).toUpperCase().replace(/[^A-Z0-9 ]/gu, ' ').replace(/\s+/gu, ' ').trim();

const QUAD_CANON: Readonly<Record<string, string>> = { SUR: 'S', S: 'S', NORTE: 'N', N: 'N', ESTE: 'E', E: 'E', ORIENTE: 'E', OESTE: 'W', OCCIDENTE: 'W', W: 'W' };
const canonQuad = (q: string): string => QUAD_CANON[deacc(q).trim().toUpperCase()] ?? '';

/** Rótulo de domicilio en los 45 caracteres anteriores (precedencia 4). */
const ADDR_LABEL_BEFORE = new RegExp(`${ADDR_LABEL}${H}+(?:(?:la|el|La|El)${H}+)?$`, 'u');
const hasAddrLabelBefore = (t: string, s: number): boolean => ADDR_LABEL_BEFORE.test(t.slice(Math.max(0, s - 45), s));

const COMP_PARSE = new RegExp(
  `(${alt(todas(COMP_NUM))})(?!\\p{L})\\.?${HU}*(?:(?:No\\.?|#|Nº)${HU}*)?([A-Z0-9]{1,5}(?:-[A-Z0-9]{1,4})?)`
  + `|(${alt(todas(COMP_NAME))})(?!\\p{L})${H}+(${NAME_ADDR})|(${alt(COMP_EQ)})(?!\\p{L})`, 'gu');
function canonComps(s: string): string[] {
  const out: string[] = [];
  if (s === '') return out;
  for (const m of s.matchAll(COMP_PARSE)) {
    const [, num, valor, nom, nombre, eq] = m;
    if (num !== undefined && valor !== undefined) out.push((COMP_CANON.get(claveToken(num)) ?? '') + ' ' + valor.toUpperCase());
    else if (nom !== undefined && nombre !== undefined) out.push((COMP_CANON.get(claveToken(nom)) ?? '') + ' ' + upperName(nombre));
    else if (eq !== undefined) out.push('EQ');
  }
  return out;
}

const GEN_PARSE = /^(\d{1,3})(?:\.?[ºª])?(?:[ \t]?([A-Za-z]{1,2})(?![A-Za-z])[ºª]?)?(?:[ \t]*(?:BIS|Bis|bis)(?:[ \t]?([A-Z]))?)?/u;
/** Número de la vía generadora: letras pegadas en mayúscula, ordinal omitido, `BIS` completo con su letra separada. */
function canonGen(s: string): string {
  const m = GEN_PARSE.exec(s);
  if (m === null) return s.toUpperCase();
  let out = (m[1] ?? '') + (m[2] !== undefined ? m[2].toUpperCase() : '');
  if (/bis/iu.test(s)) out += ' BIS' + (m[3] !== undefined ? ' ' + m[3] : '');
  return out;
}
/** Placa sin ceros a la izquierda. */
const canonPlaca = (s: string): string => String(Number(s));

const SENT_BREAK = /[.\n;]/u;
/** La oración (hasta `.`, `;` o salto de línea) que rodea el tramo. */
function sentenceAround(t: string, s: number, e: number): string {
  let a = s;
  while (a > 0 && !SENT_BREAK.test(t.charAt(a - 1))) a--;
  let b = e;
  while (b < t.length && !SENT_BREAK.test(t.charAt(b))) b++;
  return t.slice(a, b);
}
const GEOMETRIA = /matriz|matrices|v[ée]rtice|tri[áa]ngulo|pol[íi]gono|geometr/iu;

// ---------------------------------------------------------------------------------------------------------------------
// R-DIR-01 · Dirección urbana completa
// ---------------------------------------------------------------------------------------------------------------------
// PA-4-r1: con separador, un salto de línea suelto vale como blanco (`HU`); sin separador (ramas 2 y 3) solo blancos horizontales.
const SRC_DIR01 = `${LB}(?<via>${VIA})(?!\\p{L})${HU}*(?<num>\\d{1,3})(?!\\d)(?:\\.?[ºª])?(?<let>${LET})?(?<bis>${BIS})?(?:${H}+(?<q1>${QUAD}))?`
  + `(?:${HU}*(?<l>${SEP})${HU}*(?<gen>${GEN})(?:${HU}*-${HU}*|${HU}+)(?<pl>\\d{1,3})(?!\\d)`
  + `|${H}+(?<gen2>${GEN})${H}*-${H}*(?<pl2>\\d{1,3})(?!\\d)`
  + `|${H}+(?<gen3>${GEN})${H}+(?<pl3>\\d{1,3})(?!\\d))`
  + `(?:${H}+(?<q2>${QUAD})|${H}*\\r?\\n${H}*(?<q3>${QUAD_PALABRA}))?(?<comp>${COMPS})`;
/** Versión pegajosa de R-DIR-01 (la usa R-DIR-03 para ceder ante una dirección completa). */
const RE_DIR01_PEGAJOSA = new RegExp(SRC_DIR01, 'uy');

function assessDir01(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const t = ctx.view.text;
  const via = g(m, 'via');
  const sep = gOpt(m, 'l');
  if (/^[CKDT]$/u.test(via) && sep === undefined) return null;                    // letra suelta sin separador
  const rama = gOpt(m, 'gen') !== undefined ? 1 : gOpt(m, 'gen2') !== undefined ? 2 : 3;
  if (rama === 3 && !STD_CODES.has(via)) return null;                               // sin separador ni guion: solo el código estándar en MAYÚSCULAS
  const code = canonVia(via);
  if ((code === 'DG' || code === 'TV') && GEOMETRIA.test(sentenceAround(t, m.index, m.index + m[0].length))) return null;
  let confidence: Confidence = sep !== undefined ? 'alta' : 'media';
  if (sep === undefined && /^[a-záéíóú]{4,}$/u.test(via)) confidence = 'baja';
  if (hasAddrLabelBefore(t, m.index)) confidence = 'alta';
  const letra = gOpt(m, 'let');
  const letCuadrante = letra !== undefined && /^[ \t][SNW]$/u.test(letra) && gOpt(m, 'q1') === undefined && gOpt(m, 'q2') === undefined && gOpt(m, 'q3') === undefined ? letra.trim() : null;
  const quads = [...new Set([gOpt(m, 'q1'), gOpt(m, 'q2'), gOpt(m, 'q3'), letCuadrante ?? undefined].filter((x): x is string => x !== undefined).map(canonQuad))];
  let numPart = g(m, 'num') + (letra !== undefined && letCuadrante === null ? letra.replace(/[ \tºª]/gu, '').toUpperCase() : '');
  const bis = gOpt(m, 'bis');
  if (bis !== undefined) {
    const b = /(?:BIS|Bis|bis)(?:[ \t]?([A-Z]))?/u.exec(bis);
    numPart += ' BIS' + (b?.[1] !== undefined ? ' ' + b[1] : '');
  }
  const generadora = gOpt(m, 'gen') ?? gOpt(m, 'gen2') ?? g(m, 'gen3');
  const placa = gOpt(m, 'pl') ?? gOpt(m, 'pl2') ?? g(m, 'pl3');
  const key = ['DIR:' + code, numPart, canonGen(generadora), canonPlaca(placa), ...quads, ...canonComps(g(m, 'comp'))].join(' ');
  const v: RuleVerdict = { confidence, canonicalKey: key };
  if (sep !== undefined) v.labelId = 'ROT_DIR_1';
  return v;
}
const rDIR01: RuleSpec = { id: 'R-DIR-01', type: 'DIRECCION', flags: 'dgu', source: SRC_DIR01, assess: assessDir01 };

// ---------------------------------------------------------------------------------------------------------------------
// R-DIR-02 · Avenida o vía con nombre propio y placa
// ---------------------------------------------------------------------------------------------------------------------
const SRC_DIR02 = `${LB}(?<via>${AVNAMED})(?!\\p{L})${H}+(?<name>(?:(?:de|del|DE|DEL)(?:${H}+(?:la|las|los|el|LA|LAS|LOS|EL))?${H}+)?${NAME_ADDR})`
  // PA-4-r1: entre el nombre y el separador cabe el número de la vía («Av. Ficticia 00B Bis No. 00-00»), `vn`.
  + `(?:(?:${H}+(?<vn>${GEN}))?${H}*(?<l>${SEP})${H}*(?<gen>${GEN})(?:${H}*-${H}*|${H}+)(?<pl>\\d{1,3})|${H}*(?<gen2>${GEN})${H}*-${H}*(?<pl2>\\d{1,3}))(?!\\d)`
  + `(?:${H}+(?<q2>${QUAD}))?(?<comp>${COMPS})`;

function assessDir02(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const t = ctx.view.text;
  const name = g(m, 'name');
  if (/^\d/u.test(name)) return null;
  const via = g(m, 'via');
  const cv = canonVia(via);
  const code = cv === 'CL' || cv === 'KR' ? cv : /^(?:av|avenida|avda)/iu.test(deacc(via)) ? 'AV' : /^aut/iu.test(via) ? 'AU' : upperName(via).replace(/ /gu, '');
  const sep = gOpt(m, 'l');
  let confidence: Confidence = sep !== undefined ? 'alta' : 'media';
  if (hasAddrLabelBefore(t, m.index)) confidence = 'alta';
  const q2 = gOpt(m, 'q2');
  const quads = q2 !== undefined ? [canonQuad(q2)] : [];
  const generadora = gOpt(m, 'gen') ?? g(m, 'gen2');
  const placa = gOpt(m, 'pl') ?? g(m, 'pl2');
  const vn = gOpt(m, 'vn');
  const key = ['DIR:' + code, upperName(name), ...(vn !== undefined ? [canonGen(vn)] : []), canonGen(generadora), canonPlaca(placa), ...quads, ...canonComps(g(m, 'comp'))].join(' ');
  const v: RuleVerdict = { confidence, canonicalKey: key };
  if (sep !== undefined) v.labelId = 'ROT_DIR_1';
  return v;
}
const rDIR02: RuleSpec = { id: 'R-DIR-02', type: 'DIRECCION', flags: 'dgu', source: SRC_DIR02, assess: assessDir02 };

// ---------------------------------------------------------------------------------------------------------------------
// R-DIR-03 · Dirección parcial con rótulo de domicilio
// ---------------------------------------------------------------------------------------------------------------------
const SRC_DIR03 = `${LB}(?<l>${ADDR_LABEL})${H}+(?:(?:la|el|La|El)${H}+)?(?<dir>(?<via>${VIA_NOSINGLE})(?!\\p{L})${H}*(?<num>\\d{1,3})(?!\\d)(?:\\.?[ºª])?(?<let>${LET})?(?<bis>${BIS})?(?:${H}+(?<q1>${QUAD}))?)(?!${H}*(?:${SEP}|\\d|-))`;

function assessDir03(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | null {
  const t = ctx.view.text;
  const dir = span(m, 'dir');
  if (dir === undefined) return null;
  RE_DIR01_PEGAJOSA.lastIndex = dir[0];
  const completa = RE_DIR01_PEGAJOSA.test(t);
  RE_DIR01_PEGAJOSA.lastIndex = 0;
  if (completa) return null;                                                            // dirección completa: la cubre R-DIR-01
  const letra = gOpt(m, 'let');
  const num = g(m, 'num') + (letra !== undefined ? letra.replace(/[ \t]/gu, '').toUpperCase() : '') + (gOpt(m, 'bis') !== undefined ? ' BIS' : '');
  const q1 = gOpt(m, 'q1');
  const key = ['DIR:' + canonVia(g(m, 'via')), num, ...(q1 !== undefined ? [canonQuad(q1)] : [])].join(' ');
  return { nStart: dir[0], nEnd: dir[1], confidence: 'baja', canonicalKey: key, labelId: 'ROT_DIR_2' };
}
const rDIR03: RuleSpec = { id: 'R-DIR-03', type: 'DIRECCION', flags: 'dgu', source: SRC_DIR03, assess: assessDir03 };

// ---------------------------------------------------------------------------------------------------------------------
// R-DIR-04 · Predio rural rotulado (el tramo es solo el nombre)
// ---------------------------------------------------------------------------------------------------------------------
const PREDIO_KW = v3(['finca', 'hacienda', 'predio rural', 'predio', 'parcela', 'granja', 'lote de terreno', 'lote']);
const PREDIO_EXCL: ReadonlySet<string> = new Set(['publica', 'nacional', 'municipal', 'departamental', 'distrital', 'nacion', 'raiz']);
const SRC_DIR04 = `${LB}(?<l>${alt(PREDIO_KW)})(?!\\p{L})(?:${H}+(?:denominad[oa]|llamad[oa]|conocid[oa]${H}+como))?(?:${H}*:${H}*|${H}+)[«"“]?(?<name>${NAME})`;

function assessDir04(m: RegExpExecArray): RuleVerdict | null {
  const nm = span(m, 'name');
  if (nm === undefined) return null;
  const name = g(m, 'name');
  const primera = vistaLista(name.split(/[ \t]+/u)[0] ?? '');
  if (PREDIO_EXCL.has(primera)) return null;
  const lab = g(m, 'l');
  const confidence: Confidence = vistaLista(lab).startsWith('lote') ? 'media' : 'alta';
  return {
    nStart: nm[0], nEnd: nm[1], confidence, labelId: 'ROT_DIR_3',
    canonicalKey: 'DIR:' + upperName(lab.replace(/ de terreno/iu, '')) + ' ' + upperName(name),
  };
}
const rDIR04: RuleSpec = { id: 'R-DIR-04', type: 'DIRECCION', flags: 'dgu', source: SRC_DIR04, assess: assessDir04 };

// ---------------------------------------------------------------------------------------------------------------------
// R-DIR-05 · Vereda, corregimiento y similares (el tramo es solo el nombre)
// ---------------------------------------------------------------------------------------------------------------------
const VEREDA_KW = v3(['vereda', 'corregimiento', 'inspección de policía', 'caserío', 'centro poblado', 'resguardo indígena', 'resguardo']);
const SRC_DIR05 = `${LB}(?<l>${alt(VEREDA_KW)})(?!\\p{L})(?:${H}*:${H}*|${H}+)(?:(?:de${H}+la|de${H}+los|de${H}+las|de|del)${H}+)?[«"“]?(?<name>${NAME})`;

function assessDir05(m: RegExpExecArray): RuleVerdict | null {
  const nm = span(m, 'name');
  if (nm === undefined) return null;
  // PA-4-r1: el tramo arranca en el rótulo («vereda La Ficticia»), como lo anota el gold; el rótulo sigue en `LabelHit`.
  return {
    nStart: m.index, nEnd: nm[1], confidence: 'alta', labelId: 'ROT_DIR_4',
    canonicalKey: 'DIR:' + upperName(g(m, 'l')) + ' ' + upperName(g(m, 'name')),
  };
}
const rDIR05: RuleSpec = { id: 'R-DIR-05', type: 'DIRECCION', flags: 'dgu', source: SRC_DIR05, assess: assessDir05 };

// ---------------------------------------------------------------------------------------------------------------------
// R-DIR-06 · Kilómetro sobre una vía nombrada
// ---------------------------------------------------------------------------------------------------------------------
const SRC_DIR06 = `${LB}(?<l>${alt(['Kilómetro', 'KILÓMETRO', 'kilómetro', 'Kilometro', 'kilometro', 'KILOMETRO', 'Km.', 'Km', 'KM.', 'KM', 'km.', 'km'])})(?!\\p{L})${H}*(?<n>\\d{1,3}(?:${H}*\\+${H}*\\d{1,3}|[.,]\\d{1,3})?)${H}+`
  + `(?:(?:de|sobre|en)${H}+la${H}+|de${H}+)?(?<vk>${alt(v3(['vía', 'via', 'carretera', 'autopista', 'troncal']))})(?!\\p{L})${H}+(?:(?:que${H}+conduce|que${H}+va)${H}+)?(?:(?:a|al|de|del|hacia)${H}+)?`
  + `(?<name>${NAME}(?:${H}*-${H}*${NAME}|${H}+(?:a|al)${H}+${NAME})?)`;

function assessDir06(m: RegExpExecArray): RuleVerdict {
  const n = g(m, 'n').replace(/[ \t]/gu, '').replace(',', '.');
  return { confidence: 'alta', labelId: 'ROT_DIR_5', canonicalKey: `DIR:KM ${n} VIA ${upperName(g(m, 'name'))}` };
}
const rDIR06: RuleSpec = { id: 'R-DIR-06', type: 'DIRECCION', flags: 'dgu', source: SRC_DIR06, assess: assessDir06 };

// ---------------------------------------------------------------------------------------------------------------------
// R-BAR-01 · Barrio rotulado (el tramo es solo el nombre)
// ---------------------------------------------------------------------------------------------------------------------
const BARRIO_KW = ['barrio', 'Barrio', 'BARRIO', 'B/', 'Bº', 'urbanización', 'Urbanización', 'URBANIZACIÓN', 'urbanizacion', 'Urbanizacion', 'Urb.', 'URB.',
  'conjunto residencial', 'Conjunto Residencial', 'CONJUNTO RESIDENCIAL', 'Conj. Res.', 'ciudadela', 'Ciudadela', 'CIUDADELA', 'condominio', 'Condominio', 'CONDOMINIO'];
const SRC_BAR01 = `(?<![\\p{L}\\p{N}])(?<l>${alt(BARRIO_KW)})(?:(?<=[/º])|(?!\\p{L}))${H}*(?::${H}*)?(?:(?:de|del)${H}+)?[«"“]?(?<name>${NAME_BAR})`;

// PA-4-r1: «barrio La Prueba de Facatativá»: el «de <municipio>» final no es del nombre del barrio (lo toma R-MUN-03 como ancla).
const MUN_ALIAS: readonly string[] = ['bogota', 'bogota d.c.', 'cali', 'cucuta', 'cartagena', 'ubate', 'mompox', 'mompos', 'tumaco', 'buga', 'mariquita', 'tolu'];
let munSet: ReadonlySet<string> | null = null;
function esMunicipio(nombre: string): boolean {
  munSet ??= new Set([...(divipolaRaw as DivipolaFile).map((r) => vistaLista(r.munNombre)), ...MUN_ALIAS]);
  return munSet.has(vistaLista(nombre));
}
const DE_MUN = /(?<![\p{L}\p{N}])(?:de|del|De|Del)[ \t\r\n]+/gu;
/** Largo del nombre sin el «de <municipio>» del final; el nombre entero si no lo tiene. */
function largoSinMunicipio(name: string): number {
  for (const c of name.matchAll(DE_MUN)) {
    if (c.index === 0) continue;
    const resto = name.slice(c.index + c[0].length);
    if (esMunicipio(resto) || esMunicipio(resto.replace(/[ \t,]*D\.?[ \t]?C\.?$/u, ''))) return name.slice(0, c.index).trimEnd().length;
  }
  return name.length;
}

function assessBar01(m: RegExpExecArray): RuleVerdict | null {
  const nm = span(m, 'name');
  if (nm === undefined) return null;
  const name = g(m, 'name');
  const largo = largoSinMunicipio(name);
  return { nStart: nm[0], nEnd: nm[0] + largo, confidence: 'alta', labelId: 'ROT_BAR_1', canonicalKey: 'BARRIO:' + vistaLista(name.slice(0, largo)) };
}
const rBAR01: RuleSpec = { id: 'R-BAR-01', type: 'BARRIO', flags: 'dgu', source: SRC_BAR01, assess: assessBar01 };

/**
 * Finales (en la vista `reglas`) de los barrios rotulados, sin el «de <municipio>» final: los usa R-MUN-03 como ancla de «barrio X
 * de Facatativá» y «barrio X, Soacha» (generalize.ts). No guarda el texto.
 */
export function finalesDeBarrio(texto: string): number[] {
  const out: number[] = [];
  const re = new RegExp(SRC_BAR01, 'dgu');
  for (let m = re.exec(texto); m !== null; m = re.exec(texto)) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    const nm = span(m, 'name');
    if (nm !== undefined) out.push(nm[0] + largoSinMunicipio(g(m, 'name')));
  }
  return out;
}

export const rules: RuleSpec[] = [rDIR01, rDIR02, rDIR03, rDIR04, rDIR05, rDIR06, rBAR01];
