/**
 * Playwright-driven product tour demo.
 *
 * The entire tour UI (spotlight + tooltip) is injected into the live app by
 * Playwright. No react-joyride. The user clicks Next / Back on the injected
 * buttons; Playwright detects the click, navigates to the next page if
 * necessary, and injects the next step's UI.
 *
 * Run with:
 *   npm run demo:tour
 */

import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loginToTavro, stubMcpServer } from '../../actions';
import {
    TOUR_SAMPLE_AGENT,
    TOUR_SAMPLE_USE_CASE,
    TOUR_CATALOG_AGENTS,
    TOUR_AGENT_ID,
} from '../../actions/tour';

// ── Tour content ──────────────────────────────────────────────────────────────

const TOUR_AGENT_NAME = 'Classify Service & CI AI Agent';
const TOUR_AGENT_DESC =
    'Incident service and offering categorizer. Assigns the appropriate service, ' +
    'service offering, and configuration item to an incident automatically.';
const PLAYGROUND_URL =
    `/playground?useCase=${encodeURIComponent(TOUR_AGENT_ID)}` +
    `&title=${encodeURIComponent(TOUR_AGENT_NAME)}` +
    `&desc=${encodeURIComponent(TOUR_AGENT_DESC)}`;

interface DemoStep {
    title: string;
    content: string;
    target: string;
    placement: 'top' | 'bottom' | 'left' | 'right' | 'center';
    url: string;
    /** Custom DOM event to dispatch before showing this step. */
    preEvent?: string;
    /** ms to wait after dispatching preEvent before injecting the UI. */
    preDelay?: number;
}

const STEPS: DemoStep[] = [
    {
        title: 'Welcome to Tavro Agent BizOps',
        content:
            "The governance platform for your AI agents. In 2 minutes you'll see how to " +
            'register, risk-assess, and interact with AI agents end-to-end.',
        target: '#tour-logo',
        placement: 'right',
        url: '/',
    },
    {
        title: 'AI Use Case Catalog',
        content:
            'Define and track every AI-led initiative here. Each use case captures the ' +
            'business objective, owner, priority, and delivery status.',
        target: '#tour-usecase-card-0',
        placement: 'bottom',
        url: '/use-cases',
    },
    {
        title: 'Use Case Deep Dive',
        content:
            'Open any use case to review its owner, priority, linked agents, and full ' +
            'business context in a single governed view.',
        target: '#tour-usecase-detail-card',
        placement: 'bottom',
        url: `/use-case/UC-TOUR-001`,
    },
    {
        title: 'AI Agent Catalog',
        content:
            'Every AI agent in your organisation is registered here — with its owner, ' +
            'version, deployment environment, and current governance status.',
        target: '#tour-agent-catalog-section',
        placement: 'top',
        url: '/catalog',
    },
    {
        title: 'Complete Agent Profile',
        content:
            'The full agent profile covers configuration, risk scores, tool dependencies, ' +
            'connected systems, and audit-ready metadata — everything needed for governance sign-off.',
        target: '#tour-agent-detail-section',
        placement: 'top',
        url: `/agent/${TOUR_AGENT_ID}`,
    },
    {
        title: 'Test Before You Trust',
        content:
            'Click "Open in Playground" to launch this agent for a live session. Validate ' +
            'its behaviour and capture findings before it reaches production.',
        target: '#tour-playground-btn',
        placement: 'bottom',
        url: `/agent/${TOUR_AGENT_ID}`,
    },
    {
        title: 'Configure Your Session',
        content:
            "Select your LLM provider, review the agent's configuration, and get ready to " +
            'run a live interactive session with full observability.',
        target: '#tour-playground-config-section',
        placement: 'top',
        url: PLAYGROUND_URL,
        preEvent: 'tavro:tour-open-config',
        preDelay: 700,
    },
    {
        title: 'Start a Live Session',
        content:
            'Click "Start session" to open a real-time conversation with this agent. ' +
            'Prompt it, observe its reasoning, and capture what you find.',
        target: '#tour-start-session',
        placement: 'bottom',
        url: PLAYGROUND_URL,
    },
    {
        title: 'Live Agent Interaction',
        content:
            'Send messages, review responses, and watch tool calls in real time. Add ' +
            'observations to the session notes and download a full transcript when done.',
        target: '#tour-chat-interaction',
        placement: 'top',
        url: PLAYGROUND_URL,
        preEvent: 'tavro:tour-open-chat',
        preDelay: 950,
    },
    {
        title: 'Ready to govern your AI agents?',
        content:
            "You've seen how Tavro registers, risk-assesses, and lets you test AI agents. " +
            'Book a demo to run it with your real agents and use cases.',
        target: 'body',
        placement: 'center',
        url: PLAYGROUND_URL,
    },
];

// ── UI injection helpers ──────────────────────────────────────────────────────

