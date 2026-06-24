import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Settings2, Moon, Sun, Monitor,
    CheckCircle2, Code2,
    BotMessageSquare, Trash2, Terminal,
    Database, Map, RotateCcw
} from 'lucide-react';
import type { RoadmapConfig } from '../services/roadmapConfig';
import {
    readRoadmapConfig, saveRoadmapConfig,
    DEFAULT_CONFIG, priorityWeightsSum, riskWeightsSum,
} from '../services/roadmapConfig';
import { useInspectJson } from '../hooks/useInspectJson';
import { useShowLogs } from '../hooks/useShowLogs';
import {
    DEFAULT_MODELS, PROVIDER_LABELS, LLMProvider,
    getProviderConfig, saveProviderConfig, clearProviderConfig,
    getActiveProvider, setActiveProvider,
} from '../services/llmService';

import { useTheme } from '../context/ThemeContext';

const ALL_PROVIDERS: LLMProvider[] = ['copilot'];
const MCP_URL = import.meta.env.VITE_MCP_URL || 'http://localhost:9001/zitadel/mcp';

import { useChatContext } from '../context/ChatContext';

const Settings: React.FC = () => {
    const { setViewContext } = useChatContext();
    const navigate = useNavigate();

    useEffect(() => {
        setViewContext('settings');
    }, [setViewContext]);

    const { theme, setTheme } = useTheme();
    const [inspectJson, setInspectJson] = useInspectJson();
    const [saved, setSaved] = useState(false);
    const [showLogs, setShowLogs] = useShowLogs();

    // Roadmap configuration
    const [roadmapCfg, setRoadmapCfg] = useState<RoadmapConfig>(() => readRoadmapConfig());
    const [roadmapSaved, setRoadmapSaved] = useState(false);
    const pwSum  = +(priorityWeightsSum(roadmapCfg.priorityWeights) * 100).toFixed(1);
    const rwSum  = riskWeightsSum(roadmapCfg.riskWeights);

    const handleSaveRoadmap = () => {
        saveRoadmapConfig(roadmapCfg);
        setRoadmapSaved(true);
        setTimeout(() => setRoadmapSaved(false), 2000);
    };
    const handleResetRoadmap = () => setRoadmapCfg(DEFAULT_CONFIG);

    // LLM config — per-provider
    type ByokType = 'github' | 'openai' | 'azure' | 'anthropic';
    type ProviderState = {
        model: string; saved: boolean; configured: boolean;
        // Copilot-only BYOK fields
        byokType?: ByokType;
        byokBaseUrl?: string;
    };
    const BYOK_DEFAULT_MODELS: Record<ByokType, string> = {
        github: 'gpt-4.1', openai: 'gpt-5.5', azure: 'gpt-4o', anthropic: 'claude-sonnet-4-6',
    };
    const PROVIDER_MODEL_OPTIONS: Partial<Record<LLMProvider, string[]>> = {
        openai:    ['gpt-4o', 'gpt-5.5'],
        anthropic: ['claude-sonnet-4-6', 'claude-sonnet-4-5'],
    };
    const BYOK_MODEL_OPTIONS: Partial<Record<ByokType, string[]>> = {
        openai:    ['gpt-4o', 'gpt-5.5'],
        anthropic: ['claude-sonnet-4-6', 'claude-sonnet-4-5'],
    };
    const getModelOptions = (p: LLMProvider, s: ProviderState): string[] | null => {
        if (p === 'copilot') return BYOK_MODEL_OPTIONS[s.byokType ?? 'github'] ?? null;
        return PROVIDER_MODEL_OPTIONS[p] ?? null;
    };
    const initProviderState = (p: LLMProvider): ProviderState => {
        const cfg = getProviderConfig(p);
        const base: ProviderState = { model: cfg?.model || DEFAULT_MODELS[p], saved: false, configured: true };
        if (p === 'copilot') {
            base.byokType   = (cfg?.byok?.type as ByokType) ?? 'github';
            base.byokBaseUrl = cfg?.byok?.baseUrl ?? '';
        }
        return base;
    };
    const [providerStates, setProviderStates] = useState<Record<LLMProvider, ProviderState>>(() => ({
        openai: initProviderState('openai'),
        gemini: initProviderState('gemini'),
        anthropic: initProviderState('anthropic'),
        copilot: initProviderState('copilot'),
    }));
    const [activeProvider, setActiveProviderState] = useState<LLMProvider | null>(getActiveProvider);

    const updateProvider = (p: LLMProvider, patch: Partial<ProviderState>) =>
        setProviderStates((s: Record<LLMProvider, ProviderState>) => ({ ...s, [p]: { ...s[p], ...patch } }));

    const handleSaveProvider = (p: LLMProvider) => {
        const s = providerStates[p];
        const byok = (p === 'copilot' && s.byokType && s.byokType !== 'github')
            ? { type: s.byokType as 'openai' | 'azure' | 'anthropic', baseUrl: s.byokBaseUrl?.trim() || undefined }
            : undefined;
        saveProviderConfig({ provider: p, model: s.model || DEFAULT_MODELS[p], apiKey: '', byok });
        updateProvider(p, { configured: true, saved: true });
        setTimeout(() => updateProvider(p, { saved: false }), 2500);
    };

    const handleClearProvider = (p: LLMProvider) => {
        clearProviderConfig(p);
        updateProvider(p, { model: DEFAULT_MODELS[p], configured: false });
        if (activeProvider === p) { setActiveProviderState(null); }
    };

    const handleSetActive = (p: LLMProvider) => {
        setActiveProvider(p);
        setActiveProviderState(p);
    };

    const ThemeOption = ({ mode, label, icon }: { mode: 'light' | 'dark' | 'system'; label: string; icon: React.ReactNode }) => (
        <button
            onClick={() => setTheme(mode)}
            className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all flex-1 ${theme === mode
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
        >
            {icon}
            <span className="text-xs font-semibold">{label}</span>
        </button>
    );

    return (
        <div className="flex flex-col gap-8 w-full animate-fade-in max-w-[800px] mx-auto">

            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="p-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl transition-colors"><Settings2 size={24} /></div>
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white tracking-tight">Application Settings</h1>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">Manage preferences and connection status</p>
                </div>
            </div>

            {/* ── Chat AI Configuration ─────────────────────────────────────── */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center gap-2">
                    <BotMessageSquare size={16} className="text-blue-500" />
                    <span className="font-bold text-slate-800 dark:text-slate-100">Tavro AI Assitant Settings - Chat AI Configuration</span>
                </div>
                <div className="p-5 flex flex-col gap-6">
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                        Configure each provider independently, then select which one the chat assistant should use. API keys are managed by your administrator.
                    </p>

                    {/* Per-provider cards */}
                    {ALL_PROVIDERS.map(p => {
                        const s = providerStates[p];
                        return (
                            <div key={p} className={`rounded-xl border-2 transition-all ${
                                activeProvider === p
                                    ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-900/10'
                                    : 'border-slate-200 dark:border-slate-700'
                            }`}>
                                <div className="flex justify-end px-4">
                                    <div className="flex items-center gap-2">
                                        {s.configured && (
                                            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 px-2 py-0.5 rounded-full">
                                                <CheckCircle2 size={10} /> Saved
                                            </span>
                                        )}
                                        {activeProvider === p && (
                                            <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-2 py-0.5 rounded-full">
                                                Active
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Card body */}
                                <div className="p-4 flex flex-col gap-3">

                                    {/* ── Copilot BYOK: Provider Type ── */}
                                    {p === 'copilot' && (
                                        <div className="flex flex-col gap-1">
                                            <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Provider Type</label>
                                            <select
                                                value={s.byokType ?? 'github'}
                                                onChange={e => {
                                                    const t = e.target.value as ByokType;
                                                    updateProvider(p, {
                                                        byokType: t,
                                                        model: BYOK_DEFAULT_MODELS[t],
                                                        byokBaseUrl: '',
                                                    });
                                                }}
                                                className="text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-all"
                                            >
                                                <option value="github">GitHub Copilot (requires subscription)</option>
                                                <option value="openai">OpenAI</option>
                                                <option value="azure">Azure OpenAI / Azure AI Foundry</option>
                                                <option value="anthropic">Anthropic (Claude)</option>
                                            </select>
                                            <p className="text-[10px] text-slate-400 dark:text-slate-500">
                                                {s.byokType === 'github' && 'Uses your GitHub Copilot subscription via the local proxy server.'}
                                                {s.byokType === 'openai' && 'Uses Copilot SDK BYOK with OpenAI or OpenAI-compatible endpoints.'}
                                                {s.byokType === 'azure' && 'Uses Copilot SDK BYOK with Azure OpenAI. Base URL required.'}
                                                {s.byokType === 'anthropic' && 'Uses Copilot SDK BYOK with Anthropic Claude.'}
                                                {!s.byokType && 'Select how requests are routed.'}
                                            </p>
                                        </div>
                                    )}

                                    {/* Model */}
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Model</label>
                                        {(() => {
                                            const fieldCls = "text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-all font-mono";
                                            const defaultModel = p === 'copilot' ? (BYOK_DEFAULT_MODELS[s.byokType ?? 'github'] ?? DEFAULT_MODELS[p]) : DEFAULT_MODELS[p];
                                            const options = getModelOptions(p, s);
                                            if (options) {
                                                const allOptions = Array.from(new Set([...options, s.model].filter(Boolean)));
                                                return (
                                                    <select
                                                        value={s.model || defaultModel}
                                                        onChange={e => updateProvider(p, { model: e.target.value })}
                                                        className={fieldCls}
                                                    >
                                                        {allOptions.map(m => (
                                                            <option key={m} value={m}>{m}</option>
                                                        ))}
                                                    </select>
                                                );
                                            }
                                            return (
                                                <input
                                                    type="text"
                                                    value={s.model}
                                                    onChange={e => updateProvider(p, { model: e.target.value })}
                                                    placeholder={defaultModel}
                                                    className={fieldCls}
                                                />
                                            );
                                        })()}
                                        <p className="text-[10px] text-slate-400 dark:text-slate-500">
                                            Default: <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">
                                                {p === 'copilot' ? (BYOK_DEFAULT_MODELS[s.byokType ?? 'github'] ?? DEFAULT_MODELS[p]) : DEFAULT_MODELS[p]}
                                            </code>
                                            {p === 'copilot' && s.byokType === 'azure' && ' — must match your deployment name'}
                                        </p>
                                    </div>

                                    {/* Actions row */}
                                    <div className="flex items-center justify-between pt-1">
                                        <button
                                            onClick={() => handleClearProvider(p)}
                                            disabled={!s.configured}
                                            className="flex items-center gap-1 text-xs font-semibold text-rose-500 hover:text-rose-700 disabled:text-slate-300 dark:disabled:text-slate-700 disabled:cursor-not-allowed transition-colors"
                                        >
                                            <Trash2 size={12} /> Clear
                                        </button>
                                        <div className="flex items-center gap-2">
                                            {s.configured && activeProvider !== p && (
                                                <button
                                                    onClick={() => handleSetActive(p)}
                                                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all"
                                                >
                                                    Use this LLM
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleSaveProvider(p)}
                                                className={`px-4 py-1.5 rounded-lg font-bold text-xs transition-all text-white ${
                                                    s.saved ? 'bg-emerald-500' : 'bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20'
                                                }`}
                                            >
                                                {s.saved ? '✓ Saved' : 'Save'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {/* Active LLM summary */}
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 px-4 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <BotMessageSquare size={14} className="text-blue-500" />
                            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Active for chat:</span>
                            {activeProvider ? (
                                <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400">
                                    {PROVIDER_LABELS[activeProvider]} &middot; {providerStates[activeProvider].model || DEFAULT_MODELS[activeProvider]}
                                </span>
                            ) : (
                                <span className="text-xs text-slate-400 italic">None selected — save a provider and click "Use this LLM"</span>
                            )}
                        </div>
                        {activeProvider && (
                            <button
                                onClick={() => { setActiveProvider(null as any); setActiveProviderState(null); }}
                                className="text-[11px] font-semibold text-rose-500 hover:text-rose-700 transition-colors"
                            >
                                Unset
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* ── MCP Connection ─────────────────────────────────────────── */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center gap-2">
                    <Database size={16} className="text-blue-500" />
                    <span className="font-bold text-slate-800 dark:text-slate-100">MCP Connection</span>
                </div>
                <div className="p-5 flex flex-col gap-3">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                        MCP Server URL
                    </label>
                    <input
                        type="text"
                        value={MCP_URL}
                        readOnly
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400 font-mono cursor-default select-all outline-none"
                    />
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                        Authentication is handled automatically on login.
                    </p>
                </div>
            </div>

            {/* Developer Settings */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center gap-2">
                    <Code2 size={16} className="text-slate-500 dark:text-slate-400" />
                    <span className="font-bold text-slate-800 dark:text-slate-100">Developer Settings</span>
                </div>
                <div className="p-5 flex flex-col gap-6">
                    {/* Show Logs Toggle */}
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-bold text-slate-800 dark:text-slate-200 font-sans flex items-center gap-2">
                                <Terminal size={14} className="text-blue-500" />
                                Show Logs
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Enables the system log panel for debugging tool calls and chat</p>
                        </div>
                        <button
                            role="switch"
                            aria-checked={showLogs}
                            onClick={() => setShowLogs(!showLogs)}
                            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${showLogs ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'}`}
                        >
                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 ${showLogs ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>

                </div>
            </div>

            {/* Roadmap Configuration */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Map size={16} className="text-violet-500" />
                        <span className="font-bold text-slate-800 dark:text-white">Roadmap Configuration</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleResetRoadmap}
                            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                            <RotateCcw size={12} /> Reset defaults
                        </button>
                        <button
                            type="button"
                            onClick={handleSaveRoadmap}
                            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${
                                roadmapSaved
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : 'bg-violet-600 text-white hover:bg-violet-700'
                            }`}
                        >
                            {roadmapSaved ? <><CheckCircle2 size={12} /> Saved</> : 'Save weights'}
                        </button>
                    </div>
                </div>
                <div className="p-5 flex flex-col gap-6">

                    {/* Priority formula weights */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Priority Score Formula Weights</p>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Score = (BV × {(roadmapCfg.priorityWeights.BV * 100).toFixed(0)}%) + (DR × {(roadmapCfg.priorityWeights.DR * 100).toFixed(0)}%) + ((6−TC) × {(roadmapCfg.priorityWeights.TC * 100).toFixed(0)}%) − (Risk × {(roadmapCfg.priorityWeights.RISK * 100).toFixed(0)}%)
                                </p>
                            </div>
                            <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border shrink-0 ${Math.abs(pwSum - 100) < 0.1 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                                {pwSum}% {Math.abs(pwSum - 100) >= 0.1 && '— must equal 100%'}
                            </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {([
                                { key: 'BV',   label: 'Business Value',     hint: 'Positive contribution' },
                                { key: 'DR',   label: 'Data Readiness',     hint: 'Positive contribution' },
                                { key: 'TC',   label: 'Technical Complexity', hint: 'Applied as (6 − score) × weight' },
                                { key: 'RISK', label: 'Risk',               hint: 'Subtracted from score' },
                            ] as { key: keyof typeof roadmapCfg.priorityWeights; label: string; hint: string }[]).map(({ key, label, hint }) => (
                                <div key={key} className="flex flex-col gap-1.5">
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{label}</label>
                                        <span className="text-xs font-bold text-violet-600">{(roadmapCfg.priorityWeights[key] * 100).toFixed(0)}%</span>
                                    </div>
                                    <input
                                        type="range" min={0} max={60} step={5}
                                        value={roadmapCfg.priorityWeights[key] * 100}
                                        onChange={e => setRoadmapCfg(prev => ({
                                            ...prev,
                                            priorityWeights: { ...prev.priorityWeights, [key]: Number(e.target.value) / 100 },
                                        }))}
                                        className="w-full accent-violet-600"
                                    />
                                    <p className="text-[10px] text-slate-400">{hint}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="border-t border-slate-100 dark:border-slate-800" />

                    {/* Risk category weights */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Risk Category Weights</p>
                                <p className="text-xs text-slate-400 mt-0.5">Each category's contribution to the composite risk score.</p>
                            </div>
                            <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border shrink-0 ${rwSum === 100 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                                {rwSum}% {rwSum !== 100 && '— must equal 100%'}
                            </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {([
                                { key: 'data_privacy',           label: 'Data & Privacy Risk' },
                                { key: 'operational',            label: 'Operational Risk' },
                                { key: 'compliance',             label: 'Compliance Risk' },
                                { key: 'ai_behavioral',          label: 'AI Behavioral Risk' },
                                { key: 'strategic_reputational', label: 'Strategic & Reputational Risk' },
                            ] as { key: keyof typeof roadmapCfg.riskWeights; label: string }[]).map(({ key, label }) => (
                                <div key={key} className="flex flex-col gap-1.5">
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{label}</label>
                                        <span className={`text-xs font-bold ${roadmapCfg.riskWeights[key] === 20 ? 'text-slate-400' : 'text-violet-600'}`}>{roadmapCfg.riskWeights[key]}%</span>
                                    </div>
                                    <input
                                        type="range" min={0} max={60} step={5}
                                        value={roadmapCfg.riskWeights[key]}
                                        onChange={e => setRoadmapCfg(prev => ({
                                            ...prev,
                                            riskWeights: { ...prev.riskWeights, [key]: Number(e.target.value) },
                                        }))}
                                        className="w-full accent-violet-600"
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                </div>
            </div>

            {/* Appearance */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                    <span className="font-bold text-slate-800 dark:text-white">Appearance</span>
                </div>
                <div className="p-5 flex flex-col gap-5">
                    <div>
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Theme Selection</p>
                        <div className="flex gap-3">
                            <ThemeOption mode="light" label="Light" icon={<Sun size={20} />} />
                            <ThemeOption mode="dark" label="Dark" icon={<Moon size={20} />} />
                            <ThemeOption mode="system" label="System" icon={<Monitor size={20} />} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Settings;
