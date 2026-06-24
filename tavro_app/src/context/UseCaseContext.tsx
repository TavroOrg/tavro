import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { UseCaseSummary } from '../types/useCase';
import { useCaseApi } from '../services/useCaseApi';
import { toUserMessage } from '../utils/errorUtils';

const USECASE_CACHE_KEY = 'tavro_catalog_usecases_cache_v2';
const USECASE_CACHE_TS_KEY = 'tavro_catalog_usecases_cache_ts_v2';
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
    const pendingInvalidateRef = useRef(false);
    // identifiers of optimistically added use cases not yet confirmed by server
    const pendingAddIds = useRef<Set<string>>(new Set());
    // identifier → lowercase name, for name-based dedup during carry-over
    const pendingAddNames = useRef<Map<string, string>>(new Map());
    // identifiers of optimistically deleted use cases
    const pendingDeleteIds = useRef<Set<string>>(new Set());

    const fetchUseCases = useCallback(async (invalidate = false) => {
        if (fetchingRef.current) {
            if (invalidate) pendingInvalidateRef.current = true;
            return;
        }

        const shouldInvalidate = invalidate || pendingInvalidateRef.current;
        pendingInvalidateRef.current = false;
        fetchingRef.current = true;
        setError(null);
        // Only block the UI if there is no data yet or the user explicitly synced.
        const hasExistingData = Boolean(sessionStorage.getItem(USECASE_CACHE_KEY));
        if (!hasExistingData || shouldInvalidate) setLoading(true);

        try {
            const PAGE_SIZE = 100;

            const normalizeItem = (item: any): UseCaseSummary => ({
                ...item,
                identifier: item.identifier ?? item.use_case_id ?? item.id,
                name: item.name ?? item.title ?? item.use_case_name,
                description: item.description ?? item.short_description ?? item.summary,
                status: item.status ?? item.state,
                owner: item.owner ?? item.use_case_owner,
                overall_risk: item.overall_risk ?? item.overall_risk_classification ?? item.risk_classification,
            });

            // Page 1: apply carry-over/delete merge and show data immediately.
            const firstResponse = await useCaseApi.listUseCases({ startRecord: 1, recordRange: `1-${PAGE_SIZE}` });
            const totalRecords = firstResponse.total_records ?? 0;
            const firstBatch = (firstResponse.data ?? []).map(normalizeItem);
            const firstIds = new Set(firstBatch.map((uc: UseCaseSummary) => uc.identifier));
            const firstNames = new Set(firstBatch.map((uc: UseCaseSummary) => (uc.name ?? '').toLowerCase().trim()));

            setUseCases(prev => {
                // Carry over optimistic additions not yet visible in fresh data.
                // Match by identifier OR by name so identifier-mismatch cases still deduplicate.
                const carryOver = prev.filter(uc => {
                    if (!pendingAddIds.current.has(uc.identifier)) return false;
                    const nameKey = (uc.name ?? '').toLowerCase().trim();
                    const confirmedById = firstIds.has(uc.identifier);
                    // Only confirm by name when the fresh item sharing that name has the same
                    // identifier (or no identifier) — prevents a pre-existing use case with the
                    // same name from falsely confirming a newly-created one.
                    const confirmedByName = nameKey !== '' && firstNames.has(nameKey) &&
                        !firstBatch.some((f: UseCaseSummary) =>
                            (f.name ?? '').toLowerCase().trim() === nameKey &&
                            f.identifier && f.identifier !== uc.identifier
                        );
                    if (confirmedById || confirmedByName) {
                        pendingAddIds.current.delete(uc.identifier);
                        pendingAddNames.current.delete(uc.identifier);
                        return false; // server has it — don't carry over, show server version
                    }
                    return true; // not indexed yet — keep the optimistic pill
                });

                // Filter out optimistic deletions still present in fresh data.
                const filtered = firstBatch.filter(
                    (uc: UseCaseSummary) => !pendingDeleteIds.current.has(uc.identifier)
                );
                // Clean up pending-delete entries once server stops returning them.
                for (const id of Array.from(pendingDeleteIds.current)) {
                    if (!firstIds.has(id)) pendingDeleteIds.current.delete(id);
                }

                const next = [...carryOver, ...filtered];
                // Don't stamp the cache timestamp yet — wait until all pages arrive.
                sessionStorage.setItem(USECASE_CACHE_KEY, JSON.stringify(next));
                return next;
            });
            setLoading(false); // Show page 1 immediately; remaining pages fill in silently.

            // Pages 2–N: fire all concurrently, append new use cases as each arrives.
            if (totalRecords > PAGE_SIZE) {
                const pageStarts: number[] = [];
                for (let start = PAGE_SIZE + 1; start <= totalRecords; start += PAGE_SIZE) {
                    pageStarts.push(start);
                }
                await Promise.all(pageStarts.map(async start => {
                    const end = Math.min(start + PAGE_SIZE - 1, totalRecords);
                    try {
                        const resp = await useCaseApi.listUseCases({ startRecord: start, recordRange: `${start}-${end}` });
                        const batch = (resp.data ?? []).map(normalizeItem);
                        setUseCases(prev => {
                            const prevIds = new Set(prev.map((uc: UseCaseSummary) => uc.identifier));
                            const fresh = batch.filter(
                                (uc: UseCaseSummary) =>
                                    !prevIds.has(uc.identifier) &&
                                    !pendingDeleteIds.current.has(uc.identifier)
                            );
                            if (!fresh.length) return prev;
                            const next = [...prev, ...fresh];
                            sessionStorage.setItem(USECASE_CACHE_KEY, JSON.stringify(next));
                            return next;
                        });
                    } catch {
                        // Silently skip a failed page.
                    }
                }));
            }

            // All pages done — stamp cache as fully valid.
            const now = Date.now();
            sessionStorage.setItem(USECASE_CACHE_TS_KEY, String(now));
            setLastFetched(new Date(now));
        } catch (err: any) {
            setError(toUserMessage(err));
        } finally {
            setLoading(false);
            fetchingRef.current = false;
            if (pendingInvalidateRef.current) {
                pendingInvalidateRef.current = false;
                fetchUseCases(true);
            }
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

    useEffect(() => {
        const handler = () => fetchUseCases(true);
        window.addEventListener('tavro:usecase-updated', handler);
        return () => window.removeEventListener('tavro:usecase-updated', handler);
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
