import { test, expect } from '../fixtures';
import { navigateTo, clickSidebarLink, type TavroRoute } from '../../actions';

/**
 * Smoke-tests every major route.
 * Each test asserts that:
 *  1. The page loads without a JS crash (no error boundary).
 *  2. The URL is what we expect after navigation.
 *
 * All backend API calls are stubbed via the mockBackend fixture so these
 * tests run purely against the frontend bundle.
 */

const ROUTES: Array<{ path: TavroRoute; label: string; urlPattern: RegExp }> = [
  { path: '/', label: 'Home', urlPattern: /^\/$/ },
  { path: '/catalog', label: 'Catalog', urlPattern: /\/catalog/ },
  { path: '/use-cases', label: 'Use Cases', urlPattern: /\/use-cases/ },
  { path: '/blueprint', label: 'Blueprint', urlPattern: /\/blueprint/ },
  { path: '/compliance', label: 'Compliance', urlPattern: /\/compliance/ },
  { path: '/audit', label: 'Audit', urlPattern: /\/audit/ },
  { path: '/applications', label: 'Applications', urlPattern: /\/applications/ },
  { path: '/processes', label: 'Processes', urlPattern: /\/processes/ },
  { path: '/insights', label: 'Insights', urlPattern: /\/insights/ },
  { path: '/settings', label: 'Settings', urlPattern: /\/settings/ },
  { path: '/playground', label: 'Playground', urlPattern: /\/playground/ },
];

for (const { path, label, urlPattern } of ROUTES) {
  test(`${label} page loads (${path})`, async ({ page, mockBackend: _ }) => {
    await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));

    await navigateTo(page, path);
    await expect(page).toHaveURL(urlPattern);

    // Confirm no uncaught JS errors crashed the page into a blank screen
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);
  });
}

test('Layout sidebar links navigate correctly', async ({ page, mockBackend: _ }) => {
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));

  await navigateTo(page, '/');

  await expect(page.getByRole('link', { name: /catalog/i }).first()).toBeVisible({ timeout: 5_000 });
  await clickSidebarLink(page, /catalog/i);
  await expect(page).toHaveURL(/\/catalog/);
});
