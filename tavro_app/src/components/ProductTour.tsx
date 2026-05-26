import React, { useEffect, useState, useCallback } from 'react';
import Joyride, { CallBackProps, STATUS, EVENTS, Step } from 'react-joyride';
import { getTourStatus, saveTourStatus } from '../services/tourApi';

const TOUR_STEPS: Step[] = [
    {
        target: '#tour-logo',
        title: 'Welcome to Tavro Agent BizOps',
        content: 'This is your command centre for managing AI agents across your organisation. Let\'s take a quick tour of the main features.',
        placement: 'right',
        disableBeacon: true,
    },
    {
        target: '#tour-nav-home',
        title: 'Home',
        content: 'Start here for a quick overview of your platform activity and shortcuts to key workflows.',
        placement: 'right',
    },
    {
        target: '#tour-nav-use-cases',
        title: 'AI Use Cases',
        content: 'Define and manage AI use cases — map each one to business processes, agents, and governance requirements.',
        placement: 'right',
    },
    {
        target: '#tour-nav-agents',
        title: 'Agent Catalog',
        content: 'Browse every AI agent in your organisation. Each entry shows risk scores, configurations, and linked use cases.',
        placement: 'right',
    },
    {
        target: '#tour-nav-applications',
        title: 'Applications',
        content: 'Track all business applications that AI agents interact with so you can assess their full operational footprint.',
        placement: 'right',
    },
    {
        target: '#tour-nav-processes',
        title: 'Business Processes',
        content: 'Model the business processes powered by AI — understand dependencies and control coverage.',
        placement: 'right',
    },
    {
        target: '#tour-nav-insights',
        title: 'Insights',
        content: 'Get at-a-glance metrics on your AI agent landscape — risk distribution, coverage, and activity trends.',
        placement: 'right',
    },
    {
        target: '#tour-nav-blueprint',
        title: 'Company Blueprint',
        content: 'Visualise your organisation\'s digital twin — applications, processes, and agents as an interactive graph.',
        placement: 'right',
    },
    {
        target: '#tour-nav-compliance',
        title: 'Compliance',
        content: 'Map agents and use cases against regulations such as the EU AI Act, NIST, and ISO standards.',
        placement: 'right',
    },
    {
        target: '#tour-nav-audit',
        title: 'Audit Center',
        content: 'Run structured audits, track findings, and maintain an evidence trail for regulators and internal reviewers.',
        placement: 'right',
    },
    {
        target: '#tour-nav-playground',
        title: 'Agent Playground',
        content: 'Test agent behaviour interactively before deploying to production — compare outputs across model configurations.',
        placement: 'right',
    },
    {
        target: '#tour-catalog-sync',
        title: 'Catalog Sync',
        content: 'Tavro automatically syncs agents from connected platforms. Refresh here to pull in the latest changes.',
        placement: 'right',
    },
    {
        target: '#tour-panel-chat',
        title: 'AI Assistant',
        content: 'Open the built-in AI assistant at any time to ask questions, analyse data, or run actions on your behalf.',
        placement: 'left',
    },
    {
        target: '#tour-nav-settings',
        title: 'Settings',
        content: 'Configure connected platforms, manage your profile, and customise Tavro to fit your team\'s needs.',
        placement: 'right',
    },
];

const joyrideStyles = {
    options: {
        primaryColor: '#2563eb',
        backgroundColor: '#ffffff',
        textColor: '#1e293b',
        arrowColor: '#ffffff',
        overlayColor: 'rgba(15, 23, 42, 0.6)',
        zIndex: 10000,
    },
    tooltip: {
        borderRadius: '12px',
        padding: '20px',
        boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
        maxWidth: '340px',
    },
    tooltipTitle: {
        fontSize: '15px',
        fontWeight: '700',
        color: '#1e293b',
        marginBottom: '6px',
    },
    tooltipContent: {
        fontSize: '13px',
        color: '#475569',
        lineHeight: '1.6',
        padding: '0',
    },
    tooltipFooter: {
        marginTop: '16px',
    },
    buttonNext: {
        backgroundColor: '#2563eb',
        borderRadius: '8px',
        fontSize: '13px',
        fontWeight: '600',
        padding: '8px 16px',
        color: '#ffffff',
    },
    buttonBack: {
        color: '#64748b',
        fontSize: '13px',
        fontWeight: '500',
        marginRight: '8px',
    },
    buttonSkip: {
        color: '#94a3b8',
        fontSize: '12px',
    },
    beacon: {
        inner: '#2563eb',
        outer: '#93c5fd',
    },
};

interface ProductTourProps {
    /** Force re-check of tour status (e.g. after manual trigger) */
    resetKey?: number;
}

const ProductTour: React.FC<ProductTourProps> = ({ resetKey }) => {
    const [run, setRun] = useState(false);
    const [stepIndex, setStepIndex] = useState(0);

    useEffect(() => {
        let cancelled = false;
        getTourStatus()
            .then(({ showTour }) => {
                if (!cancelled && showTour) setRun(true);
            })
            .catch(() => {
                // If the API is unreachable fall back to localStorage
                const done = localStorage.getItem('tavro_tour_done');
                if (!cancelled && !done) setRun(true);
            });
        return () => { cancelled = true; };
    }, [resetKey]);

    const handleCallback = useCallback((data: CallBackProps) => {
        const { status, type, index, action } = data;

        if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
            setStepIndex(index + (action === 'prev' ? -1 : 1));
        }

        const finished = ([STATUS.FINISHED, STATUS.SKIPPED] as string[]).includes(status);
        if (finished) {
            const newStatus = status === STATUS.FINISHED ? 'completed' : 'skipped';
            setRun(false);
            localStorage.setItem('tavro_tour_done', newStatus);
            saveTourStatus(newStatus).catch(() => {/* best-effort */});
        }
    }, []);

    if (!run && stepIndex === 0) return null;

    return (
        <Joyride
            steps={TOUR_STEPS}
            run={run}
            stepIndex={stepIndex}
            continuous
            showProgress
            showSkipButton
            disableOverlayClose
            spotlightClicks={false}
            styles={joyrideStyles}
            locale={{
                back: 'Back',
                close: 'Close',
                last: 'Finish',
                next: 'Next',
                skip: 'Skip tour',
            }}
            callback={handleCallback}
        />
    );
};

export default ProductTour;
