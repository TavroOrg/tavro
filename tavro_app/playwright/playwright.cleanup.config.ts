import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Deliberately its own config file, entirely separate from
 * playwright.e2e.config.ts — not just its own project within that config.
 *
 * A "manual cleanup" project living inside playwright.e2e.config.ts still
 * gets discovered and can be run by anything that loads that config file
 * directly (the VS Code Playwright extension's "Run all tests" in
 * particular, which enumerates every project in the config and doesn't
 * respect the `--project` filtering baked into the npm scripts in
 * package.json). That caused test-data.teardown.ts to run — deleting
 * fixture data — in the middle of, or racing against, a real test run.
 * (Fixture data now lives in an in-memory worker fixture inside
 * portal-ui-ux.spec.ts rather than a JSON file, but the race that motivated
 * splitting this into its own config was real and is worth keeping fixed.)
 *
 * Putting cleanup in a config file the main config never references means
 * nothing that points at playwright.e2e.config.ts (the VS Code extension,
 * `npm run test:e2e`, `npm run test:e2e:ui`, etc.) can ever discover or run
 * it by accident. It only runs when explicitly invoked via
 * `npm run test:e2e:cleanup`, which points at this file.
 */
const envFile = path.resolve(__dirname, '.env.e2e');
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
  testDir: './tests',
  testMatch: /test-data\.teardown\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,

  outputDir: 'test-results-e2e-cleanup',
  reporter: [['list']],

  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
    ...devices['Desktop Chrome'],
  },
});
