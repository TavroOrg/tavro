/**
 * AgentCapabilitiesCard
 *
 * Covers all fields not visualised anywhere else:
 *   ai_model, guardrail, mcp_server, knowledge_source, prompt_template,
 *   memory, regulation_or_framework, control, security_schemes
 *
 * Sections are only rendered when their data contains at least one non-null value.
 */
import React from 'react';
import { AgentData } from '../types/agent';
import {
    Cpu, ShieldCheck, ServerCog, BookMarked, FileCode2,
    BrainCircuit, Scale, Lock, Globe, ClipboardList
} from 'lucide-react';

interface Props { agent: AgentData; }

/** Returns true if object/value has at least one non-null, non-empty field */
function hasData(v: any): boolean {
    if (v === null || v === undefined) return false;
    if (Array.isArray(v)) return v.some(hasData);
    if (typeof v === 'object') return Object.values(v).some(hasData);
    return String(v).trim() !== '' && v !== 'null';
}

/** Subtle section heading */
const SHead: React.FC<{ icon: React.ReactNode; title: string; count?: number }> = ({ icon, title, count }) => (
    <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2 mb-3">
        <span className="text-slate-400">{icon}</span>
        {title}
        {count !== undefined && <span className="font-normal text-slate-400">({count})</span>}
    </h3>
);

/** Simple key-value row */
const KV: React.FC<{ label: string; value?: string | null }> = ({ label, value }) =>
    value ? (
        <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{label}</span>
            <span className="text-sm text-slate-700 leading-snug">{value}</span>
        </div>
    ) : null;

