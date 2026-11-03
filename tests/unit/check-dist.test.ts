// T-CD-01 a T-CD-04 (10.5.5; PD-2): check-dist y las dependencias fijadas. Cada caso arma un «dist» sintético en un
// directorio temporal (con package.json, package-lock.json y node_modules mínimos al lado, porque check-dist los lee desde
// su cwd) y corre scripts/check-dist.mjs. El caso limpio sale de los archivos reales del repositorio (index.html,
// public/_headers, public/tt-policy.js, public/ort/), así que un cambio en ellos sin su cambio en check-dist se nota aquí.
// T-CD-01 es el paso 5 de `npm run verify` (check-dist sobre el build real). Los canarios se generan aquí, no en
// tests/fixtures/dist-malo/: uno es un archivo de 26 MiB. Solo datos ficticios.
// Incluye, sin cambios en sus aserciones, las pruebas de la excepción de pdf.js que PE-4-r2 dejó en check-dist-pdfjs.test.ts.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, ftruncateSync, linkSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const REPO = resolve('.');
const SCRIPT = join(REPO, 'scripts/check-dist.mjs');
const RAIZ = mkdtempSync(join(tmpdir(), 'siglow-checkdist-'));
afterAll(() => { rmSync(RAIZ, { recursive: true, force: true }); });

const ENTRADA = 'assets/index-Cx0Prueba.js';
// Los arreglos de src/guard.ts tal como los emite el build (PD-2-r1 y PD-2-r2): en el chunk de entrada y en cada worker propio.
const LITERALES_GUARDIA = [
  '[`RTCPeerConnection`,`webkitRTCPeerConnection`,`RTCDataChannel`]',
  '[`speechSynthesis`,`SpeechSynthesisUtterance`,`SpeechRecognition`,`webkitSpeechRecognition`]',
  '[`XSLTProcessor`,`documentPictureInPicture`]',
  '[`XMLHttpRequest`,`WebSocket`,`WebSocketStream`,`WebTransport`,`EventSource`,`fetchLater`,`open`]',
  '[`sendBeacon`,`share`]',
  '[`joinAdInterestGroup`,`runAdAuction`,`browsingTopics`]',
];
const CHUNK_ENTRADA = LITERALES_GUARDIA.map((l, i) => `var g${i}=${l};`).join('');
// B-50: el único registro del service worker del build (src/ui/sw-registro.ts, como lo emite el minificador), en su propio chunk.
const REGISTRO_SW = 'assets/registro-Cx0Prueba.js';
const REGISTRO_LIMPIO = 'navigator.serviceWorker.register(`/sw.js`,{type:`module`,scope:`/`,updateViaCache:`none`}).then(r=>r instanceof ServiceWorkerRegistration,()=>!1);';
const ORT = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];
const VERSION_ORT = (JSON.parse(readFileSync(join(REPO, 'node_modules/onnxruntime-web/package.json'), 'utf8')) as { version: string }).version;

type Json = Record<string, unknown>;
interface Caso {
  /** Archivos de dist/ que se agregan o cambian (null los quita). */
  archivos?: Record<string, string | null>;
  html?: (h: string) => string;
  cabeceras?: (h: string) => string;
  paquete?: (p: Json) => void;
  lock?: (l: { packages: Record<string, Json> }) => void;
  versionPdfjs?: string;
  versionOrt?: string;
  /** Último paso antes de correr check-dist, sobre dist/ ya armado (p. ej. un archivo grande sin pasar por la memoria). */
  antes?: (dist: string) => void;
}

/** Enlace duro (el .wasm de ORT pesa 14 MB) o copia si no se puede. Ningún caso escribe sobre un enlace: lo quita antes. */
function enlazar(origen: string, destino: string): void {
  mkdirSync(dirname(destino), { recursive: true });
  try { linkSync(origen, destino); } catch { copyFileSync(origen, destino); }
}
function escribir(ruta: string, contenido: string): void {
  mkdirSync(dirname(ruta), { recursive: true });
  rmSync(ruta, { force: true });
  writeFileSync(ruta, contenido);
}

let n = 0;
// Asíncrono: los casos corren en paralelo (describe.concurrent); cada uno usa su propio directorio.
function correr(c: Caso = {}): Promise<{ salida: number; texto: string }> {
  const base = join(RAIZ, `caso-${n++}`);
  const dist = join(base, 'dist');
  const paquete = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as Json;
  c.paquete?.(paquete);
  escribir(join(base, 'package.json'), JSON.stringify(paquete));
  const lock = JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8')) as { packages: Record<string, Json> };
  c.lock?.(lock);
  escribir(join(base, 'package-lock.json'), JSON.stringify(lock));
  escribir(join(base, 'node_modules/onnxruntime-web/package.json'), JSON.stringify({ name: 'onnxruntime-web', version: c.versionOrt ?? VERSION_ORT }));
  escribir(join(base, 'node_modules/pdfjs-dist/package.json'), JSON.stringify({ name: 'pdfjs-dist', version: c.versionPdfjs ?? '6.4.299' }));
  for (const f of ORT) {
    enlazar(join(REPO, 'node_modules/onnxruntime-web/dist', f), join(base, 'node_modules/onnxruntime-web/dist', f));
    enlazar(join(REPO, 'public/ort', f), join(dist, 'ort', f));
  }
  for (const f of readdirSync(join(REPO, 'public/fonts'))) enlazar(join(REPO, 'public/fonts', f), join(dist, 'fonts', f));
  const html = readFileSync(join(REPO, 'index.html'), 'utf8').replace(
    '<script type="module" src="/src/main.tsx"></script>', `<script type="module" crossorigin src="/${ENTRADA}"></script>`);
  escribir(join(dist, 'index.html'), c.html ? c.html(html) : html);
  const cabeceras = readFileSync(join(REPO, 'public/_headers'), 'utf8');
  escribir(join(dist, '_headers'), c.cabeceras ? c.cabeceras(cabeceras) : cabeceras);
  escribir(join(dist, 'tt-policy.js'), readFileSync(join(REPO, 'public/tt-policy.js'), 'utf8'));
  escribir(join(dist, ENTRADA), CHUNK_ENTRADA);
  escribir(join(dist, REGISTRO_SW), REGISTRO_LIMPIO);
  escribir(join(dist, 'sw.js'), "self.addEventListener('fetch',e=>{e.respondWith(fetch(e.request))});");
  escribir(join(dist, 'precache.json'), '{"formato":1,"archivos":[]}\n');
  for (const [ruta, contenido] of Object.entries(c.archivos ?? {})) {
    if (contenido === null) rmSync(join(dist, ruta), { force: true });
    else escribir(join(dist, ruta), contenido);
  }
  c.antes?.(dist);
  return new Promise((ok) => {
    const hijo = spawn(process.execPath, [SCRIPT, 'dist'], { cwd: base, stdio: ['ignore', 'pipe', 'pipe'] });
    let texto = '';
    hijo.stdout.on('data', (b: Buffer) => { texto += b.toString(); });
    hijo.stderr.on('data', (b: Buffer) => { texto += b.toString(); });
    hijo.on('close', (codigo) => { ok({ salida: codigo ?? -1, texto }); });
  });
}

