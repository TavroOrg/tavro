const STORAGE_KEY = 'tavro_roadmap_config';

export interface PriorityWeights {
    BV:   number;   // Business Value   (spec default 0.40)
    DR:   number;   // Data Readiness   (spec default 0.25)
    TC:   number;   // Tech Complexity  (spec default 0.15, applied as (6−TC)×TC)
    RISK: number;   // Risk             (spec default 0.20, subtracted)
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
    priorityWeights: { BV: 0.40, DR: 0.25, TC: 0.15, RISK: 0.20 },
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
}

export function priorityWeightsSum(pw: PriorityWeights): number {
    return +(pw.BV + pw.DR + pw.TC + pw.RISK).toFixed(4);
}

export function riskWeightsSum(rw: RiskCategoryWeights): number {
    return (Object.values(rw) as number[]).reduce((a, b) => a + b, 0);
}
