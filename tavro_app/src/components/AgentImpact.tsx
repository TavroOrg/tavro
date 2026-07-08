import React from 'react';
import { AgentData } from '../types/agent';

interface AgentImpactProps {
  agent: AgentData;
  hideAssetSections?: boolean;
  children?: React.ReactNode;
}

const AgentImpact: React.FC<AgentImpactProps> = ({ agent, children }) => {
  void agent;

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 shadow-sm min-h-[400px] flex flex-col gap-6">
      {children}
    </div>
  );
};

export default AgentImpact;
