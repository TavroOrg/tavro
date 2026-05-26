import { test } from '@playwright/test';
import { loginToTavro, stubRuntimeConfig, navigateToBlueprint, setupBlueprint } from '../actions';

/**
 * Demo: AI Blueprint — organizational context setup wizard
 *
 * Choreography:
 *   1. Login and navigate straight to Blueprint
 *   2. Show the Blueprint visualization page (org map)
 *   3. Open the Setup wizard
 *   4. Fill in company identity (name, industry, ticker)
 *   5. Click "Continue" into the AI research step
 *   6. Pause to show the wizard progressing
 *
 * Produces: test-results/demo-chrome/04-blueprint-setup/video.webm
 *           demo-screenshots/04-blueprint-map.png
 *           demo-screenshots/04-blueprint-wizard.png
 */
test('04 — Blueprint Setup', async ({ page }) => {
  const BLUEPRINT_GRAPH = {
    nodes: [
      { id: 'dim-finance', label: 'Finance', category: 'function', x: 100, y: 200 },
      { id: 'dim-it', label: 'IT Operations', category: 'function', x: 300, y: 200 },
      { id: 'dim-procurement', label: 'Procurement', category: 'function', x: 500, y: 200 },
      { id: 'dim-risk', label: 'Risk & Compliance', category: 'function', x: 700, y: 200 },
    ],
    edges: [
      { id: 'e1', source: 'dim-finance', target: 'dim-risk' },
      { id: 'e2', source: 'dim-it', target: 'dim-risk' },
      { id: 'e3', source: 'dim-procurement', target: 'dim-risk' },
    ],
  };
  const STUB_COMPANIES = {
    items: [{ id: 'demo-company-001', name: 'Tavro Financial Services', industry: 'Financial Services', is_public: false }],
    total: 1, offset: 0, limit: 50,
  };

  // LIFO — catch-all first, specific stubs last
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/v1/graph/**', (route) => route.fulfill({ json: BLUEPRINT_GRAPH }));
  await page.route('**/api/v1/dim-nodes**', (route) => route.fulfill({ json: { items: [], total: 0 } }));
  await page.route('**/api/v1/dim-types**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/companies**', (route) => route.fulfill({ json: STUB_COMPANIES }));
  await stubRuntimeConfig(page);

  await loginToTavro(page);
  await page.waitForTimeout(1_500);

  await page.setViewportSize({ width: 1920, height: 1080 });

  // Show the existing blueprint visualization
  await navigateToBlueprint(page);
  await page.waitForTimeout(2_500); // let the graph render

  await page.screenshot({ path: 'demo-screenshots/04-blueprint-map.png' });
  await page.waitForTimeout(1_500);

  // Open the setup wizard
  await setupBlueprint(page, {
    companyName: 'Tavro Financial Services',
    industry: 'Financial Services',
    isPublic: true,
    ticker: 'TAVRO',
  });
  await page.waitForTimeout(2_000); // show Step 2 — AI research in progress

  await page.screenshot({ path: 'demo-screenshots/04-blueprint-wizard.png' });
  await page.waitForTimeout(2_000);
});
