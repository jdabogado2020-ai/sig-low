// T-RS-18 · Volteo exhaustivo sobre el corpus (10.6): para cada entidad aceptada con ≥ 2 menciones en la revisión simulada, rechazar una
// mención (luego restablecerla) debe dar ≥ 1 impacto de la búsqueda de residuos con esa entidad sobre esa mención; igual al rechazar la
// mención de HC o de NIT de persona natural de cada titular (el impacto lo da la cédula del mismo titular). Sin modelo, sobre el
// texto canónico. Datos ficticios.
//
// Alcance de la exigencia: la búsqueda de residuos solo puede encontrar un texto que conoce por otra mención aceptada de la entidad
// (7.13.2). Un apellido suelto («Prueba») no se busca solo: es una palabra común (7.13.3). Por eso el volteo es bloqueante cuando otra mención aceptada de la misma entidad tiene el mismo texto (plegado a
// minúsculas y sin tildes) o la entidad es de un titular compartido (HC y NIT); si la mención rechazada tiene una forma que ninguna
// otra mención comparte (una dirección o un valor escrito de otra manera), el resultado se anota en el informe de la prueba
// (`volteo-informativo.json`) sin bloquear. Un volteo en el que la mención rechazada sigue sin aparecer copiada en la salida
// (la cubre una edición de tramo de una sugerencia aplicada) no tiene qué encontrar y no cuenta.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { caracteresCopiados } from '../../scripts/metrics.ts';
import { applyReviewAction } from '../../src/core/entities.ts';
import { createRuleRegistry } from '../../src/core/pipeline.ts';
import { render } from '../../src/core/render.ts';
import { runResidueCheck } from '../../src/core/residue.ts';
import type { Detection, DetectionSet, Entity, ReviewAction, ReviewState } from '../../src/core/types.ts';
import { cargarCorpus } from './lib/corpus.ts';
import type { Conjunto, DocCorpus } from './lib/corpus.ts';
import { OPCIONES_DETECCION, TABLA_VACIA, crearMotor, procesarDocumento, salidaDe } from './lib/motor.ts';
import { revisarConOraculo } from './lib/oraculo.ts';
import type { ResultadoOraculo } from './lib/oraculo.ts';

const conjunto = (process.env['SIGLOW_MEDIR_CONJUNTO'] ?? 'todo') as Conjunto;
const salida = process.env['SIGLOW_MEDIR_SALIDA'] ?? join(tmpdir(), 'siglow-medir');
const corpus = cargarCorpus(conjunto);
const vacio: DetectionSet = { detections: [], entities: [], flags: [], suggestions: [] };
const rules = createRuleRegistry(Number(OPCIONES_DETECCION.referenceDate.slice(0, 4)));
const NOMBRES: ReadonlySet<string> = new Set(['PERSONA', 'EMPRESA', 'EPS', 'IPS', 'ENTIDAD', 'PROVEEDOR']);
const plegar = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim();

interface Revisado { dc: DocCorpus; o: ResultadoOraculo }
const revisados: Revisado[] = [];
const informativo: Array<{ docId: string; tipo: string; deteccion: string }> = [];
const conteo = { volteos: 0, omitidos: 0, hcNit: 0 };

beforeAll(async () => {
  const motor = crearMotor();
  for (const dc of corpus) {
    const p = await procesarDocumento(motor, dc, undefined);
    revisados.push({ dc, o: await revisarConOraculo({ p, motor }) });
  }
}, 1_800_000);

const aceptada = (d: Detection | undefined): d is Detection => d !== undefined && (d.status === 'aceptada' || d.status === 'editada');
const accion = (s: ReviewState, a: ReviewAction, r: Revisado): ReviewState => {
  const o = applyReviewAction(s, a, { table: TABLA_VACIA, caseList: r.dc.caseList, doc: r.dc.doc });
  if (!o.ok) throw new Error(`volteo:${a.kind}:${o.code}`);
  return o.state;
};
const textoDe = (r: Revisado, s: ReviewState): string => render(r.dc.doc, s).sections.map((x) => x.text).join('\u0000');

