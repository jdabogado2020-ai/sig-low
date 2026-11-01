// CORPUS-2 (D-17, decisión del dueño, S-10.4): aplica al gold congelado
//   1. el cambio 5b de RG-r2 en C24-A007 «Doña Gloria» (otra persona, fuera de la lista; el tramo NO se recorta: el 5a no se aplica porque AJ-6
//      ya cubre el tratamiento): enLista true → false; entidad C24-E01 → C24-E41 (nueva, PER:gloria); rol CLIENTE → OTRA_PERSONA;
//      caracteristicas [F44] → [F44, F51];
//   2. los alias de nombre completo en la lista del caso (listaDelCaso[].alias, la misma vía de D-16/CORPUS-1):
//      C18 «Leonardo Prueba» → «Leonardo Prueba Sánchez»; C21 «Álvaro Ficticio» → «Álvaro Ficticio Salazar».
// Cada cambio queda en revision.cambios del documento («D-17, aprobado por el dueño») y las sumas del gold en corpus/MANIFIESTO.json.
// Es idempotente: una segunda pasada no cambia nada. Con --comprobar no escribe y sale 1 si queda algún cambio pendiente.
// Uso: node corpus/revision/herramientas/d17-aplicar.mjs [--comprobar]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GOLD = join(RAIZ, 'corpus', 'gold');
const MANIFIESTO = join(RAIZ, 'corpus', 'MANIFIESTO.json');
const COMPROBAR = process.argv.includes('--comprobar');

const APROBACION = 'D-17, aprobado por el dueño';
const ALIAS = [
  { doc: 'C18', entrada: 'Leonardo Prueba', alias: 'Leonardo Prueba Sánchez' },
  { doc: 'C21', entrada: 'Álvaro Ficticio', alias: 'Álvaro Ficticio Salazar' },
];
const GLORIA = { doc: 'C24', anotacion: 'C24-A007', texto: 'Doña Gloria', de: 'C24-E01', a: 'C24-E41', canonico: 'PER:gloria' };

const sha = (s) => createHash('sha256').update(s).digest('hex');
const leer = (doc) => {
  const ruta = join(GOLD, `${doc}.json`);
  const crudo = readFileSync(ruta, 'utf8');
  const g = JSON.parse(crudo);
  if (JSON.stringify(g, null, 2) + '\n' !== crudo) throw new Error(`${doc}: el archivo no tiene el formato canónico (2 espacios y LF final)`);
  return { ruta, g };
};
const escritos = new Map();
const informe = [];

function guardar(doc, ruta, g, cambios) {
  if (cambios.length === 0) return;
  g.revision.cambios = [...g.revision.cambios, ...cambios];
  const nuevo = JSON.stringify(g, null, 2) + '\n';
  escritos.set(`corpus/gold/${doc}.json`, nuevo);
  if (!COMPROBAR) writeFileSync(ruta, nuevo, 'utf8');
  informe.push(`${doc}: ${cambios.length} cambio(s)`);
}

