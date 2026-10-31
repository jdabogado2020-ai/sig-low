// Veredicto de 10.4.1 y registro de brechas (PG-3b; T-UA-01 y T-UA-02; plan 10.4.3).
// Funciones puras sobre los informes de `scripts/metrics.ts`. Línea de órdenes:
//   node scripts/veredicto.ts [--informes=<carpeta>] [--brechas=<corpus/brechas.json>] [--sin-escribir]
// Toma el informe más reciente de x-large por vista (natural, mayusculas, minusculas), evalúa todas las filas de cierre, escribe
// `veredicto` en esos informes y registra en `corpus/brechas.json` cada fila de cierre incumplida (ids de anotación, nunca valores).
// Sale con 0 si cierra, 1 si no cierra y 2 si el uso o la entrada son inválidos.
//
// Convención de filas filtradas (decisión del integrador sobre PG-3a): en una fila que filtra por anotación (lista, fuera de la
// lista) una detección verdadera cuenta solo si su mejor anotación cumple el filtro y una falsa cuenta en todas las filas de su
// tipo; la precisión de esas filas es una cota conservadora. El veredicto de 10.4.1 se decide por exhaustividad, no por esas
// precisiones: solo la precisión global (fila «TODOS») cuenta como umbral de precisión.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { omisionesPermitidas, razon } from './metrics.ts';
import type { MetricsReport, MetricsRow, RunVista } from './metrics.ts';

export const VISTAS: readonly RunVista[] = ['natural', 'mayusculas', 'minusculas'];

export type Operador = '>=' | '<=' | '==';
export interface FilaVeredicto {
  /** Nombre estable de la fila (el de `MetricsRow.grupo` cuando existe). */
  fila: string;
  /** Qué se mide: exhaustividad por mención, por entidad (estricta) u otra cifra del informe. */
  medida: 'mencion' | 'entidad' | 'banderas' | 'negativos' | 'citas' | 'precision' | 'consistencia' | 'colisiones' | 'residuos' | 'fatiga' | 'vista' | 'modelo';
  vista?: RunVista;
  valor: number;
  umbral: number;
  operador: Operador;
  n: number;
  cumple: boolean;
  /** Las filas informativas se registran sin bloquear (10.4.3). */
  cierre: boolean;
  /** Ids de anotación sin cobertura (nunca valores). */
  ids: string[];
  nota?: string;
}
export interface Veredicto { cierra: boolean; incumplidos: string[]; filas: FilaVeredicto[] }

const cumple = (valor: number, op: Operador, umbral: number): boolean => {
  const e = 1e-9;
  if (op === '>=') return valor + e >= umbral;
  if (op === '<=') return valor <= umbral + e;
  return Math.abs(valor - umbral) <= e;
};

/** (mención, entidad) de cada fila de exhaustividad de 10.4.1. `entidad` ausente: solo se exige la mención. */
const UMBRALES_EXHAUSTIVIDAD: ReadonlyArray<readonly [grupo: string, mencion: number, entidad?: number]> = [
  ['CC', 0.98, 0.96], ['NIT', 0.98, 0.96], ['RADICADO', 0.98, 0.96], ['TELEFONO', 0.98, 0.96], ['CORREO', 0.98, 0.96],
  ['IDS_ROTULADOS', 0.98, 0.96], ['IDS_ROTULADOS_CON_ROTULO', 1],
  ['LISTA', 0.98, 0.95], ['LISTA_CLASES_FUERTES', 1],
  ['PERSONA_FUERA', 0.85, 0.75], ['ORG_FUERA', 0.80, 0.70],
  ['DIRECCIONES', 0.95, 0.93], ['FECHA', 0.95, 0.93], ['VALOR', 0.95, 0.93],
];
/** Tipos de «banderas de datos indirectos» (10.4.1): CARGO, DIAGNOSTICO, MENOR, fecha de nacimiento y edad. */
const TIPOS_INDIRECTOS: readonly string[] = ['CARGO', 'DIAGNOSTICO', 'MENOR', 'FECHA_NACIMIENTO_A_RANGO_EDAD', 'EDAD_A_RANGO'];

