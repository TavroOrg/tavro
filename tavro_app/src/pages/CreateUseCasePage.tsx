import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { mcpClient } from '../services/mcpClient';
import { Lightbulb, Loader2, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';
import { useUseCases } from '../context/UseCaseContext';

const PRIORITIES = [
    '1 - Critical',
    '2 - High',
    '3 - Moderate',
    '4 - Low',
    '5 - Planning',
];
const STATUSES = ['Proposed', 'In Review', 'Active', 'Deprecated'];

const CreateUseCasePage: React.FC = () => {
    const navigate = useNavigate();
    const { refresh } = useUseCases();

    const [form, setForm] = useState({
        name: '',
        description: '',
        proposed_by: '',
        owner: '',
        function: '',
        problem_statement: '',
        expected_benefits: '',
        priority: '3 - Moderate',
        status: 'Proposed',
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const set = (field: string, value: string) =>
        setForm(prev => ({ ...prev, [field]: value }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim()) return;
        setSaving(true);
        setError(null);
        // Ensure live mode before write call so connect() establishes a real MCP session.
        localStorage.setItem('tavro_cache_mode', 'false');
        window.dispatchEvent(new Event('tavro_settings_change'));
        try {
            await mcpClient.createAiUseCase({
                title: form.name.trim(),
                description: form.description.trim(),
                business_problem_statement: form.problem_statement.trim(),
                expected_benefits: form.expected_benefits.trim(),
                priority: form.priority,
                ...(form.owner.trim() && { use_case_owner: form.owner.trim() }),
            });
            setSuccess(true);
            sessionStorage.setItem(
                'tavro_use_case_notice',
                'AI Use Case created successfully. It will appear in the catalog shortly.'
            );
            refresh();
            setTimeout(() => navigate('/use-cases'), 1200);
        } catch (err: any) {
            setError(err.message || 'Failed to create use case. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    const inputCls = 'w-full text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-blue-400/30 dark:focus:ring-blue-700/40 focus:border-blue-400 dark:focus:border-blue-500 transition-all bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500';
    const selectCls = 'w-full text-sm border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-blue-400/30 dark:focus:ring-blue-700/40 focus:border-blue-400 dark:focus:border-blue-500 transition-all bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100';
    const labelCls = 'block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5';

    return (
        <div className="flex flex-col gap-6 w-full animate-fade-in max-w-3xl mx-auto pb-12">

            {/* Top bar */}
            <div className="flex items-center justify-between">
                <button
                    onClick={() => navigate('/use-cases')}
                    className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 transition-all bg-transparent border-none cursor-pointer"
                >
                    <ArrowLeft size={16} /> Back to Use Cases
                </button>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm overflow-hidden border border-slate-200 dark:border-slate-800">
                {/* Header */}
                <div className="flex items-center gap-3 px-8 py-6 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-blue-50 to-white dark:from-slate-900 dark:to-slate-800">
                    <div className="p-2.5 bg-blue-100 text-blue-600 rounded-xl">
                        <Lightbulb size={24} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">Create AI Use Case</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Register a new AI use case in the Agent Biz Ops catalog</p>
                    </div>
                </div>

                {/* Form body */}
                <form onSubmit={handleSubmit} className="flex flex-col">
                    <div className="p-8 flex flex-col gap-6">

                        {/* Name — required */}
                        <div>
                            <label className={labelCls}>Use Case Name <span className="text-red-500">*</span></label>
                            <input
                                type="text"
                                required
                                value={form.name}
                                onChange={e => set('name', e.target.value)}
                                placeholder="e.g. Invoice Processing Automation"
                                className={inputCls}
                            />
                        </div>

                        {/* Description */}
                        <div>
                            <label className={labelCls}>Description <span className="text-red-500">*</span></label>
                            <textarea
                                rows={3}
                                required
                                value={form.description}
                                onChange={e => set('description', e.target.value)}
                                placeholder="Brief overview of what this AI use case does…"
                                className={`${inputCls} resize-none`}
                            />
                        </div>

                        {/* Two-column: owner + proposed_by */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className={labelCls}>Owner</label>
                                <input type="text" value={form.owner} onChange={e => set('owner', e.target.value)}
                                    placeholder="Team or person responsible" className={inputCls} />
                            </div>
                            <div>
                                <label className={labelCls}>Proposed By</label>
                                <input type="text" value={form.proposed_by} onChange={e => set('proposed_by', e.target.value)}
                                    placeholder="Originator of the idea" className={inputCls} />
                            </div>
                        </div>

                        {/* Two-column: function + priority */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className={labelCls}>Business Function</label>
                                <input type="text" value={form.function} onChange={e => set('function', e.target.value)}
                                    placeholder="e.g. Finance, Operations, HR" className={inputCls} />
                            </div>
                            <div>
                                <label className={labelCls}>Priority</label>
                                <select value={form.priority} onChange={e => set('priority', e.target.value)} className={selectCls}>
                                    {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                                </select>
                            </div>
                        </div>

                        {/* Status */}
                        <div>
                            <label className={labelCls}>Status</label>
                            <div className="flex gap-3 flex-wrap">
                                {STATUSES.map(s => (
                                    <button
                                        key={s}
                                        type="button"
                                        onClick={() => set('status', s)}
                                        className={`px-5 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${form.status === s
                                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                                            }`}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Problem Statement */}
                        <div>
                            <label className={labelCls}>Problem Statement</label>
                            <textarea
                                rows={3}
                                value={form.problem_statement}
                                onChange={e => set('problem_statement', e.target.value)}
                                placeholder="What problem does this use case solve?"
                                className={`${inputCls} resize-none`}
                            />
                        </div>

                        {/* Expected Benefits */}
                        <div>
                            <label className={labelCls}>Expected Benefits</label>
                            <textarea
                                rows={3}
                                value={form.expected_benefits}
                                onChange={e => set('expected_benefits', e.target.value)}
                                placeholder="What outcomes and improvements are expected?"
                                className={`${inputCls} resize-none`}
                            />
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
                                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between px-8 py-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                        <button type="button" onClick={() => navigate('/use-cases')}
                            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all">
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving || !form.name.trim() || !form.description.trim() || success}
                            className={`flex items-center gap-2 px-8 py-2.5 rounded-xl text-sm font-bold text-white transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${success ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-blue-600 hover:bg-blue-700'
                                }`}
                        >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : success ? <CheckCircle2 size={16} /> : <Lightbulb size={16} />}
                            {saving ? 'Creating…' : success ? 'Created!' : 'Create Use Case'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateUseCasePage;



