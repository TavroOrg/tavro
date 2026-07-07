const STORAGE_KEY = 'tavro_roadmap_config';

/** Fired whenever the cached roadmap config changes, so already-mounted
 * components (which read it once via readRoadmapConfig()) can refresh. */
export const ROADMAP_CONFIG_UPDATED_EVENT = 'tavro:roadmap_config_updated';

export interface PriorityWeights {
    BV:   number;   // Business Value   (spec default 0.55)
    TC:   number;   // Tech Complexity  (spec default 0.20, applied as (6−TC)×TC)
    RISK: number;   // Risk             (spec default 0.25, subtracted)
}

export interface RiskCategoryWeights {
    data_privacy:           number;   // default 20
    operational:            number;   // default 20
    compliance:             number;   // default 20
    ai_behavioral:          number;   // default 20
    strategic_reputational: number;   // default 20
}

export interface RoadmapConfig {
    priorityWeights: PriorityWeights;
    riskWeights:     RiskCategoryWeights;
}

export const DEFAULT_CONFIG: RoadmapConfig = {
    priorityWeights: { BV: 0.55, TC: 0.20, RISK: 0.25 },
    riskWeights:     { data_privacy: 20, operational: 20, compliance: 20, ai_behavioral: 20, strategic_reputational: 20 },
};

export function readRoadmapConfig(): RoadmapConfig {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_CONFIG;
        const parsed = JSON.parse(raw);
        return {
            priorityWeights: { ...DEFAULT_CONFIG.priorityWeights, ...parsed.priorityWeights },
            riskWeights:     { ...DEFAULT_CONFIG.riskWeights,     ...parsed.riskWeights },
        };
    } catch {
        return DEFAULT_CONFIG;
    }
}

export function saveRoadmapConfig(cfg: RoadmapConfig): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch {}
    try { window.dispatchEvent(new CustomEvent(ROADMAP_CONFIG_UPDATED_EVENT, { detail: cfg })); } catch {}
}

/**
 * Pulls the company's admin-configured roadmap weights from the backend and
 * refreshes the local cache that readRoadmapConfig() reads from. Falls back
 * to whatever is already cached (or defaults) if the fetch fails — weights
 * are company-wide now, set only by admins in the Admin Portal.
 */
export async function syncRoadmapConfigFromServer(companyId: string): Promise<RoadmapConfig> {
    if (!companyId) return readRoadmapConfig();
    try {
        const { getValidToken } = await import('./auth');
        const token = await getValidToken();
        const tenantId = localStorage.getItem('tavro_tenant_id') ?? undefined;
        const base = (import.meta as any).env?.VITE_TWIN_API_URL ?? '';
        const res = await fetch(`${base}/api/v1/companies/${companyId}/roadmap-config`, {
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
            },
        });
        if (!res.ok) return readRoadmapConfig();
        const data = await res.json();
        const cfg: RoadmapConfig = {
            priorityWeights: { ...DEFAULT_CONFIG.priorityWeights, ...data.priorityWeights },
            riskWeights:     { ...DEFAULT_CONFIG.riskWeights,     ...data.riskWeights },
        };
        saveRoadmapConfig(cfg);
        return cfg;
    } catch {
        return readRoadmapConfig();
    }
}

export function priorityWeightsSum(pw: PriorityWeights): number {
    return +(pw.BV + pw.TC + pw.RISK).toFixed(4);
}

export function riskWeightsSum(rw: RiskCategoryWeights): number {
    return (Object.values(rw) as number[]).reduce((a, b) => a + b, 0);
}
