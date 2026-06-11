import { getValidToken } from './auth';

const BASE = (import.meta as any).env?.VITE_TWIN_API_URL ?? '';
const V1 = `${BASE}/api/v1`;

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getValidToken();
    const tenantId = localStorage.getItem('tavro_tenant_id') ?? undefined;
    const res = await fetch(`${V1}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
            ...(init.headers ?? {}),
        },
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`API ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.json();
}

// ── Response shape (mirrors tavro_api/api/routers/insights.py) ────────────────

export interface InsightsTotals {
    totalAgents: number;
    totalUseCases: number;
    criticalCount: number;
    highRiskCount: number;
    hitlOpen: number;
}

export interface StageCount {
    stage: string;
    count: number;
}

export interface LabelDistribution {
    label: string;
    count: number;
    pct: number;
}

export interface InsightsRiskAgent {
    id: string;
    name: string;
    desc: string;
    risk: 'critical' | 'high' | 'medium' | 'low';
    env: string;
    app: string | null;
    riskScore: number;
    trendDir: 'up' | 'down' | 'flat';
}

export interface InsightsQueueItem {
    id: string;
    agent: string;
    trigger: string;
    age: string;
    severity: string;
    status: string;
}

export interface InsightsGateItem {
    id: string;
    agent: string;
    gate: string;
    stage: string;
    env: string;
    days: number;
}

export interface InsightsSuccessMetric {
    id: string;
    agent: string;
    kpi: string;
    value: string;
    target: string;
    status: 'pass' | 'warn' | 'fail';
    trend: number[];
}

export interface InsightsProfileSection {
    label: string;
    pct: number;
    status: 'pass' | 'warn' | 'fail';
}

export interface InsightsProfileGap {
    id: string;
    gap: string;
    area: string;
    severity: string;
}

export interface InsightsProfileRefresh {
    id: string;
    section: string;
    lastRefresh: string;
    stale: boolean;
}

export interface InsightsCompanyProfile {
    hasActiveCompany: boolean;
    overallPct: number;
    sections: InsightsProfileSection[];
    gaps: InsightsProfileGap[];
    refreshes: InsightsProfileRefresh[];
}

export interface InsightsSummary {
    totals: InsightsTotals;
    agentLifecycle: StageCount[];
    useCaseLifecycle: StageCount[];
    providerDistribution: LabelDistribution[];
    blendedRiskDistribution: LabelDistribution[];
    autonomyDistribution: LabelDistribution[];
    productionRiskAgents: InsightsRiskAgent[];
    developmentRiskAgents: InsightsRiskAgent[];
    hitlEscalations: InsightsQueueItem[];
    stageGateBlockers: InsightsGateItem[];
    successMetrics: InsightsSuccessMetric[];
    companyProfile: InsightsCompanyProfile;
}

export const insightsApi = {
    async getSummary(companyId?: string): Promise<InsightsSummary> {
        const qs = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
        return req(`/insights/summary${qs}`);
    },
};
