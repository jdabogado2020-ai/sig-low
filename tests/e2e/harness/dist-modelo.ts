// Ayudas de las E2E de la entrega del modelo (PF-2): un dist/ derivado con un modelo SINTÉTICO (bytes ficticios, trozos pequeños)
// y un tests/e2e/server.mjs propio con registro de peticiones. Así las pruebas de entrega corren en `verify` sin los 626 MB.
// El dist derivado sale de dist/ como saldría un despliegue: los manifiestos del modelo se reemplazan, se recalcula
// precache.json y la lista incrustada en sw.js (el SW lee los manifiestos del precache, así que la lista debe coincidir).
// Solo datos ficticios: los bytes del «modelo» son una secuencia determinista, no un ONNX.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';

import { serializarLista, sha256Hex, type ArchivoPrecache } from '../../../vite-plugins/precache';
import type { ModelManifest } from '../../../src/core/types';

const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

export interface ModeloSintetico {
  id: ModelManifest['id'];
  manifest: ModelManifest;
  /** ruta relativa a /models/<id>/ → bytes (trozos y auxiliares). */
  archivos: Map<string, Buffer>;
}

export interface OpcionesModelo { trozos: number; tamTrozo: number; semilla: number; tokenizador: Buffer; config: Buffer }

/** Modelo ficticio de `trozos` × `tamTrozo` bytes: tokenizador y config de mentira, ONNX = secuencia determinista. */
export function modeloSintetico(id: ModelManifest['id'], o: Partial<OpcionesModelo> = {}): ModeloSintetico {
  const { trozos = 3, tamTrozo = 40_000, semilla = 7 } = { ...o };
  const partes = Array.from({ length: trozos }, (_, i) => Buffer.from(Uint8Array.from({ length: tamTrozo }, (_, k) => (k * 31 + i * 17 + semilla) & 255)));
  // El último trozo es más corto: el reensamblado no depende de que todos midan lo mismo.
  partes[trozos - 1] = partes[trozos - 1]!.subarray(0, Math.floor(tamTrozo / 3));
  const onnx = Buffer.concat(partes);
  const aux = new Map<string, Buffer>([
    ['tokenizer.json', o.tokenizador ?? Buffer.from(`{"prueba":"tokenizer ficticio ${id}"}`)],
    ['tokenizer_config.json', o.config ?? Buffer.from(`{"prueba":"config ficticia ${id}"}`)],
  ]);
  const archivos = new Map<string, Buffer>(aux);
  const refs = partes.map((b, i) => {
    const ruta = `onnx/model_quantized.onnx.part${String(i).padStart(3, '0')}`;
    archivos.set(ruta, b);
    return { ruta, tamano: b.length, sha256: sha(b) };
  });
  const manifest: ModelManifest = {
    formato: 'sig-low/modelo', v: 1, id, origen: 'prueba/ficticio', familia: 'gliner',
    base: id === 'gliner-x-large' ? 'google/mt5-large' : 'google/mt5-base', cuantizacion: 'q8',
    etiquetas: ['person', 'organization', 'location'], umbral: 0.3, ventanaTokens: 512, solapePalabras: 37, maxTramoPalabras: 12,
    tokenizador: { prefijo: 0, sufijo: 1, cls: false }, archivo: 'onnx/model_quantized.onnx', tamano: onnx.length, sha256: sha(onnx),
    trozos: refs,
    auxiliares: [...aux].map(([ruta, b]) => ({ ruta: ruta as 'tokenizer.json', tamano: b.length, sha256: sha(b) })),
    licencia: 'Apache-2.0', memoria: { wasmMb: 1, jsMb: 1, minimoDispositivoGb: 8 },
  };
  return { id, manifest, archivos };
}

/** Los bytes del ONNX reensamblado de un modelo sintético (lo que el worker debe recibir). */
export const onnxDe = (m: ModeloSintetico): Buffer =>
  Buffer.concat(m.manifest.trozos.map((t) => m.archivos.get(t.ruta)!));

/**
 * Copia `origen` (dist/) en `destino` con los modelos dados en `models/<id>/` y los manifiestos del precache reemplazados.
 * `alterar` permite dejar en disco un trozo distinto del que declara el manifiesto (despliegue roto o manipulado).
 */
