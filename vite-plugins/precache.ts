// Archivo de partida de P0-1 (9.1, regla 10). PD-1 (A8) lo implementa: lista de precache con hashes.
import type { Plugin } from 'vite';

export function precache(): Plugin {
  return { name: 'siglow-precache' };
}
