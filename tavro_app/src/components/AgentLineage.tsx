import React, { useCallback, useEffect, useState } from 'react';
import { toUserMessage } from '../utils/errorUtils';
import { AgentData, AgentDataSource, AgentSkill, AgentTool } from '../types/agent';
import { Share2, Wrench, Database, ArrowRight, Shield, CheckCircle, AlertTriangle, Zap, Search, Loader2, Link2, Unlink2, PlusCircle, X } from 'lucide-react';
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
    const filteredUnlinked = allTools.filter(t => {
        if (t.is_linked) return false;
        if (!t.tool_name?.trim()) return false;
        const q = toolSearch.toLowerCase();
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
    const filteredUnlinkedTables = allTables.filter(t => {
        if (t.is_linked) return false;
        if (!t.table_name?.trim()) return false;
        const q = tableSearch.toLowerCase();
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
    const filteredUnlinkedColumns = allColumns.filter(c => {
        if (c.is_linked) return false;
        if (!c.column_name?.trim()) return false;
        const q = columnSearch.toLowerCase();
        return !q || c.column_name?.toLowerCase().includes(q) || c.table_name?.toLowerCase().includes(q);
    });

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
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Wrench size={13} /> Currently Linked Tools ({linkedTools.length})
                    </h3>

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

                {/* ── Add Tool Relation ─────────────────────────────────── */}
                {resolvedAgentId && (
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                                <Link2 size={12} /> Add Tool Relation
                            </p>
                            <div className="relative w-full max-w-sm">
                                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    value={toolSearch}
                                    onChange={e => setToolSearch(e.target.value)}
                                    placeholder="Search tools..."
                                    className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                />
                                {toolSearch && (
                                    <button onClick={() => setToolSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                        <X size={11} />
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="max-h-[250px] overflow-y-auto divide-y divide-slate-100">
                            {toolsLoading ? (
                                <div className="flex items-center gap-2 text-xs text-slate-400 p-3">
                                    <Loader2 size={12} className="animate-spin" /> Loading…
                                </div>
                            ) : !toolSearch.trim() ? (
                                <div className="px-4 py-6 text-center text-xs text-slate-400">Search tool name</div>
                            ) : filteredUnlinked.length === 0 ? (
                                <div className="px-4 py-6 text-center text-xs text-slate-400">No tools found for "{toolSearch}"</div>
                            ) : filteredUnlinked.map(tool => {
                                const isActioning = !!actioningTool && actioningTool === tool.effective_tool_id;
                                return (
                                    <div key={tool.effective_tool_id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-slate-700 truncate">{tool.tool_name}</p>
                                            {tool.tool_description && (
                                                <p className="text-[11px] text-slate-400 truncate">{tool.tool_description}</p>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => handleLink(tool.effective_tool_id)}
                                            disabled={!!actioningTool}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isActioning ? <Loader2 size={11} className="animate-spin" /> : <PlusCircle size={11} />}
                                            Link
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

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

                {/* ── Relationships + Add Table Relation ────────────────── */}
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
                                    {hasTableSection && (
                                        <div>
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">TABLE</p>
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
                                        </div>
                                    )}

                                    {/* 2. ADD TABLE RELATION */}
                                    {resolvedAgentId && (
                                        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                                            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                                                <p className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                                                    <Link2 size={12} /> Add Table Relation
                                                </p>
                                                <div className="relative w-full max-w-sm">
                                                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                                    <input
                                                        type="text"
                                                        value={tableSearch}
                                                        onChange={e => setTableSearch(e.target.value)}
                                                        placeholder="Search tables..."
                                                        className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                                    />
                                                    {tableSearch && (
                                                        <button onClick={() => setTableSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                                            <X size={11} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="max-h-[250px] overflow-y-auto divide-y divide-slate-100">
                                                {tablesLoading ? (
                                                    <div className="flex items-center gap-2 text-xs text-slate-400 p-3">
                                                        <Loader2 size={12} className="animate-spin" /> Loading…
                                                    </div>
                                                ) : !tableSearch.trim() ? (
                                                    <div className="px-4 py-6 text-center text-xs text-slate-400">Search table name</div>
                                                ) : filteredUnlinkedTables.length === 0 ? (
                                                    <div className="px-4 py-6 text-center text-xs text-slate-400">No tables found for "{tableSearch}"</div>
                                                ) : filteredUnlinkedTables.map(table => {
                                                    const isActioning = !!actioningTable && actioningTable === table.table_id;
                                                    return (
                                                        <div key={table.table_id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                                                            <div className="min-w-0">
                                                                <p className="text-sm font-semibold text-slate-700 truncate">{table.table_name}</p>
                                                                {table.country_of_provenance && (
                                                                    <p className="text-[11px] text-slate-400 truncate">{table.country_of_provenance}</p>
                                                                )}
                                                            </div>
                                                            <button
                                                                onClick={() => handleLinkTable(table.table_id)}
                                                                disabled={!!actioningTable}
                                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                                            >
                                                                {isActioning ? <Loader2 size={11} className="animate-spin" /> : <PlusCircle size={11} />}
                                                                Link
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* 3. COLUMN — dynamic with Remove button */}
                                    {(linkedColumns.length > 0 || columnsLoading) && (
                                        <div>
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">COLUMN</p>
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
                                        </div>
                                    )}

                                    {/* 4. Add Column Relation */}
                                    {resolvedAgentId && (
                                        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                                            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                                                <p className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                                                    <Link2 size={12} /> Add Column Relation
                                                </p>
                                                <div className="relative w-full max-w-sm">
                                                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                                    <input
                                                        type="text"
                                                        value={columnSearch}
                                                        onChange={e => setColumnSearch(e.target.value)}
                                                        placeholder="Search columns..."
                                                        className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                                    />
                                                    {columnSearch && (
                                                        <button onClick={() => setColumnSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                                            <X size={11} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="max-h-[250px] overflow-y-auto divide-y divide-slate-100">
                                                {columnsLoading ? (
                                                    <div className="flex items-center gap-2 text-xs text-slate-400 p-3">
                                                        <Loader2 size={12} className="animate-spin" /> Loading…
                                                    </div>
                                                ) : !columnSearch.trim() ? (
                                                    <div className="px-4 py-6 text-center text-xs text-slate-400">Search column name</div>
                                                ) : filteredUnlinkedColumns.length === 0 ? (
                                                    <div className="px-4 py-6 text-center text-xs text-slate-400">No columns found for "{columnSearch}"</div>
                                                ) : filteredUnlinkedColumns.map(col => {
                                                    const isActioning = !!actioningColumn && actioningColumn === col.column_id;
                                                    return (
                                                        <div key={col.column_id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                                                            <div className="min-w-0">
                                                                <p className="text-sm font-semibold text-slate-700 truncate">{col.column_name}</p>
                                                                <p className="text-[11px] text-slate-400 truncate">{col.table_name}</p>
                                                            </div>
                                                            <button
                                                                onClick={() => handleLinkColumn(col.column_id)}
                                                                disabled={!!actioningColumn}
                                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                                            >
                                                                {isActioning ? <Loader2 size={11} className="animate-spin" /> : <PlusCircle size={11} />}
                                                                Link
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

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
