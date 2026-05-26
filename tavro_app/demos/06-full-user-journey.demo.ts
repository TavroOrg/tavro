import { test } from '@playwright/test';
import {
  loginToTavro,
  stubRuntimeConfig,
  stubMcpServer,
  navigateToCatalog,
  searchAgents,
  navigateToUseCases,
  navigateToBlueprint,
  navigateToCompliance,
  navigateToAudit,
  runAgent,
  clickSidebarLink,
} from '../actions';

// ── Realistic stub data ────────────────────────────────────────────────────────

const STUB_AGENTS = {
  agents: [
    {
      name: 'MIA — Managed Incident Agent',
      identification: { agent_id: 'agent-mia-001' },
      description: 'AI-powered IT incident triage, routing, and resolution via natural-language instructions.',
      status: 'active',
    },
    {
      name: 'Risk Classifier',
      identification: { agent_id: 'agent-risk-002' },
      description: 'Classifies business and operational risks using multi-modal LLM analysis.',
      status: 'active',
    },
    {
      name: 'Vendor Due Diligence Agent',
      identification: { agent_id: 'agent-vdd-003' },
      description: 'Automates vendor risk scoring, ESG screening, and contract compliance checks.',
      status: 'active',
    },
    {
      name: 'Financial Document Intelligence',
      identification: { agent_id: 'agent-fdi-004' },
      description: 'Extracts and validates data from financial statements and audit reports.',
      status: 'active',
    },
  ],
};

const STUB_USE_CASES = {
  use_cases: [
    {
      identifier: 'uc-001',
      name: 'IT Service Desk Automation',
      description:
        'AI-powered ticket triage, routing, and resolution using MIA — the Managed Incident Agent.',
      status: 'Active',
      priority: '1 - Critical',
      owner: 'IT Operations',
      function: 'Technology',
      overall_risk: 'Medium',
      agents: [{ agent_id: 'agent-mia-001', name: 'MIA — Managed Incident Agent', role: 'Primary executor' }],
    },
    {
      identifier: 'uc-002',
      name: 'Vendor Risk Assessment',
      description:
        'Automated vendor risk scoring and ESG compliance checking across the procurement lifecycle.',
      status: 'Active',
      priority: '2 - High',
      owner: 'Procurement',
      function: 'Finance',
      overall_risk: 'High',
      agents: [{ agent_id: 'agent-vdd-003', name: 'Vendor Due Diligence Agent', role: 'Primary executor' }],
    },
    {
      identifier: 'uc-003',
      name: 'Financial Document Intelligence',
      description:
        'Extracts, validates, and summarises financial statements and audit reports for compliance teams.',
      status: 'In Review',
      priority: '2 - High',
      owner: 'Finance',
      function: 'Finance',
      overall_risk: 'Low',
    },
  ],
};

const STUB_USE_CASE_DETAIL = {
  identifier: 'uc-001',
  name: 'IT Service Desk Automation',
  description:
    'AI-powered ticket triage, routing, and resolution using MIA — the Managed Incident Agent.',
  status: 'Active',
  priority: '1 - Critical',
  owner: 'IT Operations',
  proposed_by: 'Ravi Kumar',
  function: 'Technology',
  overall_risk: 'Medium',
  agents: [
    {
      agent_id: 'agent-mia-001',
      name: 'MIA — Managed Incident Agent',
      role: 'Primary executor',
      environment: 'Production',
    },
  ],
  applications: [
    { identifier: 'app-001', name: 'ServiceNow', description: 'ITSM platform', business_criticality: 'High' },
    { identifier: 'app-002', name: 'Slack', description: 'Team communication', business_criticality: 'Medium' },
  ],
  business_processes: [
    { identifier: 'bp-001', name: 'Incident Management', description: 'L1/L2 ticket triage and resolution', business_criticality: 'High' },
  ],
  risk_assessments: [
    {
      identifier: 'ra-001',
      name: 'Q2 2025 AI Risk Assessment',
      assessor: 'Risk & Compliance Team',
      date: '2025-04-15',
      blended_risk_score: '42',
      blended_risk_classification: 'Medium',
    },
  ],
};

