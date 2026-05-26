import { Page } from '@playwright/test';

export type TavroRoute =
  | '/'
  | '/catalog'
  | '/use-cases'
  | '/use-cases/new'
  | '/blueprint'
  | '/blueprint/setup'
  | '/compliance'
  | '/compliance/new'
  | '/audit'
  | '/applications'
  | '/processes'
  | '/insights'
  | '/settings'
  | '/playground';

export async function navigateTo(page: Page, route: TavroRoute): Promise<void> {
  await page.goto(route);
}

export async function clickSidebarLink(page: Page, label: string | RegExp): Promise<void> {
  // Sidebar items are <button> elements using React Router navigate(), not <a> links
  const btn = page.getByRole('button', { name: label }).first();
  if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await btn.click();
  }
}
