import { test } from '@playwright/test';
import { loginToTavro, navigateToUseCases, clickNewUseCase } from '../actions';

/**
 * Demo: Use cases — entry point for creating a new AI use case
 *
 * Choreography:
 *   1. Login and land on home page
 *   2. Navigate to the Use Cases list
 *   3. Open the "New Use Case" form to show the creation flow
 *
 * Produces: test-results/demo-chrome/02-create-use-case/video.webm
 */
test('02 — Create a Use Case', async ({ page }) => {
  await page.route('**/runtime/tavro-runtime-config.json', (route) =>
    route.fulfill({
      json: {
        zitadelIssuer: 'https://test.zitadel.tavro.ai',
        zitadelClientId: 'demo-client',
        zitadelRedirectPath: '/auth/callback',
        zitadelScope: 'openid profile email',
      },
    }),
  );

  await loginToTavro(page);
  await page.waitForTimeout(1_500);

  await navigateToUseCases(page);
  await page.waitForTimeout(2_000);

  await clickNewUseCase(page);
  await page.waitForTimeout(2_500); // let the form/wizard animate in
});
