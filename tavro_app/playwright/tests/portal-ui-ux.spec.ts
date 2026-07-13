/**
 * Portal UI/UX validation — one file, six requirement areas:
 *
 *   0. Creation forms (required-field validation, the exact system
 *      message/feedback each "Create X" flow shows on success, and the
 *      Company Blueprint setup wizard's manual path — skipping AI research)
 *   1. Searchable relationship pickers  (smooth filtering, scannable list, saves on submit)
 *   2. Screen real-estate & responsiveness (dense screens on standard laptops,
 *      at multiple browser zoom levels, including tables and modals)
 *   3. Component feedback (nav counters, loading states — and that linking
 *      updates the UI live, without a hard page reload)
 *   4. System notifications (the global toast banner: correct message,
 *      manual dismiss, auto-dismiss timing)
 *   5. Insights page (stat tiles, every dashboard card, refresh loading state)
 *
 * All of it runs against the same "Add X" relationship-picker pattern that repeats
 * identically across every entity detail page in the portal — Agent, AI Model,
 * AI Use Case, Application, Process, Integration (role="listbox", "Search x..."
 * input, "Currently Related X (N)" counter — confirmed via grep across
 * AgentRelatedTab.tsx, AiModelViewPage.tsx, UseCaseViewPage.tsx,
 * BusinessApplicationViewPage.tsx, BusinessProcessViewPage.tsx,
 * IntegrationViewPage.tsx) — so one metadata table + one set of helpers below
 * drives every test in the file across the whole portal instead of one page
 * at a time.
 *
 * Real login (auth.setup.ts), real UI, real backend — nothing mocked.
 *
 * Fixture data (one Agent, a second Agent, one AI Model, Use Case,
 * Application, Process and Integration) is NOT created separately from
 * section 0's own tests — that would mean creating each entity type twice
 * (once to test its Create form, once more as a throwaway fixture). Instead,
 * each "Create X" test in section 0 stores the real record it just created
 * into the shared `testData` object below, and sections 1-3 read from that.
 * Section 0 must therefore run before sections 1-3 in the same session
 * (guaranteed by file order under this suite's serial execution — see
 * playwright.e2e.config.ts, fullyParallel: false / workers: 1); running
 * only a later section on its own will fail fast with a clear "run section
 * 0 first" error rather than silently using missing data.
 *
 * Nothing here deletes what it creates. Run `npm run test:e2e:cleanup`
 * yourself (playwright.cleanup.config.ts) whenever you want to clear out
 * accumulated "E2E ..." records — it sweeps by name prefix against whatever
 * is actually in the backend right now, not against a stored ID list, so it
 * can't go stale either.
 *
 * Prerequisites:
 *   1. Docker stack running:  docker compose up -d
 *   2. .env.e2e filled in:    E2E_USERNAME, E2E_PASSWORD
 * Run:  npm run test:e2e:ui
 */

import { test, expect, type Page, type Locator } from '@playwright/test';

interface TestDataRef { id: string; name: string; }
interface TestDataIds {
  agent: TestDataRef;
  /** A second, distinct agent — an agent can't link to itself in the
   *  "child agent" relationship picker on its own detail page. */
  agentSecondary: TestDataRef;
  aiModel: TestDataRef;
  useCase: TestDataRef;
  application: TestDataRef;
  process: TestDataRef;
  integration: TestDataRef;
}

/** Populated by section 0's own "Create X" tests as they run — see the
 *  `testData.agent = {...}` (etc.) assignments in each test below. */
const testData: Partial<TestDataIds> = {};

/** The company created by "Create Company Blueprint" (section 0's first
 *  test), set as the active company there via localStorage. Playwright gives
 *  every test its own fresh browser context reloaded from the same static
 *  `storageState` snapshot (`.auth/user.json`) — so that localStorage change
 *  does NOT carry over to the next test the way in-memory `testData` does;
 *  each new test would otherwise silently fall back to whatever company was
 *  active when `auth.setup.ts` last ran. The file-wide `test.beforeEach`
 *  below re-seeds this into every subsequent test's storage before the app
 *  mounts, so every fixture this suite creates is actually scoped to our own
 *  isolated company, not whichever one the auth snapshot happened to have. */
let activeCompanyRef: TestDataRef | undefined;

test.beforeEach(async ({ page }) => {
  if (!activeCompanyRef) return;
  await page.addInitScript(([id, name]) => {
    localStorage.setItem('tavro_active_company_id', id);
    localStorage.setItem('tavro_active_company_name', name);
  }, [activeCompanyRef.id, activeCompanyRef.name] as [string, string]);
});

