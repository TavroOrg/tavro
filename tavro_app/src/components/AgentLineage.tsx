import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toUserMessage } from '../utils/errorUtils';
import { AgentData, AgentDataSource, AgentSkill, AgentTool } from '../types/agent';
import { Share2, Wrench, Database, ArrowRight, Shield, CheckCircle, AlertTriangle, Zap, Search, Loader2, Unlink2, PlusCircle, Check, ChevronDown } from 'lucide-react';
import { businessRelationsApi, AgentToolRecord, AgentTableRecord, AgentColumnRecord } from '../services/businessRelationsApi';

interface AgentLineageProps {
    agent: AgentData;
    agentId?: string;
}

/** Pill for PII / PHI / PCI flags */
const DataFlag: React.FC<{ label: string; active: boolean }> = ({ label, active }) =>
    active ? (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border bg-rose-50 border-rose-200 text-rose-700">
            <AlertTriangle size={8} /> {label}
        </span>
    ) : (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border bg-emerald-50 border-emerald-100 text-emerald-600">
            <CheckCircle size={8} /> No {label}
        </span>
    );

function isYes(value: unknown) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    return String(value ?? '').toLowerCase() === 'yes';
}

function displayText(value: unknown, fallback = 'Unknown') {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    return fallback;
}

function toArray<T>(value: unknown): T[] {
    if (Array.isArray(value)) return value.filter(Boolean) as T[];
    if (!value || typeof value !== 'object') return [];

    const objectValue = value as Record<string, unknown>;
    const nested = objectValue.data ?? objectValue.items ?? objectValue.results;
    if (Array.isArray(nested)) return nested.filter(Boolean) as T[];

    return [value as T];
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map(v => displayText(v, '')).filter(Boolean)
        : [];
}

