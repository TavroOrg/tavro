import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Loader2, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';
import { mcpClient } from '../services/mcpClient';

const CreateAgentPage: React.FC = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    description: '',
    owner: '',
    role: '',
    environment: '',
    version: '1.0',
    status: 'Active',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const set = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await mcpClient.createAgent(form);
      setSuccess(true);
      setTimeout(() => navigate('/catalog'), 1000);
    } catch (err: any) {
      setError(err.message || 'Failed to create agent.');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-blue-400/30 dark:focus:ring-blue-700/40 focus:border-blue-400 dark:focus:border-blue-500 transition-all bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500';
  const labelCls = 'block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5';

  return (
    <div className="flex flex-col gap-6 w-full animate-fade-in max-w-3xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate('/catalog')} className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 transition-all bg-transparent border-none cursor-pointer">
          <ArrowLeft size={16} /> Back to Agents
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm overflow-hidden border border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3 px-8 py-6 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-blue-50 to-white dark:from-slate-900 dark:to-slate-800">
          <div className="p-2.5 bg-blue-100 text-blue-600 rounded-xl"><Bot size={24} /></div>
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">Create Agent</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Register a new agent in the catalog</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="p-8 flex flex-col gap-6">
            <div>
              <label className={labelCls}>Agent Name <span className="text-red-500">*</span></label>
              <input required value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Fraud Case Triage Agent" className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Description</label>
              <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)} placeholder="What this agent does" className={`${inputCls} resize-none`} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className={labelCls}>Owner</label>
                <input value={form.owner} onChange={e => set('owner', e.target.value)} placeholder="Team or person" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Role</label>
                <input value={form.role} onChange={e => set('role', e.target.value)} placeholder="Assistant, Reviewer, Analyst..." className={inputCls} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className={labelCls}>Environment</label>
                <input value={form.environment} onChange={e => set('environment', e.target.value)} placeholder="Prod, UAT, Dev" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Version</label>
                <input value={form.version} onChange={e => set('version', e.target.value)} placeholder="1.0" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Status</label>
                <input value={form.status} onChange={e => set('status', e.target.value)} placeholder="Active" className={inputCls} />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-8 py-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
            <button type="button" onClick={() => navigate('/catalog')} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all">Cancel</button>
            <button type="submit" disabled={saving || !form.name.trim() || success} className={`flex items-center gap-2 px-8 py-2.5 rounded-xl text-sm font-bold text-white transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${success ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-blue-600 hover:bg-blue-700'}`}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : success ? <CheckCircle2 size={16} /> : <Bot size={16} />}
              {saving ? 'Creating...' : success ? 'Created!' : 'Create Agent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateAgentPage;
