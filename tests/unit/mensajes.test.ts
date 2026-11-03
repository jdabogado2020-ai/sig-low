// T-IU-02 (barrido de textos prohibidos, 8.5), INV-I06, INV-G13, T-PV-26 (extendido a docs/) y ids de mensajes únicos (PC-7).
// Recorre todas las cadenas del catálogo único (src/ui/mensajes.ts y cada módulo que registra textos), las del informe legible
// (src/core/report.ts), docs/legal/ y docs/guia-abogado.md, y los archivos propios de dist/ si existe. Excepción única: el diálogo
// «Créditos y licencias» (src/ui/licencias.ts). docs/ti.md puede llevar identificadores técnicos de políticas del navegador
// (decisión del integrador: es una guía para el área de TI, no interfaz ni informe), así que no se barre aquí.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA_TYPES, ROLES } from '../../src/core/types';
import { PLANTILLA } from '../../src/core/report';
import { GRUPOS_LICENCIAS } from '../../src/ui/licencias';
import { ALIAS, CAUSA_PLAN_B, ETIQUETA_ID } from '../../src/ui/mensajes-catalogo';
import { idDeCodigo, registrarMensajes, t, todasLasCadenas, type MessageId } from '../../src/ui/mensajes';
import '../../src/ui/mensajes-entrada';
import '../../src/ui/boveda/textos';
import '../../src/ui/listo/textos';
import '../../src/ui/reinsercion/textos';
import '../../src/ui/review/base/textos';
import '../../src/ui/review/pestanas/textos';
import { coincidencias, hallazgos, hallazgosEnDist, sinDiacriticos } from '../e2e/lib/prohibidos';

const RAIZ = process.cwd();
const UI = join(RAIZ, 'src', 'ui');
/** Módulos que registran textos con `registrarMensajes()`: la prueba de abajo falla si aparece uno que no está importado arriba. */
const MODULOS_CON_TEXTOS = [
  'mensajes-entrada.ts', 'marca-textos.ts', 'boveda/textos.ts', 'listo/textos.ts', 'reinsercion/textos.ts', 'review/base/textos.ts', 'review/pestanas/textos.ts',
];

function* archivos(dir: string): Generator<string> {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* archivos(p);
    else yield p;
  }
}
const rel = (p: string): string => relative(RAIZ, p).split(sep).join('/');
const fuentesUi = [...archivos(UI)].filter((p) => /\.(ts|tsx)$/.test(p));

