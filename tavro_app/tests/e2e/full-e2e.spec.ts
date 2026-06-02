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
  test('session is valid — JWT in localStorage', async ({ page }) => {
    await page.goto('/');

    // tavro_access_token may be an opaque token (no dots) — just verify it exists
    const accessToken = await getToken(page);
    expect(accessToken, 'Access token must not be the fake Playwright test token').not.toContain('playwright-fake-sig');

    // tavro_id_token is always a JWT in OIDC — use this for structure + expiry checks
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

// ── shared POST / upload helpers ──────────────────────────────────────────────

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

// ── Spark to Agent Playground E2E Testing ───────────────────────────────────

test.describe.serial('Spark to Agent Playground E2E Testing', () => {
  let useCaseId    = '';
  let agentId      = '';
  let agentName    = '';
  let processId    = '';
  let applicationId = '';
  let hasRegisteredCompany = false;
  let companyIds: string[] = [];
  let activeCompanyId = '';

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

  // ── 1. Blueprint — select a company ─────────────────────────────────────────

  test('1 — blueprint: select company from UI', async ({ page }) => {
    await page.goto('/blueprint');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    // Get available companies from API to know what to expect
    const { status, body } = await apiGet(page, '/companies');
    const companies: any[] = (status === 200 ? (Array.isArray(body) ? body : body.items ?? []) : []);
    console.log(`[spark] ${companies.length} company/companies available`);

    hasRegisteredCompany = companies.length > 0;
    companyIds = companies
      .map((company: any) => company.id ?? company.company_id)
      .filter((companyId: string | undefined): companyId is string => Boolean(companyId));

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length, 'Blueprint page rendered blank').toBeGreaterThan(0);

    if (!hasRegisteredCompany) {
      await page.goto('/spark');
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.getByText(noCompanyMessage, { exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole('button', { name: /inspire me/i })).toBeDisabled();
      throw new Error(noCompanyMessage);
    }

    activeCompanyId = (await page.evaluate(() => localStorage.getItem('tavro_active_company_id'))) ?? '';
    expect(activeCompanyId, 'Expected an active company to be selected before continuing Spark flow').toBeTruthy();
    console.log(`[spark] Active company ready — id: ${activeCompanyId}`);
  });

  // ── 2. Spark — Inspire Me ────────────────────────────────────────────────────

  test('2 — spark: click Inspire Me and wait for ideas to stream in', async ({ page }) => {
    requireRegisteredCompany();
    const orderedCompanyIds = [
      activeCompanyId,
      ...companyIds.filter(companyId => companyId !== activeCompanyId),
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
  });

  // ── 3. Select idea and convert to AI use case ────────────────────────────────

  test('3 — spark: open first idea modal and convert to AI use case', async ({ page }) => {
    requireRegisteredCompany();
    await page.goto('/spark');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    // If no ideas are visible, trigger Inspire Me first
    const viewBtn = page.getByRole('button', { name: /view.*develop|develop/i }).first();
    if (!(await viewBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      await page.getByRole('button', { name: /inspire me/i }).click();
      await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
    }

    await expect(viewBtn, '"View & Develop" not found — no ideas loaded').toBeVisible({ timeout: 20_000 });
    await viewBtn.click();

    // "Convert to Use Case" button appears after clicking View & Develop
    // (the modal does not use role="dialog" — locate the button directly on the page)
    const convertBtn = page.getByRole('button', { name: /convert to use case/i });
    await expect(convertBtn, '"Convert to Use Case" button not found after opening idea').toBeVisible({ timeout: 10_000 });
    console.log('[spark] Idea opened — clicking Convert to Use Case');
    await convertBtn.click();

    // App navigates to /use-case/{id} after creation
    await page.waitForURL(/\/use-?case[s]?\/[a-f0-9-]+/i, { timeout: 90_000 });

    const url   = page.url();
    const match = url.match(/\/use-?case[s]?\/([a-f0-9-]+)/i);
    expect(match, `Cannot extract use case ID from URL: ${url}`).toBeTruthy();
    useCaseId = match![1];
    console.log(`[spark] Use case created — id: ${useCaseId}, url: ${url}`);
  });

  // ── 4. Verify use case and agent exist ──────────────────────────────────────

  test('4 — verify use case exists in API and find linked Spark agent', async ({ page }) => {
    requireRegisteredCompany();
    await page.goto('/');
    const { status, body } = await apiGet(page, `/use-cases/${useCaseId}`);
    expect(status).toBe(200);

    const uc = body.data?.[0];
    expect(uc, 'Use case not found in API after Spark conversion').toBeTruthy();
    const ucTitle = uc.name ?? uc.title;
    expect(ucTitle, 'Use case has no title').toBeTruthy();
    console.log(`[spark] Use case verified — title: "${ucTitle}"`);

    // Find agent linked by Spark (the conversion creates + links an agent)
    const linked: any[] = uc.of_associated_agents ?? [];
    if (linked.length > 0) {
      agentId   = linked[0].agent_id;
      agentName = linked[0].agent_name;
    } else {
      // Fallback: most recent agent in catalog
      const { body: cat } = await apiGet(page, '/agents?start_record=1&record_range=1-10');
      expect(cat.data?.length, 'No agents in catalog after Spark conversion').toBeGreaterThan(0);
      agentId   = cat.data[0].agent_id;
      agentName = cat.data[0].agent_name;
    }
    expect(agentId, 'Agent ID not found').toBeTruthy();
    console.log(`[spark] Agent — id: ${agentId}, name: "${agentName}"`);
  });

  // ── 5. Create application and process ───────────────────────────────────────

  test('5 — create application and process via API', async ({ page }) => {
    requireRegisteredCompany();
    await page.goto('/');

    // Create application
    const { status: as, body: app } = await apiPost(page, '/applications', {
      application_name:     'Pearson VUE',
      vendor_name:          'Pearson VUE',
      business_criticality: 'Tier 1',
    });
    expect(as, `Application creation failed: ${JSON.stringify(app)}`).toBe(201);
    expect(app).toHaveProperty('business_application_id');
    applicationId = app.business_application_id;
    console.log(`[spark] Application created — id: ${applicationId}`);

    // Create process
    const { status: ps, body: proc } = await apiPost(page, '/processes', {
      process_name:        'Pearson VUE Process',
      process_description: 'Process created for Pearson VUE-generated use case',
    });
    expect(ps, `Process creation failed: ${JSON.stringify(proc)}`).toBe(201);
    expect(proc).toHaveProperty('business_process_id');
    processId = proc.business_process_id;
    console.log(`[spark] Process created — id: ${processId}`);
  });

  // ── 6. Link agent and use case to process and application ───────────────────

  test('6 — link agent to process', async ({ page }) => {
    requireRegisteredCompany();
    await page.goto('/');
    const { status, body } = await apiPut(page, `/agents/${agentId}/processes/${processId}`);
    expect([200, 201], `Agent→process link failed: ${JSON.stringify(body)}`).toContain(status);
    console.log(`[spark] Agent linked to process — status: ${body?.status ?? status}`);
  });

  test('7 — link use case to process', async ({ page }) => {
    requireRegisteredCompany();
    await page.goto('/');
    const { status, body } = await apiPost(page, `/use-cases/${useCaseId}/processes`, {
      process_id: processId,
    });
    expect(status, `Use case→process link failed: ${JSON.stringify(body)}`).toBe(200);
    expect(body.message).toContain('synchronized');
    expect(body.associated_count).toBeGreaterThanOrEqual(1);
  });

  test('8 — link agent to application', async ({ page }) => {
    requireRegisteredCompany();
    await page.goto('/');
    // PUT /agents/{agentId}/applications/{applicationId}
    const { status, body } = await apiPut(page, `/agents/${agentId}/applications/${applicationId}`);
    expect([200, 201], `Agent→application link failed (${status}): ${JSON.stringify(body)}`).toContain(status);
    console.log(`[spark] Agent linked to application`);
  });

  // ── 7. Verify all links ──────────────────────────────────────────────────────

  test('9 — verify use case has agent and process linked', async ({ page }) => {
    requireRegisteredCompany();
    await page.goto('/');
    const { status, body } = await apiGet(page, `/use-cases/${useCaseId}`);
    expect(status).toBe(200);
    const uc = body.data?.[0];
    expect(uc).toBeTruthy();

    const agents:    any[] = uc.of_associated_agents            ?? [];
    const processes: any[] = uc.of_associated_business_processes ?? [];

    expect(agents.some((a: any) => a.agent_id === agentId),
      `Agent ${agentId} not in linked agents: ${JSON.stringify(agents)}`).toBe(true);
    expect(processes.length, 'No process linked to use case').toBeGreaterThan(0);

    console.log(`[spark] Links verified — ${agents.length} agent(s), ${processes.length} process(es)`);
  });

  // ── 8. Settings — configure AI assistant provider ────────────────────────────

  test('10 — settings: configure Anthropic AI assistant and send business impact prompt', async ({ page }) => {
    requireRegisteredCompany();
    test.setTimeout(120_000);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    expect(apiKey, 'ANTHROPIC_API_KEY must be set in .env.e2e').toBeTruthy();

    // ── Step 1: Configure provider in Settings ──────────────────────────────
    await page.goto('/settings');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    // The heading has a known typo: "Assitant" not "Assistant" — match on the stable subtitle
    const settingsSection = page.getByText(/chat ai configuration/i);
    await expect(settingsSection, '"Chat AI Configuration" section not found on /settings').toBeVisible({ timeout: 8_000 });
    await settingsSection.scrollIntoViewIfNeeded();

    // Select provider: Anthropic (Claude) — native <select> dropdown
    const providerTypeLabel = page.locator('label').filter({ hasText: /^Provider Type$/i });
    const providerSelect = providerTypeLabel.locator('xpath=following-sibling::select[1]');
    await expect(providerSelect, 'Provider type <select> not found').toBeVisible({ timeout: 5_000 });
    await providerSelect.selectOption({ label: 'Anthropic (Claude)' });
    await page.waitForTimeout(500); // let the form re-render with Anthropic fields

    // Model defaults to claude-sonnet-4-6 after selecting Anthropic — verify it is set
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

    // Enter the Anthropic API key into the password field
    const apiKeyLabel = page.locator('label').filter({ hasText: /^Anthropic API Key$/i });
    await expect(apiKeyLabel, 'Anthropic API Key label not found after selecting provider').toBeVisible({ timeout: 5_000 });
    const configCard = apiKeyLabel.locator('xpath=ancestor::div[contains(@class, "border-2")][1]');
    const apiKeyInput = apiKeyLabel.locator('xpath=following-sibling::div[1]//input');
    await expect(apiKeyInput, 'Anthropic API key input not found').toBeVisible({ timeout: 5_000 });
    await apiKeyInput.clear();
    await apiKeyInput.fill(apiKey!);

    // Click Save
    const saveBtn = configCard.getByRole('button', { name: /^save$/i });
    await expect(saveBtn, 'Save button not found').toBeVisible({ timeout: 5_000 });
    await saveBtn.click();

    // Verify "Saved" badge/text confirms the key was accepted
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
    console.log('[spark] Settings saved — Anthropic claude-sonnet-4-6 configured');

    // ── Step 2: Refresh browser so the new provider is active ──────────────
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    // ── Step 3: Open the AI Assistant chat panel ────────────────────────────
    // Chat panel opens via the icon in the top-right corner of the app
    const chatOpener = page.locator('[aria-label*="chat" i], [aria-label*="assistant" i]')
      .or(page.getByRole('button', { name: /chat|ai assistant/i }))
      .or(page.getByTitle(/chat|assistant/i))
      .or(page.locator('a[href*="chat"], button').filter({ hasText: /chat/i }));
    await expect(chatOpener.first(), 'AI Assistant chat opener not found').toBeVisible({ timeout: 8_000 });
    await chatOpener.first().click();

    // Panel should open — wait for the greeting message
    await expect(
      page.getByRole('heading', { name: /tavro ai assistant/i }),
      'AI Assistant panel did not open after clicking chat icon',
    ).toBeVisible({ timeout: 10_000 });
    const chatPanel = page.locator('textarea[placeholder*="Ask Tavro AI" i], textarea[placeholder*="Ask about" i]')
      .locator('xpath=ancestor::div[contains(@class, "flex-col")][1]');
    console.log('[spark] AI Assistant panel opened');

    // ── Step 4: Send the business impact question ───────────────────────────
    if (!agentName) {
      const { body: cat } = await apiGet(page, '/agents?start_record=1&record_range=1-10');
      agentName = cat?.data?.[0]?.agent_name ?? 'the agent';
    }
    const question = `What is the business impact if ${agentName} fails?`;
    const beforeQuestionText = await chatPanel.innerText().catch(() => '');

    const chatInput = page.locator('textarea[placeholder*="Ask Tavro AI" i], textarea[placeholder*="Ask about" i]').last();
    await expect(chatInput, 'Chat message input not found').toBeVisible({ timeout: 8_000 });
    await chatInput.fill(question);

    // Send via button or Enter
    const sendBtn = page.getByRole('button', { name: /send/i })
      .or(page.locator('[aria-label="send" i], [title="send" i]'));
    if (await sendBtn.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
      await sendBtn.first().click();
    } else {
      await chatInput.press('Enter');
    }

    // ── Step 5: Verify assistant responds ──────────────────────────────────
    await expect.poll(async () => {
      const text = await chatPanel.innerText().catch(() => '');
      return text
        .replace(beforeQuestionText, '')
        .replace(question, '')
        .trim().length;
    }, {
      message: 'AI Assistant returned no response text after the question',
      timeout: 60_000,
    }).toBeGreaterThan(25);

    await expect(chatPanel, 'AI Assistant returned an error').not.toContainText(
      /something went wrong|did not receive a response|please check|failed|error/i,
      { timeout: 1_000 },
    );

    console.log('[spark] AI Assistant responded to business impact question');
  });

  // ── 9. Playground UI — Azure session ─────────────────────────────────────────

  test('11 — open agent in catalog, navigate to Playground, select Azure, interact', async ({ page }) => {
    requireRegisteredCompany();
    // Navigate to catalog and find the Spark-created agent
    await page.goto('/catalog');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    // Click the agent card to open detail view
    const agentCard = page.getByText(agentName, { exact: false }).first();
    await expect(agentCard, `Agent "${agentName}" not visible in catalog`).toBeVisible({ timeout: 10_000 });
    await agentCard.click();

    // Wait for agent detail page
    await page.waitForURL(/\/(catalog|agent(s)?)\/[^/]+/, { timeout: 10_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    // Click the Playground tab on the detail page
    const playgroundTab = page.getByRole('tab',   { name: /playground/i })
      .or(page.getByRole('link',   { name: /playground/i }))
      .or(page.getByRole('button', { name: /playground/i }));
    await expect(playgroundTab, 'Playground tab not found on agent detail').toBeVisible({ timeout: 8_000 });
    await playgroundTab.click();

    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    // Select Azure Foundry provider card
    const azureCard = page.getByText(/azure foundry/i)
      .or(page.getByText(/azure/i).filter({ hasNot: page.getByText(/openai/i) }).first());
    await expect(azureCard, 'Azure Foundry provider card not visible').toBeVisible({ timeout: 8_000 });
    await azureCard.click();

    // Start session from the configure CTA so the UI moves into the Interact tab.
    const startInteractBtn = page.getByRole('button', { name: /^start session and interact$/i });
    const startBtn = await startInteractBtn.isVisible().catch(() => false)
      ? startInteractBtn
      : page.getByRole('button', { name: /^start session$/i }).first();
    await expect(startBtn, '"Start session and interact" button not found').toBeVisible({ timeout: 8_000 });
    await startBtn.click();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await expect(page.getByText(/session active/i), 'Playground session did not become active').toBeVisible({ timeout: 10_000 });

    // Type the interaction prompt
    const msgInput = page.locator('input[placeholder*="message" i], input[placeholder*="agent" i]').last();
    await expect(msgInput, 'Message input not found in Playground').toBeVisible({ timeout: 10_000 });
    await msgInput.fill(`Generate synthetic data as required for the agent: ${agentName}`);

    // Send
    const sendBtn = msgInput.locator('xpath=following-sibling::button[1]');
    await expect(sendBtn, 'Send button not found').toBeVisible({ timeout: 5_000 });
    await sendBtn.click();

    // Wait for assistant response
    await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});

    // Verify a response appeared
    const reply = page.locator('[data-role="assistant"]')
      .or(page.locator('.message-assistant, .assistant-message').last())
      .or(page.getByText(/synthetic data/i).last());
    await expect(reply, 'No assistant reply appeared in Playground').toBeVisible({ timeout: 45_000 });

    console.log('[spark] Playground Azure session completed successfully');
  });
});
