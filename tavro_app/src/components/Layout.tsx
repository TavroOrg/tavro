import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
    ActivitySquare, Library, Layers, Settings,
    LogOut, Database, RefreshCw, ClipboardList, Zap, MessageCircle, X, Terminal,
    AlertTriangle, ChevronLeft, ChevronRight, FlaskConical, Scale, ShieldCheck,
    AppWindow, BriefcaseBusiness
} from 'lucide-react';
import ChatPanel from './ChatPanel';
import DevLogPanel from './DevLogPanel';
import { useShowLogs } from '../hooks/useShowLogs';
import { useCatalog } from '../context/CatalogContext';
import { useUseCases } from '../context/UseCaseContext';
import { mcpClient } from '../services/mcpClient';
import { Network } from 'lucide-react';
import travoLogo from '../assets/travo_logo.png';

type ActivePanel = 'chat' | 'devlog' | null;

const DEFAULT_PANEL_WIDTH = 400;
const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_WIDTH = 640;

/** Returns a human-readable "X min ago" string, refreshed every 30s. */
function useTimeSince(date: Date | null): string {
    const [, forceUpdate] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        if (!date) return;
        intervalRef.current = setInterval(() => forceUpdate(n => n + 1), 30_000);
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [date]);

    if (!date) return '';
    const secs = Math.floor((Date.now() - date.getTime()) / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
}

