import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    ChevronRight, ChevronDown, Play, RotateCcw, CheckCircle2, AlertCircle,
    Eye, EyeOff, FileJson, Loader2, Info, ExternalLink, Clock, Save, Building2, Search,
    Bot, AppWindow, Workflow, Plug,
} from 'lucide-react';
import logoServicenow  from '../assets/logos/logo-servicenow.png';
import logoMicrosoft   from '../assets/logos/logo-microsoft.png';
import logoAws         from '../assets/logos/logo-aws.png';
import logoSalesforce  from '../assets/logos/logo-salesforce.png';
import logoSnowflake   from '../assets/logos/logo-snowflake.png';
import logoDatabricks  from '../assets/logos/logo-databricks.png';
import logoGoogle      from '../assets/logos/logo-google.png';
import logoGithub      from '../assets/logos/logo-github.png';
import logoCopilot     from '../assets/logos/logo-copilot.png';
import logoAgent365    from '../assets/logos/logo-agent365.png';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ConnectorField {
    key: string;
    label: string;
    type: 'text' | 'password';
    placeholder?: string;
}

type RunStatus = 'idle' | 'running' | 'success' | 'error';

interface ExtractedAgent {
    filename:   string;
    agent_id:   string;
    agent_name: string;
}

interface ExtractedApplication {
    name:                    string;
    business_application_id: string;
}

interface ExtractedProcess {
    name:               string;
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
    files_saved?:      string[];
    logs?:             string;
}

type ServiceNowMode = 'agents' | 'business_applications' | 'business_processes';

type DeviceCodePhase = 'idle' | 'loading' | 'waiting' | 'done' | 'error';

interface DeviceCodeState {
    phase:           DeviceCodePhase;
    userCode?:       string;
    verificationUri?: string;
    deviceCode?:     string;
    message?:        string;
}

interface ProviderCapability {
    id:              string;
    connectorId:     string;
    name:            string;
    description:     string;
    snMode?:         ServiceNowMode;
    useSharedCreds?: boolean;
    note?:           string;
    fields?:         ConnectorField[];
    isGemini?:       boolean;
    isAgent365?:     boolean;
    capLogo?:        string;
    capIcon?:        React.ReactNode;
    runName?:        string;
}

interface ProviderDef {
    id:                 string;
    name:               string;
    description:        string;
    initials:           string;
    color:              string;
    sharedConnectorIds?: string[];
    sharedFields?:      ConnectorField[];
    gridLayout?:        boolean;
    capabilities:       ProviderCapability[];
}

// ── Provider definitions ────────────────────────────────────────────────────────

