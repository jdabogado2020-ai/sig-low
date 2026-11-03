// F4 · T-OM-01 a T-OM-03 · El original en memoria (D-22): se guarda al leer, nunca fuera de la memoria, y queda en cero al cambiar de
// documento, al cerrar, al bloquear y en `pagehide` (que vacían el estado [M] con `vaciarEstadoM`). Solo datos ficticios.
// Fallan con el código anterior: el original se ponía en cero al leerlo y `io/original.ts` no existía.
import { describe, expect, it } from 'vitest';
import type { DocId, DocumentModel } from '../../src/core/types';
import { handleIoMessage } from '../../src/io/io-handler';
import type { WorkerIo } from '../../src/io/io-client';
import { docIdDelOriginal, guardarOriginal, originalDe, soltarOriginal } from '../../src/io/original';
import { actualizarBorrador, vaciarTodoElDocumento } from '../../src/ui/documento';
import { leerContenido } from '../../src/ui/lectura';
import { vaciarEstadoM } from '../../src/ui/sesion';
import { construirDocx, pt } from '../fixtures/docx/docx-builder';

/** Worker `io` en el mismo proceso: el manejador real, con su puesta en cero del buffer recibido. */
function workerEnProceso(): WorkerIo {
  const w: WorkerIo = {
    onmessage: null, onerror: null, onmessageerror: null,
    postMessage(msg: unknown) { queueMicrotask(() => { handleIoMessage(msg, (m) => { w.onmessage?.({ data: m }); }); }); },
    terminate() { /* sin efecto */ },
  };
  return w;
}
const todoCero = (b: Uint8Array): boolean => b.every((x) => x === 0);

async function cargarDocx(texto: string): Promise<{ doc: DocumentModel; bytes: Uint8Array }> {
  const bytes = construirDocx({ cuerpo: pt(texto) });
  const archivo = Object.assign(new Blob([bytes.slice()]), { name: 'demanda.docx' });
  const r = await leerContenido({ archivo, label: 'Documento 1', signal: new AbortController().signal, alAvanzar: () => undefined, crearWorker: workerEnProceso });
  return { doc: r.doc, bytes };
}

describe('T-OM · original en memoria', () => {
  it('T-OM-01 INV-D06 leer un .docx guarda una copia exacta del original (el worker sigue poniendo en cero la suya)', async () => {
    const { doc, bytes } = await cargarDocx('Demanda de Ana Ficticia Rojas.');
    const o = originalDe(doc.id);
    expect(o?.formato).toBe('docx');
    expect(o?.bytes).toEqual(bytes);
    expect(originalDe('doc_ffffffffffffffffffffffffffffffff' as DocId)).toBeNull();
    soltarOriginal();
  });

  it('T-OM-02 INV-D06 queda en cero al cargar otro documento, al quitar el archivo del borrador y al vaciar todo el documento', async () => {
    const a = await cargarDocx('Primer documento de Ana Ficticia.');
    actualizarBorrador({ archivo: a.doc });
    const guardadoA = originalDe(a.doc.id)?.bytes as Uint8Array;
    const b = await cargarDocx('Segundo documento de José Ejemplo.');
    expect(todoCero(guardadoA)).toBe(true); // guardar otro pone el anterior en cero
    actualizarBorrador({ archivo: b.doc });
    const guardadoB = originalDe(b.doc.id)?.bytes as Uint8Array;
    expect(todoCero(guardadoB)).toBe(false);
    actualizarBorrador({ archivo: null }); // error de lectura o descarte del archivo
    expect(todoCero(guardadoB)).toBe(true);
    expect(docIdDelOriginal()).toBeNull();

    const c = await cargarDocx('Tercer documento de Ana Ficticia.');
    actualizarBorrador({ archivo: c.doc });
    const guardadoC = originalDe(c.doc.id)?.bytes as Uint8Array;
    vaciarTodoElDocumento(); // «Cerrar asunto», «Borrar todo»
    expect(todoCero(guardadoC)).toBe(true);
    expect(originalDe(c.doc.id)).toBeNull();
  });

  it('T-OM-03 INV-D06 bloqueo y pagehide (vaciarEstadoM) ponen el original en cero; guardar directamente también es idempotente', async () => {
    const d = await cargarDocx('Cuarto documento de Ana Ficticia.');
    actualizarBorrador({ archivo: d.doc });
    const guardado = originalDe(d.doc.id)?.bytes as Uint8Array;
    vaciarEstadoM();
    expect(todoCero(guardado)).toBe(true);
    expect(docIdDelOriginal()).toBeNull();

    const x = Uint8Array.from([1, 2, 3]);
    guardarOriginal('doc_00000000000000000000000000000001' as DocId, 'pdf', x);
    guardarOriginal('doc_00000000000000000000000000000001' as DocId, 'pdf', x); // el mismo buffer: no se borra a sí mismo
    expect(Array.from(x)).toEqual([1, 2, 3]);
    soltarOriginal();
    soltarOriginal();
    expect(Array.from(x)).toEqual([0, 0, 0]);
  });
});
