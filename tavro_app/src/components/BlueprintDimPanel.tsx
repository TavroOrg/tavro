// ── src/components/BlueprintDimPanel.tsx ─────────────────────────────────────
// Slide-in right panel showing full detail for a selected dimension node.
// Matches the panel pattern used in AgentView tabs.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, ExternalLink, RefreshCw, Shield, Eye, EyeOff,
  Tag, Link2, Database, Pencil, Check, AlertTriangle, Trash2, Plus, Paperclip, Download,
} from 'lucide-react';
import { blueprintApi } from '../services/blueprintApi';
import type { DimNode, DimEdge, SourceRef, SourceRefDetail, DimNodeAttachment, DimCategory } from '../types/blueprint';
import { CATEGORY_PALETTE, CATEGORY_LABELS } from '../types/blueprint';
import { useBlueprint } from '../context/BlueprintContext';
import AddDimEdgeModal from './AddDimEdgeModal';

interface BlueprintDimPanelProps {
  node: DimNode;
  onClose: () => void;
  onNodeUpdated: () => void;
  onEdgeCreated?: () => void;
}

const BlueprintDimPanel: React.FC<BlueprintDimPanelProps> = ({ node, onClose, onNodeUpdated, onEdgeCreated }) => {
  const { dimTypes } = useBlueprint();

  const [edges,       setEdges]       = useState<DimEdge[]>([]);
  const [sourceRefs,  setSourceRefs]  = useState<SourceRef[]>([]);
  const [fetchDetail, setFetchDetail] = useState<Record<string, SourceRefDetail | null>>({});
  const [fetching,    setFetching]    = useState<Record<string, boolean>>({});
  const [loading,     setLoading]     = useState(true);

  // Inline edit state
  const [editing,      setEditing]      = useState(false);
  const [editLabel,    setEditLabel]    = useState(node.label);
  const [editSummary,  setEditSummary]  = useState(node.summary ?? '');
  const [editCategory, setEditCategory] = useState<DimCategory>((node.category ?? 'custom') as DimCategory);
  const [editTags,     setEditTags]     = useState<string[]>(node.tags);
  const [tagInput,     setTagInput]     = useState('');
  const [saving,       setSaving]       = useState(false);
  const [showAddEdge,  setShowAddEdge]  = useState(false);
  const [attachments,  setAttachments]  = useState<DimNodeAttachment[]>([]);
  const [uploading,    setUploading]    = useState(false);
  const [downloading,  setDownloading]  = useState<string | null>(null);
  const attachFileRef = useRef<HTMLInputElement>(null);

  const loadAttachments = useCallback(async () => {
    const list = await blueprintApi.listAttachments(node.id);
    setAttachments(list);
  }, [node.id]);

  const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

  const handleAddFiles = async (files: File[]) => {
    const ok = files.filter(f => f.size <= MAX_FILE_BYTES);
    const bad = files.filter(f => f.size > MAX_FILE_BYTES).map(f => f.name);
    if (bad.length) {
      alert(`File(s) exceed the 50 MB limit and were skipped:\n${bad.join('\n')}`);
    }
    if (!ok.length) return;
    setUploading(true);
    try {
      await Promise.all(ok.map(f => blueprintApi.uploadAttachment(node.id, f)));
      await loadAttachments();
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteAttachment = async (id: string) => {
    await blueprintApi.deleteAttachment(id);
    setAttachments((prev: DimNodeAttachment[]) => prev.filter((a: DimNodeAttachment) => a.id !== id));
  };

  const handleDownload = async (att: DimNodeAttachment) => {
    setDownloading(att.id);
    try {
      await blueprintApi.downloadAttachment(att.id, att.filename);
    } finally {
      setDownloading(null);
    }
  };

  const cat = node.category ?? 'custom';
  const palette = CATEGORY_PALETTE[cat as keyof typeof CATEGORY_PALETTE] ?? CATEGORY_PALETTE.custom;

  // ── Load edges + source refs + attachments ──────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [edgesPage, refs, atts] = await Promise.all([
        blueprintApi.listEdges({ company_id: node.company_id, node_id: node.id }),
        blueprintApi.listSourceRefs(node.id),
        blueprintApi.listAttachments(node.id),
      ]);
      setEdges(edgesPage.items);
      setSourceRefs(refs);
      setAttachments(atts);
    } finally {
      setLoading(false);
    }
  }, [node.id, node.company_id]);

  useEffect(() => { load(); }, [load]);

  // ── Tag helpers ──────────────────────────────────────────────────────────
  const addTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (t && !editTags.includes(t)) setEditTags(p => [...p, t]);
    setTagInput('');
  };
  const removeTag = (tag: string) => setEditTags(p => p.filter(t => t !== tag));
  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
    if (e.key === 'Backspace' && !tagInput && editTags.length > 0) setEditTags(p => p.slice(0, -1));
  };

  // ── Inline save ──────────────────────────────────────────────────────────
  const handleSave = async () => {
    const dimTypeId = dimTypes.find(t => t.category === editCategory)?.id;
    setSaving(true);
    try {
      await blueprintApi.updateNode(node.id, {
        label: editLabel,
        summary: editSummary,
        tags: editTags,
        ...(dimTypeId ? { dim_type_id: dimTypeId } : {}),
      });
      setEditing(false);
      onNodeUpdated();
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditLabel(node.label);
    setEditSummary(node.summary ?? '');
    setEditCategory((node.category ?? 'custom') as DimCategory);
    setEditTags(node.tags);
    setTagInput('');
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
          {editing ? (
            <div className="flex flex-wrap gap-1">
              {(Object.keys(CATEGORY_LABELS) as DimCategory[]).map(c => {
                const p = CATEGORY_PALETTE[c];
                const active = editCategory === c;
                return (
                  <button key={c} onClick={() => setEditCategory(c)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold transition-all"
                    style={active
                      ? { background: p.bg, borderColor: p.stroke, color: p.text }
                      : { background: 'transparent', borderColor: '#cbd5e1', color: '#94a3b8' }}>
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: p.stroke }} />
                    {CATEGORY_LABELS[c]}
                  </button>
                );
              })}
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border w-fit"
              style={{ background: palette.bg, color: palette.text, borderColor: palette.badge }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: palette.stroke }} />
              {CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] ?? 'Custom'}
            </span>
          )}
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
              <button onClick={handleCancelEdit}
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
        {(editing || node.tags.length > 0) && (
          <div>
            <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Tag size={11} /> Tags
            </p>
            {editing ? (
              <>
                <div
                  className="flex flex-wrap gap-1.5 min-h-[36px] px-2.5 py-1.5 rounded-lg border border-blue-300 dark:border-blue-600 bg-white dark:bg-slate-800 cursor-text focus-within:ring-2 focus-within:ring-blue-200 dark:focus-within:ring-blue-800"
                  onClick={() => document.getElementById('panel-tag-input')?.focus()}>
                  {editTags.map(tag => (
                    <span key={tag}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-600">
                      {tag}
                      <button onClick={() => removeTag(tag)} className="hover:text-rose-500 transition-colors">
                        <X size={9} />
                      </button>
                    </span>
                  ))}
                  <input
                    id="panel-tag-input"
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    onBlur={addTag}
                    placeholder={editTags.length === 0 ? 'Type a tag and press Enter…' : ''}
                    className="flex-1 min-w-[100px] bg-transparent outline-none text-xs text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500"
                  />
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">Lowercase, hyphen-separated. Press Enter or comma to add.</p>
              </>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {node.tags.map(tag => (
                  <span key={tag}
                    className="text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
                    {tag}
                  </span>
                ))}
              </div>
            )}
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
                      Last synced {(() => { const d = new Date(ref.last_synced); const mm = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0'); return `${mm}/${dd}/${d.getFullYear()}`; })()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Attachments */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Paperclip size={11} /> Attachments
              <span className="font-normal normal-case tracking-normal text-slate-300 dark:text-slate-600">({attachments.length})</span>
            </p>
            <button
              onClick={() => attachFileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 px-2 py-1 rounded-lg transition-colors disabled:opacity-50">
              {uploading ? <RefreshCw size={10} className="animate-spin" /> : <Plus size={10} />}
              {uploading ? 'Uploading…' : 'Add'}
            </button>
          </div>
          <input
            ref={attachFileRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.txt"
            className="hidden"
            onChange={e => {
              handleAddFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          {attachments.length === 0 ? (
            <div
              className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 flex flex-col items-center gap-1.5 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-600 hover:bg-indigo-50/30 dark:hover:bg-indigo-900/10 transition-all"
              onClick={() => attachFileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleAddFiles(Array.from(e.dataTransfer.files)); }}
            >
              <Paperclip size={13} className="text-slate-300 dark:text-slate-600" />
              <p className="text-[10px] text-slate-400 dark:text-slate-500">Click or drag to attach files</p>
            </div>
          ) : (
            <div
              className="flex flex-col gap-1"
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleAddFiles(Array.from(e.dataTransfer.files)); }}
            >
              {attachments.map((att: DimNodeAttachment) => (
                <div key={att.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2 min-w-0">
                    <Paperclip size={10} className="text-slate-400 flex-shrink-0" />
                    <span className="text-[11px] text-slate-700 dark:text-slate-200 truncate">{att.filename}</span>
                    <span className="text-[10px] text-slate-400 flex-shrink-0">
                      {att.size_bytes < 1024 * 1024
                        ? `${(att.size_bytes / 1024).toFixed(0)} KB`
                        : `${(att.size_bytes / (1024 * 1024)).toFixed(1)} MB`}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleDownload(att)}
                      disabled={downloading === att.id}
                      title="Download"
                      className="p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-50">
                      {downloading === att.id
                        ? <RefreshCw size={11} className="animate-spin" />
                        : <Download size={11} />}
                    </button>
                    <button
                      onClick={() => handleDeleteAttachment(att.id)}
                      title="Delete"
                      className="p-1 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 transition-colors">
                      <Trash2 size={11} />
                    </button>
                  </div>
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
              ['Valid from', (() => { const d = new Date(node.valid_from); return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}`; })()],
              ['Updated',    (() => { const d = new Date(node.updated_at); return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}`; })()],
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
