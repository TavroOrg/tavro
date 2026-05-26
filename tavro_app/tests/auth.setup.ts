import { test as setup, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { loginToTavro } from '../actions';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AUTH_FILE = path.join(__dirname, '../playwright/.auth/user.json');

/**
 * Runs once before all browser projects.
 * Delegates to loginToTavro() (the shared action) so auth logic lives in one place.
 * Saves the resulting storage state for reuse across all test files.
 */
setup('authenticate', async ({ page }) => {
  await loginToTavro(page);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 8_000 });
  await page.context().storageState({ path: AUTH_FILE });
});
