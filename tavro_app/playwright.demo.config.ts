import { defineConfig } from '@playwright/test';

/**
 * Playwright config for the interactive demo tour.
 *
 * Differences from the regular test config:
 *  - Runs headed so the user can see (and interact with) the browser.
 *  - No test timeout — the tour is user-paced.
 *  - Single worker, no retries.
 *  - Reuses whatever dev server is already running on port 9000.
 *
 * Usage:
 *   npm run demo:tour
 */
export default defineConfig({
    testDir: './playwright/demo',
    retries: 0,
    workers: 1,
    timeout: 0,   // no timeout — user drives the pace
    reporter: [['list']],

    use: {
        baseURL: 'http://localhost:9000',
        headless: false,
        viewport: null,
        launchOptions: {
            args: ['--start-maximized'],
        },
        actionTimeout: 0,
        navigationTimeout: 0,
    },

    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:9000',
        reuseExistingServer: true,
        timeout: 120_000,
    },
});
