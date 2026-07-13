// ── src/context/LookupContext.tsx ────────────────────────────────────────────
// Fetches every active public.lookup row for the current tenant ONCE (on
// portal load / company switch) and caches it in memory for the session.
// Any form field that needs a picklist (status today, others later) reads
// from this cache via useLookupValues() instead of making its own API call.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { lookupApi, LookupValue, LookupValueWithField } from '../services/lookupApi';
import { useBlueprint } from './BlueprintContext';

interface LookupState {
    loading: boolean;
    error: string | null;
    /** Get the cached options for a given (table_name, column_name) field. */
    getValues: (tableName: string, columnName: string) => LookupValue[];
    /** Re-fetch everything (e.g. after an admin edits lookup values). */
    refresh: () => void;
}

const LookupContext = createContext<LookupState>({
    loading: false,
    error: null,
    getValues: () => [],
    refresh: () => {},
});

function groupByField(rows: LookupValueWithField[]): Map<string, LookupValue[]> {
    const map = new Map<string, LookupValue[]>();
    for (const { table_name, column_name, ...value } of rows) {
        const key = `${table_name}::${column_name}`;
        const list = map.get(key) ?? [];
        list.push(value);
        map.set(key, list);
    }
    return map;
}

export const LookupProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { activeCompany } = useBlueprint();
    const [grouped, setGrouped] = useState<Map<string, LookupValue[]>>(new Map());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(() => {
        setLoading(true);
        setError(null);
        lookupApi.listAll(activeCompany?.id)
            .then(rows => setGrouped(groupByField(rows)))
            .catch(err => setError(err instanceof Error ? err.message : String(err)))
            .finally(() => setLoading(false));
    }, [activeCompany?.id]);

    useEffect(() => { load(); }, [load]);

    const getValues = useCallback(
        (tableName: string, columnName: string) => grouped.get(`${tableName}::${columnName}`) ?? [],
        [grouped],
    );

    const value = useMemo<LookupState>(
        () => ({ loading, error, getValues, refresh: load }),
        [loading, error, getValues, load],
    );

    return <LookupContext.Provider value={value}>{children}</LookupContext.Provider>;
};

export const useLookup = () => useContext(LookupContext);

/** Convenience hook for a single field's options, e.g. useLookupValues('ai_use_cases', 'status'). */
export function useLookupValues(tableName: string, columnName: string): LookupValue[] {
    const { getValues } = useLookup();
    return getValues(tableName, columnName);
}
