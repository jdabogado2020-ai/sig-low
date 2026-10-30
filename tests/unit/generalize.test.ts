// T-MO-08 · Sugerencias, banderas y paso a [DOCUMENTO_n] (7.7, 7.8) · PG-4.
// Los casos de R-MUN-*, R-DESP-01, R-DEP-01, R-EDAD-01, R-CAR-01, R-CIE-01, R-DIAG-01, R-LLA-01, R-MEN-01 y R-CIT-01 vienen del laboratorio
// regexlab/07b_final (cases.mjs, 586 casos, 0 fallos) y aquí se ejecutan contra la implementación de producción. Solo datos ficticios.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DIVIPOLA, buildDivipolaIndex, candidateFromLoc, departamentoPorNombre, departamentosDeRadicados, detectPlaces, edadCumplida, edadEnLetras, esCapital,
  formasDeNombre, generalize, getDivipolaIndex, isCitation, mesYAnioDeClave, municipiosPorNombre, nombreDepartamento, prioridadDe, rangoDeEdad, resolvePlace,
} from '../../src/core/generalize.ts';
import type { GenDetection, GeneralizeInput, GeneralizeResult } from '../../src/core/generalize.ts';
import type {
  DataType, DetectionCandidate, DetectionId, FlagReason, FlagType, IdSource, PartId, Span, Suggestion, SuggestionKind,
} from '../../src/core/types.ts';
import cargosJson from '../../data/cargos.json';
import cie10Json from '../../data/cie10-patron.json';
import diagnosticosJson from '../../data/diagnosticos.json';
import llamativosJson from '../../data/llamativos.json';
import menoresJson from '../../data/menores.json';

