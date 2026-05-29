/**
 * Full end-to-end tests — real login, real UI, real backend.
 *
 * Prerequisites:
 *   1. Docker stack running:  docker compose up -d
 *   2. .env.e2e filled in:   E2E_USERNAME, E2E_PASSWORD, E2E_API_URL=http://localhost:8000
 *
 * Run:  npm run test:e2e
 */

import { test, expect, type Page } from '@playwright/test';

// ── helpers ───────────────────────────────────────────────────────────────────

async function getToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('tavro_access_token'));
  if (!token) throw new Error('No access token in localStorage. Is the session valid?');
  return token;
}

async function getTenantId(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem('tavro_tenant_id'));
}

/**
 * Makes a real authenticated request using page.request (shares the browser
 * context so cookies are included alongside the Bearer header).
 */
async function apiGet(page: Page, apiPath: string): Promise<{ status: number; body: any }> {
  const token    = await getToken(page);
  const tenantId = await getTenantId(page);

  // E2E_API_URL=http://localhost:8000 calls the FastAPI container directly,
  // bypassing Nginx. This avoids any proxy-layer auth or routing issues.
  const base = process.env.E2E_API_URL || process.env.E2E_BASE_URL || 'http://localhost:9000';

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (tenantId) headers['x-tenant-id'] = tenantId;

  const res  = await page.request.get(`${base}/api/v1${apiPath}`, { headers });
  const body = await res.json().catch(() => null);
  return { status: res.status(), body };
}

// ── Authentication ─────────────────────────────────────────────────────────────

test.describe('Authentication', () => {
  test('session is valid — real JWT in localStorage', async ({ page }) => {
    await page.goto('/');

    const token = await getToken(page);
    const parts = token.split('.');

    expect(parts, 'Token must have 3 JWT parts (header.payload.signature)').toHaveLength(3);
    expect(token, 'Token must not be the fake Playwright test token').not.toContain('playwright-fake-sig');

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    expect(payload.exp, 'Token must not be expired').toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test('unauthenticated visitor is redirected to /login', async ({ browser }) => {
    const ctx  = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto('/catalog');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await ctx.close();
  });

  test('clearing auth tokens triggers redirect to /login', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      [
        'tavro_auth', 'tavro_access_token', 'tavro_id_token',
        'tavro_raw_access_token', 'tavro_mcp_access_token',
        'tavro_mcp_refresh_token', 'tavro_oidc_provider',
        'tavro_oidc_issuer', 'tavro_oidc_client_id', 'tavro_tenant_id',
      ].forEach(k => localStorage.removeItem(k));
    });
    await page.reload();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });
});

// ── Home page ──────────────────────────────────────────────────────────────────

test.describe('Home page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('renders the Tavro Agent BizOps heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Tavro Agent BizOps/i })).toBeVisible({ timeout: 10_000 });
  });

  test('quick-nav cards are visible', async ({ page }) => {
    await expect(page.getByText('AI Use Cases')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Agent Catalog')).toBeVisible({ timeout: 10_000 });
  });

  test('clicking AI Use Cases navigates to /use-cases', async ({ page }) => {
    await page.getByText('AI Use Cases').first().click();
    await expect(page).toHaveURL(/\/use-cases/, { timeout: 8_000 });
  });
});

// ── Navigation ─────────────────────────────────────────────────────────────────

test.describe('Navigation — all routes load without crashing', () => {
  const ROUTES = [
    { path: '/',             label: 'Home' },
    { path: '/catalog',      label: 'Catalog' },
    { path: '/use-cases',    label: 'AI Use Cases' },
    { path: '/blueprint',    label: 'Blueprint' },
    { path: '/compliance',   label: 'Compliance' },
    { path: '/audit',        label: 'Audit' },
    { path: '/applications', label: 'Applications' },
    { path: '/processes',    label: 'Processes' },
    { path: '/insights',     label: 'Insights' },
    { path: '/settings',     label: 'Settings' },
    { path: '/playground',   label: 'Playground' },
  ] as const;

  for (const { path, label } of ROUTES) {
    test(`${label} (${path})`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(`JS: ${e.message}`));
      page.on('response', r => {
        if (r.status() >= 500 && r.url().includes('/api/'))
          errors.push(`HTTP ${r.status()} from ${r.url()}`);
      });

      await page.goto(path);
      await expect(page).not.toHaveURL(/\/login/, { timeout: 8_000 });

      const bodyText = await page.locator('body').innerText().catch(() => '');
      expect(bodyText.length, `${label} rendered a blank page — possible crash`).toBeGreaterThan(0);
      expect(errors, `${label} had runtime errors:\n${errors.join('\n')}`).toHaveLength(0);
    });
  }
});

