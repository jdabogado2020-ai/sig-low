// Precedencia y resolución de solapamientos (plan 6.2.4, 6.4.2 y 7.11). PB-2.
// Función pura y determinista: sin estado global mutable, sin reloj, sin azar, sin DOM ni red.
// Tipos: src/core/types.ts (sección 6).
import type {
  CaseEntityId, Confidence, DataType, DetectableType, DetectionCandidate, DetectionSource, MergedCandidate,
  NerLabel, Part, PartKind, RuleRegistry,
} from './types.ts';
import { FLAG_TYPES, ORG_CLASSES } from './types.ts';
import { buildSearchView, toCanonicalSpan } from './normalize.ts';
import { esVarianteDebil, orgKey, personKey, precedenceOf } from './entities.ts';
import { LST } from './caselist.ts';

export { precedenceOf };


// ---------------------------------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------------------------------

/** 7.11.3 · Orden fijo de tipos (solo para empates totales). */
const TYPE_ORDER: readonly DetectableType[] = [
  'RADICADO', 'RADICADO_ADMIN', 'TARJETA', 'CUENTA', 'NIT', 'CC', 'TI', 'CE', 'PPT', 'PEP', 'PASAPORTE', 'TP',
  'DOCUMENTO', 'HC', 'AFILIACION', 'MATRICULA', 'PLACA', 'TELEFONO', 'CORREO', 'DIRECCION', 'BARRIO', 'VALOR',
  'FECHA', 'PERSONA', 'EMPRESA', 'EPS', 'IPS', 'ENTIDAD', 'PROVEEDOR', 'MUNICIPIO', 'DEPARTAMENTO', 'LUGAR',
];
const TYPE_RANK: ReadonlyMap<DataType, number> = new Map(TYPE_ORDER.map((t, i) => [t, i]));
const SOURCE_RANK: Readonly<Record<DetectionSource, number>> = { manual: 0, lista: 1, regla: 2, modelo: 3 };
const CONF_RANK: Readonly<Record<Confidence, number>> = { alta: 3, media: 2, baja: 1 };
/** 6.2.4 · Puntaje nominal de las fuentes que no son el modelo. */
const NOMINAL: Readonly<Record<Confidence, number>> = { alta: 0.9, media: 0.6, baja: 0.3 };
const FLAG_SET: ReadonlySet<DataType> = new Set(FLAG_TYPES);
const ORG_SET: ReadonlySet<DataType> = new Set(ORG_CLASSES);
/** 7.11.1 paso 4b: tipos cuyos dígitos quedan como pista de titular al ser absorbidos por un NIT. */
const HOLDER_ABSORBED: ReadonlySet<DataType> = new Set(['CC', 'TI', 'CE']);
/** 6.6.1 · Prefijo de la clave por tipo (para la clave de fragmento `<PREFIJO>:~<vista lista>`). */
const KEY_PREFIX: Partial<Readonly<Record<DetectableType, string>>> = {
  PERSONA: 'PER', EMPRESA: 'ORG', EPS: 'ORG', IPS: 'ORG', ENTIDAD: 'ORG', PROVEEDOR: 'ORG',
  RADICADO: 'RAD', RADICADO_ADMIN: 'RAD', TELEFONO: 'TEL', DIRECCION: 'DIR', MATRICULA: 'MAT',
  AFILIACION: 'AFIL', TARJETA: 'CUENTA', MUNICIPIO: 'DEP', DEPARTAMENTO: 'DEP',
};

/** R-MOD-03 · Palabras de función y tratamientos (vista `lista`). */
const FW = 'de|del|la|las|los|el|lo|y|e|o|u|a|al|en|por|para|con|sin|su|sus|que|se|un|una|unos|unas|senorita|senora|senor|srta|sra|sr|dona|don|doctora|doctor|dra|dr|mrs|mr|ms';
const FW_SET: ReadonlySet<string> = new Set(FW.split('|'));
/** Las palabras de función y tratamientos de R-MOD-03 (vista `lista`), para el mapeo 7.10.8 de pipeline.ts. */
export const PALABRAS_DE_FUNCION: ReadonlySet<string> = FW_SET;
/**
 * Izquierda y Derecha de R-MOD-03 sin el `+` interno de 7.10.7 (P0-6a M-1): `(?:[sep]+|FW)+$` sin ancla
 * al inicio retrocede de forma exponencial con signos sueltos separados por blancos. `(?:[sep]|FW)+`
 * acepta el mismo lenguaje y da el mismo índice; cada signo es una vuelta y un FW solo empieza tras un
 * signo o en el borde, así que no hay dos formas de partir la misma cadena. Exportadas para las pruebas.
 */
export const RE_TRIM_LEFT = new RegExp(String.raw`^(?:[\s\p{P}\p{S}]|(?:` + FW + String.raw`)(?=[\s\p{P}\p{S}]|$))+`, 'u');
export const RE_TRIM_RIGHT = new RegExp(String.raw`(?:[\s\p{P}\p{S}]|(?<=^|[\s\p{P}\p{S}])(?:` + FW + String.raw`))+$`, 'u');
/**
 * D-03 A (7.10.7): sufijo societario de R-LST-05 (vista `lista`) entre fronteras de palabra. El recorte derecho no entra en él
 * cuando es el final del nombre: la «a» de «S.A.» es palabra de función y el punto final, un signo. Sin cuantificadores anidados.
 */