void buildDivipolaIndex;
// Casos del laboratorio regexlab/07b_final (cases.mjs), generados; no editar a mano.
export const CASOS: Record<string, { pos: [string, string, Record<string, unknown>?][]; neg: [string, string][] }> = {
 "R-MUN-01": {
  "pos": [
   [
    "residente en el municipio de Granada (Meta)",
    "el municipio de Granada (Meta)",
    {
     "key": "DEP:50",
     "template": "un municipio de {m}",
     "conf": "alta",
     "prioridad": "recomendada"
    }
   ],
   [
    "oriunda del municipio de Cartago",
    "del municipio de Cartago",
    {
     "key": "DEP:76",
     "template": "de un municipio de {m}",
     "prioridad": "recomendada"
    }
   ],
   [
    "vive en la ciudad de Medellín",
    "la ciudad de Medellín",
    {
     "key": "DEP:05",
     "template": "un municipio de {m}",
     "prioridad": "opcional_ciudad_grande"
    }
   ],
   [
    "MUNICIPIO DE LA UNIÓN (NARIÑO)",
    "MUNICIPIO DE LA UNIÓN (NARIÑO)",
    {
     "key": "DEP:52"
    }
   ],
   [
    "se trasladó al municipio de Florencia, Caquetá",
    "al municipio de Florencia, Caquetá",
    {
     "key": "DEP:18",
     "template": "a un municipio de {m}",
     "prioridad": "opcional_ciudad_grande"
    }
   ],
   [
    "en la ciudad de Bogotá",
    "la ciudad de Bogotá",
    {
     "key": "DEP:11",
     "template": "{m}",
     "prioridad": "opcional_ciudad_grande"
    }
   ],
   [
    "el municipio de Granada",
    "el municipio de Granada",
    {
     "key": "LUGAR:granada",
     "conf": "baja",
     "prioridad": "recomendada"
    }
   ]
  ],
  "neg": [
   [
    "el municipio de residencia",
    "no está en la DIVIPOLA"
   ],
   [
    "la ciudad de los Ejemplos",
    "no está en la DIVIPOLA"
   ],
   [
    "el Municipio de Ejemplópolis demandado",
    "fuera de la DIVIPOLA"
   ],
   [
    "una población de 8.000 habitantes",
    "sin nombre"
   ]
  ]
 },
 "R-MUN-02": {
  "pos": [
   [
    "vecina de Granada, Meta",
    "Granada, Meta",
    {
     "key": "DEP:50"
    }
   ],
   [
    "residente en Cartago",
    "Cartago",
    {
     "key": "DEP:76",
     "conf": "alta"
    }
   ],
   [
    "cédula expedida en Medellín",
    "Medellín",
    {
     "key": "DEP:05"
    }
   ],
   [
    "natural de Florencia (Caquetá)",
    "Florencia (Caquetá)",
    {
     "key": "DEP:18"
    }
   ],
   [
    "domiciliado en Bogotá, D.C.",
    "Bogotá, D.C.",
    {
     "key": "DEP:11",
     "template": "{m}"
    }
   ],
   [
    "residente en Antioquia",
    "Antioquia",
    {
     "key": "DEP:05",
     "template": "{m}"
    }
   ],
   [
    "residente en Granada",
    "Granada",
    {
     "key": "LUGAR:granada",
     "conf": "baja"
    }
   ],
   [
    "vecino de San José del Guaviare",
    "San José del Guaviare",
    {
     "key": "DEP:95",
     "prioridad": "opcional_ciudad_grande"
    }
   ],
   [
    "residente en Medellín Antioquia",
    "Medellín",
    {
     "key": "DEP:05"
    }
   ]
  ],
  "neg": [
   [
    "residente en la Calle 10",
    "no es municipio"
   ],
   [
    "vecina de la señora Florencia Ejemplo",
    "no hay lugar tras el contexto"
   ],
   [
    "es natural de esperar",
    "minúscula"
   ],
   [
    "nacida en 1991",
    "cifra"
   ],
   [
    "vecina de Florencia Ejemplo, la testigo",
    "nombre y apellido (mayúscula que no es departamento)"
   ]
  ]
 },
 "R-MUN-03": {
  "pos": [
   [
    "C.C. 10.000.001 de Cartago",
    "Cartago",
    {
     "key": "DEP:76"
    }
   ],
   [
    "C.C. No. 41.000.001 de Medellín",
    "Medellín",
    {
     "key": "DEP:05"
    }
   ],
   [
    "Calle 10 # 00-20, Cartago",
    "Cartago",
    {
     "key": "DEP:76"
    }
   ],
   [
    "Carrera 7 # 00-30 Sur, Bogotá, D.C.",
    "Bogotá, D.C.",
    {
     "key": "DEP:11"
    }
   ],
   [
    "T.I. 1.000.000.017 de La Unión (Nariño)",
    "La Unión (Nariño)",
    {
     "key": "DEP:52"
    }
   ]
  ],
  "neg": [
   [
    "C.C. 10.000.001 de 2026",
    "no hay municipio"
   ],
   [
    "Calle 10 # 00-20, apartamento 3",
    "no hay municipio"
   ],
   [
    "C.C. 41.000.001 de la señora",
    "no hay municipio"
   ],
   [
    "Rad. 2026-00123 de Cartago",
    "el ancla no es identificación ni dirección"
   ]
  ]
 },
 "R-MUN-04": {
  "pos": [
   [
    "Granada (Meta)",
    "Granada (Meta)",
    {
     "key": "DEP:50"
    }
   ],
   [
    "Cartago, Valle del Cauca",
    "Cartago, Valle del Cauca",
    {
     "key": "DEP:76"
    }
   ],
   [
    "La Unión - Nariño",
    "La Unión - Nariño",
    {
     "key": "DEP:52"
    }
   ],
   [
    "Florencia (Caquetá)",
    "Florencia (Caquetá)",
    {
     "key": "DEP:18"
    }
   ],
   [
    "residente en Granada, Meta",
    "Granada, Meta",
    {
     "key": "DEP:50"
    }
   ]
  ],
  "neg": [
   [
    "Victoria (2020)",
    "no hay departamento"
   ],
   [
    "Florencia, la testigo, dijo",
    "no hay departamento"
   ],
   [
    "Granada (España)",
    "no es departamento colombiano"
   ],
   [
    "Granada (Caquetá)",
    "el departamento no corresponde"
   ]
  ]
 },
 "R-MUN-05": {
  "pos": [
   [
    "los hechos ocurrieron en Medellín",
    "Medellín",
    {
     "key": "DEP:05",
     "conf": "media",
     "prioridad": "opcional_ciudad_grande"
    }
   ],
   [
    "Medellín, 14 de marzo de 2026",
    "Medellín",
    {
     "key": "DEP:05"
    }
   ],
   [
    "firmado en Villavicencio el lunes",
    "Villavicencio",
    {
     "key": "DEP:50",
     "prioridad": "opcional_ciudad_grande"
    }
   ],
   [
    "UBATÉ, 2 de febrero de 2026",
    "UBATÉ",
    {
     "key": "DEP:25",
     "prioridad": "recomendada"
    }
   ],
   [
    "En Ubaté se celebró el contrato",
    "Ubaté",
    {
     "key": "DEP:25"
    }
   ]
  ],
  "neg": [
   [
    "una victoria en Granada",
    "homónimo"
   ],
   [
    "celebraron en Victoria",
    "nombre común (lista curada)"
   ],
   [
    "como en Cartago",
    "nombre común (lista curada)"
   ],
   [
    "en la Unión Europea",
    "minúscula"
   ],
   [
    "Medellín es grande",
    "encabezado sin fecha"
   ],
   [
    "Victoria Ejemplo declaró ante el despacho",
    "inicio de línea sin fecha"
   ],
   [
    "confió en Vergara para el negocio",
    "apellido (lista curada)"
   ]
  ]
 },
 "R-DESP-01": {
  "pos": [
   [
    "Juzgado Tercero Civil del Circuito de Cartago",
    "Juzgado Tercero Civil del Circuito de Cartago",
    {
     "options": [
      "Juzgado Tercero Civil del Circuito de un municipio de {m} [DEP:76]",
      "un juzgado civil del circuito"
     ],
     "prioridad": "recomendada"
    }
   ],
   [
    "Juzgado 3 Civil del Circuito de Ubaté",
    "Juzgado 3 Civil del Circuito de Ubaté",
    {
     "options": [
      "Juzgado 3 Civil del Circuito de un municipio de {m} [DEP:25]",
      "un juzgado civil del circuito"
     ],
     "prioridad": "recomendada"
    }
   ],
   [
    "JUEZ CIVIL MUNICIPAL DE MEDELLÍN (REPARTO)",
    "JUEZ CIVIL MUNICIPAL DE MEDELLÍN",
    {
     "options": [
      "JUEZ CIVIL MUNICIPAL DE un municipio de {m} [DEP:05]",
      "un juez civil municipal"
     ],
     "prioridad": "opcional_ciudad_grande"
    }
   ],
   [
    "Juzgado Promiscuo Municipal de Granada",
    "Juzgado Promiscuo Municipal de Granada",
    {
     "options": [
      "Juzgado Promiscuo Municipal de un municipio de {m} [DEP:05]",
      "Juzgado Promiscuo Municipal de un municipio de {m} [DEP:25]",
      "Juzgado Promiscuo Municipal de un municipio de {m} [DEP:50]",
      "un juzgado promiscuo municipal"
     ],
     "prioridad": "recomendada"
    }
   ],
   [
    "ante la Alcaldía Municipal de Ubaté",
    "Alcaldía Municipal de Ubaté",
    {
     "options": [
      "Alcaldía Municipal de un municipio de {m} [DEP:25]",
      "una alcaldía municipal"
     ]
    }
   ],
   [
    "Tribunal Superior del Distrito Judicial de Bogotá",
    "Tribunal Superior del Distrito Judicial de Bogotá",
    {
     "options": [
      "Tribunal Superior del Distrito Judicial de {m} [DEP:11]",
      "un tribunal superior del distrito judicial"
     ],
     "prioridad": "opcional_ciudad_grande"
    }
   ],
   [
    "Juzgado Primero Civil Municipal de Pequeñas Causas y Competencia Múltiple de Villavicencio",
    "Juzgado Primero Civil Municipal de Pequeñas Causas y Competencia Múltiple de Villavicencio",
    {
     "options": [
      "Juzgado Primero Civil Municipal de Pequeñas Causas y Competencia Múltiple de un municipio de {m} [DEP:50]",
      "un juzgado civil municipal de pequeñas causas y competencia múltiple"
     ],
     "prioridad": "opcional_ciudad_grande"
    }
   ]
  ],
  "neg": [
   [
    "el juzgado admitió la demanda de Cartago",
    "palabra ajena al nombre del despacho"
   ],
   [
    "Juzgado Tercero Civil del Circuito",
    "sin municipio"
   ],
   [
    "la Alcaldía Mayor",
    "sin municipio"
   ],
   [
    "Tribunal Administrativo de Antioquia",
    "departamento, no municipio"
   ],
   [
    "el juzgado de conocimiento",
    "sin municipio"
   ]
  ]
 },
 "R-DEP-01": {
  "pos": [
   [
    "en el departamento del Meta",
    "Meta",
    {
     "key": "DEP:50"
    }
   ],
   [
    "Departamento de Antioquia",
    "Antioquia",
    {
     "key": "DEP:05"
    }
   ],
   [
    "depto. de Caldas",
    "Caldas",
    {
     "key": "DEP:17"
    }
   ],
   [
    "DEPARTAMENTO DE NARIÑO",
    "NARIÑO",
    {
     "key": "DEP:52"
    }
   ],
   [
    "departamento del Valle",
    "Valle",
    {
     "key": "DEP:76"
    }
   ]
  ],
  "neg": [
   [
    "Departamento Administrativo de la Función Pública",
    "no es departamento territorial"
   ],
   [
    "el departamento de recursos humanos",
    "minúscula"
   ],
   [
    "Simón Bolívar",
    "sin rótulo"
   ],
   [
    "la Universidad de Antioquia",
    "sin rótulo"
   ]
  ]
 },
 "R-EDAD-01": {
  "pos": [
   [
    "Ana Ficticia, de 34 años, vecina",
    "de 34 años",
    {
     "key": "EDAD:34"
    }
   ],
   [
    "tiene 34 años de edad",
    "34 años de edad",
    {
     "key": "EDAD:34"
    }
   ],
   [
    "un niño de 8 años",
    "de 8 años",
    {
     "key": "EDAD:8",
     "ctx": "menor"
    }
   ],
   [
    "edad: 61 años",
    "61 años",
    {
     "key": "EDAD:61"
    }
   ],
   [
    "de treinta y cuatro (34) años",
    "de treinta y cuatro (34) años",
    {
     "key": "EDAD:34"
    }
   ],
   [
    "bebé de 8 meses de edad",
    "de 8 meses de edad",
    {
     "key": "EDAD:0",
     "ctx": "menor"
    }
   ]
  ],
  "neg": [
   [
    "hace 34 años vive allí",
    "tiempo transcurrido"
   ],
   [
    "pena de 34 años de prisión",
    "pena"
   ],
   [
    "durante 10 años trabajó",
    "duración"
   ],
   [
    "más de 18 años",
    "umbral legal"
   ],
   [
    "con 34 años de servicio",
    "antigüedad"
   ],
   [
    "un contrato de un año",
    "duración en singular"
   ]
  ]
 },
 "R-CAR-01": {
  "pos": [
   [
    "la gerente general de [EMPRESA_1] firmó",
    "la gerente general",
    {
     "options": [
      "una directiva",
      "una representante"
     ]
    }
   ],
   [
    "el rector de la Universidad Ejemplo",
    "el rector",
    {
     "options": [
      "un directivo",
      "un representante"
     ]
    }
   ],
   [
    "el alcalde de Ejemplópolis",
    "el alcalde",
    {
     "options": [
      "un funcionario",
      "una autoridad"
     ]
    }
   ],
   [
    "la directora de Talento Humano de Ferretería Ejemplo",
    "la directora",
    {
     "options": [
      "una directiva",
      "una representante"
     ]
    }
   ],
   [
    "como representante legal de Ferretería Ejemplo S.A.S.",
    "como representante legal",
    {
     "options": [
      "como directivo",
      "como directiva"
     ]
    }
   ],
   [
    "el gerente de Ferretería Ejemplo quiere conciliar",
    "el gerente",
    {
     "options": [
      "un directivo",
      "un representante"
     ]
    }
   ]
  ],
  "neg": [
   [
    "el gerente firmó el contrato",
    "sin «de <entidad>»"
   ],
   [
    "el Presidente de la República",
    "cargo nacional excluido"
   ],
   [
    "la jefa de hogar",
    "minúscula tras «de»"
   ],
   [
    "el director de tesis",
    "minúscula tras «de»"
   ],
   [
    "el juez de tutela",
    "juez fuera de la lista"
   ]
  ]
 },
 "R-CIE-01": {
  "pos": [
   [
    "Dx: E11.9 diabetes mellitus",
    "E11.9",
    {}
   ],
   [
    "diagnóstico CIE-10 G35",
    "G35",
    {}
   ],
   [
    "con impresión diagnóstica F32.1",
    "F32.1",
    {}
   ],
   [
    "código CIE10 Q90.9 (síndrome)",
    "Q90.9",
    {}
   ],
   [
    "patología de base I10",
    "I10",
    {}
   ],
   [
    "Dx: E119 diabetes mellitus",
    "E119",
    {}
   ],
   [
    "diagnóstico CIE10: I10X",
    "I10X",
    {}
   ],
   [
    "Dx: U07.1 confirmado",
    "U07.1",
    {}
   ]
  ],
  "neg": [
   [
    "Sentencia C-748 de 2011",
    "guion tras la letra"
   ],
   [
    "la Torre A12 donde le dieron el diagnóstico",
    "rótulo de dirección antes del código"
   ],
   [
    "El radicado T76 del sistema",
    "sin contexto clínico"
   ],
   [
    "formulario F12 del diagnóstico",
    "rótulo de formulario"
   ],
   [
    "providencia SC5686-2018",
    "pegado a otras letras"
   ],
   [
    "vehículo de placa ABC123 y moto XYZ12D, diagnóstico pendiente",
    "placas: pegado a otras letras"
   ]
  ]
 },
 "R-DIAG-01": {
  "pos": [
   [
    "padece una enfermedad huérfana diagnosticada",
    "enfermedad huérfana",
    {
     "options": [
      "una enfermedad de baja prevalencia"
     ]
    }
   ],
   [
    "síndrome de Ejemplo-Prueba",
    "síndrome de Ejemplo-Prueba",
    {}
   ],
   [
    "diagnóstico de fibrosis quística",
    "fibrosis quística",
    {}
   ],
   [
    "síndrome de dificultad respiratoria aguda",
    "síndrome de dificultad respiratoria aguda",
    {}
   ],
   [
    "ENFERMEDAD RARA",
    "ENFERMEDAD RARA",
    {}
   ]
  ],
  "neg": [
   [
    "las enfermedades huérfanas en Colombia",
    "plural genérico"
   ],
   [
    "una enfermedad general",
    "no es diagnóstico raro"
   ],
   [
    "el síndrome",
    "sin especificar"
   ],
   [
    "síndrome de que todo falla",
    "conector"
   ]
  ]
 },
 "R-LLA-01": {
  "pos": [
   [
    "fue víctima de homicidio",
    "homicidio",
    {}
   ],
   [
    "el accidente de tránsito en el que murieron dos personas",
    "accidente de tránsito",
    {}
   ],
   [
    "el video se hizo viral en redes sociales",
    "se hizo viral",
    {}
   ],
   [
    "el caso salió en noticias nacionales",
    "noticias",
    {}
   ],
   [
    "un incendio destruyó la bodega",
    "incendio",
    {}
   ],
   [
    "fue secuestrada en 2020",
    "secuestrada",
    {}
   ]
  ],
  "neg": [
   [
    "se decretó el embargo y secuestro del inmueble",
    "medida cautelar"
   ],
   [
    "póliza contra incendio y terremoto",
    "cobertura de seguro"
   ],
   [
    "número único de noticia criminal",
    "término procesal"
   ],
   [
    "accidente de tránsito sin lesionados",
    "sin fallecidos"
   ],
   [
    "carga viral indetectable",
    "término médico"
   ],
   [
    "prensa hidráulica de la fábrica",
    "máquina"
   ]
  ]
 },
 "R-MEN-01": {
  "pos": [
   [
    "la niña Ejemplo, de 8 años,",
    "la niña",
    {}
   ],
   [
    "el adolescente fue atendido",
    "el adolescente",
    {}
   ],
   [
    "su hijo menor de edad",
    "su hijo menor",
    {}
   ],
   [
    "el NNA Ejemplo",
    "el NNA",
    {}
   ],
   [
    "la menor fue valorada",
    "la menor",
    {}
   ],
   [
    "es menor de edad",
    "menor de edad",
    {}
   ]
  ],
  "neg": [
   [
    "proceso de menor cuantía",
    "cuantía"
   ],
   [
    "en la menor medida posible",
    "medida"
   ],
   [
    "los derechos de los niños, niñas y adolescentes prevalecen",
    "fórmula legal"
   ],
   [
    "el menor de los males",
    "comparativo"
   ],
   [
    "Sistema de Responsabilidad Penal para Adolescentes",
    "nombre del sistema"
   ],
   [
    "atendido en la Clínica del Niño",
    "nombre propio"
   ]
  ]
 }
} as never;
export const CASOS_CITA: [string, boolean][] = [["Consejo de Estado, Sección Segunda, sentencia del 3 de mayo de 2021, rad. 11001-03-15-999-2020-01234-00.",true],["Cfr. Corte Suprema de Justicia, Sala de Casación Civil, radicado 11001-03-15-999-2020-01234-00, M.P. Ficticio Prueba.",true],["como lo reiteró el Tribunal en el expediente 11001-03-15-999-2020-01234-00",true],["ver radicado 11001-03-15-999-2020-01234-00 (STC0000-2026)",true],["Referencia: Acción de tutela.\nRadicado: 11001-03-15-999-2020-01234-00",false],["en el presente proceso, radicado 11001-03-15-999-2020-01234-00, se dispuso",false],["Proceso No. 11001-03-15-999-2020-01234-00",false],["radicado 11001-03-15-999-2020-01234-00 del Juzgado Tercero Civil",false]];
export const NEGATIVOS_GLOBALES: string[] = [
 "De conformidad con el artículo 86 de la Constitución Política y el Decreto 2591 de 1991, reglamentado por el Decreto 306 de 1992.",
 "La Corte Constitucional, en la Sentencia T-760 de 2008, M.P. Ficticio Prueba, reiteró la regla.",
 "Ley 1581 de 2012, artículo 3, literal c).",
 "Folios 12 a 15 del cuaderno principal, fl. 45, fls. 12-15.",
 "Publicado en el Diario Oficial No. 53.350.",
 "Dentro del término de diez (10) días hábiles siguientes.",
 "El incremento fue del 23 % y del 9,5 % respectivamente.",
 "Código CIIU 6910 y código postal 110231.",
 "Resolución 1995 de 1999, art. 6.",
 "Teléfono 601 000 0001 y celular 300 000 0001.",
 "Proceso de menor cuantía conforme al artículo 25 del Código General del Proceso.",
 "La calle, la carrera y la avenida son vías públicas.",
 "Expediente T-0.000.001 de la Corte.",
 "Gaceta del Congreso 094 de 1994.",
 "Prevalecen los derechos de los niños, niñas y adolescentes (art. 44 C.P.).",
 "Se decretó el embargo y secuestro de los bienes del demandado.",
 "Página 4 de 10.",
 "Mediante Acuerdo PSAA14-10248 de 2014 se crearon despachos.",
 "Versión 2.0 del formato F-12.",
 "El salario mínimo legal mensual vigente se reajusta cada año.",
 "Número único de noticia criminal asignado por la Fiscalía.",
 "La póliza contra incendio cubre el inmueble.",
 "Su carrera profesional y la diagonal principal de la matriz.",
 "El concierto de Calle 13 tuvo gran asistencia.",
 "Radicado No. 11001-31-03-999-2026-00123-00.",
 "El juzgado de conocimiento resolvió el recurso de apelación."
];


