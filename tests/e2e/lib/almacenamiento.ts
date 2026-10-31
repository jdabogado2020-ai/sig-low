// Volcado del almacenamiento del origen (10.5.1, paso B10; T-RD-06): IndexedDB crudo, Cache Storage con sus URL, `localStorage`,
// `sessionStorage`, cookies, `history.state`, `document.title` y la URL. Es lo que la prueba lee para exigir que no quede ningún
// original fuera de `ct` (INV-G02, INV-V01), que Cache Storage guarde solo la app y el modelo (INV-G10) y que el título sea neutro.
import type { Page } from '@playwright/test';

export interface Volcado {
  /** base de datos → almacén → registros; los bytes se vuelven texto latin1 (un original en claro se vería tal cual). */
  indexedDB: Record<string, Record<string, unknown[]>>;
  /** nombre de la caché → URL (ruta + query) de cada entrada. */
  caches: Record<string, string[]>;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  cookies: unknown[];
  historyState: unknown;
  title: string;
  url: string;
}

export async function volcarAlmacenamiento(page: Page): Promise<Volcado> {
  const propio = await page.evaluate(async () => {
    const plano = (v: unknown): unknown => {
      if (v instanceof ArrayBuffer) return String.fromCharCode(...new Uint8Array(v));
      if (ArrayBuffer.isView(v)) return String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
      if (Array.isArray(v)) return v.map(plano);
      if (v instanceof Date) return v.toISOString();
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plano(x)]));
      return v;
    };
    const pedir = <T,>(r: IDBRequest<T>): Promise<T> => new Promise((ok, mal) => { r.onsuccess = () => { ok(r.result); }; r.onerror = () => { mal(new Error('idb')); }; });
    const idb: Record<string, Record<string, unknown[]>> = {};
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      const db = await pedir(indexedDB.open(name));
      const almacenes: Record<string, unknown[]> = {};
      for (const nombre of Array.from(db.objectStoreNames)) {
        const tx = db.transaction(nombre, 'readonly');
        const store = tx.objectStore(nombre);
        const claves = await pedir(store.getAllKeys());
        const valores = await pedir(store.getAll());
        almacenes[nombre] = valores.map((v, i) => ({ clave: plano(claves[i]), valor: plano(v) }));
      }
      db.close();
      idb[name] = almacenes;
    }
    const cs: Record<string, string[]> = {};
    for (const k of await caches.keys()) {
      cs[k] = (await (await caches.open(k)).keys()).map((r) => { const u = new URL(r.url); return u.pathname + u.search; }).sort();
    }
    const copia = (a: Storage): Record<string, string> => Object.fromEntries(Object.keys(a).map((k) => [k, a.getItem(k) ?? '']));
    return {
      indexedDB: idb, caches: cs, localStorage: copia(localStorage), sessionStorage: copia(sessionStorage),
      historyState: history.state as unknown, title: document.title, url: location.href,
    };
  });
  return { ...propio, cookies: await page.context().cookies() };
}

/** Todo el volcado como un solo texto, para buscar valores en claro (los bytes de IndexedDB ya vienen en latin1). */
export const textoDelVolcado = (v: Volcado): string => JSON.stringify(v);