const RE_SUFIJO_SOCIETARIO = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:` + LST.SUFIJO + String.raw`)(?![\p{L}\p{N}])`, 'gu');
/** Largo máximo de un sufijo de R-LST-05 («sociedad por acciones simplificada», 34) con holgura: acota dónde se busca. */
const SUFIJO_MAX = 48;
/** Paso 2: lo que el modelo agrega no puede ser palabra de función ni tratamiento (R-MOD-03 y R-LST-03). */
const NAME_STOP: ReadonlySet<string> = new Set([...FW_SET, 'ingeniera', 'ingeniero', 'ing', 'abogada', 'abogado', 'abg',
  'licenciada', 'licenciado', 'lic', 'magistrada', 'magistrado', 'jueza', 'juez', 'profesora', 'profesor', 'prof']);
const HYPHENS = '\\-\u2010\u2011';
const RE_NOT_NAME_CHAR = new RegExp(`[^\\p{L}\\p{M}\\s${HYPHENS}]`, 'u');
const RE_NAME_SPLIT = new RegExp(`[\\s${HYPHENS}]+`, 'u');
const RE_UPPER_INITIAL = /^\p{Lu}/u;
const RE_WORD_SPLIT = /[\s\p{P}\p{S}]+/u;
const RE_EDGE_LEFT = /^[\s\p{P}\p{S}]*/u;
const RE_EDGE_CHAR = /^[\s\p{P}\p{S}]$/u;
const RE_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
/** B-55 · Letra (o marca combinante) a un lado del borde de un resto: el corte cayó dentro de una palabra. */
const RE_LETTER_ONLY = /[\p{L}\p{M}]/u;

/**
 * D-06 decisión 5 (7.11.1, corrección del 31-oct) · Tipos de las reglas estructurales que absorben una detección de la lista de
 * una sola palabra que queda estrictamente dentro: CORREO, DIRECCION, BARRIO, RADICADO y RADICADO_ADMIN. Además, el NIT con DV
 * y las rotuladas (`esEstructural`).
 */
const ESTRUCTURALES: ReadonlySet<DataType> = new Set<DataType>(['CORREO', 'DIRECCION', 'BARRIO', 'RADICADO', 'RADICADO_ADMIN']);
/** D-06 + PF-3-r1 · Un sufijo societario de R-LST-05 con punto interno al que le falta el punto final («s.a», «s. en c»). */
const RE_SUFIJO_SIN_PUNTO = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:` + LST.SUFIJO + String.raw`)$`, 'u');
const RE_ABREVIATURA_ABIERTA = /\.[ ]?(?:[\p{L}]+[ ]?)?\p{L}$/u;

/** R-MRG-01 · Unión por paréntesis (vista `reglas`). */
const RE_HUECO = /^[ \t]{0,2}\([ \t]{0,2}$/u;
const RE_CIERRE = /^[ \t]{0,2}\)/u;
const CIERRE_WINDOW = 256;

/** Vista `lista` (7.1.3) de un tramo. */
const fold = (s: string, kind: PartKind): string => buildSearchView(s, 'lista', kind).text;

// ---------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------

const isHigh = (u: number): boolean => u >= 0xd800 && u <= 0xdbff;
const isLow = (u: number): boolean => u >= 0xdc00 && u <= 0xdfff;
/** 6.1.3: un límite dentro de un par sustituto se amplía al punto de código completo. */
function widenStart(t: string, i: number): number {
  return i > 0 && i < t.length && isLow(t.charCodeAt(i)) && isHigh(t.charCodeAt(i - 1)) ? i - 1 : i;
}
function widenEnd(t: string, i: number): number {
  return i > 0 && i < t.length && isLow(t.charCodeAt(i)) && isHigh(t.charCodeAt(i - 1)) ? i + 1 : i;
}
/**
 * Largo (en unidades UTF-16) del sufijo de blancos, signos y símbolos: lo mismo que `/[\s\p{P}\p{S}]*$/u`, pero
 * recorriendo desde el final por puntos de código, en tiempo lineal (P0-6a, PB-2-r2). La expresión sin ancla al
 * inicio probaba cada posición de una serie larga de blancos seguida de un carácter que no es borde (cuadrática:
 * 30.000 blancos, ≈ 1,6 s). Un sustituto suelto no es borde, como en la expresión. Exportada para las pruebas.
 */
export function edgeRightLength(s: string): number {
  let i = s.length;
  while (i > 0) {
    const j = i >= 2 && isLow(s.charCodeAt(i - 1)) && isHigh(s.charCodeAt(i - 2)) ? i - 2 : i - 1;
    if (!RE_EDGE_CHAR.test(s.slice(j, i))) break;
    i = j;
  }
  return s.length - i;
}
const cmpStr = (a: string | undefined, b: string | undefined): number => {
  const x = a ?? ''; const y = b ?? '';
  return x < y ? -1 : x > y ? 1 : 0;
};
const overlaps = (a: { start: number; end: number }, s: number, e: number): boolean => a.start < e && s < a.end;
const countDigits = (s: string): number => (s.match(/[0-9]/gu) ?? []).length;

