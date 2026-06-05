import React from 'react';
import { AgentData, AgentDataSource, AgentSkill, AgentTool } from '../types/agent';
import { Share2, Wrench, Database, ArrowRight, Shield, CheckCircle, AlertTriangle, Zap } from 'lucide-react';

interface AgentLineageProps { agent: AgentData; }

/** Pill for PII / PHI / PCI flags */
const DataFlag: React.FC<{ label: string; active: boolean }> = ({ label, active }) =>
    active ? (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border bg-rose-50 border-rose-200 text-rose-700">
            <AlertTriangle size={8} /> {label}
        </span>
    ) : (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border bg-emerald-50 border-emerald-100 text-emerald-600">
            <CheckCircle size={8} /> No {label}
        </span>
    );

function isYes(value: unknown) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    return String(value ?? '').toLowerCase() === 'yes';
}

function displayText(value: unknown, fallback = 'Unknown') {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    return fallback;
}

function toArray<T>(value: unknown): T[] {
    if (Array.isArray(value)) return value.filter(Boolean) as T[];
    if (!value || typeof value !== 'object') return [];

    const objectValue = value as Record<string, unknown>;
    const nested = objectValue.data ?? objectValue.items ?? objectValue.results;
    if (Array.isArray(nested)) return nested.filter(Boolean) as T[];

    return [value as T];
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map(v => displayText(v, '')).filter(Boolean)
        : [];
}

