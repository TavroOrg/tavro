import React, { useState, useEffect } from 'react';
import {
    Settings, Sun, Moon, Monitor, BotMessageSquare, CheckCircle2,
    Eye, EyeOff, Trash2, Loader2, Link,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import {
    DEFAULT_MODELS, PROVIDER_HINTS, PROVIDER_LABELS, type LLMProvider, type LLMKeyRecord,
    fetchLLMKeys, createLLMKey, updateLLMKey, deleteLLMKey, activateLLMKey,
} from '../services/llmService';
import { adminConfigApi } from '../services/adminConfigApi';

type ThemeMode = 'light' | 'dark' | 'system';

const themeOptions: { mode: ThemeMode; label: string; icon: React.ReactNode; description: string }[] = [
    { mode: 'light',  label: 'Light',  icon: <Sun size={20} />,     description: 'Always use light mode' },
    { mode: 'dark',   label: 'Dark',   icon: <Moon size={20} />,    description: 'Always use dark mode' },
    { mode: 'system', label: 'System', icon: <Monitor size={20} />, description: 'Follow system preference' },
];

const ALL_PROVIDERS: LLMProvider[] = ['openai', 'azure_openai', 'anthropic'];

const PROVIDER_ICONS: Record<LLMProvider, string> = {
    openai:       '🤖',
    azure_openai: '☁️',
    anthropic:    '🧠',
};

type ProviderState = {
    record:           LLMKeyRecord | null;
    model:            string;
    key:              string;
    azureEndpoint:    string;
    azureApiVersion:  string;
    showKey:          boolean;
    saving:           boolean;
    saved:            boolean;
    error:            string | null;
};

function emptyState(p: LLMProvider): ProviderState {
    return {
        record: null, model: DEFAULT_MODELS[p], key: '',
        azureEndpoint: '', azureApiVersion: '',
        showKey: false, saving: false, saved: false, error: null,
    };
}

const inputClass =
    'text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 ' +
    'text-slate-800 dark:text-slate-100 rounded-lg px-3 py-2 outline-none ' +
    'focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-all font-mono';

// ── MCP URL section ────────────────────────────────────────────────────────────

const McpUrlSection: React.FC = () => {
    const [value, setValue] = useState('');
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        adminConfigApi.get('mcp_portal_url')
            .then(entry => {
                setValue(entry.value ?? '');
                setLoaded(true);
            })
            .catch(() => setLoaded(true));
    }, []);

    const handleSave = async () => {
        if (!value.trim()) { setError('MCP URL is required'); return; }
        setSaving(true); setError(null);
        try {
            await adminConfigApi.update('mcp_portal_url', value.trim());
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden transition-colors">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center gap-2">
                <Link size={16} className="text-indigo-500" />
                <span className="font-bold text-slate-800 dark:text-white">MCP Portal URL</span>
            </div>
            <div className="p-5 flex flex-col gap-3">
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    The MCP Portal URL is persisted in the database and made available to connected services.
                </p>
                {!loaded ? (
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                        <Loader2 size={14} className="animate-spin" /> Loading…
                    </div>
                ) : (
                    <>
                        <input
                            type="url"
                            value={value}
                            onChange={e => { setValue(e.target.value); setError(null); }}
                            placeholder="https://mcp.example.com/zitadel/mcp"
                            className={`${inputClass} w-full`}
                        />
                        {error && <p className="text-xs text-red-500">{error}</p>}
                        <div className="flex justify-end">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-bold text-xs transition-all text-white disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 disabled:cursor-not-allowed ${
                                    saved ? 'bg-emerald-500' : 'bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20'
                                }`}
                            >
                                {saving
                                    ? <><Loader2 size={11} className="animate-spin" /> Saving…</>
                                    : saved ? '✓ Saved' : 'Save'
                                }
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

// ── Main settings page ─────────────────────────────────────────────────────────

const AdminSettingsPage: React.FC = () => {
    const { theme, setTheme } = useTheme();

    const [providerStates, setProviderStates] = useState<Record<LLMProvider, ProviderState>>(() => ({
        openai:       emptyState('openai'),
        azure_openai: emptyState('azure_openai'),
        anthropic:    emptyState('anthropic'),
    }));
    const [activeProvider, setActiveProviderState] = useState<LLMProvider | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchLLMKeys()
            .then(keys => {
                setProviderStates(prev => {
                    const next = { ...prev };
                    for (const rec of keys) {
                        next[rec.provider] = {
                            ...emptyState(rec.provider),
                            record: rec,
                            model: rec.model,
                            azureEndpoint:   rec.azure_endpoint   ?? '',
                            azureApiVersion: rec.azure_api_version ?? '',
                        };
                        if (rec.is_active) setActiveProviderState(rec.provider);
                    }
                    return next;
                });
            })
            .finally(() => setLoading(false));
    }, []);

    const updateProvider = (p: LLMProvider, patch: Partial<ProviderState>) =>
        setProviderStates(s => ({ ...s, [p]: { ...s[p], ...patch } }));

    const handleSave = async (p: LLMProvider) => {
        const s = providerStates[p];
        if (!s.record && !s.key.trim()) return;
        updateProvider(p, { saving: true, error: null });
        try {
            let record: LLMKeyRecord;
            if (s.record) {
                const patch: { model?: string; api_key?: string; azure_endpoint?: string; azure_api_version?: string } = { model: s.model };
                if (s.key.trim()) patch.api_key = s.key.trim();
                if (p === 'azure_openai') { patch.azure_endpoint = s.azureEndpoint; patch.azure_api_version = s.azureApiVersion; }
                record = await updateLLMKey(s.record.id, patch);
            } else {
                record = await createLLMKey(
                    p, s.model, s.key.trim(),
                    p === 'azure_openai' ? { azure_endpoint: s.azureEndpoint, azure_api_version: s.azureApiVersion } : undefined,
                );
            }
            updateProvider(p, { record, model: record.model, key: '', saving: false, saved: true });
            setTimeout(() => updateProvider(p, { saved: false }), 2500);
        } catch (err: unknown) {
            updateProvider(p, { saving: false, error: err instanceof Error ? err.message : 'Save failed' });
        }
    };

    const handleClear = async (p: LLMProvider) => {
        const s = providerStates[p];
        if (!s.record) return;
        updateProvider(p, { saving: true, error: null });
        try {
            await deleteLLMKey(s.record.id);
            updateProvider(p, { ...emptyState(p), saving: false });
            if (activeProvider === p) setActiveProviderState(null);
        } catch (err: unknown) {
            updateProvider(p, { saving: false, error: err instanceof Error ? err.message : 'Delete failed' });
        }
    };

    const handleSetActive = async (p: LLMProvider) => {
        const s = providerStates[p];
        if (!s.record) return;
        try {
            await activateLLMKey(s.record.id);
            setActiveProviderState(p);
        } catch { /* ignore */ }
    };

    return (
        <div className="space-y-6 animate-fade-in max-w-2xl">
            <div>
                <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Settings</h1>
                <p className="text-slate-500 dark:text-slate-500 text-sm mt-1">Platform configuration and preferences</p>
            </div>

            {/* ── MCP Portal URL ────────────────────────────────────────────── */}
            <McpUrlSection />

            {/* ── Chat AI Configuration ─────────────────────────────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden transition-colors">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center gap-2">
                    <BotMessageSquare size={16} className="text-blue-500" />
                    <span className="font-bold text-slate-800 dark:text-white">Chat AI Configuration</span>
                </div>
                <div className="p-5 flex flex-col gap-5">
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                        Configure API keys for the GitHub Copilot SDK providers (OpenAI, Azure OpenAI, Anthropic BYOK).
                        Keys are encrypted and stored in the database — never in the browser.
                        Select which provider the chat assistant should use.
                    </p>

                    {loading ? (
                        <div className="flex items-center gap-2 text-sm text-slate-400">
                            <Loader2 size={14} className="animate-spin" /> Loading configured keys…
                        </div>
                    ) : (
                        ALL_PROVIDERS.map(p => {
                            const s = providerStates[p];
                            const isActive = activeProvider === p;
                            const configured = !!s.record;

                            return (
                                <div key={p} className={`rounded-xl border-2 transition-all ${
                                    isActive
                                        ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-900/10'
                                        : 'border-slate-200 dark:border-slate-700'
                                }`}>
                                    {/* header */}
                                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                                        <div className="flex items-center gap-2">
                                            <span className="text-base">{PROVIDER_ICONS[p]}</span>
                                            <span className="font-bold text-sm text-slate-800 dark:text-slate-100">{PROVIDER_LABELS[p]}</span>
                                            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{PROVIDER_HINTS[p]}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {configured && (
                                                <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-full">
                                                    <CheckCircle2 size={10} /> Configured
                                                </span>
                                            )}
                                            {!configured && (
                                                <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-full">
                                                    Not configured
                                                </span>
                                            )}
                                            {isActive && (
                                                <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-2 py-0.5 rounded-full">
                                                    Active
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="p-4 flex flex-col gap-3">
                                        {/* Model */}
                                        <div className="flex flex-col gap-1">
                                            <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Model</label>
                                            <input
                                                type="text"
                                                value={s.model}
                                                onChange={e => updateProvider(p, { model: e.target.value })}
                                                placeholder={DEFAULT_MODELS[p]}
                                                className={`${inputClass} w-full`}
                                            />
                                        </div>

                                        {/* Azure-specific fields */}
                                        {p === 'azure_openai' && (
                                            <>
                                                <div className="flex flex-col gap-1">
                                                    <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Azure Endpoint</label>
                                                    <input
                                                        type="text"
                                                        value={s.azureEndpoint}
                                                        onChange={e => updateProvider(p, { azureEndpoint: e.target.value })}
                                                        placeholder="https://your-resource.openai.azure.com"
                                                        className={`${inputClass} w-full`}
                                                    />
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">API Version</label>
                                                    <input
                                                        type="text"
                                                        value={s.azureApiVersion}
                                                        onChange={e => updateProvider(p, { azureApiVersion: e.target.value })}
                                                        placeholder="2024-02-15-preview"
                                                        className={`${inputClass} w-full`}
                                                    />
                                                </div>
                                            </>
                                        )}

                                        {/* API Key */}
                                        <div className="flex flex-col gap-1">
                                            <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                                API Key {configured && <span className="normal-case font-normal text-slate-400">(leave blank to keep existing)</span>}
                                            </label>
                                            <div className="relative">
                                                <input
                                                    type={s.showKey ? 'text' : 'password'}
                                                    value={s.key}
                                                    onChange={e => updateProvider(p, { key: e.target.value })}
                                                    placeholder={configured ? '••••••••  (key is saved)' : `Paste your ${PROVIDER_LABELS[p]} API key`}
                                                    className={`${inputClass} w-full pr-9`}
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

                                        {s.error && <p className="text-xs text-red-500 dark:text-red-400">{s.error}</p>}

                                        {/* Actions */}
                                        <div className="flex items-center justify-between pt-1">
                                            <button
                                                onClick={() => handleClear(p)}
                                                disabled={!configured || s.saving}
                                                className="flex items-center gap-1 text-xs font-semibold text-rose-500 hover:text-rose-700 disabled:text-slate-300 dark:disabled:text-slate-700 disabled:cursor-not-allowed transition-colors"
                                            >
                                                <Trash2 size={12} /> Clear
                                            </button>
                                            <div className="flex items-center gap-2">
                                                {configured && !isActive && (
                                                    <button
                                                        onClick={() => handleSetActive(p)}
                                                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all"
                                                    >
                                                        Use this LLM
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleSave(p)}
                                                    disabled={s.saving || (!configured && !s.key.trim())}
                                                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-bold text-xs transition-all text-white disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-600 disabled:cursor-not-allowed ${
                                                        s.saved ? 'bg-emerald-500' : 'bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20'
                                                    }`}
                                                >
                                                    {s.saving
                                                        ? <><Loader2 size={11} className="animate-spin" /> Saving…</>
                                                        : s.saved ? '✓ Saved' : 'Save'
                                                    }
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}

                    {/* Active summary */}
                    {!loading && (
                        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 px-4 py-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <BotMessageSquare size={14} className="text-blue-500" />
                                <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Active for chat:</span>
                                {activeProvider ? (
                                    <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400">
                                        {PROVIDER_LABELS[activeProvider]} · {providerStates[activeProvider].model || DEFAULT_MODELS[activeProvider]}
                                    </span>
                                ) : (
                                    <span className="text-xs text-slate-400 italic">None selected — save a provider and click "Use this LLM"</span>
                                )}
                            </div>
                            {activeProvider && (
                                <button
                                    onClick={async () => {
                                        const s = providerStates[activeProvider];
                                        if (s.record) await activateLLMKey(s.record.id).catch(() => {});
                                        setActiveProviderState(null);
                                    }}
                                    className="text-[11px] font-semibold text-rose-500 hover:text-rose-700 transition-colors"
                                >
                                    Unset
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Appearance ───────────────────────────────────────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden transition-colors">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center gap-2">
                    <Settings size={16} className="text-slate-500 dark:text-slate-400" />
                    <span className="font-bold text-slate-800 dark:text-white">Appearance</span>
                </div>
                <div className="p-6">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Theme</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">Choose how the admin portal looks.</p>
                    <div className="flex gap-3">
                        {themeOptions.map(({ mode, label, icon, description }) => (
                            <button
                                key={mode}
                                onClick={() => setTheme(mode)}
                                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all flex-1 ${theme === mode
                                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-700 dark:hover:text-slate-200'
                                }`}
                            >
                                {icon}
                                <span className="text-xs font-bold">{label}</span>
                                <span className="text-[10px] text-center leading-tight opacity-70">{description}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminSettingsPage;
