// Lectura del corpus (gold y texto canónico esperado) y armado del `DocumentModel` de la medición (PG-3b, plan 10.3.3).
// Solo Node. El texto canónico sale de `corpus/gold/Cxx.texto.json`; la medición del motor no pasa por los lectores (10.3.3).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newCaseEntity, refreshVariants } from '../../../src/core/caselist.ts';
import type { CaseEntity, DocId, DocumentModel, IdSource, Part, PartId, PartKind, Role } from '../../../src/core/types.ts';
import { claveParte } from '../../../scripts/metrics.ts';
import type { GoldDocument } from '../../../scripts/metrics.ts';

export const RAIZ: string = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export const CARPETA_CORPUS: string = join(RAIZ, 'corpus');

export type Conjunto = 'todo' | 'desarrollo' | 'reserva';

interface GoldArchivo extends GoldDocument {
  listaDelCaso: Array<{ name: string; role: string }>;
  esperado: { partes: unknown[]; error?: string };
}
interface TextoArchivo {
  docId: string;
  partes: Array<{ kind: PartKind; index: number; page?: number; texto: string }>;
}

/** Un documento listo para el motor: modelo, lista del caso y la clave de parte de cada `PartId`. */
export interface DocCorpus {
  docId: string;
  gold: GoldDocument;
  doc: DocumentModel;
  caseList: CaseEntity[];
  /** `PartId` → clave de parte (`claveParte`), la misma que usan el gold y las entradas de las métricas. */
  claveDe: ReadonlyMap<PartId, string>;
  /** clave de parte → `PartId`. */
  partDe: ReadonlyMap<string, PartId>;
  paginas: number;
}

const CLASES_ORG: ReadonlySet<string> = new Set(['EMPRESA', 'EPS', 'IPS', 'ENTIDAD', 'PROVEEDOR']);

/** Ids deterministas (`pfx_<32 hex>`): las pruebas y los informes no dependen del azar. */
export function idsSecuenciales(inicio = 1): IdSource {
  let n = inicio;
  return { next: (p) => `${p}_${(n++).toString(16).padStart(32, '0')}` };
}

const leer = <T>(ruta: string): T => JSON.parse(readFileSync(ruta, 'utf8')) as T;

/** Documentos medibles del corpus: con anotaciones y sin el error de lectura esperado (p. ej. C04, PDF sin capa de texto). */
export function cargarCorpus(conjunto: Conjunto = 'todo', carpeta: string = CARPETA_CORPUS): DocCorpus[] {
  const dirGold = join(carpeta, 'gold');
  if (!existsSync(dirGold)) return [];
  const ids = readdirSync(dirGold).filter((f) => /^C\d\d\.json$/u.test(f)).map((f) => f.slice(0, 3)).sort();
  const out: DocCorpus[] = [];
  const idsDoc = idsSecuenciales(1);
  for (const id of ids) {
    const gold = leer<GoldArchivo>(join(dirGold, `${id}.json`));
    if (gold.esperado.error !== undefined || gold.anotaciones.length === 0) continue;
    if (conjunto !== 'todo' && gold.conjunto !== conjunto) continue;
    const texto = leer<TextoArchivo>(join(dirGold, `${id}.texto.json`));
    out.push(armarDocumento(gold, texto, idsDoc));
  }
  return out;
}

export function armarDocumento(gold: GoldArchivo, texto: TextoArchivo, ids: IdSource): DocCorpus {
  const docId = ids.next('doc') as DocId;
  const claveDe = new Map<PartId, string>();
  const partDe = new Map<string, PartId>();
  const parts: Part[] = texto.partes.map((p, i) => {
    const id = ids.next('prt') as PartId;
    const clave = claveParte({ kind: p.kind, index: p.index, ...(p.page === undefined ? {} : { page: p.page }) });
    claveDe.set(id, clave);
    partDe.set(clave, id);
    return {
      id, docId, kind: p.kind, label: `Parte ${i + 1}`, order: i, index: p.index, ...(p.page === undefined ? {} : { page: p.page }),
      text: p.texto, included: true,
    };
  });
  const doc: DocumentModel = {
    id: docId, label: 'Documento 1', source: 'pegado', metadata: { categories: {} }, warnings: [], parts,
  };
  const lista: CaseEntity[] = [];
  for (const l of gold.listaDelCaso) {
    const e = newCaseEntity(l.name, CLASES_ORG.has(l.role) ? 'organizacion' : 'persona', l.role as Role, ids);
    if (e !== null) lista.push(e);
  }
  // Páginas normalizadas (10.3.1): las del PDF si las hay; si no, 3.000 caracteres por página (≈ 500 palabras).
  const conPagina = parts.filter((p) => p.page !== undefined);
  const paginas = conPagina.length > 0
    ? new Set(conPagina.map((p) => p.page)).size
    : Math.max(1, parts.reduce((s, p) => s + p.text.length, 0) / 3000);
  return { docId: gold.docId, gold, doc, caseList: refreshVariants(lista), claveDe, partDe, paginas };
}
