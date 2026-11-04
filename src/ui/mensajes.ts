// Catálogo único de textos visibles (8, «Catálogo único»; 8.5). Los textos exactos del plan están en
// mensajes-catalogo.ts (generado). Aquí viven t(), los tipos del contrato y los textos que PC-1 asigna
// por no tener id en 8.5 (rango M-11xx). Sin promesas ni nombres de proveedores de IA (8.5).
import { ALIAS, ALTERNOS, CATALOGO, CAUSA_PLAN_B, ETIQUETA_ID, ROTULOS } from './mensajes-catalogo.ts';

export type MessageId = `M-${number}`;
/** string solo para valores [P]: números, marcadores, etiquetas neutras, fechas, tamaños, código del asunto, versión y hashes. */
export type MsgParam = number | string;
export { CAUSA_PLAN_B, ETIQUETA_ID, ROTULOS };

/** Textos de PC-1 sin id en 8.5 (nombres de pantalla, campos y avisos de las pantallas de PC-1). */
const EXTRA = {
  // Pantallas (8.1) y armazón (8.2.1)
  'M-1101': 'Cargar documento',
  'M-1102': 'Nombres que siempre deben ocultarse',
  'M-1103': 'Elegir partes del documento',
  'M-1104': 'Analizando',
  'M-1105': 'Vista previa',
  'M-1106': 'Descargar',
  'M-1107': 'Devolver los datos reales',
  'M-1108': 'Preparando Sig-Low',
  'M-1109': 'Ir al contenido',
  'M-1110': 'Pasos',
  'M-1111': 'Estado de Sig-Low',
  'M-1112': 'Avisos de Sig-Low',
  'M-1113': 'Opciones del caso',
  'M-1114': 'Cerrar',
  'M-1115': 'Recargar',
  'M-1116': 'Ocultar',
  'M-1117': 'Caso {codigo}',
  // Inicio (8.2.2)
  'M-1120': 'Crear un caso',
  'M-1121': 'Código del caso',
  'M-1122': 'Cómo guardar la llave',
  'M-1123': '{n} de 15 caracteres',
  'M-1124': 'Abrir un caso guardado',
  'M-1125': 'Caso guardado',
  'M-1126': 'Contraseña de la llave del caso',
  'M-1127': 'Actualizado: {fecha}',
  'M-1128': 'Detector de nombres adicional',
  'M-1129': 'Elija un caso para abrirlo.',
  // Frases de paso rechazadas (6.7.3, PassphraseIssue distinto de CORTA, que usa M-17)
  'M-1131': 'La contraseña repite demasiado los mismos caracteres. Use más palabras distintas.',
  'M-1132': 'La contraseña no puede ser solo números.',
  'M-1133': 'La contraseña sigue una secuencia de letras o de teclas. Use otra.',
  'M-1134': 'La contraseña no puede contener el código del caso.',
  'M-1135': 'Esa contraseña es muy común. Use otra.',
  // Lista del caso (8.2.3)
  'M-1140': 'Personas y organizaciones del caso',
  'M-1141': 'Agregar a los nombres que siempre deben ocultarse',
  'M-1142': 'Nombre',
  'M-1143': 'Tipo',
  'M-1144': 'Rol',
  'M-1145': 'Clase',
  'M-1146': 'Rol o clase',
  'M-1147': 'Variantes activas',
  'M-1148': 'Acciones',
  'M-1150': 'Variantes del nombre',
  'M-1151': 'Texto de la variante',
  'M-1152': 'Guardar cambios',
  'M-1153': 'Escriba el nombre.',
  'M-1157': 'Se agregaron {n} nombres.',
  'M-1161': 'Cancelar edición',
  // Diálogos y avisos del armazón
  'M-1171': 'Contraseña de la llave para el archivo',
  'M-1172': 'Guardar una copia de la llave en un archivo',
  'M-1173': 'Cuenta regresiva de inactividad',
  'M-1176': 'Antes de actualizar, guarde la llave en este equipo o en un archivo.',
  // Clases de variante de la lista del caso (6.5.1)
  'M-1190': 'Nombre completo',
  'M-1191': 'Sin tildes',
  'M-1192': 'En mayúsculas',
  'M-1193': 'Apellidos',
  'M-1194': 'Apellido solo',
  'M-1195': 'Nombre de pila solo',
  'M-1196': 'Iniciales',
  'M-1197': 'Con posesivo',
  'M-1198': 'Razón social sin sufijo',
  'M-1199': 'Sigla',
  'M-1200': 'Escrita por usted',
  'M-1201': 'Quitar {nombre}',
  'M-1202': 'Editar {nombre}',
  'M-1208': 'Líneas con error',
  'M-1209': 'Líneas válidas',
  'M-1210': 'Todavía no hay variantes.',
  'M-1211': 'Texto de la lista',
  // Actualización con varias pestañas (PD-1-r1, B-11)
  'M-1212': 'Cierre las otras pestañas de Sig-Low para actualizar ahora.',
  'M-1213': 'Sig-Low se actualizó desde otra pestaña. Esta pestaña sigue con la versión anterior y algunas funciones pueden fallar: guarde la llave y después recargue la página.',
  // Aviso de privacidad de «Acerca de» (DOC-3-r1, D-09): registros del alojamiento, sin enlaces ni datos del responsable.
  'M-1901': 'Aviso de privacidad',
  'M-1902': 'Para entregarle esta página, el sitio que la aloja registra su dirección IP, la fecha y hora de la solicitud y las rutas de los archivos que su navegador pide. Son registros técnicos mínimos: no incluyen el contenido de sus documentos y Sig-Low no los usa para identificarlo.',
  'M-1903': 'Cloudflare trata esos registros como encargado del tratamiento, por cuenta del responsable y según su contrato de procesamiento de datos (DPA), y puede hacerlo fuera de Colombia, conforme a los artículos 24 y 25 del Decreto 1377 de 2013, hoy compilados en el Decreto 1074 de 2015.',
  'M-1904': 'La política de privacidad completa, con la identificación y el correo del responsable y sus derechos como titular, está en el archivo docs/legal/politica-de-privacidad.md del repositorio de Sig-Low.',
  // Mención ambigua (PB-3-r3, D-16; rango M-20xx): la decide el revisor. {opciones}: los marcadores [P] de las personas que pueden
  // ser, de la lista o de otra persona del documento (core/review/ambiguas.ts, `MENSAJE_AMBIGUA`). CIERRE-1 (D-18, D-19.6): texto
  // general, porque en M-72 hay una sola persona de la lista y en una forma corta del modelo puede no haber ninguna.
  'M-2001': 'Esta mención puede ser de más de una persona ({opciones}). Elija a quién corresponde, sepárela si es otra persona o deje el dato original visible. Mientras no lo decida, no se puede copiar ni descargar.',
  // La ficha de la mención ambigua (PC-3, D-19.6): las opciones de la lista del caso y las de fuera de ella (`fuera`).
  'M-2002': 'Personas de la lista de nombres que siempre deben ocultarse',
  'M-2003': 'Otras personas del documento',
  'M-2004': 'Es la misma que {opcion}',
  'M-2005': 'Ninguna de esas personas tiene otra mención en el documento con la que unirla: sepárela si es otra persona o deje el dato original visible.',
  // Tarjeta del modelo tras una descarga fallida (F0; rango M-21xx): un solo mensaje con el motivo y el botón «Reintentar».
  'M-2101': 'Reintentar',
  'M-2102': 'No se pudo terminar la descarga del detector de nombres adicional: la conexión se cortó o estuvo detenida demasiado tiempo. Lo que ya se descargó y comprobó quedó guardado en este navegador; pulse «Reintentar» para seguir desde ahí. Mientras tanto, Sig-Low sigue con sus reglas y con la lista de nombres que siempre deben ocultarse.',
} as const;

