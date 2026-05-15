import React from 'react';
import { AgentData } from '../types/agent';
import { BrainCircuit, ExternalLink, Globe, BookOpen, ShieldAlert, CheckCircle2 } from 'lucide-react';
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

    return (
        <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden flex flex-col">
            <div className="p-6 bg-slate-50 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 flex-wrap">
                <div className="flex items-start gap-4 min-w-0 flex-1 md:max-w-[40%]">
                    <div className="p-3 bg-blue-600 text-white rounded-xl shadow-sm mt-1 shrink-0">
                        <BrainCircuit size={28} />
                    </div>
                    <div className="flex flex-col gap-1.5 min-w-0">
                        <h2 className="text-2xl font-bold text-slate-800 tracking-tight truncate">{agent.name}</h2>
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-600 truncate max-w-[150px] sm:max-w-xs">
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

                <div className="flex flex-wrap items-center justify-center gap-3 shrink-0 w-full md:w-auto mt-2 md:mt-0">
                    <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[90px]">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">Status</span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-1.5"></div>
                            Active
                        </span>
                    </div>
                    <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[90px]">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">Version</span>
                        <span className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
                            <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                            v{agent.version || '1.0'}
                        </span>
                    </div>
                    <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center min-w-[90px]">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">Risk</span>
                        <span className={`inline-flex items-center gap-1 text-xs font-bold ${riskLevel === 'prohibited' || riskLevel === 'high' ? 'text-red-600' : riskLevel === 'medium' ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {riskLevel === 'prohibited'
                                ? <><ShieldAlert size={14} /> Prohibited</>
                                : riskLevel === 'high'
                                    ? <><ShieldAlert size={14} /> High</>
                                    : riskLevel === 'medium'
                                        ? <><ShieldAlert size={14} /> Medium</>
                                        : <><CheckCircle2 size={14} /> Low</>}
                        </span>
                    </div>
                </div>

                <div className="flex flex-col items-end gap-3 shrink-0 flex-1 md:max-w-[30%] mt-2 md:mt-0">
                    <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm text-xs font-semibold text-slate-600 flex flex-col items-end min-w-[140px]">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">Provider</span>
                        {agent.provider?.url
                            ? <a href={agent.provider.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-blue-600 transition-colors">{agent.provider.organization || 'Tavro Internal'} <ExternalLink size={10} /></a>
                            : (agent.provider?.organization || 'Tavro Internal')}
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

