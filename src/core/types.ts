/**
 * Contrato común de datos de Sig-Low: transcripción textual de los bloques TypeScript de la sección 6 del plan técnico v1.1.
 * Único archivo compartido entre pistas; un cambio de tipo pasa por el integrador.
 * Marcas: [M] = texto original o derivado reversible (nunca fuera de la memoria o del registro cifrado); [P] = sin originales.
 *
 * Divergencias respecto de la sección 6 (P0-1):
 *  - Las `export declare function …` se transcriben como tipos `…Fn` (sin funciones ambientales).
 *  - `SiglowError` se implementa (6.11.1 la declara solo como clase ambiental): message === code.
 *  - `GlinerEngine` y `NullNerEngine` (clases ambientales en 6.11.3) pasan a `GlinerEngineCtor` y `NullNerEngineShape`/`NullNerEngineCtor`;
 *    las clases reales viven en src/core/ner/ y se llaman GlinerEngine y NullNerEngine.
 */

// ===== Sección 6.1.2 Vista normalizada con mapa (bloque 1, línea 872) =====
export type NormalizationProfile = 'reglas' | 'lista' | 'digitos';   // 'reglas' ⊂ 'lista'; 'digitos' parte de 'reglas'
/** [M] */
export interface SearchView {
  readonly profile: NormalizationProfile;
  readonly text: string;
  /** startMap[i] = posición canónica donde empieza el carácter de origen de text[i]; longitud text.length + 1,
   *  con startMap[text.length] = longitud del canónico. */
  readonly startMap: Uint32Array;
  /** endMap[i] = posición canónica (exclusiva) donde termina ese carácter; longitud text.length. */
  readonly endMap: Uint32Array;
}
export type BuildSearchViewFn = (text: string, profile: NormalizationProfile, partKind: PartKind) => SearchView;
/** Tramo normalizado [nStart, nEnd), nEnd > nStart → { start: v.startMap[nStart], end: v.endMap[nEnd - 1] } */
export type ToCanonicalSpanFn = (v: SearchView, nStart: number, nEnd: number) => { start: number; end: number };

// ===== Sección 6.1.4 Identificadores (bloque 2, línea 904) =====
type Brand<T, B extends string> = T & { readonly __brand: B };
export type DocId = Brand<string, 'DocId'>;  export type PartId = Brand<string, 'PartId'>;
export type DetectionId = Brand<string, 'DetectionId'>;  export type EntityId = Brand<string, 'EntityId'>;
export type CaseEntityId = Brand<string, 'CaseEntityId'>;  export type SuggestionId = Brand<string, 'SuggestionId'>;
export type FlagId = Brand<string, 'FlagId'>;  export type SpanEditId = Brand<string, 'SpanEditId'>;
export type AsuntoId = Brand<string, 'AsuntoId'>;  export type RequestId = Brand<string, 'RequestId'>;
export type ReinsertMatchId = Brand<string, 'ReinsertMatchId'>;
export interface IdSource { next(prefix: 'doc' | 'prt' | 'det' | 'ent' | 'cas' | 'sug' | 'flg' | 'edt' | 'asu' | 'req' | 'rei'): string; }
export type IsoDateTime = string;   // ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ (new Date().toISOString())
export type IsoDate = string;       // 'AAAA-MM-DD'

// ===== Sección 6.2 Enumeraciones (bloque 3, línea 929) =====
export const DATA_TYPES = [
  'PERSONA', 'EMPRESA', 'EPS', 'IPS', 'ENTIDAD', 'PROVEEDOR',
  'CC', 'TI', 'CE', 'PPT', 'PEP', 'PASAPORTE', 'NIT', 'TP', 'DOCUMENTO',
  'RADICADO', 'RADICADO_ADMIN', 'TELEFONO', 'CORREO', 'DIRECCION', 'BARRIO',
  'PLACA', 'MATRICULA', 'CUENTA', 'TARJETA', 'HC', 'AFILIACION',
  'FECHA', 'VALOR', 'MUNICIPIO', 'DEPARTAMENTO', 'LUGAR',
  'CARGO', 'DIAGNOSTICO', 'HECHO_LLAMATIVO', 'MENOR', 'CITA_JURISPRUDENCIAL',
] as const;
export type DataType = typeof DATA_TYPES[number];
/** Banderas de revisión manual: sin marcador automático. */
export const FLAG_TYPES = ['CARGO', 'DIAGNOSTICO', 'HECHO_LLAMATIVO', 'MENOR', 'CITA_JURISPRUDENCIAL'] as const;
export type FlagType = typeof FLAG_TYPES[number];
export type DetectableType = Exclude<DataType, FlagType>;

/** Personas: rol procesal. Organizaciones: clase (el rol procesal de una organización no se codifica en el marcador). */
export const ROLES = ['DEMANDANTE', 'DEMANDADO', 'TESTIGO', 'PACIENTE', 'CLIENTE', 'CONTACTO',
  'EMPRESA', 'EPS', 'IPS', 'ENTIDAD', 'PROVEEDOR', 'OTRA_PERSONA'] as const;
export type Role = typeof ROLES[number];
export const ORG_CLASSES = ['EMPRESA', 'EPS', 'IPS', 'ENTIDAD', 'PROVEEDOR'] as const;
export type OrgClass = typeof ORG_CLASSES[number];
export type PersonRole = Exclude<Role, OrgClass>;

export type Confidence = 'alta' | 'media' | 'baja';
export type DetectionSource = 'manual' | 'lista' | 'regla' | 'modelo';
export type DetectionStatus = 'pendiente' | 'aceptada' | 'rechazada' | 'editada';

export const MARKER_FAMILIES = [
  'DEMANDANTE', 'DEMANDADO', 'TESTIGO', 'PACIENTE', 'CLIENTE', 'CONTACTO', 'PERSONA',
  'EMPRESA', 'EPS', 'IPS', 'ENTIDAD', 'PROVEEDOR',
  'CC', 'TI', 'CE', 'PPT', 'PEP', 'PASAPORTE', 'NIT', 'TP', 'DOCUMENTO',
  'DIRECCION', 'TELEFONO', 'CORREO', 'RADICADO', 'HC', 'AFILIACION',
  'PLACA', 'MATRICULA', 'CUENTA', 'FECHA', 'VALOR', 'DEPARTAMENTO',
] as const;
export type MarkerFamily = typeof MARKER_FAMILIES[number];
const TILDES: Record<string, string> = { DIRECCION: 'DIRECCIÓN', TELEFONO: 'TELÉFONO', AFILIACION: 'AFILIACIÓN', MATRICULA: 'MATRÍCULA' };
/** Etiqueta visible (tildes del protocolo, NFC): el nombre de la familia, salvo estas cuatro. */
export const MARKER_LABEL = Object.fromEntries(MARKER_FAMILIES.map(f => [f, TILDES[f] ?? f])) as Readonly<Record<MarkerFamily, string>>;

