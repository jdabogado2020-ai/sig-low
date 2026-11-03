// Créditos y licencias (8.2.11, 4.6 nota 3). Es la única vista que nombra librerías, modelos y autores (SUPUESTO S-8.3),
// por obligación de licencia; queda fuera del barrido de textos prohibidos. No lleva casilla de aceptación (T-IU-09).
// Sin direcciones con esquema (check-dist prohíbe URL externas en el build). El archivo LICENSES.md del repositorio lo
// completa DOC-1 con los textos íntegros de cada licencia; aquí van los avisos que exige cada una.

export interface AvisoLicencia {
  componente: string;
  version?: string;
  licencia: string;
  aviso: string[];
}

export interface GrupoLicencias {
  titulo: string;
  intro?: string;
  avisos: AvisoLicencia[];
}

const TEXTO_MIT = [
  'Se concede permiso, libre de cargos, a cualquier persona que obtenga una copia de este software y de los archivos de documentación asociados, para utilizarlo sin restricción, incluyendo los derechos de usar, copiar, modificar, fusionar, publicar, distribuir, sublicenciar o vender copias, y para permitirlo a quienes se lo proporcionen, sujeto a las condiciones siguientes: el aviso de derechos de autor y este aviso de permiso se incluirán en todas las copias o partes sustanciales del software.',
  'EL SOFTWARE SE PROPORCIONA «TAL CUAL», SIN GARANTÍA DE NINGÚN TIPO, EXPRESA O IMPLÍCITA, INCLUIDAS LAS DE COMERCIABILIDAD, IDONEIDAD PARA UN FIN PARTICULAR Y NO INFRACCIÓN. EN NINGÚN CASO LOS AUTORES O TITULARES DE LOS DERECHOS SERÁN RESPONSABLES DE RECLAMACIÓN, DAÑO U OTRA RESPONSABILIDAD DERIVADA DEL SOFTWARE O DE SU USO.',
];

const TEXTO_APACHE = [
  'Licenciado bajo la Licencia Apache, Versión 2.0. No puede usar este archivo salvo en cumplimiento de la licencia. Puede obtener una copia en el texto de la Licencia Apache 2.0 de la Apache Software Foundation. Salvo que la ley aplicable lo exija o se acuerde por escrito, el software distribuido bajo la licencia se distribuye «TAL CUAL», SIN GARANTÍAS NI CONDICIONES DE NINGÚN TIPO. Consulte la licencia para los permisos y limitaciones aplicables.',
  'Se conserva el archivo NOTICE de cada componente cuando lo trae.',
];

const TEXTO_OFL = [
  'Este software de fuentes se licencia bajo la SIL Open Font License, versión 1.1. Se permite usar, estudiar, copiar, fusionar, incrustar, modificar y redistribuir las fuentes, solas o con otro software, y no se pueden vender por sí solas. Cada copia conserva el aviso de derechos de autor y esta licencia, y las versiones modificadas no usan los nombres de fuente reservados sin permiso. El texto íntegro de la licencia está en LICENSES.md.',
  'LAS FUENTES SE PROPORCIONAN «TAL CUAL», SIN GARANTÍA DE NINGÚN TIPO, EXPRESA O IMPLÍCITA, INCLUIDAS LAS DE COMERCIABILIDAD, IDONEIDAD PARA UN FIN PARTICULAR Y NO INFRACCIÓN DE DERECHOS DE AUTOR, PATENTES, MARCAS U OTROS DERECHOS. EN NINGÚN CASO LOS TITULARES SERÁN RESPONSABLES DE RECLAMACIÓN, DAÑO U OTRA RESPONSABILIDAD DERIVADA DEL USO DE LAS FUENTES.',
];