/** Definiciones `'M-nnn': 'texto'` (clave de objeto con cadena a continuación) de todo src/ui, con su archivo y línea. */
function definiciones(): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  for (const f of fuentesUi) {
    readFileSync(f, 'utf8').split('\n').forEach((linea, i) => {
      const m = /^\s*['"](M-\d+)['"]\s*:\s*['"`]/.exec(linea);
      if (m?.[1] !== undefined) mapa.set(m[1], [...(mapa.get(m[1]) ?? []), `${rel(f)}:${i + 1}`]);
    });
  }
  return mapa;
}

/** Valores de una unión de literales de cadena de src/core/types.ts (`export type X = 'A' | 'B'`). */
function valoresDeUnion(nombre: string): string[] {
  const fuente = readFileSync(join(RAIZ, 'src/core/types.ts'), 'utf8');
  const i = fuente.indexOf(`export type ${nombre} =`);
  expect(i, `tipo ${nombre} en types.ts`).toBeGreaterThanOrEqual(0);
  const sinComentarios = fuente.slice(i).replace(/\/\/[^\n]*/g, '');
  const bloque = sinComentarios.slice(0, sinComentarios.indexOf(';'));
  return [...bloque.matchAll(/'([A-Za-z_0-9]+)'/g)].map((m) => m[1] as string);
}

describe('T-IU-02 ids de mensajes únicos (PC-7)', () => {
  it('T-IU-02 ningún id M-nnn se define dos veces en src/ui (catálogo, EXTRA ni módulos de textos)', () => {
    const repetidos = [...definiciones()].filter(([, sitios]) => sitios.length > 1).map(([id, sitios]) => `${id}: ${sitios.join(' | ')}`);
    expect(repetidos).toEqual([]);
  });

  it('T-IU-02 cada módulo que registra textos está importado por esta prueba (el barrido no se salta ninguno)', () => {
    const conRegistro = fuentesUi.filter((f) => /registrarMensajes\(\s*[\w{]/.test(readFileSync(f, 'utf8')) && !f.endsWith(`${sep}mensajes.ts`)).map(rel);
    expect(conRegistro.sort()).toEqual(MODULOS_CON_TEXTOS.map((m) => `src/ui/${m}`).sort());
  });

  it('T-IU-02 todo id M-nnn citado entre comillas en src/ui existe en el catálogo (sin ids huérfanos)', () => {
    const conocidos = new Set<string>([...definiciones().keys(), ...Object.keys(ALIAS)]);
    const huerfanos: string[] = [];
    for (const f of fuentesUi) {
      if (f.endsWith('mensajes-catalogo.ts')) continue;
      for (const m of readFileSync(f, 'utf8').matchAll(/['"`](M-\d+)['"`]/g)) {
        if (!conocidos.has(m[1] as string)) huerfanos.push(`${rel(f)}: ${m[1]}`);
      }
    }
    expect([...new Set(huerfanos)]).toEqual([]);
  });

  it('T-IU-02 registrarMensajes rechaza un id repetido con otro texto', () => {
    registrarMensajes({ 'M-9990': 'Texto de prueba ficticio.' });
    expect(() => { registrarMensajes({ 'M-9990': 'Otro texto de prueba ficticio.' }); }).toThrow('MENSAJE_DUPLICADO');
    expect(t('M-9990' as MessageId)).toBe('Texto de prueba ficticio.');
  });

  it('T-IU-02 los rangos definitivos no se solapan: PC-2 M-13xx, PC-5 M-14xx, PC-6 M-15xx, PC-3 M-17xx y PC-4 M-18xx', () => {
    const por = new Map<string, string[]>();
    for (const [id, sitios] of definiciones()) {
      const n = Number(id.slice(2));
      if (n < 1300) continue;
      for (const s of sitios) por.set(s.split(':')[0] as string, [...(por.get(s.split(':')[0] as string) ?? []), id]);
    }
    const rangos = [...por].map(([f, ids]) => { const ns = ids.map((i) => Number(i.slice(2))); return { f, min: Math.min(...ns), max: Math.max(...ns) }; })
      .sort((a, b) => a.min - b.min);
    for (let i = 1; i < rangos.length; i++) {
      const previo = rangos[i - 1] as (typeof rangos)[number];
      const actual = rangos[i] as (typeof rangos)[number];
      expect(actual.min, `${actual.f} se solapa con ${previo.f}`).toBeGreaterThan(previo.max);
    }
  });
});

describe('T-IU-02 INV-I06 INV-G13 barrido de textos prohibidos sobre el catálogo', () => {
  it('T-IU-02 las expresiones atrapan y no atrapan lo que dice la tabla de 8.5', () => {
    for (const c of ['garantizada', 'con garantía', '100 %', 'sin riesgo', 'es seguro', 'SEGURA', '¿Está seguro?', 'infalible']) {
      expect(coincidencias(c), c).not.toEqual([]);
    }
    for (const c of ['asegúrese de revisar', 'inseguridad', 'Copilot', 'GPT-4o', 'Windows + V', 'documento de Word']) {
      if (/Copilot|GPT|Windows|Word/.test(c)) expect(coincidencias(c), c).not.toEqual([]);
      else expect(coincidencias(c), c).toEqual([]);
    }
    for (const c of ['la persona se llama Ana', 'asistentes de IA integrados en el navegador']) expect(coincidencias(c), c).toEqual([]);
    expect(sinDiacriticos('GARANTÍA')).toBe('garantia');
  });

  it('T-IU-02 INV-G13 0 coincidencias en todas las cadenas del catálogo (incluidos M-160 a M-181 y cada PlanBCause)', () => {
    const cadenas = todasLasCadenas();
    expect(cadenas.length).toBeGreaterThan(700);
    expect(hallazgos(cadenas)).toEqual([]);
  });

  it('T-IU-02 M-160 a M-181 existen en el catálogo salvo los reservados (M-161, M-162, M-175, M-179) y no traen términos prohibidos', () => {
    const reservados = new Set([161, 162, 175, 179]);
    for (let n = 160; n <= 181; n++) {
      if (reservados.has(n)) continue;
      const texto = t(`M-${n}` as MessageId, { n: 1, k: 1, total: 1, causa: 'x', marcador: '[X_1]', tipo: 'x', m: 1 });
      expect(texto.length, `M-${n}`).toBeGreaterThan(0);
      expect(coincidencias(texto), `M-${n}`).toEqual([]);
    }
  });

  it('T-IU-02 cada PlanBCause tiene su texto y no trae términos prohibidos', () => {
    expect(Object.keys(CAUSA_PLAN_B).sort()).toEqual(valoresDeUnion('PlanBCause').sort());
    expect(hallazgos(Object.values(CAUSA_PLAN_B))).toEqual([]);
  });

  it('T-IU-02 los textos con parámetros siguen limpios al sustituir valores [P] típicos', () => {
    const ejemplos = todasLasCadenas().map((c) => c.replace(/\{(\w+)\}/g, '3'));
    expect(hallazgos(ejemplos)).toEqual([]);
  });
});

