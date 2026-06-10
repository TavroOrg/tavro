import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Workflow,
  CheckCircle2,
  Info,
  Loader2,
  Pencil,
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
import type {
  BusinessProcessRecord,
  BusinessProcessUpsertPayload,
} from '../types/businessRelations';
import { useCatalog } from '../context/CatalogContext';
import { useUseCases } from '../context/UseCaseContext';

type Tab = 'overview' | 'related_agents' | 'related_processes' | 'related_use_cases';
type Option = { label: string; value: string };

const BUSINESS_CRITICALITY_OPTIONS: Option[] = [
  { label: 'Tier 1 (Systemic)', value: '1.0' },
  { label: 'Tier 2 (Core)', value: '0.7' },
  { label: 'Tier 3 (Operational)', value: '0.4' },
  { label: 'Tier 4 (Experimental)', value: '0.1' },
];

const REPUTATIONAL_IMPACT_OPTIONS: Option[] = [
  { label: 'Toxic', value: '1' },
  { label: 'Adverse', value: '0.7' },
  { label: 'Private', value: '0.4' },
  { label: 'Contained', value: '0.1' },
];

const FINANCIAL_IMPACT_OPTIONS: Option[] = [
  { label: 'Systemic', value: '1' },
  { label: 'Material', value: '0.7' },
  { label: 'Absorbable', value: '0.4' },
  { label: 'Immaterial', value: '0.1' },
];

const REGULATORY_IMPACT_OPTIONS: Option[] = [
  { label: 'Restricted', value: '1' },
  { label: 'Statutory', value: '0.7' },
  { label: 'Governed', value: '0.4' },
  { label: 'Unregulated', value: '0.1' },
];

const PROCESS_HEALTH_OPTIONS: Option[] = [
  { label: 'Stable', value: 'Stable' },
  { label: 'Needs Improvement', value: 'Needs Improvement' },
  { label: 'At Risk', value: 'At Risk' },
];

interface ProcessFormState {
  process_number: string;
  process_name: string;
  process_description: string;
  parent_process_id: string;
  stakeholders: string;
  owner: string;
  operators: string;
  business_criticality: string;
  reputational_impact: string;
  num_of_associated_agents: string;
  agent_risk_tier: string;
  residual_risk_classification: string;
  inherent_risk_classification: string;
  financial_impact: string;
  regulatory_impact: string;
  agent_risk_exposure: string;
  blended_risk_score: string;
  residual_risk_classification_score: string;
  inherent_risk_classification_score: string;
  sla: string;
  process_health_state: string;
}

type ProcessInlineField =
  | 'process_number'
  | 'process_name'
  | 'process_description'
  | 'parent_process_id'
  | 'stakeholders'
  | 'owner'
  | 'operators'
  | 'business_criticality'
  | 'reputational_impact'
  | 'financial_impact'
  | 'regulatory_impact'
  | 'sla'
  | 'process_health_state';

