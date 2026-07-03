import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toUserMessage } from '../utils/errorUtils';
import { Link } from 'react-router-dom';
import { AgentData } from '../types/agent';
import {
  AppWindow,
  Bot,
  Boxes,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
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
import { aiModelApi } from '../services/aiModelApi';
import { agentApi } from '../services/agentApi';
import { useUseCases } from '../context/UseCaseContext';
import { useCatalog } from '../context/CatalogContext';
import { useBlueprint } from '../context/BlueprintContext';
import type {
  AgentRelationsPayload,
  BusinessApplicationRecord,
  BusinessProcessRecord,
  ChildAgentReference,
  IntegrationRecord,
} from '../types/businessRelations';
import type { UseCaseSummary } from '../types/useCase';
import type { AiModelRecord } from '../types/aiModel';

interface AgentRelatedTabProps {
  agent: AgentData;
  mode?: 'applications' | 'processes' | 'use_cases' | 'child_agents' | 'ai_models' | 'integrations' | 'all';
  onCountsChange?: (counts: { applications: number; processes: number; useCases?: number; childAgents?: number; aiModels?: number; integrations?: number }) => void;
  onBusinessImpactChange?: (snapshot: AgentBusinessImpactSnapshot) => void;
  embedded?: boolean;
}

export interface AgentBusinessImpactSnapshot {
  applications: AgentData['application'];
  processes: AgentData['business_process'];
  useCases: NonNullable<AgentData['ai_use_cases']>;
  childAgents?: ChildAgentReference[];
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
  const showApplications = mode === 'all' || mode === 'applications';
  const showProcesses = mode === 'all' || mode === 'processes';
  const showUseCases = mode === 'all' || mode === 'use_cases';
  const showChildAgents = mode === 'all' || mode === 'child_agents';
  const showAiModels = mode === 'all' || mode === 'ai_models';
  const showIntegrations = mode === 'all' || mode === 'integrations';
  const title =
    mode === 'applications'
      ? 'Applications'
      : mode === 'processes'
        ? 'Processes'
        : mode === 'child_agents'
          ? 'Agent to Agent'
          : mode === 'ai_models'
            ? 'AI Models'
            : 'Related Assets';
  const subtitle =
    mode === 'applications'
      ? 'Manage application links'
      : mode === 'processes'
        ? 'Manage process links'
        : mode === 'child_agents'
          ? 'Manage agent to agent links'
          : 'Manage application, process, AI use case, and agent to agent links';
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
  const [childAgentSearch, setChildAgentSearch] = useState('');
  const [allAiModels, setAllAiModels] = useState<AiModelRecord[]>([]);
  const [aiModelSearch, setAiModelSearch] = useState('');
  const [allIntegrations, setAllIntegrations] = useState<IntegrationRecord[]>([]);
  const [integrationSearch, setIntegrationSearch] = useState('');
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const searchInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (openDropdown === null) return;
    const key = openDropdown;
    const id = window.setTimeout(() => searchInputRefs.current[key]?.focus(), 0);
    const handlePointerDown = (event: MouseEvent) => {
      const el = dropdownRefs.current[key];
      if (el && !el.contains(event.target as Node)) setOpenDropdown(null);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [openDropdown]);
  const lastBusinessImpactSignatureRef = useRef<string>('');
  const { useCases: allUseCases } = useUseCases();
  const { agents: catalogAgents } = useCatalog();
  const { activeCompany } = useBlueprint();
  const [allCompanyUseCases, setAllCompanyUseCases] = useState<UseCaseSummary[]>([]);
  const [allCompanyAgents, setAllCompanyAgents] = useState<typeof catalogAgents>([]);
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
  const createIntegrationHref = agentId
    ? `/integrations/new?linkAgentId=${encodeURIComponent(agentId)}`
    : '/integrations/new';

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
      const companyId = activeCompany?.id;
      const [agentRelations, appCatalog, processCatalog, modelCatalog, integrationCatalog, useCasePage, companyAgents] = await Promise.all([
        businessRelationsApi.getAgentRelations(agentId, companyId),
        showApplications ? businessRelationsApi.listApplications(undefined, companyId) : Promise.resolve([] as BusinessApplicationRecord[]),
        showProcesses ? businessRelationsApi.listProcesses(undefined, companyId) : Promise.resolve([] as BusinessProcessRecord[]),
        showAiModels ? aiModelApi.listModels(undefined, companyId) : Promise.resolve([] as AiModelRecord[]),
        showIntegrations ? businessRelationsApi.listIntegrations(undefined, companyId) : Promise.resolve([] as IntegrationRecord[]),
        showUseCases ? useCaseApi.listUseCases({ companyId, recordRange: '1-200' }) : Promise.resolve(null),
        showChildAgents ? agentApi.listAgentsForLinking(companyId) : Promise.resolve([] as typeof catalogAgents),
      ]);
      setRelations(agentRelations);
      setAllApplications(appCatalog);
      setAllProcesses(processCatalog);
      setAllAiModels(modelCatalog);
      setAllIntegrations(integrationCatalog);
      setAllCompanyAgents(companyAgents);
      if (useCasePage) {
        const mapped: UseCaseSummary[] = (useCasePage.data ?? []).map((raw: any) => ({
          identifier: raw.identifier ?? raw.use_case_id ?? raw.id ?? '',
          name: raw.name ?? raw.title ?? raw.use_case_name ?? '',
          description: raw.description ?? raw.short_description ?? null,
          status: raw.status ?? null,
          priority: raw.priority ?? null,
          overall_risk: raw.overall_risk ?? null,
        }));
        setAllCompanyUseCases(mapped);
      }

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
        childAgents: (agentRelations.child_agents ?? []).length,
        aiModels: (agentRelations.ai_models ?? []).length,
        integrations: (agentRelations.integrations ?? []).length,
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, showApplications, showProcesses, showAiModels, showIntegrations, showUseCases, activeCompany?.id]);

  const liveApplications = relations?.applications ?? [];
  const liveProcesses = relations?.business_processes ?? [];
  const liveChildAgents = relations?.child_agents ?? [];
  const liveAiModels = relations?.ai_models ?? [];
  const liveIntegrations = relations?.integrations ?? [];
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
      childAgents: liveChildAgents,
    };
    const signature = JSON.stringify(snapshot);
    if (signature === lastBusinessImpactSignatureRef.current) return;
    lastBusinessImpactSignatureRef.current = signature;
    onBusinessImpactChange(snapshot);
  }, [displayedApplications, displayedProcesses, linkedUseCases, liveChildAgents, onBusinessImpactChange]);

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

  const filteredCatalogApplications = useMemo(() => {
    const q = applicationSearch.trim().toLowerCase();
    if (!q) return allApplications;
    return allApplications.filter(app =>
      app.business_application_id.toLowerCase().includes(q) ||
      (app.application_name ?? '').toLowerCase().includes(q)
    );
  }, [allApplications, applicationSearch]);

  const filteredCatalogProcesses = useMemo(() => {
    const q = processSearch.trim().toLowerCase();
    if (!q) return allProcesses;
    return allProcesses.filter(proc =>
      proc.business_process_id.toLowerCase().includes(q) ||
      (proc.process_name ?? '').toLowerCase().includes(q)
    );
  }, [allProcesses, processSearch]);

  const linkedChildAgentIds = useMemo(() => {
    return new Set(
      liveChildAgents
        .map(ca => ca.agent_id ?? ca.agent_internal_id)
        .filter((v): v is string => !!v),
    );
  }, [liveChildAgents]);

  const filteredCatalogChildAgents = useMemo(() => {
    const q = childAgentSearch.trim().toLowerCase();
    const selfId = agentId ?? '';
    const source = allCompanyAgents.length > 0 ? allCompanyAgents : catalogAgents;
    return source.filter(a => {
      const id = a.identification?.agent_id ?? '';
      if (!id || id === selfId) return false;
      if (!q) return true;
      return id.toLowerCase().includes(q) || (a.name ?? '').toLowerCase().includes(q);
    });
  }, [allCompanyAgents, catalogAgents, childAgentSearch, agentId]);

  const linkedAiModelIds = useMemo(() => {
    return new Set(liveAiModels.map(m => m.ai_model_id).filter(Boolean));
  }, [liveAiModels]);

  const filteredCatalogAiModels = useMemo(() => {
    const q = aiModelSearch.trim().toLowerCase();
    if (!q) return allAiModels;
    return allAiModels.filter(m =>
      m.ai_model_id.toLowerCase().includes(q) ||
      (m.model_name ?? '').toLowerCase().includes(q)
    );
  }, [allAiModels, aiModelSearch]);

  const linkedIntegrationIds = useMemo(() => {
    return new Set(liveIntegrations.map(i => i.integration_id).filter(Boolean));
  }, [liveIntegrations]);

  const filteredCatalogIntegrations = useMemo(() => {
    const q = integrationSearch.trim().toLowerCase();
    if (!q) return allIntegrations;
    return allIntegrations.filter(i =>
      i.integration_id.toLowerCase().includes(q) ||
      (i.integration_name ?? '').toLowerCase().includes(q)
    );
  }, [allIntegrations, integrationSearch]);

  const linkedUseCaseIds = useMemo(() => {
    return new Set(linkedUseCases.map(uc => uc.identifier).filter(Boolean));
  }, [linkedUseCases]);

  const filteredCatalogUseCases = useMemo(() => {
    const q = useCaseSearch.trim().toLowerCase();
    const source = allCompanyUseCases.length > 0 ? allCompanyUseCases : allUseCases;
    if (!q) return source;
    return source.filter(uc => {
      const id = uc.identifier ?? '';
      return id.toLowerCase().includes(q) || (uc.name ?? '').toLowerCase().includes(q);
    });
  }, [allCompanyUseCases, allUseCases, useCaseSearch]);

  const handleAddApplication = async (businessApplicationId: string) => {
    if (!agentId) return;
    const key = `add-app:${businessApplicationId}`;
    setActingKey(key);
    setActionError(null);
    try {
      await businessRelationsApi.linkAgentToApplication(agentId, businessApplicationId, activeCompany?.id);
      await refreshRelations();
    } catch (err: any) {
      setActionError(toUserMessage(err));
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
      await businessRelationsApi.unlinkAgentFromApplication(agentId, businessApplicationId, activeCompany?.id);
      await refreshRelations();
    } catch (err: any) {
      setActionError(toUserMessage(err));
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
      await businessRelationsApi.linkAgentToProcess(agentId, businessProcessId, activeCompany?.id);
      await refreshRelations();
    } catch (err: any) {
      setActionError(toUserMessage(err));
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
      await businessRelationsApi.unlinkAgentFromProcess(agentId, businessProcessId, activeCompany?.id);
      await refreshRelations();
    } catch (err: any) {
      setActionError(toUserMessage(err));
    } finally {
      setActingKey(null);
    }
  };

  const handleAddChildAgent = async (childId: string) => {
    if (!agentId) return;
    const key = `add-child:${childId}`;
    setActingKey(key);
    setActionError(null);
    try {
      await businessRelationsApi.linkAgentToChildAgent(agentId, childId);
      await refreshRelations();
    } catch (err: any) {
      setActionError(toUserMessage(err));
    } finally {
      setActingKey(null);
    }
  };

  const handleRemoveChildAgent = async (childId: string) => {
    if (!agentId) return;
    const key = `remove-child:${childId}`;
    setActingKey(key);
    setActionError(null);
    try {
      await businessRelationsApi.unlinkAgentFromChildAgent(agentId, childId);
      await refreshRelations();
    } catch (err: any) {
      setActionError(toUserMessage(err));
    } finally {
      setActingKey(null);
    }
  };

  const handleAddAiModel = async (modelId: string) => {
    if (!agentId) return;
    const key = `add-model:${modelId}`;
    setActingKey(key);
    setActionError(null);
    try {
      await aiModelApi.linkAgent(modelId, agentId, activeCompany?.id);
      await refreshRelations();
    } catch (err: any) {
      setActionError(toUserMessage(err));
    } finally {
      setActingKey(null);
    }
  };

  const handleRemoveAiModel = async (modelId: string) => {
    if (!agentId) return;
    const key = `remove-model:${modelId}`;
    setActingKey(key);
    setActionError(null);
    try {
      await aiModelApi.unlinkAgent(modelId, agentId, activeCompany?.id);
      await refreshRelations();
    } catch (err: any) {
      setActionError(toUserMessage(err));
    } finally {
      setActingKey(null);
    }
  };

  const handleAddIntegration = async (integrationId: string) => {
    if (!agentId) return;
    const key = `add-integration:${integrationId}`;
    setActingKey(key);
    setActionError(null);
    try {
      await businessRelationsApi.linkAgentToIntegration(agentId, integrationId, activeCompany?.id);
      await refreshRelations();
    } catch (err: any) {
      setActionError(toUserMessage(err));
    } finally {
      setActingKey(null);
    }
  };

  const handleRemoveIntegration = async (integrationId: string) => {
    if (!agentId) return;
    const key = `remove-integration:${integrationId}`;
    setActingKey(key);
    setActionError(null);
    try {
      await businessRelationsApi.unlinkAgentFromIntegration(agentId, integrationId, activeCompany?.id);
      await refreshRelations();
    } catch (err: any) {
      setActionError(toUserMessage(err));
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
      setActionError(toUserMessage(err));
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
      setActionError(toUserMessage(err));
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
              {agentId && !showingLiveData && (
                <Link
                  to={createApplicationHref}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700"
                >
                  <Plus size={11} />
                  New Application
                </Link>
              )}
              {showingLiveData && (
                <div className="relative" ref={(el) => { dropdownRefs.current.applications = el; }}>
                  <button
                    onClick={() => setOpenDropdown(openDropdown === 'applications' ? null : 'applications')}
                    className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:border-blue-300 px-3 py-2 rounded-lg transition-colors"
                    aria-haspopup="listbox"
                    aria-expanded={openDropdown === 'applications'}
                  >
                    <PlusCircle size={13} className="text-blue-600" />
                    Add application
                    <ChevronDown size={13} className="text-slate-400" />
                  </button>
                  {openDropdown === 'applications' && (
                    <div className="absolute top-full right-0 mt-1 w-[300px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                      <div className="p-2 border-b border-slate-100">
                        <div className="relative">
                          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            ref={(el) => { searchInputRefs.current.applications = el; }}
                            value={applicationSearch}
                            onChange={(e) => setApplicationSearch(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setOpenDropdown(null); }}
                            placeholder="Search application..."
                            className="w-full pl-7 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
                          />
                        </div>
                      </div>
                      <div className="max-h-72 overflow-y-auto py-1" role="listbox">
                        {filteredCatalogApplications.length === 0 && (
                          <div className="px-4 py-6 text-center text-xs text-slate-400">No applications found</div>
                        )}
                        {filteredCatalogApplications.map((app) => {
                          const isLinked = linkedApplicationIds.has(app.business_application_id);
                          const addKey = `add-app:${app.business_application_id}`;
                          const removeKey = `remove-app:${app.business_application_id}`;
                          const busy = actingKey === addKey || actingKey === removeKey;
                          return (
                            <button
                              key={app.business_application_id}
                              type="button"
                              role="option"
                              aria-selected={isLinked}
                              disabled={busy}
                              onClick={() => (isLinked ? handleRemoveApplication(app.business_application_id) : handleAddApplication(app.business_application_id))}
                              className={`w-full flex items-center gap-2 text-left px-4 py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                isLinked ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block font-semibold truncate">{app.application_name || app.business_application_id}</span>
                                <span className="block text-[11px] font-mono text-slate-400 truncate">{app.business_application_id}</span>
                              </span>
                              {busy ? (
                                <Loader2 size={14} className="animate-spin shrink-0 text-slate-400" />
                              ) : isLinked ? (
                                <Check size={15} className="shrink-0 text-blue-600" />
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                      {agentId && (
                        <div className="border-t border-slate-100 mt-1 pt-1 px-2 pb-2">
                          <Link
                            to={createApplicationHref}
                            onClick={() => setOpenDropdown(null)}
                            className="flex items-center gap-2 w-full text-left px-2 py-2 text-[11px] font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <Plus size={11} /> Add application
                          </Link>
                        </div>
                      )}
                    </div>
                  )}
                </div>
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
          </div>
        )}

        {showApplications && (showProcesses || showChildAgents) && <div className="h-px bg-slate-100 w-full" />}

        {showProcesses && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <BriefcaseBusiness size={13} /> Processes ({displayedProcesses.length})
              </h3>
              {agentId && !showingLiveData && (
                <Link
                  to={createProcessHref}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700"
                >
                  <Plus size={11} />
                  New Process
                </Link>
              )}
              {showingLiveData && (
                <div className="relative" ref={(el) => { dropdownRefs.current.processes = el; }}>
                  <button
                    onClick={() => setOpenDropdown(openDropdown === 'processes' ? null : 'processes')}
                    className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:border-blue-300 px-3 py-2 rounded-lg transition-colors"
                    aria-haspopup="listbox"
                    aria-expanded={openDropdown === 'processes'}
                  >
                    <PlusCircle size={13} className="text-blue-600" />
                    Add process
                    <ChevronDown size={13} className="text-slate-400" />
                  </button>
                  {openDropdown === 'processes' && (
                    <div className="absolute top-full right-0 mt-1 w-[300px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                      <div className="p-2 border-b border-slate-100">
                        <div className="relative">
                          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            ref={(el) => { searchInputRefs.current.processes = el; }}
                            value={processSearch}
                            onChange={(e) => setProcessSearch(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setOpenDropdown(null); }}
                            placeholder="Search process..."
                            className="w-full pl-7 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
                          />
                        </div>
                      </div>
                      <div className="max-h-72 overflow-y-auto py-1" role="listbox">
                        {filteredCatalogProcesses.length === 0 && (
                          <div className="px-4 py-6 text-center text-xs text-slate-400">No processes found</div>
                        )}
                        {filteredCatalogProcesses.map((proc) => {
                          const isLinked = linkedProcessIds.has(proc.business_process_id);
                          const addKey = `add-proc:${proc.business_process_id}`;
                          const removeKey = `remove-proc:${proc.business_process_id}`;
                          const busy = actingKey === addKey || actingKey === removeKey;
                          return (
                            <button
                              key={proc.business_process_id}
                              type="button"
                              role="option"
                              aria-selected={isLinked}
                              disabled={busy}
                              onClick={() => (isLinked ? handleRemoveProcess(proc.business_process_id) : handleAddProcess(proc.business_process_id))}
                              className={`w-full flex items-center gap-2 text-left px-4 py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                isLinked ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block font-semibold truncate">{proc.process_name || proc.business_process_id}</span>
                                <span className="block text-[11px] font-mono text-slate-400 truncate">{proc.business_process_id}</span>
                              </span>
                              {busy ? (
                                <Loader2 size={14} className="animate-spin shrink-0 text-slate-400" />
                              ) : isLinked ? (
                                <Check size={15} className="shrink-0 text-blue-600" />
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                      {agentId && (
                        <div className="border-t border-slate-100 mt-1 pt-1 px-2 pb-2">
                          <Link
                            to={createProcessHref}
                            onClick={() => setOpenDropdown(null)}
                            className="flex items-center gap-2 w-full text-left px-2 py-2 text-[11px] font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <Plus size={11} /> Add process
                          </Link>
                        </div>
                      )}
                    </div>
                  )}
                </div>
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
          </div>
        )}

        {showProcesses && showChildAgents && <div className="h-px bg-slate-100 w-full" />}

        {showChildAgents && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Bot size={13} /> Agent to Agent ({liveChildAgents.length})
              </h3>
              <div className="relative" ref={(el) => { dropdownRefs.current.childAgents = el; }}>
                <button
                  onClick={() => setOpenDropdown(openDropdown === 'childAgents' ? null : 'childAgents')}
                  className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:border-blue-300 px-3 py-2 rounded-lg transition-colors"
                  aria-haspopup="listbox"
                  aria-expanded={openDropdown === 'childAgents'}
                >
                  <PlusCircle size={13} className="text-blue-600" />
                  Add agent
                  <ChevronDown size={13} className="text-slate-400" />
                </button>
                {openDropdown === 'childAgents' && (
                  <div className="absolute top-full right-0 mt-1 w-[300px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                    <div className="p-2 border-b border-slate-100">
                      <div className="relative">
                        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          ref={(el) => { searchInputRefs.current.childAgents = el; }}
                          value={childAgentSearch}
                          onChange={(e) => setChildAgentSearch(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Escape') setOpenDropdown(null); }}
                          placeholder="Search agent..."
                          className="w-full pl-7 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
                        />
                      </div>
                    </div>
                    <div className="max-h-72 overflow-y-auto py-1" role="listbox">
                      {filteredCatalogChildAgents.length === 0 && (
                        <div className="px-4 py-6 text-center text-xs text-slate-400">No agents found</div>
                      )}
                      {filteredCatalogChildAgents.map((a) => {
                        const id = a.identification?.agent_id ?? '';
                        const isLinked = linkedChildAgentIds.has(id);
                        const addKey = `add-child:${id}`;
                        const removeKey = `remove-child:${id}`;
                        const busy = actingKey === addKey || actingKey === removeKey;
                        return (
                          <button
                            key={id}
                            type="button"
                            role="option"
                            aria-selected={isLinked}
                            disabled={busy}
                            onClick={() => (isLinked ? handleRemoveChildAgent(id) : handleAddChildAgent(id))}
                            className={`w-full flex items-center gap-2 text-left px-4 py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                              isLinked ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold truncate">{a.name || id}</span>
                              <span className="block text-[11px] font-mono text-slate-400 truncate">{id}</span>
                            </span>
                            {busy ? (
                              <Loader2 size={14} className="animate-spin shrink-0 text-slate-400" />
                            ) : isLinked ? (
                              <Check size={15} className="shrink-0 text-blue-600" />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {liveChildAgents.map((ca, idx) => {
                const childId = ca.agent_id ?? ca.agent_internal_id ?? `child-${idx}`;
                const removeKey = `remove-child:${childId}`;
                return (
                  <div key={`${childId}-${idx}`} className="flex flex-col p-4 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link
                          to={`/agent/${encodeURIComponent(childId)}`}
                          className="font-bold text-sm text-blue-700 hover:underline"
                        >
                          {ca.agent_name || childId}
                        </Link>
                        <span className="block text-[11px] font-mono text-slate-400 mt-0.5">
                          {childId}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {ca.direction && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                            {ca.direction === 'PARENT' ? 'Parent' : 'Child'}
                          </span>
                        )}
                        {showingLiveData && (
                          <button
                            onClick={() => handleRemoveChildAgent(childId)}
                            disabled={actingKey === removeKey}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {actingKey === removeKey ? <Loader2 size={11} className="animate-spin" /> : <Unlink2 size={11} />}
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                    {ca.agent_description && (
                      <span className="block text-xs text-slate-500 mt-0.5 max-w-[640px]">
                        {ca.agent_description}
                      </span>
                    )}
                    {ca.relationship_label && (
                      <span className="mt-1 inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5 w-fit">
                        {ca.relationship_label}
                      </span>
                    )}
                  </div>
                );
              })}
              {liveChildAgents.length === 0 && (
                <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  No linked agents.
                </div>
              )}
            </div>
          </div>
        )}

        {(showProcesses || showChildAgents) && showAiModels && <div className="h-px bg-slate-100 w-full" />}

        {showAiModels && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Boxes size={13} /> AI Models ({liveAiModels.length})
              </h3>
              {agentId && !showingLiveData && (
                <Link
                  to={`/ai-models/new?linkAgentId=${encodeURIComponent(agentId)}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700"
                >
                  <Plus size={11} />
                  New Model
                </Link>
              )}
              {showingLiveData && (
                <div className="relative" ref={(el) => { dropdownRefs.current.aiModels = el; }}>
                  <button
                    onClick={() => setOpenDropdown(openDropdown === 'aiModels' ? null : 'aiModels')}
                    className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:border-blue-300 px-3 py-2 rounded-lg transition-colors"
                    aria-haspopup="listbox"
                    aria-expanded={openDropdown === 'aiModels'}
                  >
                    <PlusCircle size={13} className="text-blue-600" />
                    Add AI model
                    <ChevronDown size={13} className="text-slate-400" />
                  </button>
                  {openDropdown === 'aiModels' && (
                    <div className="absolute top-full right-0 mt-1 w-[300px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                      <div className="p-2 border-b border-slate-100">
                        <div className="relative">
                          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            ref={(el) => { searchInputRefs.current.aiModels = el; }}
                            value={aiModelSearch}
                            onChange={(e) => setAiModelSearch(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setOpenDropdown(null); }}
                            placeholder="Search AI model..."
                            className="w-full pl-7 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
                          />
                        </div>
                      </div>
                      <div className="max-h-72 overflow-y-auto py-1" role="listbox">
                        {filteredCatalogAiModels.length === 0 && (
                          <div className="px-4 py-6 text-center text-xs text-slate-400">No AI models found</div>
                        )}
                        {filteredCatalogAiModels.map((m) => {
                          const isLinked = linkedAiModelIds.has(m.ai_model_id);
                          const addKey = `add-model:${m.ai_model_id}`;
                          const removeKey = `remove-model:${m.ai_model_id}`;
                          const busy = actingKey === addKey || actingKey === removeKey;
                          return (
                            <button
                              key={m.ai_model_id}
                              type="button"
                              role="option"
                              aria-selected={isLinked}
                              disabled={busy}
                              onClick={() => (isLinked ? handleRemoveAiModel(m.ai_model_id) : handleAddAiModel(m.ai_model_id))}
                              className={`w-full flex items-center gap-2 text-left px-4 py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                isLinked ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block font-semibold truncate">{m.model_name || m.ai_model_id}</span>
                                <span className="block text-[11px] font-mono text-slate-400 truncate">{m.ai_model_id}</span>
                              </span>
                              {busy ? (
                                <Loader2 size={14} className="animate-spin shrink-0 text-slate-400" />
                              ) : isLinked ? (
                                <Check size={15} className="shrink-0 text-blue-600" />
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                      {agentId && (
                        <div className="border-t border-slate-100 mt-1 pt-1 px-2 pb-2">
                          <Link
                            to={`/ai-models/new?linkAgentId=${encodeURIComponent(agentId)}`}
                            onClick={() => setOpenDropdown(null)}
                            className="flex items-center gap-2 w-full text-left px-2 py-2 text-[11px] font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <Plus size={11} /> Add AI model
                          </Link>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3">
              {liveAiModels.map((m, idx) => {
                const modelId = m.ai_model_id || `model-${idx}`;
                const removeKey = `remove-model:${modelId}`;
                return (
                  <div key={`${modelId}-${idx}`} className="flex flex-col p-4 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link
                          to={`/ai-models/${encodeURIComponent(modelId)}`}
                          className="font-bold text-sm text-blue-700 hover:underline"
                        >
                          {m.model_name || modelId}
                        </Link>
                        <span className="block text-[11px] font-mono text-slate-400 mt-0.5">{modelId}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {m.status && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                            {m.status}
                          </span>
                        )}
                        {showingLiveData && (
                          <button
                            onClick={() => handleRemoveAiModel(modelId)}
                            disabled={actingKey === removeKey}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {actingKey === removeKey ? <Loader2 size={11} className="animate-spin" /> : <Unlink2 size={11} />}
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                    {m.description && (
                      <span className="block text-xs text-slate-500 mt-0.5 max-w-[640px]">{m.description}</span>
                    )}
                  </div>
                );
              })}
              {liveAiModels.length === 0 && (
                <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  No linked AI models.
                </div>
              )}
            </div>
          </div>
        )}

        {(showProcesses || showChildAgents || showAiModels) && showUseCases && <div className="h-px bg-slate-100 w-full" />}

        {showUseCases && (
          <div className={`flex flex-col gap-3 ${mode === 'all' ? 'order-first' : ''}`}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <BriefcaseBusiness size={13} /> AI Use Cases ({linkedUseCases.length})
              </h3>
              <div className="relative" ref={(el) => { dropdownRefs.current.useCases = el; }}>
                <button
                  onClick={() => setOpenDropdown(openDropdown === 'useCases' ? null : 'useCases')}
                  className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:border-blue-300 px-3 py-2 rounded-lg transition-colors"
                  aria-haspopup="listbox"
                  aria-expanded={openDropdown === 'useCases'}
                >
                  <PlusCircle size={13} className="text-blue-600" />
                  Add use case
                  <ChevronDown size={13} className="text-slate-400" />
                </button>
                {openDropdown === 'useCases' && (
                  <div className="absolute top-full right-0 mt-1 w-[300px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                    <div className="p-2 border-b border-slate-100">
                      <div className="relative">
                        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          ref={(el) => { searchInputRefs.current.useCases = el; }}
                          value={useCaseSearch}
                          onChange={(e) => setUseCaseSearch(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Escape') setOpenDropdown(null); }}
                          placeholder="Search use case..."
                          className="w-full pl-7 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
                        />
                      </div>
                    </div>
                    <div className="max-h-72 overflow-y-auto py-1" role="listbox">
                      {filteredCatalogUseCases.length === 0 && (
                        <div className="px-4 py-6 text-center text-xs text-slate-400">No use cases found</div>
                      )}
                      {filteredCatalogUseCases.map((uc) => {
                        const id = uc.identifier ?? '';
                        const isLinked = linkedUseCaseIds.has(id);
                        const addKey = `add-uc:${id}`;
                        const removeKey = `remove-uc:${id}`;
                        const busy = actingKey === addKey || actingKey === removeKey;
                        return (
                          <button
                            key={id}
                            type="button"
                            role="option"
                            aria-selected={isLinked}
                            disabled={!id || busy}
                            onClick={() => (isLinked ? handleUnlinkUseCase(id) : handleLinkUseCase(id))}
                            className={`w-full flex items-center gap-2 text-left px-4 py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                              isLinked ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold truncate">{uc.name || id}</span>
                              <span className="block text-[11px] font-mono text-slate-400 truncate">{id}</span>
                            </span>
                            {busy ? (
                              <Loader2 size={14} className="animate-spin shrink-0 text-slate-400" />
                            ) : isLinked ? (
                              <Check size={15} className="shrink-0 text-blue-600" />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                    {agentId && (
                      <div className="border-t border-slate-100 mt-1 pt-1 px-2 pb-2">
                        <Link
                          to={createUseCaseHref}
                          onClick={() => setOpenDropdown(null)}
                          className="flex items-center gap-2 w-full text-left px-2 py-2 text-[11px] font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <Plus size={12} /> Add use case
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </div>
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
          </div>
        )}

        {showIntegrations && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Link2 size={13} /> Integrations ({liveIntegrations.length})
              </h3>
              {agentId && !showingLiveData && (
                <Link
                  to={createIntegrationHref}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700"
                >
                  <Plus size={11} />
                  New Integration
                </Link>
              )}
              {showingLiveData && (
                <div className="relative" ref={(el) => { dropdownRefs.current.integrations = el; }}>
                  <button
                    onClick={() => setOpenDropdown(openDropdown === 'integrations' ? null : 'integrations')}
                    className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:border-blue-300 px-3 py-2 rounded-lg transition-colors"
                    aria-haspopup="listbox"
                    aria-expanded={openDropdown === 'integrations'}
                  >
                    <PlusCircle size={13} className="text-blue-600" />
                    Add integration
                    <ChevronDown size={13} className="text-slate-400" />
                  </button>
                  {openDropdown === 'integrations' && (
                    <div className="absolute top-full right-0 mt-1 w-[300px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                      <div className="p-2 border-b border-slate-100">
                        <div className="relative">
                          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            ref={(el) => { searchInputRefs.current.integrations = el; }}
                            value={integrationSearch}
                            onChange={(e) => setIntegrationSearch(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setOpenDropdown(null); }}
                            placeholder="Search integration..."
                            className="w-full pl-7 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
                          />
                        </div>
                      </div>
                      <div className="max-h-72 overflow-y-auto py-1" role="listbox">
                        {filteredCatalogIntegrations.length === 0 && (
                          <div className="px-4 py-6 text-center text-xs text-slate-400">No integrations found</div>
                        )}
                        {filteredCatalogIntegrations.map((i) => {
                          const isLinked = linkedIntegrationIds.has(i.integration_id);
                          const addKey = `add-integration:${i.integration_id}`;
                          const removeKey = `remove-integration:${i.integration_id}`;
                          const busy = actingKey === addKey || actingKey === removeKey;
                          return (
                            <button
                              key={i.integration_id}
                              type="button"
                              role="option"
                              aria-selected={isLinked}
                              disabled={busy}
                              onClick={() => (isLinked ? handleRemoveIntegration(i.integration_id) : handleAddIntegration(i.integration_id))}
                              className={`w-full flex items-center gap-2 text-left px-4 py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                isLinked ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block font-semibold truncate">{i.integration_name || i.integration_id}</span>
                                <span className="block text-[11px] font-mono text-slate-400 truncate">{i.integration_id}</span>
                              </span>
                              {busy ? (
                                <Loader2 size={14} className="animate-spin shrink-0 text-slate-400" />
                              ) : isLinked ? (
                                <Check size={15} className="shrink-0 text-blue-600" />
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                      {agentId && (
                        <div className="border-t border-slate-100 mt-1 pt-1 px-2 pb-2">
                          <Link
                            to={createIntegrationHref}
                            onClick={() => setOpenDropdown(null)}
                            className="flex items-center gap-2 w-full text-left px-2 py-2 text-[11px] font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <Plus size={11} /> Add integration
                          </Link>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              {liveIntegrations.map((integration, idx) => {
                const integrationId = integration.integration_id || `integration-${idx}`;
                const removeKey = `remove-integration:${integrationId}`;
                return (
                  <div key={`${integrationId}-${idx}`} className="flex flex-col p-4 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link
                          to={`/integrations/${encodeURIComponent(integrationId)}`}
                          className="font-bold text-sm text-blue-700 hover:underline"
                        >
                          {integration.integration_name || integrationId}
                        </Link>
                        <span className="block text-[11px] font-mono text-slate-400 mt-0.5">{integrationId}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {integration.availability_status && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                            {integration.availability_status}
                          </span>
                        )}
                        {showingLiveData && (
                          <button
                            onClick={() => handleRemoveIntegration(integrationId)}
                            disabled={actingKey === removeKey}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {actingKey === removeKey ? <Loader2 size={11} className="animate-spin" /> : <Unlink2 size={11} />}
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                    {integration.integration_description && (
                      <span className="block text-xs text-slate-500 mt-0.5 max-w-[640px]">{integration.integration_description}</span>
                    )}
                  </div>
                );
              })}
              {liveIntegrations.length === 0 && (
                <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  No linked integrations.
                </div>
              )}
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
