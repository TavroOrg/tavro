import React, { useState, useEffect, useRef } from 'react';
import {
    Settings2, Moon, Sun, Monitor,
    CheckCircle2, Loader2, RefreshCw, Code2,
    BotMessageSquare, Eye, EyeOff, Trash2, Terminal,
    Database, CloudOff, Download, CircleHelp, ExternalLink
} from 'lucide-react';
import { mcpClient } from '../services/mcpClient';
import { useInspectJson } from '../hooks/useInspectJson';
import { generatePKCE } from '../services/pkce';
import { useShowLogs } from '../hooks/useShowLogs';
import { useCacheMode } from '../hooks/useCacheMode';
import {
    DEFAULT_MODELS, PROVIDER_HINTS, PROVIDER_LABELS, LLMProvider,
    getProviderConfig, saveProviderConfig, clearProviderConfig,
    getActiveProvider, setActiveProvider,
} from '../services/llmService';

import { useTheme } from '../context/ThemeContext';

const ALL_PROVIDERS: LLMProvider[] = ['openai', 'gemini', 'anthropic'];
const MCP_URL = import.meta.env.VITE_MCP_URL || 'http://localhost:9001/zitadel/mcp';

const PROVIDER_ICONS: Record<LLMProvider, string> = {
    openai: '🤖',
    gemini: '✨',
    anthropic: '🧠',
};

import { useChatContext } from '../context/ChatContext';

