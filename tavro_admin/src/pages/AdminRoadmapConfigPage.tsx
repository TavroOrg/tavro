import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
    Building2,
    TrendingUp, Clock, AlertTriangle,
    ShieldCheck, Activity, Scale, Brain, Target,
    CheckCircle2, AlertCircle, Loader2,
} from 'lucide-react';
import {
    getRoadmapConfig, saveRoadmapConfig,
    priorityWeightsSum, riskWeightsSum,
    DEFAULT_CONFIG, type RoadmapConfig, type VisibilityLevel,
} from '../services/roadmapConfigApi';

const STORAGE_ID_KEY   = 'tavro_active_company_id';
const STORAGE_NAME_KEY = 'tavro_active_company_name';

const COMING_SOON_BADGE =
    'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 whitespace-nowrap';

const RING_CIRCUMFERENCE = 2 * Math.PI * 18;

const VISIBILITY_OPTIONS: { key: VisibilityLevel; label: string }[] = [
    { key: 'public',       label: 'Public' },
    { key: 'internal',     label: 'Internal' },
    { key: 'restricted',   label: 'Restricted' },
    { key: 'confidential', label: 'Confidential' },
];

// ── Allocation badge — green "N% allocated" pill with a live dot, turns
// amber when the group's weights don't sum to 100%. ─────────────────────────
const AllocationBadge: React.FC<{ total: number }> = ({ total }) => {
    const ok = Math.abs(total - 100) < 0.1;
    return (
        <span
            className={`flex items-center gap-2 text-xs font-mono font-semibold px-3 py-1.5 rounded-full shrink-0 ${
                ok
                    ? 'bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-400'
                    : 'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400'
            }`}
        >
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            {total}% allocated
        </span>
    );
};

// ── Circular percentage gauge used on each weight tile. ──────────────────────
const RingGauge: React.FC<{ percent: number; color: string }> = ({ percent, color }) => (
    <div className="relative w-11 h-11 shrink-0">
        <svg width="44" height="44" className="-rotate-90">
            <circle cx="22" cy="22" r="18" fill="none" strokeWidth="4" className="stroke-slate-100 dark:stroke-slate-800" />
            <circle
                cx="22" cy="22" r="18" fill="none" strokeWidth="4" strokeLinecap="round"
                stroke={color}
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE - (RING_CIRCUMFERENCE * Math.max(0, Math.min(100, percent))) / 100}
                style={{ transition: 'stroke-dashoffset .2s ease' }}
            />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-[11px] font-mono font-semibold" style={{ color }}>
            {Math.round(percent)}%
        </div>
    </div>
);

// ── Colored slider — a native range input laid transparently over a
// visual fill track so the color matches the tile's accent. ─────────────────
const ColorSlider: React.FC<{
    percent: number; color: string; min: number; max: number; step: number;
    onChange: (v: number) => void;
}> = ({ percent, color, min, max, step, onChange }) => {
    const fillPercent = max > min ? Math.max(0, Math.min(100, ((percent - min) / (max - min)) * 100)) : 0;
    return (
        <div className="relative h-5 flex items-center">
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[5px] rounded-full bg-slate-100 dark:bg-slate-800" />
            <div
                className="absolute left-0 top-1/2 -translate-y-1/2 h-[5px] rounded-full"
                style={{ width: `${fillPercent}%`, backgroundColor: color }}
            />
            {/* Decorative dot — positioned with the exact same math as the fill bar
                above, so it always sits exactly on the line regardless of browser/OS
                native range-thumb rendering quirks. The real (invisible) native thumb
                below still handles clicking/dragging. */}
            <div
                className="absolute top-1/2 w-4 h-4 rounded-full shadow pointer-events-none"
                style={{ left: `${fillPercent}%`, backgroundColor: color, transform: 'translate(-50%, -50%)' }}
            />
            <input
                type="range" min={min} max={max} step={step} value={percent}
                onChange={e => onChange(Number(e.target.value))}
                className="relative z-10 w-full h-5 appearance-none bg-transparent cursor-pointer
                    [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-[5px]
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:opacity-0 [&::-webkit-slider-thumb]:cursor-grab
                    [&::-moz-range-track]:bg-transparent [&::-moz-range-track]:h-[5px]
                    [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
                    [&::-moz-range-thumb]:opacity-0 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-grab"
            />
        </div>
    );
};

// ── A single weight tile: colored top edge, icon chip, ring, slider, caption. ─
const WeightTile: React.FC<{
    icon: React.ReactNode; color: string; softBg: string; label: string;
    percent: number; captionClassName?: string; caption: string;
    min?: number; max?: number; step?: number;
    onChange: (v: number) => void;
}> = ({ icon, color, softBg, label, percent, caption, captionClassName, min = 0, max = 100, step = 5, onChange }) => (
    <div className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 pt-5 overflow-hidden shadow-sm">
        <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ backgroundColor: color }} />
        <div className="flex items-start justify-between mb-3.5 gap-2">
            <span className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-white min-w-0">
                <span className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: softBg, color }}>
                    {icon}
                </span>
                <span className="truncate">{label}</span>
            </span>
            <RingGauge percent={percent} color={color} />
        </div>
        <div className="mb-2.5">
            <ColorSlider percent={percent} color={color} min={min} max={max} step={step} onChange={onChange} />
        </div>
        <p className="text-[11px] leading-snug" style={{ color: captionClassName ? undefined : '#8A8FA3' }}>
            <span className={captionClassName}>{caption}</span>
        </p>
    </div>
);

