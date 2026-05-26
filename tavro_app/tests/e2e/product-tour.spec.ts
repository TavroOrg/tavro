import { test, expect, MOCK_RESPONSES } from '../fixtures';

/**
 * Product tour E2E tests.
 *
 * All tests stub the backend tour-status API so the tour state is fully
 * deterministic — no live backend required.
 *
 * localStorage is cleared before each run so the `tavro_tour_done` fallback
 * key never bleeds between cases.
 */

test.describe('Product Tour', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.removeItem('tavro_tour_done');
        });
    });

    test('tour appears for a new user', async ({ page, mockBackend: _ }) => {
        await page.route('**/api/v1/onboarding-tour/**', (route) =>
            route.fulfill({ json: MOCK_RESPONSES.tourNotStarted }),
        );

        await page.goto('/');

        await expect(page.getByText('Welcome to Tavro Agent BizOps')).toBeVisible({ timeout: 8_000 });
    });

    test('tour does not appear for a user who already completed it', async ({ page, mockBackend: _ }) => {
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

        await page.getByRole('button', { name: /next/i }).click();

        await expect(page.getByText(/^Home$/)).toBeVisible({ timeout: 4_000 });
    });

    test('Back returns to the previous step', async ({ page, mockBackend: _ }) => {
        await page.route('**/api/v1/onboarding-tour/**', (route) =>
            route.fulfill({ json: MOCK_RESPONSES.tourNotStarted }),
        );

        await page.goto('/');
        await expect(page.getByText('Welcome to Tavro Agent BizOps')).toBeVisible({ timeout: 8_000 });

        await page.getByRole('button', { name: /next/i }).click();
        await expect(page.getByText(/^Home$/)).toBeVisible({ timeout: 4_000 });

        await page.getByRole('button', { name: /back/i }).click();
        await expect(page.getByText('Welcome to Tavro Agent BizOps')).toBeVisible({ timeout: 4_000 });
    });

    test('Skip hides the tour and saves status=skipped to backend', async ({ page, mockBackend: _ }) => {
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

        await page.getByRole('button', { name: /skip tour/i }).click();

        await expect(page.getByText('Welcome to Tavro Agent BizOps')).not.toBeVisible({ timeout: 4_000 });
        expect(capturedBody).toContain('"skipped"');
    });

    test('Finish saves status=completed to backend', async ({ page, mockBackend: _ }) => {
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

        for (let i = 1; i < TOTAL_STEPS; i++) {
            const btn = page.getByRole('button', { name: /next|finish/i });
            await expect(btn).toBeVisible({ timeout: 4_000 });
            await btn.click();
        }

        await expect(page.getByText('Welcome to Tavro Agent BizOps')).not.toBeVisible({ timeout: 4_000 });
        expect(capturedBody).toContain('"completed"');
    });
});