export function distConModelos(origen: string, destino: string, modelos: ModeloSintetico[], alterar?: (id: string, ruta: string, bytes: Buffer) => Buffer): void {
  rmSync(destino, { recursive: true, force: true });
  cpSync(origen, destino, { recursive: true });
  rmSync(join(destino, 'models'), { recursive: true, force: true });
  const manifiestos = new Map<string, Buffer>();
  for (const m of modelos) {
    const dir = join(destino, 'models', m.id);
    const texto = Buffer.from(JSON.stringify(m.manifest, null, 2) + '\n');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), texto);
    manifiestos.set(`/models/${m.id}/manifest.json`, texto);
    for (const [ruta, bytes] of m.archivos) {
      mkdirSync(dirname(join(dir, ruta)), { recursive: true });
      writeFileSync(join(dir, ruta), alterar ? alterar(m.id, ruta, bytes) : bytes);
    }
  }
  const vieja = readFileSync(join(destino, 'precache.json'), 'utf8');
  const { archivos } = JSON.parse(vieja) as { archivos: ArchivoPrecache[] };
  const nueva = serializarLista(archivos.map((a) => {
    const texto = manifiestos.get(a.ruta);
    return texto ? { ruta: a.ruta, sha256: sha256Hex(texto), bytes: texto.length } : a;
  }));
  writeFileSync(join(destino, 'precache.json'), nueva);
  const sw = readFileSync(join(destino, 'sw.js'), 'utf8');
  if (sw.split(JSON.stringify(vieja)).length - 1 !== 1) throw new Error('sw.js no incrusta la lista exacta una vez');
  writeFileSync(join(destino, 'sw.js'), sw.replace(JSON.stringify(vieja), () => JSON.stringify(nueva)));
}

export interface Peticion { t: number; m: string; u: string }
export interface Servidor { origen: string; peticiones: () => Peticion[]; parar: () => Promise<void> }

/** Puerto libre elegido por el sistema (se libera justo antes de que server.mjs lo tome). */
function puertoLibre(): Promise<number> {
  return new Promise((ok, mal) => {
    const s = createServer();
    s.once('error', mal);
    s.listen(0, '127.0.0.1', () => {
      const dir = s.address();
      s.close(() => { if (dir && typeof dir === 'object') ok(dir.port); else mal(new Error('sin puerto')); });
    });
  });
}

/** tests/e2e/server.mjs (la configuración real: aplica dist/_headers) sobre `dir`, con el registro de peticiones en `registro`. */
export async function levantarServidor(dir: string, registro: string): Promise<Servidor> {
  const puerto = await puertoLibre();
  writeFileSync(registro, '');
  const hijo = spawn(process.execPath, [resolve('tests/e2e/server.mjs'), '--dir', dir, '--port', String(puerto)], {
    env: { ...process.env, SIGLOW_REGISTRO_PETICIONES: registro },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  await new Promise<void>((ok, mal) => {
    hijo.stdout.on('data', (b: Buffer) => { if (b.toString().includes('listo')) ok(); });
    hijo.once('exit', (c) => { mal(new Error(`server.mjs terminó (código ${String(c)})`)); });
  });
  return {
    origen: `http://127.0.0.1:${puerto}`,
    peticiones: () => readFileSync(registro, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Peticion),
    parar: () => new Promise<void>((ok) => {
      if (hijo.exitCode !== null) { ok(); return; }
      hijo.once('exit', () => { ok(); });
      hijo.kill();
    }),
  };
}

/** Peticiones al modelo (todo lo que empieza por /models/) del registro. */
export const delModelo = (ps: Peticion[]): Peticion[] => ps.filter((p) => p.u.startsWith('/models/'));

/** Rutas que la descarga debe pedir según el manifiesto: auxiliares y trozos (los manifiestos salen del precache, no de la descarga). */
export const rutasDelManifiesto = (m: ModelManifest): string[] =>
  [...m.auxiliares.map((a) => a.ruta), ...m.trozos.map((t) => t.ruta)].map((r) => `/models/${m.id}/${r}`).sort();
