// Validador del dígito de verificación (DV) del NIT (7.2.2, `ValidatorName` DV_NIT). TypeScript puro: sin DOM ni red.
// Un DV que no coincide nunca descarta una detección: solo baja la confianza (INV-R03, INV-G12).

/** Pesos de la DIAN, de derecha a izquierda sobre la base. */
const PESOS_NIT = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71] as const;

/**
 * DV esperado para una base de solo dígitos (hasta 15). `r = suma mod 11`; DV = `r` si `r ≤ 1`, si no `11 − r`.
 * Comprobado con NIT públicos: 800197268 → 4; 901267344 → 3. Vale para persona jurídica y natural.
 */
export function dvNit(base: string): number {
  let suma = 0;
  for (let i = 0; i < base.length && i < PESOS_NIT.length; i++) {
    const digito = base.charCodeAt(base.length - 1 - i) - 48;
    suma += digito * PESOS_NIT[i]!;
  }
  const r = suma % 11;
  return r <= 1 ? r : 11 - r;
}

/** `true` si `dv` (un solo dígito) coincide con el DV esperado de `base`. */
export function dvNitCoincide(base: string, dv: string | number): boolean {
  return dvNit(base) === Number(dv);
}

/** Persona jurídica: base de 9 dígitos que empieza por 8 o 9 (7.2.3, R-NIT-01). Cualquier otra base es persona natural. */
export function esNitJuridico(base: string): boolean {
  return base.length === 9 && (base[0] === '8' || base[0] === '9');
}
