// Textos de la pantalla Revisión I (PC-3) que 8.5 y 8.2 no traen con id: rango M-13xx, reservado a PC-3.
// Viven aquí y no en mensajes.ts para no tocar el archivo de PC-1; el integrador puede fusionarlos con `EXTRA` de mensajes.ts
// y, mientras no lo haga, `todasLasCadenasRevisionBase()` los entrega al barrido de textos prohibidos de PC-7 (8.5).
// Los mensajes solo reciben valores [P] (números, marcadores, tipos, etiquetas de partes). Nunca texto del documento.
import { t, type MessageId, type MsgParam } from '../../mensajes.ts';

const TEXTOS = {
  // Estructura de la pantalla
  'M-1301': 'Documento con detecciones',
  'M-1302': 'Herramientas de la revisión',
  'M-1303': 'Ir a la lista de detecciones',
  'M-1304': 'Ficha de la detección',
  'M-1305': 'Cerrar ficha',
  'M-1306': 'Documento con los marcadores como fichas',
  'M-1307': 'Anuncios de la revisión',
  'M-1308': 'Esta vista no se puede copiar. Es solo para revisar cómo quedará la salida.',
  'M-1309': 'Parte: {parte}',
  'M-1310': 'Revisión del documento',
  // Cuadrícula (8.6.4, 8.6.5)
  'M-1311': '{tipo}, {marcador}, {menciones}, {pendientes}',
  'M-1312': '1 mención',
  'M-1313': '{n} menciones',
  'M-1314': '1 pendiente',
  'M-1315': '{n} pendientes',
  'M-1316': 'Mención {i} de {n}, {estado}, {confianza}, {parte}',
  'M-1317': '{accion} mención {i} de {tipo}',
  'M-1318': '{visible} de {tipo}',
  'M-1319': 'Entidad o mención',
  'M-1320': 'Estado',
  'M-1321': 'Contexto',
  'M-1322': 'Parte',
  'M-1323': 'Confianza',
  'M-1324': 'Fuente',
  'M-1325': 'Reemplazo',
  'M-1326': 'Acciones',
  'M-1327': 'Expandir {tipo}',
  'M-1328': 'Plegar {tipo}',
  'M-1329': 'Mención',
  // Resaltados (8.6.4)
  'M-1330': '{tipo}, {estado}, {confianza}: {texto}',
  'M-1331': '{tipo}, aceptada como {marcador}, {confianza}: {texto}',
  'M-1332': 'Bandera de revisión, {tipo}, {estado}: {texto}',
  'M-1333': 'confirmada',
  'M-1334': 'sin confirmar',
  'M-1335': 'Marcador {marcador}',
  'M-1336': 'Edición de tramo: {texto}',
  'M-1337': 'NUEVA',
  'M-1338': '{tipo}, editada como {texto}, {confianza}: {original}',
  // Ficha
  'M-1340': 'Mención seleccionada',
  'M-1341': 'Entidad',
  'M-1342': 'Motivo del rechazo (opcional)',
  'M-1343': 'Texto del reemplazo',
  'M-1344': 'Guardar reemplazo',
  'M-1345': 'Nuevo tipo de dato',
  'M-1346': 'Nuevo rol',
  'M-1347': 'Nueva clase',
  'M-1348': 'Entidad de destino',
  'M-1349': 'Unir',
  'M-1350': 'Marcador propuesto',
  'M-1351': 'Reemplazo final',
  'M-1352': 'Valor de reinserción',
  'M-1353': 'Aplicar',
  'M-1354': 'Seleccione una mención en el texto o en la lista para ver su ficha.',
  'M-1355': 'Esta mención no tiene reemplazo con marcador.',
  'M-1356': '{accion} esta mención',
  'M-1357': '{visible} de esta entidad',
  'M-1358': 'Detecciones agrupadas por entidad',
  'M-1359': 'Sin reemplazo',
  // Anuncios (sin texto del documento)
  'M-1360': '{tipo}: mención {estado}.',
  'M-1361': 'Se rechazaron {n} menciones de {tipo}. Quedan {p} pendientes.',
  'M-1362': 'Se unieron dos entidades de tipo {tipo}.',
  'M-1363': 'Se separó una mención de su entidad.',
  'M-1364': 'Se cambió el tipo de la mención a {tipo}.',
  'M-1365': 'Se cambió el rol o la clase de la entidad de tipo {tipo}.',
  'M-1366': 'Se agregó un reemplazo manual de tipo {tipo}. Aplicado a {n} menciones.',
  'M-1367': 'No hay más menciones pendientes en esa dirección.',
  'M-1368': 'Se descartó el documento y su revisión.',
  // Leyenda (8.4.5)
  'M-1370': 'Categorías de datos',
  'M-1371': 'Confianza: estilo del borde',
  'M-1372': 'Estados y marcas',
  'M-1373': 'Borde sólido',
  'M-1374': 'Borde discontinuo',
  'M-1375': 'Borde punteado',
  'M-1376': 'Pendiente: círculo vacío',
  'M-1377': 'Aceptada: visto',
  'M-1378': 'Editada: lápiz',
  'M-1379': 'Rechazada: equis y subrayado punteado',
  'M-1380': 'Con sugerencia de generalización: ≈ junto a la insignia',
  'M-1381': 'Bandera sin confirmar: signo de admiración y subrayado ondulado',
  'M-1382': 'Detección del modelo recién llegada: NUEVA',
  'M-1383': 'Personas',
  'M-1384': 'Organizaciones',
  'M-1385': 'Identificaciones',
  'M-1386': 'Expedientes',
  'M-1387': 'Contacto y lugar',
  'M-1388': 'Bienes y dinero',
  'M-1389': 'Fechas',
  'M-1390': 'Banderas de revisión manual',
  // Atajos de teclado (8.6.2)
  'M-1391': 'Atajos de teclado',
  'M-1392': 'Usar atajos de una tecla (A, R, E, U, N)',
  'M-1393': 'Con el foco en el texto o en la lista: A acepta, R rechaza, E edita (Enter confirma, Esc cancela), U restablece, Mayús+A acepta las menciones pendientes de la entidad, N y Mayús+N van a la siguiente y a la anterior pendiente. Las flechas izquierda y derecha pasan de un resaltado a otro.',
  'M-1394': 'Con un lector de pantalla en modo exploración, las letras las captura el lector: apague los atajos de una tecla si le estorban.',
  // Agregar reemplazo
  'M-1395': 'Texto que se reemplazará: se tomó de su selección ({n} caracteres).',
  'M-1396': 'Tipo de dato del reemplazo',
  'M-1397': 'Rol de la persona',
  'M-1398': 'Esta selección ya contiene o corta otra detección.',
} as const satisfies Record<string, string>;

export type IdRevisionBase = keyof typeof TEXTOS;

function sustituir(plantilla: string, params?: Readonly<Record<string, MsgParam>>): string {
  if (!params) return plantilla;
  return plantilla.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = params[k];
    return v === undefined ? m : String(v);
  });
}

/** Texto de la pantalla Revisión I; si el id es del catálogo general (M-1 a M-1211), lo resuelve `t()`. */
export function tx(id: IdRevisionBase | MessageId, params?: Readonly<Record<string, MsgParam>>): string {
  const propio = (TEXTOS as Readonly<Record<string, string>>)[id];
  return propio === undefined ? t(id as MessageId, params) : sustituir(propio, params);
}

/** Para el barrido de textos prohibidos (PC-7, 8.5). */
export function todasLasCadenasRevisionBase(): string[] {
  return Object.values(TEXTOS);
}
