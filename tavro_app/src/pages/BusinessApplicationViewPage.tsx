import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toUserMessage } from '../utils/errorUtils';
import {
  AppWindow,
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Info,
  Loader2,
  Network,
  Pencil,
  Plus,
  PlusCircle,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Unlink2,
  XCircle,
} from 'lucide-react';
import { businessRelationsApi } from '../services/businessRelationsApi';
import { useCaseApi } from '../services/useCaseApi';
import { fetchAllPages } from '../utils/fetchAllPages';
import { aiModelApi } from '../services/aiModelApi';
import type {
  BusinessApplicationRecord,
  BusinessApplicationUpsertPayload,
} from '../types/businessRelations';
import type { AiModelRecord } from '../types/aiModel';
import type { DimEdge, SourceRef } from '../types/blueprint';
import { useCatalog } from '../context/CatalogContext';
import { useBlueprint } from '../context/BlueprintContext';
import { useUseCases } from '../context/UseCaseContext';
import { agentApi } from '../services/agentApi';
import { blueprintApi } from '../services/blueprintApi';
import AddDimEdgeModal from '../components/AddDimEdgeModal';

type Tab = 'overview' | 'related' | 'related_use_cases' | 'related_ai_models' | 'blueprint';
type Option = { label: string; value: string };

const EMERGENCY_TIER_OPTIONS: Option[] = [
  { label: 'Mission Critical', value: 'Mission Critical' },
  { label: 'Business Critical', value: 'Business Critical' },
  { label: 'Non-Critical', value: 'Non-Critical' },
];

const BUSINESS_CRITICALITY_OPTIONS: Option[] = [
  { label: 'High', value: 'High' },
  { label: 'Medium', value: 'Medium' },
  { label: 'Low', value: 'Low' },
];

const YES_NO_NONE_OPTIONS: Option[] = [
  { label: 'None', value: 'None' },
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
];

const INHERENT_RESIDUAL_OPTIONS: Option[] = [
  { label: 'None', value: 'None' },
  { label: 'High', value: 'High' },
  { label: 'Prohibited', value: 'Prohibited' },
  { label: 'Other', value: 'Other' },
];

const AGENT_RISK_TIER_OPTIONS: Option[] = [
  { label: 'None', value: 'None' },
  { label: 'Low', value: 'Low' },
  { label: 'Medium', value: 'Medium' },
  { label: 'High', value: 'High' },
  { label: 'Critical', value: 'Critical' },
];

interface ApplicationFormState {
  application_name: string;
  emergency_tier: string;
  business_owner: string;
  application_portfolio_manager: string;
  vendor_name: string;
  business_criticality: string;
  it_application_owner: string;
  application_description: string;
  agent_risk_exposure: string;
  num_of_associated_agents: string;
  inherent_risk_classification: string;
  residual_risk_classification: string;
  agent_risk_tier: string;
  blended_risk_score: string;
  inherent_risk_classification_score: string;
  residual_risk_classification_score: string;
  embedded_ai: string;
  opt_out_option: string;
  privacy_policy_url: string;
  data_excluded_from_ai_training: string;
  vendor_description: string;
  current_installed_version: string;
  is_current_version_supported: string;
  latest_released_version: string;
  latest_release_date: string;
  latest_release_documentation_link: string;
}

type ApplicationInlineField =
  | 'application_name'
  | 'emergency_tier'
  | 'business_owner'
  | 'application_portfolio_manager'
  | 'vendor_name'
  | 'business_criticality'
  | 'it_application_owner'
  | 'application_description'
  | 'embedded_ai'
  | 'opt_out_option'
  | 'privacy_policy_url'
  | 'data_excluded_from_ai_training'
  | 'vendor_description'
  | 'current_installed_version'
  | 'is_current_version_supported'
  | 'latest_released_version'
  | 'latest_release_date'
  | 'latest_release_documentation_link';

const HINTS: Record<string, string> = {
  emergency_tier:
    "The Emergency Tier categorizes an application's crisis criticality to prioritize recovery execution order.",
  business_criticality:
    "Business Criticality defines how vital the application is to core operations and support/change prioritization.",
  agent_risk_exposure:
    'ARE represents overall application risk. It is calculated as the highest blended risk score among related agents multiplied by the average of Business Criticality and Emergency Tier scores.',
  num_of_associated_agents:
    'Indicates the total number of agents associated with the application.',
  agent_risk_tier:
    'ART indicates overall application risk from ARE score: Low < 3, Medium 3-<7, High 7-<9, Critical >= 9.',
};

const inputCls =
  'w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2.5 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-white text-slate-800 placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-500';
const textAreaCls = `${inputCls} resize-none`;

const toText = (value: unknown, fallback = ''): string => {
  if (value === null || value === undefined) return fallback;
  return String(value);
};

const toNullable = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const getCalendarDateParts = (raw?: string | null): { year: string; month: string; day: string } | null => {
  if (!raw) return null;
  const match = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return { year: match[1], month: match[2], day: match[3] };
};

const formatDate = (raw?: string | null): string => {
  if (!raw) return 'N/A';
  const parts = getCalendarDateParts(raw);
  if (parts) return `${parts.month}/${parts.day}/${parts.year}`;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${date.getFullYear()}`;
};

const toDateInputValue = (value?: string | null): string => {
  if (!value) return '';
  const parts = getCalendarDateParts(value);
  if (parts) return `${parts.year}-${parts.month}-${parts.day}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toISOString().slice(0, 10);
};

const toDateTime = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed ? `${trimmed}T00:00:00` : null;
};

const emptyForm = (): ApplicationFormState => ({
  application_name: '',
  emergency_tier: '',
  business_owner: '',
  application_portfolio_manager: '',
  vendor_name: '',
  business_criticality: '',
  it_application_owner: '',
  application_description: '',
  agent_risk_exposure: '0',
  num_of_associated_agents: '0',
  inherent_risk_classification: 'None',
  residual_risk_classification: 'None',
  agent_risk_tier: 'None',
  blended_risk_score: '0',
  inherent_risk_classification_score: '0',
  residual_risk_classification_score: '0',
  embedded_ai: 'None',
  opt_out_option: 'None',
  privacy_policy_url: '',
  data_excluded_from_ai_training: 'None',
  vendor_description: '',
  current_installed_version: '',
  is_current_version_supported: 'None',
  latest_released_version: '',
  latest_release_date: '',
  latest_release_documentation_link: '',
});

const formFromApplication = (app: BusinessApplicationRecord): ApplicationFormState => ({
  application_name: toText(app.application_name),
  emergency_tier: toText(app.emergency_tier),
  business_owner: toText(app.business_owner),
  application_portfolio_manager: toText(app.application_portfolio_manager),
  vendor_name: toText(app.vendor_name),
  business_criticality: toText(app.business_criticality),
  it_application_owner: toText(app.it_application_owner),
  application_description: toText(app.application_description),
  agent_risk_exposure: toText(app.agent_risk_exposure, '0'),
  num_of_associated_agents: toText(app.num_of_associated_agents, '0'),
  inherent_risk_classification: toText(app.inherent_risk_classification, 'None'),
  residual_risk_classification: toText(app.residual_risk_classification, 'None'),
  agent_risk_tier: toText(app.agent_risk_tier, 'None'),
  blended_risk_score: toText(app.blended_risk_score, '0'),
  inherent_risk_classification_score: toText(app.inherent_risk_classification_score, '0'),
  residual_risk_classification_score: toText(app.residual_risk_classification_score, '0'),
  embedded_ai: toText(app.embedded_ai, 'None'),
  opt_out_option: toText(app.opt_out_option, 'None'),
  privacy_policy_url: toText(app.privacy_policy_url),
  data_excluded_from_ai_training: toText(app.data_excluded_from_ai_training, 'None'),
  vendor_description: toText(app.vendor_description),
  current_installed_version: toText(app.current_installed_version),
  is_current_version_supported: toText(app.is_current_version_supported, 'None'),
  latest_released_version: toText(app.latest_released_version),
  latest_release_date: toDateInputValue(app.latest_release_date),
  latest_release_documentation_link: toText(app.latest_release_documentation_link),
});

