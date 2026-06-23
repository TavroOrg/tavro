import React from 'react';
import { readRoadmapConfig } from '../services/roadmapConfig';
import { useCaseApi } from '../services/useCaseApi';
import { Link } from 'react-router-dom';
import { UseCaseDetail } from '../types/useCase';
import {
    Building2,
    ShieldCheck,
    ClipboardList,
    ShieldAlert,
    CheckCircle2,
    Clock,
    Archive,
    AlertTriangle,
    Target,
    FileText,
    Users,
    Bot,
    Tag,
    Info,
    CalendarDays,
    User,
    Loader2,
    ChevronDown,
} from 'lucide-react';




interface UseCaseViewProps {
    useCase: UseCaseDetail;
    agentsComponent?: React.ReactNode;
    businessImpactComponent?: React.ReactNode;
    headerActions?: React.ReactNode;
    isEditing?: boolean;
    editTitle?: string;
    onEditTitleChange?: (v: string) => void;
    editDescription?: string;
    onEditDescriptionChange?: (v: string) => void;
    editPriority?: string;
    onEditPriorityChange?: (v: string) => void;
    editOwner?: string;
    onEditOwnerChange?: (v: string) => void;
    editProblemStatement?: string;
    onEditProblemStatementChange?: (v: string) => void;
    editExpectedBenefits?: string;
    onEditExpectedBenefitsChange?: (v: string) => void;
    editSolutionApproach?: string;
    onEditSolutionApproachChange?: (v: string) => void;
    inlineEdit?: { field: string; value: string } | null;
    inlineSaving?: string | null;
    onStartInlineEdit?: (field: string, value: string) => void;
    onInlineValueChange?: (v: string) => void;
    onSaveInlineEdit?: () => void;
    onCancelInlineEdit?: () => void;
}

function MetaBadge({ text, color = 'slate' }: { text: string; color?: 'blue' | 'emerald' | 'amber' | 'slate' }) {
    const cls = {
        blue: 'bg-blue-50 text-blue-700 border-blue-100',
        emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        amber: 'bg-amber-50 text-amber-700 border-amber-100',
        slate: 'bg-slate-100 text-slate-600 border-slate-200',
    }[color];
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide ${cls}`}>
            {text}
        </span>
    );
}


function StatusBadge({ status }: { status?: string | null }) {
    if (!status) return <span className="text-slate-400 text-xs">—</span>;
    const s = status.toLowerCase();
    const cls = s.includes('active')
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : s.includes('review')
            ? 'bg-amber-50 text-amber-700 border-amber-200'
            : s.includes('deprecat')
                ? 'bg-slate-100 text-slate-500 border-slate-200'
                : 'bg-blue-50 text-blue-700 border-blue-200';
    const Icon = s.includes('active') ? CheckCircle2 : s.includes('review') ? Clock : s.includes('deprecat') ? Archive : AlertTriangle;
    return (
        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border ${cls}`}>
            <Icon size={11} /> {status}
        </span>
    );
}

