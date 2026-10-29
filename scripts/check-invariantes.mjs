#!/usr/bin/env node
// T-IV-01: los identificadores INV-xxx de los títulos de it(/test( en tests/**/*.{ts,mjs} igualan a tests/invariantes.txt
// (generado desde la sección 6 del plan). Node puro, sin dependencias.
//
//   node scripts/check-invariantes.mjs              sale 1 si falta un invariante o si una prueba cita uno desconocido
//   node scripts/check-invariantes.mjs --informar   solo lista los que faltan y sale 0 (P0-3 y P0-4)
//   --raiz <dir>                                    raíz del repositorio (por defecto, la carpeta superior de scripts/)
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ID = /INV-[A-Z]\d{2}/g;
const IGNORAR = new Set(['node_modules', 'dist', '.git']);

/** it( … ), test( … ) y sus modificadores (it.only, it.skipIf(c)(…), test.each(…)(…)); it.skip y it.todo no cubren nada. */
const LLAMADA = /\b(?:it|test)((?:\.[A-Za-z]+(?:\((?:[^()]|\([^()]*\))*\))?)*)\s*\(\s*(['"`])((?:\\[\s\S]|(?!\2)[^\\])*)\2/g;

export function idsDeTitulos(fuente) {
  const ids = new Set();
  for (const m of fuente.matchAll(LLAMADA)) {
    const modificadores = m[1].split(/[.(]/).filter(Boolean);
    if (modificadores.includes('skip') || modificadores.includes('todo')) continue;
    for (const id of m[3].match(ID) ?? []) ids.add(id);
  }
  return ids;
}

function archivos(dir, salida = []) {
  if (!existsSync(dir)) return salida;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(e.name)) continue;
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivos(ruta, salida);
    else if (/\.(ts|mjs)$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

export function comparar(raiz) {
  const lista = join(raiz, 'tests', 'invariantes.txt');
  if (!existsSync(lista)) throw new Error('falta tests/invariantes.txt');
  const esperados = new Set(readFileSync(lista, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  const hallados = new Set();
  for (const f of archivos(join(raiz, 'tests'))) {
    for (const id of idsDeTitulos(readFileSync(f, 'utf8'))) hallados.add(id);
  }
  const faltan = [...esperados].filter((i) => !hallados.has(i)).sort();
  const desconocidos = [...hallados].filter((i) => !esperados.has(i)).sort();
  return { total: esperados.size, cubiertos: esperados.size - faltan.length, faltan, desconocidos };
}

const esPrincipal = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  const args = process.argv.slice(2);
  const informar = args.includes('--informar');
  const i = args.indexOf('--raiz');
  const raiz = i >= 0 && args[i + 1] ? resolve(args[i + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let r;
  try {
    r = comparar(raiz);
  } catch (e) {
    process.stderr.write(`check-invariantes: ${e instanceof Error ? e.message : 'error'}\n`);
    process.exit(2);
  }
  process.stdout.write(`check-invariantes: ${r.cubiertos}/${r.total} invariantes con prueba\n`);
  if (r.faltan.length) process.stdout.write(`Faltan (${r.faltan.length}): ${r.faltan.join(' ')}\n`);
  if (r.desconocidos.length) process.stdout.write(`Citados en pruebas pero ausentes de tests/invariantes.txt (${r.desconocidos.length}): ${r.desconocidos.join(' ')}\n`);
  const fallo = r.faltan.length > 0 || r.desconocidos.length > 0;
  process.exit(fallo && !informar ? 1 : 0);
}