/** Último informe por (config, vista) entre los dados: el de `corrida.fecha` mayor. */
export function ultimosPorVista(informes: readonly MetricsReport[], config: MetricsReport['corrida']['config'] = 'x-large'): Map<RunVista, MetricsReport> {
  const m = new Map<RunVista, MetricsReport>();
  for (const r of informes) {
    if (r.corrida.config !== config) continue;
    const previo = m.get(r.corrida.vista);
    if (previo === undefined || r.corrida.fecha >= previo.corrida.fecha) m.set(r.corrida.vista, r);
  }
  return m;
}

const fila = (r: MetricsReport, g: string): MetricsRow | undefined => r.filas.find((f) => f.grupo === g);

/**
 * Evalúa 10.4.1 sobre los informes del modelo principal (`x-large`) de las tres vistas. Las corridas `sin-modelo` y `x-base` no
 * cuentan como cumplidas (10.4.2): sin el informe natural de x-large el veredicto no cierra.
 */
export function evaluarVeredicto(informes: readonly MetricsReport[]): Veredicto {
  const porVista = ultimosPorVista(informes);
  const filas: FilaVeredicto[] = [];
  const faltan: string[] = [];
  for (const v of VISTAS) if (!porVista.has(v)) faltan.push(`FALTA_CORRIDA_X_LARGE_${v.toUpperCase()}`);
  const nat = porVista.get('natural');

  const exhaustividad = (r: MetricsReport, g: string, mencion: number, entidad: number | undefined, vista?: RunVista, nombre = g): void => {
    const f = fila(r, g);
    if (f === undefined) { faltan.push(`FALTA_FILA_${nombre}`); return; }
    const base = { vista, n: f.n, ids: f.idsNoCubiertas ?? [], cierre: true } as const;
    const sinDatos = f.n === 0;
    const v = (vista === undefined ? {} : { vista });
    filas.push({ ...v, fila: nombre, medida: 'mencion', valor: f.exhaustividadMencion, umbral: mencion, operador: '>=', n: f.n, cierre: true,
      cumple: sinDatos || cumple(f.exhaustividadMencion, '>=', mencion), ids: base.ids, ...(sinDatos ? { nota: 'sin menciones en el conjunto' } : {}) });
    if (entidad !== undefined) {
      filas.push({ ...v, fila: nombre, medida: 'entidad', valor: f.exhaustividadEntidadEstricta, umbral: entidad, operador: '>=', n: f.entidades, cierre: true,
        cumple: f.entidades === 0 || cumple(f.exhaustividadEntidadEstricta, '>=', entidad), ids: [], ...(f.entidades === 0 ? { nota: 'sin entidades en el conjunto' } : {}) });
    }
  };

  if (nat !== undefined) {
    for (const [g, m, e] of UMBRALES_EXHAUSTIVIDAD) exhaustividad(nat, g, m, e);
    // Generalización: municipios y despachos (sugerencia presente) y banderas de datos indirectos.
    const gen = (k: string): { esperadas: number; presentes: number } => nat.generalizacion.find((x) => x.tipo === k) ?? { esperadas: 0, presentes: 0 };
    for (const k of ['MUNICIPIO_A_DEPARTAMENTO', 'DESPACHO_A_GENERICO']) {
      const x = gen(k);
      filas.push({ fila: k, medida: 'banderas', valor: razon(x.presentes, x.esperadas), umbral: 0.95, operador: '>=', n: x.esperadas, cierre: true,
        cumple: x.esperadas === 0 || cumple(razon(x.presentes, x.esperadas), '>=', 0.95), ids: [], ...(x.esperadas === 0 ? { nota: 'sin esperadas' } : {}) });
    }
    const ind = TIPOS_INDIRECTOS.map(gen);
    const esp = ind.reduce((s, x) => s + x.esperadas, 0);
    const pre = ind.reduce((s, x) => s + x.presentes, 0);
    filas.push({ fila: 'BANDERAS_INDIRECTAS', medida: 'banderas', valor: razon(pre, esp), umbral: 0.90, operador: '>=', n: esp, cierre: true,
      cumple: esp === 0 || cumple(razon(pre, esp), '>=', 0.90), ids: [], ...(esp === 0 ? { nota: 'sin esperadas' } : {}) });
    const hl = gen('HECHO_LLAMATIVO');
    filas.push({ fila: 'HECHO_LLAMATIVO', medida: 'banderas', valor: razon(hl.presentes, hl.esperadas), umbral: 0.60, operador: '>=', n: hl.esperadas, cierre: false,
      cumple: hl.esperadas === 0 || cumple(razon(hl.presentes, hl.esperadas), '>=', 0.60), ids: [] });
    // Negativos, citas con radicado, precisión global y fatiga.
    filas.push({ fila: 'NEGATIVOS', medida: 'negativos', valor: razon(nat.negativos.conDeteccion, nat.negativos.total), umbral: 0.10, operador: '<=',
      n: nat.negativos.total, cierre: true, cumple: cumple(razon(nat.negativos.conDeteccion, nat.negativos.total), '<=', 0.10), ids: [] });
    filas.push({ fila: 'CITAS_CON_RADICADO', medida: 'citas', valor: nat.negativos.citasConRadicado === 0 ? 1 : razon(nat.negativos.banderasPresentes, nat.negativos.citasConRadicado),
      umbral: 1, operador: '==', n: nat.negativos.citasConRadicado, cierre: true,
      cumple: nat.negativos.citasConRadicado === 0 || nat.negativos.banderasPresentes === nat.negativos.citasConRadicado, ids: [] });
    filas.push({ fila: 'PRECISION_GLOBAL', medida: 'precision', valor: nat.global.precision, umbral: 0.70, operador: '>=', n: nat.global.paginas, cierre: true,
      cumple: cumple(nat.global.precision, '>=', 0.70), ids: [] });
    filas.push({ fila: 'FATIGA_MEDIA', medida: 'fatiga', valor: nat.global.fpPorPagina, umbral: 5, operador: '<=', n: nat.global.paginas, cierre: false,
      cumple: cumple(nat.global.fpPorPagina, '<=', 5), ids: [] });
    filas.push({ fila: 'FATIGA_MAXIMA_POR_DOCUMENTO', medida: 'fatiga', valor: nat.global.maxFpPorPaginaDoc, umbral: 10, operador: '<=', n: nat.global.paginas, cierre: false,
      cumple: cumple(nat.global.maxFpPorPaginaDoc, '<=', 10), ids: [] });
    // Consistencia y colisiones.
    const cg = nat.consistenciaPorGrupo;
    if (cg === undefined) faltan.push('FALTA_CONSISTENCIA_POR_GRUPO');
    else {
      const consis = [['ids', 'CONSISTENCIA_IDENTIFICADORES', 1], ['lista', 'CONSISTENCIA_LISTA', 1], ['fechas_valores', 'CONSISTENCIA_FECHAS_VALORES', 1], ['modelo', 'CONSISTENCIA_MODELO', 0.95]] as const;
      for (const [k, nombre, umbral] of consis) {
        const x = cg[k];
        const val = x.evaluadas === 0 ? 1 : x.consistentes / x.evaluadas;
        filas.push({ fila: nombre, medida: 'consistencia', valor: val, umbral, operador: '>=', n: x.evaluadas, cierre: true, cumple: x.evaluadas === 0 || cumple(val, '>=', umbral), ids: [] });
      }
      const duras = nat.consistencia.colisiones - cg.colisionesDelModelo;
      filas.push({ fila: 'COLISIONES_DURAS', medida: 'colisiones', valor: duras, umbral: 0, operador: '==', n: nat.consistencia.colisiones, cierre: true, cumple: duras === 0, ids: [] });
      filas.push({ fila: 'COLISIONES_DEL_MODELO', medida: 'colisiones', valor: cg.colisionesDelModelo, umbral: 0, operador: '==', n: nat.consistencia.colisiones, cierre: false,
        cumple: cg.colisionesDelModelo === 0, ids: [], nota: 'informativa: el revisor las separa con separar_mencion' });
    }
  }
  // Filas por vista (personas y organizaciones fuera de la lista): cada una sale de la corrida de su vista.
  for (const v of VISTAS) {
    const r = porVista.get(v);
    if (r === undefined) continue;
    exhaustividad(r, `PERSONA_FUERA@${v}`, 0.85, 0.75, v);
    exhaustividad(r, `ORG_FUERA@${v}`, 0.80, 0.70, v);
  }
  // Residuos: condición dura en todas las corridas del modelo principal que corrieron el oráculo.
  const residuosPorVista = [...porVista.values()].map((r) => ({
    residuos: r.residuos.porDocumento.reduce((s, d) => s + d.residuos, 0), despues: r.residuos.despuesDelBucle, concordancia: r.residuos.concordanciaResidueTs,
    ids: r.residuos.porDocumento.flatMap((d) => d.idsAnotacion),
  }));
  const res = residuosPorVista.reduce((s, x) => s + x.residuos + x.despues, 0);
  filas.push({ fila: 'RESIDUOS', medida: 'residuos', valor: res, umbral: 0, operador: '==', n: nat?.residuos.porDocumento.length ?? 0, cierre: true, cumple: res === 0,
    ids: residuosPorVista.flatMap((x) => x.ids) });
  filas.push({ fila: 'CONCORDANCIA_RESIDUE_TS', medida: 'residuos', valor: residuosPorVista.every((x) => x.concordancia) ? 1 : 0, umbral: 1, operador: '==',
    n: residuosPorVista.length, cierre: true, cumple: residuosPorVista.every((x) => x.concordancia), ids: [] });

  const incumplidos = [
    ...(nat === undefined && porVista.size === 0 ? ['MODELO_PRINCIPAL_AUSENTE'] : []),
    ...faltan,
    ...filas.filter((f) => f.cierre && !f.cumple).map((f) => `${f.fila}${f.medida === 'entidad' ? ' (entidad)' : ''}: ${f.valor.toFixed(3)} ${f.operador === '>=' ? '<' : f.operador === '<=' ? '>' : '≠'} ${f.umbral}`),
  ];
  return { cierra: incumplidos.length === 0, incumplidos, filas };
}