// ── Backend API ────────────────────────────────────────────────────────────────

test.describe('Backend API — real authenticated requests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('GET /api/v1/agents returns valid shape', async ({ page }) => {
    const { status, body } = await apiGet(page, '/agents?start_record=1&record_range=1-10');
    expect(status, `Expected 200, got ${status}. Body: ${JSON.stringify(body)}`).toBe(200);
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data), 'agents.data must be an array').toBe(true);
    expect(body).toHaveProperty('total_records');
  });

  test('GET /api/v1/use-cases returns valid shape', async ({ page }) => {
    const { status, body } = await apiGet(page, '/use-cases');
    expect(status, `Expected 200, got ${status}. Body: ${JSON.stringify(body)}`).toBe(200);
    expect(body).toHaveProperty('use_cases');
    expect(Array.isArray(body.use_cases), 'use_cases must be an array').toBe(true);
  });

  test('GET /api/v1/blueprint returns valid shape', async ({ page }) => {
    const { status, body } = await apiGet(page, '/blueprint');
    expect(status, `Expected 200, got ${status}. Body: ${JSON.stringify(body)}`).toBe(200);
    expect(body).toHaveProperty('nodes');
    expect(body).toHaveProperty('edges');
  });

  test('GET /api/v1/compliance returns 200', async ({ page }) => {
    const { status, body } = await apiGet(page, '/compliance');
    expect(status, `Expected 200, got ${status}. Body: ${JSON.stringify(body)}`).toBe(200);
    expect(body).toBeDefined();
  });

  test('GET /api/v1/audit returns 200', async ({ page }) => {
    const { status, body } = await apiGet(page, '/audit');
    expect(status, `Expected 200, got ${status}. Body: ${JSON.stringify(body)}`).toBe(200);
    expect(body).toBeDefined();
  });

  test('invalid token is rejected with 401 or 403', async ({ page }) => {
    const base = process.env.E2E_API_URL || process.env.E2E_BASE_URL || 'http://localhost:9000';
    const res  = await page.request.get(`${base}/api/v1/agents`, {
      headers: { Authorization: 'Bearer this-is-not-a-valid-token' },
    });
    expect([401, 403], `Expected 401 or 403, got ${res.status()}`).toContain(res.status());
  });
});

// ── Catalog ────────────────────────────────────────────────────────────────────

test.describe('Catalog — real MCP server', () => {
  test('MCP access token is set after login', async ({ page }) => {
    await page.goto('/catalog');
    await expect(page).not.toHaveURL(/\/login/);

    const mcpToken = await page.evaluate(() => localStorage.getItem('tavro_mcp_access_token'));
    expect(mcpToken, 'tavro_mcp_access_token must be set after login').toBeTruthy();
    expect(mcpToken, 'MCP token must not be the fake test token').not.toContain('playwright-fake-sig');
  });

  test('catalog renders agent data or a clean empty state — no crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/catalog');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const hasCards   = (await page.getByRole('heading').count()) > 1;
    const hasNewBtn  = await page.getByRole('button', { name: /new agent|add agent|\+/i }).isVisible().catch(() => false);
    const hasEmpty   = await page.getByText(/no agents|empty|get started/i).isVisible().catch(() => false);

    expect(hasCards || hasNewBtn || hasEmpty, 'Catalog showed neither content nor an empty state').toBe(true);
    expect(errors, `Catalog JS errors:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('search filters agent cards', async ({ page }) => {
    await page.goto('/catalog');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const searchBox = page.getByRole('textbox').first();
    if (!(await searchBox.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await searchBox.fill('zzz_no_match_xyz');
    await page.waitForTimeout(500);
    expect(await page.getByRole('heading', { level: 3 }).count()).toBe(0);
  });
});

// ── Settings ───────────────────────────────────────────────────────────────────

test.describe('Settings page', () => {
  test('loads and shows at least one heading', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).not.toHaveURL(/\/login/);
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(0);
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 8_000 });
  });
});