const HINTS: Record<string, string> = {
  business_criticality:
    'Business Criticality indicates how essential a process is. Tier 1 is mission-critical and Tier 4 has minimal business impact.',
  reputational_impact:
    'Reputational Impact captures external visibility risk from Toxic to Contained.',
  financial_impact:
    'Financial Impact captures severity from Systemic to Immaterial.',
  regulatory_impact:
    'Regulatory Impact captures compliance exposure from Restricted to Unregulated.',
  associated_agents:
    'Indicates the total number of agents associated with the process.',
  agent_risk_exposure:
    'ARE represents process risk using highest related agent AIVSS and average criticality/financial/reputational/regulatory impacts.',
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

const emptyForm = (): ProcessFormState => ({
  process_number: '',
  process_name: '',
  process_description: '',
  parent_process_id: '',
  stakeholders: '',
  owner: '',
  operators: '',
  business_criticality: '',
  reputational_impact: '',
  num_of_associated_agents: '0',
  agent_risk_tier: '',
  residual_risk_classification: '',
  inherent_risk_classification: '',
  financial_impact: '',
  regulatory_impact: '',
  agent_risk_exposure: '0',
  blended_risk_score: '0',
  residual_risk_classification_score: '0',
  inherent_risk_classification_score: '0',
  sla: '',
  process_health_state: '',
});

const formFromProcess = (proc: BusinessProcessRecord): ProcessFormState => ({
  process_number: toText(proc.process_number),
  process_name: toText(proc.process_name),
  process_description: toText(proc.process_description),
  parent_process_id: toText(proc.parent_process_id),
  stakeholders: toText(proc.stakeholders),
  owner: toText(proc.owner),
  operators: toText(proc.operators),
  business_criticality: toText(proc.business_criticality),
  reputational_impact: toText(proc.reputational_impact),
  num_of_associated_agents: toText(proc.num_of_associated_agents, '0'),
  agent_risk_tier: toText(proc.agent_risk_tier),
  residual_risk_classification: toText(proc.residual_risk_classification),
  inherent_risk_classification: toText(proc.inherent_risk_classification),
  financial_impact: toText(proc.financial_impact),
  regulatory_impact: toText(proc.regulatory_impact),
  agent_risk_exposure: toText(proc.agent_risk_exposure, '0'),
  blended_risk_score: toText(proc.blended_risk_score, '0'),
  residual_risk_classification_score: toText(proc.residual_risk_classification_score, '0'),
  inherent_risk_classification_score: toText(proc.inherent_risk_classification_score, '0'),
  sla: toText(proc.sla),
  process_health_state: toText(proc.process_health_state),
});

const buildProcessPayload = (form: ProcessFormState): BusinessProcessUpsertPayload => ({
  process_number: toNullable(form.process_number),
  process_name: toNullable(form.process_name),
  process_description: toNullable(form.process_description),
  parent_process_id: toNullable(form.parent_process_id),
  stakeholders: toNullable(form.stakeholders),
  owner: toNullable(form.owner),
  operators: toNullable(form.operators),
  business_criticality: toNullable(form.business_criticality),
  reputational_impact: toNullable(form.reputational_impact),
  financial_impact: toNullable(form.financial_impact),
  regulatory_impact: toNullable(form.regulatory_impact),
  sla: toNullable(form.sla),
  process_health_state: toNullable(form.process_health_state),
});

const labelFromOptions = (value: string, options: Option[]): string => {
  if (!value) return 'N/A';
  const found = options.find(o => o.value === value);
  return found ? found.label : value;
};

type HeaderMetricMeta = {
  label: string;
  tone: 'high' | 'medium' | 'low' | 'neutral';
};

const getImpactMeta = (value: string, options: Option[]): HeaderMetricMeta => {
  const label = labelFromOptions(value, options);
  if (label === 'N/A') return { label, tone: 'neutral' };

  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    if (numeric >= 0.95) return { label, tone: 'high' };
    if (numeric >= 0.65) return { label, tone: 'medium' };
    return { label, tone: 'low' };
  }

  const normalized = label.toLowerCase();
  if (normalized.includes('restricted') || normalized.includes('toxic') || normalized.includes('systemic')) {
    return { label, tone: 'high' };
  }
  if (normalized.includes('statutory') || normalized.includes('adverse') || normalized.includes('material')) {
    return { label, tone: 'medium' };
  }
  return { label, tone: 'low' };
};

