// ── src/components/AddDimEdgeModal.tsx ───────────────────────────────────────
// Modal for creating a relationship (edge) between two dimension nodes.
// Can be opened from BlueprintDimPanel (pre-fills source node)
// or from BlueprintPage (both source and target must be selected).

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { X, Link2, RefreshCw, Search, ArrowRight, ChevronDown } from 'lucide-react';
import { blueprintApi } from '../services/blueprintApi';
import { useBlueprint } from '../context/BlueprintContext';
import type { DimNode, RelType } from '../types/blueprint';
import { CATEGORY_PALETTE, CATEGORY_LABELS } from '../types/blueprint';
import { Overlay, Field, inputCls } from './AddDimNodeModal';

// ── Relationship type metadata ────────────────────────────────────────────────
const REL_TYPE_META: Record<string, { label: string; desc: string; example: string }> = {
  depends_on:  { label: 'Depends on',   desc: 'Source cannot function without target', example: 'Loan Origination → depends on → nCino LMS' },
  owned_by:    { label: 'Owned by',     desc: 'Source is governed/managed by target',  example: 'Credit Review Process → owned by → Commercial Banking Div' },
  supports:    { label: 'Supports',     desc: 'Source enables or assists target',       example: 'Snowflake EDW → supports → Regulatory Reporting' },
  risks:       { label: 'Risks',        desc: 'Source introduces risk to target',       example: 'Digital Expansion Strategy → risks → Cyber Risk' },
  enables:     { label: 'Enables',      desc: 'Source makes target possible',           example: 'API Gateway → enables → Digital Banking Platform' },
  part_of:     { label: 'Part of',      desc: 'Source is a component of target',        example: 'Snowflake → part of → Data & Analytics Platform' },
  governed_by: { label: 'Governed by',  desc: 'Source is subject to target controls',  example: 'CRE Concentration Risk → governed by → Credit Review' },
  replaced_by: { label: 'Replaced by',  desc: 'Source is being superseded by target',  example: 'Legacy Core → replaced by → Modern Banking Platform' },
  custom:      { label: 'Custom',       desc: 'User-defined relationship',              example: '' },
};

interface AddDimEdgeModalProps {
  /** Pre-fill the source node (when opened from DimPanel) */
  sourceNode?: DimNode;
  onClose:     () => void;
  onCreated:   () => void;
}

