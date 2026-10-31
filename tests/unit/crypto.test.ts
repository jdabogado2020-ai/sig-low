// T-CI-01 a T-CI-07 (PD-3; 10.8.2): vector V-SIGLOW-1 (6.7.5), contraseña errónea, archivo alterado, parámetros fuera de
// rango y propiedades de vault/crypto.ts (6.7.2 a 6.7.6, V-17). Solo datos ficticios.
import { createHash } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SiglowError } from '../../src/core/types';
import type { AsuntoId, AsuntoRecord, PassphraseIssue, VaultPayload } from '../../src/core/types';
import * as C from '../../src/vault/crypto';

const FRASE = 'frase de prueba ficticia ñandú';
const FRASE_NFD = FRASE.normalize('NFD');
const SIN_TILDES = 'frase de prueba ficticia nandu';
const ID = 'asu_00112233445566778899aabbccddeeff' as AsuntoId;
const SAL = Uint8Array.from({ length: 16 }, (_, i) => i);
const ENC = 'sig-low/tabla;v=1;uso=exportacion;id=asu_00112233445566778899aabbccddeeff;kdf=PBKDF2;hash=SHA-256;it=600000;sal=AAECAwQFBgcICQoLDA0ODw==;cif=AES-GCM;iv=EBESExQVFhcYGRob;tag=128';
const PLANO_TXT = '{"formato":"sig-low/tabla-plana","v":1,"asunto":{"asuntoId":"asu_00112233445566778899aabbccddeeff","codigo":"PRUEBA-001","creado":"2026-10-22T20:00:00.000Z","actualizado":"2026-10-22T20:00:00.000Z"},"appVersion":"0.1.0","table":{"asuntoId":"asu_00112233445566778899aabbccddeeff","counters":{},"entries":{},"documents":[]},"caseList":[],"relleno":"'
  + ' '.repeat(3747) + '"}';
const SHA_PLANO = '5e3e992300afc98202a3a8b2fcea0ae3572d5ff7e80e12be67693072255f36aa';
const SHA_CT = '6bcc6d2f9b887f5fdac1aa547ca85bad8d42acfbd0d8546fca39ddedc424a03b';
/** ct de V-SIGLOW-1 completo (6.7.5 lo abrevia); su sha256 es SHA_CT, que fija el plan. */
const CT_B64 = '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';
const VECTOR = {
  formato: 'sig-low/tabla', v: 1,
  kdf: { alg: 'PBKDF2', hash: 'SHA-256', iteraciones: 600000, sal: 'AAECAwQFBgcICQoLDA0ODw==' },
  cifrado: { alg: 'AES-GCM', iv: 'EBESExQVFhcYGRob', tagBits: 128 },
  encabezado: ENC,
  ct: CT_B64,
};
const PAYLOAD: VaultPayload = {
  formato: 'sig-low/tabla-plana', v: 1,
  asunto: { asuntoId: ID, codigo: 'PRUEBA-001', creado: '2026-10-22T20:00:00.000Z', actualizado: '2026-10-22T20:00:00.000Z' },
  appVersion: '0.1.0',
  table: { asuntoId: ID, counters: {}, entries: {}, documents: [] },
  caseList: [],
  relleno: '',
};

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);
type Vector = Record<string, unknown> & { kdf: Record<string, unknown>; cifrado: Record<string, unknown> };
const copia = (): Vector => structuredClone(VECTOR) as Vector;
const bytesDe = (o: unknown): Uint8Array<ArrayBuffer> => enc(JSON.stringify(o));
const conIt = (o: Vector, it: unknown): Vector => {
  o.kdf['iteraciones'] = it;
  o['encabezado'] = String(o['encabezado']).replace('it=600000', `it=${String(it)}`);
  return o;
};

/** Código del SiglowError que lanza la operación; el mensaje es solo el código (F-07). */
async function codigoDe(f: () => unknown): Promise<string> {
  try {
    await f();
  } catch (e) {
    expect(e).toBeInstanceOf(SiglowError);
    expect((e as SiglowError).message).toBe((e as SiglowError).code);
    return (e as SiglowError).code;
  }
  return 'SIN_ERROR';
}
function espias() {
  return {
    importKey: vi.spyOn(crypto.subtle, 'importKey'),
    deriveKey: vi.spyOn(crypto.subtle, 'deriveKey'),
    decrypt: vi.spyOn(crypto.subtle, 'decrypt'),
  };
}
afterEach(() => { vi.restoreAllMocks(); });

let claveVector: CryptoKey;
beforeAll(async () => {
  expect(CT_B64).toHaveLength(5484);
  claveVector = await C.derivarClave(FRASE, SAL, 600000);
});

