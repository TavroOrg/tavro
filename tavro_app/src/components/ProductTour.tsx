import React, { useEffect, useState, useCallback } from 'react';
import { Joyride, STATUS, ACTIONS, EVENTS } from 'react-joyride';
import type { Step, EventData, TooltipRenderProps } from 'react-joyride';
import { useNavigate, useLocation } from 'react-router-dom';
import { getTourStatus, saveTourStatus } from '../services/tourApi';

const TOUR_AGENT_ID = 'TOUR-AGENT-001';
const TOUR_USE_CASE_ID = 'UC-TOUR-001';
const TOUR_AGENT_NAME = 'Classify Service & CI AI Agent';
const TOUR_AGENT_DESC = 'Incident service and offering categorizer. Assigns the appropriate service, offering, and CI to an incident automatically.';
const PLAYGROUND_URL = `/playground?useCase=${encodeURIComponent(TOUR_AGENT_ID)}&title=${encodeURIComponent(TOUR_AGENT_NAME)}&desc=${encodeURIComponent(TOUR_AGENT_DESC)}`;
const TOUR_ACTIVE_KEY = 'tavro_tour_active';
const TOUR_STEP_KEY = 'tavro_tour_step';

const TOUR_STEPS: Step[] = [
    {
        target: '#tour-logo',
        title: 'Welcome to Tavro Agent BizOps',
        content: 'The governance platform for your AI agents. In 2 minutes you\'ll see how to register, risk-assess, and interact with AI agents end-to-end.',
        placement: 'right',
        skipBeacon: true,
    },
    {
        target: '#tour-usecase-card-0',
        title: 'AI Use Case Catalog',
        content: 'Define and track every AI-led initiative here. Each use case captures the business objective, owner, priority, and delivery status.',
        placement: 'bottom',
        skipBeacon: true,
        spotlightPadding: 6,
    },
    {
        target: '#tour-usecase-detail-section',
        title: 'Use Case Deep Dive',
        content: 'Open any use case to review its owner, priority, linked agents, and full business context in a single governed view.',
        placement: 'top',
        skipBeacon: true,
        spotlightPadding: 8,
    },
    {
        target: '#tour-agent-catalog-section',
        title: 'AI Agent Catalog',
        content: 'Every AI agent in your organisation is registered here — with its owner, version, deployment environment, and current governance status.',
        placement: 'top',
        skipBeacon: true,
        spotlightPadding: 8,
    },
    {
        target: '#tour-agent-detail-section',
        title: 'Complete Agent Profile',
        content: 'The full agent profile covers configuration, risk scores, tool dependencies, connected systems, and audit-ready metadata — everything needed for governance sign-off.',
        placement: 'top',
        skipBeacon: true,
        spotlightPadding: 8,
    },
    {
        target: '#tour-playground-btn',
        title: 'Test Before You Trust',
        content: 'Click "Open in Playground" to launch this agent for a live session. Validate its behaviour and capture findings before it reaches production.',
        placement: 'bottom',
        skipBeacon: true,
        spotlightPadding: 6,
    },
    {
        target: '#tour-playground-config-section',
        title: 'Configure Your Session',
        content: 'Select your LLM provider, review the agent\'s configuration, and get ready to run a live interactive session with full observability.',
        placement: 'top',
        skipBeacon: true,
        spotlightPadding: 8,
    },
    {
        target: '#tour-start-session',
        title: 'Start a Live Session',
        content: 'Click "Start session" to open a real-time conversation with this agent. Prompt it, observe its reasoning, and capture what you find.',
        placement: 'bottom',
        skipBeacon: true,
        spotlightPadding: 6,
    },
    {
        target: '#tour-chat-interaction',
        title: 'Live Agent Interaction',
        content: 'Send messages, review responses, and watch tool calls in real time. Add observations to the session notes and download a full transcript when done.',
        placement: 'top',
        skipBeacon: true,
        spotlightPadding: 8,
    },
    {
        target: 'body',
        title: 'Ready to govern your AI agents?',
        content: 'You\'ve seen how Tavro registers, risk-assesses, and lets you test AI agents. Book a demo to run it with your real agents and use cases.',
        placement: 'center',
        skipBeacon: true,
    },
];

const STEP_PATHS: Record<number, string> = {
    0: '/',
    1: '/use-cases',
    2: `/use-case/${TOUR_USE_CASE_ID}`,
    3: '/catalog',
    4: `/agent/${TOUR_AGENT_ID}`,
    5: `/agent/${TOUR_AGENT_ID}`,
    6: '/playground',
    7: '/playground',
    8: '/playground',
    9: '/playground',
};

