import { getValidToken } from './auth';

const BASE = (import.meta as any).env?.VITE_TWIN_API_URL ?? '';
const V1 = `${BASE}/api/v1`;

export interface DriveImportResult {
    total_files: number;
    agents_imported: number;
    use_cases_imported: number;
    errors: string[];
    message: string;
}

export const driveApi = {
    async importFromDrive(folderUrl: string): Promise<DriveImportResult> {
        const token = await getValidToken();
        const tenantId = localStorage.getItem('tavro_tenant_id') ?? undefined;
        const res = await fetch(`${V1}/drive/import`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
            },
            body: JSON.stringify({ folder_url: folderUrl }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `Drive import failed (${res.status})`);
        }
        return res.json();
    },
};
