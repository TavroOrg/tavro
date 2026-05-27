import { expect, Page, Locator } from '@playwright/test';

type PortalMonitor = {
  stop: () => string[];
};

export function startPortalMonitor(page: Page): PortalMonitor {
  const issues: string[] = [];

  page.on('pageerror', (error) => {
    issues.push(`Browser error: ${error.message}`);
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      issues.push(`Console error: ${message.text()}`);
    }
  });

  page.on('response', (response) => {
    const url = response.url();
    if (response.status() >= 500 && url.includes('/api/')) {
      issues.push(`Server error: ${response.status()} returned from ${url}`);
    }
  });

  return {
    stop: () => issues,
  };
}

export async function openRoute(page: Page, path: string, label: string): Promise<void> {
  try {
    await page.goto(path);
  } catch {
    throw new Error(
      `Could not open the ${label} page at ${path}. Please check that the portal is running and the route exists.`,
    );
  }
}

export async function expectVisibleReadable(
  locator: Locator,
  description: string,
  pageName: string,
  timeout = 8_000,
): Promise<void> {
  try {
    await expect(locator).toBeVisible({ timeout });
  } catch {
    throw new Error(`On the ${pageName} page, ${description} was not visible within ${timeout / 1000} seconds.`);
  }
}

export async function expectTextReadable(
  page: Page,
  text: string,
  pageName: string,
  timeout = 8_000,
): Promise<void> {
  const locator = page.getByText(text, { exact: true }).first();
  const count = await page.getByText(text, { exact: true }).count().catch(() => 0);

  if (count === 0) {
    throw new Error(
      `On the ${pageName} page, I expected to see "${text}" but nothing matched it. This usually means the data did not load, the MCP request failed, or the page rendered a different label.`,
    );
  }

  try {
    await expect(locator).toBeVisible({ timeout });
  } catch {
    throw new Error(
      `On the ${pageName} page, "${text}" existed in the DOM but was not visible within ${timeout / 1000} seconds.`,
    );
  }
}

export async function expectNonEmptyPage(page: Page, pageName: string): Promise<void> {
  const bodyText = (await page.locator('body').innerText().catch(() => '')).trim();
  if (!bodyText) {
    throw new Error(`The ${pageName} page opened, but it looked blank. This usually means the page crashed before rendering.`);
  }
}

export function failIfPortalIssues(pageName: string, issues: string[]): void {
  if (issues.length === 0) {
    return;
  }

  const readableIssues = issues.slice(0, 3).join('\n- ');
  throw new Error(
    `The ${pageName} page triggered one or more runtime problems:\n- ${readableIssues}\n\nPlease check the browser console and backend responses for the root cause.`,
  );
}