const joyrideStyles = {
    options: {
        primaryColor: '#241b61',
        backgroundColor: '#f3f3f3',
        textColor: '#1f1f1f',
        arrowColor: '#f3f3f3',
        overlayColor: 'rgba(15, 23, 42, 0.72)',
        zIndex: 10000,
    },
    tooltip: {
        borderRadius: '12px',
        padding: '0',
        boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
        maxWidth: '380px',
        border: '1px solid #d9d9d9',
    },
    tooltipTitle: {
        display: 'none',
    },
    tooltipContent: {
        padding: '0',
    },
    tooltipFooter: { marginTop: '16px' },
};

const TourTooltip: React.FC<TooltipRenderProps> = ({
    backProps,
    primaryProps,
    step,
    index,
    size,
    isLastStep,
    skipProps,
    tooltipProps,
}) => {
    const progress = `${index + 1} of ${size}`;
    const primaryLabel = isLastStep ? 'Book a Demo' : index === 0 ? 'Start' : 'Next';

    return (
        <div
            {...tooltipProps}
            className="relative w-[320px] max-w-[86vw] rounded-xl border border-neutral-300 bg-neutral-100 text-neutral-900 shadow-xl"
        >
            <div className="h-2 w-full rounded-t-xl bg-transparent px-2 pt-1">
                <div
                    className="h-2 rounded-full bg-[#241b61] transition-all duration-300"
                    style={{ width: `${Math.max(18, ((index + 1) / size) * 100)}%` }}
                />
            </div>

            <div className="px-6 pb-7 pt-8 text-[15px] leading-relaxed text-neutral-900">
                {step.title && <span className="font-bold">{step.title} </span>}
                <span>{step.content}</span>
            </div>

            <div className="border-t border-neutral-300 px-4 py-3">
                <div className="grid grid-cols-3 items-center">
                    {index > 0 ? (
                        <button
                            {...backProps}
                            className="justify-self-start rounded-xl border border-[#241b61] bg-neutral-100 px-4 py-2 text-sm font-semibold text-[#241b61] hover:bg-neutral-200"
                        >
                            Back
                        </button>
                    ) : <div />}
                    <div className="justify-self-center text-sm text-neutral-500">{progress}</div>
                    <button
                        {...primaryProps}
                        className="justify-self-end rounded-xl bg-[#241b61] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1d1453]"
                    >
                        {primaryLabel}
                    </button>
                </div>
                <button {...skipProps} className="sr-only">Skip tour</button>
            </div>
        </div>
    );
};

