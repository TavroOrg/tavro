import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import { TENANTS_FILE, authFilePath, type ProvisionedTenants } from './global-setup';

/**
 * Real ZITADEL hosted-UI login (same flow a human uses) for each provisioned
 * UAT tenant user. Saves the full browser storage state (cookies +
 * localStorage, including the real access/id tokens tavro_app stores) so
 * api-*.spec.ts can load it into a fresh browser context later.
 */
async function loginAsTenant(page: Page, tenantKey: keyof ProvisionedTenants): Promise<void> {
  if (!fs.existsSync(TENANTS_FILE)) {
    throw new Error(`${TENANTS_FILE} not found — the ZITADEL tenant provisioning step (globalSetup) must run first.`);
  }
  const tenants = JSON.parse(fs.readFileSync(TENANTS_FILE, 'utf8')) as ProvisionedTenants;
  const { username, password, orgName } = tenants[tenantKey];

  await page.goto('/');
  await page.waitForURL(/\/login/, { timeout: 15_000 });
  await page.waitForURL(/\/ui\/v2\/login/, { timeout: 20_000 });

  const loginInput = page.locator('input[name="loginName"]').first();
  await loginInput.waitFor({ state: 'visible', timeout: 15_000 });
  await loginInput.fill(username);

  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.waitFor({ state: 'visible', timeout: 10_000 });
  await passwordInput.fill(password);

  const submitBtn = page.locator('button[data-testid="submit-button"]');
  await submitBtn.waitFor({ state: 'visible', timeout: 5_000 });
  await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
  await submitBtn.click();

  const appHostname = new URL(process.env.E2E_BASE_URL || 'http://localhost:9000').hostname;
  await page.waitForURL(
    (url) => url.hostname === appHostname && url.pathname === '/',
    { timeout: 30_000 },
  );
  await expect(page).not.toHaveURL(/\/login/, { timeout: 5_000 });

  const token = await page.evaluate(() => localStorage.getItem('tavro_access_token'));
  const tenantId = await page.evaluate(() => localStorage.getItem('tavro_tenant_id'));
  if (!token) {
    throw new Error(`Login as ${username} (org "${orgName}") appeared to succeed but no access token was stored.`);
  }
  if (!tenantId) {
    throw new Error(`Login as ${username} succeeded but tavro_tenant_id was never populated — check auth.ts's org-claim extraction.`);
  }

  await page.context().storageState({ path: authFilePath(tenantKey) });
  console.log(`[auth:${tenantKey}] Logged in as ${username} — tenant id ${tenantId} -> ${authFilePath(tenantKey)}`);
}

test('ZITADEL login — Tenant A', async ({ page }) => {
  await loginAsTenant(page, 'tenantA');
});

test('ZITADEL login — Tenant B', async ({ page }) => {
  await loginAsTenant(page, 'tenantB');
});