/**
 * Injects the spotlight + tooltip for the given step into the live page.
 * All DOM manipulation happens inside page.evaluate so it runs in the browser.
 */
async function showStep(page: Page, step: DemoStep, index: number): Promise<void> {
    await page.evaluate(
        ({ title, content, target, placement, index, total }) => {
            document.getElementById('__pw_tour')?.remove();
            (window as any).__pw_tour_action = null;

            const root = document.createElement('div');
            root.id = '__pw_tour';
            document.body.appendChild(root);

            const el =
                target === 'body' ? null : document.querySelector<HTMLElement>(target);
            const rect = el?.getBoundingClientRect() ?? null;
            const pad = 8;
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            // ── Blocking layer (prevents clicks reaching the underlying page) ──
            const blocker = document.createElement('div');
            blocker.style.cssText = 'position:fixed;inset:0;z-index:9997;';
            root.appendChild(blocker);

            // ── Spotlight / overlay ───────────────────────────────
            if (rect) {
                const spot = document.createElement('div');
                spot.style.cssText =
                    `position:fixed;` +
                    `top:${rect.top - pad}px;left:${rect.left - pad}px;` +
                    `width:${rect.width + pad * 2}px;height:${rect.height + pad * 2}px;` +
                    `box-shadow:0 0 0 9999px rgba(15,23,42,0.72);` +
                    `border-radius:12px;z-index:9998;pointer-events:none;`;
                root.appendChild(spot);
            } else {
                const ov = document.createElement('div');
                ov.style.cssText =
                    'position:fixed;inset:0;background:rgba(15,23,42,0.72);z-index:9998;pointer-events:none;';
                root.appendChild(ov);
            }

            // ── Tooltip ───────────────────────────────────────────
            const isFirst = index === 0;
            const isLast = index === total - 1;
            const primaryLabel = isLast ? 'Book a Demo' : isFirst ? 'Start' : 'Next';
            const pct = Math.max(18, ((index + 1) / total) * 100);

            const tip = document.createElement('div');
            tip.id = '__pw_tour_tip';
            tip.style.cssText =
                'position:fixed;z-index:9999;width:320px;max-width:86vw;' +
                'background:#f3f3f3;border-radius:12px;border:1px solid #d9d9d9;' +
                "box-shadow:0 10px 30px rgba(0,0,0,0.18);" +
                "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";

            tip.innerHTML =
                `<div style="height:8px;border-radius:12px 12px 0 0;overflow:hidden;padding:2px 4px 0;">` +
                `<div style="height:8px;border-radius:4px;background:#241b61;width:${pct}%;transition:width .3s;"></div></div>` +
                `<div style="padding:32px 24px 28px;font-size:15px;line-height:1.6;color:#1f1f1f;">` +
                `<span style="font-weight:700;">${title} </span><span>${content}</span></div>` +
                `<div style="border-top:1px solid #d9d9d9;padding:12px 16px;">` +
                `<div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;">` +
                (!isFirst
                    ? `<button id="__pw_back" style="justify-self:start;border:1px solid #241b61;background:#f3f3f3;color:#241b61;padding:8px 16px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;">Back</button>`
                    : '<div></div>') +
                `<span style="text-align:center;font-size:14px;color:#737373;">${index + 1} of ${total}</span>` +
                `<button id="__pw_next" style="justify-self:end;background:#241b61;color:#fff;padding:8px 16px;border-radius:10px;font-size:14px;font-weight:600;border:none;cursor:pointer;">${primaryLabel}</button>` +
                `</div></div>`;

            root.appendChild(tip);

            // ── Position tooltip ──────────────────────────────────
            const TW = 320;
            const TH = 190;
            let top = 0;
            let left = 0;

            if (!rect || placement === 'center') {
                top = vh / 2 - TH / 2;
                left = vw / 2 - TW / 2;
            } else if (placement === 'bottom') {
                top = rect.bottom + pad + 8;
                left = rect.left + rect.width / 2 - TW / 2;
            } else if (placement === 'top') {
                top = rect.top - pad - TH - 8;
                left = rect.left + rect.width / 2 - TW / 2;
            } else if (placement === 'right') {
                top = rect.top + rect.height / 2 - TH / 2;
                left = rect.right + pad + 8;
            } else {
                top = rect.top + rect.height / 2 - TH / 2;
                left = rect.left - pad - TW - 8;
            }

            // Clamp within the viewport
            top = Math.max(16, Math.min(top, vh - TH - 16));
            left = Math.max(16, Math.min(left, vw - TW - 16));

            tip.style.top = `${top}px`;
            tip.style.left = `${left}px`;

            // ── Click handlers ────────────────────────────────────
            (document.getElementById('__pw_next') as HTMLButtonElement).onclick = (e) => {
                e.stopPropagation();
                (window as any).__pw_tour_action = 'next';
            };
            const backBtn = document.getElementById('__pw_back') as HTMLButtonElement | null;
            if (backBtn) {
                backBtn.onclick = (e) => {
                    e.stopPropagation();
                    (window as any).__pw_tour_action = 'back';
                };
            }
        },
        {
            title: step.title,
            content: step.content,
            target: step.target,
            placement: step.placement,
            index,
            total: STEPS.length,
        },
    );
}

