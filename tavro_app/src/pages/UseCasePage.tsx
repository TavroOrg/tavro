import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, RefreshCw, ChevronLeft, ChevronRight, Plus, FolderUp } from 'lucide-react';
import UseCaseCatalog from '../components/UseCaseCatalog';
import LoadAIUseCaseModal from '../components/LoadAIUseCaseModal';
import TimedInfoToast from '../components/TimedInfoToast';
import { useChatSync } from '../hooks/useChatSync';
import { useBlueprint } from '../context/BlueprintContext';
import { useCaseApi } from '../services/useCaseApi';
import { fetchPagesProgressive } from '../utils/fetchAllPages';

const PAGE_SIZE = 10;

const UseCasePage: React.FC = () => {
    useChatSync('use_case_catalog', null);

    const [page, setPage] = useState(1);
    const [searchTerm, setSearchTerm] = useState('');
    const [showLoadModal, setShowLoadModal] = useState(false);
    const { activeCompany } = useBlueprint();
    const [allUseCases, setAllUseCases] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const navigate = useNavigate();
    const location = useLocation();

    const loadUseCases = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const normalizeItem = (item: any) => ({
                ...item,
                id: item.id ?? item.use_case_id,
                identifier: item.identifier ?? item.use_case_id,
                name: item.name ?? item.title ?? item.use_case_name,
                description: item.description ?? item.short_description,
                status: item.status ?? item.state,
                owner: item.owner ?? item.use_case_owner,
                function: item['function'] ?? item.business_function,
                priority: item.priority,
            });
            await fetchPagesProgressive(
                (start, range) => useCaseApi.listUseCases({ startRecord: start, recordRange: range, companyId: activeCompany?.id }),
                (batch, isFirstPage) => {
                    const normalized = batch.map(normalizeItem);
                    if (isFirstPage) {
                        setAllUseCases(normalized);
                        setLoading(false);
                    } else {
                        setAllUseCases(prev => {
                            const ids = new Set(prev.map((u: any) => u.identifier).filter(Boolean));
                            return [...prev, ...normalized.filter((u: any) => !ids.has(u.identifier))];
                        });
                    }
                },
                100,
            );
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to load use case catalog');
        } finally {
            setLoading(false);
        }
    }, [activeCompany?.id]);

    useEffect(() => { loadUseCases(); }, [loadUseCases]);

    useEffect(() => {
        const incomingPage = Number((location.state as any)?.page);
        if (Number.isFinite(incomingPage) && incomingPage > 0) {
            setPage(incomingPage);
            navigate(location.pathname, { replace: true, state: null });
        }
    }, [location.pathname, location.state, navigate]);

    const totalPages = Math.max(1, Math.ceil(allUseCases.length / PAGE_SIZE));
    const hasMore = page < totalPages;

    useEffect(() => {
        if (!searchTerm) setPage(1);
    }, [searchTerm]);

    useEffect(() => {
        if (page > totalPages) setPage(totalPages);
    }, [page, totalPages]);

    const handlePrev = () => { if (page > 1) setPage(p => p - 1); };
    const handleNext = () => { if (hasMore) setPage(p => p + 1); };

    const isSearching = searchTerm.trim().length > 0;

    const pagedUseCases = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return allUseCases.slice(start, start + PAGE_SIZE);
    }, [allUseCases, page]);

    const displayedUseCases = isSearching
        ? allUseCases.filter(uc =>
            uc.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            uc.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            uc.owner?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            uc.function?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            uc.identifier?.toLowerCase().includes(searchTerm.toLowerCase())
        )
        : pagedUseCases;

    return (
        <>
        <div className="flex flex-col gap-6 w-full animate-fade-in max-w-[1600px] mx-auto">
            <TimedInfoToast storageKey="tavro_use_case_notice" />

            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-slate-800">AI Use Case Catalog</h2>
                    <p className="text-sm text-slate-500">
                        {isSearching
                            ? `${displayedUseCases.length} result${displayedUseCases.length !== 1 ? 's' : ''} for "${searchTerm}" across all ${allUseCases.length} use cases`
                            : loading && pagedUseCases.length === 0
                                ? 'Loading...'
                                : `Page ${page} of ${totalPages} - ${pagedUseCases.length} use cases of ${allUseCases.length} total`
                        }
                    </p>
                </div>

                {!isSearching && (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowLoadModal(true)}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-all"
                        >
                            <FolderUp size={16} /> Load AI Use Case
                        </button>
                        <button
                            onClick={() => navigate('/use-cases/new')}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-sm"
                        >
                            <Plus size={16} /> New Use Case
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
                            <p className="font-bold text-sm">Failed to load Use Case catalog</p>
                            <p className="text-xs mt-1 text-red-400">{error}</p>
                        </div>
                    </div>
                    <button
                        onClick={loadUseCases}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition-all"
                    >
                        <RefreshCw size={14} /> Retry
                    </button>
                </div>
            )}

            {!error && (
                <UseCaseCatalog
                    useCases={displayedUseCases}
                    searchTerm={searchTerm}
                    onSearchChange={setSearchTerm}
                    currentPage={page}
                />
            )}

            {!isSearching && !loading && !error && pagedUseCases.length > 0 && (
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
            <LoadAIUseCaseModal
                onClose={() => setShowLoadModal(false)}
                companyId={activeCompany?.id}
                companyName={activeCompany?.name}
                onSuccess={() => {
                    loadUseCases();
                    setTimeout(() => setShowLoadModal(false), 3000);
                }}
            />
        )}
        </>
    );
};

export default UseCasePage;