const buildApplicationPayload = (form: ApplicationFormState): BusinessApplicationUpsertPayload => ({
  application_name: toNullable(form.application_name),
  emergency_tier: toNullable(form.emergency_tier),
  business_owner: toNullable(form.business_owner),
  application_portfolio_manager: toNullable(form.application_portfolio_manager),
  vendor_name: toNullable(form.vendor_name),
  business_criticality: toNullable(form.business_criticality),
  it_application_owner: toNullable(form.it_application_owner),
  application_description: toNullable(form.application_description),
  embedded_ai: toNullable(form.embedded_ai),
  opt_out_option: toNullable(form.opt_out_option),
  privacy_policy_url: toNullable(form.privacy_policy_url),
  data_excluded_from_ai_training: toNullable(form.data_excluded_from_ai_training),
  vendor_description: toNullable(form.vendor_description),
  current_installed_version: toNullable(form.current_installed_version),
  is_current_version_supported: toNullable(form.is_current_version_supported),
  latest_released_version: toNullable(form.latest_released_version),
  latest_release_date: toDateTime(form.latest_release_date),
  latest_release_documentation_link: toNullable(form.latest_release_documentation_link),
});

const changedApplicationPayload = (
  current: ApplicationFormState,
  next: ApplicationFormState,
): BusinessApplicationUpsertPayload => {
  const currentPayload = buildApplicationPayload(current);
  const nextPayload = buildApplicationPayload(next);
  const changed: BusinessApplicationUpsertPayload = {};
  (Object.keys(nextPayload) as Array<keyof BusinessApplicationUpsertPayload>).forEach(key => {
    if (nextPayload[key] !== currentPayload[key]) {
      Object.assign(changed, { [key]: nextPayload[key] ?? null });
    }
  });
  return changed;
};

const labelFromOptions = (value: string, options: Option[]): string => {
  if (!value) return 'N/A';
  const found = options.find(o => o.value === value);
  return found ? found.label : value;
};

type HeaderMetricMeta = {
  label: string;
  tone: 'high' | 'medium' | 'low' | 'neutral';
};

const getCriticalityMeta = (value: string): HeaderMetricMeta => {
  const display = labelFromOptions(value, BUSINESS_CRITICALITY_OPTIONS);
  const normalized = display.toLowerCase();

  if (normalized.includes('high')) return { label: display, tone: 'high' };
  if (normalized.includes('medium')) return { label: display, tone: 'medium' };
  if (normalized.includes('low')) return { label: display, tone: 'low' };
  if (display === 'N/A') return { label: display, tone: 'neutral' };
  return { label: display, tone: 'neutral' };
};

const getEmergencyTierMeta = (value: string): HeaderMetricMeta => {
  const display = labelFromOptions(value, EMERGENCY_TIER_OPTIONS);
  const normalized = display.toLowerCase();

  if (normalized.includes('mission critical')) return { label: display, tone: 'high' };
  if (normalized.includes('business critical')) return { label: display, tone: 'medium' };
  if (normalized.includes('non-critical')) return { label: display, tone: 'low' };
  if (display === 'N/A') return { label: display, tone: 'neutral' };
  return { label: display, tone: 'neutral' };
};

const metricToneClass = (tone: HeaderMetricMeta['tone']) => {
  if (tone === 'high') return 'text-red-600';
  if (tone === 'medium') return 'text-amber-600';
  if (tone === 'low') return 'text-emerald-600';
  return 'text-slate-600';
};

const getArtMeta = (value: string): HeaderMetricMeta => {
  const label = value || 'N/A';
  const normalized = label.toLowerCase();
  if (normalized === 'critical' || normalized === 'high') return { label, tone: 'high' };
  if (normalized === 'medium') return { label, tone: 'medium' };
  if (normalized === 'low' || normalized === 'none') return { label, tone: 'low' };
  return { label, tone: 'neutral' };
};

const HintLabel: React.FC<{ label: string; hint?: string; required?: boolean }> = ({ label, hint, required }) => (
  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
    {label}
    {required && <span className="text-red-500">*</span>}
    {hint && (
      <span title={hint}>
        <Info size={12} className="text-slate-400" />
      </span>
    )}
  </label>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4">
    <h3 className="text-sm font-bold text-slate-800">{title}</h3>
    {children}
  </div>
);

const ReadValue: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => (
  <div className="flex flex-col gap-1.5">
    <HintLabel label={label} hint={hint} />
    <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5">{value || 'N/A'}</p>
  </div>
);

const BusinessApplicationViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { agents: catalogAgents } = useCatalog();
  const { activeCompany } = useBlueprint();
  const { useCases: allUseCases, refresh: refreshUseCases } = useUseCases();
  const isCreateMode = !id || id === 'new';
  const linkAgentId = (searchParams.get('linkAgentId') || '').trim();
  const linkUseCaseId = (searchParams.get('linkUseCaseId') || '').trim();

  const [companyAgents, setCompanyAgents] = useState<typeof catalogAgents>([]);
  const [companyUseCases, setCompanyUseCases] = useState<typeof allUseCases>([]);

  useEffect(() => {
    agentApi.listAgentsForLinking(activeCompany?.id).then(setCompanyAgents).catch(() => {});
  }, [activeCompany?.id]);

  useEffect(() => {
    fetchAllPages(
      (start, range) => useCaseApi.listUseCases({ companyId: activeCompany?.id, startRecord: start, recordRange: range }),
      100,
    ).then(rawData => setCompanyUseCases(rawData.map((raw: any) => ({
        identifier: raw.identifier ?? raw.use_case_id ?? raw.id ?? '',
        name: raw.name ?? raw.title ?? raw.use_case_name ?? '',
        description: raw.description ?? null,
        status: raw.status ?? null,
        priority: raw.priority ?? null,
        overall_risk: raw.overall_risk ?? null,
    })))).catch(() => {});
  }, [activeCompany?.id]);

  const agents = companyAgents.length > 0 ? companyAgents : catalogAgents;
  const useCasesForLinking = companyUseCases.length > 0 ? companyUseCases : allUseCases;

  const [application, setApplication] = useState<BusinessApplicationRecord | null>(null);
  const [form, setForm] = useState<ApplicationFormState>(emptyForm);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [tagSaving, setTagSaving] = useState(false);
  const [visibility, setVisibility] = useState<string>('internal');
  const [sensitive, setSensitive] = useState<boolean>(false);
  const [loading, setLoading] = useState(!isCreateMode);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(isCreateMode);
  const [saving, setSaving] = useState(false);
  const [inlineEdit, setInlineEdit] = useState<{ field: ApplicationInlineField; value: string } | null>(null);
  const [inlineSaving, setInlineSaving] = useState<ApplicationInlineField | null>(null);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [searchAgents, setSearchAgents] = useState('');
  const [searchUseCases, setSearchUseCases] = useState('');
  const [actingAgent, setActingAgent] = useState<string | null>(null);
  const [actingUseCase, setActingUseCase] = useState<string | null>(null);
  const [relationError, setRelationError] = useState<string | null>(null);
  const [useCaseRelationError, setUseCaseRelationError] = useState<string | null>(null);
  const [allModels, setAllModels] = useState<AiModelRecord[]>([]);
  const [searchModels, setSearchModels] = useState('');
  const [actingModel, setActingModel] = useState<string | null>(null);
  const [modelRelationError, setModelRelationError] = useState<string | null>(null);

  // Blueprint
  const [blueprintEdges, setBlueprintEdges] = useState<DimEdge[]>([]);
  const [blueprintSourceRefs, setBlueprintSourceRefs] = useState<SourceRef[]>([]);
  const [blueprintLoading, setBlueprintLoading] = useState(false);
  const [showAddEdge, setShowAddEdge] = useState(false);
  const [showAddSourceRef, setShowAddSourceRef] = useState(false);
  const [newSysName, setNewSysName] = useState('');
  const [newExtId, setNewExtId] = useState('');
  const [addingRef, setAddingRef] = useState(false);
  const [deletingEdge, setDeletingEdge] = useState<string | null>(null);
  const [deletingRef, setDeletingRef] = useState<string | null>(null);

  useEffect(() => {
    aiModelApi.listModels(undefined, activeCompany?.id).then(setAllModels).catch(() => setAllModels([]));
  }, [activeCompany?.id]);

  const linkedModels = application?.related_ai_models ?? [];
  const linkedModelIds = useMemo(
    () => new Set(linkedModels.map(m => m.ai_model_id).filter(Boolean)),
    [linkedModels],
  );
  const availableModels = useMemo(() => {
    const q = searchModels.trim().toLowerCase();
    return allModels.filter(m => {
      if (linkedModelIds.has(m.ai_model_id)) return false;
      if (!q) return true;
      return (
        m.ai_model_id.toLowerCase().includes(q) ||
        (m.model_name ?? '').toLowerCase().includes(q) ||
        (m.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [allModels, searchModels, linkedModelIds]);

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) {
      const aid = a.identification?.agent_id;
      if (aid) map.set(aid, a.name);
    }
    return map;
  }, [agents]);

  const load = async () => {
    if (!id || isCreateMode) return;
    setLoading(true);
    setError(null);
    setRelationError(null);
    setUseCaseRelationError(null);
    try {
      const data = await businessRelationsApi.getApplication(id, activeCompany?.id);
      setApplication(data);
      setForm(formFromApplication(data));
      setTags(Array.isArray(data.tags) ? data.tags : []);
      setVisibility(data.visibility ?? 'internal');
      setSensitive(data.sensitive ?? false);
      setAttemptedSave(false);
    } catch (err: any) {
      setError(toUserMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const loadBlueprint = async (dimNodeId: string) => {
    if (!dimNodeId || !activeCompany?.id) return;
    setBlueprintLoading(true);
    try {
      const edgesPage = await blueprintApi.listEdges({ company_id: activeCompany.id, node_id: dimNodeId });
      setBlueprintEdges(edgesPage.items);
    } catch {
    } finally {
      setBlueprintLoading(false);
    }
  };

  const loadSourceRefs = async (dimNodeId: string) => {
    try {
      const refs = await blueprintApi.listSourceRefs(dimNodeId);
      setBlueprintSourceRefs(refs);
    } catch {
    }
  };

  useEffect(() => {
    if (application?.dim_node_id) loadSourceRefs(application.dim_node_id);
  }, [application?.dim_node_id]);

  useEffect(() => {
    if (tab !== 'blueprint' || !application?.dim_node_id) return;
    loadBlueprint(application.dim_node_id);
  }, [tab, application?.dim_node_id]);

  useEffect(() => {
    if (isCreateMode) {
      setApplication(null);
      setForm(emptyForm());
      setTags([]);
      setEditing(true);
      setInlineEdit(null);
      setAttemptedSave(false);
      setLoading(false);
      setTab('overview');
      setError(null);
      return;
    }
    setEditing(false);
    setInlineEdit(null);
    load();
  }, [id, isCreateMode, activeCompany?.id]);

  const linkedAgentIds = useMemo(() => {
    const set = new Set<string>();
    for (const rel of application?.related_agents ?? []) {
      if (rel.agent_id) set.add(rel.agent_id);
    }
    return set;
  }, [application]);

  const availableAgents = useMemo(() => {
    const q = searchAgents.trim().toLowerCase();
    return agents.filter(agent => {
      const agentId = agent.identification?.agent_id || '';
      if (!agentId || linkedAgentIds.has(agentId)) return false;
      if (!q) return true;
      return (
        agentId.toLowerCase().includes(q) ||
        agent.name.toLowerCase().includes(q) ||
        (agent.identification?.environment ?? '').toLowerCase().includes(q)
      );
    });
  }, [agents, linkedAgentIds, searchAgents]);

  const relatedUseCases = useMemo(() => {
    return application?.related_use_cases ?? [];
  }, [application]);

  const linkedUseCaseIds = useMemo(() => {
    const ids = new Set<string>();
    relatedUseCases.forEach((useCase) => {
      if (useCase.identifier) ids.add(useCase.identifier);
    });
    return ids;
  }, [relatedUseCases]);

  const availableUseCases = useMemo(() => {
    const q = searchUseCases.trim().toLowerCase();
    return useCasesForLinking.filter((useCase) => {
      const useCaseId = useCase.identifier || '';
      if (!useCaseId || linkedUseCaseIds.has(useCaseId)) return false;
      if (!q) return true;
      return (
        useCaseId.toLowerCase().includes(q) ||
        (useCase.name ?? '').toLowerCase().includes(q) ||
        (useCase.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [useCasesForLinking, linkedUseCaseIds, searchUseCases]);

  const setField = (key: keyof ApplicationFormState, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const startInlineEdit = (field: ApplicationInlineField) => {
    if (editing || isCreateMode || saving || inlineSaving) return;
    setActionError(null);
    setInlineEdit({
      field,
      value: field === 'latest_release_date' ? toDateInputValue(form[field]) : form[field],
    });
  };

  const cancelInlineEdit = () => {
    setInlineEdit(null);
    setActionError(null);
  };

  const saveInlineEdit = async () => {
    if (!application || !inlineEdit) return;
    const nextForm = { ...form, [inlineEdit.field]: inlineEdit.value };
    if (!nextForm.application_name.trim()) {
      setActionError('Application Name is required.');
      return;
    }

    setInlineSaving(inlineEdit.field);
    setActionError(null);
    try {
      const changedPayload = changedApplicationPayload(formFromApplication(application), nextForm);
      if (Object.keys(changedPayload).length === 0) {
        setInlineEdit(null);
        setAttemptedSave(false);
        return;
      }
      const updated = await businessRelationsApi.updateApplication(
        application.business_application_id,
        changedPayload,
      );
      setApplication(updated);
      setForm(formFromApplication(updated));
      setTags(Array.isArray(updated.tags) ? updated.tags : []);
      setVisibility(updated.visibility ?? 'internal');
      setSensitive(updated.sensitive ?? false);
      setInlineEdit(null);
      setAttemptedSave(false);
    } catch (err: any) {
      setActionError(toUserMessage(err));
    } finally {
      setInlineSaving(null);
    }
  };

  const renderInlineEditable = (
    field: ApplicationInlineField,
    displayValue: string,
    config: { kind?: 'text' | 'textarea' | 'select' | 'date'; options?: Option[]; className?: string } = {},
  ) => {
    const isActive = inlineEdit?.field === field;
    const kind = config.kind ?? 'text';
    const valueClass = config.className ?? 'text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5';
    const isSavingField = inlineSaving === field;
    const saveDisabled = isSavingField || (field === 'application_name' && !inlineEdit?.value.trim());

    if (!editing && !isCreateMode && isActive) {
      return (
        <div className="flex items-start gap-2">
          {kind === 'textarea' ? (
            <textarea
              value={inlineEdit.value}
              onChange={(e) => setInlineEdit({ field, value: e.target.value })}
              rows={3}
              className={textAreaCls}
              autoFocus
            />
          ) : kind === 'select' ? (
            <select
              value={inlineEdit.value}
              onChange={(e) => setInlineEdit({ field, value: e.target.value })}
              className={inputCls}
              autoFocus
            >
              <option value="">Select...</option>
              {(config.options ?? []).map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : kind === 'date' ? (
            <input
              type="date"
              lang="en-US"
              value={inlineEdit.value}
              onChange={(e) => setInlineEdit({ field, value: e.target.value })}
              className={inputCls}
              autoFocus
            />
          ) : (
            <input
              value={inlineEdit.value}
              onChange={(e) => setInlineEdit({ field, value: e.target.value })}
              className={inputCls}
              autoFocus
            />
          )}
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={saveInlineEdit}
              disabled={saveDisabled}
              title={field === 'application_name' && !inlineEdit.value.trim() ? 'Application Name is required' : 'Save'}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-xs font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {isSavingField ? <Loader2 size={14} className="animate-spin" /> : '✓'}
            </button>
            <button
              type="button"
              onClick={cancelInlineEdit}
              disabled={isSavingField}
              title="Cancel"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              ✕
            </button>
          </div>
        </div>
      );
    }

    return (
      <p
        onDoubleClick={() => startInlineEdit(field)}
        title="Double-click to edit"
        className={`${valueClass} ${!editing && !isCreateMode ? 'cursor-text hover:border-blue-200 hover:bg-blue-50/40 transition-colors' : ''}`}
      >
        {displayValue}
      </p>
    );
  };

  const handleSuggestDescription = async () => {
    if (!form.application_name.trim()) {
      setActionError('Application Name is required before generating the description.');
      return;
    }

    setGeneratingDescription(true);
    setActionError(null);
    try {
      const result = await businessRelationsApi.suggestApplicationDescription(form.application_name.trim());
      if (result.description) {
        setField('application_description', result.description);
      }
    } catch (err: any) {
      setActionError(toUserMessage(err));
    } finally {
      setGeneratingDescription(false);
    }
  };

  const isApplicationNameMissing = !form.application_name.trim();

  const handleSave = async () => {
    setAttemptedSave(true);
    if (isApplicationNameMissing) {
      setActionError('Application Name is required.');
      return;
    }

    setSaving(true);
    setActionError(null);
    try {
      const payload = buildApplicationPayload(form);
      if (isCreateMode) {
        if (tags.length > 0) payload.tags = tags;
        payload.visibility = visibility;
        payload.sensitive = sensitive;
        const created = await businessRelationsApi.createApplication(payload, activeCompany?.id);
        if (linkAgentId) {
          try {
            await businessRelationsApi.linkAgentToApplication(linkAgentId, created.business_application_id, activeCompany?.id);
          } catch (linkErr) {
            console.warn('Application created but auto-link to agent failed.', linkErr);
          }
        }
        if (linkUseCaseId) {
          try {
            await useCaseApi.linkApplication(linkUseCaseId, created.business_application_id);
          } catch (linkErr) {
            console.warn('Application created but auto-link to AI use case failed.', linkErr);
          }
          window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
          navigate(`/use-case/${encodeURIComponent(linkUseCaseId)}`, { replace: true });
          return;
        }
        window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
        navigate(`/applications/${encodeURIComponent(created.business_application_id)}`, { replace: true });
        return;
      }
      if (!application) return;
      const changedPayload = changedApplicationPayload(formFromApplication(application), form);
      if (Object.keys(changedPayload).length === 0) {
        setAttemptedSave(false);
        setInlineEdit(null);
        setEditing(false);
        return;
      }
      const updated = await businessRelationsApi.updateApplication(application.business_application_id, changedPayload);
      setApplication(updated);
      setForm(formFromApplication(updated));
      setTags(Array.isArray(updated.tags) ? updated.tags : []);
      setVisibility(updated.visibility ?? 'internal');
      setSensitive(updated.sensitive ?? false);
      setAttemptedSave(false);
      setInlineEdit(null);
      setEditing(false);
    } catch (err: any) {
      setActionError(toUserMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setActionError(null);
    setInlineEdit(null);
    setAttemptedSave(false);
    if (isCreateMode) {
      if (linkUseCaseId) {
        navigate(`/use-case/${encodeURIComponent(linkUseCaseId)}`);
        return;
      }
      navigate('/applications');
      return;
    }
    if (application) setForm(formFromApplication(application));
    setEditing(false);
  };

  const handleDelete = async () => {
    if (!application) return;
    const ok = window.confirm(`Delete application "${application.application_name || application.business_application_id}"?`);
    if (!ok) return;
    setDeleting(true);
    setActionError(null);
    try {
      await businessRelationsApi.deleteApplication(application.business_application_id);
      window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
      navigate('/applications');
    } catch (err: any) {
      setActionError(toUserMessage(err));
      setDeleting(false);
    }
  };

  const addAgent = async (agentId: string) => {
    if (!application) return;
    setActingAgent(agentId);
    setRelationError(null);
    try {
      await businessRelationsApi.linkAgentToApplication(agentId, application.business_application_id, activeCompany?.id);
      await load();
    } catch (err: any) {
      setRelationError(toUserMessage(err));
    } finally {
      setActingAgent(null);
    }
  };

  const removeAgent = async (agentId: string) => {
    if (!application) return;
    setActingAgent(agentId);
    setRelationError(null);
    try {
      await businessRelationsApi.unlinkAgentFromApplication(agentId, application.business_application_id, activeCompany?.id);
      await load();
    } catch (err: any) {
      setRelationError(toUserMessage(err));
    } finally {
      setActingAgent(null);
    }
  };

  const addModel = async (modelId: string) => {
    if (!application) return;
    setActingModel(modelId);
    setModelRelationError(null);
    try {
      await aiModelApi.linkApplication(modelId, application.business_application_id);
      await load();
    } catch (err: any) {
      setModelRelationError(toUserMessage(err));
    } finally {
      setActingModel(null);
    }
  };

  const removeModel = async (modelId: string) => {
    if (!application) return;
    setActingModel(modelId);
    setModelRelationError(null);
    try {
      await aiModelApi.unlinkApplication(modelId, application.business_application_id);
      await load();
    } catch (err: any) {
      setModelRelationError(toUserMessage(err));
    } finally {
      setActingModel(null);
    }
  };

  const addUseCase = async (useCaseId: string) => {
    if (!application) return;
    setActingUseCase(useCaseId);
    setUseCaseRelationError(null);
    try {
      await useCaseApi.linkApplication(useCaseId, application.business_application_id);
      await load();
      refreshUseCases();
    } catch (err: any) {
      setUseCaseRelationError(toUserMessage(err));
    } finally {
      setActingUseCase(null);
    }
  };

  const removeUseCase = async (useCaseId: string) => {
    if (!application) return;
    setActingUseCase(useCaseId);
    setUseCaseRelationError(null);
    try {
      await useCaseApi.unlinkApplication(useCaseId, application.business_application_id);
      await load();
      refreshUseCases();
    } catch (err: any) {
      setUseCaseRelationError(toUserMessage(err));
    } finally {
      setActingUseCase(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500">
        <Loader2 size={16} className="animate-spin" />
        Loading application details...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <button
          onClick={() => {
            if (isCreateMode && linkUseCaseId) {
              navigate(`/use-case/${encodeURIComponent(linkUseCaseId)}`);
              return;
            }
            navigate('/applications');
          }}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> {isCreateMode && linkUseCaseId ? 'Back to AI Use Case' : 'Back to Applications'}
        </button>
        <div className="flex items-start gap-3 text-red-500 bg-red-50 border border-red-200 rounded-xl px-6 py-4">
          <AlertCircle size={20} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-bold text-sm">Could not load application</p>
            <p className="text-xs mt-1 text-red-400">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const appTitle = form.application_name || application?.application_name || 'New Application';
  const appId = application?.business_application_id || 'Will be generated on create';
  const relatedAgentCount = application?.related_agents?.length ?? 0;
  const relatedUseCaseCount = relatedUseCases.length;
  const criticalityMeta = getCriticalityMeta(form.business_criticality);
  const emergencyTierMeta = getEmergencyTierMeta(form.emergency_tier);
  const artMeta = getArtMeta(form.agent_risk_tier);

  return (
    <div className="flex flex-col gap-6 w-full animate-fade-in max-w-[1400px] mx-auto pb-10">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={() => {
            if (isCreateMode && linkUseCaseId) {
              navigate(`/use-case/${encodeURIComponent(linkUseCaseId)}`);
              return;
            }
            navigate('/applications');
          }}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> {isCreateMode && linkUseCaseId ? 'Back to AI Use Case' : 'Back to Applications'}
        </button>

        <div className="flex items-center gap-2 flex-wrap">
          {editing ? (
            <>
              <button
                onClick={handleCancelEdit}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              >
                <XCircle size={15} /> {isCreateMode ? 'Cancel' : 'Discard'}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || isApplicationNameMissing}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {isCreateMode ? 'Create Application' : 'Save'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setTab('overview');
                  setAttemptedSave(false);
                  setInlineEdit(null);
                  setEditing(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              >
                <Pencil size={15} /> Edit
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {actionError && (
        <div className="flex items-start gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {actionError}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="h-4 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-t-2xl w-full" />
        <div className="p-6 bg-slate-50 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 flex-wrap">
          <div className="flex items-start gap-4 min-w-0 flex-1 md:max-w-[45%]">
            <div className="p-3 bg-blue-600 text-white rounded-xl shadow-sm mt-1 shrink-0">
              <AppWindow size={24} />
            </div>
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Application</span>
              <h2 className="text-2xl font-bold text-slate-800 tracking-tight truncate">{appTitle}</h2>              
              <p className="text-xs font-mono text-slate-400 mt-1">{appId}</p>           
              <p className="text-sm text-slate-600 line-clamp-2">
                {form.application_description || 'No description available.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 shrink-0 w-full md:w-auto mt-2 md:mt-0">
            <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[170px]">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">
                Emergency Tier
              </span>
              <span className={`inline-flex items-center gap-1 text-xs font-bold ${metricToneClass(emergencyTierMeta.tone)}`}>
                {emergencyTierMeta.tone === 'low' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                {emergencyTierMeta.label}
              </span>
            </div>

            <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[170px]">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">
                Business Criticality
              </span>
              <span className={`inline-flex items-center gap-1 text-xs font-bold ${metricToneClass(criticalityMeta.tone)}`}>
                {criticalityMeta.tone === 'low' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                {criticalityMeta.label}
              </span>
            </div>

            <div className="bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[130px]">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5 inline-flex items-center gap-1">
                ARE
                <span title="ARE (Agent Risk Exposure) represents overall application risk. It is calculated as the highest blended risk score among related agents multiplied by the average of Business Criticality and Emergency Tier scores.">
                  <Info size={10} className="text-slate-400" />
                </span>
              </span>
              <span className="text-xs font-bold text-slate-700">
                {form.agent_risk_exposure || 'N/A'}
              </span>
            </div>

            <div className="bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[130px]">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5 inline-flex items-center gap-1">
                ART
                <span title="ART (Agent Risk Tier) indicates overall application risk from ARE score: Low &lt; 3, Medium 3–&lt;7, High 7–&lt;9, Critical ≥ 9.">
                  <Info size={10} className="text-slate-400" />
                </span>
              </span>
              <span className={`inline-flex items-center gap-1 text-xs font-bold ${metricToneClass(artMeta.tone)}`}>
                {artMeta.tone === 'low' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                {artMeta.label}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          onClick={() => setTab('overview')}
          className={`px-4 py-2.5 text-sm font-bold border-b-2 transition-colors ${
            tab === 'overview'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Details
        </button>
        {!isCreateMode && !editing && (
          <>
            <button
              onClick={() => setTab('related')}
              className={`px-4 py-2.5 text-sm font-bold border-b-2 transition-colors ${
                tab === 'related'
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Related Agents({relatedAgentCount})
            </button>
            <button
              onClick={() => setTab('related_use_cases')}
              className={`px-4 py-2.5 text-sm font-bold border-b-2 transition-colors ${
                tab === 'related_use_cases'
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Related AI Use Cases({relatedUseCaseCount})
            </button>
            <button
              onClick={() => setTab('related_ai_models')}
              className={`px-4 py-2.5 text-sm font-bold border-b-2 transition-colors ${
                tab === 'related_ai_models'
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Related AI Models({linkedModels.length})
            </button>
            <button
              onClick={() => setTab('blueprint')}
              className={`px-4 py-2.5 text-sm font-bold border-b-2 transition-colors ${
                tab === 'blueprint'
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Blueprint Relationships
            </button>
          </>
        )}
      </div>

      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          <Section title="Details">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <HintLabel label="Application Name" required />
                {editing ? (
                  <>
                    <input
                      value={form.application_name}
                      onChange={(e) => {
                        const value = e.target.value;
                        setField('application_name', value);
                        if (attemptedSave && value.trim()) setActionError(null);
                      }}
                      className={`${inputCls} ${attemptedSave && isApplicationNameMissing ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20' : ''}`}
                      placeholder="Application name"
                      aria-invalid={attemptedSave && isApplicationNameMissing}
                    />
                    {attemptedSave && isApplicationNameMissing && (
                      <p className="text-xs text-red-600">Application Name is required.</p>
                    )}
                  </>
                ) : (
                  renderInlineEditable('application_name', form.application_name || 'N/A')
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <HintLabel label="Emergency Tier" hint={HINTS.emergency_tier} />
                {editing ? (
                  <select
                    value={form.emergency_tier}
                    onChange={(e) => setField('emergency_tier', e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select...</option>
                    {EMERGENCY_TIER_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  renderInlineEditable('emergency_tier', labelFromOptions(form.emergency_tier, EMERGENCY_TIER_OPTIONS), {
                    kind: 'select',
                    options: EMERGENCY_TIER_OPTIONS,
                  })
                )}
              </div>

              {[
                ['business_owner', 'Business Owner'],
                ['application_portfolio_manager', 'Application Portfolio Manager'],
                ['vendor_name', 'Vendor'],
                ['it_application_owner', 'IT Application Owner'],
              ].map(([field, label]) => (
                <div key={field} className="flex flex-col gap-1.5">
                  <HintLabel label={label} />
                  {editing ? (
                    <input
                      type={field === 'latest_release_date' ? 'date' : 'text'}
                      lang={field === 'latest_release_date' ? 'en-US' : undefined}
                      value={form[field as keyof ApplicationFormState]}
                      onChange={(e) => setField(field as keyof ApplicationFormState, e.target.value)}
                      className={inputCls}
                    />
                  ) : (
                    renderInlineEditable(
                      field as ApplicationInlineField,
                      form[field as keyof ApplicationFormState] || 'N/A',
                    )
                  )}
                </div>
              ))}

              <div className="flex flex-col gap-1.5">
                <HintLabel label="Business Criticality" hint={HINTS.business_criticality} />
                {editing ? (
                  <select
                    value={form.business_criticality}
                    onChange={(e) => setField('business_criticality', e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select...</option>
                    {BUSINESS_CRITICALITY_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  renderInlineEditable('business_criticality', labelFromOptions(form.business_criticality, BUSINESS_CRITICALITY_OPTIONS), {
                    kind: 'select',
                    options: BUSINESS_CRITICALITY_OPTIONS,
                  })
                )}
              </div>

              <div className="md:col-span-2 flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <HintLabel label="Application Description" />
                  {editing && (
                    <button
                      type="button"
                      onClick={handleSuggestDescription}
                      disabled={generatingDescription || !form.application_name.trim()}
                      title={form.application_name.trim() ? 'Generate description with AI' : 'Enter an application name first'}
                      className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg border transition-all ${
                        generatingDescription
                          ? 'bg-violet-50 border-violet-200 text-violet-500 cursor-wait'
                          : form.application_name.trim()
                            ? 'bg-violet-50 border-violet-200 text-violet-600 hover:bg-violet-100 hover:border-violet-300'
                            : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'
                      }`}
                    >
                      {generatingDescription
                        ? <RefreshCw size={11} className="animate-spin" />
                        : <Sparkles size={11} />}
                      {generatingDescription ? 'Generating...' : 'AI assist'}
                    </button>
                  )}
                </div>
                {editing ? (
                  <textarea
                    value={form.application_description}
                    onChange={(e) => setField('application_description', e.target.value)}
                    rows={3}
                    className={`${textAreaCls} ${generatingDescription ? 'opacity-50' : ''}`}
                    disabled={generatingDescription}
                  />
                ) : (
                  renderInlineEditable('application_description', form.application_description || 'N/A', {
                    kind: 'textarea',
                    className: 'text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 min-h-[84px]',
                  })
                )}
              </div>
              <div className="flex flex-col gap-1.5 col-span-full">
                <HintLabel label="Tags" />
                <div className="flex flex-wrap items-center gap-1.5 min-h-[32px] bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2">
                  {tags.map(tag => (
                    <span key={tag} className="inline-flex items-center gap-1 text-[11px] font-semibold bg-white text-slate-600 px-2 py-0.5 rounded-full border border-slate-200 shadow-sm">
                      {tag}
                      <button
                        type="button"
                        disabled={tagSaving}
                        onClick={async () => {
                          const next = tags.filter(t => t !== tag);
                          if (isCreateMode) { setTags(next); return; }
                          if (!application) return;
                          setTagSaving(true);
                          try {
                            const updated = await businessRelationsApi.updateApplication(application.business_application_id, { tags: next });
                            setTags(Array.isArray(updated.tags) ? updated.tags : next);
                          } catch { setTags(next); }
                          finally { setTagSaving(false); }
                        }}
                        className="text-slate-400 hover:text-red-400 leading-none ml-0.5"
                      >×</button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={async e => {
                      if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                        e.preventDefault();
                        const newTag = tagInput.trim().replace(/,$/, '');
                        if (!newTag || tags.includes(newTag)) { setTagInput(''); return; }
                        const next = [...tags, newTag];
                        setTagInput('');
                        if (isCreateMode) { setTags(next); return; }
                        setTagSaving(true);
                        try {
                          const updated = await businessRelationsApi.updateApplication(application!.business_application_id, { tags: next });
                          setTags(Array.isArray(updated.tags) ? updated.tags : next);
                        } catch { setTags(next); }
                        finally { setTagSaving(false); }
                      }
                    }}
                    placeholder="Type a tag and press Enter…"
                    disabled={tagSaving}
                    className="text-[11px] bg-transparent outline-none text-slate-500 placeholder:text-slate-300 min-w-[60px]"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <HintLabel label="Visibility" />
                <select
                  value={visibility}
                  onChange={async e => {
                    const next = e.target.value;
                    setVisibility(next);
                    if (isCreateMode || !application) return;
                    try {
                      const updated = await businessRelationsApi.updateApplication(application.business_application_id, { visibility: next });
                      setApplication(updated);
                      setVisibility(updated.visibility ?? next);
                    } catch { setVisibility(application.visibility ?? 'internal'); }
                  }}
                  className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 capitalize"
                >
                  <option value="internal">Internal</option>
                  <option value="public">Public</option>
                  <option value="restricted">Restricted</option>
                  <option value="confidential">Confidential</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <HintLabel label="Sensitive" />
                <select
                  value={sensitive ? 'true' : 'false'}
                  onChange={async e => {
                    const next = e.target.value === 'true';
                    setSensitive(next);
                    if (isCreateMode || !application) return;
                    try {
                      const updated = await businessRelationsApi.updateApplication(application.business_application_id, { sensitive: next });
                      setApplication(updated);
                      setSensitive(updated.sensitive ?? next);
                    } catch { setSensitive(application.sensitive ?? false); }
                  }}
                  className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5"
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </div>
            </div>
          </Section>

          <Section title="Agent Risk Exposure">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ReadValue label="# Of Associated Agents" value={form.num_of_associated_agents} hint={HINTS.num_of_associated_agents} />
              <ReadValue label="Agent Risk Exposure (ARE)" value={form.agent_risk_exposure} hint={HINTS.agent_risk_exposure} />
              <ReadValue label="Agent Risk Tier (ART)" value={labelFromOptions(form.agent_risk_tier, AGENT_RISK_TIER_OPTIONS)} hint={HINTS.agent_risk_tier} />
              <ReadValue label="Blended Risk Score" value={form.blended_risk_score} />
              <ReadValue label="Inherent Risk Classification" value={labelFromOptions(form.inherent_risk_classification, INHERENT_RESIDUAL_OPTIONS)} />
              <ReadValue label="Inherent Risk Classification Score" value={form.inherent_risk_classification_score} />
              <ReadValue label="Residual Risk Classification" value={labelFromOptions(form.residual_risk_classification, INHERENT_RESIDUAL_OPTIONS)} />
              <ReadValue label="Residual Risk Classification Score" value={form.residual_risk_classification_score} />
            </div>
          </Section>

          <Section title="Embedded AI">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <HintLabel label="Embedded AI Exists" />
                {editing ? (
                  <select value={form.embedded_ai} onChange={(e) => setField('embedded_ai', e.target.value)} className={inputCls}>
                    <option value="">Select...</option>
                    {YES_NO_NONE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                ) : (
                  renderInlineEditable('embedded_ai', labelFromOptions(form.embedded_ai, YES_NO_NONE_OPTIONS), {
                    kind: 'select',
                    options: YES_NO_NONE_OPTIONS,
                  })
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <HintLabel label="Opt Out Option" />
                {editing ? (
                  <select value={form.opt_out_option} onChange={(e) => setField('opt_out_option', e.target.value)} className={inputCls}>
                    <option value="">Select...</option>
                    {YES_NO_NONE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                ) : (
                  renderInlineEditable('opt_out_option', labelFromOptions(form.opt_out_option, YES_NO_NONE_OPTIONS), {
                    kind: 'select',
                    options: YES_NO_NONE_OPTIONS,
                  })
                )}
              </div>

              <div className="md:col-span-2 flex flex-col gap-1.5">
                <HintLabel label="Privacy Policy URL" />
                {editing ? (
                  <input
                    value={form.privacy_policy_url}
                    onChange={(e) => setField('privacy_policy_url', e.target.value)}
                    className={inputCls}
                    placeholder="https://..."
                  />
                ) : (
                  renderInlineEditable('privacy_policy_url', form.privacy_policy_url || 'N/A', {
                    className: 'text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 break-all',
                  })
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <HintLabel label="Data Specifically Excluded from AI Training" />
                {editing ? (
                  <select
                    value={form.data_excluded_from_ai_training}
                    onChange={(e) => setField('data_excluded_from_ai_training', e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select...</option>
                    {YES_NO_NONE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                ) : (
                  renderInlineEditable('data_excluded_from_ai_training', labelFromOptions(form.data_excluded_from_ai_training, YES_NO_NONE_OPTIONS), {
                    kind: 'select',
                    options: YES_NO_NONE_OPTIONS,
                  })
                )}
              </div>

              <div className="md:col-span-2 flex flex-col gap-1.5">
                <HintLabel label="Vendor Description" />
                {editing ? (
                  <textarea
                    value={form.vendor_description}
                    onChange={(e) => setField('vendor_description', e.target.value)}
                    rows={3}
                    className={textAreaCls}
                  />
                ) : (
                  renderInlineEditable('vendor_description', form.vendor_description || 'N/A', {
                    kind: 'textarea',
                    className: 'text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 min-h-[84px]',
                  })
                )}
              </div>
            </div>
          </Section>

          <Section title="End of Life">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                ['current_installed_version', 'Current Installed Version'],
                ['latest_released_version', 'Latest Released Version'],
                ['latest_release_date', 'Latest Release Date'],
                ['latest_release_documentation_link', 'Latest Release Documentation Link'],
              ].map(([field, label]) => (
                <div key={field} className="flex flex-col gap-1.5">
                  <HintLabel label={label} />
                  {editing ? (
                    <input
                      value={form[field as keyof ApplicationFormState]}
                      onChange={(e) => setField(field as keyof ApplicationFormState, e.target.value)}
                      className={inputCls}
                    />
                  ) : (
                    renderInlineEditable(
                      field as ApplicationInlineField,
                      field === 'latest_release_date'
                        ? formatDate(form.latest_release_date)
                        : form[field as keyof ApplicationFormState] || 'N/A',
                      {
                        kind: field === 'latest_release_date' ? 'date' : 'text',
                        className: 'text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 break-all',
                      },
                    )
                  )}
                </div>
              ))}

              <div className="flex flex-col gap-1.5">
                <HintLabel label="Is current installed version supported?" />
                {editing ? (
                  <select
                    value={form.is_current_version_supported}
                    onChange={(e) => setField('is_current_version_supported', e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select...</option>
                    {YES_NO_NONE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                ) : (
                  renderInlineEditable('is_current_version_supported', labelFromOptions(form.is_current_version_supported, YES_NO_NONE_OPTIONS), {
                    kind: 'select',
                    options: YES_NO_NONE_OPTIONS,
                  })
                )}
              </div>
            </div>
          </Section>

          {/* Source Systems — shown in Details tab when entity is linked to a dimension */}
          {application?.dim_node_id && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                <p className="text-sm font-bold text-slate-700">Source Systems ({blueprintSourceRefs.length})</p>
                <button
                  onClick={() => setShowAddSourceRef(p => !p)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  <Plus size={12} /> Add
                </button>
              </div>
              {showAddSourceRef && (
                <div className="px-5 py-3 border-b border-slate-100 flex flex-col gap-2">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input value={newSysName} onChange={e => setNewSysName(e.target.value)} placeholder="System name (e.g. Salesforce)" className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500" />
                    <input value={newExtId} onChange={e => setNewExtId(e.target.value)} placeholder="External ID" className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500" />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        if (!newSysName.trim() || !newExtId.trim() || !application.dim_node_id) return;
                        setAddingRef(true);
                        try {
                          const ref = await blueprintApi.createSourceRef(application.dim_node_id, newSysName.trim(), newExtId.trim());
                          setBlueprintSourceRefs(p => [...p, ref]);
                          setNewSysName(''); setNewExtId(''); setShowAddSourceRef(false);
                        } finally { setAddingRef(false); }
                      }}
                      disabled={addingRef || !newSysName.trim() || !newExtId.trim()}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {addingRef ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Save
                    </button>
                    <button onClick={() => { setShowAddSourceRef(false); setNewSysName(''); setNewExtId(''); }} className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50">Cancel</button>
                  </div>
                </div>
              )}
              {blueprintSourceRefs.length === 0 ? (
                <div className="px-5 py-4 text-sm text-slate-400 italic">No source systems linked.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {blueprintSourceRefs.map(ref => (
                    <div key={ref.id} className="px-5 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-700">{ref.system_name}</p>
                        <p className="text-[11px] font-mono text-slate-400 truncate">{ref.external_id}</p>
                      </div>
                      <button
                        onClick={async () => {
                          setDeletingRef(ref.id);
                          try { await blueprintApi.deleteSourceRef(ref.id); setBlueprintSourceRefs(p => p.filter(r => r.id !== ref.id)); }
                          finally { setDeletingRef(null); }
                        }}
                        disabled={deletingRef === ref.id}
                        className="p-1.5 text-slate-300 hover:text-red-500 transition-colors disabled:opacity-50"
                        title="Delete"
                      >
                        {deletingRef === ref.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'related_use_cases' && application && (
        <div className="flex flex-col gap-4">
          {useCaseRelationError && (
            <div className="flex items-start gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {useCaseRelationError}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <p className="text-sm font-bold text-slate-700">Currently Related AI Use Cases ({relatedUseCaseCount})</p>
            </div>
            <div className="divide-y divide-slate-100">
              {relatedUseCases.length === 0 && (
                <div className="p-5 text-sm text-slate-500">No AI use cases linked.</div>
              )}
              {relatedUseCases.map((rel, idx) => {
                const useCaseId = rel.identifier || `missing-${idx}`;
                const catalogMatch = allUseCases.find((uc) => uc.identifier === useCaseId);
                const displayName = rel.name || catalogMatch?.name || useCaseId;
                const busy = actingUseCase === useCaseId;
                return (
                  <div key={`${useCaseId}-${idx}`} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        to={`/use-case/${encodeURIComponent(useCaseId)}`}
                        className="text-sm font-semibold text-blue-600 hover:underline"
                      >
                        {displayName}
                      </Link>
                      <p className="text-[11px] font-mono text-slate-400 truncate">{useCaseId}</p>
                    </div>
                    <button
                      onClick={() => removeUseCase(useCaseId)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <Unlink2 size={12} />}
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm font-bold text-slate-700">Add AI Use Case Relation</p>
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full max-w-[520px] ml-auto justify-end">
                <Link
                  to={`/use-cases/new?linkApplicationId=${encodeURIComponent(application.business_application_id)}`}
                  className="inline-flex shrink-0 items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700"
                >
                  <PlusCircle size={12} />
                  Create AI Use Case
                </Link>
                <div className="relative w-full sm:w-[320px] max-w-full">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={searchUseCases}
                    onChange={(e) => setSearchUseCases(e.target.value)}
                    placeholder="Filter AI use cases..."
                    className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>
            </div>
            <div className="divide-y divide-slate-100 max-h-[320px] overflow-y-auto">
              {availableUseCases.length === 0 && (
                <div className="p-5 text-sm text-slate-500">No available AI use cases to link.</div>
              )}
              {availableUseCases.map((useCase) => {
                const useCaseId = useCase.identifier || '';
                const busy = actingUseCase === useCaseId;
                return (
                  <div key={useCaseId} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-700 truncate">{useCase.name || useCaseId}</p>
                      <p className="text-[11px] font-mono text-slate-400 truncate">{useCaseId}</p>
                    </div>
                    <button
                      onClick={() => addUseCase(useCaseId)}
                      disabled={!useCaseId || busy}
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
      )}

      {tab === 'related' && application && (
        <div className="flex flex-col gap-4">
          {relationError && (
            <div className="flex items-start gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {relationError}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <p className="text-sm font-bold text-slate-700">Currently Related Agents ({relatedAgentCount})</p>
            </div>
            <div className="divide-y divide-slate-100">
              {application.related_agents.length === 0 && (
                <div className="p-5 text-sm text-slate-500">No agents linked.</div>
              )}
              {application.related_agents.map((rel, idx) => {
                const relId = rel.agent_id || `missing-${idx}`;
                const displayName = rel.agent_id
                  ? (agentNameById.get(rel.agent_id) || rel.agent_name || rel.agent_id)
                  : (rel.agent_name || 'Unknown Agent');
                return (
                  <div key={`${relId}-${idx}`} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      {rel.agent_id ? (
                        <Link to={`/agent/${encodeURIComponent(rel.agent_id)}`} className="text-sm font-semibold text-blue-600 hover:underline">
                          {displayName}
                        </Link>
                      ) : (
                        <p className="text-sm font-semibold text-slate-700">{displayName}</p>
                      )}
                    </div>
                    <button
                      onClick={() => rel.agent_id && removeAgent(rel.agent_id)}
                      disabled={!rel.agent_id || actingAgent === rel.agent_id}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {actingAgent === rel.agent_id ? <Loader2 size={12} className="animate-spin" /> : <Unlink2 size={12} />}
                      Remove
                    </button>
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
                  value={searchAgents}
                  onChange={(e) => setSearchAgents(e.target.value)}
                  placeholder="Filter agents..."
                  className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
            <div className="divide-y divide-slate-100 max-h-[320px] overflow-y-auto">
              {availableAgents.length === 0 && (
                <div className="p-5 text-sm text-slate-500">No available agents to link.</div>
              )}
              {availableAgents.map(agent => {
                const agentId = agent.identification?.agent_id || '';
                const busy = actingAgent === agentId;
                return (
                  <div key={agentId} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-700 truncate">{agent.name}</p>
                      <p className="text-[11px] font-mono text-slate-400 truncate">{agentId}</p>
                    </div>
                    <button
                      onClick={() => addAgent(agentId)}
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
      )}

      {tab === 'related_ai_models' && application && (
        <div className="flex flex-col gap-4">
          {modelRelationError && (
            <div className="flex items-start gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {modelRelationError}
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
              {linkedModels.map((model, idx) => {
                const modelId = model.ai_model_id || `missing-${idx}`;
                const busy = actingModel === modelId;
                return (
                  <div key={`${modelId}-${idx}`} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Link to={`/ai-models/${encodeURIComponent(modelId)}`} className="text-sm font-semibold text-blue-600 hover:underline">
                        {model.model_name || modelId}
                      </Link>
                      <p className="text-[11px] font-mono text-slate-400 truncate">{modelId}</p>
                    </div>
                    <button
                      onClick={() => removeModel(modelId)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <Unlink2 size={12} />}
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
                  to={`/ai-models/new?linkApplicationId=${encodeURIComponent(application.business_application_id)}`}
                  className="inline-flex shrink-0 items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700"
                >
                  <PlusCircle size={12} />
                  Create Model
                </Link>
                <div className="relative w-full sm:w-[320px] max-w-full">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={searchModels}
                    onChange={(e) => setSearchModels(e.target.value)}
                    placeholder="Filter AI models..."
                    className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>
            </div>
            <div className="divide-y divide-slate-100 max-h-[320px] overflow-y-auto">
              {availableModels.length === 0 && (
                <div className="p-5 text-sm text-slate-500">No available AI models to link.</div>
              )}
              {availableModels.map(model => {
                const busy = actingModel === model.ai_model_id;
                return (
                  <div key={model.ai_model_id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-700 truncate">{model.model_name || model.ai_model_id}</p>
                      <p className="text-[11px] font-mono text-slate-400 truncate">{model.ai_model_id}</p>
                    </div>
                    <button
                      onClick={() => addModel(model.ai_model_id)}
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
      )}
      {tab === 'blueprint' && (
        <div className="flex flex-col gap-4">
          {application?.dim_node_id ? (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                <p className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <Network size={14} className="text-slate-400" />
                  Blueprint Relationships ({blueprintEdges.length})
                </p>
                <button onClick={() => setShowAddEdge(true)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700">
                  <Plus size={12} /> Add Relationship
                </button>
              </div>
              {blueprintLoading ? (
                <div className="px-5 py-4 text-sm text-slate-400 animate-pulse">Loading…</div>
              ) : blueprintEdges.length === 0 ? (
                <div className="px-5 py-5 text-sm text-slate-400 italic">No blueprint relationships defined.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {blueprintEdges.map(edge => {
                    const isSource = edge.source_id === application.dim_node_id;
                    const otherLabel = isSource ? edge.target_label : edge.source_label;
                    return (
                      <div key={edge.id} className="px-5 py-3 flex items-center gap-3">
                        <span className="text-slate-300">{isSource ? '→' : '←'}</span>
                        <span className="text-sm font-semibold text-slate-700 flex-1 truncate">{otherLabel ?? '—'}</span>
                        <span className="text-[11px] font-mono text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">{edge.rel_type.replace('_', ' ')}</span>
                        <span className="text-[11px] text-slate-400">{Math.round(edge.weight * 100)}%</span>
                        <button
                          onClick={async () => {
                            setDeletingEdge(edge.id);
                            try { await blueprintApi.deleteEdge(edge.id); setBlueprintEdges(p => p.filter(e => e.id !== edge.id)); }
                            finally { setDeletingEdge(null); }
                          }}
                          disabled={deletingEdge === edge.id}
                          className="p-1 text-slate-300 hover:text-red-500 transition-colors disabled:opacity-50 flex-shrink-0"
                          title="Delete relationship"
                        >
                          {deletingEdge === edge.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-slate-50 rounded-2xl border border-slate-200 px-5 py-6 text-center">
              <Info size={18} className="mx-auto text-slate-300 mb-2" />
              <p className="text-sm text-slate-400">This application is not yet linked to a Blueprint dimension.</p>
              <p className="text-xs text-slate-400 mt-1">Create an Application dimension in the Blueprint to enable relationships.</p>
            </div>
          )}
          {showAddEdge && application?.dim_node_id && (
            <AddDimEdgeModal
              sourceNode={{
                id: application.dim_node_id,
                company_id: activeCompany?.id ?? '',
                dim_type_id: '',
                label: application.application_name ?? '',
                category: 'application',
                dim_type_name: 'Application',
                summary: null,
                tags: [],
                visibility: 'internal',
                sensitive: false,
                valid_from: new Date().toISOString(),
                valid_to: null,
                updated_at: new Date().toISOString(),
              }}
              onClose={() => setShowAddEdge(false)}
              onCreated={() => {
                setShowAddEdge(false);
                if (application.dim_node_id) loadBlueprint(application.dim_node_id);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default BusinessApplicationViewPage;
