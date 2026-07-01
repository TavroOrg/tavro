import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Network,
  AlertCircle,
  ArrowLeft,
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
import { agentApi } from '../services/agentApi';
import { useBlueprint } from '../context/BlueprintContext';
import { useCatalog } from '../context/CatalogContext';
import { mcpClient } from '../services/mcpClient';
import type {
  IntegrationRecord,
  IntegrationUpsertPayload,
} from '../types/businessRelations';
import { toUserMessage } from '../utils/errorUtils';

type Tab = 'overview' | 'related';
type Option = { label: string; value: string };

const PROTOCOL_OPTIONS: Option[] = [
  { label: 'REST', value: 'REST' },
  { label: 'GraphQL', value: 'GraphQL' },
  { label: 'Webhook', value: 'Webhook' },
  { label: 'gRPC', value: 'gRPC' },
  { label: 'SOAP', value: 'SOAP' },
  { label: 'MCP', value: 'MCP' },
  { label: 'Event Stream', value: 'Event Stream' },
  { label: 'EDI', value: 'EDI' },
];

const AUTH_METHOD_OPTIONS: Option[] = [
  { label: 'OAuth2', value: 'OAuth2' },
  { label: 'API Key', value: 'API Key' },
  { label: 'mTLS', value: 'mTLS' },
  { label: 'Basic', value: 'Basic' },
  { label: 'None', value: 'None' },
];

const DATA_SENSITIVITY_OPTIONS: Option[] = [
  { label: 'None', value: 'None' },
  { label: 'PII', value: 'PII' },
  { label: 'PCI', value: 'PCI' },
  { label: 'PHI', value: 'PHI' },
  { label: 'Confidential', value: 'Confidential' },
];

const AVAILABILITY_STATUS_OPTIONS: Option[] = [
  { label: 'Active', value: 'Active' },
  { label: 'Deprecated', value: 'Deprecated' },
  { label: 'Planned', value: 'Planned' },
  { label: 'Unknown', value: 'Unknown' },
];

const INT_BUSINESS_CRITICALITY_OPTIONS: Option[] = [
  { label: '-- None --', value: '' },
  { label: 'High', value: 'High' },
  { label: 'Medium', value: 'Medium' },
  { label: 'Low', value: 'Low' },
];

const INT_EMERGENCY_TIER_OPTIONS: Option[] = [
  { label: '-- None --', value: '' },
  { label: 'Mission Critical', value: 'Mission Critical' },
  { label: 'Business Critical', value: 'Business Critical' },
  { label: 'Non-Critical', value: 'Non-Critical' },
];

interface IntegrationFormState {
  integration_name: string;
  integration_description: string;
  capabilities: string;
  protocol: string;
  endpoint_url: string;
  authentication_method: string;
  owner: string;
  documentation_url: string;
  data_sensitivity: string;
  rate_limit: string;
  availability_status: string;
  sla: string;
  version: string;
  parent_application_id: string;
  business_criticality: string;
  emergency_tier: string;
}

type IntegrationInlineField =
  | 'integration_name'
  | 'owner'
  | 'integration_description'
  | 'capabilities'
  | 'protocol'
  | 'authentication_method'
  | 'endpoint_url'
  | 'documentation_url'
  | 'version'
  | 'rate_limit'
  | 'data_sensitivity'
  | 'availability_status'
  | 'sla'
  | 'parent_application_id'
  | 'business_criticality'
  | 'emergency_tier';

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

const inputCls =
  'w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2.5 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-white text-slate-800 placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-500';
const textAreaCls = `${inputCls} resize-y min-h-[84px]`;

const toText = (value: unknown, fallback = ''): string => {
  if (value === null || value === undefined) return fallback;
  return String(value);
};

const toNullable = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const emptyForm = (): IntegrationFormState => ({
  integration_name: '',
  integration_description: '',
  capabilities: '',
  protocol: '',
  endpoint_url: '',
  authentication_method: '',
  owner: '',
  documentation_url: '',
  data_sensitivity: '',
  rate_limit: '',
  availability_status: '',
  sla: '',
  version: '',
  parent_application_id: '',
  business_criticality: '',
  emergency_tier: '',
});

