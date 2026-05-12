import React from 'react';
import { AgentData } from '../types/agent';
import { TrendingUp, ShieldAlert, CheckCircle2, Briefcase, LayoutGrid, Lightbulb } from 'lucide-react';

interface AgentImpactProps { agent: AgentData; }

const getRiskBadge = (level: string) => {
  const l = (level ?? '').toLowerCase();
  if (l.includes('critical') || l.includes('high'))
    return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-red-50 text-red-700 border border-red-200"><ShieldAlert size={13} /> {level}</span>;
  if (l.includes('medium'))
    return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200"><ShieldAlert size={13} /> {level}</span>;
  return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200"><CheckCircle2 size={13} /> {level}</span>;
};

const StatusBadge: React.FC<{ status?: string | null }> = ({ status }) => {
  if (!status) return null;
  const s = status.toLowerCase();
  const cls = s.includes('active') || s.includes('approved')
    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
    : s.includes('pending') || s.includes('review')
      ? 'bg-amber-50 text-amber-700 border-amber-100'
      : 'bg-slate-100 text-slate-600 border-slate-200';
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide ${cls}`}>{status}</span>;
};

const AgentImpact: React.FC<AgentImpactProps> = ({ agent }) => {
  const uc = agent.ai_use_case;
  const hasUseCase = uc && Object.values(uc).some(v => v !== null && v !== undefined && v !== '');

  return (
    <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden flex flex-col h-full">
      <div className="p-5 border-b border-slate-100 flex items-center gap-3">
        <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
          <TrendingUp size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-800 tracking-tight">Business Impact</h2>
          <p className="text-xs text-slate-500 font-medium">Use case, applications & processes</p>
        </div>
      </div>

      <div className="p-5 flex flex-col gap-6 flex-1 overflow-y-auto">
        {hasUseCase && (
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Lightbulb size={13} /> AI Use Case
            </h3>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  {uc!.name && <p className="font-bold text-sm text-slate-800">{uc!.name}</p>}
                  {uc!.owner && <p className="text-[11px] text-slate-500 mt-0.5">Owner: {uc!.owner}</p>}
                  {uc!.proposed_by && <p className="text-[11px] text-slate-500">Proposed by: {uc!.proposed_by}</p>}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {uc!.priority && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 uppercase">{uc!.priority}</span>
                  )}
                  <StatusBadge status={uc!.status} />
                </div>
              </div>
              {uc!.description && <p className="text-xs text-slate-600 leading-relaxed">{uc!.description}</p>}
              {uc!.problem_statement && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Problem Statement</p>
                  <p className="text-xs text-slate-600 leading-relaxed">{uc!.problem_statement}</p>
                </div>
              )}
              {uc!.expected_benefits && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Expected Benefits</p>
                  <p className="text-xs text-slate-600 leading-relaxed">{uc!.expected_benefits}</p>
                </div>
              )}
              {uc!.function && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Function</p>
                  <p className="text-xs text-slate-600 leading-relaxed">{uc!.function}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {hasUseCase && <div className="h-px bg-slate-100 w-full" />}

        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <LayoutGrid size={13} /> Targeted Applications ({(agent.application ?? []).length})
          </h3>
          <div className="flex flex-col gap-3">
            {(agent.application ?? []).map((app, idx) => (
              <div key={idx} className="flex flex-col p-4 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className="font-bold text-sm text-slate-800">{app.name}</span>
                    <span className="block text-[11px] font-semibold text-slate-400 mt-0.5">Tier: {app.emergency_tier || 'N/A'}</span>
                  </div>
                  {getRiskBadge(app.business_criticality ?? '')}
                </div>
                {app.description && <p className="text-xs text-slate-600 leading-relaxed">{app.description}</p>}
              </div>
            ))}
            {(agent.application ?? []).length === 0 && (
              <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                No identified applications.
              </div>
            )}
          </div>
        </div>

        <div className="h-px bg-slate-100 w-full" />

        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <Briefcase size={13} /> Impacted Processes ({(agent.business_process ?? []).length})
          </h3>
          <div className="flex flex-col gap-3">
            {(agent.business_process ?? []).map((proc, idx) => (
              <div key={idx} className="flex justify-between items-center p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
                <div>
                  <span className="font-semibold text-sm text-slate-800">{proc.name}</span>
                  {proc.description && <span className="block text-xs text-slate-500 mt-0.5 max-w-[220px] truncate">{proc.description}</span>}
                </div>
                {getRiskBadge(proc.business_criticality)}
              </div>
            ))}
            {(agent.business_process ?? []).length === 0 && (
              <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                No identified business processes.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentImpact;