// ===================================================================== utilidades de las pruebas

const PID = 'prt_00000000000000000000000000000001' as PartId;
const REF = '2026-10-22';

function makeIds(): IdSource {
  let n = 0;
  return { next: (p) => `${p}_${(++n).toString(16).padStart(32, '0')}` };
}
const detId = (n: number): DetectionId => `det_${n.toString(16).padStart(32, '0')}` as DetectionId;

/** Ancla de R-MUN-03 del laboratorio: en producción son los finales de las detecciones CC, TI, CE y DIRECCION. */
const ANCLA = new RegExp(
  `(?:(?:C\\.C\\.|c\\.c\\.|CC|T\\.I\\.|C\\.E\\.|[Cc][eé]dula(?:[ \\t]+de[ \\t]+ciudadan[ií]a)?)(?:[ \\t]*(?:No\\.?|N[º°]\\.?|n\\.º|n[uú]mero))?[ \\t]*\\d{1,3}(?:\\.\\d{3}){1,3}|(?<![\\d.])\\d{1,3}[ \\t]*-[ \\t]*\\d{1,3}(?!\\d)(?:[ \\t]+(?:Sur|Norte|Este|Oeste))?)`,
  'gu',
);
const anclasDe = (t: string): number[] => [...t.matchAll(ANCLA)].map((m) => (m.index ?? 0) + m[0].length);

function genDe(c: DetectionCandidate): GenDetection {
  const g: GenDetection = { start: c.start, end: c.end, type: c.type, canonicalKey: c.canonicalKey };
  if (c.placeOptions) g.placeOptions = c.placeOptions;
  return g;
}
interface Corrida { cands: DetectionCandidate[]; res: GeneralizeResult; text: string }
function correr(text: string, extra: GenDetection[] = [], opts: { docDepCodes?: string[]; documentDate?: string; soloRegla?: string; sinLugares?: boolean } = {}): Corrida {
  const view = { text };
  const cands = opts.sinLugares ? [] : detectPlaces(PID, view, { anchorEnds: anclasDe(text), docDepCodes: opts.docDepCodes ?? [] });
  const usadas = cands.filter((c) => !opts.soloRegla || c.ruleId === opts.soloRegla);
  const vistos = new Set<string>();
  const dets: GenDetection[] = [];
  for (const c of usadas) { const k = `${c.start}:${c.end}`; if (!vistos.has(k)) { vistos.add(k); dets.push(genDe(c)); } }
  const options: { referenceDate: string; documentDate?: string } = { referenceDate: REF };
  if (opts.documentDate) options.documentDate = opts.documentDate;
  const input: GeneralizeInput = { part: { id: PID, text }, detections: [...dets, ...extra], options, ids: makeIds() };
  if (opts.docDepCodes) input.docDepCodes = opts.docDepCodes;
  return { cands, res: generalize(input), text };
}
const textoDe = (text: string, c: { start: number; end: number }): string => text.slice(c.start, c.end);
const sugDe = (r: GeneralizeResult, kind: SuggestionKind): Suggestion[] => r.suggestions.filter((s) => s.kind === kind);
const tramoDe = (s: Suggestion): Span => (s.target.kind === 'tramo' ? s.target.span : { partId: PID, start: -1, end: -1 });

// ===================================================================== DIVIPOLA real (4.3, 6.13, 7.7.1)

describe('DIVIPOLA real de data/divipola.json', () => {
  it('trae las 1.122 filas del CSV del DANE (1.103 municipios, 1 isla, 18 áreas no municipalizadas, 33 departamentos)', () => {
    expect(DIVIPOLA).toHaveLength(1122);
    const tipos: Record<string, number> = {};
    for (const r of DIVIPOLA) tipos[r.tipo] = (tipos[r.tipo] ?? 0) + 1;
    expect(tipos).toEqual({ Municipio: 1103, Isla: 1, 'Área no municipalizada': 18 });
    expect(new Set(DIVIPOLA.map((r) => r.dep)).size).toBe(33);
    expect(DIVIPOLA.every((r) => /^\d{2}$/.test(r.dep) && /^\d{5}$/.test(r.mun) && r.mun.startsWith(r.dep))).toBe(true);
    expect(Object.keys(DIVIPOLA[0] ?? {}).sort()).toEqual(['capital', 'dep', 'depNombre', 'mun', 'munNombre', 'tipo']);
  });

  it('las capitales son los 32 códigos XX001 salvo 25001, y coinciden con el campo capital', () => {
    const esperado = [...new Set(DIVIPOLA.map((r) => r.dep))].filter((d) => d !== '25').map((d) => d + '001');
    const capitales = DIVIPOLA.filter((r) => r.capital).map((r) => r.mun);
    expect(capitales.sort()).toEqual(esperado.sort());
    expect(capitales).toHaveLength(32);
    expect(capitales).toContain('11001');
    expect(capitales).not.toContain('25001');
    expect(DIVIPOLA.every((r) => r.capital === esCapital(r.mun))).toBe(true);
  });

  it('calcula los homónimos (≠ vacío) y la lista curada de nombres comunes entra a los ambiguos', () => {
    const idx = getDivipolaIndex();
    const homonimos = Object.entries(idx.porNombre).filter(([, rs]) => new Set(rs.map((r) => r.dep)).size > 1).map(([k]) => k);
    expect(homonimos.length).toBeGreaterThanOrEqual(60);
    for (const k of ['granada', 'la union', 'florencia']) expect(homonimos).toContain(k);
    for (const k of ['cartago', 'victoria', 'bolivar', 'santa rosa', 'granada']) expect(idx.ambiguos).toContain(k);
    expect(idx.ambiguos).not.toContain('medellin');
  });

  it('«Bogotá» → 11 y los alias de departamento («valle» → 76)', () => {
    const idx = getDivipolaIndex();
    expect(idx.departamentos['bogota']).toBe('11');
    expect(idx.departamentos['bogota d.c.']).toBe('11');
    expect(idx.departamentos['valle']).toBe('76');
    expect(idx.departamentos['valle del cauca']).toBe('76');
    expect(idx.departamentos['guajira']).toBe('44');
    expect(departamentoPorNombre('BOGOTÁ')).toBe('11');
    expect(nombreDepartamento('50')).toBe('META');
    expect(municipiosPorNombre('Bogotá').map((r) => r.mun)).toEqual(['11001']);
    expect(municipiosPorNombre('Ubaté').map((r) => r.mun)).toEqual(['25843']);
  });

  it('resolvePlace sobre la DIVIPOLA real: tabla de 7.7.2', () => {
    const casos: [Parameters<typeof resolvePlace>, string, string[]][] = [
      [['Medellín'], 'unico', ['05']], [['Granada'], 'ambiguo', ['05', '25', '50']], [['Granada', 'Meta'], 'resuelto_por_depto', ['50']],
      [['Granada', null, ['50']], 'resuelto_por_documento', ['50']], [['Granada', null, ['50', '05']], 'ambiguo', ['05', '25', '50']],
      [['Granada', 'Caquetá'], 'ambiguo', ['05', '25', '50']], [['Ejemplópolis'], 'no_encontrado', []], [['BOGOTÁ, D.C.'], 'unico', ['11']],
      [['medellin'], 'unico', ['05']], [['Cali'], 'unico', ['76']], [['Ubaté'], 'unico', ['25']], [['Florencia'], 'ambiguo', ['18', '19']],
    ];
    for (const [args, estado, deps] of casos) {
      const r = resolvePlace(...args);
      expect({ args, estado: r.status, deps: r.deps }).toEqual({ args, estado, deps });
    }
    expect(resolvePlace('Granada', 'Caquetá').mismatch).toBe(true);
  });

  it('prioridad de la sugerencia según la capital: tabla de 7.7.2', () => {
    const casos: [string, string][] = [['05001', 'opcional_ciudad_grande'], ['25843', 'recomendada'], ['18001', 'opcional_ciudad_grande'],
      ['19290', 'recomendada'], ['11001', 'opcional_ciudad_grande'], ['25001', 'recomendada']];
    for (const [cod, p] of casos) expect({ cod, p: prioridadDe(cod) }).toEqual({ cod, p });
    expect(prioridadDe(undefined)).toBe('recomendada');
  });

  it('las seis formas de un nombre: original, sin tildes, MAYÚSCULAS, MAYÚSCULAS sin tildes, tipo título y tipo título sin tildes', () => {
    expect(formasDeNombre(['VALLE DEL CAUCA'])).toEqual(['VALLE DEL CAUCA', 'VALLE DEL CAUCA', 'VALLE DEL CAUCA', 'VALLE DEL CAUCA', 'Valle del Cauca', 'Valle del Cauca']);
    expect(formasDeNombre(['SAN JOSÉ DEL GUAVIARE'])).toContain('San José del Guaviare');
    expect(formasDeNombre(['BOGOTÁ, D.C.'])).toContain('Bogotá, D.C.');
    expect(formasDeNombre(['MEDELLÍN'])).toContain('Medellin');
  });
});

