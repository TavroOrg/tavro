import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarDays, Loader2, Plus, X } from 'lucide-react';
import type { AgentData, AgentIssue } from '../types/agent';
import { agentApi, type AgentIssuePayload } from '../services/agentApi';

interface AgentIssuesTabProps {
  agent: AgentData;
  onIssuesChange?: (issues: AgentIssue[]) => void;
}

const ISSUE_TYPES = [
  'Hallucination',
  'Tool Failure',
  'Latency Breach',
  'Drift Violation',
  'Guardrail Trigger',
  'Data Quality',
  'Authorization Failure',
  'Output Policy Violation',
  'Risk Management',
  'Fraud Detection',
  'Customer Engagement',
];

const SEVERITY_OPTIONS = ['Critical', 'High', 'Medium', 'Low', 'Informational'];

const SOURCE_OPTIONS = [
  'Evaluation Framework',
  'Alert Monitor',
  'Drift Detector',
  'Manual Review',
];

const STATUS_OPTIONS = ['Open', 'In Progress', 'Resolved', 'Dismissed', 'Escalated'];

const emptyForm = {
  title: '',
  description: '',
  issue_type: '',
  severity: '',
  source: '',
  detected_at: '',
  resolved_at: '',
  status: 'Open',
  resolution_notes: '',
  assignee: '',
  owner: '',
};

const SEVERITY_COLORS: Record<string, string> = {
  Critical: 'bg-red-50 text-red-700 border-red-200',
  High: 'bg-orange-50 text-orange-700 border-orange-200',
  Medium: 'bg-amber-50 text-amber-700 border-amber-200',
  Low: 'bg-blue-50 text-blue-700 border-blue-200',
  Informational: 'bg-slate-50 text-slate-600 border-slate-200',
};

const STATUS_COLORS: Record<string, string> = {
  Open: 'bg-amber-50 text-amber-700 border-amber-200',
  'In Progress': 'bg-blue-50 text-blue-700 border-blue-200',
  Resolved: 'bg-green-50 text-green-700 border-green-200',
  Dismissed: 'bg-slate-50 text-slate-600 border-slate-200',
  Escalated: 'bg-red-50 text-red-700 border-red-200',
};

const formatDate = (value?: string | null): string => {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const toDateTime = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed ? `${trimmed}T00:00:00` : undefined;
};

const issueToPayload = (iss: AgentIssue): AgentIssuePayload => ({
  identifier: iss.identifier,
  title: iss.title,
  ...(iss.description ? { description: iss.description } : {}),
  ...(iss.issue_type ? { issue_type: iss.issue_type } : {}),
  ...(iss.severity ? { severity: iss.severity } : {}),
  ...(iss.source ? { source: iss.source } : {}),
  ...(iss.detected_at ? { detected_at: iss.detected_at } : {}),
  ...(iss.resolved_at ? { resolved_at: iss.resolved_at } : {}),
  ...(iss.status ? { status: iss.status } : {}),
  ...(iss.resolution_notes ? { resolution_notes: iss.resolution_notes } : {}),
  ...(iss.assignee ? { assignee: iss.assignee } : {}),
  ...(iss.owner ? { owner: iss.owner } : {}),
});