describe('T-CI-01 vector V-SIGLOW-1', () => {
  it('T-CI-01 el texto plano de serializarPayload es el del vector: 4096 B, 3747 espacios de relleno, sha256 del vector', () => {
    const plano = C.serializarPayload(PAYLOAD);
    expect(plano.byteLength).toBe(4096);
    expect(new TextDecoder().decode(plano)).toBe(PLANO_TXT);
    expect(sha(plano)).toBe(SHA_PLANO);
  });

  it('T-CI-01 INV-V03 la clave de derivarClave con la frase y la sal del vector, AES-GCM con su IV y AAD = encabezado, da su ct (4112 B, 5484 car., sha256) y armarSiglow su .siglow', async () => {
    // cifrar solo admite encabezados recién creados (B-15): el vector, con IV fijo, se cifra con Web Crypto directo.
    expect(await codigoDe(() => C.cifrar(claveVector, ENC, enc(PLANO_TXT)))).toBe('ERROR_INTERNO');
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: C.deBase64('EBESExQVFhcYGRob')!, additionalData: enc(ENC), tagLength: 128 }, claveVector, enc(PLANO_TXT)));
    expect(ct.byteLength).toBe(4112);
    expect(sha(ct)).toBe(SHA_CT);
    const b64 = C.aBase64(ct);
    expect(b64).toHaveLength(5484);
    expect(b64.startsWith('/qRAB8/b1iIVKIsW17D+fe5f')).toBe(true);
    expect(b64.endsWith('ktHjquN9loJnlo/Ya2++tFE=')).toBe(true);
    expect(b64).toBe(CT_B64);
    const json = C.armarSiglow(ENC, ct);
    expect(JSON.parse(json)).toEqual(VECTOR);
    expect(json).toBe(JSON.stringify(VECTOR));   // claves en el orden de 6.7.5
    expect(json.charCodeAt(0)).toBe(0x7b);        // sin BOM
  });

  it('T-CI-01 INV-V06 abrirSiglow con la frase en NFC y en NFD descifra los 4096 bytes esperados', async () => {
    expect(FRASE_NFD).not.toBe(FRASE);
    expect(sha(C.deBase64(CT_B64)!)).toBe(SHA_CT);
    for (const frase of [FRASE, FRASE_NFD]) {
      const r = await C.abrirSiglow(bytesDe(VECTOR), frase);
      expect(r.plano.byteLength).toBe(4096);
      expect(sha(r.plano)).toBe(SHA_PLANO);
      expect(r.asuntoId).toBe(ID);
      expect(r.encabezado).toBe(ENC);
    }
  });

  it('T-CI-01 INV-V06 la frase en NFC y en NFD llega a importKey con los mismos bytes y da la misma clave', async () => {
    const vistos: string[] = [];
    const real = crypto.subtle.importKey.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'importKey').mockImplementation(((f: 'raw', d: Uint8Array<ArrayBuffer>, a: string, x: boolean, u: KeyUsage[]) => {
      vistos.push(Buffer.from(d).toString('hex'));
      return real(f, d, a, x, u);
    }) as never);
    const k1 = await C.derivarClave(FRASE, SAL, 600000);
    const k2 = await C.derivarClave(FRASE_NFD, SAL, 600000);
    expect(vistos).toHaveLength(2);
    expect(vistos[0]).toBe(vistos[1]);
    const ct = C.deBase64(CT_B64)!;
    expect(sha(await C.descifrar(k1, ENC, ct))).toBe(SHA_PLANO);
    expect(sha(await C.descifrar(k2, ENC, ct))).toBe(SHA_PLANO);
  });
});

describe('T-CI-02 contraseña errónea', () => {
  it('T-CI-02 la frase sin tildes da OperationError en Web Crypto y CONTRASENA_O_ARCHIVO en abrirSiglow, sin texto plano', async () => {
    const clave = await C.derivarClave(SIN_TILDES, SAL, 600000);
    const iv = C.deBase64('EBESExQVFhcYGRob')!;
    await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc(ENC), tagLength: 128 }, clave, C.deBase64(CT_B64)!))
      .rejects.toMatchObject({ name: 'OperationError' });
    const e = espias();
    expect(await codigoDe(() => C.abrirSiglow(bytesDe(VECTOR), SIN_TILDES))).toBe('CONTRASENA_O_ARCHIVO');
    expect(e.deriveKey).toHaveBeenCalledTimes(1);
    expect(e.decrypt).toHaveBeenCalledTimes(1);
    await expect(e.decrypt.mock.results[0]!.value).rejects.toMatchObject({ name: 'OperationError' });
    expect(await codigoDe(() => C.descifrar(clave, ENC, C.deBase64(CT_B64)!))).toBe('CONTRASENA_O_ARCHIVO');
  });
});

