// Texto plano del registro y del .siglow (PD-4; plan 6.7.4, 6.7.6 paso 11, 6.6.3, INV-T01 a INV-T06).
// Arma el VaultPayload de un asunto y valida el que sale de descifrar. Puro: sin DOM, sin red, sin almacenamiento.
// El cifrado es de crypto.ts (PD-3); IndexedDB, de store.ts. Errores solo con ErrorCode.
import { MARKER_FAMILIES, MARKER_LABEL, SiglowError } from '../core/types.ts';
import type { AsuntoId, CaseEntity, MappingTable, MarkerFamily, VaultPayload } from '../core/types.ts';
import type { DatosAsunto } from './crypto.ts';

/** Código del asunto (6.7.1): tras `trim`. */
export const CODIGO_RE = /^(?=.*[A-Za-z0-9])[A-Za-z0-9 ._/-]{1,40}$/u;
const ASUNTO_ID_RE = /^asu_[0-9a-f]{32}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Marcador de 6.2.3 (bandera u, sobre NFC). */
const MARCADOR_RE = new RegExp(`^\\[(${MARKER_FAMILIES.map((f) => MARKER_LABEL[f]).join('|')})_([1-9][0-9]{0,3})\\]$`, 'u');
const FAMILIA_DE_ETIQUETA = new Map(MARKER_FAMILIES.map((f) => [MARKER_LABEL[f], f] as const));
/** Familias que puede unir `sameHolderAs` (6.6.1, «Mismo titular»). */
const FAMILIAS_TITULAR: ReadonlySet<MarkerFamily> = new Set(['CC', 'TI', 'CE', 'PPT', 'PEP', 'DOCUMENTO', 'HC', 'AFILIACION', 'NIT']);

const alterado = (): never => { throw new SiglowError('ARCHIVO_ALTERADO'); };
const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const esTexto = (x: unknown): x is string => typeof x === 'string';

/** VaultPayload del asunto con la tabla y la lista del caso actuales (`relleno` lo calcula serializarPayload). */
export function payloadDe(datos: { caseList: readonly CaseEntity[]; table: MappingTable }, asunto: DatosAsunto, appVersion: string): VaultPayload {
  if (datos.table.asuntoId !== asunto.asuntoId) throw new SiglowError('ENTRADA_INVALIDA');
  return {
    formato: 'sig-low/tabla-plana', v: 1,
    asunto: { asuntoId: asunto.asuntoId, codigo: asunto.codigo, creado: asunto.creado, actualizado: asunto.actualizado },
    appVersion,
    table: datos.table,
    caseList: [...datos.caseList],
    relleno: '',
  };
}

/** Partes del marcador o null si no casa con 6.2.3. */
export function analizarMarcador(m: string): { familia: MarkerFamily; n: number } | null {
  const r = MARCADOR_RE.exec(m);
  const familia = r ? FAMILIA_DE_ETIQUETA.get(r[1]!) : undefined;
  return r && familia ? { familia, n: Number(r[2]) } : null;
}

/** INV-T01, INV-T02, INV-T03, INV-T05 e INV-T06 sobre una tabla ya analizada (INV-T04 es temporal: no se ve en una instantánea). */
function validarTabla(t: Record<string, unknown>, asuntoId: AsuntoId): void {
  if (t['asuntoId'] !== asuntoId || !esObjeto(t['counters']) || !esObjeto(t['entries']) || !Array.isArray(t['documents'])) alterado();
  const counters = t['counters'] as Record<string, unknown>;
  for (const [f, n] of Object.entries(counters)) {
    if (!(MARKER_FAMILIES as readonly string[]).includes(f) || typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 9999) alterado();
  }
  const entries = t['entries'] as Record<string, unknown>;
  const claves = new Set<string>();
  const familias = new Map<string, MarkerFamily>();
  for (const [k, e] of Object.entries(entries)) {
    if (!esObjeto(e)) return alterado();
    const m = analizarMarcador(k);
    // INV-T03: la clave casa con 6.2.3 y es igual a entry.marker.
    if (!m || e['marker'] !== k || e['family'] !== m.familia) return alterado();
    // INV-T02: counters[f] ≥ el mayor n de la familia.
    const c = counters[m.familia];
    if (typeof c !== 'number' || c < m.n) alterado();
    // INV-T01: un marcador ↔ una canonicalKey.
    const ck = e['canonicalKey'];
    if (!esTexto(ck) || ck === '' || claves.has(ck)) alterado();
    claves.add(ck as string);
    // INV-T06: originals sin duplicados exactos.
    const o = e['originals'];
    if (!Array.isArray(o) || !o.every(esTexto) || new Set(o).size !== o.length) alterado();
    if (!esTexto(e['display']) || !Array.isArray(e['documents']) || !Array.isArray(e['sameHolderAs']) || !esObjeto(e['firstSeen'])) alterado();
    familias.set(k, m.familia);
  }
  // INV-T05: sameHolderAs simétrico, sin sí mismo, entre marcadores de la tabla y solo entre familias de identificación.
  for (const [k, e] of Object.entries(entries) as Array<[string, Record<string, unknown>]>) {
    for (const otro of e['sameHolderAs'] as unknown[]) {
      if (!esTexto(otro) || otro === k || !familias.has(otro)) return alterado();
      if (!FAMILIAS_TITULAR.has(familias.get(k)!) || !FAMILIAS_TITULAR.has(familias.get(otro)!)) alterado();
      const reciproco = (entries[otro] as Record<string, unknown>)['sameHolderAs'] as unknown[];
      if (!reciproco.includes(k)) alterado();
    }
  }
}

/**
 * Paso 11 de 6.7.6 (y lectura del registro al desbloquear): el texto plano es un VaultPayload válido, con
 * `asunto.asuntoId` y `table.asuntoId` iguales al `id` del encabezado, e INV-T01 a INV-T06. No pone `plano` en ceros:
 * lo hace quien lo descifró, en un `finally`.
 */
export function validarPayload(plano: Uint8Array, asuntoId: AsuntoId): VaultPayload {
  if (!ASUNTO_ID_RE.test(asuntoId) || plano.byteLength === 0 || plano.byteLength % 4096 !== 0) alterado();
  let o: unknown;
  try {
    o = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(plano));
  } catch {
    return alterado();
  }
  if (!esObjeto(o) || o['formato'] !== 'sig-low/tabla-plana' || o['v'] !== 1 || !esTexto(o['appVersion'])) return alterado();
  const a = o['asunto'];
  if (!esObjeto(a) || a['asuntoId'] !== asuntoId || !esTexto(a['codigo']) || !CODIGO_RE.test(a['codigo']) || a['codigo'] !== a['codigo'].trim()
    || !esTexto(a['creado']) || !ISO_RE.test(a['creado']) || !esTexto(a['actualizado']) || !ISO_RE.test(a['actualizado'])) return alterado();
  const t = o['table'];
  if (!esObjeto(t)) return alterado();
  validarTabla(t, asuntoId);
  const lista = o['caseList'];
  if (!Array.isArray(lista) || !lista.every((c) => esObjeto(c) && esTexto(c['id']) && esTexto(c['name']) && Array.isArray(c['variants']))) alterado();
  if (!esTexto(o['relleno']) || !/^ *$/.test(o['relleno']) || Object.keys(o).at(-1) !== 'relleno') alterado();
  return o as unknown as VaultPayload;
}
