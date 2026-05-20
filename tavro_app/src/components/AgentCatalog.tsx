import React, { useState } from 'react';
import { AgentData } from '../types/agent';
import { getAgentRiskLevel } from '../utils/agentRisk';
import { Search, ChevronRight, ShieldAlert, CheckCircle2, LayoutGrid, List, Bot, Loader2 } from 'lucide-react';

interface AgentCatalogProps {
    agents: AgentData[];
    searchTerm: string;
    onSearchChange: (term: string) => void;
    onSelectAgent: (agent: AgentData) => void;
}

const AgentCatalog: React.FC<AgentCatalogProps> = ({ agents, searchTerm, onSearchChange, onSelectAgent }) => {
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const isPendingAssessment = (agent: AgentData): boolean => {
        const status = agent.identification?.governance_status ?? (agent as any).latest_event_status;
        return status === 'Risk Assessment is running';
    };

    const getRiskLevel = (agent: AgentData): 'prohibited' | 'high' | 'medium' | 'low' => getAgentRiskLevel(agent);

    return (
        <div className="flex flex-col gap-6 w-full animate-fade-in">
            {/* Header / Search Controls */}
            <div className="flex items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={18} />
                    <input
                        type="text"
                        placeholder="Search agents..."
                        value={searchTerm}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-slate-800 dark:text-slate-100"
                    />
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest hidden sm:block">
                        Showing {agents.length} Results
                    </div>
                    <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={`p-1.5 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                            title="Grid View"
                        >
                            <LayoutGrid size={18} />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`p-1.5 rounded-lg transition-all ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                            title="List View"
                        >
                            <List size={18} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Agent Content */}
            {viewMode === 'grid' ? (
                <div 
                    key={searchTerm ? 'search-grid' : 'paged-grid'}
                    className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
                >
                    {agents.map(agent => {
                        const pending = isPendingAssessment(agent);
                        const risk = getRiskLevel(agent);
                        const isHigh = !pending && (risk === 'high' || risk === 'prohibited');
                        const isMed = !pending && risk === 'medium';
                        
                        return (
                            <div
                                key={agent.identification?.agent_id || agent.id || agent.name}
                                onClick={() => onSelectAgent(agent)}
                                className="group bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-lg hover:border-blue-400 dark:hover:border-blue-700 transition-all cursor-pointer overflow-hidden flex flex-col h-full"
                            >
                                <div className="h-2 bg-gradient-to-r from-blue-500 to-indigo-600" />
                                
                                <div className="p-5 flex-1 flex flex-col">
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="p-2 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl group-hover:scale-110 transition-transform">
                                            <Bot size={24} />
                                        </div>
                                        <div className="flex flex-col items-end gap-1.5">
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800">
                                                Active
                                            </span>
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-100 dark:border-slate-700">
                                                v{agent.version || '1.0'}
                                            </span>
                                        </div>
                                    </div>

                                    <h3 className="font-bold text-slate-800 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-1 mb-1">
                                        {agent.name}
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed mb-4 flex-1">
                                        {agent.description || 'No description provided for this agent.'}
                                    </p>

                                    <div className="flex flex-wrap gap-1.5 mt-auto">
                                        {pending && (
                                            <div className="flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-md border bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-800">
                                                <Loader2 size={10} className="animate-spin" />
                                                Running Risk Assessment
                                            </div>
                                        )}
                                        {!pending && (
                                            <div className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-md border ${
                                                isHigh ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-100 dark:border-red-800/50'
                                                : isMed ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-800/50'
                                                : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800/50'
                                            }`}>
                                                {isHigh || isMed ? <ShieldAlert size={10} /> : <CheckCircle2 size={10} />}
                                                RISK: {risk === 'prohibited' ? 'PROHIBITED' : isHigh ? 'HIGH' : isMed ? 'MEDIUM' : 'LOW'}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                                    <span className="font-mono truncate min-w-0">ID: {agent.identification?.agent_id || agent.id || 'N/A'}</span>
                                    <ChevronRight size={14} className="shrink-0 group-hover:translate-x-1 transition-transform" />
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
                    <div className="grid grid-cols-[1.5fr_1fr_120px_1fr_140px_48px] items-center bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 px-6 py-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        <div>Agent Name</div>
                        <div>Description</div>
                        <div>Version</div>
                        <div>Status</div>
                        <div>Risk Level</div>
                        <div></div>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {agents.map(agent => {
                            const pending = isPendingAssessment(agent);
                            const risk = getRiskLevel(agent);
                            const isHigh = !pending && (risk === 'high' || risk === 'prohibited');
                            const isMed = !pending && risk === 'medium';

                            return (
                                <div
                                    key={agent.identification?.agent_id || agent.id || agent.name}
                                    onClick={() => onSelectAgent(agent)}
                                    className="grid grid-cols-[1.5fr_1fr_120px_1fr_140px_48px] items-center px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors group"
                                >
                                    <div className="flex flex-col gap-0.5 pr-4">
                                        <div className="font-bold text-slate-800 dark:text-slate-100 text-sm group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                                            {agent.name}
                                        </div>
                                        <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                                            {(agent.identification?.agent_id || agent.id || 'N/A').slice(0, 8)}
                                        </div>
                                    </div>
                                    <div className="text-sm text-slate-500 dark:text-slate-400 truncate pr-8">
                                        {agent.description || 'No description provided.'}
                                    </div>
                                    <div className="text-xs text-slate-400 dark:text-slate-500 font-medium">
                                        v{agent.version || '1.0'}
                                    </div>
                                    <div>
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800">
                                            Active
                                        </span>
                                    </div>
                                    <div>
                                        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded border ${
                                            pending
                                                ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-800'
                                                : isHigh ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-100 dark:border-red-800/50'
                                                : isMed ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-800/50'
                                                : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800/50'
                                        }`}>
                                            {pending ? <Loader2 size={12} className="animate-spin" /> : isHigh || isMed ? <ShieldAlert size={12} /> : <CheckCircle2 size={12} />}
                                            {pending ? 'Running Risk Assessment' : risk === 'prohibited' ? 'Prohibited' : isHigh ? 'High' : isMed ? 'Medium' : 'Low'}
                                        </span>
                                    </div>
                                    <div className="flex justify-end pr-2 text-slate-300 dark:text-slate-600 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors">
                                        <ChevronRight size={18} className="transform group-hover:translate-x-1 transition-transform" />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {agents.length === 0 && (
                <div className="py-20 flex flex-col items-center justify-center gap-4 text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800">
                    <div className="p-4 bg-white dark:bg-slate-800 rounded-full shadow-sm">
                        <Search size={32} className="text-slate-300 dark:text-slate-600" />
                    </div>
                    <p className="font-medium text-lg">No agents found matching your criteria</p>
                </div>
            )}
        </div>
    );
};

export default AgentCatalog;


