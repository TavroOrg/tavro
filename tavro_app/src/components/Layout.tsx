import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
    Home, Bot, Workflow, BarChart2, Settings,
    LogOut, Database, RefreshCw, ClipboardList, MessageCircle, X, Terminal,
    AlertTriangle, ChevronLeft, ChevronRight, FlaskConical, Scale, ShieldCheck,
    AppWindow, BriefcaseBusiness, Paperclip, Network
} from 'lucide-react';
import ChatPanel from './ChatPanel';
import DevLogPanel from './DevLogPanel';
import AttachmentPanel from './AttachmentPanel';
import { useShowLogs } from '../hooks/useShowLogs';
import { useCatalog } from '../context/CatalogContext';
import { useUseCases } from '../context/UseCaseContext';
import { useBlueprint } from '../context/BlueprintContext';
const TAVRO_VERSION = 'v.3.1';
import { mcpClient } from '../services/mcpClient';
import { clearAllSessions } from '../store/chatSessionStore';

import travoLogo from '../assets/travo_logo.png';

type ActivePanel = 'chat' | 'devlog' | 'attachment' | null;

/** Check if current route is an agent view page */
function isAgentPage(pathname: string): boolean {
    return /^\/agent\//.test(pathname);
}

/** Check if current route is an AI use case view page */
function isUseCasePage(pathname: string): boolean {
    return /^\/use-case\//.test(pathname);
}

/** Check if current route is an application view page */
function isApplicationPage(pathname: string): boolean {
    return /^\/applications\/(?!new$)/.test(pathname);
}

