import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    BookOpen, Building2, ChevronDown, ChevronRight, KeyRound, Layers, Search,
    Server, ShieldCheck, Terminal, Workflow, Wrench, Plug, Settings,
} from 'lucide-react';
import adminHomeImage from '../assets/admin-home.png';
import companySelectionImage from '../assets/company-selection.png';
import connectorCredentialsImage from '../assets/connectors-credentials.png';
import connectorRunResultsImage from '../assets/connectors-run-results.png';
import containerLogsImage from '../assets/container-logs.png';
import infrastructureConfigurationImage from '../assets/infrastructure-configuration.png';
import llmSettingsImage from '../assets/llm-settings.png';
interface TocSection {
    id: string;
    label: string;
    icon: React.ReactNode;
    children?: { id: string; label: string }[];
}

const TOC_SECTIONS: TocSection[] = [
    {
        id: 'overview',
        label: 'Overview',
        icon: <BookOpen size={14} />,
        children: [
            { id: 'overview-purpose', label: 'What the portal is for' },
            { id: 'overview-flow', label: 'Recommended setup flow' },
        ],
    },
    {
        id: 'company',
        label: 'Company',
        icon: <Building2 size={14} />,
        children: [{ id: 'company-select', label: 'Selecting the active company' }],
    },
    {
        id: 'connectors',
        label: 'Connectors',
        icon: <Plug size={14} />,
        children: [
            { id: 'connectors-configure', label: 'Saving credentials' },
            { id: 'connectors-run', label: 'Running imports' },
        ],
    },
    {
        id: 'logs',
        label: 'Container Logs',
        icon: <Terminal size={14} />,
        children: [{ id: 'logs-stream', label: 'Monitoring live logs' }],
    },
    {
        id: 'settings',
        label: 'LLM Settings',
        icon: <Settings size={14} />,
        children: [
            { id: 'settings-chat', label: 'Chat AI configuration' },
            { id: 'settings-theme', label: 'Appearance' },
        ],
    },
    {
        id: 'infrastructure',
        label: 'Infrastructure Configuration',
        icon: <Server size={14} />,
        children: [{ id: 'infra-items', label: 'Platform credentials' }],
    },
];

const Callout: React.FC<{
    tone?: 'info' | 'tip';
    title: string;
    children: React.ReactNode;
}> = ({ tone = 'info', title, children }) => {
    const classes = tone === 'tip'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100'
        : 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100';

    return (
        <div className={`rounded-2xl border px-4 py-3 ${classes}`}>
            <p className="text-xs font-bold uppercase tracking-[0.18em]">{title}</p>
            <div className="mt-1.5 text-sm leading-6">{children}</div>
        </div>
    );
};

const SectionHeading: React.FC<{ id: string; icon: React.ReactNode; children: React.ReactNode }> = ({ id, icon, children }) => (
    <h2 id={id} className="mt-12 flex scroll-mt-24 items-center gap-2 text-xl font-bold text-slate-900 dark:text-slate-100">
        <span className="text-blue-600 dark:text-blue-400">{icon}</span>
        {children}
    </h2>
);

const SubHeading: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => (
    <h3 id={id} className="mt-8 scroll-mt-24 text-base font-semibold text-slate-900 dark:text-slate-100">
        {children}
    </h3>
);

const StepList: React.FC<{ items: React.ReactNode[] }> = ({ items }) => (
    <div className="mt-4 space-y-3">
        {items.map((item, index) => (
            <div key={index} className="flex gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                    {index + 1}
                </div>
                <div className="text-sm leading-6 text-slate-700 dark:text-slate-300">{item}</div>
            </div>
        ))}
    </div>
);

const ScreenshotPlaceholder: React.FC<{
    title: string;
    alt: string;
    expectedFile: string;
    placeholder: string;
    src?: string;
}> = ({ title, alt, expectedFile, placeholder, src }) => (
    <div className="mt-5 mb-8 overflow-hidden rounded-2xl border border-slate-200 shadow-lg dark:border-slate-700">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-100 px-4 py-2 dark:border-slate-700 dark:bg-slate-800/70">
            <div className="flex gap-1.5">
                <span className="h-3 w-3 rounded-full bg-red-400" />
                <span className="h-3 w-3 rounded-full bg-amber-400" />
                <span className="h-3 w-3 rounded-full bg-emerald-400" />
            </div>
            <span className="flex-1 text-center text-xs font-medium text-slate-500 dark:text-slate-400">{title}</span>
        </div>
        {src ? (
            <img src={src} alt={alt} className="block w-full bg-slate-50 dark:bg-slate-900" />
        ) : (
            <div
                aria-label={alt}
                className="flex min-h-[260px] flex-col items-center justify-center bg-slate-50 px-6 py-12 text-center dark:bg-slate-900"
            >
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-8 dark:border-slate-600 dark:bg-slate-800/50">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Screenshot Placeholder</p>
                    <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{placeholder}</p>
                    <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                        Expected file: <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">{expectedFile}</code>
                    </p>
                </div>
            </div>
        )}
    </div>
);

