// â”€â”€ src/services/datahubContextApi.ts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Thin REST client for the DataHub PGVector semantic search.
// Mirrors blueprintApi's req() pattern â€” same Tavro Digital Twin FastAPI.
// Called directly from the chat flow for every turn (not an LLM tool) so the
// assistant always has DataHub grounding scoped to that turn's query.

import type { DataHubSearchOptions, DataHubSearchResponse } from '../types/datahubContext';
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
      return retry.json();
    }
    throw new Error('Request unauthorized. Please check your credentials.');
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(parseApiError(res.status, body));
  }
  return res.json();
}

class DataHubContextApiService {
  /** Search scoped to a query and optional exact metadata filters. */
  async search(query: string, companyId?: string, limit = 8): Promise<DataHubSearchResponse> {
    return this.searchWithOptions({ query, companyId, limit });
  }

  async searchWithOptions(options: DataHubSearchOptions): Promise<DataHubSearchResponse> {
    const params = new URLSearchParams({
      query: options.query,
      limit: String(options.limit ?? 8),
    });
    if (options.companyId) params.set('company_id', options.companyId);
    if (options.schema) params.set('schema', options.schema);
    if (options.vendor) params.set('vendor', options.vendor);
    if (options.application) params.set('application', options.application);
    if (options.entityType) params.set('entity_type', options.entityType);
    if (options.countOnly) params.set('count_only', 'true');
    return req(`/datahub-context/search?${params.toString()}`);
  }
}

export const datahubContextApi = new DataHubContextApiService();
