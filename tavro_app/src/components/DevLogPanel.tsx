import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { appLogger, LogEntry, LogLevel } from '../services/logger';

// ── Level config ─────────────────────────────────────────────────────────────

const LEVEL_CONFIG: Record<LogLevel, { label: string; color: string; bg: string; dot: string }> = {
    info: { label: 'INFO', color: 'text-slate-600', bg: 'bg-slate-100 border-slate-200', dot: 'bg-slate-400' },
    warn: { label: 'WARN', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200', dot: 'bg-amber-400' },
    error: { label: 'ERROR', color: 'text-red-700', bg: 'bg-red-50 border-red-200', dot: 'bg-red-500' },
    tool_call: { label: 'TOOL', color: 'text-violet-700', bg: 'bg-violet-50 border-violet-200', dot: 'bg-violet-500' },
    request: { label: 'REQUEST', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200', dot: 'bg-blue-500' },
    response: { label: 'RESPONSE', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500' },
};

const ALL_LEVELS: LogLevel[] = ['info', 'warn', 'error', 'tool_call', 'request', 'response'];

// ── Sub-components ────────────────────────────────────────────────────────────

const LevelBadge: React.FC<{ level: LogLevel }> = ({ level }) => {
    const cfg = LEVEL_CONFIG[level];
    return (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide border ${cfg.bg} ${cfg.color} flex-shrink-0`}>
            {cfg.label}
        </span>
    );
};

const LogRow: React.FC<{ entry: LogEntry }> = ({ entry }) => {
    const [expanded, setExpanded] = useState(false);
    const cfg = LEVEL_CONFIG[entry.level];
    const hasDetail = entry.detail !== undefined && entry.detail !== null;
    const timeStr = entry.timestamp.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const msStr = String(entry.timestamp.getMilliseconds()).padStart(3, '0');

    return (
        <div className={`border-b border-slate-100 last:border-b-0 ${entry.level === 'error' ? 'bg-red-50/50' : entry.level === 'warn' ? 'bg-amber-50/30' : ''}`}>
            <button
                onClick={() => hasDetail && setExpanded(p => !p)}
                className={`w-full text-left flex items-start gap-2 px-3 py-2 hover:bg-slate-50 transition-colors ${hasDetail ? 'cursor-pointer' : 'cursor-default'}`}
            >
                <span className="mt-0.5 flex-shrink-0 text-slate-300 w-3">
                    {hasDetail ? (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
                </span>
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                <span className="font-mono text-[10px] text-slate-400 flex-shrink-0 mt-0.5">
                    {timeStr}<span className="text-slate-300">.{msStr}</span>
                </span>
                <LevelBadge level={entry.level} />
                <span className={`text-xs font-medium flex-1 min-w-0 text-left truncate ${cfg.color}`}>
                    {entry.label}
                </span>
                {entry.durationMs !== undefined && (
                    <span className="text-[10px] text-slate-400 flex-shrink-0 font-mono">
                        {entry.durationMs}ms
                    </span>
                )}
            </button>

            {expanded && hasDetail && (
                <div className="mx-3 mb-2 rounded-lg bg-slate-900 text-emerald-300 text-[11px] font-mono p-3 overflow-x-auto max-h-48 overflow-y-auto">
                    <pre className="whitespace-pre-wrap break-all">
                        {JSON.stringify(entry.detail, null, 2)}
                    </pre>
                </div>
            )}
        </div>
    );
};

// ── Main panel ────────────────────────────────────────────────────────────────

/** Inline DevLog panel — renders as h-full flex column, no fixed positioning. */
const DevLogPanel: React.FC = () => {
    const [entries, setEntries] = useState<LogEntry[]>([]);
    const [filter, setFilter] = useState<LogLevel | 'all'>('all');
    const bottomRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const [autoScroll, setAutoScroll] = useState(true);

    useEffect(() => {
        const unsub = appLogger.subscribe(setEntries);
        return unsub;
    }, []);

    useEffect(() => {
        if (autoScroll) {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [entries, autoScroll]);

    const handleScroll = () => {
        const el = listRef.current;
        if (!el) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        setAutoScroll(atBottom);
    };

    const filtered = filter === 'all' ? entries : entries.filter(e => e.level === filter);

    const levelCounts: Partial<Record<LogLevel | 'all', number>> = { all: entries.length };
    for (const lvl of ALL_LEVELS) {
        levelCounts[lvl] = entries.filter(e => e.level === lvl).length;
    }

    return (
        <div className="flex flex-col h-full bg-slate-50">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-700 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <Terminal size={14} className="text-emerald-400" />
                    <span className="font-bold text-white text-sm">Dev Logs</span>
                    <span className="text-[11px] text-slate-400 font-mono ml-1">{entries.length} entries</span>
                </div>
                <button
                    onClick={() => appLogger.clear()}
                    className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-slate-800"
                    title="Clear logs"
                >
                    <Trash2 size={12} /> Clear
                </button>
            </div>

            {/* Filter pills */}
            <div className="flex gap-1 px-3 py-2 bg-slate-800 flex-shrink-0 overflow-x-auto">
                <button
                    onClick={() => setFilter('all')}
                    className={`flex-shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${filter === 'all' ? 'bg-white text-slate-800' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                >
                    All <span className="opacity-60">({levelCounts.all})</span>
                </button>
                {ALL_LEVELS.map(lvl => {
                    const cfg = LEVEL_CONFIG[lvl];
                    const count = levelCounts[lvl] ?? 0;
                    if (count === 0 && filter !== lvl) return null;
                    return (
                        <button
                            key={lvl}
                            onClick={() => setFilter(lvl)}
                            className={`flex-shrink-0 flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${filter === lvl ? 'bg-white text-slate-800' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                        >
                            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                            {cfg.label}
                            <span className="opacity-60">({count})</span>
                        </button>
                    );
                })}
            </div>

            {/* Log list */}
            <div
                ref={listRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto bg-white"
            >
                {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
                        <Terminal size={32} className="opacity-30" />
                        <p className="text-sm">{entries.length === 0 ? 'No logs yet — start using the app' : 'No entries match this filter'}</p>
                    </div>
                ) : (
                    <>
                        {filtered.map(entry => <LogRow key={entry.id} entry={entry} />)}
                        <div ref={bottomRef} />
                    </>
                )}
            </div>

            {/* Footer status bar */}
            <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-t border-slate-700 flex-shrink-0">
                <div className="flex items-center gap-3">
                    {ALL_LEVELS.filter(l => (levelCounts[l] ?? 0) > 0).map(l => (
                        <span key={l} className="flex items-center gap-1 text-[10px] font-mono">
                            <span className={`w-1.5 h-1.5 rounded-full ${LEVEL_CONFIG[l].dot}`} />
                            <span className="text-slate-400">{levelCounts[l]}</span>
                        </span>
                    ))}
                </div>
                <span className={`text-[10px] font-mono ${autoScroll ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {autoScroll ? '● live' : '○ paused'}
                </span>
            </div>
        </div>
    );
};

export default DevLogPanel;
