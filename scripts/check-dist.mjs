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

// Chunks de pdf.js legacy (aprobado en la P0-6a de PE-4, 30-oct, decisión 2). Solo con estas cuentas exactas y estas URL literales,
// solo en los dos chunks (identificados por nombre y por contener la versión) y solo con la versión de `pdfjs-dist` aprobada.
// Nada de esto se pide: son rutas de red de pdf.js que el lector no usa (solo pasa `data`), referencias de los decodificadores de
// imagen y cadenas de comparación de espacios de nombres XML. Ninguna excepción para `blob:`, `eval` ni `new Function`.
const PDFJS_VERSION_APROBADA = '6.4.299';
const CORE_JS = ['https://github.com/zloirock/core-js/blob/v3.50.0/LICENSE', 'https://github.com/zloirock/core-js'];
const EXCEPCIONES_PDFJS = {
  principal: {
    nombre: /^assets\/pdf-[\w-]+\.js$/,
    topes: { XMLHttpRequest: 3, console: 0 },
    urls: [...CORE_JS, 'http://example.com', 'https://foo.bar', 'https://foo.bar'],
  },
  worker: {
    nombre: /^assets\/pdf\.worker-[\w-]+\.js$/,
    topes: { XMLHttpRequest: 1, console: 5 },
    urls: [
      ...CORE_JS,
      ...['xci/', 'xfa-connection-set/', 'xfa-data/', 'xfa-data/1.0/', 'xfa-form/', 'xfa-locale-set/', 'xfa-source-set/', 'xfa-template/', 'xdc/']
        .map((p) => 'http://www.xfa.org/schema/' + p),
      ...['xdp/', 'xdp/pdf/', 'xfdf/', 'xmpmeta/'].map((p) => 'http://ns.adobe.com/' + p),
    ],
  },
};
const versionPdfjs = () => {
  try {
    return JSON.parse(readFileSync('node_modules/pdfjs-dist/package.json', 'utf8')).version;
  } catch {
    return null;
  }
};
/** Qué excepción de pdf.js le toca a este archivo: por nombre y por contener la versión aprobada. Si no, ninguna. */
const excepcionPdfjs = (r, t) => {
  for (const e of Object.values(EXCEPCIONES_PDFJS)) if (e.nombre.test(r) && t.includes(PDFJS_VERSION_APROBADA)) return e;
  return null;
};
const URL_LITERAL = /https?:\/\/[^\s"'`)\\]+/g;

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
  // Identificadores de espacio de nombres de XML (W3C, OOXML y su variante Strict): se comparan como cadenas en el
  // lector .docx y en Preact; nunca se piden por red (la CSP y el interruptor del SW lo impedirían igual).
  ['http-externo', /https?:\/\/(?!127\.0\.0\.1|localhost|www\.w3\.org\/(1998|1999|2000|XML\/1998)\/|schemas\.openxmlformats\.org\/(wordprocessingml|markup-compatibility|officeDocument|package|drawingml|spreadsheetml|presentationml)\/|purl\.oclc\.org\/ooxml\/)[a-z0-9.-]+\.[a-z]{2,}/gi],
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
    const exPdf = excepcionPdfjs(r, t);
    if (exPdf !== null && (nombre === 'XMLHttpRequest' || nombre === 'console')) {
      const cuenta = (t.match(re) ?? []).length;
      if (versionPdfjs() !== PDFJS_VERSION_APROBADA) hallazgos.push(`${r}: versión de pdfjs-dist distinta de la aprobada; revisar las excepciones`);
      else if (cuenta > exPdf.topes[nombre]) hallazgos.push(`${r}: ${nombre} ×${cuenta} fuera de la excepción aprobada (tope ${exPdf.topes[nombre]})`);
      continue;
    }
    if (exPdf !== null && nombre === 'http-externo') {
      const reUna = new RegExp(re.source, 'i');
      const vistas = (t.match(URL_LITERAL) ?? []).filter((u) => reUna.test(u)).sort();
      const aprobadas = [...exPdf.urls].sort();
      const cuenta = (t.match(re) ?? []).length;
      if (versionPdfjs() !== PDFJS_VERSION_APROBADA) hallazgos.push(`${r}: versión de pdfjs-dist distinta de la aprobada; revisar las excepciones`);
      else if (cuenta !== aprobadas.length || JSON.stringify(vistas) !== JSON.stringify(aprobadas)) {
        hallazgos.push(`${r}: URL externas fuera de la lista literal aprobada (${cuenta} halladas, ${aprobadas.length} aprobadas)`);
      }
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
