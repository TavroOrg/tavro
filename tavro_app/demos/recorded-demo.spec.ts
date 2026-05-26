import { test } from '@playwright/test';

/**
 * Live-backend demo — authenticates against the real Zitadel sandbox and
 * walks through a real Tavro session with actual data.
 *
 * Required env vars:
 *   DEMO_USERNAME   — Zitadel username (e.g. sanjeev)
 *   DEMO_PASSWORD   — Zitadel password
 *   DEMO_BASE_URL   — optional; defaults to http://localhost:9000
 *
 * Run with:
 *   DEMO_USERNAME=you DEMO_PASSWORD=secret \
 *     npx playwright test demos/recorded-demo.spec.ts \
 *     --config playwright.demo.config.ts --project=demo-chrome-live
 *
 * Tip: pre-save auth state via demos/auth.setup.ts instead of logging in
 * every run — it's faster and avoids the Zitadel redirect overhead.
 */
test('Live — IT Service Desk Automation walkthrough', async ({ page }) => {
  const username = process.env.DEMO_USERNAME;
  const password = process.env.DEMO_PASSWORD;

  if (!username || !password) {
    throw new Error(
      'Set DEMO_USERNAME and DEMO_PASSWORD before running the live demo.\n' +
        'Example: DEMO_USERNAME=you DEMO_PASSWORD=secret npm run demo:live',
    );
  }

  // Navigate to login and wait for the Zitadel redirect
  await page.goto('/login');
  await page.waitForURL(/auth-sandbox\.tavro\.ai|zitadel/i, { timeout: 20_000 });

  await page.getByTestId('username-text-input').fill(username);
  await page.getByTestId('username-text-input').press('Tab');
  await page.getByTestId('password-text-input').fill(password);
  await page.getByTestId('submit-button').click();

  // Wait to land back on the Tavro home page
  await page.waitForURL(/localhost|tavro\.ai/, { timeout: 25_000 });
  await page.waitForTimeout(2_000);

  // Navigate to AI Use Cases
  await page.getByRole('button', { name: 'AI Use Cases', exact: true }).click();
  await page.waitForTimeout(2_000);

  // Open IT Service Desk Automation
  await page.getByRole('heading', { name: /IT Service Desk Automation/i }).first().click();
  await page.waitForTimeout(2_000);

  // Switch to the AI Agents tab
  const agentsTab = page.getByRole('button', { name: /ai agents/i });
  if (await agentsTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await agentsTab.click();
    await page.waitForTimeout(2_000);
  }

  // Click through to the linked agent (MIA)
  const miaLink = page.getByRole('link', { name: /MIA|Managed Incident/i }).first();
  if (await miaLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await miaLink.click();
    await page.waitForTimeout(2_500);
  }
});