const STUB_COMPLIANCE_ITEMS = {
  items: [
    {
      id: 'comp-eu-ai-act',
      item_type: 'regulation',
      scope: 'external',
      name: 'EU AI Act',
      short_name: 'EU AI Act',
      description: 'Risk-based requirements for AI systems operated or placed on the EU market.',
      issuing_body: 'European Parliament',
      jurisdiction: ['EU'],
      industry_tags: ['all'],
      status: 'active',
      ai_researched: true,
      effective_date: '2024-08-01',
      created_at: '2025-01-15T10:00:00Z',
      updated_at: '2025-05-01T10:00:00Z',
      dim_count: 8,
      impact_count: 3,
      open_gaps: 2,
      max_impact: 'high',
    },
    {
      id: 'comp-soc2',
      item_type: 'regulation',
      scope: 'external',
      name: 'SOC 2 Type II',
      short_name: 'SOC 2',
      description: 'Security, availability, and confidentiality standards for service organisations.',
      issuing_body: 'AICPA',
      jurisdiction: ['US'],
      industry_tags: ['saas', 'fintech'],
      status: 'active',
      ai_researched: true,
      effective_date: '2023-06-01',
      created_at: '2025-02-01T10:00:00Z',
      updated_at: '2025-05-10T10:00:00Z',
      dim_count: 12,
      impact_count: 5,
      open_gaps: 1,
      max_impact: 'medium',
    },
  ],
};

const STUB_AUDIT_RUNS = {
  runs: [
    {
      id: 'run-001',
      company_id: 'tavro-demo',
      scope_type: 'use_case_all',
      use_case_id: 'uc-001',
      use_case_name: 'IT Service Desk Automation',
      status: 'completed',
      total_pairs: 2,
      completed_pairs: 2,
      failed_pairs: 0,
      overall_risk: 'medium',
      summary_text:
        'IT Service Desk Automation shows medium compliance risk. EU AI Act transparency requirements need documentation. SOC 2 controls are largely in place.',
      initiated_by: 'sanjeev@tavro.ai',
      created_at: '2025-05-20T09:00:00Z',
      updated_at: '2025-05-20T09:45:00Z',
      completed_at: '2025-05-20T09:45:00Z',
      critical_count: 0,
      high_count: 1,
    },
  ],
};

const STUB_BLUEPRINT_GRAPH = {
  nodes: [
    { id: 'dim-finance', label: 'Finance', category: 'function', x: 150, y: 250 },
    { id: 'dim-it', label: 'IT Operations', category: 'function', x: 400, y: 150 },
    { id: 'dim-procurement', label: 'Procurement', category: 'function', x: 650, y: 250 },
    { id: 'dim-risk', label: 'Risk & Compliance', category: 'function', x: 400, y: 400 },
    { id: 'dim-hr', label: 'Human Resources', category: 'function', x: 150, y: 450 },
  ],
  edges: [
    { id: 'e1', source: 'dim-finance', target: 'dim-risk' },
    { id: 'e2', source: 'dim-it', target: 'dim-risk' },
    { id: 'e3', source: 'dim-procurement', target: 'dim-risk' },
    { id: 'e4', source: 'dim-hr', target: 'dim-finance' },
  ],
};

// BlueprintContext calls /api/v1/companies and /api/v1/dim-types on mount.
// Stubbing them seeds activeCompany so the Audit page loads runs.
const STUB_COMPANIES = {
  items: [
    {
      id: 'demo-company-001',
      name: 'Tavro Financial Services',
      industry: 'Financial Services',
      is_public: false,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-05-01T00:00:00Z',
    },
  ],
  total: 1,
  offset: 0,
  limit: 50,
};

// ── Demo ───────────────────────────────────────────────────────────────────────

/**
 * Demo: Full User Journey — complete product walkthrough
 *
 * Choreography (≈ 3 minutes at slowMo 800):
 *   1.  Login → Home — show the three quick-nav cards
 *   2.  AI Use Cases — browse the use case list
 *   3.  Use Case detail — IT Service Desk Automation (Overview + AI Agents tab)
 *   4.  Agent Catalog — search "MIA", clear and browse all
 *   5.  AI Playground — send a realistic business prompt, wait for the response
 *   6.  Blueprint — show the org context graph
 *   7.  Compliance — browse the EU AI Act and SOC 2 entries
 *   8.  Audit Center — show completed audit runs
 *
 * Produces: test-results/demo-chrome/06-full-user-journey/video.webm
 *           demo-screenshots/06-*.png at each key moment
 */
