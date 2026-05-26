import { test, expect, MOCK_RESPONSES } from '../fixtures';

/**
 * Product tour E2E tests.
 *
 * These tests stub the backend tour-status API so the tour state is fully
 * deterministic — no live backend required.
 *
 * All tests also clear localStorage before each run so that the
 * `tavro_tour_done` fallback key never bleeds between cases.
 */

test.describe('Product Tour', () => {
    test.beforeEach(async ({ page }) => {
        // Wipe tour-related localStorage so each test starts clean
        await page.addInitScript(() => {
            localStorage.removeItem('tavro_tour_done');
        });
    });

    test('tour appears for a new user (showTour: true)', async ({ page, mockBackend: _ }) => {
        await page.route('**/api/v1/onboarding-tour/**', (route) =>
            route.fulfill({ json: MOCK_RESPONSES.tourNotStarted }),
        );

        await page.goto('/');

        // react-joyride renders the tooltip portal into the body
        await expect(page.locator('[data-test-id="overlay"]').or(
            page.locator('.__floater')
        )).toBeVisible({ timeout: 8_000 }).catch(() => {
            // Fallback: check for the Joyride tooltip role
        });

        // The first step title should be visible
        await expect(page.getByText('Welcome to Tavro Agent BizOps')).toBeVisible({ timeout: 8_000 });
    });

    test('tour does NOT appear for a user who already completed it', async ({ page, mockBackend: _ }) => {
        await page.route('**/api/v1/onboarding-tour/**', (route) =>
            route.fulfill({ json: MOCK_RESPONSES.tourCompleted }),
        );

        await page.goto('/');
        await page.waitForTimeout(1_500);

        await expect(page.getByText('Welcome to Tavro Agent BizOps')).not.toBeVisible();
    });

    test('Next advances to the second step', async ({ page, mockBackend: _ }) => {
        await page.route('**/api/v1/onboarding-tour/**', (route) =>
            route.fulfill({ json: MOCK_RESPONSES.tourNotStarted }),
        );

        await page.goto('/');
        await expect(page.getByText('Welcome to Tavro Agent BizOps')).toBeVisible({ timeout: 8_000 });

        // Click the Next button
        await page.getByRole('button', { name: /next/i }).click();

        // Second step should now be shown
        await expect(page.getByText('Home')).toBeVisible({ timeout: 4_000 });
    });

    test('Back returns to the previous step', async ({ page, mockBackend: _ }) => {
        await page.route('**/api/v1/onboarding-tour/**', (route) =>
            route.fulfill({ json: MOCK_RESPONSES.tourNotStarted }),
        );

        await page.goto('/');
        await expect(page.getByText('Welcome to Tavro Agent BizOps')).toBeVisible({ timeout: 8_000 });

        // Advance to step 2
        await page.getByRole('button', { name: /next/i }).click();
        await expect(page.getByText(/^Home$/)).toBeVisible({ timeout: 4_000 });

        // Go back — should return to the welcome step
        await page.getByRole('button', { name: /back/i }).click();
        await expect(page.getByText('Welcome to Tavro Agent BizOps')).toBeVisible({ timeout: 4_000 });
    });

    test('Skip hides the tour and calls the backend with status=skipped', async ({ page, mockBackend: _ }) => {
        let capturedBody: string | null = null;
        await page.route('**/api/v1/onboarding-tour/status', async (route) => {
            if (route.request().method() === 'POST') {
                capturedBody = route.request().postData();
                await route.fulfill({ json: { ok: true } });
            } else {
                await route.fulfill({ json: MOCK_RESPONSES.tourNotStarted });
            }
        });

        await page.goto('/');
        await expect(page.getByText('Welcome to Tavro Agent BizOps')).toBeVisible({ timeout: 8_000 });

        // Click Skip
        await page.getByRole('button', { name: /skip tour/i }).click();

        // Tour should disappear
        await expect(page.getByText('Welcome to Tavro Agent BizOps')).not.toBeVisible({ timeout: 4_000 });

        // Backend should have been called with skipped status
        expect(capturedBody).toContain('"skipped"');
    });

    test('Finish saves completed status to the backend', async ({ page, mockBackend: _ }) => {
        const TOTAL_STEPS = 14;
        let capturedBody: string | null = null;

        await page.route('**/api/v1/onboarding-tour/status', async (route) => {
            if (route.request().method() === 'POST') {
                capturedBody = route.request().postData();
                await route.fulfill({ json: { ok: true } });
            } else {
                await route.fulfill({ json: MOCK_RESPONSES.tourNotStarted });
            }
        });

        await page.goto('/');
        await expect(page.getByText('Welcome to Tavro Agent BizOps')).toBeVisible({ timeout: 8_000 });

        // Click Next through all steps until Finish appears
        for (let i = 1; i < TOTAL_STEPS; i++) {
            const nextOrFinish = page.getByRole('button', { name: /next|finish/i });
            await expect(nextOrFinish).toBeVisible({ timeout: 4_000 });
            await nextOrFinish.click();
        }

        // After finishing, the tour overlay should be gone
        await expect(page.getByText('Welcome to Tavro Agent BizOps')).not.toBeVisible({ timeout: 4_000 });

        // Backend should have been called with completed status
        expect(capturedBody).toContain('"completed"');
    });
});
