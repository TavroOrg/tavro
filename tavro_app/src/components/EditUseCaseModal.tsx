import React, { useEffect, useState } from 'react';
import { X, ClipboardList, Loader2, CheckCircle2 } from 'lucide-react';
import { UseCaseDetail } from '../types/useCase';
import { useCaseApi } from '../services/useCaseApi';

const PRIORITY_OPTIONS = ['1 - Critical', '2 - High', '3 - Moderate', '4 - Low', '5 - Planning'];

interface EditUseCaseModalProps {
    useCase: UseCaseDetail;
    open: boolean;
    onClose: () => void;
    onSaved: (updated: {
        title: string;
        description: string;
        problemStatement: string;
        expectedBenefits: string;
        priority: string;
        solutionApproach: string;
        owner: string;
    }) => void;
}

const EditUseCaseModal: React.FC<EditUseCaseModalProps> = ({ useCase, open, onClose, onSaved }) => {
    const uc = useCase as any;
    const [title, setTitle] = useState(uc.name ?? uc.title ?? '');
    const [description, setDescription] = useState(uc.description ?? '');
    const [problemStatement, setProblemStatement] = useState(uc.problem_statement ?? uc.business_problem_statement ?? '');
    const [expectedBenefits, setExpectedBenefits] = useState(uc.expected_benefits ?? '');
    const [priority, setPriority] = useState(uc.priority ?? '3 - Moderate');
    const [solutionApproach, setSolutionApproach] = useState(uc.solution_approach ?? '');
    const [owner, setOwner] = useState(uc.owner ?? uc.use_case_owner ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (!open) return;
        setTitle(uc.name ?? uc.title ?? '');
        setDescription(uc.description ?? '');
        setProblemStatement(uc.problem_statement ?? uc.business_problem_statement ?? '');
        setExpectedBenefits(uc.expected_benefits ?? '');
        setPriority(uc.priority ?? '3 - Moderate');
        setSolutionApproach(uc.solution_approach ?? '');
        setOwner(uc.owner ?? uc.use_case_owner ?? '');
        setError(null);
        setSaved(false);
    }, [open, uc]);

    if (!open) return null;

    const useCaseId = useCase.identifier ?? (uc.id ?? '');

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        try {
            const payload: any = {
                __activityName: uc.name ?? uc.title ?? useCaseId,
            };
            const currentTitle = String(uc.name ?? uc.title ?? '').trim();
            const currentDescription = String(uc.description ?? '').trim();
            const currentProblemStatement = String(uc.problem_statement ?? uc.business_problem_statement ?? '').trim();
            const currentExpectedBenefits = String(uc.expected_benefits ?? '').trim();
            const currentPriority = String(uc.priority ?? '3 - Moderate');
            const currentSolutionApproach = String(uc.solution_approach ?? '').trim();
            const currentOwner = String(uc.owner ?? uc.use_case_owner ?? '').trim();

            const nextTitle = title.trim();
            const nextDescription = description.trim();
            const nextProblemStatement = problemStatement.trim();
            const nextExpectedBenefits = expectedBenefits.trim();
            const nextSolutionApproach = solutionApproach.trim();
            const nextOwner = owner.trim();

            if (nextTitle !== currentTitle) payload.title = nextTitle || undefined;
            if (nextDescription !== currentDescription) payload.description = nextDescription || undefined;
            if (nextProblemStatement !== currentProblemStatement) payload.business_problem_statement = nextProblemStatement || undefined;
            if (nextExpectedBenefits !== currentExpectedBenefits) payload.expected_benefits = nextExpectedBenefits || undefined;
            if (priority !== currentPriority) payload.priority = priority || undefined;
            if (nextSolutionApproach !== currentSolutionApproach) payload.solution_approach = nextSolutionApproach || undefined;
            if (nextOwner !== currentOwner) payload.use_case_owner = nextOwner || undefined;

            if (Object.keys(payload).length > 1) {
                await useCaseApi.updateUseCase(useCaseId, payload);
            }
            const updated = {
                title: title.trim(),
                description: description.trim(),
                problemStatement: problemStatement.trim(),
                expectedBenefits: expectedBenefits.trim(),
                priority,
                solutionApproach: solutionApproach.trim(),
                owner: owner.trim(),
            };
            setSaved(true);
            setTimeout(() => {
                setSaved(false);
                onSaved(updated);
                onClose();
            }, 300);
        } catch (err: any) {
            setError(err.message || 'Failed to update use case. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col overflow-hidden border border-slate-200 max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50 flex-shrink-0">
                    <div className="flex items-center gap-2">
                        <ClipboardList size={16} className="text-blue-600" />
                        <span className="font-bold text-slate-800 text-sm">Edit AI Use Case</span>
                        <span className="text-xs text-slate-400 font-mono ml-1">{useCaseId}</span>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                        <X size={16} />
                    </button>
                </div>

                {/* Scrollable Body */}
                <div className="p-5 flex flex-col gap-4 overflow-y-auto">
                    {error && (
                        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">{error}</div>
                    )}

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-slate-600 uppercase tracking-widest">Title</label>
                        <input
                            type="text"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 transition-all"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-slate-600 uppercase tracking-widest">Description</label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            rows={3}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 transition-all resize-none"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-bold text-slate-600 uppercase tracking-widest">Priority</label>
                            <select
                                value={priority}
                                onChange={e => setPriority(e.target.value)}
                                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 transition-all bg-white"
                            >
                                {PRIORITY_OPTIONS.map(p => (
                                    <option key={p} value={p}>{p}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-bold text-slate-600 uppercase tracking-widest">Owner</label>
                            <input
                                type="text"
                                value={owner}
                                onChange={e => setOwner(e.target.value)}
                                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 transition-all"
                            />
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-slate-600 uppercase tracking-widest">Business Problem Statement</label>
                        <textarea
                            value={problemStatement}
                            onChange={e => setProblemStatement(e.target.value)}
                            rows={3}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 transition-all resize-none"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-slate-600 uppercase tracking-widest">Expected Benefits</label>
                        <textarea
                            value={expectedBenefits}
                            onChange={e => setExpectedBenefits(e.target.value)}
                            rows={3}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 transition-all resize-none"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-slate-600 uppercase tracking-widest">Solution Approach</label>
                        <textarea
                            value={solutionApproach}
                            onChange={e => setSolutionApproach(e.target.value)}
                            rows={3}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 transition-all resize-none"
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-100 bg-slate-50 flex-shrink-0">
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
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
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

export default EditUseCaseModal;