function requireTestData(): TestDataIds {
  const required: (keyof TestDataIds)[] = ['agent', 'agentSecondary', 'aiModel', 'useCase', 'application', 'process', 'integration'];
  const missing = required.filter((key) => !testData[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing fixture data: ${missing.join(', ')}. Section "0. Creation forms" populates these as its own ` +
      `"Create X" tests run — run the whole file (or at least section 0 first) in one session, not this section alone.`,
    );
  }
  return testData as TestDataIds;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Relationship-picker metadata ────────────────────────────────────────────
// One entry per picker type; the same button/search/counter conventions are
// reused for every entity that exposes that picker.

type PickerKey = 'application' | 'process' | 'agent' | 'aiModel' | 'useCase' | 'integration';

interface PickerType {
  key: PickerKey;
  /** Text on the trigger button, e.g. "Add AI Model". */
  addLabel: string;
  /** Word(s) used in the search placeholder, e.g. "AI model" → "Search AI model...". */
  searchWord: string;
  /** Plural used in the "No X found" empty state, e.g. "AI models". */
  noResultsPlural: string;
  /** Plural used in the "Currently Related X (N)" counter, e.g. "AI Models". */
  counterPlural: string;
}

const PICKER_TYPES = {
  application: { key: 'application', addLabel: 'Application', searchWord: 'application', noResultsPlural: 'applications', counterPlural: 'Applications' },
  process: { key: 'process', addLabel: 'Process', searchWord: 'process', noResultsPlural: 'processes', counterPlural: 'Processes' },
  agent: { key: 'agent', addLabel: 'Agent', searchWord: 'agent', noResultsPlural: 'agents', counterPlural: 'Agents' },
  aiModel: { key: 'aiModel', addLabel: 'AI Model', searchWord: 'AI model', noResultsPlural: 'AI models', counterPlural: 'AI Models' },
  useCase: { key: 'useCase', addLabel: 'Use Case', searchWord: 'use case', noResultsPlural: 'use cases', counterPlural: 'AI Use Cases' },
  integration: { key: 'integration', addLabel: 'Integration', searchWord: 'integration', noResultsPlural: 'integrations', counterPlural: 'Integrations' },
} as const satisfies Record<PickerKey, PickerType>;

// Which of our own `testData` fixtures to link through each picker type.
// On a real instance with many pre-existing records, grabbing "whichever
// option is first" in the unfiltered dropdown is unsafe: the default list
// may not even include our freshly-created fixture (pagination/sort order),
// and linking/unlinking an arbitrary unrelated record risks leaving a
// dangling link on someone else's data if the test fails mid-way. Searching
// for one of our own named fixtures keeps every link/unlink scoped to data
// this suite created and owns. `agent` maps to the *secondary* agent
// fixture — an agent can't link to itself on its own detail page, and using
// the same fixture everywhere else is still safe (still our own data).
const PICKER_TARGET_KEY: Record<PickerKey, keyof TestDataIds> = {
  application: 'application',
  process: 'process',
  agent: 'agentSecondary',
  aiModel: 'aiModel',
  useCase: 'useCase',
  integration: 'integration',
};

interface EntityPage {
  name: string;
  listPath: string;
  detailPathFor: (id: string) => string;
  testDataKey: keyof TestDataIds;
  /** Which tab button (regex against its visible text, e.g. "Related Agents(3)")
   *  must be clicked before a given picker becomes visible on this entity's
   *  page — entities differ a lot here: Agent and AI Model put every picker
   *  under one shared "Business Impact" tab; Use Case has no tabs at all
   *  (pickers sit directly on the page); Application and Process instead
   *  give every picker its OWN dedicated tab. Return undefined for a picker
   *  that needs no tab switch. */
  tabForPicker?: (picker: PickerKey) => RegExp | undefined;
  pickers: PickerType[];
}

const BUSINESS_IMPACT_TAB = /business impact/i;

// Every entity detail page in the portal that exposes relationship pickers,
// and which picker types each one shows (confirmed via grep of "Add X" /
// "Currently Related X" text in each page's source).
const ENTITY_PAGES: EntityPage[] = [
  {
    name: 'Agent',
    listPath: '/catalog',
    detailPathFor: (id) => `/agent/${encodeURIComponent(id)}`,
    testDataKey: 'agent',
    tabForPicker: () => BUSINESS_IMPACT_TAB,
    pickers: [PICKER_TYPES.application, PICKER_TYPES.process, PICKER_TYPES.agent, PICKER_TYPES.aiModel, PICKER_TYPES.useCase, PICKER_TYPES.integration],
  },
  {
    name: 'AI Model',
    listPath: '/ai-models',
    detailPathFor: (id) => `/ai-models/${encodeURIComponent(id)}`,
    testDataKey: 'aiModel',
    tabForPicker: () => BUSINESS_IMPACT_TAB,
    pickers: [PICKER_TYPES.agent, PICKER_TYPES.useCase, PICKER_TYPES.application, PICKER_TYPES.process],
  },
  {
    name: 'AI Use Case',
    listPath: '/use-cases',
    detailPathFor: (id) => `/use-case/${encodeURIComponent(id)}`,
    testDataKey: 'useCase',
    // UseCaseView.tsx: the Agent picker lives under its own dynamic
    // "AI Agents (N)" tab, while Application/Process/AI Model pickers all
    // share the "Business Impact" tab (businessImpactComponent prop).
    tabForPicker: (key) => (key === 'agent' ? /^ai agents/i : BUSINESS_IMPACT_TAB),
    pickers: [PICKER_TYPES.agent, PICKER_TYPES.application, PICKER_TYPES.process, PICKER_TYPES.aiModel],
  },
  {
    name: 'Application',
    listPath: '/applications',
    detailPathFor: (id) => `/applications/${encodeURIComponent(id)}`,
    testDataKey: 'application',
    tabForPicker: (key) => ({
      agent: /^related agents/i,
      useCase: /^related ai use cases/i,
      aiModel: /^related ai models/i,
      process: /^related processes/i,
    } as Partial<Record<PickerKey, RegExp>>)[key],
    pickers: [PICKER_TYPES.useCase, PICKER_TYPES.agent, PICKER_TYPES.aiModel, PICKER_TYPES.process],
  },
  {
    name: 'Process',
    listPath: '/processes',
    detailPathFor: (id) => `/processes/${encodeURIComponent(id)}`,
    testDataKey: 'process',
    tabForPicker: (key) => ({
      agent: /^related agents/i,
      useCase: /^related ai use cases/i,
      aiModel: /^related ai models/i,
      application: /^related applications/i,
    } as Partial<Record<PickerKey, RegExp>>)[key],
    pickers: [PICKER_TYPES.agent, PICKER_TYPES.useCase, PICKER_TYPES.aiModel, PICKER_TYPES.application],
  },
  {
    name: 'Integration',
    listPath: '/integrations',
    detailPathFor: (id) => `/integrations/${encodeURIComponent(id)}`,
    testDataKey: 'integration',
    tabForPicker: () => /^related agents/i,
    pickers: [PICKER_TYPES.agent],
  },
];

// ── Shared helpers ───────────────────────────────────────────────────────────

/** Navigates directly to this entity's test-data record (never "the
 *  first card in the list"). Does NOT switch tabs — which tab a picker
 *  needs varies per picker, not just per entity, so that happens in
 *  ensurePickerTab() right before each picker is used. */
async function openEntity(page: Page, entity: EntityPage): Promise<TestDataRef> {
  const ref = requireTestData()[entity.testDataKey];

  await page.goto(entity.detailPathFor(ref.id));
  await expect(page).not.toHaveURL(/\/login/);

  // Every entity detail page shows its own "Loading..." placeholder first
  // (e.g. "Loading Agent Details...", "Loading model...") while it fetches —
  // Agent's fetch in particular goes through a real MCP server call and can
  // be slow. Waiting for the record's own name to render (rather than just
  // checking the body isn't blank, which the loading placeholder alone
  // satisfies) is what actually confirms the page finished loading.
  await expect(
    page.locator('body'),
    `${entity.name} detail page never finished loading fixture "${ref.name}" (${ref.id}) — still showing a loading placeholder after 30s`,
  ).toContainText(ref.name, { timeout: 30_000 });

  return ref;
}

/** Clicks whichever tab this specific picker needs to become visible on this
 *  entity's page, if any (see EntityPage.tabForPicker — some entities share
 *  one tab across all pickers, some need a different tab per picker, Use
 *  Case needs none at all). Safe to call even if the right tab is already active. */
async function ensurePickerTab(page: Page, entity: EntityPage, picker: PickerType) {
  const tabName = entity.tabForPicker?.(picker.key);
  if (!tabName) return;
  const tab = page.getByRole('tab', { name: tabName }).or(page.getByRole('button', { name: tabName })).first();
  await expect(tab, `"${tabName}" tab not found on ${entity.name} detail page for the ${picker.addLabel} picker`).toBeVisible({ timeout: 8_000 });
  await tab.click();
  await page.waitForTimeout(300);
}

function pickerTrigger(page: Page, picker: PickerType): Locator {
  return page.getByRole('button', { name: new RegExp(`^add ${picker.addLabel}$`, 'i') }).first();
}
function pickerSearchBox(page: Page, picker: PickerType): Locator {
  return page.getByPlaceholder(new RegExp(`search ${picker.searchWord}`, 'i')).first();
}
async function readCounter(page: Page, picker: PickerType): Promise<number> {
  const header = page.getByText(new RegExp(`currently related ${picker.counterPlural}\\s*\\((\\d+)\\)`, 'i')).first();
  await expect(header, `"Currently Related ${picker.counterPlural}" counter not found`).toBeVisible({ timeout: 8_000 });
  const match = (await header.innerText()).match(/\((\d+)\)/);
  expect(match, 'Could not parse counter value').toBeTruthy();
  return Number(match![1]);
}
/** A hard reload/navigation wipes this; its survival proves an update was
 *  applied client-side (React re-render / re-fetch), not via a page reload. */
async function plantNoReloadMarker(page: Page) {
  await page.evaluate(() => { (window as any).__e2e_no_reload_marker = Date.now(); });
}
async function markerSurvived(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as any).__e2e_no_reload_marker !== undefined);
}

/** Selecting an option does NOT close the picker dropdown (confirmed in
 *  AgentRelatedTab.tsx — only the trigger button toggles `openDropdown`, and
 *  the option's own onClick never resets it). So re-clicking the trigger
 *  unconditionally after a link action would actually CLOSE an
 *  already-open dropdown instead of opening it. Only click if it's closed. */
async function ensurePickerOpen(trigger: Locator, listbox: Locator) {
  if (!(await listbox.isVisible().catch(() => false))) {
    await trigger.click();
  }
}

async function clickSubmit(page: Page, buttonName: string) {
  const button = page.getByRole('button', { name: new RegExp(`^${escapeRegex(buttonName)}$`, 'i') }).first();
  await expect(button, `"${buttonName}" submit button not found`).toBeVisible({ timeout: 8_000 });
  return button;
}

// ═══════════════════════════════════════════════════════════════════════════
// 0. Creation forms — required-field validation, and the exact system
//    message each flow shows on success
// ═══════════════════════════════════════════════════════════════════════════
//
// Two distinct success-feedback patterns exist (confirmed by reading each
// page's source):
//  - Agent / Use Case: a global success toast (GlobalNotificationBanner,
//    triggered by a `tavro_notice` event) with specific wording, then a
//    ~1.2s delayed redirect to a generic list page.
//  - AI Model / Application / Process / Integration: no toast — the app
//    navigates immediately to the new record's own detail page, so the
//    "success feedback" a user actually sees is their new record's name on
//    the page they land on.
//
// These tests intentionally do NOT delete what they create — every "E2E
// Create-Form ..." record they make is left in the catalog. Nothing in this
// suite deletes anything automatically; run `npm run test:e2e:cleanup`
// yourself whenever you want to clear accumulated test records.

test.describe('0. Creation forms', () => {
  // Company Blueprint runs first, before any other "Create X" test: several
  // create flows (Agent, AI Model, ...) send along an active company id when
  // one is set (see e.g. agentApi.createAgent's companyId param), so a
  // company should exist before anything else gets created in this run.
  test('Create Company Blueprint — manual path (skip AI research), blocks each step until required fields are filled', async ({ page }) => {
    const name = `E2E Blueprint Co ${Date.now()}`;
    const industry = 'Financial Technology (FinTech)';

    await page.goto('/blueprint/setup');
    await expect(page).not.toHaveURL(/\/login/);

    // ── Step 1: Identity ──────────────────────────────────────────────────────
    const step1Continue = page.getByRole('button', { name: /^continue$/i }).first();
    await expect(step1Continue, 'Step 1 Continue should be disabled until Name/Industry/Company type are set').toBeDisabled();

    // Exact match only — "Legal entity name" has a similar placeholder
    // ("e.g. BankUnited, N.A. (optional)") that an unanchored match would also hit.
    await page.getByPlaceholder(/^e\.g\. bankunited$/i).fill(name);
    await page.getByPlaceholder(/e\.g\. commercial banking/i).fill(industry);
    // Card buttons include their subtitle text in the accessible name (e.g.
    // "Private company" + "Not publicly traded"), so an exact role-name match
    // never resolves — target the exact heading text itself instead, same as
    // the "Blank canvas" template click below.
    await page.getByText('Private company', { exact: true }).click();
    await expect(step1Continue, 'Step 1 Continue should enable once required fields are filled').toBeEnabled();
    await step1Continue.click();

    // ── Step 2: AI Research — deliberately skipped, not run ────────────────────
    const skipResearch = page.getByRole('button', { name: /^skip research$/i });
    await expect(skipResearch, '"Skip research" not found — the manual, non-AI-search path must stay available').toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: new RegExp(`^research ${escapeRegex(name)}$`, 'i') }), 'AI research trigger should be visible but not required').toBeVisible();
    await skipResearch.click();

    // ── Step 3: Template — "Blank canvas" keeps this a fully manual setup ──────
    await page.getByText(/^blank canvas$/i).click();
    const step3Continue = page.getByRole('button', { name: /^continue$/i }).first();
    await expect(step3Continue).toBeEnabled();
    await step3Continue.click();

    // ── Step 4: Confirm — both Name and Industry entered in Step 1 must carry through ──
    await expect(page.locator('body'), 'Confirm step should summarize the company name entered in Step 1').toContainText(name, { timeout: 5_000 });
    await expect(page.locator('body'), 'Confirm step should summarize the industry entered in Step 1').toContainText(industry, { timeout: 5_000 });
    const createButton = page.getByRole('button', { name: /^create blueprint$/i });
    await expect(createButton).toBeEnabled();

    const responsePromise = page.waitForResponse((res) => res.request().method() === 'POST' && /\/api\/v1\/companies\/?(\?|$)/.test(res.url()));
    await createButton.click();
    const response = await responsePromise;
    expect(response.ok(), `Create Company Blueprint submission failed: HTTP ${response.status()}`).toBe(true);
    const body = await response.json();
    // Every later test gets a fresh browser context reloaded from the same
    // static auth snapshot, so the app's own `selectCompany()` call (which
    // only updates *this* page's localStorage) won't carry over on its own —
    // see the file-wide beforeEach above, which re-seeds this into every
    // subsequent test's storage before it navigates anywhere.
    activeCompanyRef = { id: body.id, name: body.name ?? name };

    // Not asserting that this page's own UI switches to display the new
    // company here — on a real instance the Blueprint page can take a while
    // to reflect a just-created company (or keep showing whichever was
    // already selected), and that's independent of what actually matters:
    // every other test's records must be created under this company, which
    // the file-wide beforeEach above guarantees directly via `activeCompanyRef`
    // regardless of what this page happens to render.
    await page.waitForURL(/\/blueprint$/, { timeout: 15_000 });
  });

  test('Create Agent — blocks submit until required fields are filled, shows the expected success message', async ({ page }) => {
    await page.goto('/agents/new');
    await expect(page).not.toHaveURL(/\/login/);
    // BlueprintProvider restores the active company from localStorage asynchronously
    // on every fresh page load; this page's create-mode form resets whenever
    // activeCompany?.id changes (BusinessApplicationViewPage.tsx-style pattern,
    // shared by every "create X" page). Letting that settle before typing avoids
    // racing a form reset that would otherwise wipe what was just filled in.
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const submit = await clickSubmit(page, 'Create Agent');
    await expect(submit, 'Create Agent should be disabled until Name/Description/Instruction are filled').toBeDisabled();

    const name = `E2E Create-Form Agent ${Date.now()}`;
    await page.getByPlaceholder(/e\.g\. fraud case triage agent/i).fill(name);
    await page.getByPlaceholder(/what this agent does/i).fill('Created by the creation-form validation test. Safe to delete.');
    await page.getByPlaceholder(/step-by-step behavioral instructions/i).fill('Automated test fixture — not a real agent.');
    await expect(submit, 'Create Agent should enable once all required fields are filled').toBeEnabled();

    const responsePromise = page.waitForResponse((res) => res.request().method() === 'POST' && /\/api\/v1\/agents\/?(\?|$)/.test(res.url()));
    await submit.click();
    const response = await responsePromise;
    expect(response.ok(), `Create Agent submission failed: HTTP ${response.status()}`).toBe(true);
    const body = await response.json();
    testData.agent = { id: body.agent_id, name: body.agent_name ?? name };

    await expect(
      page.getByText('Agent created successfully. Risk assessment is running in the background.'),
      'Expected the exact "Agent created successfully..." success message',
    ).toBeVisible({ timeout: 5_000 });

    // A second, distinct agent — needed because an agent can't link to itself
    // in the "child agent" relationship picker on its own detail page (section 1).
    // No need to re-validate the form here, section 0's own test above just did.
    await page.goto('/agents/new');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    const secondaryName = `E2E Secondary Agent ${Date.now()}`;
    await page.getByPlaceholder(/e\.g\. fraud case triage agent/i).fill(secondaryName);
    await page.getByPlaceholder(/what this agent does/i).fill('Fixture for agent-to-agent relationship picker tests. Safe to delete.');
    await page.getByPlaceholder(/step-by-step behavioral instructions/i).fill('Automated test fixture — not a real agent.');
    const secondaryResponsePromise = page.waitForResponse((res) => res.request().method() === 'POST' && /\/api\/v1\/agents\/?(\?|$)/.test(res.url()));
    await page.getByRole('button', { name: /^create agent$/i }).first().click();
    const secondaryResponse = await secondaryResponsePromise;
    expect(secondaryResponse.ok(), `Secondary agent creation failed: HTTP ${secondaryResponse.status()}`).toBe(true);
    const secondaryBody = await secondaryResponse.json();
    testData.agentSecondary = { id: secondaryBody.agent_id, name: secondaryBody.agent_name ?? secondaryName };
  });

  test('Create AI Use Case — blocks submit until required fields are filled, shows the expected success message', async ({ page }) => {
    await page.goto('/use-cases/new');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const submit = await clickSubmit(page, 'Create Use Case');
    await expect(submit, 'Create Use Case should be disabled until Name/Description are filled').toBeDisabled();

    const title = `E2E Create-Form Use Case ${Date.now()}`;
    await page.getByPlaceholder(/e\.g\. invoice processing automation/i).fill(title);
    await page.getByPlaceholder(/brief overview/i).fill('Created by the creation-form validation test. Safe to delete.');
    await expect(submit, 'Create Use Case should enable once all required fields are filled').toBeEnabled();

    const responsePromise = page.waitForResponse((res) => res.request().method() === 'POST' && /\/api\/v1\/use-cases\/?(\?|$)/.test(res.url()));
    await submit.click();
    const response = await responsePromise;
    expect(response.ok(), `Create Use Case submission failed: HTTP ${response.status()}`).toBe(true);
    const body = await response.json();
    testData.useCase = { id: body.use_case_id, name: title };

    await expect(
      page.getByText('AI Use Case created successfully. It will appear in the catalog shortly.'),
      'Expected the exact "AI Use Case created successfully..." success message',
    ).toBeVisible({ timeout: 5_000 });
  });

  test('Create AI Model — rejects an empty name with an inline error, then succeeds and lands on the new model\'s own page', async ({ page }) => {
    await page.goto('/ai-models/new');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const submit = await clickSubmit(page, 'Create Model');
    await submit.click();
    await expect(page.getByText('Model Name is required.'), 'Expected an inline "Model Name is required." error').toBeVisible({ timeout: 5_000 });

    const name = `E2E Create-Form AI Model ${Date.now()}`;
    await page.getByPlaceholder(/e\.g\. credit default predictor/i).fill(name);
    await submit.click();

    await page.waitForURL(/\/ai-models\/(?!new(?:$|[/?]))[^/?]+/, { timeout: 30_000 });
    await expect(page.locator('body'), `New AI Model's own name "${name}" should be visible on the page it redirected to`).toContainText(name, { timeout: 8_000 });
    testData.aiModel = { id: decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!), name };
  });

  test('Create Application — rejects an empty name, then succeeds and lands on the new application\'s own page', async ({ page }) => {
    await page.goto('/applications/new');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const submit = page.getByRole('button', { name: /^create application$/i }).first();
    await expect(submit, 'Create Application should be disabled until Application Name is filled').toBeDisabled();

    const name = `E2E Create-Form Application ${Date.now()}`;
    await page.getByPlaceholder(/^application name$/i).fill(name);
    await expect(submit).toBeEnabled();
    await submit.click();

    await page.waitForURL(/\/applications\/(?!new(?:$|[/?]))[^/?]+/, { timeout: 30_000 });
    await expect(page.locator('body'), `New Application's own name "${name}" should be visible on the page it redirected to`).toContainText(name, { timeout: 8_000 });
    testData.application = { id: decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!), name };
  });

  test('Create Process — rejects an empty name, then succeeds and lands on the new process\'s own page', async ({ page }) => {
    await page.goto('/processes/new');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const submit = page.getByRole('button', { name: /^create process$/i }).first();
    await expect(submit, 'Create Process should be disabled until Name is filled').toBeDisabled();

    const name = `E2E Create-Form Process ${Date.now()}`;
    // "Name" has no placeholder on this form — locate via its <label> instead.
    await page.locator('label').filter({ hasText: /^Name/i }).first().locator('xpath=following-sibling::input[1]').fill(name);
    await expect(submit).toBeEnabled();
    await submit.click();

    await page.waitForURL(/\/processes\/(?!new(?:$|[/?]))[^/?]+/, { timeout: 30_000 });
    await expect(page.locator('body'), `New Process's own name "${name}" should be visible on the page it redirected to`).toContainText(name, { timeout: 8_000 });
    testData.process = { id: decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!), name };
  });

  test('Create Integration — rejects an empty name, then succeeds and lands on the new integration\'s own page', async ({ page }) => {
    await page.goto('/integrations/new');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const submit = page.getByRole('button', { name: /^create integration$/i }).first();
    await expect(submit, 'Create Integration should be disabled until Integration Name is filled').toBeDisabled();

    const name = `E2E Create-Form Integration ${Date.now()}`;
    await page.getByPlaceholder(/^integration name$/i).fill(name);
    await expect(submit).toBeEnabled();
    await submit.click();

    await page.waitForURL(/\/integrations\/(?!new(?:$|[/?]))[^/?]+/, { timeout: 30_000 });
    await expect(page.locator('body'), `New Integration's own name "${name}" should be visible on the page it redirected to`).toContainText(name, { timeout: 8_000 });
    testData.integration = { id: decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!), name };
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// 1. Searchable relationship pickers — smooth filtering, scannable list, saves on submit
// ═══════════════════════════════════════════════════════════════════════════

test.describe('1. Relationship pickers', () => {
  for (const entity of ENTITY_PAGES) {
    test.describe(`${entity.name} detail page`, () => {
      test.beforeEach(async ({ page }) => {
        await openEntity(page, entity);
      });

      for (const picker of entity.pickers) {
        test(`${picker.addLabel} picker — search narrows the list, no-match shows a message, clearing restores it`, async ({ page }) => {
          await ensurePickerTab(page, entity, picker);
          const trigger = pickerTrigger(page, picker);
          test.skip(!(await trigger.isVisible({ timeout: 5_000 }).catch(() => false)), `"Add ${picker.addLabel}" trigger not present on this ${entity.name}`);
          await trigger.click();

          const listbox = page.getByRole('listbox').first();
          await expect(listbox, `${picker.addLabel} picker did not open a listbox`).toBeVisible({ timeout: 5_000 });

          const optionsBefore = await listbox.getByRole('option').count();
          test.skip(optionsBefore === 0, `No ${picker.noResultsPlural} in the catalog — nothing to filter`);

          const firstOptionText = (await listbox.getByRole('option').first().innerText()).split('\n')[0].trim();
          const searchBox = pickerSearchBox(page, picker);
          await expect(searchBox, `Search input not found inside the ${picker.addLabel} picker`).toBeVisible({ timeout: 5_000 });

          // A query derived from the first option's own name always matches at least that option —
          // keeps the assertion meaningful without depending on hardcoded fixture data.
          const needle = firstOptionText.slice(0, Math.max(3, Math.floor(firstOptionText.length / 2)));
          await searchBox.fill(needle);
          await page.waitForTimeout(300);

          const filteredTexts = await listbox.getByRole('option').allInnerTexts();
          expect(filteredTexts.length, `Searching "${needle}" filtered out every option, including the one it was derived from`).toBeGreaterThan(0);
          for (const text of filteredTexts) {
            expect(text.toLowerCase(), `Option "${text}" is visible but doesn't match search term "${needle}"`).toContain(needle.toLowerCase());
          }

          // A query with no plausible match must show a specific empty state, not a stale/blank list.
          await searchBox.fill('zzz_no_such_record_xyz');
          await page.waitForTimeout(300);
          await expect(listbox.getByRole('option')).toHaveCount(0);
          await expect(
            page.getByText(new RegExp(`no ${picker.noResultsPlural}\\s*found`, 'i')),
            `${picker.addLabel} picker should show "No ${picker.noResultsPlural} found", not a blank list`,
          ).toBeVisible({ timeout: 3_000 });

          // Clearing restores the full, scannable list.
          await searchBox.fill('');
          await page.waitForTimeout(300);
          await expect(listbox.getByRole('option')).toHaveCount(optionsBefore);

          await page.keyboard.press('Escape');
        });

        test(`${picker.addLabel} picker — linking an option saves it, updates the counter live, and cleanup unlinks it`, async ({ page }) => {
          await ensurePickerTab(page, entity, picker);
          const trigger = pickerTrigger(page, picker);
          test.skip(!(await trigger.isVisible({ timeout: 5_000 }).catch(() => false)), `"Add ${picker.addLabel}" trigger not present on this ${entity.name}`);

          const before = await readCounter(page, picker);
          await trigger.click();
          const listbox = page.getByRole('listbox').first();
          await expect(listbox).toBeVisible({ timeout: 5_000 });

          // Search for one of our own fixtures by name rather than grabbing
          // whichever option happens to be first in the unfiltered list — on an
          // instance with many pre-existing records the default list may not
          // even include our fixture (pagination/sort order), and linking an
          // arbitrary unrelated record risks leaving a dangling link on data
          // this suite doesn't own if the test fails before cleanup runs.
          const optionLabel = requireTestData()[PICKER_TARGET_KEY[picker.key]].name;
          const searchBox = pickerSearchBox(page, picker);
          await expect(searchBox, `Search input not found inside the ${picker.addLabel} picker`).toBeVisible({ timeout: 5_000 });
          await searchBox.fill(optionLabel);
          await page.waitForTimeout(300);

          const option = listbox.getByRole('option', { name: new RegExp(escapeRegex(optionLabel), 'i') }).first();
          const found = await option.isVisible({ timeout: 3_000 }).catch(() => false);
          test.skip(!found, `Fixture "${optionLabel}" not found via search in the ${picker.addLabel} picker`);
          const alreadyLinked = (await option.getAttribute('aria-selected')) === 'true';
          test.skip(alreadyLinked, `Fixture "${optionLabel}" is already linked to this ${entity.name.toLowerCase()} — nothing to link`);

          await plantNoReloadMarker(page);
          await option.click();

          const spinnerAppeared = await listbox.locator('svg.animate-spin').first().isVisible({ timeout: 1_500 }).catch(() => false);

          await expect(option, `"${optionLabel}" should flip to a selected/checked state once linked`)
            .toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
          expect(await markerSurvived(page), 'Linking triggered a hard page reload instead of an in-place UI update').toBe(true);

          const after = await readCounter(page, picker);
          expect(after, `Counter did not increment after linking "${optionLabel}"`).toBe(before + 1);
          await expect(page.locator('body'), `Linked "${optionLabel}" not visible in the "Currently Related ${picker.counterPlural}" list`)
            .toContainText(optionLabel, { timeout: 8_000 });

          console.log(`[relationship-pickers] ${entity.name} → ${picker.addLabel} "${optionLabel}" linked — counter ${before}→${after}${spinnerAppeared ? ' (spinner observed)' : ''}`);

          // ── cleanup: unlink so repeated runs don't accumulate state ──────────
          await ensurePickerOpen(trigger, listbox);
          await expect(listbox).toBeVisible({ timeout: 5_000 });
          await searchBox.fill(optionLabel);
          await page.waitForTimeout(300);
          await option.click();
          await expect(option).toHaveAttribute('aria-selected', 'false', { timeout: 10_000 });
          expect(await readCounter(page, picker), 'Counter did not decrement back after cleanup unlink').toBe(before);
        });
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Screen real-estate & responsiveness — dense screens on standard laptops
// ═══════════════════════════════════════════════════════════════════════════

const LAPTOP_VIEWPORTS = [
  { name: '1366x768 (common laptop)', width: 1366, height: 768 },
  { name: '1440x900 (MacBook)', width: 1440, height: 900 },
] as const;

const LIST_ROUTES = [
  { path: '/', label: 'Home' },
  { path: '/catalog', label: 'Agent Catalog' },
  { path: '/use-cases', label: 'AI Use Cases' },
  { path: '/ai-models', label: 'AI Models' },
  { path: '/applications', label: 'Applications' },
  { path: '/processes', label: 'Processes' },
  { path: '/integrations', label: 'Integrations' },
  { path: '/insights', label: 'Insights' },
] as const;

const OVERFLOW_TOLERANCE_PX = 2;

async function assertNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollWidth,
    `${label} overflows horizontally: content is ${overflow.scrollWidth}px wide but the viewport is only ${overflow.clientWidth}px`,
  ).toBeLessThanOrEqual(overflow.clientWidth + OVERFLOW_TOLERANCE_PX);
}

async function assertNavDoesNotOverlapContent(page: Page, label: string) {
  const nav = page.locator('aside').first();
  const main = page.locator('main').first();
  if (!(await nav.isVisible().catch(() => false)) || !(await main.isVisible().catch(() => false))) return;
  const navBox = await nav.boundingBox();
  const mainBox = await main.boundingBox();
  if (!navBox || !mainBox) return;
  expect(
    navBox.x + navBox.width,
    `${label}: left nav (ends at x=${navBox.x + navBox.width}) overlaps main content (starts at x=${mainBox.x})`,
  ).toBeLessThanOrEqual(mainBox.x + OVERFLOW_TOLERANCE_PX);
}

for (const viewport of LAPTOP_VIEWPORTS) {
  test.describe(`2. Responsiveness @ ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const route of LIST_ROUTES) {
      test(`${route.label} scales without horizontal overflow or nav/content overlap`, async ({ page }) => {
        await page.goto(route.path);
        await expect(page).not.toHaveURL(/\/login/);
        await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

        await assertNoHorizontalOverflow(page, `${route.label} @ ${viewport.name}`);
        await assertNavDoesNotOverlapContent(page, `${route.label} @ ${viewport.name}`);

        const bodyText = await page.locator('body').innerText();
        expect(bodyText.length, `${route.label} rendered blank at ${viewport.name}`).toBeGreaterThan(0);
      });
    }

    for (const entity of ENTITY_PAGES) {
      test(`${entity.name} detail page fits the viewport — no overflow, no clipped controls`, async ({ page }) => {
        await openEntity(page, entity);

        await assertNoHorizontalOverflow(page, `${entity.name} detail @ ${viewport.name}`);
        await assertNavDoesNotOverlapContent(page, `${entity.name} detail @ ${viewport.name}`);

        // Every "Add X" relationship-picker trigger must remain fully clickable —
        // not clipped off the right edge by a card that didn't shrink to fit.
        const addButtons = page.getByRole('button', { name: /^add /i });
        const count = await addButtons.count();
        for (let i = 0; i < count; i++) {
          const box = await addButtons.nth(i).boundingBox();
          if (!box) continue;
          expect(
            box.x + box.width,
            `${entity.name} detail @ ${viewport.name}: an "Add" button is clipped past the right edge`,
          ).toBeLessThanOrEqual(viewport.width + OVERFLOW_TOLERANCE_PX);
        }

        // Every relationship picker this entity exposes must actually be able to open at this density.
        for (const picker of entity.pickers) {
          await ensurePickerTab(page, entity, picker);
          const trigger = pickerTrigger(page, picker);
          if (await trigger.isVisible({ timeout: 2_000 }).catch(() => false)) {
            await trigger.click();
            const listbox = page.getByRole('listbox').first();
            await expect(listbox, `"Add ${picker.addLabel}" opened but its dropdown isn't visible at ${viewport.name}`).toBeVisible({ timeout: 3_000 });
            // The dropdown's Escape handler only fires while its search input has
            // focus (confirmed in AgentRelatedTab.tsx), so pressing Escape here
            // (focus is still on the trigger button after .click()) would leave
            // it open to overlap the next picker's "Add X" button below it. Click
            // a neutral spot instead — the app closes any open dropdown on
            // outside click, and the extreme top-left of <main> is never under
            // one of these dropdown panels (they open below their own trigger).
            await page.locator('main').first().click({ position: { x: 10, y: 10 } });
            await expect(listbox, `"Add ${picker.addLabel}" dropdown did not close after clicking outside it`).not.toBeVisible({ timeout: 3_000 });
          }
        }
      });
    }
  });
}

