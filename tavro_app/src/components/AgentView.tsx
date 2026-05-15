import React, { useState, useEffect } from 'react';
import { AgentData } from '../types/agent';
import AgentHeader from './AgentHeader';
import AgentIdentificationTab from './AgentIdentificationTab';
import AgentTechConfigTab from './AgentTechConfigTab';
import AgentImpact from './AgentImpact';
import AgentRelatedTab from './AgentRelatedTab';
import AgentLineage from './AgentLineage';
import AgentRiskSummary from './AgentRiskSummary';
import AgentContextGraph from './AgentContextGraphRF';
import { businessRelationsApi } from '../services/businessRelationsApi';

interface AgentViewProps {
    agent: AgentData;
}

type TabType =
    | 'IDENTIFICATION'
    | 'CONFIG'
    | 'IMPACT'
    | 'RELATED_APPLICATIONS'
    | 'RELATED_PROCESSES'
    | 'LINEAGE'
    | 'RISK'
    | 'CONTEXT';

const BASE_TABS: { id: TabType; label: string }[] = [
    { id: 'IDENTIFICATION', label: 'Identification & Role' },
    { id: 'CONFIG', label: 'Technical Configuration' },
    { id: 'IMPACT', label: 'Business Impact' },
    { id: 'RELATED_APPLICATIONS', label: 'Applications' },
    { id: 'RELATED_PROCESSES', label: 'Processes' },
    { id: 'LINEAGE', label: 'Lineage Map' },
    { id: 'RISK', label: 'AI Risk Assessment' },
    { id: 'CONTEXT', label: 'Context Graph' },
];

const AgentView: React.FC<AgentViewProps> = ({ agent }) => {
    const [activeTab, setActiveTab] = useState<TabType>('IDENTIFICATION');
    const agentId = agent.identification?.agent_id;
    const fallbackApplicationCount = (agent.application ?? []).length;
    const fallbackProcessCount = (agent.business_process ?? []).length;
    const [relatedCounts, setRelatedCounts] = useState({
        applications: fallbackApplicationCount,
        processes: fallbackProcessCount,
    });

    // Reset tab when viewing a new agent
    useEffect(() => setActiveTab('IDENTIFICATION'), [agentId]);

    useEffect(() => {
        setRelatedCounts({
            applications: fallbackApplicationCount,
            processes: fallbackProcessCount,
        });
    }, [fallbackApplicationCount, fallbackProcessCount]);

    useEffect(() => {
        let cancelled = false;

        const loadCounts = async () => {
            if (!agentId) return;
            try {
                const payload = await businessRelationsApi.getAgentRelations(agentId);
                if (cancelled) return;
                setRelatedCounts({
                    applications: payload.applications.length,
                    processes: payload.business_processes.length,
                });
            } catch {
                if (cancelled) return;
                setRelatedCounts({
                    applications: fallbackApplicationCount,
                    processes: fallbackProcessCount,
                });
            }
        };

        loadCounts();
        return () => {
            cancelled = true;
        };
    }, [agentId, fallbackApplicationCount, fallbackProcessCount]);

    const tabs: { id: TabType; label: string }[] = BASE_TABS.map(tab => {
        if (tab.id === 'RELATED_APPLICATIONS') {
            return { ...tab, label: `Applications(${relatedCounts.applications})` };
        }
        if (tab.id === 'RELATED_PROCESSES') {
            return { ...tab, label: `Processes(${relatedCounts.processes})` };
        }
        return tab;
    });

    return (
        <div className="flex flex-col gap-6 animate-fade-in w-full max-w-[1400px] mx-auto">
            {/* Top accent bar */}
            <div className="h-4 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-t-2xl w-full" />

            {/* Header (always visible) */}
            <div className="-mt-6">
                <AgentHeader agent={agent} />
            </div>

            {/* Tab Navigation */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide border-b border-slate-200">
                {tabs.map(tab => (
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
            <div className="min-h-[400px]">
                {activeTab === 'IDENTIFICATION' && <AgentIdentificationTab agent={agent} />}

                {activeTab === 'CONFIG' && <AgentTechConfigTab agent={agent} />}

                {activeTab === 'IMPACT' && (
                    <div className="mt-4"><AgentImpact agent={agent} /></div>
                )}

                {activeTab === 'RELATED_APPLICATIONS' && (
                    <div className="mt-4">
                        <AgentRelatedTab
                            agent={agent}
                            mode="applications"
                            onCountsChange={setRelatedCounts}
                        />
                    </div>
                )}

                {activeTab === 'RELATED_PROCESSES' && (
                    <div className="mt-4">
                        <AgentRelatedTab
                            agent={agent}
                            mode="processes"
                            onCountsChange={setRelatedCounts}
                        />
                    </div>
                )}

                {activeTab === 'LINEAGE' && (
                    <div className="mt-4"><AgentLineage agent={agent} /></div>
                )}

                {activeTab === 'RISK' && agentId && (
                    <div className="mt-4"><AgentRiskSummary agentId={agentId} /></div>
                )}
                {activeTab === 'RISK' && !agentId && (
                    <div className="mt-4 p-6 bg-slate-50 text-slate-500 text-sm rounded-xl text-center">
                        Agent ID required for Risk Assessment.
                    </div>
                )}

                {activeTab === 'CONTEXT' && (
                    <div className="mt-4"><AgentContextGraph agent={agent} /></div>
                )}
            </div>
        </div>
    );
};

export default AgentView;
