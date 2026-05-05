import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { UseCaseSummary } from '../types/useCase';
import { mcpClient } from '../services/mcpClient';

// ── Types ────────────────────────────────────────────────────────────────────

interface UseCaseState {
    /** Full use case list, populated after the first successful fetch. */
    useCases: UseCaseSummary[];
    loading: boolean;
    error: string | null;
    lastFetched: Date | null;
    refresh: () => void;
}

// ── Context ──────────────────────────────────────────────────────────────────

const UseCaseContext = createContext<UseCaseState>({
    useCases: [],
    loading: false,
    error: null,
    lastFetched: null,
    refresh: () => { },
});

// ── Provider ─────────────────────────────────────────────────────────────────

export const UseCaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [useCases, setUseCases] = useState<UseCaseSummary[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastFetched, setLastFetched] = useState<Date | null>(null);

    const fetchingRef = useRef(false);

    const fetchUseCases = useCallback(async (invalidate = false) => {
        if (fetchingRef.current) return;
        fetchingRef.current = true;
        setLoading(true);
        setError(null);
        if (invalidate) {
            mcpClient.invalidateCache();
        }
        try {
            const data = await mcpClient.getAllUseCases();
            setUseCases(data);
            setLastFetched(new Date());
        } catch (err: any) {
            setError(err.message ?? 'Failed to load AI Use Case catalog');
        } finally {
            setLoading(false);
            fetchingRef.current = false;
        }
    }, []);

    useEffect(() => {
        fetchUseCases(false);
    }, [fetchUseCases]);

    const refresh = useCallback(() => fetchUseCases(true), [fetchUseCases]);

    return (
        <UseCaseContext.Provider value={{ useCases, loading, error, lastFetched, refresh }}>
            {children}
        </UseCaseContext.Provider>
    );
};

// ── Hook ─────────────────────────────────────────────────────────────────────

/** Access the shared, cached AI Use Case catalog from any component. */
export function useUseCases(): UseCaseState {
    return useContext(UseCaseContext);
}
