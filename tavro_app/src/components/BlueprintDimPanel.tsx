// ── src/components/BlueprintDimPanel.tsx ─────────────────────────────────────
// Slide-in right panel showing full detail for a selected dimension node.
// Matches the panel pattern used in AgentView tabs.

import React, { useState, useEffect, useCallback } from 'react';
import {
  X, ExternalLink, RefreshCw, Shield, Eye, EyeOff,
  Tag, Link2, Database, Pencil, Check, AlertTriangle, Trash2, Plus,
} from 'lucide-react';
import { blueprintApi } from '../services/blueprintApi';
import type { DimNode, DimEdge, SourceRef, SourceRefDetail } from '../types/blueprint';
import { CATEGORY_PALETTE, CATEGORY_LABELS } from '../types/blueprint';
import AddDimEdgeModal from './AddDimEdgeModal';

interface BlueprintDimPanelProps {
  node: DimNode;
  onClose: () => void;
  onNodeUpdated: () => void;
  onEdgeCreated?: () => void;
}

const BlueprintDimPanel: React.FC<BlueprintDimPanelProps> = ({ node, onClose, onNodeUpdated, onEdgeCreated }) => {
  const [edges,       setEdges]       = useState<DimEdge[]>([]);
  const [sourceRefs,  setSourceRefs]  = useState<SourceRef[]>([]);
  const [fetchDetail, setFetchDetail] = useState<Record<string, SourceRefDetail | null>>({});
  const [fetching,    setFetching]    = useState<Record<string, boolean>>({});
  const [loading,     setLoading]     = useState(true);

  // Inline edit state
  const [editing,     setEditing]     = useState(false);
  const [editLabel,   setEditLabel]   = useState(node.label);
  const [editSummary, setEditSummary] = useState(node.summary ?? '');
  const [saving,      setSaving]      = useState(false);
  const [showAddEdge, setShowAddEdge] = useState(false);

  const cat = node.category ?? 'custom';
  const palette = CATEGORY_PALETTE[cat as keyof typeof CATEGORY_PALETTE] ?? CATEGORY_PALETTE.custom;

  // ── Load edges + source refs ─────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [edgesPage, refs] = await Promise.all([
        blueprintApi.listEdges({ company_id: node.company_id, node_id: node.id }),
        blueprintApi.listSourceRefs(node.id),
      ]);
      setEdges(edgesPage.items);
      setSourceRefs(refs);
    } finally {
      setLoading(false);
    }
  }, [node.id, node.company_id]);

  useEffect(() => { load(); }, [load]);

  // ── Inline save ──────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      await blueprintApi.updateNode(node.id, { label: editLabel, summary: editSummary });
      setEditing(false);
      onNodeUpdated();
    } finally {
      setSaving(false);
    }
  };

  // ── Source ref drill-down ────────────────────────────────────────────────
  const handleFetch = async (ref: SourceRef) => {
    setFetching(p => ({ ...p, [ref.id]: true }));
    try {
      const detail = await blueprintApi.fetchSourceDetail(ref.id);
      setFetchDetail(p => ({ ...p, [ref.id]: detail }));
    } finally {
      setFetching(p => ({ ...p, [ref.id]: false }));
    }
  };

  const handleDeleteRef = async (ref: SourceRef) => {
    await blueprintApi.deleteSourceRef(ref.id);
    setSourceRefs(p => p.filter(r => r.id !== ref.id));
  };

  return (
    <>
    <div className="h-full flex flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 transition-colors">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-start justify-between gap-3 flex-shrink-0">
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border w-fit"
            style={{ background: palette.bg, color: palette.text, borderColor: palette.badge }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: palette.stroke }} />
            {CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] ?? 'Custom'}
          </span>
          {editing ? (
            <input
              value={editLabel}
              onChange={e => setEditLabel(e.target.value)}
              className="font-bold text-slate-800 dark:text-slate-100 text-base bg-white dark:bg-slate-800 border border-blue-300 dark:border-blue-600 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 w-full"
              autoFocus
            />
          ) : (
            <p className="font-bold text-slate-800 dark:text-slate-100 text-base leading-snug truncate">
              {node.label}
            </p>
          )}
          <div className="flex items-center gap-2">
            {node.sensitive && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 dark:text-rose-400">
                <Shield size={10} /> Sensitive
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
              {node.visibility === 'public' || node.visibility === 'internal'
                ? <Eye size={10} /> : <EyeOff size={10} />}
              {node.visibility}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {editing ? (
            <>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                {saving ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                Save
              </button>
              <button onClick={() => { setEditing(false); setEditLabel(node.label); setEditSummary(node.summary ?? ''); }}
                className="text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 px-2 py-1.5 rounded-lg transition-colors">
                Cancel
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)}
              className="p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors" title="Edit">
              <Pencil size={14} />
            </button>
          )}
          <button onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">

        {/* Summary */}
        <div>
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Summary</p>
          {editing ? (
            <textarea
              value={editSummary}
              onChange={e => setEditSummary(e.target.value)}
              rows={4}
              className="w-full text-sm text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-blue-300 dark:border-blue-600 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 resize-none"
            />
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {node.summary || <span className="text-slate-300 dark:text-slate-600 italic">No summary</span>}
            </p>
          )}
        </div>

        {/* Tags */}
        {node.tags.length > 0 && (
          <div>
            <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Tag size={11} /> Tags
            </p>
            <div className="flex flex-wrap gap-1.5">
              {node.tags.map(tag => (
                <span key={tag}
                  className="text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Relationships */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Link2 size={11} /> Relationships
              <span className="font-normal normal-case tracking-normal text-slate-300 dark:text-slate-600">({edges.length})</span>
            </p>
            <button
              onClick={() => setShowAddEdge(true)}
              className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 px-2 py-1 rounded-lg transition-colors">
              <Plus size={10} /> Add
            </button>
          </div>
          {loading ? (
            <div className="text-xs text-slate-400 dark:text-slate-500 animate-pulse">Loading…</div>
          ) : edges.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500 italic">No relationships yet</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {edges.map(edge => {
                const isSource = edge.source_id === node.id;
                const otherLabel = isSource ? edge.target_label : edge.source_label;
                return (
                  <div key={edge.id}
                    className="flex items-center gap-2 text-[11px] bg-slate-50 dark:bg-slate-800/50 rounded-lg px-3 py-2 border border-slate-100 dark:border-slate-800">
                    <span className="text-slate-400 dark:text-slate-500">{isSource ? '→' : '←'}</span>
                    <span className="font-semibold text-slate-600 dark:text-slate-300 truncate flex-1">{otherLabel ?? '—'}</span>
                    <span className="text-slate-400 dark:text-slate-500 font-mono text-[10px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded">
                      {edge.rel_type.replace('_', ' ')}
                    </span>
                    <span className="text-slate-300 dark:text-slate-600 text-[10px]">
                      {Math.round(edge.weight * 100)}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Source references */}
        <div>
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Database size={11} /> Source Systems
            <span className="font-normal normal-case tracking-normal text-slate-300 dark:text-slate-600">({sourceRefs.length})</span>
          </p>
          {sourceRefs.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500 italic">No source references</p>
          ) : (
            <div className="flex flex-col gap-2">
              {sourceRefs.map(ref => (
                <div key={ref.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2.5 gap-2">
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200">{ref.system_name}</span>
                      <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate">{ref.external_id}</span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleFetch(ref)}
                        disabled={fetching[ref.id]}
                        className="flex items-center gap-1 text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 px-2 py-1 rounded-lg transition-colors disabled:opacity-50"
                        title="Fetch from source">
                        {fetching[ref.id]
                          ? <RefreshCw size={10} className="animate-spin" />
                          : <ExternalLink size={10} />}
                        Fetch
                      </button>
                      <button onClick={() => handleDeleteRef(ref)}
                        className="p-1 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 rounded transition-colors">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>

                  {/* Fetched detail */}
                  {fetchDetail[ref.id] && (
                    <div className="border-t border-slate-200 dark:border-slate-700 px-3 py-2.5">
                      {fetchDetail[ref.id]?.error ? (
                        <div className="flex items-center gap-1.5 text-[11px] text-rose-500">
                          <AlertTriangle size={11} /> {fetchDetail[ref.id]!.error}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {Object.entries(fetchDetail[ref.id]?.detail?.sample_fields ?? {}).map(([k, v]) => (
                            <div key={k} className="flex gap-2 text-[10px]">
                              <span className="text-slate-400 dark:text-slate-500 capitalize w-24 flex-shrink-0">{k.replace('_', ' ')}</span>
                              <span className="text-slate-600 dark:text-slate-300 font-medium truncate">{String(v)}</span>
                            </div>
                          ))}
                          {fetchDetail[ref.id]?.detail?.message && (
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 italic mt-1">
                              {fetchDetail[ref.id]!.detail!.message as string}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {ref.last_synced && (
                    <div className="px-3 pb-2 text-[10px] text-slate-400 dark:text-slate-500">
                      Last synced {new Date(ref.last_synced).toLocaleString()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Meta */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Metadata</p>
          <div className="flex flex-col gap-1.5">
            {[
              ['ID',         node.id],
              ['Valid from', new Date(node.valid_from).toLocaleDateString()],
              ['Updated',    new Date(node.updated_at).toLocaleString()],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-3 text-[11px]">
                <span className="text-slate-400 dark:text-slate-500 w-20 flex-shrink-0">{k}</span>
                <span className="text-slate-600 dark:text-slate-300 font-mono break-all">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>

    {/* ── Add relationship modal ──────────────────────────────────────────── */}
    {showAddEdge && (
      <AddDimEdgeModal
        sourceNode={node}
        onClose={() => setShowAddEdge(false)}
        onCreated={() => {
          setShowAddEdge(false);
          load();
          onEdgeCreated?.();
        }}
      />
    )}
  </>
  );
};

export default BlueprintDimPanel;
