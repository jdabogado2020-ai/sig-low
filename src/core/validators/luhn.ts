// Validador Luhn (PA-5; plan 7.2.2, `ValidatorName` «LUHN»). TypeScript puro.
// Con rótulo y pasa → precedencia 3. Sin rótulo, máximo `media`: cerca del 10 % de las cadenas de 16 dígitos al azar
// pasan. Un validador que falla baja la confianza una muesca; nunca descarta (INV-R03).

/**
 * Luhn estándar sobre una cadena de dígitos. Tolera los separadores de una tarjeta impresa (espacio y guion); cualquier
 * otro carácter, o menos de dos dígitos, da `false`. No exige longitud: eso es del patrón de la regla.
 */
export function luhn(d: string): boolean {
  if (/[^0-9 \-]/u.test(d)) return false;
  const digitos = d.replace(/[ \-]/gu, '');
  if (digitos.length < 2) return false;
  let suma = 0;
  let duplicar = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let n = digitos.charCodeAt(i) - 48;
    if (duplicar) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    suma += n;
    duplicar = !duplicar;
  }
  return suma % 10 === 0;
}
