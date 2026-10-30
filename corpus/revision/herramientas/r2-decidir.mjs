// R2 (10.2.4): registro de las decisiones del revisor sobre cada candidato sin anotar que lista r2-candidatos.mjs.
// Cada decisión es una regla con su motivo; el script falla si algún candidato queda sin decidir (T-GO-04) y escribe
//   corpus/revision/R2/decisiones.json   (una entrada por candidato distinto: decisión, motivo, apariciones y documentos)
//   corpus/revision/R2/propuestas.json   (correcciones propuestas al gold: omisiones confirmadas; las aplica G en R3)
// Uso: node corpus/revision/herramientas/r2-decidir.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidatos, claveDecision } from './r2-candidatos.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ND = 'no_es_dato';
const OM = 'omision';

// Reglas generales: [clase, expresión sobre el texto en minúsculas con espacios simples, decisión, motivo]
const REGLAS = [
  ['mayusculas', /^(acción de( tutela)?|acta de .+|anexo de referencias|autorización de( centrales)?|centro de conciliación|cesión del crédito|cláusula .+|constancias adicionales|contacto de emergencia|contrato .+|cuadro de amortización|datos complementarios|derechos fundamentales|deudor solidario|domicilio( del trabajador| y( jurisdicción)?)?|forma de pago( de las cuotas)?|fundamentos de derecho|garantía real|horas extras y recargos|inventario del inmueble|mora y cobranza|objeto y lugar de trabajo|pago por nómina|pensión y cesantías|permiso de trabajo|período de prueba|plazo y cuotas|precio y arras|promesa de compraventa de bien inmueble|reglamento y quejas|seguridad social|tarjeta y seguros|terceros y garantías|tratamiento de datos|tutela de salud|cuota vencimiento valor|nombre c|si el empleador)$/,
    ND, 'Título, encabezado de sección o de columna del documento; no contiene ningún dato de una persona ni de una organización.'],
  ['mayusculas', /^(el (arrendador|arrendatario|comprador|contratante|contratista|empleador|mutuante|mutuario|promitente vendedor|trabajador|vendedor)|promitente comprador)$/,
    ND, 'Rol contractual definido en el encabezado del contrato («en adelante EL ARRENDADOR»); la persona que lo ocupa ya está anotada por su nombre y el rol solo no la identifica.'],
  ['mayusculas', /^(corte suprema|la corte constitucional|el registro único|superintendencia financiera)$/,
    ND, 'Autoridad o registro público citado como institución en la fundamentación jurídica; no es parte, tercero ni funcionario identificable (F30–F32 cubren las citas).'],
  ['mayusculas', /^la eps$/, ND, 'Artículo y sigla genérica sin razón social; 10.2.2 excluye los artículos y la entidad concreta ya está anotada por su nombre.'],
  ['mayusculas', /^(permiso especial|protección temporal)$/, ND, 'Nombre del tipo de documento («Permiso Especial de Permanencia», «Permiso por Protección Temporal»); el número que lo acompaña sí está anotado como PPT/PEP.'],
  ['rotulo', /^(005|012|013|042)$/, ND, 'Consecutivo del acta (ACTA N.º nnn); no identifica a una persona ni un proceso.'],
  ['rotulo', /^\d{2}$/, ND, 'Ordinal de un hecho numerado («N.º 31.»), no un dato.'],
  ['iniciales', /^e\. s\. d$/, ND, 'Fórmula de cortesía «E. S. D.» («en su despacho») del encabezado de la tutela; no identifica a nadie.'],
  ['marcador', /^ficticio$/, ND, 'Palabra de la marca de ficción «Documento ficticio para pruebas de Sig-Low.»; una detección sobre ella cuenta como falso positivo.'],
  ['cargo', /^revisor fiscal$/, ND, 'Cargo mencionado como punto del orden del día («elección de revisor fiscal»): ni persona ni entidad concreta lo hacen único (7.7.6 lo exige «junto a una entidad concreta»).'],
  ['cargo', /^secretaria$/, ND, 'Rótulo del campo «Secretaria: <nombre>» del encabezado del acta, sin entidad concreta; el nombre de la persona sí está anotado. Igual que «Juez:».'],
];

const OMISION_CONJUNTO = 'Nombre de un conjunto residencial tras el rótulo «conjunto residencial»: R-BAR-01 (7.7) lo incluye entre los rótulos de BARRIO y F15 cuenta barrios rotulados; no es complemento de una dirección anotada. El gold no lo anota. Se propone anotarlo como BARRIO.';
const OMISION_CONJUNTO_SIN_ROTULO = 'Nombre del mismo conjunto residencial, pero tras «conjunto» sin «residencial» (rótulo que R-BAR-01 no reconoce): identifica el lugar igual que en C10–C15. Se propone anotarlo como BARRIO con rotulado:false (brecha de regla, no de gold).';