describe('T-CI-03 archivo alterado', () => {
  it('T-CI-03 INV-V03 AAD alterada (un byte del encabezado, uso=almacen) → OperationError en Web Crypto', async () => {
    const iv = C.deBase64('EBESExQVFhcYGRob')!;
    const ct = C.deBase64(CT_B64)!;
    const otraAad = [ENC.replace('eeff;', 'eefe;'), ENC.replace('uso=exportacion', 'uso=almacen'), ENC.replace('tag=128', 'tag=129'), ENC + ' '];
    for (const a of otraAad) {
      await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc(a), tagLength: 128 }, claveVector, ct))
        .rejects.toMatchObject({ name: 'OperationError' });
    }
    expect(sha(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc(ENC), tagLength: 128 }, claveVector, ct)))).toBe(SHA_PLANO);
  });

  it('T-CI-03 INV-V03 un byte del ct o un byte del encabezado que sigue casando con 6.7.2 → CONTRASENA_O_ARCHIVO (falla la etiqueta)', async () => {
    const ct = C.deBase64(CT_B64)!;
    for (const i of [0, 2047, 4095, 4111]) {
      const otro = new Uint8Array(ct);
      otro[i]! ^= 0x01;
      const o = copia();
      o['ct'] = C.aBase64(otro);
      const e = espias();
      expect(await codigoDe(() => C.abrirSiglow(bytesDe(o), FRASE))).toBe('CONTRASENA_O_ARCHIVO');
      expect(e.decrypt).toHaveBeenCalledTimes(1);
      vi.restoreAllMocks();
    }
    const o = copia();
    o['encabezado'] = ENC.replace('eeff;', 'eefe;');
    expect(await codigoDe(() => C.abrirSiglow(bytesDe(o), FRASE))).toBe('CONTRASENA_O_ARCHIVO');
  });

  it('T-CI-03 INV-V04 uso=almacen, encabezado fuera de 6.7.2, it/sal/iv del JSON distintos del encabezado o ct inválido → ARCHIVO_ALTERADO sin derivar', async () => {
    const casos: Array<[string, (o: Vector) => void]> = [
      ['uso=almacen', (o) => { o['encabezado'] = ENC.replace('uso=exportacion', 'uso=almacen'); }],
      ['kdf=pbkdf2', (o) => { o['encabezado'] = ENC.replace('kdf=PBKDF2', 'kdf=pbkdf2'); }],
      ['espacio tras ;', (o) => { o['encabezado'] = ENC.replace(';v=1', '; v=1'); }],
      ['tag=96', (o) => { o['encabezado'] = ENC.replace('tag=128', 'tag=96'); }],
      ['it=60000', (o) => { o['encabezado'] = ENC.replace('it=600000', 'it=60000'); }],
      ['encabezado no texto', (o) => { o['encabezado'] = 7; }],
      ['it del JSON distinto', (o) => { o.kdf['iteraciones'] = 600001; }],
      ['it del encabezado distinto', (o) => { o['encabezado'] = ENC.replace('it=600000', 'it=600001'); }],
      ['sal del JSON distinta', (o) => { o.kdf['sal'] = 'AAECAwQFBgcICQoLDA0ODg=='; }],
      ['iv del JSON distinto', (o) => { o.cifrado['iv'] = 'EBESExQVFhcYGRoa'; }],
      ['ct de 4111 B', (o) => { o['ct'] = C.aBase64(C.deBase64(CT_B64)!.subarray(0, 4111)); }],
      ['ct de 4113 B', (o) => { o['ct'] = C.aBase64(new Uint8Array(4113)); }],
      ['ct de 16 B', (o) => { o['ct'] = C.aBase64(new Uint8Array(16)); }],
      ['ct no base64', (o) => { o['ct'] = CT_B64.replace('/', '-'); }],
      ['ct base64 con espacio', (o) => { o['ct'] = CT_B64.slice(0, 4) + ' ' + CT_B64.slice(4); }],
    ];
    for (const [nombre, cambiar] of casos) {
      const o = copia();
      cambiar(o);
      const e = espias();
      expect(await codigoDe(() => C.abrirSiglow(bytesDe(o), FRASE)), nombre).toBe('ARCHIVO_ALTERADO');
      expect(e.importKey, nombre).not.toHaveBeenCalled();
      expect(e.deriveKey, nombre).not.toHaveBeenCalled();
      expect(e.decrypt, nombre).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  });

  it('T-CI-03 INV-V04 registro del almacén: uso, asuntoId, iv distinto del encabezado o ct inválido → ARCHIVO_ALTERADO sin derivar', async () => {
    const r = await C.sellarRegistro(claveVector, { asuntoId: ID, codigo: 'PRUEBA-001', creado: '2026-10-22T20:00:00.000Z', actualizado: '2026-10-22T20:00:00.000Z' }, { sal: SAL, it: 600000 }, C.serializarPayload(PAYLOAD));
    expect(r.encabezado).toMatch(C.ENCABEZADO_RE);
    expect(r.encabezado).toContain(';uso=almacen;');
    const abierto = await C.abrirRegistro(r, FRASE);
    expect(sha(abierto.plano)).toBe(SHA_PLANO);
    expect(abierto.it).toBe(600000);
    const malos: Array<[string, AsuntoRecord]> = [
      ['uso=exportacion', { ...r, encabezado: r.encabezado.replace('uso=almacen', 'uso=exportacion') }],
      ['otro asuntoId', { ...r, asuntoId: 'asu_ffffffffffffffffffffffffffffffff' as AsuntoId }],
      ['iv distinto', { ...r, iv: new Uint8Array(12).buffer }],
      ['ct corto', { ...r, ct: r.ct.slice(0, 4111) }],
      ['encabezado alterado', { ...r, encabezado: r.encabezado.replace('kdf=PBKDF2', 'kdf=PBKDF3') }],
    ];
    for (const [nombre, m] of malos) {
      const e = espias();
      expect(await codigoDe(() => C.abrirRegistro(m, FRASE)), nombre).toBe('ARCHIVO_ALTERADO');
      expect(e.deriveKey, nombre).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
    const otroByte = new Uint8Array(r.ct.slice(0));
    otroByte[100]! ^= 0x80;
    expect(await codigoDe(() => C.abrirRegistro({ ...r, ct: otroByte.buffer }, FRASE))).toBe('CONTRASENA_O_ARCHIVO');
    expect(await codigoDe(() => C.abrirRegistro(r, SIN_TILDES))).toBe('CONTRASENA_O_ARCHIVO');
  });
});

