// Textos de marca del armazón (F1): descriptor del encabezado y operador del pie. Ids M-1601 y M-1602 (rango propio, sin solaparse
// con PC-2 M-13xx, PC-5 M-14xx, PC-6 M-15xx, PC-3 M-17xx ni PC-4 M-18xx). Se registran en el catálogo único para el barrido de PC-7.
import { registrarMensajes } from './mensajes.ts';

registrarMensajes({
  'M-1601': 'por Vergara Melo · Abogado',
  'M-1602': 'Operado por GRUPO EMPRESARIAL NEW WAY S.A.S.',
});

export const MARCA = { descriptor: 'M-1601', operador: 'M-1602' } as const;
