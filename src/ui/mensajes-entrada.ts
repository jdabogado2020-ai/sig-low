// Textos de Entrada y Procesando (PC-2) que 8.5 no numera: etiquetas de campos, unidades y plantillas de accesibilidad.
// Ids M-1301 a M-1325 (PC-2). Se registran en el catálogo único para que el barrido de textos prohibidos (PC-7) los vea.
import { registrarMensajes, type MessageId } from './mensajes.ts';

registrarMensajes({
  'M-1301': 'Texto del documento',
  'M-1302': '{n} caracteres',
  'M-1303': 'Suelte aquí un archivo .docx, .pdf o .txt, o use el botón.',
  'M-1304': 'Partes del documento',
  'M-1305': '{etiqueta} · {n} caracteres',
  'M-1306': 'La revisión del detector de nombres adicional tarda unos minutos; puede ir revisando mientras llega.',
  'M-1307': 'Pegue texto o cargue un archivo con texto para poder anonimizar.',
  'M-1308': 'Forma de cargar el documento',
  'M-1309': 'Zona para soltar un archivo',
  'M-1310': 'Etapas del análisis',
  'M-1311': '{etapa}: {unidad} {hecho} de {total}',
  'M-1312': 'parte',
  'M-1313': 'página',
  'M-1314': 'bloque',
  'M-1315': 'KB',
  'M-1316': 'páginas',
  'M-1318': '{n} segundos',
  'M-1319': '{n} minutos',
  'M-1320': '{m} min {s} s',
  'M-1321': 'Lectura cancelada.',
  'M-1322': 'Aviso sobre el archivo original',
  'M-1323': 'Avisos de la lectura',
  'M-1324': 'Estado de cada etapa',
  // CONTENIDO_PDF_NO_LEIDO (contrato del integrador, 30-oct): 8.5.3 aún no le asigna mensaje.
  'M-1325': 'El PDF tiene adjuntos, vínculos o índices ({n}) cuyo contenido Sig-Low no lee. Revíselos en el original.',
});

export const E = {
  textoDelDocumento: 'M-1301', caracteres: 'M-1302', zonaSoltar: 'M-1303', partesEncontradas: 'M-1304', parteConTamano: 'M-1305',
  ayudaModelo: 'M-1306', ayudaAnalizar: 'M-1307', formaDeEntrada: 'M-1308', zonaParaSoltar: 'M-1309', etapasDelAnalisis: 'M-1310',
  valorEtapa: 'M-1311', unidadParte: 'M-1312', unidadPagina: 'M-1313', unidadBloque: 'M-1314', unidadKb: 'M-1315',
  unidadPaginas: 'M-1316', segundos: 'M-1318', minutos: 'M-1319', minutosYSegundos: 'M-1320', lecturaCancelada: 'M-1321',
  avisoOriginal: 'M-1322', avisosDeLectura: 'M-1323', estadoDeCadaEtapa: 'M-1324',
} as const satisfies Record<string, MessageId>;
