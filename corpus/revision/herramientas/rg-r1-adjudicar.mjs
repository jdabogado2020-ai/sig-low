// RG-r1 (R4 de 10.2.4, decisión 4 de D-06): aplica al gold congelado las correcciones con error demostrado contra el plan.
// Solo cambia campos de anotaciones y entidades existentes; no agrega ni quita tramos ni toca los documentos ni el texto esperado.
//   1. Municipio dentro del nombre de un despacho o autoridad (contenidaEn → anotación con DESPACHO_A_GENERICO):
//      generalizacion MUNICIPIO_A_DEPARTAMENTO → DESPACHO_A_GENERICO (6.2.1 fila MUNICIPIO; 7.7.3 R-MUN-05 y R-DESP-01; 10.2.2).
//   2. Edad explícita de un menor (generalizacion EDAD_A_RANGO, tipo FECHA, edad < 18): tipo FECHA → MENOR y característica F50;
//      su entidad FECHA → MENOR (7.5.6 R-EDAD-01; 7.7.6 fila MENOR; 7.8.2 G-06; 10.1.3 F50). Sin bandera_esperada (10.2.3).
//      Las edades de adultos no se tocan: el plan no da un DataType para ellas (duda abierta para el integrador, RG-r1.md).
// Cada cambio queda en revision.cambios del documento y las sumas del gold en corpus/MANIFIESTO.json.
// Es idempotente: una segunda pasada no cambia nada. Con --comprobar no escribe y sale 1 si queda algún cambio pendiente.
// Uso: node corpus/revision/herramientas/rg-r1-adjudicar.mjs [--comprobar]
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GOLD = join(RAIZ, 'corpus', 'gold');
const MANIFIESTO = join(RAIZ, 'corpus', 'MANIFIESTO.json');
const COMPROBAR = process.argv.includes('--comprobar');

const CITA_MUN = 'Plan 6.2.1 fila MUNICIPIO («o DESPACHO_A_GENERICO si está en el nombre de un despacho o autoridad»); 7.7.3 R-MUN-05 y R-DESP-01 (o1 generaliza el municipio); 10.2.2 fila Despacho o autoridad.';
const CITA_EDAD = 'Plan 7.5.6 R-EDAD-01 («No es un DataType»; edad < 18 → bandera MENOR); 7.7.6 fila MENOR (R-EDAD-01 con edad < 18, tramo: la expresión); 7.8.2 G-06 («Sin marcador»); 10.1.3 F50.';

/** Edad cumplida del tramo de R-EDAD-01 («13 años de edad», «61 años»); los meses de edad cuentan como 0 años (7.5.6). */
function edadDe(texto) {
  if (/meses/i.test(texto)) return 0;
  const m = /^(?:de\s+)?(\d{1,3})\b/.exec(texto);
  return m ? Number(m[1]) : null;
}

const sha = (s) => createHash('sha256').update(s).digest('hex');
const ids = readdirSync(GOLD).filter((f) => /^C\d\d\.json$/.test(f)).map((f) => f.slice(0, 3)).sort();
const resumen = { municipioEnDespacho: 0, edadMenor: 0, entidades: 0, documentos: [] };
const porDoc = [];
const escritos = new Map();

