import type { AttachmentRef } from '../store/chatSessionStore';

const BASE = (import.meta as any).env?.VITE_TWIN_API_URL ?? '';
const API = `${BASE}/api/v1`;

export type { AttachmentRef };

export const ACCEPTED_MIME_TYPES = [
    'application/pdf',
    'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
    'text/csv', 'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
].join(',');

export const MAX_ATTACHMENT_SIZE_MB = 20;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

export async function uploadChatAttachment(file: File): Promise<AttachmentRef> {
    const token = localStorage.getItem('tavro_access_token') ?? '';
    const fd = new FormData();
    fd.append('file', file);

    const res = await fetch(`${API}/chat-attachments/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
    });

    if (!res.ok) {
        let detail = `Upload failed (${res.status})`;
        try { detail = (await res.json()).detail ?? detail; } catch { /* ignore */ }
        throw new Error(detail);
    }

    return res.json() as Promise<AttachmentRef>;
}

export async function extractAttachmentText(att: AttachmentRef): Promise<string> {
    const token = localStorage.getItem('tavro_access_token') ?? '';

    const res = await fetch(`${API}/chat-attachments/${att.id}/extract-text`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!res.ok) return `[${att.name}]`;
    return res.text();
}

export function formatAttachmentSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function attachmentDownloadUrl(att: AttachmentRef): string {
    return `${BASE}${att.url}`;
}
