import { getValidToken } from './auth';

const BASE = (import.meta as any).env?.VITE_TWIN_API_URL ?? '';
const TOUR_URL = `${BASE}/api/v1/onboarding-tour`;

async function tourHeaders(): Promise<Record<string, string>> {
    const token = await getValidToken();
    const tenantId = localStorage.getItem('tavro_tenant_id') ?? undefined;
    return {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
    };
}

export interface TourStatus {
    showTour: boolean;
    status: 'not_started' | 'completed' | 'skipped';
}

export async function getTourStatus(): Promise<TourStatus> {
    const res = await fetch(`${TOUR_URL}/status`, { headers: await tourHeaders() });
    if (!res.ok) throw new Error('Failed to fetch tour status');
    return res.json();
}

export async function saveTourStatus(status: 'completed' | 'skipped'): Promise<void> {
    const res = await fetch(`${TOUR_URL}/status`, {
        method: 'POST',
        headers: await tourHeaders(),
        body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error('Failed to update tour status');
}
