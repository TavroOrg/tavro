import { Page } from '@playwright/test';

export async function navigateToAudit(page: Page): Promise<void> {
  await page.goto('/audit');
}

export async function navigateToAuditDetail(page: Page, runId: string): Promise<void> {
  await page.goto(`/audit/${encodeURIComponent(runId)}`);
}

/**
 * Clicks the primary "Initiate Audit" / "New Audit" button on the Audit Center page.
 */
export async function initiateAuditRun(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /initiate|start audit|run audit|new audit/i })
    .first()
    .click();
}

/**
 * Clicks the first audit run row in the history table.
 * Works with both table-row and card-based list layouts.
 */
export async function clickFirstAuditRun(page: Page): Promise<void> {
  const row = page
    .locator('tbody tr, [data-testid*="audit-run"], [class*="audit-row"]')
    .first();
  await row.click();
}
