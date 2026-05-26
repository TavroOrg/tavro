import { test, expect } from '@playwright/test';
import {
    setupTourMocks,
    advanceTour,
    waitForTourStep,
    TOUR_STEP_TITLES,
    TOTAL_TOUR_STEPS,
} from '../../actions/tour';

/**
 * Product tour E2E tests.
 *
 * All tests stub every backend endpoint so the tour runs fully offline.
 * Tour localStorage/sessionStorage state is cleared before each test so
 * nothing bleeds between runs.
 */

test.describe('Product Tour — visibility', () => {
    test('tour appears for a new user', async ({ page }) => {
        await setupTourMocks(page);
        await page.goto('/');
        await expect(page.getByText(TOUR_STEP_TITLES[0])).toBeVisible({ timeout: 8_000 });
    });

    test('tour does not appear for a user who already completed it', async ({ page }) => {
        await setupTourMocks(page);
        // Override: mark tour as done before navigating
        await page.route('**/api/v1/onboarding-tour/**', (route) =>
            route.fulfill({ json: { showTour: false, status: 'completed' } }),
        );
        await page.addInitScript(() => {
            localStorage.setItem('tavro_tour_done', 'completed');
        });

        await page.goto('/');
        await page.waitForTimeout(2_000);

        await expect(page.getByText(TOUR_STEP_TITLES[0])).not.toBeVisible();
    });
});

test.describe('Product Tour — step 1 controls', () => {
    test('first step shows a Start button and no Back button', async ({ page }) => {
        await setupTourMocks(page);
        await page.goto('/');

        await waitForTourStep(page, TOUR_STEP_TITLES[0]);

        await expect(page.getByRole('button', { name: /^Start$/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /^Back$/i })).not.toBeVisible();
    });

    test('progress counter shows 1 of total on step 1', async ({ page }) => {
        await setupTourMocks(page);
        await page.goto('/');

        await waitForTourStep(page, TOUR_STEP_TITLES[0]);

        await expect(page.getByText(`1 of ${TOTAL_TOUR_STEPS}`)).toBeVisible();
    });
});

test.describe('Product Tour — navigation', () => {
    test('Start advances from step 1 to step 2', async ({ page }) => {
        await setupTourMocks(page);
        await page.goto('/');

        await waitForTourStep(page, TOUR_STEP_TITLES[0]);
        await page.getByRole('button', { name: /^Start$/i }).click();

        await waitForTourStep(page, TOUR_STEP_TITLES[1]);
        await expect(page.getByText(`2 of ${TOTAL_TOUR_STEPS}`)).toBeVisible();
    });

    test('Back returns from step 2 to step 1', async ({ page }) => {
        await setupTourMocks(page);
        await page.goto('/');

        await waitForTourStep(page, TOUR_STEP_TITLES[0]);
        await page.getByRole('button', { name: /^Start$/i }).click();

        await waitForTourStep(page, TOUR_STEP_TITLES[1]);
        await page.getByRole('button', { name: /^Back$/i }).click();

        await waitForTourStep(page, TOUR_STEP_TITLES[0]);
        await expect(page.getByText(`1 of ${TOTAL_TOUR_STEPS}`)).toBeVisible();
    });
});

test.describe('Product Tour — skip & finish', () => {
    test('Skip hides the tour and saves status=skipped', async ({ page }) => {
        let capturedBody: string | null = null;

        await setupTourMocks(page);
        await page.route('**/api/v1/onboarding-tour/status', async (route) => {
            if (route.request().method() === 'POST') {
                capturedBody = route.request().postData();
                return route.fulfill({ json: { ok: true } });
            }
            return route.fulfill({ json: { showTour: true, status: 'not_started' } });
        });

        await page.goto('/');
        await waitForTourStep(page, TOUR_STEP_TITLES[0]);

        await page.getByRole('button', { name: /skip tour/i }).click();

        await expect(page.getByText(TOUR_STEP_TITLES[0])).not.toBeVisible({ timeout: 4_000 });
        expect(capturedBody).toContain('"skipped"');
    });

    test('clicking through all steps shows Book a Demo on the last step', async ({ page }) => {
        await setupTourMocks(page);
        await page.goto('/');

        await waitForTourStep(page, TOUR_STEP_TITLES[0]);

        // Walk steps 1 → 9 (each step may navigate pages — allow generous timeout)
        for (let i = 0; i < TOTAL_TOUR_STEPS - 1; i++) {
            const btn = page.getByRole('button', { name: /^(Start|Next)$/i });
            await expect(btn).toBeVisible({ timeout: 6_000 });
            await btn.click();
        }

        await waitForTourStep(page, TOUR_STEP_TITLES[TOTAL_TOUR_STEPS - 1], 10_000);
        await expect(page.getByRole('button', { name: /book a demo/i })).toBeVisible();
    });

    test('Book a Demo saves status=completed', async ({ page }) => {
        let capturedBody: string | null = null;

        await setupTourMocks(page);
        await page.route('**/api/v1/onboarding-tour/status', async (route) => {
            if (route.request().method() === 'POST') {
                capturedBody = route.request().postData();
                return route.fulfill({ json: { ok: true } });
            }
            return route.fulfill({ json: { showTour: true, status: 'not_started' } });
        });

        // Intercept the external redirect so the page doesn't navigate away
        await page.route('https://www.tavro.ai/**', (route) => route.abort());

        await page.goto('/');
        await waitForTourStep(page, TOUR_STEP_TITLES[0]);

        for (let i = 0; i < TOTAL_TOUR_STEPS - 1; i++) {
            const btn = page.getByRole('button', { name: /^(Start|Next)$/i });
            await expect(btn).toBeVisible({ timeout: 6_000 });
            await btn.click();
        }

        await waitForTourStep(page, TOUR_STEP_TITLES[TOTAL_TOUR_STEPS - 1], 10_000);
        await page.getByRole('button', { name: /book a demo/i }).click();

        // Give the app a moment to POST before asserting
        await page.waitForTimeout(500);
        expect(capturedBody).toContain('"completed"');
    });
});

test.describe('Product Tour — full walkthrough', () => {
    /**
     * Walks every step in sequence and asserts each title becomes visible,
     * verifying that tour navigation (including cross-page transitions)
     * works end-to-end.
     */
    test('visits all steps in order', async ({ page }) => {
        await setupTourMocks(page);
        await page.goto('/');

        await waitForTourStep(page, TOUR_STEP_TITLES[0]);

        for (let i = 0; i < TOUR_STEP_TITLES.length - 1; i++) {
            // Click Start on step 0, Next on all others
            const btnName = i === 0 ? /^Start$/i : /^(Start|Next)$/i;
            await page.getByRole('button', { name: btnName }).click();
            await waitForTourStep(page, TOUR_STEP_TITLES[i + 1], 10_000);
        }

        // Final step — verify Book a Demo visible without clicking (avoids external nav)
        await expect(page.getByRole('button', { name: /book a demo/i })).toBeVisible();
    });
});
