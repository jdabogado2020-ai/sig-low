// T-PV-04 (parte PE-1) · Buffers en cero tras leer (V-23). Solo datos ficticios.
// Parte PD-3: texto plano de cifrado y bytes de la frase en ceros (6.7.3, V-23).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SiglowError } from '../../src/core/types';
import type { AsuntoId, DocId, IoLimits, VaultPayload } from '../../src/core/types';
import { handleIoMessage, ponerEnCero } from '../../src/io/io-handler';
import type { HandlerDeps } from '../../src/io/io-handler';
import { IO_LIMITS_POR_DEFECTO } from '../../src/io/io-client';
import { abrirRegistro, cifrar, derivarClave, exportarSiglow, nuevoEncabezado, sellarRegistro, serializarPayload } from '../../src/vault/crypto';

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

// T-PV-04 (parte PD-3) · Texto plano en ceros tras cifrar, también si el cifrado falla; bytes de la frase en ceros tras derivar.
describe('T-PV-04 buffers en cero tras cifrar', () => {
  const ASU = 'asu_00112233445566778899aabbccddeeff' as AsuntoId;
  const SAL = Uint8Array.from({ length: 16 }, (_, i) => i);
  const FRASE = 'frase de prueba ficticia ñandú';
  const AHORA = '2026-10-22T20:00:00.000Z';
  const payload = (): VaultPayload => ({
    formato: 'sig-low/tabla-plana', v: 1, asunto: { asuntoId: ASU, codigo: 'PRUEBA-001', creado: AHORA, actualizado: AHORA }, appVersion: '0.1.0',
    table: { asuntoId: ASU, counters: {}, entries: {}, documents: [] },
    caseList: [{ id: 'cas_00112233445566778899aabbccddeeff' as never, name: 'Ana Ficticia Rojas', variants: [], kind: 'persona', role: 'accionante' as never }],
    relleno: '',
  });
  const todoCeroU8 = (b: Uint8Array): boolean => b.every((x) => x === 0);
  let clave: CryptoKey;
  beforeAll(async () => { clave = await derivarClave(FRASE, SAL, 600000); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('T-PV-04 cifrar deja el texto plano en ceros y el ct descifra al texto original', async () => {
    const plano = serializarPayload(payload());
    const copia = new Uint8Array(plano);
    expect(new TextDecoder().decode(plano)).toContain('Ana Ficticia Rojas');
    const r = await sellarRegistro(clave, { asuntoId: ASU, codigo: 'PRUEBA-001', creado: AHORA, actualizado: AHORA }, { sal: SAL, it: 600000 }, plano);
    expect(todoCeroU8(plano)).toBe(true);
    const abierto = await abrirRegistro(r, FRASE);
    expect(Buffer.from(abierto.plano).equals(Buffer.from(copia))).toBe(true);
  });

  it('T-PV-04 cifrar deja el texto plano en ceros aunque falle (encabezado inválido, tamaño, IV repetido, it fuera de rango)', async () => {
    const enc = nuevoEncabezado({ uso: 'almacen', asuntoId: ASU, it: 600000, sal: SAL });
    const planos = [serializarPayload(payload()), serializarPayload(payload()), serializarPayload(payload())];
    const fallas: Array<() => Promise<unknown>> = [
      () => cifrar(clave, 'sig-low/tabla;v=1', serializarPayload(payload())),
      () => cifrar(clave, enc, new TextEncoder().encode('Ana Ficticia Rojas')),
      async () => { await cifrar(clave, enc, serializarPayload(payload())); return cifrar(clave, enc, planos[0]!); },
      () => exportarSiglow(FRASE, ASU, 599999, planos[1]!),
      () => sellarRegistro(clave, { asuntoId: ASU, codigo: 'PRUEBA-001', creado: AHORA, actualizado: AHORA }, { sal: SAL, it: 5000001 }, planos[2]!),
    ];
    for (const f of fallas) await expect(f()).rejects.toBeInstanceOf(SiglowError);
    for (const p of planos) expect(todoCeroU8(p)).toBe(true);
    const corto = new TextEncoder().encode('Ana Ficticia Rojas');
    await expect(cifrar(clave, enc, corto)).rejects.toMatchObject({ code: 'ENTRADA_INVALIDA' });
    expect(todoCeroU8(corto)).toBe(true);
  });

  it('T-PV-04 exportarSiglow deja el texto plano en ceros', async () => {
    const plano = serializarPayload(payload());
    const json = await exportarSiglow(FRASE, ASU, 600000, plano);
    expect(todoCeroU8(plano)).toBe(true);
    expect(json).not.toContain('Ficticia');
  });

  it('T-PV-04 derivarClave deja en ceros los bytes de la frase que recibe importKey', async () => {
    const vistos: Uint8Array[] = [];
    const real = crypto.subtle.importKey.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'importKey').mockImplementation(((f: 'raw', d: Uint8Array<ArrayBuffer>, a: string, x: boolean, u: KeyUsage[]) => {
      vistos.push(d);
      expect(todoCeroU8(d)).toBe(false);
      return real(f, d, a, x, u);
    }) as never);
    await derivarClave(FRASE, SAL, 600000);
    expect(vistos).toHaveLength(1);
    expect(todoCeroU8(vistos[0]!)).toBe(true);
  });
});
