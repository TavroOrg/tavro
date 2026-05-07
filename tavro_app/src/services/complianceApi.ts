// ── src/services/complianceApi.ts ────────────────────────────────────────────

import type {
  ComplianceItem, ComplianceItemCreate,
  ComplianceDimType, ComplianceDimension,
  ComplianceImpact, ComplianceImpactCreate,
  ComplianceDocument,
  ComplianceItemType,
} from '../types/compliance';

const BASE = import.meta.env.VITE_TWIN_API_URL ?? '';
const V1   = `${BASE}/api/v1/compliance`;

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
    throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

interface Page<T> { total: number; offset: number; limit: number; items: T[] }

class ComplianceApiService {

  // ── Items ─────────────────────────────────────────────────────────────────

  async listItems(params: {
    item_type?:  ComplianceItemType;
    company_id?: string;
    status?:     string;
    search?:     string;
    offset?:     number;
    limit?:      number;
  }): Promise<Page<ComplianceItem>> {
    const p = new URLSearchParams();
    if (params.item_type)  p.set('item_type',  params.item_type);
    if (params.company_id) p.set('company_id', params.company_id);
    if (params.status)     p.set('status',     params.status);
    if (params.search)     p.set('search',     params.search);
    if (params.offset)     p.set('offset',     String(params.offset));
    if (params.limit)      p.set('limit',      String(params.limit));
    return req(`/items?${p}`);
  }

  async getItem(id: string): Promise<ComplianceItem> {
    return req(`/items/${id}`);
  }

  async createItem(body: ComplianceItemCreate): Promise<ComplianceItem> {
    return req('/items', { method: 'POST', body: JSON.stringify(body) });
  }

  async updateItem(id: string, body: Partial<ComplianceItemCreate>): Promise<ComplianceItem> {
    return req(`/items/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  }

  async deleteItem(id: string): Promise<{ deleted: string }> {
    return req(`/items/${id}`, { method: 'DELETE' });
  }

  // ── Dim types ─────────────────────────────────────────────────────────────

  async listDimTypes(scope?: string): Promise<ComplianceDimType[]> {
    const p = scope ? `?scope=${scope}` : '';
    return req(`/dim-types${p}`);
  }

  // ── Dimensions ────────────────────────────────────────────────────────────

  async listDimensions(itemId: string): Promise<ComplianceDimension[]> {
    return req(`/items/${itemId}/dimensions`);
  }

  async createDimension(body: {
    compliance_item_id: string;
    dim_type_id:        string;
    label:              string;
    summary?:           string;
    tags?:              string[];
    visibility?:        string;
    sensitive?:         boolean;
    sort_order?:        number;
  }): Promise<ComplianceDimension> {
    return req('/dimensions', { method: 'POST', body: JSON.stringify(body) });
  }

  async updateDimension(id: string, body: {
    label?:      string;
    summary?:    string;
    tags?:       string[];
    visibility?: string;
    sensitive?:  boolean;
  }): Promise<ComplianceDimension> {
    return req(`/dimensions/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  }

  async deleteDimension(id: string): Promise<void> {
    return req(`/dimensions/${id}`, { method: 'DELETE' });
  }

  // ── Impacts ───────────────────────────────────────────────────────────────

  async listImpacts(itemId: string, companyId?: string): Promise<ComplianceImpact[]> {
    const p = companyId ? `?company_id=${companyId}` : '';
    return req(`/items/${itemId}/impacts${p}`);
  }

  async createImpact(body: ComplianceImpactCreate): Promise<ComplianceImpact> {
    return req('/impacts', { method: 'POST', body: JSON.stringify(body) });
  }

  async updateImpact(id: string, body: Partial<ComplianceImpactCreate>): Promise<ComplianceImpact> {
    return req(`/impacts/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  }

  async deleteImpact(id: string): Promise<void> {
    return req(`/impacts/${id}`, { method: 'DELETE' });
  }

  // ── Documents ─────────────────────────────────────────────────────────────

  async listDocuments(itemId: string): Promise<ComplianceDocument[]> {
    return req(`/items/${itemId}/documents`);
  }

  async uploadDocument(body: {
    compliance_item_id: string;
    doc_type:           string;
    title:              string;
    filename?:          string;
    mime_type?:         string;
    content_base64?:    string;
    source_url?:        string;
    version?:           string;
  }): Promise<ComplianceDocument> {
    return req('/documents', { method: 'POST', body: JSON.stringify(body) });
  }

  async deleteDocument(id: string): Promise<void> {
    return req(`/documents/${id}`, { method: 'DELETE' });
  }

  // ── Research ──────────────────────────────────────────────────────────────

  async researchRegulation(params: {
    name:           string;
    short_name?:    string;
    issuing_body?:  string;
    jurisdiction?:  string[];
    industry_tags?: string[];
  }): Promise<{ dimensions: any[]; sources: string[]; notice: string; turns_used: number }> {
    return req('/research/regulation', { method: 'POST', body: JSON.stringify(params) });
  }

  async researchPolicy(params: {
    name:        string;
    company_id:  string;
    description?: string;
    doc_text?:   string;
  }): Promise<{ dimensions: any[]; sources: string[]; notice: string; turns_used: number }> {
    return req('/research/policy', { method: 'POST', body: JSON.stringify(params) });
  }

  async saveDimensions(compliance_item_id: string, dimensions: any[]): Promise<{ saved: number; skipped: number }> {
    return req('/save-dimensions', { method: 'POST', body: JSON.stringify({ compliance_item_id, dimensions }) });
  }

  // ── Company summary ───────────────────────────────────────────────────────

  async getCompanySummary(companyId: string): Promise<any[]> {
    return req(`/company/${companyId}/summary`);
  }
}

export const complianceApi = new ComplianceApiService();
