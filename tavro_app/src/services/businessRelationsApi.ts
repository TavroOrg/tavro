import type {
  AgentRelationsPayload,
  BusinessApplicationRecord,
  BusinessApplicationUpsertPayload,
  BusinessProcessRecord,
  BusinessProcessUpsertPayload,
  IntegrationRecord,
  IntegrationUpsertPayload,
} from '../types/businessRelations';
import { portalActivity } from './portalActivity';
import { parseApiError } from '../utils/errorUtils';
import { appLogger } from './logger';

export interface AgentTableRecord {
  table_id: string;
  table_name: string;
  country_of_provenance: string | null;
  is_linked: boolean;
}

export interface AgentToolRecord {
  effective_tool_id: string;   // always non-null: tool_id if set, else tool_name
  tool_id: string | null;
  tool_name: string;
  tool_description: string | null;
  is_linked: boolean;
}

export interface AgentColumnRecord {
  column_id: string;
  column_name: string;
  table_name: string;
  table_id: string;
  uses_pii: boolean;
  uses_phi: boolean;
  uses_pci: boolean;
  is_linked: boolean;
}

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
  const tenantId = localStorage.getItem('tavro_tenant_id');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
  };
}

async function reqFormData<T>(path: string, formData: FormData): Promise<T> {
  const token = localStorage.getItem('tavro_access_token');
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

function changedApplicationFields(payload: BusinessApplicationUpsertPayload): string {
  const labels: Partial<Record<keyof BusinessApplicationUpsertPayload, string>> = {
    application_name: 'name',
    emergency_tier: 'emergency tier',
    business_owner: 'business owner',
    application_portfolio_manager: 'portfolio manager',
    vendor_name: 'vendor',
    business_criticality: 'business criticality',
    it_application_owner: 'IT owner',
    application_description: 'description',
    embedded_ai: 'embedded AI',
    opt_out_option: 'opt-out option',
    privacy_policy_url: 'privacy policy URL',
    data_excluded_from_ai_training: 'AI training exclusion',
    vendor_description: 'vendor description',
    current_installed_version: 'installed version',
    is_current_version_supported: 'version support',
    latest_released_version: 'latest released version',
    latest_release_date: 'latest release date',
    latest_release_documentation_link: 'release documentation link',
  };
  const fields = (Object.keys(payload) as Array<keyof BusinessApplicationUpsertPayload>)
    .map(key => labels[key])
    .filter(Boolean);
  return fields.length > 0 ? `${fields.join(', ')} updated` : 'details updated';
}

function changedProcessFields(payload: BusinessProcessUpsertPayload): string {
  const labels: Partial<Record<keyof BusinessProcessUpsertPayload, string>> = {
    process_number: 'process number',
    process_name: 'name',
    process_description: 'description',
    parent_process_id: 'parent process',
    stakeholders: 'stakeholders',
    owner: 'owner',
    operators: 'operators',
    business_criticality: 'business criticality',
    reputational_impact: 'reputational impact',
    financial_impact: 'financial impact',
    regulatory_impact: 'regulatory impact',
    sla: 'SLA',
    process_health_state: 'health state',
  };
  const fields = (Object.keys(payload) as Array<keyof BusinessProcessUpsertPayload>)
    .map(key => labels[key])
    .filter(Boolean);
  return fields.length > 0 ? `${fields.join(', ')} updated` : 'details updated';
}

function changedIntegrationFields(payload: IntegrationUpsertPayload): string {
  const labels: Partial<Record<keyof IntegrationUpsertPayload, string>> = {
    integration_name: 'name',
    integration_description: 'description',
    capabilities: 'capabilities',
    protocol: 'protocol',
    endpoint_url: 'endpoint URL',
    authentication_method: 'authentication method',
    owner: 'owner',
    documentation_url: 'documentation URL',
    data_sensitivity: 'data sensitivity',
    rate_limit: 'rate limit',
    availability_status: 'availability status',
    sla: 'SLA',
    version: 'version',
    parent_application_id: 'parent application',
  };
  const fields = (Object.keys(payload) as Array<keyof IntegrationUpsertPayload>)
    .map(key => labels[key])
    .filter(Boolean);
  return fields.length > 0 ? `${fields.join(', ')} updated` : 'details updated';
}

class BusinessRelationsApi {
  async listApplications(search?: string, companyId?: string): Promise<BusinessApplicationRecord[]> {
    const params = new URLSearchParams();
    if (search?.trim()) params.set('q', search.trim());
    if (companyId) params.set('company_id', companyId);
    params.set('offset', '0');
    params.set('limit', '500');
    const suffix = params.toString() ? `?${params.toString()}` : '';
    appLogger.req('GET /api/v1/applications', { search, companyId });
    const t0 = Date.now();
    const data = await req<any>(`/applications${suffix}`);
    const items = Array.isArray(data) ? data as BusinessApplicationRecord[] : (data?.items ?? []) as BusinessApplicationRecord[];
    appLogger.res('GET /api/v1/applications', { count: items.length }, Date.now() - t0);
    return items;
  }

  async countApplications(companyId?: string): Promise<number> {
    const params = new URLSearchParams({ offset: '0', limit: '1' });
    if (companyId) params.set('company_id', companyId);
    const data = await req<any>(`/applications?${params.toString()}`);
    return (data?.total ?? 0) as number;
  }

  async getApplication(applicationId: string, companyId?: string): Promise<BusinessApplicationRecord> {
    const suffix = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
    return req(`/applications/${encodeURIComponent(applicationId)}${suffix}`);
  }

  async createApplication(payload: BusinessApplicationUpsertPayload, companyId?: string): Promise<BusinessApplicationRecord> {
    const qs = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
    const result = await req<BusinessApplicationRecord>(`/applications${qs}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    portalActivity.record(`Added application: ${result.application_name || payload.application_name || 'Untitled application'}`, 'emerald');
    window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
    return result;
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
    const result = await req<BusinessApplicationRecord>(`/applications/${encodeURIComponent(applicationId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    const displayName = result.application_name || payload.application_name || applicationId;
    portalActivity.record(`Application "${displayName}" — ${changedApplicationFields(payload)}`, 'violet');
    window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
    return result;
  }

  async deleteApplication(applicationId: string): Promise<void> {
    await req(`/applications/${encodeURIComponent(applicationId)}`, {
      method: 'DELETE',
    });
  }

  async uploadApplications(
    files: File[],
    companyId?: string,
    companyName?: string,
  ): Promise<{ uploaded_count: number; total_submitted: number; failed_count: number; message: string; errors: string[] }> {
    const formData = new FormData();
    for (const file of files) formData.append('files', file, file.name);
    const qp = new URLSearchParams();
    if (companyId) qp.set('company_id', companyId);
    if (companyName) qp.set('company_name', companyName);
    const qs = qp.toString() ? `?${qp}` : '';
    const result = await reqFormData<{ uploaded_count: number; total_submitted: number; failed_count: number; message: string; errors: string[] }>(
      `/applications/upload${qs}`,
      formData,
    );
    portalActivity.record(
      `Loaded ${result.uploaded_count} business application${result.uploaded_count === 1 ? '' : 's'}`,
      'emerald',
    );
    window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
    return result;
  }

  async listProcesses(search?: string, companyId?: string): Promise<BusinessProcessRecord[]> {
    const params = new URLSearchParams();
    if (search?.trim()) params.set('q', search.trim());
    if (companyId) params.set('company_id', companyId);
    params.set('offset', '0');
    params.set('limit', '500');
    const suffix = params.toString() ? `?${params.toString()}` : '';
    appLogger.req('GET /api/v1/processes', { search, companyId });
    const t0 = Date.now();
    const data = await req<any>(`/processes${suffix}`);
    const items = Array.isArray(data) ? data as BusinessProcessRecord[] : (data?.items ?? []) as BusinessProcessRecord[];
    appLogger.res('GET /api/v1/processes', { count: items.length }, Date.now() - t0);
    return items;
  }

  async countProcesses(companyId?: string): Promise<number> {
    const params = new URLSearchParams({ offset: '0', limit: '1' });
    if (companyId) params.set('company_id', companyId);
    const data = await req<any>(`/processes?${params.toString()}`);
    return (data?.total ?? 0) as number;
  }

  async getProcess(processId: string, companyId?: string): Promise<BusinessProcessRecord> {
    const suffix = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
    return req(`/processes/${encodeURIComponent(processId)}${suffix}`);
  }

  async createProcess(payload: BusinessProcessUpsertPayload, companyId?: string): Promise<BusinessProcessRecord> {
    const qs = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
    const result = await req<BusinessProcessRecord>(`/processes${qs}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    portalActivity.record(`Added process: ${result.process_name || payload.process_name || 'Untitled process'}`, 'emerald');
    window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
    return result;
  }

  async suggestProcessDescription(processName: string): Promise<{ description: string }> {
    return req('/processes/suggest-description', {
      method: 'POST',
      body: JSON.stringify({ process_name: processName }),
    });
  }

  async suggestIntegrationDescription(integrationName: string): Promise<{ description: string }> {
    return req('/integrations/suggest-description', {
      method: 'POST',
      body: JSON.stringify({ integration_name: integrationName }),
    });
  }

  async updateProcess(
    processId: string,
    payload: BusinessProcessUpsertPayload,
  ): Promise<BusinessProcessRecord> {
    const result = await req<BusinessProcessRecord>(`/processes/${encodeURIComponent(processId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    const displayName = result.process_name || payload.process_name || processId;
    portalActivity.record(`Process "${displayName}" — ${changedProcessFields(payload)}`, 'violet');
    window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
    return result;
  }

  async deleteProcess(processId: string): Promise<void> {
    await req(`/processes/${encodeURIComponent(processId)}`, {
      method: 'DELETE',
    });
  }

  async uploadProcesses(
    files: File[],
    companyId?: string,
    companyName?: string,
  ): Promise<{ uploaded_count: number; total_submitted: number; failed_count: number; message: string; errors: string[]; warnings: string[] }> {
    const formData = new FormData();
    for (const file of files) formData.append('files', file, file.name);
    const qp = new URLSearchParams();
    if (companyId) qp.set('company_id', companyId);
    if (companyName) qp.set('company_name', companyName);
    const qs = qp.toString() ? `?${qp}` : '';
    const result = await reqFormData<{ uploaded_count: number; total_submitted: number; failed_count: number; message: string; errors: string[]; warnings: string[] }>(
      `/processes/upload${qs}`,
      formData,
    );
    portalActivity.record(
      `Loaded ${result.uploaded_count} business process${result.uploaded_count === 1 ? '' : 'es'}`,
      'emerald',
    );
    window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
    return result;
  }
  
  async getAgentRelations(agentId: string, companyId?: string): Promise<AgentRelationsPayload> {
    const params = new URLSearchParams();
    if (companyId) params.set('company_id', companyId);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return req(`/agents/${encodeURIComponent(agentId)}${suffix}`);
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
      throw new Error(parseApiError(res.status, body));
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
      throw new Error(parseApiError(res.status, body));
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
      throw new Error(parseApiError(res.status, body));
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

  async linkAgentToIntegration(agentId: string, integrationId: string): Promise<void> {
    await req(`/agents/${encodeURIComponent(agentId)}/integrations/${encodeURIComponent(integrationId)}`, {
      method: 'PUT',
    });
  }

  async unlinkAgentFromIntegration(agentId: string, integrationId: string): Promise<void> {
    await req(`/agents/${encodeURIComponent(agentId)}/integrations/${encodeURIComponent(integrationId)}`, {
      method: 'DELETE',
    });
  }

  async listAgentTables(agentId: string, search?: string): Promise<{ items: AgentTableRecord[]; total: number }> {
    const params = new URLSearchParams();
    if (search?.trim()) params.set('q', search.trim());
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return req(`/agents/${encodeURIComponent(agentId)}/tables${suffix}`);
  }

  async linkAgentToTable(agentId: string, tableId: string): Promise<void> {
    await req(`/agents/${encodeURIComponent(agentId)}/tables/${encodeURIComponent(tableId)}`, { method: 'PUT' });
  }

  async unlinkAgentFromTable(agentId: string, tableId: string): Promise<void> {
    await req(`/agents/${encodeURIComponent(agentId)}/tables/${encodeURIComponent(tableId)}`, { method: 'DELETE' });
  }

  async listAgentColumns(agentId: string, search?: string): Promise<{ items: AgentColumnRecord[]; total: number }> {
    const params = new URLSearchParams();
    if (search?.trim()) params.set('q', search.trim());
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return req(`/agents/${encodeURIComponent(agentId)}/columns${suffix}`);
  }

  async linkAgentToColumn(agentId: string, columnId: string): Promise<void> {
    await req(`/agents/${encodeURIComponent(agentId)}/columns/${encodeURIComponent(columnId)}`, { method: 'PUT' });
  }

  async unlinkAgentFromColumn(agentId: string, columnId: string): Promise<void> {
    await req(`/agents/${encodeURIComponent(agentId)}/columns/${encodeURIComponent(columnId)}`, { method: 'DELETE' });
  }

  async ensureAgentToolUuids(agentId: string): Promise<{ fixed: number }> {
    return req(`/agents/${encodeURIComponent(agentId)}/tools/ensure-uuids`, { method: 'POST' });
  }

  async listAgentTools(agentId: string, search?: string): Promise<{ items: AgentToolRecord[]; total: number }> {
    const params = new URLSearchParams();
    if (search?.trim()) params.set('q', search.trim());
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return req(`/agents/${encodeURIComponent(agentId)}/tools${suffix}`);
  }

  async linkAgentToTool(agentId: string, toolId: string): Promise<void> {
    await req(`/agents/${encodeURIComponent(agentId)}/tools/${encodeURIComponent(toolId)}`, {
      method: 'PUT',
    });
  }

  async unlinkAgentFromTool(agentId: string, toolId: string): Promise<void> {
    await req(`/agents/${encodeURIComponent(agentId)}/tools/${encodeURIComponent(toolId)}`, {
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
    appLogger.req('GET /api/v1/integrations', { search, companyId });
    const t0 = Date.now();
    const data = await req<unknown>(`/integrations${suffix}`);
    const items = Array.isArray(data) ? data as IntegrationRecord[] : ((data as { items?: IntegrationRecord[] })?.items ?? []) as IntegrationRecord[];
    appLogger.res('GET /api/v1/integrations', { count: items.length }, Date.now() - t0);
    return items;
  }

  async countIntegrations(companyId?: string): Promise<number> {
    const params = new URLSearchParams({ offset: '0', limit: '1' });
    if (companyId) params.set('company_id', companyId);
    const data = await req<any>(`/integrations?${params.toString()}`);
    return (data?.total ?? 0) as number;
  }

  async getIntegration(integrationId: string, companyId?: string): Promise<IntegrationRecord> {
    const suffix = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
    return req(`/integrations/${encodeURIComponent(integrationId)}${suffix}`);
  }

  async createIntegration(payload: IntegrationUpsertPayload, companyId?: string): Promise<IntegrationRecord> {
    const qs = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
    const result = await req<IntegrationRecord>(`/integrations${qs}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    portalActivity.record(`Added integration: ${result.integration_name || payload.integration_name || 'Untitled integration'}`, 'emerald');
    window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
    return result;
  }

  async updateIntegration(
    integrationId: string,
    payload: IntegrationUpsertPayload,
    companyId?: string,
  ): Promise<IntegrationRecord> {
    const qs = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
    const result = await req<IntegrationRecord>(`/integrations/${encodeURIComponent(integrationId)}${qs}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    const displayName = result.integration_name || payload.integration_name || integrationId;
    portalActivity.record(`Integration "${displayName}" — ${changedIntegrationFields(payload)}`, 'violet');
    window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
    return result;
  }

  async deleteIntegration(integrationId: string): Promise<void> {
    await req(`/integrations/${encodeURIComponent(integrationId)}`, {
      method: 'DELETE',
    });
  }

  async uploadIntegrations(
    files: File[],
    companyId?: string,
    companyName?: string,
  ): Promise<{ uploaded_count: number; total_submitted: number; failed_count: number; message: string; errors: string[] }> {
    const formData = new FormData();
    for (const file of files) formData.append('files', file, file.name);
    const qp = new URLSearchParams();
    if (companyId) qp.set('company_id', companyId);
    if (companyName) qp.set('company_name', companyName);
    const qs = qp.toString() ? `?${qp}` : '';
    const result = await reqFormData<{ uploaded_count: number; total_submitted: number; failed_count: number; message: string; errors: string[] }>(
      `/integrations/upload${qs}`,
      formData,
    );
    portalActivity.record(
      `Loaded ${result.uploaded_count} business integration${result.uploaded_count === 1 ? '' : 's'}`,
      'violet',
    );
    window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
    return result;
  }
}

export const businessRelationsApi = new BusinessRelationsApi();
