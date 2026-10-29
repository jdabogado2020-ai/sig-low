// Archivo de partida de P0-1 (9.1, regla 10): firma exportada sin lógica. Lo implementa PC-5 (A1) con PB-6: exportGate.
import type { ExportGateFn } from '../types.ts';

export const exportGate: ExportGateFn = () => ({ ok: false, reasons: ['PENDIENTES'] });