export type PartKind = 'encabezado' | 'cuerpo' | 'pie' | 'nota_pie' | 'nota_final' | 'comentario' | 'anotacion_pdf' | 'pagina_pdf';
export type DocumentSource = 'pegado' | 'txt' | 'docx' | 'pdf';
export type VariantClass = 'exacta' | 'sin_tildes' | 'mayusculas' | 'apellidos' | 'apellido_suelto' | 'nombre_suelto'
  | 'iniciales' | 'posesivo' | 'razon_social_sin_sufijo' | 'sigla';
export type ValidatorName = 'DV_NIT' | 'RADICADO' | 'LUHN' | 'NDC' | 'CORREO' | 'FECHA';
/** El modelo principal (GLiNER-X) solo produce PER, ORG y LOC (person, organization, location); OTH y DATE quedan previstos para motores futuros y ningún motor de v1.0 los emite. */
export type NerLabel = 'PER' | 'ORG' | 'LOC' | 'OTH' | 'DATE';
export type RejectReason = 'SIN_MOTIVO' | 'FALSO_POSITIVO' | 'DATO_PUBLICO' | 'CITA_JURISPRUDENCIAL' | 'NECESARIO_ANALISIS' | 'OTRO';

/** Total sobre DetectableType (tabla 6.2.1); devuelve la familia del marcador. Persona sin rol → 'PERSONA'.
 *  TI, CE, PPT y PEP → 'DOCUMENTO' por defecto (marcador neutro); su propia familia solo con `opts.marcadorEspecifico` (acción `especificar_documento`, 6.4.4). */
export type FamilyForFn = (type: DetectableType, role?: Role, opts?: { marcadorEspecifico?: boolean }) => MarkerFamily;

// ===== Sección 6.3 Documento de entrada (bloque 4, línea 1043) =====
export interface DocumentModel {
  id: DocId;
  label: string;                 // [P] «Documento N»; nunca el nombre del archivo
  source: DocumentSource;
  encoding?: 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';   // solo .txt
  parts: Part[];                 // en orden de lectura canónico (6.3.1)
  metadata: MetadataInventory;   // [P]
  warnings: ParseWarning[];      // [P]
}
export interface Part {
  id: PartId; docId: DocId; kind: PartKind;
  label: string;                 // [P] etiqueta neutra (6.3.2)
  order: number;                 // 0..n-1 en orden de lectura canónico
  index: number;                 // 1..k dentro de su tipo
  page?: number;                 // solo pagina_pdf y anotacion_pdf
  text: string;                  // [M] texto canónico (6.1.1)
  included: boolean;             // casilla del panel de partes; por defecto true
}

// ===== Sección 6.3.3 Inventario de metadatos (bloque 5, línea 1085) =====
export type MetadataCategory =
  | 'propiedades_documento' | 'propiedades_aplicacion' | 'propiedades_personalizadas' | 'xml_personalizado'
  | 'personas' | 'autores_revisiones' | 'texto_eliminado' | 'codigos_campo' | 'vinculos_externos'
  | 'configuracion' | 'permisos_edicion' | 'texto_alternativo' | 'propiedades_controles' | 'glosario'
  | 'imagenes_y_miniatura' | 'objetos_y_macros' | 'pdf_propiedades' | 'pdf_xmp' | 'pdf_autores_anotaciones';
/** [P] Clave presente ⇔ la categoría existe en el archivo. */
export interface MetadataInventory { categories: Partial<Record<MetadataCategory, { count: number }>>; }

// ===== Sección 6.3.4 Advertencias y límites de lectura (bloque 6, línea 1099) =====
export type ParseWarningCode =
  | 'CODIFICACION_ALTERNATIVA' | 'UTF16_SIN_BOM'
  | 'TEXTO_ELIMINADO_EXCLUIDO'      // S-09
  | 'TEXTO_OCULTO_INCLUIDO'         // w:vanish
  | 'CONTENIDO_IMPORTADO_NO_LEIDO'  // w:altChunk
  | 'SMARTART_O_GRAFICO_NO_LEIDO' | 'MARCA_DE_AGUA' | 'NUMERACION_NO_RECONSTRUIDA' | 'OOXML_STRICT'
  | 'PAGINA_SIN_TEXTO'              // PDF: < pdfMinCharsPerPage caracteres no blancos
  | 'TEXTO_ILEGIBLE'                // PDF: proporción alta de U+FFFD o U+E000–U+F8FF
  | 'ORDEN_LECTURA_PDF'
  | 'CARACTERES_CONTROL';           // se quitarán al exportar .docx
/** [P] Sin texto libre. */
export interface ParseWarning { code: ParseWarningCode; partId?: PartId; page?: number; count: number; }

export interface IoLimits {
  maxFileBytes: number;          // 26 214 400 (25 MiB; la interfaz dice «25 MB»)
  maxZipEntries: number;         // 1024
  maxUncompressedTotal: number;  // 104 857 600 (100 MiB), contado al descomprimir, nunca por la cabecera
  maxXmlPartBytes: number;       // 15 728 640 (15 MiB); calibrar con el corpus (PE-2)
  timeoutMs: number;             // 15 000; calibrar (PE-1, PE-4)
  pdfMinCharsPerPage: number;    // 10
  pdfMaxScannedRatio: number;    // 0,5: más de la mitad de páginas sin texto → PDF_SIN_CAPA_TEXTO
}

// ===== Sección 6.4.1 Tramos, rótulos y validadores (bloque 7, línea 1146) =====
export interface Span { partId: PartId; start: number; end: number; }
/** Rótulo junto al dato («C.C.», «radicado»). [P] labelId del catálogo de 7.2.1. */
export interface LabelHit { labelId: string; start: number; end: number; }
/** Un validador que falla baja la confianza; nunca descarta. */
export interface ValidatorResult { name: ValidatorName; passed: boolean; }

// ===== Sección 6.4.2 Candidato y contratos del motor de reglas (bloque 8, línea 1156) =====
export interface DetectionCandidate {
  partId: PartId; start: number; end: number;
  type: DataType;                // FlagType solo si el detector emite una bandera
  role?: Role;
  // Cambio de contrato del integrador (regla 9, 30-oct): admite 'manual' para que las detecciones manuales
  // (precedencia 1, 6.2.4) pasen por mergeCandidates al reprocesar (7.11, pasada 3 de residuos). Los detectores
  // de reglas, lista y modelo nunca emiten 'manual'.
  source: DetectionSource;
  ruleId?: string;               // source 'regla'; ^R-[A-Z_]+-\d{2}$ (R-CC-01, R-RAD_ADMIN-01, R-RES-02; no R-cc-01 ni R-CC-001)
  caseEntityId?: CaseEntityId;   // source 'lista'
  variantClass?: VariantClass;   // source 'lista'
  nerLabel?: NerLabel;           // source 'modelo'
  confidence: Confidence; score: number;
  canonicalKey: string;          // [M] (6.6.1)
  label?: LabelHit; validator?: ValidatorResult;
  context?: 'nacimiento' | 'hecho' | 'cita' | 'norma' | 'despacho';   // pista para sugerencias y banderas
  placeOptions?: string[];       // municipio homónimo sin resolver: códigos DANE de departamento (≥ 2)
}

