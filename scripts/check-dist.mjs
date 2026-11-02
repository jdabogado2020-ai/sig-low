// check-dist (9.1, paso 5 de verify; 10.5.5; T-CD-01 a T-CD-03 y T-PV-14). Revisa el build con lista permitida y sale con
// 1 ante cualquier hallazgo, con el nombre de la regla. Uso: node scripts/check-dist.mjs [dir]   (cwd = raíz del repositorio:
// lee package.json, package-lock.json y node_modules de ahí).
// Cada excepción va con su archivo (por nombre Y por contenido), su patrón y su cuenta máxima; si una librería cambia, la
// cuenta cambia y el integrador lo revisa. La minificación puede renombrar globales: esto es una defensa adicional y el
// control principal es el lint sobre el código fuente. Archivo crítico (V-22): el integrador aprueba su diff.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname, basename, sep } from 'node:path';

const DIR = process.argv[2] ?? 'dist';
const MAX = 25 * 1024 * 1024;
const hallazgos = [];
const fallar = (m) => { hallazgos.push(m); };
const leerJson = (ruta) => {
  try {
    return JSON.parse(readFileSync(ruta, 'utf8'));
  } catch {
    return null;
  }
};
const versionDe = (paquete) => leerJson(join('node_modules', paquete, 'package.json'))?.version ?? null;
const sha256 = (datos) => createHash('sha256').update(datos).digest('hex');

// ===== ORT-web (V-07, V-09; 3.2) =====
// Solo los dos archivos del build CPU, copiados tal cual a public/ort/: su SHA-256 debe ser el del paquete instalado Y el
// fijado aquí (los revisados en la P0-6a de PF-1b), con la versión aprobada. Nunca asyncify, jsep ni jspi.
const ORT_VERSION_APROBADA = '1.31.0-dev.20260914-8d85527a0';
const ORT_ARCHIVOS = {
  'ort-wasm-simd-threaded.mjs': 'c57ca56328877353a575e51bbca6f18450027d6c9bf2307a2cb2c41363b4de9f',
  'ort-wasm-simd-threaded.wasm': '06ba057753da3847e4c24f02d91ab133455b0817c69a44993a9a53a2146df9e3',
};
const WASM_PERMITIDO = 'ort-wasm-simd-threaded.wasm';
const esOrtMjs = (r) => r === 'ort/ort-wasm-simd-threaded.mjs';

// Chunk de ORT-web empaquetado por Vite (aprobado en la P0-6a de PF-1b, 30-oct): `blob:` ×2 son comparaciones
// `startsWith('blob:')`/`indexOf('blob:')` que excluyen esas URL, y la única URL externa es el texto de un Error de
// rolldown que nunca se pide. Se admiten solo con esas cuentas exactas, en ese chunk y con la versión de ORT fijada.
// `fetch(` ×2 (PD-2, medido en el arnés del modelo): la carga de un `.mjs` de otro origen y la de datos externos del modelo
// dados como cadena; ninguna se alcanza (`wasmPaths` del mismo origen, el modelo entra como bytes; P0-6a de PF-1b).
const URL_ROLLDOWN = 'https://rolldown.rs/in-depth/bundling-cjs#require-external-modules';
const esChunkOrt = (r, t) => /^assets\/ort\.wasm\.min-[\w-]+\.js$/.test(r) && t.includes('ort-wasm-simd-threaded');
const TOPES_CHUNK_ORT = { 'blob:': 2, 'http-externo': 1, fetch: 2 };

// Worker `ner` (PF-1b): su único `fetch(` es el de `/models/<id>/<ruta>` (F-01). Por nombre y por contener `/models/`.
const esWorkerNer = (r, t) => /^assets\/ner\.worker-[\w-]+\.js$/.test(r) && t.includes('/models/');
const TOPES_WORKER_NER = { fetch: 1 };

