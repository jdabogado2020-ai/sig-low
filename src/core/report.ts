// Informe de anonimización (6.8, INV-I01 a INV-I05). PB-6. Código puro de core/: sin DOM ni red.
// El informe no contiene originales: solo conteos, códigos de catálogo, etiquetas neutras, versiones, hashes y fechas. Se
// construye leyendo únicamente campos que no son [M] (tipo, estado, fuente, confianza, motivo, familia, marcador, etiqueta
// neutra); nunca `Detection.text`, `canonicalKey`, `display`, `originals` ni el texto de una parte.
import { DATA_TYPES, FLAG_TYPES, MARKER_FAMILIES, SiglowError } from './types.ts';
import type {
  AnonymizationReport, CaseEntity, Confidence, DetectableType, DetectionSource, DocumentModel, ExportGate, ExportGateFn,
  FlagType, MarkerFamily, MetadataCategory, ParseWarningCode, Part, PartKind, PlanBCause, RejectReason, ReminderConfirmation,
  ResidueMode, ResidueResult, ReviewState, SuggestionKind,
} from './types.ts';
import { exportGate as exportGateReal } from './review/puerta.ts';
import { modeloParaInforme, PLAN_B_EN_PALABRAS } from './review/modelo.ts';

// ---------------------------------------------------------------------------------------------
// Catálogos de etiquetas (8.5.4, 8.5.6, 8.5.10, 8.5.11)
// ---------------------------------------------------------------------------------------------

const NOMBRES_DE_TIPO = [
  'Persona', 'Empresa', 'EPS', 'IPS', 'Entidad', 'Proveedor', 'Cédula de ciudadanía', 'Tarjeta de identidad',
  'Cédula de extranjería', 'Permiso por protección temporal', 'Permiso especial de permanencia', 'Pasaporte', 'NIT',
  'Tarjeta profesional o registro médico', 'Otro documento de identidad', 'Radicado judicial', 'Radicado administrativo',
  'Teléfono', 'Correo electrónico', 'Dirección', 'Barrio', 'Placa', 'Matrícula inmobiliaria', 'Número de cuenta',
  'Número de tarjeta', 'Historia clínica', 'Afiliación, autorización o póliza', 'Fecha', 'Valor', 'Municipio',
  'Departamento', 'Lugar', 'Cargo', 'Diagnóstico', 'Hecho llamativo', 'Posible menor de edad', 'Cita jurisprudencial',
] as const;
/** Nombre visible de cada tipo de dato (M-801 a M-837), en el orden de `DATA_TYPES`. */
export const NOMBRE_DE_TIPO: Readonly<Record<string, string>> = Object.fromEntries(DATA_TYPES.map((t, i) => [t, NOMBRES_DE_TIPO[i] as string]));

export const ETIQUETA_DE_METADATO: Readonly<Record<MetadataCategory, string>> = {
  propiedades_documento: 'Propiedades del documento (autor, título, fechas)',
  propiedades_aplicacion: 'Datos de la aplicación (empresa, plantilla, tiempo de edición)',
  propiedades_personalizadas: 'Propiedades personalizadas',
  xml_personalizado: 'Datos XML vinculados',
  personas: 'Datos de autores de comentarios o revisiones',
  autores_revisiones: 'Autores y fechas de revisiones y comentarios',
  texto_eliminado: 'Texto eliminado con control de cambios',
  codigos_campo: 'Códigos de campo (combinación de correspondencia, vínculos, rutas)',
  vinculos_externos: 'Vínculos externos (correos, páginas, rutas de archivos)',
  configuracion: 'Configuración del documento (variables, plantilla adjunta)',
  permisos_edicion: 'Permisos de edición por usuario',
  texto_alternativo: 'Texto alternativo de imágenes y formas',
  propiedades_controles: 'Propiedades de controles de contenido',
  glosario: 'Bloques de creación y autotexto',
  imagenes_y_miniatura: 'Imágenes (pueden traer datos de la cámara) y miniatura',
  objetos_y_macros: 'Objetos incrustados y macros',
  pdf_propiedades: 'Propiedades del PDF (título, autor, programa)',
  pdf_xmp: 'Metadatos XMP del PDF',
  pdf_autores_anotaciones: 'Autores de comentarios del PDF',
};

