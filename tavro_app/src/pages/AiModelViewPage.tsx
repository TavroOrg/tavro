import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toUserMessage } from '../utils/errorUtils';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Info,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  PlusCircle,
  Save,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Unlink2,
  XCircle,
} from 'lucide-react';
import { aiModelApi } from '../services/aiModelApi';
import { agentApi } from '../services/agentApi';
import { businessRelationsApi } from '../services/businessRelationsApi';
import { useCaseApi } from '../services/useCaseApi';
import { useCatalog } from '../context/CatalogContext';
import { useUseCases } from '../context/UseCaseContext';
import { mcpClient } from '../services/mcpClient';
import { useBlueprint } from '../context/BlueprintContext';
import { useLookupValues } from '../context/LookupContext';
import type { AiModelRecord, AiModelUpsertPayload, AiModelAttachmentRecord } from '../types/aiModel';
import type { BusinessApplicationRecord, BusinessProcessRecord } from '../types/businessRelations';

type Option = { label: string; value: string };

const YES_NO_OPTIONS: Option[] = [
  { label: '-- None --', value: '' },
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
];

// Catalog field keys (everything editable in the form).
type FormState = Record<string, string>;

const FIELD_KEYS: string[] = [
  'model_name', 'owner', 'description', 'department_executive', 'business_functions',
  'vendor_or_inhouse', 'provider', 'status', 'parent_model_id', 'version_number',
  'use_case_value_drivers', 'user_types', 'decision_type', 'automation_level',
  'regulatory_mapping', 'consumer_impact', 'risk_tier_materiality',
  'model_type', 'technique_class', 'learning_approach', 'update_frequency',
  'input_variable_count', 'data_join_method', 'statistical_assumptions',
  'documented_constraints', 'stability_window', 'last_validation_date',
  'recert_use_case_same', 'recert_use_case_changed', 'recert_inputs_same', 'recert_inputs_changed',
  'recert_outputs_same', 'recert_outputs_changed', 'recert_users_same', 'recert_users_changed',
  'recert_processing_same', 'recert_processing_changed', 'recert_training_completed',
  'recert_risk_assessment_done',
  'business_criticality', 'emergency_tier',
];

const MODEL_ARE_HINTS: Record<string, string> = {
  agent_risk_exposure:
    'ARE is the highest blended risk score among related agents multiplied by the average of Business Criticality and Emergency Tier scores.',
  agent_risk_tier:
    'ART indicates overall model risk from ARE score: Low < 3, Medium 3-<7, High 7-<9, Critical >= 9. It is None when no agents are associated.',
  blended_risk_score:
    'The highest current blended risk score across agents associated with this model.',
  associated_agents:
    'Indicates the total number of agents associated with this model.',
};

const inputCls =
  'w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2.5 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-white text-slate-800 placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-500';
const textAreaCls = `${inputCls} resize-none`;

const emptyForm = (): FormState => {
  const f: FormState = {};
  FIELD_KEYS.forEach(k => { f[k] = ''; });
  return f;
};

const formFromModel = (m: AiModelRecord): FormState => {
  const f = emptyForm();
  FIELD_KEYS.forEach(k => {
    const v = (m as any)[k];
    f[k] = v === null || v === undefined ? '' : String(v);
  });
  return f;
};

const buildPayload = (form: FormState): AiModelUpsertPayload => {
  const payload: Record<string, string | null> = {};
  FIELD_KEYS.forEach(k => {
    const v = form[k].trim();
    payload[k] = v ? v : null;
  });
  return payload as AiModelUpsertPayload;
};

const changedPayload = (current: FormState, next: FormState): AiModelUpsertPayload => {
  const currentPayload = buildPayload(current);
  const nextPayload = buildPayload(next);
  const changed: Record<string, string | null> = {};
  FIELD_KEYS.forEach(key => {
    if ((nextPayload as Record<string, string | null>)[key] !== (currentPayload as Record<string, string | null>)[key]) {
      changed[key] = (nextPayload as Record<string, string | null>)[key] ?? null;
    }
  });
  return changed as AiModelUpsertPayload;
};

type MetricTone = 'high' | 'medium' | 'low' | 'neutral';
const metricToneClass = (tone: MetricTone) => {
  if (tone === 'high') return 'text-red-600';
  if (tone === 'medium') return 'text-amber-600';
  if (tone === 'low') return 'text-emerald-600';
  return 'text-slate-600';
};
const getCriticalityTone = (value: string): MetricTone => {
  const v = value.toLowerCase();
  if (v === 'high') return 'high';
  if (v === 'medium') return 'medium';
  if (v === 'low') return 'low';
  return 'neutral';
};
const getEmergencyTierTone = (value: string): MetricTone => {
  const v = value.toLowerCase();
  if (v.includes('mission critical')) return 'high';
  if (v.includes('business critical')) return 'medium';
  if (v.includes('non-critical')) return 'low';
  return 'neutral';
};
const getArtTone = (value: string | null | undefined): MetricTone => {
  const v = (value ?? '').toLowerCase();
  if (v === 'critical' || v === 'high') return 'high';
  if (v === 'medium') return 'medium';
  if (v === 'low' || v === 'none') return 'low';
  return 'neutral';
};