test('06 — Full User Journey', async ({ page }) => {
  // Playwright routes are LIFO — last registered = highest priority.
  // Register broad patterns first so specific stubs take precedence.
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/v1/business-relations**', (route) =>
    route.fulfill({ json: { applications: [], processes: [] } }),
  );
  await page.route('**/api/v1/graph/**', (route) => route.fulfill({ json: STUB_BLUEPRINT_GRAPH }));
  await page.route('**/api/v1/dim-nodes**', (route) => route.fulfill({ json: { items: [], total: 0 } }));
  await page.route('**/api/v1/dim-types**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/companies**', (route) => route.fulfill({ json: STUB_COMPANIES }));
  await page.route('**/api/v1/audit**', (route) => route.fulfill({ json: STUB_AUDIT_RUNS }));
  await page.route('**/api/v1/compliance**', (route) => route.fulfill({ json: STUB_COMPLIANCE_ITEMS }));
  await page.route('**/api/v1/use-cases**', (route) => route.fulfill({ json: STUB_USE_CASES }));
  await page.route('**/api/v1/use-cases/**', (route) => route.fulfill({ json: STUB_USE_CASE_DETAIL }));
  await page.route('**/api/v1/agents**', (route) => route.fulfill({ json: STUB_AGENTS }));
  await stubMcpServer(page, STUB_AGENTS.agents);
  await stubRuntimeConfig(page);

  // ── 1. Login ───────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginToTavro(page);
  await page.waitForTimeout(2_000); // show home page

  await page.screenshot({ path: 'demo-screenshots/06-01-home.png' });

  // ── 2. AI Use Cases list ───────────────────────────────────────────────────
  await navigateToUseCases(page);
  await page.waitForTimeout(2_500);

  await page.screenshot({ path: 'demo-screenshots/06-02-use-cases.png' });

  // ── 3. Use Case detail — click first card ─────────────────────────────────
  // Navigate directly so the demo doesn't depend on exact card text rendering
  await page.goto('/use-case/uc-001');
  await page.waitForTimeout(2_500); // show Overview tab

  await page.screenshot({ path: 'demo-screenshots/06-03-use-case-overview.png' });
  await page.waitForTimeout(1_500);

  // Click the AI Agents tab if it's visible
  const agentsTab = page.getByRole('button', { name: /ai agents/i });
  if (await agentsTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await agentsTab.click();
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: 'demo-screenshots/06-04-use-case-agents-tab.png' });
  }

  // ── 4. Agent Catalog ───────────────────────────────────────────────────────
  await navigateToCatalog(page);
  await page.waitForTimeout(2_000);

  await searchAgents(page, 'MIA');
  await page.waitForTimeout(1_500);

  await page.screenshot({ path: 'demo-screenshots/06-05-catalog-search.png' });
  await page.waitForTimeout(1_000);

  await searchAgents(page, '');
  await page.waitForTimeout(2_000); // show full catalog
  await page.screenshot({ path: 'demo-screenshots/06-06-catalog-full.png' });

  // ── 5. AI Playground ───────────────────────────────────────────────────────
  await runAgent(
    page,
    'Summarise the compliance posture of the IT Service Desk Automation use case against EU AI Act requirements.',
  );
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'demo-screenshots/06-07-playground-prompt.png' });
  await page.waitForTimeout(4_500); // let response stream visibly
  await page.screenshot({ path: 'demo-screenshots/06-08-playground-response.png' });

  // ── 6. Blueprint ──────────────────────────────────────────────────────────
  await navigateToBlueprint(page);
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: 'demo-screenshots/06-09-blueprint.png' });

  // ── 7. Compliance ─────────────────────────────────────────────────────────
  await navigateToCompliance(page);
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: 'demo-screenshots/06-10-compliance.png' });
  await page.waitForTimeout(1_500);

  // Hover over EU AI Act card to highlight it before moving on
  await page.getByText('EU AI Act').first().hover();
  await page.waitForTimeout(1_500);

  // ── 8. Audit Center ────────────────────────────────────────────────────────
  await navigateToAudit(page);
  await page.waitForTimeout(2_500); // let company context load + runs fetch
  await page.screenshot({ path: 'demo-screenshots/06-11-audit-center.png' });
  await page.waitForTimeout(1_500);

  // Click the first visible audit run card (div-based, not a table row)
  const runCard = page.locator('[class*="cursor-pointer"][class*="rounded-xl"]').first();
  if (await runCard.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await runCard.click();
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: 'demo-screenshots/06-12-audit-detail.png' });
  }

  // Final sidebar pan — show navigation richness
  await clickSidebarLink(page, /use.cases|use cases/i);
  await page.waitForTimeout(2_000);
});
