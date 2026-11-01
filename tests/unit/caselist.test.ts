// T-MO-07 · Lista del caso y variantes (7.9, 6.5). Solo datos ficticios.
import { describe, expect, it } from 'vitest';
import {
  LST, esApellidoDeOtraPersona, findCaseMentions, generateVariants, hasTreatment, inferOrgClass, isPossessive, nameUnits, newCaseEntity,
  parseOrg, parsePastedList, personasDeLaVariante, refreshVariants, searchCaseList, sharedVariantWarnings, variantOwners,
} from '../../src/core/caselist';
import { buildSearchView } from '../../src/core/normalize';
import type {
  CaseEntity, CaseEntityId, CaseVariant, IdSource, Part, PartId, VariantClass,
} from '../../src/core/types';

// --- Ayudas ------------------------------------------------------------------------------------

function ids(): IdSource {
  let n = 0;
  return { next: (prefix) => `${prefix}_${(++n).toString(16).padStart(32, '0')}` };
}
const fold = (s: string): string => buildSearchView(s, 'lista', 'cuerpo').text;
const part = (text: string): Part => ({
  id: 'prt_00000000000000000000000000000001' as PartId, docId: 'doc_00000000000000000000000000000001' as Part['docId'],
  kind: 'cuerpo', label: 'Cuerpo del documento', order: 0, index: 1, text, included: true,
});
function persona(name: string, role: Extract<CaseEntity, { kind: 'persona' }>['role'], src: IdSource): CaseEntity {
  const e = newCaseEntity(name, 'persona', role, src);
  if (e === null) throw new Error('rol');
  return e;
}
function organizacion(name: string, role: Extract<CaseEntity, { kind: 'organizacion' }>['role'], src: IdSource): CaseEntity {
  const e = newCaseEntity(name, 'organizacion', role, src);
  if (e === null) throw new Error('rol');
  return e;
}
const classes = (vs: readonly CaseVariant[]): string[] => vs.map((v) => `${v.class}:${v.text}`).sort();
const manual = (text: string): CaseVariant => ({ text, class: 'exacta', confidence: 'alta', enabled: true, origin: 'manual' });
const generated = (text: string, cls: VariantClass, confidence: CaseVariant['confidence'] = 'media'): CaseVariant =>
  ({ text, class: cls, confidence, enabled: true, origin: 'generada' });

/** Menciones de una lista con una sola entidad cuyas variantes son exactamente `variants`. */
function probe(kind: 'persona' | 'organizacion', name: string, variants: CaseVariant[], text: string): string[] {
  const src = ids();
  const base = kind === 'persona' ? persona(name, 'DEMANDANTE', src) : organizacion(name, 'EMPRESA', src);
  const e = { ...base, variants } as CaseEntity;
  return findCaseMentions(part(text), buildSearchView(text, 'lista', 'cuerpo'), [e]).map((d) => text.slice(d.start, d.end));
}

// --- R-LST-01 a R-LST-07 (7.9.7) ---------------------------------------------------------------

describe('T-MO-07 R-LST-01 variante con fronteras Unicode', () => {
  const casan: Array<[string, string, string, string]> = [
    ['Ana Ficticia Rojas', 'ACCIONANTE: ANA FICTICIA ROJAS, mayor de edad', 'ANA FICTICIA ROJAS', 'p'],
    ['Rojas', 'la señora Rojas.', 'Rojas', 'p'],
    ['Rojas-Ejemplo', 'Ana Rojas Ejemplo firmó', 'Rojas Ejemplo', 'p'],
    ['Ana Ficticia Rojas', 'Ana Ficticia\nRojas', 'Ana Ficticia\nRojas', 'p'],
    ['Ferretería Ejemplo', 'FERRETERIA EJEMPLO S. A. S., NIT', 'FERRETERIA EJEMPLO S. A. S.', 'o'],
    ['Rojas', "Rojas's lawyer", 'Rojas', 'p'],
    ['Rojas', 'Ro­jas declaró', 'Ro­jas', 'p'],
    ['Ana Ficticia Rojas', 'Ana Ficticia Rojas', 'Ana Ficticia Rojas', 'p'],
  ];
  for (const [nombre, texto, esperado, k] of casan) {
    it(`casa «${nombre}» en «${texto.replace(/\n/g, '⏎')}»`, () => {
      const kind = k === 'o' ? 'organizacion' : 'persona';
      const variants = k === 'o' ? [generated(nombre, 'exacta', 'alta')] : [manual(nombre)];
      expect(probe(kind, nombre, variants, texto)).toEqual([esperado]);
    });
  }
  const noCasan: Array<[string, string, string]> = [
    ['Ana', 'Anabel llegó', 'p'], ['Rojas', 'Barojas', 'p'], ['Rojas', 'ROJAS2', 'p'],
    ['Ana Ficticia Rojas', 'Ana Ficticia Rojasa', 'p'], ['Ferretería Ejemplo', 'Ferretería Ejemplos', 'o'],
    ['Prueba', 'Pruebas documentales', 'p'],
  ];
  for (const [nombre, texto, k] of noCasan) {
    it(`no casa «${nombre}» en «${texto}»`, () => {
      const kind = k === 'o' ? 'organizacion' : 'persona';
      const variants = k === 'o' ? [generated(nombre, 'exacta', 'alta')] : [manual(nombre)];
      expect(probe(kind, nombre, variants, texto)).toEqual([]);
    });
  }
});

describe('T-MO-07 R-LST-02 iniciales de persona', () => {
  const v = [generated('A. F. R.', 'iniciales', 'baja')];
  const casan: Array<[string, string]> = [
    ['identificada como A. F. R., manifestó', 'A. F. R.'], ['AFR firmó', 'AFR'], ['según A.F.R. Tomó', 'A.F.R.'],
    ['A F R', 'A F R'], ['(A.F.R.)', 'A.F.R.'], ['la Dra. A. F. R. dijo', 'A. F. R.'],
  ];
  for (const [texto, esperado] of casan) it(`casa «${texto}»`, () => expect(probe('persona', 'Ana Ficticia Rojas', v, texto)).toEqual([esperado]));
  for (const texto of ['dijo afr que', 'firma A.F.R.T. al final', 'M. A. F. R. firmó', 'A. F. R. M. firmó', 'AFRICA', 'T.A.F.R.']) {
    it(`no casa «${texto}»`, () => expect(probe('persona', 'Ana Ficticia Rojas', v, texto)).toEqual([]));
  }
});

describe('T-MO-07 R-LST-03 tratamiento de persona', () => {
  for (const t of ['la señora ', 'La Señora ', 'el señor ', 'Dra. ', 'doña ', 'Sr. ', 'Mrs. ', 'del doctor ', 'al señor ', 'según la Dra ']) {
    it(`casa «${t}»`, () => expect(hasTreatment(fold(t))).toBe(true));
  }
  for (const t of ['la casa de ', 'el demandado ', 'su señoría ', 'abandon ', 'Doctorado en ', 'la ', 'la sra.Prueba ']) {
    it(`no casa «${t}»`, () => expect(hasTreatment(fold(t))).toBe(false));
  }
});