const ProductTour: React.FC = () => {
    const [run, setRun] = useState(false);
    const [stepIndex, setStepIndex] = useState(0);
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (run) document.body.classList.add('tavro-tour-active');
        else document.body.classList.remove('tavro-tour-active');
        return () => document.body.classList.remove('tavro-tour-active');
    }, [run]);

    useEffect(() => {
        let cancelled = false;
        getTourStatus()
            .then(({ showTour }) => {
                if (!cancelled && showTour) {
                    const savedStep = Number(sessionStorage.getItem(TOUR_STEP_KEY) ?? '0');
                    if (Number.isFinite(savedStep) && savedStep >= 0 && savedStep < TOUR_STEPS.length) {
                        setStepIndex(savedStep);
                    }
                    setRun(true);
                }
            })
            .catch(() => {
                if (!cancelled && !localStorage.getItem('tavro_tour_done')) {
                    const savedStep = Number(sessionStorage.getItem(TOUR_STEP_KEY) ?? '0');
                    if (Number.isFinite(savedStep) && savedStep >= 0 && savedStep < TOUR_STEPS.length) {
                        setStepIndex(savedStep);
                    }
                    setRun(true);
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const handleStart = () => {
            localStorage.removeItem('tavro_tour_done');
            sessionStorage.setItem(TOUR_ACTIVE_KEY, 'true');
            sessionStorage.setItem(TOUR_STEP_KEY, '0');
            navigate('/');
            setTimeout(() => {
                setStepIndex(0);
                setRun(true);
            }, 100);
        };
        window.addEventListener('tavro:start-tour', handleStart);
        return () => window.removeEventListener('tavro:start-tour', handleStart);
    }, [navigate]);

    useEffect(() => {
        if (!run) return;
        sessionStorage.setItem(TOUR_ACTIVE_KEY, 'true');
        sessionStorage.setItem(TOUR_STEP_KEY, String(stepIndex));
    }, [run, stepIndex]);

    // After React renders each step, scroll the target into view and force
    // Joyride to recompute the spotlight (fixes stale bounding-rect on navigation).
    useEffect(() => {
        if (!run) return;
        const sel = TOUR_STEPS[stepIndex]?.target as string | undefined;
        if (sel && sel !== 'body') {
            const el = document.querySelector(sel);
            if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
        }
        const timer = setTimeout(() => window.dispatchEvent(new Event('resize')), 150);
        return () => clearTimeout(timer);
    }, [stepIndex, run]);

    useEffect(() => {
        if (!run) return;
        const expected = STEP_PATHS[stepIndex];
        if (!expected) return;
        const expectedBase = expected.split('?')[0];
        if (location.pathname.startsWith(expectedBase)) return;
        const destination = expected.startsWith('/playground') ? PLAYGROUND_URL : expected;
        navigate(destination, { replace: true });
    }, [run, stepIndex, location.pathname, navigate]);

    const finishTour = useCallback(() => {
        setRun(false);
        localStorage.setItem('tavro_tour_done', 'completed');
        sessionStorage.removeItem(TOUR_ACTIVE_KEY);
        sessionStorage.removeItem(TOUR_STEP_KEY);
        saveTourStatus('completed').catch(() => {});
        window.location.href = 'https://www.tavro.ai/tavro/';
    }, []);

    const handleCallback = useCallback((data: EventData) => {
        const { action, index, type, status } = data;
        const isLastStep = index === TOUR_STEPS.length - 1;

        if (type === EVENTS.STEP_AFTER && isLastStep && action === ACTIONS.NEXT) {
            finishTour();
            return;
        }

        if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
            const isNext = action === ACTIONS.NEXT;
            const isPrev = action === ACTIONS.PREV;
            const isMissingTarget = type === EVENTS.TARGET_NOT_FOUND;
            if (!isNext && !isPrev && !isMissingTarget) return;

            const target = isMissingTarget ? index + 1 : (isNext ? index + 1 : index - 1);
            if (target < 0 || target >= TOUR_STEPS.length) return;

            const currentBase = STEP_PATHS[index];
            const targetBase = STEP_PATHS[target];
            const needsNav = Boolean(
                targetBase &&
                targetBase !== currentBase &&
                !location.pathname.startsWith(targetBase.split('?')[0])
            );

            const doAdvance = (stepIdx: number, delay: number) => {
                setTimeout(() => setStepIndex(stepIdx), delay);
            };

            if (needsNav) {
                const dest = targetBase.startsWith('/playground') ? PLAYGROUND_URL : targetBase;
                navigate(dest);
                if (target === 6) {
                    window.dispatchEvent(new Event('tavro:tour-open-config'));
                }
                if (target === 8) {
                    window.dispatchEvent(new Event('tavro:tour-open-chat'));
                }
                doAdvance(target, target === 8 ? 950 : 700);
            } else {
                if (target === 6) {
                    window.dispatchEvent(new Event('tavro:tour-open-config'));
                }
                if (target === 8) {
                    window.dispatchEvent(new Event('tavro:tour-open-chat'));
                }
                doAdvance(target, target === 8 ? 250 : (isMissingTarget ? 200 : 0));
            }
        }

        if (status === STATUS.FINISHED) {
            finishTour();
        }

        if (status === STATUS.SKIPPED) {
            setRun(false);
            localStorage.setItem('tavro_tour_done', 'skipped');
            sessionStorage.removeItem(TOUR_ACTIVE_KEY);
            sessionStorage.removeItem(TOUR_STEP_KEY);
            saveTourStatus('skipped').catch(() => {});
        }
    }, [navigate, location.pathname, finishTour]);

    if (!run) return null;

    return (
        <Joyride
            steps={TOUR_STEPS}
            run={run}
            stepIndex={stepIndex}
            portalElement="body"
            continuous
            options={{
                showProgress: true,
                buttons: ['back', 'primary', 'skip'],
                overlayClickAction: false,
                dismissKeyAction: false,
                blockTargetInteraction: true,
                skipScroll: false,
            }}
            floatingOptions={{
                strategy: 'fixed',
                shiftOptions: { padding: 20, crossAxis: true, mainAxis: true },
                flipOptions: { padding: 20, fallbackAxisSideDirection: 'start' },
            }}
            styles={joyrideStyles}
            tooltipComponent={TourTooltip}
            locale={{
                back: 'Back',
                close: 'Close',
                last: 'Book a Demo',
                next: 'Next',
                skip: 'Skip tour',
            }}
            onEvent={handleCallback}
        />
    );
};

export default ProductTour;
