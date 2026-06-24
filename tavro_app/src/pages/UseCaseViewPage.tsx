import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { UseCaseDetail } from '../types/useCase';
import { AgentData } from '../types/agent';
import UseCaseView from '../components/UseCaseView';
import { ArrowLeft, RefreshCw, AlertCircle, Search, Loader2, Unlink2, PlusCircle, ShieldCheck, Pencil, Trash2, Code2, Copy, Check, X, CheckCircle2 } from 'lucide-react';
import { useCatalog } from '../context/CatalogContext';
import { useUseCases } from '../context/UseCaseContext';
import { useBlueprint } from '../context/BlueprintContext';
import { agentApi } from '../services/agentApi';
import { useChatSync } from '../hooks/useChatSync';
import { useCaseApi } from '../services/useCaseApi';
import { businessRelationsApi } from '../services/businessRelationsApi';
import { aiModelApi } from '../services/aiModelApi';
import type { BusinessApplicationRecord, BusinessProcessRecord } from '../types/businessRelations';
import type { AiModelRecord } from '../types/aiModel';

const USE_CASE_AGENT_COUNT_CACHE_KEY = 'tavro_use_case_agent_count_cache';

interface AgentsSectionProps {
  useCase: UseCaseDetail;
  agents: AgentData[];
  onSilentRefetch: () => void;
}

interface ProcessRelationsSectionProps {
  useCase: UseCaseDetail;
  onSilentRefetch: () => void;
  companyId?: string;
}

interface ApplicationRelationsSectionProps {
  useCase: UseCaseDetail;
  onSilentRefetch: () => void;
  companyId?: string;
}

interface AiModelRelationsSectionProps {
  useCase: UseCaseDetail;
  onSilentRefetch: () => void;
  companyId?: string;
}

const normalizeUseCaseAiModels = (
  raw: any,
): Array<{ identifier: string; name: string; description: string | null; provider: string | null; status: string | null }> => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m: any) => {
      const identifier = m?.ai_model_id ?? m?.identifier ?? m?.id ?? '';
      return {
        identifier,
        name: m?.model_name ?? m?.name ?? identifier,
        description: m?.description ?? null,
        provider: m?.provider ?? null,
        status: m?.status ?? null,
      };
    })
    .filter((m) => !!m.identifier);
};

