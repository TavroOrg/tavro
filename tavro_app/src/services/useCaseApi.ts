import { getValidToken } from './auth';

const BASE = (import.meta as any).env?.VITE_TWIN_API_URL ?? '';
const V1 = `${BASE}/api/v1`;

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

export interface UseCaseAttachmentRecord {
    id: string;
    use_case_id: string;
    filename: string;
    mime_type: string | null;
    file_size_bytes: number;
    created_at: string;
    updated_at: string;
}

class UseCaseApiService {
    async listUseCases(opts?: { title?: string; startRecord?: number; recordRange?: string; companyId?: string }): Promise<UseCaseListResponse> {
        const params = new URLSearchParams();
        if (opts?.title) params.set('title', opts.title);
        if (opts?.startRecord) params.set('start_record', String(opts.startRecord));
        if (opts?.recordRange) params.set('record_range', opts.recordRange);
        if (opts?.companyId) params.set('company_id', opts.companyId);
        return req(`/use-cases/?${params}`);
    }

    async getUseCase(useCaseId: string): Promise<UseCaseListResponse> {
        return req(`/use-cases/${encodeURIComponent(useCaseId)}`);
    }

    async createUseCase(payload: UseCaseCreatePayload, companyId?: string, companyName?: string): Promise<{ message: string; use_case_id: string }> {
        const qs = new URLSearchParams();
        if (companyId) qs.set('company_id', companyId);
        if (companyName) qs.set('company_name', companyName);
        const params = qs.toString() ? `?${qs}` : '';
        return req(`/use-cases/${params}`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    }

    async suggestDescription(title: string): Promise<{ description: string }> {
        return req('/use-cases/suggest-description', {
            method: 'POST',
            body: JSON.stringify({ title }),
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

    async linkApplication(useCaseId: string, applicationId: string): Promise<{ message: string; associated_count: number }> {
        return req(`/use-cases/${encodeURIComponent(useCaseId)}/applications`, {
            method: 'POST',
            body: JSON.stringify({ application_id: applicationId }),
        });
    }

    async unlinkApplication(useCaseId: string, applicationId: string): Promise<{ message: string; associated_count: number }> {
        return req(`/use-cases/${encodeURIComponent(useCaseId)}/applications/${encodeURIComponent(applicationId)}`, {
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

    async listUseCaseAttachments(useCaseId: string): Promise<UseCaseAttachmentRecord[]> {
        return req(`/use-cases/${encodeURIComponent(useCaseId)}/attachments`);
    }

    async uploadUseCaseAttachment(
        useCaseId: string,
        payload: { filename: string; mime_type: string; content_base64: string },
    ): Promise<UseCaseAttachmentRecord> {
        return req(`/use-cases/${encodeURIComponent(useCaseId)}/attachments`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    }

    async uploadUseCases(files: File[], companyId?: string, companyName?: string): Promise<{ uploaded_count: number; total_submitted: number; message: string }> {
        const formData = new FormData();
        for (const file of files) {
            formData.append('files', file, file.name);
        }
        const qp = new URLSearchParams();
        if (companyId) qp.set('company_id', companyId);
        if (companyName) qp.set('company_name', companyName);
        const qs = qp.toString() ? `?${qp}` : '';
        return reqFormData(`/use-cases/upload${qs}`, formData);
    }

    async deleteUseCaseAttachment(useCaseId: string, attachmentId: string): Promise<void> {
        await req(`/use-cases/${encodeURIComponent(useCaseId)}/attachments/${encodeURIComponent(attachmentId)}`, {
            method: 'DELETE',
        });
    }

    async downloadUseCaseAttachment(useCaseId: string, attachmentId: string): Promise<Blob> {
        const token = await getValidToken();
        const tenantId = localStorage.getItem('tavro_tenant_id') ?? undefined;
        const res = await fetch(`${V1}/use-cases/${encodeURIComponent(useCaseId)}/attachments/${encodeURIComponent(attachmentId)}/download`, {
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
            },
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`API ${res.status}: ${body.slice(0, 300)}`);
        }
        return res.blob();
    }
}

export const useCaseApi = new UseCaseApiService();
