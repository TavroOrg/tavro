/**
 * Full end-to-end tests — real login, real UI, real backend.
 *
 * Prerequisites:
 *   1. Docker stack running:  docker compose up -d
 *   2. .env.e2e filled in:   E2E_USERNAME, E2E_PASSWORD, E2E_API_URL=http://localhost:8000
 *
 * Run:  npm run test:e2e:ui
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
 * Makes a real authenticated GET using page.request (shares the browser
 * context so cookies are included alongside the Bearer header).
 */
async function apiGet(page: Page, apiPath: string): Promise<{ status: number; body: any }> {
  const token    = await getToken(page);
  const tenantId = await getTenantId(page);

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
  test('session is valid — JWT in localStorage', async ({ page }) => {
    await page.goto('/');

    const accessToken = await getToken(page);
    expect(accessToken, 'Access token must not be the fake Playwright test token').not.toContain('playwright-fake-sig');

    const idToken = await page.evaluate(() => localStorage.getItem('tavro_id_token'));
    expect(idToken, 'ID token must be present in localStorage').toBeTruthy();
    const parts = idToken!.split('.');
    expect(parts, 'ID token must have 3 JWT parts (header.payload.signature)').toHaveLength(3);

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    expect(payload.exp, 'ID token must not be expired').toBeGreaterThan(Math.floor(Date.now() / 1000));
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

test.describe('Backend API — authenticated requests', () => {
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
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data), 'use-cases data must be an array').toBe(true);
    expect(body).toHaveProperty('total_records');
  });

  test('GET /api/v1/blueprint/research/config returns valid shape', async ({ page }) => {
    const { status, body } = await apiGet(page, '/blueprint/research/config');
    expect(status, `Expected 200, got ${status}. Body: ${JSON.stringify(body)}`).toBe(200);
    expect(body).toHaveProperty('model');
    expect(body).toHaveProperty('provider');
  });

  test('GET /api/v1/compliance/items returns valid shape', async ({ page }) => {
    const { status, body } = await apiGet(page, '/compliance/items');
    expect(status, `Expected 200, got ${status}. Body: ${JSON.stringify(body)}`).toBe(200);
    expect(body).toHaveProperty('items');
    expect(Array.isArray(body.items), 'compliance items must be an array').toBe(true);
    expect(body).toHaveProperty('total');
  });

  test('GET /api/v1/audit/runs returns valid shape', async ({ page }) => {
    const { status, body } = await apiGet(page, '/audit/runs');
    expect(status, `Expected 200, got ${status}. Body: ${JSON.stringify(body)}`).toBe(200);
    expect(Array.isArray(body), 'audit runs must be an array').toBe(true);
  });

  test('GET /api/v1/applications returns valid shape', async ({ page }) => {
    const { status, body } = await apiGet(page, '/applications');
    expect(status, `Expected 200, got ${status}. Body: ${JSON.stringify(body)}`).toBe(200);
    expect(body).toHaveProperty('items');
    expect(Array.isArray(body.items), 'applications items must be an array').toBe(true);
    expect(body).toHaveProperty('total');
  });

  test('GET /api/v1/processes returns valid shape', async ({ page }) => {
    const { status, body } = await apiGet(page, '/processes');
    expect(status, `Expected 200, got ${status}. Body: ${JSON.stringify(body)}`).toBe(200);
    expect(body).toHaveProperty('items');
    expect(Array.isArray(body.items), 'processes items must be an array').toBe(true);
    expect(body).toHaveProperty('total');
  });
});

// ── Catalog ────────────────────────────────────────────────────────────────────

