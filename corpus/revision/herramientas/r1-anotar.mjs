// R1 (10.2.4): convierte una especificación de anotación hecha a mano (revisor R, a ciegas) en tramos sobre el texto canónico
// de cada parte (corpus/gold/Cnn.texto.json). No lee ninguna anotación del gold.
// Uso: node corpus/revision/herramientas/r1-anotar.mjs C07 C14 ...
// Línea de la especificación:  TIPO|texto             (todas las apariciones del texto)
//                              TIPO|contexto [tramo]  (el tramo entre corchetes dentro del contexto; todas las apariciones)
//                              NOT:TIPO|texto         (zona de exclusión: se descartan los tramos de ese grupo contenidos en ella)
//                              NEG|texto              (negativo esperado: cita, código que no es dato personal)
// Los espacios en blanco del patrón casan con cualquier secuencia de espacios y saltos de línea.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ORG = new Set(['EMPRESA', 'EPS', 'IPS', 'ENTIDAD', 'PROVEEDOR']);
const IDENT = new Set(['CC', 'TI', 'CE', 'PPT', 'PEP', 'PASAPORTE', 'NIT', 'TP', 'DOCUMENTO', 'RADICADO', 'RADICADO_ADMIN', 'PLACA', 'MATRICULA', 'CUENTA', 'TARJETA', 'HC', 'AFILIACION']);
const UBIC = new Set(['DIRECCION', 'BARRIO', 'MUNICIPIO', 'DEPARTAMENTO', 'LUGAR']);
export const grupo = (t) => t === 'PERSONA' ? 'personas' : ORG.has(t) ? 'organizaciones' : IDENT.has(t) ? 'identificaciones'
  : t === 'TELEFONO' || t === 'CORREO' ? 'contacto' : UBIC.has(t) ? 'ubicacion' : t === 'FECHA' || t === 'VALOR' ? 'fechas_valores'
  : t === 'DESPACHO' ? 'despacho' : t === 'NEG' ? 'neg' : 'otros';

const ESPECIALES = new Set('.*+?^${}()|[]\\'.split(''));
const esc = (s) => [...s].map((c) => (ESPECIALES.has(c) ? '\\' + c : c)).join('');
const BLANCOS = String.raw`\s+`;
const flex = (txt) => txt.split(/\s+/).map(esc).join(BLANCOS);
const L = String.raw`[\p{L}\p{N}_]`;
function patron(txt) {
  const ini = new RegExp('^' + L, 'u').test(txt) ? `(?<!${L})` : '';
  const fin = new RegExp(L + '$', 'u').test(txt) ? `(?!${L})` : '';
  return new RegExp(ini + flex(txt) + fin, 'gu');
}

export function anotar(id) {
  const texto = JSON.parse(readFileSync(join(RAIZ, 'corpus/gold', `${id}.texto.json`), 'utf8'));
  const lineas = readFileSync(join(RAIZ, 'corpus/revision/R1/espec', `${id}.txt`), 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const out = [];
  const sinCoincidencia = new Set(lineas.filter((l) => !l.startsWith('NOT:')));
  for (const parte of texto.partes) {
    const ref = { kind: parte.kind, index: parte.index, ...(parte.page !== undefined ? { page: parte.page } : {}) };
    const tramos = [];
    const zonas = [];
    for (const l of lineas) {
      const barra = l.indexOf('|');
      let tipo = l.slice(0, barra);
      const spec = l.slice(barra + 1);
      const esNot = tipo.startsWith('NOT:');
      if (esNot) tipo = tipo.slice(4);
      const m = /^([^[]*)\[([^\]]+)\](.*)$/s.exec(spec);
      const pre = m ? m[1] : '';
      const mid = m ? m[2] : spec;
      const post = m ? m[3] : '';
      const re = patron(pre + mid + post);
      for (const r of parte.texto.matchAll(re)) {
        sinCoincidencia.delete(l);
        const sub = r[0];
        let ini = r.index;
        let fin = r.index + sub.length;
        if (m) {
          const preRe = pre ? new RegExp('^' + flex(pre)) : null;
          const postRe = post ? new RegExp(flex(post) + '$') : null;
          ini = r.index + (preRe ? preRe.exec(sub)[0].length : 0);
          fin = r.index + sub.length - (postRe ? postRe.exec(sub)[0].length : 0);
        }
        if (esNot) zonas.push({ tipo, start: ini, end: fin });
        else tramos.push({ tipo, start: ini, end: fin });
      }
    }
    const cont = (a, b) => a.start <= b.start && a.end >= b.end && a.end - a.start > b.end - b.start;
    let keep = tramos.filter((t) => !zonas.some((z) => grupo(z.tipo) === grupo(t.tipo) && cont(z, t)));
    keep = keep.filter((t, i) => keep.findIndex((u) => u.start === t.start && u.end === t.end && grupo(u.tipo) === grupo(t.tipo)) === i);
    keep = keep.filter((t) => !keep.some((u) => u !== t && grupo(u.tipo) === grupo(t.tipo) && cont(u, t)));
    keep.sort((a, b) => a.start - b.start || b.end - a.end);
    for (const t of keep) out.push({ parte: ref, start: t.start, end: t.end, texto: parte.texto.slice(t.start, t.end), tipo: t.tipo });
  }
  return { docId: id, anotaciones: out.map((a, i) => ({ id: `${id}-R${String(i + 1).padStart(3, '0')}`, ...a })), sinCoincidencia: [...sinCoincidencia] };
}

if (process.argv[1] && process.argv[1].endsWith('r1-anotar.mjs')) {
  for (const id of process.argv.slice(2)) {
    const r = anotar(id);
    writeFileSync(join(RAIZ, 'corpus/revision/R1/anotaciones', `${id}.r1.json`), JSON.stringify({ formato: 'sig-low/revision-r1', v: 1, ...r }, null, 1) + '\n');
    console.log(id, 'anotaciones:', r.anotaciones.length, 'especificaciones sin coincidencia:', r.sinCoincidencia.length);
    for (const s of r.sinCoincidencia) console.log('  SIN COINCIDENCIA:', s);
  }
}