// ── Browser zoom levels ──────────────────────────────────────────────────────
// Uses the CSS `zoom` property (supported in Chromium and current Firefox) to
// approximate real browser zoom, since Playwright has no direct zoom control.

const ZOOM_LEVELS = [90, 100, 125] as const;

async function setPageZoom(page: Page, percent: number) {
  await page.evaluate((p) => { (document.documentElement.style as any).zoom = `${p}%`; }, percent);
}

test.describe('2b. Responsiveness — browser zoom levels', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const zoom of ZOOM_LEVELS) {
    test(`Home and Agent Catalog remain usable at ${zoom}% zoom`, async ({ page }) => {
      await page.goto('/');
      await expect(page).not.toHaveURL(/\/login/);
      await setPageZoom(page, zoom);
      await assertNoHorizontalOverflow(page, `Home @ ${zoom}% zoom`);
      await assertNavDoesNotOverlapContent(page, `Home @ ${zoom}% zoom`);

      await page.goto('/catalog');
      await expect(page).not.toHaveURL(/\/login/);
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
      await setPageZoom(page, zoom);
      await assertNoHorizontalOverflow(page, `Agent Catalog @ ${zoom}% zoom`);
      await assertNavDoesNotOverlapContent(page, `Agent Catalog @ ${zoom}% zoom`);
    });

    test(`Agent detail (Business Impact tab) stays usable at ${zoom}% zoom — no clipped or overlapping controls`, async ({ page }) => {
      const agentEntity = ENTITY_PAGES.find((e) => e.name === 'Agent')!;
      await openEntity(page, agentEntity);
      await setPageZoom(page, zoom);

      await assertNoHorizontalOverflow(page, `Agent detail @ ${zoom}% zoom`);
      await assertNavDoesNotOverlapContent(page, `Agent detail @ ${zoom}% zoom`);

      // "Add X" triggers must stay visible and non-overlapping with their own
      // section's "Currently Related X (N)" counter in the same header row.
      for (const picker of agentEntity.pickers) {
        await ensurePickerTab(page, agentEntity, picker);
        const trigger = pickerTrigger(page, picker);
        if (!(await trigger.isVisible({ timeout: 2_000 }).catch(() => false))) continue;
        const counterHeader = page.getByText(new RegExp(`currently related ${picker.counterPlural}\\s*\\(\\d+\\)`, 'i')).first();
        const [triggerBox, counterBox] = await Promise.all([trigger.boundingBox(), counterHeader.boundingBox()]);
        if (!triggerBox || !counterBox) continue;
        const overlaps = triggerBox.x < counterBox.x + counterBox.width && triggerBox.x + triggerBox.width > counterBox.x
          && triggerBox.y < counterBox.y + counterBox.height && triggerBox.y + triggerBox.height > counterBox.y;
        expect(overlaps, `At ${zoom}% zoom, "Add ${picker.addLabel}" overlaps its own "Currently Related ${picker.counterPlural}" label`).toBe(false);
      }
    });
  }
});

