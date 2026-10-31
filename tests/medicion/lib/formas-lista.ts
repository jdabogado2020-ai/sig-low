// PB-4-r2 (M-60) · El generador de variantes de la lista del caso, para la clasificación de residuos de scripts/metrics.ts.
// `metrics.ts` corre con Node sin Vite y no puede importar `caselist.ts`; la medición (Vitest) sí, y se lo entrega a `construirInforme`.
// Mismo camino que `residue.ts` para las formas derivadas: `newCaseEntity` y `refreshVariants` sobre el nombre observado.
import { newCaseEntity, refreshVariants } from '../../../src/core/caselist.ts';
import { ORG_CLASSES } from '../../../src/core/types.ts';
import type { FormaGenerada, GeneradorDeFormas } from '../../../scripts/metrics.ts';
import type { IdSource, Role } from '../../../src/core/types.ts';

/** Ids locales de las entidades temporales: nunca salen de este módulo. */
function idsLocales(): IdSource {
  let n = 0;
  return { next: (p) => `${p}_${'f'.repeat(16)}${(++n).toString(16).padStart(16, '0')}` };
}

export const formasDeLaLista: GeneradorDeFormas = (nombre, tipo): readonly FormaGenerada[] => {
  const esOrg = (ORG_CLASSES as readonly string[]).includes(tipo);
  if (tipo !== 'PERSONA' && !esOrg) return [];
  const role: Role = esOrg ? (tipo as Role) : 'OTRA_PERSONA';
  const ce = newCaseEntity(nombre, esOrg ? 'organizacion' : 'persona', role, idsLocales());
  if (ce === null) return [];
  const [gen] = refreshVariants([ce]);
  return (gen?.variants ?? []).filter((v) => v.enabled).map((v) => ({ texto: v.text, clase: v.class }));
};
