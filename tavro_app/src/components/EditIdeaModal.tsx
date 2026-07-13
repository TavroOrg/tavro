import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toUserMessage } from '../utils/errorUtils';
import { X, Lightbulb, Loader2, CheckCircle2, Check } from 'lucide-react';
import type { SparkIdea } from '../types/spark';
import { SIGNAL_META, SPARK_DIMENSIONS } from '../types/spark';
import { sparkApi } from '../services/sparkApi';

const COMPLEXITY_OPTIONS = ['Low', 'Medium', 'High'];
const IMPACT_OPTIONS = ['Low', 'Medium', 'High'];
const SIGNAL_OPTIONS = Object.entries(SIGNAL_META).map(([key, meta]) => ({ key, label: meta.label }));

function autoResize(el: HTMLTextAreaElement | null): void {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
}

const AutoResizeTextarea: React.FC<{
    value: string;
    onChange: (value: string) => void;
}> = ({ value, onChange }) => {
    const ref = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
        autoResize(ref.current);
    }, [value]);

    return (
        <textarea
            ref={ref}
            value={value}
            onChange={e => onChange(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 transition-all resize-none overflow-hidden"
        />
    );
};

interface EditIdeaModalProps {
    idea: SparkIdea;
    companyId: string;
    open: boolean;
    onClose: () => void;
    onSaved: (updated: SparkIdea) => void;
}

const EditIdeaModal: React.FC<EditIdeaModalProps> = ({ idea, companyId, open, onClose, onSaved }) => {
    const [title, setTitle] = useState(idea.title);
    const [description, setDescription] = useState(idea.description);
    const [rationale, setRationale] = useState(idea.rationale);
    const [complexity, setComplexity] = useState(idea.complexity);
    const [estimatedImpact, setEstimatedImpact] = useState(idea.estimated_impact);
    const [signalType, setSignalType] = useState(idea.signal_type);
    const [signalLabel, setSignalLabel] = useState(idea.signal_label);
    const [targetDimensions, setTargetDimensions] = useState<string[]>(idea.target_dimensions);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (!open) return;
        setTitle(idea.title);
        setDescription(idea.description);
        setRationale(idea.rationale);
        setComplexity(idea.complexity);
        setEstimatedImpact(idea.estimated_impact);
        setSignalType(idea.signal_type);
        setSignalLabel(idea.signal_label);
        setTargetDimensions(idea.target_dimensions);
        setError(null);
        setSaved(false);
    }, [open, idea]);

    if (!open) return null;

    const toggleDimension = (key: string) => {
        setTargetDimensions(prev => prev.includes(key) ? prev.filter(d => d !== key) : [...prev, key]);
    };

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        try {
            const patch: Partial<Pick<SparkIdea, 'title' | 'description' | 'rationale' | 'complexity' | 'estimated_impact' | 'signal_type' | 'signal_label' | 'target_dimensions'>> = {};
            const nextTitle = title.trim();
            const nextDescription = description.trim();
            const nextRationale = rationale.trim();
            if (nextTitle !== idea.title) patch.title = nextTitle;
            if (nextDescription !== idea.description) patch.description = nextDescription;
            if (nextRationale !== idea.rationale) patch.rationale = nextRationale;
            if (complexity !== idea.complexity) patch.complexity = complexity;
            if (estimatedImpact !== idea.estimated_impact) patch.estimated_impact = estimatedImpact;
            if (signalType !== idea.signal_type) patch.signal_type = signalType;
            if (signalLabel !== idea.signal_label) patch.signal_label = signalLabel;
            if (JSON.stringify(targetDimensions) !== JSON.stringify(idea.target_dimensions)) patch.target_dimensions = targetDimensions;

            const updated = Object.keys(patch).length > 0
                ? await sparkApi.updateIdea(companyId, idea.idea_id, patch)
                : idea;

            setSaved(true);
            setTimeout(() => {
                setSaved(false);
                onSaved(updated);
                onClose();
            }, 300);
        } catch (err) {
            setError(toUserMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800 max-h-[92vh]">
                <div className="h-1.5 bg-gradient-to-r from-violet-500 to-indigo-500 flex-shrink-0" />

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 flex-shrink-0">
                    <div className="flex items-center gap-2">
                        <Lightbulb size={16} className="text-violet-600" />
                        <span className="font-bold text-slate-800 dark:text-slate-100 text-sm">Edit Idea</span>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                        <X size={16} />
                    </button>
                </div>

                {/* Scrollable Body */}
                <div className="p-5 flex flex-col gap-4 overflow-y-auto">
                    {error && (
                        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">{error}</div>
                    )}

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">Title</label>
                        <input
                            type="text"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 transition-all"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">Description</label>
                        <AutoResizeTextarea value={description} onChange={setDescription} />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">Why this matters</label>
                        <AutoResizeTextarea value={rationale} onChange={setRationale} />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">Complexity</label>
                            <select
                                value={complexity}
                                onChange={e => setComplexity(e.target.value as SparkIdea['complexity'])}
                                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 transition-all bg-white dark:bg-slate-800"
                            >
                                {COMPLEXITY_OPTIONS.map(o => (
                                    <option key={o} value={o}>{o}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">Est. Impact</label>
                            <select
                                value={estimatedImpact}
                                onChange={e => setEstimatedImpact(e.target.value as SparkIdea['estimated_impact'])}
                                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 transition-all bg-white dark:bg-slate-800"
                            >
                                {IMPACT_OPTIONS.map(o => (
                                    <option key={o} value={o}>{o}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">Signal</label>
                        <select
                            value={signalType}
                            onChange={e => {
                                const nextKey = e.target.value as SparkIdea['signal_type'];
                                setSignalType(nextKey);
                                setSignalLabel(SIGNAL_META[nextKey]?.label ?? signalLabel);
                            }}
                            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 transition-all bg-white dark:bg-slate-800"
                        >
                            {SIGNAL_OPTIONS.map(o => (
                                <option key={o.key} value={o.key}>{o.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">Dimensions</label>
                        <div className="flex flex-wrap gap-2">
                            {SPARK_DIMENSIONS.map(({ key, label }) => {
                                const active = targetDimensions.includes(key);
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={() => toggleDimension(key)}
                                        className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${active
                                            ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-violet-400 hover:text-violet-600 dark:hover:text-violet-400'
                                            }`}
                                    >
                                        {active && <Check size={12} />}
                                        {label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 flex-shrink-0">
                    <button
                        onClick={onClose}
                        disabled={saving}
                        className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || saved || !title.trim()}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-violet-600 text-white hover:bg-violet-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
                            : saved ? <><CheckCircle2 size={14} /> Saved</>
                                : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default EditIdeaModal;