const AdminRoadmapConfigPage: React.FC = () => {
    const [companyId, setCompanyId]     = useState<string | null>(() => localStorage.getItem(STORAGE_ID_KEY));
    const [companyName, setCompanyName] = useState<string>(() => localStorage.getItem(STORAGE_NAME_KEY) ?? '');
    const [cfg, setCfg]                 = useState<RoadmapConfig>(DEFAULT_CONFIG);
    const [loading, setLoading]         = useState(true);
    const [error, setError]             = useState<string | null>(null);
    const [saveState, setSaveState]     = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

    // ── Preview-only field — UI shell for the rest of the company
    // preferences doc; not yet wired to a backend endpoint. ──────────────────
    const [riskReviewThreshold, setRiskReviewThreshold] = useState(3.5);

    const pwSum = +(priorityWeightsSum(cfg.priorityWeights) * 100).toFixed(1);
    const rwSum = riskWeightsSum(cfg.riskWeights);

    const load = useCallback((id: string) => {
        setLoading(true);
        setError(null);
        getRoadmapConfig(id)
            .then(setCfg)
            .catch(e => setError(String(e)))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (companyId) load(companyId);
        else setLoading(false);
    }, [companyId, load]);

    // Keep in sync if the active company is changed on the Company page
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            setCompanyId(detail?.id ?? null);
            setCompanyName(detail?.name ?? '');
        };
        window.addEventListener('tavro_company_changed', handler);
        return () => window.removeEventListener('tavro_company_changed', handler);
    }, []);

    const handleSave = async () => {
        if (!companyId) return;
        setSaveState('saving');
        setError(null);
        try {
            const saved = await saveRoadmapConfig(companyId, cfg);
            setCfg(saved);
            setSaveState('saved');
            setTimeout(() => setSaveState('idle'), 2000);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Save failed');
            setSaveState('error');
        }
    };

    const handleReset = () => setCfg(DEFAULT_CONFIG);

    if (!companyId) {
        return (
            <div className="p-6 animate-fade-in">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center flex flex-col items-center gap-3">
                    <Building2 size={28} className="text-slate-300 dark:text-slate-600" />
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Select an active company before configuring company preferences.
                    </p>
                    <Link
                        to="/company"
                        className="text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/10"
                    >
                        Go to Company selection
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 sm:p-8 animate-fade-in overflow-y-auto">
            <div className="max-w-4xl mx-auto">

                {/* Header */}
                <div className="flex items-start justify-between gap-4 mb-7 flex-wrap">
                    <div>
                        <h1 className="text-[22px] font-semibold text-slate-900 dark:text-white tracking-tight mb-1.5">
                            Company Preferences
                        </h1>
                        <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">
                            Applies company-wide to
                            <span className="inline-flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 text-xs font-semibold pl-2 pr-2.5 py-1 rounded-full">
                                <Building2 size={12} />
                                {companyName || 'Selected company'}
                            </span>
                        </p>
                    </div>
                    <div className="flex items-center gap-2.5">
                        <button
                            type="button"
                            onClick={handleReset}
                            disabled={loading}
                            className="text-xs font-semibold px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-800 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
                        >
                            Reset defaults
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={loading || saveState === 'saving'}
                            className={`flex items-center gap-1.5 text-xs font-semibold px-4 py-2.5 rounded-xl transition-all disabled:opacity-50 ${
                                saveState === 'saved'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-black dark:hover:bg-slate-100'
                            }`}
                        >
                            {saveState === 'saving' && <Loader2 size={12} className="animate-spin" />}
                            {saveState === 'saved' ? <><CheckCircle2 size={12} /> Saved</> : saveState === 'saving' ? 'Saving…' : 'Save weights'}
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="mb-6 flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-sm text-red-600 dark:text-red-400">
                        <AlertCircle size={14} className="shrink-0" /> {error}
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-sm py-8">
                        <Loader2 size={15} className="animate-spin" /> Loading…
                    </div>
                ) : (
                    <div className="flex flex-col gap-9">

                        {/* Priority score formula weights */}
                        <div>
                            <div className="flex items-end justify-between gap-3 mb-3.5 flex-wrap">
                                <div>
                                    <h2 className="text-[15px] font-semibold text-slate-800 dark:text-white mb-1">Priority score formula weights</h2>
                                    <p className="text-xs text-slate-400 max-w-md leading-snug">
                                        Controls how Business Value, Effort, and Risk combine into a single priority score.
                                    </p>
                                </div>
                                <AllocationBadge total={pwSum} />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                                <WeightTile
                                    icon={<TrendingUp size={14} />} color="#0D9488" softBg="#E6F5F3"
                                    label="Business Value" percent={cfg.priorityWeights.BV * 100}
                                    caption="Positive contribution to score" captionClassName="text-teal-600 dark:text-teal-400"
                                    onChange={v => setCfg(prev => ({ ...prev, priorityWeights: { ...prev.priorityWeights, BV: v / 100 } }))}
                                />
                                <WeightTile
                                    icon={<Clock size={14} />} color="#4338CA" softBg="#EEEDFC"
                                    label="Effort" percent={cfg.priorityWeights.TC * 100}
                                    caption="Applied as (6 − score) × weight"
                                    onChange={v => setCfg(prev => ({ ...prev, priorityWeights: { ...prev.priorityWeights, TC: v / 100 } }))}
                                />
                                <WeightTile
                                    icon={<AlertTriangle size={14} />} color="#C2540A" softBg="#FBEBE0"
                                    label="Risk" percent={cfg.priorityWeights.RISK * 100}
                                    caption="Subtracted from score" captionClassName="text-orange-700 dark:text-orange-400"
                                    onChange={v => setCfg(prev => ({ ...prev, priorityWeights: { ...prev.priorityWeights, RISK: v / 100 } }))}
                                />
                            </div>
                        </div>

                        {/* Risk category weights */}
                        <div>
                            <div className="flex items-end justify-between gap-3 mb-3.5 flex-wrap">
                                <div>
                                    <h2 className="text-[15px] font-semibold text-slate-800 dark:text-white mb-1">Risk category weights</h2>
                                    <p className="text-xs text-slate-400 max-w-md leading-snug">Each category's contribution to the composite risk score.</p>
                                </div>
                                <AllocationBadge total={rwSum} />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                                <WeightTile
                                    icon={<ShieldCheck size={14} />} color="#7C3AED" softBg="#F1EBFE"
                                    label="Data & Privacy" percent={cfg.riskWeights.data_privacy}
                                    caption="Data handling, storage, exposure"
                                    onChange={v => setCfg(prev => ({ ...prev, riskWeights: { ...prev.riskWeights, data_privacy: v } }))}
                                />
                                <WeightTile
                                    icon={<Activity size={14} />} color="#0EA5E9" softBg="#E5F5FD"
                                    label="Operational" percent={cfg.riskWeights.operational}
                                    caption="Reliability, uptime, failure modes"
                                    onChange={v => setCfg(prev => ({ ...prev, riskWeights: { ...prev.riskWeights, operational: v } }))}
                                />
                                <WeightTile
                                    icon={<Scale size={14} />} color="#C2540A" softBg="#FBEBE0"
                                    label="Compliance" percent={cfg.riskWeights.compliance}
                                    caption="Regulatory and policy alignment"
                                    onChange={v => setCfg(prev => ({ ...prev, riskWeights: { ...prev.riskWeights, compliance: v } }))}
                                />
                                <WeightTile
                                    icon={<Brain size={14} />} color="#DB2777" softBg="#FCE7F3"
                                    label="AI Behavioral" percent={cfg.riskWeights.ai_behavioral}
                                    caption="Hallucination, drift, misuse risk"
                                    onChange={v => setCfg(prev => ({ ...prev, riskWeights: { ...prev.riskWeights, ai_behavioral: v } }))}
                                />
                                <WeightTile
                                    icon={<Target size={14} />} color="#65A30D" softBg="#EEF6E0"
                                    label="Strategic & Reputational" percent={cfg.riskWeights.strategic_reputational}
                                    caption="Brand, trust, public perception"
                                    onChange={v => setCfg(prev => ({ ...prev, riskWeights: { ...prev.riskWeights, strategic_reputational: v } }))}
                                />
                            </div>
                        </div>

                        {/* Data node defaults — live, saved via the same Save button as the weights above */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
                            <span className="text-sm font-semibold text-slate-800 dark:text-white">Data node defaults</span>
                            <p className="text-[11px] text-slate-400 mb-3 mt-0.5">Applied automatically when a new data node is created.</p>

                            <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5 block">Default visibility</label>
                            <div className="flex flex-wrap gap-1.5 mb-4">
                                {VISIBILITY_OPTIONS.map(({ key, label }) => (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={() => setCfg(prev => ({ ...prev, defaultVisibility: key }))}
                                        className={`text-[11.5px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                                            cfg.defaultVisibility === key
                                                ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/30'
                                                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                                        }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
                                <div>
                                    <label className="text-[11.5px] font-semibold text-slate-600 dark:text-slate-400 block">Mark new data nodes as sensitive</label>
                                    <p className="text-[10px] text-slate-400 mt-0.5">Applies a sensitivity flag by default until a reviewer clears it.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setCfg(prev => ({ ...prev, defaultSensitive: !prev.defaultSensitive }))}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 shrink-0 ${cfg.defaultSensitive ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-700'}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200 ${cfg.defaultSensitive ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>

                        {/* Risk governance — UI shell, not yet wired to a save endpoint */}
                        <div className="bg-white/60 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 opacity-70">
                            <div className="flex items-center justify-between gap-3 mb-1">
                                <span className="text-sm font-semibold text-slate-800 dark:text-white">Risk governance</span>
                                <span className={COMING_SOON_BADGE}>Coming soon</span>
                            </div>
                            <p className="text-[11px] text-slate-400 mb-4">Use cases scoring at or above this threshold are automatically flagged for governance review.</p>

                            <div className="max-w-sm">
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-[11.5px] font-semibold text-slate-600 dark:text-slate-400">Risk review threshold</label>
                                    <span className="text-xs font-mono font-bold text-orange-700 dark:text-orange-400">{riskReviewThreshold.toFixed(1)} / 5.0</span>
                                </div>
                                <ColorSlider
                                    percent={(riskReviewThreshold / 5) * 100}
                                    color="#C2540A" min={0} max={100} step={2}
                                    onChange={v => setRiskReviewThreshold(+(v / 20).toFixed(1))}
                                />
                            </div>
                        </div>

                    </div>
                )}
            </div>
        </div>
    );
};

export default AdminRoadmapConfigPage;
