// Tipos de la sección 6 del plan v1.1, copiados textualmente para PG-4 (arranque anticipado, regla 2 de 9.1).
// Se borra al rebasar sobre main cuando exista src/core/types.ts; si hay diferencia, gana types.ts.
// Fuentes: 6.1.4 (ids), 6.2 (enumeraciones), 6.4.1, 6.4.2, 6.4.5, 6.4.6 y 6.13.

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

export type Confidence = 'alta' | 'media' | 'baja';
export type DetectionSource = 'manual' | 'lista' | 'regla' | 'modelo';

export type PartKind = 'encabezado' | 'cuerpo' | 'pie' | 'nota_pie' | 'nota_final' | 'comentario' | 'anotacion_pdf' | 'pagina_pdf';
export type VariantClass = 'exacta' | 'sin_tildes' | 'mayusculas' | 'apellidos' | 'apellido_suelto' | 'nombre_suelto'
  | 'iniciales' | 'posesivo' | 'razon_social_sin_sufijo' | 'sigla';
export type ValidatorName = 'DV_NIT' | 'RADICADO' | 'LUHN' | 'NDC' | 'CORREO' | 'FECHA';
/** El modelo principal (GLiNER-X) solo produce PER, ORG y LOC (person, organization, location); OTH y DATE quedan previstos para motores futuros y ningún motor de v1.0 los emite. */
export type NerLabel = 'PER' | 'ORG' | 'LOC' | 'OTH' | 'DATE';

// ---- 6.4.1
export interface Span { partId: PartId; start: number; end: number; }
/** Rótulo junto al dato («C.C.», «radicado»). [P] labelId del catálogo de 7.2.1. */
export interface LabelHit { labelId: string; start: number; end: number; }
/** Un validador que falla baja la confianza; nunca descarta. */
export interface ValidatorResult { name: ValidatorName; passed: boolean; }

// ---- 6.4.2
export interface DetectionCandidate {
  partId: PartId; start: number; end: number;
  type: DataType;                // FlagType solo si el detector emite una bandera
  role?: Role;
  source: Exclude<DetectionSource, 'manual'>;
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
export interface MergedCandidate extends DetectionCandidate {
  precedence: 1 | 2 | 3 | 4 | 5 | 6;
  extended?: boolean;     // lista extendida por el modelo
  fragment?: boolean;     // remanente de regla sin patrón completo
  holderDigits?: string;  // NIT que absorbió una CC: dígitos de la CC (7.12.3)
}

// ---- 6.4.5
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
}

// ---- 6.4.6
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

// ---- 6.13
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
