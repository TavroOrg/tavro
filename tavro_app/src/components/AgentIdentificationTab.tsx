import React, { useState } from 'react';
import { AgentData } from '../types/agent';
import { User, Tag, ChevronDown, ChevronUp } from 'lucide-react';

interface AgentIdentificationTabProps { agent: AgentData; }

export const AgentIdentificationTab: React.FC<AgentIdentificationTabProps> = ({ agent }) => {
    const [instrOpen, setInstrOpen] = useState(false);
    const id = agent.identification;

    return (
        <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden p-6 flex flex-col gap-6 w-full mt-4">
            <div>
                <h3 className="text-sm font-bold text-slate-800 tracking-tight flex items-center gap-2 mb-4">
                    <User size={16} className="text-blue-500" />
                    Identification & Role
                </h3>

                <p className="text-sm text-slate-600 leading-relaxed border-l-2 border-blue-200 pl-4 py-1 mb-4">
                    {agent.description}
                </p>

                {/* Owner + Tags */}
                {(id?.owner || id?.tags) && (
                    <div className="flex flex-wrap gap-2 mb-4">
                        {id?.owner && (
                            <span className="flex items-center gap-1.5 text-xs bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full font-medium text-slate-600">
                                <User size={10} /> {id.owner}
                            </span>
                        )}
                        {id?.tags && String(id.tags).split(',').map(t => t.trim()).filter(Boolean).map(t => (
                            <span key={t} className="flex items-center gap-1 text-xs bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full font-medium text-indigo-600">
                                <Tag size={10} /> {t}
                            </span>
                        ))}
                    </div>
                )}

                {/* Role + Goal Orientation */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-inner flex flex-col gap-4">
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Assigned Role</span>
                        <span className="text-sm font-medium text-slate-800">{id?.role || '—'}</span>
                    </div>
                    {id?.goal_orientation && (
                        <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Goal Orientation</span>
                            <span className="text-sm font-medium text-slate-800">{id.goal_orientation}</span>
                        </div>
                    )}
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">System Instruction</span>
                            <button onClick={() => setInstrOpen(o => !o)}
                                className="text-[10px] font-semibold text-blue-500 hover:text-blue-700 flex items-center gap-1">
                                {instrOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />} {instrOpen ? 'Collapse' : 'Expand'}
                            </button>
                        </div>
                        <div className={`overflow-hidden transition-all duration-300 ease-in-out ${instrOpen ? 'max-h-[2500px]' : 'max-h-32'} overflow-y-auto pr-1`}>
                            <pre className="text-xs font-mono text-slate-600 whitespace-pre-wrap leading-relaxed">
                                {id?.instruction || '—'}
                            </pre>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AgentIdentificationTab;
