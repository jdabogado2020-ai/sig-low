// Configuración de Vitest de `npm run medir` (PG-3b): las pruebas de tests/medicion/ corren aparte de `verify` (10.3.3).
// Uso: node node_modules/vitest/vitest.mjs run --config tests/medicion/vitest.config.ts [archivos]
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/medicion/**/*.test.ts'],
    environment: 'node',
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
  },
});
