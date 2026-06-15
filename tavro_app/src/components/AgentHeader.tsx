import React from 'react';
import { AgentData } from '../types/agent';
import { Bot, ExternalLink, Globe, BookOpen, ShieldAlert, CheckCircle2, Loader2 } from 'lucide-react';
import { getAgentRiskLevel } from '../utils/agentRisk';

type AgentInlineField = 'name' | 'description' | 'instruction';

interface AgentHeaderProps {
    agent: AgentData;
    isEditing?: boolean;
    editName?: string;
    onEditNameChange?: (v: string) => void;
    inlineEdit?: { field: AgentInlineField; value: string } | null;
    inlineSaving?: AgentInlineField | null;
    onStartInlineEdit?: (field: AgentInlineField) => void;
    onInlineValueChange?: (value: string) => void;
    onSaveInlineEdit?: () => void;
    onCancelInlineEdit?: () => void;
}

const Badge: React.FC<{ text: string; color?: 'blue' | 'emerald' | 'amber' | 'rose' | 'slate' }> = ({ text, color = 'slate' }) => {
    const cls = {
        blue: 'bg-blue-50 text-blue-700 border-blue-100',
        emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        amber: 'bg-amber-50 text-amber-700 border-amber-100',
        rose: 'bg-rose-50 text-rose-700 border-rose-100',
        slate: 'bg-slate-100 text-slate-600 border-slate-200',
    }[color];
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide ${cls}`}>{text}</span>;
};

const AgentHeader: React.FC<AgentHeaderProps> = ({
    agent,
    isEditing,
    editName,
    onEditNameChange,
    inlineEdit,
    inlineSaving,
    onStartInlineEdit,
    onInlineValueChange,
    onSaveInlineEdit,
    onCancelInlineEdit,
}) => {
    const id = agent.identification;
    const caps = agent.capabilities;

    const capBadges: string[] = [];
    if (caps?.streaming === true) capBadges.push('Streaming');
    if (caps?.streaming === false) capBadges.push('Non-streaming');
    Object.entries(caps ?? {}).forEach(([k, v]) => {
        if (k !== 'streaming' && v === true) capBadges.push(k);
    });

    const riskLevel: 'prohibited' | 'high' | 'medium' | 'low' = getAgentRiskLevel(agent);
    const riskScore = agent.latest_risk_score
        ?? agent.risk_assessment?.blended_risk_score
        ?? agent.risk_assessment?.regulatory_risk_score;
    const isPendingAssessment =
        (agent.identification?.governance_status ?? agent.latest_event_status) === 'Risk Assessment is running';
    const riskCardClass =
        riskLevel === 'prohibited' || riskLevel === 'high'
            ? 'bg-red-50 border-red-200'
            : riskLevel === 'medium'
                ? 'bg-amber-50 border-amber-200'
                : 'bg-emerald-50 border-emerald-200';
    const riskTextClass =
        riskLevel === 'prohibited' || riskLevel === 'high'
            ? 'text-red-600'
            : riskLevel === 'medium'
                ? 'text-amber-600'
                : 'text-emerald-600';

    const riskClass = (agent.latest_risk_class ?? agent.risk_assessment?.blended_risk_classification ?? '').toLowerCase();
    const riskClassCardClass =
        riskClass === 'high' ? 'bg-red-50 border-red-200' :
            riskClass === 'medium' ? 'bg-amber-50 border-amber-200' :
                riskClass === 'low' ? 'bg-emerald-50 border-emerald-200' :
                    'bg-slate-50 border-slate-200';
    const riskClassTextClass =
        riskClass === 'high' ? 'text-red-600' :
            riskClass === 'medium' ? 'text-amber-600' :
                riskClass === 'low' ? 'text-emerald-600' :
                    'text-slate-400';
    const isInlineName = inlineEdit?.field === 'name';
    const isSavingName = inlineSaving === 'name';
    const nameSaveDisabled = isSavingName || !inlineEdit?.value.trim();
    return (
        <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden flex flex-col">
            <div className="p-6 bg-slate-50 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 flex-wrap">
                <div className="flex items-start gap-4 min-w-0 flex-1 md:max-w-[60%]">
                    <div className="p-3 bg-blue-600 text-white rounded-xl shadow-sm mt-1 shrink-0">
                        <Bot size={28} />
                    </div>
                    <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                        {isEditing ? (
                            <input
                                type="text"
                                value={editName ?? agent.name}
                                onChange={e => onEditNameChange?.(e.target.value)}
                                className="text-2xl font-bold text-slate-800 tracking-tight w-full border-b-2 border-blue-400 bg-transparent outline-none pb-0.5"
                            />
                        ) : isInlineName && inlineEdit ? (
                            <div className="flex items-center gap-2 w-full">
                                <input
                                    type="text"
                                    value={inlineEdit.value}
                                    onChange={e => onInlineValueChange?.(e.target.value)}
                                    className="text-2xl font-bold text-slate-800 tracking-tight flex-1 border-b-2 border-blue-400 bg-transparent outline-none pb-0.5"
                                    autoFocus
                                />
                                <button
                                    type="button"
                                    onClick={onSaveInlineEdit}
                                    disabled={nameSaveDisabled}
                                    title={!inlineEdit.value.trim() ? 'Agent Name is required' : 'Save'}
                                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-xs font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                                >
                                    {isSavingName ? <Loader2 size={14} className="animate-spin" /> : '✓'}
                                </button>
                                <button
                                    type="button"
                                    onClick={onCancelInlineEdit}
                                    disabled={isSavingName}
                                    title="Cancel"
                                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                                >
                                    ✕
                                </button>
                            </div>
                        ) : (
                            <h2
                                onDoubleClick={() => onStartInlineEdit?.('name')}
                                title="Double-click to edit"
                                className="text-2xl font-bold text-slate-800 tracking-tight break-words cursor-text rounded-lg hover:bg-blue-50/50 transition-colors"
                            >
                                {agent.name}
                            </h2>
                        )}
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-600 break-all">
                                {id?.agent_id || 'N/A'}
                            </span>
                            {id?.environment && <Badge text={id.environment} color="blue" />}
                        </div>
                        {((agent.defaultInputModes?.length ?? 0) > 0 || (agent.defaultOutputModes?.length ?? 0) > 0 || capBadges.length > 0) && (
                            <div className="flex flex-wrap gap-2 mt-1">
                                {(agent.defaultInputModes?.length ?? 0) > 0 && (
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">In:</span>
                                        {agent.defaultInputModes!.map(m => <Badge key={m} text={m} color="blue" />)}
                                    </div>
                                )}
                                {(agent.defaultOutputModes?.length ?? 0) > 0 && (
                                    <div className="flex items-center gap-1.5 ml-2">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Out:</span>
                                        {agent.defaultOutputModes!.map(m => <Badge key={m} text={m} color="emerald" />)}
                                    </div>
                                )}
                                {capBadges.length > 0 && (
                                    <div className="flex items-center gap-1.5 ml-2">
                                        {capBadges.map(c => <Badge key={c} text={c} color="slate" />)}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex flex-col items-center md:items-end gap-3 shrink-0 flex-1 md:max-w-[30%] mt-2 md:mt-0">
                    <div className="grid grid-cols-3 gap-3 w-full">
                        <div className={`px-3 py-3 rounded-xl border shadow-sm text-xs font-semibold flex flex-col items-center justify-center text-center min-w-0 overflow-hidden ${riskCardClass}`}>
                            <span className="w-full text-center text-[10px] leading-tight text-slate-400 font-bold uppercase tracking-normal mb-1.5 [word-break:normal] [overflow-wrap:normal]">
                                Blended Score
                            </span>
                            {riskScore != null ? (
                                <span className={`inline-flex items-center gap-1 text-sm font-bold whitespace-nowrap ${riskTextClass}`}>
                                    {riskLevel === 'low'
                                        ? <CheckCircle2 size={14} className="shrink-0" />
                                        : <ShieldAlert size={14} className="shrink-0" />}
                                    <span className="break-all">{riskScore}</span>
                                </span>
                            ) : (
                                <span className={`inline-flex items-center gap-1 text-sm font-bold whitespace-nowrap ${riskTextClass}`}>
                                    {riskLevel === 'low'
                                        ? <CheckCircle2 size={14} className="shrink-0" />
                                        : <ShieldAlert size={14} className="shrink-0" />}
                                    N/A
                                </span>
                            )}
                        </div>
                        <div className={`px-3 py-3 rounded-xl border shadow-sm text-xs font-semibold flex flex-col items-center justify-center text-center min-w-0 overflow-hidden ${riskClassCardClass}`}>
                            <span className="w-full text-center text-[10px] leading-tight text-slate-400 font-bold uppercase tracking-normal mb-1.5 [word-break:normal] [overflow-wrap:normal]">
                                Blended Risk Classification
                            </span>
                            <span className={`inline-flex items-center gap-1 text-sm font-bold whitespace-nowrap ${riskClassTextClass}`}>
                                {riskClass === 'low'
                                    ? <CheckCircle2 size={14} className="shrink-0" />
                                    : <ShieldAlert size={14} className="shrink-0" />}
                                <span className="break-words">{riskClass ? riskClass.charAt(0).toUpperCase() + riskClass.slice(1) : 'N/A'}</span>
                            </span>
                        </div>
                        <div className="px-3 py-3 bg-white rounded-xl border border-slate-200 shadow-sm text-xs font-semibold text-slate-600 flex flex-col items-center justify-center text-center min-w-0 overflow-hidden">
                            <span className="w-full text-center text-[10px] leading-tight text-slate-400 font-bold uppercase tracking-normal mb-1.5 [word-break:normal] [overflow-wrap:normal]">Provider</span>
                            {agent.provider?.url
                                ? <a href={agent.provider.url} target="_blank" rel="noreferrer" className="flex flex-wrap items-center justify-center gap-1 hover:text-blue-600 transition-colors break-all"><span className="break-words">{agent.provider.organization || 'Tavro Internal'}</span> <ExternalLink size={10} className="shrink-0" /></a>
                                : <span className="break-words">{agent.provider?.organization || 'Tavro Internal'}</span>}
                        </div>
                    </div>
                    {isPendingAssessment && (
                        <div className="flex items-center self-start gap-1.5 text-[10px] font-bold px-2 py-1 rounded-md border bg-amber-50 text-amber-700 border-amber-100 whitespace-nowrap justify-center">
                            <Loader2 size={10} className="animate-spin" />
                            Running Risk Assessment
                        </div>
                    )}
                    <div className="flex flex-col items-end sm:flex-row sm:items-center gap-3">
                        {agent.url && (
                            <a href={agent.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] text-blue-600 hover:underline font-medium">
                                <Globe size={11} /> Agent URL
                            </a>
                        )}
                        {agent.documentation_url && (
                            <a href={agent.documentation_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] text-blue-600 hover:underline font-medium">
                                <BookOpen size={11} /> Docs
                            </a>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AgentHeader;