// 1. C24-A007 «Doña Gloria» (5b).
{
  const { ruta, g } = leer(GLORIA.doc);
  const a = g.anotaciones.find((x) => x.id === GLORIA.anotacion);
  if (a === undefined || a.texto !== GLORIA.texto) throw new Error(`${GLORIA.anotacion}: no es «${GLORIA.texto}»`);
  const cambios = [];
  if (a.entidad !== GLORIA.a) {
    if (a.entidad !== GLORIA.de || a.enLista !== true || a.rol !== 'CLIENTE') throw new Error(`${a.id}: estado inesperado (${a.entidad}, ${a.enLista}, ${a.rol})`);
    if (g.entidades.some((e) => e.id === GLORIA.a || e.canonico === GLORIA.canonico)) throw new Error(`${GLORIA.a}: ya existe sin que ${a.id} la use`);
    const antes = JSON.stringify(a.caracteristicas);
    a.enLista = false;
    a.entidad = GLORIA.a;
    a.rol = 'OTRA_PERSONA';
    a.caracteristicas = [...new Set([...a.caracteristicas, 'F51'])].sort();
    g.entidades.push({ id: GLORIA.a, tipo: 'PERSONA', rol: 'OTRA_PERSONA', canonico: GLORIA.canonico, mismoTitular: [], enLista: false });
    cambios.push(`CORPUS-2: ${a.id} «${a.texto}»: enLista true → false; entidad ${GLORIA.de} → ${GLORIA.a} (nueva, ${GLORIA.canonico}, OTRA_PERSONA, enLista false); `
      + `rol CLIENTE → OTRA_PERSONA; caracteristicas ${antes} → ${JSON.stringify(a.caracteristicas)} (${APROBACION}). Es el cambio 5b del dictamen de RG-r2 `
      + `(5a no se aplica: el tramo «${a.texto}» no se recorta, AJ-6 ya cubre el tratamiento). Motivo: el texto no vincula a «Gloria» con ${g.listaDelCaso[0].name} `
      + `(el remitente, con nombre de pila masculino; «Doña Gloria» es otra persona) y un marcador compartido haría que la reinserción escribiera el nombre equivocado. `
      + `Plan 7.9.3, T-RS-01 y 7.12.2 paso 4; 10.2.1 (persona fuera de la lista: F51); S-10.4.`);
  } else if (a.enLista !== false || a.rol !== 'OTRA_PERSONA' || !a.caracteristicas.includes('F51') || !g.entidades.some((e) => e.id === GLORIA.a && e.canonico === GLORIA.canonico)) {
    throw new Error(`${a.id}: aplicado a medias`);
  }
  guardar(GLORIA.doc, ruta, g, cambios);
}

// 2. Alias de nombre completo.
for (const { doc, entrada, alias } of ALIAS) {
  const { ruta, g } = leer(doc);
  const l = g.listaDelCaso.find((x) => x.name === entrada);
  if (l === undefined) throw new Error(`${doc}: no hay la entrada «${entrada}»`);
  const cambios = [];
  if (!(l.alias ?? []).includes(alias)) {
    const duena = g.entidades.find((e) => e.enLista && e.canonico === `LISTA:${entrada}`);
    if (duena === undefined) throw new Error(`${doc}: sin entidad de «${entrada}»`);
    const cubre = g.anotaciones.filter((x) => x.texto === alias).map((x) => x.id);
    if (cubre.length === 0 || g.anotaciones.some((x) => x.texto === alias && x.entidad !== duena.id)) throw new Error(`${doc}: «${alias}» no es solo de ${duena.id}`);
    l.alias = [...(l.alias ?? []), alias];
    cambios.push(`CORPUS-2: lista del caso, entrada «${entrada}»: alias «${alias}» (entrada, alias aprobado por el dueño, D-17; ${APROBACION}). `
      + `Motivo: es la forma de nombre completo con que el documento nombra a la persona y el motor no la deriva del nombre de la entrada (6.5.1, 7.9.4); `
      + `se agrega como variante manual de la entrada (listaDelCaso[].alias), como lo haría el abogado con «Agregar variante» en la vista previa, por la misma vía de D-16. `
      + `Las anotaciones y las entidades del gold no cambian (${cubre.join(', ')} siguen siendo ${duena.id}).`);
  }
  guardar(doc, ruta, g, cambios);
}

// MANIFIESTO.json: sha256 y bytes de los gold reescritos.
if (escritos.size > 0 && !COMPROBAR) {
  const m = JSON.parse(readFileSync(MANIFIESTO, 'utf8'));
  for (const [ruta, txt] of escritos) {
    const fila = m.archivos.find((x) => x.ruta === ruta);
    if (fila === undefined) throw new Error(`${ruta} no está en MANIFIESTO.json`);
    fila.sha256 = sha(txt);
    fila.bytes = Buffer.byteLength(txt, 'utf8');
  }
  writeFileSync(MANIFIESTO, JSON.stringify(m, null, 2) + '\n', 'utf8');
}

for (const l of informe) process.stdout.write(`${l}\n`);
process.stdout.write(`total: ${escritos.size} documento(s) ${COMPROBAR ? 'con cambios pendientes (no se escribió nada)' : 'reescritos'}\n`);
if (COMPROBAR && escritos.size > 0) process.exit(1);