const AgentIssuesTab: React.FC<AgentIssuesTabProps> = ({ agent, onIssuesChange }) => {
  const agentId = agent.identification?.agent_id ?? '';
  const [issues, setIssues] = useState<AgentIssue[]>(agent.issues ?? []);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setIssues(agent.issues ?? []);
  }, [agent.issues]);

  const updateField = (key: keyof typeof emptyForm, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const closeForm = () => {
    setFormOpen(false);
    setForm(emptyForm);
    setFormError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!agentId || !form.title.trim()) return;

    const newIssueId = crypto.randomUUID();
    const detectedAt = form.detected_at ? toDateTime(form.detected_at) : undefined;
    const resolvedAt = form.resolved_at ? toDateTime(form.resolved_at) : undefined;

    const newIssue: AgentIssuePayload = {
      identifier: newIssueId,
      title: form.title.trim(),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      ...(form.issue_type ? { issue_type: form.issue_type } : {}),
      ...(form.severity ? { severity: form.severity } : {}),
      ...(form.source ? { source: form.source } : {}),
      ...(detectedAt ? { detected_at: detectedAt } : {}),
      ...(resolvedAt ? { resolved_at: resolvedAt } : {}),
      ...(form.status ? { status: form.status } : {}),
      ...(form.resolution_notes.trim() ? { resolution_notes: form.resolution_notes.trim() } : {}),
      ...(form.assignee.trim() ? { assignee: form.assignee.trim() } : {}),
      ...(form.owner.trim() ? { owner: form.owner.trim() } : {}),
    };

    const updatedPayload = [...issues.map(issueToPayload), newIssue];

    setSaving(true);
    setFormError(null);
    try {
      await agentApi.updateAgent(agentId, { issues: updatedPayload });
      const optimistic: AgentIssue = {
        identifier: newIssueId,
        title: form.title.trim(),
        description: form.description.trim() || null,
        issue_type: form.issue_type || null,
        severity: form.severity || null,
        source: form.source || null,
        detected_at: detectedAt ?? null,
        resolved_at: resolvedAt ?? null,
        status: form.status || null,
        resolution_notes: form.resolution_notes.trim() || null,
        assignee: form.assignee.trim() || null,
        owner: form.owner.trim() || null,
      };
      const nextIssues = [...issues, optimistic];
      setIssues(nextIssues);
      onIssuesChange?.(nextIssues);
      closeForm();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create issue.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
            <AlertTriangle size={20} />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-800 tracking-tight">Issues</h2>
            <p className="text-xs text-slate-500 font-medium">
              {issues.length} issue{issues.length === 1 ? '' : 's'} linked to this agent
            </p>
          </div>
        </div>

        {formOpen ? (
          <button
            type="button"
            onClick={closeForm}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 transition-all"
          >
            <X size={14} /> Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-sm"
          >
            <Plus size={15} /> New Issue
          </button>
        )}
      </div>

      {/* ── Inline Create Form ──────────────────────────────────── */}
      {formOpen && (
        <div className="border-b border-slate-200 bg-white">
          <form onSubmit={handleSubmit} className="p-5">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4">New Issue</p>

            {formError && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="sm:col-span-2 flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                  Title <span className="text-red-500">*</span>
                </span>
                <input
                  value={form.title}
                  onChange={e => updateField('title', e.target.value)}
                  required
                  placeholder='e.g. "Hallucination detected in summarization output"'
                  className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Issue Type</span>
                <select value={form.issue_type} onChange={e => updateField('issue_type', e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select type…</option>
                  {ISSUE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Severity</span>
                <select value={form.severity} onChange={e => updateField('severity', e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select severity…</option>
                  {SEVERITY_OPTIONS.map(s => <option key={s}>{s}</option>)}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Source</span>
                <select value={form.source} onChange={e => updateField('source', e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select source…</option>
                  {SOURCE_OPTIONS.map(s => <option key={s}>{s}</option>)}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Status</span>
                <select value={form.status} onChange={e => updateField('status', e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Detected At</span>
                <input type="date" value={form.detected_at} onChange={e => updateField('detected_at', e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Resolved At</span>
                <input type="date" value={form.resolved_at} onChange={e => updateField('resolved_at', e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Assignee</span>
                <input value={form.assignee} onChange={e => updateField('assignee', e.target.value)} placeholder="Team member or team" className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400" />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Owner</span>
                <input value={form.owner} onChange={e => updateField('owner', e.target.value)} placeholder="Team or individual accountable" className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400" />
              </label>

              <label className="sm:col-span-2 flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Description</span>
                <textarea value={form.description} onChange={e => updateField('description', e.target.value)} rows={3} placeholder="Describe the issue and why it was flagged…" className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400 resize-none" />
              </label>

              <label className="sm:col-span-2 flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Resolution Notes</span>
                <textarea value={form.resolution_notes} onChange={e => updateField('resolution_notes', e.target.value)} rows={2} placeholder="Action taken to resolve or reason for dismissal…" className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400 resize-none" />
              </label>
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              <button type="button" onClick={closeForm} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button type="submit" disabled={saving || !form.title.trim()} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Create Issue
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Issues List ─────────────────────────────────────────── */}
      <div className="p-5">
        {issues.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
            No issues recorded. Click <span className="font-semibold text-blue-600">+ New Issue</span> to add one.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {issues.map(issue => (
              <div
                key={issue.identifier}
                className="flex flex-col p-4 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors"
              >
                <div className="flex justify-between items-start gap-3 mb-2">
                  <div className="min-w-0">
                    <Link
                      to={`/issues/${encodeURIComponent(issue.identifier)}`}
                      className="font-bold text-sm text-blue-700 hover:underline"
                    >
                      {issue.title}
                    </Link>
                    <span className="block text-[11px] font-mono text-slate-400 mt-0.5">{issue.identifier}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    {issue.severity && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${SEVERITY_COLORS[issue.severity] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                        {issue.severity}
                      </span>
                    )}
                    {issue.status && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${STATUS_COLORS[issue.status] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                        {issue.status}
                      </span>
                    )}
                    {issue.issue_type && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 border border-indigo-100 text-indigo-700 uppercase">
                        {issue.issue_type}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  {issue.detected_at && (
                    <span className="flex items-center gap-1.5">
                      <CalendarDays size={11} className="text-slate-400" />
                      Detected {formatDate(issue.detected_at)}
                    </span>
                  )}
                  {issue.assignee && (
                    <span className="text-slate-500">Assignee: {issue.assignee}</span>
                  )}
                  {issue.source && (
                    <span className="text-slate-500">Source: {issue.source}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentIssuesTab;
