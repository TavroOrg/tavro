import { getValidToken } from './auth';
import { portalActivity } from './portalActivity';
import { appLogger } from './logger';
import { parseApiError } from '../utils/errorUtils';

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
        throw new Error(parseApiError(res.status, body));
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
        throw new Error(parseApiError(res.status, body));
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
    // Prioritization scores
    business_value_score?: number;
    business_value_override?: boolean;
    business_value_override_reason?: string;
    data_readiness_score?: number;
    data_readiness_override?: boolean;
    data_readiness_override_reason?: string;
    technical_complexity_score?: number;
    technical_complexity_override?: boolean;
    technical_complexity_override_reason?: string;
    risk_data_privacy_score?: number;
    risk_operational_score?: number;
    risk_compliance_score?: number;
    risk_ai_behavioral_score?: number;
    risk_strategic_reputational_score?: number;
    risk_composite_score?: number;
    priority_score?: number;
    quadrant?: string;
    time_horizon?: string;
    time_horizon_rationale?: string;
    roadmap_approved?: boolean;
    scoring_history_entry?: Record<string, unknown>;
    scoring_history_entries?: Record<string, unknown>[];
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
    async listUseCases(opts?: { title?: string; startRecord?: number; recordRange?: string; companyId?: string }): Promise<UseCaseListResponse> {
        const params = new URLSearchParams();
        if (opts?.title) params.set('title', opts.title);
        if (opts?.startRecord) params.set('start_record', String(opts.startRecord));
        if (opts?.recordRange) params.set('record_range', opts.recordRange);
        if (opts?.companyId) params.set('company_id', opts.companyId);
        appLogger.req('GET /api/v1/use-cases/', opts ?? {});
        const t0 = Date.now();
        const result = await req<UseCaseListResponse>(`/use-cases/?${params}`);
        appLogger.res('GET /api/v1/use-cases/', { totalRecords: result.total_records, count: result.data?.length }, Date.now() - t0);
        return result;
    }

    async countUseCases(companyId?: string): Promise<number> {
        const params = new URLSearchParams({ start_record: '1', record_range: '1-1' });
        if (companyId) params.set('company_id', companyId);
        const data = await req<UseCaseListResponse>(`/use-cases/?${params}`);
        return data?.total_records ?? 0;
    }

    async getUseCase(useCaseId: string, companyId?: string): Promise<UseCaseListResponse> {
        appLogger.req(`GET /api/v1/use-cases/${useCaseId}`);
        const t0 = Date.now();
        const suffix = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
        const result = await req<UseCaseListResponse>(`/use-cases/${encodeURIComponent(useCaseId)}${suffix}`);
        appLogger.res(`GET /api/v1/use-cases/${useCaseId}`, { count: result.data?.length }, Date.now() - t0);
        return result;
    }

    async createUseCase(payload: UseCaseCreatePayload, companyId?: string, companyName?: string): Promise<{ message: string; use_case_id: string }> {
        const qs = new URLSearchParams();
        if (companyId) qs.set('company_id', companyId);
        if (companyName) qs.set('company_name', companyName);
        const params = qs.toString() ? `?${qs}` : '';
        const result = await req<{ message: string; use_case_id: string }>(`/use-cases/${params}`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        portalActivity.record(`Created AI use case: ${payload.title}`, 'emerald');
        window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
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
        const displayName = payload.title || __activityName || useCaseId;
        portalActivity.record(`AI use case "${displayName}" — ${changedUseCaseFields(payload)} updated`, 'violet');
        return result;
    }

    async deleteUseCase(useCaseId: string): Promise<{ message: string; use_case_id: string }> {
        const result = await req<{ message: string; use_case_id: string }>(`/use-cases/${encodeURIComponent(useCaseId)}`, {
            method: 'DELETE',
        });
        portalActivity.record(`Deleted AI use case: ${useCaseId}`, 'amber');
        window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
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

    async uploadUseCases(files: File[], companyId?: string, companyName?: string): Promise<{ uploaded_count: number; total_submitted: number; message: string }> {
        const formData = new FormData();
        for (const file of files) {
            formData.append('files', file, file.name);
        }
        const qp = new URLSearchParams();
        if (companyId) qp.set('company_id', companyId);
        if (companyName) qp.set('company_name', companyName);
        const qs = qp.toString() ? `?${qp}` : '';
        const result = await reqFormData<{ uploaded_count: number; total_submitted: number; message: string }>(`/use-cases/upload${qs}`, formData);
        const fileLabel = files.length === 1 ? ` from ${files[0].name}` : ` from ${files.length} files`;
        portalActivity.record(`Loaded ${result.uploaded_count} AI use case${result.uploaded_count === 1 ? '' : 's'}${fileLabel}`, 'emerald');
        window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
        return result;
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
            throw new Error(parseApiError(res.status, body));
        }
        return res.blob();
    }
}

export const useCaseApi = new UseCaseApiService();