test.describe('Catalog — MCP server', () => {
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

// ── shared POST / PUT helpers ─────────────────────────────────────────────────

async function apiPost(
  page: Page,
  apiPath: string,
  body: object,
): Promise<{ status: number; body: any }> {
  const token    = await getToken(page);
  const tenantId = await getTenantId(page);
  const base     = process.env.E2E_API_URL || process.env.E2E_BASE_URL || 'http://localhost:9000';

  const headers: Record<string, string> = {
    Authorization:  `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept:         'application/json',
  };
  if (tenantId) headers['x-tenant-id'] = tenantId;

  const res     = await page.request.post(`${base}/api/v1${apiPath}`, { headers, data: body });
  const resBody = await res.json().catch(() => null);
  return { status: res.status(), body: resBody };
}

async function apiPut(
  page: Page,
  apiPath: string,
): Promise<{ status: number; body: any }> {
  const token    = await getToken(page);
  const tenantId = await getTenantId(page);
  const base     = process.env.E2E_API_URL || process.env.E2E_BASE_URL || 'http://localhost:9000';

  const headers: Record<string, string> = {
    Authorization:  `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (tenantId) headers['x-tenant-id'] = tenantId;

  const res     = await page.request.put(`${base}/api/v1${apiPath}`, { headers });
  const resBody = await res.json().catch(() => null);
  return { status: res.status(), body: resBody };
}

// ── Spark to Agent Playground — E2E Test Suite ───────────────────────────────
//
// Tests run serially and share state through the variables below.
// Each test builds on the previous — a failure early in the chain will cause
// later tests to skip via requireRegisteredCompany() or explicit id guards.

test.describe.serial('Spark to Agent Playground E2E Testing', () => {
  let useCaseId     = '';
  let useCaseTitle  = '';
  let agentId       = '';
  let agentName     = '';
  let processId     = '';
  let applicationId = '';
  let hasRegisteredCompany = false;
  let companyIds: string[] = [];
  let activeCompanyId = '';

  const APPLICATION_NAME = 'Pearson VUE';
  const PROCESS_NAME     = 'Pearson VUE Process';
  const noCompanyMessage = 'Set up your Company Blueprint first — Spark uses your company profile as context for idea generation.';

  function requireRegisteredCompany() {
    if (!hasRegisteredCompany) {
      throw new Error(noCompanyMessage);
    }
  }

  async function switchActiveCompany(page: Page, companyId: string) {
    await page.goto('/');
    await page.evaluate((id) => {
      localStorage.setItem('tavro_active_company_id', id);
    }, companyId);
    activeCompanyId = companyId;
  }

  async function tryInspireMe(page: Page): Promise<boolean> {
    await page.goto('/spark');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const inspireBtn = page.getByRole('button', { name: /inspire me/i });
    await expect(inspireBtn).toBeVisible({ timeout: 10_000 });
    await inspireBtn.click();

    await page.waitForSelector(
      '[data-testid="idea-card"], .idea-card, [class*="idea"], button:has-text("View")',
      { timeout: 45_000 },
    ).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

    return (
      (await page.getByRole('button', { name: /view.*develop|develop/i }).count()) > 0 ||
      (await page.getByText(/complexity|estimated impact/i).count()) > 0
    );
  }

  // ── 1. Blueprint — company loaded in UI, API confirms company data ────────────

  test('1 — blueprint: API returns company list and UI renders company blueprint page', async ({ page }) => {
    await page.goto('/blueprint');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const { status, body } = await apiGet(page, '/companies');
    const companies: any[] = (status === 200 ? (Array.isArray(body) ? body : body.items ?? []) : []);
    expect(status, `GET /companies returned ${status}`).toBe(200);
    console.log(`[spark] ${companies.length} company/companies available`);

    hasRegisteredCompany = companies.length > 0;
    companyIds = companies
      .map((c: any) => c.id ?? c.company_id)
      .filter((id: string | undefined): id is string => Boolean(id));

    // UI — blueprint page must render content
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length, 'Blueprint page rendered blank').toBeGreaterThan(0);

    if (!hasRegisteredCompany) {
      // UI — Spark should show the no-company warning and disable Inspire Me
      await page.goto('/spark');
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.getByText(noCompanyMessage, { exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole('button', { name: /inspire me/i })).toBeDisabled();
      throw new Error(noCompanyMessage);
    }

    // UI — blueprint page should show at least one company card/heading
    const hasCompanyContent =
      (await page.getByRole('button').count()) > 0 ||
      (await page.getByRole('heading').count()) > 0 ||
      (await page.locator('[class*="card"], [class*="company"]').count()) > 0;
    expect(hasCompanyContent, 'Blueprint page loaded but no company content found').toBe(true);

    activeCompanyId = (await page.evaluate(() => localStorage.getItem('tavro_active_company_id'))) ?? '';
    expect(activeCompanyId, 'Expected an active company to be selected before continuing Spark flow').toBeTruthy();
    console.log(`[spark] Active company ready — id: ${activeCompanyId}`);
  });

  // ── 2. Spark — Inspire Me button streams idea cards into the UI ───────────────

  test('2 — spark: Inspire Me button generates idea cards — UI renders ideas with title and metadata', async ({ page }) => {
    requireRegisteredCompany();
    const orderedCompanyIds = [
      activeCompanyId,
      ...companyIds.filter(id => id !== activeCompanyId),
    ].filter(Boolean);

    let ideasLoaded = false;
    for (const companyId of orderedCompanyIds) {
      if (companyId !== activeCompanyId) {
        await switchActiveCompany(page, companyId);
        console.log(`[spark] Retrying Inspire Me with company: ${companyId}`);
      }

      ideasLoaded = await tryInspireMe(page);
      if (ideasLoaded) {
        activeCompanyId = companyId;
        console.log(`[spark] Ideas loaded successfully for company: ${companyId}`);
        break;
      }
    }

    expect(
      ideasLoaded,
      orderedCompanyIds.length > 1
        ? `No ideas appeared after clicking Inspire Me for any available company: ${orderedCompanyIds.join(', ')}`
        : `No ideas appeared after clicking Inspire Me for company: ${activeCompanyId}`,
    ).toBe(true);

    // UI — idea cards should have visible content (title text)
    const ideaCards = page.locator('[data-testid="idea-card"], .idea-card, [class*="idea"]');
    const cardCount = await ideaCards.count();
    if (cardCount > 0) {
      const cardText = await ideaCards.first().innerText().catch(() => '');
      expect(cardText.length, 'First idea card should have visible text content').toBeGreaterThan(0);
    }

    // UI — complexity / impact metadata should be shown on at least one card
    const hasMetadata = (await page.getByText(/complexity|estimated impact/i).count()) > 0;
    expect(hasMetadata, 'Idea cards should show complexity or estimated impact metadata').toBe(true);

    // UI — "View & Develop" button should be present to enter the idea
    await expect(
      page.getByRole('button', { name: /view.*develop|develop/i }).first(),
      '"View & Develop" button not found on any idea card',
    ).toBeVisible({ timeout: 5_000 });

    console.log(`[spark] ${cardCount > 0 ? cardCount : 'multiple'} idea card(s) visible with metadata`);
  });

  // ── 3. Spark — open idea modal and convert to AI use case via UI ──────────────

  test('3 — spark: open idea modal and convert to AI use case — UI navigates to use case detail page', async ({ page }) => {
    requireRegisteredCompany();
    await page.goto('/spark');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const viewBtn = page.getByRole('button', { name: /view.*develop|develop/i }).first();
    if (!(await viewBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      await page.getByRole('button', { name: /inspire me/i }).click();
      await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
    }

    await expect(viewBtn, '"View & Develop" not found — no ideas loaded').toBeVisible({ timeout: 20_000 });
    await viewBtn.click();

    const convertBtn = page.getByRole('button', { name: /convert to use case/i });
    await expect(convertBtn, '"Convert to Use Case" button not found after opening idea').toBeVisible({ timeout: 10_000 });
    console.log('[spark] Idea opened — clicking Convert to Use Case');
    await convertBtn.click();

    // UI — app must navigate to /use-case/{id} after conversion
    await page.waitForURL(/\/use-?case[s]?\/[a-f0-9-]+/i, { timeout: 90_000 });

    const url   = page.url();
    const match = url.match(/\/use-?case[s]?\/([a-f0-9-]+)/i);
    expect(match, `Cannot extract use case ID from URL: ${url}`).toBeTruthy();
    useCaseId = match![1];

    // UI — the use case detail page should render with content
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length, 'Use case detail page rendered blank after conversion').toBeGreaterThan(0);

    console.log(`[spark] Use case created and detail page loaded — id: ${useCaseId}, url: ${url}`);
  });

  // ── 4. API — verify use case created with correct shape and linked Spark agent ─

  test('4 — API: verify use case exists in backend with correct shape, title, and linked Spark agent', async ({ page }) => {
    requireRegisteredCompany();
    await page.goto('/');

    const { status, body } = await apiGet(page, `/use-cases/${useCaseId}`);
    expect(status).toBe(200);

    const uc = body.data?.[0];
    expect(uc, 'Use case not found in API after Spark conversion').toBeTruthy();
    useCaseTitle = uc.name ?? uc.title ?? '';
    expect(useCaseTitle, 'Use case has no title').toBeTruthy();
    console.log(`[spark] API — use case verified: title="${useCaseTitle}"`);

    // Find agent linked by Spark
    const linked: any[] = uc.of_associated_agents ?? [];
    if (linked.length > 0) {
      agentId   = linked[0].agent_id   ?? linked[0].id   ?? '';
      agentName = linked[0].agent_name ?? linked[0].name ?? '';
    } else {
      const { body: cat } = await apiGet(page, '/agents?start_record=1&record_range=1-10');
      expect(cat.data?.length, 'No agents in catalog after Spark conversion').toBeGreaterThan(0);
      agentId   = cat.data[0].agent_id   ?? cat.data[0].id   ?? '';
      agentName = cat.data[0].agent_name ?? cat.data[0].name ?? '';
    }
    expect(agentId, 'Agent ID not found after Spark conversion').toBeTruthy();
    console.log(`[spark] API — linked agent: id=${agentId}, name="${agentName}"`);
  });

  // ── 5. UI — use case detail: verify agent linked, unlink via UI, re-link via UI ─

  test('5 — UI: use case detail — verify linked agent, unlink via UI, re-link via UI', async ({ page }) => {
    if (!useCaseId) test.skip(true, 'Skipping: no use case ID — test 4 must pass first');
    requireRegisteredCompany();

    await page.goto(`/use-case/${useCaseId}`);
    await expect(page).not.toHaveURL(/\/login/);

    // Page shows "Loading use case details..." spinner initially — wait for it to clear
    await page.waitForFunction(
      "document.body && document.body.innerText.length > 20 && !/loading use case/i.test(document.body.innerText)",
      { timeout: 30_000 },
    );

    if (useCaseTitle) {
      await expect(page.locator('body'), `Use case title "${useCaseTitle}" not on detail page`)
        .toContainText(useCaseTitle, { timeout: 10_000 });
    }

    // ── Step 1: Click the AI Agents tab and verify agent is shown ─────────────
    if (agentName) {
      // Agent name lives behind the "AI Agents" tab — click it first
      const agentsTab = page.getByRole('tab', { name: /ai agents/i })
        .or(page.getByRole('button', { name: /ai agents/i }))
        .or(page.locator('[class*="tab"]').filter({ hasText: /ai agents/i }))
        .first();
      if (await agentsTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await agentsTab.click();
        await page.waitForTimeout(500);
      }
      await expect(page.locator('body'), `Agent "${agentName}" not visible on use case detail page`)
        .toContainText(agentName, { timeout: 10_000 });
      console.log(`[spark] UI — agent "${agentName}" confirmed linked on use case`);
    } else {
      console.log('[spark] UI — agent name not available, skipping agent visibility check');
    }

    // ── Step 2: Unlink agent via UI ────────────────────────────────────────────
    // Look for remove button in the "Currently Related Agents" section only
    const relatedSection = page.getByText(/currently related agents/i)
      .locator('xpath=ancestor::*[3]')
      .first();
    const removeAgentBtn = relatedSection.getByRole('button', { name: /remove|unlink|delete/i })
      .or(relatedSection.locator('button[aria-label*="remove" i], button[aria-label*="unlink" i]'))
      .first();

    if (await removeAgentBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await removeAgentBtn.click();
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok/i }).first();
      if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) await confirmBtn.click();
      await page.waitForTimeout(1_000);

      // After unlink, the tab shows "AI Agents (0)" and the section shows "No agents linked."
      // Do NOT check for absence of agent name — it still appears in the available-agents list below.
      await expect(page.locator('body'), 'AI Agents tab should show 0 after unlinking')
        .toContainText('AI Agents (0)', { timeout: 8_000 });
      await expect(page.locator('body'), 'Should show no agents linked message')
        .toContainText('No agents linked', { timeout: 5_000 });
      console.log(`[spark] UI — agent "${agentName}" unlinked — AI Agents (0) confirmed`);

      // ── Step 3: Re-link by clicking the "Link" button next to the correct agent ─
      // Filter the available-agents list first so only the target agent is shown,
      // then click that row's Link button — avoids clicking the wrong agent.
      const filterInput = page.locator('input[placeholder*="filter" i], input[placeholder*="search" i], input[placeholder*="agent" i]').first();
      if (await filterInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await filterInput.fill(agentName);
        await page.waitForTimeout(800);
      }
      const targetRow = page.locator('li, tr, [class*="item"], [class*="row"]')
        .filter({ hasText: agentName })
        .first();
      const linkBtn = targetRow.getByRole('button', { name: /^link$/i })
        .or(targetRow.locator('button').filter({ hasText: /^link$/i }))
        .first();
      await expect(linkBtn, `Link button for "${agentName}" not found in available agents list`).toBeVisible({ timeout: 8_000 });
      await linkBtn.click();
      await page.waitForTimeout(1_000);
      // After re-linking, tab count should be back to (1)
      await expect(page.locator('body'), `AI Agents tab should show 1 after re-linking`)
        .toContainText('AI Agents (1)', { timeout: 10_000 });
      console.log(`[spark] UI — agent "${agentName}" re-linked — AI Agents (1) confirmed`);
    } else {
      console.log('[spark] UI — remove button not found for agent; skipping unlink/re-link (read-only detail view)');
    }
  });

  // ── 6. API — create application and process ───────────────────────────────────

  test('6 — API: create application and process', async ({ page }) => {
    requireRegisteredCompany();
    await page.goto('/');

    const { status: as, body: app } = await apiPost(page, '/applications', {
      application_name:     APPLICATION_NAME,
      vendor_name:          APPLICATION_NAME,
      business_criticality: 'Tier 1',
    });
    expect(as, `Application creation failed: ${JSON.stringify(app)}`).toBe(201);
    expect(app).toHaveProperty('business_application_id');
    applicationId = app.business_application_id;
    console.log(`[spark] API — application created: id=${applicationId}, name="${APPLICATION_NAME}"`);

    const { status: ps, body: proc } = await apiPost(page, '/processes', {
      process_name:        PROCESS_NAME,
      process_description: 'Process created for Pearson VUE-generated use case',
    });
    expect(ps, `Process creation failed: ${JSON.stringify(proc)}`).toBe(201);
    expect(proc).toHaveProperty('business_process_id');
    processId = proc.business_process_id;
    console.log(`[spark] API — process created: id=${processId}, name="${PROCESS_NAME}"`);
  });

  // ── 7. UI — /applications page lists newly created application ────────────────

  test('7 — UI: /applications page lists the newly created application', async ({ page }) => {
    if (!applicationId) test.skip(true, 'Skipping: no application ID — test 6 must pass first');
    requireRegisteredCompany();

    await page.goto('/applications');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    await expect(page.locator('body'), `Application "${APPLICATION_NAME}" not found on /applications page`)
      .toContainText(APPLICATION_NAME, { timeout: 15_000 });

    console.log(`[spark] UI — application "${APPLICATION_NAME}" confirmed on /applications`);
  });

  // ── 8. UI — /processes page lists newly created process ──────────────────────

  test('8 — UI: /processes page lists the newly created process', async ({ page }) => {
    if (!processId) test.skip(true, 'Skipping: no process ID — test 6 must pass first');
    requireRegisteredCompany();

    await page.goto('/processes');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    await expect(page.locator('body'), `Process "${PROCESS_NAME}" not found on /processes page`)
      .toContainText(PROCESS_NAME, { timeout: 15_000 });

    console.log(`[spark] UI — process "${PROCESS_NAME}" confirmed on /processes`);
  });

  // ── 9. API — link agent to process ───────────────────────────────────────────

  test('9 — API: link agent to process', async ({ page }) => {
    requireRegisteredCompany();
    await page.goto('/');
    const { status, body } = await apiPut(page, `/agents/${agentId}/processes/${processId}`);
    expect([200, 201], `Agent→process link failed: ${JSON.stringify(body)}`).toContain(status);
    console.log(`[spark] API — agent linked to process: status=${body?.status ?? status}`);
  });

  // ── 10. UI — agent detail: verify process linked, unlink via UI, re-link via UI ─

  test('10 — UI: agent detail — verify linked process, unlink via UI, re-link via UI', async ({ page }) => {
    if (!agentId || !processId) test.skip(true, 'Skipping: agent or process ID missing');
    requireRegisteredCompany();

    await page.goto('/catalog');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const agentCard = page.getByText(agentName, { exact: false }).first();
    await expect(agentCard, `Agent "${agentName}" not visible in catalog`).toBeVisible({ timeout: 10_000 });
    await agentCard.click();
    await page.waitForURL(/\/(catalog|agent(s)?)\/[^/]+/, { timeout: 10_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    // Navigate to Processes tab if needed
    const processVisible = await page.getByText(PROCESS_NAME, { exact: false }).isVisible({ timeout: 5_000 }).catch(() => false);
    if (!processVisible) {
      const processesTab = page.getByRole('tab', { name: /processes/i })
        .or(page.getByRole('button', { name: /processes/i })).first();
      if (await processesTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await processesTab.click();
        await page.waitForTimeout(1_000);
      }
    }

    // ── Step 1: Verify process is shown ────────────────────────────────────────
    await expect(page.locator('body'), `Process "${PROCESS_NAME}" not visible on agent detail page`)
      .toContainText(PROCESS_NAME, { timeout: 10_000 });
    console.log(`[spark] UI — process "${PROCESS_NAME}" confirmed linked on agent`);

    // ── Step 2: Unlink process via UI ──────────────────────────────────────────
    const processRow = page.locator('li, tr, [class*="item"], [class*="card"], [class*="row"]')
      .filter({ hasText: PROCESS_NAME })
      .first();
    const removeProcessBtn = processRow.getByRole('button', { name: /remove|unlink|delete/i })
      .or(processRow.locator('button[aria-label*="remove" i], button[aria-label*="unlink" i]'))
      .first();

    if (await removeProcessBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await removeProcessBtn.click();
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok/i }).first();
      if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) await confirmBtn.click();
      await page.waitForTimeout(1_000);
      await expect(page.locator('body'), `Process "${PROCESS_NAME}" should be gone after unlinking`)
        .not.toContainText(PROCESS_NAME, { timeout: 8_000 });
      console.log(`[spark] UI — process "${PROCESS_NAME}" unlinked from agent`);

      // ── Step 3: Re-link process via UI ──────────────────────────────────────
      const addProcessBtn = page.getByRole('button', { name: /add.*process|link.*process/i })
        .or(page.getByRole('button', { name: /add process/i }))
        .first();
      await expect(addProcessBtn, 'Add Process button not found after unlinking').toBeVisible({ timeout: 8_000 });
      await addProcessBtn.click();
      await page.waitForTimeout(500);

      const processOption = page.getByRole('option', { name: new RegExp(PROCESS_NAME, 'i') })
        .or(page.locator('[class*="dropdown"], [class*="modal"], [role="listbox"]')
          .filter({ hasText: PROCESS_NAME }))
        .first();
      if (await processOption.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await processOption.click();
      } else {
        const modalSearch = page.locator('[role="dialog"] input, [class*="modal"] input').first();
        if (await modalSearch.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await modalSearch.fill(PROCESS_NAME);
          await page.waitForTimeout(500);
          await page.getByRole('option').first().click();
        }
      }
      const confirmLinkBtn = page.getByRole('button', { name: /save|confirm|add|link/i }).last();
      if (await confirmLinkBtn.isVisible({ timeout: 3_000 }).catch(() => false)) await confirmLinkBtn.click();

      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await expect(page.locator('body'), `Process "${PROCESS_NAME}" not visible after re-linking via UI`)
        .toContainText(PROCESS_NAME, { timeout: 10_000 });
      console.log(`[spark] UI — process "${PROCESS_NAME}" re-linked to agent via UI`);
    } else {
      console.log('[spark] UI — remove button not found for process on agent detail; skipping unlink/re-link');
    }
  });

  // ── 11. API — link use case to process ────────────────────────────────────────

  test('11 — API: link use case to process', async ({ page }) => {
    requireRegisteredCompany();
    await page.goto('/');
    const { status, body } = await apiPost(page, `/use-cases/${useCaseId}/processes`, {
      process_id: processId,
    });
    expect(status, `Use case→process link failed: ${JSON.stringify(body)}`).toBe(200);
    expect(body.message).toContain('synchronized');
    expect(body.associated_count).toBeGreaterThanOrEqual(1);
    console.log(`[spark] API — use case linked to process: ${body.associated_count} process(es) associated`);
  });

  // ── 12. UI — use case detail: verify process linked, unlink via UI, re-link via UI

  test('12 — UI: use case detail — verify linked process, unlink via UI, re-link via UI', async ({ page }) => {
    if (!useCaseId || !processId) test.skip(true, 'Skipping: use case or process ID missing');
    requireRegisteredCompany();

    await page.goto(`/use-case/${useCaseId}`);
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForFunction(
      "document.body && document.body.innerText.length > 20 && !/loading use case/i.test(document.body.innerText)",
      { timeout: 30_000 },
    );

    // Navigate to Processes tab if needed
    const processVisible = await page.locator('body').textContent().then(t => t?.includes(PROCESS_NAME) ?? false).catch(() => false);
    if (!processVisible) {
      const processesTab = page.getByRole('tab', { name: /processes/i })
        .or(page.getByRole('button', { name: /processes/i })).first();
      if (await processesTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await processesTab.click();
        await page.waitForTimeout(1_000);
      }
    }

    // ── Step 1: Verify process is shown ────────────────────────────────────────
    await expect(page.locator('body'), `Process "${PROCESS_NAME}" not visible on use case detail page`)
      .toContainText(PROCESS_NAME, { timeout: 10_000 });
    console.log(`[spark] UI — process "${PROCESS_NAME}" confirmed linked on use case`);

    // ── Step 2: Unlink process via UI ──────────────────────────────────────────
    const processRow = page.locator('li, tr, [class*="item"], [class*="card"], [class*="row"]')
      .filter({ hasText: PROCESS_NAME })
      .first();
    const removeProcessBtn = processRow.getByRole('button', { name: /remove|unlink|delete/i })
      .or(processRow.locator('button[aria-label*="remove" i], button[aria-label*="unlink" i]'))
      .first();

    if (await removeProcessBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await removeProcessBtn.click();
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok/i }).first();
      if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) await confirmBtn.click();
      await page.waitForTimeout(1_000);
      await expect(page.locator('body'), `Process "${PROCESS_NAME}" should be gone after unlinking`)
        .not.toContainText(PROCESS_NAME, { timeout: 8_000 });
      console.log(`[spark] UI — process "${PROCESS_NAME}" unlinked from use case`);

      // ── Step 3: Re-link process via UI ──────────────────────────────────────
      const addProcessBtn = page.getByRole('button', { name: /add.*process|link.*process/i })
        .or(page.getByRole('button', { name: /add process/i }))
        .first();
      await expect(addProcessBtn, 'Add Process button not found after unlinking').toBeVisible({ timeout: 8_000 });
      await addProcessBtn.click();
      await page.waitForTimeout(500);

      const processOption = page.getByRole('option', { name: new RegExp(PROCESS_NAME, 'i') })
        .or(page.locator('[class*="dropdown"], [class*="modal"], [role="listbox"]')
          .filter({ hasText: PROCESS_NAME }))
        .first();
      if (await processOption.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await processOption.click();
      } else {
        const modalSearch = page.locator('[role="dialog"] input, [class*="modal"] input').first();
        if (await modalSearch.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await modalSearch.fill(PROCESS_NAME);
          await page.waitForTimeout(500);
          await page.getByRole('option').first().click();
        }
      }
      const confirmLinkBtn = page.getByRole('button', { name: /save|confirm|add|link/i }).last();
      if (await confirmLinkBtn.isVisible({ timeout: 3_000 }).catch(() => false)) await confirmLinkBtn.click();

      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await expect(page.locator('body'), `Process "${PROCESS_NAME}" not visible after re-linking via UI`)
        .toContainText(PROCESS_NAME, { timeout: 10_000 });
      console.log(`[spark] UI — process "${PROCESS_NAME}" re-linked to use case via UI`);
    } else {
      console.log('[spark] UI — remove button not found for process on use case detail; skipping unlink/re-link');
    }
  });

  // ── 13. API — link agent to application ──────────────────────────────────────

  test('13 — API: link agent to application', async ({ page }) => {
    requireRegisteredCompany();
    await page.goto('/');
    const { status, body } = await apiPut(page, `/agents/${agentId}/applications/${applicationId}`);
    expect([200, 201], `Agent→application link failed (${status}): ${JSON.stringify(body)}`).toContain(status);
    console.log(`[spark] API — agent linked to application: status=${status}`);
  });

  // ── 14. UI — agent detail: verify application linked, unlink via UI, re-link via UI

  test('14 — UI: agent detail — verify linked application, unlink via UI, re-link via UI', async ({ page }) => {
    if (!agentId || !applicationId) test.skip(true, 'Skipping: agent or application ID missing');
    requireRegisteredCompany();

    await page.goto('/catalog');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const agentCard = page.getByText(agentName, { exact: false }).first();
    await expect(agentCard, `Agent "${agentName}" not visible in catalog`).toBeVisible({ timeout: 10_000 });
    await agentCard.click();
    await page.waitForURL(/\/(catalog|agent(s)?)\/[^/]+/, { timeout: 10_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    // Navigate to Applications tab if needed
    const appVisible = await page.getByText(APPLICATION_NAME, { exact: false }).isVisible({ timeout: 5_000 }).catch(() => false);
    if (!appVisible) {
      const appsTab = page.getByRole('tab', { name: /applications/i })
        .or(page.getByRole('button', { name: /applications/i })).first();
      if (await appsTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await appsTab.click();
        await page.waitForTimeout(1_000);
      }
    }

    // ── Step 1: Verify application is shown ────────────────────────────────────
    await expect(page.locator('body'), `Application "${APPLICATION_NAME}" not visible on agent detail page`)
      .toContainText(APPLICATION_NAME, { timeout: 10_000 });
    console.log(`[spark] UI — application "${APPLICATION_NAME}" confirmed linked on agent`);

    // ── Step 2: Unlink application via UI ──────────────────────────────────────
    const appRow = page.locator('li, tr, [class*="item"], [class*="card"], [class*="row"]')
      .filter({ hasText: APPLICATION_NAME })
      .first();
    const removeAppBtn = appRow.getByRole('button', { name: /remove|unlink|delete/i })
      .or(appRow.locator('button[aria-label*="remove" i], button[aria-label*="unlink" i]'))
      .first();

    if (await removeAppBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await removeAppBtn.click();
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok/i }).first();
      if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) await confirmBtn.click();
      await page.waitForTimeout(1_000);
      await expect(page.locator('body'), `Application "${APPLICATION_NAME}" should be gone after unlinking`)
        .not.toContainText(APPLICATION_NAME, { timeout: 8_000 });
      console.log(`[spark] UI — application "${APPLICATION_NAME}" unlinked from agent`);

      // ── Step 3: Re-link application via UI ──────────────────────────────────
      const addAppBtn = page.getByRole('button', { name: /add.*application|link.*application/i })
        .or(page.getByRole('button', { name: /add application/i }))
        .first();
      await expect(addAppBtn, 'Add Application button not found after unlinking').toBeVisible({ timeout: 8_000 });
      await addAppBtn.click();
      await page.waitForTimeout(500);

      const appOption = page.getByRole('option', { name: new RegExp(APPLICATION_NAME, 'i') })
        .or(page.locator('[class*="dropdown"], [class*="modal"], [role="listbox"]')
          .filter({ hasText: APPLICATION_NAME }))
        .first();
      if (await appOption.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await appOption.click();
      } else {
        const modalSearch = page.locator('[role="dialog"] input, [class*="modal"] input').first();
        if (await modalSearch.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await modalSearch.fill(APPLICATION_NAME);
          await page.waitForTimeout(500);
          await page.getByRole('option').first().click();
        }
      }
      const confirmLinkBtn = page.getByRole('button', { name: /save|confirm|add|link/i }).last();
      if (await confirmLinkBtn.isVisible({ timeout: 3_000 }).catch(() => false)) await confirmLinkBtn.click();

      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await expect(page.locator('body'), `Application "${APPLICATION_NAME}" not visible after re-linking via UI`)
        .toContainText(APPLICATION_NAME, { timeout: 10_000 });
      console.log(`[spark] UI — application "${APPLICATION_NAME}" re-linked to agent via UI`);
    } else {
      console.log('[spark] UI — remove button not found for application on agent detail; skipping unlink/re-link');
    }
  });

  // ── 15. API — verify all links on use case ────────────────────────────────────

  test('15 — API: verify use case has both linked agent and process confirmed', async ({ page }) => {
    requireRegisteredCompany();
    await page.goto('/');

    const { status, body } = await apiGet(page, `/use-cases/${useCaseId}`);
    expect(status).toBe(200);
    const uc = body.data?.[0];
    expect(uc).toBeTruthy();

    const agents:    any[] = uc.of_associated_agents            ?? [];
    const processes: any[] = uc.of_associated_business_processes ?? [];

    expect(
      agents.some((a: any) =>
        a.agent_id === agentId ||
        (agentName && (a.agent_name ?? a.name ?? '').toLowerCase() === agentName.toLowerCase())
      ),
      `Agent ${agentId} (${agentName}) not in linked agents: ${JSON.stringify(agents)}`,
    ).toBe(true);
    expect(processes.length, 'No process linked to use case').toBeGreaterThan(0);

    console.log(`[spark] API — links verified: ${agents.length} agent(s), ${processes.length} process(es)`);
  });

  // ── 16. UI — use case detail shows all linked items ───────────────────────────

  test('16 — UI: use case detail page shows all linked items — agent and process', async ({ page }) => {
    if (!useCaseId) test.skip(true, 'Skipping: no use case ID');
    requireRegisteredCompany();

    await page.goto(`/use-case/${useCaseId}`);
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForFunction(
      "document.body && document.body.innerText.length > 20 && !/loading use case/i.test(document.body.innerText)",
      { timeout: 30_000 },
    );

    // Agent name lives behind the "AI Agents" tab
    if (agentName) {
      const agentsTab16 = page.getByRole('tab', { name: /ai agents/i })
        .or(page.getByRole('button', { name: /ai agents/i }))
        .or(page.locator('[class*="tab"]').filter({ hasText: /ai agents/i }))
        .first();
      if (await agentsTab16.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await agentsTab16.click();
        await page.waitForTimeout(500);
      }
      await expect(page.locator('body'), `Agent "${agentName}" not visible on use case detail page`)
        .toContainText(agentName, { timeout: 10_000 });
    } else {
      console.log('[spark] UI — agent name not available, skipping agent check in test 16');
    }

    // Process must be present — check tab if needed
    const processVisible = await page.locator('body').textContent().then(t => t?.includes(PROCESS_NAME) ?? false).catch(() => false);
    if (!processVisible) {
      const processesTab = page.getByRole('tab', { name: /processes/i })
        .or(page.getByRole('button', { name: /processes/i }))
        .first();
      if (await processesTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await processesTab.click();
        await page.waitForTimeout(1_000);
      }
    }
    await expect(page.locator('body'), `Process "${PROCESS_NAME}" not visible on use case detail page`)
      .toContainText(PROCESS_NAME, { timeout: 10_000 });

    console.log('[spark] UI — use case detail page confirmed: agent and process both visible');
  });

  // ── 17. Settings — configure Anthropic AI assistant via UI ───────────────────

  test('17 — settings: configure Anthropic AI assistant via UI and verify save confirmation', async ({ page }) => {
    requireRegisteredCompany();
    test.setTimeout(120_000);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    expect(apiKey, 'ANTHROPIC_API_KEY must be set in .env.e2e').toBeTruthy();

    // ── Step 1: Configure provider in Settings ──────────────────────────────────
    await page.goto('/settings');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const settingsSection = page.getByText(/chat ai configuration/i);
    await expect(settingsSection, '"Chat AI Configuration" section not found on /settings').toBeVisible({ timeout: 8_000 });
    await settingsSection.scrollIntoViewIfNeeded();

    // Select Anthropic (Claude) from the Provider Type dropdown
    const providerTypeLabel = page.locator('label').filter({ hasText: /^Provider Type$/i });
    const providerSelect = providerTypeLabel.locator('xpath=following-sibling::select[1]');
    await expect(providerSelect, 'Provider type <select> not found').toBeVisible({ timeout: 5_000 });
    await providerSelect.selectOption({ label: 'Anthropic (Claude)' });
    await page.waitForTimeout(500);

    // Verify model defaults to claude-sonnet-4-6
    const modelLabel = page.locator('label').filter({ hasText: /^Model$/i }).first();
    const modelField = modelLabel.locator('xpath=following-sibling::*[1]');
    await expect(modelField, 'Model field not found').toBeVisible({ timeout: 5_000 });
    if ((await modelField.evaluate(el => el.tagName.toLowerCase())) === 'select') {
      await modelField.selectOption('claude-sonnet-4-6').catch(async () => {
        await modelField.selectOption({ label: 'claude-sonnet-4-6' });
      });
    } else if (!(await modelField.inputValue()).includes('sonnet')) {
      await modelField.fill('claude-sonnet-4-6');
    }
    await expect(modelField, 'Anthropic model was not selected').toHaveValue(/claude.*sonnet/i);

    // Enter API key
    const apiKeyLabel = page.locator('label').filter({ hasText: /^Anthropic API Key$/i });
    await expect(apiKeyLabel, 'Anthropic API Key label not found').toBeVisible({ timeout: 5_000 });
    const configCard  = apiKeyLabel.locator('xpath=ancestor::div[contains(@class, "border-2")][1]');
    const apiKeyInput = apiKeyLabel.locator('xpath=following-sibling::div[1]//input');
    await expect(apiKeyInput, 'Anthropic API key input not found').toBeVisible({ timeout: 5_000 });
    await apiKeyInput.clear();
    await apiKeyInput.fill(apiKey!);

    // Save and verify confirmation
    const saveBtn = configCard.getByRole('button', { name: /^save$/i });
    await expect(saveBtn, 'Save button not found').toBeVisible({ timeout: 5_000 });
    await saveBtn.click();
    await expect(
      page.getByText(/saved/i).first(),
      '"Saved" confirmation not shown after clicking Save',
    ).toBeVisible({ timeout: 10_000 });

    const useThisLlmBtn = configCard.getByRole('button', { name: /use this llm/i });
    if (await useThisLlmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await useThisLlmBtn.click();
    }
    const activeSummary = page.getByText(/active for chat:/i).locator('..');
    await expect(activeSummary).toContainText(/GitHub Copilot SDK/i, { timeout: 5_000 });
    await expect(activeSummary).toContainText(/claude-sonnet-4-6/i, { timeout: 5_000 });
    console.log('[spark] Settings — Anthropic claude-sonnet-4-6 configured and saved');

    // ── Step 2: Reload so the new provider is active ────────────────────────────
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    // ── Step 3: Open the AI Assistant chat panel ────────────────────────────────
    const chatOpener = page.locator('[aria-label*="chat" i], [aria-label*="assistant" i]')
      .or(page.getByRole('button', { name: /chat|ai assistant/i }))
      .or(page.getByTitle(/chat|assistant/i))
      .or(page.locator('a[href*="chat"], button').filter({ hasText: /chat/i }));
    await expect(chatOpener.first(), 'AI Assistant chat opener not found').toBeVisible({ timeout: 8_000 });
    await chatOpener.first().click();

    await expect(
      page.getByRole('heading', { name: /tavro ai assistant/i }),
      'AI Assistant panel did not open',
    ).toBeVisible({ timeout: 10_000 });
    const chatPanel = page.locator('textarea[placeholder*="Ask Tavro AI" i], textarea[placeholder*="Ask about" i]')
      .locator('xpath=ancestor::div[contains(@class, "flex-col")][1]');

    // ── Step 4: Send business impact question ───────────────────────────────────
    if (!agentName) {
      const { body: cat } = await apiGet(page, '/agents?start_record=1&record_range=1-10');
      agentName = cat?.data?.[0]?.agent_name ?? 'the agent';
    }
    const question = `What is the business impact if ${agentName} fails?`;
    const beforeText = await chatPanel.innerText().catch(() => '');

    const chatInput = page.locator('textarea[placeholder*="Ask Tavro AI" i], textarea[placeholder*="Ask about" i]').last();
    await expect(chatInput, 'Chat message input not found').toBeVisible({ timeout: 8_000 });
    await chatInput.fill(question);

    const sendBtn = page.getByRole('button', { name: /send/i })
      .or(page.locator('[aria-label="send" i], [title="send" i]'));
    if (await sendBtn.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
      await sendBtn.first().click();
    } else {
      await chatInput.press('Enter');
    }

    // ── Step 5: Verify assistant responds ──────────────────────────────────────
    await expect.poll(async () => {
      const text = await chatPanel.innerText().catch(() => '');
      return text.replace(beforeText, '').replace(question, '').trim().length;
    }, {
      message: 'AI Assistant returned no response text after the question',
      timeout: 60_000,
    }).toBeGreaterThan(25);

    await expect(chatPanel, 'AI Assistant returned an error message').not.toContainText(
      /something went wrong|did not receive a response|please check|failed|error/i,
      { timeout: 1_000 },
    );

    console.log('[spark] AI Assistant responded to business impact question');
  });

  // ── 18. Playground — open agent, navigate to Playground, interact via Azure ───

  test('18 — playground: open agent from catalog, navigate to Playground, select Azure Foundry, start session and interact', async ({ page }) => {
    requireRegisteredCompany();

    await page.goto('/catalog');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const agentCard = page.getByText(agentName, { exact: false }).first();
    await expect(agentCard, `Agent "${agentName}" not visible in catalog`).toBeVisible({ timeout: 10_000 });
    await agentCard.click();

    await page.waitForURL(/\/(catalog|agent(s)?)\/[^/]+/, { timeout: 10_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    const playgroundTab = page.getByRole('tab',   { name: /playground/i })
      .or(page.getByRole('link',   { name: /playground/i }))
      .or(page.getByRole('button', { name: /playground/i }));
    await expect(playgroundTab, 'Playground tab not found on agent detail').toBeVisible({ timeout: 8_000 });
    await playgroundTab.click();

    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    const azureCard = page.getByText(/azure foundry/i)
      .or(page.getByText(/azure/i).filter({ hasNot: page.getByText(/openai/i) }).first());
    await expect(azureCard, 'Azure Foundry provider card not visible').toBeVisible({ timeout: 8_000 });
    await azureCard.click();

    const startInteractBtn = page.getByRole('button', { name: /^start session and interact$/i });
    const startBtn = await startInteractBtn.isVisible().catch(() => false)
      ? startInteractBtn
      : page.getByRole('button', { name: /^start session$/i }).first();
    await expect(startBtn, '"Start session and interact" button not found').toBeVisible({ timeout: 8_000 });
    await startBtn.click();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await expect(page.getByText(/session active/i), 'Playground session did not become active').toBeVisible({ timeout: 10_000 });

    const msgInput = page.locator('input[placeholder*="message" i], input[placeholder*="agent" i]').last();
    await expect(msgInput, 'Message input not found in Playground').toBeVisible({ timeout: 10_000 });
    await msgInput.fill(`Generate synthetic data as required for the agent: ${agentName}`);

    const sendBtn = msgInput.locator('xpath=following-sibling::button[1]');
    await expect(sendBtn, 'Send button not found').toBeVisible({ timeout: 5_000 });
    await sendBtn.click();

    await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});

    const reply = page.locator('[data-role="assistant"]')
      .or(page.locator('.message-assistant, .assistant-message').last())
      .or(page.getByText(/synthetic data/i).last());
    await expect(reply, 'No assistant reply appeared in Playground').toBeVisible({ timeout: 45_000 });

    console.log('[spark] Playground Azure session completed successfully');
  });
});