/** Copia de los informes de x-large con `veredicto` y, en las filas de exhaustividad, `umbral`, `omisionesPermitidas` y `cumple`. */
export function conVeredicto(informes: readonly MetricsReport[], v: Veredicto): MetricsReport[] {
  return informes.map((r) => {
    const copia = structuredClone(r);
    copia.veredicto = { cierra: v.cierra, incumplidos: v.incumplidos };
    for (const f of copia.filas) {
      const x = v.filas.find((y) => y.medida === 'mencion' && y.fila === f.grupo && (y.vista === undefined || y.vista === r.corrida.vista));
      if (x === undefined) continue;
      f.umbral = x.umbral;
      f.omisionesPermitidas = omisionesPermitidas(x.umbral, f.n);
      f.cumple = x.cumple;
    }
    return copia;
  });
}

// ===================================================================================================================
// Registro de brechas (10.4.3, T-UA-02)
// ===================================================================================================================

export interface Brecha {
  fila: string;
  vista?: RunVista;
  medida: FilaVeredicto['medida'];
  valor: number;
  umbral: number;
  operador: Operador;
  n: number;
  /** Ids de anotación afectados (nunca valores). */
  idsAnotacion: string[];
  hipotesis: string;
  tarea: string;
  accion: string;
  cierre: boolean;
  estado: 'abierta' | 'cerrada';
  /** Corrida que la detectó (`AAAAMMDD-HHMM-<config>-<vista>-<hilos>h`). */
  corrida: string;
}
export interface BrechasArchivo { formato: 'sig-low/brechas'; v: 1; brechas: Brecha[] }

