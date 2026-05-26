import { test, expect } from '@playwright/test';

// These tests verify the public /login route — run WITHOUT stored auth state
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Login page', () => {
  test('shows redirect spinner on load', async ({ page }) => {
    // Stub runtime config so the page doesn't spin for 20 retries in CI
    await page.route('**/runtime/tavro-runtime-config.json', (route) =>
      route.fulfill({
        json: {
          zitadelIssuer: 'https://test.zitadel.tavro.ai',
          zitadelClientId: 'playwright-test-client',
          zitadelRedirectPath: '/auth/callback',
          zitadelScope: 'openid profile email',
        },
      }),
    );

    await page.goto('/login');
    await expect(page.getByText('Redirecting to ZITADEL...')).toBeVisible({ timeout: 5_000 });
  });

  test('shows config-error state when Zitadel is not configured', async ({ page }) => {
    await page.route('**/runtime/tavro-runtime-config.json', (route) =>
      route.fulfill({
        json: { zitadelIssuer: '', zitadelClientId: '' },
      }),
    );

    await page.goto('/login');
    await expect(page.getByText('Login configuration required')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/VITE_ZITADEL_ISSUER/)).toBeVisible();
  });

  test('unauthenticated visitor is redirected to /login from a protected route', async ({ page }) => {
    await page.goto('/catalog');
    await expect(page).toHaveURL(/\/login/);
  });

  test('unauthenticated visitor is redirected to /login from home', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });
});
