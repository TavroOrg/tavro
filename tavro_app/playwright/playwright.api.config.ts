import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env.api if it exists so devs can keep config in a local file
// without exporting env vars manually each time.
const envFile = path.resolve(__dirname, '.env.api');
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

const API_BASE_URL = process.env.E2E_API_URL || 'http://localhost:8000';
const APP_BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:9000';

export default defineConfig({
  testDir: './tests',
  // Real ZITADEL orgs/users used as the two UAT tenants are provisioned
  // once here, before any browser-based login or API test runs.
  globalSetup: './tests/setup/global-setup.ts',
  // Deletes every "UAT "-prefixed company/application/process/integration
  // this suite created, so repeated local runs don't pile up hundreds of
  // rows under the same two real tenants (which breaks pagination-fragile
  // assertions over time).
  globalTeardown: './tests/setup/global-teardown.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,

  outputDir: 'test-results-api/artifacts',

  reporter: [
    ['html', { open: 'never', outputFolder: 'test-results-api/html-report' }],
    ['json', { outputFile: 'test-results-api/results.json' }],
    ['list'],
    ['./tests/csv-reporter.ts'],
  ],

  use: {
    ignoreHTTPSErrors: true,
  },

  projects: [
    // Real ZITADEL hosted-UI login for both provisioned tenant users (two
    // tests in one file — see tests/setup/auth.setup.ts). Needs a real
    // browser since it drives the actual login form.
    {
      name: 'auth',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: APP_BASE_URL },
    },
    // The actual API-driven UAT tests. Uses a real Chromium browser purely
    // as a vehicle to load each tenant's saved storageState (cookies +
    // localStorage with real tokens) into its own context — HTTP calls to
    // tavro_api go through page.request with an explicit baseURL, not
    // through page navigation.
    {
      name: 'api',
      testMatch: /api-.*\.spec\.ts/,
      dependencies: ['auth'],
      use: { ...devices['Desktop Chrome'], baseURL: API_BASE_URL },
    },
  ],
});
