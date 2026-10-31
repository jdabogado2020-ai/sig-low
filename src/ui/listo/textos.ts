// Textos de la pantalla Listo (PC-5) que 8.2.7, 7.13.8 y 6.8 piden sin darles id en 8.5: rango M-14xx, reservado a PC-5.
// Se registran en el catálogo único con `registrarMensajes()` (como hizo PC-2 con su rango). Los mensajes solo reciben valores [P]
// (números, marcadores, nombres de tipo, etiquetas neutras de parte, nombres de archivo neutros); nunca texto del documento.
import { registrarMensajes, type MessageId } from '../mensajes.ts';

registrarMensajes({
  'M-1401': 'Búsqueda de residuos',
  'M-1402': 'Vista previa de la salida',
  'M-1403': 'Documento anonimizado con los marcadores como fichas',
  'M-1404': 'Motivos por los que todavía no se puede copiar ni exportar',
  'M-1405': 'Copiar y exportar',
  'M-1406': 'Descargar informe (.json)',
  'M-1407': 'Incluir el código del asunto en el informe',
  'M-1408': 'Texto anonimizado',
  'M-1409': '{seccion}, línea {linea}: {tipo} {marcador}, {modo}',
  'M-1410': 'texto igual',
  'M-1411': 'escrito de otra forma',
  'M-1412': 'mismos dígitos',
  'M-1413': 'otra forma del nombre',
  'M-1414': 'Ir a la revisión',
  'M-1415': 'Valores encontrados en la salida',
  'M-1416': 'No hay un documento en revisión. Vuelva a Entrada para cargar uno.',
  'M-1417': 'No se puede generar el informe: falta confirmar la versión instalada de la aplicación. Espere a que termine la instalación para uso sin conexión.',
  'M-1418': 'Anuncios de Listo',
  'M-1419': 'Pendiente: la búsqueda empieza cuando no queden detecciones sin decidir.',
  'M-1421': 'Recordatorio antes de copiar',
  'M-1422': 'Salir de este documento',
  'M-1423': 'Informe de anonimización',
});

export const L = {
  busqueda: 'M-1401', vistaPrevia: 'M-1402', regionSalida: 'M-1403', motivos: 'M-1404', copiarYExportar: 'M-1405',
  informeJson: 'M-1406', incluirCodigo: 'M-1407', textoRespaldo: 'M-1408', hallazgo: 'M-1409',
  modoLiteral: 'M-1410', modoNormalizado: 'M-1411', modoDigitos: 'M-1412', modoVariante: 'M-1413', irARevision: 'M-1414',
  valoresEncontrados: 'M-1415', sinDocumento: 'M-1416', sinHuella: 'M-1417', anuncios: 'M-1418', esperaPendientes: 'M-1419',
  recordatorioTitulo: 'M-1421', salir: 'M-1422', informe: 'M-1423',
} as const satisfies Record<string, MessageId>;