// src/core/rules/catalog.ts: lo implementan PA-2 a PA-7 y PB-6; lo consumen merge.ts, render.ts y residue.ts.
export interface RuleSpec {
  id: string;                                   // ^R-[A-Z_]+-\d{2}$
  type: DetectableType;
  flags: 'dgu' | 'dgiu';
  source: string;                               // expresión ya expandida (7.2.0)
  needsCue?: RegExp;                            // pista obligatoria en los 60 caracteres previos de la misma línea
  assess(m: RegExpExecArray, ctx: RuleContext): RuleVerdict | RuleVerdict[] | null;
}
export interface RuleContext { view: SearchView; partId: PartId; refYear: number }   // refYear: año de DetectOptions.referenceDate
export interface RuleVerdict {
  nStart?: number; nEnd?: number;               // subtramo en la vista (radicados); por defecto, el grupo v
  type?: DetectableType;                        // cambia el tipo por defecto de la regla (R-RAD-02)
  confidence: Confidence; validator?: ValidatorResult; canonicalKey: string /* [M] */; labelId?: string;
  // Cambio de contrato del integrador (regla 9, 29-oct): 7.2.0 dice que la salida de las reglas lleva `context`;
  // runRules los copia a DetectionCandidate.
  context?: DetectionCandidate['context']; role?: Role;
}
export interface RuleRegistry {
  /** Vuelve a ejecutar la regla `ruleId` sobre un remanente (7.11.2). */
  rerun(ruleId: string, text: string): { start: number; end: number; canonicalKey: string } | null;
}
export interface MergedCandidate extends DetectionCandidate {
  precedence: 1 | 2 | 3 | 4 | 5 | 6;
  extended?: boolean;     // lista extendida por el modelo
  fragment?: boolean;     // remanente de regla sin patrón completo
  holderDigits?: string;  // NIT que absorbió una CC: dígitos de la CC (7.12.3)
}
export type MergeCandidatesFn = (part: Part, cands: readonly DetectionCandidate[], rules: RuleRegistry) => MergedCandidate[];

// ===== Sección 6.4.3 Reemplazo y detección (bloque 9, línea 1203) =====
export interface Replacement {
  proposedTemplate: string;      // plantilla de entities.ts: '{m}' u otra con '{m}' (6.4.5)
  generalized?: { suggestionId: SuggestionId; optionId: string; template: string };
  edited?: string;               // texto libre del revisor; '{m}' no se interpreta. [M]
}
// Texto final: 'editada' → edited; si no → resolve(generalized?.template ?? proposedTemplate),
// donde resolve() sustituye '{m}' por el marcador vigente de la entidad.

export interface Detection {
  id: DetectionId; docId: DocId; partId: PartId; start: number; end: number;
  text: string;                  // [M] === part.text.slice(start, end)
  type: DetectableType; role?: Role;
  source: DetectionSource; precedence: 1 | 2 | 3 | 4 | 5 | 6;
  ruleId?: string; caseEntityId?: CaseEntityId; variantClass?: VariantClass; nerLabel?: NerLabel;
  confidence: Confidence; score: number;
  canonicalKey: string;          // [M]
  status: DetectionStatus;
  entityId: EntityId;
  replacement: Replacement;
  label?: LabelHit; validator?: ValidatorResult;
  rejectReason?: RejectReason;   // solo si 'rechazada'
  decidedBy?: 'individual' | 'grupo';
  coveredBy?: SpanEditId;        // contenida en una edición de tramo: no se renderiza
  suggestionId?: SuggestionId;   // creada al aplicar esa sugerencia
}

// ===== Sección 6.4.4 Estado de revisión y acciones (bloque 10, línea 1237) =====
export interface ReviewState {
  docId: DocId;
  revision: number;                              // +1 en cada acción aceptada por el reductor
  detections: Record<DetectionId, Detection>;
  order: DetectionId[];                          // por (part.order, start)
  entities: Record<EntityId, Entity>;
  suggestions: Record<SuggestionId, Suggestion>;
  flags: Record<FlagId, Flag>;
  spanEdits: Record<SpanEditId, SpanEdit>;
  committed: boolean;                            // true tras el primer copiar o exportar (6.6.4)
  modelo: ModelProgress;                         // avance del modelo; lo actualiza el reductor con `incorporar_modelo` y la interfaz con 'plan_b' (6.4.8)
}
export type ReviewAction =
  | { kind: 'aceptar' | 'restablecer' | 'separar_mencion'; detectionId: DetectionId }
  | { kind: 'rechazar'; detectionId: DetectionId; reason?: RejectReason }
  | { kind: 'editar'; detectionId: DetectionId; text: string }
  | { kind: 'aceptar_entidad'; entityId: EntityId }
  | { kind: 'rechazar_entidad'; entityId: EntityId; reason?: RejectReason }
  | { kind: 'cambiar_rol'; entityId: EntityId; role: Role }       // persona: rol; organización: clase
  | { kind: 'cambiar_tipo'; detectionId: DetectionId; type: DetectableType }
  | { kind: 'especificar_documento'; entityId: EntityId; especifico: boolean }   // TI, CE, PPT, PEP: [DOCUMENTO_n] ⇄ [TI_n]…
  | { kind: 'unir_entidades'; fromId: EntityId; intoId: EntityId }
  | { kind: 'agregar_manual'; span: Span; type: DetectableType; role?: Role; propagate: boolean }
  | { kind: 'aplicar_sugerencia'; suggestionId: SuggestionId; optionId: string }
  | { kind: 'elegir_departamento'; suggestionId: SuggestionId; depCode: string }
  | { kind: 'descartar_sugerencia'; suggestionId: SuggestionId }
  | { kind: 'resolver_bandera'; flagId: FlagId; resolution: 'mantener' | 'reemplazar'; optionId?: string; text?: string }
  | { kind: 'incorporar_residuos'; residueRevision: number; candidates: DetectionCandidate[] }
  | { kind: 'incorporar_modelo'; ventana: number; ventanasTotales: number; delta: DetectionSet }   // resultados progresivos (6.11.2)
  | { kind: 'declarar_plan_b'; causa: PlanBCause };   // el modelo no terminó: se sigue con reglas y lista, y el informe lo declara

