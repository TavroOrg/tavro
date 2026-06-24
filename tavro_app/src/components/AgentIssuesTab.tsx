import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, CalendarDays, Check, Loader2, Pencil, Plus, Save, Trash2, X, XCircle } from 'lucide-react';
import type { AgentData, AgentIssue } from '../types/agent';
import { agentApi, type AgentIssuePayload } from '../services/agentApi';

interface AgentIssuesTabProps {
  agent: AgentData;
  onIssuesChange?: (issues: AgentIssue[]) => void;
}

type IssueDetail = AgentIssue & {
  linked_agents?: Array<{ agent_id: string; agent_name: string }>;
};

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

type IssueFormState = typeof emptyForm;
type IssueInlineField = keyof IssueFormState;

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
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${date.getFullYear()}`;
};

const toDateInputValue = (value?: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toISOString().slice(0, 10);
};

const DetailField: React.FC<{ label: string; value?: string | null; onDoubleClick?: () => void }> = ({
  label,
  value,
  onDoubleClick,
}) => (
  <div className="flex flex-col gap-1.5">
    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{label}</span>
    <p
      onDoubleClick={onDoubleClick}
      className={`text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 min-h-[42px] ${
        onDoubleClick ? 'cursor-text hover:border-blue-200 hover:bg-blue-50/40 transition-colors' : ''
      }`}
    >
      {value || 'N/A'}
    </p>
  </div>
);

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

const issueToForm = (iss: AgentIssue): typeof emptyForm => ({
  title: iss.title ?? '',
  description: iss.description ?? '',
  issue_type: iss.issue_type ?? '',
  severity: iss.severity ?? '',
  source: iss.source ?? '',
  detected_at: toDateInputValue(iss.detected_at),
  resolved_at: toDateInputValue(iss.resolved_at),
  status: iss.status ?? 'Open',
  resolution_notes: iss.resolution_notes ?? '',
  assignee: iss.assignee ?? '',
  owner: iss.owner ?? '',
});

const RelatedIssuesList: React.FC<{
  issues: AgentIssue[];
  selectedIssueId?: string | null;
  onOpenIssue: (issueId: string) => void;
  emptyMessage?: string;
}> = ({ issues, selectedIssueId, onOpenIssue, emptyMessage = 'No related issues recorded for this agent.' }) => {
  if (issues.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {issues.map(issue => (
        <div
          key={issue.identifier}
          className={`flex flex-col p-4 rounded-xl border transition-colors ${selectedIssueId === issue.identifier
            ? 'bg-blue-50 border-blue-200'
            : 'bg-slate-50 border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex justify-between items-start gap-3 mb-2">
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => onOpenIssue(issue.identifier)}
                className="text-left font-bold text-sm text-blue-700 hover:underline"
              >
                {issue.title}
              </button>
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
  );
};

