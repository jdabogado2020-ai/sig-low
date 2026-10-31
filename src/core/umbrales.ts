// Umbrales del modelo local (7.10.9): fuente única de los valores que el producto pasa en `DetectOptions` (6.11.2). Los calibró
// PF-3 con T-AB-03 sobre la caché de salidas (metricas/calibracion-umbral.json): `nerHighThreshold` 0,37 (banda media desde ahí;
// por debajo, baja) y `nerMinScore` 0,30 (piso de proposición, el mismo umbral con que decodifica el motor). La interfaz, la
// medición y el gancho de prueba importan esta constante; T-MO-12 comprueba que coincide con el archivo de calibración.
import type { DetectOptions } from './types.ts';

export const UMBRALES_MODELO: Readonly<Pick<DetectOptions, 'nerHighThreshold' | 'nerMinScore'>> = Object.freeze({
  nerHighThreshold: 0.37,
  nerMinScore: 0.3,
});
