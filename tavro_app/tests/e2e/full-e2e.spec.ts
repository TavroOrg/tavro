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

// ── Spark → AI Use Case — advanced flow ──────────────────────────────────────

test.describe.serial('Spark → AI Use Case — advanced flow', () => {
  let useCaseId    = '';
  let agentId      = '';
  let agentName    = '';
  let processId    = '';
  let applicationId = '';
  let sessionId    = '';

  const base = () => process.env.E2E_API_URL || process.env.E2E_BASE_URL || 'http://localhost:9000';

  async function authHeaders(page: Page): Promise<Record<string, string>> {
    const token    = await getToken(page);
    const tenantId = await getTenantId(page);
    const h: Record<string, string> = {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    if (tenantId) h['x-tenant-id'] = tenantId;
    return h;
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

    // Open the company selector dropdown (Building2 icon button in sidebar)
    const companyBtn = page.locator('button').filter({ hasText: /company|select/i }).first()
      .or(page.getByRole('button').filter({ has: page.locator('svg') }).first());

    if (await companyBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await companyBtn.click();
      await page.waitForTimeout(500);
      // Pick first option in the dropdown
      const firstOption = page.getByRole('option').first()
        .or(page.locator('li[role="option"]').first())
        .or(page.locator('[data-value]').first());
      if (await firstOption.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await firstOption.click();
        console.log('[spark] Company selected via UI dropdown');
      }
    }

    // Blueprint page must render without crashing
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length, 'Blueprint page rendered blank').toBeGreaterThan(0);
  });

  // ── 2. Spark — Inspire Me ────────────────────────────────────────────────────

  test('2 — spark: click Inspire Me and wait for ideas to stream in', async ({ page }) => {
    await page.goto('/spark');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    // Page must load
    await expect(page.getByRole('button', { name: /inspire me/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /inspire me/i }).click();

    // Ideas arrive as an SSE stream — wait up to 45 s for at least one card/row to appear
    await page.waitForSelector(
      '[data-testid="idea-card"], .idea-card, [class*="idea"], button:has-text("View")',
      { timeout: 45_000 },
    ).catch(() => {});

    // Fallback: wait for network to settle
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

    // Verify at least one idea is visible
    const hasIdeas =
      (await page.getByRole('button', { name: /view.*develop|develop/i }).count()) > 0 ||
      (await page.getByText(/complexity|estimated impact/i).count()) > 0;

    expect(hasIdeas, 'No ideas appeared after clicking Inspire Me').toBe(true);
    console.log('[spark] Ideas loaded successfully');
  });

  // ── 3. Select idea and convert to AI use case ────────────────────────────────

  test('3 — spark: open first idea modal and convert to AI use case', async ({ page }) => {
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
    await page.goto('/');

    // Create application
    const { status: as, body: app } = await apiPost(page, '/applications', {
      application_name:     'Spark E2E Test Application',
      vendor_name:          'E2E Test Vendor',
      business_criticality: 'Tier 1',
    });
    expect(as, `Application creation failed: ${JSON.stringify(app)}`).toBe(201);
    expect(app).toHaveProperty('business_application_id');
    applicationId = app.business_application_id;
    console.log(`[spark] Application created — id: ${applicationId}`);

    // Create process
    const { status: ps, body: proc } = await apiPost(page, '/processes', {
      process_name:        'Spark E2E Test Process',
      process_description: 'Process created for Spark-generated use case E2E testing',
    });
    expect(ps, `Process creation failed: ${JSON.stringify(proc)}`).toBe(201);
    expect(proc).toHaveProperty('business_process_id');
    processId = proc.business_process_id;
    console.log(`[spark] Process created — id: ${processId}`);
  });

  // ── 6. Link agent and use case to process and application ───────────────────

  test('6 — link agent to process', async ({ page }) => {
    await page.goto('/');
    const { status, body } = await apiPut(page, `/agents/${agentId}/processes/${processId}`);
    expect([200, 201], `Agent→process link failed: ${JSON.stringify(body)}`).toContain(status);
    console.log(`[spark] Agent linked to process — status: ${body?.status ?? status}`);
  });

  test('7 — link use case to process', async ({ page }) => {
    await page.goto('/');
    const { status, body } = await apiPost(page, `/use-cases/${useCaseId}/processes`, {
      process_id: processId,
    });
    expect(status, `Use case→process link failed: ${JSON.stringify(body)}`).toBe(200);
    expect(body.message).toContain('synchronized');
    expect(body.associated_count).toBeGreaterThanOrEqual(1);
  });

  test('8 — link agent to application', async ({ page }) => {
    await page.goto('/');
    // PUT /agents/{agentId}/applications/{applicationId}
    const { status, body } = await apiPut(page, `/agents/${agentId}/applications/${applicationId}`);
    expect([200, 201], `Agent→application link failed (${status}): ${JSON.stringify(body)}`).toContain(status);
    console.log(`[spark] Agent linked to application`);
  });

  // ── 7. Verify all links ──────────────────────────────────────────────────────

  test('9 — verify use case has agent and process linked', async ({ page }) => {
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

  // ── 8. AI assistant — business impact prompt ─────────────────────────────────

  test('10 — AI assistant: ask what happens if agent fails', async ({ page }) => {
    await page.goto('/');
    const headers = await authHeaders(page);

    // Create a playground session (uses ANTHROPIC_API_KEY on the backend)
    const sessRes = await page.request.post(`${base()}/api/v1/playground/session`, {
      headers,
      data: {
        agent_name:    agentName,
        system_prompt: `You are a business analyst. Answer questions about the AI agent: ${agentName}.`,
        provider:      'anthropic',
        model:         'claude-sonnet-4-6',
        temperature:   0.7,
        max_tokens:    512,
      },
    });
    expect([200, 201], `Session creation failed: ${sessRes.status()}`).toContain(sessRes.status());
    const session = await sessRes.json().catch(() => ({}));
    sessionId = session.session_id;
    expect(sessionId, 'No session_id in response').toBeTruthy();
    console.log(`[spark] Playground session created — id: ${sessionId}`);

    // Send the business impact question
    const msgRes = await page.request.post(
      `${base()}/api/v1/playground/session/${sessionId}/message`,
      {
        headers,
        data: { content: `What is the business impact if ${agentName} fails?` },
      },
    );
    expect([200, 201], `Message send failed: ${msgRes.status()}`).toContain(msgRes.status());
    const msg = await msgRes.json().catch(() => ({}));

    const reply = msg.content ?? msg.response ?? '';
    expect(reply, 'AI assistant returned empty response').toBeTruthy();
    expect(reply.length, 'AI response too short to be meaningful').toBeGreaterThan(20);
    console.log(`[spark] AI response: ${reply.slice(0, 120)}...`);
  });

  // ── 9. Playground UI — Azure session ─────────────────────────────────────────

  test('11 — open agent in catalog, navigate to Playground, select Azure, interact', async ({ page }) => {
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

    // Start session
    const startBtn = page.getByRole('button', { name: /start session/i });
    await expect(startBtn, '"Start Session" button not found').toBeVisible({ timeout: 8_000 });
    await startBtn.click();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    // Type the interaction prompt
    const msgInput = page.getByRole('textbox').last()
      .or(page.locator('textarea').last())
      .or(page.locator('[placeholder*="message" i], [placeholder*="type" i]').first());
    await expect(msgInput, 'Message input not found in Playground').toBeVisible({ timeout: 10_000 });
    await msgInput.fill(`Generate synthetic data as required for the agent: ${agentName}`);

    // Send
    const sendBtn = page.getByRole('button', { name: /send/i })
      .or(page.locator('[aria-label="send" i]'))
      .or(page.getByTitle(/send/i));
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
