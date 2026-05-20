import React from 'react';
import { AgentData } from '../types/agent';
import { Bot, ExternalLink, Globe, BookOpen, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { getAgentRiskLevel } from '../utils/agentRisk';

interface AgentHeaderProps { agent: AgentData; }

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

const AgentHeader: React.FC<AgentHeaderProps> = ({ agent }) => {
    const id = agent.identification;
    const caps = agent.capabilities;

    const capBadges: string[] = [];
    if (caps?.streaming === true) capBadges.push('Streaming');
    if (caps?.streaming === false) capBadges.push('Non-streaming');
    Object.entries(caps ?? {}).forEach(([k, v]) => {
        if (k !== 'streaming' && v === true) capBadges.push(k);
    });

    const riskLevel: 'prohibited' | 'high' | 'medium' | 'low' = getAgentRiskLevel(agent);
    const isWorkflowRunning = (id?.governance_status ?? (agent as any).latest_event_status) === 'Risk Assessment is running';
    const riskScore = agent.latest_risk_score
        ?? agent.risk_assessment?.blended_risk_score
        ?? agent.risk_assessment?.regulatory_risk_score;
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
    return (
        <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden flex flex-col">
            <div className="p-6 bg-slate-50 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 flex-wrap">
                <div className="flex items-start gap-4 min-w-0 flex-1 md:max-w-[60%]">
                    <div className="p-3 bg-blue-600 text-white rounded-xl shadow-sm mt-1 shrink-0">
                        <Bot size={28} />
                    </div>
                    <div className="flex flex-col gap-1.5 min-w-0">
                        <h2 className="text-2xl font-bold text-slate-800 tracking-tight break-words">{agent.name}</h2>
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
                    <div className="flex items-stretch justify-center md:justify-end gap-3 w-full">
                        {!isWorkflowRunning && (
                            <div className={`px-4 py-2 rounded-xl border shadow-sm text-xs font-semibold flex flex-col items-center min-w-[170px] ${riskCardClass}`}>
                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">Blended Score</span>
                                <span className={`inline-flex items-center gap-1 text-sm font-bold ${riskTextClass}`}>
                                    {riskLevel === 'low'
                                        ? <CheckCircle2 size={14} />
                                        : <ShieldAlert size={14} />}
                                    {riskScore ?? 'N/A'}
                                </span>
                            </div>
                        )}
                        <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm text-xs font-semibold text-slate-600 flex flex-col items-center min-w-[140px]">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">Provider</span>
                            {agent.provider?.url
                                ? <a href={agent.provider.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-blue-600 transition-colors">{agent.provider.organization || 'Tavro Internal'} <ExternalLink size={10} /></a>
                                : (agent.provider?.organization || 'Tavro Internal')}
                        </div>
                    </div>
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

