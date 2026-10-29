#!/usr/bin/env node
// T-BI-04 / paso 7 de `verify`: el repositorio público no contiene material privado.
// Sale 1 si en el árbol de trabajo existe: bitacora/, prompts/, corpus/gen/, el plan técnico (*Plan_Tecnico*),
// docs/piloto.md o la plantilla de consentimiento (docs/consentimiento*, *consentimiento*.md).
// Ignora node_modules/, dist/ y .git/. Solo mira nombres de ruta: no lee el contenido de ningún archivo.
// Node puro, sin dependencias; tarda muy por debajo de 5 s.
//
//   node scripts/check-publico.mjs [--raiz <dir>]
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IGNORAR = new Set(['node_modules', 'dist', '.git']);

/** Devuelve [{ ruta, motivo }] con rutas relativas a `raiz` y separadores '/'. */
export function verificar(raiz) {
  const hallazgos = [];
  const recorrer = (dir, rel) => {
    let entradas;
    try {
      entradas = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      if (IGNORAR.has(e.name)) continue;
      const ruta = rel ? `${rel}/${e.name}` : e.name;
      const nombre = e.name.toLowerCase();
      const rutaMin = ruta.toLowerCase();
      const motivo = motivoPrivado(nombre, rutaMin, e.isDirectory());
      if (motivo) hallazgos.push({ ruta: e.isDirectory() ? `${ruta}/` : ruta, motivo });
      if (e.isDirectory()) recorrer(join(dir, e.name), ruta);
    }
  };
  recorrer(raiz, '');
  return hallazgos;
}

function motivoPrivado(nombre, rutaMin, esDir) {
  if (esDir && nombre === 'bitacora') return 'bitácora';
  if (esDir && nombre === 'prompts') return 'instrucciones a los agentes';
  if (esDir && (rutaMin === 'corpus/gen' || rutaMin.endsWith('/corpus/gen'))) return 'generador del corpus';
  if (nombre.includes('plan_tecnico')) return 'plan técnico';
  if (!esDir && (rutaMin === 'docs/piloto.md' || rutaMin.endsWith('/docs/piloto.md'))) return 'protocolo de piloto';
  if (/(^|\/)docs\/consentimiento[^/]*$/.test(rutaMin)) return 'plantilla de consentimiento';
  if (!esDir && nombre.endsWith('.md') && nombre.includes('consentimiento')) return 'plantilla de consentimiento';
  return null;
}

const esPrincipal = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--raiz');
  const raiz = i >= 0 && args[i + 1] ? resolve(args[i + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const hallazgos = verificar(raiz);
  if (hallazgos.length === 0) {
    process.stdout.write('check-publico: sin material privado\n');
    process.exit(0);
  }
  process.stderr.write(`check-publico: ${hallazgos.length} hallazgo(s) de material privado en el repositorio público\n`);
  for (const h of hallazgos) process.stderr.write(`  ${h.ruta}  (${h.motivo})\n`);
  process.exit(1);
}
