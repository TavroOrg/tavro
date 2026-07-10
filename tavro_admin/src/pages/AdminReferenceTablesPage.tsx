import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    Tags, Plus, Pencil, Trash2, X, Loader2, AlertCircle, ArrowUp, ArrowDown,
    ChevronDown, Check, Lock, Building2, AppWindow, Workflow, Plug, Cpu, Map,
    Zap, ClipboardList, Bot, FlaskConical, PencilRuler, Shield, Scale,
    ShieldCheck, AlertTriangle, Sparkles, Star, type LucideIcon,
} from 'lucide-react';
import { REFERENCE_FIELDS_CATALOG, findFieldLabels, type ReferenceSectionDef, type ReferenceFieldDef } from '../config/referenceFieldsCatalog';

// ── Types ──────────────────────────────────────────────────────────────────────

interface LookupOption {
    id: string | null;
    label: string;
    value: string;
    description: string | null;
    sequence: number;
    is_default: boolean;
    active: boolean;
    created_ts: string | null;
    updated_ts: string | null;
}

interface LookupGroup {
    table_name: string;
    column_name: string;
    tenant_id: string | null;
    company_id: string | null;
    options: LookupOption[];
}

interface OptionDraft {
    key: number;
    id: string | null;
    label: string;
    description: string;
    is_default: boolean;
    active: boolean;
}

const NAV_GROUP_STYLES: Record<string, { badge: string; text: string; gradient: string; accent: string }> = {
    Blueprint: { badge: 'bg-blue-50 dark:bg-blue-500/10',    text: 'text-blue-600 dark:text-blue-400',    gradient: 'from-blue-500 to-blue-600',    accent: 'bg-blue-500' },
    Plan:      { badge: 'bg-violet-50 dark:bg-violet-500/10', text: 'text-violet-600 dark:text-violet-400', gradient: 'from-violet-500 to-violet-600', accent: 'bg-violet-500' },
    Build:     { badge: 'bg-amber-50 dark:bg-amber-500/10',  text: 'text-amber-600 dark:text-amber-400',  gradient: 'from-amber-500 to-amber-600',  accent: 'bg-amber-500' },
    Govern:    { badge: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', gradient: 'from-emerald-500 to-emerald-600', accent: 'bg-emerald-500' },
};
const DEFAULT_GROUP_STYLE = { badge: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-500', gradient: 'from-slate-400 to-slate-500', accent: 'bg-slate-400' };

const SECTION_ICONS: Record<string, LucideIcon> = {
    'Company Profile':  Building2,
    'Applications':      AppWindow,
    'Processes':         Workflow,
    'Integrations':      Plug,
    'AI Models':         Cpu,
    'Roadmap':           Map,
    'Spark':             Zap,
    'AI Use Case':       ClipboardList,
    'Agents':            Bot,
    'Agent playground':  FlaskConical,
    'Agent evals':       PencilRuler,
    'Guardrails':        Shield,
    'Compliance':        Scale,
    'Audit center':      ShieldCheck,
    'Issues':            AlertTriangle,
};

function sectionIcon(label: string) {
    return SECTION_ICONS[label] ?? Tags;
}

function authHeaders(): Record<string, string> {
    const accessToken = localStorage.getItem('tavro_admin_access_token') ?? '';
    const companyId = localStorage.getItem('tavro_active_company_id') ?? '';
    const tenantId = (() => {
        const stored = localStorage.getItem('tavro_admin_tenant_id');
        if (stored) return stored;
        try {
            const idToken = localStorage.getItem('tavro_admin_id_token');
            if (!idToken) return '';
            const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            const ro = payload['urn:zitadel:iam:user:resourceowner'];
            if (ro && typeof ro === 'object' && ro.id) return String(ro.id);
            return payload['urn:zitadel:iam:user:resourceowner:id'] || payload['urn:zitadel:iam:org:id'] || payload['org_id'] || '';
        } catch { return ''; }
    })();
    return {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(tenantId    ? { 'x-tenant-id': tenantId }               : {}),
        ...(companyId   ? { 'x-company-id': companyId }             : {}),
    };
}

// ── Small building blocks ───────────────────────────────────────────────────────

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; title?: string }> = ({ checked, onChange, title }) => (
    <button
        type="button"
        title={title}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
            checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
        }`}
    >
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-1'
        }`} />
    </button>
);