export const ETIQUETA_DE_MOTIVO: Readonly<Record<RejectReason, string>> = {
  SIN_MOTIVO: 'Sin motivo',
  FALSO_POSITIVO: 'No es un dato de una persona o empresa',
  DATO_PUBLICO: 'Dato público que no identifica a las partes',
  CITA_JURISPRUDENCIAL: 'Cita de jurisprudencia o de una norma',
  NECESARIO_ANALISIS: 'Lo necesito para el análisis y no identifica a nadie',
  OTRO: 'Otro motivo',
};

export const ETIQUETA_DE_SUGERENCIA: Readonly<Record<SuggestionKind, string>> = {
  FECHA_A_MES_ANIO: 'Fecha de un hecho → mes y año',
  FECHA_NACIMIENTO_A_RANGO_EDAD: 'Fecha de nacimiento → rango de edad',
  EDAD_A_RANGO: 'Edad → rango de edad',
  ROTULO_DOCUMENTO_A_GENERICO: 'Tipo de documento → documento de identidad',
  MUNICIPIO_A_DEPARTAMENTO: 'Municipio → departamento',
  DESPACHO_A_GENERICO: 'Despacho o autoridad → forma genérica',
};

// ---------------------------------------------------------------------------------------------
// Validaciones de forma (INV-I02): cada cadena del JSON sale de una lista permitida o de un patrón
// ---------------------------------------------------------------------------------------------

/** 6.3.5 · ETIQUETA_NEUTRA. */
export const ETIQUETA_NEUTRA = /^(Documento \d+|Cuerpo del documento|Texto pegado|Encabezado \d+|Pie de página \d+|Nota al pie \d+|Nota al final \d+|Comentario \d+|Página \d+|Anotación \d+ \(página \d+\))$/u;
const RE_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const RE_SHA256 = /^[0-9a-f]{64}$/u;
const RE_ETIQUETA_DOCUMENTO = /^(?:Documento \d+|Texto pegado)$/u;
const ID_DE_MODELO: ReadonlySet<string> = new Set(['gliner-x-large', 'gliner-x-base']);

/** Etiqueta neutra por defecto de una parte (6.3.2), por si la recibida no cumple ETIQUETA_NEUTRA. */
function etiquetaNeutra(p: Part): string {
  if (ETIQUETA_NEUTRA.test(p.label)) return p.label;
  const n = Number.isInteger(p.index) && p.index > 0 ? p.index : 1;
  const pg = p.page !== undefined && Number.isInteger(p.page) && p.page > 0 ? p.page : 1;
  switch (p.kind) {
    case 'encabezado': return `Encabezado ${n}`;
    case 'cuerpo': return 'Cuerpo del documento';
    case 'pie': return `Pie de página ${n}`;
    case 'nota_pie': return `Nota al pie ${n}`;
    case 'nota_final': return `Nota al final ${n}`;
    case 'comentario': return `Comentario ${n}`;
    case 'anotacion_pdf': return `Anotación ${n} (página ${pg})`;
    case 'pagina_pdf': return `Página ${pg}`;
  }
}

// ---------------------------------------------------------------------------------------------
// Fechas en hora de Colombia (UTC-5, sin horario de verano)
// ---------------------------------------------------------------------------------------------

/** ISO con -05:00 (`AAAA-MM-DDTHH:MM:SS-05:00`). */
export function isoBogota(d: Date): string {
  const t = new Date(d.getTime() - 5 * 3_600_000);
  return `${t.toISOString().slice(0, 19)}-05:00`;
}
/** `AAAAMMDD-HHMM` en hora de Colombia, para los nombres de descarga (6.9). */
export function sello(d: Date): string {
  const t = new Date(d.getTime() - 5 * 3_600_000).toISOString();
  return `${t.slice(0, 4)}${t.slice(5, 7)}${t.slice(8, 10)}-${t.slice(11, 13)}${t.slice(14, 16)}`;
}
/** Nombre de descarga del informe (6.9): nunca el original, el código del asunto ni nombres de partes. */
export function nombreDeInforme(d: Date, ext: 'json' | 'txt'): string {
  return `sig-low-informe-${sello(d)}.${ext}`;
}
function aBogota(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new SiglowError('ENTRADA_INVALIDA');
  return isoBogota(d);
}

// ---------------------------------------------------------------------------------------------
// Construcción del informe
// ---------------------------------------------------------------------------------------------

