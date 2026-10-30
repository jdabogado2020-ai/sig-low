// T-PV-04 (parte PE-1) · Buffers en cero tras leer (V-23). Solo datos ficticios.
// La parte «tras cifrar» la añade PD-3 en este mismo archivo.
import { describe, expect, it } from 'vitest';
import { SiglowError } from '../../src/core/types';
import type { DocId, IoLimits } from '../../src/core/types';
import { handleIoMessage, ponerEnCero } from '../../src/io/io-handler';
import type { HandlerDeps } from '../../src/io/io-handler';
import { IO_LIMITS_POR_DEFECTO } from '../../src/io/io-client';

const DOC = 'doc_00112233445566778899aabbccddeeff' as DocId;
const REQ = 'req_00112233445566778899aabbccddeeff';
const LIMITES: IoLimits = { ...IO_LIMITS_POR_DEFECTO };

function bufferDe(s: string): ArrayBuffer {
  const u = new TextEncoder().encode(s);
  const b = new ArrayBuffer(u.length);
  new Uint8Array(b).set(u);
  return b;
}
const todoCero = (b: ArrayBuffer): boolean => new Uint8Array(b).every((x) => x === 0);
function leer(bytes: ArrayBuffer, extra: Record<string, unknown> = {}, deps?: HandlerDeps): unknown[] {
  const out: unknown[] = [];
  handleIoMessage(
    { v: 1, reqId: REQ, kind: 'leer', payload: { format: 'txt', bytes, docId: DOC, label: 'Documento 1', limits: LIMITES, ...extra } },
    (m) => { out.push(m); },
    deps,
  );
  return out;
}

describe('T-PV-04 buffers en cero tras leer', () => {
  it('T-PV-04 el buffer recibido queda en ceros tras una lectura correcta, y el texto leído no se altera', () => {
    const b = bufferDe('Ana Ficticia Rojas presentó la tutela. Señor José Ejemplo.');
    expect(todoCero(b)).toBe(false);
    const r = leer(b) as Array<{ kind: string; payload?: { doc: { parts: Array<{ text: string }> } } }>;
    expect(todoCero(b)).toBe(true);
    expect(r.at(-1)?.kind).toBe('resultado');
    expect(r.at(-1)?.payload?.doc.parts[0]?.text).toBe('Ana Ficticia Rojas presentó la tutela. Señor José Ejemplo.');
  });
  it('T-PV-04 queda en ceros en UTF-16, windows-1252 y con BOM', () => {
    const utf16 = new Uint8Array([0xff, 0xfe, 0x48, 0, 0x6f, 0, 0x6c, 0, 0x61, 0]).buffer;
    const w1252 = new Uint8Array([0x53, 0x65, 0xf1, 0x6f, 0x72, 0x20, 0x4a, 0x6f, 0x73, 0xe9]).buffer;
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x48, 0x6f, 0x6c, 0x61]).buffer;
    for (const b of [utf16, w1252, bom]) {
      expect(todoCero(b)).toBe(false);
      leer(b);
      expect(todoCero(b)).toBe(true);
    }
  });
  it('T-PV-04 queda en ceros aunque la lectura falle (excepción interna, vacío tras decodificar, formato falso)', () => {
    const falla = bufferDe('Ana Ficticia Rojas');
    leer(falla, {}, { readers: { txt: () => { throw new SiglowError('XML_INVALIDO'); } } });
    expect(todoCero(falla)).toBe(true);
    const espacios = bufferDe('   \n\n  ');
    expect((leer(espacios).at(-1) as { code: string }).code).toBe('ARCHIVO_VACIO');
    expect(todoCero(espacios)).toBe(true);
    const pdf = bufferDe('%PDF-1.7 ejemplo');
    leer(pdf);
    expect(todoCero(pdf)).toBe(true);
  });
  it('T-PV-04 queda en ceros si el archivo excede el límite o la petición es inválida', () => {
    const grande = bufferDe('0123456789ABC');
    leer(grande, { limits: { ...LIMITES, maxFileBytes: 5 } });
    expect(todoCero(grande)).toBe(true);
    const etiquetaMala = bufferDe('Ana Ficticia Rojas');
    leer(etiquetaMala, { label: 'Ana Ficticia Rojas.txt' });
    expect(todoCero(etiquetaMala)).toBe(true);
    const formatoMalo = bufferDe('Ana Ficticia Rojas');
    leer(formatoMalo, { format: 'pdf' });
    expect(todoCero(formatoMalo)).toBe(true);
  });
  it('T-PV-04 un lector que conserva una vista del buffer solo ve ceros después de leer', () => {
    const b = bufferDe('Ana Ficticia Rojas');
    let vista: Uint8Array | null = null;
    leer(b, {}, { readers: { txt: (bytes) => { vista = new Uint8Array(bytes); throw new SiglowError('ERROR_INTERNO'); } } });
    expect(vista).not.toBeNull();
    expect((vista as unknown as Uint8Array).every((x) => x === 0)).toBe(true);
  });
  it('T-PV-04 ponerEnCero ignora lo que no es un buffer y un buffer ya transferido', () => {
    expect(() => { ponerEnCero(undefined); ponerEnCero('texto'); ponerEnCero(null); }).not.toThrow();
    const b = new ArrayBuffer(8);
    structuredClone(b, { transfer: [b] });
    expect(() => { ponerEnCero(b); }).not.toThrow();
  });
});
