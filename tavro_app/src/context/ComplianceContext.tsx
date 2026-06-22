import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

interface ComplianceContextValue {
  items: any[];
  dimTypes: any[];
  loading: boolean;
  error: string | null;
  lastFetched: Date | null;
  refresh: () => void;
}

const ComplianceContext = createContext<ComplianceContextValue>({
  items: [], dimTypes: [], loading: false, error: null, lastFetched: null, refresh: () => {},
});

export function ComplianceProvider({ children }: { children: ReactNode }) {
  return (
    <ComplianceContext.Provider value={{ items: [], dimTypes: [], loading: false, error: null, lastFetched: null, refresh: () => {} }}>
      {children}
    </ComplianceContext.Provider>
  );
}

export function useCompliance() {
  return useContext(ComplianceContext);
}
