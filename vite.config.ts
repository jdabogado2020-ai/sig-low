/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Contrato de construcción (9.1, paso 4 de verify): sin inlining, sin sourcemaps, sin console.
export default defineConfig(({ mode }) => {
  const medicion = mode === 'medicion';
  return {
    cacheDir: '.vite-cache',
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
    },
  };
});