// ===================================================================== rangos de edad (7.8.3)

describe('rango de edad y fecha de nacimiento', () => {
  it('edad cumplida: tabla de 7.8.3 (incluye el 29 de febrero)', () => {
    const casos: [[string, string], number][] = [[['1991-03-14', '2026-03-13'], 34], [['1991-03-14', '2026-03-14'], 35], [['2010-05-01', '2026-10-22'], 16],
      [['2004-02-29', '2026-02-28'], 21], [['2004-02-29', '2026-03-01'], 22]];
    for (const [[n, r], e] of casos) expect({ n, r, e: edadCumplida(n, r) }).toEqual({ n, r, e });
  });
  it('rango por décadas: tabla de 7.8.3', () => {
    const casos: [number, string][] = [[34, 'entre 30 y 40 años'], [40, 'entre 40 y 50 años'], [7, 'menos de 10 años'], [95, '90 años o más'], [16, 'entre 10 y 20 años'], [0, 'menos de 10 años']];
    for (const [e, s] of casos) expect({ e, s: rangoDeEdad(e) }).toEqual({ e, s });
    expect(rangoDeEdad(-1)).toBeNull();
    expect(rangoDeEdad(3.5)).toBeNull();
  });
  it('edadEnLetras lee 0 a 120 y rechaza lo que no es una cifra', () => {
    const casos: [string, number | null][] = [['treinta y cuatro', 34], ['veintiún', 21], ['ocho', 8], ['ciento veinte', 120], ['cien', 100], ['cero', 0],
      ['dos tres', null], ['treinta y', null], ['mil', null], ['ciento veintiuno', null]];
    for (const [f, v] of casos) expect({ f, v: edadEnLetras(f) }).toEqual({ f, v });
  });
  it('mes y año a partir de la clave canónica', () => {
    expect(mesYAnioDeClave('FECHA:2026-03-14')).toBe('marzo de 2026');
    expect(mesYAnioDeClave('FECHA:~14 de marzo')).toBeNull();
    expect(mesYAnioDeClave('PER:ana')).toBeNull();
  });
});

// ===================================================================== patrones del laboratorio sobre la implementación

const LUGARES = ['R-MUN-01', 'R-MUN-02', 'R-MUN-03', 'R-MUN-04', 'R-MUN-05', 'R-DEP-01'];
describe.each(LUGARES)('%s · lugares (7.7.3) → candidatos y sugerencias', (regla) => {
  const caso = CASOS[regla];
  if (!caso) throw new Error('sin casos ' + regla);
  it.each(caso.pos.map((c, i) => [i + 1, ...c] as const))('positivo %i «%s»', (_i, texto, tramo, exp = {}) => {
    const docDeps = (exp['docDeps'] as string[] | undefined) ?? [];
    const { cands, res, text } = correr(texto, [], { docDepCodes: docDeps, soloRegla: regla });
    const c = cands.find((x) => x.ruleId === regla && textoDe(text, x) === tramo);
    expect(c, `tramo «${tramo}»; candidatos: ${JSON.stringify(cands.map((x) => [x.ruleId, textoDe(text, x), x.canonicalKey]))}`).toBeDefined();
    if (!c) return;
    if (exp['key']) expect(c.canonicalKey).toBe(exp['key']);
    if (exp['conf']) expect(c.confidence).toBe(exp['conf']);
    if (c.type === 'MUNICIPIO') {
      const s = res.suggestions.find((x) => x.kind === 'MUNICIPIO_A_DEPARTAMENTO' && x.originalText === tramo);
      expect(s, 'sugerencia MUNICIPIO_A_DEPARTAMENTO').toBeDefined();
      if (exp['template']) expect(s?.options[0]?.template).toBe(exp['template']);
      if (exp['prioridad']) expect(s?.prioridad).toBe(exp['prioridad']);
      if (c.placeOptions) expect(s?.placeOptions).toEqual(c.placeOptions);
    } else {
      expect(c.type).toBe('DEPARTAMENTO');
      if (exp['template']) expect(exp['template']).toBe('{m}');
    }
  });
  it.each(caso.neg.map((c, i) => [i + 1, ...c] as const))('negativo %i «%s» (%s)', (_i, texto) => {
    const { cands } = correr(texto, [], { soloRegla: regla });
    expect(cands.filter((x) => x.ruleId === regla)).toEqual([]);
  });
});

describe('R-DESP-01 · despacho o autoridad con municipio (G-04)', () => {
  const caso = CASOS['R-DESP-01'];
  if (!caso) throw new Error('sin casos R-DESP-01');
  it.each(caso.pos.map((c, i) => [i + 1, ...c] as const))('positivo %i «%s»', (_i, texto, tramo, exp = {}) => {
    const { res } = correr(texto, [], { sinLugares: true });
    const s = sugDe(res, 'DESPACHO_A_GENERICO').find((x) => x.originalText === tramo);
    expect(s, 'sugerencia DESPACHO_A_GENERICO').toBeDefined();
    if (!s) return;
    const esperadas = (exp['options'] as string[]).map((o) => {
      const m = /^(.*) \[DEP:(\d{2})\]$/.exec(o);
      return m ? { template: m[1], depCode: m[2] } : { template: o, depCode: undefined };
    });
    expect(s.options.map((o) => ({ template: o.template, depCode: o.depCode }))).toEqual(esperadas);
    expect(s.options.map((o) => o.id)).toEqual(esperadas.map((_, i) => 'o' + (i + 1)));
    expect(s.options.every((o) => o.kind === 'DESPACHO_A_GENERICO')).toBe(true);
    if (exp['prioridad']) expect(s.prioridad).toBe(exp['prioridad']);
    expect(s.status).toBe('pendiente');
    expect(s.target.kind).toBe('tramo');
  });
  it.each(caso.neg.map((c, i) => [i + 1, ...c] as const))('negativo %i «%s» (%s)', (_i, texto) => {
    expect(sugDe(correr(texto, [], { sinLugares: true }).res, 'DESPACHO_A_GENERICO')).toEqual([]);
  });
});

describe('R-EDAD-01 · edad explícita (G-06)', () => {
  const caso = CASOS['R-EDAD-01'];
  if (!caso) throw new Error('sin casos R-EDAD-01');
  it.each(caso.pos.map((c, i) => [i + 1, ...c] as const))('positivo %i «%s»', (_i, texto, tramo, exp = {}) => {
    const { res } = correr(texto, [], { sinLugares: true });
    const s = sugDe(res, 'EDAD_A_RANGO').find((x) => x.originalText === tramo);
    expect(s, 'sugerencia EDAD_A_RANGO').toBeDefined();
    const edad = Number(String(exp['key']).replace('EDAD:', ''));
    const rango = rangoDeEdad(edad) as string;
    expect(s?.options[0]?.template).toBe(/^de(?![\p{L}])/iu.test(tramo) ? 'de ' + rango : rango);
    expect(s?.status).toBe('pendiente');
    // Edad < 18 → además bandera MENOR (EXPRESION_MENOR) en esa oración.
    expect(res.flags.some((f) => f.type === 'MENOR' && f.reason === 'EXPRESION_MENOR')).toBe(exp['ctx'] === 'menor');
  });
  it.each(caso.neg.map((c, i) => [i + 1, ...c] as const))('negativo %i «%s» (%s)', (_i, texto) => {
    expect(sugDe(correr(texto, [], { sinLugares: true }).res, 'EDAD_A_RANGO')).toEqual([]);
  });
});

