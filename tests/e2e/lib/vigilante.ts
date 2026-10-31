// Vigilante de un contexto de Playwright (10.5.1, PD-5a): todo lo que el navegador ve, en un solo lugar.
//  - peticiones (`context.on('request')`, incluidas las del service worker), fallidas y WebSocket;
//  - violaciones de CSP de la página y de los marcos, por un enlace (`exposeBinding`) que sobrevive a recargas y navegaciones;
//  - violaciones de CSP de los workers y del service worker, por un escucha que se instala en cuanto aparece cada worker;
//  - consola (página y workers) y `pageerror`.
// El navegador emite `request` también para lo que bloquea la CSP o atiende el SW desde la caché: la verdad de referencia es el
// registro del servidor (servidores.ts). Este vigilante aporta lo que el servidor no ve: bloqueos, caché y consola.
import type { BrowserContext, ConsoleMessage, Page, Worker } from '@playwright/test';

export interface OpcionesVigilante {
  /** Orígenes que la página puede pedir (el de la app y, si la prueba la sirve, el de la auxiliar). */
  origenes: string[];
  /** Mensajes de consola permitidos, por texto exacto (los avisos del `.mjs` de ORT). */
  consolaPermitida?: string[];
}

export interface PeticionVista { url: string; metodo: string; cuerpo: string; desdeSw: boolean }
export interface MensajeConsola { fuente: 'pagina' | 'worker'; tipo: string; texto: string }

const MARCA_WORKER = '__SIGLOW_CSP__ ';
const ENLACE = '__siglowCsp';

export class Vigilante {
  /** Orígenes ajenos a `origenes` que se pidieron (sin `blob:` ni `data:`). */
  readonly ajenas: string[] = [];
  /** URL de cada petición que falló (sin conexión, bloqueada por la CSP o rechazada por el SW). */
  readonly fallidas: string[] = [];
  private corteFallidas = 0;
  readonly sockets: string[] = [];
  readonly peticiones: PeticionVista[] = [];
  readonly consola: MensajeConsola[] = [];
  readonly workers: string[] = [];
  /** `pagina:<directiva>` o `worker:<directiva>`. */
  readonly violaciones: string[] = [];
  private readonly permitidos: Set<string>;
  private readonly consolaPermitida: Set<string>;

  private constructor(opciones: OpcionesVigilante) {
    this.permitidos = new Set(opciones.origenes);
    this.consolaPermitida = new Set(opciones.consolaPermitida ?? []);
  }

  /** Debe llamarse antes de crear las páginas del contexto: el enlace y el escucha entran por `addInitScript`. */
  static async vigilar(ctx: BrowserContext, opciones: OpcionesVigilante): Promise<Vigilante> {
    const v = new Vigilante(opciones);
    await ctx.exposeBinding(ENLACE, (_origen, directiva: string) => { v.violaciones.push(`pagina:${directiva}`); });
    await ctx.addInitScript(`addEventListener('securitypolicyviolation', (e) => { try { globalThis.${ENLACE}(e.effectiveDirective); } catch { /* sin enlace */ } });`);

    ctx.on('request', (r) => {
      const u = new URL(r.url());
      if (u.protocol !== 'blob:' && u.protocol !== 'data:' && !v.permitidos.has(u.origin)) v.ajenas.push(u.origin);
      v.peticiones.push({ url: r.url(), metodo: r.method(), cuerpo: r.postData() ?? '', desdeSw: r.serviceWorker() !== null });
    });
    ctx.on('requestfailed', (r) => { v.fallidas.push(r.url()); });
    ctx.on('console', (m) => { v.anotarConsola(m); });
    ctx.on('weberror', () => { v.consola.push({ fuente: 'pagina', tipo: 'pageerror', texto: '' }); });
    ctx.on('serviceworker', (w) => { v.vigilarWorker(w); });
    const vigilarPagina = (p: Page): void => {
      p.on('worker', (w) => { v.vigilarWorker(w); });
      p.on('websocket', (ws) => { v.sockets.push(ws.url()); });
      v.vigilarRegistroCdp(ctx, p);
    };
    ctx.on('page', vigilarPagina);
    for (const p of ctx.pages()) vigilarPagina(p);
    return v;
  }

