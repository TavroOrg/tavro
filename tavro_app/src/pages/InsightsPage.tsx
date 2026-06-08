import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Lightbulb, RefreshCw, ShieldAlert, FlameKindling, ArrowRight,
    AlertTriangle, TrendingUp, TrendingDown, Minus,
    Clock, Target, Users, ChevronRight, CheckCircle2,
    XCircle, AlertCircle, Zap, GitBranch, Layers, Search, Building2,
    BarChart3,
} from 'lucide-react';
import {
    insightsApi,
    type InsightsSummary,
    type StageCount,
    type LabelDistribution,
    type InsightsRiskAgent,
} from '../services/insightsApi';

// All page data is now computed by the backend (GET /api/v1/insights/summary),
// which aggregates live over the core.* / twin.* tables. This page only fetches
// that payload and maps it onto presentational components + color templates.

type StageDatum = {
    stage: string;
    sub: string;
    count: number;
    color: string;
    light: string;
    text: string;
    border: string;
    dot?: string;
};

type RiskAgent = {
    id: string;
    name: string;
    desc: string;
    risk: string;
    env: string;
    app: string | null;
    trend: number[];
    trendDir: 'up' | 'down' | 'flat';
};

type QueueItem = {
    id: string;
    agent: string;
    trigger: string;
    age: string;
    severity: string;
    status: string;
};

type GateItem = {
    id: string;
    agent: string;
    gate: string;
    stage: string;
    stageText: string;
    stageBg: string;
    env: string;
    envText: string;
    envBg: string;
    days: number;
};

type AutonomyDatum = {
    label: string;
    count: number;
    pct: number;
    color: string;
    light: string;
    text: string;
    desc: string;
};

type DistributionDatum = {
    label: string;
    count: number;
    pct: number;
    color: string;
    text: string;
};

type SuccessMetric = {
    id: string;
    agent: string;
    kpi: string;
    value: string;
    target: string;
    status: 'pass' | 'warn' | 'fail';
    trend: number[];
};

type ProfileSection = {
    label: string;
    pct: number;
    status: 'pass' | 'warn' | 'fail';
};

type ProfileGap = {
    id: string;
    gap: string;
    area: string;
    severity: string;
};

type ResearchRefresh = {
    id: string;
    section: string;
    lastRefresh: string;
    stale: boolean;
};

