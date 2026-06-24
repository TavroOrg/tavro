import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CalendarDays, Loader2, RefreshCw, UserRound } from 'lucide-react';
import { agentApi } from '../services/agentApi';
import type { AgentIssue } from '../types/agent';

type IssueDetail = AgentIssue & {
  linked_agents?: Array<{ agent_id: string; agent_name: string }>;
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
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${date.getFullYear()}`;
};

const Field: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  <div className="flex flex-col gap-1">
    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">{label}</span>
    <span className="text-sm text-slate-700">{value || '—'}</span>
  </div>
);

const IssueViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIssue = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await agentApi.getIssue(id);
      setIssue(data as IssueDetail);
    } catch (err: any) {
      setError(err.message || 'Failed to load issue.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIssue();
  }, [id]);

  return (
    <div className="flex flex-col gap-6 w-full animate-fade-in pb-12">

      {/* ── Back bar ── */}
      <div className="flex items-center justify-between w-full max-w-[1200px] mx-auto">
        <button
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/catalog'))}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 transition-all bg-transparent border-none cursor-pointer"
        >
          <ArrowLeft size={16} /> Back
        </button>
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="flex flex-col justify-center items-center min-h-[50vh] gap-3 text-slate-400">
          <RefreshCw size={22} className="animate-spin" />
          <span className="text-sm">Loading issue…</span>
        </div>
      )}

      {/* ── Error ── */}
      {!loading && error && (
        <div className="flex flex-col justify-center items-center min-h-[50vh] gap-4">
          <div className="flex items-start gap-3 text-red-500 bg-red-50 border border-red-200 rounded-xl px-6 py-4 max-w-lg">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-bold text-sm">Could not load issue</p>
              <p className="text-xs mt-1 text-red-400">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Content ── */}
      {!loading && !error && issue && (
        <div className="w-full max-w-[1200px] mx-auto flex flex-col gap-6">

          {/* Header card */}
          <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
            <div className="h-4 bg-gradient-to-r from-blue-600 to-indigo-600 w-full" />
            <div className="flex items-start gap-4 p-6">
              <div className="p-3 bg-amber-50 text-amber-600 rounded-xl shrink-0">
                <AlertTriangle size={24} />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-bold text-slate-800 tracking-tight">{issue.title}</h1>
                <p className="text-xs font-mono text-slate-400 mt-1">{issue.identifier}</p>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {issue.severity && (
                    <span className={`text-xs font-bold px-3 py-1 rounded-full border uppercase ${SEVERITY_COLORS[issue.severity] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                      {issue.severity}
                    </span>
                  )}
                  {issue.status && (
                    <span className={`text-xs font-bold px-3 py-1 rounded-full border uppercase ${STATUS_COLORS[issue.status] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                      {issue.status}
                    </span>
                  )}
                  {issue.issue_type && (
                    <span className="text-xs font-bold px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 uppercase">
                      {issue.issue_type}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Details card */}
          <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-700">Issue Details</h2>
            </div>
            <div className="p-6 flex flex-col gap-6">
              {issue.description && (
                <div className="bg-slate-50 rounded-xl border border-slate-100 p-4">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">Description</p>
                  <p className="text-sm text-slate-700 leading-relaxed">{issue.description}</p>
                </div>
              )}
              {issue.resolution_notes && (
                <div className="bg-green-50 rounded-xl border border-green-100 p-4">
                  <p className="text-[11px] font-bold text-green-500 uppercase tracking-wide mb-2">Resolution Notes</p>
                  <p className="text-sm text-slate-700 leading-relaxed">{issue.resolution_notes}</p>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
                <Field label="Issue Type" value={issue.issue_type} />
                <Field label="Severity" value={issue.severity} />
                <Field label="Source" value={issue.source} />
                <Field label="Status" value={issue.status} />
                <Field label="Assignee" value={issue.assignee} />
                <Field label="Owner" value={issue.owner} />
                <Field label="Detected At" value={formatDate(issue.detected_at)} />
                <Field label="Resolved At" value={formatDate(issue.resolved_at)} />
                <Field label="Created" value={formatDate(issue.created_ts)} />
              </div>
            </div>
          </div>

          {/* Linked agents card */}
          <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-700">
                Linked Agents ({issue.linked_agents?.length ?? 0})
              </h2>
            </div>
            <div className="divide-y divide-slate-100">
              {(!issue.linked_agents || issue.linked_agents.length === 0) ? (
                <p className="px-6 py-5 text-sm text-slate-500">No agents linked to this issue.</p>
              ) : (
                issue.linked_agents.map(a => (
                  <div key={a.agent_id} className="px-6 py-3 flex items-center gap-3">
                    <div className="p-1.5 bg-slate-100 rounded-lg text-slate-500">
                      <UserRound size={14} />
                    </div>
                    <Link
                      to={`/agent/${encodeURIComponent(a.agent_id)}`}
                      className="text-sm font-semibold text-blue-600 hover:underline"
                    >
                      {a.agent_name || a.agent_id}
                    </Link>
                    <span className="text-xs font-mono text-slate-400">{a.agent_id}</span>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      )}

    </div>
  );
};

export default IssueViewPage;