const TODO: Record<string, string> = { ...CATALOGO, ...EXTRA };

/**
 * Cada pantalla de A2 registra aquí sus textos sin id en 8.5 (cada módulo con sus ids propios, sin solapes: lo comprueba tests/unit/mensajes.test.ts). Así viven en el catálogo único,
 * y el barrido de textos prohibidos de PC-7 los ve. Un id repetido con otro texto es un defecto de programación.
 */
export function registrarMensajes(extra: Readonly<Record<string, string>>): void {
  for (const [id, texto] of Object.entries(extra)) {
    const previo = TODO[id];
    if (previo !== undefined && previo !== texto) throw new Error('MENSAJE_DUPLICADO');
    TODO[id] = texto;
  }
}

function sustituir(plantilla: string, params?: Readonly<Record<string, MsgParam>>): string {
  if (!params) return plantilla;
  return plantilla.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = params[k];
    return v === undefined ? m : String(v);
  });
}

/** Texto del catálogo con sus parámetros `[P]`. Un id desconocido es un defecto de programación (código, no contenido). */
export function t(id: MessageId, params?: Readonly<Record<string, MsgParam>>): string {
  const real = (ALIAS[id] ?? id) as string;
  const texto = TODO[real];
  if (texto === undefined) throw new Error('MENSAJE_DESCONOCIDO');
  return sustituir(texto, params);
}