export interface ReportInput {
  doc: DocumentModel;
  state: ReviewState;
  residue: ResidueResult | null;
  reminder: ReminderConfirmation;
  caseList: readonly CaseEntity[];
  app: { version: string; compilacion: string };
  rulesVersion: string;
  /** Id y hash del manifiesto del modelo (6.11.3); ausentes si nunca se cargó (plan B sin modelo). */
  modelo?: { id?: string; sha256?: string };
  /** Ventanas incorporadas y total, para el plan B (el estado `plan_b` no las guarda). */
  avanceDelModelo?: { ventanas: number; ventanasTotales: number };
  /** Código del asunto; solo entra al informe con `incluirCodigoAsunto` (6.8). */
  asunto?: { codigo: string };
  incluirCodigoAsunto?: boolean;
  now: Date;
  /** Cuándo se marcó la confirmación única (D-24); por defecto, `now`. */
  recordatorioConfirmado?: Date;
}
export interface ReportDeps { exportGate?: ExportGateFn }

const cuenta = <K extends string>(m: Map<K, number>, k: K): void => { m.set(k, (m.get(k) ?? 0) + 1); };

/**
 * Informe de 6.8. Solo se genera con `exportGate.ok` (INV-I03): si la puerta no está abierta lanza
 * `SiglowError('ENTRADA_INVALIDA')`. `residuos.resultado` es siempre `sin_residuos`. El plan B nunca se calla (INV-I04).
 */