const AgentLineage: React.FC<AgentLineageProps> = ({ agent }) => {
    const tools = toArray<AgentTool>((agent as any).tool);
    const skills = toArray<AgentSkill>((agent as any).skills).filter(skill =>
        displayText(skill.name ?? skill.skill_name ?? skill.identifier ?? skill.id ?? skill.skill_id, '').trim()
    );
    const dataSources = toArray<AgentDataSource>((agent as any).data_source);
    const relationships = dataSources.filter(
        ds => displayText(ds.target_object_type, '').toLowerCase() !== 'tool'
    );

    // Group data sources by target object type
    const grouped: Record<string, AgentDataSource[]> = {};
    for (const ds of relationships) {
        const type = displayText(ds.target_object_type, 'Other');
        if (!grouped[type]) grouped[type] = [];
        grouped[type].push(ds);
    }
    const groupedEntries = Object.entries(grouped);

    const hasPiiConcerns = relationships.some(
        ds => isYes(ds.uses_pii) || isYes(ds.uses_phi) || isYes(ds.uses_pci)
    );

    return (
        <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden flex flex-col h-full">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                        <Share2 size={20} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-800 tracking-tight">Lineage Map</h2>
                        <p className="text-xs text-slate-500 font-medium">Tools, skills, data sources & relationships</p>
                    </div>
                </div>
                {hasPiiConcerns && (
                    <span className="flex items-center gap-1.5 text-[11px] font-bold text-rose-600 bg-rose-50 border border-rose-100 px-2.5 py-1 rounded-full">
                        <Shield size={11} /> PII / sensitive data
                    </span>
                )}
            </div>

            <div className="flex-1 p-5 flex flex-col gap-6 overflow-y-auto">

                {/* ── Tools ─────────────────────────────────────── */}
                <div className="flex flex-col gap-3">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Wrench size={13} /> Attached Capabilities ({tools.length})
                    </h3>
                    {tools.length === 0 ? (
                        <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                            No capabilities configured.
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {tools.map((tool, idx) => (
                                <div key={idx} className="bg-slate-50 border border-slate-200 p-4 rounded-xl hover:border-indigo-200 transition-all">
                                    <div className="flex items-start justify-between gap-2 mb-1">
                                        <span className="font-bold text-sm text-slate-800 break-words">{displayText(tool.name, '')}</span>
                                        {tool.delegation_possible && (
                                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${tool.delegation_possible === 'true'
                                                    ? 'bg-indigo-50 border-indigo-100 text-indigo-700'
                                                    : 'bg-slate-100 border-slate-200 text-slate-500'
                                                }`}>
                                                {tool.delegation_possible === 'true' ? '↗ Delegatable' : 'Non-delegatable'}
                                            </span>
                                        )}
                                    </div>
                                    {tool.description && (
                                        <span className="text-xs text-slate-500 leading-relaxed block">{displayText(tool.description, '')}</span>
                                    )}
                                    {tool.allowed_delegates && (
                                        <p className="text-[11px] text-indigo-600 mt-1.5 font-medium">Delegates: {displayText(tool.allowed_delegates, '')}</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* ── Data Source Relationships ──────────────────── */}
                <div className="flex flex-col gap-3">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Zap size={13} /> Skills ({skills.length})
                    </h3>
                    {skills.length === 0 ? (
                        <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                            No skills configured.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {skills.map((skill, idx) => {
                                const label = displayText(
                                    skill.name ?? skill.skill_name ?? skill.identifier ?? skill.id ?? skill.skill_id,
                                    `Skill ${idx + 1}`,
                                );
                                const inputModes = stringArray(skill.inputModes ?? skill.input_modes);
                                const outputModes = stringArray(skill.outputModes ?? skill.output_modes);

                                return (
                                    <div key={skill.identifier ?? skill.id ?? skill.skill_id ?? idx} className="bg-slate-50 border border-slate-200 p-4 rounded-xl hover:border-indigo-200 transition-all">
                                        <span className="font-bold text-sm text-slate-800 break-words">{label}</span>
                                        {skill.description && (
                                            <span className="text-xs text-slate-500 leading-relaxed block mt-1">{displayText(skill.description, '')}</span>
                                        )}
                                        {(inputModes.length > 0 || outputModes.length > 0) && (
                                            <div className="flex flex-wrap gap-1 mt-2">
                                                {inputModes.map(mode => (
                                                    <span key={`in-${mode}`} className="text-[9px] font-bold px-2 py-0.5 rounded bg-emerald-50 border border-emerald-100 text-emerald-700 uppercase">
                                                        In: {mode}
                                                    </span>
                                                ))}
                                                {outputModes.map(mode => (
                                                    <span key={`out-${mode}`} className="text-[9px] font-bold px-2 py-0.5 rounded bg-blue-50 border border-blue-100 text-blue-700 uppercase">
                                                        Out: {mode}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="flex flex-col gap-3">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Database size={13} /> Relationships ({relationships.length})
                    </h3>
                    {groupedEntries.length === 0 ? (
                        <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                            No data relationships defined.
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4">
                            {groupedEntries.map(([type, sources]) => (
                                <div key={type}>
                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">{type}</p>
                                    <div className="flex flex-col gap-2">
                                        {sources.map((ds, i) => (
                                            <div key={i} className="bg-white border border-slate-100 rounded-xl p-3 shadow-sm">
                                                {/* Relationship arrow */}
                                                <div className="flex flex-wrap items-start gap-x-2 gap-y-1 mb-2 text-xs">
                                                    <span
                                                        className="font-semibold text-slate-700 whitespace-normal break-words leading-relaxed"
                                                        title={displayText(ds.source_object_name, 'Unknown source')}
                                                    >
                                                        {displayText(ds.source_object_name, 'Unknown source')}
                                                    </span>
                                                    <ArrowRight size={11} className="text-slate-400 shrink-0 mt-0.5" />
                                                    <span
                                                        className="font-bold text-indigo-700 whitespace-normal break-words leading-relaxed"
                                                        title={displayText(ds.target_object_name, 'Unknown target')}
                                                    >
                                                        {displayText(ds.target_object_name, 'Unknown target')}
                                                    </span>
                                                </div>
                                                {/* Access level + data flags */}
                                                <div className="flex flex-wrap gap-1 items-center">
                                                    {ds.access_level && (
                                                        <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600 uppercase">
                                                            {displayText(ds.access_level, '')}
                                                        </span>
                                                    )}
                                                    <DataFlag label="PII" active={isYes(ds.uses_pii)} />
                                                    <DataFlag label="PHI" active={isYes(ds.uses_phi)} />
                                                    <DataFlag label="PCI" active={isYes(ds.uses_pci)} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AgentLineage;
