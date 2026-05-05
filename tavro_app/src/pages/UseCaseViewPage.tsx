import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { UseCaseDetail } from '../types/useCase';
import { AgentData } from '../types/agent';
import { mcpClient } from '../services/mcpClient';
import UseCaseView from '../components/UseCaseView';
import { ArrowLeft, RefreshCw, AlertCircle, BrainCircuit, Link2, Search, X, Loader2, CheckCircle2 } from 'lucide-react';
import { useCatalog } from '../context/CatalogContext';
import { useUseCases } from '../context/UseCaseContext';

// ── Combined agents + link-agent section ──────────────────────────────────────

interface AgentsSectionProps {
    useCase: UseCaseDetail;
    agents: AgentData[];
    onRefetch: () => void;
}

const AgentsSection: React.FC<AgentsSectionProps> = ({ useCase, agents, onRefetch }) => {
    const { refresh: refreshUC } = useUseCases();
    const useCaseId = useCase.identifier;

    // Use the normalised agents array (already mapped through normaliseUseCase)
    const rawLinked: any[] = (useCase as any).agents ?? (useCase as any).of_associated_agents ?? [];

    // Extract a best-effort label from a potential ServiceNow reference object or flat record
    const agentLabel = (a: any): string => {
        if (!a || typeof a !== 'object') return 'Unknown Agent';

        // Priority 1: Direct name fields that aren't the sys_id/value
        const nameFields = ['name', 'display_value', 'title', 'u_name', 'agent_name'];
        for (const f of nameFields) {
            if (a[f] && typeof a[f] === 'string' && a[f] !== (a.value ?? a.sys_id)) return a[f];
        }

        // Priority 2: Extract ID and look up in the catalog
        const aId = a?.agent_id ?? a?.identification?.agent_id ?? a?.sys_id ?? a?.id ?? a?.value ?? '';
        if (aId) {
            const found = agents.find(catA =>
                catA.identification?.agent_id === aId ||
                catA.sys_id === aId ||
                catA.name === aId ||
                catA.id === aId
            );
            if (found?.name) return found.name;
        }

        // Walk nested reference fields (ServiceNow style)
        for (const key of Object.keys(a)) {
            const v = a[key];
            if (v && typeof v === 'object' && v.display_value && v.display_value !== v.value) {
                return v.display_value;
            }
        }

        return aId || 'Unknown Agent';
    };

    const agentId = (a: any): string => {
        // Try to find the catalog ID first
        let rawId = a?.agent_id ?? a?.identification?.agent_id ?? a?.sys_id ?? a?.id ?? a?.value;
        if (!rawId) return '';

        // If it's a GUID, it might be the sys_id. If it's something like TAVAC... it's the agent_id.
        // We prefer the catalog-matched name/id for the link if possible.
        const found = agents.find(catA =>
            catA.identification?.agent_id === rawId ||
            catA.sys_id === rawId ||
            catA.id === rawId
        );
        return found?.identification?.agent_id ?? found?.sys_id ?? found?.id ?? rawId;
    };

    // Collect IDs from the linked list for disabling already-linked agents in the catalog
    const [linkedIds, setLinkedIds] = useState<Set<string>>(() => {
        const ids = new Set<string>();
        rawLinked.forEach((a: any) => {
            const id = agentId(a);
            if (id) ids.add(id);
        });
        return ids;
    });

    // Total linked count = raw array length (most reliable)
    const totalLinked = rawLinked.length + (linkedIds.size - rawLinked.length > 0 ? linkedIds.size - rawLinked.length : 0);

    const [searchTerm, setSearchTerm] = useState('');
    const [linking, setLinking] = useState<string | null>(null);
    const [linkError, setLinkError] = useState<string | null>(null);

    const filteredAgents = agents.filter(a => {
        const q = searchTerm.toLowerCase();
        return (
            a.name?.toLowerCase().includes(q) ||
            a.identification?.agent_id?.toLowerCase().includes(q) ||
            a.identification?.environment?.toLowerCase().includes(q)
        );
    });

    const handleLink = async (agent: AgentData) => {
        const aId = agent.identification?.agent_id || agent.name;
        if (!aId || linkedIds.has(aId)) return;
        setLinking(aId);
        setLinkError(null);
        try {
            await mcpClient.createAiUseCaseAgentRelationship(useCaseId, aId);
            setLinkedIds(prev => new Set([...prev, aId]));
            refreshUC(); // Update the shared cache
            onRefetch(); // Update the local detail view state
        } catch (err: any) {
            setLinkError(err.message || 'Failed to link agent. Please try again.');
        } finally {
            setLinking(null);
        }
    };

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                    <BrainCircuit size={16} className="text-violet-500" />
                    <span className="font-bold text-slate-800 text-sm">Agents</span>
                    <span className="text-xs text-slate-400 ml-1">· {totalLinked} linked</span>
                </div>
                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 w-64 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-400/20 transition-all">
                    <Search size={14} className="text-slate-400 shrink-0" />
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        placeholder="Search agents…"
                        className="bg-transparent outline-none text-xs flex-1 text-slate-700 placeholder:text-slate-400"
                    />
                    {searchTerm && (
                        <button onClick={() => setSearchTerm('')} className="text-slate-400 hover:text-slate-600">
                            <X size={12} />
                        </button>
                    )}
                </div>
            </div>

            <div className="p-5 flex flex-col gap-3">
                {/* Already-linked agents from the use case */}
                {rawLinked.length > 0 && (
                    <div className="mb-2">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Currently Linked</p>
                        <div className="flex flex-col divide-y divide-slate-100 border border-slate-100 rounded-xl">
                            {rawLinked.map((a: any, i: number) => {
                                const name = agentLabel(a);
                                const id = agentId(a);
                                const env = a.environment ?? a.identification?.environment;
                                return (
                                    <div key={id ?? i} className="flex items-center gap-3 px-4 py-3">
                                        <div className="p-1.5 bg-emerald-50 rounded-lg shrink-0">
                                            <BrainCircuit size={13} className="text-emerald-600" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <Link
                                                to={`/agent/${id}`}
                                                className="text-sm font-semibold text-violet-600 hover:text-violet-800 hover:underline truncate inline-block"
                                            >
                                                {name}
                                            </Link>
                                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                                {id && id !== name && <span className="text-[10px] font-mono text-slate-400">{id}</span>}
                                                {env && <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{env}</span>}
                                            </div>
                                        </div>
                                        <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Link new agents */}
                <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                        <Link2 size={10} /> Link Additional Agents
                    </p>
                    {linkError && (
                        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2.5 text-xs mb-2">
                            <AlertCircle size={14} className="mt-0.5 shrink-0" />
                            {linkError}
                        </div>
                    )}
                    <div className="flex flex-col divide-y divide-slate-100 max-h-72 overflow-y-auto rounded-xl border border-slate-100">
                        {filteredAgents.length === 0 ? (
                            <div className="py-8 text-center text-slate-400 text-sm">
                                {searchTerm ? `No agents found for "${searchTerm}"` : 'No agents available'}
                            </div>
                        ) : (
                            filteredAgents.map(agent => {
                                const agentId = agent.identification?.agent_id || agent.name;
                                const isLinked = linkedIds.has(agentId);
                                const isLinking = linking === agentId;
                                return (
                                    <div key={agentId} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors gap-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className={`p-1.5 rounded-lg shrink-0 ${isLinked ? 'bg-emerald-50' : 'bg-blue-50'}`}>
                                                <BrainCircuit size={13} className={isLinked ? 'text-emerald-600' : 'text-blue-600'} />
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
        </div>
    );
};

// ── Page ──────────────────────────────────────────────────────────────────────
import { useChatSync } from '../hooks/useChatSync';

const UseCaseViewPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [useCase, setUseCase] = useState<UseCaseDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const { agents } = useCatalog();

    async function fetchUseCase() {
        if (!id) return;
        setLoading(true);
        setError(null);
        try {
            console.log(`[UseCaseViewPage] Fetching detail for: ${id}...`);
            const data = await mcpClient.getUseCaseDetails(id);
            if (!data) throw new Error('Use Case not found');
            setUseCase(data);
        } catch (err: any) {
            console.error('[UseCaseViewPage] Error:', err);
            setError(err.message || 'Failed to load use case details');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        fetchUseCase();
    }, [id]);

    // ── Chat sync ──────────────────────────────────────────────────────────────
    useChatSync('use_case_detail', useCase ? {
        useCaseId:    useCase.identifier ?? (useCase as any).id ?? '',
        title:        (useCase as any).name ?? (useCase as any).title ?? '',
        description:  useCase.description ?? undefined,
        status:       (useCase as any).status,
        priority:     (useCase as any).priority,
        linkedAgents: ((useCase as any).agents ?? []).map((a: any) => a.name ?? a).filter(Boolean),
    } : null);

    return (
        <div className="flex flex-col gap-6 w-full animate-fade-in pb-12">
            {/* Top bar */}
            <div className="flex items-center justify-between">
                <button
                    onClick={() => navigate('/use-cases')}
                    className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 transition-all bg-transparent border-none cursor-pointer"
                >
                    <ArrowLeft size={16} /> Back to Use Cases
                </button>

            </div>

            {/* Loading */}
            {loading && (
                <div className="flex flex-col justify-center items-center min-h-[50vh] gap-3 text-slate-400">
                    <RefreshCw size={22} className="animate-spin" />
                    <span className="text-sm">Loading use case details…</span>
                </div>
            )}

            {/* Error */}
            {!loading && error && (
                <div className="flex flex-col justify-center items-center min-h-[50vh] gap-4">
                    <div className="flex items-start gap-3 text-red-500 bg-red-50 border border-red-200 rounded-xl px-6 py-4 max-w-lg">
                        <AlertCircle size={20} className="mt-0.5 shrink-0" />
                        <div>
                            <p className="font-bold text-sm">Could not load use case</p>
                            <p className="text-xs mt-1 text-red-400">{error}</p>
                        </div>
                    </div>
                    <button
                        onClick={() => navigate('/use-cases')}
                        className="text-sm font-medium text-violet-600 hover:underline"
                    >
                        Return to Use Case Catalog
                    </button>
                </div>
            )}

            {/* Detail view */}
            {!loading && !error && useCase && (
                <UseCaseView
                    useCase={useCase}
                    agentsComponent={
                        <AgentsSection
                            useCase={useCase}
                            agents={agents}
                            onRefetch={fetchUseCase}
                        />
                    }
                />
            )}
        </div>
    );
};

export default UseCaseViewPage;
