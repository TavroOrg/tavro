import React, { useState, useEffect } from 'react';
import { AgentData } from '../types/agent';
import AgentHeader from './AgentHeader';
import AgentIdentificationTab from './AgentIdentificationTab';
import AgentTechConfigTab from './AgentTechConfigTab';
import AgentImpact from './AgentImpact';
import AgentRelatedTab from './AgentRelatedTab';
import type { AgentBusinessImpactSnapshot } from './AgentRelatedTab';
import AgentLineage from './AgentLineage';
import AgentRiskSummary from './AgentRiskSummary';
import AgentContextGraph from './AgentContextGraphRF';

interface AgentViewProps {
    agent: AgentData;
    onBusinessImpactChange?: (snapshot: AgentBusinessImpactSnapshot) => void;
}

type TabType =
    | 'IDENTIFICATION'
    | 'CONFIG'
    | 'IMPACT'
    | 'LINEAGE'
    | 'RISK'
    | 'CONTEXT';

const BASE_TABS: { id: TabType; label: string }[] = [
    { id: 'IDENTIFICATION', label: 'Identification & Role' },
    { id: 'CONFIG', label: 'Technical Configuration' },
    { id: 'IMPACT', label: 'Business Impact' },
    { id: 'LINEAGE', label: 'Lineage Map' },
    { id: 'RISK', label: 'AI Risk Assessment' },
    { id: 'CONTEXT', label: 'Context Graph' },
];

const AgentView: React.FC<AgentViewProps> = ({ agent, onBusinessImpactChange }) => {
    const [activeTab, setActiveTab] = useState<TabType>('IDENTIFICATION');
    const agentId = agent.identification?.agent_id;

    // Reset tab when viewing a new agent
    useEffect(() => setActiveTab('IDENTIFICATION'), [agentId]);

    return (
        <div id="tour-agent-detail-section" className="flex flex-col gap-4 animate-fade-in w-full max-w-[1400px] mx-auto">
            {/* Top accent bar */}
            <div className="h-4 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-t-2xl w-full" />

            {/* Header (always visible) */}
            <div id="tour-agent-detail-card" className="-mt-6">
                <AgentHeader agent={agent} />
            </div>

            {/* Tab Navigation */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide border-b border-slate-200">
                {BASE_TABS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-4 py-3 text-sm font-bold whitespace-nowrap transition-all border-b-2 ${activeTab === tab.id
                                ? 'border-blue-600 text-blue-700'
                                : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div>
                {activeTab === 'IDENTIFICATION' && <AgentIdentificationTab agent={agent} />}

                {activeTab === 'CONFIG' && <AgentTechConfigTab agent={agent} />}

                {activeTab === 'IMPACT' && (
                    <div>
                        <AgentImpact agent={agent} hideAssetSections>
                            <AgentRelatedTab
                                agent={agent}
                                mode="all"
                                embedded
                                onBusinessImpactChange={onBusinessImpactChange}
                            />
                        </AgentImpact>
                    </div>
                )}

                {activeTab === 'LINEAGE' && (
                    <div><AgentLineage agent={agent} /></div>
                )}

                {activeTab === 'RISK' && agentId && (
                    <div><AgentRiskSummary agentId={agentId} /></div>
                )}
                {activeTab === 'RISK' && !agentId && (
                    <div className="p-6 bg-slate-50 text-slate-500 text-sm rounded-xl text-center">
                        Agent ID required for Risk Assessment.
                    </div>
                )}

                {activeTab === 'CONTEXT' && (
                    <div><AgentContextGraph agent={agent} /></div>
                )}
            </div>
        </div>
    );
};

export default AgentView;