const normalizeUseCaseApplications = (raw: any): Array<{
  identifier: string;
  name: string;
  description: string | null;
  business_criticality: string | null;
  emergency_tier: string | null;
}> => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const rows: Array<{
    identifier: string;
    name: string;
    description: string | null;
    business_criticality: string | null;
    emergency_tier: string | null;
  }> = [];

  raw.forEach((item: any) => {
    const identifier = String(item?.business_application_id ?? item?.identifier ?? item?.id ?? '').trim();
    if (!identifier || seen.has(identifier)) return;
    seen.add(identifier);
    rows.push({
      identifier,
      name: String(item?.application_name ?? item?.name ?? identifier),
      description: item?.description ?? item?.application_description ?? null,
      business_criticality: item?.business_criticality ?? null,
      emergency_tier: item?.emergency_tier ?? null,
    });
  });

  return rows;
};

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
  applicationCatalog: any[] | undefined,
  processCatalog: any[] | undefined,
  fallbackId: string,
): UseCaseDetail | undefined => {
  const normalizedUseCaseId = String(fallbackId || '').trim().toLowerCase();
  const catalogLinkedApplications = normalizeUseCaseApplications(
    (applicationCatalog ?? []).filter((app: any) => {
      const related = Array.isArray(app?.related_use_cases) ? app.related_use_cases : [];
      return related.some((uc: any) => {
        const ucId = String(uc?.identifier ?? uc?.ai_use_case_id ?? '').trim().toLowerCase();
        return ucId && ucId === normalizedUseCaseId;
      });
    }).map((app: any) => ({
      identifier: app.business_application_id,
      business_application_id: app.business_application_id,
      name: app.application_name,
      application_name: app.application_name,
      description: app.application_description,
      business_criticality: app.business_criticality,
      emergency_tier: app.emergency_tier,
    })),
  );
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

  const mergeApplicationLists = (...lists: Array<Array<{
    identifier: string;
    name: string;
    description: string | null;
    business_criticality: string | null;
    emergency_tier: string | null;
  }>>) => {
    const byId = new Map<string, {
      identifier: string;
      name: string;
      description: string | null;
      business_criticality: string | null;
      emergency_tier: string | null;
    }>();
    lists.forEach((list) => {
      list.forEach((app) => {
        const key = String(app.identifier || '').trim().toLowerCase();
        if (!key) return;
        if (!byId.has(key)) {
          byId.set(key, app);
          return;
        }
        const existing = byId.get(key)!;
        byId.set(key, {
          ...existing,
          name: existing.name || app.name,
          description: existing.description || app.description,
          business_criticality: existing.business_criticality || app.business_criticality,
          emergency_tier: existing.emergency_tier || app.emergency_tier,
        });
      });
    });
    return Array.from(byId.values());
  };

  const row = Array.isArray(restPayload?.data) ? restPayload.data[0] : null;
  const restLinkedApplications = row
    ? normalizeUseCaseApplications(row.of_associated_business_applications ?? row.applications ?? [])
    : [];
  const baseLinkedApplications = normalizeUseCaseApplications((base as any)?.applications ?? (base as any)?.of_associated_business_applications ?? []);
  const linkedApplications = mergeApplicationLists(restLinkedApplications, catalogLinkedApplications, baseLinkedApplications);
  const restLinkedProcesses = row
    ? normalizeUseCaseProcesses(row.of_associated_business_processes ?? row.business_processes ?? [])
    : [];
  const baseLinkedProcesses = normalizeUseCaseProcesses((base as any)?.business_processes ?? []);
  const linkedProcesses = mergeProcessLists(restLinkedProcesses, catalogLinkedProcesses, baseLinkedProcesses);

  if (!row) {
    if (!base) return undefined;
    return {
      ...base,
      applications: linkedApplications,
      business_processes: linkedProcesses,
    } as UseCaseDetail;
  }
  const linkedAgents = normalizeUseCaseAgents(
    row.of_associated_agents ?? row.agents ?? [],
  );
  const restRiskFields = {
    agent_risk_exposure_are: row.agent_risk_exposure_are ?? (base as any)?.agent_risk_exposure_are,
    no_of_associated_agents: row.no_of_associated_agents ?? (base as any)?.no_of_associated_agents,
    blended_risk_score: row.blended_risk_score ?? (base as any)?.blended_risk_score,
    inherent_risk_classification: row.inherent_risk_classification ?? (base as any)?.inherent_risk_classification,
    inherent_risk_classification_score: row.inherent_risk_classification_score ?? (base as any)?.inherent_risk_classification_score,
    residual_risk_classification: row.residual_risk_classification ?? (base as any)?.residual_risk_classification,
    residual_risk_classification_score: row.residual_risk_classification_score ?? (base as any)?.residual_risk_classification_score,
    agent_risk_tier_art: row.agent_risk_tier_art ?? (base as any)?.agent_risk_tier_art,
  };

  const businessCaseFields = {
    assumptions: row.assumptions ?? (base as any)?.assumptions ?? null,
    quantified_financial_benefits: row.quantified_financial_benefits ?? (base as any)?.quantified_financial_benefits ?? null,
    total_financial_impact_summary: row.total_financial_impact_summary ?? (base as any)?.total_financial_impact_summary ?? null,
    implementation_cost_estimate: row.implementation_cost_estimate ?? (base as any)?.implementation_cost_estimate ?? null,
    return_on_investment: row.return_on_investment ?? (base as any)?.return_on_investment ?? null,
    risk_considerations: row.risk_considerations ?? (base as any)?.risk_considerations ?? null,
    implementation_roadmap: row.implementation_roadmap ?? (base as any)?.implementation_roadmap ?? null,
    recommendation: row.recommendation ?? (base as any)?.recommendation ?? null,
  };

  const linkedAiModels = normalizeUseCaseAiModels(row.of_associated_ai_models ?? row.ai_models ?? []);

  if (base) {
    return {
      ...base,
      ...restRiskFields,
      ...businessCaseFields,
      solution_approach: row.solution_approach ?? (base as any).solution_approach ?? null,
      created_ts: row.created_ts ?? (base as any).created_ts ?? null,
      updated_ts: row.updated_ts ?? (base as any).updated_ts ?? null,
      applications: linkedApplications,
      business_processes: linkedProcesses,
      agents: linkedAgents.length > 0 ? linkedAgents : (base as any).agents,
      of_associated_ai_models: linkedAiModels,
      ai_models: linkedAiModels,
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
    solution_approach: row.solution_approach ?? null,
    created_ts: row.created_ts ?? null,
    updated_ts: row.updated_ts ?? null,
    function: row.function ?? null,
    agents: linkedAgents,
    applications: linkedApplications,
    business_processes: linkedProcesses,
    of_associated_ai_models: linkedAiModels,
    ai_models: linkedAiModels,
    ...restRiskFields,
    ...businessCaseFields,
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
      await useCaseApi.linkAgent(useCaseId, aId);
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
      await useCaseApi.unlinkAgent(useCaseId, linkedAgentId);
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

const ApplicationRelationsSection: React.FC<ApplicationRelationsSectionProps> = ({ useCase, onSilentRefetch, companyId }) => {
  const { refresh: refreshUC } = useUseCases();
  const useCaseId = useCase.identifier ?? '';
  const [allApplications, setAllApplications] = useState<BusinessApplicationRecord[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [acting, setActing] = useState<string | null>(null);
  const [relationError, setRelationError] = useState<string | null>(null);
  const [pendingLinkIds, setPendingLinkIds] = useState<Set<string>>(new Set());
  const [pendingUnlinkIds, setPendingUnlinkIds] = useState<Set<string>>(new Set());

  const linkedApplicationsFromServer = useMemo(
    () => normalizeUseCaseApplications((useCase as any).applications ?? (useCase as any).of_associated_business_applications ?? []),
    [useCase],
  );

  const serverLinkedById = useMemo(() => {
    const map = new Map<string, {
      identifier: string;
      name: string;
      description: string | null;
      business_criticality: string | null;
      emergency_tier: string | null;
    }>();
    linkedApplicationsFromServer.forEach((app) => {
      if (app.identifier) map.set(app.identifier, app);
    });
    return map;
  }, [linkedApplicationsFromServer]);

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

  const linkedApplications = useMemo(() => {
    const visibleServerRows = linkedApplicationsFromServer.filter((app) => !pendingUnlinkIds.has(app.identifier));
    const optimisticLinks = Array.from(pendingLinkIds)
      .filter((id) => !serverLinkedById.has(id))
      .map((id) => {
        const catalogRow = allApplications.find((app) => app.business_application_id === id);
        return {
          identifier: id,
          name: catalogRow?.application_name || id,
          description: catalogRow?.application_description ?? null,
          business_criticality: catalogRow?.business_criticality ?? null,
          emergency_tier: catalogRow?.emergency_tier ?? null,
        };
      });
    return [...visibleServerRows, ...optimisticLinks];
  }, [allApplications, linkedApplicationsFromServer, pendingLinkIds, pendingUnlinkIds, serverLinkedById]);

  const linkedApplicationIds = useMemo(() => {
    const ids = new Set(linkedApplicationsFromServer.map(app => app.identifier).filter(Boolean));
    pendingLinkIds.forEach((id) => ids.add(id));
    pendingUnlinkIds.forEach((id) => ids.delete(id));
    return ids;
  }, [linkedApplicationsFromServer, pendingLinkIds, pendingUnlinkIds]);

  const availableApplications = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return allApplications.filter(app => {
      if (linkedApplicationIds.has(app.business_application_id)) return false;
      if (!q) return true;
      return (
        app.business_application_id.toLowerCase().includes(q) ||
        (app.application_name ?? '').toLowerCase().includes(q) ||
        (app.application_description ?? '').toLowerCase().includes(q)
      );
    });
  }, [allApplications, linkedApplicationIds, searchTerm]);

  const loadApplicationCatalog = async () => {
    setLoadingCatalog(true);
    try {
      const data = await businessRelationsApi.listApplications(undefined, companyId);
      setAllApplications(data);
    } catch (err: any) {
      setRelationError(err.message || 'Failed to load application catalog.');
    } finally {
      setLoadingCatalog(false);
    }
  };

  useEffect(() => {
    loadApplicationCatalog();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const handleLinkApplication = async (applicationId: string) => {
    if (!useCaseId || !applicationId || linkedApplicationIds.has(applicationId)) return;
    setActing(`add:${applicationId}`);
    setRelationError(null);
    setPendingUnlinkIds((prev) => {
      const next = new Set(prev);
      next.delete(applicationId);
      return next;
    });
    setPendingLinkIds((prev) => new Set([...prev, applicationId]));
    try {
      await useCaseApi.linkApplication(useCaseId, applicationId);
      refreshUC();
      onSilentRefetch();
    } catch (err: any) {
      setPendingLinkIds((prev) => {
        const next = new Set(prev);
        next.delete(applicationId);
        return next;
      });
      setRelationError(err.message || 'Failed to link application.');
    } finally {
      setActing(null);
    }
  };

  const handleUnlinkApplication = async (applicationId: string) => {
    if (!useCaseId || !applicationId || !linkedApplicationIds.has(applicationId)) return;
    setActing(`remove:${applicationId}`);
    setRelationError(null);
    setPendingLinkIds((prev) => {
      const next = new Set(prev);
      next.delete(applicationId);
      return next;
    });
    setPendingUnlinkIds((prev) => new Set([...prev, applicationId]));
    try {
      await useCaseApi.unlinkApplication(useCaseId, applicationId);
      refreshUC();
      onSilentRefetch();
    } catch (err: any) {
      setPendingUnlinkIds((prev) => {
        const next = new Set(prev);
        next.delete(applicationId);
        return next;
      });
      setRelationError(err.message || 'Failed to unlink application.');
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
          <p className="text-sm font-bold text-slate-700">Currently Related Applications ({linkedApplications.length})</p>
        </div>
        <div className="divide-y divide-slate-100">
          {linkedApplications.length === 0 && (
            <div className="p-5 text-sm text-slate-500">No business applications linked.</div>
          )}
          {linkedApplications.map((app) => {
            const applicationId = app.identifier;
            const removeKey = `remove:${applicationId}`;
            const isPendingUnlink = pendingUnlinkIds.has(applicationId);
            return (
              <div key={applicationId} className={`px-5 py-3 flex items-center justify-between gap-3 transition-opacity ${isPendingUnlink ? 'opacity-40' : ''}`}>
                <div className="min-w-0">
                  <Link to={`/applications/${encodeURIComponent(applicationId)}`} className="text-sm font-semibold text-blue-600 hover:underline">
                    {app.name}
                  </Link>
                  <p className="text-[11px] font-mono text-slate-400 truncate">{applicationId}</p>
                </div>
                <button
                  onClick={() => handleUnlinkApplication(applicationId)}
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
          <p className="text-sm font-bold text-slate-700">Add Application Relation</p>
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full max-w-[520px] ml-auto justify-end">
            {useCaseId && (
              <Link
                to={`/applications/new?linkUseCaseId=${encodeURIComponent(useCaseId)}`}
                className="inline-flex shrink-0 items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700"
              >
                <PlusCircle size={12} />
                Create Application
              </Link>
            )}
            <div className="relative w-full sm:w-[320px] max-w-full">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Filter applications..."
                className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
        </div>
        <div className="divide-y divide-slate-100 max-h-[320px] overflow-y-auto">
          {loadingCatalog && (
            <div className="p-5 text-sm text-slate-500 inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Loading applications...
            </div>
          )}
          {!loadingCatalog && availableApplications.length === 0 && (
            <div className="p-5 text-sm text-slate-500">No available applications to link.</div>
          )}
          {!loadingCatalog && availableApplications.map(app => {
            const applicationId = app.business_application_id;
            const addKey = `add:${applicationId}`;
            const busy = acting === addKey;
            return (
              <div key={applicationId} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-700 truncate">{app.application_name || applicationId}</p>
                  <p className="text-[11px] font-mono text-slate-400 truncate">{applicationId}</p>
                </div>
                <button
                  onClick={() => handleLinkApplication(applicationId)}
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

const ProcessRelationsSection: React.FC<ProcessRelationsSectionProps> = ({ useCase, onSilentRefetch, companyId }) => {
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
      const data = await businessRelationsApi.listProcesses(undefined, companyId);
      setAllProcesses(data);
    } catch (err: any) {
      setRelationError(err.message || 'Failed to load process catalog.');
    } finally {
      setLoadingCatalog(false);
    }
  };

  useEffect(() => {
    loadProcessCatalog();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

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
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full max-w-[520px] ml-auto justify-end">
            {useCaseId && (
              <Link
                to={`/processes/new?linkUseCaseId=${encodeURIComponent(useCaseId)}`}
                className="inline-flex shrink-0 items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700"
              >
                <PlusCircle size={12} />
                Create Process
              </Link>
            )}
            <div className="relative w-full sm:w-[320px] max-w-full">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Filter processes..."
                className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
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

const AiModelRelationsSection: React.FC<AiModelRelationsSectionProps> = ({ useCase, onSilentRefetch, companyId }) => {
  const { refresh: refreshUC } = useUseCases();
  const useCaseId = useCase.identifier ?? '';
  const [allModels, setAllModels] = useState<AiModelRecord[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [acting, setActing] = useState<string | null>(null);
  const [relationError, setRelationError] = useState<string | null>(null);

  const linkedModels = useMemo(
    () => normalizeUseCaseAiModels((useCase as any).ai_models ?? (useCase as any).of_associated_ai_models ?? []),
    [useCase],
  );
  const linkedModelIds = useMemo(
    () => new Set(linkedModels.map((m) => m.identifier).filter(Boolean)),
    [linkedModels],
  );

  const availableModels = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return allModels.filter((m) => {
      if (linkedModelIds.has(m.ai_model_id)) return false;
      if (!q) return true;
      return (
        m.ai_model_id.toLowerCase().includes(q) ||
        (m.model_name ?? '').toLowerCase().includes(q) ||
        (m.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [allModels, linkedModelIds, searchTerm]);

  const loadModelCatalog = async () => {
    setLoadingCatalog(true);
    try {
      setAllModels(await aiModelApi.listModels(undefined, companyId));
    } catch (err: any) {
      setRelationError(err.message || 'Failed to load AI model catalog.');
    } finally {
      setLoadingCatalog(false);
    }
  };

  useEffect(() => {
    loadModelCatalog();
  }, [companyId]);

  const handleLinkModel = async (modelId: string) => {
    if (!useCaseId || !modelId || linkedModelIds.has(modelId)) return;
    setActing(`add:${modelId}`);
    setRelationError(null);
    try {
      await aiModelApi.linkUseCase(modelId, useCaseId);
      refreshUC();
      onSilentRefetch();
    } catch (err: any) {
      setRelationError(err.message || 'Failed to link AI model.');
    } finally {
      setActing(null);
    }
  };

  const handleUnlinkModel = async (modelId: string) => {
    if (!useCaseId || !modelId) return;
    setActing(`remove:${modelId}`);
    setRelationError(null);
    try {
      await aiModelApi.unlinkUseCase(modelId, useCaseId);
      refreshUC();
      onSilentRefetch();
    } catch (err: any) {
      setRelationError(err.message || 'Failed to unlink AI model.');
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
          <p className="text-sm font-bold text-slate-700">Currently Related AI Models ({linkedModels.length})</p>
        </div>
        <div className="divide-y divide-slate-100">
          {linkedModels.length === 0 && (
            <div className="p-5 text-sm text-slate-500">No AI models linked.</div>
          )}
          {linkedModels.map((model) => {
            const modelId = model.identifier;
            const removeKey = `remove:${modelId}`;
            return (
              <div key={modelId} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link to={`/ai-models/${encodeURIComponent(modelId)}`} className="text-sm font-semibold text-blue-600 hover:underline">
                    {model.name}
                  </Link>
                  <p className="text-[11px] font-mono text-slate-400 truncate">{modelId}</p>
                </div>
                <button
                  onClick={() => handleUnlinkModel(modelId)}
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
          <p className="text-sm font-bold text-slate-700">Add AI Model Relation</p>
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full max-w-[520px] ml-auto justify-end">
            <Link
              to="/ai-models/new"
              className="inline-flex shrink-0 items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700"
            >
              <PlusCircle size={12} />
              Create Model
            </Link>
            <div className="relative w-full sm:w-[320px] max-w-full">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Filter AI models..."
                className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
        </div>
        <div className="divide-y divide-slate-100 max-h-[320px] overflow-y-auto">
          {loadingCatalog && (
            <div className="p-5 text-sm text-slate-500 inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Loading AI models...
            </div>
          )}
          {!loadingCatalog && availableModels.length === 0 && (
            <div className="p-5 text-sm text-slate-500">No available AI models to link.</div>
          )}
          {!loadingCatalog && availableModels.map((model) => {
            const modelId = model.ai_model_id;
            const addKey = `add:${modelId}`;
            const busy = acting === addKey;
            return (
              <div key={modelId} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-700 truncate">{model.model_name || modelId}</p>
                  <p className="text-[11px] font-mono text-slate-400 truncate">{modelId}</p>
                </div>
                <button
                  onClick={() => handleLinkModel(modelId)}
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
  const [error, setError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPriority, setEditPriority] = useState('');
  const [editOwner, setEditOwner] = useState('');
  const [editProblemStatement, setEditProblemStatement] = useState('');
  const [editExpectedBenefits, setEditExpectedBenefits] = useState('');
  const [editSolutionApproach, setEditSolutionApproach] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [inlineEdit, setInlineEdit] = useState<{ field: string; value: string } | null>(null);
  const [inlineSaving, setInlineSaving] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { agents: catalogAgents } = useCatalog();
  const { activeCompany } = useBlueprint();
  const [companyAgents, setCompanyAgents] = useState<typeof catalogAgents>([]);

  useEffect(() => {
    agentApi.listAgentsForLinking(activeCompany?.id).then(setCompanyAgents).catch(() => {});
  }, [activeCompany?.id]);

  const agents = companyAgents.length > 0 ? companyAgents : catalogAgents;

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
      const [restResult, applicationsResult, processesResult] = await Promise.allSettled([
        useCaseApi.getUseCase(id, activeCompany?.id),
        businessRelationsApi.listApplications(undefined, activeCompany?.id),
        businessRelationsApi.listProcesses(undefined, activeCompany?.id),
      ]);

      const restDetail = restResult.status === 'fulfilled' ? restResult.value : undefined;
      const applicationRows = applicationsResult.status === 'fulfilled' && Array.isArray(applicationsResult.value)
        ? applicationsResult.value
        : [];
      const processRows = processesResult.status === 'fulfilled' && Array.isArray(processesResult.value)
        ? processesResult.value
        : [];
      const merged = mergeUseCaseWithRestDetail(undefined, restDetail, applicationRows, processRows, id);

      if (!merged) throw new Error('Use Case not found');
      setUseCase(merged);
    } catch (err: any) {
      setError(err.message || 'Failed to load use case details');
    } finally {
      setLoading(false);
    }
  }

  async function fetchUseCaseSilently() {
    if (!id) return;
    try {
      const [restResult, applicationsResult, processesResult] = await Promise.allSettled([
        useCaseApi.getUseCase(id, activeCompany?.id),
        businessRelationsApi.listApplications(undefined, activeCompany?.id),
        businessRelationsApi.listProcesses(undefined, activeCompany?.id),
      ]);
      const restDetail = restResult.status === 'fulfilled' ? restResult.value : undefined;
      const applicationRows = applicationsResult.status === 'fulfilled' && Array.isArray(applicationsResult.value)
        ? applicationsResult.value
        : [];
      const processRows = processesResult.status === 'fulfilled' && Array.isArray(processesResult.value)
        ? processesResult.value
        : [];
      const merged = mergeUseCaseWithRestDetail(undefined, restDetail, applicationRows, processRows, id);
      if (merged) setUseCase(merged);
    } catch {
      // silent — don't disrupt the UI
    }
  }

  useEffect(() => {
    fetchUseCase();
  }, [id]);

  useEffect(() => {
    if (!id || isEditing) return;

    const handleWorkflowUpdate = () => {
      fetchUseCaseSilently();
      refreshUseCases();
    };

    window.addEventListener('tavro_temporal_workflow_update', handleWorkflowUpdate);
    return () => window.removeEventListener('tavro_temporal_workflow_update', handleWorkflowUpdate);
  }, [id, activeCompany?.id, isEditing, refreshUseCases]);

  useEffect(() => {
    if (!id || isEditing || loading) return;
    try {
      const raw = localStorage.getItem('tavro_temporal_workflows');
      if (raw !== null) {
        const workflows = JSON.parse(raw) as Array<{ status?: string }>;
        const hasRunning = workflows.some(w => String(w.status ?? '').trim().toLowerCase() === 'running');
        if (!hasRunning) fetchUseCaseSilently();
      }
    } catch {
      // Ignore malformed workflow snapshots.
    }
  }, [id, activeCompany?.id, isEditing, loading]);


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

  const handleStartEdit = () => {
    if (!useCase) return;
    const uc = useCase as any;
    setEditTitle(uc.name ?? uc.title ?? '');
    setEditDescription(uc.description ?? '');
    setEditPriority(uc.priority ?? '3 - Moderate');
    setEditOwner(uc.owner ?? uc.use_case_owner ?? '');
    setEditProblemStatement(uc.problem_statement ?? uc.business_problem_statement ?? '');
    setEditExpectedBenefits(uc.expected_benefits ?? '');
    setEditSolutionApproach(uc.solution_approach ?? '');
    setEditError(null);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!useCase || !id) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const uc = useCase as any;
      const payload: any = {
        __activityName: (useCase as any).name ?? (useCase as any).title ?? id,
      };
      const currentTitle = String(uc.name ?? uc.title ?? '').trim();
      const currentDescription = String(uc.description ?? '').trim();
      const currentPriority = String(uc.priority ?? '3 - Moderate');
      const currentOwner = String(uc.owner ?? uc.use_case_owner ?? '').trim();
      const currentProblemStatement = String(uc.problem_statement ?? uc.business_problem_statement ?? '').trim();
      const currentExpectedBenefits = String(uc.expected_benefits ?? '').trim();
      const currentSolutionApproach = String(uc.solution_approach ?? '').trim();

      const nextTitle = editTitle.trim();
      const nextDescription = editDescription.trim();
      const nextOwner = editOwner.trim();
      const nextProblemStatement = editProblemStatement.trim();
      const nextExpectedBenefits = editExpectedBenefits.trim();
      const nextSolutionApproach = editSolutionApproach.trim();

      if (nextTitle !== currentTitle) payload.title = nextTitle || undefined;
      if (nextDescription !== currentDescription) payload.description = nextDescription || undefined;
      if (editPriority !== currentPriority) payload.priority = editPriority || undefined;
      if (nextOwner !== currentOwner) payload.use_case_owner = nextOwner || undefined;
      if (nextProblemStatement !== currentProblemStatement) payload.business_problem_statement = nextProblemStatement || undefined;
      if (nextExpectedBenefits !== currentExpectedBenefits) payload.expected_benefits = nextExpectedBenefits || undefined;
      if (nextSolutionApproach !== currentSolutionApproach) payload.solution_approach = nextSolutionApproach || undefined;

      if (Object.keys(payload).length > 1) {
        await useCaseApi.updateUseCase(id, payload);
      }
      handleUseCaseSaved({
        title: editTitle.trim(),
        description: editDescription.trim(),
        problemStatement: editProblemStatement.trim(),
        expectedBenefits: editExpectedBenefits.trim(),
        priority: editPriority,
        solutionApproach: editSolutionApproach.trim(),
        owner: editOwner.trim(),
      });
      setIsEditing(false);
    } catch (err: any) {
      setEditError(err.message || 'Failed to update use case.');
    } finally {
      setEditSaving(false);
    }
  };

  const handleStartInlineEdit = (field: string, value: string) => {
    setInlineEdit({ field, value });
  };

  const handleCancelInlineEdit = () => setInlineEdit(null);

  const handleSaveInlineEdit = async () => {
    if (!inlineEdit || !id) return;
    const { field, value } = inlineEdit;
    setInlineSaving(field);
    try {
      const payload: any = {
        __activityName: (useCase as any)?.name ?? (useCase as any)?.title ?? id,
      };
      if (field === 'title') payload.title = value.trim();
      else if (field === 'description') payload.description = value.trim();
      else if (field === 'priority') payload.priority = value;
      else if (field === 'owner') payload.use_case_owner = value.trim();
      else if (field === 'problem_statement') payload.business_problem_statement = value.trim();
      else if (field === 'expected_benefits') payload.expected_benefits = value.trim();
      else if (field === 'solution_approach') payload.solution_approach = value.trim();
      else if (field === 'assumptions') payload.assumptions = value.trim();
      else if (field === 'quantified_financial_benefits') payload.quantified_financial_benefits = value.trim();
      else if (field === 'total_financial_impact_summary') payload.total_financial_impact_summary = value.trim();
      else if (field === 'implementation_cost_estimate') payload.implementation_cost_estimate = value.trim();
      else if (field === 'return_on_investment') payload.return_on_investment = value.trim();
      else if (field === 'risk_considerations') payload.risk_considerations = value.trim();
      else if (field === 'implementation_roadmap') payload.implementation_roadmap = value.trim();
      else if (field === 'recommendation') payload.recommendation = value.trim();
      await useCaseApi.updateUseCase(id, payload);
      setUseCase(prev => {
        if (!prev) return prev;
        const next = { ...prev } as any;
        if (field === 'title') { next.name = value.trim(); next.title = value.trim(); }
        else if (field === 'description') next.description = value.trim();
        else if (field === 'priority') next.priority = value;
        else if (field === 'owner') { next.owner = value.trim(); next.use_case_owner = value.trim(); }
        else if (field === 'problem_statement') { next.problem_statement = value.trim(); next.business_problem_statement = value.trim(); }
        else if (field === 'expected_benefits') next.expected_benefits = value.trim();
        else if (field === 'solution_approach') next.solution_approach = value.trim();
        else if (field === 'assumptions') next.assumptions = value.trim();
        else if (field === 'quantified_financial_benefits') next.quantified_financial_benefits = value.trim();
        else if (field === 'total_financial_impact_summary') next.total_financial_impact_summary = value.trim();
        else if (field === 'implementation_cost_estimate') next.implementation_cost_estimate = value.trim();
        else if (field === 'return_on_investment') next.return_on_investment = value.trim();
        else if (field === 'risk_considerations') next.risk_considerations = value.trim();
        else if (field === 'implementation_roadmap') next.implementation_roadmap = value.trim();
        else if (field === 'recommendation') next.recommendation = value.trim();
        return next as UseCaseDetail;
      });
      setInlineEdit(null);
      refreshUseCases();
    } catch (err: any) {
      console.error('Failed to save inline edit:', err);
    } finally {
      setInlineSaving(null);
    }
  };

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
    fetchUseCaseSilently();
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
    <div className="flex flex-col gap-6 w-full animate-fade-in max-w-[1400px] mx-auto pb-12">
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
            {isEditing ? (
              <>
                {editError && <span className="text-xs text-red-500 font-medium">{editError}</span>}
                <button
                  onClick={handleCancelEdit}
                  disabled={editSaving}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-all shadow-sm disabled:opacity-50"
                >
                  Discard
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={editSaving || !editTitle.trim() || !editDescription.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {editSaving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Save'}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setJsonOpen(true)}
                  title="AI Use Case Card"
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-slate-800 text-slate-100 hover:bg-slate-700 transition-all border border-slate-700 shadow-sm"
                >
                  <Code2 size={14} /> AI Use Case Card
                </button>
                <button
                  onClick={handleStartEdit}
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
              </>
            )}
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
          businessImpactComponent={
            <div className="flex flex-col gap-6">
              <ApplicationRelationsSection useCase={useCase} onSilentRefetch={fetchUseCaseSilently} companyId={activeCompany?.id} />
              <ProcessRelationsSection useCase={useCase} onSilentRefetch={fetchUseCaseSilently} companyId={activeCompany?.id} />
              <AiModelRelationsSection useCase={useCase} onSilentRefetch={fetchUseCaseSilently} companyId={activeCompany?.id} />
            </div>
          }
          isEditing={isEditing}
          editTitle={editTitle}
          onEditTitleChange={setEditTitle}
          editDescription={editDescription}
          onEditDescriptionChange={setEditDescription}
          editPriority={editPriority}
          onEditPriorityChange={setEditPriority}
          editOwner={editOwner}
          onEditOwnerChange={setEditOwner}
          editProblemStatement={editProblemStatement}
          onEditProblemStatementChange={setEditProblemStatement}
          editExpectedBenefits={editExpectedBenefits}
          onEditExpectedBenefitsChange={setEditExpectedBenefits}
          editSolutionApproach={editSolutionApproach}
          onEditSolutionApproachChange={setEditSolutionApproach}
          inlineEdit={inlineEdit}
          inlineSaving={inlineSaving}
          onStartInlineEdit={handleStartInlineEdit}
          onInlineValueChange={(v) => setInlineEdit(prev => prev ? { ...prev, value: v } : null)}
          onSaveInlineEdit={handleSaveInlineEdit}
          onCancelInlineEdit={handleCancelInlineEdit}
        />
      )}


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