const Layout: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [showLogs] = useShowLogs();
    const { loading: catalogLoading, lastFetched, refresh, agents } = useCatalog();
    const { loading: ucLoading, refresh: ucRefresh, useCases } = useUseCases();
    const anyLoading = catalogLoading || ucLoading;
    const timeSince = useTimeSince(lastFetched);

    // ── Cache fallback banner ────────────────────────────────────────────────
    const [cacheFallbackReason, setCacheFallbackReason] = useState<string | null>(null);
    const [dismissedCacheMode, setDismissedCacheMode] = useState(false);
    const [isCacheMode, setIsCacheMode] = useState(
        () => localStorage.getItem('tavro_cache_mode') === 'true'
    );

    useEffect(() => {
        // Listen for remote→local fallback events dispatched by mcpClient
        const onFallback = (e: Event) => {
            const reason = (e as CustomEvent<{ reason: string }>).detail?.reason;
            setCacheFallbackReason(reason || 'Remote cached data unavailable');
        };
        window.addEventListener('tavro:cache_fallback', onFallback);

        // Keep isCacheMode in sync with localStorage changes (e.g. settings page)
        const onStorageChange = () => {
            const newCacheMode = localStorage.getItem('tavro_cache_mode') === 'true';
            setIsCacheMode(newCacheMode);
            // Clear banners if cache mode is turned off
            if (!newCacheMode) {
                setCacheFallbackReason(null);
                setDismissedCacheMode(false);
            }
        };
        window.addEventListener('storage', onStorageChange);
        window.addEventListener('tavro_settings_change', onStorageChange);

        return () => {
            window.removeEventListener('tavro:cache_fallback', onFallback);
            window.removeEventListener('storage', onStorageChange);
            window.removeEventListener('tavro_settings_change', onStorageChange);
        };
    }, []);

    const handleRefreshAll = () => {
        refresh();
        ucRefresh();
    };

    // ── Right panel state ────────────────────────────────────────────────────
    const [activePanel, setActivePanel] = useState<ActivePanel>(null);
    const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);

    // Toggle a panel tab — clicking the same tab again closes the panel
    const togglePanel = (panel: 'chat' | 'devlog') => {
        setActivePanel(prev => (prev === panel ? null : panel));
    };

    // ── Drag-to-resize ───────────────────────────────────────────────────────
    const isDragging = useRef(false);

    const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isDragging.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMouseMove = (ev: MouseEvent) => {
            if (!isDragging.current) return;
            const newWidth = window.innerWidth - ev.clientX;
            const maxRightWidth = window.innerWidth * 0.50; // Right panel can take up to 50% of screen width
            setPanelWidth(Math.max(MIN_PANEL_WIDTH, Math.min(maxRightWidth, newWidth)));
        };

        const onMouseUp = () => {
            isDragging.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }, []);

    // ── Auth ─────────────────────────────────────────────────────────────────
    const handleLogout = () => {
        const idToken = localStorage.getItem('tavro_id_token');
        const issuer = localStorage.getItem('tavro_oidc_issuer') || import.meta.env.VITE_ZITADEL_ISSUER?.replace(/\/$/, '');
        const postLogoutRedirectUri = `${window.location.origin}/login`;

        [
            'tavro_auth', 'tavro_access_token', 'tavro_id_token', 'tavro_raw_access_token',
            'tavro_mcp_refresh_token', 'tavro_pkce_verifier', 'tavro_auth_flow_origin', 'tavro_dcr_client_id',
            'tavro_oidc_provider', 'tavro_oidc_issuer', 'tavro_oidc_client_id', 'tavro_auth_redirect_uri',
            'tavro_oidc_state'
        ].forEach(k => localStorage.removeItem(k));
        // Reset the MCP client session so the next login starts fresh
        mcpClient.disconnect();

        if (issuer && idToken) {
            const logoutUrl = new URL(`${issuer}/oidc/v1/end_session`);
            logoutUrl.searchParams.set('id_token_hint', idToken);
            logoutUrl.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
            window.location.href = logoutUrl.toString();
            return;
        }

        navigate('/login');
    };

    const isPanelOpen = activePanel !== null;
    const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true);

    return (
        <div className="h-screen overflow-hidden flex bg-slate-50 dark:bg-slate-950 transition-colors duration-300">

            {/* ── Left Navigation Sidebar ──────────────────────────────────── */}
            <aside className={`relative bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between sticky top-0 h-screen z-40 flex-shrink-0 transition-all duration-300 ${isLeftPanelOpen ? 'w-[280px]' : 'w-[72px]'}`}>
                <div className={`w-full h-full flex flex-col justify-between overflow-hidden transition-all duration-300`}>
                    <div className="flex flex-col">
                        {/* Logo */}
                        <div
                            className={`flex items-center px-3 py-6 mb-2 cursor-pointer border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all duration-300`}
                            onClick={() => navigate('/')}
                        >
                            <div className="bg-white p-2 rounded-lg shadow-sm flex-shrink-0">
                                <img src={travoLogo} alt="Tavro" className="w-[22px] h-[22px] object-contain" />
                            </div>
                            <span className={`font-bold text-xl tracking-tight text-slate-800 dark:text-white whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>
                                Tavro Agent <span className="text-blue-600">BizOps</span>
                            </span>
                        </div>

                        {/* Nav links */}
                        <div className="flex flex-col p-4 gap-2">
                            <button
                                onClick={() => navigate('/')}
                                className={`flex items-center py-2.5 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname === '/'
                                    ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                title={!isLeftPanelOpen ? "Home" : undefined}
                            >
                                <ActivitySquare size={18} className={`flex-shrink-0 ${location.pathname === '/' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Home</span>
                            </button>

                            <button
                                onClick={() => navigate('/use-cases')}
                                className={`flex items-center py-2.5 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/use-cases') || location.pathname.startsWith('/use-case')
                                    ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                title={!isLeftPanelOpen ? "AI Use Cases" : undefined}
                            >
                                <ClipboardList size={18} className={`flex-shrink-0 ${location.pathname.startsWith('/use-cases') || location.pathname.startsWith('/use-case') ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>AI Use Cases</span>
                            </button>

                            <button
                                onClick={() => navigate('/catalog')}
                                className={`flex items-center py-2.5 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/catalog') || location.pathname.startsWith('/agent')
                                    ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                title={!isLeftPanelOpen ? "Agents" : undefined}
                            >
                                <Library size={18} className={`flex-shrink-0 ${location.pathname.startsWith('/catalog') || location.pathname.startsWith('/agent') ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Agents</span>
                            </button>

                            <button
                                onClick={() => navigate('/applications')}
                                className={`flex items-center py-2.5 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/applications')
                                    ? 'bg-sky-50 dark:bg-sky-600/20 text-sky-700 dark:text-sky-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                title={!isLeftPanelOpen ? "Applications" : undefined}
                            >
                                <AppWindow size={18} className={`flex-shrink-0 ${location.pathname.startsWith('/applications') ? 'text-sky-600 dark:text-sky-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Applications</span>
                            </button>

                            <button
                                onClick={() => navigate('/processes')}
                                className={`flex items-center py-2.5 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/processes')
                                    ? 'bg-emerald-50 dark:bg-emerald-600/20 text-emerald-700 dark:text-emerald-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                title={!isLeftPanelOpen ? "Processes" : undefined}
                            >
                                <BriefcaseBusiness size={18} className={`flex-shrink-0 ${location.pathname.startsWith('/processes') ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Processes</span>
                            </button>

                            <button
                                onClick={() => navigate('/insights')}
                                className={`flex items-center py-2.5 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname === '/insights'
                                    ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                title={!isLeftPanelOpen ? "Insights" : undefined}
                            >
                                <Zap size={18} className={`flex-shrink-0 ${location.pathname === '/insights' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Insights</span>
                            </button>
                            <button
                                onClick={() => navigate('/blueprint')}
                                className={`flex items-center py-2.5 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/blueprint')
                                    ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                                    }`}
                                title={!isLeftPanelOpen ? "Company Blueprint" : undefined}
                            >
                                <Network
                                    size={18}
                                    className={`flex-shrink-0 ${location.pathname.startsWith('/blueprint')
                                        ? 'text-blue-600 dark:text-blue-400'
                                        : 'text-slate-400 dark:text-slate-500'}`}
                                />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Company Blueprint</span>
                            </button>
                            <button
                                onClick={() => navigate('/compliance')}
                                className={`flex items-center py-2.5 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'
                                    } ${location.pathname.startsWith('/compliance')
                                        ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-700 dark:text-indigo-300 shadow-sm'
                                        : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                                    }`}
                                title={!isLeftPanelOpen ? "Compliance" : undefined}
                            >
                                <Scale
                                    size={18}
                                    className={`flex-shrink-0 ${location.pathname.startsWith('/compliance')
                                        ? 'text-indigo-600 dark:text-indigo-400'
                                        : 'text-slate-400 dark:text-slate-500'}`}
                                />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'
                                    }`}>Compliance</span>
                            </button>
                            <button
                                onClick={() => navigate('/audit')}
                                className={`flex items-center py-2.5 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'
                                    } ${location.pathname.startsWith('/audit')
                                        ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-700 dark:text-indigo-300 shadow-sm'
                                        : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                                    }`}
                                title={!isLeftPanelOpen ? "Audit Center" : undefined}
                            >
                                <ShieldCheck
                                    size={18}
                                    className={`flex-shrink-0 ${location.pathname.startsWith('/audit')
                                        ? 'text-indigo-600 dark:text-indigo-400'
                                        : 'text-slate-400 dark:text-slate-500'}`}
                                />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'
                                    }`}>Audit Center</span>
                            </button>
                            <button
                                onClick={() => navigate('/playground')}
                                className={`flex items-center py-2.5 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/playground')
                                    ? 'bg-violet-50 dark:bg-violet-600/20 text-violet-700 dark:text-violet-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                                    }`}
                                title={!isLeftPanelOpen ? "Agent Playground" : undefined}
                            >
                                <FlaskConical
                                    size={18}
                                    className={`flex-shrink-0 ${location.pathname.startsWith('/playground')
                                        ? 'text-violet-600 dark:text-violet-400'
                                        : 'text-slate-400 dark:text-slate-500'}`}
                                />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Agent Playground</span>
                            </button>
                        </div>
                        {/* Catalog Sync Widget */}
                        <div className={`mx-4 mt-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex flex-col gap-2 overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'p-3 max-h-[200px] opacity-100' : 'p-0 max-h-0 opacity-0 border-transparent mt-0'}`}>
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Database size={13} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
                                        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap">
                                            Catalog Sync
                                        </span>
                                    </div>
                                    {anyLoading && (
                                        <RefreshCw size={13} className="text-blue-500 animate-spin" />
                                    )}
                                </div>
                                {!anyLoading && (
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        {agents.length > 0 && (
                                            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                                {agents.length} agents
                                            </span>
                                        )}
                                        {useCases.length > 0 && (
                                            <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                                {useCases.length} use cases
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                            {lastFetched && !catalogLoading && (
                                <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-none whitespace-nowrap">Last synced {timeSince}</p>
                            )}
                            {catalogLoading && (
                                <p className="text-[10px] text-blue-500 dark:text-blue-400 leading-none animate-pulse whitespace-nowrap">Fetching catalog…</p>
                            )}
                            <button
                                onClick={handleRefreshAll}
                                disabled={anyLoading}
                                className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[11px] font-bold text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                <RefreshCw size={11} className={anyLoading ? 'animate-spin flex-shrink-0' : 'flex-shrink-0'} />
                                <span className="whitespace-nowrap">{anyLoading ? 'Syncing…' : 'Refresh Catalog'}</span>
                            </button>
                        </div>
                    </div>

                    {/* Bottom Actions */}
                    <div className={`flex flex-col gap-1 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/70 transition-all duration-300 ${isLeftPanelOpen ? 'p-4' : 'p-2'}`}>
                        <button
                            onClick={() => navigate('/settings')}
                            className={`flex items-center py-2.5 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname === '/settings'
                                ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                : 'bg-transparent text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white'}`}
                            title={!isLeftPanelOpen ? "Settings" : undefined}
                        >
                            <Settings size={18} className={`flex-shrink-0 ${location.pathname === '/settings' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-300'}`} />
                            <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Settings</span>
                        </button>
                        <button
                            onClick={handleLogout}
                            className={`flex items-center py-2.5 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-200 hover:bg-red-50 dark:hover:bg-red-900/25 hover:text-red-600 dark:hover:text-red-300 transition-all w-full mt-2 group outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'}`}
                            title={!isLeftPanelOpen ? "Sign Out" : undefined}
                        >
                            <LogOut size={18} className="flex-shrink-0 text-slate-400 dark:text-slate-300 group-hover:text-red-500 dark:group-hover:text-red-300 transition-colors" />
                            <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Sign Out</span>
                        </button>
                    </div>
                </div>

                {/* Left Panel Toggle Button */}
                <button
                    onClick={() => setIsLeftPanelOpen(!isLeftPanelOpen)}
                    className="absolute -right-3.5 top-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-blue-600 rounded-full p-1 shadow-sm z-50 transition-colors outline-none"
                    title={isLeftPanelOpen ? "Collapse sidebar" : "Expand sidebar"}
                >
                    {isLeftPanelOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
                </button>
            </aside>

            {/* ── Main Content Area ─────────────────────────────────────────── */}
            <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">

                {/* ── Cached Data Mode Banner ─────────────────────────────── */}
                {isCacheMode && !dismissedCacheMode && (
                    <div className="flex items-center gap-3 px-5 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs font-medium flex-shrink-0">
                        <Database size={13} className="text-amber-500 flex-shrink-0" />
                        <span>
                            <span className="font-bold">Cached Data Mode</span> is active — displaying data from
                            {cacheFallbackReason ? ' local bundled cache (remote source unavailable)' : ' cached source'}.
                            {' '}Live MCP calls are disabled.
                        </span>
                        <div className="ml-auto flex items-center gap-3">
                            <button
                                onClick={() => navigate('/settings')}
                                className="text-amber-700 underline underline-offset-2 hover:text-amber-900 transition-colors whitespace-nowrap"
                            >
                                Settings
                            </button>
                            <button
                                onClick={() => setDismissedCacheMode(true)}
                                className="text-amber-600 hover:text-amber-900 transition-colors flex-shrink-0"
                                title="Dismiss"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Remote Cache Fallback Warning Banner ────────────────── */}
                {cacheFallbackReason && (
                    <div className="flex items-start gap-3 px-5 py-3 bg-orange-50 border-b border-orange-200 text-orange-800 text-xs flex-shrink-0">
                        <AlertTriangle size={14} className="text-orange-500 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                            <span className="font-bold">Remote cache unavailable — using local bundled data.</span>
                            <span className="text-orange-700 ml-1">Reason: {cacheFallbackReason}</span>
                        </div>
                        <button
                            onClick={() => setCacheFallbackReason(null)}
                            className="ml-2 text-orange-500 hover:text-orange-700 transition-colors flex-shrink-0"
                            title="Dismiss"
                        >
                            <X size={14} />
                        </button>
                    </div>
                )}

                <div className="p-8 w-full max-w-[1600px] mx-auto flex-1">
                    <Outlet />
                </div>
                <footer className="border-t border-slate-200 dark:border-slate-800 py-6 text-center text-xs text-slate-400 dark:text-slate-500 mt-auto bg-white dark:bg-slate-900 transition-colors">
                    © 2026 Tavro AI.
                </footer>
            </main>

            {/* ── Right Panel ───────────────────────────────────────────────── */}
            <div
                className={`flex-shrink-0 flex flex-col h-screen sticky top-0 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 transition-all duration-300 ease-in-out`}
                style={{ width: isPanelOpen ? `${panelWidth}px` : '72px' }}
            >
                {!isPanelOpen ? (
                    <div className="flex flex-col items-center py-6 gap-4 w-full h-full">
                        <button
                            onClick={() => setActivePanel('chat')}
                            className="p-3 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors shadow-sm border border-transparent hover:border-blue-100 dark:hover:border-slate-700 outline-none"
                            title="AI Assistant"
                        >
                            <MessageCircle size={22} />
                        </button>
                        {showLogs && (
                            <button
                                onClick={() => setActivePanel('devlog')}
                                className="p-3 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors shadow-sm border border-transparent hover:border-blue-100 dark:hover:border-slate-700 outline-none"
                                title="Dev Logs"
                            >
                                <Terminal size={22} />
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="flex h-full w-full">
                        {/* Drag Handle */}
                        <div
                            onMouseDown={handleResizeMouseDown}
                            className="w-1.5 flex-shrink-0 h-full cursor-col-resize bg-slate-200 hover:bg-blue-400 active:bg-blue-500 transition-colors relative group"
                            title="Drag to resize"
                        >
                            {/* Collapse Button */}
                            <button
                                onMouseDown={(e) => e.stopPropagation()} // prevent drag
                                onClick={() => setActivePanel(null)} // fold it
                                className="absolute -left-3.5 top-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-blue-600 rounded-full p-1 shadow-sm z-50 transition-opacity opacity-0 group-hover:opacity-100 outline-none"
                                title="Close panel"
                            >
                                <ChevronRight size={16} />
                            </button>
                            {/* Visual grip dots */}
                            <div className="absolute inset-y-0 left-0 right-0 flex flex-col items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                {[...Array(5)].map((_, i) => (
                                    <span key={i} className="w-0.5 h-0.5 rounded-full bg-white" />
                                ))}
                            </div>
                        </div>

                        {/* Panel Content */}
                        <div className="flex-1 flex flex-col h-full bg-white dark:bg-slate-900 overflow-hidden transition-colors">
                            {/* Tab bar */}
                            <div className="flex items-center border-b border-slate-200 bg-slate-50 flex-shrink-0">
                                {/* Chat tab */}
                                <button
                                    onClick={() => setActivePanel('chat')}
                                    className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${activePanel === 'chat'
                                        ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900'
                                        : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                                >
                                    <MessageCircle size={14} />
                                    AI Assistant
                                </button>

                                {/* DevLog tab — show logs setting only */}
                                {showLogs && (
                                    <button
                                        onClick={() => setActivePanel('devlog')}
                                        className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${activePanel === 'devlog'
                                            ? 'border-blue-500 text-blue-600 bg-white'
                                            : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100'}`}
                                    >
                                        <Terminal size={14} />
                                        Dev Logs
                                    </button>
                                )}

                                {/* Spacer + Close */}
                                <div className="flex-1" />
                                <button
                                    onClick={() => setActivePanel(null)}
                                    className="p-2 mx-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                                    title="Close panel"
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            {/* Panel body */}
                            <div className="flex-1 overflow-hidden">
                                {activePanel === 'chat' && <ChatPanel onClose={() => setActivePanel(null)} />}
                                {activePanel === 'devlog' && showLogs && <DevLogPanel />}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Layout;