describe('T-IU-02 cobertura de 8.5: un mensaje para cada valor de las enumeraciones', () => {
  const definidos = new Set(definiciones().keys());
  const existe = (id: string): boolean => definidos.has(id) || ALIAS[id] !== undefined;

  it('T-IU-02 ErrorCode: cada código tiene mensaje propio (M-205 solo para ERROR_INTERNO)', () => {
    for (const codigo of valoresDeUnion('ErrorCode')) {
      const id = idDeCodigo(codigo);
      expect(existe(id), `${codigo} → ${id}`).toBe(true);
      if (codigo !== 'ERROR_INTERNO') expect(id, codigo).not.toBe('M-205');
    }
  });

  it('T-IU-02 RejectReason, Role, DetectionStatus, Confidence, DetectionSource, Stage, SuggestionKind y FlagReason tienen mensaje', () => {
    const pares: Array<[keyof typeof ETIQUETA_ID, string[]]> = [
      ['rechazo', valoresDeUnion('RejectReason')], ['rol', [...ROLES]], ['estado', valoresDeUnion('DetectionStatus')],
      ['confianza', valoresDeUnion('Confidence')], ['fuente', valoresDeUnion('DetectionSource')], ['etapa', valoresDeUnion('Stage')],
      ['sugerencia', valoresDeUnion('SuggestionKind')], ['bandera', valoresDeUnion('FlagReason')],
    ];
    for (const [grupo, valores] of pares) {
      const ids = ETIQUETA_ID[grupo] as Readonly<Record<string, string>>;
      expect(Object.keys(ids).sort(), String(grupo)).toEqual([...valores].sort());
      for (const v of valores) expect(existe(ids[v] as string), `${grupo}.${v}`).toBe(true);
    }
  });

  it('T-IU-02 ReviewError, GateReason, MetadataCategory, ParseWarningCode y DATA_TYPES tienen su rango de mensajes', () => {
    const rango = (desde: number, hasta: number): string[] => Array.from({ length: hasta - desde + 1 }, (_, i) => `M-${desde + i}`);
    const erroresDeRevision = valoresDeUnion('ReviewError');
    expect(erroresDeRevision.length).toBe(7);
    for (const c of erroresDeRevision) expect(existe(idDeCodigo(c)) && idDeCodigo(c) !== 'M-205', c).toBe(true);
    for (const id of rango(601, 606)) expect(existe(id), id).toBe(true);
    expect(valoresDeUnion('GateReason').length).toBe(8);
    for (const id of rango(501, 508)) expect(existe(id), id).toBe(true);
    expect(valoresDeUnion('MetadataCategory').length).toBe(19);
    for (const id of rango(401, 419)) expect(existe(id), id).toBe(true);
    const advertencias = valoresDeUnion('ParseWarningCode');
    expect(advertencias.length).toBe(14);
    for (const id of [...rango(301, 313), 'M-1325']) expect(existe(id), id).toBe(true);
    expect(DATA_TYPES.length).toBe(37);
    for (const id of rango(801, 800 + DATA_TYPES.length)) expect(existe(id), id).toBe(true);
  });
});

