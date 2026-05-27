import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AgentData } from '../types/agent';
import {
  AppWindow,
  BriefcaseBusiness,
  CheckCircle2,
  Link2,
  Loader2,
  Plus,
  PlusCircle,
  Search,
  ShieldAlert,
  Unlink2,
  Workflow,
} from 'lucide-react';
import { businessRelationsApi } from '../services/businessRelationsApi';
import { useCaseApi } from '../services/useCaseApi';
import { useUseCases } from '../context/UseCaseContext';
import type {
  AgentRelationsPayload,
  BusinessApplicationRecord,
  BusinessProcessRecord,
} from '../types/businessRelations';
import type { UseCaseSummary } from '../types/useCase';

interface AgentRelatedTabProps {
  agent: AgentData;
  mode?: 'applications' | 'processes' | 'use_cases' | 'all';
  onCountsChange?: (counts: { applications: number; processes: number; useCases?: number }) => void;
  onBusinessImpactChange?: (snapshot: AgentBusinessImpactSnapshot) => void;
  embedded?: boolean;
}

export interface AgentBusinessImpactSnapshot {
  applications: AgentData['application'];
  processes: AgentData['business_process'];
  useCases: NonNullable<AgentData['ai_use_cases']>;
}

const hasNonBlankText = (value: unknown): boolean =>
  typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;

const isLinkedApplicationLike = (app: any): boolean =>
  hasNonBlankText(app?.business_application_id ?? app?.identifier ?? app?.name ?? app?.application_name);

const isLinkedProcessLike = (proc: any): boolean =>
  hasNonBlankText(proc?.business_process_id ?? proc?.identifier ?? proc?.name ?? proc?.process_name);

const toApplicationImpact = (app: any): AgentData['application'][number] => ({
  identifier: app.business_application_id ?? app.identifier ?? app.name ?? null,
  name: app.application_name ?? app.name ?? app.business_application_id ?? null,
  description: app.application_description ?? app.description ?? null,
  business_criticality: app.business_criticality ?? null,
  emergency_tier: app.emergency_tier ?? null,
});

const toProcessImpact = (proc: any): AgentData['business_process'][number] => ({
  identifier: proc.business_process_id ?? proc.identifier ?? proc.name ?? '',
  name: proc.process_name ?? proc.name ?? proc.business_process_id ?? '',
  description: proc.process_description ?? proc.description ?? null,
  business_criticality: proc.business_criticality ?? '',
});

const toUseCaseImpact = (uc: UseCaseSummary): NonNullable<AgentData['ai_use_cases']>[number] => ({
  identifier: uc.identifier,
  name: uc.name ?? null,
  description: uc.description ?? null,
  owner: uc.owner ?? null,
  function: uc.function ?? (uc as any).business_function ?? null,
  problem_statement: uc.problem_statement ?? null,
  expected_benefits: uc.expected_benefits ?? null,
  priority: uc.priority ?? null,
  status: uc.status ?? null,
  proposed_by: uc.proposed_by ?? null,
});

const normalizeLinkedUseCasesFromAgent = (agent: AgentData): UseCaseSummary[] => {
  const rawLinked = (agent as any).ai_use_cases;
  if (Array.isArray(rawLinked)) {
    return rawLinked
      .filter(Boolean)
      .map((u: any) => ({
        identifier: u.identifier ?? u.use_case_id ?? u.id ?? '',
        name: u.name ?? u.title ?? 'Unnamed Use Case',
        description: u.description ?? null,
        owner: u.owner ?? u.use_case_owner ?? null,
        priority: u.priority ?? null,
        status: u.status ?? null,
        function: u.function ?? u.business_function ?? null,
        problem_statement: u.problem_statement ?? null,
        expected_benefits: u.expected_benefits ?? null,
        proposed_by: u.proposed_by ?? null,
      }))
      .filter((u: UseCaseSummary) => !!u.identifier);
  }
  const fallback = (agent as any).ai_use_case;
  const fallbackArr = Array.isArray(fallback) ? fallback : (fallback ? [fallback] : []);
  if (fallbackArr.length) {
    return fallbackArr
      .filter((u: any) => hasNonBlankText(u?.identifier ?? u?.use_case_id ?? u?.id))
      .map((u: any) => ({
        identifier: u.identifier ?? u.use_case_id ?? u.id ?? '',
        name: u.name ?? u.title ?? 'Unnamed Use Case',
        description: u.description ?? null,
        owner: u.owner ?? u.use_case_owner ?? null,
        priority: u.priority ?? null,
        status: u.status ?? null,
        function: u.function ?? u.business_function ?? null,
        problem_statement: u.problem_statement ?? null,
        expected_benefits: u.expected_benefits ?? null,
        proposed_by: u.proposed_by ?? null,
      }));
  }
  return [];
};

