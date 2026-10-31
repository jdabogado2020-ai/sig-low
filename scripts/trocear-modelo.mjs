// Trocea el modelo (3.3, 6.11.3; PF-2): parte `onnx/model_quantized.onnx` en trozos de 24 MiB (el alojamiento admite 25 MiB por
// archivo), calcula el SHA-256 de cada trozo y del archivo entero y escribe `manifest.json`. Sin red: lee de h0/modelos.
//
//   node scripts/trocear-modelo.mjs [--id gliner-x-large|gliner-x-base|todos] [--origen <modelos>] [--salida <dir>]
//                                   [--sin-trozos] [--verificar]
//
// - Por defecto escribe en public/models/<id>/: `manifest.json` (se versiona), los trozos en `onnx/` y los dos auxiliares
//   que el motor necesita (`tokenizer.json`, `tokenizer_config.json`). public/models/.gitignore deja fuera todo menos el
//   manifiesto: los artefactos se regeneran en cada despliegue desde este script.
// - `--sin-trozos` escribe solo el manifiesto (el cálculo es el mismo: los hashes salen del archivo de origen).
// - `--verificar` no escribe: recalcula el manifiesto y falla si difiere del versionado (exit 1).
// - El SHA-256 del ONNX y de los auxiliares debe coincidir con los fijados en H0-5/H0-6 (h0/huellas.txt): si no, aborta.
// Los manifiestos son deterministas (mismas entradas, mismos bytes). Memoria: se lee un trozo por vez.
import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TROZO = 25_165_824; // 24 MiB
const ONNX = 'onnx/model_quantized.onnx';

// Huellas fijadas en H0-5, H0-6 y H0-8 (h0/huellas.txt, sección 4.2 del plan).
const MODELOS = {
  'gliner-x-large': {
    carpeta: 'gliner-x-large', origen: 'knowledgator/gliner-x-large', base: 'google/mt5-large',
    memoria: { wasmMb: 1474, jsMb: 586, minimoDispositivoGb: 8 },
    sha256: { [ONNX]: '90a7d3b8bf985da65748f0b1972bd6696bab34f375f23ad4f4a60ac14842ad2c', 'tokenizer.json': '644a91650f64b0fe5974cefcd293bafa754f014f8f72503ae7940ae652d22b2f', 'tokenizer_config.json': 'b7502927c4693c1c7234d1267dcd422fcc2d7597c51abfe3913fedc1a0f766e6' },
  },
  'gliner-x-base': {
    carpeta: 'gliner-x-base', origen: 'knowledgator/gliner-x-base', base: 'google/mt5-base',
    memoria: { wasmMb: 812, jsMb: 400, minimoDispositivoGb: 4 },
    sha256: { [ONNX]: '9850feb5ecd7ccfa3e4f1802b7c7d404f1b357cb7b6198cc014fb441e91ace43', 'tokenizer.json': '619d3790cf59a0e50afdf04239db19093568fbd8d806963e35d54a8fb71d099c', 'tokenizer_config.json': '08540ea44a5b8bf6a155e89902698c642d623657996c6e4d898236b159589404' },
  },
};

function argumentos(argv) {
  const a = { id: 'todos', origen: join(RAIZ, '..', 'h0', 'modelos'), salida: join(RAIZ, 'public', 'models'), sinTrozos: false, verificar: false };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--id') a.id = argv[++i];
    else if (k === '--origen') a.origen = resolve(argv[++i]);
    else if (k === '--salida') a.salida = resolve(argv[++i]);
    else if (k === '--sin-trozos') a.sinTrozos = true;
    else if (k === '--verificar') a.verificar = true;
    else throw new Error(`argumento desconocido: ${k}`);
  }
  if (a.id !== 'todos' && !(a.id in MODELOS)) throw new Error(`--id debe ser gliner-x-large, gliner-x-base o todos`);
  return a;
}

