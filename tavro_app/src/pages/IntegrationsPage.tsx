import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Network,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Grid2X2,
  LayoutGrid,
  List,
  Plus,
  Search,
  Bot,
  Upload,
} from 'lucide-react';
import { businessRelationsApi } from '../services/businessRelationsApi';
import type { IntegrationRecord } from '../types/businessRelations';
import { useCatalog } from '../context/CatalogContext';
import { useBlueprint } from '../context/BlueprintContext';
import { toUserMessage } from '../utils/errorUtils';
import LoadIntegrationsModal from '../components/LoadIntegrationsModal';

const PAGE_SIZE = 10;

const getAvailabilityMeta = (status: string | null | undefined) => {
  const normalized = (status ?? '').trim().toLowerCase();
  if (normalized === 'active') {
    return { className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  }
  if (normalized === 'deprecated') {
    return { className: 'bg-red-50 text-red-700 border-red-200' };
  }
  if (normalized === 'planned') {
    return { className: 'bg-amber-50 text-amber-700 border-amber-200' };
  }
  return { className: 'bg-slate-50 text-slate-600 border-slate-200' };
};

const IntegrationsPage: React.FC = () => {
  const navigate = useNavigate();
  const { loading: catalogLoading, error: catalogError, lastFetched } = useCatalog();
  const { activeCompany } = useBlueprint();
  const [integrations, setIntegrations] = useState<IntegrationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [page, setPage] = useState(1);
  const [showUploadModal, setShowUploadModal] = useState(false);

  useEffect(() => {
    if (catalogLoading) {
      setLoading(true);
      return;
    }

    if (catalogError || !lastFetched) {
      setIntegrations([]);
      setLoading(false);
      setError(
        catalogError
          ? `MCP connection required before loading integrations. ${catalogError}`
          : 'MCP connection required before loading integrations. Connect from Settings and refresh catalog.',
      );
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await businessRelationsApi.listIntegrations(undefined, activeCompany?.id);
        setIntegrations(data);
      } catch (err: unknown) {
        setError(toUserMessage(err));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [catalogLoading, catalogError, lastFetched, activeCompany?.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return integrations;
    return integrations.filter(item =>
      item.integration_id.toLowerCase().includes(q) ||
      (item.integration_name ?? '').toLowerCase().includes(q) ||
      (item.integration_description ?? '').toLowerCase().includes(q) ||
      (item.owner ?? '').toLowerCase().includes(q) ||
      (item.protocol ?? '').toLowerCase().includes(q),
    );
  }, [integrations, search]);

  const isSearching = search.trim().length > 0;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const hasMore = page < totalPages;
  const paged = isSearching
    ? filtered
    : filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    if (!isSearching) return;
    setPage(1);
  }, [isSearching]);

  const handlePrev = () => setPage(prev => Math.max(1, prev - 1));
  const handleNext = () => setPage(prev => Math.min(totalPages, prev + 1));

  return (
    <div className="flex flex-col gap-6 w-full animate-fade-in max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Integrations</h2>
          <p className="text-sm text-slate-500">
            {isSearching
              ? `${filtered.length} result${filtered.length !== 1 ? 's' : ''} for "${search}" across all ${integrations.length} integrations`
              : loading
                ? 'Loading...'
                : `Page ${page} of ${totalPages} · ${paged.length} integrations of ${filtered.length} total`}
          </p>
        </div>

        {!isSearching && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowUploadModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-all shadow-sm"
            >
              <Upload size={16} />
              Load Integrations
            </button>
            <button
              onClick={() => navigate('/integrations/new')}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-sm"
            >
              <Plus size={16} />
              New Integration
            </button>
            <button
              onClick={handlePrev}
              disabled={page === 1 || loading}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft size={16} />
              Prev
            </button>
            <span className="px-3 py-2 text-sm font-bold text-slate-600 bg-slate-100 rounded-lg min-w-[3rem] text-center">
              {page}
            </span>
            <button
              onClick={handleNext}
              disabled={!hasMore || loading}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              Next
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {!error && (
        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search integrations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-slate-800"
            />
          </div>

          <div className="flex items-center gap-4">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest hidden sm:block">
              Showing {paged.length} Results
            </div>
            <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                title="Grid View"
              >
                <LayoutGrid size={18} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-lg transition-all ${viewMode === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                title="List View"
              >
                <List size={18} />
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 text-red-500 bg-red-50 border border-red-200 rounded-xl px-6 py-4">
          <AlertCircle size={20} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-bold text-sm">Could not load integrations</p>
            <p className="text-xs mt-1 text-red-400">{error}</p>
          </div>
        </div>
      )}

      {!error && viewMode === 'grid' && (
        <div
          key={isSearching ? 'search-grid' : 'paged-grid'}
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
        >
          {paged.map(item => {
            const availMeta = getAvailabilityMeta(item.availability_status);
            return (
              <button
                key={item.integration_id}
                onClick={() => navigate(`/integrations/${encodeURIComponent(item.integration_id)}`)}
                className="group text-left bg-white rounded-2xl border border-slate-200 hover:border-blue-400 hover:shadow-lg transition-all overflow-hidden flex flex-col h-full"
              >
                <div className="h-2 bg-gradient-to-r from-violet-500 to-blue-600" />

                <div className="p-5 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="p-2 bg-violet-50 text-violet-600 rounded-xl group-hover:scale-110 transition-transform">
                      <Network size={20} />
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      <span className="inline-flex items-center gap-1 text-xs font-bold px-3 h-8 rounded-full bg-slate-50 text-slate-600 border border-slate-200">
                        ARE: {item.agent_risk_exposure ?? 0}
                      </span>
                      <span className={`inline-flex items-center gap-1 text-xs font-bold px-3 h-8 rounded-full border ${
                        item.agent_risk_tier === 'Critical' || item.agent_risk_tier === 'High'
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : item.agent_risk_tier === 'Medium'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : item.agent_risk_tier === 'Low'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-slate-50 text-slate-500 border-slate-200'
                      }`}>
                        ART: {item.agent_risk_tier ?? 'None'}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs font-bold px-3 h-8 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                        <Bot size={20} /> {item.related_agent_count ?? 0}
                      </span>
                    </div>
                  </div>

                  <h3 className="font-bold text-slate-800 group-hover:text-blue-600 transition-colors line-clamp-1 mb-1">
                    {item.integration_name || item.integration_id}
                  </h3>
                  <p className="text-[11px] font-mono text-slate-400 truncate mb-2">
                    {item.integration_id}
                  </p>

                  <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed mb-4 flex-1">
                    {item.integration_description || 'No description available.'}
                  </p>

                  <div className="flex items-center gap-2 flex-wrap mt-auto">
                    {item.protocol && (
                      <span className="inline-flex items-center text-[10px] font-bold px-2 py-1 rounded-md border bg-violet-50 text-violet-700 border-violet-200">
                        {item.protocol}
                      </span>
                    )}
                    {item.data_sensitivity && (
                      <span className="inline-flex items-center text-[10px] font-bold px-2 py-1 rounded-md border bg-slate-50 text-slate-600 border-slate-200">
                        {item.data_sensitivity}
                      </span>
                    )}
                  </div>
                </div>

                <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  <span>{item.owner ? `Owner: ${item.owner}` : `ID: ${item.integration_id.slice(0, 8)}`}</span>
                  <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!error && viewMode === 'list' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="grid grid-cols-[1.6fr_1fr_120px_140px_100px_80px_100px_48px] items-center bg-slate-50 border-b border-slate-200 px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">
            <div>Integration</div>
            <div>Owner</div>
            <div>Protocol</div>
            <div>Availability</div>
            <div>Related Agents</div>
            <div>ARE</div>
            <div>ART</div>
            <div />
          </div>
          <div className="divide-y divide-slate-100">
            {paged.map(item => {
              const availMeta = getAvailabilityMeta(item.availability_status);
              return (
                <button
                  key={item.integration_id}
                  onClick={() => navigate(`/integrations/${encodeURIComponent(item.integration_id)}`)}
                  className="grid grid-cols-[1.6fr_1fr_120px_140px_100px_80px_100px_48px] items-center px-6 py-4 hover:bg-slate-50 text-left transition-colors group w-full"
                >
                  <div className="flex flex-col gap-0.5 pr-4 min-w-0">
                    <div className="font-bold text-slate-800 text-sm group-hover:text-blue-600 transition-colors truncate">
                      {item.integration_name || item.integration_id}
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 truncate">{item.integration_id}</div>
                  </div>
                  <div className="text-sm text-slate-500 truncate pr-4">{item.owner || 'N/A'}</div>
                  <div>
                    {item.protocol ? (
                      <span className="text-[10px] font-semibold bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5 rounded-full">
                        {item.protocol}
                      </span>
                    ) : (
                      <span className="text-sm text-slate-400">N/A</span>
                    )}
                  </div>
                  <div>
                    {item.availability_status ? (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${availMeta.className}`}>
                        {item.availability_status}
                      </span>
                    ) : (
                      <span className="text-sm text-slate-400">N/A</span>
                    )}
                  </div>
                  <div className="text-sm font-semibold text-blue-700">{item.related_agent_count ?? 0}</div>
                  <div className="text-sm font-semibold text-slate-700">{item.agent_risk_exposure ?? 0}</div>
                  <div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      item.agent_risk_tier === 'Critical' || item.agent_risk_tier === 'High'
                        ? 'bg-red-50 text-red-700 border-red-200'
                        : item.agent_risk_tier === 'Medium'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : item.agent_risk_tier === 'Low'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-50 text-slate-500 border-slate-200'
                    }`}>{item.agent_risk_tier ?? 'None'}</span>
                  </div>
                  <div className="flex justify-end pr-2 text-slate-300 group-hover:text-blue-500 transition-colors">
                    <ChevronRight size={18} className="transform group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!loading && !error && paged.length === 0 && (
        <div className="py-20 flex flex-col items-center justify-center gap-4 text-slate-500 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
          <div className="p-4 bg-white rounded-full shadow-sm">
            <Grid2X2 size={32} className="text-slate-300" />
          </div>
          <p className="font-medium text-lg">No integrations found</p>
        </div>
      )}

      {!isSearching && !loading && !error && paged.length > 0 && (
        <div className="flex justify-center items-center gap-2 pb-4">
          <button
            onClick={handlePrev}
            disabled={page === 1}
            className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <ChevronLeft size={16} />
            Previous
          </button>
          <span className="text-sm text-slate-500 px-3">Page {page}</span>
          <button
            onClick={handleNext}
            disabled={!hasMore}
            className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Next
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {showUploadModal && (
        <LoadIntegrationsModal
          onClose={() => setShowUploadModal(false)}
          onSuccess={() => {
            businessRelationsApi.listIntegrations(undefined, activeCompany?.id).then(setIntegrations).catch(() => {});
          }}
          companyId={activeCompany?.id}
          companyName={activeCompany?.name}
        />
      )}
    </div>
  );
};

export default IntegrationsPage;
