// ── src/pages/AuditRunDetailPage.tsx ─────────────────────────────────────────

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ShieldCheck, Loader2, CheckCircle2, XCircle,
  AlertTriangle, ChevronDown, ChevronUp, Clock, RefreshCw,
  FileText, Scale, TrendingUp, Lightbulb,
} from 'lucide-react';
import { auditApi } from '../services/auditApi';
import type { AuditRun, AuditFinding, AuditSSEEvent, RiskLevel } from '../types/audit';
import { RISK_META } from '../types/audit';

const RiskBadge: React.FC<{ level: RiskLevel | null | undefined }> = ({ level }) => {
  if (!level) return null;
  const m = RISK_META[level];
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
      style={{ background: m.bg, color: m.color, borderColor: m.badge }}>
      {m.label}
    </span>
  );
};

const ScoreBar: React.FC<{ score: number | null; color: string }> = ({ score, color }) => (
  <div className="flex items-center gap-2">
    <div className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-full h-1.5">
      <div className="h-1.5 rounded-full transition-all" style={{ width: `${score ?? 0}%`, background: color }} />
    </div>
    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 w-7 text-right">{score ?? '—'}</span>
  </div>
);

const FindingCard: React.FC<{ finding: AuditFinding }> = ({ finding }) => {
  const [expanded, setExpanded] = useState(false);
  const risk = finding.risk_level;
  const m    = risk ? RISK_META[risk] : null;
  const gaps = (finding.gaps as any[]) ?? [];
  const recs = (finding.recommendations as any[]) ?? [];
  const rules = (finding.applicable_rules as string[]) ?? [];
  const compliant = (finding.compliant_areas as string[]) ?? [];

  return (
    <div className={`bg-white dark:bg-slate-900 rounded-xl border transition-all ${
      risk === 'critical' ? 'border-rose-200 dark:border-rose-800' :
      risk === 'high'     ? 'border-orange-200 dark:border-orange-800' :
      'border-slate-200 dark:border-slate-800'
    } shadow-sm`}>
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer"
        onClick={() => setExpanded(p => !p)}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {finding.status === 'running'   && <Loader2 size={13} className="animate-spin text-blue-500 flex-shrink-0" />}
          {finding.status === 'completed' && m && (
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: m.dot }} />
          )}
          {finding.status === 'failed'    && <XCircle size={13} className="text-slate-300 flex-shrink-0" />}

          <div className="min-w-0">
            <p className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate">{finding.compliance_item_name}</p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">{finding.use_case_name}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {finding.status === 'completed' && (
            <>
              <RiskBadge level={finding.risk_level} />
              {finding.risk_score !== null && (
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">
                  {finding.risk_score}/100
                </span>
              )}
            </>
          )}
          {finding.status === 'running' && (
            <span className="text-[10px] text-blue-500 dark:text-blue-400 font-bold animate-pulse">Assessing…</span>
          )}
          {finding.status === 'failed' && (
            <span className="text-[10px] text-slate-400 dark:text-slate-500">Failed</span>
          )}
          {expanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && finding.status === 'completed' && (
        <div className="px-4 pb-4 flex flex-col gap-4 border-t border-slate-100 dark:border-slate-800 pt-4">
          {/* Summary */}
          {finding.summary && (
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{finding.summary}</p>
          )}

          {/* Scores */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1">Risk score</p>
              <ScoreBar score={finding.risk_score} color={m?.dot ?? '#64748b'} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1">Confidence</p>
              <ScoreBar score={finding.confidence} color="#6366f1" />
            </div>
          </div>

          {/* Applicable rules */}
          {rules.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Applicable requirements</p>
              <div className="flex flex-col gap-1">
                {rules.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <Scale size={10} className="text-indigo-500 flex-shrink-0 mt-0.5" />
                    {r}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Gaps */}
          {gaps.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider mb-2">
                Gaps identified ({gaps.length})
              </p>
              <div className="flex flex-col gap-2">
                {gaps.map((g: any, i: number) => {
                  const gm = g.severity ? RISK_META[g.severity as RiskLevel] : null;
                  return (
                    <div key={i} className="bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-800 rounded-lg px-3 py-2.5">
                      <div className="flex items-center gap-2 mb-1">
                        {gm && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ background: gm.bg, color: gm.color, border: `1px solid ${gm.badge}` }}>
                            {gm.label}
                          </span>
                        )}
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{g.requirement}</p>
                      </div>
                      {g.gap && <p className="text-xs text-rose-700 dark:text-rose-300">{g.gap}</p>}
                      {g.current_state && (
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                          Current: {g.current_state}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Compliant areas */}
          {compliant.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2">
                Already compliant
              </p>
              <div className="flex flex-col gap-1">
                {compliant.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <CheckCircle2 size={10} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                    {c}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {recs.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-2">
                Recommendations
              </p>
              <div className="flex flex-col gap-2">
                {recs.map((r: any, i: number) => (
                  <div key={i} className="flex items-start gap-2.5 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-lg px-3 py-2.5">
                    <Lightbulb size={12} className="text-indigo-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs text-slate-700 dark:text-slate-200">{r.action}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[9px] font-bold ${
                          r.priority === 'immediate'   ? 'text-rose-600 dark:text-rose-400' :
                          r.priority === 'short_term'  ? 'text-amber-600 dark:text-amber-400' :
                          'text-slate-400 dark:text-slate-500'
                        }`}>{r.priority?.replace('_',' ')}</span>
                        {r.owner && <span className="text-[9px] text-slate-400 dark:text-slate-500">→ {r.owner}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Meta */}
          <div className="flex items-center gap-3 text-[10px] text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-800 pt-2">
            {finding.tokens_used && <span>{finding.tokens_used.toLocaleString()} tokens</span>}
            {finding.assessment_duration_ms && <span>{(finding.assessment_duration_ms / 1000).toFixed(1)}s</span>}
          </div>
        </div>
      )}

      {expanded && finding.status === 'failed' && (
        <div className="px-4 pb-4 pt-2 border-t border-slate-100 dark:border-slate-800">
          <p className="text-sm text-rose-600 dark:text-rose-400">{finding.error_message ?? 'Assessment failed.'}</p>
        </div>
      )}
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

const AuditRunDetailPage: React.FC = () => {
  const { runId }  = useParams<{ runId: string }>();
  const navigate   = useNavigate();
  const [run,      setRun]      = useState<(AuditRun & { findings: AuditFinding[] }) | null>(null);
  const [findings, setFindings] = useState<AuditFinding[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [pct,      setPct]      = useState(0);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [overallRisk, setOverallRisk] = useState<RiskLevel | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const [riskFilter, setRiskFilter] = useState<RiskLevel | 'all'>('all');

  const load = useCallback(async (attempt = 0) => {
    if (!runId) return;
    setLoading(true);
    try {
      const data = await auditApi.getRun(runId);
      setRun(data);
      setFindings(data.findings ?? []);
      setOverallRisk(data.overall_risk as RiskLevel | null);
      setPct(data.status === 'completed' ? 100 : 0);
      setLiveStatus(data.status);
      if (data.status === 'running' || data.status === 'pending') {
        startStream(runId);
      }
    } catch (err: any) {
      // Retry up to 5 times with backoff — run may not be committed yet
      if (attempt < 5) {
        const delay = (attempt + 1) * 600;
        setTimeout(() => load(attempt + 1), delay);
        return;   // keep loading=true while retrying
      }
      // Give up after 5 attempts
    } finally {
      if (attempt >= 5) setLoading(false);
    }
    setLoading(false);
  }, [runId]);

  useEffect(() => { load(); return () => { cleanupRef.current?.(); }; }, [load]);

  const startStream = (id: string) => {
    cleanupRef.current?.();
    const cleanup = auditApi.streamProgress(id, (event: AuditSSEEvent) => {
      if (event.type === 'progress') {
        setPct(event.pct);
        setLiveStatus(event.status);
        setOverallRisk(event.overall_risk);
      } else if (event.type === 'finding') {
        setFindings(prev => {
          const exists = prev.find(f => f.id === event.finding.id);
          return exists
            ? prev.map(f => f.id === event.finding.id ? event.finding : f)
            : [...prev, event.finding];
        });
      } else if (event.type === 'done') {
        setLiveStatus(event.status ?? 'completed');
        setPct(100);
        setTimeout(load, 800);
      }
    });
    cleanupRef.current = cleanup;
  };

  if (loading && !run) return (
    <div className="flex items-center justify-center h-64 gap-2 text-slate-400">
      <Loader2 size={18} className="animate-spin" /> Loading audit run…
    </div>
  );
  if (!run) return <div className="p-8 text-slate-500">Audit run not found.</div>;

  const isLive = liveStatus === 'running' || liveStatus === 'pending';
  const status = liveStatus ?? run.status;

  // Risk breakdown
  const riskCounts = findings.reduce((acc, f) => {
    if (f.risk_level) acc[f.risk_level] = (acc[f.risk_level] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const filteredFindings = riskFilter === 'all'
    ? findings
    : findings.filter(f => f.risk_level === riskFilter);

  const sortedFindings = [...filteredFindings].sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
    return (order[a.risk_level ?? 'none'] ?? 5) - (order[b.risk_level ?? 'none'] ?? 5);
  });

  return (
    <div className="flex flex-col gap-6 w-full pb-12">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigate('/audit')}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-all">
          <ArrowLeft size={16} /> Back to Audit Center
        </button>
        {isLive && (
          <span className="flex items-center gap-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 animate-pulse">
            <Loader2 size={12} className="animate-spin" /> Assessment running…
          </span>
        )}
      </div>

      {/* Header card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-full capitalize">
                {run.scope_type.replace(/_/g,' ')}
              </span>
              {overallRisk && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                  style={{ background: RISK_META[overallRisk].bg, color: RISK_META[overallRisk].color, borderColor: RISK_META[overallRisk].badge }}>
                  Overall: {RISK_META[overallRisk].label}
                </span>
              )}
            </div>
            <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">
              {run.use_case_name ?? run.agent_name ?? 'Full catalog'}
              {run.compliance_item_name && ` × ${run.compliance_item_name}`}
            </h1>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              Started {new Date(run.created_at).toLocaleString()}
              {run.completed_at && ` · Completed ${new Date(run.completed_at).toLocaleString()}`}
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm font-bold">
            {status === 'completed' && <CheckCircle2 size={18} className="text-emerald-500" />}
            {isLive && <Loader2 size={18} className="animate-spin text-blue-500" />}
            {status === 'failed' && <XCircle size={18} className="text-rose-500" />}
          </div>
        </div>

        {/* Progress */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              {findings.filter(f => f.status === 'completed').length} of {run.total_pairs} assessments complete
            </span>
            <span className="font-bold text-slate-600 dark:text-slate-300">{pct}%</span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2">
            <div className="h-2 rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: overallRisk ? RISK_META[overallRisk].dot : '#6366f1' }} />
          </div>
        </div>

        {/* Risk breakdown pills */}
        {findings.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setRiskFilter('all')}
              className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all ${
                riskFilter === 'all' ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-200 dark:text-slate-800' : 'border-slate-200 dark:border-slate-700 text-slate-500'
              }`}>All {findings.length}</button>
            {(['critical','high','medium','low'] as RiskLevel[]).map(level => {
              const count = riskCounts[level] ?? 0;
              if (!count) return null;
              const m = RISK_META[level];
              return (
                <button key={level} onClick={() => setRiskFilter(riskFilter === level ? 'all' : level)}
                  className="text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all"
                  style={riskFilter === level
                    ? { background: m.dot, color: '#fff', borderColor: m.dot }
                    : { background: m.bg, color: m.color, borderColor: m.badge }
                  }>
                  {m.label} {count}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Findings */}
      <div className="flex flex-col gap-3">
        {sortedFindings.length === 0 && !isLive && (
          <div className="text-center py-8 text-slate-400 dark:text-slate-500 text-sm">
            No findings yet{riskFilter !== 'all' ? ` for ${riskFilter} risk` : ''}.
          </div>
        )}
        {isLive && findings.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-8 text-slate-400 dark:text-slate-500 text-sm">
            <Loader2 size={14} className="animate-spin" /> Waiting for first assessment results…
          </div>
        )}
        {sortedFindings.map(f => <FindingCard key={f.id} finding={f} />)}
      </div>
    </div>
  );
};

export default AuditRunDetailPage;