export function buildReport(input: ReportInput, deps: ReportDeps = {}): AnonymizationReport {
  const gate: ExportGate = (deps.exportGate ?? exportGateReal)(input.state, input.residue, input.reminder);
  const residue = input.residue;
  if (!gate.ok || residue === null) throw new SiglowError('ENTRADA_INVALIDA');
  const { doc, state } = input;
  if (!RE_VERSION.test(input.app.version) || !RE_SHA256.test(input.app.compilacion) || !RE_VERSION.test(input.rulesVersion)) {
    throw new SiglowError('ENTRADA_INVALIDA');
  }
  const mod = modeloParaInforme(state.modelo, input.avanceDelModelo);
  if (mod === null) throw new SiglowError('ENTRADA_INVALIDA');   // modelo en curso: la puerta ya lo habría cerrado
  const modelo: AnonymizationReport['motor']['modelo'] = { estado: mod.estado, planB: mod.planB };
  const id = input.modelo?.id;
  if (id !== undefined) { if (!ID_DE_MODELO.has(id)) throw new SiglowError('ENTRADA_INVALIDA'); modelo.id = id; }
  const sha = input.modelo?.sha256;
  if (sha !== undefined) { if (!RE_SHA256.test(sha)) throw new SiglowError('ENTRADA_INVALIDA'); modelo.sha256 = sha; }
  if (mod.ventanas !== undefined) modelo.ventanas = mod.ventanas;
  if (mod.ventanasTotales !== undefined) modelo.ventanasTotales = mod.ventanasTotales;

  // Conteos por tipo (INV-I05): sin pendientes al generar.
  type Fila = { detectadas: number; aceptadas: number; editadas: number; rechazadas: number; manuales: number;
    porFuente: Record<DetectionSource, number>; porConfianza: Record<Confidence, number> };
  const filas = new Map<DetectableType, Fila>();
  const rechazos = new Map<string, { tipo: DetectableType; motivo: RejectReason; cantidad: number }>();
  let aprobacionesPorGrupo = 0;
  let propuestaAplicada = 0;
  let rechazadasTotal = 0;
  for (const d of Object.values(state.detections)) {
    if (d.status === 'pendiente') throw new SiglowError('ENTRADA_INVALIDA');
    let f = filas.get(d.type);
    if (f === undefined) {
      f = { detectadas: 0, aceptadas: 0, editadas: 0, rechazadas: 0, manuales: 0,
        porFuente: { manual: 0, lista: 0, regla: 0, modelo: 0 }, porConfianza: { alta: 0, media: 0, baja: 0 } };
      filas.set(d.type, f);
    }
    f.detectadas++;
    if (d.status === 'aceptada') f.aceptadas++;
    else if (d.status === 'editada') f.editadas++;
    else { f.rechazadas++; rechazadasTotal++; }
    if (d.source === 'manual') f.manuales++;
    f.porFuente[d.source]++;
    f.porConfianza[d.confidence]++;
    if (d.status === 'aceptada' && d.decidedBy === 'grupo') aprobacionesPorGrupo++;
    if (d.status === 'aceptada' && d.decidedBy === 'propuesta') propuestaAplicada++;
    if (d.status === 'rechazada') {
      const motivo = d.rejectReason ?? 'SIN_MOTIVO';
      const k = `${d.type}|${motivo}`;
      const r = rechazos.get(k) ?? { tipo: d.type, motivo, cantidad: 0 };
      r.cantidad++;
      rechazos.set(k, r);
    }
  }
  const ordenTipo = new Map<string, number>(DATA_TYPES.map((t, i) => [t, i]));
  const conteos: AnonymizationReport['conteos'] = [...filas.entries()]
    .sort((a, b) => (ordenTipo.get(a[0]) ?? 0) - (ordenTipo.get(b[0]) ?? 0))
    .map(([tipo, f]) => ({ tipo, ...f }));

  // Marcadores por familia.
  const fam = new Map<MarkerFamily, { distintos: number; nuevos: number; heredados: number }>();
  for (const e of Object.values(state.entities)) {
    if (e.marker === undefined) continue;
    const f = fam.get(e.family) ?? { distintos: 0, nuevos: 0, heredados: 0 };
    f.distintos++;
    if (e.markerState === 'heredado') f.heredados++; else f.nuevos++;
    fam.set(e.family, f);
  }
  const marcadores: AnonymizationReport['marcadores'] = MARKER_FAMILIES.filter((f) => fam.has(f))
    .map((familia) => ({ familia, ...(fam.get(familia) as { distintos: number; nuevos: number; heredados: number }) }));

  // Banderas y sugerencias.
  const ban = new Map<FlagType, { total: number; mantenidas: number; reemplazadas: number }>();
  let banderasMantenidas = 0;
  for (const f of Object.values(state.flags)) {
    const b = ban.get(f.type) ?? { total: 0, mantenidas: 0, reemplazadas: 0 };
    b.total++;
    if (f.resolution === 'mantener') { b.mantenidas++; banderasMantenidas++; }
    else if (f.resolution === 'reemplazar') b.reemplazadas++;
    ban.set(f.type, b);
  }
  const banderas: AnonymizationReport['banderas'] = FLAG_TYPES.filter((t) => ban.has(t))
    .map((tipo) => ({ tipo, ...(ban.get(tipo) as { total: number; mantenidas: number; reemplazadas: number }) }));
  const sug = new Map<SuggestionKind, { aplicadas: number; descartadas: number; sinDecidir: number }>();
  let descartadasTotal = 0;
  let sinDecidirTotal = 0;
  for (const s of Object.values(state.suggestions)) {
    const r = sug.get(s.kind) ?? { aplicadas: 0, descartadas: 0, sinDecidir: 0 };
    if (s.status === 'aplicada') r.aplicadas++;
    else if (s.status === 'descartada') { r.descartadas++; descartadasTotal++; }
    else { r.sinDecidir++; sinDecidirTotal++; }
    sug.set(s.kind, r);
  }
  const ordenSug = Object.keys(ETIQUETA_DE_SUGERENCIA) as SuggestionKind[];
  const sugerencias: AnonymizationReport['sugerencias'] = ordenSug.filter((k) => sug.has(k))
    .map((clase) => ({ clase, ...(sug.get(clase) as { aplicadas: number; descartadas: number; sinDecidir: number }) }));

  // Advertencias y metadatos (sin valores).
  const adv = new Map<ParseWarningCode, number>();
  for (const w of doc.warnings) adv.set(w.code, (adv.get(w.code) ?? 0) + w.count);
  const categorias = (Object.keys(doc.metadata.categories) as MetadataCategory[])
    .filter((c) => Object.hasOwn(ETIQUETA_DE_METADATO, c)).sort();

  const variantesActivas = input.caseList.reduce((n, e) => n + e.variants.filter((v) => v.enabled).length, 0);
  const etiquetaDoc = RE_ETIQUETA_DOCUMENTO.test(doc.label) ? doc.label : 'Documento 1';
  const confirmado = isoBogota(input.recordatorioConfirmado ?? input.now);

  const report: AnonymizationReport = {
    formato: 'sig-low/informe', v: 1,
    generado: isoBogota(input.now),
    app: { version: input.app.version, compilacion: input.app.compilacion },
    motor: {
      reglas: { version: input.rulesVersion },
      lista: { entidades: input.caseList.length, variantesActivas },
      modelo,
    },
    documento: {
      etiqueta: etiquetaDoc, entrada: doc.source,
      partes: doc.parts.map((p) => ({ tipo: p.kind as PartKind, etiqueta: etiquetaNeutra(p), incluida: p.included })),
    },
    conteos,
    marcadores,
    rechazos: [...rechazos.values()].sort((a, b) => (ordenTipo.get(a.tipo) ?? 0) - (ordenTipo.get(b.tipo) ?? 0) || (a.motivo < b.motivo ? -1 : a.motivo > b.motivo ? 1 : 0)),
    banderas,
    sugerencias,
    edicionesDeTramo: Object.keys(state.spanEdits).length,
    aprobacionesPorGrupo,
    propuestaAplicada,
    residuos: { resultado: 'sin_residuos', valoresBuscados: residue.valuesSearched, modos: [...residue.modes] as ResidueMode[], ejecutada: aBogota(residue.ranAt) },
    metadatos: { categorias },
    advertencias: [...adv.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([codigo, cantidad]) => ({ codigo, cantidad })),
    recordatorio: { revisado: true, confirmado },
    aCriterio: { rechazadas: rechazadasTotal, banderasMantenidas, sugerenciasDescartadas: descartadasTotal, sugerenciasSinDecidir: sinDecidirTotal },
  };
  if (input.incluirCodigoAsunto === true && input.asunto !== undefined) {
    // `asunto` va después de `motor`, como en 6.8.
    const { formato, v, generado, app, motor, ...resto } = report;
    return { formato, v, generado, app, motor, asunto: { codigo: input.asunto.codigo }, ...resto };
  }
  return report;
}