const Settings: React.FC = () => {
    const { setViewContext } = useChatContext();

    useEffect(() => {
        setViewContext('settings');
    }, [setViewContext]);
    // App config
    const { theme, setTheme } = useTheme();
    const [inspectJson, setInspectJson] = useInspectJson();
    const [saved, setSaved] = useState(false);
    const [showLogs, setShowLogs] = useShowLogs();
    const [cacheMode, setCacheMode] = useCacheMode();

    // LLM config — per-provider
    type ProviderState = { model: string; key: string; showKey: boolean; saved: boolean; configured: boolean };
    const initProviderState = (p: LLMProvider): ProviderState => {
        const cfg = getProviderConfig(p);
        return { model: cfg?.model || DEFAULT_MODELS[p], key: cfg?.apiKey || '', showKey: false, saved: false, configured: !!cfg };
    };
    const [providerStates, setProviderStates] = useState<Record<LLMProvider, ProviderState>>(() => ({
        openai: initProviderState('openai'),
        gemini: initProviderState('gemini'),
        anthropic: initProviderState('anthropic'),
    }));
    const [activeProvider, setActiveProviderState] = useState<LLMProvider | null>(getActiveProvider);

    const updateProvider = (p: LLMProvider, patch: Partial<ProviderState>) =>
        setProviderStates(s => ({ ...s, [p]: { ...s[p], ...patch } }));

    // Cached data settings
    const [cachedDataUrl, setCachedDataUrl] = useState('');
    const [cachedDataLocalPath, setCachedDataLocalPath] = useState('');
    const [cachedDataLimitMB, setCachedDataLimitMB] = useState('10');
    const [cachedDataSaved, setCachedDataSaved] = useState(false);
    const [generateLog, setGenerateLog] = useState<string[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedJson, setGeneratedJson] = useState<string | null>(null);
    const generateLogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Load cached data settings
        setCachedDataUrl(localStorage.getItem('tavro_cached_data_url') || '');
        setCachedDataLocalPath(localStorage.getItem('tavro_cached_data_local_path') || '');
        setCachedDataLimitMB(localStorage.getItem('tavro_cached_data_limit_mb') || '10');
    }, []);

    // Auto-scroll generate log
    useEffect(() => {
        if (generateLogRef.current) {
            generateLogRef.current.scrollTop = generateLogRef.current.scrollHeight;
        }
    }, [generateLog]);

    const handleSaveCachedDataSettings = () => {
        localStorage.setItem('tavro_cached_data_url', cachedDataUrl.trim());
        localStorage.setItem('tavro_cached_data_local_path', cachedDataLocalPath.trim());
        localStorage.setItem('tavro_cached_data_limit_mb', cachedDataLimitMB);
        // Reset the cached data store so it reloads with new settings
        mcpClient.invalidateCache();
        setCachedDataSaved(true);
        setTimeout(() => setCachedDataSaved(false), 2500);
    };

    const handleGenerateCache = async () => {
        setIsGenerating(true);
        setGenerateLog([]);
        setGeneratedJson(null);
        try {
            const json = await mcpClient.generateCachedData();
            setGeneratedJson(json);
        } catch (err: any) {
            setGenerateLog(prev => [...prev, `❌ Error: ${err.message}`]);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDownloadCache = () => {
        if (!generatedJson) return;
        const blob = new Blob([generatedJson], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mcpCachedData.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleSaveProvider = (p: LLMProvider) => {
        const s = providerStates[p];
        if (!s.key.trim()) return;
        saveProviderConfig({ provider: p, model: s.model || DEFAULT_MODELS[p], apiKey: s.key.trim() });
        updateProvider(p, { configured: true, saved: true });
        setTimeout(() => updateProvider(p, { saved: false }), 2500);
    };

    const handleClearProvider = (p: LLMProvider) => {
        clearProviderConfig(p);
        updateProvider(p, { key: '', model: DEFAULT_MODELS[p], configured: false });
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
                    <span className="font-bold text-slate-800 dark:text-slate-100">Chat AI Configuration</span>
                </div>
                <div className="p-5 flex flex-col gap-6">
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                        Configure each provider independently, then select which one the chat assistant should use.
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
                                {/* Card header */}
                                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                                    <div className="flex items-center gap-2">
                                        <span className="text-base">{PROVIDER_ICONS[p]}</span>
                                        <span className="font-bold text-sm text-slate-800 dark:text-slate-100">{PROVIDER_LABELS[p]}</span>
                                        <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{PROVIDER_HINTS[p]}</span>
                                    </div>
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
                                    {/* Model */}
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Model</label>
                                        <input
                                            type="text"
                                            value={s.model}
                                            onChange={e => updateProvider(p, { model: e.target.value })}
                                            placeholder={DEFAULT_MODELS[p]}
                                            className="text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-all font-mono"
                                        />
                                        <p className="text-[10px] text-slate-400 dark:text-slate-500">Default: <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">{DEFAULT_MODELS[p]}</code></p>
                                    </div>

                                    {/* API Key */}
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">API Key</label>
                                        <div className="relative">
                                            <input
                                                type={s.showKey ? 'text' : 'password'}
                                                value={s.key}
                                                onChange={e => updateProvider(p, { key: e.target.value })}
                                                placeholder={`Paste your ${PROVIDER_LABELS[p]} API key`}
                                                className="w-full text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 rounded-lg px-3 py-2 pr-9 outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-all font-mono"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => updateProvider(p, { showKey: !s.showKey })}
                                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                                            >
                                                {s.showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                                            </button>
                                        </div>
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
                                                disabled={!s.key.trim()}
                                                className={`px-4 py-1.5 rounded-lg font-bold text-xs transition-all text-white disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-600 disabled:cursor-not-allowed ${
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

                    <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-4">
                        <div>
                            <p className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                <Database size={14} className="text-amber-500" />
                                Cached Data Mode
                                {cacheMode && (
                                    <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-full">ACTIVE</span>
                                )}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Use cached MCP data instead of live server calls. Useful for demos and offline use.</p>
                        </div>
                        <button
                            role="switch"
                            aria-checked={cacheMode}
                            onClick={() => setCacheMode(!cacheMode)}
                            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${cacheMode ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'}`}
                        >
                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 ${cacheMode ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Cached Data Configuration ──────────────────────────────────── */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center gap-2">
                    <Database size={16} className="text-amber-500" />
                    <span className="font-bold text-slate-800 dark:text-white">Cached Data Configuration</span>
                    {cacheMode && (
                        <span className="ml-auto flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-full">
                            <CloudOff size={10} /> Live calls disabled
                        </span>
                    )}
                </div>
                <div className="p-5 flex flex-col gap-5">
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                        Configure where the app loads cached MCP data from. Sources are tried in priority order:{' '}
                        <strong>Remote URL</strong> → <strong>Local Path</strong> → <strong>Bundled fallback</strong>.
                    </p>

                    {/* Remote URL */}
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Remote Cache URL</label>
                        <input
                            type="url"
                            value={cachedDataUrl}
                            onChange={e => setCachedDataUrl(e.target.value)}
                            placeholder="https://your-bucket.s3.amazonaws.com/mcpCachedData.json"
                            className="text-sm border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400 transition-all font-mono"
                        />
                    </div>

                    {/* Local Path */}
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Local Cache Path</label>
                        <input
                            type="text"
                            value={cachedDataLocalPath}
                            onChange={e => setCachedDataLocalPath(e.target.value)}
                            placeholder="/cache/mcpCachedData.json"
                            className="text-sm border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400 transition-all font-mono"
                        />
                    </div>

                    {/* Size Limit */}
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Size Limit (MB)</label>
                        <div className="flex items-center gap-3">
                            <input
                                type="number"
                                min="1"
                                max="100"
                                value={cachedDataLimitMB}
                                onChange={e => setCachedDataLimitMB(e.target.value)}
                                className="w-28 text-sm border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400 transition-all font-mono"
                            />
                            <p className="text-xs text-slate-500 dark:text-slate-400">Limit for remote data fetching.</p>
                        </div>
                    </div>

                    {/* Save settings */}
                    <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
                        <button
                            onClick={handleSaveCachedDataSettings}
                            className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all text-white shadow-lg shadow-blue-500/20 ${cachedDataSaved ? 'bg-emerald-500' : 'bg-blue-600 hover:bg-blue-700'}`}
                        >
                            {cachedDataSaved ? '✓ Saved!' : 'Save Cache Settings'}
                        </button>
                    </div>

                    {/* Generate Cache from live MCP */}
                    <div className="border-t border-slate-100 dark:border-slate-800 pt-5 flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Generate Cache from Live MCP</p>
                            </div>
                            <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                                {generatedJson && (
                                    <button
                                        onClick={handleDownloadCache}
                                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all text-white bg-emerald-500 hover:bg-emerald-600"
                                    >
                                        <Download size={15} /> Download
                                    </button>
                                )}
                                <button
                                    onClick={handleGenerateCache}
                                    disabled={isGenerating || cacheMode}
                                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all text-white bg-blue-500 hover:bg-blue-600 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-600 disabled:cursor-not-allowed"
                                >
                                    {isGenerating ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                                    {isGenerating ? 'Generating…' : 'Generate'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Appearance */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
                <div className="p-5 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <CircleHelp size={16} className="text-blue-500" />
                        <span className="font-bold text-slate-800 dark:text-white">Help</span>
                    </div>
                    <a
                        href="https://www.tavro.ai/wp-content/uploads/2026/04/Tavro_2.1-Getting-Started-User-Guide.pdf"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center p-2 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-700 transition-colors"
                        title="Open guide in new tab"
                    >
                        <ExternalLink size={16} />
                    </a>
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
