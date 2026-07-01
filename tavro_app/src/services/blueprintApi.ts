// ── src/services/blueprintApi.ts ──────────────────────────────────────────────
// Thin REST client for the Tavro Digital Twin FastAPI.
// Mirrors the mcpClient pattern: a singleton class exported as blueprintApi.
// Base URL is read from VITE_TWIN_API_URL (defaults to localhost:8000 for dev).

import type {
  Company, CompanyCreate,
  DimType,
  DimNode, DimNodeCreate, DimNodeUpdate,
  DimEdge, DimEdgeCreate,
  SourceRef, SourceRefDetail,
  GraphData,
  Page,
  DimCategory,
  DimNodeAttachment,
} from '../types/blueprint';
import { getValidToken, refreshAccessToken } from './auth';
import { parseApiError } from '../utils/errorUtils';

const BASE = (import.meta as any).env?.VITE_TWIN_API_URL ?? '';
const V1 = `${BASE}/api/v1`;

function buildHeaders(token: string | null): Record<string, string> {
  const tenantId = localStorage.getItem('tavro_tenant_id');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  return headers;
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getValidToken();
  const res = await fetch(`${V1}${path}`, {
    ...init,
    headers: { ...buildHeaders(token), ...(init.headers ?? {}) },
  });

  if (res.status === 401) {
    // Token was valid at call time but the server still rejected it.
    // Attempt one silent refresh and retry before giving up.
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const newToken = localStorage.getItem('tavro_access_token');
      const retry = await fetch(`${V1}${path}`, {
        ...init,
        headers: { ...buildHeaders(newToken), ...(init.headers ?? {}) },
      });
      if (retry.status === 401) {
        throw new Error('Request unauthorized. Please check your credentials.');
      }
      if (!retry.ok) { const retryBody = await retry.text(); throw new Error(parseApiError(retry.status, retryBody)); }
      if (retry.status === 204) return undefined as T;
      return retry.json();
    }
    throw new Error('Request unauthorized. Please check your credentials.');
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(parseApiError(res.status, body));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Research ───────────────────────────────────────────────────────────────

export interface ResearchedNode {
  category: string;
  label: string;
  summary: string;
  tags: string[];
  visibility: string;
  sensitive: boolean;
}

export interface ResearchResponse {
  nodes: ResearchedNode[];
  sources: string[];
  notice: string;
}

export type ResearchStreamEvent =
  | { type: 'status';    message: string }
  | { type: 'heartbeat' }
  | { type: 'result';    data: ResearchResponse }
  | { type: 'error';     message: string };

// ── BlueprintApiService ───────────────────────────────────────────────────────

class BlueprintApiService {

  // ── Companies ──────────────────────────────────────────────────────────────

  async listCompanies(offset = 0, limit = 50): Promise<Page<Company>> {
    return req(`/companies?offset=${offset}&limit=${limit}`);
  }

  async listAllCompanies(): Promise<Company[]> {
    const pageSize = 200;
    const first = await this.listCompanies(0, pageSize);
    if (first.total <= first.items.length) return first.items;
    const totalPages = Math.ceil(first.total / pageSize);
    const remaining = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) =>
        this.listCompanies((i + 1) * pageSize, pageSize),
      ),
    );
    return [first.items, ...remaining.map(p => p.items)].flat();
  }

  async getCompany(id: string): Promise<Company> {
    return req(`/companies/${id}`);
  }

  async createCompany(body: CompanyCreate): Promise<Company> {
    return req('/companies', { method: 'POST', body: JSON.stringify(body) });
  }

  async updateCompany(id: string, body: Partial<CompanyCreate>): Promise<Company> {
    return req(`/companies/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  }

  async deleteCompany(id: string): Promise<void> {
    return req(`/companies/${id}`, { method: 'DELETE' });
  }

  // ── Dimension Types ────────────────────────────────────────────────────────

  async listDimTypes(): Promise<DimType[]> {
    return req('/dim-types');
  }

  // ── Dimension Nodes ────────────────────────────────────────────────────────

  async listNodes(params: {
    company_id: string;
    dim_type_id?: string;
    category?: DimCategory;
    search?: string;
    active_only?: boolean;
    offset?: number;
    limit?: number;
  }): Promise<Page<DimNode>> {
    const p = new URLSearchParams({ company_id: params.company_id });
    if (params.dim_type_id) p.set('dim_type_id', params.dim_type_id);
    if (params.category) p.set('category', params.category);
    if (params.search) p.set('search', params.search);
    if (params.active_only !== undefined) p.set('active_only', String(params.active_only));
    if (params.offset !== undefined) p.set('offset', String(params.offset));
    if (params.limit !== undefined) p.set('limit', String(params.limit));
    return req(`/dim-nodes?${p}`);
  }

  async getNode(id: string): Promise<DimNode> {
    return req(`/dim-nodes/${id}`);
  }

  async createNode(body: DimNodeCreate): Promise<DimNode> {
    return req('/dim-nodes', { method: 'POST', body: JSON.stringify(body) });
  }

  async updateNode(id: string, body: DimNodeUpdate): Promise<DimNode> {
    return req(`/dim-nodes/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  }

  async deleteNode(id: string): Promise<void> {
    return req(`/dim-nodes/${id}`, { method: 'DELETE' });
  }

  // ── Dimension Edges ────────────────────────────────────────────────────────

  async listEdges(params: {
    company_id: string;
    node_id?: string;
    rel_type?: string;
  }): Promise<Page<DimEdge>> {
    const p = new URLSearchParams({ company_id: params.company_id });
    if (params.node_id) p.set('node_id', params.node_id);
    if (params.rel_type) p.set('rel_type', params.rel_type);
    return req(`/dim-edges?${p}`);
  }

  async createEdge(body: DimEdgeCreate): Promise<DimEdge> {
    return req('/dim-edges', { method: 'POST', body: JSON.stringify(body) });
  }

  async deleteEdge(id: string): Promise<void> {
    return req(`/dim-edges/${id}`, { method: 'DELETE' });
  }

  // ── Source References ──────────────────────────────────────────────────────

  async listSourceRefs(nodeId: string): Promise<SourceRef[]> {
    return req(`/source-refs/node/${nodeId}`);
  }

  async fetchSourceDetail(refId: string): Promise<SourceRefDetail> {
    return req(`/source-refs/${refId}/fetch`, { method: 'POST' });
  }

  async createSourceRef(
    dimNodeId: string,
    systemName: string,
    externalId: string,
    mcpTool: string = '',
  ): Promise<SourceRef> {
    return req('/source-refs', {
      method: 'POST',
      body: JSON.stringify({
        dim_node_id: dimNodeId,
        system_name: systemName,
        external_id: externalId,
        mcp_tool: mcpTool,
      }),
    });
  }

  async deleteSourceRef(id: string): Promise<void> {
    return req(`/source-refs/${id}`, { method: 'DELETE' });
  }

  // ── Graph ──────────────────────────────────────────────────────────────────

  async getCompanyGraph(companyId: string): Promise<GraphData> {
    return req(`/graph/company/${companyId}`);
  }

  async getNeighbourhood(nodeId: string, hops = 2): Promise<GraphData> {
    return req(`/graph/node/${nodeId}/neighbourhood?hops=${hops}`);
  }

  async getRiskPaths(nodeId: string): Promise<GraphData> {
    return req(`/graph/node/${nodeId}/paths?target_category=risk`);
  }

  async getLinkedEntity(nodeId: string): Promise<{ entity_type: string; entity_id: string } | null> {
    try {
      return await req(`/dim-nodes/${nodeId}/linked-entity`);
    } catch {
      return null;
    }
  }

  // ── Research ───────────────────────────────────────────────────────────────

  async *researchCompanyStream(params: {
    company_id: string;
    company_name: string;
    ticker?: string;
    industry: string;
    is_public?: boolean;
  }): AsyncGenerator<ResearchStreamEvent> {
    const token = await getValidToken();
    const response = await fetch(`${V1}/blueprint/research`, {
      method: 'POST',
      headers: { ...buildHeaders(token) },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API ${response.status}: ${body}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.trim();
          if (line.startsWith('data: ')) {
            try { yield JSON.parse(line.slice(6)); } catch { /* skip malformed */ }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async saveResearchedNodes(company_id: string, nodes: ResearchedNode[]): Promise<{ saved: number; skipped: number }> {
    return req('/blueprint/save-researched-nodes', {
      method: 'POST',
      body: JSON.stringify({ company_id, nodes }),
    });
  }

  async seedTemplate(company_id: string, template: string): Promise<{ seeded: number; skipped: number; message: string }> {
    return req('/blueprint/seed-template', {
      method: 'POST',
      body: JSON.stringify({ company_id, template }),
    });
  }

  async suggestDimension(params: {
    company_id: string;
    company_name: string;
    industry: string;
    category: string;
    label: string;
    existing_dims?: string[];
  }): Promise<{ summary: string; tags: string[] }> {
    return req('/blueprint/suggest-dimension', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  // ── Attachments ──────────────────────────────────────────────────────────

  async listAttachments(nodeId: string): Promise<DimNodeAttachment[]> {
    return req(`/dim-nodes/${nodeId}/attachments`);
  }

  async uploadAttachment(nodeId: string, file: File): Promise<DimNodeAttachment> {
    const token = await getValidToken();
    const form = new FormData();
    form.append('file', file);
    const { 'Content-Type': _, ...headersWithoutContentType } = buildHeaders(token);
    const res = await fetch(`${V1}/dim-nodes/${nodeId}/attachments`, {
      method: 'POST',
      headers: headersWithoutContentType,
      body: form,
    });
    if (!res.ok) throw new Error(parseApiError(res.status, await res.text()));
    return res.json();
  }

  async deleteAttachment(attachmentId: string): Promise<void> {
    return req(`/dim-nodes/attachments/${attachmentId}`, { method: 'DELETE' });
  }

  async downloadAttachment(attachmentId: string, filename: string): Promise<void> {
    const token = await getValidToken();
    const { 'Content-Type': _, ...headersWithoutContentType } = buildHeaders(token);
    const res = await fetch(`${V1}/dim-nodes/attachments/${attachmentId}/download`, {
      headers: headersWithoutContentType,
    });
    if (!res.ok) throw new Error(`Download failed ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export const blueprintApi = new BlueprintApiService();
