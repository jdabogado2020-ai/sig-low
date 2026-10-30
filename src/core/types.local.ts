// Copia textual de los contratos de la sección 6 que usa merge.ts (PB-2, arranque anticipado).
// Se borra al rebasar sobre main cuando exista src/core/types.ts; si hay diferencia, gana types.ts.

// 6.1.2
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

// 6.1.4
type Brand<T, B extends string> = T & { readonly __brand: B };
export type DocId = Brand<string, 'DocId'>;  export type PartId = Brand<string, 'PartId'>;
export type CaseEntityId = Brand<string, 'CaseEntityId'>;

// 6.2
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

export type Confidence = 'alta' | 'media' | 'baja';
export type DetectionSource = 'manual' | 'lista' | 'regla' | 'modelo';

export type PartKind = 'encabezado' | 'cuerpo' | 'pie' | 'nota_pie' | 'nota_final' | 'comentario' | 'anotacion_pdf' | 'pagina_pdf';
export type VariantClass = 'exacta' | 'sin_tildes' | 'mayusculas' | 'apellidos' | 'apellido_suelto' | 'nombre_suelto'
  | 'iniciales' | 'posesivo' | 'razon_social_sin_sufijo' | 'sigla';
export type ValidatorName = 'DV_NIT' | 'RADICADO' | 'LUHN' | 'NDC' | 'CORREO' | 'FECHA';
/** El modelo principal (GLiNER-X) solo produce PER, ORG y LOC (person, organization, location); OTH y DATE quedan previstos para motores futuros y ningún motor de v1.0 los emite. */
export type NerLabel = 'PER' | 'ORG' | 'LOC' | 'OTH' | 'DATE';

// 6.3
export interface Part {
  id: PartId; docId: DocId; kind: PartKind;
  label: string;                 // [P] etiqueta neutra (6.3.2)
  order: number;                 // 0..n-1 en orden de lectura canónico
  index: number;                 // 1..k dentro de su tipo
  page?: number;                 // solo pagina_pdf y anotacion_pdf
  text: string;                  // [M] texto canónico (6.1.1)
  included: boolean;             // casilla del panel de partes; por defecto true
}

// 6.4.1
/** Rótulo junto al dato («C.C.», «radicado»). [P] labelId del catálogo de 7.2.1. */
export interface LabelHit { labelId: string; start: number; end: number; }
/** Un validador que falla baja la confianza; nunca descarta. */
export interface ValidatorResult { name: ValidatorName; passed: boolean; }

// 6.4.2
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
