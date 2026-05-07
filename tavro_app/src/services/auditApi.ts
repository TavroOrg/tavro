// ── src/services/auditApi.ts ─────────────────────────────────────────────────

import type { AuditRun, AuditFinding, AuditInitRequest, AuditSSEEvent } from '../types/audit';

const BASE = import.meta.env.VITE_TWIN_API_URL ?? '';
const V1   = `${BASE}/api/v1/audit`;

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${V1}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

class AuditApiService {

  async initiateAudit(body: AuditInitRequest): Promise<{ audit_run_id: string; status: string; total_pairs: number; message: string }> {
    return req('/runs', { method: 'POST', body: JSON.stringify(body) });
  }

  async listRuns(companyId: string, limit = 20): Promise<AuditRun[]> {
    return req(`/runs?company_id=${companyId}&limit=${limit}`);
  }

  async getRun(runId: string): Promise<AuditRun & { findings: AuditFinding[] }> {
    return req(`/runs/${runId}`);
  }

  async getFinding(runId: string, findingId: string): Promise<AuditFinding> {
    return req(`/runs/${runId}/findings/${findingId}`);
  }

  async cancelRun(runId: string): Promise<void> {
    return req(`/runs/${runId}`, { method: 'DELETE' });
  }

  /**
   * Open an SSE stream for audit progress.
   * Returns an EventSource-like cleanup function.
   */
  streamProgress(
    runId: string,
    onEvent: (event: AuditSSEEvent) => void,
    onError?: (err: Event) => void,
  ): () => void {
    const es = new EventSource(`${V1}/runs/${runId}/stream`);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as AuditSSEEvent;
        onEvent(data);
        if (data.type === 'done' || data.type === 'error' || data.type === 'timeout') {
          es.close();
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = (e) => {
      onError?.(e);
      es.close();
    };

    return () => es.close();
  }
}

export const auditApi = new AuditApiService();
