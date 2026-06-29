import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    BookOpen, ChevronRight, ChevronDown, Search, X,
    Info, Lightbulb, AlertTriangle,
    Bot, ClipboardList, AppWindow, Workflow, Plug, Zap,
    BarChart2, Network, Scale, ShieldCheck, FlaskConical,
    Settings, MessageCircle,
    ArrowRight, CheckCircle2,
    Home, Play, LayoutGrid, List, Plus, Link2,
    ShieldAlert, Unlink2, PlusCircle, Settings2, MessageSquare,
    ClipboardCheck, Loader2,
    Building2, Globe, RefreshCw, Layers,
    Code2, Boxes, Map, TestTube2, Shield, TrendingUp, Activity,
    Upload, Filter, Bookmark, FileText
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
    type: 'info' | 'warning' | 'tip';
    title?: string;
    children: React.ReactNode;
}> = ({ type, title, children }) => {
    const styles = {
        info:    { wrap: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800',    icon: <Info size={15} className="text-blue-500 flex-shrink-0 mt-0.5" />,    titleColor: 'text-blue-700 dark:text-blue-300',    text: 'text-blue-800 dark:text-blue-200' },
        warning: { wrap: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800', icon: <AlertTriangle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />, titleColor: 'text-amber-700 dark:text-amber-300', text: 'text-amber-800 dark:text-amber-200' },
        tip:     { wrap: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800', icon: <Lightbulb size={15} className="text-emerald-500 flex-shrink-0 mt-0.5" />, titleColor: 'text-emerald-700 dark:text-emerald-300', text: 'text-emerald-800 dark:text-emerald-200' },
    };
    const s = styles[type];
    return (
        <div className={`flex gap-3 rounded-xl border px-4 py-3.5 my-4 ${s.wrap}`}>
            {s.icon}
            <div className="min-w-0">
                {title && <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${s.titleColor}`}>{title}</p>}
                <div className={`text-sm leading-relaxed ${s.text}`}>{children}</div>
            </div>
        </div>
    );
};

const InlineCode: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <code className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-blue-700 dark:text-blue-300 text-[13px] font-mono border border-slate-200 dark:border-slate-700">{children}</code>
);

const SectionHeading: React.FC<{ id: string; level?: 1 | 2 | 3; children: React.ReactNode; icon?: React.ReactNode }> = ({ id, level = 2, children, icon }) => {
    if (level === 2) return (
        <h2 id={id} className="flex items-center gap-2.5 text-xl font-bold text-slate-900 dark:text-slate-100 mt-12 mb-4 pt-8 border-t border-slate-100 dark:border-slate-800 scroll-mt-6">
            {icon && <span className="text-blue-500 dark:text-blue-400 flex-shrink-0">{icon}</span>}
            {children}
        </h2>
    );
    return (
        <h3 id={id} className="text-base font-semibold text-slate-800 dark:text-slate-200 mt-7 mb-3 scroll-mt-6">{children}</h3>
    );
};

const Badge: React.FC<{ color?: 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'slate' | 'rose'; children: React.ReactNode }> = ({ color = 'blue', children }) => {
    const c = { blue: 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700', green: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700', amber: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700', red: 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-700', violet: 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-700', slate: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600', rose: 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-700' };
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${c[color]}`}>{children}</span>;
};

const Step: React.FC<{ n: number; title?: string; children: React.ReactNode }> = ({ n, title, children }) => (
    <div className="flex gap-4 mb-5">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">{n}</div>
        <div className="flex-1 text-sm text-slate-700 dark:text-slate-300 leading-relaxed pt-0.5">
            {title && <strong className="text-slate-900 dark:text-slate-100 block mb-0.5">{title}</strong>}
            {children}
        </div>
    </div>
);

const UIButton: React.FC<{ color?: 'blue' | 'violet' | 'red' | 'slate' | 'rose'; icon?: React.ReactNode; children: React.ReactNode }> = ({ color = 'blue', icon, children }) => {
    const c = { blue: 'bg-blue-600 text-white', violet: 'bg-violet-600 text-white', red: 'bg-red-50 border border-red-300 text-red-700', rose: 'bg-rose-600 text-white', slate: 'bg-white border border-slate-300 text-slate-700 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300' };
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${c[color]}`}>
            {icon}<span>{children}</span>
        </span>
    );
};

// ─── Flow Diagram ─────────────────────────────────────────────────────────────

const FlowDiagram: React.FC<{ steps: { icon: React.ReactNode; label: string; color: string }[] }> = ({ steps }) => (
    <div className="my-5 overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
    <div className="flex items-center gap-2 p-4 bg-slate-50 dark:bg-slate-800/50 min-w-max">
        {steps.map((step, i) => (
            <React.Fragment key={step.label}>
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${step.color} text-sm font-semibold`}>
                    <span className="flex-shrink-0">{step.icon}</span>
                    <span>{step.label}</span>
                </div>
                {i < steps.length - 1 && <ArrowRight size={16} className="text-slate-400 flex-shrink-0" />}
            </React.Fragment>
        ))}
    </div>
    </div>
);

// ─── Screenshot Frame ─────────────────────────────────────────────────────────

const ScreenshotFrame: React.FC<{ title: string; src?: string; alt: string; placeholder?: string }> = ({ title, src, alt, placeholder }) => (
    <div className="my-5 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-lg">
        <div className="bg-slate-100 dark:bg-slate-800 px-4 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
            <div className="flex gap-1.5">
                <span className="w-3 h-3 rounded-full bg-red-400" />
                <span className="w-3 h-3 rounded-full bg-amber-400" />
                <span className="w-3 h-3 rounded-full bg-emerald-400" />
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium flex-1 text-center">{title}</span>
        </div>
        {src
            ? <img src={src} alt={alt} className="w-full block" />
            : <div className="w-full bg-slate-50 dark:bg-slate-900 flex items-center justify-center py-16 text-slate-400 dark:text-slate-600 text-xs text-center px-6">{placeholder}</div>
        }
    </div>
);

// ─── TOC Data ─────────────────────────────────────────────────────────────────

const TOC_SECTIONS: TocSection[] = [
    {
        id: 'nav-overview', label: 'Navigation', icon: <Layers size={14} />,
        children: [
            { id: 'nav-sidebar', label: 'Navigation Sidebar' },
            { id: 'three-panel', label: 'Layout' },
        ],
    },
    {
        id: 'home-dashboard', label: 'Home Dashboard', icon: <Home size={14} />,
        children: [
            { id: 'home-metrics', label: 'Homepage KPIs' },
            { id: 'home-flow', label: 'Flow Blueprint' },
            { id: 'home-activity', label: 'Activity & Attention' },
        ],
    },
    {
        id: 'insights', label: 'Insights & Analytics', icon: <BarChart2 size={14} />,
        children: [
            { id: 'insights-stages', label: 'Stage Distribution' },
            { id: 'insights-risk', label: 'Risk Analytics' },
            { id: 'insights-governance', label: 'Governance Queue' },
        ],
    },
    {
        id: 'end-to-end-workflow', label: 'Blueprint → Spark → Production', icon: <ArrowRight size={14} />,
        children: [
            { id: 'workflow-blueprint', label: 'Blueprint' },
            { id: 'workflow-spark', label: 'Spark' },
            { id: 'workflow-usecases', label: 'AI Use Cases' },
            { id: 'workflow-agents', label: 'Agents' },
            { id: 'workflow-roadmap', label: 'Roadmap' },
            { id: 'workflow-build', label: 'Build' },
            { id: 'workflow-deploy', label: 'Deploy' },
            { id: 'workflow-govern', label: 'Govern' },
        ],
    },
    {
        id: 'build-section', label: 'Build', icon: <FlaskConical size={14} />,
        children: [
            { id: 'build-playground', label: 'Agent Playground' },
            { id: 'build-evals', label: 'Agent Evals' },
        ],
    },
    {
        id: 'govern-section', label: 'Govern', icon: <ShieldCheck size={14} />,
        children: [
            { id: 'govern-risk', label: 'Risk Analysis' },
            { id: 'govern-compliance', label: 'Compliance & Audit' },
            { id: 'govern-guardrails', label: 'Guardrails' },
            { id: 'govern-issues', label: 'Issues' },
        ],
    },
    {
        id: 'settings-overview', label: 'Settings', icon: <Settings size={14} />,
        children: [
            { id: 'llm-setup', label: 'LLM Provider Setup' },
            { id: 'roadmap-settings', label: 'Roadmap Configuration' },
            { id: 'theme', label: 'Appearance & Dev Tools' },
        ],
    },
];

// ─── Main Component ───────────────────────────────────────────────────────────