const BANDERAS: [string, FlagReason, FlagType][] = [
  ['R-CAR-01', 'LISTA_CARGOS', 'CARGO'], ['R-CIE-01', 'PATRON_CIE10', 'DIAGNOSTICO'], ['R-DIAG-01', 'LISTA_DIAGNOSTICOS', 'DIAGNOSTICO'],
  ['R-LLA-01', 'LISTA_LLAMATIVOS', 'HECHO_LLAMATIVO'], ['R-MEN-01', 'EXPRESION_MENOR', 'MENOR'],
];
describe.each(BANDERAS)('%s · banderas (7.7.6)', (regla, motivo, tipo) => {
  const caso = CASOS[regla];
  if (!caso) throw new Error('sin casos ' + regla);
  it.each(caso.pos.map((c, i) => [i + 1, ...c] as const))('INV-R01 positivo %i «%s»', (_i, texto, tramo, exp = {}) => {
    const { res, text } = correr(texto, [], { sinLugares: true });
    const f = res.flags.find((x) => x.reason === motivo && x.text === tramo);
    expect(f, `banderas: ${JSON.stringify(res.flags.map((x) => [x.reason, x.text]))}`).toBeDefined();
    if (!f) return;
    expect(f.type).toBe(tipo);
    expect(text.slice(f.span.start, f.span.end)).toBe(f.text);
    expect(f.acknowledged).toBe(false);
    expect(f.resolution).toBeUndefined();
    if (exp['options']) expect(f.options.map((o) => o.template)).toEqual(exp['options']);
    if (regla === 'R-LLA-01') expect(f.options).toEqual([]);
    expect(f.options.map((o) => o.id)).toEqual(f.options.map((_, i) => 'o' + (i + 1)));
  });
  it.each(caso.neg.map((c, i) => [i + 1, ...c] as const))('negativo %i «%s» (%s)', (_i, texto) => {
    expect(correr(texto, [], { sinLugares: true }).res.flags.filter((x) => x.reason === motivo)).toEqual([]);
  });
});

describe('R-CIT-01 · cita jurisprudencial (G-13)', () => {
  const RAD = /\d{5}-\d{2}-\d{2}-\d{3}-\d{4}-\d{5}-\d{2}/;
  it.each(CASOS_CITA.map((c, i) => [i + 1, ...c] as const))('caso %i «%s» → cita: %s', (_i, texto, esCita) => {
    const m = RAD.exec(texto);
    if (!m) throw new Error('sin radicado');
    expect(isCitation(texto, m.index, m.index + m[0].length)).toBe(esCita);
    const det: GenDetection = { id: detId(1), start: m.index, end: m.index + m[0].length, type: 'RADICADO', canonicalKey: 'RADICADO:' + m[0] };
    const { res } = correr(texto, [det], { sinLugares: true });
    const f = res.flags.find((x) => x.type === 'CITA_JURISPRUDENCIAL');
    expect(!!f).toBe(esCita);
    if (f) {
      expect(f.reason).toBe('RADICADO_EN_CITA');
      expect(f.detectionId).toBe(detId(1));
      expect(f.options).toEqual([]);
      expect(f.span.start).toBe(m.index);
      expect(f.text).toBe(m[0]);
      expect(f.acknowledged).toBe(false);
    }
  });
});

describe('barrido global: texto jurídico sin datos personales no genera nada', () => {
  it.each(NEGATIVOS_GLOBALES.map((t, i) => [i + 1, t] as const))('frase %i', (_i, texto) => {
    const { cands, res } = correr(texto);
    expect(cands).toEqual([]);
    expect(res.suggestions).toEqual([]);
    expect(res.flags).toEqual([]);
  });
});

// ===================================================================== reglas de generalización G-01 a G-13 (7.8.2)

describe('G-01 a G-03 · municipio, departamento y homónimo', () => {
  it('G-01 «oriunda del municipio de Cartago» → tramo con prefijo «de », departamento 76, recomendada', () => {
    // Cartago es ambiguo (lista curada) pero R-MUN-01 admite contexto fuerte; el nombre existe en un solo departamento (76).
    const { res, text } = correr('oriunda del municipio de Cartago');
    const [s] = sugDe(res, 'MUNICIPIO_A_DEPARTAMENTO');
    expect(s?.originalText).toBe('del municipio de Cartago');
    expect(s?.options).toEqual([{ id: 'o1', kind: 'MUNICIPIO_A_DEPARTAMENTO', template: 'de un municipio de {m}', depCode: '76' }]);
    expect(s?.prioridad).toBe('recomendada');
    expect(s?.status).toBe('pendiente');
    expect(s?.placeOptions).toBeUndefined();
    expect(text.slice(tramoDe(s as Suggestion).start, tramoDe(s as Suggestion).end)).toBe('del municipio de Cartago');
  });
  it('G-01 dos municipios del mismo departamento comparten depCode y las capitales llevan «opcional_ciudad_grande»', () => {
    const { res } = correr('residente en Medellín y domiciliado en Rionegro, Antioquia');
    const s = sugDe(res, 'MUNICIPIO_A_DEPARTAMENTO');
    expect(s.map((x) => [x.originalText, x.options[0]?.depCode, x.prioridad])).toEqual([
      ['Medellín', '05', 'opcional_ciudad_grande'], ['Rionegro, Antioquia', '05', 'recomendada'],
    ]);
  });
  it('G-01 Bogotá, D.C. usa «{m}» (no «un municipio de {m}») y respeta el prefijo', () => {
    const a = sugDe(correr('domiciliado en Bogotá, D.C.').res, 'MUNICIPIO_A_DEPARTAMENTO')[0];
    expect(a?.options[0]).toEqual({ id: 'o1', kind: 'MUNICIPIO_A_DEPARTAMENTO', template: '{m}', depCode: '11' });
    expect(a?.prioridad).toBe('opcional_ciudad_grande');
    const b = sugDe(correr('oriundo del municipio de Bogotá').res, 'MUNICIPIO_A_DEPARTAMENTO')[0];
    expect(b?.options[0]?.template).toBe('de {m}');
    const c = sugDe(correr('se trasladó al municipio de Florencia, Caquetá').res, 'MUNICIPIO_A_DEPARTAMENTO')[0];
    expect(c?.options[0]?.template).toBe('a un municipio de {m}');
    expect(c?.prioridad).toBe('opcional_ciudad_grande');
  });
  it('G-02 el departamento rotulado es una detección DEPARTAMENTO con clave DEP:<código> y no una sugerencia', () => {
    const { cands, res } = correr('en el departamento del Meta');
    expect(cands.map((c) => [c.type, c.canonicalKey, c.ruleId])).toEqual([['DEPARTAMENTO', 'DEP:50', 'R-DEP-01']]);
    expect(res.suggestions).toEqual([]);
  });
  it('G-03 homónimo sin resolver: LUGAR:<vista lista>, placeOptions, opción sin depCode y prioridad recomendada', () => {
    const { cands, res } = correr('residente en Granada');
    expect(cands[0]).toMatchObject({ type: 'MUNICIPIO', canonicalKey: 'LUGAR:granada', confidence: 'baja', placeOptions: ['05', '25', '50'] });
    const [s] = sugDe(res, 'MUNICIPIO_A_DEPARTAMENTO');
    expect(s?.placeOptions).toEqual(['05', '25', '50']);
    expect(s?.options).toEqual([{ id: 'o1', kind: 'MUNICIPIO_A_DEPARTAMENTO', template: 'un municipio de {m}' }]);
    expect(s?.options[0]?.depCode).toBeUndefined();
    expect(s?.prioridad).toBe('recomendada');
  });
  it('G-03 el departamento del documento resuelve un homónimo con confianza media (resuelto_por_documento)', () => {
    const { cands, res } = correr('residente en Granada', [], { docDepCodes: ['50'] });
    expect(cands[0]).toMatchObject({ canonicalKey: 'DEP:50', confidence: 'media' });
    expect(sugDe(res, 'MUNICIPIO_A_DEPARTAMENTO')[0]?.options[0]?.depCode).toBe('50');
  });
  it('G-03 un municipio único del mismo documento sirve de evidencia para otro homónimo', () => {
    const { cands } = correr('Los hechos ocurrieron en Villavicencio. Ana vive en la ciudad de Granada');
    const granada = cands.find((c) => c.ruleId === 'R-MUN-01');
    expect(granada?.canonicalKey).toBe('DEP:50');
  });
  it('G-03 los dos primeros dígitos del DANE de un radicado son evidencia de departamento', () => {
    const texto = 'Radicado 50001-31-03-999-2026-00123-00. Ana vive en la ciudad de Granada';
    const i = texto.indexOf('50001');
    const rad: GenDetection = { id: detId(2), start: i, end: i + '50001-31-03-999-2026-00123-00'.length, type: 'RADICADO', canonicalKey: 'RADICADO:x' };
    expect(departamentosDeRadicados(texto, [rad])).toEqual(['50']);
    const { res } = correr(texto, [rad], { docDepCodes: ['50'] });
    expect(sugDe(res, 'MUNICIPIO_A_DEPARTAMENTO')[0]?.options[0]?.depCode).toBe('50');
  });
  it('un LOC del modelo que está en la DIVIPOLA se resuelve; el que no, es LUGAR (null)', () => {
    const t = 'Ana vive en Cali y en la vereda Ejemplo Alto';
    const i = t.indexOf('Cali');
    const c = candidateFromLoc(PID, t, i, i + 4);
    expect(c).toMatchObject({ type: 'MUNICIPIO', source: 'modelo', nerLabel: 'LOC', canonicalKey: 'DEP:76' });
    const j = t.indexOf('vereda');
    expect(candidateFromLoc(PID, t, j, t.length)).toBeNull();
    const k = candidateFromLoc(PID, 'Antioquia', 0, 9);
    expect(k).toMatchObject({ type: 'DEPARTAMENTO', canonicalKey: 'DEP:05' });
    // Y se convierte en la sugerencia, igual que un candidato de regla.
    const { res } = correr(t, [{ start: i, end: i + 4, type: 'MUNICIPIO', canonicalKey: 'DEP:76' }], { sinLugares: true });
    expect(sugDe(res, 'MUNICIPIO_A_DEPARTAMENTO')[0]?.options[0]).toMatchObject({ template: 'un municipio de {m}', depCode: '76' });
    expect(sugDe(res, 'MUNICIPIO_A_DEPARTAMENTO')[0]?.prioridad).toBe('opcional_ciudad_grande');
  });
  it('un municipio ya cubierto por la sugerencia de un despacho no se propone otra vez', () => {
    const { res } = correr('ante el Juzgado Tercero Civil del Circuito de Cartago');
    expect(sugDe(res, 'MUNICIPIO_A_DEPARTAMENTO')).toEqual([]);
    expect(sugDe(res, 'DESPACHO_A_GENERICO')).toHaveLength(1);
  });
});

