// ── src/pages/ComplianceItemPage.tsx ─────────────────────────────────────────

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Scale, FileText, RefreshCw, Plus, Trash2, Check, X,
  Shield, AlertTriangle, ChevronDown, ChevronUp, Upload, Link2, Eye,
} from 'lucide-react';
import { complianceApi } from '../services/complianceApi';
import { useBlueprint } from '../context/BlueprintContext';
import { useCompliance } from '../context/ComplianceContext';
import type {
  ComplianceItem, ComplianceDimension, ComplianceImpact,
  ComplianceDocument, ComplianceDimType, ImpactLevel, GapStatus,
} from '../types/compliance';
import { IMPACT_LEVELS, GAP_STATUS_META, DIM_CATEGORY_META, ITEM_TYPE_META } from '../types/compliance';

type TabId = 'dimensions' | 'impacts' | 'documents';

const ComplianceItemPage: React.FC = () => {
  const { id }    = useParams<{ id: string }>();
  const navigate  = useNavigate();
  const { activeCompany, nodes: blueprintNodes } = useBlueprint();
  const { dimTypes: allDimTypes, refresh: refreshList } = useCompliance();

  const [item,       setItem]       = useState<ComplianceItem | null>(null);
  const [dimensions, setDimensions] = useState<ComplianceDimension[]>([]);
  const [impacts,    setImpacts]    = useState<ComplianceImpact[]>([]);
  const [documents,  setDocuments]  = useState<ComplianceDocument[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [activeTab,  setActiveTab]  = useState<TabId>('dimensions');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [it, dims, docs] = await Promise.all([
        complianceApi.getItem(id),
        complianceApi.listDimensions(id),
        complianceApi.listDocuments(id),
      ]);
      setItem(it);
      setDimensions(dims);
      setDocuments(docs);
      if (activeCompany) {
        const imp = await complianceApi.listImpacts(id, activeCompany.id);
        setImpacts(imp);
      }
    } finally { setLoading(false); }
  }, [id, activeCompany?.id]);

  useEffect(() => { load(); }, [load]);

  if (loading && !item) return (
    <div className="flex items-center justify-center h-64 text-slate-400 dark:text-slate-500 gap-2">
      <RefreshCw size={16} className="animate-spin" /> Loading…
    </div>
  );
  if (!item) return (
    <div className="text-slate-500 p-8">Compliance item not found.</div>
  );

  const meta = ITEM_TYPE_META[item.item_type];

  return (
    <div className="flex flex-col gap-6 w-full pb-12">

      {/* Top bar */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigate('/compliance')}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-all">
          <ArrowLeft size={16} /> Back to Compliance
        </button>
      </div>

      {/* Header card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6 flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl text-white text-xl" style={{ background: meta.color }}>
            {item.item_type === 'regulation' ? <Scale size={22} /> : <FileText size={22} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                style={{ background: meta.bg, color: meta.color, borderColor: meta.bg }}>
                {meta.icon} {meta.label}
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                item.status === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800' :
                'bg-slate-100 text-slate-500 border border-slate-200 dark:bg-slate-800 dark:text-slate-400'
              }`}>{item.status}</span>
              {item.ai_researched && (
                <span className="text-[10px] font-bold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 px-2 py-0.5 rounded-full">
                  ✨ AI researched
                </span>
              )}
            </div>
            {item.short_name && <p className="text-xs text-slate-400 dark:text-slate-500 font-bold">{item.short_name}</p>}
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 leading-snug">{item.name}</h1>
            {item.issuing_body && <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{item.issuing_body}</p>}
            {item.description && <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">{item.description}</p>}
          </div>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-4 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
          {item.jurisdiction?.length > 0 && <span>🌍 {item.jurisdiction.join(', ')}</span>}
          {item.effective_date && <span>📅 Effective {new Date(item.effective_date).toLocaleDateString()}</span>}
          {item.review_date && <span>🔁 Review {new Date(item.review_date).toLocaleDateString()}</span>}
          {item.industry_tags?.length > 0 && item.industry_tags.map(t => (
            <span key={t} className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">{t}</span>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-slate-200 dark:border-slate-800">
        {([['dimensions', 'Dimensions', dimensions.length],
           ['impacts',    'Impact Mapping', impacts.length],
           ['documents',  'Documents', documents.length],
        ] as [TabId, string, number][]).map(([tab, label, count]) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-3 text-xs font-bold border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}>
            {label}
            {count > 0 && (
              <span className="text-[9px] font-bold bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded-full">
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Dimensions tab ──────────────────────────────────────────────────── */}
      {activeTab === 'dimensions' && (
        <DimensionsTab item={item} dimensions={dimensions} dimTypes={allDimTypes} onRefresh={load} />
      )}

      {/* ── Impacts tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'impacts' && activeCompany && (
        <ImpactsTab item={item} impacts={impacts} blueprintNodes={blueprintNodes} company={activeCompany} onRefresh={load} />
      )}
      {activeTab === 'impacts' && !activeCompany && (
        <div className="text-sm text-slate-400 dark:text-slate-500 italic p-4">Select a company in the Blueprint to map impacts.</div>
      )}

      {/* ── Documents tab ───────────────────────────────────────────────────── */}
      {activeTab === 'documents' && (
        <DocumentsTab item={item} documents={documents} onRefresh={load} />
      )}
    </div>
  );
};