/** Falla con salida 1 y nombra la regla (T-CD-02: «check-dist falla en cada archivo, con el nombre de la regla»). */
async function falla(c: Caso, ...mensajes: (string | RegExp)[]): Promise<void> {
  const r = await correr(c);
  expect(r.salida, r.texto).toBe(1);
  for (const m of mensajes) {
    if (typeof m === 'string') expect(r.texto).toContain(m);
    else expect(r.texto).toMatch(m);
  }
}
const chunkUi = (contenido: string): Caso => ({ archivos: { 'assets/ui-Cx0Prueba.js': contenido } });

describe.concurrent('T-CD-03 el dist limpio pasa: archivos, ORT, HTML, cabeceras y dependencias en verde', () => {
  it('el caso limpio, armado con los archivos reales del repositorio, pasa', async () => {
    const r = await correr();
    expect(r.texto).toContain('check-dist: OK');
    expect(r.salida).toBe(0);
  });
});

describe.concurrent('T-CD-02 un canario por regla de contenido: check-dist sale con 1 y nombra la regla', () => {
  const CANARIOS: [string, string][] = [
    ['console', 'console.log(1);'],
    ['console-ref', 'x(console);'],
    ['fetch', 'fetch("/x");'],
    ['XMLHttpRequest', 'new XMLHttpRequest;'],
    ['WebSocket', 'new WebSocket(u);'],
    ['WebSocketStream', 'new WebSocketStream(u);'],
    ['WebTransport', 'new WebTransport(u);'],
    ['EventSource', 'new EventSource(u);'],
    ['sendBeacon', 'navigator.sendBeacon(u,d);'],
    ['WebRTC', 'new RTCPeerConnection;'],
    ['WebRTC', 'n.RTCDataChannel;'],
    ['voz', 'speechSynthesis.speak(u);'],
    ['voz', 'new SpeechSynthesisUtterance(t);'],
    ['voz', 'new webkitSpeechRecognition;'],
    ['xslt', 'new XSLTProcessor;'],
    ['pip-documento', 'documentPictureInPicture.requestWindow();'],
    ['publicidad', 'navigator.joinAdInterestGroup(g);'],
    ['publicidad', 'navigator.runAdAuction(c);'],
    ['publicidad', 'document.browsingTopics();'],
    ['fetchLater', 'fetchLater(u);'],
    ['navigator.share', 'navigator.share({text:t});'],
    ['window.open', 'window.open(u);'],
    ['document.open', 'document.open(u,n,f);'],
    ['location=', 'location.href=u;'],
    ['location=', 'location.assign(u);'],
    ['history', 'history.pushState({},"",u);'],
    ['localStorage', 'localStorage.x=1;'],
    ['sessionStorage', 'sessionStorage.x=1;'],
    ['document.cookie', 'document.cookie="a=1";'],
    ['document.write', 'document.write(x);'],
    ['document.title=', 'document.title=t;'],
    ['outerHTML', 'e.outerHTML=s;'],
    ['insertAdjacentHTML', 'e.insertAdjacentHTML("beforeend",s);'],
    ['eval', 'eval(s);'],
    ['new Function', 'new Function(s);'],
    ['Function-cadena', 'Function("return 1")();'],
    ['gancho-medicion', 'var g=__SIGLOW_GANCHO_MEDICION__;'],
    ['reportes', 'var r="report-uri";'],
    ['reportes', 'var r="csp-probe";'],
    ['blob:', 'var u="blob:x";'],
    ['data-url-script', 'var u="data:text/javascript,1";'],
    ['http-externo', 'var u="https://cdn.ejemplo.test/x.js";'],
    ['url-ip-local', 'var u="http://203.0.113.5/x";'],
    ['url-ip-local', 'var u="http://localhost:8080/x";'],
    ['url-ws', 'var u="wss://ejemplo.test/";'],
    ['dns-prefetch', 'l.rel="dns-prefetch";'],
    ['preconnect', 'l.rel="preconnect";'],
    ['telemetria', 'gtag("event");'],
    ['telemetria', 'var s="Sentry";'],
    ['pdf_viewer', 'import("pdfjs-dist/web/pdf_viewer");'],
    ['enableScripting', 'getDocument({enableScripting:!0});'],
    ['onnxruntime-node', 'require("onnxruntime-node");'],
    ['sharp', 'require("sharp");'],
  ];
  for (const [regla, contenido] of CANARIOS) {
    it(`canario ${regla}: ${contenido}`, async () => { await falla(chunkUi(contenido), `assets/ui-Cx0Prueba.js: ${regla} ×`); });
  }

  it('P0-5 auxiliares del modelo: tokenizer.json con el SHA-256 de su manifiesto no se barre; alterado, sí', async () => {
    const tok = '{"vocab":["localStorage.x=1;","console.log"]}';
    const manifiesto = (huella: string): string => JSON.stringify({ id: 'm', auxiliares: [{ ruta: 'tokenizer.json', tamano: tok.length, sha256: huella }] });
    const huella = createHash('sha256').update(tok).digest('hex');
    expect((await correr({ archivos: { 'models/m/tokenizer.json': tok, 'models/m/manifest.json': manifiesto(huella) } })).salida).toBe(0);
    await falla({ archivos: { 'models/m/tokenizer.json': tok, 'models/m/manifest.json': manifiesto('0'.repeat(64)) } }, 'models/m/tokenizer.json: localStorage ×');
    // Fuera de models/<id>/ el mismo contenido se barre siempre.
    await falla({ archivos: { 'assets/tokenizer.json': tok } }, 'assets/tokenizer.json: localStorage ×');
  });

  it('B-50 sw-registro: el build tiene un solo navigator.serviceWorker.register, con la cadena literal /sw.js como primer argumento', async () => {
    const reg = (llamada: string): Caso => ({ archivos: { [REGISTRO_SW]: llamada } });
    // Controles: la forma del minificador, otras comillas, espacios y encadenamiento opcional pasan; otros `.register(` no cuentan.
    for (const ok of [REGISTRO_LIMPIO, 'navigator.serviceWorker.register("/sw.js");', "navigator . serviceWorker . register ( '/sw.js' , {} );",
      'navigator.serviceWorker?.register(`/sw.js`);', REGISTRO_LIMPIO + 'new FinalizationRegistry(f).register(o,1);r.register(a,b);']) {
      expect((await correr(reg(ok))).salida, ok).toBe(0);
    }
    // Ninguno, o más de uno.
    await falla({ archivos: { [REGISTRO_SW]: null } }, 'sw-registro: debe haber exactamente un navigator.serviceWorker.register y hay 0');
    await falla(reg(REGISTRO_LIMPIO + REGISTRO_LIMPIO), 'sw-registro: debe haber exactamente un navigator.serviceWorker.register y hay 2');
    await falla({ archivos: { 'assets/ui-Cx0Prueba.js': REGISTRO_LIMPIO } }, 'sw-registro: debe haber exactamente un navigator.serviceWorker.register y hay 2');
    // El dato en la ruta, la query, otro origen o un valor que no es literal.
    for (const arg of ['`/assets/x.js`', '"/ort/x.mjs"', '`/sw.js?d=1`', '`/sw.js#d`', '`//ejemplo.test/sw.js`', '`sw.js`', 'u', '`/sw`+`.js`', '`/sw.js`+d', '']) {
      await falla(reg(`navigator.serviceWorker.register(${arg},{scope:\`/\`});`), 'sw-registro: el primer argumento de register debe ser la cadena literal /sw.js');
    }
    // Otras formas de llegar a la misma API.
    await falla(reg('navigator.serviceWorker["register"](u);'), 'sw-registro: serviceWorker["register"] ×1');
    await falla(reg('navigator.serviceWorker.register.call(navigator.serviceWorker,u);'), 'sw-registro: serviceWorker.register fuera de una llamada directa');
    await falla(reg('var f=navigator.serviceWorker.register;f(u);'), 'sw-registro: serviceWorker.register fuera de una llamada directa');
  });

  it('canario innerHTML fuera de Preact: falla aunque el código propio no lo use (lint F-05) y también dangerouslySetInnerHTML', async () => {
    await falla(chunkUi('e.innerHTML=s;'), 'assets/ui-Cx0Prueba.js: innerHTML ×1 fuera del fragmento de Preact');
    await falla(chunkUi('var p={dangerouslySetInnerHTML:{__html:s}};'), 'dangerouslySetInnerHTML ×1 fuera del fragmento de Preact');
  });

  it('el fragmento de Preact admite innerHTML hasta su tope y no más', async () => {
    const preact = (k: number): string => 'function f(e,t){e.__k=t;' + 'e.innerHTML=t.__html;'.repeat(k) + 'e.dangerouslySetInnerHTML;}';
    expect((await correr(chunkUi(preact(3)))).salida).toBe(0);
    await falla(chunkUi(preact(4)), 'innerHTML ×4 fuera del fragmento de Preact o sobre el tope 3');
  });

  it('canario data: en HTML y CSS (assetsInlineLimit: 0)', async () => {
    await falla({ archivos: { 'assets/index-Cx0Prueba.css': 'a{background:url(data:image/png;base64,AAAA)}' } }, 'assets/index-Cx0Prueba.css: data-html-css ×1');
    await falla({ html: (h) => h.replace('</body>', '<img src="data:image/png;base64,AAAA"></body>') }, 'index.html: data-html-css ×1');
  });

  it('canario: una URL en _headers (p. ej. un report-uri) también es hallazgo', async () => {
    await falla({ cabeceras: (h) => h.replace('trusted-types default,', 'trusted-types default; report-uri https://ejemplo.test/r,') },
      '_headers: reportes ×1', '_headers: http-externo ×1', 'Content-Security-Policy distinta de la aprobada');
  });

  it('la guardia: sus literales exactos solo valen en el chunk de entrada y en los workers propios; fuera de ellos los nombres son hallazgos', async () => {
    await falla({ archivos: { [ENTRADA]: CHUNK_ENTRADA + 'new WebSocket(u);' } }, `${ENTRADA}: WebSocket ×1`);
    await falla({ archivos: { [ENTRADA]: CHUNK_ENTRADA + 'speechSynthesis.speak(u);' } }, `${ENTRADA}: voz ×1`);
    await falla({ archivos: { 'assets/ui-Cx0Prueba.js': CHUNK_ENTRADA } },
      'assets/ui-Cx0Prueba.js: WebRTC ×3', 'assets/ui-Cx0Prueba.js: voz ×4', 'assets/ui-Cx0Prueba.js: XMLHttpRequest ×1', 'assets/ui-Cx0Prueba.js: sendBeacon ×1',
      'assets/ui-Cx0Prueba.js: WebSocketStream ×1', 'assets/ui-Cx0Prueba.js: WebTransport ×1', 'assets/ui-Cx0Prueba.js: xslt ×1',
      'assets/ui-Cx0Prueba.js: pip-documento ×1', 'assets/ui-Cx0Prueba.js: publicidad ×3');
    // PD-2-r2: con la guardia en la entrada, un uso de los nombres nuevos fuera de sus literales también es hallazgo.
    await falla({ archivos: { [ENTRADA]: CHUNK_ENTRADA + 'new WebTransport(u);new XSLTProcessor;' } }, `${ENTRADA}: WebTransport ×1`, `${ENTRADA}: xslt ×1`);
    // Un worker que no es propio (pdf.js, los hilos de ORT o uno nuevo) no goza de la excepción.
    await falla({ archivos: { 'assets/otro.worker-Cx0Prueba.js': CHUNK_ENTRADA } }, 'assets/otro.worker-Cx0Prueba.js: WebRTC ×3');
    // Un literal repetido o cambiado anula la excepción entera, y la guardia cuenta como ausente.
    await falla({ archivos: { [ENTRADA]: CHUNK_ENTRADA + `var d=${LITERALES_GUARDIA.find((l) => l.includes('sendBeacon'))!};` } }, `${ENTRADA}: sendBeacon ×2`, `${ENTRADA}: guardia ausente o alterada`);
    await falla({ archivos: { [ENTRADA]: CHUNK_ENTRADA.replace('`open`]', '`open`,`postMessage`]') } }, `${ENTRADA}: WebSocket ×1`, `${ENTRADA}: guardia ausente o alterada`);
  });

  it('la guardia (PD-2-r1, B-17): es obligatoria en el chunk de entrada y en cada worker propio (detect, io, ner)', async () => {
    const workers = { 'assets/detect.worker-Cx0Prueba.js': CHUNK_ENTRADA, 'assets/io.worker-Cx0Prueba.js': CHUNK_ENTRADA, 'assets/ner.worker-Cx0Prueba.js': CHUNK_ENTRADA };
    expect((await correr({ archivos: workers })).salida).toBe(0);
    await falla({ archivos: { [ENTRADA]: 'var a=1;' } }, `${ENTRADA}: guardia ausente o alterada`);
    for (const w of Object.keys(workers)) {
      await falla({ archivos: { ...workers, [w]: 'self.onmessage=f;' } }, `${w}: guardia ausente o alterada`);
      await falla({ archivos: { ...workers, [w]: CHUNK_ENTRADA.replace('`share`', '`share`,`x`') } }, `${w}: guardia ausente o alterada`, `${w}: sendBeacon ×1`);
    }
  });

  it('sw.js: un solo fetch( (el interruptor); dos son hallazgo', async () => {
    await falla({ archivos: { 'sw.js': 'fetch(a);fetch(b);' } }, 'sw.js: fetch ×2');
  });
});

