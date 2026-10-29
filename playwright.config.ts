import { defineConfig, devices } from '@playwright/test';

// Puerto por worktree: verify.mjs lo fija según su ranura del candado (máximo 2 a la vez).
const PORT = Number(process.env.PORT ?? 4173);

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
