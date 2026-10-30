// Validadores de contacto (PA-3; plan 7.2.2): indicativo móvil y correo. TypeScript puro.
// Un validador que falla baja la confianza una muesca; nunca descarta (INV-R03).

/**
 * `NDC`: aproximación a los indicativos de abonado móvil (`^3[0-5]\d`; 300–305, 310–324, 333, 350–351 según fuentes
 * secundarias). No hay listado vigente de la CRC [VERIFICAR]. Recibe los 10 dígitos del celular.
 */
export function ndcMovil(d10: string): boolean {
  return /^3[0-5]\d/u.test(d10);
}

/**
 * `CORREO`: parte local ≤ 64, dominio ≤ 253, sin «..», último rótulo del dominio de 2 a 24 letras.
 * Recibe la dirección ya reconstruida (con «@»).
 */
export function correoValido(s: string): boolean {
  const at = s.lastIndexOf('@');
  if (at <= 0) return false;
  const local = s.slice(0, at);
  const dominio = s.slice(at + 1);
  return local.length <= 64 && dominio.length <= 253 && !local.includes('..') && !dominio.includes('..')
    && /\.\p{L}{2,24}$/u.test(dominio);
}