describe('G-04 · despacho y código de despacho', () => {
  it('homónimo: una opción por departamento candidato y la genérica al final', () => {
    const { res } = correr('Juzgado Promiscuo Municipal de Granada', [], { sinLugares: true });
    const [s] = sugDe(res, 'DESPACHO_A_GENERICO');
    expect(s?.options.map((o) => o.depCode)).toEqual(['05', '25', '50', undefined]);
    expect(s?.options.at(-1)?.template).toBe('un juzgado promiscuo municipal');
  });
  it('el departamento del documento resuelve el homónimo del despacho', () => {
    const { res } = correr('Juzgado Promiscuo Municipal de Granada', [], { sinLugares: true, docDepCodes: ['50'] });
    expect(sugDe(res, 'DESPACHO_A_GENERICO')[0]?.options.map((o) => o.depCode)).toEqual(['50', undefined]);
  });
  it('autoridades en femenino: «una alcaldía municipal» y «una personería»', () => {
    const a = sugDe(correr('ante la Alcaldía Municipal de Ubaté', [], { sinLugares: true }).res, 'DESPACHO_A_GENERICO')[0];
    expect(a?.options.at(-1)?.template).toBe('una alcaldía municipal');
    const p = sugDe(correr('la Personería de Medellín', [], { sinLugares: true }).res, 'DESPACHO_A_GENERICO')[0];
    expect(p?.options.at(-1)?.template).toBe('una personería');
  });
  it('E-DESP-01: el código de despacho de 12 dígitos genera la misma sugerencia con el DANE del municipio', () => {
    const t = 'código del despacho 110014003001';
    const [s] = sugDe(correr(t, [], { sinLugares: true }).res, 'DESPACHO_A_GENERICO');
    expect(s?.originalText).toBe(t);
    expect(s?.options.map((o) => [o.template, o.depCode])).toEqual([['un despacho judicial de {m}', '11'], ['un despacho judicial', undefined]]);
    expect(s?.prioridad).toBe('opcional_ciudad_grande');
    const [u] = sugDe(correr('Código del despacho 050013103001', [], { sinLugares: true }).res, 'DESPACHO_A_GENERICO');
    expect(u?.options[0]).toMatchObject({ template: 'un despacho judicial de un municipio de {m}', depCode: '05' });
    const [r] = sugDe(correr('despacho judicial código 760014189003', [], { sinLugares: true }).res, 'DESPACHO_A_GENERICO');
    expect(r?.options[0]?.depCode).toBe('76');
    // Sin rótulo, con 10 dígitos o con un DANE que no existe: nada.
    expect(sugDe(correr('código del despacho 1100140030', [], { sinLugares: true }).res, 'DESPACHO_A_GENERICO')).toEqual([]);
    expect(sugDe(correr('110014003001', [], { sinLugares: true }).res, 'DESPACHO_A_GENERICO')).toEqual([]);
    expect(sugDe(correr('código del despacho 990994003001', [], { sinLugares: true }).res, 'DESPACHO_A_GENERICO')).toEqual([]);
  });
});

describe('G-05 · fecha de nacimiento → rango de edad', () => {
  const fecha = (t: string, frag: string, iso: string, ctx: GenDetection['context'] = 'nacimiento'): GenDetection => {
    const i = t.indexOf(frag);
    return { id: detId(10), start: i, end: i + frag.length, type: 'FECHA', canonicalKey: 'FECHA:' + iso, context: ctx };
  };
  it('verbo de nacimiento: o1 «de entre 30 y 40 años» y o2 «mayor de edad»; el tramo incluye el verbo y la fecha', () => {
    const t = 'Ana Ficticia, nacida el 14 de marzo de 1991, vive allí';
    const { res } = correr(t, [fecha(t, '14 de marzo de 1991', '1991-03-14')], { sinLugares: true });
    const [s] = sugDe(res, 'FECHA_NACIMIENTO_A_RANGO_EDAD');
    expect(s?.originalText).toBe('nacida el 14 de marzo de 1991');
    expect(s?.options.map((o) => o.template)).toEqual(['de entre 30 y 40 años', 'mayor de edad']);
    expect(s?.target).toMatchObject({ kind: 'tramo', relatedDetectionId: detId(10) });
    expect(res.flags).toEqual([]);
  });
  it('rótulo de nacimiento: «edad aproximada: entre 30 y 40 años»', () => {
    const t = 'Fecha de nacimiento: 14/03/1991';
    const { res } = correr(t, [fecha(t, '14/03/1991', '1991-03-14')], { sinLugares: true });
    const [s] = sugDe(res, 'FECHA_NACIMIENTO_A_RANGO_EDAD');
    expect(s?.originalText).toBe(t);
    expect(s?.options.map((o) => o.template)).toEqual(['edad aproximada: entre 30 y 40 años', 'mayor de edad']);
  });
  it('menor de 18: o2 «menor de edad» y bandera MENOR sobre el verbo, sin solaparse con la fecha', () => {
    const t = 'La paciente nació el 1 de mayo de 2010 en la clínica';
    const f = fecha(t, '1 de mayo de 2010', '2010-05-01');
    const { res } = correr(t, [f], { sinLugares: true });
    const [s] = sugDe(res, 'FECHA_NACIMIENTO_A_RANGO_EDAD');
    expect(s?.options.map((o) => o.template)).toEqual(['de entre 10 y 20 años', 'menor de edad']);
    expect(res.flags).toHaveLength(1);
    expect(res.flags[0]).toMatchObject({ type: 'MENOR', reason: 'EXPRESION_MENOR', text: 'nació el', acknowledged: false });
    expect(res.flags[0]?.span.end).toBeLessThanOrEqual(f.start);
  });
  it('usa la fecha del documento como referencia y, si falta, la fecha del día', () => {
    const t = 'nacida el 14 de marzo de 1991';
    const f = fecha(t, '14 de marzo de 1991', '1991-03-14');
    const conDoc = correr(t, [f], { sinLugares: true, documentDate: '2026-03-13' }).res; // 34
    expect(sugDe(conDoc, 'FECHA_NACIMIENTO_A_RANGO_EDAD')[0]?.options[0]?.template).toBe('de entre 30 y 40 años');
    const sinDoc = correr(t, [f], { sinLugares: true }).res; // hoy: 35
    expect(sugDe(sinDoc, 'FECHA_NACIMIENTO_A_RANGO_EDAD')[0]?.options[0]?.template).toBe('de entre 30 y 40 años');
    const otra = correr('nacida el 14 de marzo de 1991', [f], { sinLugares: true, documentDate: '2051-03-14' }).res; // 60
    expect(sugDe(otra, 'FECHA_NACIMIENTO_A_RANGO_EDAD')[0]?.options[0]?.template).toBe('de entre 60 y 70 años');
  });
  it('fecha futura, edad > 120 o clave inválida: no se sugiere rango y la fecha queda como FECHA', () => {
    const t = 'nacida el 14 de marzo de 2030';
    expect(sugDe(correr(t, [fecha(t, '14 de marzo de 2030', '2030-03-14')], { sinLugares: true }).res, 'FECHA_NACIMIENTO_A_RANGO_EDAD')).toEqual([]);
    const v = 'nacido el 14 de marzo de 1900';
    expect(sugDe(correr(v, [fecha(v, '14 de marzo de 1900', '1900-03-14')], { sinLugares: true }).res, 'FECHA_NACIMIENTO_A_RANGO_EDAD')).toEqual([]);
    const k = 'nacido el 31/02/1991';
    const d = fecha(k, '31/02/1991', '~31/02/1991');
    d.canonicalKey = 'FECHA:~31/02/1991';
    expect(sugDe(correr(k, [d], { sinLugares: true }).res, 'FECHA_NACIMIENTO_A_RANGO_EDAD')).toEqual([]);
  });
});

describe('G-07 · fecha de un hecho → mes y año', () => {
  const fecha = (t: string, frag: string, iso: string, ctx: GenDetection['context'] | null = 'hecho'): GenDetection => {
    const i = t.indexOf(frag);
    const d: GenDetection = { id: detId(20), start: i, end: i + frag.length, type: 'FECHA', canonicalKey: 'FECHA:' + iso };
    if (ctx) d.context = ctx;
    return d;
  };
  it('sin artículo el objetivo es la detección y la opción es «marzo de 2026»', () => {
    const t = 'fecha: 14/03/2026';
    const { res } = correr(t, [fecha(t, '14/03/2026', '2026-03-14')], { sinLugares: true });
    const [s] = sugDe(res, 'FECHA_A_MES_ANIO');
    expect(s?.target).toEqual({ kind: 'deteccion', detectionId: detId(20) });
    expect(s?.originalText).toBe('14/03/2026');
    expect(s?.options).toEqual([{ id: 'o1', kind: 'FECHA_A_MES_ANIO', template: 'marzo de 2026' }]);
    expect(s?.status).toBe('pendiente');
  });
  it.each([
    ['fue diagnosticada el 14 de marzo de 2026', 'el 14 de marzo de 2026', 'en marzo de 2026'],
    ['el diagnóstico del 14 de marzo de 2026', 'del 14 de marzo de 2026', 'de marzo de 2026'],
    ['hasta el 14 de marzo de 2026', 'hasta el 14 de marzo de 2026', 'hasta marzo de 2026'],
    ['desde el 14 de marzo de 2026', 'desde el 14 de marzo de 2026', 'desde marzo de 2026'],
    ['ocurrió el día 14 de marzo de 2026', 'el día 14 de marzo de 2026', 'en marzo de 2026'],
    ['llegó al 14 de marzo de 2026', 'al 14 de marzo de 2026', 'a marzo de 2026'],
    ['El 14 de marzo de 2026 ocurrió', 'El 14 de marzo de 2026', 'En marzo de 2026'],
  ])('con artículo «%s» → tramo «%s» → «%s»', (t, tramo, esperado) => {
    const fragmento = '14 de marzo de 2026';
    const { res } = correr(t, [fecha(t, fragmento, '2026-03-14')], { sinLugares: true });
    const [s] = sugDe(res, 'FECHA_A_MES_ANIO');
    expect(s?.originalText).toBe(tramo);
    expect(s?.target).toMatchObject({ kind: 'tramo', relatedDetectionId: detId(20) });
    expect(s?.options[0]?.template).toBe(esperado);
  });
  it('sin contexto de hecho (procesal, norma, nacimiento sin verbo) o con clave inválida: sin sugerencia', () => {
    const t = 'radicó el 14 de marzo de 2026';
    expect(sugDe(correr(t, [fecha(t, '14 de marzo de 2026', '2026-03-14', null)], { sinLugares: true }).res, 'FECHA_A_MES_ANIO')).toEqual([]);
    expect(sugDe(correr(t, [fecha(t, '14 de marzo de 2026', '2026-03-14', 'norma')], { sinLugares: true }).res, 'FECHA_A_MES_ANIO')).toEqual([]);
    const sinAnio = 'el 14 de marzo';
    expect(sugDe(correr(sinAnio, [{ ...fecha(sinAnio, '14 de marzo', '~14 de marzo'), canonicalKey: 'FECHA:~14 de marzo' }], { sinLugares: true }).res, 'FECHA_A_MES_ANIO')).toEqual([]);
  });
  it('la clave ISO de la detección no cambia: la sugerencia no la toca', () => {
    const t = 'el 14 de marzo de 2026';
    const d = fecha(t, '14 de marzo de 2026', '2026-03-14');
    correr(t, [d], { sinLugares: true });
    expect(d.canonicalKey).toBe('FECHA:2026-03-14');
  });
});

