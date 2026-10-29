// Tipos copiados textualmente de la sección 6 del plan (6.1.2, 6.1.4, 6.2, 6.4.1 y 6.4.2).
// Provisional (regla 2 de 9.1): se borra al rebasar sobre main cuando exista src/core/types.ts;
// si hay diferencia, gana types.ts.

type Brand<T, B extends string> = T & { readonly __brand: B };
export type PartId = Brand<string, 'PartId'>;
export type CaseEntityId = Brand<string, 'CaseEntityId'>;

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
export type NerLabel = 'PER' | 'ORG' | 'LOC' | 'OTH' | 'DATE';

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
}