describe('T-MO-07 R-LST-04 posesivo', () => {
  for (const t of ["'s lawyer", "' house", "'s,", '’s claim']) it(`casa «${t}»`, () => expect(isPossessive(fold(t))).toBe(true));
  for (const t of ['s lawyer', "'sa", "'Ana", " 's", 'es']) it(`no casa «${t}»`, () => expect(isPossessive(fold(t))).toBe(false));
});

describe('T-MO-07 R-LST-05 sufijo societario', () => {
  const re = new RegExp(LST.INICIO + LST.SUFIJO + LST.FIN, 'u');
  for (const t of ['S.A.S.', 'SAS', 'S. A. S.', 'S.A.', 'Ltda.', 'E.S.P.', 'E.U.', '& Cía.', 'y Cía. S. en C.', 'E.S.E.']) {
    it(`casa «${t}» completo`, () => {
      const v = buildSearchView(t, 'lista', 'cuerpo');
      const m = re.exec(v.text);
      expect(m).not.toBeNull();
      expect(m?.[0].length).toBe(v.text.length);
    });
  }
  for (const t of ['sábado', 'Sasha', 'ESPAÑA', 'esa', 'ese día', 'EU', 'Ltd']) it(`no casa «${t}»`, () => expect(re.test(fold(t))).toBe(false));
});

describe('T-MO-07 R-LST-06 token de entidad de salud', () => {
  const re = new RegExp(LST.SALUD, 'u');
  for (const t of ['EPS', 'E.P.S.', 'eps', 'I.P.S', 'I. P. S.', 'IPS']) it(`casa «${t}»`, () => expect(re.test(fold(t))).toBe(true));
  for (const t of ['epsilon', 'tips', 'eps2', 'E.P', 'ipsum']) it(`no casa «${t}»`, () => expect(re.test(fold(t))).toBe(false));
});

describe('T-MO-07 R-LST-07 sigla de organización', () => {
  const v = [generated('FEI', 'sigla', 'baja')];
  for (const [t, e] of [['FEI respondió', 'FEI'], ['la F.E.I. pagó', 'F.E.I.'], ['F. E. I.', 'F. E. I.'], ['(FEI)', 'FEI']] as const) {
    it(`casa «${t}»`, () => expect(probe('organizacion', 'Ferretería Ejemplo de Insumos S.A.S.', v, t)).toEqual([e]));
  }
  for (const t of ['la fei no', 'FEIS', 'F.E.I.S.', 'Fei dijo']) {
    it(`no casa «${t}»`, () => expect(probe('organizacion', 'Ferretería Ejemplo de Insumos S.A.S.', v, t)).toEqual([]));
  }
});

// --- Generación de variantes (7.9.2 a 7.9.4) ----------------------------------------------------

describe('T-MO-07 generación de variantes', () => {
  const gen = (e: CaseEntity, all: CaseEntity[] = [e]): string[] => classes(generateVariants(e, all));
  const src = ids();

  it('unidades del nombre: partículas y «y»', () => {
    expect(nameUnits('María José de la Prueba Rojas-Ficticia')).toEqual(['María', 'José', 'de la Prueba', 'Rojas-Ficticia']);
    expect(nameUnits('Luis Ortega y Ejemplo')).toEqual(['Luis', 'Ortega y Ejemplo']);
  });
  it('Ana Ficticia Rojas', () => {
    expect(gen(persona('Ana Ficticia Rojas', 'DEMANDANTE', src))).toEqual([
      'apellido_suelto:Ficticia', 'apellido_suelto:Rojas', 'apellidos:Ana Ficticia', 'apellidos:Ficticia Rojas',
      'exacta:Ana Ficticia Rojas', 'iniciales:A. F. R.', 'nombre_suelto:Ana',
    ].sort());
  });
  it('María José de la Prueba Rojas-Ficticia', () => {
    expect(gen(persona('María José de la Prueba Rojas-Ficticia', 'PACIENTE', src))).toEqual([
      'exacta:María José de la Prueba Rojas-Ficticia', 'apellidos:María de la Prueba', 'apellidos:María José de la Prueba',
      'apellidos:José de la Prueba', 'apellidos:de la Prueba Rojas-Ficticia', 'apellido_suelto:de la Prueba',
      'apellido_suelto:Prueba', 'apellido_suelto:Rojas-Ficticia', 'apellido_suelto:Rojas', 'apellido_suelto:Ficticia',
      'nombre_suelto:María', 'nombre_suelto:José', 'nombre_suelto:María José', 'iniciales:M. J. P. R.', 'iniciales:M. P. R.',
    ].sort());
  });
  it('dos unidades: sin iniciales de menos de 3 letras; solo la variante con una inicial más (AJ-2)', () => {
    expect(gen(persona('Pedro Ejemplo', 'TESTIGO', src))).toEqual(['apellido_suelto:Ejemplo', 'exacta:Pedro Ejemplo', 'iniciales:P. E. _.', 'nombre_suelto:Pedro'].sort());
  });
  it('apellido con guion y dos unidades', () => {
    expect(gen(persona('Ana Rojas-Ejemplo', 'DEMANDANTE', src))).toEqual([
      'apellido_suelto:Ejemplo', 'apellido_suelto:Rojas', 'apellido_suelto:Rojas-Ejemplo', 'apellidos:Ana Rojas',
      'exacta:Ana Rojas-Ejemplo', 'iniciales:A. R. _.', 'nombre_suelto:Ana',
    ].sort());
  });
  it('una sola palabra: solo la exacta', () => {
    expect(gen(persona('Prueba', 'CONTACTO', src))).toEqual(['exacta:Prueba']);
  });
  it('EPS Ejemplo S.A.', () => {
    expect(gen(organizacion('EPS Ejemplo S.A.', 'EPS', src))).toEqual([
      'exacta:EPS Ejemplo S.A.', 'razon_social_sin_sufijo:Ejemplo EPS', 'razon_social_sin_sufijo:Ejemplo',
    ].sort());
  });
  it('Ferretería Ejemplo de Insumos S.A.S. genera la sigla FEI', () => {
    expect(gen(organizacion('Ferretería Ejemplo de Insumos S.A.S.', 'EMPRESA', src))).toEqual(['exacta:Ferretería Ejemplo de Insumos S.A.S.', 'sigla:FEI'].sort());
  });
  it('Ferretería Ejemplo S.A.S. no genera sigla de dos letras', () => {
    expect(gen(organizacion('Ferretería Ejemplo S.A.S.', 'EMPRESA', src))).toEqual(['exacta:Ferretería Ejemplo S.A.S.']);
  });
  it('parseOrg separa sufijo, token de salud y núcleo', () => {
    const p = parseOrg('Clínica Ejemplo IPS Ltda.');
    expect(p.core).toBe('Clínica Ejemplo');
    expect(p.suffix).toBe('ltda.');
    expect(p.health).toBe('ips');
    expect(p.healthPos).toBe('fin');
  });
  it('confianza base por clase', () => {
    const vs = generateVariants(persona('Ana Ficticia Rojas', 'DEMANDANTE', src), []);
    const conf = Object.fromEntries(vs.map((v) => [v.class, v.confidence]));
    expect(conf).toEqual({ exacta: 'alta', apellidos: 'media', apellido_suelto: 'media', nombre_suelto: 'baja', iniciales: 'baja' });
    expect(vs.every((v) => v.enabled && v.origin === 'generada')).toBe(true);
  });
});

