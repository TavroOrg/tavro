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
} from '../types/blueprint';

const BASE = import.meta.env.VITE_TWIN_API_URL ?? '';
const V1 = `${BASE}/api/v1`;

// ── Auth header helper ────────────────────────────────────────────────────────
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
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('tavro:unauthorized', { detail: { body: await res.text() } }));
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
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

// ── BlueprintApiService ───────────────────────────────────────────────────────

class BlueprintApiService {

  // ── Companies ──────────────────────────────────────────────────────────────

  async listCompanies(offset = 0, limit = 50): Promise<Page<Company>> {
    return req(`/companies?offset=${offset}&limit=${limit}`);
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

  // ── Research ───────────────────────────────────────────────────────────────

  async researchCompany(params: {
    company_id: string;
    company_name: string;
    ticker?: string;
    industry: string;
    region: string;
  }): Promise<ResearchResponse> {
    return req('/blueprint/research', {
      method: 'POST',
      body: JSON.stringify(params),
    });
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
}

export const blueprintApi = new BlueprintApiService();
