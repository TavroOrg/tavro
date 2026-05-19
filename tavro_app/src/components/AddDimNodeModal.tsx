// ── src/components/AddDimNodeModal.tsx ───────────────────────────────────────
// Modal for creating a new dimension node.
// Triggered from the "+ Add dimension" button on BlueprintPage.

import React, { useState, useEffect, useRef } from 'react';
import { X, Plus, RefreshCw, Shield, Eye, EyeOff, Sparkles, Paperclip } from 'lucide-react';
import { blueprintApi } from '../services/blueprintApi';
import { useBlueprint } from '../context/BlueprintContext';
import type { DimCategory, VisibilityLevel, DimType } from '../types/blueprint';
import { CATEGORY_PALETTE, CATEGORY_LABELS } from '../types/blueprint';

interface AddDimNodeModalProps {
  onClose:   () => void;
  onCreated: () => void;
  /** Pre-select a category (e.g. when clicking "+ Add" from a filtered view) */
  defaultCategory?: DimCategory;
}

const VISIBILITY_OPTIONS: { value: VisibilityLevel; label: string; desc: string }[] = [
  { value: 'public',       label: 'Public',       desc: 'Any authenticated user' },
  { value: 'internal',     label: 'Internal',     desc: 'Company members only' },
  { value: 'restricted',   label: 'Restricted',   desc: 'Named roles only' },
  { value: 'confidential', label: 'Confidential', desc: 'Admin + data steward only' },
];

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB — matches nginx client_max_body_size

const filterBySize = (files: File[], onReject: (names: string[]) => void): File[] => {
  const ok = files.filter(f => f.size <= MAX_FILE_BYTES);
  const bad = files.filter(f => f.size > MAX_FILE_BYTES).map(f => f.name);
  if (bad.length) onReject(bad);
  return ok;
};

const REL_TYPES = [
  'depends_on', 'owned_by', 'supports', 'risks',
  'enables', 'part_of', 'governed_by', 'replaced_by', 'custom',
];