const AgentIssuesTab: React.FC<AgentIssuesTabProps> = ({ agent, onIssuesChange }) => {
  const agentId = agent.identification?.agent_id ?? '';
  const [issues, setIssues] = useState<AgentIssue[]>(agent.issues ?? []);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<IssueDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailActionError, setDetailActionError] = useState<string | null>(null);
  const [editingIssue, setEditingIssue] = useState(false);
  const [issueForm, setIssueForm] = useState(emptyForm);
  const [inlineIssueEdit, setInlineIssueEdit] = useState<{ field: IssueInlineField; value: string } | null>(null);
  const [deletingIssue, setDeletingIssue] = useState(false);

  useEffect(() => {
    setIssues(agent.issues ?? []);
  }, [agent.issues]);

  useEffect(() => {
    setSelectedIssueId(null);
    setSelectedIssue(null);
    setDetailError(null);
    setDetailActionError(null);
    setEditingIssue(false);
    setIssueForm(emptyForm);
    setInlineIssueEdit(null);
  }, [agentId]);

  useEffect(() => {
    if (!selectedIssueId) return;

    let cancelled = false;
    const fetchIssue = async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const data = await agentApi.getIssue(selectedIssueId);
        if (!cancelled) {
          setSelectedIssue(data as IssueDetail);
          setIssueForm(issueToForm(data as IssueDetail));
          setEditingIssue(false);
          setInlineIssueEdit(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setSelectedIssue(null);
          setDetailError(err.message || 'Failed to load issue.');
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };

    fetchIssue();
    return () => {
      cancelled = true;
    };
  }, [selectedIssueId]);

  const updateField = (key: keyof typeof emptyForm, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const closeForm = () => {
    setFormOpen(false);
    setForm(emptyForm);
    setFormError(null);
  };

  const openIssue = (issueId: string) => {
    closeForm();
    setSelectedIssueId(issueId);
    setDetailActionError(null);
    setEditingIssue(false);
    setInlineIssueEdit(null);
  };

  const closeIssue = () => {
    setSelectedIssueId(null);
    setSelectedIssue(null);
    setDetailError(null);
    setDetailActionError(null);
    setEditingIssue(false);
    setIssueForm(emptyForm);
    setInlineIssueEdit(null);
  };

  const updateIssueField = (key: keyof typeof emptyForm, value: string) => {
    setIssueForm(prev => ({ ...prev, [key]: value }));
  };

  const startIssueEdit = () => {
    if (!selectedIssue) return;
    setIssueForm(issueToForm(selectedIssue));
    setDetailActionError(null);
    setEditingIssue(true);
    setInlineIssueEdit(null);
  };

  const cancelIssueEdit = () => {
    if (selectedIssue) setIssueForm(issueToForm(selectedIssue));
    setDetailActionError(null);
    setEditingIssue(false);
  };

  const saveIssueValues = async (values: IssueFormState): Promise<boolean> => {
    if (!agentId || !selectedIssueId || !selectedIssue || !values.title.trim()) return false;

    const detectedAt = values.detected_at ? toDateTime(values.detected_at) : undefined;
    const resolvedAt = values.resolved_at ? toDateTime(values.resolved_at) : undefined;
    const updatedIssue: AgentIssue = {
      ...selectedIssue,
      identifier: selectedIssue.identifier,
      title: values.title.trim(),
      description: values.description.trim() || null,
      issue_type: values.issue_type || null,
      severity: values.severity || null,
      source: values.source || null,
      detected_at: detectedAt ?? null,
      resolved_at: resolvedAt ?? null,
      status: values.status || null,
      resolution_notes: values.resolution_notes.trim() || null,
      assignee: values.assignee.trim() || null,
      owner: values.owner.trim() || null,
    };
    const nextIssues = issues.map(issue => (
      issue.identifier === selectedIssueId ? updatedIssue : issue
    ));

    setSaving(true);
    setDetailActionError(null);
    try {
      await agentApi.updateAgent(agentId, { issues: nextIssues.map(issueToPayload) });
      setIssues(nextIssues);
      setSelectedIssue(updatedIssue as IssueDetail);
      setIssueForm(issueToForm(updatedIssue));
      onIssuesChange?.(nextIssues);
      return true;
    } catch (err: any) {
      setDetailActionError(err.message || 'Failed to update issue.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateIssue = async () => {
    const saved = await saveIssueValues(issueForm);
    if (saved) setEditingIssue(false);
  };

  const startIssueInlineEdit = (field: IssueInlineField) => {
    if (!selectedIssue || editingIssue || saving || deletingIssue) return;
    const values = issueToForm(selectedIssue);
    setDetailActionError(null);
    setInlineIssueEdit({ field, value: values[field] });
  };

  const cancelIssueInlineEdit = () => {
    setInlineIssueEdit(null);
    setDetailActionError(null);
  };

  const saveIssueInlineEdit = async () => {
    if (!selectedIssue || !inlineIssueEdit) return;
    const values: IssueFormState = {
      ...issueToForm(selectedIssue),
      [inlineIssueEdit.field]: inlineIssueEdit.value,
    };
    const saved = await saveIssueValues(values);
    if (saved) setInlineIssueEdit(null);
  };

  const handleDeleteIssue = async () => {
    if (!agentId || !selectedIssueId || !selectedIssue) return;
    const ok = window.confirm(`Delete issue "${selectedIssue.title || selectedIssue.identifier}"?`);
    if (!ok) return;

    const nextIssues = issues.filter(issue => issue.identifier !== selectedIssueId);
    setDeletingIssue(true);
    setDetailActionError(null);
    try {
      await agentApi.updateAgent(agentId, { issues: nextIssues.map(issueToPayload) });
      setIssues(nextIssues);
      onIssuesChange?.(nextIssues);
      closeIssue();
    } catch (err: any) {
      setDetailActionError(err.message || 'Failed to delete issue.');
    } finally {
      setDeletingIssue(false);
    }
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

  const renderIssueInlineField = (
    field: IssueInlineField,
    label: string,
    displayValue?: string | null,
    config: { kind?: 'text' | 'textarea' | 'select' | 'date'; options?: string[] } = {},
  ) => {
    const activeEdit = inlineIssueEdit?.field === field ? inlineIssueEdit : null;
    const kind = config.kind ?? 'text';
    const saveDisabled = saving || (field === 'title' && !activeEdit?.value.trim());

    if (activeEdit) {
      return (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            {label}{field === 'title' && <span className="text-red-500"> *</span>}
          </span>
          <div className="flex items-start gap-2">
            {kind === 'textarea' ? (
              <textarea
                value={activeEdit.value}
                onChange={e => setInlineIssueEdit({ field, value: e.target.value })}
                rows={3}
                autoFocus
                className="min-w-0 flex-1 text-sm text-slate-700 bg-white border border-blue-300 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            ) : kind === 'select' ? (
              <select
                value={activeEdit.value}
                onChange={e => setInlineIssueEdit({ field, value: e.target.value })}
                autoFocus
                className="min-w-0 flex-1 text-sm text-slate-700 bg-white border border-blue-300 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select...</option>
                {(config.options ?? []).map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            ) : (
              <input
                type={kind === 'date' ? 'date' : 'text'}
                value={activeEdit.value}
                onChange={e => setInlineIssueEdit({ field, value: e.target.value })}
                autoFocus
                className="min-w-0 flex-1 text-sm text-slate-700 bg-white border border-blue-300 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={saveIssueInlineEdit}
                disabled={saveDisabled}
                title={field === 'title' && !activeEdit.value.trim() ? 'Title is required' : 'Save'}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-xs font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : '✓'}
              </button>
              <button
                type="button"
                onClick={cancelIssueInlineEdit}
                disabled={saving}
                title="Cancel"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <DetailField
        label={label}
        value={displayValue}
        onDoubleClick={() => startIssueInlineEdit(field)}
      />
    );
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
            onClick={() => {
              closeIssue();
              setFormOpen(true);
            }}
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
                <input type="date" lang="en-US" value={form.detected_at} onChange={e => updateField('detected_at', e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Resolved At</span>
                <input type="date" lang="en-US" value={form.resolved_at} onChange={e => updateField('resolved_at', e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
      {selectedIssueId && !formOpen && (
        <div className="border-b border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
            <button
              type="button"
              onClick={closeIssue}
              className="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors"
            >
              <ArrowLeft size={15} /> Back to issues
            </button>

            {!detailLoading && !detailError && selectedIssue && (
              <div className="flex items-center justify-end gap-2 flex-wrap">
                {editingIssue ? (
                  <>
                    <button
                      type="button"
                      onClick={cancelIssueEdit}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <XCircle size={15} /> Discard
                    </button>
                    <button
                      type="button"
                      onClick={handleUpdateIssue}
                      disabled={saving || !issueForm.title.trim()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                      Save
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={startIssueEdit}
                      disabled={deletingIssue}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Pencil size={15} /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteIssue}
                      disabled={deletingIssue}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deletingIssue ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                      Delete
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {detailLoading && (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 py-10 text-sm font-medium text-slate-500">
              <Loader2 size={16} className="animate-spin" /> Loading issue…
            </div>
          )}

          {!detailLoading && detailError && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-bold">Could not load issue</p>
                <p className="text-xs mt-1 text-red-500">{detailError}</p>
              </div>
            </div>
          )}

          {!detailLoading && !detailError && selectedIssue && (
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-2 border-b border-slate-200">
                <button type="button" className="px-4 py-2.5 text-sm font-bold border-b-2 border-blue-600 text-blue-700 transition-colors">
                  Details
                </button>
              </div>

              {detailActionError && (
                <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-bold">Could not save issue changes</p>
                    <p className="text-xs mt-1 text-red-500">{detailActionError}</p>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-bold text-slate-800 mb-4">Details</h3>
                {editingIssue ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="md:col-span-2 flex flex-col gap-1.5">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                        Title <span className="text-red-500">*</span>
                      </span>
                      <input value={issueForm.title} onChange={e => updateIssueField('title', e.target.value)} className="text-sm text-slate-700 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Issue Type</span>
                      <select value={issueForm.issue_type} onChange={e => updateIssueField('issue_type', e.target.value)} className="text-sm text-slate-700 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">Select type...</option>
                        {ISSUE_TYPES.map(t => <option key={t}>{t}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Severity</span>
                      <select value={issueForm.severity} onChange={e => updateIssueField('severity', e.target.value)} className="text-sm text-slate-700 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">Select severity...</option>
                        {SEVERITY_OPTIONS.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Status</span>
                      <select value={issueForm.status} onChange={e => updateIssueField('status', e.target.value)} className="text-sm text-slate-700 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
                        {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Source</span>
                      <select value={issueForm.source} onChange={e => updateIssueField('source', e.target.value)} className="text-sm text-slate-700 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">Select source...</option>
                        {SOURCE_OPTIONS.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Assignee</span>
                      <input value={issueForm.assignee} onChange={e => updateIssueField('assignee', e.target.value)} className="text-sm text-slate-700 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Owner</span>
                      <input value={issueForm.owner} onChange={e => updateIssueField('owner', e.target.value)} className="text-sm text-slate-700 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Detected At</span>
                      <input type="date" lang="en-US" value={issueForm.detected_at} onChange={e => updateIssueField('detected_at', e.target.value)} className="text-sm text-slate-700 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Resolved At</span>
                      <input type="date" lang="en-US" value={issueForm.resolved_at} onChange={e => updateIssueField('resolved_at', e.target.value)} className="text-sm text-slate-700 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </label>
                    <label className="md:col-span-2 flex flex-col gap-1.5">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Description</span>
                      <textarea value={issueForm.description} onChange={e => updateIssueField('description', e.target.value)} rows={3} className="text-sm text-slate-700 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                    </label>
                    <label className="md:col-span-2 flex flex-col gap-1.5">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Resolution Notes</span>
                      <textarea value={issueForm.resolution_notes} onChange={e => updateIssueField('resolution_notes', e.target.value)} rows={3} className="text-sm text-slate-700 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                    </label>
                    <DetailField label="Created" value={formatDate(selectedIssue.created_ts)} />
                    <DetailField label="Last Updated" value={formatDate(selectedIssue.updated_ts)} />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {renderIssueInlineField('title', 'Title', selectedIssue.title)}
                    {renderIssueInlineField('issue_type', 'Issue Type', selectedIssue.issue_type, { kind: 'select', options: ISSUE_TYPES })}
                    {renderIssueInlineField('severity', 'Severity', selectedIssue.severity, { kind: 'select', options: SEVERITY_OPTIONS })}
                    {renderIssueInlineField('status', 'Status', selectedIssue.status, { kind: 'select', options: STATUS_OPTIONS })}
                    {renderIssueInlineField('source', 'Source', selectedIssue.source, { kind: 'select', options: SOURCE_OPTIONS })}
                    {renderIssueInlineField('assignee', 'Assignee', selectedIssue.assignee)}
                    {renderIssueInlineField('owner', 'Owner', selectedIssue.owner)}
                    {renderIssueInlineField('detected_at', 'Detected At', formatDate(selectedIssue.detected_at), { kind: 'date' })}
                    {renderIssueInlineField('resolved_at', 'Resolved At', formatDate(selectedIssue.resolved_at), { kind: 'date' })}
                    <div className="md:col-span-2">
                      {renderIssueInlineField('description', 'Description', selectedIssue.description, { kind: 'textarea' })}
                    </div>
                    <div className="md:col-span-2">
                      {renderIssueInlineField('resolution_notes', 'Resolution Notes', selectedIssue.resolution_notes, { kind: 'textarea' })}
                    </div>
                    <DetailField label="Created" value={formatDate(selectedIssue.created_ts)} />
                    <DetailField label="Last Updated" value={formatDate(selectedIssue.updated_ts)} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {!selectedIssueId && (
        <div className="p-5">
          {issues.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
              No issues recorded. Click <span className="font-semibold text-blue-600">+ New Issue</span> to add one.
            </div>
          ) : (
            <RelatedIssuesList
              issues={issues}
              selectedIssueId={selectedIssueId}
              onOpenIssue={openIssue}
              emptyMessage="No related issues recorded for this agent."
            />
          )}
        </div>
      )}
    </div>
  );
};

export default AgentIssuesTab;
