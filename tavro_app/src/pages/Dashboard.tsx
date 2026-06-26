import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, RefreshCw, ChevronLeft, ChevronRight, Plus, FolderUp } from 'lucide-react';
import { AgentData } from '../types/agent';
import { useCatalog } from '../context/CatalogContext';
import { toUserMessage } from '../utils/errorUtils';
import AgentCatalog from '../components/AgentCatalog';
import LoadAgentsModal from '../components/LoadAgentsModal';
import TimedInfoToast from '../components/TimedInfoToast';
import { useChatSync } from '../hooks/useChatSync';
import { useBlueprint } from '../context/BlueprintContext';
import { agentApi } from '../services/agentApi';
import { fetchPagesProgressive } from '../utils/fetchAllPages';

const PAGE_SIZE = 10;

const getAgentProviderSearchText = (agent: AgentData): string => {
  const rawProvider = (agent as any).provider;

  if (typeof rawProvider === 'string') return rawProvider;

  return [
    rawProvider?.organization,
    rawProvider?.name,
    rawProvider?.url,
    (agent as any).source_system,
    (agent as any).provider_name,
    (agent as any).primary_ai_model_provider,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
};

const normalizeAgent = (item: any): AgentData => ({
    ...item,
    name: item.name || item.agent_name || 'Unnamed Agent',
    description: item.description || item.agent_description || item.summary || '',
    version: item.version || '1.0',
    identification: {
        ...item.identification,
        agent_id: item.identification?.agent_id || item.agent_id || 'Unknown',
        role: item.identification?.role || item.role || null,
        instruction: item.identification?.instruction || item.instruction || null,
        owner: item.identification?.owner || item.owner || item.agent_owner || undefined,
        environment: item.identification?.environment || item.environment || undefined,
        governance_status: item.identification?.governance_status || item.latest_event_status || undefined,
    },
    configuration: item.configuration || { autonomy_level: item.autonomy_level ?? null },
    tool: item.tool || [],
    data_source: item.data_source || [],
    application: item.application || [],
    business_process: item.business_process || [],
    risk_assessment: item.risk_assessment || null,
});

const Dashboard: React.FC = () => {
    useChatSync('agent_catalog', null);

    const [page, setPage] = useState(1);
    const [searchTerm, setSearchTerm] = useState('');
    const [showLoadModal, setShowLoadModal] = useState(false);
    const { refresh } = useCatalog();
    const { activeCompany } = useBlueprint();
    const [allAgents, setAllAgents] = useState<AgentData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const navigate = useNavigate();

    // Prevents overlapping concurrent fetches (e.g. rapid workflow update events).
    const isFetchingRef = useRef(false);
    // Tracks whether any agent is currently showing "Risk Assessment is running" so the
    // workflow-update listener knows whether a re-fetch is worthwhile.
    const hasPendingAgentRef = useRef(false);

    const loadAgents = useCallback(async () => {
        if (isFetchingRef.current) return;
        isFetchingRef.current = true;
        setLoading(true);
        setError(null);

        // Read the set of locally-pending agent IDs once per fetch so the status is
        // preserved across navigations. CatalogContext maintains this list and removes
        // entries only when the corresponding Temporal workflow finishes.
        let locallyPendingIds: Set<string>;
        try {
            const raw = localStorage.getItem('tavro_pending_assessment_agents');
            locallyPendingIds = new Set(raw ? (JSON.parse(raw) as string[]) : []);
        } catch {
            locallyPendingIds = new Set();
        }

        const applyPendingStatus = (agent: AgentData): AgentData => {
            const agentId = (agent.identification?.agent_id ?? '').toLowerCase().trim();
            if (!agentId || !locallyPendingIds.has(agentId)) return agent;
            return {
                ...agent,
                latest_risk_score: null,
                latest_risk_class: null,
                risk_assessment: null,
                identification: { ...agent.identification, governance_status: 'Risk Assessment is running' },
            };
        };

        try {
            await fetchPagesProgressive(
                (start, range) => agentApi.getAgentCatalog(start, range, activeCompany?.id),
                (batch, isFirstPage) => {
                    const normalized = batch.map(normalizeAgent).map(applyPendingStatus);
                    if (isFirstPage) {
                        setAllAgents(normalized);
                        setLoading(false);
                    } else {
                        setAllAgents(prev => {
                            const ids = new Set(prev.map((a: AgentData) => a.identification?.agent_id).filter(Boolean));
                            return [...prev, ...normalized.filter((a: AgentData) => !ids.has(a.identification?.agent_id))];
                        });
                    }
                },
                100,
            );
        } catch (err: unknown) {
            setError(toUserMessage(err));
        } finally {
            setLoading(false);
            isFetchingRef.current = false;
        }
    }, [activeCompany?.id]);

    useEffect(() => {
        loadAgents();
    }, [loadAgents]);

    // Keep the pending-agent ref in sync so the workflow listener below can cheaply
    // decide whether a re-fetch is needed without reading state inside the handler.
    useEffect(() => {
        hasPendingAgentRef.current = allAgents.some(
            a => a.identification?.governance_status === 'Risk Assessment is running'
        );
    }, [allAgents]);

    // When a Temporal workflow finishes, CatalogContext removes the agent from
    // tavro_pending_assessment_agents and fires this event. Re-fetch so the grid
    // picks up the completed risk assessment and clears the "running" badge.
    useEffect(() => {
        const handler = () => {
            if (hasPendingAgentRef.current) loadAgents();
        };
        window.addEventListener('tavro_temporal_workflow_update', handler);
        return () => window.removeEventListener('tavro_temporal_workflow_update', handler);
    }, [loadAgents]);

    // When the AI assistant creates an agent, add it to the list immediately
    // so the user sees it with "Risk Assessment is running" without waiting for
    // the next full reload. Dashboard owns its own allAgents state (it isn't
    // driven by CatalogContext) so it must handle this event itself.
    useEffect(() => {
        const handleAgentCreated = (event: Event) => {
            const { result, args } = (event as CustomEvent).detail ?? {};
            const agentId: string | undefined =
                result?.agent_id ||
                result?.identification?.agent_id ||
                result?.agent_card?.agent_id ||
                result?.agent_card?.identification?.agent_id;
            if (!agentId) return;
            const agentName: string = args?.agent_name || result?.agent_name || result?.name || agentId;
            const optimistic: AgentData = {
                name: agentName,
                description: args?.description || result?.description || agentName,
                version: '1.0',
                identification: {
                    agent_id: agentId,
                    role: null,
                    instruction: args?.instruction || null,
                    governance_status: 'Risk Assessment is running',
                },
                configuration: { autonomy_level: null },
                tool: [],
                data_source: [],
                application: [],
                business_process: [],
                risk_assessment: null,
            };
            setAllAgents(prev => {
                const ids = new Set(prev.map((a: AgentData) => a.identification?.agent_id).filter(Boolean));
                if (ids.has(agentId)) return prev;
                return [optimistic, ...prev];
            });
            setPage(1); // Jump to page 1 so the new agent is visible at the top
        };
        window.addEventListener('tavro:agent-created', handleAgentCreated);
        return () => window.removeEventListener('tavro:agent-created', handleAgentCreated);
    }, []);

    const totalPages = Math.max(1, Math.ceil(allAgents.length / PAGE_SIZE));
    const hasMore = page < totalPages;

    useEffect(() => {
        if (!searchTerm) setPage(1);
    }, [searchTerm]);

    useEffect(() => {
        if (page > totalPages) setPage(totalPages);
    }, [page, totalPages]);

    const handleSelectAgent = (agent: AgentData) => {
        const id = agent.identification?.agent_id || agent.name;
        navigate(`/agent/${encodeURIComponent(id)}`);
    };

    const handlePrev = () => { if (page > 1) setPage(p => p - 1); };
    const handleNext = () => { if (hasMore) setPage(p => p + 1); };

    const isSearching = searchTerm.trim().length > 0;

    const pagedAgents = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return allAgents.slice(start, start + PAGE_SIZE);
    }, [allAgents, page]);

    const query = searchTerm.trim().toLowerCase();

    const displayedAgents = isSearching
    ? allAgents.filter((a) =>
        a.name?.toLowerCase().includes(query) ||
        a.description?.toLowerCase().includes(query) ||
        getAgentProviderSearchText(a).includes(query) ||
        a.identification?.agent_id?.toLowerCase().includes(query)
        )
    : pagedAgents;

    return (
        <>
        <div className="flex flex-col gap-6 w-full animate-fade-in max-w-[1600px] mx-auto">
            <TimedInfoToast storageKey="tavro_catalog_notice" />

            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-slate-800">Agent Catalog</h2>
                    <p className="text-sm text-slate-500">
                        {isSearching
                            ? `${displayedAgents.length} result${displayedAgents.length !== 1 ? 's' : ''} for "${searchTerm}" across all ${allAgents.length} agents`
                            : loading && pagedAgents.length === 0
                                ? 'Loading...'
                                : `Page ${page} of ${totalPages} - ${pagedAgents.length} agents${allAgents.length ? ` of ${allAgents.length} total` : ''}`
                        }
                    </p>
                </div>

                {!isSearching && (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowLoadModal(true)}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-all"
                        >
                            <FolderUp size={16} /> Load Agents
                        </button>
                        <button
                            onClick={() => navigate('/agents/new')}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-sm"
                        >
                            <Plus size={16} /> New Agent
                        </button>
                        <button
                            onClick={handlePrev}
                            disabled={page === 1 || loading}
                            className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                            <ChevronLeft size={16} /> Prev
                        </button>
                        <span className="px-3 py-2 text-sm font-bold text-slate-600 bg-slate-100 rounded-lg min-w-[3rem] text-center">
                            {page}
                        </span>
                        <button
                            onClick={handleNext}
                            disabled={!hasMore || loading}
                            className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                            Next <ChevronRight size={16} />
                        </button>
                    </div>
                )}
            </div>

            {!loading && error && (
                <div className="flex flex-col justify-center items-center min-h-[40vh] gap-4">
                    <div className="flex items-start gap-3 text-red-500 bg-red-50 border border-red-200 rounded-xl px-6 py-4 max-w-lg">
                        <AlertCircle size={20} className="mt-0.5 shrink-0" />
                        <div>
                            <p className="font-bold text-sm">Failed to load catalog</p>
                            <p className="text-xs mt-1 text-red-400">{error}</p>
                        </div>
                    </div>
                    <button
                        onClick={() => { refresh(); loadAgents(); }}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition-all"
                    >
                        <RefreshCw size={14} /> Retry
                    </button>
                </div>
            )}

            {!error && (
                <AgentCatalog
                    agents={displayedAgents}
                    searchTerm={searchTerm}
                    onSearchChange={setSearchTerm}
                    onSelectAgent={handleSelectAgent}
                />
            )}

            {!isSearching && !loading && !error && pagedAgents.length > 0 && (
                <div className="flex justify-center items-center gap-2 pb-4">
                    <button onClick={handlePrev} disabled={page === 1}
                        className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                        <ChevronLeft size={16} /> Previous
                    </button>
                    <span className="text-sm text-slate-500 px-3">Page {page}</span>
                    <button onClick={handleNext} disabled={!hasMore}
                        className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                        Next <ChevronRight size={16} />
                    </button>
                </div>
            )}
        </div>

        {showLoadModal && (
            <LoadAgentsModal
                onClose={() => setShowLoadModal(false)}
                companyId={activeCompany?.id}
                companyName={activeCompany?.name}
                onSuccess={() => {
                    refresh();
                    loadAgents();
                    setTimeout(() => setShowLoadModal(false), 3000);
                }}
            />
        )}
        </>
    );
};

export default Dashboard;