/** Check if current route is a process view page */
function isProcessPage(pathname: string): boolean {
    return /^\/processes\/(?!new$)/.test(pathname);
}

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
    const { activeCompany } = useBlueprint();
    const anyLoading = catalogLoading || ucLoading;
    const timeSince = useTimeSince(lastFetched);

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

    // Once the Chat tab is opened, keep ChatPanel mounted (hidden) on tab
    // switches so that in-progress streams keep updating state normally.
    const chatEverOpenedRef = useRef(false);
    if (activePanel === 'chat') chatEverOpenedRef.current = true;

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
        // Clear persisted chat sessions and reset MCP client
        clearAllSessions();
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
    const isOnAgentPage = isAgentPage(location.pathname);
    const isOnUseCasePage = isUseCasePage(location.pathname);
    const isOnApplicationPage = isApplicationPage(location.pathname);
    const isOnProcessPage = isProcessPage(location.pathname);
    const isOnAttachmentPage = isOnAgentPage || isOnUseCasePage || isOnApplicationPage || isOnProcessPage;

    useEffect(() => {
        const rightRailWidth = isPanelOpen ? panelWidth : 72;
        const leftRailWidth = isLeftPanelOpen ? 280 : 72;
        document.documentElement.style.setProperty('--tavro-left-rail-width', `${leftRailWidth}px`);
        document.documentElement.style.setProperty('--tavro-right-rail-width', `${rightRailWidth}px`);
        return () => {
            document.documentElement.style.setProperty('--tavro-left-rail-width', '280px');
            document.documentElement.style.setProperty('--tavro-right-rail-width', '72px');
        };
    }, [isLeftPanelOpen, isPanelOpen, panelWidth]);

    return (
        <div className="h-screen overflow-hidden flex bg-slate-50 dark:bg-slate-950 transition-colors duration-300">

            {/* ── Left Navigation Sidebar ──────────────────────────────────── */}
            <aside className={`relative bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col sticky top-0 h-screen z-40 flex-shrink-0 overflow-visible transition-all duration-300 ${isLeftPanelOpen ? 'w-[280px]' : 'w-[72px]'}`}>
                {/* Logo */}
                <div
                    className={`flex items-center px-3 py-6 mb-2 cursor-pointer border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all duration-300 flex-shrink-0`}
                    onClick={() => navigate('/')}
                >
                        <div className="bg-white p-2 rounded-lg shadow-sm flex-shrink-0">
                            <img src={travoLogo} alt="Tavro" className="w-[22px] h-[22px] object-contain" />
                        </div>
                        <span className={`font-bold text-xl tracking-tight text-slate-800 dark:text-white whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>
                            Tavro Agent <span className="text-blue-600">BizOps</span>
                        </span>
                </div>

                <div className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden transition-all duration-300`}>
                    {/* Scrollable nav area */}
                    <div className="flex flex-col">
                        {/* Nav links */}
                        <div className="flex flex-col p-4 gap-2">
                            <button
                                onClick={() => navigate('/')}
                                className={`flex items-center py-2.5 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname === '/'
                                    ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                title={!isLeftPanelOpen ? "Home" : undefined}
                            >
                                <Home size={18} className={`flex-shrink-0 ${location.pathname === '/' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
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
                                <Bot size={18} className={`flex-shrink-0 ${location.pathname.startsWith('/catalog') || location.pathname.startsWith('/agent') ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Agents</span>
                            </button>

                            <button
                                onClick={() => navigate('/applications')}
                                className={`flex items-center py-2.5 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/applications')
                                    ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                title={!isLeftPanelOpen ? "Applications" : undefined}
                            >
                                <AppWindow size={18} className={`flex-shrink-0 ${location.pathname.startsWith('/applications') ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Applications</span>
                            </button>

                            <button
                                onClick={() => navigate('/processes')}
                                className={`flex items-center py-2.5 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/processes')
                                    ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                title={!isLeftPanelOpen ? "Processes" : undefined}
                            >
                                <Workflow size={18} className={`flex-shrink-0 ${location.pathname.startsWith('/processes') ? 'text-blue-700 dark:text-blue-300' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Processes</span>
                            </button>

                            <button
                                onClick={() => navigate('/insights')}
                                className={`flex items-center py-2.5 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname === '/insights'
                                    ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                title={!isLeftPanelOpen ? "Insights" : undefined}
                            >
                                <BarChart2 size={18} className={`flex-shrink-0 ${location.pathname === '/insights' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
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
                                        ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                        : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                                    }`}
                                title={!isLeftPanelOpen ? "Compliance" : undefined}
                            >
                                <Scale
                                    size={18}
                                    className={`flex-shrink-0 ${location.pathname.startsWith('/compliance')
                                        ? 'text-blue-600 dark:text-blue-400'
                                        : 'text-slate-400 dark:text-slate-500'}`}
                                />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'
                                    }`}>Compliance</span>
                            </button>
                            <button
                                onClick={() => navigate('/audit')}
                                className={`flex items-center py-2.5 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'
                                    } ${location.pathname.startsWith('/audit')
                                        ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                        : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                                    }`}
                                title={!isLeftPanelOpen ? "Audit Center" : undefined}
                            >
                                <ShieldCheck
                                    size={18}
                                    className={`flex-shrink-0 ${location.pathname.startsWith('/audit')
                                        ? 'text-blue-600 dark:text-blue-400'
                                        : 'text-slate-400 dark:text-slate-500'}`}
                                />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'
                                    }`}>Audit Center</span>
                            </button>
                            <button
                                onClick={() => navigate('/playground')}
                                className={`flex items-center py-2.5 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/playground')
                                    ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                                    }`}
                                title={!isLeftPanelOpen ? "Agent Playground" : undefined}
                            >
                                <FlaskConical
                                    size={18}
                                    className={`flex-shrink-0 ${location.pathname.startsWith('/playground')
                                        ? 'text-blue-600 dark:text-blue-400'
                                        : 'text-slate-400 dark:text-slate-500'}`}
                                />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Agent Playground</span>
                            </button>
                        </div>
                    </div>{/* end scrollable nav */}

                    {/* Catalog Sync Widget - pinned */}
                    <div className={`mx-4 mt-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex flex-col gap-2 overflow-hidden transition-all duration-300 flex-shrink-0 ${isLeftPanelOpen ? 'p-3 max-h-[200px] opacity-100' : 'p-0 max-h-0 opacity-0 border-transparent mt-0'}`}>
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
                                        <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                            {agents.length} agents
                                        </span>
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

                    {/* Bottom Actions */}
                    <div className={`flex flex-col gap-1 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/70 transition-all duration-300 flex-shrink-0 ${isLeftPanelOpen ? 'p-4' : 'p-2'}`}>
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
                    className="absolute -right-3.5 top-7 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-blue-600 rounded-full p-1.5 shadow-md z-[60] transition-colors outline-none"
                    title={isLeftPanelOpen ? "Collapse sidebar" : "Expand sidebar"}
                >
                    {isLeftPanelOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
                </button>
            </aside>

            {/* ── Main Content Area ─────────────────────────────────────────── */}
            <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">

<div className="p-8 w-full max-w-[1600px] mx-auto flex-1">
                    <Outlet />
                </div>
                <footer className="border-t border-slate-200 dark:border-slate-800 py-4 px-6 text-xs text-slate-600 dark:text-slate-400 mt-auto bg-white dark:bg-slate-900 transition-colors flex items-center justify-between">
                    <span>Tavro {TAVRO_VERSION}</span>
                    <span>{activeCompany?.name ?? '—'}</span>
                    <span>© 2026 Tavro AI.</span>
                </footer>
            </main>

            {/* ── Right Panel ───────────────────────────────────────────────── */}
            <div
                className={`flex-shrink-0 flex flex-col h-screen sticky top-0 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 transition-all duration-300 ease-in-out`}
                style={{ width: isPanelOpen ? `${panelWidth}px` : '72px' }}
            >
                {!isPanelOpen ? (
                    <div className="flex flex-col items-center py-6 gap-3 w-full h-full">
                        <button
                            onClick={() => setActivePanel('chat')}
                            className="flex flex-col items-center gap-1.5 p-3 w-14 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors shadow-sm border border-slate-100 dark:border-slate-700 hover:border-blue-200 dark:hover:border-blue-700 outline-none"
                            title="AI Assistant"
                        >
                            <MessageCircle size={26} />
                            <span className="text-[9px] font-semibold leading-none">Chat</span>
                        </button>
                        {showLogs && (
                            <button
                                onClick={() => setActivePanel('devlog')}
                                className="flex flex-col items-center gap-1.5 p-3 w-14 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors shadow-sm border border-slate-100 dark:border-slate-700 hover:border-blue-200 dark:hover:border-blue-700 outline-none"
                                title="Dev Logs"
                            >
                                <Terminal size={26} />
                                <span className="text-[9px] font-semibold leading-none">Logs</span>
                            </button>
                        )}
                        {isOnAttachmentPage && (
                            <button
                                onClick={() => setActivePanel('attachment')}
                                className="p-3 rounded-xl text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-slate-800 transition-colors shadow-sm border border-transparent hover:border-amber-100 dark:hover:border-slate-700 outline-none"
                                title="Attachments"
                            >
                                <Paperclip size={22} />
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
                                            ? 'border-blue-500 text-blue-600 bg-white dark:bg-slate-900'
                                            : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                                    >
                                        <Terminal size={14} />
                                        Dev Logs
                                    </button>
                                )}

                                {/* Attachment tab — show on agent, use case, application, and process pages */}
                                {isOnAttachmentPage && (
                                    <button
                                        onClick={() => setActivePanel('attachment')}
                                        className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${activePanel === 'attachment'
                                            ? 'border-amber-500 text-amber-600 bg-white dark:bg-slate-900'
                                            : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                                    >
                                        <Paperclip size={14} />
                                        Attachments
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
                                {/* Keep ChatPanel mounted (hidden) once opened so that
                                    in-progress streams keep updating state when the user
                                    switches to Dev Logs. Avoid mounting before chat is ever
                                    opened so the resume effect doesn't fire prematurely. */}
                                {(activePanel === 'chat' || chatEverOpenedRef.current) && isPanelOpen && (
                                    <div className={`h-full flex flex-col ${activePanel !== 'chat' ? 'hidden' : ''}`}>
                                        <ChatPanel onClose={() => setActivePanel(null)} />
                                    </div>
                                )}
                                {activePanel === 'devlog' && showLogs && <DevLogPanel />}
                                {activePanel === 'attachment' && isOnAttachmentPage && (
                                    <AttachmentPanel
                                        entityType={
                                            isOnUseCasePage
                                                ? 'use_case'
                                                : isOnApplicationPage
                                                    ? 'application'
                                                    : isOnProcessPage
                                                        ? 'process'
                                                        : 'agent'
                                        }
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Layout;

