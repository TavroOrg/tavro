import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
    Bot, Workflow, BarChart2, Settings,
    LogOut, ClipboardList, MessageCircle, X, Terminal,
    ChevronLeft, ChevronRight, FlaskConical, Scale, ShieldCheck,
    AppWindow, Paperclip, Network, Zap, Plug, CircleHelp,
    Map, TestTube2, Shield, AlertTriangle, Boxes, Lock, Unlock
} from 'lucide-react';
import ChatPanel from './ChatPanel';
import DevLogPanel from './DevLogPanel';
import AttachmentPanel from './AttachmentPanel';
import TimedInfoToast from './TimedInfoToast';
import { useShowLogs } from '../hooks/useShowLogs';
import { useCatalog } from '../context/CatalogContext';
import { useUseCases } from '../context/UseCaseContext';
import { useBlueprint } from '../context/BlueprintContext';
import { useEnterprise } from '../context/EnterpriseContext';
import { businessRelationsApi } from '../services/businessRelationsApi';
import { aiModelApi } from '../services/aiModelApi';
import { agentApi } from '../services/agentApi';
import { useCaseApi } from '../services/useCaseApi';
import { sparkApi } from '../services/sparkApi';
import { portalActivity } from '../services/portalActivity';
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


function LockedNavItem({
    icon,
    label,
    badge,
    isOpen,
    showTooltip,
}: {
    icon: React.ReactNode;
    label: string;
    badge: string;
    isOpen: boolean;
    showTooltip: boolean;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);

    const handleEnter = () => {
        if (!showTooltip || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        setTooltipPos({ top: r.top + r.height / 2, left: r.right });
    };

    return (
        <div
            ref={ref}
            onMouseEnter={handleEnter}
            onMouseLeave={() => setTooltipPos(null)}
            className={`flex items-center py-1 rounded-lg text-sm font-medium w-full cursor-default select-none ${isOpen ? 'px-3' : 'px-0 justify-center'}`}
        >
            {icon}
            <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 text-slate-400 dark:text-slate-600 ${isOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>
                {label}
            </span>
            {isOpen && (
                showTooltip
                    ? <Lock size={13} className="ml-auto flex-shrink-0 text-slate-400 dark:text-slate-400" />
                    : <span className="ml-auto text-[10px] font-semibold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-full whitespace-nowrap">{badge}</span>
            )}
            {tooltipPos && createPortal(
                <div
                    style={{ position: 'fixed', top: tooltipPos.top, left: tooltipPos.left + 12, transform: 'translateY(-50%)', zIndex: 9999 }}
                    className="px-3 py-2 bg-slate-800 text-white text-xs rounded-lg whitespace-nowrap shadow-lg pointer-events-none"
                >
                    This feature requires enterprise plan
                    <div className="absolute right-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-r-slate-800" />
                </div>,
                document.body
            )}
        </div>
    );
}

const Layout: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [showLogs] = useShowLogs();
    useCatalog();
    useUseCases();
    const { activeCompany } = useBlueprint();
    const { enterpriseEnabled } = useEnterprise();
    const [appCount, setAppCount] = useState(0);
    const [processCount, setProcessCount] = useState(0);
    const [integrationCount, setIntegrationCount] = useState(0);
    const [aiModelCount, setAiModelCount] = useState(0);
    const [agentCount, setAgentCount] = useState(0);
    const [useCaseCount, setUseCaseCount] = useState(0);
    const [sparkCount, setSparkCount] = useState(0);

    const fetchCatalogCounts = useCallback(() => {
        const companyId = activeCompany?.id;
        Promise.allSettled([
            businessRelationsApi.countApplications(companyId),
            businessRelationsApi.countProcesses(companyId),
            businessRelationsApi.countIntegrations(companyId),
            aiModelApi.listModels(undefined, companyId),
            agentApi.countAgents(companyId),
            useCaseApi.countUseCases(companyId),
        ]).then(([apps, processes, integrations, models, agents, useCases]) => {
            if (apps.status === 'fulfilled') setAppCount(apps.value);
            if (processes.status === 'fulfilled') setProcessCount(processes.value);
            if (integrations.status === 'fulfilled') setIntegrationCount(integrations.value);
            if (models.status === 'fulfilled') setAiModelCount(models.value.length);
            if (agents.status === 'fulfilled') setAgentCount(agents.value);
            if (useCases.status === 'fulfilled') setUseCaseCount(useCases.value);
        });
        if (companyId) {
            sparkApi.getIdeas(companyId).then(ideas => setSparkCount(ideas.length)).catch(() => {});
        }
    }, [activeCompany]);

    useEffect(() => {
        fetchCatalogCounts();
        const onSparkChanged = (e: Event) => setSparkCount((e as CustomEvent).detail?.count ?? 0);
        window.addEventListener('tavro:catalog-item-changed', fetchCatalogCounts);
        window.addEventListener('tavro:spark-ideas-changed', onSparkChanged);
        return () => {
            window.removeEventListener('tavro:catalog-item-changed', fetchCatalogCounts);
            window.removeEventListener('tavro:spark-ideas-changed', onSparkChanged);
        };
    }, [fetchCatalogCounts]);

    useEffect(() => {
        const useCaseCreated = (event: Event) => {
            const detail = (event as CustomEvent).detail ?? {};
            const name = detail.name || detail.title || detail.use_case_name || detail.use_case_id || 'AI use case';
            portalActivity.record(`Created AI use case: ${name}`, 'emerald');
        };
        const agentCreated = (event: Event) => {
            const detail = (event as CustomEvent).detail ?? {};
            const agent = detail.agent ?? detail.result ?? detail;
            const args = detail.args ?? {};
            const name = args.agent_name || agent.agent_name || agent.name || agent.agent_id || 'agent';
            portalActivity.record(`Created agent: ${name}`, 'emerald');
        };
        const agentArtifactsGenerated = (event: Event) => {
            const detail = (event as CustomEvent).detail ?? {};
            const agent = detail.agent ?? detail;
            const name = agent.agent_name || agent.name || agent.agent_id || 'agent';
            portalActivity.record(`Generated artifacts for ${name}`, 'amber');
        };

        window.addEventListener('tavro:usecase-created', useCaseCreated);
        window.addEventListener('tavro:agent-created', agentCreated);
        window.addEventListener('tavro:agent-artifacts-generated', agentArtifactsGenerated);
        return () => {
            window.removeEventListener('tavro:usecase-created', useCaseCreated);
            window.removeEventListener('tavro:agent-created', agentCreated);
            window.removeEventListener('tavro:agent-artifacts-generated', agentArtifactsGenerated);
        };
    }, []);

    // ── Right panel state ────────────────────────────────────────────────────
    const [activePanel, setActivePanel] = useState<ActivePanel>(null);
    const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);

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
            'tavro_mcp_refresh_token', 'tavro_mcp_access_token', 'tavro_tenant_id',
            'tavro_pkce_verifier', 'tavro_auth_flow_origin', 'tavro_dcr_client_id',
            'tavro_oidc_provider', 'tavro_oidc_issuer', 'tavro_oidc_client_id', 'tavro_auth_redirect_uri',
            'tavro_oidc_state', 'tavro_last_activity_at'
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
            {/* Global artifact-ready notification — appears centered at top of viewport */}
            <TimedInfoToast storageKey="tavro_artifacts_notice" position="center" durationMs={8000} />

            {/* ── Left Navigation Sidebar ──────────────────────────────────── */}
            <aside className={`relative bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col sticky top-0 h-screen z-40 flex-shrink-0 overflow-visible transition-all duration-300 ${isLeftPanelOpen ? 'w-[280px]' : 'w-[72px]'}`}>
                {/* Logo */}
                <div
                    className={`flex items-center px-3 py-4 mb-1 cursor-pointer border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all duration-300 flex-shrink-0`}
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
                        <div className="flex flex-col px-3 pt-3 pb-2 gap-0.5">

                            {/* Insights */}
                            <button
                                onClick={() => navigate('/insights')}
                                className={`flex items-center py-1 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname === '/insights'
                                    ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                title={!isLeftPanelOpen ? "Insights" : undefined}
                            >
                                <BarChart2 size={16} className={`flex-shrink-0 ${location.pathname === '/insights' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Insights</span>
                            </button>

                            <hr className="border-slate-100 dark:border-slate-800 mx-1 my-1" />

                            {/* ── BLUEPRINT ── */}
                            {isLeftPanelOpen && <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-3 pb-0.5">Blueprint</p>}
                            <button
                                onClick={() => navigate('/blueprint')}
                                className={`flex items-center py-1 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/blueprint')
                                    ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                title={!isLeftPanelOpen ? "Company Profile" : undefined}
                            >
                                <Network size={16} className={`flex-shrink-0 ${location.pathname.startsWith('/blueprint') ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Company Profile</span>
                            </button>
                            <button
                                onClick={() => navigate('/applications')}
                                className={`flex items-center py-1 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/applications')
                                    ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                title={!isLeftPanelOpen ? "Applications" : undefined}
                            >
                                <AppWindow size={16} className={`flex-shrink-0 ${location.pathname.startsWith('/applications') ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[160px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Applications</span>
                                {isLeftPanelOpen && appCount > 0 && (
                                    <span className="ml-auto text-[10px] font-semibold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800 px-1.5 py-0.5 rounded-full whitespace-nowrap">{appCount} {appCount === 1 ? 'app' : 'apps'}</span>
                                )}
                            </button>
                            <button
                                onClick={() => navigate('/processes')}
                                className={`flex items-center py-1 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/processes')
                                    ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                title={!isLeftPanelOpen ? "Processes" : undefined}
                            >
                                <Workflow size={16} className={`flex-shrink-0 ${location.pathname.startsWith('/processes') ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[160px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Processes</span>
                                {isLeftPanelOpen && processCount > 0 && (
                                    <span className="ml-auto text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 px-1.5 py-0.5 rounded-full whitespace-nowrap">{processCount} {processCount === 1 ? 'process' : 'processes'}</span>
                                )}
                            </button>
                            <button
                                onClick={() => navigate('/integrations')}
                                className={`flex items-center py-1 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/integrations')
                                    ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                title={!isLeftPanelOpen ? "Integrations" : undefined}
                            >
                                <Plug size={16} className={`flex-shrink-0 ${location.pathname.startsWith('/integrations') ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[160px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Integrations</span>
                                {isLeftPanelOpen && integrationCount > 0 && (
                                    <span className="ml-auto text-[10px] font-semibold text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/20 border border-teal-100 dark:border-teal-800 px-1.5 py-0.5 rounded-full whitespace-nowrap">{integrationCount} {integrationCount === 1 ? 'integration' : 'integrations'}</span>
                                )}
                            </button>
                            <button
                                onClick={() => navigate('/ai-models')}
                                className={`flex items-center py-1 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/ai-models')
                                    ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                title={!isLeftPanelOpen ? "AI Models" : undefined}
                            >
                                <Boxes size={16} className={`flex-shrink-0 ${location.pathname.startsWith('/ai-models') ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[160px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>AI Models</span>
                                {isLeftPanelOpen && aiModelCount > 0 && (
                                    <span className="ml-auto text-[10px] font-semibold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/20 border border-sky-100 dark:border-sky-800 px-1.5 py-0.5 rounded-full whitespace-nowrap">{aiModelCount} {aiModelCount === 1 ? 'model' : 'models'}</span>
                                )}
                            </button>
                            <hr className="border-slate-100 dark:border-slate-800 mx-1 my-1" />
                            {enterpriseEnabled ? (
                                <button
                                    onClick={() => navigate('/roadmap')}
                                    className={`flex items-center py-1 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/roadmap')
                                        ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                        : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                    title={!isLeftPanelOpen ? 'Roadmap' : undefined}
                                >
                                    <Map size={16} className={`flex-shrink-0 ${location.pathname.startsWith('/roadmap') ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                    <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Roadmap</span>
                                    {isLeftPanelOpen && <Unlock size={13} className="ml-auto flex-shrink-0 text-slate-400 dark:text-slate-400" />}
                                </button>
                            ) : (
                                <LockedNavItem
                                    icon={<Map size={16} className="flex-shrink-0 text-slate-300 dark:text-slate-600" />}
                                    label="Roadmap"
                                    badge="Enterprise"
                                    isOpen={isLeftPanelOpen}
                                    showTooltip={true}
                                />
                            )}

                            <hr className="border-slate-100 dark:border-slate-800 mx-1 my-1" />

                            {/* Spark */}
                            <button
                                onClick={() => navigate('/spark')}
                                className={`flex items-center py-1 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/spark')
                                    ? 'bg-violet-50 dark:bg-violet-600/20 text-violet-700 dark:text-violet-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                title={!isLeftPanelOpen ? "Spark" : undefined}
                            >
                                <Zap size={16} className={`flex-shrink-0 ${location.pathname.startsWith('/spark') ? 'text-violet-600 dark:text-violet-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Spark</span>
                                {isLeftPanelOpen && sparkCount > 0 && (
                                    <span className="ml-auto text-[10px] font-semibold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800 px-1.5 py-0.5 rounded-full whitespace-nowrap">{sparkCount} {sparkCount === 1 ? 'idea' : 'ideas'}</span>
                                )}
                            </button>

                            <hr className="border-slate-100 dark:border-slate-800 mx-1 my-1" />

                            {/* ── PLAN ── */}
                            {isLeftPanelOpen && <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-3 pb-0.5">Plan</p>}
                            <button
                                onClick={() => navigate('/use-cases')}
                                className={`flex items-center py-1 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/use-cases') || location.pathname.startsWith('/use-case')
                                    ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                title={!isLeftPanelOpen ? "AI Use Cases" : undefined}
                            >
                                <ClipboardList size={16} className={`flex-shrink-0 ${location.pathname.startsWith('/use-cases') || location.pathname.startsWith('/use-case') ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[160px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>AI Use Case</span>
                                {isLeftPanelOpen && useCaseCount > 0 && (
                                    <span className="ml-auto text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 px-1.5 py-0.5 rounded-full whitespace-nowrap">{useCaseCount} {useCaseCount === 1 ? 'case' : 'cases'}</span>
                                )}
                            </button>
                            <button
                                onClick={() => navigate('/catalog')}
                                className={`flex items-center py-1 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/catalog') || location.pathname.startsWith('/agent')
                                    ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                title={!isLeftPanelOpen ? "Agents" : undefined}
                            >
                                <Bot size={16} className={`flex-shrink-0 ${location.pathname.startsWith('/catalog') || location.pathname.startsWith('/agent') ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[160px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Agents</span>
                                {isLeftPanelOpen && agentCount > 0 && (
                                    <span className="ml-auto text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 px-1.5 py-0.5 rounded-full whitespace-nowrap">{agentCount} {agentCount === 1 ? 'agent' : 'agents'}</span>
                                )}
                            </button>

                            <hr className="border-slate-100 dark:border-slate-800 mx-1 my-1" />

                            {/* ── BUILD ── */}
                            {isLeftPanelOpen && <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-3 pb-0.5">Build</p>}
                            <button
                                onClick={() => navigate('/playground')}
                                className={`flex items-center py-1 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/playground')
                                    ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                    : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                title={!isLeftPanelOpen ? "Agent Playground" : undefined}
                            >
                                <FlaskConical size={16} className={`flex-shrink-0 ${location.pathname.startsWith('/playground') ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Agent playground</span>
                            </button>
                            {enterpriseEnabled ? (
                                <button
                                    onClick={() => navigate('/agent-evals')}
                                    className={`flex items-center py-1 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/agent-evals')
                                        ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                        : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                    title={!isLeftPanelOpen ? 'Agent evals' : undefined}
                                >
                                    <TestTube2 size={16} className={`flex-shrink-0 ${location.pathname.startsWith('/agent-evals') ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                    <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Agent evals</span>
                                    {isLeftPanelOpen && <Unlock size={13} className="ml-auto flex-shrink-0 text-slate-400 dark:text-slate-400" />}
                                </button>
                            ) : (
                                <LockedNavItem
                                    icon={<TestTube2 size={16} className="flex-shrink-0 text-slate-300 dark:text-slate-600" />}
                                    label="Agent evals"
                                    badge="Enterprise"
                                    isOpen={isLeftPanelOpen}
                                    showTooltip={true}
                                />
                            )}

                            <hr className="border-slate-100 dark:border-slate-800 mx-1 my-1" />

                            {/* ── GOVERN ── */}
                            {isLeftPanelOpen && <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-3 pb-0.5">Govern</p>}

                            {/* Guardrails */}
                            {enterpriseEnabled ? (
                                <button
                                    onClick={() => navigate('/guardrails')}
                                    className={`flex items-center py-1 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/guardrails')
                                        ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                        : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                    title={!isLeftPanelOpen ? 'Guardrails' : undefined}
                                >
                                    <Shield size={16} className={`flex-shrink-0 ${location.pathname.startsWith('/guardrails') ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                    <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Guardrails</span>
                                    {isLeftPanelOpen && <Unlock size={13} className="ml-auto flex-shrink-0 text-slate-400 dark:text-slate-400" />}
                                </button>
                            ) : (
                                <LockedNavItem
                                    icon={<Shield size={16} className="flex-shrink-0 text-slate-300 dark:text-slate-600" />}
                                    label="Guardrails"
                                    badge="Enterprise"
                                    isOpen={isLeftPanelOpen}
                                    showTooltip={true}
                                />
                            )}

                            {/* Compliance */}
                            {enterpriseEnabled ? (
                                <button
                                    onClick={() => navigate('/compliance')}
                                    className={`flex items-center py-1 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/compliance')
                                        ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                        : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                    title={!isLeftPanelOpen ? "Compliance" : undefined}
                                >
                                    <Scale size={16} className={`flex-shrink-0 ${location.pathname.startsWith('/compliance') ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                    <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Compliance</span>
                                    {isLeftPanelOpen && <Unlock size={13} className="ml-auto flex-shrink-0 text-slate-400 dark:text-slate-400" />}
                                </button>
                            ) : (
                                <LockedNavItem
                                    icon={<Scale size={16} className="flex-shrink-0 text-slate-300 dark:text-slate-600" />}
                                    label="Compliance"
                                    badge="Enterprise"
                                    isOpen={isLeftPanelOpen}
                                    showTooltip={true}
                                />
                            )}

                            {/* Audit center */}
                            {enterpriseEnabled ? (
                                <button
                                    onClick={() => navigate('/audit')}
                                    className={`flex items-center py-1 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/audit')
                                        ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                        : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                    title={!isLeftPanelOpen ? "Audit Center" : undefined}
                                >
                                    <ShieldCheck size={16} className={`flex-shrink-0 ${location.pathname.startsWith('/audit') ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                    <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Audit center</span>
                                    {isLeftPanelOpen && <Unlock size={13} className="ml-auto flex-shrink-0 text-slate-400 dark:text-slate-400" />}
                                </button>
                            ) : (
                                <LockedNavItem
                                    icon={<ShieldCheck size={16} className="flex-shrink-0 text-slate-300 dark:text-slate-600" />}
                                    label="Audit center"
                                    badge="Enterprise"
                                    isOpen={isLeftPanelOpen}
                                    showTooltip={true}
                                />
                            )}

                            {/* Issues */}
                            {enterpriseEnabled ? (
                                <button
                                    onClick={() => navigate('/issues')}
                                    className={`flex items-center py-1 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname.startsWith('/issues')
                                        ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                        : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                    title={!isLeftPanelOpen ? 'Issues' : undefined}
                                >
                                    <AlertTriangle size={16} className={`flex-shrink-0 ${location.pathname.startsWith('/issues') ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`} />
                                    <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Issues</span>
                                    {isLeftPanelOpen && <Unlock size={13} className="ml-auto flex-shrink-0 text-slate-400 dark:text-slate-400" />}
                                </button>
                            ) : (
                                <LockedNavItem
                                    icon={<AlertTriangle size={16} className="flex-shrink-0 text-slate-300 dark:text-slate-600" />}
                                    label="Issues"
                                    badge="Enterprise"
                                    isOpen={isLeftPanelOpen}
                                    showTooltip={true}
                                />
                            )}

                        </div>
                    </div>{/* end scrollable nav */}

                    {/* Bottom Actions */}
                    <div className={`flex flex-col gap-0.5 border-t border-slate-100 dark:border-slate-800 transition-all duration-300 flex-shrink-0 ${isLeftPanelOpen ? 'px-3 py-2' : 'p-2'}`}>
                        <button
                            onClick={() => window.open('/help/user-guide', '_blank', 'noopener,noreferrer')}
                            className={`flex items-center py-1 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} bg-transparent text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white`}
                            title={!isLeftPanelOpen ? "Help" : undefined}
                        >
                            <CircleHelp size={16} className="flex-shrink-0 text-slate-400 dark:text-slate-300" />
                            <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Help</span>
                        </button>
                        <button
                            onClick={() => navigate('/settings')}
                            className={`flex items-center py-1 rounded-lg transition-all text-sm font-medium w-full outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'} ${location.pathname === '/settings'
                                ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 shadow-sm'
                                : 'bg-transparent text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white'}`}
                            title={!isLeftPanelOpen ? "Settings" : undefined}
                        >
                            <Settings size={16} className={`flex-shrink-0 ${location.pathname === '/settings' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-300'}`} />
                            <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isLeftPanelOpen ? 'max-w-[200px] ml-3 opacity-100' : 'max-w-0 ml-0 opacity-0'}`}>Settings</span>
                        </button>
                        <button
                            onClick={handleLogout}
                            className={`flex items-center py-1 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-200 hover:bg-red-50 dark:hover:bg-red-900/25 hover:text-red-600 dark:hover:text-red-300 transition-all w-full group outline-none ${isLeftPanelOpen ? 'px-3 justify-start' : 'px-0 justify-center'}`}
                            title={!isLeftPanelOpen ? "Sign Out" : undefined}
                        >
                            <LogOut size={16} className="flex-shrink-0 text-slate-400 dark:text-slate-300 group-hover:text-red-500 dark:group-hover:text-red-300 transition-colors" />
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
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">

                <div className={location.pathname === '/settings/logs'
                    ? 'flex-1 min-h-0 flex flex-col overflow-hidden'
                    : `p-8 w-full max-w-[1600px] mx-auto flex-1 overflow-y-auto${location.pathname.includes('/use-cases/') ? ' scrollbar-hide' : ''}`}>
                    <Outlet />
                </div>
                <footer className={`flex-shrink-0 border-t border-slate-200 dark:border-slate-800 py-2 px-6 text-[11px] text-slate-500 dark:text-slate-500 bg-white dark:bg-slate-900 transition-colors flex items-center justify-between${location.pathname === '/settings/logs' ? ' hidden' : ''}`}>
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
