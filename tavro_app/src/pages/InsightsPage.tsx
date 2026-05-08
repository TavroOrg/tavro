import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCatalog }    from '../context/CatalogContext';
import { useUseCases }   from '../context/UseCaseContext';
import { useBlueprint }  from '../context/BlueprintContext';
import { useCompliance } from '../context/ComplianceContext';
import { complianceApi } from '../services/complianceApi';
import { auditApi }      from '../services/auditApi';
import { AgentData }     from '../types/agent';
import type { AuditRun } from '../types/audit';
import type { ComplianceItem } from '../types/compliance';
import { CATEGORY_LABELS, CATEGORY_PALETTE } from '../types/blueprint';
import type { DimCategory } from '../types/blueprint';
import {
    Lightbulb, RefreshCw, ShieldAlert, FlameKindling,
    ArrowRight, AlertTriangle, CloudCog, Map, Scale,
    CalendarClock, ShieldCheck, LayoutGrid, TrendingUp,
    Circle, CheckCircle2, XCircle,
} from 'lucide-react';

// =============================================================
// Existing risk helpers (unchanged)
// =============================================================

function getRisk(agent: AgentData): 'high' | 'medium' | 'low' {
    const brc = agent.risk_assessment?.blended_risk_classification?.toLowerCase().trim();
    if (brc === 'critical' || brc === 'high') return 'high';
    if (brc === 'medium') return 'medium';
    if (brc === 'low') return 'low';
    const apps = agent.application ?? [];
    if (apps.some(a =>
        a.business_criticality?.toLowerCase().includes('high') ||
        a.business_criticality?.toLowerCase().includes('critical') ||
        a.emergency_tier?.toLowerCase().includes('critical')
    )) return 'high';
    if (apps.some(a =>
        a.business_criticality?.toLowerCase().includes('medium') ||
        a.emergency_tier?.toLowerCase().includes('business critical')
    )) return 'medium';
    return 'low';
}

function hasCriticalApp(agent: AgentData): boolean {
    const brc = agent.risk_assessment?.blended_risk_classification?.toLowerCase().trim();
    if (brc === 'critical') return true;
    return (agent.application ?? []).some(a =>
        a.emergency_tier?.toLowerCase().includes('mission critical') ||
        a.emergency_tier?.toLowerCase() === 'critical'
    );
}

function isEnv(agent: AgentData, keyword: string): boolean {
    return (agent.identification?.environment ?? '').toLowerCase().includes(keyword);
}

// =============================================================
// Shared UI primitives
// =============================================================

