// R2 (10.2.4): barrido de omisiones. Recorre los 30 documentos con el gold marcado y lista los candidatos sin anotar:
//   (a) secuencias de >= 2 palabras con mayúscula inicial, (b) grupos de >= 5 dígitos (con separadores), (c) tramos con `@`,
//   (d) el dato que sigue a una palabra de rótulo de la sección 7 (cédula, NIT, radicado, tel., placa, HC, matrícula, cuenta...).
// Ampliación del revisor (no la exige 10.2.4): (e) token marcador de ficción (Ficticio/a, Ejemplo, Prueba) sin anotar, (f) dinero,
// (g) fechas, (h) municipios y departamentos de data/divipola.json, (i) cargos, diagnósticos, hechos llamativos y expresiones de
// menor de los catálogos de data/ (listas del producto; no se lee el generador).
// Un candidato está «cubierto» si solapa alguna anotación del gold (positiva, negativa, indirecta o de despacho).
// Salida: corpus/revision/R2/candidatos.json y, con --decisiones o --sin-decidir, la verificación contra
// corpus/revision/R2/decisiones.json: T-GO-04 exige 0 candidatos sin decisión (código de salida 1 si queda alguno).
// Uso: node corpus/revision/herramientas/r2-candidatos.mjs [--decisiones] [--sin-decidir]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const clave = (p) => `${p.kind}:${p.index}${p.page === undefined ? '' : `:p${p.page}`}`;

