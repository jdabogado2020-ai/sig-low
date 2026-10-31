// Servidores del arnés de cero red (10.5.1, PD-5a): el de la app, el señuelo y la escucha de STUN.
// Todos piden el puerto al sistema (`--port 0`, `listen(0)`): ninguna prueba usa un puerto fijo ni «PORT + n».
import { spawn, type ChildProcess } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Una línea del registro de server.mjs: la verdad de referencia (el navegador emite `request` también para lo que bloquea la CSP). */
export interface Peticion {
  /** Hora (ms). */
  t: number;
  /** Método. */
  m: string;
  /** `req.url` decodificada como ruta + query (`/ruta?q=1`). */
  u: string;
  /** Solo la ruta. */
  p: string;
  /** Solo la query, sin «?». */
  q: string;
  /** Bytes del cuerpo recibido. */
  b: number;
  /** Cuerpo (utf-8, hasta 64 KiB) cuando lo hay. */
  c?: string;
  /** Cabeceras de origen: host, origin, referer, sec-fetch-*, content-type. */
  h: Record<string, string>;
}

export interface OpcionesServidor {
  /** Carpeta que se sirve (por defecto `dist`). */
  dir?: string;
  /** Modo señuelo: 200 a todo, con `Access-Control-Allow-Origin: *`. */
  senuelo?: boolean;
  /** Omite solo la CSP (T-CS-03). */
  sinCsp?: boolean;
  /** Añade `report-uri /csp-report` a cada política y registra los informes (cubre los workers; solo con conexión). */
  reporteCsp?: boolean;
  /** Archivo del registro (por defecto uno temporal propio, que `parar()` borra). */
  registro?: string;
}

export interface Servidor {
  origen: string;
  puerto: number;
  /** Todo el registro, de la primera petición a la última. */
  peticiones(): Peticion[];
  /** Marca el corte (entre la fase A y la B): devuelve cuántas peticiones había. */
  marcarCorte(): number;
  /** Las peticiones posteriores al último corte. */
  desdeElCorte(): Peticion[];
  parar(): Promise<void>;
}

const MAX_ESPERA_MS = 20_000;

/** Lee un registro JSONL ignorando la última línea si aún está a medias. */
export function leerRegistro(archivo: string): Peticion[] {
  const lineas = readFileSync(archivo, 'utf8').split('\n');
  lineas.pop(); // tras el último salto de línea queda '' o una línea a medias
  return lineas.filter(Boolean).map((l) => JSON.parse(l) as Peticion);
}

/** tests/e2e/server.mjs (la configuración real: aplica `_headers`) en un puerto libre, con registro. */
export async function levantarServidor(opciones: OpcionesServidor = {}): Promise<Servidor> {
  const propio = opciones.registro === undefined ? mkdtempSync(join(tmpdir(), 'siglow-reg-')) : undefined;
  const registro = opciones.registro ?? join(propio!, 'peticiones.jsonl');
  writeFileSync(registro, '');
  const args = [resolve('tests/e2e/server.mjs'), '--dir', resolve(opciones.dir ?? 'dist'), '--port', '0', '--padre', String(process.pid)];
  if (opciones.senuelo) args.push('--senuelo');
  if (opciones.sinCsp) args.push('--sin-csp');
  if (opciones.reporteCsp) args.push('--reporte-csp');
  const hijo: ChildProcess = spawn(process.execPath, args, {
    env: { ...process.env, SIGLOW_REGISTRO_PETICIONES: registro },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const puerto = await new Promise<number>((ok, mal) => {
    const reloj = setTimeout(() => { hijo.kill(); mal(new Error('server.mjs no declaró su puerto a tiempo')); }, MAX_ESPERA_MS);
    let visto = '';
    hijo.stdout?.on('data', (b: Buffer) => {
      visto += b.toString();
      const m = /listo en http:\/\/127\.0\.0\.1:(\d+)/.exec(visto);
      if (m) { clearTimeout(reloj); ok(Number(m[1])); }
    });
    hijo.once('exit', (c) => { clearTimeout(reloj); mal(new Error(`server.mjs terminó (código ${String(c)})`)); });
  });
  let corte = 0;
  return {
    origen: `http://127.0.0.1:${puerto}`,
    puerto,
    peticiones: () => leerRegistro(registro),
    marcarCorte: () => { corte = leerRegistro(registro).length; return corte; },
    desdeElCorte: () => leerRegistro(registro).slice(corte),
    parar: () => new Promise<void>((ok) => {
      const limpiar = (): void => { if (propio) rmSync(propio, { recursive: true, force: true }); ok(); };
      if (hijo.exitCode !== null) { limpiar(); return; }
      hijo.once('exit', limpiar);
      hijo.kill();
    }),
  };
}

/** Servidor señuelo (otro origen, otro puerto): responde 200 a todo; una fuga que pase la CSP queda registrada aquí. */
export const levantarSenuelo = (): Promise<Servidor> => levantarServidor({ senuelo: true });

export interface PaqueteUdp { bytes: number; stun: boolean }
export interface Stun {
  puerto: number;
  /** Servidor STUN de la forma que se pasa a `iceServers`. */
  url: string;
  paquetes(): PaqueteUdp[];
  parar(): Promise<void>;
}

/** Escucha UDP en 127.0.0.1: la CSP no bloquea WebRTC y `setOffline` tampoco lo afecta; cualquier paquete es una fuga. */
export async function levantarStun(): Promise<Stun> {
  const vistos: PaqueteUdp[] = [];
  const s = createSocket('udp4');
  s.on('message', (m) => {
    // Cookie mágica de STUN (RFC 5389): 0x2112A442 en los bytes 4 a 7.
    vistos.push({ bytes: m.length, stun: m.length >= 20 && m.readUInt32BE(4) === 0x2112a442 });
  });
  await new Promise<void>((ok, mal) => { s.once('error', mal); s.bind(0, '127.0.0.1', () => { ok(); }); });
  const puerto = s.address().port;
  return {
    puerto,
    url: `stun:127.0.0.1:${puerto}`,
    paquetes: () => [...vistos],
    parar: () => new Promise<void>((ok) => { s.close(() => { ok(); }); }),
  };
}
