import { test as setup, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEMO_AUTH_FILE = path.join(__dirname, '../playwright/.auth/demo-user.json');

/**
 * One-time auth setup for live demos against the real Tavro + Zitadel backend.
 *
 * Required env vars:
 *   DEMO_USERNAME   — Zitadel username (e.g. sanjeev)
 *   DEMO_PASSWORD   — Zitadel password
 *
 * Run this once before recording live demos:
 *   DEMO_USERNAME=you DEMO_PASSWORD=secret \
 *     npx playwright test demos/auth.setup.ts \
 *     --config playwright.demo.config.ts --project=demo-auth-setup
 *
 * The saved state at playwright/.auth/demo-user.json is then referenced by
 * the demo-chrome-live project so every live demo skips the login flow.
 */
setup('authenticate for live demos', async ({ page }) => {
  const username = process.env.DEMO_USERNAME;
  const password = process.env.DEMO_PASSWORD;

  if (!username || !password) {
    throw new Error(
      'Set DEMO_USERNAME and DEMO_PASSWORD env vars before running live demos.\n' +
        'Example: DEMO_USERNAME=you DEMO_PASSWORD=secret npm run demo:live',
    );
  }

  // The login page immediately redirects to Zitadel — navigate and wait.
  await page.goto('/login');
  await page.waitForURL(/auth-sandbox\.tavro\.ai|zitadel/i, { timeout: 20_000 });

  await page.getByTestId('username-text-input').fill(username);
  await page.getByTestId('username-text-input').press('Tab');
  await page.getByTestId('password-text-input').fill(password);
  await page.getByTestId('submit-button').click();

  // Wait until we land back on Tavro (not on the Zitadel domain or /login).
  await expect(page).not.toHaveURL(/auth-sandbox\.tavro\.ai|zitadel/i, { timeout: 25_000 });
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });

  await page.context().storageState({ path: DEMO_AUTH_FILE });
});