export const GRUPOS_LICENCIAS: GrupoLicencias[] = [
  {
    titulo: 'Bibliotecas incluidas en Sig-Low (MIT)',
    intro: 'Licencia MIT. Cada aviso de derechos de autor se conserva junto al texto de la licencia.',
    avisos: [
      { componente: 'Preact', version: '10.29.8', licencia: 'MIT', aviso: ['Copyright (c) 2015-present Jason Miller.', ...TEXTO_MIT] },
      { componente: 'fflate', version: '0.8.3', licencia: 'MIT', aviso: ['Copyright (c) 2026 Arjun Barrett.', ...TEXTO_MIT] },
      {
        componente: '@xmldom/xmldom', version: '0.9.12', licencia: 'MIT',
        aviso: [
          'Copyright 2019 - present Christopher J. Brody y otros colaboradores, según figuran en la lista de colaboradores de xmldom.',
          'Copyright 2012 - 2017 @jindw y otros colaboradores, según figuran en la lista de colaboradores de jindw/xmldom.',
          ...TEXTO_MIT,
        ],
      },
      { componente: 'onnxruntime-web (solo los archivos .wasm y .mjs de la versión de procesador)', version: '1.31.0-dev.20260914-8d85527a0', licencia: 'MIT', aviso: ['Copyright (c) Microsoft Corporation.', ...TEXTO_MIT] },
      {
        componente: 'core-js (dentro de pdf.js)', version: '3.50.0', licencia: 'MIT',
        aviso: ['Copyright (c) 2013–2025 Denis Pushkarev (zloirock.ru), 2025–2026 CoreJS Company (core-js.io). pdf.js lo lleva empaquetado en su propio código.', ...TEXTO_MIT],
      },
    ],
  },
  {
    titulo: 'Bibliotecas incluidas en Sig-Low (Apache-2.0)',
    intro: 'Licencia Apache-2.0. Se conservan la licencia y el archivo NOTICE de cada componente.',
    avisos: [
      { componente: 'pdf.js (pdfjs-dist, versión legacy)', version: '6.4.299', licencia: 'Apache-2.0', aviso: ['Copyright 2024 Mozilla Foundation. No se incluyen los recursos opcionales de pdf.js (fuentes estándar, cmaps ni wasm), que tienen otras licencias.', ...TEXTO_APACHE] },
      { componente: '@huggingface/tokenizers', version: '0.2.0', licencia: 'Apache-2.0', aviso: ['Autor: Hugging Face. El paquete trae el texto completo de la Licencia Apache 2.0 sin línea de derechos de autor propia.', ...TEXTO_APACHE] },
      { componente: 'TypeScript', version: '6.0.3', licencia: 'Apache-2.0', aviso: ['Copyright Microsoft Corporation. Herramienta de compilación; no se distribuye dentro de la aplicación.', ...TEXTO_APACHE] },
    ],
  },
  {
    titulo: 'Fuentes de la marca (SIL OFL 1.1)',
    intro: 'Archivos woff2 que van en el build, sin modificar. Se sirven desde el mismo origen: la página no pide fuentes a ningún otro sitio.',
    avisos: [
      { componente: 'Instrument Serif, peso 400 (títulos)', version: '5.3.0', licencia: 'SIL OFL 1.1', aviso: ['Copyright 2022 The Instrument Serif Project Authors. Subconjunto latino, tomado del paquete @fontsource/instrument-serif.', ...TEXTO_OFL] },
      { componente: 'Geist, pesos 300 a 700 (interfaz y cuerpo)', version: '1.8.1', licencia: 'SIL OFL 1.1', aviso: ['Copyright (c) 2023 Vercel, en colaboración con basement.studio. Fuente variable del paquete geist.', ...TEXTO_OFL] },
      { componente: 'Geist Mono, pesos 400 y 500 (etiquetas y tipos de dato)', version: '5.3.0', licencia: 'SIL OFL 1.1', aviso: ['Copyright 2024 The Geist Project Authors. Subconjunto latino, tomado del paquete @fontsource/geist-mono.', ...TEXTO_OFL] },
    ],
  },
  {
    titulo: 'Código incorporado',
    avisos: [
      {
        componente: 'Código incorporado de @piighost/ner-web (decodificación de tramos, divisor de palabras y armado de entradas)',
        version: '0.3.0',
        licencia: 'MIT',
        aviso: [
          'Copyright (c) 2025 Athroniaeth, titular de @piighost/ner-web. Copiado a src/core/ner/gliner/ con su aviso de derechos de autor.',
          'Modificación: parche para tokenizadores basados en mT5, anotado en el código.',
          ...TEXTO_MIT,
        ],
      },
    ],
  },
  {
    titulo: 'Modelo de apoyo',
    intro: 'Modelo de reconocimiento de entidades que se descarga por separado y funciona en su equipo.',
    avisos: [
      {
        componente: 'GLiNER-X large (knowledgator/gliner-x-large), versión cuantizada a 8 bits',
        licencia: 'Apache-2.0',
        aviso: [
          'Autor del modelo: Knowledgator (commit 4a4437f4). Basado en GLiNER. Modelo base: mT5-large de Google, licencia Apache-2.0.',
          'La licencia de los datos de entrenamiento está pendiente de confirmación escrita con el autor del modelo.',
          ...TEXTO_APACHE,
        ],
      },
      {
        componente: 'GLiNER-X base (knowledgator/gliner-x-base), versión cuantizada a 8 bits, usada como respaldo',
        licencia: 'Apache-2.0',
        aviso: ['Autor del modelo: Knowledgator (commit a6c7a8fb). Modelo base: mT5-base de Google, licencia Apache-2.0. La licencia de los datos de entrenamiento está pendiente de confirmación escrita.', ...TEXTO_APACHE],
      },
    ],
  },
  {
    titulo: 'Datos',
    avisos: [
      {
        componente: 'DIVIPOLA, división político-administrativa de Colombia',
        version: 'corte 2024-12-30',
        licencia: 'CC BY-SA 4.0',
        aviso: [
          'Fuente: DANE, Departamento Administrativo Nacional de Estadística, publicado en datos.gov.co (conjunto gdxc-w37w).',
          'El archivo data/divipola.json es una adaptación (recorte de columnas) que se distribuye aparte bajo CC BY-SA 4.0: compartir igual sobre los datos adaptados. Esa licencia no se extiende al resto de la aplicación.',
        ],
      },
    ],
  },
];
