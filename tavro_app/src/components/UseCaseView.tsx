import React from 'react';
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
} from 'lucide-react';

interface UseCaseViewProps {
    useCase: UseCaseDetail;
    agentsComponent?: React.ReactNode;
    businessImpactComponent?: React.ReactNode;
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

type PriorityTone = 'critical' | 'high' | 'moderate' | 'low' | 'planning' | 'unknown';

function getPriorityTone(priority?: string | null): PriorityTone {
    const p = String(priority ?? '').toLowerCase().trim();
    if (!p) return 'unknown';
    if (p.startsWith('1') || p.includes('critical')) return 'critical';
    if (p.startsWith('2') || p.includes('high')) return 'high';
    if (p.startsWith('3') || p.includes('moderate') || p.includes('medium')) return 'moderate';
    if (p.startsWith('4') || p.includes('low')) return 'low';
    if (p.startsWith('5') || p.includes('planning') || p.includes('plan')) return 'planning';
    return 'unknown';
}

function getPriorityTheme(tone: PriorityTone) {
    switch (tone) {
        case 'critical': return { badge: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' };
        case 'high':     return { badge: 'bg-orange-50 text-orange-700 border-orange-200', dot: 'bg-orange-500' };
        case 'moderate': return { badge: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' };
        case 'low':      return { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' };
        case 'planning': return { badge: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' };
        default:         return { badge: 'bg-slate-100 text-slate-500 border-slate-200', dot: 'bg-slate-300' };
    }
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

function TextBlock({ icon, title, text }: { icon: React.ReactNode; title: string; text?: string | null }) {
    if (!text) return null;
    return (
        <SectionCard icon={icon} title={title}>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{text}</p>
        </SectionCard>
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
        return new Date(raw).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
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
    return item?.sys_id ?? item?.id ?? item?.identifier ?? item?.value ?? item?.agent_id;
}

const UseCaseView: React.FC<UseCaseViewProps> = ({ useCase: uc, agentsComponent, businessImpactComponent }) => {
    const [activeTab, setActiveTab] = React.useState('details');

    const applications = uc.applications?.filter(Boolean) ?? [];
    const controls = uc.controls?.filter(Boolean) ?? [];
    const riskAssessments = uc.risk_assessments?.filter(Boolean) ?? [];
    const linkedAgents = ((uc as any).agents ?? (uc as any).of_associated_agents ?? []).filter(Boolean);
    const linkedAgentCount = linkedAgents.length;

    const statusLabel = uc.status || 'Proposed';
    const priorityValue = uc.priority ?? null;
    const priorityTone = getPriorityTone(priorityValue);
    const priorityTheme = getPriorityTheme(priorityTone);

    const owner = uc.owner ?? (uc as any).use_case_owner ?? null;
    const proposedBy = uc.proposed_by ?? (uc as any).proposed_by ?? null;
    const createdAt = (uc as any).created_at ?? (uc as any).sys_created_on ?? (uc as any).created ?? null;
    const updatedAt = (uc as any).updated_at ?? (uc as any).sys_updated_on ?? (uc as any).updated ?? null;
    const description = uc.description ?? (uc as any).description ?? null;

    const tabs = [
        { id: 'details',          label: 'Details',                  icon: Info },
        { id: 'business_case',    label: 'Business Case',            icon: FileText },
        { id: 'business_impact',  label: 'Business Impact',          icon: Building2 },
        { id: 'ai_agents',        label: `AI Agents (${linkedAgentCount})`, icon: Bot },
        { id: 'risk_assessments', label: 'Risk Assessments',         icon: ShieldAlert },
        { id: 'controls',         label: 'Controls',                 icon: ShieldCheck },
    ];

    return (
        <div className="flex flex-col gap-6 w-full animate-fade-in pb-6 max-w-[1400px] mx-auto">
            <div className="h-4 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-t-2xl w-full" />

            {/* ── Header card ── */}
            <div className="-mt-6 bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
                <div className="p-6 flex flex-col gap-4">
                    {/* Title row */}
                    <div className="flex items-start gap-4">
                        <div className="p-3 bg-blue-600 text-white rounded-xl shadow-sm shrink-0">
                            <ClipboardList size={22} />
                        </div>
                        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                            <h1 className="text-xl font-bold text-slate-800 tracking-tight leading-tight">
                                {(uc as any).name ?? (uc as any).title ?? 'Unnamed Use Case'}
                            </h1>
                            <div className="flex items-center gap-2 flex-wrap">
                                {uc.identifier && (
                                    <span className="font-mono text-[10px] bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-slate-500">
                                        {uc.identifier}
                                    </span>
                                )}
                                {uc.function && <MetaBadge text={String(uc.function)} color="blue" />}
                                {(uc as any).use_case_type && <MetaBadge text={String((uc as any).use_case_type)} color="slate" />}
                            </div>
                        </div>
                    </div>

                    {/* Metadata grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-slate-100">
                        <MetaField label="Status">
                            <StatusBadge status={statusLabel} />
                        </MetaField>

                        <MetaField label="Priority">
                            {priorityValue ? (
                                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold border ${priorityTheme.badge}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${priorityTheme.dot}`} />
                                    {priorityValue}
                                </span>
                            ) : <span className="text-slate-400 text-xs">—</span>}
                        </MetaField>

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
                </div>
            </div>

            {/* ── Tab bar ── */}
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

            {/* ── Tab content ── */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 shadow-sm min-h-[400px]">

                {/* Details tab — description + all metadata */}
                {activeTab === 'details' && (
                    <div className="flex flex-col gap-6 animate-fade-in">
                        {description ? (
                            <SectionCard icon={<FileText size={16} />} title="Description">
                                <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{description}</p>
                            </SectionCard>
                        ) : (
                            <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-8 text-center text-slate-400 text-sm">
                                No description provided.
                            </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {owner && (
                                <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex flex-col gap-1">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Owner</span>
                                    <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5"><User size={13} className="text-slate-400" />{owner}</span>
                                </div>
                            )}
                            {proposedBy && (
                                <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex flex-col gap-1">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Proposed By</span>
                                    <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5"><Users size={13} className="text-slate-400" />{proposedBy}</span>
                                </div>
                            )}
                            {uc.function && (
                                <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex flex-col gap-1">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Business Function</span>
                                    <span className="text-sm font-semibold text-slate-700">{String(uc.function)}</span>
                                </div>
                            )}
                            <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex flex-col gap-1">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Created</span>
                                <span className="text-sm text-slate-700 flex items-center gap-1.5"><CalendarDays size={13} className="text-slate-400" />{formatDate(createdAt)}</span>
                            </div>
                            <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex flex-col gap-1">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Last Updated</span>
                                <span className="text-sm text-slate-700 flex items-center gap-1.5"><CalendarDays size={13} className="text-slate-400" />{formatDate(updatedAt)}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Business Case tab */}
                {activeTab === 'business_case' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
                        <TextBlock icon={<FileText size={16} />} title="Business Problem Statement" text={(uc as any).problem_statement ?? (uc as any).business_problem_statement} />
                        <TextBlock icon={<CheckCircle2 size={16} />} title="Expected Benefits / Outcomes" text={uc.expected_benefits} />
                        <TextBlock icon={<Target size={16} />} title="Solution Approach" text={(uc as any).solution_approach} />
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
                )}

                {/* Business Impact tab */}
                {activeTab === 'business_impact' && (
                    <div className="animate-fade-in flex flex-col gap-6">
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
                        {businessImpactComponent}
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
                    <div className="animate-fade-in">
                        {riskAssessments.length > 0 ? (
                            <SectionCard icon={<ShieldAlert size={16} />} title="Risk Assessments" count={riskAssessments.length}>
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
                                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Information Security Score</span>
                                                        <span className="flex items-center gap-1">
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
                                                {ra.aivss_classification && (
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Info Security Class</span>
                                                        <span className="text-sm font-semibold text-slate-700">{ra.aivss_classification}</span>
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
                        ) : (
                            <div className="text-center py-12 text-slate-400 text-sm bg-white rounded-2xl border border-slate-200 border-dashed">
                                No Risk Assessments found.
                            </div>
                        )}
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
