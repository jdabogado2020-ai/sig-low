// Arnés de la prueba de cero red (10.5.1, PD-5a). Una fase de `zero-network.spec.ts` se escribe así:
//
//   import { test, expect } from './lib/arnes';
//   test('T-RD-03 @cero-red fase X: ...', async ({ arnes }) => {
//     const a = await arnes({ dir: 'dist' });              // servidor de la app + señuelo + escucha STUN, en puertos libres
//     const s = await a.sesion();                          // contexto + vigilante (peticiones, CSP de la página y de los workers, consola)
//     const page = await s.nuevaPagina();
//     await page.goto('/');
//     await a.cortar(s, page);                             // fase A termina: sin conexión y recarga (B1)
//     ...                                                  // lo que comprueba la fase, con su `expect` de siempre
//     await a.verificar(s, { secretos: ['Ficticia', '1.000.000.017'] });   // criterios de 10.5.1
//   });
//
// `verificar` aplica los criterios de aceptación de 10.5.1 sin que la fase los repita; lo propio de la fase (títulos, botones,
// textos) se queda en la fase. Para C1 y C2 (PD-4): `a.sesion({ persistente: true })` y, tras cerrar, `a.sesion({ persistente: perfil, offline: true })`.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium, devices, expect, test as base, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { levantarServidor, levantarSenuelo, levantarStun, type OpcionesServidor, type Servidor, type Stun } from './servidores';
import { Vigilante, type OpcionesVigilante } from './vigilante';

export interface OpcionesSesion {
  /** `true`: perfil persistente nuevo (en el temporal del sistema: bajo el proyecto, las rutas de Cache Storage pasan de MAX_PATH en Windows). Una ruta: reabre ese perfil. */
  persistente?: boolean | string;
  /** Arranca sin conexión (solo tiene efecto con perfil persistente; en un contexto efímero use `ctx.setOffline`). */
  offline?: boolean;
  /** Orígenes adicionales que la página puede pedir. */
  origenesPermitidos?: string[];
  consolaPermitida?: string[];
  /** `false`: no concede el portapapeles. */
  portapapeles?: boolean;
}

export class Sesion {
  /** Perfil de un contexto persistente (para reabrirlo). */
  perfil: string | undefined;
  constructor(readonly ctx: BrowserContext, readonly vigilante: Vigilante, perfil?: string) {
    this.perfil = perfil;
  }
  /** La primera página del contexto (la que abre el perfil persistente) o una nueva. */
  async nuevaPagina(): Promise<Page> { return this.ctx.pages()[0] ?? this.ctx.newPage(); }
  /** Cierra el contexto. El perfil persistente se conserva (para reabrirlo con `a.sesion({ persistente: s.perfil })`); el arnés lo borra al terminar. */
  async cerrar(): Promise<void> { await this.ctx.close().catch(() => undefined); }
}

export interface OpcionesVerificar {
  /** Valores que no deben aparecer en ninguna URL, cuerpo ni mensaje de consola (los del gold: literal, vista `lista`, dígitos). */
  secretos?: string[];
  /** Sin corte (la fase no pasa a modo sin conexión) no se exige el silencio del servidor de la app. */
  exigirCorte?: boolean;
}

export class Arnes {
  readonly sesiones: Sesion[] = [];
  private readonly perfilesPropios: string[] = [];
  private cortado = false;
  constructor(
    private readonly browser: Browser,
    readonly app: Servidor,
    readonly senuelo: Servidor,
    readonly stun: Stun,
  ) {}

  /** Origen de la app (`baseURL` de la sesión). */
  get origen(): string { return this.app.origen; }

  /** Contexto nuevo con vigilante. Efímero por defecto; con `persistente`, `launchPersistentContext` en un perfil temporal. */
  async sesion(opciones: OpcionesSesion = {}): Promise<Sesion> {
    const permisos = opciones.portapapeles === false ? [] : ['clipboard-read', 'clipboard-write'];
    const comunes = { baseURL: this.app.origen, serviceWorkers: 'allow' as const, ...devices['Desktop Chrome'] };
    let ctx: BrowserContext;
    let perfil: string | undefined;
    if (opciones.persistente) {
      if (typeof opciones.persistente === 'string') perfil = opciones.persistente;
      else { perfil = mkdtempSync(join(tmpdir(), 'siglow-perfil-')); this.perfilesPropios.push(perfil); }
      ctx = await chromium.launchPersistentContext(perfil, { ...comunes, offline: opciones.offline ?? false });
    } else {
      ctx = await this.browser.newContext({ ...comunes, offline: opciones.offline ?? false });
    }
    // El portapapeles solo se concede al origen de la app (`clipboard-read` está vedado en la política de permisos de la página).
    await ctx.grantPermissions(permisos, { origin: this.app.origen }).catch(() => undefined);
    if (opciones.offline === true) await ctx.addInitScript(SIN_CONEXION);
    const vopc: OpcionesVigilante = {
      origenes: [this.app.origen, ...(opciones.origenesPermitidos ?? [])],
      ...(opciones.consolaPermitida ? { consolaPermitida: opciones.consolaPermitida } : {}),
    };
    const vigilante = await Vigilante.vigilar(ctx, vopc);
    const s = new Sesion(ctx, vigilante, perfil);
    this.sesiones.push(s);
    return s;
  }