export type ReviewError = 'NO_ENCONTRADO' | 'TRAMO_INVALIDO' | 'SOLAPAMIENTO_PARCIAL'
  | 'ROL_INCOMPATIBLE' | 'ROL_FIJADO_EN_ASUNTO' | 'TIPO_NO_PERMITIDO' | 'DEPARTAMENTO_SIN_ELEGIR';
export type ReviewOutcome = { ok: true; state: ReviewState } | { ok: false; code: ReviewError };
export type ApplyReviewActionFn = (state: ReviewState, action: ReviewAction,
  ctx: {
    table: TableIndex; caseList: readonly CaseEntity[];
    // Cambio de contrato del integrador (regla 9, 30-oct): `doc` para agregar_manual e incorporar_residuos
    // (orden de lectura y validación del tramo); `ids` para crear detecciones y entidades. Sin ellos → TRAMO_INVALIDO.
    doc?: DocumentModel; ids?: IdSource;
  }) => ReviewOutcome;

// ===== Sección 6.4.5 Sugerencias de generalización (bloque 11, línea 1286) =====
export type SuggestionKind =
  | 'FECHA_A_MES_ANIO' | 'FECHA_NACIMIENTO_A_RANGO_EDAD' | 'EDAD_A_RANGO'
  | 'ROTULO_DOCUMENTO_A_GENERICO'   // «T.I.», «PPT», «PEP», «C.E.» → «documento de identidad»; nace APLICADA (marcador neutro por defecto)
  | 'MUNICIPIO_A_DEPARTAMENTO'      // municipio → «un municipio de [DEPARTAMENTO_n]»
  | 'DESPACHO_A_GENERICO';          // despacho o autoridad con municipio → forma genérica
export type GeneralizationKind = SuggestionKind | 'CARGO_A_GENERICO' | 'DIAGNOSTICO_A_GENERICO' | 'HECHO_A_GENERICO' | 'MENOR_A_GENERICO';
export interface SuggestionOption {
  id: string;                     // 'o1', 'o2'… dentro de la sugerencia o bandera
  kind: GeneralizationKind;
  template: string;               // [M] posible. '{m}' solo si el objetivo es una detección o hay depCode
  depCode?: string;               // '{m}' = marcador de la entidad DEP:<depCode>
}
export interface Suggestion {
  id: SuggestionId; kind: SuggestionKind;
  target: { kind: 'deteccion'; detectionId: DetectionId }                    // cambia Replacement.generalized
        | { kind: 'tramo'; span: Span; relatedDetectionId?: DetectionId };   // crea SpanEdit o Detection
  originalText: string;           // [M]
  options: SuggestionOption[];    // ≥ 1, en orden de preferencia
  prioridad?: 'recomendada' | 'opcional_ciudad_grande';   // MUNICIPIO_A_DEPARTAMENTO y DESPACHO_A_GENERICO
  placeOptions?: string[];        // homónimo sin resolver (≥ 2 códigos DANE de departamento)
  status: 'pendiente' | 'aplicada' | 'descartada';
  chosenOptionId?: string;
  // Contrato del integrador (regla 9, 30-oct; P0-6a de PB-3, B-7): edición de tramo de la sugerencia, sacada una sola
  // vez de IdSource y conservada aunque la sugerencia se deshaga (INV-R10), como Flag.spanEditId.
  spanEditId?: SpanEditId;
}

// ===== Sección 6.4.6 Banderas de revisión manual (bloque 12, línea 1325) =====
export type FlagReason = 'LISTA_CARGOS' | 'LISTA_DIAGNOSTICOS' | 'PATRON_CIE10' | 'LISTA_LLAMATIVOS'
  | 'ROTULO_TI' /* rótulo de T.I., NIP o registro civil */ | 'EXPRESION_MENOR' | 'RADICADO_EN_CITA' | 'MODELO_OTH';
export interface Flag {
  id: FlagId; type: FlagType; span: Span;
  text: string;                   // [M]
  reason: FlagReason;
  detectionId?: DetectionId;      // CITA_JURISPRUDENCIAL → el radicado; MENOR → la TI o el DOCUMENTO
  suggestionId?: SuggestionId;    // ROTULO_TI → la ROTULO_DOCUMENTO_A_GENERICO del mismo rótulo
  options: SuggestionOption[];    // texto genérico sugerido; vacío para CITA_JURISPRUDENCIAL
  acknowledged: boolean;
  resolution?: 'mantener' | 'reemplazar';
  spanEditId?: SpanEditId;        // si 'reemplazar' y no hay detección vinculada
}

// ===== Sección 6.4.7 Edición de tramo (bloque 13, línea 1347) =====
export interface SpanEdit {
  id: SpanEditId; span: Span;
  originalText: string;           // [M]
  text: string;                   // entra en la salida; nunca contiene '{m}'
  origin: { kind: 'sugerencia'; suggestionId: SuggestionId } | { kind: 'bandera'; flagId: FlagId };
}

// ===== Sección 6.4.8 Condición para copiar o exportar (bloque 14, línea 1360) =====
export interface ReminderConfirmation { biometricos: boolean; reservaLegal: boolean; estrategia: boolean; }
export type GateReason = 'PENDIENTES' | 'BANDERAS' | 'MODELO_EN_CURSO' | 'RESIDUOS_NO_EJECUTADA' | 'RESIDUOS_DESACTUALIZADA'
  | 'RESIDUOS_ENCONTRADOS' | 'DETECCIONES_NUEVAS' | 'RECORDATORIO';
/** Causa por la que se sigue con reglas y lista (plan B). 'respaldo_base' no es plan B: es el modelo x-base (3.3). */
export type PlanBCause = 'no_descargado' | 'desactivado' | 'fallo_carga' | 'memoria_insuficiente' | 'cancelado' | 'sin_tiempo';
/** Avance del modelo para la compuerta y la interfaz. El único estado que habilita la copia además de 'terminado' es 'plan_b'. */
export type ModelProgress =
  | { kind: 'en_curso'; ventanas: number; ventanasTotales: number }     // ventanasTotales 0 hasta que `ner` informa el total
  | { kind: 'terminado'; ventanas: number; respaldo: boolean }          // respaldo: lo hizo x-base
  | { kind: 'plan_b'; causa: PlanBCause; ventanas?: number; ventanasTotales?: number };   // declarado en el informe (6.8); ventanas: contrato del integrador, 30-oct (PB-6: «3 de 23»)
export interface ExportGate { ok: boolean; reasons: GateReason[]; }
export type ExportGateFn = (state: ReviewState, residue: ResidueResult | null, reminder: ReminderConfirmation) => ExportGate;
// ok ⇔ 0 detecciones 'pendiente' ∧ 0 banderas sin acknowledged
//      ∧ state.modelo.kind ∈ { 'terminado', 'plan_b' }          // «modelo terminado o plan B declarado en el informe»
//      ∧ residue ≠ null ∧ residue.revision === state.revision
//      ∧ residue.hits.length === 0 ∧ residue.newDetections === 0
//      ∧ las 3 casillas del recordatorio en true