export const BRECHAS_VACIAS: BrechasArchivo = { formato: 'sig-low/brechas', v: 1, brechas: [] };

/** Tarea responsable y primera hipótesis por fila (10.4.3 pide «hipótesis, tarea responsable y acción»; se afinan al revisar). */
function responsable(fila: string): { tarea: string; hipotesis: string; accion: string } {
  const f = fila.replace(/@.*$/u, '');
  const t = (tarea: string, hipotesis: string, accion: string): { tarea: string; hipotesis: string; accion: string } => ({ tarea, hipotesis, accion });
  if (['CC', 'NIT', 'IDS_ROTULADOS', 'IDS_ROTULADOS_CON_ROTULO'].includes(f)) return t('PA-2 / PA-5 (reglas de identificadores)', 'una forma de escritura o un rótulo que la regla no reconoce', 'revisar las menciones no cubiertas y ajustar la regla; bajar el mínimo de dígitos sin rótulo (7.3.7) solo si hace falta');
  if (['RADICADO', 'TELEFONO', 'CORREO'].includes(f)) return t('PA-3 (radicados, teléfonos, correos)', 'separadores o prefijos no contemplados', 'revisar las menciones no cubiertas y ajustar la regla');
  if (f === 'DIRECCIONES') return t('PA-4 (direcciones)', 'complemento, barrio o forma rural sin cubrir', 'revisar las menciones no cubiertas y ampliar la regla');
  if (f === 'FECHA' || f === 'VALOR') return t('PA-6 (fechas y valores)', 'forma de escritura no contemplada', 'revisar las menciones no cubiertas y ampliar la regla');
  if (f.startsWith('LISTA')) return t('PB-1 (lista del caso y variantes)', 'variante que la lista no genera (nombre completo, forma corta)', 'revisar las variantes y la confianza de las compartidas');
  if (f === 'PERSONA_FUERA' || f === 'ORG_FUERA') return t('PF-3 / PF-4a (modelo: umbral y etiquetas)', 'el modelo no propone el tramo o el umbral lo descarta', 'bajar nerMinScore (7.10.9) o revisar las etiquetas; medir la vista afectada');
  if (f === 'MUNICIPIO_A_DEPARTAMENTO' || f === 'DESPACHO_A_GENERICO' || f === 'BANDERAS_INDIRECTAS') return t('generalize.ts (sugerencias y banderas)', 'la sugerencia o la bandera no se genera', 'revisar las anotaciones esperadas y la lista de la regla');
  if (f === 'NEGATIVOS' || f === 'CITAS_CON_RADICADO') return t('PA-7 (exclusiones)', 'una norma, sentencia o código se detecta, o una cita sin bandera', 'ampliar las exclusiones o la bandera de cita');
  if (f === 'PRECISION_GLOBAL') return t('PA-7 / PF-3', 'demasiadas falsas', 'subir el piso de proposición o ampliar las exclusiones');
  if (f.startsWith('CONSISTENCIA') || f.startsWith('COLISIONES')) return t('PB-3 (entidades y claves canónicas)', 'dos menciones del mismo dato con claves distintas, o dos datos con la misma clave', 'revisar canonicalKeyFor y sameHolderAs');
  if (f === 'RESIDUOS' || f === 'CONCORDANCIA_RESIDUE_TS') return t('PB-4 (residuos) / PB-1', 'un original quedó en la salida tras la revisión simulada', 'revisar los ids de anotación y el modo de búsqueda que lo debía encontrar');
  return t('integrador', 'por determinar', 'revisar la fila');
}

