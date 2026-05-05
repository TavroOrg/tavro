import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Bot, 
  ChevronRight, 
  Search, 
  ShieldAlert, 
  CheckCircle2, 
  ClipboardList,
  LayoutGrid,
  List
} from 'lucide-react';

interface UseCaseCatalogProps {
    useCases: any[];
    searchTerm: string;
    onSearchChange: (term: string) => void;
}

const UseCaseCatalog: React.FC<UseCaseCatalogProps> = ({
    useCases,
    searchTerm,
    onSearchChange
}) => {
    const navigate = useNavigate();
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

    const getRiskStyle = (risk: string) => {
        switch (risk?.toLowerCase()) {
            case 'high': return { bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-400', border: 'border-red-100 dark:border-red-800/50' };
            case 'medium': return { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-100 dark:border-amber-800/50' };
            default: return { bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-100 dark:border-emerald-800/50' };
        }
    };

    const getStatusStyle = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'live': return 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800/50';
            case 'proposed': return 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-100 dark:border-blue-800/50';
            default: return 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700';
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'live': return <CheckCircle2 size={12} />;
            case 'proposed': return <ClipboardList size={12} />;
            default: return <Bot size={12} />;
        }
    };

    return (
        <div className="flex flex-col gap-6">
            {/* Header / Search Controls */}
            <div className="flex items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={18} />
                    <input
                        type="text"
                        placeholder="Search AI use cases..."
                        value={searchTerm}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-slate-800 dark:text-slate-100"
                    />
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest hidden sm:block">
                        Showing {useCases.length} Results
                    </div>
                    <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={`p-1.5 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                            title="Grid View"
                        >
                            <LayoutGrid size={18} />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`p-1.5 rounded-lg transition-all ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                            title="List View"
                        >
                            <List size={18} />
                        </button>
                    </div>
                </div>
            </div>

            {viewMode === 'grid' ? (
                <div 
                    key={searchTerm ? 'search-grid' : 'paged-grid'}
                    className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
                >
                    {useCases.map(uc => {
                        const risk = getRiskStyle(uc.overall_risk);
                        return (
                            <div
                                key={uc.id}
                                onClick={() => navigate(`/use-case/${uc.id}`)}
                                className="group bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-lg hover:border-blue-400 dark:hover:border-blue-700 transition-all cursor-pointer overflow-hidden flex flex-col h-full"
                            >
                                <div className="p-5 flex-1 flex flex-col">
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl group-hover:scale-110 transition-transform">
                                            <ClipboardList size={24} />
                                        </div>
                                        <div className="flex flex-col items-end">
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${getStatusStyle(uc.status)} border`}>
                                                {uc.status || 'Proposed'}
                                            </span>
                                        </div>
                                    </div>

                                    <h3 className="font-bold text-slate-800 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors line-clamp-2 mb-2 min-h-[3rem] leading-tight">
                                        {uc.name}
                                    </h3>

                                    <div className="space-y-3 mb-4 flex-1">
                                        <div>
                                            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Business Impact</p>
                                            <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 leading-relaxed">
                                                {uc.business_case || uc.businessImpact || 'No impact described'}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800 mt-auto">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Risk</span>
                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${risk.bg} ${risk.text} ${risk.border}`}>
                                                {uc.overall_risk || 'N/A'}
                                            </span>
                                        </div>
                                        <div className="flex -space-x-2">
                                            <div className="w-6 h-6 rounded-full border-2 border-white dark:border-slate-900 bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-[8px] font-bold text-blue-600 dark:text-blue-400">A1</div>
                                            <div className="w-6 h-6 rounded-full border-2 border-white dark:border-slate-900 bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-[8px] font-bold text-indigo-600 dark:text-indigo-400">A2</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
                    <div className="grid grid-cols-[1.5fr_1fr_120px_1fr_140px_48px] items-center bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 px-6 py-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        <div>Use Case Name</div>
                        <div>Function</div>
                        <div>Status</div>
                        <div>Owner</div>
                        <div>Risk Level</div>
                        <div></div>
                    </div>
                    <div 
                        key={searchTerm ? 'search-list' : 'paged-list'}
                        className="divide-y divide-slate-100 dark:divide-slate-800"
                    >
                        {useCases.map(uc => {
                            const risk = getRiskStyle(uc.overall_risk);
                            return (
                                <div
                                    key={uc.id}
                                    onClick={() => navigate(`/use-case/${uc.id}`)}
                                    className="grid grid-cols-[1.5fr_1fr_120px_1fr_140px_48px] items-center px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors group"
                                >
                                    <div className="flex flex-col gap-0.5 pr-4">
                                        <div className="font-bold text-slate-800 dark:text-slate-100 text-sm group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                                            {uc.name}
                                        </div>
                                        <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                                            {uc.id.slice(0, 8)}
                                        </div>
                                    </div>
                                    <div className="text-sm text-slate-500 dark:text-slate-400 truncate pr-4">
                                        {uc.function || '—'}
                                    </div>
                                    <div>
                                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${getStatusStyle(uc.status)}`}>
                                            {getStatusIcon(uc.status)}
                                            {uc.status || 'Proposed'}
                                        </span>
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate pr-4">
                                        {uc.owner || 'Unassigned'}
                                    </div>
                                    <div>
                                        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded border ${risk.bg} ${risk.text} ${risk.border}`}>
                                            <ShieldAlert size={12} className={uc.overall_risk ? '' : 'text-slate-400 dark:text-slate-600'} />
                                            {uc.overall_risk || 'Yet to assessed'}
                                        </span>
                                    </div>
                                    <div className="flex justify-end pr-2 text-slate-300 dark:text-slate-600 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors">
                                        <ChevronRight size={18} className="transform group-hover:translate-x-1 transition-transform" />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {useCases.length === 0 && (
                <div className="py-20 flex flex-col items-center justify-center gap-4 text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800">
                    <div className="p-4 bg-white dark:bg-slate-800 rounded-full shadow-sm">
                        <Search size={32} className="text-slate-300 dark:text-slate-600" />
                    </div>
                    <p className="font-medium text-lg">No use cases found matching your criteria</p>
                </div>
            )}
        </div>
    );
};

export default UseCaseCatalog;
