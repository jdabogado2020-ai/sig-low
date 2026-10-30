/**
 * Prueba de humo del modelo (H0-5, H0-6, V-08). Código propio de Sig-Low.
 *
 * Cinco frases ficticias con al menos ocho entidades (PER, ORG y LOC) en total. Un ONNX q8 roto devuelve
 * puntajes casi uniformes y cero detecciones sin lanzar ningún error: se rechaza con `MODELO_INTEGRIDAD`.
 * Las frases son las F01 a F05 de `h0/referencia-gliner.json`; todos los nombres son ficticios.
 */

export const FRASES_DE_HUMO: readonly string[] = [
  'El señor PEDRO EJEMPLO GÓMEZ, mayor de edad y vecino de Bucaramanga, interpuso acción de tutela contra la EPS Salud Ficticia S.A.S. por la negativa de un procedimiento ordenado por su médico tratante.',
  'La doctora Marta Prueba Ñañez, apoderada de la Clínica Ejemplo del Norte, radicó el memorial ante el Juzgado Primero Civil Municipal de Barranquilla el 14 de marzo de 2026.',
  'ACCIONANTE: ANA FICTICIA ROJAS; ACCIONADA: SUPERINTENDENCIA FICTICIA DE SALUD; CIUDAD: MEDELLÍN; APODERADO: LUIS PRUEBA NÚÑEZ.',
  '«La Fundación Prueba del Caribe — con sede en Cartagena — manifestó que el señor Luis Ejemplo Muñoz no había recibido notificación alguna», dijo el apoderado en la audiencia celebrada en Santa Marta.',
  'Gracias, doctor Andrés Ficticio 😊 — le escribo desde Cali; la Notaría Ejemplo de Palmira ya recibió los documentos de Carmen Prueba Peña.',
];

/** Mínimo de entidades entre las cinco frases. Los modelos íntegros dan 18. */
export const MINIMO_ENTIDADES_DE_HUMO = 8;
