import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AgentData } from '../types/agent';
import { mcpClient } from '../services/mcpClient';
import { hasResolvedAgentRisk } from '../utils/agentRisk';

const AGENT_CACHE_KEY = 'tavro_catalog_agents_cache';
const AGENT_CACHE_TS_KEY = 'tavro_catalog_agents_cache_ts';
const AGENT_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

interface CatalogState {
    agents: AgentData[];
    loading: boolean;
    error: string | null;
    lastFetched: Date | null;
    refresh: () => void;
    upsertAgent: (agent: AgentData) => void;
}

const CatalogContext = createContext<CatalogState>({
    agents: [],
    loading: false,
    error: null,
    lastFetched: null,
    refresh: () => { },
    upsertAgent: () => { },
});

const hasRiskClassification = (agent: AgentData): boolean => hasResolvedAgentRisk(agent);

const isPendingAssessment = (agent: AgentData): boolean => {
    const status = agent.identification?.governance_status ?? (agent as any).latest_event_status;
    return status === 'Risk Assessment is running' && !hasRiskClassification(agent);
};

const mergeAgent = (fresh: AgentData, previous: AgentData): AgentData => ({
    // Fresh catalog data is authoritative; previous state is fallback only.
    ...previous,
    ...fresh,
    // Prefer non-empty values — prevents stale catalog from overwriting a recent optimistic edit
    name: fresh.name || previous.name,
    description: fresh.description || previous.description,
    identification: {
        ...previous.identification,
        ...fresh.identification,
        // Keep governance_status from previous if fresh catalog doesn't carry it
        governance_status: fresh.identification?.governance_status ?? previous.identification?.governance_status,
    },
    risk_assessment: { ...previous.risk_assessment, ...fresh.risk_assessment },
});

const identityKey = (a: AgentData): string => (a.identification?.agent_id || a.name || '').toLowerCase();

const mapByIdentity = (list: AgentData[]): Map<string, AgentData> => {
    const map = new Map<string, AgentData>();
    for (const a of list) {
        const key = identityKey(a);
        if (key) map.set(key, a);
    }
    return map;
};

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

    const fetchingRef = useRef(false);

    const fetchAgents = useCallback(async (invalidate = false) => {
        if (fetchingRef.current && !invalidate) return;
        fetchingRef.current = true;
        setLoading(true);
        setError(null);

        if (invalidate) {
            mcpClient.invalidateCache();
        }

        try {
            const data = await mcpClient.getAllAgents();

            setAgents(prev => {
                const prevMap = mapByIdentity(prev);
                const merged = data.map(agent => {
                    const key = identityKey(agent);
                    const old = key ? prevMap.get(key) : undefined;
                    return old ? mergeAgent(agent, old) : agent;
                });

                const mergedMap = mapByIdentity(merged);
                const pendingCarryOver = prev.filter(a => {
                    const key = identityKey(a);
                    if (!key) return false;
                    if (mergedMap.has(key)) return false;
                    return isPendingAssessment(a);
                });

                const next = [...pendingCarryOver, ...merged];
                const now = Date.now();
                sessionStorage.setItem(AGENT_CACHE_KEY, JSON.stringify(next));
                sessionStorage.setItem(AGENT_CACHE_TS_KEY, String(now));
                setLastFetched(new Date(now));
                return next;
            });
        } catch (err: any) {
            setError(err.message ?? 'Failed to load agent catalog');
        } finally {
            setLoading(false);
            fetchingRef.current = false;
        }
    }, []);

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
                mcpClient.invalidateCache();
                const latestCatalog = await mcpClient.getAllAgents();
                const latestMap = mapByIdentity(latestCatalog);

                const remaining: string[] = [];
                const pendingMetaRaw = localStorage.getItem('tavro_pending_assessment_agent_meta');
                const pendingMeta = pendingMetaRaw ? JSON.parse(pendingMetaRaw) as Array<{ agent_id: string; name: string; description: string; created_at: string; }> : [];
                const remainingMeta: Array<{ agent_id: string; name: string; description: string; created_at: string; }> = [];

                for (const agentId of pending) {
                    const key = agentId.toLowerCase();
                    const agent = latestMap.get(key) || latestCatalog.find(a => identityKey(a) === key);
                    const done = Boolean(agent && hasRiskClassification(agent));
                    if (done) {
                        window.dispatchEvent(new CustomEvent('tavro_notice', {
                            detail: {
                                key: 'tavro_catalog_notice',
                                message: `Risk assessment completed for ${agent?.name || agentId}.`,
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
        return () => { if (timer) window.clearInterval(timer); };
    }, [fetchAgents]);

    const refresh = useCallback(() => fetchAgents(true), [fetchAgents]);

    const upsertAgent = useCallback((agent: AgentData) => {
        setAgents(prev => {
            const next = [...prev];
            const targetKey = identityKey(agent);
            const idx = next.findIndex(a => identityKey(a) === targetKey);
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

export function useCatalog(): CatalogState {
    return useContext(CatalogContext);
}

