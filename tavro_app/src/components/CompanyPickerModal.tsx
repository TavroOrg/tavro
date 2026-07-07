import React from 'react';
import { Building2 } from 'lucide-react';
import { useBlueprint } from '../context/BlueprintContext';

/**
 * Shown on first login when a multi-company tenant has no resolved default
 * company (no server-side preference, no localStorage) — replaces the old
 * silent fallback to companies[0].
 */
const CompanyPickerModal: React.FC = () => {
    const { companies, selectCompany } = useBlueprint();

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xl w-full max-w-md">
                <h2 className="text-lg font-bold text-slate-800 tracking-tight mb-1">Select a company</h2>
                <p className="text-sm text-slate-500 mb-4">Choose which company you'd like to work in. You can switch anytime.</p>
                <div className="flex flex-col gap-2 max-h-80 overflow-auto">
                    {companies.map(company => (
                        <button
                            key={company.id}
                            onClick={() => selectCompany(company)}
                            className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50 text-left transition-colors"
                        >
                            <Building2 size={18} className="text-slate-400 shrink-0" />
                            <span className="text-sm font-medium text-slate-700">{company.name}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default CompanyPickerModal;