describe.concurrent('T-CD-02 y T-CD-03 reglas de archivos', () => {
  it('canario: un archivo de más de 25 MiB', async () => {
    await falla({
      antes: (dist) => {
        const fd = openSync(join(dist, 'assets/grande.bin'), 'w');
        ftruncateSync(fd, 26 * 1024 * 1024);
        closeSync(fd);
      },
    }, 'assets/grande.bin: tamaño 27262976 B supera 25 MiB');
  });
  it('canario: un .wasm distinto del de ORT', async () => { await falla({ archivos: { 'assets/otro.wasm': 'x' } }, 'assets/otro.wasm: wasm no permitido'); });
  it('canario: una fuente de la marca alterada, ausente o un archivo de más en fonts/ (F1)', async () => {
    await falla({ archivos: { 'fonts/Geist-Variable.woff2': 'wOF2 alterada' } }, 'fonts/Geist-Variable.woff2: sha256 distinto del fijado');
    await falla({ archivos: { 'fonts/GeistMono-Medium.woff2': null } }, 'fonts/GeistMono-Medium.woff2: falta');
    await falla({ archivos: { 'fonts/otra.woff2': 'wOF2' } }, 'fonts/otra.woff2: archivo no permitido en fonts/');
  });
  it('canario: un mapa de fuentes', async () => { await falla({ archivos: { 'assets/index-Cx0Prueba.js.map': '{}' } }, 'mapa de fuentes'); });
  it('canario: variantes asyncify, jsep y jspi de ORT', async () => {
    await falla({ archivos: { 'ort/ort-wasm-simd-threaded.jsep.mjs': 'x' } }, 'variante de ORT no permitida', 'archivo no permitido en ort/');
    await falla({ archivos: { 'assets/ort-wasm-simd-threaded.asyncify-x.js': 'x' } }, 'variante de ORT no permitida');
    await falla({ archivos: { 'assets/ort-wasm-simd-threaded.jspi-x.js': 'x' } }, 'variante de ORT no permitida');
  });
  it('canario: recursos de pdf.js que el lector no usa', async () => {
    for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) await falla({ archivos: { [`${d}/x.bin`]: 'x' } }, `${d}/x.bin: recursos de pdf.js`);
  });
});