/** Desempates finales, después de los cinco criterios de 7.11.1 paso 3: hacen el orden total. */
function tieBreak(a: MergedCandidate, b: MergedCandidate): number {
  return CONF_RANK[b.confidence] - CONF_RANK[a.confidence] || b.score - a.score
    || cmpStr(a.canonicalKey, b.canonicalKey) || cmpStr(a.ruleId, b.ruleId) || cmpStr(a.caseEntityId, b.caseEntityId)
    || cmpStr(a.role, b.role) || cmpStr(a.nerLabel, b.nerLabel) || cmpStr(a.variantClass, b.variantClass);
}
/** 7.11.1 paso 3: precedencia ↑, longitud ↓, inicio ↑, orden fijo de tipos, fuente. */
function byPriority(a: MergedCandidate, b: MergedCandidate): number {
  return a.precedence - b.precedence || (b.end - b.start) - (a.end - a.start) || a.start - b.start
    || (TYPE_RANK.get(a.type) ?? TYPE_ORDER.length) - (TYPE_RANK.get(b.type) ?? TYPE_ORDER.length)
    || SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || tieBreak(a, b);
}
function byPosition(a: MergedCandidate, b: MergedCandidate): number {
  return a.start - b.start || a.end - b.end || byPriority(a, b);
}

function finish(w: MergedCandidate, text: string): MergedCandidate {
  w.start = widenStart(text, w.start);
  w.end = widenEnd(text, w.end);
  w.precedence = precedenceOf(w);
  return w;
}
function withoutValidator(c: MergedCandidate): MergedCandidate {
  const copy: MergedCandidate = { ...c };
  delete copy.validator;
  return copy;
}

/** Clave de un remanente del modelo (6.6.1, 7.12.1), con las funciones de clave de entities.ts. */
function remainderKeyFromModel(c: MergedCandidate, s: string, kind: PartKind): string {
  if (c.type === 'PERSONA') return personKey(s, kind);
  if (ORG_SET.has(c.type)) return orgKey(s, kind);
  if (c.type === 'LUGAR') return 'LUGAR:' + fold(s, kind).trim();
  return c.canonicalKey;
}

// ---------------------------------------------------------------------------------------------
// 7.11.2 · Remanentes
// ---------------------------------------------------------------------------------------------

/**
 * R-MOD-03 sobre la vista `lista` del tramo; devuelve posiciones relativas al tramo o null si queda vacío. Exportada: es el
 * mismo recorte del paso (2) de 7.10.7 en pipeline.ts (una sola copia de la expresión, sin el `+` anidado de M-1).
 */
export function trimFunctionWords(s: string, kind: PartKind): { start: number; end: number } | null {
  const v = buildSearchView(s, 'lista', kind);
  const l = RE_TRIM_LEFT.exec(v.text);
  const ns = l === null ? 0 : l[0].length;
  const r = RE_TRIM_RIGHT.exec(v.text.slice(ns));
  let ne = v.text.length - (r === null ? 0 : r[0].length);
  if (ne <= ns) return null;
  if (r !== null) ne = finDeSufijo(v.text, ns, ne);
  return toCanonicalSpan(v, ns, ne);
}

/**
 * D-03 A · Si un sufijo societario empieza dentro de lo conservado [ns, ne), después de la primera palabra, y el recorte derecho
 * lo cortó, devuelve su fin (todo lo que sigue ya era recortable: signos, blancos o palabras de función); si no, `ne`.
 * «comercial ejemplo s.a.» → el recorte deja «comercial ejemplo s» y esto devuelve el fin de «s.a.». Tiempo lineal.
 */
function finDeSufijo(t: string, ns: number, ne: number): number {
  const re = new RegExp(RE_SUFIJO_SOCIETARIO.source, RE_SUFIJO_SOCIETARIO.flags);
  re.lastIndex = Math.max(ns + 1, ne - SUFIJO_MAX);
  let fin = ne;
  for (let m = re.exec(t); m !== null && m.index < ne; m = re.exec(t)) {
    fin = Math.max(fin, m.index + m[0].length);
    if (m[0].length === 0) re.lastIndex = m.index + 1;
  }
  return fin;
}

/**
 * 7.11.2 · Resuelve el remanente [start, end) de un candidato partido: modelo → recorte R-MOD-03;
 * regla → `rules.rerun` o fragmento (≥ 3 dígitos); lista y manual → se descarta (pasada 3, 7.13.5).
 * Exportada para la pasada 3 de residuos (7.13.5, PB-4). Devuelve un candidato nuevo o null.
 */
