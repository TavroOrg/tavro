import { getValidToken } from './auth';

const BASE = (import.meta as any).env?.VITE_TWIN_API_URL ?? '';
const V1 = `${BASE}/api/v1`;

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getValidToken();
    const tenantId = localStorage.getItem('tavro_tenant_id') ?? undefined;
    const res = await fetch(`${V1}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
            ...(init.headers ?? {}),
        },
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`API ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.json();
}

async function reqFormData<T>(path: string, formData: FormData): Promise<T> {
    const token = await getValidToken();
    const tenantId = localStorage.getItem('tavro_tenant_id') ?? undefined;
    const res = await fetch(`${V1}${path}`, {
        method: 'POST',
        body: formData,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
        },
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`API ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.json();
}

export interface AgentCreatePayload {
    agent_name: string;
    description: string;
    instruction: string;
    role?: string;
    environment?: string;
    owner?: string;
    tools?: Array<{ name: string; description: string }>;
    knowledge_source?: { name: string; description: string };
}

export interface AgentUpdatePayload {
    agent_name?: string;
    description?: string;
    instruction?: string;
}

export interface AgentCatalogResponse {
    start_record: number;
    end_record: number;
    record_count: number;
    total_records: number;
    data: any[];
}

export interface RiskWorkflowStatus {
    workflow_id: string;
    run_id?: string | null;
    agent_internal_id: string;
    agent_id: string;
    agent_name: string;
    agent_description: string;
    status: 'running' | 'completed' | 'failed' | string;
    error?: string | null;
    created_at: string;
    updated_at: string;
}

class AgentApiService {
    async getAgentCatalog(startRecord = 1, recordRange = '1-50'): Promise<AgentCatalogResponse> {
        const params = new URLSearchParams({ start_record: String(startRecord), record_range: recordRange });
        return req(`/agents?${params}`);
    }

    async getAgentCard(agentId: string): Promise<any> {
        return req(`/agents/${encodeURIComponent(agentId)}`);
    }

    async createAgent(payload: AgentCreatePayload): Promise<{ agent_id: string; agent_name: string; message: string }> {
        return req('/agents', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    }

    async suggestDescription(agentName: string): Promise<{ description: string }> {
        return req('/agents/suggest-description', {
            method: 'POST',
            body: JSON.stringify({ agent_name: agentName }),
        });
    }

    async updateAgent(agentId: string, payload: AgentUpdatePayload): Promise<{ message: string; agent_id: string }> {
        return req(`/agents/${encodeURIComponent(agentId)}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
        });
    }

    async deleteAgent(agentId: string): Promise<{ message: string; agent_id: string }> {
        return req(`/agents/${encodeURIComponent(agentId)}`, {
            method: 'DELETE',
        });
    }

    async triggerRiskAssessment(agentId: string): Promise<{ message: string; agent_id: string; agent_internal_id: string }> {
        return req(`/agents/${encodeURIComponent(agentId)}/risk-assessment`, {
            method: 'POST',
        });
    }

    async uploadAgents(files: File[]): Promise<{ uploaded_count: number; total_submitted: number; message: string }> {
        const formData = new FormData();
        for (const file of files) {
            formData.append('files', file, file.name);
        }
        return reqFormData('/agents/upload', formData);
    }

    async getRiskWorkflows(params?: { status?: string; agentId?: string }): Promise<RiskWorkflowStatus[]> {
        const qp = new URLSearchParams();
        if (params?.status) qp.set('status', params.status);
        if (params?.agentId) qp.set('agent_id', params.agentId);
        const q = qp.toString();
        return req(`/risk/workflows${q ? `?${q}` : ''}`);
    }
}

export const agentApi = new AgentApiService();
