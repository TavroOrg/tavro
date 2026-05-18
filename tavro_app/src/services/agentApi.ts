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

export interface AgentCreatePayload {
    agent_name: string;
    description: string;
    instruction: string;
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
}

export const agentApi = new AgentApiService();
