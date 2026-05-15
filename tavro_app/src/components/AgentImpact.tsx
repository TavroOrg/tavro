import React from 'react';
import { AgentData } from '../types/agent';
import { TrendingUp, Lightbulb } from 'lucide-react';

interface AgentImpactProps {
  agent: AgentData;
  hideAssetSections?: boolean;
  children?: React.ReactNode;
}

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

const AgentImpact: React.FC<AgentImpactProps> = ({ agent, children }) => {
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
          <p className="text-xs text-slate-500 font-medium">Use Case, Applications & Processes</p>
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

        {children && (
          <>
            {hasUseCase && <div className="h-px bg-slate-100 w-full" />}
            {children}
          </>
        )}
      </div>
    </div>
  );
};

export default AgentImpact;
