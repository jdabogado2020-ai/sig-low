// check-dist (9.1, paso 5 de verify): grep del build con lista permitida. Versión mínima de P0-1; PD-2 la completa
// (T-CD-01 a T-CD-04, T-PV-14). Uso: node scripts/check-dist.mjs [dir]   Sale 1 ante cualquier hallazgo.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname, basename, sep } from 'node:path';

const DIR = process.argv[2] ?? 'dist';
const MAX = 25 * 1024 * 1024;
const WASM_PERMITIDO = 'ort-wasm-simd-threaded.wasm';
const esOrtMjs = (r) => /^ort\/ort-wasm-simd-threaded(\.jsep)?\.mjs$/.test(r);

// Chunk de ORT-web empaquetado por Vite (aprobado en la P0-6a de PF-1b, 30-oct): `blob:` ×2 son comparaciones
// `startsWith('blob:')`/`indexOf('blob:')` que excluyen esas URL, y la única URL externa es el texto de un Error de
// rolldown que nunca se pide. Se admiten solo con esas cuentas exactas, en ese chunk y con la versión de ORT fijada.
const ORT_VERSION_APROBADA = '1.31.0-dev.20260914-8d85527a0';
const URL_ROLLDOWN = 'https://rolldown.rs/in-depth/bundling-cjs#require-external-modules';
const esChunkOrt = (r, t) => /^assets\/ort\.wasm\.min-[\w-]+\.js$/.test(r) && t.includes('ort-wasm-simd-threaded');
const versionOrt = () => {
  try {
    return JSON.parse(readFileSync('node_modules/onnxruntime-web/package.json', 'utf8')).version;
  } catch {
    return null;
  }
};

const PROHIBIDOS = [
  ['console', /\bconsole\s*\.\s*[a-z]+/g],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/g],
  ['WebSocket', /\bWebSocket\b/g],
  ['EventSource', /\bEventSource\b/g],
  ['sendBeacon', /\bsendBeacon\b/g],
  ['RTCPeerConnection-uso', /new\s+(webkit)?RTCPeerConnection\b/g],
  ['window.open', /\bwindow\.open\s*\(/g],
  ['localStorage', /\blocalStorage\b/g],
  ['sessionStorage', /\bsessionStorage\b/g],
  ['document.cookie', /\bdocument\.cookie\b/g],
  ['document.write', /\bdocument\.write(ln)?\s*\(/g],
  ['document.title=', /\bdocument\.title\s*=[^=]/g],
  ['outerHTML', /\bouterHTML\b/g],
  ['insertAdjacentHTML', /\binsertAdjacentHTML\b/g],
  ['eval', /\beval\s*\(/g],
  ['new Function', /\bnew\s+Function\s*\(/g],
  ['gancho-medicion', /__SIGLOW_GANCHO_MEDICION__/g],
  ['blob:', /\bblob:/g],
  ['data-url-script', /data:(text|application)\/(javascript|ecmascript)/g],
  ['http-externo', /https?:\/\/(?!127\.0\.0\.1|localhost|www\.w3\.org\/(1998|1999|2000)\/)[a-z0-9.-]+\.[a-z]{2,}/gi],
];
// Preact 10.29.8 contiene el sumidero innerHTML para dangerouslySetInnerHTML. El código propio no lo usa (lint F-05)
// y Trusted Types lo rechaza en ejecución: se admite solo en el fragmento de Preact y con tope de apariciones.
const TOPES_PREACT = { innerHTML: 3, dangerouslySetInnerHTML: 2 };

const hallazgos = [];
const archivos = [];
const recorrer = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    statSync(p).isDirectory() ? recorrer(p) : archivos.push(p);
  }
};
recorrer(DIR);

for (const p of archivos) {
  const r = relative(DIR, p).split(sep).join('/');
  const s = statSync(p).size;
  if (s > MAX) hallazgos.push(`${r}: ${s} B supera 25 MiB`);
  if (extname(p) === '.wasm' && basename(p) !== WASM_PERMITIDO) hallazgos.push(`${r}: .wasm no permitido`);
  if (!/\.(m?js|html|json|txt|webmanifest|css)$/.test(p) && basename(p) !== '_headers') continue;
  const t = readFileSync(p, 'utf8');
  for (const [nombre, re] of PROHIBIDOS) {
    // .mjs de ORT copiado tal cual (su SHA-256 lo fija PD-2): código de reserva de Emscripten.
    if (esOrtMjs(r) && (nombre === 'console' || nombre === 'blob:' || nombre === 'eval')) continue;
    if (esOrtMjs(r) && nombre === 'XMLHttpRequest' && (t.match(re) ?? []).length <= 2) continue;
    if (nombre === 'http-externo' && (r === '_headers' || /^ort\//.test(r))) continue;
    if (esChunkOrt(r, t) && (nombre === 'blob:' || nombre === 'http-externo')) {
      const m = t.match(re) ?? [];
      const tope = nombre === 'blob:' ? 2 : 1;
      const soloRolldown = nombre !== 'http-externo' || m.every((u) => URL_ROLLDOWN.startsWith(u));
      if (versionOrt() !== ORT_VERSION_APROBADA) hallazgos.push(`${r}: versión de ORT distinta de la aprobada; revisar las excepciones`);
      else if (m.length > tope || !soloRolldown) hallazgos.push(`${r}: ${nombre} ×${m.length} fuera de la excepción aprobada`);
      continue;
    }
    const n = (t.match(re) ?? []).length;
    if (n) hallazgos.push(`${r}: ${nombre} ×${n}`);
  }
  const esPreact = /__html/.test(t) && /\.__k\b/.test(t);
  for (const [nombre, tope] of Object.entries(TOPES_PREACT)) {
    const n = (t.match(new RegExp(`\\b${nombre}\\b`, 'g')) ?? []).length;
    if (n && (!esPreact || n > tope)) hallazgos.push(`${r}: ${nombre} ×${n} fuera del fragmento de Preact o sobre el tope ${tope}`);
  }
}

if (hallazgos.length) {
  process.stderr.write(`check-dist: ${hallazgos.length} hallazgo(s)\n${hallazgos.map((h) => '  - ' + h).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`check-dist: OK (${archivos.length} archivos en ${DIR})\n`);