const formFromIntegration = (item: IntegrationRecord): IntegrationFormState => ({
  integration_name: toText(item.integration_name),
  integration_description: toText(item.integration_description),
  capabilities: toText(item.capabilities),
  protocol: toText(item.protocol),
  endpoint_url: toText(item.endpoint_url),
  authentication_method: toText(item.authentication_method),
  owner: toText(item.owner),
  documentation_url: toText(item.documentation_url),
  data_sensitivity: toText(item.data_sensitivity),
  rate_limit: toText(item.rate_limit),
  availability_status: toText(item.availability_status),
  sla: toText(item.sla),
  version: toText(item.version),
  parent_application_id: toText(item.parent_application_id),
  business_criticality: toText(item.business_criticality),
  emergency_tier: toText(item.emergency_tier),
});

const buildIntegrationPayload = (form: IntegrationFormState): IntegrationUpsertPayload => ({
  integration_name: toNullable(form.integration_name),
  integration_description: toNullable(form.integration_description),
  capabilities: toNullable(form.capabilities),
  protocol: toNullable(form.protocol),
  endpoint_url: toNullable(form.endpoint_url),
  authentication_method: toNullable(form.authentication_method),
  owner: toNullable(form.owner),
  documentation_url: toNullable(form.documentation_url),
  data_sensitivity: toNullable(form.data_sensitivity),
  rate_limit: toNullable(form.rate_limit),
  availability_status: toNullable(form.availability_status),
  sla: toNullable(form.sla),
  version: toNullable(form.version),
  parent_application_id: toNullable(form.parent_application_id),
  business_criticality: toNullable(form.business_criticality),
  emergency_tier: toNullable(form.emergency_tier),
});

