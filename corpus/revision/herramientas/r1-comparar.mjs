// R1 (10.2.4): compara las anotaciones ciegas del revisor (corpus/revision/R1/anotaciones/Cnn.r1.json) con el gold (corpus/gold/Cnn.json).
// Coincidencia: IoU >= 0,5 en la misma parte y mismo grupo de tipo (negativos: solo IoU; despachos: solo IoU con DESPACHO_A_GENERICO).
// Empareja de forma voluntariosa por IoU decreciente (uno a uno). F1 = 2·TP / (|R| + |G|).
// Uso: node corpus/revision/herramientas/r1-comparar.mjs C07 C14 ...   (escribe corpus/revision/R1/comparacion.json)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { grupo } from './r1-anotar.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FLAGS = new Set(['CARGO', 'DIAGNOSTICO', 'HECHO_LLAMATIVO', 'MENOR', 'CITA_JURISPRUDENCIAL']);
const clave = (p) => `${p.kind}:${p.index}${p.page === undefined ? '' : `:p${p.page}`}`;
const iou = (a, b) => {
  const i = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const u = (a.end - a.start) + (b.end - b.start) - i;
  return u <= 0 ? 0 : i / u;
};
const claseGold = (g) => (g.es_negativo_esperado ? 'neg' : g.generalizacion === 'DESPACHO_A_GENERICO' ? 'despacho' : FLAGS.has(g.tipo) ? 'indirecto' : 'positiva');
const claseMia = (a) => (a.tipo === 'NEG' ? 'neg' : a.tipo === 'DESPACHO' ? 'despacho' : FLAGS.has(a.tipo) ? 'indirecto' : 'positiva');
const grupoGold = (g) => (g.es_negativo_esperado ? 'neg' : g.generalizacion === 'DESPACHO_A_GENERICO' ? 'despacho' : grupo(g.tipo));

export function comparar(id) {
  const mio = JSON.parse(readFileSync(join(RAIZ, 'corpus/revision/R1/anotaciones', `${id}.r1.json`), 'utf8')).anotaciones;
  const gold = JSON.parse(readFileSync(join(RAIZ, 'corpus/gold', `${id}.json`), 'utf8'));
  const g = gold.anotaciones;
  const pares = [];
  mio.forEach((a, i) => g.forEach((b, j) => {
    if (clave(a.parte) !== clave(b.parte)) return;
    const v = iou(a, b);
    if (v >= 0.5 && grupo(a.tipo) === grupoGold(b)) pares.push({ i, j, v });
  }));
  pares.sort((x, y) => y.v - x.v);
  const usadoM = new Set();
  const usadoG = new Set();
  const tp = [];
  for (const p of pares) {
    if (usadoM.has(p.i) || usadoG.has(p.j)) continue;
    usadoM.add(p.i); usadoG.add(p.j); tp.push(p);
  }
  const f1 = (clases) => {
    const nm = mio.filter((a) => clases.includes(claseMia(a))).length;
    const ng = g.filter((b) => clases.includes(claseGold(b))).length;
    const t = tp.filter((p) => clases.includes(claseGold(g[p.j]))).length;
    return { r1: nm, gold: ng, coinciden: t, f1: nm + ng === 0 ? 1 : (2 * t) / (nm + ng) };
  };
  const ctx = (texto, a) => texto.slice(Math.max(0, a.start - 25), a.start) + '«' + texto.slice(a.start, a.end) + '»' + texto.slice(a.end, a.end + 25);
  const textos = new Map(JSON.parse(readFileSync(join(RAIZ, 'corpus/gold', `${id}.texto.json`), 'utf8')).partes.map((p) => [clave(p), p.texto]));
  const soloR = mio.map((a, i) => ({ a, i })).filter(({ i }) => !usadoM.has(i)).map(({ a }) => ({ idR1: a.id, parte: clave(a.parte), tipo: a.tipo, texto: a.texto, ctx: ctx(textos.get(clave(a.parte)), a) }));
  const soloG = g.map((b, j) => ({ b, j })).filter(({ j }) => !usadoG.has(j)).map(({ b }) => ({ idGold: b.id, parte: clave(b.parte), tipo: b.tipo, negativo: b.es_negativo_esperado, texto: b.texto, ctx: ctx(textos.get(clave(b.parte)), b) }));
  return {
    docId: id, conjunto: gold.conjunto, tipoDocumento: gold.tipoDocumento, fuente: gold.fuente,
    total: f1(['positiva', 'indirecto', 'despacho', 'neg']), positivas: f1(['positiva']), indirectos: f1(['indirecto', 'despacho']), negativos: f1(['neg']),
    soloRevisor: soloR, soloGold: soloG,
  };
}

if (process.argv[1] && process.argv[1].endsWith('r1-comparar.mjs')) {
  const ids = process.argv.slice(2);
  const res = ids.map(comparar);
  writeFileSync(join(RAIZ, 'corpus/revision/R1/comparacion.json'), JSON.stringify({ formato: 'sig-low/revision-r1-comparacion', v: 1, umbral: 0.95, documentos: res }, null, 1) + '\n');
  for (const r of res) {
    const f = (x) => `${x.f1.toFixed(4)} (${x.coinciden}/${x.r1}/${x.gold})`;
    console.log(`${r.docId} ${r.tipoDocumento}/${r.fuente}/${r.conjunto}  total ${f(r.total)}  positivas ${f(r.positivas)}  indirectos ${f(r.indirectos)}  neg ${f(r.negativos)}  soloR1 ${r.soloRevisor.length} soloGold ${r.soloGold.length}`);
  }
}
