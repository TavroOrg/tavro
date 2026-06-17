// ── src/services/complianceApi.ts ────────────────────────────────────────────

import type {
  ComplianceItem, ComplianceItemCreate,
  ComplianceDimType, ComplianceDimension,
  ComplianceImpact, ComplianceImpactCreate,
  ComplianceDocument,
  ComplianceItemType,
} from '../types/compliance';
import { portalActivity } from './portalActivity';

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

const complianceTypeLabel = (type?: ComplianceItemType) => type === 'policy' ? 'policy' : 'regulation';

function changedComplianceItemFields(body: Partial<ComplianceItemCreate>): string {
  const labels: Partial<Record<keyof ComplianceItemCreate, string>> = {
    item_type: 'type',
    scope: 'scope',
    name: 'name',
    short_name: 'short name',
    description: 'description',
    issuing_body: 'issuing body',
    jurisdiction: 'jurisdiction',
    industry_tags: 'industry tags',
    company_id: 'company',
    effective_date: 'effective date',
    review_date: 'review date',
    status: 'status',
  };
  const fields = (Object.keys(body) as Array<keyof ComplianceItemCreate>)
    .map(key => labels[key])
    .filter(Boolean);
  return fields.length > 0 ? `${fields.join(', ')} updated` : 'details updated';
}

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
    const result = await req<ComplianceItem>('/items', { method: 'POST', body: JSON.stringify(body) });
    portalActivity.record(`Created ${complianceTypeLabel(result.item_type)}: ${result.name || body.name}`, 'emerald');
    return result;
  }

  async suggestDescription(body: {
    item_type: ComplianceItemType;
    name: string;
    short_name?: string;
    issuing_body?: string;
  }): Promise<{ description: string }> {
    return req('/suggest-description', { method: 'POST', body: JSON.stringify(body) });
  }
  
  async updateItem(id: string, body: Partial<ComplianceItemCreate>): Promise<ComplianceItem> {
    const result = await req<ComplianceItem>(`/items/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    portalActivity.record(`${complianceTypeLabel(result.item_type)} "${result.name || body.name || id}" — ${changedComplianceItemFields(body)}`, 'violet');
    return result;
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
    const result = await req<ComplianceDimension>('/dimensions', { method: 'POST', body: JSON.stringify(body) });
    portalActivity.record(`Added compliance dimension: ${result.label || body.label}`, 'emerald');
    return result;
  }

  async updateDimension(id: string, body: {
    label?:      string;
    summary?:    string;
    tags?:       string[];
    visibility?: string;
    sensitive?:  boolean;
  }): Promise<ComplianceDimension> {
    const result = await req<ComplianceDimension>(`/dimensions/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    portalActivity.record(`Compliance dimension "${result.label || body.label || id}" updated`, 'violet');
    return result;
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
    const result = await req<ComplianceImpact>('/impacts', { method: 'POST', body: JSON.stringify(body) });
    portalActivity.record(`Added compliance impact mapping`, 'emerald');
    return result;
  }

  async updateImpact(id: string, body: Partial<ComplianceImpactCreate>): Promise<ComplianceImpact> {
    const result = await req<ComplianceImpact>(`/impacts/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    portalActivity.record(`Updated compliance impact mapping`, 'violet');
    return result;
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
    const result = await req<ComplianceDocument>('/documents', { method: 'POST', body: JSON.stringify(body) });
    portalActivity.record(`Added compliance document: ${result.title || body.title}`, 'emerald');
    return result;
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
  }): Promise<{ job_id: string }> {
    return req('/research/regulation', { method: 'POST', body: JSON.stringify(params) });
  }

  async researchPolicy(params: {
    name:        string;
    company_id:  string;
    description?: string;
    doc_text?:   string;
  }): Promise<{ job_id: string }> {
    return req('/research/policy', { method: 'POST', body: JSON.stringify(params) });
  }

  async pollResearchJob(
    jobId: string,
    intervalMs = 2500,
    timeoutMs  = 300_000,
  ): Promise<{ dimensions: any[]; sources: string[]; notice: string; turns_used: number }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, intervalMs));
      const job: { status: string; result: any; error: string | null } =
        await req(`/research/job/${jobId}`);
      if (job.status === 'done')   return job.result;
      if (job.status === 'error')  throw new Error(job.error ?? 'Research failed');
    }
    throw new Error('Research timed out — please try again');
  }

  async saveDimensions(compliance_item_id: string, dimensions: any[]): Promise<{ saved: number; skipped: number }> {
    const result = await req<{ saved: number; skipped: number }>('/save-dimensions', { method: 'POST', body: JSON.stringify({ compliance_item_id, dimensions }) });
    if (result.saved > 0) {
      portalActivity.record(`Added ${result.saved} researched compliance dimension${result.saved === 1 ? '' : 's'}`, 'emerald');
    }
    return result;
  }

  // ── Company summary ───────────────────────────────────────────────────────

  async getCompanySummary(companyId: string): Promise<any[]> {
    return req(`/company/${companyId}/summary`);
  }
}

export const complianceApi = new ComplianceApiService();