// ── Dimensions tab ────────────────────────────────────────────────────────────

const DimensionsTab: React.FC<{
  item: ComplianceItem;
  dimensions: ComplianceDimension[];
  dimTypes: ComplianceDimType[];
  onRefresh: () => void;
}> = ({ item, dimensions, dimTypes, onRefresh }) => {
  const [adding, setAdding] = useState(false);
  const [form,   setForm]   = useState({ label: '', summary: '', dim_type_id: '', tags: '' });
  const [saving, setSaving] = useState(false);

  const scopedTypes = dimTypes.filter(t => t.scope === item.item_type || t.scope === 'both');
  const byCategory  = dimensions.reduce((acc, d) => {
    const cat = d.type_category ?? 'custom';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(d);
    return acc;
  }, {} as Record<string, ComplianceDimension[]>);

  const handleSave = async () => {
    if (!form.label.trim() || !form.dim_type_id) return;
    setSaving(true);
    try {
      await complianceApi.createDimension({
        compliance_item_id: item.id,
        dim_type_id:        form.dim_type_id,
        label:              form.label.trim(),
        summary:            form.summary.trim() || undefined,
        tags:               form.tags.split(',').map(t => t.trim()).filter(Boolean),
      });
      setAdding(false);
      setForm({ label: '', summary: '', dim_type_id: '', tags: '' });
      onRefresh();
    } finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          {dimensions.length} dimensions
        </p>
        <button onClick={() => setAdding(p => !p)}
          className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 px-3 py-1.5 rounded-lg transition-colors border border-indigo-200 dark:border-indigo-800">
          <Plus size={11} /> Add dimension
        </button>
      </div>

      {adding && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-indigo-200 dark:border-indigo-800 p-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Type</label>
              <select value={form.dim_type_id} onChange={e => setForm(p => ({...p, dim_type_id: e.target.value}))}
                className={inputCls}>
                <option value="">Select type…</option>
                {scopedTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Label *</label>
              <input value={form.label} onChange={e => setForm(p => ({...p, label: e.target.value}))}
                placeholder="Dimension label" className={inputCls} autoFocus />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Summary</label>
            <textarea value={form.summary} onChange={e => setForm(p => ({...p, summary: e.target.value}))}
              rows={2} placeholder="2-4 sentence description" className={`${inputCls} resize-none`} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Tags (comma separated)</label>
            <input value={form.tags} onChange={e => setForm(p => ({...p, tags: e.target.value}))}
              placeholder="e.g. privacy, consent, GDPR" className={inputCls} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving || !form.label.trim() || !form.dim_type_id}
              className="flex items-center gap-1.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-1.5 rounded-lg transition-colors disabled:opacity-40">
              {saving ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />} Save
            </button>
          </div>
        </div>
      )}

      {Object.entries(byCategory).map(([cat, dims]) => {
        const m = DIM_CATEGORY_META[cat as keyof typeof DIM_CATEGORY_META] ?? DIM_CATEGORY_META.custom;
        return (
          <div key={cat} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: m.bg, color: m.color }}>{m.label}</span>
              <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
            </div>
            {dims.map(d => (
              <div key={d.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-slate-800 dark:text-slate-100 text-sm">{d.label}</p>
                  <button onClick={async () => { await complianceApi.deleteDimension(d.id); onRefresh(); }}
                    className="text-slate-300 dark:text-slate-600 hover:text-rose-500 transition-colors flex-shrink-0">
                    <Trash2 size={13} />
                  </button>
                </div>
                {d.summary && <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{d.summary}</p>}
                {d.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {d.tags.map((t: string) => (
                      <span key={t} className="text-[9px] bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}

      {dimensions.length === 0 && !adding && (
        <div className="text-sm text-slate-400 dark:text-slate-500 italic text-center py-8">
          No dimensions yet. Click "Add dimension" or run AI research.
        </div>
      )}
    </div>
  );
};

// ── Impacts tab ───────────────────────────────────────────────────────────────

const ImpactsTab: React.FC<{
  item:           ComplianceItem;
  impacts:        ComplianceImpact[];
  blueprintNodes: any[];
  company:        { id: string; name: string };
  onRefresh:      () => void;
}> = ({ item, impacts, blueprintNodes, company, onRefresh }) => {
  const [adding,    setAdding]    = useState(false);
  const [form,      setForm]      = useState<{
    dim_node_id: string; impact_level: ImpactLevel; impact_type: string[];
    gap_description: string; gap_status: GapStatus; current_state: string;
    target_state: string; remediation_plan: string; due_date: string;
  }>({
    dim_node_id: '', impact_level: 'medium', impact_type: [],
    gap_description: '', gap_status: 'open', current_state: '',
    target_state: '', remediation_plan: '', due_date: '',
  });
  const [saving, setSaving] = useState(false);

  const IMPACT_TYPES = ['financial','operational','reputational','regulatory','strategic'];

  const handleSave = async () => {
    setSaving(true);
    try {
      await complianceApi.createImpact({
        compliance_item_id: item.id,
        company_id:         company.id,
        dim_node_id:        form.dim_node_id || undefined,
        impact_level:       form.impact_level,
        impact_type:        form.impact_type,
        gap_description:    form.gap_description || undefined,
        gap_status:         form.gap_status,
        current_state:      form.current_state || undefined,
        target_state:       form.target_state || undefined,
        remediation_plan:   form.remediation_plan || undefined,
        due_date:           form.due_date || undefined,
      });
      setAdding(false);
      onRefresh();
    } finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          Impact mapping for {company.name}
        </p>
        <button onClick={() => setAdding(p => !p)}
          className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 px-3 py-1.5 rounded-lg transition-colors border border-indigo-200 dark:border-indigo-800">
          <Plus size={11} /> Add impact
        </button>
      </div>

      {adding && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-indigo-200 dark:border-indigo-800 p-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Blueprint dimension (optional)</label>
              <select value={form.dim_node_id} onChange={e => setForm(p => ({...p, dim_node_id: e.target.value}))} className={inputCls}>
                <option value="">General item-level impact</option>
                {blueprintNodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Impact level *</label>
              <select value={form.impact_level} onChange={e => setForm(p => ({...p, impact_level: e.target.value as ImpactLevel}))} className={inputCls}>
                {Object.entries(IMPACT_LEVELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Impact types</label>
            <div className="flex flex-wrap gap-1.5">
              {IMPACT_TYPES.map(t => (
                <button key={t} onClick={() => setForm(p => ({...p, impact_type: p.impact_type.includes(t) ? p.impact_type.filter(x => x !== t) : [...p.impact_type, t]}))}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all capitalize ${
                    form.impact_type.includes(t) ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-indigo-300'
                  }`}>{t}</button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Current state</label>
              <textarea value={form.current_state} onChange={e => setForm(p => ({...p, current_state: e.target.value}))}
                rows={2} placeholder="What the company currently has…" className={`${inputCls} resize-none`} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Target / required state</label>
              <textarea value={form.target_state} onChange={e => setForm(p => ({...p, target_state: e.target.value}))}
                rows={2} placeholder="What the regulation requires…" className={`${inputCls} resize-none`} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Gap description</label>
            <textarea value={form.gap_description} onChange={e => setForm(p => ({...p, gap_description: e.target.value}))}
              rows={2} placeholder="Describe the gap between current and required state…" className={`${inputCls} resize-none`} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Gap status</label>
              <select value={form.gap_status} onChange={e => setForm(p => ({...p, gap_status: e.target.value as GapStatus}))} className={inputCls}>
                {Object.entries(GAP_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Due date</label>
              <input type="date" value={form.due_date} onChange={e => setForm(p => ({...p, due_date: e.target.value}))} className={inputCls} />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-1.5 rounded-lg transition-colors disabled:opacity-40">
              {saving ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />} Save impact
            </button>
          </div>
        </div>
      )}

      {impacts.map(imp => {
        const level = IMPACT_LEVELS[imp.impact_level];
        const gap   = GAP_STATUS_META[imp.gap_status];
        return (
          <div key={imp.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                  style={{ background: level.bg, color: level.color, borderColor: level.badge }}>
                  {level.label} impact
                </span>
                {imp.dim_node_label && (
                  <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
                    📌 {imp.dim_node_label}
                  </span>
                )}
                <span className={`text-[10px] font-bold ${gap.color}`}>{gap.label}</span>
              </div>
              <button onClick={async () => { await complianceApi.deleteImpact(imp.id); onRefresh(); }}
                className="text-slate-300 dark:text-slate-600 hover:text-rose-500 transition-colors">
                <Trash2 size={13} />
              </button>
            </div>
            {imp.gap_description && (
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{imp.gap_description}</p>
            )}
            {(imp.current_state || imp.target_state) && (
              <div className="grid grid-cols-2 gap-3 text-xs">
                {imp.current_state && (
                  <div><p className="font-bold text-slate-400 dark:text-slate-500 mb-0.5">Current</p><p className="text-slate-600 dark:text-slate-300">{imp.current_state}</p></div>
                )}
                {imp.target_state && (
                  <div><p className="font-bold text-slate-400 dark:text-slate-500 mb-0.5">Required</p><p className="text-slate-600 dark:text-slate-300">{imp.target_state}</p></div>
                )}
              </div>
            )}
            {imp.due_date && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500">📅 Due {new Date(imp.due_date).toLocaleDateString()}</p>
            )}
          </div>
        );
      })}

      {impacts.length === 0 && !adding && (
        <div className="text-sm text-slate-400 dark:text-slate-500 italic text-center py-8">
          No impact mappings yet. Click "Add impact" to link this obligation to your blueprint dimensions.
        </div>
      )}
    </div>
  );
};

// ── Documents tab ─────────────────────────────────────────────────────────────

const DocumentsTab: React.FC<{
  item:      ComplianceItem;
  documents: ComplianceDocument[];
  onRefresh: () => void;
}> = ({ item, documents, onRefresh }) => {
  const fileRef  = useRef<HTMLInputElement>(null);
  const [url,    setUrl]    = useState('');
  const [urlMode, setUrlMode] = useState(false);
  const [saving, setSaving]  = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>(res => {
        reader.onload = ev => res((ev.target!.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });
      await complianceApi.uploadDocument({
        compliance_item_id: item.id,
        doc_type: item.item_type === 'policy' ? 'policy_text' : 'source',
        title:    file.name,
        filename: file.name,
        mime_type: file.type,
        content_base64: base64,
      });
      onRefresh();
    } finally { setSaving(false); }
  };

  const handleUrl = async () => {
    if (!url.trim()) return;
    setSaving(true);
    try {
      await complianceApi.uploadDocument({
        compliance_item_id: item.id,
        doc_type:   'source',
        title:      url.trim(),
        source_url: url.trim(),
      });
      setUrl(''); setUrlMode(false);
      onRefresh();
    } finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          {documents.length} documents
        </p>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" className="hidden" accept=".pdf,.txt,.docx" onChange={handleFile} />
          <button onClick={() => fileRef.current?.click()} disabled={saving}
            className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 px-3 py-1.5 rounded-lg transition-colors border border-indigo-200 dark:border-indigo-800 disabled:opacity-40">
            {saving ? <RefreshCw size={11} className="animate-spin" /> : <Upload size={11} />} Upload
          </button>
          <button onClick={() => setUrlMode(p => !p)}
            className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 px-3 py-1.5 rounded-lg transition-colors border border-indigo-200 dark:border-indigo-800">
            <Link2 size={11} /> Add URL
          </button>
        </div>
      </div>

      {urlMode && (
        <div className="flex gap-2">
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…"
            className={`${inputCls} flex-1`} autoFocus />
          <button onClick={handleUrl} disabled={!url.trim() || saving}
            className="flex items-center gap-1 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-2 rounded-lg transition-colors disabled:opacity-40">
            <Check size={13} />
          </button>
          <button onClick={() => setUrlMode(false)} className="text-slate-400 hover:text-slate-700 px-2 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <X size={13} />
          </button>
        </div>
      )}

      {documents.map(doc => (
        <div key={doc.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex items-start gap-3">
          <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg flex-shrink-0">
            <FileText size={16} className="text-slate-500 dark:text-slate-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate">{doc.title}</p>
            <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
              <span className="capitalize">{doc.doc_type.replace('_', ' ')}</span>
              {doc.file_size_bytes && <span>{(doc.file_size_bytes / 1024).toFixed(0)}KB</span>}
              {doc.source_url && <a href={doc.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Open URL</a>}
            </div>
            {doc.ai_summary && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{doc.ai_summary}</p>}
          </div>
          <button onClick={async () => { await complianceApi.deleteDocument(doc.id); onRefresh(); }}
            className="text-slate-300 dark:text-slate-600 hover:text-rose-500 transition-colors flex-shrink-0">
            <Trash2 size={13} />
          </button>
        </div>
      ))}

      {documents.length === 0 && !urlMode && (
        <div className="text-sm text-slate-400 dark:text-slate-500 italic text-center py-8">
          No documents yet. Upload a PDF or add a source URL.
        </div>
      )}
    </div>
  );
};

const inputCls = "w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800 focus:border-indigo-300 dark:focus:border-indigo-600 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all";

export default ComplianceItemPage;
