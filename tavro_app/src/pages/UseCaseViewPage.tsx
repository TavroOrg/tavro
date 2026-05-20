import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { UseCaseDetail } from '../types/useCase';
import { AgentData } from '../types/agent';
import { mcpClient } from '../services/mcpClient';
import UseCaseView from '../components/UseCaseView';
import { ArrowLeft, RefreshCw, AlertCircle, Search, Loader2, Unlink2, PlusCircle, ShieldCheck, Pencil, Trash2, Code2, Copy, Check, X } from 'lucide-react';
import { useCatalog } from '../context/CatalogContext';
import { useUseCases } from '../context/UseCaseContext';
import { useChatSync } from '../hooks/useChatSync';
import AuditInitModal from '../components/audit/AuditInitModal';
import EditUseCaseModal from '../components/EditUseCaseModal';
import { useCaseApi } from '../services/useCaseApi';
import { businessRelationsApi } from '../services/businessRelationsApi';
import type { BusinessProcessRecord } from '../types/businessRelations';

const USE_CASE_AGENT_COUNT_CACHE_KEY = 'tavro_use_case_agent_count_cache';

interface AgentsSectionProps {
  useCase: UseCaseDetail;
  agents: AgentData[];
  onSilentRefetch: () => void;
}

interface ProcessRelationsSectionProps {
  useCase: UseCaseDetail;
  onSilentRefetch: () => void;
}

const normalizeUseCaseProcesses = (raw: any): Array<{
  identifier: string;
  name: string;
  description: string | null;
  business_criticality: string | null;
}> => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const rows: Array<{
    identifier: string;
    name: string;
    description: string | null;
    business_criticality: string | null;
  }> = [];

  raw.forEach((item: any) => {
    const identifier = String(item?.business_process_id ?? item?.identifier ?? item?.id ?? '').trim();
    if (!identifier || seen.has(identifier)) return;
    seen.add(identifier);
    rows.push({
      identifier,
      name: String(item?.process_name ?? item?.name ?? identifier),
      description: item?.description ?? item?.process_description ?? null,
      business_criticality: item?.business_criticality ?? null,
    });
  });

  return rows;
};

const normalizeUseCaseAgents = (raw: any): Array<{ agent_id: string; name: string; environment: string | null }> => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const rows: Array<{ agent_id: string; name: string; environment: string | null }> = [];

  raw.forEach((item: any) => {
    const agentId = String(item?.agent_id ?? item?.identifier ?? item?.id ?? '').trim();
    if (!agentId || seen.has(agentId)) return;
    seen.add(agentId);
    rows.push({
      agent_id: agentId,
      name: String(item?.name ?? item?.agent_name ?? agentId),
      environment: item?.environment ?? null,
    });
  });

  return rows;
};

