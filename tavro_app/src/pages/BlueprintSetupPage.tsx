// ── src/pages/BlueprintSetupPage.tsx (FULL REPLACEMENT) ──────────────────────
// 4-step setup flow:
//   Step 1 — Company identity + public / private toggle
//   Step 2 — AI research preview (public only) — skip for private
//   Step 3 — Industry template (Process, Application, Technology, Risk)
//   Step 4 — Confirm + create

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, ChevronRight, ChevronLeft, Check, Layers,
  RefreshCw, Search, Globe, Lock, Sparkles, AlertTriangle,
  CheckCircle2, Info, Eye, EyeOff,
} from 'lucide-react';
import { blueprintApi } from '../services/blueprintApi';
import { useBlueprint } from '../context/BlueprintContext';
import type { CompanyCreate } from '../types/blueprint';
import { CATEGORY_PALETTE, CATEGORY_LABELS } from '../types/blueprint';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ResearchedNode {
  category:   string;
  label:      string;
  summary:    string;
  tags:       string[];
  visibility: string;
  sensitive:  boolean;
}

interface ResearchResult {
  nodes:   ResearchedNode[];
  sources: string[];
  notice:  string;
}

// ── Industry templates ────────────────────────────────────────────────────────

const TEMPLATES = [
  {
    id:    'banking',
    label: 'Commercial Banking',
    desc:  'CRE, C&I, deposits, AML/BSA, regulatory reporting',
    icon:  '🏦',
    counts: { process: 7, application: 7, technology: 4, risk: 6 },
  },
  {
    id:    'insurance',
    label: 'Insurance',
    desc:  'Underwriting, claims, actuarial, regulatory filings',
    icon:  '🛡️',
    counts: { process: 5, application: 4, technology: 3, risk: 5 },
  },
  {
    id:    'healthcare',
    label: 'Healthcare',
    desc:  'Clinical operations, EHR, HIPAA, revenue cycle',
    icon:  '🏥',
    counts: { process: 5, application: 5, technology: 3, risk: 4 },
  },
  {
    id:    'manufacturing',
    label: 'Manufacturing',
    desc:  'Supply chain, ERP, MES, OT/IT, quality management',
    icon:  '🏭',
    counts: { process: 5, application: 4, technology: 4, risk: 4 },
  },
  {
    id:    'retail',
    label: 'Retail & CPG',
    desc:  'Merchandising, omnichannel, loyalty, supply chain',
    icon:  '🛍️',
    counts: { process: 5, application: 5, technology: 3, risk: 4 },
  },
  {
    id:    'tech',
    label: 'Technology',
    desc:  'Product, engineering, SRE, AI governance, SaaS ops',
    icon:  '💻',
    counts: { process: 5, application: 5, technology: 4, risk: 4 },
  },
  {
    id:    'blank',
    label: 'Blank canvas',
    desc:  'Start from scratch — add your own dimensions',
    icon:  '📋',
    counts: { process: 0, application: 0, technology: 0, risk: 0 },
  },
];

// ── Main component ────────────────────────────────────────────────────────────