describe('T-CI-04 iteraciones fuera de rango', () => {
  it('T-CI-04 INV-V04 599 999, 5 000 001 y 1 000 000 000 en el JSON y en el encabezado → PARAMETROS_FUERA_DE_RANGO sin llamar a deriveKey', async () => {
    for (const it of [599999, 5000001, 1000000000, 0, -600000, 600000.5, Number.MAX_SAFE_INTEGER + 2, '600000', null]) {
      const e = espias();
      expect(await codigoDe(() => C.abrirSiglow(bytesDe(conIt(copia(), it)), FRASE)), String(it)).toBe('PARAMETROS_FUERA_DE_RANGO');
      expect(e.importKey, String(it)).not.toHaveBeenCalled();
      expect(e.deriveKey, String(it)).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  });

  it('T-CI-04 INV-V04 derivarClave, analizarEncabezado, abrirRegistro, exportarSiglow y claveParaFraseNueva rechazan antes de deriveKey', async () => {
    const e = espias();
    for (const it of [599999, 5000001, 1000000000, Number.NaN, Infinity, 600000.5]) {
      expect(await codigoDe(() => C.derivarClave(FRASE, SAL, it)), String(it)).toBe('PARAMETROS_FUERA_DE_RANGO');
      expect(await codigoDe(() => C.exportarSiglow(FRASE, ID, it, new Uint8Array(4096), null)), String(it)).toBe('PARAMETROS_FUERA_DE_RANGO');
      expect(await codigoDe(() => C.claveParaFraseNueva('mesa azul tren nueve lámpara', 'PRUEBA-001', it)), String(it)).toBe('PARAMETROS_FUERA_DE_RANGO');
    }
    expect(await codigoDe(() => C.derivarClave(FRASE, new Uint8Array(8), 600000))).toBe('PARAMETROS_FUERA_DE_RANGO');
    for (const it of [599999, 5000001]) {
      const h = ENC.replace('it=600000', `it=${it}`).replace('uso=exportacion', 'uso=almacen');
      expect(await codigoDe(() => C.analizarEncabezado(h)), String(it)).toBe('PARAMETROS_FUERA_DE_RANGO');
      const r: AsuntoRecord = { asuntoId: ID, codigo: 'PRUEBA-001', creado: '2026-10-22T20:00:00.000Z', actualizado: '2026-10-22T20:00:00.000Z', encabezado: h, iv: C.deBase64('EBESExQVFhcYGRob')!.buffer, ct: new ArrayBuffer(4112) };
      expect(await codigoDe(() => C.abrirRegistro(r, FRASE)), String(it)).toBe('PARAMETROS_FUERA_DE_RANGO');
    }
    // 1 000 000 000 tiene 10 dígitos: el encabezado ya no casa con 6.7.2 y se rechaza igual antes de derivar.
    expect(await codigoDe(() => C.analizarEncabezado(ENC.replace('it=600000', 'it=1000000000')))).toBe('ARCHIVO_ALTERADO');
    expect(e.importKey).not.toHaveBeenCalled();
    expect(e.deriveKey).not.toHaveBeenCalled();
    expect(await codigoDe(() => C.armarEncabezado({ uso: 'almacen', asuntoId: ID, it: 599999, sal: SAL, iv: new Uint8Array(12) }))).toBe('PARAMETROS_FUERA_DE_RANGO');
  });

  it('T-CI-04 INV-V04 los extremos 600 000 y 5 000 000 se aceptan (encabezado de 6.7.2)', () => {
    for (const it of [600000, 600001, 5000000]) {
      const h = C.armarEncabezado({ uso: 'almacen', asuntoId: ID, it, sal: SAL, iv: new Uint8Array(12) });
      expect(h).toMatch(C.ENCABEZADO_RE);
      expect(C.analizarEncabezado(h).it).toBe(it);
      expect(h.length).toBeLessThanOrEqual(256);
    }
  });
});

describe('T-CI-05 versión y KDF', () => {
  it('T-CI-05 v: 2 → VERSION_MAS_RECIENTE; v: "1" → FORMATO_DESCONOCIDO; kdf.alg argon2id → KDF_NO_ADMITIDO, sin derivar', async () => {
    const casos: Array<[string, (o: Vector) => unknown, string]> = [
      ['v: 2', (o) => { o['v'] = 2; }, 'VERSION_MAS_RECIENTE'],
      ['v: 37', (o) => { o['v'] = 37; }, 'VERSION_MAS_RECIENTE'],
      ['v: "1"', (o) => { o['v'] = '1'; }, 'FORMATO_DESCONOCIDO'],
      ['v: 1.5', (o) => { o['v'] = 1.5; }, 'FORMATO_DESCONOCIDO'],
      ['v: 0', (o) => { o['v'] = 0; }, 'FORMATO_DESCONOCIDO'],
      ['formato', (o) => { o['formato'] = 'sig-low/tabla-plana'; }, 'FORMATO_DESCONOCIDO'],
      ['argon2id', (o) => { o['kdf'] = { alg: 'argon2id', m: 65536, t: 3, p: 1, sal: 'AAECAwQFBgcICQoLDA0ODw==' }; }, 'KDF_NO_ADMITIDO'],
      ['hash SHA-1', (o) => { o.kdf['hash'] = 'SHA-1'; }, 'KDF_NO_ADMITIDO'],
      ['alg pbkdf2', (o) => { o.kdf['alg'] = 'pbkdf2'; }, 'KDF_NO_ADMITIDO'],
      ['kdf texto', (o) => { (o as Record<string, unknown>)['kdf'] = 'PBKDF2'; }, 'KDF_NO_ADMITIDO'],
      ['kdf con clave extra', (o) => { o.kdf['memoria'] = 1; }, 'KDF_NO_ADMITIDO'],
      ['v: 2 y argon2id (gana el paso 4)', (o) => { o['v'] = 2; o['kdf'] = { alg: 'argon2id' }; }, 'VERSION_MAS_RECIENTE'],
    ];
    for (const [nombre, cambiar, esperado] of casos) {
      const o = copia();
      cambiar(o);
      const e = espias();
      expect(await codigoDe(() => C.abrirSiglow(bytesDe(o), FRASE)), nombre).toBe(esperado);
      expect(e.deriveKey, nombre).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
    const argon = ENC.replace('kdf=PBKDF2;hash=SHA-256;it=600000', 'kdf=argon2id;m=65536;t=3;p=1');
    expect(await codigoDe(() => C.analizarEncabezado(argon))).toBe('KDF_NO_ADMITIDO');
  });
});

describe('T-CI-06 parámetros y estructura', () => {
  it('T-CI-06 IV de 16 B, sal de 8 B, tagBits 96, una clave extra y archivo de 6 MB → el código de 6.7.6, sin derivar', async () => {
    const seis = new Uint8Array(6 * 1024 * 1024).fill(0x20);
    seis.set(bytesDe(VECTOR).subarray(0, 50));
    const casos: Array<[string, Uint8Array, string]> = [
      ['IV de 16 B', bytesDe({ ...copia(), cifrado: { alg: 'AES-GCM', iv: C.aBase64(new Uint8Array(16)), tagBits: 128 } }), 'PARAMETROS_FUERA_DE_RANGO'],
      ['sal de 8 B', bytesDe({ ...copia(), kdf: { ...VECTOR.kdf, sal: C.aBase64(new Uint8Array(8)) } }), 'PARAMETROS_FUERA_DE_RANGO'],
      ['tagBits 96', bytesDe({ ...copia(), cifrado: { ...VECTOR.cifrado, tagBits: 96 } }), 'PARAMETROS_FUERA_DE_RANGO'],
      ['clave extra', bytesDe({ ...copia(), comentario: 'Prueba' }), 'FORMATO_DESCONOCIDO'],
      ['archivo de 6 MB', seis, 'ARCHIVO_DEMASIADO_GRANDE'],
      ['5 MiB + 1 B', new Uint8Array(5242881), 'ARCHIVO_DEMASIADO_GRANDE'],
      ['5 MiB exactos pasan el paso 1', new Uint8Array(5242880), 'FORMATO_DESCONOCIDO'],
      ['falta una clave', bytesDe({ formato: 'sig-low/tabla', v: 1, kdf: VECTOR.kdf, cifrado: VECTOR.cifrado, encabezado: ENC }), 'FORMATO_DESCONOCIDO'],
      ['no es JSON', enc('sig-low/tabla'), 'FORMATO_DESCONOCIDO'],
      ['arreglo', bytesDe([VECTOR]), 'FORMATO_DESCONOCIDO'],
      ['null', enc('null'), 'FORMATO_DESCONOCIDO'],
      ['UTF-8 inválido', new Uint8Array([0x7b, 0xff, 0x7d]), 'FORMATO_DESCONOCIDO'],
      ['__proto__ extra', enc(JSON.stringify(VECTOR).replace('{"formato"', '{"__proto__":{},"formato"')), 'FORMATO_DESCONOCIDO'],
      ['sal no canónica', bytesDe({ ...copia(), kdf: { ...VECTOR.kdf, sal: 'AAECAwQFBgcICQoLDA0ODx==' } }), 'PARAMETROS_FUERA_DE_RANGO'],
      ['sal sin relleno', bytesDe({ ...copia(), kdf: { ...VECTOR.kdf, sal: 'AAECAwQFBgcICQoLDA0ODw' } }), 'PARAMETROS_FUERA_DE_RANGO'],
      ['iv base64url', bytesDe({ ...copia(), cifrado: { ...VECTOR.cifrado, iv: 'EBESExQVFhcYGRo_' } }), 'PARAMETROS_FUERA_DE_RANGO'],
      ['alg AES-CBC', bytesDe({ ...copia(), cifrado: { ...VECTOR.cifrado, alg: 'AES-CBC' } }), 'PARAMETROS_FUERA_DE_RANGO'],
      ['tagBits "128"', bytesDe({ ...copia(), cifrado: { ...VECTOR.cifrado, tagBits: '128' } }), 'PARAMETROS_FUERA_DE_RANGO'],
      ['cifrado con clave extra', bytesDe({ ...copia(), cifrado: { ...VECTOR.cifrado, aad: 'x' } }), 'PARAMETROS_FUERA_DE_RANGO'],
    ];
    for (const [nombre, bytes, esperado] of casos) {
      const e = espias();
      expect(await codigoDe(() => C.abrirSiglow(bytes, FRASE)), nombre).toBe(esperado);
      expect(e.deriveKey, nombre).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
    // Al leer, el orden de las claves es libre (6.7.5) y se admite un ArrayBuffer.
    const desordenado = { ct: CT_B64, encabezado: ENC, cifrado: VECTOR.cifrado, kdf: VECTOR.kdf, v: 1, formato: 'sig-low/tabla' };
    expect(sha((await C.abrirSiglow(bytesDe(desordenado).buffer, FRASE)).plano)).toBe(SHA_PLANO);
  });
});

describe('T-CI-07 propiedades', () => {
  it('T-CI-07 INV-V05 la clave derivada no es extraíble: exportKey lanza InvalidAccessError; importKey y deriveKey con los parámetros de 6.7.3', async () => {
    const e = espias();
    const clave = await C.derivarClave(FRASE, SAL, 600000);
    for (const formato of ['raw', 'jwk'] as const) {
      await expect(crypto.subtle.exportKey(formato, clave)).rejects.toMatchObject({ name: 'InvalidAccessError' });
    }
    expect(clave.extractable).toBe(false);
    expect(clave.type).toBe('secret');
    expect(clave.algorithm).toEqual({ name: 'AES-GCM', length: 256 });
    expect([...clave.usages].sort()).toEqual(['decrypt', 'encrypt']);
    const [formato, , algImport, extraibleBase, usosBase] = e.importKey.mock.calls[0]!;
    expect([formato, algImport, extraibleBase, usosBase]).toEqual(['raw', 'PBKDF2', false, ['deriveKey']]);
    const [algDerivar, , algClave, extraible, usos] = e.deriveKey.mock.calls[0]!;
    expect(algDerivar).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000 });
    expect(algClave).toEqual({ name: 'AES-GCM', length: 256 });
    expect([extraible, usos]).toEqual([false, ['encrypt', 'decrypt']]);
  });

  it('T-CI-07 INV-V02 1000 guardados con la misma clave → 1000 IV distintos, iv del registro = iv del encabezado, ct % 4096 = 16', async () => {
    const datos = { asuntoId: ID, codigo: 'PRUEBA-001', creado: '2026-10-22T20:00:00.000Z', actualizado: '2026-10-22T20:00:00.000Z' };
    const ivs = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const r = await C.sellarRegistro(claveVector, datos, { sal: SAL, it: 600000 }, C.serializarPayload(PAYLOAD));
      const iv = C.aBase64(new Uint8Array(r.iv));
      expect(r.iv.byteLength).toBe(12);
      expect(C.analizarEncabezado(r.encabezado).ivB64).toBe(iv);
      expect(r.ct.byteLength % 4096).toBe(16);
      ivs.add(iv);
    }
    expect(ivs.size).toBe(1000);
  });

  it('T-CI-07 INV-V02 INV-V03 cifrar usa el IV y los bytes de un encabezado recién creado, y lo consume: repetirlo o uno ajeno → ERROR_INTERNO', async () => {
    const clave = await C.derivarClave(FRASE, SAL, 600000);
    const h = C.nuevoEncabezado({ uso: 'almacen', asuntoId: ID, it: 600000, sal: SAL });
    const ct = await C.cifrar(clave, h, enc(PLANO_TXT));
    const iv = C.analizarEncabezado(h).iv;
    expect(sha(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc(h), tagLength: 128 }, clave, ct)))).toBe(SHA_PLANO);
    const otro = enc(PLANO_TXT);
    expect(await codigoDe(() => C.cifrar(clave, h, otro))).toBe('ERROR_INTERNO');           // mismo encabezado, mismo IV
    expect(otro.every((x) => x === 0)).toBe(true);
    expect(await codigoDe(() => C.cifrar(clave, ENC, enc(PLANO_TXT)))).toBe('ERROR_INTERNO');  // armado fuera de nuevoEncabezado
    expect(await codigoDe(() => C.cifrar(clave, C.armarEncabezado({ uso: 'almacen', asuntoId: ID, it: 600000, sal: SAL, iv: new Uint8Array(12) }), enc(PLANO_TXT)))).toBe('ERROR_INTERNO');
  });

  it('T-CI-07 INV-V02 B-15: con la clave de abrirRegistro no se puede volver a cifrar con el encabezado (ni el IV) del registro', async () => {
    const datos = { asuntoId: ID, codigo: 'PRUEBA-001', creado: '2026-10-22T20:00:00.000Z', actualizado: '2026-10-22T20:00:00.000Z' };
    const r = await C.sellarRegistro(claveVector, datos, { sal: SAL, it: 600000 }, C.serializarPayload(PAYLOAD));
    const abierto = await C.abrirRegistro(r, FRASE);
    abierto.plano.fill(0);
    const plano = C.serializarPayload(PAYLOAD);
    expect(await codigoDe(() => C.cifrar(abierto.clave, r.encabezado, plano))).toBe('ERROR_INTERNO');
    expect(plano.every((x) => x === 0)).toBe(true);
    // Guardar otra vez con sellarRegistro: encabezado e IV nuevos.
    const r2 = await C.sellarRegistro(abierto.clave, datos, { sal: abierto.sal, it: abierto.it }, C.serializarPayload(PAYLOAD));
    expect(C.analizarEncabezado(r2.encabezado).ivB64).not.toBe(C.analizarEncabezado(r.encabezado).ivB64);
    expect(sha((await C.abrirRegistro(r2, FRASE)).plano)).toBe(SHA_PLANO);
  });

  it('T-CI-07 B-16: exportarSiglow con el registro del asunto exige que la frase lo abra; frase errónea → CONTRASENA_O_ARCHIVO sin exportar', async () => {
    const datos = { asuntoId: ID, codigo: 'PRUEBA-001', creado: '2026-10-22T20:00:00.000Z', actualizado: '2026-10-22T20:00:00.000Z' };
    const r = await C.sellarRegistro(claveVector, datos, { sal: SAL, it: 600000 }, C.serializarPayload(PAYLOAD));
    const e = espias();
    const plano = C.serializarPayload(PAYLOAD);
    expect(await codigoDe(() => C.exportarSiglow(SIN_TILDES, ID, 600000, plano, r))).toBe('CONTRASENA_O_ARCHIVO');
    expect(plano.every((x) => x === 0)).toBe(true);
    expect(e.deriveKey).toHaveBeenCalledTimes(1);   // solo la comprobación; no se derivó la clave de exportación
    vi.restoreAllMocks();
    const otroId = { ...r, asuntoId: 'asu_ffffffffffffffffffffffffffffffff' as AsuntoId };
    expect(await codigoDe(() => C.exportarSiglow(FRASE, ID, 600000, C.serializarPayload(PAYLOAD), otroId))).toBe('ENTRADA_INVALIDA');
    const json = await C.exportarSiglow(FRASE_NFD, ID, 600000, C.serializarPayload(PAYLOAD), r);
    expect(sha((await C.abrirSiglow(enc(json), FRASE)).plano)).toBe(SHA_PLANO);
  });

  it('T-CI-07 dos exportaciones de la misma tabla, sin valores fijos, difieren en sal, iv y ct, y las dos se abren', async () => {
    const a = JSON.parse(await C.exportarSiglow(FRASE, ID, 600000, C.serializarPayload(PAYLOAD), null)) as typeof VECTOR;
    const b = JSON.parse(await C.exportarSiglow(FRASE, ID, 600000, C.serializarPayload(PAYLOAD), null)) as typeof VECTOR;
    expect(Object.keys(a)).toEqual(['formato', 'v', 'kdf', 'cifrado', 'encabezado', 'ct']);
    expect(a.kdf.sal).not.toBe(b.kdf.sal);
    expect(a.cifrado.iv).not.toBe(b.cifrado.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(a.encabezado).toContain(';uso=exportacion;');
    for (const x of [a, b]) expect(sha((await C.abrirSiglow(bytesDe(x), FRASE_NFD)).plano)).toBe(SHA_PLANO);
  });

  it('T-CI-07 INV-V10 validatePassphrase cumple los casos de 6.7.3', () => {
    const casos: Array<[string, string, PassphraseIssue[]]> = [
      ['frase de prueba ficticia ñandú', 'PRUEBA-001', []],
      ['mesa azul tren nueve lámpara', 'PRUEBA-001', []],
      ['aaaaaaaaaaaaaaa', 'PRUEBA-001', ['POCA_VARIEDAD']],
      ['123456789012345', 'PRUEBA-001', ['SOLO_DIGITOS', 'SECUENCIA']],
      ['PRUEBA-001PRUEBA-001', 'PRUEBA-001', ['CONTIENE_CODIGO']],
      ['qwertyuiopasdfg', 'PRUEBA-001', ['SECUENCIA']],
      ['frase corta', 'PRUEBA-001', ['CORTA']],
    ];
    for (const [frase, codigo, esperado] of casos) expect(C.validatePassphrase(frase, codigo), frase).toEqual(esperado);
  });

  it('T-CI-07 INV-V10 validatePassphrase: reglas de 6.7.3 en los bordes', () => {
    const casos: Array<[string, string, PassphraseIssue[]]> = [
      ['', 'PRUEBA-001', ['CORTA', 'POCA_VARIEDAD']],
      ['frase de pruebá'.normalize('NFD'), 'X', []],                                       // 15 puntos de código en NFC
      ['frase de prueb', 'X', ['CORTA']],                                                   // 14
      ['🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑', 'X', ['POCA_VARIEDAD']],                                // 15 puntos de código, 30 unidades UTF-16
      ['ab ab ab ab ab ab ab ab', 'X', ['POCA_VARIEDAD', 'SECUENCIA']],
      ['abcde abcde abcde', 'X', ['POCA_VARIEDAD']],                                        // e→a no es contiguo
      ['1 2 3 4 5 6 7 8 9 0 1 2', 'X', ['SOLO_DIGITOS', 'SECUENCIA']],
      ['987654321098765', 'X', ['SOLO_DIGITOS', 'SECUENCIA']],
      ['159263748159263', 'X', ['SOLO_DIGITOS']],
      ['               ', 'X', ['POCA_VARIEDAD', 'SOLO_DIGITOS']],
      ['LMNÑOPQRSTUVWXYZ', 'X', ['SECUENCIA']],                                             // la ñ es letra del alfabeto
      ['zyxwvutsrqpoñnml', 'X', ['SECUENCIA']],
      ['xyzabcdefghijklm', 'X', ['SECUENCIA']],                                             // cíclica
      ['QWERTYUIOPASDFGHJKLÑZXC', 'X', ['SECUENCIA']],
      ['mnbvcxzñlkjhgfdsa', 'X', ['SECUENCIA']],
      ['Ásdfghjklñzxcvbn', 'X', ['SECUENCIA']],                                            // sin diacríticos
      ['Mi asunto prueba-001 está aquí', 'PRUEBA-001', ['CONTIENE_CODIGO']],
      ['Mi asunto 2026 / 045 está aquí', '2026/045', ['CONTIENE_CODIGO']],                   // plano() quita espacios
      ['Mi frase con A1 adentro largo', 'A1', []],                                         // código de menos de 4
      ['Contraseña muy segura', 'X', ['FRASE_COMUN']],
      ['  CONTRASEÑA    MUY   segura ', 'X', ['FRASE_COMUN']],
      ['correct horse battery staple', 'X', ['FRASE_COMUN']],
      ['el señor es mi pastor y guía', 'X', []],
    ];
    for (const [frase, codigo, esperado] of casos) expect(C.validatePassphrase(frase, codigo), frase).toEqual(esperado);
  });

  it('T-CI-07 INV-V10 claveParaFraseNueva no calibra ni deriva si validatePassphrase devuelve problemas', async () => {
    const e = espias();
    for (const frase of ['aaaaaaaaaaaaaaa', '123456789012345', 'PRUEBA-001PRUEBA-001', 'qwertyuiopasdfg', 'frase corta', 'Contraseña muy segura']) {
      expect(await codigoDe(() => C.claveParaFraseNueva(frase, 'PRUEBA-001')), frase).toBe('ENTRADA_INVALIDA');
      expect(await codigoDe(() => C.claveParaFraseNueva(frase, 'PRUEBA-001', 600000)), frase).toBe('ENTRADA_INVALIDA');
    }
    expect(e.importKey).not.toHaveBeenCalled();
    expect(e.deriveKey).not.toHaveBeenCalled();
    const r = await C.claveParaFraseNueva('mesa azul tren nueve lámpara', 'PRUEBA-001', 600000);
    expect(r.sal.byteLength).toBe(16);
    expect(r.it).toBe(600000);
    expect(e.deriveKey).toHaveBeenCalledTimes(1);
    const otra = await C.claveParaFraseNueva('mesa azul tren nueve lámpara', 'PRUEBA-001', 600000);
    expect(C.aBase64(otra.sal)).not.toBe(C.aBase64(r.sal));   // sal nueva al fijar la frase
  });

  it('T-CI-07 calibración: it = clamp(redondear_arriba(600 000 × 0,5 s / t₆₀₀ₖ, 50 000), 600 000, 5 000 000)', async () => {
    const casos: Array<[number, number]> = [[250, 1200000], [240, 1250000], [204, 1500000], [303, 1000000], [500, 600000], [1000, 600000],
      [100, 3000000], [60, 5000000], [50, 5000000], [0, 5000000], [-1, 5000000], [Number.NaN, 5000000], [Infinity, 600000]];
    for (const [t, it] of casos) expect(C.iteracionesPara(t), String(t)).toBe(it);
    for (let t = 1; t < 2000; t += 7.3) {
      const it = C.iteracionesPara(t);
      expect(it % 50000).toBe(0);
      expect(it >= 600000 && it <= 5000000).toBe(true);
    }
    const e = espias();
    const t = await C.medirT600k();
    expect(t).toBeGreaterThan(0);
    expect(e.deriveKey.mock.calls[0]![0]).toMatchObject({ name: 'PBKDF2', iterations: 600000 });
    const it = await C.calibrarIteraciones();
    expect(it >= 600000 && it <= 5000000 && it % 50000 === 0).toBe(true);
  });

  it('T-CI-07 base64 estándar con relleno: nativo y propio coinciden; se rechaza lo no canónico', () => {
    const muestras = Array.from({ length: 40 }, (_, n) => C.bytesAleatorios(n));
    const nativos = muestras.map((b) => [C.aBase64(b), Buffer.from(b).toString('base64')]);
    for (const [a, b] of nativos) expect(a).toBe(b);
    const proto = Uint8Array.prototype as unknown as Record<string, unknown>;
    const ctor = Uint8Array as unknown as Record<string, unknown>;
    const toB = Object.getOwnPropertyDescriptor(proto, 'toBase64');
    const fromB = Object.getOwnPropertyDescriptor(ctor, 'fromBase64');
    try {
      delete proto['toBase64'];
      delete ctor['fromBase64'];
      muestras.forEach((b, i) => {
        expect(C.aBase64(b)).toBe(nativos[i]![1]);
        expect(Buffer.from(C.deBase64(nativos[i]![1])!).equals(Buffer.from(b))).toBe(true);
      });
      for (const malo of ['AAECAwQFBgcICQoLDA0ODx==', 'AA=', 'A', 'AAAA AAAA', 'AA==AA==', '-_8=']) expect(C.deBase64(malo), malo).toBeNull();
    } finally {
      if (toB) Object.defineProperty(proto, 'toBase64', toB);
      if (fromB) Object.defineProperty(ctor, 'fromBase64', fromB);
    }
    for (const malo of ['AAECAwQFBgcICQoLDA0ODx==', 'AA=', 'A', 'AAAA AAAA', 'AA==AA==', '-_8=', 7]) expect(C.deBase64(malo), String(malo)).toBeNull();
    expect(C.deBase64('')!.byteLength).toBe(0);
  });

  it('T-CI-07 serializarPayload: relleno hasta un múltiplo de 4096 bytes con datos multibyte, y el relleno es el último campo', () => {
    for (const n of [0, 1, 300]) {
      const p: VaultPayload = structuredClone(PAYLOAD);
      for (let i = 1; i <= n; i++) {
        p.table.entries[`[PER_${i}]`] = {
          marker: `[PER_${i}]`, family: 'PER' as never, type: 'PERSONA' as never, canonicalKey: `ana ficticia rojas ${i}`,
          display: `Ana Ficticia Núñez ${i} 🔑`, originals: [`ANA FICTICIA NÚÑEZ ${i}`],
          firstSeen: { docId: 'doc_00112233445566778899aabbccddeeff' as never, partKind: 'cuerpo' as never, partOrder: 0, start: 0 },
          documents: [], sameHolderAs: [],
        };
      }
      const bytes = C.serializarPayload(p);
      expect(bytes.byteLength % 4096, String(n)).toBe(0);
      const texto = new TextDecoder().decode(bytes);
      expect(texto.endsWith('"}')).toBe(true);
      const o = JSON.parse(texto) as Record<string, unknown>;
      expect(Object.keys(o)).toEqual(['formato', 'v', 'asunto', 'appVersion', 'table', 'caseList', 'relleno']);
      expect(o['relleno']).toMatch(/^ *$/);
      expect(Object.keys((o['table'] as { entries: object }).entries)).toHaveLength(n);
    }
  });
});

