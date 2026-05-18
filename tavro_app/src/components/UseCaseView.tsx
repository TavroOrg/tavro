import React from 'react';
import { UseCaseDetail } from '../types/useCase';
import {
    Building2,
    GitBranch,
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
    Tag
} from 'lucide-react';

interface UseCaseViewProps {
    useCase: UseCaseDetail;
    agentsComponent?: React.ReactNode;
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
        case 'critical':
            return {
                badge: 'bg-red-50 text-red-700 border-red-200',
                text: 'text-red-600',
            };
        case 'high':
            return {
                badge: 'bg-orange-50 text-orange-700 border-orange-200',
                text: 'text-orange-600',
            };
        case 'moderate':
            return {
                badge: 'bg-amber-50 text-amber-700 border-amber-200',
                text: 'text-amber-600',
            };
        case 'low':
            return {
                badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                text: 'text-emerald-600',
            };
        case 'planning':
            return {
                badge: 'bg-slate-100 text-slate-600 border-slate-200',
                text: 'text-slate-600',
            };
        default:
            return {
                badge: 'bg-slate-100 text-slate-600 border-slate-200',
                text: 'text-slate-500',
            };
    }
}

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
                    <span className="ml-1 text-xs font-semibold text-slate-400">- {count}</span>
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
function getLabel(item: any, fallback = 'N/A'): string {
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

const UseCaseView: React.FC<UseCaseViewProps> = ({ useCase: uc, agentsComponent }) => {
    const [activeTab, setActiveTab] = React.useState('business_case');

    const applications = uc.applications?.filter(Boolean) ?? [];
    const bizProcesses = uc.business_processes?.filter(Boolean) ?? [];
    const controls = uc.controls?.filter(Boolean) ?? [];
    const riskAssessments = uc.risk_assessments?.filter(Boolean) ?? [];

    const statusLabel = uc.status || 'Proposed';
    const priorityValue = uc.priority ?? null;
    const priorityTone = getPriorityTone(priorityValue);
    const priorityTheme = getPriorityTheme(priorityTone);

    const tabs = [
        { id: 'business_case', label: 'Business Case', icon: FileText },
        { id: 'business_impact', label: 'Business Impact', icon: Building2 },
        { id: 'ai_agents', label: 'AI Agents', icon: Bot },
        { id: 'risk_assessments', label: 'Risk Assessments', icon: ShieldAlert },
        { id: 'controls', label: 'Controls', icon: ShieldCheck }
    ];

    return (
        <div className="flex flex-col gap-6 w-full animate-fade-in pb-6 max-w-[1400px] mx-auto">
            <div className="h-4 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-t-2xl w-full" />

            <div className="-mt-6 bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
                <div className="p-6 bg-slate-50 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 flex-wrap">
                    <div className="flex items-start gap-4 min-w-0 flex-1 md:max-w-[45%]">
                        <div className="p-3 bg-blue-600 text-white rounded-xl shadow-sm mt-1 shrink-0">
                            <ClipboardList size={24} />
                        </div>
                        <div className="flex flex-col gap-1.5 min-w-0">
                            <h1 className="text-2xl font-bold text-slate-800 tracking-tight line-clamp-2">
                                {uc.name || 'Unnamed Use Case'}
                            </h1>
                            <div className="flex items-center gap-2 flex-wrap">
                                {uc.identifier && (
                                    <span className="font-mono text-xs bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-600">
                                        {uc.identifier}
                                    </span>
                                )}
                                {uc.function && <MetaBadge text={String(uc.function)} color="blue" />}
                                {(uc as any).use_case_type && <MetaBadge text={String((uc as any).use_case_type)} color="slate" />}
                            </div>
                            {uc.description && (
                                <p className="text-sm text-slate-600 leading-relaxed line-clamp-2">{uc.description}</p>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-center gap-3 shrink-0 w-full md:w-auto mt-2 md:mt-0">
                        <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[110px]">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">Status</span>
                            <StatusBadge status={statusLabel} />
                        </div>
                        <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[110px]">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">Priority</span>
                            <span className={`inline-flex items-center gap-1 text-xs font-bold ${priorityTheme.text}`}>
                                <ShieldAlert size={13} /> {priorityValue || 'N/A'}
                            </span>
                        </div>
                    </div>

                    <div className="flex flex-col items-end gap-3 shrink-0 w-full md:w-auto md:ml-auto mt-2 md:mt-0">
                        <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm text-xs font-semibold text-slate-600 flex flex-col items-end min-w-[170px]">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">Owner</span>
                            <span>{uc.owner || 'Unassigned'}</span>
                        </div>
                        <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm text-xs font-semibold text-slate-600 flex flex-col items-end min-w-[170px]">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">Proposed By</span>
                            <span>{uc.proposed_by || 'N/A'}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide border-b border-slate-200">
                {tabs.map(tab => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-3 text-sm font-bold whitespace-nowrap transition-all border-b-2 ${isActive
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

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 shadow-sm min-h-[400px]">

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
                        {uc.function && (
                            <SectionCard icon={<Building2 size={16} />} title="Business Function">
                                <p className="text-sm text-slate-700">{String(uc.function)}</p>
                            </SectionCard>
                        )}
                        {(uc as any).use_case_type && (
                            <SectionCard icon={<Tag size={16} />} title="Use Case Type">
                                <p className="text-sm text-slate-700">{(uc as any).use_case_type}</p>
                            </SectionCard>
                        )}
                    </div>
                )}

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

                {activeTab === 'ai_agents' && (
                    <div className="animate-fade-in">
                        {agentsComponent ? agentsComponent : (
                            <div className="text-center py-12 text-slate-400 text-sm bg-white rounded-2xl border border-slate-200 border-dashed">
                                Agents manager not provided.
                            </div>
                        )}
                    </div>
                )}

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