// ===== Sección 6.5 Lista del caso (bloque 15, línea 1403) =====
export type CaseEntity = {
  id: CaseEntityId;
  name: string;                  // [M] como lo escribe el abogado, en NFC
  variants: CaseVariant[];       // generadas por caselist.ts (PB-1) + manuales
} & ({ kind: 'persona'; role: PersonRole } | { kind: 'organizacion'; role: OrgClass });

export interface CaseVariant {
  text: string;                  // [M] legible, con las tildes y mayúsculas del abogado
  class: VariantClass;
  confidence: Confidence;
  enabled: boolean;              // el abogado puede apagarla en la vista previa
  origin: 'generada' | 'manual'; // las manuales tienen clase 'exacta'
}

// ===== Sección 6.6.2 Entidad agrupada (bloque 16, línea 1487) =====
export interface Entity {
  id: EntityId;
  canonicalKey: string;          // [M]
  type: DetectableType;          // MUNICIPIO → 'DEPARTAMENTO'
  role?: Role;                   // persona: rol; organización: clase
  family: MarkerFamily;          // familyFor(type, role, { marcadorEspecifico })
  marcadorEspecifico: boolean;   // solo TI, CE, PPT, PEP: false (por defecto) → family 'DOCUMENTO'; true → su propia familia. Siempre false en los demás tipos
  marker?: string;               // [P] vigente; undefined si ninguna mención usa marcador
  markerState?: 'heredado' | 'vista_previa' | 'definitivo';
  caseEntityId?: CaseEntityId;
  mentions: DetectionId[];       // en orden de lectura
  sameHolderAs: EntityId[];      // simétrico
  display: string;               // [M] valor de reinserción propuesto (6.6.3)
}

// ===== Sección 6.6.3 Tabla de correspondencia (en claro, en memoria) (bloque 17, línea 1526) =====
export interface MappingTable {
  asuntoId: AsuntoId;
  counters: Partial<Record<MarkerFamily, number>>;   // último n asignado por familia
  entries: Record<string, MappingEntry>;              // clave = marcador exacto
  documents: DocumentRef[];
}
export interface MappingEntry {
  marker: string;                // [P] «[CC_1]»
  family: MarkerFamily; type: DetectableType; role?: Role;
  canonicalKey: string;          // [M]
  display: string;               // [M] valor que se reinserta
  originals: string[];           // [M] variantes vistas, sin repetir, en orden de aparición
  firstSeen: { docId: DocId; partKind: PartKind; partOrder: number; start: number };
  documents: DocId[];
  sameHolderAs: string[];        // marcadores del mismo titular
  caseEntityId?: CaseEntityId;
}
export interface DocumentRef { docId: DocId; label: string /* [P] */; source: DocumentSource; processedAt: IsoDateTime; }
/** Vista compacta que se envía al worker de detección. [M] */
export interface TableIndex {
  byKey: Record<string, string>;                      // canonicalKey → marcador
  counters: Partial<Record<MarkerFamily, number>>;
  documentCount: number;
}

// ===== Sección 6.7.1 Esquema de IndexedDB (bloque 18, línea 1602) =====
export interface AsuntoRecord {
  asuntoId: AsuntoId;            // [P] keyPath
  codigo: string;                // [P] índice único
  creado: IsoDateTime; actualizado: IsoDateTime;   // [P]
  encabezado: string;            // [P] cadena exacta con uso=almacen (6.7.2)
  iv: ArrayBuffer;               // 12 B; igual al iv del encabezado
  ct: ArrayBuffer;               // texto cifrado + etiqueta de 16 B; byteLength % 4096 === 16
}

// ===== Sección 6.7.3 Parámetros criptográficos y frase de paso (bloque 19, línea 1640) =====
export type PassphraseIssue = 'CORTA' | 'POCA_VARIEDAD' | 'SOLO_DIGITOS' | 'SECUENCIA' | 'CONTIENE_CODIGO' | 'FRASE_COMUN';
export type ValidatePassphraseFn = (pass: string, codigo: string) => PassphraseIssue[];   // vault/crypto.ts (PD-3)

// ===== Sección 6.7.4 Texto plano del registro y operaciones (bloque 20, línea 1651) =====
/** JSON UTF-8 dentro de ct; mismo contenido en IndexedDB y en .siglow. [M] */
export interface VaultPayload {
  formato: 'sig-low/tabla-plana'; v: 1;
  asunto: { asuntoId: AsuntoId; codigo: string; creado: IsoDateTime; actualizado: IsoDateTime };
  appVersion: string;
  table: MappingTable;
  caseList: CaseEntity[];        // la lista del caso viaja con su tabla (S-6.19)
  relleno: string;               // último campo: espacios hasta que los bytes UTF-8 del JSON sean múltiplo de 4096
}

// ===== Sección 6.7.5 Archivo exportado `.siglow` (bloque 21, línea 1679) =====
export interface SiglowFile {
  formato: 'sig-low/tabla'; v: 1;
  kdf: { alg: 'PBKDF2'; hash: 'SHA-256'; iteraciones: number; sal: string }
     | { alg: 'argon2id'; m: number; t: number; p: number; sal: string };   // reservado
  cifrado: { alg: 'AES-GCM'; iv: string; tagBits: 128 };
  encabezado: string;            // cadena exacta con uso=exportacion
  ct: string;                    // base64 del texto cifrado + etiqueta
}

// ===== Sección 6.8 Informe de anonimización (bloque 22, línea 1746) =====
export type ResidueMode = 'literal' | 'normalizado' | 'digitos' | 'variante';
/** 'usado' = modelo principal terminado; 'respaldo_base' = terminó el modelo de respaldo (x-base); el resto son causas de plan B (PlanBCause, 6.4.8). */
export type ModelState = 'usado' | 'respaldo_base' | PlanBCause;

