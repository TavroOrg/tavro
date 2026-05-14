import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AgentData } from '../types/agent';
import { mcpClient } from '../services/mcpClient';

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
    const [agents, setAgents] = useState<AgentData[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastFetched, setLastFetched] = useState<Date | null>(null);

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
            setAgents(data);
            setLastFetched(new Date());
        } catch (err: any) {
            setError(err.message ?? 'Failed to load agent catalog');
        } finally {
            setLoading(false);
            fetchingRef.current = false;
        }
    }, []);

    // Initial load — runs once after the component mounts.
    useEffect(() => {
        fetchAgents(false);
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
