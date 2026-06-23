import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Bot,
    ChevronRight,
    Search,
    CheckCircle2,
    ClipboardList,
    LayoutGrid,
    List
} from 'lucide-react';
import { readRoadmapConfig } from '../services/roadmapConfig';

interface UseCaseCatalogProps {
    useCases: any[];
    searchTerm: string;
    onSearchChange: (term: string) => void;
    currentPage?: number;
}

const USE_CASE_AGENT_COUNT_CACHE_KEY = 'tavro_use_case_agent_count_cache';

const UseCaseCatalog: React.FC<UseCaseCatalogProps> = ({
    useCases,
    searchTerm,
    onSearchChange,
    currentPage = 1,
}) => {
    const navigate = useNavigate();
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

    const parseCount = (value: unknown): number | null => {
        if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
        if (typeof value === 'string') {
            const parsed = Number.parseInt(value, 10);
            return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
        }
        return null;
    };

    const getRelatedAgentCount = (uc: any): number => {
        const counts: number[] = [];
        const listFields = [
            uc?.agents,
            uc?.of_associated_agents,
            uc?.agent_cards,
            uc?.ai_agents,
            uc?.related_agents,
        ];
        listFields.forEach(list => {
            if (Array.isArray(list)) counts.push(list.length);
        });

        const numericFields = [
            uc?.related_agent_count,
            uc?.num_of_associated_agents,
            uc?.associated_agent_count,
            uc?.agent_count,
            uc?.num_agents,
            uc?.associated_count,
        ];
        numericFields.forEach(value => {
            const parsed = parseCount(value);
            if (parsed !== null) counts.push(parsed);
        });

        const useCaseKey = String(uc?.identifier ?? uc?.id ?? '').trim();
        if (useCaseKey) {
            try {
                const raw = sessionStorage.getItem(USE_CASE_AGENT_COUNT_CACHE_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw) as Record<string, unknown>;
                    const cached = parseCount(parsed[useCaseKey]);
                    if (cached !== null) counts.push(cached);
                }
            } catch {
                // Ignore cache parsing errors.
            }
        }

        return counts.length ? Math.max(...counts) : 0;
    };

    const getUseCaseSummary = (uc: any): string => {
        return uc.description
            || uc.business_case
            || uc.businessImpact
            || uc.problem_statement
            || uc.expected_benefits
            || 'No description provided for this use case.';
    };

    type PriorityTone = 'critical' | 'high' | 'moderate' | 'low' | 'planning' | 'unknown';

    const getPriorityTone = (priority?: string | null): PriorityTone => {
        const p = String(priority ?? '').toLowerCase().trim();
        if (!p) return 'unknown';
        if (p.startsWith('1') || p.includes('critical')) return 'critical';
        if (p.startsWith('2') || p.includes('high')) return 'high';
        if (p.startsWith('3') || p.includes('moderate') || p.includes('medium')) return 'moderate';
        if (p.startsWith('4') || p.includes('low')) return 'low';
        if (p.startsWith('5') || p.includes('planning') || p.includes('plan')) return 'planning';
        return 'unknown';
    };

    const getPriorityTheme = (tone: PriorityTone) => {
        switch (tone) {
            case 'critical':
                return { bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-400', border: 'border-red-100 dark:border-red-800/50' };
            case 'high':
                return { bg: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-700 dark:text-orange-400', border: 'border-orange-100 dark:border-orange-800/50' };
            case 'moderate':
                return { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-100 dark:border-amber-800/50' };
            case 'low':
                return { bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-100 dark:border-emerald-800/50' };
            case 'planning':
                return { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400', border: 'border-slate-200 dark:border-slate-700' };
            default:
                return { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400', border: 'border-slate-200 dark:border-slate-700' };
        }
    };

    const getStatusStyle = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'live': return 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800/50';
            case 'proposed': return 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-100 dark:border-blue-800/50';
            default: return 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700';
        }
    };

    const cfg = React.useMemo(() => readRoadmapConfig(), []);

    const computeScores = (uc: any) => {
        const pvBV: number | null = uc.pv_business_value_score ?? null;
        const pvDR: number | null = uc.pv_data_readiness_score ?? null;
        const pvTC: number | null = uc.pv_technical_complexity_score ?? null;

        const riskFields: Record<string, string> = {
            data_privacy: 'risk_data_privacy_score',
            operational: 'risk_operational_score',
            compliance: 'risk_compliance_score',
            ai_behavioral: 'risk_ai_behavioral_score',
            strategic_reputational: 'risk_strategic_reputational_score',
        };
        const rw = cfg.riskWeights as unknown as Record<string, number>;
        const riskEntries = Object.entries(riskFields)
            .map(([key, field]) => [key, uc[field] ?? null] as [string, number | null])
            .filter(([, s]) => s !== null) as [string, number][];
        const wTotal = riskEntries.reduce((sum, [k]) => sum + (rw[k] ?? 20), 0);
        const riskComposite: number | null = uc.risk_composite_score ?? (riskEntries.length > 0 && wTotal > 0
            ? +(riskEntries.reduce((sum, [k, s]) => sum + s * (rw[k] ?? 20), 0) / wTotal).toFixed(2)
            : null);

        const pw = cfg.priorityWeights;
        const priorityScore: number | null = uc.priority_score ??
            (pvBV !== null && pvDR !== null && pvTC !== null && riskComposite !== null
                ? +((pvBV * pw.BV) + (pvDR * pw.DR) + ((6 - pvTC) * pw.TC) - (riskComposite * pw.RISK)).toFixed(2)
                : null);

        // Contribution points per dimension
        const contribBV: number | null = pvBV !== null ? +(pvBV * pw.BV).toFixed(2) : null;
        const contribDR: number | null = pvDR !== null ? +(pvDR * pw.DR).toFixed(2) : null;
        const contribTC: number | null = pvTC !== null ? +((6 - pvTC) * pw.TC).toFixed(2) : null;
        const contribRisk: number | null = riskComposite !== null ? +(-(riskComposite * pw.RISK)).toFixed(2) : null;

        let quadrant: { label: string; color: string } | null = null;
        if (pvTC !== null && riskComposite !== null) {
            const highCost = pvTC > 3;
            const highRisk = riskComposite > 3;
            if (!highCost && !highRisk) quadrant = { label: 'Quick Win', color: '#1D7A4A' };
            else if (!highCost && highRisk) quadrant = { label: 'Fill-in',   color: '#B85C00' };
            else if (highCost && !highRisk) quadrant = { label: 'Big Bet',   color: '#5C2D8A' };
            else                            quadrant = { label: 'Money Pit', color: '#A32D2D' };
        }

        return { pvBV, pvDR, pvTC, riskComposite, priorityScore, quadrant, contribBV, contribDR, contribTC, contribRisk };
    };

    const metricDotColor = (value: number | null, positiveScale: boolean): string => {
        if (value === null) return 'bg-slate-200';
        if (positiveScale) {
            if (value >= 4) return 'bg-emerald-500';
            if (value >= 2.5) return 'bg-amber-400';
            return 'bg-red-400';
        } else {
            if (value <= 2) return 'bg-emerald-500';
            if (value <= 3.5) return 'bg-amber-400';
            return 'bg-red-400';
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'live': return <CheckCircle2 size={12} />;
            case 'proposed': return <ClipboardList size={12} />;
            default: return <Bot size={12} />;
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={18} />
                    <input
                        type="text"
                        placeholder="Search AI use cases..."
                        value={searchTerm}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-slate-800 dark:text-slate-100"
                    />
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest hidden sm:block">
                        Showing {useCases.length} Results
                    </div>
                    <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={`p-1.5 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                            title="Grid View"
                        >
                            <LayoutGrid size={18} />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`p-1.5 rounded-lg transition-all ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                            title="List View"
                        >
                            <List size={18} />
                        </button>
                    </div>
                </div>
            </div>

            {viewMode === 'grid' ? (
                <div
                    key={searchTerm ? 'search-grid' : 'paged-grid'}
                    className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
                >
                    {useCases.map(uc => {
                        const relatedAgentCount = getRelatedAgentCount(uc);
                        const summary = getUseCaseSummary(uc);
                        const cardId = String(uc.id ?? uc.identifier ?? 'N/A').slice(0, 8);
                        const { pvBV, pvDR, pvTC, riskComposite, priorityScore, quadrant, contribBV, contribDR, contribTC, contribRisk } = computeScores(uc);
                        const hasAnyScore = pvBV !== null || pvDR !== null || pvTC !== null || riskComposite !== null;
                        const navId = uc.identifier ?? uc.id;

                        const scoreBg = priorityScore === null ? 'bg-slate-50 border-slate-200'
                            : priorityScore >= 3.5 ? 'bg-emerald-50 border-emerald-200'
                            : priorityScore >= 2.5 ? 'bg-amber-50 border-amber-200'
                            : 'bg-red-50 border-red-200';
                        const scoreValueColor = priorityScore === null ? 'text-slate-400'
                            : priorityScore >= 3.5 ? 'text-emerald-700'
                            : priorityScore >= 2.5 ? 'text-amber-700'
                            : 'text-red-700';
                        const qMap: Record<string, { bg: string; border: string; value: string }> = {
                            'Quick Win': { bg: 'bg-emerald-50', border: 'border-emerald-200', value: 'text-emerald-700' },
                            'Fill-in':   { bg: 'bg-orange-50',  border: 'border-orange-200',  value: 'text-orange-700' },
                            'Big Bet':   { bg: 'bg-violet-50',  border: 'border-violet-200',  value: 'text-violet-700' },
                            'Money Pit': { bg: 'bg-red-50',     border: 'border-red-200',     value: 'text-red-700'    },
                        };
                        const qStyle = quadrant ? (qMap[quadrant.label] ?? { bg: 'bg-slate-50', border: 'border-slate-200', value: 'text-slate-700' }) : null;

                        return (
                            <div
                                key={uc.identifier ?? uc.id}
                                onClick={() => navId ? navigate(`/use-case/${navId}`, { state: { fromUseCasePage: true, page: currentPage } }) : undefined}
                                className="group bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-lg hover:border-blue-400 dark:hover:border-blue-700 transition-all cursor-pointer overflow-hidden flex flex-col h-full"
                            >
                                <div className="h-2 bg-gradient-to-r from-blue-500 to-indigo-600" />

                                <div className="p-5 flex-1 flex flex-col">
                                    {/* Top row: icon + agent count + score chips */}
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="p-2 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl group-hover:scale-110 transition-transform">
                                            <ClipboardList size={24} />
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            {/* Priority Score chip */}
                                            {priorityScore !== null ? (
                                                <div className={`flex flex-col items-center justify-center w-[88px] h-[46px] rounded-xl border gap-0.5 ${scoreBg}`}>
                                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider leading-none whitespace-nowrap">Priority Score</span>
                                                    <span className={`text-sm font-black leading-none ${scoreValueColor}`}>{priorityScore.toFixed(1)}</span>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center justify-center w-[88px] h-[46px] gap-0.5">
                                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider leading-none whitespace-nowrap">Priority Score</span>
                                                    <span className="text-sm text-slate-400 font-normal leading-none">—</span>
                                                </div>
                                            )}
                                            {/* Quadrant chip */}
                                            {quadrant ? (
                                                <div className={`flex flex-col items-center justify-center w-[88px] h-[46px] rounded-xl border gap-0.5 ${qStyle ? `${qStyle.bg} ${qStyle.border}` : 'bg-slate-50 border-slate-200'}`}>
                                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider leading-none">Quadrant</span>
                                                    <span className={`text-[10px] font-black leading-none text-center ${qStyle ? qStyle.value : 'text-slate-400'}`}>{quadrant.label}</span>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center justify-center w-[88px] h-[46px] gap-0.5">
                                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider leading-none">Quadrant</span>
                                                    <span className="text-sm text-slate-400 font-normal leading-none">—</span>
                                                </div>
                                            )}
                                            {/* Agent count */}
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-800 px-2 py-0.5 rounded-full">
                                                <Bot size={12} />{relatedAgentCount}
                                            </span>
                                        </div>
                                    </div>

                                    <h3 className="font-bold text-slate-800 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-1 mb-1">
                                        {uc.name}
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed mb-4 flex-1">
                                        {summary}
                                    </p>

                                    {/* Metric pills row */}
                                    <div className="flex items-center gap-1.5 mt-auto flex-wrap">
                                        {([
                                            { key: 'Business Value',  contrib: contribBV   },
                                            { key: 'Data Readiness',  contrib: contribDR   },
                                            { key: 'Tech Complexity', contrib: contribTC   },
                                            { key: 'Risk',            contrib: contribRisk },
                                        ] as { key: string; contrib: number | null }[]).map(m => (
                                            <div key={m.key} className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-md">
                                                <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400">{m.key}</span>
                                                {m.contrib !== null ? (
                                                    <span className={`text-[9px] font-black ${m.contrib >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                                        {m.contrib >= 0 ? '+' : ''}{m.contrib.toFixed(2)}
                                                    </span>
                                                ) : (
                                                    <span className="text-[9px] text-slate-400 font-normal">—</span>
                                                )}
                                            </div>
                                        ))}
                                        {!hasAnyScore && (
                                            <span className="text-[9px] text-slate-400 italic">No scores yet</span>
                                        )}
                                    </div>
                                </div>

                                <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${getStatusStyle(uc.status)}`}>
                                        {getStatusIcon(uc.status)}
                                        {uc.status || 'Proposed'}
                                    </span>
                                    <ChevronRight size={14} className="text-slate-400 dark:text-slate-500 group-hover:translate-x-1 transition-transform" />
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
                    <div className="grid grid-cols-[1.5fr_0.8fr_100px_0.8fr_80px_110px_120px_120px_140px_80px_40px] items-center bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 px-6 py-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        <div>Use Case Name</div>
                        <div>Function</div>
                        <div>Status</div>
                        <div>Owner</div>
                        <div>Priority Score</div>
                        <div>Quadrant</div>
                        <div>Business Value</div>
                        <div>Data Readiness</div>
                        <div>Tech Complexity</div>
                        <div>Risk</div>
                        <div></div>
                    </div>
                    <div
                        key={searchTerm ? 'search-list' : 'paged-list'}
                        className="divide-y divide-slate-100 dark:divide-slate-800"
                    >
                        {useCases.map(uc => {
                            const relatedAgentCount = getRelatedAgentCount(uc);
                            const { priorityScore, quadrant, contribBV, contribDR, contribTC, contribRisk } = computeScores(uc);
                            const listNavId = uc.identifier ?? uc.id;
                            return (
                                <div
                                    key={uc.identifier ?? uc.id}
                                    onClick={() => listNavId ? navigate(`/use-case/${listNavId}`, { state: { fromUseCasePage: true, page: currentPage } }) : undefined}
                                    className="grid grid-cols-[1.5fr_0.8fr_100px_0.8fr_80px_110px_120px_120px_140px_80px_40px] items-center px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors group"
                                >
                                    <div className="flex flex-col gap-0.5 pr-4">
                                        <div className="font-bold text-slate-800 dark:text-slate-100 text-sm group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                                            {uc.name}
                                        </div>
                                        <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                                            {String(uc.id ?? uc.identifier ?? 'N/A').slice(0, 8)}
                                        </div>
                                        <span className="mt-1 inline-flex items-center gap-1 w-fit text-[10px] font-bold bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-800 px-2 py-0.5 rounded-full">
                                            <Bot size={10} />
                                            {relatedAgentCount} Agent{relatedAgentCount === 1 ? '' : 's'}
                                        </span>
                                    </div>
                                    <div className="text-sm text-slate-500 dark:text-slate-400 truncate pr-4">
                                        {uc.function || '—'}
                                    </div>
                                    <div>
                                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${getStatusStyle(uc.status)}`}>
                                            {getStatusIcon(uc.status)}
                                            {uc.status || 'Proposed'}
                                        </span>
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate pr-4">
                                        {uc.owner || 'Unassigned'}
                                    </div>
                                    {/* Score — value only */}
                                    <div className="flex items-center">
                                        {priorityScore !== null ? (() => {
                                            const s = priorityScore;
                                            const bg = s >= 3.5 ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                                : s >= 2.5 ? 'bg-amber-50 border-amber-200 text-amber-700'
                                                : 'bg-red-50 border-red-200 text-red-700';
                                            return (
                                                <span className={`text-sm font-black px-2.5 py-1 rounded-lg border ${bg}`}>
                                                    {s.toFixed(1)}
                                                </span>
                                            );
                                        })() : <span className="text-sm text-slate-400 font-normal">—</span>}
                                    </div>
                                    {/* Quadrant — value only */}
                                    <div className="flex items-center">
                                        {quadrant ? (() => {
                                            const qMap: Record<string, string> = {
                                                'Quick Win': 'bg-emerald-50 border-emerald-200 text-emerald-700',
                                                'Fill-in':   'bg-orange-50 border-orange-200 text-orange-700',
                                                'Big Bet':   'bg-violet-50 border-violet-200 text-violet-700',
                                                'Money Pit': 'bg-red-50 border-red-200 text-red-700',
                                            };
                                            const cls = qMap[quadrant.label] ?? 'bg-slate-50 border-slate-200 text-slate-700';
                                            return (
                                                <span className={`text-xs font-black px-2.5 py-1 rounded-lg border whitespace-nowrap ${cls}`}>
                                                    {quadrant.label}
                                                </span>
                                            );
                                        })() : <span className="text-sm text-slate-400 font-normal">—</span>}
                                    </div>
                                    {/* BV */}
                                    <div className="flex items-center">
                                        <span className={`text-xs ${contribBV !== null ? `font-black ${contribBV >= 0 ? 'text-emerald-600' : 'text-red-500'}` : 'text-slate-400 font-normal'}`}>
                                            {contribBV !== null ? `${contribBV >= 0 ? '+' : ''}${contribBV.toFixed(2)}` : '—'}
                                        </span>
                                    </div>
                                    {/* DR */}
                                    <div className="flex items-center">
                                        <span className={`text-xs ${contribDR !== null ? `font-black ${contribDR >= 0 ? 'text-emerald-600' : 'text-red-500'}` : 'text-slate-400 font-normal'}`}>
                                            {contribDR !== null ? `${contribDR >= 0 ? '+' : ''}${contribDR.toFixed(2)}` : '—'}
                                        </span>
                                    </div>
                                    {/* TC */}
                                    <div className="flex items-center">
                                        <span className={`text-xs ${contribTC !== null ? `font-black ${contribTC >= 0 ? 'text-emerald-600' : 'text-red-500'}` : 'text-slate-400 font-normal'}`}>
                                            {contribTC !== null ? `${contribTC >= 0 ? '+' : ''}${contribTC.toFixed(2)}` : '—'}
                                        </span>
                                    </div>
                                    {/* Risk */}
                                    <div className="flex items-center">
                                        <span className={`text-xs ${contribRisk !== null ? `font-black ${contribRisk >= 0 ? 'text-emerald-600' : 'text-red-500'}` : 'text-slate-400 font-normal'}`}>
                                            {contribRisk !== null ? `${contribRisk >= 0 ? '+' : ''}${contribRisk.toFixed(2)}` : '—'}
                                        </span>
                                    </div>
                                    <div className="flex justify-end pr-2 text-slate-300 dark:text-slate-600 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors">
                                        <ChevronRight size={18} className="transform group-hover:translate-x-1 transition-transform" />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {useCases.length === 0 && (
                <div className="py-20 flex flex-col items-center justify-center gap-4 text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800">
                    <div className="p-4 bg-white dark:bg-slate-800 rounded-full shadow-sm">
                        <Search size={32} className="text-slate-300 dark:text-slate-600" />
                    </div>
                    <p className="font-medium text-lg">No use cases found matching your criteria</p>
                </div>
            )}
        </div>
    );
};

export default UseCaseCatalog;
