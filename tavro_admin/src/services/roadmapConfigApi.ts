export interface PriorityWeights {
    BV:   number;
    TC:   number;
    RISK: number;
}

export interface RiskCategoryWeights {
    data_privacy:           number;
    operational:            number;
    compliance:             number;
    ai_behavioral:          number;
    strategic_reputational: number;
}

export type VisibilityLevel = 'public' | 'internal' | 'restricted' | 'confidential';

export interface RoadmapConfig {
    priorityWeights: PriorityWeights;
    riskWeights:     RiskCategoryWeights;
    defaultVisibility: VisibilityLevel;
    defaultSensitive:  boolean;
}

export const DEFAULT_CONFIG: RoadmapConfig = {
    priorityWeights: { BV: 0.55, TC: 0.20, RISK: 0.25 },
    riskWeights:     { data_privacy: 20, operational: 20, compliance: 20, ai_behavioral: 20, strategic_reputational: 20 },
    defaultVisibility: 'internal',
    defaultSensitive:  false,
};

function authHeaders(): Record<string, string> {
    const accessToken = localStorage.getItem('tavro_admin_access_token') ?? '';
    const tenantId = (() => {
        const stored = localStorage.getItem('tavro_admin_tenant_id');
        if (stored) return stored;
        try {
            const idToken = localStorage.getItem('tavro_admin_id_token');
            if (!idToken) return '';
            const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            const ro = payload['urn:zitadel:iam:user:resourceowner'];
            if (ro && typeof ro === 'object' && ro.id) return String(ro.id);
            return payload['urn:zitadel:iam:user:resourceowner:id'] || payload['urn:zitadel:iam:org:id'] || payload['org_id'] || '';
        } catch { return ''; }
    })();
    return {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(tenantId    ? { 'x-tenant-id': tenantId }               : {}),
    };
}

function normalize(data: any): RoadmapConfig {
    return {
        priorityWeights:   { ...DEFAULT_CONFIG.priorityWeights, ...data.priorityWeights },
        riskWeights:       { ...DEFAULT_CONFIG.riskWeights,     ...data.riskWeights },
        defaultVisibility: (data.defaultVisibility as VisibilityLevel) ?? DEFAULT_CONFIG.defaultVisibility,
        defaultSensitive:  typeof data.defaultSensitive === 'boolean' ? data.defaultSensitive : DEFAULT_CONFIG.defaultSensitive,
    };
}

export async function getRoadmapConfig(companyId: string): Promise<RoadmapConfig> {
    const res = await fetch(`/api/v1/admin/companies/${companyId}/preferences`, {
        headers: authHeaders(),
    });
    if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
    return normalize(await res.json());
}

export async function saveRoadmapConfig(companyId: string, cfg: RoadmapConfig): Promise<RoadmapConfig> {
    const res = await fetch(`/api/v1/admin/companies/${companyId}/preferences`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            priority_weights: cfg.priorityWeights,
            risk_weights: cfg.riskWeights,
            default_visibility: cfg.defaultVisibility,
            default_sensitive: cfg.defaultSensitive,
        }),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { detail?: string }).detail ?? 'Save failed');
    }
    return normalize(await res.json());
}

export function priorityWeightsSum(pw: PriorityWeights): number {
    return +(pw.BV + pw.TC + pw.RISK).toFixed(4);
}

export function riskWeightsSum(rw: RiskCategoryWeights): number {
    return (Object.values(rw) as number[]).reduce((a, b) => a + b, 0);
}
