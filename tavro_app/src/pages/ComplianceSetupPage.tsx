// ── src/pages/ComplianceSetupPage.tsx ────────────────────────────────────────

import React, { useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Scale, FileText, ChevronRight, ChevronLeft, Check, RefreshCw,
  Sparkles, AlertTriangle, Info, Globe, Upload, Link, X, Eye, EyeOff,
} from 'lucide-react';
import { complianceApi } from '../services/complianceApi';
import { useCompliance } from '../context/ComplianceContext';
import { useBlueprint } from '../context/BlueprintContext';
import type { ComplianceItemType } from '../types/compliance';
import { ITEM_TYPE_META } from '../types/compliance';

const JURISDICTIONS = ['US','US-FL','US-NY','US-CA','US-TX','EU','UK','CA','AU','GLOBAL'];
const INDUSTRIES    = ['banking','fintech','insurance','healthcare','manufacturing','retail','technology','all-industries'];

const ComplianceSetupPage: React.FC = () => {
  const navigate       = useNavigate();
  const [searchParams] = useSearchParams();
  const { refresh }    = useCompliance();
  const { activeCompany } = useBlueprint();

  const defaultType = (searchParams.get('type') ?? 'regulation') as ComplianceItemType;
  const [step,  setStep]  = useState(1);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({
    item_type:    defaultType,
    name:         '',
    short_name:   '',
    description:  '',
    issuing_body: '',
    jurisdiction: [] as string[],
    industry_tags: [] as string[],
    effective_date: '',
  });

  // Research state
  const [researching,    setResearching]    = useState(false);
  const [researchResult, setResearchResult] = useState<any | null>(null);
  const [researchError,  setResearchError]  = useState<string | null>(null);
  const [selectedDims,   setSelectedDims]   = useState<Set<number>>(new Set());

  // Document upload state
  const fileRef = useRef<HTMLInputElement>(null);
  const [docFile,    setDocFile]    = useState<File | null>(null);
  const [docText,    setDocText]    = useState('');
  const [sourceUrl,  setSourceUrl]  = useState('');
  const [uploadMode, setUploadMode] = useState<'file' | 'url' | null>(null);

  const update = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));
  const toggleArr = (k: string, v: string) => update(k, form[k as 'jurisdiction' | 'industry_tags'].includes(v)
    ? form[k as 'jurisdiction' | 'industry_tags'].filter((x: string) => x !== v)
    : [...form[k as 'jurisdiction' | 'industry_tags'], v]
  );

  const meta = ITEM_TYPE_META[form.item_type];

  // ── Step 2: Research ───────────────────────────────────────────────────────
  const handleResearch = async () => {
    setResearching(true);
    setResearchError(null);
    setResearchResult(null);
    try {
      let jobId: string;
      if (form.item_type === 'regulation') {
        const { job_id } = await complianceApi.researchRegulation({
          name: form.name, short_name: form.short_name || undefined,
          issuing_body: form.issuing_body || undefined,
          jurisdiction: form.jurisdiction, industry_tags: form.industry_tags,
        });
        jobId = job_id;
      } else {
        let docTxt = docText;
        if (docFile && !docTxt) {
          if (docFile.type === 'application/pdf') {
            docTxt = '[PDF uploaded — AI will analyse structure]';
          } else {
            docTxt = await docFile.text();
          }
          setDocText(docTxt);
        }
        const { job_id } = await complianceApi.researchPolicy({
          name: form.name, company_id: activeCompany!.id,
          description: form.description || undefined,
          doc_text: docTxt || undefined,
        });
        jobId = job_id;
      }
      const result = await complianceApi.pollResearchJob(jobId);
      setResearchResult(result);
      setSelectedDims(new Set(result.dimensions.map((_: any, i: number) => i)));
    } catch (err: any) {
      setResearchError(err.message ?? 'Research failed');
    } finally {
      setResearching(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDocFile(file);
    if (!file.type.includes('pdf')) {
      const text = await file.text();
      setDocText(text.slice(0, 8000));
    }
  };

  // ── Final create ───────────────────────────────────────────────────────────
  const handleCreate = async () => {
    setSaving(true);
    setError(null);
    try {
      // 1. Create the compliance item
      const item = await complianceApi.createItem({
        item_type:    form.item_type,
        scope:        form.item_type === 'regulation' ? 'external' : 'internal',
        name:         form.name.trim(),
        short_name:   form.short_name.trim() || undefined,
        description:  form.description.trim() || undefined,
        issuing_body: form.issuing_body.trim() || undefined,
        jurisdiction: form.jurisdiction,
        industry_tags: form.industry_tags,
        company_id:   form.item_type === 'policy' ? activeCompany?.id : undefined,
        effective_date: form.effective_date || undefined,
      });

      // 2. Save researched dimensions
      if (researchResult && selectedDims.size > 0) {
        const dims = researchResult.dimensions.filter((_: any, i: number) => selectedDims.has(i));
        await complianceApi.saveDimensions(item.id, dims);
      }

      // 3. Upload document if provided
      if (docFile) {
        const reader = new FileReader();
        const base64 = await new Promise<string>(res => {
          reader.onload = e => res((e.target!.result as string).split(',')[1]);
          reader.readAsDataURL(docFile);
        });
        await complianceApi.uploadDocument({
          compliance_item_id: item.id,
          doc_type: form.item_type === 'policy' ? 'policy_text' : 'source',
          title:    docFile.name,
          filename: docFile.name,
          mime_type: docFile.type,
          content_base64: base64,
        });
      } else if (sourceUrl.trim()) {
        await complianceApi.uploadDocument({
          compliance_item_id: item.id,
          doc_type:   'source',
          title:      `${form.name} — source document`,
          source_url: sourceUrl.trim(),
        });
      }

      refresh();
      navigate(`/compliance/${item.id}`);
    } catch (err: any) {
      setError(err.message ?? 'Failed to create');
    } finally {
      setSaving(false);
    }
  };

  const totalSteps = 4;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-slate-50 dark:bg-slate-950 transition-colors">

      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-8 py-5 flex items-center gap-3 flex-shrink-0">
        <div className="p-2 rounded-lg text-white" style={{ background: step < 3 ? meta.color : '#16a34a' }}>
          {form.item_type === 'regulation' ? <Scale size={18} /> : <FileText size={18} />}
        </div>
        <div>
          <h1 className="font-bold text-slate-800 dark:text-slate-100">
            Add {meta.label}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {step === 1 ? 'Identify the obligation' : step === 2 ? 'AI research & documentation' : step === 3 ? 'Review dimensions' : 'Confirm & create'}
          </p>
        </div>
        {/* Steps */}
        <div className="ml-auto flex items-center gap-1.5">
          {Array.from({length: totalSteps}, (_, i) => i + 1).map(s => (
            <React.Fragment key={s}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                s === step ? 'bg-indigo-600 text-white' : s < step ? 'bg-emerald-500 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-400'
              }`}>
                {s < step ? <Check size={10} /> : s}
              </div>
              {s < totalSteps && <div className="w-4 h-px bg-slate-200 dark:bg-slate-700" />}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center px-8 py-8">
        <div className="w-full max-w-2xl flex flex-col gap-5">

          {/* ── Step 1: Identity ──────────────────────────────────────────── */}
          {step === 1 && (
            <Card>
              {/* Type toggle */}
              <div className="grid grid-cols-2 gap-3">
                {(['regulation', 'policy'] as ComplianceItemType[]).map(t => {
                  const m = ITEM_TYPE_META[t];
                  const active = form.item_type === t;
                  return (
                    <button key={t} onClick={() => update('item_type', t)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                        active ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 shadow-sm' : 'border-slate-200 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-700 bg-white dark:bg-slate-800/50'
                      }`}>
                      <span className="text-2xl">{m.icon}</span>
                      <div>
                        <p className={`font-bold text-sm ${active ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-200'}`}>{m.label}</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500">{t === 'regulation' ? 'External rule or law' : 'Internal policy or guideline'}</p>
                      </div>
                      {active && <Check size={14} className="ml-auto text-indigo-600" />}
                    </button>
                  );
                })}
              </div>

              {form.item_type === 'policy' && !activeCompany && (
                <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
                  <AlertTriangle size={14} /> Select a company in the Blueprint before adding a policy.
                </div>
              )}

              <Field label="Name" required>
                <input value={form.name} onChange={e => update('name', e.target.value)} autoFocus
                  placeholder={form.item_type === 'regulation' ? 'e.g. Bank Secrecy Act' : 'e.g. Data Classification Policy'}
                  className={inputCls} />
              </Field>

              <Field label={form.item_type === 'regulation' ? 'Short name / acronym' : 'Policy number / code'}>
                <input value={form.short_name} onChange={e => update('short_name', e.target.value)}
                  placeholder={form.item_type === 'regulation' ? 'e.g. BSA' : 'e.g. POL-2024-001'}
                  className={inputCls} />
              </Field>

              {form.item_type === 'regulation' && (
                <Field label="Issuing body">
                  <input value={form.issuing_body} onChange={e => update('issuing_body', e.target.value)}
                    placeholder="e.g. FinCEN, OCC, SEC, CFPB"
                    className={inputCls} />
                </Field>
              )}

              <Field label="Description">
                <textarea value={form.description} onChange={e => update('description', e.target.value)}
                  rows={3} placeholder="Brief description of what this covers…"
                  className={`${inputCls} resize-none`} />
              </Field>

              {form.item_type === 'regulation' && (
                <>
                  <Field label="Jurisdiction">
                    <div className="flex flex-wrap gap-1.5">
                      {JURISDICTIONS.map(j => (
                        <button key={j} onClick={() => toggleArr('jurisdiction', j)}
                          className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all ${
                            form.jurisdiction.includes(j) ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-blue-300'
                          }`}>
                          {j}
                        </button>
                      ))}
                    </div>
                  </Field>

                  <Field label="Industry tags">
                    <div className="flex flex-wrap gap-1.5">
                      {INDUSTRIES.map(ind => (
                        <button key={ind} onClick={() => toggleArr('industry_tags', ind)}
                          className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all ${
                            form.industry_tags.includes(ind) ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-indigo-300'
                          }`}>
                          {ind}
                        </button>
                      ))}
                    </div>
                  </Field>
                </>
              )}

              <Field label="Effective date">
                <input type="date" value={form.effective_date} onChange={e => update('effective_date', e.target.value)}
                  className={inputCls} />
              </Field>

              <div className="flex justify-end pt-1">
                <button onClick={() => setStep(2)}
                  disabled={!form.name.trim() || (form.item_type === 'policy' && !activeCompany)}
                  className={`${btnPrimary} disabled:opacity-40 disabled:cursor-not-allowed`}>
                  Continue <ChevronRight size={16} />
                </button>
              </div>
            </Card>
          )}

          {/* ── Step 2: Research & documents ──────────────────────────────── */}
          {step === 2 && (
            <Card>
              <div className="flex items-center gap-2.5 mb-1">
                <Sparkles size={16} className="text-violet-500" />
                <p className="font-bold text-slate-800 dark:text-slate-100">AI Research</p>
              </div>

              {/* Document upload (policy only) */}
              {form.item_type === 'policy' && (
                <div className="flex flex-col gap-3">
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Supporting document (optional)</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setUploadMode(uploadMode === 'file' ? null : 'file')}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all text-sm ${uploadMode === 'file' ? 'border-violet-400 bg-violet-50 dark:bg-violet-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-violet-200 bg-white dark:bg-slate-800/50'}`}>
                      <Upload size={14} className="text-violet-500" /> Upload PDF / text
                    </button>
                    <button onClick={() => setUploadMode(uploadMode === 'url' ? null : 'url')}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all text-sm ${uploadMode === 'url' ? 'border-violet-400 bg-violet-50 dark:bg-violet-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-violet-200 bg-white dark:bg-slate-800/50'}`}>
                      <Link size={14} className="text-violet-500" /> Paste URL
                    </button>
                  </div>

                  {uploadMode === 'file' && (
                    <div className="flex flex-col gap-2">
                      <input ref={fileRef} type="file" accept=".pdf,.txt,.docx" className="hidden" onChange={handleFileChange} />
                      {docFile ? (
                        <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3">
                          <FileText size={14} className="text-violet-500" />
                          {docFile.name} ({(docFile.size / 1024).toFixed(0)}KB)
                          <button onClick={() => { setDocFile(null); setDocText(''); }} className="ml-auto text-slate-400 hover:text-rose-500">
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => fileRef.current?.click()}
                          className="text-sm text-violet-600 dark:text-violet-400 border-2 border-dashed border-violet-200 dark:border-violet-800 rounded-xl px-4 py-6 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors text-center">
                          Click to upload policy document
                        </button>
                      )}
                    </div>
                  )}

                  {uploadMode === 'url' && (
                    <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)}
                      placeholder="https://…"
                      className={inputCls} />
                  )}
                </div>
              )}

              {/* Research trigger */}
              {!researchResult && !researching && (
                <div className="flex flex-col items-center gap-4 py-6">
                  <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
                    AI will research <strong className="text-slate-700 dark:text-slate-200">{form.name}</strong> and suggest compliance dimensions for your review.
                  </p>
                  {researchError && (
                    <div className="flex items-center gap-2 text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl px-4 py-3 w-full">
                      <AlertTriangle size={14} /> {researchError}
                    </div>
                  )}
                  <button onClick={handleResearch} className={btnPrimary}>
                    <Sparkles size={14} /> Research {form.name}
                  </button>
                </div>
              )}

              {researching && (
                <div className="flex flex-col items-center gap-3 py-8">
                  <RefreshCw size={24} className="animate-spin text-indigo-500" />
                  <p className="text-sm text-slate-500 dark:text-slate-400 animate-pulse">
                    Researching {form.name}…
                  </p>
                </div>
              )}

              {researchResult && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
                    <Info size={12} className="text-amber-600 mt-0.5 flex-shrink-0" />
                    <p className="text-[11px] text-amber-700 dark:text-amber-300">{researchResult.notice}</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                      {selectedDims.size} of {researchResult.dimensions.length} dimensions selected
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setSelectedDims(new Set(researchResult.dimensions.map((_: any, i: number) => i)))}
                        className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline font-bold">Select all</button>
                      <span className="text-slate-300">·</span>
                      <button onClick={() => setSelectedDims(new Set())}
                        className="text-[11px] text-slate-400 hover:underline">Clear</button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
                    {researchResult.dimensions.map((d: any, i: number) => {
                      const sel = selectedDims.has(i);
                      return (
                        <button key={i} onClick={() => setSelectedDims(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s; })}
                          className={`flex items-start gap-3 px-3 py-3 rounded-xl border text-left transition-all ${sel ? 'border-indigo-300 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 opacity-60'}`}>
                          <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${sel ? 'border-indigo-500 bg-indigo-500' : 'border-slate-300 dark:border-slate-600'}`}>
                            {sel && <Check size={9} className="text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded">
                                {d.category}
                              </span>
                            </div>
                            <p className="font-bold text-slate-800 dark:text-slate-100 text-sm">{d.label}</p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{d.summary}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <button onClick={handleResearch} className="text-[11px] text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1 self-start">
                    <RefreshCw size={10} /> Re-run research
                  </button>
                </div>
              )}

              <div className="flex justify-between pt-2">
                <button onClick={() => setStep(1)} className={btnSecondary}><ChevronLeft size={16} /> Back</button>
                <button onClick={() => setStep(3)} className={btnPrimary}>
                  {researchResult ? `Continue with ${selectedDims.size} dimensions` : 'Skip research'}
                  <ChevronRight size={16} />
                </button>
              </div>
            </Card>
          )}

          {/* ── Step 3: Skip (placeholder for manual dimension adding post-create) */}
          {step === 3 && (
            <Card>
              <div className="text-center py-6">
                <Check size={32} className="text-emerald-500 mx-auto mb-3" />
                <p className="font-bold text-slate-800 dark:text-slate-100">Ready to create</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
                  After creating, you can add more dimensions, map impacts to your company blueprint, and upload additional documents from the detail view.
                </p>
              </div>
              <div className="flex justify-between">
                <button onClick={() => setStep(2)} className={btnSecondary}><ChevronLeft size={16} /> Back</button>
                <button onClick={() => setStep(4)} className={btnPrimary}>Review & confirm <ChevronRight size={16} /></button>
              </div>
            </Card>
          )}

          {/* ── Step 4: Confirm ───────────────────────────────────────────── */}
          {step === 4 && (
            <Card>
              <p className="font-bold text-slate-800 dark:text-slate-100">Confirm</p>
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                {[
                  ['Type',         `${meta.icon} ${meta.label}`],
                  ['Name',         form.name],
                  ...(form.short_name ? [['Short name', form.short_name]] : []),
                  ...(form.issuing_body ? [['Issuing body', form.issuing_body]] : []),
                  ...(form.jurisdiction.length ? [['Jurisdiction', form.jurisdiction.join(', ')]] : []),
                  ['Dimensions',   researchResult && selectedDims.size > 0 ? `${selectedDims.size} AI-researched` : 'Add manually after creation'],
                  ['Document',     docFile ? docFile.name : sourceUrl || 'None'],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center gap-4 px-5 py-3">
                    <span className="text-xs font-bold text-slate-400 dark:text-slate-500 w-28 flex-shrink-0">{k}</span>
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{v as string}</span>
                  </div>
                ))}
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl px-4 py-3">
                  <AlertTriangle size={14} /> {error}
                </div>
              )}

              <div className="flex justify-between">
                <button onClick={() => setStep(3)} className={btnSecondary}><ChevronLeft size={16} /> Back</button>
                <button onClick={handleCreate} disabled={saving}
                  className={`${btnPrimary} disabled:opacity-50`}>
                  {saving ? <><RefreshCw size={14} className="animate-spin" /> Creating…</> : <><Check size={14} /> Create</>}
                </button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-7 flex flex-col gap-4 transition-colors">
    {children}
  </div>
);

const Field: React.FC<{ label: string; required?: boolean; children: React.ReactNode }> = ({ label, required, children }) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-xs font-bold text-slate-600 dark:text-slate-400">
      {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
    </label>
    {children}
  </div>
);

const inputCls = "w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800 focus:border-indigo-300 dark:focus:border-indigo-600 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all";
const btnPrimary   = "flex items-center gap-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 dark:hover:bg-indigo-500 px-5 py-2.5 rounded-xl shadow-sm transition-colors";
const btnSecondary = "flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 px-4 py-2.5 rounded-xl transition-colors";

export default ComplianceSetupPage;
