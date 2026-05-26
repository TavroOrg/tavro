import { Page } from '@playwright/test';

export async function navigateToUseCases(page: Page): Promise<void> {
  await page.goto('/use-cases');
}

export async function clickNewUseCase(page: Page): Promise<void> {
  await page.goto('/use-cases/new');
}

export interface UseCaseData {
  name: string;
  description: string;
  owner?: string;
  proposedBy?: string;
  businessFunction?: string;
  priority?: '1 - Critical' | '2 - High' | '3 - Moderate' | '4 - Low' | '5 - Planning';
  status?: 'Proposed' | 'In Review' | 'Active' | 'Deprecated';
}

/**
 * Fills and submits the Create Use Case form at /use-cases/new.
 * name and description are required by the form.
 */
export async function createUseCase(page: Page, data: UseCaseData): Promise<void> {
  await page.goto('/use-cases/new');

  await page.getByPlaceholder('e.g. Invoice Processing Automation').fill(data.name);
  await page.getByPlaceholder(/brief overview/i).fill(data.description);

  if (data.owner) {
    await page.getByPlaceholder('Team or person responsible').fill(data.owner);
  }
  if (data.proposedBy) {
    await page.getByPlaceholder('Originator of the idea').fill(data.proposedBy);
  }
  if (data.businessFunction) {
    await page.getByPlaceholder(/Finance, Operations/i).fill(data.businessFunction);
  }
  if (data.priority) {
    await page.getByLabel('Priority').selectOption(data.priority);
  }
  if (data.status) {
    await page.getByRole('button', { name: data.status }).click();
  }

  await page.getByRole('button', { name: /create use case|save/i }).click();
}