const UserGuidePage: React.FC = () => {
    const [activeSection, setActiveSection] = useState('nav-overview');
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(TOC_SECTIONS.map(s => s.id)));
    const [searchQuery, setSearchQuery] = useState('');
    const contentRef = useRef<HTMLDivElement>(null);

    const allSectionIds = TOC_SECTIONS.flatMap(s => [s.id, ...(s.children?.map(c => c.id) ?? [])]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) setActiveSection(entry.target.id);
                });
            },
            { rootMargin: '-10% 0px -80% 0px', threshold: 0 }
        );
        const el = contentRef.current;
        if (!el) return;
        allSectionIds.forEach(id => {
            const node = el.querySelector(`#${id}`);
            if (node) observer.observe(node);
        });
        return () => observer.disconnect();
    }, []);

    const scrollTo = useCallback((id: string) => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, []);

    const toggleSection = useCallback((id: string) => {
        setExpandedSections(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
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
        <div className="flex h-full min-h-screen bg-white dark:bg-slate-950">
            {/* ── Left TOC ── */}
            <aside className="hidden lg:flex flex-col w-72 flex-shrink-0 border-r border-slate-100 dark:border-slate-800 sticky top-0 h-screen overflow-y-auto">
                <div className="p-5 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2.5 mb-4">
                        <div className="p-2 bg-blue-600 rounded-xl">
                            <BookOpen size={16} className="text-white" />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">User Guide</p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">Tavro Agent BizOps</p>
                        </div>
                    </div>
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search guide…"
                            className="w-full pl-8 pr-8 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/30 text-slate-700 dark:text-slate-300"
                        />
                        {searchQuery && (
                            <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                <X size={13} />
                            </button>
                        )}
                    </div>
                </div>
                <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
                    {filteredToc.map(section => (
                        <div key={section.id}>
                            <button
                                onClick={() => { scrollTo(section.id); if (section.children?.length) toggleSection(section.id); }}
                                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all ${activeSection === section.id ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-semibold' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'}`}
                            >
                                {section.icon && <span className="flex-shrink-0 opacity-70">{section.icon}</span>}
                                <span className="flex-1 text-left leading-tight">{section.label}</span>
                                {section.children?.length ? (
                                    expandedSections.has(section.id)
                                        ? <ChevronDown size={13} className="flex-shrink-0 opacity-50" />
                                        : <ChevronRight size={13} className="flex-shrink-0 opacity-50" />
                                ) : null}
                            </button>
                            {section.children && expandedSections.has(section.id) && (
                                <div className="ml-4 mt-0.5 space-y-0.5 pl-3 border-l border-slate-100 dark:border-slate-800">
                                    {section.children.map(child => (
                                        <button
                                            key={child.id}
                                            onClick={() => scrollTo(child.id)}
                                            className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-all ${activeSection === child.id ? 'text-blue-600 dark:text-blue-400 font-semibold bg-blue-50/60 dark:bg-blue-900/20' : 'text-slate-500 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
                                        >
                                            {child.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </nav>
            </aside>

            {/* ── Content ── */}
            <div ref={contentRef} className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto px-6 py-10 pb-24">

                    {/* Hero */}
                    <div className="relative mb-10 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 px-8 py-8 overflow-hidden">
                        <div className="absolute top-6 right-6 opacity-20">
                            <BookOpen size={52} className="text-white" />
                        </div>
                        <div className="flex items-center gap-2 mb-4">
                            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-white/20 text-white">v3.1</span>
                            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-white/20 text-white">User Guide</span>
                        </div>
                        <h1 className="text-2xl font-extrabold text-white mb-2 leading-tight">
                            Tavro Agent BizOps
                        </h1>
                        <p className="text-sm text-blue-100 leading-relaxed max-w-xl">
                            Your step-by-step guide to navigating the portal — from discovering AI use cases and building your agent roster, to mapping your organization's digital twin and running compliance audits.
                        </p>
                    </div>

                    {/* ── Navigation ── */}
                    <SectionHeading id="nav-overview" level={2} icon={<Layers size={18} />}>Portal Navigation</SectionHeading>

                    {/* Three-panel layout cards */}
                    <div id="three-panel" className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-5">
                        {[
                            { title: 'Left Sidebar', body: 'Primary navigation — links to every module. Collapse it using the chevron button on its right edge to gain more space. Collapsed icons show tooltips on hover.' },
                            { title: 'Main Content', body: 'Where all page content renders — use case lists, agent details, blueprint graphs, audit results. Scrolls independently of both sidebars.' },
                            { title: 'Right Panel', body: 'Contextual workspace — AI Chat, Dev Logs, and Attachments. Stays open while you work. Resize by dragging the left edge of the panel.' },
                        ].map(card => (
                            <div key={card.title} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4">
                                <p className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1.5">{card.title}</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{card.body}</p>
                            </div>
                        ))}
                    </div>

                    <SectionHeading id="nav-sidebar" level={3}>Navigation Sidebar</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                        Every module is one click away from the left sidebar. Here's what each entry does:
                    </p>

                    {(() => {
                        const NavItem = ({ icon, name, route, desc, enterprise }: { icon: React.ReactNode; name: string; route: string; desc: string; enterprise?: boolean }) => (
                            <div className="flex items-start gap-3 p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-200 dark:hover:border-slate-700 transition-colors">
                                <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 mt-0.5">
                                    {icon}
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{name}</span>
                                        <span className="text-xs text-blue-500 dark:text-blue-400 font-mono">{route}</span>
                                        {enterprise && <Badge color="violet">Enterprise</Badge>}
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">{desc}</p>
                                </div>
                            </div>
                        );
                        const GroupLabel = ({ label }: { label: string }) => (
                            <div className="col-span-2 mt-4 mb-1 flex items-center gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">{label}</span>
                                <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
                            </div>
                        );
                        return (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-4">
                                {/* Standalone */}
                                <NavItem icon={<Home size={16} />} name="Home" route="/" desc="Landing dashboard with KPIs, flow blueprint, and recent activity" />
                                <NavItem icon={<BarChart2 size={16} />} name="Insights" route="/insights" desc="Cross-portfolio risk and coverage analytics" />

                                {/* Blueprint */}
                                <GroupLabel label="Blueprint" />
                                <NavItem icon={<Network size={16} />} name="Company Profile" route="/blueprint" desc="Define your organization's context, dimensions, and relationships" />
                                <NavItem icon={<AppWindow size={16} />} name="Applications" route="/applications" desc="Software systems your agents interact with" />
                                <NavItem icon={<Workflow size={16} />} name="Processes" route="/processes" desc="Business workflows and their AI exposure" />
                                <NavItem icon={<Plug size={16} />} name="Integrations" route="/integrations" desc="APIs and connectors used by agents" />
                                <NavItem icon={<Boxes size={16} />} name="AI Models" route="/ai-models" desc="AI models registered for use across agents" />
                                <NavItem icon={<Map size={16} />} name="Roadmap" route="/roadmap" desc="Priority × Risk matrix for AI adoption planning" enterprise />
                                <NavItem icon={<Zap size={16} />} name="Spark" route="/spark" desc="AI-generated use case ideas from your business context" />

                                {/* Plan */}
                                <GroupLabel label="Plan" />
                                <NavItem icon={<ClipboardList size={16} />} name="AI Use Cases" route="/use-cases" desc="All AI initiatives — create, browse, link to agents & processes" />
                                <NavItem icon={<Bot size={16} />} name="Agents" route="/catalog" desc="Full agent catalog with risk scores and governance status" />

                                {/* Build */}
                                <GroupLabel label="Build" />
                                <NavItem icon={<FlaskConical size={16} />} name="Agent Playground" route="/playground" desc="Prototype and test agents before committing to the catalog" />
                                <NavItem icon={<TestTube2 size={16} />} name="Agent Evals" route="/agent-evals" desc="Automated evaluation suites for agent quality" enterprise />

                                {/* Govern */}
                                <GroupLabel label="Govern" />
                                <NavItem icon={<Shield size={16} />} name="Guardrails" route="/guardrails" desc="Define behavioral constraints enforced at runtime" enterprise />
                                <NavItem icon={<ShieldCheck size={16} />} name="Compliance" route="/compliance" desc="Regulations and internal policies with gap tracking" enterprise />
                                <NavItem icon={<Scale size={16} />} name="Audit Center" route="/audit" desc="AI-powered compliance audits with live streaming results" />
                                <NavItem icon={<Activity size={16} />} name="Issues" route="/issues" desc="Track and resolve governance issues raised from audits or risk" enterprise />
                            </div>
                        );
                    })()}

                    {/* ── Home Dashboard ── */}
                    <SectionHeading id="home-dashboard" level={2} icon={<Home size={18} />}>Home Dashboard</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                        The Home page is your operational command center. It gives an at-a-glance view of your AI portfolio health, the adoption flow, recent activity, and items that need your attention — all scoped to your active company.
                    </p>

                    <ScreenshotFrame title="Home Dashboard" src="/assets/images/Home.png" alt="Tavro Home Dashboard" />

                    <Callout type="tip" title="Active Company">
                        All data on the Home page is scoped to the active company. To switch companies, go to <strong>Blueprint → Company Profile</strong> and select a different company from the company switcher. Each company has its own Blueprint catalog, Use Cases, Agents, and governance data.
                    </Callout>

                    <SectionHeading id="home-metrics" level={3}>Homepage KPIs</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                        The top row shows four key portfolio metrics at a glance:
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4">
                        {[
                            { label: 'Spark Ideas', desc: 'Total AI ideas generated from your blueprint' },
                            { label: 'AI Use Cases', desc: 'Use cases across all lifecycle stages' },
                            { label: 'Active Agents', desc: 'Agents currently in an Active status' },
                            { label: 'Open Issues', desc: 'Unresolved governance issues requiring action' },
                        ].map(kpi => (
                            <div key={kpi.label} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
                                <p className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">{kpi.label}</p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{kpi.desc}</p>
                            </div>
                        ))}
                    </div>

                    <SectionHeading id="home-flow" level={3}>Flow Blueprint</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                        Below the KPIs, the Flow Blueprint shows your AI adoption pipeline as a five-stage funnel. Each stage links directly to its corresponding section:
                    </p>
                    <FlowDiagram steps={[
                        { icon: <Network size={15} />, label: 'Blueprint', color: 'bg-violet-50 dark:bg-violet-900/30 border-violet-200 dark:border-violet-700 text-violet-700 dark:text-violet-300' },
                        { icon: <Zap size={15} />, label: 'Spark', color: 'bg-violet-50 dark:bg-violet-900/30 border-violet-200 dark:border-violet-700 text-violet-700 dark:text-violet-300' },
                        { icon: <ClipboardList size={15} />, label: 'Plan', color: 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300' },
                        { icon: <FlaskConical size={15} />, label: 'Build', color: 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300' },
                        { icon: <Play size={15} />, label: 'Deploy', color: 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300' },
                        { icon: <ShieldCheck size={15} />, label: 'Govern', color: 'bg-rose-50 dark:bg-rose-900/30 border-rose-200 dark:border-rose-700 text-rose-700 dark:text-rose-300' },
                    ]} />
                    <ul className="mt-2 space-y-1.5 text-sm text-slate-600 dark:text-slate-400 list-disc list-inside">
                        <li><strong>Blueprint</strong> — Map your company's applications, processes, integrations, and AI models</li>
                        <li><strong>Spark</strong> — Generate AI use case ideas from your company blueprint</li>
                        <li><strong>Plan</strong> — Formalize ideas into AI Use Cases and create Agents</li>
                        <li><strong>Build</strong> — Test and iterate on agents in the Playground</li>
                        <li><strong>Deploy</strong> — Move agents into production with your infrastructure</li>
                        <li><strong>Govern</strong> — Monitor risk, run compliance audits, and manage issues</li>
                    </ul>

                    <SectionHeading id="home-activity" level={3}>Recent Activity &amp; Needs Your Attention</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                        The bottom row of the dashboard has two panels side by side:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-4">
                        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4">
                            <p className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-2">Recent Activity</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                                A chronological feed of platform events — new agents created, Spark ideas generated, risk assessments completed, playground sessions run, and compliance audit results.
                            </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4">
                            <p className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-2">Needs Your Attention</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                                Items that require action — agents with pending risk assessments, open governance issues, use cases awaiting review, and agents without a linked use case.
                            </p>
                        </div>
                    </div>

                    {/* ── Insights ── */}
                    <SectionHeading id="insights" level={2} icon={<BarChart2 size={18} />}>Insights & Analytics</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                        The Insights page provides a cross-portfolio analytical view of your AI use case pipeline, risk distribution, and governance queue. All charts and tables update in real time as your portfolio grows.
                    </p>
                    <ScreenshotFrame title="Insights & Analytics" src="/assets/images/Insights.png" alt="Tavro Insights dashboard" />

                    <SectionHeading id="insights-stages" level={3}>Portfolio KPIs</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                        The top strip gives you an instant health check of your entire AI portfolio at a glance:
                    </p>
                    <div className="grid grid-cols-1 gap-2 mb-3">
                        {[
                            { label: 'Agents', desc: 'Total agents registered across all lifecycle stages' },
                            { label: 'Use Cases', desc: 'Total AI use cases tracked from idea to live', color: 'blue' as const },
                            { label: 'Critical', desc: 'Agents with a Critical blended risk score requiring immediate action', color: 'red' as const },
                            { label: 'High Risk', desc: 'Agents rated High risk — should be reviewed before deployment', color: 'amber' as const },
                            { label: 'HITL Open', desc: 'Human-in-the-loop items open and awaiting review', color: 'violet' as const },
                            { label: 'Company Profile %', desc: 'How complete your Blueprint company profile is — higher completion improves AI recommendations', color: 'green' as const },
                        ].map(({ label, desc, color }) => (
                            <div key={label} className="flex items-start gap-2.5 text-sm">
                                <Badge color={color ?? 'slate'}>{label}</Badge>
                                <span className="text-slate-500 dark:text-slate-400 pt-0.5">{desc}</span>
                            </div>
                        ))}
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                        Click <UIButton color="slate">Refresh</UIButton> at any time to pull the latest data without reloading the page.
                    </p>

                    <SectionHeading id="insights-risk" level={3}>Lifecycle Distribution</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                        Two side-by-side panels show how your portfolio is distributed across each lifecycle stage:
                    </p>
                    <div className="space-y-3 mb-3">
                        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 text-sm">
                            <p className="font-semibold text-slate-800 dark:text-slate-200 mb-1.5">Agent Lifecycle Distribution</p>
                            <p className="text-slate-500 dark:text-slate-400 mb-2">Shows your agent portfolio across all 5 lifecycle stages:</p>
                            <div className="flex flex-wrap gap-2">
                                {['Plan', 'Design', 'Develop', 'Deploy', 'Monitor'].map(s => <Badge key={s} color="slate">{s}</Badge>)}
                            </div>
                        </div>
                        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 text-sm">
                            <p className="font-semibold text-slate-800 dark:text-slate-200 mb-1.5">Use Case Lifecycle Distribution</p>
                            <p className="text-slate-500 dark:text-slate-400 mb-2">Tracks AI use cases from idea to live across 5 stages:</p>
                            <div className="flex flex-wrap gap-2">
                                {['Identified', 'Scoped', 'Approved', 'In Build', 'Live'].map(s => <Badge key={s} color="blue">{s}</Badge>)}
                            </div>
                        </div>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                        Each stage shows a count so you can immediately see where your portfolio is concentrated — for example, a large number in <Badge color="slate">Deploy</Badge> with few in <Badge color="slate">Monitor</Badge> flags gaps in active governance coverage.
                    </p>

                    <SectionHeading id="insights-governance" level={3}>Risk &amp; Provider Breakdown</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                        Two panels in the lower half give you a provider and risk view of your agent catalog:
                    </p>
                    <div className="space-y-3">
                        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 text-sm">
                            <p className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Agents by Provider</p>
                            <p className="text-slate-500 dark:text-slate-400">Shows how your agents are distributed across LLM providers (e.g. Google, Azure, ServiceNow). Use this to understand provider dependency concentration and plan diversification.</p>
                        </div>
                        <div className="rounded-xl border border-red-100 dark:border-red-900/40 p-3.5 text-sm">
                            <p className="font-semibold text-slate-800 dark:text-slate-200 mb-1.5">Agents by Blended Risk Classification</p>
                            <p className="text-slate-500 dark:text-slate-400 mb-2">Breaks down your agent catalog by blended risk level:</p>
                            <div className="flex flex-wrap gap-2">
                                <Badge color="red">Critical</Badge>
                                <Badge color="red">High</Badge>
                                <Badge color="amber">Medium</Badge>
                                <Badge color="green">Low</Badge>
                            </div>
                            <p className="text-slate-500 dark:text-slate-400 mt-2">A healthy portfolio should have zero Critical agents and a small High count. Use this panel to prioritize which agents need a risk assessment run before advancing to Deploy.</p>
                        </div>
                    </div>

                    {/* ── Blueprint → Spark → Production ── */}
                    <SectionHeading id="end-to-end-workflow" level={2} icon={<ArrowRight size={18} />}>Blueprint → Spark → Production</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                        Tavro is designed around a structured journey — from building your organizational foundation to governing deployed AI agents. Each stage builds on the previous one, so working through them in order gives you the richest, most grounded experience.
                    </p>
                    <FlowDiagram steps={[
                        { icon: <Network size={15} />, label: 'Blueprint', color: 'bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300' },
                        { icon: <Zap size={15} />, label: 'Spark', color: 'bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300' },
                        { icon: <ClipboardList size={15} />, label: 'Plan', color: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300' },
                        { icon: <FlaskConical size={15} />, label: 'Build', color: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300' },
                        { icon: <Play size={15} />, label: 'Deploy', color: 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300' },
                        { icon: <ShieldCheck size={15} />, label: 'Govern', color: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300' },
                    ]} />
                    <div className="mt-4 grid grid-cols-1 gap-2">
                        {[
                            { icon: <Network size={14} />, stage: 'Blueprint', color: 'text-violet-700 dark:text-violet-300', desc: 'Map your company\'s applications, processes, integrations, and AI models' },
                            { icon: <Zap size={14} />, stage: 'Spark', color: 'text-violet-700 dark:text-violet-300', desc: 'Generate AI use case ideas from your company blueprint' },
                            { icon: <ClipboardList size={14} />, stage: 'Plan', color: 'text-blue-700 dark:text-blue-300', desc: 'Formalize ideas into AI Use Cases and create Agents' },
                            { icon: <FlaskConical size={14} />, stage: 'Build', color: 'text-emerald-700 dark:text-emerald-300', desc: 'Test and iterate on agents in the Playground' },
                            { icon: <Play size={14} />, stage: 'Deploy', color: 'text-slate-700 dark:text-slate-300', desc: 'Move agents into production with your infrastructure' },
                            { icon: <ShieldCheck size={14} />, stage: 'Govern', color: 'text-rose-700 dark:text-rose-300', desc: 'Monitor risk, run compliance audits, and manage issues' },
                        ].map(({ icon, stage, color, desc }) => (
                            <div key={stage} className="flex items-start gap-2.5 text-sm">
                                <span className={`mt-0.5 flex-shrink-0 ${color}`}>{icon}</span>
                                <span><strong className={color}>{stage}</strong><span className="text-slate-500 dark:text-slate-400"> — {desc}</span></span>
                            </div>
                        ))}
                    </div>

                    {/* ── Stage 1: Blueprint ── */}
                    <div id="workflow-blueprint" className="scroll-mt-6" />
                    <Step n={1} title="Blueprint — Set Up Your Company Foundation">
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            Everything in Tavro starts with the Blueprint. Navigate to <strong>Blueprint</strong> in the sidebar and begin with <strong>Company Profile</strong> — fill in your organization's name, industry, size, and a description of what the business does. This profile is what the AI engine reads when generating Spark ideas, so the more complete it is, the more relevant the suggestions will be.
                        </p>
                        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-gradient-to-br from-slate-50 to-violet-50/40 dark:from-slate-900 dark:to-violet-950/20 p-5 mt-3 mb-1">
                            <p className="text-xs font-semibold uppercase tracking-widest text-violet-500 dark:text-violet-400 mb-3">Company Blueprint</p>
                            <div className="grid grid-cols-2 gap-3">
                                {[
                                    { icon: <Building2 size={15} className="text-violet-500" />, title: 'Company Profile', desc: 'Your organization\'s name, industry, size, and business description. This is what the AI engine reads when generating Spark ideas — the more complete it is, the more relevant the suggestions.' },
                                    { icon: <Globe size={15} className="text-blue-500" />, title: 'Graph View', desc: 'A relationship graph showing how your profile, financials, strategy, risks, processes, integrations, and applications connect — giving the AI a 360° picture of your organization.' },
                                    { icon: <Layers size={15} className="text-amber-500" />, title: 'Dimensions', desc: 'Each dimension (Profile, Strategy, Organisation, Processes, Applications, Integrations, Risks, Financials) expands to reveal the data points that ground downstream AI decisions.' },
                                    { icon: <Network size={15} className="text-emerald-500" />, title: 'Relationships', desc: 'Add relationships between dimensions to capture dependencies — e.g. linking a Risk to a Process or an Application to an Integration.' },
                                ].map(({ icon, title, desc }) => (
                                    <div key={title} className="flex gap-3 rounded-xl bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-3">
                                        <span className="flex-shrink-0 mt-0.5">{icon}</span>
                                        <div>
                                            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-0.5">{title}</p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{desc}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mt-3">
                            Once the profile is saved, populate your catalog across four sections: <strong>Applications</strong>, <strong>Processes</strong>, <strong>Integrations</strong>, and <strong>AI Models</strong>. A complete catalog is the grounding that makes every downstream stage — Spark ideas, Use Case risk scoring, Agent context graphs — accurate and meaningful.
                        </p>

                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-5 mb-1">Applications</p>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            Applications are every software system your organization uses — ERP, CRM, ITSM, custom platforms, and SaaS tools. For each application, capture its name, description, business owner, criticality level, and lifecycle stage. Applications form the backbone of the blueprint: agents are linked to applications to establish where they operate, and Spark uses your application list to generate context-relevant AI ideas.
                        </p>
                        <ScreenshotFrame title="Blueprint — Applications (List View)" src="/assets/images/Applications.png" alt="Applications catalog list view" />
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mt-2">
                            Use the <strong>Load Applications</strong> button to upload a CSV file containing your application catalog — no manual entry required for large catalogs. Prepare your CSV with columns for name, description, owner, and criticality, then upload to bulk-import all records at once.
                        </p>
                        <ScreenshotFrame title="Blueprint — Applications (Load via CSV)" src="/assets/images/ApplicationLoad.png" alt="Applications load via CSV" />

                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-5 mb-1">Processes</p>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            Processes are the business workflows your organization runs — procurement, employee onboarding, incident management, invoice processing, and so on. Link each process to the applications that support it. This linkage is critical: when you later build an agent, connecting it to both an Application and a Process tells Tavro precisely where in your organization the agent will operate, enabling accurate risk scoring and more relevant Spark ideas.
                        </p>
                        <ScreenshotFrame title="Blueprint — Processes (List View)" src="/assets/images/Processes.png" alt="Processes catalog list view" />
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mt-2">
                            Use the <strong>Load Processes</strong> button to upload a CSV file containing your process catalog. Prepare your CSV with columns for name, description, owner, and criticality, then upload to bulk-import all records without manual entry.
                        </p>
                        <ScreenshotFrame title="Blueprint — Processes (Load via CSV)" src="/assets/images/LoadProcesses.png" alt="Processes load via CSV" />

                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-5 mb-1">Integrations</p>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            Integrations catalog the connections between your systems — APIs, data feeds, middleware, and event streams. For each integration, record the two systems it connects, the direction of data flow, the integration type, and its current status (Active, Planned, or Deprecated). Agents use the Integrations catalog to understand data flows across your landscape, which informs both the Context Graph and lineage mapping. The ServiceNow integration itself is also listed here — it is the connection that powers CMDB imports for Applications and Processes.
                        </p>
                        <ScreenshotFrame title="Blueprint — Integrations (List View)" src="/assets/images/Integrations.png" alt="Integrations catalog list view" />
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mt-2">
                            Use the <strong>New Integration</strong> button to register a connector manually, or use the <strong>Load Integrations</strong> option to import existing integration records from your connected systems.
                        </p>
                        <ScreenshotFrame title="Blueprint — Integrations (Load Option)" src="/assets/images/IntegrationsLoad.png" alt="Integrations load option" />

                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-5 mb-1">AI Models</p>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            AI Models registers every large language model or machine learning model your organization uses or plans to use — GPT-4o, Claude, Gemini, Azure OpenAI deployments, fine-tuned models, or internal ML models. For each model, record the provider, version, purpose, owner, and status (Active, Under Evaluation, or Deprecated). Registering AI Models gives you end-to-end traceability: a Use Case can be linked to the models it relies on, and every agent inherits those links, so you always know which AI capabilities are in use across your organization and who is accountable for them.
                        </p>
                        <ScreenshotFrame title="Blueprint — AI Models (List View)" src="/assets/images/AIModels.png" alt="AI Models catalog list view" />
                    </Step>

                    {/* ── Stage 2: Spark ── */}
                    <div id="workflow-spark" className="scroll-mt-6" />
                    <Step n={2} title="Spark — Generate AI Ideas and Convert to Use Cases">
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            With your Blueprint in place, navigate to <strong>Spark → Ideas</strong>. Click <strong>Inspire Me</strong> — Tavro reads your company profile and catalog and generates a personalized list of AI automation and augmentation opportunities specific to your organization.
                        </p>
                        <ScreenshotFrame title="Spark — Ideas" src="/assets/images/Spark Ideas.png" alt="Spark Ideas page" />
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mt-3">
                            React to each idea with <strong>Like</strong> or <strong>Dislike</strong> to signal interest, and use the filters to narrow by category. When an idea is worth acting on, click <strong>Convert to Use Case</strong> — a new AI Use Case is created pre-populated with the idea's title and description, and takes you directly to the Use Case detail page.
                        </p>
                        <ScreenshotFrame title="Spark — Convert to Use Case" src="/assets/images/Convert to Use Case.png" alt="Convert idea to use case" />
                    </Step>

                    {/* ── Stage 3: AI Use Cases ── */}
                    <div id="workflow-usecases" className="scroll-mt-6" />
                    <Step n={3} title="AI Use Cases — Create, Detail, Risk Assessment & Prioritization">
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            AI Use Cases are the bridge between Spark ideas and deployed agents. Navigate to <strong>Plan → AI Use Cases</strong> to see the full catalog. There are two ways to create a use case — through the UI form, or by asking the AI Assistant to draft one for you.
                        </p>
                        <ScreenshotFrame title="Plan — AI Use Cases" src="/assets/images/AI Use Cases.png" alt="AI Use Cases list" />

                        {/* Path 1 */}
                        <div className="mt-5 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 px-4 pt-3 pb-4">
                            <p className="text-sm font-bold text-blue-700 dark:text-blue-300 mb-3">Path 1 — Creating a Use Case via the UI</p>
                            <div className="flex items-center gap-1.5 flex-wrap text-xs font-medium text-blue-600 dark:text-blue-400 mb-4">
                                {['AI Use Cases', '+ New Use Case', 'Fill Details', 'Link Entities', 'Save'].map((s, i, arr) => (
                                    <span key={s} className="flex items-center gap-1.5">
                                        <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 border border-blue-200 dark:border-blue-700">{s}</span>
                                        {i < arr.length - 1 && <ArrowRight size={11} className="text-blue-400" />}
                                    </span>
                                ))}
                            </div>

                            <Step n={1} title="Navigate to AI Use Cases">
                                Click <strong>AI Use Cases</strong> in the left sidebar. You'll see a grid of all existing initiatives with their status and priority badges.
                            </Step>
                            <Step n={2} title="Open the creation form">
                                Click the <UIButton color="blue" icon={<Plus size={11}/>}>New Use Case</UIButton> button in the top-right of the page.
                            </Step>
                            <Step n={3} title="Fill in the required fields">
                                <div className="overflow-x-auto mt-2">
                                    <table className="w-full text-xs border-collapse">
                                        <thead>
                                            <tr className="bg-slate-100 dark:bg-slate-800">
                                                <th className="border border-slate-200 dark:border-slate-700 px-3 py-2 text-left font-bold text-slate-700 dark:text-slate-300 w-1/4">Field</th>
                                                <th className="border border-slate-200 dark:border-slate-700 px-3 py-2 text-left font-bold text-slate-700 dark:text-slate-300">What to enter</th>
                                            </tr>
                                        </thead>
                                        <tbody className="text-slate-600 dark:text-slate-400">
                                            <tr><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5 font-semibold">Title</td><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5">e.g. "AI-Powered Customer Support Chatbot"</td></tr>
                                            <tr><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5 font-semibold">Problem Statement</td><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5">Describe the business problem — e.g. "Customer support teams face high volumes of repetitive queries, leading to long response times and increased costs."</td></tr>
                                            <tr><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5 font-semibold">Expected Benefits</td><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5">e.g. "Instant replies, lower operational costs, 24/7 availability, frees human agents for complex interactions."</td></tr>
                                            <tr><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5 font-semibold">Priority</td><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5">Low / Medium / High / Critical — drives ordering in the catalog and feeds the Roadmap</td></tr>
                                            <tr><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5 font-semibold">Status</td><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5"><Badge color="slate">Proposed</Badge> for new ideas · <Badge color="amber">In Review</Badge> while under evaluation · <Badge color="green">Active</Badge> once approved</td></tr>
                                            <tr><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5 font-semibold">Function</td><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5">Business function this initiative belongs to, e.g. Customer Operations / Support</td></tr>
                                        </tbody>
                                    </table>
                                </div>
                            </Step>
                            <Step n={4} title="Link Blueprint entities">
                                In the <strong>Linked Entities</strong> section, connect the use case to the relevant Applications, Processes, Integrations, and AI Models from your Blueprint. These links establish full traceability and are inherited by every agent created under this use case.
                            </Step>
                            <Step n={5} title="Save and open the detail view">
                                Click <strong>Save</strong>. You'll land on the Use Case detail page where you can run Risk Assessment, set Prioritization scores, and link agents.
                            </Step>
                        </div>

                        {/* Path 2 */}
                        <div className="mt-4 rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20 px-4 pt-3 pb-4">
                            <p className="text-sm font-bold text-violet-700 dark:text-violet-300 mb-3">Path 2 — Creating a Use Case via the AI Assistant</p>
                            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                                The AI Assistant can draft a complete use case for you. Click the <strong>Chat</strong> button in the right rail (the icon column on the far right of the page) — the panel will expand with the AI Assistant tab active.
                            </p>
                            <Step n={1} title="Open the AI Assistant">
                                Click the <strong>Chat</strong> icon in the right rail. The panel expands with the AI Assistant tab active. The assistant is context-aware — it knows which page you are on and what data is loaded in your blueprint.
                            </Step>
                            <Step n={2} title="Send a creation prompt">
                                Pass a prompt describing the use case you want to create. For example:
                                <div className="mt-2 space-y-1.5">
                                    {[
                                        'Generate a detailed AI Use Case for a supply chain organization to optimize its order management process.',
                                        'Create a high-priority AI Use Case for automating invoice processing in a finance team.',
                                        'Draft an AI Use Case for a retail company to improve customer churn prediction.',
                                    ].map(p => (
                                        <div key={p} className="flex items-start gap-2 text-xs bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2 text-slate-600 dark:text-slate-400">
                                            <MessageCircle size={12} className="mt-0.5 flex-shrink-0 text-violet-500" />
                                            <span className="italic">"{p}"</span>
                                        </div>
                                    ))}
                                </div>
                            </Step>
                            <Step n={3} title="Review and save">
                                The assistant returns a fully structured use case — title, problem statement, expected benefits, suggested priority, and linked Blueprint entities. Review the content, make any edits, and click <strong>Save to Use Cases</strong> to add it to your catalog.
                            </Step>
                            <Callout type="tip" title="Discovery Prompts">
                                The AI Assistant is also useful for gap analysis. Try: <em>"Which use cases are highest priority?"</em>, <em>"We have an agent for invoice processing — what related use cases are we missing?"</em>, or <em>"Suggest 3 high-priority AI initiatives for a mid-size manufacturing company."</em>
                            </Callout>
                        </div>

                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-5 mb-1">Use Case Detail — Overview</p>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            The <strong>Overview</strong> tab on the Use Case detail page shows the full specification — title, problem statement, expected benefits, status, priority, function, and all linked Blueprint entities. Edit any field here at any time as the initiative evolves.
                        </p>
                        <ScreenshotFrame title="Use Case — Overview" src="/assets/images/UseCaseDetail.png" alt="Use Case overview tab" />

                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-4 mb-1">Use Case Detail — Risk Assessment</p>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            The <strong>Risk Assessment</strong> tab scores the use case itself — independent of any specific agent. Tavro evaluates inherent risk based on scope, data touched, and processes automated across three dimensions: <em>Blended</em> (overall), <em>AIVSS</em> (AI-specific vulnerability), and <em>Regulatory</em> (framework exposure). Run this before creating agents — a high-risk use case warrants more thorough Evals and stricter Guardrails downstream.
                        </p>
                        <ScreenshotFrame title="Use Case — Risk Assessment" src="/assets/images/UseCaseRisk.png" alt="Use Case risk assessment tab" />

                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-4 mb-1">Use Case Detail — Prioritization</p>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            The <strong>Prioritization</strong> tab scores the use case on business value, feasibility, strategic alignment, and urgency. The resulting priority score surfaces which use cases to progress first. Scores feed directly into the Roadmap so your strategic view is always grounded in real data. Adjust scores manually if stakeholder input changes the weighting.
                        </p>
                        <ScreenshotFrame title="Use Case — Prioritization" src="/assets/images/UseCasePriority.png" alt="Use Case prioritization tab" />
                    </Step>

                    {/* ── Stage 4: Agents ── */}
                    <div id="workflow-agents" className="scroll-mt-6" />
                    <Step n={4} title="Agents — Link to Use Case and Explore the Context Graph">
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            Once a use case exists, the next step is to populate it with agents.
                        </p>

                        <FlowDiagram steps={[
                            { icon: <ClipboardList size={14} />, label: 'Use Case', color: 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300' },
                            { icon: <Link2 size={14} />, label: 'Link Agents', color: 'bg-violet-50 border-violet-200 text-violet-700 dark:bg-violet-900/30 dark:border-violet-700 dark:text-violet-300' },
                            { icon: <Bot size={14} />, label: 'Agent Detail', color: 'bg-slate-50 border-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300' },
                        ]} />

                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-4 mb-2">Linking Agents to a Use Case</p>

                        <Step n={1} title="Open the Use Case">
                            From <strong>AI Use Cases</strong>, click any use case to open its detail page. You'll see two relationship sections: <em>Currently Related Agents</em> and <em>Business Impact Currently Related Processes</em>.
                        </Step>

                        <Step n={2} title="Find an agent to link">
                            Under <strong>Add Agent Relation</strong>, use the <InlineCode>Filter agents...</InlineCode> search box to find an agent by name.
                        </Step>

                        <Step n={3} title="Link the agent">
                            Click the <UIButton color="blue" icon={<Link2 size={11}/>}>Link</UIButton> button next to the agent. It moves immediately into the <em>Currently Related Agents</em> section above.
                        </Step>

                        <Step n={4} title="Link related processes">
                            Repeat for the <strong>Add Process Relation</strong> section. Use <UIButton color="blue" icon={<Plus size={11}/>}>Create Process</UIButton> if the process doesn't exist yet — it opens the process form with the use case pre-filled.
                        </Step>

                        <Callout type="info" title="Unlinking">
                            To remove a relationship, click the <UIButton color="red" icon={<Link2 size={11}/>}>Remove</UIButton> button next to the agent or process. The change is immediate.
                        </Callout>

                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-5 mb-1">Exploring Agent Detail</p>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            Click any agent to open its detail page. The header shows the agent name, status, and quick-action buttons — <strong>Playground</strong>, <strong>Risk Assessment</strong>, Agent Card export, and <strong>Edit</strong>.
                        </p>
                        <ScreenshotFrame title="Agent Detail Page" src="/assets/images/Agent Detail Page.png" alt="Agent detail page" />

                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-5 mb-1">Context Graph</p>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            The <strong>Context Graph</strong> tab renders an interactive network diagram showing every Blueprint entity connected to this agent. Nodes represent the agent itself, its parent Use Case, the Applications it is linked to, the Processes it supports, any connected Integrations, and the AI Models it uses. Edges show the type of relationship between each node. Click any node to navigate directly to that entity's detail page. Use this graph to confirm the agent's organizational context is complete before moving to Build — a well-connected agent produces more meaningful risk scores and compliance findings.
                        </p>
                        <ScreenshotFrame title="Agent Detail — Context Graph" src="/assets/images/Agent Context Graph.png" alt="Agent context graph" />

                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mt-3 mb-2">
                            The graph organizes the agent's connections into four lenses:
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            {[
                                { title: 'Technical', desc: 'Tools the agent uses, its reasoning model, autonomy level, memory type, access scope', color: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40', titleColor: 'text-blue-700 dark:text-blue-300' },
                                { title: 'Functional', desc: 'Data sources — tables and columns the agent reads from or writes to', color: 'border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/40', titleColor: 'text-violet-700 dark:text-violet-300' },
                                { title: 'Business', desc: 'Connected applications, business processes, and AI use cases', color: 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40', titleColor: 'text-amber-700 dark:text-amber-300' },
                                { title: 'Risk', desc: 'Blended Risk score, AIVSS score, Regulatory Risk classification', color: 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40', titleColor: 'text-red-700 dark:text-red-300' },
                            ].map(({ title, desc, color, titleColor }) => (
                                <div key={title} className={`rounded-xl border p-3 text-sm ${color}`}>
                                    <p className={`font-semibold mb-1 ${titleColor}`}>{title}</p>
                                    <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed">{desc}</p>
                                </div>
                            ))}
                        </div>
                    </Step>

                    {/* ── Stage 5: Roadmap ── */}
                    <div id="workflow-roadmap" className="scroll-mt-6" />
                    <Step n={5} title="Roadmap — Your Strategic AI Portfolio View">
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            Once use cases have Risk Assessment and Prioritization scores, the <strong>Roadmap</strong> becomes meaningful. Navigate to <strong>Blueprint → Roadmap</strong> to see your entire AI use case portfolio plotted on a <strong>Priority × Risk</strong> matrix.
                        </p>
                        <ScreenshotFrame title="Roadmap — Priority × Risk Matrix" src="/assets/images/Roadmap.png" alt="Roadmap strategic view" />
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mt-3">
                            Each use case card is positioned based on its computed scores. The four quadrants guide your next actions:
                        </p>
                        <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-400 list-disc list-inside mt-2">
                            <li><strong>Quick Wins</strong> (High Priority, Low Risk) — start here, highest return for least governance effort</li>
                            <li><strong>Major Bets</strong> (High Priority, High Risk) — strategic initiatives requiring mitigation planning before build</li>
                            <li><strong>Fill-ins</strong> (Low Priority, Low Risk) — progress when capacity allows</li>
                            <li><strong>Reconsider</strong> (Low Priority, High Risk) — revisit scope or deprioritize entirely</li>
                        </ul>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mt-3">
                            Priority and Risk scoring weights are fully configurable under <strong>Settings → Roadmap Configuration</strong> to reflect your organization's strategic priorities.
                        </p>
                    </Step>

                    {/* ── Stage 6: Build ── */}
                    <div id="workflow-build" className="scroll-mt-6" />
                    <Step n={6} title="Build — Test and Iterate in the Playground">
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            Before deploying an agent, test it thoroughly in the <strong>Build</strong> stage. From any Agent Detail page, click <strong>Playground</strong> to open the interactive testing environment.
                        </p>

                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-4 mb-1">Agent Playground</p>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            The Playground gives you a live chat interface backed by the agent's actual configuration. Set the LLM provider, model, system prompt, temperature, and token limits in the left panel. Send a message to run a test session. Switch to the <strong>Observations</strong> tab to see every tool call, reasoning step, and intermediate output the agent produces. After the session ends, the <strong>Session Summary</strong> gives a structured recap of what happened.
                        </p>
                        <ScreenshotFrame title="Build — Agent Playground" src="/assets/images/Agent Playground.png" alt="Agent Playground" />

                        <div className="mt-4 flex items-center gap-2">
                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Agent Evals</p>
                            <Badge color="violet">Coming Soon</Badge>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
                            Structured, repeatable evaluation suites for measuring agent quality — coming in a future release.
                        </p>
                    </Step>

                    {/* ── Stage 7: Deploy ── */}
                    <div id="workflow-deploy" className="scroll-mt-6" />
                    <Step n={7} title="Deploy — Move Validated Agents to Production">
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            Once an agent passes Playground testing and Evals, advance its stage to <strong>Deploy</strong>. Confirm the production LLM provider and model — this may differ from testing if cost or latency requirements are different in production.
                        </p>

                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-4 mb-1">Export Agent Card</p>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            Click <strong>Export Agent Card</strong> to generate a portable specification document — model, system prompt, tool definitions, linked applications and processes, and governance metadata. Hand this to your engineering team for integration into existing orchestration layers, API gateways, or workflow automation tools.
                        </p>
                    </Step>

                    {/* ── Stage 8: Govern ── */}
                    <div id="workflow-govern" className="scroll-mt-6" />
                    <Step n={8} title="Govern — Monitor Risk, Compliance, and Issues">
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            Governance is an ongoing responsibility for every deployed agent. Navigate to <strong>Govern</strong> to manage risk, compliance, behavioral guardrails, and open issues across your entire agent roster.
                        </p>

                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-4 mb-1">Risk Analysis</p>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            Run a <strong>Risk Assessment</strong> on any agent to get Blended, AIVSS, and Regulatory scores. All agents are plotted on a Risk vs. Impact scatter chart so you can immediately identify high-risk / high-impact agents needing attention.
                        </p>
                        <ScreenshotFrame title="Govern — Risk Analysis" src="/assets/images/AI Risk Assessment.png" alt="AI Risk Assessment" />

                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-4 mb-1">Compliance &amp; Audit</p>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            Schedule and run compliance audits against regulatory frameworks — EU AI Act, GDPR, SOC 2, HIPAA. Each audit produces control findings by severity. Review, assign owners, and mark items resolved. The audit history provides an auditable compliance trail over time.
                        </p>
                        <ScreenshotFrame title="Govern — Compliance & Audit" src="/assets/images/ComplianceAudit.png" alt="Compliance Audit view" />

                        <div className="mt-4 flex items-center gap-2">
                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Guardrails</p>
                            <Badge color="violet">Coming Soon</Badge>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
                            Behavioral constraints enforced at agent runtime — coming in a future release.
                        </p>

                        <div className="mt-4 flex items-center gap-2">
                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Issues</p>
                            <Badge color="violet">Coming Soon</Badge>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
                            Centralized governance issue tracker — coming in a future release.
                        </p>
                    </Step>

                    {/* ── Build ── */}
                    <SectionHeading id="build-section" level={2} icon={<FlaskConical size={18} />}>Build</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                        The Build section provides tools to test and evaluate your agents before they go into production.
                    </p>

                    <SectionHeading id="build-playground" level={3}>Agent Playground</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                        The Agent Playground is the hands-on workspace where you prototype, test, and iterate on agents before deploying them. Each agent runs in a full session backed by its live configuration. Open the Playground from any Agent Detail page or from <strong>Build → Agent Playground</strong> in the sidebar.
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                        The Playground header shows the active agent name, its mode badge (<Badge color="blue">CODE-DRIVEN</Badge>), the selected LLM and model, and the <UIButton color="blue" icon={<Play size={11}/>}>Start session</UIButton> button. The workspace is organized into five tabs:
                    </p>

                    {/* Code tab */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden mb-4">
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                            <Code2 size={14} className="text-slate-500" />
                            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Code</span>
                        </div>
                        <div className="p-4">
                            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                                The Code tab is an in-browser IDE powered by <strong>Claude Code · Tavro Agent CLI</strong>. It lets you generate, inspect, and modify the agent's source code without leaving the platform. The left panel is a file Explorer showing all generated source files; the right panel is a Terminal.
                            </p>
                            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">Three CLI commands are available in the terminal:</p>
                            <div className="rounded-xl bg-slate-900 text-slate-100 px-4 py-3 font-mono text-xs space-y-1.5 mb-3">
                                <div><span className="text-emerald-400">/generate-agent-code</span> <span className="text-slate-400">&lt;id&gt;</span> <span className="text-slate-500 ml-2">— generate source code for an agent by ID</span></div>
                                <div><span className="text-blue-400">update</span> <span className="text-slate-400">&lt;file&gt;: &lt;instruction&gt;</span> <span className="text-slate-500 ml-2">— modify open code with a plain-language instruction</span></div>
                                <div><span className="text-violet-400">claude</span> <span className="text-slate-400">"&lt;prompt&gt;"</span> <span className="text-slate-500 ml-2">— ask Claude anything about the agent or codebase</span></div>
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                                The toolbar above the editor provides four actions:
                            </p>
                            <div className="flex flex-wrap gap-2 mb-3">
                                {[
                                    { label: 'Generate', color: 'bg-violet-600 text-white' },
                                    { label: 'Update', color: 'bg-white border border-slate-300 text-slate-700 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300' },
                                    { label: 'Save', color: 'bg-white border border-slate-300 text-slate-700 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300' },
                                    { label: 'Deploy', color: 'bg-emerald-600 text-white' },
                                    { label: 'Publish to Git', color: 'bg-blue-600 text-white' },
                                ].map(({ label, color }) => (
                                    <span key={label} className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold ${color}`}>{label}</span>
                                ))}
                            </div>
                            <ScreenshotFrame title="Agent Playground — Code Tab" src="/assets/images/Playground code.png" alt="Agent Playground Code tab" />
                        </div>
                    </div>

                    {/* Configure tab */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden mb-4">
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                            <Settings size={14} className="text-slate-500" />
                            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Configure</span>
                        </div>
                        <div className="p-4">
                            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                                The Configure tab lets you override the agent's saved settings for the current session. Changes here are session-only and do not affect the agent's saved configuration — use the Agent Detail page to make permanent changes.
                            </p>
                            <div className="space-y-2">
                                {[
                                    { field: 'Provider', desc: 'LLM provider — GitHub Copilot, OpenAI, Azure OpenAI, Anthropic, or Gemini' },
                                    { field: 'Model', desc: 'Specific model version available for the selected provider (e.g. claude-sonnet-4)' },
                                    { field: 'System Prompt', desc: 'Instructions that define the agent\'s persona, behavior, and constraints for this session' },
                                    { field: 'Temperature', desc: 'Controls response creativity — 0 is fully deterministic, 1 is most varied' },
                                    { field: 'Max Tokens', desc: 'Maximum output length per response turn' },
                                    { field: 'Tools', desc: 'Enable or disable tool calling (web search, code execution, integrations)' },
                                ].map(({ field, desc }) => (
                                    <div key={field} className="flex gap-3 text-sm py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
                                        <span className="font-semibold text-slate-800 dark:text-slate-200 w-28 flex-shrink-0">{field}</span>
                                        <span className="text-slate-500 dark:text-slate-400">{desc}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Interact tab */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden mb-4">
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                            <MessageCircle size={14} className="text-slate-500" />
                            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Interact</span>
                        </div>
                        <div className="p-4">
                            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                                The Interact tab is the live chat interface. Type a message and press Enter to send it to the agent. Responses stream token-by-token in the center panel. Tool calls are shown inline with their full inputs and outputs so you can trace exactly what the agent did at every step.
                            </p>
                            <div className="space-y-2 mb-3">
                                <Step n={1}>Type a message and press Enter or click <UIButton color="blue" icon={<MessageCircle size={11}/>}>Send</UIButton>.</Step>
                                <Step n={2}>The agent responds in real time. Tool invocations appear as expandable cards between messages.</Step>
                                <Step n={3}>Continue the conversation for multi-turn testing — each exchange is stored in the session.</Step>
                                <Step n={4}>Click <UIButton color="rose" icon={<Play size={11}/>}>End session</UIButton> in the header when done. The session is archived with all observations and the summary preserved for review.</Step>
                            </div>
                        </div>
                    </div>

                    {/* Observations tab */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden mb-4">
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                            <ClipboardList size={14} className="text-slate-500" />
                            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Observations</span>
                        </div>
                        <div className="p-4">
                            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                                Tag each agent response inline using the quick-reaction buttons that appear below every assistant message. These micro-observations feed directly into the session summary.
                            </p>
                            <div className="flex flex-wrap gap-2 mb-3">
                                {[
                                    { label: '+ Gap', color: 'text-red-600 bg-red-50 border-red-200' },
                                    { label: '+ Works well', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
                                    { label: '+ Needs info', color: 'text-blue-600 bg-blue-50 border-blue-200' },
                                    { label: '+ Unexpected', color: 'text-amber-600 bg-amber-50 border-amber-200' },
                                    { label: '+ Note', color: 'text-slate-600 bg-slate-50 border-slate-200' },
                                ].map(({ label, color }) => (
                                    <span key={label} className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${color}`}>{label}</span>
                                ))}
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                                For longer written notes, switch to the <strong>Observations</strong> tab and click <UIButton color="slate" icon={<Plus size={11}/>}>Add observation</UIButton>. Select a type, write your note, and click Save. All observations are stored with the session and included in the generated summary.
                            </p>
                        </div>
                    </div>

                    {/* Summary tab */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden mb-4">
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                            <FileText size={14} className="text-slate-500" />
                            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Summary</span>
                        </div>
                        <div className="p-4">
                            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                                After ending a session, click the <strong>Summary</strong> tab and then <UIButton color="violet">Generate session summary</UIButton>. The AI reads all session messages and your observations to produce a structured report:
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                                {[
                                    { title: 'Overall Assessment', desc: 'Prose summary of the agent\'s suitability for the use case' },
                                    { title: 'Works Well', desc: 'Capabilities confirmed during the session' },
                                    { title: 'Gaps Found', desc: 'Areas where the agent underperformed or gave unexpected results' },
                                    { title: 'Recommended Next Steps', desc: 'Numbered action items for improving the agent before deployment' },
                                ].map(({ title, desc }) => (
                                    <div key={title} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-sm">
                                        <p className="font-semibold text-slate-800 dark:text-slate-200 mb-0.5">{title}</p>
                                        <p className="text-slate-500 dark:text-slate-400 text-xs">{desc}</p>
                                    </div>
                                ))}
                            </div>
                            <p className="text-sm text-slate-500 dark:text-slate-400 text-xs mt-3">
                                The summary is saved automatically under the agent's <strong>Playground Sessions</strong> tab for future reference.
                            </p>
                        </div>
                    </div>

                    <SectionHeading id="build-evals" level={3}>Agent Evals <Badge color="violet">Coming Soon</Badge></SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                        Structured, repeatable evaluation suites for measuring agent quality — coming in a future release.
                    </p>

                    {/* ── Govern ── */}
                    <SectionHeading id="govern-section" level={2} icon={<ShieldCheck size={18} />}>Govern</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                        The Govern section provides tools for maintaining oversight, managing risk, and ensuring regulatory compliance across your AI agent portfolio.
                    </p>

                    <SectionHeading id="govern-risk" level={3}>Risk Analysis</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                        Tavro provides two layers of risk analysis: individual <strong>Agent Risk Assessments</strong> (AI-evaluated risk scores per agent) and <strong>Compliance Audits</strong> (AI-evaluated checks of use cases against regulations or policies).
                    </p>

                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Agent Risk Assessment</p>
                    <FlowDiagram steps={[
                        { icon: <Bot size={14} />, label: 'Agent Detail', color: 'bg-slate-50 border-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300' },
                        { icon: <ShieldAlert size={14} />, label: 'Risk Assessment', color: 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300' },
                        { icon: <RefreshCw size={14} />, label: 'Processing...', color: 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300' },
                        { icon: <CheckCircle2 size={14} />, label: 'Scores Appear', color: 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300' },
                    ]} />

                    <Step n={1} title="Open the Agent">
                        Navigate to <strong>Agents</strong> and click the agent card — its risk class shows <strong>Pending</strong> because no assessment has run yet.
                    </Step>
                    <Step n={2} title="Trigger the assessment">
                        Click <UIButton color="slate" icon={<ShieldAlert size={11}/>}>Risk Assessment</UIButton> in the top-right. The button shows a spinner labeled <em>"Assessing..."</em> while the AI evaluates the agent against the EU AI Act and AIVSS framework.
                    </Step>
                    <Step n={3} title="Wait for results">
                        The assessment runs asynchronously. The agent card pulses while processing. When complete, <strong>Blended Risk</strong>, <strong>AIVSS Score</strong>, and <strong>Regulatory Risk</strong> appear in the <strong>AI Risk Assessment</strong> tab.
                    </Step>
                    <ScreenshotFrame title="AI Risk Assessment" src="/assets/images/AI Risk Assessment.png" alt="AI Risk Assessment" />
                    <div className="grid grid-cols-3 gap-3 mt-3">
                        {[
                            { title: 'Blended Risk', desc: 'Combined score: access scope, autonomy level, data sensitivity, tool capabilities.', color: 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40', titleColor: 'text-amber-700 dark:text-amber-300' },
                            { title: 'AIVSS Score', desc: 'AI Vulnerability Scoring System — 10 capability dimensions (autonomy, memory, tool use, multi-agent, etc.).', color: 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40', titleColor: 'text-rose-700 dark:text-rose-300' },
                            { title: 'Regulatory Risk', desc: 'EU AI Act classification — Other, High Risk, or Prohibited. Driven by PII/PHI/PCI flags and Article 5/6 evaluation.', color: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40', titleColor: 'text-blue-700 dark:text-blue-300' },
                        ].map(({ title, desc, color, titleColor }) => (
                            <div key={title} className={`rounded-xl border p-3 text-sm ${color}`}>
                                <p className={`font-semibold mb-1 ${titleColor}`}>{title}</p>
                                <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed">{desc}</p>
                            </div>
                        ))}
                    </div>

                    <SectionHeading id="govern-compliance" level={3}>Compliance & Audit</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                        The Compliance area has three interconnected sub-sections: <strong>Compliance</strong> (your library of regulations and policies), <strong>Audit Center</strong> (run and review audits), and <strong>Issues</strong> (track remediation). Before you can run audits you must populate the Compliance library.
                    </p>

                    {/* ── Compliance Module ── */}
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2 mt-1">Compliance Module</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                        Navigate to <strong>Govern → Compliance</strong> to manage the obligations your AI portfolio is measured against. Each item is either a <strong>Regulation</strong> (external law or rule, e.g. EU AI Act, SOC 2) or a <strong>Policy</strong> (internal guideline or standard). Once loaded, regulations and policies appear as selectable targets when launching an audit.
                    </p>
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-gradient-to-br from-slate-50 to-blue-50/40 dark:from-slate-900 dark:to-blue-950/20 p-5 mt-3 mb-1">
                        <p className="text-xs font-semibold uppercase tracking-widest text-blue-500 dark:text-blue-400 mb-3">Compliance Library</p>
                        <div className="grid grid-cols-2 gap-3">
                            {[
                                { icon: <Scale size={15} className="text-blue-500" />, title: 'Regulations', desc: 'External laws and frameworks — EU AI Act, GDPR, HIPAA, SOC 2, BSA/AML, and more. Each regulation carries AI-researched dimensions your use cases are evaluated against.' },
                                { icon: <ClipboardList size={15} className="text-violet-500" />, title: 'Policies', desc: 'Internal standards and guidelines — model governance policies, AI ethics frameworks, vendor-specific rules. Author and version them alongside external regulations.' },
                                { icon: <Filter size={15} className="text-amber-500" />, title: 'Filter & Search', desc: 'Switch between All, Regulation, and Policy views. Search by name or issuing body. Toggle between card grid and list view for quick scanning.' },
                                { icon: <RefreshCw size={15} className="text-emerald-500" />, title: 'Refresh & Sync', desc: 'Refresh the library at any time to pull in newly added items. Regulations show their dimension count so you know how thorough each coverage is.' },
                            ].map(({ icon, title, desc }) => (
                                <div key={title} className="flex gap-3 rounded-xl bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-3">
                                    <span className="flex-shrink-0 mt-0.5">{icon}</span>
                                    <div>
                                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-0.5">{title}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-5 mb-2">Adding a Regulation or Policy</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                        Click <UIButton color="blue" icon={<PlusCircle size={11}/>}>Add Regulation</UIButton> to open the four-step wizard. The same wizard handles both Regulations and Policies — choose the type on step 1.
                    </p>

                    <Step n={1} title="Identify the obligation">
                        Choose <strong>Regulation</strong> (External rule or law) or <strong>Policy</strong> (Internal policy or guideline). Then fill in:
                        <ul className="mt-2 space-y-1 text-xs text-slate-500 dark:text-slate-400 list-disc list-inside">
                            <li><strong>Name & Short name</strong> — e.g. "EU AI Act" / "EU AI Act"</li>
                            <li><strong>Issuing body</strong> — e.g. FinCEN, OCC, SEC, CFPB, European Commission</li>
                            <li><strong>Description</strong> — free-text or click <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 border border-violet-200 dark:border-violet-700">✦ AI assist</span> to auto-generate from the name</li>
                            <li><strong>Jurisdiction</strong> — select one or more: US, US-FL, US-NY, US-CA, US-TX, EU, UK, CA, AU, Global</li>
                            <li><strong>Industry tags</strong> — Banking, Fintech, Insurance, Healthcare, Manufacturing, Retail, Technology, All-Industries</li>
                            <li><strong>Effective date</strong> — when the obligation takes effect</li>
                        </ul>
                    </Step>
                    <ScreenshotFrame title="Add Regulation — Step 1: Identify the Obligation" src="/assets/images/Create Regulation.png" alt="Create Regulation form" />

                    <Step n={2} title="Review AI-researched dimensions">
                        After saving step 1, the AI automatically researches the regulation and surfaces its <strong>compliance dimensions</strong> — the specific checkpoints your AI use cases will be evaluated against. Each dimension is tagged by category (e.g. <em>scope</em>, <em>data governance</em>, <em>human oversight</em>) and includes a plain-language description sourced from official texts.
                        <div className="mt-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                            AI research is generated from publicly available official and secondary sources. It does not constitute legal advice — consult qualified counsel for jurisdiction-specific guidance.
                        </div>
                        Review the pre-selected dimensions, deselect any that don't apply to your organization, and click <UIButton color="blue">Continue with N dimensions</UIButton>.
                    </Step>
                    <ScreenshotFrame title="Add Regulation — Step 2: AI Research & Dimensions" src="/assets/images/Dimensions.png" alt="AI-researched compliance dimensions" />

                    <Step n={3} title="Complete remaining steps">
                        Steps 3 and 4 capture additional metadata and confirmation before the regulation is saved to your Compliance library. Once saved, the regulation is immediately available as an audit target.
                    </Step>

                    <Callout type="tip" title="Regulations vs. Policies">
                        Use <strong>Regulations</strong> for mandatory external frameworks (EU AI Act, GDPR, SOC 2, ISO 42001). Use <strong>Policies</strong> for internal standards — model governance frameworks, AI ethics guidelines, or vendor-specific rules your team enforces.
                    </Callout>

                    {/* ── Running a Compliance Audit ── */}
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2 mt-5">Running a Compliance Audit</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                        Compliance audits can be launched from three places: the <strong>Audit Center</strong> page, a <strong>Use Case</strong> detail page, or an <strong>Agent</strong> detail page. Results stream live as the AI processes each assessment pair.
                    </p>

                    <Step n={1} title="Open the audit dialog">
                        From any of the three locations, click <UIButton color="blue" icon={<ClipboardCheck size={11}/>}>Audit</UIButton> (or <UIButton color="blue" icon={<ClipboardCheck size={11}/>}>New Audit</UIButton> on the Audit Center page).
                    </Step>
                    <Step n={2} title="Choose your scope">
                        <div className="overflow-x-auto mt-2">
                            <table className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                                <thead className="bg-slate-50 dark:bg-slate-800">
                                    <tr>
                                        <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">Scope</th>
                                        <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">Best for</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {[
                                        ['Single use case × single regulation', 'Targeted spot-check before a product launch or deployment'],
                                        ['Single use case × all regulations', 'Full compliance picture for one AI initiative'],
                                        ['All use cases × single regulation', 'Impact analysis when a new regulation comes into effect'],
                                        ['Full catalog × all regulations', 'Quarterly enterprise-wide compliance review'],
                                    ].map(([scope, best]) => (
                                        <tr key={scope} className="bg-white dark:bg-slate-900">
                                            <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{scope}</td>
                                            <td className="px-3 py-2 text-blue-600 dark:text-blue-400">{best}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Step>
                    <Step n={3} title="Select compliance items">
                        Pick the regulations or policies to audit against from the multi-select list. Your Compliance module must have items loaded — navigate to <strong>Compliance</strong> to add them first if needed.
                    </Step>
                    <Step n={4} title="Launch the audit">
                        Click <UIButton color="blue" icon={<Play size={11}/>}>Launch audit</UIButton>. The run appears in the Audit Center with a live progress bar. Findings appear in real time as the AI evaluates each pair.
                    </Step>

                    {/* ── Reading Audit Findings ── */}
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-5 mb-2">Reading Audit Findings</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                        Click any completed audit run to drill into its findings report. Each finding covers one use case × compliance item pair and contains:
                    </p>
                    <div className="space-y-2">
                        {[
                            { badge: <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border border-red-300 text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-300 whitespace-nowrap">Critical / High / Medium / Low</span>, desc: 'Overall severity of the compliance exposure for this pair' },
                            { badge: <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border border-red-200 text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-300">Gap</span>, desc: 'Specific compliance requirements that the use case does not currently satisfy, each with a severity rating' },
                            { badge: <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border border-emerald-200 text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300">Compliant</span>, desc: 'Requirements that the use case already satisfies — positive evidence for audit reporting' },
                            { badge: <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border border-blue-200 text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-300">Action Items</span>, desc: 'Prioritized next steps — Immediate (fix now), Short-term (within quarter), Long-term (roadmap item)' },
                        ].map(({ badge, desc }, i) => (
                            <div key={i} className="flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-sm bg-white dark:bg-slate-900">
                                <span className="flex-shrink-0 mt-0.5">{badge}</span>
                                <span className="text-slate-600 dark:text-slate-400">{desc}</span>
                            </div>
                        ))}
                    </div>

                    <SectionHeading id="govern-guardrails" level={3}>Guardrails <Badge color="violet">Coming Soon</Badge></SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                        Behavioral constraints enforced at agent runtime — coming in a future release.
                    </p>

                    <SectionHeading id="govern-issues" level={3}>Issues <Badge color="violet">Coming Soon</Badge></SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                        Centralized governance issue tracker — coming in a future release.
                    </p>

                    {/* ── Settings ── */}
                    <SectionHeading id="settings-overview" level={2} icon={<Settings size={18} />}>Settings</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                        Access Settings from the gear icon in the bottom of the sidebar. Settings is divided into three areas: LLM Provider configuration, Roadmap scoring weights, and Appearance.
                    </p>

                    <SectionHeading id="llm-setup" level={3}>LLM Provider Setup</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                        Tavro supports five LLM providers. Configure one or more providers so agents can use them in the Playground and for AI-powered features (Spark, risk assessment explanations, etc.):
                    </p>
                    <div className="overflow-x-auto my-4">
                        <table className="w-full text-xs border-collapse">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-800 text-left">
                                    <th className="border border-slate-200 dark:border-slate-700 px-3 py-2 font-bold text-slate-700 dark:text-slate-300">Provider</th>
                                    <th className="border border-slate-200 dark:border-slate-700 px-3 py-2 font-bold text-slate-700 dark:text-slate-300">Required Credentials</th>
                                </tr>
                            </thead>
                            <tbody className="text-slate-600 dark:text-slate-400">
                                <tr><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5 font-semibold">GitHub Copilot</td><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5">GitHub Personal Access Token</td></tr>
                                <tr><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5 font-semibold">OpenAI</td><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5">OpenAI API Key</td></tr>
                                <tr><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5 font-semibold">Azure OpenAI</td><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5">Azure endpoint URL + API Key</td></tr>
                                <tr><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5 font-semibold">Anthropic</td><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5">Anthropic API Key</td></tr>
                                <tr><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5 font-semibold">Google Gemini</td><td className="border border-slate-200 dark:border-slate-700 px-3 py-1.5">Google AI Studio API Key</td></tr>
                            </tbody>
                        </table>
                    </div>
                    <Step n={1} title="Select a provider tab">Click the provider name in the Settings → LLM Providers panel.</Step>
                    <Step n={2} title="Enter credentials">Paste your API key (and endpoint URL for Azure). Credentials are stored encrypted.</Step>
                    <Step n={3} title="Save and Activate">Click <UIButton color="blue">Save</UIButton>, then <UIButton color="blue">Set as Active</UIButton>. The active provider is used for all AI features by default.</Step>
                    <Callout type="warning" title="API Keys">
                        Never share your API keys. Keys are stored server-side and are never exposed in the frontend after being saved.
                    </Callout>

                    <SectionHeading id="roadmap-settings" level={3}>Roadmap Configuration <Badge color="violet">Enterprise</Badge></SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                        Configure the scoring weights used by the Enterprise Roadmap to position use cases on the Priority × Risk matrix.
                    </p>
                    <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-400 list-disc list-inside mb-4">
                        <li><strong>Priority weights</strong> — relative importance of Business Impact, Strategic Alignment, and Effort (weights must sum to 100%)</li>
                        <li><strong>Risk weights</strong> — relative weight of AIVSS Score, Regulatory Score, and custom dimensions</li>
                    </ul>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                        Changes to weights automatically recompute and refresh the Roadmap matrix.
                    </p>

                    <SectionHeading id="theme" level={3}>Appearance & Dev Tools</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                        The Appearance section lets you customize the Tavro UI:
                    </p>
                    <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-400 list-disc list-inside mb-4">
                        <li><strong>Theme</strong> — <Badge color="slate">Light</Badge> <Badge color="slate">Dark</Badge> <Badge color="slate">System</Badge> (follows OS preference)</li>
                        <li><strong>Show Logs</strong> — toggle developer log panel visible in the sidebar footer</li>
                        <li><strong>Inspect JSON</strong> — enable raw JSON inspection overlay on hover for catalog items (useful for debugging API responses)</li>
                    </ul>
                    <Callout type="tip" title="Dark Mode">
                        All Tavro screens fully support dark mode. Toggle it in Settings or let it follow your OS setting automatically.
                    </Callout>

                    {/* Footer */}
                    <div className="mt-16 pt-8 border-t border-slate-100 dark:border-slate-800 text-center">
                        <p className="text-xs text-slate-400 dark:text-slate-600">
                            Tavro Agent BizOps · User Guide · Updated June 2025
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default UserGuidePage;