/** [P] Formato externo: claves en español. */
export interface AnonymizationReport {
  formato: 'sig-low/informe'; v: 1;
  generado: string;                                       // ISO con -05:00
  app: { version: string; compilacion: string };          // compilacion = SHA-256 completo del index.html (el de «Acerca de»)
  motor: {
    reglas: { version: string };
    lista: { entidades: number; variantesActivas: number };
    modelo: { estado: ModelState; planB: boolean; id?: string; sha256?: string; ventanas?: number; ventanasTotales?: number };   // sha256 del manifiesto; planB ⇔ estado no es 'usado' ni 'respaldo_base'; con planB, ventanas < ventanasTotales o ausentes
  };
  asunto?: { codigo: string };                            // solo con la casilla marcada
  documento: { etiqueta: string; entrada: DocumentSource; partes: Array<{ tipo: PartKind; etiqueta: string; incluida: boolean }> };
  conteos: Array<{ tipo: DetectableType; detectadas: number; aceptadas: number; editadas: number; rechazadas: number; manuales: number;
    porFuente: Record<DetectionSource, number>; porConfianza: Record<Confidence, number> }>;
  marcadores: Array<{ familia: MarkerFamily; distintos: number; nuevos: number; heredados: number }>;
  rechazos: Array<{ tipo: DetectableType; motivo: RejectReason; cantidad: number }>;
  banderas: Array<{ tipo: FlagType; total: number; mantenidas: number; reemplazadas: number }>;
  sugerencias: Array<{ clase: SuggestionKind; aplicadas: number; descartadas: number; sinDecidir: number }>;
  edicionesDeTramo: number;
  aprobacionesPorGrupo: number;
  residuos: { resultado: 'sin_residuos'; valoresBuscados: number; modos: ResidueMode[]; ejecutada: string };
  metadatos: { categorias: MetadataCategory[] };
  advertencias: Array<{ codigo: ParseWarningCode; cantidad: number }>;
  recordatorio: { biometricos: true; reservaLegal: true; estrategia: true; confirmado: string };
  aCriterio: { rechazadas: number; banderasMantenidas: number; sugerenciasDescartadas: number; sugerenciasSinDecidir: number };
}

// ===== Sección 6.9 Archivo exportado, render y residuos (bloque 23, línea 1808) =====
export interface OutputSegment {
  outStart: number; outEnd: number;        // en OutputSection.text
  partStart: number; partEnd: number;      // en Part.text
  detectionId?: DetectionId;               // si el tramo es un reemplazo
  spanEditId?: SpanEditId;
}
export interface OutputSection {
  partId: PartId; kind: PartKind;
  label: string;                           // [P]
  text: string;                            // [M] hasta que la búsqueda de residuos da 0
  segments: OutputSegment[];               // cubren text sin huecos ni solapes
}
export interface RenderedOutput {
  docId: DocId; revision: number;
  sections: OutputSection[];               // solo partes con included, en orden canónico
  withHeadings: boolean;                   // sections.length > 1
}
/** render.ts (PB-4): aplica los reemplazos de derecha a izquierda (algoritmo en 7.13.1). */
export type RenderFn = (doc: DocumentModel, state: ReviewState) => RenderedOutput;
/** Texto único para copiar o exportar. Con withHeadings: por sección, la línea '=== ' + label + ' ===' y su texto,
 *  separadas por una línea vacía. Portapapeles: '\n'. Archivos: '\r\n'. */
export type JoinOutputFn = (out: RenderedOutput, eol: '\n' | '\r\n') => string;

export interface ResidueHit {
  sectionIndex: number; start: number; end: number;   // en la salida
  partId: PartId; partStart: number;                  // para volver a Revisión
  entityId: EntityId; mode: ResidueMode;
}
export interface ResidueResult {
  revision: number; ranAt: IsoDateTime; valuesSearched: number; modes: ResidueMode[];
  hits: ResidueHit[];                      // pasadas 1 y 2, y residuos de la 3 (7.13)
  newDetections: number;                   // detecciones nuevas de la pasada 3 (reglas y lista, sin modelo)
}
export interface ResidueRun { result: ResidueResult; nuevas: DetectionCandidate[]; }
/** residue.ts (PB-4). `detect` es la ida y vuelta al worker detect (+ fusionar con ner = null). */
export type RunResidueCheckFn = (doc: DocumentModel, state: ReviewState, out: RenderedOutput, ctx: {
  table: TableIndex; caseList: readonly CaseEntity[]; rules: RuleRegistry;
  detect: (tmp: DocumentModel) => Promise<DetectionSet>;
  // Cambio de contrato del integrador (regla 9, 30-oct, pedido de PB-4): originales [M] de las entidades heredadas
  // del asunto, por canonicalKey (7.13.2). Los rellena quien tiene la tabla del asunto en memoria (PC-5/PB-6).
  originals?: Readonly<Record<string, readonly string[]>>;
}) => Promise<ResidueRun>;

// ===== Sección 6.10 Reinserción (bloque 24, línea 1915) =====
export type MarkerMatchKind = 'exacto' | 'alterado' | 'desconocido';
export type AlterationKind =
  | 'delimitador'           // ( ) { } « » < > en lugar de [ ], o falta uno
  | 'sin_delimitador'       // «Demandante 1», «CC_1»
  | 'separador'             // espacio, guion, punto, «n.º», «No.», «#» o nada en lugar de _
  | 'mayusculas_minusculas' // [demandante_1]
  | 'sin_tilde'             // [DIRECCION_1]
  | 'espacios'              // [ DEMANDANTE_1 ]
  | 'sufijo_pegado';        // [DEMANDANTE_1]'s, [DEMANDANTES_1]

export interface MarkerMatch {
  id: ReinsertMatchId; start: number; end: number;   // en el texto canónico de la respuesta
  found: string;                        // el token tal como lo escribió la IA
  kind: MarkerMatchKind; alterations: AlterationKind[];   // vacío si exacto
  canonical?: string; family?: MarkerFamily; n?: number;  // «[DEMANDANTE_1]» si la etiqueta es reconocible
  inTable: boolean;
  proposal?: string;                    // [M] entry.display
}
export interface ReinsertionDecision { matchId: ReinsertMatchId; action: 'reemplazar' | 'dejar' | 'editar'; text?: string /* [M] */; }
export interface ReinsertionInput {
  response: string;                     // texto canónico de la respuesta
  table: MappingTable;
  expectedFrom: DocId | null;           // documento al que responde la IA; null → no se calculan faltantes (se avisa)
}
export interface ReinsertionResult {
  text: string;                         // [M] con datos reales; nunca se persiste
  matches: MarkerMatch[];
  alerts: { unknown: ReinsertMatchId[]; altered: ReinsertMatchId[]; missing: string[] };
  decisions: Record<string, ReinsertionDecision>;
  missingAcknowledged: boolean;
  ready: boolean;                       // alertas decididas y faltantes reconocidos
}
export type FindMarkersFn = (input: ReinsertionInput) => MarkerMatch[];
export type BuildReinsertionFn = (input: ReinsertionInput, matches: MarkerMatch[],
  decisions: Record<string, ReinsertionDecision>, missingAcknowledged: boolean) => ReinsertionResult;

// ===== Sección 6.11.1 Sobre común (bloque 25, línea 1967) =====
export interface WorkerRequest<K extends string, P> { v: 1; reqId: RequestId; kind: K; payload: P; }
export type WorkerResponse<R, P = never> =
  | { v: 1; reqId: RequestId; kind: 'progreso'; stage: Stage; done: number; total: number; unit: ProgressUnit }
  | { v: 1; reqId: RequestId; kind: 'parcial'; payload: P }                          // resultado intermedio: una ventana del modelo (6.11.3)
  | { v: 1; reqId: RequestId; kind: 'resultado'; payload: R }
  | { v: 1; reqId: RequestId; kind: 'error'; code: ErrorCode; retryable: boolean }   // sin texto
  | { v: 1; reqId: RequestId; kind: 'cancelado' };