const BlueprintSetupPage: React.FC = () => {
  const navigate = useNavigate();
  const { selectCompany } = useBlueprint();

  // ── Step state ─────────────────────────────────────────────────────────────
  // Steps: 1=identity, 2=research (public only), 3=template, 4=confirm
  const [step, setStep] = useState(1);

  // ── Form state ─────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    name:         '',
    industry:     '',
    legal_entity: '',
    is_public:    false as boolean | null,   // null = not selected yet
    ticker:       '',
  });

  // ── Research state ─────────────────────────────────────────────────────────
  const [researching,     setResearching]     = useState(false);
  const [researchStatus,  setResearchStatus]  = useState<string>('');
  const [researchResult,  setResearchResult]  = useState<ResearchResult | null>(null);
  const [researchError,   setResearchError]   = useState<string | null>(null);
  const [selectedNodes,   setSelectedNodes]   = useState<Set<number>>(new Set());

  // ── Template state ─────────────────────────────────────────────────────────
  const [template, setTemplate] = useState('');

  // ── Create state ───────────────────────────────────────────────────────────
  const [saving,    setSaving]   = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const update = (field: string, value: any) =>
    setForm(p => ({ ...p, [field]: value }));

  // ── Step 1 → 2 ────────────────────────────────────────────────────────────
  const handleStep1Continue = () => {
    setStep(2);
  };

  // ── Research ───────────────────────────────────────────────────────────────
  // We need a company_id to pass to research. Create the company row first,
  // then research, then seed. The company row is created in step 4 actually
  // — for research preview we don't need a company_id yet.
  // We'll pass a temp placeholder; the backend research endpoint doesn't
  // use company_id — it's only needed for seed endpoints.

  const handleResearch = async () => {
    setResearching(true);
    setResearchError(null);
    setResearchResult(null);
    setResearchStatus('Starting…');

    const requestParams = {
      company_id:   'preview',
      company_name: form.name,
      ticker:       form.ticker || undefined,
      industry:     form.industry,
      is_public:    form.is_public === true,
    };

    console.group(`[Blueprint Research] ${form.name} — ${form.is_public ? 'PUBLIC' : 'PRIVATE'}`);
    console.log('[Request] params sent to /blueprint/research:', requestParams);

    try {
      const stream = blueprintApi.researchCompanyStream(requestParams);
      for await (const event of stream) {
        console.log(`[SSE event] type="${event.type}"`, event);
        if (event.type === 'status') {
          setResearchStatus(event.message);
        } else if (event.type === 'result') {
          console.log('[Result] nodes count:', event.data.nodes.length);
          console.log('[Result] sources:', event.data.sources);
          console.log('[Result] notice:', event.data.notice);
          console.table(event.data.nodes.map((n: any) => ({
            category: n.category,
            label:    n.label,
            sensitive: n.sensitive,
            tags:     n.tags.join(', '),
          })));
          setResearchResult(event.data as any);
          setSelectedNodes(new Set(event.data.nodes.map((_: any, i: number) => i)));
          setResearching(false);
        } else if (event.type === 'error') {
          console.error('[Error event]', event.message);
          throw new Error(event.message);
        }
        // heartbeat events logged above, no other action needed
      }
    } catch (err: any) {
      console.error('[Research failed]', err);
      setResearchError(err.message ?? 'Research failed');
      setResearching(false);
    } finally {
      console.groupEnd();
      setResearching(false);
    }
  };

  const toggleNode = (i: number) =>
    setSelectedNodes(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  // ── Final create ───────────────────────────────────────────────────────────
  const handleCreate = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // 1. Create the company
      const company = await blueprintApi.createCompany({
        name:         form.name.trim(),
        industry:     form.industry.trim(),
        legal_entity: form.legal_entity?.trim() || undefined,
      });

      // 2. Save AI-researched nodes (if any selected)
      if (researchResult && selectedNodes.size > 0) {
        const nodesToSave = researchResult.nodes.filter((_, i) => selectedNodes.has(i));
        await (blueprintApi as any).saveResearchedNodes(company.id, nodesToSave);
      }

      // 3. Seed industry template nodes
      if (template && template !== 'blank') {
        await (blueprintApi as any).seedTemplate(company.id, template);
      }

      // 4. Navigate to blueprint
      selectCompany(company);
      navigate('/blueprint');
    } catch (err: any) {
      setSaveError(err.message ?? 'Failed to create blueprint');
    } finally {
      setSaving(false);
    }
  };

  // ── Step labels ────────────────────────────────────────────────────────────
  const steps = ['Identity', 'AI Research', 'Template', 'Confirm'];
  const displayStep = step;

  const selectedTemplate = TEMPLATES.find(t => t.id === template);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-slate-50 dark:bg-slate-950 transition-colors">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-8 py-5 flex items-center gap-3 flex-shrink-0 transition-colors">
        <div className="bg-blue-600 text-white p-2 rounded-lg shadow-sm">
          <Layers size={18} />
        </div>
        <div>
          <h1 className="font-bold text-slate-800 dark:text-slate-100">New Company Blueprint</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">Set up the foundation for AI analysis</p>
        </div>

        {/* Step indicator */}
        <div className="ml-auto flex items-center gap-2">
          {steps.map((label, i) => {
            const s = i + 1;
            const active = s === displayStep;
            const done   = s < displayStep;
            return (
              <React.Fragment key={label}>
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-all ${
                  active ? 'bg-blue-600 text-white shadow-sm'
                  : done  ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'
                }`}>
                  {done && <Check size={10} />}
                  {label}
                </div>
                {i < steps.length - 1 && (
                  <ChevronRight size={12} className="text-slate-300 dark:text-slate-600" />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex items-start justify-center px-8 py-10">
        <div className="w-full max-w-2xl flex flex-col gap-6">

          {/* ════════════════════════════════════════════════════════════════
              STEP 1 — Identity
          ════════════════════════════════════════════════════════════════ */}
          {step === 1 && (
            <Card icon={<Building2 size={18} className="text-blue-600 dark:text-blue-400" />}
              title="Company identity" desc="Core details that anchor the blueprint">

              <Field label="Company name" required>
                <input value={form.name} onChange={e => update('name', e.target.value)}
                  placeholder="e.g. BankUnited" className={inputCls} autoFocus />
              </Field>

              <Field label="Industry" required>
                <input value={form.industry} onChange={e => update('industry', e.target.value)}
                  placeholder="e.g. Commercial Banking" className={inputCls} />
              </Field>

              <Field label="Legal entity name">
                <input value={form.legal_entity} onChange={e => update('legal_entity', e.target.value)}
                  placeholder="e.g. BankUnited, N.A. (optional)" className={inputCls} />
              </Field>

              {/* Public / Private toggle */}
              <Field label="Company type" required>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => update('is_public', true)}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border text-left transition-all ${
                      form.is_public === true
                        ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20 shadow-sm'
                        : 'border-slate-200 dark:border-slate-700 hover:border-blue-200 dark:hover:border-blue-700 bg-white dark:bg-slate-800/50'
                    }`}>
                    <div className={`p-2 rounded-lg ${form.is_public === true ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-slate-100 dark:bg-slate-700'}`}>
                      <Globe size={16} className={form.is_public === true ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'} />
                    </div>
                    <div>
                      <p className={`font-bold text-sm ${form.is_public === true ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-200'}`}>
                        Public company
                      </p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                        Listed on a stock exchange
                      </p>
                    </div>
                    {form.is_public === true && (
                      <Check size={14} className="ml-auto text-blue-600 dark:text-blue-400" />
                    )}
                  </button>

                  <button onClick={() => update('is_public', false)}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border text-left transition-all ${
                      form.is_public === false
                        ? 'border-slate-600 dark:border-slate-400 bg-slate-50 dark:bg-slate-800/50 shadow-sm'
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 bg-white dark:bg-slate-800/50'
                    }`}>
                    <div className={`p-2 rounded-lg ${form.is_public === false ? 'bg-slate-200 dark:bg-slate-700' : 'bg-slate-100 dark:bg-slate-700'}`}>
                      <Lock size={16} className={form.is_public === false ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400'} />
                    </div>
                    <div>
                      <p className={`font-bold text-sm ${form.is_public === false ? 'text-slate-700 dark:text-slate-200' : 'text-slate-700 dark:text-slate-200'}`}>
                        Private company
                      </p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                        Not publicly traded
                      </p>
                    </div>
                    {form.is_public === false && (
                      <Check size={14} className="ml-auto text-slate-600 dark:text-slate-400" />
                    )}
                  </button>
                </div>
              </Field>

              {/* Ticker (public only) */}
              {form.is_public === true && (
                <Field label="Stock ticker symbol">
                  <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={form.ticker} onChange={e => update('ticker', e.target.value.toUpperCase())}
                      placeholder="e.g. BKU, JPM, BAC"
                      className={`${inputCls} pl-8`} />
                  </div>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 flex items-center gap-1">
                    <Info size={10} />
                    Helps AI research find accurate public filings and annual reports
                  </p>
                </Field>
              )}

              {form.is_public === true && (
                <div className="flex items-start gap-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl px-4 py-3">
                  <Sparkles size={14} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[11px] font-bold text-blue-700 dark:text-blue-300">AI research will pre-populate your blueprint</p>
                    <p className="text-[11px] text-blue-600/70 dark:text-blue-400/70 mt-0.5">
                      Tavro will use publicly available information to suggest Profile, Strategy, Organisation, and Finance dimensions. You review and confirm before anything is saved.
                    </p>
                  </div>
                </div>
              )}
              {form.is_public === false && (
                <div className="flex items-start gap-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3">
                  <Sparkles size={14} className="text-slate-500 dark:text-slate-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">AI will suggest baseline dimensions</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Tavro will use AI to generate Profile, Strategy, Organisation, and Finance dimension suggestions based on your company info. You review and confirm before anything is saved.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex justify-between pt-2">
                <button onClick={() => navigate('/blueprint')} className={btnSecondary}>
                  Cancel
                </button>
                <button onClick={handleStep1Continue}
                  disabled={!form.name.trim() || !form.industry.trim() || form.is_public === null}
                  className={btnPrimary + " disabled:opacity-40 disabled:cursor-not-allowed"}>
                  Continue <ChevronRight size={16} />
                </button>
              </div>
            </Card>
          )}

          {/* ════════════════════════════════════════════════════════════════
              STEP 2 — AI Research (public + private)
          ════════════════════════════════════════════════════════════════ */}
          {step === 2 && (
            <Card icon={<Sparkles size={18} className="text-blue-600 dark:text-blue-400" />}
              title="AI research preview"
              desc={form.is_public
                ? "Tavro researches public filings and suggests dimensions for your review"
                : "Tavro uses AI to generate baseline dimension suggestions for your review"}>

              {/* Research trigger */}
              {!researchResult && !researching && (
                <div className="flex flex-col items-center gap-4 py-6">
                  <div className={`p-4 rounded-2xl border ${form.is_public ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800' : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'}`}>
                    {form.is_public
                      ? <Globe size={32} className="text-blue-500 dark:text-blue-400" />
                      : <Lock size={32} className="text-slate-500 dark:text-slate-400" />}
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-slate-800 dark:text-slate-100">
                      Ready to research {form.name}
                      {form.ticker && <span className="text-blue-600 dark:text-blue-400"> ({form.ticker})</span>}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      {form.is_public
                        ? 'Searches public filings, annual reports, and company website to suggest Profile, Strategy, Organisation, and Finance dimensions.'
                        : 'Uses AI to generate baseline Profile, Strategy, Organisation, and Finance dimension suggestions based on the company name and industry you provided.'}
                    </p>
                  </div>
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

              {/* Researching spinner */}
              {researching && (
                <div className="flex flex-col items-center gap-5 py-10">
                  <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 flex items-center justify-center">
                    <RefreshCw size={24} className="text-blue-500 animate-spin" />
                  </div>
                  <div className="text-center max-w-sm">
                    <p className="font-bold text-slate-800 dark:text-slate-100 text-base">
                      Researching {form.name}…
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                      Please wait a few seconds.
                    </p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                      {form.is_public
                        ? "We're scanning SEC filings, annual reports, and public data to build your blueprint."
                        : "We're generating AI-powered dimension suggestions based on your company profile."}
                    </p>
                  </div>
                </div>
              )}

              {/* Results */}
              {researchResult && (
                <div className="flex flex-col gap-4">
                  {/* Notice banner */}
                  <div className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
                    <Info size={13} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-700 dark:text-amber-300">{researchResult.notice}</p>
                  </div>

                  {/* Sources */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500">Sources:</span>
                    {researchResult.sources.map(s => (
                      <span key={s} className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
                        {s}
                      </span>
                    ))}
                  </div>

                  {/* Select all / none */}
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                      {selectedNodes.size} of {researchResult.nodes.length} dimensions selected
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setSelectedNodes(new Set(researchResult.nodes.map((_, i) => i)))}
                        className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline">
                        Select all
                      </button>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <button onClick={() => setSelectedNodes(new Set())}
                        className="text-[11px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:underline">
                        Clear
                      </button>
                    </div>
                  </div>

                  {/* Node cards */}
                  <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto pr-1">
                    {researchResult.nodes.map((node, i) => {
                      const cat = node.category as keyof typeof CATEGORY_PALETTE;
                      const p   = CATEGORY_PALETTE[cat] ?? CATEGORY_PALETTE.custom;
                      const sel = selectedNodes.has(i);
                      return (
                        <button key={i} onClick={() => toggleNode(i)}
                          className={`flex items-start gap-3 px-4 py-3.5 rounded-xl border text-left transition-all ${
                            sel
                              ? 'border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 opacity-60'
                          }`}>
                          <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-all ${
                            sel ? 'border-blue-500 bg-blue-500' : 'border-slate-300 dark:border-slate-600'
                          }`}>
                            {sel && <Check size={10} className="text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border"
                                style={{ background: p.bg, color: p.text, borderColor: p.badge }}>
                                <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.stroke }} />
                                {CATEGORY_LABELS[cat] ?? cat}
                              </span>
                              {node.sensitive && (
                                <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                                  <EyeOff size={9} /> Sensitive
                                </span>
                              )}
                            </div>
                            <p className="font-bold text-slate-800 dark:text-slate-100 text-sm">{node.label}</p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{node.summary}</p>
                            {node.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {node.tags.slice(0, 5).map(tag => (
                                  <span key={tag} className="text-[9px] bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500 px-1.5 py-0.5 rounded-full">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Re-research button */}
                  <button onClick={handleResearch}
                    className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors self-start">
                    <RefreshCw size={11} /> Re-run research
                  </button>
                </div>
              )}

              <div className="flex justify-between pt-2">
                <button onClick={() => setStep(1)} className={btnSecondary}>
                  <ChevronLeft size={16} /> Back
                </button>
                <button onClick={() => setStep(3)}
                  className={btnPrimary}>
                  {researchResult
                    ? `Continue with ${selectedNodes.size} dimension${selectedNodes.size !== 1 ? 's' : ''}`
                    : 'Skip research'}
                  <ChevronRight size={16} />
                </button>
              </div>
            </Card>
          )}

          {/* ════════════════════════════════════════════════════════════════
              STEP 3 — Industry template
          ════════════════════════════════════════════════════════════════ */}
          {step === 3 && (
            <Card icon={<Layers size={18} className="text-blue-600 dark:text-blue-400" />}
              title="Industry template"
              desc="Pre-populates Process, Application, Technology, and Risk dimensions">

              <div className="flex flex-col gap-2.5">
                {TEMPLATES.map(t => {
                  const active = template === t.id;
                  const total  = Object.values(t.counts).reduce((a, b) => a + b, 0);
                  return (
                    <button key={t.id} onClick={() => setTemplate(t.id)}
                      className={`flex items-center gap-4 px-4 py-4 rounded-xl border text-left transition-all ${
                        active
                          ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20 shadow-sm'
                          : 'border-slate-200 dark:border-slate-700 hover:border-blue-200 dark:hover:border-blue-700 bg-white dark:bg-slate-800/50'
                      }`}>
                      <span className="text-2xl flex-shrink-0">{t.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`font-bold text-sm ${active ? 'text-blue-700 dark:text-blue-300' : 'text-slate-800 dark:text-slate-100'}`}>
                            {t.label}
                          </p>
                          {total > 0 && (
                            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
                              {total} dimensions
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{t.desc}</p>
                        {total > 0 && (
                          <div className="flex gap-2 mt-1.5 flex-wrap">
                            {Object.entries(t.counts).filter(([, v]) => v > 0).map(([cat, count]) => {
                              const p = CATEGORY_PALETTE[cat as keyof typeof CATEGORY_PALETTE] ?? CATEGORY_PALETTE.custom;
                              return (
                                <span key={cat} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border"
                                  style={{ background: p.bg, color: p.text, borderColor: p.badge }}>
                                  {count} {cat}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                        active ? 'border-blue-500 bg-blue-500' : 'border-slate-300 dark:border-slate-600'
                      }`}>
                        {active && <Check size={10} className="text-white" />}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex justify-between pt-2">
                <button onClick={() => setStep(2)} className={btnSecondary}>
                  <ChevronLeft size={16} /> Back
                </button>
                <button onClick={() => setStep(4)} disabled={!template} className={btnPrimary + " disabled:opacity-40 disabled:cursor-not-allowed"}>
                  Continue <ChevronRight size={16} />
                </button>
              </div>
            </Card>
          )}

          {/* ════════════════════════════════════════════════════════════════
              STEP 4 — Confirm
          ════════════════════════════════════════════════════════════════ */}
          {step === 4 && (
            <Card icon={<CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400" />}
              title="Confirm your blueprint"
              desc="Review what will be created">

              {/* Summary table */}
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                {[
                  ['Company',      form.name],
                  ['Industry',     form.industry],
                  ['Legal entity', form.legal_entity || '—'],
                  ['Type',         form.is_public ? '🌐 Public company' : '🔒 Private company'],
                  ...(form.ticker ? [['Ticker', form.ticker]] : []),
                  ['Template',     selectedTemplate ? `${selectedTemplate.icon} ${selectedTemplate.label}` : '—'],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center gap-4 px-5 py-3">
                    <span className="text-xs font-bold text-slate-400 dark:text-slate-500 w-32 flex-shrink-0">{k}</span>
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{v}</span>
                  </div>
                ))}
              </div>

              {/* What will be created */}
              <div className="flex flex-col gap-2">
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Dimensions to be created
                </p>
                <div className="flex flex-col gap-1.5">
                  {researchResult && selectedNodes.size > 0 && (
                    <div className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg px-3 py-2">
                      <Sparkles size={11} className="text-blue-500" />
                      <span className="font-bold">{selectedNodes.size}</span> AI-researched dimensions
                      <span className="text-slate-400 dark:text-slate-500">(Profile, Strategy, Organisation, Finance)</span>
                    </div>
                  )}
                  {selectedTemplate && selectedTemplate.id !== 'blank' && (
                    <div className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2">
                      <span>{selectedTemplate.icon}</span>
                      <span className="font-bold">
                        {Object.values(selectedTemplate.counts).reduce((a, b) => a + b, 0)}
                      </span> template dimensions
                      <span className="text-slate-400 dark:text-slate-500">(Process, Application, Technology, Risk)</span>
                    </div>
                  )}
                  {(!researchResult || selectedNodes.size === 0) && selectedTemplate?.id === 'blank' && (
                    <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 italic px-3 py-2">
                      Starting blank — you'll add dimensions manually
                    </div>
                  )}
                </div>
              </div>

              {saveError && (
                <div className="flex items-center gap-2 text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl px-4 py-3">
                  <AlertTriangle size={14} /> {saveError}
                </div>
              )}

              <div className="flex justify-between pt-2">
                <button onClick={() => setStep(3)} className={btnSecondary}>
                  <ChevronLeft size={16} /> Back
                </button>
                <button onClick={handleCreate} disabled={saving}
                  className={btnPrimary + " disabled:opacity-50"}>
                  {saving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                  {saving ? 'Creating blueprint…' : 'Create Blueprint'}
                </button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

const Card: React.FC<{
  icon: React.ReactNode;
  title: string;
  desc: string;
  children: React.ReactNode;
}> = ({ icon, title, desc, children }) => (
  <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-8 flex flex-col gap-5 transition-colors">
    <div className="flex items-center gap-3">
      <div className="p-2.5 bg-blue-50 dark:bg-blue-900/30 rounded-xl border border-blue-100 dark:border-blue-800">
        {icon}
      </div>
      <div>
        <h2 className="font-bold text-slate-800 dark:text-slate-100">{title}</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{desc}</p>
      </div>
    </div>
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

const inputCls = "w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 focus:border-blue-300 dark:focus:border-blue-600 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all";

const btnPrimary = "flex items-center gap-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500 px-5 py-2.5 rounded-xl shadow-sm transition-colors";

const btnSecondary = "flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 px-4 py-2.5 rounded-xl transition-colors";

export default BlueprintSetupPage;
