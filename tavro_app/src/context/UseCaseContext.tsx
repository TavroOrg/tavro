import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { UseCaseSummary } from '../types/useCase';
import { mcpClient } from '../services/mcpClient';

const USECASE_CACHE_KEY = 'tavro_catalog_usecases_cache';
const USECASE_CACHE_TS_KEY = 'tavro_catalog_usecases_cache_ts';
const USECASE_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

interface UseCaseState {
    useCases: UseCaseSummary[];
    loading: boolean;
    error: string | null;
    lastFetched: Date | null;
    refresh: () => void;
    upsertUseCase: (uc: UseCaseSummary) => void;
    removeUseCase: (identifier: string) => void;
}

const UseCaseContext = createContext<UseCaseState>({
    useCases: [],
    loading: false,
    error: null,
    lastFetched: null,
    refresh: () => { },
    upsertUseCase: () => { },
    removeUseCase: () => { },
});

export const UseCaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [useCases, setUseCases] = useState<UseCaseSummary[]>(() => {
        try {
            const raw = sessionStorage.getItem(USECASE_CACHE_KEY);
            return raw ? JSON.parse(raw) as UseCaseSummary[] : [];
        } catch { return []; }
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
    // identifiers of optimistically added use cases not yet confirmed by server
    const pendingAddIds = useRef<Set<string>>(new Set());
    // identifier → lowercase name, for name-based dedup during carry-over
    const pendingAddNames = useRef<Map<string, string>>(new Map());
    // identifiers of optimistically deleted use cases
    const pendingDeleteIds = useRef<Set<string>>(new Set());

    const fetchUseCases = useCallback(async (invalidate = false) => {
        if (fetchingRef.current && !invalidate) return;
        fetchingRef.current = true;
        setError(null);
        // Only block the UI if there is no data yet or the user explicitly synced.
        const hasExistingData = Boolean(sessionStorage.getItem(USECASE_CACHE_KEY));
        if (!hasExistingData || invalidate) setLoading(true);
        if (invalidate) mcpClient.invalidateCache();

        try {
            const fresh = await mcpClient.getAllUseCases();
            const freshIds = new Set(fresh.map((uc: UseCaseSummary) => uc.identifier));
            const freshNames = new Set(
                fresh.map((uc: UseCaseSummary) => (uc.name ?? '').toLowerCase().trim())
            );

            setUseCases(prev => {
                // Carry over optimistic additions not yet visible in fresh data.
                // Match by identifier OR by name so identifier-mismatch cases still deduplicate.
                const carryOver = prev.filter(uc => {
                    if (!pendingAddIds.current.has(uc.identifier)) return false;
                    const nameKey = (uc.name ?? '').toLowerCase().trim();
                    const confirmedById = freshIds.has(uc.identifier);
                    const confirmedByName = nameKey !== '' && freshNames.has(nameKey);
                    if (confirmedById || confirmedByName) {
                        pendingAddIds.current.delete(uc.identifier);
                        pendingAddNames.current.delete(uc.identifier);
                        return false; // server has it — don't carry over, show server version
                    }
                    return true; // not indexed yet — keep the optimistic pill
                });

                // Filter out optimistic deletions still present in fresh data.
                const filtered = fresh.filter(
                    (uc: UseCaseSummary) => !pendingDeleteIds.current.has(uc.identifier)
                );
                // Clean up pending-delete entries once server stops returning them.
                for (const id of Array.from(pendingDeleteIds.current)) {
                    if (!freshIds.has(id)) pendingDeleteIds.current.delete(id);
                }

                const next = [...carryOver, ...filtered];
                const now = Date.now();
                sessionStorage.setItem(USECASE_CACHE_KEY, JSON.stringify(next));
                sessionStorage.setItem(USECASE_CACHE_TS_KEY, String(now));
                setLastFetched(new Date(now));
                return next;
            });
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
        fetchUseCases(ageMs > USECASE_CACHE_MAX_AGE_MS);
    }, [fetchUseCases]);

    useEffect(() => {
        const handler = () => fetchUseCases(true);
        window.addEventListener('tavro:usecase-created', handler);
        return () => window.removeEventListener('tavro:usecase-created', handler);
    }, [fetchUseCases]);

    const refresh = useCallback(() => fetchUseCases(true), [fetchUseCases]);

    const upsertUseCase = useCallback((uc: UseCaseSummary) => {
        pendingAddIds.current.add(uc.identifier);
        pendingAddNames.current.set(uc.identifier, (uc.name ?? '').toLowerCase().trim());
        pendingDeleteIds.current.delete(uc.identifier);
        setUseCases(prev => {
            const idx = prev.findIndex(u => u.identifier === uc.identifier);
            const next = idx >= 0
                ? prev.map((u, i) => (i === idx ? { ...u, ...uc } : u))
                : [uc, ...prev];
            sessionStorage.setItem(USECASE_CACHE_KEY, JSON.stringify(next));
            sessionStorage.setItem(USECASE_CACHE_TS_KEY, String(Date.now()));
            return next;
        });
    }, []);

    const removeUseCase = useCallback((identifier: string) => {
        pendingDeleteIds.current.add(identifier);
        pendingAddIds.current.delete(identifier);
        pendingAddNames.current.delete(identifier);
        setUseCases(prev => {
            const next = prev.filter(u => u.identifier !== identifier);
            sessionStorage.setItem(USECASE_CACHE_KEY, JSON.stringify(next));
            sessionStorage.setItem(USECASE_CACHE_TS_KEY, String(Date.now()));
            return next;
        });
    }, []);

    return (
        <UseCaseContext.Provider value={{ useCases, loading, error, lastFetched, refresh, upsertUseCase, removeUseCase }}>
            {children}
        </UseCaseContext.Provider>
    );
};

export function useUseCases(): UseCaseState {
    return useContext(UseCaseContext);
}
