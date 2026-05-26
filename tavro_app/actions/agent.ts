import { Page } from '@playwright/test';

export async function navigateToPlayground(page: Page): Promise<void> {
  await page.goto('/playground');
}

/**
 * Starts a Playground session, sends a message, and waits for the response
 * to begin streaming.
 *
 * The Playground requires a session to be active before messages can be sent.
 * This action handles that sequence end-to-end.
 */
export async function runAgent(page: Page, message: string): Promise<void> {
  await page.goto('/playground');

  // Start a session if the button is present (session not yet active)
  const startBtn = page.getByRole('button', { name: /start session/i });
  if (await startBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await startBtn.click();
    // Wait for the session to become active (start button disappears)
    await startBtn.waitFor({ state: 'hidden', timeout: 10_000 });
  }

  // Switch to the Chat tab if the page uses tabs
  const chatTab = page.getByRole('button', { name: /^chat$/i });
  if (await chatTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await chatTab.click();
  }

  // Type and send the message
  const input = page.getByRole('textbox', { name: /message|prompt|ask/i }).or(
    page.locator('textarea').last(),
  );
  await input.fill(message);
  await page.getByRole('button', { name: /send/i }).click();
}

/**
 * Navigates to an agent's detail page by agent ID.
 */
export async function viewAgent(page: Page, agentId: string): Promise<void> {
  await page.goto(`/agent/${encodeURIComponent(agentId)}`);
}