const metricToneClass = (tone: HeaderMetricMeta['tone']) => {
  if (tone === 'high') return 'text-red-600';
  if (tone === 'medium') return 'text-amber-600';
  if (tone === 'low') return 'text-emerald-600';
  return 'text-slate-600';
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

const BusinessProcessViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { agents } = useCatalog();
  const { useCases: allUseCases, refresh: refreshUseCases } = useUseCases();
  const isCreateMode = !id || id === 'new';
  const linkAgentId = (searchParams.get('linkAgentId') || '').trim();
  const linkUseCaseId = (searchParams.get('linkUseCaseId') || '').trim();

  const [process, setProcess] = useState<BusinessProcessRecord | null>(null);
  const [form, setForm] = useState<ProcessFormState>(emptyForm);
  const [allProcesses, setAllProcesses] = useState<BusinessProcessRecord[]>([]);
  const [loading, setLoading] = useState(!isCreateMode);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(isCreateMode);
  const [saving, setSaving] = useState(false);
  const [inlineEdit, setInlineEdit] = useState<{ field: ProcessInlineField; value: string } | null>(null);
  const [inlineSaving, setInlineSaving] = useState<ProcessInlineField | null>(null);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [searchAgents, setSearchAgents] = useState('');
  const [searchUseCases, setSearchUseCases] = useState('');
  const [actingAgent, setActingAgent] = useState<string | null>(null);
  const [actingUseCase, setActingUseCase] = useState<string | null>(null);
  const [relationError, setRelationError] = useState<string | null>(null);
  const [useCaseRelationError, setUseCaseRelationError] = useState<string | null>(null);

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) {
      const aid = a.identification?.agent_id;
      if (aid) map.set(aid, a.name);
    }
    return map;
  }, [agents]);

  const processNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of allProcesses) {
      map.set(p.business_process_id, p.process_name || p.business_process_id);
    }
    return map;
  }, [allProcesses]);

  const processById = useMemo(() => {
    const map = new Map<string, BusinessProcessRecord>();
    for (const p of allProcesses) {
      map.set(p.business_process_id, p);
    }
    return map;
  }, [allProcesses]);

  const loadParentOptions = async () => {
    try {
      const data = await businessRelationsApi.listProcesses();
      setAllProcesses(data);
    } catch {
      setAllProcesses([]);
    }
  };

  const load = async () => {
    if (!id || isCreateMode) return;
    setLoading(true);
    setError(null);
    setRelationError(null);
    setUseCaseRelationError(null);
    try {
      const [proc, processes] = await Promise.all([
        businessRelationsApi.getProcess(id),
        businessRelationsApi.listProcesses(),
      ]);
      setProcess(proc);
      setForm(formFromProcess(proc));
      setAllProcesses(processes);
      setAttemptedSave(false);
    } catch (err: any) {
      setError(err.message || 'Failed to load business process');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isCreateMode) {
      setProcess(null);
      setForm(emptyForm());
      setEditing(true);
      setInlineEdit(null);
      setAttemptedSave(false);
      setLoading(false);
      setTab('overview');
      setError(null);
      loadParentOptions();
      return;
    }
    setEditing(false);
    setInlineEdit(null);
    load();
  }, [id, isCreateMode]);

  const linkedAgentIds = useMemo(() => {
    const set = new Set<string>();
    for (const rel of process?.related_agents ?? []) {
      if (rel.agent_id) set.add(rel.agent_id);
    }
    return set;
  }, [process]);

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
    return process?.related_use_cases ?? [];
  }, [process]);

  const linkedUseCaseIds = useMemo(() => {
    const ids = new Set<string>();
    relatedUseCases.forEach((useCase) => {
      if (useCase.identifier) ids.add(useCase.identifier);
    });
    return ids;
  }, [relatedUseCases]);

  const availableUseCases = useMemo(() => {
    const q = searchUseCases.trim().toLowerCase();
    return allUseCases.filter((useCase) => {
      const useCaseId = useCase.identifier || '';
      if (!useCaseId || linkedUseCaseIds.has(useCaseId)) return false;
      if (!q) return true;
      return (
        useCaseId.toLowerCase().includes(q) ||
        (useCase.name ?? '').toLowerCase().includes(q) ||
        (useCase.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [allUseCases, linkedUseCaseIds, searchUseCases]);

  const relatedProcessRows = useMemo(() => {
    if (!process) return [];
    const seen = new Set<string>();
    const rows: Array<{
      business_process_id: string;
      process_name: string | null;
      relationship_type: string | null;
      full: BusinessProcessRecord | null;
    }> = [];

    for (const rel of process.related_processes ?? []) {
      const relId = rel.business_process_id;
      if (!relId || seen.has(relId)) continue;
      seen.add(relId);
      rows.push({
        business_process_id: relId,
        process_name: rel.process_name,
        relationship_type: rel.relationship_type,
        full: processById.get(relId) ?? null,
      });
    }
    return rows;
  }, [process, processById]);

  const setField = (key: keyof ProcessFormState, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const startInlineEdit = (field: ProcessInlineField) => {
    if (editing || isCreateMode || saving || inlineSaving) return;
    setActionError(null);
    setInlineEdit({ field, value: form[field] });
  };

  const cancelInlineEdit = () => {
    setInlineEdit(null);
    setActionError(null);
  };

  const saveInlineEdit = async () => {
    if (!process || !inlineEdit) return;
    const nextForm = { ...form, [inlineEdit.field]: inlineEdit.value };
    if (!nextForm.process_name.trim()) {
      setActionError('Process Name is required.');
      return;
    }

    setInlineSaving(inlineEdit.field);
    setActionError(null);
    try {
      const updated = await businessRelationsApi.updateProcess(
        process.business_process_id,
        buildProcessPayload(nextForm),
      );
      setProcess(updated);
      setForm(formFromProcess(updated));
      setInlineEdit(null);
      setAttemptedSave(false);
    } catch (err: any) {
      setActionError(err.message || 'Failed to save process field');
    } finally {
      setInlineSaving(null);
    }
  };

  const renderInlineEditable = (
    field: ProcessInlineField,
    displayValue: string,
    config: { kind?: 'text' | 'textarea' | 'select'; options?: Option[]; className?: string; selectChildren?: React.ReactNode } = {},
  ) => {
    const isActive = inlineEdit?.field === field;
    const kind = config.kind ?? 'text';
    const valueClass = config.className ?? 'text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5';
    const isSavingField = inlineSaving === field;
    const saveDisabled = isSavingField || (field === 'process_name' && !inlineEdit?.value.trim());

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
              {config.selectChildren ?? (
                <>
                  <option value="">Select...</option>
                  {(config.options ?? []).map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </>
              )}
            </select>
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
              title={field === 'process_name' && !inlineEdit.value.trim() ? 'Process Name is required' : 'Save'}
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
    if (!form.process_name.trim()) {
      setActionError('Process Name is required before generating the description.');
      return;
    }

    setGeneratingDescription(true);
    setActionError(null);
    try {
      const result = await businessRelationsApi.suggestProcessDescription(form.process_name.trim());
      if (result.description) {
        setField('process_description', result.description);
      }
    } catch (err: any) {
      setActionError(err.message || 'Failed to generate process description');
    } finally {
      setGeneratingDescription(false);
    }
  };

  const isProcessNameMissing = !form.process_name.trim();

  const handleSave = async () => {
    setAttemptedSave(true);
    if (isProcessNameMissing) {
      setActionError('Process Name is required.');
      return;
    }

    setSaving(true);
    setActionError(null);
    try {
      const payload = buildProcessPayload(form);
      if (isCreateMode) {
        const created = await businessRelationsApi.createProcess(payload);
        if (linkAgentId) {
          try {
            await businessRelationsApi.linkAgentToProcess(linkAgentId, created.business_process_id);
          } catch (linkErr) {
            console.warn('Process created but auto-link to agent failed.', linkErr);
          }
        }
        if (linkUseCaseId) {
          try {
            await useCaseApi.linkProcess(linkUseCaseId, created.business_process_id);
          } catch (linkErr) {
            console.warn('Process created but auto-link to AI use case failed.', linkErr);
          }
          window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
          navigate(`/use-case/${encodeURIComponent(linkUseCaseId)}`, { replace: true });
          return;
        }
        window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
        navigate(`/processes/${encodeURIComponent(created.business_process_id)}`, { replace: true });
        return;
      }
      if (!process) return;
      const updated = await businessRelationsApi.updateProcess(process.business_process_id, payload);
      setProcess(updated);
      setForm(formFromProcess(updated));
      setAttemptedSave(false);
      setInlineEdit(null);
      setEditing(false);
    } catch (err: any) {
      setActionError(err.message || 'Failed to save process');
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
      navigate('/processes');
      return;
    }
    if (process) setForm(formFromProcess(process));
    setEditing(false);
  };

  const handleDelete = async () => {
    if (!process) return;
    const ok = window.confirm(`Delete process "${process.process_name || process.business_process_id}"?`);
    if (!ok) return;
    setDeleting(true);
    setActionError(null);
    try {
      await businessRelationsApi.deleteProcess(process.business_process_id);
      window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
      navigate('/processes');
    } catch (err: any) {
      setActionError(err.message || 'Failed to delete process');
      setDeleting(false);
    }
  };

  const addAgent = async (agentId: string) => {
    if (!process) return;
    setActingAgent(agentId);
    setRelationError(null);
    try {
      await businessRelationsApi.linkAgentToProcess(agentId, process.business_process_id);
      await load();
    } catch (err: any) {
      setRelationError(err.message || 'Failed to add relation');
    } finally {
      setActingAgent(null);
    }
  };

  const removeAgent = async (agentId: string) => {
    if (!process) return;
    setActingAgent(agentId);
    setRelationError(null);
    try {
      await businessRelationsApi.unlinkAgentFromProcess(agentId, process.business_process_id);
      await load();
    } catch (err: any) {
      setRelationError(err.message || 'Failed to remove relation');
    } finally {
      setActingAgent(null);
    }
  };

  const addUseCase = async (useCaseId: string) => {
    if (!process) return;
    setActingUseCase(useCaseId);
    setUseCaseRelationError(null);
    try {
      await useCaseApi.linkProcess(useCaseId, process.business_process_id);
      await load();
      refreshUseCases();
    } catch (err: any) {
      setUseCaseRelationError(err.message || 'Failed to add AI use case relation');
    } finally {
      setActingUseCase(null);
    }
  };

  const removeUseCase = async (useCaseId: string) => {
    if (!process) return;
    setActingUseCase(useCaseId);
    setUseCaseRelationError(null);
    try {
      await useCaseApi.unlinkProcess(useCaseId, process.business_process_id);
      await load();
      refreshUseCases();
    } catch (err: any) {
      setUseCaseRelationError(err.message || 'Failed to remove AI use case relation');
    } finally {
      setActingUseCase(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500">
        <Loader2 size={16} className="animate-spin" />
        Loading process details...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <button
          onClick={() => navigate('/processes')}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> Back to Processes
        </button>
        <div className="flex items-start gap-3 text-red-500 bg-red-50 border border-red-200 rounded-xl px-6 py-4">
          <AlertCircle size={20} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-bold text-sm">Could not load process</p>
            <p className="text-xs mt-1 text-red-400">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const processTitle = form.process_name || process?.process_name || 'New Process';
  const processId = process?.business_process_id || 'Will be generated on create';
  const currentProcessId = process?.business_process_id || '';
  const relatedAgentCount = process?.related_agents?.length ?? 0;
  const relatedProcessCount = relatedProcessRows.length;
  const relatedUseCaseCount = relatedUseCases.length;
  const businessCriticalityMeta = getImpactMeta(form.business_criticality, BUSINESS_CRITICALITY_OPTIONS);
  const financialImpactMeta = getImpactMeta(form.financial_impact, FINANCIAL_IMPACT_OPTIONS);
  const reputationalImpactMeta = getImpactMeta(form.reputational_impact, REPUTATIONAL_IMPACT_OPTIONS);
  const regulatoryImpactMeta = getImpactMeta(form.regulatory_impact, REGULATORY_IMPACT_OPTIONS);

  const selectableParents = allProcesses.filter(
    p => p.business_process_id !== currentProcessId,
  );

  return (
    <div className="flex flex-col gap-6 w-full animate-fade-in max-w-[1400px] mx-auto pb-10">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={() => {
            if (isCreateMode && linkUseCaseId) {
              navigate(`/use-case/${encodeURIComponent(linkUseCaseId)}`);
              return;
            }
            navigate('/processes');
          }}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> {isCreateMode && linkUseCaseId ? 'Back to AI Use Case' : 'Back to Processes'}
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
                disabled={saving || !form.process_name.trim()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {isCreateMode ? 'Create Process' : 'Save'}
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
              <Workflow size={24} />
            </div>
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Process</span>
              <h2 className="text-2xl font-bold text-slate-800 tracking-tight truncate">{processTitle}</h2>
              <p className="text-xs font-mono text-slate-400 mt-1">{processId}</p>
              <p className="text-sm text-slate-600 line-clamp-2">
                {form.process_description || 'No description available.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 shrink-0 w-full md:w-auto mt-2 md:mt-0">
            <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[170px]">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">
                Business Criticality
              </span>
              <span className={`inline-flex items-center gap-1 text-xs font-bold ${metricToneClass(businessCriticalityMeta.tone)}`}>
                {businessCriticalityMeta.tone === 'low' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                {businessCriticalityMeta.label}
              </span>
            </div>

            <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[170px]">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">
                Financial Impact
              </span>
              <span className={`inline-flex items-center gap-1 text-xs font-bold ${metricToneClass(financialImpactMeta.tone)}`}>
                {financialImpactMeta.tone === 'low' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                {financialImpactMeta.label}
              </span>
            </div>

            <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[170px]">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">
                Reputational Impact
              </span>
              <span className={`inline-flex items-center gap-1 text-xs font-bold ${metricToneClass(reputationalImpactMeta.tone)}`}>
                {reputationalImpactMeta.tone === 'low' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                {reputationalImpactMeta.label}
              </span>
            </div>

            <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[170px]">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">
                Regulatory Impact
              </span>
              <span className={`inline-flex items-center gap-1 text-xs font-bold ${metricToneClass(regulatoryImpactMeta.tone)}`}>
                {regulatoryImpactMeta.tone === 'low' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                {regulatoryImpactMeta.label}
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
              onClick={() => setTab('related_agents')}
              className={`px-4 py-2.5 text-sm font-bold border-b-2 transition-colors ${
                tab === 'related_agents'
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Related Agents({relatedAgentCount})
            </button>
            <button
              onClick={() => setTab('related_processes')}
              className={`px-4 py-2.5 text-sm font-bold border-b-2 transition-colors ${
                tab === 'related_processes'
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Related Processes({relatedProcessCount})
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
          </>
        )}
      </div>

      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          <Section title="Details">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <HintLabel label="Process Number" />
                {editing ? (
                  <input
                    value={form.process_number}
                    onChange={(e) => setField('process_number', e.target.value)}
                    className={inputCls}
                  />
                ) : (
                  renderInlineEditable('process_number', form.process_number || 'N/A')
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <HintLabel label="Name" required />
                {editing ? (
                  <>
                    <input
                      value={form.process_name}
                      onChange={(e) => {
                        const value = e.target.value;
                        setField('process_name', value);
                        if (attemptedSave && value.trim()) setActionError(null);
                      }}
                      className={`${inputCls} ${attemptedSave && isProcessNameMissing ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20' : ''}`}
                      aria-invalid={attemptedSave && isProcessNameMissing}
                    />
                    {attemptedSave && isProcessNameMissing && (
                      <p className="text-xs text-red-600">Process Name is required.</p>
                    )}
                  </>
                ) : (
                  renderInlineEditable('process_name', form.process_name || 'N/A')
                )}
              </div>

              <div className="md:col-span-2 flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <HintLabel label="Description" />
                  {editing && (
                    <button
                      type="button"
                      onClick={handleSuggestDescription}
                      disabled={generatingDescription || !form.process_name.trim()}
                      title={form.process_name.trim() ? 'Generate description with AI' : 'Enter a process name first'}
                      className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg border transition-all ${
                        generatingDescription
                          ? 'bg-violet-50 border-violet-200 text-violet-500 cursor-wait'
                          : form.process_name.trim()
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
                    value={form.process_description}
                    onChange={(e) => setField('process_description', e.target.value)}
                    rows={3}
                    className={`${textAreaCls} ${generatingDescription ? 'opacity-50' : ''}`}
                    disabled={generatingDescription}
                  />
                ) : (
                  renderInlineEditable('process_description', form.process_description || 'N/A', {
                    kind: 'textarea',
                    className: 'text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 min-h-[84px]',
                  })
                )}
              </div>
            </div>
          </Section>

          <Section title="Process Hierarchy and Ownership">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <HintLabel label="Parent Process ID" />
                {editing ? (
                  <select
                    value={form.parent_process_id}
                    onChange={(e) => setField('parent_process_id', e.target.value)}
                    className={inputCls}
                  >
                    <option value="">None</option>
                    {selectableParents.map(p => (
                      <option key={p.business_process_id} value={p.business_process_id}>
                        {(p.process_name || p.business_process_id)} ({p.business_process_id})
                      </option>
                    ))}
                  </select>
                ) : (
                  renderInlineEditable(
                    'parent_process_id',
                    form.parent_process_id
                      ? `${processNameById.get(form.parent_process_id) || form.parent_process_id} (${form.parent_process_id})`
                      : 'N/A',
                    {
                      kind: 'select',
                      selectChildren: (
                        <>
                          <option value="">None</option>
                          {selectableParents.map(parent => (
                            <option key={parent.business_process_id} value={parent.business_process_id}>
                              {(parent.process_name || parent.business_process_id)} ({parent.business_process_id})
                            </option>
                          ))}
                        </>
                      ),
                    },
                  )
                )}
              </div>

              {[
                ['stakeholders', 'Stakeholders'],
                ['owner', 'Owner'],
                ['operators', 'Operators'],
              ].map(([field, label]) => (
                <div key={field} className="flex flex-col gap-1.5">
                  <HintLabel label={label} />
                  {editing ? (
                    <input
                      value={form[field as keyof ProcessFormState]}
                      onChange={(e) => setField(field as keyof ProcessFormState, e.target.value)}
                      className={inputCls}
                    />
                  ) : (
                    renderInlineEditable(
                      field as ProcessInlineField,
                      form[field as keyof ProcessFormState] || 'N/A',
                    )
                  )}
                </div>
              ))}
            </div>
          </Section>

          <Section title="Business Criticality and Impact">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

              <div className="flex flex-col gap-1.5">
                <HintLabel label="Reputational Impact" hint={HINTS.reputational_impact} />
                {editing ? (
                  <select
                    value={form.reputational_impact}
                    onChange={(e) => setField('reputational_impact', e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select...</option>
                    {REPUTATIONAL_IMPACT_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  renderInlineEditable('reputational_impact', labelFromOptions(form.reputational_impact, REPUTATIONAL_IMPACT_OPTIONS), {
                    kind: 'select',
                    options: REPUTATIONAL_IMPACT_OPTIONS,
                  })
                )}
              </div>

              <ReadValue label="# Of Associated Agents" value={form.num_of_associated_agents} hint={HINTS.associated_agents} />
              <ReadValue label="Agent Risk Tier (ART)" value={form.agent_risk_tier || 'N/A'} />
              <ReadValue label="Residual Risk Classification" value={form.residual_risk_classification || 'N/A'} />
              <ReadValue label="Inherent Risk Classification" value={form.inherent_risk_classification || 'N/A'} />

              <div className="flex flex-col gap-1.5">
                <HintLabel label="Financial Impact" hint={HINTS.financial_impact} />
                {editing ? (
                  <select
                    value={form.financial_impact}
                    onChange={(e) => setField('financial_impact', e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select...</option>
                    {FINANCIAL_IMPACT_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  renderInlineEditable('financial_impact', labelFromOptions(form.financial_impact, FINANCIAL_IMPACT_OPTIONS), {
                    kind: 'select',
                    options: FINANCIAL_IMPACT_OPTIONS,
                  })
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <HintLabel label="Regulatory Impact" hint={HINTS.regulatory_impact} />
                {editing ? (
                  <select
                    value={form.regulatory_impact}
                    onChange={(e) => setField('regulatory_impact', e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select...</option>
                    {REGULATORY_IMPACT_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  renderInlineEditable('regulatory_impact', labelFromOptions(form.regulatory_impact, REGULATORY_IMPACT_OPTIONS), {
                    kind: 'select',
                    options: REGULATORY_IMPACT_OPTIONS,
                  })
                )}
              </div>

              <ReadValue label="Agent Risk Exposure (ARE)" value={form.agent_risk_exposure} hint={HINTS.agent_risk_exposure} />
              <ReadValue label="Blended Risk Score" value={form.blended_risk_score} />
              <ReadValue label="Residual Risk Classification Score" value={form.residual_risk_classification_score} />
              <ReadValue label="Inherent Risk Classification Score" value={form.inherent_risk_classification_score} />
            </div>
          </Section>

          <Section title="Compliance and Health">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <HintLabel label="SLA" />
                {editing ? (
                  <input
                    value={form.sla}
                    onChange={(e) => setField('sla', e.target.value)}
                    className={inputCls}
                  />
                ) : (
                  renderInlineEditable('sla', form.sla || 'N/A')
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <HintLabel label="Process Health State" />
                {editing ? (
                  <select
                    value={form.process_health_state}
                    onChange={(e) => setField('process_health_state', e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select...</option>
                    {PROCESS_HEALTH_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  renderInlineEditable('process_health_state', labelFromOptions(form.process_health_state, PROCESS_HEALTH_OPTIONS), {
                    kind: 'select',
                    options: PROCESS_HEALTH_OPTIONS,
                  })
                )}
              </div>
            </div>
          </Section>
        </div>
      )}

      {tab === 'related_agents' && process && (
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
              {process.related_agents.length === 0 && (
                <div className="p-5 text-sm text-slate-500">No agents linked.</div>
              )}
              {process.related_agents.map((rel, idx) => {
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

      {tab === 'related_processes' && process && (
        <div className="flex flex-col gap-4">
          <Section title={`Related Processes (${relatedProcessCount})`}>
            {relatedProcessRows.length === 0 && (
              <p className="text-sm text-slate-500">No process relationships recorded.</p>
            )}
            {relatedProcessRows.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                <div className="min-w-[980px]">
                  <div className="grid grid-cols-[2.1fr_1.2fr_1.2fr_1.1fr_1.1fr_1.2fr_1fr] items-center bg-slate-50 border-b border-slate-200 px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">
                    <div>Name</div>
                    <div>Owner</div>
                    <div>Business Criticality</div>
                    <div>Process Health State</div>
                    <div># Of Associated Agents</div>
                    <div>Agent Risk Exposure (ARE)</div>
                    <div>Agent Risk Tier (ART)</div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {relatedProcessRows.map((row) => {
                      const processId = row.business_process_id;
                      const full = row.full;
                      const processName = full?.process_name || row.process_name || processId;
                      const owner = full?.owner || 'N/A';
                      const businessCriticality = labelFromOptions(
                        toText(full?.business_criticality),
                        BUSINESS_CRITICALITY_OPTIONS,
                      );
                      const processHealthState = full?.process_health_state || 'N/A';
                      const associatedAgents = toText(full?.num_of_associated_agents, 'N/A');
                      const are = toText(full?.agent_risk_exposure, 'N/A');
                      const art = full?.agent_risk_tier || 'N/A';

                      return (
                        <div
                          key={`${processId}-${row.relationship_type ?? 'RELATED'}`}
                          className="grid grid-cols-[2.1fr_1.2fr_1.2fr_1.1fr_1.1fr_1.2fr_1fr] items-center px-5 py-3.5 text-sm text-slate-700"
                        >
                          <div className="min-w-0">
                            <Link
                              to={`/processes/${encodeURIComponent(processId)}`}
                              className="font-semibold text-blue-600 hover:underline truncate block"
                            >
                              {processName}
                            </Link>
                            <div className="text-[11px] font-mono text-slate-400 truncate">{processId}</div>
                          </div>
                          <div className="truncate">{owner}</div>
                          <div className="truncate">{businessCriticality}</div>
                          <div className="truncate">{processHealthState}</div>
                          <div>{associatedAgents}</div>
                          <div>{are}</div>
                          <div>{art}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </Section>
        </div>
      )}

      {tab === 'related_use_cases' && process && (
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
                  to={`/use-cases/new?linkProcessId=${encodeURIComponent(process.business_process_id)}`}
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
    </div>
  );
};

export default BusinessProcessViewPage;
