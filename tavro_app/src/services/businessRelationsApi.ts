import type {
  AgentRelationsPayload,
  BusinessApplicationRecord,
  BusinessApplicationUpsertPayload,
  BusinessProcessRecord,
  BusinessProcessUpsertPayload,
  IntegrationRecord,
  IntegrationUpsertPayload,
} from '../types/businessRelations';

export interface AgentAttachmentRecord {
  id: string;
  agent_id: string;
  filename: string;
  mime_type: string | null;
  file_size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface ApplicationAttachmentRecord {
  id: string;
  application_id: string;
  filename: string;
  mime_type: string | null;
  file_size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface ProcessAttachmentRecord {
  id: string;
  process_id: string;
  filename: string;
  mime_type: string | null;
  file_size_bytes: number;
  created_at: string;
  updated_at: string;
}

const BASE = import.meta.env.VITE_TWIN_API_URL ?? '';
const V1 = `${BASE}/api/v1`;

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('tavro_access_token');
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
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

class BusinessRelationsApi {
  async listApplications(search?: string, companyId?: string): Promise<BusinessApplicationRecord[]> {
    const params = new URLSearchParams();
    if (search?.trim()) params.set('q', search.trim());
    if (companyId) params.set('company_id', companyId);
    params.set('offset', '0');
    params.set('limit', '500');
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const data = await req<any>(`/applications${suffix}`);
    if (Array.isArray(data)) return data as BusinessApplicationRecord[];
    return (data?.items ?? []) as BusinessApplicationRecord[];
  }

  async getApplication(applicationId: string): Promise<BusinessApplicationRecord> {
    return req(`/applications/${encodeURIComponent(applicationId)}`);
  }

  async createApplication(payload: BusinessApplicationUpsertPayload, companyId?: string): Promise<BusinessApplicationRecord> {
    const qs = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
    return req(`/applications${qs}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async suggestApplicationDescription(applicationName: string): Promise<{ description: string }> {
    return req('/applications/suggest-description', {
      method: 'POST',
      body: JSON.stringify({ application_name: applicationName }),
    });
  }

  async updateApplication(
    applicationId: string,
    payload: BusinessApplicationUpsertPayload,
  ): Promise<BusinessApplicationRecord> {
    return req(`/applications/${encodeURIComponent(applicationId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  async deleteApplication(applicationId: string): Promise<void> {
    await req(`/applications/${encodeURIComponent(applicationId)}`, {
      method: 'DELETE',
    });
  }

  async listProcesses(search?: string, companyId?: string): Promise<BusinessProcessRecord[]> {
    const params = new URLSearchParams();
    if (search?.trim()) params.set('q', search.trim());
    if (companyId) params.set('company_id', companyId);
    params.set('offset', '0');
    params.set('limit', '500');
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const data = await req<any>(`/processes${suffix}`);
    if (Array.isArray(data)) return data as BusinessProcessRecord[];
    return (data?.items ?? []) as BusinessProcessRecord[];
  }

  async getProcess(processId: string): Promise<BusinessProcessRecord> {
    return req(`/processes/${encodeURIComponent(processId)}`);
  }

  async createProcess(payload: BusinessProcessUpsertPayload, companyId?: string): Promise<BusinessProcessRecord> {
    const qs = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
    return req(`/processes${qs}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async suggestProcessDescription(processName: string): Promise<{ description: string }> {
    return req('/processes/suggest-description', {
      method: 'POST',
      body: JSON.stringify({ process_name: processName }),
    });
  }

  async updateProcess(
    processId: string,
    payload: BusinessProcessUpsertPayload,
  ): Promise<BusinessProcessRecord> {
    return req(`/processes/${encodeURIComponent(processId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  async deleteProcess(processId: string): Promise<void> {
    await req(`/processes/${encodeURIComponent(processId)}`, {
      method: 'DELETE',
    });
  }

  async getAgentRelations(agentId: string): Promise<AgentRelationsPayload> {
    return req(`/agents/${encodeURIComponent(agentId)}`);
  }

  async listAgentAttachments(agentId: string): Promise<AgentAttachmentRecord[]> {
    return req(`/agents/${encodeURIComponent(agentId)}/attachments`);
  }

  async uploadAgentAttachment(
    agentId: string,
    payload: { filename: string; mime_type: string; content_base64: string },
  ): Promise<AgentAttachmentRecord> {
    return req(`/agents/${encodeURIComponent(agentId)}/attachments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async deleteAgentAttachment(agentId: string, attachmentId: string): Promise<void> {
    await req(`/agents/${encodeURIComponent(agentId)}/attachments/${encodeURIComponent(attachmentId)}`, {
      method: 'DELETE',
    });
  }

  async downloadAgentAttachment(agentId: string, attachmentId: string): Promise<Blob> {
    const res = await fetch(`${V1}/agents/${encodeURIComponent(agentId)}/attachments/${encodeURIComponent(attachmentId)}/download`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${res.status}: ${body.slice(0, 250)}`);
    }
    return res.blob();
  }

  async listApplicationAttachments(applicationId: string): Promise<ApplicationAttachmentRecord[]> {
    return req(`/applications/${encodeURIComponent(applicationId)}/attachments`);
  }

  async uploadApplicationAttachment(
    applicationId: string,
    payload: { filename: string; mime_type: string; content_base64: string },
  ): Promise<ApplicationAttachmentRecord> {
    return req(`/applications/${encodeURIComponent(applicationId)}/attachments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async deleteApplicationAttachment(applicationId: string, attachmentId: string): Promise<void> {
    await req(`/applications/${encodeURIComponent(applicationId)}/attachments/${encodeURIComponent(attachmentId)}`, {
      method: 'DELETE',
    });
  }

  async downloadApplicationAttachment(applicationId: string, attachmentId: string): Promise<Blob> {
    const res = await fetch(`${V1}/applications/${encodeURIComponent(applicationId)}/attachments/${encodeURIComponent(attachmentId)}/download`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${res.status}: ${body.slice(0, 250)}`);
    }
    return res.blob();
  }

  async listProcessAttachments(processId: string): Promise<ProcessAttachmentRecord[]> {
    return req(`/processes/${encodeURIComponent(processId)}/attachments`);
  }

  async uploadProcessAttachment(
    processId: string,
    payload: { filename: string; mime_type: string; content_base64: string },
  ): Promise<ProcessAttachmentRecord> {
    return req(`/processes/${encodeURIComponent(processId)}/attachments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async deleteProcessAttachment(processId: string, attachmentId: string): Promise<void> {
    await req(`/processes/${encodeURIComponent(processId)}/attachments/${encodeURIComponent(attachmentId)}`, {
      method: 'DELETE',
    });
  }

  async downloadProcessAttachment(processId: string, attachmentId: string): Promise<Blob> {
    const res = await fetch(`${V1}/processes/${encodeURIComponent(processId)}/attachments/${encodeURIComponent(attachmentId)}/download`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${res.status}: ${body.slice(0, 250)}`);
    }
    return res.blob();
  }

  async linkAgentToApplication(agentId: string, applicationId: string): Promise<void> {
    await req(`/agents/${encodeURIComponent(agentId)}/applications/${encodeURIComponent(applicationId)}`, {
      method: 'PUT',
    });
  }

  async unlinkAgentFromApplication(agentId: string, applicationId: string): Promise<void> {
    await req(`/agents/${encodeURIComponent(agentId)}/applications/${encodeURIComponent(applicationId)}`, {
      method: 'DELETE',
    });
  }

  async linkAgentToProcess(agentId: string, processId: string): Promise<void> {
    await req(`/agents/${encodeURIComponent(agentId)}/processes/${encodeURIComponent(processId)}`, {
      method: 'PUT',
    });
  }

  async unlinkAgentFromProcess(agentId: string, processId: string): Promise<void> {
    await req(`/agents/${encodeURIComponent(agentId)}/processes/${encodeURIComponent(processId)}`, {
      method: 'DELETE',
    });
  }

  async linkAgentToChildAgent(parentAgentId: string, childAgentId: string): Promise<void> {
    await req(`/agents/${encodeURIComponent(parentAgentId)}/child-agents/${encodeURIComponent(childAgentId)}`, {
      method: 'PUT',
    });
  }

  async unlinkAgentFromChildAgent(parentAgentId: string, childAgentId: string): Promise<void> {
    await req(`/agents/${encodeURIComponent(parentAgentId)}/child-agents/${encodeURIComponent(childAgentId)}`, {
      method: 'DELETE',
    });
  }

  async listIntegrations(search?: string, companyId?: string): Promise<IntegrationRecord[]> {
    const params = new URLSearchParams();
    if (search?.trim()) params.set('q', search.trim());
    if (companyId) params.set('company_id', companyId);
    params.set('offset', '0');
    params.set('limit', '500');
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const data = await req<unknown>(`/integrations${suffix}`);
    if (Array.isArray(data)) return data as IntegrationRecord[];
    return ((data as { items?: IntegrationRecord[] })?.items ?? []) as IntegrationRecord[];
  }

  async getIntegration(integrationId: string): Promise<IntegrationRecord> {
    return req(`/integrations/${encodeURIComponent(integrationId)}`);
  }

  async createIntegration(payload: IntegrationUpsertPayload, companyId?: string): Promise<IntegrationRecord> {
    const qs = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
    return req(`/integrations${qs}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateIntegration(
    integrationId: string,
    payload: IntegrationUpsertPayload,
    companyId?: string,
  ): Promise<IntegrationRecord> {
    const qs = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
    return req(`/integrations/${encodeURIComponent(integrationId)}${qs}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  async deleteIntegration(integrationId: string): Promise<void> {
    await req(`/integrations/${encodeURIComponent(integrationId)}`, {
      method: 'DELETE',
    });
  }
}

export const businessRelationsApi = new BusinessRelationsApi();
