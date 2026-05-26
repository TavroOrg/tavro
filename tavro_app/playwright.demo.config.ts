import { defineConfig, devices } from '@playwright/test';

/**
 * Demo config — produces marketing videos from the demos/ directory.
 *
 * Key differences from playwright.config.ts (the CI test config):
 *  - slowMo: 800ms    — actions are visibly paced for viewers
 *  - video: 'on'      — every demo produces a .webm in test-results/
 *  - workers: 1       — serial execution for consistent timing
 *  - headless: false  — run headed locally; CI forces headless via env var
 *
 * Projects:
 *  demo-chrome       — 1280×720 standard quality (fake JWT, all backends stubbed)
 *  demo-chrome-hd    — 1920×1080 marketing quality (same fake JWT approach)
 *  demo-chrome-live  — 1920×1080, real Zitadel auth (requires saved storageState)
 *  demo-auth-setup   — runs demos/auth.setup.ts to capture real auth state once
 *
 * Run locally:         npm run demo
 * Run HD demos:        npm run demo:hd
 * Run in CI:           npm run demo:ci
 * One-time live auth:  npm run demo:auth   (then npm run demo:live)
 */
export default defineConfig({
  testDir: './demos',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 300_000, // 5 min per demo — needed with slowMo 800ms + multi-step flows
  reporter: [
    ['html', { outputFolder: 'playwright-report/demos', open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL: process.env.DEMO_BASE_URL ?? 'http://localhost:9000',
    headless: !!process.env.CI,
    launchOptions: {
      slowMo: Number(process.env.DEMO_SLOW_MO ?? 800),
    },
    video: 'on',
    trace: 'off',
    screenshot: 'off',
    serviceWorkers: 'allow',
    // Without an explicit actionTimeout, Playwright inherits the test timeout (300 s),
    // meaning a missing element blocks for 5 minutes. Set a tight action timeout so
    // individual missing-element failures surface quickly while demos still have
    // plenty of time to complete all their steps.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    // ── Standard quality (1280×720) — used for CI video recording ─────────────
    {
      name: 'demo-chrome',
      testMatch: /\d{2}-.*\.demo\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },

    // ── HD quality (1920×1080) — for marketing images and premium clips ───────
    {
      name: 'demo-chrome-hd',
      testMatch: /\d{2}-.*\.demo\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
      },
    },

    // ── Live-backend demo — requires saved auth state ──────────────────────────
    // Run `npm run demo:auth` once to populate playwright/.auth/demo-user.json.
    {
      name: 'demo-chrome-live',
      testMatch: /recorded-demo\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        storageState: 'playwright/.auth/demo-user.json',
      },
    },

    // ── One-time auth capture — run before demo:live ───────────────────────────
    {
      name: 'demo-auth-setup',
      testMatch: /demos\/auth\.setup\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        // baseURL must point at the real backend when capturing live auth
        baseURL: process.env.DEMO_BASE_URL ?? 'http://localhost:9000',
      },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:9000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
