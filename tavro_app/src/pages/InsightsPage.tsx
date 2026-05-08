import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useCatalog } from '../context/CatalogContext';
import { AgentData } from '../types/agent';
import {
    Lightbulb, RefreshCw, ShieldAlert, FlameKindling,
    ArrowRight, AlertTriangle, CloudCog
} from 'lucide-react';

// ── Risk helpers (mirrors mcpClient / HomePage) ───────────────────────────────

function getRisk(agent: AgentData): 'high' | 'medium' | 'low' {
    // 1. Formal risk assessment is authoritative
    const brc = agent.risk_assessment?.blended_risk_classification?.toLowerCase().trim();
    if (brc === 'critical' || brc === 'high') return 'high';
    if (brc === 'medium') return 'medium';
    if (brc === 'low') return 'low';

    // 2. Fall back to application-level fields (case-insensitive)
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
    // Check formal assessment first
    const brc = agent.risk_assessment?.blended_risk_classification?.toLowerCase().trim();
    if (brc === 'critical') return true;
    // Then application emergency tier (case-insensitive)
    return (agent.application ?? []).some(a =>
        a.emergency_tier?.toLowerCase().includes('mission critical') ||
        a.emergency_tier?.toLowerCase() === 'critical'
    );
}


function isEnv(agent: AgentData, keyword: string): boolean {
    return (agent.identification?.environment ?? '').toLowerCase().includes(keyword);
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const RiskBadge: React.FC<{ level: 'high' | 'medium' | 'low' | 'critical' }> = ({ level }) => {
    const map = {
        critical: 'bg-rose-100 text-rose-800 border-rose-200',
        high: 'bg-red-50 text-red-700 border-red-100',
        medium: 'bg-amber-50 text-amber-700 border-amber-100',
        low: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    };
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide ${map[level]}`}>
            {level}
        </span>
    );
};

interface AgentRowProps { agent: AgentData; }

const AgentRow: React.FC<AgentRowProps> = ({ agent }) => {
    const navigate = useNavigate();
    const risk = getRisk(agent);
    const isCritical = hasCriticalApp(agent);
    const env = agent.identification?.environment ?? 'Unknown';
    const criticalApps = (agent.application ?? []).filter(a => a.emergency_tier?.includes('Critical'));

    return (
        <div
            className="flex items-start gap-4 px-5 py-3.5 hover:bg-slate-50 transition-colors cursor-pointer border-b border-slate-100 last:border-b-0 group"
            onClick={() => navigate(`/agent/${agent.identification?.agent_id}`)}
        >
            {/* Risk indicator bar */}
            <div className={`mt-1 w-1 h-10 rounded-full flex-shrink-0 ${isCritical ? 'bg-rose-500' : 'bg-red-400'}`} />

            {/* Agent info */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-bold text-slate-800 truncate">{agent.name}</p>
                    <RiskBadge level={isCritical ? 'critical' : risk} />
                </div>
                <p className="text-[11px] text-slate-500 truncate">{agent.description ?? '—'}</p>
                {criticalApps.length > 0 && (
                    <p className="text-[11px] text-rose-600 font-medium mt-1 truncate">
                        ⚠ {criticalApps.map(a => a.name ?? a.identifier).filter(Boolean).join(', ')}
                    </p>
                )}
            </div>

            {/* Env pill */}
            <div className="flex-shrink-0 flex flex-col items-end gap-1">
                <span className="text-[11px] text-slate-400 font-medium bg-slate-100 px-2 py-0.5 rounded-full">{env}</span>
                <ArrowRight size={14} className="text-slate-300 group-hover:text-blue-500 transition-colors" />
            </div>
        </div>
    );
};

interface InsightCardProps {
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    accentColor: string;                // Tailwind bg colour for left bar
    headerBg: string;                   // header background
    count: number;
    agents: AgentData[];
    loading: boolean;
    emptyMessage: string;
}

const InsightCard: React.FC<InsightCardProps> = ({
    title, subtitle, icon, accentColor, headerBg, count, agents, loading, emptyMessage
}) => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col relative">
        {/* Left accent bar */}
        <div className={`absolute top-0 left-0 w-1.5 h-full ${accentColor} rounded-l-2xl`} />

        {/* Header */}
        <div className={`pl-5 pr-5 py-4 border-b border-slate-100 ${headerBg} flex items-center justify-between`}>
            <div className="flex items-center gap-2.5">
                {icon}
                <div>
                    <p className="font-bold text-slate-800 text-sm leading-tight">{title}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
                </div>
            </div>
            {!loading && (
                <div className={`text-2xl font-black tabular-nums ${count > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {count}
                </div>
            )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto max-h-[360px]">
            {loading ? (
                <div className="flex items-center justify-center h-32 gap-2 text-slate-400 text-sm">
                    <RefreshCw size={16} className="animate-spin" /> Loading…
                </div>
            ) : agents.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-400">
                    <span className="text-2xl">✅</span>
                    <p className="text-sm">{emptyMessage}</p>
                </div>
            ) : (
                agents.map(a => <AgentRow key={a.identification?.agent_id ?? a.name} agent={a} />)
            )}
        </div>
    </div>
);