/** Lee `ruta` en trozos de `TROZO` bytes y llama a `alTrozo(bytes, indice)`; devuelve el SHA-256 del archivo y los de cada trozo. */
function recorrer(ruta, alTrozo) {
  const total = statSync(ruta).size;
  const entero = createHash('sha256');
  const trozos = [];
  const fd = openSync(ruta, 'r');
  try {
    const buf = Buffer.alloc(TROZO);
    for (let pos = 0, i = 0; pos < total; i += 1) {
      const n = Math.min(TROZO, total - pos);
      let leido = 0;
      while (leido < n) {
        const r = readSync(fd, buf, leido, n - leido, pos + leido);
        if (r === 0) throw new Error(`lectura truncada: ${ruta}`);
        leido += r;
      }
      const trozo = buf.subarray(0, n);
      entero.update(trozo);
      trozos.push({ tamano: n, sha256: createHash('sha256').update(trozo).digest('hex') });
      alTrozo?.(trozo, i);
      pos += n;
    }
  } finally {
    closeSync(fd);
  }
  return { tamano: total, sha256: entero.digest('hex'), trozos };
}

const nombreTrozo = (i) => `${ONNX}.part${String(i).padStart(3, '0')}`;

function construir(id, a) {
  const cfg = MODELOS[id];
  const origen = join(a.origen, cfg.carpeta);
  const destino = join(a.salida, id);
  const escribe = !a.verificar && !a.sinTrozos;
  if (escribe) mkdirSync(join(destino, 'onnx'), { recursive: true });
  const onnx = recorrer(join(origen, ONNX), escribe ? (b, i) => writeFileSync(join(destino, nombreTrozo(i)), b) : undefined);
  if (onnx.sha256 !== cfg.sha256[ONNX]) throw new Error(`${id}: el SHA-256 del ONNX no es el fijado en H0-5/H0-6`);
  const auxiliares = [];
  for (const ruta of ['tokenizer.json', 'tokenizer_config.json']) {
    const bytes = readFileSync(join(origen, ruta));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== cfg.sha256[ruta]) throw new Error(`${id}: el SHA-256 de ${ruta} no es el fijado en H0-5/H0-6`);
    auxiliares.push({ ruta, tamano: bytes.length, sha256 });
    if (escribe) copyFileSync(join(origen, ruta), join(destino, ruta));
  }
  const manifiesto = {
    formato: 'sig-low/modelo', v: 1, id, origen: cfg.origen, familia: 'gliner', base: cfg.base, cuantizacion: 'q8',
    etiquetas: ['person', 'organization', 'location'], umbral: 0.3, ventanaTokens: 512, solapePalabras: 37, maxTramoPalabras: 12,
    tokenizador: { prefijo: 0, sufijo: 1, cls: false }, archivo: ONNX, tamano: onnx.tamano, sha256: onnx.sha256,
    trozos: onnx.trozos.map((t, i) => ({ ruta: nombreTrozo(i), tamano: t.tamano, sha256: t.sha256 })),
    auxiliares, licencia: 'Apache-2.0', memoria: cfg.memoria,
  };
  if (manifiesto.trozos.some((t) => t.tamano > TROZO)) throw new Error(`${id}: un trozo pasa de 24 MiB`);
  return { manifiesto, destino };
}

const a = argumentos(process.argv.slice(2));
let fallos = 0;
for (const id of a.id === 'todos' ? Object.keys(MODELOS) : [a.id]) {
  const { manifiesto, destino } = construir(id, a);
  const texto = JSON.stringify(manifiesto, null, 2) + '\n';
  const ruta = join(a.verificar ? join(RAIZ, 'public', 'models', id) : destino, 'manifest.json');
  if (a.verificar) {
    const igual = existsSync(ruta) && readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n') === texto;
    process.stdout.write(`${igual ? 'ok ' : 'DIFIERE'} ${id}: ${manifiesto.trozos.length} trozos, ${manifiesto.auxiliares.length} auxiliares\n`);
    if (!igual) fallos += 1;
  } else {
    mkdirSync(destino, { recursive: true });
    writeFileSync(ruta, texto);
    process.stdout.write(`${id}: ${manifiesto.trozos.length} trozos (${manifiesto.tamano} B), sha256 ${manifiesto.sha256.slice(0, 12)}…\n`);
  }
}
if (fallos) process.exit(1);
