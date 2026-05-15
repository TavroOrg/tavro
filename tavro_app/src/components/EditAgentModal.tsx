import React, { useEffect, useState } from 'react';
import { X, Bot, Loader2, CheckCircle2 } from 'lucide-react';
import { AgentData } from '../types/agent';
import { agentApi } from '../services/agentApi';

interface EditAgentModalProps {
    agent: AgentData;
    open: boolean;
    onClose: () => void;
    onSaved: (updated: { name: string; description: string; instruction: string }) => void;
}

const EditAgentModal: React.FC<EditAgentModalProps> = ({ agent, open, onClose, onSaved }) => {
    const [name, setName] = useState(agent.name ?? '');
    const [description, setDescription] = useState(agent.description ?? '');
    const [instruction, setInstruction] = useState(agent.identification?.instruction ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (!open) return;
        setName(agent.name ?? '');
        setDescription(agent.description ?? '');
        setInstruction(agent.identification?.instruction ?? '');
        setError(null);
        setSaved(false);
    }, [agent, open]);

    if (!open) return null;

    const agentId = agent.identification?.agent_id ?? agent.name;

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        try {
            await agentApi.updateAgent(agentId, {
                agent_name: name.trim() || undefined,
                description: description.trim() || undefined,
                instruction: instruction.trim() || undefined,
            });
            const updated = {
                name: name.trim(),
                description: description.trim(),
                instruction: instruction.trim(),
            };
            setSaved(true);
            setTimeout(() => {
                setSaved(false);
                onSaved(updated);
                onClose();
            }, 300);
        } catch (err: any) {
            setError(err.message || 'Failed to update agent. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden border border-slate-200">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50">
                    <div className="flex items-center gap-2">
                        <Bot size={16} className="text-violet-500" />
                        <span className="font-bold text-slate-800 text-sm">Edit Agent</span>
                        <span className="text-xs text-slate-400 font-mono ml-1">{agentId}</span>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                        <X size={16} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 flex flex-col gap-4">
                    {error && (
                        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">{error}</div>
                    )}

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-slate-600 uppercase tracking-widest">Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 transition-all"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-slate-600 uppercase tracking-widest">Description</label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            rows={3}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 transition-all resize-none"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-slate-600 uppercase tracking-widest">Instruction / Role Prompt</label>
                        <textarea
                            value={instruction}
                            onChange={e => setInstruction(e.target.value)}
                            rows={4}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 transition-all resize-none"
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-100 bg-slate-50">
                    <button
                        onClick={onClose}
                        disabled={saving}
                        className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || saved}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-violet-600 text-white hover:bg-violet-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
                            : saved ? <><CheckCircle2 size={14} /> Saved</>
                                : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EditAgentModal;