/** Segunda variante de un mensaje con « / » en 8.5.1 (botones, resultado, casilla). */
export function alterno(id: MessageId, indice = 0, params?: Readonly<Record<string, MsgParam>>): string {
  const v = ALTERNOS[id]?.[indice];
  if (v === undefined) throw new Error('MENSAJE_DESCONOCIDO');
  return sustituir(v, params);
}

/** Todas las cadenas del catálogo (para el barrido de textos prohibidos de PC-7). */
export function todasLasCadenas(): string[] {
  return [...Object.values(TODO), ...Object.values(ALTERNOS).flat(), ...Object.values(CAUSA_PLAN_B)];
}

/** Ids de PC-1 sin equivalente en 8.5. */
export const X = {
  inicio: 'M-1101', lista: 'M-1102', entrada: 'M-1103', procesando: 'M-1104', revision: 'M-1105', listo: 'M-1106',
  reinsercion: 'M-1107', arranque: 'M-1108', irAlContenido: 'M-1109', pasosDelAsunto: 'M-1110', estadoDeSigLow: 'M-1111',
  avisos: 'M-1112', menuDelAsunto: 'M-1113', cerrar: 'M-1114', recargar: 'M-1115', ocultar: 'M-1116', asuntoChip: 'M-1117',
  crearUnAsunto: 'M-1120', codigoDelAsunto: 'M-1121', modoDeLaTabla: 'M-1122', contadorFrase: 'M-1123',
  abrirUnAsuntoGuardado: 'M-1124', asuntoGuardado: 'M-1125', fraseDelAsunto: 'M-1126', actualizadoEl: 'M-1127',
  modeloDeApoyo: 'M-1128', elijaAsunto: 'M-1129',
  fraseVariedad: 'M-1131', fraseDigitos: 'M-1132', fraseSecuencia: 'M-1133', fraseCodigo: 'M-1134', fraseComun: 'M-1135',
  entidadesDelCaso: 'M-1140', agregarALista: 'M-1141', nombre: 'M-1142', tipo: 'M-1143', rol: 'M-1144', clase: 'M-1145',
  rolOClase: 'M-1146', variantesActivas: 'M-1147', acciones: 'M-1148',
  variantesDeLaEntidad: 'M-1150', textoDeLaVariante: 'M-1151', guardarCambios: 'M-1152', faltaNombre: 'M-1153',
  seAgregaron: 'M-1157',
  cancelarEdicion: 'M-1161',
  fraseExportacion: 'M-1171', exportarCopia: 'M-1172', cuentaRegresiva: 'M-1173',
  antesDeActualizar: 'M-1176',
  claseDeVariante: { exacta: 'M-1190', sin_tildes: 'M-1191', mayusculas: 'M-1192', apellidos: 'M-1193', apellido_suelto: 'M-1194',
    nombre_suelto: 'M-1195', iniciales: 'M-1196', posesivo: 'M-1197', razon_social_sin_sufijo: 'M-1198', sigla: 'M-1199' },
  manual: 'M-1200', quitarA: 'M-1201', editarA: 'M-1202',
  lineasConError: 'M-1208', lineasValidas: 'M-1209', sinVariantes: 'M-1210', textoDeLaLista: 'M-1211',
} as const satisfies Record<string, MessageId | Record<string, MessageId>>;