/** Una brecha por fila de cierre incumplida. `corrida` identifica el informe del que sale. */
export function brechasDe(v: Veredicto, corrida: string): Brecha[] {
  return v.filas.filter((f) => f.cierre && !f.cumple).map((f) => {
    const r = responsable(f.fila);
    return {
      fila: f.fila + (f.medida === 'entidad' ? ' (entidad)' : ''), ...(f.vista === undefined ? {} : { vista: f.vista }), medida: f.medida,
      valor: Number(f.valor.toFixed(4)), umbral: f.umbral, operador: f.operador, n: f.n, idsAnotacion: [...f.ids],
      hipotesis: r.hipotesis, tarea: r.tarea, accion: r.accion, cierre: true, estado: 'abierta' as const, corrida,
    };
  });
}

/**
 * Pone al día el registro: agrega las brechas nuevas, actualiza las abiertas que siguen incumplidas y cierra las que ya se
 * cumplen. Nunca borra una entrada (queda `cerrada`). Una fila `FALTA_*` del veredicto no es una brecha de medición.
 */
export function actualizarBrechas(previo: BrechasArchivo, v: Veredicto, corrida: string): BrechasArchivo {
  const nuevas = brechasDe(v, corrida);
  const clave = (b: Pick<Brecha, 'fila' | 'vista'>): string => `${b.fila}|${b.vista ?? ''}`;
  const vigentes = new Set(nuevas.map(clave));
  const resultado: Brecha[] = [];
  for (const b of previo.brechas) {
    if (b.estado === 'abierta' && !vigentes.has(clave(b))) resultado.push({ ...b, estado: 'cerrada' });
    else if (b.estado === 'abierta') resultado.push(nuevas.find((n) => clave(n) === clave(b)) as Brecha);
    else resultado.push(b);
  }
  const ya = new Set(previo.brechas.filter((b) => b.estado === 'abierta').map(clave));
  for (const n of nuevas) if (!ya.has(clave(n))) resultado.push(n);
  return { formato: 'sig-low/brechas', v: 1, brechas: resultado };
}