// Chunks de pdf.js legacy (aprobado en la P0-6a de PE-4, 30-oct, decisión 2). Solo con estas cuentas exactas y estas URL literales,
// solo en los dos chunks (identificados por nombre y por contener la versión) y solo con la versión de `pdfjs-dist` aprobada.
// Nada de esto se pide: son rutas de red de pdf.js que el lector no usa (solo pasa `data`), referencias de los decodificadores de
// imagen y cadenas de comparación de espacios de nombres XML. Ninguna excepción para `blob:`, `eval` ni `new Function`.
// PD-2 agrega, medidos en el build real y por los mismos motivos: `console-ref` (las mismas 5 referencias contadas con
// `\bconsole\b`: 4 `console.x.bind(console)` y 1 `console.warn`), `fetch(` (principal: `fetchData` y `PDFFetchStream`, más
// 2 métodos `fetch(` de pdf.js; worker: `fetchData` con `useWorkerFetch`, más 32 `XRef.fetch(`), y `Function-cadena`: solo
// el literal exacto de core-js `Function(\`return this\`)` (10.5.5), una vez por chunk.
const PDFJS_VERSION_APROBADA = '6.4.299';
const CORE_JS = ['https://github.com/zloirock/core-js/blob/v3.50.0/LICENSE', 'https://github.com/zloirock/core-js'];
const FUNCION_CORE_JS = /\bFunction\s*\(\s*`return this`\s*\)/g;
const EXCEPCIONES_PDFJS = {
  principal: {
    nombre: /^assets\/pdf-[\w-]+\.js$/,
    topes: { XMLHttpRequest: 3, console: 0, 'console-ref': 0, fetch: 4, 'Function-cadena': 1 },
    urls: [...CORE_JS, 'http://example.com', 'https://foo.bar', 'https://foo.bar'],
  },
  worker: {
    nombre: /^assets\/pdf\.worker-[\w-]+\.js$/,
    topes: { XMLHttpRequest: 1, console: 5, 'console-ref': 9, fetch: 33, 'Function-cadena': 1 },
    urls: [
      ...CORE_JS,
      ...['xci/', 'xfa-connection-set/', 'xfa-data/', 'xfa-data/1.0/', 'xfa-form/', 'xfa-locale-set/', 'xfa-source-set/', 'xfa-template/', 'xdc/']
        .map((p) => 'http://www.xfa.org/schema/' + p),
      ...['xdp/', 'xdp/pdf/', 'xfdf/', 'xmpmeta/'].map((p) => 'http://ns.adobe.com/' + p),
    ],
  },
};
/** Qué excepción de pdf.js le toca a este archivo: por nombre y por contener la versión aprobada. Si no, ninguna. */
const excepcionPdfjs = (r, t) => {
  for (const e of Object.values(EXCEPCIONES_PDFJS)) if (e.nombre.test(r) && t.includes(PDFJS_VERSION_APROBADA)) return e;
  return null;
};
const URL_LITERAL = /https?:\/\/[^\s"'`)\\]+/g;

// Guardia (src/guard.ts; 5.2.1, PD-2, PD-2-r1 y PD-2-r2): nombra las API que neutraliza en estos arreglos literales, una sola
// vez y solo en el chunk de entrada (el módulo que carga index.html) y en los tres workers propios (`detect`, `io`, `ner`, por
// nombre). Es el primer import de cada uno: en esos archivos los literales son obligatorios, exactamente una vez cada uno.
// Fuera de esos literales exactos, los nombres son hallazgos (en cualquier archivo).
const LITERALES_GUARDIA = [
  '[`RTCPeerConnection`,`webkitRTCPeerConnection`,`RTCDataChannel`]',
  '[`speechSynthesis`,`SpeechSynthesisUtterance`,`SpeechRecognition`,`webkitSpeechRecognition`]',
  '[`XSLTProcessor`,`documentPictureInPicture`]',
  '[`XMLHttpRequest`,`WebSocket`,`WebSocketStream`,`WebTransport`,`EventSource`,`fetchLater`,`open`]',
  '[`sendBeacon`,`share`]',
  '[`joinAdInterestGroup`,`runAdAuction`,`browsingTopics`]',
];
const REGLAS_GUARDIA = new Set([
  'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'WebTransport', 'EventSource', 'sendBeacon', 'WebRTC', 'fetchLater', 'voz',
  'xslt', 'pip-documento', 'publicidad',
]);
const esWorkerPropio = (r) => /^assets\/(?:detect|io|ner)\.worker-[\w-]+\.js$/.test(r);

const PROHIBIDOS = [
  ['console', /\bconsole\s*\.\s*[a-z]+/g],
  ['console-ref', /\bconsole\b/g],
  ['fetch', /\bfetch\s*\(/g],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/g],
  ['WebSocket', /\bWebSocket\b/g],
  // B-26: `\bWebSocket\b` no ve `WebSocketStream`, y `WebTransport` al propio origen lo admite la CSP (sale por UDP).
  ['WebSocketStream', /\bWebSocketStream\b/g],
  ['WebTransport', /\bWebTransport\b/g],
  ['EventSource', /\bEventSource\b/g],
  ['sendBeacon', /\bsendBeacon\b/g],
  ['WebRTC', /\b(?:webkit)?RTCPeerConnection\b|\bRTCDataChannel\b/g],
  // B-18: las voces en línea sintetizan en servidores del fabricante y el reconocimiento envía el audio; la app no los usa.
  ['voz', /\b(?:speechSynthesis|SpeechSynthesis\w*|(?:webkit)?SpeechRecognition\w*)\b/g],
  // Realms sin createElement (M-4): una transformación XSLT crea un iframe (B-25) y una ventana Picture-in-Picture de
  // documento trae su propio realm (PD-2-r2); los dos dan WebRTC sin guardia.
  ['xslt', /\bXSLTProcessor\b/g],
  ['pip-documento', /\bdocumentPictureInPicture\b/g],
  // Protected Audience y Topics (PD-2-r2): la app no los usa.
  ['publicidad', /\b(?:joinAdInterestGroup|runAdAuction|browsingTopics)\b/g],
  ['fetchLater', /\bfetchLater\b/g],
  ['navigator.share', /\bnavigator\s*\.\s*share\b/g],
  ['window.open', /\bwindow\s*\.\s*open\s*\(/g],
  // `document.open(url, nombre, opciones)` abre una ventana como window.open (V-03).
  ['document.open', /\bdocument\s*\.\s*open\s*\(/g],
  ['location=', /\blocation\s*(?:\.\s*(?:href|hash|search|pathname|host|hostname|protocol|port)\s*)?=(?!=)|\blocation\s*\.\s*(?:assign|replace)\s*\(/g],
  ['history', /\b(?:pushState|replaceState)\b/g],
  ['localStorage', /\blocalStorage\b/g],
  ['sessionStorage', /\bsessionStorage\b/g],
  ['document.cookie', /\bdocument\.cookie\b/g],
  ['document.write', /\bdocument\s*\.\s*write(?:ln)?\s*\(/g],
  ['document.title=', /\bdocument\s*\.\s*title\s*=(?!=)/g],
  ['outerHTML', /\bouterHTML\b/g],
  ['insertAdjacentHTML', /\binsertAdjacentHTML\b/g],
  ['eval', /\beval\s*\(/g],
  ['new Function', /\bnew\s+Function\s*\(/g],
  ['Function-cadena', /\bFunction\s*\(\s*["'`]/g],
  ['gancho-medicion', /__SIGLOW_GANCHO_MEDICION__/g],
  ['reportes', /\breport-(?:uri|to)\b|__siglowMedicion|csp-probe/g],
  ['blob:', /\bblob:/g],
  ['data-url-script', /data:(?:text|application)\/(?:javascript|ecmascript)/g],
  // Identificadores de espacio de nombres de XML (W3C, OOXML y su variante Strict): se comparan como cadenas en el
  // lector .docx y en Preact; nunca se piden por red (la CSP y el interruptor del SW lo impedirían igual).
  ['http-externo', /https?:\/\/(?!www\.w3\.org\/(1998|1999|2000|XML\/1998)\/|schemas\.openxmlformats\.org\/(wordprocessingml|markup-compatibility|officeDocument|package|drawingml|spreadsheetml|presentationml)\/|purl\.oclc\.org\/ooxml\/)[a-z0-9.-]+\.[a-z]{2,}/gi],
  // URL que `http-externo` no ve: a una IP o a localhost (sin dominio de primer nivel), y WebSocket.
  ['url-ip-local', /\b(?:https?|wss?):\/\/(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]*\]|localhost\b)/gi],
  ['url-ws', /\bwss?:\/\//g],
  // T-PV-14 (V-04 a V-06, V-21, V-42): precarga de DNS y conexiones, telemetría, visor y scripting de pdf.js y paquetes de Node.
  ['dns-prefetch', /(?<!x-)dns-prefetch(?!-control)/gi],
  ['preconnect', /\bpreconnect\b/gi],
  ['telemetria', /\b(?:sentry|analytics|gtag|cloudflareinsights)\b/gi],
  ['pdf_viewer', /pdf_viewer/g],
  ['enableScripting', /\benableScripting\s*:\s*(?:!0|true)\b/g],
  ['onnxruntime-node', /onnxruntime-node/g],
  ['sharp', /["'`](?:@img\/)?sharp["'`/]/g],
];
// Solo en HTML y CSS (assetsInlineLimit: 0): recursos incrustados como `data:`.
const PROHIBIDOS_HTML_CSS = [['data-html-css', /\bsrc\s*=\s*["']data:|url\(\s*["']?data:/g]];

// Preact 10.29.8 contiene el sumidero innerHTML para dangerouslySetInnerHTML. El código propio no lo usa (lint F-05)
// y Trusted Types lo rechaza en ejecución: se admite solo en el fragmento de Preact y con tope de apariciones.
const TOPES_PREACT = { innerHTML: 3, dangerouslySetInnerHTML: 2 };

// Registro del service worker (B-50; B-40 ofrecía lo mismo): la petición del script de un SW no pasa por el SW y la CSP admite
// rutas por prefijo (/assets/…), así que un `register('/assets/<dato>.js')` llevaría el dato al registro del alojamiento. La
// política de Trusted Types y la guardia solo dejan pasar `/sw.js`; aquí se exige que el build tenga UN solo
// `navigator.serviceWorker.register`, con la cadena literal `/sw.js` como primer argumento (la guardia no cuenta: no nombra
// `serviceWorker` antes de `register`). Cualquier otra forma (corchetes, `.call`, un alias del objeto) es un hallazgo.
const REGISTRO_SW = /\bserviceWorker\s*(?:\?\s*\.|\.)\s*register\b(\s*\(\s*([^),]*))?/g;
const REGISTRO_SW_CORCHETES = /\bserviceWorker\s*(?:\?\s*\.)?\s*\[\s*["'`]register["'`]\s*\]/g;
const registrosSW = [];

// ===== CSP y cabeceras (3.6; T-CS-07). El integrador aprueba cada línea: un cambio en public/_headers o en el <meta> exige
// cambiar también estas constantes. =====
const CSP_CANONICA = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; font-src 'self'; manifest-src 'self'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types default";
const CSP_RUTAS = "script-src 'wasm-unsafe-eval' *:*/assets/ *:*/ort/ *:*/tt-policy.js; worker-src *:*/assets/ *:*/ort/ *:*/sw.js; connect-src https: http:";
const CABECERAS_TODAS = {
  'Content-Security-Policy': `${CSP_CANONICA}, ${CSP_RUTAS}`,
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-DNS-Prefetch-Control': 'off',
  'X-Frame-Options': 'DENY',
  // PD-2-r2 (aprobado por el integrador): cinco rasgos que Chromium reconoce sin aviso, `browsing-topics`, los dos de Private
  // State Tokens, `identity-credentials-get` (FedCM) e `interest-cohort` (`join-ad-interest-group`, `run-ad-auction` y
  // `attribution-reporting` dan «Unrecognized feature»; los cubre la guardia).
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), display-capture=(), clipboard-read=(), clipboard-write=(self), browsing-topics=(), private-state-token-issuance=(), private-state-token-redemption=(), identity-credentials-get=(), interest-cohort=()',
};
const QUITAR_TODAS = ['Access-Control-Allow-Origin']; // Cloudflare Pages lo agrega por defecto (entrega/despliegues.md)
const CACHE = {
  '/': 'no-cache, no-transform',
  '/index.html': 'no-cache, no-transform',
  '/sw.js': 'no-cache, no-transform',
  '/assets/*': 'public, max-age=31536000, immutable',
};
// Rutas de muestra para comprobar que ninguna cabecera llega desde dos reglas (Cloudflare uniría los valores; el SW y
// server.mjs se quedan con el último).
const RUTAS_MUESTRA = ['/', '/index.html', '/sw.js', '/assets/x.js', '/ort/ort-wasm-simd-threaded.wasm', '/tt-policy.js', '/precache.json', '/models/x/manifest.json', '/otra'];

// ===== Dependencias (T-PV-14, V-06; 4.1 y 5.2.2). Lista blanca de ejecución con sus versiones, y el cierre exacto de
// paquetes de ejecución del lockfile (incluidos los opcionales). Un cambio exige aprobación (F-04). =====
const DEPENDENCIAS_APROBADAS = {
  '@huggingface/tokenizers': '0.2.0', '@xmldom/xmldom': '0.9.12', fflate: '0.8.3',
  'onnxruntime-web': ORT_VERSION_APROBADA, 'pdfjs-dist': PDFJS_VERSION_APROBADA, preact: '10.29.8',
};
const LOCKFILE_EJECUCION = [
  '@huggingface/tokenizers@0.2.0', '@napi-rs/canvas@1.0.13', '@napi-rs/canvas-android-arm64@1.0.13',
  '@napi-rs/canvas-darwin-arm64@1.0.13', '@napi-rs/canvas-darwin-x64@1.0.13', '@napi-rs/canvas-linux-arm-gnueabihf@1.0.13',
  '@napi-rs/canvas-linux-arm64-gnu@1.0.13', '@napi-rs/canvas-linux-arm64-musl@1.0.13', '@napi-rs/canvas-linux-riscv64-gnu@1.0.13',
  '@napi-rs/canvas-linux-x64-gnu@1.0.13', '@napi-rs/canvas-linux-x64-musl@1.0.13', '@napi-rs/canvas-win32-arm64-msvc@1.0.13',
  '@napi-rs/canvas-win32-x64-msvc@1.0.13', '@protobufjs/aspromise@1.1.2', '@protobufjs/base64@1.1.2', '@protobufjs/codegen@2.0.5',
  '@protobufjs/eventemitter@1.1.1', '@protobufjs/fetch@1.1.1', '@protobufjs/float@1.0.2', '@protobufjs/path@1.1.2',
  '@protobufjs/pool@1.1.0', '@protobufjs/utf8@1.1.2', '@types/node@26.6.6', '@xmldom/xmldom@0.9.12', 'fflate@0.8.3',
  'flatbuffers@25.9.23', 'guid-typescript@1.0.9', 'long@5.3.2', 'onnxruntime-common@1.31.0-dev.20260911-2a43ec07e',
  `onnxruntime-web@${ORT_VERSION_APROBADA}`, `pdfjs-dist@${PDFJS_VERSION_APROBADA}`, 'platform@1.3.6', 'preact@10.29.8',
  'protobufjs@7.6.6', 'undici-types@8.9.0',
];
// Paquetes de ejecución con script de instalación: no corren nunca (`npm ci --ignore-scripts`, V-06), pero se fijan.
const CON_SCRIPT_DE_INSTALACION = ['protobufjs'];

// ===== Recorrido =====
const archivos = [];
const recorrer = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    statSync(p).isDirectory() ? recorrer(p) : archivos.push(p);
  }
};
recorrer(DIR);
const rel = (p) => relative(DIR, p).split(sep).join('/');
const html = existsSync(join(DIR, 'index.html')) ? readFileSync(join(DIR, 'index.html'), 'utf8') : '';
// Chunk de entrada: el módulo que carga index.html (por nombre y por la referencia del HTML).
const entrada = /<script\b[^>]*\btype="module"[^>]*\bsrc="\/(assets\/index-[\w-]+\.js)"/.exec(html)?.[1] ?? null;

// ===== Archivos =====
for (const p of archivos) {
  const r = rel(p);
  const s = statSync(p).size;
  if (s > MAX) fallar(`${r}: tamaño ${s} B supera 25 MiB`);
  if (extname(p) === '.wasm' && basename(p) !== WASM_PERMITIDO) fallar(`${r}: wasm no permitido`);
  if (r.endsWith('.map')) fallar(`${r}: mapa de fuentes`);
  if (/asyncify|jsep|jspi/i.test(r)) fallar(`${r}: variante de ORT no permitida (asyncify, jsep, jspi)`);
  if (/(^|\/)(standard_fonts|cmaps|iccs|wasm)\//.test(r)) fallar(`${r}: recursos de pdf.js que el lector no usa`);
  if (r.startsWith('ort/') && !Object.hasOwn(ORT_ARCHIVOS, r.slice(4))) fallar(`${r}: archivo no permitido en ort/`);
}

// Auxiliares del modelo (P0-5): `models/<id>/tokenizer*.json` son datos que el worker `ner` lee como JSON, no código, y su
// vocabulario trae palabras como «localStorage» o «console». No se barren solo si su SHA-256 es el del manifiesto de su modelo
// (fijado en H0-5/H0-6, el mismo que exige MODELO_INTEGRIDAD al cargar); uno alterado se barre como cualquier otro archivo.
const auxiliarVerificado = (r, p) => {
  const m = /^models\/([\w-]+)\/(tokenizer(?:_config)?\.json)$/.exec(r);
  if (!m) return false;
  const manifiesto = leerJson(join(DIR, 'models', m[1], 'manifest.json'));
  const aux = manifiesto?.auxiliares?.find((a) => a.ruta === m[2]);
  return aux !== undefined && aux.sha256 === sha256(readFileSync(p));
};

// ===== Contenido =====
for (const p of archivos) {
  const r = rel(p);
  if (!/\.(m?js|html|json|txt|webmanifest|css)$/.test(p) && basename(p) !== '_headers') continue;
  if (auxiliarVerificado(r, p)) continue;
  const t = readFileSync(p, 'utf8');
  // Literales de la guardia: se quitan del texto (una vez cada uno) solo en el chunk de entrada y en los workers propios, y
  // solo si están exactos. En esos archivos son obligatorios: si falta uno o se repite, la guardia no es su primer import.
  let tGuardia = t;
  if (r === entrada || esWorkerPropio(r)) {
    if (LITERALES_GUARDIA.every((l) => t.split(l).length === 2)) for (const l of LITERALES_GUARDIA) tGuardia = tGuardia.replace(l, '');
    else fallar(`${r}: guardia ausente o alterada (src/guard.ts, con cada arreglo exactamente una vez)`);
  }
  const exPdf = excepcionPdfjs(r, t);
  const reglas = [...PROHIBIDOS, ...(/\.(html|css)$/.test(r) ? PROHIBIDOS_HTML_CSS : [])];
  for (const [nombre, re] of reglas) {
    const texto = REGLAS_GUARDIA.has(nombre) ? tGuardia : t;
    const m = texto.match(re) ?? [];
    const n = m.length;
    // .mjs de ORT copiado tal cual (su SHA-256 se compara abajo con el paquete y con el fijado): código de reserva de Emscripten.
    if (esOrtMjs(r) && ['console', 'console-ref', 'blob:', 'eval', 'fetch'].includes(nombre)) continue;
    if (esOrtMjs(r) && nombre === 'XMLHttpRequest' && n <= 2) continue;
    if (nombre === 'http-externo' && /^ort\//.test(r)) continue;
    if (r === 'sw.js' && nombre === 'fetch' && n <= 1) continue; // el interruptor de red (3.2): una sola salida, verificada
    if (esWorkerNer(r, t) && Object.hasOwn(TOPES_WORKER_NER, nombre)) {
      if (n > TOPES_WORKER_NER[nombre]) fallar(`${r}: ${nombre} ×${n} fuera de la excepción aprobada (tope ${TOPES_WORKER_NER[nombre]})`);
      continue;
    }
    if (esChunkOrt(r, t) && Object.hasOwn(TOPES_CHUNK_ORT, nombre)) {
      const soloRolldown = nombre !== 'http-externo' || m.every((u) => URL_ROLLDOWN.startsWith(u));
      if (versionDe('onnxruntime-web') !== ORT_VERSION_APROBADA) fallar(`${r}: versión de ORT distinta de la aprobada; revisar las excepciones`);
      else if (n > TOPES_CHUNK_ORT[nombre] || !soloRolldown) fallar(`${r}: ${nombre} ×${n} fuera de la excepción aprobada`);
      continue;
    }
    if (exPdf !== null && Object.hasOwn(exPdf.topes, nombre)) {
      // Function-cadena: solo cuenta como excepción el literal exacto de core-js; cualquier otra forma es un hallazgo.
      const exactas = nombre === 'Function-cadena' ? (t.match(FUNCION_CORE_JS) ?? []).length : n;
      if (versionDe('pdfjs-dist') !== PDFJS_VERSION_APROBADA) fallar(`${r}: versión de pdfjs-dist distinta de la aprobada; revisar las excepciones`);
      else if (n > exPdf.topes[nombre] || exactas !== n) fallar(`${r}: ${nombre} ×${n} fuera de la excepción aprobada (tope ${exPdf.topes[nombre]})`);
      continue;
    }
    if (exPdf !== null && nombre === 'http-externo') {
      const reUna = new RegExp(re.source, 'i');
      const vistas = (t.match(URL_LITERAL) ?? []).filter((u) => reUna.test(u)).sort();
      const aprobadas = [...exPdf.urls].sort();
      if (versionDe('pdfjs-dist') !== PDFJS_VERSION_APROBADA) fallar(`${r}: versión de pdfjs-dist distinta de la aprobada; revisar las excepciones`);
      else if (n !== aprobadas.length || JSON.stringify(vistas) !== JSON.stringify(aprobadas)) {
        fallar(`${r}: URL externas fuera de la lista literal aprobada (${n} halladas, ${aprobadas.length} aprobadas)`);
      }
      continue;
    }
    if (n) fallar(`${r}: ${nombre} ×${n}`);
  }
  for (const m of t.matchAll(REGISTRO_SW)) registrosSW.push({ r, llamada: m[1] !== undefined, arg: (m[2] ?? '').trim() });
  const porCorchetes = (t.match(REGISTRO_SW_CORCHETES) ?? []).length;
  if (porCorchetes) fallar(`${r}: sw-registro: serviceWorker["register"] ×${porCorchetes} (el registro debe ser navigator.serviceWorker.register('/sw.js'))`);
  const esPreact = /__html/.test(t) && /\.__k\b/.test(t);
  for (const [nombre, tope] of Object.entries(TOPES_PREACT)) {
    const n = (t.match(new RegExp(`\\b${nombre}\\b`, 'g')) ?? []).length;
    if (n && (!esPreact || n > tope)) fallar(`${r}: ${nombre} ×${n} fuera del fragmento de Preact o sobre el tope ${tope}`);
  }
}

// ===== Registro del service worker (B-50) =====
if (registrosSW.length !== 1) {
  fallar(`sw-registro: debe haber exactamente un navigator.serviceWorker.register y hay ${registrosSW.length}${registrosSW.length ? ` (${registrosSW.map((x) => x.r).join(', ')})` : ''}`);
}
for (const x of registrosSW) {
  if (!x.llamada) fallar(`${x.r}: sw-registro: serviceWorker.register fuera de una llamada directa`);
  else if (!/^(["'`])\/sw\.js\1$/.test(x.arg)) fallar(`${x.r}: sw-registro: el primer argumento de register debe ser la cadena literal /sw.js`);
}

// ===== ORT: los dos archivos, idénticos al paquete y a los fijados =====
const ortInstalada = versionDe('onnxruntime-web');
if (ortInstalada !== ORT_VERSION_APROBADA) fallar(`ort: onnxruntime-web ${ortInstalada ?? 'no instalado'} distinto de ${ORT_VERSION_APROBADA}`);
for (const [nombre, fijado] of Object.entries(ORT_ARCHIVOS)) {
  const enDist = join(DIR, 'ort', nombre);
  if (!existsSync(enDist)) { fallar(`ort/${nombre}: falta`); continue; }
  const hash = sha256(readFileSync(enDist));
  const delPaquete = join('node_modules', 'onnxruntime-web', 'dist', nombre);
  if (hash !== fijado) fallar(`ort/${nombre}: sha256 distinto del fijado`);
  if (!existsSync(delPaquete) || sha256(readFileSync(delPaquete)) !== hash) fallar(`ort/${nombre}: sha256 distinto del paquete instalado`);
}

// ===== index.html (8.7, V-04, V-05, V-27, V-43) =====
const regla = (cond, mensaje) => { if (!cond) fallar(`index.html: ${mensaje}`); };
if (!html) fallar('index.html: falta');
else {
  const etiquetas = html.match(/<[a-z][^>]*>/gi) ?? [];
  regla((html.match(/<html\b[^>]*>/gi) ?? []).length === 1 && /<html lang="es-CO" translate="no">/.test(html), 'html-lang: falta <html lang="es-CO" translate="no">');
  regla(/<meta name="google" content="notranslate"\s*\/?>/.test(html), 'meta-notranslate: falta <meta name="google" content="notranslate">');
  regla(/<meta http-equiv="x-dns-prefetch-control" content="off"\s*\/?>/.test(html), 'meta-dns-prefetch: falta x-dns-prefetch-control off');
  regla((html.match(/<title>[^<]*<\/title>/g) ?? []).join('') === '<title>Sig-Low</title>', 'titulo: el único título debe ser <title>Sig-Low</title>');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  regla(scripts.every(([, atr, cuerpo]) => /\bsrc="[^"]+"/.test(atr) && cuerpo.trim() === ''), 'script-en-linea: hay un <script> sin src o con contenido');
  regla(etiquetas.every((e) => !/\son[a-z]+\s*=/i.test(e)), 'atributo-on: hay un atributo on*=');
  regla(scripts.length === 2 && /\bsrc="\/tt-policy\.js"/.test(scripts[0][1]) && !/type=/.test(scripts[0][1]) && entrada !== null && scripts[1][1].includes(`src="/${entrada}"`),
    'orden-scripts: deben ser /tt-policy.js (clásico) y después el módulo de entrada, y ningún otro');
  regla(!/<a\b[^>]*\bhref/i.test(html), 'enlace: hay un <a href>');
  regla(!/<(base|iframe|frame|form|object|embed)\b/i.test(html), 'elemento-prohibido: <base>, <iframe>, <form>, <object> o <embed>');
  regla(!/<link\b[^>]*\brel="(?:dns-prefetch|preconnect|prefetch|prerender|preload)"/i.test(html), 'link-precarga: <link> de precarga o conexión anticipada');
  // CSP de respaldo: un <meta> por política, al inicio del <head> (antes de cualquier script o enlace).
  const metas = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"\s*\/?>/g)];
  const primerRecurso = html.search(/<(script|link)\b/i);
  regla(metas.length === 2 && metas.every((m) => m.index < primerRecurso), 'meta-csp: deben ser dos <meta> de CSP antes del primer script o enlace');
  const sinFa = CSP_CANONICA.replace("; frame-ancestors 'none'", '');
  regla(metas[0]?.[1] === sinFa && metas[1]?.[1] === CSP_RUTAS, 'meta-csp: distinta de la aprobada (la de la cabecera sin frame-ancestors)');
}

// ===== _headers (3.6; T-CS-07) =====
const cabeceras = existsSync(join(DIR, '_headers')) ? readFileSync(join(DIR, '_headers'), 'utf8') : null;
if (cabeceras === null) fallar('_headers: falta');
else {
  /** El mismo formato que lee tests/e2e/server.mjs y vite-plugins/precache.ts; las líneas `! Nombre` quitan una cabecera. */
  const reglasH = [];
  let actual = null;
  for (const linea of cabeceras.split(/\r?\n/)) {
    if (!linea.trim() || linea.trim().startsWith('#')) continue;
    if (!/^\s/.test(linea)) { actual = { patron: linea.trim(), pares: [], quitar: [] }; reglasH.push(actual); continue; }
    if (!actual) continue;
    const quita = /^\s*!\s*([\w-]+)\s*$/.exec(linea);
    if (quita) { actual.quitar.push(quita[1]); continue; }
    const i = linea.indexOf(':');
    if (i > 0) actual.pares.push([linea.slice(0, i).trim(), linea.slice(i + 1).trim()]);
    else fallar(`_headers: línea no válida «${linea.trim()}»`);
  }
  const coincide = (patron, ruta) => new RegExp('^' + patron.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(ruta);
  const todas = reglasH.find((x) => x.patron === '/*');
  if (!todas) fallar('_headers: falta la regla /*');
  else {
    const vistas = Object.fromEntries(todas.pares);
    for (const [k, v] of Object.entries(CABECERAS_TODAS)) if (vistas[k] !== v) fallar(`_headers: /* ${k} distinta de la aprobada`);
    for (const [k] of todas.pares) if (!Object.hasOwn(CABECERAS_TODAS, k)) fallar(`_headers: /* ${k} no está en la lista aprobada`);
    for (const k of QUITAR_TODAS) if (!todas.quitar.includes(k)) fallar(`_headers: /* falta «! ${k}»`);
  }
  for (const [patron, valor] of Object.entries(CACHE)) {
    const x = reglasH.find((y) => y.patron === patron);
    if (!x || x.pares.length !== 1 || x.pares[0][0] !== 'Cache-Control' || x.pares[0][1] !== valor) fallar(`_headers: ${patron} debe llevar solo Cache-Control: ${valor}`);
  }
  for (const x of reglasH) if (x.patron !== '/*' && !Object.hasOwn(CACHE, x.patron)) fallar(`_headers: regla ${x.patron} no aprobada`);
  for (const ruta of RUTAS_MUESTRA) {
    const vistas = new Map();
    for (const x of reglasH) {
      if (!coincide(x.patron, ruta)) continue;
      for (const [k] of x.pares) {
        if (vistas.has(k.toLowerCase())) fallar(`_headers: ${k} llega a ${ruta} desde dos reglas (${vistas.get(k.toLowerCase())} y ${x.patron})`);
        vistas.set(k.toLowerCase(), x.patron);
      }
    }
  }
}

// ===== Dependencias (T-PV-14) =====
const pkg = leerJson('package.json');
const lock = leerJson('package-lock.json');
if (!pkg || !lock?.packages) fallar('dependencias: faltan package.json o package-lock.json');
else {
  const deps = pkg.dependencies ?? {};
  if (JSON.stringify(Object.entries(deps).sort()) !== JSON.stringify(Object.entries(DEPENDENCIAS_APROBADAS).sort())) {
    fallar('dependencias: package.json dependencies distinto de la lista blanca de ejecución (4.1, 5.2.2)');
  }
  const ejecucion = Object.entries(lock.packages).filter(([k, v]) => k !== '' && !v.dev);
  const vistos = ejecucion.map(([k, v]) => `${k.replace(/^.*node_modules\//, '')}@${v.version}`).sort();
  const sobran = vistos.filter((x) => !LOCKFILE_EJECUCION.includes(x));
  const faltan = LOCKFILE_EJECUCION.filter((x) => !vistos.includes(x));
  if (sobran.length || faltan.length) fallar(`dependencias: paquetes de ejecución del lockfile fuera de la lista (sobran: ${sobran.join(', ') || '—'}; faltan: ${faltan.join(', ') || '—'})`);
  const conScript = ejecucion.filter(([, v]) => v.hasInstallScript).map(([k]) => k.replace(/^.*node_modules\//, '')).sort();
  if (JSON.stringify(conScript) !== JSON.stringify(CON_SCRIPT_DE_INSTALACION)) fallar(`dependencias: paquetes de ejecución con script de instalación: ${conScript.join(', ') || '—'}`);
  for (const [k, v] of Object.entries(lock.packages)) {
    if (k === '' || v.link) continue;
    if (!v.integrity || !/^https:\/\/registry\.npmjs\.org\//.test(v.resolved ?? '')) fallar(`dependencias: ${k} sin integridad o fuera del registro de npm`);
  }
}

if (hallazgos.length) {
  process.stderr.write(`check-dist: ${hallazgos.length} hallazgo(s)\n${hallazgos.map((h) => '  - ' + h).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`check-dist: OK (${archivos.length} archivos en ${DIR})\n`);
