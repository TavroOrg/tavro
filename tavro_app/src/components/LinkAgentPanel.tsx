import React, { useState } from 'react';
import { toUserMessage } from '../utils/errorUtils';
import { AgentData } from '../types/agent';
import { mcpClient } from '../services/mcpClient';
import { Link2, Loader2, CheckCircle2, AlertCircle, Bot, Search, X } from 'lucide-react';

interface LinkAgentPanelProps {
    useCaseId: string;
    /** Already-linked agent IDs so we can disable them */
    linkedAgentIds: string[];
    /** Full agent list from the catalog (already cached) */
    agents: AgentData[];
    onLinked: (agentId: string) => void;
}

const LinkAgentPanel: React.FC<LinkAgentPanelProps> = ({
    useCaseId, linkedAgentIds, agents, onLinked
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [linking, setLinking] = useState<string | null>(null); // agent_id being linked
    const [linked, setLinked] = useState<Set<string>>(new Set(linkedAgentIds));
    const [error, setError] = useState<string | null>(null);

    const filtered = agents.filter(a => {
        const q = searchTerm.toLowerCase();
        return (
            a.name?.toLowerCase().includes(q) ||
            a.identification?.agent_id?.toLowerCase().includes(q) ||
            a.identification?.environment?.toLowerCase().includes(q)
        );
    });

    const handleLink = async (agent: AgentData) => {
        const agentId = agent.identification?.agent_id || agent.name;
        if (!agentId || linked.has(agentId)) return;

        setLinking(agentId);
        setError(null);
        try {
            await mcpClient.createAiUseCaseAgentRelationship(useCaseId, agentId);
            setLinked(prev => new Set([...prev, agentId]));
            onLinked(agentId);
        } catch (err: any) {
            setError(toUserMessage(err));
        } finally {
            setLinking(null);
        }
    };

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                <Link2 size={16} className="text-violet-500" />
                <span className="font-bold text-slate-800 text-sm">Link Agent to Use Case</span>
                <span className="text-xs text-slate-400 ml-1">· {linked.size} linked</span>
            </div>

            <div className="p-5 flex flex-col gap-4">
                <p className="text-xs text-slate-500 leading-relaxed">
                    Search and select agents from the catalog to establish a relationship with this use case via the MCP server.
                </p>

                {/* Search */}
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-400/20 transition-all">
                    <Search size={15} className="text-slate-400 shrink-0" />
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        placeholder="Search agents by name or ID…"
                        className="bg-transparent outline-none text-sm flex-1 text-slate-700 placeholder:text-slate-400"
                    />
                    {searchTerm && (
                        <button onClick={() => setSearchTerm('')} className="text-slate-400 hover:text-slate-600 transition-colors">
                            <X size={14} />
                        </button>
                    )}
                </div>

                {/* Error */}
                {error && (
                    <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2.5 text-xs">
                        <AlertCircle size={14} className="mt-0.5 shrink-0" />
                        {error}
                    </div>
                )}

                {/* Agent list */}
                <div className="flex flex-col divide-y divide-slate-100 max-h-72 overflow-y-auto rounded-xl border border-slate-100">
                    {filtered.length === 0 ? (
                        <div className="py-8 text-center text-slate-400 text-sm">
                            {searchTerm ? `No agents found for "${searchTerm}"` : 'No agents available'}
                        </div>
                    ) : (
                        filtered.map(agent => {
                            const agentId = agent.identification?.agent_id || agent.name;
                            const isLinked = linked.has(agentId);
                            const isLinking = linking === agentId;
                            return (
                                <div key={agentId} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className={`p-1.5 rounded-lg shrink-0 ${isLinked ? 'bg-emerald-50' : 'bg-blue-50'}`}>
                                            <Bot size={13} className={isLinked ? 'text-emerald-600' : 'text-blue-600'} />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-slate-800 truncate">{agent.name}</p>
                                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                                {agentId && agentId !== agent.name && (
                                                    <span className="text-[10px] font-mono text-slate-400">{agentId}</span>
                                                )}
                                                {agent.identification?.environment && (
                                                    <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                                                        {agent.identification.environment}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleLink(agent)}
                                        disabled={isLinked || isLinking}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-all disabled:cursor-not-allowed ${isLinked
                                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                : isLinking
                                                    ? 'bg-violet-50 text-violet-400 border border-violet-200'
                                                    : 'bg-violet-600 text-white hover:bg-violet-700'
                                            }`}
                                    >
                                        {isLinking ? (
                                            <><Loader2 size={12} className="animate-spin" /> Linking…</>
                                        ) : isLinked ? (
                                            <><CheckCircle2 size={12} /> Linked</>
                                        ) : (
                                            <><Link2 size={12} /> Link</>
                                        )}
                                    </button>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
};

export default LinkAgentPanel;
