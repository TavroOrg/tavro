import React, { useState, useEffect, useCallback } from 'react';
import {
    ChevronRight, Play, RotateCcw, CheckCircle2, AlertCircle,
    Eye, EyeOff, FileJson, Loader2, Info, ExternalLink, Clock, Save, Building2,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectorField {
    key: string;
    label: string;
    type: 'text' | 'password';
    placeholder?: string;
}

interface ConnectorDef {
    id: string;
    name: string;
    description: string;
    category: string;
    initials: string;
    color: string;
    note?: string;
    fields: ConnectorField[];
}

type RunStatus = 'idle' | 'running' | 'success' | 'error';

interface ExtractedAgent {
    filename:   string;
    agent_id:   string;
    agent_name: string;
}

interface ExtractedApplication {
    name:                     string;
    business_application_id:  string;
}

interface ExtractedProcess {
    name:                string;
    business_process_id: string;
}

interface RunResult {
    status:            RunStatus;
    count?:            number;
    agents_extracted?: ExtractedAgent[];
    risk_queued?:      number;
    applications?:     ExtractedApplication[];
    processes?:        ExtractedProcess[];
    error?:            string;
    // legacy — not displayed
    files_saved?:      string[];
    logs?:             string;
}

type ServiceNowMode = 'agents' | 'business_applications' | 'business_processes';

// ---------------------------------------------------------------------------
// Static connector definitions (mirrors admin_connectors.py)
// ---------------------------------------------------------------------------

const CONNECTORS: ConnectorDef[] = [
    {
        id: 'copilot', name: 'Microsoft Copilot', description: 'Azure Copilot Studio bots and agents',
        category: 'Microsoft Azure', initials: 'MC', color: 'from-blue-500 to-blue-700',
        fields: [
            { key: 'client_id',     label: 'Client ID',        type: 'text' },
            { key: 'client_secret', label: 'Client Secret',    type: 'password' },
            { key: 'tenant_id',     label: 'Tenant ID',        type: 'text' },
            { key: 'scope',         label: 'Scope',            type: 'text', placeholder: 'https://org.crm.dynamics.com/.default' },
            { key: 'org_url',       label: 'Organization URL', type: 'text', placeholder: 'https://org.crm.dynamics.com' },
        ],
    },
    {
        id: 'bedrock', name: 'AWS Bedrock', description: 'Amazon Bedrock agents and knowledge bases',
        category: 'Amazon Web Services', initials: 'AB', color: 'from-orange-500 to-orange-700',
        fields: [
            { key: 'access_key', label: 'Access Key ID',     type: 'text' },
            { key: 'secret_key', label: 'Secret Access Key', type: 'password' },
            { key: 'region',     label: 'Region',            type: 'text', placeholder: 'us-east-2' },
        ],
    },
    {
        id: 'salesforce', name: 'Salesforce', description: 'Salesforce Einstein AI agents and bots',
        category: 'Salesforce', initials: 'SF', color: 'from-sky-500 to-sky-700',
        fields: [
            { key: 'instance_url', label: 'Instance URL', type: 'text',     placeholder: 'https://myorg.my.salesforce.com' },
            { key: 'api_version',  label: 'API Version',  type: 'text',     placeholder: 'v59.0' },
            { key: 'access_token', label: 'Access Token', type: 'password' },
        ],
    },
    {
        id: 'servicenow', name: 'ServiceNow', description: 'ServiceNow AI agents and workflows',
        category: 'ServiceNow', initials: 'SN', color: 'from-green-500 to-green-700',
        fields: [
            { key: 'instance_url', label: 'Instance URL', type: 'text',     placeholder: 'https://myinstance.service-now.com' },
            { key: 'username',     label: 'Username',     type: 'text' },
            { key: 'password',     label: 'Password',     type: 'password' },
        ],
    },
    {
        id: 'snowflake', name: 'Snowflake', description: 'Snowflake Cortex AI agents',
        category: 'Snowflake', initials: 'SW', color: 'from-cyan-500 to-cyan-700',
        fields: [
            { key: 'account',   label: 'Account URL',  type: 'text',     placeholder: 'https://account.snowflakecomputing.com' },
            { key: 'database',  label: 'Database',     type: 'text' },
            { key: 'schema',    label: 'Schema',       type: 'text' },
            { key: 'token',     label: 'Bearer Token', type: 'password' },
        ],
    },
    {
        id: 'databricks', name: 'Databricks', description: 'Databricks model serving endpoints',
        category: 'Databricks', initials: 'DB', color: 'from-red-500 to-red-700',
        fields: [
            { key: 'workspace_url',    label: 'Workspace URL', type: 'text',     placeholder: 'https://dbc-xxx.azuredatabricks.net' },
            { key: 'databricks_token', label: 'Access Token',  type: 'password' },
        ],
    },
    {
        id: 'gemini', name: 'Google Gemini', description: 'Google Vertex AI Agent Builder agents',
        category: 'Google Cloud', initials: 'GG', color: 'from-yellow-500 to-yellow-700',
        note: "Fill in your OAuth credentials, click 'Get Authorization URL', authorize with Google, then paste the code into Authorization Code.",
        fields: [
            { key: 'client_id',     label: 'Client ID',           type: 'text' },
            { key: 'client_secret', label: 'Client Secret',        type: 'password' },
            { key: 'project_id',    label: 'Project ID',           type: 'text' },
            { key: 'collection_id', label: 'Collection ID',        type: 'text' },
            { key: 'engine_id',     label: 'Engine ID',            type: 'text' },
            { key: 'auth_uri',      label: 'Auth URI',             type: 'text', placeholder: 'https://accounts.google.com/o/oauth2/auth' },
            { key: 'token_uri',     label: 'Token URI',            type: 'text', placeholder: 'https://oauth2.googleapis.com/token' },
            { key: 'auth_code',     label: 'Authorization Code',   type: 'text', placeholder: 'Paste the code from the redirect URL' },
        ],
    },
    {
        id: 'github', name: 'GitHub MCP', description: 'GitHub MCP server tools and prompts',
        category: 'GitHub', initials: 'GH', color: 'from-slate-500 to-slate-700',
        fields: [
            { key: 'base_url', label: 'MCP Server URL', type: 'text',     placeholder: 'https://api.githubcopilot.com/mcp/' },
            { key: 'token',    label: 'Token',          type: 'password' },
        ],
    },
];

// ---------------------------------------------------------------------------
// Small sub-components
// ---------------------------------------------------------------------------

const inputBase =
    'w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 ' +
    'text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 ' +
    'rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all';

function PasswordInput({
    value, onChange, placeholder,
}: {
    value: string; onChange: (v: string) => void; placeholder?: string;
}) {
    const [show, setShow] = useState(false);
    return (
        <div className="relative">
            <input
                type={show ? 'text' : 'password'}
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder ?? '••••••••'}
                className={`${inputBase} pr-10`}
            />
            <button
                type="button"
                onClick={() => setShow(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
                {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const AdminConnectorsPage: React.FC = () => {
    const [selected, setSelected] = useState<string | null>(null);
    const [credentials, setCredentials] = useState<Record<string, Record<string, string>>>({});
    const [runState, setRunState] = useState<Record<string, { status: RunStatus; result?: RunResult }>>({});
    const [geminiAuthUrl, setGeminiAuthUrl] = useState<{ url?: string; loading: boolean; error?: string }>({ loading: false });
    const [credsLoading, setCredsLoading] = useState(false);
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [snMode, setSnMode] = useState<ServiceNowMode>('agents');

    const selectedConnector = CONNECTORS.find(c => c.id === selected) ?? null;

    const getCred = (connId: string, key: string) => credentials[connId]?.[key] ?? '';

    const setCred = (connId: string, key: string, value: string) => {
        setCredentials(prev => ({
            ...prev,
            [connId]: { ...(prev[connId] ?? {}), [key]: value },
        }));
    };

    // Auto-load credentials from .env when a connector is selected
    const loadCredentials = useCallback(async (connId: string) => {
        setCredsLoading(true);
        try {
            const res = await fetch(`/api/v1/admin/connectors/${connId}/credentials`);
            if (res.ok) {
                const data = await res.json();
                setCredentials(prev => ({ ...prev, [connId]: { ...(prev[connId] ?? {}), ...data } }));
            }
        } catch { /* silently ignore — user can type manually */ }
        finally { setCredsLoading(false); }
    }, []);

    useEffect(() => {
        if (selected) loadCredentials(selected);
    }, [selected, loadCredentials]);

    const saveCredentials = async (connId: string) => {
        setSaveState('saving');
        try {
            const res = await fetch(`/api/v1/admin/connectors/${connId}/credentials`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credentials: credentials[connId] ?? {} }),
            });
            setSaveState(res.ok ? 'saved' : 'error');
        } catch { setSaveState('error'); }
        finally { setTimeout(() => setSaveState('idle'), 3000); }
    };

    // Company — must be selected before running any connector
    const companyId   = localStorage.getItem('tavro_active_company_id')   ?? '';
    const companyName = localStorage.getItem('tavro_active_company_name') ?? '';

    // Resolve tenant_id: prefer what was stored at login, fall back to decoding
    // the stored id_token so existing sessions don't need a re-login.
    const tenantId = (() => {
        const stored = localStorage.getItem('tavro_admin_tenant_id');
        if (stored) return stored;
        try {
            const idToken = localStorage.getItem('tavro_admin_id_token');
            if (!idToken) return '';
            const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            // ZITADEL v2+: nested object
            const ro = payload['urn:zitadel:iam:user:resourceowner'];
            if (ro && typeof ro === 'object' && ro.id) return String(ro.id);
            // Flat keys
            return payload['urn:zitadel:iam:user:resourceowner:id']
                || payload['urn:zitadel:iam:org:id']
                || payload['org_id']
                || '';
        } catch { return ''; }
    })();

    const getGeminiAuthUrl = async () => {
        const creds = credentials['gemini'] ?? {};
        setGeminiAuthUrl({ loading: true });
        try {
            const res = await fetch('/api/v1/admin/connectors/gemini/auth-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(tenantId ? { 'x-tenant-id': tenantId } : {}) },
                body: JSON.stringify({
                    client_id:     creds.client_id     ?? '',
                    client_secret: creds.client_secret ?? '',
                    auth_uri:      creds.auth_uri      || 'https://accounts.google.com/o/oauth2/auth',
                    token_uri:     creds.token_uri     || 'https://oauth2.googleapis.com/token',
                }),
            });
            const data = await res.json();
            if (data.auth_url) {
                setGeminiAuthUrl({ loading: false, url: data.auth_url });
            } else {
                setGeminiAuthUrl({ loading: false, error: data.error ?? 'Failed to generate URL' });
            }
        } catch (err: unknown) {
            setGeminiAuthUrl({ loading: false, error: err instanceof Error ? err.message : 'Network error' });
        }
    };

    const runConnector = async (connector: ConnectorDef) => {
        // Company must be selected before running
        if (!companyId) {
            setRunState(prev => ({
                ...prev,
                [connector.id]: {
                    status: 'error',
                    result: { status: 'error', error: 'No company selected. Please go to the Company tab and select a company before running.' },
                },
            }));
            return;
        }

        // Persist credentials to .env before running
        await saveCredentials(connector.id);
        setRunState(prev => ({ ...prev, [connector.id]: { status: 'running' } }));

        const accessToken = localStorage.getItem('tavro_admin_access_token') ?? '';
        const authHeaders = {
            'Content-Type': 'application/json',
            ...(tenantId    ? { 'x-tenant-id':    tenantId }               : {}),
            ...(accessToken ? { 'Authorization':  `Bearer ${accessToken}` } : {}),
            ...(companyId   ? { 'x-company-id':   companyId }              : {}),
            ...(companyName ? { 'x-company-name': companyName }            : {}),
        };

        try {
            const snIntegrationUrl: Record<ServiceNowMode, string | null> = {
                agents:                null,
                business_applications: '/api/v1/admin/integrations/business-applications/run',
                business_processes:    '/api/v1/admin/integrations/business-processes/run',
            };
            const integrationUrl = connector.id === 'servicenow' ? snIntegrationUrl[snMode] : null;
            const url = integrationUrl ?? `/api/v1/admin/connectors/${connector.id}/run`;
            const body = integrationUrl
                ? undefined
                : JSON.stringify({ config: credentials[connector.id] ?? {} });

            const res = await fetch(url, { method: 'POST', headers: authHeaders, body });
            const data: RunResult = await res.json();
            setRunState(prev => ({ ...prev, [connector.id]: { status: data.status as RunStatus, result: data } }));
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Network error';
            setRunState(prev => ({
                ...prev,
                [connector.id]: { status: 'error', result: { status: 'error', error: msg } },
            }));
        }
    };

    const state = selected ? runState[selected] : undefined;
    const isRunning = state?.status === 'running';

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------
    return (
        <div className="flex gap-6 h-full animate-fade-in p-6 overflow-hidden">

            {/* ── LEFT: connector list ─────────────────────────────────────── */}
            <div className="w-72 shrink-0 space-y-2">
                <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-4">Connectors</h1>
                {CONNECTORS.map(c => {
                    const s = runState[c.id];
                    const isActive = selected === c.id;
                    return (
                        <button
                            key={c.id}
                            onClick={() => setSelected(c.id)}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left group
                                ${isActive
                                    ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30'
                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                                }`}
                        >
                            {/* avatar */}
                            <div className={`h-9 w-9 rounded-lg bg-gradient-to-br ${c.color} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                                {c.initials}
                            </div>

                            <div className="flex-1 min-w-0">
                                <p className={`text-sm font-semibold truncate ${isActive ? 'text-blue-700 dark:text-blue-400' : 'text-slate-800 dark:text-white'}`}>
                                    {c.name}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-500 truncate">{c.category}</p>
                            </div>

                            {/* status dot */}
                            {s?.status === 'success' && <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />}
                            {s?.status === 'error'   && <AlertCircle  size={15} className="text-red-500 shrink-0" />}
                            {s?.status === 'running' && <Loader2      size={15} className="text-blue-500 animate-spin shrink-0" />}
                            {(!s || s.status === 'idle') && (
                                <ChevronRight size={15} className="text-slate-300 dark:text-slate-600 group-hover:text-slate-500 dark:group-hover:text-slate-400 shrink-0" />
                            )}
                        </button>
                    );
                })}
            </div>

            {/* ── RIGHT: config + run panel ────────────────────────────────── */}
            {selectedConnector ? (
                <div className="flex-1 min-w-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-6 overflow-y-auto">

                    {/* header */}
                    <div className="flex items-start gap-4">
                        <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${selectedConnector.color} flex items-center justify-center text-white font-bold shrink-0`}>
                            {selectedConnector.initials}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-800 dark:text-white">{selectedConnector.name}</h2>
                            <p className="text-sm text-slate-500 dark:text-slate-500 mt-0.5">{selectedConnector.description}</p>
                        </div>
                    </div>

                    {/* note (Gemini etc.) */}
                    {selectedConnector.note && (
                        <div className="flex gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs">
                            <Info size={14} className="shrink-0 mt-0.5" />
                            {selectedConnector.note}
                        </div>
                    )}

                    {/* credential fields */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
                                Credentials
                            </h3>
                            {credsLoading && <Loader2 size={13} className="animate-spin text-slate-400" />}
                        </div>
                        <div className="grid grid-cols-1 gap-4">
                            {selectedConnector.fields.filter(f => f.key !== 'auth_code').map(field => (
                                <div key={field.key}>
                                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                                        {field.label}
                                    </label>
                                    {field.type === 'password' ? (
                                        <PasswordInput
                                            value={getCred(selectedConnector.id, field.key)}
                                            onChange={v => setCred(selectedConnector.id, field.key, v)}
                                            placeholder={field.placeholder}
                                        />
                                    ) : (
                                        <input
                                            type="text"
                                            value={getCred(selectedConnector.id, field.key)}
                                            onChange={e => setCred(selectedConnector.id, field.key, e.target.value)}
                                            placeholder={field.placeholder ?? ''}
                                            className={inputBase}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Gemini: Get Authorization URL */}
                    {selectedConnector.id === 'gemini' && (
                        <div className="space-y-3">
                            <button
                                onClick={getGeminiAuthUrl}
                                disabled={geminiAuthUrl.loading}
                                className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-60 disabled:cursor-not-allowed text-slate-700 dark:text-slate-200 font-semibold px-4 py-2 rounded-xl text-sm transition-all border border-slate-200 dark:border-slate-700"
                            >
                                {geminiAuthUrl.loading
                                    ? <><Loader2 size={14} className="animate-spin" /> Generating URL…</>
                                    : <><ExternalLink size={14} /> Get Authorization URL</>
                                }
                            </button>

                            {geminiAuthUrl.url && (
                                <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 space-y-3">
                                    <a
                                        href={geminiAuthUrl.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline break-all"
                                    >
                                        <ExternalLink size={13} className="shrink-0" />
                                        Click here to authorize with Google
                                    </a>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        After authorizing, copy the <code className="bg-white dark:bg-slate-700 px-1 rounded">code=</code> value from the redirect URL and paste it below.
                                    </p>

                                    <div>
                                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                                            Authorization Code
                                        </label>
                                        <input
                                            type="text"
                                            value={getCred('gemini', 'auth_code')}
                                            onChange={e => setCred('gemini', 'auth_code', e.target.value)}
                                            placeholder="Paste the code from the redirect URL"
                                            className={inputBase}
                                        />
                                    </div>

                                    <div className="flex items-center gap-3 pt-1 flex-wrap">
                                        <button
                                            onClick={() => runConnector(selectedConnector)}
                                            disabled={isRunning || saveState === 'saving'}
                                            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-all"
                                        >
                                            {isRunning
                                                ? <><Loader2 size={15} className="animate-spin" /> Running…</>
                                                : <><Play size={15} /> Run Connector</>
                                            }
                                        </button>
                                        <button
                                            onClick={() => saveCredentials(selectedConnector.id)}
                                            disabled={saveState === 'saving' || isRunning}
                                            className="flex items-center gap-2 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 disabled:opacity-60 disabled:cursor-not-allowed text-slate-700 dark:text-slate-200 font-semibold px-4 py-2.5 rounded-xl text-sm transition-all border border-slate-200 dark:border-slate-600"
                                        >
                                            {saveState === 'saving'
                                                ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
                                                : saveState === 'saved'
                                                    ? <><CheckCircle2 size={14} className="text-emerald-500" /> Saved</>
                                                    : saveState === 'error'
                                                        ? <><AlertCircle size={14} className="text-red-500" /> Error</>
                                                        : <><Save size={14} /> Save Credentials</>
                                            }
                                        </button>
                                        {state && state.status !== 'idle' && (
                                            <button
                                                onClick={() => setRunState(prev => ({ ...prev, gemini: { status: 'idle' } }))}
                                                className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
                                            >
                                                <RotateCcw size={13} /> Reset
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {geminiAuthUrl.error && (
                                <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-xs text-red-600 dark:text-red-400">
                                    <AlertCircle size={13} className="shrink-0" />
                                    {geminiAuthUrl.error}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ServiceNow: run mode selector */}
                    {selectedConnector.id === 'servicenow' && (
                        <div className="space-y-2">
                            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
                                What to extract
                            </h3>
                            <div className="flex gap-2">
                                {([
                                    { mode: 'agents',                label: 'Agents',                icon: <FileJson size={14} /> },
                                    { mode: 'business_applications', label: 'Business Applications', icon: <Building2 size={14} /> },
                                    { mode: 'business_processes',    label: 'Business Processes',    icon: <Building2 size={14} /> },
                                ] as { mode: ServiceNowMode; label: string; icon: React.ReactNode }[]).map(opt => (
                                    <button
                                        key={opt.mode}
                                        onClick={() => { setSnMode(opt.mode); setRunState(prev => ({ ...prev, servicenow: { status: 'idle' } })); }}
                                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold border transition-all
                                            ${snMode === opt.mode
                                                ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-300 dark:border-blue-500/40 text-blue-700 dark:text-blue-400'
                                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                                            }`}
                                    >
                                        {opt.icon}
                                        <span className="truncate">{opt.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* run button — hidden for Gemini (shown inside the auth URL block instead) */}
                    {selectedConnector.id !== 'gemini' && (
                        <div className="flex items-center gap-3 pt-2 flex-wrap">
                            <button
                                onClick={() => runConnector(selectedConnector)}
                                disabled={isRunning || saveState === 'saving'}
                                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-all"
                            >
                                {isRunning
                                    ? <><Loader2 size={15} className="animate-spin" /> Running…</>
                                    : <><Play size={15} /> Run Connector</>
                                }
                            </button>

                            <button
                                onClick={() => saveCredentials(selectedConnector.id)}
                                disabled={saveState === 'saving' || isRunning}
                                className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-60 disabled:cursor-not-allowed text-slate-700 dark:text-slate-200 font-semibold px-4 py-2.5 rounded-xl text-sm transition-all border border-slate-200 dark:border-slate-700"
                            >
                                {saveState === 'saving'
                                    ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
                                    : saveState === 'saved'
                                        ? <><CheckCircle2 size={14} className="text-emerald-500" /> Saved</>
                                        : saveState === 'error'
                                            ? <><AlertCircle size={14} className="text-red-500" /> Error</>
                                            : <><Save size={14} /> Save Credentials</>
                                }
                            </button>

                            {state && state.status !== 'idle' && (
                                <button
                                    onClick={() => setRunState(prev => ({ ...prev, [selectedConnector.id]: { status: 'idle' } }))}
                                    className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
                                >
                                    <RotateCcw size={13} /> Reset
                                </button>
                            )}
                        </div>
                    )}

                    {/* result area */}
                    {state && state.status !== 'idle' && state.result && (
                        <div className="space-y-4">
                            {/* success banner */}
                            {state.status === 'success' && (
                                <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                                    <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                                    <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                                        {state.result.processes
                                            ? `Completed — ${state.result.count ?? 0} process${(state.result.count ?? 0) !== 1 ? 'es' : ''} imported`
                                            : state.result.applications
                                                ? `Completed — ${state.result.count ?? 0} application${(state.result.count ?? 0) !== 1 ? 's' : ''} imported`
                                                : `Completed — ${state.result.count ?? 0} agent${(state.result.count ?? 0) !== 1 ? 's' : ''} extracted`
                                        }
                                    </span>
                                </div>
                            )}
                            {state.status === 'error' && (
                                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
                                    <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                                    <span className="text-sm text-red-600 dark:text-red-400 break-all">{state.result.error}</span>
                                </div>
                            )}

                            {/* extracted agents list */}
                            {state.result.agents_extracted && state.result.agents_extracted.length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Extracted Agents</h4>
                                    <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                                        {state.result.agents_extracted.map(a => (
                                            <div key={a.filename} className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2.5">
                                                <FileJson size={14} className="text-blue-500 shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{a.agent_name || a.agent_id}</p>
                                                    <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono truncate mt-0.5">{a.filename}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* imported business applications list */}
                            {state.result.applications && state.result.applications.length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Imported Applications</h4>
                                    <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                                        {state.result.applications.map(app => (
                                            <div key={app.business_application_id} className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2.5">
                                                <Building2 size={14} className="text-green-500 shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{app.name || '—'}</p>
                                                    <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono truncate mt-0.5">{app.business_application_id}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* imported business processes list */}
                            {state.result.processes && state.result.processes.length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Imported Processes</h4>
                                    <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                                        {state.result.processes.map(proc => (
                                            <div key={proc.business_process_id} className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2.5">
                                                <Building2 size={14} className="text-blue-500 shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{proc.name || '—'}</p>
                                                    <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono truncate mt-0.5">{proc.business_process_id}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* risk assessment background notice */}
                            {state.status === 'success' && state.result.risk_queued && state.result.risk_queued > 0 && (
                                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20">
                                    <Clock size={15} className="text-blue-500 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">Risk assessments running in background</p>
                                        <p className="text-xs text-blue-600/80 dark:text-blue-400/70 mt-0.5 leading-relaxed">
                                            Assessments for all {state.result.risk_queued} agent{state.result.risk_queued !== 1 ? 's' : ''} have been queued.
                                            Results will appear in the Agent Catalog once complete.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            ) : (
                /* empty state */
                <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-center p-12">
                    <div className="h-16 w-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                        <Play size={28} className="text-slate-400 dark:text-slate-600" />
                    </div>
                    <p className="text-slate-700 dark:text-slate-300 font-semibold mb-1">Select a connector</p>
                    <p className="text-sm text-slate-400 dark:text-slate-500">
                        Choose a connector from the list, enter your credentials, and click Run.
                    </p>
                </div>
            )}
        </div>
    );
};

export default AdminConnectorsPage;