describe('T-IU-02 INV-I06 el informe legible y los documentos', () => {
  it('T-IU-02 INV-I06 la plantilla del informe legible (src/core/report.ts) no tiene términos prohibidos', () => {
    expect(hallazgos(Object.values(PLANTILLA))).toEqual([]);
    const fuente = readFileSync(join(RAIZ, 'src/core/report.ts'), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const literales = [...fuente.matchAll(/'((?:[^'\\\n]|\\.)+)'/g)].map((m) => m[1] as string).filter((s) => /[a-záéíóúñ]{4,}/i.test(s));
    expect(literales.length).toBeGreaterThan(50);
    expect(hallazgos(literales)).toEqual([]);
  });

  it('T-PV-26 docs/legal/ y docs/guia-abogado.md: 0 promesas de garantía y 0 nombres de proveedores de IA', () => {
    const objetivos: string[] = [];
    const legal = join(RAIZ, 'docs/legal');
    if (existsSync(legal)) for (const n of readdirSync(legal)) if (n.endsWith('.md')) objetivos.push(join(legal, n));
    const guia = join(RAIZ, 'docs/guia-abogado.md');
    if (existsSync(guia)) objetivos.push(guia);
    expect(objetivos.length).toBeGreaterThanOrEqual(2);
    const cuenta = new Map<string, number>();
    for (const f of objetivos) {
      for (const linea of readFileSync(f, 'utf8').split('\n')) {
        for (const h of coincidencias(linea)) cuenta.set(`${rel(f)} → ${h}`, (cuenta.get(`${rel(f)} → ${h}`) ?? 0) + 1);
      }
    }
    // Hallazgos conocidos que PC-7 no corrige (docs/ es del carril D): la guía nombra Chrome, Edge y Windows en sus pasos de uso. Se informan
    // al integrador; esta prueba solo permite que no aumenten ni aparezcan otros. Cuando el carril D los quite, se vacía esta lista.
    const CONOCIDOS: Readonly<Record<string, number>> = {
      'docs/guia-abogado.md → Chrome': 2, 'docs/guia-abogado.md → Edge': 4, 'docs/guia-abogado.md → Windows': 1,
    };
    const excesos = [...cuenta].filter(([k, n]) => n > (CONOCIDOS[k] ?? 0)).map(([k, n]) => `${k} ×${n}`);
    expect(excesos).toEqual([]);
  });
});

