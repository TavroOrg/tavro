import { Page } from '@playwright/test';

export async function navigateToBlueprint(page: Page): Promise<void> {
  await page.goto('/blueprint');
}

export interface BlueprintSetupData {
  companyName: string;
  industry: string;
  isPublic: boolean;
  ticker?: string;
  template?: 'banking' | 'insurance' | 'healthcare' | 'manufacturing' | 'retail' | 'technology';
}

/**
 * Fills Step 1 of the Blueprint Setup wizard (/blueprint/setup).
 * Step 1 collects company identity — name, industry, public/private.
 *
 * Steps 2-4 (AI research, template selection, confirm) require a live
 * backend and are left to the caller so tests can stop after Step 1
 * and demos can continue interactively.
 */
export async function setupBlueprint(page: Page, data: BlueprintSetupData): Promise<void> {
  await page.goto('/blueprint/setup');

  // Actual placeholders from BlueprintSetupPage.tsx step-1 form.
  // Use exact: true — "e.g. BankUnited, N.A. (optional)" also contains this substring.
  await page.getByPlaceholder('e.g. BankUnited', { exact: true }).fill(data.companyName);
  await page.getByPlaceholder('e.g. Commercial Banking').fill(data.industry);

  // Click Public/Private BEFORE filling ticker — ticker field only renders after this selection
  const visibilityBtn = page.getByRole('button', {
    name: data.isPublic ? /public company/i : /private company/i,
  });
  await visibilityBtn.click();

  if (data.ticker) {
    await page.getByPlaceholder('e.g. BKU, JPM, BAC').fill(data.ticker);
  }

  await page.getByRole('button', { name: /continue/i }).click();
}
