// T-GO-02 · El lector produce el texto canónico esperado (10.3.3; 10.0). Preparada por PG-2.
// Compara, parte por parte, el texto que producen los lectores reales con `corpus/gold/Cxx.texto.json` sobre los .docx y .pdf de `corpus/docs/`.
// Queda SALTADA mientras PE-2, PE-3 y PE-4 no estén fusionadas en main (hoy solo hay lector de .txt): LECTORES.docx no está registrado y
// readPdf (src/io/pdf-read.ts) es la ranura vacía de P0-1. Al fusionarse, la prueba corre sola (npx vitest run --config … tests/medicion) y
// la medición final del integrador (10.3.3) la usa; si falla, rige la regla de cierre de 12.7 (brecha registrada).
// Los .docx de Word C01 y C16 los agrega el dueño (H0-13); si faltan, se omiten.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LECTORES } from '../../src/io/io-handler.ts';
import { IO_LIMITS_POR_DEFECTO } from '../../src/io/io-client.ts';
import type { DocId, IdSource } from '../../src/core/types.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const motivoDocx = 'PE-2 y PE-3 (lector .docx) todavía no están en main: LECTORES.docx no está registrado';
const motivoPdf = 'PE-4 (lector PDF con pdfjs-dist) todavía no está en main: readPdf es la ranura vacía de P0-1';

interface TextoJson { partes: Array<{ kind: string; index: number; page?: number; texto: string }> }
const ids = Array.from({ length: 30 }, (_, i) => `C${String(i + 1).padStart(2, '0')}`);
const idsSecuencia = (): IdSource => { let n = 0; const hex = (): string => (++n).toString(16).padStart(32, '0'); return { next: (p: string) => `${p}_${hex()}` } as unknown as IdSource; };

describe('T-GO-02 lectores · .docx', () => {
  const lector = LECTORES.docx;
  for (const id of ids) {
    const ruta = join(RAIZ, 'corpus', 'docs', `${id}.docx`);
    if (!existsSync(ruta)) continue;
    const t = (): TextoJson => JSON.parse(readFileSync(join(RAIZ, 'corpus', 'gold', `${id}.texto.json`), 'utf8')) as TextoJson;
    const ejecutar = lector !== undefined;
    (ejecutar ? it : it.skip)(`T-GO-02 ${id}.docx: partes y texto canónico iguales a Cxx.texto.json${ejecutar ? '' : ` (saltada: ${motivoDocx})`}`, () => {
      const bytes = readFileSync(ruta);
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const doc = (lector as NonNullable<typeof lector>)(buf, { docId: ('doc_' + '0'.repeat(32)) as DocId, label: 'Documento 1', ids: idsSecuencia() }, IO_LIMITS_POR_DEFECTO, () => undefined);
      const esperado = t().partes;
      expect(doc.parts.map((p) => [p.kind, p.index])).toEqual(esperado.map((p) => [p.kind, p.index]));
      doc.parts.forEach((p, i) => expect(p.text, `${id} ${p.kind} ${p.index}`).toBe((esperado[i] as { texto: string }).texto));
    });
  }
});

describe('T-GO-02 lectores · .pdf', () => {
  for (const id of ids) {
    if (!existsSync(join(RAIZ, 'corpus', 'docs', `${id}.pdf`))) continue;
    it.skip(`T-GO-02 ${id}.pdf: páginas y anotaciones iguales a Cxx.texto.json (saltada: ${motivoPdf})`, () => {
      // Pendiente de PE-4: leer con readPdf (src/io/pdf-read.ts) y comparar parte por parte, como en .docx.
      // C04 (escaneado) no se mide: debe lanzar PDF_SIN_CAPA_TEXTO.
    });
  }
});