const PROVIDERS: ProviderDef[] = [
    {
        id: 'servicenow', name: 'ServiceNow', description: 'IT service management platform',
        initials: 'SN', color: 'from-green-500 to-green-700',
        sharedConnectorIds: ['servicenow'],
        sharedFields: [
            { key: 'instance_url', label: 'Instance URL', type: 'text',     placeholder: 'https://myinstance.service-now.com' },
            { key: 'username',     label: 'Username',     type: 'text' },
            { key: 'password',     label: 'Password',     type: 'password' },
        ],
        capabilities: [
            { id: 'sn_agents', connectorId: 'servicenow',   name: 'Agent discovery',               description: 'Extract AI agents registered in ServiceNow',                   snMode: 'agents',                useSharedCreds: true, capIcon: <Bot       size={18} className="text-blue-500" /> },
            { id: 'sn_aict',   connectorId: 'aict_inbound', name: 'AICT agent discovery',          description: 'Extract AI agents registered via ServiceNow AI Control Tower', useSharedCreds: true,             capIcon: <Bot       size={18} className="text-blue-500" /> },
            { id: 'sn_apps',   connectorId: 'servicenow',   name: 'Business Application Discovery', description: 'Export Business Application from CMDB Application',          snMode: 'business_applications', useSharedCreds: true, capIcon: <AppWindow size={18} className="text-violet-500" /> },
            { id: 'sn_procs',  connectorId: 'servicenow',   name: 'Business Process Discovery',     description: 'Export Business Process from CMDB Application',              snMode: 'business_processes',    useSharedCreds: true, capIcon: <Workflow  size={18} className="text-amber-500" /> },
        ],
    },
    {
        id: 'microsoft', name: 'Microsoft', description: 'Azure and Copilot Studio',
        initials: 'MS', color: 'from-blue-500 to-blue-700',
        gridLayout: true,
        capabilities: [
            {
                id: 'copilot', connectorId: 'copilot', name: 'Microsoft Copilot', description: 'Azure Copilot Studio bots and agents',
                capLogo: logoCopilot, runName: 'Agent Discovery', capIcon: <Bot size={18} className="text-blue-500" />,
                fields: [
                    { key: 'client_id',     label: 'Client ID',        type: 'text' },
                    { key: 'client_secret', label: 'Client Secret',    type: 'password' },
                    { key: 'tenant_id',     label: 'Tenant ID',        type: 'text' },
                    { key: 'scope',         label: 'Scope',            type: 'text', placeholder: 'https://org.crm.dynamics.com/.default' },
                    { key: 'org_url',       label: 'Organization URL', type: 'text', placeholder: 'https://org.crm.dynamics.com' },
                ],
            },
            {
                id: 'agent365', connectorId: 'agent365', name: 'Microsoft Agent 365', description: 'Microsoft 365 Admin Center — all agents',
                capLogo: logoAgent365, runName: 'Agent Discovery', capIcon: <Bot size={18} className="text-blue-500" />,
                isAgent365: true,
                note: 'Requires Microsoft delegated sign-in. Save credentials, then complete Device Code authentication.',
                fields: [
                    { key: 'tenant_id',     label: 'Azure Tenant ID',     type: 'text' },
                    { key: 'client_id',     label: 'Azure Client ID',     type: 'text' },
                    { key: 'client_secret', label: 'Azure Client Secret', type: 'password' },
                ],
            },
        ],
    },
    {
        id: 'aws', name: 'AWS', description: 'Amazon Web Services',
        initials: 'AW', color: 'from-orange-500 to-orange-700',
        capabilities: [{
            id: 'bedrock', connectorId: 'bedrock', name: 'Agent Discovery', description: 'Amazon Bedrock agents and knowledge bases', capIcon: <Bot size={18} className="text-blue-500" />,
            fields: [
                { key: 'access_key', label: 'Access Key ID',     type: 'text' },
                { key: 'secret_key', label: 'Secret Access Key', type: 'password' },
                { key: 'region',     label: 'Region',            type: 'text', placeholder: 'us-east-2' },
            ],
        }],
    },
    {
        id: 'salesforce', name: 'Salesforce', description: 'CRM and Einstein AI',
        initials: 'SF', color: 'from-sky-500 to-sky-700',
        capabilities: [{
            id: 'salesforce', connectorId: 'salesforce', name: 'Agent Discovery', description: 'Salesforce Einstein AI agents and bots', capIcon: <Bot size={18} className="text-blue-500" />,
            fields: [
                { key: 'instance_url', label: 'Instance URL', type: 'text',     placeholder: 'https://myorg.my.salesforce.com' },
                { key: 'api_version',  label: 'API Version',  type: 'text',     placeholder: 'v59.0' },
                { key: 'access_token', label: 'Access Token', type: 'password' },
            ],
        }],
    },
    {
        id: 'snowflake', name: 'Snowflake', description: 'Cloud data warehouse',
        initials: 'SW', color: 'from-cyan-500 to-cyan-700',
        capabilities: [{
            id: 'snowflake', connectorId: 'snowflake', name: 'Agent Discovery', description: 'Snowflake Cortex AI agents', capIcon: <Bot size={18} className="text-blue-500" />,
            fields: [
                { key: 'account',  label: 'Account URL',  type: 'text',     placeholder: 'https://account.snowflakecomputing.com' },
                { key: 'database', label: 'Database',     type: 'text' },
                { key: 'schema',   label: 'Schema',       type: 'text' },
                { key: 'token',    label: 'Bearer Token', type: 'password' },
            ],
        }],
    },
    {
        id: 'databricks', name: 'Databricks', description: 'Lakehouse platform',
        initials: 'DB', color: 'from-red-500 to-red-700',
        capabilities: [{
            id: 'databricks', connectorId: 'databricks', name: 'Agent Discovery', description: 'Databricks model serving endpoints', capIcon: <Bot size={18} className="text-blue-500" />,
            fields: [
                { key: 'workspace_url',    label: 'Workspace URL', type: 'text',     placeholder: 'https://dbc-xxx.azuredatabricks.net' },
                { key: 'databricks_token', label: 'Access Token',  type: 'password' },
            ],
        }],
    },
    {
        id: 'google', name: 'Google', description: 'Google Cloud AI services',
        initials: 'GG', color: 'from-yellow-500 to-yellow-700',
        capabilities: [{
            id: 'gemini', connectorId: 'gemini', name: 'Agent Discovery', description: 'Google Vertex AI Agent Builder agents', capIcon: <Bot size={18} className="text-blue-500" />,
            isGemini: true,
            note: "Fill in your OAuth credentials, click 'Get Authorization URL', authorize with Google, then paste the code into Authorization Code.",
            fields: [
                { key: 'client_id',     label: 'Client ID',     type: 'text' },
                { key: 'client_secret', label: 'Client Secret', type: 'password' },
                { key: 'project_id',    label: 'Project ID',    type: 'text' },
                { key: 'collection_id', label: 'Collection ID', type: 'text' },
                { key: 'engine_id',     label: 'Engine ID',     type: 'text' },
                { key: 'auth_uri',      label: 'Auth URI',      type: 'text', placeholder: 'https://accounts.google.com/o/oauth2/auth' },
                { key: 'token_uri',     label: 'Token URI',     type: 'text', placeholder: 'https://oauth2.googleapis.com/token' },
            ],
        }],
    },
    {
        id: 'github', name: 'GitHub', description: 'Source code and MCP',
        initials: 'GH', color: 'from-slate-600 to-slate-800',
        capabilities: [{
            id: 'github', connectorId: 'github', name: 'MCP Discovery', description: 'GitHub MCP server tools and prompts', capIcon: <Plug size={18} className="text-slate-500" />,
            fields: [
                { key: 'base_url', label: 'MCP Server URL', type: 'text',     placeholder: 'https://api.githubcopilot.com/mcp/' },
                { key: 'token',    label: 'Token',          type: 'password' },
            ],
        }],
    },
];

// ── Provider categories ────────────────────────────────────────────────────────

const PROVIDER_GROUPS: { label: string; ids: string[] }[] = [
    { label: 'Cloud Platforms',  ids: ['microsoft', 'aws', 'google'] },
    { label: 'Enterprise & CRM', ids: ['servicenow', 'salesforce'] },
    { label: 'Data Platforms',   ids: ['snowflake', 'databricks'] },
    { label: 'Developer Tools',  ids: ['github'] },
];

// ── Brand logos (Simple Icons via react-icons) ─────────────────────────────────

