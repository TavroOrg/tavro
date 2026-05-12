import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, BriefcaseBusiness, Search, Workflow } from 'lucide-react';
import { businessRelationsApi } from '../services/businessRelationsApi';
import type { BusinessProcessRecord } from '../types/businessRelations';

const BusinessProcessesPage: React.FC = () => {
  const navigate = useNavigate();
  const [processes, setProcesses] = useState<BusinessProcessRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

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

  return (
    <div className="flex flex-col gap-6 w-full animate-fade-in max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Business Processes</h2>
          <p className="text-sm text-slate-500">
            {loading ? 'Loading processes...' : `${filtered.length} processes`}
          </p>
        </div>

        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search processes..."
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
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

      {!error && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map(proc => (
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

      {!loading && !error && filtered.length === 0 && (
        <div className="py-20 flex flex-col items-center justify-center gap-4 text-slate-500 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
          <div className="p-4 bg-white rounded-full shadow-sm">
            <Workflow size={32} className="text-slate-300" />
          </div>
          <p className="font-medium text-lg">No processes found</p>
        </div>
      )}
    </div>
  );
};

export default BusinessProcessesPage;
