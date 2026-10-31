// Textos de la pantalla Revisión I (PC-3) que 8.5 y 8.2 no traen con id. Ids definitivos M-1701 a M-1798 (PC-7 los unificó: eran
// M-1301 a M-1398, que chocaban con los de Entrada y Procesando). Se registran en el catálogo único con `registrarMensajes()`,
// así que el barrido de textos prohibidos y la prueba de ids únicos (tests/unit/mensajes.test.ts) los ven.
// Los mensajes solo reciben valores [P] (números, marcadores, tipos, etiquetas de partes). Nunca texto del documento.
import { registrarMensajes, t, type MessageId, type MsgParam } from '../../mensajes.ts';

const TEXTOS = {
  // Estructura de la pantalla
  'M-1701': 'Documento con detecciones',
  'M-1702': 'Herramientas de la revisión',
  'M-1703': 'Ir a la lista de detecciones',
  'M-1704': 'Ficha de la detección',
  'M-1705': 'Cerrar ficha',
  'M-1706': 'Documento con los marcadores como fichas',
  'M-1707': 'Anuncios de la revisión',
  'M-1708': 'Esta vista no se puede copiar. Es solo para revisar cómo quedará la salida.',
  'M-1709': 'Parte: {parte}',
  'M-1710': 'Revisión del documento',
  // Cuadrícula (8.6.4, 8.6.5)
  'M-1711': '{tipo}, {marcador}, {menciones}, {pendientes}',
  'M-1712': '1 mención',
  'M-1713': '{n} menciones',
  'M-1714': '1 pendiente',
  'M-1715': '{n} pendientes',
  'M-1716': 'Mención {i} de {n}, {estado}, {confianza}, {parte}',
  'M-1717': '{accion} mención {i} de {tipo}',
  'M-1718': '{visible} de {tipo}',
  'M-1719': 'Entidad o mención',
  'M-1720': 'Estado',
  'M-1721': 'Contexto',
  'M-1722': 'Parte',
  'M-1723': 'Confianza',
  'M-1724': 'Fuente',
  'M-1725': 'Reemplazo',
  'M-1726': 'Acciones',
  'M-1727': 'Expandir {tipo}',
  'M-1728': 'Plegar {tipo}',
  'M-1729': 'Mención',
  // Resaltados (8.6.4)
  'M-1730': '{tipo}, {estado}, {confianza}: {texto}',
  'M-1731': '{tipo}, aceptada como {marcador}, {confianza}: {texto}',
  'M-1732': 'Bandera de revisión, {tipo}, {estado}: {texto}',
  'M-1733': 'confirmada',
  'M-1734': 'sin confirmar',
  'M-1735': 'Marcador {marcador}',
  'M-1736': 'Edición de tramo: {texto}',
  'M-1737': 'NUEVA',
  'M-1738': '{tipo}, editada como {texto}, {confianza}: {original}',
  // Ficha
  'M-1740': 'Mención seleccionada',
  'M-1741': 'Entidad',
  'M-1742': 'Motivo del rechazo (opcional)',
  'M-1743': 'Texto del reemplazo',
  'M-1744': 'Guardar reemplazo',
  'M-1745': 'Nuevo tipo de dato',
  'M-1746': 'Nuevo rol',
  'M-1747': 'Nueva clase',
  'M-1748': 'Entidad de destino',
  'M-1749': 'Unir',
  'M-1750': 'Marcador propuesto',
  'M-1751': 'Reemplazo final',
  'M-1752': 'Valor de reinserción',
  'M-1753': 'Aplicar',
  'M-1754': 'Seleccione una mención en el texto o en la lista para ver su ficha.',
  'M-1755': 'Esta mención no tiene reemplazo con marcador.',
  'M-1756': '{accion} esta mención',
  'M-1757': '{visible} de esta entidad',
  'M-1758': 'Detecciones agrupadas por entidad',
  'M-1759': 'Sin reemplazo',
  // Anuncios (sin texto del documento)
  'M-1760': '{tipo}: mención {estado}.',
  'M-1761': 'Se rechazaron {n} menciones de {tipo}. Quedan {p} pendientes.',
  'M-1762': 'Se unieron dos entidades de tipo {tipo}.',
  'M-1763': 'Se separó una mención de su entidad.',
  'M-1764': 'Se cambió el tipo de la mención a {tipo}.',
  'M-1765': 'Se cambió el rol o la clase de la entidad de tipo {tipo}.',
  'M-1766': 'Se agregó un reemplazo manual de tipo {tipo}. Aplicado a {n} menciones.',
  'M-1767': 'No hay más menciones pendientes en esa dirección.',
  'M-1768': 'Se descartó el documento y su revisión.',
  // Leyenda (8.4.5)
  'M-1770': 'Categorías de datos',
  'M-1771': 'Confianza: estilo del borde',
  'M-1772': 'Estados y marcas',
  'M-1773': 'Borde sólido',
  'M-1774': 'Borde discontinuo',
  'M-1775': 'Borde punteado',
  'M-1776': 'Pendiente: círculo vacío',
  'M-1777': 'Aceptada: visto',
  'M-1778': 'Editada: lápiz',
  'M-1779': 'Rechazada: equis y subrayado punteado',
  'M-1780': 'Con sugerencia de generalización: ≈ junto a la insignia',
  'M-1781': 'Bandera sin confirmar: signo de admiración y subrayado ondulado',
  'M-1782': 'Detección del modelo recién llegada: NUEVA',
  'M-1783': 'Personas',
  'M-1784': 'Organizaciones',
  'M-1785': 'Identificaciones',
  'M-1786': 'Expedientes',
  'M-1787': 'Contacto y lugar',
  'M-1788': 'Bienes y dinero',
  'M-1789': 'Fechas',
  'M-1790': 'Banderas de revisión manual',
  // Atajos de teclado (8.6.2)
  'M-1791': 'Atajos de teclado',
  'M-1792': 'Usar atajos de una tecla (A, R, E, U, N)',
  'M-1793': 'Con el foco en el texto o en la lista: A acepta, R rechaza, E edita (Enter confirma, Esc cancela), U restablece, Mayús+A acepta las menciones pendientes de la entidad, N y Mayús+N van a la siguiente y a la anterior pendiente. Las flechas izquierda y derecha pasan de un resaltado a otro.',
  'M-1794': 'Con un lector de pantalla en modo exploración, las letras las captura el lector: apague los atajos de una tecla si le estorban.',
  // Agregar reemplazo
  'M-1795': 'Texto que se reemplazará: se tomó de su selección ({n} caracteres).',
  'M-1796': 'Tipo de dato del reemplazo',
  'M-1797': 'Rol de la persona',
  'M-1798': 'Esta selección ya contiene o corta otra detección.',
} as const satisfies Record<string, string>;

registrarMensajes(TEXTOS);

export type IdRevisionBase = keyof typeof TEXTOS;

/** Texto de la pantalla Revisión I. Resuelve en el catálogo único (`t()`). */
export function tx(id: IdRevisionBase | MessageId, params?: Readonly<Record<string, MsgParam>>): string {
  return t(id as MessageId, params);
}
