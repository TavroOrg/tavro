import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  List,
  LayoutGrid,
  Search,
  Workflow,
} from 'lucide-react';
import { businessRelationsApi } from '../services/businessRelationsApi';
import type { BusinessProcessRecord } from '../types/businessRelations';

const PAGE_SIZE = 10;

const BusinessProcessesPage: React.FC = () => {
  const navigate = useNavigate();
  const [processes, setProcesses] = useState<BusinessProcessRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await businessRelationsApi.listProcesses();
        setProcesses(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load business processes');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return processes;
    return processes.filter(proc =>
      proc.business_process_id.toLowerCase().includes(q) ||
      (proc.process_name ?? '').toLowerCase().includes(q) ||
      (proc.process_description ?? '').toLowerCase().includes(q) ||
      (proc.owner ?? '').toLowerCase().includes(q)
    );
  }, [processes, search]);

  const isSearching = search.trim().length > 0;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = isSearching
    ? filtered
    : filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const handlePrev = () => setPage(p => Math.max(1, p - 1));
  const handleNext = () => setPage(p => Math.min(totalPages, p + 1));

  return (
    <div className="flex flex-col gap-6 w-full animate-fade-in max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Business Processes</h2>
          <p className="text-sm text-slate-500">
            {loading
              ? 'Loading processes...'
              : isSearching
                ? `${filtered.length} results for "${search}"`
                : `Page ${page} of ${totalPages} - ${filtered.length} processes`}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap justify-end">
          <div className="relative w-full max-w-md min-w-[280px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search processes..."
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              title="Grid View"
            >
              <LayoutGrid size={18} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-lg transition-all ${viewMode === 'list' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              title="List View"
            >
              <List size={18} />
            </button>
          </div>

          {!isSearching && (
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrev}
                disabled={page === 1}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <ChevronLeft size={16} /> Prev
              </button>
              <span className="px-3 py-2 text-sm font-bold text-slate-600 bg-slate-100 rounded-lg min-w-[3rem] text-center">
                {page}
              </span>
              <button
                onClick={handleNext}
                disabled={page >= totalPages}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 text-red-500 bg-red-50 border border-red-200 rounded-xl px-6 py-4">
          <AlertCircle size={20} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-bold text-sm">Could not load processes</p>
            <p className="text-xs mt-1 text-red-400">{error}</p>
          </div>
        </div>
      )}

      {!error && viewMode === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {paged.map(proc => (
            <button
              key={proc.business_process_id}
              onClick={() => navigate(`/processes/${encodeURIComponent(proc.business_process_id)}`)}
              className="text-left bg-white rounded-2xl border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all overflow-hidden"
            >
              <div className="h-2 bg-gradient-to-r from-emerald-600 to-teal-500" />
              <div className="p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">
                      {proc.process_name || proc.business_process_id}
                    </p>
                    <p className="text-[11px] font-mono text-slate-400 truncate">
                      {proc.business_process_id}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
                    <BriefcaseBusiness size={10} /> {proc.related_agent_count}
                  </span>
                </div>

                <p className="text-xs text-slate-600 line-clamp-3 min-h-[3.25rem]">
                  {proc.process_description || 'No description available.'}
                </p>

                <div className="flex items-center gap-2 flex-wrap">
                  {proc.business_criticality && (
                    <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                      {proc.business_criticality}
                    </span>
                  )}
                  {proc.related_processes.length > 0 && (
                    <span className="text-[10px] font-semibold bg-cyan-50 text-cyan-700 border border-cyan-200 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                      <Workflow size={10} /> {proc.related_processes.length} linked
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {!error && viewMode === 'list' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="grid grid-cols-[1.6fr_1fr_150px_120px_150px_48px] items-center bg-slate-50 border-b border-slate-200 px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">
            <div>Process</div>
            <div>Owner</div>
            <div>Criticality</div>
            <div>Related Agents</div>
            <div>Related Processes</div>
            <div></div>
          </div>
          <div className="divide-y divide-slate-100">
            {paged.map(proc => (
              <button
                key={proc.business_process_id}
                onClick={() => navigate(`/processes/${encodeURIComponent(proc.business_process_id)}`)}
                className="grid grid-cols-[1.6fr_1fr_150px_120px_150px_48px] items-center px-6 py-4 hover:bg-slate-50 text-left transition-colors group w-full"
              >
                <div className="min-w-0">
                  <p className="font-bold text-slate-800 text-sm truncate">{proc.process_name || proc.business_process_id}</p>
                  <p className="text-[10px] font-mono text-slate-400 truncate">{proc.business_process_id}</p>
                </div>
                <div className="text-sm text-slate-500 truncate">{proc.owner || 'N/A'}</div>
                <div>
                  <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                    {proc.business_criticality || 'N/A'}
                  </span>
                </div>
                <div className="text-sm font-semibold text-emerald-700">{proc.related_agent_count}</div>
                <div className="text-sm font-semibold text-cyan-700">{proc.related_processes.length}</div>
                <ChevronRight size={18} className="text-slate-300 group-hover:text-emerald-500 transition-colors" />
              </button>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && paged.length === 0 && (
        <div className="py-20 flex flex-col items-center justify-center gap-4 text-slate-500 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
          <div className="p-4 bg-white rounded-full shadow-sm">
            <Workflow size={32} className="text-slate-300" />
          </div>
          <p className="font-medium text-lg">No processes found</p>
        </div>
      )}

      {!isSearching && !loading && !error && filtered.length > 0 && (
        <div className="flex justify-center items-center gap-2 pb-4">
          <button
            onClick={handlePrev}
            disabled={page === 1}
            className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <ChevronLeft size={16} /> Previous
          </button>
          <span className="text-sm text-slate-500 px-3">Page {page}</span>
          <button
            onClick={handleNext}
            disabled={page >= totalPages}
            className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Next <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
};

export default BusinessProcessesPage;
