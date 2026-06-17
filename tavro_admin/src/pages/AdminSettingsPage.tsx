import React, { useState, useEffect, useCallback } from 'react';
import {
    Settings, Sun, Moon, Monitor, BotMessageSquare, CheckCircle2,
    Eye, EyeOff, Loader2, ChevronDown,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { PROVIDER_LABELS, PROVIDER_HINTS, type LLMProvider } from '../services/llmService';

type ThemeMode = 'light' | 'dark' | 'system';
const ALL_PROVIDERS: LLMProvider[] = ['github_copilot', 'openai', 'azure_openai', 'anthropic'];
const themeOptions: { mode: ThemeMode; label: string; icon: React.ReactNode; description: string }[] = [
    { mode: 'light',  label: 'Light',  icon: <Sun size={20} />,     description: 'Always use light mode' },
    { mode: 'dark',   label: 'Dark',   icon: <Moon size={20} />,    description: 'Always use dark mode' },
    { mode: 'system', label: 'System', icon: <Monitor size={20} />, description: 'Follow system preference' },
];
const inputClass =
    'text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 ' +
    'text-slate-800 dark:text-slate-100 rounded-lg px-3 py-2 outline-none ' +
    'focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-all w-full';

// ── Chat AI Configuration ──────────────────────────────────────────────────────

const PROVIDER_FIELDS: Record<LLMProvider, { key: string; label: string; type: 'text' | 'password'; placeholder?: string }[]> = {
    github_copilot: [
        { key: 'token',   label: 'GitHub Copilot Token', type: 'password', placeholder: 'Paste your GitHub Copilot token' },
    ],
    openai: [
        { key: 'api_key', label: 'API Key',              type: 'password', placeholder: 'sk-...' },
    ],
    azure_openai: [
        { key: 'base_url', label: 'Azure Endpoint / Base URL', type: 'text',     placeholder: 'https://your-resource.openai.azure.com' },
        { key: 'api_key',  label: 'API Key',                   type: 'password', placeholder: 'Paste your Azure API key' },
    ],
    anthropic: [
        { key: 'api_key', label: 'API Key',              type: 'password', placeholder: 'sk-ant-...' },
    ],
};

const ChatAiSection: React.FC = () => {
    const [selected,    setSelected]    = useState<LLMProvider>('github_copilot');
    const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
    const [showFields,  setShowFields]  = useState<Record<string, boolean>>({});
    const [loading,     setLoading]     = useState(false);
    const [saveState,   setSaveState]   = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [error,       setError]       = useState<string | null>(null);

    const loadProvider = useCallback(async (provider: LLMProvider) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/v1/admin/llm-keys/${provider}`);
            if (res.ok) setFieldValues(await res.json());
        } catch { /* silently ignore — user can type manually */ }
        finally { setLoading(false); }
    }, []);

    useEffect(() => {
        setFieldValues({});
        setShowFields({});
        loadProvider(selected);
    }, [selected, loadProvider]);

    const handleSave = async () => {
        setSaveState('saving');
        setError(null);
        try {
            const res = await fetch(`/api/v1/admin/llm-keys/${selected}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credentials: fieldValues }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error((data as { detail?: string }).detail ?? 'Save failed');
            }
            setSaveState('saved');
            setTimeout(() => setSaveState('idle'), 2500);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Save failed');
            setSaveState('error');
            setTimeout(() => setSaveState('idle'), 3000);
        }
    };

    const configured = Object.values(fieldValues).some(v => v.trim() !== '');
    const fields = PROVIDER_FIELDS[selected];

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center gap-2">
                <BotMessageSquare size={16} className="text-blue-500" />
                <span className="font-bold text-slate-800 dark:text-white">Tavro AI Assistant Settings - Chat AI Configuration</span>
            </div>
            <div className="p-5 flex flex-col gap-5">
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Configure API keys for each provider. Keys are stored in the project .env file.
                </p>

                {/* Provider dropdown */}
                <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Provider Type</label>
                    <div className="relative">
                        <select value={selected} onChange={e => setSelected(e.target.value as LLMProvider)}
                            className={`${inputClass} appearance-none pr-8 cursor-pointer font-medium`}>
                            {ALL_PROVIDERS.map(p => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">{PROVIDER_HINTS[selected]}</span>
                        {!loading && (configured
                            ? <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={10} /> Configured</span>
                            : <span className="text-[10px] text-slate-400 dark:text-slate-500">Not configured</span>
                        )}
                    </div>
                </div>

                {/* Fields */}
                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> Loading…</div>
                ) : (
                    fields.map(field => (
                        <div key={field.key} className="flex flex-col gap-1.5">
                            <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                {field.label}
                            </label>
                            {field.type === 'password' ? (
                                <div className="relative">
                                    <input
                                        type={showFields[field.key] ? 'text' : 'password'}
                                        value={fieldValues[field.key] ?? ''}
                                        onChange={e => setFieldValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                                        placeholder={field.placeholder}
                                        className={`${inputClass} pr-9 font-mono`}
                                    />
                                    <button type="button"
                                        onClick={() => setShowFields(prev => ({ ...prev, [field.key]: !prev[field.key] }))}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                                        {showFields[field.key] ? <EyeOff size={14} /> : <Eye size={14} />}
                                    </button>
                                </div>
                            ) : (
                                <input
                                    type="text"
                                    value={fieldValues[field.key] ?? ''}
                                    onChange={e => setFieldValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                                    placeholder={field.placeholder}
                                    className={inputClass}
                                />
                            )}
                        </div>
                    ))
                )}

                {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}

                <div className="flex justify-end pt-1">
                    <button onClick={handleSave} disabled={saveState === 'saving'}
                        className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-bold text-xs text-white transition-all disabled:opacity-60 disabled:cursor-not-allowed ${saveState === 'saved' ? 'bg-emerald-500' : 'bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20'}`}>
                        {saveState === 'saving' ? <><Loader2 size={11} className="animate-spin" /> Saving…</> : saveState === 'saved' ? '✓ Saved' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ── Main page ──────────────────────────────────────────────────────────────────

const AdminSettingsPage: React.FC = () => {
    const { theme, setTheme } = useTheme();
    return (
        <div className="overflow-auto flex-1 p-6"><div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
            <div>
                <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Settings</h1>
                <p className="text-slate-500 dark:text-slate-500 text-sm mt-1">Platform configuration and preferences</p>
            </div>
            <ChatAiSection />
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center gap-2">
                    <Settings size={16} className="text-slate-500 dark:text-slate-400" />
                    <span className="font-bold text-slate-800 dark:text-white">Appearance</span>
                </div>
                <div className="p-6">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Theme</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">Choose how the admin portal looks.</p>
                    <div className="flex gap-3">
                        {themeOptions.map(({ mode, label, icon, description }) => (
                            <button key={mode} onClick={() => setTheme(mode)}
                                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all flex-1 ${theme === mode
                                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'}`}>
                                {icon}
                                <span className="text-xs font-bold">{label}</span>
                                <span className="text-[10px] text-center leading-tight opacity-70">{description}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div></div>
    );
};

export default AdminSettingsPage;