export function resolveRemainder(part: Part, c: DetectionCandidate | MergedCandidate, start: number, end: number,
  rules: RuleRegistry): MergedCandidate | null {
  const text = part.text;
  const s0 = Math.max(0, Math.min(text.length, start));
  const e0 = Math.max(s0, Math.min(text.length, end));
  if (e0 <= s0) return null;
  const base: MergedCandidate = { ...c, precedence: precedenceOf(c) };
  const piece = text.slice(s0, e0);
  switch (base.source) {
    case 'modelo': {
      const t = trimFunctionWords(piece, part.kind);
      if (t === null) return null;
      const ns = s0 + t.start; const ne = s0 + t.end;
      const sub = text.slice(ns, ne);
      // B-55 (PB-4-r1, 7.11.2) · Un resto que continúa una palabra cortada (letra a los dos lados del borde: la detección del usuario
      // «Ficticia Gó» dentro de «Gómez») es la cola de una palabra que el modelo vio entera: no se le exige mayúscula inicial ni largo.
      const corta = (ns === s0 && s0 > 0 && RE_LETTER_ONLY.test(text.charAt(s0 - 1)) && RE_LETTER_ONLY.test(text.charAt(s0)))
        || (ne === e0 && e0 < text.length && RE_LETTER_ONLY.test(text.charAt(e0 - 1)) && RE_LETTER_ONLY.test(text.charAt(e0)));
      if ([...sub].length < 2 && !corta) return null;
      const named = corta || sub.split(RE_WORD_SPLIT).some((w) => RE_UPPER_INITIAL.test(w) && !FW_SET.has(fold(w, part.kind)));
      if (!named) return null;
      return finish({ ...base, start: ns, end: ne, confidence: 'baja', canonicalKey: remainderKeyFromModel(base, sub, part.kind) }, text);
    }
    case 'regla': {
      const found = base.ruleId === undefined ? null : rules.rerun(base.ruleId, piece);
      if (found !== null && Number.isInteger(found.start) && Number.isInteger(found.end)
        && found.start >= 0 && found.end <= piece.length && found.start < found.end) {
        const w = withoutValidator({ ...base, start: s0 + found.start, end: s0 + found.end, canonicalKey: found.canonicalKey });
        delete w.fragment;
        return finish(w, text);
      }
      if (countDigits(piece) >= 3) {
        // Sin blancos ni signos en los bordes; los dígitos nunca se recortan.
        const lead = (RE_EDGE_LEFT.exec(piece) as RegExpExecArray)[0].length;
        const trail = edgeRightLength(piece.slice(lead));
        const ns = s0 + lead; const ne = e0 - trail;
        const core = text.slice(ns, ne);
        const prefix = KEY_PREFIX[base.type as DetectableType] ?? base.type;
        const w = withoutValidator({ ...base, start: ns, end: ne, confidence: 'baja', score: NOMINAL.baja,
          canonicalKey: `${prefix}:~${fold(core, part.kind).trim()}`, fragment: true });
        return finish(w, text);
      }
      return null;
    }
    case 'lista':
    case 'manual':
      return null;
  }
}

