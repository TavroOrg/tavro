export type LLMProvider = 'github_copilot' | 'openai' | 'azure_openai' | 'anthropic';

export interface LLMKeyRecord {
    id: string;
    name: string;
    provider: LLMProvider;
    model: string;
    azure_endpoint: string | null;
    azure_api_version: string | null;
    created_at: string;
    updated_at: string;
}

export const PROVIDER_LABELS: Record<LLMProvider, string> = {
    github_copilot: 'GitHub Copilot',
    openai:         'OpenAI',
    azure_openai:   'Azure OpenAI / Azure AI Foundry',
    anthropic:      'Anthropic (Claude)',
};

export const DEFAULT_MODELS: Record<LLMProvider, string> = {
    github_copilot: 'gpt-4o',
    openai:         'gpt-4o',
    azure_openai:   'gpt-4o',
    anthropic:      'claude-sonnet-4-6',
};

export const PROVIDER_HINTS: Record<LLMProvider, string> = {
    github_copilot: 'requires subscription',
    openai:         'api.openai.com',
    azure_openai:   'your-resource.openai.azure.com',
    anthropic:      'api.anthropic.com',
};

const BASE = '/api/v1/admin/llm-keys';

function authHeaders(): HeadersInit {
    const token = localStorage.getItem('tavro_admin_access_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchLLMKeys(): Promise<LLMKeyRecord[]> {
    const res = await fetch(BASE, { headers: authHeaders() });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export async function createLLMKey(
    provider: LLMProvider,
    model: string,
    apiKey: string,
    azureFields?: { azure_endpoint?: string; azure_api_version?: string },
): Promise<LLMKeyRecord> {
    const res = await fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ name: PROVIDER_LABELS[provider], provider, model, api_key: apiKey, ...azureFields }),
    });
    if (!res.ok) throw new Error((await res.json()).detail ?? 'Failed to save key');
    return res.json();
}

export async function updateLLMKey(
    id: string,
    patch: { model?: string; api_key?: string; azure_endpoint?: string; azure_api_version?: string },
): Promise<LLMKeyRecord> {
    const res = await fetch(`${BASE}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error((await res.json()).detail ?? 'Failed to update key');
    return res.json();
}

export async function deleteLLMKey(id: string): Promise<void> {
    const res = await fetch(`${BASE}/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to delete key');
}