const Field: React.FC<{ label: string; children: React.ReactNode; full?: boolean; hint?: string }> = ({ label, children, full, hint }) => (
  <div className={`flex flex-col gap-1.5 ${full ? 'md:col-span-2' : ''}`}>
    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
      {label}
      {hint && (
        <span title={hint}>
          <Info size={12} className="text-slate-400" />
        </span>
      )}
    </label>
    {children}
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4">
    <h3 className="text-sm font-bold text-slate-800">{title}</h3>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
  </div>
);

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const AttachmentField: React.FC<{ modelId: string; category: string; label: string }> = ({ modelId, category, label }) => {
  const [items, setItems] = useState<AiModelAttachmentRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      setItems(await aiModelApi.listAttachments(modelId, category));
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, category]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      e.target.value = '';
      setBusy(true);
      setErr(null);
      try {
        const content_base64 = await fileToBase64(file);
        await aiModelApi.uploadAttachment(modelId, {
          filename: file.name,
          mime_type: file.type || 'application/octet-stream',
          content_base64,
          category,
        });
        await load();
      } catch (e2: any) {
        setErr(e2.message || 'Upload failed.');
      } finally {
        setBusy(false);
      }
    }
  };

  const onDownload = async (att: AiModelAttachmentRecord) => {
    const blob = await aiModelApi.downloadAttachment(modelId, att.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = att.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onDelete = async (att: AiModelAttachmentRecord) => {
    setBusy(true);
    try {
      await aiModelApi.deleteAttachment(modelId, att.id);
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">{label}</label>
      <div className="flex flex-col gap-2">
        {items.map(att => (
          <div key={att.id} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            <span className="text-xs text-slate-600 truncate flex items-center gap-1.5">
              <Paperclip size={12} /> {att.filename}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => onDownload(att)} className="text-slate-400 hover:text-blue-600" title="Download">
                <Download size={14} />
              </button>
              <button onClick={() => onDelete(att)} className="text-slate-400 hover:text-red-600" title="Delete">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-blue-600 hover:text-blue-700 disabled:opacity-50 w-fit"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
          Attach File
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={onPick} />
        {err && <p className="text-[11px] text-red-600">{err}</p>}
      </div>
    </div>
  );
};

const AiModelViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isCreateMode = !id || id === 'new';
  const linkAgentId = (searchParams.get('linkAgentId') || '').trim();
  const linkApplicationId = (searchParams.get('linkApplicationId') || '').trim();
  const linkProcessId = (searchParams.get('linkProcessId') || '').trim();
  const linkUseCaseId = (searchParams.get('linkUseCaseId') || '').trim();
  const { activeCompany } = useBlueprint();

  const toOptions = (values: { label: string; value: string }[]): Option[] => [
    { label: '-- None --', value: '' },
    ...values.map(v => ({ label: v.label, value: v.value })),
  ];
  const vendorValues = useLookupValues('ai_models', 'vendor_or_inhouse');
  const providerValues = useLookupValues('ai_models', 'provider');
  const modelTypeValues = useLookupValues('ai_models', 'model_type');
  const techniqueClassValues = useLookupValues('ai_models', 'technique_class');
  const learningApproachValues = useLookupValues('ai_models', 'learning_approach');
  const automationLevelValues = useLookupValues('ai_models', 'automation_level');
  const updateFrequencyValues = useLookupValues('ai_models', 'update_frequency');
  const statusValues = useLookupValues('ai_models', 'status');
  const businessCriticalityValues = useLookupValues('ai_models', 'business_criticality');
  const emergencyTierValues = useLookupValues('ai_models', 'emergency_tier');
  const vendorOptions = toOptions(vendorValues);
  const providerOptions = toOptions(providerValues);
  const modelTypeOptions = toOptions(modelTypeValues);
  const techniqueClassOptions = toOptions(techniqueClassValues);
  const learningApproachOptions = toOptions(learningApproachValues);
  const automationLevelOptions = toOptions(automationLevelValues);
  const updateFrequencyOptions = toOptions(updateFrequencyValues);
  const statusOptions = toOptions(statusValues);
  const businessCriticalityOptions = toOptions(businessCriticalityValues);
  const emergencyTierOptions = toOptions(emergencyTierValues);

  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
    if (!isCreateMode) return;
    setForm(prev => ({
      ...prev,
      vendor_or_inhouse: prev.vendor_or_inhouse || vendorValues.find(v => v.is_default)?.value || '',
      provider: prev.provider || providerValues.find(v => v.is_default)?.value || '',
      model_type: prev.model_type || modelTypeValues.find(v => v.is_default)?.value || '',
      technique_class: prev.technique_class || techniqueClassValues.find(v => v.is_default)?.value || '',
      learning_approach: prev.learning_approach || learningApproachValues.find(v => v.is_default)?.value || '',
      automation_level: prev.automation_level || automationLevelValues.find(v => v.is_default)?.value || '',
      update_frequency: prev.update_frequency || updateFrequencyValues.find(v => v.is_default)?.value || '',
      status: prev.status || statusValues.find(v => v.is_default)?.value || '',
      business_criticality: prev.business_criticality || businessCriticalityValues.find(v => v.is_default)?.value || '',
      emergency_tier: prev.emergency_tier || emergencyTierValues.find(v => v.is_default)?.value || '',
    }));
  }, [
    isCreateMode, vendorValues, providerValues, modelTypeValues, techniqueClassValues,
    learningApproachValues, automationLevelValues, updateFrequencyValues, statusValues,
    businessCriticalityValues, emergencyTierValues,
  ]);

  const [model, setModel] = useState<AiModelRecord | null>(null);
  const [allModels, setAllModels] = useState<AiModelRecord[]>([]);
  const [loading, setLoading] = useState(!isCreateMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [tab, setTab] = useState<'overview' | 'business_impact'>('overview');
  const [agentSearch, setAgentSearch] = useState('');
  const [actingAgent, setActingAgent] = useState<string | null>(null);
  const [relationError, setRelationError] = useState<string | null>(null);
  const [useCaseSearch, setUseCaseSearch] = useState('');
  const [actingUseCase, setActingUseCase] = useState<string | null>(null);
  const [applicationSearch, setApplicationSearch] = useState('');
  const [actingApplication, setActingApplication] = useState<string | null>(null);
  const [processSearch, setProcessSearch] = useState('');
  const [actingProcess, setActingProcess] = useState<string | null>(null);
  const [allApplications, setAllApplications] = useState<BusinessApplicationRecord[]>([]);
  const [allProcesses, setAllProcesses] = useState<BusinessProcessRecord[]>([]);
  const [companyUseCases, setCompanyUseCases] = useState<Array<{ identifier: string; name?: string; description?: string | null }>>([]);
  const [companyAgents, setCompanyAgents] = useState<typeof catalogAgents>([]);
  const [editing, setEditing] = useState(isCreateMode);
  const [inlineEdit, setInlineEdit] = useState<{ field: string; value: string } | null>(null);
  const [inlineSaving, setInlineSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const { agents: catalogAgents } = useCatalog();
  const { useCases: allUseCases } = useUseCases();
  const setField = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));
  const editableActive = editing || isCreateMode;

  useEffect(() => {
    aiModelApi.listModels(undefined, activeCompany?.id).then(setAllModels).catch(() => setAllModels([]));
    businessRelationsApi.listApplications(undefined, activeCompany?.id).then(setAllApplications).catch(() => setAllApplications([]));
    businessRelationsApi.listProcesses(undefined, activeCompany?.id).then(setAllProcesses).catch(() => setAllProcesses([]));
    agentApi.listAgentsForLinking(activeCompany?.id).then(setCompanyAgents).catch(() => setCompanyAgents([]));
    useCaseApi.listUseCases({ companyId: activeCompany?.id, recordRange: '1-500' })
      .then(res => setCompanyUseCases((res.data ?? []).map((raw: any) => ({
        identifier: raw.identifier ?? raw.use_case_id ?? raw.id ?? '',
        name: raw.name ?? raw.title ?? raw.use_case_name ?? '',
        description: raw.description ?? null,
      }))))
      .catch(() => setCompanyUseCases([]));
  }, [activeCompany?.id]);

  useEffect(() => {
    setEditing(isCreateMode);
    setInlineEdit(null);
    setTab('overview');
    if (isCreateMode) {
      setModel(null);
      setForm(emptyForm());
      setLoading(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await aiModelApi.getModel(id!, activeCompany?.id);
        setModel(data);
        setForm(formFromModel(data));
      } catch (err: any) {
        setError(toUserMessage(err));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, isCreateMode, activeCompany?.id]);

  useEffect(() => {
    if (!id || isCreateMode || editing) return;

    const handleWorkflowUpdate = async () => {
      mcpClient.invalidateCache();
      try {
        const data = await aiModelApi.getModel(id, activeCompany?.id);
        setModel(data);
        setForm(formFromModel(data));
      } catch {
        // Keep current UI state on transient refresh failures.
      }
    };

    window.addEventListener('tavro_temporal_workflow_update', handleWorkflowUpdate);
    return () => window.removeEventListener('tavro_temporal_workflow_update', handleWorkflowUpdate);
  }, [id, isCreateMode, editing, activeCompany?.id]);

  const parentOptions = useMemo(
    () => allModels.filter(m => m.ai_model_id !== id),
    [allModels, id],
  );

  const handleSuggest = async () => {
    if (!form.model_name.trim()) return;
    setGenerating(true);
    try {
      const res = await aiModelApi.suggestDescription(form.model_name.trim());
      setField('description', res.description);
    } catch (e: any) {
      setActionError(toUserMessage(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!form.model_name.trim()) {
      setActionError('Model Name is required.');
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const payload = buildPayload(form);
      if (isCreateMode) {
        const created = await aiModelApi.createModel(payload, activeCompany?.id);
        if (linkAgentId) {
          try {
            await aiModelApi.linkAgent(created.ai_model_id, linkAgentId, activeCompany?.id);
          } catch (linkErr) {
            console.warn('Model created but auto-link to agent failed.', linkErr);
          }
        }
        if (linkApplicationId) {
          try {
            await aiModelApi.linkApplication(created.ai_model_id, linkApplicationId);
          } catch (linkErr) {
            console.warn('Model created but auto-link to application failed.', linkErr);
          }
        }
        if (linkProcessId) {
          try {
            await aiModelApi.linkProcess(created.ai_model_id, linkProcessId);
          } catch (linkErr) {
            console.warn('Model created but auto-link to process failed.', linkErr);
          }
        }
        if (linkUseCaseId) {
          try {
            await aiModelApi.linkUseCase(created.ai_model_id, linkUseCaseId);
          } catch (linkErr) {
            console.warn('Model created but auto-link to use case failed.', linkErr);
          }
        }
        window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
        if (linkUseCaseId) {
          navigate(`/use-case/${encodeURIComponent(linkUseCaseId)}`, { replace: true });
          return;
        }
        navigate(`/ai-models/${encodeURIComponent(created.ai_model_id)}`, { replace: true });
        return;
      }
      const changed = changedPayload(formFromModel(model!), form);
      if (Object.keys(changed).length === 0) {
        setEditing(false);
        setInlineEdit(null);
        return;
      }
      await aiModelApi.updateModel(model!.ai_model_id, changed, model!.model_name ?? undefined, activeCompany?.id);
      const fresh = await aiModelApi.getModel(model!.ai_model_id, activeCompany?.id);
      setModel(fresh);
      setForm(formFromModel(fresh));
      setEditing(false);
      setInlineEdit(null);
    } catch (err: any) {
      setActionError(toUserMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setActionError(null);
    setInlineEdit(null);
    if (isCreateMode) {
      navigate('/ai-models');
      return;
    }
    if (model) setForm(formFromModel(model));
    setEditing(false);
  };

  const handleDelete = async () => {
    if (!model) return;
    setDeleting(true);
    setActionError(null);
    try {
      await aiModelApi.deleteModel(model.ai_model_id);
      navigate('/ai-models');
    } catch (err: any) {
      setActionError(toUserMessage(err));
      setDeleting(false);
      setDeleteConfirm(false);
    }
  };

  const startInlineEdit = (field: string) => {
    if (editableActive || inlineSaving) return;
    setActionError(null);
    setInlineEdit({ field, value: form[field] ?? '' });
  };
  const cancelInlineEdit = () => {
    setInlineEdit(null);
    setActionError(null);
  };
  const saveInlineEdit = async () => {
    if (!model || !inlineEdit) return;
    const nextForm = { ...form, [inlineEdit.field]: inlineEdit.value };
    if (!nextForm.model_name.trim()) {
      setActionError('Model Name is required.');
      return;
    }
    setInlineSaving(inlineEdit.field);
    setActionError(null);
    try {
      const changed = changedPayload(formFromModel(model), nextForm);
      if (Object.keys(changed).length === 0) {
        setInlineEdit(null);
        return;
      }
      await aiModelApi.updateModel(model.ai_model_id, changed, model.model_name ?? undefined, activeCompany?.id);
      const fresh = await aiModelApi.getModel(model.ai_model_id, activeCompany?.id);
      setModel(fresh);
      setForm(formFromModel(fresh));
      setInlineEdit(null);
    } catch (err: any) {
      setActionError(toUserMessage(err));
    } finally {
      setInlineSaving(null);
    }
  };

  const reloadModel = async () => {
    if (!model) return;
    try {
      const fresh = await aiModelApi.getModel(model.ai_model_id, activeCompany?.id);
      setModel(fresh);
    } catch {
      /* ignore */
    }
  };

  const linkedAgents = model?.agents ?? [];
  const linkedAgentIds = useMemo(
    () => new Set(linkedAgents.map(a => a.agent_id).filter((v): v is string => !!v)),
    [linkedAgents],
  );
  const filteredCatalogAgents = useMemo(() => {
    const q = agentSearch.trim().toLowerCase();
    if (!q) return companyAgents;
    return companyAgents.filter(a => {
      const aid = a.identification?.agent_id ?? '';
      return aid.toLowerCase().includes(q) || (a.name ?? '').toLowerCase().includes(q);
    });
  }, [companyAgents, agentSearch]);

  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const dropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const searchInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (openDropdown === null) return;
    const key = openDropdown;
    const idTimer = window.setTimeout(() => searchInputRefs.current[key]?.focus(), 0);
    const handlePointerDown = (event: MouseEvent) => {
      const el = dropdownRefs.current[key];
      if (el && !el.contains(event.target as Node)) setOpenDropdown(null);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.clearTimeout(idTimer);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [openDropdown]);

  const addAgent = async (agentId: string) => {
    if (!model) return;
    setActingAgent(`add:${agentId}`);
    setRelationError(null);
    try {
      await aiModelApi.linkAgent(model.ai_model_id, agentId, activeCompany?.id);
      await reloadModel();
    } catch (err: any) {
      setRelationError(toUserMessage(err));
    } finally {
      setActingAgent(null);
    }
  };

  const removeAgent = async (agentId: string) => {
    if (!model) return;
    setActingAgent(`remove:${agentId}`);
    setRelationError(null);
    try {
      await aiModelApi.unlinkAgent(model.ai_model_id, agentId, activeCompany?.id);
      await reloadModel();
    } catch (err: any) {
      setRelationError(toUserMessage(err));
    } finally {
      setActingAgent(null);
    }
  };

  const linkedUseCases = model?.ai_use_cases ?? [];
  const linkedUseCaseIds = useMemo(
    () => new Set(linkedUseCases.map(u => u.ai_use_case_id).filter(Boolean)),
    [linkedUseCases],
  );
  const useCasesForLinking = companyUseCases.length > 0 ? companyUseCases : allUseCases;
  const filteredCatalogUseCases = useMemo(() => {
    const q = useCaseSearch.trim().toLowerCase();
    if (!q) return useCasesForLinking;
    return useCasesForLinking.filter(uc => {
      const id = uc.identifier ?? '';
      return id.toLowerCase().includes(q) || (uc.name ?? '').toLowerCase().includes(q);
    });
  }, [useCasesForLinking, useCaseSearch]);

  const addUseCase = async (useCaseId: string) => {
    if (!model) return;
    setActingUseCase(`add:${useCaseId}`);
    setRelationError(null);
    try {
      await aiModelApi.linkUseCase(model.ai_model_id, useCaseId);
      await reloadModel();
    } catch (err: any) {
      setRelationError(toUserMessage(err));
    } finally {
      setActingUseCase(null);
    }
  };

  const removeUseCase = async (useCaseId: string) => {
    if (!model) return;
    setActingUseCase(`remove:${useCaseId}`);
    setRelationError(null);
    try {
      await aiModelApi.unlinkUseCase(model.ai_model_id, useCaseId);
      await reloadModel();
    } catch (err: any) {
      setRelationError(toUserMessage(err));
    } finally {
      setActingUseCase(null);
    }
  };

  const linkedApplications = model?.applications ?? [];
  const linkedApplicationIds = useMemo(
    () => new Set(linkedApplications.map(a => a.business_application_id).filter(Boolean)),
    [linkedApplications],
  );
  const filteredCatalogApplications = useMemo(() => {
    const q = applicationSearch.trim().toLowerCase();
    if (!q) return allApplications;
    return allApplications.filter(a =>
      a.business_application_id.toLowerCase().includes(q) ||
      (a.application_name ?? '').toLowerCase().includes(q)
    );
  }, [allApplications, applicationSearch]);

  const addApplication = async (applicationId: string) => {
    if (!model) return;
    setActingApplication(`add:${applicationId}`);
    setRelationError(null);
    try {
      await aiModelApi.linkApplication(model.ai_model_id, applicationId);
      await reloadModel();
    } catch (err: any) {
      setRelationError(toUserMessage(err));
    } finally {
      setActingApplication(null);
    }
  };

  const removeApplication = async (applicationId: string) => {
    if (!model) return;
    setActingApplication(`remove:${applicationId}`);
    setRelationError(null);
    try {
      await aiModelApi.unlinkApplication(model.ai_model_id, applicationId);
      await reloadModel();
    } catch (err: any) {
      setRelationError(toUserMessage(err));
    } finally {
      setActingApplication(null);
    }
  };

  const linkedProcesses = model?.processes ?? [];
  const linkedProcessIds = useMemo(
    () => new Set(linkedProcesses.map(p => p.business_process_id).filter(Boolean)),
    [linkedProcesses],
  );
  const filteredCatalogProcesses = useMemo(() => {
    const q = processSearch.trim().toLowerCase();
    if (!q) return allProcesses;
    return allProcesses.filter(p =>
      p.business_process_id.toLowerCase().includes(q) ||
      (p.process_name ?? '').toLowerCase().includes(q)
    );
  }, [allProcesses, processSearch]);

  const addProcess = async (processId: string) => {
    if (!model) return;
    setActingProcess(`add:${processId}`);
    setRelationError(null);
    try {
      await aiModelApi.linkProcess(model.ai_model_id, processId);
      await reloadModel();
    } catch (err: any) {
      setRelationError(toUserMessage(err));
    } finally {
      setActingProcess(null);
    }
  };

  const removeProcess = async (processId: string) => {
    if (!model) return;
    setActingProcess(`remove:${processId}`);
    setRelationError(null);
    try {
      await aiModelApi.unlinkProcess(model.ai_model_id, processId);
      await reloadModel();
    } catch (err: any) {
      setRelationError(toUserMessage(err));
    } finally {
      setActingProcess(null);
    }
  };

  const valueBoxCls =
    'text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 min-h-[42px] whitespace-pre-wrap break-words';

  const inlineControls = (field: string) => (
    <div className="flex shrink-0 gap-1">
      <button
        type="button"
        onClick={saveInlineEdit}
        disabled={inlineSaving === field}
        title="Save"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-xs font-black text-white hover:bg-blue-700 disabled:bg-blue-300"
      >
        {inlineSaving === field ? <Loader2 size={14} className="animate-spin" /> : '✓'}
      </button>
      <button
        type="button"
        onClick={cancelInlineEdit}
        disabled={inlineSaving === field}
        title="Cancel"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50"
      >
        ✕
      </button>
    </div>
  );

  const readOnly = (field: string, display: string) => (
    <p
      onDoubleClick={() => startInlineEdit(field)}
      title="Double-click to edit"
      className={`${valueBoxCls} ${!editableActive ? 'cursor-text hover:border-blue-200 hover:bg-blue-50/40 transition-colors' : ''}`}
    >
      {display || 'N/A'}
    </p>
  );

  const text = (k: string, placeholder = '') => {
    if (editableActive) {
      return <input className={inputCls} value={form[k]} onChange={e => setField(k, e.target.value)} placeholder={placeholder} />;
    }
    if (inlineEdit?.field === k) {
      return (
        <div className="flex items-start gap-2">
          <input autoFocus className={inputCls} value={inlineEdit.value} onChange={e => setInlineEdit({ field: k, value: e.target.value })} />
          {inlineControls(k)}
        </div>
      );
    }
    return readOnly(k, form[k]);
  };

  const area = (k: string) => {
    if (editableActive) {
      return <textarea className={textAreaCls} rows={3} value={form[k]} onChange={e => setField(k, e.target.value)} />;
    }
    if (inlineEdit?.field === k) {
      return (
        <div className="flex items-start gap-2">
          <textarea autoFocus rows={3} className={textAreaCls} value={inlineEdit.value} onChange={e => setInlineEdit({ field: k, value: e.target.value })} />
          {inlineControls(k)}
        </div>
      );
    }
    return readOnly(k, form[k]);
  };

  const select = (k: string, options: Option[]) => {
    if (editableActive) {
      return (
        <select className={inputCls} value={form[k]} onChange={e => setField(k, e.target.value)}>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }
    if (inlineEdit?.field === k) {
      return (
        <div className="flex items-start gap-2">
          <select autoFocus className={inputCls} value={inlineEdit.value} onChange={e => setInlineEdit({ field: k, value: e.target.value })}>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {inlineControls(k)}
        </div>
      );
    }
    const matched = options.find(o => o.value === form[k]);
    const label = matched ? (matched.value ? matched.label : '') : (form[k] || '');
    return readOnly(k, label);
  };

  const dateField = (k: string) => {
    if (editableActive) {
      return <input type="date" lang="en-US" className={inputCls} value={form[k]} onChange={e => setField(k, e.target.value)} />;
    }
    if (inlineEdit?.field === k) {
      return (
        <div className="flex items-start gap-2">
          <input type="date" lang="en-US" autoFocus className={inputCls} value={inlineEdit.value} onChange={e => setInlineEdit({ field: k, value: e.target.value })} />
          {inlineControls(k)}
        </div>
      );
    }
    const raw = form[k];
    if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [yyyy, mm, dd] = raw.split('-');
      return readOnly(k, `${mm}/${dd}/${yyyy}`);
    }
    return readOnly(k, raw);
  };

  const parentField = () => {
    const k = 'parent_model_id';
    const renderSelect = (value: string, onChange: (v: string) => void) => (
      <select className={inputCls} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">-- None --</option>
        {parentOptions.map(m => (
          <option key={m.ai_model_id} value={m.ai_model_id}>{m.model_name || m.ai_model_id}</option>
        ))}
      </select>
    );
    if (editableActive) return renderSelect(form[k], v => setField(k, v));
    if (inlineEdit?.field === k) {
      return (
        <div className="flex items-start gap-2">
          {renderSelect(inlineEdit.value, v => setInlineEdit({ field: k, value: v }))}
          {inlineControls(k)}
        </div>
      );
    }
    const name = allModels.find(m => m.ai_model_id === form[k])?.model_name ?? form[k];
    return readOnly(k, name);
  };

  // In view/edit mode, wait until the model is loaded before rendering the form.
  // (After create -> navigate, there is a render frame where isCreateMode is
  // false but `model` is not yet populated; rendering then would crash.)
  if (loading || (!isCreateMode && !model && !error)) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-500">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading model...
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-[1100px] mx-auto">
        <div className="flex items-start gap-3 text-red-500 bg-red-50 border border-red-200 rounded-xl px-6 py-4">
          <AlertCircle size={20} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-bold text-sm">Could not load AI model</p>
            <p className="text-xs mt-1 text-red-400">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1400px] mx-auto animate-fade-in pb-10">
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={() => navigate(linkUseCaseId ? `/use-case/${encodeURIComponent(linkUseCaseId)}` : '/ai-models')}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> {isCreateMode && linkUseCaseId ? 'Back to AI Use Case' : 'Back to AI Models'}
        </button>
        <div className="flex items-center gap-2">
          {editableActive ? (
            <>
              <button
                onClick={handleCancelEdit}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              >
                <XCircle size={15} /> {isCreateMode ? 'Cancel' : 'Discard'}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {isCreateMode ? 'Create Model' : 'Save'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => { setTab('overview'); setInlineEdit(null); setEditing(true); }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              >
                <Pencil size={15} /> Edit
              </button>
              <button
                onClick={() => setDeleteConfirm(true)}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
              >
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="h-4 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-t-2xl w-full" />
        <div className="p-6 bg-slate-50 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 flex-wrap">
          <div className="flex items-start gap-4 min-w-0 flex-1 md:max-w-[45%]">
            <div className="p-3 bg-blue-600 text-white rounded-xl shadow-sm mt-1 shrink-0">
              <Boxes size={24} />
            </div>
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">AI Model</span>
              <h2 className="text-2xl font-bold text-slate-800 tracking-tight truncate">
                {isCreateMode ? 'New AI Model' : (form.model_name || model?.ai_model_id)}
              </h2>
              {!isCreateMode && <p className="text-xs font-mono text-slate-400 mt-1">{model?.ai_model_id}</p>}
              <p className="text-sm text-slate-600 line-clamp-2">
                {form.description || 'No description available.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 shrink-0 w-full md:w-auto mt-2 md:mt-0">
            <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[170px]">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">Emergency Tier</span>
              <span className={`inline-flex items-center gap-1 text-xs font-bold ${metricToneClass(getEmergencyTierTone(form.emergency_tier))}`}>
                {getEmergencyTierTone(form.emergency_tier) === 'low' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                {form.emergency_tier || 'N/A'}
              </span>
            </div>
            <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[170px]">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">Business Criticality</span>
              <span className={`inline-flex items-center gap-1 text-xs font-bold ${metricToneClass(getCriticalityTone(form.business_criticality))}`}>
                {getCriticalityTone(form.business_criticality) === 'low' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                {form.business_criticality || 'N/A'}
              </span>
            </div>
            <div className="bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[130px]">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5 inline-flex items-center gap-1">
                ARE
                <span title="ARE (Agent Risk Exposure) represents overall application risk. It is calculated as the highest blended risk score among related agents multiplied by the average of Business Criticality and Emergency Tier scores.">
                  <Info size={10} className="text-slate-400" />
                </span>
              </span>
              <span className="text-xs font-bold text-slate-700">{String(model?.agent_risk_exposure ?? 'N/A')}</span>
            </div>
            <div className="bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[130px]">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5 inline-flex items-center gap-1">
                ART
                <span title="ART (Agent Risk Tier) indicates overall application risk from ARE score: Low &lt; 3, Medium 3–&lt;7, High 7–&lt;9, Critical ≥ 9.">
                  <Info size={10} className="text-slate-400" />
                </span>
              </span>
              <span className={`inline-flex items-center gap-1 text-xs font-bold ${metricToneClass(getArtTone(model?.agent_risk_tier))}`}>
                {getArtTone(model?.agent_risk_tier) === 'low' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                {model?.agent_risk_tier ?? 'None'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {actionError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{actionError}</div>
      )}

      {!isCreateMode && (
        <div className="flex items-center gap-2 border-b border-slate-200">
          {(editing
            ? ([['overview', 'Overview']] as const)
            : ([['overview', 'Overview'], ['business_impact', 'Business Impact']] as const)
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2.5 text-sm font-bold whitespace-nowrap transition-all border-b-2 ${tab === key
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === 'overview' && (<>
        <Section title="Identification and Accountability">
          <Field label="Model Name">{text('model_name', 'e.g. Credit Default Predictor')}</Field>
          <Field label="Owner">{text('owner')}</Field>
          <Field label="Description">
            <div className="flex flex-col gap-1.5">
              {area('description')}
              {editableActive && (
                <button
                  onClick={handleSuggest}
                  disabled={generating || !form.model_name.trim()}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700 disabled:opacity-50 w-fit"
                >
                  {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  {generating ? 'Generating…' : 'AI assist'}
                </button>
              )}
            </div>
          </Field>
          <Field label="Department Executive">{text('department_executive')}</Field>
          <Field label="Business Functions">{text('business_functions')}</Field>
          <Field label="Vendor or In-house">{select('vendor_or_inhouse', vendorOptions)}</Field>
          <Field label="Provider">{select('provider', providerOptions)}</Field>
          <Field label="Status">{select('status', statusOptions)}</Field>
          <Field label="Parent Model">{parentField()}</Field>
          <Field label="Version Number">{text('version_number')}</Field>
        </Section>

        <Section title="Agent Risk Exposure">
          <Field label="Business Criticality">{select('business_criticality', businessCriticalityOptions)}</Field>
          <Field label="Emergency Tier">{select('emergency_tier', emergencyTierOptions)}</Field>
          <Field label="ARE" hint={MODEL_ARE_HINTS.agent_risk_exposure}>
            <p className={`${valueBoxCls}`}>{String(model?.agent_risk_exposure ?? 0)}</p>
          </Field>
          <Field label="ART" hint={MODEL_ARE_HINTS.agent_risk_tier}>
            <p className={`${valueBoxCls}`}>{model?.agent_risk_tier ?? 'None'}</p>
          </Field>
          <Field label="Blended Risk Score" hint={MODEL_ARE_HINTS.blended_risk_score}>
            <p className={`${valueBoxCls}`}>{String(model?.blended_risk_score ?? 0)}</p>
          </Field>
          <Field label="# Of Associated Agents" hint={MODEL_ARE_HINTS.associated_agents}>
            <p className={`${valueBoxCls}`}>{String(model?.no_of_associated_agents ?? 0)}</p>
          </Field>
          <Field label="Inherent Risk Classification">
            <p className={`${valueBoxCls}`}>{model?.inherent_risk_classification || 'N/A'}</p>
          </Field>
          <Field label="Inherent Risk Classification Score">
            <p className={`${valueBoxCls}`}>{String(model?.inherent_risk_classification_score ?? 0)}</p>
          </Field>
          <Field label="Residual Risk Classification">
            <p className={`${valueBoxCls}`}>{model?.residual_risk_classification || 'N/A'}</p>
          </Field>
          <Field label="Residual Risk Classification Score">
            <p className={`${valueBoxCls}`}>{String(model?.residual_risk_classification_score ?? 0)}</p>
          </Field>
        </Section>

        <Section title="Intended Use and Decision Impact">
          <Field label="Use case and business value drivers for the model" full>{text('use_case_value_drivers')}</Field>
          <Field label="Types of users for the model">{text('user_types')}</Field>
          <Field label="Type of decision that the model supports (e.g., credit, fraud, liquidity)">{text('decision_type')}</Field>
          <Field label="Level of automation of the decisions (e.g., advisory)">{select('automation_level', automationLevelOptions)}</Field>
          <Field label="Mapping to regulatory (e.g., Fair Lending, HMDA, CECL)">{text('regulatory_mapping')}</Field>
          <Field label="Impact on consumer">{text('consumer_impact')}</Field>
          <Field label="Risk Tier / Materiality Classification">{text('risk_tier_materiality')}</Field>
        </Section>

        <Section title="Model Construct">
          <Field label="Type of model (e.g., statistical, machine learning, rules, agentic system)">{select('model_type', modelTypeOptions)}</Field>
          <Field label="The class of techniques used by the model to learn patterns from data">{select('technique_class', techniqueClassOptions)}</Field>
          <Field label="The learning approach used to train the model (labeled / unlabeled)">{select('learning_approach', learningApproachOptions)}</Field>
          <Field label="How often the model is updated or retrained">{select('update_frequency', updateFrequencyOptions)}</Field>
          <Field label="Number of input variables / attributes">{text('input_variable_count')}</Field>
          <Field label="How is data joined (e.g., API, transfer methods)">{text('data_join_method')}</Field>
          <Field label="Reference to statistical assumptions the model relies on">{text('statistical_assumptions')}</Field>
          <Field label="Documented constraints / weaknesses affecting reliability, fairness">{text('documented_constraints')}</Field>
          <Field label="Stability Window / Applicability Scope">{text('stability_window')}</Field>
        </Section>

        <Section title="Model Validation">
          <Field label="Date of Last Model Validation">{dateField('last_validation_date')}</Field>
          <div />
          {isCreateMode ? (
            <p className="text-xs text-slate-500 md:col-span-2">Save the model to upload validation/monitoring files.</p>
          ) : (
            <>
              <AttachmentField modelId={model!.ai_model_id} category="bias_fairness_testing" label="Bias and Fairness Testing" />
              <AttachmentField modelId={model!.ai_model_id} category="model_drift_testing" label="Model Drift Testing" />
              <AttachmentField modelId={model!.ai_model_id} category="model_performance_monitoring" label="Model Performance Monitoring" />
            </>
          )}
        </Section>

        <Section title="Model Monitoring">
          {isCreateMode ? (
            <p className="text-xs text-slate-500 md:col-span-2">Save the model to upload monitoring files.</p>
          ) : (
            <AttachmentField modelId={model!.ai_model_id} category="model_monitoring" label="Model Monitoring" />
          )}
        </Section>

        <Section title="Model Recertification">
          <Field label="Has use case remained the same?">{select('recert_use_case_same', YES_NO_OPTIONS)}</Field>
          <Field label="If not, what changed?">{text('recert_use_case_changed')}</Field>
          <Field label="Have inputs and data sources remained the same?">{select('recert_inputs_same', YES_NO_OPTIONS)}</Field>
          <Field label="If not, what changed?">{text('recert_inputs_changed')}</Field>
          <Field label="Have outputs and destinations remained the same?">{select('recert_outputs_same', YES_NO_OPTIONS)}</Field>
          <Field label="If not, what changed?">{text('recert_outputs_changed')}</Field>
          <Field label="Have users remained the same?">{select('recert_users_same', YES_NO_OPTIONS)}</Field>
          <Field label="If not, what changed?">{text('recert_users_changed')}</Field>
          <Field label="Have internal processing components and algorithms remained the same?">{select('recert_processing_same', YES_NO_OPTIONS)}</Field>
          <Field label="If not, what changed?">{text('recert_processing_changed')}</Field>
          <Field label="Have users completed required training on use of AI in models?">{select('recert_training_completed', YES_NO_OPTIONS)}</Field>
          <div />
          <Field label="Has a comprehensive risk assessment been conducted on any use of AI?">{select('recert_risk_assessment_done', YES_NO_OPTIONS)}</Field>
          {isCreateMode ? (
            <p className="text-xs text-slate-500 self-end">Save the model to attach results.</p>
          ) : (
            <AttachmentField modelId={model!.ai_model_id} category="recert_risk_assessment" label="If so, please attach results" />
          )}
        </Section>
      </>)}

      {tab === 'business_impact' && !isCreateMode && model && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 shadow-sm min-h-[400px] flex flex-col gap-6">
          {relationError && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{relationError}</div>
          )}

          <div className="bg-white rounded-2xl border border-slate-200">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => toggleSection('agents')}
              className="flex items-center gap-1.5 text-sm font-bold text-slate-700 hover:text-blue-600 transition-colors"
              aria-expanded={!collapsedSections.has('agents')}
            >
              {collapsedSections.has('agents') ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              Currently Related Agents ({linkedAgents.length})
            </button>
            <div className="relative" ref={(el) => { dropdownRefs.current.agents = el; }}>
              <button
                onClick={() => setOpenDropdown(openDropdown === 'agents' ? null : 'agents')}
                className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:border-blue-300 px-3 py-2 rounded-lg transition-colors"
                aria-haspopup="listbox"
                aria-expanded={openDropdown === 'agents'}
              >
                <PlusCircle size={13} className="text-blue-600" />
                Add Agent
                <ChevronDown size={13} className="text-slate-400" />
              </button>
              {openDropdown === 'agents' && (
                <div className="absolute top-full right-0 mt-1 w-[320px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                  <div className="p-2 border-b border-slate-100">
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        ref={(el) => { searchInputRefs.current.agents = el; }}
                        value={agentSearch}
                        onChange={(e) => setAgentSearch(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') setOpenDropdown(null); }}
                        placeholder="Search agent..."
                        className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
                      />
                    </div>
                  </div>
                  <div className="max-h-72 overflow-y-auto py-1" role="listbox">
                    {filteredCatalogAgents.length === 0 && (
                      <div className="px-4 py-6 text-center text-xs text-slate-400">No agents found</div>
                    )}
                    {filteredCatalogAgents.map((a) => {
                      const aid = a.identification?.agent_id ?? '';
                      const isLinked = linkedAgentIds.has(aid);
                      const busy = actingAgent === `add:${aid}` || actingAgent === `remove:${aid}`;
                      return (
                        <button
                          key={aid}
                          type="button"
                          role="option"
                          aria-selected={isLinked}
                          disabled={!aid || busy}
                          onClick={() => (isLinked ? removeAgent(aid) : addAgent(aid))}
                          className={`w-full flex items-center gap-2 text-left px-4 py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                            isLinked ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold truncate">{a.name || aid}</span>
                            <span className="block text-[11px] font-mono text-slate-400 truncate">{aid}</span>
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
                  {model && (
                    <div className="border-t border-slate-100 mt-1 pt-1 px-2 pb-2">
                      <Link
                        to={`/agents/new?linkModelId=${encodeURIComponent(model.ai_model_id)}`}
                        onClick={() => setOpenDropdown(null)}
                        className="flex items-center gap-2 w-full text-left px-2 py-2 text-[11px] font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        <Plus size={11} /> Add Agent
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {!collapsedSections.has('agents') && (
          <div className="divide-y divide-slate-100">
            {linkedAgents.length === 0 && (
              <div className="p-5 text-sm text-slate-500">No linked Agents</div>
            )}
            {linkedAgents.map((ag, idx) => {
              const aid = ag.agent_id ?? ag.agent_internal_id ?? `agent-${idx}`;
              const removeKey = `remove:${aid}`;
              return (
                <div key={`${aid}-${idx}`} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link to={`/agent/${encodeURIComponent(aid)}`} className="text-sm font-semibold text-blue-600 hover:underline">
                      {ag.agent_name || aid}
                    </Link>
                    <p className="text-[11px] font-mono text-slate-400 truncate">{aid}</p>
                  </div>
                  <button
                    onClick={() => removeAgent(aid)}
                    disabled={actingAgent === removeKey}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50"
                  >
                    {actingAgent === removeKey ? <Loader2 size={12} className="animate-spin" /> : <Unlink2 size={12} />}
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
          )}
          </div>

          {/* ── AI Use Cases (many-to-many) ── */}
          <div className="bg-white rounded-2xl border border-slate-200">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => toggleSection('useCases')}
              className="flex items-center gap-1.5 text-sm font-bold text-slate-700 hover:text-blue-600 transition-colors"
              aria-expanded={!collapsedSections.has('useCases')}
            >
              {collapsedSections.has('useCases') ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              Currently Related AI Use Cases ({linkedUseCases.length})
            </button>
            <div className="relative" ref={(el) => { dropdownRefs.current.useCases = el; }}>
              <button
                onClick={() => setOpenDropdown(openDropdown === 'useCases' ? null : 'useCases')}
                className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:border-blue-300 px-3 py-2 rounded-lg transition-colors"
                aria-haspopup="listbox"
                aria-expanded={openDropdown === 'useCases'}
              >
                <PlusCircle size={13} className="text-blue-600" />
                Add Use Case
                <ChevronDown size={13} className="text-slate-400" />
              </button>
              {openDropdown === 'useCases' && (
                <div className="absolute top-full right-0 mt-1 w-[320px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                  <div className="p-2 border-b border-slate-100">
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        ref={(el) => { searchInputRefs.current.useCases = el; }}
                        value={useCaseSearch}
                        onChange={(e) => setUseCaseSearch(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') setOpenDropdown(null); }}
                        placeholder="Search use case..."
                        className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
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
                      const busy = actingUseCase === `add:${id}` || actingUseCase === `remove:${id}`;
                      return (
                        <button
                          key={id}
                          type="button"
                          role="option"
                          aria-selected={isLinked}
                          disabled={!id || busy}
                          onClick={() => (isLinked ? removeUseCase(id) : addUseCase(id))}
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
                  {model && (
                    <div className="border-t border-slate-100 mt-1 pt-1 px-2 pb-2">
                      <Link
                        to={`/use-cases/new?linkModelId=${encodeURIComponent(model.ai_model_id)}`}
                        onClick={() => setOpenDropdown(null)}
                        className="flex items-center gap-2 w-full text-left px-2 py-2 text-[11px] font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        <Plus size={11} /> Add Use Case
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {!collapsedSections.has('useCases') && (
          <div className="divide-y divide-slate-100">
            {linkedUseCases.length === 0 && (
              <div className="p-5 text-sm text-slate-500">No linked AI Use Cases.</div>
            )}
            {linkedUseCases.map((uc, idx) => {
              const ucId = uc.ai_use_case_id || `use-case-${idx}`;
              const removeKey = `remove:${ucId}`;
              return (
                <div key={`${ucId}-${idx}`} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link to={`/use-case/${encodeURIComponent(ucId)}`} className="text-sm font-semibold text-blue-600 hover:underline">
                      {uc.ai_use_case_name || ucId}
                    </Link>
                    <p className="text-[11px] font-mono text-slate-400 truncate">{ucId}</p>
                    {uc.description && (
                      <span className="block text-xs text-slate-500 mt-1 max-w-[640px]">{uc.description}</span>
                    )}
                  </div>
                  <button
                    onClick={() => removeUseCase(ucId)}
                    disabled={actingUseCase === removeKey}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50"
                  >
                    {actingUseCase === removeKey ? <Loader2 size={12} className="animate-spin" /> : <Unlink2 size={12} />}
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
          )}
          </div>

          {/* ── Related Applications (many-to-many) ── */}
          <div className="bg-white rounded-2xl border border-slate-200">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => toggleSection('applications')}
              className="flex items-center gap-1.5 text-sm font-bold text-slate-700 hover:text-blue-600 transition-colors"
              aria-expanded={!collapsedSections.has('applications')}
            >
              {collapsedSections.has('applications') ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              Currently Related Applications ({linkedApplications.length})
            </button>
            <div className="relative" ref={(el) => { dropdownRefs.current.applications = el; }}>
              <button
                onClick={() => setOpenDropdown(openDropdown === 'applications' ? null : 'applications')}
                className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:border-blue-300 px-3 py-2 rounded-lg transition-colors"
                aria-haspopup="listbox"
                aria-expanded={openDropdown === 'applications'}
              >
                <PlusCircle size={13} className="text-blue-600" />
                Add Application
                <ChevronDown size={13} className="text-slate-400" />
              </button>
              {openDropdown === 'applications' && (
                <div className="absolute top-full right-0 mt-1 w-[320px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                  <div className="p-2 border-b border-slate-100">
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        ref={(el) => { searchInputRefs.current.applications = el; }}
                        value={applicationSearch}
                        onChange={(e) => setApplicationSearch(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') setOpenDropdown(null); }}
                        placeholder="Search application..."
                        className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
                      />
                    </div>
                  </div>
                  <div className="max-h-72 overflow-y-auto py-1" role="listbox">
                    {filteredCatalogApplications.length === 0 && (
                      <div className="px-4 py-6 text-center text-xs text-slate-400">No applications found</div>
                    )}
                    {filteredCatalogApplications.map((app) => {
                      const isLinked = linkedApplicationIds.has(app.business_application_id);
                      const busy = actingApplication === `add:${app.business_application_id}` || actingApplication === `remove:${app.business_application_id}`;
                      return (
                        <button
                          key={app.business_application_id}
                          type="button"
                          role="option"
                          aria-selected={isLinked}
                          disabled={busy}
                          onClick={() => (isLinked ? removeApplication(app.business_application_id) : addApplication(app.business_application_id))}
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
                  {model && (
                    <div className="border-t border-slate-100 mt-1 pt-1 px-2 pb-2">
                      <Link
                        to={`/applications/new?linkModelId=${encodeURIComponent(model.ai_model_id)}`}
                        onClick={() => setOpenDropdown(null)}
                        className="flex items-center gap-2 w-full text-left px-2 py-2 text-[11px] font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        <Plus size={11} /> Add Application
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {!collapsedSections.has('applications') && (
          <div className="divide-y divide-slate-100">
            {linkedApplications.length === 0 && (
              <div className="p-5 text-sm text-slate-500">No linked Applications.</div>
            )}
            {linkedApplications.map((app, idx) => {
              const appId = app.business_application_id || `application-${idx}`;
              const removeKey = `remove:${appId}`;
              return (
                <div key={`${appId}-${idx}`} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link to={`/applications/${encodeURIComponent(appId)}`} className="text-sm font-semibold text-blue-600 hover:underline">
                      {app.application_name || appId}
                    </Link>
                    <p className="text-[11px] font-mono text-slate-400 truncate">{appId}</p>
                    {app.description && (
                      <span className="block text-xs text-slate-500 mt-1 max-w-[640px]">{app.description}</span>
                    )}
                  </div>
                  <button
                    onClick={() => removeApplication(appId)}
                    disabled={actingApplication === removeKey}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50"
                  >
                    {actingApplication === removeKey ? <Loader2 size={12} className="animate-spin" /> : <Unlink2 size={12} />}
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
          )}
          </div>

          {/* ── Related Processes (many-to-many) ── */}
          <div className="bg-white rounded-2xl border border-slate-200">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => toggleSection('processes')}
              className="flex items-center gap-1.5 text-sm font-bold text-slate-700 hover:text-blue-600 transition-colors"
              aria-expanded={!collapsedSections.has('processes')}
            >
              {collapsedSections.has('processes') ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              Currently Related Processes ({linkedProcesses.length})
            </button>
            <div className="relative" ref={(el) => { dropdownRefs.current.processes = el; }}>
              <button
                onClick={() => setOpenDropdown(openDropdown === 'processes' ? null : 'processes')}
                className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:border-blue-300 px-3 py-2 rounded-lg transition-colors"
                aria-haspopup="listbox"
                aria-expanded={openDropdown === 'processes'}
              >
                <PlusCircle size={13} className="text-blue-600" />
                Add Process
                <ChevronDown size={13} className="text-slate-400" />
              </button>
              {openDropdown === 'processes' && (
                <div className="absolute top-full right-0 mt-1 w-[320px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                  <div className="p-2 border-b border-slate-100">
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        ref={(el) => { searchInputRefs.current.processes = el; }}
                        value={processSearch}
                        onChange={(e) => setProcessSearch(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') setOpenDropdown(null); }}
                        placeholder="Search process..."
                        className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
                      />
                    </div>
                  </div>
                  <div className="max-h-72 overflow-y-auto py-1" role="listbox">
                    {filteredCatalogProcesses.length === 0 && (
                      <div className="px-4 py-6 text-center text-xs text-slate-400">No processes found</div>
                    )}
                    {filteredCatalogProcesses.map((proc) => {
                      const isLinked = linkedProcessIds.has(proc.business_process_id);
                      const busy = actingProcess === `add:${proc.business_process_id}` || actingProcess === `remove:${proc.business_process_id}`;
                      return (
                        <button
                          key={proc.business_process_id}
                          type="button"
                          role="option"
                          aria-selected={isLinked}
                          disabled={busy}
                          onClick={() => (isLinked ? removeProcess(proc.business_process_id) : addProcess(proc.business_process_id))}
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
                  {model && (
                    <div className="border-t border-slate-100 mt-1 pt-1 px-2 pb-2">
                      <Link
                        to={`/processes/new?linkModelId=${encodeURIComponent(model.ai_model_id)}`}
                        onClick={() => setOpenDropdown(null)}
                        className="flex items-center gap-2 w-full text-left px-2 py-2 text-[11px] font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        <Plus size={11} /> Add Process
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {!collapsedSections.has('processes') && (
          <div className="divide-y divide-slate-100">
            {linkedProcesses.length === 0 && (
              <div className="p-5 text-sm text-slate-500">No linked Processes.</div>
            )}
            {linkedProcesses.map((proc, idx) => {
              const procId = proc.business_process_id || `process-${idx}`;
              const removeKey = `remove:${procId}`;
              return (
                <div key={`${procId}-${idx}`} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link to={`/processes/${encodeURIComponent(procId)}`} className="text-sm font-semibold text-blue-600 hover:underline">
                      {proc.process_name || procId}
                    </Link>
                    <p className="text-[11px] font-mono text-slate-400 truncate">{procId}</p>
                    {proc.description && (
                      <span className="block text-xs text-slate-500 mt-1 max-w-[640px]">{proc.description}</span>
                    )}
                  </div>
                  <button
                    onClick={() => removeProcess(procId)}
                    disabled={actingProcess === removeKey}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50"
                  >
                    {actingProcess === removeKey ? <Loader2 size={12} className="animate-spin" /> : <Unlink2 size={12} />}
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
          )}
          </div>

        </div>
      )}

      {/* Delete confirmation modal — portaled to body so it stays centered in the
          viewport regardless of scroll position or transformed ancestors. */}
      {deleteConfirm && model && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
              <Trash2 size={16} className="text-red-500" />
              <span className="font-bold text-slate-800 text-sm">Delete AI Model</span>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-slate-700">
                Permanently delete <span className="font-semibold">{form.model_name || model.ai_model_id}</span> and all associated records (agent links, attachments)?
              </p>
              <p className="text-xs text-red-500 mt-2">This action cannot be undone.</p>
            </div>
            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-100 bg-slate-50">
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
        </div>,
        document.body
      )}
    </div>
  );
};

export default AiModelViewPage;
