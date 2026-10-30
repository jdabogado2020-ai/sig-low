// Arnés de la fase «pdf» de cero red (PE-4-r1, M-3): usa readPdf con la configuración de la app (IO_LIMITS_POR_DEFECTO,
// worker de módulo del mismo origen) y expone leer(): solo devuelve un resumen sin texto. No es parte de la app.
import type { DocId } from '../../../src/core/types';
import { IO_LIMITS_POR_DEFECTO } from '../../../src/io/io-client';
import { readPdf } from '../../../src/io/pdf-read';

export interface ResumenPdf {
  error?: string;
  partes?: Array<{ kind: string; label: string; largo: number }>;
  avisos?: string[];
  categorias?: string[];
}

(globalThis as unknown as Record<string, unknown>)['__pdf'] = {
  async leer(ruta: string): Promise<ResumenPdf> {
    const bytes = await (await fetch(ruta)).arrayBuffer();
    try {
      const d = await readPdf(
        bytes, { docId: 'doc_00112233445566778899aabbccddeeff' as DocId, label: 'Documento 1', limits: IO_LIMITS_POR_DEFECTO },
        () => undefined, new AbortController().signal,
      );
      return {
        partes: d.parts.map((p) => ({ kind: p.kind, label: p.label, largo: p.text.length })),
        avisos: d.warnings.map((w) => w.code),
        categorias: Object.keys(d.metadata.categories),
      };
    } catch (e) {
      return { error: (e as { code?: string }).code ?? 'DESCONOCIDO' };
    }
  },
};