// ── Section picker (grouped, custom dropdown) ───────────────────────────────────

const SectionPicker: React.FC<{
    sections: ReferenceSectionDef[];
    value: number | null;
    onChange: (idx: number) => void;
}> = ({ sections, value, onChange }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const selected = value !== null ? sections[value] : null;
    const groups = ['Blueprint', 'Plan', 'Build', 'Govern'] as const;

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-left transition-all focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
            >
                {selected ? (
                    <span className="flex items-center gap-2 min-w-0">
                        {React.createElement(sectionIcon(selected.sectionLabel), { size: 14, className: `shrink-0 ${NAV_GROUP_STYLES[selected.navGroup].text}` })}
                        <span className="font-semibold text-slate-800 dark:text-white truncate">{selected.sectionLabel}</span>
                        <span className="text-slate-400 dark:text-slate-500 text-xs shrink-0">{selected.navGroup}</span>
                    </span>
                ) : (
                    <span className="text-slate-400 dark:text-slate-500">Select a section…</span>
                )}
                <ChevronDown size={15} className={`text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div className="absolute z-50 mt-1 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden">
                    <ul className="max-h-72 overflow-y-auto py-1">
                        {groups.map(group => {
                            const items = sections
                                .map((s, i) => ({ ...s, idx: i }))
                                .filter(s => s.navGroup === group);
                            if (items.length === 0) return null;
                            return (
                                <li key={group}>
                                    <div className="px-4 pt-2.5 pb-1 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                                        {group}
                                    </div>
                                    {items.map(item => {
                                        const Icon = sectionIcon(item.sectionLabel);
                                        const isSelected = value === item.idx;
                                        return (
                                            <button
                                                key={item.sectionLabel}
                                                type="button"
                                                onClick={() => { onChange(item.idx); setOpen(false); }}
                                                className={`w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors ${
                                                    isSelected
                                                        ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400'
                                                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                                                }`}
                                            >
                                                <Icon size={14} className="shrink-0 text-slate-400" />
                                                <span className="flex-1 truncate">{item.sectionLabel}</span>
                                                {item.locked && <Lock size={11} className="text-slate-300 dark:text-slate-600 shrink-0" />}
                                                {isSelected && <Check size={14} className="text-blue-500 shrink-0" />}
                                            </button>
                                        );
                                    })}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </div>
    );
};

// ── Field picker (flat dropdown, wraps long labels instead of overflowing) ─────

const FieldPicker: React.FC<{
    fields: ReferenceFieldDef[];
    value: number | null;
    onChange: (idx: number) => void;
}> = ({ fields, value, onChange }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const selected = value !== null ? fields[value] : null;

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-left transition-all focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
            >
                <span className={`truncate ${selected ? 'font-semibold text-slate-800 dark:text-white' : 'text-slate-400 dark:text-slate-500'}`}>
                    {selected ? selected.fieldLabel : 'Select…'}
                </span>
                <ChevronDown size={15} className={`text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div className="absolute z-50 mt-1 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden">
                    <ul className="max-h-72 overflow-y-auto py-1">
                        {fields.map((f, i) => {
                            const isSelected = value === i;
                            return (
                                <li key={f.columnName}>
                                    <button
                                        type="button"
                                        onClick={() => { onChange(i); setOpen(false); }}
                                        className={`w-full flex items-start gap-2.5 px-4 py-2.5 text-left text-sm transition-colors ${
                                            isSelected
                                                ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400'
                                                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                                        }`}
                                    >
                                        <span className="flex-1 whitespace-normal break-words leading-snug">{f.fieldLabel}</span>
                                        {isSelected && <Check size={14} className="text-blue-500 shrink-0 mt-0.5" />}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </div>
    );
};

// ── Add / Edit modal ────────────────────────────────────────────────────────────

interface EditModalProps {
    group: LookupGroup | null;
    onClose: () => void;
    onSaved: () => void;
}

const EditModal: React.FC<EditModalProps> = ({ group, onClose, onSaved }) => {
    const isEditing = group !== null;
    const optionKeyRef = useRef(0);
    const nextKey = () => ++optionKeyRef.current;

    const [sectionIdx, setSectionIdx] = useState<number | null>(null);
    const [fieldIdx, setFieldIdx]     = useState<number | null>(null);
    const [options, setOptions]       = useState<OptionDraft[]>([]);
    const [saving, setSaving]         = useState(false);
    const [error, setError]           = useState<string | null>(null);

    useEffect(() => {
        if (group) {
            const sorted = [...group.options].sort((a, b) => a.sequence - b.sequence);
            setOptions(sorted.map(o => ({ key: nextKey(), id: o.id, label: o.label, description: o.description ?? '', is_default: o.is_default, active: o.active })));
        } else {
            setOptions([
                { key: nextKey(), id: null, label: '', description: '', is_default: true,  active: true },
                { key: nextKey(), id: null, label: '', description: '', is_default: false, active: true },
            ]);
            setSectionIdx(null);
            setFieldIdx(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [group]);

    const section = sectionIdx !== null ? REFERENCE_FIELDS_CATALOG[sectionIdx] : null;
    const field = section && fieldIdx !== null ? section.fields[fieldIdx] : null;
    const resolved = group ? findFieldLabels(group.table_name, group.column_name) : null;
    const Icon = resolved ? sectionIcon(resolved.sectionLabel) : (section ? sectionIcon(section.sectionLabel) : Tags);

    const updateOption = (key: number, patch: Partial<OptionDraft>) => {
        setOptions(prev => prev.map(o => o.key === key ? { ...o, ...patch } : o));
    };

    const setDefault = (key: number) => {
        setOptions(prev => prev.map(o => ({ ...o, is_default: o.key === key })));
    };

    const addOption = () => {
        setOptions(prev => [...prev, { key: nextKey(), id: null, label: '', description: '', is_default: prev.length === 0, active: true }]);
    };

    const removeOption = (key: number) => {
        setOptions(prev => {
            const next = prev.filter(o => o.key !== key);
            const removedWasDefault = prev.find(o => o.key === key)?.is_default;
            if (removedWasDefault && next.length > 0 && !next.some(o => o.is_default)) {
                next[0] = { ...next[0], is_default: true };
            }
            return next;
        });
    };

    const moveOption = (index: number, direction: -1 | 1) => {
        setOptions(prev => {
            const target = index + direction;
            if (target < 0 || target >= prev.length) return prev;
            const next = [...prev];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };

    const handleSave = async () => {
        setError(null);

        if (!isEditing && !field) {
            setError('Select a section and field.');
            return;
        }
        if (options.length < 2) {
            setError('Provide at least 2 options.');
            return;
        }
        const labels = options.map(o => o.label.trim());
        if (labels.some(l => !l)) {
            setError('Every option needs a label.');
            return;
        }
        if (new Set(labels).size !== labels.length) {
            setError('Option labels must be unique.');
            return;
        }
        if (options.filter(o => o.is_default).length !== 1) {
            setError('Pick exactly one default option.');
            return;
        }

        setSaving(true);
        try {
            const body = {
                table_name: isEditing ? group!.table_name : field!.tableName,
                column_name: isEditing ? group!.column_name : field!.columnName,
                options: options.map(({ id, label, description, is_default, active }) => ({
                    id, label: label.trim(), description: description.trim() || null, is_default, active,
                })),
            };
            const res = await fetch(
                isEditing ? `/api/v1/admin/lookups/${group!.table_name}/${group!.column_name}` : '/api/v1/admin/lookups',
                {
                    method: isEditing ? 'PUT' : 'POST',
                    headers: { 'Content-Type': 'application/json', ...authHeaders() },
                    body: JSON.stringify(body),
                },
            );
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error((data as { detail?: string }).detail ?? 'Save failed');
            }
            onSaved();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const fieldsForSection = section?.fields ?? [];

    const OPTION_GRID = 'grid grid-cols-[24px_120px_1fr_150px_24px] items-center gap-4';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl ring-1 ring-black/5 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-fade-in">
                <div className="px-8 py-6 border-b border-slate-100 dark:border-slate-800 flex items-center gap-4">
                    <div className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm ${resolved ? NAV_GROUP_STYLES[resolved.navGroup].badge : 'bg-blue-50 dark:bg-blue-500/10'}`}>
                        <Icon size={21} className={resolved ? NAV_GROUP_STYLES[resolved.navGroup].text : 'text-blue-600 dark:text-blue-400'} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="font-extrabold text-slate-800 dark:text-white leading-tight text-lg tracking-tight">
                            {isEditing ? 'Edit Reference Values' : 'New Reference Values'}
                        </p>
                        <p className="text-[13px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {resolved ? <>{resolved.sectionLabel} <span className="font-mono text-slate-400">· {group!.table_name}.{group!.column_name}</span></> : 'Define the choice list shown for a dropdown field in the portal'}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg p-2 shrink-0 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-8 flex flex-col gap-7 overflow-y-auto">
                    {!isEditing && (
                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col gap-2">
                                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Section</label>
                                <SectionPicker
                                    sections={REFERENCE_FIELDS_CATALOG}
                                    value={sectionIdx}
                                    onChange={idx => { setSectionIdx(idx); setFieldIdx(null); }}
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Field</label>
                                {!section ? (
                                    <div className="flex items-center h-[46px] px-4 text-sm text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                                        Choose a section first
                                    </div>
                                ) : fieldsForSection.length === 0 ? (
                                    <div className="flex items-center h-[46px] px-4 text-sm text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                                        No configurable fields yet
                                    </div>
                                ) : (
                                    <FieldPicker fields={fieldsForSection} value={fieldIdx} onChange={setFieldIdx} />
                                )}
                            </div>
                        </div>
                    )}

                    {/* Reference values editor */}
                    <div className="flex flex-col gap-3">
                        <div className="flex items-end justify-between">
                            <div>
                                <p className="text-sm font-extrabold text-slate-800 dark:text-white">
                                    Reference Values <span className="text-slate-400 dark:text-slate-500 font-semibold">({options.length})</span>
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5">Mark exactly one value as the default, and disable any you want to retire.</p>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                            <div className={`${OPTION_GRID} bg-slate-50 dark:bg-slate-800/60 px-4 py-2.5 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800`}>
                                <span />
                                <span>Default</span>
                                <span>Value</span>
                                <span>Status</span>
                                <span />
                            </div>

                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                {options.map((opt, index) => (
                                    <div
                                        key={opt.key}
                                        className={`${OPTION_GRID} px-4 py-3 transition-colors ${opt.active ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/60 dark:bg-slate-800/20'}`}
                                    >
                                        <div className="flex flex-col shrink-0 -my-1">
                                            <button
                                                type="button"
                                                title="Move up"
                                                onClick={() => moveOption(index, -1)}
                                                disabled={index === 0}
                                                className="text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 disabled:opacity-20 disabled:hover:text-slate-300 p-0.5"
                                            >
                                                <ArrowUp size={12} />
                                            </button>
                                            <button
                                                type="button"
                                                title="Move down"
                                                onClick={() => moveOption(index, 1)}
                                                disabled={index === options.length - 1}
                                                className="text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 disabled:opacity-20 disabled:hover:text-slate-300 p-0.5"
                                            >
                                                <ArrowDown size={12} />
                                            </button>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => setDefault(opt.key)}
                                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-bold w-fit transition-colors ${
                                                opt.is_default
                                                    ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-300 dark:border-amber-500/40 text-amber-700 dark:text-amber-400'
                                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 hover:border-amber-300 hover:text-amber-600'
                                            }`}
                                        >
                                            <Star size={12} fill={opt.is_default ? 'currentColor' : 'none'} />
                                            Default
                                        </button>

                                        <div className="flex flex-col min-w-0 gap-0.5">
                                            <input
                                                className="min-w-0 bg-transparent border-0 border-b-2 border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus:border-blue-500 outline-none text-[15px] font-bold text-slate-800 dark:text-white placeholder-slate-300 placeholder:font-medium py-1 transition-colors"
                                                placeholder="e.g. High"
                                                value={opt.label}
                                                onChange={e => updateOption(opt.key, { label: e.target.value })}
                                            />
                                            <input
                                                className="min-w-0 bg-transparent border-0 outline-none text-xs text-slate-400 dark:text-slate-500 placeholder-slate-300 dark:placeholder-slate-600 focus:text-slate-600 dark:focus:text-slate-300 transition-colors"
                                                placeholder="Add a description (optional)"
                                                value={opt.description}
                                                onChange={e => updateOption(opt.key, { description: e.target.value })}
                                            />
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            <Toggle checked={opt.active} onChange={v => updateOption(opt.key, { active: v })} title={opt.active ? 'Enabled — click to disable' : 'Disabled — click to enable'} />
                                            <span className={`text-xs font-bold w-14 ${opt.active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-600'}`}>
                                                {opt.active ? 'Enabled' : 'Disabled'}
                                            </span>
                                        </div>

                                        <button
                                            type="button"
                                            title="Remove value"
                                            onClick={() => removeOption(opt.key)}
                                            disabled={options.length <= 2}
                                            className="shrink-0 text-slate-300 dark:text-slate-600 hover:text-red-500 disabled:opacity-20 disabled:hover:text-slate-300 transition-colors"
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={addOption}
                            className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 py-3 text-sm font-bold text-slate-500 dark:text-slate-400 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 dark:hover:border-blue-500/40 dark:hover:text-blue-400 transition-colors"
                        >
                            <Plus size={15} /> Add Reference Value
                        </button>
                    </div>

                    {error && (
                        <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl px-3 py-2">
                            <AlertCircle size={13} className="shrink-0" /> {error}
                        </p>
                    )}
                </div>

                <div className="px-8 py-5 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2.5 bg-slate-50/60 dark:bg-slate-950/40">
                    <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors">
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl font-bold text-sm text-white bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-500/25 disabled:opacity-60 transition-all"
                    >
                        {saving ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : 'Save Reference'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ── Main page ──────────────────────────────────────────────────────────────────

const AdminReferenceTablesPage: React.FC = () => {
    const [groups, setGroups]     = useState<LookupGroup[]>([]);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState<string | null>(null);
    const [modalGroup, setModalGroup] = useState<LookupGroup | null | undefined>(undefined);
    const [deletingKey, setDeletingKey] = useState<string | null>(null);

    const load = useCallback(() => {
        setLoading(true);
        setError(null);
        fetch('/api/v1/admin/lookups', { headers: authHeaders() })
            .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
            .then((data: LookupGroup[]) => setGroups(data))
            .catch(e => setError(String(e)))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleDelete = async (grp: LookupGroup) => {
        const key = `${grp.table_name}.${grp.column_name}`;
        setDeletingKey(key);
        try {
            const res = await fetch(`/api/v1/admin/lookups/${grp.table_name}/${grp.column_name}`, { method: 'DELETE', headers: authHeaders() });
            if (!res.ok) throw new Error('Delete failed');
            setGroups(prev => prev.filter(g => `${g.table_name}.${g.column_name}` !== key));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Delete failed');
        } finally {
            setDeletingKey(null);
        }
    };

    return (
        <div className="overflow-auto flex-1 p-6">
            <div className="space-y-6 animate-fade-in max-w-5xl mx-auto">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3.5">
                        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-md shadow-blue-500/25">
                            <Tags size={20} className="text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800 dark:text-white tracking-tight">Reference Tables</h1>
                            <p className="text-slate-500 dark:text-slate-500 text-sm mt-0.5">
                                Configure custom choice values for dropdown fields across the portal.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => setModalGroup(null)}
                        className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-bold text-xs text-white bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-500/25 shrink-0 transition-all"
                    >
                        <Plus size={14} /> New Reference
                    </button>
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-slate-400 py-16 justify-center">
                        <Loader2 size={16} className="animate-spin" /> Loading…
                    </div>
                ) : error ? (
                    <div className="flex items-center gap-2 p-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-sm text-red-600 dark:text-red-400">
                        <AlertCircle size={14} className="shrink-0" /> {error}
                    </div>
                ) : groups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl">
                        <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-500/10 dark:to-indigo-500/10 flex items-center justify-center">
                            <Sparkles size={22} className="text-blue-500" />
                        </div>
                        <div>
                            <p className="font-bold text-slate-700 dark:text-slate-200 text-base">No custom references yet</p>
                            <p className="text-sm text-slate-400 max-w-sm mt-1.5">
                                Override the default choices shown for a dropdown field — pick a section, pick a field, and define your own list.
                            </p>
                        </div>
                        <button
                            onClick={() => setModalGroup(null)}
                            className="flex items-center gap-1.5 mt-2 px-4 py-2.5 rounded-xl font-bold text-xs text-white bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-500/25 transition-all"
                        >
                            <Plus size={14} /> New Reference
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {groups.map(grp => {
                            const resolved = findFieldLabels(grp.table_name, grp.column_name);
                            const sorted = [...grp.options].sort((a, b) => a.sequence - b.sequence);
                            const defaultOpt = sorted.find(o => o.is_default);
                            const activeCount = sorted.filter(o => o.active).length;
                            const Icon = resolved ? sectionIcon(resolved.sectionLabel) : Tags;
                            const groupKey = `${grp.table_name}.${grp.column_name}`;
                            const styles = resolved ? NAV_GROUP_STYLES[resolved.navGroup] : DEFAULT_GROUP_STYLE;

                            return (
                                <div
                                    key={groupKey}
                                    className="group relative min-w-0 overflow-hidden bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-4 pl-5 shadow-sm hover:shadow-lg hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-200"
                                >
                                    <span className={`absolute left-0 top-0 bottom-0 w-1 ${styles.accent}`} />

                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-start gap-3 min-w-0">
                                            <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br ${styles.gradient} shadow-sm`}>
                                                <Icon size={17} className="text-white" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider truncate">
                                                    {resolved ? `${resolved.navGroup} · ${resolved.sectionLabel}` : grp.table_name}
                                                </p>
                                                <p className="font-bold text-slate-800 dark:text-white text-[15px] leading-snug break-words line-clamp-2" title={resolved ? resolved.fieldLabel : grp.column_name}>
                                                    {resolved ? resolved.fieldLabel : grp.column_name}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                            <button onClick={() => setModalGroup(grp)} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors" title="Edit">
                                                <Pencil size={14} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(grp)}
                                                disabled={deletingKey === groupKey}
                                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-40 transition-colors"
                                                title="Delete"
                                            >
                                                {deletingKey === groupKey ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap gap-1.5 mt-4">
                                        {sorted.map(o => (
                                            <span
                                                key={o.id ?? o.label}
                                                title={o.description ?? undefined}
                                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                                                    !o.active
                                                        ? 'border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-600 line-through'
                                                        : o.is_default
                                                            ? 'border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400'
                                                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60'
                                                }`}
                                            >
                                                {o.is_default && o.active && <Star size={9} fill="currentColor" />}
                                                {o.label}
                                            </span>
                                        ))}
                                    </div>

                                    <div className="flex items-center justify-between mt-3.5 pt-3 border-t border-slate-100 dark:border-slate-800/60 text-[11px] text-slate-400">
                                        <span className="font-mono">{grp.table_name}.{grp.column_name}</span>
                                        <span>{activeCount}/{sorted.length} active{defaultOpt ? ` · default: ${defaultOpt.label}` : ''}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {modalGroup !== undefined && (
                <EditModal
                    group={modalGroup}
                    onClose={() => setModalGroup(undefined)}
                    onSaved={() => { setModalGroup(undefined); load(); }}
                />
            )}
        </div>
    );
};

export default AdminReferenceTablesPage;
