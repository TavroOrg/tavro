import { Page } from '@playwright/test';

export async function navigateToCatalog(page: Page): Promise<void> {
  await page.goto('/catalog');
}

export async function searchAgents(page: Page, term: string): Promise<void> {
  const input = page.getByRole('textbox').first();
  if (!(await input.isVisible({ timeout: 5_000 }).catch(() => false))) return;
  await input.clear();
  await input.fill(term);
}

export async function selectAgent(page: Page, name: string): Promise<void> {
  await page.getByText(name).first().click();
}

export async function clickNewAgent(page: Page): Promise<void> {
  await page.getByRole('button', { name: /new agent|add agent|\+/i }).first().click();
}
