import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    BookOpen, ChevronRight, ChevronDown, Search, X, Copy, Check,
    Info, AlertTriangle, Lightbulb, Terminal, ExternalLink,
    Bot, ClipboardList, AppWindow, Workflow, Plug, Zap,
    BarChart2, Network, Scale, ShieldCheck, FlaskConical,
    Settings, MessageCircle, Database, Package, Globe,
    Lock, RefreshCw, FileText, Layers, GitBranch, Code2,
    Hash, ArrowRight, CheckCircle2, AlertCircle, Star
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TocSection {
    id: string;
    label: string;
    icon?: React.ReactNode;
    children?: { id: string; label: string }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const Callout: React.FC<{
    type: 'info' | 'warning' | 'tip' | 'note';
    title?: string;
    children: React.ReactNode;
}> = ({ type, title, children }) => {
    const styles = {
        info: {
            wrap: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800',
            icon: <Info size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />,
            titleColor: 'text-blue-700 dark:text-blue-300',
            textColor: 'text-blue-800 dark:text-blue-200',
        },
        warning: {
            wrap: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800',
            icon: <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />,
            titleColor: 'text-amber-700 dark:text-amber-300',
            textColor: 'text-amber-800 dark:text-amber-200',
        },
        tip: {
            wrap: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800',
            icon: <Lightbulb size={16} className="text-emerald-500 flex-shrink-0 mt-0.5" />,
            titleColor: 'text-emerald-700 dark:text-emerald-300',
            textColor: 'text-emerald-800 dark:text-emerald-200',
        },
        note: {
            wrap: 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700',
            icon: <Star size={16} className="text-slate-500 flex-shrink-0 mt-0.5" />,
            titleColor: 'text-slate-700 dark:text-slate-300',
            textColor: 'text-slate-700 dark:text-slate-300',
        },
    };
    const s = styles[type];
    return (
        <div className={`flex gap-3 rounded-xl border px-4 py-3.5 my-4 ${s.wrap}`}>
            {s.icon}
            <div className="min-w-0">
                {title && <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${s.titleColor}`}>{title}</p>}
                <div className={`text-sm leading-relaxed ${s.textColor}`}>{children}</div>
            </div>
        </div>
    );
};

const CodeBlock: React.FC<{ lang?: string; children: string }> = ({ lang, children }) => {
    const [copied, setCopied] = useState(false);
    const copy = () => {
        navigator.clipboard.writeText(children.trim());
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <div className="relative group my-4 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
            {lang && (
                <div className="flex items-center justify-between bg-slate-800 dark:bg-slate-900 px-4 py-2 border-b border-slate-700">
                    <span className="text-[11px] font-mono text-slate-400 uppercase tracking-widest">{lang}</span>
                    <button
                        onClick={copy}
                        className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
                    >
                        {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                        <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                </div>
            )}
            <pre className="bg-slate-900 text-slate-100 text-sm font-mono leading-relaxed p-4 overflow-x-auto whitespace-pre-wrap">
                <code>{children.trim()}</code>
            </pre>
        </div>
    );
};

const InlineCode: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <code className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-blue-700 dark:text-blue-300 text-[13px] font-mono border border-slate-200 dark:border-slate-700">
        {children}
    </code>
);

const SectionHeading: React.FC<{ id: string; level?: 1 | 2 | 3; children: React.ReactNode; icon?: React.ReactNode }> = ({
    id, level = 2, children, icon
}) => {
    if (level === 1) return (
        <h1 id={id} className="flex items-center gap-3 text-3xl font-bold text-slate-900 dark:text-white mt-2 mb-4 scroll-mt-6">
            {icon && <span className="text-blue-600 dark:text-blue-400">{icon}</span>}
            {children}
        </h1>
    );
    if (level === 2) return (
        <h2 id={id} className="flex items-center gap-2.5 text-xl font-semibold text-slate-800 dark:text-slate-100 mt-10 mb-4 pt-6 border-t border-slate-100 dark:border-slate-800 scroll-mt-6">
            {icon && <span className="text-blue-500 dark:text-blue-400 flex-shrink-0">{icon}</span>}
            {children}
        </h2>
    );
    return (
        <h3 id={id} className="text-base font-semibold text-slate-700 dark:text-slate-200 mt-6 mb-2.5 scroll-mt-6">
            {children}
        </h3>
    );
};

const Badge: React.FC<{ color?: 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'slate'; children: React.ReactNode }> = ({
    color = 'blue', children
}) => {
    const colors = {
        blue: 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700',
        green: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700',
        amber: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700',
        red: 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-700',
        violet: 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-700',
        slate: 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600',
    };
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${colors[color]}`}>
            {children}
        </span>
    );
};

const Step: React.FC<{ n: number; children: React.ReactNode }> = ({ n, children }) => (
    <div className="flex gap-4 mb-4">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
            {n}
        </div>
        <div className="flex-1 text-sm text-slate-700 dark:text-slate-300 leading-relaxed pt-0.5">{children}</div>
    </div>
);

const DataTable: React.FC<{
    headers: string[];
    rows: (string | React.ReactNode)[][];
}> = ({ headers, rows }) => (
    <div className="my-4 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                        {headers.map((h, i) => (
                            <th key={i} className="text-left px-4 py-3 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">
                                {h}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, ri) => (
                        <tr key={ri} className="border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                            {row.map((cell, ci) => (
                                <td key={ci} className="px-4 py-3 text-slate-700 dark:text-slate-300 align-top">
                                    {cell}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
);

// ─── TOC Data ─────────────────────────────────────────────────────────────────

const TOC_SECTIONS: TocSection[] = [
    {
        id: 'overview', label: 'Product Overview', icon: <BookOpen size={14} />,
        children: [
            { id: 'what-is-tavro', label: 'What is Tavro?' },
            { id: 'key-capabilities', label: 'Key Capabilities' },
        ],
    },
    {
        id: 'getting-started', label: 'Getting Started', icon: <Package size={14} />,
        children: [
            { id: 'prerequisites', label: 'Prerequisites' },
            { id: 'installation', label: 'Installation' },
            { id: 'env-config', label: 'Environment Configuration' },
            { id: 'authentication', label: 'Authentication' },
        ],
    },
    {
        id: 'ui-walkthrough', label: 'UI Walkthrough', icon: <Layers size={14} />,
        children: [
            { id: 'layout-overview', label: 'Layout Overview' },
            { id: 'left-sidebar', label: 'Left Navigation Sidebar' },
            { id: 'right-panel', label: 'Right Panel' },
            { id: 'catalog-sync', label: 'Catalog Sync Widget' },
        ],
    },
    {
        id: 'features', label: 'Core Features', icon: <Star size={14} />,
        children: [
            { id: 'home', label: 'Home Dashboard' },
            { id: 'use-cases', label: 'AI Use Cases' },
            { id: 'agents', label: 'Agent Catalog' },
            { id: 'applications', label: 'Applications' },
            { id: 'processes', label: 'Business Processes' },
            { id: 'integrations', label: 'Integrations' },
            { id: 'spark', label: 'Spark – AI Ideas' },
            { id: 'insights', label: 'Insights' },
            { id: 'blueprint', label: 'Blueprint (Digital Twin)' },
            { id: 'compliance', label: 'Compliance' },
            { id: 'audit', label: 'Audit Center' },
            { id: 'playground', label: 'Agent Playground' },
        ],
    },
    {
        id: 'ai-assistant', label: 'AI Assistant', icon: <MessageCircle size={14} />,
        children: [
            { id: 'chat-panel', label: 'Chat Panel' },
            { id: 'context-awareness', label: 'Context Awareness' },
        ],
    },
    {
        id: 'settings-config', label: 'Settings & Configuration', icon: <Settings size={14} />,
        children: [
            { id: 'llm-config', label: 'LLM Provider Setup' },
            { id: 'mcp-connection', label: 'MCP Connection' },
            { id: 'dev-settings', label: 'Developer Settings' },
            { id: 'appearance', label: 'Appearance' },
        ],
    },
    {
        id: 'api-reference', label: 'API Reference', icon: <Code2 size={14} />,
        children: [
            { id: 'api-auth', label: 'Authentication' },
            { id: 'api-endpoints', label: 'Endpoint Index' },
        ],
    },
    {
        id: 'architecture', label: 'Architecture Overview', icon: <GitBranch size={14} />,
        children: [
            { id: 'tech-stack', label: 'Technology Stack' },
            { id: 'data-flow', label: 'Data Flow' },
            { id: 'file-structure', label: 'File Structure' },
        ],
    },
    {
        id: 'troubleshooting', label: 'Troubleshooting', icon: <Terminal size={14} />,
    },
    {
        id: 'glossary', label: 'Glossary', icon: <Hash size={14} />,
    },
];

// ─── Main Component ───────────────────────────────────────────────────────────

const UserGuidePage: React.FC = () => {
    const [activeSection, setActiveSection] = useState('overview');
    const [expandedSections, setExpandedSections] = useState<Set<string>>(
        new Set(TOC_SECTIONS.map(s => s.id))
    );
    const [searchQuery, setSearchQuery] = useState('');
    const contentRef = useRef<HTMLDivElement>(null);

    const toggleSection = (id: string) => {
        setExpandedSections(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const scrollTo = useCallback((id: string) => {
        const el = document.getElementById(id);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setActiveSection(id);
        }
    }, []);

    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        setActiveSection(entry.target.id);
                    }
                }
            },
            { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
        );
        const els = contentRef.current?.querySelectorAll('[id]') ?? [];
        els.forEach(el => observer.observe(el));
        return () => observer.disconnect();
    }, []);

    const filteredToc = searchQuery.trim()
        ? TOC_SECTIONS.map(s => ({
            ...s,
            children: s.children?.filter(c =>
                c.label.toLowerCase().includes(searchQuery.toLowerCase())
            ),
        })).filter(s =>
            s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (s.children && s.children.length > 0)
        )
        : TOC_SECTIONS;

    return (
        <div className="flex gap-0 h-screen overflow-hidden bg-white dark:bg-slate-950">

            {/* ── Left TOC ──────────────────────────────────────────────────── */}
            <aside className="w-[260px] flex-shrink-0 h-screen overflow-y-auto border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="p-4">
                    {/* Header */}
                    <div className="flex items-center gap-2.5 mb-4">
                        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
                            <BookOpen size={15} className="text-white" />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-slate-900 dark:text-white leading-none">User Guide</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">v 3.1 · Tavro BizOps</p>
                        </div>
                    </div>

                    {/* Search */}
                    <div className="relative mb-4">
                        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search guide…"
                            className="w-full pl-8 pr-7 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 placeholder-slate-400 outline-none focus:border-blue-400 dark:focus:border-blue-500 transition-colors"
                        />
                        {searchQuery && (
                            <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                <X size={12} />
                            </button>
                        )}
                    </div>

                    {/* TOC */}
                    <nav className="space-y-0.5">
                        {filteredToc.map(section => (
                            <div key={section.id}>
                                <div className="flex items-center">
                                    <button
                                        onClick={() => scrollTo(section.id)}
                                        className={`flex-1 flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors text-left ${activeSection === section.id
                                            ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                                            }`}
                                    >
                                        <span className="flex-shrink-0 opacity-70">{section.icon}</span>
                                        {section.label}
                                    </button>
                                    {section.children && section.children.length > 0 && (
                                        <button
                                            onClick={() => toggleSection(section.id)}
                                            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                                        >
                                            {expandedSections.has(section.id)
                                                ? <ChevronDown size={12} />
                                                : <ChevronRight size={12} />}
                                        </button>
                                    )}
                                </div>
                                {section.children && expandedSections.has(section.id) && (
                                    <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-100 dark:border-slate-800 pl-3">
                                        {section.children.map(child => (
                                            <button
                                                key={child.id}
                                                onClick={() => scrollTo(child.id)}
                                                className={`w-full text-left px-2 py-1.5 rounded-md text-[11px] transition-colors ${activeSection === child.id
                                                    ? 'text-blue-600 dark:text-blue-400 font-semibold'
                                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-medium'
                                                    }`}
                                            >
                                                {child.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </nav>
                </div>
            </aside>

            {/* ── Main Content ──────────────────────────────────────────────── */}
            <div ref={contentRef} className="flex-1 overflow-y-auto">
                <div className="max-w-4xl mx-auto px-10 py-8 pb-24">

                    {/* ══════════════════════════════════════════════════════════
                        SECTION 1 · PRODUCT OVERVIEW
                    ══════════════════════════════════════════════════════════ */}
                    <div id="overview">
                        <div className="mb-8 pb-6 border-b border-slate-200 dark:border-slate-800">
                            <div className="flex items-center gap-2 mb-3">
                                <Badge color="blue">v3.1</Badge>
                                <Badge color="green">Generally Available</Badge>
                            </div>
                            <h1 className="text-4xl font-extrabold text-slate-900 dark:text-white mb-3 leading-tight">
                                Tavro Agent BizOps
                                <span className="block text-xl font-normal text-slate-500 dark:text-slate-400 mt-1">
                                    Enterprise User Guide
                                </span>
                            </h1>
                            <p className="text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl">
                                The complete reference for deploying, configuring, and operating Tavro — an enterprise-grade AI agent lifecycle management and governance platform built for modern business operations.
                            </p>
                        </div>
                    </div>

                    <SectionHeading id="what-is-tavro" level={2} icon={<BookOpen size={18} />}>
                        What is Tavro Agent BizOps?
                    </SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                        Tavro Agent BizOps is a centralized platform for managing the full lifecycle of AI agents across your enterprise — from discovery and prototyping to compliance auditing and real-time monitoring. It bridges the gap between AI engineering and business governance by linking agents directly to the business processes, applications, and regulations they affect.
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                        At its core, Tavro maintains a <strong className="text-slate-800 dark:text-slate-200">Digital Twin</strong> of your organization — a live graph of business dimensions (applications, processes, teams, risk areas, integrations) that every agent, use case, and compliance rule is mapped against. This gives leadership a single source of truth for AI risk exposure, operational coverage, and regulatory readiness.
                    </p>

                    <SectionHeading id="key-capabilities" level={3}>Key Capabilities</SectionHeading>
                    <DataTable
                        headers={['Capability', 'Description']}
                        rows={[
                            [<span className="flex items-center gap-2"><Bot size={14} className="text-blue-500" /><strong>Agent Catalog</strong></span>, 'Centralized registry of all AI agents with risk scores, governance status, and business linkages.'],
                            [<span className="flex items-center gap-2"><ClipboardList size={14} className="text-blue-500" /><strong>AI Use Cases</strong></span>, 'Structured documentation of AI initiatives tied to business problems, priorities, and expected outcomes.'],
                            [<span className="flex items-center gap-2"><Network size={14} className="text-blue-500" /><strong>Digital Twin (Blueprint)</strong></span>, 'Interactive graph of your organization\'s dimensions — applications, processes, teams, strategy, and more.'],
                            [<span className="flex items-center gap-2"><Scale size={14} className="text-blue-500" /><strong>Compliance Framework</strong></span>, 'Track regulations and internal policies, map impacts to business dimensions, and monitor gap closure.'],
                            [<span className="flex items-center gap-2"><ShieldCheck size={14} className="text-blue-500" /><strong>Audit Engine</strong></span>, 'AI-powered compliance audits that evaluate use cases against regulations with live progress streaming.'],
                            [<span className="flex items-center gap-2"><Zap size={14} className="text-violet-500" /><strong>Spark</strong></span>, 'AI idea generator that surfaces new agent opportunities from gaps in your current coverage.'],
                            [<span className="flex items-center gap-2"><FlaskConical size={14} className="text-blue-500" /><strong>Agent Playground</strong></span>, 'Prototype and test agents against real business context before committing to production deployment.'],
                            [<span className="flex items-center gap-2"><BarChart2 size={14} className="text-blue-500" /><strong>Insights</strong></span>, 'Cross-portfolio analytics — risk exposure, agent coverage, and compliance readiness at a glance.'],
                        ]}
                    />

                    <Callout type="info" title="Who Should Use This Guide">
                        This guide is written for <strong>platform administrators</strong>, <strong>AI governance leads</strong>, <strong>solution architects</strong>, and <strong>business analysts</strong> responsible for deploying or operating Tavro within their organization. Some sections (Installation, API Reference) are intended for DevOps and engineering teams.
                    </Callout>


                    {/* ══════════════════════════════════════════════════════════
                        SECTION 2 · GETTING STARTED
                    ══════════════════════════════════════════════════════════ */}
                    <SectionHeading id="getting-started" level={2} icon={<Package size={18} />}>
                        Getting Started
                    </SectionHeading>

                    <SectionHeading id="prerequisites" level={3}>Prerequisites</SectionHeading>
                    <DataTable
                        headers={['Requirement', 'Version / Notes']}
                        rows={[
                            ['Node.js', '≥ 18.x LTS'],
                            ['npm / pnpm', '≥ 9.x (npm) or 8.x (pnpm)'],
                            ['Git', 'Any recent version'],
                            ['ZITADEL Identity Provider', 'Self-hosted or cloud — required for OIDC authentication'],
                            ['Tavro Backend API', 'Running on a reachable host (default: localhost:8000)'],
                            ['MCP Server', 'Tavro MCP service (default: localhost:9001) — required for AI Assistant & Playground context'],
                            ['PostgreSQL', '≥ 14, required by backend API (default port 5433)'],
                        ]}
                    />

                    <SectionHeading id="installation" level={3}>Installation</SectionHeading>
                    <Step n={1}><strong>Clone the repository</strong></Step>
                    <CodeBlock lang="bash">{`git clone https://github.com/your-org/tavro.git
cd tavro/tavro_app`}</CodeBlock>

                    <Step n={2}><strong>Install dependencies</strong></Step>
                    <CodeBlock lang="bash">{`npm install`}</CodeBlock>

                    <Step n={3}><strong>Copy the environment template and fill in your values</strong> (see Environment Configuration below)</Step>
                    <CodeBlock lang="bash">{`cp .env.example .env`}</CodeBlock>

                    <Step n={4}><strong>Start the development server</strong> — the app runs on port 9000 by default</Step>
                    <CodeBlock lang="bash">{`npm run dev
# → http://localhost:9000`}</CodeBlock>

                    <Step n={5}><strong>Build for production</strong></Step>
                    <CodeBlock lang="bash">{`npm run build
# Output in dist/`}</CodeBlock>

                    <SectionHeading id="env-config" level={3}>Environment Configuration</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        Create a <InlineCode>.env</InlineCode> file in the <InlineCode>tavro_app/</InlineCode> directory with the following variables:
                    </p>
                    <CodeBlock lang=".env">{`# ── API ──────────────────────────────────────────────────────────────
VITE_TWIN_API_URL=http://localhost:8000      # Tavro backend REST API
VITE_MCP_URL=http://localhost:9001/zitadel/mcp  # MCP server endpoint

# ── ZITADEL Identity Provider ────────────────────────────────────────
VITE_ZITADEL_ISSUER=https://your-zitadel-domain.com
VITE_ZITADEL_CLIENT_ID=<your-application-client-id>
VITE_ZITADEL_REDIRECT_PATH=/auth/callback
VITE_ZITADEL_SCOPE=openid profile email urn:zitadel:iam:user:resourceowner

# ── LLM Keys (server-side / playground backend) ──────────────────────
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
AZURE_AI_FOUNDRY_ENDPOINT=https://<resource>.openai.azure.com
AZURE_AI_FOUNDRY_KEY=<azure-key>

# ── Database (backend only) ──────────────────────────────────────────
DATABASE_URL=postgresql://tavro:postgres@localhost:5433/tavro`}</CodeBlock>

                    <DataTable
                        headers={['Variable', 'Required', 'Description']}
                        rows={[
                            ['VITE_TWIN_API_URL', <Badge color="red">Required</Badge>, 'Base URL of the Tavro REST API. All /agents, /use-cases, /compliance, etc. calls go here.'],
                            ['VITE_MCP_URL', <Badge color="amber">Recommended</Badge>, 'MCP server endpoint. Required for Blueprint context in the AI Assistant and Playground.'],
                            ['VITE_ZITADEL_ISSUER', <Badge color="red">Required</Badge>, 'OIDC issuer URL from your ZITADEL instance.'],
                            ['VITE_ZITADEL_CLIENT_ID', <Badge color="red">Required</Badge>, 'OAuth2 client ID registered in ZITADEL for this application.'],
                            ['VITE_ZITADEL_REDIRECT_PATH', <Badge color="red">Required</Badge>, 'Callback path after successful login (register this URI in ZITADEL).'],
                            ['VITE_ZITADEL_SCOPE', <Badge color="red">Required</Badge>, 'OAuth2 scopes — must include openid and the ZITADEL resource owner scope.'],
                            ['ANTHROPIC_API_KEY', <Badge color="slate">Optional</Badge>, 'Required only if using Anthropic (Claude) as the Playground LLM backend.'],
                            ['AZURE_AI_FOUNDRY_ENDPOINT / KEY', <Badge color="slate">Optional</Badge>, 'Required only if using Azure AI Foundry as the Playground LLM backend.'],
                        ]}
                    />

                    <SectionHeading id="authentication" level={3}>Authentication</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        Tavro uses <strong className="text-slate-800 dark:text-slate-200">OIDC with PKCE</strong> (Proof Key for Code Exchange) for secure authentication — no client secret is stored in the browser. Here is the complete login flow:
                    </p>
                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 p-4 my-4 font-mono text-xs text-slate-600 dark:text-slate-300 space-y-2">
                        <div className="flex items-center gap-2"><span className="text-blue-500 font-bold">1</span> Browser → ZITADEL: Authorization request + PKCE challenge</div>
                        <div className="flex items-center gap-2 pl-4"><ArrowRight size={10} className="text-slate-400" /> ZITADEL: User logs in, returns authorization code</div>
                        <div className="flex items-center gap-2"><span className="text-blue-500 font-bold">2</span> Browser → ZITADEL: Exchange code + PKCE verifier for tokens</div>
                        <div className="flex items-center gap-2 pl-4"><ArrowRight size={10} className="text-slate-400" /> Receives: access_token, id_token, refresh_token</div>
                        <div className="flex items-center gap-2"><span className="text-blue-500 font-bold">3</span> Tokens stored in localStorage under tavro_* keys</div>
                        <div className="flex items-center gap-2"><span className="text-blue-500 font-bold">4</span> All API calls include: <code className="text-blue-400">Authorization: Bearer &lt;access_token&gt;</code></div>
                        <div className="flex items-center gap-2"><span className="text-blue-500 font-bold">5</span> Silent token refresh via refresh_token when access_token expires</div>
                    </div>
                    <Callout type="warning" title="Session Expiry">
                        If a token refresh attempt fails, Tavro automatically fires a <InlineCode>tavro:session_expired</InlineCode> event, clears all auth tokens from localStorage, and redirects the user to the login page. No manual intervention is required.
                    </Callout>


                    {/* ══════════════════════════════════════════════════════════
                        SECTION 3 · UI WALKTHROUGH
                    ══════════════════════════════════════════════════════════ */}
                    <SectionHeading id="ui-walkthrough" level={2} icon={<Layers size={18} />}>
                        UI Walkthrough
                    </SectionHeading>

                    <SectionHeading id="layout-overview" level={3}>Layout Overview</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
                        The Tavro interface is divided into three horizontal zones that respond to user interaction:
                    </p>
                    <div className="grid grid-cols-3 gap-3 my-4">
                        {[
                            { label: 'Left Sidebar', desc: 'Collapsible navigation — 280px expanded, 72px collapsed', color: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30' },
                            { label: 'Main Content', desc: 'Scrollable page content — grows to fill available space (max 1600px)', color: 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30' },
                            { label: 'Right Panel', desc: 'Resizable AI chat / logs / attachments — 72px when closed, 300–640px when open', color: 'border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30' },
                        ].map(z => (
                            <div key={z.label} className={`rounded-xl border p-4 ${z.color}`}>
                                <p className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">{z.label}</p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{z.desc}</p>
                            </div>
                        ))}
                    </div>
                    <Callout type="tip" title="Responsive Resizing">
                        Both sidebars update CSS custom properties (<InlineCode>--tavro-left-rail-width</InlineCode> and <InlineCode>--tavro-right-rail-width</InlineCode>) so any child component can react to layout changes without prop drilling.
                    </Callout>

                    <SectionHeading id="left-sidebar" level={3}>Left Navigation Sidebar</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        The left sidebar contains all primary navigation and a live Catalog Sync widget. Collapse or expand it using the <strong>chevron button</strong> on its right edge (near the top). When collapsed, nav items show icon-only with tooltips on hover.
                    </p>
                    <DataTable
                        headers={['Nav Item', 'Route', 'Description']}
                        rows={[
                            ['Home', '/', 'Landing dashboard with quick-access cards'],
                            ['AI Use Cases', '/use-cases', 'All AI initiative records'],
                            ['Agents', '/catalog', 'Agent catalog grid/list'],
                            ['Applications', '/applications', 'Business application registry'],
                            ['Processes', '/processes', 'Business process hierarchy'],
                            ['Integrations', '/integrations', 'System integration catalog'],
                            ['Spark', '/spark', 'AI idea generation studio'],
                            ['Insights', '/insights', 'Portfolio analytics & risk reports'],
                            ['Blueprint', '/blueprint', 'Digital twin graph explorer'],
                            ['Compliance', '/compliance', 'Regulations & policies'],
                            ['Audit Center', '/audit', 'Audit runs and findings'],
                            ['Agent Playground', '/playground', 'Agent prototype & test environment'],
                            ['Help', '/help', 'This user guide'],
                            ['Settings', '/settings', 'Platform configuration'],
                            ['Sign Out', '—', 'Clears session and redirects to login'],
                        ]}
                    />

                    <SectionHeading id="right-panel" level={3}>Right Panel</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        The right panel is a multi-tab workspace that provides contextual tools without leaving the current page. It has three tabs:
                    </p>
                    <DataTable
                        headers={['Tab', 'Icon', 'When Available', 'Description']}
                        rows={[
                            ['AI Assistant', 'MessageCircle', 'Always', 'Context-aware chat powered by your configured LLM provider'],
                            ['Dev Logs', 'Terminal', 'When Show Logs is enabled in Settings', 'Structured real-time log stream from the MCP layer and API calls'],
                            ['Attachments', 'Paperclip', 'On Agent, Use Case, Application, and Process pages', 'Upload and manage reference documents for the current entity'],
                        ]}
                    />
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        The panel can be <strong>resized</strong> by dragging the handle on its left edge. It will occupy between 300px and 50% of your screen width. A collapse button appears on the drag handle on hover.
                    </p>

                    <SectionHeading id="catalog-sync" level={3}>Catalog Sync Widget</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        Located at the bottom of the left sidebar (visible only when expanded), the Catalog Sync widget shows:
                    </p>
                    <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1.5 ml-4 mb-4">
                        <li className="flex items-start gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" /> Live agent and use case counts from the latest catalog fetch</li>
                        <li className="flex items-start gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" /> "Last synced X minutes ago" timestamp that updates every 30 seconds</li>
                        <li className="flex items-start gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" /> A <strong>Refresh Catalog</strong> button that simultaneously re-fetches agents and use cases</li>
                        <li className="flex items-start gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" /> Animated spinner during active fetch — the button is disabled while syncing</li>
                    </ul>


                    {/* ══════════════════════════════════════════════════════════
                        SECTION 4 · CORE FEATURES
                    ══════════════════════════════════════════════════════════ */}
                    <SectionHeading id="features" level={2} icon={<Star size={18} />}>
                        Core Features
                    </SectionHeading>

                    {/* Home */}
                    <SectionHeading id="home" level={3}>Home Dashboard</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        The home page provides a quick-action landing pad. From here you can jump directly to Use Cases, the Agent Catalog, or Insights. It is the default destination after login and after the Tavro logo is clicked.
                    </p>

                    {/* Use Cases */}
                    <SectionHeading id="use-cases" level={3}>AI Use Cases</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        Use Cases are the central unit of AI initiative planning in Tavro. Each use case documents a specific business problem that AI is intended to solve, along with its expected benefits, priority, and the agents, applications, and processes involved.
                    </p>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Creating a Use Case</p>
                    <Step n={1}>Navigate to <strong>AI Use Cases</strong> → click <strong>+ New Use Case</strong></Step>
                    <Step n={2}>Fill in <strong>Title</strong>, <strong>Problem Statement</strong>, and <strong>Expected Benefits</strong></Step>
                    <Step n={3}>Set <strong>Priority</strong> (High / Medium / Low) and <strong>Status</strong> (Proposed / Active / In Review / Deprecated)</Step>
                    <Step n={4}>Link <strong>Agents</strong>, <strong>Applications</strong>, and <strong>Business Processes</strong> to contextualize scope</Step>
                    <Step n={5}>Add <strong>Controls</strong> and trigger a <strong>Risk Assessment</strong> once agents are linked</Step>
                    <DataTable
                        headers={['Field', 'Type', 'Description']}
                        rows={[
                            ['Title', 'Text', 'Short name for the use case — shown in catalog and search'],
                            ['Description', 'Text', 'Executive summary of what the AI initiative does'],
                            ['Problem Statement', 'Text', 'The business problem or pain point being addressed'],
                            ['Expected Benefits', 'Text', 'Measurable or qualitative outcomes expected'],
                            ['Priority', 'Enum', 'High / Medium / Low — drives ranking in the catalog'],
                            ['Status', 'Enum', 'Proposed → Active → In Review → Deprecated lifecycle'],
                            ['Function', 'Text', 'Business function (e.g. Finance, HR, Operations)'],
                            ['Overall Risk', 'Computed', 'Aggregated from linked agent risk assessments'],
                        ]}
                    />

                    {/* Agents */}
                    <SectionHeading id="agents" level={3}>Agent Catalog</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        The Agent Catalog is the authoritative registry of every AI agent in your enterprise. Each entry captures the agent's identity, technical configuration, risk profile, and its relationships to business systems and regulations.
                    </p>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Agent Detail Tabs</p>
                    <DataTable
                        headers={['Tab', 'Contents']}
                        rows={[
                            ['Identification', 'Role, instructions, goal orientation, environment, owner, governance tags, governance status badge'],
                            ['Technology Config', 'Autonomy level, access scope, memory type, data freshness policy, reasoning model, tools, MCP servers, guardrails, security schemes'],
                            ['Related', 'Linked applications, business processes, use cases, knowledge sources, skills, prompt templates'],
                            ['Risk Assessment', 'Risk scores (Blended, AIVSS, Regulatory), risk classification badges, assessment date, state, and assessor'],
                        ]}
                    />
                    <Callout type="info" title="Risk Assessment Workflow">
                        Triggering a risk assessment sends the agent's full profile to the AI assessment engine. Results return asynchronously — the catalog polls for completion and displays a spinner on the agent card until the assessment completes. Risk scores include <strong>Blended Risk</strong>, <strong>AIVSS</strong> (AI Vulnerability Scoring System), and <strong>Regulatory Risk</strong> classifications.
                    </Callout>

                    {/* Applications */}
                    <SectionHeading id="applications" level={3}>Business Applications</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        The Applications module tracks every software system in your enterprise that AI agents interact with. Key fields include:
                    </p>
                    <DataTable
                        headers={['Field', 'Description']}
                        rows={[
                            ['Application Name', 'Official system name (e.g. Salesforce CRM, SAP ERP)'],
                            ['Business Criticality', 'Impact level if the system becomes unavailable'],
                            ['Emergency Tier', 'Urgency classification for incident response'],
                            ['Business Owner', 'Named accountable executive or team'],
                            ['Vendor Name', 'Third-party vendor if applicable'],
                            ['Embedded AI', 'Flag indicating the application has built-in AI features'],
                            ['Data Excluded from AI Training', 'Whether data in this app is excluded from model training'],
                            ['Privacy Policy URL', 'Link to the application\'s privacy/data handling documentation'],
                            ['Related Agents', 'Count and list of agents that interact with this application'],
                        ]}
                    />

                    {/* Processes */}
                    <SectionHeading id="processes" level={3}>Business Processes</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        Business Processes allow you to model your organizational workflows and understand where AI agents are embedded. Processes support a <strong>parent–child hierarchy</strong> — a top-level process (e.g. "Order to Cash") can contain sub-processes (e.g. "Invoice Processing", "Payment Reconciliation").
                    </p>
                    <DataTable
                        headers={['Field', 'Description']}
                        rows={[
                            ['Process Name / Number', 'Identifier and human-readable name'],
                            ['Criticality', 'How critical this process is to business operations'],
                            ['Impact Dimensions', 'Separate ratings for Reputational, Financial, and Regulatory impact'],
                            ['SLA', 'Service level agreement for process completion'],
                            ['Process Health State', 'Current operational status (Healthy, Degraded, At Risk)'],
                            ['Stakeholders / Operators', 'Named individuals or teams who own and run the process'],
                            ['Parent Process', 'Links this process into a hierarchy'],
                            ['Related Use Cases', 'AI use cases that automate or support this process'],
                        ]}
                    />

                    {/* Integrations */}
                    <SectionHeading id="integrations" level={3}>Integrations</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        Integrations catalog the APIs, webhooks, data feeds, and connectors that AI agents use to exchange data with external systems. Each integration record includes:
                    </p>
                    <DataTable
                        headers={['Field', 'Description']}
                        rows={[
                            ['Protocol', 'REST, GraphQL, SOAP, gRPC, WebSocket, etc.'],
                            ['Authentication Method', 'OAuth2, API Key, Basic Auth, mTLS, etc.'],
                            ['Endpoint URL', 'Base URL of the integration target'],
                            ['Data Sensitivity', 'Classification of data flowing through this integration'],
                            ['Rate Limit', 'Requests per second / per minute allowed'],
                            ['Availability Status', 'Live operational status (Online, Degraded, Offline)'],
                            ['SLA', 'Uptime or response time commitment'],
                            ['Parent Application', 'The business application this integration belongs to'],
                        ]}
                    />

                    {/* Spark */}
                    <SectionHeading id="spark" level={3}>Spark — AI Idea Generation</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        Spark is Tavro's AI-powered brainstorming studio. It analyzes your current Blueprint, agent coverage, and compliance landscape to surface high-value opportunities where new AI agents could add business value.
                    </p>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Generating Ideas</p>
                    <Step n={1}>Navigate to <strong>Spark</strong></Step>
                    <Step n={2}>Select <strong>Target Dimensions</strong> from your Blueprint that you want ideas focused on</Step>
                    <Step n={3}>Click <strong>Generate Ideas</strong> — Spark sends your company context to Claude and streams back a batch of opportunities</Step>
                    <Step n={4}>Review each idea card: <strong>Signal Type</strong>, <strong>Complexity</strong>, <strong>Estimated Impact</strong>, and <strong>Similar Agents</strong> already in your catalog</Step>
                    <Step n={5}>Save interesting ideas, then <strong>Convert to Use Case</strong> to promote them into the full AI use case workflow</Step>
                    <DataTable
                        headers={['Signal Type', 'Meaning']}
                        rows={[
                            [<Badge color="blue">Gap Coverage</Badge>, 'A process or dimension that has no agent support yet'],
                            [<Badge color="red">Risk Hotspot</Badge>, 'An area of high risk exposure that could benefit from AI monitoring'],
                            [<Badge color="amber">Integration Surface</Badge>, 'An integration point that is under-leveraged by current agents'],
                            [<Badge color="violet">Compliance Gap</Badge>, 'A compliance requirement with no corresponding AI control'],
                            [<Badge color="slate">Strategic Gap</Badge>, 'A strategic initiative without AI acceleration'],
                        ]}
                    />

                    {/* Insights */}
                    <SectionHeading id="insights" level={3}>Insights</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        Insights provides cross-portfolio analytics for AI governance reporting. From this page, leadership can review the overall risk landscape, agent coverage across business dimensions, and compliance readiness metrics.
                    </p>

                    {/* Blueprint */}
                    <SectionHeading id="blueprint" level={3}>Blueprint — Digital Twin</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        Blueprint is Tavro's <strong>organizational digital twin</strong> — a queryable graph of every significant dimension in your business. It acts as the connective tissue linking agents, use cases, compliance rules, and real-world systems together.
                    </p>
                    <Callout type="note" title="First-Time Setup">
                        Before using Blueprint, complete the <strong>Blueprint Setup</strong> wizard (<InlineCode>/blueprint/setup</InlineCode>) to register your company and define your initial dimension types.
                    </Callout>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2 mt-4">Dimension Categories</p>
                    <DataTable
                        headers={['Category', 'Description', 'Examples']}
                        rows={[
                            [<Badge color="blue">profile</Badge>, 'Core company identity', 'Legal entity, industry, region'],
                            [<Badge color="slate">strategy</Badge>, 'Strategic objectives & OKRs', 'Growth targets, digital transformation pillars'],
                            [<Badge color="green">process</Badge>, 'Business workflows', 'Order management, HR onboarding'],
                            [<Badge color="amber">application</Badge>, 'Software systems', 'Salesforce, SAP, custom apps'],
                            [<Badge color="slate">organisation</Badge>, 'Teams & org structure', 'Finance Dept, CISO Office'],
                            [<Badge color="red">risk</Badge>, 'Risk domains', 'Operational risk, data breach risk'],
                            [<Badge color="slate">finance</Badge>, 'Financial dimensions', 'Cost centers, revenue streams'],
                            [<Badge color="violet">integration</Badge>, 'System integrations', 'REST API connections, data feeds'],
                            [<Badge color="slate">technology</Badge>, 'Technology stack components', 'Cloud infrastructure, ML platforms'],
                            [<Badge color="slate">custom</Badge>, 'User-defined dimensions', 'Any business-specific concept'],
                        ]}
                    />
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2 mt-4">Relationship Types</p>
                    <DataTable
                        headers={['Relationship', 'Meaning']}
                        rows={[
                            ['depends_on', 'Node A requires Node B to function'],
                            ['owned_by', 'Node A is owned/governed by Node B'],
                            ['supports', 'Node A provides support or capability to Node B'],
                            ['risks', 'Node A introduces risk to Node B'],
                            ['enables', 'Node A makes Node B possible'],
                            ['part_of', 'Node A is a component of Node B'],
                            ['governed_by', 'Node A is governed by regulation or policy Node B'],
                            ['replaced_by', 'Node A is being replaced by Node B'],
                            ['custom', 'User-defined relationship type'],
                        ]}
                    />
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2 mt-4">Views</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        Blueprint supports three viewing modes — switch between them using the toolbar:
                    </p>
                    <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1.5 ml-4 mb-4">
                        <li className="flex items-start gap-2"><span className="text-blue-500 font-bold flex-shrink-0">Graph</span> Interactive node-link diagram powered by React Flow with automatic Dagre layout</li>
                        <li className="flex items-start gap-2"><span className="text-blue-500 font-bold flex-shrink-0">Grid</span> Card grid view — useful for quickly browsing all nodes in a category</li>
                        <li className="flex items-start gap-2"><span className="text-blue-500 font-bold flex-shrink-0">List</span> Tabular view — best for bulk operations and exports</li>
                    </ul>

                    {/* Compliance */}
                    <SectionHeading id="compliance" level={3}>Compliance</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        The Compliance module tracks <strong>Regulations</strong> (external requirements like GDPR, SOC 2, ISO 27001) and <strong>Policies</strong> (internal governance rules). For each item, you document dimensions, map impacts to Blueprint nodes, and track gap closure status.
                    </p>
                    <DataTable
                        headers={['Concept', 'Description']}
                        rows={[
                            ['Compliance Item', 'A regulation or internal policy with scope, status, and lifecycle dates'],
                            ['Dimension', 'A structured aspect of the regulation (requirement, control, deadline, penalty, audit, etc.)'],
                            ['Impact', 'A mapping from this compliance item to a specific Blueprint node, with gap status and remediation plan'],
                            ['Document', 'Attached source documents — can be typed as source text, guidance, evidence, audit trail, or policy text'],
                            ['Gap Status', 'open → in_progress → closed / accepted / not_applicable'],
                            ['Impact Level', 'critical / high / medium / low / none — drives risk prioritization'],
                        ]}
                    />
                    <Callout type="tip" title="AI Research">
                        For regulations, use the <strong>AI Research</strong> button to automatically fetch and summarize public regulatory sources. Tavro will populate dimensions, summaries, and source references from publicly available documentation.
                    </Callout>

                    {/* Audit */}
                    <SectionHeading id="audit" level={3}>Audit Center</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        The Audit Center runs AI-powered compliance audits that systematically evaluate your AI use cases against compliance requirements. Audits stream results in real-time using <strong>Server-Sent Events (SSE)</strong>.
                    </p>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Audit Scope Types</p>
                    <DataTable
                        headers={['Scope', 'Coverage']}
                        rows={[
                            [<Badge color="blue">single</Badge>, '1 specific use case × 1 specific compliance item — targeted spot check'],
                            [<Badge color="amber">use_case_all</Badge>, '1 specific use case × all compliance items — full compliance picture for a single initiative'],
                            [<Badge color="amber">catalog_single</Badge>, 'All use cases × 1 compliance item — impact analysis for a new regulation or policy'],
                            [<Badge color="red">full</Badge>, 'All use cases × all compliance items — complete enterprise-wide compliance audit'],
                        ]}
                    />
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2 mt-4">Reading Audit Findings</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">Each finding produced by an audit contains:</p>
                    <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1.5 ml-4 mb-4">
                        <li className="flex items-start gap-2"><AlertCircle size={14} className="text-red-400 mt-0.5 flex-shrink-0" /> <strong>Risk Level</strong> — critical / high / medium / low / none</li>
                        <li className="flex items-start gap-2"><AlertCircle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" /> <strong>Gaps</strong> — identified compliance gaps with severity</li>
                        <li className="flex items-start gap-2"><CheckCircle2 size={14} className="text-emerald-400 mt-0.5 flex-shrink-0" /> <strong>Compliant Areas</strong> — requirements already satisfied</li>
                        <li className="flex items-start gap-2"><ArrowRight size={14} className="text-blue-400 mt-0.5 flex-shrink-0" /> <strong>Recommendations</strong> — prioritized action items (immediate / short-term / long-term)</li>
                    </ul>

                    {/* Playground */}
                    <SectionHeading id="playground" level={3}>Agent Playground</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        The Agent Playground is a prototyping environment for designing and testing agents before they are formally catalogued. You can configure a complete agent runtime — system prompt, tools, LLM provider, temperature — and run test conversations against real business context.
                    </p>
                    <DataTable
                        headers={['Configuration', 'Description']}
                        rows={[
                            ['Infrastructure Provider', 'Choose between Claude (Anthropic) or Azure AI Foundry'],
                            ['Model', 'Select the specific model for the chosen provider'],
                            ['System Prompt', 'Free-form agent instruction — use Blueprint context to inject real company data'],
                            ['Tools', 'Enable built-in tools: web_search, code_interpreter, file_search, blueprint_context (MCP)'],
                            ['Temperature', 'Controls response creativity (0 = deterministic, 1 = highly creative)'],
                            ['Max Tokens', 'Maximum response length per turn'],
                        ]}
                    />
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2 mt-4">Observations</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        While chatting, you can attach <strong>Observations</strong> to any message — structured annotations that capture your notes about the agent's behavior:
                    </p>
                    <DataTable
                        headers={['Observation Type', 'Use When']}
                        rows={[
                            [<Badge color="red">gap</Badge>, 'The agent failed to handle a scenario or gave an incomplete answer'],
                            [<Badge color="green">works_well</Badge>, 'The agent performed exactly as expected'],
                            [<Badge color="amber">needs_info</Badge>, 'The agent needed more context to respond correctly'],
                            [<Badge color="violet">unexpected</Badge>, 'The agent produced a surprising or out-of-scope response'],
                            [<Badge color="slate">note</Badge>, 'General note for review during session summary'],
                        ]}
                    />
                    <Callout type="tip" title="Session Summary">
                        At the end of a session, click <strong>Generate Summary</strong> to have the AI summarize the conversation, key observations, and recommended improvements to the agent's system prompt or toolset.
                    </Callout>


                    {/* ══════════════════════════════════════════════════════════
                        SECTION 5 · AI ASSISTANT
                    ══════════════════════════════════════════════════════════ */}
                    <SectionHeading id="ai-assistant" level={2} icon={<MessageCircle size={18} />}>
                        AI Assistant
                    </SectionHeading>

                    <SectionHeading id="chat-panel" level={3}>Chat Panel</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        The AI Assistant is accessible from the right panel on every page. It provides a persistent chat interface powered by your configured LLM — conversations are preserved across page navigations within a session.
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        Key behaviors:
                    </p>
                    <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1.5 ml-4 mb-4">
                        <li className="flex items-start gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" /> Streams responses in real-time — switching to the Dev Logs tab does not interrupt an active stream</li>
                        <li className="flex items-start gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" /> Supports file attachments — upload documents to include in the conversation context</li>
                        <li className="flex items-start gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" /> Multiple named sessions — create and switch between separate conversation threads</li>
                        <li className="flex items-start gap-2"><CheckCircle2 size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" /> Sessions persist in localStorage — they survive page refresh but are cleared on Sign Out</li>
                    </ul>

                    <SectionHeading id="context-awareness" level={3}>Context Awareness</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        Tavro automatically injects the current page context into the AI Assistant's system prompt, so it always understands what you're looking at:
                    </p>
                    <DataTable
                        headers={['Current Page', 'Injected Context']}
                        rows={[
                            ['Agent Detail', 'Full agent record: role, instructions, tools, models, risk assessments, related entities'],
                            ['Use Case Detail', 'Use case name, description, problem statement, linked agents and processes'],
                            ['Blueprint', 'Compressed list of up to 30 key nodes from the current company\'s digital twin'],
                            ['Settings', 'Platform configuration context — useful for asking configuration questions'],
                            ['All other pages', 'Generic Tavro platform context'],
                        ]}
                    />


                    {/* ══════════════════════════════════════════════════════════
                        SECTION 6 · SETTINGS
                    ══════════════════════════════════════════════════════════ */}
                    <SectionHeading id="settings-config" level={2} icon={<Settings size={18} />}>
                        Settings &amp; Configuration
                    </SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        Access Settings from the bottom of the left sidebar. Settings are divided into four sections:
                    </p>

                    <SectionHeading id="llm-config" level={3}>LLM Provider Setup</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        The AI Assistant uses a configurable LLM provider. Tavro currently ships with <strong>Copilot SDK</strong> as the default provider, which supports four BYOK (Bring Your Own Key) backend types:
                    </p>
                    <DataTable
                        headers={['Backend Type', 'Required Fields', 'Notes']}
                        rows={[
                            ['GitHub Copilot', 'API Key, Model', 'Default model: gpt-4.1'],
                            ['OpenAI', 'API Key, Model', 'Supports gpt-4o, gpt-5.5'],
                            ['Azure OpenAI', 'API Key, Base URL, Model', 'Base URL must be your Azure resource endpoint'],
                            ['Anthropic', 'API Key, Model', 'Supports claude-sonnet-4-6, claude-sonnet-4-5'],
                        ]}
                    />
                    <Step n={1}>In Settings, expand the <strong>Copilot SDK</strong> provider card</Step>
                    <Step n={2}>Select your <strong>Provider Type</strong> (GitHub / OpenAI / Azure / Anthropic)</Step>
                    <Step n={3}>If Azure: enter your <strong>Base URL</strong></Step>
                    <Step n={4}>Enter your <strong>API Key</strong> and select a <strong>Model</strong></Step>
                    <Step n={5}>Click <strong>Save</strong>, then click <strong>Use this LLM</strong> to activate it</Step>
                    <Callout type="warning" title="API Key Storage">
                        API keys are stored in browser <InlineCode>localStorage</InlineCode>. They are never sent to Tavro's backend — they are transmitted directly from your browser to the LLM provider endpoint. Do not use production keys on shared or public machines.
                    </Callout>

                    <SectionHeading id="mcp-connection" level={3}>MCP Connection</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        The <strong>Model Context Protocol (MCP)</strong> server provides the AI Assistant and Playground with real-time access to your Blueprint data and other tools. The MCP server URL is read from <InlineCode>VITE_MCP_URL</InlineCode> and is displayed read-only in Settings. Authentication is handled automatically via the same OIDC tokens used for the REST API.
                    </p>

                    <SectionHeading id="dev-settings" level={3}>Developer Settings</SectionHeading>
                    <DataTable
                        headers={['Setting', 'Default', 'Effect']}
                        rows={[
                            ['Show Logs', 'Off', 'Enables the Dev Logs tab in the right panel. Displays structured MCP and API log events in a scrollable ring buffer (up to 500 entries).'],
                        ]}
                    />

                    <SectionHeading id="appearance" level={3}>Appearance</SectionHeading>
                    <DataTable
                        headers={['Theme', 'Description']}
                        rows={[
                            ['Light', 'Default white/slate UI — best for well-lit environments'],
                            ['Dark', 'Dark slate background — reduced eye strain in low-light settings'],
                            ['System', 'Follows your operating system\'s light/dark mode preference automatically'],
                        ]}
                    />


                    {/* ══════════════════════════════════════════════════════════
                        SECTION 7 · API REFERENCE
                    ══════════════════════════════════════════════════════════ */}
                    <SectionHeading id="api-reference" level={2} icon={<Code2 size={18} />}>
                        API Reference
                    </SectionHeading>

                    <SectionHeading id="api-auth" level={3}>Authentication</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        All Tavro API endpoints require a valid Bearer token and a tenant identifier:
                    </p>
                    <CodeBlock lang="http">{`GET /api/agents HTTP/1.1
Host: your-tavro-backend.com
Authorization: Bearer <access_token>
x-tenant-id: <your-tenant-uuid>
Content-Type: application/json`}</CodeBlock>
                    <Callout type="note" title="Tenant Isolation">
                        Every request must include the <InlineCode>x-tenant-id</InlineCode> header. This is automatically extracted from the ZITADEL access token claims and stored in localStorage as <InlineCode>tavro_tenant_id</InlineCode> after login.
                    </Callout>

                    <SectionHeading id="api-endpoints" level={3}>Endpoint Index</SectionHeading>
                    <DataTable
                        headers={['Module', 'Base Path', 'Key Operations']}
                        rows={[
                            ['Agents', '/agents', 'GET (list, paginated), GET /:id, POST, PUT /:id, DELETE /:id, POST /suggest-description'],
                            ['Use Cases', '/use-cases', 'GET (list), GET /:id, POST, PUT /:id, DELETE /:id, attachments CRUD'],
                            ['Applications', '/applications', 'GET (list, paginated), GET /:id, POST, PUT /:id, DELETE /:id'],
                            ['Processes', '/processes', 'GET (list), GET /:id, POST, PUT /:id, DELETE /:id'],
                            ['Integrations', '/integrations', 'GET (list), GET /:id, POST, PUT /:id, DELETE /:id'],
                            ['Blueprint – Companies', '/companies', 'GET (list), GET /:id, POST, PUT /:id, DELETE /:id'],
                            ['Blueprint – Dim Types', '/dim-types', 'GET (list), POST, PUT /:id, DELETE /:id'],
                            ['Blueprint – Nodes', '/dim-nodes', 'GET (list by company), GET /:id, POST, PUT /:id, DELETE /:id'],
                            ['Blueprint – Edges', '/dim-edges', 'GET (list by company), POST, DELETE /:id'],
                            ['Blueprint – Graph', '/graphs/:company_id', 'GET — returns full node + edge graph for React Flow'],
                            ['Compliance Items', '/compliance/items', 'GET (list), GET /:id, POST, PUT /:id, DELETE /:id'],
                            ['Compliance Dimensions', '/compliance/dimensions', 'GET (by item), POST, PUT /:id, DELETE /:id'],
                            ['Compliance Impacts', '/compliance/impacts', 'GET (by item & company), POST, PUT /:id, DELETE /:id'],
                            ['Compliance Documents', '/compliance/documents', 'GET (by item), POST (multipart), DELETE /:id'],
                            ['Audit Runs', '/audit/runs', 'GET (list), GET /:id, POST (initiate)'],
                            ['Audit Stream', '/audit/runs/:id/stream', 'GET — SSE stream of live audit progress events'],
                            ['Spark Ideas', '/spark/ideas', 'GET (list), DELETE /:id'],
                            ['Spark Generate', '/spark/generate', 'POST — returns array of SparkIdea'],
                            ['Spark Convert', '/spark/convert', 'POST — converts idea to UseCaseDetail'],
                        ]}
                    />

                    <Callout type="info" title="Audit Streaming">
                        The audit stream endpoint (<InlineCode>GET /audit/runs/:id/stream</InlineCode>) uses <strong>Server-Sent Events</strong>. The Vite dev proxy is pre-configured to pass SSE headers through correctly. Each event carries a JSON payload with the finding result or a <InlineCode>done</InlineCode> / <InlineCode>error</InlineCode> sentinel.
                    </Callout>


                    {/* ══════════════════════════════════════════════════════════
                        SECTION 8 · ARCHITECTURE
                    ══════════════════════════════════════════════════════════ */}
                    <SectionHeading id="architecture" level={2} icon={<GitBranch size={18} />}>
                        Architecture Overview
                    </SectionHeading>

                    <SectionHeading id="tech-stack" level={3}>Technology Stack</SectionHeading>
                    <DataTable
                        headers={['Layer', 'Technology', 'Version']}
                        rows={[
                            ['UI Framework', 'React', '18.3.1'],
                            ['Routing', 'React Router', '7.x'],
                            ['Language', 'TypeScript', '5.x'],
                            ['Build Tool', 'Vite', '6.x'],
                            ['Styling', 'TailwindCSS', '3.4.x'],
                            ['Icons', 'Lucide React', '1.x'],
                            ['Graph Visualization', '@xyflow/react (React Flow)', '12.x'],
                            ['Graph Layout Engine', '@dagrejs/dagre', '3.x'],
                            ['AI Protocol', '@modelcontextprotocol/sdk', '1.27.x'],
                            ['Markdown Rendering', 'react-markdown + remark-gfm', '10.x / 4.x'],
                            ['PDF Export', 'jsPDF', '4.x'],
                            ['Auth', 'Custom PKCE / OIDC (ZITADEL)', '—'],
                        ]}
                    />

                    <SectionHeading id="data-flow" level={3}>Data Flow</SectionHeading>
                    <CodeBlock lang="text">{`Browser (React SPA)
├── Context Providers (React Context API)
│   ├── CatalogContext    → Agent catalog, risk polling
│   ├── UseCaseContext    → Use case CRUD
│   ├── BlueprintContext  → Companies, dim types, nodes/edges, graph
│   ├── ComplianceContext → Compliance items (scoped to active company)
│   ├── PlaygroundContext → Session state, messages, observations
│   ├── ChatContext       → AI assistant view context
│   ├── ChatSessionContext→ Chat session lifecycle
│   └── ThemeContext      → Dark/light/system theme
│
├── Service Layer (TypeScript singletons)
│   ├── agentApi          → /agents REST endpoints
│   ├── useCaseApi        → /use-cases REST endpoints
│   ├── blueprintApi      → /companies, /dim-* REST endpoints
│   ├── complianceApi     → /compliance/* REST endpoints
│   ├── auditApi          → /audit/* + SSE streaming
│   ├── sparkApi          → /spark/* REST endpoints
│   ├── businessRelationsApi → /applications, /processes, /integrations
│   ├── llmService        → localStorage-backed LLM config
│   └── mcpClient         → MCP WebSocket/HTTP connection
│
├── All API calls → VITE_TWIN_API_URL + x-tenant-id header + Bearer token
└── MCP calls    → VITE_MCP_URL + Bearer token`}</CodeBlock>

                    <SectionHeading id="file-structure" level={3}>File Structure</SectionHeading>
                    <CodeBlock lang="text">{`tavro_app/
├── public/                     # Static assets served at root
├── src/
│   ├── assets/                 # Images, icons (travo_logo.png, etc.)
│   ├── components/             # Reusable React components
│   │   ├── Layout.tsx          # App shell: left nav, right panel, footer
│   │   ├── ChatPanel.tsx       # AI assistant right panel
│   │   ├── DevLogPanel.tsx     # Developer log viewer
│   │   ├── AttachmentPanel.tsx # Document upload panel
│   │   ├── AgentCatalog.tsx    # Agent grid/list component
│   │   ├── AgentView.tsx       # Agent detail view component
│   │   ├── BlueprintGraph.tsx  # React Flow graph wrapper
│   │   ├── BlueprintDimPanel.tsx # Node editor side panel
│   │   └── audit/
│   │       └── AuditInitModal.tsx
│   ├── context/                # React Context providers
│   │   ├── CatalogContext.tsx
│   │   ├── UseCaseContext.tsx
│   │   ├── BlueprintContext.tsx
│   │   ├── ComplianceContext.tsx
│   │   ├── PlaygroundContext.tsx
│   │   ├── ChatContext.tsx
│   │   ├── ChatSessionContext.tsx
│   │   └── ThemeContext.tsx
│   ├── hooks/                  # Custom React hooks
│   │   ├── useChatSync.ts      # Page → chat context sync
│   │   ├── useShowLogs.ts      # Dev log panel toggle
│   │   └── useInspectJson.ts   # JSON inspector toggle
│   ├── pages/                  # Route-level page components
│   │   ├── HomePage.tsx
│   │   ├── Dashboard.tsx       # /catalog
│   │   ├── AgentViewPage.tsx
│   │   ├── CreateAgentPage.tsx
│   │   ├── UseCasePage.tsx
│   │   ├── UseCaseViewPage.tsx
│   │   ├── CreateUseCasePage.tsx
│   │   ├── BlueprintPage.tsx
│   │   ├── BlueprintSetupPage.tsx
│   │   ├── PlaygroundPage.tsx
│   │   ├── CompliancePage.tsx
│   │   ├── ComplianceItemPage.tsx
│   │   ├── ComplianceSetupPage.tsx
│   │   ├── AuditCenterPage.tsx
│   │   ├── AuditRunDetailPage.tsx
│   │   ├── BusinessApplicationsPage.tsx
│   │   ├── BusinessApplicationViewPage.tsx
│   │   ├── BusinessProcessesPage.tsx
│   │   ├── BusinessProcessViewPage.tsx
│   │   ├── IntegrationsPage.tsx
│   │   ├── IntegrationViewPage.tsx
│   │   ├── SparkPage.tsx
│   │   ├── InsightsPage.tsx
│   │   ├── Settings.tsx
│   │   ├── UserGuidePage.tsx   # This page
│   │   ├── Login.tsx
│   │   └── AuthCallback.tsx
│   ├── services/               # API clients and utilities
│   │   ├── agentApi.ts
│   │   ├── useCaseApi.ts
│   │   ├── blueprintApi.ts
│   │   ├── complianceApi.ts
│   │   ├── auditApi.ts
│   │   ├── sparkApi.ts
│   │   ├── businessRelationsApi.ts
│   │   ├── llmService.ts       # LLM config (localStorage)
│   │   ├── mcpClient.ts        # MCP protocol client
│   │   ├── auth.ts             # OIDC token management
│   │   ├── authConfig.ts       # ZITADEL config
│   │   ├── pkce.ts             # PKCE code challenge
│   │   ├── buildSystemPrompt.ts# AI system prompt builder
│   │   └── logger.ts           # Ring-buffer logger
│   ├── store/
│   │   └── chatSessionStore.ts # Persisted chat sessions
│   ├── types/                  # TypeScript interfaces
│   │   ├── agent.ts
│   │   ├── useCase.ts
│   │   ├── blueprint.ts
│   │   ├── compliance.ts
│   │   ├── audit.ts
│   │   ├── spark.ts
│   │   ├── playground.ts
│   │   └── businessRelations.ts
│   ├── utils/
│   │   └── agentRisk.ts        # Risk assessment utilities
│   ├── App.tsx                 # Root router + providers
│   ├── App.css
│   ├── main.tsx                # React DOM entry point
│   └── index.css               # Tailwind directives
├── index.html
├── vite.config.ts              # Dev proxy + port config
├── tailwind.config.js
├── tsconfig.json
└── package.json`}</CodeBlock>


                    {/* ══════════════════════════════════════════════════════════
                        SECTION 9 · TROUBLESHOOTING
                    ══════════════════════════════════════════════════════════ */}
                    <SectionHeading id="troubleshooting" level={2} icon={<Terminal size={18} />}>
                        Troubleshooting
                    </SectionHeading>

                    <DataTable
                        headers={['Symptom', 'Likely Cause', 'Resolution']}
                        rows={[
                            [
                                'Redirected to /login immediately after opening the app',
                                'No valid session in localStorage or token expired with no refresh token',
                                'Clear localStorage and complete a fresh login. Verify VITE_ZITADEL_ISSUER and VITE_ZITADEL_CLIENT_ID are correct.',
                            ],
                            [
                                '"401 Unauthorized" errors in all API calls',
                                'Access token expired and silent refresh failed, or tenant ID not set',
                                'Sign out and back in. Check that tavro_tenant_id exists in localStorage after login.',
                            ],
                            [
                                'Agent Catalog shows 0 agents after load',
                                'VITE_TWIN_API_URL is misconfigured or the backend is not running',
                                'Open browser DevTools → Network. Check that /agents returns 200 with data. Verify the API URL in .env.',
                            ],
                            [
                                'AI Assistant shows "No LLM configured"',
                                'No active provider has been saved in Settings',
                                'Go to Settings → Chat AI Configuration → configure a provider and click "Use this LLM".',
                            ],
                            [
                                'Blueprint graph appears empty',
                                'No active company selected, or company has no nodes',
                                'Ensure you have completed Blueprint Setup. Use the company switcher at the top of the Blueprint page.',
                            ],
                            [
                                'Audit run stays "pending" indefinitely',
                                'MCP/audit backend is down, or SSE connection is blocked by a proxy',
                                'Check the Dev Logs panel for errors. Ensure the Vite proxy passes SSE Content-Type through (check vite.config.ts).',
                            ],
                            [
                                'MCP tools unavailable in Playground',
                                'VITE_MCP_URL is unreachable or authentication to MCP server failed',
                                'Verify the MCP server is running and accessible. Check VITE_MCP_URL in .env. Review Dev Logs for MCP connection errors.',
                            ],
                            [
                                'Dark mode not persisting on refresh',
                                'ThemeContext persists theme in localStorage as tavro_theme',
                                'Check that localStorage is not being cleared between sessions (private/incognito mode clears on close).',
                            ],
                            [
                                'Spark idea generation returns no results',
                                'No Blueprint nodes exist, or the AI research call is failing',
                                'Ensure Blueprint has nodes in at least 3+ dimension categories. Check network tab for /spark/generate errors.',
                            ],
                            [
                                '"Failed to fetch" on all API calls',
                                'CORS issue or backend is not running',
                                'In development, Vite proxies API calls — verify vite.config.ts proxy targets match your backend ports.',
                            ],
                        ]}
                    />

                    <Callout type="tip" title="Using Dev Logs for Debugging">
                        Enable <strong>Show Logs</strong> in Settings to open the Dev Logs panel. It shows a live ring-buffer of the last 500 log entries from MCP calls, API errors, and auth events — far faster than scanning browser DevTools for specific Tavro events.
                    </Callout>


                    {/* ══════════════════════════════════════════════════════════
                        SECTION 10 · GLOSSARY
                    ══════════════════════════════════════════════════════════ */}
                    <SectionHeading id="glossary" level={2} icon={<Hash size={18} />}>
                        Glossary
                    </SectionHeading>

                    <div className="space-y-3">
                        {[
                            { term: 'Agent', def: 'An autonomous or semi-autonomous AI system that performs tasks using tools, data, and instructions. In Tavro, agents are registered in the catalog with full governance metadata.' },
                            { term: 'AIVSS', def: 'AI Vulnerability Scoring System — a standardized scoring framework for assessing the risk profile of an AI agent, analogous to CVSS for software vulnerabilities.' },
                            { term: 'Audit Run', def: 'An AI-powered compliance evaluation that systematically checks use cases against compliance items and produces structured findings with gaps and recommendations.' },
                            { term: 'BYOK', def: 'Bring Your Own Key — the ability to configure Tavro with your own API key for a third-party LLM provider (OpenAI, Anthropic, Azure) rather than using a shared key.' },
                            { term: 'Blueprint', def: 'Tavro\'s organizational digital twin — a live graph of business dimensions (applications, processes, teams, strategy, etc.) that connects all entities in the platform.' },
                            { term: 'Compliance Item', def: 'A regulation (external) or policy (internal) tracked in Tavro. Each item has dimensions, impacts, documents, and lifecycle dates.' },
                            { term: 'Catalog Sync', def: 'The background process that fetches the latest agent and use case data from the backend API and updates the in-memory context providers.' },
                            { term: 'Dimension', def: 'A structured node in the Blueprint graph representing a named business concept. Each dimension belongs to a category (application, process, risk, etc.) and can have relationships to other dimensions.' },
                            { term: 'Digital Twin', def: 'A virtual representation of an organization\'s structure, processes, and systems — in Tavro, this is the Blueprint. It provides the shared context that connects agents to business reality.' },
                            { term: 'Gap', def: 'A compliance deficiency — a requirement that is not currently met by the organization\'s controls or AI use cases. Gaps have status (open, in_progress, closed, etc.) and remediation plans.' },
                            { term: 'Governance Status', def: 'The lifecycle state of an agent from a governance perspective (e.g., draft, approved, under review, deprecated).' },
                            { term: 'Impact', def: 'In Compliance: a mapping between a compliance item and a Blueprint node, documenting how that regulation affects that dimension and the current gap status.' },
                            { term: 'MCP', def: 'Model Context Protocol — an open standard for connecting AI models to tools and data sources. Tavro uses MCP to give the AI Assistant and Playground access to live Blueprint data and other capabilities.' },
                            { term: 'Observation', def: 'An annotation added to a Playground message during a test session. Observations classify agent behavior (gap, works_well, needs_info, unexpected, note) and feed into session summaries.' },
                            { term: 'OIDC', def: 'OpenID Connect — the identity protocol used for authentication in Tavro. ZITADEL is the configured identity provider.' },
                            { term: 'PKCE', def: 'Proof Key for Code Exchange — a security extension to OAuth2 that prevents authorization code interception attacks. Used in Tavro\'s login flow (no client secret in the browser).' },
                            { term: 'Playground', def: 'A sandboxed environment for prototyping AI agents with real business context before formal catalog registration.' },
                            { term: 'Risk Assessment', def: 'A structured evaluation of an agent\'s risk profile, producing Blended Risk, AIVSS, and Regulatory Risk scores with a classification (Critical / High / Medium / Low).' },
                            { term: 'Source Reference', def: 'In Blueprint: a pointer from a dimension node to its authoritative data source in an external system (identified by MCP tool + external ID).' },
                            { term: 'Spark', def: 'Tavro\'s AI idea generation feature. It analyzes your current coverage and surfaces new agent opportunities categorized by signal type.' },
                            { term: 'SSE', def: 'Server-Sent Events — a browser API for receiving streaming data from a server over HTTP. Used in Tavro for real-time audit progress updates.' },
                            { term: 'Tenant', def: 'An isolated organizational unit in Tavro. All data is scoped to a tenant ID, which is included in every API request via the x-tenant-id header.' },
                            { term: 'Use Case', def: 'A documented AI initiative — a structured record linking a business problem, its expected benefits, priority, status, and the agents, applications, and processes involved.' },
                            { term: 'ZITADEL', def: 'The open-source identity provider used for authentication and authorization in Tavro. It issues OIDC tokens and provides user management.' },
                        ].map(({ term, def }) => (
                            <div key={term} className="flex gap-4 p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700 transition-colors">
                                <div className="w-36 flex-shrink-0">
                                    <span className="text-xs font-bold text-slate-900 dark:text-white">{term}</span>
                                </div>
                                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{def}</p>
                            </div>
                        ))}
                    </div>

                    {/* Footer */}
                    <div className="mt-16 pt-8 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                        <div>
                            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Tavro Agent BizOps</p>
                            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">User Guide · v3.1 · © 2026 Tavro AI</p>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400">
                            <Globe size={12} />
                            <span>tavro.ai</span>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default UserGuidePage;