/** Clears injected tour UI (called after the last step). */
async function clearTourUI(page: Page): Promise<void> {
    await page.evaluate(() => document.getElementById('__pw_tour')?.remove());
}

/**
 * Blocks until the user clicks Next or Back.
 * Uses polling rather than a timeout so the demo can pause indefinitely.
 */
async function waitForAction(page: Page): Promise<'next' | 'back'> {
    await page.waitForFunction(
        () => (window as any).__pw_tour_action != null,
        { timeout: 0, polling: 100 },
    );
    return page.evaluate(() => {
        const a = (window as any).__pw_tour_action as 'next' | 'back';
        (window as any).__pw_tour_action = null;
        return a;
    });
}

/** Navigates to a step's URL only if the page isn't already there. */
async function ensurePage(page: Page, step: DemoStep): Promise<void> {
    const currentPath = new URL(page.url()).pathname;
    const expectedPath = step.url.split('?')[0];
    if (!currentPath.startsWith(expectedPath)) {
        await page.goto(step.url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(400);
    }
}

// ── Demo test ─────────────────────────────────────────────────────────────────

test('Tavro product tour', async ({ page }) => {
    // ── Backend stubs ─────────────────────────────────────────────────────────
    await page.route('**/runtime/tavro-runtime-config.json', (r) =>
        r.fulfill({
            json: {
                zitadelIssuer: 'https://test.zitadel.tavro.ai',
                zitadelClientId: 'demo-client',
            },
        }),
    );

    // Return showTour:false so the react-joyride tour does NOT also start
    await page.route('**/api/v1/onboarding-tour/**', (r) =>
        r.fulfill({ json: { showTour: false, status: 'completed' } }),
    );

    await page.route(/\/api\/v1\/agents\/[^?]+/, (r) =>
        r.fulfill({ json: TOUR_SAMPLE_AGENT }),
    );
    await page.route(/\/api\/v1\/agents(\?.*)?$/, (r) =>
        r.fulfill({ json: { agents: TOUR_CATALOG_AGENTS, total_records: TOUR_CATALOG_AGENTS.length } }),
    );
    await page.route(/\/api\/v1\/use-cases\/[^?]+/, (r) =>
        r.fulfill({ json: { data: [TOUR_SAMPLE_USE_CASE], total_records: 1, start_record: 1, end_record: 1, record_count: 1 } }),
    );
    await page.route(/\/api\/v1\/use-cases(\?.*)?$/, (r) =>
        r.fulfill({ json: { use_cases: [TOUR_SAMPLE_USE_CASE], total_records: 1 } }),
    );
    await page.route(/\/api\/v1\/business-relations/, (r) =>
        r.fulfill({ json: { processes: [], applications: [], total_records: 0 } }),
    );

    await stubMcpServer(page, TOUR_CATALOG_AGENTS, [TOUR_SAMPLE_USE_CASE]);

    // Prevent the react-joyride tour from triggering via localStorage fallback
    await page.addInitScript(() => {
        localStorage.setItem('tavro_tour_done', 'completed');
        sessionStorage.removeItem('tavro_tour_active');
        sessionStorage.removeItem('tavro_tour_step');
    });

    await loginToTavro(page);

    // ── Tour loop ─────────────────────────────────────────────────────────────
    let stepIndex = 0;

    while (stepIndex >= 0 && stepIndex < STEPS.length) {
        const step = STEPS[stepIndex];

        await ensurePage(page, step);

        // Dispatch any pre-step event (e.g. open playground config / chat panel)
        if (step.preEvent) {
            await page.evaluate(
                (name) => window.dispatchEvent(new Event(name)),
                step.preEvent,
            );
            await page.waitForTimeout(step.preDelay ?? 600);
        }

        // Wait for the spotlight target to be present before measuring it
        if (step.target !== 'body') {
            await page
                .waitForSelector(step.target, { state: 'visible', timeout: 5_000 })
                .catch(() => { /* show tooltip without spotlight if not found */ });
        }

        await showStep(page, step, stepIndex);

        const action = await waitForAction(page);

        if (action === 'next') {
            if (stepIndex === STEPS.length - 1) {
                await clearTourUI(page);
                // "Book a Demo" — navigate to the Tavro website
                await page.goto('https://www.tavro.ai/tavro/');
                break;
            }
            stepIndex++;
        } else {
            stepIndex = Math.max(0, stepIndex - 1);
        }
    }
});