const RiskBadge: React.FC<{ level: 'high' | 'medium' | 'low' | 'critical' }> = ({ level }) => {
    const map = {
        critical: 'bg-rose-100 dark:bg-rose-900/30 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800',
        high:     'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-100 dark:border-red-800',
        medium:   'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-800',
        low:      'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-800',
    };
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide ${map[level]}`}>
            {level}
        </span>
    );
};

const Pill: React.FC<{ value: string | number; label: string; color?: string }> = ({ value, label, color = 'text-slate-700 dark:text-slate-200' }) => (
    <div className="flex flex-col items-center bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 min-w-[72px]">
        <span className={`text-xl font-black tabular-nums ${color}`}>{value}</span>
        <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">{label}</span>
    </div>
);

const SectionLabel: React.FC<{ children: React.ReactNode; badge?: 'new' | 'existing' }> = ({ children, badge }) => (
    <div className="flex items-center gap-2 mt-2">
        <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{children}</p>
        {badge === 'new' && (
            <span className="text-[9px] font-bold bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 px-1.5 py-0.5 rounded-full">new</span>
        )}
    </div>
);

const InsightRow: React.FC<{ label: React.ReactNode; value: React.ReactNode; onClick?: () => void }> = ({ label, value, onClick }) => (
    <div
        className={`flex items-center justify-between gap-3 py-2.5 border-b border-slate-100 dark:border-slate-800 last:border-b-0 ${onClick ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 -mx-4 px-4 rounded-lg transition-colors' : ''}`}
        onClick={onClick}
    >
        <span className="text-[12px] text-slate-500 dark:text-slate-400 truncate">{label}</span>
        <span className="flex-shrink-0">{value}</span>
    </div>
);

const Badge: React.FC<{ children: React.ReactNode; variant?: 'red' | 'amber' | 'green' | 'blue' | 'violet' | 'gray' }> = ({ children, variant = 'gray' }) => {
    const map = {
        red:    'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800',
        amber:  'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
        green:  'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
        blue:   'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
        violet: 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800',
        gray:   'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    };
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${map[variant]}`}>
            {children}
        </span>
    );
};

interface CardProps {
    title: string;
    icon: React.ReactNode;
    count?: React.ReactNode;
    countColor?: string;
    accentColor: string;
    children: React.ReactNode;
    loading?: boolean;
    onAction?: () => void;
    actionLabel?: string;
}

const InsightCard: React.FC<CardProps> = ({
    title, icon, count, countColor = 'text-slate-800 dark:text-slate-100',
    accentColor, children, loading, onAction, actionLabel,
}) => (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col relative">
        <div className={`absolute top-0 left-0 w-1.5 h-full ${accentColor} rounded-l-2xl`} />
        <div className="pl-5 pr-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
                {icon}
                <p className="font-bold text-slate-800 dark:text-slate-100 text-sm">{title}</p>
            </div>
            <div className="flex items-center gap-2">
                {onAction && (
                    <button onClick={onAction}
                        className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex-shrink-0">
                        {actionLabel ?? 'View all'}
                    </button>
                )}
                {count !== undefined && !loading && (
                    <span className={`text-2xl font-black tabular-nums ${countColor}`}>{count}</span>
                )}
            </div>
        </div>
        <div className="flex-1 overflow-y-auto max-h-[280px] px-4 py-1">
            {loading ? (
                <div className="flex items-center justify-center h-28 gap-2 text-slate-400 dark:text-slate-500 text-sm">
                    <RefreshCw size={14} className="animate-spin" /> Loading…
                </div>
            ) : children}
        </div>
    </div>
);

// =============================================================
// Existing agent row (unchanged)
// =============================================================

const AgentRow: React.FC<{ agent: AgentData }> = ({ agent }) => {
    const navigate = useNavigate();
    const risk = getRisk(agent);
    const isCritical = hasCriticalApp(agent);
    const env = agent.identification?.environment ?? 'Unknown';
    const criticalApps = (agent.application ?? []).filter(a => a.emergency_tier?.includes('Critical'));

    return (
        <div
            className="flex items-start gap-3 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer border-b border-slate-100 dark:border-slate-800 last:border-b-0 group"
            onClick={() => navigate(`/agent/${agent.identification?.agent_id}`)}
        >
            <div className={`mt-1 w-1 h-8 rounded-full flex-shrink-0 ${isCritical ? 'bg-rose-500' : 'bg-red-400'}`} />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{agent.name}</p>
                    <RiskBadge level={isCritical ? 'critical' : risk} />
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{agent.description ?? '—'}</p>
                {criticalApps.length > 0 && (
                    <p className="text-[11px] text-rose-600 dark:text-rose-400 font-medium mt-0.5 truncate">
                        ⚠ {criticalApps.map(a => a.name ?? a.identifier).filter(Boolean).join(', ')}
                    </p>
                )}
            </div>
            <div className="flex-shrink-0 flex flex-col items-end gap-1">
                <span className="text-[11px] text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">{env}</span>
                <ArrowRight size={13} className="text-slate-300 dark:text-slate-600 group-hover:text-blue-500 transition-colors" />
            </div>
        </div>
    );
};

// =============================================================
// Blueprint coverage mini-chart
// =============================================================

const ALL_CATS: DimCategory[] = ['profile','strategy','organisation','process','application','technology','risk'];

const BlueprintCoverageCard: React.FC<{ nodes: any[]; loading: boolean }> = ({ nodes, loading }) => {
    const navigate = useNavigate();
    const counts = useMemo(() => {
        const m: Record<string, number> = {};
        nodes.forEach(n => { m[n.category ?? n.type ?? 'custom'] = (m[n.category ?? n.type ?? 'custom'] ?? 0) + 1; });
        return m;
    }, [nodes]);

    const filled = ALL_CATS.filter(c => (counts[c] ?? 0) > 0).length;
    const maxCount = Math.max(...ALL_CATS.map(c => counts[c] ?? 0), 1);

    return (
        <InsightCard
            title="Blueprint coverage"
            icon={<Map size={16} className="text-teal-600 dark:text-teal-400" />}
            count={`${filled}/${ALL_CATS.length}`}
            countColor={filled === ALL_CATS.length ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}
            accentColor="bg-teal-500"
            loading={loading}
            onAction={() => navigate('/blueprint')}
        >
            {ALL_CATS.map(cat => {
                const count = counts[cat] ?? 0;
                const p = CATEGORY_PALETTE[cat] ?? CATEGORY_PALETTE.custom;
                const pct = Math.round((count / maxCount) * 100);
                return (
                    <div key={cat} className="flex items-center gap-3 py-2 border-b border-slate-100 dark:border-slate-800 last:border-b-0">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 w-24 flex-shrink-0 truncate">
                            {CATEGORY_LABELS[cat] ?? cat}
                        </span>
                        <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-1.5 rounded-full transition-all duration-500"
                                style={{ width: `${pct}%`, background: count === 0 ? '#e2e8f0' : p.stroke }} />
                        </div>
                        {count === 0
                            ? <Badge variant="red">0</Badge>
                            : <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 w-5 text-right">{count}</span>
                        }
                    </div>
                );
            })}
        </InsightCard>
    );
};

// =============================================================
// Compliance gap card
// =============================================================

const ComplianceGapsCard: React.FC<{ items: ComplianceItem[]; loading: boolean }> = ({ items, loading }) => {
    const navigate = useNavigate();
    const withGaps = useMemo(() =>
        [...items]
            .filter(i => (i.open_gaps ?? 0) > 0)
            .sort((a, b) => (b.open_gaps ?? 0) - (a.open_gaps ?? 0))
            .slice(0, 6),
        [items]
    );
    const totalGaps = items.reduce((n, i) => n + (i.open_gaps ?? 0), 0);

    return (
        <InsightCard
            title="Open compliance gaps"
            icon={<Scale size={16} className="text-blue-600 dark:text-blue-400" />}
            count={totalGaps}
            countColor={totalGaps > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}
            accentColor="bg-blue-500"
            loading={loading}
            onAction={() => navigate('/compliance')}
        >
            {withGaps.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-28 gap-2 text-slate-400 dark:text-slate-500">
                    <CheckCircle2 size={22} className="text-emerald-400" />
                    <p className="text-sm">No open gaps — all closed or N/A</p>
                </div>
            ) : (
                withGaps.map(item => (
                    <InsightRow
                        key={item.id}
                        label={<span className="flex items-center gap-1.5">{item.short_name ?? item.name}</span>}
                        value={
                            <Badge variant={(item.open_gaps ?? 0) >= 3 ? 'red' : 'amber'}>
                                {item.open_gaps} open
                            </Badge>
                        }
                        onClick={() => navigate(`/compliance/${item.id}`)}
                    />
                ))
            )}
        </InsightCard>
    );
};

// =============================================================
// Upcoming reviews card
// =============================================================

function daysUntil(dateStr: string | null | undefined): number | null {
    if (!dateStr) return null;
    const diff = new Date(dateStr).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

const UpcomingReviewsCard: React.FC<{ items: ComplianceItem[]; loading: boolean }> = ({ items, loading }) => {
    const navigate = useNavigate();
    const upcoming = useMemo(() =>
        items
            .map(i => ({ ...i, days: daysUntil(i.review_date) }))
            .filter(i => i.days !== null && i.days <= 180)
            .sort((a, b) => (a.days ?? 999) - (b.days ?? 999))
            .slice(0, 5),
        [items]
    );
    const overdue = upcoming.filter(i => (i.days ?? 0) <= 0).length;
    const soon    = upcoming.filter(i => (i.days ?? 999) > 0 && (i.days ?? 999) <= 30).length;

    return (
        <InsightCard
            title="Upcoming reviews"
            icon={<CalendarClock size={16} className="text-amber-600 dark:text-amber-400" />}
            count={upcoming.length}
            countColor={overdue > 0 ? 'text-rose-600 dark:text-rose-400' : soon > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}
            accentColor="bg-amber-500"
            loading={loading}
            onAction={() => navigate('/compliance')}
        >
            {upcoming.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-28 gap-2 text-slate-400 dark:text-slate-500">
                    <CheckCircle2 size={22} className="text-emerald-400" />
                    <p className="text-sm">No reviews due in 180 days</p>
                </div>
            ) : (
                upcoming.map(item => {
                    const d = item.days ?? 0;
                    const variant = d <= 0 ? 'red' : d <= 30 ? 'red' : d <= 90 ? 'amber' : 'green';
                    const label   = d <= 0 ? 'Overdue' : `${d}d`;
                    return (
                        <InsightRow
                            key={item.id}
                            label={item.short_name ?? item.name}
                            value={<Badge variant={variant}>{label}</Badge>}
                            onClick={() => navigate(`/compliance/${item.id}`)}
                        />
                    );
                })
            )}
        </InsightCard>
    );
};

// =============================================================
// Audit intelligence card
// =============================================================

const AuditIntelCard: React.FC<{ runs: AuditRun[]; loading: boolean; agentCount: number }> = ({ runs, loading, agentCount }) => {
    const navigate = useNavigate();

    const latestRun    = runs[0];
    const totalCrit    = runs.reduce((n, r) => n + (r.critical_count ?? 0), 0);
    const totalHigh    = runs.reduce((n, r) => n + (r.high_count ?? 0), 0);
    const overallRisk  = latestRun?.overall_risk;

    const riskVariant = (r: string | null | undefined) =>
        r === 'critical' ? 'red' : r === 'high' ? 'red' : r === 'medium' ? 'amber' : r === 'low' ? 'green' : 'gray';

    return (
        <InsightCard
            title="Audit intelligence"
            icon={<ShieldCheck size={16} className="text-violet-600 dark:text-violet-400" />}
            count={runs.length}
            countColor="text-violet-600 dark:text-violet-400"
            accentColor="bg-violet-500"
            loading={loading}
            onAction={() => navigate('/audit')}
            actionLabel="Audit center"
        >
            {runs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-28 gap-2 text-slate-400 dark:text-slate-500 text-center px-4">
                    <ShieldCheck size={22} className="text-slate-300 dark:text-slate-600" />
                    <p className="text-sm">No audit runs yet — launch one from any use case or agent</p>
                </div>
            ) : (
                <>
                    <InsightRow label="Latest audit risk" value={
                        <Badge variant={riskVariant(overallRisk)}>{overallRisk ?? '—'}</Badge>
                    } onClick={() => latestRun && navigate(`/audit/${latestRun.id}`)} />
                    <InsightRow label="Total critical findings" value={
                        <Badge variant={totalCrit > 0 ? 'red' : 'green'}>{totalCrit}</Badge>
                    } />
                    <InsightRow label="Total high findings" value={
                        <Badge variant={totalHigh > 0 ? 'amber' : 'green'}>{totalHigh}</Badge>
                    } />
                    <InsightRow label="Audit runs completed" value={
                        <Badge variant="violet">{runs.filter(r => r.status === 'completed').length}</Badge>
                    } />
                    {latestRun?.completed_at && (
                        <InsightRow label="Last run" value={
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                {new Date(latestRun.completed_at).toLocaleDateString()}
                            </span>
                        } />
                    )}
                </>
            )}
        </InsightCard>
    );
};

// =============================================================
// Portfolio health card
// =============================================================

const PortfolioHealthCard: React.FC<{
    agents:   AgentData[];
    useCases: any[];
    loading:  boolean;
}> = ({ agents, useCases, loading }) => {
    const navigate = useNavigate();

    const agentIds   = new Set(agents.map(a => a.identification?.agent_id).filter(Boolean));
    const ucAgentIds = new Set(
        useCases.flatMap((uc: any) =>
            (uc.agents ?? []).map((a: any) => a.agent_id ?? a.identifier ?? a.id).filter(Boolean)
        )
    );

    const agentsWithoutUseCase = agents.filter(a => {
        const aid = a.identification?.agent_id;
        return aid && !ucAgentIds.has(aid);
    });
    const useCasesWithoutAgent = useCases.filter((uc: any) =>
        !uc.agents?.length
    );

    const staleThreshold = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const staleUseCases  = useCases.filter((uc: any) => {
        const updated = uc.updated_at ?? uc.last_updated;
        return updated && new Date(updated).getTime() < staleThreshold;
    });

    const tier1Unaudited = agents.filter(a => {
        const brc = a.risk_assessment?.blended_risk_classification?.toLowerCase();
        return brc === 'high' || brc === 'critical';
    }).length;

    const items = [
        { label: 'Agents without a use case', value: agentsWithoutUseCase.length, variant: agentsWithoutUseCase.length > 0 ? 'red' : 'green', action: () => navigate('/') },
        { label: 'Use cases without an agent', value: useCasesWithoutAgent.length, variant: useCasesWithoutAgent.length > 0 ? 'amber' : 'green', action: () => navigate('/use-cases') },
        { label: 'High-risk agents (Tier 1)', value: tier1Unaudited, variant: tier1Unaudited > 0 ? 'red' : 'green', action: () => navigate('/audit?launch=true') },
        { label: 'Stale use cases (90+ days)', value: staleUseCases.length, variant: staleUseCases.length > 0 ? 'amber' : 'green', action: () => navigate('/use-cases') },
    ] as const;

    return (
        <InsightCard
            title="Portfolio health"
            icon={<LayoutGrid size={16} className="text-blue-600 dark:text-blue-400" />}
            count={agents.length}
            countColor="text-blue-600 dark:text-blue-400"
            accentColor="bg-blue-500"
            loading={loading}
        >
            {items.map(({ label, value, variant, action }) => (
                <InsightRow
                    key={label}
                    label={label}
                    value={<Badge variant={variant as any}>{value}</Badge>}
                    onClick={action}
                />
            ))}
        </InsightCard>
    );
};

// =============================================================
// Main page
// =============================================================

const InsightsPage: React.FC = () => {
    const navigate = useNavigate();

    const { agents,    loading: agentsLoading,  error: agentsError,  refresh: refreshAgents }  = useCatalog();
    const { useCases,  loading: ucLoading }     = useUseCases();
    const { activeCompany, nodes, loading: bpLoading } = useBlueprint();
    const { items: compItems, loading: compLoading }   = useCompliance();

    const [auditRuns,    setAuditRuns]    = useState<AuditRun[]>([]);
    const [auditLoading, setAuditLoading] = useState(false);

    // Fetch audit runs when company changes
    useEffect(() => {
        if (!activeCompany) return;
        setAuditLoading(true);
        auditApi.listRuns(activeCompany.id, 10)
            .then(setAuditRuns)
            .catch(console.error)
            .finally(() => setAuditLoading(false));
    }, [activeCompany?.id]);

    // Agent risk slices (existing)
    const criticalInProd = agents.filter(a =>
        (getRisk(a) === 'high' || hasCriticalApp(a)) && isEnv(a, 'prod')
    );
    const highInDev = agents.filter(a =>
        getRisk(a) === 'high' &&
        (isEnv(a, 'dev') || isEnv(a, 'stage') || isEnv(a, 'test') || isEnv(a, 'qa') || isEnv(a, 'uat'))
    );
    const remainingHighRisk = agents.filter(a =>
        getRisk(a) === 'high' && !criticalInProd.includes(a) && !highInDev.includes(a)
    );

    // Summary stats
    const totalAgents    = agents.length;
    const totalCritical  = agents.filter(hasCriticalApp).length;
    const totalHighRisk  = agents.filter(a => getRisk(a) === 'high').length;
    const totalOpenGaps  = compItems.reduce((n, i) => n + (i.open_gaps ?? 0), 0);
    const blueprintDims  = nodes.length;
    const auditRiskLabel = auditRuns[0]?.overall_risk;

    const loading = agentsLoading;

    return (
        <div className="flex flex-col gap-5 w-full animate-fade-in max-w-[1200px] mx-auto pb-12">

            {/* ── Header ────────────────────────────────────────────────────── */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1.5 h-full bg-blue-600 rounded-l-2xl" />
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pl-2">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-xl border border-blue-100 dark:border-blue-800">
                            <Lightbulb size={22} className="text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">Insights</h1>
                            <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
                                AI governance health across agents, blueprint, compliance, and audit
                                {activeCompany && ` · ${activeCompany.name}`}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        <Pill value={loading ? '—' : totalAgents}   label="Agents"      />
                        <Pill value={loading ? '—' : totalCritical} label="Critical"    color="text-rose-700 dark:text-rose-400" />
                        <Pill value={loading ? '—' : totalHighRisk} label="High risk"   color="text-red-700 dark:text-red-400" />
                        <Pill value={compLoading ? '—' : totalOpenGaps} label="Open gaps" color={totalOpenGaps > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'} />
                        <Pill value={bpLoading ? '—' : blueprintDims}   label="Blueprint dims" color="text-teal-700 dark:text-teal-400" />
                        <Pill value={auditLoading ? '—' : auditRuns.length} label="Audit runs" color="text-violet-700 dark:text-violet-400" />
                        <button onClick={refreshAgents} disabled={loading}
                            className="flex items-center gap-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-3 py-2.5 transition-colors disabled:opacity-50">
                            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                            Refresh
                        </button>
                    </div>
                </div>
            </div>

            {agentsError && (
                <div className="flex items-center gap-2 text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm">
                    <AlertTriangle size={16} className="shrink-0" /> {agentsError}
                </div>
            )}

            {/* ── Section 1: Agent risk (existing) ─────────────────────────── */}
            <SectionLabel badge="existing">Agent risk</SectionLabel>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <InsightCard
                    title="Critical & high risk in production"
                    icon={<ShieldAlert size={16} className="text-rose-600 dark:text-rose-400" />}
                    count={criticalInProd.length}
                    countColor={criticalInProd.length > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}
                    accentColor="bg-rose-500"
                    loading={loading}
                    onAction={() => navigate('/')}
                    actionLabel="View catalog"
                >
                    {criticalInProd.length === 0
                        ? <div className="flex flex-col items-center justify-center h-28 gap-2 text-slate-400 dark:text-slate-500"><span className="text-2xl">✅</span><p className="text-sm">No critical or high-risk agents in production</p></div>
                        : criticalInProd.map(a => <AgentRow key={a.identification?.agent_id ?? a.name} agent={a} />)
                    }
                </InsightCard>

                <InsightCard
                    title="High risk agents under development"
                    icon={<FlameKindling size={16} className="text-amber-600 dark:text-amber-400" />}
                    count={highInDev.length}
                    countColor={highInDev.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}
                    accentColor="bg-amber-500"
                    loading={loading}
                    onAction={() => navigate('/')}
                    actionLabel="View catalog"
                >
                    {highInDev.length === 0
                        ? <div className="flex flex-col items-center justify-center h-28 gap-2 text-slate-400 dark:text-slate-500"><span className="text-2xl">✅</span><p className="text-sm">No high-risk agents in dev / staging</p></div>
                        : highInDev.map(a => <AgentRow key={a.identification?.agent_id ?? a.name} agent={a} />)
                    }
                </InsightCard>

                {!loading && remainingHighRisk.length > 0 && (
                    <InsightCard
                        title="High risk — environment unknown"
                        icon={<CloudCog size={16} className="text-slate-500 dark:text-slate-400" />}
                        count={remainingHighRisk.length}
                        accentColor="bg-slate-400"
                    >
                        {remainingHighRisk.map(a => <AgentRow key={a.identification?.agent_id ?? a.name} agent={a} />)}
                    </InsightCard>
                )}
            </div>

            {/* ── Section 2: Blueprint + Compliance ────────────────────────── */}
            <SectionLabel badge="new">Blueprint health · Compliance posture</SectionLabel>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <BlueprintCoverageCard nodes={nodes} loading={bpLoading} />
                <ComplianceGapsCard   items={compItems} loading={compLoading} />
                <UpcomingReviewsCard  items={compItems} loading={compLoading} />
            </div>

            {/* ── Section 3: Audit + Portfolio ─────────────────────────────── */}
            <SectionLabel badge="new">Audit intelligence · Portfolio health</SectionLabel>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <AuditIntelCard
                    runs={auditRuns}
                    loading={auditLoading}
                    agentCount={totalAgents}
                />
                <PortfolioHealthCard
                    agents={agents}
                    useCases={useCases}
                    loading={agentsLoading || ucLoading}
                />
            </div>
        </div>
    );
};

export default InsightsPage;