const AddDimEdgeModal: React.FC<AddDimEdgeModalProps> = ({ sourceNode, onClose, onCreated }) => {
  const { nodes, activeCompany } = useBlueprint();

  const [source,    setSource]    = useState<DimNode | null>(sourceNode ?? null);
  const [target,    setTarget]    = useState<DimNode | null>(null);
  const [relType,   setRelType]   = useState<RelType>('depends_on');
  const [weight,    setWeight]    = useState(0.7);
  const [note,      setNote]      = useState('');
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  // Node picker state
  const [pickingSource, setPickingSource] = useState(!sourceNode);
  const [pickingTarget, setPickingTarget] = useState(false);
  const [nodeSearch,    setNodeSearch]    = useState('');

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pickingSource || pickingTarget) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [pickingSource, pickingTarget]);

  // Filter nodes for the picker
  const filteredNodes = useMemo(() => {
    const q = nodeSearch.toLowerCase();
    const exclude = pickingSource ? target?.id : source?.id;
    return nodes.filter(n =>
      n.id !== exclude &&
      (n.label.toLowerCase().includes(q) ||
       n.category?.toLowerCase().includes(q) ||
       n.tags?.some(t => t.includes(q)))
    );
  }, [nodes, nodeSearch, source, target, pickingSource, pickingTarget]);

  const selectNode = (node: DimNode) => {
    if (pickingSource) { setSource(node); setPickingSource(false); }
    else               { setTarget(node); setPickingTarget(false); }
    setNodeSearch('');
  };

  const handleSubmit = async () => {
    if (!source)  { setError('Select a source dimension'); return; }
    if (!target)  { setError('Select a target dimension'); return; }
    if (source.id === target.id) { setError('Source and target must be different'); return; }

    setSaving(true);
    setError(null);
    try {
      await blueprintApi.createEdge({
        source_id: source.id,
        target_id: target.id,
        rel_type:  relType,
        weight,
        meta:      note ? { note } : {},
      });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message ?? 'Failed to create relationship');
    } finally {
      setSaving(false);
    }
  };

  const relMeta = REL_TYPE_META[relType];

  const isPicking = pickingSource || pickingTarget;

  return (
    <Overlay onClose={onClose}>
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden max-h-[90vh]">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg border border-indigo-100 dark:border-indigo-800">
              <Link2 size={15} className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h2 className="font-bold text-slate-800 dark:text-slate-100 text-sm">Add relationship</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Connect two dimensions</p>
            </div>
          </div>
          <button onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* ── Node picker overlay ─────────────────────────────────────────── */}
        {isPicking && (
          <div className="flex-1 flex flex-col overflow-hidden px-5 py-4">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
              Select {pickingSource ? 'source' : 'target'} dimension
            </p>
            <div className="relative mb-3">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchRef}
                value={nodeSearch}
                onChange={e => setNodeSearch(e.target.value)}
                placeholder="Search dimensions…"
                className={`${inputCls} pl-8`}
              />
            </div>
            <div className="flex-1 overflow-y-auto flex flex-col gap-1.5">
              {filteredNodes.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500 italic text-center py-8">
                  No dimensions found
                </p>
              ) : filteredNodes.map(node => {
                const cat = node.category ?? 'custom';
                const p   = CATEGORY_PALETTE[cat as keyof typeof CATEGORY_PALETTE] ?? CATEGORY_PALETTE.custom;
                return (
                  <button key={node.id} onClick={() => selectNode(node)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-left transition-all bg-white dark:bg-slate-800/50">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.stroke }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{node.label}</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500">{CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] ?? cat}</p>
                    </div>
                  </button>
                );
              })}
            </div>
            <button onClick={() => { setPickingSource(false); setPickingTarget(false); setNodeSearch(''); }}
              className="mt-3 text-sm font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-center">
              Cancel
            </button>
          </div>
        )}

        {/* ── Main form ─────────────────────────────────────────────────── */}
        {!isPicking && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">

              {/* Source → Target visual */}
              <div>
                <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                  Relationship
                </p>
                <div className="flex items-center gap-3">
                  {/* Source node */}
                  <NodePill
                    node={source}
                    label="Source"
                    onClick={() => { setPickingSource(true); setPickingTarget(false); }}
                  />

                  {/* Rel type badge */}
                  <div className="flex flex-col items-center gap-1 flex-shrink-0">
                    <div className="h-px w-8 bg-slate-300 dark:bg-slate-600" />
                    <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider whitespace-nowrap">
                      {relMeta.label}
                    </span>
                    <ArrowRight size={12} className="text-slate-400 dark:text-slate-500" />
                  </div>

                  {/* Target node */}
                  <NodePill
                    node={target}
                    label="Target"
                    onClick={() => { setPickingTarget(true); setPickingSource(false); }}
                  />
                </div>
              </div>

              {/* Relationship type */}
              <Field label="Relationship type" required>
                <div className="grid grid-cols-1 gap-1.5 max-h-52 overflow-y-auto pr-0.5">
                  {Object.entries(REL_TYPE_META).map(([type, meta]) => {
                    const active = relType === type;
                    return (
                      <button key={type} onClick={() => setRelType(type as RelType)}
                        className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border text-left transition-all ${
                          active
                            ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                            : 'border-slate-200 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-700 bg-white dark:bg-slate-800/50'
                        }`}>
                        <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-all ${
                          active ? 'border-indigo-500 bg-indigo-500' : 'border-slate-300 dark:border-slate-600'
                        }`}>
                          {active && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-[11px] font-bold ${active ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-200'}`}>
                            {meta.label}
                          </p>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500">{meta.desc}</p>
                          {meta.example && active && (
                            <p className="text-[10px] text-indigo-500 dark:text-indigo-400 italic mt-0.5">e.g. {meta.example}</p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Field>

              {/* Weight slider */}
              <Field label={`Relationship strength — ${Math.round(weight * 100)}%`}>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 flex-shrink-0">Weak</span>
                  <input
                    type="range" min={0.1} max={1.0} step={0.1}
                    value={weight}
                    onChange={e => setWeight(parseFloat(e.target.value))}
                    className="flex-1 accent-blue-600"
                  />
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 flex-shrink-0">Strong</span>
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                  Higher strength means the context agent prioritises this relationship in traversal.
                </p>
              </Field>

              {/* Optional note */}
              <Field label="Note (optional)">
                <input
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="e.g. Critical dependency — failure cascades upstream"
                  className={inputCls}
                />
              </Field>

              {error && (
                <div className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl px-4 py-3">
                  {error}
                </div>
              )}
            </div>

            {/* ── Footer ───────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex-shrink-0">
              <button onClick={onClose}
                className="text-sm font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 px-4 py-2 rounded-lg transition-colors">
                Cancel
              </button>
              <button onClick={handleSubmit} disabled={saving || !source || !target}
                className="flex items-center gap-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 dark:hover:bg-indigo-500 px-5 py-2 rounded-lg shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                {saving ? <RefreshCw size={13} className="animate-spin" /> : <Link2 size={13} />}
                {saving ? 'Saving…' : 'Create relationship'}
              </button>
            </div>
          </>
        )}
      </div>
    </Overlay>
  );
};

// ── Node pill — clickable node selector ───────────────────────────────────────
const NodePill: React.FC<{ node: DimNode | null; label: string; onClick: () => void }> = ({ node, label, onClick }) => {
  const cat     = node?.category ?? 'custom';
  const palette = CATEGORY_PALETTE[cat as keyof typeof CATEGORY_PALETTE] ?? CATEGORY_PALETTE.custom;

  return (
    <button onClick={onClick}
      className={`flex-1 flex flex-col gap-1 px-3 py-2.5 rounded-xl border transition-all text-left ${
        node
          ? 'border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-600 bg-white dark:bg-slate-800'
          : 'border-dashed border-slate-300 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 bg-slate-50 dark:bg-slate-800/50'
      }`}>
      <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{label}</span>
      {node ? (
        <>
          <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full w-fit"
            style={{ background: palette.bg, color: palette.text }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: palette.stroke }} />
            {CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] ?? cat}
          </span>
          <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{node.label}</p>
        </>
      ) : (
        <p className="text-xs text-slate-400 dark:text-slate-500">Click to select…</p>
      )}
    </button>
  );
};

export default AddDimEdgeModal;
