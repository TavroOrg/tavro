import { Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { stubMcpServer } from './mcp-stub';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_DATA_DIR = resolve(__dirname, '../../sample-data');

function loadSampleDataAgents(): any[] {
    try {
        return readdirSync(SAMPLE_DATA_DIR)
            .filter((f: string) => f.endsWith('.json'))
            .map((f: string) => JSON.parse(readFileSync(resolve(SAMPLE_DATA_DIR, f), 'utf-8')));
    } catch {
        return [];
    }
}

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
        instruction: 'Step 1 — Read: Retrieve the full incident record including short description, category, sub-category, and priority from ServiceNow.\n\nStep 2 — Classify: Analyse the incident text to identify the affected service and configuration item using the CMDB lookup tool. Match against known service catalogue entries.\n\nStep 3 — Route: Assign the correct service, service offering, and CI to the incident. Update the assignment group based on the classification outcome.\n\nStep 4 — Audit: Log all classification decisions with confidence scores and source evidence to the audit trail. Escalate low-confidence cases to L1 for manual review.',
    },
    configuration: {
        autonomy_level: '0.5',
        access_scope: 'ServiceNow ITSM',
        memory_type: 'Session',
        reasoning_model: 'Chain-of-Thought',
    },
    risk_assessment: {
        blended_risk_classification: 'Low',
        blended_risk_score: 1.8,
        regulatory_risk_classification: 'Limited Risk',
        summary: 'Low blended risk. Agent operates within a well-defined scope with human oversight on low-confidence classifications.',
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
    description: 'Automatically classify and route incidents to reduce MTTR and improve SLA compliance across IT operations.',
    status: 'In Progress',
    priority: 'High',
    owner: 'IT Operations',
    use_case_owner: 'IT Operations',
    function: 'IT Operations',
    problem_statement: 'Manual incident triage requires L1 agents to read, categorise, and route each ticket by hand. This introduces 8–15 minutes of handling time per incident, causes misrouting errors, and delays SLA-critical responses — particularly during high-volume periods.',
    business_problem_statement: 'Manual incident triage requires L1 agents to read, categorise, and route each ticket by hand. This introduces 8–15 minutes of handling time per incident, causes misrouting errors, and delays SLA-critical responses — particularly during high-volume periods.',
    expected_benefits: 'Reduce average triage time from 12 minutes to under 90 seconds. Cut misrouting errors by 70%. Improve P1/P2 SLA attainment from 74% to 95%+. Free L1 agents to focus on complex, high-value incidents.',
    solution_approach: 'Deploy an AI agent connected to ServiceNow that reads incoming incident descriptions, retrieves relevant CI and service data, and automatically assigns the correct service, service offering, and configuration item — then routes the ticket to the appropriate resolver group without human intervention.',
    agents: [TOUR_SAMPLE_AGENT],
};

/** All agents shown in the catalog during the tour — primary tour agent first, then all agents from sample-data/. */
export const TOUR_CATALOG_AGENTS = [TOUR_SAMPLE_AGENT, ...loadSampleDataAgents()];

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
        route.fulfill({ json: { agents: TOUR_CATALOG_AGENTS, total_records: TOUR_CATALOG_AGENTS.length } }),
    );

    // Use case list and individual use case
    await page.route(/\/api\/v1\/use-cases\/[^?]+/, (route) =>
        route.fulfill({ json: { data: [TOUR_SAMPLE_USE_CASE], total_records: 1, start_record: 1, end_record: 1, record_count: 1 } }),
    );
    await page.route(/\/api\/v1\/use-cases(\?.*)?$/, (route) =>
        route.fulfill({ json: { use_cases: [TOUR_SAMPLE_USE_CASE], total_records: 1 } }),
    );

    // MCP server — provides the catalog and use-case data for context-aware pages
    await stubMcpServer(page, TOUR_CATALOG_AGENTS, [TOUR_SAMPLE_USE_CASE]);
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
