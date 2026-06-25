import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toUserMessage } from '../utils/errorUtils';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  AppWindow,
  ArrowLeft,
  Bot,
  Boxes,
  ClipboardList,
  Download,
  Info,
  Link2,
  Loader2,
  Paperclip,
  Pencil,
  PlusCircle,
  Save,
  Search,
  Sparkles,
  Trash2,
  Unlink2,
  Workflow,
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
import type { AiModelRecord, AiModelUpsertPayload, AiModelAttachmentRecord } from '../types/aiModel';
import type { BusinessApplicationRecord, BusinessProcessRecord } from '../types/businessRelations';

type Option = { label: string; value: string };

const VENDOR_OPTIONS: Option[] = [
  { label: '-- None --', value: '' },
  { label: 'Vendor', value: 'Vendor' },
  { label: 'In-house', value: 'In-house' },
];

const STATUS_OPTIONS: Option[] = [
  { label: '-- None --', value: '' },
  { label: 'Ideation', value: 'Ideation' },
  { label: 'Development', value: 'Development' },
  { label: 'Production', value: 'Production' },
  { label: 'Retired', value: 'Retired' },
];

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

const MODEL_BUSINESS_CRITICALITY_OPTIONS: Option[] = [
  { label: '-- None --', value: '' },
  { label: 'High', value: 'High' },
  { label: 'Medium', value: 'Medium' },
  { label: 'Low', value: 'Low' },
];