const AgentLineage: React.FC<AgentLineageProps> = ({ agent, agentId }) => {
    const resolvedAgentId = agentId ?? agent.identification?.agent_id;
    const skills = toArray<AgentSkill>((agent as any).skills).filter(skill =>
        displayText(skill.name ?? skill.skill_name ?? skill.identifier ?? skill.id ?? skill.skill_id, '').trim()
    );
    const dataSources = toArray<AgentDataSource>((agent as any).data_source);

    // TABLE-type entries from agent_data_sources (have PII/PHI/PCI data)
    const tableDataSources = dataSources.filter(
        ds => displayText(ds.target_object_type, '').toLowerCase() === 'table'
    );
    // Non-tool, non-table, non-column entries grouped by type (for the Relationships section)
    const otherDataSources = dataSources.filter(ds => {
        const t = displayText(ds.target_object_type, '').toLowerCase();
        return t !== 'tool' && t !== 'table' && t !== 'column';
    });
    const otherGrouped: Record<string, AgentDataSource[]> = {};
    for (const ds of otherDataSources) {
        const type = displayText(ds.target_object_type, 'Other');
        if (!otherGrouped[type]) otherGrouped[type] = [];
        otherGrouped[type].push(ds);
    }
    const otherGroupedEntries = Object.entries(otherGrouped);

    const hasPiiConcerns = [...tableDataSources, ...otherDataSources].some(
        ds => isYes(ds.uses_pii) || isYes(ds.uses_phi) || isYes(ds.uses_pci)
    );

    // ── Tool link/unlink state ──────────────────────────────────
    const [allTools, setAllTools] = useState<AgentToolRecord[]>([]);
    const [toolsLoading, setToolsLoading] = useState(false);
    const [toolsError, setToolsError] = useState<string | null>(null);
    const [toolSearch, setToolSearch] = useState('');
    const [actioningTool, setActioningTool] = useState<string | null>(null);

    const fetchTools = useCallback(async () => {
        if (!resolvedAgentId) return;
        setToolsLoading(true);
        setToolsError(null);
        try {
            // Fix any null tool_ids before fetching so every linked tool has a real UUID
            await businessRelationsApi.ensureAgentToolUuids(resolvedAgentId).catch(() => {});
            const result = await businessRelationsApi.listAgentTools(resolvedAgentId);
            setAllTools(result.items);
        } catch (err: any) {
            setToolsError(toUserMessage(err));
        } finally {
            setToolsLoading(false);
        }
    }, [resolvedAgentId]);

    useEffect(() => { fetchTools(); }, [fetchTools]);

    const linkedTools = allTools.filter(t => t.is_linked && t.tool_name?.trim());
    const filteredCatalogTools = allTools.filter(t => {
        if (!t.tool_name?.trim()) return false;
        const q = toolSearch.trim().toLowerCase();
        return !q || t.tool_name?.toLowerCase().includes(q) || t.tool_description?.toLowerCase().includes(q);
    });

    const handleLink = async (effectiveId: string) => {
        if (!resolvedAgentId || actioningTool) return;
        setActioningTool(effectiveId);
        try {
            await businessRelationsApi.linkAgentToTool(resolvedAgentId, effectiveId);
            setAllTools(prev => prev.map(t => t.effective_tool_id === effectiveId ? { ...t, is_linked: true } : t));
        } catch (err: any) {
            setToolsError(toUserMessage(err));
        } finally {
            setActioningTool(null);
        }
    };

    const handleUnlink = async (effectiveId: string) => {
        if (!resolvedAgentId || actioningTool) return;
        setActioningTool(effectiveId);
        try {
            await businessRelationsApi.unlinkAgentFromTool(resolvedAgentId, effectiveId);
            setAllTools(prev => prev.map(t => t.effective_tool_id === effectiveId ? { ...t, is_linked: false } : t));
        } catch (err: any) {
            setToolsError(toUserMessage(err));
        } finally {
            setActioningTool(null);
        }
    };

    // ── Table link/unlink state ─────────────────────────────────
    const [allTables, setAllTables] = useState<AgentTableRecord[]>([]);
    const [tablesLoading, setTablesLoading] = useState(false);
    const [tablesError, setTablesError] = useState<string | null>(null);
    const [tableSearch, setTableSearch] = useState('');
    const [actioningTable, setActioningTable] = useState<string | null>(null);

    const fetchTables = useCallback(async () => {
        if (!resolvedAgentId) return;
        setTablesLoading(true);
        setTablesError(null);
        try {
            const result = await businessRelationsApi.listAgentTables(resolvedAgentId);
            setAllTables(result.items);
        } catch (err: any) {
            setTablesError(toUserMessage(err));
        } finally {
            setTablesLoading(false);
        }
    }, [resolvedAgentId]);

    useEffect(() => { fetchTables(); }, [fetchTables]);

    const linkedTables = allTables.filter(t => t.is_linked && t.table_name?.trim());
    const filteredCatalogTables = allTables.filter(t => {
        if (!t.table_name?.trim()) return false;
        const q = tableSearch.trim().toLowerCase();
        return !q || t.table_name?.toLowerCase().includes(q);
    });

    const handleLinkTable = async (tableId: string) => {
        if (!resolvedAgentId || actioningTable) return;
        setActioningTable(tableId);
        setTablesError(null);
        try {
            await businessRelationsApi.linkAgentToTable(resolvedAgentId, tableId);
            setAllTables(prev => prev.map(t => t.table_id === tableId ? { ...t, is_linked: true } : t));
            // Backend auto-links all columns — refresh column list
            businessRelationsApi.listAgentColumns(resolvedAgentId)
                .then(r => setAllColumns(r.items))
                .catch(() => {});
        } catch (err: any) {
            setTablesError(toUserMessage(err));
        } finally {
            setActioningTable(null);
        }
    };

    const handleUnlinkTable = async (tableId: string) => {
        if (!resolvedAgentId || actioningTable) return;
        setActioningTable(tableId);
        setTablesError(null);
        try {
            await businessRelationsApi.unlinkAgentFromTable(resolvedAgentId, tableId);
            setAllTables(prev => prev.map(t => t.table_id === tableId ? { ...t, is_linked: false } : t));
            // Remove all columns belonging to this table from local state
            setAllColumns(prev => prev.filter(c => c.table_id !== tableId));
        } catch (err: any) {
            setTablesError(toUserMessage(err));
        } finally {
            setActioningTable(null);
        }
    };

    // ── Column link/unlink state ────────────────────────────────
    const [allColumns, setAllColumns] = useState<AgentColumnRecord[]>([]);
    const [columnsLoading, setColumnsLoading] = useState(false);
    const [columnsError, setColumnsError] = useState<string | null>(null);
    const [columnSearch, setColumnSearch] = useState('');
    const [actioningColumn, setActioningColumn] = useState<string | null>(null);

    const fetchColumns = useCallback(async () => {
        if (!resolvedAgentId) return;
        setColumnsLoading(true);
        setColumnsError(null);
        try {
            const result = await businessRelationsApi.listAgentColumns(resolvedAgentId);
            setAllColumns(result.items);
        } catch (err: any) {
            setColumnsError(toUserMessage(err));
        } finally {
            setColumnsLoading(false);
        }
    }, [resolvedAgentId]);

    useEffect(() => { fetchColumns(); }, [fetchColumns]);

    const linkedColumns = allColumns.filter(c => c.is_linked && c.column_name?.trim());
    const filteredCatalogColumns = allColumns.filter(c => {
        if (!c.column_name?.trim()) return false;
        const q = columnSearch.trim().toLowerCase();
        return !q || c.column_name?.toLowerCase().includes(q) || c.table_name?.toLowerCase().includes(q);
    });

    const [openDropdown, setOpenDropdown] = useState<string | null>(null);
    const dropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const searchInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

    useEffect(() => {
        if (openDropdown === null) return;
        const key = openDropdown;
        const id = window.setTimeout(() => searchInputRefs.current[key]?.focus(), 0);
        const handlePointerDown = (event: MouseEvent) => {
            const el = dropdownRefs.current[key];
            if (el && !el.contains(event.target as Node)) setOpenDropdown(null);
        };
        document.addEventListener('mousedown', handlePointerDown);
        return () => {
            window.clearTimeout(id);
            document.removeEventListener('mousedown', handlePointerDown);
        };
    }, [openDropdown]);

    const handleLinkColumn = async (columnId: string) => {
        if (!resolvedAgentId || actioningColumn) return;
        setActioningColumn(columnId);
        setColumnsError(null);
        try {
            await businessRelationsApi.linkAgentToColumn(resolvedAgentId, columnId);
            setAllColumns(prev => prev.map(c => c.column_id === columnId ? { ...c, is_linked: true } : c));
        } catch (err: any) {
            setColumnsError(toUserMessage(err));
        } finally {
            setActioningColumn(null);
        }
    };

    const handleUnlinkColumn = async (columnId: string) => {
        if (!resolvedAgentId || actioningColumn) return;
        setActioningColumn(columnId);
        setColumnsError(null);
        try {
            await businessRelationsApi.unlinkAgentFromColumn(resolvedAgentId, columnId);
            setAllColumns(prev => prev.map(c => c.column_id === columnId ? { ...c, is_linked: false } : c));
        } catch (err: any) {
            setColumnsError(toUserMessage(err));
        } finally {
            setActioningColumn(null);
        }
    };

    return (
        <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden flex flex-col h-full">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                        <Share2 size={20} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-800 tracking-tight">Lineage Map</h2>
                        <p className="text-xs text-slate-500 font-medium">Tools, skills, data sources & relationships</p>
                    </div>
                </div>
                {hasPiiConcerns && (
                    <span className="flex items-center gap-1.5 text-[11px] font-bold text-rose-600 bg-rose-50 border border-rose-100 px-2.5 py-1 rounded-full">
                        <Shield size={11} /> PII / sensitive data
                    </span>
                )}
            </div>

            <div className="flex-1 p-5 flex flex-col gap-6 overflow-y-auto">

                {/* ── Currently Linked Tools ─────────────────────────────── */}
                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                            <Wrench size={13} /> Currently Linked Tools ({linkedTools.length})
                        </h3>
                        {resolvedAgentId && (
                            <div className="relative" ref={(el) => { dropdownRefs.current.tools = el; }}>
                                <button
                                    onClick={() => setOpenDropdown(openDropdown === 'tools' ? null : 'tools')}
                                    className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:border-blue-300 px-3 py-2 rounded-lg transition-colors"
                                    aria-haspopup="listbox"
                                    aria-expanded={openDropdown === 'tools'}
                                >
                                    <PlusCircle size={13} className="text-blue-600" />
                                    Add tool
                                    <ChevronDown size={13} className="text-slate-400" />
                                </button>
                                {openDropdown === 'tools' && (
                                    <div className="absolute top-full right-0 mt-1 w-[300px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                                        <div className="p-2 border-b border-slate-100">
                                            <div className="relative">
                                                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                                <input
                                                    ref={(el) => { searchInputRefs.current.tools = el; }}
                                                    value={toolSearch}
                                                    onChange={e => setToolSearch(e.target.value)}
                                                    onKeyDown={(e) => { if (e.key === 'Escape') setOpenDropdown(null); }}
                                                    placeholder="Search tool..."
                                                    className="w-full pl-7 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
                                                />
                                            </div>
                                        </div>
                                        <div className="max-h-72 overflow-y-auto py-1" role="listbox">
                                            {toolsLoading ? (
                                                <div className="flex items-center gap-2 text-xs text-slate-400 px-4 py-6 justify-center">
                                                    <Loader2 size={13} className="animate-spin" /> Loading tools…
                                                </div>
                                            ) : filteredCatalogTools.length === 0 ? (
                                                <div className="px-4 py-6 text-center text-xs text-slate-400">No tools found</div>
                                            ) : filteredCatalogTools.map(tool => {
                                                const isActioning = !!actioningTool && actioningTool === tool.effective_tool_id;
                                                return (
                                                    <button
                                                        key={tool.effective_tool_id}
                                                        type="button"
                                                        role="option"
                                                        aria-selected={tool.is_linked}
                                                        disabled={!!actioningTool}
                                                        onClick={() => (tool.is_linked ? handleUnlink(tool.effective_tool_id) : handleLink(tool.effective_tool_id))}
                                                        className={`w-full flex items-center gap-2 text-left px-4 py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                                            tool.is_linked ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-700 hover:bg-slate-50'
                                                        }`}
                                                    >
                                                        <span className="min-w-0 flex-1">
                                                            <span className="block font-semibold truncate">{tool.tool_name}</span>
                                                            {tool.tool_description && (
                                                                <span className="block text-[11px] text-slate-400 truncate">{tool.tool_description}</span>
                                                            )}
                                                        </span>
                                                        {isActioning ? (
                                                            <Loader2 size={14} className="animate-spin shrink-0 text-slate-400" />
                                                        ) : tool.is_linked ? (
                                                            <Check size={15} className="shrink-0 text-blue-600" />
                                                        ) : null}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {toolsError && (
                        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2.5 text-xs">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                            {toolsError}
                        </div>
                    )}

                    {toolsLoading ? (
                        <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
                            <Loader2 size={14} className="animate-spin" /> Loading tools…
                        </div>
                    ) : linkedTools.length === 0 ? (
                        <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                            No tools linked yet.
                        </div>
                    ) : (
                        <div className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
                            {linkedTools.map(tool => {
                                const isActioning = !!actioningTool && actioningTool === tool.effective_tool_id;
                                return (
                                    <div key={tool.effective_tool_id} className="flex items-center justify-between px-4 py-3 bg-white hover:bg-slate-50 gap-3">
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-slate-800 truncate">{tool.tool_name}</p>
                                            {tool.tool_description && (
                                                <p className="text-xs text-slate-500 truncate mt-0.5">{tool.tool_description}</p>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => handleUnlink(tool.effective_tool_id)}
                                            disabled={!!actioningTool}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isActioning
                                                ? <Loader2 size={11} className="animate-spin" />
                                                : <Unlink2 size={11} />}
                                            Remove
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* ── Skills ────────────────────────────────────────────── */}
                <div className="flex flex-col gap-3">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Zap size={13} /> Skills ({skills.length})
                    </h3>
                    {skills.length === 0 ? (
                        <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                            No skills configured.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {skills.map((skill, idx) => {
                                const label = displayText(
                                    skill.name ?? skill.skill_name ?? skill.identifier ?? skill.id ?? skill.skill_id,
                                    `Skill ${idx + 1}`,
                                );
                                const inputModes = stringArray(skill.inputModes ?? skill.input_modes);
                                const outputModes = stringArray(skill.outputModes ?? skill.output_modes);

                                return (
                                    <div key={skill.identifier ?? skill.id ?? skill.skill_id ?? idx} className="bg-slate-50 border border-slate-200 p-4 rounded-xl hover:border-indigo-200 transition-all">
                                        <span className="font-bold text-sm text-slate-800 break-words">{label}</span>
                                        {skill.description && (
                                            <span className="text-xs text-slate-500 leading-relaxed block mt-1">{displayText(skill.description, '')}</span>
                                        )}
                                        {(inputModes.length > 0 || outputModes.length > 0) && (
                                            <div className="flex flex-wrap gap-1 mt-2">
                                                {inputModes.map(mode => (
                                                    <span key={`in-${mode}`} className="text-[9px] font-bold px-2 py-0.5 rounded bg-emerald-50 border border-emerald-100 text-emerald-700 uppercase">
                                                        In: {mode}
                                                    </span>
                                                ))}
                                                {outputModes.map(mode => (
                                                    <span key={`out-${mode}`} className="text-[9px] font-bold px-2 py-0.5 rounded bg-blue-50 border border-blue-100 text-blue-700 uppercase">
                                                        Out: {mode}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* ── Relationships (tables, columns, other) ────────────── */}
                {(() => {
                    // Filter tableDataSources: if a table is in allTables catalog, only show if still linked.
                    // This ensures Remove immediately hides the row (no stale display).
                    const visibleTableDataSources = tableDataSources.filter(ds => {
                        const targetName = displayText(ds.target_object_name, '').toLowerCase();
                        const inCatalog = allTables.some(t => t.table_name?.toLowerCase() === targetName);
                        if (inCatalog) return allTables.some(t => t.table_name?.toLowerCase() === targetName && t.is_linked);
                        return true; // read-only entry not in catalog — always show
                    });

                    // agent_tables entries NOT already represented in agent_data_sources TABLE entries
                    const extraLinkedTables = linkedTables.filter(
                        t => !tableDataSources.some(
                            ds => displayText(ds.target_object_name, '').toLowerCase() === t.table_name?.toLowerCase()
                        )
                    );
                    const totalRelCount =
                        visibleTableDataSources.length + extraLinkedTables.length +
                        linkedColumns.length + otherDataSources.length;
                    const hasTableSection = visibleTableDataSources.length > 0 || extraLinkedTables.length > 0;

                    return (
                        <div className="flex flex-col gap-3">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                <Database size={13} /> Relationships ({totalRelCount})
                            </h3>

                            {tablesError && (
                                <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2.5 text-xs">
                                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                    {tablesError}
                                </div>
                            )}

                            {tablesLoading ? (
                                <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
                                    <Loader2 size={14} className="animate-spin" /> Loading tables…
                                </div>
                            ) : (
                                <div className="flex flex-col gap-4">
                                    {/* 1. TABLE group */}
                                    <div>
                                        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">TABLE</p>
                                            {resolvedAgentId && (
                                                <div className="relative" ref={(el) => { dropdownRefs.current.tables = el; }}>
                                                    <button
                                                        onClick={() => setOpenDropdown(openDropdown === 'tables' ? null : 'tables')}
                                                        className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:border-blue-300 px-3 py-2 rounded-lg transition-colors"
                                                        aria-haspopup="listbox"
                                                        aria-expanded={openDropdown === 'tables'}
                                                    >
                                                        <PlusCircle size={13} className="text-blue-600" />
                                                        Add table
                                                        <ChevronDown size={13} className="text-slate-400" />
                                                    </button>
                                                    {openDropdown === 'tables' && (
                                                        <div className="absolute top-full right-0 mt-1 w-[300px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                                                            <div className="p-2 border-b border-slate-100">
                                                                <div className="relative">
                                                                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                                                    <input
                                                                        ref={(el) => { searchInputRefs.current.tables = el; }}
                                                                        value={tableSearch}
                                                                        onChange={e => setTableSearch(e.target.value)}
                                                                        onKeyDown={(e) => { if (e.key === 'Escape') setOpenDropdown(null); }}
                                                                        placeholder="Search table..."
                                                                        className="w-full pl-7 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div className="max-h-72 overflow-y-auto py-1" role="listbox">
                                                                {tablesLoading ? (
                                                                    <div className="flex items-center gap-2 text-xs text-slate-400 px-4 py-6 justify-center">
                                                                        <Loader2 size={13} className="animate-spin" /> Loading tables…
                                                                    </div>
                                                                ) : filteredCatalogTables.length === 0 ? (
                                                                    <div className="px-4 py-6 text-center text-xs text-slate-400">No tables found</div>
                                                                ) : filteredCatalogTables.map(table => {
                                                                    const isActioning = !!actioningTable && actioningTable === table.table_id;
                                                                    return (
                                                                        <button
                                                                            key={table.table_id}
                                                                            type="button"
                                                                            role="option"
                                                                            aria-selected={table.is_linked}
                                                                            disabled={!!actioningTable}
                                                                            onClick={() => (table.is_linked ? handleUnlinkTable(table.table_id) : handleLinkTable(table.table_id))}
                                                                            className={`w-full flex items-center gap-2 text-left px-4 py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                                                                table.is_linked ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-700 hover:bg-slate-50'
                                                                            }`}
                                                                        >
                                                                            <span className="min-w-0 flex-1">
                                                                                <span className="block font-semibold truncate">{table.table_name}</span>
                                                                                {table.country_of_provenance && (
                                                                                    <span className="block text-[11px] text-slate-400 truncate">{table.country_of_provenance}</span>
                                                                                )}
                                                                            </span>
                                                                            {isActioning ? (
                                                                                <Loader2 size={14} className="animate-spin shrink-0 text-slate-400" />
                                                                            ) : table.is_linked ? (
                                                                                <Check size={15} className="shrink-0 text-blue-600" />
                                                                            ) : null}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        {hasTableSection && (
                                            <div className="flex flex-col gap-2">
                                                {/* Entries from agent_data_sources (have PII/PHI/PCI data) */}
                                                {visibleTableDataSources.map((ds, i) => {
                                                    const targetName = displayText(ds.target_object_name, '');
                                                    const matchedLinked = linkedTables.find(
                                                        t => t.table_name?.toLowerCase() === targetName.toLowerCase()
                                                    );
                                                    return (
                                                        <div key={i} className="bg-white border border-slate-100 rounded-xl p-3 shadow-sm">
                                                            <div className="flex items-start justify-between gap-3">
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex flex-wrap items-start gap-x-2 gap-y-1 mb-2 text-xs">
                                                                        <span className="font-semibold text-slate-700 whitespace-normal break-words leading-relaxed">
                                                                            {displayText(ds.source_object_name, 'Unknown source')}
                                                                        </span>
                                                                        <ArrowRight size={11} className="text-slate-400 shrink-0 mt-0.5" />
                                                                        <span className="font-bold text-indigo-700 whitespace-normal break-words leading-relaxed">
                                                                            {displayText(ds.target_object_name, 'Unknown target')}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex flex-wrap gap-1 items-center">
                                                                        {ds.access_level && (
                                                                            <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600 uppercase">
                                                                                {displayText(ds.access_level, '')}
                                                                            </span>
                                                                        )}
                                                                        <DataFlag label="PII" active={isYes(ds.uses_pii)} />
                                                                        <DataFlag label="PHI" active={isYes(ds.uses_phi)} />
                                                                        <DataFlag label="PCI" active={isYes(ds.uses_pci)} />
                                                                    </div>
                                                                </div>
                                                                {matchedLinked && (
                                                                    <button
                                                                        onClick={() => handleUnlinkTable(matchedLinked.table_id)}
                                                                        disabled={!!actioningTable}
                                                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                                                    >
                                                                        {!!actioningTable && actioningTable === matchedLinked.table_id
                                                                            ? <Loader2 size={11} className="animate-spin" />
                                                                            : <Unlink2 size={11} />}
                                                                        Remove
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}

                                                {/* Extra linked tables (from agent_tables only, not in agent_data_sources) */}
                                                {extraLinkedTables.map(table => {
                                                    const isActioning = !!actioningTable && actioningTable === table.table_id;
                                                    return (
                                                        <div key={table.table_id} className="bg-white border border-slate-100 rounded-xl p-3 shadow-sm">
                                                            <div className="flex items-start justify-between gap-3">
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex flex-wrap items-start gap-x-2 gap-y-1 mb-2 text-xs">
                                                                        <span className="font-semibold text-slate-700 whitespace-normal break-words leading-relaxed">
                                                                            {agent.name || displayText(agent.identification?.agent_id, 'Agent')}
                                                                        </span>
                                                                        <ArrowRight size={11} className="text-slate-400 shrink-0 mt-0.5" />
                                                                        <span className="font-bold text-indigo-700 whitespace-normal break-words leading-relaxed">
                                                                            {table.table_name}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex flex-wrap gap-1 items-center">
                                                                        <DataFlag label="PII" active={false} />
                                                                        <DataFlag label="PHI" active={false} />
                                                                        <DataFlag label="PCI" active={false} />
                                                                    </div>
                                                                </div>
                                                                <button
                                                                    onClick={() => handleUnlinkTable(table.table_id)}
                                                                    disabled={!!actioningTable}
                                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                                                >
                                                                    {isActioning
                                                                        ? <Loader2 size={11} className="animate-spin" />
                                                                        : <Unlink2 size={11} />}
                                                                    Remove
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    {/* 3. COLUMN — dynamic with Remove button */}
                                    <div>
                                        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">COLUMN</p>
                                            {resolvedAgentId && (
                                                <div className="relative" ref={(el) => { dropdownRefs.current.columns = el; }}>
                                                    <button
                                                        onClick={() => setOpenDropdown(openDropdown === 'columns' ? null : 'columns')}
                                                        className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:border-blue-300 px-3 py-2 rounded-lg transition-colors"
                                                        aria-haspopup="listbox"
                                                        aria-expanded={openDropdown === 'columns'}
                                                    >
                                                        <PlusCircle size={13} className="text-blue-600" />
                                                        Add column
                                                        <ChevronDown size={13} className="text-slate-400" />
                                                    </button>
                                                    {openDropdown === 'columns' && (
                                                        <div className="absolute top-full right-0 mt-1 w-[300px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                                                            <div className="p-2 border-b border-slate-100">
                                                                <div className="relative">
                                                                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                                                    <input
                                                                        ref={(el) => { searchInputRefs.current.columns = el; }}
                                                                        value={columnSearch}
                                                                        onChange={e => setColumnSearch(e.target.value)}
                                                                        onKeyDown={(e) => { if (e.key === 'Escape') setOpenDropdown(null); }}
                                                                        placeholder="Search column..."
                                                                        className="w-full pl-7 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div className="max-h-72 overflow-y-auto py-1" role="listbox">
                                                                {columnsLoading ? (
                                                                    <div className="flex items-center gap-2 text-xs text-slate-400 px-4 py-6 justify-center">
                                                                        <Loader2 size={13} className="animate-spin" /> Loading columns…
                                                                    </div>
                                                                ) : filteredCatalogColumns.length === 0 ? (
                                                                    <div className="px-4 py-6 text-center text-xs text-slate-400">No columns found</div>
                                                                ) : filteredCatalogColumns.map(col => {
                                                                    const isActioning = !!actioningColumn && actioningColumn === col.column_id;
                                                                    return (
                                                                        <button
                                                                            key={col.column_id}
                                                                            type="button"
                                                                            role="option"
                                                                            aria-selected={col.is_linked}
                                                                            disabled={!!actioningColumn}
                                                                            onClick={() => (col.is_linked ? handleUnlinkColumn(col.column_id) : handleLinkColumn(col.column_id))}
                                                                            className={`w-full flex items-center gap-2 text-left px-4 py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                                                                col.is_linked ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-700 hover:bg-slate-50'
                                                                            }`}
                                                                        >
                                                                            <span className="min-w-0 flex-1">
                                                                                <span className="block font-semibold truncate">{col.column_name}</span>
                                                                                <span className="block text-[11px] text-slate-400 truncate">{col.table_name}</span>
                                                                            </span>
                                                                            {isActioning ? (
                                                                                <Loader2 size={14} className="animate-spin shrink-0 text-slate-400" />
                                                                            ) : col.is_linked ? (
                                                                                <Check size={15} className="shrink-0 text-blue-600" />
                                                                            ) : null}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        {(linkedColumns.length > 0 || columnsLoading) && (<>
                                            {columnsError && (
                                                <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2.5 text-xs mb-2">
                                                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                                    {columnsError}
                                                </div>
                                            )}
                                            {columnsLoading ? (
                                                <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
                                                    <Loader2 size={14} className="animate-spin" /> Loading columns…
                                                </div>
                                            ) : (
                                                <div className="flex flex-col gap-2">
                                                    {linkedColumns.map(col => {
                                                        const isActioning = !!actioningColumn && actioningColumn === col.column_id;
                                                        return (
                                                            <div key={col.column_id} className="bg-white border border-slate-100 rounded-xl p-3 shadow-sm">
                                                                <div className="flex items-start justify-between gap-3">
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="flex flex-wrap items-start gap-x-2 gap-y-1 mb-2 text-xs">
                                                                            <span className="font-semibold text-slate-700 whitespace-normal break-words leading-relaxed">
                                                                                {col.table_name || 'Unknown table'}
                                                                            </span>
                                                                            <ArrowRight size={11} className="text-slate-400 shrink-0 mt-0.5" />
                                                                            <span className="font-bold text-indigo-700 whitespace-normal break-words leading-relaxed">
                                                                                {col.column_name}
                                                                            </span>
                                                                        </div>
                                                                        <div className="flex flex-wrap gap-1 items-center">
                                                                            <DataFlag label="PII" active={isYes(col.uses_pii)} />
                                                                            <DataFlag label="PHI" active={isYes(col.uses_phi)} />
                                                                            <DataFlag label="PCI" active={isYes(col.uses_pci)} />
                                                                        </div>
                                                                    </div>
                                                                    <button
                                                                        onClick={() => handleUnlinkColumn(col.column_id)}
                                                                        disabled={!!actioningColumn}
                                                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                                                    >
                                                                        {isActioning
                                                                            ? <Loader2 size={11} className="animate-spin" />
                                                                            : <Unlink2 size={11} />}
                                                                        Remove
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </>)}
                                    </div>

                                    {/* 5. Other types (non-TABLE, non-COLUMN) from agent_data_sources */}
                                    {otherGroupedEntries.map(([type, sources]) => (
                                        <div key={type}>
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">{type}</p>
                                            <div className="flex flex-col gap-2">
                                                {sources.map((ds, i) => (
                                                    <div key={i} className="bg-white border border-slate-100 rounded-xl p-3 shadow-sm">
                                                        <div className="flex flex-wrap items-start gap-x-2 gap-y-1 mb-2 text-xs">
                                                            <span className="font-semibold text-slate-700 whitespace-normal break-words leading-relaxed">
                                                                {displayText(ds.source_object_name, 'Unknown source')}
                                                            </span>
                                                            <ArrowRight size={11} className="text-slate-400 shrink-0 mt-0.5" />
                                                            <span className="font-bold text-indigo-700 whitespace-normal break-words leading-relaxed">
                                                                {displayText(ds.target_object_name, 'Unknown target')}
                                                            </span>
                                                        </div>
                                                        <div className="flex flex-wrap gap-1 items-center">
                                                            {ds.access_level && (
                                                                <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600 uppercase">
                                                                    {displayText(ds.access_level, '')}
                                                                </span>
                                                            )}
                                                            <DataFlag label="PII" active={isYes(ds.uses_pii)} />
                                                            <DataFlag label="PHI" active={isYes(ds.uses_phi)} />
                                                            <DataFlag label="PCI" active={isYes(ds.uses_pci)} />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}

                                    {totalRelCount === 0 && (
                                        <div className="p-4 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                                            No relationships configured.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })()}

            </div>
        </div>
    );
};

export default AgentLineage;
