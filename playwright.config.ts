import { defineConfig, devices } from '@playwright/test';

// Puerto por worktree: verify.mjs lo fija según su ranura del candado (máximo 2 a la vez).
// Sin PORT (corrida manual) se elige un puerto fuera de las ranuras de verify (4173 y 4183) una sola vez, en el
// proceso principal, y se deja en el entorno para que los trabajadores de Playwright (que heredan el entorno y
// vuelven a cargar esta configuración) usen el mismo.
if (!process.env.PORT) process.env.PORT = String(4300 + (process.pid % 600));
const PORT = Number(process.env.PORT);

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, serviceWorkers: 'allow' },
  webServer: {
    command: `node tests/e2e/server.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    stdout: 'ignore',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
