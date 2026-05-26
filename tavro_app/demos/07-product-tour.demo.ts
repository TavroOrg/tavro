import { test } from '@playwright/test';
import { loginToTavro, stubRuntimeConfig, stubMcpServer, runAgent } from '../actions';

// ── Stub data ──────────────────────────────────────────────────────────────────

const STUB_AGENTS = {
  agents: [
    { name: 'MIA — Managed Incident Agent', identification: { agent_id: 'agent-mia-001', environment: 'Production', governance_status: 'Approved' }, description: 'AI-powered IT incident triage, routing, and resolution via natural-language instructions.', status: 'active' },
    { name: 'Risk Classifier', identification: { agent_id: 'agent-risk-002', environment: 'Production', governance_status: 'Approved' }, description: 'Classifies business and operational risks using multi-modal LLM analysis.', status: 'active' },
    { name: 'Vendor Due Diligence Agent', identification: { agent_id: 'agent-vdd-003', environment: 'UAT', governance_status: 'In Review' }, description: 'Automates vendor risk scoring, ESG screening, and contract compliance checks.', status: 'active' },
    { name: 'Financial Document Intelligence', identification: { agent_id: 'agent-fdi-004', environment: 'Production', governance_status: 'Approved' }, description: 'Extracts and validates data from financial statements and audit reports.', status: 'active' },
  ],
};

const STUB_USE_CASES = {
  use_cases: [
    { identifier: 'uc-001', name: 'IT Service Desk Automation', description: 'AI-powered ticket triage, routing, and resolution using MIA.', status: 'Active', priority: '1 - Critical', owner: 'IT Operations', function: 'Technology', overall_risk: 'Medium' },
    { identifier: 'uc-002', name: 'Vendor Risk Assessment', description: 'Automated vendor risk scoring and ESG compliance checking.', status: 'Active', priority: '2 - High', owner: 'Procurement', function: 'Finance', overall_risk: 'High' },
    { identifier: 'uc-003', name: 'Financial Document Intelligence', description: 'Extracts, validates, and summarises financial statements for compliance teams.', status: 'In Review', priority: '2 - High', owner: 'Finance', function: 'Finance', overall_risk: 'Low' },
  ],
};

const STUB_USE_CASE_DETAIL = {
  identifier: 'uc-001', name: 'IT Service Desk Automation',
  description: 'AI-powered ticket triage, routing, and resolution using MIA — the Managed Incident Agent.',
  status: 'Active', priority: '1 - Critical', owner: 'IT Operations', proposed_by: 'Ravi Kumar', function: 'Technology', overall_risk: 'Medium',
  agents: [{ agent_id: 'agent-mia-001', name: 'MIA — Managed Incident Agent', role: 'Primary executor', environment: 'Production' }],
  applications: [{ identifier: 'app-001', name: 'ServiceNow', description: 'ITSM platform', business_criticality: 'High' }],
  business_processes: [{ identifier: 'bp-001', name: 'Incident Management', description: 'L1/L2 ticket triage', business_criticality: 'High' }],
};

const STUB_AGENT_DETAIL = {
  name: 'MIA — Managed Incident Agent',
  description: 'AI-powered IT incident triage, routing, and resolution via natural-language instructions.',
  version: '2.1',
  identification: { agent_id: 'agent-mia-001', role: 'Primary Executor', owner: 'IT Operations', environment: 'Production', governance_status: 'Approved' },
  configuration: { autonomy_level: 'Semi-Autonomous' },
  risk_assessment: { blended_risk_classification: 'Medium', blended_risk_score: '42', regulatory_risk_classification: 'Other' },
};

const STUB_APPLICATIONS = {
  items: [
    { business_application_id: 'app-001', application_name: 'ServiceNow', application_description: 'ITSM platform for IT service management and automation.', business_owner: 'IT Operations', business_criticality: 'High', emergency_tier: 'Mission Critical', vendor_name: 'ServiceNow', agent_risk_tier: 'High', num_of_associated_agents: '3' },
    { business_application_id: 'app-002', application_name: 'Salesforce CRM', application_description: 'Customer relationship management for sales and marketing.', business_owner: 'Sales', business_criticality: 'High', emergency_tier: 'Business Critical', vendor_name: 'Salesforce', agent_risk_tier: 'Medium', num_of_associated_agents: '2' },
    { business_application_id: 'app-003', application_name: 'Workday HCM', application_description: 'Human capital management for HR and finance operations.', business_owner: 'Human Resources', business_criticality: 'Medium', emergency_tier: 'Business Critical', vendor_name: 'Workday', agent_risk_tier: 'Low', num_of_associated_agents: '1' },
  ],
  total: 3,
};