const LOGOS: Record<string, { icon: React.ReactNode; bg: string }> = {
    servicenow: { icon: <img src={logoServicenow} alt="ServiceNow" className="w-10 h-10 object-contain" />, bg: 'bg-white dark:bg-slate-800' },
    microsoft:  { icon: <img src={logoMicrosoft}  alt="Microsoft"  className="w-10 h-10 object-contain" />, bg: 'bg-white dark:bg-slate-800' },
    aws:        { icon: <img src={logoAws}         alt="AWS"        className="w-11 h-11 object-contain" />, bg: 'bg-white dark:bg-slate-800' },
    salesforce: { icon: <img src={logoSalesforce}  alt="Salesforce" className="w-10 h-10 object-contain" />, bg: 'bg-white dark:bg-slate-800' },
    snowflake:  { icon: <img src={logoSnowflake}   alt="Snowflake"  className="w-12 h-12 object-contain" />, bg: 'bg-white dark:bg-slate-800' },
    databricks: { icon: <img src={logoDatabricks}  alt="Databricks" className="w-10 h-10 object-contain" />, bg: 'bg-white dark:bg-slate-800' },
    google:     { icon: <img src={logoGoogle}      alt="Google"     className="w-14 h-14 object-contain" />, bg: 'bg-white dark:bg-slate-800' },
    github:     { icon: <img src={logoGithub}      alt="GitHub"     className="w-14 h-14 object-contain" />, bg: 'bg-white dark:bg-slate-800' },
};

// ── Shared styles ──────────────────────────────────────────────────────────────

const inputBase =
    'w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 ' +
    'text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 ' +
    'rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all';

// ── PasswordInput ──────────────────────────────────────────────────────────────

function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
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

// ── SaveButton helper ──────────────────────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function SaveButton({ state, onClick, disabled }: { state: SaveStatus; onClick: () => void; disabled?: boolean }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled || state === 'saving'}
            className="flex items-center gap-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60 disabled:cursor-not-allowed text-slate-700 dark:text-slate-200 font-semibold px-4 py-2 rounded-xl text-sm transition-all border border-slate-200 dark:border-slate-700"
        >
            {state === 'saving' ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
                : state === 'saved'  ? <><CheckCircle2 size={14} className="text-emerald-500" /> Saved</>
                : state === 'error'  ? <><AlertCircle  size={14} className="text-red-500"     /> Error</>
                : <><Save size={14} /> Save credentials</>
            }
        </button>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