/** Partes de [c.start, c.end) que no cubre ningún aceptado. */
function uncovered(c: MergedCandidate, over: readonly MergedCandidate[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let cur = c.start;
  for (const a of [...over].sort((x, y) => x.start - y.start || x.end - y.end)) {
    if (a.start > cur) out.push([cur, Math.min(a.start, c.end)]);
    cur = Math.max(cur, a.end);
    if (cur >= c.end) break;
  }
  if (cur < c.end) out.push([cur, c.end]);
  return out.filter(([s, e]) => e > s);
}

/**
 * D-03 A con el punto que sigue al tramo (hallazgo de PF-3-r1, pedido del integrador en PB-2-r6) · Si el tramo ORG [start, end)
 * termina en un sufijo societario de R-LST-05 escrito con puntos al que le falta el punto final («Comercial Ejemplo S.A») y el
 * carácter que sigue en el texto es ese punto, devuelve `end + 1`: el tramo se extiende sobre el punto que completa la abreviatura.
 * Nunca toma el punto de la oración tras un sufijo ya completo: sin punto interno («SAS», «Ltda», «Cía») o ya cerrado («S.A.»),
 * devuelve `end`. El modelo deja ese punto fuera porque lo separa como palabra aparte, y el recorte de D-03 A no lo ve porque
 * trabaja sobre el texto del tramo. Tiempo constante: mira como mucho `SUFIJO_MAX` caracteres antes del final.
 */
export function completarSufijoSocietario(text: string, start: number, end: number, kind: PartKind): number {
  if (end <= start || end >= text.length || text[end] !== '.') return end;
  const cola = fold(text.slice(Math.max(start, end - SUFIJO_MAX), end), kind);
  const m = RE_SUFIJO_SIN_PUNTO.exec(cola);
  return m !== null && m.index > 0 && RE_ABREVIATURA_ABIERTA.test(m[0]) ? end + 1 : end;
}

// ---------------------------------------------------------------------------------------------
// 7.11.1 pasos 1 y 2
// ---------------------------------------------------------------------------------------------

/**
 * D-06 decisión 5 · ¿El candidato es de una regla estructural? CORREO, DIRECCION, BARRIO, RADICADO, RADICADO_ADMIN, el NIT con DV
 * (validador `DV_NIT`, pase o no: el DV está escrito) y las rotuladas (con rótulo, 6.2.4).
 */
function esEstructural(c: MergedCandidate): boolean {
  return c.source === 'regla' && (ESTRUCTURALES.has(c.type) || (c.type === 'NIT' && c.validator?.name === 'DV_NIT') || c.label !== undefined);
}

/**
 * D-06 decisión 5 · ¿Es una detección de la lista de una sola palabra? Una variante débil (`apellido_suelto` o `nombre_suelto`,
 * que siempre lo es) o cualquier coincidencia de la lista sin blancos en el texto: la razón social sin sufijo que la vista `lista`
 * encuentra dentro del dominio de un correo («…@vida-y-salud-ejemplo-eps.test») es una sola palabra del texto (ver la reapertura
 * -r6 de PB-2: así se presentan las 25 menciones de CORREO perdidas en desarrollo).
 */
function esDeUnaPalabra(c: MergedCandidate, text: string): boolean {
  return c.source === 'lista' && !/\s/u.test(text.slice(c.start, c.end).trim());
}

/**
 * D-06 decisión 5 (7.11.1, corrección del 31-oct) · Una detección de la lista de una sola palabra que queda estrictamente dentro de
 * una de regla estructural se absorbe en ella, como en el paso 4b con la regla delante: «Ejemplo» (apellido suelto de una persona
 * de la lista) dentro de «barrio Altos del Ejemplo», o la razón social dentro del dominio de un correo, ya no parte la regla, y
 * todo el tramo queda reemplazado con el marcador de la regla. Una detección de la lista más larga o igual a la regla, o de varias
 * palabras, conserva su precedencia (2). En la fusión por ventana se aplica a los candidatos nuevos; lo ya fusionado no cambia.
 *
 * B-61 (PB-2-r7): la absorción se decide al colocar, en el paso 4b, y no antes. Aquí solo se aparta cada detección absorbible
 * (`tras`: la detección de la lista → sus reglas estructurales), para que no entre en el paso 2 y para colocarla justo detrás de la
 * última de esas reglas (`detrasDeSuRegla`). Si la regla entra entera, 4b absorbe la palabra; si un candidato de mayor prioridad la
 * parte, la palabra se coloca como cualquier detección de la lista y no queda a la vista.
 */
function apartarAbsorbibles(work: MergedCandidate[], part: Part): { resto: MergedCandidate[]; tras: Map<MergedCandidate, MergedCandidate[]> } {
  const text = part.text;
  const tras = new Map<MergedCandidate, MergedCandidate[]>();
  const reglas = work.filter(esEstructural);
  if (reglas.length === 0) return { resto: work, tras };
  for (const L of work) {
    if (!esDeUnaPalabra(L, text)) continue;
    const suyas = reglas.filter((R) => R.start <= L.start && L.end <= R.end && L.end - L.start < R.end - R.start);
    if (suyas.length > 0) tras.set(L, suyas);
  }
  return { resto: tras.size === 0 ? work : work.filter((c) => !tras.has(c)), tras };
}

/**
 * B-61 · Inserta cada detección apartada justo detrás de la última de sus reglas en el orden de prioridad de `ordenado` (paso 3):
 * cuando le toca, todas las reglas que la contienen ya se colocaron. Las de una misma regla, en su orden de prioridad.
 */
function detrasDeSuRegla(ordenado: MergedCandidate[], tras: ReadonlyMap<MergedCandidate, readonly MergedCandidate[]>): MergedCandidate[] {
  if (tras.size === 0) return ordenado;
  const pos = new Map<MergedCandidate, number>(ordenado.map((c, i) => [c, i]));
  const detras = new Map<MergedCandidate, MergedCandidate[]>();
  const sueltas: MergedCandidate[] = [];
  for (const L of [...tras.keys()].sort(byPriority)) {
    let ultima: MergedCandidate | undefined;
    for (const R of tras.get(L) ?? []) if (pos.has(R) && (ultima === undefined || (pos.get(R) as number) > (pos.get(ultima) as number))) ultima = R;
    const l = ultima === undefined ? undefined : detras.get(ultima);
    if (ultima === undefined) sueltas.push(L);
    else if (l === undefined) detras.set(ultima, [L]); else l.push(L);
  }
  const out: MergedCandidate[] = [];
  for (const c of ordenado) {
    out.push(c);
    const l = detras.get(c);
    if (l !== undefined) out.push(...l);
  }
  // Una regla que ya no está (no pasa: el paso 2 solo retira candidatos de la lista y del modelo): la detección va al final.
  return [...out, ...sueltas];
}

/** Paso 1 · R-MRG-01: VALOR + VALOR o FECHA + FECHA con la misma clave, separados solo por « (» o uno dentro del otro (PA-6-r1). */
function joinParen(work: MergedCandidate[], part: Part): MergedCandidate[] {
  const text = part.text;
  let out = work;
  for (;;) {
    const cand = out.filter((c) => c.type === 'VALOR' || c.type === 'FECHA').sort(byPosition);
    let joined: { a: MergedCandidate; b: MergedCandidate; w: MergedCandidate } | null = null;
    for (let i = 0; i < cand.length && joined === null; i++) {
      const A = cand[i] as MergedCandidate;
      for (let j = 0; j < cand.length; j++) {
        const B = cand[j] as MergedCandidate;
        if (A !== B && A.type === B.type && A.canonicalKey === B.canonicalKey && A.start <= B.start && B.end <= A.end && A.end - A.start > B.end - B.start) {
          // PA-6-r1 (7.6.5): el tramo más largo ya trae la cifra entre paréntesis (R-VAL-04 completa contiene a R-VAL-01, que lleva
          // rótulo y precedencia 4). Es el mismo dato con la misma clave: un solo candidato, con la menor precedencia y la mayor confianza.
          const best = B.precedence < A.precedence ? B : A;
          const conf = CONF_RANK[B.confidence] > CONF_RANK[A.confidence] ? B.confidence : A.confidence;
          joined = { a: A, b: B, w: { ...best, start: A.start, end: A.end, confidence: conf, score: Math.max(A.score, B.score), precedence: best.precedence } };
          break;
        }
        if (A === B || A.type !== B.type || A.canonicalKey !== B.canonicalKey || A.end > B.start) continue;
        const gap = text.slice(A.end, B.start);
        if (RE_LETTER_OR_DIGIT.test(gap) || !RE_HUECO.test(buildSearchView(gap, 'reglas', part.kind).text)) continue;
        let end = B.end;
        let tail = text.slice(B.end, Math.min(text.length, B.end + CIERRE_WINDOW));
        const nl = tail.indexOf('\n');
        if (nl >= 0) tail = tail.slice(0, nl);
        const v = buildSearchView(tail, 'reglas', part.kind);
        const m = RE_CIERRE.exec(v.text);
        if (m !== null) end = B.end + (v.endMap[m[0].length - 1] as number);
        const best = A.precedence < B.precedence ? A : B.precedence < A.precedence ? B
          : CONF_RANK[B.confidence] > CONF_RANK[A.confidence] ? B : A;
        const conf = CONF_RANK[A.confidence] >= CONF_RANK[B.confidence] ? A.confidence : B.confidence;
        joined = { a: A, b: B, w: { ...best, start: A.start, end, confidence: conf, score: Math.max(A.score, B.score), precedence: best.precedence } };
        break;
      }
    }
    if (joined === null) return out;
    const { a, b, w } = joined;
    out = out.filter((c) => c !== a && c !== b);
    out.push(w);
  }
}

function nerLabelOf(c: MergedCandidate): NerLabel | undefined {
  if (c.nerLabel !== undefined) return c.nerLabel;
  if (c.type === 'PERSONA') return 'PER';
  return ORG_SET.has(c.type) ? 'ORG' : undefined;
}
/** Lo que el modelo agrega: vacío, o solo palabras con mayúscula inicial que no son de función ni tratamientos,
 *  sin signos salvo guion. Las partículas de 7.9.2 («de», «del», «de la», «de las», «de los») que se pegan a la palabra de nombre
 *  siguiente son parte del apellido, no palabras de función (D-12, C29: «CATALINA PRUEBA DEL VALLE» de «Catalina Prueba»). */
function onlyNameWords(extra: string, kind: PartKind): boolean {
  if (extra === '') return true;
  if (RE_NOT_NAME_CHAR.test(extra)) return false;
  const words = extra.split(RE_NAME_SPLIT).filter((w) => w !== '');
  let particula = false;
  let previa = '';
  for (const w of words) {
    const f = fold(w, kind);
    if (f === 'de' || f === 'del' || (previa === 'de' && (f === 'la' || f === 'las' || f === 'los'))) {
      particula = true; previa = f;
      continue;
    }
    if (!RE_UPPER_INITIAL.test(w) || NAME_STOP.has(f)) return false;
    particula = false; previa = f;
  }
  return words.length > 0 && !particula;
}

/**
 * D-03 B · ¿El texto del modelo es una variante de esa entidad de la lista? Lo responde quien conoce la lista del caso
 * (pipeline.ts). Sin respuesta, nunca lo es: la variante débil cede.
 */
export type EsVarianteDe = (caseEntityId: CaseEntityId, texto: string) => boolean;
const NUNCA_VARIANTE: EsVarianteDe = () => false;

/** Lo que agrega el modelo entre lo de la entidad: nada, solo blancos o guion entre dos trozos, o palabras de nombre (paso 2). */
function agregaSoloNombre(extra: string, kind: PartKind): boolean {
  return /^[\s\-‐‑]*$/u.test(extra) || onlyNameWords(extra, kind);
}

/**
 * D-03 B y E (7.11.1 paso 2, corrección del 31-oct) · Qué pasa con el tramo M del modelo frente a los candidatos de la lista
 * que contiene (`over`: todo lo que se solapa con M y que M no puede pisar por precedencia).
 * - `ceder`: cada variante débil de una palabra de una entidad de la que M no es variante se retira, y M entra entero (B).
 * - `extender`: además, lo demás es de una sola entidad de la lista, con etiqueta compatible, y M solo le agrega palabras de
 *   nombre: la entidad toma el tramo de M (E; con un solo trozo es el paso 2 de siempre).
 * - `null`: cualquier otro solape (regla, manual, modelo, dos entidades, solape parcial, minúscula): M se parte como antes.
 */
type PlanModelo = { kind: 'ceder'; ceden: MergedCandidate[] } | { kind: 'extender'; ceden: MergedCandidate[]; propias: MergedCandidate[] };
function planDelModelo(M: MergedCandidate, over: readonly MergedCandidate[], part: Part, esVariante: EsVarianteDe): PlanModelo | null {
  const text = part.text;
  const label = nerLabelOf(M);
  if (M.source !== 'modelo' || (label !== 'PER' && label !== 'ORG') || over.length === 0) return null;
  const textoM = text.slice(M.start, M.end);
  const ceden: MergedCandidate[] = [];
  const propias: MergedCandidate[] = [];
  for (const X of over) {
    if (X.source !== 'lista' || X.caseEntityId === undefined || X.start < M.start || X.end > M.end
      || X.end - X.start >= M.end - M.start) return null;
    if (esVarianteDebil(X, text.slice(X.start, X.end)) && !esVariante(X.caseEntityId, textoM)) ceden.push(X);
    else propias.push(X);
  }
  if (propias.length === 0) return { kind: 'ceder', ceden };
  const base = propias[0] as MergedCandidate;
  const want: NerLabel | undefined = base.type === 'PERSONA' ? 'PER' : ORG_SET.has(base.type) ? 'ORG' : undefined;
  if (want !== label || propias.some((p) => p.caseEntityId !== base.caseEntityId || p.type !== base.type)) return null;
  for (const [s, e] of uncovered(M, propias)) if (!agregaSoloNombre(text.slice(s, e), part.kind)) return null;
  return { kind: 'extender', ceden, propias };
}

/** E · La entidad de la lista toma el tramo de M (paso 2): confianza media, `extended`. Hereda del trozo de mayor prioridad. */
function extension(M: MergedCandidate, propias: readonly MergedCandidate[]): MergedCandidate {
  const L = [...propias].sort(byPriority)[0] as MergedCandidate;
  return { ...L, start: M.start, end: M.end, confidence: 'media', score: NOMINAL.media, extended: true };
}

/**
 * D-03 B en la fusión de una sola vez: antes del paso 2, la variante débil de otra entidad cede ante el tramo del modelo que la
 * contiene, si después M entra entero o el paso 2 lo toma con un solo trozo de la lista (lo que `extendWithModel` sabe hacer).
 */
function cederVariantesDebiles(work: MergedCandidate[], part: Part, esVariante: EsVarianteDe): MergedCandidate[] {
  let out = work;
  const modelos = out.filter((c) => c.source === 'modelo').sort(byPriority);
  for (const M of modelos) {
    if (!out.includes(M)) continue;
    const over = out.filter((X) => X !== M && X.source !== 'modelo' && overlaps(X, M.start, M.end));
    const plan = planDelModelo(M, over, part, esVariante);
    if (plan === null || plan.ceden.length === 0 || (plan.kind === 'extender' && plan.propias.length !== 1)) continue;
    const fuera = new Set(plan.ceden);
    out = out.filter((c) => !fuera.has(c));
  }
  return out;
}

/** Paso 2 · Lista extendida por el modelo. */
function extendWithModel(work: MergedCandidate[], part: Part): MergedCandidate[] {
  const text = part.text;
  let out = work;
  const listas = out.filter((c) => c.source === 'lista').sort(byPosition);
  for (const L of listas) {
    const want: NerLabel | undefined = L.type === 'PERSONA' ? 'PER' : ORG_SET.has(L.type) ? 'ORG' : undefined;
    if (want === undefined) continue;
    const options = out
      .filter((M) => M.source === 'modelo' && nerLabelOf(M) === want && M.start <= L.start && M.end >= L.end
        && M.end - M.start > L.end - L.start)
      .sort(byPriority);
    for (const M of options) {
      if (!onlyNameWords(text.slice(M.start, L.start), part.kind) || !onlyNameWords(text.slice(L.end, M.end), part.kind)) continue;
      // Lo agregado no puede pisar otro candidato que no sea del modelo: sería otra entidad u otro dato.
      const blocked = out.some((X) => X !== L && X !== M && X.source !== 'modelo'
        && (overlaps(X, M.start, L.start) || overlaps(X, L.end, M.end)));
      if (blocked) continue;
      const ext: MergedCandidate = { ...L, start: M.start, end: M.end, confidence: 'media', score: NOMINAL.media, extended: true };
      out = out.filter((c) => c !== L && c !== M);
      out.push(ext);
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 7.11.1 · Algoritmo determinista
// ---------------------------------------------------------------------------------------------

/** Paso 0 · Límites dentro de un par sustituto, duplicados exactos y precedencia. Copia: no toca la entrada. */
function normalize(part: Part, cands: readonly DetectionCandidate[]): MergedCandidate[] {
  const text = part.text;
  const unique = new Map<string, MergedCandidate>();
  for (const c of cands) {
    if (c.partId !== part.id || FLAG_SET.has(c.type)) continue;
    if (!Number.isFinite(c.start) || !Number.isFinite(c.end)) continue;
    const s = widenStart(text, Math.max(0, Math.min(text.length, Math.trunc(c.start))));
    const e = widenEnd(text, Math.max(0, Math.min(text.length, Math.trunc(c.end))));
    if (e <= s) continue;
    const w: MergedCandidate = { ...c, start: s, end: e, precedence: 5 };
    w.precedence = precedenceOf(w);
    const k = `${s}\u0000${e}\u0000${w.type}\u0000${w.source}\u0000${w.canonicalKey}`;
    const prev = unique.get(k);
    if (prev === undefined || CONF_RANK[w.confidence] > CONF_RANK[prev.confidence]
      || (w.confidence === prev.confidence && (w.score > prev.score || (w.score === prev.score && byPriority(w, prev) < 0)))) {
      unique.set(k, w);
    }
  }
  return [...unique.values()];
}

/**
 * Paso 4 · Coloca `work` (ya ordenado por prioridad) detrás de `fixed`, que se da por aceptado y no se modifica
 * (ni `holderDigits`). Devuelve solo lo que se acepta de `work`, remanentes incluidos.
 */
function place(part: Part, work: readonly MergedCandidate[], fixed: readonly MergedCandidate[], rules: RuleRegistry): MergedCandidate[] {
  const text = part.text;
  const accepted: MergedCandidate[] = [...fixed];
  const isFixed = new Set<MergedCandidate>(fixed);
  for (const c of work) {
    const over = accepted.filter((a) => overlaps(a, c.start, c.end));
    if (over.length === 0) { accepted.push(c); continue; }
    const container = over.find((a) => a.start <= c.start && c.end <= a.end);
    if (container !== undefined) {
      if (container.type === 'NIT' && HOLDER_ABSORBED.has(c.type) && !isFixed.has(container)) {
        const d = text.slice(c.start, c.end).replace(/[^0-9]/gu, '');
        if (d !== '') container.holderDigits = d;
      }
      continue;
    }
    for (const [s, e] of uncovered(c, over)) {
      const r = resolveRemainder(part, c, s, e, rules);
      if (r !== null) accepted.push(r);
    }
  }
  return accepted.slice(fixed.length);
}

const byStart = (a: MergedCandidate, b: MergedCandidate): number => a.start - b.start || a.end - b.end;

/**
 * Fusiona los candidatos de una parte (6.4.2, 7.11). Devuelve candidatos sin solapes (INV-R02), con
 * `precedence` según 6.2.4 (INV-R04), ordenados por inicio. Un validador fallido nunca descarta (INV-R03).
 * Ignora las banderas (las recorta generalize.ts, 6.4.6) y los candidatos de otra parte.
 */
export function mergeCandidates(part: Part, cands: readonly DetectionCandidate[], rules: RuleRegistry,
  esVariante: EsVarianteDe = NUNCA_VARIANTE): MergedCandidate[] {
  // 0. Normalizar: límites dentro de un par sustituto, duplicados exactos y precedencia.
  let work = normalize(part, cands);
  // 1. Unir por paréntesis (R-MRG-01).
  work = joinParen(work, part);
  // D-06 decisión 5: la lista de una sola palabra estrictamente dentro de una regla estructural se aparta del paso 2 y se coloca
  // justo detrás de su regla, que la absorbe en 4b si entra entera (B-61).
  const { resto, tras } = apartarAbsorbibles(work, part);
  // 2. Extender la lista con el modelo, después de que la variante débil de otra entidad ceda (D-03 B).
  work = cederVariantesDebiles(resto, part, esVariante);
  work = extendWithModel(work, part);
  // 3. Ordenar.
  work.sort(byPriority);
  work = detrasDeSuRegla(work, tras);
  // 4. Colocar en orden.
  const accepted = place(part, work, [], rules);
  // 5. Devolver ordenado por inicio.
  return accepted.sort(byStart);
}

/**
 * 7.10.10 (pasos 2 y 3) · Fusión de una ventana del modelo: 7.11 solo sobre los candidatos nuevos `cands`, contra el
 * conjunto ya fusionado de la parte (`fused`, salida de una fusión anterior), que no se parte ni se desplaza (INV-R12).
 * Un candidato nuevo contenido en uno ya fusionado se absorbe; uno que se solapa en parte se parte y cada resto pasa por
 * 7.11.2 (en el modelo, recorte R-MOD-03 y confianza baja), en vez de perderse entero.
 *
 * Única excepción (D-03 B y E, 31-oct; INV-R12 con su excepción): el paso 2 también se aplica aquí contra lo ya fusionado
 * (`planDelModelo`). Un candidato de la lista contenido en un tramo nuevo del modelo cede (variante débil de otra entidad) o
 * toma el tramo (nombre de la lista incompleto). El reductor solo lo acepta si esa detección sigue `pendiente` y sin ninguna
 * acción del usuario (`cedeAnteModelo` en entities.ts); si no, `incorporarModelo` vuelve a partir el tramo como antes.
 * Devuelve el conjunto completo, sin solapes y ordenado por inicio.
 */
export function mergeIntoFused(part: Part, fused: readonly MergedCandidate[], cands: readonly DetectionCandidate[],
  rules: RuleRegistry, esVariante: EsVarianteDe = NUNCA_VARIANTE): MergedCandidate[] {
  let fixed = fused.filter((c) => c.partId === part.id).map((c) => ({ ...c }));
  let work = normalize(part, cands);
  work = joinParen(work, part);
  // D-06 decisión 5 entre los candidatos nuevos (lo ya fusionado no se toca: INV-R12), decidida al colocar (B-61).
  const { resto, tras } = apartarAbsorbibles(work, part);
  work = resto;
  work.sort(byPriority);
  // Paso 2 por ventana (D-03 B y E), del tramo del modelo de mayor prioridad al de menor.
  const tomados = new Set<MergedCandidate>();
  for (const M of work) {
    const over = fixed.filter((X) => overlaps(X, M.start, M.end));
    const plan = planDelModelo(M, over, part, esVariante);
    if (plan === null) continue;
    const fuera = new Set<MergedCandidate>([...plan.ceden, ...(plan.kind === 'extender' ? plan.propias : [])]);
    fixed = fixed.filter((c) => !fuera.has(c));
    if (plan.kind === 'extender') { fixed.push(finish(extension(M, plan.propias), part.text)); tomados.add(M); }
  }
  work = detrasDeSuRegla(work.filter((c) => !tomados.has(c)), tras);
  return [...fixed, ...place(part, work, fixed, rules)].sort(byStart);
}
