// Textos de F2 y F3 (v1.1, D-23 y D-24): flujo «Cargar y listo», vista previa editable y descarga con una sola confirmación. Rango
// propio M-21xx, registrado en el catálogo único (el barrido de textos prohibidos lo ve). Lenguaje de abogado, con el glosario de la
// v1.1: etiqueta, dato encontrado, dato que se escapó, dato indirecto para revisar, llave para devolver los datos reales.
import { registrarMensajes, t, type MessageId, type MsgParam } from '../mensajes.ts';

const TEXTOS = {
  // Barra de pasos e Inicio = Cargar
  'M-2101': 'Cargar',
  'M-2102': 'Vista previa',
  'M-2103': 'Descargar',
  'M-2104': 'Paso {n}: {nombre}',
  'M-2105': 'Cómo funciona',
  'M-2106': 'Cargue el documento o pegue el texto. Todo se procesa en su equipo.',
  'M-2107': 'Revise la vista previa: Sig-Low ya ocultó los datos que encontró. Pulse una etiqueta para corregirla o seleccione un texto para ocultarlo.',
  'M-2108': 'Confirme y descargue el documento anonimizado en .docx o PDF.',
  'M-2109': 'Cerrar la guía',
  'M-2110': 'Use una ventana normal del navegador, sin extensiones ni sesión iniciada.',
  'M-2111': 'No comparta ni grabe la pantalla mientras tenga un documento abierto.',
  'M-2112': 'No traduzca la página ni use los asistentes de IA del navegador.',
  'M-2113': 'Más información',
  'M-2114': 'Menos información',
  'M-2115': 'Sig-Low oculta los datos personales de su documento antes de que lo comparta.',
  'M-2116': 'Opciones avanzadas',
  'M-2117': 'Escriba los nombres de las partes del caso para que Sig-Low los oculte siempre, también cuando aparecen abreviados o sin tildes.',
  'M-2118': 'Editar los nombres ({n} en la lista)',
  'M-2119': 'Opcional. Encuentra más nombres de personas, empresas y lugares. Se descarga una sola vez (unos {mb} MB) y funciona en su equipo. Sin él, Sig-Low usa sus reglas y su lista de nombres.',
  'M-2120': 'Guardar la llave para devolver los datos reales después',
  'M-2121': 'Sirve para quien pega el documento anonimizado en una herramienta de IA y después quiere devolver los datos reales a la respuesta. La llave se protege con una contraseña que solo usted conoce.',
  'M-2122': 'Casos guardados en este equipo',
  'M-2123': 'Ayuda: {tema}',
  'M-2124': 'Caso abierto: {codigo}. Ahora cargue el documento.',
  'M-2125': 'Elegir qué partes del documento se anonimizan',

  // Vista previa
  'M-2130': 'Así quedará su documento. Sig-Low ya ocultó los datos que encontró: pulse una etiqueta para corregirla o seleccione un texto para ocultarlo.',
  'M-2131': 'Puntos para revisar: {n}',
  'M-2132': 'Siguiente',
  'M-2133': 'No hay puntos para revisar. Igual lea la vista previa completa antes de descargar.',
  'M-2134': 'Punto {i} de {n}: {motivo}',
  'M-2135': 'dato encontrado con poca certeza',
  'M-2136': 'puede ser de más de una persona; se ocultó como persona aparte',
  'M-2137': 'dato indirecto para revisar ({tipo})',
  'M-2138': 'dato que se escapó; ahora está oculto',
  'M-2139': 'Las etiquetas entre corchetes, como [DEMANDANTE_1], reemplazan un dato. El mismo número es la misma persona en todo el documento.',
  'M-2140': 'El color de cada etiqueta indica el tipo de dato, y su nombre lo dice en palabras.',
  'M-2141': 'Un texto subrayado con puntos es un dato que usted decidió dejar a la vista. Púlselo para volver a ocultarlo.',
  'M-2142': 'Un texto con fondo de aviso es un dato indirecto para revisar, como un cargo, un diagnóstico o una mención de un menor de edad.',
  'M-2143': 'Con el teclado: Tab lleva de una etiqueta a la siguiente; Intro abre sus opciones y Escape las cierra.',
  'M-2144': 'Las páginas de un PDF se muestran como quedarán: con recuadros negros sobre los datos.',

  // Menú de la etiqueta y selección
  'M-2150': 'Opciones de la etiqueta {etiqueta}',
  'M-2151': 'Mostrar el dato original aquí',
  'M-2152': 'Mostrar en todo el documento',
  'M-2153': 'Es otra persona',
  'M-2154': 'Es la misma que…',
  'M-2155': 'Cambiar a…',
  'M-2156': 'Editar el texto de la etiqueta',
  'M-2157': 'Volver a ocultar',
  'M-2158': 'Elija la persona u organización',
  'M-2159': 'Elija el tipo de dato',
  'M-2160': 'Texto que reemplaza el dato',
  'M-2161': 'Aplicar',
  'M-2162': 'Es una cita: dejar el número a la vista',
  'M-2163': 'Es del caso: dejarlo oculto',
  'M-2164': 'Ocultar con «{texto}»',
  'M-2165': 'Dejar como está',
  'M-2166': 'Ocultar este texto',
  'M-2167': 'Ocultar todas las apariciones',
  'M-2168': 'Vista previa del documento anonimizado',
  'M-2169': 'Etiqueta {etiqueta}, {tipo}. Pulse para ver las opciones.',
  'M-2170': 'Dato a la vista ({tipo}). Pulse para volver a ocultarlo.',
  'M-2171': 'Dato indirecto para revisar ({tipo}). Pulse para decidir.',
  'M-2172': 'Texto reemplazado. Pulse para ver las opciones.',
  'M-2173': 'Opciones del texto seleccionado',
  'M-2174': 'No hay otra persona u organización de ese tipo en el documento.',

  // PDF en la vista previa
  'M-2175': 'Página {n} de {total}',
  'M-2176': 'Ver como páginas',
  'M-2177': 'Ver como texto',
  'M-2178': 'Preparando las páginas: {hecho} de {total}.',
  'M-2179': 'Para ocultar un texto que no se ocultó, pase a «Ver como texto» y selecciónelo.',

  // Botones de la vista previa
  'M-2180': 'Continuar a descargar',
  'M-2181': 'Revisar dato por dato',

  // Descargar
  'M-2185': 'Revisé la vista previa. Entiendo que respondo por el documento que comparto.',
  'M-2186': 'Descargar PDF',
  'M-2187': 'Más formatos',
  'M-2188': 'Antes de descargar',
  'M-2189': 'Preparando el PDF en su equipo…',
  'M-2190': 'Sig-Low no puede encontrar datos en imágenes, fotos o firmas escaneadas. Si el documento las tiene, revíselas antes de compartirlo.',
  'M-2191': 'Todavía no se puede descargar:',
  'M-2192': 'Se descargó {archivo}. Conserva el formato del original, con los datos ocultos; no lleva autor, comentarios ni control de cambios.',
  'M-2193': 'Se descargó {archivo}. Cada página es una imagen con recuadros negros sobre los datos, sin texto que se pueda copiar.',
} as const satisfies Record<string, string>;

registrarMensajes(TEXTOS);

export type IdFlujo = keyof typeof TEXTOS;
/** Texto de este módulo con sus parámetros [P]. */
export const tf = (id: IdFlujo, params?: Readonly<Record<string, MsgParam>>): string => t(id as MessageId, params);