const STUB_APP_CREATED = { business_application_id: 'app-new-001', application_name: 'Tavro Risk Portal', application_description: 'Internal AI risk governance and monitoring platform.', business_owner: 'Risk & Compliance', business_criticality: 'High', emergency_tier: 'Mission Critical', vendor_name: 'Tavro', agent_risk_tier: 'High', num_of_associated_agents: '0' };

const STUB_PROCESSES = {
  items: [
    { business_process_id: 'proc-001', process_name: 'Incident Management', process_description: 'L1/L2 ticket triage, routing, and resolution workflow.', business_owner: 'IT Operations', business_criticality: '1.0', num_of_associated_agents: '2' },
    { business_process_id: 'proc-002', process_name: 'Vendor Risk Assessment', process_description: 'Third-party vendor evaluation, scoring, and compliance checking.', business_owner: 'Procurement', business_criticality: '0.7', num_of_associated_agents: '1' },
    { business_process_id: 'proc-003', process_name: 'Financial Reporting', process_description: 'Automated extraction and validation of financial statements.', business_owner: 'Finance', business_criticality: '0.7', num_of_associated_agents: '1' },
  ],
  total: 3,
};

const STUB_PROC_CREATED = { business_process_id: 'proc-new-001', process_name: 'AI Risk Governance', process_description: 'End-to-end AI risk review and approval process.', business_owner: 'Risk & Compliance', business_criticality: '1.0' };

const STUB_COMPLIANCE_ITEMS = {
  items: [
    { id: 'comp-eu-ai-act', item_type: 'regulation', name: 'EU AI Act', short_name: 'EU AI Act', description: 'Risk-based requirements for AI systems operated or placed on the EU market.', issuing_body: 'European Parliament', jurisdiction: ['EU'], status: 'active', ai_researched: true, effective_date: '2024-08-01', dim_count: 8, impact_count: 3, open_gaps: 2, max_impact: 'high' },
    { id: 'comp-soc2', item_type: 'regulation', name: 'SOC 2 Type II', short_name: 'SOC 2', description: 'Security, availability, and confidentiality standards for service organizations.', issuing_body: 'AICPA', jurisdiction: ['US'], status: 'active', ai_researched: true, effective_date: '2023-06-01', dim_count: 12, impact_count: 5, open_gaps: 1, max_impact: 'medium' },
    { id: 'comp-gdpr', item_type: 'regulation', name: 'GDPR', short_name: 'GDPR', description: 'EU regulation on data protection and privacy.', issuing_body: 'European Commission', jurisdiction: ['EU'], status: 'active', ai_researched: true, effective_date: '2018-05-25', dim_count: 15, impact_count: 4, open_gaps: 3, max_impact: 'critical' },
  ],
};

const STUB_COMPLIANCE_DETAIL = {
  id: 'comp-eu-ai-act', item_type: 'regulation', name: 'EU AI Act', short_name: 'EU AI Act',
  description: 'The EU AI Act is a comprehensive legal framework establishing risk-based requirements for artificial intelligence systems operating within or affecting the European Union.',
  issuing_body: 'European Parliament', jurisdiction: ['EU'], status: 'active', ai_researched: true, effective_date: '2024-08-01',
  dimensions: [
    { id: 'd1', name: 'Transparency', description: 'AI systems must be transparent to users.' },
    { id: 'd2', name: 'Human Oversight', description: 'High-risk AI must support human oversight.' },
    { id: 'd3', name: 'Data Governance', description: 'Training data must meet quality standards.' },
  ],
};

const STUB_AUDIT_RUNS = {
  runs: [
    { id: 'run-001', use_case_name: 'IT Service Desk Automation', status: 'completed', overall_risk: 'medium', total_pairs: 3, completed_pairs: 3, failed_pairs: 0, summary_text: 'Medium overall compliance risk. EU AI Act transparency requirements need documentation. SOC 2 controls largely in place.', initiated_by: 'sanjeev@tavro.ai', created_at: '2025-05-20T09:00:00Z', completed_at: '2025-05-20T09:45:00Z', critical_count: 0, high_count: 1 },
    { id: 'run-002', use_case_name: 'Vendor Risk Assessment', status: 'completed', overall_risk: 'high', total_pairs: 3, completed_pairs: 3, failed_pairs: 0, summary_text: 'High compliance risk against GDPR due to third-party data sharing. EU AI Act high-risk category may apply.', initiated_by: 'sanjeev@tavro.ai', created_at: '2025-05-18T14:00:00Z', completed_at: '2025-05-18T14:55:00Z', critical_count: 0, high_count: 2 },
  ],
};