// ── Help — User Guide ─────────────────────────────────────────────────────────

test.describe('Help — User Guide', () => {
  test('user guide link opens documentation in a new tab with content and working search', async ({ page }) => {
    await page.goto('/');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    // Scroll the left nav to the bottom so "Help" is in view
    const nav = page.locator('nav, [role="navigation"], aside').first();
    await nav.evaluate(el => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(300);

    // Find "Help" in the left nav — it is a direct link that opens the User Guide in a new tab
    const helpNavItem = page.locator('nav, [role="navigation"], aside')
      .locator('a, button, [role="link"], [role="menuitem"]')
      .filter({ hasText: /^help$/i })
      .first();
    await expect(helpNavItem, '"Help" not found in left nav').toBeVisible({ timeout: 8_000 });
    await helpNavItem.scrollIntoViewIfNeeded();

    // Click "Help" — this opens the User Guide in a new tab
    const [popup] = await Promise.all([
      page.context().waitForEvent('page'),
      helpNavItem.click(),
    ]);

    await popup.waitForLoadState('domcontentloaded', { timeout: 30_000 });

    // URL must be a valid http/https address
    const docUrl = popup.url();
    expect(docUrl, 'User Guide should open an external URL').toMatch(/^https?:\/\//);
    console.log(`[user-guide] Opened: ${docUrl}`);

    // Page must have substantial content
    const bodyText = await popup.locator('body').innerText({ timeout: 20_000 }).catch(() => '');
    expect(bodyText.length, 'User Guide page appears to be empty').toBeGreaterThan(100);

    // At least one heading must be present
    const headingCount = await popup.getByRole('heading').count();
    expect(headingCount, 'User Guide page should have at least one heading').toBeGreaterThan(0);
    console.log(`[user-guide] Page has content — ${headingCount} heading(s) found`);

    // Find the search bar on the User Guide page and search for something real
    const searchInput = popup.locator('input[type="search"]')
      .or(popup.locator('input[placeholder*="search" i]'))
      .or(popup.getByRole('searchbox'))
      .first();

    const searchVisible = await searchInput.isVisible({ timeout: 8_000 }).catch(() => false);
    if (searchVisible) {
      await searchInput.click();
      await searchInput.fill('spark');
      await popup.waitForTimeout(2_000);

      // Verify search results or suggestions appeared
      const resultsVisible =
        (await popup.getByRole('option').count()) > 0 ||
        (await popup.locator('[class*="result" i], [class*="search-hit" i], [class*="hit" i], [class*="suggestion" i]').count()) > 0 ||
        (await popup.getByText(/result|spark/i).first().isVisible({ timeout: 2_000 }).catch(() => false));

      expect(resultsVisible, 'No search results appeared after searching for "spark"').toBe(true);
      console.log('[user-guide] Search for "spark" returned results');
    } else {
      console.log('[user-guide] Search input not found on docs page — skipping search check');
    }

    await popup.close();
  });
});
