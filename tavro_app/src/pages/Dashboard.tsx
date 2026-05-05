import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { AgentData } from '../types/agent';
import { mcpClient } from '../services/mcpClient';
import { useCatalog } from '../context/CatalogContext';
import AgentCatalog from '../components/AgentCatalog';

/** Server-enforced page size (max_records). */
const PAGE_SIZE = 10;

import { useChatSync } from '../hooks/useChatSync';

const Dashboard: React.FC = () => {
    useChatSync('agent_catalog', null);
    // ── Paged fetch state (used when no search term is active) ──────────────
    const [pagedAgents, setPagedAgents] = useState<AgentData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [totalRecords, setTotalRecords] = useState<number | null>(null);

    // ── Search across the full cached catalog ───────────────────────────────
    const [searchTerm, setSearchTerm] = useState('');
    const { agents: allAgents } = useCatalog();

    const navigate = useNavigate();

    /** True when there is at least one more page after the current one. */
    const hasMore = totalRecords !== null
        ? page * PAGE_SIZE < totalRecords
        : false;

    const fetchPage = useCallback(async (pageNum: number) => {
        setLoading(true);
        setError(null);
        try {
            const startRecord = (pageNum - 1) * PAGE_SIZE + 1;
            console.log(`[Dashboard] Fetching page ${pageNum} (start_record=${startRecord})...`);
            const { agents: agentsData, totalRecords: total } = await mcpClient.getCatalogPage(startRecord);
            setPagedAgents(agentsData);
            setTotalRecords(total);
            console.log(`[Dashboard] Got ${agentsData.length} agents (total_records=${total})`);
        } catch (err: any) {
            console.error('[Dashboard] Error:', err);
            setError(err.message || 'Failed to load agent catalog');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchPage(page);
    }, [page, fetchPage]);

    // When the user clears the search, reset to page 1
    useEffect(() => {
        if (!searchTerm) setPage(1);
    }, [searchTerm]);

    const handleSelectAgent = (agent: AgentData) => {
        const id = agent.identification?.agent_id || agent.name;
        navigate(`/agent/${encodeURIComponent(id)}`);
    };

    const handlePrev = () => { if (page > 1) setPage(p => p - 1); };
    const handleNext = () => { if (hasMore) setPage(p => p + 1); };

    const isSearching = searchTerm.trim().length > 0;
    const displayedAgents = isSearching
        ? allAgents.filter(a =>
            a.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            a.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            a.identification?.agent_id?.toLowerCase().includes(searchTerm.toLowerCase())
        )
        : pagedAgents;

    return (
        <div className="flex flex-col gap-6 w-full animate-fade-in max-w-[1600px] mx-auto">

            {/* Header row: title + pagination (hidden during search) */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-slate-800">Agent Catalog</h2>
                    <p className="text-sm text-slate-500">
                        {isSearching
                            ? `${displayedAgents.length} result${displayedAgents.length !== 1 ? 's' : ''} for "${searchTerm}" across all ${allAgents.length} agents`
                            : loading && pagedAgents.length === 0
                                ? 'Loading…'
                                : `Page ${page}${totalRecords !== null ? ` of ${Math.ceil(totalRecords / PAGE_SIZE)}` : ''} · ${pagedAgents.length} agents${totalRecords !== null ? ` of ${totalRecords} total` : ''}`
                        }
                    </p>
                </div>

                {/* Pagination controls — only shown when NOT searching */}
                {!isSearching && (
                    <div className="flex items-center gap-2">
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

            {/* Error State */}
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
                        onClick={() => fetchPage(page)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition-all"
                    >
                        <RefreshCw size={14} /> Retry
                    </button>
                </div>
            )}

            {/* Catalog (search or paged) */}
            {!error && (
                <AgentCatalog
                    agents={displayedAgents}
                    searchTerm={searchTerm}
                    onSearchChange={setSearchTerm}
                    onSelectAgent={handleSelectAgent}
                />
            )}

            {/* Bottom Pagination — hidden during search */}
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
    );
};

export default Dashboard;
