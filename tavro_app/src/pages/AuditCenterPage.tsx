// ── src/pages/AuditCenterPage.tsx ────────────────────────────────────────────
// Main audit center: lists past runs, streams live progress, drill-down to findings.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ShieldCheck, RefreshCw, ChevronRight, AlertTriangle, CheckCircle2,
  Clock, XCircle, Loader2, TrendingUp, BarChart3, FileText, Scale, LayoutGrid, List,
} from 'lucide-react';
import { auditApi } from '../services/auditApi';
import { useBlueprint } from '../context/BlueprintContext';
import AuditInitModal from '../components/audit/AuditInitModal';
import type { AuditRun, AuditFinding, AuditSSEEvent, RiskLevel, AuditStatus } from '../types/audit';
import { RISK_META, SCOPE_LABELS } from '../types/audit';

// ── Sub-components ────────────────────────────────────────────────────────────

const RiskBadge: React.FC<{ level: RiskLevel | null | undefined; size?: 'sm' | 'xs' }> = ({ level, size = 'sm' }) => {
  if (!level) return null;
  const m = RISK_META[level];
  return (
    <span className={`font-bold rounded-full border ${size === 'xs' ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5'}`}
      style={{ background: m.bg, color: m.color, borderColor: m.badge }}>
      {m.label}
    </span>
  );
};

const StatusIcon: React.FC<{ status: AuditStatus | string }> = ({ status }) => {
  if (status === 'completed') return <CheckCircle2 size={14} className="text-emerald-500" />;
  if (status === 'running')   return <Loader2 size={14} className="animate-spin text-blue-500" />;
  if (status === 'failed')    return <XCircle size={14} className="text-rose-500" />;
  if (status === 'cancelled') return <XCircle size={14} className="text-slate-400" />;
  return <Clock size={14} className="text-slate-400" />;
};

