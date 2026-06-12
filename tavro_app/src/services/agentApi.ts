import { getValidToken } from './auth';
import { portalActivity } from './portalActivity';

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
}

export interface AgentUpdatePayload {
    agent_name?: string;
    description?: string;
    instruction?: string;
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

function changedAgentFields(payload: AgentUpdatePayload): string {
    const parts: string[] = [];
    if (payload.agent_name !== undefined) parts.push('name');
    if (payload.description !== undefined) parts.push('description');
    if (payload.instruction !== undefined) parts.push('instructions');
    if (payload.skills !== undefined) {
        parts.push(`${Array.isArray(payload.skills) ? payload.skills.length + ' ' : ''}skill${Array.isArray(payload.skills) && payload.skills.length === 1 ? '' : 's'}`);
    }
    return parts.length > 0 ? parts.join(', ') + ' updated' : 'details updated';
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
        const result = await req<{ agent_id: string; agent_name: string; message: string }>('/agents/', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        portalActivity.record(`Created agent: ${result.agent_name || payload.agent_name}`, 'emerald');
        return result;
    }

    async suggestDescription(agentName: string): Promise<{ description: string }> {
        return req('/agents/suggest-description', {
            method: 'POST',
            body: JSON.stringify({ agent_name: agentName }),
        });
    }

    async updateAgent(agentId: string, payload: AgentUpdatePayload, agentName?: string): Promise<{ message: string; agent_id: string }> {
        const result = await req<{ message: string; agent_id: string }>(`/agents/${encodeURIComponent(agentId)}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
        });
        const displayName = payload.agent_name || agentName || agentId;
        portalActivity.record(`Agent "${displayName}" — ${changedAgentFields(payload)}`, 'violet');
        return result;
    }

    async deleteAgent(agentId: string): Promise<{ message: string; agent_id: string }> {
        const result = await req<{ message: string; agent_id: string }>(`/agents/${encodeURIComponent(agentId)}`, {
            method: 'DELETE',
        });
        portalActivity.record(`Deleted agent: ${agentId}`, 'amber');
        return result;
    }

    async triggerRiskAssessment(agentId: string): Promise<{ message: string; agent_id: string; agent_internal_id: string }> {
        const result = await req<{ message: string; agent_id: string; agent_internal_id: string }>(`/agents/${encodeURIComponent(agentId)}/risk-assessment`, {
            method: 'POST',
        });
        portalActivity.record(`Triggered risk assessment for agent: ${agentId}`, 'amber');
        return result;
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
        const result = await reqFormData<{
            uploaded_count: number;
            total_submitted: number;
            file_results: Array<{ filename: string; valid_count: number; invalid_count: number; errors: string[] }>;
            message: string;
        }>('/agents/upload', formData);
        const fileLabel = files.length === 1 ? ` from ${files[0].name}` : ` from ${files.length} files`;
        portalActivity.record(`Uploaded ${result.uploaded_count} agent${result.uploaded_count === 1 ? '' : 's'}${fileLabel}`, 'emerald');
        return result;
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
