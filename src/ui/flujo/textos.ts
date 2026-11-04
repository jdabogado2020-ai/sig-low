// Textos de F2 y F3 (v1.1, D-23 y D-24): flujo «Cargar y listo», vista previa editable y descarga con una sola confirmación. Rango
// propio M-22xx, registrado en el catálogo único (el barrido de textos prohibidos lo ve). Lenguaje de abogado, con el glosario de la
// v1.1: etiqueta, dato encontrado, dato que se escapó, dato indirecto para revisar, llave para devolver los datos reales.
import { registrarMensajes, t, type MessageId, type MsgParam } from '../mensajes.ts';

const TEXTOS = {
  // Barra de pasos e Inicio = Cargar
  'M-2201': 'Cargar',
  'M-2202': 'Vista previa',
  'M-2203': 'Descargar',
  'M-2204': 'Paso {n}: {nombre}',
  'M-2205': 'Cómo funciona',
  'M-2206': 'Cargue el documento o pegue el texto. Todo se procesa en su equipo.',
  'M-2207': 'Revise la vista previa: Sig-Low ya ocultó los datos que encontró. Pulse una etiqueta para corregirla o seleccione un texto para ocultarlo.',
  'M-2208': 'Confirme y descargue el documento anonimizado en .docx o PDF.',
  'M-2209': 'Cerrar la guía',
  'M-2210': 'Use una ventana normal del navegador, sin extensiones ni sesión iniciada.',
  'M-2211': 'No comparta ni grabe la pantalla mientras tenga un documento abierto.',
  'M-2212': 'No traduzca la página ni use los asistentes de IA del navegador.',
  'M-2213': 'Más información',
  'M-2214': 'Menos información',
  'M-2215': 'Sig-Low oculta los datos personales de su documento antes de que lo comparta.',
  'M-2216': 'Opciones avanzadas',
  'M-2217': 'Escriba los nombres de las partes del caso para que Sig-Low los oculte siempre, también cuando aparecen abreviados o sin tildes.',
  'M-2218': 'Editar los nombres ({n} en la lista)',
  'M-2219': 'Opcional. Encuentra más nombres de personas, empresas y lugares. Se descarga una sola vez (unos {mb} MB) y funciona en su equipo. Sin él, Sig-Low usa sus reglas y su lista de nombres.',
  'M-2220': 'Guardar la llave para devolver los datos reales después',
  'M-2221': 'Sirve para quien pega el documento anonimizado en una herramienta de IA y después quiere devolver los datos reales a la respuesta. La llave se protege con una contraseña que solo usted conoce.',
  'M-2222': 'Casos guardados en este equipo',
  'M-2223': 'Ayuda: {tema}',
  'M-2224': 'Caso abierto: {codigo}. Ahora cargue el documento.',
  'M-2225': 'Elegir qué partes del documento se anonimizan',

  // Vista previa
  'M-2230': 'Así quedará su documento. Sig-Low ya ocultó los datos que encontró: pulse una etiqueta para corregirla o seleccione un texto para ocultarlo.',
  'M-2231': 'Puntos para revisar: {n}',
  'M-2232': 'Siguiente',
  'M-2233': 'No hay puntos para revisar. Igual lea la vista previa completa antes de descargar.',
  'M-2234': 'Punto {i} de {n}: {motivo}',
  'M-2235': 'dato encontrado con poca certeza',
  'M-2236': 'puede ser de más de una persona; se ocultó como persona aparte',
  'M-2237': 'dato indirecto para revisar ({tipo})',
  'M-2238': 'dato que se escapó; ahora está oculto',
  'M-2239': 'Las etiquetas entre corchetes, como [DEMANDANTE_1], reemplazan un dato. El mismo número es la misma persona en todo el documento.',
  'M-2240': 'El color de cada etiqueta indica el tipo de dato, y su nombre lo dice en palabras.',
  'M-2241': 'Un texto subrayado con puntos es un dato que usted decidió dejar a la vista. Púlselo para volver a ocultarlo.',
  'M-2242': 'Un texto con fondo de aviso es un dato indirecto para revisar, como un cargo, un diagnóstico o una mención de un menor de edad.',
  'M-2243': 'Con el teclado: Tab lleva de una etiqueta a la siguiente; Intro abre sus opciones y Escape las cierra.',
  'M-2244': 'Las páginas de un PDF se muestran como quedarán: con recuadros negros sobre los datos.',

  // Menú de la etiqueta y selección
  'M-2250': 'Opciones de la etiqueta {etiqueta}',
  'M-2251': 'Mostrar el dato original aquí',
  'M-2252': 'Mostrar en todo el documento',
  'M-2253': 'Es otra persona',
  'M-2254': 'Es la misma que…',
  'M-2255': 'Cambiar a…',
  'M-2256': 'Editar el texto de la etiqueta',
  'M-2257': 'Volver a ocultar',
  'M-2258': 'Elija la persona u organización',
  'M-2259': 'Elija el tipo de dato',
  'M-2260': 'Texto que reemplaza el dato',
  'M-2261': 'Aplicar',
  'M-2262': 'Es una cita: dejar el número a la vista',
  'M-2263': 'Es del caso: dejarlo oculto',
  'M-2264': 'Ocultar con «{texto}»',
  'M-2265': 'Dejar como está',
  'M-2266': 'Ocultar este texto',
  'M-2267': 'Ocultar todas las apariciones',
  'M-2268': 'Vista previa del documento anonimizado',
  'M-2269': 'Etiqueta {etiqueta}, {tipo}. Pulse para ver las opciones.',
  'M-2270': 'Dato a la vista ({tipo}). Pulse para volver a ocultarlo.',
  'M-2271': 'Dato indirecto para revisar ({tipo}). Pulse para decidir.',
  'M-2272': 'Texto reemplazado. Pulse para ver las opciones.',
  'M-2273': 'Opciones del texto seleccionado',
  'M-2274': 'No hay otra persona u organización de ese tipo en el documento.',

  // PDF en la vista previa
  'M-2275': 'Página {n} de {total}',
  'M-2276': 'Ver como páginas',
  'M-2277': 'Ver como texto',
  'M-2278': 'Preparando las páginas: {hecho} de {total}.',
  'M-2279': 'Para ocultar un texto que no se ocultó, pase a «Ver como texto» y selecciónelo.',

  // Botones de la vista previa
  'M-2280': 'Continuar a descargar',
  'M-2281': 'Revisar dato por dato',

  // Descargar
  'M-2285': 'Revisé la vista previa. Entiendo que respondo por el documento que comparto.',
  'M-2286': 'Descargar PDF',
  'M-2287': 'Más formatos',
  'M-2288': 'Antes de descargar',
  'M-2289': 'Preparando el PDF en su equipo…',
  'M-2290': 'Sig-Low no puede encontrar datos en imágenes, fotos o firmas escaneadas. Si el documento las tiene, revíselas antes de compartirlo.',
  'M-2291': 'Todavía no se puede descargar:',
  'M-2292': 'Se descargó {archivo}. Conserva el formato del original, con los datos ocultos; no lleva autor, comentarios ni control de cambios.',
  'M-2293': 'Se descargó {archivo}. Cada página es una imagen con recuadros negros sobre los datos, sin texto que se pueda copiar.',
} as const satisfies Record<string, string>;

registrarMensajes(TEXTOS);

export type IdFlujo = keyof typeof TEXTOS;
/** Texto de este módulo con sus parámetros [P]. */
export const tf = (id: IdFlujo, params?: Readonly<Record<string, MsgParam>>): string => t(id as MessageId, params);