interface Volteo { aplica: boolean; impactos: number; restablece: boolean }
/** Rechaza `d` (rechazo por defecto: sin motivo), busca residuos y cuenta los impactos que caen sobre esa mención. */
async function volteo(r: Revisado, d: Detection, entidades: ReadonlySet<string>): Promise<Volteo> {
  const base = r.o.state;
  const s2 = accion(base, { kind: 'rechazar', detectionId: d.id }, r);
  const out = render(r.dc.doc, s2);
  const clave = r.dc.claveDe.get(d.partId) as string;
  const seg = salidaDe(r.dc, out).find((x) => x.parte === clave)?.segmentos ?? [];
  if (caracteresCopiados(seg, d.start, d.end) === 0) return { aplica: false, impactos: 0, restablece: true };   // la sigue cubriendo una edición de tramo
  const run = await runResidueCheck(r.dc.doc, s2, out, { table: TABLA_VACIA, caseList: r.dc.caseList, rules, detect: () => Promise.resolve(vacio) });
  const impactos = run.result.hits.filter((h) => h.partId === d.partId && h.partStart >= d.start && h.partStart < d.end && entidades.has(h.entityId)).length;
  // «Luego restablecer»: la mención vuelve a estar propuesta y la salida es la de antes del volteo (salvo las creadas por una sugerencia,
  // que `restablecer` devuelve a la sugerencia pendiente).
  const s3 = accion(s2, { kind: 'restablecer', detectionId: d.id }, r);
  return { aplica: true, impactos, restablece: d.suggestionId !== undefined || textoDe(r, s3) === textoDe(r, base) };
}

describe('T-RS-18 · volteo exhaustivo sobre el corpus', () => {
  it('T-RS-18 rechazar una mención de una entidad aceptada con ≥ 2 menciones da ≥ 1 impacto con esa entidad en cada volteo INV-G08 INV-R07', async () => {
    const fallos: string[] = [];
    for (const r of revisados) {
      const st = r.o.state;
      for (const e of Object.values(st.entities) as Entity[]) {
        const menciones = e.mentions.map((id) => st.detections[id]).filter(aceptada);
        if (menciones.length < 2) continue;
        for (const d of menciones) {
          const v = await volteo(r, d, new Set([e.id, ...e.sameHolderAs]));
          if (!v.aplica) { conteo.omitidos++; continue; }
          conteo.volteos++;
          const marca = `${r.dc.docId}:${e.type}:${d.id.slice(-6)}`;
          if (!v.restablece) fallos.push(`${marca}:no_restablece`);
          if (v.impactos >= 1) continue;
          const otraIgual = menciones.some((x) => x.id !== d.id && plegar(x.text) === plegar(d.text));
          // Un apellido suelto («Prueba») no se busca solo: es una palabra común y la búsqueda exige más de una palabra (7.13.3).
          const apellidoSuelto = NOMBRES.has(e.type) && !/\s/u.test(d.text.trim());
          if (otraIgual && !apellidoSuelto) fallos.push(marca);
          else informativo.push({ docId: r.dc.docId, tipo: e.type, deteccion: d.id.slice(-6) });
        }
      }
    }
    mkdirSync(salida, { recursive: true });
    writeFileSync(join(salida, 'volteo-informativo.json'), `${JSON.stringify({ formato: 'sig-low/volteo', v: 1, conteo, formaDistintaSinImpacto: informativo }, null, 2)}\n`);
    expect(conteo.volteos).toBeGreaterThan(0);
    expect(fallos).toEqual([]);
  }, 1_800_000);

  it('T-RS-18 igual al rechazar la mención de HC o de NIT de persona natural de cada titular: el impacto lo da el mismo titular INV-G08', async () => {
    const fallos: string[] = [];
    for (const r of revisados) {
      const st = r.o.state;
      for (const e of Object.values(st.entities) as Entity[]) {
        if (e.type !== 'HC' && e.type !== 'NIT') continue;
        // Titular persona natural: otra entidad aceptada del mismo titular (la cédula) sigue en la salida y su número es el de la mención.
        const titulares = e.sameHolderAs.filter((id) => (st.entities[id]?.mentions ?? []).some((m) => aceptada(st.detections[m])));
        if (titulares.length === 0) continue;
        for (const d of e.mentions.map((id) => st.detections[id]).filter(aceptada)) {
          const v = await volteo(r, d, new Set([e.id, ...titulares]));
          if (!v.aplica) continue;
          conteo.hcNit++;
          if (v.impactos < 1) fallos.push(`${r.dc.docId}:${e.type}:${d.id.slice(-6)}`);
        }
      }
    }
    expect(fallos).toEqual([]);
  }, 1_800_000);
});