const STUB_AUDIT_DETAIL = {
  id: 'run-001', use_case_name: 'IT Service Desk Automation', status: 'completed', overall_risk: 'medium',
  summary_text: 'IT Service Desk Automation presents medium overall compliance risk. EU AI Act transparency requirements need documentation. SOC 2 controls are largely satisfied.',
  findings: [
    { compliance_item: 'EU AI Act', risk_level: 'high', gap: 'Transparency documentation missing', recommendation: 'Add user-facing transparency notices.' },
    { compliance_item: 'SOC 2', risk_level: 'low', gap: 'Controls largely satisfied', recommendation: 'Maintain current access controls.' },
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

const STUB_COMPANIES = {
  items: [{ id: 'demo-company-001', name: 'Tavro Financial Services', industry: 'Financial Services', is_public: false }],
  total: 1, offset: 0, limit: 50,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Fill a visible input by placeholder; skip gracefully if not found. */
async function tryFill(page: any, placeholder: string, value: string): Promise<void> {
  const el = page.getByPlaceholder(placeholder);
  if (await el.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await el.fill(value);
    await page.waitForTimeout(400);
  }
}

/** Click a button by name regex; skip if not found. */
async function tryClick(page: any, name: RegExp | string): Promise<void> {
  const btn = page.getByRole('button', { name });
  if (await btn.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
    await btn.first().click();
    await page.waitForTimeout(600);
  }
}

// ── Demo ───────────────────────────────────────────────────────────────────────

/**
 * Demo: Complete Product Tour — all sidebar sections in ONE browser session.
 *
 * Choreography:
 *   1.  Home
 *   2.  AI Use Cases   → list → detail → create
 *   3.  Agent Catalog  → list → detail → create
 *   4.  Applications   → list → detail → create
 *   5.  Processes      → list → detail → create
 *   6.  Insights       → view
 *   7.  Blueprint      → org graph → setup wizard
 *   8.  Compliance     → list → detail → create form
 *   9.  Audit Center   → runs list → run detail
 *   10. Agent Playground → send prompt → response
 *
 * Produces: test-results/demo-chrome/07-product-tour/video.webm
 *           demo-screenshots/07-*.png
 */
test('07 — Complete Product Tour', async ({ page }) => {
  // ── Stubs (LIFO: catch-all first, specific last = highest priority) ──────────
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/v1/business-relations**', (route) => route.fulfill({ json: { applications: [], processes: [] } }));
  await page.route('**/api/v1/dim-types**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/dim-nodes**', (route) => route.fulfill({ json: { items: [], total: 0 } }));
  await page.route('**/api/v1/graph/**', (route) => route.fulfill({ json: STUB_BLUEPRINT_GRAPH }));
  await page.route('**/api/v1/companies**', (route) => route.fulfill({ json: STUB_COMPANIES }));
  await page.route('**/api/v1/audit**', async (route) => {
    const url = route.request().url();
    if (/\/audit\/[^?/]+/.test(url)) return route.fulfill({ json: STUB_AUDIT_DETAIL });
    return route.fulfill({ json: STUB_AUDIT_RUNS });
  });
  await page.route('**/api/v1/compliance**', async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    if (method === 'POST') return route.fulfill({ json: { id: 'comp-new-001', name: 'NIST AI RMF', status: 'active' } });
    if (/\/compliance\/[^?/]+/.test(url)) return route.fulfill({ json: STUB_COMPLIANCE_DETAIL });
    return route.fulfill({ json: STUB_COMPLIANCE_ITEMS });
  });
  await page.route('**/api/v1/use-cases**', (route) => route.fulfill({ json: STUB_USE_CASES }));
  await page.route('**/api/v1/use-cases/**', (route) => route.fulfill({ json: STUB_USE_CASE_DETAIL }));
  await page.route('**/api/v1/agents**', async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    if (method === 'POST') return route.fulfill({ json: { agent_id: 'agent-new-001', agent_name: 'Credit Risk Analyzer', message: 'Agent created successfully.' } });
    if (/\/agents\/[^?/]+/.test(url)) return route.fulfill({ json: STUB_AGENT_DETAIL });
    return route.fulfill({ json: STUB_AGENTS });
  });
  await page.route('**/api/v1/applications**', async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    if (method === 'POST') return route.fulfill({ json: STUB_APP_CREATED });
    if (/\/applications\/[^?/]+/.test(url)) return route.fulfill({ json: STUB_APPLICATIONS.items[0] });
    return route.fulfill({ json: STUB_APPLICATIONS });
  });
  await page.route('**/api/v1/processes**', async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    if (method === 'POST') return route.fulfill({ json: STUB_PROC_CREATED });
    if (/\/processes\/[^?/]+/.test(url)) return route.fulfill({ json: STUB_PROCESSES.items[0] });
    return route.fulfill({ json: STUB_PROCESSES });
  });
  await stubMcpServer(page, STUB_AGENTS.agents, STUB_USE_CASES.use_cases);
  await stubRuntimeConfig(page);

  // ── Bootstrap ────────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginToTavro(page);
  await page.waitForTimeout(2_000);

  // ── 1. Home ──────────────────────────────────────────────────────────────────
  await page.screenshot({ path: 'demo-screenshots/07-01-home.png' });
  await page.waitForTimeout(1_000);

  // ── 2. AI Use Cases ──────────────────────────────────────────────────────────
  await page.goto('/use-cases');
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: 'demo-screenshots/07-02-use-cases-list.png' });

  // View detail
  await page.goto('/use-case/uc-001');
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: 'demo-screenshots/07-03-uc-detail.png' });
  await page.waitForTimeout(1_000);

  // Create
  await page.goto('/use-cases');
  await page.waitForTimeout(1_000);
  await tryClick(page, /new use case/i);
  await page.waitForTimeout(1_500);
  await tryFill(page, 'e.g. Invoice Processing Automation', 'AI-Driven Credit Scoring');
  await tryFill(page, 'Brief overview of what this AI use case does…', 'Automates credit risk assessment using ML models to evaluate loan applications in real-time.');
  await tryFill(page, 'Team or person responsible', 'Risk & Compliance');
  await tryFill(page, 'Originator of the idea', 'CFO Office');
  await tryFill(page, 'e.g. Finance, Operations, HR', 'Finance');
  await tryFill(page, 'What problem does this use case solve?', 'Manual credit scoring is slow, inconsistent, and prone to human error — delaying loan approvals by 3–5 days.');
  await tryFill(page, 'What outcomes and improvements are expected?', '60% reduction in scoring time, improved accuracy, and consistent regulatory compliance across all loan decisions.');
  await page.screenshot({ path: 'demo-screenshots/07-04-uc-create-form.png' });
  await tryClick(page, /create use case/i);
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: 'demo-screenshots/07-05-uc-created.png' });

  // ── 3. Agent Catalog ─────────────────────────────────────────────────────────
  await page.goto('/catalog');
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: 'demo-screenshots/07-06-catalog-list.png' });

  // View detail
  await page.goto('/agent/agent-mia-001');
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: 'demo-screenshots/07-07-agent-detail.png' });
  await page.waitForTimeout(1_000);

  // Create
  await page.goto('/catalog');
  await page.waitForTimeout(1_000);
  await tryClick(page, /new agent/i);
  await page.waitForTimeout(1_500);
  await tryFill(page, 'e.g. Fraud Case Triage Agent', 'Credit Risk Analyzer');
  const descInput = page.getByPlaceholder(/description|what does this agent do/i).first();
  if (await descInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await descInput.fill('Analyzes credit applications using ML models, bureau data, and behavioural signals to generate real-time risk scores.');
    await page.waitForTimeout(400);
  }
  const instrInput = page.locator('textarea').nth(1);
  if (await instrInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await instrInput.fill('Retrieve applicant data, calculate credit score using approved models, flag high-risk cases for human review, and return recommendation with confidence level.');
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: 'demo-screenshots/07-08-agent-create-form.png' });
  await tryClick(page, /create agent|save agent/i);
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: 'demo-screenshots/07-09-agent-created.png' });

  // ── 4. Applications ───────────────────────────────────────────────────────────
  await page.goto('/applications');
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: 'demo-screenshots/07-10-apps-list.png' });

  // View detail — navigate directly
  await page.goto('/applications/app-001');
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: 'demo-screenshots/07-11-app-detail.png' });

  // Create
  await page.goto('/applications');
  await page.waitForTimeout(1_000);
  await tryClick(page, /new application/i);
  await page.waitForTimeout(1_500);
  const appNameInput = page.locator('input[placeholder*="application" i], input[placeholder*="name" i], input').first();
  if (await appNameInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await appNameInput.fill('Tavro Risk Portal');
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: 'demo-screenshots/07-12-app-create-form.png' });
  await tryClick(page, /save|create|submit/i);
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: 'demo-screenshots/07-13-app-created.png' });

  // ── 5. Processes ──────────────────────────────────────────────────────────────
  await page.goto('/processes');
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: 'demo-screenshots/07-14-processes-list.png' });

  // View detail
  await page.goto('/processes/proc-001');
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: 'demo-screenshots/07-15-process-detail.png' });

  // Create
  await page.goto('/processes');
  await page.waitForTimeout(1_000);
  await tryClick(page, /new process/i);
  await page.waitForTimeout(1_500);
  const procNameInput = page.locator('input[placeholder*="process" i], input[placeholder*="name" i], input').first();
  if (await procNameInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await procNameInput.fill('AI Risk Governance');
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: 'demo-screenshots/07-16-process-create-form.png' });
  await tryClick(page, /save|create|submit/i);
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: 'demo-screenshots/07-17-process-created.png' });

  // ── 6. Insights ───────────────────────────────────────────────────────────────
  await page.goto('/insights');
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: 'demo-screenshots/07-18-insights.png' });
  await page.waitForTimeout(1_000);

  // ── 7. Blueprint ──────────────────────────────────────────────────────────────
  await page.goto('/blueprint');
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: 'demo-screenshots/07-19-blueprint-graph.png' });
  await page.waitForTimeout(1_000);

  // Open setup wizard
  await page.goto('/blueprint/setup');
  await page.waitForTimeout(1_500);
  await page.getByPlaceholder('e.g. BankUnited', { exact: true }).fill('Tavro Financial Services');
  await page.waitForTimeout(400);
  await page.getByPlaceholder('e.g. Commercial Banking').fill('Financial Services');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /private company/i }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'demo-screenshots/07-20-blueprint-setup.png' });
  await tryClick(page, /continue/i);
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: 'demo-screenshots/07-21-blueprint-setup-step2.png' });

  // ── 8. Compliance ─────────────────────────────────────────────────────────────
  await page.goto('/compliance');
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: 'demo-screenshots/07-22-compliance-list.png' });

  // View EU AI Act detail
  await page.goto('/compliance/comp-eu-ai-act');
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: 'demo-screenshots/07-23-eu-ai-act-detail.png' });
  await page.waitForTimeout(1_000);

  // Create new regulation (show step 1 form)
  await page.goto('/compliance/new?type=regulation');
  await page.waitForTimeout(1_500);
  await tryFill(page, /regulation name|name/i, 'NIST AI Risk Management Framework');
  const shortNameInput = page.locator('input').nth(1);
  if (await shortNameInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await shortNameInput.fill('NIST AI RMF');
    await page.waitForTimeout(400);
  }
  await tryFill(page, /issuing body|issued by/i, 'NIST');
  await page.screenshot({ path: 'demo-screenshots/07-24-compliance-create.png' });
  await page.waitForTimeout(1_500);

  // ── 9. Audit Center ───────────────────────────────────────────────────────────
  await page.goto('/audit');
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: 'demo-screenshots/07-25-audit-center.png' });

  // Click first audit run card
  const runCard = page.locator('[class*="cursor-pointer"][class*="rounded"]').first();
  if (await runCard.isVisible({ timeout: 4_000 }).catch(() => false)) {
    await runCard.click();
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: 'demo-screenshots/07-26-audit-detail.png' });
  }
  await page.waitForTimeout(1_000);

  // ── 10. Agent Playground ──────────────────────────────────────────────────────
  await page.goto('/playground');
  await page.waitForTimeout(1_500);
  await runAgent(
    page,
    'Which AI agents in my catalog carry the highest compliance risk against the EU AI Act, and what are the top 3 remediation steps?',
  );
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'demo-screenshots/07-27-playground-prompt.png' });
  await page.waitForTimeout(4_500);
  await page.screenshot({ path: 'demo-screenshots/07-28-playground-response.png' });
  await page.waitForTimeout(2_000);
});
