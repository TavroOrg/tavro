import { test, expect } from '../fixtures';
import { navigateToCatalog, searchAgents } from '../../actions';

test.describe('Catalog page (/catalog)', () => {
  test.beforeEach(async ({ page, mockBackend: _ }) => {
    await navigateToCatalog(page);
  });

  test('renders without crashing when agent list is empty', async ({ page }) => {
    // Dashboard mounts and shows the catalog shell (search bar / add button)
    await expect(page.getByRole('button', { name: /new agent|add agent|\+/i }).first()).toBeVisible({
      timeout: 8_000,
    });
  });

  test('search input is present and accepts input', async ({ page }) => {
    const input = page.getByRole('textbox').first();
    await expect(input).toBeVisible();
    await searchAgents(page, 'Risk');
    await expect(input).toHaveValue('Risk');
  });

  test('shows agent cards when the API returns agents', async ({ page }) => {
    // Override the route set by mockBackend with a populated response
    await page.route('**/api/v1/agents**', (route) =>
      route.fulfill({
        json: {
          agents: [
            {
              name: 'Risk Classifier',
              identification: { agent_id: 'agent-001' },
              description: 'Classifies business risks using LLM.',
            },
            {
              name: 'Compliance Checker',
              identification: { agent_id: 'agent-002' },
              description: 'Validates policies against regulation frameworks.',
            },
          ],
        },
      }),
    );

    await navigateToCatalog(page);
    await expect(page.getByText('Risk Classifier')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Compliance Checker')).toBeVisible();
  });

  test('shows error state when agents API fails', async ({ page }) => {
    await page.route('**/api/v1/agents**', (route) =>
      route.fulfill({ status: 500, body: 'Internal Server Error' }),
    );

    await navigateToCatalog(page);
    // The Dashboard renders an error message/icon — assert something error-related
    // Adjust the selector if the component uses a different text
    await expect(page.locator('[class*="error"], [class*="alert"], svg[class*="text-red"]').first()).toBeVisible({
      timeout: 8_000,
    });
  });
});