/** JSON del informe (`sig-low-informe-AAAAMMDD-HHMM.json`). */
export function reportToJson(r: AnonymizationReport): string {
  return JSON.stringify(r, null, 2);
}

// ---------------------------------------------------------------------------------------------
// Versión legible (.txt, UTF-8 con BOM y CRLF)
// ---------------------------------------------------------------------------------------------

/** Cadenas fijas de la plantilla legible: INV-I06 las barre con las expresiones de textos prohibidos (8.5). */
export const PLANTILLA = {
  titulo: 'INFORME DE ANONIMIZACIÓN · Sig-Low',
  datos: 'DATOS REEMPLAZADOS',
  rechazo: 'LO QUE USTED DEJÓ A LA VISTA',
  criterio: 'LO QUE QUEDÓ A SU CRITERIO',
  residuos: 'BÚSQUEDA DE DATOS QUE SE ESCAPARON',
  metadatos: 'METADATOS DEL ARCHIVO ORIGINAL (no se copian a la salida)',
  recordatorio: 'CONFIRMACIÓN ANTES DE DESCARGAR',
  confirmacion: 'Revisé la vista previa. Entiendo que respondo por el documento que comparto.',
  propuesta: 'Datos que Sig-Low ocultó de entrada y usted dejó así al revisar la vista previa',
  planBUna: 'La revisión se apoyó solo en las reglas y en los nombres que siempre deben ocultarse.',
  residuosNota: 'La búsqueda compara el documento anonimizado con los datos encontrados y con los nombres que siempre deben ocultarse. No puede encontrar datos que nadie encontró.',
  cierre: 'Este informe no contiene los datos originales. Sig-Low propuso qué ocultar y usted revisó el resultado. Reemplazar datos por etiquetas es seudonimizar: mientras exista la llave para devolver los datos reales, los datos siguen siendo personales. Antes de usar el texto, aplique la prueba final del protocolo: ¿alguien que no conoce el caso podría saber de quién se trata?',
} as const;

const MODOS_EN_PALABRAS: Readonly<Record<ResidueMode, string>> = {
  literal: 'texto literal', normalizado: 'texto normalizado', digitos: 'dígitos sin separadores', variante: 'variantes de la lista del caso',
};
const ENTRADA_EN_PALABRAS: Readonly<Record<string, string>> = {
  pegado: 'texto pegado', txt: 'archivo de texto', docx: 'archivo .docx', pdf: 'archivo PDF',
};

