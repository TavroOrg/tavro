import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Grid2X2, Layers, Search } from 'lucide-react';
import { businessRelationsApi } from '../services/businessRelationsApi';
import type { BusinessApplicationRecord } from '../types/businessRelations';

const BusinessApplicationsPage: React.FC = () => {
  const navigate = useNavigate();
  const [applications, setApplications] = useState<BusinessApplicationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await businessRelationsApi.listApplications();
        setApplications(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load business applications');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return applications;
    return applications.filter(app =>
      app.business_application_id.toLowerCase().includes(q) ||
      (app.application_name ?? '').toLowerCase().includes(q) ||
      (app.application_description ?? '').toLowerCase().includes(q) ||
      (app.business_owner ?? '').toLowerCase().includes(q)
    );
  }, [applications, search]);

  return (
    <div className="flex flex-col gap-6 w-full animate-fade-in max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Business Applications</h2>
          <p className="text-sm text-slate-500">
            {loading ? 'Loading applications...' : `${filtered.length} applications`}
          </p>
        </div>

        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search applications..."
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 text-red-500 bg-red-50 border border-red-200 rounded-xl px-6 py-4">
          <AlertCircle size={20} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-bold text-sm">Could not load applications</p>
            <p className="text-xs mt-1 text-red-400">{error}</p>
          </div>
        </div>
      )}

      {!error && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map(app => (
            <button
              key={app.business_application_id}
              onClick={() => navigate(`/applications/${encodeURIComponent(app.business_application_id)}`)}
              className="text-left bg-white rounded-2xl border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all overflow-hidden"
            >
              <div className="h-2 bg-gradient-to-r from-blue-600 to-cyan-500" />
              <div className="p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">
                      {app.application_name || app.business_application_id}
                    </p>
                    <p className="text-[11px] font-mono text-slate-400 truncate">
                      {app.business_application_id}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
                    <Layers size={10} /> {app.related_agent_count}
                  </span>
                </div>

                <p className="text-xs text-slate-600 line-clamp-3 min-h-[3.25rem]">
                  {app.application_description || 'No description available.'}
                </p>

                <div className="flex items-center gap-2 flex-wrap">
                  {app.business_criticality && (
                    <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                      {app.business_criticality}
                    </span>
                  )}
                  {app.emergency_tier && (
                    <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-full">
                      {app.emergency_tier}
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
            <Grid2X2 size={32} className="text-slate-300" />
          </div>
          <p className="font-medium text-lg">No applications found</p>
        </div>
      )}
    </div>
  );
};

export default BusinessApplicationsPage;
