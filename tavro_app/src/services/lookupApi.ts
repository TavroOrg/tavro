import { getValidToken } from './auth';
import { parseApiError } from '../utils/errorUtils';

const BASE = (import.meta as any).env?.VITE_TWIN_API_URL ?? '';
const V1 = `${BASE}/api/v1`;

export interface LookupValue {
    id: string;
    label: string;
    value: string;
    description: string | null;
    sequence: number;
    is_default: boolean;
}

export interface LookupValueWithField extends LookupValue {
    table_name: string;
    column_name: string;
}

async function authHeaders(): Promise<Record<string, string>> {
    const token = await getValidToken();
    const tenantId = localStorage.getItem('tavro_tenant_id') ?? undefined;
    return {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
    };
}

class LookupApiService {
    // One call, every active option this tenant/company can see, for every
    // field. Meant to be fetched once (e.g. on portal load) and cached
    // client-side rather than fetched per-field.
    async listAll(companyId?: string): Promise<LookupValueWithField[]> {
        const params = new URLSearchParams();
        if (companyId) params.set('company_id', companyId);
        const qs = params.toString() ? `?${params}` : '';
        const res = await fetch(`${V1}/lookup-values${qs}`, { headers: await authHeaders() });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(parseApiError(res.status, body));
        }
        return res.json();
    }
}

export const lookupApi = new LookupApiService();
