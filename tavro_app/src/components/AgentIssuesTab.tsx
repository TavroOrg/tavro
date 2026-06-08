import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarDays, Loader2, Plus, UserRound, X } from 'lucide-react';
import type { AgentData, AgentIssue } from '../types/agent';
import { agentApi, type AgentIssuePayload } from '../services/agentApi';

interface AgentIssuesTabProps {
  agent: AgentData;
  onIssuesChange?: (issues: AgentIssue[]) => void;
}

const emptyForm = {
  issue_name: '',
  reported_by: '',
  reported_date: '',
  assigned_to: '',
  practice_area: '',
  due_date: '',
  reported_department: '',
  description: '',
  mitigation_state: 'New',
  line_of_defense: '',
};

const MITIGATION_COLORS: Record<string, string> = {
  'New': 'bg-amber-50 text-amber-700 border-amber-200',
  'In Progress': 'bg-blue-50 text-blue-700 border-blue-200',
  'Resolved': 'bg-green-50 text-green-700 border-green-200',
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
  issue_id: iss.issue_id,
  issue_name: iss.issue_name,
  ...(iss.reported_by ? { reported_by: iss.reported_by } : {}),
  ...(iss.reported_date ? { reported_date: iss.reported_date } : {}),
  ...(iss.assigned_to ? { assigned_to: iss.assigned_to } : {}),
  ...(iss.practice_area ? { practice_area: iss.practice_area } : {}),
  ...(iss.due_date ? { due_date: iss.due_date } : {}),
  ...(iss.reported_department ? { reported_department: iss.reported_department } : {}),
  ...(iss.description ? { description: iss.description } : {}),
  ...(iss.mitigation_state ? { mitigation_state: iss.mitigation_state } : {}),
  ...(iss.line_of_defense ? { line_of_defense: iss.line_of_defense } : {}),
});

const AgentIssuesTab: React.FC<AgentIssuesTabProps> = ({ agent, onIssuesChange }) => {
  const agentId = agent.identification?.agent_id ?? '';
  const [issues, setIssues] = useState<AgentIssue[]>(agent.issues ?? []);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  // Keep in sync if parent agent prop updates (e.g. after navigation back)
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
    if (!agentId || !form.issue_name.trim()) return;

    // Generate the UUID here so we can use it for the optimistic update and
    // pass it to the backend — the backend preserves a provided issue_id.
    const newIssueId = crypto.randomUUID();

    const reportedDate = form.reported_date ? toDateTime(form.reported_date) : undefined;
    const dueDate = form.due_date ? toDateTime(form.due_date) : undefined;

    const newIssue: AgentIssuePayload = {
      issue_id: newIssueId,
      issue_name: form.issue_name.trim(),
      ...(form.reported_by.trim() ? { reported_by: form.reported_by.trim() } : {}),
      ...(reportedDate ? { reported_date: reportedDate } : {}),
      ...(form.assigned_to.trim() ? { assigned_to: form.assigned_to.trim() } : {}),
      ...(form.practice_area.trim() ? { practice_area: form.practice_area.trim() } : {}),
      ...(dueDate ? { due_date: dueDate } : {}),
      ...(form.reported_department.trim() ? { reported_department: form.reported_department.trim() } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      ...(form.mitigation_state ? { mitigation_state: form.mitigation_state } : {}),
      ...(form.line_of_defense.trim() ? { line_of_defense: form.line_of_defense.trim() } : {}),
    };

    // Build full issues list: existing (with issue_id preserved) + new entry
    const updatedPayload = [...issues.map(issueToPayload), newIssue];

    setSaving(true);
    setFormError(null);
    try {
      await agentApi.updateAgent(agentId, { issues: updatedPayload });
      // Optimistic update — backend uses the issue_id we provided, so the
      // link to /issues/{id} is stable immediately without a second API call.
      const optimistic: AgentIssue = {
        issue_id: newIssueId,
        issue_name: form.issue_name.trim(),
        reported_by: form.reported_by.trim() || null,
        reported_date: reportedDate ?? null,
        assigned_to: form.assigned_to.trim() || null,
        practice_area: form.practice_area.trim() || null,
        due_date: dueDate ?? null,
        reported_department: form.reported_department.trim() || null,
        description: form.description.trim() || null,
        mitigation_state: form.mitigation_state || null,
        line_of_defense: form.line_of_defense.trim() || null,
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
        <div className="border-b border-slate-200 bg-slate-50">
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
                  Issue Name <span className="text-red-500">*</span>
                </span>
                <input
                  value={form.issue_name}
                  onChange={e => updateField('issue_name', e.target.value)}
                  required
                  placeholder="Enter issue name"
                  className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Reported By</span>
                <input value={form.reported_by} onChange={e => updateField('reported_by', e.target.value)} placeholder="Name" className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400" />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Reported Date</span>
                <input type="date" value={form.reported_date} onChange={e => updateField('reported_date', e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Assigned To</span>
                <input value={form.assigned_to} onChange={e => updateField('assigned_to', e.target.value)} placeholder="Name" className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400" />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Reported Department</span>
                <input value={form.reported_department} onChange={e => updateField('reported_department', e.target.value)} placeholder="Department" className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400" />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Mitigation State</span>
                <select value={form.mitigation_state} onChange={e => updateField('mitigation_state', e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option>New</option>
                  <option>In Progress</option>
                  <option>Resolved</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Practice Area</span>
                <input value={form.practice_area} onChange={e => updateField('practice_area', e.target.value)} placeholder="e.g. Risk, Compliance" className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400" />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Due Date</span>
                <input type="date" value={form.due_date} onChange={e => updateField('due_date', e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>

              <label className="sm:col-span-2 flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Line Of Defense</span>
                <input value={form.line_of_defense} onChange={e => updateField('line_of_defense', e.target.value)} placeholder="e.g. First, Second, Third" className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400" />
              </label>

              <label className="sm:col-span-2 flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Description</span>
                <textarea value={form.description} onChange={e => updateField('description', e.target.value)} rows={3} placeholder="Describe the issue..." className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400 resize-none" />
              </label>
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              <button type="button" onClick={closeForm} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button type="submit" disabled={saving || !form.issue_name.trim()} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm">
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
                key={issue.issue_id}
                className="flex flex-col p-4 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors"
              >
                <div className="flex justify-between items-start gap-3 mb-2">
                  <div className="min-w-0">
                    <Link
                      to={`/issues/${encodeURIComponent(issue.issue_id)}`}
                      className="font-bold text-sm text-blue-700 hover:underline"
                    >
                      {issue.issue_name}
                    </Link>
                    <span className="block text-[11px] font-mono text-slate-400 mt-0.5">{issue.issue_id}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {issue.mitigation_state && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${MITIGATION_COLORS[issue.mitigation_state] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                        {issue.mitigation_state}
                      </span>
                    )}
                    {issue.practice_area && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-50 border border-blue-100 text-blue-700 uppercase">
                        {issue.practice_area}
                      </span>
                    )}
                  </div>
                </div>

                {issue.description && (
                  <p className="text-xs text-slate-600 mb-2 line-clamp-2">{issue.description}</p>
                )}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <UserRound size={11} className="text-slate-400" />
                    {issue.reported_by || 'Unknown'}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CalendarDays size={11} className="text-slate-400" />
                    {formatDate(issue.reported_date)}
                  </span>
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