const normalizeLinkedUseCasesFromRelations = (relations: AgentRelationsPayload | null | undefined): UseCaseSummary[] => {
  const rawLinked = relations?.ai_use_cases;
  if (!Array.isArray(rawLinked)) return [];

  const seen = new Set<string>();
  return rawLinked
    .filter(Boolean)
    .map((u: any) => ({
      identifier: u.identifier ?? u.ai_use_case_id ?? u.use_case_id ?? u.id ?? '',
      name: u.name ?? u.title ?? 'Unnamed Use Case',
      description: u.description ?? null,
      owner: u.owner ?? u.use_case_owner ?? null,
      priority: u.priority ?? null,
      status: u.status ?? null,
      function: u.function ?? u.business_function ?? null,
      problem_statement: u.problem_statement ?? null,
      expected_benefits: u.expected_benefits ?? null,
      proposed_by: u.proposed_by ?? null,
    }))
    .filter((u: UseCaseSummary) => {
      const normalizedId = (u.identifier ?? '').trim();
      if (!normalizedId || seen.has(normalizedId)) return false;
      seen.add(normalizedId);
      return true;
    });
};

const useCaseSignature = (useCases: UseCaseSummary[]): string =>
  JSON.stringify(
    [...useCases]
      .sort((a, b) => (a.identifier ?? '').localeCompare(b.identifier ?? ''))
      .map((uc) => ({
        identifier: uc.identifier ?? '',
        name: uc.name ?? '',
        status: uc.status ?? '',
        priority: uc.priority ?? '',
      })),
  );

const getRiskBadge = (level: string | null | undefined) => {
  const normalized = (level ?? '').toLowerCase();
  if (normalized.includes('critical') || normalized.includes('high')) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-red-50 text-red-700 border border-red-200">
        <ShieldAlert size={13} /> {level}
      </span>
    );
  }
  if (normalized.includes('medium')) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
        <ShieldAlert size={13} /> {level}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
      <CheckCircle2 size={13} /> {level || 'Low'}
    </span>
  );
};