const mergeUseCaseWithRestDetail = (
  base: UseCaseDetail | undefined,
  restPayload: any,
  processCatalog: any[] | undefined,
  fallbackId: string,
): UseCaseDetail | undefined => {
  const normalizedUseCaseId = String(fallbackId || '').trim().toLowerCase();
  const catalogLinkedProcesses = normalizeUseCaseProcesses(
    (processCatalog ?? []).filter((proc: any) => {
      const related = Array.isArray(proc?.related_use_cases) ? proc.related_use_cases : [];
      return related.some((uc: any) => {
        const ucId = String(uc?.identifier ?? uc?.ai_use_case_id ?? '').trim().toLowerCase();
        return ucId && ucId === normalizedUseCaseId;
      });
    }).map((proc: any) => ({
      identifier: proc.business_process_id,
      business_process_id: proc.business_process_id,
      name: proc.process_name,
      process_name: proc.process_name,
      description: proc.process_description,
      business_criticality: proc.business_criticality,
    })),
  );

  const mergeProcessLists = (...lists: Array<Array<{
    identifier: string;
    name: string;
    description: string | null;
    business_criticality: string | null;
  }>>) => {
    const byId = new Map<string, {
      identifier: string;
      name: string;
      description: string | null;
      business_criticality: string | null;
    }>();
    lists.forEach((list) => {
      list.forEach((proc) => {
        const key = String(proc.identifier || '').trim().toLowerCase();
        if (!key) return;
        if (!byId.has(key)) {
          byId.set(key, proc);
          return;
        }
        const existing = byId.get(key)!;
        byId.set(key, {
          ...existing,
          name: existing.name || proc.name,
          description: existing.description || proc.description,
          business_criticality: existing.business_criticality || proc.business_criticality,
        });
      });
    });
    return Array.from(byId.values());
  };

  const row = Array.isArray(restPayload?.data) ? restPayload.data[0] : null;
  const restLinkedProcesses = row
    ? normalizeUseCaseProcesses(row.of_associated_business_processes ?? row.business_processes ?? [])
    : [];
  const baseLinkedProcesses = normalizeUseCaseProcesses((base as any)?.business_processes ?? []);
  const linkedProcesses = mergeProcessLists(restLinkedProcesses, catalogLinkedProcesses, baseLinkedProcesses);

  if (!row) {
    if (!base) return undefined;
    return {
      ...base,
      business_processes: linkedProcesses,
    } as UseCaseDetail;
  }
  const linkedAgents = normalizeUseCaseAgents(
    row.of_associated_agents ?? row.agents ?? [],
  );

  if (base) {
    return {
      ...base,
      business_processes: linkedProcesses,
      agents: linkedAgents.length > 0 ? linkedAgents : (base as any).agents,
    } as UseCaseDetail;
  }

  return {
    identifier: String(row.identifier ?? row.use_case_id ?? row.id ?? fallbackId),
    name: String(row.name ?? row.title ?? 'Unnamed Use Case'),
    description: row.description ?? null,
    owner: row.owner ?? row.use_case_owner ?? null,
    priority: row.priority ?? null,
    status: row.status ?? null,
    problem_statement: row.problem_statement ?? row.business_problem_statement ?? null,
    expected_benefits: row.expected_benefits ?? null,
    function: row.function ?? null,
    agents: linkedAgents,
    business_processes: linkedProcesses,
  } as UseCaseDetail;
};

