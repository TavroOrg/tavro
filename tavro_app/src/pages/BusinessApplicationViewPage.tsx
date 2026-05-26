import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AppWindow,
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
import type {
  BusinessApplicationRecord,
  BusinessApplicationUpsertPayload,
} from '../types/businessRelations';
import { useCatalog } from '../context/CatalogContext';

type Tab = 'overview' | 'related';
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

const HINTS: Record<string, string> = {
  emergency_tier:
    "The Emergency Tier categorizes an application's crisis criticality to prioritize recovery execution order.",
  business_criticality:
    "Business Criticality defines how vital the application is to core operations and support/change prioritization.",
  agent_risk_exposure:
    'ARE represents overall application risk using highest related agent AIVSS and business/emergency criticality factors.',
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
  latest_release_date: toText(app.latest_release_date),
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
  latest_release_date: toNullable(form.latest_release_date),
  latest_release_documentation_link: toNullable(form.latest_release_documentation_link),
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
  const { agents } = useCatalog();
  const isCreateMode = !id || id === 'new';
  const linkAgentId = (searchParams.get('linkAgentId') || '').trim();

  const [application, setApplication] = useState<BusinessApplicationRecord | null>(null);
  const [form, setForm] = useState<ApplicationFormState>(emptyForm);
  const [loading, setLoading] = useState(!isCreateMode);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(isCreateMode);
  const [saving, setSaving] = useState(false);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [searchAgents, setSearchAgents] = useState('');
  const [actingAgent, setActingAgent] = useState<string | null>(null);
  const [relationError, setRelationError] = useState<string | null>(null);

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
    try {
      const data = await businessRelationsApi.getApplication(id);
      setApplication(data);
      setForm(formFromApplication(data));
      setAttemptedSave(false);
    } catch (err: any) {
      setError(err.message || 'Failed to load business application');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isCreateMode) {
      setApplication(null);
      setForm(emptyForm());
      setEditing(true);
      setAttemptedSave(false);
      setLoading(false);
      setTab('overview');
      setError(null);
      return;
    }
    setEditing(false);
    load();
  }, [id, isCreateMode]);

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

  const setField = (key: keyof ApplicationFormState, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
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
      setActionError(err.message || 'Failed to generate application description');
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
        const created = await businessRelationsApi.createApplication(payload);
        if (linkAgentId) {
          try {
            await businessRelationsApi.linkAgentToApplication(linkAgentId, created.business_application_id);
          } catch (linkErr) {
            console.warn('Application created but auto-link to agent failed.', linkErr);
          }
        }
        navigate(`/applications/${encodeURIComponent(created.business_application_id)}`, { replace: true });
        return;
      }
      if (!application) return;
      const updated = await businessRelationsApi.updateApplication(application.business_application_id, payload);
      setApplication(updated);
      setForm(formFromApplication(updated));
      setAttemptedSave(false);
      setEditing(false);
    } catch (err: any) {
      setActionError(err.message || 'Failed to save application');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setActionError(null);
    setAttemptedSave(false);
    if (isCreateMode) {
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
      navigate('/applications');
    } catch (err: any) {
      setActionError(err.message || 'Failed to delete application');
      setDeleting(false);
    }
  };

  const addAgent = async (agentId: string) => {
    if (!application) return;
    setActingAgent(agentId);
    setRelationError(null);
    try {
      await businessRelationsApi.linkAgentToApplication(agentId, application.business_application_id);
      await load();
    } catch (err: any) {
      setRelationError(err.message || 'Failed to add relation');
    } finally {
      setActingAgent(null);
    }
  };

  const removeAgent = async (agentId: string) => {
    if (!application) return;
    setActingAgent(agentId);
    setRelationError(null);
    try {
      await businessRelationsApi.unlinkAgentFromApplication(agentId, application.business_application_id);
      await load();
    } catch (err: any) {
      setRelationError(err.message || 'Failed to remove relation');
    } finally {
      setActingAgent(null);
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
          onClick={() => navigate('/applications')}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> Back to Applications
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
  const criticalityMeta = getCriticalityMeta(form.business_criticality);
  const emergencyTierMeta = getEmergencyTierMeta(form.emergency_tier);

  return (
    <div className="flex flex-col gap-6 w-full animate-fade-in max-w-[1400px] mx-auto pb-10">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={() => navigate('/applications')}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> Back to Applications
        </button>

        <div className="flex items-center gap-2 flex-wrap">
          {editing ? (
            <>
              <button
                onClick={handleCancelEdit}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              >
                <XCircle size={15} /> Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {isCreateMode ? 'Create Application' : 'Save Changes'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setTab('overview');
                  setAttemptedSave(false);
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
                Business Criticality
              </span>
              <span className={`inline-flex items-center gap-1 text-xs font-bold ${metricToneClass(criticalityMeta.tone)}`}>
                {criticalityMeta.tone === 'low' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                {criticalityMeta.label}
              </span>
            </div>

            <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[170px]">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">
                Emergency Tier
              </span>
              <span className={`inline-flex items-center gap-1 text-xs font-bold ${metricToneClass(emergencyTierMeta.tone)}`}>
                {emergencyTierMeta.tone === 'low' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                {emergencyTierMeta.label}
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
            Related Agents({relatedAgentCount})
          </button>
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
                  <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5">
                    {form.application_name || 'N/A'}
                  </p>
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
                  <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5">
                    {labelFromOptions(form.emergency_tier, EMERGENCY_TIER_OPTIONS)}
                  </p>
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
                      value={form[field as keyof ApplicationFormState]}
                      onChange={(e) => setField(field as keyof ApplicationFormState, e.target.value)}
                      className={inputCls}
                    />
                  ) : (
                    <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5">
                      {form[field as keyof ApplicationFormState] || 'N/A'}
                    </p>
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
                  <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5">
                    {labelFromOptions(form.business_criticality, BUSINESS_CRITICALITY_OPTIONS)}
                  </p>
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
                  <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 min-h-[84px]">
                    {form.application_description || 'N/A'}
                  </p>
                )}
              </div>
            </div>
          </Section>

          <Section title="Agent Risk Exposure">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ReadValue label="Agent Risk Exposure (ARE)" value={form.agent_risk_exposure} hint={HINTS.agent_risk_exposure} />
              <ReadValue label="# Of Associated Agents" value={form.num_of_associated_agents} hint={HINTS.num_of_associated_agents} />
              <ReadValue label="Inherent Risk Classification" value={labelFromOptions(form.inherent_risk_classification, INHERENT_RESIDUAL_OPTIONS)} />
              <ReadValue label="Residual Risk Classification" value={labelFromOptions(form.residual_risk_classification, INHERENT_RESIDUAL_OPTIONS)} />
              <ReadValue label="Agent Risk Tier (ART)" value={labelFromOptions(form.agent_risk_tier, AGENT_RISK_TIER_OPTIONS)} hint={HINTS.agent_risk_tier} />
              <ReadValue label="Blended Risk Score" value={form.blended_risk_score} />
              <ReadValue label="Inherent Risk Classification Score" value={form.inherent_risk_classification_score} />
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
                  <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5">
                    {labelFromOptions(form.embedded_ai, YES_NO_NONE_OPTIONS)}
                  </p>
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
                  <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5">
                    {labelFromOptions(form.opt_out_option, YES_NO_NONE_OPTIONS)}
                  </p>
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
                  <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 break-all">
                    {form.privacy_policy_url || 'N/A'}
                  </p>
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
                  <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5">
                    {labelFromOptions(form.data_excluded_from_ai_training, YES_NO_NONE_OPTIONS)}
                  </p>
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
                  <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 min-h-[84px]">
                    {form.vendor_description || 'N/A'}
                  </p>
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
                    <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 break-all">
                      {form[field as keyof ApplicationFormState] || 'N/A'}
                    </p>
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
                  <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5">
                    {labelFromOptions(form.is_current_version_supported, YES_NO_NONE_OPTIONS)}
                  </p>
                )}
              </div>
            </div>
          </Section>
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
    </div>
  );
};

export default BusinessApplicationViewPage;