const AdminConnectorsPage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const selectedProvider = searchParams.get('provider');
    const selectedCapId    = searchParams.get('cap');
    const setSelectedProvider = (id: string | null) => {
        if (id) setSearchParams({ provider: id }, { replace: false });
        else setSearchParams({}, { replace: false });
    };
    const setSelectedCap = (capId: string | null) => {
        if (capId && selectedProvider) setSearchParams({ provider: selectedProvider, cap: capId }, { replace: false });
        else if (selectedProvider)     setSearchParams({ provider: selectedProvider }, { replace: false });
    };
    const [search, setSearch] = useState('');
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    const toggleGroup = (label: string) =>
        setCollapsedGroups(prev => { const next = new Set(prev); next.has(label) ? next.delete(label) : next.add(label); return next; });
    const [credentials, setCredentials]           = useState<Record<string, Record<string, string>>>({});
    const [runState, setRunState]                 = useState<Record<string, { status: RunStatus; result?: RunResult }>>({});
    const [saveStates, setSaveStates]             = useState<Record<string, SaveStatus>>({});
    const [credsLoading, setCredsLoading]         = useState<Record<string, boolean>>({});
    const [geminiAuthUrl, setGeminiAuthUrl]       = useState<{ url?: string; loading: boolean; error?: string }>({ loading: false });
    const [deviceCodeState, setDeviceCodeState]   = useState<DeviceCodeState>({ phase: 'idle' });

    const provider = PROVIDERS.find(p => p.id === selectedProvider) ?? null;

    const getCred = (connId: string, key: string) => credentials[connId]?.[key] ?? '';
    const setCred = (connId: string, key: string, value: string) =>
        setCredentials(prev => ({ ...prev, [connId]: { ...(prev[connId] ?? {}), [key]: value } }));

    const getSaveState = (key: string): SaveStatus => saveStates[key] ?? 'idle';
    const setSave = (key: string, s: SaveStatus) => {
        setSaveStates(prev => ({ ...prev, [key]: s }));
        if (s === 'saved' || s === 'error') setTimeout(() => setSaveStates(prev => ({ ...prev, [key]: 'idle' })), 3000);
    };

    const loadCredentials = useCallback(async (connId: string) => {
        setCredsLoading(prev => ({ ...prev, [connId]: true }));
        try {
            const res = await fetch(`/api/v1/admin/connectors/${connId}/credentials`);
            if (res.ok) {
                const data = await res.json();
                setCredentials(prev => ({ ...prev, [connId]: { ...(prev[connId] ?? {}), ...data } }));
            }
        } catch { /* ignore */ }
        finally { setCredsLoading(prev => ({ ...prev, [connId]: false })); }
    }, []);

    // Pre-load first connector of each provider so the grid can show configured status
    useEffect(() => {
        PROVIDERS.forEach(p => {
            const firstId = p.sharedConnectorIds?.[0] ?? p.capabilities[0]?.connectorId;
            if (firstId) loadCredentials(firstId);
        });
    }, [loadCredentials]);

    // Load all connectors for the selected provider
    useEffect(() => {
        if (!provider) return;
        const ids = provider.sharedConnectorIds?.length
            ? provider.sharedConnectorIds
            : provider.capabilities.map(c => c.connectorId);
        ids.forEach(id => loadCredentials(id));
        setDeviceCodeState({ phase: 'idle' });
    }, [selectedProvider, provider, loadCredentials]);

    const isProviderConfigured = (p: ProviderDef): boolean => {
        const connId = p.sharedConnectorIds?.[0] ?? p.capabilities[0]?.connectorId;
        if (!connId) return false;
        return Object.values(credentials[connId] ?? {}).some(v => v && v.trim().length > 0);
    };

    const saveCredentials = async (connId: string) => {
        setSave(connId, 'saving');
        try {
            const res = await fetch(`/api/v1/admin/connectors/${connId}/credentials`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credentials: credentials[connId] ?? {} }),
            });
            setSave(connId, res.ok ? 'saved' : 'error');
        } catch { setSave(connId, 'error'); }
    };

    const saveSharedCredentials = async (p: ProviderDef) => {
        const ids = p.sharedConnectorIds ?? [];
        if (!ids.length) return;
        const key = ids[0];
        const sharedCreds = credentials[key] ?? {};
        setSave(key, 'saving');
        try {
            await Promise.all(ids.map(id =>
                fetch(`/api/v1/admin/connectors/${id}/credentials`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ credentials: sharedCreds }),
                })
            ));
            setSave(key, 'saved');
        } catch { setSave(key, 'error'); }
    };

    // Tenant + company from localStorage
    const companyId   = localStorage.getItem('tavro_active_company_id')   ?? '';
    const companyName = localStorage.getItem('tavro_active_company_name') ?? '';

    const tenantId = (() => {
        const stored = localStorage.getItem('tavro_admin_tenant_id');
        if (stored) return stored;
        try {
            const idToken = localStorage.getItem('tavro_admin_id_token');
            if (!idToken) return '';
            const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            const ro = payload['urn:zitadel:iam:user:resourceowner'];
            if (ro && typeof ro === 'object' && ro.id) return String(ro.id);
            return payload['urn:zitadel:iam:user:resourceowner:id'] || payload['urn:zitadel:iam:org:id'] || payload['org_id'] || '';
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
            data.auth_url
                ? setGeminiAuthUrl({ loading: false, url: data.auth_url })
                : setGeminiAuthUrl({ loading: false, error: data.error ?? 'Failed to generate URL' });
        } catch (err: unknown) {
            setGeminiAuthUrl({ loading: false, error: err instanceof Error ? err.message : 'Network error' });
        }
    };

    const startDeviceCode = async () => {
        setDeviceCodeState({ phase: 'loading' });
        const creds = credentials['agent365'] ?? {};
        const accessToken = localStorage.getItem('tavro_admin_access_token') ?? '';
        const authHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization:  `Bearer ${accessToken}` } : {}),
            ...(tenantId    ? { 'x-tenant-id':  tenantId }                : {}),
        };
        try {
            const res = await fetch('/api/v1/admin/connectors/agent365/auth/start', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ credentials: { tenant_id: creds.tenant_id ?? '', client_id: creds.client_id ?? '', client_secret: creds.client_secret ?? '' } }),
            });
            const data = await res.json();
            if (!res.ok) { setDeviceCodeState({ phase: 'error', message: data.detail ?? 'Failed to start sign-in' }); return; }
            const { user_code, verification_uri, device_code } = data;
            setDeviceCodeState({ phase: 'waiting', userCode: user_code, verificationUri: verification_uri, deviceCode: device_code });
            const poll = async () => {
                try {
                    const pr = await fetch('/api/v1/admin/connectors/agent365/auth/poll', {
                        method: 'POST', headers: authHeaders,
                        body: JSON.stringify({ device_code, tenant_id: creds.tenant_id ?? '', client_id: creds.client_id ?? '', client_secret: creds.client_secret ?? '' }),
                    });
                    const pd = await pr.json();
                    if (pr.ok && pd.status === 'ok')    { setDeviceCodeState({ phase: 'done' }); }
                    else if (pd.pending)                 { setTimeout(poll, pd.slow_down ? 10000 : 5000); }
                    else                                 { setDeviceCodeState({ phase: 'error', message: pd.detail ?? pd.error ?? 'Sign-in failed' }); }
                } catch (e: unknown) { setDeviceCodeState({ phase: 'error', message: e instanceof Error ? e.message : 'Network error' }); }
            };
            setTimeout(poll, 5000);
        } catch (e: unknown) {
            setDeviceCodeState({ phase: 'error', message: e instanceof Error ? e.message : 'Network error' });
        }
    };

    const runCapability = async (p: ProviderDef, cap: ProviderCapability) => {
        if (!companyId) {
            setRunState(prev => ({ ...prev, [cap.id]: { status: 'error', result: { status: 'error', error: 'No company selected. Please go to the Company tab and select a company before running.' } } }));
            return;
        }

        if (cap.useSharedCreds && p.sharedConnectorIds?.length) {
            await saveSharedCredentials(p);
        } else {
            await saveCredentials(cap.connectorId);
        }

        setRunState(prev => ({ ...prev, [cap.id]: { status: 'running' } }));

        const creds = cap.useSharedCreds
            ? (credentials[p.sharedConnectorIds![0]] ?? {})
            : (credentials[cap.connectorId] ?? {});

        const accessToken = localStorage.getItem('tavro_admin_access_token') ?? '';
        const authHeaders = {
            'Content-Type':  'application/json',
            ...(tenantId    ? { 'x-tenant-id':    tenantId }               : {}),
            ...(accessToken ? { Authorization:    `Bearer ${accessToken}` } : {}),
            ...(companyId   ? { 'x-company-id':   companyId }              : {}),
            ...(companyName ? { 'x-company-name': companyName }            : {}),
        };

        const snUrls: Record<ServiceNowMode, string | null> = {
            agents:                null,
            business_applications: '/api/v1/admin/integrations/business-applications/run',
            business_processes:    '/api/v1/admin/integrations/business-processes/run',
        };

        const integrationUrl = cap.snMode ? snUrls[cap.snMode] : null;
        const url  = integrationUrl ?? `/api/v1/admin/connectors/${cap.connectorId}/run`;
        const body = integrationUrl ? undefined : JSON.stringify({ config: creds });

        try {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), cap.connectorId === 'agent365' ? 660000 : 120000);
            const res = await fetch(url, { method: 'POST', headers: authHeaders, body, signal: controller.signal });
            const data: RunResult = await res.json();
            setRunState(prev => ({ ...prev, [cap.id]: { status: data.status as RunStatus, result: data } }));
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Network error';
            setRunState(prev => ({ ...prev, [cap.id]: { status: 'error', result: { status: 'error', error: msg } } }));
        }
    };

    // ── Grid view ──────────────────────────────────────────────────────────────

    const filteredProviders = PROVIDERS.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.description.toLowerCase().includes(search.toLowerCase())
    );

    if (!provider) {
        return (
            <div className="h-full overflow-y-auto p-6 animate-fade-in">
                <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-6">Connectors</h1>

                <div className="relative mb-6 max-w-xs">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search providers..."
                        className="w-full pl-9 pr-4 py-2.5 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                    />
                </div>

                <div className="flex flex-col gap-8">
                    {PROVIDER_GROUPS.map(group => {
                        const groupProviders = filteredProviders.filter(p => group.ids.includes(p.id));
                        if (groupProviders.length === 0) return null;
                        const isCollapsed = collapsedGroups.has(group.label);
                        return (
                            <div key={group.label}>
                                <button
                                    onClick={() => toggleGroup(group.label)}
                                    className="flex items-center gap-1.5 mb-3 px-0.5 group cursor-pointer"
                                >
                                    {isCollapsed
                                        ? <ChevronRight size={14} className="text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
                                        : <ChevronDown  size={14} className="text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
                                    }
                                    <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300 uppercase tracking-wider transition-colors">{group.label}</p>
                                </button>
                                {!isCollapsed && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {groupProviders.map(p => {
                                        const configured = isProviderConfigured(p);
                                        const capCount   = p.capabilities.length;
                                        return (
                                            <button
                                                key={p.id}
                                                onClick={() => setSelectedProvider(p.id)}
                                                className="text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-sm transition-all"
                                            >
                                                <div className="flex items-center gap-4 mb-4">
                                                    {LOGOS[p.id] ? (
                                                        <div className={`h-14 w-14 rounded-xl ${LOGOS[p.id].bg} border border-slate-100 dark:border-slate-700 flex items-center justify-center shrink-0 shadow-sm`}>
                                                            {LOGOS[p.id].icon}
                                                        </div>
                                                    ) : (
                                                        <div className={`h-14 w-14 rounded-xl bg-gradient-to-br ${p.color} flex items-center justify-center text-white text-base font-bold shrink-0`}>
                                                            {p.initials}
                                                        </div>
                                                    )}
                                                    <div className="min-w-0">
                                                        <p className="font-semibold text-slate-800 dark:text-white text-base leading-tight">{p.name}</p>
                                                        <p className="text-sm text-slate-500 dark:text-slate-500 mt-1 leading-tight">{p.description}</p>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-1.5">
                                                    {configured
                                                        ? <><CheckCircle2 size={13} className="text-emerald-500 shrink-0" /><span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Configured</span></>
                                                        : <><div className="h-3 w-3 rounded-full border border-slate-300 dark:border-slate-600 shrink-0" /><span className="text-xs text-slate-400 dark:text-slate-500">Not configured</span></>
                                                    }
                                                    <span className="text-slate-300 dark:text-slate-600 text-xs mx-0.5">·</span>
                                                    <span className="text-xs text-slate-400 dark:text-slate-500">{capCount} {capCount === 1 ? 'capability' : 'capabilities'}</span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    // ── Provider detail view ───────────────────────────────────────────────────

    const isShared      = !!provider.sharedConnectorIds?.length;
    const sharedConnId  = provider.sharedConnectorIds?.[0] ?? '';
    const sharedLoading = credsLoading[sharedConnId];
    const anyRunning    = provider.capabilities.some(c => runState[c.id]?.status === 'running');

    // For gridLayout providers: show sub-grid of capability cards, then drill into one
    const selectedCap = provider.gridLayout
        ? (provider.capabilities.find(c => c.id === selectedCapId) ?? null)
        : null;

    // Sub-grid view for gridLayout providers (e.g. Microsoft) when no cap is selected
    if (provider.gridLayout && !selectedCap) {
        return (
            <div className="h-full overflow-y-auto p-6 animate-fade-in">
                {/* Breadcrumb */}
                <div className="flex items-center gap-1.5 text-sm mb-5">
                    <button onClick={() => setSelectedProvider(null)} className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors">
                        Connectors
                    </button>
                    <ChevronRight size={14} className="text-slate-400 dark:text-slate-600 shrink-0" />
                    <span className="text-slate-800 dark:text-white font-medium">{provider.name}</span>
                </div>

                {/* Provider header */}
                <div className="flex items-center gap-4 mb-6">
                    {LOGOS[provider.id] ? (
                        <div className={`rounded-xl ${LOGOS[provider.id].bg} border border-slate-100 dark:border-slate-700 flex items-center justify-center shrink-0 shadow-sm`} style={{ height: 52, width: 52 }}>
                            {LOGOS[provider.id].icon}
                        </div>
                    ) : (
                        <div className={`rounded-xl bg-gradient-to-br ${provider.color} flex items-center justify-center text-white font-bold text-lg shrink-0`} style={{ height: 52, width: 52 }}>
                            {provider.initials}
                        </div>
                    )}
                    <div>
                        <h1 className="text-xl font-bold text-slate-800 dark:text-white">{provider.name}</h1>
                        <p className="text-sm text-slate-500 dark:text-slate-500">{provider.description}</p>
                    </div>
                </div>

                {/* Capability sub-grid */}
                <div className="grid grid-cols-2 gap-4 items-start">
                    {provider.capabilities.map(cap => {
                        const isConfigured = Object.values(credentials[cap.connectorId] ?? {}).some(v => v && v.trim().length > 0);
                        return (
                            <button
                                key={cap.id}
                                onClick={() => setSelectedCap(cap.id)}
                                className="text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-sm transition-all"
                            >
                                <div className="flex items-center gap-4 mb-4">
                                    {cap.capLogo ? (
                                        <div className="h-14 w-14 rounded-xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 flex items-center justify-center shrink-0 shadow-sm">
                                            <img src={cap.capLogo} alt={cap.name} className="w-10 h-10 object-contain" />
                                        </div>
                                    ) : (
                                        <div className={`h-14 w-14 rounded-xl bg-gradient-to-br ${provider.color} flex items-center justify-center text-white text-base font-bold shrink-0`}>
                                            {cap.name.slice(0, 2).toUpperCase()}
                                        </div>
                                    )}
                                    <div className="min-w-0">
                                        <p className="font-semibold text-slate-800 dark:text-white text-base leading-tight">{cap.name}</p>
                                        <p className="text-sm text-slate-500 dark:text-slate-500 mt-1 leading-tight">{cap.description}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    {isConfigured
                                        ? <><CheckCircle2 size={13} className="text-emerald-500 shrink-0" /><span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Configured</span></>
                                        : <><div className="h-3 w-3 rounded-full border border-slate-300 dark:border-slate-600 shrink-0" /><span className="text-xs text-slate-400 dark:text-slate-500">Not configured</span></>
                                    }
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    // For gridLayout providers with a selected cap: show single capability credential form
    const activeCaps    = selectedCap ? [selectedCap] : provider.capabilities;
    const activeAnyRunning = activeCaps.some(c => runState[c.id]?.status === 'running');

    return (
        <div className="h-full overflow-y-auto p-6 animate-fade-in">
            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 text-sm mb-5">
                <button
                    onClick={() => setSelectedProvider(null)}
                    className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
                >
                    Connectors
                </button>
                <ChevronRight size={14} className="text-slate-400 dark:text-slate-600 shrink-0" />
                {selectedCap ? (
                    <>
                        <button
                            onClick={() => setSelectedCap(null)}
                            className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
                        >
                            {provider.name}
                        </button>
                        <ChevronRight size={14} className="text-slate-400 dark:text-slate-600 shrink-0" />
                        <span className="text-slate-800 dark:text-white font-medium">{selectedCap.name}</span>
                    </>
                ) : (
                    <span className="text-slate-800 dark:text-white font-medium">{provider.name}</span>
                )}
            </div>

            {/* Provider header — shows capability logo/name when drilled into a gridLayout cap */}
            <div className="flex items-center gap-4 mb-6">
                {selectedCap?.capLogo ? (
                    <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 flex items-center justify-center shrink-0 shadow-sm" style={{ height: 52, width: 52 }}>
                        <img src={selectedCap.capLogo} alt={selectedCap.name} className="w-9 h-9 object-contain" />
                    </div>
                ) : LOGOS[provider.id] ? (
                    <div className={`rounded-xl ${LOGOS[provider.id].bg} border border-slate-100 dark:border-slate-700 flex items-center justify-center shrink-0 shadow-sm`} style={{ height: 52, width: 52 }}>
                        {LOGOS[provider.id].icon}
                    </div>
                ) : (
                    <div className={`rounded-xl bg-gradient-to-br ${provider.color} flex items-center justify-center text-white font-bold text-lg shrink-0`} style={{ height: 52, width: 52 }}>
                        {provider.initials}
                    </div>
                )}
                <div>
                    <h1 className="text-xl font-bold text-slate-800 dark:text-white">{selectedCap ? selectedCap.name : provider.name}</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-500">{selectedCap ? selectedCap.description : provider.description}</p>
                </div>
            </div>

            <div className="space-y-4">

                {/* Shared credentials section (ServiceNow) */}
                {isShared && provider.sharedFields && (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
                        <div className="flex items-center gap-2 mb-1">
                            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Shared Credentials</p>
                            {sharedLoading && <Loader2 size={12} className="animate-spin text-slate-400" />}
                        </div>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">Used by all {provider.capabilities.length} capabilities below</p>

                        <div className="space-y-3 mb-4">
                            {/* First field (Instance URL) — full width */}
                            {provider.sharedFields.slice(0, 1).map(field => (
                                <div key={field.key}>
                                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">{field.label}</label>
                                    <input type="text" value={getCred(sharedConnId, field.key)} onChange={e => setCred(sharedConnId, field.key, e.target.value)} placeholder={field.placeholder ?? ''} className={inputBase} />
                                </div>
                            ))}
                            {/* Remaining fields (Username + Password) — side by side */}
                            {provider.sharedFields.length > 1 && (
                                <div className="grid grid-cols-2 gap-3">
                                    {provider.sharedFields.slice(1).map(field => (
                                        <div key={field.key}>
                                            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">{field.label}</label>
                                            {field.type === 'password'
                                                ? <PasswordInput value={getCred(sharedConnId, field.key)} onChange={v => setCred(sharedConnId, field.key, v)} placeholder={field.placeholder} />
                                                : <input type="text" value={getCred(sharedConnId, field.key)} onChange={e => setCred(sharedConnId, field.key, e.target.value)} placeholder={field.placeholder ?? ''} className={inputBase} />
                                            }
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-2">
                            <SaveButton state={getSaveState(sharedConnId)} onClick={() => saveSharedCredentials(provider)} disabled={anyRunning} />
                        </div>
                    </div>
                )}

                {/* Credentials card — for non-shared connectors (AWS, Salesforce, Microsoft capabilities, etc.) */}
                {!isShared && activeCaps[0]?.fields && (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
                        <div className="flex items-center gap-2 mb-1">
                            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Credentials</p>
                            {credsLoading[activeCaps[0].connectorId] && <Loader2 size={12} className="animate-spin text-slate-400" />}
                        </div>
                        <div className="space-y-3 mb-4 mt-3">
                            {activeCaps[0].fields.filter(f => f.key !== 'auth_code').map(field => (
                                <div key={field.key}>
                                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">{field.label}</label>
                                    {field.type === 'password'
                                        ? <PasswordInput value={getCred(activeCaps[0].connectorId, field.key)} onChange={v => setCred(activeCaps[0].connectorId, field.key, v)} placeholder={field.placeholder} />
                                        : <input type="text" value={getCred(activeCaps[0].connectorId, field.key)} onChange={e => setCred(activeCaps[0].connectorId, field.key, e.target.value)} placeholder={field.placeholder ?? ''} className={inputBase} />
                                    }
                                </div>
                            ))}
                        </div>
                        <div className="flex items-center gap-2">
                            <SaveButton state={getSaveState(activeCaps[0].connectorId)} onClick={() => saveCredentials(activeCaps[0].connectorId)} />
                        </div>
                    </div>
                )}

                {/* Capabilities label */}
                {!provider.gridLayout && (
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1 pt-1">Capabilities</p>
                )}

                {/* Capability cards — 2-col grid for shared providers, single-col for others */}
                <div className={isShared ? 'grid grid-cols-2 gap-4 items-start' : 'space-y-4'}>
                {activeCaps.map(cap => {
                    const capRun    = runState[cap.id];
                    const isRunning = capRun?.status === 'running';
                    const hasRun    = capRun && capRun.status !== 'idle';
                    const capLoading = credsLoading[cap.connectorId];

                    return (
                        <div key={cap.id} className={`relative bg-white dark:bg-slate-900 border rounded-2xl p-5 flex flex-col gap-3 ${
                            capRun?.status === 'success'
                                ? 'border-emerald-300 dark:border-emerald-500/40'
                                : 'border-slate-200 dark:border-slate-800'
                        }`}>

                            {/* Inbound badge — top-right corner */}
                            <span className="absolute top-3 right-3 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20">
                                Inbound
                            </span>

                            {/* Card header: icon (capIcon only) + runName/name + description */}
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 flex items-center justify-center shrink-0">
                                    {cap.capIcon ?? <Play size={14} className="text-slate-400" />}
                                </div>
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-800 dark:text-white">{cap.runName ?? cap.name}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-500 mt-0.5 leading-snug">{cap.description}</p>
                                </div>
                            </div>

                            {/* Note */}
                            {cap.note && (
                                <div className="flex gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs">
                                    <Info size={14} className="shrink-0 mt-0.5" /> {cap.note}
                                </div>
                            )}


                            {/* Gemini OAuth flow */}
                            {cap.isGemini && (
                                <div className="space-y-3">
                                    <button
                                        onClick={getGeminiAuthUrl}
                                        disabled={geminiAuthUrl.loading}
                                        className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-60 text-slate-700 dark:text-slate-200 font-semibold px-4 py-2 rounded-xl text-sm transition-all border border-slate-200 dark:border-slate-700"
                                    >
                                        {geminiAuthUrl.loading ? <><Loader2 size={14} className="animate-spin" /> Generating…</> : <><ExternalLink size={14} /> Get Authorization URL</>}
                                    </button>
                                    {geminiAuthUrl.url && (
                                        <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 space-y-3">
                                            <a href={geminiAuthUrl.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline break-all">
                                                <ExternalLink size={13} className="shrink-0" /> Click here to authorize with Google
                                            </a>
                                            <p className="text-xs text-slate-500 dark:text-slate-400">After authorizing, copy the <code className="bg-white dark:bg-slate-700 px-1 rounded">code=</code> value and paste it below.</p>
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">Authorization Code</label>
                                                <input type="text" value={getCred('gemini', 'auth_code')} onChange={e => setCred('gemini', 'auth_code', e.target.value)} placeholder="Paste the code from the redirect URL" className={inputBase} />
                                            </div>
                                        </div>
                                    )}
                                    {geminiAuthUrl.error && (
                                        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-xs text-red-600 dark:text-red-400">
                                            <AlertCircle size={13} className="shrink-0" /> {geminiAuthUrl.error}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Agent 365 device code flow */}
                            {cap.isAgent365 && (
                                <div className="space-y-3">
                                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Microsoft Sign-in</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">A Global Admin must sign in once. Tavro stores a refresh token to fetch all agents.</p>
                                    {deviceCodeState.phase === 'idle' && (
                                        <button onClick={startDeviceCode} className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold px-4 py-2 rounded-xl text-sm transition-all border border-slate-200 dark:border-slate-700">
                                            <ExternalLink size={14} /> Connect with Microsoft
                                        </button>
                                    )}
                                    {deviceCodeState.phase === 'loading' && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Starting sign-in…</div>}
                                    {deviceCodeState.phase === 'waiting' && (
                                        <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 space-y-3">
                                            <p className="text-sm text-blue-700 dark:text-blue-300">1. Open this URL and sign in with a <strong>Global Admin</strong> account:</p>
                                            <a href={deviceCodeState.verificationUri} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline"><ExternalLink size={13} className="shrink-0" />{deviceCodeState.verificationUri}</a>
                                            <p className="text-sm text-blue-700 dark:text-blue-300">2. Enter this code:</p>
                                            <span className="inline-block font-mono text-2xl font-bold tracking-widest text-slate-800 dark:text-white bg-white dark:bg-slate-800 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700">{deviceCodeState.userCode}</span>
                                            <div className="flex items-center gap-2 text-xs text-blue-600/70 dark:text-blue-400/70 pt-1"><Loader2 size={12} className="animate-spin shrink-0" /> Waiting for sign-in…</div>
                                        </div>
                                    )}
                                    {deviceCodeState.phase === 'done' && (
                                        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                                            <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                                            <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Connected — you can now run the connector.</span>
                                        </div>
                                    )}
                                    {deviceCodeState.phase === 'error' && (
                                        <div className="space-y-2">
                                            <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-xs text-red-600 dark:text-red-400">
                                                <AlertCircle size={13} className="shrink-0 mt-0.5" /> {deviceCodeState.message}
                                            </div>
                                            <button onClick={() => setDeviceCodeState({ phase: 'idle' })} className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-white flex items-center gap-1"><RotateCcw size={12} /> Try again</button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Run button — all capabilities (creds are always in the top card) */}
                            {(!cap.isGemini || geminiAuthUrl.url) && (
                                <div className="flex items-center gap-2 flex-wrap">
                                    <button
                                        onClick={() => runCapability(provider, cap)}
                                        disabled={isRunning}
                                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-xl text-sm transition-all"
                                    >
                                        {isRunning ? <><Loader2 size={14} className="animate-spin" /> Running…</> : hasRun ? <><RotateCcw size={14} /> Run again</> : <><Play size={14} /> Run</>}
                                    </button>
                                    {capRun && capRun.status !== 'idle' && (
                                        <button onClick={() => setRunState(prev => ({ ...prev, [cap.id]: { status: 'idle' } }))} className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors">
                                            <RotateCcw size={13} /> Reset
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* Result area */}
                            {capRun && capRun.status !== 'idle' && capRun.result && (
                                <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-4">
                                    {capRun.status === 'success' && (
                                        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                                            <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                                            <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                                                {cap.connectorId === 'agent365'
                                                    ? `Completed — ${(capRun.result as any).agents_synced ?? capRun.result.count ?? 0} agents synced.`
                                                    : capRun.result.processes
                                                        ? `Completed — ${capRun.result.count ?? 0} process${(capRun.result.count ?? 0) !== 1 ? 'es' : ''} imported`
                                                        : capRun.result.applications
                                                            ? `Completed — ${capRun.result.count ?? 0} application${(capRun.result.count ?? 0) !== 1 ? 's' : ''} imported`
                                                            : `Completed — ${capRun.result.count ?? 0} agent${(capRun.result.count ?? 0) !== 1 ? 's' : ''} extracted`
                                                }
                                            </span>
                                        </div>
                                    )}
                                    {capRun.status === 'error' && (
                                        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
                                            <AlertCircle size={15} className="text-red-500 shrink-0 mt-0.5" />
                                            <span className="text-sm text-red-600 dark:text-red-400 break-all">{capRun.result.error}</span>
                                        </div>
                                    )}

                                    {capRun.result.agents_extracted && capRun.result.agents_extracted.length > 0 && (
                                        <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                            {capRun.result.agents_extracted.map(a => (
                                                <div key={a.filename} className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2.5">
                                                    <FileJson size={14} className="text-blue-500 shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{a.agent_name || a.agent_id}</p>
                                                        <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5">{a.filename}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {capRun.result.applications && capRun.result.applications.length > 0 && (
                                        <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                            {capRun.result.applications.map(app => (
                                                <div key={app.business_application_id} className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2.5">
                                                    <Building2 size={14} className="text-green-500 shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{app.name || '—'}</p>
                                                        <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5">{app.business_application_id}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {capRun.result.processes && capRun.result.processes.length > 0 && (
                                        <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                            {capRun.result.processes.map(proc => (
                                                <div key={proc.business_process_id} className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2.5">
                                                    <Building2 size={14} className="text-blue-500 shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{proc.name || '—'}</p>
                                                        <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5">{proc.business_process_id}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {capRun.status === 'success' && capRun.result.risk_queued && capRun.result.risk_queued > 0 && (
                                        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20">
                                            <Clock size={15} className="text-blue-500 shrink-0 mt-0.5" />
                                            <div>
                                                <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">Risk assessments running in background</p>
                                                <p className="text-xs text-blue-600/80 dark:text-blue-400/70 mt-0.5">Assessments for all {capRun.result.risk_queued} agent{capRun.result.risk_queued !== 1 ? 's' : ''} queued. Results appear in the Agent Catalog once complete.</p>
                                            </div>
                                        </div>
                                    )}

                                    {cap.useSharedCreds && (
                                        <button onClick={() => setRunState(prev => ({ ...prev, [cap.id]: { status: 'idle' } }))} className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors">
                                            <RotateCcw size={13} /> Reset
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
                </div>
            </div>
        </div>
    );
};

export default AdminConnectorsPage;
