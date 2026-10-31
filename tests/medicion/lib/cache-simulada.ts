// Caché fija de salidas SIMULADAS del modelo (T-ME-03): no hay modelo detrás; son tramos derivados del gold con una degradación
// determinista por vista. Sirve para probar el camino de la medición (ventanas -> fusionar -> revisión -> filas por vista) mientras
// PF-3 y PF-4a dejan la caché real. Solo datos ficticios.
import { claveParte, esPositiva } from '../../../scripts/metrics.ts';
import type { RunVista } from '../../../scripts/metrics.ts';
import type { NerLabel, NerSpan } from '../../../src/core/types.ts';
import type { DocCorpus } from './corpus.ts';
import { sha256 } from './cache.ts';
import type { CacheModelo, VentanaCache } from './cache.ts';

const ETIQUETA: Record<string, NerLabel> = {
  PERSONA: 'PER', EMPRESA: 'ORG', EPS: 'ORG', IPS: 'ORG', ENTIDAD: 'ORG', PROVEEDOR: 'ORG',
};

/**
 * Por vista, el modelo simulado «pierde» cada n-ésima persona: ninguna en la vista natural, 1 de cada 5 en
 * MAYÚSCULAS y 1 de cada 3 en minúsculas (más severo que el sondeo real: así las filas por vista se distinguen en la prueba).
 */
const PERDIDA: Readonly<Record<RunVista, number>> = { natural: 0, mayusculas: 5, minusculas: 3 };
const TAM_VENTANA = 1500;

export function cacheSimulada(corpus: readonly DocCorpus[], vista: RunVista, modelo: 'x-large' | 'x-base' = 'x-large'): CacheModelo {
  const documentos: CacheModelo['documentos'] = {};
  for (const dc of corpus) {
    const partes: CacheModelo['documentos'][string]['partes'] = {};
    let personas = 0;
    for (const p of dc.doc.parts) {
      const clave = dc.claveDe.get(p.id) as string;
      const spans: NerSpan[] = [];
      for (const g of dc.gold.anotaciones) {
        if (!esPositiva(g) || claveParte(g.parte) !== clave) continue;
        const label = ETIQUETA[g.tipo];
        if (label === undefined || g.contenidaEn !== undefined) continue;
        if (g.tipo === 'PERSONA') {
          personas++;
          const n = PERDIDA[vista];
          if (n > 0 && personas % n === 0) continue;
        }
        spans.push({ start: g.start, end: g.end, label, score: 0.95 });
      }
      spans.sort((a, b) => a.start - b.start);
      const total = Math.max(1, Math.ceil(p.text.length / TAM_VENTANA));
      const ventanas: VentanaCache[] = [];
      for (let i = 0; i < total; i++) {
        const desde = i * TAM_VENTANA;
        const hasta = i === total - 1 ? p.text.length : desde + TAM_VENTANA;
        ventanas.push({ windowIndex: i, windowTotal: total, ms: 1, spans: spans.filter((s) => s.start >= desde && s.start < hasta) });
      }
      partes[clave] = { sha256: sha256(p.text), ventanas };
    }
    documentos[dc.docId] = { partes };
  }
  const h = sha256('simulada');
  return { formato: 'sig-low/cache-modelo', v: 1, modelo, vista, piso: 0.1, huella: { texto: h, vista: sha256(vista), onnx: h, codigo: h }, documentos };
}
