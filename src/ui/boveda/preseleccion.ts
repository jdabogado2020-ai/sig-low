// «Abrir» en la Bóveda lleva a Inicio con el asunto ya elegido en la lista (8.2.9). Solo el identificador opaco del asunto (`asu_…`),
// nunca su contenido; vive en memoria y Inicio lo consume una sola vez.
let preseleccionado: string | null = null;

export function fijarPreseleccion(asuntoId: string | null): void {
  preseleccionado = asuntoId;
}

/** Devuelve el asunto preseleccionado y lo olvida. */
export function tomarPreseleccion(): string | null {
  const id = preseleccionado;
  preseleccionado = null;
  return id;
}