describe.concurrent('T-CD-03 ORT: los dos archivos idénticos al paquete instalado y a los fijados', () => {
  it('canario: el .mjs de ORT alterado', async () => {
    await falla({ archivos: { 'ort/ort-wasm-simd-threaded.mjs': readFileSync(join(REPO, 'public/ort/ort-wasm-simd-threaded.mjs'), 'utf8') + '\n' } },
      'ort/ort-wasm-simd-threaded.mjs: sha256 distinto del fijado', 'ort/ort-wasm-simd-threaded.mjs: sha256 distinto del paquete instalado');
  });
  it('canario: falta el .wasm de ORT', async () => { await falla({ archivos: { 'ort/ort-wasm-simd-threaded.wasm': null } }, 'ort/ort-wasm-simd-threaded.wasm: falta'); });
  it('canario: otra versión de onnxruntime-web instalada', async () => { await falla({ versionOrt: '1.31.1' }, 'ort: onnxruntime-web 1.31.1 distinto de'); });
  it('el .mjs de ORT copiado tal cual puede tener su consola y su fetch; un .mjs propio en ort/ no', async () => {
    expect((await correr()).salida).toBe(0);
    await falla({ archivos: { 'ort/otro.mjs': 'console.log(1)' } }, 'ort/otro.mjs: archivo no permitido en ort/', 'ort/otro.mjs: console ×1');
  });
});

