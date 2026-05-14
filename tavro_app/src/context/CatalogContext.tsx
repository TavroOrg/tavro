import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AgentData } from '../types/agent';
import { mcpClient } from '../services/mcpClient';

const AGENT_CACHE_KEY = 'tavro_catalog_agents_cache';
const AGENT_CACHE_TS_KEY = 'tavro_catalog_agents_cache_ts';
const AGENT_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

const extractRiskClassificationFromSummary = (summary: any): string | null => {
    if (!summary) return null;
    const text = String(summary?.risk_summary ?? summary?.summary ?? '');
    if (!text) return null;
    const clean = text.replace(/<[^>]*>/g, ' ');
    const match = clean.match(/Risk Classification\s*:\s*(Prohibited|High Risk|Other)/i);
    return match?.[1] ?? null;
};

const mergeAgentData = (base: AgentData, details?: AgentData, riskSummary?: any): AgentData => {
    const summaryRiskClass = extractRiskClassificationFromSummary(riskSummary);
    if (!details && !summaryRiskClass) return base;
    const mergedDetails = details ?? base;
    return {
        ...base,
        ...mergedDetails,
        description: mergedDetails.description || base.description,
        identification: { ...base.identification, ...(mergedDetails as AgentData).identification },
        risk_assessment: {
            ...base.risk_assessment,
            ...(mergedDetails as AgentData).risk_assessment,
            ...(summaryRiskClass ? { blended_risk_classification: summaryRiskClass } : {}),
        },
    } as AgentData;
};

// ── Types ────────────────────────────────────────────────────────────────────

interface CatalogState {
    /** Full agent list, populated after the first successful fetch. */
    agents: AgentData[];
    loading: boolean;
    error: string | null;
    /** Timestamp of the last successful fetch, or null if never fetched. */
    lastFetched: Date | null;
    /** Invalidates the cache and re-fetches the entire catalog. */
    refresh: () => void;
    /** Inserts or updates an agent locally so UI can reflect changes immediately. */
    upsertAgent: (agent: AgentData) => void;
}

// ── Context ──────────────────────────────────────────────────────────────────

const CatalogContext = createContext<CatalogState>({
    agents: [],
    loading: false,
    error: null,
    lastFetched: null,
    refresh: () => { },
    upsertAgent: () => { },
});

// ── Provider ─────────────────────────────────────────────────────────────────

