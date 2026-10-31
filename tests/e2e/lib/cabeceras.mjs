// Lectura del formato _headers de Cloudflare Pages (3.6). Lo usan server.mjs (Node, sin TypeScript) y las pruebas (TypeScript,
// con cabeceras.d.mts): una sola implementación de las reglas, la que aplica el servidor de pruebas.

/** Lee el formato _headers: una ruta (con * como comodín) y cabeceras indentadas. */
export function parseHeaders(texto) {
  const reglas = [];
  let actual = null;
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.trim() || linea.trim().startsWith('#')) continue;
    if (!/^\s/.test(linea)) { actual = { patron: linea.trim(), cabeceras: [] }; reglas.push(actual); continue; }
    const i = linea.indexOf(':');
    if (actual && i > 0) actual.cabeceras.push([linea.slice(0, i).trim(), linea.slice(i + 1).trim()]);
  }
  return reglas;
}

const coincide = (patron, ruta) =>
  new RegExp('^' + patron.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(ruta);

/** Cabeceras que aplican a `ruta` (las reglas posteriores pisan a las anteriores, como en server.mjs y en el SW). */
export function cabecerasPara(reglas, ruta) {
  const h = new Map();
  for (const r of reglas) if (coincide(r.patron, ruta)) for (const [k, v] of r.cabeceras) h.set(k, v);
  return h;
}

/** Añade `report-uri /csp-report` a cada política de un valor de Content-Security-Policy (las políticas van separadas por coma). */
export function conReporteCsp(valor) {
  return valor.split(/\s*,\s*/).map((p) => `${p}; report-uri /csp-report`).join(', ');
}
