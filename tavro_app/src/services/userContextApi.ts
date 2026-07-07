// ── src/services/userContextApi.ts ────────────────────────────────────────────
// Thin REST client for the server-side user preferences endpoint.
// Mirrors blueprintApi.ts's req<T>()/buildHeaders() pattern, adding x-user-id.

import { getValidToken, refreshAccessToken } from './auth';
import { parseApiError } from '../utils/errorUtils';

const BASE = (import.meta as any).env?.VITE_TWIN_API_URL ?? '';
const V1 = `${BASE}/api/v1`;

export interface UserContext {
  default_company_id: string | null;
  theme: 'light' | 'dark' | 'system';
  llm_provider: string | null;
  llm_model: string | null;
  llm_byok_type: string | null;
  llm_byok_base_url: string | null;
}

export type UserContextUpdate = Partial<UserContext>;

function buildHeaders(token: string | null): Record<string, string> {
  const tenantId = localStorage.getItem('tavro_tenant_id');
  const userId = localStorage.getItem('tavro_user_id');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  if (userId) headers['x-user-id'] = userId;
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

/** Fetch the current user's server-side preferences. Requires tavro_user_id to be set. */
export function getUserContext(): Promise<UserContext> {
  return req<UserContext>('/user/context');
}

/** Partially update the current user's server-side preferences. Fields omitted are left unchanged. */
export function patchUserContext(update: UserContextUpdate): Promise<UserContext> {
  return req<UserContext>('/user/context', { method: 'PATCH', body: JSON.stringify(update) });
}

export const userContextApi = { getUserContext, patchUserContext };
