import React, { useState, useEffect, useCallback } from 'react';
import {
    ChevronRight, CheckCircle2, AlertCircle, Eye, EyeOff,
    Loader2, Save, Terminal,
} from 'lucide-react';

interface InfraField {
    key: string;
    label: string;
    type: 'text' | 'password';
    placeholder?: string;
    readOnly?: boolean;
}

interface InfraSection {
    title: string;
    fields: InfraField[];
}

interface InfraDef {
    id: string;
    name: string;
    description: string;
    category: string;
    initials: string;
    color: string;
    sections: InfraSection[];
}

const INFRA_ITEMS: InfraDef[] = [
    {
        id: 'claude-cli',
        name: 'Claude CLI',
        description: 'Anthropic Claude CLI â€” powers agent code generation, updates, and terminal execution in the Agent Playground',
        category: 'Anthropic',
        initials: 'CC',
        color: 'from-violet-500 to-purple-700',
        sections: [
            {
                title: 'Anthropic',
                fields: [
                    {
                        key: 'api_key',
                        label: 'API Key',
                        type: 'password',
                        placeholder: 'sk-ant-...',
                    },
                ],
            },
            {
                title: 'Azure AI Foundry (Deploy)',
                fields: [
                    {
                        key: 'azure_hosted_endpoint',
                        label: 'Hosted Endpoint URL',
                        type: 'text',
                        placeholder: 'https://<resource>.services.ai.azure.com/api/projects/<project>',
                    },
                    {
                        key: 'azure_client_id',
                        label: 'Client ID',
                        type: 'text',
                        placeholder: '00000000-0000-0000-0000-000000000000',
                    },
                    {
                        key: 'azure_tenant_id',
                        label: 'Tenant ID',
                        type: 'text',
                        placeholder: '00000000-0000-0000-0000-000000000000',
                    },
                    {
                        key: 'azure_client_secret',
                        label: 'Client Secret',
                        type: 'password',
                        placeholder: 'BC-8Q~...',
                    },
                ],
            },
            {
                title: 'Git Publishing',
                fields: [
                    {
                        key: 'git_repo_url',
                        label: 'Repository URL',
                        type: 'text',
                        placeholder: 'https://github.com/org/repo',
                    },
                    {
                        key: 'git_token',
                        label: 'Access Token',
                        type: 'password',
                        placeholder: 'ghp_...',
                    },
                    {
                        key: 'git_branch',
                        label: 'Branch',
                        type: 'text',
                        placeholder: 'main',
                    },
                ],
            },
        ],
    },
    {
        id: 'azure-foundry',
        name: 'Agent Playground — Azure AI Foundry',
        description: 'Azure AI Foundry project endpoint, API key, and deployment settings for agent playground',
        category: 'Microsoft Azure',
        initials: 'AF',
        color: 'from-blue-500 to-blue-700',
        sections: [
            {
                title: 'Azure AI Foundry',
                fields: [
                    { key: 'az_foundry_endpoint',        label: 'Endpoint',            type: 'text',     placeholder: 'https://your-project.services.ai.azure.com/api/projects/proj-default' },
                    { key: 'az_foundry_key',             label: 'API Key',             type: 'password', placeholder: '' },
                    { key: 'az_foundry_api_version',     label: 'API Version',         type: 'text',     placeholder: '2024-02-15-preview' },
                    { key: 'az_foundry_agent_api_ver',   label: 'Agent API Version',   type: 'text',     placeholder: 'v1' },
                    { key: 'az_foundry_deployment',      label: 'Deployment',          type: 'text',     placeholder: 'gpt-4o' },
                    { key: 'az_foundry_client_id',       label: 'Client ID',           type: 'text',     placeholder: '' },
                    { key: 'az_foundry_tenant_id',       label: 'Tenant ID',           type: 'text',     placeholder: '' },
                    { key: 'az_foundry_client_secret',   label: 'Client Secret',       type: 'password', placeholder: '' },
                    { key: 'az_foundry_hosted_endpoint', label: 'Hosted Endpoint URL', type: 'text',     placeholder: 'https://<resource>.services.ai.azure.com/api/projects/<project>' },
                ],
            },
        ],
    },
    {
        id: 'playground-bedrock',
        name: 'Agent Playground — AWS Bedrock',
        description: 'AWS credentials for provisioning Bedrock agents in the Agent Playground',
        category: 'Amazon Web Services',
        initials: 'AB',
        color: 'from-orange-500 to-orange-700',
        sections: [
            {
                title: 'AWS Bedrock',
                fields: [
                    { key: 'playground_bedrock_access_key', label: 'Access Key', type: 'password', placeholder: '' },
                    { key: 'playground_bedrock_secret_key', label: 'Secret Key', type: 'password', placeholder: '' },
                    { key: 'playground_bedrock_region',     label: 'Region',     type: 'text',     placeholder: 'us-east-1' },
                ],
            },
        ],
    },
];

