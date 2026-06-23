import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Loader2, CheckCircle2, AlertCircle, ArrowLeft, RefreshCw, Sparkles} from 'lucide-react';
import { mcpClient } from '../services/mcpClient';
import { agentApi } from '../services/agentApi';
import { useCatalog } from '../context/CatalogContext';
import { AgentData, AGENT_TYPES } from '../types/agent';
import { useBlueprint } from '../context/BlueprintContext';

const ENVIRONMENTS = ['Production', 'UAT', 'Development', 'Staging'];

type AgentForm = {
  name: string; description: string; instruction: string;
  owner: string; role: string; environment: string; agentType: string;
};

const CreateAgentPage: React.FC = () => {
  const navigate = useNavigate();
  const { refresh, upsertAgent } = useCatalog();
  const { activeCompany } = useBlueprint();

  const [form, setForm] = useState<AgentForm>({
    name: '', description: '', instruction: '',
    owner: '', role: '', environment: '', agentType: 'Config-driven',
  });
  const [saving, setSaving] = useState(false);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const redirectTimerRef = useRef<number | null>(null);

  const set = (field: keyof AgentForm, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleSuggestDescription = async () => {
    if (!form.name.trim()) {
      setError('Enter an agent name first so AI can generate the description.');
      return;
    }

    setGeneratingDescription(true);
    setError(null);
    try {
      const result = await agentApi.suggestDescription(form.name.trim());
      if (result.description) {
        set('description', result.description);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate description.');
    } finally {
      setGeneratingDescription(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const UUID_LOOSE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
      const TAV_LOOSE = /\bTAV[A-Z0-9]{6,}\b/i;

      const extractFromStr = (s: string): string | null => {
        const m = s.match(UUID_LOOSE) ?? s.match(TAV_LOOSE);
        return m ? m[0] : null;
      };

      function deepScanUuid(obj: unknown): string | null {
        if (typeof obj === 'string') return extractFromStr(obj);
        if (!obj || typeof obj !== 'object') return null;
        for (const val of Object.values(obj as Record<string, unknown>)) {
          const found = typeof val === 'string' ? extractFromStr(val) : deepScanUuid(val);
          if (found) return found;
        }
        return null;
      }

      let createdAgentId: string;
      try {
        const createResult = await agentApi.createAgent({
          agent_name: form.name.trim(),
          description: form.description.trim(),
          instruction: form.instruction.trim() || form.description.trim() || form.name.trim(),
          agent_type: form.agentType || 'Config-driven',
          ...(form.role.trim() && { role: form.role.trim() }),
          ...(form.environment.trim() && { environment: form.environment.trim() }),
          ...(form.owner.trim() && { owner: form.owner.trim() }),
        }, activeCompany?.id, activeCompany?.name);
        createdAgentId = createResult.agent_id;
      } catch {
        const mcpResult = await mcpClient.createAgent({
          agent_name: form.name.trim(),
          description: form.description.trim(),
          instruction: form.instruction.trim() || form.description.trim() || form.name.trim(),
        });
        const scanned = deepScanUuid(mcpResult);
        createdAgentId = scanned ?? form.name.trim();
      }
      mcpClient.invalidateCache();
      const optimisticAgent: AgentData = {
        name: form.name.trim(),
        description: form.description.trim() || form.name.trim(),
        version: '1.0',
        identification: {
          agent_id: createdAgentId,
          role: form.role.trim() || null,
          instruction: form.instruction.trim() || form.description.trim() || form.name.trim(),
          environment: form.environment.trim() || null,
          owner: form.owner.trim() || null,
          governance_status: 'Risk Assessment is running',
        },
        configuration: { autonomy_level: null },
        tool: [],
        data_source: [],
        application: [],
        business_process: [],
        risk_assessment: null,
      };
      upsertAgent(optimisticAgent);

      const pendingRaw = localStorage.getItem('tavro_pending_assessment_agents');
      const pending = pendingRaw ? JSON.parse(pendingRaw) as string[] : [];
      const nextPending = Array.from(new Set([...pending, createdAgentId]));
      localStorage.setItem('tavro_pending_assessment_agents', JSON.stringify(nextPending));
      const pendingMetaRaw = localStorage.getItem('tavro_pending_assessment_agent_meta');
      const pendingMeta = pendingMetaRaw ? JSON.parse(pendingMetaRaw) as Array<{ agent_id: string; name: string; description: string; created_at: string; }> : [];
      const withoutCurrent = pendingMeta.filter(item => item.agent_id !== createdAgentId);
      withoutCurrent.unshift({
        agent_id: createdAgentId,
        name: form.name.trim(),
        description: form.description.trim() || form.name.trim(),
        created_at: new Date().toISOString(),
      });
      localStorage.setItem('tavro_pending_assessment_agent_meta', JSON.stringify(withoutCurrent));

      setSuccess(true);
      sessionStorage.setItem(
        'tavro_catalog_notice',
        'Agent created successfully. Risk assessment is running in the background.'
      );
      refresh();
      redirectTimerRef.current = window.setTimeout(() => navigate('/catalog'), 1200);
    } catch (err: any) {
      setError(err.message || 'Failed to create agent.');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) window.clearTimeout(redirectTimerRef.current);
    };
  }, []);

  const inputCls =
    'w-full text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-blue-400/30 dark:focus:ring-blue-700/40 focus:border-blue-400 dark:focus:border-blue-500 transition-all bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500';
  const labelCls =
    'block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5';

  return (
    <div className="flex flex-col gap-6 w-full animate-fade-in max-w-3xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/catalog')}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 transition-all bg-transparent border-none cursor-pointer"
        >
          <ArrowLeft size={16} /> Back to Agents
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm overflow-hidden border border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3 px-8 py-6 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-blue-50 to-white dark:from-slate-900 dark:to-slate-800">
          <div className="p-2.5 bg-blue-100 text-blue-600 rounded-xl">
            <Bot size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">
              Create Agent
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Register a new agent in the catalog
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="p-8 flex flex-col gap-6">

            <div>
              <label className={labelCls}>
                Agent Name <span className="text-red-500">*</span>
              </label>
              <input
                required
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="e.g. Fraud Case Triage Agent"
                className={inputCls}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={`${labelCls} mb-0`}>Description <span className="text-red-500">*</span></label>
                <button
                  type="button"
                  onClick={handleSuggestDescription}
                  disabled={generatingDescription || !form.name.trim()}
                  title={form.name.trim() ? 'Generate description with AI' : 'Enter an agent name first'}
                  className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg border transition-all ${
                    generatingDescription
                      ? 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-700 text-violet-500 cursor-wait'
                      : form.name.trim()
                      ? 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-700 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/40 hover:border-violet-300 dark:hover:border-violet-600'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-300 dark:text-slate-600 cursor-not-allowed'
                  }`}
                >
                  {generatingDescription
                    ? <RefreshCw size={11} className="animate-spin" />
                    : <Sparkles size={11} />}
                  {generatingDescription ? 'Generating…' : 'AI assist'}
                </button>
              </div>
              <div className="relative">
                <textarea
                  rows={3}
                  required
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  placeholder={generatingDescription ? 'Generating description…' : 'What this agent does and what problem it solves'}
                  className={`${inputCls} resize-none transition-all ${generatingDescription ? 'opacity-50' : ''}`}
                  disabled={generatingDescription}
                />
                {generatingDescription && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/60 dark:bg-slate-800/60">
                    <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400 text-[11px] font-bold">
                      <Sparkles size={13} className="animate-pulse" />
                      Generating with AI…
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className={labelCls}>
                Instruction <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={4}
                required
                value={form.instruction}
                onChange={e => set('instruction', e.target.value)}
                placeholder="Step-by-step behavioral instructions for the agent — what it should do, how it should reason, what outputs it produces"
                className={`${inputCls} resize-none`}
              />
              <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                Describes how the agent behaves and processes inputs.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className={labelCls}>Owner</label>
                <input
                  value={form.owner}
                  onChange={e => set('owner', e.target.value)}
                  placeholder="Team or person responsible"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Role</label>
                <input
                  value={form.role}
                  onChange={e => set('role', e.target.value)}
                  placeholder="Assistant, Reviewer, Analyst…"
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Environment</label>
              <select
                value={form.environment}
                onChange={e => set('environment', e.target.value)}
                className={inputCls}
              >
                <option value="">Select…</option>
                {ENVIRONMENTS.map(env => (
                  <option key={env} value={env}>{env}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}>Agent Type</label>
              <select
                value={form.agentType}
                onChange={e => set('agentType', e.target.value)}
                className={inputCls}
              >
                {AGENT_TYPES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {error && (
              <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-8 py-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
            <button
              type="button"
              onClick={() => navigate('/catalog')}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !form.name.trim() || !form.description.trim() || !form.instruction.trim() || success}
              className={`flex items-center gap-2 px-8 py-2.5 rounded-xl text-sm font-bold text-white transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${
                success ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {saving ? (
                <Loader2 size={16} className="animate-spin" />
              ) : success ? (
                <CheckCircle2 size={16} />
              ) : (
                <Bot size={16} />
              )}
              {saving ? 'Creating…' : success ? 'Created!' : 'Create Agent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateAgentPage;
