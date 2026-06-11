import type {
  AiModelRecord,
  AiModelUpsertPayload,
  AiModelAttachmentRecord,
} from '../types/aiModel';

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

class AiModelApi {
  async listModels(search?: string): Promise<AiModelRecord[]> {
    const params = new URLSearchParams();
    if (search?.trim()) params.set('q', search.trim());
    params.set('record_range', '1-500');
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const data = await req<any>(`/ai-models/${suffix}`);
    if (Array.isArray(data)) return data as AiModelRecord[];
    return (data?.items ?? data?.data ?? []) as AiModelRecord[];
  }

  async getModel(modelId: string): Promise<AiModelRecord> {
    return req(`/ai-models/${encodeURIComponent(modelId)}`);
  }

  async createModel(payload: AiModelUpsertPayload): Promise<{ message: string; ai_model_id: string }> {
    return req('/ai-models/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateModel(modelId: string, payload: AiModelUpsertPayload): Promise<{ message: string; ai_model_id: string }> {
    return req(`/ai-models/${encodeURIComponent(modelId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
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