// Paso 11 de 6.7.6 (PD-4, vault/export.ts): un .siglow que descifra bien pero cuyo texto plano no es un VaultPayload válido
// (o rompe INV-T01 a INV-T06) se rechaza con ARCHIVO_ALTERADO. Se cifra con la API real para que el paso 10 pase.
describe('T-CI-03 archivo alterado: texto plano inválido (paso 11, PD-4)', () => {
  const entrada = (n: number, extra: Record<string, unknown> = {}) => ({
    marker: `[CC_${n}]`, family: 'CC', type: 'CC', canonicalKey: `CC:100000001${n}`, display: `1.000.000.01${n}`,
    originals: [`1.000.000.01${n}`], firstSeen: { docId: 'doc_00112233445566778899aabbccddeeff', partKind: 'cuerpo', partOrder: 0, start: 0 },
    documents: [], sameHolderAs: [], ...extra,
  });
  const base = (): Record<string, unknown> => ({
    formato: 'sig-low/tabla-plana', v: 1,
    asunto: { asuntoId: ID, codigo: 'PRUEBA-001', creado: '2026-10-22T20:00:00.000Z', actualizado: '2026-10-22T20:00:00.000Z' },
    appVersion: '0.1.0',
    table: { asuntoId: ID, counters: { CC: 2 }, entries: { '[CC_1]': entrada(1), '[CC_2]': entrada(2) }, documents: [] },
    caseList: [{ id: 'cas_00112233445566778899aabbccddeeff', name: 'Ana Ficticia Rojas', variants: [], kind: 'persona', role: 'demandante' }],
    relleno: '',
  });
  /** JSON con relleno hasta 4096·k bytes (el mismo cálculo que serializarPayload, sin pasar por su validación de tipos). */
  const plano = (o: Record<string, unknown>): Uint8Array<ArrayBuffer> => {
    const sin = { ...o, relleno: '' };
    const n = enc(JSON.stringify(sin)).byteLength;
    return enc(JSON.stringify({ ...sin, relleno: ' '.repeat((4096 - (n % 4096)) % 4096) }));
  };

  it('T-CI-03 un VaultPayload válido pasa el paso 11 y uno manipulado da ARCHIVO_ALTERADO', async () => {
    const { validarPayload } = await import('../../src/vault/export');
    expect(validarPayload(plano(base()), ID).table.entries['[CC_1]']?.marker).toBe('[CC_1]');
    const casos: Array<[string, (o: Record<string, unknown>) => void]> = [
      ['formato', (o) => { o['formato'] = 'sig-low/tabla'; }],
      ['v', (o) => { o['v'] = 2; }],
      ['asuntoId del asunto', (o) => { (o['asunto'] as Record<string, unknown>)['asuntoId'] = 'asu_ffffffffffffffffffffffffffffffff'; }],
      ['asuntoId de la tabla', (o) => { (o['table'] as Record<string, unknown>)['asuntoId'] = 'asu_ffffffffffffffffffffffffffffffff'; }],
      ['código con eñe', (o) => { (o['asunto'] as Record<string, unknown>)['codigo'] = 'ROJAS-AÑA'; }],
      ['fecha no ISO', (o) => { (o['asunto'] as Record<string, unknown>)['creado'] = '22/10/2026'; }],
      ['INV-T01 canonicalKey repetida', (o) => { ((o['table'] as { entries: Record<string, Record<string, unknown>> }).entries['[CC_2]']!)['canonicalKey'] = 'CC:1000000011'; }],
      ['INV-T02 counters menor', (o) => { (o['table'] as Record<string, unknown>)['counters'] = { CC: 1 }; }],
      ['INV-T03 clave sin tilde', (o) => { (o['table'] as Record<string, unknown>)['entries'] = { '[DIRECCION_1]': { ...entrada(1), marker: '[DIRECCION_1]', family: 'DIRECCION' } }; }],
      ['INV-T03 clave ≠ marker', (o) => { ((o['table'] as { entries: Record<string, Record<string, unknown>> }).entries['[CC_2]']!)['marker'] = '[CC_1]'; }],
      ['INV-T05 no simétrico', (o) => { ((o['table'] as { entries: Record<string, Record<string, unknown>> }).entries['[CC_1]']!)['sameHolderAs'] = ['[CC_2]']; }],
      ['INV-T06 originals repetidos', (o) => { ((o['table'] as { entries: Record<string, Record<string, unknown>> }).entries['[CC_1]']!)['originals'] = ['1', '1']; }],
      ['caseList no arreglo', (o) => { o['caseList'] = {}; }],
    ];
    for (const [nombre, cambiar] of casos) {
      const o = base();
      cambiar(o);
      expect(await codigoDe(() => validarPayload(plano(o), ID)), nombre).toBe('ARCHIVO_ALTERADO');
    }
    const conX = plano(base());
    conX[conX.byteLength - 3] = 0x78;   // una «x» dentro del relleno
    expect(await codigoDe(() => validarPayload(conX, ID)), 'relleno no espacios').toBe('ARCHIVO_ALTERADO');
    const simetrico = base();
    const e = (simetrico['table'] as { entries: Record<string, Record<string, unknown>> }).entries;
    e['[CC_1]']!['sameHolderAs'] = ['[CC_2]'];
    e['[CC_2]']!['sameHolderAs'] = ['[CC_1]'];
    expect(validarPayload(plano(simetrico), ID).table.entries['[CC_2]']?.sameHolderAs).toEqual(['[CC_1]']);
    expect(await codigoDe(() => validarPayload(enc('{"formato":"sig-low/tabla-plana"}'), ID))).toBe('ARCHIVO_ALTERADO');   // no mide 4096·k
  });

  it('T-CI-03 un .siglow con texto plano manipulado descifra (paso 10) y se rechaza en el paso 11', async () => {
    const { validarPayload } = await import('../../src/vault/export');
    const o = base();
    (o['table'] as Record<string, unknown>)['counters'] = { CC: 1 };
    const json = await C.exportarSiglow(FRASE, ID, 600000, plano(o), null);
    const abierto = await C.abrirSiglow(enc(json), FRASE);
    expect(await codigoDe(() => validarPayload(abierto.plano, abierto.asuntoId))).toBe('ARCHIVO_ALTERADO');
  });
});