export type Stage = 'lectura' | 'reglas' | 'lista' | 'generalizacion' | 'modelo_carga' | 'modelo' | 'fusion';
export type ProgressUnit = 'partes' | 'paginas' | 'ventanas' | 'bytes';
export type CancelRequest = WorkerRequest<'cancelar', { targetReqId: RequestId }>;   // cooperativa; cualquier worker la acepta
/** Error del sistema. message === code: nunca lleva contenido. */
export class SiglowError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) { super(code); this.name = 'SiglowError'; this.code = code; }
}

// ===== Sección 6.11.2 Worker `detect` (bloque 26, línea 1988) =====
export interface DetectOptions {
  referenceDate: IsoDate;          // fecha del día en America/Bogota; la edad usa antes la fecha del documento (7.8.3)
  rulesVersion: string;
  nerHighThreshold: number;        // valor inicial y bandas: 7.10.9 (PF-3 calibra)
  nerMinScore: number;             // corte de descarte del modelo: 7.10.9 (PF-3 calibra); 0,3 inicial, el mismo umbral del motor
}
export type DetectRequest =
  | WorkerRequest<'detectar', { sessionId: string; doc: DocumentModel; caseList: CaseEntity[]; table: TableIndex; options: DetectOptions }>
  | WorkerRequest<'fusionar', { sessionId: string; ner: Record<string, NerSpan[]> | null; nerEngineId: string;
      ventana?: number; ventanasTotales?: number }>   // una ventana del modelo; sin ventana: todo el resultado de una vez (pasada 3 y plan B: ner null)
  | WorkerRequest<'liberar', { sessionId: string }>
  | CancelRequest;
export interface DetectionSet {
  detections: Detection[]; entities: Entity[]; flags: Flag[]; suggestions: Suggestion[];
  spanEdits?: SpanEdit[];   // contrato del integrador, 30-oct (PB-6): ediciones del rótulo preaplicado (TI, CE, PPT, PEP)
}
export type DetectResult =
  | { kind: 'detectar'; set: DetectionSet; counts: { reglas: number; lista: number; banderas: number; sugerencias: number } }   // reglas y lista: aparecen en segundos
  | { kind: 'fusionar'; set: DetectionSet; ventana?: number }   // con `ventana`, solo el delta de esa ventana (6.4.4, incorporar_modelo)
  | { kind: 'liberar' };

// ===== Sección 6.11.3 Worker `ner` y motor de entidades (bloque 27, línea 2016) =====
export interface NerSpan { start: number; end: number; label: NerLabel; score: number; }   // posiciones canónicas de la parte
/** Parámetros de GLiNER-X (7.10). Los valores iniciales salen del manifiesto; PF-3 calibra el umbral. */
export interface NerOptions {
  windowTokens: number;            // 512 en total (incluye el prompt de etiquetas y </s>) ≈ 250 palabras (mT5: 1,95 subtokens por palabra en el corpus)
  overlapWords: number;            // 37 palabras (≈ 15 %); debe ser ≥ 2 × maxSpanWords para que ningún tramo propio de una ventana la desborde (7.10.5)
  maxSpanWords: 12;                // anchura máxima de tramo del grafo
  threshold: number;               // 0,3 inicial [calibrar en PF-3]
  labels: readonly ['person', 'organization', 'location'];   // person → PER, organization → ORG, location → LOC
  threads: number;                 // 4 a 8 con crossOriginIsolated; 1 sin él (×2 a ×2,5 más lento)
}
export interface NerLoadProgress {
  phase: 'verificando' | 'ensamblando' | 'cargando_runtime' | 'cargando_modelo' | 'calentando';
  done: number; total: number;     // bytes en las dos primeras fases y en cargando_modelo; 1 de 1 en las demás
}
export interface NerLoadResult {
  engineId: 'nulo' | 'gliner-x-large' | 'gliner-x-base';   // el id corto del manifiesto; nunca la ruta del repositorio de origen
  modelId: string | null; sha256: string | null;
  threads: number;                 // 0 en NullNerEngine
  crossOriginIsolated: boolean;
  labels: readonly NerLabel[]; decoder: 'gliner-spans' | 'ninguno';
  loadMs: number;                  // crear la sesión (medido: 2,6 s a 5,7 s)
  warmupWindowMs: number;          // duración de la ventana de calentamiento: base de la estimación de tiempo de 8.5
}
/** Una ventana ya procesada. `spans` cumple INV-R01 sobre `partId`; solo contiene los tramos de la zona propia de la ventana (7.10.5). */
export interface NerWindowResult { partId: PartId; windowIndex: number; windowTotal: number; spans: NerSpan[]; ms: number; }
export interface NerEngine {
  readonly engineId: NerLoadResult['engineId'];
  load(onProgress: (p: NerLoadProgress) => void): Promise<NerLoadResult>;
  /** Cuenta las ventanas sin ejecutar el modelo (función pura): permite el total, el progreso y el tiempo estimado antes de empezar. */
  planWindows(text: string, options: NerOptions): number;
  /** Procesa por ventanas; `onWindow` se llama al terminar cada una. Devuelve todos los tramos al final. Revisa `signal` entre ventanas. */
  detect(text: string, options: NerOptions, signal: AbortSignal, onWindow?: (w: NerWindowResult) => void): Promise<NerSpan[]>;
  dispose(): Promise<void>;       // libera la sesión de ORT-web; nunca hay dos sesiones grandes a la vez
}
/** GLiNER-X con ORT-web directo (el pipeline de Transformers.js no soporta GLiNER): divisor de palabras por regex Unicode, ventanas,
 *  decodificación de tramos con sigmoide, umbral y selección sin solapes. Código incorporado en src/core/ner/gliner/ (MIT, con el parche de mT5; 7.10). */
export type GlinerEngineCtor = new (manifest: ModelManifest) => NerEngine;
/** Plan B (respaldo en ejecución, no vía de cierre): reglas + lista del caso. load() resuelve sin descargar; planWindows() devuelve 0; detect() devuelve [] (AbortError si signal.aborted). */
export interface NullNerEngineShape extends NerEngine {
  readonly engineId: 'nulo';
  load(onProgress: (p: NerLoadProgress) => void): Promise<NerLoadResult>;
  planWindows(text: string, options: NerOptions): number;
  detect(text: string, options: NerOptions, signal: AbortSignal, onWindow?: (w: NerWindowResult) => void): Promise<NerSpan[]>;
  dispose(): Promise<void>;
}
export type NullNerEngineCtor = new () => NullNerEngineShape;

