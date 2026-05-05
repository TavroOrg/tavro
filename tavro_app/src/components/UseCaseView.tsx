import React from 'react';
import { UseCaseDetail } from '../types/useCase';
import {
    Lightbulb, Building2, GitBranch, ShieldCheck,
    AlertTriangle, CheckCircle2, Clock, Archive, Target,
    FileText, Users, Cpu, Tag
} from 'lucide-react';
interface UseCaseViewProps {
    useCase: UseCaseDetail;
    agentsComponent?: React.ReactNode;
}

// ── Helpers ───────────────────────────────────────────────────────────────────


function StatusBadge({ status }: { status?: string | null }) {
    if (!status) return null;
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
        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border ${cls}`}>
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
            <AlertTriangle size={11} /> {classification}
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
                    <span className="ml-1 text-xs font-semibold text-slate-400">· {count}</span>
                )}
            </div>
            <div className="p-5">{children}</div>
        </div>
    );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
    if (!value) return null;
    return (
        <div className="flex flex-col gap-0.5">
            <dt className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</dt>
            <dd className="text-sm text-slate-800">{value}</dd>
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

/**
 * Extract a human-readable label from a relationship item that may be:
 *  - A flat object with `name`, `title`, `display_value`, `u_name`, `identifier` fields
 *  - A ServiceNow reference object: { value: "GUIDsys_id", display_value: "Human Name" }
 *  - A ServiceNow nested reference: { link: "...", value: "...", display_value: "..." }
 */
function getLabel(item: any, fallback = '—'): string {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return fallback;

    // Check common label fields first
    const labelFields = ['name', 'display_value', 'u_display_name', 'title', 'u_name', 'identifier', 'agent_id', 'short_description'];
    for (const field of labelFields) {
        if (item[field] && typeof item[field] === 'string' && item[field] !== (item.value ?? item.sys_id)) return item[field];
    }

    // ServiceNow nested reference object: { value: "...", display_value: "..." }
    if (item.display_value && item.display_value !== item.value) {
        return item.display_value;
    }

    // Recursively search nested objects for a label
    for (const key of Object.keys(item)) {
        const v = item[key];
        if (v && typeof v === 'object') {
            const nestedLabel = getLabel(v, '');
            if (nestedLabel && nestedLabel !== '') return nestedLabel;
        }
    }

    // Last resort: sys_id/id
    return item.sys_id ?? item.id ?? item.value ?? fallback;
}

function getId(item: any): string | undefined {
    return item?.sys_id ?? item?.id ?? item?.identifier ?? item?.value ?? item?.agent_id;
}

// ── Component ─────────────────────────────────────────────────────────────────

const UseCaseView: React.FC<UseCaseViewProps> = ({ useCase: uc, agentsComponent }) => {
    const [activeTab, setActiveTab] = React.useState('business_case');

    const applications = uc.applications?.filter(Boolean) ?? [];
    const bizProcesses = uc.business_processes?.filter(Boolean) ?? [];
    const controls = uc.controls?.filter(Boolean) ?? [];
    const riskAssessments = uc.risk_assessments?.filter(Boolean) ?? [];

    const tabs = [
        { id: 'business_case', label: 'Business Case', icon: FileText },
        { id: 'business_impact', label: 'Business Impact', icon: Building2 },
        { id: 'ai_agents', label: 'AI Agents', icon: Cpu },
        { id: 'risk_assessments', label: 'Risk Assessments', icon: AlertTriangle },
        { id: 'controls', label: 'Controls', icon: ShieldCheck }
    ];

    return (
        <div className="flex flex-col w-full animate-fade-in pb-6">

            {/* ── Hero Header ──────────────────────────────────────────────── */}
            <div className="bg-white rounded-t-2xl border border-slate-200 shadow-sm overflow-hidden z-20 relative">
                <div className="border-l-4 border-violet-500">
                    <div className="p-6 flex flex-col gap-4">
                        {/* Title row */}
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                            <div className="flex items-center gap-3">
                                <div className="p-3 bg-violet-50 text-violet-600 rounded-xl">
                                    <Lightbulb size={24} />
                                </div>
                                <div>
                                    <h1 className="text-2xl font-bold text-slate-800 tracking-tight">{uc.name || 'Unnamed Use Case'}</h1>
                                    {uc.identifier && (
                                        <span className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded mt-1 inline-block">
                                            {uc.identifier}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Description */}
                        {uc.description && (
                            <p className="text-slate-600 text-sm leading-relaxed max-w-4xl">{uc.description}</p>
                        )}

                        {/* Metadata grid */}
                        <dl className="grid grid-cols-2 lg:grid-cols-5 gap-x-6 gap-y-4 mt-1">
                            <InfoRow label="Owner" value={uc.owner} />
                            <InfoRow label="Proposed By" value={uc.proposed_by} />
                            <InfoRow label="Priority / Risk Tier" value={uc.priority} />

                            {/* Status moved here, next to priority */}
                            {uc.status && (
                                <div className="flex flex-col gap-1 items-start">
                                    <dt className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</dt>
                                    <dd><StatusBadge status={uc.status} /></dd>
                                </div>
                            )}

                            <InfoRow label="Business Sponsors" value={(uc as any).business_sponsors} />

                            {/* Overall risk */}
                            {(uc as any).overall_risk && (
                                <div className="flex flex-col gap-1 items-start">
                                    <dt className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Overall Risk</dt>
                                    <dd><RiskBadge classification={(uc as any).overall_risk} /></dd>
                                </div>
                            )}

                            {(uc as any).tag && (
                                <div className="flex flex-col gap-0.5">
                                    <dt className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                                        <Tag size={10} /> Tags
                                    </dt>
                                    <dd className="text-sm text-slate-800">{(uc as any).tag}</dd>
                                </div>
                            )}
                        </dl>
                    </div>
                </div>

                {/* ── Tab Navigation ── */}
                <div className="flex px-4 pt-2 border-t border-slate-100 bg-slate-50/50 overflow-x-auto no-scrollbar">
                    {tabs.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-5 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${isActive
                                    ? 'border-violet-600 text-violet-700 bg-violet-50/50 rounded-t-lg'
                                    : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                                    }`}
                            >
                                <Icon size={16} className={isActive ? 'text-violet-600' : 'text-slate-400'} />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ── Tab Content Container ── */}
            <div className="bg-slate-50 border-x border-b border-slate-200 rounded-b-2xl p-6 shadow-sm min-h-[400px]">

                {/* ── Tab: Business Case ── */}
                {activeTab === 'business_case' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
                        <TextBlock icon={<FileText size={16} />} title="Business Problem Statement" text={uc.problem_statement} />
                        <TextBlock icon={<CheckCircle2 size={16} />} title="Expected Benefits / Outcomes" text={uc.expected_benefits} />
                        <TextBlock icon={<Target size={16} />} title="Solution Approach" text={(uc as any).solution_approach} />
                        {(uc as any).business_sponsors && (
                            <SectionCard icon={<Users size={16} />} title="Business Sponsors">
                                <p className="text-sm text-slate-700">{(uc as any).business_sponsors}</p>
                            </SectionCard>
                        )}
                        {uc['function'] && (
                            <SectionCard icon={<Building2 size={16} />} title="Business Function">
                                <p className="text-sm text-slate-700">{uc['function'] as string}</p>
                            </SectionCard>
                        )}
                        {(uc as any).use_case_type && (
                            <SectionCard icon={<Tag size={16} />} title="Use Case Type">
                                <p className="text-sm text-slate-700">{(uc as any).use_case_type}</p>
                            </SectionCard>
                        )}
                    </div>
                )}

                {/* ── Tab: Business Impact ── */}
                {activeTab === 'business_impact' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in">
                        {applications.length > 0 ? (
                            <SectionCard icon={<Building2 size={16} />} title="Applications" count={applications.length}>
                                <div className="flex flex-col divide-y divide-slate-100">
                                    {applications.map((app: any, i: number) => (
                                        <div key={getId(app) ?? i} className="py-3 first:pt-0 last:pb-0">
                                            <div className="flex items-center justify-between mb-0.5">
                                                <p className="text-sm font-semibold text-slate-800">
                                                    {getLabel(app)}
                                                </p>
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
                        ) : (
                            <div className="col-span-1 text-center py-12 text-slate-400 text-sm bg-white rounded-2xl border border-slate-200 border-dashed">No applications linked.</div>
                        )}

                        {bizProcesses.length > 0 ? (
                            <SectionCard icon={<GitBranch size={16} />} title="Business Processes" count={bizProcesses.length}>
                                <div className="flex flex-col divide-y divide-slate-100">
                                    {bizProcesses.map((proc: any, i: number) => (
                                        <div key={getId(proc) ?? i} className="py-3 first:pt-0 last:pb-0">
                                            <p className="text-sm font-semibold text-slate-800">{getLabel(proc)}</p>
                                            {(proc.description ?? proc.short_description) && (
                                                <p className="text-xs text-slate-400 mt-0.5">{proc.description ?? proc.short_description}</p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </SectionCard>
                        ) : (
                            <div className="col-span-1 text-center py-12 text-slate-400 text-sm bg-white rounded-2xl border border-slate-200 border-dashed">No business processes linked.</div>
                        )}
                    </div>
                )}

                {/* ── Tab: AI Agents ── */}
                {activeTab === 'ai_agents' && (
                    <div className="animate-fade-in">
                        {agentsComponent ? agentsComponent : (
                            <div className="text-center py-12 text-slate-400 text-sm bg-white rounded-2xl border border-slate-200 border-dashed">
                                Agents manager not provided.
                            </div>
                        )}
                    </div>
                )}

                {/* ── Tab: Risk Assessments ── */}
                {activeTab === 'risk_assessments' && (
                    <div className="animate-fade-in">
                        {riskAssessments.length > 0 ? (
                            <SectionCard icon={<AlertTriangle size={16} />} title="Risk Assessments" count={riskAssessments.length}>
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
                                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">AIVSS Score</span>
                                                        <span className="text-sm font-bold text-slate-800">{ra.aivss_score}</span>
                                                    </div>
                                                )}
                                                {ra.aivss_classification && (
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">AIVSS Class</span>
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

                {/* ── Tab: Controls ── */}
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
