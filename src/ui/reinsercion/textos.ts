// Textos de la pantalla Reinserción (PC-6) que 8.2.8 pide sin darles id en 8.5: ids definitivos M-1501 a M-1537 (sin
// solapes; PC-7 los unificó). Se registran en el catálogo único con `registrarMensajes()`. Los mensajes solo reciben valores [P]:
// números, el marcador canónico, la etiqueta neutra del documento y el formato. El texto [M] (respuesta, valores reales) va en nodos de
// datos aparte, nunca en un mensaje ni en un nombre accesible (INV-G03).
import { registrarMensajes, type MessageId } from '../mensajes.ts';

registrarMensajes({
  'M-1501': 'Respuesta de la herramienta de IA',
  'M-1502': 'Documento de origen',
  'M-1503': '{etiqueta} · {formato} · {fecha}',
  'M-1504': 'Texto pegado',
  'M-1505': 'Alertas de la respuesta',
  'M-1506': 'Etiquetas exactas: {n}. Se reemplazan solas por el dato real; puede dejar alguna como está.',
  'M-1507': 'Etiquetas modificadas',
  'M-1508': 'Etiquetas que no están en la llave',
  'M-1509': 'Etiquetas del documento que no aparecen en la respuesta',
  'M-1510': 'Encontrado: {token}',
  'M-1511': 'Propuesta: {valor}',
  'M-1512': 'Se reemplazará por el dato real.',
  'M-1513': 'Se dejará como está.',
  'M-1514': 'Se reemplazará por el texto que escribió.',
  'M-1515': 'Sin decidir.',
  'M-1516': 'Texto que quedará en lugar de la etiqueta',
  'M-1517': 'Aplicar',
  'M-1518': 'Todas las apariciones de {marcador} ({n})',
  'M-1519': 'Reemplazar las {n} por el dato real',
  'M-1520': 'Dejar las {n} como están',
  'M-1521': 'Decisiones por tomar: {n}. El texto con datos reales aparece cuando no quede ninguna.',
  'M-1522': 'Falta confirmar las etiquetas que faltan antes de mostrar el texto con datos reales.',
  'M-1523': 'Texto con datos reales',
  'M-1524': 'Texto con los datos reales resaltados',
  'M-1526': 'No se pueden devolver los datos reales: no hay una llave abierta. Abra el caso con la contraseña de la llave desde el inicio.',
  'M-1527': 'Ir al inicio',
  'M-1528': 'Salir',
  'M-1530': 'Se encontraron {n} etiquetas en la respuesta.',
  'M-1533': 'Salir de Devolver los datos reales',
  'M-1534': 'Texto con datos reales para copiar con Ctrl + C',
  'M-1535': 'Avisos de Devolver los datos reales',
  'M-1536': 'Dato real',
  'M-1537': 'Revisé las etiquetas que faltan.',
});

export const R = {
  respuesta: 'M-1501', origen: 'M-1502', opcionDocumento: 'M-1503', textoPegado: 'M-1504', alertas: 'M-1505', exactos: 'M-1506',
  modificados: 'M-1507', desconocidos: 'M-1508', faltantes: 'M-1509', encontrado: 'M-1510', propuesta: 'M-1511',
  seReemplaza: 'M-1512', seDeja: 'M-1513', seEdita: 'M-1514', sinDecidir: 'M-1515', textoEditado: 'M-1516', aplicar: 'M-1517',
  grupo: 'M-1518', reemplazarGrupo: 'M-1519', dejarGrupo: 'M-1520', faltanDecisiones: 'M-1521', faltaReconocer: 'M-1522',
  resultado: 'M-1523', regionResultado: 'M-1524', noDisponible: 'M-1526', irAInicio: 'M-1527', salir: 'M-1528',
  encontrados: 'M-1530', tituloSalir: 'M-1533', respaldo: 'M-1534', avisos: 'M-1535', datoReal: 'M-1536', revisadoFaltantes: 'M-1537',
} as const satisfies Record<string, MessageId>;