/** Mensaje de un ErrorCode (8.5.2 y las referencias del catálogo principal). Solo códigos, nunca `error.message`. */
const POR_CODIGO: Readonly<Record<string, MessageId>> = {
  CONTRASENA_O_ARCHIVO: 'M-201', ENTRADA_INVALIDA: 'M-202', SESION_DESCONOCIDA: 'M-202', TIEMPO_AGOTADO: 'M-203',
  MEMORIA: 'M-204', ERROR_INTERNO: 'M-205', ARCHIVO_VACIO: 'M-206', IDB_NO_DISPONIBLE: 'M-208',
  ZIP_INVALIDO: 'M-209', PARTE_TRUNCADA: 'M-209', XML_INVALIDO: 'M-209',
  DEMASIADAS_ENTRADAS: 'M-210', DESCOMPRIMIDO_EXCEDE_LIMITE: 'M-210', DTD_NO_PERMITIDA: 'M-210',
  PARTE_XML_EXCEDE_LIMITE: 'M-211', SIN_DOCUMENTO_PRINCIPAL: 'M-212', PDF_DANADO: 'M-213', MODELO_NO_DESCARGADO: 'M-214',
  BACKEND_NO_DISPONIBLE: 'M-215', FORMATO_DESCONOCIDO: 'M-216', VERSION_MAS_RECIENTE: 'M-217', KDF_NO_ADMITIDO: 'M-218',
  PARAMETROS_FUERA_DE_RANGO: 'M-219', ARCHIVO_ALTERADO: 'M-220',
  CONTENEDOR_CFB: 'M-53', PDF_SIN_CAPA_TEXTO: 'M-54', PDF_CON_CONTRASENA: 'M-55', FORMATO_NO_ADMITIDO: 'M-57',
  OOXML_STRICT_NO_ADMITIDO: 'M-58', ARCHIVO_DEMASIADO_GRANDE: 'M-59', MODELO_INTEGRIDAD: 'M-31', CUOTA_EXCEDIDA: 'M-32',
  ASUNTO_EXISTENTE: 'M-113', CODIGO_INVALIDO: 'M-10', CONTEXTO_NO_SEGURO: 'M-38', SIN_SERVICE_WORKER: 'M-36',
  NO_ENCONTRADO: 'M-601', TRAMO_INVALIDO: 'M-602', SOLAPAMIENTO_PARCIAL: 'M-603', ROL_INCOMPATIBLE: 'M-604',
  ROL_FIJADO_EN_ASUNTO: 'M-605', TIPO_NO_PERMITIDO: 'M-606', DEPARTAMENTO_SIN_ELEGIR: 'M-127',
};

/** Id del mensaje de un código de error; los desconocidos caen en el error interno (M-205). */
export function idDeCodigo(codigo: string, contexto?: 'tabla' | 'modelo'): MessageId {
  if (codigo === 'CUOTA_EXCEDIDA') return contexto === 'tabla' ? 'M-91' : 'M-32';
  return POR_CODIGO[codigo] ?? 'M-205';
}

export function mensajeDeCodigo(codigo: string, contexto?: 'tabla' | 'modelo'): string {
  return t(idDeCodigo(codigo, contexto));
}

/** Etiqueta visible de un valor de enumeración (8.5.6 a 8.5.11). */
export function etiqueta(grupo: keyof typeof ETIQUETA_ID, valor: string): string {
  const ids = ETIQUETA_ID[grupo] as Readonly<Record<string, string>>;
  const id = ids[valor];
  if (id === undefined) throw new Error('MENSAJE_DESCONOCIDO');
  return t(id as MessageId);
}
