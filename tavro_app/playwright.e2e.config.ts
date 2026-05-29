import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Load .env.e2e if it exists so devs can keep credentials in a local file
// without exporting env vars manually each time.
const envFile = path.resolve('.env.e2e');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:9000';

export default defineConfig({
  testDir: './tests/e2e-real',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,

  // globalTeardown runs after all tests finish — converts JSON report to CSV.
  globalTeardown: './tests/e2e-real/teardown.ts',

  outputDir: 'test-results-e2e',

  reporter: [
    ['html', { open: 'never', outputFolder: 'test-results-e2e/html-report' }],
    ['json', { outputFile: 'test-results-e2e/results.json' }],
    ['list'],
  ],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'real-setup',
      testMatch: /auth\.real\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/real-user.json',
      },
      dependencies: ['real-setup'],
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        storageState: 'playwright/.auth/real-user.json',
      },
      dependencies: ['real-setup'],
    },
  ],
});