const MAY = String.raw`[A-ZÁÉÍÓÚÜÑ]`;
// (a) palabras con mayúscula inicial, unidas solo por espacios simples (sin saltos de línea)
const RE_MAYUS = new RegExp(String.raw`(?<![\p{L}\p{N}])${MAY}[\p{L}'’-]*(?:[ \t]+${MAY}[\p{L}'’-]*)+(?![\p{L}\p{N}])`, 'gu');
// (b) grupos de >= 5 dígitos, admitiendo separadores entre grupos de dígitos
const RE_DIGITOS = new RegExp(String.raw`(?<![\p{L}\p{N}])\+?\(?\d[\d.,'’\-/ ]*\d(?![\p{L}\p{N}])`, 'gu');
// (c) @
const RE_ARROBA = new RegExp(String.raw`[^\s<>(),;:]*@[^\s<>(),;:]+`, 'gu');
// (d) rótulos de la sección 7
const ROTULOS = [
  'cédula de ciudadanía', 'cédula de extranjería', 'cédula', 'C\\.C\\.', 'C\\.E\\.', 'T\\.I\\.', 'T\\.P\\.', 'NUIP', 'NIP', 'NIT', 'nit', 'PPT', 'PEP', 'pasaporte', 'carné diplomático',
  'registro civil', 'registro médico', 'tarjeta profesional', 'radicado', 'rad\\.', 'ref\\.', 'proceso', 'expediente', 'CUI', 'consecutivo', 'folio', 'Tel\\.', 'teléfono', 'celular', 'cel', 'fijo', 'PBX',
  'whatsapp', 'placas?', 'HC', 'historia clínica', 'afiliación', 'afiliado', 'autorización', 'MIPRES', 'matrícula inmobiliaria', 'matrícula', 'cuenta', 'tarjeta', 'llave Bre-B', 'Bre-B', 'barrio',
  'vereda', 'corregimiento', 'finca', 'dirección', 'domicilio', 'correo', 'e-mail', 'nació', 'nacido', 'edad', 'pagaré', 'póliza', 'contrato', 'número interno', 'No\\.', 'N\\.º', 'n\\.º',
].join('|');
const RE_ROTULO = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${ROTULOS})(?![\p{L}])[ \t:]*(?:No\.|N\.º|n\.º|Nº|número|de|en|es|del|la|el|\(?\+?57\)?|\s)*([^\s,;]*\d[^\s,;]*(?:[ \t]\d[^\s,;]*)*|@[^\s,;]+)`, 'gu');

const H = String.raw`[ \t]`;
const leerData = (n) => JSON.parse(readFileSync(join(RAIZ, 'data', `${n}.json`), 'utf8'));
const escLit = (x) => [...x].map((c) => ('.*+?^${}()|[]\\'.includes(c) ? '\\' + c : c)).join('');
const lit = (t) => t.split(/\s+/).map(escLit).join(String.raw`\s+`);
const alt = (xs) => [...xs].sort((a, b) => b.length - a.length).join('|');
function reGeneral() {
  const cargos = leerData('cargos');
  const diag = leerData('diagnosticos');
  const lla = leerData('llamativos');
  const men = leerData('menores');
  const div = leerData('divipola');
  const muns = [...new Set(div.map((d) => d.munNombre))].filter((n) => n.length > 3).map((n) => lit(n.toLowerCase()));
  const deps = [...new Set(div.map((d) => d.depNombre))].map((n) => lit(n.toLowerCase()));
  const mk = (cuerpo) => new RegExp(String.raw`(?<![\p{L}\p{N}])(?:` + cuerpo + String.raw`)(?![\p{L}\p{N}])`, 'giu');
  const hh = (p) => p.split('{H}').join(H);
  return {
    marcador: mk('Ficticios?|Ficticias?|Ejemplos?|Prueba'),
    dinero: new RegExp(String.raw`\$\s?\d[\d.,']*|(?<![\p{L}\p{N}])\d[\d.,]*\s+millones|SMMLV|salarios\s+m[ií]nimos`, 'giu'),
    fecha: new RegExp(String.raw`(?<!\d)\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}(?!\d)|(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)|(?<!\d)\d{1,2}\s+(?:de\s+)?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)\.?\s+(?:de\s+)?\d{4}`, 'giu'),
    fechaLetras: new RegExp(String.raw`(?<![\p{L}\p{N}])(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(?:dos\s+mil|\d{4})`, 'giu'),
    fechaRomanos: new RegExp(String.raw`(?<!\d)\d{1,2}-(?:[IVX]{1,4})-\d{4}(?!\d)`, 'gu'),
    apodo: new RegExp(String.raw`(?:le\s+decimos|le\s+dicen|le\s+llaman|apodad[oa]|alias|conocid[oa]\s+como)\s+((?:[\p{L}]+)(?:\s+[\p{L}]+)?)(?=[,.;:])`, 'giu'),
    tratamiento: new RegExp(String.raw`(?<![\p{L}\p{N}])(?:se\p{L}or(?:a|es|\(a\))?|doctor(?:a)?|Dr\.|Dra\.|ingenier[oa]|abogad[oa]|don|doña)\s+[A-ZÁÉÍÓÚÑ][\p{L}'-]+`, 'gu'),
    via: new RegExp(String.raw`(?<![\p{L}\p{N}])(?:Calle|Cll|Cl|Carrera|Cra|Cr|Kr|Avenida|Av|Diagonal|Dg|Diag|Transversal|Tv|Trans)\.?\s+(?:[A-Z]{0,2}\d)`, 'gu'),
    edad: new RegExp(String.raw`(?<![\p{L}\p{N}])\d{1,3}\s+años`, 'gu'),
    iniciales: new RegExp(String.raw`(?<![\p{L}\p{N}.])(?:[A-ZÁÉÍÓÚÑ]\.[ \t]+)+[A-ZÁÉÍÓÚÑ]\.(?![\p{L}])`, 'gu'),
    menorArticulo: new RegExp(String.raw`(?<![\p{L}\p{N}])(?:el|la|los|las)\s+menor(?:es)?(?![\p{L}\p{N}])`, 'giu'),
    municipio: mk(alt(muns)),
    departamento: mk(alt(deps)),
    cargo: mk(alt([...cargos.privados, ...cargos.publicos].map((c) => lit(c)))),
    diagnostico: mk(alt(diag.terminos.map((c) => lit(c)))),
    llamativo: mk(lla.patrones.map(hh).join('|')),
    menor: mk(alt(men.expresiones.map(hh))),
  };
}

const tramosCubiertos = (anns, parte) => anns.filter((a) => clave(a.parte) === parte).map((a) => [a.start, a.end]);
const solapa = (cub, s, e) => cub.some(([a, b]) => a < e && s < b);

