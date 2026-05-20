// ── src/pages/BlueprintPage.tsx ───────────────────────────────────────────────
// Main Company Blueprint page.
// Layout: sidebar node list (left) + graph (centre) + detail panel (right).
// Matches the structural pattern of Dashboard + AgentViewPage.

import React, { useState, useMemo } from 'react';
import {
  Search, LayoutGrid, List, RefreshCw, Building2,
  Plus, ChevronDown, Network, Layers, Link2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useBlueprint } from '../context/BlueprintContext';
import { blueprintApi } from '../services/blueprintApi';
import BlueprintGraph from '../components/BlueprintGraphRF';
import BlueprintDimCard, { BlueprintDimRow } from '../components/BlueprintDimCard';
import BlueprintDimPanel from '../components/BlueprintDimPanel';
import type { DimNode, DimCategory } from '../types/blueprint';
import { CATEGORY_PALETTE, CATEGORY_LABELS } from '../types/blueprint';
import AddDimNodeModal from '../components/AddDimNodeModal';
import AddDimEdgeModal from '../components/AddDimEdgeModal';
import { useBlueprintChatSync } from '../hooks/useChatSync';

const ALL_CATEGORIES: DimCategory[] = [
  'profile', 'strategy', 'organisation', 'process',
  'application', 'technology', 'risk', 'finance', 'custom',
];

type ViewMode = 'graph' | 'grid' | 'list';

const BlueprintPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    companies, activeCompany, dimTypes, nodes, graph,
    loading, graphLoading, error, lastFetched,
    selectCompany, refresh, refreshNodes, refreshGraph
  } = useBlueprint();

  // ── Local UI state ───────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>('graph');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<DimCategory | 'all'>('all');
  const [selectedNode, setSelectedNode] = useState<DimNode | null>(null);
  const [companyDropdown, setCompanyDropdown] = useState(false);
  const [showAddNode, setShowAddNode] = useState(false);
  const [showAddEdge, setShowAddEdge] = useState(false);

  // ── Filtered nodes ───────────────────────────────────────────────────────
  const filteredNodes = useMemo(() => {
    let result = nodes;
    if (categoryFilter !== 'all') result = result.filter(n => n.category === categoryFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(n =>
        n.label.toLowerCase().includes(q) ||
        n.summary?.toLowerCase().includes(q) ||
        n.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    return result;
  }, [nodes, categoryFilter, search]);

  // ── Category counts ──────────────────────────────────────────────────────
  const categoryCounts = useMemo(() =>
    nodes.reduce((acc, n) => {
      const cat = n.category ?? 'custom';
      acc[cat] = (acc[cat] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    [nodes]);

  // ── Chat sync — keeps chat context in sync with blueprint state ──────────
  useBlueprintChatSync(
    activeCompany,
    nodes,
    selectedNode ?? undefined,
  );

  const handleNodeClick = (node: DimNode) => setSelectedNode(node);
  const handleGraphNodeClick = (nodeId: string) => {
    const found = nodes.find(n => n.id === nodeId);
    if (found) { setSelectedNode(found); setViewMode('grid'); }
  };

  const handleDeleteNode = async (node: DimNode) => {
    if (!window.confirm(`Delete "${node.label}"? This cannot be undone.`)) return;
    await blueprintApi.deleteNode(node.id);
    if (selectedNode?.id === node.id) setSelectedNode(null);
    refreshNodes();
    refreshGraph();
  };

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-4 text-slate-500 dark:text-slate-400 p-8">
        <div className="p-4 bg-rose-50 dark:bg-rose-900/20 rounded-full">
          <Layers size={28} className="text-rose-400" />
        </div>
        <p className="font-semibold text-rose-600 dark:text-rose-400">{error}</p>
        <button onClick={refresh}
          className="flex items-center gap-2 text-sm font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 px-4 py-2 rounded-lg transition-colors">
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-4 flex-wrap transition-colors">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 text-white p-2.5 rounded-xl shadow-sm">
            <Network size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Company Blueprint</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {nodes.length} dimension{nodes.length !== 1 ? 's' : ''} across {Object.keys(categoryCounts).length} categories
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">

          {/* Company selector */}
          <div className="relative">
            <button
              onClick={() => setCompanyDropdown(p => !p)}
              className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-600 px-3 py-2 rounded-lg transition-colors"
            >
              <Building2 size={14} className="text-blue-600 dark:text-blue-400" />
              {activeCompany?.name ?? 'Select company'}
              <ChevronDown size={13} className="text-slate-400" />
            </button>
            {companyDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 min-w-[220px] py-1">
                {companies.map(c => (
                  <button key={c.id}
                    onClick={() => { selectCompany(c); setCompanyDropdown(false); setSelectedNode(null); }}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${c.id === activeCompany?.id
                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-bold'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}>
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">{c.industry} · {c.region}</div>
                  </button>
                ))}
                <div className="border-t border-slate-100 dark:border-slate-700 mt-1 pt-1 px-2 pb-1">
                  <button onClick={() => { navigate('/blueprint/setup'); setCompanyDropdown(false); }}
                    className="flex items-center gap-2 w-full text-left px-2 py-2 text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors">
                    <Plus size={11} /> Add company
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* View mode toggle */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700">
            {([['graph', Network], ['grid', LayoutGrid], ['list', List]] as const).map(([mode, Icon]) => (
              <button key={mode}
                onClick={() => setViewMode(mode)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-bold transition-all ${viewMode === mode
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}>
                <Icon size={13} />
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>

          {/* Refresh */}
          <button onClick={refresh} disabled={loading}
            className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors disabled:opacity-50">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>

          {/* Add dimension */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddNode(true)}
              className="flex items-center gap-1.5 text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500 px-3 py-2 rounded-lg shadow-sm transition-colors">
              <Plus size={12} /> Add dimension
            </button>
            <button
              onClick={() => setShowAddEdge(true)}
              className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 px-3 py-2 rounded-lg transition-colors">
              <Link2 size={12} /> Add relationship
            </button>
          </div>
        </div>
      </div>

      {/* ── Category filter strip ─────────────────────────────────────────── */}
      {viewMode !== 'graph' && (
        <div className="flex-shrink-0 px-6 py-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-2 flex-wrap transition-colors">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`text-[11px] font-bold px-3 py-1.5 rounded-full border transition-all ${categoryFilter === 'all'
              ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800 border-slate-800 dark:border-slate-200'
              : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500'
              }`}>
            All <span className="font-normal opacity-70">({nodes.length})</span>
          </button>
          {ALL_CATEGORIES.filter(c => categoryCounts[c] > 0).map(cat => {
            const p = CATEGORY_PALETTE[cat];
            const active = categoryFilter === cat;
            return (
              <button key={cat}
                onClick={() => setCategoryFilter(cat)}
                style={active
                  ? { background: p.stroke, borderColor: p.stroke, color: '#fff' }
                  : { color: p.text, borderColor: p.badge, background: p.bg }}
                className={`text-[11px] font-bold px-3 py-1.5 rounded-full border transition-all ${active ? '' : 'hover:border-slate-400 dark:hover:border-slate-500'
                  }`}
              >
                {CATEGORY_LABELS[cat]} <span className="font-normal opacity-70">({categoryCounts[cat] ?? 0})</span>
              </button>
            );
          })}

          {/* Search */}
          <div className="ml-auto relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search dimensions…"
              className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 focus:border-blue-300 dark:focus:border-blue-600 text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 w-52 transition-all"
            />
          </div>
        </div>
      )}

      {/* ── Main content area ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex">

        {/* Content + optional detail panel */}
        <div className={`flex flex-1 overflow-hidden transition-all ${selectedNode ? 'gap-0' : ''}`}>

          {/* Left: graph / grid / list */}
          <div className={`flex-1 overflow-y-auto p-6 transition-all ${selectedNode && viewMode !== 'graph' ? 'max-w-[calc(100%-380px)]' : ''}`}>

            {!activeCompany ? (
              <div className="flex flex-col items-center justify-center py-24 gap-4 text-slate-400 dark:text-slate-500">
                <Building2 size={40} className="text-slate-300 dark:text-slate-600" />
                <p className="font-semibold text-slate-500 dark:text-slate-400">No company selected</p>
                <button onClick={() => navigate('/blueprint/setup')}
                  className="flex items-center gap-2 text-sm font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 px-4 py-2 rounded-lg transition-colors">
                  <Plus size={14} /> Set up your first Blueprint
                </button>
              </div>
            ) : viewMode === 'graph' ? (
              <div className="flex flex-col gap-4">
                {/* Company summary strip */}
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 px-5 py-4 flex items-center gap-6 flex-wrap transition-colors">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Company</p>
                    <p className="font-bold text-slate-800 dark:text-slate-100">{activeCompany.name}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Industry</p>
                    <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{activeCompany.industry}</p>
                  </div>
                  {activeCompany.region && (
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Region</p>
                      <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{activeCompany.region}</p>
                    </div>
                  )}
                  {activeCompany.legal_entity && (
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Legal entity</p>
                      <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{activeCompany.legal_entity}</p>
                    </div>
                  )}
                  <div className="ml-auto flex items-center gap-3">
                    {Object.entries(categoryCounts).map(([cat, count]) => {
                      const p = CATEGORY_PALETTE[cat as DimCategory] ?? CATEGORY_PALETTE.custom;
                      return (
                        <span key={cat} className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border"
                          style={{ background: p.bg, color: p.text, borderColor: p.badge }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.stroke }} />
                          {count}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Graph */}
                {graphLoading ? (
                  <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 h-64 flex items-center justify-center text-slate-400 gap-2">
                    <RefreshCw size={14} className="animate-spin" /> Loading graph…
                  </div>
                ) : graph ? (
                  <BlueprintGraph
                    graph={graph}
                    companyName={activeCompany.name}
                    onNodeClick={handleGraphNodeClick}
                  />
                ) : null}
              </div>
            ) : viewMode === 'grid' ? (
              loading ? (
                <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="bg-slate-100 dark:bg-slate-800 rounded-xl h-36 animate-pulse" />
                  ))}
                </div>
              ) : filteredNodes.length === 0 ? (
                <EmptyState search={search} onClear={() => setSearch('')} />
              ) : (
                <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                  {filteredNodes.map(node => (
                    <BlueprintDimCard key={node.id} node={node} onClick={handleNodeClick} onDelete={handleDeleteNode} />
                  ))}
                </div>
              )
            ) : (
              /* List mode */
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
                <div className="grid grid-cols-[2fr_1fr_120px_100px_48px] items-center bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 px-6 py-3.5 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <div>Dimension</div>
                  <div>Category</div>
                  <div>Visibility</div>
                  <div>Sensitive</div>
                  <div />
                </div>
                {loading ? (
                  <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm animate-pulse">Loading dimensions…</div>
                ) : filteredNodes.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">No dimensions found</div>
                ) : filteredNodes.map(node => (
                  <BlueprintDimRow key={node.id} node={node} onClick={handleNodeClick} onDelete={handleDeleteNode} />
                ))}
              </div>
            )}
          </div>
          {showAddNode && activeCompany && (
            <AddDimNodeModal
              onClose={() => setShowAddNode(false)}
              onCreated={() => { refreshNodes(); refreshGraph(); }}
            />
          )}
          {showAddEdge && activeCompany && (
            <AddDimEdgeModal
              onClose={() => setShowAddEdge(false)}
              onCreated={() => { refreshNodes(); refreshGraph(); }}
            />
          )}
          {/* Right: detail panel */}
          {selectedNode && viewMode !== 'graph' && (
            <div className="w-[380px] flex-shrink-0 border-l border-slate-200 dark:border-slate-800 overflow-hidden">
              <BlueprintDimPanel
                node={selectedNode}
                onClose={() => setSelectedNode(null)}
                onNodeUpdated={refreshNodes}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Empty state ───────────────────────────────────────────────────────────────
const EmptyState: React.FC<{ search: string; onClear: () => void }> = ({ search, onClear }) => (
  <div className="py-20 flex flex-col items-center justify-center gap-4 text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800">
    <div className="p-4 bg-white dark:bg-slate-800 rounded-full shadow-sm">
      <Search size={28} className="text-slate-300 dark:text-slate-600" />
    </div>
    <p className="font-semibold text-lg">No dimensions found</p>
    {search && (
      <button onClick={onClear}
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium">
        Clear search
      </button>
    )}
  </div>
);

export default BlueprintPage;