// Reglas específicas por documento (clave `DOC|clase|texto`).
const ESPECIFICAS = {
  'C10|mayusculas|reserva ficticia': [OM, OMISION_CONJUNTO],
  'C10|marcador|ficticia': [OM, OMISION_CONJUNTO],
  'C11|marcador|ejemplo': [OM, OMISION_CONJUNTO],
  'C12|marcador|prueba': [OM, OMISION_CONJUNTO],
  'C13|marcador|prueba': [OM, OMISION_CONJUNTO],
  'C13|marcador|ejemplo': [OM, OMISION_CONJUNTO],
  'C14|marcador|ejemplo': [OM, OMISION_CONJUNTO],
  'C15|marcador|ejemplo': [OM, OMISION_CONJUNTO],
  'C20|marcador|ejemplo': [OM, OMISION_CONJUNTO_SIN_ROTULO],
  'C18|marcador|ejemplo': [ND, 'Sustantivo común «ejemplo» («el expediente T-8.100.002 citado como ejemplo»), no es nombre propio.'],
  'C19|marcador|prueba': [ND, 'Sustantivo común «PERÍODO DE PRUEBA»/«período de prueba» (cláusula sexta), no es nombre propio.'],
};

const cs = candidatos();
const decisiones = {};
const sinDecidir = [];
for (const c of cs) {
  const kDoc = `${c.docId}|${claveDecision(c)}`;
  const k = claveDecision(c);
  const textoNorm = c.texto.toLowerCase().replace(/\s+/g, ' ');
  let d;
  let clave;
  if (ESPECIFICAS[kDoc]) { d = ESPECIFICAS[kDoc]; clave = kDoc; }
  else {
    const r = REGLAS.find(([clase, re]) => clase === c.clase && re.test(textoNorm));
    if (r) { d = [r[2], r[3]]; clave = k; }
  }
  if (!d) { sinDecidir.push(c); continue; }
  const e = (decisiones[clave] ??= { decision: d[0], motivo: d[1], clase: c.clase, texto: c.texto, apariciones: 0, docs: [] });
  e.apariciones++;
  if (!e.docs.includes(c.docId)) e.docs.push(c.docId);
}
if (sinDecidir.length) {
  console.log('SIN DECISIÓN:', sinDecidir.length);
  for (const c of sinDecidir) console.log(c.docId, c.clase, JSON.stringify(c.texto));
  process.exit(1);
}

// Propuestas de corrección: para cada omisión se calcula el tramo del nombre a partir del rótulo que lo precede.
const propuestas = [];
const textos = new Map();
const leerTexto = (id) => textos.get(id) ?? (textos.set(id, JSON.parse(readFileSync(join(RAIZ, 'corpus/gold', `${id}.texto.json`), 'utf8'))), textos.get(id));
const vistos = new Set();
for (const c of cs) {
  const kDoc = `${c.docId}|${claveDecision(c)}`;
  if (ESPECIFICAS[kDoc]?.[0] !== OM) continue;
  const t = leerTexto(c.docId);
  const parte = t.partes.find((p) => `${p.kind}:${p.index}${p.page === undefined ? '' : `:p${p.page}`}` === c.parte);
  // el nombre del conjunto va entre el rótulo y el final del token marcador (o de «Reserva Ficticia»)
  const antes = parte.texto.slice(0, c.end);
  const m = /(conjunto\s+residencial|conjunto)\s+((?:[\p{L}]+\s+)*[\p{L}]+)$/u.exec(antes);
  if (!m) { console.log('no se pudo ubicar el nombre', c); process.exit(1); }
  const end = c.end;
  const start = end - m[2].length;
  const llave = `${c.docId}|${c.parte}|${start}`;
  if (vistos.has(llave)) continue;
  vistos.add(llave);
  propuestas.push({
    docId: c.docId, parte: c.parte, start, end, texto: parte.texto.slice(start, end), tipo: 'BARRIO', accion: 'agregar_anotacion',
    rotulado: m[1].toLowerCase().replace(/\s+/g, ' ') === 'conjunto residencial', caracteristicas: ['F15'], debe_generalizarse: false, es_negativo_esperado: false, estructura: 'no_aplica', enLista: false,
    motivo: ESPECIFICAS[kDoc][1],
  });
}

writeFileSync(join(RAIZ, 'corpus/revision/R2/decisiones.json'), JSON.stringify({ formato: 'sig-low/revision-r2-decisiones', v: 1, decisiones }, null, 1) + '\n');
writeFileSync(join(RAIZ, 'corpus/revision/R2/propuestas.json'), JSON.stringify({ formato: 'sig-low/revision-r2-propuestas', v: 1, propuestas }, null, 1) + '\n');
const porDecision = Object.values(decisiones).reduce((a, e) => ((a[e.decision] = (a[e.decision] ?? 0) + e.apariciones), a), {});
console.log('candidatos:', cs.length, '| decisiones distintas:', Object.keys(decisiones).length, '| por decisión (apariciones):', JSON.stringify(porDecision), '| propuestas de corrección:', propuestas.length);
for (const p of propuestas) console.log(' ', p.docId, p.parte, `${p.start}-${p.end}`, JSON.stringify(p.texto), 'rotulado=' + p.rotulado);
