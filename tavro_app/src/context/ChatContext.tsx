// ── src/context/ChatContext.tsx ───────────────────────────────────────────────
// Extended chat context with structured view data and blueprint support.

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

// ── View types ────────────────────────────────────────────────────────────────

export type ViewType =
  | 'agent_catalog'
  | 'agent_detail'
  | 'use_case_catalog'
  | 'use_case_detail'
  | 'blueprint'
  | 'settings'
  | 'home'
  | 'other';

// ── Structured context payloads ───────────────────────────────────────────────
// Each view type carries typed data so buildSystemPrompt() can use it cleanly.

export interface AgentDetailContext {
  agentId:     string;
  agentName:   string;
  description?: string;
  status?:     string;
  riskLevel?:  string;
  framework?:  string;
  [key: string]: any;   // allow extra fields from AgentData
}

export interface UseCaseDetailContext {
  useCaseId:   string;
  title:       string;
  description?: string;
  status?:     string;
  priority?:   string;
  linkedAgents?: string[];
  [key: string]: any;
}

export interface BlueprintContext {
  companyId:   string;
  companyName: string;
  industry:    string;
  region:      string;
  /** Summarised dimension nodes — label + category + 1-sentence summary */
  dimensions:  { label: string; category: string; summary?: string }[];
  /** Active node the user has selected in the explorer, if any */
  activeDimension?: { label: string; category: string; summary?: string };
}

export type ViewData =
  | AgentDetailContext
  | UseCaseDetailContext
  | BlueprintContext
  | null;

// ── Context value ─────────────────────────────────────────────────────────────

export interface ChatContextValue {
  viewType:        ViewType;
  viewData:        ViewData;
  /** Set the view context explicitly (used by page components) */
  setViewContext:  (type: ViewType, data?: ViewData) => void;
  /** Convenience: update only the blueprint context */
  setBlueprintContext: (ctx: BlueprintContext) => void;
  /** Convenience: update the active dimension within blueprint view */
  setActiveDimension:  (dim: { label: string; category: string; summary?: string } | undefined) => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

const ChatContext = createContext<ChatContextValue>({
  viewType:    'home',
  viewData:    null,
  setViewContext:     () => {},
  setBlueprintContext: () => {},
  setActiveDimension:  () => {},
});

// ── Route → ViewType mapping ──────────────────────────────────────────────────

function routeToViewType(pathname: string): ViewType {
  if (pathname.startsWith('/blueprint'))    return 'blueprint';
  if (pathname.startsWith('/agent/'))       return 'agent_detail';
  if (pathname.startsWith('/use-case/'))    return 'use_case_detail';
  if (pathname === '/catalog')              return 'agent_catalog';
  if (pathname === '/use-cases')            return 'use_case_catalog';
  if (pathname === '/settings')             return 'settings';
  if (pathname === '/')                     return 'home';
  return 'other';
}

// ── Provider ──────────────────────────────────────────────────────────────────

export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const location = useLocation();
  const [viewType, setViewType] = useState<ViewType>('home');
  const [viewData, setViewData] = useState<ViewData>(null);

  // Auto-update viewType when route changes.
  // viewData is cleared on route change — page components repopulate it.
  useEffect(() => {
    const derived = routeToViewType(location.pathname);
    setViewType(derived);
    // Only clear viewData if navigating away from the same type
    setViewData(prev => {
      if (derived === 'blueprint' && prev && 'companyId' in prev) return prev;
      return null;
    });
  }, [location.pathname]);

  const setViewContext = (type: ViewType, data: ViewData = null) => {
    setViewType(type);
    setViewData(data);
  };

  const setBlueprintContext = (ctx: BlueprintContext) => {
    setViewType('blueprint');
    setViewData(ctx);
  };

  const setActiveDimension = (dim: { label: string; category: string; summary?: string } | undefined) => {
    setViewData(prev => {
      if (prev && 'companyId' in prev) {
        return { ...prev, activeDimension: dim } as BlueprintContext;
      }
      return prev;
    });
  };

  return (
    <ChatContext.Provider value={{
      viewType, viewData,
      setViewContext, setBlueprintContext, setActiveDimension,
    }}>
      {children}
    </ChatContext.Provider>
  );
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export const useChatContext = () => useContext(ChatContext);