function RiskBadge({ classification }: { classification?: string | null }) {
    if (!classification) return null;
    const r = classification.toLowerCase();
    const cls = r.includes('critical') || r.includes('high')
        ? 'bg-red-50 text-red-700 border-red-200'
        : r.includes('medium')
            ? 'bg-amber-50 text-amber-700 border-amber-200'
            : 'bg-emerald-50 text-emerald-700 border-emerald-200';
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${cls}`}>
            <ShieldAlert size={11} /> {classification}
        </span>
    );
}

function SectionCard({ icon, title, count, children }: { icon: React.ReactNode; title: string; count?: number; children: React.ReactNode }) {
    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                <span className="text-slate-500">{icon}</span>
                <span className="font-bold text-slate-800 text-sm">{title}</span>
                {count !== undefined && (
                    <span className="ml-1 text-xs font-semibold text-slate-400">({count})</span>
                )}
            </div>
            <div className="p-5">{children}</div>
        </div>
    );
}

function MetaField({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-1">
            <dt className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</dt>
            <dd className="text-sm text-slate-700">{children}</dd>
        </div>
    );
}

function formatDate(raw?: string | null): string {
    if (!raw) return '—';
    try {
        const date = new Date(raw);
        if (Number.isNaN(date.getTime())) return raw;
        const pad = (value: number) => String(value).padStart(2, '0');
        return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    } catch {
        return raw;
    }
}

function getLabel(item: any, fallback = 'N/A'): string {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return fallback;
    const labelFields = ['name', 'display_value', 'u_display_name', 'title', 'u_name', 'identifier', 'agent_id', 'short_description'];
    for (const field of labelFields) {
        if (item[field] && typeof item[field] === 'string' && item[field] !== (item.value ?? item.sys_id)) return item[field];
    }
    if (item.display_value && item.display_value !== item.value) return item.display_value;
    for (const key of Object.keys(item)) {
        const v = item[key];
        if (v && typeof v === 'object') {
            const nestedLabel = getLabel(v, '');
            if (nestedLabel && nestedLabel !== '') return nestedLabel;
        }
    }
    return item.sys_id ?? item.id ?? item.value ?? fallback;
}

function getId(item: any): string | undefined {
    return item?.sys_id ?? item?.id ?? item?.identifier ?? item?.value ?? item?.agent_id ?? item?.business_application_id;
}

// ── Prioritization risk dimensions (spec §3.4) ────────────────────────────────

interface RiskOption    { score: number; tier: string; description: string; }
interface RiskDimension { key: string; label: string; question: string; options: RiskOption[]; }

const RISK_DIMENSIONS: RiskDimension[] = [
    {
        key: 'data_privacy',
        label: 'Data & Privacy Risk',
        question: 'How sensitive is the data this agent will access and process?',
        options: [
            { score: 1, tier: 'Minimal',  description: 'Internal, non-sensitive data only. No PII, no regulated data classes. No meaningful privacy risk.' },
            { score: 2, tier: 'Low',      description: 'Some internal data with light sensitivity. Non-regulated PII in internal workflows. Standard access controls sufficient.' },
            { score: 3, tier: 'Moderate', description: 'Personally identifiable or commercially sensitive data. Standard data governance applies. Breach would have moderate internal impact.' },
            { score: 4, tier: 'High',     description: 'Sensitive personal data (financial, health-adjacent, HR). Subject to GDPR, CCPA, or equivalent. Breach impact is material.' },
            { score: 5, tier: 'Critical', description: 'Highly sensitive data (health records, financial transactions, legal, biometric). Subject to strict oversight. Breach risk is severe and public.' },
        ],
    },
    {
        key: 'operational',
        label: 'Operational Risk',
        question: 'What is the operational consequence if this agent makes an error or fails?',
        options: [
            { score: 1, tier: 'Negligible', description: 'Advisory mode only. No autonomous actions. Errors surfaced for human review and easily corrected with no downstream impact.' },
            { score: 2, tier: 'Low',        description: 'Minor autonomous actions within narrow boundaries. Errors have limited impact and are readily reversible.' },
            { score: 3, tier: 'Moderate',   description: 'Decisions with moderate operational consequences. Errors may affect a team or workflow but are detectable and correctable.' },
            { score: 4, tier: 'High',       description: 'High-frequency or high-consequence decisions. Errors could cause financial loss, service disruption, or significant process failure.' },
            { score: 5, tier: 'Severe',     description: 'Controls or directly influences mission-critical operations. Errors could cause major financial loss, regulatory breach, or safety incident.' },
        ],
    },
    {
        key: 'compliance',
        label: 'Compliance Risk',
        question: 'What is the regulatory exposure of this use case?',
        options: [
            { score: 1, tier: 'None',     description: 'No specific regulatory obligation. Internal policy compliance only. No audit or examination exposure.' },
            { score: 2, tier: 'Low',      description: 'Subject to general corporate policy and internal audit. Basic audit trail is best practice but not mandated.' },
            { score: 3, tier: 'Moderate', description: 'Subject to industry standards or sector regulation. Audit trail, explainability, and documented controls required.' },
            { score: 4, tier: 'High',     description: 'Subject to strict regulatory oversight. Regulator scrutiny likely. Non-compliance penalties are material.' },
            { score: 5, tier: 'Critical', description: 'Subject to the most stringent regulatory regimes. Agent decisions may be directly audited. Any non-compliance carries severe penalties.' },
        ],
    },
    {
        key: 'ai_behavioral',
        label: 'AI Model & Behavioral Risk',
        question: 'What is the risk of the agent producing incorrect, biased, or harmful outputs?',
        options: [
            { score: 1, tier: 'Minimal',  description: 'Deterministic outputs. Negligible hallucination risk. Well-established use case type with industry precedent.' },
            { score: 2, tier: 'Low',      description: 'Generative outputs with low variability. Human review recommended but not critical. Low bias risk.' },
            { score: 3, tier: 'Moderate', description: 'Meaningful output variability. Some hallucination or bias risk. Human review of samples required. Model drift monitoring needed.' },
            { score: 4, tier: 'High',     description: 'Complex generative outputs in a high-stakes domain. Significant hallucination, bias, or drift risk. Continuous monitoring and guardrails essential.' },
            { score: 5, tier: 'Critical', description: 'High-stakes generative decisions (medical, legal, financial, HR). Any error could cause serious harm. Rigorous human oversight at every step.' },
        ],
    },
    {
        key: 'strategic_reputational',
        label: 'Strategic & Reputational Risk',
        question: 'What is the exposure to brand damage, employee relations risk, or strategic misalignment?',
        options: [
            { score: 1, tier: 'None',     description: 'Fully internal, back-office process. No customer or public visibility. No employee relations sensitivity.' },
            { score: 2, tier: 'Low',      description: 'Internal visibility with some partner touchpoints. Reputational impact if the agent fails would be contained.' },
            { score: 3, tier: 'Moderate', description: 'Customer-adjacent or broadly visible internally. Unexpected behavior could cause reputational concern or internal friction.' },
            { score: 4, tier: 'High',     description: 'Public-facing or high-profile internal use. Brand damage possible. Employee relations sensitivity (e.g. workforce decisions).' },
            { score: 5, tier: 'Critical', description: 'High-profile public or customer-facing, or directly involved in employee welfare, executive communications, or regulated interactions.' },
        ],
    },
];

function scoreColor(score: number | null): string {
    if (score === null) return 'text-slate-400';
    if (score <= 1) return 'text-emerald-600';
    if (score <= 2) return 'text-green-600';
    if (score <= 3) return 'text-amber-600';
    if (score <= 4) return 'text-orange-600';
    return 'text-red-600';
}

function scoreBg(score: number | null): string {
    if (score === null) return 'bg-slate-50 border-slate-200';
    if (score <= 1) return 'bg-emerald-50 border-emerald-300';
    if (score <= 2) return 'bg-green-50 border-green-300';
    if (score <= 3) return 'bg-amber-50 border-amber-300';
    if (score <= 4) return 'bg-orange-50 border-orange-300';
    return 'bg-red-50 border-red-300';
}

// ─────────────────────────────────────────────────────────────────────────────

const UseCaseView: React.FC<UseCaseViewProps> = ({
    useCase: uc,
    agentsComponent,
    businessImpactComponent,
    headerActions,
    isEditing,
    editTitle, onEditTitleChange,
    editDescription, onEditDescriptionChange,
    editOwner, onEditOwnerChange,
    editProblemStatement, onEditProblemStatementChange,
    editExpectedBenefits, onEditExpectedBenefitsChange,
    editSolutionApproach, onEditSolutionApproachChange,
    inlineEdit, inlineSaving,
    onStartInlineEdit, onInlineValueChange, onSaveInlineEdit, onCancelInlineEdit,
}) => {
    const [activeTab, setActiveTab] = React.useState('details');

    // ── Business Case fields — localStorage until DB columns are added ────────
    const _bcStorageKey = `tavro_bc_${uc.identifier}`;
    const _storedBc = (() => {
        try { const r = localStorage.getItem(_bcStorageKey); return r ? JSON.parse(r) : {}; } catch { return {}; }
    })();

    const [bcImpactCategory,    setBcImpactCategory]    = React.useState<string>(_storedBc.bcImpactCategory    ?? (uc as any).impact_category    ?? '');
    const [bcProjectedRoi,      setBcProjectedRoi]      = React.useState<string>(_storedBc.bcProjectedRoi      ?? (uc as any).projected_roi      ?? '');
    const [bcQuantifiedBenefit, setBcQuantifiedBenefit] = React.useState<string>(_storedBc.bcQuantifiedBenefit ?? (uc as any).quantified_benefit ?? '');

    // ── Prioritization scoring — sourced from DB, saved back via API ──────────
    const [pvBV, setPvBV] = React.useState<number | null>((uc as any).pv_business_value_score ?? null);
    const [pvDR, setPvDR] = React.useState<number | null>((uc as any).pv_data_readiness_score ?? null);
    const [pvTC, setPvTC] = React.useState<number | null>((uc as any).pv_technical_complexity_score ?? null);

    const [riskScores, setRiskScores] = React.useState<Record<string, number | null>>({
        data_privacy:           (uc as any).risk_data_privacy_score           ?? null,
        operational:            (uc as any).risk_operational_score            ?? null,
        compliance:             (uc as any).risk_compliance_score             ?? null,
        ai_behavioral:          (uc as any).risk_ai_behavioral_score          ?? null,
        strategic_reputational: (uc as any).risk_strategic_reputational_score ?? null,
    });

    // ── Persist bc* fields to localStorage (pending DB columns) ──────────────
    React.useEffect(() => {
        try {
            localStorage.setItem(_bcStorageKey, JSON.stringify({
                bcImpactCategory, bcProjectedRoi, bcQuantifiedBenefit,
            }));
        } catch {}
    }, [bcImpactCategory, bcProjectedRoi, bcQuantifiedBenefit]);

    const [expandedDims, setExpandedDims] = React.useState<Set<string>>(new Set());

    // Platform-level weights — set in Settings → Roadmap configuration
    const cfg = React.useMemo(() => readRoadmapConfig(), []);
    const riskWeights = cfg.riskWeights;

    const riskScoredCount = Object.values(riskScores).filter(s => s !== null).length;

    const riskComposite = React.useMemo(() => {
        const entries = (Object.entries(riskScores) as [string, number | null][]).filter(([, s]) => s !== null) as [string, number][];
        if (entries.length === 0) return null;
        const rw = riskWeights as unknown as Record<string, number>;
        const wTotal = entries.reduce((sum, [k]) => sum + (rw[k] ?? 20), 0);
        if (wTotal === 0) return null;
        return +(entries.reduce((sum, [k, s]) => sum + s * (rw[k] ?? 20), 0) / wTotal).toFixed(2);
    }, [riskScores, riskWeights]);

    const allRiskScored = Object.values(riskScores).every(s => s !== null);

    // ── Priority score — weights from platform config (Settings → Roadmap configuration) ──
    const priorityScore = React.useMemo(() => {
        if (pvBV === null || pvDR === null || pvTC === null || riskComposite === null) return null;
        const pw = cfg.priorityWeights;
        return +((pvBV * pw.BV) + (pvDR * pw.DR) + ((6 - pvTC) * pw.TC) - (riskComposite * pw.RISK)).toFixed(2);
    }, [pvBV, pvDR, pvTC, riskComposite, cfg]);

    const quadrant: { label: string; color: string; bg: string; border: string; desc: string } | null = React.useMemo(() => {
        if (pvTC === null || riskComposite === null) return null;
        const highCost = pvTC > 3;
        const highRisk = riskComposite > 3;
        if (!highCost && !highRisk) return { label: 'Quick Win',  color: '#1D7A4A', bg: 'bg-emerald-50',  border: 'border-emerald-300', desc: 'Low cost, low risk — prioritise immediately.' };
        if (!highCost &&  highRisk) return { label: 'Fill-in',    color: '#B85C00', bg: 'bg-orange-50',   border: 'border-orange-300',  desc: 'Low cost but elevated risk — proceed with guardrails.' };
        if ( highCost && !highRisk) return { label: 'Big Bet',    color: '#5C2D8A', bg: 'bg-violet-50',   border: 'border-violet-300',  desc: 'High investment, manageable risk — plan carefully.' };
        return                             { label: 'Money Pit',  color: '#A32D2D', bg: 'bg-red-50',      border: 'border-red-300',     desc: 'High cost and high risk — reconsider or redesign.' };
    }, [pvTC, riskComposite]);

    // ── API sync: persist prioritization scores to backend ───────────────────
    const _pendingScores = React.useRef<Parameters<typeof useCaseApi.updateUseCase>[1] | null>(null);
    const _apiSaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const _doSave = React.useCallback((payload: Parameters<typeof useCaseApi.updateUseCase>[1]) => {
        useCaseApi.updateUseCase(uc.identifier, payload).catch(() => {});
    }, [uc.identifier]);

    React.useEffect(() => {
        if (pvBV === null && pvDR === null && pvTC === null) return;
        const quadrantKey = quadrant
            ? ({ 'Quick Win': 'quick_win', 'Fill In': 'fill_in', 'Big Bet': 'big_bet', 'Money Pit': 'money_pit' } as Record<string, string>)[quadrant.label]
            : undefined;
        const payload: Parameters<typeof useCaseApi.updateUseCase>[1] = {
            __activityName: uc.name || uc.identifier,
            ...(pvBV !== null ? { business_value_score: pvBV } : {}),
            ...(pvDR !== null ? { data_readiness_score: pvDR } : {}),
            ...(pvTC !== null ? { technical_complexity_score: pvTC } : {}),
            ...(riskScores.data_privacy !== null ? { risk_data_privacy_score: riskScores.data_privacy } : {}),
            ...(riskScores.operational !== null ? { risk_operational_score: riskScores.operational } : {}),
            ...(riskScores.compliance !== null ? { risk_compliance_score: riskScores.compliance } : {}),
            ...(riskScores.ai_behavioral !== null ? { risk_ai_behavioral_score: riskScores.ai_behavioral } : {}),
            ...(riskScores.strategic_reputational !== null ? { risk_strategic_reputational_score: riskScores.strategic_reputational } : {}),
            ...(riskComposite !== null ? { risk_composite_score: riskComposite } : {}),
            ...(priorityScore !== null ? { priority_score: priorityScore } : {}),
            ...(quadrantKey ? { quadrant: quadrantKey } : {}),
        };
        _pendingScores.current = payload;
        if (_apiSaveTimer.current) clearTimeout(_apiSaveTimer.current);
        _apiSaveTimer.current = setTimeout(() => {
            _pendingScores.current = null;
            _doSave(payload);
        }, 600);
        return () => {
            if (_apiSaveTimer.current) clearTimeout(_apiSaveTimer.current);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pvBV, pvDR, pvTC, riskScores, riskComposite, priorityScore, quadrant, uc.identifier]);

    // Flush unsaved scores when the component unmounts (user navigates away)
    React.useEffect(() => {
        return () => {
            if (_pendingScores.current) {
                _doSave(_pendingScores.current);
                _pendingScores.current = null;
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [_doSave]);

    const applications = uc.applications?.filter(Boolean) ?? [];
    const controls = uc.controls?.filter(Boolean) ?? [];
    const riskAssessments = uc.risk_assessments?.filter(Boolean) ?? [];
    const linkedAgents = ((uc as any).agents ?? (uc as any).of_associated_agents ?? []).filter(Boolean);
    const linkedAgentCount = linkedAgents.length;

    const statusLabel = uc.status || 'Proposed';

    const owner = uc.owner ?? (uc as any).use_case_owner ?? null;
    const proposedBy = uc.proposed_by ?? (uc as any).proposed_by ?? null;
    const createdAt = uc.created_ts ?? (uc as any).created_at ?? (uc as any).sys_created_on ?? null;
    const updatedAt = uc.updated_ts ?? (uc as any).updated_at ?? (uc as any).sys_updated_on ?? null;
    const description = uc.description ?? (uc as any).description ?? null;
    const problemStatement = (uc as any).problem_statement ?? (uc as any).business_problem_statement ?? null;
    const expectedBenefits = uc.expected_benefits ?? null;
    const solutionApproach = uc.solution_approach ?? (uc as any).solution_approach ?? null;

    const REQUIRED_INLINE_FIELDS = new Set(['title', 'description']);
    const renderInlineActions = (field: string) => {
        const isSaving = inlineSaving === field;
        const isBlank = REQUIRED_INLINE_FIELDS.has(field) && !inlineEdit?.value.trim();
        const saveDisabled = isSaving || isBlank;
        return (
            <div className="flex shrink-0 gap-1">
                <button
                    type="button"
                    onClick={onSaveInlineEdit}
                    disabled={saveDisabled}
                    title={isBlank ? 'This field is required' : 'Save'}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-blue-600 text-xs font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                    {isSaving ? <Loader2 size={12} className="animate-spin" /> : '✓'}
                </button>
                <button
                    type="button"
                    onClick={onCancelInlineEdit}
                    disabled={isSaving}
                    title="Cancel"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                    ✕
                </button>
            </div>
        );
    };

    const tabs = [
        { id: 'details',          label: 'Details',                  icon: Info },
        { id: 'business_case',    label: 'Business Case',            icon: FileText },
        { id: 'business_impact',  label: 'Business Impact',          icon: Building2 },
        { id: 'ai_agents',        label: `AI Agents (${linkedAgentCount})`, icon: Bot },
        { id: 'risk_assessments', label: 'Risk Assessments',         icon: ShieldAlert },
        { id: 'prioritization',   label: 'Prioritization',           icon: Target },
        { id: 'controls',         label: 'Controls',                 icon: ShieldCheck },
    ];

    return (
        <div className="flex flex-col gap-6 w-full animate-fade-in pb-6 max-w-[1400px] mx-auto">
            <div className="h-4 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-t-2xl w-full" />

            {/* Header card */}
            <div className="-mt-6 bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
                <div className="p-6 flex flex-col gap-4">
                    {/* Title row */}
                    <div className="flex items-start gap-4">
                        {/* Left: icon + title + status */}
                        <div className="p-3 bg-blue-600 text-white rounded-xl shadow-sm shrink-0">
                            <ClipboardList size={22} />
                        </div>
                        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                            {isEditing ? (
                                <input
                                    type="text"
                                    value={editTitle ?? (uc as any).name ?? (uc as any).title ?? ''}
                                    onChange={e => onEditTitleChange?.(e.target.value)}
                                    className="text-xl font-bold text-slate-800 tracking-tight leading-tight w-full border-b-2 border-blue-400 bg-transparent outline-none pb-0.5"
                                />
                            ) : inlineEdit?.field === 'title' ? (
                                <div className="flex items-center gap-2 min-w-0">
                                    <input
                                        type="text"
                                        value={inlineEdit.value}
                                        onChange={e => onInlineValueChange?.(e.target.value)}
                                        className="text-xl font-bold text-slate-800 tracking-tight leading-tight w-full border-b-2 border-blue-400 bg-transparent outline-none pb-0.5"
                                        autoFocus
                                    />
                                    {renderInlineActions('title')}
                                </div>
                            ) : (
                                <h1
                                    onDoubleClick={() => onStartInlineEdit?.('title', (uc as any).name ?? (uc as any).title ?? '')}
                                    title="Double-click to edit"
                                    className="text-xl font-bold text-slate-800 tracking-tight leading-tight cursor-text rounded-lg hover:bg-blue-50/50 transition-colors"
                                >
                                    {(uc as any).name ?? (uc as any).title ?? 'Unnamed Use Case'}
                                </h1>
                            )}
                            <div className="flex items-center gap-2 flex-wrap">
                                <StatusBadge status={statusLabel} />
                                {uc.function && <MetaBadge text={String(uc.function)} color="blue" />}
                                {(uc as any).use_case_type && <MetaBadge text={String((uc as any).use_case_type)} color="slate" />}
                            </div>
                        </div>

                        {/* Right: Priority Score chip + Quadrant badge + headerActions */}
                        <div className="flex items-center gap-2.5 shrink-0">
                            {/* Priority Score chip — light fill when value exists, plain dash when not */}
                            {priorityScore !== null ? (() => {
                                const s = priorityScore;
                                const bg = s >= 3.5 ? 'bg-emerald-50 border-emerald-200'
                                    : s >= 2.5 ? 'bg-amber-50 border-amber-200'
                                    : 'bg-red-50 border-red-200';
                                const vc = s >= 3.5 ? 'text-emerald-700' : s >= 2.5 ? 'text-amber-700' : 'text-red-700';
                                return (
                                    <div className={`flex flex-col items-center justify-center w-[100px] h-[60px] rounded-2xl border gap-0.5 ${bg}`}>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Priority Score</span>
                                        <span className={`text-lg font-black leading-none tracking-tight ${vc}`}>{s.toFixed(1)}</span>
                                    </div>
                                );
                            })() : (
                                <div className="flex flex-col items-center justify-center w-[100px] h-[60px] gap-0.5">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Priority Score</span>
                                    <span className="text-slate-400 text-sm">—</span>
                                </div>
                            )}
                            {/* Quadrant — light fill when value exists, plain dash when not */}
                            {(() => {
                                const qMap: Record<string, { bg: string; border: string; value: string }> = {
                                    'Quick Win':  { bg: 'bg-emerald-50', border: 'border-emerald-200', value: 'text-emerald-700' },
                                    'Fill-in':    { bg: 'bg-orange-50',  border: 'border-orange-200',  value: 'text-orange-700' },
                                    'Big Bet':    { bg: 'bg-violet-50',  border: 'border-violet-200',  value: 'text-violet-700' },
                                    'Money Pit':  { bg: 'bg-red-50',     border: 'border-red-200',     value: 'text-red-700'    },
                                };
                                const q = quadrant ? (qMap[quadrant.label] ?? { bg: 'bg-slate-50', border: 'border-slate-200', value: 'text-slate-700' }) : null;
                                return q ? (
                                    <div className={`flex flex-col items-center justify-center w-[100px] h-[60px] rounded-2xl border gap-0.5 ${q.bg} ${q.border}`}>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Quadrant</span>
                                        <span className={`text-sm font-black leading-tight text-center ${q.value}`}>{quadrant!.label}</span>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center w-[100px] h-[60px] gap-0.5">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Quadrant</span>
                                        <span className="text-slate-400 text-sm">—</span>
                                    </div>
                                );
                            })()}
                            {headerActions && (
                                <div className="flex items-center gap-2 flex-wrap ml-1">
                                    {headerActions}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Bottom row — Owner + Proposed By + metric cards */}
                    <div className="flex items-stretch gap-3 pt-3 border-t border-slate-100 flex-wrap">
                        {/* Owner + Proposed By */}
                        <div className="flex items-center gap-6">
                            <MetaField label="Owner">
                                {owner
                                    ? <span className="inline-flex items-center gap-1 text-slate-700"><User size={12} className="text-slate-400" />{owner}</span>
                                    : <span className="text-slate-400 text-xs">Unassigned</span>}
                            </MetaField>
                            <MetaField label="Proposed By">
                                {proposedBy
                                    ? <span className="inline-flex items-center gap-1 text-slate-700"><Users size={12} className="text-slate-400" />{proposedBy}</span>
                                    : <span className="text-slate-400 text-xs">—</span>}
                            </MetaField>
                        </div>

                        <div className="flex-1" />

                        {/* Metric cards */}
                        <div className="flex flex-col gap-1.5 items-end">
                            <div className="flex items-stretch gap-2">
                                {([
                                    {
                                        label: 'Business Value',
                                        value: pvBV,
                                        weightLabel: `${(cfg.priorityWeights.BV * 100).toFixed(0)}%`,
                                        contribution: pvBV !== null ? pvBV * cfg.priorityWeights.BV : null,
                                        tooltip: 'Measurable financial or strategic impact of this use case. Higher score = greater value.',
                                        positiveScale: true,
                                    },
                                    {
                                        label: 'Data Readiness',
                                        value: pvDR,
                                        weightLabel: `${(cfg.priorityWeights.DR * 100).toFixed(0)}%`,
                                        contribution: pvDR !== null ? pvDR * cfg.priorityWeights.DR : null,
                                        tooltip: 'How available, clean, and governed the required data is. Higher = more ready.',
                                        positiveScale: true,
                                    },
                                    {
                                        label: 'Tech Complexity',
                                        value: pvTC,
                                        weightLabel: `(6−n)×${(cfg.priorityWeights.TC * 100).toFixed(0)}%`,
                                        contribution: pvTC !== null ? (6 - pvTC) * cfg.priorityWeights.TC : null,
                                        tooltip: 'Implementation difficulty. Score is inverted — (6−n) means lower complexity gives a higher priority boost.',
                                        positiveScale: false,
                                    },
                                    {
                                        label: 'Risk',
                                        value: riskComposite !== null ? riskComposite : null,
                                        weightLabel: `${(cfg.priorityWeights.RISK * 100).toFixed(0)}%`,
                                        contribution: riskComposite !== null ? -(riskComposite * cfg.priorityWeights.RISK) : null,
                                        tooltip: 'Composite risk score from the Risk Assessments tab. Higher risk reduces priority score.',
                                        positiveScale: false,
                                    },
                                ] as { label: string; value: number | null; weightLabel: string; contribution: number | null; tooltip: string; positiveScale: boolean }[]).map(item => {
                                    const contribColor = item.contribution !== null
                                        ? (item.contribution >= 0 ? 'text-emerald-600' : 'text-red-500')
                                        : 'text-slate-400';
                                    return item.contribution !== null ? (
                                        <div key={item.label} className="flex flex-col gap-1 px-3 py-2.5 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors min-w-[100px]">
                                            <div className="group relative flex items-center gap-1 w-fit">
                                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest cursor-help leading-none">{item.label}</span>
                                                <div className="absolute bottom-full left-0 mb-2 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none">
                                                    <div className="bg-slate-800 text-white text-[11px] rounded-lg px-2.5 py-2 shadow-xl w-44 leading-snug">
                                                        {item.tooltip}
                                                    </div>
                                                    <div className="w-0 h-0 border-4 border-transparent border-t-slate-800 ml-2" />
                                                </div>
                                            </div>
                                            <span className={`text-base font-black leading-none ${contribColor}`}>
                                                {item.contribution >= 0 ? '+' : ''}{item.contribution.toFixed(2)}
                                            </span>
                                        </div>
                                    ) : (
                                        <div key={item.label} className="flex flex-col gap-1 min-w-[100px]">
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none">{item.label}</span>
                                            <span className="text-sm text-slate-400 font-normal leading-none">—</span>
                                        </div>
                                    );
                                })}
                            </div>
                            {/* Empty state hint */}
                            {(pvBV === null && pvDR === null && pvTC === null && riskComposite === null) && (
                                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                                    <span>Scores pending evaluation.</span>
                                    <button
                                        type="button"
                                        onClick={() => setActiveTab('risk_assessments')}
                                        className="text-blue-500 hover:text-blue-700 font-semibold hover:underline transition-colors"
                                    >
                                        Add scores →
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Tab bar */}
            <div className="flex items-center gap-1 overflow-x-auto pb-0 scrollbar-hide border-b border-slate-200">
                {tabs.map(tab => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-3 text-sm font-bold whitespace-nowrap transition-all border-b-2 -mb-px ${isActive
                                ? 'border-blue-600 text-blue-700'
                                : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                            }`}
                        >
                            <Icon size={15} className={isActive ? 'text-blue-600' : 'text-slate-400'} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Tab content */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 shadow-sm min-h-[400px]">

                {/* Details tab */}
                {activeTab === 'details' && (
                    <div className="flex flex-col gap-6 animate-fade-in">
                        {isEditing ? (
                            <SectionCard icon={<FileText size={16} />} title="Description">
                                <textarea
                                    value={editDescription ?? ''}
                                    onChange={e => onEditDescriptionChange?.(e.target.value)}
                                    rows={6}
                                    className="w-full text-sm text-slate-600 leading-relaxed border border-blue-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400/20 resize-none"
                                />
                            </SectionCard>
                        ) : inlineEdit?.field === 'description' ? (
                            <SectionCard icon={<FileText size={16} />} title="Description">
                                <div className="flex items-start gap-2">
                                    <textarea
                                        value={inlineEdit.value}
                                        onChange={e => onInlineValueChange?.(e.target.value)}
                                        rows={6}
                                        className="w-full text-sm text-slate-600 leading-relaxed border border-blue-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400/20 resize-none"
                                        autoFocus
                                    />
                                    {renderInlineActions('description')}
                                </div>
                            </SectionCard>
                        ) : description ? (
                            <SectionCard icon={<FileText size={16} />} title="Description">
                                <p
                                    onDoubleClick={() => onStartInlineEdit?.('description', description)}
                                    title="Double-click to edit"
                                    className="text-sm text-slate-600 leading-relaxed whitespace-pre-line cursor-text rounded-lg hover:bg-blue-50/40 transition-colors p-1 -m-1"
                                >
                                    {description}
                                </p>
                            </SectionCard>
                        ) : (
                            <div
                                onDoubleClick={() => onStartInlineEdit?.('description', '')}
                                title="Double-click to add description"
                                className="bg-white rounded-2xl border border-dashed border-slate-200 p-8 text-center text-slate-400 text-sm cursor-text hover:bg-blue-50/20 transition-colors"
                            >
                                No description provided.
                            </div>
                        )}
                        <div className="flex flex-col gap-3">
                            {/* Row 1: Owner + Function */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex flex-col gap-1">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Owner</span>
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={editOwner ?? ''}
                                            onChange={e => onEditOwnerChange?.(e.target.value)}
                                            placeholder="Assign owner"
                                            className="text-sm font-semibold text-slate-700 w-full border-b border-blue-400 bg-transparent outline-none"
                                        />
                                    ) : inlineEdit?.field === 'owner' ? (
                                        <div className="flex items-center gap-1">
                                            <input
                                                type="text"
                                                value={inlineEdit.value}
                                                onChange={e => onInlineValueChange?.(e.target.value)}
                                                className="text-sm font-semibold text-slate-700 w-full border-b border-blue-400 bg-transparent outline-none"
                                                autoFocus
                                            />
                                            {renderInlineActions('owner')}
                                        </div>
                                    ) : (
                                        <span
                                            onDoubleClick={() => onStartInlineEdit?.('owner', owner ?? '')}
                                            title="Double-click to edit"
                                            className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 cursor-text rounded hover:bg-blue-50/40 transition-colors"
                                        >
                                            <User size={13} className="text-slate-400" />
                                            {owner || <span className="text-slate-400 font-normal">Unassigned</span>}
                                        </span>
                                    )}
                                </div>
                                <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex flex-col gap-1">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Function</span>
                                    {uc.function
                                        ? <span className="text-sm font-semibold text-slate-700">{String(uc.function)}</span>
                                        : <span className="text-sm text-slate-400 font-normal">—</span>
                                    }
                                </div>
                            </div>
                            {/* Row 2: Created + Last Updated */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex flex-col gap-1">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Created</span>
                                    <span className="text-sm text-slate-700 flex items-center gap-1.5"><CalendarDays size={13} className="text-slate-400" />{formatDate(createdAt)}</span>
                                </div>
                                <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex flex-col gap-1">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Last Updated</span>
                                    <span className="text-sm text-slate-700 flex items-center gap-1.5"><CalendarDays size={13} className="text-slate-400" />{formatDate(updatedAt)}</span>
                                </div>
                            </div>
                            {proposedBy && (
                                <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex flex-col gap-1">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Proposed By</span>
                                    <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5"><Users size={13} className="text-slate-400" />{proposedBy}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Business Case tab */}
                {activeTab === 'business_case' && (
                    <div className="flex flex-col gap-6 animate-fade-in">

                        {/* ── Existing narrative fields (2-col grid) ── */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Problem Statement */}
                            {isEditing ? (
                                <SectionCard icon={<FileText size={16} />} title="Business Problem Statement">
                                    <textarea
                                        value={editProblemStatement ?? ''}
                                        onChange={e => onEditProblemStatementChange?.(e.target.value)}
                                        rows={4}
                                        className="w-full text-sm text-slate-600 leading-relaxed border border-blue-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400/20 resize-none"
                                    />
                                </SectionCard>
                            ) : inlineEdit?.field === 'problem_statement' ? (
                                <SectionCard icon={<FileText size={16} />} title="Business Problem Statement">
                                    <div className="flex items-start gap-2">
                                        <textarea
                                            value={inlineEdit.value}
                                            onChange={e => onInlineValueChange?.(e.target.value)}
                                            rows={4}
                                            className="w-full text-sm text-slate-600 leading-relaxed border border-blue-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400/20 resize-none"
                                            autoFocus
                                        />
                                        {renderInlineActions('problem_statement')}
                                    </div>
                                </SectionCard>
                            ) : problemStatement ? (
                                <SectionCard icon={<FileText size={16} />} title="Business Problem Statement">
                                    <p
                                        onDoubleClick={() => onStartInlineEdit?.('problem_statement', problemStatement)}
                                        title="Double-click to edit"
                                        className="text-sm text-slate-600 leading-relaxed whitespace-pre-line cursor-text rounded-lg hover:bg-blue-50/40 transition-colors p-1 -m-1"
                                    >{problemStatement}</p>
                                </SectionCard>
                            ) : null}

                            {/* Expected Benefits */}
                            {isEditing ? (
                                <SectionCard icon={<CheckCircle2 size={16} />} title="Expected Benefits / Outcomes">
                                    <textarea
                                        value={editExpectedBenefits ?? ''}
                                        onChange={e => onEditExpectedBenefitsChange?.(e.target.value)}
                                        rows={4}
                                        className="w-full text-sm text-slate-600 leading-relaxed border border-blue-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400/20 resize-none"
                                    />
                                </SectionCard>
                            ) : inlineEdit?.field === 'expected_benefits' ? (
                                <SectionCard icon={<CheckCircle2 size={16} />} title="Expected Benefits / Outcomes">
                                    <div className="flex items-start gap-2">
                                        <textarea
                                            value={inlineEdit.value}
                                            onChange={e => onInlineValueChange?.(e.target.value)}
                                            rows={4}
                                            className="w-full text-sm text-slate-600 leading-relaxed border border-blue-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400/20 resize-none"
                                            autoFocus
                                        />
                                        {renderInlineActions('expected_benefits')}
                                    </div>
                                </SectionCard>
                            ) : expectedBenefits ? (
                                <SectionCard icon={<CheckCircle2 size={16} />} title="Expected Benefits / Outcomes">
                                    <p
                                        onDoubleClick={() => onStartInlineEdit?.('expected_benefits', expectedBenefits)}
                                        title="Double-click to edit"
                                        className="text-sm text-slate-600 leading-relaxed whitespace-pre-line cursor-text rounded-lg hover:bg-blue-50/40 transition-colors p-1 -m-1"
                                    >{expectedBenefits}</p>
                                </SectionCard>
                            ) : null}

                            {/* Solution Approach */}
                            {isEditing ? (
                                <SectionCard icon={<Target size={16} />} title="Solution Approach">
                                    <textarea
                                        value={editSolutionApproach ?? ''}
                                        onChange={e => onEditSolutionApproachChange?.(e.target.value)}
                                        rows={4}
                                        className="w-full text-sm text-slate-600 leading-relaxed border border-blue-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400/20 resize-none"
                                    />
                                </SectionCard>
                            ) : inlineEdit?.field === 'solution_approach' ? (
                                <SectionCard icon={<Target size={16} />} title="Solution Approach">
                                    <div className="flex items-start gap-2">
                                        <textarea
                                            value={inlineEdit.value}
                                            onChange={e => onInlineValueChange?.(e.target.value)}
                                            rows={4}
                                            className="w-full text-sm text-slate-600 leading-relaxed border border-blue-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400/20 resize-none"
                                            autoFocus
                                        />
                                        {renderInlineActions('solution_approach')}
                                    </div>
                                </SectionCard>
                            ) : solutionApproach ? (
                                <SectionCard icon={<Target size={16} />} title="Solution Approach">
                                    <p
                                        onDoubleClick={() => onStartInlineEdit?.('solution_approach', solutionApproach)}
                                        title="Double-click to edit"
                                        className="text-sm text-slate-600 leading-relaxed whitespace-pre-line cursor-text rounded-lg hover:bg-blue-50/40 transition-colors p-1 -m-1"
                                    >{solutionApproach}</p>
                                </SectionCard>
                            ) : null}

                            {(uc as any).business_sponsors && (
                                <SectionCard icon={<Users size={16} />} title="Business Sponsors">
                                    <p className="text-sm text-slate-700">{(uc as any).business_sponsors}</p>
                                </SectionCard>
                            )}
                            {(uc as any).use_case_type && (
                                <SectionCard icon={<Tag size={16} />} title="Use Case Type">
                                    <p className="text-sm text-slate-700">{(uc as any).use_case_type}</p>
                                </SectionCard>
                            )}
                        </div>

                        {/* ── Impact Classification ── */}
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                                <span className="text-slate-500"><Target size={16} /></span>
                                <span className="font-bold text-slate-800 text-sm">Impact Classification</span>
                                <span className="ml-auto text-[10px] text-slate-400">Informs Business Value score</span>
                            </div>
                            <div className="p-5 flex flex-col gap-2">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Impact Category</label>
                                <div className="flex flex-wrap gap-2">
                                    {(['Revenue Generation', 'Cost Reduction', 'Risk Mitigation', 'Compliance', 'Productivity Improvement'] as const).map(opt => (
                                        <button
                                            key={opt}
                                            type="button"
                                            onClick={() => setBcImpactCategory((prev: string) => prev === opt ? '' : opt)}
                                            className={`px-4 py-2 rounded-xl border text-xs font-semibold transition-all ${
                                                bcImpactCategory === opt
                                                    ? 'bg-violet-50 border-violet-300 text-violet-700 shadow-sm'
                                                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white'
                                            }`}
                                        >
                                            {opt}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* ── Financial Quantification ── */}
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                                <span className="text-slate-500"><ClipboardList size={16} /></span>
                                <span className="font-bold text-slate-800 text-sm">Financial Quantification</span>
                                <span className="ml-auto text-[10px] text-slate-400">Informs Business Value score</span>
                            </div>
                            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-5">

                                {/* Projected ROI */}
                                <div className="flex flex-col gap-2">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Projected ROI (%)</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            min={0}
                                            placeholder="e.g. 140"
                                            value={bcProjectedRoi}
                                            onChange={e => setBcProjectedRoi(e.target.value)}
                                            className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 pr-8 outline-none focus:ring-2 focus:ring-violet-400/20 focus:border-violet-300 bg-slate-50 text-slate-700"
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-bold">%</span>
                                    </div>
                                    {bcProjectedRoi && (
                                        <p className="text-[11px] text-slate-400">
                                            {Number(bcProjectedRoi) >= 200 ? 'Exceptional return' : Number(bcProjectedRoi) >= 100 ? 'Strong return' : Number(bcProjectedRoi) >= 50 ? 'Moderate return' : 'Low return'}
                                        </p>
                                    )}
                                </div>

                                {/* Quantified Annual Benefit */}
                                <div className="flex flex-col gap-2">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Quantified Annual Benefit ($)</label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-bold">$</span>
                                        <input
                                            type="number"
                                            min={0}
                                            placeholder="e.g. 2400000"
                                            value={bcQuantifiedBenefit}
                                            onChange={e => setBcQuantifiedBenefit(e.target.value)}
                                            className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 pl-7 outline-none focus:ring-2 focus:ring-violet-400/20 focus:border-violet-300 bg-slate-50 text-slate-700"
                                        />
                                    </div>
                                    {bcQuantifiedBenefit && Number(bcQuantifiedBenefit) > 0 && (
                                        <p className="text-[11px] text-slate-400">
                                            ≈ ${(Number(bcQuantifiedBenefit) / 1_000_000).toFixed(2)}M per year
                                        </p>
                                    )}
                                </div>

                            </div>
                        </div>

                        {/* ── Business Value connector callout ── */}
                        {(bcImpactCategory || bcProjectedRoi || bcQuantifiedBenefit) && (
                            <div className="flex items-start gap-3 px-4 py-3.5 bg-violet-50 border border-violet-200 rounded-xl text-xs text-violet-800">
                                <Info size={14} className="flex-shrink-0 mt-0.5 text-violet-500" />
                                <div>
                                    <span className="font-bold">Business Value inputs captured. </span>
                                    These fields will auto-populate the Business Value score in the Prioritization tab once the scoring engine is connected.
                                    {bcImpactCategory && <span className="ml-1">Category: <strong>{bcImpactCategory}</strong>.</span>}
                                    {bcProjectedRoi && <span className="ml-1">ROI: <strong>{bcProjectedRoi}%</strong>.</span>}
                                    {bcQuantifiedBenefit && Number(bcQuantifiedBenefit) > 0 && <span className="ml-1">Annual benefit: <strong>${(Number(bcQuantifiedBenefit)/1_000_000).toFixed(2)}M</strong>.</span>}
                                </div>
                            </div>
                        )}

                    </div>
                )}

                {/* Business Impact tab */}
                {activeTab === 'business_impact' && (
                    <div className="animate-fade-in flex flex-col gap-6">
                        {businessImpactComponent ?? (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {applications.length > 0 && (
                                    <SectionCard icon={<Building2 size={16} />} title="Applications" count={applications.length}>
                                        <div className="flex flex-col divide-y divide-slate-100">
                                            {applications.map((app: any, i: number) => (
                                                <div key={getId(app) ?? i} className="py-3 first:pt-0 last:pb-0">
                                                    <div className="flex items-center justify-between mb-0.5">
                                                        {getId(app) ? (
                                                            <Link to={`/applications/${encodeURIComponent(String(getId(app)))}`} className="text-sm font-semibold text-blue-600 hover:underline">
                                                                {getLabel(app)}
                                                            </Link>
                                                        ) : (
                                                            <p className="text-sm font-semibold text-slate-800">{getLabel(app)}</p>
                                                        )}
                                                        {getLabel(app.business_criticality ?? app.u_business_criticality, '') && (
                                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-slate-50 text-slate-500 border-slate-200">
                                                                {getLabel(app.business_criticality ?? app.u_business_criticality, '')}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {(app.description ?? app.short_description) && (
                                                        <p className="text-xs text-slate-400 mt-0.5">{app.description ?? app.short_description}</p>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </SectionCard>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* AI Agents tab */}
                {activeTab === 'ai_agents' && (
                    <div className="animate-fade-in">
                        {agentsComponent ?? (
                            <div className="text-center py-12 text-slate-400 text-sm bg-white rounded-2xl border border-slate-200 border-dashed">
                                Agents manager not provided.
                            </div>
                        )}
                    </div>
                )}

                {/* Risk Assessments tab */}
                {activeTab === 'risk_assessments' && (
                    <div className="animate-fade-in flex flex-col gap-4">

                        {/* ── Composite score hero ── */}
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                            <div className="flex items-start justify-between gap-6 flex-wrap">
                                {/* Left: big number */}
                                <div className="flex flex-col gap-1">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Composite Risk Score</span>
                                    <div className="flex items-end gap-2">
                                        {riskComposite !== null ? (
                                            <>
                                                <span className={`text-5xl font-black leading-none ${scoreColor(riskComposite)}`}>
                                                    {riskComposite.toFixed(1)}
                                                </span>
                                                <span className="text-sm text-slate-400 mb-1">/ 5.0</span>
                                                <span className={`ml-1 text-xs font-bold px-2.5 py-1 rounded-lg border mb-0.5 ${scoreBg(riskComposite)}`}>
                                                    {riskComposite <= 2 ? 'Low Risk' : riskComposite <= 3 ? 'Moderate Risk' : riskComposite <= 4 ? 'High Risk' : 'Critical Risk'}
                                                </span>
                                            </>
                                        ) : (
                                            <span className="text-4xl font-black text-slate-300 leading-none">—</span>
                                        )}
                                    </div>
                                    <span className="text-xs text-slate-400 mt-1">{riskScoredCount} of 5 categories scored</span>
                                </div>

                                {/* Right: per-dimension mini bars (only when at least one scored) */}
                                {riskScoredCount > 0 && (
                                    <div className="flex flex-col gap-2 flex-1 min-w-[220px] max-w-sm">
                                        {RISK_DIMENSIONS.map(dim => {
                                            const s = riskScores[dim.key];
                                            const w = (riskWeights as unknown as Record<string, number>)[dim.key] ?? 20;
                                            return (
                                                <div key={dim.key} className="flex items-center gap-2">
                                                    <span className="text-[10px] text-slate-400 w-40 truncate shrink-0">{dim.label}</span>
                                                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                        {s !== null ? (
                                                            <div className="h-full rounded-full transition-all" style={{ width: `${(s / 5) * 100}%`, background: s <= 2 ? '#16a34a' : s <= 3 ? '#d97706' : '#dc2626' }} />
                                                        ) : (
                                                            <div className="h-full w-full bg-slate-200 rounded-full opacity-40" />
                                                        )}
                                                    </div>
                                                    <span className={`text-[10px] font-bold w-4 text-right ${s !== null ? scoreColor(s) : 'text-slate-300'}`}>{s ?? '—'}</span>
                                                    <span className="text-[9px] text-slate-300 w-7 text-right">{w}%</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Full-width progress bar */}
                            <div className="mt-4 h-2 bg-slate-100 rounded-full overflow-hidden">
                                {riskComposite !== null && (
                                    <div className="h-full rounded-full transition-all" style={{ width: `${(riskComposite / 5) * 100}%`, background: riskComposite <= 2 ? '#16a34a' : riskComposite <= 3 ? '#d97706' : '#dc2626' }} />
                                )}
                            </div>
                        </div>

                        {/* ── Incomplete warning ── */}
                        {!allRiskScored && (
                            <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                                <div>
                                    <span className="font-bold">Assessment incomplete — </span>
                                    {riskScoredCount === 0
                                        ? 'No categories have been scored yet. Score all 5 to unlock automatic risk scoring in the Prioritization tab.'
                                        : `${5 - riskScoredCount} ${5 - riskScoredCount === 1 ? 'category remains' : 'categories remain'} unscored. Complete all 5 to finalize the composite score.`}
                                </div>
                            </div>
                        )}

                        {/* ── 5 dimension cards — horizontal card layout ── */}
                        <div className="flex flex-col gap-2">
                            {RISK_DIMENSIONS.map(dim => {
                                const selected = riskScores[dim.key];
                                return (
                                    <div key={dim.key} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-bold text-slate-800">{dim.label}</p>
                                                <p className="text-xs text-slate-500 mt-0.5">{dim.question}</p>
                                            </div>
                                            {selected !== null ? (
                                                <span className={`flex-shrink-0 text-xs font-bold px-2.5 py-1 rounded-lg border ${scoreBg(selected)}`}>
                                                    {dim.options.find(o => o.score === selected)?.tier} · {selected}/5
                                                </span>
                                            ) : (
                                                <span className="flex-shrink-0 text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-slate-100 text-slate-400 border border-slate-200">
                                                    Not scored
                                                </span>
                                            )}
                                        </div>
                                        <div className="p-4 grid grid-cols-1 sm:grid-cols-5 gap-2">
                                            {dim.options.map(opt => {
                                                const isSelected = selected === opt.score;
                                                return (
                                                    <button
                                                        key={opt.score}
                                                        type="button"
                                                        onClick={() => setRiskScores(prev => ({ ...prev, [dim.key]: isSelected ? null : opt.score }))}
                                                        className={`text-left p-3 rounded-xl border transition-all flex flex-col gap-1 ${
                                                            isSelected
                                                                ? `${scoreBg(opt.score)} shadow-sm`
                                                                : 'bg-slate-50 border-slate-200 hover:border-slate-300 hover:bg-white'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-1.5">
                                                            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${
                                                                isSelected ? `${scoreColor(opt.score)} bg-white border-2 border-current` : 'bg-slate-200 text-slate-500'
                                                            }`}>{opt.score}</span>
                                                            <span className={`text-xs font-bold leading-tight ${isSelected ? scoreColor(opt.score) : 'text-slate-700'}`}>{opt.tier}</span>
                                                        </div>
                                                        <p className="text-[11px] text-slate-400 leading-snug">{opt.description}</p>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Existing risk assessments (blended/AIVSS data) — shown only when present */}
                        {riskAssessments.length > 0 && (
                            <SectionCard icon={<ShieldAlert size={16} />} title="Linked Risk Assessments" count={riskAssessments.length}>
                                <div className="flex flex-col gap-4">
                                    {riskAssessments.map((ra: any, i: number) => (
                                        <div key={getId(ra) ?? i} className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                                            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                                                <div>
                                                    <p className="text-sm font-bold text-slate-800">
                                                        {ra.name ?? ra.display_value ?? ra.identifier ?? 'Risk Assessment'}
                                                    </p>
                                                    {(ra.assessor ?? ra.u_assessor) && (
                                                        <p className="text-xs text-slate-400 mt-0.5">Assessed by: {ra.assessor ?? ra.u_assessor}</p>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <RiskBadge classification={ra.blended_risk_classification ?? ra.overall_risk_classification} />
                                                    {(ra.state ?? ra.status) && (
                                                        <span className="text-[10px] font-semibold px-2.5 py-1 rounded bg-white text-slate-600 border border-slate-200">
                                                            {ra.state ?? ra.status}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                                {(ra.blended_risk_score ?? ra.risk_score) && (
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Blended Score</span>
                                                        <span className="text-sm font-bold text-slate-800">{ra.blended_risk_score ?? ra.risk_score}</span>
                                                    </div>
                                                )}
                                                {ra.aivss_score && (
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Info Security Score</span>
                                                        <span className="flex items-center gap-1 mb-0.5">
                                                            <span className="text-[9px] font-bold uppercase tracking-wide text-blue-600 bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5">AIVSS</span>
                                                            <span className="text-[9px] font-bold uppercase tracking-wide text-blue-600 bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5">CVSS</span>
                                                        </span>
                                                        <span className="text-sm font-bold text-slate-800">{ra.aivss_score}</span>
                                                    </div>
                                                )}
                                                {ra.regulatory_risk_score && (
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Regulatory Score</span>
                                                        <span className="text-sm font-bold text-slate-800">{ra.regulatory_risk_score}</span>
                                                    </div>
                                                )}
                                                {(ra.date ?? ra.assessment_date) && (
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Date</span>
                                                        <span className="text-sm text-slate-600">{ra.date ?? ra.assessment_date}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </SectionCard>
                        )}

                    </div>
                )}

                {/* Prioritization tab */}
                {activeTab === 'prioritization' && (
                    <div className="animate-fade-in flex flex-col gap-6">

                        {/* ── Section A: Scoring Dimensions ── */}
                        <div className="flex flex-col gap-2">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Section A — Scoring Dimensions</p>

                            {/* Business Value */}
                            {([
                                {
                                    key: 'bv', label: 'Business Value', weight: '40%', value: pvBV, setter: setPvBV,
                                    question: 'What is the measurable financial or strategic impact of this use case?',
                                    options: [
                                        { score: 1, tier: 'Minimal',        description: 'No measurable financial impact or productivity gain expected.' },
                                        { score: 2, tier: 'Low',            description: 'Minor productivity gains or cost avoidance, < $100K annual benefit.' },
                                        { score: 3, tier: 'Moderate',       description: 'Meaningful efficiency improvement, $100K–$500K annual benefit.' },
                                        { score: 4, tier: 'High',           description: 'Significant value creation, $500K–$2M annual benefit or major risk reduction.' },
                                        { score: 5, tier: 'Transformational', description: 'Strategic game-changer, > $2M annual benefit or decisive competitive advantage.' },
                                    ],
                                },
                                {
                                    key: 'dr', label: 'Data Readiness', weight: '25%', value: pvDR, setter: setPvDR,
                                    question: 'How available, clean, and governed is the data required for this use case?',
                                    options: [
                                        { score: 1, tier: 'Not Ready',          description: 'Data sources not identified. No governance or access controls in place.' },
                                        { score: 2, tier: 'Partially Identified', description: 'Data sources known but not consistently accessible or structured.' },
                                        { score: 3, tier: 'Available but Unclean', description: 'Data exists and is accessible but requires significant preparation and quality work.' },
                                        { score: 4, tier: 'Mostly Ready',       description: 'Data accessible with minor quality or governance gaps that can be resolved quickly.' },
                                        { score: 5, tier: 'Fully Ready',        description: 'Clean, governed, accessible data with clear lineage and documented ownership.' },
                                    ],
                                },
                                {
                                    key: 'tc', label: 'Technical Complexity', weight: '15%', value: pvTC, setter: setPvTC,
                                    question: 'How technically difficult is it to implement this use case? (Higher = harder = lower priority weight)',
                                    options: [
                                        { score: 1, tier: 'Minimal',      description: 'Off-the-shelf solution, minimal integration. Could be live within weeks.' },
                                        { score: 2, tier: 'Low',          description: 'Simple integration with existing systems. Standard engineering effort.' },
                                        { score: 3, tier: 'Moderate',     description: 'Custom development required with standard integrations and moderate team effort.' },
                                        { score: 4, tier: 'High',         description: 'Complex multi-system integration, significant engineering and coordination effort.' },
                                        { score: 5, tier: 'Very High',    description: 'Novel AI approach, critical system dependencies, or high delivery uncertainty.' },
                                    ],
                                },
                            ] as { key: string; label: string; weight: string; value: number | null; setter: (v: number | null) => void; question: string; options: { score: number; tier: string; description: string }[] }[]).map(dim => (
                                <div key={dim.key} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                    <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold text-slate-800">{dim.label}</span>
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">{dim.weight}</span>
                                                {dim.key === 'tc' && <span className="text-[10px] text-slate-400 italic">inverted — lower is better</span>}
                                            </div>
                                            <p className="text-xs text-slate-500 mt-0.5">{dim.question}</p>
                                        </div>
                                        {dim.value !== null && (
                                            <span className={`flex-shrink-0 text-xs font-bold px-2.5 py-1 rounded-lg border ${scoreBg(dim.value)}`}>
                                                {dim.options.find(o => o.score === dim.value)?.tier} · {dim.value}/5
                                            </span>
                                        )}
                                    </div>
                                    <div className="p-4 grid grid-cols-1 sm:grid-cols-5 gap-2">
                                        {dim.options.map(opt => {
                                            const isSelected = dim.value === opt.score;
                                            return (
                                                <button
                                                    key={opt.score}
                                                    type="button"
                                                    onClick={() => dim.setter(isSelected ? null : opt.score)}
                                                    className={`text-left p-3 rounded-xl border transition-all flex flex-col gap-1 ${
                                                        isSelected ? `${scoreBg(opt.score)} shadow-sm` : 'bg-slate-50 border-slate-200 hover:border-slate-300 hover:bg-white'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-1.5">
                                                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${
                                                            isSelected ? `${scoreColor(opt.score)} bg-white border-2 border-current` : 'bg-slate-200 text-slate-500'
                                                        }`}>{opt.score}</span>
                                                        <span className={`text-xs font-bold leading-tight ${isSelected ? scoreColor(opt.score) : 'text-slate-700'}`}>{opt.tier}</span>
                                                    </div>
                                                    <p className="text-[11px] text-slate-400 leading-snug">{opt.description}</p>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}

                            {/* Risk — read-only from Risk Assessments tab */}
                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-bold text-slate-800">Risk</span>
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">20%</span>
                                            <span className="text-[10px] text-slate-400 italic">auto-populated from Risk Assessments tab</span>
                                        </div>
                                        <p className="text-xs text-slate-500 mt-0.5">Composite risk score averaged across all 5 risk categories.</p>
                                    </div>
                                    {riskComposite !== null && (
                                        <span className={`flex-shrink-0 text-xs font-bold px-2.5 py-1 rounded-lg border ${scoreBg(riskComposite)}`}>
                                            {riskComposite.toFixed(1)} / 5.0
                                        </span>
                                    )}
                                </div>
                                {riskComposite !== null ? (
                                    <div className="p-4 flex items-center gap-4">
                                        <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                                            <div className="h-full rounded-full" style={{ width: `${(riskComposite / 5) * 100}%`, background: riskComposite <= 2 ? '#16a34a' : riskComposite <= 3 ? '#d97706' : '#dc2626' }} />
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className={`text-2xl font-black ${scoreColor(riskComposite)}`}>{riskComposite.toFixed(1)}</span>
                                            <span className="text-xs text-slate-400">/ 5.0 · {riskScoredCount}/5 categories scored</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="p-4 flex items-center gap-2 text-xs text-amber-700">
                                        <AlertTriangle size={13} className="flex-shrink-0" />
                                        Score all 5 risk categories in the <button type="button" onClick={() => setActiveTab('risk_assessments')} className="font-bold underline underline-offset-2 hover:text-amber-900">Risk Assessments tab</button> to populate this dimension.
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>
                )}

                {/* Controls tab */}
                {activeTab === 'controls' && (
                    <div className="animate-fade-in">
                        {controls.length > 0 ? (
                            <SectionCard icon={<ShieldCheck size={16} />} title="Controls" count={controls.length}>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {controls.map((ctrl: any, i: number) => (
                                        <div key={getId(ctrl) ?? i} className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                                            <div className="p-1.5 bg-white rounded-lg border border-slate-200 shrink-0">
                                                <ShieldCheck size={13} className="text-slate-500" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-slate-800 truncate">{getLabel(ctrl)}</p>
                                                {(ctrl.domain ?? ctrl.control_domain) && (
                                                    <p className="text-[10px] text-slate-400 font-medium mt-0.5">{ctrl.domain ?? ctrl.control_domain}</p>
                                                )}
                                                {(ctrl.objective ?? ctrl.short_description) && (
                                                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{ctrl.objective ?? ctrl.short_description}</p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </SectionCard>
                        ) : (
                            <div className="text-center py-12 text-slate-400 text-sm bg-white rounded-2xl border border-slate-200 border-dashed">
                                No controls linked.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default UseCaseView;