describe('T-IU-02 T-PV-26 aviso de privacidad de «Acerca de» y textos legales (D-09, DOC-3-r1)', () => {
  const leer = (n: string): string => readFileSync(join(RAIZ, 'docs/legal', n), 'utf8');

  it('T-IU-02 M-1901 a M-1904 (rango libre M-19xx) existen, cuentan lo que ve el alojamiento y no llevan enlaces ni datos del responsable', () => {
    const textos = (['M-1901', 'M-1902', 'M-1903', 'M-1904'] as const).map((id) => t(id));
    const todo = textos.join('\n');
    expect(todo).toContain('dirección IP');
    expect(todo).toContain('Cloudflare');
    expect(todo).toContain('encargado del tratamiento');
    expect(todo).toContain('DPA');
    expect(todo).toContain('artículos 24 y 25 del Decreto 1377 de 2013');
    expect(todo).not.toContain('26 y 27');   // decisión del dueño (D-09): esos artículos regulan la transferencia, no la transmisión
    expect(todo).toContain('docs/legal/politica-de-privacidad.md');
    expect(todo).not.toMatch(/https?:|www\.|mailto:|@/i);
    expect(hallazgos(textos)).toEqual([]);
  });

  it('T-PV-26 los dos textos legales no dejan ningún [VERIFICAR] ni el marcador {FECHA_V1}, y fijan la vigencia de la v1.0.0 (DOC-5)', () => {
    const politica = leer('politica-de-privacidad.md');
    const terminos = leer('terminos-de-uso.md');
    for (const texto of [politica, terminos]) {
      expect(texto).not.toMatch(/\[VERIFICAR/);
      expect(texto).not.toContain('{FECHA_V1}');
      expect(texto).toContain('Fecha de vigencia: 2 de noviembre de 2026');
    }
  });

  it('T-PV-26 ambos textos explican que la sociedad no es responsable ni encargada de los datos de los documentos y que el usuario sigue siéndolo', () => {
    for (const n of ['politica-de-privacidad.md', 'terminos-de-uso.md']) {
      const texto = leer(n);
      expect(texto, n).toContain('Quién trata qué');
      expect(texto, n).toContain('reciben, ven ni almacenan el texto de los documentos, los datos detectados, la tabla de reemplazos ni la bóveda cifrada');
      expect(texto, n).toContain('no es responsable ni encargada del tratamiento de los datos personales que contienen los documentos del usuario');
      expect(texto, n).toContain('sigue siendo el único responsable de esos datos frente a sus titulares');
      expect(texto, n).toContain('Lo único que trata la sociedad, por medio de su encargado, son los registros técnicos de acceso');
    }
  });

  it('T-PV-26 la política nombra a Cloudflare como encargado con su DPA y su política, y la transmisión según el Decreto 1377 de 2013', () => {
    const politica = leer('politica-de-privacidad.md');
    expect(politica).toContain('Cloudflare Data Processing Addendum');
    expect(politica).toContain('Cloudflare Privacy Policy');
    expect(politica).toContain('encargado del tratamiento');
    expect(politica).toContain('artículos 24 y 25 del Decreto 1377 de 2013, hoy compilados en el Decreto 1074 de 2015');
    expect(politica).not.toContain('artículos 26 y 27');
    expect(politica).toMatch(/aviso de privacidad visible/);
    expect(politica).toMatch(/y no con autorización expresa/);
    expect(politica).toContain('no conserva copia propia de estos registros');  });
});

describe('INV-G13 dist/ (si el build existe)', () => {
  const dist = join(RAIZ, 'dist');
  const licencias = GRUPOS_LICENCIAS.flatMap((g) => [g.titulo, g.intro ?? '', ...g.avisos.flatMap((a) => [a.componente, a.version ?? '', a.licencia, ...a.aviso])]);

  it('INV-G13 los archivos propios de dist/ no nombran proveedores de IA ni prometen garantías, salvo «Créditos y licencias»', () => {
    // Solo con un build recién hecho: verify lo corre de nuevo tras el paso 4 con SIGLOW_DIST_RECIENTE=1. Un dist/ viejo de
    // otra rama daría falsos hallazgos en el paso 3.
    if (process.env.SIGLOW_DIST_RECIENTE !== '1' || !existsSync(join(dist, 'index.html'))) return;
    expect(hallazgosEnDist(dist, licencias)).toEqual([]);
  });
});

describe('T-IU-09 «Créditos y licencias» alineado con LICENSES.md (la fuente)', () => {
  const todo = GRUPOS_LICENCIAS.flatMap((g) => g.avisos.map((a) => ({ ...a, texto: [a.componente, a.version ?? '', a.licencia, ...a.aviso].join('\n') })));
  const porNombre = (n: string) => todo.find((a) => a.componente.startsWith(n));
  const fuente = readFileSync(join(RAIZ, 'LICENSES.md'), 'utf8');

  it('T-IU-09 el titular de @piighost/ner-web es Athroniaeth, no «los autores»', () => {
    const a = porNombre('Código incorporado de @piighost/ner-web');
    expect(a?.texto).toContain('Athroniaeth');
    expect(a?.texto).not.toContain('los autores de @piighost');
    expect(fuente).toContain('Copyright (c) 2025 Athroniaeth');
  });

  it('T-IU-09 la versión de @huggingface/tokenizers es 0.2.0 y core-js 3.50.0 va dentro de pdf.js', () => {
    expect(porNombre('@huggingface/tokenizers')?.version).toBe('0.2.0');
    expect(fuente).toContain('`@huggingface/tokenizers` | 0.2.0');
    const core = porNombre('core-js');
    expect(core?.version).toBe('3.50.0');
    expect(core?.componente).toContain('pdf.js');
    expect(core?.texto).toContain('Denis Pushkarev');
    expect(fuente).toContain('core-js (dentro de pdf.js) | 3.50.0');
  });

  it('T-IU-09 las versiones de las bibliotecas coinciden con las de la tabla de LICENSES.md', () => {
    for (const [nombre, version] of [['Preact', '10.29.8'], ['fflate', '0.8.3'], ['@xmldom/xmldom', '0.9.12'], ['pdf.js', '6.4.299']] as const) {
      expect(porNombre(nombre)?.version, nombre).toBe(version);
      expect(fuente, nombre).toContain(version);
    }
  });
});