export type NerRequest =
  | WorkerRequest<'cargar', { manifest: ModelManifest }>
  | WorkerRequest<'detectar', { parts: Array<{ partId: PartId; text: string }>; options: NerOptions }>
  | WorkerRequest<'liberar', Record<string, never>>
  | CancelRequest;
export type NerResult =
  | { kind: 'cargar'; load: NerLoadResult }
  | { kind: 'detectar'; windows: number; ms: number }          // los tramos ya salieron en los `parcial`
  | { kind: 'liberar' };
export type NerPartial = { windowsDone: number; windowsTotal: number /* de todo el documento */; window: NerWindowResult };
export type NerResponse = WorkerResponse<NerResult, NerPartial>;

// ===== Sección 6.11.3 Worker `ner` y motor de entidades (bloque 28, línea 2084) =====
export interface ModelManifest {
  formato: 'sig-low/modelo'; v: 1;
  id: 'gliner-x-large' | 'gliner-x-base';    // id corto: es el que ve el informe y el código; la ruta de origen solo consta en créditos y licencias
  origen: string;                  // repositorio de origen; solo para créditos y licencias (4.6)
  familia: 'gliner';
  base: 'google/mt5-large' | 'google/mt5-base';
  cuantizacion: 'q8';
  etiquetas: readonly ['person', 'organization', 'location'];
  umbral: number;                  // 0,3 inicial [calibrar en PF-3]
  ventanaTokens: number; solapePalabras: number; maxTramoPalabras: 12;   // 512 / 37 / 12 (7.10.3)
  tokenizador: { prefijo: number; sufijo: number; cls: boolean };          // mT5: 0 / 1 / false (parche, 7.10.2)
  archivo: 'onnx/model_quantized.onnx';
  tamano: number; sha256: string;  // del archivo reensamblado
  trozos: Array<{ ruta: string; tamano: number; sha256: string }>;   // cada uno ≤ 24 MiB (25.165.824 B); el límite de Cloudflare es 25 MiB por archivo
  auxiliares: Array<{ ruta: 'tokenizer.json' | 'tokenizer_config.json' | 'gliner_config.json'; tamano: number; sha256: string }>;
  licencia: 'Apache-2.0';
  memoria: { wasmMb: number; jsMb: number; minimoDispositivoGb: number };   // 1474 / 586 / 8 en x-large [calibrar en PF-3]
}

// ===== Sección 6.11.4 Worker `io` (bloque 29, línea 2124) =====
export type IoRequest = WorkerRequest<'leer', {
  format: 'txt' | 'docx';          // por bytes mágicos y extensión; nunca por el nombre completo
  bytes: ArrayBuffer;              // transferido
  docId: DocId; label: string;     // «Documento N»
  limits: IoLimits;
}>;
export type IoResult = { kind: 'leer'; doc: DocumentModel };

// ===== Sección 6.11.5 PDF (adaptador sobre el worker de pdf.js) (bloque 30, línea 2136) =====
/** src/io/pdf-read.ts (PE-4); rechaza con SiglowError(code). */
export type ReadPdfFn = (bytes: ArrayBuffer, ctx: { docId: DocId; label: string; limits: IoLimits },
  onProgress: (done: number, total: number) => void /* páginas */, signal: AbortSignal) => Promise<DocumentModel>;

// ===== Sección 6.11.7 Catálogo de códigos de error (bloque 31, línea 2155) =====
export type ErrorCode =
  | 'ENTRADA_INVALIDA' | 'SESION_DESCONOCIDA' | 'TIEMPO_AGOTADO' | 'MEMORIA' | 'ERROR_INTERNO'      // generales
  | 'ARCHIVO_VACIO' | 'ARCHIVO_DEMASIADO_GRANDE' | 'FORMATO_NO_ADMITIDO' | 'CONTENEDOR_CFB'          // lectura
  | 'ZIP_INVALIDO' | 'DEMASIADAS_ENTRADAS' | 'DESCOMPRIMIDO_EXCEDE_LIMITE' | 'PARTE_XML_EXCEDE_LIMITE'
  | 'PARTE_TRUNCADA' | 'DTD_NO_PERMITIDA' | 'XML_INVALIDO' | 'SIN_DOCUMENTO_PRINCIPAL'
  | 'OOXML_STRICT_NO_ADMITIDO' | 'PDF_CON_CONTRASENA' | 'PDF_SIN_CAPA_TEXTO' | 'PDF_DANADO'
  | 'MODELO_NO_DESCARGADO' | 'MODELO_INTEGRIDAD' | 'BACKEND_NO_DISPONIBLE' | 'CUOTA_EXCEDIDA'          // modelo
  | 'CONTRASENA_O_ARCHIVO' | 'FORMATO_DESCONOCIDO' | 'VERSION_MAS_RECIENTE' | 'KDF_NO_ADMITIDO'      // bóveda
  | 'PARAMETROS_FUERA_DE_RANGO' | 'ARCHIVO_ALTERADO' | 'ASUNTO_EXISTENTE' | 'CODIGO_INVALIDO' | 'IDB_NO_DISPONIBLE'
  | 'CONTEXTO_NO_SEGURO' | 'SIN_SERVICE_WORKER';                                                       // plataforma

// ===== Sección 6.13 Archivos de datos empaquetados (bloque 32, línea 2207) =====
/** data/divipola.json: DIVIPOLA del DANE (fuente y licencia: 4.3), sin coordenadas. Formato único, citado por 7.7 y 7.10.8. */
export interface DivipolaRow {
  dep: string;          // código del departamento, 2 dígitos
  depNombre: string;    // tal como viene en el CSV
  mun: string;          // código del municipio, 5 dígitos
  munNombre: string;    // tal como viene en el CSV
  tipo: string;         // municipio, isla o área no municipalizada (texto del CSV) [VERIFICAR]
  capital: boolean;     // Bogotá, D.C. y capitales de departamento → prioridad 'opcional_ciudad_grande'
}
export type DivipolaFile = DivipolaRow[];
/** Índices construidos al empaquetar; las claves son vistas 'lista' (minúsculas, sin tildes). */
export interface DivipolaIndex {
  porNombre: Record<string, DivipolaRow[]>;   // nombre o alias de municipio → filas (más de una = homónimo)
  departamentos: Record<string, string>;      // nombre o alias de departamento → código («valle» → 76, «bogota» → 11)
  ambiguos: string[];                         // nombres que exigen contexto fuerte (7.7.1)
}
/** data/divipola_alias.json: alias → nombre oficial o código. data/municipios_ambiguos.json: string[] (7.7.1). */
export type FrasesComunesFile = string[];     // data/frases-comunes.json: ≤ 2000 frases en minúsculas, sin diacríticos, espacios colapsados