function fechaLegible(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} (hora de Colombia)`;
}
const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

/** Informe legible: números del JSON, etiquetas de tipos y categorías de 8.5.4 y 8.5.10. */
export function reportToText(r: AnonymizationReport): string {
  const L: string[] = [];
  L.push(`${PLANTILLA.titulo} ${r.app.version}`, '');
  L.push(`Compilación: ${r.app.compilacion}`);
  L.push(`Fecha: ${fechaLegible(r.generado)}`);
  L.push(`Documento: ${r.documento.etiqueta} (${ENTRADA_EN_PALABRAS[r.documento.entrada] ?? r.documento.entrada})`);
  if (r.asunto !== undefined) L.push(`Código del asunto: ${r.asunto.codigo}`);
  const incl = r.documento.partes.filter((p) => p.incluida).map((p) => p.etiqueta);
  const excl = r.documento.partes.filter((p) => !p.incluida).map((p) => p.etiqueta);
  L.push(`Partes procesadas: ${incl.length === 0 ? 'ninguna' : incl.join('; ')}`);
  L.push(`Partes que usted excluyó: ${excl.length === 0 ? 'ninguna' : excl.join('; ')}`, '');

  L.push(`Reglas: versión ${r.motor.reglas.version}`);
  L.push(`Nombres que siempre deben ocultarse: ${plural(r.motor.lista.entidades, 'nombre', 'nombres')} y ${plural(r.motor.lista.variantesActivas, 'forma activa', 'formas activas')}`);
  const m = r.motor.modelo;
  if (m.planB) {
    const causa = PLAN_B_EN_PALABRAS[m.estado as PlanBCause];
    L.push(`Detector de nombres adicional: no se completó (${causa}). ${PLANTILLA.planBUna}`);
    if (m.ventanas !== undefined && m.ventanasTotales !== undefined) L.push(`Bloques revisados por el detector: ${m.ventanas} de ${m.ventanasTotales}`);
  } else {
    const n = m.ventanasTotales ?? 0;
    L.push(m.estado === 'respaldo_base'
      ? `Detector de nombres adicional: versión reducida, revisó todo el documento (${plural(n, 'bloque', 'bloques')}).`
      : `Detector de nombres adicional: revisó todo el documento (${plural(n, 'bloque', 'bloques')}).`);
  }
  L.push('');

  L.push(PLANTILLA.datos);
  L.push('Tipo · Encontrados · Ocultos · Editados · A la vista');
  if (r.conteos.length === 0) L.push('Ninguno.');
  for (const c of r.conteos) L.push(`${NOMBRE_DE_TIPO[c.tipo] ?? c.tipo} · ${c.detectadas} · ${c.aceptadas} · ${c.editadas} · ${c.rechazadas}`);
  L.push('');

  L.push(PLANTILLA.rechazo);
  if (r.rechazos.length === 0) L.push('Ninguno.');
  for (const x of r.rechazos) L.push(`${NOMBRE_DE_TIPO[x.tipo] ?? x.tipo} · ${x.cantidad} · ${ETIQUETA_DE_MOTIVO[x.motivo]}`);
  L.push('');

  L.push(PLANTILLA.criterio);
  L.push(`${PLANTILLA.propuesta}: ${r.propuestaAplicada}`);
  L.push(`Datos indirectos que usted dejó como estaban: ${r.aCriterio.banderasMantenidas}`);
  L.push(`Sugerencias descartadas: ${r.aCriterio.sugerenciasDescartadas}`);
  L.push(`Sugerencias sin decidir: ${r.aCriterio.sugerenciasSinDecidir}`, '');

  L.push(PLANTILLA.residuos);
  const modos = r.residuos.modos.map((x) => MODOS_EN_PALABRAS[x]).join(', ');
  L.push(`No se encontraron en la salida los ${r.residuos.valoresBuscados} valores buscados (${modos}). ${PLANTILLA.residuosNota}`, '');

  L.push(PLANTILLA.metadatos);
  if (r.metadatos.categorias.length === 0) L.push('Ninguno.');
  for (const c of r.metadatos.categorias) L.push(`- ${ETIQUETA_DE_METADATO[c]}`);
  L.push('');

  L.push(PLANTILLA.recordatorio);
  L.push(`[x] ${PLANTILLA.confirmacion}`);
  L.push(`Confirmado: ${fechaLegible(r.recordatorio.confirmado)}`, '');
  L.push(PLANTILLA.cierre);
  return '﻿' + L.join('\r\n') + '\r\n';
}