describe('G-09 · rótulo que revela condición (preaplicada)', () => {
  const rotulo = (t: string, tipo: DataType, rot: string, id: number, labelId: string): GenDetection => {
    const i = t.indexOf(rot);
    const v = t.indexOf(' ', i) + 1;
    return { id: detId(id), start: v, end: t.length, type: tipo, canonicalKey: `${tipo}:x`, label: { labelId, start: i, end: i + rot.length } };
  };
  it.each([
    ['T.I. 1.000.000.002', 'TI', 'T.I.', 'ROT-TI'], ['C.E. 123456', 'CE', 'C.E.', 'ROT-CE'], ['PPT 1234567', 'PPT', 'PPT', 'ROT-PPT'], ['P.E.P. 123456', 'PEP', 'P.E.P.', 'ROT-PEP'],
  ] as const)('INV-R09 «%s» (%s): la sugerencia ROTULO_DOCUMENTO_A_GENERICO nace aplicada con «documento de identidad»', (t, tipo, rot, labelId) => {
    const d = rotulo(t, tipo, rot, 30, labelId);
    const { res } = correr(t, [d], { sinLugares: true });
    const [s] = sugDe(res, 'ROTULO_DOCUMENTO_A_GENERICO');
    expect(s?.status).toBe('aplicada');
    expect(s?.chosenOptionId).toBe('o1');
    expect(s?.options).toEqual([{ id: 'o1', kind: 'ROTULO_DOCUMENTO_A_GENERICO', template: 'documento de identidad' }]);
    expect(s?.originalText).toBe(rot);
    expect(s?.target).toMatchObject({ kind: 'tramo', relatedDetectionId: detId(30) });
    expect(tramoDe(s as Suggestion)).toEqual({ partId: PID, start: 0, end: rot.length });
    // Solo toca el rótulo: no se solapa con la detección.
    expect(tramoDe(s as Suggestion).end).toBeLessThanOrEqual(d.start);
  });
  it('INV-R09 sin rótulo no hay sugerencia ni bandera', () => {
    const d: GenDetection = { id: detId(31), start: 0, end: 10, type: 'TI', canonicalKey: 'TI:1000000002' };
    const { res } = correr('1000000002', [d], { sinLugares: true });
    expect(res.suggestions).toEqual([]);
    expect(res.flags).toEqual([]);
  });
  it('la TI además lleva la bandera MENOR (ROTULO_TI), sin confirmar y vinculada a la sugerencia', () => {
    const t = 'T.I. 1.000.000.002';
    const { res } = correr(t, [rotulo(t, 'TI', 'T.I.', 32, 'ROT-TI')], { sinLugares: true });
    const [s] = sugDe(res, 'ROTULO_DOCUMENTO_A_GENERICO');
    expect(res.flags).toHaveLength(1);
    expect(res.flags[0]).toMatchObject({ type: 'MENOR', reason: 'ROTULO_TI', text: 'T.I.', acknowledged: false, detectionId: detId(32), suggestionId: s?.id });
    expect(res.flags[0]?.options).toEqual([{ id: 'o1', kind: 'ROTULO_DOCUMENTO_A_GENERICO', template: 'documento de identidad' }]);
    expect(res.flags[0]?.resolution).toBeUndefined();
  });
  it('CE, PPT y PEP no activan la bandera MENOR', () => {
    const t = 'C.E. 123456';
    expect(correr(t, [rotulo(t, 'CE', 'C.E.', 33, 'ROT-CE')], { sinLugares: true }).res.flags).toEqual([]);
  });
  it('registro civil: bandera MENOR (ROTULO_TI) sin sugerencia; carné diplomático y salvoconducto: nada', () => {
    const t = 'registro civil de nacimiento NUIP 1.000.000.017';
    const d = rotulo(t, 'DOCUMENTO', 'registro civil de nacimiento NUIP', 34, 'ROT-RC');
    d.start = t.indexOf('1.000'); d.end = t.length;
    const { res } = correr(t, [d], { sinLugares: true });
    expect(res.suggestions).toEqual([]);
    expect(res.flags[0]).toMatchObject({ type: 'MENOR', reason: 'ROTULO_TI', detectionId: detId(34), acknowledged: false });
    expect(res.flags[0]?.suggestionId).toBeUndefined();
    const u = 'carné diplomático No. CD-001234';
    const dd = rotulo(u, 'DOCUMENTO', 'carné diplomático', 35, 'ROT-DOCX');
    const r2 = correr(u, [dd], { sinLugares: true }).res;
    expect(r2.suggestions).toEqual([]);
    expect(r2.flags).toEqual([]);
  });
});

describe('G-08 y G-10 a G-12 · banderas con opciones', () => {
  it('G-08 el cargo conserva la organización: «una directiva» / «una representante», con prefijo del/al/su/como', () => {
    const f = (t: string): string[] => correr(t, [], { sinLugares: true }).res.flags.filter((x) => x.type === 'CARGO').flatMap((x) => x.options.map((o) => o.template));
    expect(f('la gerente general de [EMPRESA_1] firmó')).toEqual(['una directiva', 'una representante']);
    expect(f('el alcalde de Ejemplópolis')).toEqual(['un funcionario', 'una autoridad']);
    expect(f('la orden del rector de la Universidad Ejemplo')).toEqual(['de un directivo', 'de un representante']);
    expect(f('lo dijo al alcalde de Ejemplópolis')).toEqual(['a un funcionario', 'a una autoridad']);
    expect(f('como representante legal de Ferretería Ejemplo S.A.S.')).toEqual(['como directivo', 'como directiva']);
  });
  it('G-08 los cargos nacionales y los jueces quedan fuera', () => {
    const f = (t: string): number => correr(t, [], { sinLugares: true }).res.flags.length;
    expect(f('el Presidente de la República')).toBe(0);
    expect(f('el juez de Villa Ejemplo')).toBe(0);
    expect(f('el magistrado de la Sala Civil')).toBe(0);
  });
  it('G-10 diagnóstico raro: «una enfermedad de baja prevalencia»; CIE-10: «un diagnóstico médico»', () => {
    const a = correr('padece una enfermedad huérfana diagnosticada', [], { sinLugares: true }).res.flags;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ type: 'DIAGNOSTICO', reason: 'LISTA_DIAGNOSTICOS', text: 'enfermedad huérfana' });
    expect(a[0]?.options.map((o) => [o.kind, o.template])).toEqual([['DIAGNOSTICO_A_GENERICO', 'una enfermedad de baja prevalencia']]);
    const b = correr('Dx: E11.9 diabetes mellitus', [], { sinLugares: true }).res.flags;
    expect(b[0]).toMatchObject({ type: 'DIAGNOSTICO', reason: 'PATRON_CIE10', text: 'E11.9' });
    expect(b[0]?.options.map((o) => [o.kind, o.template])).toEqual([['DIAGNOSTICO_A_GENERICO', 'un diagnóstico médico']]);
  });
  it('G-10 códigos CIE-10 con y sin punto, la letra U y sin contexto clínico', () => {
    const f = (t: string): string[] => correr(t, [], { sinLugares: true }).res.flags.map((x) => x.text);
    expect(f('diagnóstico CIE-10 G35')).toEqual(['G35']);
    expect(f('impresión diagnóstica U07.1 confirmada')).toEqual(['U07.1']);
    expect(f('código CIE10 Q909 del paciente')).toEqual(['Q909']);
    expect(f('El radicado T76 del sistema')).toEqual([]);
  });
  it('G-11 el hecho llamativo no trae opciones automáticas: solo mantener o texto libre', () => {
    const [f] = correr('fue víctima de homicidio', [], { sinLugares: true }).res.flags;
    expect(f).toMatchObject({ type: 'HECHO_LLAMATIVO', reason: 'LISTA_LLAMATIVOS', text: 'homicidio', options: [] });
  });
  it('G-12 el menor de edad: «una persona menor de edad»', () => {
    const [f] = correr('la niña Ejemplo, de 8 años,', [], { sinLugares: true }).res.flags;
    expect(f).toMatchObject({ type: 'MENOR', reason: 'EXPRESION_MENOR', text: 'la niña' });
    expect(f?.options.map((o) => [o.kind, o.template])).toEqual([['MENOR_A_GENERICO', 'una persona menor de edad']]);
  });
  it('control de fatiga (S-7.8): una bandera MENOR y una HECHO_LLAMATIVO por oración, la primera', () => {
    const t = 'La niña y el adolescente vieron un homicidio y un feminicidio. El menor de edad vio otro homicidio.';
    const { res } = correr(t, [], { sinLugares: true });
    expect(res.flags.map((f) => [f.type, f.text])).toEqual([
      ['MENOR', 'La niña'], ['HECHO_LLAMATIVO', 'homicidio'], ['MENOR', 'El menor de edad'], ['HECHO_LLAMATIVO', 'homicidio'],
    ]);
  });
  it('CARGO y DIAGNOSTICO: una bandera por aparición, sin límite por oración', () => {
    const t = 'El gerente de [EMPRESA_1] y la gerente de [EMPRESA_2]. Dx: E11.9 y G35 en el diagnóstico.';
    const { res } = correr(t, [], { sinLugares: true });
    expect(res.flags.filter((f) => f.type === 'CARGO')).toHaveLength(2);
    expect(res.flags.filter((f) => f.reason === 'PATRON_CIE10').map((f) => f.text)).toEqual(['E11.9', 'G35']);
  });
});