const ProgressBar: React.FC<{ pct: number; risk?: RiskLevel | null }> = ({ pct, risk }) => {
  const color = risk === 'critical' ? '#dc2626' : risk === 'high' ? '#e11d48' : risk === 'medium' ? '#d97706' : '#16a34a';
  return (
    <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5">
      <div className="h-1.5 rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, background: color }} />
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

const AuditCenterPage: React.FC = () => {
  const navigate      = useNavigate();
  const [searchParams] = useSearchParams();
  const { activeCompany } = useBlueprint();

  const [runs,        setRuns]        = useState<AuditRun[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [modalOpen,   setModalOpen]   = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [viewMode,    setViewMode]    = useState<'grid' | 'list'>('list');

  // Live run state — keyed by run_id
  const [liveProgress, setLiveProgress] = useState<Record<string, {
    pct: number; completed: number; total: number; failed: number;
    overall_risk: RiskLevel | null; status: string;
    findings: AuditFinding[];
  }>>({});

  const streamCleanups = useRef<Record<string, () => void>>({});

  // ── Load runs ──────────────────────────────────────────────────────────────
  const loadRuns = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    try {
      const data = await auditApi.listRuns(activeCompany.id, 30);
      setRuns(data);
      // Auto-stream any running runs
      data.filter(r => r.status === 'running' || r.status === 'pending')
        .forEach(r => startStreaming(r.id));
    } catch (e) {
      console.error('Failed to load audit runs', e);
    } finally {
      setLoading(false);
    }
  }, [activeCompany?.id]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  // Auto-open modal if URL has ?launch=true
  useEffect(() => {
    if (searchParams.get('launch') === 'true') setModalOpen(true);
  }, []);

  // ── SSE streaming ──────────────────────────────────────────────────────────
  const startStreaming = useCallback((runId: string) => {
    if (streamCleanups.current[runId]) return; // already streaming

    const cleanup = auditApi.streamProgress(runId, (event: AuditSSEEvent) => {
      if (event.type === 'progress') {
        setLiveProgress(prev => ({
          ...prev,
          [runId]: {
            ...prev[runId],
            pct:          event.pct,
            completed:    event.completed,
            total:        event.total,
            failed:       event.failed,
            overall_risk: event.overall_risk,
            status:       event.status,
            findings:     prev[runId]?.findings ?? [],
          },
        }));
      } else if (event.type === 'finding') {
        setLiveProgress(prev => ({
          ...prev,
          [runId]: {
            ...prev[runId],
            findings: [...(prev[runId]?.findings ?? []), event.finding],
          },
        }));
      } else if (event.type === 'done') {
        setLiveProgress(prev => ({
          ...prev,
          [runId]: { ...prev[runId], status: event.status ?? 'completed', pct: 100 },
        }));
        // Refresh the run list so the completed run shows proper data
        setTimeout(loadRuns, 1000);
        delete streamCleanups.current[runId];
      }
    });

    streamCleanups.current[runId] = cleanup;
  }, [loadRuns]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { Object.values(streamCleanups.current).forEach(fn => fn()); };
  }, []);

  const handleLaunched = (runId: string) => {
    setActiveRunId(runId);
    loadRuns();
    startStreaming(runId);
  };

  // ── Summary stats ──────────────────────────────────────────────────────────
  const completedRuns = runs.filter(r => r.status === 'completed');
  const totalCritical = completedRuns.reduce((n, r) => n + (r.critical_count ?? 0), 0);
  const totalHigh     = completedRuns.reduce((n, r) => n + (r.high_count ?? 0), 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 text-white p-2.5 rounded-xl shadow-sm">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Audit Center</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {completedRuns.length} completed runs · {totalCritical} critical · {totalHigh} high findings
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
            <button onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
              title="Grid view">
              <LayoutGrid size={15} />
            </button>
            <button onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-lg transition-all ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
              title="List view">
              <List size={15} />
            </button>
          </div>
          <button onClick={loadRuns} disabled={loading}
            className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors disabled:opacity-50">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg shadow-sm transition-colors">
            <ShieldCheck size={14} /> New Audit
          </button>
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-5">

        {!activeCompany && (
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
            <AlertTriangle size={14} /> Select a company in the Blueprint to see audit runs.
          </div>
        )}

        {/* Summary stats row */}
        {completedRuns.length > 0 && (
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total runs',   value: runs.length,         icon: <BarChart3 size={14} />,   color: 'text-slate-600 dark:text-slate-300' },
              { label: 'Assessments', value: completedRuns.reduce((n,r) => n + r.completed_pairs, 0), icon: <ShieldCheck size={14} />, color: 'text-indigo-600 dark:text-indigo-400' },
              { label: 'Critical',    value: totalCritical,        icon: <AlertTriangle size={14} />, color: 'text-rose-600 dark:text-rose-400' },
              { label: 'High risk',   value: totalHigh,            icon: <TrendingUp size={14} />,   color: 'text-amber-600 dark:text-amber-400' },
            ].map(({ label, value, icon, color }) => (
              <div key={label} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col gap-1">
                <div className={`flex items-center gap-1.5 text-[11px] font-bold ${color}`}>
                  {icon} {label}
                </div>
                <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Run list */}
        {loading && runs.length === 0 ? (
          <div className="flex items-center justify-center py-16 gap-2 text-slate-400 dark:text-slate-500">
            <Loader2 size={18} className="animate-spin" /> Loading audit runs…
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-400 dark:text-slate-500">
            <div className="p-5 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800">
              <ShieldCheck size={32} className="text-blue-400 dark:text-blue-500" />
            </div>
            <div className="text-center">
              <p className="font-bold text-slate-600 dark:text-slate-300 text-base">No audit runs yet</p>
              <p className="text-sm mt-1">Click "New Audit" or launch from a use case or agent detail page.</p>
            </div>
            <button onClick={() => setModalOpen(true)}
              className="flex items-center gap-1.5 text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg shadow-sm transition-colors">
              <ShieldCheck size={14} /> Start first audit
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
            {runs.map(run => {
              const live = liveProgress[run.id];
              const isLive = live && live.status === 'running';
              const pct  = live?.pct ?? (run.status === 'completed' ? 100 : 0);
              const risk = (live?.overall_risk ?? run.overall_risk) as RiskLevel | null;
              const status = live?.status ?? run.status;
              return (
                <div key={run.id}
                  className={`bg-white dark:bg-slate-900 rounded-xl border transition-all cursor-pointer hover:shadow-md flex flex-col gap-3 p-4 ${
                    run.id === activeRunId
                      ? 'border-indigo-300 dark:border-indigo-700 shadow-sm'
                      : 'border-slate-200 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-800'
                  }`}
                  onClick={() => navigate(`/audit/${run.id}`)}>
                  <div className="flex items-center justify-between gap-2">
                    <StatusIcon status={status} />
                    {risk && <RiskBadge level={risk} />}
                  </div>
                  <div>
                    <p className="font-bold text-slate-800 dark:text-slate-100 text-sm leading-snug">
                      {run.use_case_name ?? run.agent_name ?? 'Full catalog'}
                    </p>
                    {run.compliance_item_name && (
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">vs {run.compliance_item_name}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500">
                    <span className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-full font-bold capitalize">
                      {run.scope_type.replace(/_/g,' ')}
                    </span>
                    <span>{new Date(run.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-auto pt-1 border-t border-slate-100 dark:border-slate-800">
                    <ProgressBar pct={pct} risk={risk} />
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 flex-shrink-0">
                      {live?.completed ?? run.completed_pairs}/{live?.total ?? run.total_pairs}
                    </span>
                  </div>
                  {isLive && (
                    <span className="text-[10px] text-indigo-500 dark:text-indigo-400 font-bold animate-pulse">
                      {live?.findings?.length ?? 0} findings so far
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {runs.map(run => {
              const live = liveProgress[run.id];
              const isLive = live && live.status === 'running';
              const pct  = live?.pct ?? (run.status === 'completed' ? 100 : 0);
              const risk = (live?.overall_risk ?? run.overall_risk) as RiskLevel | null;
              const status = live?.status ?? run.status;
              const liveFindingCount = live?.findings?.length ?? 0;

              return (
                <div key={run.id}
                  className={`bg-white dark:bg-slate-900 rounded-xl border transition-all cursor-pointer hover:shadow-md ${
                    run.id === activeRunId
                      ? 'border-indigo-300 dark:border-indigo-700 shadow-sm'
                      : 'border-slate-200 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-800'
                  }`}
                  onClick={() => navigate(`/audit/${run.id}`)}
                >
                  <div className="p-4 flex flex-col gap-3">
                    {/* Row 1 */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <StatusIcon status={status} />
                        <p className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate">
                          {run.use_case_name ?? run.agent_name ?? 'Full catalog'}
                        </p>
                        {run.compliance_item_name && (
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 hidden sm:block">
                            vs {run.compliance_item_name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {risk && <RiskBadge level={risk} />}
                        <ChevronRight size={14} className="text-slate-300 dark:text-slate-600" />
                      </div>
                    </div>

                    {/* Row 2 — scope + meta */}
                    <div className="flex items-center gap-3 text-[10px] text-slate-400 dark:text-slate-500">
                      <span className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-full font-bold capitalize">
                        {run.scope_type.replace(/_/g,' ')}
                      </span>
                      <span>{new Date(run.created_at).toLocaleDateString()} {new Date(run.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</span>
                      {isLive && liveFindingCount > 0 && (
                        <span className="text-indigo-500 dark:text-indigo-400 font-bold animate-pulse">
                          {liveFindingCount} finding{liveFindingCount !== 1 ? 's' : ''} so far
                        </span>
                      )}
                    </div>

                    {/* Progress bar */}
                    <div className="flex items-center gap-3">
                      <ProgressBar pct={pct} risk={risk} />
                      <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 flex-shrink-0">
                        {live?.completed ?? run.completed_pairs}/{live?.total ?? run.total_pairs}
                      </span>
                    </div>

                    {/* Live findings preview */}
                    {isLive && live.findings.length > 0 && (
                      <div className="flex flex-col gap-1 pt-1 border-t border-slate-100 dark:border-slate-800">
                        {live.findings.slice(-3).map(f => (
                          <div key={f.id} className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                            <RiskBadge level={f.risk_level} size="xs" />
                            <span className="truncate">{f.compliance_item_name} — {f.use_case_name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modal ──────────────────────────────────────────────────────────────── */}
      <AuditInitModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onLaunched={handleLaunched}
        mode="general"
      />
    </div>
  );
};

export default AuditCenterPage;
