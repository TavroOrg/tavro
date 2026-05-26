import { Page } from '@playwright/test';

export async function navigateToCompliance(page: Page): Promise<void> {
  await page.goto('/compliance');
}

export async function navigateToComplianceSetup(page: Page): Promise<void> {
  await page.goto('/compliance/new');
}

export async function navigateToComplianceItem(page: Page, id: string): Promise<void> {
  await page.goto(`/compliance/${encodeURIComponent(id)}`);
}

export async function clickComplianceItem(page: Page, name: string): Promise<void> {
  await page.getByText(name).first().click();
}

/**
 * Selects a compliance framework (regulation or policy) in the setup wizard.
 * Tries a button role first; falls back to a text match for card-style UIs.
 */
export async function selectComplianceFramework(page: Page, framework: string): Promise<void> {
  const btn = page.getByRole('button', { name: framework });
  if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await btn.click();
  } else {
    await page.getByText(framework).first().click();
  }
}