function recortar(texto, s, e) {
  while (s < e && /[\s.,;:'’\-/(]/.test(texto[s])) s++;
  while (e > s && /[\s.,;:'’\-/)]/.test(texto[e - 1])) e--;
  return [s, e];
}

export function candidatos(opciones = {}) {
  const goldDir = opciones.goldDir ?? join(RAIZ, 'corpus/gold');
  const ids = readdirSync(goldDir).filter((f) => /^C\d\d\.json$/.test(f)).map((f) => f.slice(0, 3)).sort();
  const out = [];
  const GEN = reGeneral();
  for (const id of ids) {
    const gold = opciones.golds?.[id] ?? JSON.parse(readFileSync(join(goldDir, `${id}.json`), 'utf8'));
    const texto = JSON.parse(readFileSync(join(goldDir, `${id}.texto.json`), 'utf8'));
    const siglas = [...new Set(texto.partes.flatMap((p) => [...p.texto.matchAll(/\(([A-ZÁÉÍÓÚÑ]{2,6})\)/gu)].map((m) => m[1])))];
    for (const p of texto.partes) {
      const k = clave(p);
      const cub = tramosCubiertos(gold.anotaciones, k);
      const vistos = new Set();
      const agregar = (clase, s0, e0) => {
        const [s, e] = recortar(p.texto, s0, e0);
        if (e <= s || solapa(cub, s, e)) return;
        const llave = `${clase}|${s}`;
        if (vistos.has(llave)) return;
        vistos.add(llave);
        out.push({ docId: id, parte: k, clase, start: s, end: e, texto: p.texto.slice(s, e) });
      };
      for (const m of p.texto.matchAll(RE_MAYUS)) agregar('mayusculas', m.index, m.index + m[0].length);
      for (const m of p.texto.matchAll(RE_DIGITOS)) if (m[0].replace(/\D/g, '').length >= 5) agregar('digitos', m.index, m.index + m[0].length);
      for (const m of p.texto.matchAll(RE_ARROBA)) agregar('arroba', m.index, m.index + m[0].length);
      for (const m of p.texto.matchAll(RE_ROTULO)) {
        const g = m[1];
        const ini = m.index + m[0].length - g.length;
        agregar('rotulo', ini, ini + g.length);
      }
      for (const [clase, re] of Object.entries(GEN)) for (const m of p.texto.matchAll(re)) agregar(clase, m.index, m.index + m[0].length);
      // siglas definidas entre paréntesis en cualquier parte del documento («(SIP)»): toda aparición suelta es candidata
      if (siglas.length) for (const m of p.texto.matchAll(new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${siglas.join('|')})(?![\p{L}\p{N}])`, 'gu'))) agregar('sigla', m.index, m.index + m[0].length);
    }
  }
  return out;
}

/** Clave de decisión: clase y texto normalizado (minúsculas, espacios simples). */
export const claveDecision = (c) => `${c.clase}|${c.texto.toLowerCase().replace(/\s+/g, ' ')}`;
export const CLASES = ['mayusculas', 'digitos', 'arroba', 'rotulo', 'marcador', 'dinero', 'fecha', 'fechaLetras', 'fechaRomanos', 'apodo', 'tratamiento', 'via', 'edad', 'iniciales', 'menorArticulo', 'sigla', 'municipio', 'departamento', 'cargo', 'diagnostico', 'llamativo', 'menor'];

if (process.argv[1] && process.argv[1].endsWith('r2-candidatos.mjs')) {
  const cs = candidatos();
  mkdirSync(join(RAIZ, 'corpus/revision/R2'), { recursive: true });
  const distintos = new Map();
  for (const c of cs) {
    const k = claveDecision(c);
    if (!distintos.has(k)) distintos.set(k, { clave: k, clase: c.clase, texto: c.texto, apariciones: 0, docs: new Set() });
    const d = distintos.get(k);
    d.apariciones++;
    d.docs.add(c.docId);
  }
  const lista = [...distintos.values()].map((d) => ({ ...d, docs: [...d.docs] }));
  writeFileSync(join(RAIZ, 'corpus/revision/R2/candidatos.json'), JSON.stringify({ formato: 'sig-low/revision-r2-candidatos', v: 1, total: cs.length, distintos: lista.length, candidatos: cs }) + '\n');
  console.log('candidatos:', cs.length, 'distintos:', lista.length, 'por clase:', JSON.stringify(Object.fromEntries(CLASES.map((c) => [c, cs.filter((x) => x.clase === c).length]))));
  const fDec = join(RAIZ, 'corpus/revision/R2/decisiones.json');
  if (process.argv.includes('--decisiones') || process.argv.includes('--sin-decidir')) {
    const dec = existsSync(fDec) ? JSON.parse(readFileSync(fDec, 'utf8')).decisiones : {};
    const decidido = (c) => dec[`${c.docId}|${claveDecision(c)}`] !== undefined || dec[claveDecision(c)] !== undefined;
    const sinC = cs.filter((c) => !decidido(c));
    const sin = [...new Map(sinC.map((c) => [claveDecision(c), c])).values()];
    console.log('candidatos sin decisión:', sinC.length, '| distintos:', sin.length);
    if (process.argv.includes('--sin-decidir')) for (const c of sin) console.log(`${c.clase}\t${c.docId}\t${c.texto.replace(/\n/g, '⏎')}`);
    process.exitCode = sinC.length === 0 ? 0 : 1;
  }
}
