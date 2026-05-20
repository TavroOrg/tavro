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

export interface UseCaseCreatePayload {
    title: string;
    description: string;
    business_problem_statement: string;
    expected_benefits: string;
    priority: string;
    regulatory_impact?: string[];
    solution_approach?: string;
    use_case_owner?: string;
    impacted_business_applications?: string[];
    impacted_business_processes?: string[];
}

export interface UseCaseUpdatePayload {
    title?: string;
    description?: string;
    business_problem_statement?: string;
    expected_benefits?: string;
    priority?: string;
    solution_approach?: string;
    use_case_owner?: string;
}

export interface UseCaseListResponse {
    start_record: number;
    end_record: number;
    record_count: number;
    total_records: number;
    data: any[];
}

class UseCaseApiService {
    async listUseCases(opts?: { title?: string; startRecord?: number; recordRange?: string }): Promise<UseCaseListResponse> {
        const params = new URLSearchParams();
        if (opts?.title) params.set('title', opts.title);
        if (opts?.startRecord) params.set('start_record', String(opts.startRecord));
        if (opts?.recordRange) params.set('record_range', opts.recordRange);
        return req(`/use-cases?${params}`);
    }

    async getUseCase(useCaseId: string): Promise<UseCaseListResponse> {
        return req(`/use-cases/${encodeURIComponent(useCaseId)}`);
    }

    async createUseCase(payload: UseCaseCreatePayload): Promise<{ message: string; use_case_id: string }> {
        return req('/use-cases', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    }

    async updateUseCase(useCaseId: string, payload: UseCaseUpdatePayload): Promise<{ message: string; use_case_id: string }> {
        return req(`/use-cases/${encodeURIComponent(useCaseId)}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
        });
    }

    async deleteUseCase(useCaseId: string): Promise<{ message: string; use_case_id: string }> {
        return req(`/use-cases/${encodeURIComponent(useCaseId)}`, {
            method: 'DELETE',
        });
    }

    async linkAgent(useCaseId: string, agentId: string): Promise<{ message: string; associated_count: number }> {
        return req(`/use-cases/${encodeURIComponent(useCaseId)}/agents`, {
            method: 'POST',
            body: JSON.stringify({ agent_id: agentId }),
        });
    }

    async unlinkAgent(useCaseId: string, agentId: string): Promise<{ message: string; associated_count: number }> {
        return req(`/use-cases/${encodeURIComponent(useCaseId)}/agents/${encodeURIComponent(agentId)}`, {
            method: 'DELETE',
        });
    }

    async linkProcess(useCaseId: string, processId: string): Promise<{ message: string; associated_count: number }> {
        return req(`/use-cases/${encodeURIComponent(useCaseId)}/processes`, {
            method: 'POST',
            body: JSON.stringify({ process_id: processId }),
        });
    }

    async unlinkProcess(useCaseId: string, processId: string): Promise<{ message: string; associated_count: number }> {
        return req(`/use-cases/${encodeURIComponent(useCaseId)}/processes/${encodeURIComponent(processId)}`, {
            method: 'DELETE',
        });
    }
}

export const useCaseApi = new UseCaseApiService();
