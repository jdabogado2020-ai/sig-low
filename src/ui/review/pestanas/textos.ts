// Textos de la Revisión II (PC-4) que 8.2 y 8.5 no traen con id: rango M-14xx, reservado a PC-4. Viven aquí (como los de
// PC-3 en review/base/textos.ts) para no tocar mensajes.ts; `todasLasCadenasRevisionPestanas()` los entrega al barrido de
// textos prohibidos de PC-7 (8.5). Los mensajes solo reciben valores [P]: números, tipos y etiquetas. Nunca texto del documento.
import { t, type MessageId, type MsgParam } from '../../mensajes.ts';

const TEXTOS = {
  // Pestañas y listas
  'M-1401': 'Revisión asistida del panel lateral',
  'M-1402': 'Sin decidir: {n}',
  'M-1403': 'No hay sugerencias de generalización en este documento.',
  'M-1404': 'No hay banderas de revisión manual en este documento.',
  'M-1405': 'Descartada',
  'M-1406': 'Opciones de la sugerencia',
  'M-1407': 'Departamento',
  'M-1408': 'Sin confirmar',
  'M-1409': 'Confirmada',
  'M-1410': 'Texto del reemplazo de la bandera',
  'M-1411': 'Sugerencia {i} de {n}: {clase}',
  'M-1412': 'Bandera {i} de {n}: {tipo}',
  'M-1413': 'Sugerencia aplicada. Quedan {n} sin decidir.',
  'M-1414': 'Sugerencia descartada. Quedan {n} sin decidir.',
  'M-1415': 'Bandera confirmada. Quedan {m} sin confirmar.',
  'M-1416': 'Elija un departamento para aplicar la sugerencia.',
  'M-1417': 'Opciones de reemplazo',
  'M-1418': 'Reemplazar con la sugerencia',
  'M-1419': 'Aplicar el reemplazo',
  'M-1420': 'Se mantuvo el texto',
  'M-1421': 'Se reemplazó el texto',
  // Banda del modelo
  'M-1425': 'Estado del modelo de apoyo',
  'M-1426': 'Esperar',
  'M-1427': 'Modelo de apoyo: terminado',
  'M-1428': 'Avance del modelo de apoyo',
  'M-1429': 'Bloque {k} de {n}',
  'M-1430': 'Modelo de apoyo: preparando el primer bloque',
  // Contador y navegación
  'M-1435': 'Contador de la revisión',
  'M-1436': 'Recorrido de la revisión',
  'M-1437': 'Dos o más pendientes se recorren en orden de lectura: detecciones pendientes y banderas sin confirmar.',
  'M-1438': 'No quedan pendientes por recorrer.',
  // Filtros
  'M-1440': 'Filtros de la lista de detecciones',
  'M-1441': 'Categoría',
  'M-1442': 'Estado',
  'M-1443': 'Confianza',
  'M-1444': 'Fuente',
  'M-1445': 'Todas',
  'M-1446': 'Todos',
  'M-1447': 'Los filtros solo cambian la lista; el contador cuenta todo.',
  'M-1448': 'Quitar filtros',
  // Búsqueda propia
  'M-1450': 'Buscar en el documento',
  'M-1451': 'Búsqueda en el documento',
  'M-1452': '{i} de {n}',
  'M-1453': 'Sin coincidencias',
  'M-1454': 'Coincidencia siguiente',
  'M-1455': 'Coincidencia anterior',
  'M-1456': 'Agregar reemplazo para esta coincidencia',
  'M-1457': 'Escriba al menos 2 caracteres.',
  'M-1458': 'Se muestran las primeras {n} coincidencias.',
  'M-1459': 'Limpiar búsqueda',
  // Continuar
  'M-1465': 'Continuar a Listo',
} as const satisfies Record<string, string>;

export type IdRevisionPestanas = keyof typeof TEXTOS;

function sustituir(plantilla: string, params?: Readonly<Record<string, MsgParam>>): string {
  if (!params) return plantilla;
  return plantilla.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = params[k];
    return v === undefined ? m : String(v);
  });
}

/** Texto de la Revisión II; si el id es del catálogo general (M-1 a M-1211), lo resuelve `t()`. */
export function tp(id: IdRevisionPestanas | MessageId, params?: Readonly<Record<string, MsgParam>>): string {
  const propio = (TEXTOS as Readonly<Record<string, string>>)[id];
  return propio === undefined ? t(id as MessageId, params) : sustituir(propio, params);
}

/** Para el barrido de textos prohibidos (PC-7, 8.5). */
export function todasLasCadenasRevisionPestanas(): string[] {
  return Object.values(TEXTOS);
}