const MODEL_EMERGENCY_TIER_OPTIONS: Option[] = [
  { label: '-- None --', value: '' },
  { label: 'Mission Critical', value: 'Mission Critical' },
  { label: 'Business Critical', value: 'Business Critical' },
  { label: 'Non-Critical', value: 'Non-Critical' },
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
  const { activeCompany } = useBlueprint();

  const [form, setForm] = useState<FormState>(emptyForm);
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
  }, [id, isCreateMode]);

  useEffect(() => {
    if (!id || isCreateMode || editing) return;

    const handleWorkflowUpdate = async () => {
      mcpClient.invalidateCache();
      try {
        const data = await aiModelApi.getModel(id);
        setModel(data);
        setForm(formFromModel(data));
      } catch {
        // Keep current UI state on transient refresh failures.
      }
    };

    window.addEventListener('tavro_temporal_workflow_update', handleWorkflowUpdate);
    return () => window.removeEventListener('tavro_temporal_workflow_update', handleWorkflowUpdate);
  }, [id, isCreateMode, editing]);

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
            await aiModelApi.linkAgent(created.ai_model_id, linkAgentId);
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
        window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
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
      await aiModelApi.updateModel(model.ai_model_id, changed, model.model_name ?? undefined);
      const fresh = await aiModelApi.getModel(model.ai_model_id);
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
      const fresh = await aiModelApi.getModel(model.ai_model_id);
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
  const availableAgents = useMemo(() => {
    const q = agentSearch.trim().toLowerCase();
    return companyAgents.filter(a => {
      const aid = a.identification?.agent_id ?? '';
      if (!aid || linkedAgentIds.has(aid)) return false;
      if (!q) return true;
      return (
        aid.toLowerCase().includes(q) ||
        (a.name ?? '').toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [companyAgents, agentSearch, linkedAgentIds]);

  const addAgent = async (agentId: string) => {
    if (!model) return;
    setActingAgent(`add:${agentId}`);
    setRelationError(null);
    try {
      await aiModelApi.linkAgent(model.ai_model_id, agentId);
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
      await aiModelApi.unlinkAgent(model.ai_model_id, agentId);
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
  const availableUseCases = useMemo(() => {
    const q = useCaseSearch.trim().toLowerCase();
    return useCasesForLinking.filter(uc => {
      const id = uc.identifier ?? '';
      if (!id || linkedUseCaseIds.has(id)) return false;
      if (!q) return true;
      return (
        id.toLowerCase().includes(q) ||
        (uc.name ?? '').toLowerCase().includes(q) ||
        (uc.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [useCasesForLinking, useCaseSearch, linkedUseCaseIds]);

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
  const availableApplications = useMemo(() => {
    const q = applicationSearch.trim().toLowerCase();
    return allApplications.filter(a => {
      if (linkedApplicationIds.has(a.business_application_id)) return false;
      if (!q) return true;
      return (
        a.business_application_id.toLowerCase().includes(q) ||
        (a.application_name ?? '').toLowerCase().includes(q) ||
        (a.application_description ?? '').toLowerCase().includes(q)
      );
    });
  }, [allApplications, applicationSearch, linkedApplicationIds]);

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
  const availableProcesses = useMemo(() => {
    const q = processSearch.trim().toLowerCase();
    return allProcesses.filter(p => {
      if (linkedProcessIds.has(p.business_process_id)) return false;
      if (!q) return true;
      return (
        p.business_process_id.toLowerCase().includes(q) ||
        (p.process_name ?? '').toLowerCase().includes(q) ||
        (p.process_description ?? '').toLowerCase().includes(q)
      );
    });
  }, [allProcesses, processSearch, linkedProcessIds]);

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
    const label = matched && matched.value ? matched.label : '';
    return readOnly(k, label);
  };

  const dateField = (k: string) => {
    if (editableActive) {
      return <input type="date" className={inputCls} value={form[k]} onChange={e => setField(k, e.target.value)} />;
    }
    if (inlineEdit?.field === k) {
      return (
        <div className="flex items-start gap-2">
          <input type="date" autoFocus className={inputCls} value={inlineEdit.value} onChange={e => setInlineEdit({ field: k, value: e.target.value })} />
          {inlineControls(k)}
        </div>
      );
    }
    return readOnly(k, form[k]);
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
          onClick={() => navigate('/ai-models')}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> Back to AI Models
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
            {[
              { label: 'Status', value: form.status },
              // { label: 'Provider', value: form.provider },
              // { label: 'Vendor or In-house', value: form.vendor_or_inhouse },
              { label: 'Risk Tier / Materiality', value: form.risk_tier_materiality },
            ].map(metric => (
              <div key={metric.label} className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[170px]">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">
                  {metric.label}
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-700">
                  {metric.value?.trim() || 'N/A'}
                </span>
              </div>
            ))}
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
          <Field label="Vendor or In-house">{select('vendor_or_inhouse', VENDOR_OPTIONS)}</Field>
          <Field label="Provider">{text('provider')}</Field>
          <Field label="Status">{select('status', STATUS_OPTIONS)}</Field>
          <Field label="Parent Model">{parentField()}</Field>
          <Field label="Version Number">{text('version_number')}</Field>
        </Section>

        <Section title="Agent Risk Exposure">
          <Field label="Business Criticality">{select('business_criticality', MODEL_BUSINESS_CRITICALITY_OPTIONS)}</Field>
          <Field label="Emergency Tier">{select('emergency_tier', MODEL_EMERGENCY_TIER_OPTIONS)}</Field>
          <Field label="Agent Risk Exposure (ARE)" hint={MODEL_ARE_HINTS.agent_risk_exposure}>
            <p className={`${valueBoxCls}`}>{String(model?.agent_risk_exposure ?? 0)}</p>
          </Field>
          <Field label="Agent Risk Tier (ART)" hint={MODEL_ARE_HINTS.agent_risk_tier}>
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
          <Field label="Level of automation of the decisions (e.g., advisory)">{text('automation_level')}</Field>
          <Field label="Mapping to regulatory (e.g., Fair Lending, HMDA, CECL)">{text('regulatory_mapping')}</Field>
          <Field label="Impact on consumer">{text('consumer_impact')}</Field>
          <Field label="Risk Tier / Materiality Classification">{text('risk_tier_materiality')}</Field>
        </Section>

        <Section title="Model Construct">
          <Field label="Type of model (e.g., statistical, machine learning, rules, agentic system)">{text('model_type')}</Field>
          <Field label="The class of techniques used by the model to learn patterns from data">{text('technique_class')}</Field>
          <Field label="The learning approach used to train the model (labeled / unlabeled)">{text('learning_approach')}</Field>
          <Field label="How often the model is updated or retrained">{text('update_frequency')}</Field>
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
        <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-5">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Bot size={15} />Agents ({linkedAgents.length})
            </h3>
          </div>

          {relationError && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{relationError}</div>
          )}

          <div className="flex flex-col gap-3">
            {linkedAgents.map((ag, idx) => {
              const aid = ag.agent_id ?? ag.agent_internal_id ?? `agent-${idx}`;
              const removeKey = `remove:${aid}`;
              return (
                <div key={`${aid}-${idx}`} className="flex items-center justify-between gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="min-w-0">
                    <Link to={`/agent/${encodeURIComponent(aid)}`} className="font-bold text-sm text-blue-700 hover:underline">
                      {ag.agent_name || aid}
                    </Link>
                    <span className="block text-[11px] font-mono text-slate-400 mt-0.5">{aid}</span>
                  </div>
                  <button
                    onClick={() => removeAgent(aid)}
                    disabled={actingAgent === removeKey}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50"
                  >
                    {actingAgent === removeKey ? <Loader2 size={11} className="animate-spin" /> : <Unlink2 size={11} />}
                    Remove
                  </button>
                </div>
              );
            })}
            {linkedAgents.length === 0 && (
              <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                No linked Agents
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                <Link2 size={12} /> Add Agent Relation
              </p>
              <div className="relative w-full max-w-sm">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={agentSearch}
                  onChange={(e) => setAgentSearch(e.target.value)}
                  placeholder="Filter agents..."
                  className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
            <div className="max-h-[300px] overflow-y-auto divide-y divide-slate-100">
              {availableAgents.length === 0 && (
                <div className="p-3 text-xs text-slate-500">No available Agents to link.</div>
              )}
              {availableAgents.map(a => {
                const aid = a.identification?.agent_id ?? '';
                const addKey = `add:${aid}`;
                return (
                  <div key={aid} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-700 truncate">{a.name || aid}</p>
                      <p className="text-[11px] font-mono text-slate-400 truncate">{aid}</p>
                    </div>
                    <button
                      onClick={() => addAgent(aid)}
                      disabled={actingAgent === addKey}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {actingAgent === addKey ? <Loader2 size={11} className="animate-spin" /> : <PlusCircle size={11} />}
                      Link
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── AI Use Cases (many-to-many) ── */}
          <div className="h-px bg-slate-100 w-full" />

          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <ClipboardList size={15} />AI Use Cases ({linkedUseCases.length})
            </h3>
          </div>

          <div className="flex flex-col gap-3">
            {linkedUseCases.map((uc, idx) => {
              const ucId = uc.ai_use_case_id || `use-case-${idx}`;
              const removeKey = `remove:${ucId}`;
              return (
                <div key={`${ucId}-${idx}`} className="flex items-center justify-between gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="min-w-0">
                    <Link to={`/use-case/${encodeURIComponent(ucId)}`} className="font-bold text-sm text-blue-700 hover:underline">
                      {uc.ai_use_case_name || ucId}
                    </Link>
                    <span className="block text-[11px] font-mono text-slate-400 mt-0.5">{ucId}</span>
                    {uc.description && (
                      <span className="block text-xs text-slate-500 mt-1 max-w-[640px]">{uc.description}</span>
                    )}
                  </div>
                  <button
                    onClick={() => removeUseCase(ucId)}
                    disabled={actingUseCase === removeKey}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50"
                  >
                    {actingUseCase === removeKey ? <Loader2 size={11} className="animate-spin" /> : <Unlink2 size={11} />}
                    Remove
                  </button>
                </div>
              );
            })}
            {linkedUseCases.length === 0 && (
              <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                No linked AI Use Cases.
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                <Link2 size={12} />Add AI Use Case Relation
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
            <div className="max-h-[300px] overflow-y-auto divide-y divide-slate-100">
              {availableUseCases.length === 0 && (
                <div className="p-3 text-xs text-slate-500">No available AI use cases to link.</div>
              )}
              {availableUseCases.map(uc => {
                const id = uc.identifier ?? '';
                const addKey = `add:${id}`;
                return (
                  <div key={id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-700 truncate">{uc.name || id}</p>
                      <p className="text-[11px] font-mono text-slate-400 truncate">{id}</p>
                    </div>
                    <button
                      onClick={() => addUseCase(id)}
                      disabled={actingUseCase === addKey}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {actingUseCase === addKey ? <Loader2 size={11} className="animate-spin" /> : <PlusCircle size={11} />}
                      Link
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Related Applications (many-to-many) ── */}
          <div className="h-px bg-slate-100 w-full" />

          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <AppWindow size={15} />Applications ({linkedApplications.length})
            </h3>
          </div>

          <div className="flex flex-col gap-3">
            {linkedApplications.map((app, idx) => {
              const appId = app.business_application_id || `application-${idx}`;
              const removeKey = `remove:${appId}`;
              return (
                <div key={`${appId}-${idx}`} className="flex items-center justify-between gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="min-w-0">
                    <Link to={`/applications/${encodeURIComponent(appId)}`} className="font-bold text-sm text-blue-700 hover:underline">
                      {app.application_name || appId}
                    </Link>
                    <span className="block text-[11px] font-mono text-slate-400 mt-0.5">{appId}</span>
                    {app.description && (
                      <span className="block text-xs text-slate-500 mt-1 max-w-[640px]">{app.description}</span>
                    )}
                  </div>
                  <button
                    onClick={() => removeApplication(appId)}
                    disabled={actingApplication === removeKey}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50"
                  >
                    {actingApplication === removeKey ? <Loader2 size={11} className="animate-spin" /> : <Unlink2 size={11} />}
                    Remove
                  </button>
                </div>
              );
            })}
            {linkedApplications.length === 0 && (
              <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                No linked Applications.
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                <Link2 size={12} />Add Application Relation
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
            <div className="max-h-[300px] overflow-y-auto divide-y divide-slate-100">
              {availableApplications.length === 0 && (
                <div className="p-3 text-xs text-slate-500">No available Applications to link.</div>
              )}
              {availableApplications.map(app => {
                const addKey = `add:${app.business_application_id}`;
                return (
                  <div key={app.business_application_id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-700 truncate">{app.application_name || app.business_application_id}</p>
                      <p className="text-[11px] font-mono text-slate-400 truncate">{app.business_application_id}</p>
                    </div>
                    <button
                      onClick={() => addApplication(app.business_application_id)}
                      disabled={actingApplication === addKey}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {actingApplication === addKey ? <Loader2 size={11} className="animate-spin" /> : <PlusCircle size={11} />}
                      Link
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Related Processes (many-to-many) ── */}
          <div className="h-px bg-slate-100 w-full" />

          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Workflow size={15} />Processes ({linkedProcesses.length})
            </h3>
          </div>

          <div className="flex flex-col gap-3">
            {linkedProcesses.map((proc, idx) => {
              const procId = proc.business_process_id || `process-${idx}`;
              const removeKey = `remove:${procId}`;
              return (
                <div key={`${procId}-${idx}`} className="flex items-center justify-between gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="min-w-0">
                    <Link to={`/processes/${encodeURIComponent(procId)}`} className="font-bold text-sm text-blue-700 hover:underline">
                      {proc.process_name || procId}
                    </Link>
                    <span className="block text-[11px] font-mono text-slate-400 mt-0.5">{procId}</span>
                    {proc.description && (
                      <span className="block text-xs text-slate-500 mt-1 max-w-[640px]">{proc.description}</span>
                    )}
                  </div>
                  <button
                    onClick={() => removeProcess(procId)}
                    disabled={actingProcess === removeKey}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50"
                  >
                    {actingProcess === removeKey ? <Loader2 size={11} className="animate-spin" /> : <Unlink2 size={11} />}
                    Remove
                  </button>
                </div>
              );
            })}
            {linkedProcesses.length === 0 && (
              <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                No linked Processes.
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                <Link2 size={12} />Add Process Relation
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
            <div className="max-h-[300px] overflow-y-auto divide-y divide-slate-100">
              {availableProcesses.length === 0 && (
                <div className="p-3 text-xs text-slate-500">No available Processes to link.</div>
              )}
              {availableProcesses.map(proc => {
                const addKey = `add:${proc.business_process_id}`;
                return (
                  <div key={proc.business_process_id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-700 truncate">{proc.process_name || proc.business_process_id}</p>
                      <p className="text-[11px] font-mono text-slate-400 truncate">{proc.business_process_id}</p>
                    </div>
                    <button
                      onClick={() => addProcess(proc.business_process_id)}
                      disabled={actingProcess === addKey}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {actingProcess === addKey ? <Loader2 size={11} className="animate-spin" /> : <PlusCircle size={11} />}
                      Link
                    </button>
                  </div>
                );
              })}
            </div>
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
