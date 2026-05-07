// ── src/pages/CompliancePage.tsx ─────────────────────────────────────────────

import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scale, Plus, Search, RefreshCw, AlertTriangle, ChevronRight, FileText, Shield } from 'lucide-react';
import { useCompliance } from '../context/ComplianceContext';
import { useBlueprint } from '../context/BlueprintContext';
import type { ComplianceItem, ComplianceItemType, ImpactLevel } from '../types/compliance';
import { IMPACT_LEVELS, ITEM_TYPE_META } from '../types/compliance';

const CompliancePage: React.FC = () => {
  const navigate = useNavigate();
  const { items, loading, error, refresh } = useCompliance();
  const { activeCompany } = useBlueprint();

  const [search,     setSearch]     = useState('');
  const [typeFilter, setTypeFilter] = useState<ComplianceItemType | 'all'>('all');

  const filtered = useMemo(() => {
    let r = items;
    if (typeFilter !== 'all') r = r.filter(i => i.item_type === typeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(i =>
        i.name.toLowerCase().includes(q) ||
        i.short_name?.toLowerCase().includes(q) ||
        i.issuing_body?.toLowerCase().includes(q)
      );
    }
    return r;
  }, [items, typeFilter, search]);

  const regulations = filtered.filter(i => i.item_type === 'regulation');
  const policies    = filtered.filter(i => i.item_type === 'policy');

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 text-white p-2.5 rounded-xl shadow-sm">
            <Scale size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Compliance</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {items.filter(i => i.item_type === 'regulation').length} regulations ·{' '}
              {items.filter(i => i.item_type === 'policy').length} policies
              {activeCompany && ` · ${activeCompany.name}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Type filter */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700">
            {(['all', 'regulation', 'policy'] as const).map(t => (
              <button key={t} onClick={() => setTypeFilter(t)}
                className={`text-[11px] font-bold px-2.5 py-1.5 rounded-md transition-all capitalize ${
                  typeFilter === t
                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}>
                {t === 'all' ? 'All' : ITEM_TYPE_META[t].label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800 focus:border-indigo-300 w-44 text-slate-700 dark:text-slate-200 placeholder-slate-400 transition-all" />
          </div>

          <button onClick={refresh} disabled={loading}
            className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors disabled:opacity-50">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>

          {/* Add buttons */}
          <button onClick={() => navigate('/compliance/new?type=regulation')}
            className="flex items-center gap-1.5 text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded-lg shadow-sm transition-colors">
            <Scale size={12} /> Add Regulation
          </button>
          {activeCompany && (
            <button onClick={() => navigate('/compliance/new?type=policy')}
              className="flex items-center gap-1.5 text-[11px] font-bold text-white bg-violet-600 hover:bg-violet-700 px-3 py-2 rounded-lg shadow-sm transition-colors">
              <FileText size={12} /> Add Policy
            </button>
          )}
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-8">

        {error && (
          <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl px-4 py-3 text-sm">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        {/* Regulations */}
        {(typeFilter === 'all' || typeFilter === 'regulation') && (
          <Section
            title="Regulations"
            icon={<Scale size={15} className="text-blue-600 dark:text-blue-400" />}
            count={regulations.length}
            loading={loading}
            items={regulations}
            onSelect={id => navigate(`/compliance/${id}`)}
          />
        )}

        {/* Policies */}
        {(typeFilter === 'all' || typeFilter === 'policy') && (
          <Section
            title="Policies & Guidelines"
            icon={<FileText size={15} className="text-violet-600 dark:text-violet-400" />}
            count={policies.length}
            loading={loading}
            items={policies}
            onSelect={id => navigate(`/compliance/${id}`)}
            emptyMessage={activeCompany
              ? `No policies for ${activeCompany.name} yet`
              : 'Select a company to see its policies'}
          />
        )}
      </div>
    </div>
  );
};

// ── Section ───────────────────────────────────────────────────────────────────
const Section: React.FC<{
  title:        string;
  icon:         React.ReactNode;
  count:        number;
  loading:      boolean;
  items:        ComplianceItem[];
  onSelect:     (id: string) => void;
  emptyMessage?: string;
}> = ({ title, icon, count, loading, items, onSelect, emptyMessage }) => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center gap-2">
      {icon}
      <h2 className="font-bold text-slate-700 dark:text-slate-200 text-sm">{title}</h2>
      <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
        {count}
      </span>
    </div>

    {loading ? (
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
        {[1,2,3].map(i => <div key={i} className="h-28 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />)}
      </div>
    ) : items.length === 0 ? (
      <div className="text-sm text-slate-400 dark:text-slate-500 italic py-4 pl-1">
        {emptyMessage ?? 'None found'}
      </div>
    ) : (
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
        {items.map(item => <ComplianceCard key={item.id} item={item} onClick={() => onSelect(item.id)} />)}
      </div>
    )}
  </div>
);

// ── Card ──────────────────────────────────────────────────────────────────────
const ComplianceCard: React.FC<{ item: ComplianceItem; onClick: () => void }> = ({ item, onClick }) => {
  const meta   = ITEM_TYPE_META[item.item_type];
  const impact = item.max_impact as ImpactLevel | null;
  const imp    = impact && impact !== 'none' ? IMPACT_LEVELS[impact] : null;

  return (
    <div onClick={onClick}
      className="group bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-800 transition-all cursor-pointer p-4 flex flex-col gap-3">

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
          style={{ background: meta.bg, color: meta.color, borderColor: meta.bg }}>
          {meta.icon} {meta.label}
        </span>
        {imp && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
            style={{ background: imp.bg, color: imp.color, borderColor: imp.badge }}>
            {imp.label} impact
          </span>
        )}
      </div>

      <div>
        {item.short_name && (
          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-0.5">{item.short_name}</p>
        )}
        <p className="font-bold text-slate-800 dark:text-slate-100 text-sm group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors leading-snug">
          {item.name}
        </p>
        {item.issuing_body && (
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{item.issuing_body}</p>
        )}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-3 text-[10px] text-slate-400 dark:text-slate-500">
          {item.dim_count != null && <span>{item.dim_count} dims</span>}
          {(item.open_gaps ?? 0) > 0 && (
            <span className="text-rose-500 dark:text-rose-400 font-bold">{item.open_gaps} gaps</span>
          )}
        </div>
        <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 group-hover:text-indigo-500 transform group-hover:translate-x-0.5 transition-all" />
      </div>
    </div>
  );
};

export default CompliancePage;
