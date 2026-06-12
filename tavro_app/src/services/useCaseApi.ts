import { getValidToken } from './auth';
import { portalActivity } from './portalActivity';

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
    __activityName?: string;
    title?: string;
    description?: string;
    business_problem_statement?: string;
    expected_benefits?: string;
    priority?: string;
    solution_approach?: string;
    use_case_owner?: string;
}

function changedUseCaseFields(payload: UseCaseUpdatePayload): string {
    const fields: string[] = [];
    if (payload.title !== undefined) fields.push('title');
    if (payload.description !== undefined) fields.push('description');
    if (payload.business_problem_statement !== undefined) fields.push('problem statement');
    if (payload.expected_benefits !== undefined) fields.push('expected benefits');
    if (payload.priority !== undefined) fields.push('priority');
    if (payload.solution_approach !== undefined) fields.push('solution approach');
    if (payload.use_case_owner !== undefined) fields.push('owner');
    return fields.length > 0 ? fields.join(', ') : 'details';
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
        const result = await req<{ message: string; use_case_id: string }>('/use-cases', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        portalActivity.record(`Created AI use case: ${payload.title}`, 'emerald');
        return result;
    }

    async suggestDescription(title: string): Promise<{ description: string }> {
        return req('/use-cases/suggest-description', {
            method: 'POST',
            body: JSON.stringify({ title }),
        });
    }

    async updateUseCase(useCaseId: string, payload: UseCaseUpdatePayload): Promise<{ message: string; use_case_id: string }> {
        const { __activityName, ...body } = payload;
        const result = await req<{ message: string; use_case_id: string }>(`/use-cases/${encodeURIComponent(useCaseId)}`, {
            method: 'PUT',
            body: JSON.stringify(body),
        });
        portalActivity.record(`Updated AI use case ${payload.title || __activityName || useCaseId}: ${changedUseCaseFields(payload)}`, 'violet');
        return result;
    }

    async deleteUseCase(useCaseId: string): Promise<{ message: string; use_case_id: string }> {
        const result = await req<{ message: string; use_case_id: string }>(`/use-cases/${encodeURIComponent(useCaseId)}`, {
            method: 'DELETE',
        });
        portalActivity.record(`Deleted AI use case: ${useCaseId}`, 'amber');
        return result;
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

    async uploadUseCases(files: File[]): Promise<{ uploaded_count: number; total_submitted: number; message: string }> {
        const formData = new FormData();
        for (const file of files) {
            formData.append('files', file, file.name);
        }
        return reqFormData('/use-cases/upload', formData);
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