for (const id of ids) {
  const ruta = join(GOLD, `${id}.json`);
  const crudo = readFileSync(ruta, 'utf8');
  const g = JSON.parse(crudo);
  if (JSON.stringify(g, null, 2) + '\n' !== crudo) throw new Error(`${id}: el archivo no tiene el formato canónico (2 espacios y LF final)`);
  const porId = new Map(g.anotaciones.map((a) => [a.id, a]));
  const entPorId = new Map(g.entidades.map((e) => [e.id, e]));
  const cambios = [];
  const cuenta = { doc: id, MUNICIPIO: 0, MENOR: 0, entidades: 0 };

  // 1. Municipio dentro de un despacho o autoridad.
  for (const a of g.anotaciones) {
    if (a.tipo !== 'MUNICIPIO' || a.contenidaEn === undefined) continue;
    const h = porId.get(a.contenidaEn);
    if (h === undefined || h.generalizacion !== 'DESPACHO_A_GENERICO') continue;
    if (a.generalizacion === 'DESPACHO_A_GENERICO') continue;
    if (a.generalizacion !== 'MUNICIPIO_A_DEPARTAMENTO') throw new Error(`${a.id}: generalizacion inesperada ${a.generalizacion}`);
    a.generalizacion = 'DESPACHO_A_GENERICO';
    cambios.push(`RG-r1: ${a.id} MUNICIPIO «${a.texto}» dentro del despacho ${h.id}: generalizacion MUNICIPIO_A_DEPARTAMENTO → DESPACHO_A_GENERICO. `
      + `Motivo: el municipio en el nombre de un despacho no recibe sugerencia propia; lo generaliza la del despacho en su opción o1. ${CITA_MUN}`);
    cuenta.MUNICIPIO++;
  }

  // 2. Edad explícita de un menor.
  const entidadesTocadas = new Set();
  for (const a of g.anotaciones) {
    if (a.generalizacion !== 'EDAD_A_RANGO' || a.tipo !== 'FECHA') continue;
    const edad = edadDe(a.texto);
    if (edad === null) throw new Error(`${a.id}: no se lee la edad de «${a.texto}»`);
    if (edad >= 18) continue;
    if (a.bandera_esperada !== undefined) throw new Error(`${a.id}: bandera_esperada inesperada`);
    a.tipo = 'MENOR';
    if (!a.caracteristicas.includes('F50')) a.caracteristicas = [...a.caracteristicas, 'F50'].sort();
    entidadesTocadas.add(a.entidad);
    cambios.push(`RG-r1: ${a.id} «${a.texto}» (edad ${edad} < 18): tipo FECHA → MENOR, característica F50 agregada, entidad ${a.entidad} FECHA → MENOR; `
      + `se conservan debe_generalizarse y EDAD_A_RANGO. Motivo: la edad no es un DataType ni lleva [FECHA_n]; da la sugerencia EDAD_A_RANGO y, `
      + `por ser de un menor, la bandera MENOR sobre la misma expresión. ${CITA_EDAD}`);
    cuenta.MENOR++;
  }
  for (const eid of entidadesTocadas) {
    const e = entPorId.get(eid);
    const usos = g.anotaciones.filter((a) => a.entidad === eid);
    if (usos.some((a) => a.tipo !== 'MENOR')) throw new Error(`${eid}: entidad con menciones de otro tipo`);
    if (e.tipo === 'MENOR') continue;
    if (e.tipo !== 'FECHA' || !e.canonico.startsWith('FECHA:~')) throw new Error(`${eid}: entidad inesperada ${e.tipo} ${e.canonico}`);
    e.tipo = 'MENOR';
    e.canonico = 'MENOR:edad:' + e.canonico.slice('FECHA:~'.length);
    cuenta.entidades++;
  }
  const canon = g.entidades.map((e) => e.canonico);
  if (new Set(canon).size !== canon.length) throw new Error(`${id}: canónico repetido tras el cambio`);

  if (cambios.length > 0) {
    g.revision.cambios = [...g.revision.cambios, ...cambios];
    const nuevo = JSON.stringify(g, null, 2) + '\n';
    escritos.set(`corpus/gold/${id}.json`, nuevo);
    if (!COMPROBAR) writeFileSync(ruta, nuevo, 'utf8');
    porDoc.push(cuenta);
    resumen.municipioEnDespacho += cuenta.MUNICIPIO;
    resumen.edadMenor += cuenta.MENOR;
    resumen.entidades += cuenta.entidades;
    resumen.documentos.push(id);
  }
}

// MANIFIESTO.json: sha256 y bytes de los gold reescritos.
if (escritos.size > 0 && !COMPROBAR) {
  const crudo = readFileSync(MANIFIESTO, 'utf8');
  const m = JSON.parse(crudo);
  for (const [ruta, txt] of escritos) {
    const fila = m.archivos.find((x) => x.ruta === ruta);
    if (fila === undefined) throw new Error(`${ruta} no está en MANIFIESTO.json`);
    fila.sha256 = sha(txt);
    fila.bytes = Buffer.byteLength(txt, 'utf8');
  }
  writeFileSync(MANIFIESTO, JSON.stringify(m, null, 2) + '\n', 'utf8');
}

for (const c of porDoc) process.stdout.write(`${c.doc}: MUNICIPIO ${c.MUNICIPIO} · MENOR ${c.MENOR} · entidades ${c.entidades}\n`);
process.stdout.write(`total: ${resumen.municipioEnDespacho} municipios en despacho, ${resumen.edadMenor} edades de menor, `
  + `${resumen.entidades} entidades, ${resumen.documentos.length} documentos${COMPROBAR ? ' (pendientes; no se escribió nada)' : ''}\n`);
if (COMPROBAR && escritos.size > 0) process.exit(1);