// --- Extremo a extremo (7.9.8) ------------------------------------------------------------------

function listOf(...specs: Array<[CaseEntity, string]>): { list: CaseEntity[]; short: Map<CaseEntityId, string> } {
  const list = refreshVariants(specs.map(([e]) => e));
  return { list, short: new Map(specs.map(([e, s]) => [e.id, s])) };
}
function format(text: string, list: CaseEntity[], short: Map<CaseEntityId, string>): string[] {
  const p = part(text);
  const ms = findCaseMentions(p, buildSearchView(text, 'lista', 'cuerpo'), list);
  return ms.map((m) => {
    const alt = variantOwners(text.slice(m.start, m.end), list).filter((id) => id !== m.caseEntityId);
    return `${text.slice(m.start, m.end)}|${short.get(m.caseEntityId as CaseEntityId)}|${m.variantClass}|${m.confidence}` +
      (alt.length > 0 && m.confidence === 'baja' ? `|alt:${alt.map((a) => short.get(a)).join(',')}` : '');
  });
}

describe('T-MO-07 casos de extremo a extremo (7.9.8)', () => {
  it('L-A consistencia y MAYÚSCULAS', () => {
    const src = ids();
    const { list, short } = listOf([persona('Ana Ficticia Rojas', 'DEMANDANTE', src), 'ANA']);
    const texto = "ACCIONANTE: ANA FICTICIA ROJAS\nLa señora Rojas, identificada como A. F. R., dijo que Ana Ficticia firmó. Rojas's lawyer y la familia de los Rojas. Las flores rojas no cuentan. Ana llamó.";
    expect(format(texto, list, short)).toEqual([
      'ANA FICTICIA ROJAS|ANA|mayusculas|alta', 'Rojas|ANA|apellido_suelto|media', 'A. F. R.|ANA|iniciales|baja',
      'Ana Ficticia|ANA|apellidos|media', 'Rojas|ANA|posesivo|media', 'Rojas|ANA|apellido_suelto|media', 'Ana|ANA|nombre_suelto|baja',
    ]);
  });
  it('L-B apellido compartido: antecedente más cercano y tratamiento «doña»', () => {
    const src = ids();
    const { list, short } = listOf([persona('Ana Ficticia Rojas', 'DEMANDANTE', src), 'ANA'], [persona('Luis Prueba Rojas', 'TESTIGO', src), 'LUIS']);
    const texto = 'Ana Ficticia Rojas declaró. Luis Prueba Rojas declaró. El señor Rojas dijo que la doña Ana no vino.';
    expect(format(texto, list, short)).toEqual([
      'Ana Ficticia Rojas|ANA|exacta|alta', 'Luis Prueba Rojas|LUIS|exacta|alta', 'Rojas|LUIS|apellido_suelto|baja|alt:ANA', 'Ana|ANA|nombre_suelto|media',
    ]);
  });
  it('L-C organizaciones y conflicto persona/organización', () => {
    const src = ids();
    const { list, short } = listOf(
      [organizacion('EPS Ejemplo S.A.', 'EPS', src), 'EPS'],
      [organizacion('Ferretería Ejemplo de Insumos S.A.S.', 'EMPRESA', src), 'FER'],
      [persona('Pedro Ejemplo Prueba', 'TESTIGO', src), 'PEDRO'],
    );
    const texto = 'La EPS EJEMPLO S.A. negó. Ejemplo EPS insistió. Ferreteria Ejemplo de Insumos SAS pagó; FEI respondió; la fei no. El señor Ejemplo declaró. Ejemplo E.P.S. respondió.';
    expect(format(texto, list, short)).toEqual([
      'EPS EJEMPLO S.A.|EPS|mayusculas|alta', 'Ejemplo EPS|EPS|razon_social_sin_sufijo|media',
      'Ferreteria Ejemplo de Insumos SAS|FER|sin_tildes|alta', 'FEI|FER|sigla|baja',
      'Ejemplo|PEDRO|apellido_suelto|baja|alt:EPS', 'Ejemplo E.P.S.|EPS|razon_social_sin_sufijo|media',
    ]);
  });
  it('L-D nombres compuestos, partículas y guion', () => {
    const src = ids();
    const { list, short } = listOf([persona('María José de la Prueba Rojas-Ficticia', 'PACIENTE', src), 'MJ']);
    const texto = 'MARÍA JOSÉ DE LA PRUEBA ROJAS FICTICIA (paciente). La señora De la Prueba asistió con María José. Informe de M.J.P.R. La prueba documental.';
    expect(format(texto, list, short)).toEqual([
      'MARÍA JOSÉ DE LA PRUEBA ROJAS FICTICIA|MJ|mayusculas|alta', 'De la Prueba|MJ|apellido_suelto|media',
      'María José|MJ|nombre_suelto|baja', 'M.J.P.R.|MJ|iniciales|baja',
    ]);
  });
  it('L-E apellido que coincide con el nombre de una empresa', () => {
    const src = ids();
    const { list, short } = listOf([persona('Ana Ficticia Rojas', 'DEMANDANTE', src), 'ANA'], [organizacion('Rojas Ejemplo S.A.S.', 'EMPRESA', src), 'RE']);
    const texto = 'Rojas Ejemplo S.A.S. contrató a Ana Ficticia Rojas. Rojas firmó. La señora Rojas cobró.';
    expect(format(texto, list, short)).toEqual([
      'Rojas Ejemplo S.A.S.|RE|exacta|alta', 'Ana Ficticia Rojas|ANA|exacta|alta', 'Rojas|ANA|apellido_suelto|baja', 'Rojas|ANA|apellido_suelto|media',
    ]);
  });
});

// --- Candidatos e invariantes -------------------------------------------------------------------