export const CatalogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [agents, setAgents] = useState<AgentData[]>(() => {
        try {
            const raw = sessionStorage.getItem(AGENT_CACHE_KEY);
            return raw ? JSON.parse(raw) as AgentData[] : [];
        } catch {
            return [];
        }
    });
    const [loading, setLoading] = useState(agents.length === 0);
    const [error, setError] = useState<string | null>(null);
    const [lastFetched, setLastFetched] = useState<Date | null>(() => {
        const ts = sessionStorage.getItem(AGENT_CACHE_TS_KEY);
        if (!ts) return null;
        const num = Number(ts);
        return Number.isFinite(num) ? new Date(num) : null;
    });

    // Prevent a concurrent refresh from spawning a second fetch.
    const fetchingRef = useRef(false);

    const fetchAgents = useCallback(async (invalidate = false) => {
        if (fetchingRef.current) return;
        fetchingRef.current = true;
        setLoading(true);
        setError(null);
        if (invalidate) {
            mcpClient.invalidateCache();
        }
        try {
            const data = await mcpClient.getAllAgents();
            const enriched = await Promise.all(
                data.map(async (agent) => {
                    const agentId = agent.identification?.agent_id || agent.name;
                    if (!agentId) return agent;
                    try {
                        const [details, riskSummary] = await Promise.all([
                            mcpClient.getAgentDetails(agentId),
                            mcpClient.getAgentRiskSummary(agentId),
                        ]);
                        return mergeAgentData(agent, details, riskSummary);
                    } catch {
                        return agent;
                    }
                })
            );
            setAgents(enriched);
            const now = Date.now();
            setLastFetched(new Date(now));
            sessionStorage.setItem(AGENT_CACHE_KEY, JSON.stringify(enriched));
            sessionStorage.setItem(AGENT_CACHE_TS_KEY, String(now));
        } catch (err: any) {
            setError(err.message ?? 'Failed to load agent catalog');
        } finally {
            setLoading(false);
            fetchingRef.current = false;
        }
    }, []);

    // Initial load — runs once after the component mounts.
    useEffect(() => {
        const ts = sessionStorage.getItem(AGENT_CACHE_TS_KEY);
        const ageMs = ts ? Date.now() - Number(ts) : Number.POSITIVE_INFINITY;
        const shouldInvalidate = ageMs > AGENT_CACHE_MAX_AGE_MS;
        fetchAgents(shouldInvalidate);
    }, [fetchAgents]);

    useEffect(() => {
        let timer: number | null = null;
        let running = false;

        const pollPendingAssessments = async () => {
            if (running) return;
            const raw = localStorage.getItem('tavro_pending_assessment_agents');
            const pending = raw ? JSON.parse(raw) as string[] : [];
            if (!pending.length) return;
            running = true;
            try {
                const remaining: string[] = [];
                const pendingMetaRaw = localStorage.getItem('tavro_pending_assessment_agent_meta');
                const pendingMeta = pendingMetaRaw ? JSON.parse(pendingMetaRaw) as Array<{ agent_id: string; name: string; description: string; created_at: string; }> : [];
                const remainingMeta: Array<{ agent_id: string; name: string; description: string; created_at: string; }> = [];

                for (const agentId of pending) {
                    const details = await mcpClient.getAgentDetails(agentId);
                    let done = Boolean(details?.risk_assessment?.blended_risk_classification || details?.risk_assessment?.identifier);
                    if (!done) {
                        const summary = await mcpClient.getAgentRiskSummary(agentId);
                        done = Boolean(
                            summary?.risk_summary ||
                            summary?.blended_risk_classification ||
                            summary?.aivss_score
                        );
                    }
                    if (done) {
                        window.dispatchEvent(new CustomEvent('tavro_notice', {
                            detail: {
                                key: 'tavro_catalog_notice',
                                message: `Risk assessment completed for ${details?.name || agentId}.`,
                            },
                        }));
                    } else {
                        remaining.push(agentId);
                        const meta = pendingMeta.find(item => item.agent_id === agentId);
                        if (meta) remainingMeta.push(meta);
                    }
                }

                localStorage.setItem('tavro_pending_assessment_agents', JSON.stringify(remaining));
                localStorage.setItem('tavro_pending_assessment_agent_meta', JSON.stringify(remainingMeta));
                await fetchAgents(true);
            } catch {
                // Retry on next interval.
            } finally {
                running = false;
            }
        };

        pollPendingAssessments();
        timer = window.setInterval(pollPendingAssessments, 10000);
        return () => {
            if (timer) window.clearInterval(timer);
        };
    }, [fetchAgents]);

    const refresh = useCallback(() => fetchAgents(true), [fetchAgents]);
    const upsertAgent = useCallback((agent: AgentData) => {
        setAgents(prev => {
            const next = [...prev];
            const targetId = agent.identification?.agent_id?.toLowerCase();
            const targetName = agent.name?.toLowerCase();
            const idx = next.findIndex(a => {
                const id = a.identification?.agent_id?.toLowerCase();
                const name = a.name?.toLowerCase();
                return (targetId && id === targetId) || (targetName && name === targetName);
            });
            if (idx >= 0) next[idx] = { ...next[idx], ...agent };
            else next.unshift(agent);
            const now = Date.now();
            sessionStorage.setItem(AGENT_CACHE_KEY, JSON.stringify(next));
            sessionStorage.setItem(AGENT_CACHE_TS_KEY, String(now));
            setLastFetched(new Date(now));
            return next;
        });
    }, []);

    return (
        <CatalogContext.Provider value={{ agents, loading, error, lastFetched, refresh, upsertAgent }}>
            {children}
        </CatalogContext.Provider>
    );
};

// ── Hook ─────────────────────────────────────────────────────────────────────

/** Access the shared, cached agent catalog from any component. */
export function useCatalog(): CatalogState {
    return useContext(CatalogContext);
}
