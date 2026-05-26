import { test as base, expect } from '@playwright/test';

/**
 * Minimal mock responses for the Tavro backend.
 * Used to isolate frontend behaviour from real API availability.
 */
export const MOCK_RESPONSES = {
  agents: { agents: [] },
  useCases: { use_cases: [] },
  blueprint: { nodes: [], edges: [] },
  compliance: { items: [] },
  audit: { runs: [] },
  applications: { applications: [] },
  processes: { processes: [] },
  tourNotStarted: { showTour: true, status: 'not_started' },
  tourCompleted: { showTour: false, status: 'completed' },
  tourSkipped: { showTour: false, status: 'skipped' },
};

type Fixtures = {
  mockBackend: void;
};

/**
 * Extended test fixture that intercepts all /api/v1 calls and returns
 * empty-but-valid stub data. Use this when testing UI structure/navigation
 * independent of a live backend.
 *
 * Usage:
 *   import { test } from '../fixtures';
 *   test('my test', async ({ page }) => { ... });
 */
export const test = base.extend<Fixtures>({
  mockBackend: [
    async ({ page }, use) => {
      await page.route('**/api/v1/agents**', (route) =>
        route.fulfill({ json: MOCK_RESPONSES.agents }),
      );
      await page.route('**/api/v1/use-cases**', (route) =>
        route.fulfill({ json: MOCK_RESPONSES.useCases }),
      );
      await page.route('**/api/v1/blueprint**', (route) =>
        route.fulfill({ json: MOCK_RESPONSES.blueprint }),
      );
      await page.route('**/api/v1/compliance**', (route) =>
        route.fulfill({ json: MOCK_RESPONSES.compliance }),
      );
      await page.route('**/api/v1/audit**', (route) =>
        route.fulfill({ json: MOCK_RESPONSES.audit }),
      );
      await page.route('**/api/v1/business-relations**', (route) =>
        route.fulfill({ json: MOCK_RESPONSES.applications }),
      );
      // Prevent real runtime-config fetches during tests
      await page.route('**/runtime/tavro-runtime-config.json', (route) =>
        route.fulfill({
          json: {
            zitadelIssuer: 'https://test.zitadel.tavro.ai',
            zitadelClientId: 'playwright-test-client',
          },
        }),
      );
      // Default: tour already completed so it doesn't appear in unrelated tests
      await page.route('**/api/v1/onboarding-tour/**', (route) =>
        route.fulfill({ json: MOCK_RESPONSES.tourCompleted }),
      );

      await use();
    },
    { auto: false },
  ],
});

export { expect };