// ── Main Page ─────────────────────────────────────────────────────────────────

const InsightsPage: React.FC = () => {
    const { agents, loading, error, refresh } = useCatalog();

    // ── Derived datasets ──────────────────────────────────────────────────────

    /** Critical or high-risk agents in any production-like environment. */
    const criticalInProd = agents.filter(a =>
        (getRisk(a) === 'high' || hasCriticalApp(a)) &&
        isEnv(a, 'prod')
    );

    /** High-risk agents in development / staging / test environments. */
    const highInDev = agents.filter(a =>
        getRisk(a) === 'high' &&
        (isEnv(a, 'dev') || isEnv(a, 'stage') || isEnv(a, 'test') || isEnv(a, 'qa') || isEnv(a, 'uat'))
    );

    /** Any high/critical agent NOT matched by above two (catch-all) */
    const remainingHighRisk = agents.filter(a =>
        getRisk(a) === 'high' &&
        !criticalInProd.includes(a) &&
        !highInDev.includes(a)
    );

    const totalHighRisk = agents.filter(a => getRisk(a) === 'high').length;
    const totalCritical = agents.filter(hasCriticalApp).length;
    const totalAgents = agents.length;

    return (
        <div className="flex flex-col gap-6 w-full animate-fade-in max-w-[1200px] mx-auto">

            {/* ── Header ──────────────────────────────────────────────────── */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1.5 h-full bg-blue-600 rounded-l-2xl" />
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-5 pl-2">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
                            <Lightbulb size={22} className="text-blue-600" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Insights</h1>
                            <p className="text-slate-500 text-sm mt-0.5">Risk-focused view across all agent environments</p>
                        </div>
                    </div>

                    {/* Summary pills */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex flex-col items-center bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 min-w-[72px]">
                            <span className="text-xl font-black text-slate-700 tabular-nums">{loading ? '—' : totalAgents}</span>
                            <span className="text-[11px] text-slate-500 font-medium mt-0.5">Total</span>
                        </div>
                        <div className="flex flex-col items-center bg-rose-50 border border-rose-100 rounded-xl px-4 py-2.5 min-w-[72px]">
                            <span className="text-xl font-black text-rose-700 tabular-nums">{loading ? '—' : totalCritical}</span>
                            <span className="text-[11px] text-rose-500 font-medium mt-0.5">Critical</span>
                        </div>
                        <div className="flex flex-col items-center bg-red-50 border border-red-100 rounded-xl px-4 py-2.5 min-w-[72px]">
                            <span className="text-xl font-black text-red-700 tabular-nums">{loading ? '—' : totalHighRisk}</span>
                            <span className="text-[11px] text-red-500 font-medium mt-0.5">High Risk</span>
                        </div>
                        <button
                            onClick={refresh}
                            disabled={loading}
                            className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 hover:bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 transition-colors disabled:opacity-50"
                        >
                            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                            Refresh
                        </button>
                    </div>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm">
                    <AlertTriangle size={16} className="shrink-0" /> {error}
                </div>
            )}

            {/* ── Insight Cards ────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

                {/* Card 1: Critical & high in production */}
                <InsightCard
                    title="Critical & High Risk in Production"
                    subtitle="Agents requiring immediate attention"
                    icon={<ShieldAlert size={20} className="text-rose-600" />}
                    accentColor="bg-rose-500"
                    headerBg="bg-rose-50/60"
                    count={criticalInProd.length}
                    agents={criticalInProd}
                    loading={loading}
                    emptyMessage="No critical or high-risk agents in production"
                />

                {/* Card 2: High risk under development */}
                <InsightCard
                    title="High Risk Agents Under Development"
                    subtitle="Risky agents in non-production environments"
                    icon={<FlameKindling size={20} className="text-amber-600" />}
                    accentColor="bg-amber-500"
                    headerBg="bg-amber-50/60"
                    count={highInDev.length}
                    agents={highInDev}
                    loading={loading}
                    emptyMessage="No high-risk agents found in dev / staging"
                />

                {/* Card 3: Other high-risk (unknown / unmapped environment) */}
                {!loading && remainingHighRisk.length > 0 && (
                    <InsightCard
                        title="High Risk — Environment Unknown"
                        subtitle="High-risk agents without a recognised environment tag"
                        icon={<CloudCog size={20} className="text-slate-500" />}
                        accentColor="bg-slate-400"
                        headerBg="bg-slate-50"
                        count={remainingHighRisk.length}
                        agents={remainingHighRisk}
                        loading={false}
                        emptyMessage=""
                    />
                )}
            </div>
        </div>
    );
};

export default InsightsPage;