const AdminUserGuidePage: React.FC = () => {
    const [activeSection, setActiveSection] = useState('overview');
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(TOC_SECTIONS.map((section) => section.id)));
    const [search, setSearch] = useState('');
    const contentRef = useRef<HTMLDivElement>(null);

    const allSectionIds = TOC_SECTIONS.flatMap((section) => [
        section.id,
        ...(section.children?.map((child) => child.id) ?? []),
    ]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) setActiveSection(entry.target.id);
                });
            },
            { rootMargin: '-18% 0px -70% 0px', threshold: 0 }
        );

        const root = contentRef.current;
        if (!root) return;

        allSectionIds.forEach((id) => {
            const node = root.querySelector(`#${id}`);
            if (node) observer.observe(node);
        });

        return () => observer.disconnect();
    }, [allSectionIds]);

    const scrollTo = useCallback((id: string) => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, []);

    const toggleSection = useCallback((id: string) => {
        setExpandedSections((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const query = search.trim().toLowerCase();
    const filteredToc = query
        ? TOC_SECTIONS.map((section) => ({
            ...section,
            children: section.children?.filter((child) => child.label.toLowerCase().includes(query)),
        })).filter((section) =>
            section.label.toLowerCase().includes(query) || (section.children && section.children.length > 0)
        )
        : TOC_SECTIONS;

    return (
        <div className="flex flex-1 overflow-hidden bg-white dark:bg-slate-950">
            <aside className="hidden w-80 shrink-0 border-r border-slate-200 dark:border-slate-800 lg:flex lg:flex-col">
                <div className="border-b border-slate-200 px-5 py-5 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="rounded-2xl bg-blue-600 p-2.5 text-white shadow-sm">
                            <BookOpen size={18} />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">User Guide</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Tavro Admin Portal</p>
                        </div>
                    </div>
                    <div className="relative mt-4">
                        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search sections"
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-3 py-4">
                    {filteredToc.map((section) => {
                        const expanded = expandedSections.has(section.id);
                        const isActive = activeSection === section.id || section.children?.some((child) => child.id === activeSection);

                        return (
                            <div key={section.id} className="mb-2">
                                <button
                                    type="button"
                                    onClick={() => toggleSection(section.id)}
                                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${isActive
                                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
                                    }`}
                                >
                                    <span className="text-slate-400 dark:text-slate-500">{section.icon}</span>
                                    <span className="flex-1 font-semibold">{section.label}</span>
                                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </button>
                                {expanded && section.children && (
                                    <div className="mt-1 space-y-1 pl-10 pr-2">
                                        {section.children.map((child) => (
                                            <button
                                                key={child.id}
                                                type="button"
                                                onClick={() => scrollTo(child.id)}
                                                className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm transition ${activeSection === child.id
                                                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                                                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200'
                                                }`}
                                            >
                                                {child.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </aside>

            <div className="flex-1 overflow-y-auto">
                <div ref={contentRef} className="mx-auto max-w-5xl px-6 py-8 md:px-10">
                    <div className="animate-fade-in rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 px-6 py-8 text-white shadow-xl dark:border-slate-800">
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-blue-100">
                                Admin Help
                            </span>
                            <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-[11px] font-semibold text-emerald-200">
                                Updated July 2026
                            </span>
                        </div>
                        <h1 className="mt-5 text-3xl font-bold tracking-tight md:text-4xl">Tavro Admin Portal User Guide</h1>
                        <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-200 md:text-base">
                            Use the admin portal to choose the active company, configure external connectors, monitor
                            platform services, manage chat AI provider credentials, and maintain infrastructure settings
                            that support Tavro operations.
                        </p>
                        <div className="mt-6 grid gap-3 md:grid-cols-3">
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-100">Scope</p>
                                <p className="mt-2 text-sm text-slate-200">Operational setup, integrations, secrets, and platform diagnostics.</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-100">Best For</p>
                                <p className="mt-2 text-sm text-slate-200">Admins managing company-specific imports and shared system credentials.</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-100">Tip</p>
                                <p className="mt-2 text-sm text-slate-200">Set the company first so connector runs and imported data are scoped correctly.</p>
                            </div>
                        </div>
                    </div>

                    <SectionHeading id="overview" icon={<Layers size={18} />}>Overview</SectionHeading>
                    <SubHeading id="overview-purpose">What the portal is for</SubHeading>
                    <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-300">
                        The admin portal is the operational control surface for Tavro. It is separate from the BizOps
                        workspace and focuses on platform configuration rather than business content authoring.
                    </p>
                    <Callout title="What you manage here">
                        Active company context, connector credentials, connector extraction runs, live container health,
                        chat AI provider secrets, theme preferences, and infrastructure credentials used by Tavro services.
                    </Callout>

                    <SubHeading id="overview-flow">Recommended setup flow</SubHeading>
                    <StepList
                        items={[
                            <>Open <strong>Company</strong> and select the company you want to administer.</>,
                            <>Configure any needed credentials in <strong>Connectors</strong> or <strong>Infrastructure Configuration</strong>.</>,
                            <>Save the credentials, then run the connector import or extraction for that company.</>,
                            <>Use <strong>Container Logs</strong> to monitor live activity and troubleshoot failures.</>,
                            <>Review <strong>LLM Settings</strong> if the Tavro AI Assistant needs a different provider or updated API key.</>,
                        ]}
                    />
                    <ScreenshotPlaceholder
                        title="Admin Portal Home"
                        alt="Admin portal home page"
                        expectedFile="src/assets/admin-home.png"
                        placeholder="Add the admin portal landing page screenshot here to show the high-level navigation experience."
                        src={adminHomeImage}
                    />

                    <SectionHeading id="company" icon={<Building2 size={18} />}>Company</SectionHeading>
                    <SubHeading id="company-select">Selecting the active company</SubHeading>
                    <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-300">
                        The company selector controls the scope for the whole admin portal. Imports, connector actions,
                        and extracted records use the selected company as their context.
                    </p>
                    <StepList
                        items={[
                            <>Open <strong>Company</strong> from the left navigation.</>,
                            <>Use the searchable dropdown to find the right company by name, industry, or region.</>,
                            <>Click the company to make it active. The selection is stored locally and shown in the footer.</>,
                        ]}
                    />
                    <ScreenshotPlaceholder
                        title="Company Selection"
                        alt="Company selection page"
                        expectedFile="src/assets/company-selection.png"
                        placeholder="Add the company selection screenshot here so users can see the searchable dropdown and selected company details."
                        src={companySelectionImage}
                    />
                    <Callout tone="tip" title="Why this matters">
                        If the wrong company is selected, imported assets can be associated with the wrong tenant context.
                        Confirm the footer company name before starting a connector run.
                    </Callout>

                    <SectionHeading id="connectors" icon={<Plug size={18} />}>Connectors</SectionHeading>
                    <SubHeading id="connectors-configure">Saving credentials</SubHeading>
                    <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-300">
                        The Connectors page stores credentials for supported sources such as Microsoft Copilot, AWS
                        Bedrock, Salesforce, ServiceNow, Snowflake, Databricks, Google Gemini, GitHub MCP, Microsoft
                        Agent 365, and ServiceNow AICT.
                    </p>
                    <StepList
                        items={[
                            <>Choose a connector from the left side of the page.</>,
                            <>Enter the required fields for that connector. Password values can be revealed temporarily with the eye icon.</>,
                            <>Click <strong>Save</strong> before starting a run so the portal can reuse the credentials.</>,
                        ]}
                    />
                    <ScreenshotPlaceholder
                        title="Connector Credentials"
                        alt="Connector credentials page"
                        expectedFile="src/assets/connectors-credentials.png"
                        placeholder="Add a connector configuration screenshot here showing the credential form and save action."
                        src={connectorCredentialsImage}
                    />

                    <SubHeading id="connectors-run">Running imports</SubHeading>
                    <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-300">
                        After credentials are configured, use the capability cards on a connector page to run the
                        supported import actions. The common pattern stays the same: shared credentials at the top, then
                        reusable discovery or import capabilities below.
                    </p>
                    <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-300">
                        A common example is <strong>Agent discovery</strong>, which is used to retrieve all agents from a
                        source system. This is the shared pattern you should describe across connectors. Some connectors
                        also expose related common capabilities such
                        as <strong>AICT agent discovery</strong>, <strong>Business Application Discovery</strong>, and{' '}
                        <strong>Business Process Discovery</strong>.
                    </p>
                    <StepList
                        items={[
                            <>Save the shared connector credentials first so all capability cards can reuse the same connection details.</>,
                            <>Choose the capability that matches the data you want to bring into Tavro, such as agent discovery for all agents or business process discovery for process records.</>,
                            <>Click <strong>Run</strong> or <strong>Run again</strong> to start the extraction and wait for the status banner or result summary.</>,
                            <>Use <strong>Reset</strong> when available to clear the current run state before testing again.</>,
                        ]}
                    />
                    <ScreenshotPlaceholder
                        title="Connector Run Results"
                        alt="Connector run results page"
                        expectedFile="src/assets/connectors-run-results.png"
                        placeholder="Add a screenshot here that shows a connector run in progress or completed, including the result summary."
                        src={connectorRunResultsImage}
                    />
                    <Callout title="Connector behavior">
                        Different connectors return different result types, but the common behavior is consistent: each
                        capability runs a targeted discovery or import and then shows a result summary. Some runs extract
                        agents, while others bring in applications, processes, or other supported assets.
                    </Callout>

                    <SectionHeading id="logs" icon={<Terminal size={18} />}>Container Logs</SectionHeading>
                    <SubHeading id="logs-stream">Monitoring live logs</SubHeading>
                    <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-300">
                        The Container Logs page streams real-time output from running Tavro containers. It is the fastest
                        place to confirm that services are healthy or to inspect failures during connector and platform operations.
                    </p>
                    <StepList
                        items={[
                            <>Use the container list on the left to focus on a single service or keep the view on <strong>All</strong>.</>,
                            <>Use <strong>Pause</strong> to freeze the stream while investigating a problem.</>,
                            <>Use the search box to filter by container name or message text.</>,
                            <>Use <strong>Download</strong> when you need to share a captured log snapshot.</>,
                        ]}
                    />
                    <ScreenshotPlaceholder
                        title="Container Logs"
                        alt="Container logs page"
                        expectedFile="src/assets/container-logs.png"
                        placeholder="Add the container logs screenshot here to show the live stream, filters, and log controls."
                        src={containerLogsImage}
                    />

                    <SectionHeading id="settings" icon={<KeyRound size={18} />}>LLM Settings</SectionHeading>
                    <SubHeading id="settings-chat">Chat AI configuration</SubHeading>
                    <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-300">
                        The LLM Settings page controls which provider the Tavro AI Assistant can use for chat features.
                        Supported providers include GitHub Copilot, OpenAI, Azure OpenAI, and Anthropic.
                    </p>
                    <StepList
                        items={[
                            <>Pick the provider from the dropdown.</>,
                            <>Enter the required key or endpoint fields for that provider.</>,
                            <>Save the configuration to persist it into the project environment settings.</>,
                        ]}
                    />
                    <ScreenshotPlaceholder
                        title="LLM Settings"
                        alt="LLM settings page"
                        expectedFile="src/assets/llm-settings.png"
                        placeholder="Add a screenshot of the chat AI configuration section here, including provider selection and credential fields."
                        src={llmSettingsImage}
                    />

                    <SubHeading id="settings-theme">Appearance</SubHeading>
                    <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-300">
                        Choose <strong>Light</strong>, <strong>Dark</strong>, or <strong>System</strong> mode to control
                        how the admin portal is displayed for your session.
                    </p>

                    <SectionHeading id="infrastructure" icon={<Server size={18} />}>Infrastructure Configuration</SectionHeading>
                    <SubHeading id="infra-items">Platform credentials</SubHeading>
                    <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-300">
                        Infrastructure Configuration stores credentials and endpoints used by platform capabilities such as
                        Claude CLI, Azure AI Foundry, and Agent Playground Bedrock setup.
                    </p>
                    <StepList
                        items={[
                            <>Select the infrastructure item you want to manage from the left panel.</>,
                            <>Fill in the credentials for each section, such as Anthropic, Azure deployment, or Git publishing.</>,
                            <>Save the configuration and verify related workflows through the platform features that use it.</>,
                        ]}
                    />
                    <ScreenshotPlaceholder
                        title="Infrastructure Configuration"
                        alt="Infrastructure configuration page"
                        expectedFile="src/assets/infrastructure-configuration.png"
                        placeholder="Add the infrastructure configuration screenshot here to show the selectable items and credentials panel."
                        src={infrastructureConfigurationImage}
                    />
                    <Callout tone="tip" title="Operational tip">
                        Infrastructure settings are shared dependencies. If a related feature suddenly fails, review this
                        page first for expired tokens, changed endpoints, or rotated secrets.
                    </Callout>

                    <SectionHeading id="quick-reference" icon={<Workflow size={18} />}>Quick Reference</SectionHeading>
                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900">
                            <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                                <Wrench size={16} className="text-blue-600 dark:text-blue-400" />
                                <p className="font-semibold">When a connector run fails</p>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                                Recheck the active company, validate saved credentials, then inspect Container Logs for
                                the connector or API service error.
                            </p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900">
                            <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                                <ShieldCheck size={16} className="text-blue-600 dark:text-blue-400" />
                                <p className="font-semibold">When chat stops working</p>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                                Review LLM Settings first, then confirm any related infrastructure credentials if the
                                failing feature depends on an external model provider.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminUserGuidePage;