describe.concurrent('T-CD-03 index.html (8.7, V-04, V-05, V-27, V-43)', () => {
  const casos: [string, (h: string) => string, string][] = [
    ['html-lang', (h) => h.replace('<html lang="es-CO" translate="no">', '<html lang="es">'), 'html-lang'],
    ['meta-notranslate', (h) => h.replace(/\s*<meta name="google" content="notranslate" \/>/, ''), 'meta-notranslate'],
    ['meta-dns-prefetch', (h) => h.replace(/\s*<meta http-equiv="x-dns-prefetch-control" content="off" \/>/, ''), 'meta-dns-prefetch'],
    ['titulo', (h) => h.replace('<title>Sig-Low</title>', '<title>Sig-Low · Ana Ficticia</title>'), 'titulo'],
    ['script en línea', (h) => h.replace('</body>', '<script>var x=1</script></body>'), 'script-en-linea'],
    ['atributo on*=', (h) => h.replace('<div id="app">', '<div id="app" onclick="x()">'), 'atributo-on'],
    ['tt-policy.js después del módulo', (h) => h.replace(/(\s*<script src="\/tt-policy\.js"><\/script>)(\s*<script type="module"[^>]*><\/script>)/, '$2$1'), 'orden-scripts'],
    ['sin tt-policy.js', (h) => h.replace(/\s*<script src="\/tt-policy\.js"><\/script>/, ''), 'orden-scripts'],
    ['enlace', (h) => h.replace('</body>', '<a href="https://ejemplo.test/">x</a></body>'), 'enlace'],
    ['iframe', (h) => h.replace('</body>', '<iframe></iframe></body>'), 'elemento-prohibido'],
    ['form', (h) => h.replace('</body>', '<form></form></body>'), 'elemento-prohibido'],
    ['precarga', (h) => h.replace('</head>', '<link rel="prefetch" href="/assets/x.js"></head>'), 'link-precarga'],
    ['falta la segunda política', (h) => h.replace(/\s*<meta http-equiv="Content-Security-Policy" content="script-src[^"]*" \/>/, ''), 'meta-csp'],
    ['meta CSP alterada', (h) => h.replace("connect-src 'self'", "connect-src 'self' https:"), 'meta-csp: distinta de la aprobada'],
    ['meta CSP después de un script', (h) => h.replace(/(\s*<meta http-equiv="Content-Security-Policy" content="default-src[^"]*" \/>)([\s\S]*?)(<\/head>)/, '$2$1$3'), 'meta-csp'],
  ];
  for (const [nombre, cambio, regla] of casos) it(`canario ${nombre}`, async () => { await falla({ html: cambio }, `index.html: ${regla}`); });
  it('canario: sin index.html', async () => { await falla({ archivos: { 'index.html': null } }, 'index.html: falta'); });
});

describe.concurrent('T-CD-03 _headers (3.6, T-CS-07)', () => {
  it('canario: sin _headers', async () => { await falla({ archivos: { _headers: null } }, '_headers: falta'); });
  it('canario: la CSP sin la segunda política o con una directiva cambiada', async () => {
    await falla({ cabeceras: (h) => h.replace(/, script-src 'wasm-unsafe-eval'[^\n]*/, '') }, '_headers: /* Content-Security-Policy distinta de la aprobada');
    await falla({ cabeceras: (h) => h.replace("connect-src 'self';", "connect-src 'self' wss:;") }, 'Content-Security-Policy distinta de la aprobada');
  });
  it('canario: falta una cabecera de 3.6, sobra una o cambia su valor', async () => {
    await falla({ cabeceras: (h) => h.replace(/\s*Cross-Origin-Embedder-Policy: require-corp/, '') }, '_headers: /* Cross-Origin-Embedder-Policy distinta de la aprobada');
    await falla({ cabeceras: (h) => h.replace('X-Frame-Options: DENY', 'X-Frame-Options: DENY\n  Access-Control-Allow-Origin: *') }, '_headers: /* Access-Control-Allow-Origin no está en la lista aprobada');
    await falla({ cabeceras: (h) => h.replace('Referrer-Policy: no-referrer', 'Referrer-Policy: origin') }, '_headers: /* Referrer-Policy distinta de la aprobada');
  });
  it('canario (PD-2-r2): la Permissions-Policy sin browsing-topics=() o sin private-state-token-issuance=(), o con un rasgo más', async () => {
    await falla({ cabeceras: (h) => h.replace(', browsing-topics=()', '') }, '_headers: /* Permissions-Policy distinta de la aprobada');
    await falla({ cabeceras: (h) => h.replace(', private-state-token-issuance=()', '') }, '_headers: /* Permissions-Policy distinta de la aprobada');
    await falla({ cabeceras: (h) => h.replace(', identity-credentials-get=()', '') }, '_headers: /* Permissions-Policy distinta de la aprobada');
    // (con la coma delante: el comentario de _headers también nombra el rasgo, sin ella)
    await falla({ cabeceras: (h) => h.replace(', private-state-token-issuance=()', ', private-state-token-issuance=(), join-ad-interest-group=()') },
      '_headers: /* Permissions-Policy distinta de la aprobada');
  });
  it('canario: no se quita Access-Control-Allow-Origin (Cloudflare lo agrega por defecto)', async () => {
    await falla({ cabeceras: (h) => h.replace(/\s*! Access-Control-Allow-Origin/, '') }, '_headers: /* falta «! Access-Control-Allow-Origin»');
  });
  it('canario: Cache-Control cambiado o una regla nueva', async () => {
    await falla({ cabeceras: (h) => h.replace(/(\/sw\.js\s*\n\s*Cache-Control: )no-cache, no-transform/, '$1max-age=86400') }, '_headers: /sw.js debe llevar solo Cache-Control: no-cache, no-transform');
    await falla({ cabeceras: (h) => `${h}\n/ort/*\n  Cache-Control: no-cache\n` }, '_headers: regla /ort/* no aprobada');
  });
  it('canario (F0): los trozos del modelo sin Content-Type: application/octet-stream, con otro tipo o con otra cabecera', async () => {
    const motivo = '_headers: /models/*/onnx/* debe llevar solo Content-Type: application/octet-stream';
    await falla({ cabeceras: (h) => h.replace(/\/models\/\*\/onnx\/\*\s*\n\s*Content-Type: application\/octet-stream\n?/, '') }, motivo);
    await falla({ cabeceras: (h) => h.replace('Content-Type: application/octet-stream', 'Content-Type: text/plain') }, motivo);
    await falla({ cabeceras: (h) => h.replace('Content-Type: application/octet-stream', 'Content-Type: application/octet-stream\n  Cache-Control: no-cache') }, motivo);
  });
  it('canario: una cabecera que llega desde dos reglas (Cloudflare uniría; el SW y server.mjs se quedarían con la última)', async () => {
    await falla({ cabeceras: (h) => h.replace(/(\/assets\/\*\s*\n\s*Cache-Control: [^\n]*)/, '$1\n  X-Frame-Options: DENY') },
      '_headers: X-Frame-Options llega a /assets/x.js desde dos reglas (/* y /assets/*)');
  });
  it('canario: una línea que no es cabecera ni «! Nombre»', async () => {
    await falla({ cabeceras: (h) => h.replace('X-Frame-Options: DENY', 'X-Frame-Options DENY') }, '_headers: línea no válida');
  });
});

describe.concurrent('T-PV-14 dependencias de ejecución del lockfile = lista blanca (5.2.2, V-06)', () => {
  it('canario: una dependencia de ejecución nueva en package.json', async () => {
    await falla({ paquete: (p) => { (p['dependencies'] as Json)['left-pad'] = '1.3.0'; } }, 'dependencias: package.json dependencies distinto de la lista blanca');
  });
  it('canario: otra versión de una dependencia aprobada', async () => {
    await falla({ paquete: (p) => { (p['dependencies'] as Json)['fflate'] = '0.8.2'; } }, 'dependencias: package.json dependencies distinto');
  });
  it('canario: un paquete de ejecución nuevo en el lockfile (transitivo)', async () => {
    await falla({ lock: (l) => { l.packages['node_modules/left-pad'] = { version: '1.3.0', resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz', integrity: 'sha512-x' }; } },
      'paquetes de ejecución del lockfile fuera de la lista (sobran: left-pad@1.3.0');
  });
  it('canario: un paquete sin integridad o fuera del registro de npm', async () => {
    await falla({ lock: (l) => { delete l.packages['node_modules/preact']!['integrity']; } }, 'dependencias: node_modules/preact sin integridad');
    await falla({ lock: (l) => { l.packages['node_modules/fflate']!['resolved'] = 'git+https://ejemplo.test/fflate.git'; } }, 'node_modules/fflate sin integridad o fuera del registro');
  });
  it('canario: un paquete de ejecución con script de instalación nuevo', async () => {
    await falla({ lock: (l) => { l.packages['node_modules/preact']!['hasInstallScript'] = true; } }, 'dependencias: paquetes de ejecución con script de instalación: preact, protobufjs');
  });
});

describe.concurrent('T-CD-03 excepciones exactas de ORT y del worker ner (medidas en el arnés del modelo)', () => {
  const ORT_CHUNK = (fetches: number, blobs = 2): string => "var n='ort-wasm-simd-threaded';" + 'x.startsWith("blob:");'.repeat(blobs) +
    'fetch(u);'.repeat(fetches) + 'throw Error(`https://rolldown.rs/in-depth/bundling-cjs#require-external-modules`);';
  it('el chunk de ORT pasa con sus cuentas y falla con una de más', async () => {
    expect((await correr({ archivos: { 'assets/ort.wasm.min-Cx0Prueba.js': ORT_CHUNK(2) } })).salida).toBe(0);
    await falla({ archivos: { 'assets/ort.wasm.min-Cx0Prueba.js': ORT_CHUNK(3) } }, 'assets/ort.wasm.min-Cx0Prueba.js: fetch ×3 fuera de la excepción aprobada');
    await falla({ archivos: { 'assets/ort.wasm.min-Cx0Prueba.js': ORT_CHUNK(2, 3) } }, 'blob: ×3 fuera de la excepción aprobada');
    await falla({ archivos: { 'assets/ort.wasm.min-Cx0Prueba.js': ORT_CHUNK(2) }, versionOrt: '1.31.1' }, 'versión de ORT distinta de la aprobada');
  });
  it('el worker ner admite un fetch( a /models/ y nada más', async () => {
    // Con la guardia como primer import (PD-2-r1): su fetch acotado no agrega ningún `fetch(` al worker.
    const ner = (k: number): string => CHUNK_ENTRADA + 'var u=`/models/${i}/${r}`;' + 'fetch(u);'.repeat(k);
    expect((await correr({ archivos: { 'assets/ner.worker-Cx0Prueba.js': ner(1) } })).salida).toBe(0);
    await falla({ archivos: { 'assets/ner.worker-Cx0Prueba.js': ner(2) } }, 'assets/ner.worker-Cx0Prueba.js: fetch ×2 fuera de la excepción aprobada (tope 1)');
    await falla({ archivos: { 'assets/ner.worker-Cx0Prueba.js': CHUNK_ENTRADA + 'fetch(u);' } }, 'assets/ner.worker-Cx0Prueba.js: fetch ×1');
  });
});

// ===== Excepción exacta de pdf.js (PE-4-r2; P0-6a de PE-4, decisión 2). Las aserciones son las de PE-4-r2; el chunk
// sintético escribe cada referencia a la consola como `console.log;` (una referencia y un miembro), como en el build real,
// donde las 5 referencias aprobadas dan 9 coincidencias de `\bconsole\b` (regla `console-ref`, PD-2). =====
const CORE_JS = ['https://github.com/zloirock/core-js/blob/v3.50.0/LICENSE', 'https://github.com/zloirock/core-js'];
const URLS_PRINCIPAL = [...CORE_JS, 'http://example.com', 'https://foo.bar', 'https://foo.bar'];
const URLS_WORKER = [
  ...CORE_JS,
  ...['xci/', 'xfa-connection-set/', 'xfa-data/', 'xfa-data/1.0/', 'xfa-form/', 'xfa-locale-set/', 'xfa-source-set/', 'xfa-template/', 'xdc/']
    .map((p) => 'http://www.xfa.org/schema/' + p),
  ...['xdp/', 'xdp/pdf/', 'xfdf/', 'xmpmeta/'].map((p) => 'http://ns.adobe.com/' + p),
];
/** Un chunk sintético con la versión, `xhr` referencias a XMLHttpRequest, `consola` a console.log y las URL como literales. */
const chunk = (urls: string[], xhr: number, consola: number, extra = '', version = '6.4.299'): string =>
  `var apiVersion="${version}";` + 'XMLHttpRequest;'.repeat(xhr) + 'console.log;'.repeat(consola) +
  urls.map((u) => `var u=\`${u}\`;`).join('') + extra;

interface DistPdf { principal?: string; worker?: string; nombrePrincipal?: string; nombreWorker?: string }
function correrPdf(d: DistPdf, versionPdfjs = '6.4.299'): Promise<{ salida: number; texto: string }> {
  return correr({
    versionPdfjs,
    archivos: {
      [`assets/${d.nombrePrincipal ?? 'pdf-C2pV2Gs3.js'}`]: d.principal ?? chunk(URLS_PRINCIPAL, 3, 0),
      [`assets/${d.nombreWorker ?? 'pdf.worker-Cp5SGYZ2.js'}`]: d.worker ?? chunk(URLS_WORKER, 1, 5),
    },
  });
}

describe.concurrent('T-CD-03 excepción exacta de pdf.js en check-dist (V-42)', () => {
  it('pasa con las cuentas y las URL literales aprobadas en los dos chunks', async () => {
    const r = await correrPdf({});
    expect(r.texto).toContain('check-dist: OK');
    expect(r.salida).toBe(0);
  });

  it('pasa con menos de lo aprobado (la excepción es un tope, no una obligación)', async () => {
    expect((await correrPdf({ principal: chunk(URLS_PRINCIPAL, 2, 0), worker: chunk(URLS_WORKER, 0, 3) })).salida).toBe(0);
  });

  it('canario: una XMLHttpRequest de más en cualquiera de los dos chunks falla', async () => {
    const p = await correrPdf({ principal: chunk(URLS_PRINCIPAL, 4, 0) });
    expect(p.salida).toBe(1);
    expect(p.texto).toMatch(/pdf-C2pV2Gs3\.js: XMLHttpRequest ×4/);
    const w = await correrPdf({ worker: chunk(URLS_WORKER, 2, 5) });
    expect(w.salida).toBe(1);
    expect(w.texto).toMatch(/pdf\.worker-Cp5SGYZ2\.js: XMLHttpRequest ×2/);
  });

  it('canario: una referencia a console de más falla (0 en el principal, 5 en el worker)', async () => {
    expect((await correrPdf({ principal: chunk(URLS_PRINCIPAL, 3, 1) })).texto).toMatch(/pdf-C2pV2Gs3\.js: console ×1/);
    expect((await correrPdf({ worker: chunk(URLS_WORKER, 1, 6) })).texto).toMatch(/pdf\.worker-Cp5SGYZ2\.js: console ×6/);
    expect((await correrPdf({ worker: chunk(URLS_WORKER, 1, 6) })).salida).toBe(1);
  });

  it('canario (PD-2): una referencia suelta a console sobre las 9 aprobadas en el worker falla aunque no sea una llamada', async () => {
    expect((await correrPdf({ worker: chunk(URLS_WORKER, 1, 5, 'x(console);'.repeat(4)) })).salida).toBe(0);
    const r = await correrPdf({ worker: chunk(URLS_WORKER, 1, 5, 'x(console);'.repeat(5)) });
    expect(r.salida).toBe(1);
    expect(r.texto).toMatch(/pdf\.worker-Cp5SGYZ2\.js: console-ref ×10/);
  });

  it('canario (PD-2): fetch( sobre su tope y Function con otra cadena que la de core-js fallan', async () => {
    expect((await correrPdf({ principal: chunk(URLS_PRINCIPAL, 3, 0, 'fetch(u);'.repeat(4) + 'Function(`return this`)();') })).salida).toBe(0);
    expect((await correrPdf({ principal: chunk(URLS_PRINCIPAL, 3, 0, 'fetch(u);'.repeat(5)) })).texto).toMatch(/pdf-C2pV2Gs3\.js: fetch ×5 fuera de la excepción aprobada/);
    expect((await correrPdf({ worker: chunk(URLS_WORKER, 1, 5, 'Function(`return 1`)();') })).texto).toMatch(/pdf\.worker-Cp5SGYZ2\.js: Function-cadena ×1 fuera de la excepción aprobada/);
  });

  it('canario: una URL externa de más falla, y cambiar una por otra de igual cuenta también (se compara la lista literal)', async () => {
    const mas = await correrPdf({ principal: chunk([...URLS_PRINCIPAL, 'https://cdn.ejemplo.test/x.js'], 3, 0) });
    expect(mas.salida).toBe(1);
    expect(mas.texto).toMatch(/pdf-C2pV2Gs3\.js: URL externas fuera de la lista literal aprobada/);
    const cambiada = await correrPdf({ worker: chunk([...URLS_WORKER.slice(0, -1), 'http://ns.adobe.com/otro/'], 1, 5) });
    expect(cambiada.salida).toBe(1);
    expect(cambiada.texto).toMatch(/pdf\.worker-Cp5SGYZ2\.js: URL externas fuera de la lista literal aprobada/);
    const menos = await correrPdf({ principal: chunk(URLS_PRINCIPAL.slice(1), 3, 0) });
    expect(menos.salida).toBe(1);
  });

  it('canario: ninguna excepción para blob:, eval ni new Function dentro de los chunks de pdf.js', async () => {
    for (const [extra, regla] of [['var b="blob:";', 'blob:'], ['eval("1");', 'eval'], ['new Function("return 1");', 'new Function']] as const) {
      for (const donde of ['principal', 'worker'] as const) {
        const d: DistPdf = donde === 'principal' ? { principal: chunk(URLS_PRINCIPAL, 3, 0, extra) } : { worker: chunk(URLS_WORKER, 1, 5, extra) };
        const r = await correrPdf(d);
        expect(r.salida, `${donde} ${regla}`).toBe(1);
        expect(r.texto, `${donde} ${regla}`).toContain(`${regla} ×1`);
      }
    }
  });

  it('canario: la misma cuenta en un archivo con otro nombre no goza de la excepción', async () => {
    const r = await correrPdf({ nombrePrincipal: 'otro-C2pV2Gs3.js' });
    expect(r.salida).toBe(1);
    expect(r.texto).toContain('otro-C2pV2Gs3.js: XMLHttpRequest ×3');
    expect((await correrPdf({ nombreWorker: 'pdf.worker.js' })).salida).toBe(1);
  });

  it('canario: un chunk con el nombre de pdf.js pero sin la versión aprobada en su contenido no goza de la excepción', async () => {
    const r = await correrPdf({ principal: chunk(URLS_PRINCIPAL, 3, 0, '', '6.4.300') });
    expect(r.salida).toBe(1);
    expect(r.texto).toContain('pdf-C2pV2Gs3.js: XMLHttpRequest ×3');
  });

  it('canario: si pdfjs-dist cambia de versión, la excepción no vale hasta revisarla de nuevo', async () => {
    const r = await correrPdf({}, '6.5.0');
    expect(r.salida).toBe(1);
    expect(r.texto).toMatch(/versión de pdfjs-dist distinta de la aprobada/);
  });
});

// ===== T-CD-04 dependencias fijadas (4.1, 4.4). `npm ci --ignore-scripts` no se corre en la hackatón (regla 3 de la
// instrucción base): en su lugar se comprueba que lockfile, package.json y lo instalado coinciden. =====
const SECCION_4: Record<string, string> = {
  preact: '10.29.8', '@huggingface/tokenizers': '0.2.0', 'onnxruntime-web': '1.31.0-dev.20260914-8d85527a0', fflate: '0.8.3',
  '@xmldom/xmldom': '0.9.12', 'pdfjs-dist': '6.4.299',
  vite: '8.3.5', typescript: '6.0.3', 'typescript-eslint': '8.72.0', vitest: '5.0.5', '@playwright/test': '1.64.1',
};
const EXACTA = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

describe.concurrent('T-CD-04 dependencias fijadas', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  const lock = JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8')) as { lockfileVersion: number; packages: Record<string, { version?: string; optional?: boolean; dev?: boolean; link?: boolean; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }> };

  it('package.json sin ^, ~ ni rangos: cada versión es exacta', async () => {
    for (const [k, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) expect(v, k).toMatch(EXACTA);
  });

  it('las versiones son las de la sección 4 (4.1 ejecución, 4.4 construcción y pruebas)', async () => {
    const todas = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [k, v] of Object.entries(SECCION_4)) expect(todas[k], k).toBe(v);
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['@huggingface/tokenizers', '@xmldom/xmldom', 'fflate', 'onnxruntime-web', 'pdfjs-dist', 'preact']);
  });

  it('el lockfile (v3) refleja package.json, y lo instalado en node_modules es lo del lockfile', async () => {
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.packages['']?.dependencies).toEqual(pkg.dependencies);
    expect(lock.packages['']?.devDependencies).toEqual(pkg.devDependencies);
    for (const [k, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) expect(lock.packages[`node_modules/${k}`]?.version, k).toBe(v);
    const distintos: string[] = [];
    for (const [ruta, e] of Object.entries(lock.packages)) {
      if (ruta === '' || e.link) continue;
      const pj = join(REPO, ruta, 'package.json');
      if (!existsSync(pj)) { if (!e.optional) distintos.push(`${ruta}: falta`); continue; }
      const instalada = (JSON.parse(readFileSync(pj, 'utf8')) as { version?: string }).version;
      if (instalada !== e.version) distintos.push(`${ruta}: ${String(instalada)} ≠ ${String(e.version)}`);
    }
    expect(distintos).toEqual([]);
  });

  it('ni onnxruntime-node ni @huggingface/transformers ni sharp están instalados (V-06, H0-2)', async () => {
    const nombres = Object.keys(lock.packages).map((k) => k.replace(/^.*node_modules\//, ''));
    for (const prohibido of ['onnxruntime-node', '@huggingface/transformers', 'sharp']) expect(nombres).not.toContain(prohibido);
    expect(readdirSync(join(REPO, 'node_modules')).includes('sharp')).toBe(false);
  });
});