const changedIntegrationPayload = (
  current: IntegrationFormState,
  next: IntegrationFormState,
): IntegrationUpsertPayload => {
  const currentPayload = buildIntegrationPayload(current);
  const nextPayload = buildIntegrationPayload(next);
  const changed: IntegrationUpsertPayload = {};
  (Object.keys(nextPayload) as Array<keyof IntegrationUpsertPayload>).forEach(key => {
    if (nextPayload[key] !== currentPayload[key]) {
      Object.assign(changed, { [key]: nextPayload[key] ?? null });
    }
  });
  return changed;
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

const IntegrationViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const linkAgentId = searchParams.get('linkAgentId')?.trim() || '';
  const { activeCompany } = useBlueprint();
  const { agents: catalogAgents } = useCatalog();
  const [companyAgents, setCompanyAgents] = useState<typeof catalogAgents>([]);

  useEffect(() => {
    agentApi.listAgentsForLinking(activeCompany?.id).then(setCompanyAgents).catch(() => {});
  }, [activeCompany?.id]);

  const agents = companyAgents.length > 0 ? companyAgents : catalogAgents;
  const isCreateMode = !id || id === 'new';

  const [integration, setIntegration] = useState<IntegrationRecord | null>(null);
  const [form, setForm] = useState<IntegrationFormState>(emptyForm);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [tagSaving, setTagSaving] = useState(false);
  const [loading, setLoading] = useState(!isCreateMode);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(isCreateMode);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [inlineEdit, setInlineEdit] = useState<{ field: IntegrationInlineField; value: string } | null>(null);
  const [inlineSaving, setInlineSaving] = useState<IntegrationInlineField | null>(null);

  const [searchAgents, setSearchAgents] = useState('');
  const [actingAgent, setActingAgent] = useState<string | null>(null);
  const [relationError, setRelationError] = useState<string | null>(null);
  const [generatingDescription, setGeneratingDescription] = useState(false);

  const load = async () => {
    if (!id || isCreateMode) return;
    setLoading(true);
    setError(null);
    try {
      const data = await businessRelationsApi.getIntegration(id, activeCompany?.id);
      setIntegration(data);
      setForm(formFromIntegration(data));
      setTags(Array.isArray(data.tags) ? data.tags : []);
      setAttemptedSave(false);
    } catch (err: unknown) {
      setError(toUserMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isCreateMode) {
      setIntegration(null);
      setForm(emptyForm());
      setTags([]);
      setEditing(true);
      setAttemptedSave(false);
      setLoading(false);
      setTab('overview');
      setError(null);
      return;
    }
    setEditing(false);
    load();
  }, [id, isCreateMode, activeCompany?.id]);

  useEffect(() => {
    if (!id || isCreateMode || editing) return;

    const handleWorkflowUpdate = () => {
      mcpClient.invalidateCache();
      load();
    };

    window.addEventListener('tavro_temporal_workflow_update', handleWorkflowUpdate);
    return () => window.removeEventListener('tavro_temporal_workflow_update', handleWorkflowUpdate);
  }, [id, isCreateMode, editing]);

  const relatedAgentCount = useMemo(
    () => integration?.related_agents?.length ?? 0,
    [integration],
  );

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) {
      const aid = a.identification?.agent_id;
      if (aid) map.set(aid, a.name);
    }
    return map;
  }, [agents]);

  const linkedAgentIds = useMemo(() => {
    const set = new Set<string>();
    for (const rel of integration?.related_agents ?? []) {
      if (rel.agent_id) set.add(rel.agent_id);
    }
    return set;
  }, [integration]);

  const availableAgents = useMemo(() => {
    const q = searchAgents.trim().toLowerCase();
    return agents.filter(agent => {
      const agentId = agent.identification?.agent_id || '';
      if (!agentId || linkedAgentIds.has(agentId)) return false;
      if (!q) return true;
      return (
        agentId.toLowerCase().includes(q) ||
        agent.name.toLowerCase().includes(q)
      );
    });
  }, [agents, linkedAgentIds, searchAgents]);

  const addAgent = async (agentId: string) => {
    if (!integration) return;
    setActingAgent(agentId);
    setRelationError(null);
    try {
      await businessRelationsApi.linkAgentToIntegration(agentId, integration.integration_id, activeCompany?.id);
      await load();
    } catch (err: any) {
      setRelationError(toUserMessage(err));
    } finally {
      setActingAgent(null);
    }
  };

  const removeAgent = async (agentId: string) => {
    if (!integration) return;
    setActingAgent(agentId);
    setRelationError(null);
    try {
      await businessRelationsApi.unlinkAgentFromIntegration(agentId, integration.integration_id, activeCompany?.id);
      await load();
    } catch (err: any) {
      setRelationError(toUserMessage(err));
    } finally {
      setActingAgent(null);
    }
  };

  const setField = (key: keyof IntegrationFormState, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const isNameMissing = !form.integration_name.trim();

  // ── Inline edit handlers ───────────────────────────────────────────────────

  const startInlineEdit = (field: IntegrationInlineField) => {
    if (editing || isCreateMode || saving || inlineSaving) return;
    setActionError(null);
    setInlineEdit({ field, value: form[field] });
  };

  const cancelInlineEdit = () => {
    setInlineEdit(null);
    setActionError(null);
  };

  const saveInlineEdit = async () => {
    if (!integration || !inlineEdit) return;
    const nextForm = { ...form, [inlineEdit.field]: inlineEdit.value };
    if (!nextForm.integration_name.trim()) {
      setActionError('Integration Name is required.');
      return;
    }
    setInlineSaving(inlineEdit.field);
    setActionError(null);
    try {
      const changedPayload = changedIntegrationPayload(formFromIntegration(integration), nextForm);
      if (Object.keys(changedPayload).length === 0) {
        setInlineEdit(null);
        setAttemptedSave(false);
        return;
      }
      const updated = await businessRelationsApi.updateIntegration(
        integration.integration_id,
        changedPayload,
        activeCompany?.id,
      );
      setIntegration(updated);
      setForm(formFromIntegration(updated));
      setTags(Array.isArray(updated.tags) ? updated.tags : []);
      setInlineEdit(null);
      setAttemptedSave(false);
    } catch (err: unknown) {
      setActionError(toUserMessage(err));
    } finally {
      setInlineSaving(null);
    }
  };

  const renderInlineEditable = (
    field: IntegrationInlineField,
    displayValue: string,
    config: { kind?: 'text' | 'textarea' | 'select'; options?: Option[]; className?: string } = {},
  ) => {
    const isActive = inlineEdit?.field === field;
    const kind = config.kind ?? 'text';
    const valueClass = config.className ?? 'text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5';
    const isSavingField = inlineSaving === field;
    const saveDisabled = isSavingField || (field === 'integration_name' && !inlineEdit?.value.trim());

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
              title={field === 'integration_name' && !inlineEdit.value.trim() ? 'Integration Name is required' : 'Save'}
              className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-blue-600 text-xs font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {isSavingField ? <Loader2 size={12} className="animate-spin" /> : '✓'}
            </button>
            <button
              type="button"
              onClick={cancelInlineEdit}
              disabled={isSavingField}
              title="Cancel"
              className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50"
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
        title={!editing && !isCreateMode ? 'Double-click to edit' : undefined}
        className={`${valueClass} ${!editing && !isCreateMode ? 'cursor-text hover:border-blue-200 hover:bg-blue-50/40 transition-colors' : ''}`}
      >
        {displayValue}
      </p>
    );
  };

  // ── Bulk save / cancel ─────────────────────────────────────────────────────

  const handleSuggestDescription = async () => {
    if (!form.integration_name.trim()) {
      setActionError('Integration Name is required before generating the description.');
      return;
    }
    setGeneratingDescription(true);
    setActionError(null);
    try {
      const result = await businessRelationsApi.suggestIntegrationDescription(form.integration_name.trim());
      if (result.description) {
        setField('integration_description', result.description);
      }
    } catch (err: any) {
      setActionError(toUserMessage(err));
    } finally {
      setGeneratingDescription(false);
    }
  };

  const handleSave = async () => {
    setAttemptedSave(true);
    if (isNameMissing) {
      setActionError('Integration Name is required.');
      return;
    }

    setSaving(true);
    setActionError(null);
    try {
      const payload = buildIntegrationPayload(form);
      if (isCreateMode) {
        if (tags.length > 0) payload.tags = tags;
        const created = await businessRelationsApi.createIntegration(payload, activeCompany?.id);
        window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
        if (linkAgentId) {
          try {
            await businessRelationsApi.linkAgentToIntegration(linkAgentId, created.integration_id, activeCompany?.id);
          } catch (linkErr) {
            console.warn('Integration created but auto-link to agent failed.', linkErr);
          }
          navigate(`/agent/${encodeURIComponent(linkAgentId)}`, { replace: true });
          return;
        }
        navigate(`/integrations/${encodeURIComponent(created.integration_id)}`, { replace: true });
        return;
      }
      if (!integration) return;
      const changedPayload = changedIntegrationPayload(formFromIntegration(integration), form);
      if (Object.keys(changedPayload).length === 0) {
        setAttemptedSave(false);
        setEditing(false);
        return;
      }
      const updated = await businessRelationsApi.updateIntegration(integration.integration_id, changedPayload, activeCompany?.id);
      setIntegration(updated);
      setForm(formFromIntegration(updated));
      setTags(Array.isArray(updated.tags) ? updated.tags : []);
      setAttemptedSave(false);
      setEditing(false);
    } catch (err: unknown) {
      setActionError(toUserMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setActionError(null);
    setAttemptedSave(false);
    if (isCreateMode) {
      navigate('/integrations');
      return;
    }
    if (integration) setForm(formFromIntegration(integration));
    setEditing(false);
  };

  const handleDelete = async () => {
    if (!integration) return;
    const ok = window.confirm(`Delete integration "${integration.integration_name || integration.integration_id}"?`);
    if (!ok) return;
    setDeleting(true);
    setActionError(null);
    try {
      await businessRelationsApi.deleteIntegration(integration.integration_id);
      window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
      navigate('/integrations');
    } catch (err: unknown) {
      setActionError(toUserMessage(err));
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500">
        <Loader2 size={16} className="animate-spin" />
        Loading integration details...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <button
          onClick={() => navigate('/integrations')}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> Back to Integrations
        </button>
        <div className="flex items-start gap-3 text-red-500 bg-red-50 border border-red-200 rounded-xl px-6 py-4">
          <AlertCircle size={20} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-bold text-sm">Could not load integration</p>
            <p className="text-xs mt-1 text-red-400">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const pageTitle = form.integration_name || integration?.integration_name || 'New Integration';
  const integrationId = integration?.integration_id || 'Will be generated on create';

  return (
    <div className="flex flex-col gap-6 w-full animate-fade-in max-w-[1400px] mx-auto pb-10">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={() => navigate('/integrations')}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> Back to Integrations
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
                disabled={saving || isNameMissing}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {isCreateMode ? 'Create Integration' : 'Save'}
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
        <div className="h-4 bg-gradient-to-r from-violet-600 to-blue-600 rounded-t-2xl w-full" />
        <div className="p-6 bg-slate-50 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 flex-wrap">
          <div className="flex items-start gap-4 min-w-0 flex-1 md:max-w-[60%]">
            <div className="p-3 bg-violet-600 text-white rounded-xl shadow-sm mt-1 shrink-0">
              <Network size={24} />
            </div>
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Integration</span>
              <h2 className="text-2xl font-bold text-slate-800 tracking-tight truncate">{pageTitle}</h2>
              <p className="text-xs font-mono text-slate-400 mt-1">{integrationId}</p>
              <p className="text-sm text-slate-600 line-clamp-2">
                {form.integration_description || 'No description available.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 shrink-0 w-full md:w-auto mt-2 md:mt-0">
            {form.protocol && (
              <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[130px]">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">Protocol</span>
                <span className="text-xs font-bold text-violet-700">{form.protocol}</span>
              </div>
            )}
            {form.availability_status && (
              <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[130px]">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">Availability</span>
                <span className="text-xs font-bold text-slate-700">{form.availability_status}</span>
              </div>
            )}
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
              <span className="text-xs font-bold text-slate-700">{String(integration?.agent_risk_exposure ?? 'N/A')}</span>
            </div>
            <div className="bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[130px]">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5 inline-flex items-center gap-1">
                ART
                <span title="ART (Agent Risk Tier) indicates overall application risk from ARE score: Low &lt; 3, Medium 3–&lt;7, High 7–&lt;9, Critical ≥ 9.">
                  <Info size={10} className="text-slate-400" />
                </span>
              </span>
              <span className={`inline-flex items-center gap-1 text-xs font-bold ${metricToneClass(getArtTone(integration?.agent_risk_tier))}`}>
                {getArtTone(integration?.agent_risk_tier) === 'low' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                {integration?.agent_risk_tier ?? 'None'}
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
          <button
            onClick={() => setTab('related')}
            className={`px-4 py-2.5 text-sm font-bold border-b-2 transition-colors ${
              tab === 'related'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Related Agents ({relatedAgentCount})
          </button>
        )}
      </div>

      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          <Section title="General">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <HintLabel label="Integration Name" required />
                {editing ? (
                  <>
                    <input
                      value={form.integration_name}
                      onChange={(e) => {
                        const value = e.target.value;
                        setField('integration_name', value);
                        if (attemptedSave && value.trim()) setActionError(null);
                      }}
                      className={`${inputCls} ${attemptedSave && isNameMissing ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20' : ''}`}
                      placeholder="Integration name"
                      aria-invalid={attemptedSave && isNameMissing}
                    />
                    {attemptedSave && isNameMissing && (
                      <p className="text-xs text-red-600">Integration Name is required.</p>
                    )}
                  </>
                ) : (
                  renderInlineEditable('integration_name', form.integration_name || 'N/A')
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <HintLabel label="Owner" />
                {editing ? (
                  <input
                    value={form.owner}
                    onChange={(e) => setField('owner', e.target.value)}
                    className={inputCls}
                    placeholder="Owner name or team"
                  />
                ) : (
                  renderInlineEditable('owner', form.owner || 'N/A')
                )}
              </div>

              <div className="md:col-span-2 flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <HintLabel label="Integration Description" />
                  {editing && (
                    <button
                      type="button"
                      onClick={handleSuggestDescription}
                      disabled={generatingDescription || !form.integration_name.trim()}
                      title={form.integration_name.trim() ? 'Generate description with AI' : 'Enter an integration name first'}
                      className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg border transition-all ${
                        generatingDescription
                          ? 'bg-violet-50 border-violet-200 text-violet-500 cursor-wait'
                          : form.integration_name.trim()
                            ? 'bg-violet-50 border-violet-200 text-violet-600 hover:bg-violet-100 hover:border-violet-300'
                            : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'
                      }`}
                    >
                      {generatingDescription ? <RefreshCw size={11} className="animate-spin" /> : <Sparkles size={11} />}
                      {generatingDescription ? 'Generating...' : 'AI assist'}
                    </button>
                  )}
                </div>
                {editing ? (
                  <textarea
                    value={form.integration_description}
                    onChange={(e) => setField('integration_description', e.target.value)}
                    rows={3}
                    className={`${textAreaCls} ${generatingDescription ? 'opacity-50' : ''}`}
                    disabled={generatingDescription}
                  />
                ) : (
                  renderInlineEditable('integration_description', form.integration_description || 'N/A', {
                    kind: 'textarea',
                    className: 'text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 min-h-[84px] whitespace-pre-wrap',
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
                          if (!integration) return;
                          setTagSaving(true);
                          try {
                            const updated = await businessRelationsApi.updateIntegration(integration.integration_id, { tags: next }, activeCompany?.id);
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
                          const updated = await businessRelationsApi.updateIntegration(integration!.integration_id, { tags: next }, activeCompany?.id);
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
            </div>
          </Section>

          <Section title="Capabilities">
            <p className="text-xs text-slate-400 -mt-1">
              List the data, events, and operations this integration exposes — used by Spark to generate contextual AI ideas.
            </p>
            <div className="flex flex-col gap-1.5">
              <HintLabel label="Capabilities" hint="Describe what this integration can read, write, subscribe to, or trigger. Use bullet points or numbered lists." />
              {editing ? (
                <textarea
                  value={form.capabilities}
                  onChange={(e) => setField('capabilities', e.target.value)}
                  rows={5}
                  className={textAreaCls}
                  placeholder={`e.g.\n1. Read real-time machine sensor data (OPC-UA)\n2. Push quality alerts to ERP work orders\n3. Subscribe to production schedule changes`}
                />
              ) : (
                renderInlineEditable('capabilities', form.capabilities || 'No capabilities defined.', {
                  kind: 'textarea',
                  className: 'text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 min-h-[100px] whitespace-pre-wrap',
                })
              )}
            </div>
          </Section>

          <Section title="Agent Risk Exposure">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <HintLabel label="Business Criticality" hint="Business Criticality defines how vital the integration is to core operations." />
                {editing ? (
                  <select value={form.business_criticality} onChange={(e) => setField('business_criticality', e.target.value)} className={inputCls}>
                    {INT_BUSINESS_CRITICALITY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                ) : (
                  renderInlineEditable('business_criticality', form.business_criticality || 'N/A', { kind: 'select', options: INT_BUSINESS_CRITICALITY_OPTIONS })
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <HintLabel label="Emergency Tier" hint="The Emergency Tier categorizes an integration's crisis criticality to prioritize recovery execution order." />
                {editing ? (
                  <select value={form.emergency_tier} onChange={(e) => setField('emergency_tier', e.target.value)} className={inputCls}>
                    {INT_EMERGENCY_TIER_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                ) : (
                  renderInlineEditable('emergency_tier', form.emergency_tier || 'N/A', { kind: 'select', options: INT_EMERGENCY_TIER_OPTIONS })
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <HintLabel label="ARE" hint="ARE is the highest blended risk score among related agents multiplied by the average of Business Criticality and Emergency Tier scores." />
                <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 min-h-[42px]">{String(integration?.agent_risk_exposure ?? 0)}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <HintLabel label="ART" hint="ART indicates overall integration risk from ARE score: Low &lt; 3, Medium 3-&lt;7, High 7-&lt;9, Critical &ge; 9." />
                <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 min-h-[42px]">{integration?.agent_risk_tier ?? 'None'}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <HintLabel label="Blended Risk Score" hint="The highest current blended risk score across agents associated with this integration." />
                <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 min-h-[42px]">{String(integration?.blended_risk_score ?? 0)}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <HintLabel label="# Of Associated Agents" hint="Indicates the total number of agents associated with this integration." />
                <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 min-h-[42px]">{String(integration?.num_of_associated_agents ?? 0)}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <HintLabel label="Inherent Risk Classification" />
                <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 min-h-[42px]">{integration?.inherent_risk_classification || 'N/A'}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <HintLabel label="Inherent Risk Classification Score" />
                <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 min-h-[42px]">{String(integration?.inherent_risk_classification_score ?? 0)}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <HintLabel label="Residual Risk Classification" />
                <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 min-h-[42px]">{integration?.residual_risk_classification || 'N/A'}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <HintLabel label="Residual Risk Classification Score" />
                <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 min-h-[42px]">{String(integration?.residual_risk_classification_score ?? 0)}</p>
              </div>
            </div>
          </Section>

          <Section title="Technical Details">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <HintLabel label="Protocol" />
                {editing ? (
                  <select
                    value={form.protocol}
                    onChange={(e) => setField('protocol', e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select...</option>
                    {PROTOCOL_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  renderInlineEditable('protocol', form.protocol || 'N/A', {
                    kind: 'select',
                    options: PROTOCOL_OPTIONS,
                  })
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <HintLabel label="Authentication Method" />
                {editing ? (
                  <select
                    value={form.authentication_method}
                    onChange={(e) => setField('authentication_method', e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select...</option>
                    {AUTH_METHOD_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  renderInlineEditable('authentication_method', form.authentication_method || 'N/A', {
                    kind: 'select',
                    options: AUTH_METHOD_OPTIONS,
                  })
                )}
              </div>

              <div className="md:col-span-2 flex flex-col gap-1.5">
                <HintLabel label="Endpoint URL" />
                {editing ? (
                  <input
                    value={form.endpoint_url}
                    onChange={(e) => setField('endpoint_url', e.target.value)}
                    className={inputCls}
                    placeholder="https://..."
                  />
                ) : (
                  renderInlineEditable('endpoint_url', form.endpoint_url || 'N/A', {
                    className: 'text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 break-all',
                  })
                )}
              </div>

              <div className="md:col-span-2 flex flex-col gap-1.5">
                <HintLabel label="Documentation URL" />
                {editing ? (
                  <input
                    value={form.documentation_url}
                    onChange={(e) => setField('documentation_url', e.target.value)}
                    className={inputCls}
                    placeholder="https://..."
                  />
                ) : (
                  renderInlineEditable('documentation_url', form.documentation_url || 'N/A', {
                    className: 'text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 break-all',
                  })
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <HintLabel label="Version" />
                {editing ? (
                  <input
                    value={form.version}
                    onChange={(e) => setField('version', e.target.value)}
                    className={inputCls}
                    placeholder="e.g. v1.2.0"
                  />
                ) : (
                  renderInlineEditable('version', form.version || 'N/A')
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <HintLabel label="Rate Limit" />
                {editing ? (
                  <input
                    value={form.rate_limit}
                    onChange={(e) => setField('rate_limit', e.target.value)}
                    className={inputCls}
                    placeholder="e.g. 1000 req/min"
                  />
                ) : (
                  renderInlineEditable('rate_limit', form.rate_limit || 'N/A')
                )}
              </div>
            </div>
          </Section>

          <Section title="Governance">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <HintLabel label="Data Sensitivity" />
                {editing ? (
                  <select
                    value={form.data_sensitivity}
                    onChange={(e) => setField('data_sensitivity', e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select...</option>
                    {DATA_SENSITIVITY_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  renderInlineEditable('data_sensitivity', form.data_sensitivity || 'N/A', {
                    kind: 'select',
                    options: DATA_SENSITIVITY_OPTIONS,
                  })
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <HintLabel label="Availability Status" />
                {editing ? (
                  <select
                    value={form.availability_status}
                    onChange={(e) => setField('availability_status', e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select...</option>
                    {AVAILABILITY_STATUS_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  renderInlineEditable('availability_status', form.availability_status || 'N/A', {
                    kind: 'select',
                    options: AVAILABILITY_STATUS_OPTIONS,
                  })
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <HintLabel label="SLA" />
                {editing ? (
                  <input
                    value={form.sla}
                    onChange={(e) => setField('sla', e.target.value)}
                    className={inputCls}
                    placeholder="e.g. 99.9% uptime"
                  />
                ) : (
                  renderInlineEditable('sla', form.sla || 'N/A')
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <HintLabel label="Parent Application ID" />
                {editing ? (
                  <input
                    value={form.parent_application_id}
                    onChange={(e) => setField('parent_application_id', e.target.value)}
                    className={inputCls}
                    placeholder="Application UUID"
                  />
                ) : (
                  renderInlineEditable(
                    'parent_application_id',
                    form.parent_application_id
                      ? form.parent_application_id
                      : integration?.parent_application_name
                        ? `${integration.parent_application_name}`
                        : 'N/A',
                    { className: 'text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 break-all' },
                  )
                )}
              </div>
            </div>
          </Section>
        </div>
      )}

      {tab === 'related' && integration && (
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
              {integration.related_agents.length === 0 && (
                <div className="p-5 text-sm text-slate-500">No agents linked.</div>
              )}
              {integration.related_agents.map((rel, idx) => {
                const relId = rel.agent_id || `missing-${idx}`;
                const displayName = rel.agent_id
                  ? (agentNameById.get(rel.agent_id) || rel.agent_name || rel.agent_id)
                  : (rel.agent_name || 'Unknown Agent');
                return (
                  <div key={`${relId}-${idx}`} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      {rel.agent_id ? (
                        <Link
                          to={`/agent/${encodeURIComponent(rel.agent_id)}`}
                          className="text-sm font-semibold text-blue-600 hover:underline"
                        >
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
    </div>
  );
};

export default IntegrationViewPage;
