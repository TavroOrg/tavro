import React, { useState } from 'react';
import { AgentData } from '../types/agent';
import { Settings2, Zap, Cpu, ChevronDown, ChevronUp } from 'lucide-react';
import AgentCapabilitiesCard from './AgentCapabilitiesCard';

interface AgentTechConfigTabProps { agent: AgentData; }

/** Small key-value pill for config grid */
const ConfigTile: React.FC<{ label: string; value: string | null | undefined; mono?: boolean }> = ({ label, value, mono }) => (
    <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-slate-50 border border-slate-100 shadow-sm hover:border-blue-200 transition-colors">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</span>
        <span className={`text-sm font-semibold text-slate-800 leading-tight ${mono ? 'font-mono text-xs' : ''}`}>
            {value || <span className="text-slate-400 font-normal italic">—</span>}
        </span>
    </div>
);

const SectionHead: React.FC<{ icon: React.ReactNode; title: string; rightAction?: React.ReactNode }> = ({ icon, title, rightAction }) => (
    <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <span className="text-blue-500">{icon}</span> {title}
        </h3>
        {rightAction}
    </div>
);

export const AgentTechConfigTab: React.FC<AgentTechConfigTabProps> = ({ agent }) => {
    const [instrSetsOpen, setInstrSetsOpen] = useState(false);

    const cfg = agent.configuration;
    const skills = agent.skills ?? [];
    const instrSets = agent.instruction_sets ?? [];

    return (
        <div className="flex flex-col gap-4 w-full mt-4">

            {/* ── Technical Configuration ─────────────────────────────── */}
            <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden p-6">
                <SectionHead icon={<Settings2 size={16} />} title="Technical Configuration" />
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    <ConfigTile label="Autonomy Level" value={cfg?.autonomy_level} />
                    <ConfigTile label="Reasoning Model" value={cfg?.reasoning_model} />
                    <ConfigTile label="Access Scope" value={cfg?.access_scope} />
                    <ConfigTile label="Memory Type" value={cfg?.memory_type} />
                    <ConfigTile label="Data Freshness" value={cfg?.data_freshness_policy} />
                    <ConfigTile label="Protocol" value={agent.protocol_version} mono />
                    <ConfigTile label="Transport" value={agent.preferredTransport} />
                    <ConfigTile label="Auth Required" value={agent.supports_authenticated_extended_card ? 'Yes' : agent.supports_authenticated_extended_card === false ? 'No' : undefined} />
                </div>
            </div>

            {/* ── Capabilities Extracted Document ─────────────────────── */}
            <AgentCapabilitiesCard agent={agent} />

            {/* ── Skills ──────────────────────────────────────────────── */}
            {skills.length > 0 && (
                <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden p-6">
                    <SectionHead icon={<Zap size={16} />} title="Skills" />
                    <div className="flex flex-wrap gap-2">
                        {skills.map((s, i) => (
                            <div key={s.identifier ?? s.id ?? i} className="flex flex-col gap-0.5 bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl">
                                <span className="text-xs font-bold text-slate-700">{s.name ?? `Skill ${i + 1}`}</span>
                                {s.description && <span className="text-[11px] text-slate-500 max-w-[200px]">{s.description}</span>}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Instruction Sets ────────────────────────────────────── */}
            {instrSets.length > 0 && (
                <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden p-6">
                    <SectionHead
                        icon={<Cpu size={16} />}
                        title={`Instruction Sets (${instrSets.length})`}
                        rightAction={
                            <button onClick={() => setInstrSetsOpen(o => !o)}
                                className="text-[11px] font-semibold text-blue-500 hover:text-blue-700 flex items-center gap-1">
                                {instrSetsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {instrSetsOpen ? 'Hide' : 'Show'}
                            </button>
                        }
                    />
                    {instrSetsOpen && (
                        <div className="flex flex-col gap-3">
                            {instrSets.map((s, i) => (
                                <div key={s.id ?? i} className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                                    <p className="text-xs font-bold text-slate-700 mb-2">{s.name ?? `Set ${i + 1}`}</p>
                                    {s.instruction && (
                                        <pre className="text-xs font-mono text-slate-500 whitespace-pre-wrap leading-relaxed max-h-[1000px] overflow-y-auto pr-2">
                                            {s.instruction}
                                        </pre>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

        </div>
    );
};

export default AgentTechConfigTab;
