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
}

// ── Context ──────────────────────────────────────────────────────────────────

const CatalogContext = createContext<CatalogState>({
    agents: [],
    loading: false,
    error: null,
    lastFetched: null,
    refresh: () => { },
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

    const refresh = useCallback(() => fetchAgents(true), [fetchAgents]);

    return (
        <CatalogContext.Provider value={{ agents, loading, error, lastFetched, refresh }}>
            {children}
        </CatalogContext.Provider>
    );
};

// ── Hook ─────────────────────────────────────────────────────────────────────

/** Access the shared, cached agent catalog from any component. */
export function useCatalog(): CatalogState {
    return useContext(CatalogContext);
}
