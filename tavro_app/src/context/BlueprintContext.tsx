// ── src/context/BlueprintContext.tsx ─────────────────────────────────────────
// Mirrors CatalogContext pattern: singleton fetch, loading/error state,
// refresh(), and a hook for consumer components.

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { blueprintApi } from '../services/blueprintApi';
import type { Company, DimType, DimNode, GraphData } from '../types/blueprint';

// ── State shape ───────────────────────────────────────────────────────────────

interface BlueprintState {
  /** All companies the user has access to. */
  companies: Company[];
  /** Currently selected company (persisted in localStorage). */
  activeCompany: Company | null;
  /** Dimension type registry — loaded once. */
  dimTypes: DimType[];
  /** Active nodes for the selected company. */
  nodes: DimNode[];
  /** Full graph data for the graph visualiser. */
  graph: GraphData | null;
  loading: boolean;
  graphLoading: boolean;
  error: string | null;
  lastFetched: Date | null;
  /** Switch the active company and reload nodes + graph. */
  selectCompany: (company: Company) => void;
  /** Remove a company from the list and clear state if it was active. */
  removeCompany: (id: string) => void;
  /** Hard refresh — invalidates nodes, graph, and companies. */
  refresh: () => void;
  /** Reload just the graph (e.g. after adding an edge). */
  refreshGraph: () => void;
  /** Reload just the nodes (e.g. after editing a node). */
  refreshNodes: () => void;
  /** Reload just the companies list (e.g. after creating a company). */
  refreshCompanies: () => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

const BlueprintContext = createContext<BlueprintState>({
  companies: [], activeCompany: null, dimTypes: [], nodes: [], graph: null,
  loading: false, graphLoading: false, error: null, lastFetched: null,
  selectCompany: () => {}, removeCompany: () => {}, refresh: () => {}, refreshGraph: () => {}, refreshNodes: () => {}, refreshCompanies: () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'tavro_active_company_id';

export const BlueprintProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [companies,     setCompanies]     = useState<Company[]>([]);
  const [activeCompany, setActiveCompany] = useState<Company | null>(null);
  const [dimTypes,      setDimTypes]      = useState<DimType[]>([]);
  const [nodes,         setNodes]         = useState<DimNode[]>([]);
  const [graph,         setGraph]         = useState<GraphData | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [graphLoading,  setGraphLoading]  = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [lastFetched,   setLastFetched]   = useState<Date | null>(null);

  const fetchingRef = useRef(false);

  // ── Fetch companies list ─────────────────────────────────────────────────
  const fetchCompanies = useCallback(async () => {
    try {
      const companiesPage = await blueprintApi.listCompanies();
      setCompanies(companiesPage.items);
      setError(null);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load companies');
    }
  }, []);

  // ── Load companies + dim types once ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [companiesPage, types] = await Promise.all([
          blueprintApi.listCompanies(),
          blueprintApi.listDimTypes(),
        ]);
        setCompanies(companiesPage.items);
        setDimTypes(types);

        // Restore last-selected company from localStorage
        const savedId = localStorage.getItem(STORAGE_KEY);
        const saved = companiesPage.items.find(c => c.id === savedId) ?? companiesPage.items[0] ?? null;
        if (saved) setActiveCompany(saved);
      } catch (err: any) {
        setError(err.message ?? 'Failed to load blueprint data');
      }
    })();
  }, []);

  // ── Fetch nodes for the active company ───────────────────────────────────
  const fetchNodes = useCallback(async (company: Company) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const page = await blueprintApi.listNodes({ company_id: company.id, limit: 500 });
      setNodes(page.items);
      setLastFetched(new Date());
    } catch (err: any) {
      setError(err.message ?? 'Failed to load dimensions');
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  // ── Fetch graph for the active company ───────────────────────────────────
  const fetchGraph = useCallback(async (company: Company) => {
    setGraphLoading(true);
    try {
      const g = await blueprintApi.getCompanyGraph(company.id);
      setGraph(g);
    } catch (err: any) {
      // Graph errors are non-fatal — nodes list still works
      console.warn('[Blueprint] Graph fetch failed:', err.message);
    } finally {
      setGraphLoading(false);
    }
  }, []);

  // Re-fetch whenever active company changes
  useEffect(() => {
    if (!activeCompany) return;
    localStorage.setItem(STORAGE_KEY, activeCompany.id);
    fetchNodes(activeCompany);
    fetchGraph(activeCompany);
  }, [activeCompany, fetchNodes, fetchGraph]);

  const selectCompany = useCallback((company: Company) => {
    setActiveCompany(company);
  }, []);

  const removeCompany = useCallback((id: string) => {
    setCompanies(prev => prev.filter(c => c.id !== id));
    setActiveCompany(curr => {
      if (curr?.id !== id) return curr;
      localStorage.removeItem(STORAGE_KEY);
      return null;
    });
    setNodes([]);
    setGraph(null);
  }, []);

  const refresh = useCallback(() => {
    fetchCompanies();
    if (activeCompany) {
      fetchNodes(activeCompany);
      fetchGraph(activeCompany);
    }
  }, [activeCompany, fetchNodes, fetchGraph, fetchCompanies]);

  const refreshGraph = useCallback(() => {
    if (activeCompany) fetchGraph(activeCompany);
  }, [activeCompany, fetchGraph]);

  const refreshNodes = useCallback(() => {
    if (activeCompany) fetchNodes(activeCompany);
  }, [activeCompany, fetchNodes]);

  return (
    <BlueprintContext.Provider value={{
      companies, activeCompany, dimTypes, nodes, graph,
      loading, graphLoading, error, lastFetched,
      selectCompany, removeCompany, refresh, refreshGraph, refreshNodes, refreshCompanies: fetchCompanies,
    }}>
      {children}
    </BlueprintContext.Provider>
  );
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBlueprint(): BlueprintState {
  return useContext(BlueprintContext);
}
