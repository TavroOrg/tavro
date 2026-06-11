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
    tools?: Array<{ name: string; description: string; table?: any; tables?: any[]; columns?: any[] }>;
    tables?: Array<{ table_id?: string; name?: string; table_name?: string; columns?: any[]; tool_name?: string; tool_id?: string }>;
    data_source?: Array<Record<string, any>>;
    knowledge_source?: { name: string; description: string };
    issues?: AgentIssuePayload[];
}

export interface AgentUpdatePayload {
    agent_name?: string;
    description?: string;
    instruction?: string;
    issues?: AgentIssuePayload[];
    skills?: Array<{
        id?: string;
        identifier?: string;
        skill_id?: string;
        name?: string;
        skill_name?: string;
        description?: string;
        tags?: string[];
        inputModes?: string[];
        outputModes?: string[];
        input_modes?: string[];
        output_modes?: string[];
        inputBounds?: string[];
        outputBounds?: string[];
        input_bounds?: string[];
        output_bounds?: string[];
    } | string>;
}

export interface AgentIssuePayload {
    identifier?: string;
    title: string;
    description?: string;
    issue_type?: string;
    severity?: string;
    source?: string;
    detected_at?: string;
    resolved_at?: string;
    status?: string;
    resolution_notes?: string;
    assignee?: string;
    owner?: string;
}

export interface AgentIssue {
    identifier: string;
    title: string;
    description?: string | null;
    issue_type?: string | null;
    severity?: string | null;
    source?: string | null;
    detected_at?: string | null;
    resolved_at?: string | null;
    status?: string | null;
    resolution_notes?: string | null;
    assignee?: string | null;
    owner?: string | null;
    created_ts?: string | null;
    updated_ts?: string | null;
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
    tenant_id?: string | null;
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
        return req('/agents/', {
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

    async getIssue(issueId: string): Promise<AgentIssue & { linked_agents?: Array<{ agent_id: string; agent_name: string }> }> {
        return req(`/agents/issues/${encodeURIComponent(issueId)}`);
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

    async uploadAgents(files: File[]): Promise<{
        uploaded_count: number;
        total_submitted: number;
        file_results: Array<{ filename: string; valid_count: number; invalid_count: number; errors: string[] }>;
        message: string;
    }> {
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