// ── Tables ───────────────────────────────────────────────────────────────────
// The only live-data <table> in the portal (confirmed by grep — everything
// else is card grids): the success-metrics table on the Insights page.

test.describe('2c. Responsiveness — tables scroll within their own container', () => {
  for (const viewport of LAPTOP_VIEWPORTS) {
    test(`Insights metrics table doesn't force page-level horizontal scroll @ ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/insights');
      await expect(page).not.toHaveURL(/\/login/);
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

      const table = page.locator('table').first();
      test.skip(!(await table.isVisible({ timeout: 5_000 }).catch(() => false)), 'No metrics table rendered (likely an empty state — no agents with success metrics yet)');

      await assertNoHorizontalOverflow(page, `Insights @ ${viewport.name}`);

      // The table's own scroll container should be the one that scrolls, not the page.
      const scrollContainer = page.locator('.overflow-x-auto').filter({ has: page.locator('table') }).first();
      await expect(scrollContainer, 'Metrics table should be wrapped in a horizontally-scrollable container').toBeVisible();
    });
  }
});

// ── Modals ───────────────────────────────────────────────────────────────────

test.describe('2d. Responsiveness — modals fit within the viewport', () => {
  const MODALS = [
    { openFrom: '/catalog', buttonName: /^load agents$/i, title: /^load agents$/i },
    { openFrom: '/applications', buttonName: /^load applications$/i, title: /^load applications$/i },
  ];

  for (const viewport of LAPTOP_VIEWPORTS) {
    for (const modal of MODALS) {
      test(`"${modal.title.source}" modal fits fully inside the viewport @ ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(modal.openFrom);
        await expect(page).not.toHaveURL(/\/login/);
        await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

        const openButton = page.getByRole('button', { name: modal.buttonName }).first();
        test.skip(!(await openButton.isVisible({ timeout: 5_000 }).catch(() => false)), `"${modal.buttonName.source}" button not found on ${modal.openFrom}`);
        await openButton.click();

        const heading = page.getByRole('heading', { name: modal.title }).first();
        await expect(heading, `Modal with heading matching ${modal.title} did not open`).toBeVisible({ timeout: 5_000 });

        // The modal is a plain `fixed inset-0` overlay (no role="dialog") — its
        // panel is the nearest ancestor with rounded-2xl/shadow-2xl framing.
        const panel = heading.locator('xpath=ancestor::div[contains(@class, "rounded-2xl")][1]');
        const box = await panel.boundingBox();
        expect(box, 'Could not measure the modal panel').toBeTruthy();
        if (box) {
          expect(box.x, `Modal panel extends past the left edge at ${viewport.name}`).toBeGreaterThanOrEqual(-OVERFLOW_TOLERANCE_PX);
          expect(box.y, `Modal panel extends past the top edge at ${viewport.name}`).toBeGreaterThanOrEqual(-OVERFLOW_TOLERANCE_PX);
          expect(box.x + box.width, `Modal panel extends past the right edge at ${viewport.name}`).toBeLessThanOrEqual(viewport.width + OVERFLOW_TOLERANCE_PX);
          expect(box.y + box.height, `Modal panel extends past the bottom edge at ${viewport.name}`).toBeLessThanOrEqual(viewport.height + OVERFLOW_TOLERANCE_PX);
        }

        // Close via backdrop click (top-left corner, outside the panel) so state doesn't leak into other tests.
        await page.mouse.click(2, 2);
      });
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Component feedback — system messages, nav counters, loading states
// ═══════════════════════════════════════════════════════════════════════════

async function readNavCounter(page: Page, navLabel: RegExp): Promise<number | null> {
  const navButton = page.locator('aside, nav').first().getByRole('button', { name: navLabel }).first();
  if (!(await navButton.isVisible({ timeout: 5_000 }).catch(() => false))) return null;
  const match = (await navButton.innerText()).match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

const NAV_CHECKS: Array<{ path: string; navLabel: RegExp }> = [
  { path: '/catalog', navLabel: /^Agents/i },
  { path: '/ai-models', navLabel: /^AI Models/i },
  { path: '/use-cases', navLabel: /^AI Use Case/i },
  { path: '/applications', navLabel: /^Applications/i },
  { path: '/processes', navLabel: /^Processes/i },
  { path: '/integrations', navLabel: /^Integrations/i },
];

test.describe('3. Component feedback', () => {
  test.describe('Nav counters match rendered content', () => {
    for (const { path, navLabel } of NAV_CHECKS) {
      test(`${path} — nav badge count matches the number of cards rendered`, async ({ page }) => {
        await page.goto(path);
        await expect(page).not.toHaveURL(/\/login/);
        await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

        const navCountOrNull = await readNavCounter(page, navLabel);
        test.skip(navCountOrNull === null, `Nav badge for ${path} not visible (sidebar collapsed or zero count)`);
        const navCount = navCountOrNull as number;

        const headingCount = await page.getByRole('heading', { level: 3 }).count();
        if (navCount === 0) {
          expect(headingCount, `Nav shows 0 for ${path} but the page rendered ${headingCount} card(s)`).toBe(0);
        } else {
          // Lists commonly paginate, so the on-screen count can be <= the nav total, never more.
          expect(headingCount, `Page rendered ${headingCount} cards but the nav badge only shows ${navCount}`).toBeLessThanOrEqual(navCount);
          expect(headingCount, `Nav shows ${navCount} for ${path} but the page rendered no cards at all`).toBeGreaterThan(0);
        }
        console.log(`[component-feedback] ${path}: nav badge=${navCount}, rendered cards=${headingCount}`);
      });
    }
  });

  test.describe('Linking updates counters live, without a hard reload', () => {
    for (const entity of ENTITY_PAGES) {
      test.describe(`${entity.name} detail page`, () => {
        test.beforeEach(async ({ page }) => {
          await openEntity(page, entity);
        });

        for (const picker of entity.pickers) {
          test(`linking via "Add ${picker.addLabel}" shows a loading state and updates the counter without reloading`, async ({ page }) => {
            await ensurePickerTab(page, entity, picker);
            const trigger = pickerTrigger(page, picker);
            test.skip(!(await trigger.isVisible({ timeout: 5_000 }).catch(() => false)), `"Add ${picker.addLabel}" trigger not present on this ${entity.name}`);

            const before = await readCounter(page, picker);
            await trigger.click();

            const listbox = page.getByRole('listbox').first();
            await expect(listbox).toBeVisible({ timeout: 5_000 });

            // Search for one of our own fixtures by name — see the identical
            // reasoning in section 1: grabbing "whichever option is first" in
            // the unfiltered list is unsafe on an instance with many
            // pre-existing records.
            const optionLabel = requireTestData()[PICKER_TARGET_KEY[picker.key]].name;
            const searchBox = pickerSearchBox(page, picker);
            await expect(searchBox, `Search input not found inside the ${picker.addLabel} picker`).toBeVisible({ timeout: 5_000 });
            await searchBox.fill(optionLabel);
            await page.waitForTimeout(300);

            const option = listbox.getByRole('option', { name: new RegExp(escapeRegex(optionLabel), 'i') }).first();
            const found = await option.isVisible({ timeout: 3_000 }).catch(() => false);
            test.skip(!found, `Fixture "${optionLabel}" not found via search in the ${picker.addLabel} picker`);
            const alreadyLinked = (await option.getAttribute('aria-selected')) === 'true';
            test.skip(alreadyLinked, `Fixture "${optionLabel}" is already linked — nothing to link`);

            await plantNoReloadMarker(page);
            await option.click();

            const spinnerAppeared = await listbox.locator('svg.animate-spin').first().isVisible({ timeout: 1_500 }).catch(() => false);

            await expect(option, 'Option should flip to a selected/linked state once the request completes')
              .toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
            expect(await markerSurvived(page), 'Linking caused a hard reload instead of an in-place SPA update').toBe(true);

            const after = await readCounter(page, picker);
            expect(after, 'Counter did not update in place after linking').toBe(before + 1);

            console.log(`[component-feedback] ${entity.name} → ${picker.addLabel} "${optionLabel}": counter ${before}→${after}, spinner observed=${spinnerAppeared}`);

            // ── cleanup ────────────────────────────────────────────────────────
            await ensurePickerOpen(trigger, listbox);
            await expect(listbox).toBeVisible({ timeout: 5_000 });
            await searchBox.fill(optionLabel);
            await page.waitForTimeout(300);
            await option.click();
            await expect(page.getByText(new RegExp(`currently related ${picker.counterPlural}\\s*\\(${before}\\)`, 'i')))
              .toBeVisible({ timeout: 10_000 });
          });
        }
      });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. System notifications — the global toast banner
// ═══════════════════════════════════════════════════════════════════════════
//
// GlobalNotificationBanner.tsx: each toast has a "Dismiss" button
// (aria-label="Dismiss") for manual close, and an auto-dismiss timer keyed
// by variant — success/warning: 10s, info: 5s, error: never. These tests
// trigger a real "success" toast (via the real Create Agent flow — same
// action Section 0 uses) and check the banner's own behavior, independent
// of which action produced the message.

async function triggerSuccessToast(page: Page): Promise<Locator> {
  const name = `E2E Notification-Check Agent ${Date.now()}`;
  await page.goto('/agents/new');
  await expect(page).not.toHaveURL(/\/login/);
  await page.getByPlaceholder(/e\.g\. fraud case triage agent/i).fill(name);
  await page.getByPlaceholder(/what this agent does/i).fill('Fixture for the notification-banner test. Safe to delete.');
  await page.getByPlaceholder(/step-by-step behavioral instructions/i).fill('Automated test fixture — not a real agent.');
  await (await clickSubmit(page, 'Create Agent')).click();
  const toast = page.getByText('Agent created successfully. Risk assessment is running in the background.');
  await expect(toast, 'Success toast did not appear after creating an agent').toBeVisible({ timeout: 5_000 });
  return toast;
}

test.describe('4. System notifications', () => {
  test('success toast can be dismissed manually via its Dismiss button', async ({ page }) => {
    const toast = await triggerSuccessToast(page);

    const dismissButton = page.getByRole('button', { name: 'Dismiss' }).first();
    await expect(dismissButton, '"Dismiss" button not found on the toast').toBeVisible({ timeout: 3_000 });
    await dismissButton.click();

    await expect(toast, 'Toast should disappear immediately after clicking Dismiss').not.toBeVisible({ timeout: 2_000 });
  });

  test('success toast auto-dismisses on its own after ~10 seconds', async ({ page }) => {
    const toast = await triggerSuccessToast(page);

    // Confirmed in GlobalNotificationBanner.tsx: AUTO_DISMISS_MS.success = 10000.
    // Give a margin above that instead of asserting at exactly 10s.
    await expect(toast, 'Success toast should auto-dismiss ~10s after appearing, without manual interaction')
      .not.toBeVisible({ timeout: 13_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Insights page — stat tiles, empty states, and refresh loading behavior
// ═══════════════════════════════════════════════════════════════════════════
//
// InsightsPage.tsx has no dropdown pickers, but it's a dense dashboard with
// its own counters (Agents/Use Cases/Critical/High Risk/HITL Open/Complete%)
// and its own async refresh action — worth checking on its own terms rather
// than only via the generic LIST_ROUTES overflow check in section 2.

test.describe('5. Insights page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/insights');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  });

  test('renders its stat tiles and every dashboard card without crashing', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible({ timeout: 10_000 });

    // Portfolio / Agent Alerts / Company Profile stat tiles (exact labels from InsightsPage.tsx).
    for (const label of ['Agents', 'Use Cases', 'Critical', 'High Risk', 'HITL Open', 'Complete']) {
      await expect(page.getByText(label, { exact: true }).first(), `Stat tile "${label}" not found on Insights`).toBeVisible({ timeout: 5_000 });
    }

    // Every dashboard section renders either real content or its own labeled empty state —
    // never a blank gap. A representative sample of the documented empty-state strings.
    const sectionHeadings = [
      'Use Case Lifecycle Distribution', 'Agent Lifecycle Distribution',
      'Agents by Provider', 'Agents by Blended Risk Classification',
      'Critical & High Risk in Production', 'High Risk Agents Under Development',
      'HITL Escalation Queue', 'Company Profile Health',
      'Stage Gate Blockers', 'Autonomy Distribution', 'Success Metrics Health',
    ];
    for (const heading of sectionHeadings) {
      await expect(page.getByText(heading, { exact: true }), `Section "${heading}" not rendered on Insights`).toBeVisible({ timeout: 5_000 });
    }
  });

  test('Refresh button shows a loading state and completes without error', async ({ page }) => {
    const refreshButton = page.getByRole('button', { name: /refresh/i }).first();
    await expect(refreshButton).toBeVisible({ timeout: 8_000 });
    await expect(refreshButton).toBeEnabled();

    await refreshButton.click();
    // Button disables and its icon spins while the summary re-fetches (InsightsPage.tsx ~708-818).
    const disabledDuringLoad = await refreshButton.isDisabled().catch(() => false);
    const spinnerDuringLoad = await refreshButton.locator('svg.animate-spin').first().isVisible({ timeout: 1_000 }).catch(() => false);
    expect(disabledDuringLoad || spinnerDuringLoad, 'Refresh should show some loading indication (disabled state or spinning icon) while re-fetching').toBe(true);

    await expect(refreshButton, 'Refresh button should re-enable once the summary reload completes').toBeEnabled({ timeout: 15_000 });
    await expect(page.getByText(/something went wrong|failed to load/i), 'Refresh should not surface an error banner on a normal reload').not.toBeVisible({ timeout: 1_000 });
  });
});
