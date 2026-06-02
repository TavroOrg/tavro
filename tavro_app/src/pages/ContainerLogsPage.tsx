import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Box, Circle, Search, Pause, Play,
    Trash2, Download, WifiOff, Loader2,
} from 'lucide-react';

const BASE = import.meta.env.VITE_TWIN_API_URL ?? '';
const STREAM_URL = `${BASE}/api/v1/docker-logs/stream`;
const CONTAINERS_URL = `${BASE}/api/v1/docker-logs/containers`;

interface LogEntry {
    container: string;
    cid: string;
    color: string;
    message: string;
    ts: number;
}

interface ContainerInfo {
    id: string;
    name: string;
    status: string;
    color: string;
}

// Tailwind color map — must be static strings for Tailwind to include them in the build
const COLOR_CLASSES: Record<string, { badge: string; dot: string; text: string }> = {
    blue:   { badge: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',   dot: 'bg-blue-500',   text: 'text-blue-400' },
    green:  { badge: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300', dot: 'bg-green-500',  text: 'text-green-400' },
    yellow: { badge: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300', dot: 'bg-yellow-400', text: 'text-yellow-400' },
    red:    { badge: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',       dot: 'bg-red-500',    text: 'text-red-400' },
    purple: { badge: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300', dot: 'bg-purple-500', text: 'text-purple-400' },
    pink:   { badge: 'bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300',   dot: 'bg-pink-500',   text: 'text-pink-400' },
    cyan:   { badge: 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300',   dot: 'bg-cyan-500',   text: 'text-cyan-400' },
    orange: { badge: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300', dot: 'bg-orange-500', text: 'text-orange-400' },
    teal:   { badge: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300',   dot: 'bg-teal-500',   text: 'text-teal-400' },
    indigo: { badge: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300', dot: 'bg-indigo-500', text: 'text-indigo-400' },
};

const fallbackColor = { badge: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400', dot: 'bg-slate-400', text: 'text-slate-400' };

function colorFor(name: string) {
    return COLOR_CLASSES[name] ?? fallbackColor;
}

function formatTime(ts: number): string {
    return new Date(ts * 1000).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function ContainerLogsPage() {
    const navigate = useNavigate();
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [containers, setContainers] = useState<ContainerInfo[]>([]);
    const [activeFilter, setActiveFilter] = useState<string>('all');
    const [search, setSearch] = useState('');
    const [paused, setPaused] = useState(false);
    const [connected, setConnected] = useState(false);
    const [connecting, setConnecting] = useState(true);

    const bottomRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const esRef = useRef<EventSource | null>(null);
    const pausedRef = useRef(false);
    const pendingRef = useRef<LogEntry[]>([]);
    // Track whether the user has manually scrolled up
    const userScrolledRef = useRef(false);

    // Sync paused state into ref so the SSE handler doesn't close over stale state
    useEffect(() => { pausedRef.current = paused; }, [paused]);

    const appendLogs = useCallback((newEntries: LogEntry[]) => {
        setLogs(prev => {
            const next = [...prev, ...newEntries];
            // Cap to last 10,000 lines in the DOM to avoid memory issues
            return next.length > 10_000 ? next.slice(next.length - 10_000) : next;
        });
    }, []);

    // Auto-scroll to bottom when new logs arrive and user hasn't scrolled up
    useEffect(() => {
        if (!paused && !userScrolledRef.current) {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs, paused]);

    const handleScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        userScrolledRef.current = !atBottom;
    }, []);

    // Fetch container list for the sidebar
    useEffect(() => {
        fetch(CONTAINERS_URL)
            .then(r => r.json())
            .then(data => setContainers(data.containers ?? []))
            .catch(() => {});
    }, []);

    // Open SSE stream
    useEffect(() => {
        let reconnecting = false;

        const connect = () => {
            setConnecting(true);
            const es = new EventSource(STREAM_URL);
            esRef.current = es;

            es.onopen = () => {
                // On every (re)connect: clear stale log state so the fresh buffer
                // replay from the server is the single source of truth.
                if (reconnecting) {
                    setLogs([]);
                    pendingRef.current = [];
                    userScrolledRef.current = false;
                }
                reconnecting = true;
                setConnected(true);
                setConnecting(false);
            };

            es.onmessage = (e) => {
                try {
                    const entry = JSON.parse(e.data) as LogEntry;
                    if (pausedRef.current) {
                        pendingRef.current.push(entry);
                    } else {
                        appendLogs([entry]);
                    }
                } catch { /* ignore parse errors */ }
            };

            es.onerror = () => {
                setConnected(false);
                setConnecting(true); // show "connecting" while EventSource auto-retries
            };

            return es;
        };

        const es = connect();

        return () => {
            es.close();
            esRef.current = null;
        };
    }, [appendLogs]);

    const togglePause = () => {
        setPaused(prev => {
            const next = !prev;
            if (!next && pendingRef.current.length > 0) {
                appendLogs(pendingRef.current);
                pendingRef.current = [];
                userScrolledRef.current = false;
            }
            return next;
        });
    };

    const clearLogs = () => {
        setLogs([]);
        pendingRef.current = [];
    };

    const downloadLogs = () => {
        const text = filteredLogs
            .map(e => `[${formatTime(e.ts)}] [${e.container}] ${e.message}`)
            .join('\n');
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `container-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const filteredLogs = logs.filter(e => {
        if (activeFilter !== 'all' && e.container !== activeFilter) return false;
        if (search && !e.message.toLowerCase().includes(search.toLowerCase()) && !e.container.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
    });

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-hidden">

            {/* ── Header ──────────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-6 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate('/settings')}
                        className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 transition-colors"
                    >
                        <ArrowLeft size={16} />
                        Settings
                    </button>
                    <span className="text-slate-300 dark:text-slate-700">/</span>
                    <div className="flex items-center gap-2">
                        <Box size={16} className="text-blue-500" />
                        <span className="font-bold text-slate-800 dark:text-slate-100">Container Logs</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Connection status */}
                    <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-700">
                        {connecting ? (
                            <><Loader2 size={11} className="animate-spin text-slate-400" /><span className="text-slate-400">Connecting…</span></>
                        ) : connected ? (
                            <><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /><span className="text-green-600 dark:text-green-400">Live</span></>
                        ) : (
                            <><WifiOff size={11} className="text-red-400" /><span className="text-red-400">Disconnected</span></>
                        )}
                    </div>

                    <button
                        onClick={togglePause}
                        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium
                            ${paused
                                ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                    >
                        {paused ? <><Play size={12} />Resume{pendingRef.current.length > 0 ? ` (${pendingRef.current.length})` : ''}</> : <><Pause size={12} />Pause</>}
                    </button>

                    <button
                        onClick={downloadLogs}
                        title="Download logs as .txt"
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        <Download size={12} />
                        Download
                    </button>

                    <button
                        onClick={clearLogs}
                        title="Clear log view"
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 hover:border-red-200 transition-colors"
                    >
                        <Trash2 size={12} />
                        Clear
                    </button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">

                {/* ── Sidebar: container list ──────────────────────────────────── */}
                <aside className="w-56 shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col overflow-y-auto">
                    <div className="p-3 border-b border-slate-100 dark:border-slate-800">
                        <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Containers</p>
                    </div>

                    <div className="p-2 flex flex-col gap-1">
                        {/* "All" filter */}
                        <button
                            onClick={() => setActiveFilter('all')}
                            className={`flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg text-sm transition-colors
                                ${activeFilter === 'all'
                                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                                }`}
                        >
                            <Circle size={8} className="fill-slate-400 text-slate-400 shrink-0" />
                            All containers
                        </button>

                        {/* Per-container filters */}
                        {containers.map(c => {
                            const cls = colorFor(c.color);
                            return (
                                <button
                                    key={c.id}
                                    onClick={() => setActiveFilter(c.name)}
                                    className={`flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg text-sm transition-colors
                                        ${activeFilter === c.name
                                            ? 'bg-slate-100 dark:bg-slate-800 font-medium text-slate-800 dark:text-slate-100'
                                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                                        }`}
                                >
                                    <span className={`w-2 h-2 rounded-full shrink-0 ${cls.dot}`} />
                                    <span className="truncate">{c.name}</span>
                                </button>
                            );
                        })}

                        {containers.length === 0 && (
                            <p className="text-xs text-slate-400 dark:text-slate-600 px-3 py-2">No containers detected</p>
                        )}
                    </div>
                </aside>

                {/* ── Main log terminal ────────────────────────────────────────── */}
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

                    {/* Search bar */}
                    <div className="px-4 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Filter logs…"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="w-full pl-8 pr-3 py-1.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-200 placeholder:text-slate-400"
                            />
                        </div>
                    </div>

                    {/* Log output */}
                    <div
                        ref={scrollRef}
                        onScroll={handleScroll}
                        className="flex-1 min-h-0 overflow-y-auto font-mono text-xs bg-slate-950 text-slate-200 p-4 space-y-0.5"
                    >
                        {filteredLogs.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2">
                                <Box size={28} className="opacity-30" />
                                <span className="text-sm">
                                    {connecting ? 'Connecting to Docker…' : 'No log entries yet'}
                                </span>
                            </div>
                        )}

                        {filteredLogs.map((entry, i) => {
                            const cls = colorFor(entry.color);
                            return (
                                <div key={i} className="flex items-start gap-2 hover:bg-slate-900/60 rounded px-1 py-0.5 leading-relaxed">
                                    {/* Timestamp */}
                                    <span className="text-slate-600 shrink-0 select-none w-20">
                                        {formatTime(entry.ts)}
                                    </span>
                                    {/* Container badge */}
                                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none ${cls.badge}`}>
                                        {entry.container}
                                    </span>
                                    {/* Log message */}
                                    <span className="break-all text-slate-300 flex-1">{entry.message}</span>
                                </div>
                            );
                        })}

                        <div ref={bottomRef} />
                    </div>

                    {/* Footer: entry count */}
                    <div className="px-4 py-1.5 bg-slate-950 border-t border-slate-800 text-xs text-slate-600 shrink-0 flex items-center justify-between">
                        <span>{filteredLogs.length.toLocaleString()} {filteredLogs.length === 1 ? 'entry' : 'entries'}{activeFilter !== 'all' ? ` · ${activeFilter}` : ''}</span>
                        {paused && pendingRef.current.length > 0 && (
                            <span className="text-yellow-500">{pendingRef.current.length} buffered while paused</span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
