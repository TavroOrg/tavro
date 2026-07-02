import React, { useState, useEffect, useRef } from 'react';
import { Building2, CheckCircle2, Search, ChevronDown, AlertCircle, Loader2 } from 'lucide-react';


interface Company {
    id:           string;
    name:         string;
    industry:     string;
    region:       string;
    legal_entity: string | null;
}

const STORAGE_ID_KEY   = 'tavro_active_company_id';
const STORAGE_NAME_KEY = 'tavro_active_company_name';

const AdminCompanyPage: React.FC = () => {
    const [companies, setCompanies]     = useState<Company[]>([]);
    const [loading, setLoading]         = useState(true);
    const [error, setError]             = useState<string | null>(null);
    const [search, setSearch]           = useState('');
    const [open, setOpen]               = useState(false);
    const [selected, setSelected]       = useState<Company | null>(null);
    const dropdownRef                   = useRef<HTMLDivElement>(null);

    // Load companies (scoped to the caller's own tenant)
    useEffect(() => {
        const accessToken = localStorage.getItem('tavro_admin_access_token') ?? '';
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

        fetch('/api/v1/admin/companies', {
            headers: {
                ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
                ...(tenantId    ? { 'x-tenant-id': tenantId }               : {}),
            },
        })
            .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
            .then((data: Company[]) => {
                setCompanies(data);
                // Restore previously selected company
                const savedId = localStorage.getItem(STORAGE_ID_KEY);
                if (savedId) {
                    const match = data.find(c => c.id === savedId);
                    if (match) setSelected(match);
                }
            })
            .catch(e => setError(String(e)))
            .finally(() => setLoading(false));
    }, []);

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const filtered = companies.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.industry.toLowerCase().includes(search.toLowerCase()) ||
        c.region.toLowerCase().includes(search.toLowerCase())
    );

    const handleSelect = (company: Company) => {
        setSelected(company);
        setOpen(false);
        setSearch('');
        // Persist using same keys as the main portal
        localStorage.setItem(STORAGE_ID_KEY,   company.id);
        localStorage.setItem(STORAGE_NAME_KEY, company.name);
        // Notify AdminLayout footer to update
        window.dispatchEvent(new CustomEvent('tavro_company_changed', { detail: company }));
    };

    return (
        <div className="flex gap-6 h-full animate-fade-in p-6 overflow-hidden">

            {/* ── Full width: selector panel ───────────────────────────────── */}
            <div className="flex-1 min-w-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 flex flex-col gap-6 overflow-y-auto">

                <div>
                    <h2 className="text-xl font-bold text-slate-800 dark:text-white">Select Active Company</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        The selected company applies across the entire admin portal — connectors, imports, and all extracted data will be scoped to it.
                    </p>
                </div>

                {loading && (
                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-sm">
                        <Loader2 size={15} className="animate-spin" /> Loading companies…
                    </div>
                )}

                {error && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-sm text-red-600 dark:text-red-400">
                        <AlertCircle size={14} className="shrink-0" /> {error}
                    </div>
                )}

                {!loading && !error && (
                    <div className="max-w-md space-y-4">
                        {/* Searchable dropdown */}
                        <div ref={dropdownRef} className="relative">
                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wide">
                                Company
                            </label>

                            {/* Trigger */}
                            <button
                                type="button"
                                onClick={() => setOpen(o => !o)}
                                className="w-full flex items-center justify-between gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-left transition-all focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                            >
                                {selected ? (
                                    <span className="flex items-center gap-2 min-w-0">
                                        <Building2 size={14} className="text-blue-500 shrink-0" />
                                        <span className="font-semibold text-slate-800 dark:text-white truncate">{selected.name}</span>
                                        <span className="text-slate-400 dark:text-slate-500 text-xs shrink-0">{selected.industry}</span>
                                    </span>
                                ) : (
                                    <span className="text-slate-400 dark:text-slate-500">Select a company…</span>
                                )}
                                <ChevronDown size={15} className={`text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
                            </button>

                            {/* Dropdown */}
                            {open && (
                                <div className="absolute z-50 mt-1 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden">
                                    {/* Search input */}
                                    <div className="p-2 border-b border-slate-100 dark:border-slate-700">
                                        <div className="relative">
                                            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                            <input
                                                autoFocus
                                                type="text"
                                                value={search}
                                                onChange={e => setSearch(e.target.value)}
                                                placeholder="Search companies…"
                                                className="w-full pl-8 pr-3 py-2 text-sm bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 dark:text-white placeholder-slate-400"
                                            />
                                        </div>
                                    </div>

                                    {/* Options */}
                                    <ul className="max-h-56 overflow-y-auto py-1">
                                        {filtered.length === 0 ? (
                                            <li className="px-4 py-3 text-sm text-slate-400 dark:text-slate-500 text-center">
                                                No companies match "{search}"
                                            </li>
                                        ) : filtered.map(c => (
                                            <li key={c.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSelect(c)}
                                                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors
                                                        ${selected?.id === c.id
                                                            ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400'
                                                            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                                                        }`}
                                                >
                                                    <Building2 size={13} className="shrink-0 text-slate-400" />
                                                    <span className="flex-1 min-w-0">
                                                        <span className="font-semibold truncate block">{c.name}</span>
                                                        <span className="text-xs text-slate-400 dark:text-slate-500 truncate block">
                                                            {c.industry}{c.region ? ` · ${c.region}` : ''}
                                                        </span>
                                                    </span>
                                                    {selected?.id === c.id && (
                                                        <CheckCircle2 size={14} className="text-blue-500 shrink-0" />
                                                    )}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>

                        {/* Selected company detail card */}
                        {selected && (
                            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-3">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold text-sm shrink-0">
                                        {selected.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-bold text-slate-800 dark:text-white truncate">{selected.name}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">{selected.industry}</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    {selected.region && (
                                        <div>
                                            <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wide font-semibold">Region</span>
                                            <p className="text-slate-700 dark:text-slate-300 mt-0.5">{selected.region}</p>
                                        </div>
                                    )}
                                    {selected.legal_entity && (
                                        <div>
                                            <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wide font-semibold">Legal Entity</span>
                                            <p className="text-slate-700 dark:text-slate-300 mt-0.5">{selected.legal_entity}</p>
                                        </div>
                                    )}
                                    <div className="col-span-2">
                                        <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wide font-semibold">Company ID</span>
                                        <p className="text-slate-500 dark:text-slate-400 font-mono mt-0.5 break-all">{selected.id}</p>
                                    </div>
                                </div>
                            </div>
                        )}

                    </div>
                )}
            </div>
        </div>
    );
};

export default AdminCompanyPage;
