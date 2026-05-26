import { test } from '@playwright/test';
import {
  loginToTavro,
  stubRuntimeConfig,
  navigateToCompliance,
  navigateToComplianceItem,
  navigateToAudit,
  clickFirstAuditRun,
} from '../actions';

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
      description: 'Security, availability, and confidentiality standards for service organizations.',
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
    {
      id: 'comp-gdpr',
      item_type: 'regulation',
      scope: 'external',
      name: 'GDPR',
      short_name: 'GDPR',
      description: 'EU regulation on data protection and privacy for all individuals within the EU.',
      issuing_body: 'European Commission',
      jurisdiction: ['EU'],
      industry_tags: ['all'],
      status: 'active',
      ai_researched: true,
      effective_date: '2018-05-25',
      created_at: '2025-03-01T10:00:00Z',
      updated_at: '2025-05-12T10:00:00Z',
      dim_count: 15,
      impact_count: 4,
      open_gaps: 3,
      max_impact: 'critical',
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
      agent_id: null,
      agent_name: null,
      compliance_item_id: null,
      compliance_item_name: null,
      status: 'completed',
      total_pairs: 3,
      completed_pairs: 3,
      failed_pairs: 0,
      overall_risk: 'medium',
      summary_text:
        'IT Service Desk Automation presents medium overall compliance risk. EU AI Act requires transparency and human oversight documentation. SOC 2 controls are largely satisfied. GDPR data minimisation gaps require attention.',
      initiated_by: 'sanjeev@tavro.ai',
      created_at: '2025-05-20T09:00:00Z',
      updated_at: '2025-05-20T09:45:00Z',
      completed_at: '2025-05-20T09:45:00Z',
      critical_count: 0,
      high_count: 1,
    },
    {
      id: 'run-002',
      company_id: 'tavro-demo',
      scope_type: 'use_case_all',
      use_case_id: 'uc-002',
      use_case_name: 'Vendor Risk Assessment',
      agent_id: null,
      agent_name: null,
      compliance_item_id: null,
      compliance_item_name: null,
      status: 'completed',
      total_pairs: 3,
      completed_pairs: 3,
      failed_pairs: 0,
      overall_risk: 'high',
      summary_text:
        'Vendor Risk Assessment shows high compliance risk against GDPR due to third-party data sharing. EU AI Act high-risk category classification may apply.',
      initiated_by: 'sanjeev@tavro.ai',
      created_at: '2025-05-18T14:00:00Z',
      updated_at: '2025-05-18T14:55:00Z',
      completed_at: '2025-05-18T14:55:00Z',
      critical_count: 0,
      high_count: 2,
    },
  ],
};

/**
 * Demo: Compliance & Audit workflow
 *
 * Choreography:
 *   1. Login and navigate to Compliance
 *   2. Browse the compliance library (EU AI Act, SOC 2, GDPR)
 *   3. Open the EU AI Act detail page — show dimensions and impacts
 *   4. Navigate to Audit Center
 *   5. Show completed audit runs
 *   6. Click into an audit run — show findings and risk summary
 *
 * Produces: test-results/demo-chrome/05-compliance-workflow/video.webm
 *           demo-screenshots/05-compliance-library.png
 *           demo-screenshots/05-audit-findings.png
 */
test('05 — Compliance & Audit Workflow', async ({ page }) => {
  // BlueprintContext seeds activeCompany — without it the Audit page shows a banner
  // and makes no API calls for runs.
  const STUB_COMPANIES = {
    items: [{ id: 'demo-company-001', name: 'Tavro Financial Services', industry: 'Financial Services', is_public: false }],
    total: 1, offset: 0, limit: 50,
  };

  // LIFO — catch-all first, specific stubs last (highest priority)
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/v1/graph/**', (route) => route.fulfill({ json: { nodes: [], edges: [] } }));
  await page.route('**/api/v1/dim-nodes**', (route) => route.fulfill({ json: { items: [], total: 0 } }));
  await page.route('**/api/v1/dim-types**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/companies**', (route) => route.fulfill({ json: STUB_COMPANIES }));
  await page.route('**/api/v1/audit**', (route) => route.fulfill({ json: STUB_AUDIT_RUNS }));
  await page.route('**/api/v1/compliance**', (route) => route.fulfill({ json: STUB_COMPLIANCE_ITEMS }));
  await stubRuntimeConfig(page);

  await loginToTavro(page);
  await page.waitForTimeout(1_500);

  await page.setViewportSize({ width: 1920, height: 1080 });

  // Browse the compliance library
  await navigateToCompliance(page);
  await page.waitForTimeout(2_500); // let the list populate

  await page.screenshot({ path: 'demo-screenshots/05-compliance-library.png' });
  await page.waitForTimeout(1_500);

  // Drill into EU AI Act
  await navigateToComplianceItem(page, 'comp-eu-ai-act');
  await page.waitForTimeout(2_500); // show dimensions panel

  await page.screenshot({ path: 'demo-screenshots/05-eu-ai-act-detail.png' });
  await page.waitForTimeout(1_500);

  // Navigate to Audit Center
  await navigateToAudit(page);
  await page.waitForTimeout(2_000); // let the run history load

  await page.screenshot({ path: 'demo-screenshots/05-audit-center.png' });
  await page.waitForTimeout(1_000);

  // Open the most recent audit run — audit cards are divs with cursor-pointer
  const runCard = page.locator('[class*="cursor-pointer"][class*="rounded-xl"]').first();
  if (await runCard.isVisible({ timeout: 4_000 }).catch(() => false)) {
    await runCard.click();
    await page.waitForTimeout(2_500); // show findings and risk badges
    await page.screenshot({ path: 'demo-screenshots/05-audit-findings.png' });
  }
  await page.waitForTimeout(2_000);
});
