import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Boxes,
  Download,
  Link2,
  Loader2,
  Paperclip,
  PlusCircle,
  Save,
  Search,
  Sparkles,
  Trash2,
  Unlink2,
  XCircle,
} from 'lucide-react';
import { aiModelApi } from '../services/aiModelApi';
import { useCatalog } from '../context/CatalogContext';
import type { AiModelRecord, AiModelUpsertPayload, AiModelAttachmentRecord } from '../types/aiModel';

type Option = { label: string; value: string };

const VENDOR_OPTIONS: Option[] = [
  { label: '-- None --', value: '' },
  { label: 'Vendor', value: 'Vendor' },
  { label: 'In-house', value: 'In-house' },
];

const STATUS_OPTIONS: Option[] = [
  { label: '-- None --', value: '' },
  { label: 'Draft', value: 'Draft' },
  { label: 'In Development', value: 'In Development' },
  { label: 'In Validation', value: 'In Validation' },
  { label: 'Active', value: 'Active' },
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
];

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

const Field: React.FC<{ label: string; children: React.ReactNode; full?: boolean }> = ({ label, children, full }) => (
  <div className={`flex flex-col gap-1.5 ${full ? 'md:col-span-2' : ''}`}>
    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">{label}</label>
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

  const { agents: catalogAgents } = useCatalog();
  const setField = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  useEffect(() => {
    aiModelApi.listModels().then(setAllModels).catch(() => setAllModels([]));
  }, []);

  useEffect(() => {
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
        const data = await aiModelApi.getModel(id!);
        setModel(data);
        setForm(formFromModel(data));
      } catch (err: any) {
        setError(err.message || 'Failed to load AI model');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, isCreateMode]);

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
      setActionError(e.message || 'Failed to generate description.');
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
        const created = await aiModelApi.createModel(payload);
        if (linkAgentId) {
          try {
            await aiModelApi.linkAgent(created.ai_model_id, linkAgentId);
          } catch (linkErr) {
            console.warn('Model created but auto-link to agent failed.', linkErr);
          }
        }
        window.dispatchEvent(new CustomEvent('tavro:catalog-item-changed'));
        navigate(`/ai-models/${encodeURIComponent(created.ai_model_id)}`, { replace: true });
        return;
      }
      await aiModelApi.updateModel(model!.ai_model_id, payload);
      const fresh = await aiModelApi.getModel(model!.ai_model_id);
      setModel(fresh);
      setForm(formFromModel(fresh));
    } catch (err: any) {
      setActionError(err.message || 'Failed to save AI model');
    } finally {
      setSaving(false);
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
    return catalogAgents.filter(a => {
      const aid = a.identification?.agent_id ?? '';
      if (!aid || linkedAgentIds.has(aid)) return false;
      if (!q) return true;
      return (
        aid.toLowerCase().includes(q) ||
        (a.name ?? '').toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [catalogAgents, agentSearch, linkedAgentIds]);

  const addAgent = async (agentId: string) => {
    if (!model) return;
    setActingAgent(`add:${agentId}`);
    setRelationError(null);
    try {
      await aiModelApi.linkAgent(model.ai_model_id, agentId);
      await reloadModel();
    } catch (err: any) {
      setRelationError(err.message || 'Failed to attach agent.');
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
      setRelationError(err.message || 'Failed to remove agent.');
    } finally {
      setActingAgent(null);
    }
  };

  const text = (k: string, placeholder = '') => (
    <input className={inputCls} value={form[k]} onChange={e => setField(k, e.target.value)} placeholder={placeholder} />
  );
  const area = (k: string) => (
    <textarea className={textAreaCls} rows={3} value={form[k]} onChange={e => setField(k, e.target.value)} />
  );
  const select = (k: string, options: Option[]) => (
    <select className={inputCls} value={form[k]} onChange={e => setField(k, e.target.value)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

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
    <div className="flex flex-col gap-5 w-full max-w-[1100px] mx-auto animate-fade-in pb-10">
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={() => navigate('/ai-models')}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> Back to AI Models
        </button>
        <div className="flex items-center gap-2">
          {!isCreateMode && (
            <button
              onClick={() => navigate('/ai-models')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            >
              <XCircle size={15} /> Close
            </button>
          )}
          {(tab === 'overview' || isCreateMode) && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {isCreateMode ? 'Create Model' : 'Save'}
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
          <Boxes size={22} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-800">
            {isCreateMode ? 'New AI Model' : (form.model_name || model?.ai_model_id)}
          </h2>
          {!isCreateMode && <p className="text-[11px] font-mono text-slate-400">{model?.ai_model_id}</p>}
        </div>
      </div>

      {actionError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{actionError}</div>
      )}

      {!isCreateMode && (
        <div className="flex items-center gap-2 border-b border-slate-200">
          {([['overview', 'Overview'], ['business_impact', 'Business Impact']] as const).map(([key, label]) => (
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
            <button
              onClick={handleSuggest}
              disabled={generating || !form.model_name.trim()}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700 disabled:opacity-50 w-fit"
            >
              {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {generating ? 'Generating…' : 'AI assist'}
            </button>
          </div>
        </Field>
        <Field label="Department Executive">{text('department_executive')}</Field>
        <Field label="Business Functions">{text('business_functions')}</Field>
        <Field label="Vendor or In-house">{select('vendor_or_inhouse', VENDOR_OPTIONS)}</Field>
        <Field label="Provider">{text('provider')}</Field>
        <Field label="Status">{select('status', STATUS_OPTIONS)}</Field>
        <Field label="Parent Model">
          <select className={inputCls} value={form.parent_model_id} onChange={e => setField('parent_model_id', e.target.value)}>
            <option value="">-- None --</option>
            {parentOptions.map(m => (
              <option key={m.ai_model_id} value={m.ai_model_id}>{m.model_name || m.ai_model_id}</option>
            ))}
          </select>
        </Field>
        <Field label="Version Number">{text('version_number')}</Field>
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
        <Field label="Date of Last Model Validation">
          <input type="date" className={inputCls} value={form.last_validation_date} onChange={e => setField('last_validation_date', e.target.value)} />
        </Field>
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
              <Bot size={15} /> Related Agents ({linkedAgents.length})
            </h3>
            <p className="text-xs text-slate-500">Attach the agents that use this AI model.</p>
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
                No agents attached to this model.
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                <Link2 size={12} /> Attach Agent
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
                <div className="p-3 text-xs text-slate-500">No available agents to attach.</div>
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
                      Attach
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

export default AiModelViewPage;
