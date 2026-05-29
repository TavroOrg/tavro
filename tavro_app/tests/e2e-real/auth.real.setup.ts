import { test as setup, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REAL_AUTH_FILE = path.join(__dirname, '../../playwright/.auth/real-user.json');

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;

setup('real Zitadel login', async ({ page }) => {
  if (!USERNAME || !PASSWORD) {
    throw new Error(
      'E2E_USERNAME and E2E_PASSWORD must be set.\n' +
      'Copy .env.e2e.example to .env.e2e and fill in your credentials, ' +
      'or export them as environment variables before running the tests.',
    );
  }

  // Navigate to the app — it will redirect to /login which then redirects to Zitadel.
  await page.goto('/');

  // Wait to land on /login (PrivateRoute redirects unauthenticated users).
  await page.waitForURL(/\/login/, { timeout: 15_000 });

  // The Login page redirects to Zitadel's hosted login UI at localhost:8080/ui/v2/login/...
  // We detect arrival by waiting for the Zitadel login path (port 8080).
  await page.waitForURL(/\/ui\/v2\/login/, { timeout: 20_000 });

  // ── Fill in the Zitadel login form ──────────────────────────────────────────
  //
  // This Zitadel v2 login shows username + password on a single page.
  // Fill both fields first, then click Continue once.

  const loginInput = page.locator('input[name="loginName"]').first();
  await loginInput.waitFor({ state: 'visible', timeout: 15_000 });
  await loginInput.fill(USERNAME);

  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.waitFor({ state: 'visible', timeout: 10_000 });
  await passwordInput.fill(PASSWORD);

  // Submit — wait for the button to become enabled (it requires both fields filled).
  const submitBtn = page.locator('button[data-testid="submit-button"]');
  await submitBtn.waitFor({ state: 'visible', timeout: 5_000 });
  await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
  await submitBtn.click();

  // ── Wait for the full OAuth flow to complete ─────────────────────────────────
  // Flow: Zitadel (8080) → /auth/callback (9000) → / (9000)
  // Using a single waitForURL avoids a race where the callback→home navigation
  // completes before the second waitForURL is even registered.
  await page.waitForURL(
    (url) => url.port === '9000' && url.pathname === '/',
    { timeout: 30_000 },
  );

  // Verify we're authenticated — home page should render without redirecting back to /login.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 5_000 });

  // Confirm real tokens were stored (not the fake "playwright-fake-sig" ones).
  const token = await page.evaluate(() => localStorage.getItem('tavro_access_token'));
  if (!token || token.endsWith('playwright-fake-sig')) {
    throw new Error(
      'Login appeared to succeed but no real access token was found in localStorage. ' +
      'Check that your Zitadel credentials are correct and the callback exchange completed.',
    );
  }

  // Save the entire browser storage state (cookies + localStorage) so all test
  // files can start already authenticated without repeating the login flow.
  await page.context().storageState({ path: REAL_AUTH_FILE });
});