const AdminInfrastructurePage: React.FC = () => {
    const [selected, setSelected] = useState<string | null>(null);
    const [credentials, setCredentials] = useState<Record<string, Record<string, string>>>({});
    const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});
    const [credsLoading, setCredsLoading] = useState(false);
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

    const selectedItem = INFRA_ITEMS.find(i => i.id === selected) ?? null;

    const getCred = (itemId: string, key: string) => credentials[itemId]?.[key] ?? '';

    const setCred = (itemId: string, key: string, value: string) => {
        setCredentials(prev => ({
            ...prev,
            [itemId]: { ...(prev[itemId] ?? {}), [key]: value },
        }));
    };

    const loadCredentials = useCallback(async (itemId: string) => {
        setCredsLoading(true);
        try {
            const res = await fetch(`/api/v1/admin/infrastructure/${itemId}/credentials`);
            if (res.ok) {
                const data = await res.json();
                setCredentials(prev => ({ ...prev, [itemId]: { ...(prev[itemId] ?? {}), ...data } }));
            }
        } catch { /* user can type manually */ }
        finally { setCredsLoading(false); }
    }, []);

    useEffect(() => {
        if (selected) loadCredentials(selected);
    }, [selected, loadCredentials]);

    const saveCredentials = async (itemId: string) => {
        setSaveState('saving');
        try {
            const res = await fetch(`/api/v1/admin/infrastructure/${itemId}/credentials`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credentials: credentials[itemId] ?? {} }),
            });
            setSaveState(res.ok ? 'saved' : 'error');
        } catch { setSaveState('error'); }
        finally { setTimeout(() => setSaveState('idle'), 3000); }
    };

    return (
        <div className="flex gap-6 h-full animate-fade-in p-6 overflow-hidden">

            {/* LEFT: item list */}
            <div className="w-72 shrink-0 space-y-2">
                <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-4">
                    Infrastructure Configuration
                </h1>
                {INFRA_ITEMS.map(item => {
                    const isActive = selected === item.id;
                    return (
                        <button
                            key={item.id}
                            onClick={() => setSelected(item.id)}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left group
                                ${isActive
                                    ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30'
                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                                }`}
                        >
                            <div className={`h-9 w-9 rounded-lg bg-gradient-to-br ${item.color} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                                {item.initials}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className={`text-sm font-semibold truncate ${isActive ? 'text-blue-700 dark:text-blue-400' : 'text-slate-800 dark:text-white'}`}>
                                    {item.name}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-500 truncate">{item.category}</p>
                            </div>
                            <ChevronRight size={15} className="text-slate-300 dark:text-slate-600 group-hover:text-slate-500 dark:group-hover:text-slate-400 shrink-0" />
                        </button>
                    );
                })}
            </div>

            {/* RIGHT: config panel */}
            {selectedItem ? (
                <div className="flex-1 min-w-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-6 overflow-y-auto">

                    {/* header */}
                    <div className="flex items-start gap-4">
                        <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${selectedItem.color} flex items-center justify-center text-white font-bold shrink-0`}>
                            {selectedItem.initials}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-800 dark:text-white">{selectedItem.name}</h2>
                            <p className="text-sm text-slate-500 dark:text-slate-500 mt-0.5">{selectedItem.description}</p>
                        </div>
                        {credsLoading && <Loader2 size={16} className="animate-spin text-slate-400 mt-1 ml-auto shrink-0" />}
                    </div>

                    {/* sections */}
                    {selectedItem.sections.map(section => (
                        <div key={section.title} className="space-y-4">
                            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 pb-2">
                                {section.title}
                            </h3>
                            <div className="grid grid-cols-1 gap-4">
                                {section.fields.map(field => (
                                    <div key={field.key}>
                                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                                            {field.label}
                                        </label>
                                        <div className="relative">
                                            <input
                                                type={field.type === 'password' && !showPassword[field.key] ? 'password' : 'text'}
                                                value={getCred(selectedItem.id, field.key)}
                                                onChange={e => !field.readOnly && setCred(selectedItem.id, field.key, e.target.value)}
                                                placeholder={field.placeholder}
                                                readOnly={field.readOnly}
                                                className={`w-full border rounded-xl px-3 py-2.5 text-sm placeholder-slate-400 dark:placeholder-slate-600 transition-all pr-10
                                                    ${field.readOnly
                                                        ? 'bg-slate-100 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 cursor-default select-all'
                                                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400'
                                                    }`}
                                            />
                                            {field.type === 'password' && (
                                                <button
                                                    type="button"
                                                    onClick={() => setShowPassword(prev => ({ ...prev, [field.key]: !prev[field.key] }))}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                                                >
                                                    {showPassword[field.key] ? <EyeOff size={15} /> : <Eye size={15} />}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}

                    {/* save action */}
                    <div className="flex items-center gap-3 pt-2">
                        <button
                            onClick={() => saveCredentials(selectedItem.id)}
                            disabled={saveState === 'saving'}
                            className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-60 disabled:cursor-not-allowed text-slate-700 dark:text-slate-200 font-semibold px-4 py-2.5 rounded-xl text-sm transition-all border border-slate-200 dark:border-slate-700"
                        >
                            {saveState === 'saving'
                                ? <><Loader2 size={14} className="animate-spin" /> Savingâ€¦</>
                                : saveState === 'saved'
                                    ? <><CheckCircle2 size={14} className="text-emerald-500" /> Saved</>
                                    : saveState === 'error'
                                        ? <><AlertCircle size={14} className="text-red-500" /> Error</>
                                        : <><Save size={14} /> Save Configuration</>
                            }
                        </button>
                    </div>
                </div>
            ) : (
                /* empty state */
                <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-center p-12">
                    <div className="h-16 w-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                        <Terminal size={28} className="text-slate-400 dark:text-slate-600" />
                    </div>
                    <p className="text-slate-700 dark:text-slate-300 font-semibold mb-1">Select an infrastructure item</p>
                    <p className="text-sm text-slate-400 dark:text-slate-500">
                        Choose an item from the list to configure its settings.
                    </p>
                </div>
            )}
        </div>
    );
};

export default AdminInfrastructurePage;