  /** Espera a que el service worker controle la página (A1–A2). */
  async esperarControlador(page: Page): Promise<void> {
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, { timeout: 30_000 });
  }

  /**
   * Solo el corte, sin tocar la conexión: lo usan las fases que relanzan un perfil persistente ya sin conexión (C1 y C2 de PD-4:
   * se llama justo antes de cerrar el contexto con conexión; la sesión nueva empieza a contar desde cero).
   */
  marcarCorte(s?: Sesion): void {
    this.app.marcarCorte();
    s?.vigilante.marcarCorte();
    this.cortado = true;
  }

  /** Fin de la fase A: marca el corte en el registro del servidor y en el vigilante, pasa a modo sin conexión y recarga (B1). */
  async cortar(s: Sesion, page: Page): Promise<void> {
    await this.esperarControlador(page);
    this.marcarCorte(s);
    await s.ctx.setOffline(true);
    // Un navegador sin conexión pone navigator.onLine en false; la emulación de Playwright no (la app lo mira desde F10).
    await s.ctx.addInitScript(SIN_CONEXION);
    await page.reload();
    await this.esperarControlador(page);
    expect(await page.evaluate(() => ({ aislado: crossOriginIsolated, controlador: navigator.serviceWorker.controller !== null })), 'B1: aislamiento y controlador sin conexión')
      .toEqual({ aislado: true, controlador: true });
  }

  /** Peticiones del servidor de la app posteriores al corte que no son `GET /sw.js` exacto con cuerpo vacío (la búsqueda de actualización del SW). */
  inesperadasDesdeElCorte(): string[] {
    return this.app.desdeElCorte()
      .filter((p) => !(p.m === 'GET' && /^\/sw\.js$/.test(p.u) && p.b === 0))
      .map((p) => `${p.m} ${p.u}`);
  }

  /** Los criterios de aceptación de 10.5.1 que valen para toda fase. */
  async verificar(s: Sesion, opciones: OpcionesVerificar = {}): Promise<void> {
    const v = s.vigilante;
    expect(v.ajenas, 'peticiones a otros orígenes').toEqual([]);
    expect(v.sockets, 'WebSocket').toEqual([]);
    expect(v.workersAjenos(), 'workers fuera del origen de la app').toEqual([]);
    expect(v.violaciones, 'violaciones de CSP (página y workers)').toEqual([]);
    expect(v.consolaMala(), 'mensajes de consola o pageerror').toEqual([]);
    expect(v.fallidasInesperadas(), 'peticiones fallidas').toEqual([]);
    expect(v.fugas(opciones.secretos ?? []), 'valores del documento en la red o la consola').toEqual([]);
    expect(this.senuelo.peticiones().map((p) => `${p.m} ${p.u}`), 'peticiones al señuelo').toEqual([]);
    expect(this.stun.paquetes(), 'paquetes STUN').toEqual([]);
    expect(this.app.peticiones().filter((p) => p.m !== 'GET' && p.u !== '/csp-report').map((p) => `${p.m} ${p.u}`), 'peticiones no GET al servidor').toEqual([]);
    expect(this.app.peticiones().filter((p) => p.u.startsWith('/csp-report')).map((p) => p.c ?? ''), 'informes de CSP en el servidor').toEqual([]);
    if (opciones.exigirCorte ?? true) {
      expect(this.cortado, 'la fase marcó el corte con a.cortar()').toBe(true);
      expect(this.inesperadasDesdeElCorte(), 'peticiones al servidor tras el corte').toEqual([]);
    }
  }

  async cerrar(): Promise<void> {
    for (const s of this.sesiones.splice(0)) await s.cerrar();
    for (const d of this.perfilesPropios.splice(0)) rmSync(d, { recursive: true, force: true });
    await Promise.all([this.app.parar(), this.senuelo.parar(), this.stun.parar()]);
  }
}

export type FabricaArnes = (opciones?: OpcionesServidor) => Promise<Arnes>;

/** `test` de Playwright con el fixture `arnes`: cada fase pide el suyo y se limpia solo (servidores, UDP, contextos, perfiles). */
/** F10: lo que ve la página en un navegador sin conexión («navigator.onLine» en false). */
const SIN_CONEXION = (): void => { Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true }); };

export const test = base.extend<{ arnes: FabricaArnes }>({
  arnes: async ({ browser }, use) => {
    const creados: Arnes[] = [];
    await use(async (opciones = {}) => {
      // `reporteCsp` queda apagado: con un service worker las respuestas salen de la caché con la CSP de `dist/_headers` (sin report-uri) y
      // el servidor no vería nada; el respaldo de los workers es el dominio `Log` de CDP del vigilante. Se enciende en una página sin SW (fase pdf).
      const [app, senuelo, stun] = await Promise.all([levantarServidor(opciones), levantarSenuelo(), levantarStun()]);
      const a = new Arnes(browser, app, senuelo, stun);
      creados.push(a);
      return a;
    });
    for (const a of creados) await a.cerrar();
  },
});

export { expect };
