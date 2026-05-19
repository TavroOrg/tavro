import React from 'react';
import { AgentData } from '../types/agent';
import { TrendingUp } from 'lucide-react';

interface AgentImpactProps {
  agent: AgentData;
  hideAssetSections?: boolean;
  children?: React.ReactNode;
}

const AgentImpact: React.FC<AgentImpactProps> = ({ agent, children }) => {
  void agent;

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
        {children}
      </div>
    </div>
  );
};

export default AgentImpact;
