/// <reference types="vitest/config" />
import { defineConfig, defaultClientConditions } from 'vite';
import { readFileSync } from 'node:fs';
import { precache } from './vite-plugins/precache.ts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Contrato de construcción (9.1, paso 4 de verify): sin inlining, sin sourcemaps, sin console.
export default defineConfig(({ mode }) => {
  const medicion = mode === 'medicion';
  return {
    cacheDir: '.vite-cache',
    // Lista de precache con SHA-256 y configuración de sw.js (PD-1, 3.2).
    plugins: [precache()],
    // ORT-web: build CPU sin el cargador incrustado (`blob:`); el .mjs y el .wasm se sirven desde /ort/ (4.6.1, V-09).
    resolve: { conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions] },
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
    define: {
      __SIGLOW_VERSION__: JSON.stringify(pkg.version),
      __SIGLOW_MEDICION__: JSON.stringify(medicion),
    },
    build: {
      outDir: medicion ? 'dist-medicion' : 'dist',
      emptyOutDir: true,
      target: 'es2024',
      assetsInlineLimit: 0,
      sourcemap: false,
      modulePreload: { polyfill: false },
      reportCompressedSize: false,
      rolldownOptions: {
        input: { index: 'index.html', sw: 'src/sw.ts' },
        output: {
          entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
          minify: { compress: { dropConsole: true, dropDebugger: true } },
        },
      },
    },
    worker: {
      format: 'es',
      rolldownOptions: { output: { minify: { compress: { dropConsole: true, dropDebugger: true } } } },
    },
    test: {
      include: ['tests/unit/**/*.test.ts'],
      exclude: ['tests/e2e/**', 'tests/medicion/**', 'node_modules/**'],
      environment: 'node',
      testTimeout: 30_000,
      // Máquina compartida con el modelo y otros carriles (15 GB): pocos trabajadores evitan la saturación.
      maxWorkers: 4,
    },
  };
});
