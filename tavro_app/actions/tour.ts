import { Page } from '@playwright/test';
import { stubMcpServer } from './mcp-stub';

export const TOUR_AGENT_ID = 'TOUR-AGENT-001';
export const TOUR_USE_CASE_ID = 'UC-TOUR-001';

export const TOUR_STEP_TITLES = [
    'Welcome to Tavro Agent BizOps',
    'AI Use Case Catalog',
    'Use Case Deep Dive',
    'AI Agent Catalog',
    'Complete Agent Profile',
    'Test Before You Trust',
    'Configure Your Session',
    'Start a Live Session',
    'Live Agent Interaction',
    'Ready to govern your AI agents?',
] as const;

export const TOTAL_TOUR_STEPS = TOUR_STEP_TITLES.length;

export const TOUR_SAMPLE_AGENT = {
    name: 'Classify Service & CI AI Agent',
    description:
        'Incident service and offering categorizer. Assigns the appropriate service, service offering, and configuration item to an incident automatically.',
    version: '1.0.1',
    identification: {
        agent_id: TOUR_AGENT_ID,
        agent_internal_id: TOUR_AGENT_ID,
        role: 'Incident Classification Specialist',
        owner: 'IT Operations',
        environment: 'Production',
        governance_status: 'Approved',
        goal_orientation: '0.8',
    },
    configuration: {
        autonomy_level: '0.5',
        access_scope: 'ServiceNow ITSM',
        memory_type: 'Session',
        reasoning_model: 'Chain-of-Thought',
    },
    risk_assessment: {
        blended_risk_classification: 'High',
        blended_risk_score: 72,
        regulatory_risk_classification: 'Limited Risk',
        summary: 'Medium risk due to automated incident routing affecting SLA compliance.',
        state: 'Completed',
    },
    ai_use_case: {
        identifier: TOUR_USE_CASE_ID,
        name: 'Automate Incident Triage',
        description: 'Automatically classify and route incidents to reduce MTTR',
        status: 'In Progress',
        priority: 'High',
    },
    application: [
        {
            identifier: 'APP-001',
            name: 'ServiceNow',
            description: 'IT Service Management platform',
            business_criticality: 'Mission Critical',
            emergency_tier: 'Tier 1',
        },
    ],
    ai_model: [{ name: 'GPT-4o', description: 'OpenAI GPT-4o', owner: 'OpenAI' }],
    tool: [
        { identifier: null, name: 'Find configuration items', description: 'Finds CIs from multiple sources' },
        { identifier: null, name: 'Retrieve incident details', description: 'Fetches complete incident information' },
        { identifier: null, name: 'Update incident', description: 'Updates incident with AI recommendations' },
    ],
    provider: { organization: 'ServiceNow Now Platform', url: '' },
};

export const TOUR_SAMPLE_USE_CASE = {
    identifier: TOUR_USE_CASE_ID,
    use_case_id: TOUR_USE_CASE_ID,
    name: 'Automate Incident Triage',
    title: 'Automate Incident Triage',
    description: 'Automatically classify and route incidents to reduce MTTR',
    status: 'In Progress',
    priority: 'High',
    use_case_owner: 'IT Operations',
    business_problem_statement: 'Manual incident routing is slow and error-prone.',
    expected_benefits: 'Reduced MTTR and improved SLA compliance.',
    agents: [TOUR_SAMPLE_AGENT],
};

/**
 * Stubs all network requests needed for the product tour to run end-to-end
 * in Playwright without a live backend. Also clears any persisted tour state
 * so every test starts fresh.
 */
export async function setupTourMocks(page: Page): Promise<void> {
    await page.addInitScript(() => {
        localStorage.removeItem('tavro_tour_done');
        sessionStorage.removeItem('tavro_tour_active');
        sessionStorage.removeItem('tavro_tour_step');
    });

    await page.route('**/runtime/tavro-runtime-config.json', (route) =>
        route.fulfill({
            json: {
                zitadelIssuer: 'https://test.zitadel.tavro.ai',
                zitadelClientId: 'playwright-test-client',
            },
        }),
    );

    await page.route('**/api/v1/onboarding-tour/**', async (route) => {
        if (route.request().method() === 'POST') {
            return route.fulfill({ json: { ok: true } });
        }
        return route.fulfill({ json: { showTour: true, status: 'not_started' } });
    });

    // Agent list and individual agent card
    await page.route(/\/api\/v1\/agents\/[^?]+/, (route) =>
        route.fulfill({ json: TOUR_SAMPLE_AGENT }),
    );
    await page.route(/\/api\/v1\/agents(\?.*)?$/, (route) =>
        route.fulfill({ json: { agents: [TOUR_SAMPLE_AGENT], total_records: 1 } }),
    );

    // Use case list and individual use case
    await page.route(/\/api\/v1\/use-cases\/[^?]+/, (route) =>
        route.fulfill({ json: { data: [TOUR_SAMPLE_USE_CASE], total_records: 1, start_record: 1, end_record: 1, record_count: 1 } }),
    );
    await page.route(/\/api\/v1\/use-cases(\?.*)?$/, (route) =>
        route.fulfill({ json: { use_cases: [TOUR_SAMPLE_USE_CASE], total_records: 1 } }),
    );

    // MCP server — provides the catalog and use-case data for context-aware pages
    await stubMcpServer(page, [TOUR_SAMPLE_AGENT], [TOUR_SAMPLE_USE_CASE]);
}

/** Clicks the primary tour button (Start / Next) on the visible tooltip. */
export async function advanceTour(page: Page): Promise<void> {
    await page.getByRole('button', { name: /^(Start|Next)$/i }).click();
}

/** Waits for a tour step tooltip to become visible by its title text. */
export async function waitForTourStep(
    page: Page,
    title: (typeof TOUR_STEP_TITLES)[number],
    timeout = 8_000,
): Promise<void> {
    await page.getByText(title, { exact: false }).waitFor({ state: 'visible', timeout });
}