/** Una entrada de brecha es completa si trae todos los campos que pide 10.4.3 (fila, valor, umbral, n, ids, hipótesis, tarea y acción). */
export function brechaCompleta(b: Brecha): boolean {
  return b.fila.length > 0 && Number.isFinite(b.valor) && Number.isFinite(b.umbral) && Number.isInteger(b.n) && Array.isArray(b.idsAnotacion)
    && b.hipotesis.length > 0 && b.tarea.length > 0 && b.accion.length > 0;
}

// ===================================================================================================================
// Línea de órdenes
// ===================================================================================================================

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function leerInformes(carpeta: string): Array<{ ruta: string; informe: MetricsReport }> {
  if (!existsSync(carpeta)) return [];
  return readdirSync(carpeta).filter((n) => n.endsWith('.json')).sort().flatMap((n) => {
    try {
      const informe = JSON.parse(readFileSync(join(carpeta, n), 'utf8')) as MetricsReport;
      return informe.formato === 'sig-low/metricas' ? [{ ruta: join(carpeta, n), informe }] : [];
    } catch {
      return [];
    }
  });
}

export function leerBrechas(ruta: string): BrechasArchivo {
  if (!existsSync(ruta)) return structuredClone(BRECHAS_VACIAS);
  const x = JSON.parse(readFileSync(ruta, 'utf8')) as BrechasArchivo;
  if (x.formato !== 'sig-low/brechas' || !Array.isArray(x.brechas)) throw new Error('BRECHAS_INVALIDAS');
  return x;
}

export function main(argv: readonly string[]): number {
  const args = new Map<string, string>();
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/u.exec(a);
    if (m !== null) args.set(m[1] as string, m[2] ?? '');
  }
  const carpeta = resolve(args.get('informes') ?? join(RAIZ, 'corpus', 'resultados'));
  const rutaBrechas = resolve(args.get('brechas') ?? join(RAIZ, 'corpus', 'brechas.json'));
  const leidos = leerInformes(carpeta);
  if (leidos.length === 0) {
    process.stderr.write('veredicto: no hay informes de métricas en la carpeta indicada (corre antes npm run medir)\n');
    return 2;
  }
  const porVista = ultimosPorVista(leidos.map((x) => x.informe));
  const v = evaluarVeredicto(leidos.map((x) => x.informe));
  const usados = [...porVista.values()];
  const corrida = usados.map((r) => `${r.corrida.fecha.replace(/[-:T]/gu, '').replace(/^(\d{8})(\d{4}).*/u, '$1-$2')}-${r.corrida.config}-${r.corrida.vista}-${r.corrida.hilos}h`).join('+') || 'sin-corridas';
  process.stdout.write(`veredicto: ${v.cierra ? 'CIERRA' : 'NO CIERRA'}\n`);
  for (const i of v.incumplidos) process.stdout.write(`  incumplida: ${i}\n`);
  if (args.has('sin-escribir')) return v.cierra ? 0 : 1;
  const conV = conVeredicto(usados, v);
  for (const c of conV) {
    const origen = leidos.find((x) => x.informe.corrida.vista === c.corrida.vista && x.informe.corrida.fecha === c.corrida.fecha && x.informe.corrida.config === c.corrida.config);
    if (origen !== undefined) writeFileSync(origen.ruta, `${JSON.stringify(c, null, 2)}\n`);
  }
  const brechas = actualizarBrechas(leerBrechas(rutaBrechas), v, corrida);
  mkdirSync(dirname(rutaBrechas), { recursive: true });
  writeFileSync(rutaBrechas, `${JSON.stringify(brechas, null, 2)}\n`);
  process.stdout.write(`brechas: ${rutaBrechas} (${brechas.brechas.filter((b) => b.estado === 'abierta').length} abiertas)\n`);
  return v.cierra ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
