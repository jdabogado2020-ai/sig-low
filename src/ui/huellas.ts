// Huellas de «Acerca de» (8.2.11, 3.2): SHA-256 de index.html y de la lista de precache, calculadas con
// `caches.match` y `crypto.subtle.digest`, sin `fetch`. Son informativas: las calcula el propio código en ejecución.

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function huellaDe(...rutas: string[]): Promise<string | null> {
  if (typeof caches === 'undefined' || typeof crypto === 'undefined' || !crypto.subtle) return null;
  for (const ruta of rutas) {
    try {
      const r = await caches.match(ruta);
      if (r) return await sha256Hex(await r.clone().arrayBuffer());
    } catch {
      // Caché ilegible: se informa como no disponible (M-154).
    }
  }
  return null;
}

export interface Huellas { indexHtml: string | null; precache: string | null }

export async function calcularHuellas(): Promise<Huellas> {
  const [indexHtml, precache] = await Promise.all([huellaDe('/index.html', '/'), huellaDe('/precache.json')]);
  return { indexHtml, precache };
}

/** `app.compilacion` del informe (6.8) y del pie: los 12 primeros hexadecimales del SHA-256 de index.html. */
export function compilacionCorta(indexHtml: string | null): string | null {
  return indexHtml === null ? null : indexHtml.slice(0, 12);
}

/** Dirección oficial (SUPUESTO sobre el nombre exacto, 3.6); P0-5 la confirma al desplegar. */
export const DIRECCION_OFICIAL = 'sig-low.vergarameloabogado.site';