  private anotarConsola(m: ConsoleMessage): void {
    const texto = m.text();
    if (texto.startsWith(MARCA_WORKER)) { this.violaciones.push(`worker:${texto.slice(MARCA_WORKER.length)}`); return; }
    this.consola.push({ fuente: m.worker() ? 'worker' : 'pagina', tipo: m.type(), texto });
  }

  /**
   * Respaldo por CDP (10.5.1): el dominio `Log` del navegador anota desde el primer instante las violaciones de CSP de los workers
   * (`source: 'worker'`), también las que ocurren antes de que el escucha de `vigilarWorker` exista, y `Log.enable` reenvía lo ya anotado.
   */
  private vigilarRegistroCdp(ctx: BrowserContext, p: Page): void {
    void (async () => {
      const cdp = await ctx.newCDPSession(p);
      cdp.on('Log.entryAdded', (e) => {
        const t = e.entry.text;
        if (!/violates the following Content Security Policy directive|Refused to/.test(t)) return;
        const directiva = /directive: "([a-z-]+)/.exec(t)?.[1] ?? 'desconocida';
        this.violaciones.push(e.entry.source === 'worker' ? `worker:${directiva}` : `registro-${e.entry.source}:${directiva}`);
      });
      await cdp.send('Log.enable');
    })().catch(() => undefined); // la página se cerró antes de abrir la sesión
  }

  private vigilarWorker(w: Worker): void {
    this.workers.push(w.url());
    // Un `securitypolicyviolation` de un worker no llega a la página: el escucha lo vuelve un mensaje de consola que sí llega aquí.
    w.evaluate((marca) => {
      addEventListener('securitypolicyviolation', (e) => { console.error(`${marca}${e.effectiveDirective}`); });
    }, MARCA_WORKER).catch(() => undefined);
  }

  /** Marca el corte (la app pasa a funcionar sin conexión): desde aquí, solo la búsqueda de actualización del SW puede fallar. */
  marcarCorte(): void { this.corteFallidas = this.fallidas.length; }

  /** Peticiones fallidas antes del corte (con conexión no debe haber ninguna) y después (solo `/sw.js`, la búsqueda del SW). */
  fallidasInesperadas(): string[] {
    const sw = (u: string): boolean => new URL(u).pathname === '/sw.js';
    return [...this.fallidas.slice(0, this.corteFallidas), ...this.fallidas.slice(this.corteFallidas).filter((u) => !sw(u))];
  }

  /** Mensajes de consola que cuentan como fallo: errores, advertencias y `pageerror`, salvo la lista permitida por texto exacto. */
  consolaMala(): string[] {
    return this.consola
      .filter((c) => (c.tipo === 'error' || c.tipo === 'warning' || c.tipo === 'pageerror') && !this.consolaPermitida.has(c.texto))
      .map((c) => `${c.fuente}:${c.tipo}`);
  }

  /** Secretos (valores del gold, texto del documento) que aparecen en una URL, en una URL decodificada, en un cuerpo o en la consola. */
  fugas(secretos: string[]): string[] {
    const halladas: string[] = [];
    for (const s of secretos) {
      for (const q of this.peticiones) {
        let url = q.url;
        try { url = decodeURIComponent(q.url); } catch { /* se queda la URL cruda */ }
        if (q.url.includes(s) || url.includes(s)) halladas.push(`url:${s}`);
        if (q.cuerpo.includes(s)) halladas.push(`cuerpo:${s}`);
      }
      if (this.consola.some((c) => c.texto.includes(s))) halladas.push(`consola:${s}`);
    }
    return halladas;
  }

  /** Workers cuyo origen no es uno de los permitidos (un `blob:` o `data:` también cuenta: pdf.js debe usar su archivo propio). */
  workersAjenos(): string[] {
    return this.workers.filter((u) => {
      try { const x = new URL(u); return x.protocol !== 'http:' && x.protocol !== 'https:' || !this.permitidos.has(x.origin); } catch { return true; }
    });
  }
}
