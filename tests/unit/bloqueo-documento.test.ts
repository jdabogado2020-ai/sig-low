// M-123 (P0-6a de F4) · Con el flujo «Cargar y listo» (D-23) un archivo se lee antes de que exista un caso: el bloqueo por inactividad
// tiene que vigilarlo igual, y al bloquear el documento y el original retenido (D-22) quedan en cero. También el caso efímero que
// Sig-Low abre al anonimizar. Datos ficticios. Falla con el código anterior: sin caso, `evaluar` no bloqueaba nada.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocId, DocumentModel } from '../../src/core/types';
import { guardarOriginal, originalDe } from '../../src/io/original';
import { evaluar, LIMITE_INACTIVIDAD_MS, renovarActividad } from '../../src/ui/bloqueo';
import { actualizarBorrador, hayDocumentoEnMemoria, obtenerBorrador } from '../../src/ui/documento';
import { obtener, obtenerAvisoInicio, reiniciarEstado } from '../../src/ui/estado';
import { asegurarCaso } from '../../src/ui/flujo/flujo';

const DOC = 'doc_000000000000000000000000000000b1' as DocId;
const doc = (): DocumentModel => ({
  id: DOC, label: 'Documento 1', source: 'docx', metadata: { categories: {} }, warnings: [],
  parts: [{ id: 'prt_000000000000000000000000000000b1', docId: DOC, kind: 'cuerpo', label: 'Cuerpo', order: 0, index: 1, text: 'Ana Ficticia Rojas', included: true }],
} as unknown as DocumentModel);

describe('M-123 bloqueo por inactividad con un documento en memoria y sin caso (D-23)', () => {
  afterEach(() => { vi.restoreAllMocks(); reiniciarEstado(); });

  it('INV-G09 INV-D06 un archivo cargado antes de «Anonimizar» se bloquea a los 15 min: el borrador y el original quedan en cero', () => {
    const bytes = new Uint8Array([80, 75, 3, 4, 1, 2, 3]);
    guardarOriginal(DOC, 'docx', bytes.slice());
    actualizarBorrador({ archivo: doc(), formato: 'docx', bytes: bytes.length });
    expect(obtener().asunto).toBeNull();
    expect(hayDocumentoEnMemoria()).toBe(true);
    const retenido = originalDe(DOC)?.bytes;
    renovarActividad(true);
    const ahora = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(ahora + LIMITE_INACTIVIDAD_MS + 1000);
    evaluar();
    expect(obtenerBorrador().archivo).toBeNull();
    expect(originalDe(DOC)).toBeNull();
    expect(retenido?.every((x) => x === 0)).toBe(true);
    expect(hayDocumentoEnMemoria()).toBe(false);
    expect(obtenerAvisoInicio()).toBe('bloqueado');
  });

  it('INV-G09 sin documento, sin caso y sin frase no hay nada que bloquear', () => {
    renovarActividad(true);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + LIMITE_INACTIVIDAD_MS + 1000);
    evaluar();
    expect(obtenerAvisoInicio()).toBeNull();
  });

  it('INV-G09 el caso efímero también se bloquea y avisa solo M-102 (no M-103: el abogado no pidió guardar una llave)', () => {
    asegurarCaso(new Date('2026-11-03T20:00:00Z'));
    expect(obtener().asunto).toMatchObject({ mode: 'no_guardar', efimero: true });
    actualizarBorrador({ texto: 'Demanda de Ana Ficticia Rojas.' });
    renovarActividad(true);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + LIMITE_INACTIVIDAD_MS + 1000);
    evaluar();
    expect(obtener().asunto).toBeNull();
    expect(obtenerBorrador().texto).toBe('');
    expect(obtenerAvisoInicio()).toBe('bloqueado');
  });
});
