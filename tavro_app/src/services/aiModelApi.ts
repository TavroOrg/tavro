import type {
  AiModelRecord,
  AiModelUpsertPayload,
  AiModelAttachmentRecord,
} from '../types/aiModel';
import { portalActivity } from './portalActivity';

const BASE = (import.meta as any).env?.VITE_TWIN_API_URL ?? '';
const V1 = `${BASE}/api/v1`;

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = localStorage.getItem('tavro_access_token');
  const tenantId = localStorage.getItem('tavro_tenant_id') ?? undefined;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
    ...extra,
  };
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${V1}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body.slice(0, 250)}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

const AI_MODEL_FIELD_LABELS: Partial<Record<keyof AiModelUpsertPayload, string>> = {
  model_name: 'name',
  owner: 'owner',
  description: 'description',
  department_executive: 'department executive',
  business_functions: 'business functions',
  vendor_or_inhouse: 'vendor/in-house',
  provider: 'provider',
  status: 'status',
  parent_model_id: 'parent model',
  version_number: 'version',
  use_case_value_drivers: 'value drivers',
  user_types: 'user types',
  decision_type: 'decision type',
  automation_level: 'automation level',
  regulatory_mapping: 'regulatory mapping',
  consumer_impact: 'consumer impact',
  risk_tier_materiality: 'risk tier materiality',
  model_type: 'model type',
  technique_class: 'technique class',
  learning_approach: 'learning approach',
  update_frequency: 'update frequency',
  input_variable_count: 'input variable count',
  data_join_method: 'data join method',
  statistical_assumptions: 'statistical assumptions',
  documented_constraints: 'documented constraints',
  stability_window: 'stability window',
  last_validation_date: 'last validation date',
  recert_use_case_same: 'recert use case same',
  recert_use_case_changed: 'recert use case changed',
  recert_inputs_same: 'recert inputs same',
  recert_inputs_changed: 'recert inputs changed',
  recert_outputs_same: 'recert outputs same',
  recert_outputs_changed: 'recert outputs changed',
  recert_users_same: 'recert users same',
  recert_users_changed: 'recert users changed',
  recert_processing_same: 'recert processing same',
  recert_processing_changed: 'recert processing changed',
  recert_training_completed: 'recert training',
  recert_risk_assessment_done: 'recert risk assessment',
};

function changedAiModelFields(payload: AiModelUpsertPayload): string {
  const fields = (Object.keys(payload) as Array<keyof AiModelUpsertPayload>)
    .map(key => AI_MODEL_FIELD_LABELS[key] ?? String(key).replace(/_/g, ' '))
    .filter(Boolean);
  return fields.length > 0 ? `${fields.join(', ')} updated` : 'details updated';
}

class AiModelApi {
  async listModels(search?: string, companyId?: string): Promise<AiModelRecord[]> {
    const params = new URLSearchParams();
    if (search?.trim()) params.set('q', search.trim());
    params.set('record_range', '1-500');
    if (companyId) params.set('company_id', companyId);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const data = await req<any>(`/ai-models/${suffix}`);
    if (Array.isArray(data)) return data as AiModelRecord[];
    return (data?.items ?? data?.data ?? []) as AiModelRecord[];
  }

  async getModel(modelId: string, companyId?: string): Promise<AiModelRecord> {
    const suffix = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
    return req(`/ai-models/${encodeURIComponent(modelId)}${suffix}`);
  }