const AgentRelatedTab: React.FC<AgentRelatedTabProps> = ({
  agent,
  mode = 'all',
  onCountsChange,
  onBusinessImpactChange,
  embedded = false,
}) => {
  const agentId = agent.identification?.agent_id;
  const showApplications = mode !== 'processes' && mode !== 'use_cases';
  const showProcesses = mode !== 'applications' && mode !== 'use_cases';
  const showUseCases = mode !== 'applications' && mode !== 'processes';
  const title =
    mode === 'applications'
      ? 'Applications'
      : mode === 'processes'
        ? 'Processes'
        : 'Related Assets';
  const subtitle =
    mode === 'applications'
      ? 'Manage application links'
      : mode === 'processes'
        ? 'Manage process links'
        : 'Manage application, process, and AI use case links';
  const [relations, setRelations] = useState<AgentRelationsPayload | null>(null);
  const [allApplications, setAllApplications] = useState<BusinessApplicationRecord[]>([]);
  const [allProcesses, setAllProcesses] = useState<BusinessProcessRecord[]>([]);
  const [loadingRelations, setLoadingRelations] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [applicationSearch, setApplicationSearch] = useState('');
  const [processSearch, setProcessSearch] = useState('');
  const [useCaseSearch, setUseCaseSearch] = useState('');
  const [linkedUseCases, setLinkedUseCases] = useState<UseCaseSummary[]>(
    () => normalizeLinkedUseCasesFromAgent(agent),
  );
  const lastBusinessImpactSignatureRef = useRef<string>('');
  const { useCases: allUseCases } = useUseCases();
  const fallbackApplicationCount = useMemo(
    () => (agent.application ?? []).filter(isLinkedApplicationLike).length,
    [agent.application],
  );
  const fallbackProcessCount = useMemo(
    () => (agent.business_process ?? []).filter(isLinkedProcessLike).length,
    [agent.business_process],
  );
  const createApplicationHref = agentId
    ? `/applications/new?linkAgentId=${encodeURIComponent(agentId)}`
    : '/applications/new';
  const createProcessHref = agentId
    ? `/processes/new?linkAgentId=${encodeURIComponent(agentId)}`
    : '/processes/new';
  const createUseCaseHref = agentId
    ? `/use-cases/new?linkAgentId=${encodeURIComponent(agentId)}`
    : '/use-cases/new';

  useEffect(() => {
    setLinkedUseCases(normalizeLinkedUseCasesFromAgent(agent));
  }, [agent]);

  const refreshRelations = async () => {
    if (!agentId) {
      setRelations(null);
      onCountsChange?.({
        applications: fallbackApplicationCount,
        processes: fallbackProcessCount,
        useCases: linkedUseCases.length,
      });
      return;
    }
    setLoadingRelations(true);
    try {
      const [agentRelations, appCatalog, processCatalog] = await Promise.all([
        businessRelationsApi.getAgentRelations(agentId),
        showApplications ? businessRelationsApi.listApplications() : Promise.resolve([] as BusinessApplicationRecord[]),
        showProcesses ? businessRelationsApi.listProcesses() : Promise.resolve([] as BusinessProcessRecord[]),
      ]);
      setRelations(agentRelations);
      setAllApplications(appCatalog);
      setAllProcesses(processCatalog);

      const relationUseCases = normalizeLinkedUseCasesFromRelations(agentRelations);
      if (Array.isArray(agentRelations.ai_use_cases)) {
        setLinkedUseCases((prev) =>
          useCaseSignature(prev) === useCaseSignature(relationUseCases) ? prev : relationUseCases,
        );
      }

      const useCaseCount = Array.isArray(agentRelations.ai_use_cases)
        ? relationUseCases.length
        : linkedUseCases.length;
      onCountsChange?.({
        applications: agentRelations.applications.filter(isLinkedApplicationLike).length,
        processes: agentRelations.business_processes.filter(isLinkedProcessLike).length,
        useCases: useCaseCount,
      });
    } catch {
      onCountsChange?.({
        applications: fallbackApplicationCount,
        processes: fallbackProcessCount,
        useCases: linkedUseCases.length,
      });
    } finally {
      setLoadingRelations(false);
    }
  };

  useEffect(() => {
    refreshRelations();
  }, [agentId, showApplications, showProcesses]);

  const liveApplications = relations?.applications ?? [];
  const liveProcesses = relations?.business_processes ?? [];
  const showingLiveData = !!relations;

  const displayedApplications = useMemo(
    () =>
      showingLiveData
        ? liveApplications.filter(isLinkedApplicationLike)
        : (agent.application ?? []).map(app => ({
            business_application_id: app.identifier ?? app.name ?? 'N/A',
            application_name: app.name,
            application_description: app.description,
            business_criticality: app.business_criticality,
            emergency_tier: app.emergency_tier,
          })).filter(isLinkedApplicationLike),
    [showingLiveData, liveApplications, agent.application],
  );

  const displayedProcesses = useMemo(
    () =>
      showingLiveData
        ? liveProcesses.filter(isLinkedProcessLike)
        : (agent.business_process ?? []).map(proc => ({
            business_process_id: proc.identifier,
            process_name: proc.name,
            process_description: proc.description,
            business_criticality: proc.business_criticality,
            related_processes: [],
          })).filter(isLinkedProcessLike),
    [showingLiveData, liveProcesses, agent.business_process],
  );

  useEffect(() => {
    if (!onBusinessImpactChange) return;
    const snapshot: AgentBusinessImpactSnapshot = {
      applications: displayedApplications.map(toApplicationImpact),
      processes: displayedProcesses.map(toProcessImpact),
      useCases: linkedUseCases.map(toUseCaseImpact),
    };
    const signature = JSON.stringify(snapshot);
    if (signature === lastBusinessImpactSignatureRef.current) return;
    lastBusinessImpactSignatureRef.current = signature;
    onBusinessImpactChange(snapshot);
  }, [displayedApplications, displayedProcesses, linkedUseCases, onBusinessImpactChange]);

  const linkedApplicationIds = useMemo(() => {
    return new Set(
      liveApplications
        .map((app) => app.business_application_id)
        .filter((value) => hasNonBlankText(value)),
    );
  }, [liveApplications]);

  const linkedProcessIds = useMemo(() => {
    return new Set(
      liveProcesses
        .map((proc) => proc.business_process_id)
        .filter((value) => hasNonBlankText(value)),
    );
  }, [liveProcesses]);

  const availableApplications = useMemo(() => {
    const q = applicationSearch.trim().toLowerCase();
    return allApplications.filter(app => {
      if (linkedApplicationIds.has(app.business_application_id)) return false;
      if (!q) return true;
      return (
        app.business_application_id.toLowerCase().includes(q) ||
        (app.application_name ?? '').toLowerCase().includes(q) ||
        (app.application_description ?? '').toLowerCase().includes(q)
      );
    });
  }, [allApplications, applicationSearch, linkedApplicationIds]);

  const availableProcesses = useMemo(() => {
    const q = processSearch.trim().toLowerCase();
    return allProcesses.filter(proc => {
      if (linkedProcessIds.has(proc.business_process_id)) return false;
      if (!q) return true;
      return (
        proc.business_process_id.toLowerCase().includes(q) ||
        (proc.process_name ?? '').toLowerCase().includes(q) ||
        (proc.process_description ?? '').toLowerCase().includes(q)
      );
    });
  }, [allProcesses, processSearch, linkedProcessIds]);

  const linkedUseCaseIds = useMemo(() => {
    return new Set(linkedUseCases.map(uc => uc.identifier).filter(Boolean));
  }, [linkedUseCases]);

  const availableUseCases = useMemo(() => {
    const q = useCaseSearch.trim().toLowerCase();
    return allUseCases.filter(uc => {
      const id = uc.identifier ?? '';
      if (!id || linkedUseCaseIds.has(id)) return false;
      if (!q) return true;
      return (
        id.toLowerCase().includes(q) ||
        (uc.name ?? '').toLowerCase().includes(q) ||
        (uc.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [allUseCases, useCaseSearch, linkedUseCaseIds]);

  const handleAddApplication = async (businessApplicationId: string) => {
    if (!agentId) return;
    const key = `add-app:${businessApplicationId}`;
    setActingKey(key);
    setActionError(null);
    try {
      await businessRelationsApi.linkAgentToApplication(agentId, businessApplicationId);
      await refreshRelations();
    } catch (err: any) {
      setActionError(err.message || 'Failed to link application.');
    } finally {
      setActingKey(null);
    }
  };

  const handleRemoveApplication = async (businessApplicationId: string) => {
    if (!agentId) return;
    const key = `remove-app:${businessApplicationId}`;
    setActingKey(key);
    setActionError(null);
    try {
      await businessRelationsApi.unlinkAgentFromApplication(agentId, businessApplicationId);
      await refreshRelations();
    } catch (err: any) {
      setActionError(err.message || 'Failed to unlink application.');
    } finally {
      setActingKey(null);
    }
  };

  const handleAddProcess = async (businessProcessId: string) => {
    if (!agentId) return;
    const key = `add-proc:${businessProcessId}`;
    setActingKey(key);
    setActionError(null);
    try {
      await businessRelationsApi.linkAgentToProcess(agentId, businessProcessId);
      await refreshRelations();
    } catch (err: any) {
      setActionError(err.message || 'Failed to link process.');
    } finally {
      setActingKey(null);
    }
  };

  const handleRemoveProcess = async (businessProcessId: string) => {
    if (!agentId) return;
    const key = `remove-proc:${businessProcessId}`;
    setActingKey(key);
    setActionError(null);
    try {
      await businessRelationsApi.unlinkAgentFromProcess(agentId, businessProcessId);
      await refreshRelations();
    } catch (err: any) {
      setActionError(err.message || 'Failed to unlink process.');
    } finally {
      setActingKey(null);
    }
  };

  const handleLinkUseCase = async (useCaseId: string) => {
    if (!agentId) return;
    const key = `add-uc:${useCaseId}`;
    setActingKey(key);
    setActionError(null);
    try {
      await useCaseApi.linkAgent(useCaseId, agentId);
      const linked = allUseCases.find(uc => uc.identifier === useCaseId);
      if (linked) {
        setLinkedUseCases(prev => (
          prev.some((uc) => uc.identifier === linked.identifier) ? prev : [...prev, linked]
        ));
      }
      await refreshRelations();
    } catch (err: any) {
      setActionError(err.message || 'Failed to link AI use case.');
    } finally {
      setActingKey(null);
    }
  };

  const handleUnlinkUseCase = async (useCaseId: string) => {
    if (!agentId) return;
    const key = `remove-uc:${useCaseId}`;
    setActingKey(key);
    setActionError(null);
    try {
      await useCaseApi.unlinkAgent(useCaseId, agentId);
      setLinkedUseCases(prev => prev.filter(uc => uc.identifier !== useCaseId));
      await refreshRelations();
    } catch (err: any) {
      setActionError(err.message || 'Failed to unlink AI use case.');
    } finally {
      setActingKey(null);
    }
  };

  const content = (
      <div className={`${embedded ? '' : 'p-5'} flex flex-col gap-6 ${embedded ? '' : 'flex-1 overflow-y-auto'}`}>
        {embedded && loadingRelations && (
          <div className="inline-flex items-center gap-2 text-xs text-blue-600">
            <Loader2 size={13} className="animate-spin" />
            Syncing...
          </div>
        )}
        {actionError && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {actionError}
          </div>
        )}

        {showApplications && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <AppWindow size={13} /> Applications ({displayedApplications.length})
              </h3>
              {agentId && (
                <Link
                  to={createApplicationHref}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700"
                >
                  <Plus size={11} />
                  New Application
                </Link>
              )}
            </div>
            <div className="flex flex-col gap-3">
              {displayedApplications.map((app: any, idx) => {
                const applicationId = app.business_application_id || app.identifier || app.name || `app-${idx}`;
                const removeKey = `remove-app:${applicationId}`;
                return (
                  <div key={`${applicationId}-${idx}`} className="flex flex-col p-4 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors">
                    <div className="flex justify-between items-start gap-3 mb-2">
                      <div>
                        <Link
                          to={`/applications/${encodeURIComponent(applicationId)}`}
                          className="font-bold text-sm text-blue-700 hover:underline"
                        >
                          {app.application_name || app.name || applicationId}
                        </Link>
                        <span className="block text-[11px] font-mono text-slate-400 mt-0.5">
                          {applicationId}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {getRiskBadge(app.business_criticality)}
                        {showingLiveData && (
                          <button
                            onClick={() => handleRemoveApplication(applicationId)}
                            disabled={actingKey === removeKey}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {actingKey === removeKey ? <Loader2 size={11} className="animate-spin" /> : <Unlink2 size={11} />}
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                    {(app.application_description || app.description) && (
                      <p className="text-xs text-slate-600 leading-relaxed">{app.application_description || app.description}</p>
                    )}
                  </div>
                );
              })}
              {displayedApplications.length === 0 && (
                <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  No related applications.
                </div>
              )}
            </div>

            {showingLiveData && (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                    <Link2 size={12} /> Add Application Relation
                  </p>
                  <div className="relative w-full max-w-sm">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={applicationSearch}
                      onChange={(e) => setApplicationSearch(e.target.value)}
                      placeholder="Filter applications..."
                      className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>
                </div>
                <div className="max-h-[250px] overflow-y-auto divide-y divide-slate-100">
                  {availableApplications.length === 0 && (
                    <div className="p-3 text-xs text-slate-500">No available applications to link.</div>
                  )}
                  {availableApplications.map(app => {
                    const addKey = `add-app:${app.business_application_id}`;
                    return (
                      <div key={app.business_application_id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-700 truncate">
                            {app.application_name || app.business_application_id}
                          </p>
                          <p className="text-[11px] font-mono text-slate-400 truncate">{app.business_application_id}</p>
                        </div>
                        <button
                          onClick={() => handleAddApplication(app.business_application_id)}
                          disabled={actingKey === addKey}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {actingKey === addKey ? <Loader2 size={11} className="animate-spin" /> : <PlusCircle size={11} />}
                          Link
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {showApplications && showProcesses && <div className="h-px bg-slate-100 w-full" />}

        {showProcesses && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <BriefcaseBusiness size={13} /> Processes ({displayedProcesses.length})
              </h3>
              {agentId && (
                <Link
                  to={createProcessHref}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700"
                >
                  <Plus size={11} />
                  New Process
                </Link>
              )}
            </div>
            <div className="flex flex-col gap-3">
              {displayedProcesses.map((proc: any, idx) => {
                const processId = proc.business_process_id || proc.identifier || proc.name || `process-${idx}`;
                const removeKey = `remove-proc:${processId}`;
                return (
                  <div key={`${processId}-${idx}`} className="flex flex-col p-4 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link
                          to={`/processes/${encodeURIComponent(processId)}`}
                          className="font-bold text-sm text-blue-700 hover:underline"
                        >
                          {proc.process_name || proc.name || processId}
                        </Link>
                        <span className="block text-[11px] font-mono text-slate-400 mt-0.5">
                          {processId}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {getRiskBadge(proc.business_criticality)}
                        {showingLiveData && (
                          <button
                            onClick={() => handleRemoveProcess(processId)}
                            disabled={actingKey === removeKey}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {actingKey === removeKey ? <Loader2 size={11} className="animate-spin" /> : <Unlink2 size={11} />}
                            Remove
                          </button>
                        )}
                      </div>
                    </div>

                    {(proc.process_description || proc.description) && (
                      <span className="block text-xs text-slate-500 mt-0.5 max-w-[640px]">
                        {proc.process_description || proc.description}
                      </span>
                    )}

                    {showingLiveData && proc.related_processes && proc.related_processes.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {proc.related_processes.map((related: any) => (
                          <Link
                            key={`${processId}-${related.business_process_id}-${related.relationship_type || 'RELATED'}`}
                            to={`/processes/${encodeURIComponent(related.business_process_id)}`}
                            className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5 inline-flex items-center gap-1"
                          >
                            <Workflow size={10} />
                            {related.process_name || related.business_process_id}
                            <span className="font-semibold">({related.relationship_type || 'RELATED'})</span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {displayedProcesses.length === 0 && (
                <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  No related processes.
                </div>
              )}
            </div>

            {showingLiveData && (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                    <Link2 size={12} /> Add Process Relation
                  </p>
                  <div className="relative w-full max-w-sm">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={processSearch}
                      onChange={(e) => setProcessSearch(e.target.value)}
                      placeholder="Filter processes..."
                      className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>
                </div>
                <div className="max-h-[250px] overflow-y-auto divide-y divide-slate-100">
                  {availableProcesses.length === 0 && (
                    <div className="p-3 text-xs text-slate-500">No available processes to link.</div>
                  )}
                  {availableProcesses.map(proc => {
                    const addKey = `add-proc:${proc.business_process_id}`;
                    return (
                      <div key={proc.business_process_id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-700 truncate">
                            {proc.process_name || proc.business_process_id}
                          </p>
                          <p className="text-[11px] font-mono text-slate-400 truncate">{proc.business_process_id}</p>
                        </div>
                        <button
                          onClick={() => handleAddProcess(proc.business_process_id)}
                          disabled={actingKey === addKey}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {actingKey === addKey ? <Loader2 size={11} className="animate-spin" /> : <PlusCircle size={11} />}
                          Link
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {showUseCases && (
          <div className={`flex flex-col gap-3 ${mode === 'all' ? 'order-first' : ''}`}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <BriefcaseBusiness size={13} /> AI Use Cases ({linkedUseCases.length})
              </h3>
              {agentId && (
                <Link
                  to={createUseCaseHref}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700"
                >
                  <Plus size={11} />
                  New Use Case
                </Link>
              )}
            </div>

            <div className="flex flex-col gap-3">
              {linkedUseCases.map((uc, idx) => {
                const useCaseId = uc.identifier || `use-case-${idx}`;
                const removeKey = `remove-uc:${useCaseId}`;
                return (
                  <div key={`${useCaseId}-${idx}`} className="flex flex-col p-4 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors">
                    <div className="flex justify-between items-start gap-3 mb-2">
                      <div>
                        <Link
                          to={`/use-case/${encodeURIComponent(useCaseId)}`}
                          className="font-bold text-sm text-blue-700 hover:underline"
                        >
                          {uc.name || useCaseId}
                        </Link>
                        <span className="block text-[11px] font-mono text-slate-400 mt-0.5">{useCaseId}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {uc.priority && getRiskBadge(uc.priority)}
                        <button
                          onClick={() => handleUnlinkUseCase(useCaseId)}
                          disabled={actingKey === removeKey}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {actingKey === removeKey ? <Loader2 size={11} className="animate-spin" /> : <Unlink2 size={11} />}
                          Remove
                        </button>
                      </div>
                    </div>
                    {uc.description && (
                      <p className="text-xs text-slate-600 leading-relaxed">{uc.description}</p>
                    )}
                  </div>
                );
              })}
              {linkedUseCases.length === 0 && (
                <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  No linked AI use cases.
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                  <Link2 size={12} /> Add AI Use Case Relation
                </p>
                <div className="relative w-full max-w-sm">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={useCaseSearch}
                    onChange={(e) => setUseCaseSearch(e.target.value)}
                    placeholder="Filter use cases..."
                    className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>
              <div className="max-h-[250px] overflow-y-auto divide-y divide-slate-100">
                {availableUseCases.length === 0 && (
                  <div className="p-3 text-xs text-slate-500">No available AI use cases to link.</div>
                )}
                {availableUseCases.map(uc => {
                  const addKey = `add-uc:${uc.identifier}`;
                  return (
                    <div key={uc.identifier} className="px-4 py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-700 truncate">{uc.name || uc.identifier}</p>
                        <p className="text-[11px] font-mono text-slate-400 truncate">{uc.identifier}</p>
                      </div>
                      <button
                        onClick={() => handleLinkUseCase(uc.identifier)}
                        disabled={actingKey === addKey}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {actingKey === addKey ? <Loader2 size={11} className="animate-spin" /> : <PlusCircle size={11} />}
                        Link
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden flex flex-col h-full">
      <div className="p-5 border-b border-slate-100 flex items-center gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800 tracking-tight">{title}</h2>
          <p className="text-xs text-slate-500 font-medium">{subtitle}</p>
        </div>
        {loadingRelations && (
          <div className="ml-auto inline-flex items-center gap-2 text-xs text-blue-600">
            <Loader2 size={13} className="animate-spin" />
            Syncing...
          </div>
        )}
      </div>
      {content}
    </div>
  );
};

export default AgentRelatedTab;
