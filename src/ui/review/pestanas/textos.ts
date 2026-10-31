// Textos de la Revisión II (PC-4) que 8.2 y 8.5 no traen con id. Ids definitivos M-1801 a M-1865 (PC-7 los unificó: eran
// M-1401 a M-1465, que chocaban con los de Listo). Se registran en el catálogo único con `registrarMensajes()`, así que el
// barrido de textos prohibidos y la prueba de ids únicos (tests/unit/mensajes.test.ts) los ven.
// Los mensajes solo reciben valores [P]: números, tipos y etiquetas. Nunca texto del documento.
import { registrarMensajes, t, type MessageId, type MsgParam } from '../../mensajes.ts';

const TEXTOS = {
  // Pestañas y listas
  'M-1801': 'Revisión asistida del panel lateral',
  'M-1802': 'Sin decidir: {n}',
  'M-1803': 'No hay sugerencias de generalización en este documento.',
  'M-1804': 'No hay banderas de revisión manual en este documento.',
  'M-1805': 'Descartada',
  'M-1806': 'Opciones de la sugerencia',
  'M-1807': 'Departamento',
  'M-1808': 'Sin confirmar',
  'M-1809': 'Confirmada',
  'M-1810': 'Texto del reemplazo de la bandera',
  'M-1811': 'Sugerencia {i} de {n}: {clase}',
  'M-1812': 'Bandera {i} de {n}: {tipo}',
  'M-1813': 'Sugerencia aplicada. Quedan {n} sin decidir.',
  'M-1814': 'Sugerencia descartada. Quedan {n} sin decidir.',
  'M-1815': 'Bandera confirmada. Quedan {m} sin confirmar.',
  'M-1816': 'Elija un departamento para aplicar la sugerencia.',
  'M-1817': 'Opciones de reemplazo',
  'M-1818': 'Reemplazar con la sugerencia',
  'M-1819': 'Aplicar el reemplazo',
  'M-1820': 'Se mantuvo el texto',
  'M-1821': 'Se reemplazó el texto',
  // Banda del modelo
  'M-1825': 'Estado del modelo de apoyo',
  'M-1826': 'Esperar',
  'M-1827': 'Modelo de apoyo: terminado',
  'M-1828': 'Avance del modelo de apoyo',
  'M-1829': 'Bloque {k} de {n}',
  'M-1830': 'Modelo de apoyo: preparando el primer bloque',
  // Contador y navegación
  'M-1835': 'Contador de la revisión',
  'M-1836': 'Recorrido de la revisión',
  'M-1837': 'Dos o más pendientes se recorren en orden de lectura: detecciones pendientes y banderas sin confirmar.',
  'M-1838': 'No quedan pendientes por recorrer.',
  // Filtros
  'M-1840': 'Filtros de la lista de detecciones',
  'M-1841': 'Categoría',
  'M-1842': 'Estado',
  'M-1843': 'Confianza',
  'M-1844': 'Fuente',
  'M-1845': 'Todas',
  'M-1846': 'Todos',
  'M-1847': 'Los filtros solo cambian la lista; el contador cuenta todo.',
  'M-1848': 'Quitar filtros',
  // Búsqueda propia
  'M-1850': 'Buscar en el documento',
  'M-1851': 'Búsqueda en el documento',
  'M-1852': '{i} de {n}',
  'M-1853': 'Sin coincidencias',
  'M-1854': 'Coincidencia siguiente',
  'M-1855': 'Coincidencia anterior',
  'M-1856': 'Agregar reemplazo para esta coincidencia',
  'M-1857': 'Escriba al menos 2 caracteres.',
  'M-1858': 'Se muestran las primeras {n} coincidencias.',
  'M-1859': 'Limpiar búsqueda',
  // Continuar
  'M-1865': 'Continuar a Listo',
} as const satisfies Record<string, string>;

registrarMensajes(TEXTOS);

export type IdRevisionPestanas = keyof typeof TEXTOS;

/** Texto de la Revisión II (y de la búsqueda propia que reutiliza Reinserción). Resuelve en el catálogo único (`t()`). */
export function tp(id: IdRevisionPestanas | MessageId, params?: Readonly<Record<string, MsgParam>>): string {
  return t(id as MessageId, params);
}