  async createModel(payload: AiModelUpsertPayload, companyId?: string): Promise<{ message: string; ai_model_id: string }> {
    const qs = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
    const result = await req<{ message: string; ai_model_id: string }>(`/ai-models/${qs}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    portalActivity.record(`Created AI model: ${payload.model_name || result.ai_model_id}`, 'emerald');
    window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
    return result;
  }

  async updateModel(modelId: string, payload: AiModelUpsertPayload, modelName?: string, companyId?: string): Promise<{ message: string; ai_model_id: string }> {
    const qs = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
    const result = await req<{ message: string; ai_model_id: string }>(`/ai-models/${encodeURIComponent(modelId)}${qs}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    portalActivity.record(`AI model "${payload.model_name || modelName || modelId}" — ${changedAiModelFields(payload)}`, 'violet');
    window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
    return result;
  }

  async deleteModel(modelId: string): Promise<void> {
    await req(`/ai-models/${encodeURIComponent(modelId)}`, { method: 'DELETE' });
  }

  async suggestDescription(modelName: string): Promise<{ description: string }> {
    return req('/ai-models/suggest-description', {
      method: 'POST',
      body: JSON.stringify({ model_name: modelName }),
    });
  }

  async linkAgent(modelId: string, agentId: string): Promise<void> {
    await req(`/ai-models/${encodeURIComponent(modelId)}/agents`, {
      method: 'POST',
      body: JSON.stringify({ agent_id: agentId }),
    });
  }

  async unlinkAgent(modelId: string, agentId: string): Promise<void> {
    await req(`/ai-models/${encodeURIComponent(modelId)}/agents/${encodeURIComponent(agentId)}`, {
      method: 'DELETE',
    });
  }

  async linkUseCase(modelId: string, useCaseId: string): Promise<void> {
    await req(`/ai-models/${encodeURIComponent(modelId)}/use-cases`, {
      method: 'POST',
      body: JSON.stringify({ ai_use_case_id: useCaseId }),
    });
  }

  async unlinkUseCase(modelId: string, useCaseId: string): Promise<void> {
    await req(`/ai-models/${encodeURIComponent(modelId)}/use-cases/${encodeURIComponent(useCaseId)}`, {
      method: 'DELETE',
    });
  }

  async linkApplication(modelId: string, applicationId: string): Promise<void> {
    await req(`/ai-models/${encodeURIComponent(modelId)}/applications`, {
      method: 'POST',
      body: JSON.stringify({ business_application_id: applicationId }),
    });
  }

  async unlinkApplication(modelId: string, applicationId: string): Promise<void> {
    await req(`/ai-models/${encodeURIComponent(modelId)}/applications/${encodeURIComponent(applicationId)}`, {
      method: 'DELETE',
    });
  }

  async linkProcess(modelId: string, processId: string): Promise<void> {
    await req(`/ai-models/${encodeURIComponent(modelId)}/processes`, {
      method: 'POST',
      body: JSON.stringify({ business_process_id: processId }),
    });
  }

  async unlinkProcess(modelId: string, processId: string): Promise<void> {
    await req(`/ai-models/${encodeURIComponent(modelId)}/processes/${encodeURIComponent(processId)}`, {
      method: 'DELETE',
    });
  }

  async listAttachments(modelId: string, category?: string): Promise<AiModelAttachmentRecord[]> {
    const suffix = category ? `?category=${encodeURIComponent(category)}` : '';
    return req(`/ai-models/${encodeURIComponent(modelId)}/attachments${suffix}`);
  }

  async uploadAttachment(
    modelId: string,
    payload: { filename: string; mime_type: string; content_base64: string; category?: string },
  ): Promise<AiModelAttachmentRecord> {
    return req(`/ai-models/${encodeURIComponent(modelId)}/attachments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async deleteAttachment(modelId: string, attachmentId: string): Promise<void> {
    await req(`/ai-models/${encodeURIComponent(modelId)}/attachments/${encodeURIComponent(attachmentId)}`, {
      method: 'DELETE',
    });
  }

  async downloadAttachment(modelId: string, attachmentId: string): Promise<Blob> {
    const res = await fetch(
      `${V1}/ai-models/${encodeURIComponent(modelId)}/attachments/${encodeURIComponent(attachmentId)}/download`,
      { headers: authHeaders() },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${res.status}: ${body.slice(0, 250)}`);
    }
    return res.blob();
  }
}

export const aiModelApi = new AiModelApi();
