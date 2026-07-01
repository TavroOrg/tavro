import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Plug, Settings, ChevronLeft, ChevronRight, LogOut, Terminal, Layers, Building2, Server, CircleHelp } from 'lucide-react';
import travoLogo from '../assets/travo_logo.png';

const TAVRO_VERSION = '3.1';

const STORAGE_NAME_KEY = 'tavro_active_company_name';

const AdminLayout: React.FC = () => {
    const [collapsed, setCollapsed] = useState(false);
    const navigate = useNavigate();
    const [activeCompanyName, setActiveCompanyName] = useState<string>(
        () => localStorage.getItem(STORAGE_NAME_KEY) ?? ''
    );

    // Keep footer in sync when company is changed on the Company page
    React.useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            setActiveCompanyName(detail?.name ?? '');
        };
        window.addEventListener('tavro_company_changed', handler);
        return () => window.removeEventListener('tavro_company_changed', handler);
    }, []);

    const handleLogout = () => {
        localStorage.removeItem('tavro_admin_auth');
        localStorage.removeItem('tavro_admin_access_token');
        navigate('/login');
    };

    return (
        <div className="h-screen overflow-hidden bg-slate-100 dark:bg-slate-950 flex transition-colors">
            {/* Sidebar */}
            <aside
                className={`${collapsed ? 'w-[72px]' : 'w-64'} relative bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col transition-all duration-300 shrink-0`}
            >
                {/* Brand */}
                <div
                    className="h-16 flex items-center px-4 border-b border-slate-200 dark:border-slate-800 gap-3 overflow-hidden cursor-pointer"
                    onClick={() => navigate('/')}
                >
                    <div className="bg-white dark:bg-slate-800 p-2 rounded-lg shadow-sm shrink-0 border border-slate-100 dark:border-slate-700">
                        <img src={travoLogo} alt="Tavro" className="w-[22px] h-[22px] object-contain" />
                    </div>
                    {!collapsed && (
                        <span className="font-bold text-base tracking-tight text-slate-800 dark:text-white truncate">
                            Tavro <span className="text-blue-600">Admin Portal</span>
                        </span>
                    )}
                </div>

                {/* Collapse toggle — floating button at right edge */}
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className="absolute -right-3.5 top-7 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-blue-600 rounded-full p-1.5 shadow-md z-[60] transition-colors outline-none"
                    title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                    {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                </button>

                {/* Nav */}
                <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
                    <NavLink
                        to="/company"
                        className={({ isActive }) =>
                            `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all border ${isActive
                                ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/20'
                                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-white border-transparent'
                            }`
                        }
                    >
                        <Building2 size={18} className="shrink-0" />
                        {!collapsed && <span>Company</span>}
                    </NavLink>

                    <NavLink
                        to="/connectors"
                        className={({ isActive }) =>
                            `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all border ${isActive
                                ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/20'
                                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-white border-transparent'
                            }`
                        }
                    >
                        <Plug size={18} className="shrink-0" />
                        {!collapsed && <span>Connectors</span>}
                    </NavLink>

                    {/* Integrations — coming soon */}
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium border border-transparent text-slate-400 dark:text-slate-600 cursor-default select-none">
                        <Layers size={18} className="shrink-0" />
                        {!collapsed && (
                            <span className="flex items-center gap-2">
                                Integrations
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-500 font-medium leading-none whitespace-nowrap">
                                    Coming soon
                                </span>
                            </span>
                        )}
                    </div>

                    <NavLink
                        to="/container-logs"
                        className={({ isActive }) =>
                            `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all border ${isActive
                                ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/20'
                                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-white border-transparent'
                            }`
                        }
                    >
                        <Terminal size={18} className="shrink-0" />
                        {!collapsed && <span>Container Logs</span>}
                    </NavLink>

                    <NavLink
                        to="/settings"
                        className={({ isActive }) =>
                            `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all border ${isActive
                                ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/20'
                                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-white border-transparent'
                            }`
                        }
                    >
                        <Settings size={18} className="shrink-0" />
                        {!collapsed && <span>LLM Settings</span>}
                    </NavLink>
                    <NavLink
                        to="/infrastructure"
                        className={({ isActive }) =>
                            `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all border ${isActive
                                ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/20'
                                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-white border-transparent'
                            }`
                        }
                    >
                        <Server size={18} className="shrink-0" />
                        {!collapsed && <span>Infrastructure Configuration</span>}
                    </NavLink>
                </nav>

                {/* Bottom actions */}
                <div className="p-3 border-t border-slate-200 dark:border-slate-800">
                    <NavLink
                        to="/help/user-guide"
                        className={({ isActive }) =>
                            `mb-1 flex w-full items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all border ${isActive
                                ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/20'
                                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-white border-transparent'
                            }`
                        }
                    >
                        <CircleHelp size={18} className="shrink-0" />
                        {!collapsed && <span>Help</span>}
                    </NavLink>
                    <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400 text-sm font-medium transition-all"
                    >
                        <LogOut size={18} className="shrink-0" />
                        {!collapsed && <span>Sign Out</span>}
                    </button>
                </div>
            </aside>

            {/* Main */}
            <main className="flex-1 flex flex-col overflow-hidden">
                {/* Page content */}
                <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                    <Outlet />
                </div>

                {/* Footer */}
                <footer className="flex-shrink-0 border-t border-slate-200 dark:border-slate-800 py-2 px-6 text-[11px] text-slate-500 dark:text-slate-500 bg-white dark:bg-slate-900 transition-colors flex items-center justify-between">
                    <span>Tavro v{TAVRO_VERSION}</span>
                    <span className="flex items-center gap-1.5">
                        <Building2 size={11} className={activeCompanyName ? 'text-blue-500' : 'text-slate-400'} />
                        <span className={activeCompanyName ? 'text-slate-700 dark:text-slate-300 font-medium' : ''}>
                            {activeCompanyName || '—'}
                        </span>
                    </span>
                    <span>© 2026 Tavro AI.</span>
                </footer>
            </main>
        </div>
    );
};

export default AdminLayout;






