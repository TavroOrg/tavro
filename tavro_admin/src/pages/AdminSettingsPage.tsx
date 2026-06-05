import React, { useState, useEffect } from 'react';
import {
    Settings, Sun, Moon, Monitor, BotMessageSquare, CheckCircle2,
    Eye, EyeOff, Trash2, Loader2, Link, ChevronDown,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import {
    PROVIDER_LABELS, PROVIDER_HINTS, DEFAULT_MODELS,
    type LLMProvider, type LLMKeyRecord,
    fetchLLMKeys, createLLMKey, updateLLMKey, deleteLLMKey,
} from '../services/llmService';
import { adminConfigApi } from '../services/adminConfigApi';

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

// ── MCP URL ────────────────────────────────────────────────────────────────────

const McpUrlSection: React.FC = () => {
    const [value, setValue]   = useState('');
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved,  setSaved]  = useState(false);
    const [error,  setError]  = useState<string | null>(null);

    useEffect(() => {
        adminConfigApi.get('mcp_portal_url')
            .then(e => { setValue(e.value ?? ''); setLoaded(true); })
            .catch(() => setLoaded(true));
    }, []);

    const handleSave = async () => {
        if (!value.trim()) { setError('MCP URL is required'); return; }
        setSaving(true); setError(null);
        try {
            await adminConfigApi.update('mcp_portal_url', value.trim());
            setSaved(true); setTimeout(() => setSaved(false), 2500);
        } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Save failed'); }
        finally { setSaving(false); }
    };

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center gap-2">
                <Link size={16} className="text-indigo-500" />
                <span className="font-bold text-slate-800 dark:text-white">MCP Portal URL</span>
            </div>
            <div className="p-5 flex flex-col gap-3">
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    The MCP Portal URL is persisted in the database and made available to connected services.
                </p>
                {!loaded ? (
                    <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> Loading…</div>
                ) : (
                    <>
                        <input type="url" value={value} onChange={e => { setValue(e.target.value); setError(null); }}
                            placeholder="https://mcp.example.com/zitadel/mcp" className={inputClass} />
                        {error && <p className="text-xs text-red-500">{error}</p>}
                        <div className="flex justify-end">
                            <button onClick={handleSave} disabled={saving}
                                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-bold text-xs text-white transition-all disabled:cursor-not-allowed disabled:opacity-50 ${saved ? 'bg-emerald-500' : 'bg-blue-600 hover:bg-blue-700'}`}>
                                {saving ? <><Loader2 size={11} className="animate-spin" /> Saving…</> : saved ? '✓ Saved' : 'Save'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

// ── Chat AI Configuration ──────────────────────────────────────────────────────

type ProviderFormState = {
    key: string; showKey: boolean; model: string;
    azureEndpoint: string; azureApiVersion: string;
    saving: boolean; saved: boolean; error: string | null;
};

function emptyForm(p: LLMProvider): ProviderFormState {
    return { key: '', showKey: false, model: DEFAULT_MODELS[p], azureEndpoint: '', azureApiVersion: '', saving: false, saved: false, error: null };
}

const ChatAiSection: React.FC = () => {
    const [records, setRecords]   = useState<Partial<Record<LLMProvider, LLMKeyRecord>>>({});
    const [selected, setSelected] = useState<LLMProvider>('github_copilot');
    const [form, setForm]         = useState<ProviderFormState>(emptyForm('github_copilot'));
    const [loading, setLoading]   = useState(true);

    useEffect(() => {
        fetchLLMKeys().then(keys => {
            const map: Partial<Record<LLMProvider, LLMKeyRecord>> = {};
            keys.forEach(k => { map[k.provider] = k; });
            setRecords(map);
        }).finally(() => setLoading(false));
    }, []);

    const handleProviderChange = (p: LLMProvider) => {
        setSelected(p);
        const rec = records[p];
        setForm({ ...emptyForm(p), model: rec?.model ?? DEFAULT_MODELS[p], azureEndpoint: rec?.azure_endpoint ?? '', azureApiVersion: rec?.azure_api_version ?? '' });
    };

    const patch = (partial: Partial<ProviderFormState>) => setForm(f => ({ ...f, ...partial }));

    const handleSave = async () => {
        if (!form.key.trim() && !records[selected]) return;
        patch({ saving: true, error: null });
        try {
            let rec: LLMKeyRecord;
            const existing = records[selected];
            if (existing) {
                const p: { model?: string; api_key?: string; azure_endpoint?: string; azure_api_version?: string } = { model: form.model };
                if (form.key.trim()) p.api_key = form.key.trim();
                if (selected === 'azure_openai') { p.azure_endpoint = form.azureEndpoint; p.azure_api_version = form.azureApiVersion; }
                rec = await updateLLMKey(existing.id, p);
            } else {
                rec = await createLLMKey(selected, form.model, form.key.trim(),
                    selected === 'azure_openai' ? { azure_endpoint: form.azureEndpoint, azure_api_version: form.azureApiVersion } : undefined);
            }
            setRecords(r => ({ ...r, [selected]: rec }));
            patch({ key: '', saving: false, saved: true });
            setTimeout(() => patch({ saved: false }), 2500);
        } catch (e: unknown) { patch({ saving: false, error: e instanceof Error ? e.message : 'Save failed' }); }
    };

    const handleClear = async () => {
        const existing = records[selected];
        if (!existing) return;
        patch({ saving: true, error: null });
        try {
            await deleteLLMKey(existing.id);
            setRecords(r => { const n = { ...r }; delete n[selected]; return n; });
            patch({ ...emptyForm(selected), saving: false });
        } catch (e: unknown) { patch({ saving: false, error: e instanceof Error ? e.message : 'Delete failed' }); }
    };

    const configured = !!records[selected];

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center gap-2">
                <BotMessageSquare size={16} className="text-blue-500" />
                <span className="font-bold text-slate-800 dark:text-white">Tavro AI Assistant Settings - Chat AI Configuration</span>
            </div>
            <div className="p-5 flex flex-col gap-5">
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Configure API keys for each provider. Keys are encrypted and stored in the database — never in the browser.
                </p>
                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> Loading configured keys…</div>
                ) : (
                    <>
                        {/* Provider dropdown */}
                        <div className="flex flex-col gap-1.5">
                            <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Provider Type</label>
                            <div className="relative">
                                <select value={selected} onChange={e => handleProviderChange(e.target.value as LLMProvider)}
                                    className={`${inputClass} appearance-none pr-8 cursor-pointer font-medium`}>
                                    {ALL_PROVIDERS.map(p => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
                                </select>
                                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-slate-400 dark:text-slate-500">{PROVIDER_HINTS[selected]}</span>
                                {configured
                                    ? <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={10} /> Configured</span>
                                    : <span className="text-[10px] text-slate-400 dark:text-slate-500">Not configured</span>
                                }
                            </div>
                        </div>

                        {/* GitHub Copilot */}
                        {selected === 'github_copilot' && (
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                    GitHub Copilot Token {configured && <span className="normal-case font-normal text-slate-400">(leave blank to keep existing)</span>}
                                </label>
                                <div className="relative">
                                    <input type={form.showKey ? 'text' : 'password'} value={form.key} onChange={e => patch({ key: e.target.value })}
                                        placeholder={configured ? '••••••••  (token is saved)' : 'Paste your GitHub Copilot token'}
                                        className={`${inputClass} pr-9 font-mono`} />
                                    <button type="button" onClick={() => patch({ showKey: !form.showKey })}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                                        {form.showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* OpenAI */}
                        {selected === 'openai' && (<>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Model</label>
                                <input type="text" value={form.model} onChange={e => patch({ model: e.target.value })} placeholder={DEFAULT_MODELS.openai} className={inputClass} />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                    API Key {configured && <span className="normal-case font-normal text-slate-400">(leave blank to keep existing)</span>}
                                </label>
                                <div className="relative">
                                    <input type={form.showKey ? 'text' : 'password'} value={form.key} onChange={e => patch({ key: e.target.value })}
                                        placeholder={configured ? '••••••••  (key is saved)' : 'Paste your OpenAI API key'} className={`${inputClass} pr-9 font-mono`} />
                                    <button type="button" onClick={() => patch({ showKey: !form.showKey })} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                        {form.showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                                    </button>
                                </div>
                            </div>
                        </>)}

                        {/* Azure OpenAI */}
                        {selected === 'azure_openai' && (<>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Deployment / Model</label>
                                <input type="text" value={form.model} onChange={e => patch({ model: e.target.value })} placeholder={DEFAULT_MODELS.azure_openai} className={inputClass} />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Azure Endpoint</label>
                                <input type="text" value={form.azureEndpoint} onChange={e => patch({ azureEndpoint: e.target.value })} placeholder="https://your-resource.openai.azure.com" className={inputClass} />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">API Version</label>
                                <input type="text" value={form.azureApiVersion} onChange={e => patch({ azureApiVersion: e.target.value })} placeholder="2024-02-15-preview" className={inputClass} />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                    API Key {configured && <span className="normal-case font-normal text-slate-400">(leave blank to keep existing)</span>}
                                </label>
                                <div className="relative">
                                    <input type={form.showKey ? 'text' : 'password'} value={form.key} onChange={e => patch({ key: e.target.value })}
                                        placeholder={configured ? '••••••••  (key is saved)' : 'Paste your Azure API key'} className={`${inputClass} pr-9 font-mono`} />
                                    <button type="button" onClick={() => patch({ showKey: !form.showKey })} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                        {form.showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                                    </button>
                                </div>
                            </div>
                        </>)}

                        {/* Anthropic */}
                        {selected === 'anthropic' && (<>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Model</label>
                                <input type="text" value={form.model} onChange={e => patch({ model: e.target.value })} placeholder={DEFAULT_MODELS.anthropic} className={inputClass} />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                    API Key {configured && <span className="normal-case font-normal text-slate-400">(leave blank to keep existing)</span>}
                                </label>
                                <div className="relative">
                                    <input type={form.showKey ? 'text' : 'password'} value={form.key} onChange={e => patch({ key: e.target.value })}
                                        placeholder={configured ? '••••••••  (key is saved)' : 'Paste your Anthropic API key'} className={`${inputClass} pr-9 font-mono`} />
                                    <button type="button" onClick={() => patch({ showKey: !form.showKey })} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                        {form.showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                                    </button>
                                </div>
                            </div>
                        </>)}

                        {form.error && <p className="text-xs text-red-500 dark:text-red-400">{form.error}</p>}

                        <div className="flex items-center justify-between pt-1">
                            <button onClick={handleClear} disabled={!configured || form.saving}
                                className="flex items-center gap-1 text-xs font-semibold text-rose-500 hover:text-rose-700 disabled:text-slate-300 dark:disabled:text-slate-700 disabled:cursor-not-allowed transition-colors">
                                <Trash2 size={12} /> Clear
                            </button>
                            <button onClick={handleSave} disabled={form.saving || (!configured && !form.key.trim())}
                                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-bold text-xs text-white transition-all disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 disabled:cursor-not-allowed ${form.saved ? 'bg-emerald-500' : 'bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20'}`}>
                                {form.saving ? <><Loader2 size={11} className="animate-spin" /> Saving…</> : form.saved ? '✓ Saved' : 'Save'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

// ── Main page ──────────────────────────────────────────────────────────────────

const AdminSettingsPage: React.FC = () => {
    const { theme, setTheme } = useTheme();
    return (
        <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
            <div>
                <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Settings</h1>
                <p className="text-slate-500 dark:text-slate-500 text-sm mt-1">Platform configuration and preferences</p>
            </div>
            <McpUrlSection />
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
        </div>
    );
};

export default AdminSettingsPage;