describe('banderas sin solape con las detecciones (6.4.5)', () => {
  it('INV-R01 una bandera que cae dentro de una detección se descarta y se cuenta', () => {
    const t = 'La Editorial Prensa Ejemplo publicó';
    const i = t.indexOf('Editorial');
    const { res } = correr(t, [{ start: i, end: i + 'Editorial Prensa Ejemplo'.length, type: 'EMPRESA', canonicalKey: 'ORG:x' }], { sinLugares: true });
    expect(res.flags).toEqual([]);
    expect(res.descartadasPorSolape).toBe(1);
  });
  it('INV-R01 una bandera que cruza el borde de una detección se recorta al lado libre', () => {
    const t = 'la gerente general de [EMPRESA_1]';
    const i = t.indexOf('general');
    const { res } = correr(t, [{ start: i, end: i + 7, type: 'PERSONA', canonicalKey: 'PER:x' }], { sinLugares: true });
    expect(res.flags).toHaveLength(1);
    expect(res.flags[0]?.text).toBe('la gerente');
    expect(t.slice(res.flags[0]?.span.start, res.flags[0]?.span.end)).toBe('la gerente');
  });
  it('ninguna bandera (salvo la de cita, que es la propia detección) se solapa con detecciones', () => {
    const t = 'Ana Ficticia, la niña de 8 años, vive en Medellín. Dx: E11.9. El homicidio fue en noticias.';
    const dets: GenDetection[] = [
      { start: 0, end: 12, type: 'PERSONA', canonicalKey: 'PER:ana' },
      { start: t.indexOf('E11.9'), end: t.indexOf('E11.9') + 5, type: 'TELEFONO', canonicalKey: 'TEL:x' },
    ];
    const { res } = correr(t, dets, { sinLugares: true });
    for (const f of res.flags) for (const d of dets) expect(f.span.end <= d.start || f.span.start >= d.end).toBe(true);
    expect(res.flags.length).toBeGreaterThan(0);
  });
  it('una sugerencia de tramo no corta a medias una detección', () => {
    const t = 'residente en Cartago';
    const i = t.indexOf('Cartago');
    const { res } = correr(t, [{ start: i + 3, end: i + 7, type: 'PERSONA', canonicalKey: 'PER:x' }]);
    for (const s of res.suggestions) {
      const sp = tramoDe(s);
      expect(sp.end <= i + 3 || sp.start >= i + 7).toBe(true);
    }
  });
});

describe('integración con la vista normalizada y los ids', () => {
  /** Vista de pruebas: colapsa los espacios dobles, con mapa de vuelta (6.1.2). */
  function vistaColapsada(canonico: string): { text: string; startMap: Uint32Array; endMap: Uint32Array } {
    let text = '';
    const s: number[] = [], e: number[] = [];
    for (let i = 0; i < canonico.length; i++) {
      const ch = canonico.charAt(i);
      if (ch === ' ' && canonico.charAt(i - 1) === ' ') continue;
      text += ch; s.push(i); e.push(i + 1);
    }
    s.push(canonico.length);
    return { text, startMap: Uint32Array.from(s), endMap: Uint32Array.from(e) };
  }
  it('los candidatos vuelven en posiciones canónicas aunque la vista colapse espacios', () => {
    const canonico = 'Ana  es   residente  en   Cartago  y  nació';
    const v = vistaColapsada(canonico);
    const cands = detectPlaces(PID, v);
    expect(cands).toHaveLength(1);
    expect(canonico.slice(cands[0]?.start, cands[0]?.end)).toBe('Cartago');
  });
  it('R-MUN-03 usa los finales canónicos de las detecciones vecinas como ancla', () => {
    const canonico = 'C.C.  10.000.001  de  Cartago';
    const v = vistaColapsada(canonico);
    const fin = canonico.indexOf('10.000.001') + '10.000.001'.length;
    const cands = detectPlaces(PID, v, { anchorEnds: [fin] });
    expect(cands.filter((c) => c.ruleId === 'R-MUN-03').map((c) => canonico.slice(c.start, c.end))).toEqual(['Cartago']);
    expect(detectPlaces(PID, v).filter((c) => c.ruleId === 'R-MUN-03')).toEqual([]);
  });
  it('generalize con vista y mapa: sugerencias y banderas citan el texto canónico', () => {
    const canonico = 'La  niña  vive en  la  ciudad de  Medellín.';
    const v = vistaColapsada(canonico);
    const cands = detectPlaces(PID, v);
    const input: GeneralizeInput = {
      part: { id: PID, text: canonico }, view: v, detections: cands.map(genDe), options: { referenceDate: REF }, ids: makeIds(),
    };
    const res = generalize(input);
    expect(res.flags.map((f) => f.text)).toEqual(['La  niña']);
    expect(res.suggestions.map((s) => s.originalText)).toEqual(['la  ciudad de  Medellín']);
    for (const f of res.flags) expect(canonico.slice(f.span.start, f.span.end)).toBe(f.text);
  });
  it('los ids vienen del IdSource inyectado (prefijos sug y flg) y la salida es determinista', () => {
    const t = 'La niña vive en el municipio de Medellín';
    const a = correr(t).res, b = correr(t).res;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.suggestions[0]?.id).toMatch(/^sug_[0-9a-f]{32}$/);
    expect(a.flags[0]?.id).toMatch(/^flg_[0-9a-f]{32}$/);
    expect(new Set([...a.suggestions.map((s) => s.id), ...a.flags.map((f) => f.id)]).size).toBe(a.suggestions.length + a.flags.length);
  });
  it('sin ids derivados del contenido: el mismo texto con otro IdSource da otros ids', () => {
    const t = 'residente en Medellín';
    const view = { text: t };
    const dets = detectPlaces(PID, view).map(genDe);
    let n = 100;
    const otro: IdSource = { next: (p) => `${p}_${(++n).toString(16).padStart(32, '0')}` };
    const r1 = generalize({ part: { id: PID, text: t }, detections: dets, options: { referenceDate: REF }, ids: makeIds() });
    const r2 = generalize({ part: { id: PID, text: t }, detections: dets, options: { referenceDate: REF }, ids: otro });
    expect(r1.suggestions[0]?.id).not.toBe(r2.suggestions[0]?.id);
  });
});

describe('listas de data/ (redactadas desde cero, S-4.2)', () => {
  it('cargos: sin jueces ni magistrados; privados y públicos no vacíos', () => {
    expect(cargosJson.privados.length).toBeGreaterThan(20);
    expect(cargosJson.publicos.length).toBeGreaterThan(20);
    for (const c of [...cargosJson.privados, ...cargosJson.publicos]) expect(c).not.toMatch(/juez|jueza|magistrad/i);
  });
  it('cie10-patron: solo el patrón del código, no el catálogo', () => {
    const re = new RegExp('^' + cie10Json.patron + '$');
    for (const c of ['E11.9', 'G35', 'F32.1', 'Q90.9', 'U07.1', 'I10', 'J449']) expect(re.test(c)).toBe(true);
    for (const c of ['C-748', 'E1', 'ab12', '12A']) expect(re.test(c)).toBe(false);
    expect(JSON.stringify(cie10Json).length).toBeLessThan(600);
  });
  it('diagnósticos, llamativos y menores: no vacíos y sin datos personales', () => {
    expect(diagnosticosJson.terminos.length).toBeGreaterThanOrEqual(14);
    expect(llamativosJson.patrones.length).toBeGreaterThanOrEqual(15);
    expect(menoresJson.expresiones.length).toBeGreaterThanOrEqual(8);
    expect(menoresJson.rotulosQueRevelanMenor).toEqual(['ROT-TI', 'ROT-RC']);
  });
});

describe('privacidad de generalize.ts (F-01 a F-14)', () => {
  const fuente = readFileSync(new URL('../../src/core/generalize.ts', import.meta.url), 'utf8');
  const sinComentarios = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  it.each([
    ['console', /\bconsole\s*\./], ['fetch', /\bfetch\s*\(/], ['XMLHttpRequest', /XMLHttpRequest/], ['WebSocket', /WebSocket/], ['EventSource', /EventSource/],
    ['sendBeacon', /sendBeacon/], ['RTCPeerConnection', /RTCPeerConnection/], ['window.open', /window\s*\.\s*open/], ['location', /\blocation\s*=/],
    ['innerHTML', /innerHTML|outerHTML|insertAdjacentHTML|document\.write|dangerouslySetInnerHTML/], ['localStorage', /localStorage|sessionStorage/],
    ['cookies', /document\.cookie/], ['document.title', /document\.title/], ['DOM', /\bdocument\b|\bwindow\b|\bnavigator\b/], ['error.message', /\.message\b|\.stack\b/],
    ['Math.random', /Math\.random/],
  ])('sin %s', (_n, re) => {
    expect(re.test(sinComentarios)).toBe(false);
  });
  it('los candidatos y las sugerencias no guardan el texto fuera de los campos [M] previstos', () => {
    const t = 'residente en Medellín';
    const [c] = detectPlaces(PID, { text: t });
    expect(Object.keys(c ?? {}).sort()).toEqual(['canonicalKey', 'confidence', 'end', 'partId', 'ruleId', 'score', 'source', 'start', 'type']);
  });
});

describe('rendimiento (indicativo)', () => {
  it('construye los patrones de la DIVIPOLA y recorre un documento largo sin retroceso catastrófico', () => {
    const base = 'Ana Ficticia vive en la ciudad de Medellín, nació el 14 de marzo de 1991, tiene 34 años y su gerente general de [EMPRESA_1] firmó el contrato en Bogotá, D.C. ante el Juzgado Tercero Civil del Circuito de Cartago. ';
    const largo = base.repeat(400);
    const t0 = performance.now();
    const { cands, res } = correr(largo);
    const ms = performance.now() - t0;
    expect(cands.length).toBeGreaterThan(400);
    expect(res.flags.length).toBeGreaterThanOrEqual(400);
    expect(ms).toBeLessThan(20000);
  });
});