describe('T-MO-07 candidatos de la lista (6.4.2, 7.9.1)', () => {
  const src = ids();
  const ana = persona('Ana Ficticia Rojas', 'DEMANDANTE', src);
  const eps = organizacion('EPS Ejemplo S.A.', 'EPS', src);
  const list = refreshVariants([ana, eps]);
  const texto = 'Ana Ficticia Rojas demandó a la EPS Ejemplo S.A. ayer.';
  const ms = searchCaseList(part(texto), list);

  it('persona: PERSONA con su rol; organización: su clase, nunca un rol procesal', () => {
    expect(ms).toHaveLength(2);
    expect(ms[0]).toMatchObject({ type: 'PERSONA', role: 'DEMANDANTE', source: 'lista', caseEntityId: ana.id, variantClass: 'exacta', confidence: 'alta', score: 0.9 });
    expect(ms[1]).toMatchObject({ type: 'EPS', role: 'EPS', source: 'lista', caseEntityId: eps.id, variantClass: 'exacta', confidence: 'alta' });
  });
  it('el tramo cumple part.text.slice(start, end) y no cruza otra parte', () => {
    expect(texto.slice(ms[0]?.start, ms[0]?.end)).toBe('Ana Ficticia Rojas');
    expect(texto.slice(ms[1]?.start, ms[1]?.end)).toBe('EPS Ejemplo S.A.');
    expect(ms.every((m) => m.partId === part(texto).id)).toBe(true);
  });
  it('score nominal por confianza: alta 0,9 · media 0,6 · baja 0,3', () => {
    const t = 'Ficticia dijo que Ana llegó. Ana Ficticia Rojas.';
    const r = searchCaseList(part(t), list);
    const byConf = new Map(r.map((m) => [m.confidence, m.score]));
    expect(byConf.get('alta')).toBe(0.9);
    expect(byConf.get('media')).toBe(0.6);
    expect(byConf.get('baja')).toBe(0.3);
  });
  it('tramos con invisibles y espacio duro vuelven a posiciones canónicas', () => {
    const t = 'Firmó Ro­jas y Ana Ficticia\nRojas.';
    const e = { ...persona('Ana Ficticia Rojas', 'DEMANDANTE', ids()) };
    const l = refreshVariants([e]);
    const r = searchCaseList(part(t), l);
    expect(r.map((m) => t.slice(m.start, m.end))).toEqual(['Ro­jas', 'Ana Ficticia\nRojas']);
  });
  it('variantes apagadas no se buscan; las manuales se buscan', () => {
    const e0 = persona('Ana Ficticia Rojas', 'DEMANDANTE', ids());
    const l = refreshVariants([e0]).map((e) => ({
      ...e,
      variants: [...e.variants.map((v) => (v.class === 'nombre_suelto' ? { ...v, enabled: false } : v)), manual('Anita')],
    })) as CaseEntity[];
    const t = 'Ana llamó; Anita respondió.';
    const r = searchCaseList(part(t), l);
    expect(r.map((m) => t.slice(m.start, m.end))).toEqual(['Anita']);
    expect(r[0]).toMatchObject({ variantClass: 'exacta', confidence: 'alta' });
  });
  it('lista vacía o texto vacío no lanza', () => {
    expect(searchCaseList(part('Ana'), [])).toEqual([]);
    expect(searchCaseList(part(''), list)).toEqual([]);
  });
  it('la organización sin sufijo en la lista absorbe el sufijo pegado en el texto', () => {
    const e = organizacion('Ferretería Ejemplo', 'EMPRESA', ids());
    const l = refreshVariants([e]);
    const t = 'Pagó FERRETERÍA EJEMPLO S.A.S. ayer.';
    const r = searchCaseList(part(t), l);
    expect(r.map((m) => [t.slice(m.start, m.end), m.variantClass, m.confidence])).toEqual([['FERRETERÍA EJEMPLO S.A.S.', 'mayusculas', 'alta']]);
  });
  it('otro sufijo o ausencia de sufijo frente a un nombre con sufijo: razón social sin sufijo', () => {
    const e = organizacion('Ferretería Ejemplo S.A.S.', 'EMPRESA', ids());
    const l = refreshVariants([e]);
    const t = 'Ferretería Ejemplo Ltda. y Ferretería Ejemplo.';
    const r = searchCaseList(part(t), l);
    expect(r.map((m) => [t.slice(m.start, m.end), m.variantClass, m.confidence])).toEqual([
      ['Ferretería Ejemplo Ltda.', 'razon_social_sin_sufijo', 'media'], ['Ferretería Ejemplo', 'razon_social_sin_sufijo', 'media'],
    ]);
  });
  it('rendimiento: 50 entidades sobre 200 KB de texto', () => {
    const src2 = ids();
    const ents = Array.from({ length: 50 }, (_, i) => persona(`Nombre${String.fromCharCode(97 + (i % 26))}${i} Apellidouno${i} Apellidodos${i}`, 'TESTIGO', src2));
    const l = refreshVariants(ents);
    const t = 'Texto de relleno sin coincidencias en el documento de prueba. '.repeat(3500);
    const t0 = performance.now();
    searchCaseList(part(t), l);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});

describe('T-MO-07 INV-L01 kind y role cumplen 6.2.2', () => {
  it('INV-L01 «Ferretería Ejemplo S.A.S.; demandada» entra como organización EMPRESA', () => {
    const r = parsePastedList('Ferretería Ejemplo S.A.S.; demandada', ids());
    expect(r.errors).toEqual([]);
    expect(r.entities).toHaveLength(1);
    expect(r.entities[0]).toMatchObject({ kind: 'organizacion', role: 'EMPRESA', name: 'Ferretería Ejemplo S.A.S.' });
  });
  it('INV-L01 una organización nunca tiene rol de persona y una persona nunca una clase', () => {
    expect(newCaseEntity('Ejemplo S.A.S.', 'organizacion', 'DEMANDANTE', ids())).toBeNull();
    expect(newCaseEntity('Ana Ficticia Rojas', 'persona', 'EMPRESA', ids())).toBeNull();
    expect(newCaseEntity('Ana Ficticia Rojas', 'persona', 'OTRA_PERSONA', ids())).toMatchObject({ kind: 'persona', role: 'OTRA_PERSONA' });
    expect(newCaseEntity('Clínica Ejemplo', 'organizacion', 'IPS', ids())).toMatchObject({ kind: 'organizacion', role: 'IPS' });
  });
  it('INV-L01 los candidatos de organización llevan su clase y nunca un rol procesal', () => {
    const r = parsePastedList('Ferretería Ejemplo S.A.S.; demandada\nAna Ficticia Rojas; demandante', ids());
    const l = r.entities;
    const t = 'Ferretería Ejemplo S.A.S. y Ana Ficticia Rojas.';
    const ms = searchCaseList(part(t), l);
    expect(ms.map((m) => [m.type, m.role])).toEqual([['EMPRESA', 'EMPRESA'], ['PERSONA', 'DEMANDANTE']]);
  });
});

describe('T-MO-07 INV-L02 una variante exacta generada igual a name', () => {
  const nombres: Array<['persona' | 'organizacion', string]> = [
    ['persona', 'Ana Ficticia Rojas'], ['persona', 'Prueba'], ['persona', 'Li'], ['persona', 'María José de la Prueba Rojas-Ficticia'],
    ['persona', 'Luis Ortega y Ejemplo Prueba'], ['organizacion', 'EPS Ejemplo S.A.'], ['organizacion', 'Ferretería Ejemplo'],
    ['organizacion', 'Clínica Ejemplo IPS Ltda.'], ['organizacion', 'S.A.S.'], ['organizacion', 'Ejemplo & Cía. S. en C.'],
  ];
  for (const [kind, name] of nombres) {
    it(`INV-L02 «${name}» (${kind})`, () => {
      const e = kind === 'persona' ? persona(name, 'TESTIGO', ids()) : organizacion(name, 'EMPRESA', ids());
      const ex = generateVariants(e, [e]).filter((v) => v.class === 'exacta');
      expect(ex).toHaveLength(1);
      expect(ex[0]?.text).toBe(name.normalize('NFC'));
      expect(ex[0]?.origin).toBe('generada');
    });
  }
});

describe('T-MO-07 INV-L03 variantes duplicadas y compartidas', () => {
  it('INV-L03 sin dos variantes activas con el mismo texto (vista lista) dentro de una entidad', () => {
    const nombres = ['Ana Ficticia Rojas', 'Ana Rojas-Rojas', 'Pedro Ejemplo', 'María José de la Prueba Rojas-Ficticia', 'Ana Ana Ana Ana'];
    for (const n of nombres) {
      const e = persona(n, 'TESTIGO', ids());
      const textos = generateVariants(e, [e]).filter((v) => v.enabled).map((v) => fold(v.text).replace(/-/g, ' '));
      expect(new Set(textos).size, n).toBe(textos.length);
    }
  });
  it('INV-L03 «Rojas» en dos personas: se marca en ambas con confianza baja y hay aviso M-44', () => {
    const src = ids();
    const a = persona('Ana Ficticia Rojas', 'DEMANDANTE', src);
    const b = persona('Luis Prueba Rojas', 'TESTIGO', src);
    const l = refreshVariants([a, b]);
    for (const e of l) {
      const suelto = e.variants.find((v) => v.class === 'apellido_suelto' && v.text === 'Rojas');
      expect(suelto?.confidence, e.name).toBe('baja');
      const otro = e.variants.find((v) => v.class === 'apellido_suelto' && v.text !== 'Rojas');
      expect(otro?.confidence).toBe('media');
    }
    const avisos = sharedVariantWarnings(l);
    expect(avisos.filter((w) => w.text === 'Rojas').map((w) => w.entityId).sort()).toEqual([a.id, b.id].sort());
    expect(avisos.every((w) => w.code === 'M-44')).toBe(true);
    expect(variantOwners('Rojas', l).sort()).toEqual([a.id, b.id].sort());
  });
  it('INV-L03 la mención de una variante compartida sale con confianza baja', () => {
    const src = ids();
    const l = refreshVariants([persona('Ana Ficticia Rojas', 'DEMANDANTE', src), persona('Luis Prueba Rojas', 'TESTIGO', src)]);
    const t = 'Dijo Rojas.';
    const ms = searchCaseList(part(t), l);
    expect(ms).toHaveLength(1);
    expect(ms[0]?.confidence).toBe('baja');
  });
  it('INV-L03 PB-3-r1 la variante compartida va a la entidad con más menciones de nombre completo o apellidos; a igualdad, a la más cercana antes', () => {
    const src = ids();
    const { list, short } = listOf([persona('Adriana Prueba Torres', 'DEMANDANTE', src), 'ADR'], [persona('Nicolás Prueba Mora', 'PACIENTE', src), 'NIC']);
    // D-16 (PB-3-r3): entre dos PERSONAS esta dueña es solo provisional, para la fusión (D-03 B y E miran el `caseEntityId`). La
    // detección queda sin persona y la decide el revisor (entities.ts; prueba en tests/unit/entities.test.ts, bloque PB-3-r3).
    // Nicolás es el protagonista (3 menciones fuertes frente a 1): «Prueba» suelto es suyo aunque Adriana se nombre justo antes.
    let t = 'Nicolás Prueba Mora, Prueba Mora y NICOLÁS PRUEBA MORA. Así lo dijo Adriana Prueba Torres.\nCabe resaltar que Prueba recibió amenazas.';
    expect(format(t, list, short).filter((x) => x.startsWith('Prueba|'))).toEqual(['Prueba|NIC|apellido_suelto|baja|alt:ADR']);
    // Antes (7.9.6 b, la más cercana antes del tramo) era de Adriana: el corpus da 15 de 31 aciertos con esa regla y 26 de 31 con esta.
    // A igualdad de menciones fuertes decide la más cercana antes (7.9.8 L-B sigue igual).
    t = 'Nicolás Prueba Mora declaró. Adriana Prueba Torres declaró. Después Prueba firmó.';
    expect(format(t, list, short).filter((x) => x.startsWith('Prueba|'))).toEqual(['Prueba|ADR|apellido_suelto|baja|alt:NIC']);
    // El tratamiento con una sola persona entre las candidatas sigue decidiendo primero (7.9.6 a).
    const o = organizacion('Comercial Prueba S.A.S.', 'EMPRESA', src);
    const l2 = refreshVariants([persona('Adriana Prueba Torres', 'DEMANDANTE', src), o]);
    t = 'Comercial Prueba S.A.S. y Comercial Prueba firmaron. Luego la señora Prueba llamó.';
    const ms = searchCaseList(part(t), l2).filter((m) => t.slice(m.start, m.end) === 'Prueba');
    expect(ms.map((m) => m.caseEntityId)).toEqual([l2[0]?.id]);
  });
  it('INV-L03 D-16 personasDeLaVariante: las personas que comparten la variante, también con un tratamiento pegado; una organización o una variante apagada no cuentan', () => {
    const src = ids();
    const a = persona('Adriana Prueba Torres', 'DEMANDANTE', src);
    const b = persona('Nicolás Prueba Mora', 'PACIENTE', src);
    const o = organizacion('Comercial Prueba S.A.S.', 'EMPRESA', src);
    const l = refreshVariants([a, b, o]);
    for (const t of ['Prueba', 'PRUEBA', 'Sr. Prueba', 'la doctora Prueba', 'señor Prueba']) expect(personasDeLaVariante(t, l), t).toEqual([a.id, b.id]);
    expect(personasDeLaVariante('Prueba Torres', l)).toEqual([a.id]);
    expect(personasDeLaVariante('Adriana Prueba Torres', l)).toEqual([a.id]);
    expect(personasDeLaVariante('Comercial Prueba', l)).toEqual([]);
    // «Don» solo como palabra: «Dona» o «Donato» no son tratamientos.
    expect(personasDeLaVariante('Donato Prueba', l)).toEqual([]);
    const apagada = refreshVariants(l.map((e) => (e.id === b.id ? { ...e, variants: e.variants.map((v) => (v.text === 'Prueba' ? { ...v, enabled: false } : v)) } : e)) as CaseEntity[]);
    expect(personasDeLaVariante('Prueba', apagada)).toEqual([a.id]);
    // La lista recibida no cambia.
    const antes = JSON.stringify(l);
    personasDeLaVariante('Sr. Prueba', l);
    expect(JSON.stringify(l)).toBe(antes);
  });
  it('INV-L03 M-72 esApellidoDeOtraPersona: el apellido suelto de la lista es el apellido de otro nombre del texto; una forma corta de la misma persona no', () => {
    const src = ids();
    const [ana] = refreshVariants([persona('Ana Ficticia Rojas', 'DEMANDANTE', src)]) as [CaseEntity];
    for (const otro of ['Luis Ficticio Rojas', 'LUIS FICTICIO ROJAS', 'señor Luis Ficticio Rojas', 'Luis Ficticia Rojas', 'Luis Alberto Prueba Rojas']) {
      expect(esApellidoDeOtraPersona('Rojas', ana, otro), otro).toBe(true);
    }
    // El nombre de pila no es un apellido; una forma corta de Ana (con sus palabras, o con una inicial) no es otra persona; una
    // palabra sola no es un nombre.
    for (const otro of ['Rojas Prueba', 'Ana Rojas', 'A. Rojas', 'Ana F. Rojas', 'Rojas', 'Luis Prueba']) expect(esApellidoDeOtraPersona('Rojas', ana, otro), otro).toBe(false);
    // Las variantes activas de la persona también son suyas: un alias del abogado («Anita») no es otra persona.
    const conAlias: CaseEntity = { ...ana, variants: [...ana.variants, { text: 'Anita Ficticia Rojas', class: 'exacta', confidence: 'alta', origin: 'manual', enabled: true } satisfies CaseVariant] };
    expect(esApellidoDeOtraPersona('Rojas', conAlias, 'Anita Ficticia Rojas')).toBe(false);
    expect(esApellidoDeOtraPersona('Rojas', ana, 'Anita Ficticia Rojas')).toBe(true);
    // Una parte de un apellido con partícula o con guion.
    const [pedro] = refreshVariants([persona('Pedro Ejemplo del Valle', 'DEMANDANTE', src)]) as [CaseEntity];
    expect(esApellidoDeOtraPersona('del Valle', pedro, 'Luis Prueba del Valle')).toBe(true);
  });
  it('INV-L03 una variante no compartida conserva su confianza base', () => {
    const src = ids();
    const l = refreshVariants([persona('Ana Ficticia Rojas', 'DEMANDANTE', src), persona('Luis Prueba Rojas', 'TESTIGO', src)]);
    expect(sharedVariantWarnings(l).some((w) => w.text === 'Ficticia')).toBe(false);
    expect(variantOwners('Ficticia', l)).toEqual([l[0]?.id]);
  });
  it('INV-L03 una variante apagada en la otra entidad deja de contar como compartida', () => {
    const src = ids();
    const a = persona('Ana Ficticia Rojas', 'DEMANDANTE', src);
    const b = persona('Luis Prueba Rojas', 'TESTIGO', src);
    const l0 = refreshVariants([a, b]);
    const l1 = l0.map((e) => (e.id === b.id ? { ...e, variants: e.variants.map((v) => (v.text === 'Rojas' ? { ...v, enabled: false } : v)) } : e)) as CaseEntity[];
    const l2 = refreshVariants(l1);
    const rojasA = l2.find((e) => e.id === a.id)?.variants.find((v) => v.text === 'Rojas');
    expect(rojasA?.confidence).toBe('media');
    expect(l2.find((e) => e.id === b.id)?.variants.find((v) => v.text === 'Rojas')?.enabled).toBe(false);
  });
  it('refreshVariants conserva las variantes manuales y no modifica la lista recibida', () => {
    const e = { ...persona('Ana Ficticia Rojas', 'DEMANDANTE', ids()), variants: [manual('Anita')] } as CaseEntity;
    const antes = JSON.stringify([e]);
    const [r] = refreshVariants([e]);
    expect(JSON.stringify([e])).toBe(antes);
    expect(r?.variants.some((v) => v.origin === 'manual' && v.text === 'Anita')).toBe(true);
    expect(r?.variants.filter((v) => v.class === 'exacta' && v.origin === 'generada')).toHaveLength(1);
  });
});

describe('T-MO-07 INV-L04 clave canónica LISTA:<caseEntityId>', () => {
  it('INV-L04 toda coincidencia produce LISTA:<id> sea cual sea la clase', () => {
    const src = ids();
    const a = persona('Ana Ficticia Rojas', 'DEMANDANTE', src);
    const o = organizacion('Ferretería Ejemplo de Insumos S.A.S.', 'EMPRESA', src);
    const l = refreshVariants([a, o]);
    const t = "ANA FICTICIA ROJAS; la señora Rojas; A. F. R.; Ana Ficticia; Rojas's; Ana; Ferreteria Ejemplo de Insumos SAS; FEI; Ferretería Ejemplo de Insumos.";
    const ms = searchCaseList(part(t), l);
    const clases = new Set(ms.map((m) => m.variantClass));
    expect(clases).toEqual(new Set<VariantClass>(['mayusculas', 'apellido_suelto', 'iniciales', 'apellidos', 'posesivo', 'nombre_suelto', 'sin_tildes', 'sigla', 'razon_social_sin_sufijo']));
    for (const m of ms) expect(m.canonicalKey).toBe('LISTA:' + (m.caseEntityId as string));
  });
});

// --- «Pegar lista» (6.5.2) ------------------------------------------------------------------------

describe('T-MO-07 «pegar lista» (6.5.2)', () => {
  const roles: Array<[string, string]> = [
    ['demandante', 'DEMANDANTE'], ['accionante', 'DEMANDANTE'], ['tutelante', 'DEMANDANTE'], ['convocante', 'DEMANDANTE'],
    ['demandado', 'DEMANDADO'], ['demandada', 'DEMANDADO'], ['accionado', 'DEMANDADO'], ['accionada', 'DEMANDADO'],
    ['convocado', 'DEMANDADO'], ['convocada', 'DEMANDADO'], ['testigo', 'TESTIGO'], ['paciente', 'PACIENTE'],
    ['cliente', 'CLIENTE'], ['contacto', 'CONTACTO'], ['otra persona', 'OTRA_PERSONA'], ['familiar', 'OTRA_PERSONA'],
    ['funcionario', 'OTRA_PERSONA'], ['funcionaria', 'OTRA_PERSONA'],
  ];
  for (const [palabra, rol] of roles) {
    it(`«Nombre; ${palabra}» → persona ${rol}`, () => {
      const r = parsePastedList(`Ana Ficticia Rojas; ${palabra}`, ids());
      expect(r.errors).toEqual([]);
      expect(r.entities[0]).toMatchObject({ kind: 'persona', role: rol });
    });
  }
  it('el rol no distingue mayúsculas ni tildes ni espacios sobrantes', () => {
    const r = parsePastedList('Ana Ficticia Rojas;  DEMANDANTE \nLuis Prueba Rojas ; Testigo\nMaría Ejemplo; Otra   Persona', ids());
    expect(r.entities.map((e) => e.role)).toEqual(['DEMANDANTE', 'TESTIGO', 'OTRA_PERSONA']);
    expect(parsePastedList('Ana Ficticia Rojas; ACCIONÁNTE', ids()).entities[0]?.role).toBe('DEMANDANTE');
  });
  const clases: Array<[string, string]> = [['empresa', 'EMPRESA'], ['EPS', 'EPS'], ['ips', 'IPS'], ['Entidad', 'ENTIDAD'], ['proveedor', 'PROVEEDOR']];
  for (const [palabra, clase] of clases) {
    it(`«Nombre; ${palabra}» → organización ${clase}`, () => {
      const r = parsePastedList(`Ejemplo Salud; ${palabra}`, ids());
      expect(r.errors).toEqual([]);
      expect(r.entities[0]).toMatchObject({ kind: 'organizacion', role: clase });
      expect(r.inferred).toEqual([]);
    });
  }
  it('rol vacío, ausente o no reconocido: error M-42 y la línea no se agrega', () => {
    const r = parsePastedList('Ana Ficticia Rojas;\nLuis Prueba Rojas\nMaría Ejemplo; abogada\nPedro Prueba; testigo', ids());
    expect(r.errors).toEqual([{ line: 1, code: 'M-42' }, { line: 2, code: 'M-42' }, { line: 3, code: 'M-42' }]);
    expect(r.entities.map((e) => e.name)).toEqual(['Pedro Prueba']);
  });
  it('línea sin nombre: M-43; las líneas en blanco no cuentan como error y conservan la numeración', () => {
    const r = parsePastedList('\n; testigo\n\nAna Ficticia Rojas; testigo\n   \n', ids());
    expect(r.errors).toEqual([{ line: 2, code: 'M-43' }]);
    expect(r.entities).toHaveLength(1);
  });
  it('sufijo societario o token EPS/IPS en un rol de persona: organización inferida (M-45)', () => {
    const r = parsePastedList(
      'Ferretería Ejemplo S.A.S.; demandada\nEPS Ejemplo S.A.; demandado\nCentro Ejemplo I.P.S.; testigo\nHospital Prueba E.S.E.; demandada\nClínica Ejemplo; testigo', ids(),
    );
    expect(r.errors).toEqual([]);
    expect(r.entities.map((e) => [e.kind, e.role])).toEqual([
      ['organizacion', 'EMPRESA'], ['organizacion', 'EPS'], ['organizacion', 'IPS'], ['organizacion', 'IPS'], ['persona', 'TESTIGO'],
    ]);
    expect(r.inferred.map((i) => [i.line, i.class])).toEqual([[1, 'EMPRESA'], [2, 'EPS'], [3, 'IPS'], [4, 'IPS']]);
    expect(r.inferred.every((i) => r.entities.some((e) => e.id === i.entityId))).toBe(true);
  });
  it('sin esas señales es una persona con ese rol', () => {
    const r = parsePastedList('Ana Ficticia Rojas; demandada', ids());
    expect(r.entities[0]).toMatchObject({ kind: 'persona', role: 'DEMANDADO' });
    expect(r.inferred).toEqual([]);
    expect(inferOrgClass('Ana Ficticia Rojas')).toBeNull();
    expect(inferOrgClass('Ejemplo Ltda.')).toBe('EMPRESA');
  });
  it('el nombre queda en NFC con espacios colapsados y las entidades traen sus variantes', () => {
    const r = parsePastedList('María   Ficticia Rojas; testigo\r\nLuis Prueba Rojas; testigo', ids());
    expect(r.entities[0]?.name).toBe('María Ficticia Rojas');
    expect(r.entities.every((e) => e.variants.some((v) => v.class === 'exacta'))).toBe(true);
    // «Rojas» compartido entre las dos entidades pegadas
    expect(r.entities.every((e) => e.variants.find((v) => v.text === 'Rojas')?.confidence === 'baja')).toBe(true);
  });
  it('contra una lista existente: se marcan las variantes compartidas con las ya cargadas', () => {
    const src = ids();
    const previa = refreshVariants([persona('Ana Ficticia Rojas', 'DEMANDANTE', src)]);
    const r = parsePastedList('Luis Prueba Rojas; testigo', src, previa);
    expect(r.entities).toHaveLength(1);
    expect(r.entities[0]?.variants.find((v) => v.text === 'Rojas')?.confidence).toBe('baja');
  });
  it('usa ids de la fuente inyectada con prefijo cas_ (nunca derivados del contenido)', () => {
    const r1 = parsePastedList('Ana Ficticia Rojas; testigo', ids());
    const r2 = parsePastedList('Otra Persona Distinta; testigo', ids());
    expect(r1.entities[0]?.id).toBe(r2.entities[0]?.id);
    expect(r1.entities[0]?.id).toMatch(/^cas_[0-9a-f]{32}$/);
  });
});

describe('T-MO-07 variantOwners (7.9.1)', () => {
  it('devuelve las entidades con una variante activa igual al texto en vista lista', () => {
    const src = ids();
    const a = persona('Ana Ficticia Rojas', 'DEMANDANTE', src);
    const l = refreshVariants([a, persona('Luis Prueba Rojas', 'TESTIGO', src)]);
    expect(variantOwners('ROJAS', l)).toHaveLength(2);
    expect(variantOwners('rojas', l)).toHaveLength(2);
    expect(variantOwners('Inexistente', l)).toEqual([]);
    expect(variantOwners('Ana', l)).toEqual([a.id]);
    expect(variantOwners('A. F. R.', l)).toEqual([a.id]);
  });
  it('no cuenta variantes apagadas', () => {
    const a = persona('Ana Ficticia Rojas', 'DEMANDANTE', ids());
    const [l] = refreshVariants([a]);
    const off = { ...l, variants: (l as CaseEntity).variants.map((v) => ({ ...v, enabled: false })) } as CaseEntity;
    expect(variantOwners('Ana', [off])).toEqual([]);
  });
  it('ignora el sufijo societario y el posesivo del texto', () => {
    const src = ids();
    const e = organizacion('Ferretería Ejemplo S.A.S.', 'EMPRESA', src);
    const l = refreshVariants([e]);
    expect(variantOwners('Ferreteria Ejemplo SAS', l)).toEqual([e.id]);
    expect(variantOwners("Ferretería Ejemplo's", l)).toEqual([e.id]);
  });
});

describe('T-MO-07 ejemplos de la sección 7 no cubiertos arriba', () => {
  it('«las flores rojas» no es «Rojas» y «Prueba de ello» sí (falso positivo conocido)', () => {
    const l = refreshVariants([persona('Ana Ficticia Rojas', 'DEMANDANTE', ids())]);
    expect(searchCaseList(part('las flores rojas'), l)).toEqual([]);
    const l2 = refreshVariants([persona('María Prueba', 'DEMANDANTE', ids())]);
    const t = 'Prueba de ello consta.';
    const r = searchCaseList(part(t), l2);
    expect(r.map((m) => [t.slice(m.start, m.end), m.variantClass, m.confidence])).toEqual([['Prueba', 'apellido_suelto', 'media']]);
  });
  it('sigla por tratamiento: «la señora Rojas» frente a una empresa sube a media', () => {
    const src = ids();
    const l = refreshVariants([persona('Ana Ficticia Rojas', 'DEMANDANTE', src), organizacion('Rojas Ejemplo S.A.S.', 'EMPRESA', src)]);
    const t = 'La señora Rojas cobró. Rojas firmó.';
    const r = searchCaseList(part(t), l);
    expect(r.map((m) => m.confidence)).toEqual(['media', 'baja']);
  });
  it('un tratamiento nunca sube un apellido suelto a confianza alta', () => {
    const l = refreshVariants([persona('Ana Ficticia Rojas', 'DEMANDANTE', ids())]);
    const r = searchCaseList(part('El señor Rojas y la Dra. Ficticia.'), l);
    expect(r.every((m) => m.confidence !== 'alta')).toBe(true);
  });
});

// --- AJ-2 (D-10): lista con el nombre incompleto -----------------------------------------------------

describe('T-MO-07 AJ-2 iniciales de un nombre de dos unidades: las dos de la lista y una más', () => {
  const v = [generated('A. E. _.', 'iniciales', 'baja')];
  const casan: Array<[string, string]> = [
    ['no fue discutido por A. E. O. en su momento', 'A. E. O.'], ['Sobre este punto A.E.O. aportará', 'A.E.O.'], ['A E O firmó', 'A E O'],
    ['(A. E. O.)', 'A. E. O.'], ['la Dra. A. E. O. dijo', 'A. E. O.'],
  ];
  for (const [texto, esperado] of casan) it(`casa «${texto}»`, () => expect(probe('persona', 'Alejandro Ejemplo', v, texto)).toEqual([esperado]));
  for (const texto of ['la EPS respondió', 'AEO firmó', 'A. E. firmó', 'A. E. y B. dijeron', 'A. E. O. M. firmó', 'M. A. E. O. firmó', 'a. e. o. firmó', 'A. E. a la vista']) {
    it(`no casa «${texto}»`, () => expect(probe('persona', 'Alejandro Ejemplo', v, texto)).toEqual([]));
  }
  it('la entidad completa de la lista sigue con sus variantes de siempre y la nueva se resuelve en una detección de baja confianza', () => {
    const src = ids();
    const e = refreshVariants([persona('Alejandro Ejemplo', 'DEMANDANTE', src)]);
    const dets = searchCaseList(part('A. E. O. aportará las pruebas'), e);
    expect(dets).toHaveLength(1);
    expect(dets[0]).toMatchObject({ start: 0, end: 8, variantClass: 'iniciales', confidence: 'baja', source: 'lista' });
  });
  it('un nombre de tres unidades conserva sus iniciales de siempre y no lleva la variante con comodín', () => {
    const v3 = classes(generateVariants(persona('Ana Ficticia Rojas', 'DEMANDANTE', ids()), []));
    expect(v3.filter((x) => x.startsWith('iniciales'))).toEqual(['iniciales:A. F. R.']);
  });
  it('desactivar la variante con comodín sobrevive a refreshVariants (la llave conserva el comodín)', () => {
    const src = ids();
    const e0 = refreshVariants([persona('Alejandro Ejemplo', 'DEMANDANTE', src)]);
    const off = e0.map((e) => ({ ...e, variants: e.variants.map((x) => (x.text === 'A. E. _.' ? { ...x, enabled: false } : x)) }) as CaseEntity);
    const e1 = refreshVariants(off);
    expect(e1[0]?.variants.find((x) => x.text === 'A. E. _.')?.enabled).toBe(false);
    expect(searchCaseList(part('A. E. O. aportará'), e1)).toEqual([]);
  });
  it('tiempo: 20.000 repeticiones de «A. E. » por debajo de 200 ms', () => {
    const e = refreshVariants([persona('Alejandro Ejemplo', 'DEMANDANTE', ids())]);
    const texto = 'A. E. '.repeat(20_000) + 'O.';
    const mejor = Math.min(...[0, 1, 2].map(() => { const t0 = performance.now(); searchCaseList(part(texto), e); return performance.now() - t0; }));
    expect(mejor).toBeLessThan(200);
  });
});

describe('T-MO-07 AJ-2 sigla de una entidad de salud con su token', () => {
  const gen = (e: CaseEntity): string[] => classes(generateVariants(e, [e]));
  it('«EPS Salud Ficticia S.A.» genera «ESF»; el token al final va al final', () => {
    expect(gen(organizacion('EPS Salud Ficticia S.A.', 'EPS', ids()))).toContain('sigla:ESF');
    expect(gen(organizacion('Salud Integral Prueba EPS S.A.', 'EPS', ids()))).toEqual(expect.arrayContaining(['sigla:SIP', 'sigla:SIPE']));
  });
  it('una sigla de menos de 3 letras con el token no se genera: «EPS Ejemplo S.A.» queda como antes', () => {
    expect(gen(organizacion('EPS Ejemplo S.A.', 'EPS', ids()))).toEqual(
      ['exacta:EPS Ejemplo S.A.', 'razon_social_sin_sufijo:Ejemplo EPS', 'razon_social_sin_sufijo:Ejemplo'].sort());
  });
  it('sin token de salud no cambia: «Ferretería Ejemplo de Insumos S.A.S.» solo trae «FEI»', () => {
    expect(gen(organizacion('Ferretería Ejemplo de Insumos S.A.S.', 'EMPRESA', ids()))).toEqual(['exacta:Ferretería Ejemplo de Insumos S.A.S.', 'sigla:FEI'].sort());
  });
  it('«ESF» se encuentra como palabra entera en mayúsculas y no dentro de otra o en minúsculas', () => {
    const e = refreshVariants([organizacion('EPS Salud Ficticia S.A.', 'EPS', ids())]);
    const hay = (t: string): string[] => searchCaseList(part(t), e).map((d) => t.slice(d.start, d.end));
    expect(hay('Radicado de reparto 05001 · ESF')).toEqual(['ESF']);
    expect(hay('la esf no')).toEqual([]);
    expect(hay('ESFERA')).toEqual([]);
  });
});
