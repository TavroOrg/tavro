import { test, expect } from '../fixtures';

test.describe('Home page', () => {
  test.beforeEach(async ({ page, mockBackend: _ }) => {
    await page.goto('/');
  });

  test('renders the Tavro Agent BizOps welcome heading', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /Tavro Agent BizOps/i }),
    ).toBeVisible();
  });

  test('shows the three quick-nav cards', async ({ page }) => {
    await expect(page.getByText('AI Use Cases')).toBeVisible();
    await expect(page.getByText('Agent Catalog')).toBeVisible();
    // Insights card text may vary — assert at least two cards are rendered
    const cards = page.locator('button').filter({ hasText: /Use Cases|Catalog|Insights/i });
    await expect(cards).toHaveCount(3);
  });

  test('clicking AI Use Cases navigates to /use-cases', async ({ page }) => {
    await page.getByText('AI Use Cases').click();
    await expect(page).toHaveURL(/\/use-cases/);
  });
});