const AgentsSection: React.FC<AgentsSectionProps> = ({ useCase, agents, onSilentRefetch }) => {
  const { refresh: refreshUC } = useUseCases();
  const useCaseId = useCase.identifier;
  const rawLinked: any[] = (useCase as any).agents ?? (useCase as any).of_associated_agents ?? [];

  const resolveAgentId = (a: any): string => {
    const rawId = a?.agent_id ?? a?.identification?.agent_id ?? a?.sys_id ?? a?.id ?? a?.value;
    if (!rawId) return '';
    const found = agents.find(catA =>
      catA.identification?.agent_id === rawId || catA.sys_id === rawId || catA.id === rawId
    );
    return found?.identification?.agent_id ?? found?.sys_id ?? found?.id ?? rawId;
  };

  const resolveAgentLabel = (a: any): string => {
    if (!a || typeof a !== 'object') return 'Unknown Agent';
    const nameFields = ['name', 'display_value', 'title', 'u_name', 'agent_name'];
    for (const f of nameFields) {
      if (a[f] && typeof a[f] === 'string' && a[f] !== (a.value ?? a.sys_id)) return a[f];
    }
    const aId = resolveAgentId(a);
    if (aId) {
      const found = agents.find(catA =>
        catA.identification?.agent_id === aId || catA.sys_id === aId || catA.name === aId || catA.id === aId
      );
      if (found?.name) return found.name;
    }
    for (const key of Object.keys(a)) {
      const v = a[key];
      if (v && typeof v === 'object' && v.display_value && v.display_value !== v.value) return v.display_value;
    }
    return aId || 'Unknown Agent';
  };

  // Optimistic state: agents added/removed before server confirms
  const [pendingLinks, setPendingLinks] = useState<AgentData[]>([]);
  const [pendingUnlinkIds, setPendingUnlinkIds] = useState<Set<string>>(new Set());

  const serverLinkedIds = useMemo(() => {
    const ids = new Set<string>();
    rawLinked.forEach((a: any) => {
      const id = resolveAgentId(a);
      if (id) ids.add(id);
    });
    return ids;
  }, [rawLinked, agents]);

  // Clear pending state when server data catches up
  useEffect(() => {
    setPendingLinks(prev => prev.filter(a => {
      const id = a.identification?.agent_id || a.name;
      return id && !serverLinkedIds.has(id);
    }));
    setPendingUnlinkIds(prev => {
      const next = new Set(prev);
      for (const id of prev) {
        if (!serverLinkedIds.has(id)) next.delete(id);
      }
      return next;
    });
  }, [serverLinkedIds]);

  // Combined linked list for display
  const displayLinked = useMemo(() => {
    const serverFiltered = rawLinked.filter((a: any) => {
      const id = resolveAgentId(a);
      return !id || !pendingUnlinkIds.has(id);
    });
    const serverIds = new Set(rawLinked.map((a: any) => resolveAgentId(a)).filter(Boolean));
    const newLinks = pendingLinks.filter(a => {
      const id = a.identification?.agent_id || a.name;
      return id && !serverIds.has(id);
    });
    return [...serverFiltered, ...newLinks];
  }, [rawLinked, pendingLinks, pendingUnlinkIds, agents]);

  // All linked IDs (server + optimistic) for filtering available list
  const allLinkedIds = useMemo(() => {
    const ids = new Set(serverLinkedIds);
    pendingLinks.forEach(a => {
      const id = a.identification?.agent_id || a.name;
      if (id) ids.add(id);
    });
    pendingUnlinkIds.forEach(id => ids.delete(id));
    return ids;
  }, [serverLinkedIds, pendingLinks, pendingUnlinkIds]);

  const [searchTerm, setSearchTerm] = useState('');
  const [acting, setActing] = useState<string | null>(null);
  const [relationError, setRelationError] = useState<string | null>(null);

  const availableAgents = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return agents.filter(a => {
      const id = a.identification?.agent_id || a.sys_id || a.id || a.name || '';
      if (id && allLinkedIds.has(id)) return false;
      if (!q) return true;
      return (
        a.name?.toLowerCase().includes(q) ||
        id.toLowerCase().includes(q) ||
        (a.identification?.environment ?? '').toLowerCase().includes(q)
      );
    });
  }, [agents, allLinkedIds, searchTerm]);

  const handleLink = async (agent: AgentData) => {
    const aId = agent.identification?.agent_id || agent.name;
    if (!aId || allLinkedIds.has(aId)) return;
    setActing(aId);
    setRelationError(null);
    // Optimistic update
    setPendingLinks(prev => [...prev, agent]);
    try {
      await mcpClient.createAiUseCaseAgentRelationship(useCaseId, aId);
      refreshUC();
      onSilentRefetch();
    } catch (err: any) {
      setPendingLinks(prev => prev.filter(a => (a.identification?.agent_id || a.name) !== aId));
      setRelationError(err.message || 'Failed to link agent. Please try again.');
    } finally {
      setActing(null);
    }
  };

  const handleUnlink = async (linkedAgentId: string) => {
    if (!linkedAgentId) return;
    setActing(linkedAgentId);
    setRelationError(null);
    // Optimistic update
    setPendingUnlinkIds(prev => new Set([...prev, linkedAgentId]));
    try {
      await mcpClient.removeAiUseCaseAgentRelationship(useCaseId, linkedAgentId);
      refreshUC();
      onSilentRefetch();
    } catch (err: any) {
      setPendingUnlinkIds(prev => { const next = new Set(prev); next.delete(linkedAgentId); return next; });
      setRelationError(err.message || 'Failed to unlink agent. Please try again.');
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {relationError && (
        <div className="flex items-start gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {relationError}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <p className="text-sm font-bold text-slate-700">Currently Related Agents ({displayLinked.length})</p>
        </div>
        <div className="divide-y divide-slate-100">
          {displayLinked.length === 0 && (
            <div className="p-5 text-sm text-slate-500">No agents linked.</div>
          )}
          {displayLinked.map((a: any, i: number) => {
            const name = resolveAgentLabel(a);
            const id = resolveAgentId(a) || (a.identification?.agent_id) || (a.name);
            const isPendingUnlink = id && pendingUnlinkIds.has(id);
            return (
              <div key={id ?? i} className={`px-5 py-3 flex items-center justify-between gap-3 transition-opacity ${isPendingUnlink ? 'opacity-40' : ''}`}>
                <div className="min-w-0">
                  {id ? (
                    <Link to={`/agent/${encodeURIComponent(id)}`} className="text-sm font-semibold text-blue-600 hover:underline">
                      {name}
                    </Link>
                  ) : (
                    <p className="text-sm font-semibold text-slate-700">{name}</p>
                  )}
                </div>
                {id && (
                  <button
                    onClick={() => handleUnlink(id)}
                    disabled={acting === id}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {acting === id ? <Loader2 size={12} className="animate-spin" /> : <Unlink2 size={12} />}
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm font-bold text-slate-700">Add Agent Relation</p>
          <div className="relative w-full max-w-sm">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter agents..."
              className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>
        <div className="divide-y divide-slate-100 max-h-[320px] overflow-y-auto">
          {availableAgents.length === 0 && (
            <div className="p-5 text-sm text-slate-500">
              {searchTerm ? `No agents found for "${searchTerm}".` : 'No available agents to link.'}
            </div>
          )}
          {availableAgents.map(agent => {
            const agentId = agent.identification?.agent_id || '';
            const busy = acting === agentId;
            return (
              <div key={agentId} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-700 truncate">{agent.name}</p>
                  <p className="text-[11px] font-mono text-slate-400 truncate">{agentId}</p>
                </div>
                <button
                  onClick={() => handleLink(agent)}
                  disabled={!agentId || busy}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <PlusCircle size={12} />}
                  Link
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const ProcessRelationsSection: React.FC<ProcessRelationsSectionProps> = ({ useCase, onSilentRefetch }) => {
  const { refresh: refreshUC } = useUseCases();
  const useCaseId = useCase.identifier ?? '';
  const [allProcesses, setAllProcesses] = useState<BusinessProcessRecord[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [acting, setActing] = useState<string | null>(null);
  const [relationError, setRelationError] = useState<string | null>(null);
  const [pendingLinkIds, setPendingLinkIds] = useState<Set<string>>(new Set());
  const [pendingUnlinkIds, setPendingUnlinkIds] = useState<Set<string>>(new Set());

  const linkedProcessesFromServer = useMemo(
    () => normalizeUseCaseProcesses((useCase as any).business_processes ?? (useCase as any).of_associated_business_processes ?? []),
    [useCase],
  );

  const serverLinkedById = useMemo(() => {
    const map = new Map<string, {
      identifier: string;
      name: string;
      description: string | null;
      business_criticality: string | null;
    }>();
    linkedProcessesFromServer.forEach((proc) => {
      if (proc.identifier) map.set(proc.identifier, proc);
    });
    return map;
  }, [linkedProcessesFromServer]);

  useEffect(() => {
    setPendingLinkIds((prev) => {
      const next = new Set(prev);
      for (const id of prev) {
        if (serverLinkedById.has(id)) next.delete(id);
      }
      return next;
    });
    setPendingUnlinkIds((prev) => {
      const next = new Set(prev);
      for (const id of prev) {
        if (!serverLinkedById.has(id)) next.delete(id);
      }
      return next;
    });
  }, [serverLinkedById]);

  const linkedProcesses = useMemo(() => {
    const visibleServerRows = linkedProcessesFromServer.filter((proc) => !pendingUnlinkIds.has(proc.identifier));
    const optimisticLinks = Array.from(pendingLinkIds)
      .filter((id) => !serverLinkedById.has(id))
      .map((id) => {
        const catalogRow = allProcesses.find((p) => p.business_process_id === id);
        return {
          identifier: id,
          name: catalogRow?.process_name || id,
          description: catalogRow?.process_description ?? null,
          business_criticality: catalogRow?.business_criticality ?? null,
        };
      });
    return [...visibleServerRows, ...optimisticLinks];
  }, [allProcesses, linkedProcessesFromServer, pendingLinkIds, pendingUnlinkIds, serverLinkedById]);

  const linkedProcessIds = useMemo(() => {
    const ids = new Set(linkedProcessesFromServer.map(proc => proc.identifier).filter(Boolean));
    pendingLinkIds.forEach((id) => ids.add(id));
    pendingUnlinkIds.forEach((id) => ids.delete(id));
    return ids;
  }, [linkedProcessesFromServer, pendingLinkIds, pendingUnlinkIds]);

  const availableProcesses = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return allProcesses.filter(proc => {
      if (linkedProcessIds.has(proc.business_process_id)) return false;
      if (!q) return true;
      return (
        proc.business_process_id.toLowerCase().includes(q) ||
        (proc.process_name ?? '').toLowerCase().includes(q) ||
        (proc.process_description ?? '').toLowerCase().includes(q)
      );
    });
  }, [allProcesses, linkedProcessIds, searchTerm]);

  const loadProcessCatalog = async () => {
    setLoadingCatalog(true);
    try {
      const data = await businessRelationsApi.listProcesses();
      setAllProcesses(data);
    } catch (err: any) {
      setRelationError(err.message || 'Failed to load process catalog.');
    } finally {
      setLoadingCatalog(false);
    }
  };

  useEffect(() => {
    loadProcessCatalog();
  }, []);

  const handleLinkProcess = async (processId: string) => {
    if (!useCaseId || !processId || linkedProcessIds.has(processId)) return;
    setActing(`add:${processId}`);
    setRelationError(null);
    setPendingUnlinkIds((prev) => {
      const next = new Set(prev);
      next.delete(processId);
      return next;
    });
    setPendingLinkIds((prev) => new Set([...prev, processId]));
    try {
      await useCaseApi.linkProcess(useCaseId, processId);
      refreshUC();
      onSilentRefetch();
    } catch (err: any) {
      setPendingLinkIds((prev) => {
        const next = new Set(prev);
        next.delete(processId);
        return next;
      });
      setRelationError(err.message || 'Failed to link process.');
    } finally {
      setActing(null);
    }
  };

  const handleUnlinkProcess = async (processId: string) => {
    if (!useCaseId || !processId || !linkedProcessIds.has(processId)) return;
    setActing(`remove:${processId}`);
    setRelationError(null);
    setPendingLinkIds((prev) => {
      const next = new Set(prev);
      next.delete(processId);
      return next;
    });
    setPendingUnlinkIds((prev) => new Set([...prev, processId]));
    try {
      await useCaseApi.unlinkProcess(useCaseId, processId);
      refreshUC();
      onSilentRefetch();
    } catch (err: any) {
      setPendingUnlinkIds((prev) => {
        const next = new Set(prev);
        next.delete(processId);
        return next;
      });
      setRelationError(err.message || 'Failed to unlink process.');
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {relationError && (
        <div className="flex items-start gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {relationError}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <p className="text-sm font-bold text-slate-700">Currently Related Processes ({linkedProcesses.length})</p>
        </div>
        <div className="divide-y divide-slate-100">
          {linkedProcesses.length === 0 && (
            <div className="p-5 text-sm text-slate-500">No business processes linked.</div>
          )}
          {linkedProcesses.map((proc) => {
            const processId = proc.identifier;
            const removeKey = `remove:${processId}`;
            const isPendingUnlink = pendingUnlinkIds.has(processId);
            return (
              <div key={processId} className={`px-5 py-3 flex items-center justify-between gap-3 transition-opacity ${isPendingUnlink ? 'opacity-40' : ''}`}>
                <div className="min-w-0">
                  <Link to={`/processes/${encodeURIComponent(processId)}`} className="text-sm font-semibold text-blue-600 hover:underline">
                    {proc.name}
                  </Link>
                  <p className="text-[11px] font-mono text-slate-400 truncate">{processId}</p>
                </div>
                <button
                  onClick={() => handleUnlinkProcess(processId)}
                  disabled={acting === removeKey}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {acting === removeKey ? <Loader2 size={12} className="animate-spin" /> : <Unlink2 size={12} />}
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm font-bold text-slate-700">Add Process Relation</p>
          <div className="relative w-full max-w-sm">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter processes..."
              className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>
        <div className="divide-y divide-slate-100 max-h-[320px] overflow-y-auto">
          {loadingCatalog && (
            <div className="p-5 text-sm text-slate-500 inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Loading processes...
            </div>
          )}
          {!loadingCatalog && availableProcesses.length === 0 && (
            <div className="p-5 text-sm text-slate-500">No available processes to link.</div>
          )}
          {!loadingCatalog && availableProcesses.map(proc => {
            const processId = proc.business_process_id;
            const addKey = `add:${processId}`;
            const busy = acting === addKey;
            return (
              <div key={processId} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-700 truncate">{proc.process_name || processId}</p>
                  <p className="text-[11px] font-mono text-slate-400 truncate">{processId}</p>
                </div>
                <button
                  onClick={() => handleLinkProcess(processId)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <PlusCircle size={12} />}
                  Link
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const UseCaseViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [useCase, setUseCase] = useState<UseCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { agents } = useCatalog();

  const handleCopyJson = () => {
    if (!useCase) return;
    navigator.clipboard.writeText(JSON.stringify(useCase, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const { refresh: refreshUseCases } = useUseCases();

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await useCaseApi.deleteUseCase(id);
      refreshUseCases();
      navigate('/use-cases');
    } catch (err: any) {
      setError(err.message || 'Failed to delete use case.');
      setDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  };

  async function fetchUseCase() {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [mcpResult, restResult, processesResult] = await Promise.allSettled([
        mcpClient.getUseCaseDetails(id, { forceRefresh: true }),
        useCaseApi.getUseCase(id),
        businessRelationsApi.listProcesses(),
      ]);

      const mcpDetail = mcpResult.status === 'fulfilled' ? mcpResult.value : undefined;
      const restDetail = restResult.status === 'fulfilled' ? restResult.value : undefined;
      const processRows = processesResult.status === 'fulfilled' && Array.isArray(processesResult.value)
        ? processesResult.value
        : [];
      const merged = mergeUseCaseWithRestDetail(mcpDetail, restDetail, processRows, id);

      if (!merged) throw new Error('Use Case not found');
      setUseCase(merged);
    } catch (err: any) {
      setError(err.message || 'Failed to load use case details');
    } finally {
      setLoading(false);
    }
  }

  async function fetchUseCaseSilently(forceRefresh = false) {
    if (!id) return;
    try {
      const [mcpResult, restResult, processesResult] = await Promise.allSettled([
        mcpClient.getUseCaseDetails(id, { forceRefresh }),
        useCaseApi.getUseCase(id),
        businessRelationsApi.listProcesses(),
      ]);
      const mcpDetail = mcpResult.status === 'fulfilled' ? mcpResult.value : undefined;
      const restDetail = restResult.status === 'fulfilled' ? restResult.value : undefined;
      const processRows = processesResult.status === 'fulfilled' && Array.isArray(processesResult.value)
        ? processesResult.value
        : [];
      const merged = mergeUseCaseWithRestDetail(mcpDetail, restDetail, processRows, id);
      if (merged) setUseCase(merged);
    } catch {
      // silent — don't disrupt the UI
    }
  }

  useEffect(() => {
    fetchUseCase();
  }, [id]);

  useEffect(() => {
    if (!useCase) return;
    const useCaseKey = String(useCase.identifier ?? (useCase as any).id ?? '').trim();
    if (!useCaseKey) return;

    const rawLinked = ((useCase as any).agents ?? (useCase as any).of_associated_agents ?? []) as any[];
    const linkedCount = Array.isArray(rawLinked) ? rawLinked.length : 0;

    try {
      const raw = sessionStorage.getItem(USE_CASE_AGENT_COUNT_CACHE_KEY);
      const map = raw ? JSON.parse(raw) as Record<string, number> : {};
      map[useCaseKey] = linkedCount;
      sessionStorage.setItem(USE_CASE_AGENT_COUNT_CACHE_KEY, JSON.stringify(map));
    } catch {
      // Ignore storage write issues.
    }
  }, [useCase]);

  const handleUseCaseSaved = (updated: {
    title: string;
    description: string;
    problemStatement: string;
    expectedBenefits: string;
    priority: string;
    solutionApproach: string;
    owner: string;
  }) => {
    setUseCase(prev => {
      if (!prev) return prev;
      const next: UseCaseDetail = {
        ...prev,
        description: updated.description,
        priority: updated.priority,
      } as UseCaseDetail;
      (next as any).name = updated.title || (next as any).name;
      (next as any).title = updated.title || (next as any).title;
      (next as any).problem_statement = updated.problemStatement;
      (next as any).business_problem_statement = updated.problemStatement;
      (next as any).expected_benefits = updated.expectedBenefits;
      (next as any).solution_approach = updated.solutionApproach;
      (next as any).owner = updated.owner;
      (next as any).use_case_owner = updated.owner;
      return next;
    });
    mcpClient.invalidateCache();
    fetchUseCaseSilently(true);
    refreshUseCases();
  };

  useChatSync('use_case_detail', useCase ? {
    useCaseId: useCase.identifier ?? (useCase as any).id ?? '',
    title: (useCase as any).name ?? (useCase as any).title ?? '',
    description: useCase.description ?? undefined,
    status: (useCase as any).status,
    priority: (useCase as any).priority,
    linkedAgents: ((useCase as any).agents ?? []).map((a: any) => a.name ?? a).filter(Boolean),
  } : null);

  const prettyJson = useCase ? JSON.stringify(
    Object.fromEntries(Object.entries(useCase as any).filter(([k]) => k !== 'agents')),
    null, 2
  ) : '';
  const useCaseName = useCase ? ((useCase as any).name ?? (useCase as any).title ?? useCase.identifier ?? '') : '';

  return (
    <div className="flex flex-col gap-6 w-full animate-fade-in pb-12">
      <div className="flex items-center justify-between">
        <button
          onClick={() => {
            const page = (location.state as any)?.page;
            if (Number.isFinite(Number(page)) && Number(page) > 0) {
              navigate('/use-cases', { state: { page: Number(page) } });
              return;
            }
            if (window.history.length > 1) {
              navigate(-1);
              return;
            }
            navigate('/use-cases');
          }}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 transition-all bg-transparent border-none cursor-pointer"
        >
          <ArrowLeft size={16} /> Back to Use Cases
        </button>
        {useCase && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setAuditModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-sm"
            >
              <ShieldCheck size={15} /> Audit
            </button>
            <button
              onClick={() => setJsonOpen(true)}
              title="AI Use Case Card"
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-slate-800 text-slate-100 hover:bg-slate-700 transition-all border border-slate-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Code2 size={14} /> AI Use Case Card
            </button>
            <button
              onClick={() => setEditOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-all shadow-sm"
            >
              <Pencil size={15} /> Edit
            </button>
            <button
              onClick={() => setDeleteConfirm(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-white border border-red-200 text-red-600 hover:bg-red-50 transition-all shadow-sm"
            >
              <Trash2 size={15} /> Delete
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex flex-col justify-center items-center min-h-[50vh] gap-3 text-slate-400">
          <RefreshCw size={22} className="animate-spin" />
          <span className="text-sm">Loading use case details...</span>
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col justify-center items-center min-h-[50vh] gap-4">
          <div className="flex items-start gap-3 text-red-500 bg-red-50 border border-red-200 rounded-xl px-6 py-4 max-w-lg">
            <AlertCircle size={20} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-bold text-sm">Could not load use case</p>
              <p className="text-xs mt-1 text-red-400">{error}</p>
            </div>
          </div>
          <button onClick={() => navigate('/use-cases')} className="text-sm font-medium text-violet-600 hover:underline">
            Return to Use Case Catalog
          </button>
        </div>
      )}

      {!loading && !error && useCase && (
        <UseCaseView
          useCase={useCase}
          agentsComponent={<AgentsSection useCase={useCase} agents={agents} onSilentRefetch={fetchUseCaseSilently} />}
          businessImpactComponent={<ProcessRelationsSection useCase={useCase} onSilentRefetch={fetchUseCaseSilently} />}
        />
      )}

      {useCase && (
        <EditUseCaseModal
          useCase={useCase}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={handleUseCaseSaved}
        />
      )}

      <AuditInitModal
        open={auditModalOpen}
        onClose={() => setAuditModalOpen(false)}
        onLaunched={(runId) => navigate(`/audit/${runId}`)}
        prefillUseCaseId={useCase?.identifier ?? (useCase as any)?.id ?? ''}
        prefillUseCaseName={(useCase as any)?.name ?? (useCase as any)?.title ?? ''}
        mode="use_case"
      />

      {/* JSON Inspector Modal */}
      {jsonOpen && useCase && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setJsonOpen(false); }}
        >
          <div className="relative bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden border border-slate-700">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <Code2 size={16} className="text-blue-400" />
                <span className="font-bold text-slate-100 text-sm">AI Use Case Card</span>
                <span className="text-xs text-slate-400 font-mono ml-2 bg-slate-800 px-2 py-0.5 rounded">
                  {useCaseName}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyJson}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-all border border-slate-700"
                >
                  {copied ? <><Check size={12} className="text-emerald-400" /> Copied!</> : <><Copy size={12} /> Copy</>}
                </button>
                <button
                  onClick={() => setJsonOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-all"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="overflow-auto flex-1 p-5">
              <pre className="text-xs text-slate-300 font-mono leading-relaxed whitespace-pre-wrap break-words">
                {prettyJson}
              </pre>
            </div>
            <div className="px-5 py-2.5 border-t border-slate-700 flex justify-between text-xs text-slate-500">
              <span>{prettyJson.split('\n').length} lines</span>
              <span>{(new TextEncoder().encode(prettyJson).length / 1024).toFixed(1)} KB</span>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden border border-slate-200 p-6 gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-base font-bold text-slate-800">Delete AI Use Case?</span>
              <span className="text-sm text-slate-500">
                This will permanently delete <span className="font-semibold text-slate-700">{(useCase as any)?.name ?? (useCase as any)?.title ?? id}</span> and all linked agent relationships. This action cannot be undone.
              </span>
            </div>
            {error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>
            )}
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(false)}
                disabled={deleting}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {deleting ? <><Loader2 size={14} className="animate-spin" /> Deleting…</> : <><Trash2 size={14} /> Delete</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UseCaseViewPage;
