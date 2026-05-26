import { test } from '@playwright/test';
import { loginToTavro, navigateToCatalog, searchAgents, clickSidebarLink, stubMcpServer, stubRuntimeConfig } from '../actions';

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

/**
 * Demo: Catalog overview
 *
 * Choreography:
 *   1. Land on home page after login
 *   2. Navigate to the Agent Catalog
 *   3. Search for an agent by keyword
 *   4. Clear the search and browse the full list
 *   5. Show sidebar navigation
 *
 * Produces: test-results/demo-chrome/01-catalog-overview/video.webm
 */
test('01 — Agent Catalog overview', async ({ page }) => {
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await stubMcpServer(page, STUB_AGENTS.agents);
  await stubRuntimeConfig(page);

  await loginToTavro(page);
  await page.waitForTimeout(1_500); // let the home page settle

  await navigateToCatalog(page);
  await page.waitForTimeout(2_000); // let catalog load

  await searchAgents(page, 'Risk');
  await page.waitForTimeout(1_500);

  await searchAgents(page, '');
  await page.waitForTimeout(2_000); // show full list

  // Show sidebar by hovering/clicking a link
  await clickSidebarLink(page, /use.cases/i);
  await page.waitForTimeout(1_500);
});
