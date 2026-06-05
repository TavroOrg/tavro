const BASE = '/api/v1/admin/config';

export interface ConfigEntry {
    key: string;
    value: string | null;
    encrypted: boolean;
    description: string | null;
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = localStorage.getItem('tavro_admin_access_token');
    const res = await fetch(`${BASE}${path}`, {
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(init.headers ?? {}),
        },
        ...init,
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
}

export const adminConfigApi = {
    list: () => req<ConfigEntry[]>(''),
    get:  (key: string) => req<ConfigEntry>(`/${key}`),
    update: (key: string, value: string) =>
        req<ConfigEntry>(`/${key}`, {
            method: 'PUT',
            body: JSON.stringify({ value }),
        }),
};
