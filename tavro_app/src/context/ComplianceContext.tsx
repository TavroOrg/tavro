// ── src/context/ComplianceContext.tsx ────────────────────────────────────────

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { complianceApi } from '../services/complianceApi';
import type { ComplianceItem, ComplianceDimType } from '../types/compliance';
import { useBlueprint } from './BlueprintContext';

interface ComplianceState {
  items:       ComplianceItem[];
  dimTypes:    ComplianceDimType[];
  loading:     boolean;
  error:       string | null;
  lastFetched: Date | null;
  refresh:     () => void;
}

const ComplianceContext = createContext<ComplianceState>({
  items: [], dimTypes: [], loading: false, error: null, lastFetched: null, refresh: () => {},
});

export const ComplianceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeCompany } = useBlueprint();
  const [items,       setItems]       = useState<ComplianceItem[]>([]);
  const [dimTypes,    setDimTypes]    = useState<ComplianceDimType[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [page, types] = await Promise.all([
        complianceApi.listItems({
          company_id: activeCompany?.id,
          limit:      200,
        }),
        complianceApi.listDimTypes(),
      ]);
      setItems(page.items);
      setDimTypes(types);
      setLastFetched(new Date());
    } catch (err: any) {
      setError(err.message ?? 'Failed to load compliance data');
    } finally {
      setLoading(false);
    }
  }, [activeCompany?.id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return (
    <ComplianceContext.Provider value={{ items, dimTypes, loading, error, lastFetched, refresh: fetchAll }}>
      {children}
    </ComplianceContext.Provider>
  );
};

export function useCompliance() {
  return useContext(ComplianceContext);
}
