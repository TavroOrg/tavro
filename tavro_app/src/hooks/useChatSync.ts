// ── src/hooks/useChatSync.ts ──────────────────────────────────────────────────
// Drop this hook into any page component to keep chat context in sync
// without manually calling setViewContext everywhere.
//
// Usage:
//   // In AgentViewPage:
//   useChatSync('agent_detail', agent ? {
//     agentId: agent.id, agentName: agent.name, ...agent
//   } : null);
//
//   // In BlueprintPage (uses the blueprint-specific path):
//   useBlueprintChatSync(activeCompany, nodes, selectedNode);

import { useEffect } from 'react';
import { useChatContext } from '../context/ChatContext';
import type { ViewType, ViewData, BlueprintContext } from '../context/ChatContext';

/**
 * General-purpose sync hook.
 * Call in any page component — updates chat context whenever data changes.
 */
export function useChatSync(viewType: ViewType, data: ViewData) {
  const { setViewContext } = useChatContext();
  useEffect(() => {
    setViewContext(viewType, data);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewType, JSON.stringify(data)]);
}

/**
 * Blueprint-specific sync hook.
 * Compresses node list to summaries only (avoids huge context objects).
 */
export function useBlueprintChatSync(
  company: { id: string; name: string; industry: string; region: string } | null,
  nodes:   { id: string; label: string; category?: string; summary?: string | null }[],
  activeDimension?: { label: string; category?: string; summary?: string | null },
) {
  const { setBlueprintContext, setActiveDimension } = useChatContext();

  useEffect(() => {
    if (!company) return;
    const ctx: BlueprintContext = {
      companyId:   company.id,
      companyName: company.name,
      industry:    company.industry,
      region:      company.region,
      // Send max 30 nodes — enough context without bloating the system prompt
      dimensions:  nodes.slice(0, 30).map(n => ({
        label:    n.label,
        category: n.category ?? 'custom',
        summary:  n.summary?.slice(0, 120),  // truncate summaries
      })),
      activeDimension: activeDimension ? {
        label:    activeDimension.label,
        category: activeDimension.category ?? 'custom',
        summary:  activeDimension.summary ?? undefined,
      } : undefined,
    };
    setBlueprintContext(ctx);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.id, nodes.length, activeDimension?.label]);

  // Separate effect for activeDimension changes (faster, no full rebuild)
  useEffect(() => {
    if (!activeDimension) {
      setActiveDimension(undefined);
      return;
    }
    setActiveDimension({
      label:    activeDimension.label,
      category: activeDimension.category ?? 'custom',
      summary:  activeDimension.summary ?? undefined,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDimension?.label]);
}
