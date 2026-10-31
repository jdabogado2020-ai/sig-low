// Textos de la pantalla Bóveda (PC-6) que 8.2.9 pide sin darles id en 8.5: rango PROVISIONAL M-15xx (M-1551 a M-1579), pendiente de id
// oficial (PC-7 los unifica). Se registran en el catálogo único con `registrarMensajes()`. Los mensajes solo reciben valores [P]: el código
// del asunto, fechas, nombres de archivo neutros y números; nunca el contenido de una tabla (INV-V01).
import { registrarMensajes, type MessageId } from '../mensajes.ts';

registrarMensajes({
  'M-1551': 'Asuntos guardados en este navegador',
  'M-1552': 'Código',
  'M-1553': 'Creado: {fecha}',
  'M-1554': 'Actualizado: {fecha}',
  'M-1555': 'Acciones del asunto {codigo}',
  'M-1556': 'Persistencia del almacenamiento',
  'M-1557': 'Exportar {codigo}',
  'M-1558': 'Frase de paso actual',
  'M-1559': 'Cambiar la frase de paso de {codigo}',
  'M-1560': 'La frase de paso cambió. Sig-Low no puede recuperarla: no la olvide.',
  'M-1561': 'Se importó el asunto {codigo}.',
  'M-1562': 'Elegir archivo .siglow',
  'M-1563': 'Archivo elegido.',
  'M-1564': 'Frase de paso del archivo',
  'M-1565': 'Nuevo código del asunto',
  'M-1566': 'Esta pantalla muestra solo el código de cada asunto y sus fechas: el contenido de las tablas no se muestra en ningún momento.',
  'M-1567': 'Escriba BORRAR para confirmar',
  'M-1568': 'Lista de asuntos guardados',
  'M-1569': 'Importar una tabla',
  'M-1570': 'Otras acciones',
  'M-1571': 'Borrar todos los asuntos',
  'M-1573': '{accion} {codigo}',
  'M-1574': 'Importar',
});

export const B = {
  asuntosGuardados: 'M-1551', codigo: 'M-1552', creado: 'M-1553', actualizado: 'M-1554', accionesDe: 'M-1555', persistencia: 'M-1556',
  exportarDe: 'M-1557', fraseActual: 'M-1558', cambiarDe: 'M-1559', fraseCambiada: 'M-1560', importado: 'M-1561', elegirArchivo: 'M-1562',
  archivoElegido: 'M-1563', fraseDelArchivo: 'M-1564', nuevoCodigo: 'M-1565', soloCodigo: 'M-1566', escribaBorrar: 'M-1567',
  listaDeAsuntos: 'M-1568', importarUna: 'M-1569', otrasAcciones: 'M-1570', borrarTodos: 'M-1571', accionDe: 'M-1573', importar: 'M-1574',
} as const satisfies Record<string, MessageId>;
