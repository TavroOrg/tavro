// ── src/components/audit/AuditInitModal.tsx ──────────────────────────────────
// Reusable modal for initiating a compliance audit.
// Works from UseCaseViewPage, AgentViewPage, CompliancePage.

import React, { useState, useEffect } from 'react';
import {
  X, ShieldCheck, Scale, FileText, Loader2, ChevronRight,
  AlertTriangle, Info,
} from 'lucide-react';
import { auditApi } from '../../services/auditApi';
import { complianceApi } from '../../services/complianceApi';
import { useBlueprint } from '../../context/BlueprintContext';
import type { AuditScopeType } from '../../types/audit';
import type { ComplianceItem } from '../../types/compliance';
import { SCOPE_LABELS } from '../../types/audit';
import { ITEM_TYPE_META } from '../../types/compliance';

interface Props {
  open:          boolean;
  onClose:       () => void;
  onLaunched:    (runId: string) => void;
  // Pre-fill from the page that opened the modal
  prefillUseCaseId?:   string;
  prefillUseCaseName?: string;
  prefillAgentId?:     string;
  prefillAgentName?:   string;
  prefillCompItemId?:  string;
  mode?: 'use_case' | 'agent' | 'compliance' | 'general';
}

const AuditInitModal: React.FC<Props> = ({
  open, onClose, onLaunched,
  prefillUseCaseId, prefillUseCaseName,
  prefillAgentId, prefillAgentName,
  prefillCompItemId, mode = 'general',
}) => {
  const { activeCompany } = useBlueprint();
  const [compItems,   setCompItems]   = useState<ComplianceItem[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  // Form state
  const [scopeType,     setScopeType]     = useState<AuditScopeType>(
    prefillUseCaseId || prefillAgentId
      ? (prefillCompItemId ? 'single' : 'use_case_all')
      : (prefillCompItemId ? 'catalog_single' : 'full')
  );
  const [selectedCompId, setSelectedCompId] = useState<string>(prefillCompItemId ?? '');

  useEffect(() => {
    if (!open || !activeCompany) return;
    setLoading(true);
    complianceApi.listItems({ status: 'active', company_id: activeCompany.id, limit: 100 })
      .then(p => setCompItems(p.items))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, activeCompany?.id]);

  // Derived
  const hasUseCase = !!(prefillUseCaseId || prefillAgentId);
  const hasCompItem = !!selectedCompId;

  const scopeOptions: { value: AuditScopeType; label: string; enabled: boolean }[] = [
    {
      value:   'single',
      label:   SCOPE_LABELS.single,
      enabled: hasUseCase && hasCompItem,
    },
    {
      value:   'use_case_all',
      label:   SCOPE_LABELS.use_case_all,
      enabled: hasUseCase,
    },
    {
      value:   'catalog_single',
      label:   SCOPE_LABELS.catalog_single,
      enabled: hasCompItem,
    },
    {
      value:   'full',
      label:   SCOPE_LABELS.full,
      enabled: true,
    },
  ];

  const handleSubmit = async () => {
    if (!activeCompany) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await auditApi.initiateAudit({
        company_id:         activeCompany.id,
        scope_type:         scopeType,
        use_case_id:        prefillUseCaseId,
        use_case_name:      prefillUseCaseName,
        agent_id:           prefillAgentId,
        agent_name:         prefillAgentName,
        compliance_item_id: selectedCompId || undefined,
        initiated_by:       'user',
      });
      // Small delay so the DB commit is visible before the detail page queries it
      setTimeout(() => {
        onLaunched(result.audit_run_id);
        onClose();
      }, 400);
    } catch (e: any) {
      setError(e.message ?? 'Failed to initiate audit');
    } finally {
      setSubmitting(false);
    }
  };

  // Auto-adjust scope when selections change
  useEffect(() => {
    if (hasUseCase && hasCompItem && scopeType === 'full')          setScopeType('single');
    if (hasUseCase && !hasCompItem && scopeType === 'single')       setScopeType('use_case_all');
    if (!hasUseCase && hasCompItem && scopeType === 'use_case_all') setScopeType('catalog_single');
  }, [hasUseCase, hasCompItem]);

  if (!open) return null;

  const regs      = compItems.filter(i => i.item_type === 'regulation');
  const policies  = compItems.filter(i => i.item_type === 'policy');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-xl">
              <ShieldCheck size={18} className="text-white" />
            </div>
            <div>
              <p className="font-bold text-slate-800 dark:text-slate-100">Run Compliance Audit</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {activeCompany?.name ?? 'Select a company in Blueprint first'}
              </p>
            </div>
          </div>
          <button onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5 overflow-y-auto">
          {!activeCompany && (
            <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
              <AlertTriangle size={14} /> Select a company in the Blueprint before running an audit.
            </div>
          )}

          {/* Context chips */}
          <div className="flex flex-wrap gap-2">
            {(prefillUseCaseName || prefillAgentName) && (
              <span className="flex items-center gap-1.5 text-[11px] font-bold bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 px-2.5 py-1 rounded-full">
                🤖 {prefillAgentName ?? prefillUseCaseName}
              </span>
            )}
            {selectedCompId && (
              <span className="flex items-center gap-1.5 text-[11px] font-bold bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 px-2.5 py-1 rounded-full">
                ⚖️ {compItems.find(i => i.id === selectedCompId)?.short_name ?? compItems.find(i => i.id === selectedCompId)?.name ?? 'Selected regulation'}
              </span>
            )}
          </div>

          {/* Compliance item selector */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
              Regulation / Policy
            </label>
            <select
              value={selectedCompId}
              onChange={e => setSelectedCompId(e.target.value)}
              disabled={loading || !!prefillCompItemId}
              className={inputCls}
            >
              <option value="">All active regulations & policies</option>
              {regs.length > 0 && (
                <optgroup label="Regulations">
                  {regs.map(i => (
                    <option key={i.id} value={i.id}>
                      {i.short_name ? `${i.short_name} — ` : ''}{i.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {policies.length > 0 && (
                <optgroup label="Policies">
                  {policies.map(i => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            {loading && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                <Loader2 size={10} className="animate-spin" /> Loading compliance items…
              </p>
            )}
          </div>

          {/* Scope selector */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
              Audit scope
            </label>
            <div className="flex flex-col gap-1.5">
              {scopeOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => opt.enabled && setScopeType(opt.value)}
                  disabled={!opt.enabled}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                    scopeType === opt.value && opt.enabled
                      ? 'border-indigo-400 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 shadow-sm'
                      : opt.enabled
                      ? 'border-slate-200 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-700 bg-white dark:bg-slate-800/50'
                      : 'border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/20 opacity-40 cursor-not-allowed'
                  }`}
                >
                  <div className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                    scopeType === opt.value && opt.enabled
                      ? 'border-indigo-500 bg-indigo-500'
                      : 'border-slate-300 dark:border-slate-600'
                  }`}>
                    {scopeType === opt.value && opt.enabled && (
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${
                      scopeType === opt.value && opt.enabled
                        ? 'text-indigo-700 dark:text-indigo-300'
                        : 'text-slate-700 dark:text-slate-200'
                    }`}>{opt.label}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Info box */}
          <div className="flex items-start gap-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3">
            <Info size={12} className="text-slate-400 dark:text-slate-500 mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Each assessment runs a dedicated Claude agent that cross-references the use case details against
              regulation requirements and your company blueprint. Results stream live in the Audit Center.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl px-4 py-3">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
          <button onClick={onClose}
            className="text-sm font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-4 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !activeCompany || loading}
            className="flex items-center gap-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 dark:hover:bg-indigo-500 px-5 py-2.5 rounded-xl shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting
              ? <><Loader2 size={14} className="animate-spin" /> Launching…</>
              : <><ShieldCheck size={14} /> Launch audit <ChevronRight size={14} /></>
            }
          </button>
        </div>
      </div>
    </div>
  );
};

const inputCls = "w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800 focus:border-indigo-300 dark:focus:border-indigo-600 text-slate-800 dark:text-slate-100 disabled:opacity-60 transition-all";

export default AuditInitModal;
