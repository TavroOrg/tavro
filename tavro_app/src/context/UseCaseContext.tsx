import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { UseCaseSummary } from '../types/useCase';
import { mcpClient } from '../services/mcpClient';

const USECASE_CACHE_KEY = 'tavro_catalog_usecases_cache';
const USECASE_CACHE_TS_KEY = 'tavro_catalog_usecases_cache_ts';
const USECASE_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

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
    const [useCases, setUseCases] = useState<UseCaseSummary[]>(() => {
        try {
            const raw = sessionStorage.getItem(USECASE_CACHE_KEY);
            return raw ? JSON.parse(raw) as UseCaseSummary[] : [];
        } catch {
            return [];
        }
    });
    const [loading, setLoading] = useState(useCases.length === 0);
    const [error, setError] = useState<string | null>(null);
    const [lastFetched, setLastFetched] = useState<Date | null>(() => {
        const ts = sessionStorage.getItem(USECASE_CACHE_TS_KEY);
        if (!ts) return null;
        const num = Number(ts);
        return Number.isFinite(num) ? new Date(num) : null;
    });

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
            const now = Date.now();
            setLastFetched(new Date(now));
            sessionStorage.setItem(USECASE_CACHE_KEY, JSON.stringify(data));
            sessionStorage.setItem(USECASE_CACHE_TS_KEY, String(now));
        } catch (err: any) {
            setError(err.message ?? 'Failed to load AI Use Case catalog');
        } finally {
            setLoading(false);
            fetchingRef.current = false;
        }
    }, []);

    useEffect(() => {
        const ts = sessionStorage.getItem(USECASE_CACHE_TS_KEY);
        const ageMs = ts ? Date.now() - Number(ts) : Number.POSITIVE_INFINITY;
        const shouldInvalidate = ageMs > USECASE_CACHE_MAX_AGE_MS;
        fetchUseCases(shouldInvalidate);
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