const AddDimNodeModal: React.FC<AddDimNodeModalProps> = ({
  onClose, onCreated, defaultCategory,
}) => {
  const { activeCompany, dimTypes, nodes } = useBlueprint();

  const [label,      setLabel]      = useState('');
  const [summary,    setSummary]    = useState('');
  const [category,   setCategory]   = useState<DimCategory>(defaultCategory ?? 'process');
  const [tagInput,   setTagInput]   = useState('');
  const [tags,       setTags]       = useState<string[]>([]);
  const [visibility, setVisibility] = useState<VisibilityLevel>('internal');
  const [sensitive,  setSensitive]  = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [saving,     setSaving]     = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  useEffect(() => { labelRef.current?.focus(); }, []);

  // Derive dim_type_id from selected category
  const dimTypeId = dimTypes.find(t => t.category === category)?.id ?? '';

  const addTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (t && !tags.includes(t)) setTags(p => [...p, t]);
    setTagInput('');
  };

  const removeTag = (tag: string) => setTags(p => p.filter(t => t !== tag));

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
    if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags(p => p.slice(0, -1));
    }
  };

  const handleSuggest = async () => {
    if (!label.trim())    { setError('Enter a label first so the AI has something to work with'); return; }
    if (!activeCompany)   { setError('No active company selected'); return; }
    setGenerating(true);
    setError(null);
    try {
      const result = await (blueprintApi as any).suggestDimension({
        company_id:    activeCompany.id,
        company_name:  activeCompany.name,
        industry:      activeCompany.industry,
        category,
        label:         label.trim(),
        existing_dims: nodes.map(n => n.label).slice(0, 20),
      });
      if (result.summary) setSummary(result.summary);
      if (result.tags?.length) setTags(result.tags);
    } catch (err: any) {
      setError(err.message ?? 'AI suggestion failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleSubmit = async () => {
    if (!label.trim()) { setError('Label is required'); return; }
    if (!dimTypeId)    { setError('Could not find dimension type for this category'); return; }
    if (!activeCompany) { setError('No active company selected'); return; }

    setSaving(true);
    setError(null);
    try {
      const created = await blueprintApi.createNode({
        company_id:  activeCompany.id,
        dim_type_id: dimTypeId,
        label:       label.trim(),
        summary:     summary.trim() || undefined,
        tags,
        visibility,
        sensitive,
      });
      if (attachments.length > 0) {
        await Promise.all(attachments.map(f => blueprintApi.uploadAttachment(created.id, f)));
      }
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message ?? 'Failed to create dimension');
    } finally {
      setSaving(false);
    }
  };

  const palette = CATEGORY_PALETTE[category];

  return (
    <Overlay onClose={onClose}>
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg" style={{ background: palette.bg, border: `1px solid ${palette.badge}` }}>
              <Plus size={15} style={{ color: palette.stroke }} />
            </div>
            <div>
              <h2 className="font-bold text-slate-800 dark:text-slate-100 text-sm">Add dimension</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {activeCompany?.name ?? 'No company selected'}
              </p>
            </div>
          </div>
          <button onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4">

          {/* Category */}
          <Field label="Category" required>
            <div className="grid grid-cols-4 gap-1.5">
              {(Object.keys(CATEGORY_LABELS) as DimCategory[]).map(cat => {
                const p = CATEGORY_PALETTE[cat];
                const active = category === cat;
                return (
                  <button key={cat} onClick={() => setCategory(cat)}
                    className="flex flex-col items-center gap-1 px-2 py-2 rounded-xl border text-center transition-all"
                    style={active
                      ? { background: p.bg, borderColor: p.stroke }
                      : { background: 'transparent', borderColor: 'var(--color-border-tertiary)' }
                    }>
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.stroke }} />
                    <span className="text-[10px] font-bold leading-tight"
                      style={{ color: active ? p.text : 'var(--color-text-secondary)' }}>
                      {CATEGORY_LABELS[cat]}
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Label */}
          <Field label="Label" required>
            <input
              ref={labelRef}
              value={label}
              onChange={e => setLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder={`e.g. ${category === 'application' ? 'Salesforce CRM' : category === 'risk' ? 'Data Breach Risk' : category === 'process' ? 'Loan Origination' : 'Enter a name'}`}
              className={inputCls}
            />
          </Field>

          {/* Summary */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Summary</label>
              <button
                onClick={handleSuggest}
                disabled={generating || !label.trim()}
                title={label.trim() ? 'Generate summary and tags with AI' : 'Enter a label first'}
                className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg border transition-all ${
                  generating
                    ? 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-700 text-violet-500 cursor-wait'
                    : label.trim()
                    ? 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-700 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/40 hover:border-violet-300 dark:hover:border-violet-600'
                    : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-300 dark:text-slate-600 cursor-not-allowed'
                }`}
              >
                {generating
                  ? <RefreshCw size={11} className="animate-spin" />
                  : <Sparkles size={11} />}
                {generating ? 'Generating…' : 'AI assist'}
              </button>
            </div>
            <div className="relative">
              <textarea
                value={summary}
                onChange={e => setSummary(e.target.value)}
                placeholder={generating ? 'Generating summary…' : '2–5 sentences describing what this dimension is. Or click AI assist to generate.'}
                rows={4}
                className={`${inputCls} resize-y min-h-[100px] transition-all ${generating ? 'opacity-50' : ''}`}
                disabled={generating}
              />
              {generating && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/60 dark:bg-slate-800/60">
                  <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400 text-[11px] font-bold">
                    <Sparkles size={13} className="animate-pulse" />
                    Generating with AI…
                  </div>
                </div>
              )}
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">
              This text is used directly as AI context — keep it concise and specific.
            </p>
          </div>

          {/* Tags */}
          <Field label="Tags">
            <div className={`${inputCls} flex flex-wrap gap-1.5 min-h-[40px] cursor-text`}
              onClick={() => document.getElementById('tag-input')?.focus()}>
              {tags.map(tag => (
                <span key={tag}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-600">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="hover:text-rose-500 transition-colors">
                    <X size={9} />
                  </button>
                </span>
              ))}
              <input
                id="tag-input"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={addTag}
                placeholder={tags.length === 0 ? 'Type a tag and press Enter…' : ''}
                className="flex-1 min-w-[120px] bg-transparent outline-none text-xs text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500"
              />
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
              Lowercase, hyphen-separated. Press Enter or comma to add.
            </p>
          </Field>

          {/* Visibility */}
          <Field label="Visibility">
            <div className="grid grid-cols-2 gap-2">
              {VISIBILITY_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => setVisibility(opt.value)}
                  className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border text-left transition-all ${
                    visibility === opt.value
                      ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-800/50'
                  }`}>
                  {visibility === opt.value
                    ? <Eye size={12} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                    : <EyeOff size={12} className="text-slate-400 flex-shrink-0 mt-0.5" />}
                  <div>
                    <p className={`text-[11px] font-bold ${visibility === opt.value ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-200'}`}>
                      {opt.label}
                    </p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </Field>

          {/* Sensitive toggle */}
          <button onClick={() => setSensitive(p => !p)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
              sensitive
                ? 'border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/20'
                : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-800/50'
            }`}>
            <div className={`p-1.5 rounded-lg ${sensitive ? 'bg-rose-100 dark:bg-rose-900/40' : 'bg-slate-100 dark:bg-slate-700'}`}>
              <Shield size={13} className={sensitive ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'} />
            </div>
            <div className="flex-1">
              <p className={`text-[11px] font-bold ${sensitive ? 'text-rose-700 dark:text-rose-300' : 'text-slate-700 dark:text-slate-200'}`}>
                Mark as sensitive
              </p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                Summary will be redacted before being sent to any LLM
              </p>
            </div>
            <div className={`w-8 h-4.5 rounded-full border-2 transition-all flex items-center ${
              sensitive ? 'bg-rose-500 border-rose-500 justify-end' : 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 justify-start'
            }`}>
              <div className="w-3 h-3 bg-white rounded-full mx-0.5 shadow-sm" />
            </div>
          </button>

          {/* Attachments */}
          <Field label="Attachments">
            <div
              className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl px-4 py-4 flex flex-col items-center gap-2 cursor-pointer hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50/40 dark:hover:bg-blue-900/10 transition-all"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                const dropped = filterBySize(Array.from(e.dataTransfer.files), names =>
                  setError(`File(s) exceed 50 MB limit: ${names.join(', ')}`));
                setAttachments(prev => {
                  const existing = new Set(prev.map(f => f.name));
                  return [...prev, ...dropped.filter(f => !existing.has(f.name))];
                });
              }}
            >
              <Paperclip size={16} className="text-slate-400" />
              <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
                Click or drag files to attach
              </p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                PDF, DOCX, XLSX, PNG, JPG — up to 50 MB each
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.txt"
                className="hidden"
                onChange={e => {
                  const selected = filterBySize(Array.from(e.target.files ?? []), names =>
                    setError(`File(s) exceed 50 MB limit: ${names.join(', ')}`));
                  setAttachments(prev => {
                    const existing = new Set(prev.map(f => f.name));
                    return [...prev, ...selected.filter(f => !existing.has(f.name))];
                  });
                  e.target.value = '';
                }}
              />
            </div>
            {attachments.length > 0 && (
              <ul className="flex flex-col gap-1 mt-1">
                {attachments.map(file => (
                  <li key={file.name}
                    className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-2 min-w-0">
                      <Paperclip size={11} className="text-slate-400 flex-shrink-0" />
                      <span className="text-[11px] text-slate-700 dark:text-slate-200 truncate">{file.name}</span>
                      <span className="text-[10px] text-slate-400 flex-shrink-0">
                        {file.size < 1024 * 1024
                          ? `${(file.size / 1024).toFixed(0)} KB`
                          : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
                      </span>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); setAttachments(p => p.filter(f => f.name !== file.name)); }}
                      className="text-slate-400 hover:text-rose-500 transition-colors flex-shrink-0">
                      <X size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Field>

          {error && (
            <div className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl px-4 py-3">
              {error}
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
          <button onClick={onClose}
            className="text-sm font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 px-4 py-2 rounded-lg transition-colors">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving || !label.trim()}
            className="flex items-center gap-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500 px-5 py-2 rounded-lg shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
            {saving ? 'Creating…' : 'Create dimension'}
          </button>
        </div>
      </div>
    </Overlay>
  );
};

// ── Shared overlay ────────────────────────────────────────────────────────────
export const Overlay: React.FC<{ onClose: () => void; children: React.ReactNode }> = ({ onClose, children }) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
    onClick={e => { if (e.target === e.currentTarget) onClose(); }}
  >
    {children}
  </div>
);

// ── Shared field wrapper ──────────────────────────────────────────────────────
export const Field: React.FC<{ label: string; required?: boolean; children: React.ReactNode }> = ({ label, required, children }) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-xs font-bold text-slate-600 dark:text-slate-400">
      {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
    </label>
    {children}
  </div>
);

// ── Shared input class ────────────────────────────────────────────────────────
export const inputCls = "w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 focus:border-blue-300 dark:focus:border-blue-600 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all";

export default AddDimNodeModal;
