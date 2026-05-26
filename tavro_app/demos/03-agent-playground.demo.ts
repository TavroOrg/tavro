import { test } from '@playwright/test';
import { loginToTavro, stubRuntimeConfig, stubMcpServer, runAgent } from '../actions';

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
  ],
};

/**
 * Demo: AI Playground — interactive agentic session
 *
 * Choreography:
 *   1. Login and land on home page
 *   2. Navigate to the AI Playground
 *   3. Start an agent session
 *   4. Send a realistic business prompt
 *   5. Show the response streaming
 *   6. Screenshot the result for marketing images
 *
 * Produces: test-results/demo-chrome/03-agent-playground/video.webm
 *           demo-screenshots/03-playground-response.png
 */
test('03 — AI Agent Playground', async ({ page }) => {
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await stubMcpServer(page, STUB_AGENTS.agents);
  await stubRuntimeConfig(page);

  await loginToTavro(page);
  await page.waitForTimeout(1_500); // let home page settle

  await page.setViewportSize({ width: 1920, height: 1080 });

  await runAgent(
    page,
    'What are the highest-risk AI agents in my catalog, and what mitigation steps do you recommend?',
  );
  await page.waitForTimeout(600); // brief pause before screenshot

  await page.screenshot({ path: 'demo-screenshots/03-playground-prompt.png' });
  await page.waitForTimeout(4_500); // let the response stream visibly

  await page.screenshot({ path: 'demo-screenshots/03-playground-response.png' });
  await page.waitForTimeout(2_000);
});