const AgentCapabilitiesCard: React.FC<Props> = ({ agent }) => {
    const sections: React.ReactNode[] = [];

    // ── AI Models ─────────────────────────────────────────────────────────────
    const aiModels = (agent.ai_model ?? []).filter(hasData);
    if (aiModels.length > 0) {
        sections.push(
            <div key="ai-model" className="flex flex-col gap-3">
                <SHead icon={<Cpu size={13} />} title="AI Models" count={aiModels.length} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {aiModels.map((m, i) => (
                        <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-2">
                            <p className="font-bold text-sm text-slate-800">{m.name ?? `Model ${i + 1}`}</p>
                            {m.description && <p className="text-xs text-slate-500 leading-relaxed">{m.description}</p>}
                            {m.owner && <p className="text-[11px] text-indigo-600 font-medium">Owner: {m.owner}</p>}
                            {m.department_executive && <p className="text-[11px] text-slate-400">Exec: {m.department_executive}</p>}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // ── Guardrail ─────────────────────────────────────────────────────────────
    if (hasData(agent.guardrail)) {
        const g = agent.guardrail!;
        sections.push(
            <div key="guardrail" className="flex flex-col gap-3">
                <SHead icon={<ShieldCheck size={13} />} title="Guardrail" />
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex flex-col gap-2">
                    <KV label="Name" value={g.name} />
                    <KV label="Model" value={g.model} />
                    {g.description && <p className="text-xs text-slate-600 leading-relaxed">{g.description}</p>}
                </div>
            </div>
        );
    }

    // ── MCP Server ────────────────────────────────────────────────────────────
    if (hasData(agent.mcp_server)) {
        const s = agent.mcp_server!;
        sections.push(
            <div key="mcp" className="flex flex-col gap-3">
                <SHead icon={<ServerCog size={13} />} title="MCP Server" />
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-2">
                    <KV label="Name" value={s.name} />
                    <KV label="Version" value={s.version_number} />
                    {s.url && (
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">URL</span>
                            <a href={s.url} target="_blank" rel="noreferrer"
                                className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                                <Globe size={11} /> {s.url}
                            </a>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── Knowledge Source ──────────────────────────────────────────────────────
    if (hasData(agent.knowledge_source)) {
        const k = agent.knowledge_source!;
        sections.push(
            <div key="knowledge" className="flex flex-col gap-3">
                <SHead icon={<BookMarked size={13} />} title="Knowledge Source" />
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-2">
                    <KV label="Name" value={k.name} />
                    <KV label="Access Mechanism" value={k.access_mechanism} />
                </div>
            </div>
        );
    }

    // ── Prompt Template ───────────────────────────────────────────────────────
    if (hasData(agent.prompt_template)) {
        const pt = agent.prompt_template!;
        sections.push(
            <div key="prompt" className="flex flex-col gap-3">
                <SHead icon={<FileCode2 size={13} />} title="Prompt Template" />
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex flex-col gap-2">
                    <KV label="Name" value={pt.name} />
                    {pt.description && <p className="text-xs text-slate-600 leading-relaxed">{pt.description}</p>}
                </div>
            </div>
        );
    }

    // ── Memory ────────────────────────────────────────────────────────────────
    if (hasData(agent.memory)) {
        const m = agent.memory!;
        sections.push(
            <div key="memory" className="flex flex-col gap-3">
                <SHead icon={<BrainCircuit size={13} />} title="Memory Configuration" />
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-2">
                    <KV label="Name" value={m.name} />
                    <KV label="Type" value={m.type} />
                </div>
            </div>
        );
    }

    // ── Regulations & Frameworks ──────────────────────────────────────────────
    if (hasData(agent.regulation_or_framework)) {
        const rf = agent.regulation_or_framework!;
        sections.push(
            <div key="reg" className="flex flex-col gap-3">
                <SHead icon={<Scale size={13} />} title="Regulation / Framework" />
                <div className="bg-rose-50 border border-rose-100 rounded-xl p-4 flex flex-col gap-2">
                    <KV label="Name" value={rf.name} />
                    <KV label="Type" value={rf.type} />
                    <KV label="Regulatory Authority" value={rf.regulatory_authority} />
                    <KV label="Jurisdiction" value={rf.jurisdiction} />
                    {rf.requirement && (
                        <div className="flex flex-col gap-0.5 mt-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Requirement</span>
                            <p className="text-xs text-slate-600 leading-relaxed">{rf.requirement}</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── Controls ──────────────────────────────────────────────────────────────
    const controls = (agent.control ?? []).filter(hasData);
    if (controls.length > 0) {
        sections.push(
            <div key="controls" className="flex flex-col gap-3">
                <SHead icon={<ClipboardList size={13} />} title="Controls" count={controls.length} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {controls.map((c, i) => (
                        <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-2">
                            <p className="font-bold text-sm text-slate-800">{c.name ?? `Control ${i + 1}`}</p>
                            {c.domain && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-500 w-fit uppercase">
                                    {c.domain}
                                </span>
                            )}
                            {c.objective && <p className="text-xs text-slate-500 leading-relaxed">{c.objective}</p>}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // ── Security Schemes ──────────────────────────────────────────────────────
    if (hasData(agent.security_schemes)) {
        const schemes = Object.entries(agent.security_schemes!);
        sections.push(
            <div key="security" className="flex flex-col gap-3">
                <SHead icon={<Lock size={13} />} title="Security Schemes" count={schemes.length} />
                <div className="flex flex-col gap-2">
                    {schemes.map(([key, scheme]) => (
                        <div key={key} className="bg-slate-900 text-slate-200 rounded-xl p-4 flex flex-col gap-1.5">
                            <p className="font-bold text-sm text-slate-100">{key}</p>
                            {scheme?.type && <span className="text-[10px] font-bold uppercase text-slate-400">{scheme.type}</span>}
                            {scheme?.description && <p className="text-xs text-slate-400 leading-relaxed">{scheme.description}</p>}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Don't render the card at all if there's nothing to show
    if (sections.length === 0) return null;

    return (
        <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center gap-3">
                <div className="p-2 bg-violet-50 text-violet-600 rounded-lg border border-violet-100">
                    <ServerCog size={18} />
                </div>
                <div>
                    <p className="font-bold text-slate-800 text-sm">Models, Governance & Compliance</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                        AI models · guardrails · knowledge · memory · regulations · controls
                    </p>
                </div>
            </div>

            {/* Sections grid */}
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                {sections}
            </div>
        </div>
    );
};

export default AgentCapabilitiesCard;