const AGENT_STAGE_TEMPLATE: Omit<StageDatum, 'count'>[] = [
    { stage: 'Plan', sub: 'Use case -> blueprint', color: 'bg-violet-500', light: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', dot: 'bg-violet-500' },
    { stage: 'Design', sub: 'Variants & trade-offs', color: 'bg-teal-500', light: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', dot: 'bg-teal-500' },
    { stage: 'Develop', sub: 'Build & test', color: 'bg-blue-500', light: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
    { stage: 'Deploy', sub: 'Environment release', color: 'bg-orange-500', light: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-500' },
    { stage: 'Monitor', sub: 'Active governance', color: 'bg-amber-500', light: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' },
];

const USECASE_STAGE_TEMPLATE: Omit<StageDatum, 'count'>[] = [
    { stage: 'Identified', sub: 'Captured & logged', color: 'bg-sky-500', light: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200' },
    { stage: 'Scoped', sub: 'Requirements defined', color: 'bg-violet-500', light: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200' },
    { stage: 'Approved', sub: 'Prioritised & funded', color: 'bg-teal-500', light: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200' },
    { stage: 'In Build', sub: 'Agent under dev', color: 'bg-blue-500', light: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
    { stage: 'Live', sub: 'Deployed & active', color: 'bg-emerald-500', light: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
];

// Canonical provider / risk / autonomy buckets — colors live here; counts come
// from the server payload and are merged in by label.
const PROVIDER_BUCKETS = [
    { label: 'Google', color: 'bg-violet-500', text: 'text-violet-700' },
    { label: 'Azure', color: 'bg-teal-500', text: 'text-teal-700' },
    { label: 'ServiceNow', color: 'bg-blue-500', text: 'text-blue-700' },
];

const RISK_BUCKETS = [
    { label: 'Critical', color: 'bg-rose-500', text: 'text-rose-700' },
    { label: 'High', color: 'bg-red-500', text: 'text-red-700' },
    { label: 'Medium', color: 'bg-amber-500', text: 'text-amber-700' },
    { label: 'Low', color: 'bg-emerald-500', text: 'text-emerald-700' },
];

const AUTONOMY_BUCKETS = [
    { label: 'Supervised', color: 'bg-emerald-500', light: 'bg-emerald-50', text: 'text-emerald-700', desc: 'Full human review before action' },
    { label: 'Semi-Autonomous', color: 'bg-amber-500', light: 'bg-amber-50', text: 'text-amber-700', desc: 'Human approval on high-risk actions only' },
    { label: 'Fully Autonomous', color: 'bg-red-500', light: 'bg-red-50', text: 'text-red-700', desc: 'No human gate - escalation only' },
];

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase();

const envBadge = (env: string): { bg: string; text: string } => {
    const e = norm(env);
    if (e.includes('prod') || e.includes('live')) return { bg: 'bg-emerald-50', text: 'text-emerald-700' };
    if (e.includes('stag')) return { bg: 'bg-amber-50', text: 'text-amber-700' };
    if (e.includes('dev')) return { bg: 'bg-blue-50', text: 'text-blue-700' };
    if (e.includes('test') || e.includes('qa') || e.includes('uat')) return { bg: 'bg-violet-50', text: 'text-violet-700' };
    return { bg: 'bg-slate-100', text: 'text-slate-500' };
};

// Synthetic sparkline series for a risk-agent row, derived from the server's
// risk score (purely visual — there is no time-series telemetry).
const makeTrend = (score: number): number[] => [
    Math.max(0, score - 1), score, score, Math.min(10, score + 0.5), score, score,
];

const Sparkline: React.FC<{ values: number[]; up?: boolean }> = ({ values, up }) => {
    const w = 56, h = 22;
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    const pts = values.map((v, i) => {
        const x = values.length === 1 ? 0 : (i / (values.length - 1)) * w;
        const y = h - 2 - ((v - min) / range) * (h - 6);
        return `${x},${y}`;
    }).join(' ');
    const color = up === undefined ? '#94a3b8' : up ? '#ef4444' : '#10b981';
    return (
        <svg width={w} height={h} className="overflow-visible flex-shrink-0">
            <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
    );
};

const TrendChip: React.FC<{ dir: string }> = ({ dir }) => {
    if (dir === 'up') return <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-600 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded-full"><TrendingUp size={9} />Worse</span>;
    if (dir === 'down') return <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-full"><TrendingDown size={9} />Better</span>;
    return <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded-full"><Minus size={9} />Stable</span>;
};

const RiskBadge: React.FC<{ level: string }> = ({ level }) => {
    const map: Record<string, string> = {
        critical: 'bg-rose-100 text-rose-800 border-rose-200',
        high: 'bg-red-50 text-red-700 border-red-100',
        medium: 'bg-amber-50 text-amber-700 border-amber-100',
        low: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    };
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide ${map[level] ?? map.low}`}>
            {level}
        </span>
    );
};

const SeverityDot: React.FC<{ level: string }> = ({ level }) => {
    const c = level === 'high' ? 'bg-red-500' : level === 'medium' ? 'bg-amber-400' : 'bg-slate-400';
    return <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${c}`} />;
};

const SeverityBadge: React.FC<{ level: string }> = ({ level }) => {
    const map: Record<string, string> = {
        high: 'bg-red-50 text-red-600 border-red-100',
        medium: 'bg-amber-50 text-amber-700 border-amber-100',
        low: 'bg-slate-50 text-slate-600 border-slate-200',
    };
    return (
        <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-black uppercase leading-none ${map[level] ?? map.low}`}>
            {level}
        </span>
    );
};

const statusPillClass = (status: string) => {
    const label = norm(status);
    if (label.includes('pending') || label.includes('review')) return 'bg-amber-50 text-amber-700 border-amber-200';
    if (label.includes('open') || label.includes('escalat') || label.includes('human') || label.includes('hitl')) return 'bg-red-50 text-red-600 border-red-100';
    return 'bg-slate-50 text-slate-600 border-slate-200';
};

const displayQueueStatus = (status: string) => {
    const label = norm(status);
    if (label.includes('pending') || label.includes('review')) return 'Pending Review';
    if (label.includes('open') || label.includes('escalat') || label.includes('human') || label.includes('hitl')) return 'Open';
    return status;
};

const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
    if (status === 'pass') return <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" />;
    if (status === 'warn') return <AlertCircle size={15} className="text-amber-500 flex-shrink-0" />;
    return <XCircle size={15} className="text-red-500 flex-shrink-0" />;
};

const EmptyState: React.FC<{ label: string }> = ({ label }) => (
    <div className="px-5 py-10 text-center text-sm text-slate-400">{label}</div>
);

const CardShell: React.FC<{
    accent: string; headerBg: string; icon: React.ReactNode;
    title: string; subtitle: string; badge?: React.ReactNode;
    children: React.ReactNode;
}> = ({ accent, headerBg, icon, title, subtitle, badge, children }) => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col relative">
        <div className={`absolute top-0 left-0 w-1.5 h-full ${accent} rounded-l-2xl`} />
        <div className={`pl-5 pr-5 py-4 border-b border-slate-100 ${headerBg} flex items-center justify-between gap-3`}>
            <div className="flex items-center gap-2.5 min-w-0">
                {icon}
                <div className="min-w-0">
                    <p className="font-bold text-slate-800 text-sm leading-tight truncate">{title}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">{subtitle}</p>
                </div>
            </div>
            {badge}
        </div>
        <div className="flex-1 overflow-y-auto max-h-[340px]">{children}</div>
    </div>
);

const LifecycleDistribution: React.FC<{
    title: string;
    subtitle: string;
    totalClass: string;
    accent: string;
    icon: React.ReactNode;
    data: StageDatum[];
}> = ({ title, subtitle, totalClass, accent, icon, data }) => {
    const total = data.reduce((sum, d) => sum + d.count, 0);
    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden relative">
            <div className={`absolute top-0 left-0 w-1.5 h-full ${accent} rounded-l-2xl`} />
            <div className="pl-5 pr-5 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    {icon}
                    <div>
                        <p className="font-bold text-slate-800 text-sm leading-tight">{title}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
                    </div>
                </div>
                <span className={`text-2xl font-black tabular-nums ${totalClass}`}>{total}</span>
            </div>
            <div className="px-5 py-5">
                {total === 0 ? (
                    <EmptyState label="No records available yet" />
                ) : (
                    <>
                        <div className="flex rounded-lg overflow-hidden h-3 mb-5 gap-0.5">
                            {data.map(s => (
                                <div key={s.stage} className={`${s.color} transition-all`} style={{ width: `${(s.count / total) * 100}%` }} title={`${s.stage}: ${s.count}`} />
                            ))}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                            {data.map(s => (
                                <div key={s.stage} className={`flex flex-col items-center gap-1.5 rounded-xl border ${s.border} ${s.light} px-2 py-3`}>
                                    <span className={`text-2xl font-black tabular-nums ${s.text}`}>{s.count}</span>
                                    <span className={`text-xs font-bold ${s.text}`}>{s.stage}</span>
                                    <span className="text-[10px] text-slate-500 text-center leading-tight">{s.sub}</span>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

const RiskAgentRow: React.FC<{ agent: RiskAgent }> = ({ agent }) => {
    const navigate = useNavigate();
    return (
        <div
            onClick={() => navigate(`/agent/${encodeURIComponent(agent.id)}`)}
            className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-b-0 cursor-pointer group"
        >
            <div className={`w-1 h-10 rounded-full flex-shrink-0 ${agent.risk === 'critical' ? 'bg-rose-500' : 'bg-red-400'}`} />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-bold text-slate-800 truncate">{agent.name}</p>
                    <RiskBadge level={agent.risk} />
                </div>
                <p className="text-[11px] text-slate-500 truncate">{agent.desc}</p>
                {agent.app && <p className="text-[11px] text-rose-600 font-medium mt-0.5 truncate">⚠ {agent.app}</p>}
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <Sparkline values={agent.trend} up={agent.trendDir === 'up' ? true : agent.trendDir === 'down' ? false : undefined} />
                <TrendChip dir={agent.trendDir} />
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className="text-[11px] text-slate-400 font-medium bg-slate-100 px-2 py-0.5 rounded-full">{agent.env}</span>
                <ArrowRight size={14} className="text-slate-300 group-hover:text-blue-500 transition-colors" />
            </div>
        </div>
    );
};

const HitlQueueCard: React.FC<{ items: QueueItem[] }> = ({ items }) => (
    <div className="bg-white rounded-2xl border border-red-100 shadow-sm overflow-hidden flex flex-col relative">
        <div className="absolute top-0 left-0 w-1.5 h-full bg-red-600 rounded-l-2xl" />
        <div className="pl-5 pr-5 py-3.5 border-b border-red-50 bg-red-50/45 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 bg-white rounded-lg border border-red-100 shadow-sm">
                    <Zap size={15} className="text-red-500" />
                </div>
                <div className="min-w-0">
                    <p className="font-black text-slate-800 text-sm leading-tight truncate">HITL Escalation Queue</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">Open human-in-the-loop decisions (Stage 5.4)</p>
                </div>
            </div>
            <span className="text-2xl font-black text-red-600 tabular-nums">{items.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto max-h-[340px]">
            {items.length === 0 ? (
                <EmptyState label="No open HITL or pending review statuses found" />
            ) : (
                items.map(item => <HitlRow key={item.id} item={item} />)
            )}
        </div>
    </div>
);

const HitlRow: React.FC<{ item: QueueItem }> = ({ item }) => {
    const status = displayQueueStatus(item.status);
    return (
        <div className="flex items-start gap-3 px-5 py-3.5 hover:bg-red-50/20 transition-colors border-b border-slate-100 last:border-b-0">
            <SeverityDot level={item.severity} />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                    <p className="text-sm font-black text-slate-800 truncate">{item.agent}</p>
                    <SeverityBadge level={item.severity} />
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 truncate">{item.trigger}</p>
            </div>
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0 pt-0.5">
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold leading-none ${statusPillClass(status)}`}>
                    {status}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 font-medium leading-none">
                    <Clock size={10} />
                    {item.age}
                </span>
            </div>
        </div>
    );
};

const CompanyProfileCard: React.FC<{
    sections: ProfileSection[];
    profilePct: number;
    gaps: ProfileGap[];
    refreshes: ResearchRefresh[];
}> = ({ sections, profilePct, gaps, refreshes }) => {
    const barColor = (status: string) => status === 'pass' ? 'bg-emerald-500' : status === 'warn' ? 'bg-amber-400' : 'bg-red-400';
    const pctColor = (status: string) => status === 'pass' ? 'text-emerald-600' : status === 'warn' ? 'text-amber-600' : 'text-red-500';
    const gapDot = (severity: string) => severity === 'high' ? 'bg-red-500' : severity === 'medium' ? 'bg-amber-400' : 'bg-slate-400';

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden relative">
            <div className="absolute top-0 left-0 w-1.5 h-full bg-teal-500 rounded-l-2xl" />
            <div className="pl-5 pr-5 py-4 border-b border-slate-100 bg-teal-50/40 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-teal-100 rounded-lg border border-teal-200">
                        <Building2 size={16} className="text-teal-600" />
                    </div>
                    <div>
                        <p className="font-bold text-slate-800 text-sm leading-tight">Company Profile Health</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">Setup completion, gaps & deep research freshness</p>
                    </div>
                </div>
                <div className="text-right">
                    <p className="text-2xl font-black text-teal-700 tabular-nums leading-none">{profilePct}%</p>
                    <p className="text-[10px] text-teal-600 font-bold lowercase mt-0.5">complete</p>
                </div>
            </div>

            <div className="px-5 py-4">
                <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4">Setup Completion</p>
                {sections.length === 0 ? (
                    <EmptyState label="No company blueprint selected" />
                ) : (
                    <div className="space-y-3.5">
                        {sections.map(s => (
                            <div key={s.label} className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-4">
                                <div className="flex items-center gap-2 min-w-0">
                                    <StatusIcon status={s.status} />
                                    <span className="text-sm font-semibold text-slate-600 truncate text-left">{s.label}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                        <div className={`h-full rounded-full ${barColor(s.status)}`} style={{ width: `${s.pct}%` }} />
                                    </div>
                                    <span className={`w-9 text-right text-xs font-black tabular-nums ${pctColor(s.status)}`}>{s.pct}%</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <div className="border-t border-slate-100 mt-5 pt-4">
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3">
                        Gaps Recognized <span className="text-red-500 ml-1">{gaps.length}</span>
                    </p>
                    <div className="space-y-3">
                        {gaps.length === 0 ? (
                            <p className="text-xs text-slate-400">No profile gaps detected from current blueprint categories.</p>
                        ) : (
                            gaps.slice(0, 4).map(g => (
                                <div key={g.id} className="flex items-start gap-2.5">
                                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1 ${gapDot(g.severity)}`} />
                                    <div className="min-w-0">
                                        <p className="text-sm text-slate-700 font-medium leading-tight">{g.gap}</p>
                                        <p className="text-[11px] text-slate-400 font-semibold mt-0.5">{g.area}</p>
                                    </div>
                                </div>
                            ))
                        )}
                        {gaps.length > 4 && (
                            <p className="text-[11px] text-slate-400 font-semibold ml-5">+{gaps.length - 4} more gaps</p>
                        )}
                    </div>
                </div>

                <div className="border-t border-slate-100 mt-5 pt-4">
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3">Last Deep Research Refresh</p>
                    <div className="space-y-3">
                        {refreshes.length === 0 ? (
                            <p className="text-xs text-slate-400">No blueprint updates available.</p>
                        ) : refreshes.slice(0, 4).map(r => (
                            <div key={r.id} className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 min-w-0">
                                    <Search size={12} className={r.stale ? 'text-red-400' : 'text-teal-400'} />
                                    <span className="text-sm font-semibold text-slate-600 truncate">{r.section}</span>
                                </div>
                                <span className={`text-[11px] font-black px-3 py-1 rounded-full border flex-shrink-0 ${r.stale ? 'bg-red-50 text-red-500 border-red-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
                                    {r.lastRefresh}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

const GateRow: React.FC<{ item: GateItem }> = ({ item }) => (
    <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-b-0 cursor-pointer group">
        <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-800 truncate mb-0.5">{item.agent}</p>
            <p className="text-[11px] text-slate-500 truncate">Awaiting: <span className="font-medium text-slate-600">{item.gate}</span></p>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${item.envBg} ${item.envText}`}>{item.env}</span>
            <span className="text-[10px] text-slate-400 flex items-center gap-0.5"><Clock size={9} /> {item.days}d waiting</span>
        </div>
    </div>
);

const AutonomyCard: React.FC<{ totalAgents: number; data: AutonomyDatum[] }> = ({ totalAgents, data }) => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col relative">
        <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-500 rounded-l-2xl" />
        <div className="pl-5 pr-5 py-4 border-b border-slate-100 bg-indigo-50/40 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 bg-indigo-100 rounded-lg border border-indigo-200">
                    <Users size={16} className="text-indigo-600" />
                </div>
                <div className="min-w-0">
                    <p className="font-bold text-slate-800 text-sm leading-tight truncate">Autonomy Distribution</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">Portfolio breakdown by autonomy level (Stage 2.2)</p>
                </div>
            </div>
            <span className="text-2xl font-black text-indigo-700 tabular-nums">{totalAgents}</span>
        </div>
        <div className="px-5 py-5 flex flex-col gap-4">
            {totalAgents === 0 ? (
                <EmptyState label="No agents available" />
            ) : (
                <>
                    <div className="flex rounded-full overflow-hidden h-2.5 gap-0.5">
                        {data.map(a => <div key={a.label} className={`${a.color}`} style={{ width: `${a.pct}%` }} title={`${a.label}: ${a.pct}%`} />)}
                    </div>
                    {data.map(a => (
                        <div key={a.label} className="grid grid-cols-[12px_minmax(0,1fr)_42px] items-start gap-3">
                            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 ${a.color}`} />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-sm font-black text-slate-700">{a.label}</span>
                                    <span className={`text-xs font-black tabular-nums ${a.text}`}>{a.count} agents</span>
                                </div>
                                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                    <div className={`${a.color} h-full rounded-full`} style={{ width: `${a.pct}%` }} />
                                </div>
                                <p className="text-[10px] text-slate-400 font-semibold mt-1">{a.desc}</p>
                            </div>
                            <span className="text-sm font-black text-slate-500 tabular-nums text-right mt-6">{a.pct}%</span>
                        </div>
                    ))}
                </>
            )}
        </div>
    </div>
);

const CategoryDistributionCard: React.FC<{
    title: string;
    subtitle: string;
    total: number;
    data: DistributionDatum[];
    accent: string;
    headerBg: string;
    totalClass: string;
    icon: React.ReactNode;
    emptyLabel: string;
}> = ({ title, subtitle, total, data, accent, headerBg, totalClass, icon, emptyLabel }) => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col relative">
        <div className={`absolute top-0 left-0 w-1.5 h-full ${accent} rounded-l-2xl`} />
        <div className={`pl-5 pr-5 py-4 border-b border-slate-100 ${headerBg} flex items-center justify-between gap-3`}>
            <div className="flex items-center gap-2.5 min-w-0">
                {icon}
                <div className="min-w-0">
                    <p className="font-bold text-slate-800 text-sm leading-tight truncate">{title}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">{subtitle}</p>
                </div>
            </div>
            <span className={`text-2xl font-black tabular-nums ${totalClass}`}>{total}</span>
        </div>
        <div className="px-5 py-5 flex flex-col gap-4">
            {total === 0 || data.length === 0 ? (
                <EmptyState label={emptyLabel} />
            ) : (
                <>
                    <div className="flex rounded-full overflow-hidden h-2.5 gap-0.5">
                        {data.map(d => (
                            <div key={d.label} className={d.color} style={{ width: `${d.pct}%` }} title={`${d.label}: ${d.count}`} />
                        ))}
                    </div>
                    <div className="space-y-3.5">
                        {data.map(d => (
                            <div key={d.label} className="grid grid-cols-[12px_minmax(0,1fr)_54px] items-center gap-3">
                                <span className={`w-2.5 h-2.5 rounded-full ${d.color}`} />
                                <div className="min-w-0">
                                    <div className="flex items-center justify-between gap-3 mb-1.5">
                                        <span className="text-sm font-black text-slate-700 truncate">{d.label}</span>
                                        <span className={`text-xs font-black tabular-nums flex-shrink-0 ${d.text}`}>{d.count} agents</span>
                                    </div>
                                    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                        <div className={`${d.color} h-full rounded-full`} style={{ width: `${d.pct}%` }} />
                                    </div>
                                </div>
                                <span className="text-sm font-black text-slate-500 tabular-nums text-right">{d.pct}%</span>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    </div>
);

const SuccessMetricsCard: React.FC<{ metrics: SuccessMetric[] }> = ({ metrics }) => {
    const pass = metrics.filter(m => m.status === 'pass').length;
    const warn = metrics.filter(m => m.status === 'warn').length;
    const fail = metrics.filter(m => m.status === 'fail').length;
    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden relative">
            <div className="absolute top-0 left-0 w-1.5 h-full bg-cyan-500 rounded-l-2xl" />
            <div className="pl-5 pr-5 py-4 border-b border-slate-100 bg-cyan-50/40 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-cyan-100 rounded-lg border border-cyan-200">
                        <Target size={16} className="text-cyan-600" />
                    </div>
                    <div>
                        <p className="font-bold text-slate-800 text-sm leading-tight">Success Metrics Health</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">KPI vs baseline - agents in Monitor stage (Stage 1.5 + 5.5)</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full"><CheckCircle2 size={10} />{pass} On Track</span>
                    <span className="flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full"><AlertCircle size={10} />{warn} Near Threshold</span>
                    <span className="flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full"><XCircle size={10} />{fail} Below Target</span>
                </div>
            </div>
            <div className="overflow-x-auto">
                {metrics.length === 0 ? (
                    <EmptyState label="No assessed agents with risk scores yet" />
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-100 bg-slate-50/50">
                                <th className="text-left px-5 py-3 text-[11px] font-black text-slate-400 uppercase tracking-wide">Agent</th>
                                <th className="text-left px-4 py-3 text-[11px] font-black text-slate-400 uppercase tracking-wide">KPI</th>
                                <th className="text-right px-4 py-3 text-[11px] font-black text-slate-400 uppercase tracking-wide">Value</th>
                                <th className="text-right px-4 py-3 text-[11px] font-black text-slate-400 uppercase tracking-wide">Target</th>
                                <th className="text-center px-4 py-3 text-[11px] font-black text-slate-400 uppercase tracking-wide">7-Day Trend</th>
                                <th className="text-center px-4 py-3 text-[11px] font-black text-slate-400 uppercase tracking-wide">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {metrics.map((m, i) => (
                                <tr key={m.id} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${i === metrics.length - 1 ? 'border-b-0' : ''}`}>
                                    <td className="px-5 py-4"><p className="font-black text-slate-800 text-sm">{m.agent}</p></td>
                                    <td className="px-4 py-4"><p className="text-[12px] text-slate-500 font-medium">{m.kpi}</p></td>
                                    <td className="px-4 py-3 text-right"><span className={`text-sm font-black tabular-nums ${m.status === 'pass' ? 'text-emerald-700' : m.status === 'warn' ? 'text-amber-700' : 'text-red-700'}`}>{m.value}</span></td>
                                    <td className="px-4 py-3 text-right"><span className="text-[12px] text-slate-400 font-black">{m.target}</span></td>
                                    <td className="px-4 py-3"><div className="flex justify-center"><Sparkline values={m.trend} up={m.status === 'fail' ? true : m.status === 'pass' ? false : undefined} /></div></td>
                                    <td className="px-4 py-3 text-center"><StatusIcon status={m.status} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

// ── Mapping helpers: merge server payload onto color templates ────────────────

const mergeStages = (template: Omit<StageDatum, 'count'>[], counts: StageCount[]): StageDatum[] => {
    const map = new Map(counts.map(c => [c.stage, c.count]));
    return template.map(t => ({ ...t, count: map.get(t.stage) ?? 0 }));
};

const mergeDistribution = (
    buckets: { label: string; color: string; text: string }[],
    dist: LabelDistribution[],
): DistributionDatum[] => {
    const map = new Map(dist.map(d => [d.label, d]));
    return buckets.map(b => ({ ...b, count: map.get(b.label)?.count ?? 0, pct: map.get(b.label)?.pct ?? 0 }));
};

const mergeAutonomy = (dist: LabelDistribution[]): AutonomyDatum[] => {
    const map = new Map(dist.map(d => [d.label, d]));
    return AUTONOMY_BUCKETS.map(b => ({ ...b, count: map.get(b.label)?.count ?? 0, pct: map.get(b.label)?.pct ?? 0 }));
};

const toRiskAgentRow = (a: InsightsRiskAgent): RiskAgent => ({
    id: a.id,
    name: a.name,
    desc: a.desc,
    risk: a.risk,
    env: a.env,
    app: a.app,
    trend: makeTrend(a.riskScore),
    trendDir: a.trendDir,
});

const InsightsPage: React.FC = () => {
    const [data, setData] = useState<InsightsSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const companyId = localStorage.getItem('tavro_active_company_id') ?? undefined;
            const summary = await insightsApi.getSummary(companyId);
            setData(summary);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load insights');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const totals = data?.totals;
    const totalAgents = totals?.totalAgents ?? 0;
    const totalUseCases = totals?.totalUseCases ?? 0;
    const criticalCount = totals?.criticalCount ?? 0;
    const highRiskCount = totals?.highRiskCount ?? 0;

    const agentDistribution = mergeStages(AGENT_STAGE_TEMPLATE, data?.agentLifecycle ?? []);
    const useCaseDistribution = mergeStages(USECASE_STAGE_TEMPLATE, data?.useCaseLifecycle ?? []);
    const providerDistribution = mergeDistribution(PROVIDER_BUCKETS, data?.providerDistribution ?? []);
    const blendedRiskDistribution = mergeDistribution(RISK_BUCKETS, data?.blendedRiskDistribution ?? []);
    const autonomyDistribution = mergeAutonomy(data?.autonomyDistribution ?? []);
    const productionRiskAgents = (data?.productionRiskAgents ?? []).map(toRiskAgentRow);
    const developmentRiskAgents = (data?.developmentRiskAgents ?? []).map(toRiskAgentRow);
    const hitlEscalations: QueueItem[] = data?.hitlEscalations ?? [];
    const stageGateBlockers: GateItem[] = (data?.stageGateBlockers ?? []).map(g => {
        const template = AGENT_STAGE_TEMPLATE.find(t => t.stage === g.stage) ?? AGENT_STAGE_TEMPLATE[0];
        const envStyle = envBadge(g.env);
        return {
            id: g.id,
            agent: g.agent,
            gate: g.gate,
            stage: g.stage,
            stageText: template.text,
            stageBg: template.light,
            env: g.env,
            envText: envStyle.text,
            envBg: envStyle.bg,
            days: g.days,
        };
    });
    const successMetrics: SuccessMetric[] = data?.successMetrics ?? [];
    const profile = data?.companyProfile;
    const profileSections: ProfileSection[] = profile?.sections ?? [];
    const profileGaps: ProfileGap[] = profile?.gaps ?? [];
    const profileRefreshes: ResearchRefresh[] = profile?.refreshes ?? [];
    const profileOverallPct = profile?.overallPct ?? 0;

    return (
        <div className="flex flex-col gap-6 w-full animate-fade-in max-w-[1200px] mx-auto">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1.5 h-full bg-blue-600 rounded-l-2xl" />
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-5 pl-2">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
                            <Lightbulb size={22} className="text-blue-600" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Insights</h1>
                            <p className="text-slate-500 text-sm mt-0.5">Agent & usecase portfolio - risk, governance & performance</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest px-1">Portfolio</span>
                            <div className="flex items-center gap-2">
                                <div className="flex flex-col items-center bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 min-w-[68px]">
                                    <span className="text-xl font-black text-slate-700 tabular-nums">{totalAgents}</span>
                                    <span className="text-[11px] text-slate-500 font-medium mt-0.5">Agents</span>
                                </div>
                                <div className="flex flex-col items-center bg-sky-50 border border-sky-100 rounded-xl px-4 py-2 min-w-[68px]">
                                    <span className="text-xl font-black text-sky-700 tabular-nums">{totalUseCases}</span>
                                    <span className="text-[11px] text-sky-500 font-medium mt-0.5">Use Cases</span>
                                </div>
                            </div>
                        </div>
                        <div className="w-px h-12 bg-slate-200 mx-1 flex-shrink-0" />
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest px-1">Agent Alerts</span>
                            <div className="flex items-center gap-2">
                                <div className="flex flex-col items-center bg-rose-50 border border-rose-100 rounded-xl px-4 py-2 min-w-[68px]">
                                    <span className="text-xl font-black text-rose-700 tabular-nums">{criticalCount}</span>
                                    <span className="text-[11px] text-rose-500 font-medium mt-0.5">Critical</span>
                                </div>
                                <div className="flex flex-col items-center bg-red-50 border border-red-100 rounded-xl px-4 py-2 min-w-[68px]">
                                    <span className="text-xl font-black text-red-700 tabular-nums">{highRiskCount}</span>
                                    <span className="text-[11px] text-red-500 font-medium mt-0.5">High Risk</span>
                                </div>
                                <div className="flex flex-col items-center bg-amber-50 border border-amber-100 rounded-xl px-4 py-2 min-w-[68px]">
                                    <span className="text-xl font-black text-amber-700 tabular-nums">{hitlEscalations.length}</span>
                                    <span className="text-[11px] text-amber-500 font-medium mt-0.5">HITL Open</span>
                                </div>
                            </div>
                        </div>
                        <div className="w-px h-12 bg-slate-200 mx-1 flex-shrink-0" />
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest px-1">Company Profile</span>
                            <div className="flex items-center gap-2">
                                <div className="flex flex-col items-center bg-teal-50 border border-teal-100 rounded-xl px-4 py-2 min-w-[68px]">
                                    <span className="text-xl font-black text-teal-700 tabular-nums">{profileOverallPct}%</span>
                                    <span className="text-[11px] text-teal-500 font-medium mt-0.5">Complete</span>
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={load}
                            disabled={loading}
                            className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 hover:bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 transition-colors ml-1 self-end mb-0.5 disabled:opacity-60"
                        >
                            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
                        </button>
                    </div>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm">
                    <AlertTriangle size={16} className="shrink-0" /> {error}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                <LifecycleDistribution
                    title="Agent Lifecycle Distribution"
                    subtitle="Agent portfolio across all 5 lifecycle stages"
                    totalClass="text-slate-700"
                    accent="bg-slate-400"
                    icon={<div className="p-2 bg-slate-100 rounded-lg border border-slate-200"><GitBranch size={16} className="text-slate-600" /></div>}
                    data={agentDistribution}
                />
                <LifecycleDistribution
                    title="Use Case Lifecycle Distribution"
                    subtitle="AI use cases tracked from idea to live"
                    totalClass="text-sky-700"
                    accent="bg-sky-500"
                    icon={<div className="p-2 bg-sky-100 rounded-lg border border-sky-200"><Layers size={16} className="text-sky-600" /></div>}
                    data={useCaseDistribution}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                <CategoryDistributionCard
                    title="Agents by Provider"
                    subtitle="Distribution of agents by provider organization"
                    total={totalAgents}
                    data={providerDistribution}
                    accent="bg-purple-500"
                    headerBg="bg-purple-50/40"
                    totalClass="text-purple-700"
                    icon={
                        <div className="p-2 bg-purple-100 rounded-lg border border-purple-200">
                            <Building2 size={16} className="text-purple-600" />
                        </div>
                    }
                    emptyLabel="No provider information available"
                />

                <CategoryDistributionCard
                    title="Agents by Blended Risk Classification"
                    subtitle="Portfolio distribution by blended risk level"
                    total={blendedRiskDistribution.reduce((sum, d) => sum + d.count, 0)}
                    data={blendedRiskDistribution}
                    accent="bg-red-500"
                    headerBg="bg-red-50/40"
                    totalClass="text-red-700"
                    icon={
                        <div className="p-2 bg-red-100 rounded-lg border border-red-200">
                            <BarChart3 size={16} className="text-red-600" />
                        </div>
                    }
                    emptyLabel="No blended risk classifications available"
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                <CardShell
                    accent="bg-rose-500"
                    headerBg="bg-rose-50/60"
                    icon={<ShieldAlert size={20} className="text-rose-600" />}
                    title="Critical & High Risk in Production"
                    subtitle="Agents requiring immediate attention"
                    badge={<span className="text-2xl font-black text-red-600 tabular-nums">{productionRiskAgents.length}</span>}
                >
                    {productionRiskAgents.length === 0 ? <EmptyState label="No critical or high-risk production agents found" /> : productionRiskAgents.map(a => <RiskAgentRow key={a.id} agent={a} />)}
                </CardShell>

                <CardShell
                    accent="bg-amber-500"
                    headerBg="bg-amber-50/60"
                    icon={<FlameKindling size={20} className="text-amber-600" />}
                    title="High Risk Agents Under Development"
                    subtitle="Risky agents in non-production environments"
                    badge={<span className="text-2xl font-black text-amber-600 tabular-nums">{developmentRiskAgents.length}</span>}
                >
                    {developmentRiskAgents.length === 0 ? <EmptyState label="No high-risk agents found in development or staging" /> : developmentRiskAgents.map(a => <RiskAgentRow key={a.id} agent={a} />)}
                </CardShell>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                <HitlQueueCard items={hitlEscalations} />

                <CompanyProfileCard sections={profileSections} profilePct={profileOverallPct} gaps={profileGaps} refreshes={profileRefreshes} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                <CardShell
                    accent="bg-amber-500"
                    headerBg="bg-amber-50/60"
                    icon={<AlertTriangle size={20} className="text-amber-600" />}
                    title="Stage Gate Blockers"
                    subtitle="Agents awaiting sign-off at lifecycle gates"
                    badge={<span className="text-2xl font-black text-amber-600 tabular-nums">{stageGateBlockers.length}</span>}
                >
                    {stageGateBlockers.length === 0 ? <EmptyState label="No agents awaiting stage-gate sign-off" /> : stageGateBlockers.map(g => <GateRow key={g.id} item={g} />)}
                </CardShell>

                <AutonomyCard totalAgents={totalAgents} data={autonomyDistribution} />
            </div>

            <SuccessMetricsCard metrics={successMetrics} />
        </div>
    );
};

export default InsightsPage;
